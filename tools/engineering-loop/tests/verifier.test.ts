import { describe, expect, it } from 'vitest';
import {
  VERIFIER_SCHEMA_VERSION,
  VERIFIER_POLICY_VERSION,
  assertImmutableAcceptanceDefinition,
  createImmutableAcceptanceDefinition,
  evaluateVerificationGate,
  verifyAcceptance,
  type AcceptanceCommand,
  type ControllerCommandObservation,
  type DeterministicCommandPort,
  type ImmutableAcceptanceDefinition,
} from '../src/verifier';
import { assertEL06VerificationGate } from '../src/kernel';

const NOW = '2026-07-15T12:00:00.000Z';
const DIGEST = 'a'.repeat(64);
const REPOSITORY = {
  repositoryId: 'repo:trellis',
  worktreeId: 'worktree:el06',
  branch: 'implement-el06-verification-gates',
  baseCommit: '27bb7abbf9399c064bc578a2f12328eacb52c1a2',
  headCommit: '27bb7abbf9399c064bc578a2f12328eacb52c1a2',
  clean: true,
} as const;

const COMMANDS: readonly AcceptanceCommand[] = [
  {
    id: 'command:focused',
    argv: ['npx', 'vitest', 'run', 'tools/engineering-loop/tests/verifier.test.ts'],
    cwd: 'C:/trellis',
    environment: [{ name: 'CI', value: '1' }],
    timeoutMs: 120_000,
    expectedExitCode: 0,
    expectedCounts: [{ name: 'tests', value: 12 }],
  },
  {
    id: 'command:full',
    argv: ['npm', 'test'],
    cwd: 'C:/trellis',
    environment: [{ name: 'CI', value: '1' }],
    timeoutMs: 300_000,
    expectedExitCode: 0,
    expectedCounts: [{ name: 'test_files', value: 105 }, { name: 'tests', value: 1_150 }],
  },
];

function definition(): ImmutableAcceptanceDefinition {
  return createImmutableAcceptanceDefinition({
    id: 'acceptance:el06',
    schemaVersion: VERIFIER_SCHEMA_VERSION,
    verifierPolicyVersion: VERIFIER_POLICY_VERSION,
    createdAt: NOW,
    workflowId: 'workflow:engineering-loop',
    featureId: 'EL-06',
    sessionId: 'session:60',
    sourceDefinitionDigest: DIGEST,
    repositoryPrecondition: REPOSITORY,
    dependencies: ['EL-03', 'EL-04', 'EL-05'],
    scope: ['tools/engineering-loop'],
    requirementIds: ['EL-REQ-VERIFY-001', 'EL-REQ-VERIFY-002'],
    commands: [...COMMANDS],
    protectedPreconditions: ['precondition:retention'],
    retention: {
      id: 'retention:el06',
      schemaVersion: 1,
      createdAt: NOW,
      workflowId: 'workflow:engineering-loop',
      mode: 'delete_on_completion',
      expiresAt: null,
      maxArtifactBytes: 8_388_608,
      deleteRawTranscripts: true,
    },
  });
}

function observation(command: AcceptanceCommand, changes: Partial<ControllerCommandObservation> = {}): ControllerCommandObservation {
  return {
    id: `observation:${command.id}`,
    schemaVersion: VERIFIER_SCHEMA_VERSION,
    origin: 'controller_observed',
    workflowId: 'workflow:engineering-loop',
    featureId: 'EL-06',
    sessionId: 'session:60',
    commandId: command.id,
    argv: [...command.argv],
    cwd: command.cwd,
    environment: [...command.environment],
    timeoutMs: command.timeoutMs,
    repositoryBefore: REPOSITORY,
    repositoryAfter: REPOSITORY,
    startedAt: NOW,
    endedAt: '2026-07-15T12:00:01.000Z',
    exitCode: 0,
    signal: null,
    timedOut: false,
    cancelled: false,
    stdout: { byteCount: 5, digest: 'b'.repeat(64), retainedReference: 'artifact:stdout' },
    stderr: { byteCount: 0, digest: 'c'.repeat(64), retainedReference: null },
    engineCounts: [...command.expectedCounts],
    ...changes,
  };
}

