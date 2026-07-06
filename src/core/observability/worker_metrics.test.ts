import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { Registry } from 'prom-client';
import { createMetrics } from './metrics';
import { classifyJobFailure, instrumentWorker } from './worker_metrics';

function unrecoverable(): Error {
  const error = new Error('permanent');
  error.name = 'UnrecoverableError';
  return error;
}

describe('classifyJobFailure', () => {
  it('marks a failure with attempts remaining as retryable', () => {
    expect(classifyJobFailure({ attemptsMade: 1, opts: { attempts: 3 } }, new Error('x')))
      .toBe('failed_retryable');
    expect(classifyJobFailure({ attemptsMade: 2, opts: { attempts: 3 } }, new Error('x')))
      .toBe('failed_retryable');
  });

  it('marks the final attempt as exhausted', () => {
    expect(classifyJobFailure({ attemptsMade: 3, opts: { attempts: 3 } }, new Error('x')))
      .toBe('failed_exhausted');
  });

  it('treats a single-attempt queue (no retry policy) as exhausted on first failure', () => {
    expect(classifyJobFailure({ attemptsMade: 1, opts: {} }, new Error('x')))
      .toBe('failed_exhausted');
  });

  it('classifies UnrecoverableError regardless of remaining attempts', () => {
    expect(classifyJobFailure({ attemptsMade: 1, opts: { attempts: 3 } }, unrecoverable()))
      .toBe('failed_unrecoverable');
  });

  it('treats a missing job as exhausted', () => {
    expect(classifyJobFailure(undefined, new Error('x'))).toBe('failed_exhausted');
  });
});

describe('instrumentWorker', () => {
  it('counts started, completed, and classified failed outcomes with duration', async () => {
    const metrics = createMetrics(new Registry());
    const worker = new EventEmitter();
    instrumentWorker(worker as never, { worker: 'extraction', queue: 'extraction_queue' }, metrics);

    worker.emit('active', {});
    worker.emit('completed', { processedOn: 1_000, finishedOn: 3_500 });
    worker.emit('failed', { attemptsMade: 1, opts: { attempts: 3 } }, new Error('transient'));
    worker.emit('failed', { attemptsMade: 3, opts: { attempts: 3 } }, new Error('final'));
    worker.emit('failed', { attemptsMade: 1, opts: { attempts: 3 } }, unrecoverable());

    const text = await metrics.registry.metrics();
    const labels = 'queue="extraction_queue",worker="extraction"';
    expect(text).toContain(`trellis_jobs_total{${labels},outcome="started"} 1`);
    expect(text).toContain(`trellis_jobs_total{${labels},outcome="completed"} 1`);
    expect(text).toContain(`trellis_jobs_total{${labels},outcome="failed_retryable"} 1`);
    expect(text).toContain(`trellis_jobs_total{${labels},outcome="failed_exhausted"} 1`);
    expect(text).toContain(`trellis_jobs_total{${labels},outcome="failed_unrecoverable"} 1`);
    expect(text).toContain(`trellis_job_duration_seconds_sum{${labels}} 2.5`);
  });

  it('tolerates completed jobs without timing fields', async () => {
    const metrics = createMetrics(new Registry());
    const worker = new EventEmitter();
    instrumentWorker(worker as never, { worker: 'rlm', queue: 'rlm_queue' }, metrics);

    worker.emit('completed', {});

    const text = await metrics.registry.metrics();
    expect(text).toContain('trellis_jobs_total{queue="rlm_queue",worker="rlm",outcome="completed"} 1');
    // No observation means no labeled histogram series — and no crash.
    expect(text).not.toContain('trellis_job_duration_seconds_count{queue="rlm_queue"');
  });
});
