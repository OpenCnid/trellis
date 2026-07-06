import type { Pool } from 'pg';

// Session 8: durable repository snapshot membership.
//
// The database — not a disposable local file — knows which paths the
// previous snapshot of a repository contained, because deletion is a
// correctness feature: a path present before and absent now must be
// tombstoned or its semantic facts stay live forever. Only PUBLISHED
// snapshots are effective; a run that fails partway leaves its snapshot
// row unpublished with no path rows, so the previous snapshot remains
// the deletion baseline and unprocessed paths are never marked deleted.

export type SnapshotPathOutcome = 'ingested' | 'unchanged' | 'tombstoned';

export interface SnapshotPathRow {
  path: string;
  docKey: string;
  rootHash: string;
  outcome: SnapshotPathOutcome;
}

export interface EffectivePath {
  docKey: string;
  rootHash: string;
}

export interface SnapshotStore {
  createSnapshot(repoKey: string): Promise<number>;
  fetchEffectivePaths(repoKey: string): Promise<Map<string, EffectivePath>>;
  publishSnapshot(
    repoKey: string,
    snapshotSeq: number,
    rows: readonly SnapshotPathRow[],
    summary: Record<string, unknown>
  ): Promise<void>;
}

export function createPgSnapshotStore(pgPool: Pool): SnapshotStore {
  return {
    // The per-repo advisory lock serializes concurrent runs of the same
    // repository so two snapshots cannot claim one sequence number; it
    // releases with the transaction.
    async createSnapshot(repoKey) {
      const client = await pgPool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtext('trellis_repo_snapshot'), hashtext($1))",
          [repoKey]
        );
        const result = await client.query(
          `INSERT INTO repository_snapshots (repo_key, snapshot_seq)
           SELECT $1::varchar, COALESCE(MAX(snapshot_seq), 0) + 1
           FROM repository_snapshots WHERE repo_key = $1::varchar
           RETURNING snapshot_seq`,
          [repoKey]
        );
        await client.query('COMMIT');
        return result.rows[0].snapshot_seq as number;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async fetchEffectivePaths(repoKey) {
      const result = await pgPool.query(
        `SELECT path, doc_key, root_hash
         FROM repository_snapshot_paths
         WHERE repo_key = $1
           AND snapshot_seq = (
             SELECT MAX(snapshot_seq) FROM repository_snapshots
             WHERE repo_key = $1 AND published_at IS NOT NULL
           )
           AND outcome <> 'tombstoned'`,
        [repoKey]
      );
      return new Map(result.rows.map(
        (row: { path: string; doc_key: string; root_hash: string }) =>
          [row.path, { docKey: row.doc_key, rootHash: row.root_hash }]
      ));
    },

    // Path rows and the published_at stamp commit atomically: an
    // observer never sees a published snapshot with partial membership.
    async publishSnapshot(repoKey, snapshotSeq, rows, summary) {
      const client = await pgPool.connect();
      try {
        await client.query('BEGIN');
        if (rows.length > 0) {
          await client.query(
            `INSERT INTO repository_snapshot_paths
               (repo_key, snapshot_seq, path, doc_key, root_hash, outcome)
             SELECT $1, $2, input.path, input.doc_key, input.root_hash, input.outcome
             FROM UNNEST($3::varchar[], $4::varchar[], $5::varchar[], $6::varchar[])
               AS input(path, doc_key, root_hash, outcome)`,
            [
              repoKey,
              snapshotSeq,
              rows.map(row => row.path),
              rows.map(row => row.docKey),
              rows.map(row => row.rootHash),
              rows.map(row => row.outcome),
            ]
          );
        }
        const updated = await client.query(
          `UPDATE repository_snapshots
           SET published_at = now(), summary = $3
           WHERE repo_key = $1 AND snapshot_seq = $2 AND published_at IS NULL`,
          [repoKey, snapshotSeq, JSON.stringify(summary)]
        );
        if (updated.rowCount !== 1) {
          throw new Error(
            `snapshot ${repoKey}#${snapshotSeq} is missing or already published`
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
