import path from 'path';
import { Parser, Language, type Node as TreeSitterNode } from 'web-tree-sitter';
import type { GenericTreeNode } from './generic_tree.js';
import {
  CODE_CONST_TYPE,
  CODE_IMPORT_TYPE,
  CODE_STATEMENT_TYPE,
  CODE_TYPE_TYPE,
  type LanguageChunkProfile,
  type NodeClassification,
} from './structural_chunker.js';

// Session 38 (STRUCTURAL_CHUNKING.md §4): the web-tree-sitter engine
// behind the generic tree seam.
//
// Grammar assets are the version-pinned wasm blobs shipped by
// @vscode/tree-sitter-wasm (exact pin in package.json — a grammar bump
// re-hashes affected files exactly as a Babel bump would, so it is a
// recorded substrate-identity event, never a casual update). The
// runtime is web-tree-sitter (wasm — no native addon, no node-gyp,
// hermetic per pinned blob).
//
// startIndex/endIndex are UTF-16 code-unit offsets with
// String.prototype.slice semantics (verified against multi-byte
// content before adoption) — the same ephemeral span mechanism Babel
// provides today. Nothing positional is persisted.
//
// Error stance (record §8): a tree containing ERROR or missing nodes
// is REFUSED here and becomes the caller's typed parse_error skip —
// error-tolerant ingestion of broken files is a separate, deliberately
// unmade policy decision.

export type TreeSitterGrammar = 'typescript' | 'tsx' | 'javascript' | 'python';

const GRAMMAR_EXTENSIONS: ReadonlyMap<string, TreeSitterGrammar> = new Map([
  ['.ts', 'typescript'],
  ['.mts', 'typescript'],
  ['.cts', 'typescript'],
  ['.tsx', 'tsx'],
  ['.js', 'javascript'],
  ['.jsx', 'javascript'],
  ['.mjs', 'javascript'],
  ['.cjs', 'javascript'],
  ['.py', 'python'],
]);

/** Grammar for a file path, or null when structural chunking has no
 * grammar wired — the caller must treat null as "policy 2 unavailable",
 * never guess. */
export function grammarForFile(filePath: string): TreeSitterGrammar | null {
  const base = path.posix.basename(filePath.replace(/\\/g, '/')).toLowerCase();
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return null;
  return GRAMMAR_EXTENSIONS.get(base.slice(dot)) ?? null;
}

function wasmAssetPath(grammar: TreeSitterGrammar): string {
  const packageRoot = path.dirname(
    require.resolve('@vscode/tree-sitter-wasm/package.json')
  );
  return path.join(packageRoot, 'wasm', `tree-sitter-${grammar}.wasm`);
}

let parserInit: Promise<void> | null = null;
const languageCache = new Map<TreeSitterGrammar, Promise<Language>>();

function loadLanguage(grammar: TreeSitterGrammar): Promise<Language> {
  let cached = languageCache.get(grammar);
  if (!cached) {
    parserInit ??= Parser.init();
    cached = parserInit.then(() => Language.load(wasmAssetPath(grammar)));
    languageCache.set(grammar, cached);
  }
  return cached;
}

function convertNode(node: TreeSitterNode): GenericTreeNode {
  const children: GenericTreeNode[] = [];
  for (const child of node.namedChildren) {
    if (!child) continue;
    children.push(convertNode(child));
  }
  return {
    type: node.type,
    start: node.startIndex,
    end: node.endIndex,
    children,
  };
}

export type GenericTreeParseResult =
  | { ok: true; root: GenericTreeNode }
  | { ok: false; detail: string };

/**
 * Parses source with the pinned grammar and emits the generic tree.
 * Trees containing ERROR/missing nodes are refused (typed detail), so
 * downstream chunking never runs over a guessed structure.
 */
