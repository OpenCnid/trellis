import { z } from 'zod';
import {
  ApprovalSchema,
  DOMAIN_SCHEMA_VERSION,
  DecisionSchema,
  EvidenceSchema,
  EffectIntentSchema,
  EffectOutcomeSchema,
  FeatureSchema,
  MAX_COLLECTION_ITEMS,
  RepositoryObservationSchema,
  SessionSchema,
  StableIdSchema,
  WorkflowSchema,
  parseBoundary,
  sameRepositoryObservation,
  type Approval,
  type Decision,
  type EffectIntent,
  type EffectOutcome,
  type Evidence,
  type Feature,
  type Session,
  type StateSnapshot,
  type Workflow,
  type WorkflowState,
} from './domain.js';
import { canonicalJson } from './events.js';
import {
  EffectReconciliationSchema,
  EffectResultSchema,
  type EffectPort,
  type EffectResult,
  type RepositoryPort,
  type RunnerPort,
} from './fakes.js';
import {
  StateTransitionError,
  makeDefaultFacts,
  prepareTransition,
  validateFeatureSelection,
  type TransitionFacts,
} from './state_machine.js';
import type { Clock } from './state_store.js';
import { StateStore } from './state_store.js';

export interface ControlKernelOptions {
  store: StateStore;
  clock: Clock;
  repository: RepositoryPort;
  runner: RunnerPort;
  effects: EffectPort;
  workflow: unknown;
  feature: unknown;
  session: unknown;
  acceptedFeatureIds: readonly string[];
}

export interface TransitionInput {
  decision: unknown;
  evidence?: readonly unknown[];
  approvals?: readonly unknown[];
  facts?: Partial<TransitionFacts>;
}

const EffectApprovalInputSchema = z.array(ApprovalSchema).max(MAX_COLLECTION_ITEMS);
const AcceptedFeatureIdsInputSchema = z.array(StableIdSchema).max(MAX_COLLECTION_ITEMS);

export class ControlKernel {
  readonly store: StateStore;
  readonly clock: Clock;
  readonly repository: RepositoryPort;
  readonly runner: RunnerPort;
  readonly effects: EffectPort;
  readonly workflow: Workflow;
  readonly feature: Feature;
  readonly session: Session;
  readonly acceptedFeatureIds: readonly string[];
  #decisionSequence = 0;

  constructor(options: ControlKernelOptions) {
    this.store = options.store;
    this.clock = options.clock;
    this.repository = options.repository;
    this.runner = options.runner;
    this.effects = options.effects;
    this.workflow = parseBoundary(WorkflowSchema, options.workflow, 'kernel workflow');
    this.feature = parseBoundary(FeatureSchema, options.feature, 'kernel feature');
    this.session = parseBoundary(SessionSchema, options.session, 'kernel session');
    this.acceptedFeatureIds = parseBoundary(
      AcceptedFeatureIdsInputSchema,
      options.acceptedFeatureIds,
      'kernel accepted feature identifiers'
    );
    const current = this.store.snapshot;
    if (current !== null) {
      if (
        current.workflowId !== this.workflow.id
        || current.featureId !== this.feature.featureId
        || current.sessionId !== this.session.id
      ) {
        throw new StateTransitionError('Kernel bindings do not match reconstructed protected state');
      }
      this.#decisionSequence = current.lastEventSequence;
    }
  }

  get snapshot(): StateSnapshot | null {
    return this.store.snapshot;
  }

  private decision(input: {
    fromState: WorkflowState | null;
    toState: WorkflowState;
    actorAuthority?: 'controller' | 'human';
    reason: string;
    evidenceIds?: string[];
    approvalIds?: string[];
    protectedAction?: string | null;
  }): Decision {
    this.#decisionSequence++;
    return parseBoundary(DecisionSchema, {
      id: `decision:${this.session.id}:${this.#decisionSequence}`,
      schemaVersion: DOMAIN_SCHEMA_VERSION,
      createdAt: this.clock.now(),
      workflowId: this.workflow.id,
      featureId: this.feature.featureId,
      sessionId: this.session.id,
      fromState: input.fromState,
      toState: input.toState,
      actorAuthority: input.actorAuthority ?? 'controller',
      policyVersion: this.workflow.policyVersion,
      reason: input.reason,
      evidenceIds: input.evidenceIds ?? [],
      approvalIds: input.approvalIds ?? [],
      protectedAction: input.protectedAction ?? null,
    }, 'kernel decision');
  }

