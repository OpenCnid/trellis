import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ACTIVATION_ENVIRONMENT_KEYS,
  ACTIVATION_VERSION,
  ActivationConfigError,
  RECOMMENDED_PROTECTED_LOCATIONS,
  inspectActivation,
  invokedAsEntrypoint,
  main,
  parseSeedArguments,
  printSeedRequest,
  readActivationConfig,
  resolveActivation,
  runActivationSeed,
} from '../src/activate';
import { APPROVAL_CHANNEL_FILE } from '../src/approval_channel';
import {
  PROTECTED_POLICY_SCHEMA_VERSION,
  createProtectedApprovalRecord,
  protectedRequestDigest,
  type ProtectedActionRequest,
} from '../src/policy';
import { buildSeedRequest, catalogStatusPairs } from '../src/seed';
import type { RepositoryObservation } from '../src/domain';

const NOW = '2026-07-15T12:00:00.000Z';
const CREATED_AT = '2026-07-15T10:00:00.000Z';

const REPOSITORY: RepositoryObservation = {
  repositoryId: 'repo:trellis',
  worktreeId: 'worktree:el10',
  branch: 'implement-el10-controller-activation',
  baseCommit: '695440cfa9733a56936011276640ab9369fae5e4',
  headCommit: '695440cfa9733a56936011276640ab9369fae5e4',
  clean: false,
};

const CATALOG = {
  schemaVersion: 1,
  program: 'trellis-engineering-loop',
  features: [
    { id: 'EL-00', bootstrapStatus: 'accepted' },
    { id: 'EL-06', bootstrapStatus: 'accepted' },
    { id: 'EL-07', bootstrapStatus: 'blocked' },
    { id: 'EL-10', bootstrapStatus: 'planned' },
  ],
};

const temporary: string[] = [];

afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});

interface Layout {
  base: string;
  worktree: string;
  config: {
    ledgerRoot: string;
    stateRoot: string;
    worktree: string;
    approvalChannel: string;
  };
  environment: Record<string, string | undefined>;
}

async function layout(): Promise<Layout> {
  const base = await mkdtemp(join(tmpdir(), 'trellis-el10-activate-'));
  temporary.push(base);
  const worktree = join(base, 'worktree');
  await mkdir(worktree, { recursive: true });
  const config = {
    ledgerRoot: join(base, 'protected', 'ledger'),
    stateRoot: join(base, 'protected', 'state'),
    worktree,
    approvalChannel: join(base, 'protected', 'channel'),
  };
  return {
    base,
    worktree,
    config,
    environment: {
      [ACTIVATION_ENVIRONMENT_KEYS.ledgerRoot]: config.ledgerRoot,
      [ACTIVATION_ENVIRONMENT_KEYS.stateRoot]: config.stateRoot,
      [ACTIVATION_ENVIRONMENT_KEYS.worktree]: config.worktree,
      [ACTIVATION_ENVIRONMENT_KEYS.approvalChannel]: config.approvalChannel,
    },
  };
}

