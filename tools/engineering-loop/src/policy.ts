import { z } from 'zod';
import {
  DOMAIN_SCHEMA_VERSION,
  MAX_COLLECTION_ITEMS,
  RepositoryObservationSchema,
  StableIdSchema,
  parseBoundary,
  sameRepositoryObservation,
  type RepositoryObservation,
} from './domain.js';
import { canonicalJson, sha256Canonical } from './events.js';
import { createRunnerRedactor } from './runners/runner.js';

export const PROTECTED_POLICY_SCHEMA_VERSION = 1 as const;
export const PROTECTED_POLICY_VERSION = 'trellis-protected-action-policy:v1' as const;
export const REPOSITORY_PAID_HARD_CAP_USD = 5;
export const MAX_PROTECTED_SCOPE_ITEMS = 64;
export const MAX_PROTECTED_TEXT_BYTES = 2_048;
export const MAX_REDACTION_VALUES = 32;

const TimestampSchema = z.string().datetime({ offset: true });
const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/, 'must be a lowercase sha256 digest');

function utf8String(maxBytes: number, minBytes = 1) {
  return z.string().refine(value => {
    const bytes = Buffer.byteLength(value, 'utf8');
    return bytes >= minBytes && bytes <= maxBytes;
  }, `must use ${minBytes} through ${maxBytes} UTF-8 bytes`);
}

function uniqueStrings(maxItems: number, maxBytes = MAX_PROTECTED_TEXT_BYTES) {
  return z.array(utf8String(maxBytes)).max(maxItems).superRefine((items, ctx) => {
    if (new Set(items).size !== items.length) {
      ctx.addIssue({ code: 'custom', message: 'items must be unique' });
    }
  });
}

export const PROTECTED_ACTIONS = [
  'paid_model_or_service_call',
  'destructive_filesystem',
  'destructive_database',
  'destructive_queue',
  'destructive_external_system',
  'push',
  'merge',
  'acceptance_change',
  'ledger_recovery',
  'controller_change',
  'policy_change',
  'schema_change',
  'prompt_change',
  'verifier_change',
  'gate_change',
  'renderer_change',
  'handoff_migration',
  'pull_request_create',
  'tracker_write',
] as const;

export const ProtectedActionSchema = z.enum(PROTECTED_ACTIONS);
export type ProtectedAction = z.infer<typeof ProtectedActionSchema>;

const PaidEstimateSchema = z.strictObject({
  estimatedUsd: z.number().nonnegative().max(REPOSITORY_PAID_HARD_CAP_USD),
  estimatedInputTokens: z.number().int().nonnegative().max(100_000_000),
  estimatedOutputTokens: z.number().int().nonnegative().max(100_000_000),
});

export const PaidActualsSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative().max(100_000_000),
  outputTokens: z.number().int().nonnegative().max(100_000_000),
  actualUsd: z.number().nonnegative().max(REPOSITORY_PAID_HARD_CAP_USD),
});

export type PaidActuals = z.infer<typeof PaidActualsSchema>;

export const ProtectedActionRequestSchema = z.strictObject({
  id: StableIdSchema,
  schemaVersion: z.literal(PROTECTED_POLICY_SCHEMA_VERSION),
  policyVersion: z.literal(PROTECTED_POLICY_VERSION),
  createdAt: TimestampSchema,
  workflowId: StableIdSchema,
  featureId: StableIdSchema,
  sessionId: StableIdSchema,
  action: ProtectedActionSchema,
  executionMode: z.enum(['controller_effect', 'human_external']),
  target: utf8String(1_024),
  exactScope: uniqueStrings(MAX_PROTECTED_SCOPE_ITEMS).min(1),
  repositoryPrecondition: RepositoryObservationSchema,
  approvalId: StableIdSchema,
  operationId: StableIdSchema,
  attempt: z.literal(1),
  retryOf: StableIdSchema.nullable(),
  automatic: z.boolean(),
  paidEstimate: PaidEstimateSchema.nullable(),
  requestedLimitUsd: z.number().positive().max(REPOSITORY_PAID_HARD_CAP_USD).nullable(),
}).superRefine((request, ctx) => {
  const paid = request.action === 'paid_model_or_service_call';
  if (paid !== (request.paidEstimate !== null && request.requestedLimitUsd !== null)) {
    ctx.addIssue({ code: 'custom', path: ['paidEstimate'], message: 'paid action requires estimate and limit; non-paid action forbids them' });
  }
  if (request.paidEstimate !== null && request.requestedLimitUsd !== null) {
    if (request.paidEstimate.estimatedUsd > request.requestedLimitUsd) {
      ctx.addIssue({ code: 'custom', path: ['requestedLimitUsd'], message: 'limit must cover the presented estimate' });
    }
  }
});

