import { describe, expect, it } from 'vitest';
import type { AgentStreamEvent, GoalFailureKind } from '../agent/goal_loop';
import {
  applyAgentEvent,
  isTerminalTaskState,
  newTaskRecord,
  parseTaskRecord,
  renderTask,
  streamFramesFor,
  type A2aTaskRecord,
} from './task_record';

// Session 11: exhaustive coverage of the goal-lifecycle -> A2A task
// translation (HANDOFF §6). Every goal event type, every typed failure
// kind, and every rendered wire shape is pinned here.

const T0 = '2026-07-07T10:00:00.000Z';
const T1 = '2026-07-07T10:00:01.000Z';
const T2 = '2026-07-07T10:00:02.000Z';

const BOUNDS = {
  maxIterationsPerGoal: 4,
  maxTasksPerGoal: 8,
  maxConcurrentTasks: 2,
  taskMaxIterations: 5,
};

function fresh(): A2aTaskRecord {
  return newTaskRecord('goal-1', 'ctx-1', T0);
}

const PROGRESS_EVENTS: AgentStreamEvent[] = [
  { type: 'goal_started', goalId: 'goal-1', bounds: BOUNDS },
  { type: 'decision', goalId: 'goal-1', iteration: 1, action: 'dispatch', assessment: 'a', taskCount: 1 },
  { type: 'task_started', goalId: 'goal-1', iteration: 1, taskId: 't-1', query: 'q' },
  {
    type: 'task_result',
    goalId: 'goal-1',
    iteration: 1,
    outcome: { taskId: 't-1', query: 'q', status: 'ok', answer: 'x', toolCalls: 2, spend: null },
  },
];

const ZERO_SPEND = {
  decisionCalls: 0,
  decisionInputTokens: 0,
  decisionOutputTokens: 0,
  taskInputTokens: 0,
  taskOutputTokens: 0,
  taskSubcalls: 0,
};

const COMPLETED_EVENT: AgentStreamEvent = {
  type: 'goal_completed',
  goalId: 'goal-1',
  iterations: 2,
  tasksDispatched: 1,
  finalAnswer: 'the aggregated answer',
  spend: ZERO_SPEND,
};

function failedEvent(kind: GoalFailureKind, reason: string): AgentStreamEvent {
  return {
    type: 'goal_failed',
    goalId: 'goal-1',
    iterations: 1,
    tasksDispatched: 0,
    failure: { kind, reason },
    spend: ZERO_SPEND,
  };
}

describe('task record state machine', () => {
  it('starts SUBMITTED with no answer or failure', () => {
    expect(fresh()).toEqual({
      id: 'goal-1',
      contextId: 'ctx-1',
      state: 'TASK_STATE_SUBMITTED',
      finalAnswer: null,
      failure: null,
      createdAt: T0,
      updatedAt: T0,
    });
    expect(isTerminalTaskState('TASK_STATE_SUBMITTED')).toBe(false);
  });

  it('moves to WORKING on every progress event type', () => {
    for (const event of PROGRESS_EVENTS) {
      const after = applyAgentEvent(fresh(), event, T1);
      expect(after.state).toBe('TASK_STATE_WORKING');
      expect(after.updatedAt).toBe(T1);
      expect(after.createdAt).toBe(T0);
      expect(isTerminalTaskState(after.state)).toBe(false);
    }
  });

  it('completes with the final answer', () => {
    const working = applyAgentEvent(fresh(), PROGRESS_EVENTS[0], T1);
    const done = applyAgentEvent(working, COMPLETED_EVENT, T2);
    expect(done.state).toBe('TASK_STATE_COMPLETED');
    expect(done.finalAnswer).toBe('the aggregated answer');
    expect(done.failure).toBeNull();
    expect(isTerminalTaskState(done.state)).toBe(true);
  });

  it('fails with the typed reason for every GoalFailureKind', () => {
    const kinds: GoalFailureKind[] = [
      'iteration_bound',
      'task_bound',
      'concurrency_bound',
      'decision_error',
      'orchestrator_fail',
    ];
    for (const kind of kinds) {
      const failed = applyAgentEvent(fresh(), failedEvent(kind, `reason for ${kind}`), T1);
      expect(failed.state).toBe('TASK_STATE_FAILED');
      expect(failed.failure).toEqual({ kind, reason: `reason for ${kind}` });
      expect(failed.finalAnswer).toBeNull();
      expect(isTerminalTaskState(failed.state)).toBe(true);
    }
  });

  it('never regresses a terminal record', () => {
    const done = applyAgentEvent(fresh(), COMPLETED_EVENT, T1);
    for (const event of [...PROGRESS_EVENTS, failedEvent('task_bound', 'late failure')]) {
      expect(applyAgentEvent(done, event, T2)).toBe(done);
    }
  });

  it('ignores malformed and unknown events without a transition', () => {
    const start = fresh();
    for (const bad of [null, 42, 'goal_started', {}, { type: 'future_event_type' }]) {
      expect(applyAgentEvent(start, bad, T1)).toBe(start);
    }
  });

  it('round-trips through storage and rejects malformed payloads', () => {
    const record = applyAgentEvent(fresh(), COMPLETED_EVENT, T1);
    expect(parseTaskRecord(JSON.stringify(record))).toEqual(record);
    expect(parseTaskRecord('not json')).toBeNull();
    expect(parseTaskRecord('{"id":"x"}')).toBeNull();
    expect(parseTaskRecord(JSON.stringify({ ...record, state: 'TASK_STATE_CANCELED' }))).toBeNull();
  });
});