  async initialize(): Promise<StateSnapshot> {
    if (this.store.snapshot !== null) throw new StateTransitionError('Workflow session is already initialized');
    validateFeatureSelection(this.workflow, this.feature, this.session, this.acceptedFeatureIds);
    const observed = parseBoundary(
      RepositoryObservationSchema,
      await this.repository.observe(),
      'kernel repository preflight observation'
    );
    if (!sameRepositoryObservation(observed, this.session.expectedRepository)) {
      throw new StateTransitionError('Fake repository preflight does not match the selected session');
    }
    const decision = this.decision({
      fromState: null,
      toState: 'selected',
      reason: 'select one dependency-satisfied feature with fixed scope',
    });
    return this.transition({
      decision,
      facts: { repositoryPreflightValid: true },
    });
  }

  async transition(input: TransitionInput): Promise<StateSnapshot> {
    const decision = parseBoundary(DecisionSchema, input.decision, 'kernel transition decision');
    const payload = prepareTransition(this.store.snapshot, decision, {
      workflow: this.workflow,
      feature: this.feature,
      session: this.session,
      acceptedFeatureIds: this.acceptedFeatureIds,
      evidence: input.evidence ?? [],
      approvals: input.approvals ?? [],
      now: this.clock.now(),
      facts: makeDefaultFacts(input.facts),
    });
    const consumesApproval = payload.consumedApprovals.length === 1;
    if (consumesApproval) this.store.crashInjector.hit('before_approval_consumption');
    const snapshot = await this.store.commit(payload, decision.actorAuthority);
    if (consumesApproval) this.store.crashInjector.hit('after_approval_consumption');
    return snapshot;
  }

  async collectRunnerEvidence(input: { episodeId: string; requestId: string }): Promise<Evidence> {
    const snapshot = this.store.snapshot;
    if (snapshot === null || snapshot.state !== 'running') {
      throw new StateTransitionError('Fake runner may start only from running state');
    }
    if (snapshot.intents.some(intent => !snapshot.outcomes.some(outcome => outcome.operationId === intent.operationId))) {
      throw new StateTransitionError('Runner cannot start while an effect intent is unreconciled');
    }
    if (snapshot.outcomes.some(outcome => outcome.status === 'unknown')) {
      throw new StateTransitionError('Runner cannot start with an unknown external effect outcome');
    }
    const evidence = parseBoundary(EvidenceSchema, await this.runner.start({
      workflowId: snapshot.workflowId,
      featureId: snapshot.featureId,
      sessionId: snapshot.sessionId,
      episodeId: input.episodeId,
      requestId: input.requestId,
    }), 'kernel runner evidence');
    if (
      evidence.workflowId !== snapshot.workflowId
      || evidence.featureId !== snapshot.featureId
      || evidence.sessionId !== snapshot.sessionId
      || evidence.origin !== 'runner_reported'
    ) {
      throw new StateTransitionError('Runner evidence is forged or bound to another active session');
    }
    return evidence;
  }

