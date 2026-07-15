import { z } from 'zod';
import {
  RepositoryObservationSchema,
  StableIdSchema,
  parseBoundary,
  sameRepositoryObservation,
  type RepositoryObservation,
} from './domain.js';
import { canonicalJson, sha256Canonical } from './events.js';
import { RetentionDeclarationSchema } from './policy.js';

export const VERIFIER_SCHEMA_VERSION = 1 as const;
export const VERIFIER_POLICY_VERSION = 'trellis-deterministic-verifier:v1' as const;
export const MAX_ACCEPTANCE_COMMANDS = 32;
export const MAX_ACCEPTANCE_ARGV_ITEMS = 64;
export const MAX_ACCEPTANCE_ARG_BYTES = 2_048;
export const MAX_ACCEPTANCE_ENV_ITEMS = 32;
export const MAX_ACCEPTANCE_FINDINGS = 128;
export const MAX_ACCEPTANCE_OUTPUT_BYTES = 8 * 1_024 * 1_024;

const TimestampSchema = z.string().datetime({ offset: true });
const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const PathSchema = z.string().min(1).max(512).refine(value => !value.includes('\0'), 'path contains NUL');
const TextSchema = z.string().min(1).refine(value => Buffer.byteLength(value, 'utf8') <= 2_048, 'text exceeds 2048 UTF-8 bytes');
const RequirementIdSchema = z.string().regex(/^EL-REQ-[A-Z]+-\d{3}$/);

function uniqueStrings<T extends z.ZodTypeAny>(schema: T, max: number) {
  return z.array(schema).max(max).superRefine((values, ctx) => {
    if (new Set(values).size !== values.length) ctx.addIssue({ code: 'custom', message: 'items must be unique' });
  });
}

const ArgSchema = z.string().max(MAX_ACCEPTANCE_ARG_BYTES)
  .refine(value => Buffer.byteLength(value, 'utf8') <= MAX_ACCEPTANCE_ARG_BYTES, 'argv item exceeds byte bound')
  .refine(value => !value.includes('\0'), 'argv item contains NUL');
const ArgvSchema = z.array(ArgSchema).min(1).max(MAX_ACCEPTANCE_ARGV_ITEMS).superRefine((argv, ctx) => {
  if (argv.reduce((sum, value) => sum + Buffer.byteLength(value, 'utf8'), 0) > 16 * 1_024) {
    ctx.addIssue({ code: 'custom', message: 'argv exceeds total byte bound' });
  }
});

const EnvironmentEntrySchema = z.strictObject({
  name: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
  value: z.string().max(1_024).refine(value => Buffer.byteLength(value, 'utf8') <= 1_024),
}).superRefine((entry, ctx) => {
  if (/(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|COOKIE|PRIVATE|API_KEY)/u.test(entry.name)) {
    ctx.addIssue({ code: 'custom', path: ['name'], message: 'secret-bearing environment names are forbidden' });
  }
  if (/\bBearer\s+/iu.test(entry.value)) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'bearer values are forbidden' });
  }
});

const EnvironmentSchema = z.array(EnvironmentEntrySchema).max(MAX_ACCEPTANCE_ENV_ITEMS).superRefine((entries, ctx) => {
  const names = entries.map(entry => entry.name);
  if (new Set(names).size !== names.length) ctx.addIssue({ code: 'custom', message: 'environment names must be unique' });
  if (canonicalJson([...entries].sort((a, b) => a.name.localeCompare(b.name))) !== canonicalJson(entries)) {
    ctx.addIssue({ code: 'custom', message: 'environment must be name-sorted for exact binding' });
  }
});

export const EngineCountSchema = z.strictObject({
  name: z.enum(['test_files', 'tests', 'requirements', 'catalog_features', 'changed_paths', 'artifacts']),
  value: z.number().int().nonnegative().max(10_000_000),
});
const EngineCountsSchema = z.array(EngineCountSchema).max(16).superRefine((counts, ctx) => {
  const names = counts.map(count => count.name);
  if (new Set(names).size !== names.length) ctx.addIssue({ code: 'custom', message: 'engine count names must be unique' });
});

