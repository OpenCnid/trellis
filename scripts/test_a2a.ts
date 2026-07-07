// Live zero-LLM test of the Session 11 A2A server surface. Requires the
// docker-compose stack (Redis; Postgres/Neo4j are untouched) and makes
// NO LLM calls and NO external network requests: decisions come from
// oracle scripts riding in SendMessage metadata (drill mode only) and
// every task is a stubbed rlm_queue job. The API server runs as a child
// process; the real agent and RLM workers run in this process against
// the real queues.
//
// Coverage (HANDOFF §6):
//   - disabled-by-default posture: with TRELLIS_A2A_ENABLED unset the
//     card path and RPC endpoint do not exist;
//   - Agent Card discovery: public well-known fetch, declared JSONRPC
//     interface and x-api-key scheme, no secret leakage;
//   - auth rejection, A2A-Version negotiation, and the malformed
//     JSON-RPC matrix (-32700/-32600/-32601/-32602/-32003/-32004/-32005);
//   - a blocking SendMessage goal completing with the oracle answer as
//     a text artifact; returnImmediately + GetTask polling before and
//     after completion; the full SSE stream lifecycle;
//   - a bound-tripped goal surfacing as TASK_STATE_FAILED with the
//     typed reason; CancelTask declined; unknown task ids;
//   - admission-gate saturation returning HTTP 429 with a JSON-RPC
//     error body; oracle metadata rejected when drills are disabled;
//   - API-process /metrics carrying the bounded a2a counters and never
//     the goal text.

// Bounds for the in-process workers — set before any src import reads
// the environment. The missing OPENAI_API_KEY is a safety net: even a
// mistaken non-oracle goal cannot spend.
process.env.AGENT_MAX_ITERATIONS_PER_GOAL = '4';
process.env.AGENT_MAX_TASKS_PER_GOAL = '4';
process.env.AGENT_MAX_CONCURRENT_TASKS = '2';
delete process.env.OPENAI_API_KEY;

import { spawn, ChildProcess } from 'child_process';
import http from 'http';
import path from 'path';

const DISABLED_PORT = 3216;
const PORT = 3217;
const NO_ORACLE_PORT = 3218;
const KEY = 'trellis-a2a-test-key';
const RPC_PATH = '/a2a/v1';
const CARD_PATH = '/.well-known/agent-card.json';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
}

// --- Stub stdout construction (the test_agent_loop.ts shapes) -----------

function stubStdout(answer: string): string {
  const telemetry = {
    input_tokens: 0,
    output_tokens: 0,
    reported_cost_usd: null,
    subcall_count: 0,
    tool_calls: 2,
    execution_time_s: 0.01,
    model_usage: {},
  };
  const envelope = { status: 'ok', answer, toolCalls: 2 };
  return (
    'Starting stub RLM agent\n'
    + `FINAL_ANSWER: ${answer}\n`
    + `TRELLIS_TELEMETRY: ${JSON.stringify(telemetry)}\n`
    + `TRELLIS_RESULT: ${JSON.stringify(envelope)}\n`
  );
}

function finishOracle(finalAnswer: string, taskAnswer: string, delayMs = 0) {
  return {
    steps: [
      {
        decision: {
          action: 'dispatch',
          tasks: [
            {
              taskId: 'probe',
              query: 'probe the graph',
              stub: { stdout: stubStdout(taskAnswer), ...(delayMs > 0 && { delayMs }) },
            },
          ],
        },
      },
      { decision: { action: 'finish', finalAnswer } },
    ],
  };
}

// --- HTTP helpers ---------------------------------------------------------

interface RpcResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  json: any;
}

function httpRequest(options: {
  port: number;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}): Promise<RpcResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: options.port,
        path: options.path,
        method: options.method,
        headers: options.headers,
      },
      res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => (body += chunk));
        res.on('end', () => {
          let json: any = null;
          try {
            json = JSON.parse(body);
          } catch {
            // non-JSON bodies stay raw
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body, json });
        });
      }
    );
    req.setTimeout(options.timeoutMs ?? 60000, () => {
      req.destroy(new Error(`request to ${options.path} timed out`));
    });
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

