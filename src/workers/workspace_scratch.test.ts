import { describe, expect, it } from 'vitest';
import {
  WorkspaceSnapshotSchema,
  mergeSnapshots,
  parseWorkspaceSnapshot,
  scratchBytesKey,
  scratchKey,
  snapshotBytes,
  workspaceRefFor,
  type WorkspaceSnapshot,
} from './workspace_scratch';

// Session 16: the pure half of serialize/park/seed. The snapshot shape
// mirrors trellis_workspace.py's state dict exactly; Python re-validates
// the seed with its own twin checks at spawn.

function segment(content: string, extra: Record<string, unknown> = {}) {
  return {
    origin: { server: 's', tool: 't', argsHash: 'ab12cd34ef56ab78' },
    fetchedAt: '2026-07-07T12:00:00+00:00',
    bytes: Buffer.byteLength(content, 'utf8'),
    truncated: false,
    content,
    ...extra,
  };
}

function snapshot(partial: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return WorkspaceSnapshotSchema.parse({
    version: 1,
    plan: [],
    notes: [],
    segments: {},
    ...partial,
  });
}

describe('parseWorkspaceSnapshot', () => {
  it('round-trips a canonical Python snapshot', () => {
    const raw = JSON.stringify({
      version: 1,
      plan: [{ id: 's1', desc: 'find sources', status: 'done' }],
      notes: ['checked the graph first'],
      segments: { 'a-uuid': segment('fetched body', { goalId: 'g1', taskId: 't1' }) },
    });
    const parsed = parseWorkspaceSnapshot(raw, 'test');
    expect(parsed.notes).toEqual(['checked the graph first']);
    expect(parsed.segments['a-uuid'].content).toBe('fetched body');
  });

  it('rejects non-JSON and names the source in the error', () => {
    expect(() => parseWorkspaceSnapshot('not json', "parked task 't1'"))
      .toThrow(/parked task 't1'.*not valid JSON/);
  });

  it('rejects wrong versions, missing stamps, and empty notes', () => {
    expect(() => parseWorkspaceSnapshot(
      JSON.stringify({ version: 2, plan: [], notes: [], segments: {} }), 'test'
    )).toThrow(/malformed/);
    expect(() => parseWorkspaceSnapshot(
      JSON.stringify({ version: 1, plan: [], notes: [''], segments: {} }), 'test'
    )).toThrow(/malformed/);
    const stampless = { fetchedAt: 'x', bytes: 1, truncated: false, content: 'y' };
    expect(() => parseWorkspaceSnapshot(
      JSON.stringify({ version: 1, plan: [], notes: [], segments: { id: stampless } }), 'test'
    )).toThrow(/malformed/);
  });
});

describe('mergeSnapshots', () => {
  it('concatenates notes, unions segments, and lets the last non-default plan win', () => {
    const first = snapshot({
      plan: [{ id: 'p1' }],
      notes: ['n1'],
      segments: { 'seg-1': segment('one') },
    });
    const second = snapshot({
      notes: ['n2'],
      segments: { 'seg-2': segment('two') },
    });
    const third = snapshot({ plan: [{ id: 'p3' }] });

    const merged = mergeSnapshots([first, second, third]);
    expect(merged.notes).toEqual(['n1', 'n2']);
    expect(Object.keys(merged.segments).sort()).toEqual(['seg-1', 'seg-2']);
    // second's default [] plan does not clobber first's; third's does win.
    expect(merged.plan).toEqual([{ id: 'p3' }]);
  });

  it('keeps the first occurrence of a shared segment id', () => {
    const a = snapshot({ segments: { shared: segment('from-a') } });
    const b = snapshot({ segments: { shared: segment('from-b') } });
    expect(mergeSnapshots([a, b]).segments['shared'].content).toBe('from-a');
  });

  it('merges nothing into the empty seed shape', () => {
    expect(mergeSnapshots([])).toEqual({ version: 1, plan: [], notes: [], segments: {} });
  });
});

describe('refs and keys', () => {
  it('summarizes counts only — no content in a ref', () => {
    const snap = snapshot({ segments: { s1: segment('abc'), s2: segment('defg') } });
    const ref = workspaceRefFor('task-9', snap);
    expect(ref).toEqual({ taskId: 'task-9', segments: 2, bytes: snapshotBytes(snap) });
    expect(JSON.stringify(ref)).not.toContain('abc');
  });

  it('meters the serialized payload the park path stores', () => {
    const snap = snapshot({ notes: ['ν'] }); // multi-byte: bytes, not chars
    expect(snapshotBytes(snap)).toBe(Buffer.byteLength(JSON.stringify(snap), 'utf8'));
  });

  it('scopes keys by goal and task', () => {
    expect(scratchKey('g1', 't1')).toBe('scratch:goal:g1:task:t1');
    expect(scratchBytesKey('g1')).toBe('scratch:goal:g1:bytes');
  });
});
