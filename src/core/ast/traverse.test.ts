import { describe, it, expect } from 'vitest';
import { parseMarkdownToAST, parseUnstructuredJSONToAST, ASTNode } from './parser';
import { flattenAST, nodeText, collectExtractionBlocks } from './traverse';
import { computeDiff } from './diff';

describe('flattenAST', () => {
  it('returns every node exactly once, root first', () => {
    const root = parseMarkdownToAST('# H\n\nOne.\n\nTwo.');
    const flat = flattenAST(root);
    expect(flat[0]).toBe(root);
    expect(new Set(flat.map(n => n.id)).size).toBe(flat.length);
  });
});

describe('nodeText', () => {
  it('reconstructs text across inline formatting leaves', () => {
    const root = parseMarkdownToAST('Globex **acquired** Initech');
    expect(nodeText(root.children![0])).toBe('Globex acquired Initech');
  });

  it('returns leaf content directly', () => {
    const root = parseMarkdownToAST('```\nconst x = 1;\n```');
    expect(nodeText(root.children![0])).toBe('const x = 1;');
  });
});

describe('collectExtractionBlocks — markdown', () => {
  it('emits one unit per paragraph with full reconstructed text (the T2 fix)', () => {
    // Previously `Globex **acquired** Initech` fanned out as three
    // inline leaves, none containing the relationship.
    const root = parseMarkdownToAST('Globex **acquired** Initech');
    const blocks = collectExtractionBlocks(root);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('paragraph');
    expect(nodeText(blocks[0])).toBe('Globex acquired Initech');
  });

  it('never emits inline leaves', () => {
    const root = parseMarkdownToAST('# Head\n\nSome *styled* `code` [link](http://x.dev) text.');
    const inlineTypes = new Set(['text', 'strong', 'emphasis', 'inlineCode', 'link']);
    for (const block of collectExtractionBlocks(root)) {
      expect(inlineTypes.has(block.type)).toBe(false);
    }
  });

  it('emits headings and paragraphs as separate units in document order', () => {
    const root = parseMarkdownToAST('# Title\n\nFirst.\n\n## Sub\n\nSecond.');
    const blocks = collectExtractionBlocks(root);
    expect(blocks.map(b => [b.type, nodeText(b)])).toEqual([
      ['heading', 'Title'],
      ['paragraph', 'First.'],
      ['heading', 'Sub'],
      ['paragraph', 'Second.'],
    ]);
  });

  it('emits one unit per list item, including nested list content', () => {
    const md = '- Globex acquired Initech\n- Initech merged with Umbrella\n  - in 2019';
    const blocks = collectExtractionBlocks(parseMarkdownToAST(md));
    expect(blocks.map(b => b.type)).toEqual(['listItem', 'listItem']);
    expect(nodeText(blocks[0])).toBe('Globex acquired Initech');
    expect(nodeText(blocks[1])).toContain('Initech merged with Umbrella');
    expect(nodeText(blocks[1])).toContain('in 2019');
  });

  it('traverses through blockquotes to the paragraphs inside', () => {
    const blocks = collectExtractionBlocks(parseMarkdownToAST('> Quoted claim.'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('paragraph');
    expect(nodeText(blocks[0])).toBe('Quoted claim.');
  });

  it('emits fenced code blocks as single units', () => {
    const blocks = collectExtractionBlocks(parseMarkdownToAST('```\nSELECT 1;\n```'));
    expect(blocks.map(b => b.type)).toEqual(['code']);
  });

  it('skips content-less structural nodes like thematic breaks', () => {
    const blocks = collectExtractionBlocks(parseMarkdownToAST('One.\n\n---\n\nTwo.'));
    expect(blocks.map(b => b.type)).toEqual(['paragraph', 'paragraph']);
  });

  it('never emits both an ancestor and its descendant', () => {
    const root = parseMarkdownToAST('# H\n\nPara.\n\n- item one\n- item **two**\n\n> quote');
    const blocks = collectExtractionBlocks(root);
    const emitted = new Set(blocks.map(b => b.id));
    for (const block of blocks) {
      for (const inner of flattenAST(block).slice(1)) {
        expect(emitted.has(inner.id)).toBe(false);
      }
    }
  });
});

describe('collectExtractionBlocks + computeDiff — re-ingest fan-out', () => {
  // Mirrors the /ingest composition: on re-ingest, only blocks whose id
  // lands in diff.added are queued. An inline edit changes its parent
  // block's Merkle hash, so exactly that block re-extracts.
  it('queues only the block containing an inline edit', () => {
    const v1 = parseMarkdownToAST('# Title\n\nGlobex **acquired** Initech.\n\nUnrelated paragraph.');
    const v2 = parseMarkdownToAST('# Title\n\nGlobex **divested** Initech.\n\nUnrelated paragraph.');
    const diff = computeDiff(flattenAST(v1).map(n => n.id), flattenAST(v2).map(n => n.id));
    const addedSet = new Set(diff.added);
    const queued = collectExtractionBlocks(v2).filter(b => addedSet.has(b.id));
    expect(queued).toHaveLength(1);
    expect(nodeText(queued[0])).toBe('Globex divested Initech.');
  });

  it('queues nothing on a byte-identical re-ingest', () => {
    const md = '# Title\n\nGlobex **acquired** Initech.';
    const v1 = parseMarkdownToAST(md);
    const v2 = parseMarkdownToAST(md);
    const diff = computeDiff(flattenAST(v1).map(n => n.id), flattenAST(v2).map(n => n.id));
    const addedSet = new Set(diff.added);
    expect(collectExtractionBlocks(v2).filter(b => addedSet.has(b.id))).toHaveLength(0);
  });
});

describe('collectExtractionBlocks — PDF elements', () => {
  it('emits each unstructured.io element as one unit', () => {
    const root = parseUnstructuredJSONToAST([
      { type: 'Title', text: 'Annual Report', metadata: { page_number: 1 } },
      { type: 'NarrativeText', text: 'Globex acquired Initech.', metadata: { page_number: 1 } },
    ]);
    const blocks = collectExtractionBlocks(root);
    expect(blocks.map(b => [b.type, nodeText(b)])).toEqual([
      ['Title', 'Annual Report'],
      ['NarrativeText', 'Globex acquired Initech.'],
    ]);
  });
});
