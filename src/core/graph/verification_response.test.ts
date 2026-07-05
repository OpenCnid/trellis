import { describe, expect, it } from 'vitest';
import { indexVerificationResponse } from './verification_response';

describe('indexVerificationResponse', () => {
  it('indexes a complete validated batch by question id', () => {
    expect(indexVerificationResponse(['q1', 'q2'], {
      results: [
        { id: 'q1', label: 'HUM', confidence: 0.91 },
        { id: 'q2', label: 'LOC', confidence: 0.82 },
      ],
    })).toEqual({
      q1: { label: 'hum', confidence: 0.91 },
      q2: { label: 'loc', confidence: 0.82 },
    });
  });

  it('rejects a partial batch instead of silently skipping an answer', () => {
    expect(() => indexVerificationResponse(['q1', 'q2'], {
      results: [{ id: 'q1', label: 'HUM', confidence: 0.91 }],
    })).toThrow('missing=q2');
  });

  it('rejects duplicate and unexpected ids', () => {
    expect(() => indexVerificationResponse(['q1'], {
      results: [
        { id: 'q1', label: 'HUM', confidence: 0.91 },
        { id: 'q1', label: 'LOC', confidence: 0.80 },
        { id: 'qX', label: 'NUM', confidence: 0.70 },
      ],
    })).toThrow('duplicate=q1; unexpected=qX');
  });
});
