import type { ParseSourceResult, SourceLanguage } from '../ast/source_parser.js';
import type { ExtractionSourceKind } from '../ast/persist.js';
import { planExtraction, ExtractionBudgetExceededError } from '../ingestion/plan_ingest.js';
import type { IngestRequest, IngestResult } from '../ingestion/ingest_document.js';
import type { Logger } from '../observability/logger.js';
import { isTestOrFixturePath, repoDocKey, validateRepoRelativePath } from './paths.js';
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
  // Session 34: optional path-prefix scope. Absent or empty = the full
  // repository, byte-identical to pre-scope behavior. When present, only
  // paths under one of the prefixes are planned and ingested; everything
  // else is untouched — a previously effective out-of-scope path is
  // CARRIED FORWARD into the new snapshot at its previous root hash
  // (never tombstoned by a run whose scope does not cover it), and an
  // out-of-scope path with no prior version is skipped as out_of_scope.
  // Doc keys stay root-relative, so a scoped run and a full run agree on
  // identity for every path.
  includePrefixes?: readonly string[];
  // Session 38: which chunking policy deps.parse runs under, stamped in
  // the published snapshot summary so old-policy and new-policy
  // documents are distinguishable forever. Absent = 1 (the Session 8
  // policy). The parse function itself is injected — this field is the
  // RECORD, wired by the CLI to the same value it gave the parser.
  chunkingPolicy?: 1 | 2;
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

// Session 25: why an accepted, ingested file's blocks never reach
// extraction_queue. Distinct from ScanSkipReason by design — an excluded
// file is still scanned, parsed, ingested, versioned, and tombstoned
// like any other (snapshot completeness is load-bearing); only its paid
// extraction is withheld.
export type ExtractionExclusionReason = 'test_fixture_excluded';

/** The enqueuer's language → prompt-kind mapping (Session 25). */
export function sourceKindForLanguage(language: SourceLanguage): ExtractionSourceKind {
  return language === 'typescript' || language === 'javascript' || language === 'python'
    ? 'code'
    : 'prose';
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
  extractionExclusion: ExtractionExclusionReason | null;
}

export interface PlannedTombstone {
  path: string;
  docKey: string;
}

// Session 34: a previously effective path outside the run's scope. It
// re-publishes in the new snapshot at its previous root hash so document
// liveness and the deletion baseline survive a scoped run untouched.
export interface PlannedCarry {
  path: string;
  docKey: string;
  rootHash: string;
}

/**
 * Validates and normalizes scope prefixes (Session 34). Each prefix must
 * be a valid repo-relative path after trailing-slash trimming; an
 * invalid prefix throws before any planning I/O. Returns null when the
 * caller passed no scope — the full-repository fast path.
 */
export function normalizeScopePrefixes(
  includePrefixes: readonly string[] | undefined
): string[] | null {
  if (!includePrefixes || includePrefixes.length === 0) return null;
  const normalized = includePrefixes.map(raw => {
    const trimmed = raw.replace(/\/+$/, '');
    const validation = validateRepoRelativePath(trimmed);
    if (!validation.ok) {
      throw new Error(`invalid scope prefix: ${JSON.stringify(raw)}`);
    }
    return trimmed;
  });
  return [...new Set(normalized)].sort();
}

/** Segment-boundary prefix match: 'src' covers 'src/a.ts', never 'src2/a.ts'. */
export function isPathInScope(relativePath: string, prefixes: readonly string[] | null): boolean {
  if (!prefixes) return true;
  return prefixes.some(
    prefix => relativePath === prefix || relativePath.startsWith(`${prefix}/`)
  );
}

export interface SnapshotPlan {
  repoKey: string;
  files: PlannedFile[];
  tombstones: PlannedTombstone[];
  // Session 34: out-of-scope previously effective paths, re-published
  // verbatim (empty for a full-scope run).
  carriedForward: PlannedCarry[];
  skipped: SkippedFile[];
  skipCounts: Record<string, number>;
  totalBytes: number;
  filesToIngest: number;
  filesUnchanged: number;
  // Session 25: accepted files (all actions) withheld from extraction,
  // counted per reason, and the blocks the paid bound dropped for them
  // (to-ingest files only — the same population the bound counts).
  extractionExclusionCounts: Record<string, number>;
  blocksExcludedFromExtraction: number;
  // Paid-job upper bound for this run: 0 under 'none'; excluded files
  // contribute nothing.
  paidJobUpperBound: number;
}

export interface SnapshotResult {
  repoKey: string;
  snapshotSeq: number;
  // counts.unchanged includes carried-forward rows (both publish with
  // outcome 'unchanged'); carriedForward reports that subset.
  counts: { ingested: number; unchanged: number; tombstoned: number };
  carriedForward: number;
  skipCounts: Record<string, number>;
  extractionExclusionCounts: Record<string, number>;
  blocksExcludedFromExtraction: number;
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
  const scopePrefixes = normalizeScopePrefixes(options.includePrefixes);
  const scan = await deps.scan(options.root, {
    includeUntracked: options.includeUntracked,
    maxFileBytes: options.maxFileBytes,
  });
  const previous = await deps.store.fetchEffectivePaths(options.repoKey);

  const skipped: SkippedFile[] = [...scan.skipped];
  const files: PlannedFile[] = [];
  const gate = new ByteGate(options.maxBytesInFlight ?? DEFAULT_MAX_BYTES_IN_FLIGHT);

