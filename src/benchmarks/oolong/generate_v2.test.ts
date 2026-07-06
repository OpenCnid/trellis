import { describe, it, expect } from 'vitest';
import {
  buildV2Dataset,
  deriveLocHumPairs,
  CITY_ALIASES,
  CITIES,
  V2_DATASET_NAME
} from './generate_v2';
import { OolongDatasetSchema, OolongRecord } from './schema';

// The v2 dataset is committed at data/oolong_pairs_dataset_hard.json;
// these tests pin the generator that produced it. If a pin here fails,
// the corpus's anti-shortcut guarantees have regressed.

const dataset = buildV2Dataset();

const isParaphrased = (r: OolongRecord): boolean =>
  (r.surface_forms ?? []).some((s, i) => s.toLowerCase() !== r.concepts[i]);

describe('buildV2Dataset determinism and shape', () => {
  it('two builds produce byte-identical output', () => {
    expect(JSON.stringify(buildV2Dataset())).toBe(JSON.stringify(buildV2Dataset()));
  });

  it('validates against the extended Zod schema', () => {
    expect(() => OolongDatasetSchema.parse(dataset)).not.toThrow();
    expect(dataset.name).toBe(V2_DATASET_NAME);
  });

  it('has the expected category distribution over 220 records', () => {
    const byCategory = dataset.records.reduce<Record<string, number>>((acc, r) => {
      acc[r.category] = (acc[r.category] ?? 0) + 1;
      return acc;
    }, {});
    expect(dataset.records).toHaveLength(220);
    expect(byCategory).toEqual({ LOC: 50, HUM: 50, NUM: 35, ENTY: 35, DESC: 35, ABBR: 15 });
    expect(dataset.distractor_passages).toHaveLength(20);
  });

  it('question ids are unique, q_\\d+-shaped, and disjoint from v1 (>= q_1001)', () => {
    const ids = dataset.records.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^q_\d{4}$/);
      expect(Number(id.slice(2))).toBeGreaterThanOrEqual(1001);
    }
  });

  it('passage ids never match the question id shape', () => {
    for (const p of dataset.distractor_passages!) {
      expect(p.id).not.toMatch(/^q_\d+$/);
      expect(p.id).toMatch(/^p_\d{4}$/);
    }
  });

  it('record texts are unique', () => {
    expect(new Set(dataset.records.map(r => r.text)).size).toBe(dataset.records.length);
  });
});

describe('anti-shortcut pin: paraphrased mentions', () => {
  it('no alias contains its canonical city token', () => {
    for (const [city, aliases] of Object.entries(CITY_ALIASES)) {
      for (const alias of aliases) {
        expect(alias.toLowerCase()).not.toContain(city);
      }
    }
    expect(Object.keys(CITY_ALIASES).sort()).toEqual([...CITIES].sort());
  });

  it('every paraphrased record text lacks its canonical city token (case-insensitive)', () => {
    const paraphrased = dataset.records.filter(isParaphrased);
    for (const r of paraphrased) {
      for (const city of r.concepts) {
        expect(r.text.toLowerCase()).not.toContain(city);
      }
    }
  });

  it('exactly 28 paraphrased records exist: one LOC and one HUM per city', () => {
    const paraphrased = dataset.records.filter(isParaphrased);
    expect(paraphrased).toHaveLength(28);
    for (const category of ['LOC', 'HUM'] as const) {
      const cities = paraphrased.filter(r => r.category === category).flatMap(r => r.concepts);
      expect([...cities].sort()).toEqual([...CITIES].sort());
    }
  });
});

describe('distractors are never pair members', () => {
  const pairIds = new Set(dataset.ground_truth.loc_hum_shared_concept_pairs.flat());

  it('near-miss records mention an unannotated city and stay out of ground truth', () => {
    const nearMisses = dataset.records.filter(r => (r.distractor_mentions?.length ?? 0) > 0);
    expect(nearMisses).toHaveLength(20);
    for (const r of nearMisses) {
      for (const city of r.distractor_mentions!) {
        expect(r.concepts).not.toContain(city);
        expect(r.text.toLowerCase()).toContain(city);
      }
    }
    const conceptlessNearMisses = nearMisses.filter(r => r.concepts.length === 0);
    expect(conceptlessNearMisses).toHaveLength(12); // 6 LOC + 6 HUM
    for (const r of conceptlessNearMisses) {
      expect(pairIds.has(r.id)).toBe(false);
    }
  });

  it('ENTY near-misses are annotated with a different city than they name-drop', () => {
    const entyNearMisses = dataset.records.filter(
      r => r.category === 'ENTY' && (r.distractor_mentions?.length ?? 0) > 0
    );
    expect(entyNearMisses).toHaveLength(8);
    for (const r of entyNearMisses) {
      expect(r.concepts).toHaveLength(1);
      expect(pairIds.has(r.id)).toBe(false); // ENTY never joins LOC-HUM pairs
    }
  });

  it('prose passages are never pair members', () => {
    for (const p of dataset.distractor_passages!) {
      expect(pairIds.has(p.id)).toBe(false);
      expect(p.text.endsWith('?')).toBe(false); // prose, not questions
      for (const city of p.surface_forms) {
        expect(p.text.toLowerCase()).toContain(city);
      }
    }
  });
});

describe('ground-truth derivation', () => {
  it('matches a hand-computed fixture on a small record set', () => {
    const fixture: OolongRecord[] = [
      { id: 'q_0001', text: 'a', category: 'LOC', concepts: ['paris'] },
      { id: 'q_0002', text: 'b', category: 'LOC', concepts: ['lima'] },
      { id: 'q_0003', text: 'c', category: 'HUM', concepts: ['paris'] },
      { id: 'q_0004', text: 'd', category: 'HUM', concepts: ['paris'] },
      { id: 'q_0005', text: 'e', category: 'HUM', concepts: ['oslo'] },
      { id: 'q_0006', text: 'f', category: 'LOC', concepts: [] }, // near-miss: no pairs
      { id: 'q_0007', text: 'g', category: 'ENTY', concepts: ['paris'] }, // not LOC/HUM: no pairs
    ];
    // Hand-computed: q_0001 (LOC paris) x {q_0003, q_0004} (HUM paris).
    expect(deriveLocHumPairs(fixture)).toEqual([
      ['q_0001', 'q_0003'],
      ['q_0001', 'q_0004'],
    ]);
  });

  it('the dataset ground truth equals an independent re-derivation', () => {
    expect(dataset.ground_truth.loc_hum_shared_concept_pairs).toEqual(
      deriveLocHumPairs(dataset.records)
    );
    // Cross-check the aggregate: sum over cities of LOC_city x HUM_city.
    let expected = 0;
    for (const city of CITIES) {
      const locs = dataset.records.filter(r => r.category === 'LOC' && r.concepts.includes(city)).length;
      const hums = dataset.records.filter(r => r.category === 'HUM' && r.concepts.includes(city)).length;
      expected += locs * hums;
    }
    expect(dataset.ground_truth.loc_hum_shared_concept_pairs).toHaveLength(expected);
  });
});
