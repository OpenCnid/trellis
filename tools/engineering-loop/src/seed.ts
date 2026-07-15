import { z } from 'zod';
import {
  GENESIS_DIGEST,
  RepositoryObservationSchema,
  StableIdSchema,
  parseBoundary,
  type RepositoryObservation,
} from './domain.js';
import {
  MAX_PROTECTED_SCOPE_ITEMS,
  PROTECTED_POLICY_SCHEMA_VERSION,
  PROTECTED_POLICY_VERSION,
  ProtectedActionRequestSchema,
  authorizeProtectedAction,
  protectedRequestDigest,
  type ProtectedActionRequest,
  type ProtectedApprovalChannel,
} from './policy.js';
import {
  AcceptanceLedger,
  FeatureStatusSchema,
  LedgerRecordSchema,
  LedgerStateError,
  PROGRAM_ACCEPTANCE_WORKFLOW_ID,
  catalogDigestOf,
  classifyLedgerGeneration,
  ledgerRecordDigest,
  type LedgerRecord,
} from './acceptance_ledger.js';

/**
 * One-time approval-gated seeding (SPEC 6.1, EL-REQ-BOOT-002 and
 * EL-REQ-BOOT-003).
 *
 * Described neutrally, a bootstrap that writes "EL-00 through EL-06 are
 * accepted" into protected state is the precise forgery tool the architecture
 * exists to prevent. It is therefore built strictly as a consumer of the
 * existing EL-06 approval machinery, with no privileged path of its own: the
 * controller composes the request and the owner alone supplies the
 * authorization.
 *
 * Seeding is not a special case of the acceptance path — it is the ordinary
 * acceptance path applied to an empty generation, which is why it needs no
 * privileged code.
 */

export const SEED_SESSION_ID = 'session:el10-activation';
export const SEED_SCOPE_SEPARATOR = '=';

export class SeedRefusedError extends Error {
  readonly refusal: SeedRefusalClass;

  constructor(refusal: SeedRefusalClass, message: string) {
    super(message.slice(0, 1_024));
    this.name = 'SeedRefusedError';
    this.refusal = refusal;
  }
}

/**
 * The refusals seeding itself owns.
 *
 * The design record's seeding table lists seven conditions; only these two are
 * seeding's to decide. The other five — missing approval, scope mismatch,
 * digest mismatch, already-consumed, and expired — are approval-policy
 * judgements and surface as `ProtectedPolicyError` from
 * `authorizeProtectedAction`. That is the design working rather than a gap:
 * seeding is a consumer of the accepted EL-06 policy with no privileged path,
 * and re-typing those errors here would require matching on their messages and
 * would give this module a second opinion about what a valid approval is.
 *
 * Coverage of all seven conditions is proven by the seeding refusal-matrix
 * test, not by the size of this list.
 */
export const SEED_REFUSAL_CLASSES = ['non_empty_generation', 'invalid_record'] as const;
export type SeedRefusalClass = (typeof SEED_REFUSAL_CLASSES)[number];

export const CatalogStatusPairSchema = z.strictObject({
  featureId: StableIdSchema,
  status: FeatureStatusSchema,
});
export type CatalogStatusPair = z.infer<typeof CatalogStatusPairSchema>;

const CatalogStatusPairsSchema = z
  .array(CatalogStatusPairSchema)
  .min(1)
  .max(MAX_PROTECTED_SCOPE_ITEMS)
  .superRefine((pairs, ctx) => {
    if (new Set(pairs.map(pair => pair.featureId)).size !== pairs.length) {
      ctx.addIssue({ code: 'custom', message: 'seed scope must name each feature exactly once' });
    }
  });

/**
 * The scope enumerates each `(featureId, status)` pair explicitly. One approval
 * rather than eleven costs no safety: approving the scope is approving each
 * claim individually, and the request digest binding means a single altered pair
 * invalidates the whole approval.
 */
