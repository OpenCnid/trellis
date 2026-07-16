import { describe, expect, it } from 'vitest';
import {
  PROTECTED_ACTIONS,
  PROTECTED_POLICY_SCHEMA_VERSION,
  PROTECTED_POLICY_VERSION,
  MetricLabelsSchema,
  ProtectedActionRequestSchema,
  ProtectedPolicyError,
  REPOSITORY_PAID_HARD_CAP_USD,
  RetentionDeclarationSchema,
  authorizeProtectedAction,
  createProtectedApprovalRecord,
  createRetentionTombstone,
  protectedRequestDigest,
  redactForPersistence,
  assertNoRawSensitiveValues,
  validatePaidActuals,
  type ProtectedAction,
  type ProtectedActionRequest,
  type ProtectedApprovalChannel,
  type ProtectedApprovalRecord,
} from '../src/policy';

const NOW = '2026-07-15T12:00:00.000Z';
const REPOSITORY = {
  repositoryId: 'repo:trellis',
  worktreeId: 'worktree:el06',
  branch: 'implement-el06-verification-gates',
  baseCommit: '27bb7abbf9399c064bc578a2f12328eacb52c1a2',
  headCommit: '27bb7abbf9399c064bc578a2f12328eacb52c1a2',
  clean: true,
} as const;

function request(action: ProtectedAction = 'policy_change', overrides: Partial<ProtectedActionRequest> = {}): ProtectedActionRequest {
  const paid = action === 'paid_model_or_service_call';
  return ProtectedActionRequestSchema.parse({
    id: `request:${action}`,
    schemaVersion: PROTECTED_POLICY_SCHEMA_VERSION,
    policyVersion: PROTECTED_POLICY_VERSION,
    createdAt: '2026-07-15T10:00:00.000Z',
    workflowId: 'workflow:engineering-loop',
    featureId: 'EL-06',
    sessionId: 'session:60',
    action,
    executionMode: action === 'push' || action === 'merge' ? 'human_external' : 'controller_effect',
    target: `target:${action}`,
    exactScope: ['tools/engineering-loop'],
    repositoryPrecondition: REPOSITORY,
    approvalId: `approval:${action}`,
    operationId: `operation:${action}`,
    attempt: 1,
    retryOf: null,
    automatic: false,
    paidEstimate: paid ? { estimatedUsd: 1.25, estimatedInputTokens: 10_000, estimatedOutputTokens: 2_000 } : null,
    requestedLimitUsd: paid ? 2 : null,
    ...overrides,
  });
}

