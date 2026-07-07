import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { Registry } from 'prom-client';
import { buildLogger } from './logger';
import { createMetrics } from './metrics';
import {
  collectQueueDepths,
  registerQueueDepthCollection,
  type QueueDepthSource,
} from './queue_gauges';

function sinkLogger() {
  const lines: string[] = [];
  const log = buildLogger({
    level: 'warn',
    destination: new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    }),
  });
  return { log, lines };
}

function fakeQueue(
  name: string,
  counts: Partial<Record<'waiting' | 'active' | 'delayed' | 'failed', number>>
): QueueDepthSource {
  return { name, getJobCounts: async () => counts };
}

describe('collectQueueDepths', () => {
  it('sets one gauge series per queue and state, defaulting absent states to zero', async () => {
    const metrics = createMetrics(new Registry());
    const { log } = sinkLogger();

    await collectQueueDepths(metrics, [
      fakeQueue('extraction_queue', { waiting: 4, active: 1, delayed: 0, failed: 2 }),
      fakeQueue('rlm_queue', { waiting: 0 }),
      fakeQueue('resolution_queue', { waiting: 5 }),
      fakeQueue('agent_queue', { waiting: 1, active: 2 }),
    ], log);

    const text = await metrics.registry.metrics();
    expect(text).toContain('trellis_queue_jobs{queue="extraction_queue",state="waiting"} 4');
    expect(text).toContain('trellis_queue_jobs{queue="extraction_queue",state="failed"} 2');
    expect(text).toContain('trellis_queue_jobs{queue="rlm_queue",state="active"} 0');
    expect(text).toContain('trellis_queue_jobs{queue="resolution_queue",state="waiting"} 5');
    expect(text).toContain('trellis_queue_jobs{queue="agent_queue",state="waiting"} 1');
    expect(text).toContain('trellis_queue_jobs{queue="agent_queue",state="active"} 2');
  });

  it('isolates a Redis read failure to its queue with a warning and failure counter', async () => {
    const metrics = createMetrics(new Registry());
    const { log, lines } = sinkLogger();
    const broken: QueueDepthSource = {
      name: 'invalidation_queue',
      getJobCounts: async () => { throw new Error('redis unavailable'); },
    };

    await collectQueueDepths(metrics, [
      broken,
      fakeQueue('verification_queue', { waiting: 7 }),
    ], log);

    const text = await metrics.registry.metrics();
    expect(text).toContain('trellis_queue_jobs{queue="verification_queue",state="waiting"} 7');
    expect(text).toContain('trellis_queue_depth_read_failures_total{queue="invalidation_queue"} 1');
    expect(text).not.toContain('trellis_queue_jobs{queue="invalidation_queue"');
    const warning = JSON.parse(lines[0]);
    expect(warning).toMatchObject({
      event: 'metrics.queue_depth_read_failed',
      queue: 'invalidation_queue',
    });
    expect(warning.err.message).toBe('redis unavailable');
  });
});

describe('registerQueueDepthCollection', () => {
  it('refreshes gauge values during registry scrape', async () => {
    const metrics = createMetrics(new Registry());
    const { log } = sinkLogger();
    let waiting = 3;
    const queue: QueueDepthSource = {
      name: 'supervisor_queue',
      getJobCounts: async () => ({ waiting }),
    };
    registerQueueDepthCollection(metrics, [queue], log);

    expect(await metrics.registry.metrics())
      .toContain('trellis_queue_jobs{queue="supervisor_queue",state="waiting"} 3');
    waiting = 9;
    expect(await metrics.registry.metrics())
      .toContain('trellis_queue_jobs{queue="supervisor_queue",state="waiting"} 9');
  });
});