export const AcceptanceCommandSchema = z.strictObject({
  id: StableIdSchema,
  argv: ArgvSchema,
  cwd: PathSchema,
  environment: EnvironmentSchema,
  timeoutMs: z.number().int().positive().max(3_600_000),
  expectedExitCode: z.number().int().min(-2_147_483_648).max(2_147_483_647),
  expectedCounts: EngineCountsSchema,
});
export type AcceptanceCommand = z.infer<typeof AcceptanceCommandSchema>;

export const ImmutableAcceptanceDefinitionSchema = z.strictObject({
  id: StableIdSchema,
  schemaVersion: z.literal(VERIFIER_SCHEMA_VERSION),
  verifierPolicyVersion: z.literal(VERIFIER_POLICY_VERSION),
  createdAt: TimestampSchema,
  workflowId: StableIdSchema,
  featureId: StableIdSchema,
  sessionId: StableIdSchema,
  sourceDefinitionDigest: DigestSchema,
  repositoryPrecondition: RepositoryObservationSchema,
  dependencies: uniqueStrings(StableIdSchema, 64),
  scope: uniqueStrings(PathSchema, 128).min(1),
  requirementIds: uniqueStrings(RequirementIdSchema, 128).min(1),
  commands: z.array(AcceptanceCommandSchema).min(1).max(MAX_ACCEPTANCE_COMMANDS).superRefine((commands, ctx) => {
    const ids = commands.map(command => command.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'command identities must be unique' });
  }),
  protectedPreconditions: uniqueStrings(StableIdSchema, 32),
  retention: RetentionDeclarationSchema,
  definitionDigest: DigestSchema,
});
export type ImmutableAcceptanceDefinition = z.infer<typeof ImmutableAcceptanceDefinitionSchema>;

function definitionMaterial(definition: ImmutableAcceptanceDefinition): Omit<ImmutableAcceptanceDefinition, 'definitionDigest'> {
  const { definitionDigest: _digest, ...material } = definition;
  return material;
}

export function createImmutableAcceptanceDefinition(
  input: Omit<ImmutableAcceptanceDefinition, 'definitionDigest'>
): ImmutableAcceptanceDefinition {
  const candidate = parseBoundary(ImmutableAcceptanceDefinitionSchema, {
    ...input,
    definitionDigest: '0'.repeat(64),
  }, 'acceptance definition material');
  return parseBoundary(ImmutableAcceptanceDefinitionSchema, {
    ...candidate,
    definitionDigest: sha256Canonical(definitionMaterial(candidate)),
  }, 'immutable acceptance definition');
}

export function assertImmutableAcceptanceDefinition(value: unknown): ImmutableAcceptanceDefinition {
  const definition = parseBoundary(ImmutableAcceptanceDefinitionSchema, value, 'immutable acceptance definition');
  if (definition.definitionDigest !== sha256Canonical(definitionMaterial(definition))) {
    throw new VerificationError('Acceptance definition digest changed during the active session');
  }
  return definition;
}

const RetainedOutputSchema = z.strictObject({
  byteCount: z.number().int().nonnegative().max(MAX_ACCEPTANCE_OUTPUT_BYTES),
  digest: DigestSchema,
  retainedReference: TextSchema.nullable(),
}).superRefine((output, ctx) => {
  if ((output.byteCount === 0) !== (output.retainedReference === null)) {
    ctx.addIssue({ code: 'custom', path: ['retainedReference'], message: 'nonempty output requires a retained immutable reference' });
  }
});

export const ControllerCommandObservationSchema = z.strictObject({
  id: StableIdSchema,
  schemaVersion: z.literal(VERIFIER_SCHEMA_VERSION),
  origin: z.literal('controller_observed'),
  workflowId: StableIdSchema,
  featureId: StableIdSchema,
  sessionId: StableIdSchema,
  commandId: StableIdSchema,
  argv: ArgvSchema,
  cwd: PathSchema,
  environment: EnvironmentSchema,
  timeoutMs: z.number().int().positive().max(3_600_000),
  repositoryBefore: RepositoryObservationSchema,
  repositoryAfter: RepositoryObservationSchema,
  startedAt: TimestampSchema,
  endedAt: TimestampSchema,
  exitCode: z.number().int().min(-2_147_483_648).max(2_147_483_647).nullable(),
  signal: z.string().min(1).max(64).nullable(),
  timedOut: z.boolean(),
  cancelled: z.boolean(),
  stdout: RetainedOutputSchema,
  stderr: RetainedOutputSchema,
  engineCounts: EngineCountsSchema,
}).superRefine((observation, ctx) => {
  if ((observation.exitCode === null) === (observation.signal === null)) {
    ctx.addIssue({ code: 'custom', path: ['exitCode'], message: 'exactly one of exitCode and signal is required' });
  }
  if (Date.parse(observation.endedAt) < Date.parse(observation.startedAt)) {
    ctx.addIssue({ code: 'custom', path: ['endedAt'], message: 'command end precedes start' });
  }
});
export type ControllerCommandObservation = z.infer<typeof ControllerCommandObservationSchema>;

