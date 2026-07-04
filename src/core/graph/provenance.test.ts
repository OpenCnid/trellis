import { describe, it, expect } from 'vitest';
import { BeliefProvenance, applyQuarantineSweep, applyRederivation } from './provenance';

// Canonical form for state comparison: provenance is set-valued, so array
// order must not matter when asserting two execution orders converge.
function canon(s: BeliefProvenance) {
  return {
    sourceNodeIds: [...s.sourceNodeIds].sort(),
    orphanedSourceIds: [...s.orphanedSourceIds].sort(),
    contested: s.contested
  };
}

const state = (
  sourceNodeIds: string[],
  orphanedSourceIds: string[] = [],
  contested = false
): BeliefProvenance => ({ sourceNodeIds, orphanedSourceIds, contested });

describe('applyQuarantineSweep', () => {
  it('quarantines a fact whose only source died', () => {
    const out = applyQuarantineSweep(state(['h1']), new Set(['h1']), new Set(['h2']));
    expect(canon(out)).toEqual({ sourceNodeIds: [], orphanedSourceIds: ['h1'], contested: true });
  });

  it('leaves a fact with no orphaned source untouched (the WHERE clause)', () => {
    const s = state(['h1'], ['h0'], false);
    expect(applyQuarantineSweep(s, new Set(['hX']), new Set())).toBe(s);
  });

  it('contests mixed provenance conservatively when the surviving source is merely retained (PHASE_4_PRD §5)', () => {
    // h2 survives the diff but is NOT fresh — the fact was not re-derived,
    // so the weakest-source rule quarantines it.
    const out = applyQuarantineSweep(state(['h1', 'h2']), new Set(['h1']), new Set(['h3']));
    expect(canon(out)).toEqual({ sourceNodeIds: ['h2'], orphanedSourceIds: ['h1'], contested: true });
  });

  it('does NOT quarantine a fact already re-derived from this version\'s fresh bytes', () => {
    // The racing extraction job appended h2 (fresh) before the sweep ran.
    const out = applyQuarantineSweep(state(['h1', 'h2']), new Set(['h1']), new Set(['h2']));
    expect(canon(out)).toEqual({ sourceNodeIds: ['h2'], orphanedSourceIds: ['h1'], contested: false });
  });

  it('is idempotent', () => {
    const once = applyQuarantineSweep(state(['h1', 'h2']), new Set(['h1']), new Set());
    const twice = applyQuarantineSweep(once, new Set(['h1']), new Set());
    expect(canon(twice)).toEqual(canon(once));
  });

  it('never duplicates an already-recorded orphan', () => {
    // Legacy shape: pre-fix sweeps left orphaned hashes inside sourceNodeIds.
    const out = applyQuarantineSweep(state(['h1', 'h2'], ['h1'], true), new Set(['h1']), new Set());
    expect(canon(out)).toEqual({ sourceNodeIds: ['h2'], orphanedSourceIds: ['h1'], contested: true });
  });
});

describe('applyRederivation', () => {
  it('clears the quarantine and keeps the orphan audit trail (the smoke-test bug)', () => {
    // "acquired Initech in 2024" -> "in 2025": the same (subject, verb,
    // object) edge is re-extracted with fresh block provenance. Before the
    // fix, ON MATCH only appended sourceNodeIds and the edge stayed hidden
    // from /retrieve forever.
    const contestedEdge = state([], ['h1'], true);
    const out = applyRederivation(contestedEdge, ['h2']);
    expect(canon(out)).toEqual({ sourceNodeIds: ['h2'], orphanedSourceIds: ['h1'], contested: false });
  });

  it('filters known-dead sources out of the live set (legacy pre-fix state)', () => {
    const out = applyRederivation(state(['h1', 'h0'], ['h1'], true), ['h2']);
    expect(canon(out)).toEqual({ sourceNodeIds: ['h0', 'h2'], orphanedSourceIds: ['h1'], contested: false });
  });

  it('is a no-op-safe append for an uncontested fact', () => {
    const out = applyRederivation(state(['h1']), ['h2']);
    expect(canon(out)).toEqual({ sourceNodeIds: ['h1', 'h2'], orphanedSourceIds: [], contested: false });
  });

  it('does not duplicate a re-cited source', () => {
    const out = applyRederivation(state(['h1']), ['h1']);
    expect(canon(out)).toEqual({ sourceNodeIds: ['h1'], orphanedSourceIds: [], contested: false });
  });

  it('resurrects a hash whose bytes came back (document reverted to an earlier version)', () => {
    // v1 has h; v2 edits it away (h orphaned); v3 reverts, so the identical
    // content re-hashes to h and extraction re-cites it. h is live again.
    const out = applyRederivation(state(['h2'], ['h'], false), ['h']);
    expect(canon(out)).toEqual({ sourceNodeIds: ['h', 'h2'], orphanedSourceIds: [], contested: false });
  });
});

