import type { PoolClient } from 'pg';

// Phase 4 Milestone 1: the document registry.
//
// A doc_key gives a document identity across versions. Every versioned
// ingest appends a (doc_key, version, root_hash) row; the previous
// version's root hash is what the Merkle diff runs against.

export interface VersionRegistration {
  docKey: string;
  version: number;
  rootHash: string;
  // Root hash of the immediately preceding version, or null if this is
  // the first version registered under this doc_key.
  priorRootHash: string | null;
}

// Must run inside the same transaction that persisted the AST nodes
// (documents.root_hash references ast_nodes.id). The FOR UPDATE lock
// serializes concurrent re-ingests of the same doc_key; for a brand-new
// key the (doc_key, version) primary key still rejects a double insert.
export async function registerDocumentVersion(
  client: PoolClient,
  docKey: string,
  rootHash: string
): Promise<VersionRegistration> {
  const prior = await client.query(
    `SELECT version, root_hash FROM documents
     WHERE doc_key = $1 ORDER BY version DESC LIMIT 1 FOR UPDATE`,
    [docKey]
  );
  const priorRow = prior.rows[0];
  const version = priorRow ? priorRow.version + 1 : 1;
  await client.query(
    'INSERT INTO documents (doc_key, version, root_hash) VALUES ($1, $2, $3)',
    [docKey, version, rootHash]
  );
  return { docKey, version, rootHash, priorRootHash: priorRow ? priorRow.root_hash : null };
}

// Records the full node-id set of one version. Idempotent: re-ingesting
// byte-identical content re-derives the same root hash and the same
// membership rows, and ON CONFLICT makes that a no-op.
export async function recordDocumentNodes(
  client: PoolClient,
  rootHash: string,
  nodeIds: string[]
): Promise<void> {
  await client.query(
    `INSERT INTO document_nodes (root_hash, node_id)
     SELECT $1, unnest($2::varchar[])
     ON CONFLICT (root_hash, node_id) DO NOTHING`,
    [rootHash, nodeIds]
  );
}
