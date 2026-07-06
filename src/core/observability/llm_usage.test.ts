import { describe, expect, it } from 'vitest';
import { Registry } from 'prom-client';
import { createMetrics } from './metrics';
import {
  chatUsage,
  embeddingUsage,
  recordEmbeddingCall,
  recordLlmCall,
} from './llm_usage';

describe('chatUsage', () => {
  it('extracts prompt and completion tokens when the SDK reports them', () => {
    expect(chatUsage({ usage: { prompt_tokens: 812, completion_tokens: 64 } }))
      .toEqual({ inputTokens: 812, outputTokens: 64 });
  });

  it('degrades to zero tokens when usage is absent or partial', () => {
    expect(chatUsage({})).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(chatUsage({ usage: null })).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(chatUsage({ usage: { prompt_tokens: 10 } })).toEqual({ inputTokens: 10, outputTokens: 0 });
  });
});

describe('embeddingUsage', () => {
  it('extracts input tokens and defaults to zero', () => {
    expect(embeddingUsage({ usage: { prompt_tokens: 17 } })).toBe(17);
    expect(embeddingUsage({})).toBe(0);
  });
});

describe('recordLlmCall / recordEmbeddingCall', () => {
  it('labels spend by operation and model only', async () => {
    const metrics = createMetrics(new Registry());
    recordLlmCall(metrics, 'extraction', 'gpt-test', { inputTokens: 100, outputTokens: 20 });
    recordLlmCall(metrics, 'extraction', 'gpt-test', { inputTokens: 50, outputTokens: 5 });
    recordEmbeddingCall(metrics, 'embedding', 'text-embedding-3-small', 33);

    const text = await metrics.registry.metrics();
    expect(text).toContain('trellis_llm_calls_total{operation="extraction",model="gpt-test"} 2');
    expect(text).toContain('trellis_llm_input_tokens_total{operation="extraction",model="gpt-test"} 150');
    expect(text).toContain('trellis_llm_output_tokens_total{operation="extraction",model="gpt-test"} 25');
    expect(text).toContain('trellis_llm_calls_total{operation="embedding",model="text-embedding-3-small"} 1');
    expect(text).toContain('trellis_llm_embedding_tokens_total{operation="embedding",model="text-embedding-3-small"} 33');
  });

  it('still counts the call when the response carried no usage', async () => {
    const metrics = createMetrics(new Registry());
    recordLlmCall(metrics, 'supervision', 'gpt-test', chatUsage({}));

    const text = await metrics.registry.metrics();
    expect(text).toContain('trellis_llm_calls_total{operation="supervision",model="gpt-test"} 1');
    expect(text).not.toContain('trellis_llm_input_tokens_total{operation="supervision"');
  });
});
