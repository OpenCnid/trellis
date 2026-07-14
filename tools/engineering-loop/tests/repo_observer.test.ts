import { execFile } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BoundedCommandExecutor, ProtectedArtifactStore } from '../src/command_evidence';
import { FakeClock } from '../src/fakes';
import {
  RepositoryObservationError,
  RepositoryObserver,
  normalizeRemoteIdentity,
  parseGitStatusPorcelainV2Z,
} from '../src/repo_observer';
import { FEATURE, NOW, SESSION, WORKFLOW } from './fixtures';

const roots: string[] = [];
const BRANCH = 'implement-el03-repository-observer';

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

function git(repo: string, ...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', [
      '-C', repo,
      '-c', 'user.email=fixture@example.invalid',
      '-c', 'user.name=EL03 Fixture',
      '-c', 'core.autocrlf=false',
      ...args,
    ], { encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) => {
      if (error) return reject(new Error(`git ${args.join(' ')} failed: ${stderr || error.message}`));
      resolve(stdout);
    });
  });
}

async function repositoryFixture() {
  const base = await mkdtemp(join(tmpdir(), 'trellis-el03-repository-'));
  roots.push(base);
  const repo = join(base, 'repo');
  const protectedRoot = join(base, 'protected');
  await mkdir(join(repo, 'scope'), { recursive: true });
  const files: Record<string, string> = {
    'staged.txt': 'staged baseline\n',
    'both.txt': 'both baseline\n',
    'unstaged.txt': 'unstaged baseline\n',
    'delete.txt': 'delete baseline\n',
    'rename-old.txt': 'rename baseline\n',
    'space name.txt': 'space baseline\n',
    'ユニコード.txt': 'unicode baseline\n',
    '-leading.txt': 'leading baseline\n',
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(repo, 'scope', name), content);
  await git(repo, 'init', '-b', BRANCH);
  await git(repo, 'remote', 'add', 'origin', 'https://github.com/OpenCnid/trellis.git');
  await git(repo, 'add', '-A');
  await git(repo, 'commit', '-m', 'fixture baseline');
  const head = (await git(repo, 'rev-parse', 'HEAD')).trim();
  const artifacts = await ProtectedArtifactStore.open({ protectedRoot, worktree: repo });
  const executor = new BoundedCommandExecutor({ clock: new FakeClock(NOW), artifacts });
  const observer = new RepositoryObserver(executor);
  return { base, repo, protectedRoot, head, observer };
}

function request(repo: string, head: string, observationId = 'repository-observation:fixture') {
  return {
    observationId,
    workflowId: WORKFLOW.id,
    featureId: FEATURE.featureId,
    sessionId: SESSION.id,
    assignedWorktree: repo,
    expectedBranch: BRANCH,
    baseCommit: head,
    expectedHead: head,
    remoteName: 'origin',
    expectedRemoteIdentity: 'github.com/opencnid/trellis',
    allowedScopes: ['scope'],
    timeoutMs: 10_000,
  };
}

async function makeDirtyFixture(repo: string): Promise<void> {
  await writeFile(join(repo, 'scope', 'staged.txt'), 'staged changed\n');
  await git(repo, 'add', '--', 'scope/staged.txt');
  await writeFile(join(repo, 'scope', 'both.txt'), 'both staged\n');
  await git(repo, 'add', '--', 'scope/both.txt');
  await appendFile(join(repo, 'scope', 'both.txt'), 'both unstaged\n');
  await appendFile(join(repo, 'scope', 'unstaged.txt'), 'unstaged changed\n');
  await git(repo, 'rm', '--', 'scope/delete.txt');
  await git(repo, 'mv', '--', 'scope/rename-old.txt', 'scope/renamed new.txt');
  await appendFile(join(repo, 'scope', 'space name.txt'), 'space changed\n');
  await appendFile(join(repo, 'scope', '-leading.txt'), 'leading changed\n');
  await appendFile(join(repo, 'scope', 'ユニコード.txt'), 'unicode changed\n');
  await git(repo, 'add', '--', 'scope/ユニコード.txt');
  await writeFile(join(repo, 'scope', 'untracked file.txt'), 'untracked\n');
}

