import type { Driver } from 'neo4j-driver';
import type { Pool } from 'pg';
import { config } from '../../config/index.js';
import { zodResponseFormat } from 'openai/helpers/zod';
import { parseLlmResponse } from '../llm/boundary.js';
import { AliasAdjudicationSchema } from './schemas.js';
import { collectText, type ClassifierUsage } from './verification.js';
import {
  generateAliasCandidates,
  canonicalPairId,
  type AliasEntity,
  type CandidatePair,
  type CandidateSignal,
} from './alias_candidates.js';

// Session 5: entity resolution beyond exact-name identity.
//
// Identity stays immutable — globalEntityId and the extraction merge are
// untouched, and no Entity node is ever merged, renamed, or deleted.
// Equivalence is an overlay BELIEF: a positive verdict is a
// (a)-[:SAME_AS]->(b) edge, a negative one (a)-[:DISTINCT_FROM]->(b)
// (recording negatives prevents re-paying for the same pair every
// sweep). Both carry sourceNodeIds — the union of the endpoints' live
// provenance at adjudication time — so the EXISTING invalidation sweep
// (invalidation.ts matches any relationship with sourceNodeIds)
// quarantines a verdict when its provenance dies, with zero new
// machinery. A contested pair is re-adjudicable on a later sweep, and a
// fresh verdict recovers it through the same ON MATCH re-derivation
// semantics as extraction_merge.ts — arbitration by re-derivation.
//
// Same sweep-selects / worker-burns-down split as verification.ts: the
// sweep script (scripts/resolve_sweep.ts) reads entities, generates
// deterministic candidates (alias_candidates.ts), and enqueues one job;
// the resolution worker adjudicates in bounded LLM batches (or via the
// zero-cost oracle in drills) and writes the verdict edges.

// --- Selection ---------------------------------------------------------------

// Only uncontested, provenance-bearing entities of the resolvable kinds
// participate. NULL kind is pre-kind extraction output — effectively
// 'generic' (entity_kinds.ts rule 4). 'question' / 'category_label'
// never appear here, so the OOLONG flywheel's exact-id lookups are
// structurally unaffected. Entities without an id (never expected — the
// merge stamps it ON CREATE) or without live provenance cannot carry an
// adjudicable verdict and are excluded.
export const SELECT_RESOLUTION_ENTITIES_CYPHER = `
  MATCH (n:Entity)
  WHERE coalesce(n.contested, false) = false
    AND coalesce(n.kind, 'generic') IN ['generic', 'concept']
    AND n.id IS NOT NULL
    AND size(coalesce(n.sourceNodeIds, [])) > 0
    AND ($prefix IS NULL OR n.name STARTS WITH $prefix)
  RETURN n.id AS id, n.name AS name, n.type AS type,
         coalesce(n.kind, 'generic') AS kind,
         n.sourceNodeIds AS sourceNodeIds
  ORDER BY n.id
`;

// Pairs already carrying a non-contested verdict (either polarity) are
// settled; contested verdicts leave the pair re-adjudicable.
export const EXISTING_VERDICT_PAIRS_CYPHER = `
  MATCH (a:Entity)-[r:SAME_AS|DISTINCT_FROM]->(b:Entity)
  WHERE coalesce(r.contested, false) = false
  RETURN a.id AS aId, b.id AS bId
`;

export interface ResolutionSelection {
  pairs: CandidatePair[];
  /** Resolvable entities read from the graph. */
  poolSize: number;
  /** Candidate pairs suppressed by an existing non-contested verdict. */
  excludedExisting: number;
}

export async function selectResolutionCandidates(
  driver: Driver,
  options: { maxPairs: number; namePrefix?: string }
): Promise<ResolutionSelection> {
  const session = driver.session();
  try {
    const entityRes = await session.executeRead(tx =>
      tx.run(SELECT_RESOLUTION_ENTITIES_CYPHER, { prefix: options.namePrefix ?? null })
    );
    const entities: AliasEntity[] = entityRes.records.map(rec => ({
      id: rec.get('id') as string,
      name: rec.get('name') as string,
      type: (rec.get('type') as string | null) ?? undefined,
      kind: rec.get('kind') as string,
      sourceNodeIds: (rec.get('sourceNodeIds') as string[] | null) ?? [],
    }));

    const verdictRes = await session.executeRead(tx => tx.run(EXISTING_VERDICT_PAIRS_CYPHER));
    const settled = new Set<string>(
      verdictRes.records.map(rec =>
        canonicalPairId(rec.get('aId') as string, rec.get('bId') as string)
      )
    );

    const unfiltered = generateAliasCandidates(entities);
    const eligible = unfiltered.filter(pair => !settled.has(pair.pairId));
    return {
      pairs: eligible.slice(0, options.maxPairs),
      poolSize: entities.length,
      excludedExisting: unfiltered.length - eligible.length,
    };
  } finally {
    await session.close();
  }
}

