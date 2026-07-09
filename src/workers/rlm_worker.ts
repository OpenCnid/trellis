import { Worker, Job } from 'bullmq';
import { connectionParams } from './queue.js';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import IORedis from 'ioredis';
import { config, pgDsn } from '../config/index.js';
import {
  installShutdownSignalHandlers,
  shutdownCoordinator,
} from '../core/runtime/shutdown.js';
import { loggerFor, type Logger } from '../core/observability/logger.js';
import { getMetrics } from '../core/observability/metrics.js';
import { instrumentWorker } from '../core/observability/worker_metrics.js';
import { RlmTelemetryScanner, type RlmTelemetry } from '../core/observability/rlm_telemetry.js';
import { RlmResultScanner, type RlmResultEnvelope } from '../core/observability/rlm_result.js';
import {
  parseRlmJobData,
  buildAgentArgs,
  buildAgentEnv,
  type AgentLineageFiles,
  type RlmJobData,
  type RlmJobCompletion,
} from './rlm_job.js';
import {
  mergeSnapshots,
  parseWorkspaceSnapshot,
  scratchBytesKey,
  scratchKey,
  workspaceRefFor,
  type WorkspaceRef,
  type WorkspaceSnapshot,
} from './workspace_scratch.js';

const redisPublisher = new IORedis({
  host: config.redis.host,
  port: config.redis.port,
});

const log = loggerFor({ worker: 'rlm', queue: 'rlm_queue' });
const metrics = getMetrics();

// One observer pair per job: both scanners watch the identical chunks
// the Redis/SSE path publishes — parsing never alters or gates the byte
// stream, and a malformed line is a structured warning, not a failure.
// The telemetry scanner (T16 §4.3) feeds the RLM spend metrics; the
// result scanner (Session 9 §4.1) captures the task envelope the worker
// returns as its completion value.
interface StreamObservers {
  feed(chunk: string): void;
  flush(): void;
  telemetry(): RlmTelemetry | null;
  result(): RlmResultEnvelope | null;
}

function makeStreamObservers(jobLog: Logger): StreamObservers {
  let lastTelemetry: RlmTelemetry | null = null;
  let lastResult: RlmResultEnvelope | null = null;

  const telemetryScanner = new RlmTelemetryScanner(event => {
    if (event.kind === 'malformed') {
      metrics.rlmTelemetryMalformedTotal.inc();
      jobLog.warn({ event: 'rlm.telemetry_malformed', reason: event.reason });
      return;
    }
    const telemetry = event.telemetry;
    lastTelemetry = telemetry;
    metrics.rlmInputTokensTotal.inc(telemetry.inputTokens);
    metrics.rlmOutputTokensTotal.inc(telemetry.outputTokens);
    metrics.rlmSubcallsTotal.inc(telemetry.subcallCount);
    metrics.rlmToolCallsTotal.inc(telemetry.toolCalls);
    metrics.rlmMcpCallsTotal.inc(telemetry.mcpCalls);
    if (telemetry.executionTimeS !== null) {
      metrics.rlmDurationSeconds.observe(telemetry.executionTimeS);
    }
    jobLog.info({
      event: 'rlm.telemetry',
      inputTokens: telemetry.inputTokens,
      outputTokens: telemetry.outputTokens,
      subcalls: telemetry.subcallCount,
      toolCalls: telemetry.toolCalls,
      executionTimeS: telemetry.executionTimeS,
    });
    if (telemetry.mcpCalls > 0) {
      // T16 house style: counts only — tool names, arguments, and
      // results never reach log lines or metric labels.
      jobLog.info({ event: 'rlm.mcp', mcpCalls: telemetry.mcpCalls });
    }
  });

  const resultScanner = new RlmResultScanner(event => {
    if (event.kind === 'malformed') {
      jobLog.warn({ event: 'rlm.result_malformed', reason: event.reason });
      return;
    }
    lastResult = event.result;
    // The answer text itself never reaches a log line, same rule as the
    // SSE query content.
    jobLog.info({
      event: 'rlm.result',
      status: event.result.status,
      toolCalls: event.result.toolCalls,
    });
  });

  return {
    feed(chunk: string): void {
      telemetryScanner.feed(chunk);
      resultScanner.feed(chunk);
    },
    flush(): void {
      telemetryScanner.flush();
      resultScanner.flush();
    },
    telemetry: () => lastTelemetry,
    result: () => lastResult,
  };
}

