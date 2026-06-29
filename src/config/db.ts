import { Pool } from 'pg';
import neo4j from 'neo4j-driver';

// PostgreSQL Connection (AST Document Store)
export const pgPool = new Pool({
  host: '127.0.0.1',
  port: 5433,
  user: 'trellis_user',
  password: 'trellis_password',
  database: 'trellis_db'
});

// Neo4j Connection (Semantic Knowledge Graph)
export const neo4jDriver = neo4j.driver(
  'bolt://127.0.0.1:7687',
  neo4j.auth.basic('neo4j', 'trellis_password')
);
