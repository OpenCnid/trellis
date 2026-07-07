import { describe, expect, it } from 'vitest';
import { parseLlmResponse, LlmResponseError } from '../llm/boundary';
import { OrchestratorDecisionSchema } from './decision';

// The orchestrator decision is an LLM completion and must fail closed
// at the T8 boundary: empty, non-JSON, and schema-violating payloads
// all throw LlmResponseError with the right stage, and cross-field
// rules make hallucinated shapes unrepresentable.

const CONTEXT = 'orchestrator decision (test)';

function stageOf(raw: string | null | undefined): string {
  try {
    parseLlmResponse(OrchestratorDecisionSchema, raw, CONTEXT);
    return 'parsed';
  } catch (error) {
    if (error instanceof LlmResponseError) return error.stage;
    throw error;
  }
}

const VALID_DISPATCH = {
  assessment: 'need two facts',
  action: 'dispatch',
  tasks: [
    { taskId: 't1', query: 'first question' },
    { taskId: 't2', query: 'second question' },
  ],
  finalAnswer: null,
  reason: null,
};

describe('OrchestratorDecisionSchema at the parseLlmResponse boundary', () => {
  it('fails the empty stage on missing content', () => {
    expect(stageOf(null)).toBe('empty');
    expect(stageOf('')).toBe('empty');
    expect(stageOf('   ')).toBe('empty');
  });

  it('fails the json stage on a truncated completion', () => {
    expect(stageOf('{"assessment": "half a dec')).toBe('json');
  });

  it('fails the schema stage on a hallucinated action', () => {
    expect(stageOf(JSON.stringify({ ...VALID_DISPATCH, action: 'delegate_goal' }))).toBe('schema');
    expect(stageOf(JSON.stringify({ ...VALID_DISPATCH, action: 'retry' }))).toBe('schema');
  });

  it('fails the schema stage on missing fields', () => {
    const { tasks: _tasks, ...withoutTasks } = VALID_DISPATCH;
    expect(stageOf(JSON.stringify(withoutTasks))).toBe('schema');
    expect(stageOf(JSON.stringify({ action: 'finish' }))).toBe('schema');
  });

  it('rejects a dispatch with no tasks or duplicate taskIds', () => {
    expect(stageOf(JSON.stringify({ ...VALID_DISPATCH, tasks: null }))).toBe('schema');
    expect(stageOf(JSON.stringify({ ...VALID_DISPATCH, tasks: [] }))).toBe('schema');
    expect(stageOf(JSON.stringify({
      ...VALID_DISPATCH,
      tasks: [
        { taskId: 't1', query: 'a' },
        { taskId: 't1', query: 'b' },
      ],
    }))).toBe('schema');
  });

  it('rejects a finish without a usable finalAnswer', () => {
    const finish = { assessment: 'done', action: 'finish', tasks: null, finalAnswer: null, reason: null };
    expect(stageOf(JSON.stringify(finish))).toBe('schema');
    expect(stageOf(JSON.stringify({ ...finish, finalAnswer: '   ' }))).toBe('schema');
  });

  it('rejects a fail without a reason', () => {
    const fail = { assessment: 'stuck', action: 'fail', tasks: null, finalAnswer: null, reason: null };
    expect(stageOf(JSON.stringify(fail))).toBe('schema');
  });

  it('parses the three well-formed decisions', () => {
    expect(stageOf(JSON.stringify(VALID_DISPATCH))).toBe('parsed');
    expect(stageOf(JSON.stringify({
      assessment: 'answers cover the goal',
      action: 'finish',
      tasks: null,
      finalAnswer: 'the aggregated answer',
      reason: null,
    }))).toBe('parsed');
    expect(stageOf(JSON.stringify({
      assessment: 'no data supports the goal',
      action: 'fail',
      tasks: null,
      finalAnswer: null,
      reason: 'graph holds no relevant facts',
    }))).toBe('parsed');
  });
});
