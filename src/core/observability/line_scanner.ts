// Bounded incremental line scanner shared by the RLM stdout observers
// (rlm_telemetry.ts and rlm_result.ts, Session 9). The Node worker sees
// stdout as arbitrary chunks that do not align with lines, so the
// scanner keeps a bounded line buffer: feed() accepts raw chunks (which
// the caller forwards to Redis/SSE unchanged — scanning is a pure
// observer of the byte stream) and invokes the callback once per
// completed line.
//
// A line exceeding the byte cap cannot be a valid machine-readable
// record, so the buffer resets and the line is ignored (verbose RLM
// output regularly exceeds any fixed cap and is not ours to interpret).

export class BoundedLineScanner {
  private buffer = '';
  /** Set when the current (still unterminated) line already overflowed. */
  private discardingOversizedLine = false;

  constructor(
    private readonly onLine: (line: string) => void,
    private readonly maxLineBytes: number
  ) {}

  feed(chunk: string): void {
    this.buffer += chunk;
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (this.discardingOversizedLine) {
        // The tail of a line whose head was already dropped.
        this.discardingOversizedLine = false;
        continue;
      }
      this.emitLine(line);
    }
    if (this.buffer.length > this.maxLineBytes) {
      // Unterminated line beyond any plausible record: drop it now so a
      // chatty agent cannot grow the buffer without bound, and remember
      // to discard the rest of the line when it finally ends.
      this.buffer = '';
      this.discardingOversizedLine = true;
    }
  }

  /** Handles a final partial line at stream end. */
  flush(): void {
    if (!this.discardingOversizedLine && this.buffer.length > 0) {
      this.emitLine(this.buffer);
    }
    this.buffer = '';
    this.discardingOversizedLine = false;
  }

  private emitLine(line: string): void {
    this.onLine(line.replace(/\r$/, ''));
  }
}
