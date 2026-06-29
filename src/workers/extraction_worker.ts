import { Worker, Job } from 'bullmq';
import { connectionParams } from './queue.js';
import { neo4jDriver } from '../config/db.js';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { GraphSchema, Graph } from '../core/graph/schemas.js';
import * as crypto from 'crypto';

const openai = new OpenAI();

async function processJob(job: Job) {
  const { astNodeId, text } = job.data;
  console.log(`[Job ${job.id}] Extracting graph for AST Node: ${astNodeId}`);

  const promptData = `Extract the entities and actions from the following text. Map the provided AST Node ID to the 'sourceNodeIds' array. Extract ONLY the most critical, macro-level business entities and relationships. Be extremely sparse to avoid graph bloat.\n\n--- Text ---\nContent: ${text}\nAST Node ID: ${astNodeId}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-5.4-mini-2026-03-17",
    messages: [
      { role: "system", content: "You are an expert GraphRAG extraction engine that strictly outputs sparse, high-level business logic graphs." },
      { role: "user", content: promptData }
    ],
    response_format: zodResponseFormat(GraphSchema, "graph_extraction"),
    temperature: 0.1,
  });

  const rawContent = completion.choices[0].message.content;
  if (!rawContent) throw new Error("No content returned from LLM");
  
  const graph: Graph = JSON.parse(rawContent);

  // 2. Resolve UUIDs to global deterministic hashes
  const localToGlobalMap = new Map<string, string>();
  const entityNameMap = new Map<string, string>();
  
  for (const ent of graph.entities) {
    const globalId = crypto.createHash('sha256').update(ent.name.toLowerCase()).digest('hex');
    localToGlobalMap.set(ent.id, globalId);
    entityNameMap.set(ent.id, ent.name);
    ent.id = globalId; // Replace the entity's ID with globalId
  }

  const enrichedActions = graph.actions.map(act => {
    return {
      ...act,
      subjectId: localToGlobalMap.get(act.subjectId) || act.subjectId,
      objectId: localToGlobalMap.get(act.objectId) || act.objectId,
      subjectName: entityNameMap.get(act.subjectId) || act.subjectId,
      objectName: entityNameMap.get(act.objectId) || act.objectId
    };
  });

  // 3. Database Insertion (Neo4j)
  const session = neo4jDriver.session();
  try {
    const tx = session.beginTransaction();
    
    // The Entity Cypher Query
    const entityQuery = `
      UNWIND $entities AS ent
      MERGE (e:Entity {name: toLower(ent.name)})
      ON CREATE SET e.id = ent.id, e.type = ent.type, e.sourceNodeIds = ent.sourceNodeIds
      ON MATCH SET e.sourceNodeIds = e.sourceNodeIds + [id IN ent.sourceNodeIds WHERE NOT id IN e.sourceNodeIds]
    `;
    await tx.run(entityQuery, { entities: graph.entities });

    // The Action Cypher Query
    const actionQuery = `
      UNWIND $actions AS act
      MATCH (subj:Entity {name: toLower(act.subjectName)})
      MATCH (obj:Entity {name: toLower(act.objectName)})
      MERGE (subj)-[r:ACTION {verb: toLower(act.verb)}]->(obj)
      ON CREATE SET r.id = act.id, r.sourceNodeIds = act.sourceNodeIds
      ON MATCH SET r.sourceNodeIds = r.sourceNodeIds + [id IN act.sourceNodeIds WHERE NOT id IN r.sourceNodeIds]
    `;
    await tx.run(actionQuery, { actions: enrichedActions });

    await tx.commit();
    console.log(`[Job ${job.id}] Successfully merged ${graph.entities.length} entities and ${enrichedActions.length} actions into Neo4j.`);
  } catch (error) {
    console.error(`[Job ${job.id}] Error during Neo4j transaction`, error);
    throw error;
  } finally {
    await session.close();
  }
}

export const worker = new Worker('extraction_queue', processJob, connectionParams);

worker.on('completed', job => {
  console.log(`[Job ${job.id}] Finished perfectly.`);
});

worker.on('failed', (job, err) => {
  console.log(`[Job ${job?.id}] Failed: ${err.message}`);
});

console.log("Extraction Worker started and listening for jobs...");
