export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Exponential-backoff wrapper for transient database failures
// (connection refused, deadlocks, leader elections). Verification
// failures are NOT retried through this — those bubble up to the
// batch loop, which decides whether to re-run the whole micro-batch.
export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  { maxAttempts = 5, baseDelayMs = 500 }: RetryOptions = {}
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      if (attempt === maxAttempts) break;
      const delay = baseDelayMs * 2 ** (attempt - 1);
      console.warn(`  [RETRY] ${label} failed (attempt ${attempt}/${maxAttempts}): ${err.message ?? err}. Backing off ${delay}ms...`);
      await sleep(delay);
    }
  }
  throw new Error(`${label} failed after ${maxAttempts} attempts: ${(lastError as any)?.message ?? lastError}`);
}
