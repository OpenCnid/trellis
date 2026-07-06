import { OolongDataset, OolongPassage, OolongRecord } from './schema';
import { mulberry32 } from '../../core/graph/verification';

// Dataset v2: the anti-shortcut corpus (Session 6, roadmap item 3.3 #3).
//
// v1 (scripts/generate_oolong_dataset.ts) saturated: every city mention
// is the literal capitalized city name embedded in the question text, so
// an agent can satisfy OOLONG-Pairs by substring-scanning text without
// consulting cached classifications. v2 keeps the task and the ground
// truth derivation identical but breaks the substring shortcut three
// ways:
//
//   paraphrases    — a scored fraction of LOC/HUM questions mention
//                    their city only indirectly ("the French capital").
//                    `concepts` keeps the canonical city; the new
//                    `surface_forms` field records the alias used. The
//                    text NEVER contains the canonical token (pinned by
//                    a unit test).
//   near misses    — LOC/HUM questions where a city token names a
//                    quoted non-city artifact (a painting, a waltz) and
//                    ENTY questions annotated with city Y whose text
//                    also drops city X. Recorded in
//                    `distractor_mentions`; never pair members.
//   prose          — non-question paragraphs mentioning city surface
//                    forms, carried in `distractor_passages`. Ingested
//                    into the corpus as :Passage nodes but never valid
//                    pair members and never classified.
//
// Everything is seeded and pure: two calls produce deep-equal output,
// and the CLI (scripts/generate_oolong_dataset_v2.ts) byte-identical
// files. v1's generator, dataset file, and committed benchmark results
// are never touched — v2 is additive and separately versioned.
//
// Question ids are q_1001.. (disjoint from v1's q_0001..q_0220 so both
// corpora can coexist in one graph, while still matching the q_\d+
// shape pinned by parsePredictedPairs and the entity-kind question
// pattern). Passage ids are p_1001.. and never match q_\d+.

export const V2_DATASET_NAME = 'oolong-pairs-trec-synthetic-v2';
export const V2_SEED = 43;

const QUESTION_ID_BASE = 1000; // ids start at q_1001
const PASSAGE_ID_BASE = 1000; // ids start at p_1001

export const CITIES = [
  'paris', 'tokyo', 'nairobi', 'lima', 'oslo', 'seoul', 'cairo',
  'dublin', 'havana', 'mumbai', 'prague', 'quito', 'vienna', 'zagreb'
];

// Deterministic per-city aliases. Invariant (pinned by a unit test):
// no alias contains its canonical city token, case-insensitively, and
// each alias is globally unambiguous for its city.
export const CITY_ALIASES: Record<string, string[]> = {
  paris: ['the French capital', 'the city on the Seine'],
  tokyo: ['the Japanese capital', 'the largest city on Honshu'],
  nairobi: ['the Kenyan capital', 'the capital of Kenya'],
  lima: ['the Peruvian capital', 'the capital of Peru'],
  oslo: ['the Norwegian capital', 'the capital of Norway'],
  seoul: ['the South Korean capital', 'the city on the Han River'],
  cairo: ['the Egyptian capital', 'the largest city on the Nile'],
  dublin: ['the Irish capital', 'the city on the Liffey'],
  havana: ['the Cuban capital', 'the capital of Cuba'],
  mumbai: ['the city formerly called Bombay', 'the largest city in Maharashtra'],
  prague: ['the Czech capital', 'the city on the Vltava'],
  quito: ['the Ecuadorian capital', 'the capital of Ecuador'],
  vienna: ['the Austrian capital', 'the capital of Austria'],
  zagreb: ['the Croatian capital', 'the capital of Croatia']
};