export function seedScopeItem(pair: CatalogStatusPair): string {
  return `${pair.featureId}${SEED_SCOPE_SEPARATOR}${pair.status}`;
}

export function seedScope(pairs: readonly CatalogStatusPair[]): readonly string[] {
  return parseBoundary(CatalogStatusPairsSchema, pairs, 'seed status pairs').map(seedScopeItem);
}

/**
 * Reads the `(featureId, status)` pairs out of the versioned catalog's
 * bootstrap status. This is the migration's source value, read once, under owner
 * approval — not a controller judgement about what is accepted.
 */
export function catalogStatusPairs(catalogValue: unknown): readonly CatalogStatusPair[] {
  const catalog = parseBoundary(
    z.looseObject({
      features: z.array(z.looseObject({ id: StableIdSchema, bootstrapStatus: FeatureStatusSchema })).min(1),
    }),
    catalogValue,
    'seed catalog'
  );
  return parseBoundary(
    CatalogStatusPairsSchema,
    catalog.features.map(feature => ({ featureId: feature.id, status: feature.bootstrapStatus })),
    'seed status pairs'
  );
}

export interface SeedRequestInput {
  pairs: readonly CatalogStatusPair[];
  repository: RepositoryObservation;
  createdAt: string;
  approvalId: string;
  requestId?: string;
  operationId?: string;
  sessionId?: string;
}

export function buildSeedRequest(input: SeedRequestInput): ProtectedActionRequest {
  const repository = parseBoundary(RepositoryObservationSchema, input.repository, 'seed repository precondition');
  return parseBoundary(ProtectedActionRequestSchema, {
    id: input.requestId ?? 'request:el10-acceptance-seed',
    schemaVersion: PROTECTED_POLICY_SCHEMA_VERSION,
    policyVersion: PROTECTED_POLICY_VERSION,
    createdAt: input.createdAt,
    workflowId: PROGRAM_ACCEPTANCE_WORKFLOW_ID,
    featureId: 'EL-10',
    sessionId: input.sessionId ?? SEED_SESSION_ID,
    action: 'acceptance_change',
    executionMode: 'controller_effect',
    target: 'acceptance-ledger:generation-seed',
    exactScope: [...seedScope(input.pairs)],
    repositoryPrecondition: repository,
    approvalId: parseBoundary(StableIdSchema, input.approvalId, 'seed approval identity'),
    operationId: input.operationId ?? 'operation:el10-acceptance-seed',
    attempt: 1,
    retryOf: null,
    automatic: false,
    paidEstimate: null,
    requestedLimitUsd: null,
  }, 'seed protected action request');
}

export interface SeedInput {
  ledger: AcceptanceLedger;
  channel: ProtectedApprovalChannel;
  catalog: unknown;
  repository: RepositoryObservation;
  now: string;
  createdAt: string;
  approvalId: string;
  requestId?: string;
  operationId?: string;
  sessionId?: string;
  /**
   * The generation to seed. Defaults to the current one. Re-genesis
   * (EL-REQ-BOOT-007) passes the new generation explicitly.
   */
  generation?: number;
  /**
   * Records that open the generation ahead of the acceptance records, in the
   * same atomic append. Re-genesis passes its signed genesis record here so the
   * generation is still empty when the seeding gate is evaluated, which is what
   * lets EL-REQ-BOOT-003 govern it unchanged.
   */
  leadingRecords?: readonly LedgerRecord[];
}

export interface SeedResult {
  generation: number;
  records: readonly LedgerRecord[];
  approvalId: string;
  consumptionId: string;
  requestDigest: string;
  catalogDigest: string;
  scope: readonly string[];
}

/**
 * Builds the acceptance records for an authorized seed. `actor` is `human`
 * because the owner's approval is the authority the records rest on; the
 * controller only transcribes the approved scope.
 *
 * No synthetic workflow history is constructed. Reaching `accepted` by walking a
 * fabricated `selected -> preparing -> running -> verifying -> awaiting_review`
 * sequence would attest controller-observed events for runs that never
 * occurred, and SPEC 6.1 forbids it normatively.
 */
