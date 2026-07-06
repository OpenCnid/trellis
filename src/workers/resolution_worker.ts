import { Worker, Job } from 'bullmq';
import { connectionParams } from './queue.js';
import { neo4jDriver, pgPool } from '../config/db.js';
import {
  resolveCandidatePairs,
  makeOpenAIAdjudicator,
  makeOracleAdjudicator,
} from '../core/graph/alias_resolution.js';
import type { CandidatePair } from '../core/graph/alias_candidates.js';
import { recordResolutionTelemetry } from '../core/graph/resolution_telemetry.js';
import { withWorkerRetryPolicy } from '../core/async/retry.js';
import {
  installShutdownSignalHandlers,
  shutdownCoordinator,
} from '../core/runtime/shutdown.js';
import { config } from '../config/index.js';
import { loggerFor } from '../core/observability/logger.js';
import { getMetrics } from '../core/observability/metrics.js';
import { instrumentWorker } from '../core/observability/worker_metrics.js';

// Session 5: consumes a candidate-pair batch (enqueued by the sweep
// scheduler, scripts/resolve_sweep.ts) and adjudicates whether each pair
// denotes the same real-world entity, from the pairs' live source text.
// Verdicts land as SAME_AS / DISTINCT_FROM overlay edges with union
// provenance — entity identity is never rewritten.
//
// Same skeleton as the verification worker: the sweep produces the
// batch, the worker burns it down. Adjudication is idempotent (verdict
// edges MERGE on the pair), so the queue's standard retrying defaults
// apply.

const log = loggerFor({ worker: 'resolution', queue: 'resolution_queue' });
const metrics = getMetrics();

export interface ResolutionJobData {
  pairs: CandidatePair[];
  /**
   * LLM-free dress-rehearsal mode: a ground-truth pairId -> sameEntity
   * map used in place of the sub-LLM. Absent in production sweeps.
   */
  oracle?: Record<string, boolean>;
  /** Human-readable tag for logs (e.g. 'max=200'). */
  policyLabel?: string;
}

async function processJob(job: Job<ResolutionJobData>) {
  const { pairs, oracle, policyLabel } = job.data;
  const adjudicator = oracle ? makeOracleAdjudicator(oracle) : makeOpenAIAdjudicator();
  const method = oracle ? ('oracle' as const) : ('llm' as const);
  const model = oracle ? null : config.llm.extractionModel;
  const jobLog = log.child({ jobId: job.id, attempt: job.attemptsMade + 1 });
  jobLog.info({
    event: 'resolution.sweep_started',
    policyLabel: policyLabel ?? 'sweep',
    pairCount: pairs.length,
    oracleMode: Boolean(oracle),
  });

  const report = await resolveCandidatePairs(neo4jDriver, pgPool, pairs, adjudicator, {
    method,
    model,
  });
  recordResolutionTelemetry(metrics, jobLog, report, {
    oracleMode: Boolean(oracle),
    model: config.llm.extractionModel,
  });
  return report;
}

export const resolutionWorker = new Worker<ResolutionJobData>(
  'resolution_queue',
  job => withWorkerRetryPolicy(
    {
      worker: 'resolution',
      jobId: job.id,
      attempt: job.attemptsMade + 1,
    },
    () => processJob(job)
  ),
  connectionParams
);
instrumentWorker(resolutionWorker, { worker: 'resolution', queue: 'resolution_queue' }, metrics);

resolutionWorker.on('completed', job => {
  log.info({ event: 'resolution.job_completed', jobId: job.id });
});

resolutionWorker.on('failed', (job, err) => {
  log.warn({ event: 'resolution.job_failed', jobId: job?.id, err });
});

log.info({ event: 'resolution.worker_started' });

installShutdownSignalHandlers();
shutdownCoordinator.register(
  'worker.resolution',
  80,
  () => resolutionWorker.close()
);
