import { describe, expect, it } from 'vitest';
import type { GoalBounds, TaskOutcome } from './decision';
import type { DecisionInput, DecisionResult, DecisionSource } from './decision_source';
import {
  runGoalLoop,
  isTerminalAgentEvent,
  type AgentStreamEvent,
  type TaskRequest,
} from './goal_loop';

// The loop is exercised entirely through injected fakes: a scripted
// decision source and a synchronous task runner. No queue, no Redis, no
// LLM — exactly the dependency seam the worker wires up.

const BOUNDS: GoalBounds = {
  maxIterationsPerGoal: 3,
  maxTasksPerGoal: 4,
  maxConcurrentTasks: 2,
  taskMaxIterations: 5,
};

function decisionResult(partial: Partial<DecisionResult['decision']>): DecisionResult {
  return {
    decision: {
      assessment: 'test decision',
      action: 'finish',
      tasks: null,
      finalAnswer: null,
      reason: null,
      ...partial,
    },
    stubs: new Map(),
    usage: { inputTokens: 10, outputTokens: 5, calls: 1 },
  };
}

function scriptedDecide(script: Array<Partial<DecisionResult['decision']>>): {
  decide: DecisionSource;
  inputs: DecisionInput[];
} {
  const inputs: DecisionInput[] = [];
  const decide: DecisionSource = async input => {
    inputs.push(input);
    const step = script[input.history.length];
    if (!step) throw new Error('scripted decisions exhausted');
    return decisionResult(step);
  };
  return { decide, inputs };
}

function okRunner(answerFor: (task: TaskRequest) => string) {
  const calls: TaskRequest[] = [];
  const runTask = async (task: TaskRequest): Promise<TaskOutcome> => {
    calls.push(task);
    return {
      taskId: task.taskId,
      query: task.query,
      status: 'ok',
      answer: answerFor(task),
      toolCalls: 2,
      spend: { inputTokens: 100, outputTokens: 50, subcalls: 1 },
    };
  };
  return { runTask, calls };
}

function collectEmit() {
  const events: AgentStreamEvent[] = [];
  return { events, emit: (event: AgentStreamEvent) => { events.push(event); } };
}

