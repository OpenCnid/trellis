import * as fs from 'fs';
import * as path from 'path';
import { OolongDataset, OolongDatasetSchema } from './oolong/schema';
import { QueryTelemetry, cityTruth, executeScoredQuery } from './oolong/scoring';
import { mutateDataset, DrillManifest } from './oolong/mutate';
import { reingestDataset, auditInvalidation, InvalidationAudit, ReingestTelemetry, DRILL_DOC_KEY } from './oolong/reingest';
import { pgPool, neo4jDriver } from '../config/db';
import {
  assertDrillTarget,
  liveMarkerReaders,
  printTargetBanner,
  reportRefusal,
} from '../core/runtime/drill_target';

// Phase 4 Milestone 4: the Update Drill (PHASE_4_PRD.md §Milestone 4).
//
// Four acts, runnable together (`npm run drill:update`) or individually
// (`--acts 2,3` — acts 2 and 3 are LLM-free):
//
//   Act 1  Warm-up: run the standard 20-query sequence against the v1
//          corpus to seed the flywheel cache. Requires the API server,
//          RLM worker, and an OPENAI_API_KEY. Also the cost baseline:
//          a cold 20-query run is what a full rebuild would pay again.
//   Act 2  Mutation: derive corpus v2 (~5% of questions rewritten,
//          category-flipped, or city-swapped) + the manifest.
//   Act 3  Re-ingest & sweep: versioned re-ingest of v2 under the same
//          doc_key; Merkle diff, semantic refresh of changed records,
//          quarantine sweep, and the invalidation audit (recall must be
//          measured HERE — Act 4 legitimately clears quarantines).
//   Act 4  Post-update: re-run the 20-query sequence scored against v2
//          ground truth; assemble the PRD metrics table.
//
// Preconditions for a full drill from scratch:
//   npm run oolong:ingest         (v1 semantic + physical layers)
//   npm run oolong:flywheel-prep  (strip annotations; cache starts cold)
//   npx tsx scripts/start_all.ts  (server + workers)

const REPO_ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(REPO_ROOT, 'data');
const BASE_DATASET_PATH = path.join(DATA_DIR, 'oolong_pairs_dataset.json');
const V2_DATASET_PATH = path.join(DATA_DIR, 'oolong_pairs_dataset_v2.json');
const MANIFEST_PATH = path.join(DATA_DIR, 'update_drill_manifest.json');
const ACT1_PATH = path.join(DATA_DIR, 'update_drill_act1_baseline.json');
const ACT3_PATH = path.join(DATA_DIR, 'update_drill_reingest.json');
const RESULTS_PATH = path.join(REPO_ROOT, 'docs', 'benchmarks', 'artifacts', 'update_drill_results.json');
const LOGS_DIR = path.join(REPO_ROOT, 'benchmark_logs');

const WARM_REPEATS = 6;
const QUERY_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_DISPATCH_ATTEMPTS = 3;
const MUTATION_SEED = 1337;

interface SequenceResult {
  queries: QueryTelemetry[];
  mean_f1: number;
  total_subcalls: number;
  total_cost_usd: number;
}

function buildSequence(dataset: OolongDataset, phases: [string, string]): Array<{ city: string; phase: string }> {
  const cities = [...new Set(
    dataset.records.filter(r => r.category === 'LOC').flatMap(r => r.concepts)
  )].sort();
  return [
    ...cities.map(city => ({ city, phase: phases[0] })),
    ...cities.slice(0, WARM_REPEATS).map(city => ({ city, phase: phases[1] }))
  ];
}

async function runSequence(
  dataset: OolongDataset,
  phases: [string, string],
  logPrefix: string
): Promise<SequenceResult> {
  const categoryOf = new Map(dataset.records.map(r => [r.id, r.category as string]));
  const sequence = buildSequence(dataset, phases);
  fs.mkdirSync(LOGS_DIR, { recursive: true });

  const queries: QueryTelemetry[] = [];
  for (let i = 0; i < sequence.length; i++) {
    const { city, phase } = sequence[i];
    const truth = cityTruth(dataset, city);
    console.log(`--- Query ${i + 1}/${sequence.length} [${phase}] city="${city}" (truth: ${truth.size} pairs) ---`);
    const row = await executeScoredQuery({
      index: i + 1, city, phase, truth, categoryOf,
      logsDir: LOGS_DIR, logPrefix,
      timeoutMs: QUERY_TIMEOUT_MS, maxDispatchAttempts: MAX_DISPATCH_ATTEMPTS
    });
    queries.push(row);
    console.log(
      `    F1=${row.f1.toFixed(3)} | pairs ${row.predicted_pairs}/${row.truth_pairs} | ` +
      `subcalls=${row.subcall_count} | cost=$${row.cost_usd.toFixed(4)} | ${row.duration_s.toFixed(1)}s` +
      (row.error ? ` | ERROR: ${row.error}` : '')
    );
  }
  return {
    queries,
    mean_f1: queries.reduce((s, q) => s + q.f1, 0) / queries.length,
    total_subcalls: queries.reduce((s, q) => s + q.subcall_count, 0),
    total_cost_usd: queries.reduce((s, q) => s + q.cost_usd, 0)
  };
}

