import { execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import util from 'util';
import { pgPool, neo4jDriver } from '../src/config/db';
import { config } from '../src/config/index';
import { parseSourceFile } from '../src/core/ast/source_parser';
import { flattenAST, collectExtractionBlocks, nodeText } from '../src/core/ast/traverse';
import { rederiveAstNodeId, type ASTNode } from '../src/core/ast/parser';
import { findGloballyOrphanedAstNodeIds } from '../src/core/ast/registry';
import {
  emptyDocumentRoot,
  ingestDocument,
  ingestTombstone,
  type IngestDeps,
} from '../src/core/ingestion/ingest_document';
import { globalEntityId } from '../src/core/graph/resolve_actions';
import { mergeExtractedGraph, type EnrichedAction } from '../src/core/graph/extraction_merge';
import { sweepOrphanedProvenance } from '../src/core/graph/invalidation';
import { scanRepository } from '../src/core/repository/scanner';
import { createPgSnapshotStore } from '../src/core/repository/snapshot_store';
import {
  executeRepositorySnapshot,
  planRepositorySnapshot,
  type SnapshotDeps,
  type SnapshotOptions,
} from '../src/core/repository/snapshot_ingest';
import { loggerFor } from '../src/core/observability/logger';

// Session 8 live drill: whole-codebase ingestion, zero LLM calls.
//
// Copies the committed multi-language fixture (fixtures/repo_ingest)
// into a temporary git repository plus hostile entries (binary,
// oversize, unsupported, vendor dir, escaping symlink), then proves:
//   1. a fresh snapshot through the real CLI (--extract none): one
//      latest document per accepted path, verified AST membership,
//      zero extraction jobs, published snapshot, pinned skip counts;
//   2. an unchanged rerun is an auditable no-op snapshot;
//   3. a one-method edit re-ingests only that file with a minimal
//      Merkle diff (method + class + root);
//   4. deletion and rename produce tombstones; globally orphaned
//      provenance quarantines seeded facts while renamed (shared) bytes
//      keep theirs alive; renamed content gets a distinct doc key;
//   5. a forced single-file failure leaves the previous snapshot
//      effective, tombstones nothing, and a retry recovers.
//
// Sweeps mirror the invalidation worker exactly (global reduction, then
// sweepOrphanedProvenance) so no background worker needs to run and no
// Redis job is written: library phases capture queue payloads in memory.

const execFileAsync = util.promisify(execFile);

// A dedicated queue handle (not workers/queue.ts) so the drill can read
// extraction_queue depth without registering worker shutdown hooks.
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
const redisConnection = new IORedis({
  host: config.redis.host,
  port: config.redis.port,
  maxRetriesPerRequest: null,
});
const extractionQueueHandle = new Queue('extraction_queue', { connection: redisConnection });

async function extractionQueueDepth(): Promise<number> {
  const counts = await extractionQueueHandle.getJobCounts('waiting', 'active', 'delayed', 'prioritized');
  return (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0) + (counts.prioritized ?? 0);
}

const TOKEN = `repo-drill-${Date.now()}`;
const REPO_KEY = TOKEN;
const FIXTURE_DIR = path.resolve('fixtures/repo_ingest');
const MAX_FILE_BYTES = 4096;
const PARSE_OPTS = { pythonExecutable: config.python.executable };
const log = loggerFor({ component: 'repo_ingest_drill' });

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
  if (!ok) failures++;
}

function docKeyFor(relPath: string): string {
  return `repo:${REPO_KEY}:${relPath}`;
}

async function git(repoRoot: string, ...args: string[]): Promise<void> {
  await execFileAsync('git', [
    '-C', repoRoot,
    '-c', 'user.email=drill@example.invalid',
    '-c', 'user.name=Repo Drill',
    '-c', 'core.autocrlf=false',
    ...args,
  ]);
}

interface CapturedSweep {
  docKey: string;
  orphanedHashes: string[];
  freshHashes: string[];
}

function makeLibraryDeps(
  captured: CapturedSweep[],
  failForPathSuffix?: string,
  capturedExtraction?: Array<{ name: string; data: Record<string, unknown> }>
): SnapshotDeps {
  const queues: IngestDeps['queues'] = {
    extraction: {
      // Session 25 (Part 6): a changed-mode drill captures jobs in
      // memory — nothing ever reaches Redis, so nothing can be paid.
      addBulk: async jobs => {
        if (!capturedExtraction) {
          throw new Error(`unexpected extraction enqueue of ${jobs.length} job(s) under --extract none`);
        }
        capturedExtraction.push(...(jobs as Array<{ name: string; data: Record<string, unknown> }>));
      },
    },
    invalidation: {
      add: async (_name, data) => {
        captured.push({
          docKey: data.docKey as string,
          orphanedHashes: data.orphanedHashes as string[],
          freshHashes: data.freshHashes as string[],
        });
      },
    },
  };
  const ingestDeps: IngestDeps = { pgPool, queues, log };
  return {
    store: createPgSnapshotStore(pgPool),
    scan: scanRepository,
    readFile: (root, relPath) => fs.readFile(path.join(root, relPath)),
    parse: (relPath, bytes) => parseSourceFile(relPath, bytes, PARSE_OPTS),
    ingestDocument: async request => {
      if (failForPathSuffix && request.docKey.endsWith(failForPathSuffix)) {
        throw new Error(`forced drill failure for ${request.docKey}`);
      }
      return ingestDocument(ingestDeps, request);
    },
    ingestTombstone: (docKey, requestId) => ingestTombstone(ingestDeps, docKey, requestId),
    log,
  };
}

