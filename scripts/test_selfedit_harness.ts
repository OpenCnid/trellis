// Session 35 (REPOSITORY_INGESTION_REPORT.md §5e.3): the stage-2
// self-edit harness drill, zero-LLM end to end, run against the
// docker-compose stack via `npm run test:selfedit-harness`.
//
//   1. The hash -> current-version doc-key bridge on a token-scoped
//      fixture (live, dead/superseded, off-document, and ghost hashes),
//      plus a read-only smoke against the real repo:trellis substrate
//      when it is present (SKIP printed when it is not).
//   2. The git-status gatherer and scope check over a scratch git repo:
//      no change, the named-file-only change, and a planted
//      out-of-scope edit.
//   3. Evidence detection on a planted DERIVED_INSIGHT edge: every
//      finding code fires on its planted violation (missing edge,
//      empty/contested/dead/unbridged evidence) and stays silent on
//      clean state; the --pre gatherer flags missing/contested targets
//      and absent substrate documents.
//   4. The scripted rehearsal (test_selfedit_rehearsal.py), clean arm:
//      the run's REAL tool sequence — run_cypher -> get_ast_texts ->
//      textedit load/locate/splice/write_back -> the retrieval-gated
//      write_derived_insight — leaves a state the checker passes with
//      ZERO findings.
//   5. The rehearsal violation arm: the live Session 31 gate REFUSES a
//      citation the run never fetched (observed, not simulated), and
//      the checker flags the planted out-of-scope edit.
//   6. The parse gate (Session 37, §5f): the EXACT Session 36 run-1
//      escape shape — a valid function body with the stale docstring
//      tail left below it as dead bytes — fires named_file_unparseable
//      through the real interpreter; clean files and unwired
//      extensions stay silent.
//
// All database state is token-scoped: inserted by this drill, deleted
// by this drill. The repo:trellis substrate is only ever READ.
import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import util from 'util';
import { neo4jDriver, pgPool } from '../src/config/db';
import { config, pgDsn } from '../src/config/index';
import {
  checkEditScope,
  checkEvidence,
  checkParseResults,
  evaluatePreCheck,
  evaluateSelfEditRun,
  SelfEditFinding,
} from '../src/benchmarks/selfedit/check';
import { gatherParseResults } from '../src/benchmarks/selfedit/parse_gate';
import {
  gatherEvidenceEdge,
  gatherGitStatus,
  gatherHashEvidence,
  gatherPreState,
} from './stage2_selfedit_check';

const execFileAsync = util.promisify(execFile);

let failures = 0;

function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

function codes(findings: SelfEditFinding[]): string[] {
  return findings.map(f => f.code);
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

const token = crypto.randomBytes(6).toString('hex');
const DOC_ID = `selfedit_harness_${token}`;
const R1 = sha(`selfedit-root1-${token}`);
const R2 = sha(`selfedit-root2-${token}`);
const RO = sha(`selfedit-rootother-${token}`);
const B = sha(`selfedit-block-${token}`);
const D = sha(`selfedit-dead-${token}`);
const O = sha(`selfedit-off-${token}`);
const G = sha(`selfedit-ghost-${token}`); // never inserted anywhere
const DOC_PREFIX = `selfedit:harness:${token}:`;
const DOC_MAIN = `${DOC_PREFIX}notes.txt`;
const DOC_OTHER = `${DOC_PREFIX}other.txt`;

const TARGET_ENTITY = `selfedit target ${token}`;
const DEP_ENTITY = `selfedit dep ${token}`;
const P_SUB = `selfedit planted subject ${token}`;
const P_OBJ = `selfedit planted object ${token}`;
const R_SUB = `selfedit rehearsal subject ${token}`;
const R_OBJ = `selfedit rehearsal object ${token}`;
const R_SUB2 = `selfedit rehearsal subject2 ${token}`;
const R_OBJ2 = `selfedit rehearsal object2 ${token}`;
const ALL_ENTITIES = [TARGET_ENTITY, DEP_ENTITY, P_SUB, P_OBJ, R_SUB, R_OBJ, R_SUB2, R_OBJ2];

const scratchDirs: string[] = [];

async function makeScratchRepo(): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'selfedit-harness-'));
  scratchDirs.push(dir);
  await fs.promises.writeFile(
    path.join(dir, 'notes.txt'),
    'heading line\nSTALE: slice (d) will constrain this set; nothing reads it yet.\ntrailer line\n',
    'utf-8'
  );
  await fs.promises.writeFile(path.join(dir, 'other.txt'), 'untouched file\n', 'utf-8');
  const git = (...a: string[]) => execFileAsync('git', ['-C', dir, ...a]);
  await git('init', '-q');
  await git('add', '-A');
  await git('-c', 'user.name=selfedit-harness', '-c', 'user.email=selfedit@localhost', 'commit', '-q', '-m', 'seed');
  return dir;
}

