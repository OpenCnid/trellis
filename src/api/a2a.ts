import crypto from 'crypto';
import type express from 'express';
import IORedis from 'ioredis';
import { config } from '../config/index.js';
import { agentQueue } from '../workers/queue.js';
import type { StreamGate, ReleaseFn } from './stream_gate.js';
import type { OracleScript } from '../core/agent/oracle.js';
import { buildAgentCard } from '../core/a2a/agent_card.js';
import {
  A2A_PUSH_NOTIFICATION_NOT_SUPPORTED,
  A2A_RPC_PATH,
  A2A_SUPPORTED_VERSION,
  A2A_TASK_NOT_CANCELABLE,
  A2A_TASK_NOT_FOUND,
  A2A_UNSUPPORTED_OPERATION,
  A2A_VERSION_NOT_SUPPORTED,
  AGENT_CARD_PATH,
  JSONRPC_INTERNAL_ERROR,
  JSONRPC_INVALID_REQUEST,
  JSONRPC_METHOD_NOT_FOUND,
  JSONRPC_PARSE_ERROR,
  JsonRpcRequestSchema,
  checkA2aVersion,
  classifyMethod,
  errorInfo,
  jsonRpcError,
  jsonRpcResult,
  parseSendMessage,
  parseTaskRef,
  type JsonRpcId,
} from '../core/a2a/protocol.js';
import {
  applyAgentEvent,
  isTerminalTaskState,
  newTaskRecord,
  parseTaskRecord,
  renderTask,
  streamFramesFor,
  type A2aTaskRecord,
} from '../core/a2a/task_record.js';
import { shutdownCoordinator } from '../core/runtime/shutdown.js';
import { loggerFor } from '../core/observability/logger.js';
import { getMetrics } from '../core/observability/metrics.js';

// Session 11: the A2A v1.0 server surface — a second door into the
// Session 9 goal loop, never a bypass. One A2A task is one agentic
// goal dispatched through the SAME queue, admission gates, and hard
// per-goal bounds as /api/agent-stream (Guardrail 6); the concatenated
// message text is the only payload that crosses into the loop
// (Guardrail 5; oracle metadata is the drill-only exception, gated by
// AGENT_ORACLE_ENABLED exactly like the SSE endpoint's oracle param).
//
// Both mount functions are called from server.ts only when
// TRELLIS_A2A_ENABLED=true; with the flag off, no route, Redis client,
// or shutdown hook here exists and the API surface is byte-identical
// to a pre-Session-11 process.

const log = loggerFor({ component: 'a2a' });
const metrics = getMetrics();

function nowIso(): string {
  return new Date().toISOString();
}

function recordKey(taskId: string): string {
  return `a2a:task:${taskId}`;
}

/**
 * Serves the Agent Card from the spec's well-known path. Mounted BEFORE
 * the API-key middleware: discovery is how a client learns which
 * security scheme the RPC surface requires, so the card itself must be
 * reachable — it carries only public contract (pinned by unit test and
 * the test:a2a drill).
 */
export function mountAgentCard(app: express.Express): void {
  const card = buildAgentCard({
    name: config.a2a.agentName,
    description: config.a2a.agentDescription,
    url: config.a2a.agentUrl,
    apiKeyConfigured: config.api.apiKey !== undefined && config.api.apiKey !== '',
  });
  app.get(AGENT_CARD_PATH, (_req, res) => {
    // Spec §8.6: cards change rarely; let clients cache one card per
    // agent version.
    res.set('Cache-Control', 'max-age=3600');
    res.json(card);
  });
}

// --- Goal dispatch and the task recorder ---------------------------------

interface GoalRun {
  taskId: string;
  submitted: A2aTaskRecord;
  /** Resolves with the final record at the terminal event, or with the
   * latest record if the recorder ceiling expires first. */
  terminal: Promise<A2aTaskRecord>;
}

interface GoalRunInputs {
  goalText: string;
  oracle?: OracleScript;
  /** Gate slot owned by the run from this call on: released exactly once
   * at the terminal event, the recorder ceiling, or a setup failure. */
  release: ReleaseFn;
  /** Streaming tap: called with each observed goal event and the record
   * AFTER applying it. Detached client streams simply stop consuming —
   * the recorder (and the task lifecycle) is independent of any stream. */
  onEvent?: (event: unknown, record: A2aTaskRecord) => void;
}

/** Live recorder subscribers, closed on shutdown. */
const liveRecorders = new Set<IORedis>();

