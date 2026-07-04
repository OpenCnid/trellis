import * as fs from 'fs';
import * as path from 'path';
import type { Driver } from 'neo4j-driver';
import type { Pool } from 'pg';

// Phase 5 Milestone 3: the verification layer.
//
// Phase 4's quarantine machinery contests a fact because its bytes died
// (drift). This module contests a fact because an independent re-check
// disagreed (original sin): cached has_category beliefs are sampled
// under a trust policy, re-classified from their LIVE source text
// (fetched by Merkle hash — provenance is the input, not the graph's
// current belief), and compared against the stored label. Agreement
// accrues trust (verified_count); disagreement reuses the Phase 4
// quarantine path end-to-end: contested = true, no deletion, no
// in-place correction — the agent's next query treats the fact as
// missing and re-derives it (arbitration by re-derivation).

// --- Rubric: versioned single source shared with the Python agent ------
const RUBRIC_FILE = path.join(__dirname, '..', '..', 'rlm', 'trec_rubric.json');
const rubricJson = JSON.parse(fs.readFileSync(RUBRIC_FILE, 'utf-8'));
export const CURRENT_RUBRIC_VERSION: number = rubricJson.version;
export const RUBRIC_TEXT: string = rubricJson.rubric;

// --- Policy --------------------------------------------------------------
export type VerificationTier = 'mandatory' | 'sampled' | 'graduated';

export interface VerificationPolicy {
  /** Sampling rate p for un-graduated, confident, current-rubric beliefs. */
  sampleRate: number;
  /** Spot-check rate for graduated beliefs (default sampleRate / 10). */
  graduatedRate: number;
  /** verified_count at which a belief graduates out of the sampling pool. */
  graduationThreshold: number;
  /** Beliefs below this stored confidence (or with none) are checked eagerly. */
  mandatoryConfidenceBelow: number;
  /** RNG (injectable for reproducible drills); defaults to Math.random. */
  random: () => number;
  /** Optional subject-name prefix filter (used by hermetic tests). */
  subjectPrefix?: string;
}

export function defaultPolicy(overrides: Partial<VerificationPolicy> = {}): VerificationPolicy {
  const sampleRate = overrides.sampleRate ?? 0.05;
  return {
    sampleRate,
    graduatedRate: overrides.graduatedRate ?? sampleRate / 10,
    graduationThreshold: overrides.graduationThreshold ?? 3,
    mandatoryConfidenceBelow: overrides.mandatoryConfidenceBelow ?? 0.8,
    random: overrides.random ?? Math.random,
    subjectPrefix: overrides.subjectPrefix
  };
}

// Deterministic RNG for reproducible sweeps (drill dress rehearsals).
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Candidate selection ---------------------------------------------------
export interface BeliefCandidate {
  subject: string;
  label: string;
  confidence: number | null;
  rubricVersion: number | null;
  verifiedCount: number;
  sourceNodeIds: string[];
  tier: VerificationTier;
}

export interface SelectionResult {
  /** Beliefs picked for this sweep. */
  candidates: BeliefCandidate[];
  /** Tier sizes over the whole (non-contested) belief pool. */
  poolByTier: Record<VerificationTier, number>;
  poolSize: number;
}

// Classification beliefs are found STRUCTURALLY (kind = 'question'
// subjects of has_category edges) — the Milestone 2 namespace, not name
// regexes. Contested edges are excluded: they are already quarantined.
const SELECT_BELIEFS_CYPHER = `
  MATCH (s:Entity {kind: 'question'})-[r:DERIVED_INSIGHT {verb: 'has_category'}]->(o:Entity)
  WHERE coalesce(r.contested, false) = false
    AND ($prefix IS NULL OR s.name STARTS WITH $prefix)
  RETURN s.name AS subject, o.name AS label,
         r.confidence AS confidence, r.rubricVersion AS rubricVersion,
         coalesce(r.verified_count, 0) AS verifiedCount,
         r.sourceNodeIds AS sourceNodeIds
  ORDER BY subject
`;

export function assignTier(
  belief: { confidence: number | null; rubricVersion: number | null; verifiedCount: number },
  policy: VerificationPolicy
): VerificationTier {
  const staleRubric = belief.rubricVersion == null || belief.rubricVersion < CURRENT_RUBRIC_VERSION;
  const lowConfidence = belief.confidence == null || belief.confidence < policy.mandatoryConfidenceBelow;
  if (staleRubric || lowConfidence) return 'mandatory';
  if (belief.verifiedCount < policy.graduationThreshold) return 'sampled';
  return 'graduated';
}

