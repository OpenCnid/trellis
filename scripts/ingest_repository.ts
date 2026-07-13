import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { pgPool } from '../src/config/db';
import { config } from '../src/config/index';
import { extractionQueue, invalidationQueue } from '../src/workers/queue';
import { parseSourceFile } from '../src/core/ast/source_parser';
import {
  ingestDocument,
  ingestTombstone,
  type IngestDeps,
} from '../src/core/ingestion/ingest_document';
import { isValidRepoKey } from '../src/core/repository/paths';
import { scanRepository } from '../src/core/repository/scanner';
import { createPgSnapshotStore } from '../src/core/repository/snapshot_store';
import {
  executeRepositorySnapshot,
  planRepositorySnapshot,
  type RepositoryExtractionPolicy,
  type SnapshotDeps,
  type SnapshotOptions,
  type SnapshotPlan,
} from '../src/core/repository/snapshot_ingest';
import { loggerFor } from '../src/core/observability/logger';
import { getMetrics } from '../src/core/observability/metrics';

// Whole-codebase ingestion CLI (Session 8, roadmap 3.3 #6).
//
//   npm run repo:ingest -- --repo-key <key> [--root <dir>] [flags]
//
// One repository snapshot is a bounded sequence of per-source-file
// document ingests through the same verified service as POST /ingest —
// never one giant request or transaction, and never a relaxation of the
// T6 per-request limits. The default is zero paid work: --extract none
// persists, versions, diffs, and queues invalidation only. Real
// extraction requires an explicit positive --max-blocks budget AND
// --confirm-extraction, and prints the exact plan first.
//
// Flags:
//   --repo-key <key>          required; stable identity, doc keys become
//                             repo:<key>:<relative-path>
//   --root <dir>              repository root (default: cwd)
//   --extract none|changed    extraction policy (default: none)
//   --max-blocks <n>          required positive budget for changed
//   --confirm-extraction      required acknowledgement for changed
//   --include-untracked       add untracked, non-ignored files to the set
//   --include <prefix>        repeatable path-prefix scope (Session 34).
//                             Only paths under a prefix are planned and
//                             ingested; a previously effective path
//                             outside every prefix carries forward at
//                             its previous root hash (never tombstoned
//                             by an out-of-scope run). Doc keys stay
//                             root-relative either way.
//   --concurrency <n>         parallel file ingests (default 4)
//   --max-file-bytes <n>      per-file size cap (default 2 MiB)
//   --max-bytes-in-flight <n> total read-buffer bound (default 32 MiB)
//   --dry-run                 print the plan and exit without writes

