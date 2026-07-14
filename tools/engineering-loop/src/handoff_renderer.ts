import { z } from 'zod';
import {
  FeatureSchema,
  ReportSchema,
  StateSnapshotSchema,
  StableIdSchema,
  parseBoundary,
  type Report,
} from './domain.js';
import { canonicalJson, sha256Canonical } from './events.js';
import {
  CommandEvidenceResultSchema,
  RetainedArtifactReferenceSchema,
  type CommandEvidenceResult,
  type RetainedArtifactReference,
} from './command_evidence.js';
import {
  RepositoryStateObservationSchema,
  type RepositoryStateObservation,
} from './repo_observer.js';

export const HANDOFF_RENDERER_VERSION = 'handoff-renderer:v1' as const;
export const MAX_RENDERED_VIEW_BYTES = 64 * 1_024;

export class RendererError extends Error {
  constructor(message: string) {
    super(message.slice(0, 1_024));
    this.name = 'RendererError';
  }
}

const TimestampSchema = z.string().datetime({ offset: true });
const RequirementEvidenceSchema = z.strictObject({
  requirement: StableIdSchema,
  source: z.array(z.string().min(1).max(512)).max(64),
  tests: z.array(z.string().min(1).max(512)).max(64),
});
const RequirementEvidenceListSchema = z.array(RequirementEvidenceSchema).max(10_000).superRefine((items, ctx) => {
  if (new Set(items.map(item => item.requirement)).size !== items.length) {
    ctx.addIssue({ code: 'custom', message: 'requirement evidence identifiers must be unique' });
  }
});
const TrustedFindingSchema = z.strictObject({
  source: z.enum(['controller', 'git', 'human']),
  code: StableIdSchema,
  message: z.string().min(1).max(1_900),
});
const TrustedFindingListSchema = z.array(TrustedFindingSchema).max(128);
const CommandEvidenceListSchema = z.array(CommandEvidenceResultSchema).max(128);
const CatalogAcceptanceSchema = z.strictObject({
  id: StableIdSchema,
  kind: z.enum(['static', 'integration', 'review', 'measurement']),
  requirement: z.string().min(1).max(500),
});
const CatalogFeatureSchema = z.strictObject({
  id: StableIdSchema,
  order: z.number().int().nonnegative().max(10_000),
  title: z.string().min(1).max(160),
  outcome: z.string().min(1).max(500),
  dependencies: z.array(StableIdSchema).max(128),
  artifacts: z.array(z.string().min(1).max(512)).max(128),
  acceptance: z.array(CatalogAcceptanceSchema).min(1).max(128),
  gates: z.array(StableIdSchema).max(32),
  paidWork: z.enum(['forbidden', 'owner_gated', 'separately_proposed']),
  bootstrapStatus: z.enum(['planned', 'active', 'accepted', 'blocked', 'deferred']),
});
const CatalogSchema = z.strictObject({
  schemaVersion: z.literal(1),
  program: z.literal('trellis-engineering-loop'),
  statusAuthority: z.enum(['bootstrap_git_until_el_02', 'protected_controller_state']),
  features: z.array(CatalogFeatureSchema).min(1).max(128),
});

function assertJournaledCommandEvidence(
  snapshotEvidenceIds: readonly string[],
  result: CommandEvidenceResult
): void {
  const { observation, evidence, recordReference } = result;
  if (!snapshotEvidenceIds.includes(evidence.id)) {
    throw new RendererError(`Command evidence '${evidence.id}' is not journal-linked in trusted state`);
  }
  if (
    evidence.origin !== 'controller_observed'
    || observation.origin !== 'controller_observed'
    || evidence.id !== observation.id
    || evidence.digest !== sha256Canonical(observation)
    || recordReference.journalReference !== evidence.id
    || evidence.immutableReference !== `artifact:sha256:${recordReference.digest}`
  ) {
    throw new RendererError(`Command evidence '${evidence.id}' fails trusted linkage`);
  }
}

function exactCommand(observation: CommandEvidenceResult['observation']): string {
  return `cwd=${JSON.stringify(observation.cwd)} argv=${canonicalJson(observation.argv)}`;
}

function commandResult(observation: CommandEvidenceResult['observation']): string {
  const status = observation.exitCode === null ? `signal=${observation.signal}` : `exit=${observation.exitCode}`;
  return [
    status,
    `timeout=${observation.timedOut}`,
    `cancelled=${observation.cancelled}`,
    `stdout_bytes=${observation.stdout.byteCount}`,
    `stderr_bytes=${observation.stderr.byteCount}`,
    `stdout_sha256=${observation.stdout.digest}`,
    `stderr_sha256=${observation.stderr.digest}`,
  ].join(' ');
}

