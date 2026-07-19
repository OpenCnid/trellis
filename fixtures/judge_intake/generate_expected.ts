/**
 * Independent oracle generator for the judge-intake drill.
 *
 * REVIEW CRITERION (the ORACLE_DRILL_PROPOSAL §16 rule, the judge-panel
 * mold): this file re-derives intake semantics from the SPECIFICATION —
 * docs/product/epistemic-support/JUDGE_INTAKE_DESIGN.md §3.1 (selection,
 * engine-side byte fetch, container/ordinal neighbor adjacency), §3.2
 * and its §3.2a render grammar (composed prompts, allowlisted evidence,
 * canonical JSON), §3.3 (canonical expectation bytes for contentHash),
 * with role allowlists re-declared from RECONCILIATION.md §2 — and must
 * never import from src/core/graph/*. A shared helper would let one bug
 * agree with itself. Run manually (never by the drill) when the
 * specification changes, in the same commit that re-pins:
 *
 *   npx tsx fixtures/judge_intake/generate_expected.ts
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const DIR = __dirname;

// --- Role data re-declared from RECONCILIATION §2 (deliberately not imported) ---

interface RoleData {
  claimModes: string[];
  params: string[];
  taxonomy: Record<string, string>;
  requiredAssumptions: string[];
  required: string[];
  optional: string[];
}

const ROLES: Record<string, RoleData> = {
  J1_GROUNDING: {
    claimModes: ['fact', 'inference'],
    params: ['logical.evidence_quality/cited', 'logical.falsification/cited'],
    taxonomy: {
      unsupported_citation: 'logical.evidence_quality/cited',
      overclaimed_evidence: 'logical.evidence_quality/cited',
      contradicted_by_cited_bytes: 'logical.falsification/cited',
    },
    requiredAssumptions: ['cited_bytes_available'],
    required: ['claim', 'citedBytes'],
    optional: [],
  },
  J2_COHERENCE: {
    claimModes: ['fact', 'inference', 'prediction', 'belief'],
    params: ['logical.consistency/internal', 'logical.consistency/history', 'logical.constraint_satisfaction/kind'],
    taxonomy: {
      self_contradictory: 'logical.consistency/internal',
      history_inconsistent: 'logical.consistency/history',
      kind_incoherent: 'logical.constraint_satisfaction/kind',
    },
    requiredAssumptions: ['history_available'],
    required: ['claim', 'history'],
    optional: ['claimKind'],
  },
  J3_CORROBORATION: {
    claimModes: ['fact', 'inference', 'prediction'],
    params: [
      'logical.induction/world',
      'logical.falsification/independent',
      'logical.source_dependence/independent',
      'sensorial.observation_quality/independent',
    ],
    taxonomy: {
      uncorroborated: 'logical.induction/world',
      authority_contradicted: 'logical.falsification/independent',
      corroboration_ambiguous: 'sensorial.observation_quality/independent',
    },
    requiredAssumptions: ['independent_evidence_pool_available'],
    required: ['claim', 'independentEvidence'],
    optional: ['authorityWeights'],
  },
};

// --- Fixture inputs ---

const addressSpaceFile = JSON.parse(readFileSync(join(DIR, 'address_space.json'), 'utf8'));
const selectionsFile = JSON.parse(readFileSync(join(DIR, 'selections.json'), 'utf8'));
const storeFile = JSON.parse(readFileSync(join(DIR, 'store_records.json'), 'utf8'));
const contextsFile = JSON.parse(readFileSync(join(DIR, 'contexts.json'), 'utf8'));

interface Entry {
  address: string;
  containerId: string;
  ordinal: number;
  content: string;
  partition?: string;
}

const entries: Entry[] = addressSpaceFile.entries;
const byAddress = new Map(entries.map((e) => [e.address, e]));

function entryAt(address: string): Entry {
  const e = byAddress.get(address);
  if (!e) throw new Error(`fixture names unknown address ${address}`);
  return e;
}

function neighborContent(entry: Entry, offset: -1 | 1): string | null {
  for (const candidate of entries) {
    if (candidate.containerId === entry.containerId && candidate.ordinal === entry.ordinal + offset) {
      return candidate.content;
    }
  }
  return null;
}

interface Selection {
  selectionId: string;
  addresses: string[];
  selectedAtMs: number;
}

const selections = new Map<string, Selection>(
  (selectionsFile.valid as Selection[]).map((s) => [s.selectionId, s])
);

const ratifications = new Map<string, { selectionId: string; claimMode: string; confirmedAtMs: number }>(
  (storeFile.ratifications as Array<{ selectionId: string; claimMode: string; confirmedAtMs: number }>).map(
    (r) => [r.selectionId, r]
  )
);

// --- Intake semantics re-derived from JUDGE_INTAKE_DESIGN §3.1 ---

function ratificationRequestFor(selectionId: string) {
  const s = selections.get(selectionId);
  if (!s) throw new Error(`unknown selection ${selectionId}`);
  return {
    selectionId: s.selectionId,
    selectedAtMs: s.selectedAtMs,
    items: s.addresses.map((address) => {
      const e = entryAt(address);
      return {
        address,
        content: e.content,
        neighborBefore: neighborContent(e, -1),
        neighborAfter: neighborContent(e, 1),
      };
    }),
  };
}

function candidateFor(selectionId: string) {
  const s = selections.get(selectionId);
  const r = ratifications.get(selectionId);
  if (!s || !r) throw new Error(`selection ${selectionId} is missing or unratified in fixtures`);
  const claims = s.addresses.map((address) => ({ address, content: entryAt(address).content }));
  return {
    selectionId,
    claimMode: r.claimMode,
    claims,
    ratifiedAtMs: r.confirmedAtMs,
    promptInput: {
      selectionId,
      claimMode: r.claimMode,
      claimContent: claims.map((c) => c.content),
    },
  };
}

// --- Canonical JSON and contentHash re-derived from §3.2a / §3.3 ---

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(',')}}`;
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

function preregContentHash(expectations: Array<Record<string, unknown>>): string {
  const canonical = JSON.stringify(
    expectations.map((e) => {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(e).sort()) sorted[key] = e[key];
      return sorted;
    })
  );
  return sha256(canonical);
}

// --- The render grammar re-stated from JUDGE_INTAKE_DESIGN §3.2a ---

const csv = (items: string[]): string => (items.length === 0 ? '(none)' : items.join(', '));

function renderPromptText(role: string, judgeId: string, context: Record<string, unknown>): string {
  const def = ROLES[role];
  const identity = `<identity>\nrole: ${role}\njudge: ${judgeId}\n</identity>`;
  const taxonomyLines = Object.keys(def.taxonomy)
    .sort()
    .map((cls) => `  ${cls} -> ${def.taxonomy[cls]}`)
    .join('\n');
  const definition =
    `<definition>\n` +
    `claim_modes: ${csv(def.claimModes)}\n` +
    `qualified_parameters: ${csv(def.params)}\n` +
    `taxonomy:\n${taxonomyLines}\n` +
    `required_assumptions: ${csv(def.requiredAssumptions)}\n` +
    `verdict_rule: Judge only through this definition — restrict every finding to the qualified ` +
    `parameters above, name any drawback from the closed taxonomy, and abstain with a reason when ` +
    `jurisdiction or evidence is absent.\n` +
    `</definition>`;
  const evidenceKeys = Object.keys(context).sort();
  const evidence =
    `<evidence>\n` + evidenceKeys.map((k) => `${k}:\n${canonicalJson(context[k])}`).join('\n') + `\n</evidence>`;
  const outputSchema =
    `<output_schema>\n` +
    `verdict: clean | drawback | abstain\n` +
    `drawback: ${Object.keys(def.taxonomy).sort().join(' | ')} | null\n` +
    `abstain_reason: evidence | jurisdiction\n` +
    `format: one JSON object {"verdict": "...", "drawback": "..." | null, "abstainReason": "..."}\n` +
    `</output_schema>`;
  return (
    `<judge_prompt role="${role}" judge="${judgeId}">\n\n` +
    [identity, definition, evidence, outputSchema].join('\n\n') +
    `\n\n</judge_prompt>\n`
  );
}

/** Allowlist assembly re-derived from RECONCILIATION §5 row 2 semantics. */
function assembleContext(role: string, provided: Record<string, unknown>): Record<string, unknown> {
  const def = ROLES[role];
  const allowed = [...def.required, ...def.optional].sort();
  for (const key of Object.keys(provided)) {
    if (!allowed.includes(key)) throw new Error(`fixture provided forbidden key ${key} for ${role}`);
  }
  const context: Record<string, unknown> = {};
  for (const key of allowed) {
    if (provided[key] !== undefined) context[key] = provided[key];
  }
  return context;
}