export interface DeterministicCommandPort {
  execute(command: AcceptanceCommand): Promise<unknown>;
}

export const AdvisoryEvidenceClaimSchema = z.strictObject({
  id: StableIdSchema,
  origin: z.enum(['runner_reported', 'checker_reported', 'model_reported', 'conversation_reported', 'repository_prose']),
  commandId: StableIdSchema,
  claimedPassed: z.boolean(),
  summary: TextSchema,
});
export type AdvisoryEvidenceClaim = z.infer<typeof AdvisoryEvidenceClaimSchema>;

export const VerificationFindingSchema = z.strictObject({
  id: StableIdSchema,
  code: z.enum([
    'missing_controller_evidence',
    'stale_definition',
    'binding_mismatch',
    'repository_mismatch',
    'unexpected_exit',
    'timed_out',
    'cancelled',
    'unretained_output',
    'count_mismatch',
    'contradictory_advisory_claim',
    'unverifiable_evidence',
  ]),
  commandId: StableIdSchema.nullable(),
  disposition: z.literal('stops_advancement'),
  summary: TextSchema,
});
export type VerificationFinding = z.infer<typeof VerificationFindingSchema>;

export const ControllerVerificationSchema = z.strictObject({
  id: StableIdSchema,
  schemaVersion: z.literal(VERIFIER_SCHEMA_VERSION),
  verifierPolicyVersion: z.literal(VERIFIER_POLICY_VERSION),
  createdAt: TimestampSchema,
  origin: z.literal('controller_observed'),
  workflowId: StableIdSchema,
  featureId: StableIdSchema,
  sessionId: StableIdSchema,
  acceptanceDefinitionId: StableIdSchema,
  acceptanceDefinitionDigest: DigestSchema,
  status: z.enum(['passed', 'failed']),
  observations: z.array(ControllerCommandObservationSchema).max(MAX_ACCEPTANCE_COMMANDS),
  findings: z.array(VerificationFindingSchema).max(MAX_ACCEPTANCE_FINDINGS),
  requiredCommandCount: z.number().int().positive().max(MAX_ACCEPTANCE_COMMANDS),
  observedCommandCount: z.number().int().nonnegative().max(MAX_ACCEPTANCE_COMMANDS),
  passedCommandCount: z.number().int().nonnegative().max(MAX_ACCEPTANCE_COMMANDS),
  reportDigest: DigestSchema,
}).superRefine((report, ctx) => {
  if (report.observedCommandCount !== report.observations.length) {
    ctx.addIssue({ code: 'custom', path: ['observedCommandCount'], message: 'must equal controller observation count' });
  }
  if (report.passedCommandCount > report.observedCommandCount) {
    ctx.addIssue({ code: 'custom', path: ['passedCommandCount'], message: 'cannot exceed observed command count' });
  }
  if (new Set(report.observations.map(item => item.id)).size !== report.observations.length) {
    ctx.addIssue({ code: 'custom', path: ['observations'], message: 'observation identities must be unique' });
  }
  if (new Set(report.observations.map(item => item.commandId)).size !== report.observations.length) {
    ctx.addIssue({ code: 'custom', path: ['observations'], message: 'each command may have only one controller observation' });
  }
  if (new Set(report.findings.map(item => item.id)).size !== report.findings.length) {
    ctx.addIssue({ code: 'custom', path: ['findings'], message: 'finding identities must be unique' });
  }
  const completePass = report.findings.length === 0
    && report.requiredCommandCount === report.observedCommandCount
    && report.requiredCommandCount === report.passedCommandCount;
  if ((report.status === 'passed') !== completePass) {
    ctx.addIssue({ code: 'custom', path: ['status'], message: 'must agree with complete controller evidence and zero findings' });
  }
});
export type ControllerVerification = z.infer<typeof ControllerVerificationSchema>;

