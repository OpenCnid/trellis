import { Worker, Job } from 'bullmq';
import { connectionParams } from './queue.js';
import { neo4jDriver, pgPool } from '../config/db.js';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { GraphSchema, Graph } from '../core/graph/schemas.js';
import { mergeExtractedGraph } from '../core/graph/extraction_merge.js';
import { resolveExtractedGraph } from '../core/graph/resolve_actions.js';
import { parseLlmResponse } from '../core/llm/boundary.js';
import { isAstNodeLive } from '../core/ast/registry.js';
import { mergeWithAstLivenessFence } from '../core/graph/extraction_liveness.js';
import { sweepOrphanedProvenance, type SweepResult } from '../core/graph/invalidation.js';
import { config } from '../config/index.js';
import { withWorkerRetryPolicy } from '../core/async/retry.js';
import {
  installShutdownSignalHandlers,
  shutdownCoordinator,
} from '../core/runtime/shutdown.js';
import { loggerFor, type Logger } from '../core/observability/logger.js';
import { getMetrics } from '../core/observability/metrics.js';
import { instrumentWorker } from '../core/observability/worker_metrics.js';
import { chatUsage, embeddingUsage, recordEmbeddingCall, recordLlmCall } from '../core/observability/llm_usage.js';

const openai = new OpenAI();
const log = loggerFor({ worker: 'extraction', queue: 'extraction_queue' });
const metrics = getMetrics();

const EMBEDDING_MODEL = 'text-embedding-3-small';

function jobLogger(job: Job): Logger {
  const { astNodeId, requestId, docKey, version } = job.data;
  return log.child({
    jobId: job.id,
    attempt: job.attemptsMade + 1,
    astNodeId,
    // Ingest correlation (optional: pre-T16 jobs and scripts omit it).
    ...(requestId && { requestId }),
    ...(docKey && { docKey }),
    ...(version !== undefined && { version }),
  });
}

async function processJob(job: Job) {
  const { astNodeId, text } = job.data;
  const jobLog = jobLogger(job);

  // Liveness gate: if a newer re-ingest superseded this block while the
  // job sat in the queue, its bytes are already (or about to be) orphaned
  // — extracting from them would re-derive facts the quarantine sweep is
  // contesting, and pay an LLM call for it. Skipping keeps the merge's
  // "incoming provenance is live" invariant (see extraction_merge.ts).
  if (!(await isAstNodeLive(pgPool, astNodeId))) {
    const compensation = await sweepOrphanedProvenance(neo4jDriver, [astNodeId]);
    metrics.extractionSupersededTotal.inc({ stage: 'before_start' });
    jobLog.warn({
      event: 'extraction.superseded_before_start',
      compensation,
    });
    return;
  }

  jobLog.info({ event: 'extraction.started' });

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
  recordLlmCall(metrics, 'extraction', config.llm.extractionModel, chatUsage(completion));

  // A structurally invalid completion throws LlmResponseError here, failing
  // the job into BullMQ's retry flow — a fresh completion usually parses.
  const graph: Graph = parseLlmResponse(
    GraphSchema,
    completion.choices[0].message.content,
    `extraction job ${job.id} (AST node ${astNodeId})`
  );

  // 2. Resolve local UUIDs to global deterministic hashes. Unresolved
  // endpoints are still submitted (the raw id doubles as a name that can
  // match a pre-existing entity) but never dropped silently.
  const { entities, actions, unresolved } = resolveExtractedGraph(graph);
  for (const u of unresolved) {
    metrics.extractionUnresolvedEndpointsTotal.inc();
    jobLog.warn({
      event: 'extraction.unresolved_action_endpoint',
      actionId: u.actionId,
      verb: u.verb,
      subjectId: u.subjectId,
      objectId: u.objectId,
      unresolved: u.unresolved,
    });
  }

  // 3. Database Insertion (Neo4j). The merge Cypher lives in
  // extraction_merge.ts; its ON MATCH clauses re-derive quarantined facts
  // (contested clears, dead provenance stays in orphanedSourceIds as
  // audit) with semantics that commute with the invalidation sweep.
  try {
    let compensation: SweepResult | undefined;
    const mergeOutcome = await mergeWithAstLivenessFence(
      () => isAstNodeLive(pgPool, astNodeId),
      () => mergeExtractedGraph(neo4jDriver, entities, actions),
      async () => {
        compensation = await sweepOrphanedProvenance(neo4jDriver, [astNodeId]);
      }
    );
    if (mergeOutcome.status === 'skipped') {
      metrics.extractionSupersededTotal.inc({ stage: 'before_merge' });
      jobLog.warn({
        event: 'extraction.superseded_before_merge',
        compensation,
      });
      return;
    }

    const merge = mergeOutcome.value;
    const mergedIds = new Set(merge.mergedActionIds);
    const droppedActions = actions.filter(a => !mergedIds.has(a.id));
    for (const a of droppedActions) {
      metrics.extractionDroppedActionsTotal.inc();
      jobLog.warn({
        event: 'extraction.action_dropped',
        actionId: a.id,
        verb: a.verb,
        subjectName: a.subjectName,
        objectName: a.objectName,
        reason: 'no Entity node matched the subject or object name during merge',
      });
    }
    jobLog.info({
      event: 'extraction.merged',
      entities: entities.length,
      actionsSubmitted: actions.length,
      actionsMerged: actions.length - droppedActions.length,
      actionsDropped: droppedActions.length,
    });
    if (mergeOutcome.status === 'compensated') {
      metrics.extractionSupersededTotal.inc({ stage: 'post_merge_compensated' });
      jobLog.warn({
        event: 'extraction.raced_invalidation_compensated',
        compensation,
      });
      return;
    }
  } catch (error) {
    jobLog.error({
      event: 'extraction.merge_failed',
      err: error instanceof Error ? error : new Error(String(error)),
    });
    throw error;
  }

  // 4. Generate Embeddings & Update PostgreSQL
  try {
    const embedRes = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
    });
    recordEmbeddingCall(metrics, 'extraction_embedding', EMBEDDING_MODEL, embeddingUsage(embedRes));
    const embedding = embedRes.data[0].embedding;

    const pgClient = await pgPool.connect();
    try {
      await pgClient.query(`
        UPDATE ast_nodes
        SET embedding = $1
        WHERE id = $2
      `, [JSON.stringify(embedding), astNodeId]);
      jobLog.info({ event: 'extraction.embedding_saved' });
    } finally {
      pgClient.release();
    }
  } catch (error) {
    jobLog.error({
      event: 'extraction.embedding_failed',
      err: error instanceof Error ? error : new Error(String(error)),
    });
    throw error;
  }
}

export const worker = new Worker(
  'extraction_queue',
  job => withWorkerRetryPolicy(
    {
      worker: 'extraction',
      jobId: job.id,
      attempt: job.attemptsMade + 1,
    },
    () => processJob(job)
  ),
  connectionParams
);
instrumentWorker(worker, { worker: 'extraction', queue: 'extraction_queue' }, metrics);

worker.on('completed', job => {
  log.info({ event: 'extraction.job_completed', jobId: job.id });
});

worker.on('failed', (job, err) => {
  log.warn({ event: 'extraction.job_failed', jobId: job?.id, err });
});

log.info({ event: 'extraction.worker_started' });

installShutdownSignalHandlers();
shutdownCoordinator.register('worker.extraction', 80, () => worker.close());
