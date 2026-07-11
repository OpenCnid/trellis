import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import {
  answerContainsSentence,
  boundaryPreservedReconstruction,
  classifyLocalizationMethod,
  countOccurrences,
  extractAnswerInteger,
  extractAnswerSection,
  extractAnswerSectionBy,
  lineAnchoredHeadingLabels,
  normalizeForComparison,
  normalizeWhitespace,
  replaceUniqueLine,
  sectionContaining,
  sectionContainingBy,
  sentenceContaining,
  splitSections,
  splitSectionsBy,
} from './ground_truth';
import { parseMarkdownToAST } from '../../core/ast/parser';
import { collectExtractionBlocks, nodeText } from '../../core/ast/traverse';

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

// --- Session 22 additions ----------------------------------------------------

describe('splitSectionsBy / sectionContainingBy / extractAnswerSectionBy', () => {
  const entries = [
    'Front matter before any section.',
    '',
    'Entry 1',
    '',
    'The first sitting records a quiet season.',
    '',
    'Entry 2',
    '',
    'The second sitting mentions the lost astrolabe once.',
  ].join('\n');

  it('splits on parameterized own-line headings', () => {
    const labels = splitSectionsBy(entries, ['Entry']).map(s => s.label);
    expect(labels).toEqual(['Entry 1', 'Entry 2']);
  });

  it('locates a phrase to its one section and refuses ambiguity', () => {
    expect(sectionContainingBy(entries, 'lost astrolabe', ['Entry'])).toBe('Entry 2');
    expect(() => sectionContainingBy(entries, 'sitting', ['Entry'])).toThrow(/exactly one/);
    expect(() => sectionContainingBy(entries, 'Front matter', ['Entry'])).toThrow(/found 0/);
    expect(() => splitSectionsBy(entries, [])).toThrow(/at least one/);
  });

  it('extracts and canonicalizes a parameterized section answer', () => {
    expect(extractAnswerSectionBy('it appears in entry 07.', ['Entry'])).toBe('Entry 7');
    expect(extractAnswerSectionBy('no section named', ['Entry'])).toBeNull();
    // The default form still behaves as before.
    expect(extractAnswerSection('probably chapter 5')).toBe('Chapter 5');
  });
});

describe('replaceUniqueLine', () => {
  const file = ['header', 'QUOTE: <<AWAITING>>', '', 'footer'].join('\n');

  it('replaces exactly the marker line, preserving every other byte', () => {
    expect(replaceUniqueLine(file, '<<AWAITING>>', 'QUOTE: found it.')).toBe(
      ['header', 'QUOTE: found it.', '', 'footer'].join('\n')
    );
  });

  it('refuses zero or multiple marker lines and multi-line replacements', () => {
    expect(() => replaceUniqueLine(file, '<<MISSING>>', 'x')).toThrow(/found 0/);
    expect(() => replaceUniqueLine(`${file}\n<<AWAITING>>`, '<<AWAITING>>', 'x')).toThrow(/found 2/);
    expect(() => replaceUniqueLine(file, '<<AWAITING>>', 'a\nb')).toThrow(/newline-free/);
  });
});

// --- Session 23 additions ------------------------------------------------------
// The localization design finding (pillar §6.3 round 3): how much of the
// naive line-anchored heading method does today's glued reconstruction
// break, and would preserving block boundaries repair it? These numbers
// are computed purely from the committed corpora (parse -> reconstruct),
// no database — the same arithmetic the probe script prints during
// --ingest against the STORED roots.

