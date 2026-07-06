import { pgPool, neo4jDriver } from './db.js';
import { POSTGRES_SCHEMA_SQL } from './schema.js';
import { runInitializationTasks } from '../core/runtime/database_init.js';
import { loggerFor } from '../core/observability/logger.js';

const log = loggerFor({ component: 'database_init' });

async function initializeDatabases(): Promise<void> {
  log.info({ event: 'database.initialization_started' });

  const initialization = await runInitializationTasks([
    {
      name: 'postgres',
      run: async () => {
        const client = await pgPool.connect();
        try {
          await client.query(POSTGRES_SCHEMA_SQL);
          log.info({ event: 'database.postgres_schema_ready' });
        } finally {
          client.release();
        }
      },
    },
    {
      name: 'neo4j',
      run: async () => {
        const session = neo4jDriver.session();
        try {
          await session.run(
            'CREATE CONSTRAINT IF NOT EXISTS FOR (e:Entity) REQUIRE e.id IS UNIQUE'
          );
          log.info({ event: 'database.neo4j_constraints_ready' });
        } finally {
          await session.close();
        }
      },
    },
  ]);

  const cleanup = await runInitializationTasks([
    { name: 'postgres.close', run: () => pgPool.end() },
    { name: 'neo4j.close', run: () => neo4jDriver.close() },
  ]);
  const failures = [...initialization.failures, ...cleanup.failures];

  if (failures.length === 0) {
    log.info({ event: 'database.initialization_completed' });
    return;
  }

  log.warn({
    event: 'database.initialization_incomplete',
    failures,
  });
  process.exitCode = 1;
}

void initializeDatabases().catch(error => {
  log.warn({
    event: 'database.initialization_crashed',
    errorType: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
