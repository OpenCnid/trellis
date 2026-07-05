import { describe, expect, it } from 'vitest';
import {
  buildInteractiveJobOptions,
  buildRetryingJobOptions,
  QueueRetention,
} from './job_options';

const retention: QueueRetention = {
  completedAgeSeconds: 3600,
  completedCount: 1000,
  failedAgeSeconds: 604800,
  failedCount: 5000,
};

describe('queue job options', () => {
  it('bounds retries and retained job history for background queues', () => {
    expect(buildRetryingJobOptions(retention)).toEqual({
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 604800, count: 5000 },
    });
  });

  it('keeps RLM retries disabled while still bounding retained jobs', () => {
    const options = buildInteractiveJobOptions(retention);
    expect(options).toEqual({
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 604800, count: 5000 },
    });
    expect(options).not.toHaveProperty('attempts');
    expect(options).not.toHaveProperty('backoff');
  });
});