describe('order independence: sweep and re-extraction commute within one re-ingest', () => {
  it('smoke-test scenario converges to the same state in both orders', () => {
    const edge = state(['h2024']);
    const orphaned = new Set(['h2024']);
    const fresh = new Set(['h2025']);

    const sweepFirst = applyRederivation(applyQuarantineSweep(edge, orphaned, fresh), ['h2025']);
    const extractFirst = applyQuarantineSweep(applyRederivation(edge, ['h2025']), orphaned, fresh);

    expect(canon(sweepFirst)).toEqual(canon(extractFirst));
    expect(canon(sweepFirst)).toEqual({
      sourceNodeIds: ['h2025'],
      orphanedSourceIds: ['h2024'],
      contested: false
    });
  });

  it('revert (A→B→A) converges in both orders across two re-ingests', () => {
    // v2: h orphaned, h' fresh. v3: h' orphaned, h fresh again.
    const afterV2 = applyRederivation(
      applyQuarantineSweep(state(['h']), new Set(['h']), new Set(["h'"])),
      ["h'"]
    );
    expect(canon(afterV2)).toEqual({ sourceNodeIds: ["h'"], orphanedSourceIds: ['h'], contested: false });

    const v3SweepFirst = applyRederivation(
      applyQuarantineSweep(afterV2, new Set(["h'"]), new Set(['h'])),
      ['h']
    );
    const v3ExtractFirst = applyQuarantineSweep(
      applyRederivation(afterV2, ['h']),
      new Set(["h'"]),
      new Set(['h'])
    );
    expect(canon(v3SweepFirst)).toEqual(canon(v3ExtractFirst));
    expect(canon(v3SweepFirst)).toEqual({ sourceNodeIds: ['h'], orphanedSourceIds: ["h'"], contested: false });
  });

  it('commutes for every reachable state over a small hash universe (exhaustive)', () => {
    // Universe: o = a source orphaned by this re-ingest, r = a retained
    // source, d = a source a PREVIOUS re-ingest killed, f = this version's
    // fresh block. /ingest guarantees fresh ∩ orphaned = ∅ and re-derived
    // provenance ⊆ fresh; d ∉ current version so d is in neither set.
    const orphaned = new Set(['o']);
    const fresh = new Set(['f']);
    const incoming = ['f'];

    const subsets = (xs: string[]): string[][] =>
      xs.reduce<string[][]>((acc, x) => [...acc, ...acc.map(s => [...s, x])], [[]]);

    let cases = 0;
    for (const src of subsets(['o', 'r', 'd', 'f'])) {
      for (const orphanedIds of subsets(['d'])) {
        // Reachable states keep live and dead provenance disjoint.
        if (src.includes('d') && orphanedIds.includes('d')) continue;
        for (const contested of [false, true]) {
          const s = state(src, orphanedIds, contested);
          const a = applyRederivation(applyQuarantineSweep(s, orphaned, fresh), incoming);
          const b = applyQuarantineSweep(applyRederivation(s, incoming), orphaned, fresh);
          expect(canon(a)).toEqual(canon(b));
          expect(a.contested).toBe(false); // re-derivation always recovers
          cases++;
        }
      }
    }
    expect(cases).toBe(48);
  });
});
