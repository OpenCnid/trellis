import { describe, expect, it } from 'vitest';
import {
  computeSupportOpinion,
  canonicalizeEvents,
  SupportInputError,
  SUPPORT_PARAMS_V1,
  type SupportEvent,
} from './support';
import {
  evaluateMetric,
  validateMetric,
  MetricValidityError,
  canonicalMetricString,
  type MetricExpr,
} from './support_metrics';

const P = { priorWeight: 2, baseRate: 0.5, halfLifeMs: 1_000_000 };
const ev = (partial: Partial<SupportEvent>): SupportEvent => ({
  beliefId: 'b:1', opId: 'op:x', verdict: 'clean', atMs: 1_000, weight: 1, ...partial,
});

describe('computeSupportOpinion (EPISTEMIC_SUPPORT.md §3, drill-pinned)', () => {
  it('sums to one and routes abstention to uncertainty only', () => {
    const o = computeSupportOpinion(
      [ev({ verdict: 'clean' }), ev({ opId: 'op:y', verdict: 'abstain' })], 1_000, P
    );
    expect(o.b + o.d + o.u).toBeCloseTo(1, 12);
    expect(o.events.abstain).toBe(1);
    // one clean at zero age: r=1 → b=1/3, u=2/3
    expect(o.b).toBeCloseTo(1 / 3, 12);
    expect(o.u).toBeCloseTo(2 / 3, 12);
  });

  it('yields (0,0,1) on an all-abstain history', () => {
    const o = computeSupportOpinion([ev({ verdict: 'abstain' })], 1_000, P);
    expect(o).toMatchObject({ b: 0, d: 0, u: 1 });
  });

  it('is order-invariant via canonical accumulation', () => {
    const events = [
      ev({ opId: 'op:z', verdict: 'drawback', weight: 0.3 }),
      ev({ opId: 'op:a', verdict: 'clean', weight: 2 }),
      ev({ opId: 'op:m', verdict: 'clean', atMs: 500 }),
    ];
    const a = computeSupportOpinion(events, 1_000, P);
    const b = computeSupportOpinion([...events].reverse(), 1_000, P);
    expect(a).toEqual(b);
    expect(canonicalizeEvents(events)[0].opId).toBe('op:a');
  });

  it('grows uncertainty monotonically across a verdict-free gap (decay)', () => {
    const events = [ev({ verdict: 'clean', atMs: 0 })];
    const early = computeSupportOpinion(events, 1_000_000, P); // one half-life
    const late = computeSupportOpinion(events, 2_000_000, P); // two half-lives
    expect(late.u).toBeGreaterThan(early.u);
    expect(early.b).toBeCloseTo(0.5 / 2.5, 12);
  });

  it('refuses future-dated evidence rather than zero-weighting it', () => {
    expect(() => computeSupportOpinion([ev({ atMs: 2_000 })], 1_000, P))
      .toThrow(SupportInputError);
  });

  it('has no path for writer confidence: unknown fields are structurally ignored', () => {
    const bare = [ev({})];
    const decorated = [{ ...ev({}), confidence: 0.97 } as unknown as SupportEvent];
    expect(computeSupportOpinion(decorated, 1_000, P))
      .toEqual(computeSupportOpinion(bare, 1_000, P));
  });

  it('ships v1 defaults matching the architecture record', () => {
    expect(SUPPORT_PARAMS_V1.priorWeight).toBe(2);
    expect(SUPPORT_PARAMS_V1.baseRate).toBe(0.5);
  });
});

describe('metric expressions and the validity gate (EPISTEMIC_SUPPORT.md §4)', () => {
  const v = (m: Record<string, 'drawback' | 'clean' | 'abstain'>) => new Map(Object.entries(m));
  const anyOf: MetricExpr = {
    op: 'any',
    children: [{ op: 'leaf', opId: 'a' }, { op: 'leaf', opId: 'b' }],
  };

  it('excludes abstaining children and abstains when all children abstain', () => {
    expect(evaluateMetric(anyOf, v({ a: 'abstain', b: 'drawback' }))).toBe('drawback');
    expect(evaluateMetric(anyOf, v({ a: 'abstain', b: 'abstain' }))).toBe('abstain');
    expect(evaluateMetric(anyOf, v({}))).toBe('abstain'); // missing op = abstain
  });

  it('implements kofk over opining children only', () => {
    const two: MetricExpr = {
      op: 'kofk', k: 2,
      children: [{ op: 'leaf', opId: 'a' }, { op: 'leaf', opId: 'b' }, { op: 'leaf', opId: 'c' }],
    };
    expect(evaluateMetric(two, v({ a: 'drawback', b: 'drawback', c: 'clean' }))).toBe('drawback');
    expect(evaluateMetric(two, v({ a: 'drawback', b: 'clean', c: 'clean' }))).toBe('clean');
  });

  it('refuses vacuous candidates with the named class and fails closed on empty calibration', () => {
    const calibration = [
      v({ a: 'clean', b: 'drawback' }),
      v({ a: 'drawback', b: 'clean' }),
      v({ a: 'clean', b: 'clean' }),
    ];
    expect(() => validateMetric(anyOf, calibration)).not.toThrow();
    const vacuous: MetricExpr = { op: 'leaf', opId: 'never-opines' };
    try {
      validateMetric(vacuous, calibration);
      expect.unreachable('vacuous candidate must be refused');
    } catch (err) {
      expect((err as MetricValidityError).vacuityClass).toBe('all_abstain');
    }
    expect(() => validateMetric(anyOf, [])).toThrow(MetricValidityError);
  });

  it('serializes canonically for metricSha pinning', () => {
    expect(canonicalMetricString(anyOf))
      .toBe('{"children":[{"op":"leaf","opId":"a"},{"op":"leaf","opId":"b"}],"op":"any"}');
  });
});
