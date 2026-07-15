import { z } from 'zod';
import {
  MAX_COLLECTION_ITEMS,
  RepositoryObservationSchema,
  parseBoundary,
  type EffectIntent,
  type RepositoryObservation,
} from './domain.js';
import { sha256Canonical } from './events.js';
import {
  AGENT_RUNNER_CONTRACT_VERSION,
  RUNNER_SCHEMA_VERSION,
  RunnerDisposeRequestSchema,
  RunnerInterruptRequestSchema,
  RunnerObservationBuffer,
  RunnerObserveRequestSchema,
  RunnerResumeRequestSchema,
  RunnerStartRequestSchema,
  assertRunnerId,
  correlationFromResume,
  correlationFromStart,
  createRunnerRedactor,
  makeRunnerActionResult,
  makeRunnerLaunchResult,
  sameRunnerCorrelation,
  type AgentRunner,
  type RunnerAdapterIdentity,
  type RunnerEpisodeReport,
  type RunnerLaunchResult,
  type RunnerObserveResult,
  type RunnerActionResult,
  type RunnerRedactor,
  type RunnerTerminalStatus,
} from './runners/runner.js';
import {
  InjectedCrashError,
  type Clock,
  type CrashInjector,
  type CrashPoint,
} from './state_store.js';

export class FakeClock implements Clock {
  #timeMs: number;

  constructor(initial = '2026-07-14T12:00:00.000Z') {
    const parsed = Date.parse(initial);
    if (!Number.isFinite(parsed)) throw new Error('FakeClock requires an ISO timestamp');
    this.#timeMs = parsed;
  }

  now(): string {
    return new Date(this.#timeMs).toISOString();
  }

  advanceMs(milliseconds: number): void {
    if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > 86_400_000) {
      throw new Error('FakeClock advance must be an integer from 0 through 86400000 milliseconds');
    }
    this.#timeMs += milliseconds;
  }
}

export interface RepositoryPort {
  observe(): Promise<RepositoryObservation>;
}

export class FakeRepository implements RepositoryPort {
  #observation: RepositoryObservation;
  observations = 0;
  externalCalls = 0;

  constructor(observation: unknown) {
    this.#observation = parseBoundary(RepositoryObservationSchema, observation, 'fake repository observation');
  }

  async observe(): Promise<RepositoryObservation> {
    this.observations++;
    return parseBoundary(
      RepositoryObservationSchema,
      structuredClone(this.#observation),
      'fake repository observation read'
    );
  }

  setObservation(observation: unknown): void {
    this.#observation = parseBoundary(RepositoryObservationSchema, observation, 'fake repository observation update');
  }
}

const RunnerResultSchema = z.strictObject({
  status: z.enum([
    'running',
    'completed',
    'interrupted',
    'timed_out',
    'stalled',
    'cancelled',
    'adapter_disconnected',
    'process_exited',
    'protocol_refused',
    'failed_before_first_turn',
    'failed',
  ]),
  summary: z.string().refine(value => Buffer.byteLength(value, 'utf8') <= 1_024, 'must not exceed 1024 UTF-8 bytes'),
});
const RunnerScriptSchema = z.array(RunnerResultSchema).max(MAX_COLLECTION_ITEMS);

export type RunnerPort = AgentRunner;

const FAKE_RUNNER_IDENTITY: RunnerAdapterIdentity = Object.freeze({
  adapter: 'fake-agent-runner',
  adapterVersion: 'fake-agent-runner:v1',
  protocolVersion: 'fake-runner-protocol:v1',
  executableVersion: 'none',
});

function fakeStableId(prefix: string, value: unknown): string {
  return `${prefix}:${sha256Canonical(value).slice(0, 32)}`;
}

function terminalEvent(status: RunnerTerminalStatus): Parameters<RunnerObservationBuffer['append']>[0] {
  const events = {
    completed: 'episode.completed',
    interrupted: 'episode.interrupted',
    timed_out: 'episode.timed_out',
    stalled: 'episode.stalled',
    cancelled: 'episode.cancelled',
    adapter_disconnected: 'adapter.disconnected',
    process_exited: 'process.exited',
    protocol_refused: 'protocol.refused',
    failed_before_first_turn: 'episode.failed_before_first_turn',
    failed: 'episode.failed',
  } as const;
  return events[status];
}

export class FakeRunner implements AgentRunner {
  readonly clock: Clock;
  readonly script: Array<z.infer<typeof RunnerResultSchema>>;
  readonly runnerId: string;
  readonly adapter = FAKE_RUNNER_IDENTITY;
  readonly redact: RunnerRedactor;
  starts = 0;
  resumes = 0;
  interruptions = 0;
  observations = 0;
  disposals = 0;
  modelCalls = 0;
  paidCalls = 0;
  processSpawns = 0;
  networkCalls = 0;
  #step = 0;
  #buffer: RunnerObservationBuffer | null = null;

