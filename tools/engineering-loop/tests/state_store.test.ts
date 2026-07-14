import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, sha256Canonical } from '../src/events';
import { FakeClock, FakeCrashInjector } from '../src/fakes';
import { makeDefaultFacts, prepareTransition } from '../src/state_machine';
import {
  StateRecoveryError,
  StateRootError,
  StateStore,
  type CrashPoint,
} from '../src/state_store';
import { WriterLockError } from '../src/writer_lock';
import type { StateSnapshot, WorkflowState } from '../src/domain';
import {
  FEATURE,
  NOW,
  SESSION,
  WORKFLOW,
  makeDecision,
} from './fixtures';

const roots: string[] = [];

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'trellis-el02-'));
  roots.push(base);
  const worktree = join(base, 'agent-worktree');
  const stateRoot = join(base, 'protected-state');
  await mkdir(worktree, { mode: 0o700 });
  return { base, worktree, stateRoot };
}

async function openStore(
  stateRoot: string,
  worktree: string,
  crashInjector = new FakeCrashInjector(null),
  ownerToken = 'owner-token-00000001'
) {
  return StateStore.open({
    stateRoot,
    worktree,
    workflowId: WORKFLOW.id,
    ownerId: 'controller:fixture',
    ownerToken,
    clock: new FakeClock(NOW),
    crashInjector,
  });
}

function transitionPayload(current: StateSnapshot | null, to: WorkflowState) {
  const from = current?.state ?? null;
  return prepareTransition(current, makeDecision({ from, to }), {
    workflow: WORKFLOW,
    feature: FEATURE,
    session: SESSION,
    acceptedFeatureIds: ['EL-01'],
    evidence: [],
    approvals: [],
    now: NOW,
    facts: makeDefaultFacts(),
  });
}

async function initializedStore(stateRoot: string, worktree: string) {
  const store = await openStore(stateRoot, worktree);
  await store.commit(transitionPayload(null, 'selected'), 'controller');
  return store;
}

