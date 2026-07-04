import type { Driver } from 'neo4j-driver';
import { OolongDataset } from './schema';
import { CURRENT_RUBRIC_VERSION, mulberry32 } from '../../core/graph/verification';

// Phase 5 Milestone 4: cache poisoning — the "original sin" injector.
//
// The Update Drill poisoned the cache by CHANGING BYTES; Phase 4's
// Merkle machinery caught every one. This module poisons the cache
// WITHOUT touching a byte: cached has_category labels are flipped in
// place by direct Cypher, keeping the original (still-live) provenance
// and stamping HIGH confidence — a belief that was born wrong, which is
// undetectable by Phase 4 by construction. Only the Phase 5 verifier
// can catch it.

export interface PoisonedEdge {
  id: string; // question id (Entity name)
  trueLabel: string; // lowercase TREC label per ground truth
  poisonedLabel: string; // lowercase wrong label written to the cache
  confidence: number; // high stored confidence (worst case)
}

export interface PoisonManifest {
  dataset: string;
  seed: number;
  poison_count: number;
  confidence: number;
  poisoned: PoisonedEdge[];
  poisoned_at: string;
}

// Plausible wrong label per true label — the confusable boundaries the
// critique doc calls out (a weak classifier's actual failure modes).
const CONFUSABLE_FLIP: Record<string, string> = {
  loc: 'enty',
  enty: 'loc',
  hum: 'desc',
  desc: 'enty',
  num: 'enty',
  abbr: 'desc'
};

const SEED_CACHE_CYPHER = `
  UNWIND $facts AS f
  MATCH (q:Question {id: f.id})
  MERGE (s:Entity {name: f.id})
  MERGE (o:Entity {name: f.label})
  MERGE (s)-[r:DERIVED_INSIGHT {verb: 'has_category'}]->(o)
  SET s.kind = 'question',
      o.kind = 'category_label',
      s.sourceNodeIds = q.sourceNodeIds,
      r.sourceNodeIds = q.sourceNodeIds,
      r.confidence = f.confidence,
      r.rubricVersion = $rubricVersion,
      r.derivedAt = timestamp(),
      r.verified_count = f.verifiedCount,
      r.contested = false
  RETURN count(r) AS written
`;

/**
 * LLM-free warm-up for dress rehearsals: wipes the has_category cache
 * for the dataset's questions and re-seeds it from ground truth with
 * uniform confidence, exactly the state a clean real Act-1 run leaves
 * behind (every question classified correctly, verified_count 0).
 * Provenance comes from each :Question node's own sourceNodeIds — the
 * same hashes the agent protocol uses.
 */
export async function seedVerifiedCache(
  driver: Driver,
  dataset: OolongDataset,
  opts: { confidence?: number; verifiedCount?: number } = {}
): Promise<{ wiped: number; seeded: number }> {
  const confidence = opts.confidence ?? 0.9;
  const verifiedCount = opts.verifiedCount ?? 0;
  const ids = dataset.records.map(r => r.id);
  const session = driver.session();
  try {
    const wipe = await session.executeWrite(tx =>
      tx.run(
        `MATCH (s:Entity)-[r:DERIVED_INSIGHT {verb: 'has_category'}]->()
         WHERE s.name IN $ids
         DELETE r RETURN count(r) AS wiped`,
        { ids }
      )
    );
    const facts = dataset.records.map(r => ({
      id: r.id,
      label: r.category.toLowerCase(),
      confidence,
      verifiedCount
    }));
    const seed = await session.executeWrite(tx =>
      tx.run(SEED_CACHE_CYPHER, { facts, rubricVersion: CURRENT_RUBRIC_VERSION })
    );
    const seeded = seed.records[0].get('written').toNumber();
    if (seeded !== dataset.records.length) {
      throw new Error(
        `Seeded ${seeded}/${dataset.records.length} beliefs — is the corpus ingested? (npm run oolong:ingest / drill re-ingest)`
      );
    }
    return { wiped: wipe.records[0].get('wiped').toNumber(), seeded };
  } finally {
    await session.close();
  }
}

/** Deletes every has_category edge for the dataset's questions — used to
 *  force a genuinely cold start before a REAL (non-oracle) Act 1
 *  warm-up, so the agent's sub-LLM confidences are its own, not a
 *  carry-over from a prior run. */
export async function wipeHasCategoryEdges(driver: Driver, dataset: OolongDataset): Promise<number> {
  const session = driver.session();
  try {
    const res = await session.executeWrite(tx =>
      tx.run(
        `MATCH (s:Entity)-[r:DERIVED_INSIGHT {verb: 'has_category'}]->()
         WHERE s.name IN $ids
         DELETE r RETURN count(r) AS wiped`,
        { ids: dataset.records.map(r => r.id) }
      )
    );
    return res.records[0].get('wiped').toNumber();
  } finally {
    await session.close();
  }
}