describe('lineAnchoredHeadingLabels / boundaryPreservedReconstruction', () => {
  it('sees own-line headings only where line starts survive', () => {
    const preserved = ['Entry 1', 'body one.', 'Entry 2', 'body two.'].join('\n\n');
    expect(lineAnchoredHeadingLabels(preserved, ['Entry'])).toEqual(['Entry 1', 'Entry 2']);
    // Glued (no separator): no line starts, no matches.
    expect(lineAnchoredHeadingLabels('body one.Entry 2body two.', ['Entry'])).toEqual([]);
  });

  it('quantifies the chronicle: gluing hides ALL 48 headings; boundaries restore them', () => {
    const corpus = fs.readFileSync(
      path.resolve(__dirname, '../../../data/synthetic_chronicle.txt'),
      'utf-8'
    );
    const root = parseMarkdownToAST(corpus);
    const glued = nodeText(root);
    const preserved = boundaryPreservedReconstruction(
      collectExtractionBlocks(root).map(nodeText)
    );
    expect(lineAnchoredHeadingLabels(corpus, ['Entry'])).toHaveLength(48);
    // The chronicle's paragraphs are single lines, so the glued
    // reconstruction is ONE line: the naive method finds nothing — the
    // exact mechanism of both round-2 chronicle locate misses
    // ("Entry None" / "Entry ?").
    expect(glued.includes('\n')).toBe(false);
    expect(lineAnchoredHeadingLabels(glued, ['Entry'])).toHaveLength(0);
    expect(lineAnchoredHeadingLabels(preserved, ['Entry'])).toHaveLength(48);
    // And the boundary-preserved text yields the SAME localization
    // answers as the source bytes (spot-checked on a planted anomaly).
    expect(sectionContainingBy(preserved, 'the astrolabe of Veldenmoor', ['Entry']))
      .toBe(sectionContainingBy(corpus, 'the astrolabe of Veldenmoor', ['Entry']));
  });

  it('quantifies frank: gluing leaves ONLY misleading TOC lines; boundaries restore the real headings', () => {
    const corpus = fs.readFileSync(
      path.resolve(__dirname, '../../../data/frankenstein.txt'),
      'utf-8'
    );
    const root = parseMarkdownToAST(corpus);
    const glued = nodeText(root);
    const preserved = boundaryPreservedReconstruction(
      collectExtractionBlocks(root).map(nodeText)
    );
    const kinds = ['Letter', 'Chapter'];
    // Source: exactly the 28 real headings (the TOC lines are indented).
    expect(lineAnchoredHeadingLabels(corpus, kinds)).toHaveLength(28);
    // Glued: every real heading loses its line start; what remains are
    // table-of-contents lines (indentation stripped by the parse, line
    // breaks preserved INSIDE the TOC block) — the exact mechanism of
    // the round-2 "Chapter 23" miss, where nearest-heading-before-phrase
    // resolved to the last visible TOC line.
    const gluedLabels = lineAnchoredHeadingLabels(glued, kinds);
    expect(gluedLabels).toHaveLength(26);
    // The last visible label is "Chapter 23" — the round-2 wrong answer
    // verbatim ("Chapter 24", the TOC's final line, loses its line END
    // to the glue).
    expect(gluedLabels[gluedLabels.length - 1]).toBe('Chapter 23');
    expect(gluedLabels.filter(l => l === 'Chapter 5')).toHaveLength(1); // TOC only
    // Boundary-preserved: all 28 real headings return (the 28 TOC lines
    // inside the contents block still match — a caveat for the
    // recommendation, not a repair failure: nearest-heading-before now
    // resolves to the real heading because the real headings exist).
    const preservedLabels = lineAnchoredHeadingLabels(preserved, kinds);
    expect(preservedLabels).toHaveLength(28 + 28);
    expect(sectionContainingBy(preserved, 'It was on a dreary night of November', kinds))
      .toBe('Chapter 5');
  });

  it('quantifies the second trap: gluing destroys trailing word boundaries too', () => {
    // Measured live in round 3 (off-arm locate-November r3): a
    // position-independent shape scan STILL missed when its pattern
    // ended in \b — the glue puts the next block's first letter right
    // after the heading's final digit ("Chapter 5It was on..."), and
    // \d+\b cannot match a digit followed by a letter. The nearest
    // visible heading before the phrase becomes the TOC's "Chapter 23"
    // — the exact wrong answer of BOTH rounds — while the
    // boundary-preserved reconstruction resolves to the real Chapter 5.
    const frank = fs.readFileSync(
      path.resolve(__dirname, '../../../data/frankenstein.txt'),
      'utf-8'
    );
    const root = parseMarkdownToAST(frank);
    const glued = nodeText(root);
    const preserved = boundaryPreservedReconstruction(
      collectExtractionBlocks(root).map(nodeText)
    );
    const shapeWithBoundary = /(Letter|Chapter)\s+\d+\b/g;
    expect([...glued.matchAll(shapeWithBoundary)]).toHaveLength(33);
    expect([...preserved.matchAll(shapeWithBoundary)]).toHaveLength(56);
    const phrase = 'It was on a dreary night of November';
    const nearestBefore = (text: string) => {
      const at = text.indexOf(phrase);
      const before = [...text.matchAll(shapeWithBoundary)].filter(m => (m.index ?? 0) < at);
      return before[before.length - 1]?.[0];
    };
    expect(nearestBefore(glued)).toBe('Chapter 23');
    expect(nearestBefore(preserved)).toBe('Chapter 5');
  });
});

describe('classifyLocalizationMethod', () => {
  const kinds = ['Entry'];

  it('detects the line-anchored method (the one gluing breaks)', () => {
    expect(classifyLocalizationMethod(
      'code: re.findall(r"^Entry (\\d+)$", text, re.MULTILINE)', kinds
    )).toBe('line-anchored');
    expect(classifyLocalizationMethod(
      'for line in text.splitlines():\n  if line.startswith("Entry "):', kinds
    )).toBe('line-anchored');
    // Anchored groups and alternations still count as anchored.
    expect(classifyLocalizationMethod(
      're.finditer(r"^(Entry) (\\d+)$", text, re.M)', kinds
    )).toBe('line-anchored');
    expect(classifyLocalizationMethod(
      're.finditer(r"^(Letter|Chapter) \\d+$", text, re.M)', ['Letter', 'Chapter']
    )).toBe('line-anchored');
  });

  it('detects the shape-based method (glue-tolerant)', () => {
    expect(classifyLocalizationMethod(
      'hits = [m for m in re.finditer(r"Entry (\\d+)", text)]', kinds
    )).toBe('shape');
    expect(classifyLocalizationMethod(
      're.findall(r"Entry\\s+(\\d+)", text)', kinds
    )).toBe('shape');
  });

  it('prefers line-anchored when both markers appear, else unknown', () => {
    expect(classifyLocalizationMethod(
      'first tried re.findall(r"^Entry \\d+$", text, re.M) then re.finditer(r"Entry \\d+", text)',
      kinds
    )).toBe('line-anchored');
    expect(classifyLocalizationMethod('answer came from an llm_query subcall', kinds))
      .toBe('unknown');
  });
});
