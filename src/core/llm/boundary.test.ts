import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { parseLlmResponse, LlmResponseError } from './boundary';
import {
  GraphSchema,
  ConflictEvaluationSchema,
  VerificationResponseSchema,
} from '../graph/schemas';

// Helper: run parseLlmResponse and return the thrown LlmResponseError,
// asserting that it threw at all and with the right type.
function expectBoundaryError(fn: () => unknown): LlmResponseError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(LlmResponseError);
    return err as LlmResponseError;
  }
  throw new Error('expected parseLlmResponse to throw');
}

describe('parseLlmResponse', () => {
  const validGraph = {
    entities: [
      { id: 'e1', name: 'Globex', type: 'Organization', sourceNodeIds: ['h1'] },
      { id: 'e2', name: 'Initech', type: 'Organization', sourceNodeIds: ['h1'] }
    ],
    actions: [
      { id: 'a1', subjectId: 'e1', verb: 'acquired', objectId: 'e2', sourceNodeIds: ['h1'] }
    ]
  };

  it('returns the typed payload for a valid completion', () => {
    const graph = parseLlmResponse(GraphSchema, JSON.stringify(validGraph), 'test');
    expect(graph.entities).toHaveLength(2);
    expect(graph.actions[0].verb).toBe('acquired');
  });

  it('accepts a valid conflict evaluation', () => {
    const raw = JSON.stringify({
      isContradiction: true,
      reasoning: 'dates disagree',
      resolutionType: 'TEMPORAL_UPDATE'
    });
    const evaluation = parseLlmResponse(ConflictEvaluationSchema, raw, 'test');
    expect(evaluation.isContradiction).toBe(true);
  });

  it('validates the verification worker response map', () => {
    const answers = parseLlmResponse(
      VerificationResponseSchema,
      JSON.stringify({
        results: [
          { id: 'q1', label: 'HUM', confidence: 0.91 },
          { id: 'q2', label: 'LOC', confidence: 0.84 },
        ],
      }),
      'verification batch'
    );
    expect(answers.results[0]).toEqual({ id: 'q1', label: 'HUM', confidence: 0.91 });
    expect(answers.results[1].label).toBe('LOC');
  });

  it('rejects malformed verification answers instead of dropping them', () => {
    const err = expectBoundaryError(() => parseLlmResponse(
      VerificationResponseSchema,
      JSON.stringify({ results: [{ id: 'q1', confidence: 0.9 }] }),
      'verification batch'
    ));
    expect(err.stage).toBe('schema');
    expect(err.message).toContain('results.0.label');
  });

  it('throws stage=empty for null content (nullable OpenAI response)', () => {
    const err = expectBoundaryError(() => parseLlmResponse(GraphSchema, null, 'test'));
    expect(err.stage).toBe('empty');
  });

  it('throws stage=empty for whitespace-only content', () => {
    const err = expectBoundaryError(() => parseLlmResponse(GraphSchema, '  \n ', 'test'));
    expect(err.stage).toBe('empty');
  });

  it('throws stage=json for a truncated completion', () => {
    const err = expectBoundaryError(() =>
      parseLlmResponse(GraphSchema, '{"entities": [{"id": "e1", "na', 'test'));
    expect(err.stage).toBe('json');
  });

  it('throws stage=schema when a required field is missing', () => {
    const raw = JSON.stringify({ entities: [{ id: 'e1', name: 'Globex' }], actions: [] });
    const err = expectBoundaryError(() => parseLlmResponse(GraphSchema, raw, 'test'));
    expect(err.stage).toBe('schema');
    // The message names the offending path so a failed job is diagnosable.
    expect(err.message).toContain('entities.0');
  });

  it('throws stage=schema for valid JSON of the wrong shape entirely', () => {
    const err = expectBoundaryError(() => parseLlmResponse(GraphSchema, '"just a string"', 'test'));
    expect(err.stage).toBe('schema');
    expect(err.message).toContain('(root)');
  });

  it('throws stage=schema for an enum value outside the schema', () => {
    const raw = JSON.stringify({
      isContradiction: false,
      reasoning: 'ok',
      resolutionType: 'SOMETHING_ELSE'
    });
    const err = expectBoundaryError(() => parseLlmResponse(ConflictEvaluationSchema, raw, 'test'));
    expect(err.stage).toBe('schema');
    expect(err.message).toContain('resolutionType');
  });

  it('includes the caller context in the error message', () => {
    const err = expectBoundaryError(() =>
      parseLlmResponse(GraphSchema, 'not json', 'extraction job 42 (AST node abc)'));
    expect(err.message).toContain('extraction job 42 (AST node abc)');
    expect(err.context).toBe('extraction job 42 (AST node abc)');
  });

  it('bounds the raw snippet kept on the error', () => {
    const raw = '[' + '1,'.repeat(2000) + ']b'; // long AND invalid JSON
    const err = expectBoundaryError(() => parseLlmResponse(GraphSchema, raw, 'test'));
    expect(err.rawSnippet.length).toBeLessThan(600);
    expect(err.rawSnippet).toContain('truncated');
  });

  it('keeps a short raw payload untruncated on the error', () => {
    const err = expectBoundaryError(() => parseLlmResponse(GraphSchema, '{oops', 'test'));
    expect(err.rawSnippet).toBe('{oops');
  });

  it('works with an arbitrary Zod schema (generic boundary)', () => {
    const schema = z.object({ n: z.number() });
    expect(parseLlmResponse(schema, '{"n": 3}', 'test').n).toBe(3);
    const err = expectBoundaryError(() => parseLlmResponse(schema, '{"n": "3"}', 'test'));
    expect(err.stage).toBe('schema');
  });
});
