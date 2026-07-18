/**
 * Independent oracle generator for the judge-panel drill.
 *
 * REVIEW CRITERION (the ORACLE_DRILL_PROPOSAL §16 rule, applied to the
 * panel): this file re-derives the composition semantics from the
 * SPECIFICATION — docs/product/epistemic-support/RECONCILIATION.md §2–§3
 * (role selections, taxonomies, gates, overlap test) and
 * docs/architecture/EPISTEMIC_SUPPORT.md §3 (opinion arithmetic) — and
 * must never import from src/core/graph/*. A shared helper would let
 * one bug agree with itself. Run manually (never by the drill) when
 * the specification changes, in the same commit that re-pins:
 *
 *   npx tsx fixtures/judge_panel/generate_expected.ts
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
  },
};

const COMPOSITION_ROLES = new Set(Object.keys(ROLES));

interface Verdict {
  judgeId: string;
  role: string;
  beliefId: string;
  verdict: 'drawback' | 'clean' | 'abstain';
  drawback: string | null;
  abstainReason?: string;
  atMs: number;
  weight: number;
}

const registryEntryOf = (qualified: string): string => qualified.split('/')[0];

// --- Opinion arithmetic re-derived from EPISTEMIC_SUPPORT.md §3 ---

function opinionFor(
  rows: Verdict[],
  asOfMs: number,
  params: { priorWeight: number; baseRate: number; halfLifeMs: number }
) {
  const ordered = [...rows].sort((a, b) =>
    a.beliefId.localeCompare(b.beliefId) ||
    a.judgeId.localeCompare(b.judgeId) ||
    a.atMs - b.atMs ||
    a.verdict.localeCompare(b.verdict)
  );
  let r = 0;
  let s = 0;
  const events = { clean: 0, drawback: 0, abstain: 0 };
  for (const e of ordered) {
    if (e.atMs > asOfMs) throw new Error(`future event in fixture: ${e.judgeId}`);
    events[e.verdict] += 1;
    if (e.verdict === 'abstain') continue;
    const w = e.weight * Math.pow(2, -(asOfMs - e.atMs) / params.halfLifeMs);
    if (e.verdict === 'clean') r += w;
    else s += w;
  }
  const denom = r + s + params.priorWeight;
  const b = r / denom;
  const d = s / denom;
  const u = params.priorWeight / denom;
  return { b, d, u, projected: b + params.baseRate * u, events };
}

// --- Composition semantics re-derived from RECONCILIATION §3 ---

const judgesFile = JSON.parse(readFileSync(join(DIR, 'judges.json'), 'utf8'));
const casesFile = JSON.parse(readFileSync(join(DIR, 'cases.json'), 'utf8'));
const verdictsFile = JSON.parse(readFileSync(join(DIR, 'verdicts.json'), 'utf8'));

const asOfMs: number = verdictsFile.asOfMs;
const params = verdictsFile.params;

const registeredByRole: Array<{ judgeId: string; role: string }> = judgesFile.manifests.map(
  (m: { judgeId: string; role: string }) => ({ judgeId: m.judgeId, role: m.role })
);

interface ExpectedRow {
  opinion: ReturnType<typeof opinionFor>;
  conflicts: Array<{ parameter: string; judgeIds: string[] }>;
  disagreements: Array<{ registryEntry: string; judgeIds: string[] }>;
  exclusions: Array<{ judgeId: string; assumption: string }>;
  counts: { verdictsConsumed: number; verdictsWithheld: number; jurisdictionAbstains: number };
  blendCounterfactual?: ReturnType<typeof opinionFor>;
}

function compose(caseId: string, verdicts: Verdict[]): ExpectedRow {
  const judgedCase = casesFile.cases[caseId];

  // R-29 gate over the registry's composition-side panel.
  const exclusions: Array<{ judgeId: string; assumption: string }> = [];
  for (const { judgeId, role } of [...registeredByRole].sort((a, b) => a.judgeId.localeCompare(b.judgeId))) {
    if (!COMPOSITION_ROLES.has(role)) continue;
    for (const assumption of ROLES[role].requiredAssumptions) {
      if (judgedCase.assumptions[assumption] === false) exclusions.push({ judgeId, assumption });
    }
  }

  const jurisdictionAbstains = verdicts.filter(
    (v) => v.verdict === 'abstain' && v.abstainReason === 'jurisdiction'
  ).length;

  // R-30 overlap test: qualified-parameter overlap + drawback-vs-clean.
  const opining = verdicts.filter((v) => v.verdict !== 'abstain');
  const conflicts: Array<{ parameter: string; judgeIds: string[] }> = [];
  const withheld = new Set<Verdict>();
  for (let i = 0; i < opining.length; i += 1) {
    for (let j = i + 1; j < opining.length; j += 1) {
      const pairings: Array<[Verdict, Verdict]> = [[opining[i], opining[j]], [opining[j], opining[i]]];
      for (const [drawer, cleaner] of pairings) {
        if (drawer.verdict !== 'drawback' || cleaner.verdict !== 'clean') continue;
        const overlap = ROLES[drawer.role].params.filter((p) => ROLES[cleaner.role].params.includes(p));
        const parameter = ROLES[drawer.role].taxonomy[drawer.drawback as string];
        if (!overlap.includes(parameter)) continue;
        conflicts.push({ parameter, judgeIds: [drawer.judgeId, cleaner.judgeId].sort() });
        withheld.add(drawer);
        withheld.add(cleaner);
      }
    }
  }

  // Cross-role disagreement: registry-level kinship, qualified-level disjoint.
  const disagreements: Array<{ registryEntry: string; judgeIds: string[] }> = [];
  for (let i = 0; i < opining.length; i += 1) {
    for (let j = i + 1; j < opining.length; j += 1) {
      const pairings: Array<[Verdict, Verdict]> = [[opining[i], opining[j]], [opining[j], opining[i]]];
      for (const [drawer, cleaner] of pairings) {
        if (withheld.has(drawer) || withheld.has(cleaner)) continue;
        if (drawer.verdict !== 'drawback' || cleaner.verdict !== 'clean') continue;
        const qualified = ROLES[drawer.role].taxonomy[drawer.drawback as string];
        if (ROLES[cleaner.role].params.includes(qualified)) continue;
        const entry = registryEntryOf(qualified);
        if (!ROLES[cleaner.role].params.some((p) => registryEntryOf(p) === entry)) continue;
        disagreements.push({ registryEntry: entry, judgeIds: [drawer.judgeId, cleaner.judgeId].sort() });
      }
    }
  }

  const survivors = verdicts.filter((v) => !withheld.has(v));
  const row: ExpectedRow = {
    opinion: opinionFor(survivors, asOfMs, params),
    conflicts,
    disagreements,
    exclusions,
    counts: {
      verdictsConsumed: survivors.length,
      verdictsWithheld: withheld.size,
      jurisdictionAbstains,
    },
  };
  if (withheld.size > 0) {
    // The silent-blend counterfactual (all events, conflict ignored) the
    // drill must observe the composed opinion to be u-dominant against.
    row.blendCounterfactual = opinionFor(verdicts, asOfMs, params);
  }
  return row;
}

const scenarios: Record<string, ExpectedRow> = {};
for (const scenario of verdictsFile.scenarios as Array<{ name: string; caseId: string; expect: string; verdicts: Verdict[] }>) {
  if (scenario.expect !== 'compose') continue;
  scenarios[scenario.name] = compose(scenario.caseId, scenario.verdicts);
}

const expected = { version: 1, params, asOfMs, scenarios };
const expectedText = JSON.stringify(expected, null, 2) + '\n';
writeFileSync(join(DIR, 'expected_compositions.json'), expectedText);

// Broken twin for the negative control: offset one b value.
const broken = JSON.parse(expectedText);
broken.scenarios['happy-mixed'].opinion.b += 0.001;
broken.note =
  'DELIBERATELY BROKEN oracle for the --negative-control mode: happy-mixed opinion.b is offset by +0.001. A drill that accepts this file is itself the failure.';
writeFileSync(join(DIR, 'expected_compositions_broken.json'), JSON.stringify(broken, null, 2) + '\n');

// Manifest: SHA-256 pins over every fixture file the drill consumes.
const sha = (name: string) => createHash('sha256').update(readFileSync(join(DIR, name))).digest('hex');
const manifest = {
  version: 1,
  files: Object.fromEntries(
    [
      'judges.json',
      'cases.json',
      'verdicts.json',
      'blindness.json',
      'blindness_broken.json',
      'contest.json',
      'contest_broken.json',
      'expected_compositions.json',
      'expected_compositions_broken.json',
    ].map((f) => [f, sha(f)])
  ),
};
writeFileSync(join(DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('generated expected_compositions.json, expected_compositions_broken.json, manifest.json');
