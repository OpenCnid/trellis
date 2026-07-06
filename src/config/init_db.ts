import { pgPool, neo4jDriver } from './db.js';
import { POSTGRES_SCHEMA_SQL } from './schema.js';
import { runInitializationTasks } from '../core/runtime/database_init.js';

async function initializeDatabases(): Promise<void> {
  console.log('Initializing database schemas...');

  const initialization = await runInitializationTasks([
    {
      name: 'postgres',
      run: async () => {
        const client = await pgPool.connect();
        try {
          await client.query(POSTGRES_SCHEMA_SQL);
          console.log('[PASS] PostgreSQL: tables, indexes, and search functions created/verified.');
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
          console.log('[PASS] Neo4j: Entity ID uniqueness constraint created/verified.');
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
    console.log('Schemas successfully initialized on all databases.');
    return;
  }

  console.warn(JSON.stringify({
    event: 'database.initialization_incomplete',
    failures,
  }));
  process.exitCode = 1;
}

void initializeDatabases().catch(error => {
  console.warn(JSON.stringify({
    event: 'database.initialization_crashed',
    errorType: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
});
