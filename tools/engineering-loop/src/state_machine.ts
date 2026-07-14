import { z } from 'zod';
import {
  ApprovalSchema,
  DecisionSchema,
  DOMAIN_SCHEMA_VERSION,
  EvidenceSchema,
  FeatureSchema,
  GENESIS_DIGEST,
  MAX_COLLECTION_ITEMS,
  SessionSchema,
  StateSnapshotSchema,
  StableIdSchema,
  TransitionProofSchema,
  WorkflowSchema,
  parseBoundary,
  sameRepositoryObservation,
  type Approval,
  type Decision,
  type DomainEvent,
  type Evidence,
  type EventPayload,
  type Feature,
  type Session,
  type StateSnapshot,
  type TransitionProof,
  type Workflow,
  type WorkflowState,
} from './domain.js';
import { canonicalJson, sha256Canonical } from './events.js';

export const TERMINAL_STATES = ['accepted', 'blocked', 'failed', 'cancelled'] as const;
export const NONTERMINAL_STATES = [
  'selected',
  'preparing',
  'running',
  'verifying',
  'awaiting_approval',
  'awaiting_review',
  'recovering',
] as const;
export const WORK_STATES = ['selected', 'preparing', 'running', 'verifying'] as const;

const terminalSet = new Set<WorkflowState>(TERMINAL_STATES);
const nonterminalSet = new Set<WorkflowState>(NONTERMINAL_STATES);
const workStateSet = new Set<WorkflowState>(WORK_STATES);
const EvidenceInputSchema = z.array(EvidenceSchema).max(MAX_COLLECTION_ITEMS);
const ApprovalInputSchema = z.array(ApprovalSchema).max(MAX_COLLECTION_ITEMS);
const AcceptedFeatureIdsSchema = z.array(StableIdSchema).max(MAX_COLLECTION_ITEMS);

export class StateTransitionError extends Error {
  constructor(message: string) {
    super(message.slice(0, 1_024));
    this.name = 'StateTransitionError';
  }
}

export interface TransitionFacts {
  repositoryPreflightValid: boolean;
  rolePacketValid: boolean;
  sameEpisodeEligible: boolean;
  deterministicChecksPassed: boolean;
  inScopeDiff: boolean;
  noUnknownEffects: boolean;
  humanReviewRecorded: boolean;
  reconstructedState: WorkflowState | null;
}

export interface TransitionContext {
  workflow: unknown;
  feature: unknown;
  session: unknown;
  acceptedFeatureIds: readonly string[];
  evidence: readonly unknown[];
  approvals: readonly unknown[];
  now: string;
  facts: TransitionFacts;
}

export type PreparedTransitionPayload = Extract<EventPayload, { kind: 'transition' }>;

function isProtectedResume(current: StateSnapshot | null, decision: Decision): boolean {
  return current?.state === 'awaiting_approval' && current.resumeState === decision.toState;
}

function isRestoringApprovalWait(current: StateSnapshot | null, decision: Decision): boolean {
  return (
    current?.state === 'recovering'
    && current.recoveryState === 'awaiting_approval'
    && decision.toState === 'awaiting_approval'
  );
}

function requiresConsumedApproval(current: StateSnapshot | null, decision: Decision): boolean {
  return (
    isProtectedResume(current, decision)
    || decision.toState === 'accepted'
    || decision.toState === 'cancelled'
  );
}

function expectedProtectedAction(current: StateSnapshot | null, decision: Decision): string | null {
  if (isProtectedResume(current, decision)) return current?.pendingProtectedAction ?? null;
  if (decision.toState === 'accepted') return 'accept_feature';
  if (decision.toState === 'cancelled') return 'cancel_session';
  return null;
}

export function allowedDestinations(snapshot: StateSnapshot | null): ReadonlySet<WorkflowState> {
  if (snapshot === null) return new Set<WorkflowState>(['selected']);
  const from = snapshot.state;
  if (terminalSet.has(from)) return new Set();

  const allowed = new Set<WorkflowState>();
  if (from === 'selected') allowed.add('preparing');
  if (from === 'preparing') allowed.add('running');
  if (from === 'running') {
    allowed.add('running');
    allowed.add('verifying');
  }
  if (from === 'verifying') allowed.add('awaiting_review');
  if (workStateSet.has(from)) allowed.add('awaiting_approval');
  if (from === 'awaiting_approval' && snapshot.resumeState !== null) allowed.add(snapshot.resumeState);
  if (from === 'awaiting_review') allowed.add('accepted');
  if (from === 'recovering' && snapshot.recoveryState !== null) allowed.add(snapshot.recoveryState);

  allowed.add('recovering');
  allowed.add('blocked');
  allowed.add('failed');
  allowed.add('cancelled');
  return allowed;
}

