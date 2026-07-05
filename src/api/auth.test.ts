import { describe, it, expect, vi } from 'vitest';
import { isValidApiKey, extractApiKey, apiKeyMiddleware } from './auth';

const KEY = 'trellis-secret-key';

describe('isValidApiKey', () => {
  it('accepts the exact key', () => {
    expect(isValidApiKey(KEY, KEY)).toBe(true);
  });

  it('rejects a wrong key of the same length', () => {
    expect(isValidApiKey('trellis-secret-kez', KEY)).toBe(false);
  });

  it('rejects length mismatches without throwing (timingSafeEqual requires equal length)', () => {
    expect(isValidApiKey('short', KEY)).toBe(false);
    expect(isValidApiKey(KEY + 'x', KEY)).toBe(false);
  });

  it('rejects empty and non-string values', () => {
    expect(isValidApiKey('', KEY)).toBe(false);
    expect(isValidApiKey(undefined, KEY)).toBe(false);
    expect(isValidApiKey(42 as unknown, KEY)).toBe(false);
    expect(isValidApiKey(['a'] as unknown, KEY)).toBe(false);
  });
});

describe('extractApiKey', () => {
  const req = (headers: Record<string, unknown> = {}, query: Record<string, unknown> = {}) =>
    ({ headers, query });

  it('reads the x-api-key header first', () => {
    expect(extractApiKey(req({ 'x-api-key': 'h' }, { api_key: 'q' }))).toBe('h');
  });

  it('reads an Authorization Bearer token', () => {
    expect(extractApiKey(req({ authorization: 'Bearer tok' }))).toBe('tok');
  });

  it('ignores non-Bearer Authorization schemes', () => {
    expect(extractApiKey(req({ authorization: 'Basic dXNlcg==' }))).toBeUndefined();
  });

  it('falls back to the api_key query parameter (SSE cannot set headers)', () => {
    expect(extractApiKey(req({}, { api_key: 'q' }))).toBe('q');
  });

  it('returns undefined when nothing is presented', () => {
    expect(extractApiKey(req())).toBeUndefined();
  });

  it('ignores array-valued query parameters', () => {
    expect(extractApiKey(req({}, { api_key: ['a', 'b'] }))).toBeUndefined();
  });
});

describe('apiKeyMiddleware', () => {
  const mockRes = () => {
    const res: any = {
      statusCode: 0,
      body: undefined,
      status(code: number) { this.statusCode = code; return this; },
      json(payload: unknown) { this.body = payload; return this; },
    };
    return res;
  };

  it('passes everything through when no key is configured (local dev)', () => {
    const middleware = apiKeyMiddleware(undefined);
    const next = vi.fn();
    middleware({ headers: {}, query: {} } as any, mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects requests without a key with 401', () => {
    const middleware = apiKeyMiddleware(KEY);
    const res = mockRes();
    const next = vi.fn();
    middleware({ headers: {}, query: {} } as any, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toContain('Unauthorized');
  });

  it('rejects a wrong key with 401', () => {
    const middleware = apiKeyMiddleware(KEY);
    const res = mockRes();
    const next = vi.fn();
    middleware({ headers: { 'x-api-key': 'nope' }, query: {} } as any, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('admits the right key from any supported location', () => {
    const middleware = apiKeyMiddleware(KEY);
    for (const req of [
      { headers: { 'x-api-key': KEY }, query: {} },
      { headers: { authorization: `Bearer ${KEY}` }, query: {} },
      { headers: {}, query: { api_key: KEY } },
    ]) {
      const next = vi.fn();
      middleware(req as any, mockRes(), next);
      expect(next).toHaveBeenCalledOnce();
    }
  });
});
