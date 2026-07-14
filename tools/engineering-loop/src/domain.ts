import { z } from 'zod';

export const DOMAIN_SCHEMA_VERSION = 1 as const;
export const MAX_ID_LENGTH = 128;
export const MAX_TEXT_LENGTH = 4_096;
export const MAX_PATH_LENGTH = 512;
export const MAX_COLLECTION_ITEMS = 128;
export const MAX_METADATA_ITEMS = 64;
export const GENESIS_DIGEST = '0'.repeat(64);

export const StableIdSchema = z
  .string()
  .min(1)
  .max(MAX_ID_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'must be a stable identifier');

const TimestampSchema = z.string().datetime({ offset: true });
const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/, 'must be a lowercase sha256 digest');
const BoundedTextSchema = z.string().min(1).max(MAX_TEXT_LENGTH);
const BoundedPathSchema = z.string().min(1).max(MAX_PATH_LENGTH);

function uniqueArray<T extends z.ZodTypeAny>(schema: T, max = MAX_COLLECTION_ITEMS) {
  return z.array(schema).max(max).superRefine((values, ctx) => {
    if (new Set(values.map(value => JSON.stringify(value))).size !== values.length) {
      ctx.addIssue({ code: 'custom', message: 'items must be unique' });
    }
  });
}

export const WorkflowStateSchema = z.enum([
  'selected',
  'preparing',
  'running',
  'verifying',
  'awaiting_approval',
  'awaiting_review',
  'recovering',
  'accepted',
  'blocked',
  'failed',
  'cancelled',
]);

export type WorkflowState = z.infer<typeof WorkflowStateSchema>;

export const ActorAuthoritySchema = z.enum([
  'controller',
  'human',
  'runner',
  'checker',
  'model',
]);

export type ActorAuthority = z.infer<typeof ActorAuthoritySchema>;

export const EvidenceOriginSchema = z.enum([
  'controller_observed',
  'human_issued',
  'runner_reported',
  'checker_reported',
  'externally_reconciled',
]);

export const RepositoryObservationSchema = z.strictObject({
  repositoryId: StableIdSchema,
  worktreeId: StableIdSchema,
  branch: z.string().min(1).max(256),
  baseCommit: DigestSchema,
  headCommit: DigestSchema,
  clean: z.boolean(),
});

export type RepositoryObservation = z.infer<typeof RepositoryObservationSchema>;

const AcceptanceCriterionSchema = z.strictObject({
  id: StableIdSchema,
  kind: z.enum(['static', 'integration', 'review', 'measurement']),
  requirement: BoundedTextSchema,
});

const MetadataEntrySchema = z.strictObject({
  key: z.string().min(1).max(64),
  value: z.string().max(512),
});

export const WorkflowSchema = z.strictObject({
  id: StableIdSchema,
  schemaVersion: z.literal(DOMAIN_SCHEMA_VERSION),
  createdAt: TimestampSchema,
  policyVersion: StableIdSchema,
  catalogDigest: DigestSchema,
  repositoryId: StableIdSchema,
  featureIds: uniqueArray(StableIdSchema).min(1),
});

export type Workflow = z.infer<typeof WorkflowSchema>;

export const FeatureSchema = z.strictObject({
  id: StableIdSchema,
  schemaVersion: z.literal(DOMAIN_SCHEMA_VERSION),
  createdAt: TimestampSchema,
  workflowId: StableIdSchema,
  featureId: StableIdSchema,
  order: z.number().int().min(0).max(10_000),
  dependencies: uniqueArray(StableIdSchema),
  scope: uniqueArray(BoundedPathSchema).min(1),
  artifacts: uniqueArray(BoundedPathSchema),
  acceptanceCriteria: uniqueArray(AcceptanceCriterionSchema).min(1),
  gates: uniqueArray(StableIdSchema, 32),
  paidWork: z.enum(['forbidden', 'owner_gated', 'separately_proposed']),
  definitionDigest: DigestSchema,
});

export type Feature = z.infer<typeof FeatureSchema>;

export const EffectIntentSchema = z.strictObject({
  id: StableIdSchema,
  schemaVersion: z.literal(DOMAIN_SCHEMA_VERSION),
  createdAt: TimestampSchema,
  workflowId: StableIdSchema,
  featureId: StableIdSchema,
  sessionId: StableIdSchema,
  operationId: StableIdSchema,
  idempotencyKey: StableIdSchema.nullable(),
  target: StableIdSchema,
  exactScope: uniqueArray(BoundedTextSchema, 32).min(1),
  approvalId: StableIdSchema.nullable(),
  preconditions: uniqueArray(BoundedTextSchema, 32),
});

