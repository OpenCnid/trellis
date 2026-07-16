import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AcceptanceLedger,
  admissibleLedgerCeremonies,
  parseLedgerGeneration,
  resolveFeatureStatus,
  serializeLedgerRecord,
} from '../src/acceptance_ledger';
import { APPROVAL_CHANNEL_FILE, FileProtectedApprovalChannel } from '../src/approval_channel';
import {
  PROTECTED_POLICY_SCHEMA_VERSION,
  createProtectedApprovalRecord,
  protectedRequestDigest,
  type ProtectedActionRequest,
  type ProtectedApprovalRecord,
} from '../src/policy';
import {
  ACCEPTANCE_CHANGE_REFUSAL_CLASSES,
  AcceptanceChangeRefusedError,
  acceptanceChangeScope,
  buildAcceptanceChangeRequest,
  canonicalStatusPairs,
  recordAcceptanceChange,
} from '../src/acceptance_change';
import { SeedRefusedError, buildSeedRequest, catalogStatusPairs, seedAcceptanceLedger } from '../src/seed';
import type { RepositoryObservation } from '../src/domain';

const NOW = '2026-07-15T12:00:00.000Z';
const CREATED_AT = '2026-07-15T10:00:00.000Z';
const SEED_APPROVAL_ID = 'approval:el10-activation';
const CHANGE_APPROVAL_ID = 'approval:el11-acceptance-change';

const REPOSITORY: RepositoryObservation = {
  repositoryId: 'repo:trellis',
  worktreeId: 'worktree:el11',
  branch: 'implement-el11-approval-reachability',
  baseCommit: '272a18eceb078650b96800faa4faea7e2ac532ce',
  headCommit: '272a18eceb078650b96800faa4faea7e2ac532ce',
  clean: true,
};

/**
 * The eleven activation pairs, shaped like the catalog was at activation. The
 * status document form is seeding's input; the live catalog no longer carries
 * status, which is the point of the migration.
 */
