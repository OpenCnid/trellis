// Session 24: the Python<->TypeScript block parity pin. The
// `get_ast_blocks` accessor (src/rlm/trellis_tools.py) walks a stored
// root's `data` JSONB with the walk in src/rlm/trellis_blocks.py; this
// test pins that walk block-for-block, byte-for-byte against the
// TypeScript authority (`collectExtractionBlocks` + `nodeText` in
// traverse.ts) over real parser output. trellis_blocks.py is
// stdlib-only ON PURPOSE so this test can spawn it inside plain
// `npm test` — in CI the full Python runtime (psycopg2, neo4j, rlms)
// is installed only later, before python:check.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import * as path from 'path';
import {
  ASTNode,
  createASTNode,
  parseMarkdownToAST,
  parseUnstructuredJSONToAST,
} from './parser.js';
import { collectExtractionBlocks, nodeText } from './traverse.js';

// The same resolution the runtime config uses (src/config/index.ts),
// without importing the config module into the unit suite.
const PYTHON =
  process.env.PYTHON_EXECUTABLE
  ?? (process.platform === 'win32' ? 'python' : 'python3');

const DRIVER =
  'import sys, json; sys.path.insert(0, sys.argv[1]); '
  + 'import trellis_blocks; '
  + 'print(json.dumps(trellis_blocks.blocks_from_root(json.load(sys.stdin))))';

interface BlockView {
  id: string;
  type: string;
  text: string;
}

function pythonBlocks(root: ASTNode): BlockView[] {
  const result = spawnSync(PYTHON, ['-c', DRIVER, path.resolve('src', 'rlm')], {
    input: JSON.stringify(root),
    encoding: 'utf-8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `python trellis_blocks driver failed (exit ${result.status}): ${result.stderr}`
    );
  }
  return JSON.parse(result.stdout);
}

function tsBlocks(root: ASTNode): BlockView[] {
  return collectExtractionBlocks(root).map(block => ({
    id: block.id,
    type: block.type,
    text: nodeText(block),
  }));
}

describe('trellis_blocks.py parity with collectExtractionBlocks/nodeText', () => {
  it('agrees block-for-block over a markdown document', () => {
    // Headings and paragraphs (text in children — the _node_text
    // reconstruction path), inline emphasis that must never be emitted
    // alone, a list whose items swallow their inner paragraphs, a
    // fenced code block, a blockquote container traversed through, and
    // a thematicBreak that is skipped (childless, no content).
    const markdown = [
      '# Entry 5',
      '',
      'The archivist finds **bold** and *quiet* evidence.',
      '',
      '- first item with `inline code`',
      '- second item',
      '',
      '> A quoted paragraph inside a container.',
      '',
      '```',
      'code block bytes',
      '```',
      '',
      '---',
      '',
      'Closing paragraph.',
      '',
    ].join('\n');
    const root = parseMarkdownToAST(markdown);
    const expected = tsBlocks(root);
    // The fixture must actually cover the branches it claims to cover.
    expect(expected.map(block => block.type)).toEqual([
      'heading', 'paragraph', 'listItem', 'listItem', 'paragraph', 'code', 'paragraph',
    ]);
    expect(pythonBlocks(root)).toEqual(expected);
  });

  it('agrees over childless content nodes (the unstructured/PDF shape)', () => {
    const root = parseUnstructuredJSONToAST([
      { type: 'Title', text: 'Report' },
      { type: 'NarrativeText', text: 'Body text.', metadata: { page_number: 2 } },
    ]);
    const expected = tsBlocks(root);
    expect(expected.map(block => block.type)).toEqual(['Title', 'NarrativeText']);
    expect(pythonBlocks(root)).toEqual(expected);
  });

  it('agrees over code-aware trees (code_class traversed through)', () => {
    const fn = createASTNode('code_function', 'def a():\n    return 1');
    const method = createASTNode('code_method', 'def m(self):\n    return 2');
    const chunk = createASTNode('code_chunk', 'X = 3');
    const klass = createASTNode('code_class', undefined, [method, chunk]);
    const opaque = createASTNode('opaque_text', 'binary-ish remainder');
    const root = createASTNode('root', undefined, [fn, klass, opaque]);
    const expected = tsBlocks(root);
    expect(expected.map(block => block.type)).toEqual([
      'code_function', 'code_method', 'code_chunk', 'opaque_text',
    ]);
    expect(pythonBlocks(root)).toEqual(expected);
  });
});
