import { describe, expect, it } from 'vitest';
import { Registry } from 'prom-client';
import { createMetrics } from './metrics';

describe('createMetrics', () => {
  it('exposes Prometheus text with the trellis metric names', async () => {
    const metrics = createMetrics(new Registry());
    metrics.httpRequestsTotal.inc({ method: 'POST', route: '/ingest', status_class: '2xx' });
    metrics.jobsTotal.inc({ queue: 'extraction_queue', worker: 'extraction', outcome: 'completed' });
    metrics.llmInputTokensTotal.inc({ operation: 'extraction', model: 'm' }, 120);

    const text = await metrics.registry.metrics();
    expect(text).toContain('trellis_http_requests_total{method="POST",route="/ingest",status_class="2xx"} 1');
    expect(text).toContain('trellis_jobs_total{queue="extraction_queue",worker="extraction",outcome="completed"} 1');
    expect(text).toContain('trellis_llm_input_tokens_total{operation="extraction",model="m"} 120');
    expect(metrics.registry.contentType).toContain('text/plain');
  });

  it('creates independent registries without duplicate-registration failures', async () => {
    const a = createMetrics(new Registry());
    const b = createMetrics(new Registry());
    a.extractionDroppedActionsTotal.inc(3);

    expect(await a.registry.metrics()).toContain('trellis_extraction_dropped_actions_total 3');
    expect(await b.registry.metrics()).toContain('trellis_extraction_dropped_actions_total 0');
  });
});
