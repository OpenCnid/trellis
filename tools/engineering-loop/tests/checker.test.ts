import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CHECKER_POLICY_VERSION,
  CHECKER_SCHEMA_VERSION,
  CheckerBoundaryError,
  compileFreshCheckerRequest,
  createCheckerStart,
  runFreshChecker,
  type FreshCheckerPort,
  type FreshCheckerRequest,
} from '../src/checker';
import { sha256Canonical } from '../src/events';
import { FakeClock, FakeRunner } from '../src/fakes';
import { PROMPT_SCHEMA_VERSION, ROLE_OUTPUT_CONTRACT_VERSIONS } from '../src/prompt_contracts';
import {
  AGENT_RUNNER_CONTRACT_VERSION,
  MAX_RUNNER_BUFFERED_EVENTS,
  RUNNER_SCHEMA_VERSION,
} from '../src/runners/runner';

const NOW = '2026-07-15T12:00:00.000Z';
const REQUIREMENTS = ['EL-REQ-EPISODE-004', 'EL-REQ-VERIFY-006', 'EL-REQ-SEC-002'];
const CONTEXT = {
  requirementIds: REQUIREMENTS,
  evidenceIds: ['evidence:controller-verification'],
  allowedPaths: ['tools/engineering-loop'],
  unresolvedEffectIds: [],
};

function checkerOutput(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: PROMPT_SCHEMA_VERSION,
    contractVersion: ROLE_OUTPUT_CONTRACT_VERSIONS.checker,
    role: 'checker',
    authority: 'advisory_only',
    summary: 'Fresh read-only assessment complete.',
    recommendation: 'ready_for_human_review',
    requirementAssessments: REQUIREMENTS.map(requirementId => ({
      requirementId,
      status: 'satisfied',
      summary: 'Controller references support this advisory assessment.',
      evidenceReferences: ['evidence:controller-verification'],
    })),
    findings: [{
      id: 'finding:human-review', severity: 'info', summary: 'Human review remains required.',
      evidenceReferences: ['evidence:controller-verification'],
    }],
    evidenceReferences: ['evidence:controller-verification'],
    ...overrides,
  };
}

function start() {
  const text = '<checker_task>Read controller evidence only.</checker_task>';
  return createCheckerStart({
    workflowId: 'workflow:engineering-loop',
    featureId: 'EL-06',
    sessionId: 'session:60',
    episodeId: 'episode:checker:fresh',
    requestId: 'request:checker:fresh',
    runnerId: 'runner:checker:isolated',
    prompt: {
      packetVersion: 'checker-packet:v1',
      digest: createHash('sha256').update(text).digest('hex'),
      byteCount: Buffer.byteLength(text),
      text,
    },
    workingDirectory: 'C:/trellis',
    timeBudgetMs: 60_000,
    turnBudget: 2,
    contextBudgetTokens: 8_000,
  });
}

function request(forbiddenThreadIds: readonly string[] = []) {
  return compileFreshCheckerRequest({
    createdAt: NOW,
    start: start(),
    readableRoots: ['C:/trellis'],
    forbiddenImplementerEpisodeIds: ['episode:implementer'],
    forbiddenImplementerThreadIds: forbiddenThreadIds.length > 0 ? forbiddenThreadIds : ['thread:implementer'],
    forbiddenImplementerRunnerIds: ['runner:implementer'],
    validationContext: CONTEXT,
  });
}

class FakeCheckerPort implements FreshCheckerPort {
  readonly isolation = 'fresh_read_only_checker' as const;
  readonly runner: FakeRunner;
  starts = 0;
  observedRequest: FreshCheckerRequest | null = null;
  constructor(readonly output: unknown = checkerOutput()) {
    this.runner = new FakeRunner(new FakeClock(NOW), [{ status: 'completed', summary: 'checker completed' }], {
      runnerId: 'runner:checker:isolated',
    });
  }
  async start(checkerRequest: FreshCheckerRequest): Promise<unknown> {
    this.starts++;
    this.observedRequest = structuredClone(checkerRequest);
    const launch = await this.runner.start(checkerRequest.start);
    const observation = await this.runner.observe({
      schemaVersion: RUNNER_SCHEMA_VERSION,
      contractVersion: AGENT_RUNNER_CONTRACT_VERSION,
      correlation: launch.correlation,
      afterSequence: 0,
      maxEvents: MAX_RUNNER_BUFFERED_EVENTS,
      durationMs: 0,
    });
    return { launch, observation, outputJson: JSON.stringify(this.output) };
  }
}

