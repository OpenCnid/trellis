import { describe, expect, it } from 'vitest';
import {
  MAX_RETRY_ATTEMPTS,
  RECOVERY_POLICY_VERSION,
  RECOVERY_SCHEMA_VERSION,
  appendSignedReconciliation,
  decideRecovery,
  type FailureClass,
} from '../src/recovery';

const NOW = '2026-07-15T12:00:00.000Z';
const OPERATION_DIGEST = 'a'.repeat(64);

function failure(category: FailureClass, overrides: Record<string, unknown> = {}) {
  const transient = category === 'transient';
  const unknown = category === 'unknown_side_effect';
  return {
    id: `failure:${category}`,
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    createdAt: NOW,
    workflowId: 'workflow:engineering-loop',
    featureId: 'EL-06',
    sessionId: 'session:60',
    operationId: 'operation:fixture',
    category,
    detail: `${category} failure`,
    transientCode: transient ? 'temporary_unavailable' : null,
    sideEffect: unknown ? 'unknown' : 'none_proven',
    idempotencyKey: null,
    identicalOperationDigest: null,
    ...overrides,
  };
}

function context(category: FailureClass, overrides: Record<string, unknown> = {}) {
  return {
    failure: failure(category),
    policy: {
      schemaVersion: RECOVERY_SCHEMA_VERSION,
      policyVersion: RECOVERY_POLICY_VERSION,
      maxAttempts: 3,
      delayMs: 250,
    },
    attempt: 1,
    implementationRetriesConsumed: 0,
    priorOperationDigest: null,
    priorIdempotencyKey: null,
    ...overrides,
  };
}

describe('EL-06 typed bounded recovery policy', () => {
  it.each([
    ['transient', 'retry'],
    ['environmental', 'block'],
    ['specification', 'block'],
    ['policy', 'block'],
    ['harness', 'fail'],
    ['unknown_side_effect', 'block'],
    ['implementation', 'recover'],
    ['cancelled', 'cancel'],
  ] as const)('classifies %s before choosing %s', (category, action) => {
    expect(decideRecovery(context(category)).action).toBe(action);
  });

  it('retries only typed transient no-effect failures with finite attempt and delay bounds', () => {
    const decision = decideRecovery(context('transient'));
    expect(decision).toMatchObject({
      category: 'transient', action: 'retry', nextAttempt: 2, delayMs: 250, exhausted: false,
      implementationRetryConsumed: false,
    });
    expect(() => decideRecovery({
      ...context('transient'),
      policy: { schemaVersion: 1, policyVersion: RECOVERY_POLICY_VERSION, maxAttempts: MAX_RETRY_ATTEMPTS + 1, delayMs: 1 },
    })).toThrow();
  });

  it('permits an effect-bearing retry only for an identical operation under the same idempotency key', () => {
    const proven = failure('transient', {
      sideEffect: 'occurred', idempotencyKey: 'idempotency:fixture', identicalOperationDigest: OPERATION_DIGEST,
    });
    expect(decideRecovery({
      ...context('transient'),
      failure: proven,
      priorOperationDigest: OPERATION_DIGEST,
      priorIdempotencyKey: 'idempotency:fixture',
    }).action).toBe('retry');
    expect(decideRecovery({
      ...context('transient'),
      failure: proven,
      priorOperationDigest: 'b'.repeat(64),
      priorIdempotencyKey: 'idempotency:fixture',
    }).action).toBe('block');
  });

  it('stops on exhaustion and never resets or silently continues the counter', () => {
    const decision = decideRecovery(context('transient', { attempt: 3 }));
    expect(decision).toMatchObject({ action: 'fail', nextAttempt: null, delayMs: 0, exhausted: true });
  });

  it.each(['environmental', 'specification', 'policy', 'harness', 'unknown_side_effect'] as const)(
    '%s does not consume implementation retry budget',
    category => expect(decideRecovery(context(category)).implementationRetryConsumed).toBe(false)
  );

  it('bounds implementation recovery separately and stops when its budget is exhausted', () => {
    expect(decideRecovery(context('implementation')).action).toBe('recover');
    expect(decideRecovery(context('implementation', { implementationRetriesConsumed: 2 }))).toMatchObject({
      action: 'fail', exhausted: true, implementationRetryConsumed: true,
    });
  });

  it('blocks unknown external outcomes, names reconciliation, never retries, and never infers success', () => {
    const decision = decideRecovery(context('unknown_side_effect'));
    expect(decision.action).toBe('block');
    expect(decision.reconciliationRequired).toContain('Reconcile operation operation:fixture');
    expect(decision.reason).toContain('automatic retry');
    expect(decision.reason).toContain('success');
  });

  it('appends a new signed human decision and evidence record without rewriting prior history', () => {
    const firstInput = {
      id: 'reconciliation:one', schemaVersion: 1 as const, createdAt: NOW,
      workflowId: 'workflow:engineering-loop', featureId: 'EL-06', sessionId: 'session:60',
      failureId: 'failure:unknown_side_effect', operationId: 'operation:fixture', issuer: 'owner:darian',
      decision: 'confirmed_failed' as const, evidenceReference: 'protected:evidence:one',
      evidenceDigest: 'c'.repeat(64), signatureReference: 'protected:signature:one',
    };
    const first = appendSignedReconciliation({ priorHistory: [], record: firstInput });
    const frozenPrior = structuredClone(first);
    const second = appendSignedReconciliation({
      priorHistory: first,
      record: { ...firstInput, id: 'reconciliation:two', createdAt: '2026-07-15T12:01:00.000Z', decision: 'cancelled' },
    });
    expect(first).toEqual(frozenPrior);
    expect(second.slice(0, 1)).toEqual(first);
    expect(second[1]?.priorHistoryDigest).not.toBe('0'.repeat(64));
    expect(second[1]?.recordDigest).toMatch(/^[0-9a-f]{64}$/);
  });
});