function completionValue(jobData: RlmJobData, observers: StreamObservers): RlmJobCompletion {
  return {
    jobId: jobData.jobId,
    ...(jobData.goalId && { goalId: jobData.goalId }),
    ...(jobData.taskId && { taskId: jobData.taskId }),
    result: observers.result(),
    telemetry: observers.telemetry(),
  };
}

// --- Workspace lineage: park and seed (Session 16, design record §5) ----
//
// Redis is a parking lot for end-of-run workspace checkpoints, never a
// live store the model queries: the agent serializes to a worker-named
// temp file, the worker validates and parks the snapshot goal-scoped
// with a TTL (the a2a:task:<id> precedent) under a per-goal parked-bytes
// cap, and a later task in the same goal is seeded from named prior
// tasks at spawn. Parking failures degrade to "nothing parked" (the run
// already produced its result — never fail a paid run over its
// checkpoint); a missing or malformed SEED is the opposite: a readable
// dispatch-time failure before anything is spawned or spent.

// The agent bounds workspace content bytes; the serialized snapshot adds
// stamp overhead and JSON \uXXXX escaping (up to ~2x for non-ASCII), so
// the out-file read cap sits well above the content bound while still
// refusing something absurd.
const WORKSPACE_OUT_MAX_BYTES = 3 * config.workspace.maxBytes + 1024 * 1024;

/**
 * Resolves a job's seedTasks to one merged snapshot. Throws readably on
 * a missing/expired reference or a malformed parked payload.
 */
async function resolveSeedSnapshot(jobData: RlmJobData): Promise<WorkspaceSnapshot | undefined> {
  if (!jobData.seedTasks) return undefined;
  const goalId = jobData.goalId!; // schema: seedTasks requires goalId
  const snapshots: WorkspaceSnapshot[] = [];
  for (const taskId of [...new Set(jobData.seedTasks)]) {
    const raw = await redisPublisher.get(scratchKey(goalId, taskId));
    if (raw === null) {
      throw new Error(
        `Workspace seed unavailable: no parked snapshot for task '${taskId}' in this goal `
        + '(never parked, over the parked-bytes cap, or expired past SCRATCH_TTL_SECONDS)'
      );
    }
    snapshots.push(parseWorkspaceSnapshot(raw, `parked task '${taskId}'`));
  }
  return mergeSnapshots(snapshots);
}

/**
 * Parks one validated snapshot under the goal's scratch keys. Returns
 * the counts-only ref, or undefined when the per-goal parked-bytes cap
 * refuses it. Redis errors degrade to undefined with a warning.
 */
async function parkSnapshot(
  goalId: string,
  taskId: string,
  snapshot: WorkspaceSnapshot,
  jobLog: Logger
): Promise<WorkspaceRef | undefined> {
  const ref = workspaceRefFor(taskId, snapshot);
  try {
    const bytesKey = scratchBytesKey(goalId);
    const goalTotal = await redisPublisher.incrby(bytesKey, ref.bytes);
    await redisPublisher.expire(bytesKey, config.scratch.ttlSeconds);
    if (goalTotal > config.scratch.maxBytesPerGoal) {
      await redisPublisher.decrby(bytesKey, ref.bytes);
      jobLog.warn({
        event: 'rlm.workspace_park_refused',
        reason: 'goal_bytes_cap',
        segments: ref.segments,
        bytes: ref.bytes,
      });
      return undefined;
    }
    await redisPublisher.set(
      scratchKey(goalId, taskId),
      JSON.stringify(snapshot),
      'EX',
      config.scratch.ttlSeconds
    );
  } catch (error) {
    jobLog.warn({ event: 'rlm.workspace_park_failed', err: error });
    return undefined;
  }
  // T16 house style: counts only — content never reaches log lines.
  jobLog.info({ event: 'rlm.workspace_parked', segments: ref.segments, bytes: ref.bytes });
  return ref;
}

/**
 * Reads, validates, and parks the agent's workspace out-file. Missing
 * file means the run had nothing to park; a malformed or oversized file
 * is a warning, never a failure of the run that produced it.
 */