function computeNextFeature(
  catalogValue: unknown,
  currentFeature: string,
  acceptedFeatureIds: readonly string[]
): string | null {
  const catalog = parseBoundary(CatalogSchema, catalogValue, 'renderer catalog');
  const accepted = new Set(acceptedFeatureIds);
  for (const feature of catalog.features) {
    if (feature.bootstrapStatus === 'accepted') accepted.add(feature.id);
  }
  const candidates = catalog.features
    .filter(feature => (
      feature.id !== currentFeature
      && feature.bootstrapStatus === 'planned'
      && feature.dependencies.every(dependency => accepted.has(dependency))
    ))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id, 'en'));
  return candidates[0]?.id ?? null;
}

export function deriveTrustedReport(input: {
  reportId: string;
  createdAt: string;
  result: 'ready_for_owner_review' | 'blocked';
  snapshot: unknown;
  feature: unknown;
  repository: unknown;
  commandEvidence: readonly unknown[];
  requirementEvidence: readonly unknown[];
  findings: readonly unknown[];
  catalog: unknown;
  acceptedFeatureIds: readonly string[];
}): Report {
  const reportId = parseBoundary(StableIdSchema, input.reportId, 'report identifier');
  const createdAt = parseBoundary(TimestampSchema, input.createdAt, 'report creation time');
  const snapshot = parseBoundary(StateSnapshotSchema, input.snapshot, 'trusted report snapshot');
  const feature = parseBoundary(FeatureSchema, input.feature, 'trusted report feature');
  const repository = parseBoundary(RepositoryStateObservationSchema, input.repository, 'trusted report repository');
  const commandEvidence = parseBoundary(CommandEvidenceListSchema, input.commandEvidence, 'trusted report command evidence');
  const requirementEvidence = parseBoundary(
    RequirementEvidenceListSchema,
    input.requirementEvidence,
    'trusted report requirement evidence'
  );
  const findings = parseBoundary(TrustedFindingListSchema, input.findings, 'trusted report findings');
  const acceptedFeatureIds = z.array(StableIdSchema).max(128).parse(input.acceptedFeatureIds);

  if (
    snapshot.workflowId !== feature.workflowId
    || snapshot.featureId !== feature.featureId
    || repository.repositoryId !== snapshot.expectedRepository.repositoryId
    || repository.worktreeId !== snapshot.expectedRepository.worktreeId
    || repository.branch !== snapshot.expectedRepository.branch
    || repository.baseCommit !== snapshot.expectedRepository.baseCommit
    || repository.headCommit !== snapshot.expectedRepository.headCommit
    || repository.clean !== snapshot.expectedRepository.clean
  ) {
    throw new RendererError('Trusted report inputs disagree on workflow, feature, or repository bindings');
  }
  for (const evidenceId of repository.commandEvidenceIds) {
    if (!snapshot.evidenceIds.includes(evidenceId)) {
      throw new RendererError(`Repository evidence '${evidenceId}' is not journal-linked in trusted state`);
    }
  }
  for (const result of commandEvidence) assertJournaledCommandEvidence(snapshot.evidenceIds, result);
  if (
    input.result === 'ready_for_owner_review'
    && commandEvidence.some(item => (
      item.observation.exitCode !== 0
      || item.observation.timedOut
      || item.observation.cancelled
    ))
  ) {
    throw new RendererError('A ready-for-review report requires successful, non-timeout, non-cancelled command evidence');
  }

  const required = requirementEvidence.length;
  const implemented = requirementEvidence.filter(item => item.source.length > 0).length;
  const verified = requirementEvidence.filter(item => item.source.length > 0 && item.tests.length > 0).length;
  const outstanding = requirementEvidence
    .filter(item => item.source.length === 0 || item.tests.length === 0)
    .map(item => item.requirement)
    .sort();
  const report = {
    id: reportId,
    schemaVersion: 1,
    createdAt,
    workflowId: snapshot.workflowId,
    featureId: snapshot.featureId,
    sessionId: snapshot.sessionId,
    feature: feature.featureId,
    result: input.result,
    artifacts: [...repository.changedPaths].sort(),
    normative_requirements: { required, implemented, verified, outstanding },
    verification: commandEvidence.map(item => ({
      command: exactCommand(item.observation),
      result: commandResult(item.observation),
    })),
    findings: findings.map(finding => `${finding.source}:${finding.code}: ${finding.message}`),
    next_feature: computeNextFeature(input.catalog, feature.featureId, acceptedFeatureIds),
  };
  return parseBoundary(ReportSchema, report, 'trusted report derivation');
}

