import { execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import util from 'util';
import IORedis from 'ioredis';
import { pgPool, neo4jDriver } from '../src/config/db';
import { config } from '../src/config/index';
import { loadModule } from '../src/config/modules';
import { parseMarkdownToAST } from '../src/core/ast/parser';
import { flattenAST, collectExtractionBlocks, nodeText } from '../src/core/ast/traverse';
import { findGloballyOrphanedAstNodeIds } from '../src/core/ast/registry';
import { sweepOrphanedProvenance } from '../src/core/graph/invalidation';
import { MODULE_ENTITY_KIND, moduleEntityName } from '../src/core/graph/module_registration';
import type { IngestDeps } from '../src/core/ingestion/ingest_document';
import { planSegmentPromotion } from '../src/core/promotion/plan_promotion';
import { promoteSegment } from '../src/core/promotion/promote_segment';
import { scratchBytesKey, scratchKey, type WorkspaceSnapshot } from '../src/workers/workspace_scratch';
import { loggerFor } from '../src/core/observability/logger';

// Session 18 live drill: the module lifecycle (design record §9.4, §11
// step 6), zero LLM calls, zero external network (requires the
// docker-compose stack).
//
// The full capability-provenance loop, against real Redis, PostgreSQL,
// and Neo4j:
//   1. Promote a fixture research corpus through the REAL Session 17
//      path (parked snapshot -> planSegmentPromotion -> promoteSegment)
//      — the promoted block hash is the research provenance.
//   2. A drill-owned temp module citing that hash: the registration CLI
//      accepts it and MERGEs the graph entity
//      (:Entity {kind: 'module_manifest', name: 'module:<name>'}).
//   3. Refusals: a manifest citing a well-formed unknown hash refuses
//      the WHOLE invocation with a bounded listing (existence gate,
//      before any write — a co-registered valid module is not written
//      either); module #0 (empty research) registers nothing.
//   4. Idempotency: registering twice changes nothing (MERGE semantics).
//   5. The §9.4 loop: re-promoting changed bytes under the same doc key
//      orphans the research hash; the UNCHANGED invalidation sweep
//      contests the module entity with the audit trail preserved; the
//      verify mode reports it; a manifest flipped to status contested
//      is refused composition AND skipped by re-registration (no silent
//      un-contest); re-registration with live research (status back to
//      active) recovers the entity per the provenance state machine.
// All state is token-scoped and cleaned up.

const execFileAsync = util.promisify(execFile);

const EPOCH = Date.now();
const TOKEN = `lc${EPOCH}`;
const MOD_MAIN = `${TOKEN}-research`;
const MOD_BAD = `${TOKEN}-badhash`;
const MOD_SIDE = `${TOKEN}-side`;
const GOAL_ID = `${TOKEN}-goal`;
const TASK_ID = `${TOKEN}-task-1`;
const TASK2_ID = `${TOKEN}-task-2`;
const DOC_KEY = `web:https://drill.example.test/${TOKEN}`;
const ARGS_HASH = 'ab12cd34ef56ab78';
const SEG_V1 = crypto.randomUUID();
const SEG_V2 = crypto.randomUUID();
const UNKNOWN_HASH = 'f'.repeat(64);

const V1_CONTENT = `${TOKEN} research finding: recursive delegation caps effective context loss.`;
const V2_CONTENT = `${TOKEN} research finding (revised): recursive delegation caps are task-dependent.`;

// Session 19: the grounded-authoring end-to-end corpus. A multi-block
// research document (anchor-rich) promoted through the real Session 17
// path, then the real author driver assembles a module from it via a
// saved draft (zero paid). AUTHORED_NAME shares the TOKEN prefix so the
// Neo4j cleanup below reaches its entity.
const AUTHORED_NAME = `${TOKEN}-authored`;
const AUTHOR_DOC_KEY = `web:https://drill.example.test/${TOKEN}-author`;
const AUTHOR_SEG_V1 = crypto.randomUUID();
const AUTHOR_SEG_V2 = crypto.randomUUID();
const AUTHOR_TASK1 = `${TOKEN}-author-task-1`;
const AUTHOR_TASK2 = `${TOKEN}-author-task-2`;

const AUTHOR_CORPUS_V1 = [
  '# Workspace discipline',
  '',
  'The workspace probe measured external tool calls: the workspace arm made 4 while the legacy arm repeated every call, 8 vs 4 across the run.',
  '',
  '- Treat a workspace update as an atomic transition: build-new-then-rebind; never trust a torn in-place mutation.',
  '- Respect the write budget exactly; a write over budget must raise rather than truncate.',
  '- Segments hold captured external results with wrapper-owned origin stamps; read the stored segment before fetching again.',
  '- Workspace content has no provenance standing: a segment id is never a source hash; promote a segment to earn citable provenance.',
  '- When prior material is partially orphaned, mark it contested, exclude it, and repair by re-deriving from live bytes.',
].join('\n');
// v2 rewrites the "8 vs 4" paragraph only: that block hash orphans, the
// rest are retained (shared subtree). The authored module pins the v1
// block, so the sweep contests it — §9.4 reaching the authored entity.
const AUTHOR_CORPUS_V2 = AUTHOR_CORPUS_V1.replace(
  'The workspace probe measured external tool calls: the workspace arm made 4 while the legacy arm repeated every call, 8 vs 4 across the run.',
  'The revised probe measured the two arms differently; the external-call counts are task-dependent.'
);

const GOOD_DRAFT = {
  purpose: 'Teaches an RLM to reuse the workspace as durable, repair-safe working memory.',
  addendum: [
    'WORKSPACE DISCIPLINE PROTOCOL',
    'Reuse prior snapshots instead of re-deriving; read the stored segment before fetching again.',
    'Treat every workspace update as an atomic transition: build the next state, then rebind; never trust a torn in-place mutation.',
    'Respect the write budget exactly: a write over budget must raise, not silently truncate.',
    'Keep captured external results as segments with their origin stamps.',
    'Workspace content has no provenance standing: a segment is never a source hash; earn citable provenance only by promotion.',
    'If prior material is partially orphaned, mark it contested, exclude it, and repair by re-deriving from live bytes.',
  ].join('\n'),
  gapNotes: ['the corpus does not cover cross-goal sharing'],
};
const GENERIC_DRAFT = {
  purpose: 'General good advice.',
  addendum: 'GENERAL PROTOCOL\nAlways think carefully. Consider every option and pick the best one. Be helpful and thorough.',
  gapNotes: [],
};
const HASH_DRAFT = {
  purpose: 'A draft that tries to cite.',
  addendum: `WORKSPACE PROTOCOL derived from ${'a'.repeat(64)}`,
  gapNotes: [],
};

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
  if (!ok) failures++;
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
      'scripts/register_modules.ts',
      ...args,
    ], { cwd: path.resolve(__dirname, '..') });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
  }
}

