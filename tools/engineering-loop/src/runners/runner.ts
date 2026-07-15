import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  MAX_ID_LENGTH,
  MAX_PATH_LENGTH,
  StableIdSchema,
  parseBoundary,
} from '../domain.js';
import { MAX_PROMPT_BYTES } from '../prompt_contracts.js';

export const RUNNER_SCHEMA_VERSION = 1 as const;
export const AGENT_RUNNER_CONTRACT_VERSION = 'trellis-agent-runner:v1' as const;
export const MAX_RUNNER_MESSAGE_BYTES = 256 * 1_024;
export const MAX_RUNNER_BUFFERED_EVENTS = 128;
export const MAX_RUNNER_PENDING_REQUESTS = 1;
export const MAX_RUNNER_OBSERVATION_DURATION_MS = 30_000;
export const MAX_RUNNER_INTERRUPTION_GRACE_MS = 10_000;
export const MAX_RUNNER_SHUTDOWN_MS = 10_000;
export const MAX_RUNNER_METADATA_BYTES = 1_024;
export const MAX_RUNNER_SENSITIVE_VALUES = 32;

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/, 'must be a lowercase sha256 digest');
const TimestampSchema = z.string().datetime({ offset: true });
const BoundedSequenceSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

function utf8String(maxBytes: number, options: { minBytes?: number; singleLine?: boolean } = {}) {
  const minBytes = options.minBytes ?? 1;
  return z.string().refine(value => {
    const bytes = Buffer.byteLength(value, 'utf8');
    return bytes >= minBytes && bytes <= maxBytes;
  }, `must use ${minBytes} through ${maxBytes} UTF-8 bytes`).refine(
    value => !(options.singleLine ?? true) || !/[\u0000-\u001f\u007f]/.test(value),
    'must be a single-line value without control characters'
  );
}

export const RunnerClockSchema = z.custom<RunnerClock>(value => (
  value !== null && typeof value === 'object' && typeof (value as RunnerClock).now === 'function'
));

export interface RunnerClock {
  now(): string;
}

export interface RunnerTimerScheduler {
  schedule(delayMs: number, callback: () => void): unknown;
  cancel(handle: unknown): void;
}

export interface RunnerCancellation {
  isCancelled(): boolean;
  subscribe(callback: () => void): () => void;
}

export class SystemRunnerTimerScheduler implements RunnerTimerScheduler {
  schedule(delayMs: number, callback: () => void): unknown {
    return setTimeout(callback, delayMs);
  }

  cancel(handle: unknown): void {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  }
}

export class NeverCancelledRunner implements RunnerCancellation {
  isCancelled(): boolean {
    return false;
  }

  subscribe(): () => void {
    return () => undefined;
  }
}

export const RunnerAdapterIdentitySchema = z.strictObject({
  adapter: utf8String(128),
  adapterVersion: utf8String(128),
  protocolVersion: utf8String(128),
  executableVersion: utf8String(128),
});

export type RunnerAdapterIdentity = z.infer<typeof RunnerAdapterIdentitySchema>;

export const RunnerCorrelationSchema = z.strictObject({
  workflowId: StableIdSchema,
  featureId: StableIdSchema,
  sessionId: StableIdSchema,
  episodeId: StableIdSchema,
  requestId: StableIdSchema,
  runnerId: StableIdSchema,
  threadId: StableIdSchema.nullable(),
  turnId: StableIdSchema.nullable(),
});

export type RunnerCorrelation = z.infer<typeof RunnerCorrelationSchema>;

const RUNNER_CORRELATION_KEYS = [
  'workflowId',
  'featureId',
  'sessionId',
  'episodeId',
  'requestId',
  'runnerId',
  'threadId',
  'turnId',
] as const;

export function sameRunnerCorrelation(left: RunnerCorrelation, right: RunnerCorrelation): boolean {
  return RUNNER_CORRELATION_KEYS.every(key => left[key] === right[key]);
}