describe('EL-03 deterministic repository observer', () => {
  it('computes canonical repository identity, branch, base, HEAD, clean state, remote, and exact local command evidence', async () => {
    const { repo, head, observer } = await repositoryFixture();
    const result = await observer.observe(request(repo, head));
    expect(result.observation.repositoryRoot).toBe(result.observation.worktreePath);
    expect(result.observation.repositoryId).toMatch(/^repository:[0-9a-f]{64}$/);
    expect(result.observation.worktreeId).toMatch(/^worktree:[0-9a-f]{64}$/);
    expect(result.observation.branch).toBe(BRANCH);
    expect(result.observation.baseCommit).toBe(head);
    expect(result.observation.headCommit).toBe(head);
    expect(result.observation.clean).toBe(true);
    expect(result.observation.remote).toEqual({
      name: 'origin',
      url: 'https://github.com/OpenCnid/trellis.git',
      identity: 'github.com/opencnid/trellis',
    });
    expect(result.observation.changedPaths).toEqual([]);
    expect(result.commands).toHaveLength(10);
    expect(result.commands.every(item => item.observation.origin === 'controller_observed')).toBe(true);
    expect(result.commands.every(item => !item.observation.argv.includes('fetch'))).toBe(true);
  });

  it('losslessly observes staged, unstaged, both, untracked, deleted, renamed, spaced, Unicode, and leading-dash paths', async () => {
    const { repo, head, observer } = await repositoryFixture();
    await makeDirtyFixture(repo);
    const { observation } = await observer.observe(request(repo, head));
    expect(observation.clean).toBe(false);
    expect(observation.changedPaths).toEqual([
      'scope/-leading.txt',
      'scope/both.txt',
      'scope/delete.txt',
      'scope/rename-old.txt',
      'scope/renamed new.txt',
      'scope/space name.txt',
      'scope/staged.txt',
      'scope/unstaged.txt',
      'scope/untracked file.txt',
      'scope/ユニコード.txt',
    ]);
    expect(observation.changes.find(item => item.path === 'scope/both.txt')).toMatchObject({ staged: true, unstaged: true });
    expect(observation.changes.find(item => item.path === 'scope/delete.txt')).toMatchObject({ deleted: true, staged: true });
    expect(observation.changes.find(item => item.path === 'scope/renamed new.txt')).toMatchObject({
      originalPath: 'scope/rename-old.txt',
      renamed: true,
    });
    expect(observation.changes.find(item => item.path === 'scope/untracked file.txt')).toMatchObject({ untracked: true });
  });

  it('refuses out-of-scope changes by segment rather than widening a prefix', async () => {
    const { repo, head, observer } = await repositoryFixture();
    await writeFile(join(repo, 'scope-sibling.txt'), 'outside\n');
    await expect(observer.observe(request(repo, head))).rejects.toThrow(
      'Changed paths are outside the fixed scope: scope-sibling.txt'
    );
  });

  it.each([
    ['branch', (value: ReturnType<typeof request>) => ({ ...value, expectedBranch: 'unexpected-branch' }), /branch differs/],
    ['HEAD', (value: ReturnType<typeof request>) => ({ ...value, expectedHead: '0'.repeat(40) }), /HEAD differs/],
    ['base', (value: ReturnType<typeof request>) => ({ ...value, baseCommit: '0'.repeat(40) }), /Git command refused/],
    ['remote', (value: ReturnType<typeof request>) => ({ ...value, expectedRemoteIdentity: 'github.com/other/repo' }), /remote identity differs/],
  ] as const)('refuses unexpected %s before accepting repository evidence', async (_label, mutate, pattern) => {
    const { repo, head, observer } = await repositoryFixture();
    await expect(observer.observe(mutate(request(repo, head)))).rejects.toThrow(pattern);
  });

  it('refuses a configured remote name with multiple URL values as ambiguous', async () => {
    const { repo, head, observer } = await repositoryFixture();
    await git(repo, 'config', '--add', 'remote.origin.url', 'git@github.com:OpenCnid/trellis.git');
    await expect(observer.observe(request(repo, head))).rejects.toThrow(/remote is missing or ambiguous/);
  });

  it('refuses an assigned nested directory whose observed worktree root differs', async () => {
    const { repo, head, observer } = await repositoryFixture();
    await expect(observer.observe({
      ...request(repo, head),
      assignedWorktree: join(repo, 'scope'),
    })).rejects.toThrow(/root differs from the assigned worktree/);
  });

  it('refuses detached HEAD through the exact observed command status', async () => {
    const { repo, head, observer } = await repositoryFixture();
    await git(repo, 'checkout', '--detach', head);
    await expect(observer.observe(request(repo, head))).rejects.toThrow(/Git command refused/);
  });

  it('re-observes and refuses between-check divergence instead of updating the expected value', async () => {
    const { repo, head, observer } = await repositoryFixture();
    await makeDirtyFixture(repo);
    const first = await observer.observe(request(repo, head, 'repository-observation:first'));
    await writeFile(join(repo, 'scope', 'late.txt'), 'late divergence\n');
    await expect(observer.reobserveAndAssert(
      first.observation,
      request(repo, head, 'repository-observation:second')
    )).rejects.toThrow(/diverged between protected observations/);
  });

  it.each([
    Buffer.from('? missing-final-nul'),
    Buffer.from('! ignored.txt\0'),
    Buffer.from('1 M. N... 100644 100644 100644 bad aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa malformed.txt\0'),
    Buffer.from('2 R. N... 100644 100644 100644 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa R100 renamed.txt\0'),
    Buffer.from([0x3f, 0x20, 0xff, 0x00]),
  ])('refuses malformed or lossy NUL-delimited status output %#', bytes => {
    expect(() => parseGitStatusPorcelainV2Z(bytes)).toThrow(RepositoryObservationError);
  });

  it('normalizes equivalent HTTPS and SCP GitHub remote identities without network access', () => {
    expect(normalizeRemoteIdentity('https://github.com/OpenCnid/trellis.git')).toBe('github.com/opencnid/trellis');
    expect(normalizeRemoteIdentity('git@github.com:OpenCnid/trellis.git')).toBe('github.com/opencnid/trellis');
  });
});
