import { zodResponseFormat } from 'openai/helpers/zod';
import { config } from '../../config/index.js';
import { parseLlmResponse } from '../llm/boundary.js';
import type { LlmUsage } from '../observability/llm_usage.js';
import {
  OrchestratorDecisionSchema,
  type GoalBounds,
  type GoalIterationRecord,
  type OrchestratorDecision,
} from './decision.js';
import { buildDecisionMessages } from './transcript.js';
import {
  oracleStubsByTaskId,
  toOrchestratorDecision,
  type OracleScript,
} from './oracle.js';

// The two decision sources the agent worker can run: the real
// orchestrator (same LLM as the rest of Trellis, different system
// prompt, plain chat completion through the T8 boundary) and the
// deterministic zero-LLM oracle for drills. Both are pure functions of
// the goal state; all side effects (queues, metrics, streams) stay in
// the worker and the loop's injected dependencies.

export interface DecisionInput {
  goal: string;
  bounds: GoalBounds;
  history: readonly GoalIterationRecord[];
}

export interface DecisionResult {
  decision: OrchestratorDecision;
  /**
   * Stubs attached by an oracle script, keyed by taskId — always empty
   * for the LLM source, whose schema cannot express a stub.
   */
  stubs: Map<string, unknown>;
  usage: LlmUsage & { calls: number };
}

export type DecisionSource = (input: DecisionInput) => Promise<DecisionResult>;

const NO_USAGE = { inputTokens: 0, outputTokens: 0, calls: 0 };

/**
 * Real orchestrator decisions. A malformed or schema-violating
 * completion throws LlmResponseError, which the goal loop converts into
 * a typed goal failure — decision retries are a deliberate non-feature:
 * an interrupted goal must not silently re-spend.
 */
export function makeOpenAIDecisionSource(model = config.llm.extractionModel): DecisionSource {
  return async input => {
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI();
    const completion = await openai.chat.completions.create({
      model,
      messages: buildDecisionMessages(input.goal, input.bounds, input.history),
      response_format: zodResponseFormat(OrchestratorDecisionSchema, 'orchestrator_decision'),
      temperature: 0.1,
    });
    const decision = parseLlmResponse(
      OrchestratorDecisionSchema,
      completion.choices[0].message.content,
      `orchestrator decision (round ${input.history.length + 1})`
    );
    return {
      decision,
      stubs: new Map(),
      usage: {
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
        calls: 1,
      },
    };
  };
}

/**
 * Scripted decisions for zero-LLM drills. Steps are consumed in order;
 * a step's onProtocolViolation branch is taken when any observation of
 * the previous round reported a zero-provenance answer. Running past
 * the script is a decision error (typed goal failure), matching the
 * posture that an oracle drill must never improvise.
 */
export function makeOracleDecisionSource(script: OracleScript): DecisionSource {
  return async input => {
    const step = script.steps[input.history.length];
    if (!step) {
      throw new Error(
        `Oracle script exhausted: no step for decision round ${input.history.length + 1}`
      );
    }
    const lastRound = input.history[input.history.length - 1];
    const violated = lastRound?.observations.some(o => o.status === 'protocol_violation') ?? false;
    const chosen = violated && step.onProtocolViolation ? step.onProtocolViolation : step.decision;
    return {
      decision: toOrchestratorDecision(chosen),
      stubs: oracleStubsByTaskId(chosen),
      usage: { ...NO_USAGE },
    };
  };
}
