// In-process concurrency cap for /api/rlm-stream (T6). Each stream holds
// an SSE connection, a dedicated Redis subscriber, and ultimately a
// Python process making paid LLM calls, so admission is bounded before
// any of those are allocated. This is a per-process gate — if the API is
// ever scaled horizontally, each instance enforces its own cap and the
// queue-depth check (rlm_queue backlog) is the shared backstop.

export type ReleaseFn = () => void;

export class StreamGate {
  private active = 0;

  constructor(private readonly maxConcurrent: number) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new Error(`StreamGate requires a positive integer cap, got ${maxConcurrent}`);
    }
  }

  get activeCount(): number {
    return this.active;
  }

  get limit(): number {
    return this.maxConcurrent;
  }

  /**
   * Attempts to admit one stream. Returns a release function on success
   * (idempotent — double release cannot free someone else's slot), or
   * null when the cap is reached.
   */
  tryAcquire(): ReleaseFn | null {
    if (this.active >= this.maxConcurrent) return null;
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
    };
  }
}
