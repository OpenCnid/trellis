import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../src/fakes.js';
import {
  CodexAppServerRunner,
  SUPPORTED_CODEX_APP_SERVER,
  type CodexAppServerProcessTransport,
  type CodexAppServerTransportHandlers,
} from '../src/runners/codex_app_server_runner.js';
import {
  AGENT_RUNNER_CONTRACT_VERSION,
  MAX_RUNNER_BUFFERED_EVENTS,
  RUNNER_SCHEMA_VERSION,
  type RunnerCancellation,
  type RunnerLaunchResult,
  type RunnerTimerScheduler,
} from '../src/runners/runner.js';

type OutgoingMessage = Record<string, unknown>;

class FakeTimers implements RunnerTimerScheduler {
  #sequence = 0;
  readonly scheduled = new Map<number, { delayMs: number; callback: () => void }>();

  schedule(delayMs: number, callback: () => void): unknown {
    const id = ++this.#sequence;
    this.scheduled.set(id, { delayMs, callback });
    return id;
  }

  cancel(handle: unknown): void {
    this.scheduled.delete(handle as number);
  }

  fireDelay(delayMs: number): number {
    const matches = [...this.scheduled.entries()].filter(([, value]) => value.delayMs === delayMs);
    for (const [id, value] of matches) {
      this.scheduled.delete(id);
      value.callback();
    }
    return matches.length;
  }
}

class FakeCancellation implements RunnerCancellation {
  #cancelled = false;
  readonly listeners = new Set<() => void>();

  isCancelled(): boolean {
    return this.#cancelled;
  }

  subscribe(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  cancel(): void {
    this.#cancelled = true;
    for (const listener of [...this.listeners]) listener();
  }
}

class FakeTransport implements CodexAppServerProcessTransport {
  readonly executableVersion: string;
  handlers: CodexAppServerTransportHandlers | null = null;
  writes: OutgoingMessage[] = [];
  rawWrites: string[] = [];
  starts = 0;
  disposals = 0;
  disposeGraceMs: number | null = null;
  productionProcessSpawns = 0;
  networkCalls = 0;
  modelCalls = 0;
  onWrite: (message: OutgoingMessage, transport: FakeTransport) => void = () => undefined;

  constructor(executableVersion = SUPPORTED_CODEX_APP_SERVER.executableVersion) {
    this.executableVersion = executableVersion;
  }

  async start(handlers: CodexAppServerTransportHandlers): Promise<void> {
    this.starts++;
    this.handlers = handlers;
  }

  async write(data: Uint8Array): Promise<void> {
    const raw = Buffer.from(data).toString('utf8');
    this.rawWrites.push(raw);
    const message = JSON.parse(raw) as OutgoingMessage;
    this.writes.push(message);
    this.onWrite(message, this);
  }

  async dispose(graceMs: number): Promise<void> {
    this.disposals++;
    this.disposeGraceMs = graceMs;
  }

  emit(message: unknown): void {
    this.emitRaw(`${JSON.stringify(message)}\n`);
  }

  emitRaw(raw: string): void {
    this.handlers?.onStdout(Buffer.from(raw, 'utf8'));
  }

  emitBytes(bytes: Uint8Array): void {
    this.handlers?.onStdout(bytes);
  }

  disconnect(detail = 'fixture disconnect'): void {
    this.handlers?.onDisconnect(detail);
  }