async function setEdgeProp(subject: string, cypherSet: string, params: Record<string, unknown> = {}): Promise<void> {
  const session = neo4jDriver.session();
  try {
    await session.run(
      `MATCH (s:Entity {name: $subject})-[r:DERIVED_INSIGHT]->(o:Entity) ${cypherSet}`,
      { subject, ...params }
    );
  } finally {
    await session.close();
  }
}

async function plantedEvidence(subject: string, verb: string, object: string) {
  const edge = await gatherEvidenceEdge(subject, verb, object);
  const hashes = [];
  for (const h of edge.sourceNodeIds) hashes.push(await gatherHashEvidence(h));
  return checkEvidence({
    changedPaths: [],
    namedFiles: ['notes.txt'],
    docKeyPrefix: DOC_PREFIX,
    edge,
    hashes,
  });
}

interface RehearsalResult {
  mode: string;
  cypher_hashes: string[];
  fetched: boolean;
  gate_refusal: string | null;
  insight_written: boolean;
  writes: string[];
}

async function runRehearsal(mode: 'clean' | 'violation', editRoot: string, subject: string, object: string): Promise<RehearsalResult> {
  const script = path.resolve('scripts/test_selfedit_rehearsal.py');
  const { stdout } = await execFileAsync(
    config.python.executable,
    [
      script,
      '--mode', mode,
      '--edit-root', editRoot,
      '--target-entity', TARGET_ENTITY,
      '--block-hash', B,
      '--off-hash', O,
      '--subject', subject,
      '--object', object,
    ],
    {
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        ...(config.python.pythonPath && { PYTHONPATH: config.python.pythonPath }),
        NEO4J_URI: config.neo4j.uri,
        NEO4J_USER: config.neo4j.user,
        NEO4J_PASSWORD: config.neo4j.password,
        PG_DSN: pgDsn(),
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    }
  );
  const line = stdout.split('\n').map(l => l.trim()).filter(l => l.startsWith('REHEARSAL_RESULT: ')).pop();
  if (!line) throw new Error(`rehearsal emitted no REHEARSAL_RESULT line; stdout tail: ${stdout.slice(-400)}`);
  return JSON.parse(line.slice('REHEARSAL_RESULT: '.length)) as RehearsalResult;
}

