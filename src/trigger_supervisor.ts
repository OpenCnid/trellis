import { supervisorQueue } from './workers/queue.js';
import { pgPool, neo4jDriver } from './config/db.js';
import './workers/supervisor_worker.js';

async function trigger() {
  console.log("Injecting synthetic contradiction into databases...");

  const astId1 = 'conflict_node_1';
  const astId2 = 'conflict_node_2';

  // 1. Insert into PostgreSQL
  const pgClient = await pgPool.connect();
  try {
    await pgClient.query(`
      INSERT INTO ast_nodes (id, document_id, data)
      VALUES ($1, 'doc_test', $2), ($3, 'doc_test', $4)
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
    `, [astId1, { text: "Acme acquired Globex for 1 billion dollars." }, astId2, { text: "Acme acquired Globex for 2 billion dollars." }]);
    console.log("PostgreSQL: Inserted AST nodes.");
  } finally {
    pgClient.release();
  }

  // 2. Insert into Neo4j
  const session = neo4jDriver.session();
  try {
    // Clean up old revenue contradiction
    await session.run(`MATCH (n) WHERE n.id IN ['5m', '10m'] DETACH DELETE n`);
    
    await session.run(`
      MERGE (subj:Entity {id: 'acme_corp', name: 'acme corp'})
      MERGE (obj1:Entity {id: '1b', name: '1 billion'})
      MERGE (obj2:Entity {id: '2b', name: '2 billion'})
      
      MERGE (subj)-[r1:ACTION {verb: 'acquired for'}]->(obj1)
      SET r1.sourceNodeIds = [$astId1]
      
      MERGE (subj)-[r2:ACTION {verb: 'acquired for'}]->(obj2)
      SET r2.sourceNodeIds = [$astId2]
    `, { astId1, astId2 });
    console.log("Neo4j: Inserted contradiction graph.");
  } finally {
    await session.close();
  }

  // 3. Trigger Job
  const job = await supervisorQueue.add('scan_conflicts', {});
  console.log(`Added supervisor job: ${job.id}`);

  // Wait for the worker to process the job and LLM to respond
  console.log("Waiting for LLM Supervisor to process (10 seconds)...");
  await new Promise(resolve => setTimeout(resolve, 10000));

  // 4. Verify and Log
  const verifySession = neo4jDriver.session();
  try {
    const result = await verifySession.run(`
      MATCH (obj1:Entity)-[c:CONTRADICTS]->(obj2:Entity)
      MATCH (subj:Entity)-[r1:ACTION]->(obj1)
      MATCH (subj)-[r2:ACTION]->(obj2)
      RETURN obj1.name AS obj1, obj2.name AS obj2, r1.belief_state AS b1, r2.belief_state AS b2
    `);
    
    console.log("\\n--- Verification Results ---");
    if (result.records.length > 0) {
      for (const record of result.records) {
        console.log(`Conflict detected between "${record.get('obj1')}" and "${record.get('obj2')}"`);
        console.log(`Belief State 1: ${record.get('b1')}`);
        console.log(`Belief State 2: ${record.get('b2')}`);
      }
      console.log("SUCCESS: Belief States successfully branched!");
    } else {
      console.log("FAILED: Could not find CONTRADICTS edge or belief states.");
    }
  } finally {
    await verifySession.close();
  }

  process.exit(0);
}

trigger().catch(console.error);
