import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { parseMarkdownToAST } from './parser';
import { flattenAST } from './traverse';
import {
  assertPersistedAstNodes,
  buildExtractionJobs,
  persistAstNodes,
  verifyPersistedAstNodes,
} from './persist';

describe('persistAstNodes', () => {
  it('writes every AST node through one UNNEST query', async () => {
    const root = parseMarkdownToAST('# Heading\n\nBody.');
    const nodes = flattenAST(root);
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query } as unknown as PoolClient;

    await persistAstNodes(client, root.id, nodes);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('UNNEST');
    expect(sql).toContain('ON CONFLICT (id) DO NOTHING');
    expect(params[0]).toEqual(nodes.map(node => node.id));
    expect(params[1]).toBe(root.id);
    expect(params[2]).toEqual(nodes.map(node => JSON.stringify(node)));
  });

  it('does not issue invalid SQL for an empty node set', async () => {
    const query = vi.fn();
    const client = { query } as unknown as PoolClient;
    await persistAstNodes(client, 'root', []);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('buildExtractionJobs', () => {
  it('preserves one block hash and its reconstructed text per bulk job', () => {
    const root = parseMarkdownToAST('Globex **acquired** Initech.');
    const block = root.children![0];
    expect(buildExtractionJobs([
      { block, text: 'Globex acquired Initech.' },
    ])).toEqual([
      {
        name: 'extract',
        data: {
          astNodeId: block.id,
          text: 'Globex acquired Initech.',
        },
      },
    ]);
  });

  it('threads ingest correlation context into every job payload', () => {
    const root = parseMarkdownToAST('Globex **acquired** Initech.');
    const block = root.children![0];
    const [job] = buildExtractionJobs(
      [{ block, text: 'Globex acquired Initech.' }],
      { requestId: 'req-1', docKey: 'globex-report', version: 3 }
    );
    expect(job.data).toEqual({
      astNodeId: block.id,
      text: 'Globex acquired Initech.',
      requestId: 'req-1',
      docKey: 'globex-report',
      version: 3,
    });
  });

  it('threads Session 25 sourceKind/language routing metadata when supplied', () => {
    const root = parseMarkdownToAST('Globex **acquired** Initech.');
    const block = root.children![0];
    const [job] = buildExtractionJobs(
      [{ block, text: 'export function f() {}' }],
      { docKey: 'repo:k:src/f.ts', version: 1, sourceKind: 'code', language: 'typescript' }
    );
    expect(job.data).toMatchObject({ sourceKind: 'code', language: 'typescript' });
  });
});

describe('verified AST persistence', () => {
  it('reads every expected row back in one query and accepts exact parser output', async () => {
    const root = parseMarkdownToAST('# Heading\n\nBody.');
    const nodes = flattenAST(root);
    const query = vi.fn().mockResolvedValue({
      rows: nodes.map(node => ({ id: node.id, data: structuredClone(node) })),
    });
    const client = { query } as unknown as PoolClient;

    await verifyPersistedAstNodes(client, nodes);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('SELECT id, data FROM ast_nodes');
    expect(params).toEqual([nodes.map(node => node.id)]);
  });

  it('rejects a write-back with a missing expected row', () => {
    const root = parseMarkdownToAST('Body.');
    const nodes = flattenAST(root);

    expect(() => assertPersistedAstNodes(nodes, [
      { id: root.id, data: structuredClone(root) },
    ])).toThrow(/missing after write-back/);
  });

  it('rejects a stored payload whose parser preimage no longer produces its id', () => {
    const root = parseMarkdownToAST('Body.');
    const nodes = flattenAST(root);
    const rows = nodes.map(node => ({ id: node.id, data: structuredClone(node) }));
    const textRow = rows.find(row => row.data.type === 'text')!;
    textRow.data.content = 'tampered';

    expect(() => assertPersistedAstNodes(nodes, rows)).toThrow(/re-derived id/);
  });

  it('rejects payload drift even when the current hash preimage ignores the extra field', () => {
    const root = parseMarkdownToAST('Body.');
    const nodes = flattenAST(root);
    const rows = nodes.map(node => ({
      id: node.id,
      data: { ...structuredClone(node), unexpected: true },
    }));

    expect(() => assertPersistedAstNodes(nodes, rows)).toThrow(/payload differs/);
  });
});
