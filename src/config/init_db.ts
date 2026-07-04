import { pgPool, neo4jDriver } from './db.js';

async function initializeDatabases() {
  console.log("Initializing database schemas...");
  let success = true;

  // Initialize PostgreSQL
  try {
    const pgClient = await pgPool.connect();
    await pgClient.query(`
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
      CREATE INDEX IF NOT EXISTS idx_document_nodes_node_id ON document_nodes (node_id);
    `);
    console.log("[PASS] PostgreSQL: AST Nodes, documents, and document_nodes tables created/verified.");
    pgClient.release();
  } catch (err: any) {
    console.error(`[FAIL] PostgreSQL Error: ${err.message}`);
    success = false;
  }

  // Initialize Neo4j
  try {
    const session = neo4jDriver.session();
    await session.run(`
      CREATE CONSTRAINT IF NOT EXISTS FOR (e:Entity) REQUIRE e.id IS UNIQUE;
    `);
    console.log("[PASS] Neo4j: Entity ID uniqueness constraint created/verified.");
    await session.close();
  } catch (err: any) {
    console.error(`[FAIL] Neo4j Error: ${err.message}`);
    success = false;
  }

  if (success) {
    console.log("\nSchemas successfully initialized on all databases.");
  } else {
    console.log("\nSchema initialization failed.");
  }

  await pgPool.end();
  await neo4jDriver.close();
  process.exit(0);
}

initializeDatabases();