export type ProtectedActionRequest = z.infer<typeof ProtectedActionRequestSchema>;

export const ProtectedApprovalRecordSchema = z.strictObject({
  id: StableIdSchema,
  schemaVersion: z.literal(PROTECTED_POLICY_SCHEMA_VERSION),
  createdAt: TimestampSchema,
  channel: z.literal('protected_external'),
  channelRecordId: StableIdSchema,
  issuer: StableIdSchema,
  workflowId: StableIdSchema,
  featureId: StableIdSchema,
  sessionId: StableIdSchema,
  action: ProtectedActionSchema,
  requestId: StableIdSchema,
  requestDigest: DigestSchema,
  target: utf8String(1_024),
  exactScope: uniqueStrings(MAX_PROTECTED_SCOPE_ITEMS).min(1),
  repositoryPrecondition: RepositoryObservationSchema,
  approvedEstimateUsd: z.number().nonnegative().max(REPOSITORY_PAID_HARD_CAP_USD).nullable(),
  approvedLimitUsd: z.number().positive().max(REPOSITORY_PAID_HARD_CAP_USD).nullable(),
  issuedAt: TimestampSchema,
  expiresAt: TimestampSchema,
  revokedAt: TimestampSchema.nullable(),
  revocationReason: utf8String(1_024).nullable(),
  consumptionState: z.enum(['active', 'consumed', 'revoked']),
  consumedAt: TimestampSchema.nullable(),
  consumptionId: StableIdSchema.nullable(),
  recordDigest: DigestSchema,
}).superRefine((approval, ctx) => {
  const paid = approval.action === 'paid_model_or_service_call';
  if (paid !== (approval.approvedEstimateUsd !== null && approval.approvedLimitUsd !== null)) {
    ctx.addIssue({ code: 'custom', path: ['approvedLimitUsd'], message: 'paid approval requires estimate and limit; non-paid approval forbids them' });
  }
  if (approval.approvedEstimateUsd !== null && approval.approvedLimitUsd !== null) {
    if (approval.approvedEstimateUsd > approval.approvedLimitUsd) {
      ctx.addIssue({ code: 'custom', path: ['approvedLimitUsd'], message: 'approved limit must cover approved estimate' });
    }
  }
  if (approval.consumptionState === 'consumed') {
    if (approval.consumedAt === null || approval.consumptionId === null) {
      ctx.addIssue({ code: 'custom', path: ['consumedAt'], message: 'consumed approval requires time and consumption identity' });
    }
  } else if (approval.consumedAt !== null || approval.consumptionId !== null) {
    ctx.addIssue({ code: 'custom', path: ['consumedAt'], message: 'unused or revoked approval cannot carry consumption fields' });
  }
  if (approval.consumptionState === 'revoked') {
    if (approval.revokedAt === null || approval.revocationReason === null) {
      ctx.addIssue({ code: 'custom', path: ['revokedAt'], message: 'revoked approval requires time and reason' });
    }
  } else if (approval.revokedAt !== null || approval.revocationReason !== null) {
    ctx.addIssue({ code: 'custom', path: ['revokedAt'], message: 'active or consumed approval cannot carry revocation fields' });
  }
  if (Date.parse(approval.expiresAt) <= Date.parse(approval.issuedAt)) {
    ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'approval expiry must follow issue time' });
  }
});

export type ProtectedApprovalRecord = z.infer<typeof ProtectedApprovalRecordSchema>;

export interface ProtectedApprovalChannel {
  readonly location: 'protected_external';
  read(approvalId: string): Promise<unknown | null>;
}

export const ProtectedPolicyDecisionSchema = z.strictObject({
  schemaVersion: z.literal(PROTECTED_POLICY_SCHEMA_VERSION),
  policyVersion: z.literal(PROTECTED_POLICY_VERSION),
  requestId: StableIdSchema,
  requestDigest: DigestSchema,
  status: z.enum(['authorized', 'manual_only']),
  action: ProtectedActionSchema,
  approvalId: StableIdSchema,
  consumptionId: StableIdSchema.nullable(),
  consumedApproval: ProtectedApprovalRecordSchema.nullable(),
  paidLimitUsd: z.number().positive().max(REPOSITORY_PAID_HARD_CAP_USD).nullable(),
  reason: utf8String(1_024),
}).superRefine((decision, ctx) => {
  if (decision.consumptionId === null || decision.consumedApproval === null) {
    ctx.addIssue({ code: 'custom', path: ['consumedApproval'], message: 'protected decision requires atomic approval consumption material' });
  }
});

