import { OolongDataset, OolongRecord } from './schema';

// Phase 4 Milestone 4, Act 2: deterministic corpus mutation.
//
// Produces corpus v2 by mutating ~5% of questions (11 of 220) in three
// flavors, each stressing a different part of the invalidation loop:
//
//   rewrite       — same category, same city, new wording. The cached
//                   classification's provenance is orphaned, but honest
//                   re-derivation reaches the same label.
//   category_flip — the wording changes so the CORRECT label changes.
//                   The poisoned-cache scenario: the old cached label is
//                   now wrong, and only invalidation saves the answer.
//   city_swap     — the question now mentions a different city,
//                   exercising the deterministic mention scan.
//
// Question ids are stable across versions (identity lives in the id;
// the text is the bytes). Seeded PRNG: same base + seed => same v2.

export type MutationFlavor = 'rewrite' | 'category_flip' | 'city_swap';

export interface Mutation {
  id: string;
  flavor: MutationFlavor;
  before: { text: string; category: string; concepts: string[] };
  after: { text: string; category: string; concepts: string[] };
}

export interface DrillManifest {
  base_dataset: string;
  mutated_dataset: string;
  seed: number;
  mutations: Mutation[];
}

const REWRITE_COUNT = 5;
const FLIP_COUNT = 3;
const SWAP_COUNT = 3;

