import express from 'express';
import { parseMarkdownToAST, parseUnstructuredJSONToAST, ASTNode } from '../core/ast/parser.js';
import { pgPool, neo4jDriver } from '../config/db.js';
import { config } from '../config/index.js';
import { extractionQueue, rlmQueue, invalidationQueue, agentQueue } from '../workers/queue.js';
import { OracleScriptSchema, type OracleScript } from '../core/agent/oracle.js';
import { isTerminalAgentEvent } from '../core/agent/goal_loop.js';
import multer from 'multer';
import { execFile } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs/promises';
import OpenAI from 'openai';
import { apiKeyMiddleware } from './auth.js';
import { StreamGate } from './stream_gate.js';
import { ingestDocument } from '../core/ingestion/ingest_document.js';
import {
  installShutdownSignalHandlers,
  shutdownCoordinator,
} from '../core/runtime/shutdown.js';
import { healthHandler } from './health.js';
import { expandAliases, type ResolvedAlias } from '../core/graph/alias_resolution.js';
import { loggerFor, type Logger } from '../core/observability/logger.js';
import { getMetrics } from '../core/observability/metrics.js';
import { httpMetricsMiddleware, normalizeRoute } from '../core/observability/http_metrics.js';

const execFileAsync = util.promisify(execFile);

const log = loggerFor({ component: 'api' });
const metrics = getMetrics();

/** Request-scoped child logger bound by the observability middleware. */
function requestLogger(res: express.Response): Logger {
  return (res.locals.log as Logger | undefined) ?? log;
}

// Upload limits (T6): PDFs only, size-capped, single file. The parsed
// upload is deleted after the request (see the /ingest finally block).
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: config.ingest.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const isPdf =
      file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
    if (isPdf) return cb(null, true);
    cb(new Error('Only PDF uploads are accepted'));
  },
});

// Maps multer failures to proper client errors instead of a generic 500.
function uploadPdf(req: express.Request, res: express.Response, next: express.NextFunction) {
  upload.single('file')(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `Upload exceeds the ${config.ingest.maxUploadMb} MB limit` });
    }
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid upload' });
  });
}

const app = express();
// Observability first (T16): every request — including 401s — is counted
// by method/normalized route/status class and carries a requestId that
// ingest threads into queued jobs. Query strings and bodies are never
// logged; /healthz is excluded from request logs so container health
// probes do not flood stdout (it is still counted in metrics).
app.use(httpMetricsMiddleware(metrics));
app.use((req, res, next) => {
  const requestId = crypto.randomUUID();
  res.locals.requestId = requestId;
  res.locals.log = log.child({ requestId });
  res.set('x-request-id', requestId);
  if (req.path !== '/healthz') {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      requestLogger(res).info({
        event: 'http.request_completed',
        method: req.method,
        route: normalizeRoute(req.path),
        status: res.statusCode,
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
      });
    });
  }
  next();
});
// Unauthenticated process liveness for container orchestration. This is
// intentionally not dependency readiness; schema bootstrap gates startup.
app.get('/healthz', (_req, res) => healthHandler(res));
// Authentication before body parsing: unauthorized requests are refused
// before any bytes are buffered or databases touched.
app.use(apiKeyMiddleware(config.api.apiKey));
// Prometheus exposition for the API process (T16). Behind the API key
// like every operational endpoint; the worker container serves its own
// registry on the internal WORKER_METRICS_PORT listener.
app.get('/metrics', async (_req, res) => {
  try {
    const body = await metrics.registry.metrics();
    res.set('Content-Type', metrics.registry.contentType);
    res.send(body);
  } catch (error) {
    requestLogger(res).warn({
      event: 'metrics.exposition_failed',
      err: error instanceof Error ? error : new Error(String(error)),
    });
    res.status(500).json({ error: 'Metrics collection failed' });
  }
});
// Only accept raw text/markdown if content-type is text/*; size-capped (T6).
app.use(express.text({
  type: ['text/*', 'application/json', 'application/x-www-form-urlencoded'],
  limit: `${config.ingest.maxBodyMb}mb`,
}));

