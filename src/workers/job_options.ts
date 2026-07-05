import type { DefaultJobOptions } from 'bullmq';

export interface QueueRetention {
  completedAgeSeconds: number;
  completedCount: number;
  failedAgeSeconds: number;
  failedCount: number;
}

function retentionOptions(retention: QueueRetention): Pick<
  DefaultJobOptions,
  'removeOnComplete' | 'removeOnFail'
> {
  return {
    removeOnComplete: {
      age: retention.completedAgeSeconds,
      count: retention.completedCount,
    },
    removeOnFail: {
      age: retention.failedAgeSeconds,
      count: retention.failedCount,
    },
  };
}

export function buildRetryingJobOptions(
  retention: QueueRetention
): DefaultJobOptions {
  return {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    ...retentionOptions(retention),
  };
}

/**
 * RLM jobs intentionally have no attempts/backoff: the interactive SSE client
 * owns re-dispatch, and a background retry would spend tokens with no listener.
 */
export function buildInteractiveJobOptions(
  retention: QueueRetention
): DefaultJobOptions {
  return retentionOptions(retention);
}
