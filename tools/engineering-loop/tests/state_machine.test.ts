import { describe, expect, it } from 'vitest';
import { createDomainEvent } from '../src/events';
import { FakeEffectTarget } from '../src/fakes';
import {
  StateTransitionError,
  applyDomainEvent,
  makeDefaultFacts,
  prepareTransition,
  type TransitionFacts,
} from '../src/state_machine';
import type { Approval, StateSnapshot, WorkflowState } from '../src/domain';
import {
  FEATURE,
  NOW,
  REPOSITORY,
  SESSION,
  WORKFLOW,
  makeApproval,
  makeDecision,
  makeEvidence,
  makeSnapshot,
} from './fixtures';

const STATES: WorkflowState[] = [
  'selected', 'preparing', 'running', 'verifying', 'awaiting_approval',
  'awaiting_review', 'recovering', 'accepted', 'blocked', 'failed', 'cancelled',
];

const EXPECTED_ALLOWED: Record<string, WorkflowState[]> = {
  none: ['selected'],
  selected: ['preparing', 'awaiting_approval', 'recovering', 'blocked', 'failed', 'cancelled'],
  preparing: ['running', 'awaiting_approval', 'recovering', 'blocked', 'failed', 'cancelled'],
  running: ['running', 'verifying', 'awaiting_approval', 'recovering', 'blocked', 'failed', 'cancelled'],
  verifying: ['awaiting_review', 'awaiting_approval', 'recovering', 'blocked', 'failed', 'cancelled'],
  awaiting_approval: ['selected', 'recovering', 'blocked', 'failed', 'cancelled'],
  awaiting_review: ['accepted', 'recovering', 'blocked', 'failed', 'cancelled'],
  recovering: ['selected', 'recovering', 'blocked', 'failed', 'cancelled'],
  accepted: [],
  blocked: [],
  failed: [],
  cancelled: [],
};

function caseInput(from: WorkflowState | null, to: WorkflowState) {
  let actor: 'controller' | 'human' = 'controller';
  let protectedAction: string | null = null;
  let approvals: Approval[] = [];
  let approvalIds: string[] = [];
  const evidence = (
    (from === 'verifying' && to === 'awaiting_review')
    || (from === 'awaiting_review' && to === 'accepted')
  ) ? [makeEvidence()] : [];
  if (to === 'awaiting_approval') protectedAction = 'paid_run';
  if (from === 'awaiting_approval' && to === 'selected') protectedAction = 'paid_run';
  if (from === 'awaiting_review' && to === 'accepted') protectedAction = 'accept_feature';
  if (to === 'cancelled') protectedAction = 'cancel_session';
  if (
    (from === 'awaiting_approval' && to === 'selected')
    || (from === 'awaiting_review' && to === 'accepted')
    || to === 'cancelled'
  ) {
    actor = 'human';
    const approval = makeApproval(protectedAction as string);
    approvals = [approval];
    approvalIds = [approval.id];
  }
  const facts: Partial<TransitionFacts> = {
    ...(from === 'preparing' && to === 'running'
      ? { repositoryPreflightValid: true, rolePacketValid: true }
      : {}),
    ...(from === 'running' && to === 'running' ? { sameEpisodeEligible: true } : {}),
    ...(from === 'verifying' && to === 'awaiting_review'
      ? { deterministicChecksPassed: true, inScopeDiff: true }
      : {}),
    ...(from === 'awaiting_review' && to === 'accepted'
      ? {
          deterministicChecksPassed: true,
          inScopeDiff: true,
          noUnknownEffects: true,
          humanReviewRecorded: true,
        }
      : {}),
    ...(from === 'recovering' && to === 'selected' ? { reconstructedState: 'selected' } : {}),
  };
  return {
    current: from === null ? null : makeSnapshot(from),
    decision: makeDecision({
      from,
      to,
      actor,
      protectedAction,
      approvalIds,
      evidenceIds: evidence.map(item => item.id),
    }),
    approvals,
    evidence,
    facts,
  };
}

