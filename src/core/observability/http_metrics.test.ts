import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { Registry } from 'prom-client';
import { createMetrics } from './metrics';
import { httpMetricsMiddleware, normalizeRoute, statusClass } from './http_metrics';

describe('normalizeRoute', () => {
  it('maps the fixed operational routes to themselves', () => {
    expect(normalizeRoute('/ingest')).toBe('/ingest');
    expect(normalizeRoute('/retrieve')).toBe('/retrieve');
    expect(normalizeRoute('/api/rlm-stream')).toBe('/api/rlm-stream');
    expect(normalizeRoute('/healthz')).toBe('/healthz');
    expect(normalizeRoute('/metrics')).toBe('/metrics');
    expect(normalizeRoute('/ingest/')).toBe('/ingest');
  });

  it('collapses everything else so request paths never mint label values', () => {
    expect(normalizeRoute('/retrieve/globex corporation')).toBe('unmatched');
    expect(normalizeRoute('/admin.php')).toBe('unmatched');
    expect(normalizeRoute('/')).toBe('unmatched');
  });
});

describe('statusClass', () => {
  it('buckets status codes into classes', () => {
    expect(statusClass(202)).toBe('2xx');
    expect(statusClass(401)).toBe('4xx');
    expect(statusClass(503)).toBe('5xx');
    expect(statusClass(0)).toBe('unknown');
  });
});

function fakeExchange(method: string, path: string) {
  const res = new EventEmitter() as EventEmitter & { statusCode: number };
  res.statusCode = 200;
  const req = { method, path } as never;
  return { req, res };
}

describe('httpMetricsMiddleware', () => {
  it('records count and duration once per request on finish', async () => {
    const metrics = createMetrics(new Registry());
    const middleware = httpMetricsMiddleware(metrics);
    const { req, res } = fakeExchange('POST', '/ingest');

    middleware(req, res as never, () => undefined);
    res.statusCode = 202;
    res.emit('finish');
    res.emit('close'); // must not double-count

    const text = await metrics.registry.metrics();
    expect(text).toContain('trellis_http_requests_total{method="POST",route="/ingest",status_class="2xx"} 1');
    expect(text).toContain('trellis_http_request_duration_seconds_count{method="POST",route="/ingest"} 1');
  });

  it('labels query-bearing paths by normalized route only', async () => {
    const metrics = createMetrics(new Registry());
    const middleware = httpMetricsMiddleware(metrics);
    // Express's req.path already excludes the query string; an entity
    // value can only reach a label if normalizeRoute leaks the raw path.
    const { req, res } = fakeExchange('GET', '/retrieve/globex corporation');

    middleware(req, res as never, () => undefined);
    res.statusCode = 400;
    res.emit('finish');

    const text = await metrics.registry.metrics();
    expect(text).toContain('trellis_http_requests_total{method="GET",route="unmatched",status_class="4xx"} 1');
    expect(text).not.toContain('globex');
  });

  it('counts aborted responses on close', async () => {
    const metrics = createMetrics(new Registry());
    const middleware = httpMetricsMiddleware(metrics);
    const { req, res } = fakeExchange('GET', '/api/rlm-stream');

    middleware(req, res as never, () => undefined);
    res.emit('close'); // client abort: no finish event

    const text = await metrics.registry.metrics();
    expect(text).toContain('trellis_http_requests_total{method="GET",route="/api/rlm-stream",status_class="2xx"} 1');
  });
});
