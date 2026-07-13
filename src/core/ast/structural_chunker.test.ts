import { describe, expect, it } from 'vitest';
import { GenericTreeValidationError, type GenericTreeNode } from './generic_tree';
import {
  chunkGenericTree,
  segmentText,
  StructuralChunkError,
  STRUCTURAL_MERGE_TARGET_CHARS,
  STRUCTURAL_SPLIT_THRESHOLD_CHARS,
  type ChunkSegment,
  type LanguageChunkProfile,
} from './structural_chunker';

// A synthetic language profile so the walk is pinned independently of
// any real grammar: node types are one word each.
const TEST_PROFILE: LanguageChunkProfile = {
  classify(type, inContainerBody) {
    switch (type) {
      case 'comment': return { role: 'trivia' };
      case 'export': return { role: 'unwrap' };
      case 'import': return { role: 'leaf', kind: 'code_import' };
      case 'func':
        return { role: 'leaf', kind: inContainerBody ? 'code_method' : 'code_function' };
      case 'const': return { role: 'leaf', kind: 'code_const' };
      case 'class': return { role: 'container' };
      default: return { role: 'leaf', kind: 'code_statement' };
    }
  },
  containerBodyTypes: new Set(['body']),
};

/** Builds a source string incrementally, returning the span each
 * emitted piece occupies. */
class SourceBuilder {
  text = '';

  emit(piece: string): { start: number; end: number } {
    const start = this.text.length;
    this.text += piece;
    return { start, end: this.text.length };
  }
}

function tree(children: GenericTreeNode[], length: number): GenericTreeNode {
  return { type: 'program', start: 0, end: length, children };
}

function leaf(type: string, span: { start: number; end: number }, children: GenericTreeNode[] = []): GenericTreeNode {
  return { type, start: span.start, end: span.end, children };
}

function flatTexts(segments: ChunkSegment[]): string {
  return segments.map(segmentText).join('');
}

