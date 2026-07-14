import {
  DOMAIN_SCHEMA_VERSION,
  type Approval,
  type Decision,
  type Evidence,
  type Feature,
  type RepositoryObservation,
  type Session,
  type StateSnapshot,
  type Workflow,
  type WorkflowState,
} from '../src/domain';
import { sha256Canonical } from '../src/events';

export const NOW = '2026-07-14T12:00:00.000Z';

export const REPOSITORY: RepositoryObservation = {
  repositoryId: 'repository:trellis',
  worktreeId: 'worktree:fixture',
  branch: 'implement-el02-control-kernel',
  baseCommit: '1'.repeat(64),
  headCommit: '2'.repeat(64),
  clean: true,
};

export const WORKFLOW: Workflow = {
  id: 'workflow:engineering-loop',
  schemaVersion: DOMAIN_SCHEMA_VERSION,
  createdAt: NOW,
  policyVersion: 'policy:v1',
  catalogDigest: '3'.repeat(64),
  repositoryId: REPOSITORY.repositoryId,
  featureIds: ['EL-01', 'EL-02'],
};

export const FEATURE: Feature = {
  id: 'feature:EL-02',
  schemaVersion: DOMAIN_SCHEMA_VERSION,
  createdAt: NOW,
  workflowId: WORKFLOW.id,
  featureId: 'EL-02',
  order: 2,
  dependencies: ['EL-01'],
  scope: ['tools/engineering-loop'],
  artifacts: ['tools/engineering-loop/src', 'tools/engineering-loop/tests'],
  acceptanceCriteria: [
    { id: 'EL-02-A1', kind: 'static', requirement: 'Exhaustive transition evidence' },
  ],
  gates: ['human_review'],
  paidWork: 'forbidden',
  definitionDigest: '4'.repeat(64),
};

export const SESSION: Session = {
  id: 'session:56',
  schemaVersion: DOMAIN_SCHEMA_VERSION,
  createdAt: NOW,
  workflowId: WORKFLOW.id,
  featureId: FEATURE.featureId,
  definitionDigest: FEATURE.definitionDigest,
  expectedRepository: REPOSITORY,
  scopeDigest: sha256Canonical([...FEATURE.scope].sort()),
  state: 'selected',
  resumeState: null,
  episodeIds: [],
  evidenceIds: [],
  approvalIds: [],
  result: null,
};

export function makeSnapshot(
  state: WorkflowState,
  options: {
    resumeState?: WorkflowState | null;
    recoveryState?: WorkflowState | null;
    pendingProtectedAction?: string | null;
  } = {}
): StateSnapshot {
  return {
    id: 'snapshot:fixture',
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    createdAt: NOW,
    workflowId: WORKFLOW.id,
    featureId: FEATURE.featureId,
    sessionId: SESSION.id,
    definitionDigest: FEATURE.definitionDigest,
    scopeDigest: SESSION.scopeDigest,
    expectedRepository: REPOSITORY,
    state,
    resumeState: options.resumeState ?? (state === 'awaiting_approval' ? 'selected' : null),
    recoveryState: options.recoveryState ?? (state === 'recovering' ? 'selected' : null),
    pendingProtectedAction: options.pendingProtectedAction ?? (state === 'awaiting_approval' ? 'paid_run' : null),
    lastEventSequence: 1,
    lastEventDigest: '5'.repeat(64),
    evidenceIds: [],
    approvalIds: [],
    consumedApprovalIds: [],
    intents: [],
    outcomes: [],
  };
}

export function makeDecision(input: {
  from: WorkflowState | null;
  to: WorkflowState;
  actor?: 'controller' | 'human' | 'runner' | 'checker' | 'model';
  evidenceIds?: string[];
  approvalIds?: string[];
  protectedAction?: string | null;
  now?: string;
}): Decision {
  return {
    id: `decision:${input.from ?? 'none'}-${input.to}`,
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    createdAt: input.now ?? NOW,
    workflowId: WORKFLOW.id,
    featureId: FEATURE.featureId,
    sessionId: SESSION.id,
    fromState: input.from,
    toState: input.to,
    actorAuthority: input.actor ?? 'controller',
    policyVersion: WORKFLOW.policyVersion,
    reason: `transition ${input.from ?? 'none'} to ${input.to}`,
    evidenceIds: input.evidenceIds ?? [],
    approvalIds: input.approvalIds ?? [],
    protectedAction: input.protectedAction ?? null,
  };
}

export function makeApproval(action: string, now = NOW): Approval {
  return {
    id: `approval:${action}`,
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    createdAt: now,
    workflowId: WORKFLOW.id,
    featureId: FEATURE.featureId,
    sessionId: SESSION.id,
    issuer: 'owner:fixture',
    protectedAction: action,
    exactScope: FEATURE.scope,
    repositoryPrecondition: REPOSITORY,
    estimate: null,
    issuedAt: now,
    expiresAt: new Date(Date.parse(now) + 60_000).toISOString(),
    consumptionState: 'active',
    consumedAt: null,
  };
}

export function makeEvidence(id = 'evidence:controller'): Evidence {
  return {
    id,
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    createdAt: NOW,
    workflowId: WORKFLOW.id,
    featureId: FEATURE.featureId,
    sessionId: SESSION.id,
    origin: 'controller_observed',
    observedAt: NOW,
    digest: '6'.repeat(64),
    immutableReference: null,
    mediaType: 'application/json',
    byteCount: 10,
    metadata: [],
  };
}
