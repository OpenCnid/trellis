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

  it('filters vector search to current-version members before the limit (Session 40)', () => {
    // The liveness filter (STRUCTURAL_CHUNKING.md §11): superseded blocks
    // keep their embeddings but must never occupy result slots. The join
    // mirrors gatherHashEvidence's max-version bridge, and it must sit
    // inside the WHERE clause — filtering after the LIMIT would under-fill
    // match_count. The function signature stays unchanged so both callers
    // (trellis_tools.py vector_search, POST /retrieve) change zero bytes.
    const fn = POSTGRES_SCHEMA_SQL.slice(POSTGRES_SCHEMA_SQL.indexOf('FUNCTION search_ast_nodes'));
    expect(fn).toContain('match_count INTEGER DEFAULT 3');
    expect(fn).toContain('RETURNS TABLE (id VARCHAR, content TEXT)');
    expect(fn).toContain('AND EXISTS (');
    expect(fn).toContain('JOIN documents d ON d.root_hash = dn.root_hash');
    expect(fn).toContain('SELECT doc_key, MAX(version) AS version');
    expect(fn).toContain('WHERE dn.node_id = a.id');
    const existsAt = fn.indexOf('AND EXISTS');
    const orderAt = fn.indexOf('ORDER BY a.embedding');
    const limitAt = fn.indexOf('LIMIT match_count');
    expect(existsAt).toBeGreaterThan(-1);
    expect(existsAt).toBeLessThan(orderAt);
    expect(orderAt).toBeLessThan(limitAt);
  });

  it('records repository snapshot membership idempotently (Session 8)', () => {
    // Both tables use IF NOT EXISTS and run inside the same advisory-lock
    // script, so concurrent bootstraps stay safe. published_at is nullable:
    // an unpublished snapshot must never become the deletion baseline.
    expect(POSTGRES_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS repository_snapshots');
    expect(POSTGRES_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS repository_snapshot_paths');
    expect(POSTGRES_SCHEMA_SQL).toContain('published_at TIMESTAMPTZ,');
    expect(POSTGRES_SCHEMA_SQL).toContain('PRIMARY KEY (repo_key, snapshot_seq, path)');
    expect(POSTGRES_SCHEMA_SQL).toMatch(/REFERENCES repository_snapshots \(repo_key, snapshot_seq\)/);
  });
});
