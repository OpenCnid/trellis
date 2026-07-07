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
  return args;
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
