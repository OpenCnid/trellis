import { describe, expect, it, vi } from 'vitest';
import {
  ConfirmationRefusal,
  DrillTargetRefusal,
  assertConfirmed,
  assertDrillTarget,
  describeTargets,
  reportRefusal,
  type DrillTargetMarker,
  type MarkerReaders,
} from './drill_target';

const marker = (purpose: string): DrillTargetMarker => ({
  purpose,
  markedAt: '2026-07-23T00:00:00.000Z',
  markedBy: 'operator',
});

function readers(overrides: Partial<MarkerReaders> = {}): MarkerReaders {
  return {
    neo4j: async () => marker('bench graph'),
    postgres: async () => marker('bench registry'),
    ...overrides,
  };
}

describe('assertDrillTarget', () => {
  it('returns each named store’s marker when all are present', async () => {
    const markers = await assertDrillTarget(['neo4j', 'postgres'], readers());
    expect(markers.neo4j?.purpose).toBe('bench graph');
    expect(markers.postgres?.purpose).toBe('bench registry');
  });

  it('refuses when the neo4j marker is absent', async () => {
    await expect(
      assertDrillTarget(['neo4j'], readers({ neo4j: async () => null }))
    ).rejects.toBeInstanceOf(DrillTargetRefusal);
  });

  it('refuses when the postgres marker is absent', async () => {
    await expect(
      assertDrillTarget(['postgres'], readers({ postgres: async () => null }))
    ).rejects.toBeInstanceOf(DrillTargetRefusal);
  });

  it('refuses on the FIRST unmarked store and does not read past it', async () => {
    const postgres = vi.fn(async () => marker('bench registry'));
    const error = await assertDrillTarget(
      ['neo4j', 'postgres'],
      readers({ neo4j: async () => null, postgres })
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DrillTargetRefusal);
    expect((error as DrillTargetRefusal).store).toBe('neo4j');
    expect(postgres).not.toHaveBeenCalled();
  });

  it('refuses a half-marked target — a marked graph does not vouch for the registry', async () => {
    const error = await assertDrillTarget(
      ['neo4j', 'postgres'],
      readers({ postgres: async () => null })
    ).catch((e: unknown) => e);

    expect((error as DrillTargetRefusal).store).toBe('postgres');
  });

  it('names the resolved target and the marking command in the refusal', async () => {
    const error = await assertDrillTarget(
      ['neo4j'],
      readers({ neo4j: async () => null })
    ).catch((e: unknown) => e as DrillTargetRefusal);

    expect(error.message).toContain(describeTargets().neo4j);
    expect(error.message).toContain('npm run drill:mark-target');
  });

  it('checks only the stores a drill names', async () => {
    const postgres = vi.fn(async () => null);
    await expect(
      assertDrillTarget(['neo4j'], readers({ postgres }))
    ).resolves.toBeDefined();
    expect(postgres).not.toHaveBeenCalled();
  });
});

describe('assertConfirmed', () => {
  it('passes when the flag was supplied', () => {
    expect(() =>
      assertConfirmed({ confirmed: true, flag: '--confirm-poison', act: 'flips beliefs' })
    ).not.toThrow();
  });

  it('refuses by default and names the flag that would proceed', () => {
    const error = (() => {
      try {
        assertConfirmed({ confirmed: false, flag: '--confirm-poison', act: 'flips beliefs' });
      } catch (e) {
        return e as ConfirmationRefusal;
      }
    })();

    expect(error).toBeInstanceOf(ConfirmationRefusal);
    expect(error!.flag).toBe('--confirm-poison');
    expect(error!.message).toContain('--confirm-poison');
    expect(error!.message).toContain('Nothing was written');
  });
});

describe('describeTargets', () => {
  it('renders both targets without leaking the password', () => {
    const targets = describeTargets();
    expect(targets.neo4j).toMatch(/^bolt:|^neo4j:/);
    expect(targets.postgres).toContain('/');
    expect(targets.postgres).not.toContain('password');
  });
});

describe('reportRefusal', () => {
  it('maps both refusal types to exit 2', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(reportRefusal(new DrillTargetRefusal('neo4j', 'x'))).toBe(2);
    expect(reportRefusal(new ConfirmationRefusal('--confirm-reset', 'x'))).toBe(2);
  });

  it('passes an ordinary failure through so it keeps its stack', () => {
    expect(reportRefusal(new Error('connection reset'))).toBeNull();
  });
});
