import './environment.js';
import { z } from 'zod';
import { parseMcpServers, serializeMcpServers } from './mcp_servers.js';

// Single source of truth for runtime configuration (Guideline:
// .agents/AGENT_CODING_GUIDELINES.md). The environment is read exactly
// once here, validated, and consumed everywhere else through the
// exported `config` object. Defaults match the docker-compose.yml
// development stack so a bare local run needs no .env file.
//
// The Python half of the system (src/rlm/trellis_tools.py) reads
// NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD / PG_DSN from its own
// environment; rlm_worker.ts forwards values derived from this module
// to the spawned process so both halves configure from one place.

const EnvSchema = z.object({
  PG_HOST: z.string().default('127.0.0.1'),
  PG_PORT: z.coerce.number().int().positive().default(5433),
  PG_USER: z.string().default('trellis_user'),
  PG_PASSWORD: z.string().default('trellis_password'),
  PG_DATABASE: z.string().default('trellis_db'),

  NEO4J_URI: z.string().default('bolt://127.0.0.1:7687'),
  NEO4J_USER: z.string().default('neo4j'),
  NEO4J_PASSWORD: z.string().default('trellis_password'),

  REDIS_HOST: z.string().default('127.0.0.1'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),

  // BullMQ history is retained for diagnosis but bounded by both age and
  // count. Age is in seconds, matching BullMQ's KeepJobs contract.
  QUEUE_COMPLETED_RETENTION_SECONDS: z.coerce.number().int().positive().default(3600),
  QUEUE_COMPLETED_RETENTION_COUNT: z.coerce.number().int().positive().default(1000),
  QUEUE_FAILED_RETENTION_SECONDS: z.coerce.number().int().positive().default(604800),
  QUEUE_FAILED_RETENTION_COUNT: z.coerce.number().int().positive().default(5000),

  PORT: z.coerce.number().int().positive().default(3000),

  // Structured logging (T16). Every operational log line is one JSON
  // object on stdout/stderr at or above this level.
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  // Which process this is, as a stable `service` correlation field on
  // every log line. Compose sets `api` and `workers` per container; the
  // unified local entrypoint keeps the default.
  TRELLIS_SERVICE: z.string().min(1).default('trellis'),

  // Worker-process metrics listener (T16). The API serves authenticated
  // /metrics from its own registry; workers run in a separate container,
  // so they expose an internal HTTP listener that Compose deliberately
  // does not publish to the host.
  WORKER_METRICS_PORT: z.coerce.number().int().positive().default(9464),
  WORKER_METRICS_HOST: z.string().min(1).default('0.0.0.0'),

  // API authentication (T6). When set, every operational endpoint requires
  // the key via the x-api-key header, an Authorization: Bearer token, or the
  // api_key query parameter (EventSource cannot set headers). /healthz is an
  // explicit unauthenticated liveness exception. When unset the API is open
  // — acceptable only for local development; the server logs a warning.
  API_KEY: z.string().optional(),

  // /api/rlm-stream protection (T6): each stream spawns a Python process
  // that makes paid LLM calls, so both live connections and queue backlog
  // are capped. Requests beyond either limit receive 429.
  RLM_MAX_CONCURRENT_STREAMS: z.coerce.number().int().positive().default(4),
  RLM_QUEUE_MAX_DEPTH: z.coerce.number().int().positive().default(32),

  // Agentic orchestration bounds (Session 9). Every agentic goal is
  // hard-bounded: decision rounds per goal, total dispatched tasks per
  // goal, tasks per decision batch (run concurrently), and the per-task
  // RLM iteration ceiling forwarded as --max-iterations. Defaults are
  // deliberately small — a goal that trips a bound ends as a typed,
  // streamed failure, never an unbounded loop.
  AGENT_MAX_ITERATIONS_PER_GOAL: z.coerce.number().int().positive().max(9).default(4),
  AGENT_MAX_TASKS_PER_GOAL: z.coerce.number().int().positive().max(9).default(8),
  AGENT_MAX_CONCURRENT_TASKS: z.coerce.number().int().positive().max(9).default(2),
  AGENT_TASK_MAX_ITERATIONS: z.coerce.number().int().positive().max(9).default(5),

  // /api/agent-stream admission (mirrors the RLM stream protection):
  // live goal streams and agent_queue backlog are both capped; requests
  // beyond either limit receive 429.
  AGENT_MAX_CONCURRENT_GOALS: z.coerce.number().int().positive().default(2),
  AGENT_QUEUE_MAX_DEPTH: z.coerce.number().int().positive().default(8),

  // Zero-LLM dress-rehearsal switch: when 'true', /api/agent-stream
  // accepts an `oracle` script (scripted decisions + stubbed tasks, the
  // resolution-oracle precedent) so the loop is drillable with zero paid
  // work. Off by default so the production surface only accepts goals.
  AGENT_ORACLE_ENABLED: z.enum(['true', 'false']).default('false'),

  // Ingestion size limits (T6): raw markdown body and PDF upload caps.
  INGEST_MAX_BODY_MB: z.coerce.number().positive().default(5),
  INGEST_MAX_UPLOAD_MB: z.coerce.number().positive().default(25),

  // Model used for structured extraction, contradiction evaluation, and
  // rubric verification.
  EXTRACTION_MODEL: z.string().default('gpt-5.4-2026-03-05'),

  // Entity resolution (Session 5). SAME_AS edges below the confidence
  // floor exist but do not expand /retrieve; the sweep cap bounds
  // adjudication spend per run; the batch size is pairs per completion.
  RESOLUTION_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.8),
  RESOLUTION_MAX_PAIRS_PER_SWEEP: z.coerce.number().int().positive().default(200),
  RESOLUTION_BATCH_SIZE: z.coerce.number().int().positive().default(25),

  // MCP server registry for the RLM sub-agent (Session 10): a JSON
  // array of {name, command, tools, timeoutMs, maxResultBytes}. Servers,
  // commands, tool allowlists, and per-call bounds come from this value
  // only — never from job payloads or model output. Unset means no
  // external tools and byte-identical pre-Session-10 RLM behavior.
  // Validated by src/config/mcp_servers.ts below (transform-free here so
  // the schema error message stays readable).
  TRELLIS_MCP_SERVERS: z.string().optional(),

  // Interpreter used to spawn the RLM agent and the PDF parser. On
  // Windows the launcher is conventionally `python`; elsewhere `python3`.
  PYTHON_EXECUTABLE: z
    .string()
    .default(process.platform === 'win32' ? 'python' : 'python3'),

  // Optional extra module search path for the spawned Python processes
  // (e.g. a user-level site-packages containing the `rlms` package).
  // Never hardcoded: if unset, the child inherits the parent PYTHONPATH.
  PYTHONPATH: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
}
const env = parsed.data;