export async function parseGenericTree(
  grammar: TreeSitterGrammar,
  source: string
): Promise<GenericTreeParseResult> {
  const language = await loadLanguage(grammar);
  const parser = new Parser();
  try {
    parser.setLanguage(language);
    const tree = parser.parse(source);
    if (!tree) {
      return { ok: false, detail: `${grammar}: tree-sitter returned no tree` };
    }
    try {
      if (tree.rootNode.hasError) {
        return { ok: false, detail: `${grammar}: source contains syntax errors` };
      }
      return { ok: true, root: convertNode(tree.rootNode) };
    } finally {
      tree.delete();
    }
  } finally {
    parser.delete();
  }
}

// ---------------------------------------------------------------------------
// Language chunk profiles: tree-sitter node type → block kind. These
// are engine-adjacent knowledge — a future engine populating the seam
// brings its own profile. Per-kind extraction eligibility is decided
// separately (traverse.ts EXTRACTION_INELIGIBLE_BLOCK_TYPES).

const ECMA_LEAF_KINDS: ReadonlyMap<string, string> = new Map([
  ['import_statement', CODE_IMPORT_TYPE],
  ['lexical_declaration', CODE_CONST_TYPE],
  ['variable_declaration', CODE_CONST_TYPE],
  ['type_alias_declaration', CODE_TYPE_TYPE],
  ['interface_declaration', CODE_TYPE_TYPE],
  ['enum_declaration', CODE_TYPE_TYPE],
]);

const ECMA_FUNCTION_TYPES = new Set([
  'function_declaration',
  'generator_function_declaration',
  'function_signature',
]);

const ECMA_METHOD_TYPES = new Set([
  'method_definition',
  'abstract_method_signature',
]);

const ECMA_CLASS_TYPES = new Set([
  'class_declaration',
  'abstract_class_declaration',
]);

const TRIVIA: NodeClassification = { role: 'trivia' };
const UNWRAP: NodeClassification = { role: 'unwrap' };
const CONTAINER: NodeClassification = { role: 'container' };

/** TypeScript / TSX / JavaScript. Type-only kinds simply never appear
 * in plain JavaScript trees. */
export const ECMA_CHUNK_PROFILE: LanguageChunkProfile = {
  classify(nodeType: string, inContainerBody: boolean): NodeClassification {
    if (nodeType === 'comment' || nodeType === 'decorator') return TRIVIA;
    if (nodeType === 'export_statement' || nodeType === 'ambient_declaration') return UNWRAP;
    if (ECMA_CLASS_TYPES.has(nodeType)) return CONTAINER;
    if (ECMA_METHOD_TYPES.has(nodeType)) return { role: 'leaf', kind: 'code_method' };
    if (ECMA_FUNCTION_TYPES.has(nodeType)) {
      return { role: 'leaf', kind: inContainerBody ? 'code_method' : 'code_function' };
    }
    const mapped = ECMA_LEAF_KINDS.get(nodeType);
    if (mapped) return { role: 'leaf', kind: mapped };
    return { role: 'leaf', kind: CODE_STATEMENT_TYPE };
  },
  containerBodyTypes: new Set(['class_body']),
};

const PYTHON_IMPORT_TYPES = new Set([
  'import_statement',
  'import_from_statement',
  'future_import_statement',
]);

export const PYTHON_CHUNK_PROFILE: LanguageChunkProfile = {
  classify(nodeType: string, inContainerBody: boolean): NodeClassification {
    if (nodeType === 'comment') return TRIVIA;
    if (nodeType === 'decorated_definition') return UNWRAP;
    if (nodeType === 'class_definition') return CONTAINER;
    if (nodeType === 'function_definition') {
      return { role: 'leaf', kind: inContainerBody ? 'code_method' : 'code_function' };
    }
    if (PYTHON_IMPORT_TYPES.has(nodeType)) return { role: 'leaf', kind: CODE_IMPORT_TYPE };
    return { role: 'leaf', kind: CODE_STATEMENT_TYPE };
  },
  containerBodyTypes: new Set(['block']),
};

export function profileForGrammar(grammar: TreeSitterGrammar): LanguageChunkProfile {
  return grammar === 'python' ? PYTHON_CHUNK_PROFILE : ECMA_CHUNK_PROFILE;
}
