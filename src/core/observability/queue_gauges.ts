import type { Logger } from './logger.js';
import type { TrellisMetrics } from './metrics.js';

// Queue-depth gauges are refreshed at scrape time (no polling timer to
// manage or shut down): collectQueueDepths runs inside the registry's
// collect pass, reads live BullMQ counts, and updates trellis_queue_jobs.
// A per-queue Redis read failure emits a structured warning and a
// failure counter but leaves the other queues' fresh values intact —
// a scrape must never throw because Redis blinked.

export const QUEUE_JOB_STATES = ['waiting', 'active', 'delayed', 'failed'] as const;
export type QueueJobState = (typeof QUEUE_JOB_STATES)[number];

export interface QueueDepthSource {
  name: string;
  getJobCounts(
    ...states: QueueJobState[]
  ): Promise<Partial<Record<QueueJobState, number>>>;
}

export async function collectQueueDepths(
  metrics: TrellisMetrics,
  queues: readonly QueueDepthSource[],
  log: Logger
): Promise<void> {
  await Promise.all(queues.map(async queue => {
    try {
      const counts = await queue.getJobCounts(...QUEUE_JOB_STATES);
      for (const state of QUEUE_JOB_STATES) {
        metrics.queueJobs.set({ queue: queue.name, state }, counts[state] ?? 0);
      }
    } catch (error) {
      metrics.queueDepthReadFailuresTotal.inc({ queue: queue.name });
      log.warn({
        event: 'metrics.queue_depth_read_failed',
        queue: queue.name,
        err: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }));
}

/**
 * Hooks queue-depth collection into the registry scrape. prom-client
 * awaits async collect() callbacks during registry.metrics().
 */
export function registerQueueDepthCollection(
  metrics: TrellisMetrics,
  queues: readonly QueueDepthSource[],
  log: Logger
): void {
  const gauge = metrics.queueJobs as unknown as {
    collect?: () => Promise<void>;
  };
  gauge.collect = () => collectQueueDepths(metrics, queues, log);
}