// Fail fast at startup on a malformed registry (Guardrail 5): a worker
// that cannot know its tool surface must not run at all.
const mcpServers = parseMcpServers(env.TRELLIS_MCP_SERVERS);

export const config = {
  postgres: {
    host: env.PG_HOST,
    port: env.PG_PORT,
    user: env.PG_USER,
    password: env.PG_PASSWORD,
    database: env.PG_DATABASE,
  },
  neo4j: {
    uri: env.NEO4J_URI,
    user: env.NEO4J_USER,
    password: env.NEO4J_PASSWORD,
  },
  redis: {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
  },
  queueRetention: {
    completedAgeSeconds: env.QUEUE_COMPLETED_RETENTION_SECONDS,
    completedCount: env.QUEUE_COMPLETED_RETENTION_COUNT,
    failedAgeSeconds: env.QUEUE_FAILED_RETENTION_SECONDS,
    failedCount: env.QUEUE_FAILED_RETENTION_COUNT,
  },
  api: {
    port: env.PORT,
    apiKey: env.API_KEY,
  },
  log: {
    level: env.LOG_LEVEL,
  },
  service: env.TRELLIS_SERVICE,
  workerMetrics: {
    port: env.WORKER_METRICS_PORT,
    host: env.WORKER_METRICS_HOST,
  },
  rlmStream: {
    maxConcurrentStreams: env.RLM_MAX_CONCURRENT_STREAMS,
    maxQueueDepth: env.RLM_QUEUE_MAX_DEPTH,
  },
  agent: {
    maxIterationsPerGoal: env.AGENT_MAX_ITERATIONS_PER_GOAL,
    maxTasksPerGoal: env.AGENT_MAX_TASKS_PER_GOAL,
    maxConcurrentTasks: env.AGENT_MAX_CONCURRENT_TASKS,
    taskMaxIterations: env.AGENT_TASK_MAX_ITERATIONS,
    maxConcurrentGoals: env.AGENT_MAX_CONCURRENT_GOALS,
    maxQueueDepth: env.AGENT_QUEUE_MAX_DEPTH,
    oracleEnabled: env.AGENT_ORACLE_ENABLED === 'true',
  },
  ingest: {
    maxBodyMb: env.INGEST_MAX_BODY_MB,
    maxUploadMb: env.INGEST_MAX_UPLOAD_MB,
  },
  llm: {
    extractionModel: env.EXTRACTION_MODEL,
  },
  resolution: {
    minConfidence: env.RESOLUTION_MIN_CONFIDENCE,
    maxPairsPerSweep: env.RESOLUTION_MAX_PAIRS_PER_SWEEP,
    batchSize: env.RESOLUTION_BATCH_SIZE,
  },
  mcp: {
    servers: mcpServers,
    /** Canonical validated JSON for the spawned agent env; undefined when empty. */
    serversJson: serializeMcpServers(mcpServers),
  },
  python: {
    executable: env.PYTHON_EXECUTABLE,
    pythonPath: env.PYTHONPATH,
  },
} as const;

/**
 * libpq-style DSN for the Python tools (psycopg2), derived from the same
 * validated values the TypeScript pool uses.
 */
export function pgDsn(): string {
  const { host, port, user, password, database } = config.postgres;
  return `dbname=${database} user=${user} password=${password} host=${host} port=${port}`;
}
