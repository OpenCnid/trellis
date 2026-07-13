// Session 38 (STRUCTURAL_CHUNKING.md §4): the generic tree seam.
//
// Structural chunking consumes ONE parser-agnostic tree shape — node
// type, half-open span over the exact source string, ordered children —
// so the cAST walk (structural_chunker.ts) is written once and any
// engine that can emit this shape can feed it. Spans are UTF-16
// code-unit offsets with String.prototype.slice semantics (the same
// ephemeral slicing mechanism Babel spans are today); nothing positional
// is ever persisted (guardrail 1 / the record's T13 fence).
//
// Validation is strict and typed: a tree whose spans are unordered,
// overlapping, or escape their parent is refused before any chunking —
// never a guessed tree.

export interface GenericTreeNode {
  type: string;
  /** Inclusive UTF-16 code-unit offset into the source string. */
  start: number;
  /** Exclusive UTF-16 code-unit offset into the source string. */
  end: number;
  children: GenericTreeNode[];
}

export class GenericTreeValidationError extends Error {
  constructor(message: string) {
    super(`generic tree validation failed: ${message}`);
    this.name = 'GenericTreeValidationError';
  }
}

function describe(node: GenericTreeNode): string {
  return `${node.type}[${node.start},${node.end})`;
}

/**
 * Validates the structural invariants the chunker depends on:
 *   * every span is well-formed and inside [0, sourceLength];
 *   * every child span nests inside its parent's span;
 *   * sibling spans are ordered and non-overlapping.
 * Throws GenericTreeValidationError on the first violation.
 */
export function validateGenericTree(root: GenericTreeNode, sourceLength: number): void {
  const stack: GenericTreeNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (
      !Number.isInteger(node.start)
      || !Number.isInteger(node.end)
      || node.start < 0
      || node.end < node.start
      || node.end > sourceLength
    ) {
      throw new GenericTreeValidationError(
        `${describe(node)} is not a well-formed span within [0, ${sourceLength}]`
      );
    }
    let cursor = node.start;
    for (const child of node.children) {
      if (child.start < node.start || child.end > node.end) {
        throw new GenericTreeValidationError(
          `child ${describe(child)} escapes parent ${describe(node)}`
        );
      }
      if (child.start < cursor) {
        throw new GenericTreeValidationError(
          `child ${describe(child)} overlaps or precedes its previous sibling in ${describe(node)}`
        );
      }
      cursor = child.end;
      stack.push(child);
    }
  }
}
