import { pgPool, neo4jDriver } from './db.js';
import { POSTGRES_SCHEMA_SQL } from './schema.js';

async function initializeDatabases() {
  console.log("Initializing database schemas...");
  let success = true;

  // Initialize PostgreSQL
  try {
    const pgClient = await pgPool.connect();
    await pgClient.query(POSTGRES_SCHEMA_SQL);
    console.log("[PASS] PostgreSQL: tables, indexes, and search functions created/verified.");
    pgClient.release();
  } catch (err: any) {
    console.error(`[FAIL] PostgreSQL Error: ${err.message}`);
    success = false;
  }

  // Initialize Neo4j
  try {
    const session = neo4jDriver.session();
    await session.run(`
      CREATE CONSTRAINT IF NOT EXISTS FOR (e:Entity) REQUIRE e.id IS UNIQUE;
    `);
    console.log("[PASS] Neo4j: Entity ID uniqueness constraint created/verified.");
    await session.close();
  } catch (err: any) {
    console.error(`[FAIL] Neo4j Error: ${err.message}`);
    success = false;
  }

  if (success) {
    console.log("\nSchemas successfully initialized on all databases.");
  } else {
    console.log("\nSchema initialization failed.");
  }

  await pgPool.end();
  await neo4jDriver.close();
  process.exit(0);
}

initializeDatabases();
