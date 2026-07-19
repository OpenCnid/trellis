/**
 * The judge-intake write-once record store: ratifications and
 * pre-registrations.
 *
 * Normative specification:
 *   docs/product/epistemic-support/JUDGE_INTAKE_DESIGN.md §3.3, under
 *   JUDGE_COMPOSITION_GAME.md §6 rules 11 and 20 (binding program law,
 *   ratified July 18, 2026 — cited by number, never restated).
 *
 * Two record kinds share this module because they share every property
 * that matters: write-once, timestamped, audit-readable. A second write
 * per key refuses and the first record survives; supersession is a new
 * record referencing the old, never an overwrite. The store records
 * run-open events, and a pre-registration arriving after its run opened
 * refuses, typed — a forecast made after the run is not a forecast.
 *
 * STRUCTURAL INVARIANT (rule 11, drill-pinned in both directions): this
 * module imports NO repository module — not `judge_panel.ts`, not
 * `judge_intake_prompt.ts`, not `judge_intake.ts` — so no forecast can
 * share bytes with any composed prompt, and `judge_audit.ts` may read
 * the store (rule 20) without transitively touching a gating surface.
 * `judge_intake_prompt.ts` imports nothing from here (drill-pinned).
 */

import { createHash } from 'crypto';
import { z } from 'zod';

/**
 * Claim modes, re-declared verbatim from RECONCILIATION §2 rather than
 * imported from `judge_panel.ts` — this store must import no gating
 * surface (see the module invariant above). Equality with the panel's
 * `ClaimMode` is compile-time-pinned in `judge_intake.test.ts`.
 */
export const CLAIM_MODES = ['fact', 'inference', 'prediction', 'value', 'belief', 'experience'] as const;
export type PreregClaimMode = (typeof CLAIM_MODES)[number];

// ---------------------------------------------------------------------------
// Record schemas (Zod boundaries, fail-closed)
// ---------------------------------------------------------------------------

const ratificationSchema = z.strictObject({
  selectionId: z.string().min(1),
  /** Chosen by the USER at confirmation, never inferred (record §3.1). */
  claimMode: z.enum(CLAIM_MODES),
  confirmedAtMs: z.number().finite(),
});

export type RatificationRecord = z.infer<typeof ratificationSchema>;

const expectationSchema = z
  .strictObject({
    itemId: z.string().min(1),
    expectedVerdict: z.enum(['drawback', 'clean', 'abstain']),
    expectedDrawbackClass: z.string().min(1).optional(),
    rationale: z.string().min(1),
  })
  .refine((e) => e.expectedDrawbackClass === undefined || e.expectedVerdict === 'drawback', {
    message: 'expectedDrawbackClass is drawback-forecast-only',
    path: ['expectedDrawbackClass'],
  });

export type Expectation = z.infer<typeof expectationSchema>;

const preRegistrationInputSchema = z.strictObject({
  registrationId: z.string().min(1),
  runId: z.string().min(1),
  registeredAtMs: z.number().finite(),
  /** A forecast with zero expectations is not a forecast. */
  expectations: z.array(expectationSchema).min(1),
  /** Supersession references the superseded record; it never overwrites it. */
  supersedes: z.string().min(1).optional(),
});

export interface PreRegistrationRecord extends z.infer<typeof preRegistrationInputSchema> {
  /** Engine-computed over the canonical expectations bytes — never caller-supplied. */
  contentHash: string;
}

const runOpenSchema = z.strictObject({
  runId: z.string().min(1),
  openedAtMs: z.number().finite(),
});

export type RunOpenRecord = z.infer<typeof runOpenSchema>;

// ---------------------------------------------------------------------------
// Typed refusals
// ---------------------------------------------------------------------------

export class PreregSchemaError extends Error {}

export class DuplicateRecordError extends Error {
  constructor(public readonly kind: 'ratification' | 'pre_registration' | 'run_open', public readonly key: string) {
    super(
      `Write refused: ${kind} record for key "${key}" already exists — the store is write-once and the ` +
      `first record survives. Supersession is a new record referencing the old, never an overwrite.`
    );
  }
}

