import { describe, expect, it } from 'vitest';
import { POSTGRES_SCHEMA_SQL } from './schema';

describe('PostgreSQL schema', () => {
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
