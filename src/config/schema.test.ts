import { describe, expect, it } from 'vitest';
import { POSTGRES_SCHEMA_SQL } from './schema';

describe('PostgreSQL schema', () => {
  it('serializes concurrent bootstrap with a transaction-scoped advisory lock', () => {
    // The API and worker containers race this script on a fresh database;
    // the lock must be the first statement so no DDL runs outside it.
    const statements = POSTGRES_SCHEMA_SQL
      .split(';')
      .map(statement => statement.replace(/--[^\n]*/g, '').trim())
      .filter(statement => statement.length > 0);
    expect(statements[0]).toBe("SELECT pg_advisory_xact_lock(hashtext('trellis_schema_init'))");
  });

  it('creates a cosine HNSW index for the vector fallback', () => {
    expect(POSTGRES_SCHEMA_SQL).toContain('USING hnsw');
    expect(POSTGRES_SCHEMA_SQL).toContain('embedding vector_cosine_ops');
    expect(POSTGRES_SCHEMA_SQL).toContain('WHERE embedding IS NOT NULL');
  });

  it('centralizes vector fallback ordering in a database function', () => {
    expect(POSTGRES_SCHEMA_SQL).toContain('FUNCTION search_ast_nodes');
    expect(POSTGRES_SCHEMA_SQL).toContain('ORDER BY a.embedding <=> query_embedding');
  });
});
