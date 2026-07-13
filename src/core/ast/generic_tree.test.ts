import { describe, expect, it } from 'vitest';
import {
  GenericTreeValidationError,
  validateGenericTree,
  type GenericTreeNode,
} from './generic_tree';

function node(
  type: string,
  start: number,
  end: number,
  children: GenericTreeNode[] = []
): GenericTreeNode {
  return { type, start, end, children };
}

describe('validateGenericTree', () => {
  it('accepts a well-formed nested tree', () => {
    const root = node('program', 0, 100, [
      node('import_statement', 0, 20),
      node('function_declaration', 25, 90, [
        node('identifier', 34, 39),
        node('statement_block', 45, 90, [node('return_statement', 50, 85)]),
      ]),
    ]);
    expect(() => validateGenericTree(root, 100)).not.toThrow();
  });

  it('refuses a span past the source length', () => {
    expect(() => validateGenericTree(node('program', 0, 101), 100)).toThrow(
      GenericTreeValidationError
    );
  });

  it('refuses a negative or inverted span', () => {
    expect(() => validateGenericTree(node('program', -1, 10), 100)).toThrow(
      GenericTreeValidationError
    );
    expect(() => validateGenericTree(node('program', 10, 5), 100)).toThrow(
      GenericTreeValidationError
    );
    expect(() => validateGenericTree(node('program', 0.5, 10), 100)).toThrow(
      GenericTreeValidationError
    );
  });

  it('refuses a child escaping its parent', () => {
    const root = node('program', 10, 50, [node('statement', 5, 20)]);
    expect(() => validateGenericTree(root, 100)).toThrow(/escapes parent/);
  });

  it('refuses overlapping siblings', () => {
    const root = node('program', 0, 100, [
      node('a', 0, 30),
      node('b', 20, 60),
    ]);
    expect(() => validateGenericTree(root, 100)).toThrow(/overlaps or precedes/);
  });

  it('refuses out-of-order siblings', () => {
    const root = node('program', 0, 100, [
      node('a', 50, 60),
      node('b', 10, 20),
    ]);
    expect(() => validateGenericTree(root, 100)).toThrow(/overlaps or precedes/);
  });

  it('validates deep descendants, not just direct children', () => {
    const root = node('program', 0, 100, [
      node('outer', 0, 80, [node('inner', 0, 90)]),
    ]);
    expect(() => validateGenericTree(root, 100)).toThrow(/escapes parent/);
  });
});
