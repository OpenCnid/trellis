/**
 * Support-computation oracle drill (zero-paid, zero-LLM, zero-infra).
 *
 * Specification: docs/product/epistemic-support/ORACLE_DRILL_PROPOSAL.md
 * Normative arithmetic: docs/architecture/EPISTEMIC_SUPPORT.md §3–§4.
 * Entrypoint: `npm run test:support-oracle` (the non-test caller,
 * AGENTS.md rule 15).
 *
 * Modes:
 *   default                      run sections; exit 0 iff all green
 *   --section <name>             run one section
 *   --results <path>             also write the bounded results JSON
 *   --negative-control           compare against the committed BROKEN
 *                                oracle; healthy behavior is detection:
 *                                exit 3 with the named mismatch. Exit 1
 *                                (absorbed) means the harness is broken.
 *   --inject corrupt-expected    corrupt one expected value in memory
 *                                post-load; PASS (exit 0) iff detected.
 *
 * Refusals (before any section): fixture manifest SHA mismatch (exit 2),
 * any TRELLIS_EXP_* variable set (exit 2).
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import {
  computeSupportOpinion,
  canonicalizeEvents,
  type SupportEvent,
  type SupportOpinion,
  type SupportParams,
} from '../src/core/graph/support';
import {
  evaluateMetric,
  validateMetric,
  MetricValidityError,
  type MetricExpr,
} from '../src/core/graph/support_metrics';

const FIXTURES = resolve(__dirname, '..', 'fixtures', 'support_oracle');
const TOL = 1e-9;

interface Finding { beliefId: string; field: string; expected: number; observed: number }
interface SectionResult { name: string; checks: number; status: 'ok' | 'failed'; findings: Finding[] }

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string): boolean => args.includes(name);

const onlySection = flag('--section');
const resultsPath = flag('--results');
const negativeControl = has('--negative-control');
const injectMode = flag('--inject');

// ---------- refusals before any section ----------
const expFlags = Object.keys(process.env).filter((k) => k.startsWith('TRELLIS_EXP_'));
if (expFlags.length > 0) {
  console.error(`REFUSED: experiment flags set in environment: ${expFlags.join(', ')}`);
  process.exit(2);
}

const readJson = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
const sha256 = (name: string) =>
  createHash('sha256').update(readFileSync(join(FIXTURES, name))).digest('hex');

// ---------- fixture integrity: a pre-flight refusal, not a section ----------
// Runs before any fixture is parsed and before any section, in every mode
// (--section included): tampered or eol-rewritten fixture bytes refuse the
// whole drill with exit 2. The passing result is reported below as the
// [manifest] section so section/check counts stay stable.
let manifestChecks = 0;
{
  const manifest = readJson('manifest.json');
  for (const [file, expectedSha] of Object.entries(manifest.files as Record<string, string>)) {
    manifestChecks += 1;
    const observed = sha256(file);
    if (observed !== expectedSha) {
      console.error(`REFUSED: fixture integrity failure: ${file} sha ${observed} != pinned ${expectedSha}`);
      process.exit(2);
    }
  }
}

const sections: SectionResult[] = [];

function section(name: string, checks: () => { checks: number; findings: Finding[] }): void {
  if (onlySection && onlySection !== name) return;
  try {
    const { checks: n, findings } = checks();
    const status = findings.length === 0 ? 'ok' : 'failed';
    sections.push({ name, checks: n, status, findings });
    console.log(`[${name}] ${status} (${n} checks)` +
      (findings.length ? ` — ${findings.length} finding(s)` : ''));
    for (const f of findings) {
      console.log(`  MISMATCH ${f.beliefId} field=${f.field} expected=${f.expected} observed=${f.observed}`);
    }
  } catch (err) {
    sections.push({ name, checks: 0, status: 'failed', findings: [] });
    console.log(`[${name}] failed — ${(err as Error).message}`);
  }
}

// ---------- static zero-paid pin ----------
function staticImportCheck(): { checks: number; findings: Finding[] } {
  const banned = ['openai', 'axios', 'node-fetch', 'undici', 'http', 'https', 'pg', 'neo4j-driver', 'ioredis', 'bullmq'];
  const files = [
    resolve(__dirname, '..', 'src', 'core', 'graph', 'support.ts'),
    resolve(__dirname, '..', 'src', 'core', 'graph', 'support_metrics.ts'),
    __filename,
  ];
  let checks = 0;
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const b of banned) {
      checks += 1;
      const re = new RegExp(`(from ['"]${b}['"])|(require\\(['"]${b}['"]\\))`);
      if (re.test(text)) {
        throw new Error(`zero-paid violation: ${f} imports "${b}"`);
      }
    }
  }
  return { checks, findings: [] };
}

// ---------- comparison helpers ----------
const round12 = (x: number) => Number(x.toFixed(12));
function canonicalOpinion(o: SupportOpinion): string {
  return JSON.stringify({
    b: round12(o.b), d: round12(o.d),
    events: { abstain: o.events.abstain, clean: o.events.clean, drawback: o.events.drawback },
    projected: round12(o.projected), u: round12(o.u),
  });
}
function compareOpinion(beliefId: string, expected: Record<string, number>, observed: SupportOpinion): Finding[] {
  const out: Finding[] = [];
  for (const field of ['b', 'd', 'u', 'projected'] as const) {
    if (Math.abs(expected[field] - observed[field]) > TOL) {
      out.push({ beliefId, field, expected: expected[field], observed: observed[field] });
    }
  }
  return out;
}

// ---------- load fixtures ----------
const verdictsFile = readJson('verdicts.json');
const metricsFile = readJson('metrics.json');
const expectedFileName = negativeControl ? 'expected_opinions_broken.json' : 'expected_opinions.json';
const expectedFile = readJson(expectedFileName);
const params: SupportParams = expectedFile.params;
const asOfMs: number = expectedFile.asOfMs;

if (injectMode === 'corrupt-expected') {
  // Failure injection: the comparison machinery itself must not pass on corrupted truths.
  expectedFile.beliefs['support-oracle:001'].b += 0.002;
}

const rawRows: Array<Record<string, unknown>> = verdictsFile.events;
const eventsByBelief = new Map<string, Array<Record<string, unknown>>>();
for (const row of rawRows) {
  const id = row.beliefId as string;
  const list = eventsByBelief.get(id) ?? [];
  list.push(row);
  eventsByBelief.set(id, list);
}
const asEvents = (rows: Array<Record<string, unknown>>): SupportEvent[] =>
  rows as unknown as SupportEvent[]; // extra fields (e.g. confidence) ride along and MUST be ignored

// ---------- sections ----------
// Integrity itself was verified in the pre-flight above (refusal path:
// exit 2); this section reports the verified pin count.
section('manifest', () => ({ checks: manifestChecks, findings: [] }));

section('static-imports', staticImportCheck);

section('arithmetic', () => {
  const findings: Finding[] = [];
  let checks = 0;
  for (const [beliefId, expected] of Object.entries(expectedFile.beliefs as Record<string, Record<string, number>>)) {
    const rows = eventsByBelief.get(beliefId) ?? [];
    const observed = computeSupportOpinion(asEvents(rows), asOfMs, params);
    checks += 4;
    findings.push(...compareOpinion(beliefId, expected, observed));
  }
  return { checks, findings };
});

section('abstain-routing', () => {
  const findings: Finding[] = [];
  let checks = 0;
  for (const [beliefId, rows] of eventsByBelief.entries()) {
    const o = computeSupportOpinion(asEvents(rows), asOfMs, params);
    checks += 1;
    if (Math.abs(o.b + o.d + o.u - 1) > TOL) {
      findings.push({ beliefId, field: 'b+d+u', expected: 1, observed: o.b + o.d + o.u });
    }
  }
  const allAbstain = computeSupportOpinion(asEvents(eventsByBelief.get('support-oracle:005') ?? []), asOfMs, params);
  checks += 3;
  if (Math.abs(allAbstain.b) > TOL) findings.push({ beliefId: 'support-oracle:005', field: 'b', expected: 0, observed: allAbstain.b });
  if (Math.abs(allAbstain.d) > TOL) findings.push({ beliefId: 'support-oracle:005', field: 'd', expected: 0, observed: allAbstain.d });
  if (Math.abs(allAbstain.u - 1) > TOL) findings.push({ beliefId: 'support-oracle:005', field: 'u', expected: 1, observed: allAbstain.u });
  return { checks, findings };
});

section('decay', () => {
  const findings: Finding[] = [];
  let checks = 0;
  for (const [beliefId, spec] of Object.entries(expectedFile.decay as Record<string, { at: number[]; opinions: Array<Record<string, number>> }>)) {
    const rows = asEvents(eventsByBelief.get(beliefId) ?? []);
    const observed = spec.at.map((t) => computeSupportOpinion(rows, t, params));
    for (let i = 0; i < observed.length; i += 1) {
      checks += 4;
      findings.push(...compareOpinion(`${beliefId}@${spec.at[i]}`, spec.opinions[i], observed[i]));
    }
    for (let i = 1; i < observed.length; i += 1) {
      checks += 1;
      if (observed[i].u + TOL < observed[i - 1].u) {
        findings.push({ beliefId: `${beliefId}@monotone`, field: 'u', expected: observed[i - 1].u, observed: observed[i].u });
      }
    }
  }
  return { checks, findings };
});

section('validity-gate', () => {
  const findings: Finding[] = [];
  let checks = 0;
  const calibration = (metricsFile.calibration as Array<Record<string, string>>).map(
    (m) => new Map(Object.entries(m)) as Map<string, 'drawback' | 'clean' | 'abstain'>
  );
  for (const cand of metricsFile.validCandidates as Array<{ name: string; expr: MetricExpr }>) {
    checks += 1;
    validateMetric(cand.expr, calibration); // throws on wrongful refusal
    evaluateMetric(cand.expr, calibration[0]);
  }
  for (const cand of metricsFile.vacuousCandidates as Array<{ name: string; expectClass: string; expr: MetricExpr }>) {
    checks += 1;
    let refused = false;
    try {
      validateMetric(cand.expr, calibration);
    } catch (err) {
      refused = true;
      if (!(err instanceof MetricValidityError) || err.vacuityClass !== cand.expectClass) {
        throw new Error(`${cand.name}: refused with wrong class ${(err as MetricValidityError).vacuityClass ?? 'unknown'}, expected ${cand.expectClass}`);
      }
    }
    if (!refused) throw new Error(`${cand.name}: vacuous candidate was NOT refused — validity gate broken`);
  }
  checks += 1;
  let emptyRefused = false;
  try { validateMetric((metricsFile.validCandidates[0] as { expr: MetricExpr }).expr, []); } catch { emptyRefused = true; }
  if (!emptyRefused) throw new Error('empty calibration set was not refused (fail-closed violated)');
  return { checks, findings };
});

section('confidence-exclusion', () => {
  const findings: Finding[] = [];
  const rows = eventsByBelief.get('support-oracle:008') ?? [];
  const withField = computeSupportOpinion(asEvents(rows), asOfMs, params);
  const stripped = rows.map(({ beliefId, opId, verdict, atMs, weight }) =>
    ({ beliefId, opId, verdict, atMs, weight })) as unknown as SupportEvent[];
  const withoutField = computeSupportOpinion(stripped, asOfMs, params);
  if (canonicalOpinion(withField) !== canonicalOpinion(withoutField)) {
    findings.push({ beliefId: 'support-oracle:008', field: 'canonical-serialization', expected: NaN, observed: NaN });
  }
  // Order invariance rides along here: scrambled fixture order must not matter.
  const scrambled = eventsByBelief.get('support-oracle:010') ?? [];
  const sortedFirst = computeSupportOpinion(canonicalizeEvents(asEvents(scrambled)), asOfMs, params);
  const rawOrder = computeSupportOpinion(asEvents(scrambled), asOfMs, params);
  if (canonicalOpinion(sortedFirst) !== canonicalOpinion(rawOrder)) {
    findings.push({ beliefId: 'support-oracle:010', field: 'order-invariance', expected: NaN, observed: NaN });
  }
  return { checks: 2, findings };
});

// ---------- verdict ----------
const failed = sections.filter((s) => s.status === 'failed');
const summary = { sectionsRun: sections.length, sectionsFailed: failed.length, exitCode: 0 };

if (injectMode === 'corrupt-expected') {
  const arithmetic = sections.find((s) => s.name === 'arithmetic');
  const detected = arithmetic?.findings.some((f) => f.beliefId === 'support-oracle:001') ?? false;
  console.log(detected
    ? 'FAILURE-INJECTION ok: in-memory corruption of support-oracle:001 was detected and named.'
    : 'FAILURE-INJECTION FAILURE: corrupted expected value was ABSORBED — comparison machinery broken.');
  summary.exitCode = detected ? 0 : 1;
} else if (negativeControl) {
  const detected = failed.some((s) => s.findings.some((f) => f.beliefId === 'support-oracle:003'));
  console.log(detected
    ? 'NEGATIVE-CONTROL ok: broken oracle detected (support-oracle:003 named). Healthy exit is nonzero (3).'
    : 'NEGATIVE-CONTROL FAILURE: broken oracle was ABSORBED — the harness cannot fail loudly.');
  summary.exitCode = detected ? 3 : 1;
} else {
  summary.exitCode = failed.length === 0 ? 0 : 1;
}

console.log(`summary: ${sections.length} sections, ${failed.length} failed, exit ${summary.exitCode}`);
if (resultsPath) {
  writeFileSync(resolve(resultsPath), JSON.stringify({
    drill: 'support-oracle',
    fixtureManifestSha: sha256('manifest.json'),
    mode: injectMode ? 'inject' : negativeControl ? 'negative-control' : 'default',
    sections,
    summary,
  }, null, 2) + '\n');
  console.log(`results written to ${resolve(resultsPath)}`);
}
process.exit(summary.exitCode);
