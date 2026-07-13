import { execFile } from 'child_process';
import * as crypto from 'crypto';
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
import {
  defaultEntailmentPolicy,
  selectInsightEdges,
  sampleEntailmentPairs,
  runEntailmentSweep,
  makeOracleEntailmentJudge,
  EntailmentJudge
} from '../src/core/graph/entailment_detection';

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
//
// Session 32 (PROVENANCE_THREADING.md §5.4) — the sampled entailment
// detector, same oracle discipline:
//
//   7. Detector sweep: unchecked (edge, cited-hash) pairs are judged; a
//      planted unsupported citation (real bytes, wrong claim — the T2
//      class no structural check can see) contests its edge with the
//      typed reason while supported pairs accrue check stamps; provenance
//      fields are untouched; checked pairs never re-enter the pool.
//   8. Recovery composes with the slice (d) write gate: an unretrieved
//      re-derivation is refused; a retrieval-gated one recovers the edge;
//      the unsupported-citation audit survives; judged-at-most-once means
//      no flap back into contest.
//   9. Failure honesty: a judge infrastructure failure raises and
//      contests NOTHING; the budget defers loudly; dead-byte pairs are
//      skipped and counted; the entailment job name round-trips through
//      the same verification worker.

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
// The single write path enforces the sourceNodeIds format (^[0-9a-f]{64}$,
// Session 14) — provenance hashes must be real 64-hex, so the drill derives
// them from token-scoped names. Still unique per run, still cleanable.
const H = (n: string) => crypto.createHash('sha256').update(`${TOKEN}:${n}`).digest('hex');
// Entailment-detector entities (sections 7-9) live under their own
// sub-prefix so the detector's pool selection stays hermetic.
const EQ = (n: string) => `${TOKEN}-ent-${n}`;

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

