import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { loggerFor } from '../core/observability/logger.js';

// API-key authentication (T6). Deliberately minimal: one shared key,
// checked with a constant-time comparison. When no key is configured the
// API stays open for local development and the server logs a warning —
// the docker-compose defaults must keep working with no .env file.

/** Constant-time key comparison; length mismatch short-circuits (the key length is not a secret). */
export function isValidApiKey(provided: unknown, expected: string): boolean {
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Pulls the presented key from the request: `x-api-key` header,
 * `Authorization: Bearer <key>`, or the `api_key` query parameter (SSE —
 * the browser EventSource API cannot set request headers).
 */
export function extractApiKey(req: {
  headers: Record<string, unknown>;
  query: Record<string, unknown>;
}): string | undefined {
  const headerKey = req.headers['x-api-key'];
  if (typeof headerKey === 'string' && headerKey.length > 0) return headerKey;

  const authorization = req.headers['authorization'];
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length);
  }

  const queryKey = req.query['api_key'];
  if (typeof queryKey === 'string' && queryKey.length > 0) return queryKey;

  return undefined;
}

/**
 * Express middleware guarding every operational endpoint after /healthz.
 * With no configured key it degrades to a pass-through (local development);
 * with one, requests without a matching key get 401 before any body parsing
 * or DB access.
 */
export function apiKeyMiddleware(expectedKey: string | undefined) {
  if (!expectedKey) {
    loggerFor({ component: 'api' }).warn({
      event: 'auth.unauthenticated_mode',
      msg: 'API_KEY is not set — the API is UNAUTHENTICATED. This is acceptable only for local development; set API_KEY before any non-local deployment.',
    });
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }
  return (req: Request, res: Response, next: NextFunction) => {
    if (isValidApiKey(extractApiKey(req as any), expectedKey)) return next();
    res.status(401).json({
      error: 'Unauthorized: supply the API key via the x-api-key header, an Authorization: Bearer token, or the api_key query parameter.',
    });
  };
}
