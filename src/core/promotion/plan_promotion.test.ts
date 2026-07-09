import { describe, expect, it } from 'vitest';
import type { WorkspaceSnapshot } from '../../workers/workspace_scratch';
import {
  derivedDocKey,
  listSegments,
  planSegmentPromotion,
  validatePromotionDocKey,
} from './plan_promotion';

// Session 17: the pure promotion planner. Refusals are the feature —
// promotion mints verified Tier-1 hashes, so anything not byte-faithful
// (truncated captures), empty, unknown, or badly keyed is refused with a
// typed reason, and accepted content crosses verbatim.

const SEGMENT_ID = 'f1e2d3c4-0000-4000-8000-000000000001';
const OTHER_ID = 'a0b1c2d3-0000-4000-8000-000000000002';

function segment(overrides: Partial<WorkspaceSnapshot['segments'][string]> = {}) {
  return {
    origin: { server: 'fixture', tool: 'search', argsHash: 'ab12cd34ef56ab78' },
    fetchedAt: '2026-07-07T12:00:00Z',
    bytes: 22,
    truncated: false,
    content: 'Alpha acquired Beta.\n',
    goalId: 'goal-1',
    taskId: 'task-1',
    ...overrides,
  };
}

function snapshotWith(
  segments: WorkspaceSnapshot['segments']
): WorkspaceSnapshot {
  return { version: 1, plan: [], notes: [], segments };
}

describe('validatePromotionDocKey', () => {
  it('accepts the recommended web:<url> form', () => {
    expect(validatePromotionDocKey('web:https://example.test/page?a=1')).toEqual({ ok: true });
  });

  it('accepts the derived mcp fallback form', () => {
    expect(validatePromotionDocKey('mcp:fixture:search:ab12cd34ef56ab78')).toEqual({ ok: true });
  });

  it('rejects empty, whitespace-bearing, and control-character keys', () => {
    expect(validatePromotionDocKey('').ok).toBe(false);
    expect(validatePromotionDocKey('web:has space').ok).toBe(false);
    expect(validatePromotionDocKey('web:tab\there').ok).toBe(false);
    expect(validatePromotionDocKey(`web:ctrl${String.fromCharCode(1)}here`).ok).toBe(false);
    expect(validatePromotionDocKey(`web:del${String.fromCharCode(127)}here`).ok).toBe(false);
  });

  it('rejects oversized keys', () => {
    expect(validatePromotionDocKey(`web:${'x'.repeat(600)}`).ok).toBe(false);
  });

  it('rejects keys shaped like AST hashes (the anonymous-ingest namespace)', () => {
    const result = validatePromotionDocKey('a'.repeat(64));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('AST hash');
    // One character off the hash shape is an ordinary (accepted) key.
    expect(validatePromotionDocKey(`x${'a'.repeat(63)}`).ok).toBe(true);
  });

  it('rejects keys under the reserved repo: prefix', () => {
    const result = validatePromotionDocKey('repo:some-key:src/index.ts');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('repository snapshots');
  });
});

describe('derivedDocKey', () => {
  it('derives exactly from the origin stamp', () => {
    expect(derivedDocKey({ server: 'fixture', tool: 'search', argsHash: 'ab12cd34ef56ab78' }))
      .toBe('mcp:fixture:search:ab12cd34ef56ab78');
  });
});