/**
 * Dispatches one goal through the real agent_queue and records its
 * lifecycle into a TTL-bounded Redis task record. Subscribe-then-enqueue,
 * exactly like the SSE endpoints: no event can be lost between enqueue
 * and subscription. Setup failures release the gate and throw; after a
 * successful return the recorder owns the slot.
 */
async function startGoalRun(store: IORedis, inputs: GoalRunInputs): Promise<GoalRun> {
  const taskId = crypto.randomUUID();
  const contextId = crypto.randomUUID();
  let record = newTaskRecord(taskId, contextId, nowIso());
  const ttlSeconds = config.a2a.taskTtlSeconds;

  const subscriber = new IORedis({ host: config.redis.host, port: config.redis.port });
  // Without a listener a transient connection error becomes an
  // unhandled 'error' event; the recorder rides out reconnects.
  subscriber.on('error', err =>
    log.warn({ event: 'a2a.recorder_connection_error', taskId, err })
  );
  liveRecorders.add(subscriber);

  let settled = false;
  let resolveTerminal!: (record: A2aTaskRecord) => void;
  const terminal = new Promise<A2aTaskRecord>(resolve => {
    resolveTerminal = resolve;
  });

  const cleanup = () => {
    if (settled) return;
    settled = true;
    clearTimeout(ceiling);
    inputs.release();
    liveRecorders.delete(subscriber);
    subscriber.unsubscribe().catch(() => {});
    subscriber.quit().catch(() => {});
    resolveTerminal(record);
  };

  // A recorder must never outlive the record it maintains: if the goal
  // somehow neither completes nor fails before the record's own TTL,
  // the subscriber and gate slot are reclaimed and the record is left
  // to expire (Guardrail 6 — degraded resources, never leaked ones).
  const ceiling = setTimeout(() => {
    log.warn({ event: 'a2a.recorder_ceiling', taskId, state: record.state });
    cleanup();
  }, ttlSeconds * 1000);
  ceiling.unref?.();

  subscriber.on('message', (_channel, message) => {
    if (settled) return;
    let event: unknown;
    try {
      event = JSON.parse(message);
    } catch {
      return; // malformed frame — ignored, same posture as the SSE endpoint
    }
    const before = record;
    record = applyAgentEvent(record, event, nowIso());
    if (record !== before) {
      store
        .set(recordKey(taskId), JSON.stringify(record), 'EX', ttlSeconds)
        .catch(err => log.warn({ event: 'a2a.record_write_failed', taskId, err }));
      log.info({ event: 'a2a.task_state', taskId, state: record.state });
    }
    inputs.onEvent?.(event, record);
    if (isTerminalTaskState(record.state)) {
      metrics.a2aTasksTotal.inc({
        outcome: record.state === 'TASK_STATE_COMPLETED' ? 'completed' : 'failed',
      });
      cleanup();
    }
  });

  try {
    // Subscribe in the same tick the connection is created: issuing the
    // SUBSCRIBE after an unrelated await can land it mid ready-check,
    // which wedges ioredis in a reconnect loop and loses every event.
    // The task id IS the goalId: the recorder listens on the identical
    // channel the agent worker publishes to.
    await new Promise<void>((resolve, reject) => {
      subscriber.subscribe(`agent-stream:${taskId}`, err => (err ? reject(err) : resolve()));
    });
    // The initial record is durable before anything is enqueued, so a
    // returnImmediately caller can poll GetTask without racing dispatch.
    await store.set(recordKey(taskId), JSON.stringify(record), 'EX', ttlSeconds);
    await agentQueue.add('agent_goal', {
      goal: inputs.goalText,
      goalId: taskId,
      ...(inputs.oracle && { oracle: inputs.oracle }),
    });
  } catch (error) {
    cleanup();
    throw error;
  }

  log.info({ event: 'a2a.task_submitted', taskId });
  return { taskId, submitted: record, terminal };
}

// --- The JSON-RPC endpoint ------------------------------------------------

export interface A2aRpcDeps {
  /** The SAME gate instance /api/agent-stream admits through, so the
   * combined concurrent-goal cap holds across both surfaces. */
  goalGate: StreamGate;
}

