import './environment.js';
import { z } from 'zod';

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

  // Ingestion size limits (T6): raw markdown body and PDF upload caps.
  INGEST_MAX_BODY_MB: z.coerce.number().positive().default(5),
  INGEST_MAX_UPLOAD_MB: z.coerce.number().positive().default(25),

  // Model used for structured extraction, contradiction evaluation, and
  // rubric verification.
  EXTRACTION_MODEL: z.string().default('gpt-5.4-2026-03-05'),

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
  rlmStream: {
    maxConcurrentStreams: env.RLM_MAX_CONCURRENT_STREAMS,
    maxQueueDepth: env.RLM_QUEUE_MAX_DEPTH,
  },
  ingest: {
    maxBodyMb: env.INGEST_MAX_BODY_MB,
    maxUploadMb: env.INGEST_MAX_UPLOAD_MB,
  },
  llm: {
    extractionModel: env.EXTRACTION_MODEL,
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
