import { Worker, Job } from 'bullmq';
import { connectionParams } from './queue.js';
import { neo4jDriver, pgPool } from '../config/db.js';
import {
  BeliefCandidate,
  VerificationReport,
  verifyBeliefs,
  makeOpenAIClassifier,
  makeOracleClassifier
} from '../core/graph/verification.js';
import {
  EntailmentPair,
  EntailmentReport,
  detectUnsupportedCitations,
  makeOpenAIEntailmentJudge,
  makeOracleEntailmentJudge
} from '../core/graph/entailment_detection.js';
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
//
// Session 32 (PROVENANCE_THREADING.md §5.4): the same queue also carries
// entailment-detector sweeps under the distinct job name
// 'entailment_sweep' (enqueued by scripts/entailment_sweep.ts) — sampled
// (edge, cited-hash) pairs judged for claim support; unsupported pairs
// contest the edge with contestedReason = 'unsupported_citation'. Every
// other job name processes exactly as before.

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

export interface EntailmentJobData {
  pairs: EntailmentPair[];
  /**
   * LLM-free dress-rehearsal mode: a ground-truth entailmentPairKey ->
   * supported map used in place of the judge. Absent in real sweeps.
   */
  oracle?: Record<string, boolean>;
  /** Human-readable tag for logs/results (e.g. 'rate=0.1'). */
  policyLabel?: string;
}

async function processEntailmentJob(job: Job<EntailmentJobData>) {
  const { pairs, oracle, policyLabel } = job.data;
  const judge = oracle ? makeOracleEntailmentJudge(oracle) : makeOpenAIEntailmentJudge();
  const jobLog = log.child({ jobId: job.id, attempt: job.attemptsMade + 1 });
  jobLog.info({
    event: 'entailment.sweep_started',
    policyLabel: policyLabel ?? 'sweep',
    pairCount: pairs.length,
    oracleMode: Boolean(oracle),
  });

  const report = await detectUnsupportedCitations(neo4jDriver, pgPool, pairs, judge);

  metrics.entailmentPairsTotal.inc({ result: 'judged' }, report.judged);
  metrics.entailmentPairsTotal.inc({ result: 'supported' }, report.supported);
  metrics.entailmentPairsTotal.inc({ result: 'flagged' }, report.flagged);
  metrics.entailmentPairsTotal.inc({ result: 'skipped_no_text' }, report.skippedNoText);
  metrics.entailmentPairsTotal.inc({ result: 'skipped_no_answer' }, report.skippedNoAnswer);
  if (!oracle && report.usage.subcalls > 0) {
    const labels = { operation: 'entailment', model: config.llm.extractionModel };
    metrics.llmCallsTotal.inc(labels, report.usage.subcalls);
    if (report.usage.inputTokens > 0) metrics.llmInputTokensTotal.inc(labels, report.usage.inputTokens);
    if (report.usage.outputTokens > 0) metrics.llmOutputTokensTotal.inc(labels, report.usage.outputTokens);
  }

  jobLog.info({
    event: 'entailment.sweep_completed',
    judged: report.judged,
    supported: report.supported,
    flagged: report.flagged,
    edgesFlagged: report.edgesFlagged,
    skippedNoText: report.skippedNoText,
    skippedNoAnswer: report.skippedNoAnswer,
    subcalls: report.usage.subcalls,
  });
  // T16: entity names may appear in log content; hashes never do.
  for (const f of report.flags) {
    jobLog.warn({
      event: 'entailment.pair_flagged',
      subject: f.subject,
      verb: f.verb,
      object: f.object,
    });
  }
  return report;
}

export const verificationWorker = new Worker<
  VerificationJobData | EntailmentJobData,
  VerificationReport | EntailmentReport
>(
  'verification_queue',
  job => withWorkerRetryPolicy<VerificationReport | EntailmentReport>(
    {
      worker: 'verification',
      jobId: job.id,
      attempt: job.attemptsMade + 1,
    },
    () => job.name === 'entailment_sweep'
      ? processEntailmentJob(job as Job<EntailmentJobData>)
      : processJob(job as Job<VerificationJobData>)
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
