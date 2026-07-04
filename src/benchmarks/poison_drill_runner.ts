import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import util from 'util';
import { OolongDataset, OolongDatasetSchema } from './oolong/schema';
import { QueryTelemetry, cityTruth, executeScoredQuery, pairKey, scoreF1 } from './oolong/scoring';
import {
  PoisonManifest,
  seedVerifiedCache,
  poisonCache,
  auditPoisonDetection,
  effectiveCategories
} from './oolong/poison';
import {
  defaultPolicy,
  runVerificationSweep,
  makeOracleClassifier,
  makeOpenAIClassifier,
  mulberry32,
  Classifier,
  VerificationReport
} from '../core/graph/verification';
import { PRICE_PER_M_INPUT, PRICE_PER_M_OUTPUT } from './oolong/scoring';
import { pgPool, neo4jDriver } from '../config/db';

// Phase 5 Milestone 4: the Poisoning Drill (PHASE_5_PRD.md §Milestone 4).
//
// The quiet-failure benchmark from the critique doc §3.3, mirroring the
// Update Drill's four-act structure:
//
//   Act 1  Warm-up: a fully-warm cache. Dress rehearsal (--rehearsal):
//          seeded LLM-free from ground truth through the same graph
//          shapes a real Act-1 run produces. Real mode: the standard
//          20-query warm-up sequence (server + workers + API key).
//   Act 2  Poison: flip ~11 cached has_category labels in place via
//          direct Cypher — valid Merkle provenance, HIGH stored
//          confidence, unchanged bytes. Undetectable by Phase 4 by
//          construction. Manifest records every poisoned edge.
//   Act 3  Detect: verifier sweeps under each policy (mandatory-only /
//          p=5% / p=10%) until every poison is quarantined or the sweep
//          budget runs out. Dress rehearsal swaps the sub-LLM for a
//          ground-truth oracle so detection MECHANICS run LLM-free.
//          Detection recall must be measured HERE.
//   Act 4  Recover: contested poisons re-derive (rehearsal: one bulk
//          write through the REAL Python tools with oracle labels —
//          the deterministic analog of the agent's one batched
//          sub-call; real mode: the 20-query sequence itself) and the
//          20-query OOLONG-Pairs sequence must score F1 = 1.000.
//
// Acts 1–3 re-run per policy so each detection experiment starts from
// an identically poisoned cache (same manifest seed).
//
// Poisoned-edge lifetime model: sweeps run after each full 20-query
// sequence pass, and every query reads the whole non-contested category
// cache once — so a poison detected on sweep k served k * 20 cache
// reads. Reported per policy as lifetime_sweeps and lifetime_reads.

const execFileAsync = util.promisify(execFile);

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DATASET_PATH = path.join(DATA_DIR, 'oolong_pairs_dataset_v2.json');
const MANIFEST_PATH = path.join(DATA_DIR, 'poison_drill_manifest.json');
const RESULTS_PATH = path.join(__dirname, '..', '..', 'poison_drill_results.json');
const LOGS_DIR = path.join(__dirname, '..', '..', 'benchmark_logs');

const WARM_REPEATS = 6;
const QUERIES_PER_INTERVAL = 20; // one standard OOLONG-Pairs sequence
const QUERY_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_DISPATCH_ATTEMPTS = 3;
const POISON_SEED = 4242;
const POISON_COUNT = 11;
const SEED_CONFIDENCE = 0.9;
const POISON_CONFIDENCE = 0.97;
const RECOVERY_CONFIDENCE = 0.95;

interface PolicySpec {
  name: string;
  sampleRate: number;
  maxSweeps: number;
}

const POLICIES: PolicySpec[] = [
  { name: 'mandatory-only', sampleRate: 0, maxSweeps: 5 },
  { name: 'p=0.05', sampleRate: 0.05, maxSweeps: 400 },
  { name: 'p=0.10', sampleRate: 0.1, maxSweeps: 200 }
];

interface SweepRow {
  sweep: number;
  selected: number;
  classified: number;
  newly_detected: number;
  cumulative_detected: number;
  recall: number;
  subcalls: number;
}

interface PolicyResult {
  policy: string;
  sample_rate: number;
  max_sweeps: number;
  sweeps_run: number;
  detection_recall: number;
  expected_sweep_bound: number | null; // ~H(n)/p, the 1/p-family bound
  sweeps_to_full_detection: number | null;
  lifetime_sweeps: Record<string, number | null>;
  mean_lifetime_sweeps: number | null;
  max_lifetime_sweeps: number | null;
  mean_lifetime_reads: number | null;
  max_lifetime_reads: number | null;
  false_disputes: number;
  false_dispute_rate: number;
  total_classified: number;
  total_subcalls: number;
  verification_cost_usd: number;
  cost_per_100_beliefs_per_sweep_usd: number | null;
  sweep_trajectory: SweepRow[];
  recovery: RecoveryResult | null;
}