const SEED_CATALOG = {
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

/** The migrated catalog: immutable definitions, no mutable status. */
const CATALOG = {
  schemaVersion: 1,
  program: 'trellis-engineering-loop',
  statusAuthority: 'protected_controller_state',
  features: SEED_CATALOG.features.map(feature => ({ id: feature.id, order: 0 })),
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

async function harness(): Promise<Harness> {
  const base = await mkdtemp(join(tmpdir(), 'trellis-el11-change-'));
  temporary.push(base);
  const worktree = join(base, 'worktree');
  await mkdir(worktree, { recursive: true });
  const channelDirectory = join(base, 'protected', 'channel');
  await mkdir(channelDirectory, { recursive: true });
  await writeFile(join(channelDirectory, APPROVAL_CHANNEL_FILE), '[]', 'utf8');
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

function ownerApproval(
  request: ProtectedActionRequest,
  overrides: Partial<Omit<ProtectedApprovalRecord, 'recordDigest'>> = {}
): ProtectedApprovalRecord {
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
    ...overrides,
  });
}

async function writeApprovals(h: Harness, approvals: readonly unknown[]): Promise<void> {
  await writeFile(join(h.channelDirectory, APPROVAL_CHANNEL_FILE), JSON.stringify(approvals, null, 2), 'utf8');
}

/** Brings the ledger to the state the real one is in: generation 0, eleven records, validating. */
async function seeded(h: Harness): Promise<void> {
  const request = buildSeedRequest({
    pairs: catalogStatusPairs(SEED_CATALOG),
    repository: REPOSITORY,
    createdAt: CREATED_AT,
    approvalId: SEED_APPROVAL_ID,
  });
  await writeApprovals(h, [ownerApproval(request)]);
  await seedAcceptanceLedger({
    ledger: h.ledger, channel: h.channel, catalog: SEED_CATALOG, repository: REPOSITORY,
    now: NOW, createdAt: CREATED_AT, approvalId: SEED_APPROVAL_ID,
  });
}

const PAIRS = [
  { featureId: 'EL-10', status: 'accepted' as const },
  { featureId: 'EL-07', status: 'planned' as const },
];

function changeRequest(pairs = PAIRS, approvalId = CHANGE_APPROVAL_ID): ProtectedActionRequest {
  return buildAcceptanceChangeRequest({
    pairs, repository: REPOSITORY, createdAt: CREATED_AT, approvalId,
  });
}

function changeInput(h: Harness, pairs = PAIRS, approvalId = CHANGE_APPROVAL_ID) {
  return {
    ledger: h.ledger,
    channel: h.channel,
    catalog: CATALOG,
    repository: REPOSITORY,
    pairs,
    now: NOW,
    createdAt: CREATED_AT,
    approvalId,
  };
}

/** Seeds, then authorizes the steady-state change the tests below exercise. */
async function seededAndAuthorized(h: Harness, pairs = PAIRS): Promise<void> {
  await seeded(h);
  const seedRequest = buildSeedRequest({
    pairs: catalogStatusPairs(SEED_CATALOG), repository: REPOSITORY,
    createdAt: CREATED_AT, approvalId: SEED_APPROVAL_ID,
  });
  await writeApprovals(h, [ownerApproval(seedRequest), ownerApproval(changeRequest(pairs))]);
}

describe('EL-11 steady-state acceptance change', () => {
  it('acceptance_change: records an owner-approved status change against a non-empty generation', async () => {
    const h = await harness();
    try {
      await seededAndAuthorized(h);
      const before = await h.ledger.readGeneration(0);
      expect(before.records).toHaveLength(11);
      expect(resolveFeatureStatus(before).statuses.get('EL-10')).toBe('planned');

      const result = await recordAcceptanceChange(changeInput(h));

      // The pairs are canonicalized, so the scope and the appended records carry
      // one order regardless of the order the owner named them in.
      expect(result.scope).toEqual(['EL-07=planned', 'EL-10=accepted']);
      expect(result.appended).toHaveLength(2);
      expect(result.appended.map(record => record.sequence)).toEqual([11, 12]);
      expect(result.appended.every(record => record.kind === 'acceptance')).toBe(true);
      expect(result.appended.every(record => record.actor === 'human')).toBe(true);
      // One approval covers the whole change, exactly as seeding's one covers all
      // eleven pairs: approving the scope is approving each claim individually.
      expect(new Set(result.appended.map(record => record.approvalId))).toEqual(new Set([CHANGE_APPROVAL_ID]));

      const after = await h.ledger.readGeneration(0);
      const resolved = resolveFeatureStatus(after);
      expect(resolved.statuses.get('EL-10')).toBe('accepted');
      expect(resolved.statuses.get('EL-07')).toBe('planned');
      expect(resolved.acceptedFeatureIds).toEqual([
        'EL-00', 'EL-01', 'EL-02', 'EL-03', 'EL-04', 'EL-05', 'EL-06', 'EL-10',
      ]);
    } finally {
      await h.ledger.close();
    }
  });

  it('acceptance_change: supersedes by replay and leaves the superseded records untouched', async () => {
    const h = await harness();
    try {
      await seededAndAuthorized(h);
      const before = await h.ledger.readGeneration(0);
      const originalBytes = await readFile(h.ledger.generationPath(0), 'utf8');

      await recordAcceptanceChange(changeInput(h));

      const after = await h.ledger.readGeneration(0);
      // Append-only by bytes, not merely by intent: the previous file is a strict
      // prefix of the next one, so no earlier record was mutated, deleted, or
      // rewritten to make room for the change.
      const nextBytes = await readFile(h.ledger.generationPath(0), 'utf8');
      expect(nextBytes.startsWith(originalBytes)).toBe(true);
      expect(after.records).toHaveLength(13);
      expect(after.integrity).toBe('valid');

      // The superseded EL-10=planned record is still present and byte-identical.
      const superseded = after.records[10];
      expect(superseded).toEqual(before.records[10]);
      expect(superseded.kind).toBe('acceptance');
      if (superseded.kind === 'acceptance') expect(superseded.status).toBe('planned');

      // Resolution takes the last record per featureId; both records for EL-10
      // survive in the chain and the later one wins by ordinary replay.
      const el10 = after.records.filter(record => record.kind !== 'genesis' && record.featureId === 'EL-10');
      expect(el10).toHaveLength(2);
      expect(resolveFeatureStatus(after).statuses.get('EL-10')).toBe('accepted');
    } finally {
      await h.ledger.close();
    }
  });

  it('acceptance_change: refusal matrix', async () => {
    // 1. Empty generation: there is no history to change; seeding applies.
    const empty = await harness();
    try {
      await expect(recordAcceptanceChange(changeInput(empty))).rejects.toThrow(AcceptanceChangeRefusedError);
      await expect(recordAcceptanceChange(changeInput(empty)))
        .rejects.toThrow(/is empty; there is no history to change/);
      expect((await empty.ledger.readGeneration(0)).records).toHaveLength(0);
    } finally {
      await empty.ledger.close();
    }

    // 2. Broken chain: appending would inherit or mask the break.
    const broken = await harness();
    try {
      await seededAndAuthorized(broken);
      const state = await broken.ledger.readGeneration(0);
      await writeFile(broken.ledger.generationPath(0), serializeLedgerRecord(state.records[1]), 'utf8');
      await expect(recordAcceptanceChange(changeInput(broken)))
        .rejects.toThrow(/has a broken integrity chain.*Re-genesis under EL-REQ-BOOT-007 is the only route/s);
    } finally {
      await broken.ledger.close();
    }

    // 3. A feature the catalog does not define.
    const unknown = await harness();
    try {
      await seededAndAuthorized(unknown, [{ featureId: 'EL-99', status: 'accepted' }]);
      await expect(recordAcceptanceChange(changeInput(unknown, [{ featureId: 'EL-99', status: 'accepted' }])))
        .rejects.toThrow(/names 1 feature\(s\) the catalog does not define: EL-99/);
      expect((await unknown.ledger.readGeneration(0)).records).toHaveLength(11);
    } finally {
      await unknown.ledger.close();
    }

    // 4. No approval in the channel.
    const none = await harness();
    try {
      await seeded(none);
      await expect(recordAcceptanceChange(changeInput(none))).rejects.toThrow(/Protected approval record is missing/);
      expect((await none.ledger.readGeneration(0)).records).toHaveLength(11);
    } finally {
      await none.ledger.close();
    }

    // 5. Approval scope narrower than the request scope.
    const widened = await harness();
    try {
      await seeded(widened);
      await writeApprovals(widened, [ownerApproval(changeRequest(), { exactScope: ['EL-10=accepted'] })]);
      await expect(recordAcceptanceChange(changeInput(widened)))
        .rejects.toThrow(/mismatched, widened, inherited, or bound to another request/);
    } finally {
      await widened.ledger.close();
    }

    // 6. Forged approval material: the digest does not match the request.
    const forged = await harness();
    try {
      await seeded(forged);
      await writeApprovals(forged, [ownerApproval(changeRequest(), { requestDigest: 'e'.repeat(64) })]);
      await expect(recordAcceptanceChange(changeInput(forged)))
        .rejects.toThrow(/mismatched, widened, inherited, or bound to another request/);
    } finally {
      await forged.ledger.close();
    }

    // 7. Approval already consumed.
    const consumed = await harness();
    try {
      await seeded(consumed);
      await writeApprovals(consumed, [ownerApproval(changeRequest(), {
        consumptionState: 'consumed', consumedAt: NOW, consumptionId: 'consumption:earlier',
      })]);
      await expect(recordAcceptanceChange(changeInput(consumed)))
        .rejects.toThrow(/revoked, consumed, or already present in protected history/);
    } finally {
      await consumed.ledger.close();
    }

    // 8. Approval expired.
    const expired = await harness();
    try {
      await seeded(expired);
      await writeApprovals(expired, [ownerApproval(changeRequest(), {
        issuedAt: '2026-07-15T09:00:00.000Z', expiresAt: '2026-07-15T11:30:00.000Z',
      })]);
      await expect(recordAcceptanceChange(changeInput(expired))).rejects.toThrow(/Approval is not currently valid/);
    } finally {
      await expired.ledger.close();
    }

    // Only the refusals this ceremony decides are listed; the approval judgements
    // above belong to the accepted EL-06 policy and arrive as ProtectedPolicyError.
    expect(ACCEPTANCE_CHANGE_REFUSAL_CLASSES)
      .toEqual(['empty_generation', 'broken_chain', 'unknown_feature', 'invalid_record']);
  });

  it('acceptance_change: an approval cannot be replayed for a second change', async () => {
    const h = await harness();
    try {
      await seededAndAuthorized(h);
      await recordAcceptanceChange(changeInput(h));
      // Consumption is derived from replay: the appended records carry the
      // approvalId, so the same approval is already present in protected history.
      await expect(recordAcceptanceChange(changeInput(h)))
        .rejects.toThrow(/revoked, consumed, or already present in protected history/);
      expect((await h.ledger.readGeneration(0)).records).toHaveLength(13);
    } finally {
      await h.ledger.close();
    }
  });

  it('acceptance_change: seeding still refuses the non-empty generation it left behind', async () => {
    const h = await harness();
    try {
      await seededAndAuthorized(h);
      await recordAcceptanceChange(changeInput(h));
      // The steady-state path does not open a door for seeding. Seeding stays
      // once-only, and its refusal now names the ceremony that does apply.
      await expect(seedAcceptanceLedger({
        ledger: h.ledger, channel: h.channel, catalog: SEED_CATALOG, repository: REPOSITORY,
        now: NOW, createdAt: CREATED_AT, approvalId: SEED_APPROVAL_ID,
      })).rejects.toThrow(SeedRefusedError);
      await expect(seedAcceptanceLedger({
        ledger: h.ledger, channel: h.channel, catalog: SEED_CATALOG, repository: REPOSITORY,
        now: NOW, createdAt: CREATED_AT, approvalId: SEED_APPROVAL_ID,
      })).rejects.toThrow(/seeding is once-only.*EL-REQ-BOOT-008 steady_state_acceptance/s);
    } finally {
      await h.ledger.close();
    }
  });

  it('acceptance_change: builds no synthetic workflow history', async () => {
    const h = await harness();
    try {
      await seededAndAuthorized(h);
      await recordAcceptanceChange(changeInput(h));
      const bytes = await readFile(h.ledger.generationPath(0), 'utf8');
      // Reaching `accepted` by walking a fabricated transition sequence would
      // attest controller-observed events for runs that never occurred.
      for (const forbidden of ['selected', 'preparing', 'running', 'verifying', 'awaiting_review', 'transition', 'decision']) {
        expect(bytes).not.toContain(forbidden);
      }
    } finally {
      await h.ledger.close();
    }
  });

  it('acceptance_change: the request is order-independent and reproducible', async () => {
    // The request digest covers `exactScope`, and canonical JSON sorts object keys
    // but not array elements, so an unordered scope would make the same decision
    // digest differently depending on the order the owner typed the flags. The
    // approval would then match on scope (compared sorted) and fail on digest,
    // reporting a mismatch that had not happened.
    const forward = changeRequest([
      { featureId: 'EL-10', status: 'accepted' }, { featureId: 'EL-07', status: 'planned' },
    ]);
    const reversed = changeRequest([
      { featureId: 'EL-07', status: 'planned' }, { featureId: 'EL-10', status: 'accepted' },
    ]);
    expect(protectedRequestDigest(forward)).toBe(protectedRequestDigest(reversed));
    expect(forward.exactScope).toEqual(['EL-07=planned', 'EL-10=accepted']);
    expect(reversed.exactScope).toEqual(forward.exactScope);

    expect(canonicalStatusPairs([
      { featureId: 'EL-10', status: 'accepted' }, { featureId: 'EL-07', status: 'planned' },
    ])).toEqual([
      { featureId: 'EL-07', status: 'planned' }, { featureId: 'EL-10', status: 'accepted' },
    ]);

    // A different decision still digests differently: canonical ordering removes
    // an irrelevant degree of freedom, never a meaningful one.
    expect(protectedRequestDigest(changeRequest([{ featureId: 'EL-10', status: 'accepted' }])))
      .not.toBe(protectedRequestDigest(forward));
  });

  it('acceptance_change: scope grammar and identity match seeding', async () => {
    // EL-REQ-BOOT-008 reuses EL-REQ-BOOT-002's scope grammar, so an owner reads
    // one form. The request identity differs so an auditor can tell an ordinary
    // change from an activation seed without reconstructing the scope.
    expect(acceptanceChangeScope([{ featureId: 'EL-10', status: 'accepted' }])).toEqual(['EL-10=accepted']);
    const request = changeRequest();
    expect(request.action).toBe('acceptance_change');
    expect(request.executionMode).toBe('controller_effect');
    expect(request.automatic).toBe(false);
    expect(request.paidEstimate).toBeNull();
    expect(request.target).toBe('acceptance-ledger:acceptance-change');
    expect(request.featureId).toBe('EL-11');
    expect(request.workflowId).toBe('workflow:program-acceptance');
    expect(buildSeedRequest({
      pairs: catalogStatusPairs(SEED_CATALOG), repository: REPOSITORY,
      createdAt: CREATED_AT, approvalId: SEED_APPROVAL_ID,
    }).target).toBe('acceptance-ledger:generation-seed');
    // Same action, different target and scope, therefore different digests: a
    // seed approval can never authorize a steady-state change.
    expect(protectedRequestDigest(request)).not.toBe(protectedRequestDigest(buildSeedRequest({
      pairs: catalogStatusPairs(SEED_CATALOG), repository: REPOSITORY,
      createdAt: CREATED_AT, approvalId: SEED_APPROVAL_ID,
    })));
  });

  it('acceptance_change: the ledger stays a trust anchor across the change', async () => {
    const h = await harness();
    try {
      await seededAndAuthorized(h);
      await recordAcceptanceChange(changeInput(h));
      const bytes = await readFile(h.ledger.generationPath(0), 'utf8');
      // Re-parsed from the bytes on disk rather than from the in-memory result:
      // the chain the next reader validates is the one that matters.
      const reparsed = parseLedgerGeneration(0, bytes);
      expect(reparsed.integrity).toBe('valid');
      expect(reparsed.breach).toBeNull();
      expect(reparsed.records.map(record => record.sequence)).toEqual([...Array(13).keys()]);
      expect(admissibleLedgerCeremonies(reparsed)).toEqual(['steady_state_acceptance', 'ledger_recovery']);
    } finally {
      await h.ledger.close();
    }
  });

  it('acceptance_change: a repository moved after the owner authored the approval is refused', async () => {
    const h = await harness();
    try {
      await seededAndAuthorized(h);
      await expect(recordAcceptanceChange({
        ...changeInput(h),
        repository: { ...REPOSITORY, headCommit: 'f'.repeat(40) },
      })).rejects.toThrow(/mismatched, widened, inherited, or bound to another request/);
      expect((await h.ledger.readGeneration(0)).records).toHaveLength(11);
    } finally {
      await h.ledger.close();
    }
  });
});
