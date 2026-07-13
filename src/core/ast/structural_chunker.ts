import {
  validateGenericTree,
  type GenericTreeNode,
} from './generic_tree.js';

// Session 38 (STRUCTURAL_CHUNKING.md §3): the cAST-style recursive
// split-merge walk, written once against the generic tree seam.
//
// Shape (cAST, Zhang et al. 2025, arXiv:2506.15655):
//   * a node whose bytes fit the split threshold becomes one chunk;
//   * an oversized node recurses into its children;
//   * adjacent small siblings of the SAME kind greedily merge up to the
//     merge target (density without losing typed identity — merging
//     across kinds would blur extraction eligibility, so runs of one
//     kind merge and a kind change starts a new segment; recorded
//     decision, Session 38);
//   * oversized childless leaves stay whole — blocks are exact bytes,
//     never split mid-construct;
//   * gap bytes and comments glue to the FOLLOWING construct (a doc
//     comment travels with its function); trailing gap appends to the
//     preceding segment; giant gaps (> split threshold) become bounded
//     code_chunk segments instead of distorting a construct's block.
//
// Concatenating emitted segment text depth-first reproduces the input
// span byte-for-byte — enforced here AND re-checked by the caller's
// coversSource invariant. The walk is pure and deterministic; language
// knowledge arrives as a LanguageChunkProfile (node type → block kind),
// never as parser-specific logic.

// Block-kind vocabulary. code_function / code_method / code_class /
// code_chunk intentionally reuse the Session 8 strings from
// source_parser.ts (importing them would cycle: source_parser imports
// this module); the four new kinds are Session 38's typed gap material.
export const CODE_IMPORT_TYPE = 'code_import';
export const CODE_CONST_TYPE = 'code_const';
// The kind string is 'code_type': type aliases, interfaces, enums.
export const CODE_TYPE_TYPE = 'code_type';
export const CODE_STATEMENT_TYPE = 'code_statement';

// Budget (record §3): target 2,000–3,000 chars, hard cap 4,000. The
// split threshold equals source_parser.ts MAX_CHUNK_CHARS by design —
// policy 2 introduces no new over-cap class beyond whole childless
// leaves. Tuned once at the pilot, never silently.
export const STRUCTURAL_SPLIT_THRESHOLD_CHARS = 4000;
export const STRUCTURAL_MERGE_TARGET_CHARS = 3000;

export type NodeClassification =
  | { role: 'leaf'; kind: string }
  | { role: 'container' }
  | { role: 'unwrap' }
  | { role: 'trivia' };

export interface LanguageChunkProfile {
  /** Maps one tree node type to its chunking role/kind. */
  classify(nodeType: string, inContainerBody: boolean): NodeClassification;
  /** Node types holding a container's members (class_body, block). */
  containerBodyTypes: ReadonlySet<string>;
}

export interface ChunkSegmentLeaf {
  kind: string;
  text: string;
}

export interface ChunkSegmentContainer {
  kind: 'code_class';
  children: ChunkSegment[];
}

export type ChunkSegment = ChunkSegmentLeaf | ChunkSegmentContainer;

export interface StructuralChunkOptions {
  splitThreshold?: number;
  mergeTarget?: number;
}

export class StructuralChunkError extends Error {
  constructor(message: string) {
    super(`structural chunking failed: ${message}`);
    this.name = 'StructuralChunkError';
  }
}

/** The exact splitBoundedChunks algorithm (source_parser.ts), local to
 * avoid an import cycle: line-boundary splits, a single line longer
 * than the bound stays whole. */
