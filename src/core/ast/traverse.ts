import { ASTNode } from './parser.js';

// Shared AST traversal helpers. These were previously duplicated between
// the API server and the OOLONG corpus builder (roadmap T15); this module
// is now the single implementation both import.

/** Depth-first flatten: every node exactly once, parents before children. */
export function flattenAST(node: ASTNode, acc: ASTNode[] = []): ASTNode[] {
  acc.push(node);
  for (const child of node.children ?? []) {
    flattenAST(child, acc);
  }
  return acc;
}

/**
 * Reconstructs the full text of a subtree by concatenating its leaf
 * content in document order, so `Globex **acquired** Initech` reads back
 * as one string rather than three inline fragments.
 */
export function nodeText(node: ASTNode): string {
  if (node.content !== undefined) return node.content;
  return (node.children ?? []).map(nodeText).join('');
}

// Markdown block types that form one extraction unit each. Traversal
// stops at the first block it meets, so a listItem swallows its inner
// paragraphs (and any nested list) into a single unit, and inline leaves
// (text, strong, emphasis, inlineCode) are never emitted on their own.
const MARKDOWN_BLOCK_TYPES = new Set(['paragraph', 'heading', 'listItem', 'code']);

// Code-aware block types (Session 8, source_parser.ts). Functions,
// methods, bounded module chunks, and opaque-text chunks are explicit
// extraction units; code_class is deliberately absent — it is a
// container whose methods and header/attribute chunks are the units, so
// class bytes are never extracted twice.
//
// Session 38 note: the structural-chunking kinds (code_import,
// code_const, code_type, code_statement) are ALWAYS leaves with
// content, so the childless-with-content branch below collects them
// without membership here — the walk (and its trellis_blocks.py twin)
// stays byte-identical for every existing document.
const CODE_BLOCK_TYPES = new Set([
  'code_function',
  'code_method',
  'code_chunk',
  'opaque_text',
]);

// Session 38 (STRUCTURAL_CHUNKING.md §2 axis 4): the recorded per-kind
// extraction-eligibility decision for the structural kinds. code_import
// is typed-and-skipped — imports are reference plumbing whose extracted
// names are exactly the cross-file generic-identifier class Session 25
// suppresses, so they stay readable blocks (get_ast_blocks returns
// them) but never become paid extraction or embedding jobs. code_const,
// code_type, and code_statement are eligible: they are the semantic
// backbone the upgrade exists to surface. Widening or shrinking this
// set is a recorded owner-visible decision, never a convenience edit.
export const EXTRACTION_INELIGIBLE_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'code_import',
]);

/**
 * Selects the AST nodes that should each become one extraction job
 * (roadmap T2). For markdown these are the top-most block-level nodes;
 * containers (root, list, blockquote, code_class) are traversed through.
 * Childless nodes that carry content (PDF elements from unstructured.io,
 * html blocks) are extraction units as-is. Childless nodes without
 * content (thematicBreak, break, image) are skipped — they still
 * participate in Merkle hashing and persistence, just not in extraction.
 */
export function collectExtractionBlocks(node: ASTNode, acc: ASTNode[] = []): ASTNode[] {
  if (MARKDOWN_BLOCK_TYPES.has(node.type) || CODE_BLOCK_TYPES.has(node.type)) {
    acc.push(node);
    return acc;
  }
  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      collectExtractionBlocks(child, acc);
    }
    return acc;
  }
  if (node.content !== undefined) {
    acc.push(node);
  }
  return acc;
}
