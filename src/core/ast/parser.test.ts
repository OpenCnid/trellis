import { describe, it, expect } from 'vitest';
import { parseMarkdownToAST, parseUnstructuredJSONToAST, ASTNode } from './parser';

describe('parseMarkdownToAST — Merkle hashing', () => {
  it('is deterministic: identical input yields identical root hash', () => {
    const md = '# Title\n\nGlobex **acquired** Initech.';
    expect(parseMarkdownToAST(md).id).toBe(parseMarkdownToAST(md).id);
  });

  it('produces 64-char lowercase hex SHA-256 ids for every node', () => {
    const root = parseMarkdownToAST('# H\n\nSome text.');
    const all: ASTNode[] = [];
    const walk = (n: ASTNode) => { all.push(n); n.children?.forEach(walk); };
    walk(root);
    expect(all.length).toBeGreaterThan(3);
    for (const node of all) {
      expect(node.id).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('changes the root hash when any leaf content changes', () => {
    const a = parseMarkdownToAST('# T\n\nAlpha beta gamma.');
    const b = parseMarkdownToAST('# T\n\nAlpha beta delta.');
    expect(a.id).not.toBe(b.id);
  });

  it('block hashes are context-free: the same paragraph hashes identically alone and inside a larger document', () => {
    // The OOLONG ingestion loop depends on this invariant: it re-parses a
    // record's standalone markdown and expects the block hashes to match
    // the ones stored from the full-corpus parse.
    const para = 'The mitochondria is the powerhouse of the cell.';
    const standalone = parseMarkdownToAST(para);
    const inDocument = parseMarkdownToAST(`# Heading\n\n${para}\n\nAnother paragraph.`);
    const standaloneBlock = standalone.children![0];
    const documentBlock = inDocument.children!.find(c => c.type === 'paragraph');
    expect(standaloneBlock.type).toBe('paragraph');
    expect(documentBlock?.id).toBe(standaloneBlock.id);
  });

  it('distinguishes structure: same text as heading vs. paragraph hashes differently', () => {
    const heading = parseMarkdownToAST('# Same words');
    const paragraph = parseMarkdownToAST('Same words');
    expect(heading.children![0].id).not.toBe(paragraph.children![0].id);
  });

  it('parses inline formatting into separate leaf nodes (current pre-T2 granularity)', () => {
    // Documents the fragmentation the roadmap's T2 describes: a bolded
    // verb splits the sentence into three inline leaves under the
    // paragraph block.
    const root = parseMarkdownToAST('Globex **acquired** Initech');
    const paragraph = root.children![0];
    expect(paragraph.type).toBe('paragraph');
    expect(paragraph.children!.map(c => c.type)).toEqual(['text', 'strong', 'text']);
  });
});

describe('parseMarkdownToAST — T13 edge cases (current behavior)', () => {
  // These tests pin the known quirks flagged as T13 in TRELLIS_ROADMAP.md.
  // They document what the hash function does today; changing either
  // behavior changes every stored hash and must be done as a deliberate,
  // migrated change — a failure here means the hash function changed.

  it('empty-string content is treated as absent (falsy check), so it does not enter the hash preimage', () => {
    // remark emits childless nodes (e.g. thematicBreak) with no value;
    // processMarkdownNode normalizes value to ''. With `if (content)`,
    // '' contributes nothing, so the node hashes as bare `type`.
    const root = parseMarkdownToAST('---');
    const brk = root.children![0];
    expect(brk.type).toBe('thematicBreak');
    expect(brk.content).toBeUndefined();
  });

  it('preimage segments are :-joined without length prefixes', () => {
    // Two documents whose (content, child) segments could in principle
    // collide across the unprefixed `:` delimiter still differ here —
    // this is a canary, not a proof of safety.
    const a = parseMarkdownToAST('ab');
    const b = parseMarkdownToAST('a:b');
    expect(a.id).not.toBe(b.id);
  });
});

describe('parseUnstructuredJSONToAST', () => {
  const element = (text: string, extra: object = {}) => ({ type: 'NarrativeText', text, ...extra });

  it('is deterministic and wraps elements under a root node', () => {
    const els = [element('First block.'), element('Second block.')];
    const a = parseUnstructuredJSONToAST(els);
    const b = parseUnstructuredJSONToAST(els);
    expect(a.id).toBe(b.id);
    expect(a.type).toBe('root');
    expect(a.children).toHaveLength(2);
  });

  it('includes page metadata in the hash: same text on different pages hashes differently', () => {
    const p1 = parseUnstructuredJSONToAST([element('Same text', { metadata: { page_number: 1 } })]);
    const p2 = parseUnstructuredJSONToAST([element('Same text', { metadata: { page_number: 2 } })]);
    expect(p1.children![0].id).not.toBe(p2.children![0].id);
  });

  it('captures bounding boxes when coordinates are present', () => {
    const points = [[0, 0], [0, 10], [10, 10], [10, 0]];
    const root = parseUnstructuredJSONToAST([
      element('Boxed', { metadata: { page_number: 3, coordinates: { points } } })
    ]);
    expect(root.children![0].metadata).toEqual({ page_number: 3, bounding_box: points });
  });

  it('omits empty metadata objects entirely', () => {
    const root = parseUnstructuredJSONToAST([element('Plain', { metadata: {} })]);
    expect(root.children![0].metadata).toBeUndefined();
  });
});