export interface BeliefSnapshotEntry {
  id: string;
  label: string;
  confidence: number | null;
  rubricVersion: number | null;
  sourceNodeIds: string[];
}

/** Captures the has_category belief exactly as a real Act 1 left it —
 *  genuine sub-LLM confidences and all — so every policy experiment in
 *  the drill can start from the identical real-warm-up state without
 *  re-paying for a fresh cold classification pass per policy. */
export async function snapshotBeliefs(driver: Driver, dataset: OolongDataset): Promise<BeliefSnapshotEntry[]> {
  const session = driver.session();
  try {
    const res = await session.executeRead(tx =>
      tx.run(
        `MATCH (s:Entity)-[r:DERIVED_INSIGHT {verb: 'has_category'}]->(o:Entity)
         WHERE s.name IN $ids AND coalesce(r.contested, false) = false
         RETURN s.name AS id, o.name AS label, r.confidence AS confidence,
                r.rubricVersion AS rubricVersion, r.sourceNodeIds AS sourceNodeIds`,
        { ids: dataset.records.map(r => r.id) }
      )
    );
    return res.records.map(rec => ({
      id: rec.get('id'),
      label: rec.get('label'),
      confidence: rec.get('confidence') == null ? null : Number(rec.get('confidence')),
      rubricVersion: rec.get('rubricVersion') == null ? null : Number(rec.get('rubricVersion')),
      sourceNodeIds: (rec.get('sourceNodeIds') as string[] | null) ?? []
    }));
  } finally {
    await session.close();
  }
}

const RESTORE_CYPHER = `
  UNWIND $beliefs AS b
  MATCH (s:Entity {name: b.id})
  OPTIONAL MATCH (s)-[old:DERIVED_INSIGHT {verb: 'has_category'}]->()
  DELETE old
  WITH s, b
  MERGE (o:Entity {name: b.label}) SET o.kind = 'category_label'
  MERGE (s)-[r:DERIVED_INSIGHT {verb: 'has_category'}]->(o)
  SET r.confidence = b.confidence,
      r.rubricVersion = b.rubricVersion,
      r.sourceNodeIds = b.sourceNodeIds,
      r.verified_count = 0,
      r.contested = false,
      r.derivedAt = timestamp()
  RETURN count(r) AS restored
`;

/** Resets every dataset question's has_category edge to a captured
 *  snapshot — the real-Act-1 analog of seedVerifiedCache's oracle seed,
 *  giving each policy experiment an identical real-warm-up starting
 *  point without re-running the paid cold sequence per policy. */
export async function restoreBeliefsFromSnapshot(
  driver: Driver,
  snapshot: BeliefSnapshotEntry[]
): Promise<{ restored: number }> {
  const session = driver.session();
  try {
    const res = await session.executeWrite(tx => tx.run(RESTORE_CYPHER, { beliefs: snapshot }));
    return { restored: res.records[0].get('restored').toNumber() };
  } finally {
    await session.close();
  }
}

// The flip preserves everything that makes the belief look legitimate:
// the original edge's provenance (bytes still live — Merkle-valid) and
// derivedAt. Only the target label and the (high) confidence change,
// and verified_count starts at 0: a fresh, confident, wrong belief.
const POISON_CYPHER = `
  UNWIND $poisons AS p
  MATCH (s:Entity {name: p.id})-[old:DERIVED_INSIGHT {verb: 'has_category'}]->(:Entity)
  WHERE coalesce(old.contested, false) = false
  WITH s, p, collect(old) AS olds
  WHERE size(olds) > 0
  WITH s, p, olds, olds[0].sourceNodeIds AS provenance, olds[0].derivedAt AS derivedAt
  FOREACH (o IN olds | DELETE o)
  MERGE (t:Entity {name: p.poisonedLabel})
  SET t.kind = 'category_label'
  MERGE (s)-[r:DERIVED_INSIGHT {verb: 'has_category'}]->(t)
  SET r.sourceNodeIds = provenance,
      r.derivedAt = coalesce(derivedAt, timestamp()),
      r.confidence = p.confidence,
      r.rubricVersion = $rubricVersion,
      r.verified_count = 0,
      r.contested = false
  RETURN count(r) AS flipped
`;

/**
 * Flips `count` cached has_category labels in place (seeded, therefore
 * reproducible) and returns the manifest recording every poisoned edge.
 */