async function parkWorkspaceOutFile(
  jobData: RlmJobData,
  outPath: string,
  jobLog: Logger
): Promise<WorkspaceRef | undefined> {
  let raw: string;
  try {
    const stat = await fs.stat(outPath);
    if (stat.size > WORKSPACE_OUT_MAX_BYTES) {
      jobLog.warn({ event: 'rlm.workspace_out_oversized', bytes: stat.size });
      return undefined;
    }
    raw = await fs.readFile(outPath, 'utf8');
  } catch {
    return undefined; // nothing serialized — an empty workspace parks nothing
  }
  let snapshot: WorkspaceSnapshot;
  try {
    snapshot = parseWorkspaceSnapshot(raw, 'the agent workspace out-file');
  } catch (error) {
    jobLog.warn({
      event: 'rlm.workspace_out_malformed',
      reason: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
  return parkSnapshot(jobData.goalId!, jobData.taskId!, snapshot, jobLog);
}

/**
 * Zero-LLM stub replay (Session 9): publishes the canned stdout through
 * the identical Redis channel and scanner path a real agent run uses —
 * no Python spawn, no paid work. Data-driven only; see RlmStubSchema.
 */
async function runStubJob(
  jobData: RlmJobData,
  observers: StreamObservers,
  channel: string,
  jobLog: Logger
): Promise<RlmJobCompletion> {
  const stub = jobData.stub!;
  if (stub.delayMs > 0) {
    await new Promise(resolve => setTimeout(resolve, stub.delayMs));
  }
  await redisPublisher.publish(channel, JSON.stringify({ type: 'stdout', content: stub.stdout }));
  observers.feed(stub.stdout);
  observers.flush();
  metrics.rlmRunsTotal.inc({ exit_status: stub.exitCode === 0 ? 'success' : 'failure' });
  await redisPublisher.publish(channel, JSON.stringify({ type: 'done', code: stub.exitCode }));
  // Session 16: a stub's snapshot crosses the identical park path a real
  // agent's out-file crosses — before the exit-code throw, exactly like
  // a failed real run still parks its partial workspace.
  let workspaceRef: WorkspaceRef | undefined;
  if (stub.workspaceSnapshot && jobData.goalId && jobData.taskId) {
    workspaceRef = await parkSnapshot(jobData.goalId, jobData.taskId, stub.workspaceSnapshot, jobLog);
  }
  if (stub.exitCode !== 0) {
    throw new Error(`Stub RLM run exited with code ${stub.exitCode}`);
  }
  return { ...completionValue(jobData, observers), ...(workspaceRef && { workspaceRef }) };
}

function runAgentProcess(
  jobData: RlmJobData,
  observers: StreamObservers,
  channel: string,
  lineage: AgentLineageFiles
): Promise<RlmJobCompletion> {
  const pythonScript = path.resolve('src/rlm/trellis_agent.py');

  return new Promise((resolve, reject) => {
    // Forward the validated config to the Python half so both sides of
    // the system derive their connection targets — and, Session 10, the
    // MCP server registry — from the same values.
    const pythonProcess = spawn(config.python.executable, buildAgentArgs(pythonScript, jobData, lineage), {
      env: buildAgentEnv(process.env, {
        pythonPath: config.python.pythonPath,
        neo4j: config.neo4j,
        pgDsn: pgDsn(),
        mcpServersJson: config.mcp.serversJson,
        mcpCredentialEnv: config.mcp.credentialEnv,
        workspace: config.workspace,
        modulesJson: config.modules.selectionJson,
        // Session 20: forwarded only when the operator set the edit
        // root — never enabled by any default (Guardrail 4).
        textedit: config.textedit.editRoot !== undefined
          ? {
              editRoot: config.textedit.editRoot,
              maxFileBytes: config.textedit.maxFileBytes,
              maxFiles: config.textedit.maxFiles,
            }
          : undefined,
      })
    });

    let stderrTail = '';

    pythonProcess.on('error', (err) => {
      const message = `Failed to spawn '${config.python.executable}': ${err.message}. ` +
        `Set PYTHON_EXECUTABLE to your interpreter path.`;
      redisPublisher.publish(channel, JSON.stringify({ type: 'stderr', content: message }));
      redisPublisher.publish(channel, JSON.stringify({ type: 'done', code: -1 }));
      reject(new Error(message));
    });

    pythonProcess.stdout.on('data', (data) => {
      const chunk = data.toString();
      // Publish chunk to a Redis channel unique to this job. The
      // scanners are pure observers of the identical bytes.
      redisPublisher.publish(channel, JSON.stringify({ type: 'stdout', content: chunk }));
      observers.feed(chunk);
    });

    pythonProcess.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderrTail = (stderrTail + chunk).slice(-2000);
      redisPublisher.publish(channel, JSON.stringify({ type: 'stderr', content: chunk }));
    });

    pythonProcess.on('close', (code) => {
      observers.flush();
      metrics.rlmRunsTotal.inc({ exit_status: code === 0 ? 'success' : 'failure' });
      // Signal completion
      redisPublisher.publish(channel, JSON.stringify({ type: 'done', code }));
      if (code === 0) {
        resolve(completionValue(jobData, observers));
      } else {
        const hint = /ModuleNotFoundError.*rlms/s.test(stderrTail)
          ? " The 'rlms' package was not found — install it for this interpreter or point PYTHONPATH at its site-packages."
          : '';
        reject(new Error(`Python process exited with code ${code}.${hint} stderr: ${stderrTail.trim()}`));
      }
    });
  });
}

export const rlmWorker = new Worker('rlm_queue', async (job: Job): Promise<RlmJobCompletion> => {
  const jobData = parseRlmJobData(job.data);

  // jobId is the SSE channel id; the query content is never logged.
  // goalId/taskId are optional orchestration correlation (Session 9).
  const jobLog = log.child({
    jobId: jobData.jobId,
    attempt: job.attemptsMade + 1,
    ...(jobData.goalId && { goalId: jobData.goalId }),
    ...(jobData.taskId && { taskId: jobData.taskId }),
  });

  const channel = `rlm-stream:${jobData.jobId}`;
  const observers = makeStreamObservers(jobLog);

  // Session 16: seeds resolve BEFORE anything runs — a broken reference
  // is a readable dispatch-time failure with zero spend, never a run
  // that silently starts empty.
  const seedSnapshot = await resolveSeedSnapshot(jobData);

  if (jobData.stub) {
    return runStubJob(jobData, observers, channel, jobLog);
  }

  // Lineage temp files are worker-named (jobId is a fresh uuid), written
  // under the OS temp dir, and reaped whatever the run's outcome.
  const goalCorrelated = jobData.goalId !== undefined && jobData.taskId !== undefined;
  const lineage: AgentLineageFiles = {
    ...(goalCorrelated && {
      workspaceOut: path.join(os.tmpdir(), `trellis-ws-out-${jobData.jobId}.json`),
    }),
    ...(seedSnapshot && {
      seedWorkspace: path.join(os.tmpdir(), `trellis-ws-seed-${jobData.jobId}.json`),
    }),
  };
  try {
    if (lineage.seedWorkspace) {
      await fs.writeFile(lineage.seedWorkspace, JSON.stringify(seedSnapshot), 'utf8');
    }
    let completion: RlmJobCompletion;
    try {
      completion = await runAgentProcess(jobData, observers, channel, lineage);
    } catch (error) {
      // A failed run may still have serialized a partial workspace — it
      // is parked so a retry task can inherit it (the orchestrator knows
      // the taskId from the error observation).
      if (lineage.workspaceOut) {
        await parkWorkspaceOutFile(jobData, lineage.workspaceOut, jobLog);
      }
      throw error;
    }
    if (lineage.workspaceOut) {
      const workspaceRef = await parkWorkspaceOutFile(jobData, lineage.workspaceOut, jobLog);
      if (workspaceRef) completion.workspaceRef = workspaceRef;
    }
    return completion;
  } finally {
    for (const file of [lineage.workspaceOut, lineage.seedWorkspace]) {
      if (file) await fs.rm(file, { force: true });
    }
  }
}, connectionParams);
instrumentWorker(rlmWorker, { worker: 'rlm', queue: 'rlm_queue' }, metrics);

rlmWorker.on('completed', job => {
  log.info({ event: 'rlm.job_completed', jobId: job.id });
});

rlmWorker.on('failed', (job, err) => {
  log.warn({ event: 'rlm.job_failed', jobId: job?.id, err });
});

log.info({ event: 'rlm.worker_started' });

installShutdownSignalHandlers();
shutdownCoordinator.register('worker.rlm', 80, () => rlmWorker.close());
shutdownCoordinator.register('redis.rlm_publisher', 60, async () => {
  await redisPublisher.quit();
});
