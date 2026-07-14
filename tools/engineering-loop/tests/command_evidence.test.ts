import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BoundedCommandExecutor,
  CommandEvidenceError,
  ProtectedArtifactStore,
  recordCommandEvidence,
} from '../src/command_evidence';
import { FakeClock, FakeCrashInjector } from '../src/fakes';
import { makeDefaultFacts, prepareTransition } from '../src/state_machine';
import { StateStore } from '../src/state_store';
import { FEATURE, NOW, SESSION, WORKFLOW, makeDecision } from './fixtures';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'trellis-el03-command-'));
  roots.push(base);
  const worktree = join(base, 'worktree');
  const protectedRoot = join(base, 'protected');
  await mkdir(worktree);
  const clock = new FakeClock(NOW);
  const artifacts = await ProtectedArtifactStore.open({ protectedRoot, worktree });
  const executor = new BoundedCommandExecutor({ clock, artifacts });
  return { base, worktree, protectedRoot, clock, artifacts, executor };
}

function request(worktree: string, evidenceId: string, argv: string[], timeoutMs = 5_000) {
  return {
    evidenceId,
    workflowId: WORKFLOW.id,
    featureId: FEATURE.featureId,
    sessionId: SESSION.id,
    argv,
    cwd: worktree,
    timeoutMs,
    stdoutMediaType: 'text/plain',
    stderrMediaType: 'text/plain',
  };
}

