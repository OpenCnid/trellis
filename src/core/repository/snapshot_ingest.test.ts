import { describe, expect, it, vi } from 'vitest';
import { parseSourceFile } from '../ast/source_parser';
import { emptyDocumentRoot, type IngestRequest, type IngestResult } from '../ingestion/ingest_document';
import { ExtractionBudgetExceededError, planExtraction } from '../ingestion/plan_ingest';
import {
  ByteGate,
  executeRepositorySnapshot,
  isPathInScope,
  mapBounded,
  normalizeScopePrefixes,
  planRepositorySnapshot,
  type SnapshotDeps,
  type SnapshotOptions,
} from './snapshot_ingest';
import type { EffectivePath, SnapshotPathRow } from './snapshot_store';
import type { RepositoryScan } from './scanner';

// In-memory harness: real parsing (TS/markdown/text only, so no Python
// interpreter is involved), fake store/filesystem/ingest service.
function harness(files: Record<string, string>, options?: {
  effective?: Map<string, EffectivePath>;
  skipped?: RepositoryScan['skipped'];
  failIngestFor?: string;
}) {
  const published: Array<{ seq: number; rows: SnapshotPathRow[]; summary: Record<string, unknown> }> = [];
  const versions = new Map<string, number>();
  const ingested: IngestRequest[] = [];
  const tombstoned: string[] = [];
  let snapshotSeq = 0;

  const deps: SnapshotDeps = {
    store: {
      createSnapshot: async () => ++snapshotSeq,
      fetchEffectivePaths: async () => options?.effective ?? new Map(),
      publishSnapshot: async (_repoKey, seq, rows, summary) => {
        published.push({ seq, rows: [...rows], summary });
      },
    },
    scan: async () => ({
      accepted: Object.keys(files).sort().map(path => ({ path, size: files[path].length })),
      skipped: options?.skipped ?? [],
    }),
    readFile: async (_root, path) => {
      if (!(path in files)) throw new Error(`unreadable: ${path}`);
      return Buffer.from(files[path]);
    },
    parse: (path, bytes) => parseSourceFile(path, bytes, { pythonExecutable: 'unused' }),
    ingestDocument: async request => {
      if (options?.failIngestFor && request.docKey.endsWith(options.failIngestFor)) {
        throw new Error(`forced failure for ${request.docKey}`);
      }
      ingested.push(request);
      const version = (versions.get(request.docKey) ?? 0) + 1;
      versions.set(request.docKey, version);
      const eligible = planExtraction(request.rootNode, null, { mode: 'none' }).blocksEligible;
      const queued = request.extractionPolicy.mode === 'changed' ? eligible : 0;
      return {
        rootId: request.rootNode.id,
        docKey: request.docKey,
        version,
        totalNodes: 1,
        blocksEligible: eligible,
        blocksQueued: queued,
        extractionPolicy: request.extractionPolicy.mode,
        diff: null,
      } satisfies IngestResult;
    },
    ingestTombstone: async docKey => {
      tombstoned.push(docKey);
      const version = (versions.get(docKey) ?? 0) + 1;
      versions.set(docKey, version);
      return {
        rootId: emptyDocumentRoot().id,
        docKey,
        version,
        totalNodes: 1,
        blocksEligible: 0,
        blocksQueued: 0,
        extractionPolicy: 'none',
        diff: null,
      } satisfies IngestResult;
    },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as SnapshotDeps['log'],
  };
  return { deps, published, ingested, tombstoned };
}

const OPTS: SnapshotOptions = {
  root: '/repo',
  repoKey: 'fixture',
  policy: { mode: 'none' },
};

const TS_FILE = 'export function alpha() {\n  return 1;\n}\n';
const MD_FILE = '# Doc\n\nA fact paragraph.\n';

