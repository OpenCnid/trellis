import { describe, expect, it } from 'vitest';
import { RlmTelemetryScanner, type TelemetryEvent } from './rlm_telemetry';

const PAYLOAD = {
  input_tokens: 1200,
  output_tokens: 340,
  reported_cost_usd: 0.02,
  subcall_count: 3,
  tool_calls: 5,
  execution_time_s: 12.5,
  model_usage: {},
};
const LINE = `TRELLIS_TELEMETRY: ${JSON.stringify(PAYLOAD)}`;

function scan(chunks: string[], flush = true): TelemetryEvent[] {
  const events: TelemetryEvent[] = [];
  const scanner = new RlmTelemetryScanner(event => events.push(event));
  for (const chunk of chunks) scanner.feed(chunk);
  if (flush) scanner.flush();
  return events;
}

describe('RlmTelemetryScanner', () => {
  it('parses a telemetry record split across arbitrary chunk boundaries', () => {
    const mid = Math.floor(LINE.length / 2);
    const events = scan([
      'Starting RLM Agent...\n--- RLM Result ---\nFINAL_ANSWER: 4\n',
      LINE.slice(0, 10),
      LINE.slice(10, mid),
      `${LINE.slice(mid)}\n`,
    ]);

    expect(events).toEqual([{
      kind: 'telemetry',
      telemetry: {
        inputTokens: 1200,
        outputTokens: 340,
        subcallCount: 3,
        toolCalls: 5,
        mcpCalls: 0,
        executionTimeS: 12.5,
      },
    }]);
  });

  it('handles multiple records and interleaved output in one chunk', () => {
    const events = scan([`${LINE}\nnoise line\n${LINE}\n`]);
    expect(events).toHaveLength(2);
    expect(events.every(event => event.kind === 'telemetry')).toBe(true);
  });

  it('parses a final record with no trailing newline via flush', () => {
    const events = scan([`prefix output\n${LINE}`]);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('telemetry');
  });

  it('reports malformed payloads without throwing', () => {
    const events = scan([
      'TRELLIS_TELEMETRY: {"input_tokens": \n',
      'TRELLIS_TELEMETRY: [1,2]\n',
      `${LINE}\n`,
    ]);

    expect(events.map(event => event.kind)).toEqual(['malformed', 'malformed', 'telemetry']);
    expect(events[0]).toMatchObject({ reason: 'invalid JSON payload' });
    expect(events[1]).toMatchObject({ reason: 'payload is not an object' });
  });

  it('zeroes missing or negative counters instead of failing', () => {
    const events = scan(['TRELLIS_TELEMETRY: {"input_tokens": -5, "tool_calls": 2}\n']);
    expect(events).toEqual([{
      kind: 'telemetry',
      telemetry: {
        inputTokens: 0,
        outputTokens: 0,
        subcallCount: 0,
        toolCalls: 2,
        mcpCalls: 0,
        executionTimeS: null,
      },
    }]);
  });

  it('parses mcp_calls separately from database tool calls (Session 10 pin)', () => {
    // A pre-Session-10 payload (no mcp_calls) degrades to 0 — pinned by
    // the tests above. A Session 10 payload reports the MCP counter
    // without disturbing toolCalls, which alone carries the provenance
    // requirement.
    const events = scan([
      `TRELLIS_TELEMETRY: ${JSON.stringify({ ...PAYLOAD, mcp_calls: 4 })}\n`,
    ]);
    expect(events).toEqual([{
      kind: 'telemetry',
      telemetry: {
        inputTokens: 1200,
        outputTokens: 340,
        subcallCount: 3,
        toolCalls: 5,
        mcpCalls: 4,
        executionTimeS: 12.5,
      },
    }]);
  });

  it('drops an unterminated oversized line without growing the buffer or corrupting later records', () => {
    const events: TelemetryEvent[] = [];
    const scanner = new RlmTelemetryScanner(event => events.push(event), 64);
    scanner.feed('x'.repeat(200)); // verbose agent output, no newline yet
    scanner.feed('y'.repeat(200));
    scanner.feed(`still the same giant line\n${LINE}\n`);
    scanner.flush();

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('telemetry');
  });

  it('ignores CR line endings from Windows hosts', () => {
    const events = scan([`${LINE}\r\n`]);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('telemetry');
  });
});
