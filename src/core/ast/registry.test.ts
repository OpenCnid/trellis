import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import {
  findGloballyOrphanedAstNodeIds,
  isAstNodeLive,
} from './registry';

describe('findGloballyOrphanedAstNodeIds', () => {
  it('keeps only candidates absent from every document latest version', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ node_id: 'dead-a' }, { node_id: 'dead-b' }],
    });
    const db = { query } as unknown as Pool;

    await expect(findGloballyOrphanedAstNodeIds(
      db,
      ['dead-a', 'shared-live', 'dead-b'],
    )).resolves.toEqual(['dead-a', 'dead-b']);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('unnest($1::varchar[]) WITH ORDINALITY');
    expect(sql).toContain('documents');
    expect(sql).toContain('max(v.version)');
    expect(params).toEqual([['dead-a', 'shared-live', 'dead-b']]);
  });

  it('does not query PostgreSQL for an empty candidate set', async () => {
    const query = vi.fn();
    const db = { query } as unknown as Pool;

    await expect(findGloballyOrphanedAstNodeIds(db, [])).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('isAstNodeLive', () => {
  it.each([
    [{ tracked: false, live: false }, true],
    [{ tracked: true, live: true }, true],
    [{ tracked: true, live: false }, false],
  ])('maps registry state %o to liveness %s', async (row, expected) => {
    const db = {
      query: vi.fn().mockResolvedValue({ rows: [row] }),
    } as unknown as Pool;
    await expect(isAstNodeLive(db, 'hash')).resolves.toBe(expected);
  });
});