describe('planRepositorySnapshot', () => {
  it('plans deterministic sorted files with block counts and zero paid jobs under none', async () => {
    const { deps } = harness({ 'src/b.ts': TS_FILE, 'README.md': MD_FILE });
    const plan = await planRepositorySnapshot(deps, OPTS);
    expect(plan.files.map(file => file.path)).toEqual(['README.md', 'src/b.ts']);
    expect(plan.files.map(file => file.docKey)).toEqual([
      'repo:fixture:README.md',
      'repo:fixture:src/b.ts',
    ]);
    expect(plan.files.every(file => file.action === 'ingest')).toBe(true);
    expect(plan.paidJobUpperBound).toBe(0);
    expect(plan.filesToIngest).toBe(2);
    expect(plan.tombstones).toEqual([]);
  });

  it('reports the paid-job upper bound under changed', async () => {
    const { deps } = harness({ 'src/b.ts': TS_FILE, 'README.md': MD_FILE });
    const plan = await planRepositorySnapshot(deps, {
      ...OPTS,
      policy: { mode: 'changed', maxBlocks: 100 },
    });
    // README: heading + paragraph = 2 blocks; b.ts: one function block.
    expect(plan.paidJobUpperBound).toBe(3);
  });

  it('marks files unchanged when the prior published root hash matches', async () => {
    const { deps } = harness({ 'src/b.ts': TS_FILE });
    const first = await planRepositorySnapshot(deps, OPTS);
    const rootId = first.files[0].rootId;

    const { deps: rerun } = harness({ 'src/b.ts': TS_FILE }, {
      effective: new Map([['src/b.ts', { docKey: 'repo:fixture:src/b.ts', rootHash: rootId }]]),
    });
    const plan = await planRepositorySnapshot(rerun, OPTS);
    expect(plan.files[0].action).toBe('unchanged');
    expect(plan.filesToIngest).toBe(0);
    expect(plan.filesUnchanged).toBe(1);
  });

  it('tombstones removed paths and paths that stopped being acceptable', async () => {
    const { deps } = harness({ 'kept.md': MD_FILE }, {
      effective: new Map([
        ['kept.md', { docKey: 'repo:fixture:kept.md', rootHash: 'old' }],
        ['deleted.md', { docKey: 'repo:fixture:deleted.md', rootHash: 'x' }],
        ['now_oversize.ts', { docKey: 'repo:fixture:now_oversize.ts', rootHash: 'y' }],
      ]),
      skipped: [{ path: 'now_oversize.ts', reason: 'oversize' }],
    });
    const plan = await planRepositorySnapshot(deps, OPTS);
    expect(plan.tombstones).toEqual([
      { path: 'deleted.md', docKey: 'repo:fixture:deleted.md' },
      { path: 'now_oversize.ts', docKey: 'repo:fixture:now_oversize.ts' },
    ]);
    expect(plan.skipCounts).toEqual({ oversize: 1 });
  });

  it('folds parse-level skips into the skip counts', async () => {
    const { deps } = harness({ 'bad.ts': 'function {{{', 'good.md': MD_FILE });
    const plan = await planRepositorySnapshot(deps, OPTS);
    expect(plan.files.map(file => file.path)).toEqual(['good.md']);
    expect(plan.skipCounts).toEqual({ parse_error: 1 });
  });

  it('excludes test/fixture files from the paid bound while keeping them planned', async () => {
    const { deps } = harness({
      'src/b.ts': TS_FILE,
      'src/b.test.ts': TS_FILE.replace('alpha', 'alphaTest'),
      '__fixtures__/sample.md': MD_FILE,
    });
    const plan = await planRepositorySnapshot(deps, {
      ...OPTS,
      policy: { mode: 'changed', maxBlocks: 100 },
    });
    // All three files stay in the plan (snapshot completeness), the two
    // classified ones marked, and only the source file counts as paid.
    expect(plan.files.map(file => [file.path, file.extractionExclusion])).toEqual([
      ['__fixtures__/sample.md', 'test_fixture_excluded'],
      ['src/b.test.ts', 'test_fixture_excluded'],
      ['src/b.ts', null],
    ]);
    expect(plan.filesToIngest).toBe(3);
    expect(plan.extractionExclusionCounts).toEqual({ test_fixture_excluded: 2 });
    // b.ts has one function block; the test file (1) + fixture md (2)
    // are excluded from the bound but counted as excluded blocks.
    expect(plan.paidJobUpperBound).toBe(1);
    expect(plan.blocksExcludedFromExtraction).toBe(3);
  });
});

