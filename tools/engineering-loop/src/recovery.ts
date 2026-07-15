import { z } from 'zod';
import { StableIdSchema, parseBoundary } from './domain.js';
import { sha256Canonical } from './events.js';

export const RECOVERY_SCHEMA_VERSION = 1 as const;
export const RECOVERY_POLICY_VERSION = 'trellis-recovery-policy:v1' as const;
export const MAX_RETRY_ATTEMPTS = 8;
export const MAX_RETRY_DELAY_MS = 60_000;
export const MAX_RECONCILIATION_RECORDS = 32;

const TimestampSchema = z.string().datetime({ offset: true });
const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const BoundedTextSchema = z.string().min(1).refine(
  value => Buffer.byteLength(value, 'utf8') <= 2_048,
  'must not exceed 2048 UTF-8 bytes'
);

export const FailureClassSchema = z.enum([
  'transient',
  'environmental',
  'specification',
  'policy',
  'harness',
  'unknown_side_effect',
  'implementation',
  'cancelled',
]);
export type FailureClass = z.infer<typeof FailureClassSchema>;

export const FailureObservationSchema = z.strictObject({
  id: StableIdSchema,
  schemaVersion: z.literal(RECOVERY_SCHEMA_VERSION),
  createdAt: TimestampSchema,
  workflowId: StableIdSchema,
  featureId: StableIdSchema,
  sessionId: StableIdSchema,
  operationId: StableIdSchema,
  category: FailureClassSchema,
  detail: BoundedTextSchema,
  transientCode: z.enum(['rate_limited', 'temporary_unavailable', 'timeout', 'connection_reset']).nullable(),
  sideEffect: z.enum(['none_proven', 'occurred', 'unknown']),
  idempotencyKey: StableIdSchema.nullable(),
  identicalOperationDigest: DigestSchema.nullable(),
}).superRefine((failure, ctx) => {
  if ((failure.category === 'transient') !== (failure.transientCode !== null)) {
    ctx.addIssue({ code: 'custom', path: ['transientCode'], message: 'only transient failures carry a transient code' });
  }
  const hasIdempotencyProof = failure.idempotencyKey !== null && failure.identicalOperationDigest !== null;
  if ((failure.idempotencyKey === null) !== (failure.identicalOperationDigest === null)) {
    ctx.addIssue({ code: 'custom', path: ['idempotencyKey'], message: 'idempotency key and identical-operation digest are an inseparable proof' });
  }
  if (failure.sideEffect === 'unknown' && failure.category !== 'unknown_side_effect') {
    ctx.addIssue({ code: 'custom', path: ['category'], message: 'unknown side effect must use unknown_side_effect taxonomy' });
  }
  if (failure.category === 'unknown_side_effect' && failure.sideEffect !== 'unknown') {
    ctx.addIssue({ code: 'custom', path: ['sideEffect'], message: 'unknown_side_effect requires unknown effect status' });
  }
  if (failure.sideEffect === 'occurred' && !hasIdempotencyProof) {
    ctx.addIssue({ code: 'custom', path: ['idempotencyKey'], message: 'occurred effect requires identical idempotency proof before retry can be considered' });
  }
});
export type FailureObservation = z.infer<typeof FailureObservationSchema>;

export const RetryPolicySchema = z.strictObject({
  schemaVersion: z.literal(RECOVERY_SCHEMA_VERSION),
  policyVersion: z.literal(RECOVERY_POLICY_VERSION),
  maxAttempts: z.number().int().min(1).max(MAX_RETRY_ATTEMPTS),
  delayMs: z.number().int().min(0).max(MAX_RETRY_DELAY_MS),
});
export type RetryPolicy = z.infer<typeof RetryPolicySchema>;

export const RecoveryContextSchema = z.strictObject({
  failure: FailureObservationSchema,
  policy: RetryPolicySchema,
  attempt: z.number().int().min(1).max(MAX_RETRY_ATTEMPTS),
  implementationRetriesConsumed: z.number().int().min(0).max(MAX_RETRY_ATTEMPTS),
  priorOperationDigest: DigestSchema.nullable(),
  priorIdempotencyKey: StableIdSchema.nullable(),
});

