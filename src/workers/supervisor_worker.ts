import { Worker, Job } from 'bullmq';
import { connectionParams } from './queue.js';
import { neo4jDriver, pgPool } from '../config/db.js';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { ConflictEvaluationSchema, ConflictEvaluation } from '../core/graph/schemas.js';
import { parseLlmResponse, LlmResponseError } from '../core/llm/boundary.js';
import { config } from '../config/index.js';

const openai = new OpenAI();

async function processJob(job: Job) {
  console.log(`[Job ${job.id}] Scanning for graph conflicts...`);

  // Structurally invalid evaluations are logged per candidate pair and the
  // scan continues (one bad completion must not block the other pairs), but
  // any failure still fails the job at the end so BullMQ's retry flow
  // re-evaluates the affected pairs — their belief_state is still NULL, so
  // the detection query picks them up again.
  let invalidEvaluations = 0;

  const session = neo4jDriver.session();
  try {
    // Step A: Detection
    const anomalyQuery = `
      MATCH (subj:Entity)-[r1:ACTION]->(obj1:Entity)
      MATCH (subj)-[r2:ACTION]->(obj2:Entity)
      WHERE r1.verb = r2.verb AND id(obj1) < id(obj2)
      // Ensure they don't already have a belief state to avoid infinite loops
      AND r1.belief_state IS NULL AND r2.belief_state IS NULL
      RETURN subj, r1, obj1, r2, obj2
    `;
    
    const result = await session.run(anomalyQuery);
    
    for (const record of result.records) {
      const r1 = record.get('r1');
      const r2 = record.get('r2');
      const obj1 = record.get('obj1');
      const obj2 = record.get('obj2');
      
      const sourceNodeIds1 = r1.properties.sourceNodeIds || [];
      const sourceNodeIds2 = r2.properties.sourceNodeIds || [];
      
      // Fetch text from PG
      const pgClient = await pgPool.connect();
      let text1 = "";
      let text2 = "";
      
      try {
        if (sourceNodeIds1.length > 0) {
          const res1 = await pgClient.query('SELECT data FROM ast_nodes WHERE id = ANY($1)', [sourceNodeIds1]);
          text1 = res1.rows.map(row => row.data.value || row.data.text || JSON.stringify(row.data)).join("\\n");
        }
        if (sourceNodeIds2.length > 0) {
          const res2 = await pgClient.query('SELECT data FROM ast_nodes WHERE id = ANY($1)', [sourceNodeIds2]);
          text2 = res2.rows.map(row => row.data.value || row.data.text || JSON.stringify(row.data)).join("\\n");
        }
      } finally {
        pgClient.release();
      }
      
      // Step B: Evaluation
      const promptData = `Evaluate if these two texts represent a contradiction regarding the same entity and action.\n\nText 1: ${text1}\n\nText 2: ${text2}`;
      
      const completion = await openai.chat.completions.create({
        model: config.llm.extractionModel,
        messages: [
          { role: "system", content: "You are an expert graph reasoning engine evaluating logical contradictions in text." },
          { role: "user", content: promptData }
        ],
        response_format: zodResponseFormat(ConflictEvaluationSchema, "conflict_evaluation"),
        temperature: 0.1,
      });

      let evaluation: ConflictEvaluation;
      try {
        evaluation = parseLlmResponse(
          ConflictEvaluationSchema,
          completion.choices[0].message.content,
          `conflict evaluation (job ${job.id})`
        );
      } catch (err) {
        if (err instanceof LlmResponseError) {
          invalidEvaluations++;
          console.warn(JSON.stringify({
            event: 'supervisor.evaluation_invalid',
            jobId: job.id,
            r1ElementId: r1.elementId,
            r2ElementId: r2.elementId,
            stage: err.stage,
            detail: err.message,
            rawSnippet: err.rawSnippet,
          }));
          continue;
        }
        throw err;
      }

      if (evaluation.isContradiction) {
        console.log(`[Job ${job.id}] Contradiction detected! Branching into Belief States...`);
        // Step C: Resolution
        const tx = session.beginTransaction();
        try {
          const resolutionQuery = `
            MATCH (subj:Entity)-[r1:ACTION]->(obj1:Entity)
            MATCH (subj)-[r2:ACTION]->(obj2:Entity)
            WHERE elementId(r1) = $r1Id AND elementId(r2) = $r2Id
            
            // Create conflict node
            CREATE (c:Conflict { reasoning: $reasoning })
            
            // Create contradictions edges
            MERGE (obj1)-[:CONTRADICTS]->(obj2)
            
            // Assign belief states
            SET r1.belief_state = 'Belief A'
            SET r2.belief_state = 'Belief B'
          `;
          
          await tx.run(resolutionQuery, {
            r1Id: r1.elementId,
            r2Id: r2.elementId,
            reasoning: evaluation.reasoning
          });
          
          await tx.commit();
          console.log(`[Job ${job.id}] Successfully branched belief states.`);
        } catch (err) {
          await tx.rollback();
          console.error("Resolution transaction failed:", err);
        }
      }
    }
  } finally {
    await session.close();
  }

  if (invalidEvaluations > 0) {
    throw new Error(
      `${invalidEvaluations} conflict evaluation(s) returned structurally invalid LLM responses; ` +
      `failing the job so the retry flow re-evaluates the affected pairs.`
    );
  }
}

export const worker = new Worker('supervisor_queue', processJob, connectionParams);

worker.on('completed', job => {
  console.log(`[Job ${job.id}] Scan complete.`);
});

worker.on('failed', (job, err) => {
  console.log(`[Job ${job?.id}] Failed: ${err.message}`);
});

console.log("Supervisor Worker started and listening for jobs...");