describe('scoped snapshots (Session 34)', () => {
  it('normalizes prefixes and rejects invalid ones before any I/O', () => {
    expect(normalizeScopePrefixes(undefined)).toBeNull();
    expect(normalizeScopePrefixes([])).toBeNull();
    expect(normalizeScopePrefixes(['src/', 'scripts', 'src'])).toEqual(['scripts', 'src']);
    expect(() => normalizeScopePrefixes(['../escape'])).toThrow(/invalid scope prefix/);
    expect(() => normalizeScopePrefixes(['/abs'])).toThrow(/invalid scope prefix/);
    expect(() => normalizeScopePrefixes(['a\\b'])).toThrow(/invalid scope prefix/);
    expect(() => normalizeScopePrefixes([''])).toThrow(/invalid scope prefix/);
  });

  it('matches prefixes at segment boundaries only', () => {
    expect(isPathInScope('src/a.ts', ['src'])).toBe(true);
    expect(isPathInScope('src', ['src'])).toBe(true);
    expect(isPathInScope('src2/a.ts', ['src'])).toBe(false);
    expect(isPathInScope('docs/a.md', ['src'])).toBe(false);
    expect(isPathInScope('anything', null)).toBe(true);
  });

  it('an unset or empty scope plans identically to the pre-scope behavior', async () => {
    const files = { 'src/b.ts': TS_FILE, 'README.md': MD_FILE };
    const base = await planRepositorySnapshot(harness(files).deps, OPTS);
    const unset = await planRepositorySnapshot(harness(files).deps, {
      ...OPTS,
      includePrefixes: [],
    });
    expect(unset).toEqual(base);
    expect(base.carriedForward).toEqual([]);
  });

  it('skips out-of-scope new files as out_of_scope and bounds paid work to the scope', async () => {
    const { deps } = harness({ 'src/b.ts': TS_FILE, 'docs/guide.md': MD_FILE });
    const plan = await planRepositorySnapshot(deps, {
      ...OPTS,
      policy: { mode: 'changed', maxBlocks: 100 },
      includePrefixes: ['src'],
    });
    expect(plan.files.map(file => file.path)).toEqual(['src/b.ts']);
    expect(plan.skipCounts).toEqual({ out_of_scope: 1 });
    expect(plan.paidJobUpperBound).toBe(1);
    expect(plan.carriedForward).toEqual([]);
    expect(plan.tombstones).toEqual([]);
  });

  it('carries forward out-of-scope previously effective paths instead of tombstoning', async () => {
    // docs/guide.md changed on disk and docs/gone.md was deleted — both
    // out of scope, so both carry forward at their previous root hash.
    const { deps } = harness({ 'src/b.ts': TS_FILE, 'docs/guide.md': MD_FILE }, {
      effective: new Map([
        ['docs/guide.md', { docKey: 'repo:fixture:docs/guide.md', rootHash: 'prior-hash' }],
        ['docs/gone.md', { docKey: 'repo:fixture:docs/gone.md', rootHash: 'gone-hash' }],
      ]),
    });
    const plan = await planRepositorySnapshot(deps, { ...OPTS, includePrefixes: ['src'] });
    expect(plan.carriedForward).toEqual([
      { path: 'docs/gone.md', docKey: 'repo:fixture:docs/gone.md', rootHash: 'gone-hash' },
      { path: 'docs/guide.md', docKey: 'repo:fixture:docs/guide.md', rootHash: 'prior-hash' },
    ]);
    expect(plan.tombstones).toEqual([]);
    // Previously effective out-of-scope paths are carried, not skipped.
    expect(plan.skipCounts).toEqual({});
  });

  it('still tombstones in-scope deletions under a scoped run', async () => {
    const { deps } = harness({ 'src/b.ts': TS_FILE }, {
      effective: new Map([
        ['src/dead.ts', { docKey: 'repo:fixture:src/dead.ts', rootHash: 'x' }],
        ['docs/guide.md', { docKey: 'repo:fixture:docs/guide.md', rootHash: 'y' }],
      ]),
    });
    const plan = await planRepositorySnapshot(deps, { ...OPTS, includePrefixes: ['src'] });
    expect(plan.tombstones).toEqual([
      { path: 'src/dead.ts', docKey: 'repo:fixture:src/dead.ts' },
    ]);
    expect(plan.carriedForward.map(carry => carry.path)).toEqual(['docs/guide.md']);
  });

  it('publishes carried rows verbatim with outcome unchanged and never ingests them', async () => {
    const h = harness({ 'src/b.ts': TS_FILE, 'docs/guide.md': MD_FILE }, {
      effective: new Map([
        ['docs/guide.md', { docKey: 'repo:fixture:docs/guide.md', rootHash: 'prior-hash' }],
      ]),
    });
    const options: SnapshotOptions = { ...OPTS, includePrefixes: ['src'] };
    const plan = await planRepositorySnapshot(h.deps, options);
    const result = await executeRepositorySnapshot(h.deps, options, plan);

    expect(h.ingested.map(request => request.docKey)).toEqual(['repo:fixture:src/b.ts']);
    expect(h.tombstoned).toEqual([]);
    expect(result.counts).toEqual({ ingested: 1, unchanged: 1, tombstoned: 0 });
    expect(result.carriedForward).toBe(1);
    const carriedRow = h.published[0].rows.find(row => row.path === 'docs/guide.md');
    expect(carriedRow).toEqual({
      path: 'docs/guide.md',
      docKey: 'repo:fixture:docs/guide.md',
      rootHash: 'prior-hash',
      outcome: 'unchanged',
    });
    expect(h.published[0].summary).toMatchObject({ carriedForward: 1 });
  });
});