export type EffectIntent = z.infer<typeof EffectIntentSchema>;

export const EffectOutcomeSchema = z.strictObject({
  id: StableIdSchema,
  schemaVersion: z.literal(DOMAIN_SCHEMA_VERSION),
  createdAt: TimestampSchema,
  workflowId: StableIdSchema,
  featureId: StableIdSchema,
  sessionId: StableIdSchema,
  operationId: StableIdSchema,
  idempotencyKey: StableIdSchema.nullable(),
  status: z.enum(['succeeded', 'failed', 'unknown']),
  resultDigest: DigestSchema.nullable(),
  detail: z.string().max(1_024),
  reconciliationRequired: BoundedTextSchema.nullable(),
}).superRefine((outcome, ctx) => {
  if (outcome.status === 'succeeded' && outcome.resultDigest === null) {
    ctx.addIssue({ code: 'custom', path: ['resultDigest'], message: 'succeeded outcome requires resultDigest' });
  }
  if (outcome.status === 'unknown' && outcome.reconciliationRequired === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['reconciliationRequired'],
      message: 'unknown outcome requires reconciliationRequired',
    });
  }
});

export type EffectOutcome = z.infer<typeof EffectOutcomeSchema>;

export const SessionSchema = z.strictObject({
  id: StableIdSchema,
  schemaVersion: z.literal(DOMAIN_SCHEMA_VERSION),
  createdAt: TimestampSchema,
  workflowId: StableIdSchema,
  featureId: StableIdSchema,
  definitionDigest: DigestSchema,
  expectedRepository: RepositoryObservationSchema,
  scopeDigest: DigestSchema,
  state: WorkflowStateSchema,
  resumeState: WorkflowStateSchema.nullable(),
  episodeIds: uniqueArray(StableIdSchema),
  evidenceIds: uniqueArray(StableIdSchema),
  approvalIds: uniqueArray(StableIdSchema),
  result: z.enum(['ready_for_owner_review', 'blocked', 'failed', 'cancelled']).nullable(),
});

export type Session = z.infer<typeof SessionSchema>;

export const EpisodeSchema = z.strictObject({
  id: StableIdSchema,
  schemaVersion: z.literal(DOMAIN_SCHEMA_VERSION),
  createdAt: TimestampSchema,
  workflowId: StableIdSchema,
  featureId: StableIdSchema,
  sessionId: StableIdSchema,
  role: z.enum(['planner', 'implementer', 'checker', 'recovery']),
  semanticPhase: StableIdSchema,
  definitionDigest: DigestSchema,
  repositoryPrecondition: RepositoryObservationSchema,
  promptDigest: DigestSchema,
  timeBudgetMs: z.number().int().positive().max(86_400_000),
  turnBudget: z.number().int().positive().max(1_000),
  contextBudgetTokens: z.number().int().positive().max(10_000_000),
  runnerId: StableIdSchema.nullable(),
  threadId: StableIdSchema.nullable(),
  turnId: StableIdSchema.nullable(),
  terminalReason: z.string().max(1_024).nullable(),
});

export type Episode = z.infer<typeof EpisodeSchema>;

export const ApprovalSchema = z.strictObject({
  id: StableIdSchema,
  schemaVersion: z.literal(DOMAIN_SCHEMA_VERSION),
  createdAt: TimestampSchema,
  workflowId: StableIdSchema,
  featureId: StableIdSchema,
  sessionId: StableIdSchema,
  issuer: StableIdSchema,
  protectedAction: StableIdSchema,
  exactScope: uniqueArray(BoundedTextSchema, 32).min(1),
  repositoryPrecondition: RepositoryObservationSchema,
  estimate: z.strictObject({
    unit: z.enum(['usd', 'operations', 'bytes']),
    value: z.number().nonnegative().max(1_000_000_000),
  }).nullable(),
  issuedAt: TimestampSchema,
  expiresAt: TimestampSchema,
  consumptionState: z.enum(['active', 'consumed', 'revoked']),
  consumedAt: TimestampSchema.nullable(),
}).superRefine((approval, ctx) => {
  if (approval.consumptionState === 'consumed' && approval.consumedAt === null) {
    ctx.addIssue({ code: 'custom', path: ['consumedAt'], message: 'consumed approval requires consumedAt' });
  }
  if (approval.consumptionState !== 'consumed' && approval.consumedAt !== null) {
    ctx.addIssue({ code: 'custom', path: ['consumedAt'], message: 'unused or revoked approval cannot have consumedAt' });
  }
});

