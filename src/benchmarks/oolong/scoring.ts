import * as fs from 'fs';
import * as path from 'path';
import { OolongDataset } from './schema';
import { runRlmQuery, Telemetry } from './rlm_client';

// Shared OOLONG-Pairs scoring + query-dispatch machinery, used by both
// the canonical 20-query benchmark (oolong_runner.ts) and the Phase 4
// Update Drill (update_drill_runner.ts). Extracted verbatim from the
// original runner so both score answers identically.

// Estimated gpt-5.4 (full-size) pricing (USD per 1M tokens) — used when
// the backend does not report exact cost. Adjust here if pricing changes.
export const PRICE_PER_M_INPUT = 2.5;
export const PRICE_PER_M_OUTPUT = 10;

export interface QueryTelemetry {
  index: number;
  city: string;
  phase: string;
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

export const pairKey = (a: string, b: string) => `${a}|${b}`;

export function buildQuery(city: string): string {
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
export function cityTruth(dataset: OolongDataset, city: string): Set<string> {
  const locs = dataset.records.filter(r => r.category === 'LOC' && r.concepts.includes(city));
  const hums = dataset.records.filter(r => r.category === 'HUM' && r.concepts.includes(city));
  const truth = new Set<string>();
  for (const l of locs) for (const h of hums) truth.add(pairKey(l.id, h.id));
  return truth;
}

// Extracts (q_x, q_y) tuples from FINAL_ANSWER and canonicalizes each to
// (LOC id, HUM id) using the dataset's category index, so tuple ordering
// mistakes by the agent don't mask a semantically correct pair.
export function parsePredictedPairs(finalAnswer: string, categoryOf: Map<string, string>): Set<string> {
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

export function scoreF1(predicted: Set<string>, truth: Set<string>): { precision: number; recall: number; f1: number } {
  const tp = [...predicted].filter(k => truth.has(k)).length;
  const precision = predicted.size === 0 ? (truth.size === 0 ? 1 : 0) : tp / predicted.size;
  const recall = truth.size === 0 ? 1 : tp / truth.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

export function estimateCost(telemetry: Telemetry | null): number {
  if (!telemetry) return 0;
  if (telemetry.reported_cost_usd !== null) return telemetry.reported_cost_usd;
  return (
    (telemetry.input_tokens / 1_000_000) * PRICE_PER_M_INPUT +
    (telemetry.output_tokens / 1_000_000) * PRICE_PER_M_OUTPUT
  );
}

export interface ScoredQueryOptions {
  index: number; // 1-based position in the sequence
  city: string;
  phase: string;
  truth: Set<string>;
  categoryOf: Map<string, string>;
  logsDir: string;
  logPrefix: string;
  timeoutMs: number;
  maxDispatchAttempts: number;
}

// Dispatches one OOLONG-Pairs query to the live RLM endpoint, with the
// protocol-violation retry loop (an answer produced with zero database
// tool calls has no provenance and is re-dispatched), and scores the
// FINAL_ANSWER with the set-based F1 metric.
export async function executeScoredQuery(opts: ScoredQueryOptions): Promise<QueryTelemetry> {
  const { index, city, phase, truth, categoryOf } = opts;
  let row: QueryTelemetry | null = null;
  let attempts = 0;
  let costAccumulator = 0;

  while (attempts < opts.maxDispatchAttempts && row === null) {
    attempts++;
    try {
      const run = await runRlmQuery(buildQuery(city), { timeoutMs: opts.timeoutMs });
      const suffix = attempts > 1 ? `_attempt${attempts}` : '';
      fs.writeFileSync(
        path.join(opts.logsDir, `${opts.logPrefix}_${String(index).padStart(2, '0')}_${phase}_${city}${suffix}.log`),
        run.stdout + (run.stderr ? `\n===== STDERR =====\n${run.stderr}` : '')
      );
      const t = run.telemetry;
      costAccumulator += estimateCost(t);

      // t === null covers a dispatch failure that never produced parseable
      // telemetry at all (e.g. the RLM subprocess crashed before printing
      // anything) — that is not a real "no answer", it is a transient
      // infrastructure failure and deserves the same retry as a protocol
      // violation, not a silent F1=0.
      const violated =
        run.stdout.includes('TRELLIS_PROTOCOL_VIOLATION') || t === null || t.tool_calls === 0;
      if (violated && attempts < opts.maxDispatchAttempts) {
        const reason = t === null ? 'no telemetry (subprocess likely crashed)' : 'zero tool calls — answer has no provenance';
        console.log(`    [RETRY] attempt ${attempts}: ${reason}, re-dispatching...`);
        continue;
      }

      const predicted = run.finalAnswer
        ? parsePredictedPairs(run.finalAnswer, categoryOf)
        : new Set<string>();
      const { precision, recall, f1 } = scoreF1(predicted, truth);
      row = {
        index,
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
      if (attempts < opts.maxDispatchAttempts) {
        console.log(`    [RETRY] attempt ${attempts} failed: ${err.message} — re-dispatching...`);
        continue;
      }
      row = {
        index, city, phase,
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
  // Unreachable: the loop always assigns row on its final attempt.
  return row!;
}
