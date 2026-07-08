// Live zero-LLM test of the Session 9 agentic orchestration loop.
// Requires the docker-compose stack (Redis; Postgres/Neo4j are untouched)
// and makes NO LLM calls: decisions come from oracle scripts and every
// task is a stubbed rlm_queue job replayed through the real Redis
// publish/scan path. The API server runs as a child process; the real
// agent and RLM workers run in this process against the real queues.
//
// Coverage (HANDOFF §6):
//   - one goal decomposing into two tasks that round-trip through
//     agent_queue/rlm_queue/pub-sub, results aggregating, and the full
//     goal-level SSE lifecycle through the real endpoint;
//   - admission control (401 without key, 400 oracle-disabled default,
//     429 over the concurrency cap);
//   - bound-tripping goals ending as streamed typed failures with zero
//     further task dispatches;
//   - a task-level protocol violation surfacing as an observation that
//     the oracle plan reacts to.

// Bounds for the in-process workers — set before any src import reads
// the environment. The missing OPENAI_API_KEY is a safety net: even a
// mistaken non-oracle goal cannot spend.
process.env.AGENT_MAX_ITERATIONS_PER_GOAL = '4';
process.env.AGENT_MAX_TASKS_PER_GOAL = '2';
process.env.AGENT_MAX_CONCURRENT_TASKS = '2';
// Session 16: a small per-goal parked-bytes cap so the lineage phase can
// trip it with a ~3 KB snapshot while ordinary snapshots park freely.
process.env.SCRATCH_MAX_BYTES_PER_GOAL = '2048';
delete process.env.OPENAI_API_KEY;

import { spawn, ChildProcess } from 'child_process';
import http from 'http';
import path from 'path';

const ORACLE_OFF_PORT = 3214;
const PORT = 3215;
const KEY = 'trellis-agent-loop-test-key';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
}

// --- Stub stdout construction -----------------------------------------

function stubStdout(answer: string, options: {
  violation?: boolean;
  inputTokens?: number;
  outputTokens?: number;
} = {}): string {
  const toolCalls = options.violation ? 0 : 2;
  const telemetry = {
    input_tokens: options.inputTokens ?? 0,
    output_tokens: options.outputTokens ?? 0,
    reported_cost_usd: null,
    subcall_count: 0,
    tool_calls: toolCalls,
    execution_time_s: 0.01,
    model_usage: {},
  };
  const envelope = {
    status: options.violation ? 'protocol_violation' : 'ok',
    answer,
    toolCalls,
  };
  return (
    'Starting stub RLM agent\n'
    + `FINAL_ANSWER: ${answer}\n`
    + `TRELLIS_TELEMETRY: ${JSON.stringify(telemetry)}\n`
    + (options.violation
      ? 'TRELLIS_PROTOCOL_VIOLATION: zero database tool calls — answer has no provenance.\n'
      : '')
    + `TRELLIS_RESULT: ${JSON.stringify(envelope)}\n`
  );
}

// Session 16: a well-formed workspace snapshot a stub task "produced" —
// exactly the dict trellis_workspace.py serializes, parked through the
// identical validate/park path a real agent's out-file crosses.
function stubSnapshot(content: string): unknown {
  return {
    version: 1,
    plan: [{ id: 's1', desc: 'fetch the evidence', status: 'done' }],
    notes: ['parked by the fetch task'],
    segments: {
      'seg-0001-fetch': {
        origin: { server: 'websearch', tool: 'web_search', argsHash: 'ab12cd34ef56ab78' },
        fetchedAt: '2026-07-07T12:00:00+00:00',
        bytes: Buffer.byteLength(content, 'utf8'),
        truncated: false,
        content,
      },
    },
  };
}

// --- SSE client --------------------------------------------------------

interface GoalStreamResult {
  httpStatus: number;
  events: any[];
}

