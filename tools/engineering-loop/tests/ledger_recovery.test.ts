import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AcceptanceLedger,
  LEDGER_CEREMONIES,
  classifyLedgerGeneration,
  ledgerRecordDigest,
  parseLedgerGeneration,
  resolveFeatureStatus,
  serializeLedgerRecord,
  type LedgerRecord,
} from '../src/acceptance_ledger';
import { APPROVAL_CHANNEL_FILE, FileProtectedApprovalChannel } from '../src/approval_channel';
import {
  PROTECTED_ACTIONS,
  PROTECTED_POLICY_SCHEMA_VERSION,
  createProtectedApprovalRecord,
  protectedRequestDigest,
  type ProtectedActionRequest,
  type ProtectedApprovalRecord,
} from '../src/policy';
import {
  LedgerRecoveryRefusedError,
  buildGenesisRequest,
  buildLedgerRecoveryRequest,
  recoverLedgerContent,
  reGenesisLedger,
  reconciliationScopeItem,
} from '../src/ledger_recovery';
import { buildSeedRequest, catalogStatusPairs, seedAcceptanceLedger } from '../src/seed';
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

async function harness(): Promise<Harness> {
  const base = await mkdtemp(join(tmpdir(), 'trellis-el10-recovery-'));
  temporary.push(base);
  const worktree = join(base, 'worktree');
  await mkdir(worktree, { recursive: true });
  const channelDirectory = join(base, 'protected', 'channel');
  // validateProtectedStateRoot refuses pre-existing roots that grant group or
  // other permissions on POSIX, so the fixture must pre-create at 0o700.
  await mkdir(channelDirectory, { recursive: true, mode: 0o700 });
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

const SEED_APPROVAL_ID = 'approval:seed';

async function seeded(h: Harness): Promise<void> {
  const request = buildSeedRequest({
    pairs: catalogStatusPairs(CATALOG),
    repository: REPOSITORY,
    createdAt: CREATED_AT,
    approvalId: SEED_APPROVAL_ID,
  });
  await writeApprovals(h, [ownerApproval(request)]);
  await seedAcceptanceLedger({
    ledger: h.ledger, channel: h.channel, catalog: CATALOG, repository: REPOSITORY,
    now: NOW, createdAt: CREATED_AT, approvalId: SEED_APPROVAL_ID,
  });
}

const RECOVERY_SCOPE = [{ featureId: 'EL-07', status: 'planned' as const, supersedes: [2] }];

function recoveryInput(h: Harness, approvalId = 'approval:recovery') {
  return {
    ledger: h.ledger,
    channel: h.channel,
    catalog: CATALOG,
    repository: REPOSITORY,
    scope: RECOVERY_SCOPE,
    issuer: 'owner:darian',
    signatureReference: 'protected://signatures/el10-recovery.sig',
    evidenceReference: 'protected://evidence/el10-recovery.json',
    evidenceDigest: 'd'.repeat(64),
    reason: 'EL-07 was recorded blocked against the wrong generation.',
    now: NOW,
    createdAt: CREATED_AT,
    approvalId,
  };
}

describe('EL-10 ledger recovery ceremonies', () => {
  it('ledger_recovery: disjoint ceremony predicates', async () => {
    const h = await harness();
    try {
      // Empty and validating: seeding only.
      expect(classifyLedgerGeneration(await h.ledger.readGeneration(0))).toBe('seeding');
      await seeded(h);
      // Non-empty and validating: append-superseding only.
      expect(classifyLedgerGeneration(await h.ledger.readGeneration(0))).toBe('ledger_recovery');

      // Broken chain: re-genesis only.
      const state = await h.ledger.readGeneration(0);
      const broken = parseLedgerGeneration(0, serializeLedgerRecord(state.records[1]));
      expect(classifyLedgerGeneration(broken)).toBe('re_genesis');

      expect(LEDGER_CEREMONIES).toHaveLength(3);
      expect(new Set(LEDGER_CEREMONIES).size).toBe(3);
    } finally {
      await h.ledger.close();
    }
  });

  it('ledger_recovery: content reconciliation ceremony', async () => {
    const h = await harness();
    try {
      await seeded(h);
      const before = await readFile(h.ledger.generationPath(0), 'utf8');
      expect(resolveFeatureStatus(await h.ledger.readGeneration(0)).statuses.get('EL-07')).toBe('blocked');

      const request = buildLedgerRecoveryRequest({
        scope: RECOVERY_SCOPE, repository: REPOSITORY, createdAt: CREATED_AT, approvalId: 'approval:recovery',
      });
      expect(request.action).toBe('ledger_recovery');
      await writeApprovals(h, [ownerApproval(request)]);

      const result = await recoverLedgerContent(recoveryInput(h));
      expect(result.records).toHaveLength(4);
      expect(result.reconciliation.issuer).toBe('owner:darian');
      expect(result.reconciliation.recordDigest).toMatch(/^[0-9a-f]{64}$/);

      // The superseded record is marked, never mutated: prior bytes survive.
      const after = await readFile(h.ledger.generationPath(0), 'utf8');
      expect(after.startsWith(before)).toBe(true);

      const resolved = resolveFeatureStatus(await h.ledger.readGeneration(0));
      expect(resolved.statuses.get('EL-07')).toBe('planned');
      expect(resolved.recordCount).toBe(4);
      const reconciliation = (await h.ledger.readGeneration(0)).records[3];
      expect(reconciliation.kind).toBe('reconciliation');
      expect(reconciliation.kind === 'reconciliation' && reconciliation.supersedes).toEqual([2]);
    } finally {
      await h.ledger.close();
    }
  });

  it('ledger_recovery: append-superseding is refused on a broken chain', async () => {
    const h = await harness();
    try {
      await seeded(h);
      const state = await h.ledger.readGeneration(0);
      // Break the integrity chain by dropping the first record.
      await writeFile(
        h.ledger.generationPath(0),
        state.records.slice(1).map(serializeLedgerRecord).join(''),
        'utf8'
      );
      const request = buildLedgerRecoveryRequest({
        scope: RECOVERY_SCOPE, repository: REPOSITORY, createdAt: CREATED_AT, approvalId: 'approval:recovery',
      });
      await writeApprovals(h, [ownerApproval(request)]);

      await expect(recoverLedgerContent(recoveryInput(h))).rejects.toThrow(LedgerRecoveryRefusedError);
      await expect(recoverLedgerContent(recoveryInput(h)))
        .rejects.toThrow(/successor digest would inherit or mask the break/);
    } finally {
      await h.ledger.close();
    }
  });

  it('ledger_recovery: append-superseding is refused on an empty generation', async () => {
    const h = await harness();
    try {
      const request = buildLedgerRecoveryRequest({
        scope: RECOVERY_SCOPE, repository: REPOSITORY, createdAt: CREATED_AT, approvalId: 'approval:recovery',
      });
      await writeApprovals(h, [ownerApproval(request)]);
      await expect(recoverLedgerContent(recoveryInput(h))).rejects.toThrow(/is empty; there is no content to reconcile/);
    } finally {
      await h.ledger.close();
    }
  });

  it('ledger_recovery: reconciliation requires owner approval and refuses an absent sequence', async () => {
    const h = await harness();
    try {
      await seeded(h);
      // No approval material in the channel.
      await expect(recoverLedgerContent(recoveryInput(h))).rejects.toThrow(/Protected approval record is missing/);

      const absent = { ...recoveryInput(h), scope: [{ featureId: 'EL-07', status: 'planned' as const, supersedes: [99] }] };
      await expect(recoverLedgerContent(absent)).rejects.toThrow(/names sequence 99, which is absent/);
    } finally {
      await h.ledger.close();
    }
  });

  it('ledger_recovery: re-genesis ceremony', async () => {
    const h = await harness();
    try {
      await seeded(h);
      const state = await h.ledger.readGeneration(0);
      const corruptBytes = state.records.slice(1).map(serializeLedgerRecord).join('');
      await writeFile(h.ledger.generationPath(0), corruptBytes, 'utf8');
      expect(classifyLedgerGeneration(await h.ledger.readGeneration(0))).toBe('re_genesis');

      const breach = (await h.ledger.readGeneration(0)).breach;
      const genesisRequest = buildGenesisRequest({
        corruptGeneration: 0, newGeneration: 1, breach: breach!,
        repository: REPOSITORY, createdAt: CREATED_AT, approvalId: 'approval:genesis',
      });
      const seedRequest = buildSeedRequest({
        pairs: catalogStatusPairs(CATALOG), repository: REPOSITORY,
        createdAt: CREATED_AT, approvalId: 'approval:reseed',
      });
      await writeApprovals(h, [ownerApproval(genesisRequest), ownerApproval(seedRequest)]);

      const result = await reGenesisLedger({
        ledger: h.ledger, channel: h.channel, catalog: CATALOG, repository: REPOSITORY,
        issuer: 'owner:darian',
        signatureReference: 'protected://signatures/el10-genesis.sig',
        reconstructionBasis: 'Reconstructed from the merged pull-request ratification record for EL-00 through EL-06.',
        now: NOW, createdAt: CREATED_AT,
        genesisApprovalId: 'approval:genesis', seedApprovalId: 'approval:reseed',
      });

      expect(result.corruptGeneration).toBe(0);
      expect(result.newGeneration).toBe(1);
      expect(result.breach.reason).toBe('missing_sequence');

      // The new generation opens with a signed genesis record naming the break.
      const fresh = await h.ledger.readGeneration(1);
      expect(fresh.integrity).toBe('valid');
      const genesis = fresh.records[0];
      expect(genesis.kind).toBe('genesis');
      if (genesis.kind === 'genesis') {
        expect(genesis.supersededGeneration).toBe(0);
        expect(genesis.expectedDigest).toBe(result.breach.expectedDigest);
        expect(genesis.observedDigest).toBe(result.breach.observedDigest);
        expect(genesis.reconstructionBasis).toContain('Reconstructed from the merged pull-request');
        expect(genesis.issuer).toBe('owner:darian');
      }
      expect(fresh.records).toHaveLength(4);
      expect(resolveFeatureStatus(fresh).acceptedFeatureIds).toEqual(['EL-00', 'EL-06']);
      expect(await h.ledger.currentGeneration()).toBe(1);

      // The corrupt generation is retained read-only and stays resolvable as history.
      expect(await readFile(h.ledger.generationPath(0), 'utf8')).toBe(corruptBytes);
      expect((await h.ledger.readGeneration(0)).integrity).toBe('broken');
      expect(await h.ledger.listGenerations()).toEqual([0, 1]);
    } finally {
      await h.ledger.close();
    }
  });

  it('ledger_recovery: a truncated tail is named truthfully, never coerced to record 0', async () => {
    const h = await harness();
    try {
      await seeded(h);
      // Truncate the final newline: the break is the unterminated tail, which
      // has no record sequence of its own. Record 0 is intact, so a genesis
      // record claiming a break there would be a false, permanent, signed
      // statement.
      const bytes = await readFile(h.ledger.generationPath(0), 'utf8');
      await writeFile(h.ledger.generationPath(0), bytes.slice(0, bytes.length - 1), 'utf8');
      const state = await h.ledger.readGeneration(0);
      expect(state.breach?.reason).toBe('partial_append');
      expect(state.breach?.sequence).toBe(-1);

      const genesisRequest = buildGenesisRequest({
        corruptGeneration: 0, newGeneration: 1, breach: state.breach!,
        repository: REPOSITORY, createdAt: CREATED_AT, approvalId: 'approval:genesis',
      });
      // The approved scope must say the same thing the record will store.
      expect(genesisRequest.exactScope).toContain('break_point=truncated_tail');
      expect(genesisRequest.exactScope).toContain('break_reason=partial_append');

      const seedRequest = buildSeedRequest({
        pairs: catalogStatusPairs(CATALOG), repository: REPOSITORY,
        createdAt: CREATED_AT, approvalId: 'approval:reseed',
      });
      await writeApprovals(h, [ownerApproval(genesisRequest), ownerApproval(seedRequest)]);

      const result = await reGenesisLedger({
        ledger: h.ledger, channel: h.channel, catalog: CATALOG, repository: REPOSITORY,
        issuer: 'owner:darian', signatureReference: 'protected://sig',
        reconstructionBasis: 'Reconstructed from the merged ratification record.',
        now: NOW, createdAt: CREATED_AT,
        genesisApprovalId: 'approval:genesis', seedApprovalId: 'approval:reseed',
      });

      const genesis = (await h.ledger.readGeneration(1)).records[0];
      expect(genesis.kind).toBe('genesis');
      if (genesis.kind === 'genesis') {
        // null, not 0: record 0 was intact and must not be accused.
        expect(genesis.breakPointSequence).toBeNull();
        expect(genesis.breakReason).toBe('partial_append');
      }
      expect(result.newGeneration).toBe(1);
    } finally {
      await h.ledger.close();
    }
  });

  it('ledger_recovery: re-genesis is refused on an intact chain', async () => {
    const h = await harness();
    try {
      await seeded(h);
      await expect(reGenesisLedger({
        ledger: h.ledger, channel: h.channel, catalog: CATALOG, repository: REPOSITORY,
        issuer: 'owner:darian', signatureReference: 'protected://sig', reconstructionBasis: 'basis',
        now: NOW, createdAt: CREATED_AT,
        genesisApprovalId: 'approval:genesis', seedApprovalId: 'approval:reseed',
      })).rejects.toThrow(/has an intact integrity chain; re-genesis is refused/);
    } finally {
      await h.ledger.close();
    }
  });

  it('ledger_recovery: ledger_recovery is a protected action distinct from acceptance_change', () => {
    expect(PROTECTED_ACTIONS).toContain('ledger_recovery');
    expect(PROTECTED_ACTIONS).toContain('acceptance_change');
    expect(PROTECTED_ACTIONS.indexOf('ledger_recovery')).not.toBe(PROTECTED_ACTIONS.indexOf('acceptance_change'));
    // Distinct actions keep the three refusal predicates mechanically checkable
    // without a mode flag.
    expect(reconciliationScopeItem({ featureId: 'EL-07', status: 'planned', supersedes: [2, 1] }))
      .toBe('EL-07=planned:supersedes=1,2');
  });
});