function observationBelongsToCorrelation(
  correlation: RunnerCorrelation,
  observation: RunnerCorrelation
): boolean {
  return RUNNER_CORRELATION_KEYS.slice(0, 6).every(key => correlation[key] === observation[key])
    && (observation.threadId === null || observation.threadId === correlation.threadId)
    && (observation.turnId === null || observation.turnId === correlation.turnId);
}

export const RunnerPromptSchema = z.strictObject({
  packetVersion: utf8String(128),
  digest: DigestSchema,
  byteCount: z.number().int().positive().max(MAX_PROMPT_BYTES),
  text: utf8String(MAX_PROMPT_BYTES, { singleLine: false }),
}).superRefine((prompt, ctx) => {
  if (Buffer.byteLength(prompt.text, 'utf8') !== prompt.byteCount) {
    ctx.addIssue({ code: 'custom', path: ['byteCount'], message: 'must equal the engine-computed UTF-8 prompt bytes' });
  }
  if (createHash('sha256').update(prompt.text, 'utf8').digest('hex') !== prompt.digest) {
    ctx.addIssue({ code: 'custom', path: ['digest'], message: 'must equal the engine-computed prompt SHA-256 digest' });
  }
});

export type RunnerPrompt = z.infer<typeof RunnerPromptSchema>;

const RunnerAttemptBaseShape = {
  schemaVersion: z.literal(RUNNER_SCHEMA_VERSION),
  contractVersion: z.literal(AGENT_RUNNER_CONTRACT_VERSION),
  workflowId: StableIdSchema,
  featureId: StableIdSchema,
  sessionId: StableIdSchema,
  episodeId: StableIdSchema,
  requestId: StableIdSchema,
  runnerId: StableIdSchema,
  role: z.enum(['planner', 'implementer', 'checker', 'recovery']),
  prompt: RunnerPromptSchema,
  workingDirectory: utf8String(MAX_PATH_LENGTH),
  timeBudgetMs: z.number().int().positive().max(86_400_000),
  turnBudget: z.number().int().positive().max(1_000),
  contextBudgetTokens: z.number().int().positive().max(10_000_000),
};

export const RunnerStartRequestSchema = z.strictObject(RunnerAttemptBaseShape);
export type RunnerStartRequest = z.infer<typeof RunnerStartRequestSchema>;

export const RunnerResumeRequestSchema = z.strictObject({
  ...RunnerAttemptBaseShape,
  threadId: StableIdSchema,
});
export type RunnerResumeRequest = z.infer<typeof RunnerResumeRequestSchema>;

export const RunnerInterruptRequestSchema = z.strictObject({
  schemaVersion: z.literal(RUNNER_SCHEMA_VERSION),
  contractVersion: z.literal(AGENT_RUNNER_CONTRACT_VERSION),
  correlation: RunnerCorrelationSchema.superRefine((correlation, ctx) => {
    if (correlation.threadId === null || correlation.turnId === null) {
      ctx.addIssue({ code: 'custom', message: 'interrupt requires thread and turn identifiers' });
    }
  }),
  reason: z.enum(['operator', 'timeout', 'stall', 'cancellation']),
});
export type RunnerInterruptRequest = z.infer<typeof RunnerInterruptRequestSchema>;

export const RunnerObserveRequestSchema = z.strictObject({
  schemaVersion: z.literal(RUNNER_SCHEMA_VERSION),
  contractVersion: z.literal(AGENT_RUNNER_CONTRACT_VERSION),
  correlation: RunnerCorrelationSchema,
  afterSequence: BoundedSequenceSchema,
  maxEvents: z.number().int().positive().max(MAX_RUNNER_BUFFERED_EVENTS),
  durationMs: z.number().int().nonnegative().max(MAX_RUNNER_OBSERVATION_DURATION_MS),
});
export type RunnerObserveRequest = z.infer<typeof RunnerObserveRequestSchema>;

export const RunnerDisposeRequestSchema = z.strictObject({
  schemaVersion: z.literal(RUNNER_SCHEMA_VERSION),
  contractVersion: z.literal(AGENT_RUNNER_CONTRACT_VERSION),
  requestId: StableIdSchema,
  runnerId: StableIdSchema,
});
export type RunnerDisposeRequest = z.infer<typeof RunnerDisposeRequestSchema>;