describe('executeRepositorySnapshot', () => {
  it('ingests every planned file, then publishes rows and summary', async () => {
    const h = harness({ 'src/b.ts': TS_FILE, 'README.md': MD_FILE });
    const plan = await planRepositorySnapshot(h.deps, OPTS);
    const result = await executeRepositorySnapshot(h.deps, OPTS, plan);

    expect(result.counts).toEqual({ ingested: 2, unchanged: 0, tombstoned: 0 });
    expect(result.blocksQueued).toBe(0);
    expect(h.ingested.every(request => request.extractionPolicy.mode === 'none')).toBe(true);
    expect(h.published).toHaveLength(1);
    expect(h.published[0].rows.map(row => [row.path, row.outcome])).toEqual([
      ['README.md', 'ingested'],
      ['src/b.ts', 'ingested'],
    ]);
    expect(h.published[0].summary).toMatchObject({ policy: 'none', blocksQueued: 0 });
  });

  it('publishes an auditable no-op snapshot for an unchanged rerun', async () => {
    const h1 = harness({ 'src/b.ts': TS_FILE });
    const plan1 = await planRepositorySnapshot(h1.deps, OPTS);
    await executeRepositorySnapshot(h1.deps, OPTS, plan1);
    const rootId = h1.published[0].rows[0].rootHash;

    const h2 = harness({ 'src/b.ts': TS_FILE }, {
      effective: new Map([['src/b.ts', { docKey: 'repo:fixture:src/b.ts', rootHash: rootId }]]),
    });
    const plan2 = await planRepositorySnapshot(h2.deps, OPTS);
    const result = await executeRepositorySnapshot(h2.deps, OPTS, plan2);
    expect(result.counts).toEqual({ ingested: 0, unchanged: 1, tombstoned: 0 });
    expect(h2.ingested).toHaveLength(0);
    expect(h2.published[0].rows).toEqual([
      {
        path: 'src/b.ts',
        docKey: 'repo:fixture:src/b.ts',
        rootHash: rootId,
        outcome: 'unchanged',
      },
    ]);
  });

  it('tombstones removed paths only after every file ingest succeeded', async () => {
    const h = harness({ 'kept.md': MD_FILE }, {
      effective: new Map([
        ['kept.md', { docKey: 'repo:fixture:kept.md', rootHash: 'stale' }],
        ['deleted.md', { docKey: 'repo:fixture:deleted.md', rootHash: 'x' }],
      ]),
    });
    const plan = await planRepositorySnapshot(h.deps, OPTS);
    const result = await executeRepositorySnapshot(h.deps, OPTS, plan);
    expect(h.tombstoned).toEqual(['repo:fixture:deleted.md']);
    expect(result.counts).toEqual({ ingested: 1, unchanged: 0, tombstoned: 1 });
    const tombstoneRow = h.published[0].rows.find(row => row.outcome === 'tombstoned');
    expect(tombstoneRow).toMatchObject({ path: 'deleted.md', rootHash: emptyDocumentRoot().id });
  });

  it('never publishes or tombstones when one file ingest fails', async () => {
    const h = harness(
      {
        'a.md': MD_FILE,
        'fails.md': MD_FILE.replace('fact', 'other'),
      },
      {
        effective: new Map([
          ['gone.md', { docKey: 'repo:fixture:gone.md', rootHash: 'x' }],
        ]),
        failIngestFor: 'fails.md',
      }
    );
    const plan = await planRepositorySnapshot(h.deps, OPTS);
    await expect(executeRepositorySnapshot(h.deps, OPTS, plan))
      .rejects.toThrow(/forced failure/);
    expect(h.published).toHaveLength(0);
    expect(h.tombstoned).toEqual([]);
  });

  it('rejects an over-budget changed plan before creating the snapshot', async () => {
    const h = harness({ 'README.md': MD_FILE });
    const options: SnapshotOptions = { ...OPTS, policy: { mode: 'changed', maxBlocks: 1 } };
    const plan = await planRepositorySnapshot(h.deps, options);
    expect(plan.paidJobUpperBound).toBe(2);
    await expect(executeRepositorySnapshot(h.deps, options, plan))
      .rejects.toThrow(ExtractionBudgetExceededError);
    expect(h.ingested).toHaveLength(0);
    expect(h.published).toHaveLength(0);
  });

  it('threads the remaining budget through changed-mode ingests', async () => {
    const h = harness({ 'a.md': MD_FILE, 'b.md': MD_FILE.replace('fact', 'second') });
    const options: SnapshotOptions = { ...OPTS, policy: { mode: 'changed', maxBlocks: 4 } };
    const plan = await planRepositorySnapshot(h.deps, options);
    const result = await executeRepositorySnapshot(h.deps, options, plan);
    expect(result.blocksQueued).toBe(4);
    expect(h.ingested.map(request => request.extractionPolicy)).toEqual([
      { mode: 'changed', maxBlocks: 4 },
      { mode: 'changed', maxBlocks: 2 },
    ]);
  });

  it('forces policy none for excluded files under changed and stamps sourceKind by language', async () => {
    const h = harness({
      'src/b.ts': TS_FILE,
      'src/b.test.ts': TS_FILE.replace('alpha', 'alphaTest'),
      'README.md': MD_FILE,
    });
    const options: SnapshotOptions = { ...OPTS, policy: { mode: 'changed', maxBlocks: 10 } };
    const plan = await planRepositorySnapshot(h.deps, options);
    const result = await executeRepositorySnapshot(h.deps, options, plan);

    const byKey = new Map(h.ingested.map(request => [request.docKey, request]));
    // The test file ingests (snapshot completeness) but its extraction
    // policy is forced to none even under --extract changed.
    expect(byKey.get('repo:fixture:src/b.test.ts')?.extractionPolicy).toEqual({ mode: 'none' });
    expect(byKey.get('repo:fixture:src/b.ts')?.extractionPolicy.mode).toBe('changed');
    expect(byKey.get('repo:fixture:README.md')?.extractionPolicy.mode).toBe('changed');
    // The enqueuer's language → prompt-kind mapping travels on the request.
    expect(byKey.get('repo:fixture:src/b.ts')?.sourceKind).toBe('code');
    expect(byKey.get('repo:fixture:src/b.ts')?.language).toBe('typescript');
    expect(byKey.get('repo:fixture:README.md')?.sourceKind).toBe('prose');
    expect(byKey.get('repo:fixture:src/b.test.ts')?.sourceKind).toBe('code');

    // b.ts (1 block) + README (2 blocks) queued; the test file's block
    // is reported excluded, and the published summary carries the counts.
    expect(result.blocksQueued).toBe(3);
    expect(result.extractionExclusionCounts).toEqual({ test_fixture_excluded: 1 });
    expect(result.blocksExcludedFromExtraction).toBe(1);
    expect(h.published[0].summary).toMatchObject({
      extractionExclusionCounts: { test_fixture_excluded: 1 },
      blocksExcludedFromExtraction: 1,
    });
  });

  it('an over-budget plan passes once exclusions bring it under budget', async () => {
    // Total blocks 3 (b.ts 1 + test 1 + fixture md... use md fixture 2)
    // but the budget of 1 fits because only b.ts counts.
    const h = harness({
      'src/b.ts': TS_FILE,
      'tests/big.md': MD_FILE,
    });
    const options: SnapshotOptions = { ...OPTS, policy: { mode: 'changed', maxBlocks: 1 } };
    const plan = await planRepositorySnapshot(h.deps, options);
    expect(plan.paidJobUpperBound).toBe(1);
    const result = await executeRepositorySnapshot(h.deps, options, plan);
    expect(result.blocksQueued).toBe(1);
    expect(result.counts.ingested).toBe(2);
  });
});

