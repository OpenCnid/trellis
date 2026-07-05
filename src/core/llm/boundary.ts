import { z } from 'zod';

// Guideline 2 (Schema Invariant): raw LLM completions are untrusted input.
// zodResponseFormat constrains the *request*, but nothing about the
// transport guarantees the *response* parses — truncated completions,
// refusals, and schema drift all reach the worker as strings. Every worker
// that consumes a completion must cross this boundary instead of calling
// JSON.parse directly.
//
// Failures throw LlmResponseError. Workers let it propagate so BullMQ's
// retry flow re-dispatches the job: completions are sampled, so a fresh
// attempt usually yields a parsable payload. The error carries the failure
// stage and a bounded snippet of the raw payload so a permanently failing
// job is diagnosable from its final failure log (Guideline 1: no silent
// data loss).

export type LlmResponseFailureStage = 'empty' | 'json' | 'schema';

const RAW_SNIPPET_LIMIT = 500;

export class LlmResponseError extends Error {
  readonly stage: LlmResponseFailureStage;
  readonly context: string;
  readonly rawSnippet: string;

  constructor(stage: LlmResponseFailureStage, context: string, detail: string, raw: string) {
    super(`LLM response failed ${stage} validation in ${context}: ${detail}`);
    this.name = 'LlmResponseError';
    this.stage = stage;
    this.context = context;
    this.rawSnippet =
      raw.length > RAW_SNIPPET_LIMIT ? `${raw.slice(0, RAW_SNIPPET_LIMIT)}… [truncated, ${raw.length} chars]` : raw;
  }
}

/**
 * Parses and schema-validates a raw LLM completion payload.
 *
 * @param schema  Zod schema the payload must satisfy.
 * @param raw     The completion content (may be null/undefined — the OpenAI
 *                client types content as nullable).
 * @param context Human-readable location for error messages, e.g.
 *                `extraction job 42 (AST node abc123)`.
 * @throws LlmResponseError when the payload is empty, is not JSON, or does
 *                not satisfy the schema.
 */
export function parseLlmResponse<T>(schema: z.ZodType<T>, raw: string | null | undefined, context: string): T {
  if (raw == null || raw.trim() === '') {
    throw new LlmResponseError('empty', context, 'completion contained no content', raw ?? '');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    throw new LlmResponseError('json', context, `not valid JSON (${(err as Error).message})`, raw);
  }

  const result = schema.safeParse(payload);
  if (!result.success) {
    const issues = result.error.issues
      .map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new LlmResponseError('schema', context, issues, raw);
  }
  return result.data;
}
