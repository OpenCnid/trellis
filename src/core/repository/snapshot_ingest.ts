import type { ParseSourceResult, SourceLanguage } from '../ast/source_parser.js';
import { planExtraction, ExtractionBudgetExceededError } from '../ingestion/plan_ingest.js';
import type { IngestRequest, IngestResult } from '../ingestion/ingest_document.js';
import type { Logger } from '../observability/logger.js';
import { repoDocKey } from './paths.js';
import { diffManifests } from './manifest.js';
import {
  countSkipReasons,
  type RepositoryScan,
  type ScanOptions,
  type SkippedFile,
} from './scanner.js';
import type { SnapshotPathRow, SnapshotStore } from './snapshot_store.js';

// Session 8: one repository snapshot as a bounded sequence of per-source
// document ingests. This module is pure orchestration over injected
// dependencies — scanning, parsing, the verified ingest service, and the
// snapshot store all arrive as functions, so the atomicity and deletion
// protocol are unit-testable without git, a filesystem, or PostgreSQL.
//
// Protocol:
//   1. Plan: enumerate, classify, parse, and diff against the previous
//      PUBLISHED snapshot. No writes. The plan carries the exact
//      files/bytes/blocks a caller must see before approving cost.
//   2. Execute: create an unpublished snapshot row, ingest every added/
//      changed file through the verified service (bounded concurrency
//      and bytes in flight, one transaction per file — never one giant
//      transaction), then tombstone removed paths, then publish. Any
//      failure leaves the previous snapshot effective and throws.

export type RepositoryExtractionPolicy =
  | { mode: 'none' }
  // The block budget is required at the repository level: a first scan
  // of a large repo must never silently enqueue unbounded paid work.
  | { mode: 'changed'; maxBlocks: number };

export interface SnapshotOptions {
  root: string;
  repoKey: string;
  policy: RepositoryExtractionPolicy;
  includeUntracked?: boolean;
  concurrency?: number;
  maxBytesInFlight?: number;
  maxFileBytes?: number;
  requestId?: string;
}

export const DEFAULT_FILE_CONCURRENCY = 4;
export const DEFAULT_MAX_BYTES_IN_FLIGHT = 32 * 1024 * 1024;

export interface RepoMetricsSlice {
  repoFilesTotal: { inc(labels: { outcome: string; language: string }): void };
  repoSkippedFilesTotal: { inc(labels: { reason: string }): void };
  repoSnapshotsTotal: { inc(labels: { result: string }): void };
  repoBlocksTotal: { inc(labels: { stage: string }, value: number): void };
}

export interface SnapshotDeps {
  store: SnapshotStore;
  scan(root: string, options: ScanOptions): Promise<RepositoryScan>;
  readFile(root: string, relativePath: string): Promise<Buffer>;
  parse(relativePath: string, bytes: Buffer): Promise<ParseSourceResult>;
  ingestDocument(request: IngestRequest): Promise<IngestResult>;
  ingestTombstone(docKey: string, requestId?: string): Promise<IngestResult>;
  log: Logger;
  metrics?: RepoMetricsSlice;
}

export interface PlannedFile {
  path: string;
  docKey: string;
  size: number;
  language: SourceLanguage;
  rootId: string;
  // Non-empty extraction blocks in the parsed AST — the per-file upper
  // bound on paid jobs under 'changed' (the Merkle diff only shrinks it).
  blockCount: number;
  action: 'ingest' | 'unchanged';
}

export interface PlannedTombstone {
  path: string;
  docKey: string;
}

export interface SnapshotPlan {
  repoKey: string;
  files: PlannedFile[];
  tombstones: PlannedTombstone[];
  skipped: SkippedFile[];
  skipCounts: Record<string, number>;
  totalBytes: number;
  filesToIngest: number;
  filesUnchanged: number;
  // Paid-job upper bound for this run: 0 under 'none'.
  paidJobUpperBound: number;
}

export interface SnapshotResult {
  repoKey: string;
  snapshotSeq: number;
  counts: { ingested: number; unchanged: number; tombstoned: number };
  skipCounts: Record<string, number>;
  blocksEligible: number;
  blocksQueued: number;
  versionsRegistered: number;
}

/**
 * FIFO gate bounding total bytes in flight. A file larger than the
 * capacity is clamped to it, so it runs — alone — instead of deadlocking.
 */
export class ByteGate {
  private inFlight = 0;
  private readonly waiters: Array<{ weight: number; resolve: () => void }> = [];

  constructor(private readonly capacity: number) {}