export class VerificationError extends Error {
  constructor(message: string) {
    super(message.slice(0, 1_024));
    this.name = 'VerificationError';
  }
}

function exact<T>(left: T, right: T): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function outputIsRetained(output: z.infer<typeof RetainedOutputSchema>): boolean {
  return output.byteCount === 0 || output.retainedReference !== null;
}

function finding(code: VerificationFinding['code'], commandId: string | null, summary: string): VerificationFinding {
  return parseBoundary(VerificationFindingSchema, {
    id: `finding:${sha256Canonical({ code, commandId, summary }).slice(0, 32)}`,
    code,
    commandId,
    disposition: 'stops_advancement',
    summary,
  }, 'verification finding');
}

function reportMaterial(report: ControllerVerification): Omit<ControllerVerification, 'reportDigest'> {
  const { reportDigest: _digest, ...material } = report;
  return material;
}

/** Runs immutable commands separately through the injected controller effect. */
export async function verifyAcceptance(input: {
  definition: unknown;
  commandPort: DeterministicCommandPort;
  advisoryClaims?: readonly unknown[];
  createdAt: string;
  verificationId: string;
}): Promise<ControllerVerification> {
  const definition = parseBoundary(
    ImmutableAcceptanceDefinitionSchema,
    input.definition,
    'immutable acceptance definition'
  );
  if (definition.definitionDigest !== sha256Canonical(definitionMaterial(definition))) {
    const stale = parseBoundary(ControllerVerificationSchema, {
      id: input.verificationId,
      schemaVersion: VERIFIER_SCHEMA_VERSION,
      verifierPolicyVersion: VERIFIER_POLICY_VERSION,
      createdAt: input.createdAt,
      origin: 'controller_observed',
      workflowId: definition.workflowId,
      featureId: definition.featureId,
      sessionId: definition.sessionId,
      acceptanceDefinitionId: definition.id,
      acceptanceDefinitionDigest: definition.definitionDigest,
      status: 'failed',
      observations: [],
      findings: [finding('stale_definition', null, 'Acceptance definition digest changed during the active session.')],
      requiredCommandCount: definition.commands.length,
      observedCommandCount: 0,
      passedCommandCount: 0,
      reportDigest: '0'.repeat(64),
    }, 'stale controller verification material');
    return parseBoundary(ControllerVerificationSchema, {
      ...stale,
      reportDigest: sha256Canonical(reportMaterial(stale)),
    }, 'stale controller verification');
  }
  const advisoryClaims = (input.advisoryClaims ?? []).map(claim => (
    parseBoundary(AdvisoryEvidenceClaimSchema, claim, 'advisory evidence claim')
  ));
  const observations: ControllerCommandObservation[] = [];
  const findings: VerificationFinding[] = [];
  let passedCommandCount = 0;

  for (const command of definition.commands) {
    let observation: ControllerCommandObservation;
    try {
      observation = parseBoundary(
        ControllerCommandObservationSchema,
        await input.commandPort.execute(structuredClone(command)),
        `controller command observation ${command.id}`
      );
    } catch (error) {
      findings.push(finding('missing_controller_evidence', command.id, `No valid controller observation: ${(error as Error).message}`));
      continue;
    }
    observations.push(observation);
    let passed = true;
    if (
      observation.workflowId !== definition.workflowId
      || observation.featureId !== definition.featureId
      || observation.sessionId !== definition.sessionId
      || observation.commandId !== command.id
      || !exact(observation.argv, command.argv)
      || observation.cwd !== command.cwd
      || !exact(observation.environment, command.environment)
      || observation.timeoutMs !== command.timeoutMs
    ) {
      passed = false;
      findings.push(finding('binding_mismatch', command.id, 'Controller observation does not match exact command, session, cwd, environment, or timeout binding.'));
    }
    if (
      !sameRepositoryObservation(observation.repositoryBefore, definition.repositoryPrecondition)
      || !sameRepositoryObservation(observation.repositoryAfter, definition.repositoryPrecondition)
    ) {
      passed = false;
      findings.push(finding('repository_mismatch', command.id, 'Repository precondition changed before or during command observation.'));
    }
    if (observation.timedOut) {
      passed = false;
      findings.push(finding('timed_out', command.id, 'Controller observed command timeout.'));
    }
    if (observation.cancelled) {
      passed = false;
      findings.push(finding('cancelled', command.id, 'Controller observed command cancellation.'));
    }
    if (observation.exitCode !== command.expectedExitCode || observation.signal !== null) {
      passed = false;
      findings.push(finding('unexpected_exit', command.id, 'Controller-observed process status does not match the immutable expected exit.'));
    }
    if (!outputIsRetained(observation.stdout) || !outputIsRetained(observation.stderr)) {
      passed = false;
      findings.push(finding('unretained_output', command.id, 'Nonempty output lacks a digest-linked immutable retained reference.'));
    }
    if (!exact(observation.engineCounts, command.expectedCounts)) {
      passed = false;
      findings.push(finding('count_mismatch', command.id, 'Engine-observed counts do not exactly match immutable expectations.'));
    }
    if (passed) passedCommandCount++;

    for (const claim of advisoryClaims.filter(item => item.commandId === command.id)) {
      if (claim.claimedPassed !== passed) {
        findings.push(finding(
          'contradictory_advisory_claim',
          command.id,
          `${claim.id} from ${claim.origin} conflicts with controller observation and cannot alter it.`
        ));
      }
    }
  }

  const material = parseBoundary(ControllerVerificationSchema, {
    id: input.verificationId,
    schemaVersion: VERIFIER_SCHEMA_VERSION,
    verifierPolicyVersion: VERIFIER_POLICY_VERSION,
    createdAt: input.createdAt,
    origin: 'controller_observed',
    workflowId: definition.workflowId,
    featureId: definition.featureId,
    sessionId: definition.sessionId,
    acceptanceDefinitionId: definition.id,
    acceptanceDefinitionDigest: definition.definitionDigest,
    status: findings.length === 0 && passedCommandCount === definition.commands.length ? 'passed' : 'failed',
    observations,
    findings,
    requiredCommandCount: definition.commands.length,
    observedCommandCount: observations.length,
    passedCommandCount,
    reportDigest: '0'.repeat(64),
  }, 'controller verification material');
  return parseBoundary(ControllerVerificationSchema, {
    ...material,
    reportDigest: sha256Canonical(reportMaterial(material)),
  }, 'controller verification');
}

