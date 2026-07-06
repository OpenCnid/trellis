import { Worker, Job } from 'bullmq';
import { connectionParams } from './queue.js';
import { neo4jDriver, pgPool } from '../config/db.js';
import {
  BeliefCandidate,
  verifyBeliefs,
  makeOpenAIClassifier,
  makeOracleClassifier
} from '../core/graph/verification.js';
import { withWorkerRetryPolicy } from '../core/async/retry.js';
import {
  installShutdownSignalHandlers,
  shutdownCoordinator,
} from '../core/runtime/shutdown.js';
import { config } from '../config/index.js';
import { loggerFor } from '../core/observability/logger.js';
import { getMetrics } from '../core/observability/metrics.js';
import { instrumentWorker } from '../core/observability/worker_metrics.js';

// Phase 5 Milestone 3: consumes a sampled batch of cached has_category
// beliefs (enqueued by the sweep scheduler, scripts/verify_sweep.ts) and
// re-checks each against its live source text. Agreement accrues trust
// (verified_count); disagreement quarantines the belief through the
// Phase 4 contested path with contestedReason = 'disputed'.
//
// Same skeleton as the invalidation worker: the sweep produces the
// batch, the worker burns it down.

const log = loggerFor({ worker: 'verification', queue: 'verification_queue' });
const metrics = getMetrics();

export interface VerificationJobData {
  candidates: BeliefCandidate[];
  /**
   * LLM-free dress-rehearsal mode: a ground-truth id -> label map used
   * in place of the sub-LLM, so detection mechanics are testable
   * without spending tokens. Absent in production sweeps.
   */
  oracle?: Record<string, string>;
  /** Human-readable tag for logs/results (e.g. 'p=0.05'). */
  policyLabel?: string;
}

async function processJob(job: Job<VerificationJobData>) {
  const { candidates, oracle, policyLabel } = job.data;
  const classifier = oracle ? makeOracleClassifier(oracle) : makeOpenAIClassifier();
  const jobLog = log.child({ jobId: job.id, attempt: job.attemptsMade + 1 });
  jobLog.info({
    event: 'verification.sweep_started',
    policyLabel: policyLabel ?? 'sweep',
    candidateCount: candidates.length,
    oracleMode: Boolean(oracle),
  });

  const report = await verifyBeliefs(neo4jDriver, pgPool, candidates, classifier);

  metrics.verificationBeliefsTotal.inc({ result: 'classified' }, report.classified);
  metrics.verificationBeliefsTotal.inc({ result: 'agreed' }, report.agreed);
  metrics.verificationBeliefsTotal.inc({ result: 'disputed' }, report.disputed);
  metrics.verificationBeliefsTotal.inc({ result: 'skipped_no_text' }, report.skippedNoText);
  metrics.verificationBeliefsTotal.inc({ result: 'skipped_no_answer' }, report.skippedNoAnswer);
  if (!oracle && report.usage.subcalls > 0) {
    // The classifier aggregates its batched sub-call usage into the report.
    const labels = { operation: 'verification', model: config.llm.extractionModel };
    metrics.llmCallsTotal.inc(labels, report.usage.subcalls);
    if (report.usage.inputTokens > 0) metrics.llmInputTokensTotal.inc(labels, report.usage.inputTokens);
    if (report.usage.outputTokens > 0) metrics.llmOutputTokensTotal.inc(labels, report.usage.outputTokens);
  }

  jobLog.info({
    event: 'verification.sweep_completed',
    classified: report.classified,
    agreed: report.agreed,
    disputed: report.disputed,
    skippedNoText: report.skippedNoText,
    skippedNoAnswer: report.skippedNoAnswer,
    subcalls: report.usage.subcalls,
  });
  for (const d of report.disputes) {
    jobLog.warn({
      event: 'verification.belief_disputed',
      subject: d.subject,
      cachedLabel: d.label,
      disputedLabel: d.disputedLabel,
    });
  }
  return report;
}

export const verificationWorker = new Worker<VerificationJobData>(
  'verification_queue',
  job => withWorkerRetryPolicy(
    {
      worker: 'verification',
      jobId: job.id,
      attempt: job.attemptsMade + 1,
    },
    () => processJob(job)
  ),
  connectionParams
);
instrumentWorker(verificationWorker, { worker: 'verification', queue: 'verification_queue' }, metrics);

verificationWorker.on('completed', job => {
  log.info({ event: 'verification.job_completed', jobId: job.id });
});

verificationWorker.on('failed', (job, err) => {
  log.warn({ event: 'verification.job_failed', jobId: job?.id, err });
});

log.info({ event: 'verification.worker_started' });

installShutdownSignalHandlers();
shutdownCoordinator.register(
  'worker.verification',
  80,
  () => verificationWorker.close()
);