async function runSnapshot(deps: SnapshotDeps, root: string, extra?: Partial<SnapshotOptions>) {
  const options: SnapshotOptions = {
    root,
    repoKey: REPO_KEY,
    policy: { mode: 'none' },
    maxFileBytes: MAX_FILE_BYTES,
    requestId: crypto.randomUUID(),
    ...extra,
  };
  const plan = await planRepositorySnapshot(deps, options);
  const result = await executeRepositorySnapshot(deps, options, plan);
  return { plan, result };
}

async function runCli(
  repoRoot: string,
  extraArgs: string[] = []
): Promise<{ code: number; stdout: string }> {
  const tsxCli = require.resolve('tsx/cli');
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      tsxCli,
      'scripts/ingest_repository.ts',
      '--root', repoRoot,
      '--repo-key', REPO_KEY,
      '--extract', 'none',
      '--max-file-bytes', String(MAX_FILE_BYTES),
      ...extraArgs,
    ], { cwd: path.resolve('.'), maxBuffer: 16 * 1024 * 1024 });
    return { code: 0, stdout };
  } catch (error: any) {
    return { code: error.code ?? 1, stdout: `${error.stdout ?? ''}\n${error.stderr ?? ''}` };
  }
}

async function latestVersion(docKey: string): Promise<{ version: number; root_hash: string } | null> {
  const result = await pgPool.query(
    'SELECT version, root_hash FROM documents WHERE doc_key = $1 ORDER BY version DESC LIMIT 1',
    [docKey]
  );
  return result.rows[0] ?? null;
}

async function membership(rootHash: string): Promise<Set<string>> {
  const result = await pgPool.query(
    'SELECT node_id FROM document_nodes WHERE root_hash = $1',
    [rootHash]
  );
  return new Set(result.rows.map((row: { node_id: string }) => row.node_id));
}

async function factState(name: string): Promise<{ contested: boolean; orphaned: string[] } | null> {
  const session = neo4jDriver.session();
  try {
    const result = await session.run(
      'MATCH (e:Entity {name: toLower($name)}) RETURN coalesce(e.contested, false) AS contested, coalesce(e.orphanedSourceIds, []) AS orphaned',
      { name }
    );
    if (result.records.length === 0) return null;
    return {
      contested: result.records[0].get('contested') as boolean,
      orphaned: result.records[0].get('orphaned') as string[],
    };
  } finally {
    await session.close();
  }
}

async function mirrorInvalidationWorker(sweeps: CapturedSweep[]): Promise<void> {
  for (const sweep of sweeps) {
    const globallyOrphaned = await findGloballyOrphanedAstNodeIds(pgPool, sweep.orphanedHashes);
    await sweepOrphanedProvenance(neo4jDriver, globallyOrphaned, sweep.freshHashes ?? []);
  }
}

async function parseFixtureFile(repoRoot: string, relPath: string): Promise<ASTNode> {
  const parsed = await parseSourceFile(
    relPath,
    await fs.readFile(path.join(repoRoot, relPath)),
    PARSE_OPTS
  );
  if (!parsed.ok) throw new Error(`fixture parse failed for ${relPath}: ${parsed.reason}`);
  return parsed.root;
}

