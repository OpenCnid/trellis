import { z } from 'zod';
import { StableIdSchema, parseBoundary } from './domain.js';
import { sha256Canonical } from './events.js';
import {
  CheckerOutputSchema,
  RoleOutputValidationContextSchema,
  parseRoleOutputJson,
  type RoleOutputValidationContext,
} from './prompt_contracts.js';
import {
  AGENT_RUNNER_CONTRACT_VERSION,
  RUNNER_SCHEMA_VERSION,
  RunnerLaunchResultSchema,
  RunnerObserveResultSchema,
  RunnerStartRequestSchema,
  sameRunnerCorrelation,
  type RunnerStartRequest,
} from './runners/runner.js';

export const CHECKER_SCHEMA_VERSION = 1 as const;
export const CHECKER_POLICY_VERSION = 'trellis-fresh-read-only-checker:v1' as const;
export const MAX_CHECKER_FORBIDDEN_IDENTITIES = 128;

const TimestampSchema = z.string().datetime({ offset: true });
const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const PathSchema = z.string().min(1).max(512).refine(value => !value.includes('\0'));

function uniqueStrings<T extends z.ZodTypeAny>(schema: T, max: number) {
  return z.array(schema).max(max).superRefine((values, ctx) => {
    if (new Set(values).size !== values.length) ctx.addIssue({ code: 'custom', message: 'items must be unique' });
  });
}

export const CheckerCapabilitiesSchema = z.strictObject({
  schemaVersion: z.literal(CHECKER_SCHEMA_VERSION),
  policyVersion: z.literal(CHECKER_POLICY_VERSION),
  filesystem: z.literal('read_only'),
  readableRoots: uniqueStrings(PathSchema, 32).min(1),
  writableRoots: z.tuple([]),
  credentialReferences: z.tuple([]),
  network: z.literal('none'),
  externalEffects: z.tuple([]),
  controllerEvidenceWrite: z.literal(false),
  approvalReadOrConsume: z.literal(false),
  stateTransition: z.literal(false),
  acceptanceDecision: z.literal(false),
  worktreeEdit: z.literal(false),
});
export type CheckerCapabilities = z.infer<typeof CheckerCapabilitiesSchema>;

export const CheckerFreshnessSchema = z.strictObject({
  freshEpisode: z.literal(true),
  freshThread: z.literal(true),
  startOnly: z.literal(true),
  reuseImplementerConversation: z.literal(false),
  reuseImplementerCompaction: z.literal(false),
  reuseImplementerMemory: z.literal(false),
  reuseImplementerWritableSession: z.literal(false),
  reuseImplementerCredentials: z.literal(false),
  forbiddenImplementerEpisodeIds: uniqueStrings(StableIdSchema, MAX_CHECKER_FORBIDDEN_IDENTITIES),
  forbiddenImplementerThreadIds: uniqueStrings(StableIdSchema, MAX_CHECKER_FORBIDDEN_IDENTITIES),
  forbiddenImplementerRunnerIds: uniqueStrings(StableIdSchema, MAX_CHECKER_FORBIDDEN_IDENTITIES),
});
export type CheckerFreshness = z.infer<typeof CheckerFreshnessSchema>;

export const FreshCheckerRequestSchema = z.strictObject({
  schemaVersion: z.literal(CHECKER_SCHEMA_VERSION),
  policyVersion: z.literal(CHECKER_POLICY_VERSION),
  createdAt: TimestampSchema,
  start: RunnerStartRequestSchema.superRefine((start, ctx) => {
    if (start.role !== 'checker') ctx.addIssue({ code: 'custom', path: ['role'], message: 'fresh checker request requires checker role' });
  }),
  capabilities: CheckerCapabilitiesSchema,
  freshness: CheckerFreshnessSchema,
  validationContext: RoleOutputValidationContextSchema,
  requestDigest: DigestSchema,
}).superRefine((request, ctx) => {
  if (
    request.capabilities.readableRoots.length !== 1
    || request.capabilities.readableRoots[0] !== request.start.workingDirectory
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['capabilities', 'readableRoots'],
      message: 'least-privilege checker may read only its bound working directory',
    });
  }
});
export type FreshCheckerRequest = z.infer<typeof FreshCheckerRequestSchema>;

function requestMaterial(request: FreshCheckerRequest): Omit<FreshCheckerRequest, 'requestDigest'> {
  const { requestDigest: _digest, ...material } = request;
  return material;
}

