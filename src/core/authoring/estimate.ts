// Session 19 follow-up: a conservative pre-flight spend estimate for a
// paid grounded-authoring run, so the driver can refuse to spawn a run
// whose estimated cost exceeds an operator-set ceiling (default $5). The
// estimate is a GUARDRAIL INPUT, not an invoice — the run reports its
// real cost from usage tracking (`reported_cost_usd`), which the driver
// prints after the fact.
//
// gpt-5.4 pricing is operator knowledge; these constants are deliberately
// conservative, derived from the module #1 measurement (≈168k tokens
// billed under $2 ⇒ well under ~$0.012/1k). We round the blended rate UP
// to $0.02/1k so the estimate never materially undershoots, and we assume
// the model reads the whole seeded corpus into context a few times over
// its iterations. Author mode has no whole-DB search, so the real spend
// is expected far below the module #1 figure.

export const AUTHOR_EST_PRICE_PER_1K_USD = 0.02;
export const AUTHOR_EST_PROMPT_OVERHEAD_TOKENS = 12_000;
export const AUTHOR_EST_OUTPUT_TOKENS = 10_000;
export const AUTHOR_EST_CORPUS_READ_FACTOR = 3;
const CHARS_PER_TOKEN = 4;

export interface SpendEstimate {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/**
 * Estimates the paid spend of one author run from the seeded corpus size.
 * Pure and unit-pinned; the driver feeds it the seed byte footprint.
 */
export function estimateAuthorSpend(corpusBytes: number): SpendEstimate {
  const corpusTokens = Math.ceil(Math.max(0, corpusBytes) / CHARS_PER_TOKEN);
  const inputTokens =
    AUTHOR_EST_PROMPT_OVERHEAD_TOKENS + corpusTokens * AUTHOR_EST_CORPUS_READ_FACTOR;
  const outputTokens = AUTHOR_EST_OUTPUT_TOKENS;
  const costUsd = ((inputTokens + outputTokens) / 1000) * AUTHOR_EST_PRICE_PER_1K_USD;
  return { inputTokens, outputTokens, costUsd };
}
