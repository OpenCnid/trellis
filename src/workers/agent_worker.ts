import { Worker, Job, QueueEvents } from 'bullmq';
import crypto from 'crypto';
import IORedis from 'ioredis';
import { connectionParams, rlmQueue } from './queue.js';
import { config } from '../config/index.js';
import {
  installShutdownSignalHandlers,
  shutdownCoordinator,
} from '../core/runtime/shutdown.js';
import { loggerFor, type Logger } from '../core/observability/logger.js';
import { getMetrics } from '../core/observability/metrics.js';
import { instrumentWorker } from '../core/observability/worker_metrics.js';
import { recordLlmCall } from '../core/observability/llm_usage.js';
import {
  runGoalLoop,
  type AgentStreamEvent,
  type EmitEvent,
  type GoalResult,
  type TaskRequest,
  type TaskRunner,
} from '../core/agent/goal_loop.js';
import type { TaskOutcome } from '../core/agent/decision.js';
import {
  makeOpenAIDecisionSource,
  makeOracleDecisionSource,
  type DecisionSource,
} from '../core/agent/decision_source.js';
import { parseAgentJobData } from './agent_job.js';
import type { RlmJobCompletion } from './rlm_job.js';

// Session 9: the agentic orchestration worker. One agent_queue job is
// one goal. The orchestrator decides (same LLM, orchestrator system
// prompt, T8 boundary — or the zero-LLM oracle in drills); every task
// is one ordinary rlm_queue job whose completion value carries the
// TRELLIS_RESULT envelope; goal-level events stream over Redis pub/sub
// to the /api/agent-stream SSE endpoint. All LLM calls stay in this
// process and the RLM process — the API never calls a model, and the
// orchestrator never touches either database.

const log = loggerFor({ worker: 'agent', queue: 'agent_queue' });
const metrics = getMetrics();

const redisPublisher = new IORedis({
  host: config.redis.host,
  port: config.redis.port,
});

// Awaiting task completion values needs a QueueEvents subscriber on the
// task queue (BullMQ's waitUntilFinished contract); it holds its own
// blocking connection.
const rlmQueueEvents = new QueueEvents('rlm_queue', {
  connection: { host: config.redis.host, port: config.redis.port },
});

// A task whose worker died must not hang the goal forever. The RLM
// benchmark client allows 20 minutes per run; this ceiling sits above it.
const TASK_WAIT_TTL_MS = 30 * 60 * 1000;

function telemetrySpend(completion: RlmJobCompletion): TaskOutcome['spend'] {
  if (!completion.telemetry) return null;
  return {
    inputTokens: completion.telemetry.inputTokens,
    outputTokens: completion.telemetry.outputTokens,
    subcalls: completion.telemetry.subcallCount,
  };
}

/**
 * Runs one task as an rlm_queue job and maps its completion value to an
 * observation. Rejections (spawn failures, nonzero exits, malformed
 * payloads) surface as 'error' outcomes in the goal loop's catch — a
 * task failure is an observation, never a goal crash.
 */
const runRlmTask: TaskRunner = async (task: TaskRequest): Promise<TaskOutcome> => {
  // The job id doubles as the rlm-stream channel id, exactly like the
  // SSE endpoint's jobId; goalId/taskId ride along for correlation.
  const jobId = crypto.randomUUID();
  const job = await rlmQueue.add('rlm_job', {
    query: task.query,
    jobId,
    goalId: task.goalId,
    taskId: task.taskId,
    maxIterations: task.maxIterations,
    ...(task.stub !== undefined && { stub: task.stub }),
  });
  const completion = (await job.waitUntilFinished(rlmQueueEvents, TASK_WAIT_TTL_MS)) as RlmJobCompletion;
  if (!completion?.result) {
    return {
      taskId: task.taskId,
      query: task.query,
      status: 'error',
      answer: null,
      toolCalls: null,
      spend: completion ? telemetrySpend(completion) : null,
      error: 'RLM run completed without a TRELLIS_RESULT envelope',
    };
  }
  return {
    taskId: task.taskId,
    query: task.query,
    status: completion.result.status,
    answer: completion.result.answer,
    toolCalls: completion.result.toolCalls,
    spend: telemetrySpend(completion),
  };
};