export const HumanReviewSchema = z.strictObject({
  id: StableIdSchema,
  schemaVersion: z.literal(VERIFIER_SCHEMA_VERSION),
  createdAt: TimestampSchema,
  channel: z.literal('protected_external'),
  issuer: StableIdSchema,
  workflowId: StableIdSchema,
  featureId: StableIdSchema,
  sessionId: StableIdSchema,
  verificationDigest: DigestSchema,
  decision: z.enum(['accepted', 'changes_requested', 'blocked']),
  signatureReference: TextSchema,
});
export type HumanReview = z.infer<typeof HumanReviewSchema>;

export const GateEvaluationSchema = z.strictObject({
  state: z.enum(['verifying', 'awaiting_review', 'accepted', 'blocked']),
  controllerVerificationPassed: z.boolean(),
  dependenciesSatisfied: z.boolean(),
  scopeSatisfied: z.boolean(),
  repositorySatisfied: z.boolean(),
  protectedPreconditionsSatisfied: z.boolean(),
  requiredApprovalsSatisfied: z.boolean(),
  unknownEffectsResolved: z.boolean(),
  humanReviewRecorded: z.boolean(),
  findings: z.array(TextSchema).max(MAX_ACCEPTANCE_FINDINGS),
});
export type GateEvaluation = z.infer<typeof GateEvaluationSchema>;

