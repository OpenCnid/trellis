import type { PoolClient } from 'pg';
import { isDeepStrictEqual } from 'node:util';
import { rederiveAstNodeId, type ASTNode } from './parser.js';

export interface ExtractionJobInput {
  block: Pick<ASTNode, 'id'>;
  text: string;
}

/**
 * Session 25: the source-kind signal for extraction prompt routing.
 * `code` selects the code-tuned prompt in the extraction worker; `prose`
 * and an ABSENT field both select the exact legacy document-generic
 * prompt bytes (pinned in extraction_job.test.ts), so anything already
 * queued and any pre-Session-25 producer processes byte-identically.
 */
export type ExtractionSourceKind = 'code' | 'prose';

/**
 * Correlation context threaded from the ingest request into each queued
 * job so worker logs can answer which request/version produced a failed
 * or dropped job. Optional: jobs queued before these fields existed (or
 * enqueued by scripts) still process. sourceKind/language (Session 25)
 * are additive prompt-routing metadata with the same back-compat rule.
 */
export interface IngestJobContext {
  requestId?: string;
  docKey?: string;
  version?: number;
  sourceKind?: ExtractionSourceKind;
  language?: string;
}

export interface ExtractionJob {
  name: 'extract';
  data: {
    astNodeId: string;
    text: string;
  } & IngestJobContext;
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

export interface PersistedAstNodeRow {
  id: string;
  data: unknown;
}

function isAstNodePayload(value: unknown): value is ASTNode {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ASTNode>;
  if (typeof candidate.id !== 'string' || typeof candidate.type !== 'string') return false;
  if (candidate.content !== undefined && typeof candidate.content !== 'string') return false;
  if (
    candidate.children !== undefined
    && (!Array.isArray(candidate.children) || !candidate.children.every(isAstNodePayload))
  ) {
    return false;
  }
  if (
    candidate.metadata !== undefined
    && (!candidate.metadata || typeof candidate.metadata !== 'object' || Array.isArray(candidate.metadata))
  ) {
    return false;
  }
  return true;
}

/**
 * Validates the write-back rows against parser-derived AST nodes.
 *
 * Re-hashing catches a row whose payload no longer matches its immutable id;
 * deep comparison also catches fields outside today's hash preimage. That
 * second check matters while T13's deliberately unchanged preimage omits some
 * distinctions. PostgreSQL JSONB key ordering is irrelevant to
 * isDeepStrictEqual.
 */
export function assertPersistedAstNodes(
  expectedNodes: readonly ASTNode[],
  rows: readonly PersistedAstNodeRow[]
): void {
  const storedById = new Map(rows.map(row => [row.id, row.data]));
  const missing = expectedNodes.filter(node => !storedById.has(node.id));
  if (missing.length > 0) {
    throw new Error(
      `AST verification failed: ${missing.length} node(s) missing after write-back: `
      + missing.slice(0, 3).map(node => node.id).join(', ')
    );
  }

  for (const expected of expectedNodes) {
    const stored = storedById.get(expected.id);
    if (!isAstNodePayload(stored)) {
      throw new Error(`AST verification failed for ${expected.id}: stored payload is not an AST node`);
    }
    const rederivedId = rederiveAstNodeId(stored);
    if (stored.id !== expected.id || rederivedId !== expected.id) {
      throw new Error(
        `AST verification failed for ${expected.id}: stored payload re-derived id ${rederivedId}`
      );
    }
    // Compare against the exact JSON representation sent to PostgreSQL.
    // This normalizes JSON-specific values such as -0 before comparing.
    const expectedJson = JSON.parse(JSON.stringify(expected)) as ASTNode;
    if (!isDeepStrictEqual(stored, expectedJson)) {
      throw new Error(
        `AST verification failed for ${expected.id}: stored payload differs from parser output`
      );
    }
  }
}

/**
 * Reads a just-written AST back in one round trip and verifies it before the
 * caller commits its transaction.
 */
export async function verifyPersistedAstNodes(
  client: PoolClient,
  expectedNodes: readonly ASTNode[]
): Promise<void> {
  if (expectedNodes.length === 0) return;
  const result = await client.query(
    'SELECT id, data FROM ast_nodes WHERE id = ANY($1::varchar[])',
    [expectedNodes.map(node => node.id)]
  );
  assertPersistedAstNodes(expectedNodes, result.rows as PersistedAstNodeRow[]);
}

export function buildExtractionJobs(
  blocks: readonly ExtractionJobInput[],
  context: IngestJobContext = {}
): ExtractionJob[] {
  return blocks.map(({ block, text }) => ({
    name: 'extract',
    data: {
      astNodeId: block.id,
      text,
      ...context,
    },
  }));
}
