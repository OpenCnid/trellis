import { describe, expect, it } from 'vitest';
import { WorkspaceSnapshotSchema } from '../../workers/workspace_scratch';
import { CORPUS_ARGS_HASH_LEN, CORPUS_ORIGIN_SERVER, corpusToSnapshot } from './seed';
import type { CorpusBlock } from './corpus';

// Session 19 (design record §4, D4): corpusToSnapshot maps the promoted
// corpus into a workspace seed, block-aligned, deterministic, and
// schema-valid against the lineage snapshot the Python side restores.

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const BLOCKS: CorpusBlock[] = [
  { hash: HASH_A, text: 'first block text', docKey: 'research:trellis/contract' },
  { hash: HASH_B, text: 'second block — with non-ascii café', docKey: 'research:trellis/evidence' },
];

// A deterministic id factory so the mapping is pinnable.
function counter(): () => string {
  let n = 0;
  return () => `seg-${n++}`;
}

describe('corpusToSnapshot', () => {
  it('emits one segment per block, in corpus order, with wrapper-owned stamps', () => {
    const snapshot = corpusToSnapshot(BLOCKS, {
      mintId: counter(),
      fetchedAt: '2026-07-09T00:00:00.000Z',
    });
    const ids = Object.keys(snapshot.segments);
    expect(ids).toEqual(['seg-0', 'seg-1']);
    const first = snapshot.segments['seg-0'];
    expect(first.content).toBe('first block text');
    expect(first.origin.server).toBe(CORPUS_ORIGIN_SERVER);
    expect(first.origin.tool).toBe('research:trellis/contract');
    // argsHash is the 16-hex prefix of the block hash — never confusable
    // with a full 64-hex provenance token.
    expect(first.origin.argsHash).toBe(HASH_A.slice(0, CORPUS_ARGS_HASH_LEN));
    expect(first.origin.argsHash).toHaveLength(16);
    expect(/^[0-9a-f]{64}$/.test(first.origin.argsHash)).toBe(false);
    expect(first.truncated).toBe(false);
  });

  it('records byte length as the UTF-8 length of the content (torn-seed safe)', () => {
    const snapshot = corpusToSnapshot(BLOCKS, {
      mintId: counter(),
      fetchedAt: '2026-07-09T00:00:00.000Z',
    });
    const second = snapshot.segments['seg-1'];
    expect(second.bytes).toBe(Buffer.byteLength('second block — with non-ascii café', 'utf8'));
  });

  it('stamps the goal id when supplied', () => {
    const withGoal = corpusToSnapshot(BLOCKS, {
      mintId: counter(),
      fetchedAt: '2026-07-09T00:00:00.000Z',
      goalId: 'goal-19',
    });
    expect(withGoal.segments['seg-0'].goalId).toBe('goal-19');
    const withoutGoal = corpusToSnapshot(BLOCKS, {
      mintId: counter(),
      fetchedAt: '2026-07-09T00:00:00.000Z',
    });
    expect(withoutGoal.segments['seg-0'].goalId).toBeUndefined();
  });

  it('produces a schema-valid lineage snapshot with an empty plan and no notes', () => {
    const snapshot = corpusToSnapshot(BLOCKS, {
      mintId: counter(),
      fetchedAt: '2026-07-09T00:00:00.000Z',
    });
    expect(() => WorkspaceSnapshotSchema.parse(snapshot)).not.toThrow();
    expect(snapshot.plan).toEqual([]);
    expect(snapshot.notes).toEqual([]);
    expect(snapshot.version).toBe(1);
  });

  it('is deterministic given the same inputs', () => {
    const a = corpusToSnapshot(BLOCKS, { mintId: counter(), fetchedAt: '2026-07-09T00:00:00.000Z' });
    const b = corpusToSnapshot(BLOCKS, { mintId: counter(), fetchedAt: '2026-07-09T00:00:00.000Z' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