function approval(
  protectedRequest: ProtectedActionRequest,
  overrides: Partial<Omit<ProtectedApprovalRecord, 'recordDigest'>> = {}
): ProtectedApprovalRecord {
  return createProtectedApprovalRecord({
    id: protectedRequest.approvalId,
    schemaVersion: PROTECTED_POLICY_SCHEMA_VERSION,
    createdAt: NOW,
    channel: 'protected_external',
    channelRecordId: `channel:${protectedRequest.action}`,
    issuer: 'owner:darian',
    workflowId: protectedRequest.workflowId,
    featureId: protectedRequest.featureId,
    sessionId: protectedRequest.sessionId,
    action: protectedRequest.action,
    requestId: protectedRequest.id,
    requestDigest: protectedRequestDigest(protectedRequest),
    target: protectedRequest.target,
    exactScope: [...protectedRequest.exactScope],
    repositoryPrecondition: protectedRequest.repositoryPrecondition,
    approvedEstimateUsd: protectedRequest.paidEstimate?.estimatedUsd ?? null,
    approvedLimitUsd: protectedRequest.requestedLimitUsd,
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

class Channel implements ProtectedApprovalChannel {
  readonly location = 'protected_external' as const;
  reads = 0;
  constructor(readonly record: unknown | null) {}
  async read(): Promise<unknown | null> {
    this.reads++;
    return structuredClone(this.record);
  }
}

async function authorize(protectedRequest: ProtectedActionRequest, record = approval(protectedRequest), consumed: string[] = []) {
  return authorizeProtectedAction({
    request: protectedRequest,
    channel: new Channel(record),
    now: NOW,
    consumedApprovalIds: consumed,
    currentRepository: REPOSITORY,
  });
}

describe('EL-06 protected action and approval policy', () => {
  it('covers every SPEC protected action with a strict typed request that pauses for external approval', () => {
    // EL-10 added `ledger_recovery` (SPEC 6.1, EL-REQ-BOOT-006). Extending this
    // list is itself a `policy_change` and lands under EL-10's
    // owner_ratification and human_review gates, per EL-REQ-APPROVAL-007. The
    // action is distinct from `acceptance_change` so that the three ledger
    // ceremony predicates stay disjoint and mechanically checkable without a
    // mode flag.
    expect(PROTECTED_ACTIONS).toEqual([
      'paid_model_or_service_call', 'destructive_filesystem', 'destructive_database', 'destructive_queue',
      'destructive_external_system', 'push', 'merge', 'acceptance_change', 'ledger_recovery', 'controller_change',
      'policy_change', 'schema_change', 'prompt_change', 'verifier_change', 'gate_change', 'renderer_change',
      'handoff_migration', 'pull_request_create', 'tracker_write',
    ]);
    for (const action of PROTECTED_ACTIONS) expect(request(action).action).toBe(action);
  });

  it('authorizes only an exact unused external record and returns atomic consumption material', async () => {
    const protectedRequest = request();
    const decision = await authorize(protectedRequest);
    expect(decision.status).toBe('authorized');
    expect(decision.requestDigest).toBe(protectedRequestDigest(protectedRequest));
    expect(decision.consumedApproval?.consumptionState).toBe('consumed');
    expect(decision.consumedApproval?.consumedAt).toBe(NOW);
    expect(decision.consumptionId).toBe(`consumption:${protectedRequest.operationId}`);
  });

  it.each([
    ['action mismatch', (item: ProtectedActionRequest) => approval(item, { action: 'schema_change' })],
    ['workflow inheritance', (item: ProtectedActionRequest) => approval(item, { workflowId: 'workflow:other' })],
    ['session inheritance', (item: ProtectedActionRequest) => approval(item, { sessionId: 'session:other' })],
    ['target mismatch', (item: ProtectedActionRequest) => approval(item, { target: 'target:other' })],
    ['scope widening', (item: ProtectedActionRequest) => approval(item, { exactScope: ['tools'] })],
    ['repository mismatch', (item: ProtectedActionRequest) => approval(item, { repositoryPrecondition: { ...REPOSITORY, clean: false } })],
    ['expiry', (item: ProtectedActionRequest) => approval(item, { expiresAt: '2026-07-15T11:30:00.000Z' })],
    ['issue time before request', (item: ProtectedActionRequest) => approval(item, { issuedAt: '2026-07-15T09:00:00.000Z' })],
    ['consumed state', (item: ProtectedActionRequest) => approval(item, { consumptionState: 'consumed', consumedAt: NOW, consumptionId: 'consumption:prior' })],
    ['revocation', (item: ProtectedActionRequest) => approval(item, { consumptionState: 'revoked', revokedAt: NOW, revocationReason: 'owner revoked' })],
  ] as const)('refuses %s', async (_label, makeRecord) => {
    const protectedRequest = request();
    await expect(authorize(protectedRequest, makeRecord(protectedRequest))).rejects.toBeInstanceOf(ProtectedPolicyError);
  });

  it('refuses missing protected-channel truth, repository prose, and prior protected consumption history', async () => {
    const protectedRequest = request();
    await expect(authorize(protectedRequest, null)).rejects.toThrow(/missing/);
    await expect(authorize(protectedRequest, approval(protectedRequest), [protectedRequest.approvalId])).rejects.toThrow(/history/);
    const repositoryClaim = { ...approval(protectedRequest), channel: 'repository_file' };
    await expect(authorize(protectedRequest, repositoryClaim)).rejects.toThrow();
  });

  it('refuses contingency, retry, and automatic reuse before approval lookup', async () => {
    const retry = { ...request(), retryOf: 'request:prior' };
    const channel = new Channel(approval(request()));
    await expect(authorizeProtectedAction({
      request: retry, channel, now: NOW, consumedApprovalIds: [], currentRepository: REPOSITORY,
    })).rejects.toThrow(/retry/);
    expect(channel.reads).toBe(0);
    await expect(authorize(request('policy_change', { automatic: true }))).rejects.toThrow(/automatic/);
  });

  it('enforces estimate-before-approval, USD 5 hard cap, lower approved limit, and actual token/cost reporting without invoking paid work', async () => {
    const paid = request('paid_model_or_service_call');
    const decision = await authorize(paid);
    expect(decision.paidLimitUsd).toBe(2);
    expect(validatePaidActuals(decision, { inputTokens: 11_000, outputTokens: 2_500, actualUsd: 1.75 })).toEqual({
      inputTokens: 11_000, outputTokens: 2_500, actualUsd: 1.75,
    });
    expect(() => validatePaidActuals(decision, { inputTokens: 11_000, outputTokens: 2_500, actualUsd: 2.01 })).toThrow(/lower cap/);
    expect(() => request('paid_model_or_service_call', { requestedLimitUsd: REPOSITORY_PAID_HARD_CAP_USD + 0.01 })).toThrow();
    await expect(authorize(paid, approval(paid, { approvedLimitUsd: 2.5 }))).rejects.toThrow(/estimate or lower limit/);
  });

  it.each(['push', 'merge'] as const)('makes automatic/controller %s impossible under every configuration and leaves execution manual', async action => {
    const manual = request(action);
    const decision = await authorize(manual);
    expect(decision.status).toBe('manual_only');
    expect(decision.consumedApproval?.consumptionState).toBe('consumed');
    await expect(authorize({ ...manual, executionMode: 'controller_effect' })).rejects.toThrow(/impossible/);
    await expect(authorize({ ...manual, automatic: true })).rejects.toThrow(/impossible/);
  });

  it('requires retention declaration before execution and leaves a non-sensitive tombstone on expiry or deletion', () => {
    const retention = RetentionDeclarationSchema.parse({
      id: 'retention:workflow', schemaVersion: 1, createdAt: NOW, workflowId: 'workflow:engineering-loop',
      mode: 'retain_until', expiresAt: '2026-07-16T12:00:00.000Z', maxArtifactBytes: 1024, deleteRawTranscripts: true,
    });
    const tombstone = createRetentionTombstone({
      declaration: retention,
      createdAt: '2026-07-16T12:00:00.000Z',
      reason: 'expired',
      deletedArtifactCount: 3,
      preservedEventId: 'event:terminal',
      preservedResult: 'ready_for_owner_review',
    });
    expect(tombstone.reason).toBe('expired');
    expect(JSON.stringify(tombstone)).not.toContain('credential');
    expect(tombstone.preservedEventId).toBe('event:terminal');
  });

  it('redacts configured secrets and bearer values before persistence or prompt reuse', () => {
    const configuration = { sensitiveValues: ['approval-secret', 'sk-private-value'] };
    const redacted = redactForPersistence({ event: 'approval-secret', prompt: 'Bearer abc.def', nested: ['sk-private-value'] }, configuration);
    expect(redacted.redactionCount).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(redacted.value)).not.toContain('approval-secret');
    expect(() => assertNoRawSensitiveValues(redacted.value, configuration)).not.toThrow();
    expect(() => assertNoRawSensitiveValues({ value: 'approval-secret' }, configuration)).toThrow(/sensitive/);
  });

  it('limits metric labels to bounded coarse enums and rejects commands, paths, hashes, URLs, or model content', () => {
    expect(MetricLabelsSchema.parse({
      component: 'verifier', operation: 'verify', status: 'passed', failureClass: 'none',
    })).toEqual({ component: 'verifier', operation: 'verify', status: 'passed', failureClass: 'none' });
    expect(() => MetricLabelsSchema.parse({
      component: 'verifier', operation: 'npm test', status: 'passed', failureClass: 'none',
    })).toThrow();
    expect(() => MetricLabelsSchema.parse({
      component: 'verifier', operation: 'verify', status: 'passed', failureClass: 'none', path: 'tools/engineering-loop',
    })).toThrow();
  });
});