export const RUNNER_TERMINAL_STATUSES = [
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
] as const;
export const RunnerTerminalStatusSchema = z.enum(RUNNER_TERMINAL_STATUSES);
export type RunnerTerminalStatus = z.infer<typeof RunnerTerminalStatusSchema>;

export const RUNNER_EVENT_TYPES = [
  'episode.started',
  'episode.resumed',
  'turn.started',
  'episode.completed',
  'episode.interrupted',
  'episode.timed_out',
  'episode.stalled',
  'episode.cancelled',
  'adapter.disconnected',
  'process.exited',
  'protocol.refused',
  'episode.failed_before_first_turn',
  'episode.failed',
] as const;
export const RunnerEventTypeSchema = z.enum(RUNNER_EVENT_TYPES);
export type RunnerEventType = z.infer<typeof RunnerEventTypeSchema>;

const TERMINAL_EVENT_TYPES = new Set<RunnerEventType>([
  'episode.completed',
  'episode.interrupted',
  'episode.timed_out',
  'episode.stalled',
  'episode.cancelled',
  'adapter.disconnected',
  'process.exited',
  'protocol.refused',
  'episode.failed_before_first_turn',
  'episode.failed',
]);

export const RunnerObservationMetadataSchema = z.strictObject({
  status: z.enum(['started', 'running', ...RUNNER_TERMINAL_STATUSES]),
  detail: utf8String(MAX_RUNNER_METADATA_BYTES, { minBytes: 0, singleLine: false }),
  adapterVersion: utf8String(128),
  protocolVersion: utf8String(128),
  executableVersion: utf8String(128),
  redactionCount: z.number().int().nonnegative().max(10_000),
  observedBytes: z.number().int().nonnegative().max(MAX_RUNNER_MESSAGE_BYTES + 1).nullable(),
  exitCode: z.number().int().min(-2_147_483_648).max(2_147_483_647).nullable(),
  signal: utf8String(64, { minBytes: 0 }).nullable(),
});

export type RunnerObservationMetadata = z.infer<typeof RunnerObservationMetadataSchema>;

export const RunnerLifecycleObservationSchema = z.strictObject({
  schemaVersion: z.literal(RUNNER_SCHEMA_VERSION),
  contractVersion: z.literal(AGENT_RUNNER_CONTRACT_VERSION),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  timestamp: TimestampSchema,
  workflowId: StableIdSchema,
  featureId: StableIdSchema,
  sessionId: StableIdSchema,
  episodeId: StableIdSchema,
  requestId: StableIdSchema,
  runnerId: StableIdSchema,
  threadId: StableIdSchema.nullable(),
  turnId: StableIdSchema.nullable(),
  eventType: RunnerEventTypeSchema,
  actor: z.literal('runner'),
  terminal: z.boolean(),
  metadata: RunnerObservationMetadataSchema,
}).superRefine((observation, ctx) => {
  if (observation.terminal !== TERMINAL_EVENT_TYPES.has(observation.eventType)) {
    ctx.addIssue({ code: 'custom', path: ['terminal'], message: 'must agree with the lifecycle event type' });
  }
  const terminalStatus = RunnerTerminalStatusSchema.safeParse(observation.metadata.status).success;
  if (observation.terminal !== terminalStatus) {
    ctx.addIssue({ code: 'custom', path: ['metadata', 'status'], message: 'must agree with terminal state' });
  }
});

export type RunnerLifecycleObservation = z.infer<typeof RunnerLifecycleObservationSchema>;

export const RunnerEpisodeReportSchema = z.strictObject({
  schemaVersion: z.literal(RUNNER_SCHEMA_VERSION),
  contractVersion: z.literal(AGENT_RUNNER_CONTRACT_VERSION),
  correlation: RunnerCorrelationSchema,
  adapter: RunnerAdapterIdentitySchema,
  startedAt: TimestampSchema,
  endedAt: TimestampSchema,
  terminalStatus: RunnerTerminalStatusSchema,
  terminalSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  eventCount: z.number().int().positive().max(MAX_RUNNER_BUFFERED_EVENTS),
  summary: utf8String(MAX_RUNNER_METADATA_BYTES, { singleLine: false }),
  redactionCount: z.number().int().nonnegative().max(10_000),
});