describe('EL-03 bounded command evidence and protected artifacts', () => {
  it('records exact shell-free argv, cwd, times, status, previews, byte counts, digests, and protected references', async () => {
    const { worktree, artifacts, executor } = await fixture();
    const literal = 'value; echo must-not-run';
    const executed = await executor.execute(request(worktree, 'evidence:command:exact', [
      process.execPath,
      '-e',
      'process.stdout.write(process.argv[1]); process.stderr.write("err")',
      literal,
    ]));
    const { observation, evidence, recordReference } = executed.result;
    expect(executed.stdout.toString()).toBe(literal);
    expect(executed.stderr.toString()).toBe('err');
    expect(observation.argv.at(-1)).toBe(literal);
    expect(observation.exitCode).toBe(0);
    expect(observation.signal).toBeNull();
    expect(observation.timedOut).toBe(false);
    expect(observation.cancelled).toBe(false);
    expect(observation.stdout.byteCount).toBe(Buffer.byteLength(literal));
    expect(observation.stdout.previewBase64).toBe(Buffer.from(literal).toString('base64'));
    expect(observation.stdout.retained?.journalReference).toBe(evidence.id);
    expect(await artifacts.read(observation.stdout.retained)).toEqual(Buffer.from(literal));
    expect(evidence.immutableReference).toBe(`artifact:sha256:${recordReference.digest}`);
    expect(await artifacts.read(recordReference)).toEqual(Buffer.from(JSON.stringify(
      JSON.parse((await artifacts.read(recordReference)).toString())
    )));
  });

  it('records a nonzero controller-observed command instead of trusting output text', async () => {
    const { worktree, executor } = await fixture();
    const executed = await executor.execute(request(worktree, 'evidence:command:nonzero', [
      process.execPath,
      '-e',
      'process.stdout.write("all tests passed"); process.exit(7)',
    ]));
    expect(executed.result.observation.exitCode).toBe(7);
    expect(executed.stdout.toString()).toBe('all tests passed');
  });

  it('records timeout and cancellation state with a process signal', async () => {
    const first = await fixture();
    const timedOut = await first.executor.execute(request(first.worktree, 'evidence:command:timeout', [
      process.execPath,
      '-e',
      'setInterval(() => {}, 1000)',
    ], 30));
    expect(timedOut.result.observation.timedOut).toBe(true);
    expect(timedOut.result.observation.signal).not.toBeNull();

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    const cancelled = await first.executor.execute(request(first.worktree, 'evidence:command:cancelled', [
      process.execPath,
      '-e',
      'setInterval(() => {}, 1000)',
    ], 2_000), controller.signal);
    expect(cancelled.result.observation.cancelled).toBe(true);
    expect(cancelled.result.observation.timedOut).toBe(false);
    expect(cancelled.result.observation.signal).not.toBeNull();
  });

  it('refuses argv, cwd, and output beyond explicit bounds', async () => {
    const { worktree, artifacts } = await fixture();
    const executor = new BoundedCommandExecutor({ clock: new FakeClock(NOW), artifacts, maxOutputBytes: 64 });
    await expect(executor.execute(request(worktree, 'evidence:command:output-bound', [
      process.execPath,
      '-e',
      'process.stdout.write("x".repeat(256))',
    ]))).rejects.toThrow(/output exceeds the 64-byte/);
    await expect(executor.execute(request(worktree, 'evidence:command:argv-bound', [
      process.execPath,
      'x'.repeat(2_049),
    ]))).rejects.toThrow();
    await expect(executor.execute({
      ...request(worktree, 'evidence:command:cwd-bound', [process.execPath, '-e', '']),
      cwd: 'relative',
    })).rejects.toThrow(/cwd must be absolute/);
  });

  it('deduplicates identical retained bytes by digest while preserving each journal linkage', async () => {
    const { artifacts } = await fixture();
    const bytes = Buffer.from('deduplicate me');
    const first = await artifacts.put(bytes, 'text/plain', 'evidence:one');
    const second = await artifacts.put(bytes, 'text/plain', 'evidence:two');
    expect(first.digest).toBe(second.digest);
    expect(first.relativePath).toBe(second.relativePath);
    expect(first.journalReference).not.toBe(second.journalReference);
    const directory = dirname(join(artifacts.root, ...first.relativePath.split('/')));
    expect((await readdir(directory)).filter(name => !name.includes('.tmp-'))).toEqual([first.digest]);
  });

  it('refuses corrupted, truncated, and aliased artifact references', async () => {
    const { artifacts } = await fixture();
    const reference = await artifacts.put(Buffer.from('complete bytes'), 'text/plain', 'evidence:artifact');
    const absolute = join(artifacts.root, ...reference.relativePath.split('/'));
    await writeFile(absolute, 'partial');
    await expect(artifacts.read(reference)).rejects.toThrow(/byte count disagrees/);
    await expect(artifacts.read({
      ...reference,
      relativePath: `artifacts/sha256/ff/${'f'.repeat(64)}`,
    })).rejects.toThrow(/aliases its digest path/);
  });

  it('refuses artifact storage inside the worktree before creating bytes', async () => {
    const base = await mkdtemp(join(tmpdir(), 'trellis-el03-placement-'));
    roots.push(base);
    const worktree = join(base, 'worktree');
    await mkdir(worktree);
    await expect(ProtectedArtifactStore.open({
      protectedRoot: join(worktree, '.controller-state'),
      worktree,
    })).rejects.toThrow(/must not be inside/);
    expect(await readdir(worktree)).toEqual([]);
  });

  it('journal-links controller evidence and reconstructs it without copying command output into the snapshot', async () => {
    const { worktree, protectedRoot, clock, executor } = await fixture();
    const store = await StateStore.open({
      stateRoot: protectedRoot,
      worktree,
      workflowId: WORKFLOW.id,
      ownerId: 'controller:command-evidence',
      ownerToken: 'owner-token-command-evidence',
      clock,
      crashInjector: new FakeCrashInjector(null),
    });
    const initial = prepareTransition(null, makeDecision({ from: null, to: 'selected' }), {
      workflow: WORKFLOW,
      feature: FEATURE,
      session: SESSION,
      acceptedFeatureIds: ['EL-01'],
      evidence: [],
      approvals: [],
      now: NOW,
      facts: makeDefaultFacts(),
    });
    await store.commit(initial, 'controller');
    const executed = await executor.execute(request(worktree, 'evidence:command:journal', [
      process.execPath,
      '-e',
      'process.stdout.write("journal-linked")',
    ]));
    await recordCommandEvidence(store, executor.artifacts, executed.result);
    expect(store.snapshot?.evidenceIds).toEqual(['evidence:command:journal']);
    expect(JSON.stringify(store.snapshot)).not.toContain('journal-linked');
    await store.close();

    const replayed = await StateStore.open({
      stateRoot: protectedRoot,
      worktree,
      workflowId: WORKFLOW.id,
      ownerId: 'controller:command-replay',
      ownerToken: 'owner-token-command-replay',
      clock,
    });
    expect(replayed.snapshot?.evidenceIds).toEqual(['evidence:command:journal']);
    expect(replayed.snapshot?.lastEventSequence).toBe(2);
    await replayed.close();
  });

  it('refuses forged command linkage before appending another event', async () => {
    const { worktree, protectedRoot, clock, executor } = await fixture();
    const store = await StateStore.open({
      stateRoot: protectedRoot,
      worktree,
      workflowId: WORKFLOW.id,
      ownerId: 'controller:forged-command',
      ownerToken: 'owner-token-forged-command',
      clock,
    });
    const initial = prepareTransition(null, makeDecision({ from: null, to: 'selected' }), {
      workflow: WORKFLOW, feature: FEATURE, session: SESSION,
      acceptedFeatureIds: ['EL-01'], evidence: [], approvals: [], now: NOW,
      facts: makeDefaultFacts(),
    });
    await store.commit(initial, 'controller');
    const executed = await executor.execute(request(worktree, 'evidence:command:forged', [process.execPath, '-e', '']));
    await expect(recordCommandEvidence(store, executor.artifacts, {
      ...executed.result,
      evidence: { ...executed.result.evidence, digest: 'f'.repeat(64) },
    })).rejects.toThrow(CommandEvidenceError);
    expect(store.snapshot?.lastEventSequence).toBe(1);
    await store.close();
  });

  it('revalidates retained bytes at the journal boundary and refuses a partial record artifact', async () => {
    const { worktree, protectedRoot, clock, executor } = await fixture();
    const store = await StateStore.open({
      stateRoot: protectedRoot,
      worktree,
      workflowId: WORKFLOW.id,
      ownerId: 'controller:partial-command',
      ownerToken: 'owner-token-partial-command',
      clock,
    });
    const initial = prepareTransition(null, makeDecision({ from: null, to: 'selected' }), {
      workflow: WORKFLOW, feature: FEATURE, session: SESSION,
      acceptedFeatureIds: ['EL-01'], evidence: [], approvals: [], now: NOW,
      facts: makeDefaultFacts(),
    });
    await store.commit(initial, 'controller');
    const executed = await executor.execute(request(
      worktree,
      'evidence:command:partial',
      [process.execPath, '-e', '']
    ));
    const recordPath = join(executor.artifacts.root, ...executed.result.recordReference.relativePath.split('/'));
    await writeFile(recordPath, 'partial');
    await expect(recordCommandEvidence(store, executor.artifacts, executed.result)).rejects.toThrow(/byte count disagrees/);
    expect(store.snapshot?.lastEventSequence).toBe(1);
    await store.close();
  });
});
