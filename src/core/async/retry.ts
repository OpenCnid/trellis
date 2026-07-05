import {
  APIConnectionError,
  APIError,
  APIUserAbortError,
} from 'openai';
import { UnrecoverableError } from 'bullmq';

export interface RetryDecision {
  retryable: boolean;
  source: 'openai' | 'unknown';
  reason: 'http_status' | 'connection' | 'aborted' | 'unknown';
  status?: number;
}

export interface WorkerErrorContext {
  worker: string;
  jobId: string | undefined;
  attempt: number;
}

const RETRYABLE_HTTP_STATUSES = new Set([408, 409, 429]);

/**
 * Classifies typed upstream failures without inspecting human-readable
 * messages. Unknown infrastructure errors remain retryable because BullMQ's
 * bounded attempt count is the safer default for database/network failures.
 */
export function classifyWorkerError(error: unknown): RetryDecision {
  if (error instanceof APIUserAbortError) {
    return { retryable: false, source: 'openai', reason: 'aborted' };
  }
  if (error instanceof APIConnectionError) {
    return { retryable: true, source: 'openai', reason: 'connection' };
  }
  if (error instanceof APIError && typeof error.status === 'number') {
    const retryable =
      RETRYABLE_HTTP_STATUSES.has(error.status) || error.status >= 500;
    return {
      retryable,
      source: 'openai',
      reason: 'http_status',
      status: error.status,
    };
  }
  return { retryable: true, source: 'unknown', reason: 'unknown' };
}

/**
 * Applies the classification at the BullMQ processor boundary. Permanent
 * failures become UnrecoverableError so BullMQ skips the remaining attempts;
 * retryable failures retain their original type and stack.
 */
export async function withWorkerRetryPolicy<T>(
  context: WorkerErrorContext,
  operation: () => Promise<T>,
  log: (line: string) => void = console.warn
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const decision = classifyWorkerError(error);
    log(JSON.stringify({
      event: 'worker.error_classified',
      ...context,
      ...decision,
      errorType: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
    }));
    if (decision.retryable) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new UnrecoverableError(`Permanent ${decision.source} failure: ${message}`);
  }
}
