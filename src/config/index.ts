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

  PORT: z.coerce.number().int().positive().default(3000),

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
  api: {
    port: env.PORT,
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
