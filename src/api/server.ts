import express from 'express';
import { parseMarkdownToAST, parseUnstructuredJSONToAST, ASTNode } from '../core/ast/parser.js';
import { flattenAST, nodeText, collectExtractionBlocks } from '../core/ast/traverse.js';
import { diffVersions, MerkleDiff } from '../core/ast/diff.js';
import { registerDocumentVersion, recordDocumentNodes, VersionRegistration } from '../core/ast/registry.js';
import { pgPool, neo4jDriver } from '../config/db.js';
import { config } from '../config/index.js';
import { extractionQueue, rlmQueue, invalidationQueue } from '../workers/queue.js';
import multer from 'multer';
import { execFile } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs/promises';
import OpenAI from 'openai';
import { apiKeyMiddleware } from './auth.js';
import { StreamGate } from './stream_gate.js';
import {
  buildExtractionJobs,
  persistAstNodes,
  verifyPersistedAstNodes,
} from '../core/ast/persist.js';
import {
  installShutdownSignalHandlers,
  shutdownCoordinator,
} from '../core/runtime/shutdown.js';

const execFileAsync = util.promisify(execFile);

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
// Authentication before body parsing: unauthorized requests are refused
// before any bytes are buffered or databases touched.
app.use(apiKeyMiddleware(config.api.apiKey));
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
    
    // Flatten AST
    const allNodes = flattenAST(rootNode);

    // Document identity (Phase 4): a doc_key ties versions of the same
    // document together. Without one, the root hash is the key — every
    // anonymous ingest is version 1 of its own document.
    const docKeyRaw = typeof req.query.doc_key === 'string'
      ? req.query.doc_key
      : (req.file && typeof (req.body as any)?.doc_key === 'string' ? (req.body as any).doc_key : undefined);
    const docKey = docKeyRaw?.trim() || rootNode.id;

    // 2. Persist AST + version membership + registry row in one transaction
    let registration: VersionRegistration;
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      await persistAstNodes(client, rootNode.id, allNodes);
      // T15 verified ingestion: read the immutable rows back and re-derive
      // every id through parser.ts before registry state can commit. A
      // missing/corrupt/conflicting row rolls the entire version back.
      await verifyPersistedAstNodes(client, allNodes);
      await recordDocumentNodes(client, rootNode.id, allNodes.map(n => n.id));
      registration = await registerDocumentVersion(client, docKey, rootNode.id);
      await client.query('COMMIT');
    } catch (dbErr) {
      await client.query('ROLLBACK');
      throw dbErr;
    } finally {
      client.release();
    }

    // 3. Merkle diff against the prior version. Shared subtree hashes are
    // skipped entirely; only genuinely new leaf nodes enter the
    // extraction queue. Byte-identical re-ingest yields an empty diff
    // and queues nothing.
    let diff: MerkleDiff | null = null;
    if (registration.priorRootHash) {
      diff = await diffVersions(pgPool, registration.priorRootHash, rootNode.id);
    }

    // 4. One extraction job per block-level node (T2). Blocks
    // (paragraph, heading, list item, code, PDF element) carry their
    // full reconstructed inline text, so `Globex **acquired** Initech`
    // is one extraction unit instead of three inline fragments. On
    // re-ingest only blocks new to this version are queued — a changed
    // inline leaf changes its parent block's Merkle hash, so the block
    // lands in diff.added.
    const addedSet = diff ? new Set(diff.added) : null;
    const extractionBlocks = collectExtractionBlocks(rootNode)
      .map(block => ({ block, text: nodeText(block) }))
      .filter(({ block, text }) =>
        text.trim().length > 0 && (!addedSet || addedSet.has(block.id))
      );

    if (diff && diff.orphaned.length > 0) {
      // Quarantine sweep (Milestone 3): facts derived from bytes that
      // vanished in this version get contested by the worker. The queued
      // extraction blocks travel along as the sweep's fresh set: the
      // sweep and the extraction jobs race, and a fact re-extracted from
      // this version's live bytes must stay recovered whichever write
      // lands last (src/core/graph/provenance.ts).
      await invalidationQueue.add('sweep', {
        docKey,
        oldVersion: registration.version - 1,
        newVersion: registration.version,
        orphanedHashes: diff.orphaned,
        freshHashes: extractionBlocks.map(({ block }) => block.id)
      });
      console.log(`[Ingest] ${docKey} v${registration.version}: queued invalidation sweep for ${diff.orphaned.length} orphaned node(s).`);
    }

    if (extractionBlocks.length > 0) {
      await extractionQueue.addBulk(buildExtractionJobs(extractionBlocks));
    }

    // 5. Respond with 202 Accepted, the Root AST Node ID, and diff telemetry
    res.status(202).json({
      message: 'Accepted',
      rootId: rootNode.id,
      docKey: registration.docKey,
      version: registration.version,
      totalNodes: allNodes.length,
      blocksQueued: extractionBlocks.length,
      diff: diff
        ? { added: diff.added.length, orphaned: diff.orphaned.length, retained: diff.retained.length }
        : null
    });
  } catch (error: any) {
    console.error("Error during ingestion:", error);
    res.status(500).json({ error: error.message });
  } finally {
    // Uploads are parse-once inputs; never let them accumulate (T6).
    if (req.file) {
      await fs.unlink(req.file.path).catch(err =>
        console.warn(`[Ingest] Failed to delete upload ${req.file?.path}: ${err.message}`)
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

  const session = neo4jDriver.session();
  let sourceNodeIds = new Set<string>();
  let graphData: any[] = [];
  try {
    const neoRes = await session.run(`
      MATCH (e:Entity)-[rel:ACTION|CONTRADICTS]-(neighbor:Entity)
      WHERE e.name = toLower($entityName)
        AND ($includeContested OR coalesce(rel.contested, false) = false)
      RETURN e, rel, neighbor
      UNION
      MATCH (e:Entity)-[:ACTION|CONTRADICTS]-(neighbor:Entity)-[rel:CONTRADICTS]-(neighbor_of_neighbor:Entity)
      WHERE e.name = toLower($entityName)
        AND ($includeContested OR coalesce(rel.contested, false) = false)
      RETURN neighbor AS e, rel, neighbor_of_neighbor AS neighbor
    `, { entityName, includeContested });

    for (const record of neoRes.records) {
      const e = record.get('e').properties;
      const rRaw = record.get('rel');
      const r = { type: rRaw.type, ...rRaw.properties };
      const neighbor = record.get('neighbor').properties;
      graphData.push({ e, r, neighbor });

      e.sourceNodeIds?.forEach((id: string) => sourceNodeIds.add(id));
      r.sourceNodeIds?.forEach((id: string) => sourceNodeIds.add(id));
      neighbor.sourceNodeIds?.forEach((id: string) => sourceNodeIds.add(id));
    }
  } catch (error) {
    console.error("Neo4j retrieve error:", error);
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
      console.log(`[Retrieve] No graph matches for '${entityName}'. Triggering Vector Fallback.`);
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
    console.error("Postgres retrieve error:", error);
    return res.status(500).json({ error: 'Postgres retrieve error' });
  } finally {
    pgClient.release();
  }

  return res.json({
    graph: graphData,
    provenance,
    fallback_active
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
    console.error('Failed to read rlm_queue depth:', err);
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
      console.error('Failed to subscribe to redis channel:', err);
      res.end();
      return;
    }

    // Once subscribed, enqueue the job. A failed enqueue must reach the
    // client — previously it was fire-and-forget and the SSE stream hung
    // forever with no event.
    rlmQueue.add('rlm_job', { query, jobId }).catch(enqueueErr => {
      console.error(`Failed to enqueue RLM job ${jobId}:`, enqueueErr);
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

// Body-size violations from express.text surface here; everything else
// unexpected becomes a JSON 500 instead of the default HTML error page.
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: `Request body exceeds the ${config.ingest.maxBodyMb} MB limit` });
  }
  console.error('[API] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

export const server = app.listen(config.api.port, () => {
  console.log(`Trellis API Server running on port ${config.api.port}`);
});

installShutdownSignalHandlers();
shutdownCoordinator.register('api.server', 100, () => new Promise<void>((resolve, reject) => {
  server.close(error => error ? reject(error) : resolve());
}));
