import { describe, expect, it } from 'vitest';
import {
  isExcludedDirectoryPath,
  isValidRepoKey,
  repoDocKey,
  validateRepoRelativePath,
} from './paths';
import { diffManifests } from './manifest';
import { classifyRepositoryPath, countSkipReasons, parseGitFileList } from './scanner';

describe('validateRepoRelativePath', () => {
  it('accepts normalized POSIX relative paths', () => {
    expect(validateRepoRelativePath('src/core/ast/parser.ts')).toEqual({
      ok: true,
      path: 'src/core/ast/parser.ts',
    });
    expect(validateRepoRelativePath('README.md').ok).toBe(true);
    expect(validateRepoRelativePath('.github/workflows/ci.yml').ok).toBe(true);
  });

  it('rejects traversal, absolute, NUL, backslash, and degenerate paths', () => {
    for (const bad of [
      '',
      '../outside.ts',
      'src/../../outside.ts',
      'src/./parser.ts',
      '/etc/passwd',
      'C:/windows/system32',
      'c:\\windows',
      'src\\parser.ts',
      'src//parser.ts',
      'src/parser.ts\0',
      '..',
    ]) {
      expect(validateRepoRelativePath(bad)).toEqual({ ok: false, reason: 'invalid_path' });
    }
  });
});

describe('repo keys and doc keys', () => {
  it('accepts stable keys and rejects separators/whitespace', () => {
    expect(isValidRepoKey('trellis-engine')).toBe(true);
    expect(isValidRepoKey('Repo_1.2')).toBe(true);
    expect(isValidRepoKey('')).toBe(false);
    expect(isValidRepoKey('has space')).toBe(false);
    expect(isValidRepoKey('has:colon')).toBe(false);
    expect(isValidRepoKey('has/slash')).toBe(false);
    expect(isValidRepoKey('-leading')).toBe(false);
  });

  it('derives deterministic repo-scoped document identities', () => {
    expect(repoDocKey('trellis', 'src/api/server.ts')).toBe('repo:trellis:src/api/server.ts');
  });
});

describe('isExcludedDirectoryPath', () => {
  it('matches vendor/generated segments anywhere except the basename', () => {
    expect(isExcludedDirectoryPath('node_modules/pkg/index.js')).toBe(true);
    expect(isExcludedDirectoryPath('src/frontend/.next/build.js')).toBe(true);
    expect(isExcludedDirectoryPath('dist/src/api/server.js')).toBe(true);
    expect(isExcludedDirectoryPath('src/core/ast/parser.ts')).toBe(false);
    // A file merely named like a vendor dir is not excluded.
    expect(isExcludedDirectoryPath('docs/vendor')).toBe(false);
  });
});

describe('diffManifests', () => {
  it('computes sorted add/retain/remove sets', () => {
    expect(diffManifests(['b.ts', 'a.ts', 'c.ts'], ['c.ts', 'd.ts', 'a.ts'])).toEqual({
      added: ['d.ts'],
      retained: ['a.ts', 'c.ts'],
      removed: ['b.ts'],
    });
    expect(diffManifests([], ['x'])).toEqual({ added: ['x'], retained: [], removed: [] });
    expect(diffManifests(['x'], [])).toEqual({ added: [], retained: [], removed: ['x'] });
  });
});

describe('parseGitFileList', () => {
  it('splits NUL-separated output, deduplicates, and sorts deterministically', () => {
    expect(parseGitFileList('b.ts\0a.py\0a.py\0dir/c.md\0')).toEqual([
      'a.py',
      'b.ts',
      'dir/c.md',
    ]);
    expect(parseGitFileList('')).toEqual([]);
  });
});

describe('classifyRepositoryPath', () => {
  const file = { isFile: true, isSymbolicLink: false, size: 100 };

  it('accepts a supported, tracked, regular file under the size limit', () => {
    expect(classifyRepositoryPath('src/parser.ts', file, 1000)).toEqual({
      accept: true,
      size: 100,
    });
  });

  it('produces deterministic typed skip reasons', () => {
    expect(classifyRepositoryPath('../escape.ts', file, 1000))
      .toEqual({ accept: false, reason: 'invalid_path' });
    expect(classifyRepositoryPath('node_modules/x.js', file, 1000))
      .toEqual({ accept: false, reason: 'excluded_directory' });
    expect(classifyRepositoryPath('logo.png', file, 1000))
      .toEqual({ accept: false, reason: 'unsupported_extension' });
    expect(classifyRepositoryPath('src/a.ts', { ...file, isSymbolicLink: true }, 1000))
      .toEqual({ accept: false, reason: 'symlink' });
    expect(classifyRepositoryPath('src/a.ts', { ...file, isFile: false }, 1000))
      .toEqual({ accept: false, reason: 'not_a_file' });
    expect(classifyRepositoryPath('src/a.ts', null, 1000))
      .toEqual({ accept: false, reason: 'not_a_file' });
    expect(classifyRepositoryPath('src/a.ts', { ...file, size: 1001 }, 1000))
      .toEqual({ accept: false, reason: 'oversize' });
  });

  it('counts skip reasons deterministically', () => {
    expect(countSkipReasons([
      { path: 'a.png', reason: 'unsupported_extension' },
      { path: 'b.png', reason: 'unsupported_extension' },
      { path: 'link.ts', reason: 'symlink' },
    ])).toEqual({ unsupported_extension: 2, symlink: 1 });
  });
});
