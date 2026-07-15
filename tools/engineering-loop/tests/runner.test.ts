import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EvidenceSchema } from '../src/domain.js';
import { FakeClock, FakeRunner } from '../src/fakes.js';
import {
  AGENT_RUNNER_CONTRACT_VERSION,
  MAX_RUNNER_BUFFERED_EVENTS,
  RUNNER_SCHEMA_VERSION,
  RunnerObservationBuffer,
  RunnerObserveResultSchema,
  RunnerStartRequestSchema,
  createRunnerRedactor,
  type RunnerAdapterIdentity,
  type RunnerLaunchResult,
} from '../src/runners/runner.js';

const IDENTITY: RunnerAdapterIdentity = {
  adapter: 'fixture-runner',
  adapterVersion: 'fixture-runner:v1',
  protocolVersion: 'fixture-protocol:v1',
  executableVersion: 'none',
};

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function startRequest(overrides: Record<string, unknown> = {}) {
  const text = 'bounded compiled prompt';
  return {
    schemaVersion: RUNNER_SCHEMA_VERSION,
    contractVersion: AGENT_RUNNER_CONTRACT_VERSION,
    workflowId: 'workflow:fixture',
    featureId: 'EL-05',
    sessionId: 'session:fixture',
    episodeId: 'episode:fixture',
    requestId: 'request:fixture',
    runnerId: 'runner:fake',
    role: 'implementer',
    prompt: {
      packetVersion: 'engineering-loop-prompt-packet:v1',
      digest: digest(text),
      byteCount: Buffer.byteLength(text, 'utf8'),
      text,
    },
    workingDirectory: 'C:/fixture',
    timeBudgetMs: 60_000,
    turnBudget: 4,
    contextBudgetTokens: 8_000,
    ...overrides,
  };
}

function observeRequest(launch: RunnerLaunchResult, afterSequence = 0) {
  return {
    schemaVersion: RUNNER_SCHEMA_VERSION,
    contractVersion: AGENT_RUNNER_CONTRACT_VERSION,
    correlation: launch.correlation,
    afterSequence,
    maxEvents: MAX_RUNNER_BUFFERED_EVENTS,
    durationMs: 0,
  };
}