  private consumeEffectApproval(intent: EffectIntent, approvalValues: readonly unknown[]): Approval | null {
    if (intent.approvalId === null) return null;
    const approval = parseBoundary(EffectApprovalInputSchema, approvalValues, 'effect approvals')
      .find(value => value.id === intent.approvalId);
    if (!approval) throw new StateTransitionError(`Effect intent references missing approval '${intent.approvalId}'`);
    if (this.store.snapshot?.consumedApprovalIds.includes(approval.id)) {
      throw new StateTransitionError('Effect approval identifier was already consumed in protected history');
    }
    if (
      approval.workflowId !== intent.workflowId
      || approval.featureId !== intent.featureId
      || approval.sessionId !== intent.sessionId
      || approval.protectedAction !== `effect:${intent.target}`
      || approval.consumptionState !== 'active'
      || approval.consumedAt !== null
      || canonicalJson([...approval.exactScope].sort()) !== canonicalJson([...intent.exactScope].sort())
      || !sameRepositoryObservation(approval.repositoryPrecondition, this.session.expectedRepository)
      || Date.parse(approval.issuedAt) > Date.parse(this.clock.now())
      || Date.parse(approval.expiresAt) < Date.parse(this.clock.now())
    ) {
      throw new StateTransitionError('Effect approval is forged, expired, consumed, or mismatched');
    }
    return parseBoundary(ApprovalSchema, {
      ...approval,
      consumptionState: 'consumed',
      consumedAt: this.clock.now(),
    }, 'consumed effect approval');
  }

  private validateIntent(intentValue: unknown): EffectIntent {
    const intent = parseBoundary(EffectIntentSchema, intentValue, 'effect intent');
    const snapshot = this.store.snapshot;
    if (snapshot === null) throw new StateTransitionError('Effect intent requires initialized state');
    if (
      intent.workflowId !== snapshot.workflowId
      || intent.featureId !== snapshot.featureId
      || intent.sessionId !== snapshot.sessionId
    ) {
      throw new StateTransitionError('Effect intent bindings do not match the active session');
    }
    if (intent.createdAt !== this.clock.now()) throw new StateTransitionError('Effect intent time must come from fake clock');
    return intent;
  }

  private makeOutcome(intent: EffectIntent, resultValue: unknown): EffectOutcome {
    const result = parseBoundary(EffectResultSchema, resultValue, 'effect target result');
    return parseBoundary(EffectOutcomeSchema, {
      id: `outcome:${intent.operationId}`,
      schemaVersion: DOMAIN_SCHEMA_VERSION,
      createdAt: this.clock.now(),
      workflowId: intent.workflowId,
      featureId: intent.featureId,
      sessionId: intent.sessionId,
      operationId: intent.operationId,
      idempotencyKey: intent.idempotencyKey,
      status: result.status,
      resultDigest: result.resultDigest,
      detail: result.detail,
      reconciliationRequired: result.reconciliationRequired,
    }, 'effect outcome');
  }

  private async recordOutcome(intent: EffectIntent, result: EffectResult): Promise<EffectOutcome> {
    const outcome = this.makeOutcome(intent, result);
    this.store.crashInjector.hit('before_outcome_record');
    await this.store.commit({ kind: 'effect_outcome', outcome }, 'controller');
    this.store.crashInjector.hit('after_outcome_record');
    if (outcome.status === 'unknown') await this.blockForUnknownOutcome(outcome);
    return outcome;
  }

  private async invokeAndRecord(intent: EffectIntent): Promise<EffectOutcome> {
    this.store.crashInjector.hit('before_effect_invocation');
    let result: EffectResult;
    try {
      result = parseBoundary(EffectResultSchema, await this.effects.invoke(intent), 'effect invocation result');
    } catch (error) {
      result = {
        status: 'unknown',
        resultDigest: null,
        detail: `effect invocation error: ${error instanceof Error ? error.message : String(error)}`.slice(0, 1_024),
        reconciliationRequired: `reconcile:${intent.operationId}`,
      };
    }
    this.store.crashInjector.hit('after_effect_invocation');
    return this.recordOutcome(intent, result);
  }

