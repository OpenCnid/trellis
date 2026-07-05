import { describe, it, expect } from 'vitest';
import * as crypto from 'crypto';
import { globalEntityId, resolveExtractedGraph } from './resolve_actions';
import type { Graph } from './schemas';

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

const graph = (overrides: Partial<Graph> = {}): Graph => ({
  entities: [
    { id: 'local-1', name: 'Globex Corporation', type: 'Organization', sourceNodeIds: ['h1'] },
    { id: 'local-2', name: 'Initech', type: 'Organization', sourceNodeIds: ['h1'] }
  ],
  actions: [
    { id: 'act-1', subjectId: 'local-1', verb: 'acquired', objectId: 'local-2', sourceNodeIds: ['h1'] }
  ],
  ...overrides
});

describe('globalEntityId', () => {
  // Pins the historical identity scheme from the extraction worker:
  // SHA-256 of the lowercased name. Changing this re-keys every Entity
  // node in existing graphs.
  it('is SHA-256 of the lowercased name', () => {
    expect(globalEntityId('Globex Corporation')).toBe(sha256('globex corporation'));
  });

  it('is case-insensitive', () => {
    expect(globalEntityId('INITECH')).toBe(globalEntityId('initech'));
  });
});

describe('resolveExtractedGraph', () => {
  it('replaces entity ids with their global hash', () => {
    const { entities } = resolveExtractedGraph(graph());
    expect(entities.map(e => e.id)).toEqual([
      sha256('globex corporation'),
      sha256('initech')
    ]);
  });

  it('does not mutate the input graph', () => {
    const input = graph();
    resolveExtractedGraph(input);
    expect(input.entities[0].id).toBe('local-1');
    expect(input.actions[0].subjectId).toBe('local-1');
  });

  it('enriches a fully resolved action with global ids and names', () => {
    const { actions, unresolved } = resolveExtractedGraph(graph());
    expect(unresolved).toEqual([]);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      id: 'act-1',
      verb: 'acquired',
      subjectId: sha256('globex corporation'),
      objectId: sha256('initech'),
      subjectName: 'Globex Corporation',
      objectName: 'Initech',
      sourceNodeIds: ['h1']
    });
  });

  it('reports an action whose subject id matches no extracted entity', () => {
    const { actions, unresolved } = resolveExtractedGraph(graph({
      actions: [
        { id: 'act-1', subjectId: 'ghost', verb: 'acquired', objectId: 'local-2', sourceNodeIds: ['h1'] }
      ]
    }));
    expect(unresolved).toEqual([{
      actionId: 'act-1',
      verb: 'acquired',
      subjectId: 'ghost',
      objectId: 'local-2',
      unresolved: ['subject']
    }]);
    // Still submitted: the raw id passes through as the name, preserving
    // the chance of a MATCH-by-name hit against a pre-existing entity.
    expect(actions).toHaveLength(1);
    expect(actions[0].subjectId).toBe('ghost');
    expect(actions[0].subjectName).toBe('ghost');
    expect(actions[0].objectName).toBe('Initech');
  });

  it('reports both endpoints when neither resolves', () => {
    const { unresolved } = resolveExtractedGraph(graph({
      actions: [
        { id: 'act-2', subjectId: 'ghost-a', verb: 'merged with', objectId: 'ghost-b', sourceNodeIds: ['h2'] }
      ]
    }));
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].unresolved).toEqual(['subject', 'object']);
  });

  it('resolves multiple actions independently', () => {
    const { actions, unresolved } = resolveExtractedGraph(graph({
      actions: [
        { id: 'act-1', subjectId: 'local-1', verb: 'acquired', objectId: 'local-2', sourceNodeIds: ['h1'] },
        { id: 'act-2', subjectId: 'local-2', verb: 'sued', objectId: 'ghost', sourceNodeIds: ['h1'] }
      ]
    }));
    expect(actions).toHaveLength(2);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].actionId).toBe('act-2');
    expect(unresolved[0].unresolved).toEqual(['object']);
  });

  it('handles an empty extraction', () => {
    const out = resolveExtractedGraph({ entities: [], actions: [] });
    expect(out).toEqual({ entities: [], actions: [], unresolved: [] });
  });
});
