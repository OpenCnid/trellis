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

import { BoundedLineScanner } from './line_scanner.js';

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
  /**
   * External MCP tool calls (Session 10) — counted separately from
   * database toolCalls, which alone carry provenance standing. Payloads
   * from pre-Session-10 agents omit the field; it degrades to 0.
   */
  mcpCalls: number;
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
      mcpCalls: toCount(record.mcp_calls),
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
 * final line without a trailing newline. The buffering itself lives in
 * the shared BoundedLineScanner (line_scanner.ts), which the Session 9
 * result-envelope scanner (rlm_result.ts) reuses.
 */
export class RlmTelemetryScanner {
  private readonly lines: BoundedLineScanner;

  constructor(
    onEvent: (event: TelemetryEvent) => void,
    maxLineBytes: number = DEFAULT_MAX_LINE_BYTES
  ) {
    this.lines = new BoundedLineScanner(line => {
      if (!line.startsWith(TELEMETRY_PREFIX)) return;
      onEvent(parseTelemetryLine(line));
    }, maxLineBytes);
  }

  feed(chunk: string): void {
    this.lines.feed(chunk);
  }

  /** Handles a final partial line at stream end. */
  flush(): void {
    this.lines.flush();
  }
}
