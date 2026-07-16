import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AcceptanceLedger, admissibleLedgerCeremonies, resolveFeatureStatus } from '../src/acceptance_ledger';
import { APPROVAL_CHANNEL_FILE, ApprovalChannelError, FileProtectedApprovalChannel } from '../src/approval_channel';
import {
  PROTECTED_POLICY_SCHEMA_VERSION,
  createProtectedApprovalRecord,
  protectedRequestDigest,
  type ProtectedActionRequest,
  type ProtectedApprovalRecord,
} from '../src/policy';
import {
  SEED_REFUSAL_CLASSES,
  SeedRefusedError,
  buildSeedRequest,
  catalogStatusPairs,
  seedAcceptanceLedger,
  seedScope,
} from '../src/seed';
import type { RepositoryObservation } from '../src/domain';

const NOW = '2026-07-15T12:00:00.000Z';
const CREATED_AT = '2026-07-15T10:00:00.000Z';
const APPROVAL_ID = 'approval:el10-activation';

const REPOSITORY: RepositoryObservation = {
  repositoryId: 'repo:trellis',
  worktreeId: 'worktree:el10',
  branch: 'implement-el10-controller-activation',
  baseCommit: '695440cfa9733a56936011276640ab9369fae5e4',
  headCommit: '695440cfa9733a56936011276640ab9369fae5e4',
  clean: false,
};

/** The eleven activation pairs, shaped exactly like the real catalog. */
const CATALOG = {
  schemaVersion: 1,
  program: 'trellis-engineering-loop',
  statusAuthority: 'bootstrap_git_until_el_02',
  features: [
    { id: 'EL-00', bootstrapStatus: 'accepted' }, { id: 'EL-01', bootstrapStatus: 'accepted' },
    { id: 'EL-02', bootstrapStatus: 'accepted' }, { id: 'EL-03', bootstrapStatus: 'accepted' },
    { id: 'EL-04', bootstrapStatus: 'accepted' }, { id: 'EL-05', bootstrapStatus: 'accepted' },
    { id: 'EL-06', bootstrapStatus: 'accepted' }, { id: 'EL-07', bootstrapStatus: 'blocked' },
    { id: 'EL-08', bootstrapStatus: 'deferred' }, { id: 'EL-09', bootstrapStatus: 'deferred' },
    { id: 'EL-10', bootstrapStatus: 'planned' },
  ],
};

const temporary: string[] = [];

afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});

interface Harness {
  ledger: AcceptanceLedger;
  channel: FileProtectedApprovalChannel;
  channelDirectory: string;
  worktree: string;
}

async function harness(approvals: readonly unknown[]): Promise<Harness> {
  const base = await mkdtemp(join(tmpdir(), 'trellis-el10-seed-'));
  temporary.push(base);
  const worktree = join(base, 'worktree');
  await mkdir(worktree, { recursive: true });
  const channelDirectory = join(base, 'protected', 'channel');
  // validateProtectedStateRoot refuses pre-existing roots that grant group or
  // other permissions on POSIX, so the fixture must pre-create at 0o700.
  await mkdir(channelDirectory, { recursive: true, mode: 0o700 });
  await writeFile(join(channelDirectory, APPROVAL_CHANNEL_FILE), JSON.stringify(approvals, null, 2), 'utf8');
  const channel = await FileProtectedApprovalChannel.open({ channelDirectory, worktree });
  const ledger = await AcceptanceLedger.open({
    ledgerRoot: join(base, 'protected', 'ledger'),
    worktree,
    clock: { now: () => NOW },
    ownerId: 'owner:test',
    ownerToken: 'token-0123456789abcdef',
  });
  return { ledger, channel, channelDirectory, worktree };
}

function seedRequest(overrides: Partial<{ approvalId: string }> = {}): ProtectedActionRequest {
  return buildSeedRequest({
    pairs: catalogStatusPairs(CATALOG),
    repository: REPOSITORY,
    createdAt: CREATED_AT,
    approvalId: overrides.approvalId ?? APPROVAL_ID,
  });
}

