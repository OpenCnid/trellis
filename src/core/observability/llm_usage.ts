import type { TrellisMetrics } from './metrics.js';

// LLM spend extraction. The OpenAI SDK reports usage on most, but not
// all, responses — absence must count the call and zero tokens rather
// than throw or skip. Labels are operation/model only; prompts,
// documents, and entity names never reach a metric label.

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

interface ChatUsageShape {
  usage?: {
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
  } | null;
}

interface EmbeddingUsageShape {
  usage?: {
    prompt_tokens?: number | null;
  } | null;
}

export function chatUsage(completion: ChatUsageShape): LlmUsage {
  return {
    inputTokens: completion.usage?.prompt_tokens ?? 0,
    outputTokens: completion.usage?.completion_tokens ?? 0,
  };
}

export function embeddingUsage(response: EmbeddingUsageShape): number {
  return response.usage?.prompt_tokens ?? 0;
}

export function recordLlmCall(
  metrics: TrellisMetrics,
  operation: string,
  model: string,
  usage: LlmUsage
): void {
  const labels = { operation, model };
  metrics.llmCallsTotal.inc(labels);
  if (usage.inputTokens > 0) metrics.llmInputTokensTotal.inc(labels, usage.inputTokens);
  if (usage.outputTokens > 0) metrics.llmOutputTokensTotal.inc(labels, usage.outputTokens);
}

export function recordEmbeddingCall(
  metrics: TrellisMetrics,
  operation: string,
  model: string,
  inputTokens: number
): void {
  const labels = { operation, model };
  metrics.llmCallsTotal.inc(labels);
  if (inputTokens > 0) metrics.llmEmbeddingTokensTotal.inc(labels, inputTokens);
}