describe('runGoalLoop', () => {
  it('completes a multi-iteration goal, aggregating observations and spend', async () => {
    const { decide, inputs } = scriptedDecide([
      { action: 'dispatch', tasks: [{ taskId: 'a', query: 'qa' }, { taskId: 'b', query: 'qb' }] },
      { action: 'dispatch', tasks: [{ taskId: 'c', query: 'qc' }] },
      { action: 'finish', finalAnswer: 'combined answer' },
    ]);
    const { runTask, calls } = okRunner(task => `answer:${task.taskId}`);
    const { events, emit } = collectEmit();

    const result = await runGoalLoop({
      goalId: 'g1', goal: 'the goal', bounds: BOUNDS, decide, runTask, emit,
    });

    expect(result.status).toBe('completed');
    expect(result.finalAnswer).toBe('combined answer');
    expect(result.iterations).toBe(3);
    expect(result.tasksDispatched).toBe(3);
    expect(calls.map(c => c.taskId)).toEqual(['a', 'b', 'c']);
    // Every task carries the per-task iteration ceiling and the goal id.
    expect(calls.every(c => c.maxIterations === BOUNDS.taskMaxIterations && c.goalId === 'g1')).toBe(true);

    // The second decision saw the first round's observations verbatim.
    expect(inputs[1].history).toHaveLength(1);
    expect(inputs[1].history[0].observations.map(o => o.answer)).toEqual(['answer:a', 'answer:b']);
    expect(inputs[2].history).toHaveLength(2);

    // Spend: 3 decisions + 3 tasks.
    expect(result.spend).toEqual({
      decisionCalls: 3,
      decisionInputTokens: 30,
      decisionOutputTokens: 15,
      taskInputTokens: 300,
      taskOutputTokens: 150,
      taskSubcalls: 3,
    });

    // Full event lifecycle, in order.
    expect(events.map(e => e.type)).toEqual([
      'goal_started',
      'decision', 'task_started', 'task_started', 'task_result', 'task_result',
      'decision', 'task_started', 'task_result',
      'decision', 'goal_completed',
    ]);
    expect(isTerminalAgentEvent(events[events.length - 1])).toBe(true);
  });

  it('feeds protocol violations and task crashes to the next decision as observations', async () => {
    const observedByDecision: TaskOutcome[][] = [];
    const decide: DecisionSource = async input => {
      observedByDecision.push(input.history.flatMap(r => r.observations));
      if (input.history.length === 0) {
        return decisionResult({
          action: 'dispatch',
          tasks: [{ taskId: 'violates', query: 'v' }, { taskId: 'crashes', query: 'c' }],
        });
      }
      return decisionResult({ action: 'finish', finalAnswer: 'recovered' });
    };
    const runTask = async (task: TaskRequest): Promise<TaskOutcome> => {
      if (task.taskId === 'crashes') throw new Error('spawn failed');
      return {
        taskId: task.taskId, query: task.query,
        status: 'protocol_violation', answer: 'unsupported claim', toolCalls: 0, spend: null,
      };
    };
    const { events, emit } = collectEmit();

    const result = await runGoalLoop({
      goalId: 'g2', goal: 'goal', bounds: BOUNDS, decide, runTask, emit,
    });

    expect(result.status).toBe('completed');
    const secondRoundView = observedByDecision[1];
    expect(secondRoundView.map(o => o.status).sort()).toEqual(['error', 'protocol_violation']);
    expect(secondRoundView.find(o => o.taskId === 'crashes')?.error).toBe('spawn failed');
    // Both outcomes were also streamed.
    const streamed = events.filter(e => e.type === 'task_result');
    expect(streamed).toHaveLength(2);
  });

  it('trips the iteration bound as a typed failure with no further decisions', async () => {
    let decisions = 0;
    const decide: DecisionSource = async () => {
      decisions++;
      return decisionResult({ action: 'dispatch', tasks: [{ taskId: `t${decisions}`, query: 'q' }] });
    };
    const { runTask, calls } = okRunner(() => 'x');
    const { events, emit } = collectEmit();

    const result = await runGoalLoop({
      goalId: 'g3', goal: 'goal', bounds: BOUNDS, decide, runTask, emit,
    });

    expect(result.status).toBe('failed');
    expect(result.failure?.kind).toBe('iteration_bound');
    expect(decisions).toBe(BOUNDS.maxIterationsPerGoal);
    expect(calls).toHaveLength(BOUNDS.maxIterationsPerGoal);
    expect(events[events.length - 1].type).toBe('goal_failed');
  });

  it('trips the total-task bound before dispatching the offending batch', async () => {
    const { decide } = scriptedDecide([
      { action: 'dispatch', tasks: [{ taskId: 'a', query: 'q' }, { taskId: 'b', query: 'q' }] },
      { action: 'dispatch', tasks: [{ taskId: 'c', query: 'q' }, { taskId: 'd', query: 'q' }] },
      { action: 'dispatch', tasks: [{ taskId: 'e', query: 'q' }] },
    ]);
    const { runTask, calls } = okRunner(() => 'x');
    const bounds = { ...BOUNDS, maxIterationsPerGoal: 5 };
    const { events, emit } = collectEmit();

    const result = await runGoalLoop({
      goalId: 'g4', goal: 'goal', bounds, decide, runTask, emit,
    });

    expect(result.status).toBe('failed');
    expect(result.failure?.kind).toBe('task_bound');
    // The fifth task never started: 4 dispatched, the tripping batch dispatched nothing.
    expect(calls).toHaveLength(4);
    expect(result.tasksDispatched).toBe(4);
    expect(events.filter(e => e.type === 'task_started')).toHaveLength(4);
  });

  it('trips the concurrency bound without running any task of the batch', async () => {
    const { decide } = scriptedDecide([
      { action: 'dispatch', tasks: [
        { taskId: 'a', query: 'q' }, { taskId: 'b', query: 'q' }, { taskId: 'c', query: 'q' },
      ] },
    ]);
    const { runTask, calls } = okRunner(() => 'x');
    const { events, emit } = collectEmit();

    const result = await runGoalLoop({
      goalId: 'g5', goal: 'goal', bounds: BOUNDS, decide, runTask, emit,
    });

    expect(result.status).toBe('failed');
    expect(result.failure?.kind).toBe('concurrency_bound');
    expect(calls).toHaveLength(0);
    expect(events.map(e => e.type)).toEqual(['goal_started', 'decision', 'goal_failed']);
  });

  it('converts a decision-source error into a typed failure', async () => {
    const decide: DecisionSource = async () => {
      throw new Error('LLM response failed schema validation in orchestrator decision');
    };
    const { runTask, calls } = okRunner(() => 'x');
    const { emit } = collectEmit();

    const result = await runGoalLoop({
      goalId: 'g6', goal: 'goal', bounds: BOUNDS, decide, runTask, emit,
    });

    expect(result.status).toBe('failed');
    expect(result.failure?.kind).toBe('decision_error');
    expect(result.failure?.reason).toContain('failed schema validation');
    expect(calls).toHaveLength(0);
  });

  it('reports an orchestrator fail action as its own failure kind', async () => {
    const { decide } = scriptedDecide([
      { action: 'fail', reason: 'the graph has no relevant facts' },
    ]);
    const { runTask } = okRunner(() => 'x');
    const { events, emit } = collectEmit();

    const result = await runGoalLoop({
      goalId: 'g7', goal: 'goal', bounds: BOUNDS, decide, runTask, emit,
    });

    expect(result.status).toBe('failed');
    expect(result.failure).toEqual({ kind: 'orchestrator_fail', reason: 'the graph has no relevant facts' });
    expect(events.map(e => e.type)).toEqual(['goal_started', 'decision', 'goal_failed']);
  });

  it('passes oracle stubs through to the task runner by taskId', async () => {
    const stub = { stdout: 'FINAL_ANSWER: 4\n' };
    const decide: DecisionSource = async input => {
      if (input.history.length === 0) {
        return {
          decision: {
            assessment: 'a', action: 'dispatch',
            tasks: [{ taskId: 'stubbed', query: 'q' }, { taskId: 'plain', query: 'q' }],
            finalAnswer: null, reason: null,
          },
          stubs: new Map([['stubbed', stub]]),
          usage: { inputTokens: 0, outputTokens: 0, calls: 0 },
        };
      }
      return decisionResult({ action: 'finish', finalAnswer: 'done' });
    };
    const { runTask, calls } = okRunner(() => 'x');
    const { emit } = collectEmit();

    await runGoalLoop({ goalId: 'g8', goal: 'goal', bounds: BOUNDS, decide, runTask, emit });

    expect(calls.find(c => c.taskId === 'stubbed')?.stub).toEqual(stub);
    expect(calls.find(c => c.taskId === 'plain')?.stub).toBeUndefined();
  });
});
