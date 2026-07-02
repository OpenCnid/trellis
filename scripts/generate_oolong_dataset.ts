import * as fs from 'fs';
import * as path from 'path';
import { OolongDataset, OolongDatasetSchema, OolongRecord } from '../src/benchmarks/oolong/schema';

// Deterministic OOLONG-Pairs dataset generator.
//
// The genuine OOLONG-Pairs task requires per-question concept annotations
// (e.g. which city a question mentions) so that ground-truth pairs are
// computable. Plain TREC only carries category labels, and Milestone 1
// excludes the LLM extraction workers — so this generator produces a
// TREC-style corpus with the annotations embedded. It is seeded and fully
// deterministic: running it twice yields a byte-identical file.

const SEED = 42;
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'oolong_pairs_dataset.json');

// mulberry32 — tiny deterministic PRNG
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CITIES = [
  'paris', 'tokyo', 'nairobi', 'lima', 'oslo', 'seoul', 'cairo',
  'dublin', 'havana', 'mumbai', 'prague', 'quito', 'vienna', 'zagreb'
];

function cap(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

interface Template {
  make: (city: string) => string;
}

const LOC_TEMPLATES: Template[] = [
  { make: c => `Which country is ${cap(c)} located in?` },
  { make: c => `Which river runs through the center of ${cap(c)}?` },
  { make: c => `In which hemisphere is ${cap(c)} situated?` },
  { make: c => `What mountain range is visible from ${cap(c)}?` }
];

const HUM_TEMPLATES: Template[] = [
  { make: c => `Who was the mayor of ${cap(c)} during the 1990s?` },
  { make: c => `Which architect designed the opera house in ${cap(c)}?` },
  { make: c => `Who founded the oldest university in ${cap(c)}?` },
  { make: c => `Which explorer was born in ${cap(c)}?` }
];

const NUM_TEMPLATES: Template[] = [
  { make: c => `What is the population of ${cap(c)}?` },
  { make: c => `How many bridges cross the main river in ${cap(c)}?` },
  { make: c => `In what year was ${cap(c)} founded?` }
];

const ENTY_TEMPLATES: Template[] = [
  { make: c => `What dish is ${cap(c)} famous for?` },
  { make: c => `What flower is the official symbol of ${cap(c)}?` },
  { make: c => `Which airline is headquartered in ${cap(c)}?` }
];

const DESC_CITY_TEMPLATES: Template[] = [
  { make: c => `What is the history behind the old town of ${cap(c)}?` },
  { make: c => `Why is the climate of ${cap(c)} so mild?` }
];

const DESC_GENERIC: string[] = [
  'What is photosynthesis?',
  'How does a refrigerator keep food cold?',
  'What causes a rainbow to appear?',
  'Why do leaves change color in autumn?',
  'What is the greenhouse effect?',
  'How do vaccines train the immune system?',
  'What makes a violin sound different from a cello?',
  'Why does bread rise when baked?',
  'What is metal fatigue?',
  'How do tides form?',
  'What is a black hole?',
  'Why is the sky blue?',
  'How does a compass work?',
  'What is fermentation?',
  'Why do onions make you cry?'
];

const ABBR_ITEMS: Array<{ text: string; concept: string }> = [
  { text: 'What does UNESCO stand for?', concept: 'unesco' },
  { text: 'What does NATO stand for?', concept: 'nato' },
  { text: 'What is the full form of NASA?', concept: 'nasa' },
  { text: 'What does UNICEF stand for?', concept: 'unicef' },
  { text: 'What is the expansion of the acronym LASER?', concept: 'laser' },
  { text: 'What does RADAR stand for?', concept: 'radar' },
  { text: 'What is the full form of SCUBA?', concept: 'scuba' },
  { text: 'What does GDP stand for?', concept: 'gdp' },
  { text: 'What is the expansion of DNA?', concept: 'dna' },
  { text: 'What does HTTP stand for?', concept: 'http' },
  { text: 'What is the full form of UNHCR?', concept: 'unhcr' },
  { text: 'What does OPEC stand for?', concept: 'opec' },
  { text: 'What is the expansion of SONAR?', concept: 'sonar' },
  { text: 'What does INTERPOL stand for?', concept: 'interpol' },
  { text: 'What is the full form of MIDI?', concept: 'midi' }
];

// Builds every template x city combination for a category, then takes
// the first `count` in shuffled (seeded) order. Texts are unique by
// construction: each (template, city) combo appears at most once.
function buildCityCategory(
  category: OolongRecord['category'],
  templates: Template[],
  count: number,
  rand: () => number
): Array<Omit<OolongRecord, 'id'>> {
  const combos: Array<Omit<OolongRecord, 'id'>> = [];
  for (const template of templates) {
    for (const city of CITIES) {
      combos.push({ text: template.make(city), category, concepts: [city] });
    }
  }
  shuffle(combos, rand);
  if (count > combos.length) {
    throw new Error(`Not enough ${category} combos: need ${count}, have ${combos.length}`);
  }
  return combos.slice(0, count);
}

function shuffle<T>(arr: T[], rand: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function generate(): OolongDataset {
  const rand = mulberry32(SEED);

  const drafts: Array<Omit<OolongRecord, 'id'>> = [
    ...buildCityCategory('LOC', LOC_TEMPLATES, 50, rand),
    ...buildCityCategory('HUM', HUM_TEMPLATES, 50, rand),
    ...buildCityCategory('NUM', NUM_TEMPLATES, 35, rand),
    ...buildCityCategory('ENTY', ENTY_TEMPLATES, 35, rand),
    ...buildCityCategory('DESC', DESC_CITY_TEMPLATES, 20, rand),
    ...DESC_GENERIC.map(text => ({ text, category: 'DESC' as const, concepts: [] })),
    ...ABBR_ITEMS.map(({ text, concept }) => ({ text, category: 'ABBR' as const, concepts: [concept] }))
  ];

  // Interleave categories like a real corpus, then assign sequential IDs.
  shuffle(drafts, rand);
  const records: OolongRecord[] = drafts.map((draft, i) => ({
    id: `q_${String(i + 1).padStart(4, '0')}`,
    ...draft
  }));

  // Ground truth: every unordered (LOC, HUM) pair sharing >= 1 concept.
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

  return {
    name: 'oolong-pairs-trec-synthetic-v1',
    seed: SEED,
    records,
    ground_truth: { loc_hum_shared_concept_pairs: pairs }
  };
}

const dataset = OolongDatasetSchema.parse(generate());

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(dataset, null, 2) + '\n');

const byCategory = dataset.records.reduce<Record<string, number>>((acc, r) => {
  acc[r.category] = (acc[r.category] ?? 0) + 1;
  return acc;
}, {});

console.log('======================================================');
console.log('OOLONG-Pairs dataset generated (deterministic, seed=42)');
console.log('======================================================');
console.log(`  Output:             ${OUTPUT_PATH}`);
console.log(`  Total records:      ${dataset.records.length}`);
console.log(`  Category breakdown: ${JSON.stringify(byCategory)}`);
console.log(`  Ground-truth LOC-HUM pairs sharing a concept: ${dataset.ground_truth.loc_hum_shared_concept_pairs.length}`);
