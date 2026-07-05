import { describe, expect, it, vi } from 'vitest';
import { mergeWithAstLivenessFence } from './extraction_liveness';

describe('mergeWithAstLivenessFence', () => {
  it('merges when the source remains live across both checks', async () => {
    const isLive = vi.fn().mockResolvedValue(true);
    const merge = vi.fn().mockResolvedValue('merged-value');
    const quarantine = vi.fn();

    await expect(mergeWithAstLivenessFence(isLive, merge, quarantine)).resolves.toEqual({
      status: 'merged',
      value: 'merged-value',
    });
    expect(isLive).toHaveBeenCalledTimes(2);
    expect(merge).toHaveBeenCalledTimes(1);
    expect(quarantine).not.toHaveBeenCalled();
  });

  it('skips the merge and quarantines any prior-attempt write when already dead', async () => {
    const order: string[] = [];
    const isLive = vi.fn(async () => {
      order.push('check');
      return false;
    });
    const merge = vi.fn(async () => {
      order.push('merge');
      return 'merged-value';
    });
    const quarantine = vi.fn(async () => {
      order.push('quarantine');
    });

    await expect(mergeWithAstLivenessFence(isLive, merge, quarantine)).resolves.toEqual({
      status: 'skipped',
    });
    expect(order).toEqual(['check', 'quarantine']);
  });

  it('compensates when the source dies while the Neo4j merge is in flight', async () => {
    const order: string[] = [];
    const isLive = vi.fn()
      .mockImplementationOnce(async () => {
        order.push('check-live');
        return true;
      })
      .mockImplementationOnce(async () => {
        order.push('check-dead');
        return false;
      });
    const merge = vi.fn(async () => {
      order.push('merge');
      return 'merged-value';
    });
    const quarantine = vi.fn(async () => {
      order.push('quarantine');
    });

    await expect(mergeWithAstLivenessFence(isLive, merge, quarantine)).resolves.toEqual({
      status: 'compensated',
      value: 'merged-value',
    });
    expect(order).toEqual(['check-live', 'merge', 'check-dead', 'quarantine']);
  });

  it('propagates compensation failures so BullMQ retries the job', async () => {
    const isLive = vi.fn().mockResolvedValue(false);
    const merge = vi.fn();
    const quarantine = vi.fn().mockRejectedValue(new Error('Neo4j unavailable'));

    await expect(mergeWithAstLivenessFence(isLive, merge, quarantine))
      .rejects.toThrow('Neo4j unavailable');
    expect(merge).not.toHaveBeenCalled();
  });
});
