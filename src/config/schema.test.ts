import { describe, expect, it } from 'vitest';
import { POSTGRES_SCHEMA_SQL } from './schema';

describe('PostgreSQL schema', () => {
  it('creates a cosine HNSW index for the vector fallback', () => {
    expect(POSTGRES_SCHEMA_SQL).toContain('USING hnsw');
    expect(POSTGRES_SCHEMA_SQL).toContain('embedding vector_cosine_ops');
    expect(POSTGRES_SCHEMA_SQL).toContain('WHERE embedding IS NOT NULL');
  });
});