  async executeEffect(intentValue: unknown, approvalValues: readonly unknown[] = []): Promise<EffectOutcome> {
    const intent = this.validateIntent(intentValue);
    const snapshot = this.store.snapshot as StateSnapshot;
    const priorIntent = snapshot.intents.find(item => item.operationId === intent.operationId);
    const priorOutcome = snapshot.outcomes.find(item => item.operationId === intent.operationId);
    if (priorIntent) {
      if (
        priorIntent.idempotencyKey !== intent.idempotencyKey
        || canonicalJson(priorIntent) !== canonicalJson(intent)
      ) {
        throw new StateTransitionError('Effect retry must reuse the identical operation and idempotency record');
      }
      if (priorOutcome) return priorOutcome;
      await this.recoverIncompleteEffects();
      const recovered = this.store.snapshot?.outcomes.find(item => item.operationId === intent.operationId);
      if (!recovered) throw new StateTransitionError('Effect recovery did not produce an outcome');
      return recovered;
    }
    if (
      intent.idempotencyKey !== null
      && snapshot.intents.some(item => item.idempotencyKey === intent.idempotencyKey)
    ) {
      throw new StateTransitionError('Idempotency key is already bound to another operation');
    }
    const consumedApproval = this.consumeEffectApproval(intent, approvalValues);
    if (consumedApproval) this.store.crashInjector.hit('before_approval_consumption');
    this.store.crashInjector.hit('before_intent_record');
    await this.store.commit({ kind: 'effect_intent', intent, consumedApproval }, 'controller');
    this.store.crashInjector.hit('after_intent_record');
    if (consumedApproval) this.store.crashInjector.hit('after_approval_consumption');
    return this.invokeAndRecord(intent);
  }

  private async blockForUnknownOutcome(outcome: EffectOutcome): Promise<void> {
    const snapshot = this.store.snapshot;
    if (snapshot === null || snapshot.state === 'blocked') return;
    const decision = this.decision({
      fromState: snapshot.state,
      toState: 'blocked',
      reason: `Unknown outcome for operation '${outcome.operationId}' requires '${outcome.reconciliationRequired}'`,
    });
    await this.transition({
      decision,
      facts: { noUnknownEffects: false },
    });
  }

  async recoverIncompleteEffects(): Promise<StateSnapshot> {
    let snapshot = this.store.snapshot;
    if (snapshot === null) throw new StateTransitionError('Recovery requires initialized protected state');
    const pending = snapshot.intents.filter(
      intent => !snapshot?.outcomes.some(outcome => outcome.operationId === intent.operationId)
    );
    if (pending.length === 0) return snapshot;

    const reconstructedState = snapshot.state === 'recovering'
      ? snapshot.recoveryState
      : snapshot.state;
    if (reconstructedState === null) throw new StateTransitionError('Recovery state is absent');
    if (snapshot.state !== 'recovering') {
      const enterRecovery = this.decision({
        fromState: snapshot.state,
        toState: 'recovering',
        reason: 'reconstruct durable state before reconciling incomplete effects',
      });
      await this.transition({ decision: enterRecovery });
      snapshot = this.store.snapshot as StateSnapshot;
    }

    const observed = parseBoundary(
      RepositoryObservationSchema,
      await this.repository.observe(),
      'kernel recovery repository observation'
    );
    if (!sameRepositoryObservation(observed, snapshot.expectedRepository)) {
      throw new StateTransitionError('Repository re-observation disagrees during restart recovery');
    }

    for (const intent of pending) {
      const reconciliation = parseBoundary(
        EffectReconciliationSchema,
        await this.effects.reconcile(intent),
        'effect reconciliation result'
      );
      if (reconciliation.status === 'known') {
        await this.recordOutcome(intent, reconciliation.result);
        continue;
      }
      if (reconciliation.status === 'not_started') {
        await this.invokeAndRecord(intent);
        continue;
      }
      await this.recordOutcome(intent, {
        status: 'unknown',
        resultDigest: null,
        detail: 'external target could not determine whether the effect completed',
        reconciliationRequired: reconciliation.reconciliationRequired,
      });
      return this.store.snapshot as StateSnapshot;
    }

    snapshot = this.store.snapshot as StateSnapshot;
    if (snapshot.state === 'recovering') {
      const leaveRecovery = this.decision({
        fromState: 'recovering',
        toState: reconstructedState,
        reason: 'journal replay and external reconciliation agree',
      });
      await this.transition({
        decision: leaveRecovery,
        facts: { reconstructedState },
      });
    }
    return this.store.snapshot as StateSnapshot;
  }

  async close(): Promise<void> {
    await this.store.close();
  }
}
