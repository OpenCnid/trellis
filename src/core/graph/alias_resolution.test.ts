import { describe, expect, it } from 'vitest';
import { parseLlmResponse, LlmResponseError } from '../llm/boundary';
import { AliasAdjudicationSchema } from './schemas';
import {
  buildVerdictParams,
  makeOracleAdjudicator,
  SAME_AS_MERGE_CYPHER,
  DISTINCT_FROM_MERGE_CYPHER,
  SELECT_RESOLUTION_ENTITIES_CYPHER,
  EXISTING_VERDICT_PAIRS_CYPHER,
  ALIAS_EXPANSION_CYPHER,
  type AdjudicationContext,
} from './alias_resolution';
import { canonicalPairId, type AliasEntity, type CandidatePair } from './alias_candidates';

function aliasEntity(id: string, name: string, sourceNodeIds: string[]): AliasEntity {
  return { id, name, type: 'Organization', kind: 'generic', sourceNodeIds };
}

function pair(a: AliasEntity, b: AliasEntity): CandidatePair {
  const [first, second] = a.id < b.id ? [a, b] : [b, a];
  return {
    pairId: canonicalPairId(a.id, b.id),
    a: first,
    b: second,
    signal: 'token_containment',
  };
}

describe('AliasAdjudicationSchema through parseLlmResponse', () => {
  const context = 'alias adjudication batch';

  it('accepts a valid batch', () => {
    const payload = JSON.stringify({
      results: [{ pairId: 'a|b', sameEntity: true, confidence: 0.9, reasoning: 'same org' }],
    });
    const parsed = parseLlmResponse(AliasAdjudicationSchema, payload, context);
    expect(parsed.results[0]).toEqual({
      pairId: 'a|b',
      sameEntity: true,
      confidence: 0.9,
      reasoning: 'same org',
    });
  });

  it('fails the empty stage on missing content', () => {
    expect(() => parseLlmResponse(AliasAdjudicationSchema, null, context))
      .toThrowError(LlmResponseError);
    try {
      parseLlmResponse(AliasAdjudicationSchema, '', context);
      expect.unreachable();
    } catch (err) {
      expect((err as LlmResponseError).stage).toBe('empty');
    }
  });

  it('fails the json stage on malformed payloads', () => {
    try {
      parseLlmResponse(AliasAdjudicationSchema, '{"results": [', context);
      expect.unreachable();
    } catch (err) {
      expect((err as LlmResponseError).stage).toBe('json');
    }
  });

  it('fails the schema stage on out-of-range confidence', () => {
    const payload = JSON.stringify({
      results: [{ pairId: 'a|b', sameEntity: false, confidence: 1.5, reasoning: 'x' }],
    });
    try {
      parseLlmResponse(AliasAdjudicationSchema, payload, context);
      expect.unreachable();
    } catch (err) {
      expect((err as LlmResponseError).stage).toBe('schema');
    }
  });
});

describe('buildVerdictParams', () => {
  const low = aliasEntity('aaa', 'globex', ['h1', 'h2']);
  const high = aliasEntity('zzz', 'globex corporation', ['h2', 'h3']);

  it('re-asserts canonical direction regardless of pair orientation', () => {
    const flipped: CandidatePair = { pairId: 'aaa|zzz', a: high, b: low, signal: 'acronym' };
    const params = buildVerdictParams(flipped, { sameEntity: true, confidence: 0.9, reasoning: 'r' }, 'oracle', null);
    expect(params.aId).toBe('aaa');
    expect(params.bId).toBe('zzz');
  });

  it('unions both endpoints\' live provenance, order-preserving and deduplicated', () => {
    const params = buildVerdictParams(pair(low, high), { sameEntity: true, confidence: 1, reasoning: 'r' }, 'oracle', null);
    expect(params.sourceNodeIds).toEqual(['h1', 'h2', 'h3']);
  });

  it('carries verdict metadata and bounds the stored reasoning', () => {
    const longReasoning = 'x'.repeat(2000);
    const params = buildVerdictParams(
      pair(low, high),
      { sameEntity: false, confidence: 0.7, reasoning: longReasoning },
      'llm',
      'test-model'
    );
    expect(params.method).toBe('llm');
    expect(params.model).toBe('test-model');
    expect(params.confidence).toBe(0.7);
    expect(params.reasoning.length).toBeLessThanOrEqual(501);
    expect(params.reasoning.endsWith('…')).toBe(true);
  });

  it('keeps short reasoning intact', () => {
    const params = buildVerdictParams(pair(low, high), { sameEntity: true, confidence: 1, reasoning: 'short' }, 'oracle', null);
    expect(params.reasoning).toBe('short');
  });
});