export type ProtectedPolicyDecision = z.infer<typeof ProtectedPolicyDecisionSchema>;

export class ProtectedPolicyError extends Error {
  constructor(message: string) {
    super(message.slice(0, 1_024));
    this.name = 'ProtectedPolicyError';
  }
}

function requestMaterial(request: ProtectedActionRequest): Omit<ProtectedActionRequest, 'approvalId'> {
  const { approvalId: _approvalId, ...material } = request;
  return material;
}

export function protectedRequestDigest(requestValue: unknown): string {
  const request = parseBoundary(ProtectedActionRequestSchema, requestValue, 'protected action request');
  return sha256Canonical(requestMaterial(request));
}

function approvalMaterial(approval: ProtectedApprovalRecord): Omit<ProtectedApprovalRecord, 'recordDigest'> {
  const { recordDigest: _digest, ...material } = approval;
  return material;
}

export function createProtectedApprovalRecord(
  input: Omit<ProtectedApprovalRecord, 'recordDigest'>
): ProtectedApprovalRecord {
  const candidate = { ...input, recordDigest: '0'.repeat(64) };
  const parsed = parseBoundary(ProtectedApprovalRecordSchema, candidate, 'protected approval creation');
  return parseBoundary(ProtectedApprovalRecordSchema, {
    ...parsed,
    recordDigest: sha256Canonical(approvalMaterial(parsed)),
  }, 'protected approval record');
}

function assertApprovalDigest(approval: ProtectedApprovalRecord): void {
  if (approval.recordDigest !== sha256Canonical(approvalMaterial(approval))) {
    throw new ProtectedPolicyError('Approval record digest does not match protected channel bytes');
  }
}

function exactStrings(left: readonly string[], right: readonly string[]): boolean {
  return canonicalJson([...left].sort()) === canonicalJson([...right].sort());
}