// --- Expected prompts ---

interface PromptScenario {
  name: string;
  role: string;
  judgeId: string;
  selectionId: string;
  contextKey: string;
}

const expectedPrompts: Record<string, { role: string; judgeId: string; text: string; promptHash: string }> = {};
for (const scenario of contextsFile.promptScenarios as PromptScenario[]) {
  const candidate = candidateFor(scenario.selectionId);
  const claim = candidate.promptInput.claimContent.join('\n');
  const provided = { ...(contextsFile.provided[scenario.contextKey] as Record<string, unknown>), claim };
  const context = assembleContext(scenario.role, provided);
  const text = renderPromptText(scenario.role, scenario.judgeId, context);
  expectedPrompts[scenario.name] = { role: scenario.role, judgeId: scenario.judgeId, text, promptHash: sha256(text) };
}

const expectedPromptsDoc = { version: 1, scenarios: expectedPrompts };
const expectedPromptsText = JSON.stringify(expectedPromptsDoc, null, 2) + '\n';
writeFileSync(join(DIR, 'expected_prompts.json'), expectedPromptsText);

// Broken twin for the negative control: prompt-j3 carries a smuggled
// expectation inside its evidence section — the F1 task-text channel
// returning as bytes. The hash is recomputed so the twin is internally
// consistent; only the byte comparison against the REAL renderer can
// catch it, which is exactly what the control demonstrates.
const broken = JSON.parse(expectedPromptsText) as typeof expectedPromptsDoc & { note?: string };
const smuggleLine = `expected_verdict: drawback (unsupported_citation)\n`;
const target = broken.scenarios['prompt-j3'];
target.text = target.text.replace('</evidence>', `${smuggleLine}</evidence>`);
target.promptHash = sha256(target.text);
broken.note =
  'DELIBERATELY BROKEN oracle for the --negative-control mode: prompt-j3 carries a smuggled expectation line inside its evidence section, with an internally consistent hash. A drill that accepts these bytes as the composed prompt is itself the failure.';
