import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DOMAIN_SCHEMA_VERSION,
  type EffectIntent,
  type StateSnapshot,
} from '../src/domain';
import {
  FakeClock,
  FakeCrashInjector,
  FakeEffectTarget,
  FakeRepository,
  FakeRunner,
} from '../src/fakes';
import { ControlKernel } from '../src/kernel';
import { InjectedCrashError, StateStore, type CrashPoint } from '../src/state_store';
import { FEATURE, NOW, REPOSITORY, SESSION, WORKFLOW, makeApproval } from './fixtures';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

function intent(overrides: Partial<EffectIntent> = {}): EffectIntent {
  return {
    id: 'intent:fixture',
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    createdAt: NOW,
    workflowId: WORKFLOW.id,
    featureId: FEATURE.featureId,
    sessionId: SESSION.id,
    operationId: 'operation:fixture',
    idempotencyKey: 'idempotency:fixture',
    target: 'target:fixture',
    exactScope: FEATURE.scope,
    approvalId: 'approval:effect:target:fixture',
    preconditions: ['repository matches selected session'],
    ...overrides,
  };
}

function logicalSnapshot(snapshot: StateSnapshot | null): Omit<StateSnapshot, 'lastEventSequence' | 'lastEventDigest'> | null {
  if (snapshot === null) return null;
  const { lastEventSequence: _sequence, lastEventDigest: _digest, ...logical } = snapshot;
  return logical;
}

async function rootFixture(): Promise<{ stateRoot: string; worktree: string }> {
  const parent = await mkdtemp(join(tmpdir(), 'trellis-el02-kernel-'));
  roots.push(parent);
  const worktree = join(parent, 'worktree');
  const stateRoot = join(parent, 'protected-state');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(worktree);
  return { stateRoot, worktree };
}

async function openKernel(input: {
  stateRoot: string;
  worktree: string;
  owner: string;
  crash?: CrashPoint | null;
  clock: FakeClock;
  repository: FakeRepository;
  runner: FakeRunner;
  effects: FakeEffectTarget;
}): Promise<ControlKernel> {
  const store = await StateStore.open({
    stateRoot: input.stateRoot,
    worktree: input.worktree,
    workflowId: WORKFLOW.id,
    ownerId: input.owner,
    ownerToken: `owner-token:${input.owner}`,
    clock: input.clock,
    crashInjector: new FakeCrashInjector(input.crash ?? null),
  });
  return new ControlKernel({
    store,
    clock: input.clock,
    repository: input.repository,
    runner: input.runner,
    effects: input.effects,
    workflow: WORKFLOW,
    feature: FEATURE,
    session: SESSION,
    acceptedFeatureIds: ['EL-01'],
  });
}

async function initializeFixture(input: Awaited<ReturnType<typeof rootFixture>>, effects: FakeEffectTarget) {
  const clock = new FakeClock(NOW);
  const repository = new FakeRepository(REPOSITORY);
  const runner = new FakeRunner(clock);
  const kernel = await openKernel({ ...input, owner: 'initializer', clock, repository, runner, effects });
  await kernel.initialize();
  await kernel.close();
  return { clock, repository, runner };
}

const EFFECT_CRASH_POINTS: readonly CrashPoint[] = [
  'before_approval_consumption',
  'after_approval_consumption',
  'before_intent_record',
  'after_intent_record',
  'before_effect_invocation',
  'after_effect_invocation',
  'before_outcome_record',
  'after_outcome_record',
];