function assertBindings(
  value: { workflowId: string; featureId: string; sessionId: string },
  expected: { workflowId: string; featureId: string; sessionId: string },
  label: string
): void {
  if (
    value.workflowId !== expected.workflowId
    || value.featureId !== expected.featureId
    || value.sessionId !== expected.sessionId
  ) {
    throw new StateTransitionError(`${label} bindings do not match the active workflow, feature, and session`);
  }
}

function exactIds(expected: readonly string[], values: readonly { id: string }[], label: string): void {
  if (canonicalJson(expected) !== canonicalJson(values.map(value => value.id))) {
    throw new StateTransitionError(`${label} identifiers do not exactly match the decision references`);
  }
}

function validateReferencedEvidence(
  decision: Decision,
  evidenceValues: readonly unknown[]
): Evidence[] {
  const parsed = parseBoundary(EvidenceInputSchema, evidenceValues, 'transition evidence');
  const byId = new Map(parsed.map(evidence => [evidence.id, evidence]));
  const referenced = decision.evidenceIds.map(id => {
    const evidence = byId.get(id);
    if (!evidence) throw new StateTransitionError(`Decision references missing evidence '${id}'`);
    assertBindings(evidence, decision, `Evidence '${id}'`);
    return evidence;
  });
  exactIds(decision.evidenceIds, referenced, 'Evidence');
  return referenced;
}

function assertControllerEvidence(
  current: StateSnapshot | null,
  decision: Decision,
  evidence: readonly Evidence[]
): void {
  const requiresControllerEvidence = (
    (current?.state === 'verifying' && decision.toState === 'awaiting_review')
    || decision.toState === 'accepted'
  );
  if (!requiresControllerEvidence) return;
  if (evidence.length === 0 || evidence.some(item => item.origin !== 'controller_observed')) {
    throw new StateTransitionError('Review-bearing transitions require referenced controller-observed evidence');
  }
}

function consumeApproval(
  current: StateSnapshot | null,
  decision: Decision,
  feature: Feature,
  session: Session,
  approvalValues: readonly unknown[],
  now: string
): Approval[] {
  if (!requiresConsumedApproval(current, decision)) {
    if (decision.approvalIds.length > 0) {
      throw new StateTransitionError('An ordinary transition cannot consume an approval');
    }
    return [];
  }
  if (decision.actorAuthority !== 'human') {
    throw new StateTransitionError('A protected transition requires human authority');
  }
  if (decision.approvalIds.length !== 1) {
    throw new StateTransitionError('A protected transition requires exactly one approval');
  }
  const expectedAction = expectedProtectedAction(current, decision);
  if (expectedAction === null || decision.protectedAction !== expectedAction) {
    throw new StateTransitionError(`Protected transition requires action '${expectedAction ?? '<missing>'}'`);
  }
  const parsed = parseBoundary(ApprovalInputSchema, approvalValues, 'transition approvals');
  const approval = parsed.find(candidate => candidate.id === decision.approvalIds[0]);
  if (!approval) throw new StateTransitionError(`Decision references missing approval '${decision.approvalIds[0]}'`);
  if (current?.consumedApprovalIds.includes(approval.id)) {
    throw new StateTransitionError('Approval identifier was already consumed in protected history');
  }
  assertBindings(approval, decision, `Approval '${approval.id}'`);
  if (approval.protectedAction !== expectedAction) {
    throw new StateTransitionError('Approval action does not match the protected transition');
  }
  if (approval.consumptionState !== 'active' || approval.consumedAt !== null) {
    throw new StateTransitionError('Approval is not active and unused');
  }
  const nowMs = Date.parse(now);
  if (Date.parse(approval.issuedAt) > nowMs || Date.parse(approval.expiresAt) < nowMs) {
    throw new StateTransitionError('Approval is not currently valid');
  }
  if (canonicalJson([...approval.exactScope].sort()) !== canonicalJson([...feature.scope].sort())) {
    throw new StateTransitionError('Approval scope does not exactly match the feature scope');
  }
  if (!sameRepositoryObservation(approval.repositoryPrecondition, session.expectedRepository)) {
    throw new StateTransitionError('Approval repository preconditions do not match the session');
  }
  return [parseBoundary(ApprovalSchema, {
    ...approval,
    consumptionState: 'consumed',
    consumedAt: now,
  }, 'consumed approval')];
}

