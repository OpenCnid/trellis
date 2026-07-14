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
//   7. The comment-class diff gate (Session 39, §5g): the EXACT
//      Session 37 run-2 escape shape — a comment window replaced with
//      comment-only lines that DROP the executable neighbor and a
//      comment head, leaving a file that still parses — fires
//      named_file_noncomment_change through the real git binary; the
//      parse gate's structural blindness to the same edit is observed;
//      a genuine comment-only edit stays silent.
//   8. The rehearsal guarded arm (Session 41, STRUCTURAL_SPLICE.md §6
//      item 4): the same real sequence through the guarded splice
//      family — one OBSERVED AnchorMismatchError refusal (a
//      retyped-from-memory expected line), the taught self-correction,
//      a guarded-only telemetry split (raw_splices 0), the Session 31
//      gated write, and the full checker at ZERO findings with the
//      edited file's neighbors byte-intact.
//   9. The Session 50 scaffolds (RLM_HARNESS_SCAFFOLDING.md) on the
//      guarded arm: the trellis_task re-read by code, region_equal
//      verification, and the citable() probe MIRROR-PINNED against
//      gatherHashEvidence over the same fixture (the two liveness
//      joins move together, never a silent divergence).
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
  checkCommentClassDiff,
  checkEditScope,
  checkEvidence,
  checkParseResults,
  commentMarkerForFile,
  evaluatePreCheck,
  evaluateSelfEditRun,
  parseUnifiedDiffChangedLines,
  SelfEditFinding,
} from '../src/benchmarks/selfedit/check';
import { gatherParseResults } from '../src/benchmarks/selfedit/parse_gate';
import {
  gatherEvidenceEdge,
  gatherGitDiff,
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
const R_SUB3 = `selfedit rehearsal subject3 ${token}`;
const R_OBJ3 = `selfedit rehearsal object3 ${token}`;
const ALL_ENTITIES = [TARGET_ENTITY, DEP_ENTITY, P_SUB, P_OBJ, R_SUB, R_OBJ, R_SUB2, R_OBJ2, R_SUB3, R_OBJ3];

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

interface CitableEntry {
  retrieved: boolean;
  exists: boolean;
  live_doc_keys: string[];
  bridges_named_file: boolean;
  citable: boolean;
}

interface RehearsalResult {
  mode: string;
  cypher_hashes: string[];
  fetched: boolean;
  gate_refusal: string | null;
  anchor_refusal: string | null;
  guarded_ops: number;
  raw_splices: number;
  insight_written: boolean;
  writes: string[];
  task_grep_total: number | null;
  region_verified: boolean | null;
  citable_report: Record<string, CitableEntry> | null;
}

async function runRehearsal(mode: 'clean' | 'violation' | 'guarded', editRoot: string, subject: string, object: string): Promise<RehearsalResult> {
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
      '--dead-hash', D,
      '--ghost-hash', G,
      '--doc-prefix', DOC_PREFIX,
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

  // --- [7] The comment-class diff gate (Session 39, §5g) ---------------
  console.log('\n[7] comment-class diff gate — the run-2 escape shape');
  const repoE = await makeScratchRepo();
  const gitE = (...a: string[]) => execFileAsync('git', ['-C', repoE, ...a]);
  const telemetryPath = path.join(repoE, 'telemetry.py');
  const seedLines = [
    'def main():',
    '    stats = {',
    '        "answer_submits": get_answer_submit_count(),',
    '        # Session 30: the size of the retrieved-address set -- a',
    '        # count only, never the addresses (T16). Bookkeeping;',
    '        # slice (d) will constrain citable addresses to the set.',
    '        "retrieved_addresses": get_retrieved_address_count(),',
    '        # Session 33: retrieval-discipline activity -- counts',
    '        # only, never an identity (T16).',
    '    }',
    '    return stats',
    '',
  ];
  await fs.promises.writeFile(telemetryPath, seedLines.join('\n'), 'utf-8');
  await gitE('add', 'telemetry.py');
  await gitE('-c', 'user.name=selfedit-harness', '-c', 'user.email=selfedit@localhost', 'commit', '-q', '-m', 'seed telemetry');

  // The EXACT run-2 shape: the stale comment window is replaced with
  // comment-only lines, but the hand-retyped window DROPS the
  // executable "retrieved_addresses" line and the Session 33 comment
  // head. The file still parses.
  const run2Lines = [...seedLines];
  run2Lines.splice(5, 3, // replaces the stale comment + executable + comment head
    '        # slice (d) is live: this file wires the accessor into',
    '        # the write gate through the constructor seam on',
    '        # research runs.'
  );
  await fs.promises.writeFile(telemetryPath, run2Lines.join('\n'), 'utf-8');

  const run2Parse = checkParseResults(await gatherParseResults(repoE, ['telemetry.py'], config.python.executable));
  check(
    'the run-2 shape still PARSES (the blindness this gate closes)',
    run2Parse.length === 0,
    JSON.stringify(run2Parse)
  );
  const marker = commentMarkerForFile('telemetry.py');
  check('the .py marker is wired', marker === '#', String(marker));
  const run2Diff = await gatherGitDiff(repoE, 'telemetry.py');
  const run2Changed = parseUnifiedDiffChangedLines(run2Diff);
  check(
    'the real git diff surfaces the dropped executable line on the removed side',
    run2Changed.some(l => l.side === 'removed' && l.text.includes('get_retrieved_address_count')),
    JSON.stringify(run2Changed.slice(0, 8))
  );
  const run2Findings = checkCommentClassDiff('telemetry.py', marker as string, run2Changed);
  check(
    'run-2 shape fires named_file_noncomment_change through the real git binary',
    run2Findings.length >= 1 && run2Findings.every(f => f.code === 'named_file_noncomment_change'),
    JSON.stringify(run2Findings)
  );
  check(
    'the finding names the dropped executable line',
    run2Findings.some(f => f.detail.includes('retrieved_addresses') && f.detail.includes('removed')),
    JSON.stringify(run2Findings)
  );

  // Clean arm: a genuine comment-only correction (the executable line
  // and its neighbors preserved) stays silent.
  const cleanLines = [...seedLines];
  cleanLines[5] = '        # slice (d) is live: the constructor seam wires the set.';
  await fs.promises.writeFile(telemetryPath, cleanLines.join('\n'), 'utf-8');
  const cleanDiff = await gatherGitDiff(repoE, 'telemetry.py');
  const cleanFindings = checkCommentClassDiff(
    'telemetry.py',
    marker as string,
    parseUnifiedDiffChangedLines(cleanDiff)
  );
  check('a genuine comment-only edit stays silent', cleanFindings.length === 0, JSON.stringify(cleanFindings));
  const cleanParse = checkParseResults(await gatherParseResults(repoE, ['telemetry.py'], config.python.executable));
  check('the clean comment edit also parses', cleanParse.length === 0, JSON.stringify(cleanParse));

  // An undeclared (unchanged) file: empty diff, zero changed lines,
  // zero findings — the gate never fires where nothing changed.
  const untouchedDiff = await gatherGitDiff(repoE, 'other.txt');
  check(
    'an unchanged file yields an empty diff and zero changed lines',
    untouchedDiff === '' && parseUnifiedDiffChangedLines(untouchedDiff).length === 0,
    JSON.stringify(untouchedDiff.slice(0, 80))
  );

  // --- [8] Rehearsal, guarded arm (Session 41, STRUCTURAL_SPLICE.md) ---
  console.log('\n[8] scripted rehearsal — guarded splice family arm');
  const repoF = await makeScratchRepo();
  const guarded = await runRehearsal('guarded', repoF, R_SUB3, R_OBJ3);
  check(
    'the LIVE anchor guard refused the retyped-from-memory expected line',
    typeof guarded.anchor_refusal === 'string' &&
      guarded.anchor_refusal.includes('Anchor mismatch') &&
      guarded.anchor_refusal.includes('never retype'),
    String(guarded.anchor_refusal).slice(0, 200)
  );
  check(
    'the run was guarded-only (the executable-class criterion lever)',
    guarded.guarded_ops === 1 && guarded.raw_splices === 0,
    JSON.stringify({ guarded_ops: guarded.guarded_ops, raw_splices: guarded.raw_splices })
  );
  check('the retrieval-gated insight write succeeded on the guarded arm', guarded.insight_written);
  check('the guarded arm wrote only the named file', guarded.writes.length === 1 && guarded.writes[0] === 'notes.txt', JSON.stringify(guarded.writes));
  const changedF = await gatherGitStatus(repoF);
  const edgeGuarded = await gatherEvidenceEdge(R_SUB3, 'consumes', R_OBJ3);
  const hashesGuarded = [];
  for (const h of edgeGuarded.sourceNodeIds) hashesGuarded.push(await gatherHashEvidence(h));
  const fullGuarded = evaluateSelfEditRun({
    changedPaths: changedF,
    namedFiles: ['notes.txt'],
    docKeyPrefix: DOC_PREFIX,
    edge: edgeGuarded,
    hashes: hashesGuarded,
  });
  check('full checker reports ZERO findings on the guarded arm', fullGuarded.length === 0, JSON.stringify(fullGuarded));
  const notesGuarded = await fs.promises.readFile(path.join(repoF, 'notes.txt'), 'utf-8');
  const notesGuardedLines = notesGuarded.split('\n');
  check(
    'the guarded edit corrected the stale line with both neighbors byte-intact',
    notesGuardedLines[0] === 'heading line' &&
      notesGuardedLines[1].startsWith('CORRECTED:') &&
      notesGuardedLines[2] === 'trailer line' &&
      !notesGuarded.includes('STALE:'),
    JSON.stringify(notesGuardedLines.slice(0, 3))
  );

  // --- [9] The Session 50 scaffolds on the guarded arm -----------------
  // (RLM_HARNESS_SCAFFOLDING.md): the task surface re-read by code, the
  // region asserted through the staged helper, and the citable() probe
  // MIRROR-PINNED against the TypeScript gatherHashEvidence over the
  // same fixture — the two liveness joins move together or this fails.
  console.log('\n[9] scaffolds on the guarded arm (task re-read, region_equal, citable mirror pin)');
  check('the rehearsal re-read its task by code (grep hits)', (guarded.task_grep_total ?? 0) >= 1,
    String(guarded.task_grep_total));
  check('the edited region verified as a LIST through region_equal', guarded.region_verified === true,
    String(guarded.region_verified));
  const rep = guarded.citable_report;
  check('the citable probe reported on all four fixture hashes',
    rep !== null && [B, O, D, G].every(h => h in (rep ?? {})),
    JSON.stringify(Object.keys(rep ?? {})));
  if (rep) {
    check(
      'fetched + named-file-bridging block reports citable (B)',
      rep[B].citable === true && rep[B].retrieved === true && rep[B].bridges_named_file === true,
      JSON.stringify(rep[B])
    );
    check(
      'mirror pin: citable live_doc_keys equal gatherHashEvidence liveDocKeys (B)',
      JSON.stringify(rep[B].live_doc_keys) === JSON.stringify(evB.liveDocKeys),
      JSON.stringify({ python: rep[B].live_doc_keys, typescript: evB.liveDocKeys })
    );
    check(
      'off-document block reports unbridged and uncitable (O)',
      rep[O].citable === false && rep[O].bridges_named_file === false &&
        JSON.stringify(rep[O].live_doc_keys) === JSON.stringify(evO.liveDocKeys),
      JSON.stringify({ python: rep[O], typescript: evO.liveDocKeys })
    );
    check(
      'mirror pin: the superseded block reports empty membership on both sides (D)',
      rep[D].exists === true && rep[D].live_doc_keys.length === 0 &&
        evD.existsInAstNodes && evD.liveDocKeys.length === 0,
      JSON.stringify({ python: rep[D], typescript: evD })
    );
    check(
      'mirror pin: the ghost hash reports absent on both sides (G)',
      rep[G].exists === false && !evG.existsInAstNodes && rep[G].citable === false,
      JSON.stringify({ python: rep[G], typescript: evG })
    );
  }
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
