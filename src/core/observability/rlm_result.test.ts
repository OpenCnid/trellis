import { describe, expect, it } from 'vitest';
import { RlmResultScanner, parseResultLine, type ResultEvent } from './rlm_result';

const ENVELOPE = { status: 'ok', answer: 'FINAL_ANSWER: 4', toolCalls: 3 };
const LINE = `TRELLIS_RESULT: ${JSON.stringify(ENVELOPE)}`;

function scan(chunks: string[], flush = true): ResultEvent[] {
  const events: ResultEvent[] = [];
  const scanner = new RlmResultScanner(event => events.push(event));
  for (const chunk of chunks) scanner.feed(chunk);
  if (flush) scanner.flush();
  return events;
}

describe('RlmResultScanner', () => {
  it('parses an envelope split across arbitrary chunk boundaries', () => {
    const mid = Math.floor(LINE.length / 2);
    const events = scan([
      'Starting RLM Agent...\nFINAL_ANSWER: 4\nTRELLIS_TELEMETRY: {"input_tokens": 1}\n',
      LINE.slice(0, 10),
      LINE.slice(10, mid),
      `${LINE.slice(mid)}\n`,
    ]);

    expect(events).toEqual([{
      kind: 'result',
      result: { status: 'ok', answer: 'FINAL_ANSWER: 4', toolCalls: 3 },
    }]);
  });

  it('emits nothing when the stream carries no envelope', () => {
    const events = scan(['prose output\nFINAL_ANSWER: 4\nmore prose\n']);
    expect(events).toEqual([]);
  });

  it('parses a final envelope with no trailing newline via flush', () => {
    const events = scan([`prefix output\n${LINE}`]);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('result');
  });

  it('reports malformed JSON and schema failures without throwing', () => {
    const events = scan([
      'TRELLIS_RESULT: {"status": \n',
      'TRELLIS_RESULT: {"status": "hallucinated", "answer": null, "toolCalls": 1}\n',
      'TRELLIS_RESULT: {"status": "ok", "answer": "x", "toolCalls": -1}\n',
      `${LINE}\n`,
    ]);

    expect(events.map(event => event.kind)).toEqual(['malformed', 'malformed', 'malformed', 'result']);
    expect(events[0]).toMatchObject({ reason: 'invalid JSON payload' });
    expect((events[1] as { reason: string }).reason).toContain('status');
    expect((events[2] as { reason: string }).reason).toContain('toolCalls');
  });

  it('accepts the error envelope with a null answer', () => {
    const events = scan(['TRELLIS_RESULT: {"status": "error", "answer": null, "toolCalls": 0}\n']);
    expect(events).toEqual([{
      kind: 'result',
      result: { status: 'error', answer: null, toolCalls: 0 },
    }]);
  });

  it('drops an unterminated oversized line without corrupting later envelopes', () => {
    const events: ResultEvent[] = [];
    const scanner = new RlmResultScanner(event => events.push(event), 64);
    scanner.feed('x'.repeat(200)); // verbose agent output, no newline yet
    scanner.feed('y'.repeat(200));
    scanner.feed(`still the same giant line\n${LINE}\n`);
    scanner.flush();

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('result');
  });

  it('ignores CR line endings from Windows hosts', () => {
    const events = scan([`${LINE}\r\n`]);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('result');
  });
});

describe('parseResultLine', () => {
  it('rejects a non-object payload as malformed', () => {
    expect(parseResultLine('TRELLIS_RESULT: [1,2]').kind).toBe('malformed');
    expect(parseResultLine('TRELLIS_RESULT: "ok"').kind).toBe('malformed');
  });
});
