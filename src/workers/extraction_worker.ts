import { Worker, Job } from 'bullmq';
import { connectionParams } from './queue.js';
import { neo4jDriver, pgPool } from '../config/db.js';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { GraphSchema, Graph } from '../core/graph/schemas.js';
import { mergeExtractedGraph } from '../core/graph/extraction_merge.js';
import { isAstNodeLive } from '../core/ast/registry.js';
import { config } from '../config/index.js';
import * as crypto from 'crypto';

const openai = new OpenAI();

async function processJob(job: Job) {
  const { astNodeId, text } = job.data;

  // Liveness gate: if a newer re-ingest superseded this block while the
  // job sat in the queue, its bytes are already (or about to be) orphaned
  // — extracting from them would re-derive facts the quarantine sweep is
  // contesting, and pay an LLM call for it. Skipping keeps the merge's
  // "incoming provenance is live" invariant (see extraction_merge.ts).
  if (!(await isAstNodeLive(pgPool, astNodeId))) {
    console.log(
      `[Job ${job.id}] AST Node ${astNodeId} is no longer in any document's latest version — skipping (superseded by a newer re-ingest).`
    );
    return;
  }

  console.log(`[Job ${job.id}] Extracting graph for AST Node: ${astNodeId}`);

  const promptData = `Extract the entities and actions from the following text. Map the provided AST Node ID to the 'sourceNodeIds' array. Extract ONLY the most critical, macro-level business entities and relationships. Be extremely sparse to avoid graph bloat.\n\n--- Text ---\nContent: ${text}\nAST Node ID: ${astNodeId}`;

  const completion = await openai.chat.completions.create({
    model: config.llm.extractionModel,
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

  // 3. Database Insertion (Neo4j). The merge Cypher lives in
  // extraction_merge.ts; its ON MATCH clauses re-derive quarantined facts
  // (contested clears, dead provenance stays in orphanedSourceIds as
  // audit) with semantics that commute with the invalidation sweep.
  try {
    await mergeExtractedGraph(neo4jDriver, graph.entities, enrichedActions);
    console.log(`[Job ${job.id}] Successfully merged ${graph.entities.length} entities and ${enrichedActions.length} actions into Neo4j.`);
  } catch (error) {
    console.error(`[Job ${job.id}] Error during Neo4j transaction`, error);
    throw error;
  }

  // 4. Generate Embeddings & Update PostgreSQL
  console.log(`[Job ${job.id}] Generating embeddings for AST Node: ${astNodeId}`);
  try {
    const embedRes = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });
    const embedding = embedRes.data[0].embedding;

    const pgClient = await pgPool.connect();
    try {
      await pgClient.query(`
        UPDATE ast_nodes
        SET embedding = $1
        WHERE id = $2
      `, [JSON.stringify(embedding), astNodeId]);
      console.log(`[Job ${job.id}] Successfully saved embedding for AST Node: ${astNodeId} in PostgreSQL.`);
    } finally {
      pgClient.release();
    }
  } catch (error) {
    console.error(`[Job ${job.id}] Error generating or saving embeddings:`, error);
    throw error;
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
