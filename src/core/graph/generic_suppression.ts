import type { Graph, Entity, Action } from './schemas.js';

// Session 25: deterministic generic-identifier suppression (the recorded
// July 6, 2026 pilot finding: the top pilot entity was literally `entity`
// with 14 sources — at repository scale these become mega-hubs that bloat
// retrieval, distort entity resolution, and manufacture a spurious fast
// path to the conditional-migration trigger).
//
// The pillar's lesson applies here as everywhere: prompts request, gates
// enforce. The code-tuned extraction prompt asks the model not to emit
// bare generic identifiers; this filter is what actually guarantees it,
// for BOTH prompts (a document-generic run can hallucinate `entity` too).
// It runs after parseLlmResponse and BEFORE resolveExtractedGraph, so a
// suppressed candidate never becomes a global entity id, never reaches
// the merge Cypher, and never touches existing graph state (Guardrail 2:
// suppression drops extraction candidates — it never deletes nodes).
//
// The denylist and shape rule are kernel-fixed (Guardrail 5). Additions
// are reviewed kernel changes driven by observed suppression counts,
// never env-tunable free text.

export const GENERIC_IDENTIFIER_DENYLIST: ReadonlySet<string> = new Set([
  'entity',
  'entities',
  'name',
  'id',
  'ids',
  'action',
  'actions',
  'data',
  'value',
  'values',
  'key',
  'keys',
  'type',
  'types',
  'item',
  'items',
  'index',
  'object',
  'string',
  'number',
  'result',
  'results',
]);

export const MIN_ENTITY_NAME_LENGTH = 3;

/**
 * The kernel name test: normalized (trimmed, lowercased — matching the
 * globalEntityId normalization) names that are denylisted or shorter
 * than three characters are generic identifiers, never entities.
 */
export function isGenericIdentifierName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized.length < MIN_ENTITY_NAME_LENGTH
    || GENERIC_IDENTIFIER_DENYLIST.has(normalized);
}

export interface SuppressedEntity {
  name: string;
  reason: 'denylisted' | 'short_name';
}

export interface SuppressedAction {
  actionId: string;
  verb: string;
  subjectId: string;
  objectId: string;
  reason: 'suppressed_endpoint' | 'generic_unresolved_endpoint';
}

export interface SuppressionResult {
  graph: Graph;
  suppressedEntities: SuppressedEntity[];
  suppressedActions: SuppressedAction[];
}

/**
 * Pure: drops entities whose name fails the kernel name test, every
 * action referencing a dropped entity, and — closing the laundering hole
 * the resolve step would otherwise open — every action with an
 * unresolved endpoint whose raw id itself fails the name test
 * (resolveExtractedGraph passes unresolved ids through as names, so
 * `subjectId: "entity"` with no matching local entity would MATCH a
 * pre-existing `entity` hub at merge time). Kept entities and actions
 * are returned untouched, in order. Nothing is silent: every drop is
 * itemized for the caller to count and log.
 */
export function suppressGenericIdentifiers(graph: Graph): SuppressionResult {
  const suppressedEntities: SuppressedEntity[] = [];
  const keptEntities: Entity[] = [];
  const keptIds = new Set<string>();
  const droppedIds = new Set<string>();

  for (const entity of graph.entities) {
    if (isGenericIdentifierName(entity.name)) {
      droppedIds.add(entity.id);
      suppressedEntities.push({
        name: entity.name,
        reason: entity.name.trim().length < MIN_ENTITY_NAME_LENGTH ? 'short_name' : 'denylisted',
      });
    } else {
      keptIds.add(entity.id);
      keptEntities.push(entity);
    }
  }

  const suppressedActions: SuppressedAction[] = [];
  const keptActions: Action[] = [];
  for (const action of graph.actions) {
    const endpoints = [action.subjectId, action.objectId];
    if (endpoints.some(endpoint => droppedIds.has(endpoint))) {
      suppressedActions.push({
        actionId: action.id,
        verb: action.verb,
        subjectId: action.subjectId,
        objectId: action.objectId,
        reason: 'suppressed_endpoint',
      });
      continue;
    }
    const genericUnresolved = endpoints.some(
      endpoint => !keptIds.has(endpoint) && isGenericIdentifierName(endpoint)
    );
    if (genericUnresolved) {
      suppressedActions.push({
        actionId: action.id,
        verb: action.verb,
        subjectId: action.subjectId,
        objectId: action.objectId,
        reason: 'generic_unresolved_endpoint',
      });
      continue;
    }
    keptActions.push(action);
  }

  return {
    graph: { entities: keptEntities, actions: keptActions },
    suppressedEntities,
    suppressedActions,
  };
}
