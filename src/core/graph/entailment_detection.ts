import type { Driver } from 'neo4j-driver';
import type { Pool } from 'pg';
import { config } from '../../config/index.js';
import { zodResponseFormat } from 'openai/helpers/zod';
import { parseLlmResponse } from '../llm/boundary.js';
import { EntailmentResponseSchema } from './schemas.js';
import { collectText, ClassifierUsage } from './verification.js';

// Session 32 (PROVENANCE_THREADING.md §5.4): the sampled entailment tier —
// a post-hoc DETECTOR over persisted DERIVED_INSIGHT (edge, cited-hash)
// pairs, measuring the T2 residual (read-then-cite laundering) the
// write-path layers cannot see by construction. The design record's §1
// taxonomy is binding vocabulary here: slice (d) closed T1
// (transcription/choice); this tier SAMPLES the semantic residual at a
// rate and FLAGS unsupported citations into the ordinary contested
// machinery. It is never a write gate, and it never deletes.
//
// The sampling unit is the (edge, cited-hash) PAIR. Each pair is judged
// AT MOST ONCE, ever: a supported verdict stamps the hash into the edge's
// entailmentCheckedHashes; an unsupported verdict contests the edge
// (contestedReason = 'unsupported_citation') and records the hash in
// unsupportedHashes. Both stamps are additive audit records — provenance
// fields (sourceNodeIds / orphanedSourceIds) are never mutated, and the
// contest transition is exactly the Phase 4/5 one. Selection excludes
// both stamp kinds, so judge spend is monotone useful; a NEW hash on a
// re-derived edge is a new pair and re-enters the pool.
//
// Judge discipline: every verdict is collected BEFORE any write — a judge
// infrastructure failure (network, parse, refusal) propagates as an error
// and stamps/contests NOTHING. An error is never a provenance verdict.

// --- Policy ------------------------------------------------------------------
export interface EntailmentPolicy {
  /** Sampling rate over unchecked (edge, cited-hash) pairs. */
  sampleRate: number;
  /** Hard cap on judge calls per sweep; overflow is deferred, counted. */
  judgeBudget: number;
  /** RNG (injectable for reproducible drills); defaults to Math.random. */
  random: () => number;
  /** Optional subject-name prefix filter (used by hermetic tests). */
  subjectPrefix?: string;
}

export function defaultEntailmentPolicy(
  overrides: Partial<EntailmentPolicy> = {}
): EntailmentPolicy {
  return {
    sampleRate: overrides.sampleRate ?? config.entailment.sampleRate,
    judgeBudget: overrides.judgeBudget ?? config.entailment.judgeBudgetPerSweep,
    random: overrides.random ?? Math.random,
    subjectPrefix: overrides.subjectPrefix,
  };
}

// --- Candidate selection -------------------------------------------------------
export interface InsightEdge {
  subject: string;
  verb: string;
  object: string;
  sourceNodeIds: string[];
  /** Hashes already judged for this edge (supported + unsupported). */
  checkedHashes: string[];
}

export interface EntailmentPair {
  subject: string;
  verb: string;
  object: string;
  hash: string;
}

/** Stable identity for one (claim, cited-hash) pair — the oracle map key. */
export function entailmentPairKey(p: EntailmentPair): string {
  return `${p.subject}|${p.verb}|${p.object}|${p.hash}`;
}

// Every non-contested DERIVED_INSIGHT edge with provenance is in the pool
// (uniform candidate class — the record's "per persisted pair" scope;
// has_category edges are included: the verification sweep asks a different
// question of them). Contested edges are excluded: already quarantined.
const SELECT_INSIGHT_EDGES_CYPHER = `
  MATCH (s:Entity)-[r:DERIVED_INSIGHT]->(o:Entity)
  WHERE coalesce(r.contested, false) = false
    AND r.sourceNodeIds IS NOT NULL AND size(r.sourceNodeIds) > 0
    AND ($prefix IS NULL OR s.name STARTS WITH $prefix)
  RETURN s.name AS subject, r.verb AS verb, o.name AS object,
         r.sourceNodeIds AS sourceNodeIds,
         coalesce(r.entailmentCheckedHashes, []) + coalesce(r.unsupportedHashes, []) AS checkedHashes
  ORDER BY subject, verb, object
`;

export async function selectInsightEdges(
  driver: Driver,
  policy: EntailmentPolicy
): Promise<InsightEdge[]> {
  const session = driver.session();
  try {
    const res = await session.executeRead(tx =>
      tx.run(SELECT_INSIGHT_EDGES_CYPHER, { prefix: policy.subjectPrefix ?? null })
    );
    return res.records.map(rec => ({
      subject: rec.get('subject') as string,
      verb: rec.get('verb') as string,
      object: rec.get('object') as string,
      sourceNodeIds: (rec.get('sourceNodeIds') as string[] | null) ?? [],
      checkedHashes: (rec.get('checkedHashes') as string[] | null) ?? [],
    }));
  } finally {
    await session.close();
  }
}

