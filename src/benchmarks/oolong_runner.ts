import * as fs from 'fs';
import * as path from 'path';
import { OolongDatasetSchema, OolongDataset } from './oolong/schema';
import { runRlmQuery, Telemetry } from './oolong/rlm_client';

// Task 2c: OOLONG-Pairs Metrics and Evaluation Runner.
//
// Runs the 20-query benchmark sequence against /api/rlm-stream:
//   Queries 1-14:  one per city (cold — the RLM must classify texts via
//                  llm_query sub-calls and cache them as DERIVED_INSIGHT).
//   Queries 15-20: repeats of the first 6 cities (warm — cached
//                  classifications should collapse sub-call count and cost).
// Scores every answer with the Set-based F1 metric against ground truth
// and writes benchmark_results.json at the repo root.

const DATASET_PATH = path.join(__dirname, '..', '..', 'data', 'oolong_pairs_dataset.json');
const RESULTS_PATH = path.join(__dirname, '..', '..', 'benchmark_results.json');
const LOGS_DIR = path.join(__dirname, '..', '..', 'benchmark_logs');
const WARM_REPEATS = 6;
const QUERY_TIMEOUT_MS = 20 * 60 * 1000;
// A run that never touched either database is a protocol violation (the
// answer has no provenance) — re-dispatch it up to this many extra times.
const MAX_DISPATCH_ATTEMPTS = 3;

// Estimated gpt-5.4 (full-size) pricing (USD per 1M tokens) — used when
// the backend does not report exact cost. Adjust here if pricing changes.
const PRICE_PER_M_INPUT = 2.5;
const PRICE_PER_M_OUTPUT = 10;

interface QueryTelemetry {
  index: number;
  city: string;
  phase: 'cold' | 'warm';
  precision: number;
  recall: number;
  f1: number;
  predicted_pairs: number;
  truth_pairs: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  subcall_count: number;
  tool_calls: number;
  iterations: number;
  cost_usd: number;
  duration_s: number;
  dispatch_attempts: number;
  error: string | null;
}

const pairKey = (a: string, b: string) => `${a}|${b}`;

function buildQuery(city: string): string {
  return (
    `OOLONG-Pairs task: find EVERY pair of questions (a, b) in the corpus where ` +
    `a has TREC category LOC, b has TREC category HUM, and BOTH questions mention the city "${city}". ` +
    `Follow the Spatial Flywheel Protocol: reuse cached classifications from the graph when they exist; ` +
    `classify and cache (write_derived_insight) only what is missing. ` +
    `Question ids look like q_0001. ` +
    `Output exactly: FINAL_ANSWER: [(loc_question_id, hum_question_id), ...] — a Python list of tuples, or [] if there are none.`
  );
}

// Ground truth for one city: LOC x HUM pairs that both annotate the city.
function cityTruth(dataset: OolongDataset, city: string): Set<string> {
  const locs = dataset.records.filter(r => r.category === 'LOC' && r.concepts.includes(city));
  const hums = dataset.records.filter(r => r.category === 'HUM' && r.concepts.includes(city));
  const truth = new Set<string>();
  for (const l of locs) for (const h of hums) truth.add(pairKey(l.id, h.id));
  return truth;
}

