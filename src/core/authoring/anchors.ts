// Session 19 (design record docs/architecture/GROUNDED_AUTHORING.md §7,
// D2): the derivation gate, v1 — deterministic, zero-paid.
//
// This is the belief-verification discipline (verification.ts pattern)
// extended from beliefs to capabilities, at the cheapest tier: does the
// draft addendum show contact with the specific research corpus it
// claims to derive from? We extract corpus-SPECIFIC anchors — numeric
// comparisons, ratios, hyphenated mechanics, and the corpus's
// distinctive vocabulary — and score how many the draft covers. Below a
// modest threshold, assembly refuses.
//
// Honest limits, stated up front (design record §7): anchors are
// evidence of contact, not proof of derivation. A model can chase
// anchors mechanically, and the generic-truth trap (§2) means a
// well-known topic can pass while owing nothing to its corpus. The
// threshold is therefore deliberately modest — the gate is meant to
// catch a corpus-blind draft, not to grade a derived one, and it never
// replaces the human review that caught module #1 (§8).
//
// Everything here is pure and deterministic (sorted, bounded output) so
// the behavior is unit-pinned and re-runs for free inside the module's
// zero-paid acceptance drill (§9.4).

export type AnchorKind = 'comparison' | 'ratio' | 'compound' | 'term';

export interface Anchor {
  kind: AnchorKind;
  /** The normalized string searched for in the draft. */
  value: string;
}

// Modest by design (§7): a draft covering roughly a third of the
// corpus's distinctive anchors has demonstrably read it; a corpus-blind
// draft covers almost none. Kernel constant — human-owned, never
// env-tunable (Guardrail 5), unit-pinned so a change is a reviewed edit.
export const ANCHOR_COVERAGE_THRESHOLD = 0.3;

// Session 21 calibration fix: the authoring template (template.ts) FORBIDS
// the draft from restating measured numerals ("no measured numerals";
// "the durable mechanic ... not the measured numbers behind it"). So the
// numeric anchor kinds — comparisons ("8 vs 4") and ratios ("2.26x",
// "40%") — can NEVER be covered by a template-compliant draft. Counting
// them in the coverage denominator punishes a draft for obeying the
// template: it refused a faithful module #1 v2 draft at 18/64 = 0.28
// whose only "misses" were the four numerals it was forbidden to write
// (18/60 = exactly 0.30 with them excluded). The gate therefore scores
// ONLY the coverable kinds; extractAnchors still surfaces every kind so
// the numeric anchors remain available for diagnostics and reports.
const COVERABLE_ANCHOR_KINDS: ReadonlySet<AnchorKind> = new Set(['compound', 'term']);

// Bounds so the ratio stays meaningful and the extractor cannot be made
// to emit an unbounded anchor set by a large corpus.
const MAX_TERM_ANCHORS = 40;
const MAX_TOTAL_ANCHORS = 64;
const TERM_MIN_LENGTH = 6;
// Coverage stem length: a corpus term is "covered" if this many of its
// leading characters appear in the draft, so truncation/truncate,
// rebind/rebinding, and segment/segments all count as contact.
const TERM_STEM_LENGTH = 6;

// Common English words that are not corpus-specific vocabulary. Only
// words at or above TERM_MIN_LENGTH matter (shorter tokens are dropped
// by the length filter), so this list targets generic long words that
// would otherwise dilute the anchor set and let a generic draft score.
const STOPWORDS = new Set([
  'should', 'would', 'could', 'always', 'before', 'because', 'therefore', 'however',
  'rather', 'cannot', 'within', 'without', 'through', 'across', 'around', 'during',
  'another', 'between', 'itself', 'themselves', 'something', 'everything', 'anything',
  'nothing', 'someone', 'everyone', 'really', 'simply', 'merely', 'mostly', 'likely',
  'unless', 'whether', 'either', 'neither', 'though', 'although', 'instead', 'besides',
  'moreover', 'furthermore', 'whenever', 'wherever', 'whatever', 'whoever', 'exactly',
  'general', 'generally', 'specific', 'specifically', 'particular', 'particularly',
  'example', 'examples', 'following', 'previous', 'current', 'currently', 'various',
  'certain', 'several', 'common', 'commonly', 'usually', 'typically', 'normally',
  'actually', 'basically', 'essentially', 'obviously', 'clearly', 'entire', 'entirely',
  'complete', 'completely', 'provide', 'provides', 'provided', 'require', 'requires',
  'required', 'ensure', 'ensures', 'consider', 'considered', 'include', 'includes',
  'included', 'contain', 'contains', 'contained', 'produce', 'produces', 'produced',
  'perform', 'performs', 'performed', 'become', 'becomes', 'remain', 'remains',
  'appear', 'appears', 'related', 'different', 'difference', 'similar', 'better',
  'toward', 'towards', 'against', 'having', 'itself', 'making', 'taking', 'giving',
  'number', 'amount', 'matter', 'reason', 'reasons', 'others', 'anyone', 'nobody',
]);

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ');
}