function openGoalStream(
  port: number,
  goal: string,
  options: {
    apiKey?: string;
    oracle?: unknown;
    onEvent?: (event: any) => void;
    timeoutMs?: number;
  } = {}
): { finished: Promise<GoalStreamResult>; firstEvent: Promise<void> } {
  let resolveFirst!: () => void;
  const firstEvent = new Promise<void>(resolve => { resolveFirst = resolve; });

  const finished = new Promise<GoalStreamResult>((resolve, reject) => {
    const params = new URLSearchParams({ goal });
    if (options.oracle !== undefined) params.set('oracle', JSON.stringify(options.oracle));
    const events: any[] = [];
    let buffer = '';
    let settled = false;
    let sawEvent = false;

    const finish = (httpStatus: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ httpStatus, events });
    };

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: `/api/agent-stream?${params.toString()}`,
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          ...(options.apiKey && { 'x-api-key': options.apiKey }),
        },
      },
      res => {
        if (res.statusCode !== 200) {
          res.resume();
          finish(res.statusCode ?? 0);
          return;
        }
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const event = JSON.parse(line.substring(6));
              events.push(event);
              options.onEvent?.(event);
              if (!sawEvent) { sawEvent = true; resolveFirst(); }
            } catch {
              // malformed frame — ignore
            }
          }
        });
        res.on('end', () => finish(200));
        res.on('error', err => { if (!settled) { settled = true; clearTimeout(timer); reject(err); } });
      }
    );

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        req.destroy();
        reject(new Error(`agent stream timed out after ${options.timeoutMs ?? 30000}ms`));
      }
    }, options.timeoutMs ?? 30000);

    req.on('error', err => { if (!settled) { settled = true; clearTimeout(timer); reject(err); } });
    req.end();
  });

  return { finished, firstEvent };
}

// --- Server lifecycle ---------------------------------------------------

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

// --- Main ----------------------------------------------------------------

