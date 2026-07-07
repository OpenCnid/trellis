import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { parseMarkdownToAST } from '../ast/parser';
import { flattenAST } from '../ast/traverse';
import {
  emptyDocumentRoot,
  ingestDocument,
  ingestTombstone,
  type IngestDeps,
} from './ingest_document';
import { ExtractionBudgetExceededError, planExtraction } from './plan_ingest';

// The fake PostgreSQL client answers the service's queries by SQL shape,
// so the exact transaction ordering (T15's verified persistence, registry
// registration, and the in-transaction diff) is pinned without a database.
interface FakeDbState {
  // doc_key -> [{version, root_hash}] latest-last.
  documents: Map<string, Array<{ version: number; root_hash: string }>>;
  // root_hash -> node ids (prior versions' membership for diffVersions).
  membership: Map<string, string[]>;
}

function fakeDeps(state: FakeDbState) {
  const statements: string[] = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    statements.push(sql.trim().split(/\s+/).slice(0, 4).join(' '));
    if (sql.includes('SELECT id, data FROM ast_nodes')) {
      const ids = (params![0] as string[]);
      // Echo back exactly what persistAstNodes wrote in this transaction.
      const written = lastPersisted.filter(node => ids.includes(node.id));
      return { rows: written.map(node => ({ id: node.id, data: structuredClone(node) })) };
    }
    if (sql.includes('FROM documents') && sql.includes('FOR UPDATE')) {
      const rows = state.documents.get(params![0] as string) ?? [];
      return { rows: rows.slice(-1) };
    }
    if (sql.includes('INSERT INTO documents')) {
      const [docKey, version, rootHash] = params as [string, number, string];
      const rows = state.documents.get(docKey) ?? [];
      state.documents.set(docKey, [...rows, { version, root_hash: rootHash }]);
      return { rows: [] };
    }
    if (sql.includes('SELECT node_id FROM document_nodes')) {
      const ids = state.membership.get(params![0] as string) ?? [];
      return { rows: ids.map(node_id => ({ node_id })) };
    }
    if (sql.includes('INSERT INTO ast_nodes')) {
      lastPersisted = JSON.parse(JSON.stringify(
        (params![2] as string[]).map(json => JSON.parse(json))
      ));
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO document_nodes')) {
      state.membership.set(params![0] as string, [...(params![1] as string[])]);
      return { rows: [] };
    }
    return { rows: [] };
  });
  let lastPersisted: any[] = [];
  const release = vi.fn();
  const pgPool = { connect: async () => ({ query, release }) } as unknown as Pool;
  const extraction = { addBulk: vi.fn(async () => undefined) };
  const invalidation = { add: vi.fn(async () => undefined) };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as IngestDeps['log'];
  const deps: IngestDeps = { pgPool, queues: { extraction, invalidation }, log };
  return { deps, statements, extraction, invalidation, release, query };
}

const V1 = '# Title\n\nAlpha fact one.\n\nBeta fact two.';
const V2 = '# Title\n\nAlpha fact one.\n\nBeta fact EDITED two.';

describe('planExtraction', () => {
  it('selects every non-empty block for a first version under changed', () => {
    const root = parseMarkdownToAST(V1);
    const plan = planExtraction(root, null, { mode: 'changed' });
    expect(plan.blocksEligible).toBe(3);
    expect(plan.blocks.map(({ text }) => text)).toEqual([
      'Title',
      'Alpha fact one.',
      'Beta fact two.',
    ]);
  });

  it('restricts eligibility to diff.added on re-ingest', () => {
    const root = parseMarkdownToAST(V2);
    const editedBlock = root.children![2];
    const diff = { added: [editedBlock.id], orphaned: ['dead'], retained: [] };
    const plan = planExtraction(root, diff, { mode: 'changed' });
    expect(plan.blocksEligible).toBe(1);
    expect(plan.blocks[0].text).toBe('Beta fact EDITED two.');
  });

  it('reports eligibility but plans zero blocks under none', () => {
    const root = parseMarkdownToAST(V1);
    const plan = planExtraction(root, null, { mode: 'none' });
    expect(plan.blocksEligible).toBe(3);
    expect(plan.blocks).toEqual([]);
  });

  it('rejects a plan that exceeds the block budget', () => {
    const root = parseMarkdownToAST(V1);
    expect(() => planExtraction(root, null, { mode: 'changed', maxBlocks: 2 }))
      .toThrow(ExtractionBudgetExceededError);
    expect(planExtraction(root, null, { mode: 'changed', maxBlocks: 3 }).blocks).toHaveLength(3);
  });
});

