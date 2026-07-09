import { execFile } from 'child_process';
import crypto from 'crypto';
import path from 'path';
import util from 'util';
import IORedis from 'ioredis';
import { pgPool, neo4jDriver } from '../src/config/db';
import { config, pgDsn } from '../src/config/index';
import { parseMarkdownToAST } from '../src/core/ast/parser';
import { flattenAST, collectExtractionBlocks } from '../src/core/ast/traverse';
import { isAstNodeLive, findGloballyOrphanedAstNodeIds } from '../src/core/ast/registry';
import { sweepOrphanedProvenance } from '../src/core/graph/invalidation';
import type { IngestDeps } from '../src/core/ingestion/ingest_document';
import { planSegmentPromotion } from '../src/core/promotion/plan_promotion';
import { promoteSegment } from '../src/core/promotion/promote_segment';
import {
  scratchBytesKey,
  scratchKey,
  type WorkspaceSnapshot,
} from '../src/workers/workspace_scratch';
import { loggerFor } from '../src/core/observability/logger';

// Session 17 live drill: the promotion path (design record §6, §11
// step 5), zero LLM calls, zero external network (requires the
// docker-compose stack).
//
// The full earned-permanence loop, against real Redis, PostgreSQL, and
// Neo4j:
//   1. Park a drill-authored workspace snapshot under the PRODUCTION
//      scratch keys (the shape rlm_worker.ts parks).
//   2. LIST mode through the real CLI: segment inventory with origin
//      stamps, sizes, the truncation marker, and doc-key hints.
//   3. Readable failures: missing parked snapshot (names
//      SCRATCH_TTL_SECONDS); truncated / unknown / empty-segment and
//      bad-doc-key refusals, all with nothing ingested.
//   4. Earned citability, negative first: write_derived_insight citing
//      the WOULD-BE block hash is a Provenance Violation before
//      promotion, then SUCCEEDS after the CLI promotes the segment —
//      the same hash, through the same hardened write path.
//   5. Origin traceability: the documents row carries the wrapper's
//      origin stamp, committed with the version.
//   6. Refreshed external content: re-promoting CHANGED bytes under the
//      SAME doc key versions the document; the captured invalidation
//      payload driven through the worker's sweep contests the insight
//      (audit-preserving quarantine, provenance moved to
//      orphanedSourceIds).
// All state is token-scoped and cleaned up.

const execFileAsync = util.promisify(execFile);

const TOKEN = `promo-drill-${Date.now()}`;
const GOAL_ID = `${TOKEN}-goal`;
const TASK_ID = `${TOKEN}-task-1`;
const TASK2_ID = `${TOKEN}-task-2`;
const DOC_KEY = `web:https://drill.example.test/${TOKEN}`;
const ARGS_HASH = 'ab12cd34ef56ab78';

const GOOD_ID = crypto.randomUUID();
const TRUNCATED_ID = crypto.randomUUID();
const EMPTY_ID = crypto.randomUUID();
const V2_ID = crypto.randomUUID();

const V1_CONTENT = `${TOKEN}-promo-subject acquired ${TOKEN}-promo-object in 2024.`;
const V2_CONTENT = `${TOKEN}-promo-subject acquired ${TOKEN}-promo-object in 2025.`;

const INSIGHT_SUBJECT = `${TOKEN}-insight-subject`;
const INSIGHT_OBJECT = `${TOKEN}-insight-object`;

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
  if (!ok) failures++;
}

function segmentOf(content: string, overrides: Partial<WorkspaceSnapshot['segments'][string]> = {}) {
  return {
    origin: { server: 'fixture', tool: 'search', argsHash: ARGS_HASH },
    fetchedAt: '2026-07-07T12:00:00Z',
    bytes: Buffer.byteLength(content, 'utf8'),
    truncated: false,
    content,
    goalId: GOAL_ID,
    taskId: TASK_ID,
    ...overrides,
  };
}

const tsxCli = require.resolve('tsx/cli');

interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(...args: string[]): Promise<CliRun> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      tsxCli,
      'scripts/promote_segment.ts',
      ...args,
    ], { cwd: path.resolve(__dirname, '..') });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
  }
}

