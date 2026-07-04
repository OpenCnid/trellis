import * as fs from 'fs';
import * as path from 'path';
import { OolongDatasetSchema } from '../src/benchmarks/oolong/schema';
import { poisonCache } from '../src/benchmarks/oolong/poison';
import { neo4jDriver } from '../src/config/db';

// Phase 5 Milestone 4, Act 2 as a standalone tool: flips cached
// has_category labels in place over UNCHANGED bytes (valid Merkle
// provenance, high stored confidence) and writes the poison manifest.
// The full drill (npm run drill:poison) runs this as part of each
// policy experiment; this CLI exists for poisoning a cache by hand.
//
// Flags: --count <n> (default 11), --seed <n> (default 4242),
//        --confidence <c> (default 0.97), --dataset <path>

function getFlag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const DATA_DIR = path.join(__dirname, '..', 'data');

async function main(): Promise<void> {
  const datasetPath = getFlag('dataset') ?? path.join(DATA_DIR, 'oolong_pairs_dataset_v2.json');
  const dataset = OolongDatasetSchema.parse(JSON.parse(fs.readFileSync(datasetPath, 'utf8')));

  const manifest = await poisonCache(neo4jDriver, dataset, {
    count: getFlag('count') ? Number(getFlag('count')) : undefined,
    seed: getFlag('seed') ? Number(getFlag('seed')) : undefined,
    confidence: getFlag('confidence') ? Number(getFlag('confidence')) : undefined
  });

  const manifestPath = path.join(DATA_DIR, 'poison_drill_manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  console.log(`Poisoned ${manifest.poisoned.length} cached beliefs (seed ${manifest.seed}, stored confidence ${manifest.confidence}):`);
  for (const p of manifest.poisoned) {
    console.log(`  ${p.id}: ${p.trueLabel} -> ${p.poisonedLabel}`);
  }
  console.log(`Manifest written to ${manifestPath}`);
}

main()
  .then(async () => {
    await neo4jDriver.close();
    process.exit(0);
  })
  .catch(async err => {
    console.error(`Poisoning failed: ${err.message}`);
    try { await neo4jDriver.close(); } catch {}
    process.exit(1);
  });