export async function authorizeProtectedAction(input: {
  request: unknown;
  channel: ProtectedApprovalChannel;
  now: string;
  consumedApprovalIds: readonly string[];
  currentRepository: RepositoryObservation;
}): Promise<ProtectedPolicyDecision> {
  const request = parseBoundary(ProtectedActionRequestSchema, input.request, 'protected action request');
  const now = parseBoundary(TimestampSchema, input.now, 'protected policy clock');
  const currentRepository = parseBoundary(
    RepositoryObservationSchema,
    input.currentRepository,
    'protected policy repository observation'
  );
  const consumedApprovalIds = parseBoundary(
    z.array(StableIdSchema).max(MAX_COLLECTION_ITEMS).superRefine((ids, ctx) => {
      if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'consumed approval identities must be unique' });
    }),
    input.consumedApprovalIds,
    'protected policy consumed approval identities'
  );
  if (input.channel.location !== 'protected_external') {
    throw new ProtectedPolicyError('Approval truth must come from a protected external channel');
  }
  if (request.retryOf !== null || request.attempt !== 1) {
    throw new ProtectedPolicyError('Approval cannot be inherited, reused for retry, or applied to a contingency');
  }
  if (!sameRepositoryObservation(request.repositoryPrecondition, currentRepository)) {
    throw new ProtectedPolicyError('Protected request repository precondition is stale');
  }
  const rawApproval = await input.channel.read(request.approvalId);
  if (rawApproval === null) throw new ProtectedPolicyError('Protected approval record is missing');
  const approval = parseBoundary(ProtectedApprovalRecordSchema, rawApproval, 'protected channel approval');
  assertApprovalDigest(approval);
  const digest = protectedRequestDigest(request);
  const nowMs = Date.parse(now);
  if (
    approval.id !== request.approvalId
    || approval.requestId !== request.id
    || approval.requestDigest !== digest
    || approval.action !== request.action
    || approval.workflowId !== request.workflowId
    || approval.featureId !== request.featureId
    || approval.sessionId !== request.sessionId
    || approval.target !== request.target
    || !exactStrings(approval.exactScope, request.exactScope)
    || !sameRepositoryObservation(approval.repositoryPrecondition, request.repositoryPrecondition)
  ) {
    throw new ProtectedPolicyError('Approval is mismatched, widened, inherited, or bound to another request');
  }
  if (
    approval.consumptionState !== 'active'
    || approval.consumedAt !== null
    || approval.revokedAt !== null
    || consumedApprovalIds.includes(approval.id)
  ) {
    throw new ProtectedPolicyError('Approval is revoked, consumed, or already present in protected history');
  }
  if (
    Date.parse(approval.issuedAt) < Date.parse(request.createdAt)
    || Date.parse(approval.issuedAt) > nowMs
    || Date.parse(approval.expiresAt) < nowMs
  ) {
    throw new ProtectedPolicyError('Approval is not currently valid');
  }
  if (request.action === 'paid_model_or_service_call') {
    const estimate = request.paidEstimate as z.infer<typeof PaidEstimateSchema>;
    const requestedLimit = request.requestedLimitUsd as number;
    const approvedEstimate = approval.approvedEstimateUsd as number;
    const approvedLimit = approval.approvedLimitUsd as number;
    if (estimate.estimatedUsd !== approvedEstimate || requestedLimit !== approvedLimit) {
      throw new ProtectedPolicyError('Paid approval estimate or lower limit does not exactly match the request');
    }
    if (estimate.estimatedUsd > REPOSITORY_PAID_HARD_CAP_USD || approvedLimit > REPOSITORY_PAID_HARD_CAP_USD) {
      throw new ProtectedPolicyError('Paid request exceeds the repository USD 5 per-run hard cap');
    }
  }
  if (request.action === 'push' || request.action === 'merge') {
    if (request.executionMode !== 'human_external' || request.automatic) {
      throw new ProtectedPolicyError('Automatic or controller-executed push and merge are impossible');
    }
    const consumptionId = `consumption:${request.operationId}`;
    const consumedApproval = createProtectedApprovalRecord({
      ...approvalMaterial(approval),
      consumptionState: 'consumed',
      consumedAt: now,
      consumptionId,
    });
    return parseBoundary(ProtectedPolicyDecisionSchema, {
      schemaVersion: PROTECTED_POLICY_SCHEMA_VERSION,
      policyVersion: PROTECTED_POLICY_VERSION,
      requestId: request.id,
      requestDigest: digest,
      status: 'manual_only',
      action: request.action,
      approvalId: approval.id,
      consumptionId,
      consumedApproval,
      paidLimitUsd: null,
      reason: 'Human performs this external Git action; controller has no execution path.',
    }, 'manual protected action decision');
  }
  if (request.automatic) throw new ProtectedPolicyError('Protected actions cannot be automatic');
  const consumptionId = `consumption:${request.operationId}`;
  const consumedApproval = createProtectedApprovalRecord({
    ...approvalMaterial(approval),
    consumptionState: 'consumed',
    consumedAt: now,
    consumptionId,
  });
  return parseBoundary(ProtectedPolicyDecisionSchema, {
    schemaVersion: PROTECTED_POLICY_SCHEMA_VERSION,
    policyVersion: PROTECTED_POLICY_VERSION,
    requestId: request.id,
    requestDigest: digest,
    status: 'authorized',
    action: request.action,
    approvalId: approval.id,
    consumptionId,
    consumedApproval,
    paidLimitUsd: approval.approvedLimitUsd,
    reason: 'Exact protected request and unused external approval match.',
  }, 'protected action decision');
}

export function validatePaidActuals(decisionValue: unknown, actualsValue: unknown): PaidActuals {
  const decision = parseBoundary(ProtectedPolicyDecisionSchema, decisionValue, 'paid policy decision');
  const actuals = parseBoundary(PaidActualsSchema, actualsValue, 'paid actuals');
  if (decision.action !== 'paid_model_or_service_call' || decision.status !== 'authorized') {
    throw new ProtectedPolicyError('Paid actuals require an authorized paid action');
  }
  if (decision.paidLimitUsd === null || actuals.actualUsd > decision.paidLimitUsd) {
    throw new ProtectedPolicyError('Paid actual exceeds the approved lower cap');
  }
  return actuals;
}

export const RetentionDeclarationSchema = z.strictObject({
  id: StableIdSchema,
  schemaVersion: z.literal(PROTECTED_POLICY_SCHEMA_VERSION),
  createdAt: TimestampSchema,
  workflowId: StableIdSchema,
  mode: z.enum(['retain_until', 'delete_on_completion', 'operator_managed']),
  expiresAt: TimestampSchema.nullable(),
  maxArtifactBytes: z.number().int().positive().max(256 * 1_024 * 1_024),
  deleteRawTranscripts: z.literal(true),
}).superRefine((declaration, ctx) => {
  if ((declaration.mode === 'retain_until') !== (declaration.expiresAt !== null)) {
    ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'retain_until requires expiry; other modes forbid it' });
  }
});