// --- Adjudication context ------------------------------------------------------

/** Snippet cap per entity: enough context to judge, never whole documents. */
const SNIPPET_CHAR_LIMIT = 600;

/**
 * Fetches bounded live source-text snippets for every entity referenced
 * by the pairs, keyed by entity id. An entity whose provenance yields no
 * text (rows deleted, empty content) is absent from the map.
 */
export async function fetchEntitySnippets(
  pgPool: Pool,
  pairs: readonly CandidatePair[]
): Promise<Map<string, string>> {
  const entities = new Map<string, AliasEntity>();
  for (const pair of pairs) {
    entities.set(pair.a.id, pair.a);
    entities.set(pair.b.id, pair.b);
  }
  const allHashes = [...new Set([...entities.values()].flatMap(e => e.sourceNodeIds))];
  const textByHash = new Map<string, string>();
  if (allHashes.length > 0) {
    const res = await pgPool.query('SELECT id, data FROM ast_nodes WHERE id = ANY($1)', [allHashes]);
    for (const row of res.rows) {
      const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      const text = collectText(data).join(' ').trim();
      if (text) textByHash.set(row.id, text);
    }
  }
  const snippetByEntity = new Map<string, string>();
  for (const entity of entities.values()) {
    const text = entity.sourceNodeIds
      .map(h => textByHash.get(h))
      .filter(Boolean)
      .join(' ')
      .trim();
    if (text) snippetByEntity.set(entity.id, text.slice(0, SNIPPET_CHAR_LIMIT));
  }
  return snippetByEntity;
}

// --- Adjudicators --------------------------------------------------------------

export interface AdjudicationVerdict {
  sameEntity: boolean;
  confidence: number;
  reasoning: string;
}

export interface AdjudicationContext {
  pairId: string;
  a: { name: string; type?: string; snippet: string };
  b: { name: string; type?: string; snippet: string };
  kind: string;
}

export interface AdjudicatorResult {
  results: Record<string, AdjudicationVerdict>;
  usage: ClassifierUsage;
}

export type Adjudicator = (pairs: AdjudicationContext[]) => Promise<AdjudicatorResult>;

/**
 * Ground-truth oracle adjudicator for LLM-free drills, mirroring
 * makeOracleClassifier: answers from a known pairId -> sameEntity map
 * with full confidence and zero cost. Pairs absent from the map are
 * omitted from the result (an unanswerable pair, like a sub-LLM
 * refusing an id).
 */
export function makeOracleAdjudicator(truth: Record<string, boolean>): Adjudicator {
  return async pairs => {
    const results: Record<string, AdjudicationVerdict> = {};
    for (const pair of pairs) {
      const verdict = truth[pair.pairId];
      if (verdict !== undefined) {
        results[pair.pairId] = {
          sameEntity: verdict,
          confidence: 1.0,
          reasoning: 'oracle ground truth',
        };
      }
    }
    return { results, usage: { subcalls: 0, inputTokens: 0, outputTokens: 0 } };
  };
}

/** Real sub-LLM adjudicator; one structured-output completion per batch. */
export function makeOpenAIAdjudicator(model = config.llm.extractionModel): Adjudicator {
  return async pairs => {
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI();
    const payload = pairs.map(p => ({
      pairId: p.pairId,
      kind: p.kind,
      a: { name: p.a.name, type: p.a.type ?? 'unknown', sourceText: p.a.snippet },
      b: { name: p.b.name, type: p.b.type ?? 'unknown', sourceText: p.b.snippet },
    }));
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content:
            'You are a strict entity-resolution adjudicator. For each candidate pair, '
            + 'decide whether the two names denote the SAME real-world entity based on the '
            + 'names, types, and source text. Return one result for every supplied pairId. '
            + 'Different granularities (a company vs its division) are NOT the same entity.',
        },
        {
          role: 'user',
          content:
            `Candidate pairs:\n${JSON.stringify(payload)}\n\n`
            + 'Return results as objects with pairId, sameEntity (boolean), '
            + 'confidence (0 to 1), and brief reasoning.',
        },
      ],
      response_format: zodResponseFormat(AliasAdjudicationSchema, 'alias_adjudication'),
      temperature: 0.1,
    });
    const parsed = parseLlmResponse(
      AliasAdjudicationSchema,
      completion.choices[0].message.content,
      'alias adjudication batch'
    );
    const submitted = new Set(pairs.map(p => p.pairId));
    const results: Record<string, AdjudicationVerdict> = {};
    for (const item of parsed.results) {
      // Only submitted pairIds count; a hallucinated id must not write an edge.
      if (submitted.has(item.pairId)) {
        results[item.pairId] = {
          sameEntity: item.sameEntity,
          confidence: item.confidence,
          reasoning: item.reasoning,
        };
      }
    }
    return {
      results,
      usage: {
        subcalls: 1,
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
      },
    };
  };
}

