import { Worker, Job } from 'bullmq';
import { connectionParams } from './queue.js';
import { neo4jDriver, pgPool } from '../config/db.js';
import {
  BeliefCandidate,
  verifyBeliefs,
  makeOpenAIClassifier,
  makeOracleClassifier
} from '../core/graph/verification.js';

// Phase 5 Milestone 3: consumes a sampled batch of cached has_category
// beliefs (enqueued by the sweep scheduler, scripts/verify_sweep.ts) and
// re-checks each against its live source text. Agreement accrues trust
// (verified_count); disagreement quarantines the belief through the
// Phase 4 contested path with contestedReason = 'disputed'.
//
// Same skeleton as the invalidation worker: the sweep produces the
// batch, the worker burns it down.

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
  console.log(
    `[Verify ${job.id}] ${policyLabel ?? 'sweep'}: re-checking ${candidates.length} belief(s)` +
    `${oracle ? ' (oracle dress-rehearsal mode)' : ''}...`
  );

  const report = await verifyBeliefs(neo4jDriver, pgPool, candidates, classifier);

  console.log(
    `[Verify ${job.id}] classified ${report.classified}: ${report.agreed} agreed, ` +
    `${report.disputed} disputed, ${report.skippedNoText} skipped (no live text), ` +
    `${report.usage.subcalls} sub-call(s).`
  );
  for (const d of report.disputes) {
    console.log(`[Verify ${job.id}]   DISPUTED ${d.subject}: cached '${d.label}' vs fresh '${d.disputedLabel}' — quarantined.`);
  }
  return report;
}

export const verificationWorker = new Worker<VerificationJobData>(
  'verification_queue',
  processJob,
  connectionParams
);

verificationWorker.on('completed', job => {
  console.log(`[Verify ${job.id}] Finished.`);
});

verificationWorker.on('failed', (job, err) => {
  console.log(`[Verify ${job?.id}] Failed: ${err.message}`);
});

console.log('Verification Worker started and listening for jobs...');
