import { z } from 'zod';
import type { OrchestratorDecision } from './decision.js';

// Zero-LLM oracle decision source (Session 9 acceptance; the
// makeOracleClassifier / makeOracleAdjudicator precedent). The script
// is plain data so it can ride in an agent_queue job payload: a fixed
// sequence of decision steps, consumed one per decision round. A step
// may carry an onProtocolViolation branch, taken when the previous
// round produced any zero-provenance task result — that is exactly the
// reactivity the live drill must demonstrate without paid calls.
//
// Oracle tasks may attach a `stub` for the rlm_queue job (validated by
// RlmStubSchema at the queue boundary when the job is consumed); the
// LLM decision schema has no such field, so a real orchestrator run can
// never smuggle a stub.

const OracleTaskSchema = z.object({
  taskId: z.string().min(1),
  query: z.string().min(1),
  /** Session 16: scripted seeded dispatches, same shape as the LLM field. */
  seedFromTasks: z.array(z.string().min(1)).max(8).optional(),
  stub: z.unknown().optional(),
});

const OracleDecisionSchema = z.object({
  assessment: z.string().default('oracle scripted decision'),
  action: z.enum(['dispatch', 'finish', 'fail']),
  tasks: z.array(OracleTaskSchema).optional(),
  finalAnswer: z.string().optional(),
  reason: z.string().optional(),
});

const OracleStepSchema = z.object({
  decision: OracleDecisionSchema,
  /** Taken instead of `decision` when the previous round saw a protocol violation. */
  onProtocolViolation: OracleDecisionSchema.optional(),
});

export const OracleScriptSchema = z.object({
  steps: z.array(OracleStepSchema).min(1),
});

export type OracleScript = z.infer<typeof OracleScriptSchema>;
export type OracleDecision = z.infer<typeof OracleDecisionSchema>;

/** Oracle stubs ride outside the OrchestratorDecision shape, keyed by taskId. */
export function oracleStubsByTaskId(decision: OracleDecision): Map<string, unknown> {
  const stubs = new Map<string, unknown>();
  for (const task of decision.tasks ?? []) {
    if (task.stub !== undefined) stubs.set(task.taskId, task.stub);
  }
  return stubs;
}

/** Normalizes a scripted step to the loop's decision shape. */
export function toOrchestratorDecision(decision: OracleDecision): OrchestratorDecision {
  return {
    assessment: decision.assessment,
    action: decision.action,
    tasks: decision.tasks?.map(task => ({
      taskId: task.taskId,
      query: task.query,
      seedFromTasks: task.seedFromTasks ?? null,
    })) ?? null,
    finalAnswer: decision.finalAnswer ?? null,
    reason: decision.reason ?? null,
  };
}