let nextRpcId = 0;
function rpc(
  port: number,
  method: string,
  params: unknown,
  options: { apiKey?: string; version?: string; rawBody?: string; id?: unknown } = {}
): Promise<RpcResponse> {
  const id = options.id !== undefined ? options.id : `req-${++nextRpcId}`;
  const body =
    options.rawBody !== undefined
      ? options.rawBody
      : JSON.stringify({ jsonrpc: '2.0', id, method, ...(params !== undefined && { params }) });
  return httpRequest({
    port,
    method: 'POST',
    path: RPC_PATH,
    headers: {
      'Content-Type': 'application/json',
      ...(options.apiKey && { 'x-api-key': options.apiKey }),
      ...(options.version !== undefined && { 'A2A-Version': options.version }),
    },
    body,
  });
}

function sendParams(goal: string, extras: Record<string, unknown> = {}): Record<string, unknown> {
  const { message: messageExtras, ...rest } = extras;
  return {
    message: {
      messageId: `msg-${++nextRpcId}`,
      role: 'ROLE_USER',
      parts: [{ text: goal }],
      ...(messageExtras as Record<string, unknown> | undefined),
    },
    ...rest,
  };
}

/** POSTs SendStreamingMessage and collects the SSE frames until close. */
function rpcStream(
  port: number,
  params: unknown,
  options: { timeoutMs?: number } = {}
): Promise<{ status: number; contentType: string; frames: any[] }> {
  return new Promise((resolve, reject) => {
    const id = `stream-${++nextRpcId}`;
    const body = JSON.stringify({ jsonrpc: '2.0', id, method: 'SendStreamingMessage', params });
    const frames: any[] = [];
    let buffer = '';
    let settled = false;

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: RPC_PATH,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'x-api-key': KEY,
          'A2A-Version': '1.0',
        },
      },
      res => {
        const contentType = String(res.headers['content-type'] ?? '');
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              frames.push(JSON.parse(line.substring(6)));
            } catch {
              // malformed frame — ignored
            }
          }
        });
        res.on('end', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ status: res.statusCode ?? 0, contentType, frames });
        });
      }
    );

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        req.destroy();
        reject(new Error(`A2A stream timed out after ${options.timeoutMs ?? 30000}ms`));
      }
    }, options.timeoutMs ?? 30000);

    req.on('error', err => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });
    req.write(body);
    req.end();
  });
}

async function pollTask(port: number, taskId: string, timeoutMs = 20000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  let last: any = null;
  while (Date.now() < deadline) {
    const res = await rpc(port, 'GetTask', { id: taskId }, { apiKey: KEY, version: '1.0' });
    last = res.json?.result ?? null;
    if (last && (last.status?.state === 'TASK_STATE_COMPLETED' || last.status?.state === 'TASK_STATE_FAILED')) {
      return last;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return last;
}

// --- Server lifecycle -------------------------------------------------------

function startServer(port: number, extraEnv: Record<string, string>): ChildProcess {
  return spawn(
    process.execPath,
    [path.resolve('node_modules', 'tsx', 'dist', 'cli.mjs'), path.resolve('src', 'api', 'server.ts')],
    {
      env: { ...process.env, PORT: String(port), API_KEY: KEY, ...extraEnv },
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  );
}

async function waitForServer(child: ChildProcess, port: number, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) return;
    } catch {
      await new Promise(r => setTimeout(r, 250));
    }
  }
  throw new Error('Server did not start listening in time');
}

// --- Main --------------------------------------------------------------------

