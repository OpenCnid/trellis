import { describe, expect, it } from 'vitest';
import { evaluateMigrationDecision, percentile, summarize } from './statistics';

describe('scale statistics', () => {
  it('uses the nearest-rank percentile definition', () => {
    expect(percentile([9, 1, 5, 3], 0)).toBe(1);
    expect(percentile([9, 1, 5, 3], 50)).toBe(3);
    expect(percentile([9, 1, 5, 3], 95)).toBe(9);
    expect(percentile([], 95)).toBe(0);
  });

  it('summarizes cardinalities without rounding away evidence', () => {
    expect(summarize([1, 2, 7, 10])).toEqual({
      count: 4,
      min: 1,
      max: 10,
      mean: 5,
      p50: 2,
      p95: 10,
    });
    expect(summarize([])).toEqual({
      count: 0,
      min: 0,
      max: 0,
      mean: 0,
      p50: 0,
      p95: 0,
    });
  });

  it('opens the migration gate when an array reaches one thousand sources', () => {
    const decision = evaluateMigrationDecision([
      { documentCount: 50, semanticFacts: 1000, fixedSweepMedianMs: 10 },
      { documentCount: 300, semanticFacts: 6000, fixedSweepMedianMs: 50 },
    ], 1000);
    expect(decision.justified).toBe(true);
    expect(decision.hubArraysInThousands).toBe(true);
    expect(decision.superlinearSweep).toBe(false);
  });

  it('opens the migration gate for materially superlinear sweep growth', () => {
    const decision = evaluateMigrationDecision([
      { documentCount: 50, semanticFacts: 1000, fixedSweepMedianMs: 10 },
      { documentCount: 300, semanticFacts: 6000, fixedSweepMedianMs: 100 },
    ], 300);
    expect(decision.justified).toBe(true);
    expect(decision.superlinearSweep).toBe(true);
    expect(decision.factGrowth).toBe(6);
    expect(decision.sweepLatencyGrowth).toBe(10);
  });

  it('records headroom when neither measurement crosses the gate', () => {
    const decision = evaluateMigrationDecision([
      { documentCount: 50, semanticFacts: 1000, fixedSweepMedianMs: 10 },
      { documentCount: 300, semanticFacts: 6000, fixedSweepMedianMs: 55 },
    ], 287);
    expect(decision.justified).toBe(false);
    expect(decision.arrayHeadroom).toBe(713);
  });
});
