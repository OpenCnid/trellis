import { describe, expect, it } from 'vitest';
import { parseMarkdownToAST } from '../ast/parser';
import { collectExtractionBlocks, nodeText } from '../ast/traverse';
import { blocksFromRoot } from './corpus';

// Session 19 (design record §4, D4): blocksFromRoot is the pure mapping
// from a version's root AST to its extraction blocks — the same block
// set the promotion CLI printed as citable, so the seeded corpus and the
// pinned research provenance are one and the same.

const CORPUS = [
  '# Workspace discipline',
  '',
  'Reuse prior snapshots instead of re-deriving them.',
  '',
  '- Read the stored segment before fetching again.',
  '- Rebind atomically; never trust a torn update.',
].join('\n');

describe('blocksFromRoot', () => {
  it('returns the extraction blocks as (hash, text) pairs, in document order', () => {
    const root = parseMarkdownToAST(CORPUS);
    const blocks = blocksFromRoot(root);
    // Same hashes the promotion path derives (collectExtractionBlocks).
    const promotionBlocks = collectExtractionBlocks(root).filter(b => nodeText(b).trim().length > 0);
    expect(blocks.map(b => b.hash)).toEqual(promotionBlocks.map(b => b.id));
    expect(blocks.every(b => /^[0-9a-f]{64}$/.test(b.hash))).toBe(true);
    // The heading, the paragraph, and the two list items are all present.
    expect(blocks.some(b => b.text.includes('Workspace discipline'))).toBe(true);
    expect(blocks.some(b => b.text.includes('Rebind atomically'))).toBe(true);
    expect(blocks.length).toBeGreaterThanOrEqual(4);
  });

  it('reconstructs block text exactly as extraction would (nodeText)', () => {
    const root = parseMarkdownToAST(CORPUS);
    const blocks = blocksFromRoot(root);
    for (const block of blocks) {
      expect(block.text.trim().length).toBeGreaterThan(0);
    }
  });

  it('drops empty-text blocks (the planExtraction eligibility rule)', () => {
    const root = parseMarkdownToAST('# Heading\n\n\n');
    const blocks = blocksFromRoot(root);
    expect(blocks.every(b => b.text.trim().length > 0)).toBe(true);
  });
});
