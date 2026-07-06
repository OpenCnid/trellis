import { describe, expect, it } from 'vitest';
import type { Response } from 'express';
import { healthHandler } from './health';

describe('healthHandler', () => {
  it('returns an explicit liveness-only contract', () => {
    let statusCode: number | undefined;
    let payload: unknown;
    const response = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(body: unknown) {
        payload = body;
        return this;
      },
    } as unknown as Response;

    healthHandler(response);

    expect(statusCode).toBe(200);
    expect(payload).toEqual({ status: 'ok', scope: 'liveness' });
  });
});