describe('verdict merge Cypher', () => {
  it('writes SAME_AS for positive and DISTINCT_FROM for negative verdicts', () => {
    expect(SAME_AS_MERGE_CYPHER).toContain('MERGE (a)-[r:SAME_AS]->(b)');
    expect(DISTINCT_FROM_MERGE_CYPHER).toContain('MERGE (a)-[r:DISTINCT_FROM]->(b)');
    expect(SAME_AS_MERGE_CYPHER).not.toContain('DISTINCT_FROM');
    expect(DISTINCT_FROM_MERGE_CYPHER).not.toContain('SAME_AS');
  });

  it('matches endpoints by immutable id, never merging or renaming entities', () => {
    for (const cypher of [SAME_AS_MERGE_CYPHER, DISTINCT_FROM_MERGE_CYPHER]) {
      expect(cypher).toContain('MATCH (a:Entity {id: v.aId})');
      expect(cypher).toContain('MATCH (b:Entity {id: v.bId})');
      expect(cypher).not.toContain('MERGE (a:Entity');
      expect(cypher).not.toContain('DELETE');
      expect(cypher).not.toMatch(/SET\s+[ab]\.name/);
    }
  });

  it('mirrors the extraction merge\'s re-derivation semantics on re-adjudication', () => {
    for (const cypher of [SAME_AS_MERGE_CYPHER, DISTINCT_FROM_MERGE_CYPHER]) {
      expect(cypher).toContain('r.contested = false');
      expect(cypher).toContain('r.rederivedAt = CASE WHEN coalesce(r.contested, false) THEN timestamp()');
      expect(cypher).toContain('NOT h IN coalesce(r.orphanedSourceIds, [])');
      expect(cypher).toContain('r.adjudicatedAt = timestamp()');
      expect(cypher).toContain('r.confidence = v.confidence');
    }
  });
});

describe('selection Cypher', () => {
  it('restricts the pool to uncontested, provenance-bearing generic/concept entities', () => {
    expect(SELECT_RESOLUTION_ENTITIES_CYPHER).toContain("coalesce(n.contested, false) = false");
    expect(SELECT_RESOLUTION_ENTITIES_CYPHER).toContain("coalesce(n.kind, 'generic') IN ['generic', 'concept']");
    expect(SELECT_RESOLUTION_ENTITIES_CYPHER).toContain('size(coalesce(n.sourceNodeIds, [])) > 0');
  });

  it('treats only non-contested verdicts as settled', () => {
    expect(EXISTING_VERDICT_PAIRS_CYPHER).toContain('SAME_AS|DISTINCT_FROM');
    expect(EXISTING_VERDICT_PAIRS_CYPHER).toContain('coalesce(r.contested, false) = false');
  });
});

describe('retrieval expansion Cypher', () => {
  it('filters on non-contested SAME_AS edges at or above the confidence floor', () => {
    expect(ALIAS_EXPANSION_CYPHER).toContain('[s:SAME_AS]');
    expect(ALIAS_EXPANSION_CYPHER).toContain('coalesce(s.contested, false) = false');
    expect(ALIAS_EXPANSION_CYPHER).toContain('s.confidence >= $minConfidence');
  });

  it('expands undirected (canonical edge direction is an id artifact)', () => {
    expect(ALIAS_EXPANSION_CYPHER).toContain('-[s:SAME_AS]-');
    expect(ALIAS_EXPANSION_CYPHER).not.toContain('-[s:SAME_AS]->');
  });
});

describe('makeOracleAdjudicator', () => {
  const contexts: AdjudicationContext[] = [
    { pairId: 'p1', kind: 'generic', a: { name: 'globex', snippet: 's' }, b: { name: 'globex corporation', snippet: 's' } },
    { pairId: 'p2', kind: 'generic', a: { name: 'globex', snippet: 's' }, b: { name: 'initech', snippet: 's' } },
    { pairId: 'p3', kind: 'generic', a: { name: 'x', snippet: 's' }, b: { name: 'y', snippet: 's' } },
  ];

  it('answers from the truth map with full confidence and zero cost', async () => {
    const adjudicate = makeOracleAdjudicator({ p1: true, p2: false });
    const { results, usage } = await adjudicate(contexts);
    expect(results.p1).toMatchObject({ sameEntity: true, confidence: 1.0 });
    expect(results.p2).toMatchObject({ sameEntity: false, confidence: 1.0 });
    expect(usage).toEqual({ subcalls: 0, inputTokens: 0, outputTokens: 0 });
  });

  it('omits pairs absent from the truth map', async () => {
    const adjudicate = makeOracleAdjudicator({ p1: true });
    const { results } = await adjudicate(contexts);
    expect(results.p3).toBeUndefined();
    expect(Object.keys(results)).toEqual(['p1']);
  });
});