export async function poisonCache(
  driver: Driver,
  dataset: OolongDataset,
  opts: { count?: number; seed?: number; confidence?: number } = {}
): Promise<PoisonManifest> {
  const count = opts.count ?? 11;
  const seed = opts.seed ?? 4242;
  const confidence = opts.confidence ?? 0.97;

  const random = mulberry32(seed);
  const shuffled = [...dataset.records]
    .map(r => ({ r, key: random() }))
    .sort((a, b) => a.key - b.key)
    .map(x => x.r);
  const victims = shuffled.slice(0, count);

  const poisoned: PoisonedEdge[] = victims.map(v => {
    const trueLabel = v.category.toLowerCase();
    return { id: v.id, trueLabel, poisonedLabel: CONFUSABLE_FLIP[trueLabel], confidence };
  });

  const session = driver.session();
  try {
    const res = await session.executeWrite(tx =>
      tx.run(POISON_CYPHER, { poisons: poisoned, rubricVersion: CURRENT_RUBRIC_VERSION })
    );
    const flipped = res.records[0]?.get('flipped').toNumber() ?? 0;
    if (flipped !== poisoned.length) {
      throw new Error(`Flipped ${flipped}/${poisoned.length} edges — cache not fully warm for this dataset?`);
    }
  } finally {
    await session.close();
  }

  return {
    dataset: dataset.name,
    seed,
    poison_count: count,
    confidence,
    poisoned,
    poisoned_at: new Date().toISOString()
  };
}

export interface PoisonDetectionAudit {
  poisoned_total: number;
  detected: number; // contested with contestedReason 'disputed'
  recall: number;
  detected_ids: string[];
  undetected_ids: string[];
  /** Correct (non-poisoned) beliefs disputed by the verifier. */
  false_disputes: number;
  false_dispute_ids: string[];
  /** Denominator context for the false-dispute rate. */
  clean_beliefs: number;
}

/** Measures detection state against the manifest — recall must be read
 *  HERE (recovery legitimately clears quarantines afterwards). */
export async function auditPoisonDetection(
  driver: Driver,
  dataset: OolongDataset,
  manifest: PoisonManifest
): Promise<PoisonDetectionAudit> {
  const session = driver.session();
  try {
    const res = await session.executeRead(tx =>
      tx.run(
        `UNWIND $poisons AS p
         MATCH (s:Entity {name: p.id})-[r:DERIVED_INSIGHT {verb: 'has_category'}]->(o:Entity {name: p.poisonedLabel})
         RETURN p.id AS id,
                coalesce(r.contested, false) AND r.contestedReason = 'disputed' AS detected`,
        { poisons: manifest.poisoned }
      )
    );
    const detectedIds: string[] = [];
    const undetectedIds: string[] = [];
    for (const rec of res.records) {
      (rec.get('detected') ? detectedIds : undetectedIds).push(rec.get('id'));
    }
    // A poisoned edge that disappeared entirely would be a bug — count it
    // as undetected so recall reflects it.
    const seen = new Set([...detectedIds, ...undetectedIds]);
    for (const p of manifest.poisoned) if (!seen.has(p.id)) undetectedIds.push(p.id);

    // False disputes: disputed beliefs that were actually CORRECT.
    const truthByid = new Map(dataset.records.map(r => [r.id, r.category.toLowerCase()]));
    const poisonedIds = new Set(manifest.poisoned.map(p => p.id));
    const disputes = await session.executeRead(tx =>
      tx.run(
        `MATCH (s:Entity {kind: 'question'})-[r:DERIVED_INSIGHT {verb: 'has_category'}]->(o:Entity)
         WHERE r.contestedReason = 'disputed' AND coalesce(r.contested, false) = true
         RETURN s.name AS id, o.name AS label`
      )
    );
    const falseDisputeIds = disputes.records
      .filter(rec => !poisonedIds.has(rec.get('id')) && truthByid.get(rec.get('id')) === rec.get('label'))
      .map(rec => rec.get('id') as string);

    return {
      poisoned_total: manifest.poisoned.length,
      detected: detectedIds.length,
      recall: manifest.poisoned.length === 0 ? 1 : detectedIds.length / manifest.poisoned.length,
      detected_ids: detectedIds.sort(),
      undetected_ids: undetectedIds.sort(),
      false_disputes: falseDisputeIds.length,
      false_dispute_ids: falseDisputeIds.sort(),
      clean_beliefs: dataset.records.length - manifest.poisoned.length
    };
  } finally {
    await session.close();
  }
}

/** Effective (non-contested) cached category per question id. */
export async function effectiveCategories(driver: Driver, dataset: OolongDataset): Promise<Map<string, string>> {
  const session = driver.session();
  try {
    const res = await session.executeRead(tx =>
      tx.run(
        `MATCH (s:Entity)-[r:DERIVED_INSIGHT {verb: 'has_category'}]->(o:Entity)
         WHERE s.name IN $ids AND coalesce(r.contested, false) = false
         RETURN s.name AS id, o.name AS label`,
        { ids: dataset.records.map(r => r.id) }
      )
    );
    const map = new Map<string, string>();
    for (const rec of res.records) map.set(rec.get('id'), String(rec.get('label')).toUpperCase());
    return map;
  } finally {
    await session.close();
  }
}
