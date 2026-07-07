import { z } from 'zod';
import type { RlmResultEnvelope } from '../core/observability/rlm_result.js';
import type { RlmTelemetry } from '../core/observability/rlm_telemetry.js';

// Session 9: the rlm_queue job payload, normalized by a pure helper so
// the worker and tests share one contract. The pre-Session-9 payload
// was exactly `{query, jobId}`; every new field is optional so old
// payloads (and any still queued at deploy time) keep processing.
//
// goalId/taskId follow the IngestJobContext precedent: pure log/stream
// correlation, never behavior. maxIterations is the per-task sub-agent
// iteration ceiling the orchestrator forwards as --max-iterations.

// Zero-LLM dress-rehearsal mode (the ResolutionJobData.oracle
// precedent): instead of spawning the Python agent, the worker replays
// the given stdout through the identical Redis publish + scanner path.
// Data only — a stub can never name a script or executable, so queue
// payloads cannot execute arbitrary code. Absent in production jobs.
export const RlmStubSchema = z.object({
  /** Canned agent stdout, replayed verbatim (FINAL_ANSWER / TRELLIS_* lines included). */
  stdout: z.string().max(256 * 1024),
  exitCode: z.number().int().min(-1).max(255).default(0),
  /** Bounded artificial runtime, for admission-control and concurrency drills. */
  delayMs: z.number().int().nonnegative().max(60_000).default(0),
});

export type RlmStub = z.infer<typeof RlmStubSchema>;

export const RlmJobDataSchema = z.object({
  query: z.string().min(1),
  jobId: z.string().min(1),
  goalId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  maxIterations: z.number().int().positive().max(50).optional(),
  stub: RlmStubSchema.optional(),
});

export type RlmJobData = z.infer<typeof RlmJobDataSchema>;

/** Normalizes a queue payload; throws a readable error on a malformed job. */
export function parseRlmJobData(data: unknown): RlmJobData {
  const parsed = RlmJobDataSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Invalid rlm_queue job data: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/** Argument vector for the spawned agent, from the normalized payload. */
export function buildAgentArgs(scriptPath: string, job: RlmJobData): string[] {
  const args = [scriptPath, '--query', job.query];
  if (job.maxIterations !== undefined) {
    args.push('--max-iterations', String(job.maxIterations));
  }
  // Session 14: goal correlation reaches the agent itself — it stamps
  // workspace segments and gates the Tier-3 workspace on for goal runs.
  if (job.goalId !== undefined) {
    args.push('--goal-id', job.goalId);
  }
  return args;
}

/** Config-derived inputs for the spawned agent's environment. */
export interface AgentEnvConfig {
  pythonPath?: string;
  neo4j: { uri: string; user: string; password: string };
  pgDsn: string;
  /**
   * Canonical validated MCP registry JSON (config.mcp.serversJson);
   * undefined when no servers are configured. Session 10, Guardrail 5:
   * this is the ONLY route by which the Python agent learns of external
   * tool servers — job payloads carry nothing MCP-shaped.
   */
  mcpServersJson?: string;
  /**
   * Exactly the credential env vars the registry's http servers name
   * (config.mcp.credentialEnv, resolved fail-fast at startup). The
   * registry carries only variable NAMES; this map carries the values
   * the child resolves them against (Session 12).
   */
  mcpCredentialEnv?: Record<string, string>;
  /**
   * Tier-3 workspace bounds (Session 14, config.workspace). The child
   * re-validates them defensively with identical maxima; when omitted,
   * any raw inherited values are stripped so the agent only ever sees
   * validated bounds (the TRELLIS_MCP_SERVERS discipline).
   */
  workspace?: { maxSegments: number; maxBytes: number };
  /**
   * Canonical module-selection JSON (Session 15,
   * config.modules.selectionJson). Always the validated serialization —
   * a raw inherited TRELLIS_MODULES can never leak through; when
   * omitted, any inherited value is stripped and the child applies its
   * own default selection.
   */
  modulesJson?: string;
}

/**
 * Environment for the spawned agent, from the validated config. Pure so
 * the forwarding contract is pinned by unit test. The child only ever
 * sees the canonical registry serialization: when no servers are
 * configured, any raw TRELLIS_MCP_SERVERS inherited from the worker's
 * own environment is stripped rather than passed through un-validated.
 */
export function buildAgentEnv(
  base: NodeJS.ProcessEnv,
  cfg: AgentEnvConfig
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...base,
    ...(cfg.pythonPath && { PYTHONPATH: cfg.pythonPath }),
    NEO4J_URI: cfg.neo4j.uri,
    NEO4J_USER: cfg.neo4j.user,
    NEO4J_PASSWORD: cfg.neo4j.password,
    PG_DSN: cfg.pgDsn,
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
  };
  if (cfg.mcpServersJson !== undefined) {
    env.TRELLIS_MCP_SERVERS = cfg.mcpServersJson;
  } else {
    delete env.TRELLIS_MCP_SERVERS;
  }
  if (cfg.workspace !== undefined) {
    env.TRELLIS_WORKSPACE_MAX_SEGMENTS = String(cfg.workspace.maxSegments);
    env.TRELLIS_WORKSPACE_MAX_BYTES = String(cfg.workspace.maxBytes);
  } else {
    delete env.TRELLIS_WORKSPACE_MAX_SEGMENTS;
    delete env.TRELLIS_WORKSPACE_MAX_BYTES;
  }
  if (cfg.modulesJson !== undefined) {
    env.TRELLIS_MODULES = cfg.modulesJson;
  } else {
    delete env.TRELLIS_MODULES;
  }
  // Explicitly set the credential variables the registry names, so the
  // forwarding contract holds regardless of what the base env carries.
  for (const [name, value] of Object.entries(cfg.mcpCredentialEnv ?? {})) {
    env[name] = value;
  }
  return env;
}

/**
 * The worker's completion value (Session 9): the parsed result envelope
 * and telemetry instead of the former placeholder string, so the agent
 * worker can await task results via QueueEvents without re-parsing the
 * stream. Missing lines degrade to null, never to a job failure.
 */
export interface RlmJobCompletion {
  jobId: string;
  goalId?: string;
  taskId?: string;
  result: RlmResultEnvelope | null;
  telemetry: RlmTelemetry | null;
}
