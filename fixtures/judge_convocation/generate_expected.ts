/**
 * Independent oracle generator for the judge-convocation drill.
 *
 * REVIEW CRITERION (the ORACLE_DRILL_PROPOSAL §16 rule; the
 * judge-intake mold): this file re-derives convocation semantics from
 * the SPECIFICATION — JUDGE_CONVOCATION_DESIGN.md §3.2 and its dated
 * implementation notes (pair identity: candidateHash = sha256 of the
 * canonical JSON {claimContent, claimMode}; candidateIdentity =
 * `${selectionId}#${candidateHash}`; judgeIdentity =
 * `${judgeId}|${rubricSha}|${targetModelIdentity}`; pairKey = sha256 of
 * `${candidateIdentity}::${judgeIdentity}`; the seeded sampler is
 * mulberry32; iteration order is candidates ascending by selectionId,
 * judges ascending by judgeId, candidate-major), role data re-declared
 * from RECONCILIATION.md §2, and the opinion arithmetic re-derived from
 * EPISTEMIC_SUPPORT.md §3 — and must NEVER import from src/core/graph/*.
 * A shared helper would let one bug agree with itself. Run manually
 * (never by the drill) when the specification changes, in the same
 * commit that re-pins:
 *
 *   npx tsx fixtures/judge_convocation/generate_expected.ts
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const DIR = __dirname;

// --- Spec re-derivations (deliberately not imported) -----------------------

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(',')}}`;
}
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Role data re-declared from RECONCILIATION §2 (belief-facing only —
// J4 has no candidate path by law).
const ROLES: Record<string, { claimModes: string[]; gatherKey: string; assumption: string; taxonomy: Record<string, string>; params: string[] }> = {
  J1_GROUNDING: {
    claimModes: ['fact', 'inference'],
    gatherKey: 'citedBytes',
    assumption: 'cited_bytes_available',
    taxonomy: {
      unsupported_citation: 'logical.evidence_quality/cited',
      overclaimed_evidence: 'logical.evidence_quality/cited',
      contradicted_by_cited_bytes: 'logical.falsification/cited',
    },
    params: ['logical.evidence_quality/cited', 'logical.falsification/cited'],
  },
  J2_COHERENCE: {
    claimModes: ['fact', 'inference', 'prediction', 'belief'],
    gatherKey: 'history',
    assumption: 'history_available',
    taxonomy: {
      self_contradictory: 'logical.consistency/internal',
      history_inconsistent: 'logical.consistency/history',
      kind_incoherent: 'logical.constraint_satisfaction/kind',
    },
    params: ['logical.consistency/internal', 'logical.consistency/history', 'logical.constraint_satisfaction/kind'],
  },
  J3_CORROBORATION: {
    claimModes: ['fact', 'inference', 'prediction'],
    gatherKey: 'independentEvidence',
    assumption: 'independent_evidence_pool_available',
    taxonomy: {
      uncorroborated: 'logical.induction/world',
      authority_contradicted: 'logical.falsification/independent',
      corroboration_ambiguous: 'sensorial.observation_quality/independent',
    },
    params: ['logical.induction/world', 'logical.falsification/independent', 'logical.source_dependence/independent', 'sensorial.observation_quality/independent'],
  },
};

// Drill time constants (specified for the drill; the drill's injected
// clock returns ATMS for every call; the report reads at ATMS + 1 day).
const ATMS = 1753000000000;
const ASOF = ATMS + 86400000;
const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;
const PRIOR_WEIGHT = 2;
const BASE_RATE = 0.5;
const WEIGHT = 1;

// --- Inputs ----------------------------------------------------------------

const judgesFile = JSON.parse(readFileSync(join(DIR, 'judges.json'), 'utf8'));
const candidatesFile = JSON.parse(readFileSync(join(DIR, 'candidates.json'), 'utf8'));
const evidenceFile = JSON.parse(readFileSync(join(DIR, 'evidence.json'), 'utf8'));

interface ManifestIn { manifest: { judgeId: string; role: string; rubricSha: string; targetModelIdentity: string } }
const beliefJudges = (judgesFile.manifests as ManifestIn[])
  .map((m) => m.manifest)
  .filter((m) => m.role in ROLES)
  .sort((a, b) => (a.judgeId < b.judgeId ? -1 : 1));

interface RatIn { key: string; payload: { record: { selectionId: string; claimMode: string }; entries: Array<{ address: string; content: string }>; selection: { addresses: string[] } } }
const ratifications = (candidatesFile.ratifications as RatIn[]).sort((a, b) => (a.key < b.key ? -1 : 1));

// --- Pair identities -------------------------------------------------------

interface Pair { selectionId: string; judgeId: string; role: string; pairKey: string; candidateIdentity: string; judgeIdentity: string }

const pairKeys: Record<string, string> = {};
const allPairs: Pair[] = [];
for (const rat of ratifications) {
  const byAddress = new Map(rat.payload.entries.map((e) => [e.address, e.content]));
  const claimContent = rat.payload.selection.addresses.map((a) => byAddress.get(a));
  const candidateHash = sha256(canonicalJson({ claimContent, claimMode: rat.payload.record.claimMode }));
  const candidateIdentity = `${rat.key}#${candidateHash}`;
  for (const judge of beliefJudges) {
    const judgeIdentity = `${judge.judgeId}|${judge.rubricSha}|${judge.targetModelIdentity}`;
    const pairKey = sha256(`${candidateIdentity}::${judgeIdentity}`);
    pairKeys[`${rat.key}/${judge.judgeId}`] = pairKey;
    allPairs.push({ selectionId: rat.key, judgeId: judge.judgeId, role: judge.role, pairKey, candidateIdentity, judgeIdentity });
  }
}

// --- Partition: exclusions / synthesized / pool (iteration order spec) -----

const excluded: Array<{ judgeId: string; assumption: string; selectionId: string }> = [];
const synthesized: Pair[] = [];
const pool: Pair[] = [];
for (const pair of allPairs) {
  const role = ROLES[pair.role];
  const evidence = evidenceFile[pair.selectionId] ?? {};
  const available = evidence[role.gatherKey] !== undefined;
  const mode = ratifications.find((r) => r.key === pair.selectionId)!.payload.record.claimMode;
  if (!available) {
    excluded.push({ judgeId: pair.judgeId, assumption: role.assumption, selectionId: pair.selectionId });
    continue;
  }
  if (!role.claimModes.includes(mode)) {
    synthesized.push(pair);
    continue;
  }
  pool.push(pair);
}

// --- The authored oracle truths -------------------------------------------

const truthRun1: Record<string, unknown> = {
  [pairKeys['sel-fact-a/j1-grounding-v1']]: { verdict: 'clean', drawback: null },
  [pairKeys['sel-fact-a/j2-coherence-v1']]: { verdict: 'clean', drawback: null },
  [pairKeys['sel-fact-a/j3-corroboration-v1']]: { verdict: 'drawback', drawback: 'authority_contradicted' },
  [pairKeys['sel-fact-b/j1-grounding-v1']]: { verdict: 'clean', drawback: null },
  // sel-fact-b/j2 deliberately ABSENT: the oracle declines — skipped, counted, re-enters run 2.
  [pairKeys['sel-fact-b/j3-corroboration-v1']]: { verdict: 'clean', drawback: null },
  [pairKeys['sel-belief-c/j2-coherence-v1']]: { verdict: 'drawback', drawback: 'kind_incoherent' },
};
const truthRun2: Record<string, unknown> = {
  [pairKeys['sel-fact-b/j2-coherence-v1']]: { verdict: 'clean', drawback: null },
};

// --- Run 1 expectations ----------------------------------------------------

const run1Judged = pool.filter((p) => truthRun1[p.pairKey] !== undefined);
const run1Skipped = pool.filter((p) => truthRun1[p.pairKey] === undefined);
const run1 = {
  runId: 'run-drill-1',
  poolCandidates: ratifications.length,
  poolJudges: beliefJudges.length,
  poolPairs: pool.length,
  sampled: pool.length, // rate 1.0
  deferred: 0,
  judged: run1Judged.length,
  skippedNoAnswer: run1Skipped.length,
  jurisdictionAbstains: synthesized.length,
  exclusions: excluded,
  verdictsAppended: run1Judged.length + synthesized.length,
};

// --- Run 2 (pair-once): unjudged pool = run-1 skips ------------------------

const run2Pool = run1Skipped;
const run2 = {
  runId: 'run-drill-2',
  poolPairs: run2Pool.length,
  sampled: run2Pool.length,
  deferred: 0,
  judged: run2Pool.filter((p) => truthRun2[p.pairKey] !== undefined).length,
  skippedNoAnswer: run2Pool.filter((p) => truthRun2[p.pairKey] === undefined).length,
  jurisdictionAbstains: 0, // already recorded in run 1; pair-once covers synthesized records too
  verdictsAppended: run2Pool.filter((p) => truthRun2[p.pairKey] !== undefined).length,
};

// --- Budget run (fresh store; rate 1.0, budget 2) --------------------------

const budgetRun = {
  runId: 'run-drill-budget',
  poolPairs: pool.length,
  sampled: pool.length,
  deferred: pool.length - 2,
  judgedAtMost: 2,
  firstTwoPairKeys: pool.slice(0, 2).map((p) => p.pairKey),
};

// --- Seeded run (fresh store; rate 0.5, seed 7) ----------------------------

const SEED = 7;
const RATE = 0.5;
const rng = mulberry32(SEED);
const seededPicks = pool.map((p) => ({ pairKey: p.pairKey, picked: rng() < RATE }));
const seededRun = {
  runId: 'run-drill-seeded',
  seed: SEED,
  rate: RATE,
  poolPairs: pool.length,
  sampled: seededPicks.filter((p) => p.picked).length,
  sampledPairKeys: seededPicks.filter((p) => p.picked).map((p) => p.pairKey),
};

// --- Opinions after run 2 (EPISTEMIC_SUPPORT §3, re-derived) ---------------

const f = Math.pow(2, -(ASOF - ATMS) / HALF_LIFE_MS);
function opinion(cleanCount: number, drawbackCount: number) {
  const r = cleanCount * WEIGHT * f;
  const s = drawbackCount * WEIGHT * f;
  const denom = r + s + PRIOR_WEIGHT;
  const b = r / denom;
  const d = s / denom;
  const u = PRIOR_WEIGHT / denom;
  return { b, d, u, projected: b + BASE_RATE * u };
}

const opinions = {
  'sel-fact-a': { ...opinion(2, 1), verdicts: 3, disagreements: 1, conflicts: 0, jurisdictionAbstains: 0, verdictsConsumed: 3 },
  'sel-fact-b': { ...opinion(3, 0), verdicts: 3, disagreements: 0, conflicts: 0, jurisdictionAbstains: 0, verdictsConsumed: 3 },
  'sel-belief-c': { ...opinion(0, 1), verdicts: 2, disagreements: 0, conflicts: 0, jurisdictionAbstains: 1, verdictsConsumed: 2 },
};

// --- Store row accounting after runs 1+2 on the main store -----------------

const storeRows = {
  seed: ratifications.length + (judgesFile.manifests as unknown[]).length, // 3 + 4
  afterRuns: ratifications.length + (judgesFile.manifests as unknown[]).length
    + 2 /* run_open */ + run1.verdictsAppended + run2.verdictsAppended + 2 /* run_report */,
};

// --- Write -----------------------------------------------------------------

const writeJson = (name: string, value: unknown) =>
  writeFileSync(join(DIR, name), JSON.stringify(value, null, 2) + '\n');

writeJson('oracle_truth_run1.json', truthRun1);
writeJson('oracle_truth_run2.json', truthRun2);
writeJson('expected_convocation.json', {
  atMs: ATMS,
  asOfMs: ASOF,
  pairKeys,
  poolOrder: pool.map((p) => p.pairKey),
  synthesizedPairKeys: synthesized.map((p) => p.pairKey),
  run1,
  run2,
  budgetRun,
  seededRun,
  opinions,
  storeRows,
});

// Manifest last: SHAs of every fixture file except the manifest itself.
const files: Record<string, string> = {};
for (const name of readdirSync(DIR).sort()) {
  if (name === 'manifest.json' || name === 'generate_expected.ts') continue;
  files[name] = createHash('sha256').update(readFileSync(join(DIR, name))).digest('hex');
}
writeJson('manifest.json', { files });
console.log('judge-convocation expected values + manifest written.');
