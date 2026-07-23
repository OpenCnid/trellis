import type { Driver } from 'neo4j-driver';
import type { Pool } from 'pg';
import { config } from '../../config/index.js';

// Drill target gate (AGENTS.md rule 8: tooling shape closes behavioral
// failure classes).
//
// Benchmark and drill scripts write to whatever NEO4J_URI / PG_* the
// process environment supplies, and nothing in a corpus distinguishes a
// scratch benchmark database from one holding real work. Two
// independent gates stand between a drill and a wrong target:
//
//   1. A TARGET MARKER written into the databases themselves by
//      `npm run drill:mark-target`. Every drill refuses on a store that
//      does not carry one. Because the marker lives in the database
//      rather than in the invocation, a stale .env, a copied shell
//      line, or a variable exported in another terminal cannot carry it
//      to the wrong host.
//   2. An explicit `--confirm-<act>` flag on the destructive scripts,
//      typed after reviewing the echoed plan (the repo:ingest /
//      promote_segment double gate).
//
// The marker guards WHICH database; the confirmation guards WHETHER the
// operator means the destruction. Neither substitutes for the other — a
// confirmed run against the wrong database is precisely the failure the
// marker exists to stop, and a marked database still deserves a pause
// before an unscoped DELETE.
//
// The marker's shape is deliberate: the Neo4j node carries no `name`
// and no `sourceNodeIds`, so the drills' own cleanup passes (which
// match on `n.name STARTS WITH <namespace>`, on orphaned `:Entity`
// nodes carrying provenance, and on orphaned `:Concept` nodes) can
// never delete the marker that authorized them.

/** The stores a drill can write to; a gate names the ones it needs. */
export type DrillStore = 'neo4j' | 'postgres';

export interface DrillTargetMarker {
  /** Operator's own words for what this database is for. */
  purpose: string;
  /** ISO-8601 instant the marker was written. */
  markedAt: string;
  /** Who marked it — free text, for reading a stale marker later. */
  markedBy: string;
}

/**
 * Marker readers, injected so the gate is exercisable without a live
 * database (the negative control in `scripts/test_drill_gate.ts` runs
 * every refusal path against fakes).
 */
export interface MarkerReaders {
  neo4j: () => Promise<DrillTargetMarker | null>;
  postgres: () => Promise<DrillTargetMarker | null>;
}

/** Raised when a required store carries no drill-target marker. */
export class DrillTargetRefusal extends Error {
  constructor(readonly store: DrillStore, message: string) {
    super(message);
    this.name = 'DrillTargetRefusal';
  }
}

/** Raised when a destructive act was not confirmed by its flag. */
export class ConfirmationRefusal extends Error {
  constructor(readonly flag: string, message: string) {
    super(message);
    this.name = 'ConfirmationRefusal';
  }
}

export const NEO4J_MARKER_LABEL = 'TrellisDrillTarget';
export const POSTGRES_MARKER_TABLE = 'drill_target_marker';
const MARKER_ID = 'singleton';

/**
 * The resolved write targets, rendered for the pre-write echo. Never
 * includes credentials: the point is for an operator to recognize the
 * host, not to reproduce the connection.
 */
export function describeTargets(): Record<DrillStore, string> {
  const { host, port, database, user } = config.postgres;
  return {
    neo4j: config.neo4j.uri,
    postgres: `postgres://${user}@${host}:${port}/${database}`,
  };
}

export async function readNeo4jMarker(driver: Driver): Promise<DrillTargetMarker | null> {
  const session = driver.session();
  try {
    const result = await session.executeRead(tx =>
      tx.run(
        `MATCH (m:${NEO4J_MARKER_LABEL} {id: $id})
         RETURN m.purpose AS purpose, m.markedAt AS markedAt, m.markedBy AS markedBy`,
        { id: MARKER_ID }
      )
    );
    const record = result.records[0];
    if (!record) return null;
    return {
      purpose: String(record.get('purpose')),
      markedAt: String(record.get('markedAt')),
      markedBy: String(record.get('markedBy')),
    };
  } finally {
    await session.close();
  }
}

export async function readPostgresMarker(pool: Pool): Promise<DrillTargetMarker | null> {
  const exists = await pool.query(
    'SELECT to_regclass($1) IS NOT NULL AS present',
    [POSTGRES_MARKER_TABLE]
  );
  if (!exists.rows[0].present) return null;
  const result = await pool.query(
    `SELECT purpose, marked_at, marked_by FROM ${POSTGRES_MARKER_TABLE} WHERE id = $1`,
    [MARKER_ID]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    purpose: String(row.purpose),
    markedAt: new Date(row.marked_at).toISOString(),
    markedBy: String(row.marked_by),
  };
}

/** Readers bound to the live clients — what every real drill passes. */
export function liveMarkerReaders(driver: Driver, pool: Pool): MarkerReaders {
  return {
    neo4j: () => readNeo4jMarker(driver),
    postgres: () => readPostgresMarker(pool),
  };
}