export function compileFreshCheckerRequest(input: {
  createdAt: string;
  start: RunnerStartRequest;
  readableRoots: readonly string[];
  forbiddenImplementerEpisodeIds?: readonly string[];
  forbiddenImplementerThreadIds?: readonly string[];
  forbiddenImplementerRunnerIds?: readonly string[];
  validationContext: RoleOutputValidationContext;
}): FreshCheckerRequest {
  const material = parseBoundary(FreshCheckerRequestSchema, {
    schemaVersion: CHECKER_SCHEMA_VERSION,
    policyVersion: CHECKER_POLICY_VERSION,
    createdAt: input.createdAt,
    start: input.start,
    capabilities: {
      schemaVersion: CHECKER_SCHEMA_VERSION,
      policyVersion: CHECKER_POLICY_VERSION,
      filesystem: 'read_only',
      readableRoots: input.readableRoots,
      writableRoots: [],
      credentialReferences: [],
      network: 'none',
      externalEffects: [],
      controllerEvidenceWrite: false,
      approvalReadOrConsume: false,
      stateTransition: false,
      acceptanceDecision: false,
      worktreeEdit: false,
    },
    freshness: {
      freshEpisode: true,
      freshThread: true,
      startOnly: true,
      reuseImplementerConversation: false,
      reuseImplementerCompaction: false,
      reuseImplementerMemory: false,
      reuseImplementerWritableSession: false,
      reuseImplementerCredentials: false,
      forbiddenImplementerEpisodeIds: input.forbiddenImplementerEpisodeIds ?? [],
      forbiddenImplementerThreadIds: input.forbiddenImplementerThreadIds ?? [],
      forbiddenImplementerRunnerIds: input.forbiddenImplementerRunnerIds ?? [],
    },
    validationContext: input.validationContext,
    requestDigest: '0'.repeat(64),
  }, 'fresh checker request material');
  return parseBoundary(FreshCheckerRequestSchema, {
    ...material,
    requestDigest: sha256Canonical(requestMaterial(material)),
  }, 'fresh checker request');
}

export const FreshCheckerExecutionSchema = z.strictObject({
  launch: RunnerLaunchResultSchema,
  observation: RunnerObserveResultSchema,
  outputJson: z.string().min(1).refine(
    value => Buffer.byteLength(value, 'utf8') <= 256 * 1_024,
    'checker output exceeds byte bound'
  ),
});
export type FreshCheckerExecution = z.infer<typeof FreshCheckerExecutionSchema>;

export interface FreshCheckerPort {
  readonly isolation: 'fresh_read_only_checker';
  start(request: FreshCheckerRequest): Promise<unknown>;
}

export const CheckerReportSchema = z.strictObject({
  id: StableIdSchema,
  schemaVersion: z.literal(CHECKER_SCHEMA_VERSION),
  policyVersion: z.literal(CHECKER_POLICY_VERSION),
  createdAt: TimestampSchema,
  authority: z.literal('advisory_only'),
  workflowId: StableIdSchema,
  featureId: StableIdSchema,
  sessionId: StableIdSchema,
  episodeId: StableIdSchema,
  runnerId: StableIdSchema,
  threadId: StableIdSchema,
  terminalStatus: z.literal('completed'),
  recommendation: z.enum(['ready_for_human_review', 'request_changes', 'blocked']),
  checkerOutput: CheckerOutputSchema,
  canEdit: z.literal(false),
  canCreateControllerEvidence: z.literal(false),
  canConsumeApproval: z.literal(false),
  canInvokeEffect: z.literal(false),
  canAccept: z.literal(false),
  canTransition: z.literal(false),
  reportDigest: DigestSchema,
});
export type CheckerReport = z.infer<typeof CheckerReportSchema>;

function reportMaterial(report: CheckerReport): Omit<CheckerReport, 'reportDigest'> {
  const { reportDigest: _digest, ...material } = report;
  return material;
}

export class CheckerBoundaryError extends Error {
  constructor(message: string) {
    super(message.slice(0, 1_024));
    this.name = 'CheckerBoundaryError';
  }
}

