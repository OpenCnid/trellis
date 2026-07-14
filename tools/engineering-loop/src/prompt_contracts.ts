import { z } from 'zod';
import {
  StableIdSchema,
  WorkflowStateSchema,
  parseBoundary,
} from './domain.js';
import { isPathWithinScope, normalizeRepositoryPath } from './path_scope.js';

export const PROMPT_SCHEMA_VERSION = 1 as const;
export const PROMPT_PACKET_VERSION = 'engineering-loop-prompt-packet:v1' as const;
export const PROMPT_COMPILER_VERSION = 'engineering-loop-prompt-compiler:v1' as const;
export const PROMPT_POLICY_VERSION = 'engineering-loop-prompt-policy:v1' as const;
export const MAX_PROMPT_BYTES = 128 * 1_024;
export const MAX_ROLE_OUTPUT_BYTES = 64 * 1_024;

export const PROMPT_ROLES = ['planner', 'implementer', 'checker', 'recovery'] as const;
export const PromptRoleSchema = z.enum(PROMPT_ROLES);
export type PromptRole = z.infer<typeof PromptRoleSchema>;

export const PROMPT_ASSET_VERSIONS = {
  planner: 'planner-role:v1',
  implementer: 'implementer-role:v1',
  checker: 'checker-role:v1',
  recovery: 'recovery-role:v1',
} as const satisfies Record<PromptRole, string>;

export const ROLE_OUTPUT_CONTRACT_VERSIONS = {
  planner: 'planner-output:v1',
  implementer: 'implementer-output:v1',
  checker: 'checker-output:v1',
  recovery: 'recovery-output:v1',
} as const satisfies Record<PromptRole, string>;

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/, 'must be a lowercase sha256 digest');
const RequirementIdSchema = z.string().regex(/^EL-REQ-[A-Z]+-[0-9]{3}$/, 'must be a normative requirement identifier');
const NoControlCharactersSchema = z.string().refine(
  value => !/[\u0000-\u001f\u007f]/.test(value),
  'must be a single-line value without control characters'
);

function utf8String(maxBytes: number, options: { minBytes?: number; singleLine?: boolean } = {}) {
  const minBytes = options.minBytes ?? 1;
  return z.string().min(minBytes).max(maxBytes).refine(
    value => Buffer.byteLength(value, 'utf8') >= minBytes && Buffer.byteLength(value, 'utf8') <= maxBytes,
    `must use ${minBytes} through ${maxBytes} UTF-8 bytes`
  ).refine(
    value => !(options.singleLine ?? true) || NoControlCharactersSchema.safeParse(value).success,
    'must be a single-line value without control characters'
  );
}

function uniqueStrings<T extends z.ZodTypeAny>(schema: T, maxItems: number) {
  return z.array(schema).max(maxItems).superRefine((items, ctx) => {
    if (new Set(items).size !== items.length) {
      ctx.addIssue({ code: 'custom', message: 'items must be unique' });
    }
  });
}

function uniqueObjects<T extends z.ZodTypeAny>(schema: T, maxItems: number, key: (value: z.infer<T>) => string) {
  return z.array(schema).max(maxItems).superRefine((items, ctx) => {
    if (new Set(items.map(key)).size !== items.length) {
      ctx.addIssue({ code: 'custom', message: 'object identities must be unique' });
    }
  });
}

const RepositoryPathSchema = utf8String(512).refine(value => {
  try {
    return normalizeRepositoryPath(value) === value;
  } catch {
    return false;
  }
}, 'must be a canonical repository-relative path');

const RequirementIdsSchema = uniqueStrings(RequirementIdSchema, 128);
const RepositoryPathsSchema = uniqueStrings(RepositoryPathSchema, 128);
const ReferenceSchema = utf8String(1_024);
const SummarySchema = utf8String(2_048);
const ShortTextSchema = utf8String(512);

const PolicyReferenceSchema = z.strictObject({
  id: StableIdSchema,
  digest: DigestSchema,
  reference: ReferenceSchema,
  summary: SummarySchema,
});

const ActiveFeatureContextSchema = z.strictObject({
  id: StableIdSchema,
  definitionDigest: DigestSchema,
  outcome: SummarySchema,
  dependencies: uniqueStrings(StableIdSchema, 128),
  allowedPaths: RepositoryPathsSchema.min(1),
  requirementIds: RequirementIdsSchema.min(1),
});