describe('EL-10 controller activation entrypoint', () => {
  it('activate: explicit configuration resolution', async () => {
    const { environment, config } = await layout();
    const parsed = readActivationConfig(environment);
    expect(parsed).toEqual(config);

    const resolved = await resolveActivation(parsed);
    expect(resolved.ledgerRoot).toBe(await realish(config.ledgerRoot));
    expect(resolved.stateRoot).toBe(await realish(config.stateRoot));
    expect(resolved.approvalChannel).toBe(await realish(config.approvalChannel));
  });

  it('activate: refuses to start when any configured location is absent', async () => {
    const { environment } = await layout();
    for (const key of Object.values(ACTIVATION_ENVIRONMENT_KEYS)) {
      expect(() => readActivationConfig({ ...environment, [key]: undefined }))
        .toThrow(ActivationConfigError);
      expect(() => readActivationConfig({ ...environment, [key]: undefined })).toThrow(new RegExp(key));
      expect(() => readActivationConfig({ ...environment, [key]: '   ' })).toThrow(new RegExp(key));
    }
    expect(() => readActivationConfig({})).toThrow(/absent: TRELLIS_EL_APPROVAL_CHANNEL, TRELLIS_EL_LEDGER_ROOT, TRELLIS_EL_STATE_ROOT, TRELLIS_EL_WORKTREE/);
  });

  it('activate: refuses ambiguous configuration where two roles share a path', async () => {
    const { environment, config } = await layout();
    expect(() => readActivationConfig({
      ...environment, [ACTIVATION_ENVIRONMENT_KEYS.stateRoot]: config.ledgerRoot,
    })).toThrow(/ambiguous: ledgerRoot and stateRoot resolve to the same path/);
    expect(() => readActivationConfig({
      ...environment, [ACTIVATION_ENVIRONMENT_KEYS.approvalChannel]: config.ledgerRoot,
    })).toThrow(/ambiguous: ledgerRoot and approvalChannel resolve to the same path/);
  });

  it('activate: refuses a relative configured path', async () => {
    const { environment } = await layout();
    expect(() => readActivationConfig({
      ...environment, [ACTIVATION_ENVIRONMENT_KEYS.ledgerRoot]: 'protected/ledger',
    })).toThrow(/must be an absolute path/);
  });

  it('activate: protected root refusal matrix', async () => {
    const { config, worktree, base } = await layout();

    // 1. Contained: a root inside the assigned worktree.
    await expect(resolveActivation({ ...config, ledgerRoot: join(worktree, 'ledger') }))
      .rejects.toThrow(/must not be inside the assigned worktree/);

    // 2. Aliased: a root that canonicalizes into the worktree through a
    //    symlinked ancestor.
    const realInside = join(worktree, 'real-ledger');
    await mkdir(realInside, { recursive: true });
    // No silent skip when symlink creation is unavailable: a test that quietly
    // stops verifying the alias classes while still reporting green is the exact
    // "proven by nothing" shape this feature exists to close. It fails loudly
    // instead.
    const aliasLink = join(base, 'alias-ledger');
    await symlink(realInside, aliasLink, 'junction');
    await expect(resolveActivation({ ...config, ledgerRoot: aliasLink }))
      .rejects.toThrow(/resolves or aliases into the assigned worktree|must not be a symbolic link/);

    // 3. Symlink-reachable: a link inside the worktree pointing at the root.
    const reachable = join(base, 'protected', 'reachable-ledger');
    await mkdir(reachable, { recursive: true });
    await symlink(reachable, join(worktree, 'escape'), 'junction');
    await expect(resolveActivation({ ...config, ledgerRoot: reachable }))
      .rejects.toThrow(/writable through a symbolic-link alias in the assigned worktree/);
  });

  it('activate: reports ledger generation, ceremony, and resolved status read-only', async () => {
    const { config, environment } = await layout();
    const status = await inspectActivation({
      config: readActivationConfig(environment),
      clock: { now: () => NOW },
      catalog: CATALOG,
    });
    expect(status.version).toBe(ACTIVATION_VERSION);
    expect(status.generation).toBe(0);
    expect(status.ceremony).toBe('seeding');
    expect(status.recordCount).toBe(0);
    expect(status.integrity).toBe('valid');
    expect(status.acceptedFeatureIds).toEqual([]);
    // Inspection writes no record and releases the writer lock.
    await expect(readFile(join(config.ledgerRoot, 'generations', '0', 'acceptance.jsonl'), 'utf8'))
      .rejects.toThrow(/ENOENT/);
    const again = await inspectActivation({
      config: readActivationConfig(environment),
      clock: { now: () => NOW }, catalog: CATALOG,
    });
    expect(again.ceremony).toBe('seeding');
  });

  it('activate: composes the seed request the owner must approve without authorizing it', async () => {
    const { environment } = await layout();
    const config = readActivationConfig(environment);
    const printed = await printSeedRequest({
      config, repository: REPOSITORY, createdAt: CREATED_AT,
      approvalId: 'approval:el10-activation', catalog: CATALOG,
    });
    const request = printed.request as ProtectedActionRequest;
    expect(request.action).toBe('acceptance_change');
    expect(request.automatic).toBe(false);
    expect(request.exactScope).toEqual(['EL-00=accepted', 'EL-06=accepted', 'EL-07=blocked', 'EL-10=planned']);
    expect(printed.requestDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(printed.requestDigest).toBe(protectedRequestDigest(request));

    // EL-REQ-BOOT-002 requires the controller to author the request in full on
    // the developer's behalf: enumerated scope, computed digest, repository
    // preconditions, and the target generation. The developer authors the
    // approval; nothing here originates it.
    expect(printed.targetGeneration).toBe(0);
    expect(printed.ceremony).toBe('seeding');
    expect(request.repositoryPrecondition).toEqual(REPOSITORY);
  });

  it('activate: the entrypoint seeds only with owner-authored channel material', async () => {
    const { environment, config } = await layout();
    const parsed = readActivationConfig(environment);
    await mkdir(config.approvalChannel, { recursive: true });

    const seedInput = {
      config: parsed, clock: { now: () => NOW }, ownerId: 'owner:test',
      ownerToken: 'token-0123456789abcdef', repository: REPOSITORY,
      createdAt: CREATED_AT, approvalId: 'approval:el10-activation', catalog: CATALOG,
    };
    // With an empty channel there is no path to a seeded ledger.
    await expect(runActivationSeed(seedInput)).rejects.toThrow(/Protected approval record is missing/);

    const request = buildSeedRequest({
      pairs: catalogStatusPairs(CATALOG), repository: REPOSITORY,
      createdAt: CREATED_AT, approvalId: 'approval:el10-activation',
    });
    const approval = createProtectedApprovalRecord({
      id: request.approvalId,
      schemaVersion: PROTECTED_POLICY_SCHEMA_VERSION,
      createdAt: NOW,
      channel: 'protected_external',
      channelRecordId: 'channel:el10-activation',
      issuer: 'owner:darian',
      workflowId: request.workflowId,
      featureId: request.featureId,
      sessionId: request.sessionId,
      action: request.action,
      requestId: request.id,
      requestDigest: protectedRequestDigest(request),
      target: request.target,
      exactScope: [...request.exactScope],
      repositoryPrecondition: request.repositoryPrecondition,
      approvedEstimateUsd: null,
      approvedLimitUsd: null,
      issuedAt: '2026-07-15T11:00:00.000Z',
      expiresAt: '2026-07-15T13:00:00.000Z',
      revokedAt: null,
      revocationReason: null,
      consumptionState: 'active',
      consumedAt: null,
      consumptionId: null,
    });
    await writeFile(join(config.approvalChannel, APPROVAL_CHANNEL_FILE), JSON.stringify([approval]), 'utf8');

    const result = await runActivationSeed(seedInput);
    expect(result.records).toHaveLength(4);

    const status = await inspectActivation({
      config: parsed, clock: { now: () => NOW }, catalog: CATALOG,
    });
    expect(status.ceremony).toBe('ledger_recovery');
    expect(status.acceptedFeatureIds).toEqual(['EL-00', 'EL-06']);
    expect(status.statuses).toEqual({ 'EL-00': 'accepted', 'EL-06': 'accepted', 'EL-07': 'blocked', 'EL-10': 'planned' });
    expect(status.notes).toEqual([]);
  });

  it('activate: the recommended locations are documentation, never a code default', async () => {
    const { environment } = await layout();
    // The help text carries the convention for an operator to copy.
    const stdout: string[] = [];
    const writeOut = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => { stdout.push(String(chunk)); return true; }) as typeof process.stdout.write;
    try {
      await main(['--help'], environment);
    } finally {
      process.stdout.write = writeOut;
    }
    expect(stdout.join('')).toContain(RECOMMENDED_PROTECTED_LOCATIONS.win32);
    expect(stdout.join('')).toContain(RECOMMENDED_PROTECTED_LOCATIONS.posix);

    // But no recommended path is ever applied as a fallback: absent
    // configuration still refuses, so the controller never starts against a
    // location nobody chose. This is the distinction EL-REQ-BOOT-001 turns on.
    for (const key of Object.values(ACTIVATION_ENVIRONMENT_KEYS)) {
      expect(() => readActivationConfig({ ...environment, [key]: undefined })).toThrow(ActivationConfigError);
    }
    expect(() => readActivationConfig({})).toThrow(/requires explicit configuration/);
    expect(RECOMMENDED_PROTECTED_LOCATIONS.win32).not.toMatch(/^[A-Za-z]:\\/);
  });

  it('activate: reports a protected root that resolves somewhere other than configured', async () => {
    const { config, base } = await layout();

    // No redirect on ordinary roots.
    const plain = await resolveActivation(config);
    expect(plain.redirects).toEqual([]);

    // A root reached through a symlinked ANCESTOR resolves elsewhere. That is
    // the shape a containerized host produces when it redirects writes to
    // per-user application-data directories into a private package cache: the
    // configuration is honoured, the directory is real, and it is not the
    // directory an uncontainerized operator reaches with the same string.
    // Refusing it would be wrong — the root itself being a symlink is already
    // refused by EL-02, and an ancestor link is legitimate — but it must never
    // pass unnoticed, or the owner issues approval into a channel the controller
    // never reads and both sides see a coherent, empty, disagreeing view.
    const realParent = join(base, 'real-store');
    await mkdir(realParent, { recursive: true });
    const linkedParent = join(base, 'linked-store');
    await symlink(realParent, linkedParent, 'junction');

    const configured = join(linkedParent, 'channel');
    const redirected = await resolveActivation({ ...config, approvalChannel: configured });
    expect(redirected.redirects).toHaveLength(1);
    expect(redirected.redirects[0].role).toBe('approvalChannel');
    expect(redirected.redirects[0].configured).toBe(resolve(configured));
    expect(redirected.redirects[0].resolved).toBe(join(await realish(realParent), 'channel'));
    expect(redirected.redirects[0].resolved).not.toBe(redirected.redirects[0].configured);
  });

  it('activate: the recommended locations avoid virtualized application-data directories', () => {
    // %LOCALAPPDATA% and its POSIX equivalents are redirected into a per-package
    // cache by MSIX, Flatpak, Snap, and the macOS app sandbox. A protected root
    // there resolves differently for a contained process than for the owner's
    // shell, which silently splits the ledger in two.
    for (const value of Object.values(RECOMMENDED_PROTECTED_LOCATIONS)) {
      expect(value).not.toContain('LOCALAPPDATA');
      expect(value).not.toContain('XDG_STATE_HOME');
      expect(value).not.toContain('Library');
      expect(value).not.toContain('AppData');
    }
  });

  it('activate: seed arguments are strict, complete, and bounded', () => {
    const complete = [
      '--branch', 'master',
      '--base', '695440cfa9733a56936011276640ab9369fae5e4',
      '--remote-name', 'origin',
      '--remote-url', 'https://github.com/OpenCnid/trellis',
      '--approval-id', 'approval:el10-activation',
      '--created-at', CREATED_AT,
    ];
    const parsed = parseSeedArguments(complete);
    expect(parsed.branch).toBe('master');
    expect(parsed.approvalId).toBe('approval:el10-activation');
    expect(parsed.createdAt).toBe(CREATED_AT);

    expect(() => parseSeedArguments([])).toThrow(/invalid or incomplete/);
    expect(() => parseSeedArguments(['--invented', 'x'])).toThrow(/Unknown or malformed seed argument/);
    expect(() => parseSeedArguments(['--branch'])).toThrow(/requires a value/);
    expect(() => parseSeedArguments([...complete, '--branch', 'other'])).toThrow(/is repeated/);
    expect(() => parseSeedArguments([...complete.slice(0, 2), '--base', 'short',
      '--remote-name', 'origin', '--remote-url', 'u', '--approval-id', 'a', '--created-at', CREATED_AT]))
      .toThrow(/full Git commit identity/);
  });

  it('activate: the request timestamp is carried, never regenerated', () => {
    // The request digest covers createdAt. If seed re-composed the request with
    // a fresh clock reading, the digest would drift and the owner's approval —
    // authored against the printed digest — would silently stop matching. So
    // seed requires the timestamp explicitly and refuses to invent one.
    const withoutTimestamp = [
      '--branch', 'master',
      '--base', '695440cfa9733a56936011276640ab9369fae5e4',
      '--remote-name', 'origin',
      '--remote-url', 'https://github.com/OpenCnid/trellis',
      '--approval-id', 'approval:el10-activation',
    ];
    expect(() => parseSeedArguments(withoutTimestamp)).toThrow(/createdAt/);
    // print-seed-request may default it, and echoes what it chose.
    expect(parseSeedArguments(withoutTimestamp, { createdAt: CREATED_AT }).createdAt).toBe(CREATED_AT);

    // Two requests differing only in createdAt carry different digests.
    const base = { pairs: catalogStatusPairs(CATALOG), repository: REPOSITORY, approvalId: 'approval:x' };
    const a = protectedRequestDigest(buildSeedRequest({ ...base, createdAt: CREATED_AT }));
    const b = protectedRequestDigest(buildSeedRequest({ ...base, createdAt: '2026-07-15T10:00:01.000Z' }));
    expect(a).not.toBe(b);
    // The same inputs reproduce the identical digest, which is what lets print
    // and seed agree.
    expect(protectedRequestDigest(buildSeedRequest({ ...base, createdAt: CREATED_AT }))).toBe(a);
  });

  it('activate: identifies the process entrypoint without import.meta or require.main', () => {
    expect(invokedAsEntrypoint('tools/engineering-loop/src/activate.ts')).toBe(true);
    expect(invokedAsEntrypoint('D:\\repo\\dist\\tools\\engineering-loop\\src\\activate.js')).toBe(true);
    expect(invokedAsEntrypoint('/repo/node_modules/.bin/vitest')).toBe(false);
    expect(invokedAsEntrypoint(undefined)).toBe(false);
    expect(invokedAsEntrypoint('')).toBe(false);
  });

  it('activate: main resolves configuration and refuses with a bounded typed error', async () => {
    const { environment } = await layout();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const writeOut = process.stdout.write.bind(process.stdout);
    const writeErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: string) => { stdout.push(String(chunk)); return true; }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string) => { stderr.push(String(chunk)); return true; }) as typeof process.stderr.write;
    try {
      expect(await main(['check'], environment)).toBe(0);
      expect(JSON.parse(stdout.join('')).result).toBe('resolved');

      stdout.length = 0;
      expect(await main(['check'], {})).toBe(1);
      const refusal = JSON.parse(stderr.join(''));
      expect(refusal.result).toBe('refused');
      expect(refusal.error).toBe('ActivationConfigError');

      stderr.length = 0;
      expect(await main(['invent'], environment)).toBe(2);
      expect(stderr.join('')).toContain("Unknown command 'invent'");

      stdout.length = 0;
      expect(await main(['--help'], environment)).toBe(0);
      expect(stdout.join('')).toContain('Trellis engineering-loop controller activation');
    } finally {
      process.stdout.write = writeOut;
      process.stderr.write = writeErr;
    }
  });
});

async function realish(path: string): Promise<string> {
  const { realpath } = await import('node:fs/promises');
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}
