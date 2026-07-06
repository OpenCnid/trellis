import type { TrellisMetrics } from './metrics.js';

// BullMQ job-outcome instrumentation. Deliberately event-based and
// duck-typed (anything with Worker's on() signature works) so the
// classification and counting logic is offline-testable without
// importing bullmq workers that immediately open Redis connections.

export type JobFailureOutcome =
  | 'failed_retryable'
  | 'failed_exhausted'
  | 'failed_unrecoverable';

export interface FailedJobShape {
  attemptsMade: number;
  opts: { attempts?: number };
}

/**
 * Classifies a BullMQ 'failed' event. UnrecoverableError (detected by
 * name so no bullmq import is needed here) skips remaining attempts;
 * otherwise the job retries while attemptsMade < configured attempts.
 * A missing job (lock lost, job removed) counts as exhausted.
 */
export function classifyJobFailure(
  job: FailedJobShape | undefined,
  error: Error
): JobFailureOutcome {
  if (error.name === 'UnrecoverableError') return 'failed_unrecoverable';
  if (!job) return 'failed_exhausted';
  const attempts = job.opts.attempts ?? 1;
  return job.attemptsMade < attempts ? 'failed_retryable' : 'failed_exhausted';
}

export interface WorkerLikeEvents {
  on(event: 'active', listener: (job: unknown) => void): unknown;
  on(
    event: 'completed',
    listener: (job: { processedOn?: number; finishedOn?: number }) => void
  ): unknown;
  on(
    event: 'failed',
    listener: (job: FailedJobShape | undefined, error: Error) => void
  ): unknown;
}

export interface WorkerIdentity {
  worker: string;
  queue: string;
}

/**
 * Attaches job-outcome counters and a completed-job duration histogram
 * to a BullMQ Worker's lifecycle events.
 */
export function instrumentWorker(
  events: WorkerLikeEvents,
  identity: WorkerIdentity,
  metrics: TrellisMetrics
): void {
  const labels = { queue: identity.queue, worker: identity.worker };
  events.on('active', () => {
    metrics.jobsTotal.inc({ ...labels, outcome: 'started' });
  });
  events.on('completed', job => {
    metrics.jobsTotal.inc({ ...labels, outcome: 'completed' });
    if (typeof job.processedOn === 'number' && typeof job.finishedOn === 'number') {
      metrics.jobDurationSeconds.observe(labels, (job.finishedOn - job.processedOn) / 1000);
    }
  });
  events.on('failed', (job, error) => {
    metrics.jobsTotal.inc({ ...labels, outcome: classifyJobFailure(job, error) });
  });
}