/** Owner-authored approval material, as it appears in the protected channel. */
function ownerApproval(
  request: ProtectedActionRequest,
  overrides: Partial<Omit<ProtectedApprovalRecord, 'recordDigest'>> = {}
): ProtectedApprovalRecord {
  return createProtectedApprovalRecord({
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
    ...overrides,
  });
}

async function seed(h: Harness, approvalId = APPROVAL_ID) {
  return seedAcceptanceLedger({
    ledger: h.ledger,
    channel: h.channel,
    catalog: CATALOG,
    repository: REPOSITORY,
    now: NOW,
    createdAt: CREATED_AT,
    approvalId,
  });
}

describe('EL-10 acceptance seeding', () => {
  it('seed: single approval-gated acceptance_change', async () => {
    const request = seedRequest();
    const h = await harness([ownerApproval(request)]);
    try {
      const result = await seed(h);
      expect(result.records).toHaveLength(11);
      expect(result.scope).toHaveLength(11);
      // The scope enumerates each exact (feature, status) pair.
      expect(result.scope).toContain('EL-06=accepted');
      expect(result.scope).toContain('EL-07=blocked');
      expect(result.scope).toContain('EL-10=planned');
      expect(request.action).toBe('acceptance_change');
      // One approval covers all eleven records.
      expect(new Set(result.records.map(record => record.approvalId))).toEqual(new Set([APPROVAL_ID]));
      expect(result.records.every(record => record.actor === 'human')).toBe(true);

      const resolved = resolveFeatureStatus(await h.ledger.readGeneration(0));
      expect(resolved.acceptedFeatureIds).toEqual(['EL-00', 'EL-01', 'EL-02', 'EL-03', 'EL-04', 'EL-05', 'EL-06']);
      expect(resolved.statuses.get('EL-07')).toBe('blocked');
      expect(resolved.statuses.get('EL-10')).toBe('planned');
    } finally {
      await h.ledger.close();
    }
  });

  it('seed: refusal matrix', async () => {
    const request = seedRequest();

    // 1. Non-empty generation: seeding is once-only and cannot be replayed.
    const replay = await harness([ownerApproval(request)]);
    try {
      await seed(replay);
      await expect(seed(replay)).rejects.toThrow(SeedRefusedError);
      await expect(seed(replay)).rejects.toThrow(/already holds 11 record\(s\); seeding is once-only/);
    } finally {
      await replay.ledger.close();
    }

    // 2. No approval in the channel.
    const none = await harness([]);
    try {
      await expect(seed(none)).rejects.toThrow(/Protected approval record is missing/);
      expect((await none.ledger.readGeneration(0)).records).toHaveLength(0);
    } finally {
      await none.ledger.close();
    }

    // 3. Approval scope differs from request scope.
    const widened = await harness([ownerApproval(request, { exactScope: ['EL-06=accepted'] })]);
    try {
      await expect(seed(widened)).rejects.toThrow(/mismatched, widened, inherited, or bound to another request/);
    } finally {
      await widened.ledger.close();
    }

    // 4. Approval digest mismatch (forged material).
    const forged = await harness([ownerApproval(request, { requestDigest: 'e'.repeat(64) })]);
    try {
      await expect(forged.channel.read(APPROVAL_ID)).resolves.not.toBeNull();
      await expect(seed(forged)).rejects.toThrow(/mismatched, widened, inherited, or bound to another request/);
    } finally {
      await forged.ledger.close();
    }

    // 5. Approval already consumed.
    const consumed = await harness([ownerApproval(request, {
      consumptionState: 'consumed', consumedAt: NOW, consumptionId: 'consumption:earlier',
    })]);
    try {
      await expect(seed(consumed)).rejects.toThrow(/revoked, consumed, or already present in protected history/);
    } finally {
      await consumed.ledger.close();
    }

    // 6. Approval expired.
    const expired = await harness([ownerApproval(request, {
      issuedAt: '2026-07-15T09:00:00.000Z', expiresAt: '2026-07-15T11:30:00.000Z',
    })]);
    try {
      await expect(seed(expired)).rejects.toThrow(/Approval is not currently valid/);
    } finally {
      await expired.ledger.close();
    }

    // 7. Any invalid record refuses all.
    const invalid = await harness([ownerApproval(request)]);
    try {
      await expect(seedAcceptanceLedger({
        ledger: invalid.ledger, channel: invalid.channel,
        catalog: { ...CATALOG, features: [{ id: 'EL-00', bootstrapStatus: 'invented' }] },
        repository: REPOSITORY, now: NOW, createdAt: CREATED_AT, approvalId: APPROVAL_ID,
      })).rejects.toThrow();
      expect((await invalid.ledger.readGeneration(0)).records).toHaveLength(0);
    } finally {
      await invalid.ledger.close();
    }

    // All seven conditions in the design record's table are covered above.
    // Only two of them are seeding's own refusals; the other five are
    // approval-policy judgements and arrive as ProtectedPolicyError, which is
    // the design working rather than a gap. Coverage is proven by the cases
    // above, never by the size of this list.
    expect(SEED_REFUSAL_CLASSES).toEqual(['non_empty_generation', 'invalid_record']);
  });

  it('seed: a revoked approval is refused', async () => {
    const request = seedRequest();
    const h = await harness([ownerApproval(request, {
      consumptionState: 'revoked', revokedAt: NOW, revocationReason: 'owner withdrew activation',
    })]);
    try {
      await expect(seed(h)).rejects.toThrow(/revoked, consumed, or already present in protected history/);
    } finally {
      await h.ledger.close();
    }
  });

  it('seed: a repository moved after the owner authored the approval is refused', async () => {
    // The seeder derives the request precondition and the current observation
    // from one observation, so the request itself can never present a stale
    // precondition. The binding that actually protects activation is the
    // approval's: material the owner authored against one repository state does
    // not authorize a seed against another.
    const request = seedRequest();
    const h = await harness([ownerApproval(request)]);
    try {
      await expect(seedAcceptanceLedger({
        ledger: h.ledger, channel: h.channel, catalog: CATALOG,
        repository: { ...REPOSITORY, headCommit: 'f'.repeat(40) },
        now: NOW, createdAt: CREATED_AT, approvalId: APPROVAL_ID,
      })).rejects.toThrow(/mismatched, widened, inherited, or bound to another request/);
      expect((await h.ledger.readGeneration(0)).records).toHaveLength(0);
    } finally {
      await h.ledger.close();
    }
  });

  it('seed: controller cannot author its own approval', async () => {
    // The controller composes the request; the channel is the only source of
    // authorization. With the channel empty, there is no path to a seeded
    // ledger — no default, no synthesized record, no fallback.
    const h = await harness([]);
    try {
      await expect(seed(h)).rejects.toThrow(/Protected approval record is missing/);
      expect(admissibleLedgerCeremonies(await h.ledger.readGeneration(0))).toEqual(['seeding']);
    } finally {
      await h.ledger.close();
    }
  });

  it('seed: all-or-nothing append', async () => {
    const request = seedRequest();
    const h = await harness([ownerApproval(request)]);
    try {
      // A refused seed leaves no file at all rather than a partial one.
      await expect(seedAcceptanceLedger({
        ledger: h.ledger, channel: h.channel, catalog: CATALOG,
        repository: { ...REPOSITORY, clean: true },
        now: NOW, createdAt: CREATED_AT, approvalId: APPROVAL_ID,
      })).rejects.toThrow();
      await expect(readFile(h.ledger.generationPath(0), 'utf8')).rejects.toThrow(/ENOENT/);

      const result = await seed(h);
      const bytes = await readFile(h.ledger.generationPath(0), 'utf8');
      expect(bytes.split('\n').filter(line => line.length > 0)).toHaveLength(11);
      expect(result.records.map(record => record.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    } finally {
      await h.ledger.close();
    }
  });

  it('seed: builds no synthetic workflow history', async () => {
    const request = seedRequest();
    const h = await harness([ownerApproval(request)]);
    try {
      const result = await seed(h);
      // Every record is a direct acceptance record carrying human authority.
      // None is derived from a transition, decision, or workflow snapshot.
      expect(result.records.every(record => record.kind === 'acceptance')).toBe(true);
      const bytes = await readFile(h.ledger.generationPath(0), 'utf8');
      for (const forbidden of ['selected', 'preparing', 'running', 'verifying', 'awaiting_review', 'transition', 'decision']) {
        expect(bytes).not.toContain(forbidden);
      }
    } finally {
      await h.ledger.close();
    }
  });

  it('seed: scope enumerates each feature exactly once and stays within the protected bound', () => {
    const pairs = catalogStatusPairs(CATALOG);
    expect(pairs).toHaveLength(11);
    expect(seedScope(pairs)).toHaveLength(11);
    expect(seedScope(pairs).length).toBeLessThanOrEqual(64);
    expect(() => seedScope([...pairs, { featureId: 'EL-10', status: 'accepted' }]))
      .toThrow(/must name each feature exactly once/);
  });
});

describe('EL-10 protected approval channel', () => {
  it('approval_channel: reads owner-authored material from the protected external channel', async () => {
    const request = seedRequest();
    const approval = ownerApproval(request);
    const h = await harness([approval]);
    try {
      expect(h.channel.location).toBe('protected_external');
      await expect(h.channel.read(APPROVAL_ID)).resolves.toMatchObject({ id: APPROVAL_ID, issuer: 'owner:darian' });
      await expect(h.channel.read('approval:absent')).resolves.toBeNull();
      expect(h.channel.reads).toBe(2);
    } finally {
      await h.ledger.close();
    }
  });

  it('approval_channel: an absent channel file reads as no approval rather than an error', async () => {
    const base = await mkdtemp(join(tmpdir(), 'trellis-el10-channel-'));
    temporary.push(base);
    const worktree = join(base, 'worktree');
    await mkdir(worktree, { recursive: true });
    const channel = await FileProtectedApprovalChannel.open({
      channelDirectory: join(base, 'protected', 'empty-channel'), worktree,
    });
    await expect(channel.read(APPROVAL_ID)).resolves.toBeNull();
  });

  it('approval_channel: refuses a channel inside the assigned worktree', async () => {
    const base = await mkdtemp(join(tmpdir(), 'trellis-el10-channel-'));
    temporary.push(base);
    const worktree = join(base, 'worktree');
    await mkdir(worktree, { recursive: true });
    await expect(FileProtectedApprovalChannel.open({
      channelDirectory: join(worktree, 'approvals'), worktree,
    })).rejects.toThrow(/must not be inside the assigned worktree/);
  });

  it('approval_channel: refuses duplicate identifiers and malformed material', async () => {
    const request = seedRequest();
    const approval = ownerApproval(request);
    const duplicate = await harness([approval, approval]);
    try {
      await expect(duplicate.channel.read(APPROVAL_ID)).rejects.toThrow(ApprovalChannelError);
      await expect(duplicate.channel.read(APPROVAL_ID)).rejects.toThrow(/duplicate approval identifiers/);
    } finally {
      await duplicate.ledger.close();
    }

    const malformed = await harness([]);
    try {
      await writeFile(join(malformed.channelDirectory, APPROVAL_CHANNEL_FILE), '{ not json', 'utf8');
      await expect(malformed.channel.read(APPROVAL_ID)).rejects.toThrow(/not valid JSON/);
    } finally {
      await malformed.ledger.close();
    }
  });
});
