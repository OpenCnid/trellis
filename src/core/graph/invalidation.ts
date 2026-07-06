import type { Driver } from 'neo4j-driver';

// Phase 4 Milestone 3: the quarantine sweep.
//
// Marks every semantic node and relationship whose sourceNodeIds
// intersect a re-ingest's orphan set as contested. Nothing is deleted —
// the graph is an append-only belief ledger; a contested fact is
// excluded from effective resolution (agent cache reads, /retrieve)
// until it is re-derived from live bytes, and remains inspectable as
// audit history forever (orphanedSourceIds / contestedAt survive
// recovery).
//
// Mixed provenance is contested conservatively: a fact is only as
// trustworthy as its weakest source (partial-provenance survival is
// explicitly out of scope for Phase 4 — see PHASE_4_PRD.md §5). The one
// exception is $fresh: a fact already carrying provenance from a block
// this same re-ingest queued for extraction has BEEN re-derived from
// live bytes, and the sweep must not quarantine it — the extraction
// worker and this sweep race in production, so recovery has to hold in
// either order. Both writers implement the state machine specified (and
// unit-tested for commutativity) in src/core/graph/provenance.ts.

export interface SweepResult {
  contestedNodes: number;
  contestedRelationships: number;
  // Facts that intersected the orphan set but escaped quarantine because
  // a racing re-extraction already gave them fresh live provenance; their
  // dead hashes were still moved into orphanedSourceIds.
  survivedNodes: number;
  survivedRelationships: number;
  batches: number;
  /** Monotonic wall time including session close; benchmark telemetry only. */
  durationMs: number;
  /** Monotonic wall time for each node+relationship Cypher batch. */
  batchDurationsMs: number[];
}

// Bounds the size of the orphan-hash parameter per Cypher call.
const SWEEP_BATCH_SIZE = 500;

// Mirrors applyQuarantineSweep in provenance.ts: dead hashes move from
// sourceNodeIds into orphanedSourceIds, and the fact is quarantined
// unless a surviving source is in this re-ingest's fresh set. All
// derived values are computed in WITH before the SET, so the update is a
// consistent snapshot of the pre-sweep state.
const CONTEST_NODES_CYPHER = `
  MATCH (n)
  WHERE n.sourceNodeIds IS NOT NULL
    AND any(h IN n.sourceNodeIds WHERE h IN $orphaned)
  WITH n,
       [h IN n.sourceNodeIds WHERE NOT h IN $orphaned] AS liveSources,
       [h IN n.sourceNodeIds
        WHERE h IN $orphaned AND NOT h IN coalesce(n.orphanedSourceIds, [])] AS newlyOrphaned
  WITH n, liveSources, newlyOrphaned,
       NOT any(h IN liveSources WHERE h IN $fresh) AS quarantined
  SET n.sourceNodeIds = liveSources,
      n.orphanedSourceIds = coalesce(n.orphanedSourceIds, []) + newlyOrphaned,
      n.contested = CASE WHEN quarantined THEN true ELSE coalesce(n.contested, false) END,
      n.contestedAt = CASE WHEN quarantined THEN coalesce(n.contestedAt, timestamp()) ELSE n.contestedAt END
  RETURN sum(CASE WHEN quarantined THEN 1 ELSE 0 END) AS contested,
         sum(CASE WHEN quarantined THEN 0 ELSE 1 END) AS survived
`;

const CONTEST_RELS_CYPHER = `
  MATCH ()-[r]->()
  WHERE r.sourceNodeIds IS NOT NULL
    AND any(h IN r.sourceNodeIds WHERE h IN $orphaned)
  WITH r,
       [h IN r.sourceNodeIds WHERE NOT h IN $orphaned] AS liveSources,
       [h IN r.sourceNodeIds
        WHERE h IN $orphaned AND NOT h IN coalesce(r.orphanedSourceIds, [])] AS newlyOrphaned
  WITH r, liveSources, newlyOrphaned,
       NOT any(h IN liveSources WHERE h IN $fresh) AS quarantined
  SET r.sourceNodeIds = liveSources,
      r.orphanedSourceIds = coalesce(r.orphanedSourceIds, []) + newlyOrphaned,
      r.contested = CASE WHEN quarantined THEN true ELSE coalesce(r.contested, false) END,
      r.contestedAt = CASE WHEN quarantined THEN coalesce(r.contestedAt, timestamp()) ELSE r.contestedAt END
  RETURN sum(CASE WHEN quarantined THEN 1 ELSE 0 END) AS contested,
         sum(CASE WHEN quarantined THEN 0 ELSE 1 END) AS survived
`;

/**
 * @param orphanedHashes the re-ingest's dead set (Merkle diff old \ new)
 * @param freshHashes the re-ingest's re-derivation set — the block hashes
 *   this version queued for extraction (⊆ diff new \ old, so disjoint from
 *   the orphan set by construction). Callers that have no racing
 *   re-extraction (e.g. the OOLONG deterministic pipeline before its
 *   semantic refresh existed) may omit it for strictly conservative
 *   quarantining.
 */
export async function sweepOrphanedProvenance(
  driver: Driver,
  orphanedHashes: string[],
  freshHashes: string[] = [],
  batchSize: number = SWEEP_BATCH_SIZE,
  clock: () => number = () => performance.now()
): Promise<SweepResult> {
  const startedAt = clock();
  const result: SweepResult = {
    contestedNodes: 0,
    contestedRelationships: 0,
    survivedNodes: 0,
    survivedRelationships: 0,
    batches: 0,
    durationMs: 0,
    batchDurationsMs: []
  };
  if (orphanedHashes.length === 0) {
    result.durationMs = clock() - startedAt;
    return result;
  }

  const session = driver.session();
  try {
    for (let i = 0; i < orphanedHashes.length; i += batchSize) {
      const batchStartedAt = clock();
      const orphaned = orphanedHashes.slice(i, i + batchSize);
      const params = { orphaned, fresh: freshHashes };
      const nodeRes = await session.executeWrite(tx => tx.run(CONTEST_NODES_CYPHER, params));
      const relRes = await session.executeWrite(tx => tx.run(CONTEST_RELS_CYPHER, params));
      result.contestedNodes += nodeRes.records[0].get('contested').toNumber();
      result.survivedNodes += nodeRes.records[0].get('survived').toNumber();
      result.contestedRelationships += relRes.records[0].get('contested').toNumber();
      result.survivedRelationships += relRes.records[0].get('survived').toNumber();
      result.batches++;
      result.batchDurationsMs.push(clock() - batchStartedAt);
    }
  } finally {
    await session.close();
  }
  result.durationMs = clock() - startedAt;
  return result;
}