export const ValidatedStateContextSchema = z.strictObject({
  snapshotId: StableIdSchema,
  snapshotDigest: DigestSchema,
  workflowId: StableIdSchema,
  sessionId: StableIdSchema,
  workflowState: WorkflowStateSchema,
  policyVersion: StableIdSchema,
  repositoryObservationDigest: DigestSchema,
  feature: ActiveFeatureContextSchema,
  linkedEvidenceIds: uniqueStrings(StableIdSchema, 128),
});

const PlanStepSchema = z.strictObject({
  id: StableIdSchema,
  action: SummarySchema,
  requirementIds: RequirementIdsSchema,
  allowedPaths: RepositoryPathsSchema,
});

const PlanRiskSchema = z.strictObject({
  id: StableIdSchema,
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  summary: SummarySchema,
});

const VerificationRequestSchema = z.strictObject({
  id: StableIdSchema,
  summary: SummarySchema,
});

export const ActivePlanContextSchema = z.strictObject({
  id: StableIdSchema,
  digest: DigestSchema,
  objective: SummarySchema,
  requirementIds: RequirementIdsSchema.min(1),
  allowedPaths: RepositoryPathsSchema.min(1),
  steps: uniqueObjects(PlanStepSchema, 32, item => item.id),
  risks: uniqueObjects(PlanRiskSchema, 32, item => item.id),
  verificationRequests: uniqueObjects(VerificationRequestSchema, 32, item => item.id),
});

const ControllerEvidenceReferenceSchema = z.strictObject({
  id: StableIdSchema,
  origin: z.literal('controller_observed'),
  workflowId: StableIdSchema,
  featureId: StableIdSchema,
  sessionId: StableIdSchema,
  kind: z.enum(['repository', 'command', 'artifact', 'derived_check']),
  digest: DigestSchema,
  immutableReference: ReferenceSchema,
  summary: SummarySchema,
});

const EpisodeSummaryReferenceSchema = z.strictObject({
  id: StableIdSchema,
  role: PromptRoleSchema,
  status: z.enum(['completed', 'interrupted', 'failed', 'blocked']),
  digest: DigestSchema,
  reportReference: ReferenceSchema,
  summary: SummarySchema,
});

const ArchiveReferenceSchema = z.strictObject({
  id: StableIdSchema,
  kind: z.enum(['report', 'archive', 'ledger']),
  digest: DigestSchema,
  reference: ReferenceSchema,
  summary: SummarySchema,
});

export const PromptSectionBudgetsSchema = z.strictObject({
  invariantFrame: z.number().int().positive().max(16 * 1_024),
  packetMetadata: z.number().int().positive().max(16 * 1_024),
  invariantPolicy: z.number().int().positive().max(32 * 1_024),
  validatedState: z.number().int().positive().max(32 * 1_024),
  activePlan: z.number().int().positive().max(48 * 1_024),
  controllerEvidence: z.number().int().positive().max(48 * 1_024),
  episodeSummary: z.number().int().positive().max(32 * 1_024),
  archiveReferences: z.number().int().positive().max(16 * 1_024),
});

export const PromptBudgetSchema = z.strictObject({
  sectionBytes: PromptSectionBudgetsSchema,
  totalBytes: z.number().int().positive().max(MAX_PROMPT_BYTES),
});

export type PromptBudget = z.infer<typeof PromptBudgetSchema>;

export const DEFAULT_PROMPT_BUDGET: PromptBudget = Object.freeze({
  sectionBytes: Object.freeze({
    invariantFrame: 8 * 1_024,
    packetMetadata: 4 * 1_024,
    invariantPolicy: 8 * 1_024,
    validatedState: 8 * 1_024,
    activePlan: 16 * 1_024,
    controllerEvidence: 16 * 1_024,
    episodeSummary: 8 * 1_024,
    archiveReferences: 4 * 1_024,
  }),
  totalBytes: 64 * 1_024,
});

export const PromptAssetIdentitySchema = z.strictObject({
  version: utf8String(128),
  digest: DigestSchema,
});

export const PromptAssetSchema = z.strictObject({
  role: PromptRoleSchema,
  version: utf8String(128),
  digest: DigestSchema,
  text: utf8String(16 * 1_024, { singleLine: false }),
});

export type PromptAsset = z.infer<typeof PromptAssetSchema>;

