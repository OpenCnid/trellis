// Neo4j schema bootstrap, extracted from init_db.ts so the retry
// behavior is importable and unit-testable without the script's
// side effects.
//
// Both app containers run the idempotent db:init concurrently
// (Compose starts api and workers together). The PostgreSQL half is
// serialized by pg_advisory_xact_lock (schema.ts); the Neo4j half
// cannot share that lock, and concurrent `CREATE CONSTRAINT IF NOT
// EXISTS` calls can deadlock on the label lock
// (Neo.TransientError.Transaction.DeadlockDetected — observed in CI
// when both containers hit a fresh graph simultaneously). Transient
// errors are retriable by contract, so the bootstrap MUST run inside
// a transaction function (executeWrite), which the driver retries
// with backoff — a plain session.run gets exactly one attempt and
// fails the whole container on a race that would succeed a moment
// later.

export const NEO4J_CONSTRAINT_CYPHER =
  'CREATE CONSTRAINT IF NOT EXISTS FOR (e:Entity) REQUIRE e.id IS UNIQUE';

// Structural subset of neo4j-driver's Session/Driver, so tests can
// inject fakes without a database.
interface WriteSession {
  executeWrite<T>(work: (tx: { run(query: string): unknown }) => T | Promise<T>): Promise<T>;
  close(): Promise<unknown>;
}

export interface BootstrapDriver {
  session(): WriteSession;
}

/** Creates the Entity uniqueness constraint, retrying transient
 *  failures (deadlocks, leader switches) via the driver's managed
 *  transaction function. Idempotent. */
export async function ensureNeo4jConstraints(driver: BootstrapDriver): Promise<void> {
  const session = driver.session();
  try {
    await session.executeWrite(tx => tx.run(NEO4J_CONSTRAINT_CYPHER));
  } finally {
    await session.close();
  }
}