// --- Verdict edges --------------------------------------------------------------

/** Bound stored on the edge; the full reasoning stays in worker logs. */
const REASONING_CHAR_LIMIT = 500;

export type VerdictMethod = 'llm' | 'oracle';

export interface VerdictParams {
  aId: string;
  bId: string;
  confidence: number;
  method: VerdictMethod;
  model: string | null;
  reasoning: string;
  sourceNodeIds: string[];
}

/**
 * Builds the edge parameters for one adjudicated pair. Canonical
 * direction (smaller entity id first) is re-asserted here so the edge
 * direction never depends on adjudicator output order, and the edge's
 * provenance is the order-preserving union of both endpoints' live
 * sourceNodeIds at adjudication time.
 */
export function buildVerdictParams(
  pair: CandidatePair,
  verdict: AdjudicationVerdict,
  method: VerdictMethod,
  model: string | null
): VerdictParams {
  const [a, b] = pair.a.id < pair.b.id ? [pair.a, pair.b] : [pair.b, pair.a];
  const union = [
    ...a.sourceNodeIds,
    ...b.sourceNodeIds.filter(h => !a.sourceNodeIds.includes(h)),
  ];
  return {
    aId: a.id,
    bId: b.id,
    confidence: verdict.confidence,
    method,
    model,
    reasoning:
      verdict.reasoning.length > REASONING_CHAR_LIMIT
        ? `${verdict.reasoning.slice(0, REASONING_CHAR_LIMIT)}…`
        : verdict.reasoning,
    sourceNodeIds: union,
  };
}

// ON MATCH mirrors ENTITY_MERGE_CYPHER in extraction_merge.ts (the
// applyRederivation transition in provenance.ts): re-adjudicating a
// contested pair from live provenance clears the quarantine, stamps
// rederivedAt, keeps known-dead hashes out of sourceNodeIds, resurrects
// an incoming once-orphaned hash, and preserves contestedAt /
// orphanedSourceIds as audit history. The invalidation sweep contests
// these edges through its generic relationship pass — no new machinery.
function verdictMergeCypher(relType: 'SAME_AS' | 'DISTINCT_FROM'): string {
  return `
  UNWIND $verdicts AS v
  MATCH (a:Entity {id: v.aId})
  MATCH (b:Entity {id: v.bId})
  MERGE (a)-[r:${relType}]->(b)
  ON CREATE SET r.sourceNodeIds = v.sourceNodeIds
  ON MATCH SET
    r.rederivedAt = CASE WHEN coalesce(r.contested, false) THEN timestamp() ELSE r.rederivedAt END,
    r.sourceNodeIds = [h IN coalesce(r.sourceNodeIds, [])
                       WHERE NOT h IN v.sourceNodeIds
                         AND NOT h IN coalesce(r.orphanedSourceIds, [])]
                      + v.sourceNodeIds,
    r.orphanedSourceIds = CASE WHEN r.orphanedSourceIds IS NULL THEN NULL
                               ELSE [h IN r.orphanedSourceIds WHERE NOT h IN v.sourceNodeIds] END,
    r.contested = false
  SET r.confidence = v.confidence,
      r.adjudicatedAt = timestamp(),
      r.method = v.method,
      r.model = v.model,
      r.reasoning = v.reasoning
  RETURN v.aId AS aId
`;
}

export const SAME_AS_MERGE_CYPHER = verdictMergeCypher('SAME_AS');
export const DISTINCT_FROM_MERGE_CYPHER = verdictMergeCypher('DISTINCT_FROM');

