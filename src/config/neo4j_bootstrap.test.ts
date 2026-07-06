import { describe, it, expect } from 'vitest';
import { ensureNeo4jConstraints, NEO4J_CONSTRAINT_CYPHER, BootstrapDriver } from './neo4j_bootstrap';

// Pins the concurrent-bootstrap fix: both app containers run db:init
// against a fresh graph simultaneously, and concurrent CREATE
// CONSTRAINT IF NOT EXISTS calls can deadlock
// (Neo.TransientError.Transaction.DeadlockDetected — observed in CI).
// The bootstrap must therefore go through executeWrite, whose managed
// transaction function the driver retries on transient errors. A
// regression back to a bare session.run gets one attempt and fails
// the container on a race that would succeed moments later.

function makeFakeDriver(behavior: { failuresBeforeSuccess?: number } = {}) {
  const calls = { executeWrite: 0, ranQueries: [] as string[], closed: 0 };
  let remainingFailures = behavior.failuresBeforeSuccess ?? 0;
  const driver: BootstrapDriver = {
    session: () => ({
      // Mimics the driver's retry contract: a transient failure inside
      // the work function is retried by executeWrite itself, so from
      // the caller's perspective the promise still resolves.
      executeWrite: async work => {
        calls.executeWrite++;
        for (;;) {
          try {
            if (remainingFailures > 0) {
              remainingFailures--;
              throw Object.assign(new Error('deadlock'), {
                code: 'Neo.TransientError.Transaction.DeadlockDetected'
              });
            }
            return await work({ run: (query: string) => { calls.ranQueries.push(query); return {}; } });
          } catch (err: any) {
            if (String(err.code).startsWith('Neo.TransientError.')) continue;
            throw err;
          }
        }
      },
      close: async () => { calls.closed++; }
    })
  };
  return { driver, calls };
}

describe('ensureNeo4jConstraints', () => {
  it('runs the Entity uniqueness constraint through executeWrite and closes the session', async () => {
    const { driver, calls } = makeFakeDriver();
    await ensureNeo4jConstraints(driver);
    expect(calls.executeWrite).toBe(1);
    expect(calls.ranQueries).toEqual([NEO4J_CONSTRAINT_CYPHER]);
    expect(calls.closed).toBe(1);
  });

  it('survives transient deadlocks because the managed transaction retries them', async () => {
    const { driver, calls } = makeFakeDriver({ failuresBeforeSuccess: 2 });
    await expect(ensureNeo4jConstraints(driver)).resolves.toBeUndefined();
    expect(calls.ranQueries).toEqual([NEO4J_CONSTRAINT_CYPHER]);
    expect(calls.closed).toBe(1);
  });

  it('closes the session even when the write ultimately fails', async () => {
    const calls = { closed: 0 };
    const driver: BootstrapDriver = {
      session: () => ({
        executeWrite: async () => { throw new Error('SecurityError: not allowed'); },
        close: async () => { calls.closed++; }
      })
    };
    await expect(ensureNeo4jConstraints(driver)).rejects.toThrow('not allowed');
    expect(calls.closed).toBe(1);
  });

  it('constraint text is the idempotent IF NOT EXISTS form', () => {
    expect(NEO4J_CONSTRAINT_CYPHER).toContain('IF NOT EXISTS');
    expect(NEO4J_CONSTRAINT_CYPHER).toContain('(e:Entity) REQUIRE e.id IS UNIQUE');
  });
});
