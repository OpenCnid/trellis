import type {
  GoalBounds,
  GoalIterationRecord,
  TaskOutcome,
} from './decision.js';
import type { DecisionSource } from './decision_source.js';

// Session 9: the external agentic loop. Goal in, decision out, tasks
// dispatched as rlm_queue jobs, result envelopes back as observations,
// next decision — until finish/fail or a bound trips. Fully
// dependency-injected (decision source, task runner, event sink) so the
// whole control flow is unit-testable with zero infrastructure.
//
// Failure posture (Guardrail 5): every exit is typed. Task failures and
// protocol violations are OBSERVATIONS for the next decision, never
// loop crashes; a decision-source error or a tripped bound ends the
// goal as a streamed typed failure with no further dispatches. The
// orchestrator never writes to the graph and has no path by which it
// can dispatch another goal.

export type GoalFailureKind =
  | 'iteration_bound'
  | 'task_bound'
  | 'concurrency_bound'
  | 'decision_error'
  | 'orchestrator_fail';

export interface GoalFailure {
  kind: GoalFailureKind;
  reason: string;
}

/** Aggregated goal spend: orchestrator completions plus sub-agent telemetry. */
export interface GoalSpend {
  decisionCalls: number;
  decisionInputTokens: number;
  decisionOutputTokens: number;
  taskInputTokens: number;
  taskOutputTokens: number;
  taskSubcalls: number;
}

export interface GoalResult {
  goalId: string;
  status: 'completed' | 'failed';
  finalAnswer: string | null;
  failure: GoalFailure | null;
  iterations: number;
  tasksDispatched: number;
  spend: GoalSpend;
}

// Goal-level SSE events, published on agent-stream:<goalId>. These
// carry goal/task text to the authenticated client (same posture as the
// RLM stdout stream); logs and metrics carry only ids, enums, and
// counts.
export type AgentStreamEvent =
  | { type: 'goal_started'; goalId: string; bounds: GoalBounds }
  | { type: 'decision'; goalId: string; iteration: number; action: string; assessment: string; taskCount: number }
  | { type: 'task_started'; goalId: string; iteration: number; taskId: string; query: string }
  | { type: 'task_result'; goalId: string; iteration: number; outcome: TaskOutcome }
  | { type: 'goal_completed'; goalId: string; iterations: number; tasksDispatched: number; finalAnswer: string; spend: GoalSpend }
  | { type: 'goal_failed'; goalId: string; iterations: number; tasksDispatched: number; failure: GoalFailure; spend: GoalSpend };

export function isTerminalAgentEvent(event: { type: string }): boolean {
  return event.type === 'goal_completed' || event.type === 'goal_failed';
}

export interface TaskRequest {
  goalId: string;
  taskId: string;
  query: string;
  /** Per-task RLM iteration ceiling (bounds.taskMaxIterations). */
  maxIterations: number;
  /** Oracle-attached stub payload for zero-LLM drills; absent in real runs. */
  stub?: unknown;
}

export type TaskRunner = (task: TaskRequest) => Promise<TaskOutcome>;
export type EmitEvent = (event: AgentStreamEvent) => void | Promise<void>;

export interface GoalLoopOptions {
  goalId: string;
  goal: string;
  bounds: GoalBounds;
  decide: DecisionSource;
  runTask: TaskRunner;
  emit: EmitEvent;
}

function emptySpend(): GoalSpend {
  return {
    decisionCalls: 0,
    decisionInputTokens: 0,
    decisionOutputTokens: 0,
    taskInputTokens: 0,
    taskOutputTokens: 0,
    taskSubcalls: 0,
  };
}

export async function runGoalLoop(options: GoalLoopOptions): Promise<GoalResult> {
  const { goalId, goal, bounds, decide, runTask, emit } = options;
  const history: GoalIterationRecord[] = [];
  const spend = emptySpend();
  let iterations = 0;
  let tasksDispatched = 0;

  const fail = async (kind: GoalFailureKind, reason: string): Promise<GoalResult> => {
    const failure: GoalFailure = { kind, reason };
    await emit({ type: 'goal_failed', goalId, iterations, tasksDispatched, failure, spend });
    return { goalId, status: 'failed', finalAnswer: null, failure, iterations, tasksDispatched, spend };
  };

  await emit({ type: 'goal_started', goalId, bounds });

  for (;;) {
    if (iterations >= bounds.maxIterationsPerGoal) {
      return fail(
        'iteration_bound',
        `Goal exceeded ${bounds.maxIterationsPerGoal} decision rounds without finishing`
      );
    }
    iterations++;

    let decided;
    try {
      // Snapshot so a decision source never observes later mutation of
      // the loop's history.
      decided = await decide({ goal, bounds, history: [...history] });
    } catch (error) {
      return fail('decision_error', error instanceof Error ? error.message : String(error));
    }
    const { decision } = decided;
    spend.decisionCalls += decided.usage.calls;
    spend.decisionInputTokens += decided.usage.inputTokens;
    spend.decisionOutputTokens += decided.usage.outputTokens;

    await emit({
      type: 'decision',
      goalId,
      iteration: iterations,
      action: decision.action,
      assessment: decision.assessment,
      taskCount: decision.tasks?.length ?? 0,
    });

    if (decision.action === 'finish') {
      // The schema's cross-field check guarantees a non-empty answer.
      const finalAnswer = decision.finalAnswer ?? '';
      await emit({ type: 'goal_completed', goalId, iterations, tasksDispatched, finalAnswer, spend });
      return { goalId, status: 'completed', finalAnswer, failure: null, iterations, tasksDispatched, spend };
    }
    if (decision.action === 'fail') {
      return fail('orchestrator_fail', decision.reason ?? 'orchestrator declared the goal unachievable');
    }

    // dispatch — bounds are checked BEFORE any task starts, so a
    // tripping decision dispatches nothing.
    const tasks = decision.tasks ?? [];
    if (tasks.length > bounds.maxConcurrentTasks) {
      return fail(
        'concurrency_bound',
        `Decision dispatched ${tasks.length} tasks in one batch (limit ${bounds.maxConcurrentTasks})`
      );
    }
    if (tasksDispatched + tasks.length > bounds.maxTasksPerGoal) {
      return fail(
        'task_bound',
        `Goal would exceed ${bounds.maxTasksPerGoal} total tasks (${tasksDispatched} dispatched, ${tasks.length} requested)`
      );
    }
    tasksDispatched += tasks.length;

    const observations: TaskOutcome[] = await Promise.all(tasks.map(async task => {
      await emit({ type: 'task_started', goalId, iteration: iterations, taskId: task.taskId, query: task.query });
      let outcome: TaskOutcome;
      try {
        outcome = await runTask({
          goalId,
          taskId: task.taskId,
          query: task.query,
          maxIterations: bounds.taskMaxIterations,
          ...(decided.stubs.has(task.taskId) && { stub: decided.stubs.get(task.taskId) }),
        });
      } catch (error) {
        // A crashed task is an observation, not a goal crash.
        outcome = {
          taskId: task.taskId,
          query: task.query,
          status: 'error',
          answer: null,
          toolCalls: null,
          spend: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      await emit({ type: 'task_result', goalId, iteration: iterations, outcome });
      return outcome;
    }));

    for (const outcome of observations) {
      if (outcome.spend) {
        spend.taskInputTokens += outcome.spend.inputTokens;
        spend.taskOutputTokens += outcome.spend.outputTokens;
        spend.taskSubcalls += outcome.spend.subcalls;
      }
    }
    history.push({ decision, observations });
  }
}