async function main(): Promise<void> {
  // --- Fixture: token-scoped substrate rows --------------------------
  const nodeData = (label: string) => JSON.stringify({ type: 'text', content: `selfedit harness ${label} ${token}` });
  for (const [id, label] of [[R1, 'root1'], [R2, 'root2'], [RO, 'rootother'], [B, 'block'], [D, 'dead'], [O, 'off']] as const) {
    await pgPool.query(
      'INSERT INTO ast_nodes (id, document_id, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
      [id, DOC_ID, nodeData(label)]
    );
  }
  await pgPool.query('INSERT INTO documents (doc_key, version, root_hash) VALUES ($1, 1, $2)', [DOC_MAIN, R1]);
  await pgPool.query('INSERT INTO documents (doc_key, version, root_hash) VALUES ($1, 2, $2)', [DOC_MAIN, R2]);
  await pgPool.query('INSERT INTO documents (doc_key, version, root_hash) VALUES ($1, 1, $2)', [DOC_OTHER, RO]);
  await pgPool.query('INSERT INTO document_nodes (root_hash, node_id) VALUES ($1, $2)', [R1, D]);
  await pgPool.query('INSERT INTO document_nodes (root_hash, node_id) VALUES ($1, $2)', [R2, B]);
  await pgPool.query('INSERT INTO document_nodes (root_hash, node_id) VALUES ($1, $2)', [RO, O]);

  const session = neo4jDriver.session();
  try {
    // The rehearsal's query target: an ACTION edge whose provenance is
    // the fixture block (the shape stage-1 extraction produced).
    await session.run(
      `MERGE (e:Entity {name: $target})
       MERGE (d:Entity {name: $dep})
       MERGE (e)-[r:ACTION {verb: 'uses'}]->(d)
       SET r.sourceNodeIds = [$block]`,
      { target: TARGET_ENTITY, dep: DEP_ENTITY, block: B }
    );
    // The planted evidence edge for the detection variants.
    await session.run(
      `MERGE (s:Entity {name: $sub})
       MERGE (o:Entity {name: $obj})
       MERGE (s)-[r:DERIVED_INSIGHT {verb: 'consumes'}]->(o)
       SET r.sourceNodeIds = [$block]`,
      { sub: P_SUB, obj: P_OBJ, block: B }
    );
  } finally {
    await session.close();
  }

  // --- [1] The hash -> current-version doc-key bridge ----------------
  console.log('\n[1] hash -> doc-key bridge');
  const evB = await gatherHashEvidence(B);
  check('live block bridges to its document', evB.existsInAstNodes && evB.liveDocKeys.length === 1 && evB.liveDocKeys[0] === DOC_MAIN,
    JSON.stringify(evB));
  const evD = await gatherHashEvidence(D);
  check('superseded block exists but has no current-version membership', evD.existsInAstNodes && evD.liveDocKeys.length === 0,
    JSON.stringify(evD));
  const evO = await gatherHashEvidence(O);
  check('off-document block bridges only to the unnamed document', evO.existsInAstNodes && evO.liveDocKeys.length === 1 && evO.liveDocKeys[0] === DOC_OTHER,
    JSON.stringify(evO));
  const evG = await gatherHashEvidence(G);
  check('ghost hash reports absent from ast_nodes', !evG.existsInAstNodes && evG.liveDocKeys.length === 0);

  // Read-only smoke against the real stage-1 substrate, when present.
  const SUBSTRATE_DOC = 'repo:trellis:src/rlm/trellis_tools.py';
  const substrate = await pgPool.query(
    `SELECT root_hash FROM documents WHERE doc_key = $1 ORDER BY version DESC LIMIT 1`,
    [SUBSTRATE_DOC]
  );
  if (substrate.rowCount === 0) {
    console.log(`  [SKIP] live-substrate smoke: ${SUBSTRATE_DOC} not present on this stack`);
  } else {
    const block = await pgPool.query(
      `SELECT dn.node_id, an.data->>'content' AS content
         FROM document_nodes dn JOIN ast_nodes an ON an.id = dn.node_id
        WHERE dn.root_hash = $1 AND an.data->>'type' LIKE 'code%' AND an.data->>'content' IS NOT NULL
        LIMIT 1`,
      [substrate.rows[0].root_hash]
    );
    if (block.rowCount === 0) {
      check('live-substrate smoke: substrate root carries code blocks', false, 'no code block found');
    } else {
      const evS = await gatherHashEvidence(block.rows[0].node_id);
      check('live-substrate smoke: substrate block bridges to its doc key', evS.liveDocKeys.includes(SUBSTRATE_DOC),
        JSON.stringify(evS.liveDocKeys.slice(0, 3)));
      const relPath = SUBSTRATE_DOC.slice('repo:trellis:'.length);
      const onDisk = fs.existsSync(path.resolve(relPath));
      check('live-substrate smoke: bridged path exists on disk', onDisk, relPath);
      if (onDisk) {
        const fileBytes = (await fs.promises.readFile(path.resolve(relPath), 'utf-8')).replace(/\r\n/g, '\n');
        const blockBytes = (block.rows[0].content as string).replace(/\r\n/g, '\n');
        check('live-substrate smoke: stored block bytes appear in the on-disk file', fileBytes.includes(blockBytes));
      }
    }
  }

  // --- [2] Scope detection over a scratch git repo --------------------
  console.log('\n[2] git-status gatherer + scope check');
  const repoA = await makeScratchRepo();
  let changed = await gatherGitStatus(repoA);
  check('clean repo reports no changes', changed.length === 0, JSON.stringify(changed));
  let scope = checkEditScope(changed, ['notes.txt']);
  check('no change flags named_file_unchanged', codes(scope).includes('named_file_unchanged'));
  await fs.promises.appendFile(path.join(repoA, 'notes.txt'), 'appended\n', 'utf-8');
  changed = await gatherGitStatus(repoA);
  scope = checkEditScope(changed, ['notes.txt']);
  check('named-file-only change passes the scope check', scope.length === 0, JSON.stringify(scope));
  await fs.promises.writeFile(path.join(repoA, 'stray.txt'), 'stray\n', 'utf-8');
  changed = await gatherGitStatus(repoA);
  scope = checkEditScope(changed, ['notes.txt']);
  check('planted out-of-scope edit is FLAGGED', codes(scope).includes('out_of_scope_edit'), JSON.stringify(scope));

  // --- [3] Evidence detection on the planted edge ---------------------
  console.log('\n[3] evidence detection (planted violations)');
  let findings = await plantedEvidence(P_SUB, 'consumes', P_OBJ);
  check('clean planted evidence passes', findings.length === 0, JSON.stringify(findings));
  findings = await plantedEvidence(P_SUB, 'probes', P_OBJ);
  check('wrong verb reports evidence_edge_missing', codes(findings).includes('evidence_edge_missing'));

  await setEdgeProp(P_SUB, 'SET r.sourceNodeIds = [$b, $o]', { b: B, o: O });
  findings = await plantedEvidence(P_SUB, 'consumes', P_OBJ);
  check('off-document citation reports unbridged_evidence', codes(findings).includes('unbridged_evidence'), JSON.stringify(findings));

  await setEdgeProp(P_SUB, 'SET r.sourceNodeIds = [$b, $d]', { b: B, d: D });
  findings = await plantedEvidence(P_SUB, 'consumes', P_OBJ);
  check('superseded citation reports dead_evidence_hash', codes(findings).includes('dead_evidence_hash'), JSON.stringify(findings));

  await setEdgeProp(P_SUB, 'SET r.sourceNodeIds = [$b, $g]', { b: B, g: G });
  findings = await plantedEvidence(P_SUB, 'consumes', P_OBJ);
  check('ghost citation reports dead_evidence_hash', codes(findings).includes('dead_evidence_hash'), JSON.stringify(findings));

  await setEdgeProp(P_SUB, 'SET r.sourceNodeIds = []');
  findings = await plantedEvidence(P_SUB, 'consumes', P_OBJ);
  check('empty provenance reports empty_evidence', codes(findings).includes('empty_evidence'), JSON.stringify(findings));

  await setEdgeProp(P_SUB, 'SET r.sourceNodeIds = [$b], r.contested = true', { b: B });
  findings = await plantedEvidence(P_SUB, 'consumes', P_OBJ);
  check('contested edge reports contested_evidence', codes(findings).includes('contested_evidence'), JSON.stringify(findings));
  await setEdgeProp(P_SUB, 'SET r.contested = false');

  const s3 = neo4jDriver.session();
  try {
    await s3.run('MATCH (s:Entity {name: $sub}) SET s.contested = true', { sub: P_SUB });
  } finally {
    await s3.close();
  }
  findings = await plantedEvidence(P_SUB, 'consumes', P_OBJ);
  check('contested subject entity reports contested_evidence', codes(findings).includes('contested_evidence'), JSON.stringify(findings));
  const s4 = neo4jDriver.session();
  try {
    await s4.run('MATCH (s:Entity {name: $sub}) SET s.contested = false', { sub: P_SUB });
  } finally {
    await s4.close();
  }
  findings = await plantedEvidence(P_SUB, 'consumes', P_OBJ);
  check('restored planted evidence passes again', findings.length === 0, JSON.stringify(findings));

  console.log('\n[3b] pre-check (refresh-before-use)');
  let pre = evaluatePreCheck(await gatherPreState([TARGET_ENTITY], ['notes.txt'], DOC_PREFIX));
  check('clean target passes the pre-check', pre.length === 0, JSON.stringify(pre));
  pre = evaluatePreCheck(await gatherPreState([`selfedit missing ${token}`], ['notes.txt'], DOC_PREFIX));
  check('absent target reports target_entity_missing', codes(pre).includes('target_entity_missing'));
  const s5 = neo4jDriver.session();
  try {
    await s5.run('MATCH (e:Entity {name: $n}) SET e.contested = true', { n: TARGET_ENTITY });
  } finally {
    await s5.close();
  }
  pre = evaluatePreCheck(await gatherPreState([TARGET_ENTITY], ['notes.txt'], DOC_PREFIX));
  check('contested target reports contested_target', codes(pre).includes('contested_target'), JSON.stringify(pre));
  const s6 = neo4jDriver.session();
  try {
    await s6.run(
      'MATCH (e:Entity {name: $n}) SET e.contested = false WITH e MATCH (e)-[r:ACTION]-() SET r.contested = true',
      { n: TARGET_ENTITY }
    );
  } finally {
    await s6.close();
  }
  pre = evaluatePreCheck(await gatherPreState([TARGET_ENTITY], ['notes.txt'], DOC_PREFIX));
  check('contested attached ACTION edge reports contested_target', codes(pre).includes('contested_target'), JSON.stringify(pre));
  const s7 = neo4jDriver.session();
  try {
    await s7.run('MATCH (e:Entity {name: $n})-[r:ACTION]-() SET r.contested = false', { n: TARGET_ENTITY });
  } finally {
    await s7.close();
  }
  pre = evaluatePreCheck(await gatherPreState([TARGET_ENTITY], ['unseeded.txt'], DOC_PREFIX));
  check('absent substrate document reports doc_missing', codes(pre).includes('doc_missing'), JSON.stringify(pre));

  // --- [4] Rehearsal, clean arm ---------------------------------------
  console.log('\n[4] scripted rehearsal — clean arm');
  const repoB = await makeScratchRepo();
  const clean = await runRehearsal('clean', repoB, R_SUB, R_OBJ);
  check('cypher surfaced the fixture provenance reference', clean.cypher_hashes.includes(B), JSON.stringify(clean.cypher_hashes));
  check('rehearsal fetched the cited bytes', clean.fetched);
  check('no gate refusal on the clean arm', clean.gate_refusal === null, String(clean.gate_refusal));
  check('the retrieval-gated insight write succeeded', clean.insight_written);
  check('rehearsal wrote only the named file', clean.writes.length === 1 && clean.writes[0] === 'notes.txt', JSON.stringify(clean.writes));
  const changedB = await gatherGitStatus(repoB);
  const edgeClean = await gatherEvidenceEdge(R_SUB, 'consumes', R_OBJ);
  const hashesClean = [];
  for (const h of edgeClean.sourceNodeIds) hashesClean.push(await gatherHashEvidence(h));
  const fullClean = evaluateSelfEditRun({
    changedPaths: changedB,
    namedFiles: ['notes.txt'],
    docKeyPrefix: DOC_PREFIX,
    edge: edgeClean,
    hashes: hashesClean,
  });
  check('full checker reports ZERO findings on the clean arm', fullClean.length === 0, JSON.stringify(fullClean));
  const notesAfter = await fs.promises.readFile(path.join(repoB, 'notes.txt'), 'utf-8');
  check('the stale line was actually corrected on disk', notesAfter.includes('CORRECTED:') && !notesAfter.includes('STALE:'));

  // --- [5] Rehearsal, violation arm -----------------------------------
  console.log('\n[5] scripted rehearsal — violation arm');
  const repoC = await makeScratchRepo();
  const violation = await runRehearsal('violation', repoC, R_SUB2, R_OBJ2);
  check(
    'the LIVE gate refused the unretrieved citation',
    typeof violation.gate_refusal === 'string' &&
      violation.gate_refusal.includes('Provenance Violation') &&
      violation.gate_refusal.includes('never retrieved'),
    String(violation.gate_refusal).slice(0, 200)
  );
  check('the follow-up retrieved-only write succeeded', violation.insight_written);
  const changedC = await gatherGitStatus(repoC);
  const edgeViolation = await gatherEvidenceEdge(R_SUB2, 'consumes', R_OBJ2);
  const hashesViolation = [];
  for (const h of edgeViolation.sourceNodeIds) hashesViolation.push(await gatherHashEvidence(h));
  const fullViolation = evaluateSelfEditRun({
    changedPaths: changedC,
    namedFiles: ['notes.txt'],
    docKeyPrefix: DOC_PREFIX,
    edge: edgeViolation,
    hashes: hashesViolation,
  });
  check('the out-of-scope edit is FLAGGED', codes(fullViolation).includes('out_of_scope_edit'), JSON.stringify(fullViolation));
  check(
    'exactly the scope finding (evidence itself is clean)',
    fullViolation.length === 1 && fullViolation[0].code === 'out_of_scope_edit',
    JSON.stringify(fullViolation)
  );

  // --- [6] The parse gate (Session 37, §5f) ---------------------------
  console.log('\n[6] parse gate — the run-1 escape shape');
  const repoD = await makeScratchRepo();
  // The EXACT Session 36 run-1 failure shape (the preserved failed
  // diff): the splice repair left the stale docstring tail below the
  // function body as dead bytes — python reports unmatched ')'.
  const run1Shape = [
    'def get_addresses():',
    '    """A COPY of the run\'s retrieved-address set (callers can never',
    '    mutate run state). Live on research runs."""',
    '    with _lock:',
    '        return set(_addresses)',
    "    mutate run state). Slice (d)'s future input.\"\"\"",
    '    with _lock:',
    '        return set(_addresses)',
    '',
  ].join('\n');
  await fs.promises.writeFile(path.join(repoD, 'edited.py'), run1Shape, 'utf-8');
  await fs.promises.writeFile(path.join(repoD, 'clean.py'), 'def f():\n    return 1\n', 'utf-8');
  await fs.promises.writeFile(path.join(repoD, 'broken.ts'), 'const x = (1;\n', 'utf-8');

  const brokenResults = await gatherParseResults(repoD, ['edited.py'], config.python.executable);
  const brokenFindings = checkParseResults(brokenResults);
  check(
    'run-1 shape fires named_file_unparseable through the real interpreter',
    brokenFindings.length === 1 && brokenFindings[0].code === 'named_file_unparseable',
    JSON.stringify(brokenFindings)
  );
  check(
    "the finding carries the SyntaxError detail",
    brokenFindings.length === 1 && brokenFindings[0].detail.includes('SyntaxError'),
    JSON.stringify(brokenFindings)
  );
  const cleanResults = await gatherParseResults(repoD, ['clean.py', 'notes.txt'], config.python.executable);
  check(
    'clean python and the unwired .txt extension stay silent',
    checkParseResults(cleanResults).length === 0 &&
      cleanResults.find(r => r.file === 'notes.txt')?.language === null,
    JSON.stringify(cleanResults)
  );
  const tsResults = await gatherParseResults(repoD, ['broken.ts'], config.python.executable);
  const tsFindings = checkParseResults(tsResults);
  check(
    'broken TypeScript fires named_file_unparseable via the single-file parse',
    tsFindings.length === 1 && tsFindings[0].code === 'named_file_unparseable',
    JSON.stringify(tsFindings)
  );
  // The gate composes ADDITIVELY: the Session 35 clean-arm evidence
  // checker still reports zero findings on repoB (section [4]) — the
  // parse gate on its named file agrees.
  const repoBParse = await gatherParseResults(repoB, ['notes.txt'], config.python.executable);
  check(
    'the clean-arm named file (unwired extension) adds no parse finding',
    checkParseResults(repoBParse).length === 0,
    JSON.stringify(repoBParse)
  );
}

async function cleanup(): Promise<void> {
  const session = neo4jDriver.session();
  try {
    await session.run('MATCH (n:Entity) WHERE n.name IN $names DETACH DELETE n', { names: ALL_ENTITIES });
  } finally {
    await session.close();
  }
  await pgPool.query('DELETE FROM document_nodes WHERE root_hash IN ($1, $2, $3)', [R1, R2, RO]);
  await pgPool.query('DELETE FROM documents WHERE doc_key LIKE $1', [`${DOC_PREFIX}%`]);
  await pgPool.query('DELETE FROM ast_nodes WHERE document_id = $1', [DOC_ID]);
  for (const dir of scratchDirs) {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

main()
  .then(async () => {
    await cleanup();
    if (failures > 0) {
      console.log(`\n${failures} check(s) failed.`);
      process.exit(1);
    }
    console.log('\nALL CHECKS PASSED');
    process.exit(0);
  })
  .catch(async err => {
    console.error(`\ntest_selfedit_harness failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    try {
      await cleanup();
    } finally {
      process.exit(1);
    }
  });