function assertDecisionAuthority(current: StateSnapshot | null, decision: Decision): void {
  if (decision.actorAuthority === 'runner' || decision.actorAuthority === 'checker' || decision.actorAuthority === 'model') {
    throw new StateTransitionError(`${decision.actorAuthority} output has no transition authority`);
  }
  if (requiresConsumedApproval(current, decision)) {
    if (decision.actorAuthority !== 'human') throw new StateTransitionError('Protected transition requires human authority');
  } else if (decision.actorAuthority !== 'controller') {
    throw new StateTransitionError('Only the controller may commit an ordinary or recovery transition');
  }
  const restoringApprovalWait = isRestoringApprovalWait(current, decision);
  if (decision.toState === 'awaiting_approval' && !restoringApprovalWait && decision.protectedAction === null) {
    throw new StateTransitionError('awaiting_approval requires a named protected action');
  }
  if (restoringApprovalWait && decision.protectedAction !== null) {
    throw new StateTransitionError('Recovery must restore the previously recorded protected action');
  }
  if (
    decision.toState !== 'awaiting_approval'
    && !requiresConsumedApproval(current, decision)
    && decision.protectedAction !== null
  ) {
    throw new StateTransitionError('Ordinary transition cannot carry a protected action');
  }
}

function assertProof(current: StateSnapshot | null, decision: Decision, proof: TransitionProof): void {
  if (current === null && (!proof.dependenciesSatisfied || !proof.scopeFixed)) {
    throw new StateTransitionError('Feature selection requires satisfied dependencies and fixed scope');
  }
  if (current?.state === 'preparing' && decision.toState === 'running') {
    if (!proof.repositoryPreflightValid || !proof.rolePacketValid) {
      throw new StateTransitionError('preparing to running requires repository preflight and a valid role packet');
    }
  }
  if (current?.state === 'running' && decision.toState === 'running' && !proof.sameEpisodeEligible) {
    throw new StateTransitionError('running continuation requires same-episode eligibility');
  }
  if (current?.state === 'verifying' && decision.toState === 'awaiting_review') {
    if (!proof.deterministicChecksPassed || !proof.inScopeDiff) {
      throw new StateTransitionError('awaiting_review requires passing deterministic checks and an in-scope diff');
    }
  }
  if (decision.toState === 'accepted') {
    if (
      !proof.dependenciesSatisfied
      || !proof.inScopeDiff
      || !proof.deterministicChecksPassed
      || !proof.noUnknownEffects
      || !proof.humanReviewRecorded
    ) {
      throw new StateTransitionError('accepted preconditions are incomplete');
    }
  }
  if (
    current?.state === 'recovering'
    && decision.toState !== 'recovering'
    && nonterminalSet.has(decision.toState)
  ) {
    if (proof.reconstructedState !== decision.toState || current.recoveryState !== decision.toState) {
      throw new StateTransitionError('recovering may return only to the reconstructed nonterminal state');
    }
  } else if (proof.reconstructedState !== null) {
    throw new StateTransitionError('reconstructedState is valid only while recovering');
  }
}

function assertTransitionPair(current: StateSnapshot | null, decision: Decision): void {
  const observedFrom = current?.state ?? null;
  if (decision.fromState !== observedFrom) {
    throw new StateTransitionError(
      `Decision prior state mismatch: expected '${observedFrom ?? 'none'}', observed '${decision.fromState ?? 'none'}'`
    );
  }
  if (!allowedDestinations(current).has(decision.toState)) {
    throw new StateTransitionError(
      `Forbidden transition '${observedFrom ?? 'none'}' -> '${decision.toState}'`
    );
  }
}

