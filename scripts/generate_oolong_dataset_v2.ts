import * as fs from 'fs';
import * as path from 'path';
import { OolongDatasetSchema } from '../src/benchmarks/oolong/schema';
import { buildV2Dataset } from '../src/benchmarks/oolong/generate_v2';

// CLI for dataset v2 (the anti-shortcut corpus). All generation logic
// lives in src/benchmarks/oolong/generate_v2.ts so it is unit-testable
// without file I/O; this script only validates and writes. v1's
// generator and data/oolong_pairs_dataset.json are never touched.
//
// Note the filename: data/oolong_pairs_dataset_v2.json is already taken
// by the Update Drill (the MUTATED byte-version 2 of the v1 corpus,
// referenced by the poison drill), so the harder corpus lives at
// data/oolong_pairs_dataset_hard.json.

const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'oolong_pairs_dataset_hard.json');

const dataset = OolongDatasetSchema.parse(buildV2Dataset());

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(dataset, null, 2) + '\n');

const byCategory = dataset.records.reduce<Record<string, number>>((acc, r) => {
  acc[r.category] = (acc[r.category] ?? 0) + 1;
  return acc;
}, {});
const paraphrased = dataset.records.filter(
  r => r.surface_forms?.some((s, i) => s.toLowerCase() !== r.concepts[i])
).length;
const nearMiss = dataset.records.filter(r => (r.distractor_mentions?.length ?? 0) > 0).length;

console.log('======================================================');
console.log(`OOLONG-Pairs dataset v2 generated (deterministic, seed=${dataset.seed})`);
console.log('======================================================');
console.log(`  Output:              ${OUTPUT_PATH}`);
console.log(`  Total records:       ${dataset.records.length}`);
console.log(`  Category breakdown:  ${JSON.stringify(byCategory)}`);
console.log(`  Paraphrased records: ${paraphrased}`);
console.log(`  Near-miss records:   ${nearMiss}`);
console.log(`  Prose passages:      ${dataset.distractor_passages?.length ?? 0}`);
console.log(`  Ground-truth LOC-HUM pairs sharing a concept: ${dataset.ground_truth.loc_hum_shared_concept_pairs.length}`);
