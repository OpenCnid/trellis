// T16 §4.3: the RLM agent prints one machine-readable line
// `TRELLIS_TELEMETRY: {...}` on stdout. The Node worker observes stdout
// as arbitrary chunks that do not align with lines, so this module keeps
// a bounded line buffer: feed() accepts raw chunks (which the caller
// forwards to Redis/SSE unchanged — parsing is a pure observer of the
// byte stream), and emits one event per completed telemetry line.
//
// Failure posture: a malformed payload is reported as `malformed`, never
// thrown — telemetry problems must not corrupt the client stream or turn
// a successful RLM answer into a failure.

const TELEMETRY_PREFIX = 'TRELLIS_TELEMETRY:';

// One telemetry payload is well under 8 KiB today; 64 KiB leaves room
// for model_usage growth. A line exceeding the cap cannot be a valid
// telemetry record, so the buffer resets and the line is ignored
// (verbose RLM output regularly exceeds any fixed cap and is not ours
// to interpret).
const DEFAULT_MAX_LINE_BYTES = 64 * 1024;

export interface RlmTelemetry {
  inputTokens: number;
  outputTokens: number;
  subcallCount: number;
  toolCalls: number;
  /** Seconds; null when the agent could not measure it. */
  executionTimeS: number | null;
}

export type TelemetryEvent =
  | { kind: 'telemetry'; telemetry: RlmTelemetry }
  | { kind: 'malformed'; reason: string };

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function parseTelemetryLine(line: string): TelemetryEvent {
  const payload = line.slice(TELEMETRY_PREFIX.length).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { kind: 'malformed', reason: 'invalid JSON payload' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'malformed', reason: 'payload is not an object' };
  }
  const record = parsed as Record<string, unknown>;
  return {
    kind: 'telemetry',
    telemetry: {
      inputTokens: toCount(record.input_tokens),
      outputTokens: toCount(record.output_tokens),
      subcallCount: toCount(record.subcall_count),
      toolCalls: toCount(record.tool_calls),
      executionTimeS:
        typeof record.execution_time_s === 'number' && Number.isFinite(record.execution_time_s)
          ? record.execution_time_s
          : null,
    },
  };
}

/**
 * Bounded incremental line scanner for the RLM stdout stream. feed()
 * with each chunk as it arrives; flush() once at process exit for a
 * final line without a trailing newline.
 */
export class RlmTelemetryScanner {
  private buffer = '';
  /** Set when the current (still unterminated) line already overflowed. */
  private discardingOversizedLine = false;

  constructor(
    private readonly onEvent: (event: TelemetryEvent) => void,
    private readonly maxLineBytes: number = DEFAULT_MAX_LINE_BYTES
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
      this.scanLine(line);
    }
    if (this.buffer.length > this.maxLineBytes) {
      // Unterminated line beyond any plausible telemetry record: drop it
      // now so a chatty agent cannot grow the buffer without bound, and
      // remember to discard the rest of the line when it finally ends.
      this.buffer = '';
      this.discardingOversizedLine = true;
    }
  }

  /** Handles a final partial line at stream end. */
  flush(): void {
    if (!this.discardingOversizedLine && this.buffer.length > 0) {
      this.scanLine(this.buffer);
    }
    this.buffer = '';
    this.discardingOversizedLine = false;
  }

  private scanLine(line: string): void {
    const trimmed = line.replace(/\r$/, '');
    if (!trimmed.startsWith(TELEMETRY_PREFIX)) return;
    this.onEvent(parseTelemetryLine(trimmed));
  }
}
