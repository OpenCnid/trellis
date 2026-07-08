import type { GoalBounds, GoalIterationRecord } from './decision.js';
import { ORCHESTRATOR_SYSTEM_PROMPT } from './orchestrator_prompt.js';

// Pure construction of the orchestrator's chat messages: goal, budget,
// and the observation history, serialized deterministically. Answers
// are individually truncated so a verbose sub-agent cannot grow the
// decision context without bound — the cap is per observation, so late
// iterations still see every earlier result.

/** Per-answer cap inside the decision transcript. */
export const TRANSCRIPT_ANSWER_CHAR_LIMIT = 4000;

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export function truncateForTranscript(text: string, limit = TRANSCRIPT_ANSWER_CHAR_LIMIT): string {
  return text.length > limit ? `${text.slice(0, limit)}… [truncated, ${text.length} chars]` : text;
}

export function renderHistory(history: readonly GoalIterationRecord[]): string {
  if (history.length === 0) {
    return 'No decisions yet — this is your first decision round.';
  }
  const rounds = history.map((record, index) => ({
    round: index + 1,
    assessment: truncateForTranscript(record.decision.assessment),
    action: record.decision.action,
    observations: record.observations.map(outcome => ({
      taskId: outcome.taskId,
      query: truncateForTranscript(outcome.query),
      status: outcome.status,
      answer: outcome.answer === null ? null : truncateForTranscript(outcome.answer),
      toolCalls: outcome.toolCalls,
      // Session 16: the parked-workspace reference, counts only — the
      // orchestrator routes by naming task ids in seedFromTasks, never
      // by seeing workspace content.
      ...(outcome.workspaceRef && { workspaceRef: outcome.workspaceRef }),
      ...(outcome.error && { error: truncateForTranscript(outcome.error) }),
    })),
  }));
  return JSON.stringify(rounds, null, 2);
}

export function buildDecisionMessages(
  goal: string,
  bounds: GoalBounds,
  history: readonly GoalIterationRecord[]
): ChatMessage[] {
  const tasksSoFar = history.reduce((sum, record) => sum + record.observations.length, 0);
  const budget = [
    `- decision rounds: ${history.length + 1} of ${bounds.maxIterationsPerGoal} (this one included)`,
    `- total tasks: ${tasksSoFar} of ${bounds.maxTasksPerGoal} used`,
    `- tasks per dispatch batch: at most ${bounds.maxConcurrentTasks}`,
  ].join('\n');
  return [
    { role: 'system', content: ORCHESTRATOR_SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        `GOAL:\n${goal}\n\nBUDGET:\n${budget}\n\nHISTORY:\n${renderHistory(history)}\n\n`
        + 'Decide your next action now and respond with the decision JSON.',
    },
  ];
}
