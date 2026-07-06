import { Worker, Job } from 'bullmq';
import { connectionParams } from './queue.js';
import { neo4jDriver, pgPool } from '../config/db.js';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { ConflictEvaluationSchema, ConflictEvaluation } from '../core/graph/schemas.js';
import {
  CONFLICT_ANOMALY_CYPHER,
  CONFLICT_RESOLUTION_CYPHER,
  conflictResolutionParams,
  joinAstTexts,
} from '../core/graph/conflict_resolution.js';
import { parseLlmResponse, LlmResponseError } from '../core/llm/boundary.js';
import { config } from '../config/index.js';
import { withWorkerRetryPolicy } from '../core/async/retry.js';
import {
  installShutdownSignalHandlers,
  shutdownCoordinator,
} from '../core/runtime/shutdown.js';
import { loggerFor } from '../core/observability/logger.js';
import { getMetrics } from '../core/observability/metrics.js';
import { instrumentWorker } from '../core/observability/worker_metrics.js';
import { chatUsage, recordLlmCall } from '../core/observability/llm_usage.js';

const openai = new OpenAI();
const log = loggerFor({ worker: 'supervisor', queue: 'supervisor_queue' });
const metrics = getMetrics();

async function processJob(job: Job) {
  const jobLog = log.child({ jobId: job.id, attempt: job.attemptsMade + 1 });
  jobLog.info({ event: 'supervisor.scan_started' });

  // Structurally invalid evaluations are logged per candidate pair and the
  // scan continues (one bad completion must not block the other pairs), but
  // any failure still fails the job at the end so BullMQ's retry flow
  // re-evaluates the affected pairs — their belief_state is still NULL, so
  // the detection query picks them up again.
  let invalidEvaluations = 0;

  const session = neo4jDriver.session();
  try {
    // Step A: Detection
    const result = await session.run(CONFLICT_ANOMALY_CYPHER);

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
          text1 = joinAstTexts(res1.rows);
        }
        if (sourceNodeIds2.length > 0) {
          const res2 = await pgClient.query('SELECT data FROM ast_nodes WHERE id = ANY($1)', [sourceNodeIds2]);
          text2 = joinAstTexts(res2.rows);
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
      recordLlmCall(metrics, 'supervision', config.llm.extractionModel, chatUsage(completion));

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
          jobLog.warn({
            event: 'supervisor.evaluation_invalid',
            r1ElementId: r1.elementId,
            r2ElementId: r2.elementId,
            stage: err.stage,
            detail: err.message,
            rawSnippet: err.rawSnippet,
          });
          continue;
        }
        throw err;
      }

      if (evaluation.isContradiction) {
        jobLog.info({ event: 'supervisor.contradiction_detected' });
        // Step C: Resolution — branch belief states and record the
        // reasoning as a Conflict node linked to the entities it explains
        // (Cypher and provenance semantics in conflict_resolution.ts).
        const tx = session.beginTransaction();
        try {
          await tx.run(CONFLICT_RESOLUTION_CYPHER, conflictResolutionParams({
            r1Id: r1.elementId,
            r2Id: r2.elementId,
            evaluation,
            r1SourceNodeIds: sourceNodeIds1,
            r2SourceNodeIds: sourceNodeIds2,
          }));

          await tx.commit();
          jobLog.info({ event: 'supervisor.belief_states_branched' });
        } catch (err) {
          await tx.rollback();
          jobLog.error({
            event: 'supervisor.resolution_failed',
            err: err instanceof Error ? err : new Error(String(err)),
          });
          throw err;
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

export const worker = new Worker(
  'supervisor_queue',
  job => withWorkerRetryPolicy(
    {
      worker: 'supervisor',
      jobId: job.id,
      attempt: job.attemptsMade + 1,
    },
    () => processJob(job)
  ),
  connectionParams
);
instrumentWorker(worker, { worker: 'supervisor', queue: 'supervisor_queue' }, metrics);

worker.on('completed', job => {
  log.info({ event: 'supervisor.job_completed', jobId: job.id });
});

worker.on('failed', (job, err) => {
  log.warn({ event: 'supervisor.job_failed', jobId: job?.id, err });
});

log.info({ event: 'supervisor.worker_started' });

installShutdownSignalHandlers();
shutdownCoordinator.register('worker.supervisor', 80, () => worker.close());
