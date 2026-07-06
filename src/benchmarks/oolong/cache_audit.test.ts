import { describe, it, expect } from 'vitest';
import { auditCacheRows, datasetTruth, CachedCategoryRow } from './cache_audit';
import type { OolongDataset } from './schema';

const truth = new Map([
  ['q_0001', 'LOC'],
  ['q_0002', 'HUM'],
  ['q_0003', 'ENTY'],
]);

const row = (qid: string, label: string): CachedCategoryRow => ({ qid, label });

describe('auditCacheRows', () => {
  it('grades correct, wrong, and unknown rows', () => {
    const result = auditCacheRows(truth, [
      row('q_0001', 'loc'),
      row('q_0002', 'desc'), // wrong
      row('q_0003', 'enty'),
      row('q_9999', 'num'), // unknown qid
    ]);
    expect(result).toMatchObject({ cached: 4, correct: 2, wrong: 1, unknown: 1 });
    expect(result.accuracy).toBeCloseTo(2 / 3);
    expect(result.mistakes).toEqual([{ qid: 'q_0002', cached: 'desc', truth: 'HUM' }]);
  });

  it('compares labels case-insensitively', () => {
    const result = auditCacheRows(truth, [row('q_0001', 'LOC'), row('q_0002', 'Hum')]);
    expect(result.correct).toBe(2);
    expect(result.wrong).toBe(0);
    expect(result.accuracy).toBe(1);
  });

  it('reports null accuracy on an empty cache', () => {
    const result = auditCacheRows(truth, []);
    expect(result).toEqual({
      cached: 0, correct: 0, wrong: 0, unknown: 0, accuracy: null, mistakes: []
    });
  });

  it('reports null accuracy when every row is unknown (nothing gradable)', () => {
    const result = auditCacheRows(truth, [row('q_7777', 'loc'), row('q_8888', 'hum')]);
    expect(result.unknown).toBe(2);
    expect(result.accuracy).toBeNull();
  });

  it('bounds the mistake sample at 15 entries without capping the wrong count', () => {
    const rows = Array.from({ length: 20 }, (_, i) => row('q_0001', `wrong_${i}`));
    const result = auditCacheRows(truth, rows);
    expect(result.wrong).toBe(20);
    expect(result.mistakes).toHaveLength(15);
    expect(result.accuracy).toBe(0);
  });
});

describe('datasetTruth', () => {
  it('maps every record id to its category', () => {
    const dataset = {
      name: 'x', seed: 1,
      records: [
        { id: 'q_0001', text: 'a', category: 'LOC', concepts: [] },
        { id: 'q_0002', text: 'b', category: 'ABBR', concepts: [] },
      ],
      ground_truth: { loc_hum_shared_concept_pairs: [] }
    } as unknown as OolongDataset;
    expect(datasetTruth(dataset)).toEqual(new Map([['q_0001', 'LOC'], ['q_0002', 'ABBR']]));
  });
});
