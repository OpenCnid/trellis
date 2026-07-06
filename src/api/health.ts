import type { Response } from 'express';

export const HEALTH_RESPONSE = {
  status: 'ok',
  scope: 'liveness',
} as const;

/**
 * Process-liveness contract. Dependency readiness is established before
 * startup by the schema bootstrap and Compose health dependencies; transient
 * database outages must not turn this endpoint into a container restart loop.
 */
export function healthHandler(res: Response): Response {
  return res.status(200).json(HEALTH_RESPONSE);
}