export function prepareTransition(
  currentValue: unknown,
  decisionValue: unknown,
  context: TransitionContext
): PreparedTransitionPayload {
  const current = currentValue === null
    ? null
    : parseBoundary(StateSnapshotSchema, currentValue, 'current snapshot');
  const decision = parseBoundary(DecisionSchema, decisionValue, 'transition decision');
  const workflow = parseBoundary(WorkflowSchema, context.workflow, 'workflow');
  const feature = parseBoundary(FeatureSchema, context.feature, 'feature');
  const session = parseBoundary(SessionSchema, context.session, 'session');

  assertBindings(decision, {
    workflowId: workflow.id,
    featureId: feature.featureId,
    sessionId: session.id,
  }, 'Decision');
  if (decision.createdAt !== context.now) throw new StateTransitionError('Decision time must come from the injected clock');
  if (decision.policyVersion !== workflow.policyVersion) throw new StateTransitionError('Decision policy version is stale');
  if (feature.workflowId !== workflow.id || session.workflowId !== workflow.id) {
    throw new StateTransitionError('Feature or session is bound to another workflow');
  }
  if (session.featureId !== feature.featureId || session.definitionDigest !== feature.definitionDigest) {
    throw new StateTransitionError('Session is not bound to the immutable feature definition');
  }
  if (workflow.featureIds.filter(id => id === feature.featureId).length !== 1) {
    throw new StateTransitionError('Workflow must contain the active feature exactly once');
  }
  const scopeDigest = sha256Canonical([...feature.scope].sort());
  if (scopeDigest !== session.scopeDigest) throw new StateTransitionError('Session scope digest does not match fixed feature scope');
  const acceptedFeatureIds = parseBoundary(
    AcceptedFeatureIdsSchema,
    context.acceptedFeatureIds,
    'accepted feature identifiers'
  );
  const accepted = new Set(acceptedFeatureIds);
  const dependenciesSatisfied = feature.dependencies.every(dependency => accepted.has(dependency));
  const proof = parseBoundary(TransitionProofSchema, {
    dependenciesSatisfied,
    scopeFixed: feature.scope.length > 0 && scopeDigest === session.scopeDigest,
    ...context.facts,
  }, 'transition proof');

  if (current === null) {
    if (session.state !== 'selected' || decision.toState !== 'selected') {
      throw new StateTransitionError('Initial transition must create a selected session');
    }
  } else {
    assertBindings(current, decision, 'Snapshot');
    if (
      current.definitionDigest !== feature.definitionDigest
      || current.scopeDigest !== session.scopeDigest
      || !sameRepositoryObservation(current.expectedRepository, session.expectedRepository)
    ) {
      throw new StateTransitionError('Active session definition, scope, or repository precondition changed');
    }
  }

  assertTransitionPair(current, decision);
  assertDecisionAuthority(current, decision);
  assertProof(current, decision, proof);
  const evidence = validateReferencedEvidence(decision, context.evidence);
  assertControllerEvidence(current, decision, evidence);
  const consumedApprovals = consumeApproval(
    current,
    decision,
    feature,
    session,
    context.approvals,
    context.now
  );

  return {
    kind: 'transition',
    decision,
    proof,
    definitionDigest: feature.definitionDigest,
    scopeDigest: session.scopeDigest,
    expectedRepository: session.expectedRepository,
    evidence,
    consumedApprovals,
  };
}

function validateReplayTransition(current: StateSnapshot | null, event: DomainEvent): void {
  if (event.payload.kind !== 'transition') throw new StateTransitionError('Expected transition event');
  const { decision, proof, evidence, consumedApprovals } = event.payload;
  assertTransitionPair(current, decision);
  assertDecisionAuthority(current, decision);
  assertProof(current, decision, proof);
  if (event.actor !== decision.actorAuthority) throw new StateTransitionError('Event actor does not match decision authority');
  if (event.createdAt !== decision.createdAt) throw new StateTransitionError('Event and decision timestamps disagree');
  assertBindings(event, decision, 'Event');
  exactIds(decision.evidenceIds, evidence, 'Evidence');
  for (const item of evidence) assertBindings(item, decision, `Evidence '${item.id}'`);
  assertControllerEvidence(current, decision, evidence);
  exactIds(decision.approvalIds, consumedApprovals, 'Approval');
  for (const approval of consumedApprovals) {
    assertBindings(approval, decision, `Approval '${approval.id}'`);
    if (current?.consumedApprovalIds.includes(approval.id)) {
      throw new StateTransitionError('Replayed approval identifier was already consumed in protected history');
    }
    if (approval.consumptionState !== 'consumed' || approval.consumedAt !== event.createdAt) {
      throw new StateTransitionError('Replayed approval is not atomically consumed with the event');
    }
    if (approval.protectedAction !== expectedProtectedAction(current, decision)) {
      throw new StateTransitionError('Replayed approval action does not match the transition');
    }
    if (!sameRepositoryObservation(approval.repositoryPrecondition, event.payload.expectedRepository)) {
      throw new StateTransitionError('Replayed approval repository preconditions disagree');
    }
  }
  if (requiresConsumedApproval(current, decision) !== (consumedApprovals.length === 1)) {
    throw new StateTransitionError('Protected approval consumption is inconsistent');
  }
}