// The real grounded-authoring driver (Session 19). extraEnv lets a
// negative case shrink the workspace bounds to force an over-budget seed
// refusal without a giant corpus.
async function runAuthor(
  args: string[],
  extraEnv: Record<string, string> = {}
): Promise<CliRun> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      tsxCli,
      'scripts/author_module.ts',
      ...args,
    ], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, ...extraEnv } });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
  }
}

function writeModuleDir(
  root: string,
  name: string,
  research: string[],
  overrides: Record<string, unknown> = {}
): void {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'module.json'), JSON.stringify({
    name,
    version: 1,
    purpose: 'Lifecycle drill module.',
    research: { sourceNodeIds: research },
    addendum: 'addendum.txt',
    tools: [],
    bounds: { addendumMaxBytes: 1024 },
    // Named per module because the schema refuses a criterion that does not
    // contain its own module name — a criterion shared across modules
    // discriminates nothing. Before `...overrides` so a case can still
    // override it to exercise the refusal.
    acceptance: { zeroPaid: `npm run test:module -- ${name}` },
    status: 'active',
    kernelCompat: 1,
    ...overrides,
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'addendum.txt'), 'LIFECYCLE DRILL PROTOCOL\nNo braces here.\n');
}

interface EntityState {
  kind: string | null;
  moduleVersion: number | null;
  sourceNodeIds: string[] | null;
  orphanedSourceIds: string[] | null;
  contested: boolean;
  contestedAt: number | null;
  rederivedAt: number | null;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  return (value as { toNumber: () => number }).toNumber();
}

