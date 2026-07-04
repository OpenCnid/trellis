import { execFile } from 'child_process';
import * as path from 'path';
import util from 'util';
import { neo4jDriver, pgPool } from '../src/config/db';
import {
  defaultPolicy,
  selectVerificationCandidates,
  runVerificationSweep,
  makeOracleClassifier,
  CURRENT_RUBRIC_VERSION,
  BeliefCandidate
} from '../src/core/graph/verification';

// Phase 5 Milestone 3 verification: the verifier, end to end and
// LLM-free (ground-truth oracle in place of the sub-LLM).
//
//   1. Policy tiers: low/missing confidence and stale rubricVersion are
//      mandatory; confident un-graduated beliefs are sampled; graduated
//      beliefs leave the pool.
//   2. Oracle sweep: agreement accrues verified_count / lastVerifiedAt /
//      confidence-toward-fresh and re-stamps rubricVersion; a poisoned
//      high-confidence belief over UNCHANGED bytes (invisible to Phase 4
//      by construction) is disputed and quarantined with an audit trail.
//   3. Contested beliefs are excluded from subsequent sweeps.
//   4. Trust accrual: consecutive clean sweeps graduate beliefs out of
//      the pool — verification spend falls to zero.
//   5. Recovery: re-derivation through the REAL Python writer restores a
//      clean belief; the disputed edge stays behind as audit history.
//   6. Queue round trip: the sweep batch is processed by the real
//      verification worker over Redis/BullMQ in oracle mode.

const execFileAsync = util.promisify(execFile);

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
  if (!ok) failures++;
}
function checkClose(label: string, actual: number | null | undefined, expected: number, eps = 1e-9): void {
  const ok = actual != null && Math.abs(actual - expected) < eps;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${ok ? '' : ` — expected ~${expected}, got ${actual}`}`);
  if (!ok) failures++;
}

const TOKEN = `test-verify-${Date.now()}`;
const Q = (n: string) => `${TOKEN}-${n}`;

const PY_ENV = {
  ...process.env,
  PYTHONPATH: 'C:\\Users\\Darian\\AppData\\Roaming\\Python\\Python313\\site-packages',
  PYTHONIOENCODING: 'utf-8'
};

async function writeBeliefsViaPython(facts: unknown[]): Promise<void> {
  const py = [
    'import sys, json',
    "sys.path.insert(0, '.')",
    'from trellis_tools import TrellisNeo4j',
    't = TrellisNeo4j()',
    'print(t.write_derived_insights(json.loads(sys.argv[1])))',
    't.close()'
  ].join('\n');
  await execFileAsync('python', ['-c', py, JSON.stringify(facts)], {
    cwd: path.resolve('src/rlm'),
    env: PY_ENV
  });
}

async function runCypher(cypher: string, params: Record<string, unknown> = {}): Promise<void> {
  const session = neo4jDriver.session();
  try {
    await session.run(cypher, params);
  } finally {
    await session.close();
  }
}

interface EdgeState {
  contested: boolean;
  contestedReason: string | null;
  disputedLabel: string | null;
  disputedConfidence: number | null;
  disputedAt: string | null;
  verifiedCount: number;
  lastVerifiedAt: string | null;
  confidence: number | null;
  rubricVersion: number | null;
}

async function edgeState(subject: string, label: string): Promise<EdgeState | undefined> {
  const session = neo4jDriver.session();
  try {
    const res = await session.run(
      `MATCH (:Entity {name: $subject})-[r:DERIVED_INSIGHT {verb: 'has_category'}]->(:Entity {name: $label})
       RETURN coalesce(r.contested, false) AS contested, r.contestedReason AS contestedReason,
              r.disputedLabel AS disputedLabel, r.disputedConfidence AS disputedConfidence,
              r.disputedAt AS disputedAt,
              coalesce(r.verified_count, 0) AS verifiedCount, r.lastVerifiedAt AS lastVerifiedAt,
              r.confidence AS confidence, r.rubricVersion AS rubricVersion`,
      { subject: subject.toLowerCase(), label: label.toLowerCase() }
    );
    const rec = res.records[0];
    if (!rec) return undefined;
    const num = (v: unknown) => (v == null ? null : Number(v));
    return {
      contested: rec.get('contested'),
      contestedReason: rec.get('contestedReason'),
      disputedLabel: rec.get('disputedLabel'),
      disputedConfidence: num(rec.get('disputedConfidence')),
      disputedAt: rec.get('disputedAt') == null ? null : String(rec.get('disputedAt')),
      verifiedCount: Number(rec.get('verifiedCount')),
      lastVerifiedAt: rec.get('lastVerifiedAt') == null ? null : String(rec.get('lastVerifiedAt')),
      confidence: num(rec.get('confidence')),
      rubricVersion: num(rec.get('rubricVersion'))
    };
  } finally {
    await session.close();
  }
}

async function insertAstText(hash: string, text: string): Promise<void> {
  // Same shape as real ingested AST rows: text lives on descendant nodes.
  const data = { id: hash, type: 'paragraph', children: [{ id: `${hash}-child`, type: 'text', content: text }] };
  await pgPool.query(
    `INSERT INTO ast_nodes (id, document_id, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
    [hash, `${TOKEN}-root`, JSON.stringify(data)]
  );
}

