/**
 * Judge-convocation drill (zero-paid, zero-LLM, zero-infra).
 *
 * Specification: docs/product/epistemic-support/JUDGE_CONVOCATION_DESIGN.md
 * §6 (behavior → enforcement → pin; every row maps to a section) and §7
 * (drill shape), in the test_judge_intake.ts mold.
 * Entrypoint: `npm run test:judge-convocation` (the non-test caller,
 * AGENTS.md rule 15).
 *
 * Modes:
 *   default                      run sections; exit 0 iff all green
 *   --section <name>             run one section
 *   --negative-control           run the four planted breaks; healthy
 *                                behavior is detection: exit 3 with all
 *                                four named (a contested-roster
 *                                consistency break reaching a run; a
 *                                duplicate store write; a spawn
 *                                transport whose bytes differ from the
 *                                rendered prompt; a registration
 *                                recorded after run-open). Exit 1
 *                                (absorbed) means the harness is broken.
 *   --inject corrupt-expected    corrupt one expected pairKey in memory
 *                                post-load; PASS (exit 0) iff detected.
 *
 * Refusals (before any section): fixture manifest SHA mismatch (exit 2),
 * any TRELLIS_EXP_* variable set (exit 2).
 */

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import {
  buildAddressSpace,
  buildRatificationRequest,
  buildSelection,
  buildCandidate,
} from '../src/core/graph/judge_intake';
import { renderPrompt, PromptSchemaError, type ComposedJudgePrompt } from '../src/core/graph/judge_intake_prompt';
import { SUPPORT_PARAMS_V1 } from '../src/core/graph/support';
import {
  appendThroughLaw,
  createMemoryConvocationStore,
  replayConvocationRecords,
  type ConvocationRecord,
  type ConvocationStore,
  type VerdictPayload,
} from '../src/core/graph/judge_convocation_store';
import {
  JUDGE_ENTITY_MERGE_CYPHER,
  buildRegistryFromState,
  judgeEntityName,
  planJudgeRegistrations,
  type JudgeEntityState,
} from '../src/core/graph/judge_registration';
import {
  buildEngineVerdict,
  buildSpawnRequest,
  judgeResponseSchema,
  makeLiveJudge,
  makeOracleJudge,
  ModelIdentityMismatchError,
  type ConvocationJudge,
} from '../src/core/graph/judge_spawn';
import {
  candidateHashOf,
  candidateIdentityOf,
  computeConvocationReport,
  judgeIdentityOf,
  mulberry32,
  pairKeyOf,
  runConvocationSweep,
  type EvidenceGatherers,
  type SweepReport,
} from '../src/core/graph/support_sweep';

const FIXTURES = resolve(__dirname, '..', 'fixtures', 'judge_convocation');

interface Finding { scenario: string; field: string; expected: string; observed: string }
interface SectionResult { name: string; checks: number; status: 'ok' | 'failed'; findings: Finding[] }

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const onlySection = flag('--section');
const negativeControl = args.includes('--negative-control');
const injectMode = flag('--inject');

// ---------- refusals before any section ----------
const expFlags = Object.keys(process.env).filter((k) => k.startsWith('TRELLIS_EXP_'));
if (expFlags.length > 0) {
  console.error(`REFUSED: experiment flags set in environment: ${expFlags.join(', ')}`);
  process.exit(2);
}

const readJson = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
const sha256File = (name: string) =>
  createHash('sha256').update(readFileSync(join(FIXTURES, name))).digest('hex');

let manifestChecks = 0;
{
  const manifest = readJson('manifest.json');
  for (const [file, expectedSha] of Object.entries(manifest.files as Record<string, string>)) {
    manifestChecks += 1;
    const observed = sha256File(file);
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
    sections.push({ name, checks: n, status: findings.length === 0 ? 'ok' : 'failed', findings });
    console.log(`[${name}] ${findings.length === 0 ? 'ok' : 'failed'} (${n} checks)` + (findings.length ? ` — ${findings.length} finding(s)` : ''));
    for (const f of findings) console.log(`  MISMATCH ${f.scenario} field=${f.field} expected=${f.expected} observed=${f.observed}`);
  } catch (err) {
    sections.push({ name, checks: 0, status: 'failed', findings: [] });
    console.log(`[${name}] failed — ${(err as Error).message}`);
  }
}

async function asyncSection(name: string, checks: () => Promise<{ checks: number; findings: Finding[] }>): Promise<void> {
  if (onlySection && onlySection !== name) return;
  try {
    const { checks: n, findings } = await checks();
    sections.push({ name, checks: n, status: findings.length === 0 ? 'ok' : 'failed', findings });
    console.log(`[${name}] ${findings.length === 0 ? 'ok' : 'failed'} (${n} checks)` + (findings.length ? ` — ${findings.length} finding(s)` : ''));
    for (const f of findings) console.log(`  MISMATCH ${f.scenario} field=${f.field} expected=${f.expected} observed=${f.observed}`);
  } catch (err) {
    sections.push({ name, checks: 0, status: 'failed', findings: [] });
    console.log(`[${name}] failed — ${(err as Error).message}`);
  }
}

function expectRefusal(findings: Finding[], scenario: string, errorName: string, fn: () => unknown): void {
  try {
    fn();
    findings.push({ scenario, field: 'refusal', expected: errorName, observed: 'no error thrown' });
  } catch (err) {
    const observed = (err as Error).constructor.name;
    if (observed !== errorName) {
      findings.push({ scenario, field: 'refusal', expected: errorName, observed: `${observed}: ${(err as Error).message}` });
    }
  }
}

async function expectAsyncRefusal(findings: Finding[], scenario: string, errorName: string, fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    findings.push({ scenario, field: 'refusal', expected: errorName, observed: 'no error thrown' });
    return '';
  } catch (err) {
    const observed = (err as Error).constructor.name;
    if (observed !== errorName) {
      findings.push({ scenario, field: 'refusal', expected: errorName, observed: `${observed}: ${(err as Error).message}` });
    }
    return (err as Error).message;
  }
}

const canon = (value: unknown): string => JSON.stringify(value);

// ---------- fixtures ----------
const judgesFile = readJson('judges.json');
const candidatesFile = readJson('candidates.json');
const evidenceFile = readJson('evidence.json');
const brokenTwins = readJson('broken_twins.json');
const truthRun1 = readJson('oracle_truth_run1.json');
const truthRun2 = readJson('oracle_truth_run2.json');
const expected = readJson('expected_convocation.json');

if (injectMode === 'corrupt-expected') {
  expected.pairKeys['sel-fact-a/j1-grounding-v1'] =
    expected.pairKeys['sel-fact-a/j1-grounding-v1'].replace(/^./, (c: string) => (c === '0' ? '1' : '0'));
}

