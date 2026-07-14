import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { z } from 'zod';
import {
  DOMAIN_SCHEMA_VERSION,
  MAX_PATH_LENGTH,
  StableIdSchema,
  parseBoundary,
} from './domain.js';
import { canonicalJson, sha256Canonical } from './events.js';
import {
  CommandEvidenceResultSchema,
  type BoundedCommandExecutor,
  type CommandEvidenceResult,
  type ExecutedCommand,
} from './command_evidence.js';
import { assertPathScope, normalizeRepositoryPath } from './path_scope.js';

const GitCommitSchema = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
const TimestampSchema = z.string().datetime({ offset: true });
const MAX_REPOSITORY_CHANGES = 10_000;
const utf8 = new TextDecoder('utf-8', { fatal: true });

export class RepositoryObservationError extends Error {
  readonly commandEvidence: readonly CommandEvidenceResult[];

  constructor(message: string, commandEvidence: readonly CommandEvidenceResult[] = []) {
    super(message.slice(0, 1_024));
    this.name = 'RepositoryObservationError';
    this.commandEvidence = commandEvidence;
  }
}

export const ChangedPathObservationSchema = z.strictObject({
  path: z.string().min(1).max(MAX_PATH_LENGTH),
  originalPath: z.string().min(1).max(MAX_PATH_LENGTH).nullable(),
  indexStatus: z.string().length(1),
  worktreeStatus: z.string().length(1),
  staged: z.boolean(),
  unstaged: z.boolean(),
  untracked: z.boolean(),
  deleted: z.boolean(),
  renamed: z.boolean(),
  conflicted: z.boolean(),
});

export type ChangedPathObservation = z.infer<typeof ChangedPathObservationSchema>;

const RemoteObservationSchema = z.strictObject({
  name: z.string().min(1).max(128),
  url: z.string().min(1).max(2_048),
  identity: z.string().min(1).max(2_048),
});

export const RepositoryStateObservationSchema = z.strictObject({
  id: StableIdSchema,
  schemaVersion: z.literal(DOMAIN_SCHEMA_VERSION),
  createdAt: TimestampSchema,
  origin: z.literal('controller_observed'),
  repositoryId: StableIdSchema,
  worktreeId: StableIdSchema,
  repositoryRoot: z.string().min(1).max(MAX_PATH_LENGTH),
  worktreePath: z.string().min(1).max(MAX_PATH_LENGTH),
  gitCommonDir: z.string().min(1).max(MAX_PATH_LENGTH),
  branch: z.string().min(1).max(256),
  baseCommit: GitCommitSchema,
  headCommit: GitCommitSchema,
  clean: z.boolean(),
  remote: RemoteObservationSchema,
  allowedScopes: z.array(z.string().min(1).max(MAX_PATH_LENGTH)).min(1).max(128),
  changes: z.array(ChangedPathObservationSchema).max(MAX_REPOSITORY_CHANGES),
  changedPaths: z.array(z.string().min(1).max(MAX_PATH_LENGTH)).max(MAX_REPOSITORY_CHANGES * 2),
  commandEvidenceIds: z.array(StableIdSchema).min(1).max(64),
});

export type RepositoryStateObservation = z.infer<typeof RepositoryStateObservationSchema>;

const RepositoryObserverRequestSchema = z.strictObject({
  observationId: StableIdSchema.refine(value => value.length <= 100, 'observationId must leave room for command suffixes'),
  workflowId: StableIdSchema,
  featureId: StableIdSchema,
  sessionId: StableIdSchema,
  assignedWorktree: z.string().min(1).max(MAX_PATH_LENGTH),
  expectedBranch: z.string().min(1).max(256),
  baseCommit: GitCommitSchema,
  expectedHead: GitCommitSchema.nullable(),
  remoteName: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  expectedRemoteIdentity: z.string().min(1).max(2_048),
  allowedScopes: z.array(z.string()).min(1).max(128),
  timeoutMs: z.number().int().positive().max(120_000),
});

export type RepositoryObserverRequest = z.infer<typeof RepositoryObserverRequestSchema>;

export interface RepositoryObservationResult {
  observation: RepositoryStateObservation;
  commands: CommandEvidenceResult[];
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return utf8.decode(bytes);
  } catch {
    throw new RepositoryObservationError(`${label} is not valid UTF-8`);
  }
}

function singleLine(bytes: Uint8Array, label: string): string {
  const decoded = decodeUtf8(bytes, label);
  if (decoded.includes('\0')) throw new RepositoryObservationError(`${label} contains NUL`);
  const value = decoded.replace(/\r?\n$/, '');
  if (value.length === 0 || value.includes('\n') || value.includes('\r')) {
    throw new RepositoryObservationError(`${label} is not exactly one bounded line`);
  }
  return value;
}

