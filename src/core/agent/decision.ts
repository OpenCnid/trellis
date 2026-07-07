import { z } from 'zod';

// Session 9: the orchestrator's decision boundary. The orchestrator is
// the same LLM the rest of Trellis uses, under a planner/mediator
// system prompt — a plain structured chat completion crossing the T8
// parseLlmResponse boundary, never an rlms REPL. Every decision the
// model can express is one of three explicit actions; anything else
// fails schema validation before it can influence the loop.
//
// Structured-output constraint: OpenAI strict JSON schemas require
// every field present, so action-specific fields are nullable rather
// than optional. Cross-field invariants (dispatch needs tasks, finish
// needs finalAnswer, fail needs reason) are enforced by checks below —
// they run in safeParse, so a violating completion fails at the
// 'schema' stage exactly like a missing field.

export const AgentTaskSpecSchema = z.object({
  /** Orchestrator-chosen task label, unique within one dispatch batch. */
  taskId: z.string().min(1),
  /** The single-task query handed to the RLM sub-agent verbatim. */
  query: z.string().min(1),
});

export type AgentTaskSpec = z.infer<typeof AgentTaskSpecSchema>;

export const ORCHESTRATOR_ACTIONS = ['dispatch', 'finish', 'fail'] as const;
export type OrchestratorAction = (typeof ORCHESTRATOR_ACTIONS)[number];

export const OrchestratorDecisionSchema = z
  .object({
    /** The orchestrator's reading of the goal state so far. */
    assessment: z.string(),
    action: z.enum(ORCHESTRATOR_ACTIONS),
    /** dispatch only: the next batch of sub-agent tasks. */
    tasks: z.array(AgentTaskSpecSchema).nullable(),
    /** finish only: the aggregated answer to the goal. */
    finalAnswer: z.string().nullable(),
    /** fail only: why the goal cannot be completed. */
    reason: z.string().nullable(),
  })
  .superRefine((decision, ctx) => {
    if (decision.action === 'dispatch') {
      if (!decision.tasks || decision.tasks.length === 0) {
        ctx.addIssue({ code: 'custom', path: ['tasks'], message: 'dispatch requires at least one task' });
      } else if (new Set(decision.tasks.map(task => task.taskId)).size !== decision.tasks.length) {
        ctx.addIssue({ code: 'custom', path: ['tasks'], message: 'taskIds must be unique within a dispatch batch' });
      }
    }
    if (decision.action === 'finish' && (decision.finalAnswer === null || decision.finalAnswer.trim() === '')) {
      ctx.addIssue({ code: 'custom', path: ['finalAnswer'], message: 'finish requires a finalAnswer' });
    }
    if (decision.action === 'fail' && (decision.reason === null || decision.reason.trim() === '')) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'fail requires a reason' });
    }
  });

export type OrchestratorDecision = z.infer<typeof OrchestratorDecisionSchema>;

/** Per-goal hard bounds, from validated config (Guardrail 5). */
export interface GoalBounds {
  /** Decision rounds per goal. */
  maxIterationsPerGoal: number;
  /** Total sub-agent tasks dispatched across the whole goal. */
  maxTasksPerGoal: number;
  /** Tasks in one dispatch batch; the batch runs concurrently. */
  maxConcurrentTasks: number;
  /** RLM --max-iterations ceiling for each dispatched task. */
  taskMaxIterations: number;
}

/** One sub-agent task's outcome, as an observation for the next decision. */
export interface TaskOutcome {
  taskId: string;
  query: string;
  status: 'ok' | 'protocol_violation' | 'error';
  answer: string | null;
  toolCalls: number | null;
  /** Aggregatable sub-agent spend from TRELLIS_TELEMETRY, when reported. */
  spend: { inputTokens: number; outputTokens: number; subcalls: number } | null;
  /** Failure detail when status is 'error'. */
  error?: string;
}

/** One completed decision round: what was decided and what came back. */
export interface GoalIterationRecord {
  decision: OrchestratorDecision;
  observations: TaskOutcome[];
}
