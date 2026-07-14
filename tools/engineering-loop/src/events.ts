import { createHash } from 'node:crypto';
import {
  DOMAIN_SCHEMA_VERSION,
  EventPayloadSchema,
  EventSchema,
  GENESIS_DIGEST,
  parseBoundary,
  type ActorAuthority,
  type DomainEvent,
  type EventPayload,
  type StateSnapshot,
} from './domain.js';

export class EventIntegrityError extends Error {
  constructor(message: string) {
    super(message.slice(0, 1_024));
    this.name = 'EventIntegrityError';
  }
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new EventIntegrityError('Canonical JSON refuses non-finite numbers');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record).sort().map(key => {
        if (record[key] === undefined) throw new EventIntegrityError(`Canonical JSON refuses undefined at '${key}'`);
        return [key, canonicalize(record[key])];
      })
    );
  }
  throw new EventIntegrityError(`Canonical JSON refuses ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function payloadBindings(payload: EventPayload) {
  if (payload.kind === 'transition') return payload.decision;
  if (payload.kind === 'effect_intent') return payload.intent;
  return payload.outcome;
}

export function createDomainEvent(input: {
  current: StateSnapshot | null;
  payload: unknown;
  actor: ActorAuthority;
  createdAt: string;
}): DomainEvent {
  const payload = parseBoundary(EventPayloadSchema, input.payload, 'event payload');
  const bindings = payloadBindings(payload);
  const sequence = (input.current?.lastEventSequence ?? 0) + 1;
  const previousDigest = input.current?.lastEventDigest ?? GENESIS_DIGEST;
  const material = {
    id: `event:${bindings.sessionId}:${sequence}`,
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    createdAt: input.createdAt,
    workflowId: bindings.workflowId,
    featureId: bindings.featureId,
    sessionId: bindings.sessionId,
    sequence,
    previousDigest,
    actor: input.actor,
    eventType: payload.kind,
    payload,
  };
  return parseBoundary(
    EventSchema,
    { ...material, digest: sha256Canonical(material) },
    'event write'
  );
}

export function verifyDomainEvent(
  value: unknown,
  expectedSequence: number,
  expectedPreviousDigest: string
): DomainEvent {
  const event = parseBoundary(EventSchema, value, 'event read');
  if (event.sequence !== expectedSequence) {
    throw new EventIntegrityError(
      `Event sequence mismatch: expected ${expectedSequence}, observed ${event.sequence}`
    );
  }
  if (event.previousDigest !== expectedPreviousDigest) {
    throw new EventIntegrityError(
      `Event previous digest mismatch at sequence ${event.sequence}`
    );
  }
  const { digest, ...material } = event;
  const computed = sha256Canonical(material);
  if (digest !== computed) {
    throw new EventIntegrityError(`Event digest mismatch at sequence ${event.sequence}`);
  }
  return event;
}

export function serializeEvent(event: DomainEvent): string {
  return `${canonicalJson(parseBoundary(EventSchema, event, 'event serialization'))}\n`;
}
