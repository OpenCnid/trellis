import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { parseMarkdownToAST } from './parser';
import { flattenAST } from './traverse';
import { buildExtractionJobs, persistAstNodes } from './persist';

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
});
