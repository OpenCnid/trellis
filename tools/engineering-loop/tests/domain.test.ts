import { describe, expect, it } from 'vitest';
import {
  ApprovalSchema,
  DecisionSchema,
  EpisodeSchema,
  EventSchema,
  EvidenceSchema,
  FeatureSchema,
  ReportSchema,
  SessionSchema,
  WorkflowSchema,
  WorkflowStateSchema,
} from '../src/domain';
import { createDomainEvent } from '../src/events';
import { makeDefaultFacts, prepareTransition } from '../src/state_machine';
import {
  FEATURE,
  NOW,
  REPOSITORY,
  SESSION,
  WORKFLOW,
  makeApproval,
  makeDecision,
  makeEvidence,
} from './fixtures';

function nineObjects() {
  const decision = makeDecision({ from: null, to: 'selected' });
  const payload = prepareTransition(null, decision, {
    workflow: WORKFLOW,
    feature: FEATURE,
    session: SESSION,
    acceptedFeatureIds: ['EL-01'],
    evidence: [],
    approvals: [],
    now: NOW,
    facts: makeDefaultFacts(),
  });
  const event = createDomainEvent({ current: null, payload, actor: 'controller', createdAt: NOW });
  return [
    [WorkflowSchema, WORKFLOW],
    [FeatureSchema, FEATURE],
    [SessionSchema, SESSION],
    [EpisodeSchema, {
      id: 'episode:1', schemaVersion: 1, createdAt: NOW,
      workflowId: WORKFLOW.id, featureId: FEATURE.featureId, sessionId: SESSION.id,
      role: 'implementer', semanticPhase: 'implementation', definitionDigest: FEATURE.definitionDigest,
      repositoryPrecondition: REPOSITORY, promptDigest: '7'.repeat(64),
      timeBudgetMs: 60_000, turnBudget: 8, contextBudgetTokens: 32_000,
      runnerId: null, threadId: null, turnId: null, terminalReason: null,
    }],
    [EventSchema, event],
    [ApprovalSchema, makeApproval('accept_feature')],
    [EvidenceSchema, makeEvidence()],
    [DecisionSchema, decision],
    [ReportSchema, {
      id: 'report:1', schemaVersion: 1, createdAt: NOW,
      workflowId: WORKFLOW.id, featureId: FEATURE.featureId, sessionId: SESSION.id,
      feature: FEATURE.featureId, result: 'ready_for_owner_review', artifacts: [],
      normative_requirements: { required: 28, implemented: 28, verified: 28, outstanding: [] },
      verification: [], findings: [], next_feature: 'EL-03',
    }],
  ] as const;
}

describe('EL-02 domain boundaries', () => {
  it('validates all nine versioned domain objects and rejects unknown fields', () => {
    const objects = nineObjects();
    expect(objects).toHaveLength(9);
    for (const [schema, value] of objects) {
      expect(schema.safeParse(value).success).toBe(true);
      expect(schema.safeParse({ ...value, unexpected: true }).success).toBe(false);
      expect(schema.safeParse({ ...value, schemaVersion: 2 }).success).toBe(false);
    }
  });

  it('requires stable identifiers, creation time, and workflow bindings on persisted records', () => {
    const objects = nineObjects().map(([, value]) => value);
    for (const value of objects) {
      expect(value).toHaveProperty('id');
      expect(value).toHaveProperty('schemaVersion', 1);
      expect(value).toHaveProperty('createdAt');
    }
    for (const value of objects.slice(1)) expect(value).toHaveProperty('workflowId', WORKFLOW.id);
  });

  it('rejects unknown states rather than coercing them', () => {
    expect(WorkflowStateSchema.safeParse('selected').success).toBe(true);
    expect(WorkflowStateSchema.safeParse('complete').success).toBe(false);
    expect(SessionSchema.safeParse({ ...SESSION, state: 'complete' }).success).toBe(false);
  });

  it('requires evidence origin plus a digest or immutable reference', () => {
    expect(EvidenceSchema.safeParse(makeEvidence()).success).toBe(true);
    expect(EvidenceSchema.safeParse({ ...makeEvidence(), origin: 'model_claimed' }).success).toBe(false);
    expect(EvidenceSchema.safeParse({ ...makeEvidence(), digest: null, immutableReference: null }).success).toBe(false);
    expect(EvidenceSchema.safeParse({ ...makeEvidence(), digest: null, immutableReference: 'artifact:42' }).success).toBe(true);
  });

  it('refuses over-bound identifiers, text, collections, and retained metadata', () => {
    expect(DecisionSchema.safeParse({ ...makeDecision({ from: null, to: 'selected' }), reason: 'x'.repeat(4_097) }).success).toBe(false);
    expect(EvidenceSchema.safeParse({
      ...makeEvidence(),
      metadata: Array.from({ length: 65 }, (_, index) => ({ key: `k${index}`, value: 'v' })),
    }).success).toBe(false);
    expect(FeatureSchema.safeParse({
      ...FEATURE,
      scope: Array.from({ length: 129 }, (_, index) => `path-${index}`),
    }).success).toBe(false);
  });
});