export const PromptCompilationInputSchema = z.strictObject({
  schemaVersion: z.literal(PROMPT_SCHEMA_VERSION),
  packetVersion: z.literal(PROMPT_PACKET_VERSION),
  compilerVersion: z.literal(PROMPT_COMPILER_VERSION),
  policyVersion: z.literal(PROMPT_POLICY_VERSION),
  role: PromptRoleSchema,
  roleAsset: PromptAssetIdentitySchema,
  outputContractVersion: utf8String(128),
  budget: PromptBudgetSchema,
  invariantPolicy: uniqueObjects(PolicyReferenceSchema, 32, item => item.id).min(1),
  validatedState: ValidatedStateContextSchema,
  activePlan: ActivePlanContextSchema,
  controllerEvidence: uniqueObjects(ControllerEvidenceReferenceSchema, 128, item => item.id),
  episodeSummary: uniqueObjects(EpisodeSummaryReferenceSchema, 32, item => item.id),
  archiveReferences: uniqueObjects(ArchiveReferenceSchema, 64, item => item.id),
}).superRefine((input, ctx) => {
  if (input.roleAsset.version !== PROMPT_ASSET_VERSIONS[input.role]) {
    ctx.addIssue({ code: 'custom', path: ['roleAsset', 'version'], message: 'role asset version does not match role' });
  }
  if (input.outputContractVersion !== ROLE_OUTPUT_CONTRACT_VERSIONS[input.role]) {
    ctx.addIssue({ code: 'custom', path: ['outputContractVersion'], message: 'output contract version does not match role' });
  }
});

export type PromptCompilationInput = z.infer<typeof PromptCompilationInputSchema>;

export const PromptSectionUsageSchema = z.strictObject({
  invariantFrame: z.number().int().nonnegative().max(MAX_PROMPT_BYTES),
  packetMetadata: z.number().int().nonnegative().max(MAX_PROMPT_BYTES),
  invariantPolicy: z.number().int().nonnegative().max(MAX_PROMPT_BYTES),
  validatedState: z.number().int().nonnegative().max(MAX_PROMPT_BYTES),
  activePlan: z.number().int().nonnegative().max(MAX_PROMPT_BYTES),
  controllerEvidence: z.number().int().nonnegative().max(MAX_PROMPT_BYTES),
  episodeSummary: z.number().int().nonnegative().max(MAX_PROMPT_BYTES),
  archiveReferences: z.number().int().nonnegative().max(MAX_PROMPT_BYTES),
});

export const CompiledPromptPacketSchema = z.strictObject({
  schemaVersion: z.literal(PROMPT_SCHEMA_VERSION),
  packetVersion: z.literal(PROMPT_PACKET_VERSION),
  compilerVersion: z.literal(PROMPT_COMPILER_VERSION),
  policyVersion: z.literal(PROMPT_POLICY_VERSION),
  role: PromptRoleSchema,
  assetVersion: utf8String(128),
  assetDigest: DigestSchema,
  outputContractVersion: utf8String(128),
  snapshotId: StableIdSchema,
  snapshotDigest: DigestSchema,
  featureId: StableIdSchema,
  evidenceIds: uniqueStrings(StableIdSchema, 128),
  byteCount: z.number().int().positive().max(MAX_PROMPT_BYTES),
  maxByteCount: z.number().int().positive().max(MAX_PROMPT_BYTES),
  sectionBytes: PromptSectionUsageSchema,
  sectionBudgets: PromptSectionBudgetsSchema,
  digest: DigestSchema,
  prompt: utf8String(MAX_PROMPT_BYTES, { singleLine: false }),
});

export type CompiledPromptPacket = z.infer<typeof CompiledPromptPacketSchema>;

export const PromptRefusalCodeSchema = z.enum([
  'invalid_input',
  'identity_mismatch',
  'asset_mismatch',
  'contamination',
  'section_overflow',
  'total_overflow',
]);

export const PromptSectionNameSchema = z.enum([
  'invariantFrame',
  'packetMetadata',
  'invariantPolicy',
  'validatedState',
  'activePlan',
  'controllerEvidence',
  'episodeSummary',
  'archiveReferences',
  'total',
]);