function boundedBytes(text: string, label: string): Buffer {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.byteLength > MAX_RENDERED_VIEW_BYTES) {
    throw new RendererError(`${label} exceeds the ${MAX_RENDERED_VIEW_BYTES}-byte render limit`);
  }
  return bytes;
}

export function renderReportBytes(reportValue: unknown): Buffer {
  const report = parseBoundary(ReportSchema, reportValue, 'report renderer input');
  return boundedBytes(`${canonicalJson(report)}\n`, 'Report');
}

export function renderStatusBytes(input: {
  rendererVersion: typeof HANDOFF_RENDERER_VERSION;
  snapshot: unknown;
  repository: unknown;
  report: unknown;
}): Buffer {
  if (input.rendererVersion !== HANDOFF_RENDERER_VERSION) throw new RendererError('Unsupported renderer version');
  const snapshot = parseBoundary(StateSnapshotSchema, input.snapshot, 'status snapshot');
  const repository = parseBoundary(RepositoryStateObservationSchema, input.repository, 'status repository');
  const report = parseBoundary(ReportSchema, input.report, 'status report');
  if (snapshot.sessionId !== report.sessionId || snapshot.featureId !== report.feature) {
    throw new RendererError('Status inputs refer to different sessions or features');
  }
  return boundedBytes(`${canonicalJson({
    renderer_version: HANDOFF_RENDERER_VERSION,
    authority: 'derived_view_only',
    feature: report.feature,
    result: report.result,
    state: snapshot.state,
    branch: repository.branch,
    base: repository.baseCommit,
    head: repository.headCommit,
    clean: repository.clean,
    changed_paths: repository.changedPaths,
    outstanding_requirements: report.normative_requirements.outstanding,
    next_feature: report.next_feature,
  })}\n`, 'Status view');
}

const HandoffPreviewInputSchema = z.strictObject({
  rendererVersion: z.literal(HANDOFF_RENDERER_VERSION),
  report: ReportSchema,
  repository: RepositoryStateObservationSchema,
  nextFeatureOutcome: z.string().min(1).max(500).nullable(),
  evidenceReferences: z.array(RetainedArtifactReferenceSchema).max(64),
  archiveReferences: z.array(z.string().min(1).max(512)).max(32),
});

function markdownInline(value: string): string {
  return value.replace(/[\r\n\u0000-\u001f]+/g, ' ').replace(/`/g, '\\`').trim();
}

function artifactLine(reference: RetainedArtifactReference): string {
  return `- \`${reference.digest}\` — ${reference.mediaType}, ${reference.byteCount} bytes, journal \`${reference.journalReference}\``;
}

export function renderHandoffPreviewBytes(inputValue: unknown): Buffer {
  const input = parseBoundary(HandoffPreviewInputSchema, inputValue, 'handoff preview input');
  const report = input.report;
  const repository = input.repository;
  const outstanding = report.normative_requirements.outstanding.length === 0
    ? '- None.'
    : report.normative_requirements.outstanding.map(item => `- \`${item}\``).join('\n');
  const evidence = input.evidenceReferences.length === 0
    ? '- None.'
    : input.evidenceReferences.map(artifactLine).join('\n');
  const archives = input.archiveReferences.length === 0
    ? '- None.'
    : input.archiveReferences.map(reference => `- ${markdownInline(reference)}`).join('\n');
  const next = report.next_feature === null
    ? 'None.'
    : `\`${report.next_feature}\`${input.nextFeatureOutcome === null ? '' : ` — ${markdownInline(input.nextFeatureOutcome)}`}`;
  const text = [
    '# Engineering Loop Handoff Preview',
    '',
    '> **Authority:** Preview only. The manually maintained `HANDOFF.md` remains authoritative.',
    '',
    `Renderer: \`${HANDOFF_RENDERER_VERSION}\``,
    '',
    '## Current trusted state',
    '',
    `- Feature: \`${report.feature}\``,
    `- Result: \`${report.result}\``,
    `- Repository: \`${repository.repositoryId}\``,
    `- Worktree: \`${markdownInline(repository.worktreePath)}\``,
    `- Branch / base / HEAD: \`${markdownInline(repository.branch)}\` / \`${repository.baseCommit}\` / \`${repository.headCommit}\``,
    `- Clean: \`${repository.clean}\``,
    '',
    '## Normative requirements',
    '',
    `- Required / implemented / verified: ${report.normative_requirements.required} / ${report.normative_requirements.implemented} / ${report.normative_requirements.verified}`,
    '- Outstanding:',
    outstanding,
    '',
    '## Protected evidence references',
    '',
    evidence,
    '',
    '## Bounded archive references',
    '',
    archives,
    '',
    '## Proposed next feature',
    '',
    next,
    '',
  ].join('\n');
  return boundedBytes(text, 'Handoff preview');
}
