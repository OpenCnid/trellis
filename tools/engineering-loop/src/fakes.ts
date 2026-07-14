import { z } from 'zod';
import {
  DOMAIN_SCHEMA_VERSION,
  EvidenceSchema,
  MAX_COLLECTION_ITEMS,
  RepositoryObservationSchema,
  parseBoundary,
  type EffectIntent,
  type Evidence,
  type RepositoryObservation,
} from './domain.js';
import { sha256Canonical } from './events.js';
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

const RunnerRequestSchema = z.strictObject({
  workflowId: z.string().min(1).max(128),
  featureId: z.string().min(1).max(128),
  sessionId: z.string().min(1).max(128),
  episodeId: z.string().min(1).max(128),
  requestId: z.string().min(1).max(128),
});

const RunnerResultSchema = z.strictObject({
  status: z.enum(['completed', 'interrupted', 'failed']),
  summary: z.string().max(1_024),
});
const RunnerScriptSchema = z.array(RunnerResultSchema).max(MAX_COLLECTION_ITEMS);

export interface RunnerPort {
  start(request: unknown): Promise<Evidence>;
}

export class FakeRunner implements RunnerPort {
  readonly clock: Clock;
  readonly script: Array<z.infer<typeof RunnerResultSchema>>;
  starts = 0;
  modelCalls = 0;
  paidCalls = 0;
  processSpawns = 0;
  networkCalls = 0;

  constructor(clock: Clock, script: unknown[] = [{ status: 'completed', summary: 'fake completion' }]) {
    this.clock = clock;
    this.script = parseBoundary(RunnerScriptSchema, script, 'fake runner script');
  }

  async start(requestValue: unknown): Promise<Evidence> {
    const request = parseBoundary(RunnerRequestSchema, requestValue, 'fake runner request');
    const result = this.script[this.starts];
    if (!result) throw new Error('Fake runner script exhausted');
    this.starts++;
    const observedAt = this.clock.now();
    return parseBoundary(EvidenceSchema, {
      id: `evidence:runner:${request.requestId}`,
      schemaVersion: DOMAIN_SCHEMA_VERSION,
      createdAt: observedAt,
      workflowId: request.workflowId,
      featureId: request.featureId,
      sessionId: request.sessionId,
      origin: 'runner_reported',
      observedAt,
      digest: sha256Canonical({ request, result }),
      immutableReference: null,
      mediaType: 'application/vnd.trellis.fake-runner-observation+json',
      byteCount: Buffer.byteLength(JSON.stringify(result), 'utf8'),
      metadata: [
        { key: 'status', value: result.status },
        { key: 'episodeId', value: request.episodeId },
      ],
    }, 'fake runner evidence');
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