describe('ingestDocument', () => {
  it('runs the verified transaction in the pinned order and queues every block', async () => {
    const { deps, statements, extraction, invalidation } = fakeDeps({
      documents: new Map(),
      membership: new Map(),
    });
    const root = parseMarkdownToAST(V1);

    const result = await ingestDocument(deps, {
      rootNode: root,
      docKey: 'doc-1',
      extractionPolicy: { mode: 'changed' },
      requestId: 'req-1',
    });

    expect(statements).toEqual([
      'BEGIN',
      'INSERT INTO ast_nodes (id,',      // persistAstNodes (UNNEST)
      'SELECT id, data FROM',            // verifyPersistedAstNodes read-back
      'INSERT INTO document_nodes (root_hash,', // recordDocumentNodes
      'SELECT version, root_hash FROM',  // registerDocumentVersion prior lookup
      'INSERT INTO documents (doc_key,', // registerDocumentVersion insert
      'COMMIT',
    ]);
    expect(result).toMatchObject({
      rootId: root.id,
      docKey: 'doc-1',
      version: 1,
      totalNodes: flattenAST(root).length,
      blocksEligible: 3,
      blocksQueued: 3,
      extractionPolicy: 'changed',
      diff: null,
    });
    expect(invalidation.add).not.toHaveBeenCalled();
    expect(extraction.addBulk).toHaveBeenCalledTimes(1);
    const jobs = extraction.addBulk.mock.calls[0][0];
    expect(jobs).toHaveLength(3);
    expect(jobs[0].data).toMatchObject({ requestId: 'req-1', docKey: 'doc-1', version: 1 });
  });

  it('diffs inside the transaction, queues only added blocks, and sweeps orphans with the fresh set', async () => {
    const state: FakeDbState = { documents: new Map(), membership: new Map() };
    const first = fakeDeps(state);
    const rootV1 = parseMarkdownToAST(V1);
    await ingestDocument(first.deps, {
      rootNode: rootV1,
      docKey: 'doc-1',
      extractionPolicy: { mode: 'changed' },
    });

    const second = fakeDeps(state);
    const rootV2 = parseMarkdownToAST(V2);
    const result = await ingestDocument(second.deps, {
      rootNode: rootV2,
      docKey: 'doc-1',
      extractionPolicy: { mode: 'changed' },
      requestId: 'req-2',
    });

    // The diff's membership reads run between registration and COMMIT.
    const commitIndex = second.statements.indexOf('COMMIT');
    const diffReads = second.statements
      .map((sql, index) => ({ sql, index }))
      .filter(({ sql }) => sql.startsWith('SELECT node_id FROM'));
    expect(diffReads).toHaveLength(2);
    expect(diffReads.every(({ index }) => index < commitIndex)).toBe(true);

    // Root, edited paragraph, and its text node changed; the heading
    // chain and untouched paragraph kept their hashes.
    expect(result.diff).toEqual({ added: 3, orphaned: 3, retained: 4 });
    expect(result.blocksEligible).toBe(1);
    expect(result.blocksQueued).toBe(1);
    expect(result.version).toBe(2);

    const editedBlockId = rootV2.children![2].id;
    const sweep = second.invalidation.add.mock.calls[0];
    expect(sweep[0]).toBe('sweep');
    expect(sweep[1]).toMatchObject({
      docKey: 'doc-1',
      oldVersion: 1,
      newVersion: 2,
      freshHashes: [editedBlockId],
      requestId: 'req-2',
    });
    expect(sweep[1].orphanedHashes).toHaveLength(3);
    const jobs = second.extraction.addBulk.mock.calls[0][0];
    expect(jobs.map((job: any) => job.data.astNodeId)).toEqual([editedBlockId]);
  });

  it('registers a byte-identical re-ingest as a version with zero added/orphaned/queued', async () => {
    const state: FakeDbState = { documents: new Map(), membership: new Map() };
    const first = fakeDeps(state);
    const root = parseMarkdownToAST(V1);
    await ingestDocument(first.deps, {
      rootNode: root,
      docKey: 'doc-1',
      extractionPolicy: { mode: 'changed' },
    });

    const second = fakeDeps(state);
    const result = await ingestDocument(second.deps, {
      rootNode: parseMarkdownToAST(V1),
      docKey: 'doc-1',
      extractionPolicy: { mode: 'changed' },
    });
    expect(result.version).toBe(2);
    expect(result.diff).toEqual({ added: 0, orphaned: 0, retained: flattenAST(root).length });
    expect(result.blocksQueued).toBe(0);
    expect(second.extraction.addBulk).not.toHaveBeenCalled();
    expect(second.invalidation.add).not.toHaveBeenCalled();
  });

  it('queues no extraction under policy none and sends an empty fresh set to the sweep', async () => {
    const state: FakeDbState = { documents: new Map(), membership: new Map() };
    const first = fakeDeps(state);
    await ingestDocument(first.deps, {
      rootNode: parseMarkdownToAST(V1),
      docKey: 'doc-1',
      extractionPolicy: { mode: 'none' },
    });
    expect(first.extraction.addBulk).not.toHaveBeenCalled();

    const second = fakeDeps(state);
    const result = await ingestDocument(second.deps, {
      rootNode: parseMarkdownToAST(V2),
      docKey: 'doc-1',
      extractionPolicy: { mode: 'none' },
    });
    expect(result.blocksEligible).toBe(1);
    expect(result.blocksQueued).toBe(0);
    expect(second.extraction.addBulk).not.toHaveBeenCalled();
    expect(second.invalidation.add.mock.calls[0][1]).toMatchObject({ freshHashes: [] });
  });

  it('rolls the whole version back and touches no queue when the budget is exceeded', async () => {
    const { deps, statements, extraction, invalidation } = fakeDeps({
      documents: new Map(),
      membership: new Map(),
    });

    await expect(ingestDocument(deps, {
      rootNode: parseMarkdownToAST(V1),
      docKey: 'doc-1',
      extractionPolicy: { mode: 'changed', maxBlocks: 2 },
    })).rejects.toThrow(ExtractionBudgetExceededError);

    expect(statements).not.toContain('COMMIT');
    expect(statements[statements.length - 1]).toBe('ROLLBACK');
    expect(extraction.addBulk).not.toHaveBeenCalled();
    expect(invalidation.add).not.toHaveBeenCalled();
  });

  it('tombstones a document by orphaning every prior node with no extraction', async () => {
    const state: FakeDbState = { documents: new Map(), membership: new Map() };
    const first = fakeDeps(state);
    const root = parseMarkdownToAST(V1);
    await ingestDocument(first.deps, {
      rootNode: root,
      docKey: 'doc-1',
      extractionPolicy: { mode: 'changed' },
    });

    const second = fakeDeps(state);
    const result = await ingestTombstone(second.deps, 'doc-1', 'req-t');
    expect(result.version).toBe(2);
    expect(result.rootId).toBe(emptyDocumentRoot().id);
    expect(result.blocksQueued).toBe(0);
    expect(result.extractionPolicy).toBe('none');
    // Every prior node orphans; the empty root itself is the only member.
    expect(result.diff).toEqual({ added: 1, orphaned: flattenAST(root).length, retained: 0 });
    expect(second.extraction.addBulk).not.toHaveBeenCalled();
    expect(second.invalidation.add.mock.calls[0][1]).toMatchObject({
      docKey: 'doc-1',
      freshHashes: [],
      requestId: 'req-t',
    });
  });

  it('derives a deterministic empty tombstone root', () => {
    const a = emptyDocumentRoot();
    const b = emptyDocumentRoot();
    expect(a).toEqual(b);
    expect(a.children).toBeUndefined();
    expect(a.type).toBe('root');
  });
});