async function cleanup(hashes: string[]): Promise<void> {
  await runCypher(`MATCH (n:Entity) WHERE n.name STARTS WITH $prefix DETACH DELETE n`, { prefix: TOKEN.toLowerCase() });
  await pgPool.query('DELETE FROM ast_nodes WHERE id = ANY($1)', [hashes]);
}

async function main(): Promise<void> {
  console.log('Milestone 3: the verifier — policy tiers, oracle sweeps, quarantine, recovery');

  const beliefs = [
    // subject suffix, stored label, true label, confidence, text
    { q: 'qa', stored: 'loc', truth: 'loc', confidence: 0.95, text: 'Which river runs through Testville?' },
    { q: 'qb', stored: 'hum', truth: 'hum', confidence: 0.5, text: 'Who founded Testville?' },
    { q: 'qc', stored: 'num', truth: 'num', confidence: null, text: 'How many bridges does Testville have?' },
    { q: 'qd', stored: 'desc', truth: 'desc', confidence: 0.9, text: 'Why is Testville famous?' },
    { q: 'qe', stored: 'enty', truth: 'enty', confidence: 0.95, text: 'What dish is Testville famous for?' },
    // ORIGINAL SIN: born wrong, HIGH stored confidence, bytes never change.
    { q: 'qf', stored: 'loc', truth: 'hum', confidence: 0.98, text: 'Which explorer was born in Testville?' },
    // Belief whose provenance has no live bytes: must be skipped, not crash.
    { q: 'qg', stored: 'abbr', truth: 'abbr', confidence: 0.3, text: null }
  ];
  const hashes = beliefs.filter(b => b.text != null).map(b => `${TOKEN}-hash-${b.q}`);
  const freshHash = `${TOKEN}-hash-qf-fresh`;
  const oracle: Record<string, string> = {};
  for (const b of beliefs) oracle[Q(b.q)] = b.truth;

  const policy = defaultPolicy({
    sampleRate: 1.0, // deterministic: every sampled-tier belief is checked
    graduatedRate: 0,
    subjectPrefix: TOKEN.toLowerCase()
  });
  const classifier = makeOracleClassifier(oracle);

  try {
    // Seed: PG texts + beliefs through the real Python bulk writer.
    for (const b of beliefs) {
      if (b.text != null) await insertAstText(`${TOKEN}-hash-${b.q}`, b.text);
    }
    await writeBeliefsViaPython(
      beliefs.map(b => ({
        subject: Q(b.q), verb: 'HAS_CATEGORY', obj: b.stored,
        sourceNodeIds: [`${TOKEN}-hash-${b.q}`], confidence: b.confidence
      }))
    );
    // qd was written under the legacy rubric; qe has already graduated.
    await runCypher(
      `MATCH (:Entity {name: $s})-[r:DERIVED_INSIGHT {verb: 'has_category'}]->() SET r.rubricVersion = 1`,
      { s: Q('qd') }
    );
    await runCypher(
      `MATCH (:Entity {name: $s})-[r:DERIVED_INSIGHT {verb: 'has_category'}]->() SET r.verified_count = 3`,
      { s: Q('qe') }
    );

    // --- 1. Policy tiers ---------------------------------------------------
    console.log('\n[1] policy tier assignment');
    const selection = await selectVerificationCandidates(neo4jDriver, policy);
    check('pool size covers all 7 beliefs', selection.poolSize, 7);
    check('mandatory tier: low conf (qb), missing conf (qc), stale rubric (qd), low conf (qg)', selection.poolByTier.mandatory, 4);
    check('sampled tier: confident un-graduated (qa, qf)', selection.poolByTier.sampled, 2);
    check('graduated tier: qe', selection.poolByTier.graduated, 1);
    check('selected = mandatory + sampled@p=1, graduated excluded', selection.candidates.length, 6);
    check('graduated qe not selected', selection.candidates.some(c => c.subject === Q('qe')), false);

    // --- 2. Oracle sweep: agreement accrues, original sin is disputed -------
    console.log('\n[2] oracle sweep 1');
    const sweep1 = await runVerificationSweep(neo4jDriver, pgPool, policy, classifier);
    check('classified 5 (qg has no live bytes)', sweep1.classified, 5);
    check('skipped 1 for missing live text', sweep1.skippedNoText, 1);
    check('agreed 4', sweep1.agreed, 4);
    check('disputed 1 — the poisoned belief', sweep1.disputed, 1);
    check('dispute names qf: cached loc vs fresh hum', sweep1.disputes, [{ subject: Q('qf'), label: 'loc', disputedLabel: 'hum' }]);
    check('oracle mode costs zero sub-calls', sweep1.usage.subcalls, 0);

    const qf = await edgeState(Q('qf'), 'loc');
    check('qf quarantined (contested)', qf?.contested, true);
    check("qf contestedReason = 'disputed'", qf?.contestedReason, 'disputed');
    check('qf disputedLabel recorded', qf?.disputedLabel, 'hum');
    check('qf disputedAt recorded', qf?.disputedAt != null, true);
    check('qf cached label NOT corrected in place (edge still -> loc)', qf !== undefined, true);

    const qb = await edgeState(Q('qb'), 'hum');
    const qc = await edgeState(Q('qc'), 'num');
    const qd = await edgeState(Q('qd'), 'desc');
    const qe = await edgeState(Q('qe'), 'enty');
    check('qb verified_count incremented', qb?.verifiedCount, 1);
    check('qb lastVerifiedAt set', qb?.lastVerifiedAt != null, true);
    checkClose('qb confidence moved toward fresh reading (0.5 -> 0.75)', qb?.confidence, 0.75);
    checkClose('qc missing confidence adopts fresh reading (1.0)', qc?.confidence, 1.0);
    check('qd re-stamped with current rubricVersion', qd?.rubricVersion, CURRENT_RUBRIC_VERSION);
    check('graduated qe untouched', [qe?.verifiedCount, qe?.lastVerifiedAt], [3, null]);

    // --- 3. Contested exclusion ---------------------------------------------
    console.log('\n[3] contested beliefs leave the pool');
    const selection2 = await selectVerificationCandidates(neo4jDriver, policy);
    check('pool shrinks to 6 (qf quarantined)', selection2.poolSize, 6);
    check('qf no longer selectable', selection2.candidates.some(c => c.subject === Q('qf')), false);

    // --- 4. Trust accrual: spend falls across clean sweeps -------------------
    console.log('\n[4] graduation across consecutive clean sweeps');
    const sweep2 = await runVerificationSweep(neo4jDriver, pgPool, policy, classifier);
    const sweep3 = await runVerificationSweep(neo4jDriver, pgPool, policy, classifier);
    const sweep4 = await runVerificationSweep(neo4jDriver, pgPool, policy, classifier);
    check('clean sweeps dispute nothing', [sweep2.disputed, sweep3.disputed, sweep4.disputed], [0, 0, 0]);
    check('verification spend falls: classified 5 -> 4 -> 4 -> 0', [sweep1.classified, sweep2.classified, sweep3.classified, sweep4.classified], [5, 4, 4, 0]);
    check('sweep 4 selects only the no-text belief (all others graduated)', sweep4.selected, 1);
    const qaFinal = await edgeState(Q('qa'), 'loc');
    check('qa graduated at verified_count 3', qaFinal?.verifiedCount, 3);

    // --- 5. Recovery: arbitration by re-derivation ---------------------------
    console.log('\n[5] recovery via the real Python writer');
    await insertAstText(freshHash, 'Which explorer was born in Testville?');
    hashes.push(freshHash);
    await writeBeliefsViaPython([
      { subject: Q('qf'), verb: 'HAS_CATEGORY', obj: 'hum', sourceNodeIds: [freshHash], confidence: 0.9 }
    ]);
    const qfOld = await edgeState(Q('qf'), 'loc');
    const qfNew = await edgeState(Q('qf'), 'hum');
    check('disputed edge remains quarantined as audit history', [qfOld?.contested, qfOld?.contestedReason], [true, 'disputed']);
    check('re-derived belief is clean', qfNew?.contested, false);

    // Effective-category resolution (the agent protocol's cache read).
    const session = neo4jDriver.session();
    let effective: string[];
    try {
      const res = await session.run(
        `MATCH (s:Entity {name: $s})-[r:DERIVED_INSIGHT {verb: 'has_category'}]->(o:Entity)
         WHERE coalesce(r.contested, false) = false RETURN o.name AS label`,
        { s: Q('qf') }
      );
      effective = res.records.map(r => r.get('label'));
    } finally {
      await session.close();
    }
    check('effective category for qf is now hum only', effective, ['hum']);

    const sweep5 = await runVerificationSweep(neo4jDriver, pgPool, policy, classifier);
    check('recovered belief re-enters the pool and verifies clean', [sweep5.classified, sweep5.agreed, sweep5.disputed], [1, 1, 0]);

    // --- 6. Queue round trip through the real worker --------------------------
    console.log('\n[6] verification worker over Redis/BullMQ (oracle mode)');
    const { verificationQueue } = await import('../src/workers/queue');
    const qaCandidate: BeliefCandidate = {
      subject: Q('qa'), label: 'loc', confidence: qaFinal!.confidence,
      rubricVersion: CURRENT_RUBRIC_VERSION, verifiedCount: 3,
      sourceNodeIds: [`${TOKEN}-hash-qa`], tier: 'graduated'
    };
    const job = await verificationQueue.add(
      'verification_sweep',
      { candidates: [qaCandidate], oracle, policyLabel: 'offline-test' },
      { removeOnComplete: true, removeOnFail: true }
    );
    const { verificationWorker } = await import('../src/workers/verification_worker');
    const outcome = await Promise.race([
      new Promise<string>(resolve => {
        verificationWorker.on('completed', done => { if (done.id === job.id) resolve('completed'); });
        verificationWorker.on('failed', (failed, err) => { if (failed?.id === job.id) resolve(`failed: ${err.message}`); });
      }),
      new Promise<string>(resolve => setTimeout(() => resolve('timeout'), 30000))
    ]);
    check('worker processed the sweep job', outcome, 'completed');
    check('worker applied the verification (qa verified_count 3 -> 4)', (await edgeState(Q('qa'), 'loc'))?.verifiedCount, 4);
    await verificationWorker.close();
    await verificationQueue.close();
  } finally {
    await cleanup(hashes);
  }
}

main()
  .then(async () => {
    await neo4jDriver.close();
    await pgPool.end();
    console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async err => {
    console.error(`\nTest run error: ${err.stack ?? err.message}`);
    try { await neo4jDriver.close(); await pgPool.end(); } catch {}
    process.exit(1);
  });