export async function selectVerificationCandidates(
  driver: Driver,
  policy: VerificationPolicy
): Promise<SelectionResult> {
  const session = driver.session();
  try {
    const res = await session.executeRead(tx =>
      tx.run(SELECT_BELIEFS_CYPHER, { prefix: policy.subjectPrefix ?? null })
    );
    const poolByTier: Record<VerificationTier, number> = { mandatory: 0, sampled: 0, graduated: 0 };
    const candidates: BeliefCandidate[] = [];
    for (const rec of res.records) {
      const belief = {
        subject: rec.get('subject') as string,
        label: rec.get('label') as string,
        confidence: rec.get('confidence') == null ? null : Number(rec.get('confidence')),
        rubricVersion: rec.get('rubricVersion') == null ? null : Number(rec.get('rubricVersion')),
        verifiedCount: Number(rec.get('verifiedCount')),
        sourceNodeIds: (rec.get('sourceNodeIds') as string[] | null) ?? []
      };
      const tier = assignTier(belief, policy);
      poolByTier[tier]++;
      const selected =
        tier === 'mandatory' ||
        (tier === 'sampled' && policy.random() < policy.sampleRate) ||
        (tier === 'graduated' && policy.random() < policy.graduatedRate);
      if (selected) candidates.push({ ...belief, tier });
    }
    return { candidates, poolByTier, poolSize: res.records.length };
  } finally {
    await session.close();
  }
}

// --- Live text fetch ---------------------------------------------------------
// AST rows store the node subtree as JSON; the human-readable text lives
// on descendant text nodes. Walk the subtree and collect content.
function collectText(node: unknown): string[] {
  if (!node || typeof node !== 'object') return [];
  const acc: string[] = [];
  const n = node as { content?: unknown; children?: unknown[] };
  if (typeof n.content === 'string') acc.push(n.content);
  for (const child of n.children ?? []) acc.push(...collectText(child));
  return acc;
}

/** Fetches live text for each candidate from its Merkle provenance. */
export async function fetchLiveTexts(
  pgPool: Pool,
  candidates: BeliefCandidate[]
): Promise<Map<string, string>> {
  const allHashes = [...new Set(candidates.flatMap(c => c.sourceNodeIds))];
  const textByHash = new Map<string, string>();
  if (allHashes.length > 0) {
    const res = await pgPool.query('SELECT id, data FROM ast_nodes WHERE id = ANY($1)', [allHashes]);
    for (const row of res.rows) {
      const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      const text = collectText(data).join(' ').trim();
      if (text) textByHash.set(row.id, text);
    }
  }
  const textBySubject = new Map<string, string>();
  for (const c of candidates) {
    const text = c.sourceNodeIds.map(h => textByHash.get(h)).filter(Boolean).join(' ').trim();
    if (text) textBySubject.set(c.subject, text);
  }
  return textBySubject;
}

// --- Classifiers -----------------------------------------------------------
export interface ClassifierUsage {
  subcalls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ClassifierResult {
  results: Record<string, { label: string; confidence: number }>;
  usage: ClassifierUsage;
}

export type Classifier = (questions: Array<{ id: string; text: string }>) => Promise<ClassifierResult>;

/**
 * Ground-truth oracle classifier for LLM-free dress rehearsals: answers
 * from a known id -> label map with full confidence, zero cost. Ids
 * absent from the map are omitted from the result (treated as
 * unclassifiable, like a sub-LLM refusing an id).
 */
export function makeOracleClassifier(truth: Record<string, string>): Classifier {
  return async questions => {
    const results: Record<string, { label: string; confidence: number }> = {};
    for (const q of questions) {
      const label = truth[q.id];
      if (label) results[q.id] = { label: label.toLowerCase(), confidence: 1.0 };
    }
    return { results, usage: { subcalls: 0, inputTokens: 0, outputTokens: 0 } };
  };
}

/** Real sub-LLM classifier using the current versioned rubric. */
export function makeOpenAIClassifier(model = 'gpt-5.4-2026-03-05'): Classifier {
  return async questions => {
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI();
    const payload = questions.map(q => ({ id: q.id, text: q.text }));
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: 'You are a strict TREC question-classification engine. You answer ONLY with the requested JSON object.' },
        { role: 'user', content: `${RUBRIC_TEXT}\n\nQuestions:\n${JSON.stringify(payload)}` }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1
    });
    const raw = completion.choices[0].message.content;
    if (!raw) throw new Error('No content returned from verification sub-LLM');
    const parsed = JSON.parse(raw) as Record<string, { label?: string; confidence?: number } | string>;
    const results: Record<string, { label: string; confidence: number }> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === 'string') {
        // Tolerate a legacy bare-label reply.
        results[id] = { label: value.toLowerCase(), confidence: 0.5 };
      } else if (value && typeof value.label === 'string') {
        results[id] = {
          label: value.label.toLowerCase(),
          confidence: typeof value.confidence === 'number' ? Math.max(0, Math.min(1, value.confidence)) : 0.5
        };
      }
    }
    return {
      results,
      usage: {
        subcalls: 1,
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0
      }
    };
  };
}

