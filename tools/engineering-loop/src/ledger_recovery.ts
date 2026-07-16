import { z } from 'zod';
import {
  GENESIS_DIGEST,
  RepositoryObservationSchema,
  StableIdSchema,
  parseBoundary,
  type RepositoryObservation,
} from './domain.js';
import {
  PROTECTED_POLICY_SCHEMA_VERSION,
  PROTECTED_POLICY_VERSION,
  ProtectedActionRequestSchema,
  authorizeProtectedAction,
  type ProtectedActionRequest,
  type ProtectedApprovalChannel,
} from './policy.js';
import { appendSignedReconciliation, type SignedReconciliation } from './recovery.js';
import {
  AcceptanceLedger,
  FeatureStatusSchema,
  LedgerRecordSchema,
  MAX_LEDGER_GENERATIONS,
  PROGRAM_ACCEPTANCE_WORKFLOW_ID,
  catalogDigestOf,
  ledgerCeremonyAdmitted,
  ledgerRecordDigest,
  type LedgerBreach,
  type LedgerRecord,
} from './acceptance_ledger.js';
import { SEED_SESSION_ID, seedAcceptanceLedger, type CatalogStatusPair, type SeedResult } from './seed.js';
import { canonicalStatusPairs } from './acceptance_change.js';

/**
 * The two recovery ceremonies of SPEC 6.1 (EL-REQ-BOOT-006 and
 * EL-REQ-BOOT-007).
 *
 * A trust anchor shipped without a paired recovery ceremony is unrecoverable by
 * its own tooling once corrupt: seeding refuses a non-empty ledger, repair is
 * forbidden, and the only remaining route is hand-editing the protected file —
 * precisely the untrusted-side write the design exists to prevent.
 *
 * The two corruption cases do not share a ceremony, and the reason is
 * structural rather than stylistic:
 *
 * - Content corruption on a validating chain: the record is wrong but every
 *   digest links. The chain can carry its own correction, so recovery appends.
 * - Integrity-chain corruption: appending cannot correct it, because the
 *   successor's `previousDigest` would have to reference a corrupt predecessor
 *   and would inherit or mask the break. A broken anchor cannot sign its own
 *   replacement, so recovery is out of band.
 */

export class LedgerRecoveryRefusedError extends Error {
  constructor(message: string) {
    super(message.slice(0, 1_024));
    this.name = 'LedgerRecoveryRefusedError';
  }
}

export const ReconciliationScopeItemSchema = z.strictObject({
  featureId: StableIdSchema,
  status: FeatureStatusSchema,
  supersedes: z.array(z.number().int().nonnegative()).min(1).max(64),
});
export type ReconciliationScopeItem = z.infer<typeof ReconciliationScopeItemSchema>;

export function reconciliationScopeItem(item: ReconciliationScopeItem): string {
  return `${item.featureId}=${item.status}:supersedes=${[...item.supersedes].sort((a, b) => a - b).join(',')}`;
}

/**
 * The reconciliation scope in a canonical order, which is what makes the request
 * digest reproducible.
 *
 * `exactScope` order is digest-bearing while approval matching compares scope
 * sorted, so an owner who printed a request with two `--supersede` items and
 * recorded it with the items transposed would pass the scope check, fail the
 * digest check, and be refused for a mismatch that never happened — the exact
 * defect `canonicalStatusPairs` closed for the steady-state path. `supersedes`
 * inside each item is already canonical (`reconciliationScopeItem` sorts it), so
 * the item order is the remaining exposure.
 *
 * Duplicate feature identities are refused rather than sorted: a stable sort
 * keyed on `featureId` leaves two items naming the same feature in input order,
 * which would silently reopen the transposition hole — and two reconciliations
 * of one feature in one request are ambiguous under last-record-wins replay
 * anyway.
 */
export function canonicalReconciliationScope(
  items: readonly ReconciliationScopeItem[]
): readonly ReconciliationScopeItem[] {
  const parsed = items.map(item => parseBoundary(ReconciliationScopeItemSchema, item, 'reconciliation scope item'));
  if (new Set(parsed.map(item => item.featureId)).size !== parsed.length) {
    throw new LedgerRecoveryRefusedError('Reconciliation scope must name each feature exactly once');
  }
  return [...parsed].sort((left, right) => left.featureId.localeCompare(right.featureId, 'en'));
}

export interface LedgerRecoveryRequestInput {
  scope: readonly ReconciliationScopeItem[];
  repository: RepositoryObservation;
  createdAt: string;
  approvalId: string;
  requestId?: string;
  operationId?: string;
  sessionId?: string;
}