describe('planSegmentPromotion', () => {
  it('refuses an unknown segment id with a bounded listing of what the snapshot holds', () => {
    const snapshot = snapshotWith({ [SEGMENT_ID]: segment(), [OTHER_ID]: segment() });
    const plan = planSegmentPromotion(snapshot, 'no-such-segment', 'web:https://example.test');
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.reason).toBe('unknown_segment');
      expect(plan.message).toContain('2 segment(s)');
      expect(plan.message).toContain(SEGMENT_ID);
      expect(plan.message).toContain(OTHER_ID);
    }
  });

  it('bounds the unknown-id listing on large snapshots', () => {
    const segments: WorkspaceSnapshot['segments'] = {};
    for (let i = 0; i < 25; i++) {
      segments[`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`] = segment();
    }
    const plan = planSegmentPromotion(snapshotWith(segments), 'missing', 'web:https://example.test');
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.message).toContain('+5 more');
  });

  it('refuses a truncated segment outright — a partial capture is not the source bytes', () => {
    const snapshot = snapshotWith({ [SEGMENT_ID]: segment({ truncated: true }) });
    const plan = planSegmentPromotion(snapshot, SEGMENT_ID, 'web:https://example.test');
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.reason).toBe('truncated_segment');
      expect(plan.message).toContain('truncated');
    }
  });

  it('refuses empty content', () => {
    const snapshot = snapshotWith({ [SEGMENT_ID]: segment({ content: '', bytes: 0 }) });
    const plan = planSegmentPromotion(snapshot, SEGMENT_ID, 'web:https://example.test');
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toBe('empty_content');
  });

  it('refuses an invalid doc key with the validator message', () => {
    const snapshot = snapshotWith({ [SEGMENT_ID]: segment() });
    const plan = planSegmentPromotion(snapshot, SEGMENT_ID, 'repo:reserved:path');
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toBe('invalid_doc_key');
  });

  it('honors the explicit doc key and carries the content byte-verbatim', () => {
    const content = '  leading spaces kept\nCRLF kept\r\ntrailing newline kept\n\n';
    const snapshot = snapshotWith({
      [SEGMENT_ID]: segment({ content, bytes: Buffer.byteLength(content, 'utf8') }),
    });
    const plan = planSegmentPromotion(snapshot, SEGMENT_ID, 'web:https://example.test/doc');
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.request.docKey).toBe('web:https://example.test/doc');
      // Verbatim: no normalization, no trimming — same string, char for char.
      expect(plan.request.content).toBe(content);
    }
  });

  it('copies the wrapper-owned origin stamp onto the request', () => {
    const snapshot = snapshotWith({ [SEGMENT_ID]: segment() });
    const plan = planSegmentPromotion(snapshot, SEGMENT_ID, 'web:https://example.test');
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.request.origin).toEqual({
        server: 'fixture',
        tool: 'search',
        argsHash: 'ab12cd34ef56ab78',
        fetchedAt: '2026-07-07T12:00:00Z',
        segmentId: SEGMENT_ID,
        bytes: 22,
        goalId: 'goal-1',
        taskId: 'task-1',
      });
    }
  });

  it('omits absent correlation stamps instead of writing undefined', () => {
    const bare = segment();
    delete (bare as Record<string, unknown>).goalId;
    delete (bare as Record<string, unknown>).taskId;
    const plan = planSegmentPromotion(
      snapshotWith({ [SEGMENT_ID]: bare }),
      SEGMENT_ID,
      'web:https://example.test'
    );
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect('goalId' in plan.request.origin).toBe(false);
      expect('taskId' in plan.request.origin).toBe(false);
    }
  });
});

describe('listSegments', () => {
  it('summarizes each segment with stamps, a bounded preview, and the key hint', () => {
    const long = 'word '.repeat(100);
    const snapshot = snapshotWith({
      [SEGMENT_ID]: segment({ content: long, bytes: Buffer.byteLength(long, 'utf8') }),
      [OTHER_ID]: segment({ fetchedAt: '2026-07-07T11:00:00Z', truncated: true }),
    });
    const summaries = listSegments(snapshot);
    // Sorted by fetch time: the earlier capture first.
    expect(summaries.map(s => s.id)).toEqual([OTHER_ID, SEGMENT_ID]);
    const [truncated, big] = summaries;
    expect(truncated.truncated).toBe(true);
    expect(big.preview.length).toBeLessThanOrEqual(203);
    expect(big.preview.endsWith('...')).toBe(true);
    expect(big.suggestedDocKey).toBe('mcp:fixture:search:ab12cd34ef56ab78');
    expect(big.bytes).toBe(Buffer.byteLength(long, 'utf8'));
  });

  it('returns an empty inventory for a segmentless snapshot', () => {
    expect(listSegments(snapshotWith({}))).toEqual([]);
  });
});