export function mountA2aRpc(app: express.Express, deps: A2aRpcDeps): void {
  const store = new IORedis({ host: config.redis.host, port: config.redis.port });
  store.on('error', err => log.warn({ event: 'a2a.store_connection_error', err }));
  shutdownCoordinator.register('a2a.store', 60, async () => {
    for (const subscriber of liveRecorders) {
      subscriber.quit().catch(() => {});
    }
    liveRecorders.clear();
    await store.quit();
  });

  const sendError = (
    res: express.Response,
    id: JsonRpcId | null,
    code: number,
    message: string,
    data?: unknown[],
    httpStatus = 200
  ) => {
    res.status(httpStatus).json(jsonRpcError(id, code, message, data));
  };

  app.post(A2A_RPC_PATH, async (req, res) => {
    // express.text parsed application/json bodies into a raw string;
    // JSON.parse stays in-handler so a malformed payload maps to the
    // spec's -32700 instead of an HTML error page.
    let parsedBody: unknown;
    try {
      if (typeof req.body !== 'string' || req.body.length === 0) {
        throw new Error('empty body');
      }
      parsedBody = JSON.parse(req.body);
    } catch {
      metrics.a2aRequestsTotal.inc({ method: 'invalid' });
      return sendError(
        res,
        null,
        JSONRPC_PARSE_ERROR,
        'Invalid JSON payload (send Content-Type: application/json with a JSON-RPC 2.0 body)'
      );
    }

    const envelope = JsonRpcRequestSchema.safeParse(parsedBody);
    if (!envelope.success) {
      metrics.a2aRequestsTotal.inc({ method: 'invalid' });
      return sendError(res, null, JSONRPC_INVALID_REQUEST, 'Request payload validation error');
    }
    const { id, method, params } = envelope.data;

    // Version negotiation (spec §3.6): the A2A-Version service parameter
    // arrives as an HTTP header or, alternatively, a request parameter.
    // An absent value means a 0.3 client, which this surface cannot
    // serve honestly.
    const versionValue =
      typeof req.headers['a2a-version'] === 'string'
        ? req.headers['a2a-version']
        : typeof req.query['A2A-Version'] === 'string'
          ? (req.query['A2A-Version'] as string)
          : undefined;
    const version = checkA2aVersion(versionValue);
    if (!version.ok) {
      metrics.a2aRequestsTotal.inc({ method: 'invalid' });
      return sendError(
        res,
        id,
        A2A_VERSION_NOT_SUPPORTED,
        `A2A protocol version ${version.requested} is not supported`,
        [errorInfo('VERSION_NOT_SUPPORTED', { supportedVersions: A2A_SUPPORTED_VERSION })]
      );
    }

    const classified = classifyMethod(method);
    if (classified.kind === 'push_notification') {
      metrics.a2aRequestsTotal.inc({ method: 'declined' });
      return sendError(
        res,
        id,
        A2A_PUSH_NOTIFICATION_NOT_SUPPORTED,
        'Push notifications are not supported (capabilities.pushNotifications is false)'
      );
    }
    if (classified.kind === 'declined') {
      metrics.a2aRequestsTotal.inc({ method: 'declined' });
      return sendError(res, id, A2A_UNSUPPORTED_OPERATION, `${method} is not supported by this agent`);
    }
    if (classified.kind === 'unknown') {
      metrics.a2aRequestsTotal.inc({ method: 'invalid' });
      return sendError(res, id, JSONRPC_METHOD_NOT_FOUND, 'Method not found');
    }

    metrics.a2aRequestsTotal.inc({ method: classified.method });
    try {
      switch (classified.method) {
        case 'SendMessage':
          return await handleSendMessage(res, id, params, false);
        case 'SendStreamingMessage':
          return await handleSendMessage(res, id, params, true);
        case 'GetTask':
          return await handleGetTask(res, id, params);
        case 'CancelTask':
          return await handleCancelTask(res, id, params);
      }
    } catch (error) {
      log.error({
        event: 'a2a.request_failed',
        method: classified.method,
        err: error instanceof Error ? error : new Error(String(error)),
      });
      if (!res.headersSent) {
        return sendError(res, id, JSONRPC_INTERNAL_ERROR, 'Internal error');
      }
      res.end();
    }
  });

  async function handleSendMessage(
    res: express.Response,
    id: JsonRpcId,
    params: unknown,
    streaming: boolean
  ): Promise<void> {
    const parsed = parseSendMessage(params, { oracleEnabled: config.agent.oracleEnabled });
    if (!parsed.ok) {
      return sendError(res, id, parsed.code, parsed.message);
    }

    // Admission is the /api/agent-stream pair of gates verbatim: the
    // shared concurrent-goal cap, then the agent_queue depth backstop.
    // Over-limit requests get HTTP 429 (the binding runs over HTTP, so
    // the transport carries the retry semantics) with a JSON-RPC error
    // body for protocol-only clients.
    const release = deps.goalGate.tryAcquire();
    if (!release) {
      return sendError(
        res,
        id,
        JSONRPC_INTERNAL_ERROR,
        `Too many concurrent goals (limit ${deps.goalGate.limit}); retry later`,
        [errorInfo('RATE_LIMITED')],
        429
      );
    }
    let queueDepth: number;
    try {
      queueDepth = await agentQueue.getWaitingCount();
    } catch (err) {
      release();
      log.error({
        event: 'a2a.queue_depth_unavailable',
        queue: 'agent_queue',
        err: err instanceof Error ? err : new Error(String(err)),
      });
      return sendError(res, id, JSONRPC_INTERNAL_ERROR, 'Queue unavailable; retry later', undefined, 503);
    }
    if (queueDepth >= config.agent.maxQueueDepth) {
      release();
      return sendError(
        res,
        id,
        JSONRPC_INTERNAL_ERROR,
        `Agent queue is full (${queueDepth} waiting, limit ${config.agent.maxQueueDepth}); retry later`,
        [errorInfo('RATE_LIMITED')],
        429
      );
    }

    if (!streaming) {
      const run = await startGoalRun(store, {
        goalText: parsed.goalText,
        ...(parsed.oracle && { oracle: parsed.oracle }),
        release,
      });
      if (parsed.returnImmediately) {
        // Non-blocking mode: hand back the SUBMITTED task; the caller
        // polls GetTask (spec §3.2.2).
        return void res.json(jsonRpcResult(id, { task: renderTask(run.submitted) }));
      }
      const final = await run.terminal;
      return void res.json(jsonRpcResult(id, { task: renderTask(final) }));
    }

    // Streaming mode: SSE of JSON-RPC responses, each wrapping one
    // StreamResponse (spec §9.4.2) — the initial Task, then status and
    // artifact updates until the terminal status closes the stream.
    // Events observed before the headers go out are buffered so the
    // initial Task frame is always first, even against a fast worker.
    let clientGone = false;
    res.on('close', () => {
      clientGone = true;
    });
    const writeFrame = (frame: Record<string, unknown>) => {
      if (clientGone || res.writableEnded) return;
      res.write(`data: ${JSON.stringify(jsonRpcResult(id, frame))}\n\n`);
    };

    const buffered: Record<string, unknown>[] = [];
    let terminalSeen = false;
    let streamOpen = false;
    const closeStream = () => {
      if (!clientGone && !res.writableEnded) res.end();
    };

    const run = await startGoalRun(store, {
      goalText: parsed.goalText,
      ...(parsed.oracle && { oracle: parsed.oracle }),
      release,
      onEvent: (event, record) => {
        const frames = streamFramesFor(event, record);
        if (!streamOpen) {
          buffered.push(...frames);
          if (isTerminalTaskState(record.state)) terminalSeen = true;
          return;
        }
        for (const frame of frames) writeFrame(frame);
        if (isTerminalTaskState(record.state)) closeStream();
      },
    });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders();
    writeFrame({ task: renderTask(run.submitted) });
    for (const frame of buffered) writeFrame(frame);
    streamOpen = true;
    if (terminalSeen) closeStream();
  }

  async function handleGetTask(res: express.Response, id: JsonRpcId, params: unknown): Promise<void> {
    const parsed = parseTaskRef(params);
    if (!parsed.ok) return sendError(res, id, parsed.code, parsed.message);
    const raw = await store.get(recordKey(parsed.taskId));
    const record = raw === null ? null : parseTaskRecord(raw);
    if (record === null) {
      return sendError(res, id, A2A_TASK_NOT_FOUND, 'Task not found', [
        errorInfo('TASK_NOT_FOUND'),
      ]);
    }
    res.json(jsonRpcResult(id, renderTask(record)));
  }

  async function handleCancelTask(res: express.Response, id: JsonRpcId, params: unknown): Promise<void> {
    const parsed = parseTaskRef(params);
    if (!parsed.ok) return sendError(res, id, parsed.code, parsed.message);
    const raw = await store.get(recordKey(parsed.taskId));
    const record = raw === null ? null : parseTaskRecord(raw);
    if (record === null) {
      return sendError(res, id, A2A_TASK_NOT_FOUND, 'Task not found', [
        errorInfo('TASK_NOT_FOUND'),
      ]);
    }
    // The goal loop has no abort path (HANDOFF §8): a live goal runs to
    // its bounded end, and a terminal task is past canceling either way.
    const detail = isTerminalTaskState(record.state)
      ? 'Task is already in a terminal state'
      : 'Goal execution does not support cancellation';
    return sendError(res, id, A2A_TASK_NOT_CANCELABLE, detail);
  }
}
