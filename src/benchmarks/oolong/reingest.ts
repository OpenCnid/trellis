import * as crypto from 'crypto';
import { OolongDataset } from './schema';
import { buildCorpus, flattenAST, BoundRecord } from './corpus';
import { pgPool, neo4jDriver } from '../../config/db';
import { diffVersions, MerkleDiff } from '../../core/ast/diff';
import { registerDocumentVersion, recordDocumentNodes } from '../../core/ast/registry';
import { sweepOrphanedProvenance, SweepResult } from '../../core/graph/invalidation';
import { DrillManifest } from './mutate';

// Phase 4 Milestone 4, Act 3: versioned re-ingestion of the OOLONG
// corpus through the registry + Merkle diff + quarantine sweep.
//
// The OOLONG corpus enters the system through the deterministic
// ingestion loop (scripts/ingest_oolong_dataset.ts), not the LLM
// extraction pipeline — so the versioned flow reuses the same Phase 4
// modules /ingest uses (registry, diff, sweep) but refreshes the
// deterministic semantic layer for changed records itself.

export const DRILL_DOC_KEY = 'oolong-corpus';

export interface ReingestTelemetry {
  docKey: string;
  fromVersion: number | null;
  toVersion: number;
  rootHash: string;
  totalNodes: number;
  totalLeaves: number;
  totalRecords: number;
  diff: { added: number; orphaned: number; retained: number } | null;
  addedLeaves: number;
  changedRecords: string[];
  // The Merkle discount, PRD Milestone 4 metric #1
  reprocessing_ratio_records: number;
  reprocessing_ratio_leaves: number;
  sweep: SweepResult;
}

function conceptGlobalId(name: string): string {
  return crypto.createHash('sha256').update(name.toLowerCase()).digest('hex');
}

const isLeaf = (n: { content?: string }) => n.content !== undefined && n.content !== '';