export const RecoveryDecisionSchema = z.strictObject({
  schemaVersion: z.literal(RECOVERY_SCHEMA_VERSION),
  policyVersion: z.literal(RECOVERY_POLICY_VERSION),
  failureId: StableIdSchema,
  category: FailureClassSchema,
  action: z.enum(['retry', 'block', 'fail', 'recover', 'cancel']),
  nextAttempt: z.number().int().min(2).max(MAX_RETRY_ATTEMPTS).nullable(),
  delayMs: z.number().int().min(0).max(MAX_RETRY_DELAY_MS),
  implementationRetryConsumed: z.boolean(),
  exhausted: z.boolean(),
  reconciliationRequired: BoundedTextSchema.nullable(),
  reason: BoundedTextSchema,
  decisionDigest: DigestSchema,
}).superRefine((decision, ctx) => {
  if (decision.action === 'retry' && decision.nextAttempt === null) {
    ctx.addIssue({ code: 'custom', path: ['nextAttempt'], message: 'retry requires a next attempt' });
  }
  if (decision.action !== 'retry' && decision.nextAttempt !== null) {
    ctx.addIssue({ code: 'custom', path: ['nextAttempt'], message: 'non-retry action forbids a next attempt' });
  }
  if (decision.category === 'unknown_side_effect') {
    if (decision.action !== 'block' || decision.reconciliationRequired === null) {
      ctx.addIssue({ code: 'custom', path: ['action'], message: 'unknown side effect must block with reconciliation' });
    }
  } else if (decision.reconciliationRequired !== null) {
    ctx.addIssue({ code: 'custom', path: ['reconciliationRequired'], message: 'only unknown side effect carries reconciliation' });
  }
});
export type RecoveryDecision = z.infer<typeof RecoveryDecisionSchema>;

function decisionMaterial(decision: RecoveryDecision): Omit<RecoveryDecision, 'decisionDigest'> {
  const { decisionDigest: _digest, ...material } = decision;
  return material;
}

function finalizeDecision(input: Omit<RecoveryDecision, 'decisionDigest'>): RecoveryDecision {
  const candidate = parseBoundary(RecoveryDecisionSchema, {
    ...input,
    decisionDigest: '0'.repeat(64),
  }, 'recovery decision material');
  return parseBoundary(RecoveryDecisionSchema, {
    ...candidate,
    decisionDigest: sha256Canonical(decisionMaterial(candidate)),
  }, 'recovery decision');
}