  // Session 34: an out-of-scope accepted file is never read or parsed.
  // With a prior effective version it carries forward below; without one
  // it is a typed skip so the funnel still accounts for every path.
  const inScopeAccepted = scan.accepted.filter(entry => {
    if (isPathInScope(entry.path, scopePrefixes)) return true;
    if (!previous.has(entry.path)) skipped.push({ path: entry.path, reason: 'out_of_scope' });
    return false;
  });

  await mapBounded(
    inScopeAccepted,
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
          extractionExclusion: isTestOrFixturePath(entry.path) ? 'test_fixture_excluded' : null,
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
  // Session 34: deletion decisions belong to runs whose scope covers the
  // path — an out-of-scope previous path carries forward verbatim
  // (whether or not it is still on disk) and never tombstones here.
  const previousInScope: string[] = [];
  const carriedForward: PlannedCarry[] = [];
  for (const [previousPath, effective] of previous) {
    if (isPathInScope(previousPath, scopePrefixes)) {
      previousInScope.push(previousPath);
    } else {
      carriedForward.push({
        path: previousPath,
        docKey: effective.docKey,
        rootHash: effective.rootHash,
      });
    }
  }
  carriedForward.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const currentAccepted = new Set(files.map(file => file.path));
  const manifest = diffManifests(previousInScope, currentAccepted);
  const tombstones = manifest.removed.map(path => ({
    path,
    docKey: previous.get(path)!.docKey,
  }));

  const toIngest = files.filter(file => file.action === 'ingest');
  const extractionExclusionCounts: Record<string, number> = {};
  for (const file of files) {
    if (!file.extractionExclusion) continue;
    extractionExclusionCounts[file.extractionExclusion] =
      (extractionExclusionCounts[file.extractionExclusion] ?? 0) + 1;
  }
  return {
    repoKey: options.repoKey,
    files,
    tombstones,
    carriedForward,
    skipped,
    skipCounts: countSkipReasons(skipped),
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    filesToIngest: toIngest.length,
    filesUnchanged: files.length - toIngest.length,
    extractionExclusionCounts,
    blocksExcludedFromExtraction: toIngest
      .filter(file => file.extractionExclusion)
      .reduce((sum, file) => sum + file.blockCount, 0),
    paidJobUpperBound: options.policy.mode === 'none'
      ? 0
      : toIngest
        .filter(file => !file.extractionExclusion)
        .reduce((sum, file) => sum + file.blockCount, 0),
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
    carriedForward: plan.carriedForward.length,
    skipCounts: plan.skipCounts,
    extractionExclusionCounts: plan.extractionExclusionCounts,
    blocksExcludedFromExtraction: plan.blocksExcludedFromExtraction,
    policy: options.policy.mode,
    chunkingPolicy: options.chunkingPolicy ?? 1,
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
        // Session 25: a test/fixture file ingests like any other — same
        // verified transaction, same versioning and tombstones — but its
        // extraction policy is forced to 'none' even under 'changed'.
        const result = await deps.ingestDocument({
          rootNode: parsed.root,
          docKey: file.docKey,
          extractionPolicy: options.policy.mode === 'changed' && !file.extractionExclusion
            ? { mode: 'changed', maxBlocks: remainingBudget }
            : { mode: 'none' },
          requestId: options.requestId,
          sourceKind: sourceKindForLanguage(file.language),
          language: file.language,
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

    // Session 34: out-of-scope previously effective paths re-publish at
    // their previous root hash. No read, no parse, no ingest, no queue —
    // the scoped run leaves them exactly as the last covering run did.
    for (const carry of plan.carriedForward) {
      rows.push({
        path: carry.path,
        docKey: carry.docKey,
        rootHash: carry.rootHash,
        outcome: 'unchanged',
      });
      deps.metrics?.repoFilesTotal.inc({ outcome: 'unchanged', language: 'none' });
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
      carriedForward: plan.carriedForward.length,
      skipCounts: plan.skipCounts,
      extractionExclusionCounts: plan.extractionExclusionCounts,
      blocksExcludedFromExtraction: plan.blocksExcludedFromExtraction,
      policy: options.policy.mode,
      chunkingPolicy: options.chunkingPolicy ?? 1,
      blocksEligible,
      blocksQueued,
    });
    deps.metrics?.repoSnapshotsTotal.inc({ result: 'published' });
    deps.metrics?.repoBlocksTotal.inc({ stage: 'eligible' }, blocksEligible);
    deps.metrics?.repoBlocksTotal.inc({ stage: 'queued' }, blocksQueued);
    deps.metrics?.repoBlocksTotal.inc(
      { stage: 'test_fixture_excluded' },
      plan.blocksExcludedFromExtraction
    );
    log.info({
      event: 'repo.snapshot_published',
      repoKey: options.repoKey,
      snapshotSeq,
      ...counts,
      blocksEligible,
      blocksQueued,
      blocksExcludedFromExtraction: plan.blocksExcludedFromExtraction,
    });
    return {
      repoKey: options.repoKey,
      snapshotSeq,
      counts,
      carriedForward: plan.carriedForward.length,
      skipCounts: plan.skipCounts,
      extractionExclusionCounts: plan.extractionExclusionCounts,
      blocksExcludedFromExtraction: plan.blocksExcludedFromExtraction,
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