// mulberry32 — tiny deterministic PRNG (same as the dataset generator)
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cap(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Alternate phrasings that keep the expected-answer type (and therefore
// the TREC category) while changing every content byte of the sentence.
const REWRITE_TEMPLATES: Record<string, Array<(c: string) => string>> = {
  LOC: [
    c => `In which country would a traveler find ${cap(c)}?`,
    c => `Which river flows through the heart of ${cap(c)}?`,
    c => `Which hemisphere holds the city of ${cap(c)}?`,
    c => `Which mountain range looms on the horizon of ${cap(c)}?`
  ],
  HUM: [
    c => `Who served as mayor of ${cap(c)} through the 1990s?`,
    c => `Which person drew up the plans for the opera house of ${cap(c)}?`,
    c => `Who established the earliest university of ${cap(c)}?`,
    c => `Which famous explorer hails from ${cap(c)}?`
  ]
};

// Flips are directional and pair-relevant: removing a LOC or HUM label
// deletes an entire row of ground-truth pairs; promoting a NUM to LOC
// creates one. Each template must clearly read as the NEW category to a
// rubric-following classifier while still mentioning the city.
const FLIP_SPECS: Array<{ from: OolongRecord['category']; to: OolongRecord['category']; make: (c: string) => string }> = [
  { from: 'LOC', to: 'NUM', make: c => `How many public parks lie within the city limits of ${cap(c)}?` },
  { from: 'HUM', to: 'ENTY', make: c => `What local delicacy is served at the street festivals of ${cap(c)}?` },
  { from: 'NUM', to: 'LOC', make: c => `Which lake lies along the eastern edge of ${cap(c)}?` }
];

export function mutateDataset(base: OolongDataset, seed: number = 1337): { dataset: OolongDataset; manifest: DrillManifest } {
  const rand = mulberry32(seed);
  const records: OolongRecord[] = base.records.map(r => ({ ...r, concepts: [...r.concepts] }));
  const texts = new Set(records.map(r => r.text));
  const cities = [...new Set(
    base.records.filter(r => r.category === 'LOC').flatMap(r => r.concepts)
  )].sort();

  const byId = new Map(records.map(r => [r.id, r]));
  const mutatedIds = new Set<string>();
  const mutations: Mutation[] = [];

  // Uniqueness-preserving text replacement: texts are unique in the base
  // corpus by construction, and every mutation must keep them unique or
  // two questions would collapse into one Merkle-addressed AST node.
  const claimText = (candidate: string, originalText: string): string | null => {
    if (texts.has(candidate)) return null;
    texts.delete(originalText);
    texts.add(candidate);
    return candidate;
  };

  const pickTarget = (pool: OolongRecord[]): OolongRecord => {
    const eligible = pool.filter(r => !mutatedIds.has(r.id) && r.concepts.length === 1 && cities.includes(r.concepts[0]));
    if (eligible.length === 0) throw new Error('Mutation target pool exhausted — corpus too small for the requested mutation counts.');
    return eligible[Math.floor(rand() * eligible.length)];
  };

  const applyMutation = (record: OolongRecord, flavor: MutationFlavor, after: { text: string; category: OolongRecord['category']; concepts: string[] }) => {
    mutations.push({
      id: record.id,
      flavor,
      before: { text: record.text, category: record.category, concepts: [...record.concepts] },
      after: { text: after.text, category: after.category, concepts: [...after.concepts] }
    });
    record.text = after.text;
    record.category = after.category;
    record.concepts = after.concepts;
    mutatedIds.add(record.id);
  };

  // --- Flavor 1: rewrites (same category, same city) ---
  for (let i = 0; i < REWRITE_COUNT; i++) {
    const category = i % 2 === 0 ? 'LOC' : 'HUM'; // alternate, pair-relevant both ways
    const record = pickTarget(records.filter(r => r.category === category));
    const city = record.concepts[0];
    const templates = REWRITE_TEMPLATES[category];
    let text: string | null = null;
    for (let t = 0; t < templates.length && text === null; t++) {
      const idx = (Math.floor(rand() * templates.length) + t) % templates.length;
      text = claimText(templates[idx](city), record.text);
    }
    if (text === null) throw new Error(`No unique rewrite available for ${record.id} (${category}/${city}).`);
    applyMutation(record, 'rewrite', { text, category: record.category, concepts: [city] });
  }

  // --- Flavor 2: category flips ---
  for (const spec of FLIP_SPECS.slice(0, FLIP_COUNT)) {
    const record = pickTarget(records.filter(r => r.category === spec.from));
    const city = record.concepts[0];
    const text = claimText(spec.make(city), record.text);
    if (text === null) throw new Error(`No unique flip text available for ${record.id} (${spec.from}→${spec.to}/${city}).`);
    applyMutation(record, 'category_flip', { text, category: spec.to, concepts: [city] });
  }

  // --- Flavor 3: city swaps (LOC/HUM, template re-instantiated) ---
  for (let i = 0; i < SWAP_COUNT; i++) {
    const category = i % 2 === 0 ? 'HUM' : 'LOC';
    const record = pickTarget(records.filter(r => r.category === category));
    const oldCity = record.concepts[0];
    // The generator instantiates each template with cap(city) exactly
    // once, so swapping is a single capitalized-name substitution.
    let text: string | null = null;
    let newCity: string | null = null;
    const offset = Math.floor(rand() * cities.length);
    for (let c = 0; c < cities.length && text === null; c++) {
      const candidateCity = cities[(offset + c) % cities.length];
      if (candidateCity === oldCity) continue;
      const candidate = record.text.split(cap(oldCity)).join(cap(candidateCity));
      if (candidate === record.text) throw new Error(`City swap failed for ${record.id}: "${cap(oldCity)}" not found in text.`);
      if (claimText(candidate, record.text)) {
        text = candidate;
        newCity = candidateCity;
      }
    }
    if (text === null || newCity === null) throw new Error(`No unique city swap available for ${record.id}.`);
    applyMutation(record, 'city_swap', { text, category: record.category, concepts: [newCity] });
  }

  // Recompute ground truth exactly as the generator does: every
  // unordered (LOC, HUM) pair sharing >= 1 concept.
  const pairs: Array<[string, string]> = [];
  const locs = records.filter(r => r.category === 'LOC');
  const hums = records.filter(r => r.category === 'HUM');
  for (const loc of locs) {
    for (const hum of hums) {
      if (loc.concepts.some(c => hum.concepts.includes(c))) {
        pairs.push([loc.id, hum.id]);
      }
    }
  }
  pairs.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));

  const mutatedName = `${base.name}-drill-v2`;
  mutations.sort((a, b) => a.id.localeCompare(b.id));

  return {
    dataset: {
      name: mutatedName,
      seed: base.seed,
      records,
      ground_truth: { loc_hum_shared_concept_pairs: pairs }
    },
    manifest: {
      base_dataset: base.name,
      mutated_dataset: mutatedName,
      seed,
      mutations
    }
  };
}