function unionIds(existing: readonly string[], added: readonly string[]): string[] {
  return [...new Set([...existing, ...added])];
}

function snapshotId(sessionId: string): string {
  return `snapshot:${sha256Canonical({ sessionId }).slice(0, 32)}`;
}

export function applyDomainEvent(currentValue: unknown, event: DomainEvent): StateSnapshot {
  const current = currentValue === null
    ? null
    : parseBoundary(StateSnapshotSchema, currentValue, 'replay snapshot');
  const expectedSequence = (current?.lastEventSequence ?? 0) + 1;
  const expectedPrevious = current?.lastEventDigest ?? GENESIS_DIGEST;
  if (event.sequence !== expectedSequence || event.previousDigest !== expectedPrevious) {
    throw new StateTransitionError('Event sequence or previous digest disagrees with replay state');
  }

  if (event.payload.kind === 'transition') {
    validateReplayTransition(current, event);
    const { decision, evidence, consumedApprovals } = event.payload;
    const restoringApprovalWait = isRestoringApprovalWait(current, decision);
    const resumeState = decision.toState === 'awaiting_approval'
      ? restoringApprovalWait
        ? current?.resumeState ?? null
        : current?.state ?? null
      : decision.toState === 'recovering'
        ? current?.resumeState ?? null
        : null;
    const pendingProtectedAction = decision.toState === 'awaiting_approval'
      ? restoringApprovalWait
        ? current?.pendingProtectedAction ?? null
        : decision.protectedAction
      : decision.toState === 'recovering'
        ? current?.pendingProtectedAction ?? null
        : null;
    const recoveryState = decision.toState === 'recovering'
      ? current?.state === 'recovering'
        ? current.recoveryState
        : current?.state ?? null
      : current?.state === 'recovering'
        ? null
        : current?.recoveryState ?? null;
    const snapshot = {
      id: current?.id ?? snapshotId(event.sessionId),
      schemaVersion: DOMAIN_SCHEMA_VERSION,
      createdAt: current?.createdAt ?? event.createdAt,
      workflowId: event.workflowId,
      featureId: event.featureId,
      sessionId: event.sessionId,
      definitionDigest: event.payload.definitionDigest,
      scopeDigest: event.payload.scopeDigest,
      expectedRepository: event.payload.expectedRepository,
      state: decision.toState,
      resumeState,
      recoveryState,
      pendingProtectedAction,
      lastEventSequence: event.sequence,
      lastEventDigest: event.digest,
      evidenceIds: unionIds(current?.evidenceIds ?? [], evidence.map(item => item.id)),
      approvalIds: unionIds(current?.approvalIds ?? [], consumedApprovals.map(item => item.id)),
      consumedApprovalIds: unionIds(
        current?.consumedApprovalIds ?? [],
        consumedApprovals.map(item => item.id)
      ),
      intents: current?.intents ?? [],
      outcomes: current?.outcomes ?? [],
    };
    if (current !== null) {
      if (
        current.definitionDigest !== snapshot.definitionDigest
        || current.scopeDigest !== snapshot.scopeDigest
        || !sameRepositoryObservation(current.expectedRepository, snapshot.expectedRepository)
      ) {
        throw new StateTransitionError('Transition event attempts to replace immutable session bindings');
      }
    }
    return parseBoundary(StateSnapshotSchema, snapshot, 'transition snapshot');
  }

  if (current === null) throw new StateTransitionError('Effect record cannot precede session selection');
  if (terminalSet.has(current.state)) throw new StateTransitionError('Terminal session cannot record another effect');
  if (event.actor !== 'controller') throw new StateTransitionError('Only the controller may record effects');
  assertBindings(event, current, 'Effect event');

  if (event.payload.kind === 'evidence_recorded') {
    const { evidence } = event.payload;
    assertBindings(evidence, current, 'Recorded evidence');
    if (evidence.origin !== 'controller_observed') {
      throw new StateTransitionError('Only controller-observed evidence may enter the protected journal directly');
    }
    if (current.evidenceIds.includes(evidence.id)) {
      throw new StateTransitionError(`Duplicate evidence '${evidence.id}' in journal`);
    }
    return parseBoundary(StateSnapshotSchema, {
      ...current,
      lastEventSequence: event.sequence,
      lastEventDigest: event.digest,
      evidenceIds: [...current.evidenceIds, evidence.id],
    }, 'evidence-recorded snapshot');
  }

  if (event.payload.kind === 'effect_intent') {
    const { intent, consumedApproval } = event.payload;
    assertBindings(intent, current, 'Effect intent');
    if (current.intents.some(item => item.operationId === intent.operationId)) {
      throw new StateTransitionError(`Duplicate effect operation '${intent.operationId}' in journal`);
    }
    if (
      intent.idempotencyKey !== null
      && current.intents.some(item => item.idempotencyKey === intent.idempotencyKey)
    ) {
      throw new StateTransitionError(`Duplicate idempotency key '${intent.idempotencyKey}' in journal`);
    }
    if ((intent.approvalId === null) !== (consumedApproval === null)) {
      throw new StateTransitionError('Effect approval consumption does not match the intent');
    }
    if (consumedApproval !== null) {
      assertBindings(consumedApproval, current, 'Effect approval');
      if (
        current.consumedApprovalIds.includes(consumedApproval.id)
        || consumedApproval.id !== intent.approvalId
        || consumedApproval.consumptionState !== 'consumed'
        || consumedApproval.consumedAt !== event.createdAt
        || canonicalJson([...consumedApproval.exactScope].sort()) !== canonicalJson([...intent.exactScope].sort())
        || !sameRepositoryObservation(consumedApproval.repositoryPrecondition, current.expectedRepository)
      ) {
        throw new StateTransitionError('Effect approval is forged or mismatched');
      }
    }
    return parseBoundary(StateSnapshotSchema, {
      ...current,
      lastEventSequence: event.sequence,
      lastEventDigest: event.digest,
      approvalIds: consumedApproval ? unionIds(current.approvalIds, [consumedApproval.id]) : current.approvalIds,
      consumedApprovalIds: consumedApproval
        ? unionIds(current.consumedApprovalIds, [consumedApproval.id])
        : current.consumedApprovalIds,
      intents: [...current.intents, intent],
    }, 'effect-intent snapshot');
  }

  const { outcome } = event.payload;
  assertBindings(outcome, current, 'Effect outcome');
  const intent = current.intents.find(item => item.operationId === outcome.operationId);
  if (!intent || intent.idempotencyKey !== outcome.idempotencyKey) {
    throw new StateTransitionError(`Effect outcome '${outcome.operationId}' has no matching intent`);
  }
  if (current.outcomes.some(item => item.operationId === outcome.operationId)) {
    throw new StateTransitionError(`Duplicate effect outcome '${outcome.operationId}' in journal`);
  }
  return parseBoundary(StateSnapshotSchema, {
    ...current,
    lastEventSequence: event.sequence,
    lastEventDigest: event.digest,
    outcomes: [...current.outcomes, outcome],
  }, 'effect-outcome snapshot');
}