export type Approval = z.infer<typeof ApprovalSchema>;

export const EvidenceSchema = z.strictObject({
  id: StableIdSchema,
  schemaVersion: z.literal(DOMAIN_SCHEMA_VERSION),
  createdAt: TimestampSchema,
  workflowId: StableIdSchema,
  featureId: StableIdSchema,
  sessionId: StableIdSchema,
  origin: EvidenceOriginSchema,
  observedAt: TimestampSchema,
  digest: DigestSchema.nullable(),
  immutableReference: z.string().min(1).max(1_024).nullable(),
  mediaType: z.string().min(1).max(128),
  byteCount: z.number().int().nonnegative().max(1_000_000_000),
  metadata: uniqueArray(MetadataEntrySchema, MAX_METADATA_ITEMS),
}).superRefine((evidence, ctx) => {
  if (evidence.digest === null && evidence.immutableReference === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['digest'],
      message: 'evidence requires a digest or immutableReference',
    });
  }
});

export type Evidence = z.infer<typeof EvidenceSchema>;

export const DecisionSchema = z.strictObject({
  id: StableIdSchema,
  schemaVersion: z.literal(DOMAIN_SCHEMA_VERSION),
  createdAt: TimestampSchema,
  workflowId: StableIdSchema,
  featureId: StableIdSchema,
  sessionId: StableIdSchema,
  fromState: WorkflowStateSchema.nullable(),
  toState: WorkflowStateSchema,
  actorAuthority: ActorAuthoritySchema,
  policyVersion: StableIdSchema,
  reason: BoundedTextSchema,
  evidenceIds: uniqueArray(StableIdSchema),
  approvalIds: uniqueArray(StableIdSchema),
  protectedAction: StableIdSchema.nullable(),
});

export type Decision = z.infer<typeof DecisionSchema>;

export const ReportSchema = z.strictObject({
  id: StableIdSchema,
  schemaVersion: z.literal(DOMAIN_SCHEMA_VERSION),
  createdAt: TimestampSchema,
  workflowId: StableIdSchema,
  featureId: StableIdSchema,
  sessionId: StableIdSchema,
  feature: StableIdSchema,
  result: z.enum(['ready_for_owner_review', 'blocked']),
  artifacts: uniqueArray(BoundedPathSchema),
  normativeRequirements: z.strictObject({
    required: z.number().int().nonnegative().max(10_000),
    implemented: z.number().int().nonnegative().max(10_000),
    verified: z.number().int().nonnegative().max(10_000),
    outstanding: uniqueArray(StableIdSchema, 10_000),
  }),
  verification: z.array(z.strictObject({
    command: z.string().min(1).max(2_048),
    result: z.string().min(1).max(4_096),
  })).max(MAX_COLLECTION_ITEMS),
  findings: z.array(z.string().min(1).max(2_048)).max(MAX_COLLECTION_ITEMS),
  nextFeature: StableIdSchema.nullable(),
});

export type Report = z.infer<typeof ReportSchema>;

export const TransitionProofSchema = z.strictObject({
  dependenciesSatisfied: z.boolean(),
  scopeFixed: z.boolean(),
  repositoryPreflightValid: z.boolean(),
  rolePacketValid: z.boolean(),
  sameEpisodeEligible: z.boolean(),
  deterministicChecksPassed: z.boolean(),
  inScopeDiff: z.boolean(),
  noUnknownEffects: z.boolean(),
  humanReviewRecorded: z.boolean(),
  reconstructedState: WorkflowStateSchema.nullable(),
});

export type TransitionProof = z.infer<typeof TransitionProofSchema>;