/** Controller gate: advisory/model fields are intentionally absent from the input. */
export function evaluateVerificationGate(input: {
  definition: unknown;
  verification: unknown;
  currentRepository: RepositoryObservation;
  satisfiedDependencies: readonly string[];
  changedPathsInScope: boolean;
  satisfiedProtectedPreconditions: readonly string[];
  requiredApprovalIds: readonly string[];
  consumedApprovalIds: readonly string[];
  unresolvedUnknownEffectIds: readonly string[];
  humanReview?: unknown;
}): GateEvaluation {
  const definition = assertImmutableAcceptanceDefinition(input.definition);
  const verification = parseBoundary(ControllerVerificationSchema, input.verification, 'controller verification gate input');
  const currentRepository = parseBoundary(
    RepositoryObservationSchema,
    input.currentRepository,
    'verification gate repository observation'
  );
  const satisfiedDependencies = parseBoundary(
    uniqueStrings(StableIdSchema, 128),
    input.satisfiedDependencies,
    'verification gate satisfied dependencies'
  );
  const satisfiedProtectedPreconditions = parseBoundary(
    uniqueStrings(StableIdSchema, 128),
    input.satisfiedProtectedPreconditions,
    'verification gate protected preconditions'
  );
  const requiredApprovalIds = parseBoundary(
    uniqueStrings(StableIdSchema, 128),
    input.requiredApprovalIds,
    'verification gate required approvals'
  );
  const consumedApprovalIds = parseBoundary(
    uniqueStrings(StableIdSchema, 128),
    input.consumedApprovalIds,
    'verification gate consumed approvals'
  );
  const unresolvedUnknownEffectIds = parseBoundary(
    uniqueStrings(StableIdSchema, 128),
    input.unresolvedUnknownEffectIds,
    'verification gate unresolved unknown effects'
  );
  const changedPathsInScope = parseBoundary(z.boolean(), input.changedPathsInScope, 'verification gate scope result');
  const verificationDigestValid = verification.reportDigest === sha256Canonical(reportMaterial(verification));
  const controllerVerificationPassed = verification.origin === 'controller_observed'
    && verification.status === 'passed'
    && verification.acceptanceDefinitionDigest === definition.definitionDigest
    && verification.workflowId === definition.workflowId
    && verification.featureId === definition.featureId
    && verification.sessionId === definition.sessionId
    && verification.requiredCommandCount === definition.commands.length
    && verification.observedCommandCount === definition.commands.length
    && verification.passedCommandCount === definition.commands.length
    && verification.findings.length === 0
    && verificationDigestValid;
  const dependenciesSatisfied = definition.dependencies.every(id => satisfiedDependencies.includes(id));
  const repositorySatisfied = sameRepositoryObservation(definition.repositoryPrecondition, currentRepository);
  const protectedPreconditionsSatisfied = definition.protectedPreconditions.every(id => (
    satisfiedProtectedPreconditions.includes(id)
  ));
  const requiredApprovalsSatisfied = requiredApprovalIds.every(id => consumedApprovalIds.includes(id));
  const unknownEffectsResolved = unresolvedUnknownEffectIds.length === 0;
  const review = input.humanReview === undefined
    ? null
    : parseBoundary(HumanReviewSchema, input.humanReview, 'human review');
  const humanReviewRecorded = review !== null
    && review.channel === 'protected_external'
    && review.workflowId === definition.workflowId
    && review.featureId === definition.featureId
    && review.sessionId === definition.sessionId
    && review.verificationDigest === verification.reportDigest
    && review.decision === 'accepted';
  const findings: string[] = [];
  if (!controllerVerificationPassed) findings.push('Controller verification is missing, stale, contradictory, incomplete, or unverifiable.');
  if (!dependenciesSatisfied) findings.push('Feature dependencies are not all satisfied.');
  if (!changedPathsInScope) findings.push('Changed path scope is not satisfied.');
  if (!repositorySatisfied) findings.push('Repository precondition is not satisfied.');
  if (!protectedPreconditionsSatisfied) findings.push('Protected preconditions are not all satisfied.');
  if (!requiredApprovalsSatisfied) findings.push('Required approvals are not atomically consumed.');
  if (!unknownEffectsResolved) findings.push('An unresolved unknown side effect blocks advancement.');

  const deterministicReady = controllerVerificationPassed
    && dependenciesSatisfied
    && changedPathsInScope
    && repositorySatisfied
    && protectedPreconditionsSatisfied
    && requiredApprovalsSatisfied
    && unknownEffectsResolved;
  let state: GateEvaluation['state'] = deterministicReady ? 'awaiting_review' : 'verifying';
  if (!unknownEffectsResolved) state = 'blocked';
  if (deterministicReady && humanReviewRecorded) state = 'accepted';
  return parseBoundary(GateEvaluationSchema, {
    state,
    controllerVerificationPassed,
    dependenciesSatisfied,
    scopeSatisfied: changedPathsInScope,
    repositorySatisfied,
    protectedPreconditionsSatisfied,
    requiredApprovalsSatisfied,
    unknownEffectsResolved,
    humanReviewRecorded,
    findings,
  }, 'verification gate evaluation');
}