app.post('/ingest', uploadPdf, async (req, res) => {
  try {
    let rootNode: ASTNode;
    
    if (req.file) {
      // PDF File Upload Path
      const pythonScript = path.resolve('scripts/parse_pdf.py');
      const { stdout } = await execFileAsync(config.python.executable, [pythonScript, req.file.path], {
        maxBuffer: 1024 * 1024 * 50 // 50MB buffer for large JSON outputs
      });
      
      const elements = JSON.parse(stdout);
      if (elements.error) {
        throw new Error(`Python script error: ${elements.error}\n${elements.traceback || ''}`);
      }
      
      rootNode = parseUnstructuredJSONToAST(elements);
    } else {
      // Raw Markdown String Path
      const markdown = req.body;
      if (!markdown || typeof markdown !== 'string') {
        return res.status(400).send('Expected raw Markdown string in body or a file upload');
      }
      rootNode = parseMarkdownToAST(markdown);
    }
    
    // Document identity (Phase 4): a doc_key ties versions of the same
    // document together. Without one, the root hash is the key — every
    // anonymous ingest is version 1 of its own document.
    const docKeyRaw = typeof req.query.doc_key === 'string'
      ? req.query.doc_key
      : (req.file && typeof (req.body as any)?.doc_key === 'string' ? (req.body as any).doc_key : undefined);
    const docKey = docKeyRaw?.trim() || rootNode.id;

    // The verified ingest transaction, Merkle diff, invalidation enqueue,
    // and extraction fan-out live in the ingest service (Session 8), which
    // the repository CLI shares. The API keeps its pre-Session-8 policy:
    // extract every changed block, no budget.
    const result = await ingestDocument(
      {
        pgPool,
        queues: { extraction: extractionQueue, invalidation: invalidationQueue },
        log: requestLogger(res),
      },
      {
        rootNode,
        docKey,
        extractionPolicy: { mode: 'changed' },
        requestId: res.locals.requestId as string | undefined,
      }
    );

    // Respond with 202 Accepted, the Root AST Node ID, and diff telemetry
    res.status(202).json({ message: 'Accepted', ...result });
  } catch (error: any) {
    requestLogger(res).error({ event: 'ingest.failed', err: error });
    res.status(500).json({ error: error.message });
  } finally {
    // Uploads are parse-once inputs; never let them accumulate (T6).
    if (req.file) {
      await fs.unlink(req.file.path).catch(err =>
        requestLogger(res).warn({ event: 'ingest.upload_cleanup_failed', err })
      );
    }
  }
});

app.get('/retrieve', async (req, res) => {
  const entityName = req.query.entity;
  if (!entityName || typeof entityName !== 'string') {
    return res.status(400).send('Expected entity query parameter');
  }

  // Contested facts (provenance orphaned by a re-ingest) are excluded
  // from retrieval by default; pass ?includeContested=true to inspect
  // the quarantined belief history.
  const includeContested = req.query.includeContested === 'true';
  // Alias expansion (Session 5): the seed entity is widened across
  // non-contested SAME_AS edges at or above RESOLUTION_MIN_CONFIDENCE —
  // one hop — before the traversal. ?resolveAliases=false opts out.
  // includeContested does NOT relax the expansion filter: a contested
  // equivalence never silently widens a result set.
  const resolveAliases = req.query.resolveAliases !== 'false';

  const session = neo4jDriver.session();
  let sourceNodeIds = new Set<string>();
  let graphData: any[] = [];
  let resolvedAliases: ResolvedAlias[] = [];
  try {
    if (resolveAliases) {
      resolvedAliases = await expandAliases(
        neo4jDriver,
        entityName,
        config.resolution.minConfidence
      );
    }
    const aliasNames = resolvedAliases.map(alias => alias.name);
    // viaAlias attributes each fact to the seed-or-alias entity whose
    // neighborhood produced it, so callers can tell alias-contributed
    // facts from the seed's own.
    const neoRes = await session.run(`
      MATCH (e:Entity)-[rel:ACTION|CONTRADICTS]-(neighbor:Entity)
      WHERE (e.name = toLower($entityName) OR e.name IN $aliasNames)
        AND ($includeContested OR coalesce(rel.contested, false) = false)
      RETURN e, rel, neighbor, e.name AS viaAlias
      UNION
      MATCH (e:Entity)-[:ACTION|CONTRADICTS]-(neighbor:Entity)-[rel:CONTRADICTS]-(neighbor_of_neighbor:Entity)
      WHERE (e.name = toLower($entityName) OR e.name IN $aliasNames)
        AND ($includeContested OR coalesce(rel.contested, false) = false)
      RETURN neighbor AS e, rel, neighbor_of_neighbor AS neighbor, e.name AS viaAlias
    `, { entityName, aliasNames, includeContested });

    for (const record of neoRes.records) {
      const e = record.get('e').properties;
      const rRaw = record.get('rel');
      const r = { type: rRaw.type, ...rRaw.properties };
      const neighbor = record.get('neighbor').properties;
      graphData.push({ e, r, neighbor, viaAlias: record.get('viaAlias') });

      e.sourceNodeIds?.forEach((id: string) => sourceNodeIds.add(id));
      r.sourceNodeIds?.forEach((id: string) => sourceNodeIds.add(id));
      neighbor.sourceNodeIds?.forEach((id: string) => sourceNodeIds.add(id));
    }
  } catch (error) {
    requestLogger(res).error({
      event: 'retrieve.neo4j_failed',
      err: error instanceof Error ? error : new Error(String(error)),
    });
    return res.status(500).json({ error: 'Neo4j retrieve error' });
  } finally {
    await session.close();
  }

  const idsArray = Array.from(sourceNodeIds);
  const pgClient = await pgPool.connect();
  let provenance: any[] = [];
  let fallback_active = false;

  try {
    if (idsArray.length === 0) {
      requestLogger(res).info({ event: 'retrieve.vector_fallback', entity: entityName });
      fallback_active = true;
      const openai = new OpenAI();
      const embedRes = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: entityName,
      });
      const queryEmbedding = embedRes.data[0].embedding;

      const pgRes = await pgClient.query(
        'SELECT id, content FROM search_ast_nodes($1::vector, 3)',
        [JSON.stringify(queryEmbedding)]
      );
      provenance = pgRes.rows;
    } else {
      const pgRes = await pgClient.query(`
        SELECT id, data->>'content' as content 
        FROM ast_nodes 
        WHERE id = ANY($1);
      `, [idsArray]);
      provenance = pgRes.rows;
    }
  } catch (error) {
    requestLogger(res).error({
      event: 'retrieve.postgres_failed',
      err: error instanceof Error ? error : new Error(String(error)),
    });
    return res.status(500).json({ error: 'Postgres retrieve error' });
  } finally {
    pgClient.release();
  }

  return res.json({
    graph: graphData,
    provenance,
    fallback_active,
    resolvedAliases
  });
});