async function main(): Promise<void> {
  const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-repo-drill-'));
  const repoRoot = path.join(tmpBase, 'repo');
  await fs.cp(FIXTURE_DIR, repoRoot, { recursive: true });

  // Hostile entries the scanner/parser must reject deterministically.
  await fs.writeFile(path.join(repoRoot, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await fs.mkdir(path.join(repoRoot, 'data'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, 'data', 'blob.md'), Buffer.from([0x61, 0x00, 0x62, 0x63]));
  await fs.writeFile(path.join(repoRoot, 'big.md'), `# Big\n\n${'x'.repeat(MAX_FILE_BYTES + 512)}\n`);
  await fs.mkdir(path.join(repoRoot, 'node_modules', 'dep'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, 'node_modules', 'dep', 'index.js'), 'module.exports = 1;\n');
  await fs.writeFile(path.join(tmpBase, 'outside.md'), '# Outside the repository root\n');
  let symlinkCreated = false;
  try {
    await fs.symlink(path.join(tmpBase, 'outside.md'), path.join(repoRoot, 'link.md'), 'file');
    symlinkCreated = true;
  } catch {
    console.log('  [NOTE] symlink creation unavailable on this host; symlink skip asserted via unit tests only');
  }
  // Session 25: a test file and a fixture-directory file. Both must be
  // ingested (snapshot completeness) yet never reach extraction.
  await fs.writeFile(
    path.join(repoRoot, 'src', 'app.test.ts'),
    'export function fixtureFact() {\n  return "globex corporation acquired initech";\n}\n'
  );
  await fs.mkdir(path.join(repoRoot, '__fixtures__'), { recursive: true });
  await fs.writeFile(
    path.join(repoRoot, '__fixtures__', 'sample.md'),
    '# Fixture Sample\n\nA fictional fixture paragraph.\n'
  );
  await git(repoRoot, 'init');
  await git(repoRoot, 'add', '-A');
  await git(repoRoot, 'commit', '-m', 'fixture snapshot 1');

  const fixturePaths = [
    'README.md',
    '__fixtures__/sample.md',
    'config/settings.json',
    'docs/overview.md',
    'src/app.test.ts',
    'src/app.ts',
    'src/util.py',
  ];

  const seenDocKeys = new Set<string>(fixturePaths.map(docKeyFor));
  const store = createPgSnapshotStore(pgPool);

  const extractionBaseline = await extractionQueueDepth();

  try {
    console.log('\nPart 1: fresh snapshot through the real CLI (--extract none)');
    const cli1 = await runCli(repoRoot);
    check('CLI snapshot 1 exits 0', cli1.code, 0);
    if (cli1.code !== 0) console.log(cli1.stdout);
    check('CLI printed the paid-work plan before writes',
      cli1.stdout.includes('no paid work will be queued'), true);
    check('CLI echoed the test/fixture extraction exclusion counts',
      cli1.stdout.includes('test_fixture_excluded=2'), true);

    const snap1 = await pgPool.query(
      'SELECT snapshot_seq, published_at IS NOT NULL AS published, summary FROM repository_snapshots WHERE repo_key = $1 ORDER BY snapshot_seq',
      [REPO_KEY]
    );
    check('snapshot 1 exists and is published', [snap1.rows.length, snap1.rows[0]?.published], [1, true]);
    const expectedSkips: Record<string, number> = {
      binary: 1,
      excluded_directory: 1,
      oversize: 1,
      unsupported_extension: 1,
      ...(symlinkCreated ? { symlink: 1 } : {}),
    };
    check('snapshot 1 skip reasons are pinned',
      Object.entries(snap1.rows[0].summary.skipCounts as Record<string, number>).sort(),
      Object.entries(expectedSkips).sort());
    check('snapshot 1 queued zero extraction blocks', snap1.rows[0].summary.blocksQueued, 0);

    const paths1 = await pgPool.query(
      'SELECT path, doc_key, root_hash, outcome FROM repository_snapshot_paths WHERE repo_key = $1 AND snapshot_seq = 1',
      [REPO_KEY]
    );
    // Sorted in JS: SQL collation orders case-insensitively.
    check('snapshot 1 records the seven accepted files as ingested',
      paths1.rows.map((row: any) => [row.path, row.outcome]).sort(),
      fixturePaths.map(p => [p, 'ingested']).sort());

    for (const relPath of fixturePaths) {
      const doc = await latestVersion(docKeyFor(relPath));
      check(`${relPath} registered as version 1`, doc?.version, 1);
    }

    // Verified AST membership: the locally parsed root matches the
    // stored root hash, every node is a member, and a stored code block
    // re-derives its id through the pinned parser preimage.
    const appRoot = await parseFixtureFile(repoRoot, 'src/app.ts');
    const appDoc = await latestVersion(docKeyFor('src/app.ts'));
    check('src/app.ts stored root hash matches the local parse', appDoc?.root_hash, appRoot.id);
    const appMembers = await membership(appRoot.id);
    check('src/app.ts membership covers every AST node',
      flattenAST(appRoot).every(node => appMembers.has(node.id)), true);
    const functionBlock = collectExtractionBlocks(appRoot).find(b => b.type === 'code_function')!;
    const storedBlock = await pgPool.query('SELECT data FROM ast_nodes WHERE id = $1', [functionBlock.id]);
    check('stored code_function payload re-derives its Merkle id',
      rederiveAstNodeId(storedBlock.rows[0].data), functionBlock.id);
    check('code_function content is the exact source slice',
      (storedBlock.rows[0].data as ASTNode).content!.startsWith('export function greet'), true);

    check('CLI run wrote zero extraction jobs to Redis',
      await extractionQueueDepth(), extractionBaseline);

    console.log('\nPart 2: unchanged rerun is an auditable no-op');
    const cli2 = await runCli(repoRoot);
    check('CLI snapshot 2 exits 0', cli2.code, 0);
    const paths2 = await pgPool.query(
      'SELECT outcome, COUNT(*)::int AS n FROM repository_snapshot_paths WHERE repo_key = $1 AND snapshot_seq = 2 GROUP BY outcome',
      [REPO_KEY]
    );
    check('snapshot 2 is all-unchanged', paths2.rows, [{ outcome: 'unchanged', n: 7 }]);
    for (const relPath of fixturePaths) {
      const doc = await latestVersion(docKeyFor(relPath));
      if (doc?.version !== 1) check(`${relPath} still at version 1`, doc?.version, 1);
    }
    check('unchanged rerun registered no new versions', true, true);

    console.log('\nPart 3: one-method edit re-ingests only that file with a minimal diff');
    const appV1Members = await membership(appRoot.id);
    const appSource = await fs.readFile(path.join(repoRoot, 'src/app.ts'), 'utf8');
    await fs.writeFile(
      path.join(repoRoot, 'src/app.ts'),
      appSource.replace('this.value += 1;', 'this.value += 2;')
    );
    await git(repoRoot, 'add', '-A');
    await git(repoRoot, 'commit', '-m', 'edit one method');

    const sweeps3: CapturedSweep[] = [];
    const { result: result3 } = await runSnapshot(makeLibraryDeps(sweeps3), repoRoot);
    check('edit snapshot counts', result3.counts, { ingested: 1, unchanged: 6, tombstoned: 0 });
    const appRootV2 = await parseFixtureFile(repoRoot, 'src/app.ts');
    const appV2Members = await membership(appRootV2.id);
    const added = [...appV2Members].filter(id => !appV1Members.has(id));
    const orphanedLocal = [...appV1Members].filter(id => !appV2Members.has(id));
    check('method edit adds exactly root + class + method', added.length, 3);
    check('method edit orphans exactly the old root + class + method', orphanedLocal.length, 3);
    const untouched = collectExtractionBlocks(appRootV2)
      .filter(b => b.type === 'code_function')
      .map(b => b.id);
    check('untouched function blocks kept their hashes',
      untouched.every(id => appV1Members.has(id)), true);
    check('edit sweep carries the three orphaned hashes',
      sweeps3.map(s => s.orphanedHashes.length), [3]);
    check('edit sweep fresh set is empty under --extract none',
      sweeps3.map(s => s.freshHashes.length), [0]);
    await mirrorInvalidationWorker(sweeps3);
    check('app.ts now at version 2', (await latestVersion(docKeyFor('src/app.ts')))?.version, 2);

    console.log('\nPart 4: deletion and rename — tombstones, quarantine, shared survival');
    const utilRoot = await parseFixtureFile(repoRoot, 'src/util.py');
    const utilFunc = collectExtractionBlocks(utilRoot).find(b => b.type === 'code_function')!;
    const overviewRoot = await parseFixtureFile(repoRoot, 'docs/overview.md');
    const overviewPara = collectExtractionBlocks(overviewRoot)
      .find(b => nodeText(b).includes('handbook paragraph'))!;

    const utilEntityA = `${TOKEN} python util`;
    const utilEntityB = `${TOKEN} normalize helper`;
    const bookEntityA = `${TOKEN} handbook`;
    const bookEntityB = `${TOKEN} acquisition`;
    const entity = (name: string, sources: string[]) => ({
      id: globalEntityId(name),
      name,
      type: 'concept',
      sourceNodeIds: sources,
    });
    const action = (subject: string, verb: string, object: string, sources: string[]): EnrichedAction => ({
      id: crypto.randomUUID(),
      verb,
      subjectName: subject,
      objectName: object,
      subjectId: globalEntityId(subject),
      objectId: globalEntityId(object),
      sourceNodeIds: sources,
    });
    await mergeExtractedGraph(
      neo4jDriver,
      [
        entity(utilEntityA, [utilFunc.id]),
        entity(utilEntityB, [utilFunc.id]),
        entity(bookEntityA, [overviewPara.id]),
        entity(bookEntityB, [overviewPara.id]),
      ],
      [
        action(utilEntityA, 'defines', utilEntityB, [utilFunc.id]),
        action(bookEntityA, 'describes', bookEntityB, [overviewPara.id]),
      ]
    );
    check('seeded util fact is trusted', (await factState(utilEntityA))?.contested, false);
    check('seeded handbook fact is trusted', (await factState(bookEntityA))?.contested, false);

    await fs.rm(path.join(repoRoot, 'src/util.py'));
    await fs.rename(path.join(repoRoot, 'docs/overview.md'), path.join(repoRoot, 'docs/handbook.md'));
    seenDocKeys.add(docKeyFor('docs/handbook.md'));
    await git(repoRoot, 'add', '-A');
    await git(repoRoot, 'commit', '-m', 'delete util, rename overview');

    const sweeps4: CapturedSweep[] = [];
    const { result: result4 } = await runSnapshot(makeLibraryDeps(sweeps4), repoRoot);
    check('delete/rename snapshot counts', result4.counts, { ingested: 1, unchanged: 5, tombstoned: 2 });

    const handbookDoc = await latestVersion(docKeyFor('docs/handbook.md'));
    const overviewDoc = await latestVersion(docKeyFor('docs/overview.md'));
    const utilDoc = await latestVersion(docKeyFor('src/util.py'));
    check('renamed content registers a distinct doc key at version 1', handbookDoc?.version, 1);
    check('renamed content deduplicates the physical root hash',
      handbookDoc?.root_hash, overviewRoot.id);
    check('old rename path latest version is a tombstone',
      [overviewDoc?.version, overviewDoc?.root_hash], [2, emptyDocumentRoot().id]);
    check('deleted path latest version is a tombstone',
      [utilDoc?.version, utilDoc?.root_hash], [2, emptyDocumentRoot().id]);

    const utilSweep = sweeps4.find(s => s.docKey === docKeyFor('src/util.py'))!;
    const overviewSweep = sweeps4.find(s => s.docKey === docKeyFor('docs/overview.md'))!;
    const utilGlobal = await findGloballyOrphanedAstNodeIds(pgPool, utilSweep.orphanedHashes);
    const overviewGlobal = await findGloballyOrphanedAstNodeIds(pgPool, overviewSweep.orphanedHashes);
    check('deleted python function is globally orphaned', utilGlobal.includes(utilFunc.id), true);
    check('renamed paragraph is globally retained by the new doc key',
      overviewGlobal.includes(overviewPara.id), false);
    await mirrorInvalidationWorker(sweeps4);

    const utilState = await factState(utilEntityA);
    check('deleted-source fact quarantined', utilState?.contested, true);
    check('quarantine preserves the dead hash as audit',
      utilState?.orphaned.includes(utilFunc.id), true);
    check('renamed-source fact survives via global liveness',
      (await factState(bookEntityA))?.contested, false);

    console.log('\nPart 5: forced single-file failure leaves the previous snapshot effective');
    const readmePath = path.join(repoRoot, 'README.md');
    await fs.writeFile(readmePath, `${await fs.readFile(readmePath, 'utf8')}\nEdited for the failure drill.\n`);
    await fs.rm(path.join(repoRoot, 'docs/handbook.md'));
    await git(repoRoot, 'add', '-A');
    await git(repoRoot, 'commit', '-m', 'edit README, delete handbook');

    const effectiveBefore = [...(await store.fetchEffectivePaths(REPO_KEY)).entries()].sort();
    const sweeps5: CapturedSweep[] = [];
    let failureSeen = false;
    try {
      await runSnapshot(makeLibraryDeps(sweeps5, 'README.md'), repoRoot, { concurrency: 1 });
    } catch (error: any) {
      failureSeen = /forced drill failure/.test(error.message);
    }
    check('forced failure propagates and exits the run nonzero', failureSeen, true);
    const effectiveAfter = [...(await store.fetchEffectivePaths(REPO_KEY)).entries()].sort();
    check('previous published snapshot remains effective after the failure',
      effectiveAfter, effectiveBefore);
    check('failed run tombstoned nothing',
      (await latestVersion(docKeyFor('docs/handbook.md')))?.root_hash === emptyDocumentRoot().id, false);
    const unpublished = await pgPool.query(
      'SELECT COUNT(*)::int AS n FROM repository_snapshots WHERE repo_key = $1 AND published_at IS NULL',
      [REPO_KEY]
    );
    check('failed run left exactly one unpublished snapshot row', unpublished.rows[0].n, 1);

    const sweeps5b: CapturedSweep[] = [];
    const { result: retry } = await runSnapshot(makeLibraryDeps(sweeps5b), repoRoot);
    // Remaining live paths: README.md (edited → ingested), settings.json,
    // app.ts, app.test.ts, and __fixtures__/sample.md (unchanged),
    // handbook.md (deleted → tombstoned); overview.md and util.py were
    // already tombstoned in Part 4.
    check('retry publishes with the expected outcomes',
      retry.counts, { ingested: 1, unchanged: 4, tombstoned: 1 });
    await mirrorInvalidationWorker(sweeps5b);
    check('handbook fact quarantines once its last live source dies',
      (await factState(bookEntityA))?.contested, true);

    console.log('\nPart 6: changed-mode extraction — test/fixture files ingest but never enqueue');
    // Edit BOTH the source file and the test file, then run --extract
    // changed with the extraction queue captured in memory: the source
    // file's new block becomes a job carrying the Session 25 routing
    // metadata; the test file re-ingests (snapshot completeness) yet
    // contributes zero jobs.
    const appPath = path.join(repoRoot, 'src/app.ts');
    await fs.writeFile(
      appPath,
      `${await fs.readFile(appPath, 'utf8')}\nexport function sessionTwentyFive() {\n  return 'prerequisites';\n}\n`
    );
    const testPath = path.join(repoRoot, 'src/app.test.ts');
    await fs.writeFile(
      testPath,
      `${await fs.readFile(testPath, 'utf8')}\nexport function fixtureFactTwo() {\n  return 'initech acquires globex, fictionally';\n}\n`
    );
    await git(repoRoot, 'add', '-A');
    await git(repoRoot, 'commit', '-m', 'edit source and test for changed-mode drill');

    const sweeps6: CapturedSweep[] = [];
    const jobs6: Array<{ name: string; data: Record<string, unknown> }> = [];
    const { plan: plan6, result: result6 } = await runSnapshot(
      makeLibraryDeps(sweeps6, undefined, jobs6),
      repoRoot,
      { policy: { mode: 'changed', maxBlocks: 50 } }
    );
    check('changed snapshot counts', result6.counts, { ingested: 2, unchanged: 3, tombstoned: 0 });
    check('plan classifies both test/fixture files',
      plan6.extractionExclusionCounts, { test_fixture_excluded: 2 });
    check('plan excludes the edited test file blocks from the paid bound',
      plan6.blocksExcludedFromExtraction >= 1, true);
    check('exactly the source file\'s new block was enqueued',
      jobs6.map(job => [job.data.docKey, job.data.sourceKind, job.data.language]),
      [[docKeyFor('src/app.ts'), 'code', 'typescript']]);
    const appRootV3 = await parseFixtureFile(repoRoot, 'src/app.ts');
    const newFunctionBlock = collectExtractionBlocks(appRootV3)
      .find(b => nodeText(b).includes('sessionTwentyFive'))!;
    check('the enqueued job carries the new function block hash',
      jobs6.map(job => job.data.astNodeId), [newFunctionBlock.id]);
    check('the test file still ingested a new version (in the snapshot)',
      (await latestVersion(docKeyFor('src/app.test.ts')))?.version, 2);
    check('result reports one queued block against the excluded counts',
      [result6.blocksQueued, result6.extractionExclusionCounts.test_fixture_excluded],
      [1, 2]);
    await mirrorInvalidationWorker(sweeps6);
    check('changed-mode drill wrote zero extraction jobs to Redis',
      await extractionQueueDepth(), extractionBaseline);

    console.log('\nPart 7: scoped snapshots (Session 34) — --include carries the rest forward');
    // Edit an in-scope file AND an out-of-scope file, add a brand-new
    // out-of-scope file, then run scoped to src/: only the in-scope edit
    // ingests and enqueues; the edited out-of-scope path carries forward
    // at its PREVIOUS root hash (never re-read, never tombstoned); the
    // new out-of-scope path is a typed out_of_scope skip with no
    // document row.
    const readmeBefore = await latestVersion(docKeyFor('README.md'));
    await fs.writeFile(
      path.join(repoRoot, 'src/app.ts'),
      `${await fs.readFile(path.join(repoRoot, 'src/app.ts'), 'utf8')}\nexport function sessionThirtyFour() {\n  return 'scoped';\n}\n`
    );
    await fs.writeFile(
      path.join(repoRoot, 'README.md'),
      `${await fs.readFile(path.join(repoRoot, 'README.md'), 'utf8')}\nEdited out of scope.\n`
    );
    await fs.mkdir(path.join(repoRoot, 'docs'), { recursive: true });
    await fs.writeFile(
      path.join(repoRoot, 'docs', 'newdoc.md'),
      '# New Doc\n\nA paragraph written outside the scope.\n'
    );
    await git(repoRoot, 'add', '-A');
    await git(repoRoot, 'commit', '-m', 'in-scope and out-of-scope edits for the scope drill');

    // A full-scope plan (planning only, no writes) prices README + the
    // new doc; the scoped plan must price only the in-scope edit.
    const fullPlan7 = await planRepositorySnapshot(makeLibraryDeps([], undefined, []), {
      root: repoRoot,
      repoKey: REPO_KEY,
      policy: { mode: 'changed', maxBlocks: 50 },
      maxFileBytes: MAX_FILE_BYTES,
    });
    const sweeps7: CapturedSweep[] = [];
    const jobs7: Array<{ name: string; data: Record<string, unknown> }> = [];
    const { plan: plan7, result: result7 } = await runSnapshot(
      makeLibraryDeps(sweeps7, undefined, jobs7),
      repoRoot,
      { policy: { mode: 'changed', maxBlocks: 50 }, includePrefixes: ['src'] }
    );
    // Two out_of_scope skips: docs/newdoc.md AND the hostile binary
    // data/blob.md — an out-of-scope file is never read, so parse-level
    // reasons (binary) cannot apply to it.
    check('scoped plan skips the new out-of-scope files as out_of_scope',
      plan7.skipCounts.out_of_scope, 2);
    check('out-of-scope files are never parsed (no binary skip under scope)',
      plan7.skipCounts.binary, undefined);
    check('scoped plan carries the three out-of-scope effective paths',
      plan7.carriedForward.map(carry => carry.path),
      ['README.md', '__fixtures__/sample.md', 'config/settings.json']);
    check('carried README keeps its pre-edit root hash',
      plan7.carriedForward[0].rootHash, readmeBefore?.root_hash);
    check('scoped paid bound excludes out-of-scope blocks',
      plan7.paidJobUpperBound < fullPlan7.paidJobUpperBound, true);
    check('scoped snapshot counts (carried publish as unchanged)',
      [result7.counts, result7.carriedForward],
      [{ ingested: 1, unchanged: 4, tombstoned: 0 }, 3]);
    check('only the in-scope edit enqueued',
      jobs7.map(job => [job.data.docKey, job.data.sourceKind]),
      [[docKeyFor('src/app.ts'), 'code']]);
    check('edited out-of-scope README was NOT re-ingested',
      (await latestVersion(docKeyFor('README.md')))?.version, readmeBefore?.version);
    check('new out-of-scope file has no document row',
      await latestVersion(docKeyFor('docs/newdoc.md')), null);
    await mirrorInvalidationWorker(sweeps7);

    // The chunk-two pattern: a later full-scope run picks up exactly the
    // deferred out-of-scope work as ordinary changed-mode ingests.
    const sweeps7b: CapturedSweep[] = [];
    const jobs7b: Array<{ name: string; data: Record<string, unknown> }> = [];
    const { result: result7b } = await runSnapshot(
      makeLibraryDeps(sweeps7b, undefined, jobs7b),
      repoRoot,
      { policy: { mode: 'changed', maxBlocks: 50 } }
    );
    check('full-scope follow-up ingests exactly the deferred paths',
      result7b.counts, { ingested: 2, unchanged: 4, tombstoned: 0 });
    check('follow-up carried nothing (full scope)', result7b.carriedForward, 0);
    check('README re-ingested by the covering run',
      (await latestVersion(docKeyFor('README.md')))?.version, (readmeBefore?.version ?? 0) + 1);
    check('deferred new doc registered at version 1',
      (await latestVersion(docKeyFor('docs/newdoc.md')))?.version, 1);
    check('deferred prose blocks enqueue only under the covering run',
      jobs7b.every(job => job.data.sourceKind === 'prose')
        && jobs7b.some(job => job.data.docKey === docKeyFor('docs/newdoc.md'))
        && jobs7b.some(job => job.data.docKey === docKeyFor('README.md')),
      true);
    await mirrorInvalidationWorker(sweeps7b);

    // In-scope deletions still tombstone under a scoped run.
    await fs.rm(path.join(repoRoot, 'src/app.test.ts'));
    await git(repoRoot, 'add', '-A');
    await git(repoRoot, 'commit', '-m', 'delete in-scope test file');
    const sweeps7c: CapturedSweep[] = [];
    const { result: result7c } = await runSnapshot(
      makeLibraryDeps(sweeps7c),
      repoRoot,
      { includePrefixes: ['src'] }
    );
    check('scoped run tombstones the in-scope deletion',
      result7c.counts, { ingested: 0, unchanged: 5, tombstoned: 1 });
    check('scoped deletion carried the four out-of-scope paths', result7c.carriedForward, 4);
    check('in-scope deletion registered a tombstone version',
      (await latestVersion(docKeyFor('src/app.test.ts')))?.root_hash, emptyDocumentRoot().id);
    await mirrorInvalidationWorker(sweeps7c);

    // The CLI surface: --include parses, the plan echo prints scope and
    // carried counts, and an invalid prefix refuses before any write.
    const cli7 = await runCli(repoRoot, ['--include', 'src']);
    check('CLI scoped run exits 0', cli7.code, 0);
    check('CLI plan echo prints the scope', /scope:\s+src\b/.test(cli7.stdout), true);
    check('CLI plan echo prints the carried-forward count',
      /carried forward:\s+4 /.test(cli7.stdout), true);
    const cliBad = await runCli(repoRoot, ['--include', '../escape']);
    check('CLI refuses an invalid scope prefix', cliBad.code === 0, false);
    check('invalid-prefix refusal names the prefix',
      cliBad.stdout.includes('invalid scope prefix'), true);
    check('scope drill wrote zero extraction jobs to Redis',
      await extractionQueueDepth(), extractionBaseline);

    console.log('\nPart 8: vector-search liveness — a planted dead twin never surfaces (Session 40)');
    // A superseded block keeps its embedding forever; the liveness filter
    // in search_ast_nodes (STRUCTURAL_CHUNKING.md §11) must keep it out of
    // results while the live successor surfaces. Synthetic deterministic
    // vectors, zero LLM: the drill query IS the dead twin's embedding (raw
    // cosine distance 0 — without the filter it would rank first); the
    // live successor sits a tiny perturbation away. Dimension 1 keeps the
    // direction orthogonal to the rlm-sandbox drill's [1, 0, …] probe, so
    // a stale row from a crashed sandbox run can never tie at distance 0.
    const queryVec = new Array(1536).fill(0);
    queryVec[1] = 1;
    const liveVec = [...queryVec];
    liveVec[2] = 0.02;
    const queryParam = JSON.stringify(queryVec);

    const twinPath = 'docs/twin.md';
    await fs.writeFile(
      path.join(repoRoot, twinPath),
      `# Twin\n\nThe planted twin paragraph (${TOKEN}), version one.\n`
    );
    await git(repoRoot, 'add', '-A');
    await git(repoRoot, 'commit', '-m', 'plant the twin document v1');
    seenDocKeys.add(docKeyFor(twinPath));
    const { result: result8a } = await runSnapshot(makeLibraryDeps([]), repoRoot);
    check('twin v1 snapshot counts', result8a.counts, { ingested: 1, unchanged: 5, tombstoned: 0 });

    const twinRootV1 = await parseFixtureFile(repoRoot, twinPath);
    const twinBlockV1 = collectExtractionBlocks(twinRootV1)
      .find(b => nodeText(b).includes('version one'))!;
    await pgPool.query(
      'UPDATE ast_nodes SET embedding = $1::vector WHERE id = $2',
      [queryParam, twinBlockV1.id]
    );
    const live8a = await pgPool.query(
      'SELECT id FROM search_ast_nodes($1::vector, 5)', [queryParam]);
    check('the v1 block surfaces at rank 1 while it is current',
      live8a.rows[0]?.id, twinBlockV1.id);

    // Supersede: v2 re-hashes the paragraph. The v1 block goes dead but
    // keeps its planted embedding — the dead twin.
    await fs.writeFile(
      path.join(repoRoot, twinPath),
      `# Twin\n\nThe planted twin paragraph (${TOKEN}), version two.\n`
    );
    await git(repoRoot, 'add', '-A');
    await git(repoRoot, 'commit', '-m', 'supersede the twin document');
    const sweeps8: CapturedSweep[] = [];
    const { result: result8b } = await runSnapshot(makeLibraryDeps(sweeps8), repoRoot);
    check('twin v2 snapshot counts', result8b.counts, { ingested: 1, unchanged: 5, tombstoned: 0 });
    await mirrorInvalidationWorker(sweeps8);
    const twinRootV2 = await parseFixtureFile(repoRoot, twinPath);
    const twinBlockV2 = collectExtractionBlocks(twinRootV2)
      .find(b => nodeText(b).includes('version two'))!;
    check('the superseded twin re-hashed to a distinct block',
      twinBlockV1.id === twinBlockV2.id, false);
    await pgPool.query(
      'UPDATE ast_nodes SET embedding = $1::vector WHERE id = $2',
      [JSON.stringify(liveVec), twinBlockV2.id]
    );

    // Raw distance order prefers the dead twin (distance 0): without the
    // filter it would occupy the top slot. This is the planted proof that
    // the filter — not distance — excludes it.
    const raw8 = await pgPool.query(
      'SELECT id FROM ast_nodes WHERE embedding IS NOT NULL ORDER BY embedding <=> $1::vector LIMIT 1',
      [queryParam]
    );
    check('raw distance order ranks the dead twin first', raw8.rows[0]?.id, twinBlockV1.id);

    const search8b = await pgPool.query(
      'SELECT id FROM search_ast_nodes($1::vector, 5)', [queryParam]);
    const ids8b = search8b.rows.map((row: { id: string }) => row.id);
    check('the dead twin never surfaces through the tool',
      ids8b.includes(twinBlockV1.id), false);
    check('the live successor surfaces at rank 1', ids8b[0], twinBlockV2.id);

    // Tombstone: the document's current version becomes the empty root,
    // so BOTH twin generations drop out of vector search.
    await fs.rm(path.join(repoRoot, twinPath));
    await git(repoRoot, 'add', '-A');
    await git(repoRoot, 'commit', '-m', 'tombstone the twin document');
    const sweeps8c: CapturedSweep[] = [];
    const { result: result8c } = await runSnapshot(makeLibraryDeps(sweeps8c), repoRoot);
    check('twin tombstone snapshot counts', result8c.counts, { ingested: 0, unchanged: 5, tombstoned: 1 });
    await mirrorInvalidationWorker(sweeps8c);
    const search8c = await pgPool.query(
      'SELECT id FROM search_ast_nodes($1::vector, 5)', [queryParam]);
    const ids8c = search8c.rows.map((row: { id: string }) => row.id);
    check('tombstoned blocks drop out of vector search',
      [ids8c.includes(twinBlockV1.id), ids8c.includes(twinBlockV2.id)], [false, false]);
    check('liveness drill wrote zero extraction jobs to Redis',
      await extractionQueueDepth(), extractionBaseline);
  } finally {
    console.log('\nCleanup');
    try {
      // Documents and membership: delete our doc keys, then membership
      // rows whose roots no longer back any registered document, then
      // AST rows that no longer belong to any document's membership.
      const docs = await pgPool.query(
        "SELECT DISTINCT root_hash FROM documents WHERE doc_key LIKE $1",
        [`repo:${REPO_KEY}:%`]
      );
      const roots: string[] = docs.rows.map((row: { root_hash: string }) => row.root_hash);
      const nodeIds = await pgPool.query(
        'SELECT DISTINCT node_id FROM document_nodes WHERE root_hash = ANY($1)',
        [roots]
      );
      const candidates: string[] = nodeIds.rows.map((row: { node_id: string }) => row.node_id);
      await pgPool.query('DELETE FROM repository_snapshot_paths WHERE repo_key = $1', [REPO_KEY]);
      await pgPool.query('DELETE FROM repository_snapshots WHERE repo_key = $1', [REPO_KEY]);
      await pgPool.query('DELETE FROM documents WHERE doc_key LIKE $1', [`repo:${REPO_KEY}:%`]);
      await pgPool.query(
        `DELETE FROM document_nodes dn WHERE dn.root_hash = ANY($1)
         AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.root_hash = dn.root_hash)`,
        [roots]
      );
      await pgPool.query(
        `DELETE FROM ast_nodes a WHERE a.id = ANY($1)
         AND NOT EXISTS (SELECT 1 FROM document_nodes dn WHERE dn.node_id = a.id)`,
        [candidates]
      );
      const session = neo4jDriver.session();
      try {
        await session.run(
          'MATCH (e:Entity) WHERE e.name CONTAINS $token DETACH DELETE e',
          { token: TOKEN.toLowerCase() }
        );
      } finally {
        await session.close();
      }
      const residue = await pgPool.query(
        "SELECT COUNT(*)::int AS n FROM documents WHERE doc_key LIKE $1",
        [`repo:${REPO_KEY}:%`]
      );
      check('cleanup left zero drill documents', residue.rows[0].n, 0);
      await fs.rm(tmpBase, { recursive: true, force: true }).catch(() => {});
    } catch (cleanupError: any) {
      console.error(`  Cleanup error: ${cleanupError.message}`);
      failures++;
    }
  }
}

main()
  .then(async () => {
    await extractionQueueHandle.close();
    await redisConnection.quit().catch(() => {});
    await pgPool.end();
    await neo4jDriver.close();
    console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async err => {
    console.error(`\nDrill error: ${err.stack ?? err.message}`);
    try { await extractionQueueHandle.close(); } catch {}
    try { await redisConnection.quit(); } catch {}
    try { await pgPool.end(); } catch {}
    try { await neo4jDriver.close(); } catch {}
    process.exit(1);
  });
