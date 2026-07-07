import { z } from 'zod';
import { OracleScriptSchema } from '../core/agent/oracle.js';

// Session 9: the agent_queue job payload. One job is one goal; the
// goalId is the SSE channel id (`agent-stream:<goalId>`), minted by the
// API exactly like the RLM jobId. The optional oracle script selects
// the zero-LLM decision source for drills; production goals omit it and
// run the real orchestrator.

export const AgentJobDataSchema = z.object({
  goal: z.string().min(1),
  goalId: z.string().min(1),
  oracle: OracleScriptSchema.optional(),
});

export type AgentJobData = z.infer<typeof AgentJobDataSchema>;

/** Normalizes a queue payload; throws a readable error on a malformed job. */
export function parseAgentJobData(data: unknown): AgentJobData {
  const parsed = AgentJobDataSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Invalid agent_queue job data: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
