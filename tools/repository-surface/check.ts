import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const RootFileSchema = z.strictObject({
  path: z.string().min(1).max(128).refine(value => !value.includes('/') && !value.includes('\\')),
  class: z.enum(['agent', 'compatibility', 'entrypoint', 'machine', 'metadata', 'tool']),
  maxBytes: z.number().int().positive(),
});

const RootContractSchema = z.strictObject({
  version: z.literal(1),
  rootFiles: z.array(RootFileSchema).min(1),
  rootDirectories: z.array(z.string().min(1).max(128)).min(1),
  markdownLinks: z.strictObject({
    excludePrefixes: z.array(z.string().min(1).max(256)),
  }),
  environment: z.strictObject({
    schemaPath: z.string().min(1).max(256),
    examplePath: z.string().min(1).max(256),
    allowedExampleOnly: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)),
  }),
  deprecatedSurfaces: z.array(z.strictObject({
    path: z.string().min(1).max(256),
    requiredText: z.string().min(1).max(512),
  })),
  forbiddenRootFiles: z.array(z.string().min(1).max(128)),
});

export type RootContract = z.infer<typeof RootContractSchema>;

export interface SurfaceIssue {
  code:
    | 'broken_markdown_link'
    | 'deprecated_marker_missing'
    | 'environment_example_extra'
    | 'environment_example_missing'
    | 'forbidden_root_file'
    | 'missing_root_directory'
    | 'missing_root_file'
    | 'oversized_root_file'
    | 'unexpected_root_directory'
    | 'unexpected_root_file';
  path: string;
  message: string;
}

function normalized(value: string): string {
  return value.replace(/\\/g, '/');
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function loadRootContract(contractPath: string): RootContract {
  const raw = JSON.parse(readFileSync(contractPath, 'utf8')) as unknown;
  const contract = RootContractSchema.parse(raw);

  const duplicateRootFiles = contract.rootFiles.length - new Set(contract.rootFiles.map(item => item.path)).size;
  const duplicateRootDirectories = contract.rootDirectories.length - new Set(contract.rootDirectories).size;
  if (duplicateRootFiles > 0 || duplicateRootDirectories > 0) {
    throw new Error('root contract contains duplicate file or directory entries');
  }
  return contract;
}

export function listRepositoryFiles(repoRoot: string): string[] {
  const output = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  return uniqueSorted(
    output
      .split('\0')
      .filter(Boolean)
      .map(normalized)
      .filter(file => existsSync(path.join(repoRoot, file))),
  );
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

function localLinkTarget(rawTarget: string): string | null {
  const trimmed = rawTarget.trim();
  const withoutTitle = trimmed.startsWith('<')
    ? trimmed.slice(1, trimmed.indexOf('>'))
    : trimmed.split(/\s+/, 1)[0];
  if (!withoutTitle || withoutTitle.startsWith('#')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(withoutTitle)) return null;

  const withoutFragment = withoutTitle.split('#', 1)[0].split('?', 1)[0];
  if (!withoutFragment) return null;
  const withoutLocator = withoutFragment.replace(/:\d+(?:-\d+)?$/, '');
  try {
    return decodeURIComponent(withoutLocator);
  } catch {
    return withoutLocator;
  }
}

function markdownLinkIssues(
  repoRoot: string,
  repositoryFiles: readonly string[],
  excludePrefixes: readonly string[],
): SurfaceIssue[] {
  const issues: SurfaceIssue[] = [];
  const markdownFiles = repositoryFiles.filter(file =>
    file.endsWith('.md') && !excludePrefixes.some(prefix => file.startsWith(prefix)),
  );
  const linkPattern = /!?\[[^\]]*\]\(([^)\r\n]+)\)/g;

  for (const markdownFile of markdownFiles) {
    const absoluteFile = path.join(repoRoot, markdownFile);
    if (!existsSync(absoluteFile)) continue;
    const text = readFileSync(absoluteFile, 'utf8');
    for (const match of text.matchAll(linkPattern)) {
      const target = localLinkTarget(match[1]);
      if (target === null) continue;
      const absoluteTarget = target.startsWith('/')
        ? path.resolve(repoRoot, `.${target}`)
        : path.resolve(path.dirname(absoluteFile), target);
      const relativeTarget = normalized(path.relative(repoRoot, absoluteTarget));
      if (relativeTarget.startsWith('../') || path.isAbsolute(relativeTarget) || !existsSync(absoluteTarget)) {
        issues.push({
          code: 'broken_markdown_link',
          path: `${markdownFile}:${lineAt(text, match.index ?? 0)}`,
          message: `local link target does not exist: ${match[1].trim()}`,
        });
      }
    }
  }
  return issues;
}

