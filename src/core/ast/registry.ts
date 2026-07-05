import type { Pool, PoolClient } from 'pg';

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

// A node's bytes are live iff it belongs to the LATEST version of at
// least one registered document. Nodes the registry has never seen
// (legacy/unversioned ingests, direct benchmark writes) are treated as
// live — they can never be orphaned, so quarantine semantics don't apply.
//
// The extraction worker checks this before its paid completion, then uses
// it on both sides of the Neo4j merge. The pre-merge check narrows the
// cross-store check/write window; the post-merge check applies a
// compensating quarantine if a re-ingest committed during the write, so
// dead-source facts cannot remain trusted after the job settles.
// PostgreSQL and Neo4j do not share a transaction, so atomic visibility
// during the brief merge/post-check interval is not claimed.
export async function isAstNodeLive(db: Pool | PoolClient, nodeId: string): Promise<boolean> {
  const res = await db.query(
    `SELECT
       EXISTS (SELECT 1 FROM document_nodes WHERE node_id = $1) AS tracked,
       EXISTS (
         SELECT 1
         FROM document_nodes dn
         JOIN documents d ON d.root_hash = dn.root_hash
         WHERE dn.node_id = $1
           AND d.version = (SELECT max(v.version) FROM documents v WHERE v.doc_key = d.doc_key)
       ) AS live`,
    [nodeId]
  );
  const row = res.rows[0] as { tracked: boolean; live: boolean };
  return !row.tracked || row.live;
}

/**
 * Reduces one document's Merkle orphan candidates to hashes that are absent
 * from the latest version of every registered document.
 *
 * A content-addressed block can belong to multiple documents. The per-document
 * diff is therefore only a candidate set: quarantining a shared hash while it
 * remains in another document's latest version would incorrectly mark live
 * semantic evidence as dead. WITH ORDINALITY preserves input order for stable
 * job telemetry and tests.
 */
export async function findGloballyOrphanedAstNodeIds(
  db: Pool | PoolClient,
  candidateIds: readonly string[]
): Promise<string[]> {
  if (candidateIds.length === 0) return [];
  const result = await db.query(
    `SELECT candidate.node_id
     FROM unnest($1::varchar[]) WITH ORDINALITY AS candidate(node_id, ordinal)
     WHERE NOT EXISTS (
       SELECT 1
       FROM document_nodes dn
       JOIN documents d ON d.root_hash = dn.root_hash
       WHERE dn.node_id = candidate.node_id
         AND d.version = (
           SELECT max(v.version)
           FROM documents v
           WHERE v.doc_key = d.doc_key
         )
     )
     ORDER BY candidate.ordinal`,
    [candidateIds]
  );
  return result.rows.map((row: { node_id: string }) => row.node_id);
}
