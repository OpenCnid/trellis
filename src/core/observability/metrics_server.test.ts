import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import { Registry } from 'prom-client';
import { buildLogger } from './logger';
import { createMetrics } from './metrics';
import { startMetricsServer, stopMetricsServer } from './metrics_server';

const quietLog = buildLogger({
  level: 'silent',
  destination: new Writable({ write: (_c, _e, cb) => cb() }),
});

describe('metrics server', () => {
  it('serves the registry on /metrics only and closes cleanly', async () => {
    const metrics = createMetrics(new Registry());
    metrics.rlmSubcallsTotal.inc(2);
    const server = await startMetricsServer({
      registry: metrics.registry,
      port: 0,
      host: '127.0.0.1',
      log: quietLog,
    });
    try {
      const { port } = server.address() as AddressInfo;
      const ok = await fetch(`http://127.0.0.1:${port}/metrics`);
      expect(ok.status).toBe(200);
      expect(ok.headers.get('content-type')).toContain('text/plain');
      expect(await ok.text()).toContain('trellis_rlm_subcalls_total 2');

      expect((await fetch(`http://127.0.0.1:${port}/other`)).status).toBe(404);
      expect((await fetch(`http://127.0.0.1:${port}/metrics`, { method: 'POST' })).status).toBe(404);
    } finally {
      await stopMetricsServer(server);
    }
    await expect(fetch(`http://127.0.0.1:${(server.address() as AddressInfo | null)?.port ?? 0}/metrics`))
      .rejects.toThrow();
  });
});
