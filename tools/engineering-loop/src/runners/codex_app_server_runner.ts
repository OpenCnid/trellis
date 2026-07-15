import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { z } from 'zod';
import { canonicalJson } from '../events.js';
import { StableIdSchema, parseBoundary } from '../domain.js';
import {
  MAX_RUNNER_BUFFERED_EVENTS,
  MAX_RUNNER_INTERRUPTION_GRACE_MS,
  MAX_RUNNER_MESSAGE_BYTES,
  MAX_RUNNER_OBSERVATION_DURATION_MS,
  MAX_RUNNER_PENDING_REQUESTS,
  MAX_RUNNER_SHUTDOWN_MS,
  NeverCancelledRunner,
  RunnerDisposeRequestSchema,
  RunnerInterruptRequestSchema,
  RunnerObservationBuffer,
  RunnerObserveRequestSchema,
  RunnerResumeRequestSchema,
  RunnerStartRequestSchema,
  RunnerAdapterIdentitySchema,
  assertRunnerId,
  correlationFromResume,
  correlationFromStart,
  createRunnerRedactor,
  makeRunnerActionResult,
  makeRunnerLaunchResult,
  truncateUtf8,
  type AgentRunner,
  type RunnerActionResult,
  type RunnerAdapterIdentity,
  type RunnerCancellation,
  type RunnerClock,
  type RunnerEventType,
  type RunnerInterruptRequest,
  type RunnerLaunchResult,
  type RunnerObserveResult,
  type RunnerRedactor,
  type RunnerResumeRequest,
  type RunnerStartRequest,
  type RunnerTimerScheduler,
  SystemRunnerTimerScheduler,
} from './runner.js';

export const SUPPORTED_CODEX_APP_SERVER = Object.freeze({
  adapter: 'codex-app-server',
  adapterVersion: 'trellis-codex-app-server-runner:v1',
  protocolVersion: 'codex-app-server-jsonl:v2@0.144.2',
  executableVersion: 'codex-cli 0.144.2',
  stableSchemaSha256: '4d236168d44edcfb8df0244c90bd58b4fb8f85e443e29144d70bc564403ea8af',
} as const);

const SUPPORTED_IDENTITY: RunnerAdapterIdentity = RunnerAdapterIdentitySchema.parse({
  adapter: SUPPORTED_CODEX_APP_SERVER.adapter,
  adapterVersion: SUPPORTED_CODEX_APP_SERVER.adapterVersion,
  protocolVersion: SUPPORTED_CODEX_APP_SERVER.protocolVersion,
  executableVersion: SUPPORTED_CODEX_APP_SERVER.executableVersion,
});

export const CodexRunnerLimitsSchema = z.strictObject({
  messageBytes: z.number().int().min(1_024).max(MAX_RUNNER_MESSAGE_BYTES),
  bufferedEvents: z.number().int().min(4).max(MAX_RUNNER_BUFFERED_EVENTS),
  pendingRequests: z.literal(MAX_RUNNER_PENDING_REQUESTS),
  requestTimeoutMs: z.number().int().positive().max(60_000),
  observationDurationMs: z.number().int().positive().max(MAX_RUNNER_OBSERVATION_DURATION_MS),
  stallTimeoutMs: z.number().int().positive().max(3_600_000),
  interruptionGraceMs: z.number().int().positive().max(MAX_RUNNER_INTERRUPTION_GRACE_MS),
  shutdownMs: z.number().int().positive().max(MAX_RUNNER_SHUTDOWN_MS),
});

export type CodexRunnerLimits = z.infer<typeof CodexRunnerLimitsSchema>;

export const DEFAULT_CODEX_RUNNER_LIMITS: CodexRunnerLimits = Object.freeze({
  messageBytes: MAX_RUNNER_MESSAGE_BYTES,
  bufferedEvents: MAX_RUNNER_BUFFERED_EVENTS,
  pendingRequests: MAX_RUNNER_PENDING_REQUESTS,
  requestTimeoutMs: 10_000,
  observationDurationMs: MAX_RUNNER_OBSERVATION_DURATION_MS,
  stallTimeoutMs: 60_000,
  interruptionGraceMs: MAX_RUNNER_INTERRUPTION_GRACE_MS,
  shutdownMs: MAX_RUNNER_SHUTDOWN_MS,
});

export interface CodexAppServerTransportHandlers {
  onStdout(data: Uint8Array): void;
  onDisconnect(detail: string): void;
  onExit(exitCode: number | null, signal: string | null): void;
}

export interface CodexAppServerProcessTransport {
  readonly executableVersion: string;
  start(handlers: CodexAppServerTransportHandlers): Promise<void>;
  write(data: Uint8Array): Promise<void>;
  dispose(graceMs: number): Promise<void>;
}

export interface CodexAppServerStdioTransportOptions {
  executablePath: string;
  executableVersion: string;
  workingDirectory: string;
  environment?: Readonly<Record<string, string | undefined>>;
}

class StdioCodexAppServerTransport implements CodexAppServerProcessTransport {
  readonly executableVersion: string;
  readonly #options: CodexAppServerStdioTransportOptions;
  #child: ChildProcessWithoutNullStreams | null = null;
  #exitPromise: Promise<void> | null = null;
  #exited = false;

  constructor(options: CodexAppServerStdioTransportOptions) {
    this.#options = options;
    this.executableVersion = options.executableVersion;
  }

