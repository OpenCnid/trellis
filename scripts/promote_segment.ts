import crypto from 'crypto';
import IORedis from 'ioredis';
import { pgPool } from '../src/config/db';
import { config } from '../src/config/index';
import { extractionQueue, invalidationQueue } from '../src/workers/queue';
import type { IngestDeps } from '../src/core/ingestion/ingest_document';
import type { ExtractionPolicy } from '../src/core/ingestion/plan_ingest';
import {
  derivedDocKey,
  listSegments,
  planSegmentPromotion,
} from '../src/core/promotion/plan_promotion';
import { promoteSegment } from '../src/core/promotion/promote_segment';
import {
  parseWorkspaceSnapshot,
  scratchKey,
  type WorkspaceSnapshot,
} from '../src/workers/workspace_scratch';
import { loggerFor } from '../src/core/observability/logger';

// Segment promotion CLI (Session 17, design record §6 / §11 step 5).
//
//   npm run promote -- --goal <goalId> --task <taskId>                 (list)
//   npm run promote -- --goal <goalId> --task <taskId> \
//                      --segment <id> --doc-key <key> [flags]        (promote)
//
// THE operator gate on the promotion path: the only route by which
// Tier-3 workspace content becomes verified, citable substrate. It is a
// human running this command — no API endpoint promotes, no model output
// triggers it. Promotion consumes a PARKED snapshot (Redis,
// scratch:goal:<goalId>:task:<taskId>) only — never a live workspace —
// and promotes exactly one segment per invocation through the ordinary
// verified ingest transaction.
//
// The default is zero paid work: --extract none persists, versions,
// diffs, and queues invalidation only. Real extraction requires an
// explicit positive --max-blocks budget AND --confirm-extraction (the
// repo:ingest double gate).
//
// Doc keys are the operator's call, never invented silently. For web
// content use web:<url> (stable across refreshes — re-promoting the
// re-fetched page versions the same document and the sweep contests
// beliefs whose bytes changed). For non-URL tool results, list mode
// prints the deterministic fallback mcp:<server>:<tool>:<argsHash>.
//
// Flags:
//   --goal <goalId>           required; the goal whose scratch is read
//   --task <taskId>           required; the parked task snapshot
//   --segment <id>            promote mode: the segment to promote
//   --doc-key <key>           promote mode: the stable document identity
//   --extract none|changed    extraction policy (default: none)
//   --max-blocks <n>          required positive budget for changed
//   --confirm-extraction      required acknowledgement for changed