export const PromptCompilationRefusalSchema = z.strictObject({
  schemaVersion: z.literal(PROMPT_SCHEMA_VERSION),
  packetVersion: z.literal(PROMPT_PACKET_VERSION),
  compilerVersion: z.literal(PROMPT_COMPILER_VERSION),
  policyVersion: z.literal(PROMPT_POLICY_VERSION).nullable(),
  role: PromptRoleSchema.nullable(),
  code: PromptRefusalCodeSchema,
  section: PromptSectionNameSchema.nullable(),
  limitBytes: z.number().int().nonnegative().max(MAX_PROMPT_BYTES).nullable(),
  observedBytes: z.number().int().nonnegative().max(MAX_PROMPT_BYTES + 1).nullable(),
  freshEpisodeRequired: z.boolean(),
  message: utf8String(1_024),
  digest: DigestSchema,
});

export type PromptCompilationRefusal = z.infer<typeof PromptCompilationRefusalSchema>;

export const PromptCompilationResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('compiled'), packet: CompiledPromptPacketSchema }),
  z.strictObject({ status: z.literal('refused'), refusal: PromptCompilationRefusalSchema }),
]);

export type PromptCompilationResult = z.infer<typeof PromptCompilationResultSchema>;

export interface SensitiveMaterialFinding {
  code: 'credential' | 'private_key' | 'approval_material' | 'claimed_authority';
  pattern: string;
}