const ATMS = expected.atMs as number;
const ASOF = expected.asOfMs as number;
const graphStates = judgesFile.graphStates as JudgeEntityState[];

function baseSeedRecords(): ConvocationRecord[] {
  const rows: ConvocationRecord[] = [];
  for (const j of judgesFile.manifests as Array<{ manifest: { judgeId: string }; sourceNodeIds: string[] }>) {
    rows.push({ kind: 'judge_manifest', key: j.manifest.judgeId, payload: j });
  }
  for (const r of candidatesFile.ratifications as Array<{ key: string; payload: unknown }>) {
    rows.push({ kind: 'ratification', key: r.key, payload: r.payload });
  }
  return rows;
}

const gatherers: EvidenceGatherers = {
  async citedBytes(candidate) {
    const v = evidenceFile[candidate.selectionId]?.citedBytes;
    return v === undefined ? { available: false, context: {} } : { available: true, context: { citedBytes: v } };
  },
  async history(candidate) {
    const v = evidenceFile[candidate.selectionId]?.history;
    return v === undefined ? { available: false, context: {} } : { available: true, context: { history: v } };
  },
  async independentEvidence(candidate) {
    const v = evidenceFile[candidate.selectionId]?.independentEvidence;
    return v === undefined ? { available: false, context: {} } : { available: true, context: { independentEvidence: v } };
  },
};

interface RunResult { store: ConvocationStore; report: SweepReport; prompts: Map<string, string> }

async function runSweep(opts: {
  store?: ConvocationStore;
  runId: string;
  truth: Record<string, unknown>;
  sampleRate?: number;
  judgeBudget?: number;
  random?: () => number;
  states?: JudgeEntityState[];
  judgeOverride?: ConvocationJudge;
}): Promise<RunResult> {
  const store = opts.store ?? createMemoryConvocationStore(baseSeedRecords());
  const state = replayConvocationRecords(await store.loadAll());
  const prompts = new Map<string, string>();
  const oracle = makeOracleJudge(opts.truth);
  const judge: ConvocationJudge = opts.judgeOverride ?? (async (composed, pairKey) => {
    prompts.set(pairKey, renderPrompt(composed));
    return oracle(composed, pairKey);
  });
  const report = await runConvocationSweep({
    store,
    state,
    graphStates: opts.states ?? graphStates,
    gatherers,
    judge,
    policy: {
      sampleRate: opts.sampleRate ?? 1,
      judgeBudget: opts.judgeBudget ?? 25,
      random: opts.random ?? (() => 0),
    },
    runId: opts.runId,
    nowMs: () => ATMS,
    verdictWeight: 1,
  });
  return { store, report, prompts };
}

const relativeSpecifiers = (path: string): string[] =>
  [...readFileSync(path, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g)]
    .map((m) => m[1] ?? m[2])
    .filter((s) => s.startsWith('.'));

const GRAPH_DIR = resolve(__dirname, '..', 'src', 'core', 'graph');

