import { describe, it, expect } from 'vitest';
import { buildCorpus, recordToMarkdown, nodeText, flattenAST } from './corpus';
import { parseMarkdownToAST } from '../../core/ast/parser';
import type { OolongPassage, OolongRecord } from './schema';

const record = (id: string, text: string): OolongRecord => ({
  id,
  text,
  category: 'LOC',
  concepts: ['paris'],
});

const passage = (id: string, text: string): OolongPassage => ({
  id,
  text,
  surface_forms: ['paris'],
});

describe('nodeText', () => {
  it('reconstructs block text across inline formatting leaves', () => {
    const root = parseMarkdownToAST('Globex **acquired** Initech');
    expect(nodeText(root.children![0])).toBe('Globex acquired Initech');
  });
});

describe('flattenAST', () => {
  it('returns every node exactly once, root first', () => {
    const root = parseMarkdownToAST('# H\n\nOne.\n\nTwo.');
    const flat = flattenAST(root);
    expect(flat[0]).toBe(root);
    expect(new Set(flat.map(n => n.id)).size).toBe(flat.length);
  });
});

describe('buildCorpus', () => {
  const records = [
    record('q_0001', 'Where is the Louvre located?'),
    record('q_0002', 'What river runs through Paris?'),
  ];

  it('binds each record to its heading and paragraph blocks', () => {
    const corpus = buildCorpus(records);
    expect(corpus.bound).toHaveLength(2);
    for (const [i, b] of corpus.bound.entries()) {
      expect(nodeText(b.heading)).toBe(records[i].id);
      expect(nodeText(b.paragraph)).toBe(records[i].text);
      expect(b.markdown).toBe(recordToMarkdown(records[i]));
    }
  });

  it('bound block hashes survive standalone re-parsing (content addressing)', () => {
    // The ingestion loop's Phase B integrity check relies on this: a
    // record's markdown parsed in isolation must reproduce the exact
    // block hashes derived from the full-corpus parse.
    const corpus = buildCorpus(records);
    for (const b of corpus.bound) {
      const reparsed = parseMarkdownToAST(b.markdown);
      const [heading, paragraph] = reparsed.children!;
      expect(heading.id).toBe(b.heading.id);
      expect(paragraph.id).toBe(b.paragraph.id);
    }
  });

  it('is deterministic: same records yield the same documentId', () => {
    expect(buildCorpus(records).documentId).toBe(buildCorpus(records).documentId);
  });

  it('rejects a record whose text splits into multiple blocks', () => {
    const bad = [record('q_0001', 'First paragraph.\n\nSecond paragraph.')];
    expect(() => buildCorpus(bad)).toThrow(/Corpus binding failure/);
  });

  it('leaves boundPassages empty for v1 datasets (no passages)', () => {
    expect(buildCorpus(records).boundPassages).toEqual([]);
  });
});

describe('buildCorpus with distractor passages (v2)', () => {
  const records = [
    record('q_1001', 'Which nation contains the French capital?'),
    record('q_1002', 'Who served as mayor of Lima in the 1980s?'),
  ];
  const passages = [
    passage('p_1001', 'Freight volumes between Paris and Lima doubled last year.'),
    passage('p_1002', 'The morning bulletin reported clear skies over Paris.'),
  ];

  it('binds passages after records through the same heading + paragraph round trip', () => {
    const corpus = buildCorpus(records, passages);
    expect(corpus.bound).toHaveLength(2);
    expect(corpus.boundPassages).toHaveLength(2);
    for (const [j, b] of corpus.boundPassages.entries()) {
      expect(nodeText(b.heading)).toBe(passages[j].id);
      expect(nodeText(b.paragraph)).toBe(passages[j].text);
      expect(b.markdown).toBe(recordToMarkdown(passages[j]));
    }
  });

  it('passage block hashes survive standalone re-parsing (content addressing)', () => {
    const corpus = buildCorpus(records, passages);
    for (const b of corpus.boundPassages) {
      const reparsed = parseMarkdownToAST(b.markdown);
      const [heading, paragraph] = reparsed.children!;
      expect(heading.id).toBe(b.heading.id);
      expect(paragraph.id).toBe(b.paragraph.id);
    }
  });

  it('adding passages changes the documentId but not record block hashes', () => {
    const without = buildCorpus(records);
    const withPassages = buildCorpus(records, passages);
    expect(withPassages.documentId).not.toBe(without.documentId);
    for (const [i, b] of withPassages.bound.entries()) {
      expect(b.heading.id).toBe(without.bound[i].heading.id);
      expect(b.paragraph.id).toBe(without.bound[i].paragraph.id);
    }
  });

  it('rejects a passage whose text splits into multiple blocks', () => {
    const bad = [passage('p_1001', 'One.\n\nTwo.')];
    expect(() => buildCorpus(records, bad)).toThrow(/Corpus binding failure/);
  });
});