interface RecoveryResult {
  disputed_rederived: number;
  recovery_bulk_calls: number;
  questions_missing_effective_category: number;
  effective_mismatches_vs_truth: number;
  mean_f1: number;
  queries: Array<{ index: number; city: string; phase: string; f1: number; predicted_pairs: number; truth_pairs: number }>;
  real_query_telemetry?: QueryTelemetry[];
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

// Harmonic-number/p bound: expected sweeps until ALL n poisons have been
// sampled at least once, each selected independently w.p. p per sweep.
function expectedSweepBound(n: number, p: number): number | null {
  if (p <= 0) return null;
  let h = 0;
  for (let i = 1; i <= n; i++) h += 1 / i;
  return Math.ceil(h / p);
}

// Act 4 (rehearsal): re-derive disputed beliefs through the REAL Python
// bulk writer — the same code path the agent uses — with oracle labels.
async function rederiveDisputedViaPython(dataset: OolongDataset): Promise<{ rederived: number; bulkCalls: number }> {
  const session = neo4jDriver.session();
  let disputed: Array<{ id: string; sourceNodeIds: string[] }>;
  try {
    const res = await session.executeRead(tx =>
      tx.run(
        `MATCH (s:Entity)-[r:DERIVED_INSIGHT {verb: 'has_category'}]->()
         WHERE s.name IN $ids AND coalesce(r.contested, false) = true AND r.contestedReason = 'disputed'
         MATCH (q:Question {id: s.name})
         RETURN DISTINCT s.name AS id, q.sourceNodeIds AS sourceNodeIds`,
        { ids: dataset.records.map(r => r.id) }
      )
    );
    disputed = res.records.map(rec => ({ id: rec.get('id'), sourceNodeIds: rec.get('sourceNodeIds') }));
  } finally {
    await session.close();
  }
  if (disputed.length === 0) return { rederived: 0, bulkCalls: 0 };

  const truthById = new Map(dataset.records.map(r => [r.id, r.category.toLowerCase()]));
  const facts = disputed.map(d => ({
    subject: d.id,
    verb: 'HAS_CATEGORY',
    obj: truthById.get(d.id)!,
    sourceNodeIds: d.sourceNodeIds,
    confidence: RECOVERY_CONFIDENCE
  }));
  const py = [
    'import sys, json',
    "sys.path.insert(0, '.')",
    'from trellis_tools import TrellisNeo4j',
    't = TrellisNeo4j()',
    'print(t.write_derived_insights(json.loads(sys.argv[1])))',
    't.close()'
  ].join('\n');
  await execFileAsync('python', ['-c', py, JSON.stringify(facts)], {
    cwd: path.resolve('src/rlm'),
    env: {
      ...process.env,
      PYTHONPATH: 'C:\\Users\\Darian\\AppData\\Roaming\\Python\\Python313\\site-packages',
      PYTHONIOENCODING: 'utf-8'
    }
  });
  return { rederived: disputed.length, bulkCalls: 1 };
}

// Deterministic scoring of the standard sequence from the graph's
// EFFECTIVE (non-contested) categories — the LLM-free analog of Act 4:
// mention scan and pair join are deterministic in the real protocol too;
// the only LLM-derived input is the category, which we read from cache.
async function scoreSequenceFromCache(dataset: OolongDataset): Promise<RecoveryResult> {
  const effective = await effectiveCategories(neo4jDriver, dataset);
  const truthById = new Map(dataset.records.map(r => [r.id, r.category]));
  const missing = dataset.records.filter(r => !effective.has(r.id)).length;
  const mismatches = dataset.records.filter(r => effective.get(r.id) !== undefined && effective.get(r.id) !== truthById.get(r.id)).length;

  const sequence = buildSequence(dataset, ['post', 'post_repeat']);
  const queries: RecoveryResult['queries'] = [];
  for (let i = 0; i < sequence.length; i++) {
    const { city, phase } = sequence[i];
    const truth = cityTruth(dataset, city);
    const locs = dataset.records.filter(r => effective.get(r.id) === 'LOC' && r.concepts.includes(city));
    const hums = dataset.records.filter(r => effective.get(r.id) === 'HUM' && r.concepts.includes(city));
    const predicted = new Set<string>();
    for (const l of locs) for (const h of hums) predicted.add(pairKey(l.id, h.id));
    const { f1 } = scoreF1(predicted, truth);
    queries.push({ index: i + 1, city, phase, f1, predicted_pairs: predicted.size, truth_pairs: truth.size });
  }
  return {
    disputed_rederived: 0, // filled by caller
    recovery_bulk_calls: 0,
    questions_missing_effective_category: missing,
    effective_mismatches_vs_truth: mismatches,
    mean_f1: queries.reduce((s, q) => s + q.f1, 0) / queries.length,
    queries
  };
}

async function runRealSequence(dataset: OolongDataset, logPrefix: string): Promise<QueryTelemetry[]> {
  const categoryOf = new Map(dataset.records.map(r => [r.id, r.category as string]));
  const sequence = buildSequence(dataset, ['post', 'post_repeat']);
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  const rows: QueryTelemetry[] = [];
  for (let i = 0; i < sequence.length; i++) {
    const { city, phase } = sequence[i];
    const truth = cityTruth(dataset, city);
    console.log(`--- Query ${i + 1}/${sequence.length} [${phase}] city="${city}" (truth: ${truth.size} pairs) ---`);
    const row = await executeScoredQuery({
      index: i + 1, city, phase, truth, categoryOf,
      logsDir: LOGS_DIR, logPrefix,
      timeoutMs: QUERY_TIMEOUT_MS, maxDispatchAttempts: MAX_DISPATCH_ATTEMPTS
    });
    rows.push(row);
    console.log(`    F1=${row.f1.toFixed(3)} | subcalls=${row.subcall_count} | cost=$${row.cost_usd.toFixed(4)}` + (row.error ? ` | ERROR: ${row.error}` : ''));
  }
  return rows;
}

async function runPolicyExperiment(
  dataset: OolongDataset,
  spec: PolicySpec,
  policyIndex: number,
  rehearsal: boolean,
  withRecovery: boolean
): Promise<{ result: PolicyResult; manifest: PoisonManifest }> {
  console.log(`\n=== Policy: ${spec.name} ===`);

  // Acts 1 + 2: identical starting state per policy (same seeds).
  const seeded = await seedVerifiedCache(neo4jDriver, dataset, { confidence: SEED_CONFIDENCE });
  console.log(`  Act 1 (seeded warm-up): wiped ${seeded.wiped}, seeded ${seeded.seeded} beliefs @ confidence ${SEED_CONFIDENCE}`);
  const manifest = await poisonCache(neo4jDriver, dataset, {
    count: POISON_COUNT, seed: POISON_SEED, confidence: POISON_CONFIDENCE
  });
  console.log(`  Act 2 (poison): flipped ${manifest.poisoned.length} labels in place @ confidence ${POISON_CONFIDENCE} (seed ${manifest.seed})`);

  // Act 3: detection sweeps.
  const oracle: Record<string, string> = {};
  for (const r of dataset.records) oracle[r.id] = r.category.toLowerCase();
  const classifier: Classifier = rehearsal ? makeOracleClassifier(oracle) : makeOpenAIClassifier();

  const policy = defaultPolicy({
    sampleRate: spec.sampleRate,
    graduatedRate: spec.sampleRate / 10,
    random: mulberry32(POISON_SEED + 1000 * (policyIndex + 1))
  });

  const detectedAt = new Map<string, number>();
  const trajectory: SweepRow[] = [];
  let totalClassified = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalSubcalls = 0;
  let sweepsRun = 0;

  for (let sweep = 1; sweep <= spec.maxSweeps; sweep++) {
    sweepsRun = sweep;
    const report: VerificationReport = await runVerificationSweep(neo4jDriver, pgPool, policy, classifier);
    totalClassified += report.classified;
    totalSubcalls += report.usage.subcalls;
    inputTokens += report.usage.inputTokens;
    outputTokens += report.usage.outputTokens;

    const audit = await auditPoisonDetection(neo4jDriver, dataset, manifest);
    let newly = 0;
    for (const id of audit.detected_ids) {
      if (!detectedAt.has(id)) { detectedAt.set(id, sweep); newly++; }
    }
    trajectory.push({
      sweep, selected: report.selected, classified: report.classified,
      newly_detected: newly, cumulative_detected: audit.detected, recall: audit.recall,
      subcalls: report.usage.subcalls
    });
    if (sweep <= 5 || newly > 0 || sweep % 25 === 0) {
      console.log(`  Act 3 sweep ${sweep}: selected ${report.selected}, classified ${report.classified}, detected ${audit.detected}/${audit.poisoned_total} (recall ${audit.recall.toFixed(3)})`);
    }
    if (audit.recall === 1) break;
  }

  const finalAudit = await auditPoisonDetection(neo4jDriver, dataset, manifest);
  const lifetimes: Record<string, number | null> = {};
  for (const p of manifest.poisoned) lifetimes[p.id] = detectedAt.get(p.id) ?? null;
  const detectedLifetimes = [...detectedAt.values()];
  const sweepsToFull = finalAudit.recall === 1 ? Math.max(...detectedLifetimes) : null;
  const verificationCost = (inputTokens / 1_000_000) * PRICE_PER_M_INPUT + (outputTokens / 1_000_000) * PRICE_PER_M_OUTPUT;

  const result: PolicyResult = {
    policy: spec.name,
    sample_rate: spec.sampleRate,
    max_sweeps: spec.maxSweeps,
    sweeps_run: sweepsRun,
    detection_recall: finalAudit.recall,
    expected_sweep_bound: expectedSweepBound(manifest.poisoned.length, spec.sampleRate),
    sweeps_to_full_detection: sweepsToFull,
    lifetime_sweeps: lifetimes,
    mean_lifetime_sweeps: detectedLifetimes.length ? detectedLifetimes.reduce((a, b) => a + b, 0) / detectedLifetimes.length : null,
    max_lifetime_sweeps: detectedLifetimes.length ? Math.max(...detectedLifetimes) : null,
    mean_lifetime_reads: detectedLifetimes.length ? (detectedLifetimes.reduce((a, b) => a + b, 0) / detectedLifetimes.length) * QUERIES_PER_INTERVAL : null,
    max_lifetime_reads: detectedLifetimes.length ? Math.max(...detectedLifetimes) * QUERIES_PER_INTERVAL : null,
    false_disputes: finalAudit.false_disputes,
    false_dispute_rate: finalAudit.false_disputes / finalAudit.clean_beliefs,
    total_classified: totalClassified,
    total_subcalls: totalSubcalls,
    verification_cost_usd: verificationCost,
    cost_per_100_beliefs_per_sweep_usd: sweepsRun > 0 ? (verificationCost / sweepsRun) * (100 / dataset.records.length) : null,
    sweep_trajectory: trajectory,
    recovery: null
  };
  console.log(
    `  Act 3 done: recall ${result.detection_recall.toFixed(3)} after ${sweepsRun} sweep(s)` +
    (result.expected_sweep_bound ? ` (expected bound ~${result.expected_sweep_bound})` : '') +
    `, false disputes ${result.false_disputes}, classified ${totalClassified}`
  );

  // Act 4: recovery + the standard sequence.
  if (withRecovery) {
    if (rehearsal) {
      const red = await rederiveDisputedViaPython(dataset);
      const scored = await scoreSequenceFromCache(dataset);
      scored.disputed_rederived = red.rederived;
      scored.recovery_bulk_calls = red.bulkCalls;
      result.recovery = scored;
      console.log(
        `  Act 4 (rehearsal): re-derived ${red.rederived} disputed belief(s) in ${red.bulkCalls} bulk call(s); ` +
        `mean F1 ${scored.mean_f1.toFixed(3)} over ${scored.queries.length} queries ` +
        `(missing categories: ${scored.questions_missing_effective_category}, mismatches: ${scored.effective_mismatches_vs_truth})`
      );
    } else {
      // Real mode: the agent itself re-derives contested beliefs during
      // the sequence (lazy recovery — the Phase 4 proven path).
      const rows = await runRealSequence(dataset, `poison_act4_${spec.name.replace(/[^a-z0-9]/gi, '_')}`);
      const scored = await scoreSequenceFromCache(dataset);
      scored.disputed_rederived = -1; // re-derived by the agent, count in telemetry
      scored.mean_f1 = rows.reduce((s, q) => s + q.f1, 0) / rows.length;
      scored.real_query_telemetry = rows;
      result.recovery = scored;
      console.log(`  Act 4 (real): mean F1 ${scored.mean_f1.toFixed(3)}`);
    }
  }
  return { result, manifest };
}

async function main(): Promise<void> {
  const rehearsal = process.argv.includes('--rehearsal');
  const policiesArg = process.argv.indexOf('--policies');
  const requested = policiesArg !== -1
    ? new Set(process.argv[policiesArg + 1].split(',').map(s => s.trim()))
    : null;
  const policies = requested ? POLICIES.filter(p => requested.has(p.name)) : POLICIES;
  if (policies.length === 0) throw new Error(`No matching policies. Available: ${POLICIES.map(p => p.name).join(', ')}`);

  const dataset = OolongDatasetSchema.parse(JSON.parse(fs.readFileSync(DATASET_PATH, 'utf8')));
  console.log('======================================================');
  console.log(`OOLONG Poisoning Drill — ${rehearsal ? 'DRESS REHEARSAL (LLM-free oracle)' : 'REAL RUN (paid sub-LLM)'}`);
  console.log(`Corpus: ${dataset.name} (${dataset.records.length} questions) | policies: ${policies.map(p => p.name).join(', ')}`);
  console.log('======================================================');

  const results: PolicyResult[] = [];
  let manifest: PoisonManifest | null = null;
  for (let i = 0; i < policies.length; i++) {
    const spec = policies[i];
    // Recovery is meaningful where detection succeeded; run it for the
    // sampled policies and (honestly) for mandatory-only to show the
    // failure it leaves behind.
    const { result, manifest: m } = await runPolicyExperiment(dataset, spec, i, rehearsal, true);
    manifest = m;
    results.push(result);
  }
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');

  const sampled = results.filter(r => r.sample_rate > 0);
  const output = {
    benchmark: 'OOLONG-Pairs Poisoning Drill (Phase 5)',
    mode: rehearsal ? 'dress_rehearsal_oracle' : 'real_sub_llm',
    dataset: dataset.name,
    model: rehearsal ? 'ground-truth oracle (LLM-free)' : 'gpt-5.4-2026-03-05',
    generated_at: new Date().toISOString(),
    poison: {
      count: POISON_COUNT,
      seed: POISON_SEED,
      stored_confidence: POISON_CONFIDENCE,
      seeded_cache_confidence: SEED_CONFIDENCE,
      note: 'labels flipped in place over UNCHANGED bytes with valid Merkle provenance — invisible to Phase 4 by construction'
    },
    lifetime_model: `sweeps run after each ${QUERIES_PER_INTERVAL}-query sequence pass; every query reads the whole non-contested cache once, so lifetime_reads = lifetime_sweeps * ${QUERIES_PER_INTERVAL}`,
    policies: results,
    summary: {
      detection_recall_by_policy: Object.fromEntries(results.map(r => [r.policy, r.detection_recall])),
      recall_within_expected_bound: sampled.every(r =>
        r.detection_recall === 1 && r.sweeps_to_full_detection !== null &&
        r.expected_sweep_bound !== null && r.sweeps_to_full_detection <= 2 * r.expected_sweep_bound
      ),
      max_false_dispute_rate: Math.max(...results.map(r => r.false_dispute_rate)),
      post_recovery_f1_by_policy: Object.fromEntries(results.map(r => [r.policy, r.recovery?.mean_f1 ?? null])),
      total_verification_cost_usd: results.reduce((s, r) => s + r.verification_cost_usd, 0)
    }
  };
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(output, null, 2) + '\n');