interface CliArgs {
  repoKey?: string;
  root: string;
  extract: 'none' | 'changed';
  maxBlocks?: number;
  confirmExtraction: boolean;
  includeUntracked: boolean;
  includePrefixes: string[];
  concurrency?: number;
  maxFileBytes?: number;
  maxBytesInFlight?: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    root: process.cwd(),
    extract: 'none',
    confirmExtraction: false,
    includeUntracked: false,
    includePrefixes: [],
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} requires a value`);
      return next;
    };
    switch (flag) {
      case '--repo-key': args.repoKey = value(); break;
      case '--root': args.root = value(); break;
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
      case '--include-untracked': args.includeUntracked = true; break;
      case '--include': args.includePrefixes.push(value()); break;
      case '--concurrency': args.concurrency = Number(value()); break;
      case '--max-file-bytes': args.maxFileBytes = Number(value()); break;
      case '--max-bytes-in-flight': args.maxBytesInFlight = Number(value()); break;
      case '--dry-run': args.dryRun = true; break;
      default: throw new Error(`Unknown flag: ${flag}`);
    }
  }
  return args;
}

function buildPolicy(args: CliArgs): RepositoryExtractionPolicy {
  if (args.extract === 'none') return { mode: 'none' };
  if (!Number.isInteger(args.maxBlocks) || (args.maxBlocks as number) <= 0) {
    throw new Error('--extract changed requires an explicit positive --max-blocks budget');
  }
  if (!args.confirmExtraction) {
    throw new Error(
      '--extract changed enqueues PAID chat and embedding calls; '
      + 're-run with --confirm-extraction after reviewing the printed plan'
    );
  }
  return { mode: 'changed', maxBlocks: args.maxBlocks as number };
}

function printPlan(
  plan: SnapshotPlan,
  policy: RepositoryExtractionPolicy,
  includePrefixes: readonly string[]
): void {
  console.log(`Repository snapshot plan for repo-key "${plan.repoKey}":`);
  console.log(`  scope:            ${includePrefixes.length ? includePrefixes.join(', ') : 'full repository'}`);
  console.log(`  files accepted:   ${plan.files.length} (${plan.filesToIngest} to ingest, ${plan.filesUnchanged} unchanged)`);
  console.log(`  bytes accepted:   ${plan.totalBytes}`);
  console.log(`  tombstones:       ${plan.tombstones.length}`);
  console.log(`  carried forward:  ${plan.carriedForward.length} (out-of-scope, previously effective)`);
  const skipEntries = Object.entries(plan.skipCounts).sort();
  console.log(`  skipped files:    ${plan.skipped.length}${skipEntries.length ? ` (${skipEntries.map(([reason, count]) => `${reason}=${count}`).join(', ')})` : ''}`);
  const languages = plan.files.reduce<Record<string, number>>((acc, file) => {
    acc[file.language] = (acc[file.language] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`  languages:        ${Object.entries(languages).sort().map(([language, count]) => `${language}=${count}`).join(', ') || 'none'}`);
  console.log(`  extraction:       ${policy.mode}`);
  const exclusionEntries = Object.entries(plan.extractionExclusionCounts).sort();
  console.log(`  test/fixture excluded from extraction: `
    + `${exclusionEntries.reduce((sum, [, count]) => sum + count, 0)} file(s), `
    + `${plan.blocksExcludedFromExtraction} block(s)`
    + (exclusionEntries.length ? ` (${exclusionEntries.map(([reason, count]) => `${reason}=${count}`).join(', ')}; still ingested, never queued)` : ''));
  console.log(`  paid-job bound:   ${plan.paidJobUpperBound} block(s)`
    + (policy.mode === 'changed' ? ` against budget ${policy.maxBlocks}` : ' (no paid work will be queued)'));
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.repoKey || !isValidRepoKey(args.repoKey)) {
    console.error('A stable --repo-key is required ([A-Za-z0-9][A-Za-z0-9._-]*, max 128 chars).');
    return 1;
  }
  const policy = buildPolicy(args);
  const root = path.resolve(args.root);
  const log = loggerFor({ component: 'repo_ingest' });

  const ingestDeps: IngestDeps = {
    pgPool,
    queues: { extraction: extractionQueue, invalidation: invalidationQueue },
    log,
  };
  const deps: SnapshotDeps = {
    store: createPgSnapshotStore(pgPool),
    scan: scanRepository,
    readFile: (scanRoot, relativePath) => fs.readFile(path.join(scanRoot, relativePath)),
    parse: (relativePath, bytes) =>
      parseSourceFile(relativePath, bytes, { pythonExecutable: config.python.executable }),
    ingestDocument: request => ingestDocument(ingestDeps, request),
    ingestTombstone: (docKey, requestId) => ingestTombstone(ingestDeps, docKey, requestId),
    log,
    metrics: getMetrics(),
  };
  const options: SnapshotOptions = {
    root,
    repoKey: args.repoKey,
    policy,
    includeUntracked: args.includeUntracked,
    includePrefixes: args.includePrefixes,
    concurrency: args.concurrency,
    maxFileBytes: args.maxFileBytes,
    maxBytesInFlight: args.maxBytesInFlight,
    requestId: crypto.randomUUID(),
  };

  const plan = await planRepositorySnapshot(deps, options);
  printPlan(plan, policy, args.includePrefixes);
  if (args.dryRun) {
    console.log('\nDry run: no writes performed.');
    return 0;
  }

  const result = await executeRepositorySnapshot(deps, options, plan);
  console.log(`\nSnapshot ${result.repoKey}#${result.snapshotSeq} published:`);
  console.log(`  ingested:   ${result.counts.ingested}`);
  console.log(`  unchanged:  ${result.counts.unchanged} (${result.carriedForward} carried forward out-of-scope)`);
  console.log(`  tombstoned: ${result.counts.tombstoned}`);
  console.log(`  blocks eligible/queued: ${result.blocksEligible}/${result.blocksQueued}`);
  console.log(`  blocks excluded (test/fixture): ${result.blocksExcludedFromExtraction}`);
  return 0;
}

main()
  .then(async code => {
    await Promise.allSettled([extractionQueue.close(), invalidationQueue.close()]);
    await pgPool.end().catch(() => {});
    process.exit(code);
  })
  .catch(async error => {
    console.error(`\nRepository ingest failed: ${error instanceof Error ? error.message : error}`);
    console.error('The previous published snapshot remains effective.');
    await Promise.allSettled([extractionQueue.close(), invalidationQueue.close()]);
    await pgPool.end().catch(() => {});
    process.exit(1);
  });