import IORedis from 'ioredis';
import crypto from 'crypto';

// Admission control for RLM streams (T6): each stream ultimately spawns
// a Python process making paid LLM calls, so both the number of live SSE
// connections (per-process gate) and the rlm_queue backlog (shared
// backstop) are bounded. Rejected requests get 429 before any resource
// is allocated.
const rlmStreamGate = new StreamGate(config.rlmStream.maxConcurrentStreams);

app.get('/api/rlm-stream', async (req, res) => {
  const query = req.query.query;
  if (!query || typeof query !== 'string') {
    return res.status(400).send('Expected query parameter');
  }

  const release = rlmStreamGate.tryAcquire();
  if (!release) {
    return res.status(429).json({
      error: `Too many concurrent RLM streams (limit ${rlmStreamGate.limit}); retry later.`,
    });
  }

  let queueDepth: number;
  try {
    queueDepth = await rlmQueue.getWaitingCount();
  } catch (err) {
    release();
    requestLogger(res).error({
      event: 'rlm_stream.queue_depth_unavailable',
      queue: 'rlm_queue',
      err: err instanceof Error ? err : new Error(String(err)),
    });
    return res.status(503).json({ error: 'Queue unavailable; retry later.' });
  }
  if (queueDepth >= config.rlmStream.maxQueueDepth) {
    release();
    return res.status(429).json({
      error: `RLM queue is full (${queueDepth} waiting, limit ${config.rlmStream.maxQueueDepth}); retry later.`,
    });
  }

  // Set up SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.flushHeaders();

  const jobId = crypto.randomUUID();
  const redisSubscriber = new IORedis({
    host: config.redis.host,
    port: config.redis.port,
  });

  const channel = `rlm-stream:${jobId}`;

  redisSubscriber.subscribe(channel, (err) => {
    if (err) {
      // The SSE query content is deliberately never logged.
      requestLogger(res).error({
        event: 'rlm_stream.subscribe_failed',
        jobId,
        err,
      });
      res.end();
      return;
    }

    // Once subscribed, enqueue the job. A failed enqueue must reach the
    // client — previously it was fire-and-forget and the SSE stream hung
    // forever with no event.
    rlmQueue.add('rlm_job', { query, jobId }).catch(enqueueErr => {
      requestLogger(res).error({
        event: 'rlm_stream.enqueue_failed',
        queue: 'rlm_queue',
        jobId,
        err: enqueueErr instanceof Error ? enqueueErr : new Error(String(enqueueErr)),
      });
      res.write(`data: ${JSON.stringify({ type: 'error', content: 'Failed to enqueue RLM job; retry later.' })}\n\n`);
      res.end();
    });
  });

  redisSubscriber.on('message', (subChannel, message) => {
    if (subChannel === channel) {
      const data = JSON.parse(message);
      if (data.type === 'done') {
        res.write(`data: ${JSON.stringify({ type: 'done', code: data.code })}\n\n`);
        res.end();
      } else {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    }
  });

  // 'close' on the response fires for both client aborts and normal ends,
  // so the gate slot and the Redis subscriber are always reclaimed.
  res.on('close', () => {
    release();
    try {
      redisSubscriber.unsubscribe(channel).catch(() => {});
      redisSubscriber.quit().catch(() => {});
    } catch (e) {
      // ignore
    }
  });
});

// Admission control for agentic goals (Session 9): a goal drives one or
// more RLM runs plus orchestrator completions, so live goal streams and
// the agent_queue backlog are both bounded, mirroring /api/rlm-stream.
const agentStreamGate = new StreamGate(config.agent.maxConcurrentGoals);

app.get('/api/agent-stream', async (req, res) => {
  const goal = req.query.goal;
  if (!goal || typeof goal !== 'string') {
    return res.status(400).send('Expected goal parameter');
  }

  // Zero-LLM dress-rehearsal scripts are an explicit opt-in surface;
  // production deployments only accept goals.
  let oracle: OracleScript | undefined;
  if (typeof req.query.oracle === 'string') {
    if (!config.agent.oracleEnabled) {
      return res.status(400).json({ error: 'Oracle scripts are disabled (set AGENT_ORACLE_ENABLED=true for drills)' });
    }
    let parsedOracle: unknown;
    try {
      parsedOracle = JSON.parse(req.query.oracle);
    } catch {
      return res.status(400).json({ error: 'oracle parameter is not valid JSON' });
    }
    const validated = OracleScriptSchema.safeParse(parsedOracle);
    if (!validated.success) {
      return res.status(400).json({ error: 'oracle parameter failed validation' });
    }
    oracle = validated.data;
  }

  const release = agentStreamGate.tryAcquire();
  if (!release) {
    return res.status(429).json({
      error: `Too many concurrent agent goals (limit ${agentStreamGate.limit}); retry later.`,
    });
  }

  let queueDepth: number;
  try {
    queueDepth = await agentQueue.getWaitingCount();
  } catch (err) {
    release();
    requestLogger(res).error({
      event: 'agent_stream.queue_depth_unavailable',
      queue: 'agent_queue',
      err: err instanceof Error ? err : new Error(String(err)),
    });
    return res.status(503).json({ error: 'Queue unavailable; retry later.' });
  }
  if (queueDepth >= config.agent.maxQueueDepth) {
    release();
    return res.status(429).json({
      error: `Agent queue is full (${queueDepth} waiting, limit ${config.agent.maxQueueDepth}); retry later.`,
    });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.flushHeaders();

  const goalId = crypto.randomUUID();
  const redisSubscriber = new IORedis({
    host: config.redis.host,
    port: config.redis.port,
  });

  const channel = `agent-stream:${goalId}`;

  redisSubscriber.subscribe(channel, (err) => {
    if (err) {
      // The goal text is deliberately never logged.
      requestLogger(res).error({
        event: 'agent_stream.subscribe_failed',
        goalId,
        err,
      });
      res.end();
      return;
    }

    // Subscribe-then-enqueue, same as the RLM stream: a failed enqueue
    // must reach the client instead of hanging the stream forever.
    agentQueue.add('agent_goal', { goal, goalId, ...(oracle && { oracle }) }).catch(enqueueErr => {
      requestLogger(res).error({
        event: 'agent_stream.enqueue_failed',
        queue: 'agent_queue',
        goalId,
        err: enqueueErr instanceof Error ? enqueueErr : new Error(String(enqueueErr)),
      });
      res.write(`data: ${JSON.stringify({ type: 'error', content: 'Failed to enqueue agent goal; retry later.' })}\n\n`);
      res.end();
    });
  });

  redisSubscriber.on('message', (subChannel, message) => {
    if (subChannel === channel) {
      res.write(`data: ${message}\n\n`);
      try {
        if (isTerminalAgentEvent(JSON.parse(message))) res.end();
      } catch {
        // A malformed event is forwarded as-is; the stream stays open.
      }
    }
  });

  res.on('close', () => {
    release();
    try {
      redisSubscriber.unsubscribe(channel).catch(() => {});
      redisSubscriber.quit().catch(() => {});
    } catch (e) {
      // ignore
    }
  });
});

// Body-size violations from express.text surface here; everything else
// unexpected becomes a JSON 500 instead of the default HTML error page.
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: `Request body exceeds the ${config.ingest.maxBodyMb} MB limit` });
  }
  requestLogger(res).error({
    event: 'api.unhandled_error',
    err: err instanceof Error ? err : new Error(String(err)),
  });
  res.status(500).json({ error: 'Internal server error' });
});

export const server = app.listen(config.api.port, () => {
  log.info({ event: 'api.started', port: config.api.port });
});

installShutdownSignalHandlers();
shutdownCoordinator.register('api.server', 100, () => new Promise<void>((resolve, reject) => {
  server.close(error => error ? reject(error) : resolve());
}));
