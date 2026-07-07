import { describe, expect, it } from 'vitest';
import { OracleScriptSchema } from './oracle';
import { makeOracleDecisionSource } from './decision_source';
import type { GoalBounds, GoalIterationRecord, TaskOutcome } from './decision';

const BOUNDS: GoalBounds = {
  maxIterationsPerGoal: 4,
  maxTasksPerGoal: 8,
  maxConcurrentTasks: 2,
  taskMaxIterations: 5,
};

function outcome(status: TaskOutcome['status']): TaskOutcome {
  return { taskId: 't1', query: 'q', status, answer: 'a', toolCalls: status === 'ok' ? 1 : 0, spend: null };
}

function round(status: TaskOutcome['status']): GoalIterationRecord {
  return {
    decision: {
      assessment: 'a', action: 'dispatch',
      tasks: [{ taskId: 't1', query: 'q' }], finalAnswer: null, reason: null,
    },
    observations: [outcome(status)],
  };
}

describe('OracleScriptSchema', () => {
  it('accepts a minimal script and rejects an empty one', () => {
    expect(OracleScriptSchema.safeParse({
      steps: [{ decision: { action: 'finish', finalAnswer: 'done' } }],
    }).success).toBe(true);
    expect(OracleScriptSchema.safeParse({ steps: [] }).success).toBe(false);
    expect(OracleScriptSchema.safeParse({}).success).toBe(false);
  });
});

describe('makeOracleDecisionSource', () => {
  const script = OracleScriptSchema.parse({
    steps: [
      {
        decision: {
          action: 'dispatch',
          tasks: [{ taskId: 't1', query: 'q1', stub: { stdout: 'FINAL_ANSWER: 1\n' } }],
        },
      },
      {
        decision: { action: 'finish', finalAnswer: 'clean finish' },
        onProtocolViolation: {
          action: 'dispatch',
          tasks: [{ taskId: 't1-retry', query: 'q1 but cite your sources' }],
        },
      },
      { decision: { action: 'finish', finalAnswer: 'finish after retry' } },
    ],
  });

  it('consumes steps in order and surfaces stubs by taskId', async () => {
    const decide = makeOracleDecisionSource(script);
    const first = await decide({ goal: 'g', bounds: BOUNDS, history: [] });
    expect(first.decision.action).toBe('dispatch');
    expect(first.decision.tasks).toEqual([{ taskId: 't1', query: 'q1' }]);
    expect(first.stubs.get('t1')).toEqual({ stdout: 'FINAL_ANSWER: 1\n' });
    expect(first.usage).toEqual({ inputTokens: 0, outputTokens: 0, calls: 0 });
  });

  it('takes the onProtocolViolation branch when the last round violated', async () => {
    const decide = makeOracleDecisionSource(script);
    const reactive = await decide({ goal: 'g', bounds: BOUNDS, history: [round('protocol_violation')] });
    expect(reactive.decision.action).toBe('dispatch');
    expect(reactive.decision.tasks?.[0].taskId).toBe('t1-retry');

    const clean = await decide({ goal: 'g', bounds: BOUNDS, history: [round('ok')] });
    expect(clean.decision.action).toBe('finish');
    expect(clean.decision.finalAnswer).toBe('clean finish');
  });

  it('throws (a typed decision error in the loop) when the script is exhausted', async () => {
    const decide = makeOracleDecisionSource(
      OracleScriptSchema.parse({ steps: [{ decision: { action: 'finish', finalAnswer: 'x' } }] })
    );
    await expect(
      decide({ goal: 'g', bounds: BOUNDS, history: [round('ok')] })
    ).rejects.toThrow(/Oracle script exhausted/);
  });
});
