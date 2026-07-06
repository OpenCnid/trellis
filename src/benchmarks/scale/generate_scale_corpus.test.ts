import { describe, expect, it } from 'vitest';
import {
  buildScaleCorpus,
  documentMentionCounts,
  DEFAULT_SCALE_BLOCKS_PER_DOCUMENT,
  DEFAULT_SCALE_DOCUMENTS,
} from './generate_scale_corpus';

describe('buildScaleCorpus', () => {
  it('is byte-identical for the same seed and options', () => {
    const first = JSON.stringify(buildScaleCorpus());
    const second = JSON.stringify(buildScaleCorpus());
    expect(second).toBe(first);
  });

  it('changes when the seed changes', () => {
    expect(JSON.stringify(buildScaleCorpus({ seed: 7 }))).not.toBe(
      JSON.stringify(buildScaleCorpus({ seed: 8 }))
    );
  });

  it('emits the default 300 by 20 corpus with unique entities per document', () => {
    const corpus = buildScaleCorpus();
    expect(corpus.documents).toHaveLength(DEFAULT_SCALE_DOCUMENTS);
    expect(corpus.documents.every(
      document => document.blocks.length === DEFAULT_SCALE_BLOCKS_PER_DOCUMENT
    )).toBe(true);
    expect(corpus.documents.every(
      document => new Set(document.blocks.map(block => block.subjectName)).size
        === DEFAULT_SCALE_BLOCKS_PER_DOCUMENT
    )).toBe(true);
  });

  it('pins the default Zipf-like hub and tail document shares', () => {
    const corpus = buildScaleCorpus();
    const counts = documentMentionCounts(corpus);
    const ordered = [...counts.values()].sort((a, b) => b - a);

    expect(ordered.slice(0, 5)).toEqual([286, 258, 212, 200, 193]);
    expect(ordered.slice(-5)).toEqual([23, 21, 21, 20, 19]);
    expect(ordered.reduce((sum, value) => sum + value, 0)).toBe(6000);
  });

  it('rejects an impossible without-replacement shape', () => {
    expect(() => buildScaleCorpus({ entityPoolSize: 3, blocksPerDocument: 4 }))
      .toThrow('blocksPerDocument cannot exceed entityPoolSize');
  });
});