describe('renderTask', () => {
  it('renders a submitted task with no artifacts and no message', () => {
    expect(renderTask(fresh())).toEqual({
      id: 'goal-1',
      contextId: 'ctx-1',
      status: { state: 'TASK_STATE_SUBMITTED', timestamp: T0 },
    });
  });

  it('renders a completed task with exactly one text artifact', () => {
    const done = applyAgentEvent(fresh(), COMPLETED_EVENT, T1);
    expect(renderTask(done)).toEqual({
      id: 'goal-1',
      contextId: 'ctx-1',
      status: { state: 'TASK_STATE_COMPLETED', timestamp: T1 },
      artifacts: [
        {
          artifactId: 'artifact-goal-1',
          name: 'goal-answer',
          parts: [{ text: 'the aggregated answer' }],
        },
      ],
    });
  });

  it('renders a failed task with the typed reason as an agent status message', () => {
    const failed = applyAgentEvent(
      fresh(),
      failedEvent('iteration_bound', 'Goal exceeded 4 decision rounds without finishing'),
      T1
    );
    const task = renderTask(failed) as any;
    expect(task.status.state).toBe('TASK_STATE_FAILED');
    expect(task.artifacts).toBeUndefined();
    expect(task.status.message).toEqual({
      messageId: 'msg-goal-1-status',
      role: 'ROLE_AGENT',
      parts: [{ text: 'iteration_bound: Goal exceeded 4 decision rounds without finishing' }],
    });
  });
});

describe('streamFramesFor', () => {
  it('yields one WORKING status update per progress event', () => {
    for (const event of PROGRESS_EVENTS) {
      const after = applyAgentEvent(fresh(), event, T1);
      expect(streamFramesFor(event, after)).toEqual([
        {
          statusUpdate: {
            taskId: 'goal-1',
            contextId: 'ctx-1',
            status: { state: 'TASK_STATE_WORKING', timestamp: T1 },
          },
        },
      ]);
    }
  });

  it('yields the answer artifact (lastChunk) then the terminal status on completion', () => {
    const done = applyAgentEvent(fresh(), COMPLETED_EVENT, T1);
    expect(streamFramesFor(COMPLETED_EVENT, done)).toEqual([
      {
        artifactUpdate: {
          taskId: 'goal-1',
          contextId: 'ctx-1',
          artifact: {
            artifactId: 'artifact-goal-1',
            name: 'goal-answer',
            parts: [{ text: 'the aggregated answer' }],
          },
          lastChunk: true,
        },
      },
      {
        statusUpdate: {
          taskId: 'goal-1',
          contextId: 'ctx-1',
          status: { state: 'TASK_STATE_COMPLETED', timestamp: T1 },
        },
      },
    ]);
  });

  it('yields one terminal FAILED status carrying the typed reason', () => {
    const event = failedEvent('concurrency_bound', 'batch too large');
    const failed = applyAgentEvent(fresh(), event, T1);
    const frames = streamFramesFor(event, failed) as any[];
    expect(frames).toHaveLength(1);
    expect(frames[0].statusUpdate.status.state).toBe('TASK_STATE_FAILED');
    expect(frames[0].statusUpdate.status.message.parts[0].text).toBe(
      'concurrency_bound: batch too large'
    );
  });

  it('yields nothing for malformed or unknown events', () => {
    for (const bad of [null, {}, { type: 'future_event_type' }]) {
      expect(streamFramesFor(bad, fresh())).toEqual([]);
    }
  });
});