export type RunnerEpisodeReport = z.infer<typeof RunnerEpisodeReportSchema>;

export const RunnerLaunchResultSchema = z.strictObject({
  schemaVersion: z.literal(RUNNER_SCHEMA_VERSION),
  contractVersion: z.literal(AGENT_RUNNER_CONTRACT_VERSION),
  status: z.enum(['started', 'refused']),
  correlation: RunnerCorrelationSchema,
  adapter: RunnerAdapterIdentitySchema,
  observedAt: TimestampSchema,
  refusal: utf8String(MAX_RUNNER_METADATA_BYTES, { singleLine: false }).nullable(),
}).superRefine((result, ctx) => {
  if (result.status === 'started' && (result.correlation.threadId === null || result.correlation.turnId === null)) {
    ctx.addIssue({ code: 'custom', path: ['correlation'], message: 'started result requires thread and turn identifiers' });
  }
  if ((result.status === 'refused') !== (result.refusal !== null)) {
    ctx.addIssue({ code: 'custom', path: ['refusal'], message: 'must be present only for refusal' });
  }
});

export type RunnerLaunchResult = z.infer<typeof RunnerLaunchResultSchema>;

export const RunnerActionResultSchema = z.strictObject({
  schemaVersion: z.literal(RUNNER_SCHEMA_VERSION),
  contractVersion: z.literal(AGENT_RUNNER_CONTRACT_VERSION),
  status: z.enum(['acknowledged', 'already_terminal', 'disposed', 'refused']),
  correlation: RunnerCorrelationSchema.nullable(),
  requestId: StableIdSchema,
  runnerId: StableIdSchema,
  observedAt: TimestampSchema,
  detail: utf8String(MAX_RUNNER_METADATA_BYTES, { minBytes: 0, singleLine: false }),
}).superRefine((result, ctx) => {
  if (result.correlation !== null && result.requestId !== result.correlation.requestId) {
    ctx.addIssue({ code: 'custom', path: ['requestId'], message: 'must match the correlated request identifier' });
  }
  if (result.correlation !== null && result.runnerId !== result.correlation.runnerId) {
    ctx.addIssue({ code: 'custom', path: ['runnerId'], message: 'must match the correlated runner identifier' });
  }
});

export type RunnerActionResult = z.infer<typeof RunnerActionResultSchema>;

export const RunnerObserveResultSchema = z.strictObject({
  schemaVersion: z.literal(RUNNER_SCHEMA_VERSION),
  contractVersion: z.literal(AGENT_RUNNER_CONTRACT_VERSION),
  correlation: RunnerCorrelationSchema,
  observations: z.array(RunnerLifecycleObservationSchema).max(MAX_RUNNER_BUFFERED_EVENTS),
  nextSequence: BoundedSequenceSchema,
  terminal: z.boolean(),
  report: RunnerEpisodeReportSchema.nullable(),
}).superRefine((result, ctx) => {
  if (result.terminal !== (result.report !== null)) {
    ctx.addIssue({ code: 'custom', path: ['report'], message: 'must be present exactly when the episode is terminal' });
  }
  if (result.report !== null && !sameRunnerCorrelation(result.correlation, result.report.correlation)) {
    ctx.addIssue({ code: 'custom', path: ['report', 'correlation'], message: 'must match the observation-result correlation' });
  }
  for (let index = 0; index < result.observations.length; index++) {
    const observation = result.observations[index]!;
    if (!observationBelongsToCorrelation(result.correlation, observation)) {
      ctx.addIssue({ code: 'custom', path: ['observations', index], message: 'correlation must match the observation result' });
    }
  }
  for (let index = 1; index < result.observations.length; index++) {
    if (result.observations[index]!.sequence !== result.observations[index - 1]!.sequence + 1) {
      ctx.addIssue({ code: 'custom', path: ['observations', index, 'sequence'], message: 'observations must be contiguous and ordered' });
    }
  }
});