describe('snapshot metrics', () => {
  it('records bounded-label file outcomes, skips, snapshots, and block counters', async () => {
    const { Registry } = await import('prom-client');
    const { createMetrics } = await import('../observability/metrics');
    const metrics = createMetrics(new Registry());
    const h = harness(
      { 'src/b.ts': TS_FILE, 'bad.ts': 'function {{{' },
      { effective: new Map([['gone.md', { docKey: 'repo:fixture:gone.md', rootHash: 'x' }]]) }
    );
    h.deps.metrics = metrics;
    const plan = await planRepositorySnapshot(h.deps, OPTS);
    await executeRepositorySnapshot(h.deps, OPTS, plan);

    const text = await metrics.registry.metrics();
    expect(text).toContain('trellis_repo_files_total{outcome="ingested",language="typescript"} 1');
    expect(text).toContain('trellis_repo_files_total{outcome="tombstoned",language="none"} 1');
    expect(text).toContain('trellis_repo_skipped_files_total{reason="parse_error"} 1');
    expect(text).toContain('trellis_repo_snapshots_total{result="published"} 1');
    expect(text).toContain('trellis_repo_blocks_total{stage="eligible"} 1');
    expect(text).toContain('trellis_repo_blocks_total{stage="queued"} 0');
    expect(text).toContain('trellis_repo_blocks_total{stage="test_fixture_excluded"} 0');
  });
});

describe('concurrency primitives', () => {
  it('mapBounded preserves order, bounds concurrency, and fails fast', async () => {
    let active = 0;
    let peak = 0;
    const results = await mapBounded([1, 2, 3, 4, 5], 2, async n => {
      active++;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return n * 10;
    });
    expect(results).toEqual([10, 20, 30, 40, 50]);
    expect(peak).toBeLessThanOrEqual(2);

    let started = 0;
    await expect(mapBounded([1, 2, 3, 4, 5, 6, 7, 8], 1, async n => {
      started++;
      if (n === 2) throw new Error('boom');
      return n;
    })).rejects.toThrow('boom');
    expect(started).toBeLessThan(8);
  });

  it('ByteGate bounds bytes in flight and admits oversized items alone', async () => {
    const gate = new ByteGate(10);
    const releaseA = await gate.acquire(6);
    let bAdmitted = false;
    const pending = gate.acquire(6).then(release => {
      bAdmitted = true;
      return release;
    });
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(bAdmitted).toBe(false);
    releaseA();
    (await pending)();

    // An item larger than capacity is clamped rather than deadlocked.
    const releaseBig = await gate.acquire(1000);
    releaseBig();
  });
});