// --- Verification pass -------------------------------------------------------
export interface VerificationReport {
  selected: number;
  classified: number;
  agreed: number;
  disputed: number;
  skippedNoText: number;
  skippedNoAnswer: number;
  usage: ClassifierUsage;
  disputes: Array<{ subject: string; label: string; disputedLabel: string }>;
  poolByTier?: Record<VerificationTier, number>;
}

// Agreement accrues trust and re-stamps the belief as validated under
// the CURRENT rubric; stored confidence moves toward the fresh reading.
const AGREE_CYPHER = `
  UNWIND $agrees AS a
  MATCH (:Entity {name: a.subject})-[r:DERIVED_INSIGHT {verb: 'has_category'}]->(:Entity {name: a.label})
  SET r.verified_count = coalesce(r.verified_count, 0) + 1,
      r.lastVerifiedAt = timestamp(),
      r.rubricVersion = $rubricVersion,
      r.confidence = CASE WHEN r.confidence IS NULL THEN a.freshConfidence
                          ELSE (r.confidence + a.freshConfidence) / 2.0 END
`;

// Disagreement reuses the Phase 4 quarantine path: contested = true, no
// deletion, no in-place correction. The fresh reading is recorded as
// disputedLabel for the audit trail; the agent's next query treats the
// belief as missing and re-derives it.
const DISPUTE_CYPHER = `
  UNWIND $disputes AS d
  MATCH (:Entity {name: d.subject})-[r:DERIVED_INSIGHT {verb: 'has_category'}]->(:Entity {name: d.label})
  SET r.contested = true,
      r.contestedAt = coalesce(r.contestedAt, timestamp()),
      r.contestedReason = 'disputed',
      r.disputedLabel = d.disputedLabel,
      r.disputedConfidence = d.disputedConfidence,
      r.disputedAt = timestamp()
`;

const CLASSIFY_BATCH_SIZE = 50;

export async function verifyBeliefs(
  driver: Driver,
  pgPool: Pool,
  candidates: BeliefCandidate[],
  classifier: Classifier,
  batchSize: number = CLASSIFY_BATCH_SIZE
): Promise<VerificationReport> {
  const report: VerificationReport = {
    selected: candidates.length,
    classified: 0,
    agreed: 0,
    disputed: 0,
    skippedNoText: 0,
    skippedNoAnswer: 0,
    usage: { subcalls: 0, inputTokens: 0, outputTokens: 0 },
    disputes: []
  };
  if (candidates.length === 0) return report;

  const textBySubject = await fetchLiveTexts(pgPool, candidates);
  const checkable = candidates.filter(c => {
    if (textBySubject.has(c.subject)) return true;
    report.skippedNoText++;
    return false;
  });

  const agrees: Array<{ subject: string; label: string; freshConfidence: number }> = [];
  const disputes: Array<{ subject: string; label: string; disputedLabel: string; disputedConfidence: number }> = [];

  for (let i = 0; i < checkable.length; i += batchSize) {
    const batch = checkable.slice(i, i + batchSize);
    const { results, usage } = await classifier(batch.map(c => ({ id: c.subject, text: textBySubject.get(c.subject)! })));
    report.usage.subcalls += usage.subcalls;
    report.usage.inputTokens += usage.inputTokens;
    report.usage.outputTokens += usage.outputTokens;
    for (const c of batch) {
      const fresh = results[c.subject];
      if (!fresh) {
        report.skippedNoAnswer++;
        continue;
      }
      report.classified++;
      if (fresh.label.toLowerCase() === c.label.toLowerCase()) {
        agrees.push({ subject: c.subject, label: c.label, freshConfidence: fresh.confidence });
      } else {
        disputes.push({ subject: c.subject, label: c.label, disputedLabel: fresh.label.toLowerCase(), disputedConfidence: fresh.confidence });
      }
    }
  }

  const session = driver.session();
  try {
    if (agrees.length > 0) {
      await session.executeWrite(tx => tx.run(AGREE_CYPHER, { agrees, rubricVersion: CURRENT_RUBRIC_VERSION }));
    }
    if (disputes.length > 0) {
      await session.executeWrite(tx => tx.run(DISPUTE_CYPHER, { disputes }));
    }
  } finally {
    await session.close();
  }

  report.agreed = agrees.length;
  report.disputed = disputes.length;
  report.disputes = disputes.map(d => ({ subject: d.subject, label: d.label, disputedLabel: d.disputedLabel }));
  return report;
}

/** Full sweep: policy-driven selection followed by a verification pass. */
export async function runVerificationSweep(
  driver: Driver,
  pgPool: Pool,
  policy: VerificationPolicy,
  classifier: Classifier
): Promise<VerificationReport> {
  const selection = await selectVerificationCandidates(driver, policy);
  const report = await verifyBeliefs(driver, pgPool, selection.candidates, classifier);
  report.poolByTier = selection.poolByTier;
  return report;
}