export type RunnerObserveResult = z.infer<typeof RunnerObserveResultSchema>;

export interface AgentRunner {
  start(request: unknown): Promise<RunnerLaunchResult>;
  resume(request: unknown): Promise<RunnerLaunchResult>;
  interrupt(request: unknown): Promise<RunnerActionResult>;
  observe(request: unknown): Promise<RunnerObserveResult>;
  dispose(request: unknown): Promise<RunnerActionResult>;
}

export const RunnerSensitiveValuesSchema = z.array(utf8String(MAX_RUNNER_METADATA_BYTES))
  .max(MAX_RUNNER_SENSITIVE_VALUES)
  .superRefine((values, ctx) => {
    if (new Set(values).size !== values.length) {
      ctx.addIssue({ code: 'custom', message: 'sensitive values must be unique' });
    }
  });

export interface RedactedText {
  text: string;
  count: number;
}

export type RunnerRedactor = (value: string) => RedactedText;

export function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= maxBytes) return value;
  for (let end = maxBytes; end >= 0; end--) {
    const candidate = bytes.subarray(0, end).toString('utf8');
    if (!candidate.endsWith('\uFFFD') && Buffer.byteLength(candidate, 'utf8') <= maxBytes) return candidate;
  }
  return '';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createRunnerRedactor(sensitiveValuesValue: unknown = []): RunnerRedactor {
  const sensitiveValues = parseBoundary(
    RunnerSensitiveValuesSchema,
    sensitiveValuesValue,
    'runner sensitive values'
  ).sort((left, right) => right.length - left.length);
  const configuredPatterns = sensitiveValues.map(value => new RegExp(escapeRegExp(value), 'gu'));
  const genericPatterns = [
    /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/giu,
    /\b(?:api[_-]?key|approval|password|secret|token)\s*[:=]\s*[^\s,;]+/giu,
  ];
  return value => {
    let text = value;
    let count = 0;
    for (const pattern of [...configuredPatterns, ...genericPatterns]) {
      text = text.replace(pattern, () => {
        count++;
        return '[REDACTED]';
      });
    }
    return { text, count };
  };
}

const EVENT_STATUS: Readonly<Record<RunnerEventType, RunnerObservationMetadata['status']>> = {
  'episode.started': 'started',
  'episode.resumed': 'started',
  'turn.started': 'running',
  'episode.completed': 'completed',
  'episode.interrupted': 'interrupted',
  'episode.timed_out': 'timed_out',
  'episode.stalled': 'stalled',
  'episode.cancelled': 'cancelled',
  'adapter.disconnected': 'adapter_disconnected',
  'process.exited': 'process_exited',
  'protocol.refused': 'protocol_refused',
  'episode.failed_before_first_turn': 'failed_before_first_turn',
  'episode.failed': 'failed',
};

export interface AppendObservationOptions {
  detail?: string;
  observedBytes?: number | null;
  exitCode?: number | null;
  signal?: string | null;
}

export class RunnerObservationBuffer {
  readonly adapter: RunnerAdapterIdentity;
  readonly clock: RunnerClock;
  readonly maxEvents: number;
  readonly redact: RunnerRedactor;
  #correlation: RunnerCorrelation | null = null;
  #events: RunnerLifecycleObservation[] = [];
  #report: RunnerEpisodeReport | null = null;
  #startedAt: string | null = null;
  #redactionCount = 0;
  #listeners = new Set<() => void>();

  constructor(options: {
    adapter: unknown;
    clock: RunnerClock;
    maxEvents?: number;
    redact?: RunnerRedactor;
  }) {
    this.adapter = parseBoundary(RunnerAdapterIdentitySchema, options.adapter, 'runner adapter identity');
    this.clock = options.clock;
    this.maxEvents = z.number().int().min(4).max(MAX_RUNNER_BUFFERED_EVENTS)
      .parse(options.maxEvents ?? MAX_RUNNER_BUFFERED_EVENTS);
    this.redact = options.redact ?? createRunnerRedactor();
  }

