import { pgPool, neo4jDriver } from './config/db.js';

async function verifyDatabases() {
  console.log("Testing connection to Three-Tier Database Architecture...\n");
  let pgSuccess = false;
  let neoSuccess = false;

  // Test PostgreSQL
  try {
    const pgClient = await pgPool.connect();
    const pgRes = await pgClient.query('SELECT 1 as result');
    if (pgRes.rows[0].result === 1) {
      console.log("[PASS] PostgreSQL: Successfully connected to AST Document Store.");
      pgSuccess = true;
    }
    pgClient.release();
  } catch (err: any) {
    console.error(`[FAIL] PostgreSQL Error: ${err.message}`);
  }

  // Test Neo4j
  try {
    const session = neo4jDriver.session();
    const neoRes = await session.run('RETURN 1 as result');
    if (neoRes.records[0].get('result').toInt() === 1) {
      console.log("[PASS] Neo4j: Successfully connected to Semantic Knowledge Graph.");
      neoSuccess = true;
    }
    await session.close();
  } catch (err: any) {
    console.error(`[FAIL] Neo4j Error: ${err.message}`);
  }

  if (pgSuccess && neoSuccess) {
    console.log("\nInfrastructure successfully verified! Trellis MVP is ready.");
  } else {
    console.log("\nInfrastructure verification failed.");
  }

  await pgPool.end();
  await neo4jDriver.close();
  process.exit(0);
}

verifyDatabases();