class ScriptedCommandPort implements DeterministicCommandPort {
  calls: AcceptanceCommand[] = [];
  constructor(readonly script: (command: AcceptanceCommand, index: number) => unknown) {}
  async execute(command: AcceptanceCommand): Promise<unknown> {
    this.calls.push(structuredClone(command));
    return this.script(command, this.calls.length - 1);
  }
}

async function passingVerification() {
  const port = new ScriptedCommandPort(command => observation(command));
  const report = await verifyAcceptance({
    definition: definition(),
    commandPort: port,
    createdAt: NOW,
    verificationId: 'verification:el06',
  });
  return { report, port };
}

describe('EL-06 deterministic controller verification', () => {
  it('executes every immutable argv separately and binds cwd, environment, timeout, repository, retained digest, exit, and engine counts', async () => {
    const { report, port } = await passingVerification();
    expect(port.calls).toEqual(COMMANDS);
    expect(port.calls).not.toBe(COMMANDS);
    expect(report.status).toBe('passed');
    expect(report.origin).toBe('controller_observed');
    expect(report.requiredCommandCount).toBe(2);
    expect(report.observedCommandCount).toBe(2);
    expect(report.passedCommandCount).toBe(2);
    expect(report.findings).toEqual([]);
    expect(report.reportDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('pins the active acceptance bytes and refuses an in-session acceptance change', () => {
    const active = definition();
    expect(assertImmutableAcceptanceDefinition(active)).toEqual(active);
    expect(() => assertImmutableAcceptanceDefinition({
      ...active,
      commands: [{ ...active.commands[0], timeoutMs: 1 }, ...active.commands.slice(1)],
    })).toThrow(/digest changed/);
  });

  it('reports a stale immutable definition as a stopping controller finding without launching commands', async () => {
    const active = definition();
    const changed = {
      ...active,
      commands: [{ ...active.commands[0], timeoutMs: 1 }, ...active.commands.slice(1)],
    };
    const port = new ScriptedCommandPort(command => observation(command));
    const report = await verifyAcceptance({
      definition: changed, commandPort: port, createdAt: NOW, verificationId: 'verification:stale',
    });
    expect(port.calls).toEqual([]);
    expect(report.status).toBe('failed');
    expect(report.findings).toEqual([expect.objectContaining({ code: 'stale_definition' })]);
  });

  it('enforces strict byte, count, command, environment, and unknown-field bounds deterministically', () => {
    const active = definition();
    const { definitionDigest: _digest, ...material } = active;
    expect(() => createImmutableAcceptanceDefinition({
      ...material,
      commands: Array.from({ length: 33 }, (_, index) => ({ ...active.commands[0]!, id: `command:${index}` })),
    })).toThrow();
    expect(() => createImmutableAcceptanceDefinition({
      ...material,
      commands: [{
        ...active.commands[0]!,
        environment: [{ name: 'OPENAI_API_KEY', value: 'forbidden-secret' }],
      }],
    })).toThrow(/secret-bearing/);
    expect(() => assertImmutableAcceptanceDefinition({ ...active, modelClaimedPassed: true })).toThrow();
  });

  it.each([
    ['argv', (command: AcceptanceCommand) => ({ argv: [...command.argv, '--forged'] })],
    ['cwd', () => ({ cwd: 'C:/other' })],
    ['environment', () => ({ environment: [] })],
    ['timeout', () => ({ timeoutMs: 1 })],
    ['repository', () => ({ repositoryAfter: { ...REPOSITORY, clean: false } })],
    ['exit', () => ({ exitCode: 1 })],
    ['timeout-status', () => ({ timedOut: true })],
    ['cancellation', () => ({ cancelled: true })],
    ['counts', () => ({ engineCounts: [{ name: 'tests', value: 11 }] })],
    ['retained output', () => ({ stdout: { byteCount: 5, digest: 'b'.repeat(64), retainedReference: null } })],
  ] as const)('stops on %s mismatch', async (_label, mutate) => {
    const port = new ScriptedCommandPort(command => observation(command, mutate(command) as Partial<ControllerCommandObservation>));
    const report = await verifyAcceptance({
      definition: definition(), commandPort: port, createdAt: NOW, verificationId: 'verification:mismatch',
    });
    expect(report.status).toBe('failed');
    expect(report.findings.every(item => item.disposition === 'stops_advancement')).toBe(true);
  });

  it('turns missing or structurally unverifiable controller results into bounded stopping findings', async () => {
    const port = new ScriptedCommandPort((_command, index) => index === 0 ? { claimedPassed: true } : Promise.reject(new Error('lost')));
    const report = await verifyAcceptance({
      definition: definition(), commandPort: port, createdAt: NOW, verificationId: 'verification:missing',
    });
    expect(report.status).toBe('failed');
    expect(report.observedCommandCount).toBe(0);
    expect(report.findings.map(item => item.code)).toEqual(['missing_controller_evidence', 'missing_controller_evidence']);
  });

  it('applies exhaustive evidence precedence: runner, checker, model, conversation, and prose cannot fabricate a pass', async () => {
    const origins = ['runner_reported', 'checker_reported', 'model_reported', 'conversation_reported', 'repository_prose'] as const;
    const port = new ScriptedCommandPort(command => observation(command, { exitCode: 1 }));
    const report = await verifyAcceptance({
      definition: definition(),
      commandPort: port,
      advisoryClaims: origins.map((origin, index) => ({
        id: `claim:${index}`,
        origin,
        commandId: COMMANDS[0]!.id,
        claimedPassed: true,
        summary: 'Advisory pass claim.',
      })),
      createdAt: NOW,
      verificationId: 'verification:precedence',
    });
    expect(report.status).toBe('failed');
    expect(report.findings.filter(item => item.code === 'contradictory_advisory_claim')).toHaveLength(5);
  });

  it('permits awaiting_review only after every deterministic gate, then accepted only after protected human review', async () => {
    const active = definition();
    const { report } = await passingVerification();
    const common = {
      definition: active,
      verification: report,
      currentRepository: REPOSITORY,
      satisfiedDependencies: ['EL-03', 'EL-04', 'EL-05'],
      changedPathsInScope: true,
      satisfiedProtectedPreconditions: ['precondition:retention'],
      requiredApprovalIds: [],
      consumedApprovalIds: [],
      unresolvedUnknownEffectIds: [],
    };
    expect(evaluateVerificationGate(common).state).toBe('awaiting_review');
    expect(assertEL06VerificationGate('EL-06', 'awaiting_review', evaluateVerificationGate(common))?.state).toBe('awaiting_review');
    expect(() => assertEL06VerificationGate('EL-06', 'awaiting_review', undefined)).toThrow(/requires deterministic verifier gate/);
    const review = {
      id: 'review:el06',
      schemaVersion: 1,
      createdAt: NOW,
      channel: 'protected_external',
      issuer: 'owner:darian',
      workflowId: active.workflowId,
      featureId: active.featureId,
      sessionId: active.sessionId,
      verificationDigest: report.reportDigest,
      decision: 'accepted',
      signatureReference: 'protected-review:el06',
    };
    expect(evaluateVerificationGate({ ...common, humanReview: review }).state).toBe('accepted');
    expect(assertEL06VerificationGate(
      'EL-06', 'accepted', evaluateVerificationGate({ ...common, humanReview: review })
    )?.state).toBe('accepted');
    expect(evaluateVerificationGate({ ...common, changedPathsInScope: false, humanReview: review }).state).toBe('verifying');
    expect(evaluateVerificationGate({ ...common, unresolvedUnknownEffectIds: ['operation:unknown'], humanReview: review }).state).toBe('blocked');
  });
});