interface CliArgs {
  goalId?: string;
  taskId?: string;
  segmentId?: string;
  docKey?: string;
  extract: 'none' | 'changed';
  maxBlocks?: number;
  confirmExtraction: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { extract: 'none', confirmExtraction: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} requires a value`);
      return next;
    };
    switch (flag) {
      case '--goal': args.goalId = value(); break;
      case '--task': args.taskId = value(); break;
      case '--segment': args.segmentId = value(); break;
      case '--doc-key': args.docKey = value(); break;
      case '--extract': {
        const mode = value();
        if (mode !== 'none' && mode !== 'changed') {
          throw new Error(`--extract must be none or changed, got ${mode}`);
        }
        args.extract = mode;
        break;
      }
      case '--max-blocks': args.maxBlocks = Number(value()); break;
      case '--confirm-extraction': args.confirmExtraction = true; break;
      default: throw new Error(`Unknown flag: ${flag}`);
    }
  }
  return args;
}

function buildPolicy(args: CliArgs): ExtractionPolicy {
  if (args.extract === 'none') return { mode: 'none' };
  if (!Number.isInteger(args.maxBlocks) || (args.maxBlocks as number) <= 0) {
    throw new Error('--extract changed requires an explicit positive --max-blocks budget');
  }
  if (!args.confirmExtraction) {
    throw new Error(
      '--extract changed enqueues PAID chat and embedding calls; '
      + 're-run with --confirm-extraction after reviewing the echoed segment'
    );
  }
  return { mode: 'changed', maxBlocks: args.maxBlocks as number };
}

async function readParkedSnapshot(
  redis: IORedis,
  goalId: string,
  taskId: string
): Promise<WorkspaceSnapshot> {
  const key = scratchKey(goalId, taskId);
  const raw = await redis.get(key);
  if (raw === null) {
    throw new Error(
      `No parked workspace snapshot at ${key} — the task never parked one, its park was `
      + `refused by the per-goal bytes cap, or it expired past SCRATCH_TTL_SECONDS `
      + `(currently ${config.scratch.ttlSeconds}s). Promotion consumes parked snapshots only.`
    );
  }
  return parseWorkspaceSnapshot(raw, `parked task '${taskId}'`);
}

function printInventory(goalId: string, taskId: string, snapshot: WorkspaceSnapshot): void {
  const segments = listSegments(snapshot);
  console.log(`Parked workspace for goal '${goalId}', task '${taskId}':`);
  console.log(`  notes: ${snapshot.notes.length}, segments: ${segments.length}`);
  if (segments.length === 0) {
    console.log('  (no segments — nothing is promotable from this snapshot)');
    return;
  }
  for (const segment of segments) {
    console.log(`\n  segment ${segment.id}`);
    console.log(`    origin:     ${segment.server} / ${segment.tool} (argsHash ${segment.argsHash})`);
    console.log(`    fetchedAt:  ${segment.fetchedAt}`);
    console.log(`    bytes:      ${segment.bytes}${segment.truncated ? '  TRUNCATED — not promotable' : ''}`);
    console.log(`    preview:    ${segment.preview}`);
    console.log(`    key hint:   ${segment.suggestedDocKey}`);
  }
  console.log(
    '\nPromote one segment with: --segment <id> --doc-key <key>'
    + '  (web:<url> for web content; the printed key hint for non-URL tool results)'
  );
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.goalId || !args.taskId) {
    console.error('Both --goal and --task are required (the parked snapshot to inspect).');
    return 1;
  }
  const policy = buildPolicy(args);

  const redis = new IORedis({
    host: config.redis.host,
    port: config.redis.port,
    maxRetriesPerRequest: null,
  });
  try {
    const snapshot = await readParkedSnapshot(redis, args.goalId, args.taskId);

    if (!args.segmentId) {
      // LIST mode (default): read-only inventory.
      printInventory(args.goalId, args.taskId, snapshot);
      return 0;
    }

    if (!args.docKey) {
      const segment = snapshot.segments[args.segmentId];
      const hint = segment && !segment.truncated
        ? ` For this segment's non-URL fallback: --doc-key ${derivedDocKey(segment.origin)}`
        : '';
      console.error(
        `--doc-key is required to promote (doc keys are never invented silently; `
        + `use web:<url> for web content).${hint}`
      );
      return 1;
    }

    const plan = planSegmentPromotion(snapshot, args.segmentId, args.docKey);
    if (!plan.ok) {
      console.error(`Promotion refused (${plan.reason}): ${plan.message}`);
      return 1;
    }

    // Echo exactly what will be ingested before any write.
    const { request } = plan;
    console.log('Promoting one workspace segment through the verified ingest path:');
    console.log(`  doc key:    ${request.docKey}`);
    console.log(`  bytes:      ${Buffer.byteLength(request.content, 'utf8')}`);
    console.log(`  origin:     ${request.origin.server} / ${request.origin.tool} (argsHash ${request.origin.argsHash})`);
    console.log(`  fetchedAt:  ${request.origin.fetchedAt}`);
    console.log(`  segment:    ${request.origin.segmentId}`);
    console.log(`  extraction: ${policy.mode}${policy.mode === 'changed' ? ` (budget ${policy.maxBlocks})` : ' (no paid work will be queued)'}`);

    const deps: IngestDeps = {
      pgPool,
      queues: { extraction: extractionQueue, invalidation: invalidationQueue },
      log: loggerFor({ component: 'promote_segment' }),
    };
    const outcome = await promoteSegment(deps, request, policy, crypto.randomUUID());

    console.log(`\nPromoted: ${outcome.ingest.docKey} version ${outcome.ingest.version}`);
    console.log(`  root hash:   ${outcome.ingest.rootId}`);
    console.log(`  total nodes: ${outcome.ingest.totalNodes}`);
    if (outcome.ingest.diff) {
      console.log(`  diff:        added ${outcome.ingest.diff.added}, orphaned ${outcome.ingest.diff.orphaned}, retained ${outcome.ingest.diff.retained}`);
    }
    console.log(`  blocks eligible/queued: ${outcome.ingest.blocksEligible}/${outcome.ingest.blocksQueued}`);
    console.log('\nCitable block hashes (verified substrate — the RLM may now cite these):');
    for (const blockId of outcome.blockIds) {
      console.log(`  ${blockId}`);
    }
    return 0;
  } finally {
    await redis.quit().catch(() => {});
  }
}

main()
  .then(async code => {
    await Promise.allSettled([extractionQueue.close(), invalidationQueue.close()]);
    await pgPool.end().catch(() => {});
    process.exit(code);
  })
  .catch(async error => {
    console.error(`\nPromotion failed: ${error instanceof Error ? error.message : error}`);
    console.error('Nothing was promoted.');
    await Promise.allSettled([extractionQueue.close(), invalidationQueue.close()]);
    await pgPool.end().catch(() => {});
    process.exit(1);
  });
