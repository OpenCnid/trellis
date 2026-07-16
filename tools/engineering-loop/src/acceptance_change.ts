import { z } from 'zod';
import {
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
import {
  AcceptanceLedger,
  PROGRAM_ACCEPTANCE_WORKFLOW_ID,
  buildAcceptanceRecordChain,
  catalogDigestOf,
  ledgerCeremonyAdmitted,
  ledgerRecordDigest,
  type LedgerRecord,
} from './acceptance_ledger.js';
import { CatalogStatusPairsSchema, seedScope, type CatalogStatusPair } from './seed.js';

/**
 * The steady-state acceptance path (SPEC 6.1, `EL-REQ-BOOT-008`).
 *
 * EL-10 shipped the ledger write-once. Seeding refuses a non-empty generation and
 * the only other gated writes are the two corruption ceremonies, so a validating,
 * populated ledger had no path to record an ordinary status change: EL-10 could
 * not be marked `accepted`, EL-07 could not be unblocked, and no future feature
 * could ever be accepted. The trust store advanced no further than its first
 * write.
 *
 * Record 9.6 describes this path precisely — "moving a feature to `accepted` in
 * the ledger is a separate owner act through the same `acceptance_change` path
 * that seeding uses ... seeding is not a privileged special case, it is the
 * ordinary path applied to an empty ledger, which is why it needs no privileged
 * code" — but carried no requirement, no conformance row, and no test that could
 * fail, so the implementing session built the six items that had requirements and
 * inverted the seventh. `EL-REQ-BOOT-008` exists so that cannot happen twice.
 *
 * This module adds no protected action: `acceptance_change` already covers it,
 * and a second action would need a mode flag to tell the two apart, which is
 * exactly what 9.9 says rots. It is a consumer of the accepted EL-06 approval
 * machinery with no privileged path of its own, exactly as seeding is.
 *
 * Why not `ledger_recovery`. It would work mechanically — supersede the
 * `EL-10=planned` record — and it would be false. That record was *correct* when
 * written; accepting EL-10 is new information, not a correction. Routing ordinary
 * progress through the corruption ceremony would mislabel every future acceptance
 * as a reconciliation and collapse the disjoint predicates 9.9 keeps mechanically
 * checkable. `ledger_recovery` keeps its predicate: content corruption on a
 * validating chain.
 */

export const ACCEPTANCE_CHANGE_SESSION_ID = 'session:el11-acceptance-change';
export const ACCEPTANCE_CHANGE_FEATURE_ID = 'EL-11';

/**
 * Distinct from seeding's `acceptance-ledger:generation-seed`. The request digest
 * already binds an approval to one request, so this is not the security boundary;
 * it is so an auditor reading the protected channel can tell an ordinary status
 * change from an activation seed without reconstructing the scope.
 */
export const ACCEPTANCE_CHANGE_TARGET = 'acceptance-ledger:acceptance-change';

/**
 * The refusals this ceremony owns.
 *
 * Approval judgements — missing, mismatched, widened, expired, revoked, already
 * consumed — are not here on purpose. They belong to the accepted EL-06 policy
 * and surface as `ProtectedPolicyError` from `authorizeProtectedAction`. Re-typing
 * them here would give this module a second opinion about what a valid approval
 * is. Coverage is proven by the refusal-matrix test, never by the size of this
 * list.
 */
export const ACCEPTANCE_CHANGE_REFUSAL_CLASSES = [
  'empty_generation',
  'broken_chain',
  'unknown_feature',
  'invalid_record',
] as const;
export type AcceptanceChangeRefusalClass = (typeof ACCEPTANCE_CHANGE_REFUSAL_CLASSES)[number];

export class AcceptanceChangeRefusedError extends Error {
  readonly refusal: AcceptanceChangeRefusalClass;

  constructor(refusal: AcceptanceChangeRefusalClass, message: string) {
    super(message.slice(0, 1_024));
    this.name = 'AcceptanceChangeRefusedError';
    this.refusal = refusal;
  }
}

/**
 * The pairs in a canonical order, which is what makes a request reproducible.
 *
 * The request digest is sha256 over the canonical JSON of the request material,
 * and canonical JSON sorts object keys but *not* array elements — so `exactScope`
 * order is digest-bearing. Approval matching, by contrast, compares scope sorted
 * (`exactStrings`). Left unordered, an owner who printed a request with
 * `--set EL-10=accepted --set EL-07=planned` and then recorded it with the two
 * flags transposed would pass the scope check and fail the digest check, and be
 * told the approval was "mismatched, widened, inherited, or bound to another
 * request" when nothing of the sort had happened.
 *
 * Seeding never had this exposure: its pairs come from a status document in
 * catalog order, so the order was already deterministic. A steady-state change
 * takes its pairs from the owner's command line, so the canonical order is
 * established here instead. `EL-REQ-APPROVAL-012` requires that a request the
 * controller can specify and match to a valid approval proceeds; the same
 * decision, expressed in a different flag order, is the same request.
 *
 * Sorting once, here, keeps the scope and the appended records in the same order
 * as each other, so an auditor reading the approval against the ledger sees one
 * ordering rather than two.
 */
export function canonicalStatusPairs(pairs: readonly CatalogStatusPair[]): readonly CatalogStatusPair[] {
  return [...parseBoundary(CatalogStatusPairsSchema, pairs, 'acceptance change status pairs')]
    .sort((left, right) => left.featureId.localeCompare(right.featureId, 'en'));
}

/**
 * Seeding's scope grammar, deliberately unchanged: each item is one exact
 * `EL-10=accepted` pair. `EL-REQ-BOOT-008` enumerates its scope the same way
 * `EL-REQ-BOOT-002` requires seeding to, so an owner authoring approval material
 * reads one grammar rather than two, and the digest binding means a single
 * altered pair invalidates the whole approval.
 */
export function acceptanceChangeScope(pairs: readonly CatalogStatusPair[]): readonly string[] {
  return seedScope(canonicalStatusPairs(pairs));
}

/**
 * The features the catalog defines. The catalog carries immutable feature
 * definitions (`EL-REQ-BOOT-004`), so it is the only honest answer to "does this
 * feature exist"; status is not read from it and is not present in it.
 */
function knownFeatureIds(catalogValue: unknown): ReadonlySet<string> {
  const catalog = parseBoundary(
    z.looseObject({ features: z.array(z.looseObject({ id: StableIdSchema })).min(1) }),
    catalogValue,
    'acceptance change catalog'
  );
  return new Set(catalog.features.map(feature => feature.id));
}

export interface AcceptanceChangeRequestInput {
  pairs: readonly CatalogStatusPair[];
  repository: RepositoryObservation;
  createdAt: string;
  approvalId: string;
  requestId?: string;
  operationId?: string;
  sessionId?: string;
}

/**
 * Composes the exact request an owner's approval must match, fully specified:
 * typed action, exact scope, computed material, and repository preconditions
 * (`EL-REQ-APPROVAL-012`). It reads no approval and touches no channel, so the
 * controller can discharge every unprotected preparatory step before any approval
 * exists — the pause gates the protected effect, never the preparation.
 */
export function buildAcceptanceChangeRequest(input: AcceptanceChangeRequestInput): ProtectedActionRequest {
  return parseBoundary(ProtectedActionRequestSchema, {
    id: input.requestId ?? 'request:el11-acceptance-change',
    schemaVersion: PROTECTED_POLICY_SCHEMA_VERSION,
    policyVersion: PROTECTED_POLICY_VERSION,
    createdAt: input.createdAt,
    workflowId: PROGRAM_ACCEPTANCE_WORKFLOW_ID,
    featureId: ACCEPTANCE_CHANGE_FEATURE_ID,
    sessionId: input.sessionId ?? ACCEPTANCE_CHANGE_SESSION_ID,
    action: 'acceptance_change',
    executionMode: 'controller_effect',
    target: ACCEPTANCE_CHANGE_TARGET,
    exactScope: [...acceptanceChangeScope(input.pairs)],
    repositoryPrecondition: parseBoundary(
      RepositoryObservationSchema,
      input.repository,
      'acceptance change repository precondition'
    ),
    approvalId: parseBoundary(StableIdSchema, input.approvalId, 'acceptance change approval identity'),
    operationId: input.operationId ?? 'operation:el11-acceptance-change',
    attempt: 1,
    retryOf: null,
    automatic: false,
    paidEstimate: null,
    requestedLimitUsd: null,
  }, 'acceptance change protected action request');
}

export interface AcceptanceChangeInput {
  ledger: AcceptanceLedger;
  channel: ProtectedApprovalChannel;
  catalog: unknown;
  repository: RepositoryObservation;
  /**
   * The `(featureId, status)` pairs to record. Explicit and required: never
   * defaulted, and never derived from the catalog or from workflow state the
   * controller produced itself (`EL-REQ-BOOT-002`). A status change is an owner
   * decision, and the controller only transcribes the approved scope.
   */
  pairs: readonly CatalogStatusPair[];
  now: string;
  createdAt: string;
  approvalId: string;
  requestId?: string;
  operationId?: string;
  sessionId?: string;
}

export interface AcceptanceChangeResult {
  generation: number;
  /** The records this change appended, in sequence order. */
  appended: readonly LedgerRecord[];
  /** Every record in the generation after the append, superseded ones included. */
  records: readonly LedgerRecord[];
  approvalId: string;
  consumptionId: string;
  requestDigest: string;
  catalogDigest: string;
  scope: readonly string[];
}

/**
 * `EL-REQ-BOOT-008`. Appends acceptance records to a non-empty generation whose
 * chain validates, under a single owner-approved `acceptance_change`.
 *
 * Superseding is by ordinary replay: `resolveFeatureStatus` takes the last record
 * per `featureId`, so an earlier record is never mutated, deleted, or rewritten —
 * it stays in the chain as history, and the digest linkage that makes the ledger
 * a trust anchor is exactly what makes that safe.
 */
export async function recordAcceptanceChange(input: AcceptanceChangeInput): Promise<AcceptanceChangeResult> {
  const generation = await input.ledger.currentGeneration();
  const state = await input.ledger.readGeneration(generation);
  if (!ledgerCeremonyAdmitted(state, 'steady_state_acceptance')) {
    const broken = state.integrity === 'broken';
    throw new AcceptanceChangeRefusedError(
      broken ? 'broken_chain' : 'empty_generation',
      broken
        ? `Generation ${generation} has a broken integrity chain; appending a status change is refused because its previous-record digest would inherit or mask the break. Re-genesis under EL-REQ-BOOT-007 is the only route.`
        : `Generation ${generation} is empty; there is no history to change. Seeding under EL-REQ-BOOT-003 applies instead.`
    );
  }

  const pairs = canonicalStatusPairs(input.pairs);
  const known = knownFeatureIds(input.catalog);
  const unknown = pairs.map(pair => pair.featureId).filter(featureId => !known.has(featureId));
  if (unknown.length > 0) {
    throw new AcceptanceChangeRefusedError(
      'unknown_feature',
      `Acceptance change names ${unknown.length} feature(s) the catalog does not define: ${unknown.sort().join(', ')}. A status for an undefined feature is unresolvable and no record is applied.`
    );
  }

  const catalogDigest = catalogDigestOf(input.catalog);
  const request = buildAcceptanceChangeRequest({
    pairs,
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
    throw new AcceptanceChangeRefusedError(
      'invalid_record',
      `Recording an acceptance change requires an authorized decision; observed '${decision.status}'.`
    );
  }

  let appended: readonly LedgerRecord[];
  try {
    appended = buildAcceptanceRecordChain({
      pairs,
      createdAt: input.createdAt,
      approvalId: decision.approvalId,
      requestDigest: decision.requestDigest,
      catalogDigest,
      startSequence: state.records.length,
      startPreviousDigest: ledgerRecordDigest(state.records[state.records.length - 1]),
    });
  } catch (error) {
    throw new AcceptanceChangeRefusedError(
      'invalid_record',
      `Acceptance record is invalid; no record is applied: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const applied = await input.ledger.appendAll(generation, appended);
  return {
    generation,
    appended,
    records: applied.records,
    approvalId: decision.approvalId,
    consumptionId: decision.consumptionId as string,
    requestDigest: decision.requestDigest,
    catalogDigest,
    scope: request.exactScope,
  };
}
