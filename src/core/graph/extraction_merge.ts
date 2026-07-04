import type { Driver } from 'neo4j-driver';
import type { Entity } from './schemas.js';

// The extraction worker's Neo4j merge, extracted so the Cypher is
// importable without the worker's side effects (BullMQ registration,
// OpenAI client) — scripts/test_belief_recovery.ts exercises exactly
// this code against a live graph.
//
// ON MATCH mirrors applyRederivation in provenance.ts (the same
// un-contest-on-rederive semantics the RLM's write_derived_insight has
// carried since Phase 5 — closing the asymmetry where extraction-produced
// facts, unlike RLM-derived ones, stayed quarantined forever after being
// re-extracted from live bytes):
//
//   * incoming sourceNodeIds are live by construction (the worker checks
//     the block against the document registry before calling this);
//   * previously recorded sources the ledger knows are dead stay out of
//     the live set; an incoming hash that was once orphaned is
//     resurrected (a reverted document re-creates the old content hash);
//   * contested clears — re-derivation from live bytes is the recovery
//     the quarantine comment in invalidation.ts promises — while
//     contestedAt/orphanedSourceIds remain as audit history and
//     rederivedAt records the recovery;
//   * the invalidation sweep races these writes in production; the two
//     transitions commute (proved in provenance.test.ts), so the final
//     state is order-independent.
//
// SET items are ordered so every right-hand side reads pre-update values
// (each property is only read by items listed before the one that writes
// it), keeping the provenance fields a consistent snapshot regardless of
// SET evaluation order.

export const ENTITY_MERGE_CYPHER = `
  UNWIND $entities AS ent
  MERGE (e:Entity {name: toLower(ent.name)})
  ON CREATE SET e.id = ent.id, e.type = ent.type, e.sourceNodeIds = ent.sourceNodeIds
  ON MATCH SET
    e.rederivedAt = CASE WHEN coalesce(e.contested, false) THEN timestamp() ELSE e.rederivedAt END,
    e.sourceNodeIds = [h IN coalesce(e.sourceNodeIds, [])
                       WHERE NOT h IN ent.sourceNodeIds
                         AND NOT h IN coalesce(e.orphanedSourceIds, [])]
                      + ent.sourceNodeIds,
    e.orphanedSourceIds = CASE WHEN e.orphanedSourceIds IS NULL THEN NULL
                               ELSE [h IN e.orphanedSourceIds WHERE NOT h IN ent.sourceNodeIds] END,
    e.contested = false
`;

export const ACTION_MERGE_CYPHER = `
  UNWIND $actions AS act
  MATCH (subj:Entity {name: toLower(act.subjectName)})
  MATCH (obj:Entity {name: toLower(act.objectName)})
  MERGE (subj)-[r:ACTION {verb: toLower(act.verb)}]->(obj)
  ON CREATE SET r.id = act.id, r.sourceNodeIds = act.sourceNodeIds
  ON MATCH SET
    r.rederivedAt = CASE WHEN coalesce(r.contested, false) THEN timestamp() ELSE r.rederivedAt END,
    r.sourceNodeIds = [h IN coalesce(r.sourceNodeIds, [])
                       WHERE NOT h IN act.sourceNodeIds
                         AND NOT h IN coalesce(r.orphanedSourceIds, [])]
                      + act.sourceNodeIds,
    r.orphanedSourceIds = CASE WHEN r.orphanedSourceIds IS NULL THEN NULL
                               ELSE [h IN r.orphanedSourceIds WHERE NOT h IN act.sourceNodeIds] END,
    r.contested = false
`;

export interface EnrichedAction {
  id: string;
  verb: string;
  subjectName: string;
  objectName: string;
  sourceNodeIds: string[];
  // Retained from the raw extraction for parameter completeness.
  subjectId: string;
  objectId: string;
}

/** Merges one extraction job's entities and actions in a single transaction. */
export async function mergeExtractedGraph(
  driver: Driver,
  entities: Entity[],
  actions: EnrichedAction[]
): Promise<void> {
  const session = driver.session();
  try {
    const tx = session.beginTransaction();
    try {
      await tx.run(ENTITY_MERGE_CYPHER, { entities });
      await tx.run(ACTION_MERGE_CYPHER, { actions });
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  } finally {
    await session.close();
  }
}