writeFileSync(join(DIR, 'expected_prompts_broken.json'), JSON.stringify(broken, null, 2) + '\n');

// --- Expected intake artifacts (requests, candidates, store hashes) ---

const expectedIntake = {
  version: 1,
  ratificationRequests: {
    'sel-primary': ratificationRequestFor('sel-primary'),
    'sel-decomp-1': ratificationRequestFor('sel-decomp-1'),
    'sel-decomp-2': ratificationRequestFor('sel-decomp-2'),
    'sel-multi': ratificationRequestFor('sel-multi'),
  },
  candidates: Object.fromEntries([...ratifications.keys()].sort().map((id) => [id, candidateFor(id)])),
  preregContentHashes: Object.fromEntries(
    (storeFile.preRegistrations as Array<{ registrationId: string; expectations: Array<Record<string, unknown>> }>)
      .map((p) => [p.registrationId, preregContentHash(p.expectations)])
  ),
};
writeFileSync(join(DIR, 'expected_intake.json'), JSON.stringify(expectedIntake, null, 2) + '\n');

// --- Manifest: SHA-256 pins over every fixture file the drill consumes ---

const shaFile = (name: string) => createHash('sha256').update(readFileSync(join(DIR, name))).digest('hex');
const manifest = {
  version: 1,
  files: Object.fromEntries(
    [
      'address_space.json',
      'selections.json',
      'store_records.json',
      'store_records_broken.json',
      'contexts.json',
      'expected_prompts.json',
      'expected_prompts_broken.json',
      'expected_intake.json',
    ].map((f) => [f, shaFile(f)])
  ),
};
writeFileSync(join(DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('generated expected_prompts.json, expected_prompts_broken.json, expected_intake.json, manifest.json');
