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
import { loggerFor } from '../core/observability/logger.js';
import { getMetrics } from '../core/observability/metrics.js';
import { instrumentWorker } from '../core/observability/worker_metrics.js';
import { RlmTelemetryScanner } from '../core/observability/rlm_telemetry.js';

const redisPublisher = new IORedis({
  host: config.redis.host,
  port: config.redis.port,
});

const log = loggerFor({ worker: 'rlm', queue: 'rlm_queue' });
const metrics = getMetrics();

export const rlmWorker = new Worker('rlm_queue', async (job: Job) => {
  const { query, jobId } = job.data;

  if (!query || !jobId) {
    throw new Error('Missing query or jobId in job data');
  }

  // jobId is the SSE channel id; the query content is never logged.
  const jobLog = log.child({ jobId, attempt: job.attemptsMade + 1 });

  const pythonScript = path.resolve('src/rlm/trellis_agent.py');

  return new Promise((resolve, reject) => {
    // Forward the validated config to the Python half so both sides of
    // the system derive their connection targets from the same values.
    const pythonProcess = spawn(config.python.executable, [pythonScript, '--query', query], {
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

    // T16 §4.3: the agent emits one machine-readable TRELLIS_TELEMETRY
    // line on stdout. The scanner observes the same chunks the Redis/SSE
    // path publishes — parsing never alters or gates the byte stream, and
    // a malformed line is a structured warning, not a job failure.
    const telemetryScanner = new RlmTelemetryScanner(event => {
      if (event.kind === 'malformed') {
        metrics.rlmTelemetryMalformedTotal.inc();
        jobLog.warn({ event: 'rlm.telemetry_malformed', reason: event.reason });
        return;
      }
      const telemetry = event.telemetry;
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

    pythonProcess.on('error', (err) => {
      const message = `Failed to spawn '${config.python.executable}': ${err.message}. ` +
        `Set PYTHON_EXECUTABLE to your interpreter path.`;
      redisPublisher.publish(`rlm-stream:${jobId}`, JSON.stringify({ type: 'stderr', content: message }));
      redisPublisher.publish(`rlm-stream:${jobId}`, JSON.stringify({ type: 'done', code: -1 }));
      reject(new Error(message));
    });

    pythonProcess.stdout.on('data', (data) => {
      const chunk = data.toString();
      // Publish chunk to a Redis channel unique to this job. The
      // telemetry scanner is a pure observer of the identical bytes.
      redisPublisher.publish(`rlm-stream:${jobId}`, JSON.stringify({ type: 'stdout', content: chunk }));
      telemetryScanner.feed(chunk);
    });

    pythonProcess.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderrTail = (stderrTail + chunk).slice(-2000);
      redisPublisher.publish(`rlm-stream:${jobId}`, JSON.stringify({ type: 'stderr', content: chunk }));
    });

    pythonProcess.on('close', (code) => {
      telemetryScanner.flush();
      metrics.rlmRunsTotal.inc({ exit_status: code === 0 ? 'success' : 'failure' });
      // Signal completion
      redisPublisher.publish(`rlm-stream:${jobId}`, JSON.stringify({ type: 'done', code }));
      if (code === 0) {
        resolve(`Job ${jobId} completed successfully`);
      } else {
        const hint = /ModuleNotFoundError.*rlms/s.test(stderrTail)
          ? " The 'rlms' package was not found — install it for this interpreter or point PYTHONPATH at its site-packages."
          : '';
        reject(new Error(`Python process exited with code ${code}.${hint} stderr: ${stderrTail.trim()}`));
      }
    });
  });
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
