/**
 * Judge-intake drill (zero-paid, zero-LLM, zero-infra).
 *
 * Specification: docs/product/epistemic-support/JUDGE_INTAKE_DESIGN.md
 * §6 (behavior → enforcement → pin; every row here is a section) and §7
 * (drill shape), in the test_judge_panel.ts mold.
 * Entrypoint: `npm run test:judge-intake` (the non-test caller,
 * AGENTS.md rule 15).
 *
 * Modes:
 *   default                      run sections; exit 0 iff all green
 *   --section <name>             run one section
 *   --results <path>             also write the bounded results JSON
 *   --negative-control           run against the committed BROKEN
 *                                fixture twins; healthy behavior is
 *                                detection: exit 3 with all three
 *                                planted breaks named (unratified
 *                                selection; smuggled expectation in a
 *                                composed prompt; registration after
 *                                run-open). Exit 1 (absorbed) means the
 *                                harness is broken.
 *   --inject corrupt-expected    corrupt one expected prompt in memory
 *                                post-load; PASS (exit 0) iff detected.
 *
 * Refusals (before any section): fixture manifest SHA mismatch (exit 2),
 * any TRELLIS_EXP_* variable set (exit 2).
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import {
  buildAddressSpace,
  buildSelection,
  buildRatificationRequest,
  buildCandidate,
  toPromptInput,
  isCarriedAddress,
  IntakeSchemaError,
  EmptySelectionError,
  LiteralTextRefusedError,
  AddressNotFoundError,
  UnratifiedSelectionError,
  type AddressSpace,
  type CandidateSelection,
  type PromotionCandidate,
} from '../src/core/graph/judge_intake';
import {
  composeJudgePrompt,
  renderPrompt,
  parseComposedPrompt,
  promptSectionSchema,
  PromptSchemaError,
  ClaimChannelError,
  type ComposedJudgePrompt,
} from '../src/core/graph/judge_intake_prompt';
import {
  emptyPreregStore,
  recordRatification,
  recordPreRegistration,
  openRun,
  getRatification,
  getPreRegistration,
  DuplicateRecordError,
  LateRegistrationError,
  PreregSchemaError,
  type PreregStore,
} from '../src/core/graph/judge_prereg';
import { BlindnessViolationError, ContextAssemblyError, type PanelRole } from '../src/core/graph/judge_panel';

const FIXTURES = resolve(__dirname, '..', 'fixtures', 'judge_intake');

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
const sha256File = (name: string) =>
  createHash('sha256').update(readFileSync(join(FIXTURES, name))).digest('hex');

// ---------- fixture integrity: a pre-flight refusal, not a section ----------
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
const addressSpaceFile = readJson('address_space.json');
const selectionsFile = readJson('selections.json');
const contextsFile = readJson('contexts.json');
const expectedIntake = readJson('expected_intake.json');
const storeFile = readJson(negativeControl ? 'store_records_broken.json' : 'store_records.json');
const expectedPromptsFile = readJson(negativeControl ? 'expected_prompts_broken.json' : 'expected_prompts.json');

if (injectMode === 'corrupt-expected') {
  expectedPromptsFile.scenarios['prompt-j2'].text += ' ';
}

type SelectionInput = { selectionId: string; addresses: string[]; selectedAtMs: number };
const selectionInputs = new Map<string, SelectionInput>(
  (selectionsFile.valid as SelectionInput[]).map((s) => [s.selectionId, s])
);

const space: AddressSpace = buildAddressSpace(addressSpaceFile.entries);

function buildStore(): PreregStore {
  let store = emptyPreregStore();
  for (const r of storeFile.ratifications) store = recordRatification(store, r);
  for (const p of storeFile.preRegistrations) store = recordPreRegistration(store, p);
  for (const o of storeFile.runOpens) store = openRun(store, o);
  return store;
}

function selectionFor(selectionId: string): CandidateSelection {
  const input = selectionInputs.get(selectionId);
  if (!input) throw new Error(`fixture names unknown selection "${selectionId}"`);
  return buildSelection(space, input);
}

function candidateFor(store: PreregStore, selectionId: string): PromotionCandidate {
  return buildCandidate(space, store, selectionFor(selectionId));
}

function composeScenario(store: PreregStore, name: string): ComposedJudgePrompt {
  const scenario = (contextsFile.promptScenarios as Array<Record<string, string>>).find((s) => s.name === name);
  if (!scenario) throw new Error(`unknown prompt scenario "${name}"`);
  const candidate = candidateFor(store, scenario.selectionId);
  const provided = contextsFile.provided[scenario.contextKey] as Record<string, unknown>;
  return composeJudgePrompt(scenario.role as PanelRole, scenario.judgeId, toPromptInput(candidate), provided);
}

function expectRefusal(findings: Finding[], scenario: string, errorName: string, fn: () => void): void {
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

const canon = (value: unknown): string => JSON.stringify(value);

// ---------- sections ----------

section('manifest', () => ({ checks: manifestChecks, findings: [] }));

section('static-imports', () => {
  const banned = ['openai', 'axios', 'node-fetch', 'undici', 'http', 'https', 'pg', 'neo4j-driver', 'ioredis', 'bullmq'];
  const graphDir = resolve(__dirname, '..', 'src', 'core', 'graph');
  const intakePath = join(graphDir, 'judge_intake.ts');
  const promptPath = join(graphDir, 'judge_intake_prompt.ts');
  const preregPath = join(graphDir, 'judge_prereg.ts');
  const panelPath = join(graphDir, 'judge_panel.ts');
  const auditPath = join(graphDir, 'judge_audit.ts');
  const supportPath = join(graphDir, 'support.ts');
  let checks = 0;

  // Zero-paid pin, covering node:-prefixed builtins and bare global fetch.
  for (const f of [intakePath, promptPath, preregPath, __filename]) {
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

  const specifiers = (text: string): string[] =>
    [...text.matchAll(/from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g)]
      .map((m) => m[1] ?? m[2]);
  const relative = (path: string): string[] =>
    specifiers(readFileSync(path, 'utf8')).filter((s) => s.startsWith('.'));

  // Rule 11: the store imports NO repository module, and the prompt
  // module imports nothing from the store — forecasts and prompts
  // share no bytes in either direction.
  checks += 1;
  for (const spec of relative(preregPath)) {
    throw new Error(`rule-11 violation: judge_prereg imports a repository module ("${spec}")`);
  }
  checks += 1;
  for (const spec of relative(promptPath)) {
    if (spec !== './judge_panel') {
      throw new Error(`one-way-import violation: judge_intake_prompt imports "${spec}" (only ./judge_panel is admissible)`);
    }
  }

  // Intake sits at the top of the one-way chain.
  checks += 1;
  const intakeAllowed = new Set(['./judge_panel', './judge_intake_prompt', './judge_prereg']);
  for (const spec of relative(intakePath)) {
    if (!intakeAllowed.has(spec)) {
      throw new Error(`one-way-import violation: judge_intake imports "${spec}"`);
    }
  }

  // Nothing imports back: the panel and its arithmetic never see the
  // new modules, and the audit seat gains no path into composition.
  checks += 1;
  for (const f of [panelPath, supportPath]) {
    for (const spec of specifiers(readFileSync(f, 'utf8'))) {
      if (spec.includes('judge_intake') || spec.includes('judge_prereg')) {
        throw new Error(`one-way-import violation: composition-path file ${f} imports "${spec}"`);
      }
    }
  }
  checks += 1;
  for (const spec of relative(auditPath)) {
    if (spec !== './judge_prereg') {
      throw new Error(`AB-9 violation: judge_audit imports "${spec}" — the store is its only admissible read`);
    }
  }

  // The expectation surface is unreachable from composition: intake
  // reads ratifications only.
  checks += 1;
  if (/PreRegistration|getPreRegistration|Expectation/.test(readFileSync(intakePath, 'utf8'))) {
    throw new Error('rule-11 violation: judge_intake references the pre-registration surface');
  }
  return { checks, findings: [] };
});

section('engine-copy', () => {
  const findings: Finding[] = [];
  let checks = 0;
  const store = buildStore();

  // A selection carrying literal text (or any non-address) refuses —
  // the model has no channel through which to supply claim bytes.
  for (const refusal of selectionsFile.refusals as Array<{ name: string; expect: string; selection: unknown }>) {
    checks += 1;
    expectRefusal(findings, refusal.name, refusal.expect, () => buildSelection(space, refusal.selection));
  }

  // The address families are a closed set.
  checks += 2;
  if (!isCarriedAddress('aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaa1') || isCarriedAddress('sel-primary')) {
    findings.push({ scenario: 'address-shapes', field: 'isCarriedAddress', expected: 'uuid/64-hex only', observed: 'misclassified' });
  }

  // Candidate claims are engine-copied bytes at the address.
  for (const id of ['sel-primary', 'sel-decomp-2', 'sel-multi']) {
    checks += 1;
    try {
      const candidate = candidateFor(store, id);
      const expected = expectedIntake.candidates[id];
      if (canon(candidate.claims) !== canon(expected.claims)) {
        findings.push({ scenario: id, field: 'claims', expected: canon(expected.claims), observed: canon(candidate.claims) });
      }
    } catch (err) {
      findings.push({ scenario: id, field: 'claims', expected: 'engine-copied claims', observed: `${(err as Error).constructor.name}: ${(err as Error).message}` });
    }
  }

  // A malformed address space refuses before anything can select from it.
  for (const invalid of addressSpaceFile.invalidEntries as Array<{ name: string; entry: unknown }>) {
    checks += 1;
    expectRefusal(findings, invalid.name, 'IntakeSchemaError', () =>
      buildAddressSpace([...addressSpaceFile.entries, invalid.entry]));
  }
  return { checks, findings };
});

section('ratification-gate', () => {
  const findings: Finding[] = [];
  let checks = 0;
  const store = buildStore();

  // No recorded ratification, no candidate — typed.
  checks += 1;
  expectRefusal(findings, 'sel-unratified', 'UnratifiedSelectionError', () => candidateFor(store, 'sel-unratified'));

  // A recorded ratification admits the candidate (in negative-control
  // mode the broken store lacks it — the gate must be seen refusing).
  checks += 1;
  try {
    const candidate = candidateFor(store, 'sel-primary');
    const expected = expectedIntake.candidates['sel-primary'];
    if (candidate.claimMode !== expected.claimMode || candidate.ratifiedAtMs !== expected.ratifiedAtMs) {
      findings.push({ scenario: 'sel-primary', field: 'candidate', expected: canon({ claimMode: expected.claimMode, ratifiedAtMs: expected.ratifiedAtMs }), observed: canon({ claimMode: candidate.claimMode, ratifiedAtMs: candidate.ratifiedAtMs }) });
    }
  } catch (err) {
    findings.push({ scenario: 'sel-primary', field: 'candidate', expected: 'candidate builds through the recorded ratification', observed: `${(err as Error).constructor.name}: ${(err as Error).message}` });
  }
  return { checks, findings };
});

section('selection-context', () => {
  const findings: Finding[] = [];
  let checks = 0;

  // Engine-computed neighbor context, byte-compared against the
  // independent oracle's re-derivation of container/ordinal adjacency.
  for (const [id, expected] of Object.entries(expectedIntake.ratificationRequests as Record<string, unknown>)) {
    checks += 1;
    const observed = buildRatificationRequest(space, selectionFor(id));
    if (canon(observed) !== canon(expected)) {
      findings.push({ scenario: id, field: 'ratification-request', expected: canon(expected), observed: canon(observed) });
    }
  }

  // Rule 17 stated plainly: the qualifier the sel-primary cut excludes
  // is visible as neighborBefore in the approval payload.
  checks += 1;
  const request = buildRatificationRequest(space, selectionFor('sel-primary'));
  const qualifier = 'Only while the cited corpus stays available:';
  if (request.items[0]?.neighborBefore !== qualifier) {
    findings.push({ scenario: 'sel-primary', field: 'excluded-qualifier', expected: qualifier, observed: String(request.items[0]?.neighborBefore) });
  }

  // Container boundaries are honest nulls, never padding.
  checks += 2;
  const first = buildRatificationRequest(space, selectionFor('sel-decomp-1'));
  const last = buildRatificationRequest(space, selectionFor('sel-decomp-2'));
  if (first.items[0]?.neighborBefore !== null) {
    findings.push({ scenario: 'sel-decomp-1', field: 'boundary-before', expected: 'null', observed: String(first.items[0]?.neighborBefore) });
  }
  if (last.items[0]?.neighborAfter !== null) {
    findings.push({ scenario: 'sel-decomp-2', field: 'boundary-after', expected: 'null', observed: String(last.items[0]?.neighborAfter) });
  }
  return { checks, findings };
});

section('mode-provenance', () => {
  const findings: Finding[] = [];
  let checks = 0;
  const store = buildStore();

  // The candidate's mode is the ratified mode — read, never supplied.
  for (const [id, mode] of [['sel-primary', 'fact'], ['sel-decomp-1', 'belief'], ['sel-multi', 'inference']] as Array<[string, string]>) {
    checks += 1;
    try {
      const candidate = candidateFor(store, id);
      if (candidate.claimMode !== mode || getRatification(store, id)?.claimMode !== mode) {
        findings.push({ scenario: id, field: 'claimMode', expected: mode, observed: candidate.claimMode });
      }
    } catch (err) {
      findings.push({ scenario: id, field: 'claimMode', expected: mode, observed: `${(err as Error).constructor.name}` });
    }
  }

  // No parameter exists through which an agent could hand the gate a
  // mode: buildCandidate takes space, store, selection — nothing else.
  checks += 1;
  const intakeSource = readFileSync(resolve(__dirname, '..', 'src', 'core', 'graph', 'judge_intake.ts'), 'utf8');
  const declaration = intakeSource.match(/export function buildCandidate\(([^)]*)\)/s);
  if (!declaration || /claimMode|mode/i.test(declaration[1])) {
    findings.push({ scenario: 'buildCandidate', field: 'signature', expected: '(space, store, selection) with no mode parameter', observed: declaration ? declaration[1].replace(/\s+/g, ' ') : 'declaration not found' });
  }

  // A ratification without a mode is malformed at the boundary.
  checks += 1;
  expectRefusal(findings, 'modeless-ratification', 'PreregSchemaError', () =>
    recordRatification(emptyPreregStore(), { selectionId: 'sel-x', confirmedAtMs: 1 }));
  return { checks, findings };
});

section('decomposition', () => {
  const findings: Finding[] = [];
  let checks = 0;
  const store = buildStore();

  // A compound claim is several selections, each ratified with its own
  // mode — no sub-claim authoring surface exists anywhere in intake.
  checks += 1;
  try {
    const part1 = candidateFor(store, 'sel-decomp-1');
    const part2 = candidateFor(store, 'sel-decomp-2');
    if (part1.claimMode !== 'belief' || part2.claimMode !== 'fact') {
      findings.push({ scenario: 'decomp-pair', field: 'independent-modes', expected: 'belief/fact', observed: `${part1.claimMode}/${part2.claimMode}` });
    }
  } catch (err) {
    findings.push({ scenario: 'decomp-pair', field: 'independent-modes', expected: 'both candidates build', observed: `${(err as Error).constructor.name}` });
  }

  // One selection, one mode: a second ratification refuses and the
  // first survives.
  checks += 2;
  expectRefusal(findings, 'second-mode', 'DuplicateRecordError', () =>
    recordRatification(store, { selectionId: 'sel-decomp-1', claimMode: 'fact', confirmedAtMs: 1752801000098 }));
  if (getRatification(store, 'sel-decomp-1')?.claimMode !== 'belief') {
    findings.push({ scenario: 'second-mode', field: 'first-survives', expected: 'belief', observed: String(getRatification(store, 'sel-decomp-1')?.claimMode) });
  }
  return { checks, findings };
});

section('attribution-partition', () => {
  const findings: Finding[] = [];
  let checks = 0;
  const store = buildStore();

  // Two users, one workspace, byte-identical claims under distinct
  // address partitions: the composed prompts must be BYTE-IDENTICAL.
  checks += 2;
  try {
    const userA = composeScenario(store, 'prompt-j1-user-a');
    const userB = composeScenario(store, 'prompt-j1-user-b');
    if (renderPrompt(userA) !== renderPrompt(userB)) {
      findings.push({ scenario: 'identical-claims', field: 'bytes', expected: 'byte-identical prompts across partitions', observed: 'prompts differ — attribution reaches content' });
    }
    if (userA.promptHash !== userB.promptHash) {
      findings.push({ scenario: 'identical-claims', field: 'promptHash', expected: userA.promptHash, observed: userB.promptHash });
    }

    // The semantically matched re-wording differs ONLY in claim content.
    checks += 3;
    const userB2 = composeScenario(store, 'prompt-j1-user-b2');
    const nonEvidence = (p: ComposedJudgePrompt) => canon(p.sections.filter((s) => s.kind !== 'evidence'));
    if (nonEvidence(userA) !== nonEvidence(userB2)) {
      findings.push({ scenario: 'matched-claims', field: 'non-evidence-sections', expected: 'identical', observed: 'differ' });
    }
    const evidenceOf = (p: ComposedJudgePrompt) =>
      (p.sections.find((s) => s.kind === 'evidence') as { context: Record<string, unknown> }).context;
    const ctxA = evidenceOf(userA);
    const ctxB2 = evidenceOf(userB2);
    if (canon(Object.keys(ctxA).sort()) !== canon(Object.keys(ctxB2).sort())) {
      findings.push({ scenario: 'matched-claims', field: 'context-keys', expected: canon(Object.keys(ctxA).sort()), observed: canon(Object.keys(ctxB2).sort()) });
    }
    for (const key of Object.keys(ctxA)) {
      const same = canon(ctxA[key]) === canon(ctxB2[key]);
      if (key === 'claim' ? same : !same) {
        findings.push({ scenario: 'matched-claims', field: `context.${key}`, expected: key === 'claim' ? 'differs' : 'identical', observed: same ? 'identical' : 'differs' });
      }
    }
  } catch (err) {
    findings.push({ scenario: 'partition-pair', field: 'composition', expected: 'prompts compose', observed: `${(err as Error).constructor.name}: ${(err as Error).message}` });
  }

  // No address component — address, partition, container — reaches any
  // rendered prompt. Failing here names the leaking token.
  const addresses = (addressSpaceFile.entries as Array<{ address: string }>).map((e) => e.address);
  const tokens = [...addresses, ...(contextsFile.attributionTokens as string[])];
  for (const scenario of (contextsFile.promptScenarios as Array<{ name: string }>)) {
    checks += 1;
    try {
      const rendered = renderPrompt(composeScenario(store, scenario.name));
      for (const token of tokens) {
        if (rendered.includes(token)) {
          findings.push({ scenario: scenario.name, field: 'address-leak', expected: `no "${token}" in prompt bytes`, observed: 'token present' });
        }
      }
    } catch {
      // Composition failures are already findings in their own sections.
    }
  }
  return { checks, findings };
});

section('prompt-absence', () => {
  const findings: Finding[] = [];
  let checks = 0;
  const store = buildStore();

  // The closed union has no task-text member — kind "task" does not parse.
  checks += 1;
  const taskProbe = promptSectionSchema.safeParse({ kind: 'task', text: 'find the drawback we expect' });
  if (taskProbe.success) {
    findings.push({ scenario: 'task-kind', field: 'refusal', expected: 'unparseable', observed: 'parsed — a task-text channel EXISTS' });
  }

  // Strict sections: no extra field can smuggle instruction content.
  checks += 1;
  const extraProbe = promptSectionSchema.safeParse({ kind: 'identity', role: 'J1_GROUNDING', judgeId: 'j', focus: 'look for unsupported_citation' });
  if (extraProbe.success) {
    findings.push({ scenario: 'extra-field', field: 'refusal', expected: 'unparseable', observed: 'parsed — a side channel EXISTS' });
  }

  // The source declares exactly the four section kinds.
  checks += 1;
  const promptSource = readFileSync(resolve(__dirname, '..', 'src', 'core', 'graph', 'judge_intake_prompt.ts'), 'utf8');
  const kinds = [...promptSource.matchAll(/kind:\s*z\.literal\('([a-z_]+)'\)/g)].map((m) => m[1]).sort();
  if (canon(kinds) !== canon(['definition', 'evidence', 'identity', 'output_schema'])) {
    findings.push({ scenario: 'section-kinds', field: 'closed-union', expected: 'definition,evidence,identity,output_schema', observed: kinds.join(',') });
  }

  // A composed prompt with a repeated or missing section refuses — the
  // section list is a fixed shape, not a container.
  try {
    const composed = composeScenario(store, 'prompt-j3');
    checks += 2;
    expectRefusal(findings, 'repeated-evidence', 'PromptSchemaError', () =>
      parseComposedPrompt({ ...composed, sections: [...composed.sections, composed.sections[2]] }));
    expectRefusal(findings, 'missing-output-schema', 'PromptSchemaError', () =>
      parseComposedPrompt({ ...composed, sections: composed.sections.slice(0, 3) }));

    // No rendered prompt contains a task-shaped opening.
    checks += 1;
    if (/<task/.test(renderPrompt(composed))) {
      findings.push({ scenario: 'prompt-j3', field: 'task-bytes', expected: 'no <task element', observed: 'present' });
    }
  } catch (err) {
    findings.push({ scenario: 'prompt-j3', field: 'composition', expected: 'composes', observed: `${(err as Error).constructor.name}` });
  }

  // The candidate input is strict: an address or task field refuses.
  checks += 2;
  for (const [name, extra] of [['address-field', { address: 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaa2' }], ['task-field', { taskText: 'confirm the expected drawback' }]] as Array<[string, Record<string, unknown>]>) {
    try {
      composeJudgePrompt('J1_GROUNDING', 'judge-intake:j1', { selectionId: 's', claimMode: 'fact', claimContent: ['x'], ...extra }, contextsFile.provided.j1);
      findings.push({ scenario: name, field: 'refusal', expected: 'PromptSchemaError', observed: 'accepted' });
    } catch (err) {
      if (!(err instanceof PromptSchemaError)) {
        findings.push({ scenario: name, field: 'refusal', expected: 'PromptSchemaError', observed: `${(err as Error).constructor.name}` });
      }
    }
  }
  return { checks, findings };
});

section('prompt-bytes', () => {
  const findings: Finding[] = [];
  let checks = 0;
  const store = buildStore();

  for (const [name, expected] of Object.entries(expectedPromptsFile.scenarios as Record<string, { text: string; promptHash: string }>)) {
    checks += 2;
    try {
      const composed = composeScenario(store, name);
      const rendered = renderPrompt(composed);
      if (rendered !== expected.text) {
        findings.push({ scenario: name, field: 'bytes', expected: `${expected.text.length} pinned bytes`, observed: 'rendered bytes differ from the pinned oracle' });
      }
      if (composed.promptHash !== expected.promptHash) {
        findings.push({ scenario: name, field: 'promptHash', expected: expected.promptHash, observed: composed.promptHash });
      }
    } catch (err) {
      findings.push({ scenario: name, field: 'bytes', expected: 'prompt composes and renders', observed: `${(err as Error).constructor.name}: ${(err as Error).message}` });
    }
  }

  // Determinism and round-trip: compose twice, byte-identical; a
  // tampered section fails the hash re-check, typed.
  try {
    const once = composeScenario(store, 'prompt-j3');
    const twice = composeScenario(store, 'prompt-j3');
    checks += 2;
    if (renderPrompt(once) !== renderPrompt(twice) || once.promptHash !== twice.promptHash) {
      findings.push({ scenario: 'determinism', field: 'bytes', expected: 'identical across composes', observed: 'nondeterministic render' });
    }
    parseComposedPrompt(once); // round-trips
    checks += 1;
    const tampered = {
      ...once,
      sections: once.sections.map((s) => (s.kind === 'identity' ? { ...s, judgeId: 'judge-intake:other' } : s)),
    };
    expectRefusal(findings, 'tampered-sections', 'PromptSchemaError', () => parseComposedPrompt(tampered));
  } catch (err) {
    findings.push({ scenario: 'determinism', field: 'composition', expected: 'composes', observed: `${(err as Error).constructor.name}` });
  }
  return { checks, findings };
});

section('blindness-preserved', () => {
  const findings: Finding[] = [];
  let checks = 0;
  const store = buildStore();
  const roleContext: Record<string, string> = { J1_GROUNDING: 'j1', J2_COHERENCE: 'j2', J3_CORROBORATION: 'j3' };
  const promptInput = expectedIntake.candidates['sel-worded-b'].promptInput;

  // A forbidden key — including address, partition, and user-id probes,
  // and J3's anti-circularity citedBytes — refuses through the NEW
  // path, typed, naming role and input, before any model boundary.
  for (const probe of contextsFile.forbiddenProbes as Array<{ role: PanelRole; input: string }>) {
    checks += 1;
    const provided = { ...(contextsFile.provided[roleContext[probe.role]] as Record<string, unknown>), [probe.input]: 'synthetic forbidden probe value' };
    try {
      composeJudgePrompt(probe.role, 'judge-intake:probe', promptInput, provided);
      findings.push({ scenario: probe.role, field: probe.input, expected: 'BlindnessViolationError before any model boundary', observed: 'prompt composed — refusal MISSING' });
    } catch (err) {
      if (!(err instanceof BlindnessViolationError) || err.role !== probe.role || err.input !== probe.input) {
        findings.push({ scenario: probe.role, field: probe.input, expected: 'typed error naming role and input', observed: (err as Error).message });
      }
    }
  }

  // The claim channel is the engine's alone.
  checks += 1;
  expectRefusal(findings, 'caller-claim', 'ClaimChannelError', () =>
    composeJudgePrompt('J1_GROUNDING', 'judge-intake:j1', promptInput, { ...contextsFile.provided.j1, claim: 'a retyped claim' }));

  // Missing required evidence fails closed.
  checks += 1;
  expectRefusal(findings, 'missing-citedBytes', 'ContextAssemblyError', () =>
    composeJudgePrompt('J1_GROUNDING', 'judge-intake:j1', promptInput, {}));

  // The audit role has no claim channel at all: composing a candidate
  // prompt for J4 refuses through the same blindness mechanism.
  checks += 1;
  try {
    composeJudgePrompt('J4_AUDIT', 'judge-intake:j4', promptInput, {});
    findings.push({ scenario: 'J4_AUDIT', field: 'claim', expected: 'BlindnessViolationError', observed: 'prompt composed — J4 received a claim' });
  } catch (err) {
    if (!(err instanceof BlindnessViolationError) || err.input !== 'claim') {
      findings.push({ scenario: 'J4_AUDIT', field: 'claim', expected: 'BlindnessViolationError naming "claim"', observed: (err as Error).message });
    }
  }
  return { checks, findings };
});

section('write-once', () => {
  const findings: Finding[] = [];
  let checks = 0;
  const store = buildStore();

  // Every invalid record draws its named typed refusal.
  for (const invalid of storeFile.invalidRecords as Array<{ name: string; kind: string; expect: string; record: unknown }>) {
    checks += 1;
    const apply = () => {
      if (invalid.kind === 'ratification') recordRatification(store, invalid.record);
      else if (invalid.kind === 'runOpen') openRun(store, invalid.record);
      else recordPreRegistration(store, invalid.record);
    };
    expectRefusal(findings, invalid.name, invalid.expect, apply);
  }

  // The first record survives every refused overwrite.
  checks += 1;
  if (getRatification(store, 'sel-twin-b')?.claimMode !== 'fact') {
    findings.push({ scenario: 'first-survives', field: 'ratification', expected: 'fact', observed: String(getRatification(store, 'sel-twin-b')?.claimMode) });
  }

  // Supersession is a reference, not an overwrite: both records live.
  checks += 2;
  const prereg1 = getPreRegistration(store, 'prereg-1');
  const prereg2 = getPreRegistration(store, 'prereg-2');
  if (!prereg1 || !prereg2 || prereg2.supersedes !== 'prereg-1') {
    findings.push({ scenario: 'supersession', field: 'reference', expected: 'both records present, prereg-2 references prereg-1', observed: canon({ prereg1: !!prereg1, prereg2: !!prereg2 }) });
  }

  // contentHash is engine-computed and matches the independent oracle.
  for (const [id, expectedHash] of Object.entries(expectedIntake.preregContentHashes as Record<string, string>)) {
    checks += 1;
    const observed = getPreRegistration(store, id)?.contentHash;
    if (observed !== expectedHash) {
      findings.push({ scenario: id, field: 'contentHash', expected: expectedHash, observed: String(observed) });
    }
  }
  return { checks, findings };
});

section('prereg-late', () => {
  const findings: Finding[] = [];
  let checks = 0;
  const store = buildStore();

  // Registrations before run-open recorded; the late attempt refuses,
  // typed (rule 20). In negative-control mode the broken twin routes
  // the attempt at a never-opened run — recording it is the planted
  // rule-20 hole the drill must name.
  checks += 1;
  try {
    recordPreRegistration(store, storeFile.lateAttempt);
    findings.push({ scenario: 'late-registration', field: 'refusal', expected: 'LateRegistrationError', observed: 'recorded without refusal' });
  } catch (err) {
    if (!(err instanceof LateRegistrationError)) {
      findings.push({ scenario: 'late-registration', field: 'refusal', expected: 'LateRegistrationError', observed: `${(err as Error).constructor.name}: ${(err as Error).message}` });
    }
  }

  // The pre-open forecasts are in the store (a forecast made before the
  // run is exactly what the store exists to preserve).
  checks += 1;
  if (!getPreRegistration(store, 'prereg-1')) {
    findings.push({ scenario: 'pre-open', field: 'recorded', expected: 'prereg-1 present', observed: 'absent' });
  }
  return { checks, findings };
});

// ---------- verdict ----------
const failed = sections.filter((s) => s.status === 'failed');
const summary = { sectionsRun: sections.length, sectionsFailed: failed.length, exitCode: 0 };

if (injectMode === 'corrupt-expected') {
  const promptBytes = sections.find((s) => s.name === 'prompt-bytes');
  const detected = promptBytes?.findings.some((f) => f.scenario === 'prompt-j2' && f.field === 'bytes') ?? false;
  console.log(detected
    ? 'FAILURE-INJECTION ok: in-memory corruption of prompt-j2 was detected and named.'
    : 'FAILURE-INJECTION FAILURE: corrupted expected prompt was ABSORBED — comparison machinery broken.');
  summary.exitCode = detected ? 0 : 1;
} else if (negativeControl) {
  const gateDetected = sections.find((s) => s.name === 'ratification-gate')
    ?.findings.some((f) => f.scenario === 'sel-primary' && f.observed.includes('UnratifiedSelectionError')) ?? false;
  const smuggleDetected = sections.find((s) => s.name === 'prompt-bytes')
    ?.findings.some((f) => f.scenario === 'prompt-j3' && f.field === 'bytes') ?? false;
  const lateDetected = sections.find((s) => s.name === 'prereg-late')
    ?.findings.some((f) => f.scenario === 'late-registration' && f.observed === 'recorded without refusal') ?? false;
  const detections: Array<[string, boolean]> = [
    ['ratification-gate (candidate built from an unratified selection)', gateDetected],
    ['prompt-bytes (smuggled expectation in a composed prompt)', smuggleDetected],
    ['prereg-late (registration recorded after run-open)', lateDetected],
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
    drill: 'judge-intake',
    fixtureManifestSha: sha256File('manifest.json'),
    mode: injectMode ? 'inject' : negativeControl ? 'negative-control' : 'default',
    sections,
    summary,
  }, null, 2) + '\n');
  console.log(`results written to ${resolve(resultsPath)}`);
}
process.exit(summary.exitCode);