  exit(exitCode: number | null = 1, signal: string | null = null): void {
    this.handlers?.onExit(exitCode, signal);
  }
}

function sha256(value: string): string {
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
    runnerId: 'runner:codex',
    role: 'implementer',
    prompt: {
      packetVersion: 'engineering-loop-prompt-packet:v1',
      digest: sha256(text),
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

function observeRequest(launch: RunnerLaunchResult, afterSequence = 0, durationMs = 0) {
  return {
    schemaVersion: RUNNER_SCHEMA_VERSION,
    contractVersion: AGENT_RUNNER_CONTRACT_VERSION,
    correlation: launch.correlation,
    afterSequence,
    maxEvents: MAX_RUNNER_BUFFERED_EVENTS,
    durationMs,
  };
}

function initializeResponse() {
  return {
    userAgent: 'codex_cli_rs/0.144.2',
    codexHome: 'C:/fixture/codex-home',
    platformFamily: 'windows',
    platformOs: 'windows',
  };
}

function thread(id = 'thread:codex') {
  return { id, cliVersion: '0.144.2' };
}

function turn(id = 'turn:codex', status: 'inProgress' | 'completed' | 'interrupted' | 'failed' = 'inProgress') {
  return { id, status, error: null };
}

function installCanonicalProtocol(transport: FakeTransport, options: { resume?: boolean } = {}): void {
  transport.onWrite = message => {
    const method = message.method;
    const id = message.id;
    if (method === 'initialize') {
      transport.emit({ id, result: initializeResponse() });
    } else if (method === 'thread/start') {
      transport.emit({ method: 'thread/started', params: { thread: thread() } });
      transport.emit({ id, result: { thread: thread() } });
    } else if (method === 'thread/resume') {
      transport.emit({ id, result: { thread: thread('thread:existing') } });
    } else if (method === 'turn/start') {
      const threadId = options.resume ? 'thread:existing' : 'thread:codex';
      transport.emit({ method: 'turn/started', params: { threadId, turn: turn() } });
      transport.emit({ id, result: { turn: turn() } });
    } else if (method === 'turn/interrupt') {
      transport.emit({ id, result: {} });
    }
  };
}

function fixture(options: {
  transport?: FakeTransport;
  cancellation?: FakeCancellation;
  sensitiveValues?: readonly string[];
  limits?: Record<string, number>;
} = {}) {
  const transport = options.transport ?? new FakeTransport();
  const timers = new FakeTimers();
  const cancellation = options.cancellation ?? new FakeCancellation();
  const runner = new CodexAppServerRunner({
    runnerId: 'runner:codex',
    transport,
    clock: new FakeClock(),
    timers,
    cancellation,
    sensitiveValues: options.sensitiveValues,
    limits: {
      requestTimeoutMs: 1_000,
      stallTimeoutMs: 5_000,
      interruptionGraceMs: 100,
      shutdownMs: 100,
      observationDurationMs: 500,
      ...options.limits,
    },
  });
  return { runner, transport, timers, cancellation };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('pinned Codex app-server adapter boundary', () => {
  it('negotiates and reports the exact stable protocol before any thread or turn request', async () => {
    const { runner, transport } = fixture();
    installCanonicalProtocol(transport);
    const negotiated = await runner.negotiate();
    expect(negotiated).toMatchObject({
      status: 'ready',
      supported: {
        adapterVersion: 'trellis-codex-app-server-runner:v1',
        protocolVersion: 'codex-app-server-jsonl:v2@0.144.2',
        executableVersion: 'codex-cli 0.144.2',
      },
      stableSchemaSha256: '4d236168d44edcfb8df0244c90bd58b4fb8f85e443e29144d70bc564403ea8af',
    });
    expect(transport.writes.map(message => message.method)).toEqual(['initialize', 'initialized']);
    expect(transport.writes.some(message => String(message.method).startsWith('thread/'))).toBe(false);
    expect(transport.writes.some(message => String(message.method).startsWith('turn/'))).toBe(false);
    await runner.dispose({
      schemaVersion: RUNNER_SCHEMA_VERSION,
      contractVersion: AGENT_RUNNER_CONTRACT_VERSION,
      requestId: 'request:dispose',
      runnerId: 'runner:codex',
    });
    expect(transport.disposals).toBe(1);
    expect(transport.disposeGraceMs).toBe(100);
    expect(runner.limits.pendingRequests).toBe(1);
  });

  it('refuses an incompatible executable before transport start, episode thread, or model turn', async () => {
    const transport = new FakeTransport('codex-cli 0.145.0');
    const { runner } = fixture({ transport });
    const launch = await runner.start(startRequest());
    const observed = await runner.observe(observeRequest(launch));
    expect(launch.status).toBe('refused');
    expect(observed.report?.terminalStatus).toBe('protocol_refused');
    expect(observed.observations).toHaveLength(1);
    expect(transport.starts).toBe(0);
    expect(transport.writes).toHaveLength(0);
  });

  it('translates canonical start and completion messages into correlated ordered observations', async () => {
    const { runner, transport } = fixture();
    installCanonicalProtocol(transport);
    const launch = await runner.start(startRequest());
    expect(launch).toMatchObject({
      status: 'started',
      correlation: {
        workflowId: 'workflow:fixture',
        featureId: 'EL-05',
        sessionId: 'session:fixture',
        episodeId: 'episode:fixture',
        requestId: 'request:fixture',
        runnerId: 'runner:codex',
        threadId: 'thread:codex',
        turnId: 'turn:codex',
      },
    });
    expect(transport.writes.map(message => message.method)).toEqual([
      'initialize',
      'initialized',
      'thread/start',
      'turn/start',
    ]);
    transport.emit({
      method: 'turn/completed',
      params: { threadId: 'thread:codex', turn: turn('turn:codex', 'completed') },
    });
    const observed = await runner.observe(observeRequest(launch));
    expect(observed.observations.map(item => item.eventType)).toEqual([
      'episode.started',
      'turn.started',
      'episode.completed',
    ]);
    expect(observed.observations.map(item => item.sequence)).toEqual([1, 2, 3]);
    expect(observed.observations.every(item => item.requestId === 'request:fixture')).toBe(true);
    expect(observed.observations.filter(item => item.terminal)).toHaveLength(1);
    expect(JSON.stringify(observed)).not.toContain('bounded compiled prompt');
    expect(transport.productionProcessSpawns).toBe(0);
    expect(transport.networkCalls).toBe(0);
    expect(transport.modelCalls).toBe(0);
  });

  it('resumes a controller-reconstructed episode on the same thread with a new correlated turn', async () => {
    const { runner, transport } = fixture();
    installCanonicalProtocol(transport, { resume: true });
    const launch = await runner.resume({
      ...startRequest({ requestId: 'request:resume' }),
      threadId: 'thread:existing',
    });
    expect(transport.writes.map(message => message.method)).toEqual([
      'initialize',
      'initialized',
      'thread/resume',
      'turn/start',
    ]);
    expect((await runner.observe(observeRequest(launch))).observations.map(item => item.eventType)).toEqual([
      'episode.resumed',
      'turn.started',
    ]);
    transport.emit({
      method: 'turn/completed',
      params: { threadId: 'thread:existing', turn: turn('turn:codex', 'completed') },
    });
    expect((await runner.observe(observeRequest(launch))).report?.terminalStatus).toBe('completed');
  });

  it('interrupts through the pinned method and accepts exactly one terminal notification', async () => {
    const { runner, transport } = fixture();
    installCanonicalProtocol(transport);
    const launch = await runner.start(startRequest());
    const interrupted = await runner.interrupt({
      schemaVersion: RUNNER_SCHEMA_VERSION,
      contractVersion: AGENT_RUNNER_CONTRACT_VERSION,
      correlation: launch.correlation,
      reason: 'operator',
    });
    expect(interrupted.status).toBe('acknowledged');
    expect(interrupted.correlation).toEqual(launch.correlation);
    expect(transport.writes.at(-1)?.method).toBe('turn/interrupt');
    transport.emit({
      method: 'turn/completed',
      params: { threadId: 'thread:codex', turn: turn('turn:codex', 'interrupted') },
    });
    transport.emit({
      method: 'turn/completed',
      params: { threadId: 'thread:codex', turn: turn('turn:codex', 'interrupted') },
    });
    const observed = await runner.observe(observeRequest(launch));
    expect(observed.report?.terminalStatus).toBe('interrupted');
    expect(observed.observations.filter(item => item.terminal)).toHaveLength(1);
  });

  it('never emits a second interrupt after an unknown acknowledgement outcome', async () => {
    const { runner, transport, timers } = fixture();
    installCanonicalProtocol(transport);
    const launch = await runner.start(startRequest());
    transport.onWrite = () => undefined;
    const pending = runner.interrupt({
      schemaVersion: RUNNER_SCHEMA_VERSION,
      contractVersion: AGENT_RUNNER_CONTRACT_VERSION,
      correlation: launch.correlation,
      reason: 'operator',
    });
    expect(timers.fireDelay(1_000)).toBe(1);
    expect((await pending).status).toBe('refused');
    expect(transport.writes.filter(message => message.method === 'turn/interrupt')).toHaveLength(1);
    expect(timers.fireDelay(100)).toBe(1);
    expect((await runner.observe(observeRequest(launch))).report?.terminalStatus).toBe('interrupted');
  });

  it.each([
    ['timeout', 2_000, 8_000, 'timed_out'],
    ['stall', 60_000, 2_000, 'stalled'],
  ] as const)('bounds %s with interruption grace and a typed terminal report', async (_name, timeBudgetMs, stallMs, status) => {
    const { runner, transport, timers } = fixture({ limits: { stallTimeoutMs: stallMs } });
    installCanonicalProtocol(transport);
    const launch = await runner.start(startRequest({ timeBudgetMs }));
    expect(timers.fireDelay(Math.min(timeBudgetMs, stallMs))).toBe(1);
    await settle();
    expect(transport.writes.at(-1)?.method).toBe('turn/interrupt');
    expect(timers.fireDelay(100)).toBe(1);
    const observed = await runner.observe(observeRequest(launch));
    expect(observed.report?.terminalStatus).toBe(status);
    expect(observed.observations.filter(item => item.terminal)).toHaveLength(1);
  });

  it('turns cancellation, disconnect, and process exit into distinct bounded terminal observations', async () => {
    const cancellation = new FakeCancellation();
    const cancelledFixture = fixture({ cancellation });
    installCanonicalProtocol(cancelledFixture.transport);
    const cancelledLaunch = await cancelledFixture.runner.start(startRequest());
    cancellation.cancel();
    await settle();
    cancelledFixture.timers.fireDelay(100);
    expect((await cancelledFixture.runner.observe(observeRequest(cancelledLaunch))).report?.terminalStatus).toBe('cancelled');

    const disconnectedFixture = fixture();
    installCanonicalProtocol(disconnectedFixture.transport);
    const disconnectedLaunch = await disconnectedFixture.runner.start(startRequest());
    disconnectedFixture.transport.disconnect();
    expect((await disconnectedFixture.runner.observe(observeRequest(disconnectedLaunch))).report?.terminalStatus)
      .toBe('adapter_disconnected');

    const exitedFixture = fixture();
    installCanonicalProtocol(exitedFixture.transport);
    const exitedLaunch = await exitedFixture.runner.start(startRequest());
    exitedFixture.transport.exit(23, 'SIGTERM');
    const exited = await exitedFixture.runner.observe(observeRequest(exitedLaunch));
    expect(exited.report?.terminalStatus).toBe('process_exited');
    expect(exited.observations.at(-1)?.metadata).toMatchObject({ exitCode: 23, signal: 'SIGTERM' });
  });

  it('represents app-server failure before the first turn without granting the error authority', async () => {
    const { runner, transport } = fixture();
    transport.onWrite = message => {
      if (message.method === 'initialize') transport.emit({ id: message.id, result: initializeResponse() });
      if (message.method === 'thread/start') {
        transport.emit({ id: message.id, error: { code: -32000, message: 'thread could not start' } });
      }
    };
    const launch = await runner.start(startRequest());
    const observed = await runner.observe(observeRequest(launch));
    expect(launch.status).toBe('refused');
    expect(observed.observations.at(-1)?.eventType).toBe('episode.failed_before_first_turn');
    expect(observed.report?.terminalStatus).toBe('failed_before_first_turn');
  });

  it('bounds a transport that never finishes starting and still permits bounded disposal', async () => {
    const transport = new FakeTransport();
    transport.start = async handlers => {
      transport.starts++;
      transport.handlers = handlers;
      await new Promise<void>(() => undefined);
    };
    const { runner, timers } = fixture({ transport });
    const pending = runner.start(startRequest());
    expect(timers.fireDelay(1_000)).toBe(1);
    const launch = await pending;
    expect(launch.status).toBe('refused');
    expect((await runner.observe(observeRequest(launch))).report?.terminalStatus).toBe('protocol_refused');
    expect((await runner.dispose({
      schemaVersion: RUNNER_SCHEMA_VERSION,
      contractVersion: AGENT_RUNNER_CONTRACT_VERSION,
      requestId: 'request:dispose-after-start-timeout',
      runnerId: 'runner:codex',
    })).status).toBe('disposed');
  });

  it.each([
    ['malformed JSON', (transport: FakeTransport) => transport.emitRaw('{malformed\n')],
    ['malformed UTF-8', (transport: FakeTransport) => transport.emitBytes(new Uint8Array([0xff, 0x0a]))],
    ['unknown message', (transport: FakeTransport) => transport.emit({ method: 'future/unknown', params: {} })],
    ['over-bound input', (transport: FakeTransport) => transport.emitRaw('x'.repeat(1_025))],
    ['missing response ID', (transport: FakeTransport) => transport.emit({ result: {} })],
    ['out-of-order response', (transport: FakeTransport) => transport.emit({ id: 'request:wrong', result: {} })],
    ['out-of-order notification', (transport: FakeTransport) => transport.emit({
      method: 'turn/started',
      params: { threadId: 'thread:codex', turn: turn() },
    })],
  ] as const)('deterministically refuses %s with one terminal observation', async (_name, fault) => {
    const { runner, transport } = fixture({ limits: { messageBytes: 1_024 } });
    transport.onWrite = message => {
      if (message.method === 'initialize') transport.emit({ id: message.id, result: initializeResponse() });
      if (message.method === 'thread/start') fault(transport);
    };
    const launch = await runner.start(startRequest());
    const observed = await runner.observe(observeRequest(launch));
    expect(launch.status).toBe('refused');
    expect(observed.report?.terminalStatus).toBe('protocol_refused');
    expect(observed.observations.filter(item => item.terminal)).toHaveLength(1);
  });

  it('refuses duplicate response identifiers deterministically', async () => {
    const { runner, transport } = fixture();
    let initializeId = '';
    transport.onWrite = message => {
      if (message.method === 'initialize') {
        initializeId = String(message.id);
        transport.emit({ id: message.id, result: initializeResponse() });
      }
      if (message.method === 'thread/start') transport.emit({ id: initializeId, result: {} });
    };
    const launch = await runner.start(startRequest());
    const observed = await runner.observe(observeRequest(launch));
    expect(observed.report?.terminalStatus).toBe('protocol_refused');
    expect(observed.report?.summary).toMatch(/duplicate/);
  });

  it('redacts configured and generic secrets before protocol failures are observable', async () => {
    const secret = 'fixture-owner-secret';
    const { runner, transport } = fixture({ sensitiveValues: [secret] });
    transport.onWrite = message => {
      if (message.method === 'initialize') transport.emit({ id: message.id, result: initializeResponse() });
      if (message.method === 'thread/start') {
        transport.emit({
          id: message.id,
          error: { code: -32000, message: `${secret} Bearer bearer-value` },
        });
      }
    };
    const launch = await runner.start(startRequest());
    const observed = await runner.observe(observeRequest(launch));
    const encoded = JSON.stringify(observed);
    expect(encoded).not.toContain(secret);
    expect(encoded).not.toContain('bearer-value');
    expect(encoded).toContain('[REDACTED]');
  });

  it('stops on protected server requests without responding, consuming approval, or persisting values', async () => {
    const secret = 'approval-value';
    const { runner, transport } = fixture({ sensitiveValues: [secret] });
    installCanonicalProtocol(transport);
    const launch = await runner.start(startRequest());
    const writesBefore = transport.writes.length;
    transport.emit({
      method: 'item/commandExecution/requestApproval',
      id: 'server-request:1',
      params: { threadId: 'thread:codex', turnId: 'turn:codex', approval: secret },
    });
    const observed = await runner.observe(observeRequest(launch));
    expect(observed.report?.terminalStatus).toBe('interrupted');
    expect(transport.writes).toHaveLength(writesBefore);
    expect(JSON.stringify(observed)).not.toContain(secret);
  });

  it('bounds observation duration and discards bounded wire activity content from durable observations', async () => {
    const secret = 'wire-only-secret';
    const { runner, transport, timers } = fixture({ sensitiveValues: [secret] });
    installCanonicalProtocol(transport);
    const launch = await runner.start(startRequest());
    transport.emit({
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread:codex', turnId: 'turn:codex', delta: secret },
    });
    const pending = runner.observe(observeRequest(launch, 2, 250));
    expect(timers.fireDelay(250)).toBe(1);
    const observed = await pending;
    expect(observed.observations).toEqual([]);
    expect(JSON.stringify(observed)).not.toContain(secret);
  });
});
