import * as crypto from 'crypto';
import type { Graph, Entity } from './schemas.js';
import type { EnrichedAction } from './extraction_merge.js';

// The extraction LLM emits entities with local (per-completion) ids and
// actions that reference those ids. This module resolves them to the
// global deterministic identity used across the graph, and — Guideline 1
// (no silent data loss) — reports every action endpoint that failed to
// resolve instead of letting it vanish inside the merge Cypher.
//
// Unresolved actions are still returned for merging: the raw id is passed
// through as the endpoint *name*, and the merge's MATCH-by-name can still
// hit a pre-existing Entity when the LLM used the entity's name where its
// local id belonged. The definitive drop check happens after the merge, by
// diffing submitted action ids against the ids the merge Cypher returns.

/** Global entity identity: SHA-256 of the lowercased name. */
export function globalEntityId(name: string): string {
  return crypto.createHash('sha256').update(name.toLowerCase()).digest('hex');
}

export type UnresolvedEndpoint = 'subject' | 'object';

export interface UnresolvedAction {
  actionId: string;
  verb: string;
  subjectId: string;
  objectId: string;
  unresolved: UnresolvedEndpoint[];
}

export interface ResolvedGraph {
  /** Entities with ids replaced by their global deterministic hash. */
  entities: Entity[];
  /** All actions (including unresolved ones), enriched for the merge Cypher. */
  actions: EnrichedAction[];
  /** Actions whose subject/object id matched no entity in this extraction. */
  unresolved: UnresolvedAction[];
}

/** Pure: does not mutate the input graph. */
export function resolveExtractedGraph(graph: Graph): ResolvedGraph {
  const localToGlobal = new Map<string, string>();
  const localToName = new Map<string, string>();

  const entities = graph.entities.map(ent => {
    const globalId = globalEntityId(ent.name);
    localToGlobal.set(ent.id, globalId);
    localToName.set(ent.id, ent.name);
    return { ...ent, id: globalId };
  });

  const actions: EnrichedAction[] = [];
  const unresolved: UnresolvedAction[] = [];

  for (const act of graph.actions) {
    const missing: UnresolvedEndpoint[] = [];
    if (!localToGlobal.has(act.subjectId)) missing.push('subject');
    if (!localToGlobal.has(act.objectId)) missing.push('object');

    actions.push({
      ...act,
      subjectId: localToGlobal.get(act.subjectId) ?? act.subjectId,
      objectId: localToGlobal.get(act.objectId) ?? act.objectId,
      subjectName: localToName.get(act.subjectId) ?? act.subjectId,
      objectName: localToName.get(act.objectId) ?? act.objectId,
    });

    if (missing.length > 0) {
      unresolved.push({
        actionId: act.id,
        verb: act.verb,
        subjectId: act.subjectId,
        objectId: act.objectId,
        unresolved: missing,
      });
    }
  }

  return { entities, actions, unresolved };
}
