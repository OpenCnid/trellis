import { describe, expect, it } from 'vitest';
import { ANCHOR_COVERAGE_THRESHOLD, evaluateAnchorGate, extractAnchors } from './anchors';

// Session 19 (design record §7, D2): the derivation gate, v1 —
// deterministic anchor coverage. Extraction pulls corpus-specific
// anchors (numeric comparisons, hyphenated mechanics, distinctive
// vocabulary); scoring measures how many the draft covers; a
// corpus-blind draft fails while a derived draft passes with margin. The
// gate is evidence of contact, not proof of derivation (§7).

// A module-1-style corpus: the workspace-discipline research, with the
// measured anchors the roadmap names (8 vs 4, 0 vs 4, build-new-then-
// rebind, raise-not-truncate) plus the mechanic vocabulary.
const CORPUS_BLOCKS = [
  'The workspace probe measured external tool calls: the workspace arm made 4 while the legacy arm repeated every call, 8 vs 4 across the run.',
  'The dependent seeded task made zero external calls, 0 vs 4 against the unseeded arm — reuse of prior snapshots avoids re-derivation.',
  'Treat a workspace update as an atomic state transition: build-new-then-rebind. Never trust a torn in-place mutation as final state.',
  'Respect the write budget exactly. A write that would exceed budget must raise rather than truncate; stored state is never silently truncated.',
  'Segments hold captured external results with wrapper-owned origin stamps. Read the stored segment before fetching the same content again.',
  'Provenance standing of workspace content is none: a segment id is never a source hash. Promote a segment to earn verified, citable provenance.',
  'When prior material is partially orphaned, mark it contested, exclude it from effective use, and repair it by re-deriving from live source bytes.',
  'Keep the plan and self-notes in workspace state rather than relying on scrollback across turns of a goal.',
];

// A genuinely derived protocol draft: covers the corpus mechanics
// (rebind, budget/truncate, segments, provenance, contested) without
// restating the measured numbers — as a real protocol addendum would.
const DERIVED_DRAFT = [
  'WORKSPACE DISCIPLINE PROTOCOL',
  'Reuse prior workspace snapshots across related tasks instead of re-deriving context; read the stored segment before fetching again.',
  'Treat every workspace update as an atomic transition: build the next state separately, then rebind in one step; never trust a torn in-place mutation.',
  'Respect the write budget exactly: a write that would exceed budget must raise, not silently truncate stored state.',
  'Keep captured external results as segments with their origin stamps; store compact stubs and expand a segment only on demand.',
  'Workspace content has no provenance standing: a segment is never a source hash; earn citable provenance only by promotion.',
  'If prior material is partially orphaned, mark it contested, exclude it, and repair by re-deriving from live bytes.',
  'Keep the plan and notes in workspace state rather than relying on scrollback.',
].join('\n');

// A corpus-blind generic draft: good advice, owes nothing to the corpus.
const GENERIC_DRAFT = [
  'GENERAL PROTOCOL',
  'Always think carefully before acting. Consider every option and pick the best one.',
  'Be helpful and thorough. Break large problems into smaller ones and solve them one at a time.',
  'Double-check your work and explain your reasoning clearly to the user.',
].join('\n');

describe('extractAnchors', () => {
  it('finds the module #1 regression anchors (numeric comparisons and named mechanics)', () => {
    const values = new Set(extractAnchors(CORPUS_BLOCKS).map(a => a.value));
    expect(values.has('8 vs 4')).toBe(true);
    expect(values.has('0 vs 4')).toBe(true);
    expect(values.has('build-new-then-rebind')).toBe(true);
    // The raise-not-truncate mechanic surfaces as the distinctive term.
    expect(values.has('truncate')).toBe(true);
  });

  it('is deterministic and bounded', () => {
    const a = extractAnchors(CORPUS_BLOCKS);
    const b = extractAnchors(CORPUS_BLOCKS);
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(64);
    expect(a.length).toBeGreaterThan(0);
  });

  it('does not surface generic English stopwords as term anchors', () => {
    const values = new Set(extractAnchors(CORPUS_BLOCKS).map(a => a.value));
    for (const stop of ['before', 'across', 'rather', 'through']) {
      expect(values.has(stop)).toBe(false);
    }
  });
});

describe('evaluateAnchorGate', () => {
  it('passes a derived draft with comfortable margin', () => {
    const result = evaluateAnchorGate(CORPUS_BLOCKS, DERIVED_DRAFT);
    expect(result.passed).toBe(true);
    expect(result.ratio).toBeGreaterThan(ANCHOR_COVERAGE_THRESHOLD);
    expect(result.threshold).toBe(ANCHOR_COVERAGE_THRESHOLD);
  });

  it('fails a corpus-blind generic draft', () => {
    const result = evaluateAnchorGate(CORPUS_BLOCKS, GENERIC_DRAFT);
    expect(result.passed).toBe(false);
    expect(result.covered).toBe(0);
  });

  it('respects an explicit threshold at both ends', () => {
    // A derived draft still fails an unreasonably strict threshold.
    expect(evaluateAnchorGate(CORPUS_BLOCKS, DERIVED_DRAFT, 0.99).passed).toBe(false);
    // A generic draft still fails a lenient positive threshold.
    expect(evaluateAnchorGate(CORPUS_BLOCKS, GENERIC_DRAFT, 0.01).passed).toBe(false);
  });

  it('fails closed on an unanchorable corpus (never auto-passes)', () => {
    const result = evaluateAnchorGate([], 'anything at all');
    expect(result.total).toBe(0);
    expect(result.passed).toBe(false);
  });

  // Session 21 calibration: the template forbids the draft from writing
  // measured numerals, so the gate must not count numeric anchors against
  // it. A compliant draft that (correctly) omits every number must not be
  // penalized for the omission.
  it('does not score template-forbidden numeric anchors against a compliant draft', () => {
    const result = evaluateAnchorGate(CORPUS_BLOCKS, DERIVED_DRAFT);
    // The scored anchor set carries no numeric kinds...
    for (const anchor of result.anchors) {
      expect(anchor.kind === 'comparison' || anchor.kind === 'ratio').toBe(false);
    }
    // ...even though extractAnchors still surfaces them for diagnostics.
    const allKinds = new Set(extractAnchors(CORPUS_BLOCKS).map(a => a.kind));
    expect(allKinds.has('comparison')).toBe(true);
  });

  it('a numeral-heavy corpus does not drag a compliant draft below threshold', () => {
    // A corpus whose distinctive anchors are mostly forbidden numerals
    // plus a couple of coverable mechanics. A draft that covers the
    // mechanics and writes no numbers passes — the numerals are not in
    // the denominator.
    const numeralHeavyCorpus = [
      'The workspace arm made 4 calls, the legacy arm 8, a 2.26x reduction; the seeded task made 0 vs 4.',
      'Treat updates as build-new-then-rebind and raise-not-truncate on an over-budget write.',
    ];
    const compliantDraft = [
      'Treat every update as build-new-then-rebind; on an over-budget write, raise rather than truncate.',
    ].join('\n');
    const result = evaluateAnchorGate(numeralHeavyCorpus, compliantDraft);
    expect(result.passed).toBe(true);
  });

  it('reports bounded missing anchors for a failing draft', () => {
    const result = evaluateAnchorGate(CORPUS_BLOCKS, GENERIC_DRAFT);
    expect(result.missing.length).toBeGreaterThan(0);
    expect(result.missing.length).toBeLessThanOrEqual(20);
  });
});
