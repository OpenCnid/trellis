export const POSTGRES_SCHEMA_SQL = `
  -- The API and worker containers both run this idempotent bootstrap on
  -- startup. IF NOT EXISTS does not make concurrent DDL safe (two
  -- simultaneous CREATE EXTENSION calls race on pg_extension's unique
  -- index), so the whole script — one implicit transaction under the
  -- simple query protocol — is serialized by a transaction-scoped
  -- advisory lock that releases automatically on commit or error.
  SELECT pg_advisory_xact_lock(hashtext('trellis_schema_init'));
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE TABLE IF NOT EXISTS ast_nodes (
    id VARCHAR PRIMARY KEY,
    document_id VARCHAR,
    data JSONB,
    embedding vector(1536)
  );
  -- Phase 4: document identity across versions. Each versioned
  -- ingest appends one row; the Merkle diff runs between the new
  -- root_hash and the previous version's.
  CREATE TABLE IF NOT EXISTS documents (
    doc_key VARCHAR NOT NULL,
    version INTEGER NOT NULL,
    root_hash VARCHAR NOT NULL REFERENCES ast_nodes(id),
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    origin JSONB,
    PRIMARY KEY (doc_key, version)
  );
  -- Session 17: promotion audit stamp (which server/tool/args produced a
  -- promoted document's bytes, fetched when). Nullable and additive —
  -- only the promotion CLI writes it; pre-existing installs gain the
  -- column here without a rewrite.
  ALTER TABLE documents ADD COLUMN IF NOT EXISTS origin JSONB;
  -- Phase 4: per-version node membership. ast_nodes.document_id is
  -- not authoritative for this (ON CONFLICT DO NOTHING pins a shared
  -- node to whichever version inserted it first).
  CREATE TABLE IF NOT EXISTS document_nodes (
    root_hash VARCHAR NOT NULL,
    node_id VARCHAR NOT NULL REFERENCES ast_nodes(id),
    PRIMARY KEY (root_hash, node_id)
  );
  -- The extraction worker's per-job liveness check (registry.ts
  -- isAstNodeLive) looks membership up by node_id alone, which the
  -- (root_hash, node_id) primary key cannot serve.
  CREATE INDEX IF NOT EXISTS idx_document_nodes_node_id
    ON document_nodes (node_id);
  -- pgvector fallback orders by cosine distance (<=>). HNSW avoids a
  -- sequential scan once the immutable AST store grows beyond local scale.
  CREATE INDEX IF NOT EXISTS idx_ast_nodes_embedding_hnsw
    ON ast_nodes USING hnsw (embedding vector_cosine_ops)
    WHERE embedding IS NOT NULL;
  -- Session 8: repository snapshot membership. Only PUBLISHED snapshots
  -- are effective; the pipeline creates the snapshot row first, ingests
  -- per file, and stamps published_at atomically with the path rows, so
  -- a partial failure leaves the previous snapshot as the deletion
  -- baseline and never marks unprocessed paths deleted.
  CREATE TABLE IF NOT EXISTS repository_snapshots (
    repo_key VARCHAR NOT NULL,
    snapshot_seq INTEGER NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ,
    summary JSONB,
    PRIMARY KEY (repo_key, snapshot_seq)
  );
  CREATE TABLE IF NOT EXISTS repository_snapshot_paths (
    repo_key VARCHAR NOT NULL,
    snapshot_seq INTEGER NOT NULL,
    path VARCHAR NOT NULL,
    doc_key VARCHAR NOT NULL,
    root_hash VARCHAR NOT NULL,
    outcome VARCHAR NOT NULL,
    PRIMARY KEY (repo_key, snapshot_seq, path),
    FOREIGN KEY (repo_key, snapshot_seq)
      REFERENCES repository_snapshots (repo_key, snapshot_seq)
  );
  -- T15: both the TypeScript API and Python RLM client call this function,
  -- keeping cosine ordering, null filtering and result shape in one schema
  -- definition instead of maintaining parallel queries across languages.
  -- Session 40 (STRUCTURAL_CHUNKING.md §11): results are filtered to LIVE
  -- blocks — members of some document's CURRENT (max-version) root — before
  -- the LIMIT, so superseded near-twin embeddings cannot occupy result
  -- slots. The membership join mirrors the stage-2 checker's
  -- gatherHashEvidence. Superseded history stays queryable by hash through
  -- every other surface; only vector search filters.
  CREATE OR REPLACE FUNCTION search_ast_nodes(
    query_embedding vector(1536),
    match_count INTEGER DEFAULT 3
  )
  RETURNS TABLE (id VARCHAR, content TEXT)
  LANGUAGE SQL
  STABLE
  PARALLEL SAFE
  AS $function$
    SELECT a.id, a.data->>'content' AS content
    FROM ast_nodes a
    WHERE a.embedding IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM document_nodes dn
        JOIN documents d ON d.root_hash = dn.root_hash
        JOIN (
          SELECT doc_key, MAX(version) AS version
          FROM documents
          GROUP BY doc_key
        ) latest ON latest.doc_key = d.doc_key AND latest.version = d.version
        WHERE dn.node_id = a.id
      )
    ORDER BY a.embedding <=> query_embedding
    LIMIT match_count
  $function$;
`;
