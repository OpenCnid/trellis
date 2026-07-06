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
    PRIMARY KEY (doc_key, version)
  );
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
  -- T15: both the TypeScript API and Python RLM client call this function,
  -- keeping cosine ordering, null filtering and result shape in one schema
  -- definition instead of maintaining parallel queries across languages.
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
    ORDER BY a.embedding <=> query_embedding
    LIMIT match_count
  $function$;
`;