// Act 1 sanity gate: the drill's warm-up expects an ingested,
// flywheel-prepped graph (questions present, categories stripped).
async function assertDrillReadyGraph(dataset: OolongDataset): Promise<void> {
  const session = neo4jDriver.session();
  try {
    const res = await session.run(`MATCH (q:Question) RETURN count(q) AS n, count(q.category) AS withCat`);
    const n = res.records[0].get('n').toNumber();
    const withCat = res.records[0].get('withCat').toNumber();
    if (n !== dataset.records.length) {
      throw new Error(`Graph has ${n} :Question nodes, dataset has ${dataset.records.length}. Run: npm run oolong:ingest`);
    }
    if (withCat !== 0) {
      throw new Error(`${withCat} :Question nodes still carry ground-truth categories. Run: npm run oolong:flywheel-prep`);
    }
  } finally {
    await session.close();
  }
}

async function main(): Promise<void> {
  const actsArg = process.argv.indexOf('--acts');
  const acts = new Set(
    (actsArg !== -1 ? process.argv[actsArg + 1] : '1,2,3,4').split(',').map(s => parseInt(s.trim(), 10))
  );

  const baseDataset = OolongDatasetSchema.parse(JSON.parse(fs.readFileSync(BASE_DATASET_PATH, 'utf8')));
  console.log('======================================================');
  console.log(`OOLONG Update Drill — acts: ${[...acts].sort().join(', ')}`);
  console.log('======================================================\n');

  // This runner calls reingestDataset() directly, so the CLI's gate in
  // scripts/reingest_oolong_dataset.ts does not cover it.
  const markers = await assertDrillTarget(
    ['neo4j', 'postgres'],
    liveMarkerReaders(neo4jDriver, pgPool)
  );
  printTargetBanner(['neo4j', 'postgres'], markers);
  console.log('');

  // ---------------- Act 1: warm-up (LLM) ----------------
  let act1: SequenceResult | null = null;
  if (acts.has(1)) {
    console.log('=== Act 1: warm-up (baseline, v1 corpus) ===');
    await assertDrillReadyGraph(baseDataset);
    act1 = await runSequence(baseDataset, ['cold', 'warm'], 'drill_act1');
    fs.writeFileSync(ACT1_PATH, JSON.stringify(act1, null, 2) + '\n');
    console.log(`Act 1 complete: mean F1 ${act1.mean_f1.toFixed(3)}, total cost $${act1.total_cost_usd.toFixed(4)}\n`);
  } else if (fs.existsSync(ACT1_PATH)) {
    act1 = JSON.parse(fs.readFileSync(ACT1_PATH, 'utf8'));
  }

  // ---------------- Act 2: mutation (no LLM) ----------------
  let manifest: DrillManifest;
  let v2: OolongDataset;
  if (acts.has(2)) {
    console.log('=== Act 2: corpus mutation ===');
    const out = mutateDataset(baseDataset, MUTATION_SEED);
    v2 = out.dataset;
    manifest = out.manifest;
    OolongDatasetSchema.parse(v2);
    fs.writeFileSync(V2_DATASET_PATH, JSON.stringify(v2, null, 2) + '\n');
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Act 2 complete: ${manifest.mutations.length} mutations (${(manifest.mutations.length / baseDataset.records.length * 100).toFixed(1)}% of corpus)\n`);
  } else {
    v2 = OolongDatasetSchema.parse(JSON.parse(fs.readFileSync(V2_DATASET_PATH, 'utf8')));
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  }

  // ---------------- Act 3: re-ingest + sweep + audit (no LLM) ----------------
  let act3: (ReingestTelemetry & { invalidation_audit: InvalidationAudit | null }) | null = null;
  if (acts.has(3)) {
    console.log('=== Act 3: versioned re-ingest, Merkle diff, quarantine sweep ===');
    // Adopt v1 first if the registry has never seen the drill doc_key.
    const reg = await pgPool.query('SELECT count(*)::int AS n FROM documents WHERE doc_key = $1', [DRILL_DOC_KEY]);
    if (reg.rows[0].n === 0) {
      const adopt = await reingestDataset(baseDataset, { docKey: DRILL_DOC_KEY });
      console.log(`  Adopted v1 corpus into registry (root ${adopt.rootHash.slice(0, 12)}...).`);
    }
    const telemetry = await reingestDataset(v2, { docKey: DRILL_DOC_KEY });
    const audit = telemetry.diff ? await auditInvalidation(manifest) : null;
    act3 = { ...telemetry, invalidation_audit: audit };
    fs.writeFileSync(ACT3_PATH, JSON.stringify(act3, null, 2) + '\n');
    console.log(`  Diff: added ${telemetry.diff?.added ?? 0} | orphaned ${telemetry.diff?.orphaned ?? 0} | retained ${telemetry.diff?.retained ?? 0}`);
    console.log(`  Changed records: ${telemetry.changedRecords.length}/${telemetry.totalRecords}`);
    console.log(`  Sweep: contested ${telemetry.sweep.contestedNodes} node(s), ${telemetry.sweep.contestedRelationships} relationship(s)`);
    if (audit) {
      console.log(`  Invalidation recall ${audit.recall.toFixed(3)} | precision ${audit.precision.toFixed(3)}`);
    }
    console.log('Act 3 complete.\n');
  } else if (fs.existsSync(ACT3_PATH)) {
    act3 = JSON.parse(fs.readFileSync(ACT3_PATH, 'utf8'));
  }

  // ---------------- Act 4: post-update queries + metrics (LLM) ----------------
  if (acts.has(4)) {
    console.log('=== Act 4: post-update queries (v2 ground truth) ===');
    const act4 = await runSequence(v2, ['post', 'post_repeat'], 'drill_act4');

    // Amortization survival: queries for cities untouched by any
    // mutation must not need re-classification sub-calls.
    const mutatedCities = new Set(manifest.mutations.flatMap(m => [...m.before.concepts, ...m.after.concepts]));
    const unmutatedQueries = act4.queries.filter(q => !mutatedCities.has(q.city));
    const subcallsOnUnmutated = unmutatedQueries.reduce((s, q) => s + q.subcall_count, 0);

    const drillCost = act4.total_cost_usd; // Act 3 spends zero LLM tokens
    const rebuildBaseline = act1?.total_cost_usd ?? null;

    const results = {
      benchmark: 'OOLONG-Pairs Update Drill (Phase 4)',
      base_dataset: baseDataset.name,
      mutated_dataset: v2.name,
      model: 'gpt-5.4-2026-03-05',
      generated_at: new Date().toISOString(),
      acts: {
        act1_baseline: act1,
        act2_mutation: {
          seed: manifest.seed,
          mutations: manifest.mutations.length,
          mutation_rate: manifest.mutations.length / baseDataset.records.length,
          by_flavor: manifest.mutations.reduce<Record<string, number>>((acc, m) => {
            acc[m.flavor] = (acc[m.flavor] ?? 0) + 1;
            return acc;
          }, {})
        },
        act3_reingest: act3,
        act4_post_update: act4
      },
      metrics: {
        mutation_rate: manifest.mutations.length / baseDataset.records.length,
        reprocessing_ratio_records: act3?.reprocessing_ratio_records ?? null,
        reprocessing_ratio_leaves: act3?.reprocessing_ratio_leaves ?? null,
        invalidation_recall: act3?.invalidation_audit?.recall ?? null,
        invalidation_precision: act3?.invalidation_audit?.precision ?? null,
        post_update_mean_f1: act4.mean_f1,
        amortization_survival: {
          post_update_total_subcalls: act4.total_subcalls,
          unmutated_city_queries: unmutatedQueries.length,
          subcalls_on_unmutated_cities: subcallsOnUnmutated
        },
        cost: {
          drill_usd: drillCost,
          full_rebuild_baseline_usd: rebuildBaseline,
          // Baseline note: a full rebuild wipes derived state and re-pays
          // the cold 20-query run — Act 1's total is that cost, measured
          // on this hardware in this run rather than estimated.
          drill_vs_rebuild_ratio: rebuildBaseline ? drillCost / rebuildBaseline : null
        }
      }
    };
    fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2) + '\n');

    console.log('\n=== Update Drill metrics ===');
    console.log(`  Mutation rate:            ${(results.metrics.mutation_rate * 100).toFixed(1)}%`);
    console.log(`  Reprocessing ratio:       ${act3 ? (act3.reprocessing_ratio_records * 100).toFixed(1) : '?'}% of records (target: <= mutation rate + 2pp)`);
    console.log(`  Invalidation recall:      ${act3?.invalidation_audit ? act3.invalidation_audit.recall.toFixed(3) : 'n/a'} (target: 1.000)`);
    console.log(`  Invalidation precision:   ${act3?.invalidation_audit ? act3.invalidation_audit.precision.toFixed(3) : 'n/a'} (target: >= 0.950)`);
    console.log(`  Post-update mean F1:      ${act4.mean_f1.toFixed(3)} (target: 1.000)`);
    console.log(`  Subcalls, unmutated cities: ${subcallsOnUnmutated} across ${unmutatedQueries.length} queries (target: 0)`);
    console.log(`  Cost: drill $${drillCost.toFixed(4)} vs full-rebuild baseline ${rebuildBaseline !== null ? `$${rebuildBaseline.toFixed(4)}` : '(run Act 1 for the baseline)'}`);
    console.log(`\nResults written to ${RESULTS_PATH}`);
  }
}

main()
  .then(async () => {
    await pgPool.end();
    await neo4jDriver.close();
    process.exit(0);
  })
  .catch(async err => {
    const refusalCode = reportRefusal(err);
    if (refusalCode === null) {
      console.error(`UPDATE DRILL FAILED: ${err.message}`);
    }
    await pgPool.end().catch(() => {});
    await neo4jDriver.close().catch(() => {});
    process.exit(refusalCode ?? 1);
  });