function splitGapBounded(text: string, maxChars: number): string[] {
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

export function segmentText(segment: ChunkSegment): string {
  if ('text' in segment) return segment.text;
  return segment.children.map(segmentText).join('');
}

interface WalkContext {
  source: string;
  profile: LanguageChunkProfile;
  splitThreshold: number;
  mergeTarget: number;
}

interface ResolvedNode {
  cls: { role: 'leaf'; kind: string } | { role: 'container' };
  /** The node carrying the container body (the inner declaration for
   * unwrapped export/decorated wrappers; the node itself otherwise). */
  bodyHost: GenericTreeNode;
}

/** Resolves unwrap wrappers (export_statement, decorated_definition) to
 * the classification of their inner declaration. The SPAN always stays
 * the outer node's — wrapper bytes belong to the construct's block. */
function resolveClassification(
  ctx: WalkContext,
  node: GenericTreeNode,
  inContainerBody: boolean
): ResolvedNode {
  let host = node;
  let cls = ctx.profile.classify(host.type, inContainerBody);
  // Bounded: wrappers nest at most a couple deep; a cycle in a profile
  // is a defect, not something to spin on.
  for (let depth = 0; cls.role === 'unwrap' && depth < 4; depth++) {
    const inner = host.children.find(child => {
      const role = ctx.profile.classify(child.type, inContainerBody).role;
      return role === 'leaf' || role === 'container' || role === 'unwrap';
    });
    if (!inner) break;
    host = inner;
    cls = ctx.profile.classify(host.type, inContainerBody);
  }
  if (cls.role === 'leaf') return { cls, bodyHost: host };
  if (cls.role === 'container') return { cls, bodyHost: host };
  // Unresolvable wrapper or a trivia type routed here defensively: an
  // ordinary statement block.
  return { cls: { role: 'leaf', kind: CODE_STATEMENT_TYPE }, bodyHost: host };
}

/**
 * Chunks the span [spanStart, spanEnd) whose immediate structure is
 * `nodes` (ordered, validated). Returns segments whose concatenated
 * text equals source.slice(spanStart, spanEnd) exactly.
 */
function chunkSpan(
  ctx: WalkContext,
  nodes: readonly GenericTreeNode[],
  spanStart: number,
  spanEnd: number,
  inContainerBody: boolean
): ChunkSegment[] {
  const segments: ChunkSegment[] = [];
  let buffer: { kind: string; text: string } | null = null;
  let cursor = spanStart;

  const flush = () => {
    if (buffer) {
      segments.push({ kind: buffer.kind, text: buffer.text });
      buffer = null;
    }
  };
  const emitGapChunks = (text: string) => {
    flush();
    for (const piece of splitGapBounded(text, ctx.splitThreshold)) {
      segments.push({ kind: 'code_chunk', text: piece });
    }
  };

  for (const node of nodes) {
    if (node.start < cursor || node.end > spanEnd) {
      throw new StructuralChunkError(
        `node ${node.type}[${node.start},${node.end}) outside walk span [${cursor},${spanEnd})`
      );
    }
    const rawCls = ctx.profile.classify(node.type, inContainerBody);
    if (rawCls.role === 'trivia') {
      // Comments stay gap material glued to the next construct; the
      // cursor does not advance, so their bytes ride the next extent.
      continue;
    }

    // A gap too large to glue becomes bounded structureless chunks —
    // never the prefix of a construct's block.
    if (node.start - cursor > ctx.splitThreshold) {
      emitGapChunks(ctx.source.slice(cursor, node.start));
      cursor = node.start;
    }

    const resolved = resolveClassification(ctx, node, inContainerBody);
    const nodeLength = node.end - node.start;

    if (resolved.cls.role === 'container') {
      flush();
      segments.push({
        kind: 'code_class',
        children: chunkContainer(ctx, node, resolved.bodyHost, cursor),
      });
      cursor = node.end;
      continue;
    }

    const kind = resolved.cls.kind;
    if (nodeLength > ctx.splitThreshold && node.children.length > 0) {
      // Oversized construct: recurse. The preceding gap and any wrapper
      // bytes ride into the recursion as leading gap.
      flush();
      segments.push(...chunkSpan(ctx, node.children, cursor, node.end, false));
      cursor = node.end;
      continue;
    }

    const extent = ctx.source.slice(cursor, node.end);
    if (nodeLength > ctx.splitThreshold) {
      // Oversized childless leaf: stays whole, counted by measurement.
      flush();
      segments.push({ kind, text: extent });
    } else if (
      buffer !== null
      && buffer.kind === kind
      && buffer.text.length + extent.length <= ctx.mergeTarget
    ) {
      buffer.text += extent;
    } else {
      flush();
      buffer = { kind, text: extent };
    }
    cursor = node.end;
  }

  // Trailing gap: append to the open buffer or the last leaf segment —
  // descending into a trailing container so a class at end-of-scope
  // absorbs the final bytes instead of spawning a confetti chunk; giant
  // trailing gaps and gaps with nothing before them become bounded
  // chunks.
  if (cursor < spanEnd) {
    const trailing = ctx.source.slice(cursor, spanEnd);
    if (trailing.length > ctx.splitThreshold) {
      emitGapChunks(trailing);
    } else if (buffer !== null) {
      (buffer as { kind: string; text: string }).text += trailing;
    } else if (!appendToLastLeaf(segments, trailing)) {
      emitGapChunks(trailing);
    }
  }
  flush();
  return segments;
}

/** Appends trailing text to the deepest last leaf segment; false when
 * there is no leaf to receive it. */
function appendToLastLeaf(segments: ChunkSegment[], text: string): boolean {
  const last = segments[segments.length - 1];
  if (!last) return false;
  if ('text' in last) {
    last.text += text;
    return true;
  }
  return appendToLastLeaf(last.children, text);
}

/** Container (class) recursion: members chunk inside the container's
 * extent; header bytes (decorators, export keywords, name, heritage,
 * the opening brace) glue to the first member, the closing brace to the
 * last. A container is ALWAYS a container — never merged, never a leaf
 * — preserving the Session 8 rule that class bytes are never an
 * extraction unit themselves. */
function chunkContainer(
  ctx: WalkContext,
  outer: GenericTreeNode,
  bodyHost: GenericTreeNode,
  extentStart: number
): ChunkSegment[] {
  const body = bodyHost.children.find(child => ctx.profile.containerBodyTypes.has(child.type));
  if (!body) {
    return [{
      kind: CODE_STATEMENT_TYPE,
      text: ctx.source.slice(extentStart, outer.end),
    }];
  }
  return chunkSpan(ctx, body.children, extentStart, outer.end, true);
}

/**
 * The policy-2 entry point: one validated generic tree + the exact
 * source it spans → typed segments covering [0, source.length)
 * byte-for-byte. Throws StructuralChunkError / the validation error on
 * any structural violation; the caller maps those to typed skips.
 */
export function chunkGenericTree(
  root: GenericTreeNode,
  source: string,
  profile: LanguageChunkProfile,
  options: StructuralChunkOptions = {}
): ChunkSegment[] {
  validateGenericTree(root, source.length);
  const ctx: WalkContext = {
    source,
    profile,
    splitThreshold: options.splitThreshold ?? STRUCTURAL_SPLIT_THRESHOLD_CHARS,
    mergeTarget: options.mergeTarget ?? STRUCTURAL_MERGE_TARGET_CHARS,
  };
  if (ctx.mergeTarget > ctx.splitThreshold) {
    throw new StructuralChunkError(
      `merge target ${ctx.mergeTarget} exceeds split threshold ${ctx.splitThreshold}`
    );
  }
  const segments = chunkSpan(ctx, root.children, 0, source.length, false);
  const reproduced = segments.map(segmentText).join('');
  if (reproduced !== source) {
    throw new StructuralChunkError(
      `segment concatenation does not reproduce the source `
      + `(${reproduced.length} vs ${source.length} chars)`
    );
  }
  return segments;
}