export class LateRegistrationError extends Error {
  constructor(public readonly registrationId: string, public readonly runId: string) {
    super(
      `Registration "${registrationId}" refused: run "${runId}" is already open — a forecast made ` +
      `after the run is not a forecast (rule 20).`
    );
  }
}

// ---------------------------------------------------------------------------
// The store (pure, functional; no database, queue, network, or clock access)
// ---------------------------------------------------------------------------

export interface PreregStore {
  readonly ratifications: ReadonlyMap<string, RatificationRecord>;
  readonly preRegistrations: ReadonlyMap<string, PreRegistrationRecord>;
  readonly runOpens: ReadonlyMap<string, RunOpenRecord>;
}

export function emptyPreregStore(): PreregStore {
  return { ratifications: new Map(), preRegistrations: new Map(), runOpens: new Map() };
}

function parseWith<T>(schema: z.ZodType<T>, raw: unknown, kind: string): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join('.') || kind;
    throw new PreregSchemaError(`${kind} record refused at "${path}": ${issue?.message}.`);
  }
  return parsed.data;
}

/** Canonical bytes for hashing: expectations serialized with sorted keys. */
function canonicalExpectationBytes(expectations: readonly Expectation[]): string {
  return JSON.stringify(
    expectations.map((e) => {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(e).sort()) sorted[key] = (e as Record<string, unknown>)[key];
      return sorted;
    })
  );
}

export function recordRatification(store: PreregStore, raw: unknown): PreregStore {
  const record = parseWith(ratificationSchema, raw, 'Ratification');
  if (store.ratifications.has(record.selectionId)) {
    throw new DuplicateRecordError('ratification', record.selectionId);
  }
  const ratifications = new Map(store.ratifications);
  ratifications.set(record.selectionId, record);
  return { ...store, ratifications };
}

export function openRun(store: PreregStore, raw: unknown): PreregStore {
  const record = parseWith(runOpenSchema, raw, 'Run-open');
  if (store.runOpens.has(record.runId)) {
    throw new DuplicateRecordError('run_open', record.runId);
  }
  const runOpens = new Map(store.runOpens);
  runOpens.set(record.runId, record);
  return { ...store, runOpens };
}

/**
 * Rule 20 enforcement: the refusal keys off the recorded run-open EVENT,
 * not the registration's claimed timestamp — arrival order in the store
 * is what the store actually knows, so a backdated timestamp cannot
 * smuggle a post-run forecast past the gate.
 */
export function recordPreRegistration(store: PreregStore, raw: unknown): PreregStore {
  const input = parseWith(preRegistrationInputSchema, raw, 'Pre-registration');
  if (store.preRegistrations.has(input.registrationId)) {
    throw new DuplicateRecordError('pre_registration', input.registrationId);
  }
  if (store.runOpens.has(input.runId)) {
    throw new LateRegistrationError(input.registrationId, input.runId);
  }
  if (input.supersedes !== undefined && !store.preRegistrations.has(input.supersedes)) {
    throw new PreregSchemaError(
      `Pre-registration "${input.registrationId}" refused: supersedes unknown record "${input.supersedes}" — ` +
      `supersession must reference an existing record.`
    );
  }
  const record: PreRegistrationRecord = {
    ...input,
    contentHash: createHash('sha256').update(canonicalExpectationBytes(input.expectations), 'utf8').digest('hex'),
  };
  const preRegistrations = new Map(store.preRegistrations);
  preRegistrations.set(record.registrationId, record);
  return { ...store, preRegistrations };
}

// ---------------------------------------------------------------------------
// Read surface (the audit seat's path, rule 20; intake reads ratifications)
// ---------------------------------------------------------------------------

export function getRatification(store: PreregStore, selectionId: string): RatificationRecord | undefined {
  return store.ratifications.get(selectionId);
}

export function getPreRegistration(store: PreregStore, registrationId: string): PreRegistrationRecord | undefined {
  return store.preRegistrations.get(registrationId);
}

export function getRunOpen(store: PreregStore, runId: string): RunOpenRecord | undefined {
  return store.runOpens.get(runId);
}