  async start(handlers: CodexAppServerTransportHandlers): Promise<void> {
    if (this.#child !== null) throw new Error('Codex app-server transport already started');
    const child = spawn(this.#options.executablePath, ['app-server', '--stdio'], {
      cwd: this.#options.workingDirectory,
      env: this.#options.environment === undefined
        ? process.env
        : { ...this.#options.environment },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.#child = child;
    child.stdout.on('data', (data: Buffer) => handlers.onStdout(data));
    child.stderr.resume();
    child.stdin.on('error', error => handlers.onDisconnect(`app-server stdin error: ${error.message}`));
    child.stdout.on('error', error => handlers.onDisconnect(`app-server stdout error: ${error.message}`));
    child.stderr.on('error', error => handlers.onDisconnect(`app-server stderr error: ${error.message}`));
    this.#exitPromise = new Promise(resolve => {
      child.once('exit', (code, signal) => {
        this.#exited = true;
        handlers.onExit(code, signal);
        resolve();
      });
    });
    await new Promise<void>((resolve, reject) => {
      const onSpawn = () => {
        child.off('error', onError);
        child.on('error', error => handlers.onDisconnect(`app-server process error: ${error.message}`));
        resolve();
      };
      const onError = (error: Error) => {
        child.off('spawn', onSpawn);
        reject(error);
      };
      child.once('spawn', onSpawn);
      child.once('error', onError);
    });
  }

  async write(data: Uint8Array): Promise<void> {
    if (this.#child === null || this.#exited) throw new Error('Codex app-server transport is not writable');
    await new Promise<void>((resolve, reject) => {
      this.#child!.stdin.write(Buffer.from(data), error => error ? reject(error) : resolve());
    });
  }

  async dispose(graceMs: number): Promise<void> {
    const child = this.#child;
    if (child === null || this.#exitPromise === null || this.#exited) return;
    child.stdin.end();
    const gracefulMs = Math.max(1, Math.floor(graceMs / 2));
    const exitedInGrace = await this.#waitForExit(gracefulMs);
    if (exitedInGrace || this.#exited) return;
    if (!child.kill()) throw new Error('Codex app-server process refused bounded termination');
    if (!await this.#waitForExit(Math.max(1, graceMs - gracefulMs))) {
      throw new Error('Codex app-server process did not exit within the bounded shutdown interval');
    }
  }

  async #waitForExit(timeoutMs: number): Promise<boolean> {
    if (this.#exited || this.#exitPromise === null) return true;
    return new Promise<boolean>(resolve => {
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        resolve(value);
      };
      const timeoutHandle = setTimeout(() => finish(false), timeoutMs);
      this.#exitPromise!.then(() => finish(true));
    });
  }
}

export function createCodexAppServerStdioTransport(
  options: CodexAppServerStdioTransportOptions
): CodexAppServerProcessTransport {
  return new StdioCodexAppServerTransport(options);
}

export async function probeCodexExecutableVersion(
  executablePath: string,
  timeoutMs = 5_000
): Promise<string> {
  const version = await new Promise<string>((resolve, reject) => {
    execFile(
      executablePath,
      ['--version'],
      { encoding: 'utf8', maxBuffer: 4_096, timeout: timeoutMs, windowsHide: true },
      (error, stdout) => error ? reject(error) : resolve(stdout.trim())
    );
  });
  if (Buffer.byteLength(version, 'utf8') === 0 || Buffer.byteLength(version, 'utf8') > 128) {
    throw new Error('Codex executable returned an invalid bounded version');
  }
  return version;
}

export const CodexNegotiationResultSchema = z.strictObject({
  status: z.enum(['ready', 'refused']),
  supported: RunnerAdapterIdentitySchema,
  stableSchemaSha256: z.string().regex(/^[0-9a-f]{64}$/),
  observedAt: z.string().datetime({ offset: true }),
  detail: z.string().max(1_024),
});

export type CodexNegotiationResult = z.infer<typeof CodexNegotiationResultSchema>;

export const CodexHandshakeSmokeResultSchema = z.strictObject({
  executableVersion: z.string().min(1).max(128),
  protocolVersion: z.literal(SUPPORTED_CODEX_APP_SERVER.protocolVersion),
  stableSchemaSha256: z.literal(SUPPORTED_CODEX_APP_SERVER.stableSchemaSha256),
  outboundMethods: z.tuple([z.literal('initialize'), z.literal('initialized')]),
  threadRequests: z.literal(0),
  turnRequests: z.literal(0),
  disposed: z.literal(true),
});

export type CodexHandshakeSmokeResult = z.infer<typeof CodexHandshakeSmokeResultSchema>;

export async function runCodexAppServerHandshakeSmoke(input: {
  executablePath: string;
  workingDirectory: string;
  codexHome: string;
}): Promise<CodexHandshakeSmokeResult> {
  const executableVersion = await probeCodexExecutableVersion(input.executablePath);
  const environmentKeys = [
    'SystemRoot',
    'ComSpec',
    'PATH',
    'PATHEXT',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'LOCALAPPDATA',
    'APPDATA',
  ] as const;
  const environment: Record<string, string> = {};
  for (const key of environmentKeys) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  environment.CODEX_HOME = input.codexHome;
  const base = createCodexAppServerStdioTransport({
    executablePath: input.executablePath,
    executableVersion,
    workingDirectory: input.workingDirectory,
    environment,
  });
  const outboundMethods: string[] = [];
  const transport: CodexAppServerProcessTransport = {
    executableVersion: base.executableVersion,
    start: handlers => base.start(handlers),
    write: data => {
      const envelope = JSON.parse(Buffer.from(data).toString('utf8')) as Record<string, unknown>;
      if (typeof envelope.method !== 'string') throw new Error('smoke emitted an invalid outbound envelope');
      outboundMethods.push(envelope.method);
      return base.write(data);
    },
    dispose: graceMs => base.dispose(graceMs),
  };
  const runner = new CodexAppServerRunner({
    runnerId: 'runner:local-smoke',
    transport,
    clock: { now: () => new Date().toISOString() },
  });
  let disposed = false;
  try {
    const negotiation = await runner.negotiate();
    if (negotiation.status !== 'ready') {
      throw new Error(`local Codex app-server negotiation refused: ${negotiation.detail}`);
    }
  } finally {
    const result = await runner.dispose({
      schemaVersion: 1,
      contractVersion: 'trellis-agent-runner:v1',
      requestId: 'request:local-smoke-dispose',
      runnerId: 'runner:local-smoke',
    });
    disposed = result.status === 'disposed';
  }
  return parseBoundary(CodexHandshakeSmokeResultSchema, {
    executableVersion,
    protocolVersion: SUPPORTED_CODEX_APP_SERVER.protocolVersion,
    stableSchemaSha256: SUPPORTED_CODEX_APP_SERVER.stableSchemaSha256,
    outboundMethods,
    threadRequests: outboundMethods.filter(method => method.startsWith('thread/')).length,
    turnRequests: outboundMethods.filter(method => method.startsWith('turn/')).length,
    disposed,
  }, 'local Codex app-server handshake smoke result');
}

const InitializeResponseSchema = z.strictObject({
  userAgent: z.string().min(1).max(256),
  codexHome: z.string().min(1).max(4_096),
  platformFamily: z.string().min(1).max(64),
  platformOs: z.string().min(1).max(64),
});

const ThreadIdentitySchema = z.object({
  id: StableIdSchema,
  cliVersion: z.string().min(1).max(128),
}).passthrough();

const ThreadResponseSchema = z.object({
  thread: ThreadIdentitySchema,
}).passthrough();

const TurnIdentitySchema = z.object({
  id: StableIdSchema,
  status: z.enum(['completed', 'interrupted', 'failed', 'inProgress']),
  error: z.object({ message: z.string().max(MAX_RUNNER_MESSAGE_BYTES) }).passthrough().nullable().optional(),
}).passthrough();

const TurnResponseSchema = z.object({
  turn: TurnIdentitySchema,
}).passthrough();

const ThreadStartedNotificationSchema = z.strictObject({
  thread: ThreadIdentitySchema,
});

const TurnStartedNotificationSchema = z.strictObject({
  threadId: StableIdSchema,
  turn: TurnIdentitySchema,
});

const TurnCompletedNotificationSchema = z.strictObject({
  threadId: StableIdSchema,
  turn: TurnIdentitySchema,
});

const ErrorNotificationSchema = z.strictObject({
  error: z.object({ message: z.string().max(MAX_RUNNER_MESSAGE_BYTES) }).passthrough(),
  willRetry: z.boolean(),
  threadId: StableIdSchema,
  turnId: StableIdSchema,
});

class ProtocolRefusalError extends Error {}
class RequestTimeoutError extends Error {}
class RunnerCancelledError extends Error {}
class AppServerRequestError extends Error {}

const PROTECTED_SERVER_REQUEST_METHODS = new Set([
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/tool/requestUserInput',
  'mcpServer/elicitation/request',
  'item/permissions/requestApproval',
  'item/tool/call',
  'account/chatgptAuthTokens/refresh',
  'attestation/generate',
  'applyPatchApproval',
  'execCommandApproval',
]);

const BOUNDED_ACTIVITY_NOTIFICATION_METHODS = new Set([
  'thread/status/changed',
  'thread/tokenUsage/updated',
  'turn/diff/updated',
  'turn/plan/updated',
  'item/started',
  'item/completed',
  'item/agentMessage/delta',
  'item/plan/delta',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/summaryPartAdded',
  'item/reasoning/textDelta',
  'item/commandExecution/outputDelta',
  'item/commandExecution/terminalInteraction',
  'item/fileChange/outputDelta',
  'item/fileChange/patchUpdated',
  'item/mcpToolCall/progress',
  'rawResponseItem/completed',
  'process/outputDelta',
  'process/exited',
  'hook/started',
  'hook/completed',
  'warning',
  'guardianWarning',
  'deprecationNotice',
  'configWarning',
  'model/rerouted',
  'model/verification',
  'turn/moderationMetadata',
  'model/safetyBuffering/updated',
]);

interface PendingRequest {
  id: string;
  method: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeoutHandle: unknown;
  unsubscribeCancellation: () => void;
}

type WirePhase =
  | 'idle'
  | 'initializing'
  | 'ready'
  | 'starting_thread'
  | 'resuming_thread'
  | 'starting_turn'
  | 'running'
  | 'terminal'
  | 'disposed';

export interface CodexAppServerRunnerOptions {
  runnerId: string;
  transport: CodexAppServerProcessTransport;
  clock: RunnerClock;
  timers?: RunnerTimerScheduler;
  cancellation?: RunnerCancellation;
  limits?: Partial<CodexRunnerLimits>;
  sensitiveValues?: readonly string[];
}

export class CodexAppServerRunner implements AgentRunner {
  readonly runnerId: string;
  readonly transport: CodexAppServerProcessTransport;
  readonly clock: RunnerClock;
  readonly timers: RunnerTimerScheduler;
  readonly cancellation: RunnerCancellation;
  readonly limits: CodexRunnerLimits;
  readonly adapter = SUPPORTED_IDENTITY;
  readonly redact: RunnerRedactor;
  #phase: WirePhase = 'idle';
  #buffer: RunnerObservationBuffer | null = null;
  #wireBuffer = Buffer.alloc(0);
  #pending = new Map<string, PendingRequest>();
  #seenResponseIds = new Set<string>();
  #seenNotifications = new Set<string>();
  #seenServerRequestIds = new Set<string>();
  #requestSequence = 0;
  #negotiation: CodexNegotiationResult | null = null;
  #transportStarted = false;
  #threadStartedNotification: string | null = null;
  #turnStartedNotification: string | null = null;
  #timeBudgetHandle: unknown = null;
  #stallHandle: unknown = null;
  #interruptGraceHandle: unknown = null;
  #interruptReason: RunnerInterruptRequest['reason'] | null = null;
  #unsubscribeCancellation: () => void;

  constructor(options: CodexAppServerRunnerOptions) {
    this.runnerId = parseBoundary(StableIdSchema, options.runnerId, 'Codex runner identifier');
    this.transport = options.transport;
    this.clock = options.clock;
    this.timers = options.timers ?? new SystemRunnerTimerScheduler();
    this.cancellation = options.cancellation ?? new NeverCancelledRunner();
    this.limits = parseBoundary(CodexRunnerLimitsSchema, {
      ...DEFAULT_CODEX_RUNNER_LIMITS,
      ...options.limits,
    }, 'Codex runner limits');
    this.redact = createRunnerRedactor(options.sensitiveValues ?? []);
    this.#unsubscribeCancellation = this.cancellation.subscribe(() => {
      if (this.#buffer !== null && !this.#buffer.terminal) {
        void this.#beginBoundedInterrupt('cancellation');
      }
    });
  }

  #makeNegotiation(status: 'ready' | 'refused', detail: string): CodexNegotiationResult {
    const redacted = this.redact(detail);
    return parseBoundary(CodexNegotiationResultSchema, {
      status,
      supported: this.adapter,
      stableSchemaSha256: SUPPORTED_CODEX_APP_SERVER.stableSchemaSha256,
      observedAt: this.clock.now(),
      detail: truncateUtf8(redacted.text, 1_024),
    }, 'Codex app-server negotiation result');
  }