function environmentIssues(repoRoot: string, contract: RootContract): SurfaceIssue[] {
  const schemaText = readFileSync(path.join(repoRoot, contract.environment.schemaPath), 'utf8');
  const exampleText = readFileSync(path.join(repoRoot, contract.environment.examplePath), 'utf8');
  const schemaKeys = uniqueSorted(
    [...schemaText.matchAll(/^\s{2}([A-Z][A-Z0-9_]*):/gm)].map(match => match[1]),
  );
  const exampleKeys = uniqueSorted(
    [...exampleText.matchAll(/^#?([A-Z][A-Z0-9_]*)=/gm)].map(match => match[1]),
  );
  const schemaSet = new Set(schemaKeys);
  const exampleSet = new Set(exampleKeys);
  const allowedOnly = new Set(contract.environment.allowedExampleOnly);
  const issues: SurfaceIssue[] = [];

  for (const key of schemaKeys) {
    if (!exampleSet.has(key)) {
      issues.push({
        code: 'environment_example_missing',
        path: contract.environment.examplePath,
        message: `missing EnvSchema key: ${key}`,
      });
    }
  }
  for (const key of exampleKeys) {
    if (!schemaSet.has(key) && !allowedOnly.has(key)) {
      issues.push({
        code: 'environment_example_extra',
        path: contract.environment.examplePath,
        message: `key is neither in EnvSchema nor allowedExampleOnly: ${key}`,
      });
    }
  }
  return issues;
}

export function checkRepositorySurface(
  repoRoot: string,
  contract: RootContract,
  files = listRepositoryFiles(repoRoot),
): SurfaceIssue[] {
  const repositoryFiles = uniqueSorted(files.map(normalized));
  const actualRootFiles = uniqueSorted(repositoryFiles.filter(file => !file.includes('/')));
  const actualRootDirectories = uniqueSorted(
    repositoryFiles.filter(file => file.includes('/')).map(file => file.split('/', 1)[0]),
  );
  const expectedRootFiles = uniqueSorted(contract.rootFiles.map(item => item.path));
  const expectedRootDirectories = uniqueSorted(contract.rootDirectories);
  const actualRootFileSet = new Set(actualRootFiles);
  const actualRootDirectorySet = new Set(actualRootDirectories);
  const expectedRootFileSet = new Set(expectedRootFiles);
  const expectedRootDirectorySet = new Set(expectedRootDirectories);
  const issues: SurfaceIssue[] = [];

  for (const file of actualRootFiles) {
    if (!expectedRootFileSet.has(file)) {
      issues.push({
        code: 'unexpected_root_file',
        path: file,
        message: 'repository-visible root file is not in the contract',
      });
    }
  }
  for (const file of expectedRootFiles) {
    if (!actualRootFileSet.has(file)) {
      issues.push({ code: 'missing_root_file', path: file, message: 'contracted root file is absent' });
    }
  }
  for (const directory of actualRootDirectories) {
    if (!expectedRootDirectorySet.has(directory)) {
      issues.push({
        code: 'unexpected_root_directory',
        path: directory,
        message: 'repository-visible top-level directory is not in the contract',
      });
    }
  }
  for (const directory of expectedRootDirectories) {
    if (!actualRootDirectorySet.has(directory)) {
      issues.push({
        code: 'missing_root_directory',
        path: directory,
        message: 'contracted top-level directory is absent',
      });
    }
  }

  for (const rootFile of contract.rootFiles) {
    const absolutePath = path.join(repoRoot, rootFile.path);
    if (existsSync(absolutePath)) {
      const size = statSync(absolutePath).size;
      if (size > rootFile.maxBytes) {
        issues.push({
          code: 'oversized_root_file',
          path: rootFile.path,
          message: `${size} bytes exceeds ${rootFile.maxBytes}`,
        });
      }
    }
  }

  for (const forbidden of contract.forbiddenRootFiles) {
    if (actualRootFileSet.has(forbidden) || existsSync(path.join(repoRoot, forbidden))) {
      issues.push({ code: 'forbidden_root_file', path: forbidden, message: 'artifact is forbidden at repository root' });
    }
  }

  for (const surface of contract.deprecatedSurfaces) {
    const absolutePath = path.join(repoRoot, surface.path);
    if (!existsSync(absolutePath) || !readFileSync(absolutePath, 'utf8').includes(surface.requiredText)) {
      issues.push({
        code: 'deprecated_marker_missing',
        path: surface.path,
        message: `required compatibility/archive marker is absent: ${surface.requiredText}`,
      });
    }
  }

  issues.push(...markdownLinkIssues(repoRoot, repositoryFiles, contract.markdownLinks.excludePrefixes));
  issues.push(...environmentIssues(repoRoot, contract));
  return issues.sort((left, right) =>
    left.code.localeCompare(right.code) || left.path.localeCompare(right.path),
  );
}

export function formatSurfaceReport(issues: readonly SurfaceIssue[]): string {
  if (issues.length === 0) return 'Repository surface: PASS (0 issues)';
  return [
    `Repository surface: FAIL (${issues.length} issues)`,
    ...issues.map(issue => `- [${issue.code}] ${issue.path}: ${issue.message}`),
  ].join('\n');
}
