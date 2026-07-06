import { describe, expect, it } from 'vitest';
import {
  detectLanguage,
  parseSourceFile,
  splitBoundedChunks,
  MAX_CHUNK_CHARS,
  type ParseSourceResult,
} from './source_parser';
import { parseMarkdownToAST, type ASTNode } from './parser';
import { collectExtractionBlocks, nodeText } from './traverse';

// The Python cases spawn the same interpreter contract the runtime uses
// (config's platform default); the repository already requires a local
// Python for parse_pdf.py and npm run python:check.
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';
const OPTIONS = { pythonExecutable: PYTHON };

function okRoot(result: ParseSourceResult): ASTNode {
  if (!result.ok) throw new Error(`expected ok parse, got skip: ${result.reason}`);
  return result.root;
}

function leafContents(node: ASTNode, acc: string[] = []): string[] {
  if (node.content !== undefined) acc.push(node.content);
  for (const child of node.children ?? []) leafContents(child, acc);
  return acc;
}

const TS_SOURCE = [
  "import { readFile } from 'fs/promises';",
  '',
  'const LIMIT = 3;',
  '',
  'export function alpha(input: string): string {',
  '  return input.trim();',
  '}',
  '',
  '// A comment between declarations.',
  'export class Widget {',
  '  private count = 0;',
  '',
  '  increment(): number {',
  '    return ++this.count;',
  '  }',
  '',
  '  reset(): void {',
  '    this.count = 0;',
  '  }',
  '}',
  '',
  'function beta<T>(value: T): T[] {',
  '  return [value];',
  '}',
  '',
].join('\n');

const PY_SOURCE = [
  'import json',
  '',
  'LIMIT = 3',
  '',
  '',
  '@staticmethod',
  'def alpha(value):',
  '    return value.strip()',
  '',
  '',
  'class Widget:',
  '    """A counter."""',
  '',
  '    count = 0',
  '',
  '    def increment(self):',
  '        return self.count + 1',
  '',
  '    def reset(self):',
  '        self.count = 0',
  '',
  '',
  'def beta(value):',
  '    return [value]',
  '',
].join('\n');

describe('detectLanguage', () => {
  it('maps the explicit extension and filename tables', () => {
    expect(detectLanguage('src/api/server.ts')).toBe('typescript');
    expect(detectLanguage('src/App.tsx')).toBe('typescript');
    expect(detectLanguage('lib/util.mjs')).toBe('javascript');
    expect(detectLanguage('scripts/parse_pdf.py')).toBe('python');
    expect(detectLanguage('README.md')).toBe('markdown');
    expect(detectLanguage('package.json')).toBe('text');
    expect(detectLanguage('Dockerfile')).toBe('text');
    expect(detectLanguage('.gitignore')).toBe('text');
    expect(detectLanguage('image.png')).toBeNull();
    expect(detectLanguage('binary.exe')).toBeNull();
    expect(detectLanguage('no_extension')).toBeNull();
  });
});

