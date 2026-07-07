import { describe, it, expect } from 'vitest';
import { extractIterations, extractFinalAnswer, extractTelemetry } from './rlm_client';

describe('extractIterations', () => {
  it('returns null when no iteration banner is present', () => {
    expect(extractIterations('plain output')).toBeNull();
  });

  it('parses the count, including thousands separators', () => {
    expect(extractIterations('Iterations 7')).toBe(7);
    expect(extractIterations('Iterations 1,234')).toBe(1234);
  });

  it('uses the last banner when several appear', () => {
    expect(extractIterations('Iterations 3\n...\nIterations 9')).toBe(9);
  });
});

describe('extractFinalAnswer', () => {
  it('returns null when the marker is absent', () => {
    expect(extractFinalAnswer('thinking...')).toBeNull();
  });

  it('returns the trimmed text after the marker', () => {
    expect(extractFinalAnswer('blah\nFINAL_ANSWER: [(q_1, q_2)]  \n')).toBe('[(q_1, q_2)]');
  });

  it('uses the last marker when the agent restates its answer', () => {
    const out = 'FINAL_ANSWER: draft\n...more work...\nFINAL_ANSWER: [(q_1, q_2)]';
    expect(extractFinalAnswer(out)).toBe('[(q_1, q_2)]');
  });

  it('cuts the answer at the telemetry line', () => {
    const out = 'FINAL_ANSWER: []\nTRELLIS_TELEMETRY: {"x":1}';
    expect(extractFinalAnswer(out)).toBe('[]');
  });
});

describe('extractTelemetry', () => {
  const valid = {
    input_tokens: 100,
    output_tokens: 20,
    reported_cost_usd: null,
    subcall_count: 2,
    tool_calls: 5,
    mcp_calls: 0,
    execution_time_s: 1.5,
    model_usage: {},
  };

  it('returns null when the marker is absent', () => {
    expect(extractTelemetry('no telemetry')).toBeNull();
  });

  it('parses a valid telemetry line', () => {
    const out = `noise\nTRELLIS_TELEMETRY: ${JSON.stringify(valid)}\ntrailing`;
    expect(extractTelemetry(out)).toEqual(valid);
  });

  it('defaults tool_calls to 0 when the field is missing', () => {
    const { tool_calls, ...withoutToolCalls } = valid;
    const out = `TRELLIS_TELEMETRY: ${JSON.stringify(withoutToolCalls)}`;
    expect(extractTelemetry(out)?.tool_calls).toBe(0);
  });

  it('parses mcp_calls in both directions (Session 10 compatibility pin)', () => {
    // Pre-Session-10 payloads carry no mcp_calls and must keep parsing.
    const { mcp_calls, ...preSession10 } = valid;
    const legacy = extractTelemetry(`TRELLIS_TELEMETRY: ${JSON.stringify(preSession10)}`);
    expect(legacy?.mcp_calls).toBe(0);
    expect(legacy?.tool_calls).toBe(5);

    // Session 10 payloads report the separate MCP counter.
    const withMcp = extractTelemetry(
      `TRELLIS_TELEMETRY: ${JSON.stringify({ ...valid, mcp_calls: 3 })}`
    );
    expect(withMcp?.mcp_calls).toBe(3);
  });

  it('returns null for malformed JSON or schema violations', () => {
    expect(extractTelemetry('TRELLIS_TELEMETRY: {not json')).toBeNull();
    expect(extractTelemetry('TRELLIS_TELEMETRY: {"input_tokens": "many"}')).toBeNull();
  });

  it('uses the last telemetry line when several appear', () => {
    const first = { ...valid, input_tokens: 1 };
    const out =
      `TRELLIS_TELEMETRY: ${JSON.stringify(first)}\n` +
      `TRELLIS_TELEMETRY: ${JSON.stringify(valid)}`;
    expect(extractTelemetry(out)?.input_tokens).toBe(100);
  });
});
