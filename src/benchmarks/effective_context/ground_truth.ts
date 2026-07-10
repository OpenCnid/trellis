import crypto from 'node:crypto';

export const FRANKENSTEIN_DOC_KEY = 'book:gutenberg-84:frankenstein';
export const FRANKENSTEIN_SOURCE_URL = 'https://www.gutenberg.org/cache/epub/84/pg84.txt';
export const FRANKENSTEIN_RAW_BYTES = 448_885;
export const FRANKENSTEIN_RAW_SHA256 =
  '7810cd483cffcf2cc8a1d8f0d5807931e69d4f48cd14149b8c76f88af82fead3';
export const FRANKENSTEIN_CORPUS_BYTES = 421_536;
export const FRANKENSTEIN_CORPUS_SHA256 =
  'bde72e6909fb0caebf375b81f7a63140d2b6ffab49a473c670a498dee96934a8';

export const PROBE_PRICE_PER_M_INPUT_USD = 2.5;
export const PROBE_PRICE_PER_M_OUTPUT_USD = 10;

export const GUTENBERG_START_MARKER =
  '*** START OF THE PROJECT GUTENBERG EBOOK FRANKENSTEIN; OR, THE MODERN PROMETHEUS ***';
export const GUTENBERG_END_MARKER =
  '*** END OF THE PROJECT GUTENBERG EBOOK FRANKENSTEIN; OR, THE MODERN PROMETHEUS ***';

export type EffectiveContextArm = 'discipline-on' | 'discipline-off';

export type QuestionSpec =
  | { id: string; kind: 'count'; term: string }
  | { id: string; kind: 'quote'; needle: string }
  | { id: string; kind: 'section'; needle: string };

// Kernel-fixed: an experiment invocation cannot substitute easier questions
// through flags or environment. Expected answers are always derived from the
// committed corpus by buildGroundTruth; none are copied into this table.
export const QUESTION_SPECS: readonly QuestionSpec[] = [
  { id: 'count-justine', kind: 'count', term: 'Justine' },
  { id: 'count-safie', kind: 'count', term: 'Safie' },
  {
    id: 'quote-yellow-eye',
    kind: 'quote',
    needle: 'dull yellow eye of the creature open',
  },
  {
    id: 'quote-adam',
    kind: 'quote',
    needle: 'I ought to be thy Adam',
  },
  {
    id: 'section-floating-ice',
    kind: 'section',
    needle: 'floating sheets of ice that continually pass us',
  },
  {
    id: 'section-wedding-night',
    kind: 'section',
    needle: 'It is well. I go; but remember, I shall be with you on your wedding-night.',
  },
] as const;

export interface GroundTruthQuestion {
  spec: QuestionSpec;
  expected: string | number;
}