async function entityState(name: string): Promise<EntityState | undefined> {
  const session = neo4jDriver.session();
  try {
    const res = await session.run(
      `MATCH (e:Entity {name: $name})
       RETURN e.kind AS kind, e.moduleVersion AS moduleVersion,
              e.sourceNodeIds AS sourceNodeIds, e.orphanedSourceIds AS orphanedSourceIds,
              coalesce(e.contested, false) AS contested,
              e.contestedAt AS contestedAt, e.rederivedAt AS rederivedAt`,
      { name }
    );
    const rec = res.records[0];
    return rec && {
      kind: rec.get('kind'),
      moduleVersion: toNullableNumber(rec.get('moduleVersion')),
      sourceNodeIds: rec.get('sourceNodeIds'),
      orphanedSourceIds: rec.get('orphanedSourceIds'),
      contested: rec.get('contested'),
      contestedAt: toNullableNumber(rec.get('contestedAt')),
      rederivedAt: toNullableNumber(rec.get('rederivedAt')),
    };
  } finally {
    await session.close();
  }
}

function segmentOf(id: string, content: string, taskId: string) {
  return {
    [id]: {
      origin: { server: 'fixture', tool: 'search', argsHash: ARGS_HASH },
      fetchedAt: '2026-07-08T12:00:00Z',
      bytes: Buffer.byteLength(content, 'utf8'),
      truncated: false,
      content,
      goalId: GOAL_ID,
      taskId,
    },
  };
}

