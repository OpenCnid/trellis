import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSourceFile } from '../../core/ast/source_parser';
import { collectExtractionBlocks, nodeText } from '../../core/ast/traverse';
import {
  FRANKENSTEIN_CORPUS_BYTES,
  FRANKENSTEIN_CORPUS_SHA256,
  GUTENBERG_END_MARKER,
  GUTENBERG_START_MARKER,
  QUESTION_SPECS,
  buildGroundTruth,
  countWholeWord,
  estimateProbeSpend,
  extractSentenceContaining,
  locateSection,
  median,
  scoreAnswer,
  sha256Utf8,
  trimGutenbergBoilerplate,
} from './ground_truth';

const corpusPath = path.resolve('data/frankenstein.txt');
const corpusBytes = fs.readFileSync(corpusPath);
const corpus = corpusBytes.toString('utf8');

describe('Frankenstein effective-context ground truth', () => {
  it('pins the deterministic boilerplate-free corpus bytes', () => {
    expect(corpusBytes.byteLength).toBe(FRANKENSTEIN_CORPUS_BYTES);
    expect(sha256Utf8(corpus)).toBe(FRANKENSTEIN_CORPUS_SHA256);
    expect(corpusBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
    expect(corpus).not.toContain('\r');
    expect(corpus.endsWith('\n')).toBe(true);
    expect(corpus).not.toContain('START OF THE PROJECT GUTENBERG EBOOK');
    expect(corpus).not.toContain('END OF THE PROJECT GUTENBERG EBOOK');
  });

  it('documents a deterministic, fail-closed Gutenberg trim', () => {
    const raw = [
      'header',
      GUTENBERG_START_MARKER,
      '',
      'Novel line one',
      'Novel line two',
      '',
      GUTENBERG_END_MARKER,
      'footer',
    ].join('\r\n');
    expect(trimGutenbergBoilerplate(raw)).toBe('Novel line one\nNovel line two\n');
    expect(() => trimGutenbergBoilerplate('no markers')).toThrow(/marker pair/);
    expect(() => trimGutenbergBoilerplate(`${raw}\n${GUTENBERG_START_MARKER}`)).toThrow(/start=2/);
  });

  it('uses the exact-byte .txt source parser and fits the workspace segment bound', async () => {
    const parsed = await parseSourceFile('data/frankenstein.txt', corpusBytes, {
      pythonExecutable: 'python',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(nodeText(parsed.root)).toBe(corpus);
    const blocks = collectExtractionBlocks(parsed.root);
    expect(blocks.length).toBeGreaterThan(100);
    expect(blocks.length).toBeLessThanOrEqual(128);
    expect(blocks.every(block => block.type === 'opaque_text')).toBe(true);
  });

  it('computes occurrence counts with engine word boundaries', () => {
    expect(countWholeWord(corpus, 'Justine')).toBe(55);
    expect(countWholeWord(corpus, 'Safie')).toBe(25);
  });

  it('derives exact wrapped sentences instead of hand-copying them', () => {
    expect(extractSentenceContaining(corpus, 'dull yellow eye of the creature open')).toBe(
      'It was already one in the morning; the rain pattered dismally against the\n'
      + 'panes, and my candle was nearly burnt out, when, by the glimmer of the\n'
      + 'half-extinguished light, I saw the dull yellow eye of the creature\n'
      + 'open; it breathed hard, and a convulsive motion agitated its limbs.'
    );
    expect(extractSentenceContaining(corpus, 'I ought to be thy Adam')).toBe(
      'Remember that I am thy creature;\n'
      + 'I ought to be thy Adam, but I am rather the fallen angel, whom thou\n'
      + 'drivest from joy for no misdeed.'
    );
  });

  it('localizes needles through parsed chapter/letter headings', () => {
    expect(locateSection(corpus, 'floating sheets of ice that continually pass us')).toBe('Letter 3');
    expect(locateSection(
      corpus,
      'It is well. I go; but remember, I shall be with you on your wedding-night.'
    )).toBe('Chapter 20');
  });

  it('builds and scores the fixed six-question set', () => {
    const truth = buildGroundTruth(corpus);
    expect(truth).toHaveLength(QUESTION_SPECS.length);
    expect(truth.map(question => question.expected)).toEqual([
      55,
      25,
      expect.stringContaining('dull yellow eye'),
      expect.stringContaining('thy Adam'),
      'Letter 3',
      'Chapter 20',
    ]);
    expect(scoreAnswer(truth[0], '55')).toBe(true);
    expect(scoreAnswer(truth[0], 'There are 55 mentions and 2 variants.')).toBe(false);
    expect(scoreAnswer(truth[0], '-55')).toBe(false);
    expect(scoreAnswer(truth[2], `\u201c${truth[2].expected}\u201d`)).toBe(true);
    expect(scoreAnswer(truth[2], String(truth[2].expected).replace(/\n/g, ' '))).toBe(false);
    expect(scoreAnswer(truth[4], 'letter 3')).toBe(true);
  });

  it('keeps the fixed preflight under the standing five-dollar ceiling', () => {
    const estimate = estimateProbeSpend(corpusBytes.byteLength, QUESTION_SPECS.length);
    expect(estimate.inputTokens).toBe(1_408_608);
    expect(estimate.outputTokens).toBe(48_000);
    expect(estimate.costUsd).toBeGreaterThan(4);
    expect(estimate.costUsd).toBeLessThan(5);
  });

  it('computes medians for odd and even samples', () => {
    expect(median([9, 1, 5])).toBe(5);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(() => median([])).toThrow(/at least one/);
  });
});
