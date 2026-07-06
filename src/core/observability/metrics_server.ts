import http from 'node:http';
import type { Registry } from 'prom-client';
import type { Logger } from './logger.js';

// Internal metrics listener for the worker process. Workers run in a
// separate container from the API, so the API's authenticated /metrics
// cannot describe them; this listener serves the worker registry on an
// internal port that Compose does not publish to the host. It carries
// no authentication by design: reachability is bounded by the Compose
// network (or localhost on a bare-metal run).

export interface MetricsServerOptions {
  registry: Registry;
  port: number;
  host: string;
  log: Logger;
}

export function startMetricsServer(options: MetricsServerOptions): Promise<http.Server> {
  const { registry, port, host, log } = options;
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' || req.url?.split('?')[0] !== '/metrics') {
      res.statusCode = 404;
      res.end();
      return;
    }
    registry
      .metrics()
      .then(body => {
        res.statusCode = 200;
        res.setHeader('Content-Type', registry.contentType);
        res.end(body);
      })
      .catch(error => {
        log.warn({
          event: 'metrics.exposition_failed',
          err: error instanceof Error ? error : new Error(String(error)),
        });
        res.statusCode = 500;
        res.end();
      });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      log.info({ event: 'metrics.server_started', port, host });
      resolve(server);
    });
  });
}

export function stopMetricsServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
  });
}
