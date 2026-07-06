import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { detectLanguage, type ParseSkipReason } from '../ast/source_parser.js';
import {
  isExcludedDirectoryPath,
  validateRepoRelativePath,
} from './paths.js';

// Session 8: repository file enumeration and selection.
//
// The default file set is git's tracked-file index — `git ls-files -z`
// via execFile with an argument vector (no shell interpolation, no
// quoting layer). An explicit flag widens the set to untracked files
// that .gitignore does not exclude. Everything else about selection is
// deterministic and reported as typed skip reasons with stable counts.

export type ScanSkipReason =
  | 'invalid_path'
  | 'excluded_directory'
  | 'symlink'
  | 'not_a_file'
  | 'oversize'
  | 'unsupported_extension'
  // Parse-time reasons (binary/decode_error/parse_error/coverage_error)
  // share the same vocabulary so one counter covers the whole funnel.
  | ParseSkipReason;

export interface ScannedFile {
  path: string;
  size: number;
}

export interface SkippedFile {
  path: string;
  reason: ScanSkipReason;
}

export interface RepositoryScan {
  accepted: ScannedFile[];
  skipped: SkippedFile[];
}

export const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;

export function parseGitFileList(stdout: string): string[] {
  return [...new Set(stdout.split('\0').filter(entry => entry.length > 0))].sort();
}

export function listTrackedFiles(
  root: string,
  includeUntracked: boolean
): Promise<string[]> {
  const args = ['-C', root, 'ls-files', '-z', '--cached'];
  if (includeUntracked) args.push('--others', '--exclude-standard');
  return new Promise((resolve, reject) => {
    execFile('git', args, { maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
      if (error) return reject(new Error(`git ls-files failed: ${error.message}`));
      resolve(parseGitFileList(stdout));
    });
  });
}

/**
 * Pure per-path selection: validation, excluded directories, and the
 * language table. File-system facts (symlink, size, type) arrive as an
 * argument so tests need no disk.
 */
export function classifyRepositoryPath(
  relativePath: string,
  stat: { isFile: boolean; isSymbolicLink: boolean; size: number } | null,
  maxFileBytes: number
): { accept: true; size: number } | { accept: false; reason: ScanSkipReason } {
  const validation = validateRepoRelativePath(relativePath);
  if (!validation.ok) return { accept: false, reason: 'invalid_path' };
  if (isExcludedDirectoryPath(relativePath)) {
    return { accept: false, reason: 'excluded_directory' };
  }
  if (detectLanguage(relativePath) === null) {
    return { accept: false, reason: 'unsupported_extension' };
  }
  // lstat, not stat: a symlink is skipped as a link, never followed, so
  // a link pointing outside the root cannot smuggle bytes in.
  if (!stat) return { accept: false, reason: 'not_a_file' };
  if (stat.isSymbolicLink) return { accept: false, reason: 'symlink' };
  if (!stat.isFile) return { accept: false, reason: 'not_a_file' };
  if (stat.size > maxFileBytes) return { accept: false, reason: 'oversize' };
  return { accept: true, size: stat.size };
}

export interface ScanOptions {
  includeUntracked?: boolean;
  maxFileBytes?: number;
}

export async function scanRepository(
  root: string,
  options: ScanOptions = {}
): Promise<RepositoryScan> {
  const resolvedRoot = path.resolve(root);
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const entries = await listTrackedFiles(resolvedRoot, options.includeUntracked ?? false);

  const accepted: ScannedFile[] = [];
  const skipped: SkippedFile[] = [];
  for (const entry of entries) {
    let stat: { isFile: boolean; isSymbolicLink: boolean; size: number } | null = null;
    if (validateRepoRelativePath(entry).ok) {
      try {
        const lstat = await fs.lstat(path.join(resolvedRoot, entry));
        stat = {
          isFile: lstat.isFile(),
          isSymbolicLink: lstat.isSymbolicLink(),
          size: lstat.size,
        };
      } catch {
        stat = null; // e.g. staged deletion still present in the index
      }
    }
    const decision = classifyRepositoryPath(entry, stat, maxFileBytes);
    if (decision.accept) {
      accepted.push({ path: entry, size: decision.size });
    } else {
      skipped.push({ path: entry, reason: decision.reason });
    }
  }
  return { accepted, skipped };
}

export function countSkipReasons(skipped: readonly SkippedFile[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { reason } of skipped) {
    counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return counts;
}
