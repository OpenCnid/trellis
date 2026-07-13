import { describe, expect, it } from 'vitest';
import { validateGenericTree } from './generic_tree';
import { grammarForFile, parseGenericTree } from './treesitter_engine';
import { parseSourceFile, type ParseSourceResult } from './source_parser';
import { collectExtractionBlocks, nodeText } from './traverse';
import { planExtraction } from '../ingestion/plan_ingest';
import type { ASTNode } from './parser';

// Session 38: the web-tree-sitter engine, the language profiles, and
// chunking policy 2 end-to-end through parseSourceFile — plus the
// policy-1 byte-identity pin (the Session 34 plan-equality mold) and
// the code_import extraction-eligibility pin.

const PYTHON = process.platform === 'win32' ? 'python' : 'python3';
const P1 = { pythonExecutable: PYTHON };
const P2 = { pythonExecutable: PYTHON, chunkingPolicy: 2 as const };

function okRoot(result: ParseSourceResult): ASTNode {
  if (!result.ok) throw new Error(`expected ok parse, got skip: ${result.reason} ${result.detail ?? ''}`);
  return result.root;
}

function blockViews(root: ASTNode): Array<{ type: string; text: string }> {
  return collectExtractionBlocks(root).map(block => ({
    type: block.type,
    text: nodeText(block),
  }));
}

const TS_SOURCE = [
  "import { readFile } from 'fs/promises';",
  "import path from 'path';",
  '',
  '// The limit constant.',
  'export const LIMIT = 3;',
  '',
  'export interface Widgetish {',
  '  count: number;',
  '}',
  '',
  'export type Alias = Widgetish | null;',
  '',
  '// Documents alpha.',
  'export function alpha(input: string): string {',
  '  return input.trim();',
  '}',
  '',
  'export class Widget {',
  '  private count = 0;',
  '',
  '  bump(): number {',
  '    this.count += 1;',
  '    return this.count;',
  '  }',
  '}',
  '',
].join('\n');

const PY_SOURCE = [
  'import os',
  'from sys import path',
  '',
  'LIMIT = 3',
  '',
  '',
  'def alpha(value):',
  '    """Trims."""',
  '    return value.strip()',
  '',
  '',
  'class Widget:',
  '    count = 0',
  '',
  '    def bump(self):',
  '        self.count += 1',
  '        return self.count',
  '',
].join('\n');

describe('grammarForFile', () => {
  it('maps extensions to pinned grammars and refuses the rest', () => {
    expect(grammarForFile('src/a.ts')).toBe('typescript');
    expect(grammarForFile('src/a.mts')).toBe('typescript');
    expect(grammarForFile('src/View.tsx')).toBe('tsx');
    expect(grammarForFile('lib/b.js')).toBe('javascript');
    expect(grammarForFile('lib/b.mjs')).toBe('javascript');
    expect(grammarForFile('scripts/c.py')).toBe('python');
    expect(grammarForFile('README.md')).toBeNull();
    expect(grammarForFile('Makefile')).toBeNull();
  });
});

describe('parseGenericTree', () => {
  it('emits a validated generic tree with slice-semantics spans', async () => {
    const source = 'const s = "héllo 🎉";\nfunction f() { return 1; }\n';
    const parsed = await parseGenericTree('typescript', source);
    if (!parsed.ok) throw new Error(parsed.detail);
    expect(() => validateGenericTree(parsed.root, source.length)).not.toThrow();
    const [decl, fn] = parsed.root.children;
    // Spans are UTF-16 code units: slicing reproduces the multi-byte
    // content exactly (the emoji is 2 units, 4 UTF-8 bytes).
    expect(source.slice(decl.start, decl.end)).toBe('const s = "héllo 🎉";');
    expect(fn.type).toBe('function_declaration');
  });

  it('refuses source with syntax errors — never a guessed tree', async () => {
    const parsed = await parseGenericTree('typescript', 'function ( {');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.detail).toMatch(/syntax errors/);
  });

  it('parses python with its own grammar', async () => {
    const parsed = await parseGenericTree('python', PY_SOURCE);
    if (!parsed.ok) throw new Error(parsed.detail);
    const types = parsed.root.children.map(child => child.type);
    expect(types).toContain('import_statement');
    expect(types).toContain('function_definition');
    expect(types).toContain('class_definition');
  });
});

