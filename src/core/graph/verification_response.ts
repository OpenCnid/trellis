import type { VerificationResponse } from './schemas.js';

export interface IndexedVerificationAnswer {
  label: string;
  confidence: number;
}

/**
 * Enforces semantic coverage after structural Zod validation. A response with
 * missing, duplicate, or hallucinated ids fails the worker attempt instead of
 * turning missing answers into a successful partial verification pass.
 */
export function indexVerificationResponse(
  expectedIds: readonly string[],
  response: VerificationResponse
): Record<string, IndexedVerificationAnswer> {
  const expected = new Set(expectedIds);
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  const unexpected = new Set<string>();
  const indexed: Record<string, IndexedVerificationAnswer> = {};

  for (const answer of response.results) {
    if (seen.has(answer.id)) duplicate.add(answer.id);
    seen.add(answer.id);
    if (!expected.has(answer.id)) unexpected.add(answer.id);
    indexed[answer.id] = {
      label: answer.label.toLowerCase(),
      confidence: answer.confidence,
    };
  }

  const missing = expectedIds.filter(id => !seen.has(id));
  if (missing.length > 0 || duplicate.size > 0 || unexpected.size > 0) {
    const detail = [
      missing.length > 0 ? `missing=${missing.join(',')}` : '',
      duplicate.size > 0 ? `duplicate=${[...duplicate].join(',')}` : '',
      unexpected.size > 0 ? `unexpected=${[...unexpected].join(',')}` : '',
    ].filter(Boolean).join('; ');
    throw new Error(`Verification response coverage mismatch: ${detail}`);
  }

  return indexed;
}