export interface PairSelection {
  /** Pairs picked for this sweep (sampled, within budget). */
  pairs: EntailmentPair[];
  /** Edges in the (non-contested, provenance-bearing) pool. */
  poolEdges: number;
  /** Unchecked pairs across the pool. */
  poolPairs: number;
  /** Pairs the RNG picked (= pairs.length + deferred). */
  sampled: number;
  /** Sampled pairs beyond the judge budget — reported, never silent. */
  deferred: number;
}

/**
 * Pure pair expansion + sampling: for each edge, the unchecked pairs are
 * its cited hashes minus its judged hashes (deduped, order preserved);
 * each is sampled independently at policy.sampleRate; the judge budget
 * caps how many enter the sweep, with the overflow counted as deferred.
 */
export function sampleEntailmentPairs(
  edges: InsightEdge[],
  policy: EntailmentPolicy
): PairSelection {
  const pairs: EntailmentPair[] = [];
  let poolPairs = 0;
  let sampled = 0;
  for (const e of edges) {
    const checked = new Set(e.checkedHashes);
    const seen = new Set<string>();
    for (const hash of e.sourceNodeIds) {
      if (checked.has(hash) || seen.has(hash)) continue;
      seen.add(hash);
      poolPairs++;
      if (policy.random() < policy.sampleRate) {
        sampled++;
        if (pairs.length < policy.judgeBudget) {
          pairs.push({ subject: e.subject, verb: e.verb, object: e.object, hash });
        }
      }
    }
  }
  return { pairs, poolEdges: edges.length, poolPairs, sampled, deferred: sampled - pairs.length };
}

// --- Block text fetch ------------------------------------------------------------
/** Fetches live text per cited hash (the verifyBeliefs fetch, per-hash). */
export async function fetchBlockTexts(
  pgPool: Pool,
  hashes: string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(hashes)];
  const byHash = new Map<string, string>();
  if (unique.length === 0) return byHash;
  const res = await pgPool.query('SELECT id, data FROM ast_nodes WHERE id = ANY($1)', [unique]);
  for (const row of res.rows) {
    const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    const text = collectText(data).join(' ').trim();
    if (text) byHash.set(row.id, text);
  }
  return byHash;
}

// --- Judges ---------------------------------------------------------------------
export interface EntailmentJudgment {
  /** null = the judge declined this pair (oracle miss) — skipped, counted. */
  verdict: { supported: boolean } | null;
  usage: ClassifierUsage;
}

export type EntailmentJudge = (
  pair: EntailmentPair & { text: string }
) => Promise<EntailmentJudgment>;

/**
 * Deterministic pair -> verdict map for LLM-free dress rehearsals, keyed by
 * entailmentPairKey. Absent keys are declined (skipped), zero cost — the
 * makeOracleClassifier mold.
 */
export function makeOracleEntailmentJudge(truth: Record<string, boolean>): EntailmentJudge {
  return async pair => {
    const supported = truth[entailmentPairKey(pair)];
    return {
      verdict: supported === undefined ? null : { supported },
      usage: { subcalls: 0, inputTokens: 0, outputTokens: 0 },
    };
  };
}

/**
 * The real judge: one bounded completion per sampled pair, asking whether
 * the block's text supports the claim (the make_entailment_check prompt
 * shape from trellis_agent.py — the semantic reference), validated through
 * parseLlmResponse before any state is touched. Any failure here throws;
 * it never becomes a verdict.
 */
export function makeOpenAIEntailmentJudge(model = config.llm.extractionModel): EntailmentJudge {
  return async pair => {
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI();
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are a strict citation-entailment judge. Answer with the required JSON only.',
        },
        {
          role: 'user',
          content:
            `Claim: ${pair.subject} ${pair.verb} ${pair.object}\n\n` +
            `Source block text:\n${pair.text}\n\n` +
            'Does the source block text state or directly support the claim?',
        },
      ],
      response_format: zodResponseFormat(EntailmentResponseSchema, 'entailment_verdict'),
      temperature: 0,
    });
    const parsed = parseLlmResponse(
      EntailmentResponseSchema,
      completion.choices[0].message.content,
      'entailment judge pair'
    );
    return {
      verdict: { supported: parsed.supported },
      usage: {
        subcalls: 1,
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
      },
    };
  };
}

// --- Detection pass ---------------------------------------------------------------
export interface EntailmentReport {
  poolEdges: number;
  poolPairs: number;
  sampled: number;
  deferred: number;
  judged: number;
  supported: number;
  flagged: number;
  edgesFlagged: number;
  skippedNoText: number;
  skippedNoAnswer: number;
  usage: ClassifierUsage;
  flags: Array<{ subject: string; verb: string; object: string; hash: string }>;
}