  get correlation(): RunnerCorrelation | null {
    return this.#correlation === null ? null : structuredClone(this.#correlation);
  }

  get terminal(): boolean {
    return this.#report !== null;
  }

  get report(): RunnerEpisodeReport | null {
    return this.#report === null ? null : structuredClone(this.#report);
  }

  begin(correlationValue: unknown): void {
    if (this.#correlation !== null) throw new Error('runner observation buffer already has an episode');
    this.#correlation = parseBoundary(RunnerCorrelationSchema, correlationValue, 'runner episode correlation');
  }

  updateIdentifiers(threadId: string | null, turnId: string | null): void {
    if (this.#correlation === null) throw new Error('runner observation buffer has no episode');
    this.#correlation = parseBoundary(RunnerCorrelationSchema, {
      ...this.#correlation,
      threadId,
      turnId,
    }, 'runner correlation update');
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  append(eventTypeValue: unknown, options: AppendObservationOptions = {}): RunnerLifecycleObservation {
    const eventType = parseBoundary(RunnerEventTypeSchema, eventTypeValue, 'runner event type');
    if (this.#correlation === null) throw new Error('runner observation buffer has no episode');
    if (this.#report !== null) return structuredClone(this.#events[this.#events.length - 1]!);
    const terminal = TERMINAL_EVENT_TYPES.has(eventType);
    if (!terminal && this.#events.length >= this.maxEvents - 1) {
      return this.append('protocol.refused', {
        detail: `runner event buffer exceeded its reserved terminal capacity of ${this.maxEvents}`,
        observedBytes: null,
      });
    }
    if (terminal && this.#events.length >= this.maxEvents) {
      throw new Error('runner event buffer cannot append its required terminal observation');
    }
    const observedAt = this.clock.now();
    TimestampSchema.parse(observedAt);
    this.#startedAt ??= observedAt;
    const redacted = this.redact(options.detail ?? '');
    this.#redactionCount += redacted.count;
    const observation = parseBoundary(RunnerLifecycleObservationSchema, {
      schemaVersion: RUNNER_SCHEMA_VERSION,
      contractVersion: AGENT_RUNNER_CONTRACT_VERSION,
      sequence: this.#events.length + 1,
      timestamp: observedAt,
      ...this.#correlation,
      eventType,
      actor: 'runner',
      terminal,
      metadata: {
        status: EVENT_STATUS[eventType],
        detail: truncateUtf8(redacted.text, MAX_RUNNER_METADATA_BYTES),
        adapterVersion: this.adapter.adapterVersion,
        protocolVersion: this.adapter.protocolVersion,
        executableVersion: this.adapter.executableVersion,
        redactionCount: redacted.count,
        observedBytes: options.observedBytes == null
          ? null
          : Math.min(options.observedBytes, MAX_RUNNER_MESSAGE_BYTES + 1),
        exitCode: options.exitCode ?? null,
        signal: options.signal == null ? null : truncateUtf8(options.signal, 64),
      },
    }, 'runner lifecycle observation');
    this.#events.push(observation);
    if (terminal) {
      const summary = redacted.text.length > 0 ? redacted.text : EVENT_STATUS[eventType];
      this.#report = parseBoundary(RunnerEpisodeReportSchema, {
        schemaVersion: RUNNER_SCHEMA_VERSION,
        contractVersion: AGENT_RUNNER_CONTRACT_VERSION,
        correlation: this.#correlation,
        adapter: this.adapter,
        startedAt: this.#startedAt,
        endedAt: observedAt,
        terminalStatus: EVENT_STATUS[eventType],
        terminalSequence: observation.sequence,
        eventCount: this.#events.length,
        summary: truncateUtf8(summary, MAX_RUNNER_METADATA_BYTES),
        redactionCount: this.#redactionCount,
      }, 'runner episode report');
    }
    for (const listener of [...this.#listeners]) listener();
    return structuredClone(observation);
  }

  read(requestValue: unknown): RunnerObserveResult {
    const request = parseBoundary(RunnerObserveRequestSchema, requestValue, 'runner observation request');
    if (this.#correlation === null) throw new Error('runner observation buffer has no episode');
    for (const key of ['workflowId', 'featureId', 'sessionId', 'episodeId', 'requestId', 'runnerId'] as const) {
      if (request.correlation[key] !== this.#correlation[key]) {
        throw new Error(`runner observation request ${key} does not match the active episode`);
      }
    }
    if (
      request.correlation.threadId !== null
      && request.correlation.threadId !== this.#correlation.threadId
    ) {
      throw new Error('runner observation request threadId does not match the active episode');
    }
    if (request.correlation.turnId !== null && request.correlation.turnId !== this.#correlation.turnId) {
      throw new Error('runner observation request turnId does not match the active episode');
    }
    const lastSequence = this.#events.at(-1)?.sequence ?? 0;
    if (request.afterSequence > lastSequence) {
      throw new Error('runner observation request sequence is beyond the bounded event tail');
    }
    const observations = this.#events
      .filter(item => item.sequence > request.afterSequence)
      .slice(0, request.maxEvents)
      .map(item => structuredClone(item));
    const nextSequence = observations.at(-1)?.sequence ?? request.afterSequence;
    return parseBoundary(RunnerObserveResultSchema, {
      schemaVersion: RUNNER_SCHEMA_VERSION,
      contractVersion: AGENT_RUNNER_CONTRACT_VERSION,
      correlation: this.#correlation,
      observations,
      nextSequence,
      terminal: this.#report !== null,
      report: this.#report,
    }, 'runner observation result');
  }
}

export function correlationFromStart(request: RunnerStartRequest): RunnerCorrelation {
  return parseBoundary(RunnerCorrelationSchema, {
    workflowId: request.workflowId,
    featureId: request.featureId,
    sessionId: request.sessionId,
    episodeId: request.episodeId,
    requestId: request.requestId,
    runnerId: request.runnerId,
    threadId: null,
    turnId: null,
  }, 'runner start correlation');
}

export function correlationFromResume(request: RunnerResumeRequest): RunnerCorrelation {
  return parseBoundary(RunnerCorrelationSchema, {
    workflowId: request.workflowId,
    featureId: request.featureId,
    sessionId: request.sessionId,
    episodeId: request.episodeId,
    requestId: request.requestId,
    runnerId: request.runnerId,
    threadId: request.threadId,
    turnId: null,
  }, 'runner resume correlation');
}

export function makeRunnerLaunchResult(input: {
  status: 'started' | 'refused';
  correlation: RunnerCorrelation;
  adapter: RunnerAdapterIdentity;
  observedAt: string;
  refusal?: string | null;
}): RunnerLaunchResult {
  return parseBoundary(RunnerLaunchResultSchema, {
    schemaVersion: RUNNER_SCHEMA_VERSION,
    contractVersion: AGENT_RUNNER_CONTRACT_VERSION,
    status: input.status,
    correlation: input.correlation,
    adapter: input.adapter,
    observedAt: input.observedAt,
    refusal: input.refusal ?? null,
  }, 'runner launch result');
}

export function makeRunnerActionResult(input: {
  status: RunnerActionResult['status'];
  correlation?: RunnerCorrelation | null;
  requestId: string;
  runnerId: string;
  observedAt: string;
  detail?: string;
  redact?: RunnerRedactor;
}): RunnerActionResult {
  const redacted = (input.redact ?? createRunnerRedactor())(input.detail ?? '');
  return parseBoundary(RunnerActionResultSchema, {
    schemaVersion: RUNNER_SCHEMA_VERSION,
    contractVersion: AGENT_RUNNER_CONTRACT_VERSION,
    status: input.status,
    correlation: input.correlation ?? null,
    requestId: input.requestId,
    runnerId: input.runnerId,
    observedAt: input.observedAt,
    detail: truncateUtf8(redacted.text, MAX_RUNNER_METADATA_BYTES),
  }, 'runner action result');
}

export function assertRunnerId(expected: string, observed: string): void {
  if (expected.length > MAX_ID_LENGTH || expected !== observed) {
    throw new Error('runner request identifier does not match the configured runner');
  }
}
