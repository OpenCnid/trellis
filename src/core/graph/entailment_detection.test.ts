import { describe, it, expect } from 'vitest';
import {
  InsightEdge,
  EntailmentPolicy,
  sampleEntailmentPairs,
  entailmentPairKey,
  makeOracleEntailmentJudge,
} from './entailment_detection';
import { mulberry32 } from './verification';

// Session 32 (PROVENANCE_THREADING.md §5.4): the pure half of the sampled
// entailment detector — pair expansion, sampling determinism, the
// judged-at-most-once pool definition, and the budget cap. The judged
// write path (stamps, flags, recovery) is drilled live by
// test:verification-sweep sections [7]-[9].

function edge(overrides: Partial<InsightEdge> = {}): InsightEdge {
  return {
    subject: 's',
    verb: 'relates_to',
    object: 'o',
    sourceNodeIds: ['h1'],
    checkedHashes: [],
    ...overrides,
  };
}

function policy(overrides: Partial<EntailmentPolicy> = {}): EntailmentPolicy {
  return {
    sampleRate: 1.0,
    judgeBudget: 100,
    random: () => 0, // always below any positive rate
    ...overrides,
  };
}

describe('sampleEntailmentPairs', () => {
  it('expands one pair per (edge, cited-hash) and dedupes repeated hashes', () => {
    const sel = sampleEntailmentPairs(
      [edge({ sourceNodeIds: ['h1', 'h2', 'h2'] })],
      policy()
    );
    expect(sel.poolEdges).toBe(1);
    expect(sel.poolPairs).toBe(2);
    expect(sel.pairs.map(p => p.hash)).toEqual(['h1', 'h2']);
  });

  it('excludes judged pairs from the pool: a checked pair is never re-selected', () => {
    const sel = sampleEntailmentPairs(
      [edge({ sourceNodeIds: ['h1', 'h2'], checkedHashes: ['h1'] })],
      policy()
    );
    expect(sel.poolPairs).toBe(1);
    expect(sel.pairs.map(p => p.hash)).toEqual(['h2']);
  });

  it('a NEW hash on a re-derived edge is a new pair and re-enters the pool', () => {
    // The edge was fully checked, then re-derived citing one more hash.
    const before = sampleEntailmentPairs(
      [edge({ sourceNodeIds: ['h1', 'h2'], checkedHashes: ['h1', 'h2'] })],
      policy()
    );
    expect(before.poolPairs).toBe(0);
    const after = sampleEntailmentPairs(
      [edge({ sourceNodeIds: ['h1', 'h2', 'h3'], checkedHashes: ['h1', 'h2'] })],
      policy()
    );
    expect(after.poolPairs).toBe(1);
    expect(after.pairs.map(p => p.hash)).toEqual(['h3']);
  });

  it('the same hash cited by two edges is two distinct pairs', () => {
    const sel = sampleEntailmentPairs(
      [
        edge({ subject: 'a', sourceNodeIds: ['h1'] }),
        edge({ subject: 'b', sourceNodeIds: ['h1'] }),
      ],
      policy()
    );
    expect(sel.poolPairs).toBe(2);
    expect(sel.pairs.map(p => `${p.subject}:${p.hash}`)).toEqual(['a:h1', 'b:h1']);
  });

  it('is deterministic under a seeded RNG', () => {
    const edges = Array.from({ length: 20 }, (_, i) =>
      edge({ subject: `s${i}`, sourceNodeIds: [`h${i}a`, `h${i}b`] })
    );
    const run = () =>
      sampleEntailmentPairs(edges, policy({ sampleRate: 0.5, random: mulberry32(42) }));
    const first = run();
    const second = run();
    expect(second).toEqual(first);
    expect(first.sampled).toBeGreaterThan(0);
    expect(first.sampled).toBeLessThan(40);
  });

  it('rate 0 samples nothing but still counts the pool', () => {
    const sel = sampleEntailmentPairs(
      [edge({ sourceNodeIds: ['h1', 'h2'] })],
      policy({ sampleRate: 0, random: Math.random })
    );
    expect(sel.poolPairs).toBe(2);
    expect(sel.sampled).toBe(0);
    expect(sel.pairs).toEqual([]);
    expect(sel.deferred).toBe(0);
  });

  it('never exceeds the judge budget and counts the overflow as deferred', () => {
    const edges = Array.from({ length: 10 }, (_, i) =>
      edge({ subject: `s${i}`, sourceNodeIds: [`h${i}`] })
    );
    const sel = sampleEntailmentPairs(edges, policy({ judgeBudget: 3 }));
    expect(sel.poolPairs).toBe(10);
    expect(sel.sampled).toBe(10);
    expect(sel.pairs.length).toBe(3);
    expect(sel.deferred).toBe(7);
  });
});

describe('entailmentPairKey', () => {
  it('is the stable pipe-joined pair identity', () => {
    expect(
      entailmentPairKey({ subject: 'a', verb: 'v', object: 'b', hash: 'h' })
    ).toBe('a|v|b|h');
  });
});

describe('makeOracleEntailmentJudge', () => {
  const pair = { subject: 'a', verb: 'v', object: 'b', hash: 'h', text: 'bytes' };

  it('answers from the truth map at zero cost', async () => {
    const judge = makeOracleEntailmentJudge({ 'a|v|b|h': false });
    const { verdict, usage } = await judge(pair);
    expect(verdict).toEqual({ supported: false });
    expect(usage).toEqual({ subcalls: 0, inputTokens: 0, outputTokens: 0 });
  });

  it('declines pairs absent from the map (null verdict, skipped by the caller)', async () => {
    const judge = makeOracleEntailmentJudge({});
    const { verdict } = await judge(pair);
    expect(verdict).toBeNull();
  });
});