/**
 * Single sink for goal events: bounded-field logs and metrics (T16 —
 * goal text and task queries never reach either), then the SSE publish.
 */
function makeEventSink(goalId: string, goalLog: Logger): EmitEvent {
  return async (event: AgentStreamEvent) => {
    switch (event.type) {
      case 'goal_started':
        goalLog.info({ event: 'agent.goal_started', bounds: event.bounds });
        break;
      case 'decision':
        metrics.agentDecisionsTotal.inc({ action: event.action });
        goalLog.info({
          event: 'agent.decision',
          iteration: event.iteration,
          action: event.action,
          taskCount: event.taskCount,
        });
        break;
      case 'task_started':
        goalLog.info({
          event: 'agent.task_dispatched',
          iteration: event.iteration,
          taskId: event.taskId,
        });
        break;
      case 'task_result':
        metrics.agentTasksTotal.inc({ outcome: event.outcome.status });
        goalLog.info({
          event: 'agent.task_completed',
          iteration: event.iteration,
          taskId: event.outcome.taskId,
          status: event.outcome.status,
          toolCalls: event.outcome.toolCalls,
        });
        break;
      case 'goal_completed':
        metrics.agentGoalsTotal.inc({ outcome: 'completed' });
        goalLog.info({
          event: 'agent.goal_completed',
          iterations: event.iterations,
          tasksDispatched: event.tasksDispatched,
          spend: event.spend,
        });
        break;
      case 'goal_failed':
        metrics.agentGoalsTotal.inc({ outcome: 'failed' });
        goalLog.warn({
          event: 'agent.goal_failed',
          iterations: event.iterations,
          tasksDispatched: event.tasksDispatched,
          failureKind: event.failure.kind,
          spend: event.spend,
        });
        break;
    }
    await redisPublisher.publish(`agent-stream:${goalId}`, JSON.stringify(event));
  };
}

async function processGoal(job: Job): Promise<GoalResult> {
  const { goal, goalId, oracle } = parseAgentJobData(job.data);
  const goalLog = log.child({ goalId, attempt: job.attemptsMade + 1 });

  let decide: DecisionSource;
  if (oracle) {
    decide = makeOracleDecisionSource(oracle);
  } else {
    // Per-call orchestration spend is recorded here (worker process,
    // T16 house style); the loop separately aggregates per-goal totals
    // for the terminal stream event.
    const base = makeOpenAIDecisionSource();
    decide = async input => {
      const result = await base(input);
      recordLlmCall(metrics, 'orchestration', config.llm.extractionModel, {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      });
      return result;
    };
  }

  return runGoalLoop({
    goalId,
    goal,
    bounds: {
      maxIterationsPerGoal: config.agent.maxIterationsPerGoal,
      maxTasksPerGoal: config.agent.maxTasksPerGoal,
      maxConcurrentTasks: config.agent.maxConcurrentTasks,
      taskMaxIterations: config.agent.taskMaxIterations,
    },
    decide,
    runTask: runRlmTask,
    emit: makeEventSink(goalId, goalLog),
  });
}

export const agentWorker = new Worker('agent_queue', processGoal, {
  ...connectionParams,
  // Goals admitted by the API gate should actually run concurrently
  // rather than queue behind one another.
  concurrency: config.agent.maxConcurrentGoals,
});
instrumentWorker(agentWorker, { worker: 'agent', queue: 'agent_queue' }, metrics);

agentWorker.on('completed', job => {
  log.info({ event: 'agent.job_completed', jobId: job.id });
});

agentWorker.on('failed', (job, err) => {
  log.warn({ event: 'agent.job_failed', jobId: job?.id, err });
});

log.info({ event: 'agent.worker_started' });

installShutdownSignalHandlers();
shutdownCoordinator.register('worker.agent', 80, () => agentWorker.close());
shutdownCoordinator.register('bullmq.rlm_queue_events', 70, () => rlmQueueEvents.close());
shutdownCoordinator.register('redis.agent_publisher', 60, async () => {
  await redisPublisher.quit();
});