async function main(): Promise<void> {
  const redis = new IORedis({
    host: config.redis.host,
    port: config.redis.port,
    maxRetriesPerRequest: null,
  });

  const v1Root = parseMarkdownToAST(V1_CONTENT);
  const v2Root = parseMarkdownToAST(V2_CONTENT);
  const v1Block = collectExtractionBlocks(v1Root)[0].id;
  const v2Block = collectExtractionBlocks(v2Root)[0].id;

  // Session 19: the authoring corpus roots and their extraction-eligible
  // block hashes (the set the driver pins and seeds — blocksFromRoot's
  // filter).
  const authorRootV1 = parseMarkdownToAST(AUTHOR_CORPUS_V1);
  const authorRootV2 = parseMarkdownToAST(AUTHOR_CORPUS_V2);
  const authorBlockHashes = [
    ...new Set(
      collectExtractionBlocks(authorRootV1)
        .filter(b => nodeText(b).trim().length > 0)
        .map(b => b.id)
    ),
  ].sort();

  const ownedNodeIds = [...new Set([
    ...flattenAST(v1Root),
    ...flattenAST(v2Root),
    ...flattenAST(authorRootV1),
    ...flattenAST(authorRootV2),
  ].map(n => n.id))];

  const tmpMain = fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-lifecycle-'));
  const tmpBad = fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-lifecycle-bad-'));
  const tmpAuthorOut = fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-author-out-'));
  const tmpDrafts = fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-author-drafts-'));
  const goodDraftPath = path.join(tmpDrafts, 'good.json');
  const genericDraftPath = path.join(tmpDrafts, 'generic.json');
  const hashDraftPath = path.join(tmpDrafts, 'hash.json');
  fs.writeFileSync(goodDraftPath, JSON.stringify(GOOD_DRAFT));
  fs.writeFileSync(genericDraftPath, JSON.stringify(GENERIC_DRAFT));
  fs.writeFileSync(hashDraftPath, JSON.stringify(HASH_DRAFT));

  // Library-mode ingest deps: extraction must never be touched under
  // policy none; invalidation payloads are captured so the worker's
  // exact sweep steps run deterministically in-process.
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
    log: loggerFor({ component: 'module_lifecycle_drill' }),
  };

  try {
    // ---- 1. Promote the fixture research corpus (the real S17 path) ----
    console.log('\n[1] promote a fixture research segment (parked snapshot -> verified ingest)');
    const snapshot: WorkspaceSnapshot = {
      version: 1,
      plan: [{ id: 's1', desc: 'research', status: 'done' }],
      notes: [`${TOKEN} research note`],
      segments: segmentOf(SEG_V1, V1_CONTENT, TASK_ID),
    };
    await redis.set(scratchKey(GOAL_ID, TASK_ID), JSON.stringify(snapshot), 'EX', config.scratch.ttlSeconds);
    const plan1 = planSegmentPromotion(snapshot, SEG_V1, DOC_KEY);
    check('promotion plan accepted', plan1.ok, true);
    if (!plan1.ok) throw new Error('cannot continue without the v1 promotion');
    const outcome1 = await promoteSegment(deps, plan1.request, { mode: 'none' }, crypto.randomUUID());
    check('research corpus registered as version 1', outcome1.ingest.version, 1);
    check('promotion yields the citable research block hash', outcome1.blockIds, [v1Block]);

    // ---- 2. Register the research-bearing module --------------------
    console.log('\n[2] register a temp module citing the promoted hash');
    writeModuleDir(tmpMain, MOD_MAIN, [v1Block]);
    const reg1 = await runCli('--modules-dir', tmpMain);
    check('registration exits 0', reg1.code, 0);
    check('registration names the entity', reg1.stdout.includes(moduleEntityName(MOD_MAIN)), true);
    const created = await entityState(moduleEntityName(MOD_MAIN));
    check('module entity exists with kind/version/research provenance',
      created && {
        kind: created.kind,
        version: created.moduleVersion,
        sources: created.sourceNodeIds,
        contested: created.contested,
      },
      { kind: MODULE_ENTITY_KIND, version: 1, sources: [v1Block], contested: false });

    // ---- 3. Refusals -------------------------------------------------
    console.log('\n[3] refusals (existence gate before any write; empty research no-op)');
    writeModuleDir(tmpBad, MOD_BAD, [UNKNOWN_HASH]);
    writeModuleDir(tmpBad, MOD_SIDE, [v1Block]);
    const refused = await runCli('--modules-dir', tmpBad);
    check('unknown research hash refuses the invocation', refused.code === 0, false);
    check('refusal lists the missing hash (bounded)', refused.stderr.includes(UNKNOWN_HASH), true);
    check('refusal names the offending module', refused.stderr.includes(MOD_BAD), true);
    check('refusal points at the promotion path', refused.stderr.includes('npm run promote'), true);
    check('the co-registered valid module is NOT written either (gate precedes writes)',
      await entityState(moduleEntityName(MOD_SIDE)), undefined);

    const mod0 = await runCli('--module', 'spatial-flywheel');
    check('module #0 registration exits 0', mod0.code, 0);
    check('module #0 is skipped as empty research', mod0.stdout.includes("Skipping 'spatial-flywheel'"), true);
    check('module #0 has no graph entity (the pinned no-op)',
      await entityState(moduleEntityName('spatial-flywheel')), undefined);

    // ---- 4. Idempotency ----------------------------------------------
    console.log('\n[4] registering twice changes nothing (MERGE semantics)');
    const before = await entityState(moduleEntityName(MOD_MAIN));
    const reg2 = await runCli('--modules-dir', tmpMain);
    check('second registration exits 0', reg2.code, 0);
    check('second registration leaves the entity state identical',
      await entityState(moduleEntityName(MOD_MAIN)), before);

    // ---- 5. The §9.4 loop: research change contests the module -------
    console.log('\n[5] re-promotion of changed research contests the module entity');
    const snapshot2: WorkspaceSnapshot = {
      version: 1,
      plan: [],
      notes: [],
      segments: segmentOf(SEG_V2, V2_CONTENT, TASK2_ID),
    };
    await redis.set(scratchKey(GOAL_ID, TASK2_ID), JSON.stringify(snapshot2), 'EX', config.scratch.ttlSeconds);
    const plan2 = planSegmentPromotion(snapshot2, SEG_V2, DOC_KEY);
    check('re-promotion plan accepted', plan2.ok, true);
    if (!plan2.ok) throw new Error('cannot continue without the v2 promotion');
    const outcome2 = await promoteSegment(deps, plan2.request, { mode: 'none' }, crypto.randomUUID());
    check('re-promotion registers version 2', outcome2.ingest.version, 2);
    // The v1 ingest has no prior version and queues no invalidation, so
    // the re-promotion's payload is the only captured sweep.
    check('Merkle diff orphans the v1 research block',
      capturedSweeps.length === 1 && capturedSweeps[0].orphanedHashes.includes(v1Block), true);

    // The invalidation worker's exact steps over the captured payload —
    // the sweep itself is UNCHANGED; reaching module entities needed
    // zero sweep changes (§9.4).
    const globalOrphans = await findGloballyOrphanedAstNodeIds(pgPool, capturedSweeps[0].orphanedHashes);
    check('v1 research block is globally orphaned', globalOrphans.includes(v1Block), true);
    const sweep = await sweepOrphanedProvenance(neo4jDriver, globalOrphans, capturedSweeps[0].freshHashes);
    check('the unchanged sweep contests at least the module entity', sweep.contestedNodes >= 1, true);

    const contested = await entityState(moduleEntityName(MOD_MAIN));
    check('module entity contested with the audit trail preserved',
      contested && {
        contested: contested.contested,
        sources: contested.sourceNodeIds,
        orphaned: contested.orphanedSourceIds,
        stamped: contested.contestedAt !== null,
      },
      { contested: true, sources: [], orphaned: [v1Block], stamped: true });

    // ---- 6. Verify mode reports the contested module ------------------
    console.log('\n[6] the verify mode surfaces the contested capability');
    const verify = await runCli('--verify', '--modules-dir', tmpMain, '--module', MOD_MAIN);
    check('verify exits 0 (read-only report)', verify.code, 0);
    check('verify reports the entity contested', verify.stdout.includes('contested:   true'), true);
    check('verify lists the orphaned research hash', verify.stdout.includes(v1Block), true);
    check('verify prescribes the human loop (flip status, re-review, re-register)',
      verify.stdout.includes('ACTION') && verify.stdout.includes('"status": "contested"'), true);
    check('verify counts the contested module', verify.stdout.includes('1 module(s) contested'), true);

    // ---- 7. The manifest flip: composition refused, no silent recovery ----
    console.log('\n[7] status contested: composition refused; re-registration skips (never un-contests)');
    const manifestPath = path.join(tmpMain, MOD_MAIN, 'module.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, status: 'contested' }, null, 2));
    let composeError = '';
    try {
      loadModule(MOD_MAIN, tmpMain);
    } catch (err) {
      composeError = (err as Error).message;
    }
    check('contested manifest is refused composition with a readable error',
      composeError.includes('only active modules load'), true);
    const skipRun = await runCli('--modules-dir', tmpMain);
    check('registration skips the contested manifest', skipRun.stdout.includes(`Skipping '${MOD_MAIN}'`), true);
    const stillContested = await entityState(moduleEntityName(MOD_MAIN));
    check('the graph entity stays contested (recovery requires re-review, not a re-run)',
      stillContested?.contested, true);

    // ---- 8. Recovery: re-review lands new research, re-registration recovers ----
    console.log('\n[8] recovery: active manifest citing the refreshed research re-registers');
    fs.writeFileSync(manifestPath, JSON.stringify({
      ...manifest,
      version: 2,
      research: { sourceNodeIds: [v2Block] },
      status: 'active',
    }, null, 2));
    const recover = await runCli('--modules-dir', tmpMain);
    check('recovery registration exits 0', recover.code, 0);
    const recovered = await entityState(moduleEntityName(MOD_MAIN));
    check('entity recovered per the provenance state machine',
      recovered && {
        contested: recovered.contested,
        sources: recovered.sourceNodeIds,
        orphaned: recovered.orphanedSourceIds,
        version: recovered.moduleVersion,
        rederived: recovered.rederivedAt !== null,
        auditKept: recovered.contestedAt !== null,
      },
      { contested: false, sources: [v2Block], orphaned: [v1Block], version: 2, rederived: true, auditKept: true });

    const verifyAfter = await runCli('--verify', '--modules-dir', tmpMain, '--module', MOD_MAIN);
    check('verify reports the recovery', verifyAfter.stdout.includes('recovered:'), true);
    check('verify reports all clear', verifyAfter.stdout.includes('All registered module entities are uncontested.'), true);

    // ---- 9. Post-recovery idempotency ---------------------------------
    console.log('\n[9] post-recovery idempotency');
    const settled = await entityState(moduleEntityName(MOD_MAIN));
    await runCli('--modules-dir', tmpMain);
    check('re-registering the recovered module changes nothing',
      await entityState(moduleEntityName(MOD_MAIN)), settled);

    // ---- 10. Grounded authoring end-to-end (Session 19) ---------------
    console.log('\n[10] grounded authoring: promote a corpus, drive the REAL driver with --draft');
    const authorSnap1: WorkspaceSnapshot = {
      version: 1, plan: [], notes: [],
      segments: segmentOf(AUTHOR_SEG_V1, AUTHOR_CORPUS_V1, AUTHOR_TASK1),
    };
    await redis.set(scratchKey(GOAL_ID, AUTHOR_TASK1), JSON.stringify(authorSnap1), 'EX', config.scratch.ttlSeconds);
    const aplan1 = planSegmentPromotion(authorSnap1, AUTHOR_SEG_V1, AUTHOR_DOC_KEY);
    if (!aplan1.ok) throw new Error('cannot continue without the author corpus promotion');
    const authorOutcome1 = await promoteSegment(deps, aplan1.request, { mode: 'none' }, crypto.randomUUID());
    check('author corpus promoted as version 1', authorOutcome1.ingest.version, 1);
    check('promotion yields the author corpus block hashes',
      [...new Set(authorOutcome1.blockIds)].sort(), authorBlockHashes);

    const authorRun = await runAuthor([
      '--module-name', AUTHORED_NAME,
      '--topic', 'workspace discipline for an RLM sub-agent',
      '--doc-key', AUTHOR_DOC_KEY,
      '--out-dir', tmpAuthorOut,
      '--draft', goodDraftPath,
    ]);
    check('the author driver exits 0 on a good draft', authorRun.code, 0);
    check('the driver reports the anchor gate passed', authorRun.stdout.includes('Anchor derivation gate'), true);
    const assembledDir = path.join(tmpAuthorOut, AUTHORED_NAME);
    check('the module directory is assembled', fs.existsSync(assembledDir), true);
    const assembledManifest = JSON.parse(fs.readFileSync(path.join(assembledDir, 'module.json'), 'utf-8'));
    check('research.sourceNodeIds pinned to the promoted corpus set (sorted, deduped)',
      assembledManifest.research.sourceNodeIds, authorBlockHashes);
    check('the addendum and RESEARCH.md were written',
      fs.existsSync(path.join(assembledDir, 'addendum.txt'))
      && fs.existsSync(path.join(assembledDir, 'RESEARCH.md')), true);
    const assembledModule = loadModule(AUTHORED_NAME, tmpAuthorOut);
    check('the assembled module loads (brace-free, active, in-bounds)',
      assembledModule.addendumText.includes('WORKSPACE DISCIPLINE PROTOCOL'), true);

    const authorReg = await runCli('--modules-dir', tmpAuthorOut, '--module', AUTHORED_NAME);
    check('the authored module registers (existence gate passes on pinned hashes)', authorReg.code, 0);
    const authorEntity = await entityState(moduleEntityName(AUTHORED_NAME));
    check('authored module entity registered with the pinned research provenance',
      authorEntity && {
        kind: authorEntity.kind,
        sources: [...(authorEntity.sourceNodeIds ?? [])].sort(),
        contested: authorEntity.contested,
      },
      { kind: MODULE_ENTITY_KIND, sources: authorBlockHashes, contested: false });

    // §9.4 reaches the authored entity: re-promoting changed corpus
    // orphans a pinned block and the UNCHANGED sweep contests the module.
    const authorSnap2: WorkspaceSnapshot = {
      version: 1, plan: [], notes: [],
      segments: segmentOf(AUTHOR_SEG_V2, AUTHOR_CORPUS_V2, AUTHOR_TASK2),
    };
    await redis.set(scratchKey(GOAL_ID, AUTHOR_TASK2), JSON.stringify(authorSnap2), 'EX', config.scratch.ttlSeconds);
    const aplan2 = planSegmentPromotion(authorSnap2, AUTHOR_SEG_V2, AUTHOR_DOC_KEY);
    if (!aplan2.ok) throw new Error('cannot continue without the author re-promotion');
    const sweepsBefore = capturedSweeps.length;
    const authorOutcome2 = await promoteSegment(deps, aplan2.request, { mode: 'none' }, crypto.randomUUID());
    check('author corpus re-promoted as version 2', authorOutcome2.ingest.version, 2);
    check('the re-promotion captured exactly one new sweep', capturedSweeps.length, sweepsBefore + 1);
    const authorSweep = capturedSweeps[capturedSweeps.length - 1];
    const authorGlobalOrphans = await findGloballyOrphanedAstNodeIds(pgPool, authorSweep.orphanedHashes);
    await sweepOrphanedProvenance(neo4jDriver, authorGlobalOrphans, authorSweep.freshHashes);
    const authorContested = await entityState(moduleEntityName(AUTHORED_NAME));
    check('§9.4 reaches the authored capability: research change contests it',
      authorContested?.contested, true);

    // ---- 11. Authoring negatives (nothing written on refusal) ---------
    console.log('\n[11] authoring negatives: below-threshold, hash-bearing, over-budget, plan-only');
    const genericRun = await runAuthor([
      '--module-name', `${TOKEN}-generic`, '--topic', 'workspace discipline for an RLM',
      '--doc-key', AUTHOR_DOC_KEY, '--out-dir', tmpAuthorOut, '--draft', genericDraftPath,
    ]);
    check('a below-threshold draft refuses assembly', genericRun.code === 0, false);
    check('the refusal cites the anchor threshold',
      (genericRun.stdout + genericRun.stderr).includes('threshold'), true);
    check('nothing was written for the refused generic draft',
      fs.existsSync(path.join(tmpAuthorOut, `${TOKEN}-generic`)), false);

    const hashRun = await runAuthor([
      '--module-name', `${TOKEN}-hash`, '--topic', 'workspace discipline for an RLM',
      '--doc-key', AUTHOR_DOC_KEY, '--out-dir', tmpAuthorOut, '--draft', hashDraftPath,
    ]);
    check('a hash-bearing draft is refused at the scanner', hashRun.code === 0, false);
    check('the refusal names the pinning rule',
      (hashRun.stdout + hashRun.stderr).includes('refused')
      || (hashRun.stdout + hashRun.stderr).includes('64-hex'), true);
    check('nothing was written for the hash-bearing draft',
      fs.existsSync(path.join(tmpAuthorOut, `${TOKEN}-hash`)), false);

    const budgetRun = await runAuthor([
      '--module-name', `${TOKEN}-budget`, '--topic', 'workspace discipline for an RLM',
      '--doc-key', AUTHOR_DOC_KEY, '--out-dir', tmpAuthorOut, '--draft', goodDraftPath,
    ], { TRELLIS_WORKSPACE_MAX_BYTES: '128' });
    check('an over-budget corpus refuses the seed', budgetRun.code === 0, false);
    check('the budget refusal is readable',
      (budgetRun.stdout + budgetRun.stderr).includes('budget'), true);
    check('nothing was written for the over-budget corpus',
      fs.existsSync(path.join(tmpAuthorOut, `${TOKEN}-budget`)), false);

    const planRun = await runAuthor([
      '--module-name', `${TOKEN}-plan`, '--topic', 'workspace discipline for an RLM',
      '--doc-key', AUTHOR_DOC_KEY, '--out-dir', tmpAuthorOut,
    ]);
    check('the plan-only default exits 0 and spawns nothing', planRun.code, 0);
    check('the plan-only run echoes the plan and refuses to spawn',
      planRun.stdout.includes('Plan only'), true);
    check('the plan-only run writes nothing',
      fs.existsSync(path.join(tmpAuthorOut, `${TOKEN}-plan`)), false);
  } finally {
    // ---- Cleanup: token-scoped state only -----------------------------
    const session = neo4jDriver.session();
    try {
      await session.run(
        'MATCH (n:Entity) WHERE n.name STARTS WITH $prefix DETACH DELETE n',
        { prefix: `module:${TOKEN}` }
      );
    } finally {
      await session.close();
    }
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM documents WHERE doc_key = ANY($1)', [[DOC_KEY, AUTHOR_DOC_KEY]]);
      await client.query('DELETE FROM document_nodes WHERE root_hash = ANY($1)',
        [[v1Root.id, v2Root.id, authorRootV1.id, authorRootV2.id]]);
      await client.query('DELETE FROM ast_nodes WHERE id = ANY($1)', [ownedNodeIds]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    await redis.del(
      scratchKey(GOAL_ID, TASK_ID), scratchKey(GOAL_ID, TASK2_ID),
      scratchKey(GOAL_ID, AUTHOR_TASK1), scratchKey(GOAL_ID, AUTHOR_TASK2),
      scratchBytesKey(GOAL_ID)
    );
    await redis.quit().catch(() => {});
    fs.rmSync(tmpMain, { recursive: true, force: true });
    fs.rmSync(tmpBad, { recursive: true, force: true });
    fs.rmSync(tmpAuthorOut, { recursive: true, force: true });
    fs.rmSync(tmpDrafts, { recursive: true, force: true });
  }
}

main()
  .then(async () => {
    await pgPool.end();
    await neo4jDriver.close();
    console.log(failures === 0 ? '\nAll module-lifecycle checks passed.' : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async err => {
    console.error(`\nTest run error: ${err instanceof Error ? err.stack ?? err.message : err}`);
    try { await pgPool.end(); await neo4jDriver.close(); } catch {}
    process.exit(1);
  });
