// Session 8: pure path and identity rules for repository ingestion.
//
// Every accepted file gets a stable document identity derived from the
// caller's --repo-key and its normalized repo-relative POSIX path. A
// rename is therefore a new document plus a tombstone for the old one —
// content hashes may deduplicate physically, but document identities
// never merge.

export const REPO_DOC_KEY_PREFIX = 'repo';

// Conservative: repo keys appear inside doc_keys with ':' delimiters and
// in CLI flags, so the alphabet excludes separators and whitespace.
const REPO_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isValidRepoKey(repoKey: string): boolean {
  return REPO_KEY_PATTERN.test(repoKey);
}

export type PathValidation =
  | { ok: true; path: string }
  | { ok: false; reason: 'invalid_path' };

/**
 * Validates one repository-relative path as emitted by `git ls-files -z`
 * (POSIX separators, relative to the scan root). Absolute paths, drive
 * letters, `.`/`..` traversal segments, empty segments, backslashes, and
 * NUL bytes are rejected — joining an accepted path onto the resolved
 * root can never escape it.
 */
export function validateRepoRelativePath(raw: string): PathValidation {
  if (raw.length === 0 || raw.includes('\0') || raw.includes('\\')) {
    return { ok: false, reason: 'invalid_path' };
  }
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) {
    return { ok: false, reason: 'invalid_path' };
  }
  const segments = raw.split('/');
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    return { ok: false, reason: 'invalid_path' };
  }
  return { ok: true, path: raw };
}

export function repoDocKey(repoKey: string, relativePath: string): string {
  return `${REPO_DOC_KEY_PREFIX}:${repoKey}:${relativePath}`;
}

// Vendor/generated/artifact directories are excluded by segment match
// regardless of tracking status: tracked vendor trees exist, and their
// contents are reproducible artifacts, not source knowledge.
const EXCLUDED_SEGMENTS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  'uploads',
  '__pycache__',
  '.venv',
  'venv',
  '.next',
  'target',
]);

export function isExcludedDirectoryPath(relativePath: string): boolean {
  return relativePath.split('/').slice(0, -1).some(segment => EXCLUDED_SEGMENTS.has(segment));
}