describe('EL-06 fresh least-privilege read-only checker', () => {
  it('compiles validated state into a start-only fresh episode with no writable, credential, network, effect, or reused-memory capability', () => {
    const compiled = request();
    expect(compiled.schemaVersion).toBe(CHECKER_SCHEMA_VERSION);
    expect(compiled.policyVersion).toBe(CHECKER_POLICY_VERSION);
    expect(compiled.start.role).toBe('checker');
    expect(compiled).not.toHaveProperty('threadId');
    expect(compiled.capabilities).toMatchObject({
      filesystem: 'read_only', writableRoots: [], credentialReferences: [], network: 'none', externalEffects: [],
      controllerEvidenceWrite: false, approvalReadOrConsume: false, stateTransition: false,
      acceptanceDecision: false, worktreeEdit: false,
    });
    expect(Object.values(compiled.freshness).filter(value => value === true)).toHaveLength(3);
    expect(compiled.requestDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('starts one fresh checker thread and strictly validates correlation, lifecycle ordering, bounds, identifiers, and advisory output', async () => {
    const port = new FakeCheckerPort();
    const report = await runFreshChecker({ request: request(), port, reportId: 'report:checker', createdAt: NOW });
    expect(port.starts).toBe(1);
    expect(port.runner.starts).toBe(1);
    expect(port.runner.resumes).toBe(0);
    expect(report.authority).toBe('advisory_only');
    expect(report.recommendation).toBe('ready_for_human_review');
    expect(report.threadId).not.toBe('thread:implementer');
    expect(report).toMatchObject({
      canEdit: false, canCreateControllerEvidence: false, canConsumeApproval: false,
      canInvokeEffect: false, canAccept: false, canTransition: false,
    });
  });

  it('lets a checker recommendation block for human review but never upgrades controller evidence or acceptance', async () => {
    const port = new FakeCheckerPort(checkerOutput({ recommendation: 'blocked' }));
    const report = await runFreshChecker({ request: request(), port, reportId: 'report:blocked', createdAt: NOW });
    expect(report.recommendation).toBe('blocked');
    expect(report.canAccept).toBe(false);
    expect(report.canTransition).toBe(false);
    expect(JSON.stringify(report)).not.toContain('controller_observed');
  });

  it('refuses reuse of the implementer thread even when the runner otherwise reports success', async () => {
    const checkerStart = start();
    const predictedThread = `thread:${sha256Canonical({ episodeId: checkerStart.episodeId, runnerId: checkerStart.runnerId }).slice(0, 32)}`;
    const port = new FakeCheckerPort();
    await expect(runFreshChecker({
      request: request([predictedThread]), port, reportId: 'report:reused', createdAt: NOW,
    })).rejects.toBeInstanceOf(CheckerBoundaryError);
  });

  it('refuses truncated start history even when a terminal report and advisory output are otherwise valid', async () => {
    const underlying = new FakeCheckerPort();
    const truncated: FreshCheckerPort = {
      isolation: 'fresh_read_only_checker',
      async start(checkerRequest) {
        const result = await underlying.start(checkerRequest) as {
          launch: unknown;
          observation: { observations: unknown[] };
          outputJson: string;
        };
        result.observation.observations = result.observation.observations.slice(1);
        return result;
      },
    };
    await expect(runFreshChecker({
      request: request(), port: truncated, reportId: 'report:truncated', createdAt: NOW,
    })).rejects.toThrow(/lifecycle/);
  });

  it.each([
    ['unknown requirement', checkerOutput({ requirementAssessments: [{
      requirementId: 'EL-REQ-SEC-999', status: 'satisfied', summary: 'Forged.', evidenceReferences: [],
    }] })],
    ['authority field', { ...checkerOutput(), transition: 'accepted' }],
    ['secret', checkerOutput({ summary: 'Bearer abc.defghij' })],
  ])('refuses untrusted checker content with %s before persistence', async (_label, output) => {
    const port = new FakeCheckerPort(output);
    await expect(runFreshChecker({ request: request(), port, reportId: 'report:invalid', createdAt: NOW })).rejects.toThrow();
  });

  it('refuses request digest tampering and ports without fresh read-only isolation before launch', async () => {
    const compiled = request();
    const port = new FakeCheckerPort();
    await expect(runFreshChecker({
      request: { ...compiled, createdAt: '2026-07-15T12:01:00.000Z' }, port, reportId: 'report:tampered', createdAt: NOW,
    })).rejects.toThrow(/digest/);
    const badPort = { ...port, isolation: 'shared_writable' } as unknown as FreshCheckerPort;
    await expect(runFreshChecker({ request: compiled, port: badPort, reportId: 'report:bad-port', createdAt: NOW })).rejects.toThrow(/isolation/);
  });
});