function cap(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function shuffle<T>(arr: T[], rand: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

type Draft = Omit<OolongRecord, 'id'>;
type Mention = (mention: string) => string;

// All template wording is deliberately disjoint from v1's so no
// paragraph text (and therefore no content-addressed block hash) is
// shared between the two corpora — v2 state can be cleaned out of a
// graph without touching v1's physical rows.

const LOC_TEMPLATES: Mention[] = [
  m => `Which nation contains ${m}?`,
  m => `On which continent does ${m} lie?`,
  m => `Which body of water lies nearest to ${m}?`
];

const HUM_TEMPLATES: Mention[] = [
  m => `Who served as mayor of ${m} in the 1980s?`,
  m => `Which sculptor created the central fountain of ${m}?`,
  m => `Who established the first printing press in ${m}?`
];

const NUM_TEMPLATES: Mention[] = [
  m => `How many residents does ${m} have?`,
  m => `In which year did ${m} host its first trade fair?`,
  m => `How many metro lines serve ${m}?`
];

const ENTY_TEMPLATES: Mention[] = [
  m => `Which beverage is ${m} celebrated for?`,
  m => `What bird appears on the official seal of ${m}?`
];

const DESC_CITY_TEMPLATES: Mention[] = [
  m => `Why does ${m} experience frequent fog?`,
  m => `What explains the rapid growth of ${m} after 1950?`
];

const DESC_GENERIC: string[] = [
  'How does a suspension bridge carry its load?',
  'What causes thunder?',
  'Why do metals conduct electricity?',
  'How is glass made from sand?',
  'What keeps a satellite in orbit?',
  'Why does ice float on water?',
  'How does yeast leaven dough?',
  'What makes a desert form?',
  'How do bees navigate to flowers?',
  'Why do stars twinkle?',
  'What causes ocean currents?',
  'How does a battery store energy?',
  'Why is seawater salty?',
  'What produces the northern lights?',
  'How do glaciers shape valleys?'
];

const ABBR_CONCEPTS = [
  'unesco', 'nato', 'nasa', 'unicef', 'laser', 'radar', 'scuba',
  'gdp', 'dna', 'http', 'unhcr', 'opec', 'sonar', 'interpol', 'midi'
];

// Near-miss templates: the city token names a quoted artifact, so the
// gold label is uncontestable — the question is not about the city.
const LOC_NEAR_MISS_TEMPLATES: Array<(c: string) => string> = [
  c => `In which gallery hangs the painting "${cap(c)}"?`,
  c => `Where was the opera "${cap(c)}" first performed?`
];

const HUM_NEAR_MISS_TEMPLATES: Array<(c: string) => string> = [
  c => `Who composed the waltz "${cap(c)}"?`,
  c => `Which novelist wrote the book "${cap(c)}"?`
];

const ENTY_NEAR_MISS_TEMPLATES: Array<(x: string, y: string) => string> = [
  (x, y) => `Which airline operates the "${cap(x)} Express" service out of ${cap(y)}?`,
  (x, y) => `Which shipping firm registered the vessel "${cap(x)}" in ${cap(y)}?`
];

const PASSAGE_TEMPLATES: Array<(a: string, b: string) => string> = [
  (a, b) => `Freight volumes between ${cap(a)} and ${cap(b)} doubled after the two cities opened a direct rail link.`,
  (a, b) => `The morning bulletin reported clear skies over ${cap(a)} while ${cap(b)} recorded heavy rain.`,
  (a, b) => `Delegates from ${cap(a)} and ${cap(b)} signed a sister-city agreement at a ceremony broadcast in both regions.`,
  (a, b) => `A shipping consortium moved its regional office from ${cap(a)} to ${cap(b)} citing lower harbor fees.`
];

const PARAPHRASED_PER_SIDE = 14; // one per city, LOC and HUM each
const NEAR_MISS_PER_SIDE = 6;
const ENTY_NEAR_MISS_COUNT = 8;
const PASSAGE_COUNT = 20;

// Direct records: every template x city combination, seeded shuffle,
// first `count` — the same construction as v1's buildCityCategory.
function buildDirect(
  category: OolongRecord['category'],
  templates: Mention[],
  count: number,
  rand: () => number
): Draft[] {
  const combos: Draft[] = [];
  for (const template of templates) {
    for (const city of CITIES) {
      combos.push({
        text: template(cap(city)),
        category,
        concepts: [city],
        surface_forms: [cap(city)]
      });
    }
  }
  shuffle(combos, rand);
  if (count > combos.length) {
    throw new Error(`Not enough ${category} combos: need ${count}, have ${combos.length}`);
  }
  return combos.slice(0, count);
}

// Paraphrased records: one per city, alias and template seeded. The
// text mentions the city only through the alias; `concepts` keeps the
// canonical name so ground truth stays derivable offline.
function buildParaphrased(
  category: OolongRecord['category'],
  templates: Mention[],
  rand: () => number
): Draft[] {
  const cities = [...CITIES];
  shuffle(cities, rand);
  return cities.map(city => {
    const aliases = CITY_ALIASES[city];
    const alias = aliases[Math.floor(rand() * aliases.length)];
    const template = templates[Math.floor(rand() * templates.length)];
    return {
      text: template(alias),
      category,
      concepts: [city],
      surface_forms: [alias]
    };
  });
}

// Near-miss records: LOC/HUM questions containing a city token that
// names a quoted artifact. Annotated with NO concept — they are about
// the artifact, not the city — so they can never join ground truth.
function buildNearMisses(
  category: OolongRecord['category'],
  templates: Array<(c: string) => string>,
  count: number,
  rand: () => number
): Draft[] {
  const cities = [...CITIES];
  shuffle(cities, rand);
  return cities.slice(0, count).map((city, i) => ({
    text: templates[i % templates.length](city),
    category,
    concepts: [],
    surface_forms: [],
    distractor_mentions: [city]
  }));
}

// Cross-city near misses: ENTY questions genuinely about city Y whose
// text also drops city X inside a quoted proper name.
function buildEntyNearMisses(count: number, rand: () => number): Draft[] {
  const xs = [...CITIES];
  const ys = [...CITIES];
  shuffle(xs, rand);
  shuffle(ys, rand);
  const drafts: Draft[] = [];
  for (let i = 0; i < count; i++) {
    const x = xs[i];
    const y = ys[i] === x ? ys[(i + 1) % ys.length] : ys[i];
    drafts.push({
      text: ENTY_NEAR_MISS_TEMPLATES[i % ENTY_NEAR_MISS_TEMPLATES.length](x, y),
      category: 'ENTY',
      concepts: [y],
      surface_forms: [cap(y)],
      distractor_mentions: [x]
    });
  }
  return drafts;
}

function buildPassages(rand: () => number): OolongPassage[] {
  const passages: Array<Omit<OolongPassage, 'id'>> = [];
  const pairs: Array<[string, string]> = [];
  for (const a of CITIES) {
    for (const b of CITIES) {
      if (a < b) pairs.push([a, b]);
    }
  }
  shuffle(pairs, rand);
  for (let i = 0; i < PASSAGE_COUNT; i++) {
    const [a, b] = pairs[i];
    passages.push({
      text: PASSAGE_TEMPLATES[i % PASSAGE_TEMPLATES.length](a, b),
      surface_forms: [a, b]
    });
  }
  return passages.map((p, i) => ({
    id: `p_${String(PASSAGE_ID_BASE + i + 1).padStart(4, '0')}`,
    ...p
  }));
}

// Ground truth: every unordered (LOC, HUM) pair sharing >= 1 concept —
// exactly v1's derivation. Exported for the hand-computed fixture test.
export function deriveLocHumPairs(records: OolongRecord[]): Array<[string, string]> {
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
  return pairs;
}

export function buildV2Dataset(): OolongDataset {
  const rand = mulberry32(V2_SEED);

  const drafts: Draft[] = [
    // LOC 50 = 30 direct + 14 paraphrased + 6 near-miss
    ...buildDirect('LOC', LOC_TEMPLATES, 30, rand),
    ...buildParaphrased('LOC', LOC_TEMPLATES, rand),
    ...buildNearMisses('LOC', LOC_NEAR_MISS_TEMPLATES, NEAR_MISS_PER_SIDE, rand),
    // HUM 50 = 30 direct + 14 paraphrased + 6 near-miss
    ...buildDirect('HUM', HUM_TEMPLATES, 30, rand),
    ...buildParaphrased('HUM', HUM_TEMPLATES, rand),
    ...buildNearMisses('HUM', HUM_NEAR_MISS_TEMPLATES, NEAR_MISS_PER_SIDE, rand),
    // NUM 35 direct
    ...buildDirect('NUM', NUM_TEMPLATES, 35, rand),
    // ENTY 35 = 27 direct + 8 cross-city near-miss
    ...buildDirect('ENTY', ENTY_TEMPLATES, 27, rand),
    ...buildEntyNearMisses(ENTY_NEAR_MISS_COUNT, rand),
    // DESC 35 = 20 city + 15 generic
    ...buildDirect('DESC', DESC_CITY_TEMPLATES, 20, rand),
    ...DESC_GENERIC.map(text => ({
      text, category: 'DESC' as const, concepts: [], surface_forms: []
    })),
    // ABBR 15
    ...ABBR_CONCEPTS.map(concept => ({
      text: `What is the expanded form of ${concept.toUpperCase()}?`,
      category: 'ABBR' as const,
      concepts: [concept],
      surface_forms: [concept.toUpperCase()]
    }))
  ];

  // Interleave categories like a real corpus, then assign sequential
  // ids disjoint from v1's range.
  shuffle(drafts, rand);
  const records: OolongRecord[] = drafts.map((draft, i) => ({
    id: `q_${String(QUESTION_ID_BASE + i + 1).padStart(4, '0')}`,
    ...draft
  }));

  const distractor_passages = buildPassages(rand);

  return {
    name: V2_DATASET_NAME,
    seed: V2_SEED,
    records,
    distractor_passages,
    ground_truth: { loc_hum_shared_concept_pairs: deriveLocHumPairs(records) }
  };
}