// Persists the version's AST nodes + membership rows and registers the
// version, mirroring the /ingest transaction.
async function persistVersion(docKey: string, rootHash: string, allNodes: ReturnType<typeof flattenAST>) {
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    for (const node of allNodes) {
      await client.query(
        `INSERT INTO ast_nodes (id, document_id, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
        [node.id, rootHash, JSON.stringify(node)]
      );
    }
    await recordDocumentNodes(client, rootHash, allNodes.map(n => n.id));
    const registration = await registerDocumentVersion(client, docKey, rootHash);
    await client.query('COMMIT');
    return registration;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Deterministic semantic refresh for changed records: Question text and
// sourceNodeIds are replaced with the new parser-derived hashes so the
// Question node itself is never left pointing at dead bytes. Categories
// are STRIPPED (drill state: classification is the flywheel's job — the
// re-ingest must not leak ground truth for exactly the mutated rows).
// REFERENCES edges of changed records get the new paragraph hash
// appended; since the sweep receives diff.added as its fresh set, these
// re-derived edges keep their recovery (dead hashes move into
// orphanedSourceIds, contested stays clear) — the same order-independent
// semantics production's extraction worker gets. Facts NOT re-anchored
// here (cached has_category insights) are quarantined as before.
async function refreshSemanticLayer(changed: BoundRecord[], stripCategory: boolean): Promise<void> {
  if (changed.length === 0) return;

  const questions = changed.map(b => ({
    id: b.record.id,
    text: b.record.text,
    category: b.record.category,
    sourceNodeIds: [b.paragraph.id, b.heading.id]
  }));
  const concepts = changed.flatMap(b =>
    b.record.concepts.map(name => ({
      id: conceptGlobalId(name),
      name: name.toLowerCase(),
      sourceNodeIds: [b.paragraph.id]
    }))
  );
  const references = changed.flatMap(b =>
    b.record.concepts.map(name => ({
      questionId: b.record.id,
      conceptId: conceptGlobalId(name),
      sourceNodeIds: [b.paragraph.id]
    }))
  );

  const session = neo4jDriver.session();
  try {
    const tx = session.beginTransaction();
    await tx.run(
      stripCategory
        ? `UNWIND $questions AS q
           MERGE (n:Question {id: q.id})
           SET n.text = q.text, n.sourceNodeIds = q.sourceNodeIds
           REMOVE n.category`
        : `UNWIND $questions AS q
           MERGE (n:Question {id: q.id})
           SET n.text = q.text, n.category = q.category, n.sourceNodeIds = q.sourceNodeIds`,
      { questions }
    );
    await tx.run(
      `UNWIND $concepts AS c
       MERGE (n:Concept {id: c.id})
       ON CREATE SET n.name = c.name, n.sourceNodeIds = c.sourceNodeIds
       ON MATCH SET n.sourceNodeIds = n.sourceNodeIds + [id IN c.sourceNodeIds WHERE NOT id IN n.sourceNodeIds]`,
      { concepts }
    );
    await tx.run(
      `UNWIND $references AS r
       MATCH (q:Question {id: r.questionId})
       MATCH (c:Concept {id: r.conceptId})
       MERGE (q)-[e:REFERENCES]->(c)
       ON CREATE SET e.sourceNodeIds = r.sourceNodeIds
       ON MATCH SET e.sourceNodeIds = e.sourceNodeIds + [id IN r.sourceNodeIds WHERE NOT id IN e.sourceNodeIds]`,
      { references }
    );
    await tx.commit();
  } finally {
    await session.close();
  }
}

export interface ReingestOptions {
  docKey?: string;
  // Drill default: never write ground-truth categories onto Question
  // nodes — classification must stay the flywheel's job.
  stripCategory?: boolean;
}

export async function reingestDataset(dataset: OolongDataset, opts: ReingestOptions = {}): Promise<ReingestTelemetry> {
  const docKey = opts.docKey ?? DRILL_DOC_KEY;
  const stripCategory = opts.stripCategory ?? true;

  const corpus = buildCorpus(dataset.records);
  const allNodes = flattenAST(corpus.root);
  const totalLeaves = allNodes.filter(isLeaf).length;

  const registration = await persistVersion(docKey, corpus.root.id, allNodes);
  const fromVersion = registration.priorRootHash ? registration.version - 1 : null;

  let diff: MerkleDiff | null = null;
  let changed: BoundRecord[] = [];
  let sweep: SweepResult = {
    contestedNodes: 0,
    contestedRelationships: 0,
    survivedNodes: 0,
    survivedRelationships: 0,
    batches: 0
  };
  let addedLeaves = 0;

  if (registration.priorRootHash) {
    diff = await diffVersions(pgPool, registration.priorRootHash, corpus.root.id);
    const addedSet = new Set(diff.added);
    addedLeaves = allNodes.filter(n => isLeaf(n) && addedSet.has(n.id)).length;
    // A record changed iff any of its block hashes are new. Refresh the
    // semantic layer BEFORE the sweep so refreshed Question nodes carry
    // live provenance when the sweep runs.
    changed = corpus.bound.filter(b => addedSet.has(b.paragraph.id) || addedSet.has(b.heading.id));
    await refreshSemanticLayer(changed, stripCategory);
    if (diff.orphaned.length > 0) {
      // diff.added is the fresh set: facts the refresh above already
      // re-anchored to this version's live bytes (Question nodes,
      // refreshed REFERENCES edges) survive the sweep; stale cached
      // beliefs (has_category insights citing dead hashes) are
      // quarantined. Mirrors what /ingest passes in production.
      sweep = await sweepOrphanedProvenance(neo4jDriver, diff.orphaned, diff.added);
    }
  }
  // Adopt path (fromVersion === null): the corpus was already ingested
  // by scripts/ingest_oolong_dataset.ts — this run only registers the
  // version + membership so the next re-ingest has something to diff.

  return {
    docKey,
    fromVersion,
    toVersion: registration.version,
    rootHash: corpus.root.id,
    totalNodes: allNodes.length,
    totalLeaves,
    totalRecords: corpus.bound.length,
    diff: diff ? { added: diff.added.length, orphaned: diff.orphaned.length, retained: diff.retained.length } : null,
    addedLeaves,
    changedRecords: changed.map(b => b.record.id).sort(),
    reprocessing_ratio_records: changed.length / corpus.bound.length,
    reprocessing_ratio_leaves: totalLeaves === 0 ? 0 : addedLeaves / totalLeaves,
    sweep
  };
}

export interface InvalidationAudit {
  affected: number;             // manifest questions that had a cached has_category edge
  affected_contested: number;   // ...of those, how many the sweep quarantined
  total_contested: number;      // all quarantined has_category edges
  recall: number;               // affected_contested / affected  (target: 1.00)
  precision: number;            // affected_contested / total_contested (target: >= 0.95)
  missed_ids: string[];
  false_positive_ids: string[];
}

// PRD Milestone 4 metrics #2/#3. Run this BETWEEN the sweep (Act 3) and
// the post-update queries (Act 4): Act 4 legitimately clears quarantines
// by re-deriving, which would mask what the sweep actually caught.
export async function auditInvalidation(manifest: DrillManifest): Promise<InvalidationAudit> {
  const affectedIds = new Set(manifest.mutations.map(m => m.id.toLowerCase()));
  const session = neo4jDriver.session();
  let rows: Array<{ qid: string; contested: boolean }>;
  try {
    const res = await session.run(
      `MATCH (s:Entity)-[r:DERIVED_INSIGHT]->(:Entity)
       WHERE r.verb = 'has_category'
       RETURN s.name AS qid, coalesce(r.contested, false) AS contested`
    );
    rows = res.records.map(r => ({ qid: r.get('qid'), contested: r.get('contested') }));
  } finally {
    await session.close();
  }

  const cachedIds = new Set(rows.map(r => r.qid));
  const contestedRows = rows.filter(r => r.contested);
  const affectedWithCache = [...affectedIds].filter(id => cachedIds.has(id));
  const affectedContested = contestedRows.filter(r => affectedIds.has(r.qid));
  const falsePositives = contestedRows.filter(r => !affectedIds.has(r.qid));

  return {
    affected: affectedWithCache.length,
    affected_contested: affectedContested.length,
    total_contested: contestedRows.length,
    recall: affectedWithCache.length === 0 ? 1 : affectedContested.length / affectedWithCache.length,
    precision: contestedRows.length === 0 ? 1 : affectedContested.length / contestedRows.length,
    missed_ids: affectedWithCache.filter(id => !affectedContested.some(r => r.qid === id)).sort(),
    false_positive_ids: falsePositives.map(r => r.qid).sort()
  };
}