  constructor(
    clock: Clock,
    script: unknown[] = [{ status: 'completed', summary: 'fake completion' }],
    options: { runnerId?: string; sensitiveValues?: readonly string[] } = {}
  ) {
    this.clock = clock;
    this.script = parseBoundary(RunnerScriptSchema, script, 'fake runner script');
    this.runnerId = options.runnerId ?? 'runner:fake';
    this.redact = createRunnerRedactor(options.sensitiveValues ?? []);
  }

  #nextResult(): z.infer<typeof RunnerResultSchema> {
    const result = this.script[this.#step];
    if (!result) throw new Error('Fake runner script exhausted');
    this.#step++;
    return result;
  }

  #newBuffer(correlation: unknown): RunnerObservationBuffer {
    if (this.#buffer !== null) throw new Error('fake runner instance already owns an episode attempt');
    const buffer = new RunnerObservationBuffer({
      adapter: this.adapter,
      clock: this.clock,
      redact: this.redact,
    });
    buffer.begin(correlation);
    this.#buffer = buffer;
    return buffer;
  }

  #finishScripted(buffer: RunnerObservationBuffer, result: z.infer<typeof RunnerResultSchema>): void {
    if (result.status === 'running') return;
    buffer.append(terminalEvent(result.status), { detail: result.summary });
  }

