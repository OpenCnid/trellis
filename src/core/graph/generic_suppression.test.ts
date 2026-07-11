import { describe, expect, it } from 'vitest';
import {
  GENERIC_IDENTIFIER_DENYLIST,
  isGenericIdentifierName,
  suppressGenericIdentifiers,
} from './generic_suppression';
import type { Graph } from './schemas';

function entity(id: string, name: string) {
  return { id, name, type: 'concept', sourceNodeIds: ['a'.repeat(64)] };
}

function action(id: string, subjectId: string, verb: string, objectId: string) {
  return { id, subjectId, verb, objectId, sourceNodeIds: ['a'.repeat(64)] };
}

describe('isGenericIdentifierName', () => {
  it('rejects every recorded pilot offender', () => {
    // The July 6, 2026 pilot's top entities were literally these.
    for (const name of ['entity', 'name', 'id', 'action']) {
      expect(isGenericIdentifierName(name)).toBe(true);
    }
  });

  it('rejects the full kernel denylist case-insensitively with whitespace', () => {
    for (const name of GENERIC_IDENTIFIER_DENYLIST) {
      expect(isGenericIdentifierName(name)).toBe(true);
      expect(isGenericIdentifierName(name.toUpperCase())).toBe(true);
      expect(isGenericIdentifierName(`  ${name} `)).toBe(true);
    }
  });

  it('rejects names shorter than three characters (the shape rule)', () => {
    expect(isGenericIdentifierName('')).toBe(true);
    expect(isGenericIdentifierName('x')).toBe(true);
    expect(isGenericIdentifierName('ab')).toBe(true);
    expect(isGenericIdentifierName('  a  ')).toBe(true);
  });

  it('accepts qualified and specific names', () => {
    expect(isGenericIdentifierName('planExtraction')).toBe(false);
    expect(isGenericIdentifierName('extraction_queue')).toBe(false);
    expect(isGenericIdentifierName('entity kind')).toBe(false);
    expect(isGenericIdentifierName('globalentityid')).toBe(false);
    expect(isGenericIdentifierName('sha-256 hash')).toBe(false);
  });
});

describe('suppressGenericIdentifiers', () => {
  it('drops denylisted and short entities with itemized reasons', () => {
    const graph: Graph = {
      entities: [
        entity('e1', 'entity'),
        entity('e2', 'planExtraction'),
        entity('e3', 'id'),
        entity('e4', 'x'),
      ],
      actions: [],
    };
    const result = suppressGenericIdentifiers(graph);
    expect(result.graph.entities.map(e => e.name)).toEqual(['planExtraction']);
    expect(result.suppressedEntities).toEqual([
      { name: 'entity', reason: 'denylisted' },
      { name: 'id', reason: 'short_name' },
      { name: 'x', reason: 'short_name' },
    ]);
  });

  it('drops every action touching a dropped entity, counted, never silent', () => {
    const graph: Graph = {
      entities: [entity('e1', 'entity'), entity('e2', 'planExtraction'), entity('e3', 'extraction_queue')],
      actions: [
        action('a1', 'e2', 'uses', 'e1'),
        action('a2', 'e1', 'is_default_type_for', 'e1'),
        action('a3', 'e2', 'enqueues_to', 'e3'),
      ],
    };
    const result = suppressGenericIdentifiers(graph);
    expect(result.graph.actions.map(a => a.id)).toEqual(['a3']);
    expect(result.suppressedActions).toEqual([
      { actionId: 'a1', verb: 'uses', subjectId: 'e2', objectId: 'e1', reason: 'suppressed_endpoint' },
      { actionId: 'a2', verb: 'is_default_type_for', subjectId: 'e1', objectId: 'e1', reason: 'suppressed_endpoint' },
    ]);
  });

  it('drops actions whose unresolved endpoint is itself a generic name (the merge-by-name hole)', () => {
    // resolveExtractedGraph passes unresolved ids through as names, so an
    // action with subjectId "entity" and no matching local entity would
    // MATCH a pre-existing `entity` hub at merge time.
    const graph: Graph = {
      entities: [entity('e1', 'planExtraction')],
      actions: [
        action('a1', 'entity', 'constrains', 'e1'),
        // An unresolved endpoint that carries a real, specific name stays:
        // the pass-through-name path is a feature for non-generic names.
        action('a2', 'globalentityid', 'uses', 'e1'),
      ],
    };
    const result = suppressGenericIdentifiers(graph);
    expect(result.graph.actions.map(a => a.id)).toEqual(['a2']);
    expect(result.suppressedActions).toEqual([
      { actionId: 'a1', verb: 'constrains', subjectId: 'entity', objectId: 'e1', reason: 'generic_unresolved_endpoint' },
    ]);
  });

  it('keeps everything else byte-identical, in order', () => {
    const graph: Graph = {
      entities: [entity('e1', 'globex corporation'), entity('e2', 'initech'), entity('e3', 'entity')],
      actions: [action('a1', 'e1', 'acquired', 'e2')],
    };
    const result = suppressGenericIdentifiers(graph);
    // Kept items are the same object references — untouched.
    expect(result.graph.entities[0]).toBe(graph.entities[0]);
    expect(result.graph.entities[1]).toBe(graph.entities[1]);
    expect(result.graph.actions[0]).toBe(graph.actions[0]);
    // The input graph is not mutated.
    expect(graph.entities).toHaveLength(3);
  });

  it('passes the pilot fixture-contamination fact through: exclusion, not suppression, owns it', () => {
    // `globex corporation --[acquired]-> initech` is FICTIONAL but not
    // generic — it is test-fixture contamination, caught by the Session
    // 25 path exclusion (isTestOrFixturePath) so its source block never
    // reaches the queue. The suppression filter deliberately keeps it:
    // the division of labor is path-level exclusion for fictional
    // sources, name-level suppression for generic identifiers.
    const graph: Graph = {
      entities: [entity('e1', 'globex corporation'), entity('e2', 'initech')],
      actions: [action('a1', 'e1', 'acquired', 'e2')],
    };
    const result = suppressGenericIdentifiers(graph);
    expect(result.graph).toEqual(graph);
    expect(result.suppressedEntities).toEqual([]);
    expect(result.suppressedActions).toEqual([]);
  });

  it('handles an all-generic completion: everything suppressed, nothing throws', () => {
    const graph: Graph = {
      entities: [entity('e1', 'entity'), entity('e2', 'data')],
      actions: [action('a1', 'e1', 'has', 'e2')],
    };
    const result = suppressGenericIdentifiers(graph);
    expect(result.graph.entities).toEqual([]);
    expect(result.graph.actions).toEqual([]);
    expect(result.suppressedEntities).toHaveLength(2);
    expect(result.suppressedActions).toHaveLength(1);
  });
});