export function buildLedgerRecoveryRequest(input: LedgerRecoveryRequestInput): ProtectedActionRequest {
  const scope = canonicalReconciliationScope(input.scope).map(reconciliationScopeItem);
  return parseBoundary(ProtectedActionRequestSchema, {
    id: input.requestId ?? 'request:el10-ledger-recovery',
    schemaVersion: PROTECTED_POLICY_SCHEMA_VERSION,
    policyVersion: PROTECTED_POLICY_VERSION,
    createdAt: input.createdAt,
    workflowId: PROGRAM_ACCEPTANCE_WORKFLOW_ID,
    featureId: 'EL-10',
    sessionId: input.sessionId ?? SEED_SESSION_ID,
    action: 'ledger_recovery',
    executionMode: 'controller_effect',
    target: 'acceptance-ledger:content-reconciliation',
    exactScope: scope,
    repositoryPrecondition: parseBoundary(RepositoryObservationSchema, input.repository, 'recovery repository precondition'),
    approvalId: parseBoundary(StableIdSchema, input.approvalId, 'recovery approval identity'),
    operationId: input.operationId ?? 'operation:el10-ledger-recovery',
    attempt: 1,
    retryOf: null,
    automatic: false,
    paidEstimate: null,
    requestedLimitUsd: null,
  }, 'ledger recovery protected action request');
}

export interface LedgerRecoveryInput {
  ledger: AcceptanceLedger;
  channel: ProtectedApprovalChannel;
  catalog: unknown;
  repository: RepositoryObservation;
  scope: readonly ReconciliationScopeItem[];
  issuer: string;
  signatureReference: string;
  evidenceReference: string;
  evidenceDigest: string;
  reason: string;
  now: string;
  createdAt: string;
  approvalId: string;
  requestId?: string;
  operationId?: string;
  sessionId?: string;
  priorReconciliations?: readonly SignedReconciliation[];
}

export interface LedgerRecoveryResult {
  generation: number;
  records: readonly LedgerRecord[];
  reconciliation: SignedReconciliation;
  approvalId: string;
  consumptionId: string;
}

/**
 * EL-REQ-BOOT-006. Requires a non-empty generation whose chain validates, marks
 * the superseded sequences without mutating them, and rests on owner approval
 * read from the protected external channel and atomically consumed.
 */
export async function recoverLedgerContent(input: LedgerRecoveryInput): Promise<LedgerRecoveryResult> {
  const generation = await input.ledger.currentGeneration();
  const state = await input.ledger.readGeneration(generation);
  if (!ledgerCeremonyAdmitted(state, 'ledger_recovery')) {
    throw new LedgerRecoveryRefusedError(
      state.integrity === 'broken'
        ? `Generation ${generation} has a broken integrity chain; append-superseding is refused because a successor digest would inherit or mask the break. Re-genesis under EL-REQ-BOOT-007 is the only route.`
        : `Generation ${generation} is empty; there is no content to reconcile. Seeding under EL-REQ-BOOT-003 applies instead.`
    );
  }

  // The canonical order once, used for the request scope and the appended
  // records alike, so an auditor reading the approval against the ledger sees
  // one ordering rather than two.
  const scope = canonicalReconciliationScope(input.scope);
  const known = new Set(state.records.map(record => record.sequence));
  for (const item of scope) {
    for (const sequence of item.supersedes) {
      if (!known.has(sequence)) {
        throw new LedgerRecoveryRefusedError(
          `Reconciliation names sequence ${sequence}, which is absent from generation ${generation}.`
        );
      }
    }
  }

  const request = buildLedgerRecoveryRequest({
    scope,
    repository: input.repository,
    createdAt: input.createdAt,
    approvalId: input.approvalId,
    requestId: input.requestId,
    operationId: input.operationId,
    sessionId: input.sessionId,
  });
  const decision = await authorizeProtectedAction({
    request,
    channel: input.channel,
    now: input.now,
    consumedApprovalIds: await input.ledger.consumedApprovalIds(),
    currentRepository: input.repository,
  });
  if (decision.status !== 'authorized') {
    throw new LedgerRecoveryRefusedError(`Ledger recovery requires an authorized decision; observed '${decision.status}'.`);
  }

  const history = appendSignedReconciliation({
    priorHistory: input.priorReconciliations ?? [],
    record: {
      id: `reconciliation:${generation}:${decision.consumptionId}`,
      schemaVersion: 1,
      createdAt: input.createdAt,
      workflowId: PROGRAM_ACCEPTANCE_WORKFLOW_ID,
      featureId: 'EL-10',
      sessionId: input.sessionId ?? SEED_SESSION_ID,
      failureId: `failure:ledger-content:${generation}`,
      operationId: request.operationId,
      issuer: input.issuer,
      decision: 'confirmed_failed',
      evidenceReference: input.evidenceReference,
      evidenceDigest: input.evidenceDigest,
      signatureReference: input.signatureReference,
    },
  });
  const reconciliation = history[history.length - 1];

  const catalogDigest = catalogDigestOf(input.catalog);
  const records: LedgerRecord[] = [];
  let sequence = state.records.length;
  let previousDigest = ledgerRecordDigest(state.records[state.records.length - 1]);
  for (const item of scope) {
    const record = parseBoundary(LedgerRecordSchema, {
      kind: 'reconciliation',
      id: `reconciliation:${item.featureId}:${sequence}`,
      schemaVersion: 1,
      sequence,
      previousDigest,
      createdAt: input.createdAt,
      actor: 'human',
      approvalId: decision.approvalId,
      requestDigest: decision.requestDigest,
      featureId: item.featureId,
      status: item.status,
      catalogDigest,
      // Stored in the same order the approved scope string commits to, so the
      // durable record and the approval an auditor checks it against cannot
      // disagree.
      supersedes: [...item.supersedes].sort((a, b) => a - b),
      issuer: input.issuer,
      signatureReference: input.signatureReference,
      evidenceDigest: input.evidenceDigest,
      reason: input.reason,
    }, 'ledger reconciliation record');
    records.push(record);
    previousDigest = ledgerRecordDigest(record);
    sequence++;
  }

  const applied = await input.ledger.appendAll(generation, records);
  return {
    generation,
    records: applied.records,
    reconciliation,
    approvalId: decision.approvalId,
    consumptionId: decision.consumptionId as string,
  };
}