/** Executes only a fresh start request. Checker content remains advisory data. */
export async function runFreshChecker(input: {
  request: unknown;
  port: FreshCheckerPort;
  reportId: string;
  createdAt: string;
}): Promise<CheckerReport> {
  const request = parseBoundary(FreshCheckerRequestSchema, input.request, 'fresh checker request');
  if (request.requestDigest !== sha256Canonical(requestMaterial(request))) {
    throw new CheckerBoundaryError('Fresh checker request digest mismatch');
  }
  if (input.port.isolation !== 'fresh_read_only_checker') {
    throw new CheckerBoundaryError('Checker port lacks fresh read-only isolation');
  }
  const execution = parseBoundary(
    FreshCheckerExecutionSchema,
    await input.port.start(structuredClone(request)),
    'fresh checker execution'
  );
  if (execution.launch.status !== 'started') throw new CheckerBoundaryError('Checker launch was refused');
  if (!sameRunnerCorrelation(execution.launch.correlation, execution.observation.correlation)) {
    throw new CheckerBoundaryError('Checker launch and observation correlations differ');
  }
  const correlation = execution.observation.correlation;
  if (
    correlation.workflowId !== request.start.workflowId
    || correlation.featureId !== request.start.featureId
    || correlation.sessionId !== request.start.sessionId
    || correlation.episodeId !== request.start.episodeId
    || correlation.requestId !== request.start.requestId
    || correlation.runnerId !== request.start.runnerId
  ) {
    throw new CheckerBoundaryError('Checker result does not match request correlations');
  }
  if (correlation.threadId === null || correlation.turnId === null) {
    throw new CheckerBoundaryError('Fresh checker start did not yield a thread and turn');
  }
  if (
    request.freshness.forbiddenImplementerEpisodeIds.includes(correlation.episodeId)
    || request.freshness.forbiddenImplementerThreadIds.includes(correlation.threadId)
    || request.freshness.forbiddenImplementerRunnerIds.includes(correlation.runnerId)
  ) {
    throw new CheckerBoundaryError('Checker reused an implementer episode, thread, or runner identity');
  }
  if (!execution.observation.terminal || execution.observation.report?.terminalStatus !== 'completed') {
    throw new CheckerBoundaryError('Checker did not complete with one terminal bounded report');
  }
  const lifecycle = execution.observation.observations;
  const terminalEvents = lifecycle.filter(item => item.terminal);
  const terminalReport = execution.observation.report;
  if (
    lifecycle.length === 0
    || lifecycle[0]!.sequence !== 1
    || lifecycle[0]!.eventType !== 'episode.started'
    || terminalEvents.length !== 1
    || lifecycle[lifecycle.length - 1]!.terminal !== true
    || terminalReport === null
    || terminalReport.eventCount !== lifecycle.length
    || terminalReport.terminalSequence !== lifecycle[lifecycle.length - 1]!.sequence
  ) {
    throw new CheckerBoundaryError('Checker lifecycle is incomplete, resumed, duplicated, out of order, or unbounded');
  }
  const output = parseRoleOutputJson('checker', execution.outputJson, request.validationContext);
  if (output.role !== 'checker') throw new CheckerBoundaryError('Validated output is not a checker report');
  const material = parseBoundary(CheckerReportSchema, {
    id: input.reportId,
    schemaVersion: CHECKER_SCHEMA_VERSION,
    policyVersion: CHECKER_POLICY_VERSION,
    createdAt: input.createdAt,
    authority: 'advisory_only',
    workflowId: correlation.workflowId,
    featureId: correlation.featureId,
    sessionId: correlation.sessionId,
    episodeId: correlation.episodeId,
    runnerId: correlation.runnerId,
    threadId: correlation.threadId,
    terminalStatus: 'completed',
    recommendation: output.recommendation,
    checkerOutput: output,
    canEdit: false,
    canCreateControllerEvidence: false,
    canConsumeApproval: false,
    canInvokeEffect: false,
    canAccept: false,
    canTransition: false,
    reportDigest: '0'.repeat(64),
  }, 'checker report material');
  return parseBoundary(CheckerReportSchema, {
    ...material,
    reportDigest: sha256Canonical(reportMaterial(material)),
  }, 'checker report');
}

export function createCheckerStart(input: Omit<RunnerStartRequest, 'schemaVersion' | 'contractVersion' | 'role'>): RunnerStartRequest {
  return parseBoundary(RunnerStartRequestSchema, {
    ...input,
    schemaVersion: RUNNER_SCHEMA_VERSION,
    contractVersion: AGENT_RUNNER_CONTRACT_VERSION,
    role: 'checker',
  }, 'checker runner start');
}
