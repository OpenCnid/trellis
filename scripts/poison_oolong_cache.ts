import * as fs from 'fs';
import * as path from 'path';
import { OolongDatasetSchema } from '../src/benchmarks/oolong/schema';
import { poisonCache } from '../src/benchmarks/oolong/poison';
import { neo4jDriver } from '../src/config/db';
import {
  assertConfirmed,
  assertDrillTarget,
  printTargetBanner,
  readNeo4jMarker,
  reportRefusal,
} from '../src/core/runtime/drill_target';

// Phase 5 Milestone 4, Act 2 as a standalone tool: flips cached
// has_category labels in place over UNCHANGED bytes (valid Merkle
// provenance, high stored confidence) and writes the poison manifest.
// The full drill (npm run drill:poison) runs this as part of each
// policy experiment; this CLI exists for poisoning a cache by hand.
//
//   npm run drill:poison-cache                        (plan only)
//   npm run drill:poison-cache -- --confirm-poison    (poison)
//
// Poisoning writes beliefs that are wrong ON PURPOSE and indistinguishable
// from legitimate ones by construction: the original provenance stays
// live, the bytes never change, and stored confidence is set HIGH. Phase
// 4's Merkle machinery cannot detect them — that is the whole point of
// the drill, and the reason a poisoned belief in a real graph would be
// permanent. So the run refuses unless the graph carries a drill-target
// marker AND the echoed plan was confirmed.
//
// Flags: --count <n> (default 11), --seed <n> (default 4242),
//        --confidence <c> (default 0.97), --dataset <path>,
//        --confirm-poison (required to write)

function getFlag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const DATA_DIR = path.join(__dirname, '..', 'data');

async function main(): Promise<number> {
  const confirmed = process.argv.includes('--confirm-poison');
  const datasetPath = getFlag('dataset') ?? path.join(DATA_DIR, 'oolong_pairs_dataset_v2.json');
  const dataset = OolongDatasetSchema.parse(JSON.parse(fs.readFileSync(datasetPath, 'utf8')));

  const count = getFlag('count') ? Number(getFlag('count')) : 11;
  const seed = getFlag('seed') ? Number(getFlag('seed')) : 4242;
  const confidence = getFlag('confidence') ? Number(getFlag('confidence')) : 0.97;

  const markers = await assertDrillTarget(['neo4j'], {
    neo4j: () => readNeo4jMarker(neo4jDriver),
    postgres: async () => null,
  });
  printTargetBanner(['neo4j'], markers);

  console.log('\nThis will poison the cached has_category beliefs of:');
  console.log(`  dataset:     ${dataset.name} (${datasetPath})`);
  console.log(`  records:     ${dataset.records.length}`);
  console.log(`  to poison:   ${count} belief(s), seed ${seed}`);
  console.log(`  confidence:  ${confidence} (stored HIGH — worst case by design)`);
  console.log('  Bytes are NOT changed and provenance stays live, so the poisoned');
  console.log('  beliefs are Merkle-valid and undetectable outside the Phase 5 verifier.');

  assertConfirmed({
    confirmed,
    flag: '--confirm-poison',
    act: `poisoning writes ${count} deliberately wrong, high-confidence beliefs that `
      + 'carry valid provenance and cannot be detected by byte-level machinery.',
  });

  const manifest = await poisonCache(neo4jDriver, dataset, { count, seed, confidence });

  const manifestPath = path.join(DATA_DIR, 'poison_drill_manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  console.log(`\nPoisoned ${manifest.poisoned.length} cached beliefs (seed ${manifest.seed}, stored confidence ${manifest.confidence}):`);
  for (const p of manifest.poisoned) {
    console.log(`  ${p.id}: ${p.trueLabel} -> ${p.poisonedLabel}`);
  }
  console.log(`Manifest written to ${manifestPath}`);
  return 0;
}

main()
  .then(async code => {
    await neo4jDriver.close();
    process.exit(code);
  })
  .catch(async err => {
    const refusalCode = reportRefusal(err);
    if (refusalCode === null) {
      console.error(`Poisoning failed: ${err instanceof Error ? err.message : err}`);
    }
    try { await neo4jDriver.close(); } catch {}
    process.exit(refusalCode ?? 1);
  });
