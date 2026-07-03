import type { Driver } from 'neo4j-driver';

// Phase 4 Milestone 3: the quarantine sweep.
//
// Marks every semantic node and relationship whose sourceNodeIds
// intersect a re-ingest's orphan set as contested. Nothing is deleted —
// the graph is an append-only belief ledger; a contested fact is
// excluded from effective resolution (agent cache reads, /retrieve)
// until it is re-derived from live bytes, and remains inspectable as
// audit history forever.
//
// Mixed provenance is contested conservatively: a fact is only as
// trustworthy as its weakest source (partial-provenance survival is
// explicitly out of scope for Phase 4 — see PHASE_4_PRD.md §5).

export interface SweepResult {
  contestedNodes: number;
  contestedRelationships: number;
  batches: number;
}

// Bounds the size of the orphan-hash parameter per Cypher call.
const SWEEP_BATCH_SIZE = 500;

const CONTEST_NODES_CYPHER = `
  MATCH (n)
  WHERE n.sourceNodeIds IS NOT NULL
    AND any(h IN n.sourceNodeIds WHERE h IN $orphaned)
  SET n.contested = true,
      n.contestedAt = coalesce(n.contestedAt, timestamp()),
      n.orphanedSourceIds = coalesce(n.orphanedSourceIds, [])
        + [h IN n.sourceNodeIds
           WHERE h IN $orphaned AND NOT h IN coalesce(n.orphanedSourceIds, [])]
  RETURN count(n) AS contested
`;

const CONTEST_RELS_CYPHER = `
  MATCH ()-[r]->()
  WHERE r.sourceNodeIds IS NOT NULL
    AND any(h IN r.sourceNodeIds WHERE h IN $orphaned)
  SET r.contested = true,
      r.contestedAt = coalesce(r.contestedAt, timestamp()),
      r.orphanedSourceIds = coalesce(r.orphanedSourceIds, [])
        + [h IN r.sourceNodeIds
           WHERE h IN $orphaned AND NOT h IN coalesce(r.orphanedSourceIds, [])]
  RETURN count(r) AS contested
`;

export async function sweepOrphanedProvenance(
  driver: Driver,
  orphanedHashes: string[],
  batchSize: number = SWEEP_BATCH_SIZE
): Promise<SweepResult> {
  const result: SweepResult = { contestedNodes: 0, contestedRelationships: 0, batches: 0 };
  if (orphanedHashes.length === 0) return result;

  const session = driver.session();
  try {
    for (let i = 0; i < orphanedHashes.length; i += batchSize) {
      const orphaned = orphanedHashes.slice(i, i + batchSize);
      const nodeRes = await session.executeWrite(tx => tx.run(CONTEST_NODES_CYPHER, { orphaned }));
      const relRes = await session.executeWrite(tx => tx.run(CONTEST_RELS_CYPHER, { orphaned }));
      result.contestedNodes += nodeRes.records[0].get('contested').toNumber();
      result.contestedRelationships += relRes.records[0].get('contested').toNumber();
      result.batches++;
    }
  } finally {
    await session.close();
  }
  return result;
}