function pushUnique(seen: Set<string>, out: Anchor[], anchor: Anchor): void {
  const key = `${anchor.kind}:${anchor.value}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(anchor);
}

/**
 * Extracts corpus-specific anchors from the corpus block texts. Numeric
 * comparisons and ratios and hyphenated compounds come from the joined
 * text; distinctive single-word terms are ranked by how many blocks they
 * appear in (a term the corpus returns to is central to it), with common
 * English filtered out. Deterministic and bounded.
 */
export function extractAnchors(blockTexts: readonly string[]): Anchor[] {
  const joined = normalize(blockTexts.join('\n'));
  const structural: Anchor[] = [];
  const seen = new Set<string>();

  // N vs M / N versus M numeric comparisons ("8 vs 4", "0 vs 4").
  for (const m of joined.matchAll(/\b(\d+)\s+(?:vs\.?|versus)\s+(\d+)\b/g)) {
    pushUnique(seen, structural, { kind: 'comparison', value: `${m[1]} vs ${m[2]}` });
  }
  // Ratios, multipliers, percentages ("2.26x", "1.63", "40%").
  for (const m of joined.matchAll(/\b\d+(?:\.\d+)?x\b/g)) {
    pushUnique(seen, structural, { kind: 'ratio', value: m[0] });
  }
  for (const m of joined.matchAll(/\b\d+\.\d+\b/g)) {
    pushUnique(seen, structural, { kind: 'ratio', value: m[0] });
  }
  for (const m of joined.matchAll(/\b\d+%/g)) {
    pushUnique(seen, structural, { kind: 'ratio', value: m[0] });
  }
  // Hyphenated multi-segment mechanics ("build-new-then-rebind").
  for (const m of joined.matchAll(/\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/g)) {
    if (m[0].length >= 6) {
      pushUnique(seen, structural, { kind: 'compound', value: m[0] });
    }
  }
  structural.sort((a, b) => a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value));

  // Distinctive vocabulary: per-block document frequency over long,
  // non-stopword tokens.
  const docFreq = new Map<string, number>();
  for (const block of blockTexts) {
    const tokens = new Set<string>();
    for (const m of normalize(block).matchAll(/[a-z][a-z]+/g)) {
      const token = m[0];
      if (token.length >= TERM_MIN_LENGTH && !STOPWORDS.has(token)) {
        tokens.add(token);
      }
    }
    for (const token of tokens) {
      docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
    }
  }
  const terms = [...docFreq.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))
    .slice(0, MAX_TERM_ANCHORS)
    .map(([value]): Anchor => ({ kind: 'term', value }));

  return [...structural, ...terms].slice(0, MAX_TOTAL_ANCHORS);
}

/** Is one anchor present in the normalized draft text? */
function anchorCovered(anchor: Anchor, draft: string): boolean {
  if (anchor.kind === 'term') {
    return draft.includes(anchor.value.slice(0, TERM_STEM_LENGTH));
  }
  return draft.includes(anchor.value);
}

export interface AnchorGateResult {
  anchors: Anchor[];
  covered: number;
  total: number;
  ratio: number;
  threshold: number;
  passed: boolean;
  /** Anchors the draft did not cover, bounded for a readable report. */
  missing: Anchor[];
}

const MISSING_LISTING_MAX = 20;

/**
 * Scores the draft addendum's coverage of the corpus anchors and applies
 * the threshold. An empty anchor set (a corpus too small or too generic
 * to yield anchors) does NOT auto-pass: it fails closed, since a corpus
 * that cannot be anchored cannot have its derivation measured at all
 * (choose a more specific corpus, design record §8).
 */
export function evaluateAnchorGate(
  blockTexts: readonly string[],
  draftAddendum: string,
  threshold: number = ANCHOR_COVERAGE_THRESHOLD
): AnchorGateResult {
  // Score only the anchor kinds a template-compliant draft is allowed to
  // cover (numeric comparisons/ratios are template-forbidden — see
  // COVERABLE_ANCHOR_KINDS). A corpus with no coverable anchors still
  // fails closed below (total === 0).
  const anchors = extractAnchors(blockTexts).filter(a => COVERABLE_ANCHOR_KINDS.has(a.kind));
  const draft = normalize(draftAddendum);
  const missing: Anchor[] = [];
  let covered = 0;
  for (const anchor of anchors) {
    if (anchorCovered(anchor, draft)) covered++;
    else missing.push(anchor);
  }
  const total = anchors.length;
  const ratio = total === 0 ? 0 : covered / total;
  return {
    anchors,
    covered,
    total,
    ratio,
    threshold,
    passed: total > 0 && ratio >= threshold,
    missing: missing.slice(0, MISSING_LISTING_MAX),
  };
}