describe('EL-02 deterministic control kernel', () => {
  it.each(EFFECT_CRASH_POINTS)('recovers deterministically at %s without a duplicate completed effect', async crashPoint => {
    const paths = await rootFixture();
    const effects = new FakeEffectTarget();
    const { clock, repository, runner } = await initializeFixture(paths, effects);
    const crashing = await openKernel({
      ...paths,
      owner: `crash-${crashPoint}`,
      crash: crashPoint,
      clock,
      repository,
      runner,
      effects,
    });
    const approval = makeApproval('effect:target:fixture');
    await expect(crashing.executeEffect(intent(), [approval])).rejects.toBeInstanceOf(InjectedCrashError);
    await crashing.close();

    const restarted = await openKernel({
      ...paths,
      owner: `restart-${crashPoint}`,
      clock,
      repository,
      runner,
      effects,
    });
    const outcome = await restarted.executeEffect(intent(), [approval]);
    expect(outcome.status).toBe('succeeded');
    expect(restarted.snapshot?.state).toBe('selected');
    expect(restarted.snapshot?.intents).toHaveLength(1);
    expect(restarted.snapshot?.outcomes).toHaveLength(1);
    expect(restarted.snapshot?.consumedApprovalIds).toEqual([approval.id]);
    expect(effects.invocations).toBe(1);
    expect(effects.requests).toBeGreaterThanOrEqual(1);

    const oraclePaths = await rootFixture();
    const oracleEffects = new FakeEffectTarget();
    const oracleDependencies = await initializeFixture(oraclePaths, oracleEffects);
    const oracle = await openKernel({
      ...oraclePaths,
      owner: `oracle-${crashPoint}`,
      ...oracleDependencies,
      effects: oracleEffects,
    });
    await oracle.executeEffect(intent(), [approval]);
    expect(logicalSnapshot(restarted.snapshot)).toEqual(logicalSnapshot(oracle.snapshot));
    expect(oracleEffects.invocations).toBe(1);
    await oracle.close();
    await restarted.close();
  });

  it('records intent before invocation, records outcome after invocation, and makes identical retry a no-op', async () => {
    const paths = await rootFixture();
    const effects = new FakeEffectTarget();
    const { clock, repository, runner } = await initializeFixture(paths, effects);
    const kernel = await openKernel({ ...paths, owner: 'ordered-effect', clock, repository, runner, effects });
    const approval = makeApproval('effect:target:fixture');
    const first = await kernel.executeEffect(intent(), [approval]);
    const sequence = kernel.snapshot?.lastEventSequence;
    const second = await kernel.executeEffect(intent(), [approval]);
    expect(second).toEqual(first);
    expect(kernel.snapshot?.lastEventSequence).toBe(sequence);
    expect(effects.invocations).toBe(1);
    expect(kernel.snapshot?.intents[0]?.operationId).toBe(first.operationId);
    expect(kernel.snapshot?.outcomes[0]).toEqual(first);
    await kernel.close();
  });

  it('refuses a changed operation record or reused idempotency key', async () => {
    const paths = await rootFixture();
    const effects = new FakeEffectTarget();
    const { clock, repository, runner } = await initializeFixture(paths, effects);
    const kernel = await openKernel({ ...paths, owner: 'idempotency', clock, repository, runner, effects });
    const approval = makeApproval('effect:target:fixture');
    await kernel.executeEffect(intent(), [approval]);
    await expect(kernel.executeEffect(intent({ target: 'target:changed' }), [approval])).rejects.toThrow(
      /identical operation and idempotency/
    );
    await expect(kernel.executeEffect(intent({
      id: 'intent:other',
      operationId: 'operation:other',
      approvalId: null,
    }))).rejects.toThrow(/Idempotency key is already bound/);
    await expect(kernel.executeEffect(intent({
      id: 'intent:replayed-approval',
      operationId: 'operation:replayed-approval',
      idempotencyKey: 'idempotency:replayed-approval',
    }), [approval])).rejects.toThrow(/already consumed in protected history/);
    expect(effects.invocations).toBe(1);
    await kernel.close();
  });

  it('reconstructs, re-observes, and reconciles before a fake runner can resume', async () => {
    const paths = await rootFixture();
    const effects = new FakeEffectTarget();
    const { clock, repository, runner } = await initializeFixture(paths, effects);
    const crashing = await openKernel({
      ...paths,
      owner: 'reconcile-crash',
      crash: 'after_intent_record',
      clock,
      repository,
      runner,
      effects,
    });
    await expect(crashing.executeEffect(intent(), [makeApproval('effect:target:fixture')])).rejects.toBeInstanceOf(
      InjectedCrashError
    );
    await crashing.close();

    const restarted = await openKernel({ ...paths, owner: 'reconcile-restart', clock, repository, runner, effects });
    await expect(restarted.collectRunnerEvidence({ episodeId: 'episode:1', requestId: 'request:early' })).rejects.toThrow(
      /running state|unreconciled/
    );
    await restarted.recoverIncompleteEffects();
    expect(repository.observations).toBe(2);
    expect(effects.reconciliations).toBe(1);
    expect(effects.invocations).toBe(1);
    expect(runner.starts).toBe(0);
    expect(runner.modelCalls).toBe(0);
    expect(runner.paidCalls).toBe(0);
    expect(runner.processSpawns).toBe(0);
    expect(runner.networkCalls).toBe(0);
    await restarted.close();
  });

  it('stops recovery when repository re-observation disagrees and does not invoke the effect', async () => {
    const paths = await rootFixture();
    const effects = new FakeEffectTarget();
    const { clock, repository, runner } = await initializeFixture(paths, effects);
    const crashing = await openKernel({
      ...paths,
      owner: 'repository-crash',
      crash: 'after_intent_record',
      clock,
      repository,
      runner,
      effects,
    });
    await expect(crashing.executeEffect(intent(), [makeApproval('effect:target:fixture')])).rejects.toBeInstanceOf(
      InjectedCrashError
    );
    await crashing.close();
    repository.setObservation({ ...REPOSITORY, headCommit: '9'.repeat(64) });

    const restarted = await openKernel({ ...paths, owner: 'repository-restart', clock, repository, runner, effects });
    await expect(restarted.recoverIncompleteEffects()).rejects.toThrow(/re-observation disagrees/);
    expect(effects.invocations).toBe(0);
    expect(effects.reconciliations).toBe(0);
    expect(runner.starts).toBe(0);
    await restarted.close();
  });

  it('records unknown effect outcome, blocks runner progress, and never retries it automatically', async () => {
    const paths = await rootFixture();
    const effects = new FakeEffectTarget();
    effects.setNextResult({
      status: 'unknown',
      resultDigest: null,
      detail: 'target timed out after request acceptance',
      reconciliationRequired: 'owner must reconcile operation:fixture',
    });
    const { clock, repository, runner } = await initializeFixture(paths, effects);
    const kernel = await openKernel({ ...paths, owner: 'unknown-effect', clock, repository, runner, effects });
    const outcome = await kernel.executeEffect(intent(), [makeApproval('effect:target:fixture')]);
    expect(outcome.status).toBe('unknown');
    expect(kernel.snapshot?.state).toBe('blocked');
    expect(kernel.snapshot?.outcomes).toHaveLength(1);
    const invocations = effects.invocations;
    await expect(kernel.collectRunnerEvidence({ episodeId: 'episode:1', requestId: 'request:1' })).rejects.toThrow();
    const retry = await kernel.executeEffect(intent(), [makeApproval('effect:target:fixture')]);
    expect(retry).toEqual(outcome);
    expect(effects.invocations).toBe(invocations);
    expect(runner.starts).toBe(0);
    await kernel.close();
  });

  it('uses fake repository, clock, runner, and effects with zero model and paid calls', async () => {
    const paths = await rootFixture();
    const effects = new FakeEffectTarget();
    const { clock, repository, runner } = await initializeFixture(paths, effects);
    const kernel = await openKernel({ ...paths, owner: 'fake-contract', clock, repository, runner, effects });
    expect(kernel.snapshot?.createdAt).toBe(clock.now());
    const request = {
      workflowId: WORKFLOW.id,
      featureId: FEATURE.featureId,
      sessionId: SESSION.id,
      episodeId: 'episode:deterministic',
      requestId: 'request:deterministic',
    };
    const oracleRunner = new FakeRunner(clock);
    expect(await runner.start(request)).toEqual(await oracleRunner.start(request));
    expect(repository.externalCalls).toBe(0);
    expect(runner.modelCalls).toBe(0);
    expect(runner.paidCalls).toBe(0);
    expect(runner.processSpawns).toBe(0);
    expect(runner.networkCalls).toBe(0);
    expect(effects.invocations).toBe(0);
    await kernel.close();
  });

  it('returns the same logical state after replay as uninterrupted execution', async () => {
    const paths = await rootFixture();
    const effects = new FakeEffectTarget();
    const { clock, repository, runner } = await initializeFixture(paths, effects);
    const first = await openKernel({ ...paths, owner: 'logical-first', clock, repository, runner, effects });
    await first.executeEffect(intent(), [makeApproval('effect:target:fixture')]);
    const before = first.snapshot as StateSnapshot;
    await first.close();
    const replayed = await openKernel({ ...paths, owner: 'logical-replay', clock, repository, runner, effects });
    expect(replayed.snapshot).toEqual(before);
    await replayed.close();
  });
});