async function runWriteHelper(mode: 'reject' | 'write', hash: string): Promise<CliRun> {
  const script = path.resolve(__dirname, 'test_promotion_write.py');
  const env = {
    ...process.env,
    ...(config.python.pythonPath && { PYTHONPATH: config.python.pythonPath }),
    NEO4J_URI: config.neo4j.uri,
    NEO4J_USER: config.neo4j.user,
    NEO4J_PASSWORD: config.neo4j.password,
    PG_DSN: pgDsn(),
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
  };
  try {
    const { stdout, stderr } = await execFileAsync(
      config.python.executable,
      [script, mode, INSIGHT_SUBJECT, 'mentions', INSIGHT_OBJECT, hash],
      { env }
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
  }
}

async function documentRow(version: number): Promise<{ root_hash: string; origin: Record<string, unknown> | null } | undefined> {
  const res = await pgPool.query(
    'SELECT root_hash, origin FROM documents WHERE doc_key = $1 AND version = $2',
    [DOC_KEY, version]
  );
  return res.rows[0];
}

async function insightState(): Promise<{ contested: boolean; sourceNodeIds: string[]; orphanedSourceIds: string[] | null } | undefined> {
  const session = neo4jDriver.session();
  try {
    const res = await session.run(
      `MATCH (s:Entity {name: $subj})-[r:DERIVED_INSIGHT {verb: 'mentions'}]->(o:Entity {name: $obj})
       RETURN coalesce(r.contested, false) AS contested,
              r.sourceNodeIds AS sourceNodeIds,
              r.orphanedSourceIds AS orphanedSourceIds`,
      { subj: INSIGHT_SUBJECT.toLowerCase(), obj: INSIGHT_OBJECT.toLowerCase() }
    );
    const rec = res.records[0];
    return rec && {
      contested: rec.get('contested'),
      sourceNodeIds: rec.get('sourceNodeIds'),
      orphanedSourceIds: rec.get('orphanedSourceIds'),
    };
  } finally {
    await session.close();
  }
}

async function main(): Promise<void> {
  const redis = new IORedis({
    host: config.redis.host,
    port: config.redis.port,
    maxRetriesPerRequest: null,
  });

  // Hashes this drill will own in PostgreSQL, for cleanup.
  const v1Root = parseMarkdownToAST(V1_CONTENT);
  const v2Root = parseMarkdownToAST(V2_CONTENT);
  const ownedNodeIds = [...new Set([...flattenAST(v1Root), ...flattenAST(v2Root)].map(n => n.id))];
  const v1Block = collectExtractionBlocks(v1Root)[0].id;
  const v2Block = collectExtractionBlocks(v2Root)[0].id;

  try {
    // ---- 1. Park a snapshot under the production scratch keys --------
    console.log('\n[1] park a drill-authored snapshot at the production scratch key');
    const snapshot: WorkspaceSnapshot = {
      version: 1,
      plan: [{ id: 's1', desc: 'drill', status: 'done' }],
      notes: [`${TOKEN} note`],
      segments: {
        [GOOD_ID]: segmentOf(V1_CONTENT),
        [TRUNCATED_ID]: segmentOf('partial fetch cut by the size cap', { truncated: true }),
        [EMPTY_ID]: segmentOf(''),
      },
    };
    await redis.set(scratchKey(GOAL_ID, TASK_ID), JSON.stringify(snapshot), 'EX', config.scratch.ttlSeconds);
    check('parked snapshot readable at scratch:goal:<goalId>:task:<taskId>',
      (await redis.get(scratchKey(GOAL_ID, TASK_ID))) !== null, true);

    // ---- 2. LIST mode through the real CLI ---------------------------
    console.log('\n[2] list mode (read-only inventory)');
    const list = await runCli('--goal', GOAL_ID, '--task', TASK_ID);
    check('list mode exits 0', list.code, 0);
    check('inventory names every segment',
      [GOOD_ID, TRUNCATED_ID, EMPTY_ID].every(id => list.stdout.includes(id)), true);
    check('inventory carries the origin stamp', list.stdout.includes(`fixture / search (argsHash ${ARGS_HASH})`), true);
    check('inventory marks the truncated segment not promotable', list.stdout.includes('TRUNCATED — not promotable'), true);
    check('inventory prints the derived doc-key hint', list.stdout.includes(`mcp:fixture:search:${ARGS_HASH}`), true);
    check('inventory previews content', list.stdout.includes(`${TOKEN}-promo-subject acquired`), true);

    // ---- 3. Readable failures and refusals ---------------------------
    console.log('\n[3] refusals (nothing ingested by any of these)');
    const missing = await runCli('--goal', GOAL_ID, '--task', 'no-such-task');
    check('missing parked snapshot fails', missing.code === 0, false);
    check('missing-snapshot error names SCRATCH_TTL_SECONDS', missing.stderr.includes('SCRATCH_TTL_SECONDS'), true);

    const truncated = await runCli('--goal', GOAL_ID, '--task', TASK_ID,
      '--segment', TRUNCATED_ID, '--doc-key', DOC_KEY);
    check('truncated segment refused', truncated.code === 0, false);
    check('truncation refusal says why', truncated.stderr.includes('truncated'), true);

    const unknown = await runCli('--goal', GOAL_ID, '--task', TASK_ID,
      '--segment', 'no-such-segment', '--doc-key', DOC_KEY);
    check('unknown segment refused', unknown.code === 0, false);
    check('unknown-segment refusal lists what the snapshot holds',
      unknown.stderr.includes('3 segment(s)') && unknown.stderr.includes(GOOD_ID), true);

    const empty = await runCli('--goal', GOAL_ID, '--task', TASK_ID,
      '--segment', EMPTY_ID, '--doc-key', DOC_KEY);
    check('empty segment refused', empty.code === 0, false);

    const noKey = await runCli('--goal', GOAL_ID, '--task', TASK_ID, '--segment', GOOD_ID);
    check('promotion without --doc-key refused (keys are never invented)', noKey.code === 0, false);
    check('missing-key refusal offers the derived fallback',
      noKey.stderr.includes(`--doc-key mcp:fixture:search:${ARGS_HASH}`), true);

    const badKey = await runCli('--goal', GOAL_ID, '--task', TASK_ID,
      '--segment', GOOD_ID, '--doc-key', 'repo:reserved:src/index.ts');
    check('reserved repo: doc key refused', badKey.code === 0, false);

    check('no document row exists after the refusals', await documentRow(1), undefined);

    // ---- 4. Earned citability: negative first ------------------------
    console.log('\n[4] the would-be hash is NOT citable before promotion');
    const before = await runWriteHelper('reject', v1Block);
    check('write_derived_insight rejects the unpromoted hash (Provenance Violation)',
      before.code === 0 && before.stdout.includes('REJECTED'), true);

    // ---- 5. Promote through the real CLI ------------------------------
    console.log('\n[5] promote the segment (extraction none — zero paid work)');
    const promote = await runCli('--goal', GOAL_ID, '--task', TASK_ID,
      '--segment', GOOD_ID, '--doc-key', DOC_KEY);
    check('promotion exits 0', promote.code, 0);
    check('promotion echoes the doc key before ingesting', promote.stdout.includes(`doc key:    ${DOC_KEY}`), true);
    check('promotion echoes the origin', promote.stdout.includes('fixture / search'), true);
    check('promotion reports version 1', promote.stdout.includes(`Promoted: ${DOC_KEY} version 1`), true);
    check('promotion prints the citable block hash', promote.stdout.includes(v1Block), true);
    check('promotion queues zero paid work', promote.stdout.includes('blocks eligible/queued: 1/0'), true);

    const v1Row = await documentRow(1);
    check('documents row registered under the doc key', v1Row?.root_hash, v1Root.id);
    // jsonb does not preserve key order; compare canonically.
    const sortedKeys = (value: Record<string, unknown> | null | undefined) =>
      value && Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
    check('origin stamp recorded with the version row', sortedKeys(v1Row?.origin), sortedKeys({
      server: 'fixture',
      tool: 'search',
      argsHash: ARGS_HASH,
      fetchedAt: '2026-07-07T12:00:00Z',
      segmentId: GOOD_ID,
      bytes: Buffer.byteLength(V1_CONTENT, 'utf8'),
      goalId: GOAL_ID,
      taskId: TASK_ID,
    }));
    const astRes = await pgPool.query('SELECT count(*)::int AS n FROM ast_nodes WHERE id = ANY($1)',
      [flattenAST(v1Root).map(n => n.id)]);
    check('every promoted AST node persisted (read-back verified by the transaction)',
      astRes.rows[0].n, flattenAST(v1Root).length);
    check('promoted block is live', await isAstNodeLive(pgPool, v1Block), true);

    // ---- 6. The SAME hash now writes ----------------------------------
    console.log('\n[6] the promoted hash is citable through the hardened write path');
    const after = await runWriteHelper('write', v1Block);
    check('write_derived_insight succeeds citing the promoted hash',
      after.code === 0 && after.stdout.includes('WROTE'), true);
    const insight = await insightState();
    check('insight edge exists uncontested with the promoted provenance',
      insight && { contested: insight.contested, sources: insight.sourceNodeIds },
      { contested: false, sources: [v1Block] });

    // ---- 7. Refreshed content: same key, changed bytes ----------------
    console.log('\n[7] re-promotion of changed content versions the document and contests the insight');
    // A later task fetched the refreshed page; its snapshot parks separately.
    const snapshot2: WorkspaceSnapshot = {
      version: 1,
      plan: [],
      notes: [],
      segments: { [V2_ID]: segmentOf(V2_CONTENT, { taskId: TASK2_ID }) },
    };
    await redis.set(scratchKey(GOAL_ID, TASK2_ID), JSON.stringify(snapshot2), 'EX', config.scratch.ttlSeconds);

    // Library mode with a captured invalidation payload (the
    // test_repo_ingest precedent) so the sweep runs deterministically
    // in-process instead of needing the invalidation worker.
    const capturedSweeps: Array<{ orphanedHashes: string[]; freshHashes: string[] }> = [];
    const deps: IngestDeps = {
      pgPool,
      queues: {
        extraction: {
          addBulk: async jobs => {
            throw new Error(`unexpected extraction enqueue of ${jobs.length} job(s) under policy none`);
          },
        },
        invalidation: {
          add: async (_name, data) => {
            capturedSweeps.push({
              orphanedHashes: data.orphanedHashes as string[],
              freshHashes: data.freshHashes as string[],
            });
          },
        },
      },
      log: loggerFor({ component: 'promotion_drill' }),
    };
    const plan2 = planSegmentPromotion(snapshot2, V2_ID, DOC_KEY);
    check('re-promotion plan accepted', plan2.ok, true);
    if (!plan2.ok) throw new Error('cannot continue without the v2 plan');
    const outcome2 = await promoteSegment(deps, plan2.request, { mode: 'none' }, crypto.randomUUID());
    check('re-promotion registers version 2', outcome2.ingest.version, 2);
    check('Merkle diff orphans the v1 block',
      capturedSweeps.length === 1 && capturedSweeps[0].orphanedHashes.includes(v1Block), true);
    check('policy none sends an empty fresh set (conservative quarantine)',
      capturedSweeps[0].freshHashes, []);
    const v2Row = await documentRow(2);
    check('version 2 carries the refreshed origin stamp (new segment id)',
      v2Row?.origin?.segmentId, V2_ID);

    // The invalidation worker's exact steps over the captured payload.
    const globalOrphans = await findGloballyOrphanedAstNodeIds(pgPool, capturedSweeps[0].orphanedHashes);
    check('v1 block is globally orphaned after the re-promotion', globalOrphans.includes(v1Block), true);
    const sweep = await sweepOrphanedProvenance(neo4jDriver, globalOrphans, capturedSweeps[0].freshHashes);
    check('sweep contests at least the insight edge', sweep.contestedRelationships >= 1, true);

    const contested = await insightState();
    check('insight is contested with the audit trail preserved',
      contested && {
        contested: contested.contested,
        sources: contested.sourceNodeIds,
        orphaned: contested.orphanedSourceIds,
      },
      { contested: true, sources: [], orphaned: [v1Block] });
    check('superseded v1 block is dead', await isAstNodeLive(pgPool, v1Block), false);
    check('refreshed v2 block is live', await isAstNodeLive(pgPool, v2Block), true);
  } finally {
    // ---- Cleanup: token-scoped state only -----------------------------
    const session = neo4jDriver.session();
    try {
      await session.run(
        'MATCH (n:Entity) WHERE n.name STARTS WITH $prefix DETACH DELETE n',
        { prefix: TOKEN.toLowerCase() }
      );
    } finally {
      await session.close();
    }
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM documents WHERE doc_key = $1', [DOC_KEY]);
      await client.query('DELETE FROM document_nodes WHERE root_hash = ANY($1)', [[v1Root.id, v2Root.id]]);
      await client.query('DELETE FROM ast_nodes WHERE id = ANY($1)', [ownedNodeIds]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    await redis.del(scratchKey(GOAL_ID, TASK_ID), scratchKey(GOAL_ID, TASK2_ID), scratchBytesKey(GOAL_ID));
    await redis.quit().catch(() => {});
  }
}

main()
  .then(async () => {
    await pgPool.end();
    await neo4jDriver.close();
    console.log(failures === 0 ? '\nAll promotion checks passed.' : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async err => {
    console.error(`\nTest run error: ${err instanceof Error ? err.stack ?? err.message : err}`);
    try { await pgPool.end(); await neo4jDriver.close(); } catch {}
    process.exit(1);
  });