async function main(): Promise<void> {
  // ---------- sections ----------
  section('manifest', () => ({ checks: manifestChecks, findings: [] }));

  section('static-imports', () => {
    let checks = 0;
    const banned = ['axios', 'node-fetch', 'undici', 'http', 'https', 'ioredis', 'bullmq'];
    const files = {
      store: join(GRAPH_DIR, 'judge_convocation_store.ts'),
      registration: join(GRAPH_DIR, 'judge_registration.ts'),
      sweep: join(GRAPH_DIR, 'support_sweep.ts'),
      spawn: join(GRAPH_DIR, 'judge_spawn.ts'),
    };
    // Zero-paid bans; the spawn module alone may DYNAMICALLY import
    // openai inside the live constructor (the entailment mold) — a
    // top-level/static openai import anywhere is a violation.
    for (const [name, f] of Object.entries(files)) {
      const text = readFileSync(f, 'utf8');
      for (const b of banned) {
        checks += 1;
        if (new RegExp(`(from ['"](node:)?${b}['"])|(require\\(['"](node:)?${b}['"]\\))`).test(text)) {
          throw new Error(`zero-paid violation: ${name} imports "${b}"`);
        }
      }
      checks += 1;
      if (/^import[^;]*from ['"]openai['"]/m.test(text)) {
        throw new Error(`zero-paid violation: ${name} statically imports openai`);
      }
      checks += 1;
      if (name !== 'spawn' && /import\(['"]openai['"]\)/.test(text)) {
        throw new Error(`zero-paid violation: ${name} dynamically imports openai — only the spawn boundary may`);
      }
    }
    // Rule 11 at the new surface: the spawn never sees expectations.
    checks += 1;
    for (const spec of relativeSpecifiers(files.spawn)) {
      if (spec.includes('judge_prereg') || spec.includes('judge_convocation_store')) {
        throw new Error(`rule-11 violation: judge_spawn imports "${spec}" — the spawn must not see expectations`);
      }
    }
    // One-way imports: nothing composition-side imports back.
    checks += 1;
    for (const f of ['judge_panel.ts', 'support.ts', 'judge_audit.ts', 'judge_intake.ts', 'judge_intake_prompt.ts', 'judge_prereg.ts']) {
      for (const spec of relativeSpecifiers(join(GRAPH_DIR, f))) {
        if (/judge_convocation_store|judge_registration|support_sweep|judge_spawn/.test(spec)) {
          throw new Error(`one-way-import violation: ${f} imports "${spec}"`);
        }
      }
    }
    // The sweep never imports a write-path or promotion surface.
    checks += 1;
    for (const spec of relativeSpecifiers(files.sweep)) {
      if (/ingest|provenance|promotion|extraction/.test(spec)) {
        throw new Error(`write-gate violation: support_sweep imports "${spec}"`);
      }
    }
    return { checks, findings: [] };
  });

  section('roster-manifest', () => {
    const findings: Finding[] = [];
    let checks = 0;
    const existing = new Set<string>(['j1-grounding-v1', 'j2-coherence-v1', 'j3-corroboration-v1', 'j4-audit-v1']);
    for (const invalid of judgesFile.invalidRegistrations as Array<{ name: string; expect: string; judges: Array<{ manifest: unknown; sourceNodeIds: string[] }> }>) {
      checks += 1;
      expectRefusal(findings, invalid.name, invalid.expect, () => planJudgeRegistrations(invalid.judges, existing));
    }
    checks += 1;
    const planned = planJudgeRegistrations(judgesFile.manifests, new Set());
    if (planned.length !== 4 || planned.some((p) => !p.entityName.startsWith('judge:'))) {
      findings.push({ scenario: 'healthy-plan', field: 'entities', expected: '4 judge:-prefixed', observed: canon(planned.map((p) => p.entityName)) });
    }
    return { checks, findings };
  });

  section('roster-consistency', () => {
    const findings: Finding[] = [];
    let checks = 0;
    const state = replayConvocationRecords(baseSeedRecords());
    checks += 1;
    expectRefusal(findings, 'hook-missing', 'ConvocationConsistencyError', () =>
      buildRegistryFromState(state.manifests, graphStates.filter((s) => s.entityName !== 'judge:j2-coherence-v1')));
    checks += 1;
    const orphanHook: JudgeEntityState = { entityName: 'judge:j9-ghost-v1', sourceNodeIds: [], orphanedSourceIds: [], contested: false, contestedAt: null, rederivedAt: null };
    expectRefusal(findings, 'manifest-missing', 'ConvocationConsistencyError', () =>
      buildRegistryFromState(state.manifests, [...graphStates, orphanHook]));
    checks += 1;
    const registry = buildRegistryFromState(state.manifests, graphStates);
    if (registry.size !== 4) {
      findings.push({ scenario: 'healthy', field: 'registry', expected: '4 judges', observed: String(registry.size) });
    }
    return { checks, findings };
  });

  await asyncSection('roster-lifecycle', async () => {
    const findings: Finding[] = [];
    let checks = 0;
    // The graph round-trip carried into the pure law: run 1's verdicts
    // + a contested j3 hook → composition refuses candidates holding a
    // j3 verdict, typed, naming the judge; a candidate without one
    // still composes.
    const { store } = await runSweep({ runId: 'run-drill-1', truth: truthRun1 });
    const state = replayConvocationRecords(await store.loadAll());
    const reports = computeConvocationReport(state, judgesFile.graphStatesContestedJ3, ASOF, SUPPORT_PARAMS_V1);
    const factA = reports.find((r) => r.selectionId === 'sel-fact-a');
    const beliefC = reports.find((r) => r.selectionId === 'sel-belief-c');
    checks += 2;
    if (!factA?.refusal || !/ContestedJudgeError/.test(factA.refusal) || !/j3-corroboration-v1/.test(factA.refusal)) {
      findings.push({ scenario: 'contested-judge', field: 'refusal', expected: 'ContestedJudgeError naming j3-corroboration-v1', observed: String(factA?.refusal) });
    }
    if (beliefC?.composition === null || beliefC?.refusal !== null) {
      findings.push({ scenario: 'uninvolved-candidate', field: 'composes', expected: 'composition without refusal', observed: String(beliefC?.refusal) });
    }
    // Opacity pin: the hook cypher sets only id/kind/sourceNodeIds and
    // carries the un-contest recovery transition.
    checks += 3;
    if (/role|targetModelIdentity|rubricSha|anchorSetSha|taxonomy/.test(JUDGE_ENTITY_MERGE_CYPHER)) {
      findings.push({ scenario: 'hook-opacity', field: 'cypher', expected: 'no manifest field in the graph hook', observed: 'manifest token present' });
    }
    if (!/e\.contested = false/.test(JUDGE_ENTITY_MERGE_CYPHER) || !/rederivedAt/.test(JUDGE_ENTITY_MERGE_CYPHER)) {
      findings.push({ scenario: 'recovery-transition', field: 'cypher', expected: 'un-contest + rederivedAt stamp', observed: 'absent' });
    }
    if (judgeEntityName('j1-grounding-v1') !== 'judge:j1-grounding-v1') {
      findings.push({ scenario: 'prefix', field: 'entityName', expected: 'judge:j1-grounding-v1', observed: judgeEntityName('j1-grounding-v1') });
    }
    return { checks, findings };
  });

  await asyncSection('roster-existence', async () => {
    const findings: Finding[] = [];
    let checks = 0;
    // The existence gate's filtering logic, driven through a fake pool
    // (the gate is a thin SELECT; the logic is what can regress).
    const { findMissingEvidentiaryHashes, describeMissingEvidentiaryHashes } = await import('../src/core/graph/judge_registration');
    const present = new Set(['a'.repeat(64)]);
    const fakePool = {
      query: async (_sql: string, params: unknown[]) => ({
        rows: (params[0] as string[]).filter((h) => present.has(h)).map((id) => ({ id })),
      }),
    } as never;
    checks += 2;
    const missing = await findMissingEvidentiaryHashes(fakePool, ['a'.repeat(64), 'b'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)]);
    if (canon(missing) !== canon(['b'.repeat(64), 'c'.repeat(64)])) {
      findings.push({ scenario: 'gate-filter', field: 'missing', expected: canon(['b'.repeat(64), 'c'.repeat(64)]), observed: canon(missing) });
    }
    const many = Array.from({ length: 14 }, (_, i) => `${i.toString(16).padStart(2, '0')}`.repeat(32));
    const description = describeMissingEvidentiaryHashes(many);
    if (!/\+4 more/.test(description)) {
      findings.push({ scenario: 'gate-echo', field: 'bounded', expected: 'listing bounded with +4 more', observed: description });
    }
    // The ceremony runs the gate BEFORE any write (source-order pin,
    // scoped to the register path — recovery legitimately re-merges the
    // already-gated hashes after human re-review).
    checks += 1;
    const ceremony = readFileSync(resolve(__dirname, 'register_judges.ts'), 'utf8');
    const registerBody = ceremony.slice(ceremony.indexOf('async function registerMode'));
    const gateAt = registerBody.indexOf('findMissingEvidentiaryHashes(pgPool');
    const mergeAt = registerBody.indexOf('await mergeJudgeEntities');
    const appendAt = registerBody.indexOf("store.append({ kind: 'judge_manifest'");
    if (gateAt < 0 || mergeAt < 0 || appendAt < 0 || gateAt > mergeAt || gateAt > appendAt) {
      findings.push({ scenario: 'gate-order', field: 'before-any-write', expected: 'gate precedes both writes in registerMode', observed: canon({ gateAt, mergeAt, appendAt }) });
    }
    return { checks, findings };
  });

  section('roster-recovery', () => {
    const findings: Finding[] = [];
    let checks = 0;
    // A manifest change is a NEW registration under a NEW id — re-registering refuses.
    checks += 1;
    expectRefusal(findings, 'duplicate-existing-id', 'JudgeRegistrationError', () =>
      planJudgeRegistrations(
        (judgesFile.invalidRegistrations as Array<{ name: string; judges: Array<{ manifest: unknown; sourceNodeIds: string[] }> }>).find((i) => i.name === 'duplicate-existing-id')!.judges,
        new Set(['j1-grounding-v1'])
      ));
    // The ceremony requires a named human reviewer for recovery and
    // refuses an uncontested judge (source pins on the operator CLI).
    const ceremony = readFileSync(resolve(__dirname, 'register_judges.ts'), 'utf8');
    checks += 2;
    if (!/--reviewed-by <name> is required/.test(ceremony)) {
      findings.push({ scenario: 'named-reviewer', field: 'ceremony', expected: 'recovery requires --reviewed-by', observed: 'refusal string absent' });
    }
    if (!/is not contested — nothing to recover/.test(ceremony)) {
      findings.push({ scenario: 'uncontested-recovery', field: 'ceremony', expected: 'refuses recovering an uncontested judge', observed: 'refusal string absent' });
    }
    return { checks, findings };
  });

  section('sweep-pairs', () => {
    const findings: Finding[] = [];
    let checks = 0;
    const state = replayConvocationRecords(baseSeedRecords());
    // Pair identity against the independent oracle's re-derivation.
    for (const [label, expectedKey] of Object.entries(expected.pairKeys as Record<string, string>)) {
      checks += 1;
      const [selectionId, judgeId] = label.split('/');
      const rat = state.ratifications.get(selectionId)!;
      const space = buildAddressSpace(rat.entries);
      const candidate = buildCandidate(space, state.prereg, buildSelection(space, rat.selection));
      const manifest = state.manifests.get(judgeId)!.manifest;
      const observed = pairKeyOf(candidateIdentityOf(selectionId, candidateHashOf(candidate)), judgeIdentityOf(manifest));
      if (observed !== expectedKey) {
        findings.push({ scenario: label, field: 'pairKey', expected: expectedKey, observed });
      }
    }
    // Identity spans candidate bytes and manifest identity: changed
    // bytes or a changed rubric produce a NEW pair.
    checks += 2;
    const base = { claimMode: 'fact', claims: [{ address: 'x', content: 'The tide gauge at Dock 9 reads 2.3 m at noon.' }] } as never;
    const reworded = { claimMode: 'fact', claims: [{ address: 'x', content: 'The tide gauge at Dock 9 reads 2.4 m at noon.' }] } as never;
    if (candidateHashOf(base) === candidateHashOf(reworded)) {
      findings.push({ scenario: 're-ratified-bytes', field: 'candidateHash', expected: 'differs', observed: 'identical' });
    }
    const m1 = state.manifests.get('j1-grounding-v1')!.manifest;
    if (judgeIdentityOf(m1) === judgeIdentityOf({ ...m1, rubricSha: 'ff'.repeat(32) })) {
      findings.push({ scenario: 're-registered-judge', field: 'judgeIdentity', expected: 'differs', observed: 'identical' });
    }
    return { checks, findings };
  });

  await asyncSection('sweep-selection', async () => {
    const findings: Finding[] = [];
    let checks = 0;
    // The main run: pool, sampling, and every count against the oracle.
    const { report } = await runSweep({ runId: 'run-drill-1', truth: truthRun1 });
    checks += 1;
    const expectedRun1 = expected.run1;
    const observedRun1 = { ...report, exclusions: report.exclusions };
    for (const key of ['poolCandidates', 'poolJudges', 'poolPairs', 'sampled', 'deferred', 'judged', 'skippedNoAnswer', 'jurisdictionAbstains', 'verdictsAppended'] as const) {
      if (observedRun1[key] !== expectedRun1[key]) {
        findings.push({ scenario: 'run1', field: key, expected: String(expectedRun1[key]), observed: String(observedRun1[key]) });
      }
    }
    // The hard budget: overflow deferred, counted, first-in-order kept.
    checks += 1;
    const budget = await runSweep({ runId: 'run-drill-budget', truth: truthRun1, judgeBudget: 2 });
    if (budget.report.sampled !== expected.budgetRun.sampled || budget.report.deferred !== expected.budgetRun.deferred) {
      findings.push({ scenario: 'budget', field: 'deferred', expected: canon({ sampled: expected.budgetRun.sampled, deferred: expected.budgetRun.deferred }), observed: canon({ sampled: budget.report.sampled, deferred: budget.report.deferred }) });
    }
    checks += 1;
    const budgetKeys = [...budget.prompts.keys()];
    if (canon(budgetKeys) !== canon(expected.budgetRun.firstTwoPairKeys)) {
      findings.push({ scenario: 'budget', field: 'first-pairs', expected: canon(expected.budgetRun.firstTwoPairKeys), observed: canon(budgetKeys) });
    }
    // The seeded sampler: mulberry32 sequence and iteration order
    // against the generator's independent re-derivation.
    checks += 1;
    const seeded = await runSweep({ runId: 'run-drill-seeded', truth: truthRun1, sampleRate: expected.seededRun.rate, random: mulberry32(expected.seededRun.seed) });
    if (seeded.report.sampled !== expected.seededRun.sampled) {
      findings.push({ scenario: 'seeded', field: 'sampled', expected: String(expected.seededRun.sampled), observed: String(seeded.report.sampled) });
    }
    checks += 1;
    if (canon([...seeded.prompts.keys()])
      !== canon(expected.seededRun.sampledPairKeys.filter((k: string) => (expected.seededRun.sampledPairKeys as string[]).includes(k)))) {
      findings.push({ scenario: 'seeded', field: 'sampled-pairs', expected: canon(expected.seededRun.sampledPairKeys), observed: canon([...seeded.prompts.keys()]) });
    }
    return { checks, findings };
  });

  await asyncSection('sweep-once', async () => {
    const findings: Finding[] = [];
    let checks = 0;
    const run1 = await runSweep({ runId: 'run-drill-1', truth: truthRun1 });
    const run2 = await runSweep({ store: run1.store, runId: 'run-drill-2', truth: truthRun2 });
    checks += 1;
    for (const key of ['poolPairs', 'sampled', 'judged', 'skippedNoAnswer', 'jurisdictionAbstains', 'verdictsAppended'] as const) {
      if (run2.report[key] !== expected.run2[key]) {
        findings.push({ scenario: 'run2', field: key, expected: String(expected.run2[key]), observed: String(run2.report[key]) });
      }
    }
    // A judged pair never re-stamps: total verdict rows = run1 + run2.
    checks += 1;
    const rows = await run1.store.loadAll();
    const verdictRows = rows.filter((r) => r.kind === 'verdict');
    if (rows.length !== expected.storeRows.afterRuns || verdictRows.length !== expected.run1.verdictsAppended + expected.run2.verdictsAppended) {
      findings.push({ scenario: 'rows', field: 'counts', expected: canon({ rows: expected.storeRows.afterRuns, verdicts: expected.run1.verdictsAppended + expected.run2.verdictsAppended }), observed: canon({ rows: rows.length, verdicts: verdictRows.length }) });
    }
    // A third run with full truth finds nothing left.
    checks += 1;
    const run3 = await runSweep({ store: run1.store, runId: 'run-drill-3', truth: { ...truthRun1, ...truthRun2 } });
    if (run3.report.poolPairs !== 0 || run3.report.verdictsAppended !== 0) {
      findings.push({ scenario: 'run3', field: 'exhausted-pool', expected: 'poolPairs 0, verdictsAppended 0', observed: canon({ poolPairs: run3.report.poolPairs, appended: run3.report.verdictsAppended }) });
    }
    return { checks, findings };
  });

  await asyncSection('sweep-run-open', async () => {
    const findings: Finding[] = [];
    let checks = 0;
    const { store } = await runSweep({ runId: 'run-drill-1', truth: truthRun1 });
    const rows = await store.loadAll();
    // The run-open row precedes every verdict row (rule 20 bound to a real run).
    checks += 1;
    const openIndex = rows.findIndex((r) => r.kind === 'run_open' && r.key === 'run-drill-1');
    const firstVerdict = rows.findIndex((r) => r.kind === 'verdict');
    if (openIndex < 0 || (firstVerdict >= 0 && openIndex > firstVerdict)) {
      findings.push({ scenario: 'ordering', field: 'run-open-first', expected: 'run_open before any verdict', observed: canon({ openIndex, firstVerdict }) });
    }
    // A forecast for the opened run refuses, typed, through the law.
    checks += 1;
    const state = replayConvocationRecords(rows);
    await expectAsyncRefusal(findings, 'late-forecast', 'LateRegistrationError', () =>
      appendThroughLaw(store, state.prereg, {
        kind: 'pre_registration',
        key: 'prereg-late',
        payload: { registrationId: 'prereg-late', runId: 'run-drill-1', registeredAtMs: ATMS - 1, expectations: [{ itemId: 'sel-fact-a', expectedVerdict: 'clean', rationale: 'late' }] },
      }));
    // A forecast BEFORE a run opens records fine (what the store exists to preserve).
    checks += 1;
    const fresh = createMemoryConvocationStore(baseSeedRecords());
    const freshState = replayConvocationRecords(await fresh.loadAll());
    await appendThroughLaw(fresh, freshState.prereg, {
      kind: 'pre_registration',
      key: 'prereg-early',
      payload: { registrationId: 'prereg-early', runId: 'run-future', registeredAtMs: ATMS, expectations: [{ itemId: 'sel-fact-a', expectedVerdict: 'clean', rationale: 'forecast before the run' }] },
    });
    return { checks, findings };
  });

  await asyncSection('sweep-atomicity', async () => {
    const findings: Finding[] = [];
    let checks = 0;
    const store = createMemoryConvocationStore(baseSeedRecords());
    let calls = 0;
    const failing: ConvocationJudge = async () => {
      calls += 1;
      if (calls >= 2) throw new Error('synthetic judge infrastructure failure');
      return { verdict: 'clean', drawback: null };
    };
    checks += 1;
    let threw = false;
    try {
      await runSweep({ store, runId: 'run-drill-fail', truth: {}, judgeOverride: failing });
    } catch {
      threw = true;
    }
    if (!threw) findings.push({ scenario: 'infra-failure', field: 'propagates', expected: 'sweep rejects', observed: 'resolved' });
    // Zero verdict records, zero run report — only the run-open event
    // (the run really opened; the failure is honest).
    checks += 1;
    const rows = await store.loadAll();
    const appended = rows.filter((r) => r.kind === 'verdict' || r.kind === 'run_report');
    if (appended.length !== 0) {
      findings.push({ scenario: 'infra-failure', field: 'no-partial-writes', expected: '0 verdict/run_report rows', observed: String(appended.length) });
    }
    return { checks, findings };
  });

  await asyncSection('sweep-evidence', async () => {
    const findings: Finding[] = [];
    let checks = 0;
    const { store, report } = await runSweep({ runId: 'run-drill-1', truth: truthRun1 });
    // R-29 exclusion, typed and counted: the gates working, not a special case.
    checks += 1;
    if (canon(report.exclusions) !== canon(expected.run1.exclusions)) {
      findings.push({ scenario: 'exclusions', field: 'typed-counted', expected: canon(expected.run1.exclusions), observed: canon(report.exclusions) });
    }
    // Engine-synthesized jurisdiction abstentions: recorded, flagged
    // synthesized, promptHash null, zero spend (no oracle invocation).
    const rows = await store.loadAll();
    const verdictPayloads = rows.filter((r) => r.kind === 'verdict').map((r) => r.payload as VerdictPayload);
    const synthesized = verdictPayloads.filter((p) => p.synthesized);
    checks += 2;
    if (canon(synthesized.map((p) => p.pairKey)) !== canon(expected.synthesizedPairKeys)) {
      findings.push({ scenario: 'synthesized', field: 'pairKeys', expected: canon(expected.synthesizedPairKeys), observed: canon(synthesized.map((p) => p.pairKey)) });
    }
    if (synthesized.some((p) => p.promptHash !== null || p.verdict.verdict !== 'abstain' || p.verdict.abstainReason !== 'jurisdiction')) {
      findings.push({ scenario: 'synthesized', field: 'shape', expected: 'abstain/jurisdiction with null promptHash', observed: canon(synthesized) });
    }
    // Rule 12: the run report discloses the designed silence.
    checks += 1;
    const runReport = rows.find((r) => r.kind === 'run_report' && r.key === 'run-drill-1')?.payload as SweepReport | undefined;
    if (!runReport || runReport.jurisdictionAbstains !== expected.run1.jurisdictionAbstains || runReport.exclusions.length !== expected.run1.exclusions.length) {
      findings.push({ scenario: 'disclosure', field: 'run-report', expected: canon({ jurisdictionAbstains: expected.run1.jurisdictionAbstains, exclusions: expected.run1.exclusions.length }), observed: canon(runReport ? { jurisdictionAbstains: runReport.jurisdictionAbstains, exclusions: runReport.exclusions.length } : null) });
    }
    return { checks, findings };
  });

  await asyncSection('sweep-attribution', async () => {
    const findings: Finding[] = [];
    let checks = 0;
    const { store, prompts } = await runSweep({ runId: 'run-drill-1', truth: truthRun1 });
    // Byte-identical claims under distinct partitions, driven through
    // the FULL sweep path: byte-identical composed prompts per role.
    for (const judgeId of ['j1-grounding-v1', 'j2-coherence-v1', 'j3-corroboration-v1']) {
      checks += 1;
      const a = prompts.get(expected.pairKeys[`sel-fact-a/${judgeId}`]);
      const b = prompts.get(expected.pairKeys[`sel-fact-b/${judgeId}`]);
      if (a === undefined || a !== b) {
        findings.push({ scenario: judgeId, field: 'partition-bytes', expected: 'byte-identical prompts across partitions', observed: a === undefined ? 'prompt missing' : 'prompts differ — attribution reaches content' });
      }
    }
    // No address, partition, or container token in any rendered prompt
    // or any appended store payload.
    const tokens = candidatesFile.attributionTokens as string[];
    checks += 1;
    for (const [pairKey, rendered] of prompts.entries()) {
      for (const token of tokens) {
        if (rendered.includes(token)) {
          findings.push({ scenario: pairKey, field: 'prompt-leak', expected: `no "${token}"`, observed: 'token present' });
        }
      }
    }
    checks += 1;
    const appended = (await store.loadAll()).filter((r) => r.kind === 'verdict' || r.kind === 'run_report');
    for (const row of appended) {
      const bytes = JSON.stringify(row.payload);
      for (const token of tokens) {
        if (bytes.includes(token)) {
          findings.push({ scenario: `${row.kind}/${row.key}`, field: 'store-leak', expected: `no "${token}"`, observed: 'token present' });
        }
      }
    }
    return { checks, findings };
  });

  await asyncSection('report', async () => {
    const findings: Finding[] = [];
    let checks = 0;
    const run1 = await runSweep({ runId: 'run-drill-1', truth: truthRun1 });
    await runSweep({ store: run1.store, runId: 'run-drill-2', truth: truthRun2 });
    const state = replayConvocationRecords(await run1.store.loadAll());
    const reports = computeConvocationReport(state, graphStates, ASOF, SUPPORT_PARAMS_V1);
    for (const [selectionId, exp] of Object.entries(expected.opinions as Record<string, { b: number; d: number; u: number; projected: number; verdicts: number; disagreements: number; conflicts: number; jurisdictionAbstains: number; verdictsConsumed: number }>)) {
      checks += 2;
      const r = reports.find((x) => x.selectionId === selectionId);
      if (!r || r.refusal !== null || r.composition === null) {
        findings.push({ scenario: selectionId, field: 'composes', expected: 'composition', observed: String(r?.refusal) });
        continue;
      }
      const o = r.composition.opinion;
      const close = (x: number, y: number) => Math.abs(x - y) < 1e-9;
      if (!close(o.b, exp.b) || !close(o.d, exp.d) || !close(o.u, exp.u) || !close(o.projected, exp.projected)) {
        findings.push({ scenario: selectionId, field: 'opinion', expected: canon({ b: exp.b, d: exp.d, u: exp.u }), observed: canon({ b: o.b, d: o.d, u: o.u }) });
      }
      if (
        r.verdicts !== exp.verdicts
        || r.composition.disagreements.length !== exp.disagreements
        || r.composition.conflicts.length !== exp.conflicts
        || r.composition.counts.jurisdictionAbstains !== exp.jurisdictionAbstains
        || r.composition.counts.verdictsConsumed !== exp.verdictsConsumed
      ) {
        findings.push({ scenario: selectionId, field: 'counts', expected: canon(exp), observed: canon({ verdicts: r.verdicts, ...r.composition.counts, disagreements: r.composition.disagreements.length, conflicts: r.composition.conflicts.length }) });
      }
    }
    // The cross-role disagreement is data, flagged, never a blend.
    checks += 1;
    const factA = reports.find((x) => x.selectionId === 'sel-fact-a');
    const disagreement = factA?.composition?.disagreements[0];
    if (!disagreement || disagreement.registryEntry !== 'logical.falsification') {
      findings.push({ scenario: 'sel-fact-a', field: 'disagreement', expected: 'cross_role_disagreement on logical.falsification', observed: canon(disagreement ?? null) });
    }
    return { checks, findings };
  });

  section('writer-blind', () => {
    const findings: Finding[] = [];
    let checks = 0;
    // RECONCILIATION §5 row 9, closed here with the wiring: (a) the
    // kernel-prompt sources carry no support vocabulary; (b) no RLM
    // tool surface reaches the store or any support field.
    const tokens = [
      'judge_records', 'support_opinion', 'supportOpinion', 'composePanel',
      'J1_GROUNDING', 'J2_COHERENCE', 'J3_CORROBORATION', 'J4_AUDIT',
      'abstainReason', 'drawback', 'convocation',
    ];
    const rlmDir = resolve(__dirname, '..', 'src', 'rlm');
    const pyFiles = ['trellis_agent.py', 'trellis_tools.py', 'trellis_postgres.py', 'trellis_answer.py', 'trellis_scaffold.py', 'trellis_workspace.py', 'trellis_modules.py', 'trellis_blocks.py', 'trellis_textedit.py', 'trellis_mcp.py'];
    for (const f of pyFiles) {
      checks += 1;
      let text = '';
      try {
        text = readFileSync(join(rlmDir, f), 'utf8');
      } catch {
        continue; // an absent optional surface cannot leak
      }
      for (const token of tokens) {
        if (text.includes(token)) {
          findings.push({ scenario: f, field: 'kernel-leak', expected: `no "${token}"`, observed: 'token present' });
        }
      }
    }
    // The T15 read function never touches the store table.
    checks += 1;
    const schema = readFileSync(resolve(__dirname, '..', 'src', 'config', 'schema.ts'), 'utf8');
    const fnStart = schema.indexOf('CREATE OR REPLACE FUNCTION search_ast_nodes');
    const fnBody = schema.slice(fnStart);
    if (fnStart < 0 || fnBody.includes('judge_records')) {
      findings.push({ scenario: 'search_ast_nodes', field: 'read-surface', expected: 'no judge_records reference', observed: fnStart < 0 ? 'function not found' : 'reference present' });
    }
    return { checks, findings };
  });

  await asyncSection('spawn-transport', async () => {
    const findings: Finding[] = [];
    let checks = 0;
    // The transport is exactly the rendered bytes, re-verified pre-send.
    const { prompts, store } = await runSweep({ runId: 'run-drill-1', truth: truthRun1 });
    const state = replayConvocationRecords(await store.loadAll());
    const rat = state.ratifications.get('sel-fact-a')!;
    const space = buildAddressSpace(rat.entries);
    const candidate = buildCandidate(space, state.prereg, buildSelection(space, rat.selection));
    const { composeJudgePrompt } = await import('../src/core/graph/judge_intake_prompt');
    const { toPromptInput } = await import('../src/core/graph/judge_intake');
    const composed = composeJudgePrompt('J1_GROUNDING', 'j1-grounding-v1', toPromptInput(candidate), { citedBytes: evidenceFile['sel-fact-a'].citedBytes });
    checks += 2;
    const request = buildSpawnRequest(composed);
    if (request.content !== renderPrompt(composed) || request.promptHash !== composed.promptHash) {
      findings.push({ scenario: 'transport', field: 'bytes', expected: 'request content === rendered bytes', observed: 'differs' });
    }
    if (request.content !== prompts.get(expected.pairKeys['sel-fact-a/j1-grounding-v1'])) {
      findings.push({ scenario: 'transport', field: 'sweep-bytes', expected: 'the sweep transported the same bytes', observed: 'differs' });
    }
    // A tampered prompt refuses at the boundary, before any I/O.
    checks += 1;
    expectRefusal(findings, 'tampered', 'PromptSchemaError', () =>
      buildSpawnRequest(brokenTwins.tamperedComposedPrompt as ComposedJudgePrompt));
    return { checks, findings };
  });

  section('spawn-model', () => {
    const findings: Finding[] = [];
    let checks = 0;
    const state = replayConvocationRecords(baseSeedRecords());
    const manifest = state.manifests.get('j1-grounding-v1')!.manifest;
    checks += 1;
    expectRefusal(findings, 'mismatched-model', 'ModelIdentityMismatchError', () =>
      makeLiveJudge(manifest, 'some-other-model-2027'));
    checks += 1;
    try {
      makeLiveJudge(manifest, manifest.targetModelIdentity); // constructs; never invoked — no I/O occurs
    } catch (err) {
      findings.push({ scenario: 'matching-model', field: 'constructs', expected: 'constructor returns', observed: (err as Error).message });
    }
    checks += 1;
    const err = new ModelIdentityMismatchError('j', 'a', 'b');
    if (!/R-27/.test(err.message)) {
      findings.push({ scenario: 'refusal-teaches', field: 'message', expected: 'names R-27', observed: err.message });
    }
    return { checks, findings };
  });

  await asyncSection('spawn-verdict', async () => {
    const findings: Finding[] = [];
    let checks = 0;
    // The model's surface is exactly {verdict, drawback, abstainReason}.
    checks += 2;
    if (judgeResponseSchema.safeParse({ verdict: 'clean', drawback: null, weight: 5 }).success) {
      findings.push({ scenario: 'weight-channel', field: 'refusal', expected: 'unparseable — weight is engine-side', observed: 'parsed' });
    }
    if (judgeResponseSchema.safeParse({ verdict: 'clean', drawback: null, atMs: 1 }).success) {
      findings.push({ scenario: 'time-channel', field: 'refusal', expected: 'unparseable — atMs is engine-side', observed: 'parsed' });
    }
    // Engine constants land on the record; the closed taxonomy holds.
    checks += 2;
    const verdict = buildEngineVerdict({ judgeId: 'j1-grounding-v1', role: 'J1_GROUNDING', beliefId: 'sel-fact-a', response: { verdict: 'clean', drawback: null }, atMs: ATMS, weight: 1 });
    if (verdict.weight !== 1 || verdict.atMs !== ATMS) {
      findings.push({ scenario: 'engine-fields', field: 'constants', expected: canon({ weight: 1, atMs: ATMS }), observed: canon({ weight: verdict.weight, atMs: verdict.atMs }) });
    }
    expectRefusal(findings, 'unknown-class', 'JudgeVerdictSchemaError', () =>
      buildEngineVerdict({ judgeId: 'j1', role: 'J1_GROUNDING', beliefId: 'b', response: { verdict: 'drawback', drawback: 'invented_class' }, atMs: ATMS, weight: 1 }));
    // An oracle response is held to the same strict schema.
    checks += 1;
    const oracle = makeOracleJudge({ k: { verdict: 'clean', drawback: null, taskText: 'find the expected drawback' } });
    await expectAsyncRefusal(findings, 'oracle-strict', 'SpawnResponseError', async () => {
      const state = replayConvocationRecords(baseSeedRecords());
      const rat = state.ratifications.get('sel-fact-a')!;
      const space = buildAddressSpace(rat.entries);
      const candidate = buildCandidate(space, state.prereg, buildSelection(space, rat.selection));
      const { composeJudgePrompt } = await import('../src/core/graph/judge_intake_prompt');
      const { toPromptInput } = await import('../src/core/graph/judge_intake');
      const composed = composeJudgePrompt('J1_GROUNDING', 'j1-grounding-v1', toPromptInput(candidate), { citedBytes: ['x'] });
      return oracle(composed, 'k');
    });
    return { checks, findings };
  });

  section('spawn-gate', () => {
    const findings: Finding[] = [];
    let checks = 0;
    // The runner's mechanical gates (source pins): --live without
    // --confirm-paid refuses; the default path constructs the oracle.
    const runner = readFileSync(resolve(__dirname, 'support_sweep.ts'), 'utf8');
    checks += 3;
    if (!/--live requires --confirm-paid/.test(runner)) {
      findings.push({ scenario: 'confirm-paid', field: 'runner', expected: 'refusal string present', observed: 'absent' });
    }
    if (!/makeOracleJudge\(truth\)/.test(runner)) {
      findings.push({ scenario: 'default-oracle', field: 'runner', expected: 'default path constructs the oracle', observed: 'absent' });
    }
    if (!/dated paid-queue re-opening/.test(runner)) {
      findings.push({ scenario: 'governance-gate', field: 'runner', expected: 'names the governance half of the triple gate', observed: 'absent' });
    }
    return { checks, findings };
  });

  section('queue-shows-cut', () => {
    const findings: Finding[] = [];
    let checks = 0;
    const rat = (candidatesFile.ratifications as Array<{ key: string; payload: { entries: unknown[]; selection: { selectionId: string; addresses: string[]; selectedAtMs: number } } }>).find((r) => r.key === 'sel-fact-a')!;
    const space = buildAddressSpace(rat.payload.entries);
    const request = buildRatificationRequest(space, buildSelection(space, rat.payload.selection));
    checks += 2;
    if (request.items[0]?.content !== 'The tide gauge at Dock 9 reads 2.3 m at noon.') {
      findings.push({ scenario: 'sel-fact-a', field: 'bytes', expected: 'the exact selected bytes', observed: String(request.items[0]?.content) });
    }
    if (request.items[0]?.neighborBefore !== 'Log opened by the harbor watch.' || request.items[0]?.neighborAfter !== 'Gauge serviced last Tuesday.') {
      findings.push({ scenario: 'sel-fact-a', field: 'neighbors', expected: 'both engine-computed neighbors visible', observed: canon({ before: request.items[0]?.neighborBefore, after: request.items[0]?.neighborAfter }) });
    }
    // The CLI prints the payload verbatim and requires the recorded flags.
    const cli = readFileSync(resolve(__dirname, 'judge_ratify.ts'), 'utf8');
    checks += 2;
    if (!/JSON\.stringify\(request, null, 2\)/.test(cli)) {
      findings.push({ scenario: 'cli', field: 'verbatim', expected: 'show prints the request verbatim', observed: 'absent' });
    }
    if (!/requires the explicit --confirm flag/.test(cli) || !/--claim-mode/.test(cli)) {
      findings.push({ scenario: 'cli', field: 'recorded-flags', expected: '--confirm and --claim-mode required', observed: 'absent' });
    }
    return { checks, findings };
  });

  await asyncSection('queue-provenance', async () => {
    const findings: Finding[] = [];
    let checks = 0;
    const state = replayConvocationRecords(baseSeedRecords());
    // The ratified mode is the candidate's mode — read, never supplied.
    checks += 1;
    const rat = state.ratifications.get('sel-belief-c')!;
    const space = buildAddressSpace(rat.entries);
    const candidate = buildCandidate(space, state.prereg, buildSelection(space, rat.selection));
    if (candidate.claimMode !== 'belief') {
      findings.push({ scenario: 'sel-belief-c', field: 'claimMode', expected: 'belief (from the recorded ratification)', observed: candidate.claimMode });
    }
    // A second ratification refuses through the law AND the storage key;
    // the first survives.
    const store = createMemoryConvocationStore(baseSeedRecords());
    checks += 2;
    await expectAsyncRefusal(findings, 'second-ratification', 'DuplicateRecordError', () =>
      appendThroughLaw(store, state.prereg, {
        kind: 'ratification',
        key: 'sel-belief-c',
        payload: { ...rat, record: { ...rat.record, claimMode: 'fact' } },
      }));
    const after = replayConvocationRecords(await store.loadAll());
    if (after.ratifications.get('sel-belief-c')?.record.claimMode !== 'belief') {
      findings.push({ scenario: 'first-survives', field: 'claimMode', expected: 'belief', observed: String(after.ratifications.get('sel-belief-c')?.record.claimMode) });
    }
    return { checks, findings };
  });

  await asyncSection('store-write-once', async () => {
    const findings: Finding[] = [];
    let checks = 0;
    const store = createMemoryConvocationStore(baseSeedRecords());
    // A second write for a (kind, key) refuses mechanically.
    checks += 1;
    await expectAsyncRefusal(findings, 'duplicate-key', 'StoreDuplicateError', () =>
      store.append({ kind: 'judge_manifest', key: 'j1-grounding-v1', payload: {} }));
    // Supersession must reference an existing record (slice-1 law
    // through validate-then-append).
    checks += 1;
    const state = replayConvocationRecords(await store.loadAll());
    await expectAsyncRefusal(findings, 'unknown-supersedes', 'PreregSchemaError', () =>
      appendThroughLaw(store, state.prereg, {
        kind: 'pre_registration',
        key: 'prereg-x',
        payload: { registrationId: 'prereg-x', runId: 'run-x', registeredAtMs: ATMS, expectations: [{ itemId: 'i', expectedVerdict: 'clean', rationale: 'r' }], supersedes: 'prereg-ghost' },
      }));
    // A tampered table (unknown kind) refuses at replay, typed.
    checks += 1;
    expectRefusal(findings, 'unknown-kind', 'StoreReplayError', () =>
      replayConvocationRecords([{ kind: 'mystery' as never, key: 'k', payload: {} }]));
    return { checks, findings };
  });

  // ---------- verdict ----------
  const failed = sections.filter((s) => s.status === 'failed');

  if (negativeControl) {
    // Four planted breaks, each named individually.
    const detections: Array<[string, boolean]> = [];

    // A: a roster consistency break reaching a run — the sweep refuses.
    let rosterDetected = false;
    try {
      await runSweep({ runId: 'run-nc-a', truth: truthRun1, states: brokenTwins.graphStatesMissingHook as JudgeEntityState[] });
    } catch (err) {
      rosterDetected = (err as Error).constructor.name === 'ConvocationConsistencyError'
        && /j2-coherence-v1/.test((err as Error).message);
    }
    detections.push(['roster (hook missing for a store manifest reaching a run)', rosterDetected]);

    // B: a duplicate store write surviving — seeding the twin must refuse.
    let dupDetected = false;
    try {
      createMemoryConvocationStore(brokenTwins.duplicateVerdictRows as ConvocationRecord[]);
    } catch (err) {
      dupDetected = err instanceof Error && err.constructor.name === 'StoreDuplicateError';
    }
    detections.push(['store (duplicate verdict write for one pair key)', dupDetected]);

    // C: transport bytes differing from the rendered prompt — refused pre-send.
    let transportDetected = false;
    try {
      buildSpawnRequest(brokenTwins.tamperedComposedPrompt as ComposedJudgePrompt);
    } catch (err) {
      transportDetected = err instanceof PromptSchemaError;
    }
    detections.push(['spawn (transport bytes differ from the rendered prompt)', transportDetected]);

    // D: a registration recorded after run-open — replay refuses, typed.
    let lateDetected = false;
    try {
      replayConvocationRecords(brokenTwins.lateRegistrationRows as ConvocationRecord[]);
    } catch (err) {
      lateDetected = err instanceof Error && err.constructor.name === 'LateRegistrationError';
    }
    detections.push(['queue (pre-registration recorded after its run opened)', lateDetected]);

    for (const [name, ok] of detections) {
      console.log(`NEGATIVE-CONTROL ${ok ? 'detected' : 'ABSORBED'}: ${name}`);
    }
    const allDetected = detections.every(([, ok]) => ok);
    console.log(allDetected
      ? 'NEGATIVE-CONTROL ok: all four planted breaks detected and named. Healthy exit is nonzero (3).'
      : 'NEGATIVE-CONTROL FAILURE: a planted break was ABSORBED — the harness cannot fail loudly.');
    process.exit(allDetected ? 3 : 1);
  }

  if (injectMode === 'corrupt-expected') {
    const pairSection = sections.find((s) => s.name === 'sweep-pairs');
    const detected = pairSection?.findings.some((f) => f.scenario === 'sel-fact-a/j1-grounding-v1' && f.field === 'pairKey') ?? false;
    console.log(detected
      ? 'FAILURE-INJECTION ok: in-memory corruption of an expected pairKey was detected and named.'
      : 'FAILURE-INJECTION FAILURE: corrupted expected value was ABSORBED — comparison machinery broken.');
    process.exit(detected ? 0 : 1);
  }

  console.log(`summary: ${sections.length} sections, ${failed.length} failed, exit ${failed.length === 0 ? 0 : 1}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`drill crashed: ${(err as Error).stack ?? err}`);
  process.exit(1);
});
