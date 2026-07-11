// Session 21 (pillar §6.3, docs/architecture/CODE_MEDIATED_TEXT.md): the
// deterministic ground-truth helpers for the effective-context probe.
// Every expected answer is COMPUTED from the committed corpus bytes
// (data/frankenstein.txt) at run time — never hand-typed, and never
// persisted as positions (the T13 invariant applied to measurement).
//
// Everything here is pure; the probe script (scripts/
// exp_effective_context.ts) owns all I/O. The unit test pins both the
// synthetic-fixture behavior and the actual corpus answers, so an edit
// to the committed corpus fails loudly instead of silently shifting the
// probe's truth.

/** Collapses all whitespace runs to single spaces and trims the ends. */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Normalization for comparing a model's echoed quote against the
 * corpus sentence: whitespace-collapsed and typographic quotes and
 * dashes mapped to their ASCII forms (a model that read the bytes may
 * still transliterate the punctuation). Case is preserved — quoting is
 * byte-fidelity work, exactly what the pillar is about.
 */
export function normalizeForComparison(text: string): string {
  return normalizeWhitespace(
    text
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-')
  );
}

/** Non-overlapping occurrences of an exact character sequence. */
export function countOccurrences(text: string, needle: string): number {
  if (needle.length === 0) throw new Error('countOccurrences needs a non-empty needle');
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count++;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

const SENTENCE_TERMINATORS = new Set(['.', '!', '?']);
// Closing punctuation that may trail a terminator before the boundary
// space: typographic and ASCII quotes, closing parenthesis/bracket.
const CLOSERS = new Set(['”', '’', '"', "'", ')', ']']);

/**
 * The single complete sentence containing a phrase. The phrase must
 * occur exactly once across the text's blank-line-separated paragraphs
 * — ambiguity is a question-design error, thrown loudly, never guessed.
 * Extraction happens inside the containing paragraph (headings are
 * their own paragraphs, so an unterminated "Chapter 5" line can never
 * glue onto a chapter-initial sentence), with a sentence boundary being
 * a terminator (. ! ?) plus any closing quotes/brackets followed by a
 * space or the paragraph edge.
 */
export function sentenceContaining(text: string, phrase: string): string {
  const needle = normalizeWhitespace(phrase);
  const paragraphs = text.split(/\n{2,}/).map(normalizeWhitespace);
  const total = paragraphs.reduce(
    (sum, paragraph) => sum + countOccurrences(paragraph, needle),
    0
  );
  if (total !== 1) {
    throw new Error(
      `Phrase must occur exactly once in the normalized text (found ${total}): "${needle}"`
    );
  }
  const normalized = paragraphs.find(paragraph => paragraph.includes(needle)) as string;
  const at = normalized.indexOf(needle);

  // Backward: the sentence starts after the previous boundary.
  let start = 0;
  for (let i = at - 1; i > 0; i--) {
    if (normalized[i] !== ' ') continue;
    let j = i - 1;
    while (j >= 0 && CLOSERS.has(normalized[j])) j--;
    if (j >= 0 && SENTENCE_TERMINATORS.has(normalized[j])) {
      start = i + 1;
      break;
    }
  }

  // Forward: the sentence ends at the next boundary (inclusive of the
  // terminator and any closing punctuation).
  let end = normalized.length;
  for (let i = at + needle.length; i < normalized.length; i++) {
    if (!SENTENCE_TERMINATORS.has(normalized[i])) continue;
    let j = i + 1;
    while (j < normalized.length && CLOSERS.has(normalized[j])) j++;
    if (j >= normalized.length || normalized[j] === ' ') {
      end = j;
      break;
    }
  }
  return normalized.slice(start, end);
}

export interface CorpusSection {
  /** The heading label exactly as it appears, e.g. "Letter 4", "Chapter 5". */
  label: string;
  /** The section body from its heading line to the next heading (or EOF). */
  body: string;
}

const SECTION_HEADING = /^(Letter|Chapter) \d+$/gm;

/**
 * Splits the corpus at its own-line "Letter N" / "Chapter N" headings —
 * the 1831 text's structure (4 letters, 24 chapters). Front matter
 * before the first heading is not a section.
 */
export function splitSections(text: string): CorpusSection[] {
  const headings = [...text.matchAll(SECTION_HEADING)];
  return headings.map((match, i) => ({
    label: match[0],
    body: text.slice(match.index, i + 1 < headings.length ? headings[i + 1].index : text.length),
  }));
}

/**
 * The label of the one section whose body contains the phrase
 * (whitespace-normalized). Exactly one section must match — a phrase
 * that appears in several sections (or only in front matter) cannot
 * anchor a localization question and is refused.
 */
export function sectionContaining(text: string, phrase: string): string {
  const needle = normalizeWhitespace(phrase);
  const matches = splitSections(text).filter(section =>
    normalizeWhitespace(section.body).includes(needle)
  );
  if (matches.length !== 1) {
    throw new Error(
      `Phrase must occur in exactly one section (found ${matches.length}): "${needle}"`
    );
  }
  return matches[0].label;
}

/** The first integer in a model's answer text (commas tolerated), or null. */
export function extractAnswerInteger(answer: string): number | null {
  const match = answer.match(/\d[\d,]*/);
  if (!match) return null;
  return Number(match[0].replace(/,/g, ''));
}

/**
 * The first "Letter N" / "Chapter N" reference in a model's answer,
 * canonicalized ("chapter 5" -> "Chapter 5"), or null. First wins: an
 * answer hedging across several sections is scored on its lead claim.
 */
export function extractAnswerSection(answer: string): string | null {
  const match = answer.match(/\b(letter|chapter)\s+(\d{1,3})\b/i);
  if (!match) return null;
  const kind = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase();
  return `${kind} ${Number(match[2])}`;
}

/** Does the model's answer contain the expected sentence, normalized? */
export function answerContainsSentence(answer: string, sentence: string): boolean {
  return normalizeForComparison(answer).includes(normalizeForComparison(sentence));
}