function splitNul(bytes: Uint8Array, label: string): string[] {
  const buffer = Buffer.from(bytes);
  if (buffer.byteLength === 0) return [];
  if (buffer[buffer.byteLength - 1] !== 0) throw new RepositoryObservationError(`${label} lacks a final NUL delimiter`);
  const values: string[] = [];
  let start = 0;
  for (let index = 0; index < buffer.byteLength; index++) {
    if (buffer[index] !== 0) continue;
    values.push(decodeUtf8(buffer.subarray(start, index), label));
    start = index + 1;
  }
  return values;
}

function splitHeaderAndPath(record: string, delimiterCount: number, label: string): { header: string[]; path: string } {
  let observed = 0;
  let boundary = -1;
  for (let index = 0; index < record.length; index++) {
    if (record[index] !== ' ') continue;
    observed++;
    if (observed === delimiterCount) {
      boundary = index;
      break;
    }
  }
  if (boundary < 0 || boundary === record.length - 1) throw new RepositoryObservationError(`${label} is malformed`);
  return { header: record.slice(0, boundary).split(' '), path: record.slice(boundary + 1) };
}

function validateHeader(
  header: string[],
  expectedLength: number,
  label: string,
  kind: 'ordinary' | 'rename' | 'unmerged'
): string {
  if (header.length !== expectedLength || !/^[.MADRCUT]{2}$/.test(header[1] ?? '')) {
    throw new RepositoryObservationError(`${label} has malformed status fields`);
  }
  if (!/^[A-Z.]{4}$/.test(header[2] ?? '')) throw new RepositoryObservationError(`${label} has malformed submodule state`);
  const modeIndexes = kind === 'unmerged' ? [3, 4, 5, 6] : [3, 4, 5];
  const hashIndexes = kind === 'unmerged' ? [7, 8, 9] : [6, 7];
  if (
    modeIndexes.some(index => !/^[0-7]{6}$/.test(header[index] ?? ''))
    || hashIndexes.some(index => !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(header[index] ?? ''))
  ) {
    throw new RepositoryObservationError(`${label} has malformed mode or object identity fields`);
  }
  return header[1];
}

function changedEntry(input: {
  path: string;
  originalPath?: string | null;
  xy: string;
  untracked?: boolean;
  renamed?: boolean;
  conflicted?: boolean;
}): ChangedPathObservation {
  const path = normalizeRepositoryPath(input.path, 'Git changed path');
  const originalPath = input.originalPath == null
    ? null
    : normalizeRepositoryPath(input.originalPath, 'Git rename source path');
  const indexStatus = input.xy[0];
  const worktreeStatus = input.xy[1];
  return parseBoundary(ChangedPathObservationSchema, {
    path,
    originalPath,
    indexStatus,
    worktreeStatus,
    staged: indexStatus !== '.' && indexStatus !== '?',
    unstaged: worktreeStatus !== '.' && worktreeStatus !== '?',
    untracked: input.untracked ?? false,
    deleted: indexStatus === 'D' || worktreeStatus === 'D',
    renamed: input.renamed ?? false,
    conflicted: input.conflicted ?? false,
  }, 'Git changed-path observation');
}

export function parseGitStatusPorcelainV2Z(bytes: Uint8Array): ChangedPathObservation[] {
  const records = splitNul(bytes, 'git status --porcelain=v2 -z output');
  const changes: ChangedPathObservation[] = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (record.startsWith('1 ')) {
      const { header, path } = splitHeaderAndPath(record, 8, 'ordinary status record');
      const xy = validateHeader(header, 8, 'ordinary status record', 'ordinary');
      changes.push(changedEntry({ path, xy }));
      continue;
    }
    if (record.startsWith('2 ')) {
      const { header, path } = splitHeaderAndPath(record, 9, 'rename status record');
      const xy = validateHeader(header, 9, 'rename status record', 'rename');
      if (!/^[RC][0-9]{1,3}$/.test(header[8] ?? '')) {
        throw new RepositoryObservationError('rename status record has malformed score');
      }
      const originalPath = records[++index];
      if (originalPath === undefined || originalPath.length === 0) {
        throw new RepositoryObservationError('rename status record lacks its NUL-delimited source path');
      }
      changes.push(changedEntry({ path, originalPath, xy, renamed: true }));
      continue;
    }
    if (record.startsWith('u ')) {
      const { header, path } = splitHeaderAndPath(record, 10, 'unmerged status record');
      const xy = validateHeader(header, 10, 'unmerged status record', 'unmerged');
      changes.push(changedEntry({ path, xy, conflicted: true }));
      continue;
    }
    if (record.startsWith('? ')) {
      changes.push(changedEntry({ path: record.slice(2), xy: '??', untracked: true }));
      continue;
    }
    throw new RepositoryObservationError('git status output contains an unknown or malformed record type');
  }
  return changes.sort((a, b) => `${a.path}\0${a.originalPath ?? ''}`.localeCompare(`${b.path}\0${b.originalPath ?? ''}`, 'en'));
}