async function main() {
  // Real workers on the real queues, in this process. Imported after the
  // bound overrides above so their config sees the drill values.
  await import('../src/workers/rlm_worker.js');
  await import('../src/workers/agent_worker.js');

  // --- Phase 1: production defaults (A2A disabled) ---
  const disabledServer = startServer(DISABLED_PORT, {});
  try {
    await waitForServer(disabledServer, DISABLED_PORT);
    console.log('Phase 1: production-default server (TRELLIS_A2A_ENABLED unset)\n');

    const cardNoKey = await httpRequest({ port: DISABLED_PORT, method: 'GET', path: CARD_PATH });
    check('agent card path does not exist unauthenticated -> 401', cardNoKey.status === 401,
      `got ${cardNoKey.status}`);
    const cardWithKey = await httpRequest({
      port: DISABLED_PORT,
      method: 'GET',
      path: CARD_PATH,
      headers: { 'x-api-key': KEY },
    });
    check('agent card path does not exist authenticated -> 404', cardWithKey.status === 404,
      `got ${cardWithKey.status}`);
    const rpcDisabled = await rpc(DISABLED_PORT, 'GetTask', { id: 'x' }, { apiKey: KEY, version: '1.0' });
    check('RPC endpoint does not exist when disabled -> 404', rpcDisabled.status === 404,
      `got ${rpcDisabled.status}`);
  } finally {
    disabledServer.kill();
  }

  // --- Phase 2: A2A + oracle drill server (goal cap 1) ---
  const drillServer = startServer(PORT, {
    TRELLIS_A2A_ENABLED: 'true',
    AGENT_ORACLE_ENABLED: 'true',
    AGENT_MAX_CONCURRENT_GOALS: '1',
    A2A_AGENT_URL: `http://127.0.0.1:${PORT}/a2a/v1`,
  });
  try {
    await waitForServer(drillServer, PORT);
    console.log('\nPhase 2: A2A drill server (oracle enabled)\n');

    // --- Discovery ---
    const card = await httpRequest({ port: PORT, method: 'GET', path: CARD_PATH });
    check('agent card is served unauthenticated from the well-known path', card.status === 200,
      `got ${card.status}`);
    check('card declares the JSONRPC 1.0 interface at the advertised URL',
      card.json?.supportedInterfaces?.[0]?.protocolBinding === 'JSONRPC'
        && card.json?.supportedInterfaces?.[0]?.protocolVersion === '1.0'
        && card.json?.supportedInterfaces?.[0]?.url === `http://127.0.0.1:${PORT}/a2a/v1`,
      JSON.stringify(card.json?.supportedInterfaces));
    check('card declares streaming but not push notifications',
      card.json?.capabilities?.streaming === true && card.json?.capabilities?.pushNotifications === false,
      JSON.stringify(card.json?.capabilities));
    check('card declares the x-api-key security scheme',
      card.json?.securitySchemes?.apiKey?.apiKeySecurityScheme?.name === 'x-api-key',
      JSON.stringify(card.json?.securitySchemes));
    check('card exposes the goal-execution skill', card.json?.skills?.[0]?.id === 'goal-execution',
      JSON.stringify(card.json?.skills));
    check('card leaks no API key or internal endpoints',
      !card.body.includes(KEY) && !card.body.includes('6379') && !card.body.includes('bolt://'),
      'secretish value found in card body');

    // --- Auth and version negotiation ---
    const noKey = await rpc(PORT, 'GetTask', { id: 'x' }, { version: '1.0' });
    check('RPC without the API key -> 401', noKey.status === 401, `got ${noKey.status}`);

    const noVersion = await rpc(PORT, 'GetTask', { id: 'x' }, { apiKey: KEY });
    check('missing A2A-Version is treated as a 0.3 client -> -32009',
      noVersion.status === 200 && noVersion.json?.error?.code === -32009,
      JSON.stringify(noVersion.json));
    const oldVersion = await rpc(PORT, 'GetTask', { id: 'x' }, { apiKey: KEY, version: '0.3' });
    check('A2A-Version 0.3 -> -32009 with supported versions detail',
      oldVersion.json?.error?.code === -32009
        && oldVersion.json?.error?.data?.[0]?.metadata?.supportedVersions === '1.0',
      JSON.stringify(oldVersion.json));

    // --- Malformed JSON-RPC matrix ---
    const badJson = await rpc(PORT, '', undefined, { apiKey: KEY, version: '1.0', rawBody: '{not json' });
    check('malformed JSON body -> -32700', badJson.json?.error?.code === -32700,
      JSON.stringify(badJson.json));
    const badEnvelope = await rpc(PORT, '', undefined, {
      apiKey: KEY,
      version: '1.0',
      rawBody: JSON.stringify({ jsonrpc: '2.0', method: 'GetTask', params: { id: 'x' } }),
    });
    check('envelope without an id -> -32600 (null id error)',
      badEnvelope.json?.error?.code === -32600 && badEnvelope.json?.id === null,
      JSON.stringify(badEnvelope.json));
    const unknownMethod = await rpc(PORT, 'message/send', sendParams('x'), { apiKey: KEY, version: '1.0' });
    check('pre-1.0 method name -> -32601 method not found',
      unknownMethod.json?.error?.code === -32601, JSON.stringify(unknownMethod.json));
    const badParams = await rpc(PORT, 'GetTask', { historyLength: 3 }, { apiKey: KEY, version: '1.0' });
    check('GetTask without an id -> -32602 invalid params',
      badParams.json?.error?.code === -32602, JSON.stringify(badParams.json));
    const pushConfig = await rpc(PORT, 'CreateTaskPushNotificationConfig', { taskId: 'x', url: 'https://x' },
      { apiKey: KEY, version: '1.0' });
    check('push-notification config -> -32003 not supported',
      pushConfig.json?.error?.code === -32003, JSON.stringify(pushConfig.json));
    const listTasks = await rpc(PORT, 'ListTasks', {}, { apiKey: KEY, version: '1.0' });
    check('ListTasks -> -32004 unsupported operation',
      listTasks.json?.error?.code === -32004, JSON.stringify(listTasks.json));
    const filePart = await rpc(PORT, 'SendMessage',
      sendParams('x', { message: { parts: [{ url: 'https://example.com/doc.pdf' }] } }),
      { apiKey: KEY, version: '1.0' });
    check('file part -> -32005 content type not supported',
      filePart.json?.error?.code === -32005, JSON.stringify(filePart.json));
    const multiTurn = await rpc(PORT, 'SendMessage',
      sendParams('continue please', { message: { taskId: 'earlier-task' } }),
      { apiKey: KEY, version: '1.0' });
    check('multi-turn task reference -> -32004 unsupported',
      multiTurn.json?.error?.code === -32004, JSON.stringify(multiTurn.json));

    // --- Blocking SendMessage: goal completes with the answer artifact ---
    const blocking = await rpc(PORT, 'SendMessage',
      sendParams('summarize what the probe reports', {
        metadata: { oracle: finishOracle('the probe reports alpha', 'alpha result') },
      }),
      { apiKey: KEY, version: '1.0' });
    const blockingTask = blocking.json?.result?.task;
    check('blocking SendMessage returns HTTP 200 with a task result',
      blocking.status === 200 && !!blockingTask, JSON.stringify(blocking.json));
    check('blocking send waits for the terminal state',
      blockingTask?.status?.state === 'TASK_STATE_COMPLETED', JSON.stringify(blockingTask?.status));
    check('the final answer arrives as one text artifact',
      blockingTask?.artifacts?.length === 1
        && blockingTask?.artifacts?.[0]?.parts?.[0]?.text === 'the probe reports alpha',
      JSON.stringify(blockingTask?.artifacts));
    check('the task carries server-generated ids and a timestamp',
      typeof blockingTask?.id === 'string' && typeof blockingTask?.contextId === 'string'
        && typeof blockingTask?.status?.timestamp === 'string',
      JSON.stringify(blockingTask));

    // --- GetTask polling and CancelTask on the finished goal ---
    const fetched = await rpc(PORT, 'GetTask', { id: blockingTask.id }, { apiKey: KEY, version: '1.0' });
    check('GetTask returns the completed task from its record',
      fetched.json?.result?.status?.state === 'TASK_STATE_COMPLETED'
        && fetched.json?.result?.artifacts?.[0]?.parts?.[0]?.text === 'the probe reports alpha',
      JSON.stringify(fetched.json?.result));
    const cancelDone = await rpc(PORT, 'CancelTask', { id: blockingTask.id }, { apiKey: KEY, version: '1.0' });
    check('CancelTask on a terminal task -> -32002',
      cancelDone.json?.error?.code === -32002, JSON.stringify(cancelDone.json));
    const missingTask = await rpc(PORT, 'GetTask', { id: 'no-such-task' }, { apiKey: KEY, version: '1.0' });
    check('GetTask for an unknown id -> -32001',
      missingTask.json?.error?.code === -32001, JSON.stringify(missingTask.json));
    const cancelMissing = await rpc(PORT, 'CancelTask', { id: 'no-such-task' }, { apiKey: KEY, version: '1.0' });
    check('CancelTask for an unknown id -> -32001',
      cancelMissing.json?.error?.code === -32001, JSON.stringify(cancelMissing.json));

    // --- Non-blocking send + task-state polling across the lifecycle ---
    const immediate = await rpc(PORT, 'SendMessage',
      sendParams('poll me while I work', {
        metadata: { oracle: finishOracle('polled answer', 'slow probe', 1500) },
        configuration: { returnImmediately: true },
      }),
      { apiKey: KEY, version: '1.0' });
    const immediateTask = immediate.json?.result?.task;
    check('returnImmediately hands back the SUBMITTED task before execution',
      immediateTask?.status?.state === 'TASK_STATE_SUBMITTED', JSON.stringify(immediateTask?.status));
    const polledFinal = await pollTask(PORT, immediateTask.id);
    check('polling GetTask observes the goal completing',
      polledFinal?.status?.state === 'TASK_STATE_COMPLETED'
        && polledFinal?.artifacts?.[0]?.parts?.[0]?.text === 'polled answer',
      JSON.stringify(polledFinal));

    // --- Streaming lifecycle ---
    const stream = await rpcStream(PORT, sendParams('stream the goal to me', {
      metadata: { oracle: finishOracle('streamed answer', 'streamed probe') },
    }));
    check('SendStreamingMessage answers with an SSE stream',
      stream.status === 200 && stream.contentType.includes('text/event-stream'),
      `status ${stream.status}, content-type ${stream.contentType}`);
    check('every frame is a JSON-RPC response envelope',
      stream.frames.length > 0 && stream.frames.every(f => f.jsonrpc === '2.0' && 'result' in f),
      JSON.stringify(stream.frames[0]));
    const payloads = stream.frames.map(f => f.result);
    check('the stream begins with the SUBMITTED task object',
      payloads[0]?.task?.status?.state === 'TASK_STATE_SUBMITTED', JSON.stringify(payloads[0]));
    check('WORKING status updates stream during execution',
      payloads.some(p => p.statusUpdate?.status?.state === 'TASK_STATE_WORKING'),
      JSON.stringify(payloads.map(p => Object.keys(p))));
    const artifactFrame = payloads.find(p => p.artifactUpdate);
    check('the answer streams as an artifactUpdate with lastChunk',
      artifactFrame?.artifactUpdate?.artifact?.parts?.[0]?.text === 'streamed answer'
        && artifactFrame?.artifactUpdate?.lastChunk === true,
      JSON.stringify(artifactFrame));
    check('the stream closes on the terminal COMPLETED status',
      payloads[payloads.length - 1]?.statusUpdate?.status?.state === 'TASK_STATE_COMPLETED',
      JSON.stringify(payloads[payloads.length - 1]));

    // --- Bound trip: an oversized batch fails typed through A2A ---
    const boundTrip = await rpc(PORT, 'SendMessage',
      sendParams('goal that over-parallelizes', {
        metadata: {
          oracle: {
            steps: [{
              decision: {
                action: 'dispatch',
                tasks: [
                  { taskId: 'a', query: 'q', stub: { stdout: stubStdout('a') } },
                  { taskId: 'b', query: 'q', stub: { stdout: stubStdout('b') } },
                  { taskId: 'c', query: 'q', stub: { stdout: stubStdout('c') } },
                ],
              },
            }],
          },
        },
      }),
      { apiKey: KEY, version: '1.0' });
    const boundTask = boundTrip.json?.result?.task;
    check('a bound-tripped goal surfaces as TASK_STATE_FAILED',
      boundTask?.status?.state === 'TASK_STATE_FAILED', JSON.stringify(boundTask?.status));
    check('the failed status message carries the typed reason',
      boundTask?.status?.message?.role === 'ROLE_AGENT'
        && String(boundTask?.status?.message?.parts?.[0]?.text ?? '').startsWith('concurrency_bound:'),
      JSON.stringify(boundTask?.status?.message));
    check('a failed task exposes no artifacts', boundTask?.artifacts === undefined,
      JSON.stringify(boundTask?.artifacts));

    // --- Admission saturation: the shared goal gate (cap 1) ---
    const slow = await rpc(PORT, 'SendMessage',
      sendParams('slow goal holding the gate', {
        metadata: { oracle: finishOracle('slow done', 'slow probe', 4000) },
        configuration: { returnImmediately: true },
      }),
      { apiKey: KEY, version: '1.0' });
    check('slow goal admitted non-blocking', slow.json?.result?.task?.status?.state === 'TASK_STATE_SUBMITTED',
      JSON.stringify(slow.json));
    const saturated = await rpc(PORT, 'SendMessage', sendParams('second concurrent goal', {
      metadata: { oracle: finishOracle('x', 'x') },
    }), { apiKey: KEY, version: '1.0' });
    check('second concurrent goal -> HTTP 429 with a JSON-RPC error body',
      saturated.status === 429 && saturated.json?.error?.code === -32603
        && saturated.json?.error?.data?.[0]?.reason === 'RATE_LIMITED',
      `status ${saturated.status}, body ${JSON.stringify(saturated.json)}`);
    const slowFinal = await pollTask(PORT, slow.json.result.task.id);
    check('the gated goal still completes and frees the slot',
      slowFinal?.status?.state === 'TASK_STATE_COMPLETED', JSON.stringify(slowFinal?.status));

    // --- API-process metrics: bounded labels, no goal text ---
    const metricsRes = await httpRequest({
      port: PORT,
      method: 'GET',
      path: '/metrics',
      headers: { 'x-api-key': KEY },
    });
    check('a2a request counters expose the bounded method vocabulary',
      /trellis_a2a_requests_total\{method="SendMessage"\} [1-9]/.test(metricsRes.body)
        && /trellis_a2a_requests_total\{method="GetTask"\} [1-9]/.test(metricsRes.body)
        && /trellis_a2a_requests_total\{method="invalid"\} [1-9]/.test(metricsRes.body)
        && /trellis_a2a_requests_total\{method="declined"\} [1-9]/.test(metricsRes.body),
      'expected counter series missing');
    check('a2a task outcomes are counted',
      /trellis_a2a_tasks_total\{outcome="completed"\} [1-9]/.test(metricsRes.body)
        && /trellis_a2a_tasks_total\{outcome="failed"\} [1-9]/.test(metricsRes.body),
      'expected counter series missing');
    check('goal text never appears in metrics exposition',
      !metricsRes.body.includes('summarize what the probe reports')
        && !metricsRes.body.includes('streamed answer'),
      'goal/answer text leaked into metrics');
  } finally {
    drillServer.kill();
  }

  // --- Phase 3: A2A enabled, oracle disabled (production posture) ---
  const noOracleServer = startServer(NO_ORACLE_PORT, {
    TRELLIS_A2A_ENABLED: 'true',
  });
  try {
    await waitForServer(noOracleServer, NO_ORACLE_PORT);
    console.log('\nPhase 3: A2A enabled, oracle disabled (production posture)\n');

    const oracleRejected = await rpc(NO_ORACLE_PORT, 'SendMessage',
      sendParams('probe goal', { metadata: { oracle: finishOracle('x', 'x') } }),
      { apiKey: KEY, version: '1.0' });
    check('oracle metadata is rejected when drills are disabled -> -32602 (never enqueued)',
      oracleRejected.status === 200 && oracleRejected.json?.error?.code === -32602,
      JSON.stringify(oracleRejected.json));
  } finally {
    noOracleServer.kill();
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('Test run crashed:', err);
  process.exit(1);
});