function seedRecords(input: {
  pairs: readonly CatalogStatusPair[];
  createdAt: string;
  approvalId: string;
  requestDigest: string;
  catalogDigest: string;
  startSequence: number;
  startPreviousDigest: string;
}): readonly LedgerRecord[] {
  const records: LedgerRecord[] = [];
  let sequence = input.startSequence;
  let previousDigest = input.startPreviousDigest;
  for (const pair of input.pairs) {
    let record: LedgerRecord;
    try {
      record = parseBoundary(LedgerRecordSchema, {
        kind: 'acceptance',
        id: `acceptance:${pair.featureId}:${sequence}`,
        schemaVersion: 1,
        sequence,
        previousDigest,
        createdAt: input.createdAt,
        actor: 'human',
        approvalId: input.approvalId,
        requestDigest: input.requestDigest,
        featureId: pair.featureId,
        status: pair.status,
        catalogDigest: input.catalogDigest,
      }, 'seed acceptance record');
    } catch (error) {
      throw new SeedRefusedError(
        'invalid_record',
        `Seed record for '${pair.featureId}' is invalid; no record is applied: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    records.push(record);
    previousDigest = ledgerRecordDigest(record);
    sequence++;
  }
  return records;
}

/**
 * EL-REQ-BOOT-002 and EL-REQ-BOOT-003. Refuses a non-empty generation, applies
 * every scoped record or none, and never overwrites, replays, or repairs
 * existing history.
 */
export async function seedAcceptanceLedger(input: SeedInput): Promise<SeedResult> {
  const generation = input.generation ?? (await input.ledger.currentGeneration());
  const state = await input.ledger.readGeneration(generation);
  const ceremony = classifyLedgerGeneration(state);
  if (ceremony !== 'seeding') {
    throw new SeedRefusedError(
      ceremony === 're_genesis' ? 'invalid_record' : 'non_empty_generation',
      ceremony === 're_genesis'
        ? `Generation ${generation} integrity is broken; seeding is refused and re-genesis under EL-REQ-BOOT-007 is required.`
        : `Generation ${generation} already holds ${state.records.length} record(s); seeding is once-only.`
    );
  }

  const pairs = catalogStatusPairs(input.catalog);
  const catalogDigest = catalogDigestOf(input.catalog);
  const request = buildSeedRequest({
    pairs,
    repository: input.repository,
    createdAt: input.createdAt,
    approvalId: input.approvalId,
    requestId: input.requestId,
    operationId: input.operationId,
    sessionId: input.sessionId,
  });

  const consumedApprovalIds = await input.ledger.consumedApprovalIds();
  const decision = await authorizeProtectedAction({
    request,
    channel: input.channel,
    now: input.now,
    consumedApprovalIds,
    currentRepository: input.repository,
  });
  if (decision.status !== 'authorized') {
    throw new SeedRefusedError('invalid_record', `Seeding requires an authorized decision; observed '${decision.status}'.`);
  }

  const leading = (input.leadingRecords ?? []).map(record => parseBoundary(LedgerRecordSchema, record, 'seed leading record'));
  const startSequence = leading.length;
  const startPreviousDigest = leading.length === 0
    ? GENESIS_DIGEST
    : ledgerRecordDigest(leading[leading.length - 1]);
  const records = seedRecords({
    pairs,
    createdAt: input.createdAt,
    approvalId: decision.approvalId,
    requestDigest: decision.requestDigest,
    catalogDigest,
    startSequence,
    startPreviousDigest,
  });

  const applied = await input.ledger.appendAll(generation, [...leading, ...records]);
  return {
    generation,
    records: applied.records,
    approvalId: decision.approvalId,
    consumptionId: decision.consumptionId as string,
    requestDigest: decision.requestDigest,
    catalogDigest,
    scope: request.exactScope,
  };
}

