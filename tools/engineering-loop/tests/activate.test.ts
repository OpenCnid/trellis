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
  parseAcceptanceChangeArguments,
  parseGenesisArguments,
  parseReconciliationItem,
  parseRecoveryArguments,
  parseSeedArguments,
  parseStatusPair,
  printGenesisRequest,
  printRecoveryRequest,
  printSeedRequest,
  readActivationConfig,
  resolveActivation,
  runActivationSeed,
  runLedgerRecovery,
  runReGenesis,
} from '../src/activate';
import { APPROVAL_CHANNEL_FILE } from '../src/approval_channel';
import {
  PROTECTED_POLICY_SCHEMA_VERSION,
  createProtectedApprovalRecord,
  protectedRequestDigest,
  type ProtectedActionRequest,
  type ProtectedApprovalRecord,
} from '../src/policy';
import { buildSeedRequest, catalogStatusPairs, seedScopeItem } from '../src/seed';
import { reconciliationScopeItem } from '../src/ledger_recovery';
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

const CLOCK = { now: () => NOW };

function ownerApproval(request: ProtectedActionRequest): ProtectedApprovalRecord {
  return createProtectedApprovalRecord({
    id: request.approvalId,
    schemaVersion: PROTECTED_POLICY_SCHEMA_VERSION,
    createdAt: NOW,
    channel: 'protected_external',
    channelRecordId: `channel:${request.approvalId}`,
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
}

async function writeChannel(layoutValue: Layout, approvals: readonly unknown[]): Promise<void> {
  // Pre-created at 0o700: validateProtectedStateRoot refuses pre-existing
  // roots that grant group or other permissions on POSIX (the PR #115 class —
  // invisible under Windows, fatal on the Linux CI runner).
  await mkdir(layoutValue.config.approvalChannel, { recursive: true, mode: 0o700 });
  await writeFile(
    join(layoutValue.config.approvalChannel, APPROVAL_CHANNEL_FILE),
    JSON.stringify(approvals, null, 2),
    'utf8'
  );
}

/** A layout whose generation 0 is seeded through the entrypoint's own path. */
async function seededLayout(): Promise<Layout> {
  const l = await layout();
  const request = buildSeedRequest({
    pairs: catalogStatusPairs(CATALOG),
    repository: REPOSITORY,
    createdAt: CREATED_AT,
    approvalId: 'approval:el10-activation',
  });
  await writeChannel(l, [ownerApproval(request)]);
  await runActivationSeed({
    config: readActivationConfig(l.environment),
    clock: CLOCK,
    ownerId: 'owner:test',
    ownerToken: 'token-0123456789abcdef',
    repository: REPOSITORY,
    createdAt: CREATED_AT,
    approvalId: 'approval:el10-activation',
    catalog: CATALOG,
  });
  return l;
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

  it('activate: reports ledger generation, admissible ceremonies, and resolved status read-only', async () => {
    const { config, environment } = await layout();
    const status = await inspectActivation({
      config: readActivationConfig(environment),
      clock: { now: () => NOW },
      catalog: CATALOG,
    });
    expect(status.version).toBe(ACTIVATION_VERSION);
    expect(status.generation).toBe(0);
    expect(status.ceremonies).toEqual(['seeding']);
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
    expect(again.ceremonies).toEqual(['seeding']);
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
    expect(printed.ceremonies).toEqual(['seeding']);
    expect(request.repositoryPrecondition).toEqual(REPOSITORY);
  });

  it('activate: the entrypoint seeds only with owner-authored channel material', async () => {
    const { environment, config } = await layout();
    const parsed = readActivationConfig(environment);
    // Pre-created at 0o700: validateProtectedStateRoot refuses pre-existing
    // roots that grant group or other permissions on POSIX.
    await mkdir(config.approvalChannel, { recursive: true, mode: 0o700 });

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
    // A populated, validating ledger admits an ordinary status change as well as
    // a content reconciliation. Reporting only `ledger_recovery` here told an
    // operator that a corruption ceremony was all a healthy ledger allowed.
    expect(status.ceremonies).toEqual(['steady_state_acceptance', 'ledger_recovery']);
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

  it('activate: parses repeatable acceptance-change pairs and refuses malformed ones', () => {
    const base = [
      '--branch', 'master',
      '--base', '272a18eceb078650b96800faa4faea7e2ac532ce',
      '--remote-url', 'https://github.com/OpenCnid/trellis',
      '--remote-name', 'origin',
      '--approval-id', 'approval:el11-acceptance-change',
      '--created-at', CREATED_AT,
    ];
    const parsed = parseAcceptanceChangeArguments([...base, '--set', 'EL-10=accepted', '--set', 'EL-07=planned']);
    expect(parsed.pairs).toEqual([
      { featureId: 'EL-10', status: 'accepted' },
      { featureId: 'EL-07', status: 'planned' },
    ]);
    expect(parsed.branch).toBe('master');

    // At least one pair is required: the controller never infers a status change,
    // and an acceptance-change request with no scope would be a request to change
    // nothing that an approval could still match.
    expect(() => parseAcceptanceChangeArguments(base)).toThrow(/requires at least one --set/);
    expect(() => parseAcceptanceChangeArguments([...base, '--set', 'EL-10'])).toThrow(/is malformed/);
    expect(() => parseAcceptanceChangeArguments([...base, '--set', '=accepted'])).toThrow(/is malformed/);
    expect(() => parseAcceptanceChangeArguments([...base, '--set', 'EL-10='])).toThrow(/is malformed/);
    expect(() => parseAcceptanceChangeArguments([...base, '--set', 'EL-10=invented']))
      .toThrow(/is not one of: planned, active, accepted, blocked, deferred/);
    expect(() => parseAcceptanceChangeArguments([...base, '--set'])).toThrow(/requires a value/);

    // What the owner types, what the request carries, and what the approval must
    // match are one grammar: the parsed pair round-trips through the scope item.
    expect(seedScopeItem(parseStatusPair('EL-10=accepted'))).toBe('EL-10=accepted');
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

      // Both steady-state commands are real commands the entrypoint knows, not
      // exported functions an operator has no way to call. EL-REQ-APPROVAL-010
      // is about exactly this difference.
      expect(stdout.join('')).toContain('print-acceptance-request');
      expect(stdout.join('')).toContain('record-acceptance');

      stderr.length = 0;
      expect(await main(['record-acceptance'], environment)).toBe(1);
      // Refused for want of a scope, and the refusal names the missing input
      // rather than silently changing nothing.
      expect(JSON.parse(stderr.join('')).message).toContain('requires at least one --set');
    } finally {
      process.stdout.write = writeOut;
      process.stderr.write = writeErr;
    }
  });

  it('activate: parses repeatable supersede items and owner reconciliation material', () => {
    const base = [
      '--branch', 'master',
      '--base', '695440cfa9733a56936011276640ab9369fae5e4',
      '--remote-name', 'origin',
      '--remote-url', 'https://github.com/OpenCnid/trellis',
      '--approval-id', 'approval:recovery',
      '--created-at', CREATED_AT,
    ];
    const parsed = parseRecoveryArguments([
      ...base,
      '--supersede', 'EL-07=planned:2,5',
      '--supersede', 'EL-10=active:3',
      '--issuer', 'owner:darian',
      '--signature-ref', 'protected://signatures/recovery.sig',
      '--evidence-ref', 'protected://evidence/recovery.json',
      '--evidence-digest', 'd'.repeat(64),
      '--reason', 'recorded against the wrong generation',
    ]);
    expect(parsed.scope).toEqual([
      { featureId: 'EL-07', status: 'planned', supersedes: [2, 5] },
      { featureId: 'EL-10', status: 'active', supersedes: [3] },
    ]);
    expect(parsed.issuer).toBe('owner:darian');
    expect(parsed.evidenceDigest).toBe('d'.repeat(64));
    expect(parsed.approvalId).toBe('approval:recovery');

    // The owner fields stay optional at parse time: print composes without them.
    const printable = parseRecoveryArguments([...base, '--supersede', 'EL-07=planned:2']);
    expect(printable.issuer).toBeUndefined();

    expect(() => parseRecoveryArguments(base)).toThrow(/requires at least one --supersede/);
    expect(() => parseRecoveryArguments([...base, '--supersede'])).toThrow(/requires a value/);
    expect(() => parseRecoveryArguments([...base, '--supersede', 'EL-07=planned'])).toThrow(/is malformed/);
    expect(() => parseRecoveryArguments([...base, '--supersede', 'EL-07=planned:'])).toThrow(/is malformed/);
    expect(() => parseRecoveryArguments([...base, '--supersede', 'EL-07=planned:x']))
      .toThrow(/not a nonnegative integer/);
    expect(() => parseRecoveryArguments([...base, '--supersede', 'EL-07=planned:2,']))
      .toThrow(/not a nonnegative integer/);
    expect(() => parseRecoveryArguments([...base, '--supersede', 'EL-07=invented:2']))
      .toThrow(/is not one of: planned, active, accepted, blocked, deferred/);
    expect(() => parseRecoveryArguments([
      ...base, '--supersede', 'EL-07=planned:2', '--issuer', 'a', '--issuer', 'b',
    ])).toThrow(/is repeated/);

    // What the owner types round-trips into the scope item the approval must
    // match, sequences canonical: one grammar, not two that can drift.
    expect(reconciliationScopeItem(parseReconciliationItem('EL-07=planned:5,2')))
      .toBe('EL-07=planned:supersedes=2,5');
  });

  it('activate: parses re-genesis reconstruction pairs and two approval roles', () => {
    const base = [
      '--branch', 'master',
      '--base', '695440cfa9733a56936011276640ab9369fae5e4',
      '--remote-name', 'origin',
      '--remote-url', 'https://github.com/OpenCnid/trellis',
      '--genesis-approval-id', 'approval:genesis',
      '--seed-approval-id', 'approval:reseed',
      '--created-at', CREATED_AT,
    ];
    const parsed = parseGenesisArguments([
      ...base,
      '--set', 'EL-00=accepted',
      '--set', 'EL-07=blocked',
      '--issuer', 'owner:darian',
      '--signature-ref', 'protected://signatures/genesis.sig',
      '--reconstruction-basis', 'Reconstructed from the merged ratification record.',
    ]);
    expect(parsed.pairs).toEqual([
      { featureId: 'EL-00', status: 'accepted' },
      { featureId: 'EL-07', status: 'blocked' },
    ]);
    expect(parsed.genesisApprovalId).toBe('approval:genesis');
    expect(parsed.seedApprovalId).toBe('approval:reseed');
    expect(parsed.reconstructionBasis).toContain('merged ratification');

    // The reconstruction pairs come from the owner's basis, never controller state.
    expect(() => parseGenesisArguments(base)).toThrow(/requires at least one --set/);

    // Two roles, two owner decisions, two channel records. One identity cannot
    // cover both, and the boundary names the predicate instead of surfacing a
    // generic approval mismatch later.
    expect(() => parseGenesisArguments([
      '--branch', 'master',
      '--base', '695440cfa9733a56936011276640ab9369fae5e4',
      '--remote-name', 'origin',
      '--remote-url', 'https://github.com/OpenCnid/trellis',
      '--genesis-approval-id', 'approval:same',
      '--seed-approval-id', 'approval:same',
      '--created-at', CREATED_AT,
      '--set', 'EL-00=accepted',
    ])).toThrow(/one approval identity cannot cover both/);

    expect(() => parseGenesisArguments(['--approval-id', 'x', '--set', 'EL-00=accepted']))
      .toThrow(/Unknown or malformed re-genesis argument/);
    expect(() => parseGenesisArguments([...base, '--set', 'EL-00=accepted', '--branch', 'other']))
      .toThrow(/is repeated/);
    expect(() => parseGenesisArguments(['--set', 'EL-00=accepted'])).toThrow(/invalid or incomplete/);
  });

  it('activate: recovery command pair composes and executes a content reconciliation end to end', async () => {
    const l = await seededLayout();
    const config = readActivationConfig(l.environment);
    const scope = [{ featureId: 'EL-07', status: 'planned' as const, supersedes: [2] }];

    // Compose against an empty channel: every unprotected preparatory step
    // completes before any approval exists (EL-REQ-APPROVAL-012).
    await writeChannel(l, []);
    const printed = await printRecoveryRequest({
      config, scope, repository: REPOSITORY, createdAt: CREATED_AT,
      approvalId: 'approval:recovery', clock: CLOCK, catalog: CATALOG,
    });
    expect(printed.requestDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(printed.targetGeneration).toBe(0);
    expect(printed.ceremonies).toEqual(['steady_state_acceptance', 'ledger_recovery']);
    const request = printed.request as ProtectedActionRequest;
    expect(request.action).toBe('ledger_recovery');
    expect(request.exactScope).toEqual(['EL-07=planned:supersedes=2']);

    // Reordered scope arguments yield the identical digest: the same owner
    // decision, expressed in a different flag order, is the same request.
    const two = [
      { featureId: 'EL-10', status: 'active' as const, supersedes: [3] },
      { featureId: 'EL-07', status: 'planned' as const, supersedes: [2] },
    ];
    const forward = await printRecoveryRequest({
      config, scope: two, repository: REPOSITORY, createdAt: CREATED_AT,
      approvalId: 'approval:recovery', clock: CLOCK, catalog: CATALOG,
    });
    const reversed = await printRecoveryRequest({
      config, scope: [...two].reverse(), repository: REPOSITORY, createdAt: CREATED_AT,
      approvalId: 'approval:recovery', clock: CLOCK, catalog: CATALOG,
    });
    expect(reversed.requestDigest).toBe(forward.requestDigest);

    // With no approval there is no path to a written record.
    await expect(runLedgerRecovery({
      config, clock: CLOCK, ownerId: 'owner:test', ownerToken: 'token-recovery-0001',
      scope, issuer: 'owner:darian', signatureReference: 'protected://sig',
      evidenceReference: 'protected://evidence', evidenceDigest: 'd'.repeat(64),
      reason: 'EL-07 was recorded against the wrong generation.',
      repository: REPOSITORY, createdAt: CREATED_AT, approvalId: 'approval:recovery',
      catalog: CATALOG,
    })).rejects.toThrow(/Protected approval record is missing/);

    // The owner authors approval against the printed digest; execution appends.
    await writeChannel(l, [ownerApproval(request)]);
    const before = await readFile(join(l.config.ledgerRoot, 'generations', '0', 'acceptance.jsonl'), 'utf8');
    const result = await runLedgerRecovery({
      config, clock: CLOCK, ownerId: 'owner:test', ownerToken: 'token-recovery-0002',
      scope, issuer: 'owner:darian', signatureReference: 'protected://sig',
      evidenceReference: 'protected://evidence', evidenceDigest: 'd'.repeat(64),
      reason: 'EL-07 was recorded against the wrong generation.',
      repository: REPOSITORY, createdAt: CREATED_AT, approvalId: 'approval:recovery',
      catalog: CATALOG,
    });
    expect(result.generation).toBe(0);
    expect(result.records).toHaveLength(5);
    expect(result.reconciliation.issuer).toBe('owner:darian');

    // Superseding is by replay: the prior bytes survive unmutated.
    const after = await readFile(join(l.config.ledgerRoot, 'generations', '0', 'acceptance.jsonl'), 'utf8');
    expect(after.startsWith(before)).toBe(true);

    const status = await inspectActivation({ config, clock: CLOCK, catalog: CATALOG });
    expect(status.recordCount).toBe(5);
    expect(status.statuses['EL-07']).toBe('planned');
    expect(status.integrity).toBe('valid');
  });

  it('activate: re-genesis command pair opens a new generation on a corrupt fixture ledger', async () => {
    const l = await seededLayout();
    const config = readActivationConfig(l.environment);

    // An intact chain has no break for a genesis request to name.
    await expect(printGenesisRequest({
      config, pairs: [{ featureId: 'EL-00', status: 'accepted' }], repository: REPOSITORY,
      createdAt: CREATED_AT, genesisApprovalId: 'approval:genesis',
      seedApprovalId: 'approval:reseed', clock: CLOCK, catalog: CATALOG,
    })).rejects.toThrow(/intact integrity chain/);

    // Corruption belongs in fixtures: drop the first record of the temporary
    // ledger this test built, so the chain no longer links.
    const generationPath = join(l.config.ledgerRoot, 'generations', '0', 'acceptance.jsonl');
    const corruptBytes = (await readFile(generationPath, 'utf8')).split('\n').slice(1).join('\n');
    await writeFile(generationPath, corruptBytes, 'utf8');
    const broken = await inspectActivation({ config, clock: CLOCK, catalog: CATALOG });
    expect(broken.integrity).toBe('broken');
    expect(broken.ceremonies).toEqual(['re_genesis']);

    // The reconstruction pairs come from the owner's basis; the catalog is the
    // live post-migration shape and carries no status to read.
    const MIGRATED_CATALOG = {
      schemaVersion: 1,
      program: 'trellis-engineering-loop',
      features: [{ id: 'EL-00' }, { id: 'EL-06' }, { id: 'EL-07' }, { id: 'EL-10' }],
    };
    const pairs = [
      { featureId: 'EL-06', status: 'accepted' as const },
      { featureId: 'EL-00', status: 'accepted' as const },
      { featureId: 'EL-07', status: 'blocked' as const },
    ];

    await writeChannel(l, []);
    const printed = await printGenesisRequest({
      config, pairs, repository: REPOSITORY, createdAt: CREATED_AT,
      genesisApprovalId: 'approval:genesis', seedApprovalId: 'approval:reseed', clock: CLOCK,
      catalog: MIGRATED_CATALOG,
    });
    expect(printed.corruptGeneration).toBe(0);
    expect(printed.targetGeneration).toBe(1);
    expect(printed.genesisRequestDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(printed.seedRequestDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(printed.genesisRequestDigest).not.toBe(printed.seedRequestDigest);
    expect((printed.genesisRequest as ProtectedActionRequest).action).toBe('ledger_recovery');
    expect((printed.seedRequest as ProtectedActionRequest).action).toBe('acceptance_change');

    // Transposed reconstruction flags compose the identical seed digest.
    const transposed = await printGenesisRequest({
      config, pairs: [...pairs].reverse(), repository: REPOSITORY, createdAt: CREATED_AT,
      genesisApprovalId: 'approval:genesis', seedApprovalId: 'approval:reseed', clock: CLOCK,
      catalog: MIGRATED_CATALOG,
    });
    expect(transposed.seedRequestDigest).toBe(printed.seedRequestDigest);

    // Two owner approvals, one per role, authored against the two printed digests.
    await writeChannel(l, [
      ownerApproval(printed.genesisRequest as ProtectedActionRequest),
      ownerApproval(printed.seedRequest as ProtectedActionRequest),
    ]);
    const result = await runReGenesis({
      config, clock: CLOCK, ownerId: 'owner:test', ownerToken: 'token-genesis-00001',
      pairs, issuer: 'owner:darian', signatureReference: 'protected://sig',
      reconstructionBasis: 'Reconstructed from the merged ratification record.',
      repository: REPOSITORY, createdAt: CREATED_AT,
      genesisApprovalId: 'approval:genesis', seedApprovalId: 'approval:reseed',
      catalog: MIGRATED_CATALOG,
    });
    expect(result.corruptGeneration).toBe(0);
    expect(result.newGeneration).toBe(1);
    expect(result.genesis.kind).toBe('genesis');

    // The corrupt generation is retained read-only and stays resolvable as history.
    expect(await readFile(generationPath, 'utf8')).toBe(corruptBytes);

    const status = await inspectActivation({ config, clock: CLOCK, catalog: MIGRATED_CATALOG });
    expect(status.generation).toBe(1);
    expect(status.integrity).toBe('valid');
    expect(status.recordCount).toBe(4);
    expect(status.statuses).toEqual({ 'EL-00': 'accepted', 'EL-06': 'accepted', 'EL-07': 'blocked' });
    expect(status.ceremonies).toEqual(['steady_state_acceptance', 'ledger_recovery']);
  });

  it('activate: recovery and re-genesis refuse states outside their predicates, routing to the owning ceremony', async () => {
    // recover on an empty generation routes to seeding.
    const empty = await layout();
    await writeChannel(empty, []);
    const emptyConfig = readActivationConfig(empty.environment);
    await expect(runLedgerRecovery({
      config: emptyConfig, clock: CLOCK, ownerId: 'owner:test', ownerToken: 'token-route-000001',
      scope: [{ featureId: 'EL-07', status: 'planned', supersedes: [2] }],
      issuer: 'owner:darian', signatureReference: 'protected://sig',
      evidenceReference: 'protected://evidence', evidenceDigest: 'd'.repeat(64),
      reason: 'nothing to reconcile', repository: REPOSITORY, createdAt: CREATED_AT,
      approvalId: 'approval:recovery', catalog: CATALOG,
    })).rejects.toThrow(/is empty; there is no content to reconcile.*EL-REQ-BOOT-003/s);

    // re-genesis on the same empty, intact generation routes to seeding too.
    await expect(runReGenesis({
      config: emptyConfig, clock: CLOCK, ownerId: 'owner:test', ownerToken: 'token-route-000002',
      pairs: [{ featureId: 'EL-00', status: 'accepted' }],
      issuer: 'owner:darian', signatureReference: 'protected://sig',
      reconstructionBasis: 'basis', repository: REPOSITORY, createdAt: CREATED_AT,
      genesisApprovalId: 'approval:genesis', seedApprovalId: 'approval:reseed',
      catalog: CATALOG,
    })).rejects.toThrow(/intact integrity chain; re-genesis is refused/);

    // recover on a broken chain routes to re-genesis: a successor digest would
    // inherit or mask the break.
    const brokenLayout = await seededLayout();
    const brokenConfig = readActivationConfig(brokenLayout.environment);
    const generationPath = join(brokenLayout.config.ledgerRoot, 'generations', '0', 'acceptance.jsonl');
    await writeFile(generationPath, (await readFile(generationPath, 'utf8')).split('\n').slice(1).join('\n'), 'utf8');
    await expect(runLedgerRecovery({
      config: brokenConfig, clock: CLOCK, ownerId: 'owner:test', ownerToken: 'token-route-000003',
      scope: [{ featureId: 'EL-07', status: 'planned', supersedes: [2] }],
      issuer: 'owner:darian', signatureReference: 'protected://sig',
      evidenceReference: 'protected://evidence', evidenceDigest: 'd'.repeat(64),
      reason: 'wrong ceremony for a broken chain', repository: REPOSITORY, createdAt: CREATED_AT,
      approvalId: 'approval:recovery', catalog: CATALOG,
    })).rejects.toThrow(/broken integrity chain.*Re-genesis under EL-REQ-BOOT-007/s);
  });

  it('activate: the recovery and re-genesis commands are real commands the entrypoint knows', async () => {
    const { environment } = await layout();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const writeOut = process.stdout.write.bind(process.stdout);
    const writeErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: string) => { stdout.push(String(chunk)); return true; }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string) => { stderr.push(String(chunk)); return true; }) as typeof process.stderr.write;
    try {
      // EL-REQ-APPROVAL-010 turns on exactly this: commands an operator can run,
      // not exported functions nobody outside the suite can call.
      expect(await main(['--help'], environment)).toBe(0);
      const usage = stdout.join('');
      expect(usage).toContain('print-recovery-request');
      expect(usage).toContain('recover');
      expect(usage).toContain('print-genesis-request');
      expect(usage).toContain('re-genesis');
      expect(usage).toContain('--supersede');
      expect(usage).toContain('--genesis-approval-id');
      expect(usage).toContain('--reconstruction-basis');

      // Refusals name the missing input rather than silently changing nothing.
      stderr.length = 0;
      expect(await main(['recover'], environment)).toBe(1);
      expect(JSON.parse(stderr.join('')).message).toContain('requires at least one --supersede');

      stderr.length = 0;
      expect(await main(['re-genesis'], environment)).toBe(1);
      expect(JSON.parse(stderr.join('')).message).toContain('requires at least one --set');
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
