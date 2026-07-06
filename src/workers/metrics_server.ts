import type { Server } from 'node:http';
import { config } from '../config/index.js';
import {
  extractionQueue,
  invalidationQueue,
  resolutionQueue,
  rlmQueue,
  supervisorQueue,
  verificationQueue,
} from './queue.js';
import { loggerFor } from '../core/observability/logger.js';
import { getMetrics } from '../core/observability/metrics.js';
import { registerQueueDepthCollection } from '../core/observability/queue_gauges.js';
import { startMetricsServer, stopMetricsServer } from '../core/observability/metrics_server.js';
import {
  installShutdownSignalHandlers,
  shutdownCoordinator,
} from '../core/runtime/shutdown.js';

// Worker-process metrics bootstrap (T16). The API and workers run as
// separate containers, so the worker registry needs its own exposition
// path: an internal HTTP listener on WORKER_METRICS_PORT that Compose
// does not publish to the host. Queue-depth gauges live here because
// this process owns the queue connections; they are read live at scrape
// time, so there is no polling timer to manage.

const log = loggerFor({ component: 'worker_metrics' });
const metrics = getMetrics();

registerQueueDepthCollection(
  metrics,
  [extractionQueue, rlmQueue, supervisorQueue, invalidationQueue, verificationQueue, resolutionQueue],
  log
);

const serverPromise: Promise<Server> = startMetricsServer({
  registry: metrics.registry,
  port: config.workerMetrics.port,
  host: config.workerMetrics.host,
  log,
});
serverPromise.catch(error => {
  // A dead metrics listener must not take the workers down with it —
  // job processing is strictly more important than observability.
  log.error({
    event: 'metrics.server_start_failed',
    port: config.workerMetrics.port,
    err: error instanceof Error ? error : new Error(String(error)),
  });
});

installShutdownSignalHandlers();
// Same phase as API admission: stop serving scrapes before workers drain.
shutdownCoordinator.register('metrics.server', 100, async () => {
  const server = await serverPromise.catch(() => undefined);
  if (server) await stopMetricsServer(server);
});