// A supported pair accrues its check stamp — additive audit properties
// only; provenance fields untouched.
const STAMP_CYPHER = `
  UNWIND $stamps AS st
  MATCH (:Entity {name: st.subject})-[r:DERIVED_INSIGHT {verb: st.verb}]->(:Entity {name: st.object})
  SET r.entailmentCheckedHashes = CASE
        WHEN st.hash IN coalesce(r.entailmentCheckedHashes, []) THEN r.entailmentCheckedHashes
        ELSE coalesce(r.entailmentCheckedHashes, []) + st.hash END,
      r.entailmentCheckedAt = timestamp()
`;

// An unsupported pair contests the edge through the ordinary Phase 4/5
// transition (the DISPUTE_CYPHER mold) with its own typed reason; the
// judged hash is recorded as a durable audit property. Never a delete;
// re-derivation is the recovery path.
const FLAG_CYPHER = `
  UNWIND $flags AS fl
  MATCH (:Entity {name: fl.subject})-[r:DERIVED_INSIGHT {verb: fl.verb}]->(:Entity {name: fl.object})
  SET r.contested = true,
      r.contestedAt = coalesce(r.contestedAt, timestamp()),
      r.contestedReason = 'unsupported_citation',
      r.unsupportedHashes = CASE
        WHEN fl.hash IN coalesce(r.unsupportedHashes, []) THEN r.unsupportedHashes
        ELSE coalesce(r.unsupportedHashes, []) + fl.hash END,
      r.entailmentFlaggedAt = timestamp()
`;

/**
 * Judges the selected pairs and applies the verdicts. All judging happens
 * BEFORE any write: an infrastructure failure anywhere aborts the sweep
 * with no partial stamps and no partial contests.
 */
export async function detectUnsupportedCitations(
  driver: Driver,
  pgPool: Pool,
  pairs: EntailmentPair[],
  judge: EntailmentJudge
): Promise<EntailmentReport> {
  const report: EntailmentReport = {
    poolEdges: 0,
    poolPairs: 0,
    sampled: pairs.length,
    deferred: 0,
    judged: 0,
    supported: 0,
    flagged: 0,
    edgesFlagged: 0,
    skippedNoText: 0,
    skippedNoAnswer: 0,
    usage: { subcalls: 0, inputTokens: 0, outputTokens: 0 },
    flags: [],
  };
  if (pairs.length === 0) return report;

  const textByHash = await fetchBlockTexts(pgPool, pairs.map(p => p.hash));
  const stamps: EntailmentPair[] = [];
  const flags: EntailmentPair[] = [];

  for (const pair of pairs) {
    const text = textByHash.get(pair.hash);
    if (!text) {
      // The bytes died since the write — the quarantine sweep's territory,
      // not a semantic verdict. Skipped and counted, never judged blind.
      report.skippedNoText++;
      continue;
    }
    const { verdict, usage } = await judge({ ...pair, text });
    report.usage.subcalls += usage.subcalls;
    report.usage.inputTokens += usage.inputTokens;
    report.usage.outputTokens += usage.outputTokens;
    if (verdict === null) {
      report.skippedNoAnswer++;
      continue;
    }
    report.judged++;
    if (verdict.supported) stamps.push(pair);
    else flags.push(pair);
  }

  const session = driver.session();
  try {
    if (stamps.length > 0) {
      await session.executeWrite(tx => tx.run(STAMP_CYPHER, { stamps }));
    }
    if (flags.length > 0) {
      await session.executeWrite(tx => tx.run(FLAG_CYPHER, { flags }));
    }
  } finally {
    await session.close();
  }

  report.supported = stamps.length;
  report.flagged = flags.length;
  report.edgesFlagged = new Set(flags.map(f => `${f.subject}|${f.verb}|${f.object}`)).size;
  report.flags = flags.map(f => ({ subject: f.subject, verb: f.verb, object: f.object, hash: f.hash }));
  return report;
}

/** Full sweep: selection, sampling, judging, and verdict application. */
export async function runEntailmentSweep(
  driver: Driver,
  pgPool: Pool,
  policy: EntailmentPolicy,
  judge: EntailmentJudge
): Promise<EntailmentReport> {
  const edges = await selectInsightEdges(driver, policy);
  const selection = sampleEntailmentPairs(edges, policy);
  const report = await detectUnsupportedCitations(driver, pgPool, selection.pairs, judge);
  report.poolEdges = selection.poolEdges;
  report.poolPairs = selection.poolPairs;
  report.sampled = selection.sampled;
  report.deferred = selection.deferred;
  return report;
}
