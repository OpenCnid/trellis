import { describe, expect, it } from 'vitest';
import {
  AUTHOR_EST_OUTPUT_TOKENS,
  AUTHOR_EST_PRICE_PER_1K_USD,
  AUTHOR_EST_PROMPT_OVERHEAD_TOKENS,
  estimateAuthorSpend,
} from './estimate';

// Session 19 follow-up: the pre-flight spend guard. Conservative and
// monotonic — a larger corpus never estimates a smaller cost — so a
// dollar ceiling on the paid run is meaningful.

describe('estimateAuthorSpend', () => {
  it('bounds an empty corpus by the fixed overhead', () => {
    const est = estimateAuthorSpend(0);
    expect(est.inputTokens).toBe(AUTHOR_EST_PROMPT_OVERHEAD_TOKENS);
    expect(est.outputTokens).toBe(AUTHOR_EST_OUTPUT_TOKENS);
    const expectedCost =
      ((AUTHOR_EST_PROMPT_OVERHEAD_TOKENS + AUTHOR_EST_OUTPUT_TOKENS) / 1000) *
      AUTHOR_EST_PRICE_PER_1K_USD;
    expect(est.costUsd).toBeCloseTo(expectedCost, 6);
  });

  it('is monotonic in corpus size', () => {
    expect(estimateAuthorSpend(100_000).costUsd).toBeGreaterThan(
      estimateAuthorSpend(10_000).costUsd
    );
  });

  it('keeps a module-#1-scale corpus well under the $5 ceiling', () => {
    // Module #1's promoted corpus was ~tens of KB; even at 64 KB the
    // conservative estimate stays comfortably under $5.
    expect(estimateAuthorSpend(64 * 1024).costUsd).toBeLessThan(5);
  });

  it('a very large corpus can exceed the ceiling (the guard bites)', () => {
    // ~1 MB of corpus pushes the conservative estimate over $5.
    expect(estimateAuthorSpend(1024 * 1024).costUsd).toBeGreaterThan(5);
  });
});