async function validTwoEventFixture() {
  const paths = await fixture();
  const store = await initializedStore(paths.stateRoot, paths.worktree);
  await store.commit(transitionPayload(store.snapshot, 'preparing'), 'controller');
  await store.close();
  return paths;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('EL-02 protected state store', () => {
  it('refuses lexical, canonical, and symlink-alias roots inside the worktree before state creation', async () => {
    const { base, worktree, stateRoot } = await fixture();
    const inside = join(worktree, '.state');
    await expect(openStore(inside, worktree)).rejects.toThrow(StateRootError);
    await expect(openStore('x'.repeat(513), worktree)).rejects.toThrow(/no longer than 512/);
    expect(await readdir(worktree)).toEqual([]);

    const alias = join(base, 'alias-to-worktree');
    await symlink(worktree, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(openStore(alias, worktree, new FakeCrashInjector(null), 'owner-token-00000002'))
      .rejects.toThrow(StateRootError);

    await mkdir(stateRoot);
    const stateAlias = join(worktree, 'alias-to-state');
    await symlink(stateRoot, stateAlias, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(openStore(stateRoot, worktree, new FakeCrashInjector(null), 'owner-token-00000006'))
      .rejects.toThrow(/writable through a symbolic-link alias/);
  });

  it('requires restrictive POSIX permissions on an existing protected root', async () => {
    const { stateRoot, worktree } = await fixture();
    await mkdir(stateRoot, { mode: 0o755 });
    if (process.platform === 'win32') {
      const store = await openStore(stateRoot, worktree);
      await store.close();
    } else {
      await chmod(stateRoot, 0o755);
      await expect(openStore(stateRoot, worktree)).rejects.toThrow('deny group and other permissions');
    }
  });

  it('refuses a second writer without mutating journal or snapshot and never steals stale locks', async () => {
    const { stateRoot, worktree } = await fixture();
    const first = await initializedStore(stateRoot, worktree);
    const journalBefore = await readFile(first.journalPath, 'utf8');
    const snapshotBefore = await readFile(first.snapshotPath, 'utf8');

    await expect(openStore(stateRoot, worktree, new FakeCrashInjector(null), 'owner-token-00000003'))
      .rejects.toThrow(WriterLockError);
    expect(await readFile(first.journalPath, 'utf8')).toBe(journalBefore);
    expect(await readFile(first.snapshotPath, 'utf8')).toBe(snapshotBefore);

    await first.close();
    const next = await openStore(stateRoot, worktree, new FakeCrashInjector(null), 'owner-token-00000004');
    expect(next.snapshot?.state).toBe('selected');
    await next.close();
  });

  it('refuses concurrent mutation through one locked writer instance', async () => {
    const { stateRoot, worktree } = await fixture();
    const store = await initializedStore(stateRoot, worktree);
    const payload = transitionPayload(store.snapshot, 'preparing');
    const first = store.commit(payload, 'controller');
    await expect(store.commit(payload, 'controller')).rejects.toThrow(/Concurrent mutation/);
    await first;
    expect(store.snapshot?.state).toBe('preparing');
    const lines = (await readFile(store.journalPath, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    await store.close();
  });

  it('loads a valid older snapshot and deterministically replays every later event', async () => {
    const { stateRoot, worktree } = await fixture();
    const store = await initializedStore(stateRoot, worktree);
    const older = store.snapshot as StateSnapshot;
    await store.commit(transitionPayload(store.snapshot, 'preparing'), 'controller');
    await store.close();

    await writeFile(join(stateRoot, 'snapshot.json'), `${canonicalJson(older)}\n`, 'utf8');
    const restarted = await openStore(stateRoot, worktree, new FakeCrashInjector(null), 'owner-token-00000005');
    expect(restarted.snapshot?.state).toBe('preparing');
    expect(restarted.snapshot?.lastEventSequence).toBe(2);
    await restarted.close();
  });

  it.each([
    'before_journal_append',
    'after_journal_durable',
    'before_snapshot_temp_write',
    'after_snapshot_temp_durable',
    'before_snapshot_replace',
    'after_snapshot_replace',
  ] satisfies CrashPoint[])('recovers deterministically from %s with one transition event', async crashPoint => {
    const { stateRoot, worktree } = await fixture();
    const setup = await initializedStore(stateRoot, worktree);
    await setup.close();

    const crashing = await openStore(
      stateRoot,
      worktree,
      new FakeCrashInjector(crashPoint),
      `owner-token-crash-${crashPoint}`
    );
    await expect(crashing.commit(transitionPayload(crashing.snapshot, 'preparing'), 'controller'))
      .rejects.toThrow(`Injected crash at ${crashPoint}`);
    await crashing.close();

    const restarted = await openStore(
      stateRoot,
      worktree,
      new FakeCrashInjector(null),
      `owner-token-restart-${crashPoint}`
    );
    if (restarted.snapshot?.state === 'selected') {
      await restarted.commit(transitionPayload(restarted.snapshot, 'preparing'), 'controller');
    }
    expect(restarted.snapshot?.state).toBe('preparing');
    const lines = (await readFile(restarted.journalPath, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines.map(line => JSON.parse(line).sequence)).toEqual([1, 2]);
    await restarted.close();
  });

  it('refuses missing sequences, digest mismatch, invalid schemas, impossible transitions, malformed or over-bound JSONL, and snapshot disagreement without repair', async () => {
    const mutations: Array<(stateRoot: string) => Promise<void>> = [
      async stateRoot => {
        const path = join(stateRoot, 'events.jsonl');
        const events = (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
        events[1].sequence = 3;
        await writeFile(path, `${events.map(canonicalJson).join('\n')}\n`, 'utf8');
      },
      async stateRoot => {
        const path = join(stateRoot, 'events.jsonl');
        const events = (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
        events[1].digest = 'f'.repeat(64);
        await writeFile(path, `${events.map(canonicalJson).join('\n')}\n`, 'utf8');
      },
      async stateRoot => {
        const path = join(stateRoot, 'events.jsonl');
        const events = (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
        events[1].schemaVersion = 2;
        await writeFile(path, `${events.map(canonicalJson).join('\n')}\n`, 'utf8');
      },
      async stateRoot => {
        const path = join(stateRoot, 'events.jsonl');
        const events = (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
        events[1].payload.decision.toState = 'accepted';
        events[1].payload.decision.actorAuthority = 'controller';
        events[1].actor = 'controller';
        const { digest: _digest, ...material } = events[1];
        events[1].digest = sha256Canonical(material);
        await writeFile(path, `${events.map(canonicalJson).join('\n')}\n`, 'utf8');
      },
      async stateRoot => {
        await writeFile(join(stateRoot, 'events.jsonl'), '{not-json}\n', 'utf8');
      },
      async stateRoot => {
        const path = join(stateRoot, 'events.jsonl');
        const journal = await readFile(path, 'utf8');
        await writeFile(path, journal.slice(0, -1), 'utf8');
      },
      async stateRoot => {
        await writeFile(join(stateRoot, 'events.jsonl'), `${'x'.repeat(1_048_577)}\n`, 'utf8');
      },
      async stateRoot => {
        const path = join(stateRoot, 'snapshot.json');
        const snapshot = JSON.parse(await readFile(path, 'utf8'));
        snapshot.state = 'running';
        await writeFile(path, `${canonicalJson(snapshot)}\n`, 'utf8');
      },
    ];

    let refused = 0;
    for (const mutate of mutations) {
      const { stateRoot, worktree } = await validTwoEventFixture();
      await mutate(stateRoot);
      const journalPath = join(stateRoot, 'events.jsonl');
      const before = await readFile(journalPath, 'utf8');
      await expect(openStore(
        stateRoot,
        worktree,
        new FakeCrashInjector(null),
        `owner-token-corrupt-${refused}`
      )).rejects.toThrow(StateRecoveryError);
      expect(await readFile(journalPath, 'utf8')).toBe(before);
      refused++;
    }
    expect(refused).toBe(8);
  });
});
