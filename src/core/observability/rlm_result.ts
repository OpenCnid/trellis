import { z } from 'zod';
import { BoundedLineScanner } from './line_scanner.js';

// Session 9 §4.1: the RLM agent prints one machine-readable line
// `TRELLIS_RESULT: {...}` on stdout — the formal task-result envelope
// the orchestrator consumes, alongside the prose `FINAL_ANSWER:`
// convention the benchmark client still scrapes. The Node worker
// observes stdout as arbitrary chunks, so this module mirrors
// rlm_telemetry.ts: a bounded line scanner that is a pure observer of
// the same byte stream the Redis/SSE path publishes.
//
// Failure posture: a malformed payload is reported as `malformed`,
// never thrown — envelope problems must not corrupt the client stream.
// The worker treats a missing/malformed envelope as a null result,
// which the goal loop records as an error observation.

const RESULT_PREFIX = 'TRELLIS_RESULT:';

// An envelope is small (status + answer + a count); 64 KiB matches the
// telemetry cap and bounds a runaway answer line.
const DEFAULT_MAX_LINE_BYTES = 64 * 1024;

export const RLM_TASK_STATUSES = ['ok', 'protocol_violation', 'error'] as const;
export type RlmTaskStatus = (typeof RLM_TASK_STATUSES)[number];

// Process output, not an LLM completion: validated with plain Zod here
// rather than parseLlmResponse, and failures degrade to `malformed`.
export const RlmResultEnvelopeSchema = z.object({
  status: z.enum(RLM_TASK_STATUSES),
  answer: z.string().nullable(),
  toolCalls: z.number().int().nonnegative(),
});

export type RlmResultEnvelope = z.infer<typeof RlmResultEnvelopeSchema>;

export type ResultEvent =
  | { kind: 'result'; result: RlmResultEnvelope }
  | { kind: 'malformed'; reason: string };

export function parseResultLine(line: string): ResultEvent {
  const payload = line.slice(RESULT_PREFIX.length).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { kind: 'malformed', reason: 'invalid JSON payload' };
  }
  const result = RlmResultEnvelopeSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return { kind: 'malformed', reason: `envelope failed schema: ${issues}` };
  }
  return { kind: 'result', result: result.data };
}

/**
 * Bounded incremental scanner for the result envelope, sibling of
 * RlmTelemetryScanner. feed() with each chunk; flush() at process exit
 * for a final line without a trailing newline.
 */
export class RlmResultScanner {
  private readonly lines: BoundedLineScanner;

  constructor(
    onEvent: (event: ResultEvent) => void,
    maxLineBytes: number = DEFAULT_MAX_LINE_BYTES
  ) {
    this.lines = new BoundedLineScanner(line => {
      if (!line.startsWith(RESULT_PREFIX)) return;
      onEvent(parseResultLine(line));
    }, maxLineBytes);
  }

  feed(chunk: string): void {
    this.lines.feed(chunk);
  }

  flush(): void {
    this.lines.flush();
  }
}
