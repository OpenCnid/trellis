import type { NextFunction, Request, Response } from 'express';
import type { TrellisMetrics } from './metrics.js';

// Route labels come from a fixed table so entity names, document keys,
// and query strings can never become metric label values (Guardrail 6).
// Anything outside the table — typo'd paths, scanners — collapses into
// one 'unmatched' series instead of minting a series per probe.
const KNOWN_ROUTES = new Set([
  '/healthz',
  '/metrics',
  '/ingest',
  '/retrieve',
  '/api/rlm-stream',
]);

export function normalizeRoute(path: string): string {
  // Strip a trailing slash so /ingest/ and /ingest are one series.
  const trimmed = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return KNOWN_ROUTES.has(trimmed) ? trimmed : 'unmatched';
}

export function statusClass(statusCode: number): string {
  if (statusCode >= 100 && statusCode <= 599) {
    return `${Math.floor(statusCode / 100)}xx`;
  }
  return 'unknown';
}

/**
 * Express middleware recording request count and duration. Duration is
 * observed on response finish; aborted responses ('close' without
 * 'finish') are counted with the status the socket died holding.
 */
export function httpMetricsMiddleware(metrics: TrellisMetrics) {
  return (req: Request, res: Response, next: NextFunction) => {
    const route = normalizeRoute(req.path);
    const method = req.method;
    const startedAt = process.hrtime.bigint();
    let recorded = false;
    const record = () => {
      if (recorded) return;
      recorded = true;
      const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      metrics.httpRequestsTotal.inc({
        method,
        route,
        status_class: statusClass(res.statusCode),
      });
      metrics.httpRequestDurationSeconds.observe({ method, route }, seconds);
    };
    res.on('finish', record);
    res.on('close', record);
    next();
  };
}
