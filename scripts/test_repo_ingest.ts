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

function makeLibraryDeps(captured: CapturedSweep[], failForPathSuffix?: string): SnapshotDeps {
  const queues: IngestDeps['queues'] = {
    extraction: {
      addBulk: async jobs => {
        throw new Error(`unexpected extraction enqueue of ${jobs.length} job(s) under --extract none`);
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

async function runCli(repoRoot: string): Promise<{ code: number; stdout: string }> {
  const tsxCli = require.resolve('tsx/cli');
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      tsxCli,
      'scripts/ingest_repository.ts',
      '--root', repoRoot,
      '--repo-key', REPO_KEY,
      '--extract', 'none',
      '--max-file-bytes', String(MAX_FILE_BYTES),
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
  await git(repoRoot, 'init');
  await git(repoRoot, 'add', '-A');
  await git(repoRoot, 'commit', '-m', 'fixture snapshot 1');

  const fixturePaths = [
    'README.md',
    'config/settings.json',
    'docs/overview.md',
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
    check('snapshot 1 records the five accepted files as ingested',
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
    check('snapshot 2 is all-unchanged', paths2.rows, [{ outcome: 'unchanged', n: 5 }]);
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
    check('edit snapshot counts', result3.counts, { ingested: 1, unchanged: 4, tombstoned: 0 });
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
    check('delete/rename snapshot counts', result4.counts, { ingested: 1, unchanged: 3, tombstoned: 2 });

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
    // Remaining live paths: README.md (edited → ingested), settings.json
    // and app.ts (unchanged), handbook.md (deleted → tombstoned);
    // overview.md and util.py were already tombstoned in Part 4.
    check('retry publishes with the expected outcomes',
      retry.counts, { ingested: 1, unchanged: 2, tombstoned: 1 });
    await mirrorInvalidationWorker(sweeps5b);
    check('handbook fact quarantines once its last live source dies',
      (await factState(bookEntityA))?.contested, true);
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
