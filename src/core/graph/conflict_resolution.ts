import type { ConflictEvaluation } from './schemas.js';

// The supervisor worker's Cypher and pure helpers, extracted so they are
// importable (and unit-testable) without the worker's side effects
// (BullMQ registration, OpenAI client) — the same pattern as
// extraction_merge.ts.

// Detection: same subject, same verb, two different objects, neither
// relationship already carries a belief state. Ordering by elementId
// (id() is deprecated in Neo4j 5) dedupes the symmetric pair.
export const CONFLICT_ANOMALY_CYPHER = `
  MATCH (subj:Entity)-[r1:ACTION]->(obj1:Entity)
  MATCH (subj)-[r2:ACTION]->(obj2:Entity)
  WHERE r1.verb = r2.verb AND elementId(obj1) < elementId(obj2)
  // Ensure they don't already have a belief state to avoid infinite loops
  AND r1.belief_state IS NULL AND r2.belief_state IS NULL
  RETURN subj, r1, obj1, r2, obj2
`;

// Resolution: branch the two relationships into belief states and record
// WHY as a Conflict node that is reachable from the entities it explains
// (previously the node was created as an orphan):
//
//   (subj)-[:HAS_CONFLICT]->(c:Conflict)
//   (c)-[:CONFLICT_BRANCH {beliefState, actionElementId}]->(obj1 / obj2)
//   (obj1)-[:CONTRADICTS]->(obj2)
//
// Neo4j cannot point an edge at a relationship, so each CONFLICT_BRANCH
// carries the elementId of the ACTION it explains alongside its belief
// state. Every created node/edge carries sourceNodeIds (the architecture
// invariant): each branch inherits its ACTION's provenance, and the
// Conflict node and CONTRADICTS edge carry the union of both sides.
// CONTRADICTS may pre-exist from an earlier conflict; ON CREATE leaves an
// existing edge's provenance as the original audit trail.
export const CONFLICT_RESOLUTION_CYPHER = `
  MATCH (subj:Entity)-[r1:ACTION]->(obj1:Entity)
  MATCH (subj)-[r2:ACTION]->(obj2:Entity)
  WHERE elementId(r1) = $r1Id AND elementId(r2) = $r2Id

  CREATE (c:Conflict {
    reasoning: $reasoning,
    resolutionType: $resolutionType,
    detectedAt: timestamp(),
    sourceNodeIds: $conflictSourceNodeIds
  })
  CREATE (subj)-[:HAS_CONFLICT {sourceNodeIds: $conflictSourceNodeIds}]->(c)
  CREATE (c)-[:CONFLICT_BRANCH {beliefState: 'Belief A', actionElementId: $r1Id, sourceNodeIds: $r1SourceNodeIds}]->(obj1)
  CREATE (c)-[:CONFLICT_BRANCH {beliefState: 'Belief B', actionElementId: $r2Id, sourceNodeIds: $r2SourceNodeIds}]->(obj2)

  MERGE (obj1)-[ct:CONTRADICTS]->(obj2)
  ON CREATE SET ct.sourceNodeIds = $conflictSourceNodeIds

  SET r1.belief_state = 'Belief A'
  SET r2.belief_state = 'Belief B'
`;

export interface ConflictResolutionParams {
  r1Id: string;
  r2Id: string;
  reasoning: string;
  resolutionType: ConflictEvaluation['resolutionType'];
  r1SourceNodeIds: string[];
  r2SourceNodeIds: string[];
  conflictSourceNodeIds: string[];
}

/**
 * Builds the parameter map for CONFLICT_RESOLUTION_CYPHER. The Conflict
 * node's provenance is the order-preserving union of both relationships'
 * sourceNodeIds. resolutionType comes from the (already schema-validated)
 * LLM evaluation — previously it was discarded.
 */
export function conflictResolutionParams(input: {
  r1Id: string;
  r2Id: string;
  evaluation: ConflictEvaluation;
  r1SourceNodeIds: string[];
  r2SourceNodeIds: string[];
}): ConflictResolutionParams {
  const union = [
    ...input.r1SourceNodeIds,
    ...input.r2SourceNodeIds.filter(h => !input.r1SourceNodeIds.includes(h))
  ];
  return {
    r1Id: input.r1Id,
    r2Id: input.r2Id,
    reasoning: input.evaluation.reasoning,
    resolutionType: input.evaluation.resolutionType,
    r1SourceNodeIds: input.r1SourceNodeIds,
    r2SourceNodeIds: input.r2SourceNodeIds,
    conflictSourceNodeIds: union,
  };
}

/**
 * Text of one ast_nodes row's JSONB payload, for the evaluation prompt.
 * Preserves the historical fallback order: markdown nodes carry `value`,
 * PDF elements carry `text`, anything else falls back to raw JSON.
 */
export function astRowText(data: { value?: string; text?: string } | null | undefined): string {
  return data?.value || data?.text || JSON.stringify(data);
}

/**
 * Joins fetched AST block texts with a real newline. (The worker
 * previously joined with the two-character literal `"\n"`, which fed the
 * LLM one run-on line with stray backslashes.)
 */
export function joinAstTexts(rows: Array<{ data: { value?: string; text?: string } }>): string {
  return rows.map(row => astRowText(row.data)).join('\n');
}