  async start(requestValue: unknown): Promise<RunnerLaunchResult> {
    const request = parseBoundary(RunnerStartRequestSchema, requestValue, 'fake runner start request');
    assertRunnerId(this.runnerId, request.runnerId);
    const result = this.#nextResult();
    this.starts++;
    const buffer = this.#newBuffer(correlationFromStart(request));
    const threadId = fakeStableId('thread', { episodeId: request.episodeId, runnerId: request.runnerId });
    const turnId = fakeStableId('turn', { requestId: request.requestId, attempt: this.#step });
    buffer.updateIdentifiers(threadId, null);
    buffer.append('episode.started', { detail: 'fake episode started' });
    buffer.updateIdentifiers(threadId, turnId);
    buffer.append('turn.started', { detail: 'fake turn started' });
    this.#finishScripted(buffer, result);
    return makeRunnerLaunchResult({
      status: 'started',
      correlation: buffer.correlation!,
      adapter: this.adapter,
      observedAt: this.clock.now(),
    });
  }

  async resume(requestValue: unknown): Promise<RunnerLaunchResult> {
    const request = parseBoundary(RunnerResumeRequestSchema, requestValue, 'fake runner resume request');
    assertRunnerId(this.runnerId, request.runnerId);
    const result = this.#nextResult();
    this.resumes++;
    const buffer = this.#newBuffer(correlationFromResume(request));
    buffer.append('episode.resumed', { detail: 'fake episode resumed' });
    const turnId = fakeStableId('turn', { requestId: request.requestId, attempt: this.#step });
    buffer.updateIdentifiers(request.threadId, turnId);
    buffer.append('turn.started', { detail: 'fake resumed turn started' });
    this.#finishScripted(buffer, result);
    return makeRunnerLaunchResult({
      status: 'started',
      correlation: buffer.correlation!,
      adapter: this.adapter,
      observedAt: this.clock.now(),
    });
  }

  async interrupt(requestValue: unknown): Promise<RunnerActionResult> {
    const request = parseBoundary(RunnerInterruptRequestSchema, requestValue, 'fake runner interrupt request');
    assertRunnerId(this.runnerId, request.correlation.runnerId);
    if (this.#buffer === null) throw new Error('fake runner has no active episode');
    if (
      this.#buffer.correlation === null
      || !sameRunnerCorrelation(this.#buffer.correlation, request.correlation)
    ) {
      throw new Error('fake runner action correlation does not match the active episode');
    }
    this.interruptions++;
    if (this.#buffer.terminal) {
      return makeRunnerActionResult({
        status: 'already_terminal',
        correlation: request.correlation,
        requestId: request.correlation.requestId,
        runnerId: this.runnerId,
        observedAt: this.clock.now(),
        detail: 'fake episode already terminal',
        redact: this.redact,
      });
    }
    const event = {
      operator: 'episode.interrupted',
      timeout: 'episode.timed_out',
      stall: 'episode.stalled',
      cancellation: 'episode.cancelled',
    } as const;
    this.#buffer.append(event[request.reason], { detail: `fake ${request.reason}` });
    return makeRunnerActionResult({
      status: 'acknowledged',
      correlation: request.correlation,
      requestId: request.correlation.requestId,
      runnerId: this.runnerId,
      observedAt: this.clock.now(),
      detail: 'fake interrupt acknowledged',
      redact: this.redact,
    });
  }

  async observe(requestValue: unknown): Promise<RunnerObserveResult> {
    const request = parseBoundary(RunnerObserveRequestSchema, requestValue, 'fake runner observe request');
    assertRunnerId(this.runnerId, request.correlation.runnerId);
    if (this.#buffer === null) throw new Error('fake runner has no active episode');
    this.observations++;
    return this.#buffer.read(request);
  }

  async dispose(requestValue: unknown): Promise<RunnerActionResult> {
    const request = parseBoundary(RunnerDisposeRequestSchema, requestValue, 'fake runner dispose request');
    assertRunnerId(this.runnerId, request.runnerId);
    this.disposals++;
    if (this.#buffer !== null && !this.#buffer.terminal) {
      this.#buffer.append('episode.cancelled', { detail: 'fake runner disposed before terminal completion' });
    }
    return makeRunnerActionResult({
      status: 'disposed',
      requestId: request.requestId,
      runnerId: this.runnerId,
      observedAt: this.clock.now(),
      detail: 'fake runner disposed',
      redact: this.redact,
    });
  }

  get report(): RunnerEpisodeReport | null {
    return this.#buffer?.report ?? null;
  }
}

export const EffectResultSchema = z.strictObject({
  status: z.enum(['succeeded', 'failed', 'unknown']),
  resultDigest: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  detail: z.string().max(1_024),
  reconciliationRequired: z.string().min(1).max(4_096).nullable(),
});

export type EffectResult = z.infer<typeof EffectResultSchema>;

export const EffectReconciliationSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('not_started') }),
  z.strictObject({ status: z.literal('known'), result: EffectResultSchema }),
  z.strictObject({
    status: z.literal('unknown'),
    reconciliationRequired: z.string().min(1).max(4_096),
  }),
]);

export type EffectReconciliation = z.infer<typeof EffectReconciliationSchema>;

export interface EffectPort {
  invoke(intent: EffectIntent): Promise<EffectResult>;
  reconcile(intent: EffectIntent): Promise<EffectReconciliation>;
}

export class FakeEffectTarget implements EffectPort {
  invocations = 0;
  requests = 0;
  reconciliations = 0;
  readonly completed = new Map<string, EffectResult>();
  readonly unknown = new Set<string>();
  #nextResult: EffectResult | null = null;

  setNextResult(result: unknown): void {
    this.#nextResult = parseBoundary(EffectResultSchema, result, 'fake effect result');
  }

  async invoke(intent: EffectIntent): Promise<EffectResult> {
    this.requests++;
    const previous = this.completed.get(intent.operationId);
    if (previous) return structuredClone(previous);
    if (this.unknown.has(intent.operationId)) {
      return {
        status: 'unknown',
        resultDigest: null,
        detail: 'fake target outcome remains unknown',
        reconciliationRequired: `reconcile:${intent.operationId}`,
      };
    }

    this.invocations++;
    const result = this.#nextResult ?? {
      status: 'succeeded',
      resultDigest: sha256Canonical({ operationId: intent.operationId, target: intent.target, scope: intent.exactScope }),
      detail: 'fake effect completed',
      reconciliationRequired: null,
    };
    this.#nextResult = null;
    if (result.status === 'unknown') this.unknown.add(intent.operationId);
    else this.completed.set(intent.operationId, result);
    return structuredClone(result);
  }

  async reconcile(intent: EffectIntent): Promise<EffectReconciliation> {
    this.reconciliations++;
    const completed = this.completed.get(intent.operationId);
    if (completed) return { status: 'known', result: structuredClone(completed) };
    if (this.unknown.has(intent.operationId)) {
      return { status: 'unknown', reconciliationRequired: `reconcile:${intent.operationId}` };
    }
    return { status: 'not_started' };
  }
}

export class FakeCrashInjector implements CrashInjector {
  readonly crashAt: CrashPoint | null;
  readonly hits: CrashPoint[] = [];
  #crashed = false;

  constructor(crashAt: CrashPoint | null) {
    this.crashAt = crashAt;
  }

  hit(point: CrashPoint): void {
    this.hits.push(point);
    if (!this.#crashed && point === this.crashAt) {
      this.#crashed = true;
      throw new InjectedCrashError(point);
    }
  }
}
