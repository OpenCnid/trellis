import { describe, it, expect } from 'vitest';
import {
  CONFLICT_ANOMALY_CYPHER,
  CONFLICT_RESOLUTION_CYPHER,
  conflictResolutionParams,
  astRowText,
  joinAstTexts,
} from './conflict_resolution';
import type { ConflictEvaluation } from './schemas';

const evaluation: ConflictEvaluation = {
  isContradiction: true,
  reasoning: 'the two acquisition dates disagree',
  resolutionType: 'TEMPORAL_UPDATE',
};

describe('CONFLICT_ANOMALY_CYPHER', () => {
  it('orders candidates with elementId(), not the deprecated id()', () => {
    expect(CONFLICT_ANOMALY_CYPHER).toContain('elementId(obj1) < elementId(obj2)');
    // No bare id(...) calls anywhere in the query (deprecated in Neo4j 5).
    expect(CONFLICT_ANOMALY_CYPHER).not.toMatch(/(?<![a-zA-Z])id\(/);
  });

  it('still excludes already-branched relationships', () => {
    expect(CONFLICT_ANOMALY_CYPHER).toContain('r1.belief_state IS NULL AND r2.belief_state IS NULL');
  });
});

describe('CONFLICT_RESOLUTION_CYPHER', () => {
  it('links the Conflict node to the subject and both branch objects', () => {
    // Previously the Conflict node was CREATEd with no relationships.
    expect(CONFLICT_RESOLUTION_CYPHER).toContain('[:HAS_CONFLICT');
    expect(CONFLICT_RESOLUTION_CYPHER).toContain("beliefState: 'Belief A', actionElementId: $r1Id");
    expect(CONFLICT_RESOLUTION_CYPHER).toContain("beliefState: 'Belief B', actionElementId: $r2Id");
  });

  it('carries provenance on the Conflict node and every created edge', () => {
    // Architecture invariant: every semantic node/edge carries sourceNodeIds.
    const created = CONFLICT_RESOLUTION_CYPHER.match(/sourceNodeIds: \$/g) ?? [];
    expect(created.length).toBeGreaterThanOrEqual(4); // Conflict, HAS_CONFLICT, 2x CONFLICT_BRANCH
    expect(CONFLICT_RESOLUTION_CYPHER).toContain('ON CREATE SET ct.sourceNodeIds');
  });

  it('stores the evaluation resolutionType and still branches belief states', () => {
    expect(CONFLICT_RESOLUTION_CYPHER).toContain('resolutionType: $resolutionType');
    expect(CONFLICT_RESOLUTION_CYPHER).toContain("SET r1.belief_state = 'Belief A'");
    expect(CONFLICT_RESOLUTION_CYPHER).toContain("SET r2.belief_state = 'Belief B'");
  });
});

describe('conflictResolutionParams', () => {
  it('maps the evaluation fields and both provenance sets', () => {
    const params = conflictResolutionParams({
      r1Id: 'el:1',
      r2Id: 'el:2',
      evaluation,
      r1SourceNodeIds: ['h1', 'h2'],
      r2SourceNodeIds: ['h3'],
    });
    expect(params).toEqual({
      r1Id: 'el:1',
      r2Id: 'el:2',
      reasoning: 'the two acquisition dates disagree',
      resolutionType: 'TEMPORAL_UPDATE',
      r1SourceNodeIds: ['h1', 'h2'],
      r2SourceNodeIds: ['h3'],
      conflictSourceNodeIds: ['h1', 'h2', 'h3'],
    });
  });

  it('dedupes shared hashes in the conflict-level union, preserving order', () => {
    const params = conflictResolutionParams({
      r1Id: 'a',
      r2Id: 'b',
      evaluation,
      r1SourceNodeIds: ['h1', 'h2'],
      r2SourceNodeIds: ['h2', 'h3'],
    });
    expect(params.conflictSourceNodeIds).toEqual(['h1', 'h2', 'h3']);
  });
});

describe('astRowText / joinAstTexts', () => {
  it('prefers markdown value, then PDF text, then raw JSON', () => {
    expect(astRowText({ value: 'md text', text: 'pdf text' })).toBe('md text');
    expect(astRowText({ text: 'pdf text' })).toBe('pdf text');
    expect(astRowText({ other: 1 } as any)).toBe('{"other":1}');
  });

  it('joins blocks with a real newline, not the literal two characters', () => {
    const joined = joinAstTexts([{ data: { value: 'first' } }, { data: { value: 'second' } }]);
    expect(joined).toBe('first\nsecond');
    expect(joined).not.toContain('\\n');
  });

  it('handles a single row and an empty list', () => {
    expect(joinAstTexts([{ data: { value: 'only' } }])).toBe('only');
    expect(joinAstTexts([])).toBe('');
  });
});