async function main() {
  // Real workers on the real queues, in this process. Imported after the
  // bound overrides above so their config sees the drill values.
  await import('../src/workers/rlm_worker.js');
  await import('../src/workers/agent_worker.js');
  const { getMetrics } = await import('../src/core/observability/metrics.js');

  // --- Phase 1: production defaults (oracle disabled) ---
  const offServer = startServer(ORACLE_OFF_PORT, {});
  let onServer: ChildProcess | undefined;
  try {
    await waitForServer(offServer, ORACLE_OFF_PORT);
    console.log('Phase 1: production-default server (oracle disabled)\n');

    const unauth = await openGoalStream(ORACLE_OFF_PORT, 'probe goal').finished;
    check('GET /api/agent-stream without key -> 401', unauth.httpStatus === 401, `got ${unauth.httpStatus}`);

    const oracleRejected = await openGoalStream(ORACLE_OFF_PORT, 'probe goal', {
      apiKey: KEY,
      oracle: { steps: [{ decision: { action: 'finish', finalAnswer: 'x' } }] },
    }).finished;
    check('oracle script rejected by default (AGENT_ORACLE_ENABLED unset) -> 400',
      oracleRejected.httpStatus === 400, `got ${oracleRejected.httpStatus}`);

    const badOracle = await openGoalStream(ORACLE_OFF_PORT, 'probe goal', {
      apiKey: KEY,
      oracle: 'not-a-script',
    }).finished;
    check('malformed oracle -> 400 (never enqueued)', badOracle.httpStatus === 400, `got ${badOracle.httpStatus}`);
  } finally {
    offServer.kill();
  }

  // --- Phase 2: drill server (oracle enabled, goal cap 1) ---
  onServer = startServer(PORT, {
    AGENT_ORACLE_ENABLED: 'true',
    AGENT_MAX_CONCURRENT_GOALS: '1',
  });
  try {
    await waitForServer(onServer, PORT);
    console.log('\nPhase 2: drill server (oracle enabled)\n');

    // --- Full lifecycle: one goal, two tasks, aggregation ---
    const lifecycle = await openGoalStream(PORT, 'summarize what the two probes report', {
      apiKey: KEY,
      oracle: {
        steps: [
          {
            decision: {
              assessment: 'need both probes',
              action: 'dispatch',
              tasks: [
                { taskId: 'probe-a', query: 'probe a', stub: { stdout: stubStdout('alpha result', { inputTokens: 100, outputTokens: 10 }) } },
                { taskId: 'probe-b', query: 'probe b', stub: { stdout: stubStdout('beta result', { inputTokens: 50, outputTokens: 5 }) } },
              ],
            },
          },
          { decision: { action: 'finish', finalAnswer: 'alpha result + beta result' } },
        ],
      },
    }).finished;

    const types = lifecycle.events.map(e => e.type);
    check('lifecycle stream is HTTP 200', lifecycle.httpStatus === 200, `got ${lifecycle.httpStatus}`);
    check('goal_started is the first event', types[0] === 'goal_started', types.join(','));
    check('two task_started events', types.filter(t => t === 'task_started').length === 2, types.join(','));
    check('two task_result events', types.filter(t => t === 'task_result').length === 2, types.join(','));
    check('two decision events then goal_completed',
      types.filter(t => t === 'decision').length === 2 && types[types.length - 1] === 'goal_completed',
      types.join(','));

    const results = lifecycle.events.filter(e => e.type === 'task_result').map(e => e.outcome);
    check('task answers round-tripped from the stub envelopes',
      results.some(o => o.answer === 'alpha result') && results.some(o => o.answer === 'beta result'),
      JSON.stringify(results.map(o => o.answer)));
    check('task results carry ok status and tool-call counts',
      results.every(o => o.status === 'ok' && o.toolCalls === 2),
      JSON.stringify(results));

    const completed = lifecycle.events[lifecycle.events.length - 1];
    check('goal_completed carries the aggregated final answer',
      completed.finalAnswer === 'alpha result + beta result', JSON.stringify(completed));
    check('goal_completed aggregates sub-agent spend from telemetry',
      completed.spend?.taskInputTokens === 150 && completed.spend?.taskOutputTokens === 15,
      JSON.stringify(completed.spend));
    check('goal counts two dispatched tasks over two iterations',
      completed.tasksDispatched === 2 && completed.iterations === 2,
      JSON.stringify({ tasks: completed.tasksDispatched, iterations: completed.iterations }));

    // --- Protocol violation becomes an observation the plan reacts to ---
    const violation = await openGoalStream(PORT, 'goal with an unprovenanced first answer', {
      apiKey: KEY,
      oracle: {
        steps: [
          {
            decision: {
              action: 'dispatch',
              tasks: [{ taskId: 'no-provenance', query: 'probe', stub: { stdout: stubStdout('unsupported claim', { violation: true }) } }],
            },
          },
          {
            decision: { action: 'finish', finalAnswer: 'WRONG: accepted unprovenanced answer' },
            onProtocolViolation: {
              action: 'dispatch',
              tasks: [{ taskId: 'retry', query: 'probe, cite sources', stub: { stdout: stubStdout('supported claim') } }],
            },
          },
          { decision: { action: 'finish', finalAnswer: 'finished after violation retry' } },
        ],
      },
    }).finished;

    const violationResults = violation.events.filter(e => e.type === 'task_result').map(e => e.outcome);
    check('protocol violation surfaces as a task_result observation',
      violationResults.some(o => o.status === 'protocol_violation' && o.toolCalls === 0),
      JSON.stringify(violationResults));
    const violationEnd = violation.events[violation.events.length - 1];
    check('oracle plan reacted to the violation (retry branch taken)',
      violationEnd.type === 'goal_completed' && violationEnd.finalAnswer === 'finished after violation retry',
      JSON.stringify(violationEnd));

    // --- Bound trip: total-task ceiling (worker bound = 2) ---
    const bound = await openGoalStream(PORT, 'goal that overspends its task budget', {
      apiKey: KEY,
      oracle: {
        steps: [
          {
            decision: {
              action: 'dispatch',
              tasks: [
                { taskId: 'one', query: 'q1', stub: { stdout: stubStdout('one') } },
                { taskId: 'two', query: 'q2', stub: { stdout: stubStdout('two') } },
              ],
            },
          },
          {
            decision: {
              action: 'dispatch',
              tasks: [{ taskId: 'three', query: 'q3', stub: { stdout: stubStdout('three') } }],
            },
          },
        ],
      },
    }).finished;

    const boundTypes = bound.events.map(e => e.type);
    const boundEnd = bound.events[bound.events.length - 1];
    check('over-budget goal ends as a streamed typed failure',
      boundEnd.type === 'goal_failed' && boundEnd.failure?.kind === 'task_bound',
      JSON.stringify(boundEnd));
    check('the tripping batch dispatched zero further tasks',
      boundTypes.filter(t => t === 'task_started').length === 2,
      boundTypes.join(','));

    // --- Bound trip: per-batch concurrency ceiling, before any dispatch ---
    const burst = await openGoalStream(PORT, 'goal that over-parallelizes', {
      apiKey: KEY,
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
    }).finished;
    const burstEnd = burst.events[burst.events.length - 1];
    check('an oversized batch fails typed with zero tasks started',
      burstEnd.type === 'goal_failed'
        && burstEnd.failure?.kind === 'concurrency_bound'
        && burst.events.every(e => e.type !== 'task_started'),
      JSON.stringify(burstEnd));

    // --- Admission: 429 over the goal concurrency cap (limit 1) ---
    const slow = openGoalStream(PORT, 'slow goal holding the gate', {
      apiKey: KEY,
      oracle: {
        steps: [
          {
            decision: {
              action: 'dispatch',
              tasks: [{ taskId: 'slow', query: 'q', stub: { stdout: stubStdout('slow done'), delayMs: 3000 } }],
            },
          },
          { decision: { action: 'finish', finalAnswer: 'slow done' } },
        ],
      },
      timeoutMs: 60000,
    });
    await slow.firstEvent; // goal admitted and running
    const rejected = await openGoalStream(PORT, 'second concurrent goal', {
      apiKey: KEY,
      oracle: { steps: [{ decision: { action: 'finish', finalAnswer: 'x' } }] },
    }).finished;
    check('second concurrent goal -> 429 while the gate is held',
      rejected.httpStatus === 429, `got ${rejected.httpStatus}`);
    const slowDone = await slow.finished;
    check('gated goal still completes after the delay',
      slowDone.events[slowDone.events.length - 1]?.type === 'goal_completed',
      JSON.stringify(slowDone.events.map(e => e.type)));

    // --- Session 16: lineage park/resolve over real Redis ---
    console.log('\nPhase 3: workspace lineage (park, seed, cap, missing ref)\n');
    const IORedis = (await import('ioredis')).default;
    const redis = new IORedis({
      host: process.env.REDIS_HOST ?? '127.0.0.1',
      port: Number(process.env.REDIS_PORT ?? 6379),
    });
    const lineageGoalIds: string[] = [];
    const trackGoal = (events: any[]) => {
      const started = events.find(e => e.type === 'goal_started');
      if (started?.goalId) lineageGoalIds.push(started.goalId);
      return started?.goalId as string | undefined;
    };

    try {
      // Happy path: task 1 parks a snapshot; task 2 (next iteration) is
      // seeded from it by reference. The exact-identifier payload below
      // is the byte-exact transfer lineage exists for.
      const exactHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      const lineage = await openGoalStream(PORT, 'two-task goal with inherited workspace', {
        apiKey: KEY,
        oracle: {
          steps: [
            {
              decision: {
                action: 'dispatch',
                tasks: [{
                  taskId: 'fetch', query: 'fetch the evidence',
                  stub: { stdout: stubStdout('fetched'), workspaceSnapshot: stubSnapshot(`load-bearing hash: ${exactHash}`) },
                }],
              },
            },
            {
              decision: {
                action: 'dispatch',
                tasks: [{
                  taskId: 'derive', query: 'derive from the inherited evidence',
                  seedFromTasks: ['fetch'],
                  stub: { stdout: stubStdout('derived from seed') },
                }],
              },
            },
            { decision: { action: 'finish', finalAnswer: 'lineage done' } },
          ],
        },
      }).finished;

      const lineageGoalId = trackGoal(lineage.events);
      const lineageEnd = lineage.events[lineage.events.length - 1];
      check('seeded goal completes through the real queues',
        lineageEnd.type === 'goal_completed' && lineageEnd.finalAnswer === 'lineage done',
        JSON.stringify(lineageEnd));

      const lineageOutcomes = lineage.events.filter(e => e.type === 'task_result').map(e => e.outcome);
      const fetchOutcome = lineageOutcomes.find(o => o.taskId === 'fetch');
      const deriveOutcome = lineageOutcomes.find(o => o.taskId === 'derive');
      check('the parking task\'s observation carries a counts-only workspaceRef',
        fetchOutcome?.workspaceRef?.taskId === 'fetch'
          && fetchOutcome?.workspaceRef?.segments === 1
          && fetchOutcome?.workspaceRef?.bytes > 0,
        JSON.stringify(fetchOutcome?.workspaceRef));
      check('the observation ref never carries workspace content',
        !JSON.stringify(fetchOutcome?.workspaceRef).includes(exactHash),
        JSON.stringify(fetchOutcome?.workspaceRef));
      check('the seeded task resolved its inheritance and ran (no dispatch failure)',
        deriveOutcome?.status === 'ok' && deriveOutcome?.answer === 'derived from seed',
        JSON.stringify(deriveOutcome));
      check('a task that parked nothing reports a null workspaceRef',
        deriveOutcome?.workspaceRef === null, JSON.stringify(deriveOutcome?.workspaceRef));

      const parkedRaw = await redis.get(`scratch:goal:${lineageGoalId}:task:fetch`);
      const parked = parkedRaw ? JSON.parse(parkedRaw) : null;
      check('the snapshot is parked goal-scoped in Redis with byte-exact content',
        parked?.segments?.['seg-0001-fetch']?.content === `load-bearing hash: ${exactHash}`,
        parkedRaw === null ? 'key missing' : 'content mismatch');
      const ttl = await redis.ttl(`scratch:goal:${lineageGoalId}:task:fetch`);
      check('the parked snapshot carries the scratch TTL (bounded, never permanent)',
        ttl > 0 && ttl <= 3600, `ttl=${ttl}`);
      const bytesCounter = Number(await redis.get(`scratch:goal:${lineageGoalId}:bytes`));
      check('the per-goal parked-bytes counter metered the park',
        bytesCounter === fetchOutcome?.workspaceRef?.bytes,
        `counter=${bytesCounter} ref=${fetchOutcome?.workspaceRef?.bytes}`);

      // Missing reference: seeding from a prior task that parked nothing
      // is a readable dispatch-time failure surfacing as an observation.
      const missing = await openGoalStream(PORT, 'goal seeding from a task that parked nothing', {
        apiKey: KEY,
        oracle: {
          steps: [
            {
              decision: {
                action: 'dispatch',
                tasks: [{ taskId: 'no-park', query: 'plain task', stub: { stdout: stubStdout('plain') } }],
              },
            },
            {
              decision: {
                action: 'dispatch',
                tasks: [{
                  taskId: 'wants-seed', query: 'needs the missing state',
                  seedFromTasks: ['no-park'],
                  stub: { stdout: stubStdout('never runs') },
                }],
              },
            },
            { decision: { action: 'finish', finalAnswer: 'finished despite the missing seed' } },
          ],
        },
      }).finished;
      trackGoal(missing.events);
      const missingOutcome = missing.events
        .filter(e => e.type === 'task_result')
        .map(e => e.outcome)
        .find(o => o.taskId === 'wants-seed');
      check('a missing parked snapshot fails the seeded task readably (never a silent empty seed)',
        missingOutcome?.status === 'error'
          && /Workspace seed unavailable.*no-park/.test(missingOutcome?.error ?? ''),
        JSON.stringify(missingOutcome));

      // Per-goal cap: an oversized snapshot is refused at park time, so
      // the observation has no ref and a later seed fails readably.
      const capped = await openGoalStream(PORT, 'goal whose snapshot exceeds the parked-bytes cap', {
        apiKey: KEY,
        oracle: {
          steps: [
            {
              decision: {
                action: 'dispatch',
                tasks: [{
                  taskId: 'big', query: 'oversized park',
                  stub: { stdout: stubStdout('big done'), workspaceSnapshot: stubSnapshot('x'.repeat(3000)) },
                }],
              },
            },
            {
              decision: {
                action: 'dispatch',
                tasks: [{
                  taskId: 'wants-big', query: 'seed from the refused park',
                  seedFromTasks: ['big'],
                  stub: { stdout: stubStdout('never runs') },
                }],
              },
            },
            { decision: { action: 'finish', finalAnswer: 'finished under the cap' } },
          ],
        },
      }).finished;
      const cappedGoalId = trackGoal(capped.events);
      const cappedOutcomes = capped.events.filter(e => e.type === 'task_result').map(e => e.outcome);
      check('an over-cap snapshot is refused: no workspaceRef on the observation',
        cappedOutcomes.find(o => o.taskId === 'big')?.workspaceRef === null,
        JSON.stringify(cappedOutcomes.find(o => o.taskId === 'big')));
      check('nothing over the cap reaches Redis',
        (await redis.get(`scratch:goal:${cappedGoalId}:task:big`)) === null);
      check('seeding from the refused park fails readably',
        /Workspace seed unavailable/.test(
          cappedOutcomes.find(o => o.taskId === 'wants-big')?.error ?? ''),
        JSON.stringify(cappedOutcomes.find(o => o.taskId === 'wants-big')));
    } finally {
      // Token-scoped cleanup: only this drill's goal-scoped keys.
      for (const goalId of lineageGoalIds) {
        for (const taskId of ['fetch', 'derive', 'no-park', 'wants-seed', 'big', 'wants-big']) {
          await redis.del(`scratch:goal:${goalId}:task:${taskId}`);
        }
        await redis.del(`scratch:goal:${goalId}:bytes`);
      }
      await redis.quit();
    }

    // --- Worker-process metrics (in-process registry) ---
    const metricsText = await getMetrics().registry.metrics();
    check('agent goal outcomes are counted',
      /trellis_agent_goals_total\{outcome="completed"\} [1-9]/.test(metricsText)
        && /trellis_agent_goals_total\{outcome="failed"\} [1-9]/.test(metricsText),
      'counter series missing');
    check('decisions and task outcomes are counted with bounded labels',
      /trellis_agent_decisions_total\{action="dispatch"\} [1-9]/.test(metricsText)
        && /trellis_agent_tasks_total\{outcome="protocol_violation"\} [1-9]/.test(metricsText),
      'counter series missing');
    check('goal text never appears in metrics exposition',
      !metricsText.includes('summarize what the two probes report')
        && !metricsText.includes('probe a'),
      'goal/task text leaked into metrics');
  } finally {
    onServer?.kill();
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('Test run crashed:', err);
  process.exit(1);
});
