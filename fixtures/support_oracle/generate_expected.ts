/**
 * Independent oracle generator for the support-computation drill.
 *
 * REVIEW CRITERION (docs/product/epistemic-support/ORACLE_DRILL_PROPOSAL.md §16):
 * this file implements docs/architecture/EPISTEMIC_SUPPORT.md §3 SEPARATELY
 * and must never import from src/core/graph/support*.ts — a shared helper
 * would let one bug agree with itself. Run manually (never by the drill)
 * when the arithmetic SPECIFICATION changes, in the same commit that
 * re-pins the manifest:
 *
 *   npx tsx fixtures/support_oracle/generate_expected.ts
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const DIR = __dirname;
const PARAMS = { priorWeight: 2, baseRate: 0.5, halfLifeMs: 1000000 };

interface Row {
  beliefId: string;
  opId: string;
  verdict: 'drawback' | 'clean' | 'abstain';
  atMs: number;
  weight: number;
}

// Deliberately re-derived from the spec text, not from the module.
function opinionFor(rows: Row[], asOfMs: number) {
  const ordered = [...rows].sort((a, b) =>
    a.beliefId.localeCompare(b.beliefId) ||
    a.opId.localeCompare(b.opId) ||
    a.atMs - b.atMs ||
    a.verdict.localeCompare(b.verdict)
  );
  let r = 0, s = 0;
  const events = { clean: 0, drawback: 0, abstain: 0 };
  for (const e of ordered) {
    if (e.atMs > asOfMs) throw new Error(`future event in fixture: ${e.beliefId}/${e.opId}`);
    events[e.verdict] += 1;
    if (e.verdict === 'abstain') continue;
    const w = e.weight * Math.pow(2, -(asOfMs - e.atMs) / PARAMS.halfLifeMs);
    if (e.verdict === 'clean') r += w; else s += w;
  }
  const denom = r + s + PARAMS.priorWeight;
  const b = r / denom, d = s / denom, u = PARAMS.priorWeight / denom;
  return { b, d, u, projected: b + PARAMS.baseRate * u, events };
}

const verdictsFile = JSON.parse(readFileSync(join(DIR, 'verdicts.json'), 'utf8'));
const rows: Row[] = verdictsFile.events.map((e: Record<string, unknown>) => ({
  beliefId: e.beliefId, opId: e.opId, verdict: e.verdict, atMs: e.atMs, weight: e.weight,
}));
const byBelief = new Map<string, Row[]>();
for (const r of rows) {
  const list = byBelief.get(r.beliefId) ?? [];
  list.push(r);
  byBelief.set(r.beliefId, list);
}

const asOfMs: number = verdictsFile.asOfMs;
const beliefs: Record<string, unknown> = {};
for (const [id, list] of [...byBelief.entries()].sort()) {
  beliefs[id] = opinionFor(list, asOfMs);
}
const decay: Record<string, unknown> = {};
for (const [id, checkpoints] of Object.entries(
  verdictsFile.decayCheckpoints as Record<string, number[]>
)) {
  decay[id] = {
    at: checkpoints,
    opinions: checkpoints.map((t) => opinionFor(byBelief.get(id) ?? [], t)),
  };
}

const expected = { version: 1, params: PARAMS, asOfMs, beliefs, decay };
const expectedText = JSON.stringify(expected, null, 2) + '\n';
writeFileSync(join(DIR, 'expected_opinions.json'), expectedText);

// Broken twin for the negative control: flip one digit of one b value.
const brokenObj = JSON.parse(expectedText);
const target = brokenObj.beliefs['support-oracle:003'];
target.b = target.b + 0.001;
brokenObj.note = 'DELIBERATELY BROKEN oracle for the --negative-control mode: support-oracle:003 b is offset by +0.001. A drill that accepts this file is itself the failure.';
writeFileSync(join(DIR, 'expected_opinions_broken.json'), JSON.stringify(brokenObj, null, 2) + '\n');

// Manifest: SHA-256 pins over every fixture file the drill consumes.
const sha = (name: string) =>
  createHash('sha256').update(readFileSync(join(DIR, name))).digest('hex');
const manifest = {
  version: 1,
  files: Object.fromEntries(
    ['beliefs.json', 'verdicts.json', 'metrics.json', 'expected_opinions.json', 'expected_opinions_broken.json']
      .map((f) => [f, sha(f)])
  ),
};
writeFileSync(join(DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('generated expected_opinions.json, expected_opinions_broken.json, manifest.json');
