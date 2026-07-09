import { describe, expect, it } from 'vitest';
import {
  MAX_GAP_NOTES,
  RlmDraftScanner,
  parseDraftLine,
  parseDraftPayload,
  type DraftEvent,
} from './rlm_draft';
import { MODULE_ADDENDUM_MAX_BYTES_CAP } from '../../config/modules';

// Session 19 (design record §4, §9): the author-mode draft scanner. The
// draft carries prose only — a 64-hex token anywhere is refused, the
// pen-stays-with-the-harness rule (Guardrail 3).

const wellFormed = JSON.stringify({
  purpose: 'Teaches an RLM to reuse workspace state.',
  addendum: 'WORKSPACE PROTOCOL\nReuse prior snapshots; rebind atomically.',
  gapNotes: ['the corpus does not cover cross-goal sharing'],
});

describe('parseDraftLine', () => {
  it('parses a well-formed draft envelope', () => {
    const event = parseDraftLine(`TRELLIS_DRAFT: ${wellFormed}`);
    expect(event.kind).toBe('draft');
    if (event.kind === 'draft') {
      expect(event.draft.purpose).toContain('reuse workspace');
      expect(event.draft.gapNotes).toHaveLength(1);
    }
  });

  it('refuses a draft carrying any 64-hex token (a laundered citation)', () => {
    const hash = 'a'.repeat(64);
    const citing = JSON.stringify({
      purpose: 'p',
      addendum: `derived from ${hash}`,
      gapNotes: [],
    });
    const event = parseDraftLine(`TRELLIS_DRAFT: ${citing}`);
    expect(event.kind).toBe('refused');
    if (event.kind === 'refused') expect(event.reason).toMatch(/64-hex/);
  });

  it('refuses an uppercase 64-hex token too', () => {
    const citing = JSON.stringify({ purpose: 'p', addendum: 'x', gapNotes: ['B'.repeat(64)] });
    expect(parseDraftLine(`TRELLIS_DRAFT: ${citing}`).kind).toBe('refused');
  });

  it('reports malformed JSON without throwing', () => {
    const event = parseDraftLine('TRELLIS_DRAFT: {not json');
    expect(event.kind).toBe('malformed');
  });

  it('rejects a draft missing required fields or with extra keys', () => {
    expect(parseDraftLine('TRELLIS_DRAFT: {"purpose":"p"}').kind).toBe('malformed');
    const extra = JSON.stringify({ purpose: 'p', addendum: 'a', gapNotes: [], sources: ['x'] });
    expect(parseDraftLine(`TRELLIS_DRAFT: ${extra}`).kind).toBe('malformed');
  });

  it('enforces the addendum size cap and the gap-note count bound', () => {
    const huge = JSON.stringify({
      purpose: 'p',
      addendum: 'x'.repeat(MODULE_ADDENDUM_MAX_BYTES_CAP + 1),
      gapNotes: [],
    });
    expect(parseDraftLine(`TRELLIS_DRAFT: ${huge}`).kind).toBe('malformed');
    const tooManyNotes = JSON.stringify({
      purpose: 'p',
      addendum: 'a',
      gapNotes: Array.from({ length: MAX_GAP_NOTES + 1 }, (_, i) => `note ${i}`),
    });
    expect(parseDraftLine(`TRELLIS_DRAFT: ${tooManyNotes}`).kind).toBe('malformed');
  });
});

describe('parseDraftPayload', () => {
  it('returns the envelope for a saved well-formed draft', () => {
    const draft = parseDraftPayload(wellFormed, 'test');
    expect(draft.purpose).toContain('reuse workspace');
  });

  it('throws readably on a hash-bearing or malformed saved draft', () => {
    const citing = JSON.stringify({ purpose: 'p', addendum: 'a'.repeat(64), gapNotes: [] });
    expect(() => parseDraftPayload(citing, 'saved')).toThrow(/refused/);
    expect(() => parseDraftPayload('{nope', 'saved')).toThrow(/malformed/);
  });
});

describe('RlmDraftScanner', () => {
  it('collects a draft split across arbitrary chunks', () => {
    const events: DraftEvent[] = [];
    const scanner = new RlmDraftScanner(e => events.push(e));
    const line = `noise before\nTRELLIS_DRAFT: ${wellFormed}\nnoise after\n`;
    // Feed in three pieces that do not align with lines.
    scanner.feed(line.slice(0, 20));
    scanner.feed(line.slice(20, 60));
    scanner.feed(line.slice(60));
    scanner.flush();
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('draft');
  });

  it('ignores non-draft lines', () => {
    const events: DraftEvent[] = [];
    const scanner = new RlmDraftScanner(e => events.push(e));
    scanner.feed('TRELLIS_TELEMETRY: {"input_tokens":1}\nFINAL_ANSWER: hi\n');
    scanner.flush();
    expect(events).toHaveLength(0);
  });
});
