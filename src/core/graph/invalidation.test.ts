import { describe, expect, it } from 'vitest';
import type { Driver } from 'neo4j-driver';
import { sweepOrphanedProvenance } from './invalidation';

describe('sweepOrphanedProvenance timing', () => {
  it('records end-to-end and per-batch durations with an injectable clock', async () => {
    const values = [0, 1, 4, 6, 10, 12];
    const clock = () => values.shift()!;
    let closed = false;
    const number = (value: number) => ({ toNumber: () => value });
    const driver = {
      session: () => ({
        executeWrite: async (
          work: (tx: { run: () => Promise<unknown> }) => Promise<unknown>
        ) => work({
          run: async () => ({
            records: [{
              get: (key: string) => number(key === 'contested' ? 1 : 2),
            }],
          }),
        }),
        close: async () => { closed = true; },
      }),
    } as unknown as Driver;

    const result = await sweepOrphanedProvenance(
      driver,
      ['h1', 'h2', 'h3'],
      [],
      2,
      clock
    );

    expect(result).toEqual({
      contestedNodes: 2,
      contestedRelationships: 2,
      survivedNodes: 4,
      survivedRelationships: 4,
      batches: 2,
      durationMs: 12,
      batchDurationsMs: [3, 4],
    });
    expect(closed).toBe(true);
  });
});