  console.log('\n=== Poisoning Drill metrics ===');
  for (const r of results) {
    console.log(
      `  [${r.policy}] recall ${r.detection_recall.toFixed(3)}` +
      (r.sweeps_to_full_detection !== null ? ` in ${r.sweeps_to_full_detection} sweeps (bound ~${r.expected_sweep_bound})` : ` after ${r.sweeps_run} sweeps (never fully detected)`) +
      ` | mean lifetime ${r.mean_lifetime_reads !== null ? `${r.mean_lifetime_reads.toFixed(0)} reads` : 'n/a'}` +
      ` | false-dispute rate ${(r.false_dispute_rate * 100).toFixed(1)}%` +
      ` | post-recovery F1 ${r.recovery ? r.recovery.mean_f1.toFixed(3) : 'n/a'}` +
      ` | verification $${r.verification_cost_usd.toFixed(4)}`
    );
  }
  console.log(`\nResults written to ${RESULTS_PATH}`);
  console.log(`Manifest written to ${MANIFEST_PATH}`);
}

main()
  .then(async () => {
    await pgPool.end();
    await neo4jDriver.close();
    process.exit(0);
  })
  .catch(async err => {
    console.error(`POISONING DRILL FAILED: ${err.stack ?? err.message}`);
    await pgPool.end().catch(() => {});
    await neo4jDriver.close().catch(() => {});
    process.exit(1);
  });