// Extracts (q_x, q_y) tuples from FINAL_ANSWER and canonicalizes each to
// (LOC id, HUM id) using the dataset's category index, so tuple ordering
// mistakes by the agent don't mask a semantically correct pair.
function parsePredictedPairs(finalAnswer: string, categoryOf: Map<string, string>): Set<string> {
  const predicted = new Set<string>();
  const tupleRe = /\(\s*['"]?(q_\d+)['"]?\s*,\s*['"]?(q_\d+)['"]?\s*\)/g;
  for (const match of finalAnswer.matchAll(tupleRe)) {
    const [, x, y] = match;
    if (categoryOf.get(x) === 'LOC' && categoryOf.get(y) === 'HUM') predicted.add(pairKey(x, y));
    else if (categoryOf.get(y) === 'LOC' && categoryOf.get(x) === 'HUM') predicted.add(pairKey(y, x));
    else predicted.add(pairKey(x, y)); // wrong categories — kept, will score as spurious
  }
  return predicted;
}

function scoreF1(predicted: Set<string>, truth: Set<string>): { precision: number; recall: number; f1: number } {
  const tp = [...predicted].filter(k => truth.has(k)).length;
  const precision = predicted.size === 0 ? (truth.size === 0 ? 1 : 0) : tp / predicted.size;
  const recall = truth.size === 0 ? 1 : tp / truth.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

function estimateCost(telemetry: Telemetry | null): number {
  if (!telemetry) return 0;
  if (telemetry.reported_cost_usd !== null) return telemetry.reported_cost_usd;
  return (
    (telemetry.input_tokens / 1_000_000) * PRICE_PER_M_INPUT +
    (telemetry.output_tokens / 1_000_000) * PRICE_PER_M_OUTPUT
  );
}

function fmtRow(cells: string[], widths: number[]): string {
  return cells.map((c, i) => c.padStart(widths[i])).join('  ');
}

async function main(): Promise<void> {
  console.log('======================================================');
  console.log('Task 2c: OOLONG-Pairs Benchmark Runner (20 queries)');
  console.log('======================================================');

  const dataset = OolongDatasetSchema.parse(JSON.parse(fs.readFileSync(DATASET_PATH, 'utf8')));
  const categoryOf = new Map(dataset.records.map(r => [r.id, r.category as string]));
  fs.mkdirSync(LOGS_DIR, { recursive: true });

  const cities = [...new Set(
    dataset.records.filter(r => r.category === 'LOC').flatMap(r => r.concepts)
  )].sort();
  const sequence: Array<{ city: string; phase: 'cold' | 'warm' }> = [
    ...cities.map(city => ({ city, phase: 'cold' as const })),
    ...cities.slice(0, WARM_REPEATS).map(city => ({ city, phase: 'warm' as const }))
  ];
  console.log(`Cities: ${cities.length} | Sequence: ${sequence.length} queries (${cities.length} cold + ${WARM_REPEATS} warm repeats)\n`);

  const results: QueryTelemetry[] = [];

  for (let i = 0; i < sequence.length; i++) {
    const { city, phase } = sequence[i];
    const truth = cityTruth(dataset, city);
    console.log(`--- Query ${i + 1}/${sequence.length} [${phase.toUpperCase()}] city="${city}" (truth: ${truth.size} pairs) ---`);

    let row: QueryTelemetry | null = null;
    let attempts = 0;
    let costAccumulator = 0;

    while (attempts < MAX_DISPATCH_ATTEMPTS && row === null) {
      attempts++;
      try {
        const run = await runRlmQuery(buildQuery(city), { timeoutMs: QUERY_TIMEOUT_MS });
        const suffix = attempts > 1 ? `_attempt${attempts}` : '';
        fs.writeFileSync(
          path.join(LOGS_DIR, `query_${String(i + 1).padStart(2, '0')}_${phase}_${city}${suffix}.log`),
          run.stdout + (run.stderr ? `\n===== STDERR =====\n${run.stderr}` : '')
        );
        const t = run.telemetry;
        costAccumulator += estimateCost(t);

        const violated =
          run.stdout.includes('TRELLIS_PROTOCOL_VIOLATION') || (t !== null && t.tool_calls === 0);
        if (violated && attempts < MAX_DISPATCH_ATTEMPTS) {
          console.log(`    [RETRY] attempt ${attempts}: zero tool calls — answer has no provenance, re-dispatching...`);
          continue;
        }

        const predicted = run.finalAnswer
          ? parsePredictedPairs(run.finalAnswer, categoryOf)
          : new Set<string>();
        const { precision, recall, f1 } = scoreF1(predicted, truth);
        row = {
          index: i + 1,
          city,
          phase,
          precision,
          recall,
          f1,
          predicted_pairs: predicted.size,
          truth_pairs: truth.size,
          input_tokens: t?.input_tokens ?? 0,
          output_tokens: t?.output_tokens ?? 0,
          total_tokens: (t?.input_tokens ?? 0) + (t?.output_tokens ?? 0),
          subcall_count: t?.subcall_count ?? 0,
          tool_calls: t?.tool_calls ?? 0,
          iterations: run.iterations ?? 0,
          cost_usd: costAccumulator,
          duration_s: run.durationMs / 1000,
          dispatch_attempts: attempts,
          error: run.finalAnswer === null
            ? 'No FINAL_ANSWER in RLM output'
            : violated ? 'Protocol violation persisted through all dispatch attempts' : null
        };
      } catch (err: any) {
        if (attempts < MAX_DISPATCH_ATTEMPTS) {
          console.log(`    [RETRY] attempt ${attempts} failed: ${err.message} — re-dispatching...`);
          continue;
        }
        row = {
          index: i + 1, city, phase,
          precision: 0, recall: 0, f1: 0,
          predicted_pairs: 0, truth_pairs: truth.size,
          input_tokens: 0, output_tokens: 0, total_tokens: 0,
          subcall_count: 0, tool_calls: 0, iterations: 0,
          cost_usd: costAccumulator, duration_s: 0,
          dispatch_attempts: attempts,
          error: err.message
        };
      }
    }
    if (row === null) continue; // unreachable, satisfies the type checker

    results.push(row);
    console.log(
      `    F1=${row.f1.toFixed(3)} | pairs ${row.predicted_pairs}/${row.truth_pairs} | ` +
      `tokens=${row.total_tokens} | subcalls=${row.subcall_count} | toolcalls=${row.tool_calls} | ` +
      `cost=$${row.cost_usd.toFixed(4)} | ${row.duration_s.toFixed(1)}s | attempts=${row.dispatch_attempts}` +
      (row.error ? ` | ERROR: ${row.error}` : '')
    );
  }

  // Phase aggregates — the Flywheel Hypothesis check
  const agg = (phase: 'cold' | 'warm', pick: (r: QueryTelemetry) => number) => {
    const rows = results.filter(r => r.phase === phase);
    return rows.reduce((s, r) => s + pick(r), 0) / rows.length;
  };
  const summary = {
    mean_f1_cold: agg('cold', r => r.f1),
    mean_f1_warm: agg('warm', r => r.f1),
    mean_subcalls_cold: agg('cold', r => r.subcall_count),
    mean_subcalls_warm: agg('warm', r => r.subcall_count),
    mean_cost_usd_cold: agg('cold', r => r.cost_usd),
    mean_cost_usd_warm: agg('warm', r => r.cost_usd),
    mean_tokens_cold: agg('cold', r => r.total_tokens),
    mean_tokens_warm: agg('warm', r => r.total_tokens),
    total_cost_usd: results.reduce((s, r) => s + r.cost_usd, 0)
  };

  const report = {
    benchmark: 'OOLONG-Pairs (Spatial Flywheel)',
    dataset: dataset.name,
    model: 'gpt-5.4-2026-03-05',
    generated_at: new Date().toISOString(),
    queries: results,
    summary
  };
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(report, null, 2) + '\n');

  // Final table
  const header = ['#', 'City', 'Phase', 'F1', 'Tokens', 'Subcalls', 'Cost($)', 'Time(s)'];
  const widths = [3, 8, 5, 6, 8, 8, 8, 8];
  console.log('\n' + fmtRow(header, widths));
  console.log(widths.map(w => '-'.repeat(w)).join('  '));
  for (const r of results) {
    console.log(fmtRow([
      String(r.index), r.city, r.phase, r.f1.toFixed(3),
      String(r.total_tokens), String(r.subcall_count),
      r.cost_usd.toFixed(4), r.duration_s.toFixed(1)
    ], widths));
  }

  console.log('\nFlywheel Hypothesis check (cold = queries 1-14, warm = 15-20):');
  console.log(`  Mean F1:        cold ${summary.mean_f1_cold.toFixed(3)}  ->  warm ${summary.mean_f1_warm.toFixed(3)}`);
  console.log(`  Mean sub-calls: cold ${summary.mean_subcalls_cold.toFixed(1)}  ->  warm ${summary.mean_subcalls_warm.toFixed(1)}`);
  console.log(`  Mean cost:      cold $${summary.mean_cost_usd_cold.toFixed(4)}  ->  warm $${summary.mean_cost_usd_warm.toFixed(4)}`);
  console.log(`  Mean tokens:    cold ${Math.round(summary.mean_tokens_cold)}  ->  warm ${Math.round(summary.mean_tokens_warm)}`);
  console.log(`  Total run cost: $${summary.total_cost_usd.toFixed(4)}`);
  console.log(`\nReport written to ${RESULTS_PATH}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(`BENCHMARK RUNNER FAILED: ${err.message}`);
    process.exit(1);
  });