function prepare(from: WorkflowState | null, to: WorkflowState) {
  const input = caseInput(from, to);
  return prepareTransition(input.current, input.decision, {
    workflow: WORKFLOW,
    feature: FEATURE,
    session: SESSION,
    acceptedFeatureIds: ['EL-01'],
    evidence: input.evidence,
    approvals: input.approvals,
    now: NOW,
    facts: makeDefaultFacts(input.facts),
  });
}

describe('EL-02 pure state machine', () => {
  it('exhaustively accepts exactly 41 allowed pairs and refuses the other 91 before any effect', () => {
    const effect = new FakeEffectTarget();
    let allowed = 0;
    let forbidden = 0;
    for (const from of [null, ...STATES] as const) {
      for (const to of STATES) {
        const expected = EXPECTED_ALLOWED[from ?? 'none'].includes(to);
        if (expected) {
          expect(() => prepare(from, to), `${from ?? 'none'} -> ${to}`).not.toThrow();
          allowed++;
        } else {
          expect(() => prepare(from, to), `${from ?? 'none'} -> ${to}`).toThrow(StateTransitionError);
          forbidden++;
        }
      }
    }
    expect({ allowed, forbidden, total: allowed + forbidden }).toEqual({ allowed: 41, forbidden: 91, total: 132 });
    expect(effect.invocations).toBe(0);
  });

  it('commits the complete ordinary path without skipping preparing, running, verifying, or review', () => {
    let snapshot: StateSnapshot | null = null;
    const path: WorkflowState[] = ['selected', 'preparing', 'running', 'verifying', 'awaiting_review', 'accepted'];
    for (const to of path) {
      const from = snapshot?.state ?? null;
      const input = caseInput(from, to);
      const payload = prepareTransition(snapshot, input.decision, {
        workflow: WORKFLOW,
        feature: FEATURE,
        session: SESSION,
        acceptedFeatureIds: ['EL-01'],
        evidence: input.evidence,
        approvals: input.approvals,
        now: NOW,
        facts: makeDefaultFacts(input.facts),
      });
      const event = createDomainEvent({
        current: snapshot,
        payload,
        actor: input.decision.actorAuthority,
        createdAt: NOW,
      });
      snapshot = applyDomainEvent(snapshot, event);
    }
    expect(snapshot?.state).toBe('accepted');
    expect(snapshot?.lastEventSequence).toBe(6);
    expect(snapshot?.consumedApprovalIds).toEqual(['approval:accept_feature']);
  });

  it('refuses forged, expired, consumed, scope-widened, and repository-mismatched approvals', () => {
    const current = makeSnapshot('awaiting_review');
    const base = makeApproval('accept_feature');
    const variants: Approval[] = [
      { ...base, protectedAction: 'merge' },
      { ...base, expiresAt: '2026-07-14T11:59:59.000Z' },
      { ...base, consumptionState: 'consumed', consumedAt: NOW },
      { ...base, exactScope: [...base.exactScope, 'src'] },
      { ...base, repositoryPrecondition: { ...REPOSITORY, headCommit: '9'.repeat(64) } },
    ];
    for (const approval of variants) {
      const decision = makeDecision({
        from: 'awaiting_review', to: 'accepted', actor: 'human',
        protectedAction: 'accept_feature', approvalIds: [approval.id],
      });
      expect(() => prepareTransition(current, decision, {
        workflow: WORKFLOW, feature: FEATURE, session: SESSION,
        acceptedFeatureIds: ['EL-01'], evidence: [], approvals: [approval], now: NOW,
        facts: makeDefaultFacts(),
      })).toThrow(StateTransitionError);
    }

    const controllerEvidence = makeEvidence();
    const replayedSnapshot = {
      ...current,
      approvalIds: [base.id],
      consumedApprovalIds: [base.id],
    };
    expect(() => prepareTransition(
      replayedSnapshot,
      makeDecision({
        from: 'awaiting_review',
        to: 'accepted',
        actor: 'human',
        protectedAction: 'accept_feature',
        approvalIds: [base.id],
        evidenceIds: [controllerEvidence.id],
      }),
      {
        workflow: WORKFLOW,
        feature: FEATURE,
        session: SESSION,
        acceptedFeatureIds: ['EL-01'],
        evidence: [controllerEvidence],
        approvals: [base],
        now: NOW,
        facts: makeDefaultFacts({
          deterministicChecksPassed: true,
          inScopeDiff: true,
          noUnknownEffects: true,
          humanReviewRecorded: true,
        }),
      }
    )).toThrow(/already consumed in protected history/);

    const pending = makeSnapshot('awaiting_approval', { pendingProtectedAction: 'paid_run' });
    const substituted = makeApproval('merge');
    expect(() => prepareTransition(
      pending,
      makeDecision({
        from: 'awaiting_approval',
        to: 'selected',
        actor: 'human',
        protectedAction: 'merge',
        approvalIds: [substituted.id],
      }),
      {
        workflow: WORKFLOW,
        feature: FEATURE,
        session: SESSION,
        acceptedFeatureIds: ['EL-01'],
        evidence: [],
        approvals: [substituted],
        now: NOW,
        facts: makeDefaultFacts(),
      }
    )).toThrow(/requires action 'paid_run'/);
  });

  it('refuses runner, checker, and model transition authority', () => {
    for (const actor of ['runner', 'checker', 'model'] as const) {
      const decision = makeDecision({ from: 'selected', to: 'preparing', actor });
      expect(() => prepareTransition(makeSnapshot('selected'), decision, {
        workflow: WORKFLOW, feature: FEATURE, session: SESSION,
        acceptedFeatureIds: ['EL-01'], evidence: [], approvals: [], now: NOW,
        facts: makeDefaultFacts(),
      })).toThrow(`${actor} output has no transition authority`);
    }

    const runnerEvidence = { ...makeEvidence('evidence:runner'), origin: 'runner_reported' as const };
    expect(() => prepareTransition(
      makeSnapshot('verifying'),
      makeDecision({
        from: 'verifying',
        to: 'awaiting_review',
        evidenceIds: [runnerEvidence.id],
      }),
      {
        workflow: WORKFLOW,
        feature: FEATURE,
        session: SESSION,
        acceptedFeatureIds: ['EL-01'],
        evidence: [runnerEvidence],
        approvals: [],
        now: NOW,
        facts: makeDefaultFacts({ deterministicChecksPassed: true, inScopeDiff: true }),
      }
    )).toThrow('controller-observed evidence');
  });

  it('refuses dependency, definition, scope, and acceptance-precondition drift', () => {
    expect(() => prepareTransition(null, makeDecision({ from: null, to: 'selected' }), {
      workflow: WORKFLOW, feature: FEATURE, session: SESSION,
      acceptedFeatureIds: [], evidence: [], approvals: [], now: NOW, facts: makeDefaultFacts(),
    })).toThrow('satisfied dependencies');

    expect(() => prepareTransition(makeSnapshot('selected'), makeDecision({ from: 'selected', to: 'preparing' }), {
      workflow: WORKFLOW, feature: { ...FEATURE, definitionDigest: '8'.repeat(64) }, session: SESSION,
      acceptedFeatureIds: ['EL-01'], evidence: [], approvals: [], now: NOW, facts: makeDefaultFacts(),
    })).toThrow('immutable feature definition');

    const approval = makeApproval('accept_feature');
    expect(() => prepareTransition(
      makeSnapshot('awaiting_review'),
      makeDecision({
        from: 'awaiting_review', to: 'accepted', actor: 'human',
        protectedAction: 'accept_feature', approvalIds: [approval.id],
      }),
      {
        workflow: WORKFLOW, feature: FEATURE, session: SESSION,
        acceptedFeatureIds: ['EL-01'], evidence: [], approvals: [approval], now: NOW,
        facts: makeDefaultFacts({ deterministicChecksPassed: false }),
      }
    )).toThrow('accepted preconditions');
  });
});