/** Pure recovery classification and action policy. It invokes no effect. */
export function decideRecovery(contextValue: unknown): RecoveryDecision {
  const context = parseBoundary(RecoveryContextSchema, contextValue, 'recovery context');
  const { failure, policy, attempt } = context;
  if (failure.category === 'unknown_side_effect') {
    return finalizeDecision({
      schemaVersion: RECOVERY_SCHEMA_VERSION,
      policyVersion: RECOVERY_POLICY_VERSION,
      failureId: failure.id,
      category: failure.category,
      action: 'block',
      nextAttempt: null,
      delayMs: 0,
      implementationRetryConsumed: false,
      exhausted: false,
      reconciliationRequired: `Reconcile operation ${failure.operationId} against the external system before a signed human decision.`,
      reason: 'External effect outcome is unknown; automatic retry and inferred success are forbidden.',
    });
  }

  if (failure.category === 'cancelled') {
    return finalizeDecision({
      schemaVersion: RECOVERY_SCHEMA_VERSION,
      policyVersion: RECOVERY_POLICY_VERSION,
      failureId: failure.id,
      category: failure.category,
      action: 'cancel',
      nextAttempt: null,
      delayMs: 0,
      implementationRetryConsumed: false,
      exhausted: false,
      reconciliationRequired: null,
      reason: 'Human cancellation is terminal and is never retried.',
    });
  }

  const nonImplementation = ['environmental', 'specification', 'policy', 'harness'] as const;
  if (nonImplementation.includes(failure.category as typeof nonImplementation[number])) {
    return finalizeDecision({
      schemaVersion: RECOVERY_SCHEMA_VERSION,
      policyVersion: RECOVERY_POLICY_VERSION,
      failureId: failure.id,
      category: failure.category,
      action: failure.category === 'harness' ? 'fail' : 'block',
      nextAttempt: null,
      delayMs: 0,
      implementationRetryConsumed: false,
      exhausted: false,
      reconciliationRequired: null,
      reason: `${failure.category} failure does not consume implementation retry budget.`,
    });
  }

  if (failure.category === 'implementation') {
    const exhausted = context.implementationRetriesConsumed + 1 >= policy.maxAttempts;
    return finalizeDecision({
      schemaVersion: RECOVERY_SCHEMA_VERSION,
      policyVersion: RECOVERY_POLICY_VERSION,
      failureId: failure.id,
      category: failure.category,
      action: exhausted ? 'fail' : 'recover',
      nextAttempt: null,
      delayMs: 0,
      implementationRetryConsumed: true,
      exhausted,
      reconciliationRequired: null,
      reason: exhausted
        ? 'Bounded implementation recovery budget is exhausted; automatic transient retry remains forbidden.'
        : 'Implementation failure enters bounded recovery analysis and is not automatically retried.',
    });
  }

  const noSideEffect = failure.sideEffect === 'none_proven';
  const identicalIdempotent = failure.idempotencyKey !== null
    && failure.identicalOperationDigest !== null
    && context.priorIdempotencyKey === failure.idempotencyKey
    && context.priorOperationDigest === failure.identicalOperationDigest;
  if (!noSideEffect && !identicalIdempotent) {
    return finalizeDecision({
      schemaVersion: RECOVERY_SCHEMA_VERSION,
      policyVersion: RECOVERY_POLICY_VERSION,
      failureId: failure.id,
      category: failure.category,
      action: 'block',
      nextAttempt: null,
      delayMs: 0,
      implementationRetryConsumed: false,
      exhausted: false,
      reconciliationRequired: null,
      reason: 'Transient failure lacks proof of no effect or identical idempotency under the same key.',
    });
  }
  if (attempt >= policy.maxAttempts) {
    return finalizeDecision({
      schemaVersion: RECOVERY_SCHEMA_VERSION,
      policyVersion: RECOVERY_POLICY_VERSION,
      failureId: failure.id,
      category: failure.category,
      action: 'fail',
      nextAttempt: null,
      delayMs: 0,
      implementationRetryConsumed: false,
      exhausted: true,
      reconciliationRequired: null,
      reason: 'Finite transient retry bound exhausted; counter cannot reset.',
    });
  }
  return finalizeDecision({
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    policyVersion: RECOVERY_POLICY_VERSION,
    failureId: failure.id,
    category: failure.category,
    action: 'retry',
    nextAttempt: attempt + 1,
    delayMs: policy.delayMs,
    implementationRetryConsumed: false,
    exhausted: false,
    reconciliationRequired: null,
    reason: noSideEffect
      ? 'Typed transient failure has controller proof that no side effect occurred.'
      : 'Typed transient failure repeats an identical idempotent operation under the same key.',
  });
}

export const SignedReconciliationSchema = z.strictObject({
  id: StableIdSchema,
  schemaVersion: z.literal(RECOVERY_SCHEMA_VERSION),
  createdAt: TimestampSchema,
  workflowId: StableIdSchema,
  featureId: StableIdSchema,
  sessionId: StableIdSchema,
  failureId: StableIdSchema,
  operationId: StableIdSchema,
  issuer: StableIdSchema,
  decision: z.enum(['confirmed_succeeded', 'confirmed_failed', 'cancelled']),
  evidenceReference: BoundedTextSchema,
  evidenceDigest: DigestSchema,
  signatureReference: BoundedTextSchema,
  priorHistoryDigest: DigestSchema,
  recordDigest: DigestSchema,
});
export type SignedReconciliation = z.infer<typeof SignedReconciliationSchema>;

function reconciliationMaterial(record: SignedReconciliation): Omit<SignedReconciliation, 'recordDigest'> {
  const { recordDigest: _digest, ...material } = record;
  return material;
}

export function appendSignedReconciliation(input: {
  priorHistory: readonly SignedReconciliation[];
  record: Omit<SignedReconciliation, 'priorHistoryDigest' | 'recordDigest'>;
}): readonly SignedReconciliation[] {
  if (input.priorHistory.length >= MAX_RECONCILIATION_RECORDS) {
    throw new Error('reconciliation history bound exceeded');
  }
  const prior = input.priorHistory.map(item => parseBoundary(SignedReconciliationSchema, item, 'prior reconciliation'));
  const priorHistoryDigest = sha256Canonical(prior);
  const candidate = parseBoundary(SignedReconciliationSchema, {
    ...input.record,
    priorHistoryDigest,
    recordDigest: '0'.repeat(64),
  }, 'signed reconciliation material');
  const record = parseBoundary(SignedReconciliationSchema, {
    ...candidate,
    recordDigest: sha256Canonical(reconciliationMaterial(candidate)),
  }, 'signed reconciliation');
  return Object.freeze([...prior.map(item => structuredClone(item)), record]);
}