describe('chunkGenericTree', () => {
  it('merges adjacent same-kind siblings up to the merge target, gaps glued', () => {
    const b = new SourceBuilder();
    const i1 = b.emit("import a;");
    b.emit('\n');
    const i2 = b.emit("import b;");
    b.emit('\n');
    const i3 = b.emit("import c;");
    const root = tree([leaf('import', i1), leaf('import', i2), leaf('import', i3)], b.text.length);

    const segments = chunkGenericTree(root, b.text, TEST_PROFILE);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ kind: 'code_import', text: b.text });
  });

  it('starts a new segment on a kind change — kinds never blur', () => {
    const b = new SourceBuilder();
    const imp = b.emit('import a;');
    b.emit('\n');
    const cst = b.emit('const x = 1;');
    const root = tree([leaf('import', imp), leaf('const', cst)], b.text.length);

    const segments = chunkGenericTree(root, b.text, TEST_PROFILE);
    expect(segments.map(s => 'text' in s && s.kind)).toEqual(['code_import', 'code_const']);
    expect(flatTexts(segments)).toBe(b.text);
  });

  it('stops merging at the merge target', () => {
    const b = new SourceBuilder();
    const s1 = b.emit('x'.repeat(30));
    const s2 = b.emit('y'.repeat(30));
    const s3 = b.emit('z'.repeat(30));
    const root = tree([leaf('stmt', s1), leaf('stmt', s2), leaf('stmt', s3)], b.text.length);

    const segments = chunkGenericTree(root, b.text, TEST_PROFILE, {
      splitThreshold: 100,
      mergeTarget: 70,
    });
    expect(segments).toHaveLength(2);
    expect(segmentText(segments[0])).toHaveLength(60);
    expect(segmentText(segments[1])).toHaveLength(30);
    expect(flatTexts(segments)).toBe(b.text);
  });

  it('recurses an oversized construct into statement-aligned sub-blocks', () => {
    const b = new SourceBuilder();
    const header = b.emit('def main():\n');
    const stmts: Array<{ start: number; end: number }> = [];
    for (let i = 0; i < 60; i++) {
      stmts.push(b.emit(`    call_${i}(${'a'.repeat(200)})`));
      b.emit('\n');
    }
    const funcSpan = { start: header.start, end: b.text.length };
    const body = { type: 'body', start: stmts[0].start, end: b.text.length, children: stmts.map(s => leaf('stmt', s)) };
    const func: GenericTreeNode = { type: 'func', ...funcSpan, children: [body] };
    const root = tree([func], b.text.length);
    expect(b.text.length).toBeGreaterThan(STRUCTURAL_SPLIT_THRESHOLD_CHARS * 3);

    const segments = chunkGenericTree(root, b.text, TEST_PROFILE);
    expect(segments.length).toBeGreaterThan(3);
    for (const segment of segments) {
      expect('text' in segment && segment.kind).toBe('code_statement');
      expect(segmentText(segment).length).toBeLessThanOrEqual(STRUCTURAL_MERGE_TARGET_CHARS);
    }
    expect(flatTexts(segments)).toBe(b.text);
  });

  it('keeps an oversized childless leaf whole', () => {
    const b = new SourceBuilder();
    const giant = b.emit('g'.repeat(STRUCTURAL_SPLIT_THRESHOLD_CHARS + 500));
    const root = tree([leaf('stmt', giant)], b.text.length);

    const segments = chunkGenericTree(root, b.text, TEST_PROFILE);
    expect(segments).toHaveLength(1);
    expect(segmentText(segments[0])).toHaveLength(STRUCTURAL_SPLIT_THRESHOLD_CHARS + 500);
    expect('text' in segments[0] && segments[0].kind).toBe('code_statement');
  });

  it('glues a comment to the following construct', () => {
    const b = new SourceBuilder();
    const comment = b.emit('// documents f\n');
    const fn = b.emit('function f() {}');
    const root = tree([leaf('comment', comment), leaf('func', fn)], b.text.length);

    const segments = chunkGenericTree(root, b.text, TEST_PROFILE);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ kind: 'code_function', text: b.text });
  });

  it('emits a giant gap as bounded code_chunk segments, never a construct prefix', () => {
    const b = new SourceBuilder();
    const lines = Array.from({ length: 30 }, (_, i) => `// license ${i} ${'x'.repeat(20)}`).join('\n');
    b.emit(lines);
    b.emit('\n');
    const fn = b.emit('function f() {}');
    const root = tree([leaf('func', fn)], b.text.length);

    const segments = chunkGenericTree(root, b.text, TEST_PROFILE, {
      splitThreshold: 200,
      mergeTarget: 150,
    });
    const kinds = segments.map(s => ('text' in s ? s.kind : s.kind));
    expect(kinds.slice(0, -1).every(kind => kind === 'code_chunk')).toBe(true);
    expect(kinds[kinds.length - 1]).toBe('code_function');
    for (const segment of segments.slice(0, -1)) {
      expect(segmentText(segment).length).toBeLessThanOrEqual(200);
    }
    const last = segments[segments.length - 1];
    expect(segmentText(last)).toBe('function f() {}');
    expect(flatTexts(segments)).toBe(b.text);
  });

  it('appends trailing gap to the last leaf segment', () => {
    const b = new SourceBuilder();
    const fn = b.emit('function f() {}');
    b.emit('\n\n');
    const root = tree([leaf('func', fn)], b.text.length);

    const segments = chunkGenericTree(root, b.text, TEST_PROFILE);
    expect(segments).toHaveLength(1);
    expect(segmentText(segments[0])).toBe(b.text);
  });

  it('chunks a nodeless source as code_chunk', () => {
    const source = '\n\n# nothing structural\n';
    const segments = chunkGenericTree(tree([], source.length), source, TEST_PROFILE);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ kind: 'code_chunk', text: source });
  });

  it('returns no segments for empty source', () => {
    expect(chunkGenericTree(tree([], 0), '', TEST_PROFILE)).toEqual([]);
  });

  it('builds class containers: header glues to the first member, brace to the last', () => {
    const b = new SourceBuilder();
    const classStart = b.emit('class Widget {\n');
    const m1 = b.emit('  m1() { return 1; }');
    b.emit('\n');
    const m2 = b.emit('  m2() { return 2; }');
    b.emit('\n}');
    const classSpan = { start: classStart.start, end: b.text.length };
    const body = {
      type: 'body',
      start: m1.start,
      end: b.text.length,
      children: [leaf('func', m1), leaf('func', m2)],
    };
    const cls: GenericTreeNode = { type: 'class', ...classSpan, children: [body] };
    const root = tree([cls], b.text.length);

    const segments = chunkGenericTree(root, b.text, TEST_PROFILE, {
      splitThreshold: 30,
      mergeTarget: 25,
    });
    expect(segments).toHaveLength(1);
    const container = segments[0];
    if (!('children' in container)) throw new Error('expected container');
    expect(container.kind).toBe('code_class');
    const memberKinds = container.children.map(child => 'text' in child && child.kind);
    expect(memberKinds).toEqual(['code_method', 'code_method']);
    expect(segmentText(container.children[0]).startsWith('class Widget {')).toBe(true);
    expect(segmentText(container.children[1]).endsWith('\n}')).toBe(true);
    expect(flatTexts(segments)).toBe(b.text);
  });

  it('unwraps wrappers: export bytes belong to the inner construct kind', () => {
    const b = new SourceBuilder();
    const outer = b.emit('export function f() {}');
    const fnSpan = { start: outer.start + 'export '.length, end: outer.end };
    const exportNode: GenericTreeNode = {
      type: 'export',
      ...outer,
      children: [leaf('func', fnSpan)],
    };
    const root = tree([exportNode], b.text.length);

    const segments = chunkGenericTree(root, b.text, TEST_PROFILE);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ kind: 'code_function', text: b.text });
  });

  it('falls back to code_statement for an unresolvable wrapper', () => {
    const b = new SourceBuilder();
    const outer = b.emit('export * from "x";');
    const exportNode: GenericTreeNode = { type: 'export', ...outer, children: [] };
    const root = tree([exportNode], b.text.length);

    const segments = chunkGenericTree(root, b.text, TEST_PROFILE);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ kind: 'code_statement', text: b.text });
  });

  it('is deterministic: identical inputs produce identical segments', () => {
    const b = new SourceBuilder();
    const i1 = b.emit('import a;');
    b.emit('\n');
    const fn = b.emit(`function f() { ${'pad();'.repeat(40)} }`);
    const root = tree([leaf('import', i1), leaf('func', fn)], b.text.length);

    const first = chunkGenericTree(root, b.text, TEST_PROFILE);
    const second = chunkGenericTree(root, b.text, TEST_PROFILE);
    expect(second).toEqual(first);
  });

  it('refuses a merge target above the split threshold', () => {
    expect(() =>
      chunkGenericTree(tree([], 0), '', TEST_PROFILE, { splitThreshold: 10, mergeTarget: 20 })
    ).toThrow(StructuralChunkError);
  });

  it('propagates tree validation failures', () => {
    const root = tree([{ type: 'stmt', start: 5, end: 3, children: [] }], 10);
    expect(() => chunkGenericTree(root, 'x'.repeat(10), TEST_PROFILE)).toThrow(
      GenericTreeValidationError
    );
  });
});