function canonicalRemotePath(pathname: string): string {
  const withoutEdges = pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
  if (withoutEdges.length === 0 || withoutEdges.split('/').some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new RepositoryObservationError('Configured remote URL has an invalid repository path');
  }
  return withoutEdges;
}

export function normalizeRemoteIdentity(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048 || /[\0\r\n]/.test(value)) {
    throw new RepositoryObservationError('Configured remote identity is empty, over-bound, or malformed');
  }
  const trimmed = value.trim();
  if (trimmed.includes('://')) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new RepositoryObservationError('Configured remote URL is malformed');
    }
    if (!['http:', 'https:', 'ssh:', 'git:'].includes(parsed.protocol) || parsed.hostname.length === 0) {
      throw new RepositoryObservationError('Configured remote URL uses an unsupported identity form');
    }
    const host = parsed.hostname.toLowerCase();
    const path = canonicalRemotePath(parsed.pathname);
    return `${host}/${host === 'github.com' ? path.toLowerCase() : path}`;
  }
  const scp = /^(?:[^@\s]+@)?([^:/\s]+):(.+)$/.exec(trimmed);
  if (scp && !/^[A-Za-z]:[\\/]/.test(trimmed)) {
    const host = scp[1].toLowerCase();
    const path = canonicalRemotePath(scp[2]);
    return `${host}/${host === 'github.com' ? path.toLowerCase() : path}`;
  }
  const slash = trimmed.indexOf('/');
  if (slash <= 0) throw new RepositoryObservationError('Configured remote identity must include host and repository path');
  const host = trimmed.slice(0, slash).toLowerCase();
  const path = canonicalRemotePath(trimmed.slice(slash + 1));
  return `${host}/${host === 'github.com' ? path.toLowerCase() : path}`;
}

function sameCanonicalPath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function repositoryFingerprint(observation: RepositoryStateObservation): string {
  return canonicalJson({
    repositoryId: observation.repositoryId,
    worktreeId: observation.worktreeId,
    repositoryRoot: observation.repositoryRoot,
    worktreePath: observation.worktreePath,
    gitCommonDir: observation.gitCommonDir,
    branch: observation.branch,
    baseCommit: observation.baseCommit,
    headCommit: observation.headCommit,
    clean: observation.clean,
    remote: observation.remote,
    allowedScopes: observation.allowedScopes,
    changes: observation.changes,
    changedPaths: observation.changedPaths,
  });
}

export function assertRepositoryUnchanged(
  expectedValue: unknown,
  observedValue: unknown
): RepositoryStateObservation {
  const expected = parseBoundary(RepositoryStateObservationSchema, expectedValue, 'expected repository observation');
  const observed = parseBoundary(RepositoryStateObservationSchema, observedValue, 'repository re-observation');
  if (repositoryFingerprint(expected) !== repositoryFingerprint(observed)) {
    throw new RepositoryObservationError('Repository diverged between protected observations');
  }
  return observed;
}

export class RepositoryObserver {
  readonly executor: BoundedCommandExecutor;

  constructor(executor: BoundedCommandExecutor) {
    this.executor = executor;
  }