export async function writeNeo4jMarker(driver: Driver, marker: DrillTargetMarker): Promise<void> {
  const session = driver.session();
  try {
    await session.executeWrite(tx =>
      tx.run(
        `MERGE (m:${NEO4J_MARKER_LABEL} {id: $id})
         SET m.purpose = $purpose, m.markedAt = $markedAt, m.markedBy = $markedBy`,
        { id: MARKER_ID, ...marker }
      )
    );
  } finally {
    await session.close();
  }
}

export async function writePostgresMarker(pool: Pool, marker: DrillTargetMarker): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${POSTGRES_MARKER_TABLE} (
         id VARCHAR PRIMARY KEY,
         purpose TEXT NOT NULL,
         marked_at TIMESTAMPTZ NOT NULL,
         marked_by TEXT NOT NULL
       )`
    );
    await client.query(
      `INSERT INTO ${POSTGRES_MARKER_TABLE} (id, purpose, marked_at, marked_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
         SET purpose = EXCLUDED.purpose,
             marked_at = EXCLUDED.marked_at,
             marked_by = EXCLUDED.marked_by`,
      [MARKER_ID, marker.purpose, marker.markedAt, marker.markedBy]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function clearNeo4jMarker(driver: Driver): Promise<number> {
  const session = driver.session();
  try {
    const result = await session.executeWrite(tx =>
      tx.run(
        `MATCH (m:${NEO4J_MARKER_LABEL} {id: $id}) DELETE m RETURN count(m) AS cleared`,
        { id: MARKER_ID }
      )
    );
    return result.records[0].get('cleared').toNumber();
  } finally {
    await session.close();
  }
}

export async function clearPostgresMarker(pool: Pool): Promise<number> {
  const exists = await pool.query(
    'SELECT to_regclass($1) IS NOT NULL AS present',
    [POSTGRES_MARKER_TABLE]
  );
  if (!exists.rows[0].present) return 0;
  const result = await pool.query(
    `DELETE FROM ${POSTGRES_MARKER_TABLE} WHERE id = $1`,
    [MARKER_ID]
  );
  return result.rowCount ?? 0;
}

function refusalMessage(store: DrillStore, target: string): string {
  return (
    `${store} at ${target} carries no drill-target marker.\n\n`
    + `  Drill and benchmark scripts write corpora, flip cached beliefs, and run\n`
    + `  unscoped deletes. They refuse any store that has not been explicitly\n`
    + `  declared expendable, because a confirmation flag alone cannot tell a\n`
    + `  benchmark database from one holding real work.\n\n`
    + `  If this database IS expendable, declare it once:\n`
    + `    npm run drill:mark-target -- --purpose "<what this database is for>" --confirm-mark\n\n`
    + `  If it is NOT, you are pointed at the wrong target: check NEO4J_URI and\n`
    + `  PG_HOST / PG_DATABASE in the environment this process inherited.`
  );
}

/**
 * Refuses unless every named store carries a marker. Returns the markers
 * so the caller can echo them — an operator who sees a marker whose
 * purpose reads "production mirror, do not drill" has learned something
 * a bare pass would have hidden.
 */
export async function assertDrillTarget(
  stores: readonly DrillStore[],
  readers: MarkerReaders
): Promise<Partial<Record<DrillStore, DrillTargetMarker>>> {
  const targets = describeTargets();
  const markers: Partial<Record<DrillStore, DrillTargetMarker>> = {};
  for (const store of stores) {
    const marker = await readers[store]();
    if (marker === null) {
      throw new DrillTargetRefusal(store, refusalMessage(store, targets[store]));
    }
    markers[store] = marker;
  }
  return markers;
}

/**
 * Refuses a destructive act that was not confirmed. Called AFTER the
 * plan is echoed, so the first run of a command prints what it would do
 * and exits non-zero; the operator re-runs with the flag once the echo
 * reads correctly.
 */
export function assertConfirmed(options: {
  confirmed: boolean;
  flag: string;
  act: string;
}): void {
  if (options.confirmed) return;
  throw new ConfirmationRefusal(
    options.flag,
    `${options.act}\n\n`
    + `  Nothing was written. Re-run with ${options.flag} once the target and\n`
    + `  plan above read correctly.`
  );
}

/**
 * The pre-write echo every gated drill prints: which databases are about
 * to be written, and on whose authority.
 */
export function printTargetBanner(
  stores: readonly DrillStore[],
  markers: Partial<Record<DrillStore, DrillTargetMarker>>
): void {
  const targets = describeTargets();
  console.log('Drill target:');
  for (const store of stores) {
    const marker = markers[store];
    console.log(`  ${store.padEnd(9)} ${targets[store]}`);
    if (marker) {
      console.log(`  ${' '.repeat(9)} marked "${marker.purpose}" by ${marker.markedBy} at ${marker.markedAt}`);
    }
  }
}

/**
 * Shared exit handling for a gated drill: a refusal is an ordinary,
 * quiet exit 2 (the operator did nothing wrong by being careful), while
 * a genuine failure keeps its stack.
 */
export function reportRefusal(error: unknown): number | null {
  if (error instanceof DrillTargetRefusal) {
    console.error(`\nREFUSED: ${error.message}`);
    return 2;
  }
  if (error instanceof ConfirmationRefusal) {
    console.error(`\nREFUSED: ${error.message}`);
    return 2;
  }
  return null;
}
