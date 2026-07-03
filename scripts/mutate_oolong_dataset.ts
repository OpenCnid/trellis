import * as fs from 'fs';
import * as path from 'path';
import { OolongDatasetSchema } from '../src/benchmarks/oolong/schema';
import { mutateDataset } from '../src/benchmarks/oolong/mutate';

// Update Drill Act 2 (CLI): mutates the base OOLONG corpus into v2 and
// writes the mutation manifest. Deterministic for a given seed.
//
//   npx tsx scripts/mutate_oolong_dataset.ts [--seed 1337]

const BASE_PATH = path.join(__dirname, '..', 'data', 'oolong_pairs_dataset.json');
const V2_PATH = path.join(__dirname, '..', 'data', 'oolong_pairs_dataset_v2.json');
const MANIFEST_PATH = path.join(__dirname, '..', 'data', 'update_drill_manifest.json');

function main(): void {
  const seedArg = process.argv.indexOf('--seed');
  const seed = seedArg !== -1 ? parseInt(process.argv[seedArg + 1], 10) : 1337;

  const base = OolongDatasetSchema.parse(JSON.parse(fs.readFileSync(BASE_PATH, 'utf8')));
  const { dataset, manifest } = mutateDataset(base, seed);

  // Boundary validation (Architecture Invariant 3) before writing.
  OolongDatasetSchema.parse(dataset);

  fs.writeFileSync(V2_PATH, JSON.stringify(dataset, null, 2) + '\n');
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');

  const basePairs = base.ground_truth.loc_hum_shared_concept_pairs.length;
  const v2Pairs = dataset.ground_truth.loc_hum_shared_concept_pairs.length;
  const byFlavor = manifest.mutations.reduce<Record<string, number>>((acc, m) => {
    acc[m.flavor] = (acc[m.flavor] ?? 0) + 1;
    return acc;
  }, {});

  console.log('======================================================');
  console.log(`Update Drill mutation (seed=${seed})`);
  console.log('======================================================');
  console.log(`  Base:     ${base.name} (${base.records.length} records, ${basePairs} pairs)`);
  console.log(`  Mutated:  ${dataset.name} (${manifest.mutations.length} mutations: ${JSON.stringify(byFlavor)})`);
  console.log(`  Pairs:    ${basePairs} -> ${v2Pairs}`);
  console.log(`  Mutation rate: ${(manifest.mutations.length / base.records.length * 100).toFixed(1)}%`);
  console.log('  Mutations:');
  for (const m of manifest.mutations) {
    const catChange = m.before.category !== m.after.category ? ` ${m.before.category}->${m.after.category}` : ` ${m.after.category}`;
    const cityChange = m.before.concepts[0] !== m.after.concepts[0] ? ` city ${m.before.concepts[0]}->${m.after.concepts[0]}` : '';
    console.log(`    ${m.id} [${m.flavor}]${catChange}${cityChange}`);
  }
  console.log(`\n  v2 dataset: ${V2_PATH}`);
  console.log(`  manifest:   ${MANIFEST_PATH}`);
}

main();