describe('splitBoundedChunks', () => {
  it('rejoins to the exact input and respects the bound at line boundaries', () => {
    const text = Array.from({ length: 400 }, (_, i) => `line ${i} with some padding text`).join('\n');
    const chunks = splitBoundedChunks(text, 500);
    expect(chunks.join('')).toBe(text);
    expect(chunks.every(chunk => chunk.length <= 500 || !chunk.includes('\n'))).toBe(true);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('keeps an over-long single line whole and drops empty input', () => {
    const line = 'x'.repeat(MAX_CHUNK_CHARS + 100);
    expect(splitBoundedChunks(line)).toEqual([line]);
    expect(splitBoundedChunks('')).toEqual([]);
  });
});

describe('parseSourceFile — TypeScript/JavaScript', () => {
  it('is deterministic and covers the exact bytes', async () => {
    const a = okRoot(await parseSourceFile('mod.ts', Buffer.from(TS_SOURCE), OPTIONS));
    const b = okRoot(await parseSourceFile('mod.ts', Buffer.from(TS_SOURCE), OPTIONS));
    expect(a).toEqual(b);
    expect(nodeText(a)).toBe(TS_SOURCE);
    expect(leafContents(a).join('')).toBe(TS_SOURCE);
  });

  it('exposes top-level functions, class methods, and bounded chunks as blocks', async () => {
    const root = okRoot(await parseSourceFile('mod.ts', Buffer.from(TS_SOURCE), OPTIONS));
    const types = root.children!.map(child => child.type);
    expect(types).toEqual([
      'code_chunk',    // import + const + blank lines
      'code_function', // export function alpha
      'code_chunk',    // comment between declarations
      'code_class',    // export class Widget (container)
      'code_chunk',    // blank line
      'code_function', // function beta
      'code_chunk',    // trailing newline
    ]);

    const alpha = root.children![1];
    expect(alpha.content!.startsWith('export function alpha')).toBe(true);

    const widget = root.children![3];
    expect(widget.content).toBeUndefined();
    const methodTypes = widget.children!.map(child => child.type);
    expect(methodTypes).toEqual([
      'code_chunk',  // export class Widget { header + property
      'code_method', // increment
      'code_chunk',  // blank line
      'code_method', // reset
      'code_chunk',  // closing brace
    ]);
    expect(nodeText(widget).startsWith('export class Widget {')).toBe(true);
    expect(nodeText(widget).endsWith('}')).toBe(true);

    const blocks = collectExtractionBlocks(root);
    expect(blocks.every(block => block.type !== 'code_class')).toBe(true);
    expect(blocks.filter(block => block.type === 'code_function')).toHaveLength(2);
    expect(blocks.filter(block => block.type === 'code_method')).toHaveLength(2);
  });

  it('changes only the edited function block and its ancestors on a one-function edit', async () => {
    const edited = TS_SOURCE.replace('return input.trim();', 'return input.trim().toLowerCase();');
    const before = okRoot(await parseSourceFile('mod.ts', Buffer.from(TS_SOURCE), OPTIONS));
    const after = okRoot(await parseSourceFile('mod.ts', Buffer.from(edited), OPTIONS));

    const hashes = (node: ASTNode, acc: Map<string, string> = new Map()): Map<string, string> => {
      acc.set(node.id, node.type);
      for (const child of node.children ?? []) hashes(child, acc);
      return acc;
    };
    const beforeHashes = hashes(before);
    const afterHashes = hashes(after);
    const changed = [...afterHashes.keys()].filter(id => !beforeHashes.has(id));
    // Exactly the edited function block and the root re-hash; the class,
    // its methods, the other function, and every chunk retain their ids.
    expect(changed).toHaveLength(2);
    expect(changed.map(id => afterHashes.get(id)).sort()).toEqual(['code_function', 'root']);
  });

  it('changes only the edited method, its class container, and the root on a method edit', async () => {
    const edited = TS_SOURCE.replace('return ++this.count;', 'return this.count += 2;');
    const before = okRoot(await parseSourceFile('mod.ts', Buffer.from(TS_SOURCE), OPTIONS));
    const after = okRoot(await parseSourceFile('mod.ts', Buffer.from(edited), OPTIONS));
    const beforeIds = new Set([...flatten(before)].map(node => node.id));
    const changed = [...flatten(after)].filter(node => !beforeIds.has(node.id));
    expect(changed.map(node => node.type).sort()).toEqual(['code_class', 'code_method', 'root']);
  });

  it('parses .tsx JSX and plain .ts generics without confusion', async () => {
    const tsx = 'export function App() {\n  return <div a={1}>hi</div>;\n}\n';
    const tsxRoot = okRoot(await parseSourceFile('App.tsx', Buffer.from(tsx), OPTIONS));
    expect(nodeText(tsxRoot)).toBe(tsx);

    const generic = 'const cast = <T,>(v: unknown) => v as T;\nexport function id<T>(v: T): T { return v; }\n';
    const tsRoot = okRoot(await parseSourceFile('gen.ts', Buffer.from(generic), OPTIONS));
    expect(nodeText(tsRoot)).toBe(generic);
  });

  it('returns a typed parse_error skip for invalid syntax', async () => {
    const result = await parseSourceFile('bad.ts', Buffer.from('function {{{'), OPTIONS);
    expect(result).toMatchObject({ ok: false, reason: 'parse_error' });
  });
});

describe('parseSourceFile — Python', () => {
  it('is deterministic, covers exact bytes, and exposes functions/classes/methods', async () => {
    const a = okRoot(await parseSourceFile('mod.py', Buffer.from(PY_SOURCE), OPTIONS));
    const b = okRoot(await parseSourceFile('mod.py', Buffer.from(PY_SOURCE), OPTIONS));
    expect(a).toEqual(b);
    expect(nodeText(a)).toBe(PY_SOURCE);

    const types = a.children!.map(child => child.type);
    expect(types).toEqual([
      'code_chunk',    // import + LIMIT
      'code_function', // @staticmethod def alpha (decorator included)
      'code_chunk',    // blank lines
      'code_class',    // class Widget
      'code_chunk',    // blank lines
      'code_function', // def beta
      'code_chunk',    // trailing newline
    ]);
    const alpha = a.children![1];
    expect(alpha.content!.startsWith('@staticmethod\ndef alpha')).toBe(true);

    const widget = a.children![3];
    expect(widget.children!.map(child => child.type)).toEqual([
      'code_chunk',  // class header + docstring + attribute
      'code_method', // increment
      'code_chunk',  // blank line
      'code_method', // reset
    ]);
    expect(nodeText(widget).startsWith('class Widget:')).toBe(true);
  });

  it('keeps untouched function hashes on a one-function edit', async () => {
    const edited = PY_SOURCE.replace('return [value]', 'return [value, value]');
    const before = okRoot(await parseSourceFile('mod.py', Buffer.from(PY_SOURCE), OPTIONS));
    const after = okRoot(await parseSourceFile('mod.py', Buffer.from(edited), OPTIONS));
    const beforeIds = new Set([...flatten(before)].map(node => node.id));
    const changed = [...flatten(after)].filter(node => !beforeIds.has(node.id));
    expect(changed.map(node => node.type).sort()).toEqual(['code_function', 'root']);
  });

  it('returns a typed parse_error skip for invalid syntax', async () => {
    const result = await parseSourceFile('bad.py', Buffer.from('def broken(:\n'), OPTIONS);
    expect(result).toMatchObject({ ok: false, reason: 'parse_error' });
  });
});

describe('parseSourceFile — fallback and skips', () => {
  it('chunks configuration/text formats as opaque_text with exact coverage', async () => {
    const json = '{\n  "name": "trellis-engine",\n  "version": "1.0.0"\n}\n';
    const result = await parseSourceFile('package.json', Buffer.from(json), OPTIONS);
    const root = okRoot(result);
    expect(root.children!.every(child => child.type === 'opaque_text')).toBe(true);
    expect(nodeText(root)).toBe(json);
    expect(collectExtractionBlocks(root)).toHaveLength(root.children!.length);
  });

  it('keeps markdown on the pinned parseMarkdownToAST preimage', async () => {
    const markdown = '# Title\n\nBody paragraph.';
    const result = await parseSourceFile('README.md', Buffer.from(markdown), OPTIONS);
    expect(okRoot(result)).toEqual(parseMarkdownToAST(markdown));
  });

  it('skips unsupported extensions, NUL-bearing binaries, and invalid UTF-8 with typed reasons', async () => {
    expect(await parseSourceFile('logo.png', Buffer.from('x'), OPTIONS))
      .toEqual({ ok: false, reason: 'unsupported_extension' });
    expect(await parseSourceFile('data.ts', Buffer.from([0x61, 0x00, 0x62]), OPTIONS))
      .toEqual({ ok: false, reason: 'binary' });
    expect(await parseSourceFile('data.ts', Buffer.from([0xff, 0xfe, 0x61]), OPTIONS))
      .toEqual({ ok: false, reason: 'decode_error' });
  });
});

function* flatten(node: ASTNode): Generator<ASTNode> {
  yield node;
  for (const child of node.children ?? []) yield* flatten(child);
}