describe('adapter-neutral AgentRunner contract', () => {
  it('strictly validates version, prompt bytes, explicit bounds, and unknown fields', () => {
    expect(RunnerStartRequestSchema.parse(startRequest()).contractVersion).toBe(AGENT_RUNNER_CONTRACT_VERSION);
    expect(RunnerStartRequestSchema.safeParse({ ...startRequest(), unknown: true }).success).toBe(false);
    expect(RunnerStartRequestSchema.safeParse({
      ...startRequest(),
      prompt: { ...(startRequest().prompt as object), byteCount: 1 },
    }).success).toBe(false);
    expect(RunnerStartRequestSchema.safeParse({
      ...startRequest(),
      prompt: { ...(startRequest().prompt as object), digest: '0'.repeat(64) },
    }).success).toBe(false);
    expect(RunnerStartRequestSchema.safeParse({ ...startRequest(), turnBudget: 1_001 }).success).toBe(false);
  });

  it('uses FakeRunner as the full zero-effect lifecycle conformance oracle', async () => {
    const clock = new FakeClock();
    const runner = new FakeRunner(clock);
    const launch = await runner.start(startRequest());
    const observed = await runner.observe(observeRequest(launch));

    expect(launch.status).toBe('started');
    expect(launch.correlation).toMatchObject({
      workflowId: 'workflow:fixture',
      featureId: 'EL-05',
      sessionId: 'session:fixture',
      episodeId: 'episode:fixture',
      requestId: 'request:fixture',
      runnerId: 'runner:fake',
    });
    expect(launch.correlation.threadId).toMatch(/^thread:/);
    expect(launch.correlation.turnId).toMatch(/^turn:/);
    expect(observed.observations.map(item => item.eventType)).toEqual([
      'episode.started',
      'turn.started',
      'episode.completed',
    ]);
    expect(observed.observations.map(item => item.sequence)).toEqual([1, 2, 3]);
    expect(observed.observations.filter(item => item.terminal)).toHaveLength(1);
    expect(observed.report).toMatchObject({ terminalStatus: 'completed', eventCount: 3 });
    expect(runner.modelCalls).toBe(0);
    expect(runner.paidCalls).toBe(0);
    expect(runner.processSpawns).toBe(0);
    expect(runner.networkCalls).toBe(0);
  });

  it('supports resume, bounded observation, interrupt, and dispose through the same contract', async () => {
    const clock = new FakeClock();
    const runner = new FakeRunner(clock, [{ status: 'running', summary: 'await interrupt' }]);
    const request = {
      ...startRequest({ requestId: 'request:resume' }),
      threadId: 'thread:existing',
    };
    const launch = await runner.resume(request);
    expect((await runner.observe(observeRequest(launch))).terminal).toBe(false);
    const interrupted = await runner.interrupt({
      schemaVersion: RUNNER_SCHEMA_VERSION,
      contractVersion: AGENT_RUNNER_CONTRACT_VERSION,
      correlation: launch.correlation,
      reason: 'operator',
    });
    expect(interrupted.status).toBe('acknowledged');
    expect(interrupted.correlation).toEqual(launch.correlation);
    const observed = await runner.observe(observeRequest(launch));
    expect(observed.report?.terminalStatus).toBe('interrupted');
    expect(observed.observations.filter(item => item.terminal)).toHaveLength(1);
    expect((await runner.dispose({
      schemaVersion: RUNNER_SCHEMA_VERSION,
      contractVersion: AGENT_RUNNER_CONTRACT_VERSION,
      requestId: 'request:dispose',
      runnerId: 'runner:fake',
    })).status).toBe('disposed');
    expect(runner.resumes).toBe(1);
    expect(runner.interruptions).toBe(1);
    expect(runner.disposals).toBe(1);
  });

  it('refuses forged action correlations and cross-correlated observation results', async () => {
    const running = new FakeRunner(new FakeClock(), [{ status: 'running', summary: 'await interrupt' }]);
    const launch = await running.start(startRequest());
    await expect(running.interrupt({
      schemaVersion: RUNNER_SCHEMA_VERSION,
      contractVersion: AGENT_RUNNER_CONTRACT_VERSION,
      correlation: { ...launch.correlation, turnId: 'turn:forged' },
      reason: 'operator',
    })).rejects.toThrow(/correlation/);
    expect((await running.observe(observeRequest(launch))).terminal).toBe(false);

    const completed = new FakeRunner(new FakeClock());
    const completedLaunch = await completed.start(startRequest());
    const observed = await completed.observe(observeRequest(completedLaunch));
    const forged = structuredClone(observed);
    forged.observations[0]!.featureId = 'EL-forged';
    expect(RunnerObserveResultSchema.safeParse(forged).success).toBe(false);
  });

  it.each([
    ['timed_out', 'episode.timed_out'],
    ['stalled', 'episode.stalled'],
    ['cancelled', 'episode.cancelled'],
    ['adapter_disconnected', 'adapter.disconnected'],
    ['process_exited', 'process.exited'],
    ['protocol_refused', 'protocol.refused'],
    ['failed_before_first_turn', 'episode.failed_before_first_turn'],
    ['failed', 'episode.failed'],
  ] as const)('pins the typed %s terminal outcome', async (status, eventType) => {
    const runner = new FakeRunner(new FakeClock(), [{ status, summary: `fixture ${status}` }]);
    const launch = await runner.start(startRequest());
    const observed = await runner.observe(observeRequest(launch));
    expect(observed.observations.at(-1)).toMatchObject({ eventType, terminal: true });
    expect(observed.report?.terminalStatus).toBe(status);
  });

  it('redacts before observations or reports can be returned and never exposes the prompt', async () => {
    const secret = 'owner-secret-value';
    const runner = new FakeRunner(
      new FakeClock(),
      [{ status: 'failed', summary: `failure ${secret} Bearer raw-token` }],
      { sensitiveValues: [secret] }
    );
    const launch = await runner.start(startRequest({
      prompt: {
        packetVersion: 'engineering-loop-prompt-packet:v1',
        digest: digest(secret),
        byteCount: Buffer.byteLength(secret, 'utf8'),
        text: secret,
      },
    }));
    const observed = await runner.observe(observeRequest(launch));
    const encoded = JSON.stringify(observed);
    expect(encoded).not.toContain(secret);
    expect(encoded).not.toContain('raw-token');
    expect(encoded).toContain('[REDACTED]');
    expect(observed.report?.redactionCount).toBe(2);
    expect(EvidenceSchema.safeParse(observed.report).success).toBe(false);
  });

  it('reserves terminal capacity and deterministically refuses buffer overflow', () => {
    const buffer = new RunnerObservationBuffer({
      adapter: IDENTITY,
      clock: new FakeClock(),
      maxEvents: 4,
      redact: createRunnerRedactor(),
    });
    buffer.begin({
      workflowId: 'workflow:fixture',
      featureId: 'EL-05',
      sessionId: 'session:fixture',
      episodeId: 'episode:fixture',
      requestId: 'request:fixture',
      runnerId: 'runner:fixture',
      threadId: 'thread:fixture',
      turnId: 'turn:fixture',
    });
    buffer.append('episode.started');
    buffer.append('turn.started');
    buffer.append('turn.started');
    buffer.append('turn.started');
    const observed = buffer.read({
      schemaVersion: RUNNER_SCHEMA_VERSION,
      contractVersion: AGENT_RUNNER_CONTRACT_VERSION,
      correlation: buffer.correlation,
      afterSequence: 0,
      maxEvents: 4,
      durationMs: 0,
    });
    expect(observed.observations).toHaveLength(4);
    expect(observed.observations.at(-1)?.eventType).toBe('protocol.refused');
    expect(observed.observations.filter(item => item.terminal)).toHaveLength(1);
    expect(observed.report?.terminalSequence).toBe(4);
  });

  it('truncates metadata by engine-computed UTF-8 bytes without splitting a code point', () => {
    const buffer = new RunnerObservationBuffer({
      adapter: IDENTITY,
      clock: new FakeClock(),
    });
    buffer.begin({
      workflowId: 'workflow:fixture',
      featureId: 'EL-05',
      sessionId: 'session:fixture',
      episodeId: 'episode:utf8',
      requestId: 'request:utf8',
      runnerId: 'runner:fixture',
      threadId: null,
      turnId: null,
    });
    const observation = buffer.append('episode.failed_before_first_turn', {
      detail: '😀'.repeat(400),
    });
    expect(Buffer.byteLength(observation.metadata.detail, 'utf8')).toBeLessThanOrEqual(1_024);
    expect(observation.metadata.detail).not.toContain('\uFFFD');
    expect(Buffer.byteLength(buffer.report!.summary, 'utf8')).toBeLessThanOrEqual(1_024);
  });
});
