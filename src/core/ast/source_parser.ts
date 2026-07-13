import { execFile } from 'child_process';
import path from 'path';
import { z } from 'zod';
import { parse as parseBabel, type ParserPlugin } from '@babel/parser';
import { createASTNode, parseMarkdownToAST, type ASTNode } from './parser.js';
import { nodeText } from './traverse.js';
import {
  chunkGenericTree,
  StructuralChunkError,
  type ChunkSegment,
} from './structural_chunker.js';
import { GenericTreeValidationError } from './generic_tree.js';
import {
  grammarForFile,
  parseGenericTree,
  profileForGrammar,
} from './treesitter_engine.js';

// Session 8: code-aware parsing for whole-codebase ingestion.
//
// Raw source files previously went through parseMarkdownToAST, which
// turns braces, imports, and functions into markdown paragraphs —
// collectExtractionBlocks could never produce function/class extraction
// units. This module dispatches by language to a real syntax parser and
// emits immutable Merkle ASTs whose blocks are top-level functions,
// classes (with methods as child blocks), and bounded chunks for
// imports/statements/trivia.
//
// Invariants (Guardrail 1):
//   * Every block's content is the exact source slice it represents —
//     no normalization, no pretty-printing. Concatenating leaf contents
//     in order reproduces the file byte-for-byte, enforced below; a
//     violation is a typed skip, never a partially guessed AST.
//   * Parser-library ranges are an ephemeral slicing mechanism only.
//     No offsets, line numbers, or spans are persisted; identity stays
//     the unchanged createASTNode SHA-256 preimage.
//   * Unsupported/binary/undecodable/unparseable files produce a typed
//     skip reason.

export type SourceLanguage = 'typescript' | 'javascript' | 'python' | 'markdown' | 'text';

export type ParseSkipReason =
  | 'unsupported_extension'
  | 'binary'
  | 'decode_error'
  | 'parse_error'
  | 'coverage_error';

export type ParseSourceResult =
  | { ok: true; language: SourceLanguage; root: ASTNode }
  | { ok: false; reason: ParseSkipReason; detail?: string };

// Code node types. code_class is a container (children carry the bytes);
// the rest are leaf extraction units. opaque_text is the clearly named
// fallback for configuration/text formats.
export const CODE_FUNCTION_TYPE = 'code_function';
export const CODE_CLASS_TYPE = 'code_class';
export const CODE_METHOD_TYPE = 'code_method';
export const CODE_CHUNK_TYPE = 'code_chunk';
export const OPAQUE_TEXT_TYPE = 'opaque_text';

// Explicit language/extension table (lowercased). Anything absent is an
// unsupported_extension skip — never a guess.
const EXTENSION_LANGUAGES: ReadonlyMap<string, SourceLanguage> = new Map([
  ['.ts', 'typescript'],
  ['.tsx', 'typescript'],
  ['.mts', 'typescript'],
  ['.cts', 'typescript'],
  ['.js', 'javascript'],
  ['.jsx', 'javascript'],
  ['.mjs', 'javascript'],
  ['.cjs', 'javascript'],
  ['.py', 'python'],
  ['.md', 'markdown'],
  ['.markdown', 'markdown'],
  ['.json', 'text'],
  ['.yml', 'text'],
  ['.yaml', 'text'],
  ['.toml', 'text'],
  ['.txt', 'text'],
  ['.sql', 'text'],
  ['.css', 'text'],
  ['.html', 'text'],
  ['.sh', 'text'],
  ['.ps1', 'text'],
]);

// Extensionless or dot-prefixed well-known files (lowercased basename).
const FILENAME_LANGUAGES: ReadonlyMap<string, SourceLanguage> = new Map([
  ['dockerfile', 'text'],
  ['makefile', 'text'],
  ['license', 'text'],
  ['.gitignore', 'text'],
  ['.dockerignore', 'text'],
  ['.gitattributes', 'text'],
  ['.env.example', 'text'],
]);

