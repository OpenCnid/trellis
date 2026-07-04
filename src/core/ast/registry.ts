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
// The extraction worker gates its graph writes on this: a queue-lagged
// job whose block was superseded by a newer re-ingest before the job ran
// must not re-derive facts from bytes the quarantine sweep is (or has
// already finished) contesting. A sub-millisecond check-then-write window
// remains if a re-ingest of the same document lands between this check
// and the merge; the racing sweep closes it whenever the sweep's Cypher
// executes after the merge (the common case, since the sweep is enqueued
// in the same request that orphans the block).
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
