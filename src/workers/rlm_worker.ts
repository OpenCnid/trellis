import { Worker, Job } from 'bullmq';
import { connectionParams } from './queue.js';
import { spawn } from 'child_process';
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
  type RlmJobData,
  type RlmJobCompletion,
} from './rlm_job.js';

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

/**
 * Zero-LLM stub replay (Session 9): publishes the canned stdout through
 * the identical Redis channel and scanner path a real agent run uses —
 * no Python spawn, no paid work. Data-driven only; see RlmStubSchema.
 */
async function runStubJob(
  jobData: RlmJobData,
  observers: StreamObservers,
  channel: string
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
  if (stub.exitCode !== 0) {
    throw new Error(`Stub RLM run exited with code ${stub.exitCode}`);
  }
  return completionValue(jobData, observers);
}

function runAgentProcess(
  jobData: RlmJobData,
  observers: StreamObservers,
  channel: string
): Promise<RlmJobCompletion> {
  const pythonScript = path.resolve('src/rlm/trellis_agent.py');

  return new Promise((resolve, reject) => {
    // Forward the validated config to the Python half so both sides of
    // the system derive their connection targets from the same values.
    const pythonProcess = spawn(config.python.executable, buildAgentArgs(pythonScript, jobData), {
      env: {
        ...process.env,
        ...(config.python.pythonPath && { PYTHONPATH: config.python.pythonPath }),
        NEO4J_URI: config.neo4j.uri,
        NEO4J_USER: config.neo4j.user,
        NEO4J_PASSWORD: config.neo4j.password,
        PG_DSN: pgDsn(),
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8'
      }
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

  if (jobData.stub) {
    return runStubJob(jobData, observers, channel);
  }
  return runAgentProcess(jobData, observers, channel);
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
