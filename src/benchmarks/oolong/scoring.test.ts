import { describe, it, expect } from 'vitest';
import { pairKey, cityTruth, parsePredictedPairs, scoreF1, estimateCost, PRICE_PER_M_INPUT, PRICE_PER_M_OUTPUT } from './scoring';
import type { OolongDataset } from './schema';
import type { Telemetry } from './rlm_client';

const record = (id: string, category: 'LOC' | 'HUM' | 'DESC', concepts: string[]) => ({
  id,
  text: `Question ${id}?`,
  category,
  concepts,
});

const dataset: OolongDataset = {
  name: 'test',
  seed: 1,
  records: [
    record('q_0001', 'LOC', ['paris']),
    record('q_0002', 'LOC', ['paris', 'london']),
    record('q_0003', 'HUM', ['paris']),
    record('q_0004', 'HUM', ['london']),
    record('q_0005', 'DESC', ['paris']),
  ],
  ground_truth: { loc_hum_shared_concept_pairs: [] },
};

const categoryOf = new Map(dataset.records.map(r => [r.id, r.category]));

describe('cityTruth', () => {
  it('builds the LOC x HUM cross product for records sharing the city', () => {
    expect(cityTruth(dataset, 'paris')).toEqual(
      new Set([pairKey('q_0001', 'q_0003'), pairKey('q_0002', 'q_0003')])
    );
  });

  it('excludes non-LOC/HUM categories even when they mention the city', () => {
    // q_0005 is DESC and mentions paris; it must never appear in truth.
    for (const key of cityTruth(dataset, 'paris')) {
      expect(key).not.toContain('q_0005');
    }
  });

  it('returns an empty set for an unknown city', () => {
    expect(cityTruth(dataset, 'atlantis').size).toBe(0);
  });
});

describe('parsePredictedPairs', () => {
  it('parses quoted and unquoted tuple styles', () => {
    const answer = `FINAL_ANSWER: [('q_0001', 'q_0003'), ("q_0002", "q_0003"), (q_0001, q_0004)]`;
    expect(parsePredictedPairs(answer, categoryOf)).toEqual(
      new Set([
        pairKey('q_0001', 'q_0003'),
        pairKey('q_0002', 'q_0003'),
        pairKey('q_0001', 'q_0004'),
      ])
    );
  });

  it('canonicalizes reversed (HUM, LOC) tuples to (LOC, HUM)', () => {
    const answer = `[('q_0003', 'q_0001')]`;
    expect(parsePredictedPairs(answer, categoryOf)).toEqual(
      new Set([pairKey('q_0001', 'q_0003')])
    );
  });

  it('keeps wrong-category pairs as-is so they score as spurious', () => {
    const answer = `[('q_0005', 'q_0001')]`; // DESC, LOC — not a valid pair
    expect(parsePredictedPairs(answer, categoryOf)).toEqual(
      new Set([pairKey('q_0005', 'q_0001')])
    );
  });

  it('returns an empty set for [] or unparseable answers', () => {
    expect(parsePredictedPairs('[]', categoryOf).size).toBe(0);
    expect(parsePredictedPairs('no tuples here', categoryOf).size).toBe(0);
  });
});

describe('scoreF1', () => {
  const truth = new Set([pairKey('q_0001', 'q_0003'), pairKey('q_0002', 'q_0003')]);

  it('scores a perfect prediction as 1/1/1', () => {
    expect(scoreF1(new Set(truth), truth)).toEqual({ precision: 1, recall: 1, f1: 1 });
  });

  it('scores empty predicted against empty truth as 1/1/1 (correctly answering "none")', () => {
    expect(scoreF1(new Set(), new Set())).toEqual({ precision: 1, recall: 1, f1: 1 });
  });

  it('scores empty predicted against non-empty truth as 0/0/0', () => {
    expect(scoreF1(new Set(), truth)).toEqual({ precision: 0, recall: 0, f1: 0 });
  });

  it('penalizes spurious predictions via precision', () => {
    const predicted = new Set([...truth, pairKey('q_0001', 'q_0004'), pairKey('q_0002', 'q_0004')]);
    const { precision, recall, f1 } = scoreF1(predicted, truth);
    expect(precision).toBe(0.5);
    expect(recall).toBe(1);
    expect(f1).toBeCloseTo(2 / 3, 10);
  });

  it('penalizes missed pairs via recall', () => {
    const predicted = new Set([pairKey('q_0001', 'q_0003')]);
    const { precision, recall } = scoreF1(predicted, truth);
    expect(precision).toBe(1);
    expect(recall).toBe(0.5);
  });
});

describe('estimateCost', () => {
  const telemetry = (over: Partial<Telemetry>): Telemetry => ({
    input_tokens: 0,
    output_tokens: 0,
    reported_cost_usd: null,
    subcall_count: 0,
    tool_calls: 0,
    execution_time_s: null,
    model_usage: {},
    ...over,
  });

  it('returns 0 for missing telemetry', () => {
    expect(estimateCost(null)).toBe(0);
  });

  it('prefers the backend-reported cost when present', () => {
    expect(estimateCost(telemetry({ reported_cost_usd: 0.42, input_tokens: 1_000_000 }))).toBe(0.42);
  });

  it('estimates from token counts when no cost is reported', () => {
    const t = telemetry({ input_tokens: 1_000_000, output_tokens: 500_000 });
    expect(estimateCost(t)).toBeCloseTo(PRICE_PER_M_INPUT + PRICE_PER_M_OUTPUT / 2, 10);
  });
});