const SENSITIVE_MATERIAL_PATTERNS: ReadonlyArray<{
  code: SensitiveMaterialFinding['code'];
  label: string;
  pattern: RegExp;
}> = [
  { code: 'credential', label: 'credential token', pattern: /\b(?:sk|rk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/i },
  { code: 'credential', label: 'bearer credential', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i },
  { code: 'credential', label: 'credential assignment', pattern: /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?[^\s"',}]{4,}/i },
  { code: 'private_key', label: 'private key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/i },
  { code: 'approval_material', label: 'approval material', pattern: /\bapproval(?:[_-]?(?:token|secret|id))?\s*[:=]\s*["']?[A-Za-z0-9._:-]{4,}/i },
  { code: 'claimed_authority', label: 'claimed approval', pattern: /\b(?:owner\s+approved|approval\s+granted|authorized\s+by\s+(?:the\s+)?owner)\b/i },
];

export function findSensitiveMaterial(text: string): SensitiveMaterialFinding | null {
  for (const candidate of SENSITIVE_MATERIAL_PATTERNS) {
    if (candidate.pattern.test(text)) return { code: candidate.code, pattern: candidate.label };
  }
  return null;
}

function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(stringsIn);
  return [];
}

export class PromptContractError extends Error {
  readonly code: 'invalid_json' | 'invalid_output' | 'invalid_reference' | 'sensitive_material' | 'output_overflow';

  constructor(code: PromptContractError['code'], message: string) {
    super(message.slice(0, 1_024));
    this.name = 'PromptContractError';
    this.code = code;
  }
}

export function assertNoSensitiveMaterial(value: unknown, boundary: string): void {
  for (const text of stringsIn(value)) {
    const finding = findSensitiveMaterial(text);
    if (finding !== null) {
      throw new PromptContractError('sensitive_material', `${boundary} contains ${finding.pattern}`);
    }
  }
}

const AdvisoryFindingSchema = z.strictObject({
  id: StableIdSchema,
  severity: z.enum(['info', 'warning', 'error']),
  summary: SummarySchema,
  evidenceReferences: uniqueStrings(StableIdSchema, 128),
});

const PlannerStepOutputSchema = z.strictObject({
  id: StableIdSchema,
  action: SummarySchema,
  requirementIds: RequirementIdsSchema,
  allowedPathRequests: RepositoryPathsSchema,
});

export const PlannerOutputSchema = z.strictObject({
  schemaVersion: z.literal(PROMPT_SCHEMA_VERSION),
  contractVersion: z.literal(ROLE_OUTPUT_CONTRACT_VERSIONS.planner),
  role: z.literal('planner'),
  authority: z.literal('advisory_only'),
  summary: SummarySchema,
  requirementIds: RequirementIdsSchema.min(1),
  allowedPathRequests: RepositoryPathsSchema,
  steps: uniqueObjects(PlannerStepOutputSchema, 32, item => item.id).min(1),
  risks: uniqueObjects(PlanRiskSchema, 32, item => item.id),
  verificationRequests: uniqueObjects(VerificationRequestSchema, 32, item => item.id),
});

const RequirementDispositionSchema = z.strictObject({
  requirementId: RequirementIdSchema,
  status: z.enum(['implemented', 'partial', 'blocked', 'not_applicable']),
  summary: SummarySchema,
});

const BlockerSchema = z.strictObject({
  id: StableIdSchema,
  summary: SummarySchema,
  humanActionRequired: z.boolean(),
});

export const ImplementerOutputSchema = z.strictObject({
  schemaVersion: z.literal(PROMPT_SCHEMA_VERSION),
  contractVersion: z.literal(ROLE_OUTPUT_CONTRACT_VERSIONS.implementer),
  role: z.literal('implementer'),
  authority: z.literal('advisory_only'),
  summary: SummarySchema,
  proposedChangedPaths: RepositoryPathsSchema,
  requirementDispositions: uniqueObjects(RequirementDispositionSchema, 128, item => item.requirementId).min(1),
  verificationRequests: uniqueObjects(VerificationRequestSchema, 32, item => item.id),
  findings: uniqueObjects(AdvisoryFindingSchema, 64, item => item.id),
  blockers: uniqueObjects(BlockerSchema, 32, item => item.id),
});

const RequirementAssessmentSchema = z.strictObject({
  requirementId: RequirementIdSchema,
  status: z.enum(['satisfied', 'unsatisfied', 'unverified']),
  summary: SummarySchema,
  evidenceReferences: uniqueStrings(StableIdSchema, 128),
});

export const CheckerOutputSchema = z.strictObject({
  schemaVersion: z.literal(PROMPT_SCHEMA_VERSION),
  contractVersion: z.literal(ROLE_OUTPUT_CONTRACT_VERSIONS.checker),
  role: z.literal('checker'),
  authority: z.literal('advisory_only'),
  summary: SummarySchema,
  recommendation: z.enum(['ready_for_human_review', 'request_changes', 'blocked']),
  requirementAssessments: uniqueObjects(RequirementAssessmentSchema, 128, item => item.requirementId).min(1),
  findings: uniqueObjects(AdvisoryFindingSchema, 64, item => item.id),
  evidenceReferences: uniqueStrings(StableIdSchema, 128),
});

const RecoveryRequestSchema = z.strictObject({
  id: StableIdSchema,
  summary: SummarySchema,
});

const SafeActionSchema = z.strictObject({
  id: StableIdSchema,
  summary: SummarySchema,
  requiresHumanAction: z.boolean(),
});

export const RecoveryOutputSchema = z.strictObject({
  schemaVersion: z.literal(PROMPT_SCHEMA_VERSION),
  contractVersion: z.literal(ROLE_OUTPUT_CONTRACT_VERSIONS.recovery),
  role: z.literal('recovery'),
  authority: z.literal('advisory_only'),
  summary: SummarySchema,
  classification: z.enum([
    'transient',
    'environmental',
    'implementation',
    'specification',
    'policy',
    'harness',
    'unknown_side_effect',
    'cancelled',
  ]),
  nextEvidenceRequests: uniqueObjects(RecoveryRequestSchema, 32, item => item.id),
  safeActions: uniqueObjects(SafeActionSchema, 32, item => item.id),
  humanActionRequired: z.boolean(),
  unresolvedEffectIds: uniqueStrings(StableIdSchema, 128),
  findings: uniqueObjects(AdvisoryFindingSchema, 64, item => item.id),
});

export const RoleOutputSchema = z.discriminatedUnion('role', [
  PlannerOutputSchema,
  ImplementerOutputSchema,
  CheckerOutputSchema,
  RecoveryOutputSchema,
]);

export type RoleOutput = z.infer<typeof RoleOutputSchema>;

export const RoleOutputValidationContextSchema = z.strictObject({
  requirementIds: RequirementIdsSchema,
  evidenceIds: uniqueStrings(StableIdSchema, 128),
  allowedPaths: RepositoryPathsSchema.min(1),
  unresolvedEffectIds: uniqueStrings(StableIdSchema, 128),
});

export type RoleOutputValidationContext = z.infer<typeof RoleOutputValidationContextSchema>;

function assertSubset(values: readonly string[], allowed: ReadonlySet<string>, label: string): void {
  const invalid = values.filter(value => !allowed.has(value));
  if (invalid.length > 0) {
    throw new PromptContractError('invalid_reference', `${label} contains invalid identifiers: ${invalid.join(', ')}`);
  }
}

function outputRequirementIds(output: RoleOutput): string[] {
  if (output.role === 'planner') {
    return [...output.requirementIds, ...output.steps.flatMap(step => step.requirementIds)];
  }
  if (output.role === 'implementer') return output.requirementDispositions.map(item => item.requirementId);
  if (output.role === 'checker') return output.requirementAssessments.map(item => item.requirementId);
  return [];
}

function outputEvidenceIds(output: RoleOutput): string[] {
  if (output.role === 'implementer') return output.findings.flatMap(item => item.evidenceReferences);
  if (output.role === 'checker') {
    return [
      ...output.evidenceReferences,
      ...output.requirementAssessments.flatMap(item => item.evidenceReferences),
      ...output.findings.flatMap(item => item.evidenceReferences),
    ];
  }
  if (output.role === 'recovery') return output.findings.flatMap(item => item.evidenceReferences);
  return [];
}

function outputPaths(output: RoleOutput): string[] {
  if (output.role === 'planner') {
    return [...output.allowedPathRequests, ...output.steps.flatMap(step => step.allowedPathRequests)];
  }
  if (output.role === 'implementer') return output.proposedChangedPaths;
  return [];
}

function localOutputIds(output: RoleOutput): string[] {
  if (output.role === 'planner') {
    return [
      ...output.steps.map(item => item.id),
      ...output.risks.map(item => item.id),
      ...output.verificationRequests.map(item => item.id),
    ];
  }
  if (output.role === 'implementer') {
    return [
      ...output.verificationRequests.map(item => item.id),
      ...output.findings.map(item => item.id),
      ...output.blockers.map(item => item.id),
    ];
  }
  if (output.role === 'checker') return output.findings.map(item => item.id);
  return [
    ...output.nextEvidenceRequests.map(item => item.id),
    ...output.safeActions.map(item => item.id),
    ...output.findings.map(item => item.id),
  ];
}

function validateOutputReferences(output: RoleOutput, context: RoleOutputValidationContext): void {
  assertSubset(outputRequirementIds(output), new Set(context.requirementIds), 'role output requirement references');
  assertSubset(outputEvidenceIds(output), new Set(context.evidenceIds), 'role output evidence references');
  const invalidPaths = outputPaths(output).filter(path => (
    !context.allowedPaths.some(scope => isPathWithinScope(path, scope))
  ));
  if (invalidPaths.length > 0) {
    throw new PromptContractError('invalid_reference', `role output paths are outside scope: ${invalidPaths.join(', ')}`);
  }
  if (output.role === 'recovery') {
    assertSubset(
      output.unresolvedEffectIds,
      new Set(context.unresolvedEffectIds),
      'recovery unresolved effect references'
    );
  }
  const identities = localOutputIds(output);
  if (new Set(identities).size !== identities.length) {
    throw new PromptContractError('invalid_output', 'role output reuses an advisory identity across collections');
  }
}

export function parseRoleOutputJson(
  expectedRoleValue: unknown,
  jsonValue: unknown,
  contextValue: unknown
): RoleOutput {
  const expectedRole = parseBoundary(PromptRoleSchema, expectedRoleValue, 'expected role output role');
  const context = parseBoundary(RoleOutputValidationContextSchema, contextValue, 'role output validation context');
  if (typeof jsonValue !== 'string') {
    throw new PromptContractError('invalid_json', 'role output must be one JSON text value');
  }
  const byteCount = Buffer.byteLength(jsonValue, 'utf8');
  if (byteCount > MAX_ROLE_OUTPUT_BYTES) {
    throw new PromptContractError('output_overflow', `role output exceeds ${MAX_ROLE_OUTPUT_BYTES} UTF-8 bytes`);
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(jsonValue);
  } catch {
    throw new PromptContractError('invalid_json', 'role output is not structurally valid JSON');
  }
  const parsed = RoleOutputSchema.safeParse(decoded);
  if (!parsed.success) {
    const detail = parsed.error.issues.slice(0, 5).map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ');
    throw new PromptContractError('invalid_output', `role output schema refused: ${detail}`);
  }
  if (parsed.data.role !== expectedRole) {
    throw new PromptContractError('invalid_output', `role output '${parsed.data.role}' does not match expected '${expectedRole}'`);
  }
  assertNoSensitiveMaterial(parsed.data, 'role output');
  validateOutputReferences(parsed.data, context);
  return parsed.data;
}

export function parsePromptCompilationInput(value: unknown): PromptCompilationInput {
  return parseBoundary(PromptCompilationInputSchema, value, 'prompt compilation input');
}

export function parsePromptAsset(value: unknown): PromptAsset {
  return parseBoundary(PromptAssetSchema, value, 'prompt asset');
}
