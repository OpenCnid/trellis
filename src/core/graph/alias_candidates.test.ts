import { describe, expect, it } from 'vitest';
import * as crypto from 'crypto';
import {
  generateAliasCandidates,
  canonicalPairId,
  editDistance,
  effectiveKind,
  isResolvable,
  normalizeTokens,
  type AliasEntity,
} from './alias_candidates';

function id(name: string): string {
  return crypto.createHash('sha256').update(name.toLowerCase()).digest('hex');
}

function entity(name: string, overrides: Partial<AliasEntity> = {}): AliasEntity {
  return {
    id: id(name),
    name: name.toLowerCase(),
    type: 'Organization',
    kind: 'generic',
    sourceNodeIds: ['hash-1'],
    ...overrides,
  };
}

describe('normalizeTokens', () => {
  it('lowercases and splits on punctuation and whitespace', () => {
    expect(normalizeTokens('Globex Corp.')).toEqual(['globex', 'corp']);
    expect(normalizeTokens('acme-industries,  inc')).toEqual(['acme', 'industries', 'inc']);
  });

  it('drops empty tokens entirely', () => {
    expect(normalizeTokens('---')).toEqual([]);
  });
});

describe('editDistance', () => {
  it('computes Levenshtein distance', () => {
    expect(editDistance('globex', 'globex')).toBe(0);
    expect(editDistance('globex corp', 'globex corp.')).toBe(1);
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('', 'abc')).toBe(3);
  });
});

describe('kind discipline', () => {
  it('treats a missing kind as generic (pre-kind extraction output)', () => {
    expect(effectiveKind(null)).toBe('generic');
    expect(effectiveKind(undefined)).toBe('generic');
    expect(effectiveKind('concept')).toBe('concept');
  });

  it('resolves only generic and concept kinds', () => {
    expect(isResolvable({ name: 'globex', kind: 'generic' })).toBe(true);
    expect(isResolvable({ name: 'globex', kind: null })).toBe(true);
    expect(isResolvable({ name: 'growth', kind: 'concept' })).toBe(true);
    expect(isResolvable({ name: 'q_12', kind: 'question' })).toBe(false);
    expect(isResolvable({ name: 'loc', kind: 'category_label' })).toBe(false);
  });

  it('excludes question ids and TREC labels by name even when unstamped', () => {
    expect(isResolvable({ name: 'q_42', kind: null })).toBe(false);
    for (const label of ['abbr', 'enty', 'desc', 'hum', 'loc', 'num']) {
      expect(isResolvable({ name: label, kind: 'generic' })).toBe(false);
    }
  });

  it('never pairs across kinds', () => {
    const pairs = generateAliasCandidates([
      entity('globex', { kind: 'generic' }),
      entity('globex corporation', { kind: 'concept' }),
    ]);
    expect(pairs).toEqual([]);
  });

  it('never proposes question or category_label pairs', () => {
    const pairs = generateAliasCandidates([
      entity('q_1', { kind: 'question' }),
      entity('q_10', { kind: 'question' }),
      entity('loc', { kind: 'category_label' }),
      entity('locs', { kind: 'category_label' }),
    ]);
    expect(pairs).toEqual([]);
  });
});

describe('candidate signals', () => {
  it('proposes token containment: "globex" is contained in "globex corporation"', () => {
    const pairs = generateAliasCandidates([entity('globex'), entity('globex corporation')]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].signal).toBe('token_containment');
  });

  it('containment is punctuation-insensitive', () => {
    const pairs = generateAliasCandidates([entity('acme, inc.'), entity('acme')]);
    expect(pairs).toHaveLength(1);
  });

  it('requires a substantive token: two-letter names do not contain-match everything', () => {
    const pairs = generateAliasCandidates([entity('of'), entity('bank of tomorrow')]);
    expect(pairs).toEqual([]);
  });

  it('proposes acronym matches', () => {
    const pairs = generateAliasCandidates([
      entity('ibm'),
      entity('international business machines'),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].signal).toBe('acronym');
  });

  it('proposes near-identity edit-distance matches (punctuation variants)', () => {
    const pairs = generateAliasCandidates([entity('globex corp'), entity('globex corp.')]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].signal).toBe('edit_distance');
  });

  it('allows distance 2 only for long names', () => {
    expect(generateAliasCandidates([entity('cat'), entity('cot')])).toHaveLength(1);
    expect(generateAliasCandidates([entity('cat'), entity('cob')])).toEqual([]);
    expect(
      generateAliasCandidates([entity('globex industries'), entity('globex industreis')])
    ).toHaveLength(1);
  });

  it('proposes nothing for unrelated names', () => {
    const pairs = generateAliasCandidates([entity('globex'), entity('initech')]);
    expect(pairs).toEqual([]);
  });
});

describe('determinism and ordering', () => {
  it('puts the lexicographically smaller id first in the pair and the pairId', () => {
    const a = entity('globex');
    const b = entity('globex corporation');
    const [pair] = generateAliasCandidates([b, a]);
    expect(pair.a.id < pair.b.id).toBe(true);
    expect(pair.pairId).toBe(`${pair.a.id}|${pair.b.id}`);
    expect(canonicalPairId(b.id, a.id)).toBe(canonicalPairId(a.id, b.id));
  });

  it('is order-independent and deduplicated', () => {
    const entities = [
      entity('globex'),
      entity('globex corporation'),
      entity('globex corp'),
    ];
    const forward = generateAliasCandidates(entities);
    const reversed = generateAliasCandidates([...entities].reverse());
    expect(forward).toEqual(reversed);
    const ids = forward.map(p => p.pairId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('caps deterministically: the same entity set always keeps the same pairs', () => {
    const entities = [
      entity('globex'),
      entity('globex corporation'),
      entity('globex corp'),
      entity('globex group'),
    ];
    const all = generateAliasCandidates(entities);
    expect(all.length).toBeGreaterThan(2);
    const capped = generateAliasCandidates(entities, { maxPairs: 2 });
    expect(capped).toEqual(all.slice(0, 2));
    expect(generateAliasCandidates([...entities].reverse(), { maxPairs: 2 })).toEqual(capped);
  });

  it('excludes already-settled pairs', () => {
    const a = entity('globex');
    const b = entity('globex corporation');
    const settled = new Set([canonicalPairId(a.id, b.id)]);
    expect(generateAliasCandidates([a, b], { excludePairIds: settled })).toEqual([]);
  });

  it('is pure: input entities are not mutated', () => {
    const a = entity('globex');
    const b = entity('globex corporation');
    const aCopy = structuredClone(a);
    const bCopy = structuredClone(b);
    generateAliasCandidates([a, b]);
    expect(a).toEqual(aCopy);
    expect(b).toEqual(bCopy);
  });
});
