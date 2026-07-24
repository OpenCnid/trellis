/**
 * Judge-panel drill (zero-paid, zero-LLM, zero-infra).
 *
 * Specification: docs/product/epistemic-support/RECONCILIATION.md §3/§5
 * over FOUR_JUDGE_DESIGN.md §6–§7 (drills 1–3: panel-composition
 * oracle with the no-global-section section, blindness, judge-contest).
 * Entrypoint: `npm run test:judge-panel` (the non-test caller,
 * AMBIENT.md rule 15).
 *
 * Modes:
 *   default                      run sections; exit 0 iff all green
 *   --section <name>             run one section
 *   --results <path>             also write the bounded results JSON
 *   --negative-control           run all three drills against their
 *                                committed BROKEN fixtures; healthy
 *                                behavior is detection: exit 3 with
 *                                every break named. Exit 1 (absorbed)
 *                                means the harness is broken.
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
  ROLE_DEFINITIONS,
  COMPOSITION_ROLES,
  registryEntry,
  parseJudgeVerdict,
  parseJudgeManifest,
  JudgeManifestError,
  emptyRegistry,
  registerJudge,
  contestJudge,
  reRegisterJudge,
  assembleJudgeContext,
  BlindnessViolationError,
  composePanel,
  ContestedJudgeError,
  type JudgeRegistry,
  type PanelComposition,
  type PanelRole,
} from '../src/core/graph/judge_panel';
import { computeSupportOpinion, type SupportEvent, type SupportOpinion } from '../src/core/graph/support';
import { debiasedPreference, buildContestRequest, AuditProtocolError } from '../src/core/graph/judge_audit';

const FIXTURES = resolve(__dirname, '..', 'fixtures', 'judge_panel');
const TOL = 1e-9;

interface Finding { scenario: string; field: string; expected: string; observed: string }
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
    console.log(`[${name}] ${status} (${n} checks)` + (findings.length ? ` — ${findings.length} finding(s)` : ''));
    for (const f of findings) {
      console.log(`  MISMATCH ${f.scenario} field=${f.field} expected=${f.expected} observed=${f.observed}`);
    }
  } catch (err) {
    sections.push({ name, checks: 0, status: 'failed', findings: [] });
    console.log(`[${name}] failed — ${(err as Error).message}`);
  }
}

// ---------- load fixtures ----------
const judgesFile = readJson('judges.json');
const casesFile = readJson('cases.json');
const verdictsFile = readJson('verdicts.json');
const blindnessFile = readJson(negativeControl ? 'blindness_broken.json' : 'blindness.json');
const contestFile = readJson(negativeControl ? 'contest_broken.json' : 'contest.json');
const expectedFile = readJson(negativeControl ? 'expected_compositions_broken.json' : 'expected_compositions.json');

const asOfMs: number = expectedFile.asOfMs;
const params = expectedFile.params;

if (injectMode === 'corrupt-expected') {
  expectedFile.scenarios['happy-mixed'].opinion.b += 0.002;
}

type Scenario = { name: string; caseId: string; expect: string; verdicts: Array<Record<string, unknown>> };
const scenarios: Scenario[] = verdictsFile.scenarios;
const scenarioByName = new Map(scenarios.map((s) => [s.name, s]));

function freshRegistry(): JudgeRegistry {
  let registry = emptyRegistry();
  for (const m of judgesFile.manifests) registry = registerJudge(registry, m);
  return registry;
}

function runScenario(registry: JudgeRegistry, s: Scenario): PanelComposition {
  return composePanel(registry, casesFile.cases[s.caseId], s.verdicts, asOfMs, params);
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
function compareOpinion(scenario: string, expected: Record<string, number>, observed: SupportOpinion): Finding[] {
  const out: Finding[] = [];
  for (const field of ['b', 'd', 'u', 'projected'] as const) {
    if (Math.abs(expected[field] - observed[field]) > TOL) {
      out.push({ scenario, field, expected: String(expected[field]), observed: String(observed[field]) });
    }
  }
  return out;
}

function expectRefusal(
  findings: Finding[],
  scenario: string,
  errorName: string,
  fn: () => void
): void {
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

// ---------- sections ----------

section('manifest', () => ({ checks: manifestChecks, findings: [] }));

section('static-imports', () => {
  const banned = ['openai', 'axios', 'node-fetch', 'undici', 'http', 'https', 'pg', 'neo4j-driver', 'ioredis', 'bullmq'];
  const panelPath = resolve(__dirname, '..', 'src', 'core', 'graph', 'judge_panel.ts');
  const auditPath = resolve(__dirname, '..', 'src', 'core', 'graph', 'judge_audit.ts');
  const supportPath = resolve(__dirname, '..', 'src', 'core', 'graph', 'support.ts');
  let checks = 0;

  // Zero-paid pin, covering node:-prefixed builtins and bare global fetch.
  for (const f of [panelPath, auditPath, __filename]) {
    const text = readFileSync(f, 'utf8');
    for (const b of banned) {
      checks += 1;
      const re = new RegExp(`(from ['"](node:)?${b}['"])|(require\\(['"](node:)?${b}['"]\\))`);
      if (re.test(text)) throw new Error(`zero-paid violation: ${f} imports "${b}"`);
    }
    checks += 1;
    if (f !== __filename && /\bfetch\s*\(/.test(text)) {
      throw new Error(`zero-paid violation: ${f} calls global fetch`);
    }
  }

  // AB-9 isolation, both directions: the composition path (judge_panel
  // and its transitive relative imports) never imports the audit
  // module, and the audit module imports NO gating surface — in fact
  // no repository module at all.
  const specifiers = (text: string): string[] =>
    [...text.matchAll(/from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g)]
      .map((m) => m[1] ?? m[2]);
  checks += 1;
  for (const f of [panelPath, supportPath]) {
    for (const spec of specifiers(readFileSync(f, 'utf8'))) {
      if (spec.includes('judge_audit')) {
        throw new Error(`AB-9 violation: composition-path file ${f} imports the audit module ("${spec}")`);
      }
    }
  }
  checks += 1;
  for (const spec of specifiers(readFileSync(auditPath, 'utf8'))) {
    if (spec.startsWith('.')) {
      throw new Error(`AB-9 violation: audit module imports a repository module ("${spec}") — it must import no gating surface`);
    }
  }
  return { checks, findings: [] };
});

section('mapping', () => {
  const findings: Finding[] = [];
  let checks = 0;
  const roles = Object.keys(ROLE_DEFINITIONS) as PanelRole[];
  // The §1 drill-pinned property: cross-role qualified selections are
  // pairwise disjoint — what licenses cross-role composition.
  for (let i = 0; i < roles.length; i += 1) {
    for (let j = i + 1; j < roles.length; j += 1) {
      checks += 1;
      const a = ROLE_DEFINITIONS[roles[i]].qualifiedParameters;
      const b = ROLE_DEFINITIONS[roles[j]].qualifiedParameters;
      const shared = a.filter((p) => b.includes(p));
      if (shared.length > 0) {
        findings.push({ scenario: `${roles[i]}~${roles[j]}`, field: 'disjointness', expected: '[]', observed: shared.join(',') });
      }
    }
  }
  // Every taxonomy class maps into its own role's sparse selection.
  for (const role of roles) {
    const def = ROLE_DEFINITIONS[role];
    for (const [cls, param] of Object.entries(def.taxonomy)) {
      checks += 1;
      if (!def.qualifiedParameters.includes(param)) {
        findings.push({ scenario: role, field: cls, expected: 'parameter in selection', observed: param });
      }
    }
  }
  // The audit role is structurally outside the composition set.
  checks += 1;
  if (COMPOSITION_ROLES.includes('J4_AUDIT')) {
    findings.push({ scenario: 'COMPOSITION_ROLES', field: 'J4_AUDIT', expected: 'excluded', observed: 'included' });
  }
  // Registry-level kinship helper behaves.
  checks += 1;
  if (registryEntry('logical.falsification/cited') !== 'logical.falsification') {
    findings.push({ scenario: 'registryEntry', field: 'qualified-split', expected: 'logical.falsification', observed: registryEntry('logical.falsification/cited') });
  }
  return { checks, findings };
});

section('schema', () => {
  const findings: Finding[] = [];
  let checks = 0;
  for (const m of judgesFile.manifests) {
    checks += 1;
    parseJudgeManifest(m); // throws on wrongful refusal
  }
  for (const inv of judgesFile.invalid as Array<{ name: string; expectPath: string; manifest: unknown }>) {
    checks += 1;
    try {
      parseJudgeManifest(inv.manifest);
      findings.push({ scenario: inv.name, field: 'refusal', expected: `JudgeManifestError at ${inv.expectPath}`, observed: 'accepted' });
    } catch (err) {
      if (!(err instanceof JudgeManifestError) || !(err.message.includes(inv.expectPath))) {
        findings.push({ scenario: inv.name, field: 'refusal', expected: `JudgeManifestError at ${inv.expectPath}`, observed: (err as Error).message });
      }
    }
  }
  for (const inv of verdictsFile.invalidVerdicts as Array<{ name: string; verdict: unknown }>) {
    checks += 1;
    expectRefusal(findings, inv.name, 'JudgeVerdictSchemaError', () => parseJudgeVerdict(inv.verdict));
  }
  checks += 1;
  parseJudgeVerdict(scenarioByName.get('happy-mixed')!.verdicts[0]); // valid record parses
  return { checks, findings };
});

section('blindness', () => {
  const findings: Finding[] = [];
  let checks = 0;
  const allowed = blindnessFile.allowedContexts as Record<string, Record<string, unknown>>;
  for (const [role, context] of Object.entries(allowed)) {
    checks += 1;
    assembleJudgeContext(role as PanelRole, context); // allowed context assembles
  }
  for (const pair of blindnessFile.forbiddenPairs as Array<{ role: PanelRole; input: string }>) {
    checks += 1;
    const probe = { ...allowed[pair.role], [pair.input]: 'synthetic forbidden probe value' };
    try {
      assembleJudgeContext(pair.role, probe);
      findings.push({ scenario: pair.role, field: pair.input, expected: 'BlindnessViolationError before any model boundary', observed: 'context assembled — refusal MISSING' });
    } catch (err) {
      if (!(err instanceof BlindnessViolationError) || err.role !== pair.role || err.input !== pair.input) {
        findings.push({ scenario: pair.role, field: pair.input, expected: 'typed error naming role and input', observed: (err as Error).message });
      }
    }
  }
  for (const miss of blindnessFile.missingRequired as Array<{ role: PanelRole; omit: string }>) {
    checks += 1;
    const probe = { ...allowed[miss.role] };
    delete probe[miss.omit];
    expectRefusal(findings, `${miss.role}-missing-${miss.omit}`, 'ContextAssemblyError', () =>
      assembleJudgeContext(miss.role, probe));
  }
  return { checks, findings };
});

section('composition', () => {
  const findings: Finding[] = [];
  let checks = 0;
  const registry = freshRegistry();
  for (const [name, expected] of Object.entries(expectedFile.scenarios as Record<string, {
    opinion: Record<string, number> & { events: Record<string, number> };
    conflicts: Array<{ parameter: string; judgeIds: string[] }>;
    disagreements: Array<{ registryEntry: string; judgeIds: string[] }>;
    exclusions: Array<{ judgeId: string; assumption: string }>;
    counts: Record<string, number>;
  }>)) {
    const scenario = scenarioByName.get(name);
    if (!scenario) throw new Error(`expected oracle names unknown scenario "${name}"`);
    const result = runScenario(registry, scenario);
    checks += 4;
    findings.push(...compareOpinion(name, expected.opinion, result.opinion));
    checks += 1;
    for (const kind of ['clean', 'drawback', 'abstain'] as const) {
      if (expected.opinion.events[kind] !== result.opinion.events[kind]) {
        findings.push({ scenario: name, field: `events.${kind}`, expected: String(expected.opinion.events[kind]), observed: String(result.opinion.events[kind]) });
      }
    }
    checks += 3;
    for (const [kind, exp, obs] of [
      ['conflicts', expected.conflicts.length, result.conflicts.length],
      ['disagreements', expected.disagreements.length, result.disagreements.length],
      ['exclusions', expected.exclusions.length, result.exclusions.length],
    ] as Array<[string, number, number]>) {
      if (exp !== obs) findings.push({ scenario: name, field: kind, expected: String(exp), observed: String(obs) });
    }
    checks += 1;
    const countsExp = JSON.stringify(expected.counts);
    const countsObs = JSON.stringify(result.counts);
    if (countsExp !== countsObs) {
      findings.push({ scenario: name, field: 'counts', expected: countsExp, observed: countsObs });
    }
  }
  return { checks, findings };
});

section('gates', () => {
  const findings: Finding[] = [];
  let checks = 0;
  const registry = freshRegistry();
  const refusals: Array<[string, string]> = [
    ['refuse-excluded-verdict', 'CompositionRefusedError'],
    ['refuse-inapplicable-nonabstain', 'CompositionRefusedError'],
    ['refuse-all-jurisdiction', 'CompositionRefusedError'],
    ['refuse-mixed-belief', 'CompositionRefusedError'],
    ['refuse-unregistered', 'CompositionRefusedError'],
  ];
  for (const [name, errorName] of refusals) {
    checks += 1;
    expectRefusal(findings, name, errorName, () => runScenario(registry, scenarioByName.get(name)!));
  }
  // The exclusion record itself is typed and counted (compose scenario).
  checks += 1;
  const result = runScenario(registry, scenarioByName.get('exclusion')!);
  const exp = JSON.stringify([{ judgeId: 'judge-panel:j3a', assumption: 'independent_evidence_pool_available' }]);
  const obs = JSON.stringify(result.exclusions);
  if (exp !== obs) findings.push({ scenario: 'exclusion', field: 'exclusions', expected: exp, observed: obs });
  return { checks, findings };
});

section('no-global-section', () => {
  const findings: Finding[] = [];
  let checks = 0;
  const registry = freshRegistry();
  const scenario = scenarioByName.get('no-global-section')!;
  const result = runScenario(registry, scenario);
  const expected = expectedFile.scenarios['no-global-section'];

  checks += 1;
  if (result.conflicts.length !== 1 || result.conflicts[0].kind !== 'no_global_section') {
    findings.push({ scenario: 'no-global-section', field: 'conflict-record', expected: '1 typed no_global_section record', observed: JSON.stringify(result.conflicts) });
  } else {
    checks += 2;
    const c = result.conflicts[0];
    if (c.parameter !== 'logical.falsification/cited') {
      findings.push({ scenario: 'no-global-section', field: 'parameter', expected: 'logical.falsification/cited', observed: c.parameter });
    }
    const ids = c.judges.map((j) => j.judgeId).sort().join(',');
    if (ids !== 'judge-panel:j1a,judge-panel:j1b') {
      findings.push({ scenario: 'no-global-section', field: 'judges', expected: 'judge-panel:j1a,judge-panel:j1b', observed: ids });
    }
  }
  checks += 1;
  if (result.counts.verdictsWithheld !== 2) {
    findings.push({ scenario: 'no-global-section', field: 'withheld', expected: '2', observed: String(result.counts.verdictsWithheld) });
  }

  // u-dominance vs the silent blend, and never-the-blend: the composed
  // opinion must differ from the all-events counterfactual and carry
  // MORE uncertainty than it.
  const blendExpected = expected.blendCounterfactual as Record<string, number>;
  const allEvents: SupportEvent[] = (scenario.verdicts as Array<Record<string, unknown>>).map((v) => ({
    beliefId: v.beliefId as string,
    opId: v.judgeId as string,
    verdict: v.verdict as SupportEvent['verdict'],
    atMs: v.atMs as number,
    weight: v.weight as number,
  }));
  const blendObserved = computeSupportOpinion(allEvents, asOfMs, params);
  checks += 4;
  findings.push(...compareOpinion('blend-counterfactual', blendExpected, blendObserved));
  checks += 1;
  if (!(result.opinion.u > blendObserved.u + TOL)) {
    findings.push({ scenario: 'no-global-section', field: 'u-dominance', expected: `u > ${blendObserved.u}`, observed: String(result.opinion.u) });
  }
  checks += 1;
  if (canonicalOpinion(result.opinion) === canonicalOpinion(blendObserved)) {
    findings.push({ scenario: 'no-global-section', field: 'never-blend', expected: 'composed != blended', observed: 'composed == blended' });
  }
  return { checks, findings };
});

section('audit-isolation', () => {
  const findings: Finding[] = [];
  let checks = 0;
  const registry = freshRegistry();

  // A J4 verdict has no composition route (typed refusal).
  checks += 1;
  expectRefusal(findings, 'refuse-j4-verdict', 'AuditVerdictInCompositionError', () =>
    runScenario(registry, scenarioByName.get('refuse-j4-verdict')!));

  // Position-debias protocol: a preference counts only when both
  // orders agree on the same original record.
  for (const c of contestFile.debiasCases as Array<{ name: string; firstOrder: string; swappedOrder: string; expect: string }>) {
    checks += 1;
    const observed = debiasedPreference({ firstOrder: c.firstOrder, swappedOrder: c.swappedOrder } as Parameters<typeof debiasedPreference>[0]);
    if (observed !== c.expect) {
      findings.push({ scenario: c.name, field: 'debiasedPreference', expected: c.expect, observed });
    }
  }

  // A tie never contests.
  checks += 1;
  expectRefusal(findings, 'tie-finding', 'AuditProtocolError', () =>
    buildContestRequest(contestFile.tieFinding, contestFile.contestAtMs));

  // Route attempt: an audit finding that exists but is not applied to
  // the registry has zero effect on any opinion.
  checks += 1;
  const before = runScenario(registry, scenarioByName.get('happy-mixed')!);
  try {
    buildContestRequest(contestFile.finding, contestFile.contestAtMs);
  } catch {
    // In negative-control mode the broken finding refuses here; the
    // route-attempt identity below must hold either way.
  }
  const after = runScenario(registry, scenarioByName.get('happy-mixed')!);
  if (canonicalOpinion(before.opinion) !== canonicalOpinion(after.opinion)) {
    findings.push({ scenario: 'route-attempt', field: 'opinion', expected: 'byte-identical before/after audit finding', observed: 'changed' });
  }
  return { checks, findings };
});

section('judge-contest', () => {
  const findings: Finding[] = [];
  let checks = 0;
  let registry = freshRegistry();
  const happy = scenarioByName.get('happy-mixed')!;

  // Baseline composes.
  checks += 1;
  runScenario(registry, happy);

  // The scripted J4 finding contests the judge — via the mediator,
  // never via composition.
  checks += 1;
  let contested = false;
  try {
    const request = buildContestRequest(contestFile.finding, contestFile.contestAtMs);
    registry = contestJudge(registry, request.judgeId, request);
    contested = true;
  } catch (err) {
    findings.push({ scenario: 'contest', field: 'buildContestRequest', expected: 'contest applied', observed: (err as Error).message });
  }

  // Composition refuses the contested judge, naming it.
  checks += 1;
  let refusedAsExpected = false;
  try {
    runScenario(registry, happy);
  } catch (err) {
    refusedAsExpected = err instanceof ContestedJudgeError && err.judgeId === contestFile.finding.judgeId;
    if (!refusedAsExpected) {
      findings.push({ scenario: 'contest', field: 'refusal', expected: `ContestedJudgeError naming ${contestFile.finding.judgeId}`, observed: (err as Error).message });
    }
  }
  if (contested && !refusedAsExpected && findings.every((f) => f.field !== 'refusal')) {
    findings.push({ scenario: 'contest', field: 'refusal', expected: 'composition refused after contest', observed: 'composition succeeded — contest cycle BROKEN' });
  }
  if (!contested) {
    findings.push({ scenario: 'contest', field: 'cycle', expected: 'contested judge refused from composition', observed: 'judge never contested — contest cycle BROKEN' });
  }

  // Human re-registration restores composition; the superseded contest
  // record survives.
  if (contested) {
    checks += 1;
    registry = reRegisterJudge(registry, contestFile.finding.judgeId, contestFile.reRegistration);
    const restored = runScenario(registry, happy);
    const expected = expectedFile.scenarios['happy-mixed'].opinion as Record<string, number>;
    findings.push(...compareOpinion('post-recovery', expected, restored.opinion));
    checks += 1;
    const entry = registry.get(contestFile.finding.judgeId)!;
    if (entry.history.length !== 1 || entry.history[0].superseded !== true || entry.contested) {
      findings.push({ scenario: 'contest', field: 'history', expected: '1 superseded contest record, uncontested', observed: JSON.stringify({ contested: entry.contested, history: entry.history }) });
    }
  }
  return { checks, findings };
});

// ---------- verdict ----------
const failed = sections.filter((s) => s.status === 'failed');
const summary = { sectionsRun: sections.length, sectionsFailed: failed.length, exitCode: 0 };

if (injectMode === 'corrupt-expected') {
  const composition = sections.find((s) => s.name === 'composition');
  const detected = composition?.findings.some((f) => f.scenario === 'happy-mixed') ?? false;
  console.log(detected
    ? 'FAILURE-INJECTION ok: in-memory corruption of happy-mixed was detected and named.'
    : 'FAILURE-INJECTION FAILURE: corrupted expected value was ABSORBED — comparison machinery broken.');
  summary.exitCode = detected ? 0 : 1;
} else if (negativeControl) {
  const compositionDetected = sections.find((s) => s.name === 'composition')
    ?.findings.some((f) => f.scenario === 'happy-mixed' && f.field === 'b') ?? false;
  const blindnessDetected = sections.find((s) => s.name === 'blindness')
    ?.findings.some((f) => f.scenario === 'J2_COHERENCE' && f.field === 'claimKind') ?? false;
  const contestDetected = sections.find((s) => s.name === 'judge-contest')
    ?.findings.some((f) => f.observed.includes('contest cycle BROKEN')) ?? false;
  const detections: Array<[string, boolean]> = [
    ['composition (broken oracle: happy-mixed b)', compositionDetected],
    ['blindness (unrefusable pair: J2_COHERENCE/claimKind)', blindnessDetected],
    ['judge-contest (tie finding cannot contest)', contestDetected],
  ];
  for (const [name, ok] of detections) {
    console.log(`NEGATIVE-CONTROL ${ok ? 'detected' : 'ABSORBED'}: ${name}`);
  }
  const allDetected = detections.every(([, ok]) => ok);
  console.log(allDetected
    ? 'NEGATIVE-CONTROL ok: all three planted breaks detected and named. Healthy exit is nonzero (3).'
    : 'NEGATIVE-CONTROL FAILURE: a planted break was ABSORBED — the harness cannot fail loudly.');
  summary.exitCode = allDetected ? 3 : 1;
} else {
  summary.exitCode = failed.length === 0 ? 0 : 1;
}

console.log(`summary: ${sections.length} sections, ${failed.length} failed, exit ${summary.exitCode}`);
if (resultsPath) {
  writeFileSync(resolve(resultsPath), JSON.stringify({
    drill: 'judge-panel',
    fixtureManifestSha: sha256('manifest.json'),
    mode: injectMode ? 'inject' : negativeControl ? 'negative-control' : 'default',
    sections,
    summary,
  }, null, 2) + '\n');
  console.log(`results written to ${resolve(resultsPath)}`);
}
process.exit(summary.exitCode);