export function detectLanguage(filePath: string): SourceLanguage | null {
  const base = path.posix.basename(filePath.replace(/\\/g, '/')).toLowerCase();
  const named = FILENAME_LANGUAGES.get(base);
  if (named) return named;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return null;
  return EXTENSION_LANGUAGES.get(base.slice(dot)) ?? null;
}

// Bounded module chunks: gap material (imports, statements, comments,
// whitespace) is split at line boundaries so one edited statement does
// not re-hash an arbitrarily large surrounding blob. A single line
// longer than the bound stays whole — blocks are exact bytes, never
// split mid-line.
export const MAX_CHUNK_CHARS = 4000;

export function splitBoundedChunks(text: string, maxChars: number = MAX_CHUNK_CHARS): string[] {
  if (text.length <= maxChars) return text.length > 0 ? [text] : [];
  const lines = text.split(/(?<=\n)/);
  const chunks: string[] = [];
  let current = '';
  for (const line of lines) {
    if (current.length > 0 && current.length + line.length > maxChars) {
      chunks.push(current);
      current = '';
    }
    current += line;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Depth-first leaf-content concatenation must equal the exact source. */
function coversSource(root: ASTNode, source: string): boolean {
  return nodeText(root) === source;
}

function chunkNodes(text: string, type: string): ASTNode[] {
  return splitBoundedChunks(text).map(chunk => createASTNode(type, chunk));
}

// ---------------------------------------------------------------------------
// TypeScript / JavaScript via @babel/parser (pure JS, deterministic).

interface BabelSpan {
  start: number;
  end: number;
}

function babelPlugins(fileName: string, language: SourceLanguage): ParserPlugin[] {
  const base = fileName.toLowerCase();
  if (language === 'typescript') {
    // .ts treats `<T>` as a type assertion, .tsx as JSX — enabling jsx
    // for plain .ts misparses generics, so the split is by extension.
    return base.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'];
  }
  return ['jsx'];
}

function statementSpan(stmt: { start?: number | null; end?: number | null }): BabelSpan | null {
  if (typeof stmt.start !== 'number' || typeof stmt.end !== 'number') return null;
  return { start: stmt.start, end: stmt.end };
}

function parseEcmaSource(
  fileName: string,
  source: string,
  language: SourceLanguage
): ParseSourceResult {
  let program;
  try {
    program = parseBabel(source, {
      sourceType: 'unambiguous',
      plugins: babelPlugins(fileName, language),
    }).program;
  } catch (error) {
    return {
      ok: false,
      reason: 'parse_error',
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const children: ASTNode[] = [];
  let cursor = 0;
  const flushGap = (upTo: number) => {
    if (upTo > cursor) {
      children.push(...chunkNodes(source.slice(cursor, upTo), CODE_CHUNK_TYPE));
      cursor = upTo;
    }
  };

  for (const stmt of program.body) {
    // export function / export default class carry the declaration one
    // level down; the block bytes include the export keywords.
    const decl =
      (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration')
      && stmt.declaration
        ? stmt.declaration
        : stmt;
    const span = statementSpan(stmt);
    if (!span || span.start < cursor) continue;

    if (decl.type === 'FunctionDeclaration' || decl.type === 'TSDeclareFunction') {
      flushGap(span.start);
      children.push(createASTNode(CODE_FUNCTION_TYPE, source.slice(span.start, span.end)));
      cursor = span.end;
    } else if (decl.type === 'ClassDeclaration') {
      flushGap(span.start);
      children.push(buildClassNode(source, span, decl.body.body));
      cursor = span.end;
    }
    // Everything else (imports, consts, types, expressions) stays gap
    // material and lands in bounded chunks.
  }
  flushGap(source.length);

  const root = createASTNode('root', undefined, children);
  if (!coversSource(root, source)) {
    return { ok: false, reason: 'coverage_error' };
  }
  return { ok: true, language, root };
}

function buildClassNode(
  source: string,
  classSpan: BabelSpan,
  body: ReadonlyArray<{ type: string; start?: number | null; end?: number | null }>
): ASTNode {
  const children: ASTNode[] = [];
  let cursor = classSpan.start;
  const flushGap = (upTo: number) => {
    if (upTo > cursor) {
      children.push(...chunkNodes(source.slice(cursor, upTo), CODE_CHUNK_TYPE));
      cursor = upTo;
    }
  };
  for (const member of body) {
    if (
      member.type !== 'ClassMethod'
      && member.type !== 'ClassPrivateMethod'
      && member.type !== 'TSDeclareMethod'
    ) continue;
    const span = statementSpan(member);
    if (!span || span.start < cursor || span.end > classSpan.end) continue;
    flushGap(span.start);
    children.push(createASTNode(CODE_METHOD_TYPE, source.slice(span.start, span.end)));
    cursor = span.end;
  }
  flushGap(classSpan.end);
  return createASTNode(CODE_CLASS_TYPE, undefined, children);
}

// ---------------------------------------------------------------------------
// Python via the standard-library ast module, spawned through the same
// interpreter contract as parse_pdf.py. The child receives source bytes
// on stdin and emits segment JSON, which crosses the Zod boundary below
// before any node is built (Guardrail 4).

const PythonSegmentSchema: z.ZodType<PythonSegment> = z.lazy(() =>
  z.object({
    kind: z.enum(['function', 'class', 'method', 'chunk']),
    text: z.string(),
    children: z.array(PythonSegmentSchema).optional(),
  })
);

interface PythonSegment {
  kind: 'function' | 'class' | 'method' | 'chunk';
  text: string;
  children?: PythonSegment[];
}

const PythonParseOutputSchema = z.union([
  z.object({ segments: z.array(PythonSegmentSchema) }),
  z.object({ error: z.string(), message: z.string().optional() }),
]);

// Resolved from the working directory like parse_pdf.py in server.ts:
// both the tsx dev path and the compiled image run with the repository
// root as cwd and ship scripts/ at that path.
const PYTHON_SEGMENTER_SCRIPT = path.resolve('scripts/parse_python_source.py');

function runPythonSegmenter(
  pythonExecutable: string,
  sourceBytes: Buffer
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      pythonExecutable,
      [PYTHON_SEGMENTER_SCRIPT],
      { maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(stdout))
    );
    child.stdin!.on('error', () => { /* surfaced via the exec callback */ });
    child.stdin!.end(sourceBytes);
  });
}

function pythonSegmentToNodes(segment: PythonSegment): ASTNode[] {
  switch (segment.kind) {
    case 'function':
      return [createASTNode(CODE_FUNCTION_TYPE, segment.text)];
    case 'method':
      return [createASTNode(CODE_METHOD_TYPE, segment.text)];
    case 'class':
      return [createASTNode(
        CODE_CLASS_TYPE,
        undefined,
        (segment.children ?? []).flatMap(pythonSegmentToNodes)
      )];
    case 'chunk':
      return chunkNodes(segment.text, CODE_CHUNK_TYPE);
  }
}

async function parsePythonSource(
  source: string,
  sourceBytes: Buffer,
  pythonExecutable: string
): Promise<ParseSourceResult> {
  let stdout: string;
  try {
    stdout = await runPythonSegmenter(pythonExecutable, sourceBytes);
  } catch (error) {
    return {
      ok: false,
      reason: 'parse_error',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  let parsed;
  try {
    parsed = PythonParseOutputSchema.parse(JSON.parse(stdout));
  } catch (error) {
    return {
      ok: false,
      reason: 'parse_error',
      detail: `segmenter output failed validation: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if ('error' in parsed) {
    return {
      ok: false,
      reason: parsed.error === 'decode' ? 'decode_error' : 'parse_error',
      detail: parsed.message,
    };
  }

  const root = createASTNode('root', undefined, parsed.segments.flatMap(pythonSegmentToNodes));
  if (!coversSource(root, source)) {
    return { ok: false, reason: 'coverage_error' };
  }
  return { ok: true, language: 'python', root };
}

// ---------------------------------------------------------------------------
// Session 38 (STRUCTURAL_CHUNKING.md): chunking policy 2 — tree-sitter
// through the generic tree seam into the cAST split-merge walk. Policy
// 1 (absent/1) is the Session 8 path above, byte-identical. Policy 2
// applies to the three code languages only; markdown, text, and every
// prose corpus keep their pinned geometry under every policy.

export type ChunkingPolicy = 1 | 2;

function segmentToNode(segment: ChunkSegment): ASTNode {
  if ('text' in segment) return createASTNode(segment.kind, segment.text);
  return createASTNode(
    CODE_CLASS_TYPE,
    undefined,
    segment.children.map(segmentToNode)
  );
}

async function parseStructural(
  filePath: string,
  source: string,
  language: SourceLanguage
): Promise<ParseSourceResult> {
  const grammar = grammarForFile(filePath);
  if (!grammar) {
    return {
      ok: false,
      reason: 'unsupported_extension',
      detail: `no structural grammar wired for ${filePath}`,
    };
  }
  const parsed = await parseGenericTree(grammar, source);
  if (!parsed.ok) {
    return { ok: false, reason: 'parse_error', detail: parsed.detail };
  }
  let segments: ChunkSegment[];
  try {
    segments = chunkGenericTree(parsed.root, source, profileForGrammar(grammar));
  } catch (error) {
    if (error instanceof StructuralChunkError || error instanceof GenericTreeValidationError) {
      return { ok: false, reason: 'coverage_error', detail: error.message };
    }
    throw error;
  }
  const root = createASTNode('root', undefined, segments.map(segmentToNode));
  if (!coversSource(root, source)) {
    return { ok: false, reason: 'coverage_error' };
  }
  return { ok: true, language, root };
}

export interface ParseSourceOptions {
  // Interpreter for the Python segmenter; callers pass
  // config.python.executable so this module stays config-free.
  pythonExecutable: string;
  // Session 38: absent or 1 = the Session 8 chunking above,
  // byte-identical; 2 = structural chunking (operator-explicit per run
  // — nothing defaults to 2).
  chunkingPolicy?: ChunkingPolicy;
}

/**
 * Parses one source file's exact bytes into an immutable Merkle AST, or
 * returns a typed skip. Markdown keeps parseMarkdownToAST (T13's pinned
 * preimage and its geometry-free, non-byte-exact blocks); every other
 * supported language guarantees exact byte coverage.
 */
export async function parseSourceFile(
  filePath: string,
  bytes: Buffer,
  options: ParseSourceOptions
): Promise<ParseSourceResult> {
  const language = detectLanguage(filePath);
  if (!language) return { ok: false, reason: 'unsupported_extension' };
  if (bytes.includes(0)) return { ok: false, reason: 'binary' };

  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, reason: 'decode_error' };
  }

  const structural = options.chunkingPolicy === 2;
  switch (language) {
    case 'markdown':
      return { ok: true, language, root: parseMarkdownToAST(source) };
    case 'typescript':
    case 'javascript':
      return structural
        ? parseStructural(filePath, source, language)
        : parseEcmaSource(filePath, source, language);
    case 'python':
      return structural
        ? parseStructural(filePath, source, language)
        : parsePythonSource(source, bytes, options.pythonExecutable);
    case 'text': {
      const root = createASTNode('root', undefined, chunkNodes(source, OPAQUE_TEXT_TYPE));
      if (!coversSource(root, source)) {
        return { ok: false, reason: 'coverage_error' };
      }
      return { ok: true, language, root };
    }
  }
}
