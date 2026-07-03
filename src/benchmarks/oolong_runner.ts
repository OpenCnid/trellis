import * as fs from 'fs';
import * as path from 'path';
import { OolongDatasetSchema } from './oolong/schema';
import { QueryTelemetry, cityTruth, executeScoredQuery } from './oolong/scoring';

// Task 2c: OOLONG-Pairs Metrics and Evaluation Runner.
//
// Runs the 20-query benchmark sequence against /api/rlm-stream:
//   Queries 1-14:  one per city (cold — the RLM must classify texts via
//                  llm_query sub-calls and cache them as DERIVED_INSIGHT).
//   Queries 15-20: repeats of the first 6 cities (warm — cached
//                  classifications should collapse sub-call count and cost).
// Scores every answer with the Set-based F1 metric against ground truth
// and writes benchmark_results.json at the repo root.
//
// Scoring, query construction, and the dispatch/retry loop live in
// ./oolong/scoring.ts, shared with the Phase 4 Update Drill runner.

const DATASET_PATH = path.join(__dirname, '..', '..', 'data', 'oolong_pairs_dataset.json');
const RESULTS_PATH = path.join(__dirname, '..', '..', 'benchmark_results.json');
const LOGS_DIR = path.join(__dirname, '..', '..', 'benchmark_logs');
const WARM_REPEATS = 6;
const QUERY_TIMEOUT_MS = 20 * 60 * 1000;
// A run that never touched either database is a protocol violation (the
// answer has no provenance) — re-dispatch it up to this many extra times.
const MAX_DISPATCH_ATTEMPTS = 3;

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

    const row = await executeScoredQuery({
      index: i + 1,
      city,
      phase,
      truth,
      categoryOf,
      logsDir: LOGS_DIR,
      logPrefix: 'query',
      timeoutMs: QUERY_TIMEOUT_MS,
      maxDispatchAttempts: MAX_DISPATCH_ATTEMPTS
    });

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