  async observe(requestValue: unknown): Promise<RepositoryObservationResult> {
    const request = parseBoundary(RepositoryObserverRequestSchema, requestValue, 'repository observer request');
    if (!isAbsolute(request.assignedWorktree)) throw new RepositoryObservationError('Assigned worktree must be absolute');
    const assignedWorktree = await realpath(resolve(request.assignedWorktree));
    if (!(await lstat(assignedWorktree)).isDirectory()) throw new RepositoryObservationError('Assigned worktree is not a directory');
    const commands: CommandEvidenceResult[] = [];
    let commandIndex = 0;
    const runGit = async (argv: string[]): Promise<ExecutedCommand> => {
      const executed = await this.executor.execute({
        evidenceId: `${request.observationId}:git:${String(++commandIndex).padStart(2, '0')}`,
        workflowId: request.workflowId,
        featureId: request.featureId,
        sessionId: request.sessionId,
        argv: ['git', ...argv],
        cwd: assignedWorktree,
        timeoutMs: request.timeoutMs,
        stdoutMediaType: 'application/octet-stream',
        stderrMediaType: 'application/octet-stream',
      });
      commands.push(executed.result);
      if (
        executed.result.observation.exitCode !== 0
        || executed.result.observation.timedOut
        || executed.result.observation.cancelled
      ) {
        throw new RepositoryObservationError(`Git command refused: ${canonicalJson(executed.result.observation.argv)}`, commands);
      }
      return executed;
    };

    try {
      if (singleLine((await runGit(['rev-parse', '--is-inside-work-tree'])).stdout, 'git worktree flag') !== 'true') {
        throw new RepositoryObservationError('Assigned path is not inside a Git worktree', commands);
      }
      const repositoryRoot = await realpath(singleLine(
        (await runGit(['rev-parse', '--path-format=absolute', '--show-toplevel'])).stdout,
        'repository root'
      ));
      if (!sameCanonicalPath(repositoryRoot, assignedWorktree)) {
        throw new RepositoryObservationError('Observed repository root differs from the assigned worktree', commands);
      }
      const gitCommonDir = await realpath(singleLine(
        (await runGit(['rev-parse', '--path-format=absolute', '--git-common-dir'])).stdout,
        'Git common directory'
      ));
      const superproject = decodeUtf8(
        (await runGit(['rev-parse', '--show-superproject-working-tree'])).stdout,
        'superproject worktree'
      ).replace(/\r?\n$/, '');
      if (superproject.length > 0) throw new RepositoryObservationError('Submodule worktrees are not accepted', commands);

      const branch = singleLine(
        (await runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'])).stdout,
        'Git branch'
      );
      if (branch !== request.expectedBranch) throw new RepositoryObservationError('Observed branch differs from the expected branch', commands);
      const headCommit = singleLine(
        (await runGit(['rev-parse', '--verify', 'HEAD^{commit}'])).stdout,
        'Git HEAD'
      ).toLowerCase();
      if (!GitCommitSchema.safeParse(headCommit).success) throw new RepositoryObservationError('Git HEAD is not a full commit identity', commands);
      if (request.expectedHead !== null && headCommit !== request.expectedHead) {
        throw new RepositoryObservationError('Observed HEAD differs from the expected HEAD', commands);
      }
      const baseCommit = singleLine(
        (await runGit(['rev-parse', '--verify', `${request.baseCommit}^{commit}`])).stdout,
        'Git base commit'
      ).toLowerCase();
      if (baseCommit !== request.baseCommit) throw new RepositoryObservationError('Observed base commit differs from the configured base', commands);
      await runGit(['merge-base', '--is-ancestor', baseCommit, headCommit]);

      const remoteValues = splitNul(
        (await runGit(['config', '--null', '--get-all', `remote.${request.remoteName}.url`])).stdout,
        'configured Git remote URLs'
      );
      if (remoteValues.length !== 1 || remoteValues[0].length === 0) {
        throw new RepositoryObservationError('Configured Git remote is missing or ambiguous', commands);
      }
      const remoteIdentity = normalizeRemoteIdentity(remoteValues[0]);
      if (remoteIdentity !== normalizeRemoteIdentity(request.expectedRemoteIdentity)) {
        throw new RepositoryObservationError('Observed remote identity differs from the expected remote', commands);
      }

      const changes = parseGitStatusPorcelainV2Z((await runGit([
        'status',
        '--porcelain=v2',
        '-z',
        '--untracked-files=all',
        '--ignore-submodules=none',
      ])).stdout);
      const changedPaths = [...new Set(changes.flatMap(change => (
        change.originalPath === null ? [change.path] : [change.path, change.originalPath]
      )))].sort();
      const scope = assertPathScope(changedPaths, request.allowedScopes);
      const repositoryId = `repository:${sha256Canonical({ gitCommonDir, remoteIdentity })}`;
      const worktreeId = `worktree:${sha256Canonical({ worktreePath: assignedWorktree })}`;
      const observation = parseBoundary(RepositoryStateObservationSchema, {
        id: request.observationId,
        schemaVersion: DOMAIN_SCHEMA_VERSION,
        createdAt: commands[0]?.observation.createdAt,
        origin: 'controller_observed',
        repositoryId,
        worktreeId,
        repositoryRoot,
        worktreePath: assignedWorktree,
        gitCommonDir,
        branch,
        baseCommit,
        headCommit,
        clean: changes.length === 0,
        remote: { name: request.remoteName, url: remoteValues[0], identity: remoteIdentity },
        allowedScopes: scope.allowedScopes,
        changes,
        changedPaths: scope.changedPaths,
        commandEvidenceIds: commands.map(command => command.evidence.id),
      }, 'repository state observation');
      return { observation, commands };
    } catch (error) {
      if (error instanceof RepositoryObservationError) {
        if (error.commandEvidence.length > 0) throw error;
        throw new RepositoryObservationError(error.message, commands);
      }
      throw new RepositoryObservationError(
        `Repository observation failed: ${error instanceof Error ? error.message : String(error)}`,
        commands
      );
    }
  }

  async reobserveAndAssert(
    expectedValue: unknown,
    requestValue: unknown
  ): Promise<RepositoryObservationResult> {
    const result = await this.observe(requestValue);
    assertRepositoryUnchanged(expectedValue, result.observation);
    return result;
  }
}
