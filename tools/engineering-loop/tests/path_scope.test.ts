import { describe, expect, it } from 'vitest';
import {
  PathScopeError,
  assertPathScope,
  evaluatePathScope,
  isPathWithinScope,
  normalizeAllowedScopes,
  normalizeRepositoryPath,
} from '../src/path_scope';

describe('EL-03 segment-safe path scope', () => {
  it.each([
    'tools/engineering-loop/src/file.ts',
    'scope/space name.txt',
    'scope/ユニコード.txt',
    'scope/-leading.txt',
    'single-file.ts',
  ])('accepts lossless repository-relative path %s', path => {
    expect(normalizeRepositoryPath(path)).toBe(path);
  });

  it.each([
    '',
    '/absolute/path',
    'C:/drive/path',
    '../escape',
    'a/../escape',
    'a//b',
    'a\\b',
    'a/CON',
    'a/trailing.',
    'a/trailing ',
    'a:stream/file',
    `scope/${'e\u0301'}.txt`,
  ])('refuses traversal, aliases, and noncanonical path %j', path => {
    expect(() => normalizeRepositoryPath(path)).toThrow(PathScopeError);
  });

  it.each([
    ['tools/engineering-loop', 'tools/engineering-loop', true],
    ['tools/engineering-loop/src/a.ts', 'tools/engineering-loop', true],
    ['tools/engineering-loop-old/a.ts', 'tools/engineering-loop', false],
    ['Tools/engineering-loop/a.ts', 'tools/engineering-loop', false],
  ] as const)('compares path segments: %s within %s = %s', (path, scope, expected) => {
    expect(isPathWithinScope(path, scope)).toBe(expected);
  });

  it('normalizes scope order and refuses case-folded platform aliases', () => {
    expect(normalizeAllowedScopes(['z/path', 'a/path'])).toEqual(['a/path', 'z/path']);
    expect(() => normalizeAllowedScopes(['Tools', 'tools'])).toThrow(/platform aliases/);
  });

  it('computes every unique changed path and names all out-of-scope paths', () => {
    expect(evaluatePathScope(
      ['tools/a.ts', 'tools/a.ts', 'tools-old/b.ts', 'other/c.ts'],
      ['tools']
    )).toEqual({
      allowedScopes: ['tools'],
      changedPaths: ['other/c.ts', 'tools-old/b.ts', 'tools/a.ts'],
      outOfScope: ['other/c.ts', 'tools-old/b.ts'],
      accepted: false,
    });
  });

  it('refuses an out-of-scope changed set instead of widening the fixed scope', () => {
    expect(() => assertPathScope(['tools/a.ts', 'src/b.ts'], ['tools'])).toThrow(
      'Changed paths are outside the fixed scope: src/b.ts'
    );
  });
});