export const StateSnapshotSchema = z.strictObject({
  id: StableIdSchema,
  schemaVersion: z.literal(DOMAIN_SCHEMA_VERSION),
  createdAt: TimestampSchema,
  workflowId: StableIdSchema,
  featureId: StableIdSchema,
  sessionId: StableIdSchema,
  definitionDigest: DigestSchema,
  scopeDigest: DigestSchema,
  expectedRepository: RepositoryObservationSchema,
  state: WorkflowStateSchema,
  resumeState: WorkflowStateSchema.nullable(),
  recoveryState: WorkflowStateSchema.nullable(),
  pendingProtectedAction: StableIdSchema.nullable(),
  lastEventSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  lastEventDigest: DigestSchema,
  evidenceIds: uniqueArray(StableIdSchema),
  approvalIds: uniqueArray(StableIdSchema),
  consumedApprovalIds: uniqueArray(StableIdSchema),
  intents: z.array(EffectIntentSchema).max(MAX_COLLECTION_ITEMS),
  outcomes: z.array(EffectOutcomeSchema).max(MAX_COLLECTION_ITEMS),
}).superRefine((snapshot, ctx) => {
  const retainsApprovalWait = (
    snapshot.state === 'awaiting_approval'
    || (snapshot.state === 'recovering' && snapshot.recoveryState === 'awaiting_approval')
  );
  if (retainsApprovalWait && (snapshot.resumeState === null || snapshot.pendingProtectedAction === null)) {
    ctx.addIssue({
      code: 'custom',
      path: ['pendingProtectedAction'],
      message: 'approval wait state requires a resume state and protected action',
    });
  }
  if (!retainsApprovalWait && (snapshot.resumeState !== null || snapshot.pendingProtectedAction !== null)) {
    ctx.addIssue({
      code: 'custom',
      path: ['pendingProtectedAction'],
      message: 'ordinary and terminal state cannot retain approval-wait authority',
    });
  }
});

export type StateSnapshot = z.infer<typeof StateSnapshotSchema>;

const TransitionEventPayloadSchema = z.strictObject({
  kind: z.literal('transition'),
  decision: DecisionSchema,
  proof: TransitionProofSchema,
  definitionDigest: DigestSchema,
  scopeDigest: DigestSchema,
  expectedRepository: RepositoryObservationSchema,
  evidence: z.array(EvidenceSchema).max(MAX_COLLECTION_ITEMS),
  consumedApprovals: z.array(ApprovalSchema).max(1),
});

const EffectIntentEventPayloadSchema = z.strictObject({
  kind: z.literal('effect_intent'),
  intent: EffectIntentSchema,
  consumedApproval: ApprovalSchema.nullable(),
});

const EffectOutcomeEventPayloadSchema = z.strictObject({
  kind: z.literal('effect_outcome'),
  outcome: EffectOutcomeSchema,
});

export const EventPayloadSchema = z.discriminatedUnion('kind', [
  TransitionEventPayloadSchema,
  EffectIntentEventPayloadSchema,
  EffectOutcomeEventPayloadSchema,
]);

export type EventPayload = z.infer<typeof EventPayloadSchema>;

export const EventSchema = z.strictObject({
  id: StableIdSchema,
  schemaVersion: z.literal(DOMAIN_SCHEMA_VERSION),
  createdAt: TimestampSchema,
  workflowId: StableIdSchema,
  featureId: StableIdSchema,
  sessionId: StableIdSchema,
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  previousDigest: DigestSchema,
  actor: ActorAuthoritySchema,
  eventType: z.enum(['transition', 'effect_intent', 'effect_outcome']),
  payload: EventPayloadSchema,
  digest: DigestSchema,
}).superRefine((event, ctx) => {
  if (event.eventType !== event.payload.kind) {
    ctx.addIssue({ code: 'custom', path: ['eventType'], message: 'eventType must match payload.kind' });
  }
});

export type DomainEvent = z.infer<typeof EventSchema>;

export class DomainValidationError extends Error {
  readonly boundary: string;

  constructor(boundary: string, issues: z.core.$ZodIssue[]) {
    const detail = issues.slice(0, 5).map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ');
    super(`Invalid ${boundary}: ${detail}`.slice(0, 1_024));
    this.name = 'DomainValidationError';
    this.boundary = boundary;
  }
}

export function parseBoundary<T>(schema: z.ZodType<T>, value: unknown, boundary: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new DomainValidationError(boundary, parsed.error.issues);
  return parsed.data;
}

export function sameRepositoryObservation(a: RepositoryObservation, b: RepositoryObservation): boolean {
  return (
    a.repositoryId === b.repositoryId
    && a.worktreeId === b.worktreeId
    && a.branch === b.branch
    && a.baseCommit === b.baseCommit
    && a.headCommit === b.headCommit
    && a.clean === b.clean
  );
}