  async #boundedOperation<T>(
    operation: Promise<T>,
    timeoutMs: number,
    label: string,
    cancellationAware: boolean
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let unsubscribe: () => void = () => undefined;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        this.timers.cancel(timeoutHandle);
        unsubscribe();
        callback();
      };
      const timeoutHandle = this.timers.schedule(timeoutMs, () => {
        finish(() => reject(new RequestTimeoutError(`${label} exceeded its ${timeoutMs} millisecond bound`)));
      });
      if (cancellationAware) {
        unsubscribe = this.cancellation.subscribe(() => {
          finish(() => reject(new RunnerCancelledError(`${label} cancelled`)));
        });
      }
      operation.then(
        value => finish(() => resolve(value)),
        error => finish(() => reject(error instanceof Error ? error : new Error(String(error))))
      );
    });
  }

  async negotiate(): Promise<CodexNegotiationResult> {
    if (this.#negotiation !== null) return structuredClone(this.#negotiation);
    if (this.transport.executableVersion !== SUPPORTED_CODEX_APP_SERVER.executableVersion) {
      this.#negotiation = this.#makeNegotiation(
        'refused',
        `unsupported Codex executable '${this.transport.executableVersion}'; expected '${SUPPORTED_CODEX_APP_SERVER.executableVersion}'`
      );
      return structuredClone(this.#negotiation);
    }
    try {
      this.#phase = 'initializing';
      this.#transportStarted = true;
      await this.#boundedOperation(this.transport.start({
        onStdout: data => this.#ingestStdout(data),
        onDisconnect: detail => this.#onDisconnect(detail),
        onExit: (exitCode, signal) => this.#onExit(exitCode, signal),
      }), this.limits.requestTimeoutMs, 'app-server transport start', true);
      const result = await this.#request('initialize', {
        clientInfo: {
          name: 'trellis-engineering-loop',
          title: 'Trellis Engineering Loop',
          version: SUPPORTED_CODEX_APP_SERVER.adapterVersion,
        },
        capabilities: {
          experimentalApi: false,
          requestAttestation: false,
        },
      });
      const initialized = parseBoundary(InitializeResponseSchema, result, 'Codex initialize response');
      if (!initialized.userAgent.includes('0.144.2')) {
        throw new ProtocolRefusalError('initialize user agent does not report the pinned Codex version');
      }
      await this.#notification('initialized');
      this.#phase = 'ready';
      this.#negotiation = this.#makeNegotiation('ready', 'pinned stable app-server protocol negotiated');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#negotiation = this.#makeNegotiation('refused', message);
      if (this.#phase !== 'disposed') this.#phase = 'terminal';
    }
    return structuredClone(this.#negotiation);
  }

  #begin(correlation: unknown): RunnerObservationBuffer {
    if (this.#buffer !== null) throw new Error('Codex runner instance already owns an episode attempt');
    const buffer = new RunnerObservationBuffer({
      adapter: this.adapter,
      clock: this.clock,
      maxEvents: this.limits.bufferedEvents,
      redact: this.redact,
    });
    buffer.begin(correlation);
    this.#buffer = buffer;
    return buffer;
  }

  #append(eventType: RunnerEventType, detail: string, options: {
    observedBytes?: number | null;
    exitCode?: number | null;
    signal?: string | null;
  } = {}): void {
    if (this.#buffer === null) return;
    const observation = this.#buffer.append(eventType, { detail, ...options });
    if (observation.terminal) {
      this.#phase = 'terminal';
      this.#cancelRunTimers();
    }
  }

  #launchRefusal(detail: string): RunnerLaunchResult {
    const correlation = this.#buffer?.correlation;
    if (correlation === null || correlation === undefined) throw new Error('Codex launch refusal lacks episode correlation');
    const redacted = this.redact(detail);
    return makeRunnerLaunchResult({
      status: 'refused',
      correlation,
      adapter: this.adapter,
      observedAt: this.clock.now(),
      refusal: truncateUtf8(redacted.text, 1_024),
    });
  }

  #handleLaunchError(error: unknown): RunnerLaunchResult {
    const message = error instanceof Error ? error.message : String(error);
    if (this.#buffer === null) throw new Error('Codex launch error lacks an episode buffer');
    if (!this.#buffer.terminal) {
      if (error instanceof RunnerCancelledError) {
        this.#append('episode.cancelled', message);
      } else if (error instanceof RequestTimeoutError) {
        this.#append('episode.timed_out', message);
      } else if (error instanceof ProtocolRefusalError) {
        this.#append('protocol.refused', message);
      } else if (this.#buffer.correlation?.turnId === null) {
        this.#append('episode.failed_before_first_turn', message);
      } else {
        this.#append('episode.failed', message);
      }
    }
    return this.#launchRefusal(this.#buffer.report?.summary ?? message);
  }

  async start(requestValue: unknown): Promise<RunnerLaunchResult> {
    const request = parseBoundary(RunnerStartRequestSchema, requestValue, 'Codex runner start request');
    assertRunnerId(this.runnerId, request.runnerId);
    const buffer = this.#begin(correlationFromStart(request));
    if (this.cancellation.isCancelled()) {
      this.#append('episode.cancelled', 'runner cancellation was already requested');
      return this.#launchRefusal(buffer.report!.summary);
    }
    const negotiation = await this.negotiate();
    if (negotiation.status === 'refused') {
      this.#append('protocol.refused', negotiation.detail);
      return this.#launchRefusal(negotiation.detail);
    }
    try {
      this.#phase = 'starting_thread';
      this.#threadStartedNotification = null;
      const result = parseBoundary(ThreadResponseSchema, await this.#request('thread/start', {
        cwd: request.workingDirectory,
        approvalPolicy: 'on-request',
        sandbox: 'workspace-write',
        ephemeral: false,
      }), 'Codex thread/start response');
      this.#assertThreadVersion(result.thread.cliVersion);
      if (this.#threadStartedNotification === null || this.#threadStartedNotification !== result.thread.id) {
        throw new ProtocolRefusalError('thread/start response lacks its ordered thread/started confirmation');
      }
      buffer.updateIdentifiers(result.thread.id, null);
      this.#append('episode.started', 'Codex episode started');
      await this.#startTurn(request, result.thread.id);
      this.#scheduleRunBounds(request.timeBudgetMs);
      return makeRunnerLaunchResult({
        status: 'started',
        correlation: buffer.correlation!,
        adapter: this.adapter,
        observedAt: this.clock.now(),
      });
    } catch (error) {
      return this.#handleLaunchError(error);
    }
  }

  async resume(requestValue: unknown): Promise<RunnerLaunchResult> {
    const request = parseBoundary(RunnerResumeRequestSchema, requestValue, 'Codex runner resume request');
    assertRunnerId(this.runnerId, request.runnerId);
    const buffer = this.#begin(correlationFromResume(request));
    if (this.cancellation.isCancelled()) {
      this.#append('episode.cancelled', 'runner cancellation was already requested');
      return this.#launchRefusal(buffer.report!.summary);
    }
    const negotiation = await this.negotiate();
    if (negotiation.status === 'refused') {
      this.#append('protocol.refused', negotiation.detail);
      return this.#launchRefusal(negotiation.detail);
    }
    try {
      this.#phase = 'resuming_thread';
      const result = parseBoundary(ThreadResponseSchema, await this.#request('thread/resume', {
        threadId: request.threadId,
        cwd: request.workingDirectory,
        approvalPolicy: 'on-request',
        sandbox: 'workspace-write',
      }), 'Codex thread/resume response');
      this.#assertThreadVersion(result.thread.cliVersion);
      if (result.thread.id !== request.threadId) {
        throw new ProtocolRefusalError('thread/resume response identifier does not match the requested thread');
      }
      buffer.updateIdentifiers(result.thread.id, null);
      this.#append('episode.resumed', 'Codex episode resumed after controller reconstruction');
      await this.#startTurn(request, result.thread.id);
      this.#scheduleRunBounds(request.timeBudgetMs);
      return makeRunnerLaunchResult({
        status: 'started',
        correlation: buffer.correlation!,
        adapter: this.adapter,
        observedAt: this.clock.now(),
      });
    } catch (error) {
      return this.#handleLaunchError(error);
    }
  }

  async #startTurn(request: RunnerStartRequest | RunnerResumeRequest, threadId: string): Promise<void> {
    this.#phase = 'starting_turn';
    this.#turnStartedNotification = null;
    const result = parseBoundary(TurnResponseSchema, await this.#request('turn/start', {
      threadId,
      clientUserMessageId: request.requestId,
      input: [{ type: 'text', text: request.prompt.text, text_elements: [] }],
      cwd: request.workingDirectory,
    }), 'Codex turn/start response');
    if (result.turn.status !== 'inProgress') {
      throw new ProtocolRefusalError('turn/start response must report an in-progress turn');
    }
    if (this.#turnStartedNotification === null || this.#turnStartedNotification !== result.turn.id) {
      throw new ProtocolRefusalError('turn/start response lacks its ordered turn/started confirmation');
    }
    this.#buffer!.updateIdentifiers(threadId, result.turn.id);
    this.#append('turn.started', 'Codex turn started');
    this.#phase = 'running';
  }

  #assertThreadVersion(cliVersion: string): void {
    if (cliVersion !== '0.144.2') {
      throw new ProtocolRefusalError(`thread reports incompatible Codex CLI version '${cliVersion}'`);
    }
  }

  async interrupt(requestValue: unknown): Promise<RunnerActionResult> {
    const request = parseBoundary(RunnerInterruptRequestSchema, requestValue, 'Codex runner interrupt request');
    assertRunnerId(this.runnerId, request.correlation.runnerId);
    this.#assertActiveCorrelation(request.correlation);
    if (this.#buffer!.terminal) {
      return makeRunnerActionResult({
        status: 'already_terminal',
        correlation: request.correlation,
        requestId: request.correlation.requestId,
        runnerId: this.runnerId,
        observedAt: this.clock.now(),
        detail: 'episode already has its terminal observation',
        redact: this.redact,
      });
    }
    try {
      await this.#sendInterrupt(request.reason);
      return makeRunnerActionResult({
        status: 'acknowledged',
        correlation: request.correlation,
        requestId: request.correlation.requestId,
        runnerId: this.runnerId,
        observedAt: this.clock.now(),
        detail: 'bounded interruption request acknowledged by app-server',
        redact: this.redact,
      });
    } catch (error) {
      this.#scheduleInterruptionGrace(request.reason);
      return makeRunnerActionResult({
        status: 'refused',
        correlation: request.correlation,
        requestId: request.correlation.requestId,
        runnerId: this.runnerId,
        observedAt: this.clock.now(),
        detail: error instanceof Error ? error.message : String(error),
        redact: this.redact,
      });
    }
  }

  async #sendInterrupt(reason: RunnerInterruptRequest['reason']): Promise<void> {
    const correlation = this.#buffer?.correlation;
    if (correlation?.threadId == null || correlation.turnId == null) {
      throw new Error('Codex interruption requires active thread and turn identifiers');
    }
    this.#interruptReason = reason;
    const result = await this.#request('turn/interrupt', {
      threadId: correlation.threadId,
      turnId: correlation.turnId,
    });
    parseBoundary(z.strictObject({}), result, 'Codex turn/interrupt response');
    this.#scheduleInterruptionGrace(reason);
  }

  async #beginBoundedInterrupt(reason: RunnerInterruptRequest['reason']): Promise<void> {
    if (this.#buffer === null || this.#buffer.terminal || this.#interruptGraceHandle !== null) return;
    try {
      await this.#sendInterrupt(reason);
    } catch {
      this.#scheduleInterruptionGrace(reason);
    }
  }

  #scheduleInterruptionGrace(reason: RunnerInterruptRequest['reason']): void {
    if (this.#interruptGraceHandle !== null || this.#buffer?.terminal) return;
    this.#interruptReason = reason;
    this.#interruptGraceHandle = this.timers.schedule(this.limits.interruptionGraceMs, () => {
      this.#interruptGraceHandle = null;
      this.#append(this.#terminalEventForInterrupt(reason), `interruption grace elapsed for ${reason}`);
    });
  }

  #terminalEventForInterrupt(reason: RunnerInterruptRequest['reason']): RunnerEventType {
    return {
      operator: 'episode.interrupted',
      timeout: 'episode.timed_out',
      stall: 'episode.stalled',
      cancellation: 'episode.cancelled',
    }[reason] as RunnerEventType;
  }

  async observe(requestValue: unknown): Promise<RunnerObserveResult> {
    const request = parseBoundary(RunnerObserveRequestSchema, requestValue, 'Codex runner observe request');
    assertRunnerId(this.runnerId, request.correlation.runnerId);
    if (request.durationMs > this.limits.observationDurationMs) {
      throw new Error('Codex observation duration exceeds the configured adapter bound');
    }
    if (this.#buffer === null) throw new Error('Codex runner has no episode to observe');
    const immediate = this.#buffer.read(request);
    if (immediate.observations.length > 0 || immediate.terminal || request.durationMs === 0) return immediate;
    await new Promise<void>(resolve => {
      let settled = false;
      let unsubscribe: () => void = () => undefined;
      const finish = () => {
        if (settled) return;
        settled = true;
        unsubscribe();
        this.timers.cancel(timeoutHandle);
        resolve();
      };
      const timeoutHandle = this.timers.schedule(request.durationMs, finish);
      unsubscribe = this.#buffer!.subscribe(finish);
    });
    return this.#buffer.read(request);
  }

  async dispose(requestValue: unknown): Promise<RunnerActionResult> {
    const request = parseBoundary(RunnerDisposeRequestSchema, requestValue, 'Codex runner dispose request');
    assertRunnerId(this.runnerId, request.runnerId);
    if (this.#phase === 'disposed') {
      return makeRunnerActionResult({
        status: 'disposed',
        requestId: request.requestId,
        runnerId: this.runnerId,
        observedAt: this.clock.now(),
        detail: 'Codex runner already disposed',
        redact: this.redact,
      });
    }
    if (this.#buffer !== null && !this.#buffer.terminal) {
      this.#append('episode.cancelled', 'runner disposed before a terminal app-server notification');
    }
    this.#cancelRunTimers();
    this.#rejectAllPending(new Error('Codex runner disposed'));
    this.#unsubscribeCancellation();
    let status: RunnerActionResult['status'] = 'disposed';
    let detail = 'Codex app-server disposed within the bounded shutdown interval';
    try {
      if (this.#transportStarted) {
        await this.#boundedOperation(
          this.transport.dispose(this.limits.shutdownMs),
          this.limits.shutdownMs,
          'app-server shutdown',
          false
        );
      }
    } catch (error) {
      status = 'refused';
      detail = error instanceof Error ? error.message : String(error);
    }
    this.#phase = 'disposed';
    return makeRunnerActionResult({
      status,
      requestId: request.requestId,
      runnerId: this.runnerId,
      observedAt: this.clock.now(),
      detail,
      redact: this.redact,
    });
  }

  #assertActiveCorrelation(observed: {
    workflowId: string;
    featureId: string;
    sessionId: string;
    episodeId: string;
    requestId: string;
    runnerId: string;
    threadId: string | null;
    turnId: string | null;
  }): void {
    const active = this.#buffer?.correlation;
    if (active === null || active === undefined || canonicalJson(active) !== canonicalJson(observed)) {
      throw new Error('Codex runner action correlation does not match the active episode');
    }
  }

  #scheduleRunBounds(timeBudgetMs: number): void {
    this.#timeBudgetHandle = this.timers.schedule(timeBudgetMs, () => {
      this.#timeBudgetHandle = null;
      void this.#beginBoundedInterrupt('timeout');
    });
    this.#touchStall();
  }

  #touchStall(): void {
    if (this.#phase !== 'running') return;
    if (this.#stallHandle !== null) this.timers.cancel(this.#stallHandle);
    this.#stallHandle = this.timers.schedule(this.limits.stallTimeoutMs, () => {
      this.#stallHandle = null;
      void this.#beginBoundedInterrupt('stall');
    });
  }

  #cancelRunTimers(): void {
    for (const handle of [this.#timeBudgetHandle, this.#stallHandle, this.#interruptGraceHandle]) {
      if (handle !== null) this.timers.cancel(handle);
    }
    this.#timeBudgetHandle = null;
    this.#stallHandle = null;
    this.#interruptGraceHandle = null;
  }

  async #notification(method: string, params?: unknown): Promise<void> {
    const envelope = params === undefined ? { method } : { method, params };
    await this.#writeEnvelope(envelope);
  }

  async #request(method: string, params: unknown): Promise<unknown> {
    if (this.#pending.size >= this.limits.pendingRequests) {
      throw new ProtocolRefusalError('app-server pending request bound exceeded');
    }
    if (this.cancellation.isCancelled()) throw new RunnerCancelledError('runner cancellation requested');
    const activeRequestId = this.#buffer?.correlation?.requestId ?? 'negotiation';
    const id = `${activeRequestId}:${++this.#requestSequence}`;
    return new Promise<unknown>((resolve, reject) => {
      const timeoutHandle = this.timers.schedule(this.limits.requestTimeoutMs, () => {
        this.#completePending(id);
        reject(new RequestTimeoutError(`app-server request '${method}' timed out`));
      });
      const unsubscribeCancellation = this.cancellation.subscribe(() => {
        this.#completePending(id);
        reject(new RunnerCancelledError(`app-server request '${method}' cancelled`));
      });
      this.#pending.set(id, {
        id,
        method,
        resolve,
        reject,
        timeoutHandle,
        unsubscribeCancellation,
      });
      void this.#writeEnvelope({ method, params, id }).catch(error => {
        this.#completePending(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  async #writeEnvelope(envelope: unknown): Promise<void> {
    const encoded = Buffer.from(`${canonicalJson(envelope)}\n`, 'utf8');
    if (encoded.length > this.limits.messageBytes) {
      throw new ProtocolRefusalError('outgoing app-server message exceeds the explicit byte bound');
    }
    await this.transport.write(encoded);
  }

  #completePending(id: string): PendingRequest | null {
    const pending = this.#pending.get(id) ?? null;
    if (pending === null) return null;
    this.#pending.delete(id);
    this.timers.cancel(pending.timeoutHandle);
    pending.unsubscribeCancellation();
    return pending;
  }

  #rejectAllPending(error: Error): void {
    for (const id of [...this.#pending.keys()]) {
      const pending = this.#completePending(id);
      pending?.reject(error);
    }
  }

  #ingestStdout(dataValue: Uint8Array): void {
    if (this.#phase === 'disposed') return;
    const data = Buffer.from(dataValue);
    if (this.#wireBuffer.length + data.length > this.limits.messageBytes) {
      this.#protocolRefusal('app-server buffered message exceeds the explicit byte bound', this.limits.messageBytes + 1);
      return;
    }
    this.#wireBuffer = Buffer.concat([this.#wireBuffer, data]);
    while (true) {
      const newline = this.#wireBuffer.indexOf(0x0a);
      if (newline < 0) break;
      const line = this.#wireBuffer.subarray(0, newline);
      this.#wireBuffer = this.#wireBuffer.subarray(newline + 1);
      if (line.length === 0) {
        this.#protocolRefusal('app-server emitted an empty protocol message', 0);
        return;
      }
      if (line.length > this.limits.messageBytes) {
        this.#protocolRefusal('app-server message exceeds the explicit byte bound', line.length);
        return;
      }
      this.#handleWireLine(line);
      if (this.#phase === 'terminal' && this.#buffer?.terminal) return;
    }
  }

  #handleWireLine(line: Buffer): void {
    let decoded: unknown;
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(line);
      decoded = JSON.parse(text);
    } catch {
      this.#protocolRefusal('app-server emitted malformed UTF-8 or JSON', line.length);
      return;
    }
    if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) {
      this.#protocolRefusal('app-server message must be one JSON object', line.length);
      return;
    }
    const message = decoded as Record<string, unknown>;
    if (typeof message.method === 'string') {
      if ('id' in message) {
        const keys = Object.keys(message).sort();
        if (
          canonicalJson(keys) !== canonicalJson(['id', 'method', 'params'])
          || !PROTECTED_SERVER_REQUEST_METHODS.has(message.method)
        ) {
          this.#protocolRefusal('unknown or malformed app-server request', line.length);
          return;
        }
        const serverRequestId = typeof message.id === 'number' ? String(message.id) : message.id;
        if (
          typeof serverRequestId !== 'string'
          || serverRequestId.length === 0
          || serverRequestId.length > 256
          || this.#seenServerRequestIds.has(serverRequestId)
        ) {
          this.#protocolRefusal('app-server request has a missing, invalid, or duplicate identifier', line.length);
          return;
        }
        this.#seenServerRequestIds.add(serverRequestId);
        if (this.#phase !== 'running' || this.#buffer === null || this.#buffer.terminal) {
          this.#protocolRefusal('out-of-order app-server request', line.length);
          return;
        }
        this.#append(
          'episode.interrupted',
          `protected app-server request '${message.method}' requires controller and human authority`,
          { observedBytes: line.length }
        );
        return;
      }
      if (canonicalJson(Object.keys(message).sort()) !== canonicalJson(['method', 'params'])) {
        this.#protocolRefusal('app-server notification has unknown envelope fields', line.length);
        return;
      }
      this.#handleNotification(message.method, message.params, line.length);
      return;
    }
    if (!('id' in message)) {
      this.#protocolRefusal('app-server response is missing its correlation identifier', line.length);
      return;
    }
    const keys = Object.keys(message).sort();
    const hasResult = 'result' in message;
    const hasError = 'error' in message;
    if (
      hasResult === hasError
      || canonicalJson(keys) !== canonicalJson(hasResult ? ['id', 'result'] : ['error', 'id'])
    ) {
      this.#protocolRefusal('app-server response envelope is malformed or has unknown fields', line.length);
      return;
    }
    this.#handleResponse(message.id, hasResult ? message.result : undefined, hasError ? message.error : undefined, line.length);
  }

  #handleResponse(idValue: unknown, result: unknown, error: unknown, observedBytes: number): void {
    if (typeof idValue !== 'string' || idValue.length === 0 || idValue.length > 256) {
      this.#protocolRefusal('app-server response identifier is missing or invalid', observedBytes);
      return;
    }
    if (this.#seenResponseIds.has(idValue)) {
      this.#protocolRefusal(`duplicate app-server response identifier '${idValue}'`, observedBytes);
      return;
    }
    const pending = this.#pending.get(idValue);
    if (pending === undefined) {
      this.#protocolRefusal(`out-of-order or unknown app-server response identifier '${idValue}'`, observedBytes);
      return;
    }
    this.#seenResponseIds.add(idValue);
    this.#completePending(idValue);
    if (error !== undefined) {
      const parsed = z.object({
        code: z.number().int(),
        message: z.string().max(MAX_RUNNER_MESSAGE_BYTES),
      }).passthrough().safeParse(error);
      const detail = parsed.success ? parsed.data.message : 'malformed app-server error response';
      pending.reject(new AppServerRequestError(`${pending.method}: ${detail}`));
      return;
    }
    pending.resolve(result);
  }

  #handleNotification(method: string, params: unknown, observedBytes: number): void {
    if (method === 'thread/started') {
      const notification = this.#parseNotification(ThreadStartedNotificationSchema, params, method, observedBytes);
      if (notification === null) return;
      const key = `${method}:${notification.thread.id}`;
      if (this.#phase !== 'starting_thread' || this.#seenNotifications.has(key)) {
        this.#protocolRefusal('duplicate or out-of-order thread/started notification', observedBytes);
        return;
      }
      this.#seenNotifications.add(key);
      try {
        this.#assertThreadVersion(notification.thread.cliVersion);
      } catch (error) {
        this.#protocolRefusal(error instanceof Error ? error.message : String(error), observedBytes);
        return;
      }
      this.#threadStartedNotification = notification.thread.id;
      return;
    }
    if (method === 'turn/started') {
      const notification = this.#parseNotification(TurnStartedNotificationSchema, params, method, observedBytes);
      if (notification === null) return;
      const key = `${method}:${notification.threadId}:${notification.turn.id}`;
      if (
        this.#phase !== 'starting_turn'
        || notification.threadId !== this.#buffer?.correlation?.threadId
        || notification.turn.status !== 'inProgress'
        || this.#seenNotifications.has(key)
      ) {
        this.#protocolRefusal('duplicate or out-of-order turn/started notification', observedBytes);
        return;
      }
      this.#seenNotifications.add(key);
      this.#turnStartedNotification = notification.turn.id;
      return;
    }
    if (method === 'turn/completed') {
      const notification = this.#parseNotification(TurnCompletedNotificationSchema, params, method, observedBytes);
      if (notification === null) return;
      const active = this.#buffer?.correlation;
      const key = `${method}:${notification.threadId}:${notification.turn.id}`;
      if (
        this.#phase !== 'running'
        || active?.threadId !== notification.threadId
        || active.turnId !== notification.turn.id
        || notification.turn.status === 'inProgress'
        || this.#seenNotifications.has(key)
      ) {
        this.#protocolRefusal('duplicate or out-of-order turn/completed notification', observedBytes);
        return;
      }
      this.#seenNotifications.add(key);
      const detail = notification.turn.error?.message ?? `Codex turn ${notification.turn.status}`;
      if (notification.turn.status === 'completed') this.#append('episode.completed', detail, { observedBytes });
      else if (notification.turn.status === 'interrupted') {
        this.#append(
          this.#interruptReason === null ? 'episode.interrupted' : this.#terminalEventForInterrupt(this.#interruptReason),
          detail,
          { observedBytes }
        );
      } else this.#append('episode.failed', detail, { observedBytes });
      return;
    }
    if (method === 'error') {
      const notification = this.#parseNotification(ErrorNotificationSchema, params, method, observedBytes);
      if (notification === null) return;
      const active = this.#buffer?.correlation;
      if (
        active?.threadId !== notification.threadId
        || (active.turnId !== null && active.turnId !== notification.turnId)
      ) {
        this.#protocolRefusal('error notification correlation does not match the active episode', observedBytes);
        return;
      }
      const detail = `${notification.error.message}; app-server retry=${notification.willRetry}`;
      this.#append(active.turnId === null ? 'episode.failed_before_first_turn' : 'episode.failed', detail, { observedBytes });
      return;
    }
    if (BOUNDED_ACTIVITY_NOTIFICATION_METHODS.has(method)) {
      if (this.#phase !== 'running' || params === null || typeof params !== 'object' || Array.isArray(params)) {
        this.#protocolRefusal(`out-of-order or malformed '${method}' notification`, observedBytes);
        return;
      }
      const record = params as Record<string, unknown>;
      const active = this.#buffer?.correlation;
      if (
        ('threadId' in record && record.threadId !== active?.threadId)
        || ('turnId' in record && record.turnId !== active?.turnId)
      ) {
        this.#protocolRefusal(`'${method}' notification correlation does not match the active episode`, observedBytes);
        return;
      }
      this.#touchStall();
      return;
    }
    this.#protocolRefusal(`unknown app-server notification '${method}'`, observedBytes);
  }

  #parseNotification<T extends z.ZodTypeAny>(
    schema: T,
    params: unknown,
    method: string,
    observedBytes: number
  ): z.infer<T> | null {
    const parsed = schema.safeParse(params);
    if (!parsed.success) {
      this.#protocolRefusal(`malformed '${method}' notification`, observedBytes);
      return null;
    }
    return parsed.data;
  }

  #protocolRefusal(detail: string, observedBytes: number | null = null): void {
    const error = new ProtocolRefusalError(detail);
    this.#rejectAllPending(error);
    if (this.#buffer !== null && !this.#buffer.terminal) {
      this.#append('protocol.refused', detail, { observedBytes });
    } else if (this.#buffer === null && this.#phase !== 'disposed') {
      this.#phase = 'terminal';
    }
  }

  #onDisconnect(detail: string): void {
    this.#rejectAllPending(new Error(detail));
    if (this.#buffer !== null && !this.#buffer.terminal) this.#append('adapter.disconnected', detail);
  }

  #onExit(exitCode: number | null, signal: string | null): void {
    this.#rejectAllPending(new Error('Codex app-server process exited'));
    if (this.#buffer !== null && !this.#buffer.terminal) {
      this.#append('process.exited', 'Codex app-server process exited', { exitCode, signal });
    }
  }
}