  async acquire(bytes: number): Promise<() => void> {
    const weight = Math.min(Math.max(bytes, 1), this.capacity);
    if (this.inFlight === 0 || this.inFlight + weight <= this.capacity) {
      this.inFlight += weight;
    } else {
      // The releaser accounts the waiter's weight before resolving it.
      await new Promise<void>(resolve => this.waiters.push({ weight, resolve }));
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inFlight -= weight;
      while (this.waiters.length > 0) {
        const head = this.waiters[0];
        if (this.inFlight > 0 && this.inFlight + head.weight > this.capacity) break;
        this.waiters.shift();
        this.inFlight += head.weight;
        head.resolve();
      }
    };
  }
}

/** Bounded-concurrency map that fails fast on the first rejection. */
export async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let failure: unknown;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (failure === undefined) {
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        results[index] = await fn(items[index], index);
      } catch (error) {
        failure ??= error;
        return;
      }
    }
  });
  await Promise.all(workers);
  if (failure !== undefined) throw failure;
  return results;
}

export async function planRepositorySnapshot(
  deps: SnapshotDeps,
  options: SnapshotOptions
): Promise<SnapshotPlan> {
  const scan = await deps.scan(options.root, {
    includeUntracked: options.includeUntracked,
    maxFileBytes: options.maxFileBytes,
  });
  const previous = await deps.store.fetchEffectivePaths(options.repoKey);

  const skipped: SkippedFile[] = [...scan.skipped];
  const files: PlannedFile[] = [];
  const gate = new ByteGate(options.maxBytesInFlight ?? DEFAULT_MAX_BYTES_IN_FLIGHT);

  await mapBounded(
    scan.accepted,
    options.concurrency ?? DEFAULT_FILE_CONCURRENCY,
    async entry => {
      const release = await gate.acquire(entry.size);
      try {
        const bytes = await deps.readFile(options.root, entry.path);
        const parsed = await deps.parse(entry.path, bytes);
        if (!parsed.ok) {
          skipped.push({ path: entry.path, reason: parsed.reason });
          return;
        }
        const blockCount = planExtraction(parsed.root, null, { mode: 'none' }).blocksEligible;
        const prior = previous.get(entry.path);
        files.push({
          path: entry.path,
          docKey: repoDocKey(options.repoKey, entry.path),
          size: bytes.length,
          language: parsed.language,
          rootId: parsed.root.id,
          blockCount,
          action: prior && prior.rootHash === parsed.root.id ? 'unchanged' : 'ingest',
        });
      } finally {
        release();
      }
    }
  );

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  skipped.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  // A previously effective path that is now absent OR no longer accepted
  // (newly oversize, reclassified, unparseable) must tombstone: its
  // bytes are no longer eligible source, so its facts quarantine.
  const currentAccepted = new Set(files.map(file => file.path));
  const manifest = diffManifests(previous.keys(), currentAccepted);
  const tombstones = manifest.removed.map(path => ({
    path,
    docKey: previous.get(path)!.docKey,
  }));

  const toIngest = files.filter(file => file.action === 'ingest');
  return {
    repoKey: options.repoKey,
    files,
    tombstones,
    skipped,
    skipCounts: countSkipReasons(skipped),
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    filesToIngest: toIngest.length,
    filesUnchanged: files.length - toIngest.length,
    paidJobUpperBound: options.policy.mode === 'none'
      ? 0
      : toIngest.reduce((sum, file) => sum + file.blockCount, 0),
  };
}