/** Writes both verdict polarities in one transaction. */
export async function applyVerdicts(
  driver: Driver,
  sameAs: VerdictParams[],
  distinctFrom: VerdictParams[]
): Promise<void> {
  if (sameAs.length === 0 && distinctFrom.length === 0) return;
  const session = driver.session();
  try {
    const tx = session.beginTransaction();
    try {
      if (sameAs.length > 0) await tx.run(SAME_AS_MERGE_CYPHER, { verdicts: sameAs });
      if (distinctFrom.length > 0) await tx.run(DISTINCT_FROM_MERGE_CYPHER, { verdicts: distinctFrom });
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  } finally {
    await session.close();
  }
}

// --- Adjudication pass ------------------------------------------------------------

export interface ResolutionReport {
  selected: number;
  adjudicated: number;
  same: number;
  distinct: number;
  skippedNoText: number;
  skippedNoAnswer: number;
  usage: ClassifierUsage;
  aliases: Array<{ pairId: string; aName: string; bName: string; confidence: number; signal: CandidateSignal }>;
  distinctPairs: Array<{ pairId: string; aName: string; bName: string; confidence: number }>;
}

/**
 * Adjudicates a candidate batch and writes the verdict edges. Pairs
 * where either endpoint has no live source text are skipped, not
 * guessed: name similarity alone is exactly the evidence class this
 * feature exists to distrust.
 */
export async function resolveCandidatePairs(
  driver: Driver,
  pgPool: Pool,
  pairs: CandidatePair[],
  adjudicator: Adjudicator,
  options: { method: VerdictMethod; model: string | null; batchSize?: number }
): Promise<ResolutionReport> {
  const report: ResolutionReport = {
    selected: pairs.length,
    adjudicated: 0,
    same: 0,
    distinct: 0,
    skippedNoText: 0,
    skippedNoAnswer: 0,
    usage: { subcalls: 0, inputTokens: 0, outputTokens: 0 },
    aliases: [],
    distinctPairs: [],
  };
  if (pairs.length === 0) return report;

  const snippets = await fetchEntitySnippets(pgPool, pairs);
  const adjudicable = pairs.filter(pair => {
    if (snippets.has(pair.a.id) && snippets.has(pair.b.id)) return true;
    report.skippedNoText++;
    return false;
  });

  const sameAs: VerdictParams[] = [];
  const distinctFrom: VerdictParams[] = [];
  const batchSize = options.batchSize ?? config.resolution.batchSize;

  for (let i = 0; i < adjudicable.length; i += batchSize) {
    const batch = adjudicable.slice(i, i + batchSize);
    const contexts: AdjudicationContext[] = batch.map(pair => ({
      pairId: pair.pairId,
      kind: pair.a.kind ?? 'generic',
      a: { name: pair.a.name, type: pair.a.type, snippet: snippets.get(pair.a.id)! },
      b: { name: pair.b.name, type: pair.b.type, snippet: snippets.get(pair.b.id)! },
    }));
    const { results, usage } = await adjudicator(contexts);
    report.usage.subcalls += usage.subcalls;
    report.usage.inputTokens += usage.inputTokens;
    report.usage.outputTokens += usage.outputTokens;
    for (const pair of batch) {
      const verdict = results[pair.pairId];
      if (!verdict) {
        report.skippedNoAnswer++;
        continue;
      }
      report.adjudicated++;
      const params = buildVerdictParams(pair, verdict, options.method, options.model);
      if (verdict.sameEntity) {
        sameAs.push(params);
        report.aliases.push({
          pairId: pair.pairId,
          aName: pair.a.name,
          bName: pair.b.name,
          confidence: verdict.confidence,
          signal: pair.signal,
        });
      } else {
        distinctFrom.push(params);
        report.distinctPairs.push({
          pairId: pair.pairId,
          aName: pair.a.name,
          bName: pair.b.name,
          confidence: verdict.confidence,
        });
      }
    }
  }

  await applyVerdicts(driver, sameAs, distinctFrom);
  report.same = sameAs.length;
  report.distinct = distinctFrom.length;
  return report;
}

// --- Retrieval expansion -----------------------------------------------------------

// One undirected alias hop for /retrieve: non-contested SAME_AS edges at
// or above the confidence floor. Undirected because the canonical edge
// direction is an id-ordering artifact, not a semantic one. The
// non-contested filter is NOT relaxed by ?includeContested — a contested
// equivalence must never silently widen a result set; the quarantined
// edge itself remains inspectable via the graph like any other belief.
export const ALIAS_EXPANSION_CYPHER = `
  MATCH (seed:Entity {name: toLower($entityName)})-[s:SAME_AS]-(alias:Entity)
  WHERE coalesce(s.contested, false) = false
    AND s.confidence >= $minConfidence
  RETURN DISTINCT alias.name AS name, s.confidence AS confidence
`;

export interface ResolvedAlias {
  name: string;
  confidence: number;
}

/** Aliases of one seed entity, per the expansion policy above. */
export async function expandAliases(
  driver: Driver,
  entityName: string,
  minConfidence: number
): Promise<ResolvedAlias[]> {
  const session = driver.session();
  try {
    const res = await session.executeRead(tx =>
      tx.run(ALIAS_EXPANSION_CYPHER, { entityName, minConfidence })
    );
    return res.records.map(rec => ({
      name: rec.get('name') as string,
      confidence: Number(rec.get('confidence')),
    }));
  } finally {
    await session.close();
  }
}