export interface ReGenesisInput {
  ledger: AcceptanceLedger;
  channel: ProtectedApprovalChannel;
  catalog: unknown;
  repository: RepositoryObservation;
  issuer: string;
  signatureReference: string;
  reconstructionBasis: string;
  now: string;
  createdAt: string;
  genesisApprovalId: string;
  seedApprovalId: string;
  seedRequestId?: string;
  seedOperationId?: string;
  sessionId?: string;
  /**
   * The `(featureId, status)` pairs of the owner's reconstruction basis.
   *
   * Left absent, the seed layer falls back to reading `catalog` as a status
   * document — which is how activation bootstrapped, and which the live
   * post-migration catalog refuses because `bootstrapStatus` no longer exists.
   * `SeedInput.pairs` said "a re-genesis caller supplies the pairs from the
   * owner's reconstruction basis instead" while this input had no field to
   * supply them through: prose describing required behavior with no way to
   * exercise it, the same defect shape this program keeps finding. Canonically
   * ordered before composition because scope order is digest-bearing and these
   * pairs arrive from an owner's command line.
   */
  pairs?: readonly CatalogStatusPair[];
}

export interface ReGenesisResult {
  corruptGeneration: number;
  newGeneration: number;
  breach: LedgerBreach;
  genesis: LedgerRecord;
  seed: SeedResult;
}

export function buildGenesisRequest(input: {
  corruptGeneration: number;
  newGeneration: number;
  breach: LedgerBreach;
  repository: RepositoryObservation;
  createdAt: string;
  approvalId: string;
  sessionId?: string;
}): ProtectedActionRequest {
  return parseBoundary(ProtectedActionRequestSchema, {
    id: `request:el10-re-genesis:${input.newGeneration}`,
    schemaVersion: PROTECTED_POLICY_SCHEMA_VERSION,
    policyVersion: PROTECTED_POLICY_VERSION,
    createdAt: input.createdAt,
    workflowId: PROGRAM_ACCEPTANCE_WORKFLOW_ID,
    featureId: 'EL-10',
    sessionId: input.sessionId ?? SEED_SESSION_ID,
    action: 'ledger_recovery',
    executionMode: 'controller_effect',
    target: `acceptance-ledger:re-genesis:${input.newGeneration}`,
    exactScope: [
      `supersede_generation=${input.corruptGeneration}`,
      // A truncated tail has no record sequence; the scope says so in the same
      // terms the genesis record stores, so the approval and the record cannot
      // disagree about where the break is.
      `break_point=${input.breach.sequence < 0 ? 'truncated_tail' : input.breach.sequence}`,
      `break_reason=${input.breach.reason}`,
      `expected_digest=${input.breach.expectedDigest}`,
      `observed_digest=${input.breach.observedDigest}`,
    ],
    repositoryPrecondition: parseBoundary(RepositoryObservationSchema, input.repository, 're-genesis repository precondition'),
    approvalId: parseBoundary(StableIdSchema, input.approvalId, 're-genesis approval identity'),
    operationId: `operation:el10-re-genesis:${input.newGeneration}`,
    attempt: 1,
    retryOf: null,
    automatic: false,
    paidEstimate: null,
    requestedLimitUsd: null,
  }, 're-genesis protected action request');
}