export function isTerminalState(state: WorkflowState): boolean {
  return terminalSet.has(state);
}

export function isNonterminalState(state: WorkflowState): boolean {
  return nonterminalSet.has(state);
}

export function makeDefaultFacts(overrides: Partial<TransitionFacts> = {}): TransitionFacts {
  return {
    repositoryPreflightValid: false,
    rolePacketValid: false,
    sameEpisodeEligible: false,
    deterministicChecksPassed: false,
    inScopeDiff: false,
    noUnknownEffects: false,
    humanReviewRecorded: false,
    reconstructedState: null,
    ...overrides,
  };
}

export function validateFeatureSelection(
  workflowValue: unknown,
  featureValue: unknown,
  sessionValue: unknown,
  acceptedFeatureIds: readonly string[]
): { workflow: Workflow; feature: Feature; session: Session } {
  const workflow = parseBoundary(WorkflowSchema, workflowValue, 'workflow selection');
  const feature = parseBoundary(FeatureSchema, featureValue, 'feature selection');
  const session = parseBoundary(SessionSchema, sessionValue, 'session selection');
  const accepted = parseBoundary(
    AcceptedFeatureIdsSchema,
    acceptedFeatureIds,
    'accepted feature identifiers'
  );
  if (workflow.featureIds.filter(id => id === feature.featureId).length !== 1) {
    throw new StateTransitionError('Exactly one catalog feature must be selected');
  }
  if (!feature.dependencies.every(dependency => accepted.includes(dependency))) {
    throw new StateTransitionError('Selected feature dependencies are not accepted');
  }
  if (feature.scope.length === 0 || sha256Canonical([...feature.scope].sort()) !== session.scopeDigest) {
    throw new StateTransitionError('Selected feature scope is not fixed');
  }
  return { workflow, feature, session };
}
