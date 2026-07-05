import { describe, expect, it, vi } from 'vitest';
import { APIError, APIConnectionTimeoutError } from 'openai';
import { UnrecoverableError } from 'bullmq';
import {
  classifyWorkerError,
  withWorkerRetryPolicy,
} from './retry';

function apiError(status: number): APIError {
  return APIError.generate(status, { error: 'probe' }, `HTTP ${status}`, new Headers());
}

describe('classifyWorkerError', () => {
  it.each([408, 409, 429, 500, 502, 503])(
    'retries transient OpenAI HTTP status %i',
    status => {
      expect(classifyWorkerError(apiError(status))).toMatchObject({
        retryable: true,
        status,
        source: 'openai',
      });
    }
  );

  it.each([400, 401, 403, 404, 422])(
    'does not retry permanent OpenAI HTTP status %i',
    status => {
      expect(classifyWorkerError(apiError(status))).toMatchObject({
        retryable: false,
        status,
        source: 'openai',
      });
    }
  );

  it('retries typed OpenAI connection timeouts without message inspection', () => {
    const error = new APIConnectionTimeoutError({ message: 'socket timed out' });
    expect(classifyWorkerError(error)).toMatchObject({
      retryable: true,
      source: 'openai',
      reason: 'connection',
    });
  });

  it('retries unknown infrastructure errors conservatively', () => {
    expect(classifyWorkerError(new Error('database unavailable'))).toMatchObject({
      retryable: true,
      source: 'unknown',
    });
  });
});

describe('withWorkerRetryPolicy', () => {
  it('preserves retryable errors so BullMQ can apply normal backoff', async () => {
    const error = apiError(502);
    const log = vi.fn();
    await expect(withWorkerRetryPolicy(
      { worker: 'extraction', jobId: '7', attempt: 1 },
      async () => { throw error; },
      log
    )).rejects.toBe(error);
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
      event: 'worker.error_classified',
      retryable: true,
      worker: 'extraction',
      jobId: '7',
      status: 502,
    });
  });

  it('converts permanent errors to BullMQ UnrecoverableError', async () => {
    const log = vi.fn();
    await expect(withWorkerRetryPolicy(
      { worker: 'verification', jobId: '9', attempt: 2 },
      async () => { throw apiError(401); },
      log
    )).rejects.toBeInstanceOf(UnrecoverableError);
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
      retryable: false,
      status: 401,
    });
  });
});