export async function executeRepositorySnapshot(
  deps: SnapshotDeps,
  options: SnapshotOptions,
  plan: SnapshotPlan
): Promise<SnapshotResult> {
  const log = deps.log;
  // Reject over-budget plans before the snapshot row or any version
  // exists — the plan's upper bound can only shrink at ingest time.
  if (options.policy.mode === 'changed' && plan.paidJobUpperBound > options.policy.maxBlocks) {
    throw new ExtractionBudgetExceededError(plan.paidJobUpperBound, options.policy.maxBlocks);
  }

  const snapshotSeq = await deps.store.createSnapshot(options.repoKey);
  log.info({
    event: 'repo.snapshot_started',
    repoKey: options.repoKey,
    snapshotSeq,
    files: plan.files.length,
    filesToIngest: plan.filesToIngest,
    filesUnchanged: plan.filesUnchanged,
    tombstones: plan.tombstones.length,
    skipCounts: plan.skipCounts,
    policy: options.policy.mode,
  });
  for (const [reason, count] of Object.entries(plan.skipCounts)) {
    for (let i = 0; i < count; i++) deps.metrics?.repoSkippedFilesTotal.inc({ reason });
  }

  const rows: SnapshotPathRow[] = [];
  let blocksEligible = 0;
  let blocksQueued = 0;
  let versionsRegistered = 0;
  // Remaining budget under 'changed'. Files are ingested serially in
  // that mode so the running budget is exact; 'none' queues nothing and
  // parallelizes freely.
  let remainingBudget = options.policy.mode === 'changed' ? options.policy.maxBlocks : Infinity;
  const concurrency = options.policy.mode === 'changed'
    ? 1
    : options.concurrency ?? DEFAULT_FILE_CONCURRENCY;
  const gate = new ByteGate(options.maxBytesInFlight ?? DEFAULT_MAX_BYTES_IN_FLIGHT);

  try {
    const toIngest = plan.files.filter(file => file.action === 'ingest');
    await mapBounded(toIngest, concurrency, async file => {
      const release = await gate.acquire(file.size);
      try {
        // Re-read and re-parse: the plan is advisory and the parser is
        // deterministic, so this only diverges if the file changed on
        // disk between plan and execute — the ingest still records
        // exactly what it read.
        const bytes = await deps.readFile(options.root, file.path);
        const parsed = await deps.parse(file.path, bytes);
        if (!parsed.ok) {
          throw new Error(
            `${file.path} became unparseable between plan and execute (${parsed.reason})`
          );
        }
        const result = await deps.ingestDocument({
          rootNode: parsed.root,
          docKey: file.docKey,
          extractionPolicy: options.policy.mode === 'changed'
            ? { mode: 'changed', maxBlocks: remainingBudget }
            : { mode: 'none' },
          requestId: options.requestId,
        });
        blocksEligible += result.blocksEligible;
        blocksQueued += result.blocksQueued;
        remainingBudget -= result.blocksQueued;
        versionsRegistered += 1;
        rows.push({
          path: file.path,
          docKey: file.docKey,
          rootHash: result.rootId,
          outcome: 'ingested',
        });
        deps.metrics?.repoFilesTotal.inc({ outcome: 'ingested', language: file.language });
        log.info({
          event: 'repo.file_ingested',
          repoKey: options.repoKey,
          snapshotSeq,
          docKey: file.docKey,
          version: result.version,
          blocksQueued: result.blocksQueued,
        });
      } finally {
        release();
      }
    });

    for (const file of plan.files) {
      if (file.action !== 'unchanged') continue;
      rows.push({
        path: file.path,
        docKey: file.docKey,
        rootHash: file.rootId,
        outcome: 'unchanged',
      });
      deps.metrics?.repoFilesTotal.inc({ outcome: 'unchanged', language: file.language });
    }

    // Tombstones run only after every file ingest succeeded: a partial
    // failure must never mark unprocessed paths deleted.
    for (const tombstone of plan.tombstones) {
      const result = await deps.ingestTombstone(tombstone.docKey, options.requestId);
      versionsRegistered += 1;
      rows.push({
        path: tombstone.path,
        docKey: tombstone.docKey,
        rootHash: result.rootId,
        outcome: 'tombstoned',
      });
      deps.metrics?.repoFilesTotal.inc({ outcome: 'tombstoned', language: 'none' });
      log.info({
        event: 'repo.file_tombstoned',
        repoKey: options.repoKey,
        snapshotSeq,
        docKey: tombstone.docKey,
        version: result.version,
      });
    }

    const counts = {
      ingested: rows.filter(row => row.outcome === 'ingested').length,
      unchanged: rows.filter(row => row.outcome === 'unchanged').length,
      tombstoned: rows.filter(row => row.outcome === 'tombstoned').length,
    };
    await deps.store.publishSnapshot(options.repoKey, snapshotSeq, rows, {
      counts,
      skipCounts: plan.skipCounts,
      policy: options.policy.mode,
      blocksEligible,
      blocksQueued,
    });
    deps.metrics?.repoSnapshotsTotal.inc({ result: 'published' });
    deps.metrics?.repoBlocksTotal.inc({ stage: 'eligible' }, blocksEligible);
    deps.metrics?.repoBlocksTotal.inc({ stage: 'queued' }, blocksQueued);
    log.info({
      event: 'repo.snapshot_published',
      repoKey: options.repoKey,
      snapshotSeq,
      ...counts,
      blocksEligible,
      blocksQueued,
    });
    return {
      repoKey: options.repoKey,
      snapshotSeq,
      counts,
      skipCounts: plan.skipCounts,
      blocksEligible,
      blocksQueued,
      versionsRegistered,
    };
  } catch (error) {
    deps.metrics?.repoSnapshotsTotal.inc({ result: 'failed' });
    log.error({
      event: 'repo.snapshot_failed',
      repoKey: options.repoKey,
      snapshotSeq,
      err: error instanceof Error ? error : new Error(String(error)),
    });
    throw error;
  }
}