// The Session 31 research-run wiring: the writer carries the retrieval-
// membership gate (retrieved_addresses_check), and the run retrieves the
// given hashes through get_ast_texts BEFORE citing them — or doesn't, to
// prove the refusal. Section [8] uses this to show the slice (d) gate and
// the detector's recovery path compose.
async function writeGatedViaPython(facts: unknown[], retrieveHashes: string[]): Promise<void> {
  const py = [
    'import sys, json',
    "sys.path.insert(0, '.')",
    'from trellis_tools import TrellisNeo4j, TrellisPostgres, get_retrieved_addresses',
    'pg = TrellisPostgres()',
    'retrieve = json.loads(sys.argv[2])',
    'if retrieve:',
    '    pg.get_ast_texts(retrieve)',
    't = TrellisNeo4j(ast_existence_check=pg.ast_hashes_exist, retrieved_addresses_check=get_retrieved_addresses)',
    'print(t.write_derived_insights(json.loads(sys.argv[1])))',
    't.close()',
    'pg.close()'
  ].join('\n');
  await execFileAsync('python', ['-c', py, JSON.stringify(facts), JSON.stringify(retrieveHashes)], {
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

// An AST row that exists (so the write path accepts it) but carries no
// text — the detector must skip its pair, never judge it blind.
async function insertEmptyAstNode(hash: string): Promise<void> {
  const data = { id: hash, type: 'paragraph', children: [] };
  await pgPool.query(
    `INSERT INTO ast_nodes (id, document_id, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
    [hash, `${TOKEN}-root`, JSON.stringify(data)]
  );
}

interface InsightEdgeAudit {
  contested: boolean;
  contestedReason: string | null;
  sourceNodeIds: string[] | null;
  orphanedSourceIds: string[] | null;
  entailmentCheckedHashes: string[] | null;
  entailmentCheckedAt: string | null;
  unsupportedHashes: string[] | null;
  entailmentFlaggedAt: string | null;
}

async function insightEdgeState(subject: string, verb: string, object: string): Promise<InsightEdgeAudit | undefined> {
  const session = neo4jDriver.session();
  try {
    const res = await session.run(
      `MATCH (:Entity {name: $subject})-[r:DERIVED_INSIGHT {verb: $verb}]->(:Entity {name: $object})
       RETURN coalesce(r.contested, false) AS contested, r.contestedReason AS contestedReason,
              r.sourceNodeIds AS sourceNodeIds, r.orphanedSourceIds AS orphanedSourceIds,
              r.entailmentCheckedHashes AS entailmentCheckedHashes,
              r.entailmentCheckedAt AS entailmentCheckedAt,
              r.unsupportedHashes AS unsupportedHashes,
              r.entailmentFlaggedAt AS entailmentFlaggedAt`,
      { subject: subject.toLowerCase(), verb: verb.toLowerCase(), object: object.toLowerCase() }
    );
    const rec = res.records[0];
    if (!rec) return undefined;
    return {
      contested: rec.get('contested'),
      contestedReason: rec.get('contestedReason'),
      sourceNodeIds: rec.get('sourceNodeIds'),
      orphanedSourceIds: rec.get('orphanedSourceIds'),
      entailmentCheckedHashes: rec.get('entailmentCheckedHashes'),
      entailmentCheckedAt: rec.get('entailmentCheckedAt') == null ? null : String(rec.get('entailmentCheckedAt')),
      unsupportedHashes: rec.get('unsupportedHashes'),
      entailmentFlaggedAt: rec.get('entailmentFlaggedAt') == null ? null : String(rec.get('entailmentFlaggedAt'))
    };
  } finally {
    await session.close();
  }
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
  const hashes = beliefs.filter(b => b.text != null).map(b => H(`hash-${b.q}`));
  const freshHash = H('hash-qf-fresh');
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
      if (b.text != null) await insertAstText(H(`hash-${b.q}`), b.text);
    }
    await writeBeliefsViaPython(
      beliefs.map(b => ({
        subject: Q(b.q), verb: 'HAS_CATEGORY', obj: b.stored,
        sourceNodeIds: [H(`hash-${b.q}`)], confidence: b.confidence
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
      sourceNodeIds: [H('hash-qa')], tier: 'graduated'
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
    // Worker and queue stay open: section [9] round-trips the entailment
    // job name through the same worker before the drill closes them.

    // --- 7. Entailment detector: pairs, stamps, and the unsupported flag -----
    console.log('\n[7] entailment detector — sampled pairs, stamps, and the unsupported flag');
    const hashEA = H('ent-hash-ea');
    const hashEB = H('ent-hash-eb');
    const hashEC = H('ent-hash-ec');
    hashes.push(hashEA, hashEB, hashEC);
    await insertAstText(hashEA, 'The northern bridge was built in 1902.');
    await insertAstText(hashEB, 'The harbor master is named Wendel.');
    await insertAstText(hashEC, 'Grain tariffs doubled in the spring season.');
    await writeBeliefsViaPython([
      { subject: EQ('a'), verb: 'built_in', obj: '1902', sourceNodeIds: [hashEA], confidence: 0.9 },
      // Planted T2 laundering: hashEC is real ingested bytes that do NOT
      // support the claim — invisible to the existence and retrieval
      // layers by construction. Only entailment sees it.
      { subject: EQ('b'), verb: 'is_named', obj: 'wendel', sourceNodeIds: [hashEB, hashEC], confidence: 0.9 }
    ]);
    const entTruth: Record<string, boolean> = {
      [`${EQ('a')}|built_in|1902|${hashEA}`]: true,
      [`${EQ('b')}|is_named|wendel|${hashEB}`]: true,
      [`${EQ('b')}|is_named|wendel|${hashEC}`]: false
    };
    const entPolicy = defaultEntailmentPolicy({
      sampleRate: 1.0, // deterministic: every unchecked pair is judged
      judgeBudget: 10,
      subjectPrefix: `${TOKEN}-ent`
    });
    const entJudge = makeOracleEntailmentJudge(entTruth);

    const ent1 = await runEntailmentSweep(neo4jDriver, pgPool, entPolicy, entJudge);
    check('pool: 2 edges, 3 unchecked pairs', [ent1.poolEdges, ent1.poolPairs], [2, 3]);
    check('all pairs sampled at rate 1.0, none deferred', [ent1.sampled, ent1.deferred], [3, 0]);
    check('judged 3: 2 supported, 1 flagged on 1 edge', [ent1.judged, ent1.supported, ent1.flagged, ent1.edgesFlagged], [3, 2, 1, 1]);
    check('oracle mode costs zero sub-calls', ent1.usage.subcalls, 0);
    check('flag names the laundered pair', ent1.flags, [{ subject: EQ('b'), verb: 'is_named', object: 'wendel', hash: hashEC }]);

    const edgeA = await insightEdgeState(EQ('a'), 'built_in', '1902');
    check('supported edge not contested', edgeA?.contested, false);
    check('supported pair stamped', edgeA?.entailmentCheckedHashes, [hashEA]);
    check('check stamp carries a timestamp', edgeA?.entailmentCheckedAt != null, true);

    const edgeB = await insightEdgeState(EQ('b'), 'is_named', 'wendel');
    check('flagged edge contested through the ordinary machinery', edgeB?.contested, true);
    check("typed reason 'unsupported_citation'", edgeB?.contestedReason, 'unsupported_citation');
    check('unsupported hash recorded as durable audit', edgeB?.unsupportedHashes, [hashEC]);
    check('flag timestamp recorded', edgeB?.entailmentFlaggedAt != null, true);
    check('provenance INTACT — the flag never mutates sourceNodeIds', edgeB?.sourceNodeIds, [hashEB, hashEC]);
    check('orphan ledger untouched', edgeB?.orphanedSourceIds, null);
    check('the supported pair on the flagged edge is still stamped', edgeB?.entailmentCheckedHashes, [hashEB]);

    const ent2 = await runEntailmentSweep(neo4jDriver, pgPool, entPolicy, entJudge);
    check('contested edge leaves the pool; checked pair never re-selected', [ent2.poolEdges, ent2.poolPairs, ent2.judged], [1, 0, 0]);

    // --- 8. Recovery composes with the slice (d) write gate -------------------
    console.log('\n[8] recovery via a retrieval-gated re-derivation (the d gate composes)');
    let gateRefusal = '';
    try {
      await writeGatedViaPython([
        { subject: EQ('b'), verb: 'is_named', obj: 'wendel', sourceNodeIds: [hashEB], confidence: 0.9 }
      ], []);
    } catch (e: unknown) {
      const err = e as { stderr?: string; message?: string };
      gateRefusal = String(err.stderr ?? err.message ?? e);
    }
    check('unretrieved citation refused by the write gate', gateRefusal.includes('Provenance Violation'), true);
    check('refused re-derivation leaves the edge contested', (await insightEdgeState(EQ('b'), 'is_named', 'wendel'))?.contested, true);

    await writeGatedViaPython([
      { subject: EQ('b'), verb: 'is_named', obj: 'wendel', sourceNodeIds: [hashEB], confidence: 0.9 }
    ], [hashEB]);
    const edgeB2 = await insightEdgeState(EQ('b'), 'is_named', 'wendel');
    check('retrieved re-derivation recovers the edge', edgeB2?.contested, false);
    check('recovery preserves accumulated provenance (union semantics)', edgeB2?.sourceNodeIds, [hashEC, hashEB]);
    check('the unsupported-citation audit survives recovery', edgeB2?.unsupportedHashes, [hashEC]);

    const ent3 = await runEntailmentSweep(neo4jDriver, pgPool, entPolicy, entJudge);
    check('judged-at-most-once: the recovered edge does not flap back into contest', [ent3.poolEdges, ent3.poolPairs, ent3.flagged], [2, 0, 0]);
    check('recovered edge still clean after the sweep', (await insightEdgeState(EQ('b'), 'is_named', 'wendel'))?.contested, false);

    // --- 9. Failure honesty, the budget, and the queue round trip --------------
    console.log('\n[9] judge failure contests nothing; budget defers loudly; worker round trip');
    await writeBeliefsViaPython([
      { subject: EQ('c'), verb: 'references', obj: 'ledger', sourceNodeIds: [hashEA, hashEC], confidence: 0.8 }
    ]);
    const failingJudge: EntailmentJudge = async () => { throw new Error('judge infrastructure down'); };
    let judgeError = '';
    try {
      await runEntailmentSweep(neo4jDriver, pgPool, entPolicy, failingJudge);
    } catch (e: unknown) {
      judgeError = e instanceof Error ? e.message : String(e);
    }
    check('judge infrastructure failure raises, never verdicts', judgeError, 'judge infrastructure down');
    const edgeC = await insightEdgeState(EQ('c'), 'references', 'ledger');
    check('failed sweep contested nothing', edgeC?.contested, false);
    check('failed sweep stamped nothing', edgeC?.entailmentCheckedHashes, null);

    const budgetEdges = await selectInsightEdges(neo4jDriver, entPolicy);
    const budgetSel = sampleEntailmentPairs(budgetEdges, { ...entPolicy, judgeBudget: 1 });
    check('budget caps selection; overflow deferred, never silent', [budgetSel.pairs.length, budgetSel.sampled, budgetSel.deferred], [1, 2, 1]);

    const hashED = H('ent-hash-ed');
    hashes.push(hashED);
    await insertEmptyAstNode(hashED);
    await writeBeliefsViaPython([
      { subject: EQ('d'), verb: 'mentions', obj: 'nothing', sourceNodeIds: [hashED], confidence: 0.8 }
    ]);
    const ent4 = await runEntailmentSweep(neo4jDriver, pgPool, entPolicy, makeOracleEntailmentJudge({
      [`${EQ('c')}|references|ledger|${hashEA}`]: true,
      [`${EQ('c')}|references|ledger|${hashEC}`]: true
    }));
    check('dead-byte pair skipped and counted, never judged blind', [ent4.judged, ent4.skippedNoText], [2, 1]);
    const edgeD = await insightEdgeState(EQ('d'), 'mentions', 'nothing');
    check('skipped pair neither stamped nor contested', [edgeD?.entailmentCheckedHashes, edgeD?.contested], [null, false]);

    await writeBeliefsViaPython([
      { subject: EQ('e'), verb: 'notes', obj: 'harbor', sourceNodeIds: [hashEB], confidence: 0.8 }
    ]);
    const entJob = await verificationQueue.add(
      'entailment_sweep',
      {
        pairs: [{ subject: EQ('e'), verb: 'notes', object: 'harbor', hash: hashEB }],
        oracle: { [`${EQ('e')}|notes|harbor|${hashEB}`]: true },
        policyLabel: 'offline-test'
      },
      { removeOnComplete: true, removeOnFail: true }
    );
    const entOutcome = await Promise.race([
      new Promise<string>(resolve => {
        verificationWorker.on('completed', done => { if (done.id === entJob.id) resolve('completed'); });
        verificationWorker.on('failed', (failed, err) => { if (failed?.id === entJob.id) resolve(`failed: ${err.message}`); });
      }),
      new Promise<string>(resolve => setTimeout(() => resolve('timeout'), 30000))
    ]);
    check('worker processed the entailment job on the shared queue', entOutcome, 'completed');
    check('worker stamped the supported pair', (await insightEdgeState(EQ('e'), 'notes', 'harbor'))?.entailmentCheckedHashes, [hashEB]);

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