export interface ProbeSpendEstimate {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export function estimateProbeRowSpend(
  corpusBytes: number,
  arm: EffectiveContextArm
): ProbeSpendEstimate {
  if (corpusBytes < 0) throw new Error('probe row estimate needs non-negative bytes');
  const corpusTokens = Math.ceil(corpusBytes / 4);
  const inputTokens = 12_000 + (arm === 'discipline-off' ? corpusTokens * 2 : 0);
  const outputTokens = 4_000;
  const costUsd =
    (inputTokens / 1_000_000) * PROBE_PRICE_PER_M_INPUT_USD
    + (outputTokens / 1_000_000) * PROBE_PRICE_PER_M_OUTPUT_USD;
  return { inputTokens, outputTokens, costUsd };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reproduces data/frankenstein.txt from the official UTF-8 download:
 * normalize CRLF to repository-pinned LF, require one exact start/end
 * marker in order, remove both boilerplate regions, trim boundary blank
 * lines, and restore exactly one final LF. Interior bytes are untouched.
 */
export function trimGutenbergBoilerplate(raw: string): string {
  const normalized = raw.replace(/\r\n/g, '\n');
  const startParts = normalized.split(GUTENBERG_START_MARKER);
  const endParts = startParts.length === 2
    ? startParts[1].split(GUTENBERG_END_MARKER)
    : [];
  const starts = startParts.length - 1;
  const ends = normalized.split(GUTENBERG_END_MARKER).length - 1;
  if (startParts.length !== 2 || endParts.length !== 2) {
    throw new Error(`expected one ordered Gutenberg marker pair; found start=${starts}, end=${ends}`);
  }
  return `${endParts[0].trim()}\n`;
}

export function sha256Utf8(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export function normalizeProse(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

export function countWholeWord(text: string, term: string): number {
  if (term.length === 0) throw new Error('count term must be non-empty');
  return [...text.matchAll(new RegExp(`\\b${escapeRegExp(term)}\\b`, 'gu'))].length;
}

function stripOuterQuoteMarks(sentence: string): string {
  return sentence
    .replace(/^[\s\u201c\u201d"'_]+/u, '')
    .replace(/[\s\u201c\u201d"'_]+$/u, '')
    .trim();
}

function whitespaceFlexibleMatches(text: string, needle: string): RegExpMatchArray[] {
  const parts = needle.trim().split(/\s+/u).filter(Boolean);
  if (parts.length === 0) throw new Error('needle must be non-empty');
  const pattern = parts.map(escapeRegExp).join('\\s+');
  return [...text.matchAll(new RegExp(pattern, 'gu'))];
}

/**
 * Finds the unique sentence containing needle while preserving its exact
 * checked-in bytes, including real line wraps. Addresses are derived by the
 * string engine and never persisted.
 */
export function extractSentenceContaining(text: string, needle: string): string {
  const candidates = text.split(/(?<=[.!?])(?=\s)/u);
  const matches = candidates.filter(candidate => whitespaceFlexibleMatches(candidate, needle).length > 0);
  if (matches.length === 0) throw new Error(`quote needle was not found: ${needle}`);
  if (matches.length !== 1) throw new Error(`quote needle is not unique: ${needle}`);
  return stripOuterQuoteMarks(matches[0]);
}

interface Section {
  label: string;
  text: string;
}

export function parseSections(text: string): Section[] {
  const sections: Section[] = [];
  let label: string | null = null;
  let lines: string[] = [];
  const flush = () => {
    if (label !== null) sections.push({ label, text: lines.join('\n') });
  };

  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const heading = /^(Letter|Chapter) ([0-9]+)$/u.exec(line);
    if (heading !== null) {
      flush();
      label = `${heading[1]} ${heading[2]}`;
      lines = [];
    } else if (label !== null) {
      lines.push(line);
    }
  }
  flush();
  return sections;
}

/** Returns the one chapter/letter whose text contains needle. */
export function locateSection(text: string, needle: string): string {
  const sought = normalizeProse(needle);
  const matches = parseSections(text).filter(section => normalizeProse(section.text).includes(sought));
  if (matches.length !== 1) {
    throw new Error(`section needle matched ${matches.length} sections: ${needle}`);
  }
  return matches[0].label;
}

export function buildGroundTruth(
  text: string,
  specs: readonly QuestionSpec[] = QUESTION_SPECS
): GroundTruthQuestion[] {
  return specs.map(spec => {
    switch (spec.kind) {
      case 'count':
        return { spec, expected: countWholeWord(text, spec.term) };
      case 'quote':
        return { spec, expected: extractSentenceContaining(text, spec.needle) };
      case 'section':
        return { spec, expected: locateSection(text, spec.needle) };
    }
  });
}

function canonicalAnswer(text: string): string {
  return normalizeProse(text)
    .replace(/[\u201c\u201d]/gu, '"')
    .replace(/^[-*`_\s"']+|[-*`_\s"']+$/gu, '')
    .trim();
}

function canonicalQuoteAnswer(text: string): string {
  return stripOuterQuoteMarks(text.trim().replace(/\r\n/g, '\n'));
}

export function scoreAnswer(question: GroundTruthQuestion, answer: string | null): boolean {
  if (answer === null) return false;
  const actual = canonicalAnswer(answer);
  if (question.spec.kind === 'count') {
    const countAnswer = answer.trim();
    return /^[0-9]+$/u.test(countAnswer) && Number(countAnswer) === question.expected;
  }
  if (question.spec.kind === 'quote') {
    return canonicalQuoteAnswer(answer) === canonicalQuoteAnswer(String(question.expected));
  }
  const expected = canonicalAnswer(String(question.expected));
  return actual.toLowerCase() === expected.toLowerCase();
}

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('median requires at least one value');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Paid-probe planning estimate. The off arm budgets two full corpus
 * passes per question; both arms budget fixed prompt/handle overhead.
 * It is not a provider-side hard limit: actual spend comes from
 * TRELLIS_TELEMETRY, is checked after every subprocess, and is reported.
 */
export function estimateProbeSpend(
  corpusBytes: number,
  questionCount: number
): ProbeSpendEstimate {
  if (corpusBytes < 0 || !Number.isInteger(questionCount) || questionCount < 1) {
    throw new Error('probe estimate needs non-negative bytes and a positive question count');
  }
  const on = estimateProbeRowSpend(corpusBytes, 'discipline-on');
  const off = estimateProbeRowSpend(corpusBytes, 'discipline-off');
  const inputTokens = questionCount * (on.inputTokens + off.inputTokens);
  const outputTokens = questionCount * (on.outputTokens + off.outputTokens);
  const costUsd = questionCount * (on.costUsd + off.costUsd);
  return { inputTokens, outputTokens, costUsd };
}
