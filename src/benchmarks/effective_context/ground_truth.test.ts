import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import {
  answerContainsSentence,
  countOccurrences,
  extractAnswerInteger,
  extractAnswerSection,
  normalizeForComparison,
  normalizeWhitespace,
  sectionContaining,
  sentenceContaining,
  splitSections,
} from './ground_truth';

// Session 21: the probe's ground truth is computed, never hand-typed —
// these tests pin (a) the pure helper behavior on synthetic fixtures and
// (b) the actual answers over the committed corpus, so an accidental
// corpus edit (or a line-ending mangle on checkout) fails loudly instead
// of silently moving the probe's truth.

const FIXTURE = [
  'Letter 1',
  '',
  'My dear sister. I write in haste from the north. The sledge dogs are',
  'restless tonight.',
  '',
  'Chapter 1',
  '',
  'It was a cold morning! Victor said "the experiment begins today." The',
  'sledge waited outside.',
  '',
  'Chapter 2',
  '',
  'Nothing here mentions the vehicle at all.',
].join('\n');

describe('normalizeWhitespace / normalizeForComparison', () => {
  it('collapses runs and trims', () => {
    expect(normalizeWhitespace('  a\n b\t\tc ')).toBe('a b c');
  });
  it('maps typographic quotes and dashes to ASCII, preserving case', () => {
    expect(normalizeForComparison('“He said — ‘No.’”')).toBe('"He said - \'No.\'"');
  });
});

describe('countOccurrences', () => {
  it('counts non-overlapping exact sequences', () => {
    expect(countOccurrences('aba aba', 'aba')).toBe(2);
    expect(countOccurrences('aaaa', 'aa')).toBe(2);
    expect(countOccurrences(FIXTURE, 'sledge')).toBe(2);
    expect(countOccurrences(FIXTURE, 'absent')).toBe(0);
  });
  it('refuses an empty needle', () => {
    expect(() => countOccurrences('abc', '')).toThrow(/non-empty/);
  });
});

describe('sentenceContaining', () => {
  it('extracts the full sentence across original line breaks', () => {
    expect(sentenceContaining(FIXTURE, 'dogs are restless')).toBe(
      'The sledge dogs are restless tonight.'
    );
  });
  it('treats ! and closing quotes as boundaries', () => {
    expect(sentenceContaining(FIXTURE, 'cold morning')).toBe('It was a cold morning!');
    expect(sentenceContaining(FIXTURE, 'experiment begins')).toBe(
      'Victor said "the experiment begins today."'
    );
  });
  it('refuses a phrase that is absent or ambiguous', () => {
    expect(() => sentenceContaining(FIXTURE, 'no such phrase')).toThrow(/exactly once/);
    expect(() => sentenceContaining(FIXTURE, 'sledge')).toThrow(/exactly once/);
  });
});

describe('splitSections / sectionContaining', () => {
  it('splits at own-line Letter/Chapter headings', () => {
    expect(splitSections(FIXTURE).map(s => s.label)).toEqual([
      'Letter 1',
      'Chapter 1',
      'Chapter 2',
    ]);
  });
  it('localizes a phrase to its one section', () => {
    expect(sectionContaining(FIXTURE, 'cold morning')).toBe('Chapter 1');
    expect(sectionContaining(FIXTURE, 'dogs are restless')).toBe('Letter 1');
  });
  it('refuses a phrase spanning several sections or none', () => {
    expect(() => sectionContaining(FIXTURE, 'sledge')).toThrow(/exactly one section/);
    expect(() => sectionContaining(FIXTURE, 'no such phrase')).toThrow(/exactly one section/);
  });
});

describe('answer extraction', () => {
  it('extracts the first integer, tolerating commas and prose', () => {
    expect(extractAnswerInteger('The name appears 55 times.')).toBe(55);
    expect(extractAnswerInteger('1,234 occurrences')).toBe(1234);
    expect(extractAnswerInteger('none found')).toBeNull();
  });
  it('extracts and canonicalizes the first section reference', () => {
    expect(extractAnswerSection('It appears in chapter 5, early on.')).toBe('Chapter 5');
    expect(extractAnswerSection('LETTER 04')).toBe('Letter 4');
    expect(extractAnswerSection('chapter 17')).toBe('Chapter 17');
    expect(extractAnswerSection('somewhere in the middle')).toBeNull();
  });
  it('does not confuse Chapter 1 with Chapter 17', () => {
    expect(extractAnswerSection('Chapter 17')).not.toBe('Chapter 1');
  });
  it('compares quotes whitespace- and punctuation-normalized', () => {
    expect(
      answerContainsSentence(
        'The sentence is: “He was   soon borne away by the waves and lost in darkness and distance.”',
        'He was soon borne away by the\nwaves and lost in darkness and distance.'
      )
    ).toBe(true);
    expect(answerContainsSentence('Different words entirely.', 'He was soon borne away.')).toBe(
      false
    );
  });
});

// --- The committed corpus itself (data/frankenstein.txt) -------------------

describe('the committed Frankenstein corpus', () => {
  const corpusPath = path.resolve(__dirname, '../../../data/frankenstein.txt');
  const corpus = fs.readFileSync(corpusPath, 'utf-8');

  it('is byte-stable (LF-only; the .gitattributes -text pin held)', () => {
    expect(corpus.includes('\r')).toBe(false);
    expect(Buffer.byteLength(corpus, 'utf8')).toBe(421536);
    expect(crypto.createHash('sha256').update(corpus, 'utf8').digest('hex')).toBe(
      'bde72e6909fb0caebf375b81f7a63140d2b6ffab49a473c670a498dee96934a8'
    );
  });

  it('has the 1831 structure: 4 letters then 24 chapters', () => {
    const labels = splitSections(corpus).map(s => s.label);
    expect(labels).toHaveLength(28);
    expect(labels.slice(0, 4)).toEqual(['Letter 1', 'Letter 2', 'Letter 3', 'Letter 4']);
    expect(labels[4]).toBe('Chapter 1');
    expect(labels[27]).toBe('Chapter 24');
  });

  it('pins the probe question ground truths', () => {
    expect(countOccurrences(corpus, 'Justine')).toBe(55);
    expect(countOccurrences(corpus, 'Ingolstadt')).toBe(16);
    expect(sentenceContaining(corpus, 'the beauty of the dream vanished')).toBe(
      'I had desired it with an ardour that far exceeded moderation; but now that I had '
        + 'finished, the beauty of the dream vanished, and breathless horror and disgust '
        + 'filled my heart.'
    );
    expect(sentenceContaining(corpus, 'borne away by the waves')).toBe(
      'He was soon borne away by the waves and lost in darkness and distance.'
    );
    expect(sectionContaining(corpus, 'It was on a dreary night of November')).toBe('Chapter 5');
    expect(sectionContaining(corpus, 'apparently of gigantic stature')).toBe('Letter 4');
  });
});