export type RetentionDeclaration = z.infer<typeof RetentionDeclarationSchema>;

export const RetentionTombstoneSchema = z.strictObject({
  id: StableIdSchema,
  schemaVersion: z.literal(PROTECTED_POLICY_SCHEMA_VERSION),
  createdAt: TimestampSchema,
  workflowId: StableIdSchema,
  declarationId: StableIdSchema,
  reason: z.enum(['expired', 'operator_deleted', 'completed']),
  deletedArtifactCount: z.number().int().nonnegative().max(1_000_000),
  preservedEventId: StableIdSchema,
  preservedResult: z.enum(['ready_for_owner_review', 'blocked', 'failed', 'cancelled']),
  sensitiveMaterialRetained: z.literal(false),
});

export type RetentionTombstone = z.infer<typeof RetentionTombstoneSchema>;

export function createRetentionTombstone(input: {
  declaration: unknown;
  createdAt: string;
  reason: RetentionTombstone['reason'];
  deletedArtifactCount: number;
  preservedEventId: string;
  preservedResult: RetentionTombstone['preservedResult'];
}): RetentionTombstone {
  const declaration = parseBoundary(RetentionDeclarationSchema, input.declaration, 'retention declaration');
  return parseBoundary(RetentionTombstoneSchema, {
    id: `tombstone:${declaration.id}:${input.reason}`,
    schemaVersion: PROTECTED_POLICY_SCHEMA_VERSION,
    createdAt: input.createdAt,
    workflowId: declaration.workflowId,
    declarationId: declaration.id,
    reason: input.reason,
    deletedArtifactCount: input.deletedArtifactCount,
    preservedEventId: input.preservedEventId,
    preservedResult: input.preservedResult,
    sensitiveMaterialRetained: false,
  }, 'retention tombstone');
}

export const MetricLabelsSchema = z.strictObject({
  component: z.enum(['controller', 'verifier', 'policy', 'recovery', 'checker']),
  operation: z.enum(['verify', 'authorize', 'classify', 'check', 'retain']),
  status: z.enum(['started', 'passed', 'refused', 'blocked', 'failed']),
  failureClass: z.enum([
    'none', 'transient', 'environmental', 'implementation', 'specification',
    'policy', 'harness', 'unknown_side_effect', 'cancelled',
  ]),
});

export type MetricLabels = z.infer<typeof MetricLabelsSchema>;

export const RedactionConfigurationSchema = z.strictObject({
  sensitiveValues: z.array(utf8String(1_024, 4)).max(MAX_REDACTION_VALUES).superRefine((values, ctx) => {
    if (new Set(values).size !== values.length) ctx.addIssue({ code: 'custom', message: 'sensitive values must be unique' });
  }),
});

export interface RedactedBoundary<T> {
  value: T;
  redactionCount: number;
}

export function redactForPersistence<T>(value: T, configurationValue: unknown): RedactedBoundary<T> {
  const configuration = parseBoundary(RedactionConfigurationSchema, configurationValue, 'redaction configuration');
  const redact = createRunnerRedactor(configuration.sensitiveValues);
  let redactionCount = 0;
  const visit = (candidate: unknown): unknown => {
    if (typeof candidate === 'string') {
      const redacted = redact(candidate);
      redactionCount += redacted.count;
      return redacted.text;
    }
    if (Array.isArray(candidate)) return candidate.map(visit);
    if (candidate !== null && typeof candidate === 'object') {
      return Object.fromEntries(Object.entries(candidate).map(([key, nested]) => [key, visit(nested)]));
    }
    return candidate;
  };
  return { value: visit(structuredClone(value)) as T, redactionCount };
}

export function assertNoRawSensitiveValues(value: unknown, configurationValue: unknown): void {
  const configuration = parseBoundary(RedactionConfigurationSchema, configurationValue, 'redaction assertion configuration');
  const encoded = canonicalJson(value);
  if (configuration.sensitiveValues.some(secret => encoded.includes(secret))) {
    throw new ProtectedPolicyError('Persistence boundary contains configured sensitive material');
  }
  if (/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/iu.test(encoded)) {
    throw new ProtectedPolicyError('Persistence boundary contains a bearer token');
  }
}