/**
 * EL-REQ-BOOT-007. Establishes a new generation out of band, retains the corrupt
 * generation read-only and resolvable as history, and opens the new generation
 * with a signed genesis record naming the break point, the expected and observed
 * digests, and the reconstruction basis.
 *
 * Re-genesis needs no new gate: a new generation is empty, so EL-REQ-BOOT-003's
 * refusal governs it unchanged and seeding applies as written. This is not a
 * privileged path around the seeding gate — it is the seeding gate, applied to a
 * fresh generation, with a genesis record explaining why that generation exists.
 *
 * Honest residual: the reconstruction basis is owner-supplied, and the corrupt
 * generation is evidence, not authority. Nothing here establishes that the
 * reconstruction is correct — only that it is owner-authorized, that the break is
 * named, and that the corrupt history survives for audit.
 */
export async function reGenesisLedger(input: ReGenesisInput): Promise<ReGenesisResult> {
  const corruptGeneration = await input.ledger.currentGeneration();
  const state = await input.ledger.readGeneration(corruptGeneration);
  if (!ledgerCeremonyAdmitted(state, 're_genesis')) {
    throw new LedgerRecoveryRefusedError(
      `Generation ${corruptGeneration} has an intact integrity chain; re-genesis is refused. ${
        state.records.length === 0
          ? 'The generation is empty, so seeding under EL-REQ-BOOT-003 applies.'
          : 'A status change is recorded by steady_state_acceptance under EL-REQ-BOOT-008, and content corruption on a validating chain is corrected by ledger_recovery under EL-REQ-BOOT-006.'
      }`
    );
  }
  const breach = state.breach as LedgerBreach;
  const newGeneration = corruptGeneration + 1;
  if (newGeneration > MAX_LEDGER_GENERATIONS) {
    throw new LedgerRecoveryRefusedError(`Ledger generation bound ${MAX_LEDGER_GENERATIONS} reached`);
  }

  const genesisRequest = buildGenesisRequest({
    corruptGeneration,
    newGeneration,
    breach,
    repository: input.repository,
    createdAt: input.createdAt,
    approvalId: input.genesisApprovalId,
    sessionId: input.sessionId,
  });
  const decision = await authorizeProtectedAction({
    request: genesisRequest,
    channel: input.channel,
    now: input.now,
    consumedApprovalIds: await input.ledger.consumedApprovalIds(),
    currentRepository: input.repository,
  });
  if (decision.status !== 'authorized') {
    throw new LedgerRecoveryRefusedError(`Re-genesis requires an authorized decision; observed '${decision.status}'.`);
  }

  const genesis = parseBoundary(LedgerRecordSchema, {
    kind: 'genesis',
    id: `genesis:${newGeneration}`,
    schemaVersion: 1,
    sequence: 0,
    previousDigest: GENESIS_DIGEST,
    createdAt: input.createdAt,
    actor: 'human',
    approvalId: decision.approvalId,
    requestDigest: decision.requestDigest,
    supersededGeneration: corruptGeneration,
    breakPointSequence: breach.sequence < 0 ? null : breach.sequence,
    breakReason: breach.reason,
    expectedDigest: breach.expectedDigest,
    observedDigest: breach.observedDigest,
    reconstructionBasis: input.reconstructionBasis,
    issuer: input.issuer,
    signatureReference: input.signatureReference,
  }, 'ledger genesis record');

  // The genesis record and the acceptance records land in one atomic append
  // against the still-empty new generation. Writing genesis first would leave
  // the generation non-empty and make the seeding gate refuse the very records
  // it is meant to admit; passing it as a leading record keeps EL-REQ-BOOT-003
  // governing the generation unchanged, exactly as SPEC 6.1 states.
  const seed = await seedAcceptanceLedger({
    ledger: input.ledger,
    channel: input.channel,
    catalog: input.catalog,
    repository: input.repository,
    now: input.now,
    createdAt: input.createdAt,
    approvalId: input.seedApprovalId,
    requestId: input.seedRequestId,
    operationId: input.seedOperationId,
    sessionId: input.sessionId,
    generation: newGeneration,
    pairs: input.pairs === undefined ? undefined : canonicalStatusPairs(input.pairs),
    leadingRecords: [genesis],
  });

  return { corruptGeneration, newGeneration, breach, genesis, seed };
}