describe('parseSourceFile chunking policy 2', () => {
  it('produces typed structural blocks for TypeScript with exact coverage', async () => {
    const result = await parseSourceFile('src/widget.ts', Buffer.from(TS_SOURCE), P2);
    const root = okRoot(result);
    const blocks = blockViews(root);
    const kinds = new Set(blocks.map(block => block.type));
    expect(kinds.has('code_import')).toBe(true);
    expect(kinds.has('code_const')).toBe(true);
    expect(kinds.has('code_type')).toBe(true);
    expect(kinds.has('code_function')).toBe(true);
    expect(kinds.has('code_method')).toBe(true);
    // No structureless gap material in a fully structured file.
    expect(kinds.has('code_chunk')).toBe(false);
    // Exact byte coverage (the coversSource invariant).
    expect(nodeText(root)).toBe(TS_SOURCE);
    // The doc comment glues to its function.
    const fn = blocks.find(block => block.type === 'code_function');
    expect(fn?.text).toContain('// Documents alpha.');
    // The class is a container: its methods are the units.
    const classNode = (root.children ?? []).find(child => child.type === 'code_class');
    expect(classNode).toBeDefined();
  });

  it('produces typed structural blocks for Python with exact coverage', async () => {
    const result = await parseSourceFile('pkg/widget.py', Buffer.from(PY_SOURCE), P2);
    const root = okRoot(result);
    const blocks = blockViews(root);
    expect(blocks.map(block => block.type)).toEqual([
      'code_import', 'code_statement', 'code_function', 'code_statement', 'code_method',
    ]);
    expect(nodeText(root)).toBe(PY_SOURCE);
    // Both imports merged into one code_import run.
    expect(blocks[0].text).toContain('import os');
    expect(blocks[0].text).toContain('from sys import path');
    // The class field carries the class header (glued); the trailing
    // file newline rides the last member instead of a confetti chunk.
    expect(blocks[3].text).toContain('class Widget:');
    expect(blocks[4].text.endsWith('\n')).toBe(true);
  });

  it('parses tsx with the tsx grammar', async () => {
    const source = 'export function View() {\n  return <div a={1} />;\n}\n';
    const result = await parseSourceFile('src/View.tsx', Buffer.from(source), P2);
    const root = okRoot(result);
    expect(nodeText(root)).toBe(source);
    expect(blockViews(root).map(block => block.type)).toEqual(['code_function']);
  });

  it('splits an oversized function into bounded statement blocks', async () => {
    const lines = Array.from(
      { length: 120 },
      (_, i) => `  const v${i} = compute_${i}('${'x'.repeat(90)}');`
    );
    const source = `function main() {\n${lines.join('\n')}\n}\n`;
    expect(source.length).toBeGreaterThan(8000);
    const result = await parseSourceFile('src/big.ts', Buffer.from(source), P2);
    const root = okRoot(result);
    const blocks = blockViews(root);
    expect(blocks.length).toBeGreaterThan(2);
    for (const block of blocks) {
      expect(block.text.length).toBeLessThanOrEqual(4000);
    }
    expect(nodeText(root)).toBe(source);
  });

  it('returns a typed parse_error skip for broken source', async () => {
    const result = await parseSourceFile('src/broken.ts', Buffer.from('function ( {'), P2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('parse_error');
  });

  it('is deterministic: identical bytes, identical root hash', async () => {
    const first = okRoot(await parseSourceFile('src/widget.ts', Buffer.from(TS_SOURCE), P2));
    const second = okRoot(await parseSourceFile('src/widget.ts', Buffer.from(TS_SOURCE), P2));
    expect(second.id).toBe(first.id);
  });
});

describe('chunking policy 1 byte-identity (the plan-equality mold)', () => {
  it('explicit policy 1 and absent policy produce identical roots (typescript)', async () => {
    const absent = okRoot(await parseSourceFile('src/widget.ts', Buffer.from(TS_SOURCE), P1));
    const explicit = okRoot(
      await parseSourceFile('src/widget.ts', Buffer.from(TS_SOURCE), {
        ...P1,
        chunkingPolicy: 1,
      })
    );
    expect(explicit.id).toBe(absent.id);
  });

  it('explicit policy 1 and absent policy produce identical roots (python)', async () => {
    const absent = okRoot(await parseSourceFile('pkg/widget.py', Buffer.from(PY_SOURCE), P1));
    const explicit = okRoot(
      await parseSourceFile('pkg/widget.py', Buffer.from(PY_SOURCE), {
        ...P1,
        chunkingPolicy: 1,
      })
    );
    expect(explicit.id).toBe(absent.id);
  });

  it('policy-1 output never contains the structural kinds', async () => {
    const root = okRoot(await parseSourceFile('src/widget.ts', Buffer.from(TS_SOURCE), P1));
    const kinds = new Set(blockViews(root).map(block => block.type));
    for (const kind of ['code_import', 'code_const', 'code_type', 'code_statement']) {
      expect(kinds.has(kind)).toBe(false);
    }
  });

  it('markdown ignores the chunking policy entirely', async () => {
    const markdown = '# Title\n\nBody paragraph.\n';
    const p1 = okRoot(await parseSourceFile('README.md', Buffer.from(markdown), P1));
    const p2 = okRoot(await parseSourceFile('README.md', Buffer.from(markdown), P2));
    expect(p2.id).toBe(p1.id);
  });
});

describe('code_import extraction eligibility (the recorded per-kind decision)', () => {
  it('keeps imports in the block walk but out of the extraction plan', async () => {
    const root = okRoot(await parseSourceFile('src/widget.ts', Buffer.from(TS_SOURCE), P2));
    const walkKinds = blockViews(root).map(block => block.type);
    expect(walkKinds).toContain('code_import');

    const plan = planExtraction(root, null, { mode: 'changed' });
    const planned = plan.blocks.map(({ block }) => block.type);
    expect(planned).not.toContain('code_import');
    expect(planned).toContain('code_const');
    expect(planned).toContain('code_type');
    expect(plan.blocksEligible).toBe(plan.blocks.length);
  });

  it('changes nothing for legacy policy-1 plans', async () => {
    const root = okRoot(await parseSourceFile('src/widget.ts', Buffer.from(TS_SOURCE), P1));
    const plan = planExtraction(root, null, { mode: 'changed' });
    // Every non-empty walk block is eligible — the pre-Session-38 rule.
    const nonEmpty = blockViews(root).filter(block => block.text.trim().length > 0);
    expect(plan.blocksEligible).toBe(nonEmpty.length);
  });
});
