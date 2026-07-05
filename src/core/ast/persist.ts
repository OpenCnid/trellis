import type { PoolClient } from 'pg';
import type { ASTNode } from './parser.js';

export interface ExtractionJobInput {
  block: Pick<ASTNode, 'id'>;
  text: string;
}

export interface ExtractionJob {
  name: 'extract';
  data: {
    astNodeId: string;
    text: string;
  };
}

/**
 * Persists an immutable AST in one PostgreSQL round trip. The three arrays are
 * positionally aligned by UNNEST; existing content-addressed rows are reused.
 */
export async function persistAstNodes(
  client: PoolClient,
  documentId: string,
  nodes: readonly ASTNode[]
): Promise<void> {
  if (nodes.length === 0) return;
  await client.query(
    `INSERT INTO ast_nodes (id, document_id, data)
     SELECT input.id, $2, input.data
     FROM UNNEST($1::varchar[], $3::jsonb[]) AS input(id, data)
     ON CONFLICT (id) DO NOTHING`,
    [
      nodes.map(node => node.id),
      documentId,
      nodes.map(node => JSON.stringify(node)),
    ]
  );
}

export function buildExtractionJobs(
  blocks: readonly ExtractionJobInput[]
): ExtractionJob[] {
  return blocks.map(({ block, text }) => ({
    name: 'extract',
    data: {
      astNodeId: block.id,
      text,
    },
  }));
}
