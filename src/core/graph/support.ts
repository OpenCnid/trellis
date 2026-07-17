/**
 * Epistemic-support opinion arithmetic (v1).
 *
 * Normative specification: docs/architecture/EPISTEMIC_SUPPORT.md §3.
 * This module is deliberately pure — no database, queue, network, or
 * clock access — and has exactly one caller today: the zero-paid
 * oracle drill (`npm run test:support-oracle`). Production
 * reachability (a `support_sweep` job) is a separately gated feature.
 *
 * The event type carries no confidence field on purpose: writer
 * confidence is structurally excluded from the computation (the
 * poisoning drill wrote poison at confidence 0.97). Unknown fields on
 * input records are ignored by construction — only declared fields are
 * ever read.
 */

export type SupportVerdict = 'drawback' | 'clean' | 'abstain';

export interface SupportEvent {
  beliefId: string;
  opId: string;
  verdict: SupportVerdict;
  atMs: number;
  weight: number;
}

export interface SupportParams {
  /** Prior (uncommitted) evidence weight W; v1 default 2. */
  priorWeight: number;
  /** Base rate a for the projected scalar; v1 default 0.5. */
  baseRate: number;
  /** Evidence half-life in milliseconds. */
  halfLifeMs: number;
}

export interface SupportOpinion {
  b: number;
  d: number;
  u: number;
  projected: number;
  /** Counts-only telemetry (T16): abstains reach the opinion only by omission. */
  events: { clean: number; drawback: number; abstain: number };
}

export const SUPPORT_PARAMS_V1: SupportParams = {
  priorWeight: 2,
  baseRate: 0.5,
  halfLifeMs: 30 * 24 * 60 * 60 * 1000,
};

const VERDICTS: ReadonlySet<string> = new Set(['drawback', 'clean', 'abstain']);

export class SupportInputError extends Error {}

function validateEvent(e: SupportEvent, asOfMs: number): void {
  if (typeof e.beliefId !== 'string' || e.beliefId.length === 0) {
    throw new SupportInputError('Support event requires a non-empty beliefId.');
  }
  if (typeof e.opId !== 'string' || e.opId.length === 0) {
    throw new SupportInputError(`Support event for "${e.beliefId}" requires a non-empty opId.`);
  }
  if (!VERDICTS.has(e.verdict)) {
    throw new SupportInputError(
      `Support event ${e.beliefId}/${e.opId} carries unknown verdict "${String(e.verdict)}".`
    );
  }
  if (!Number.isFinite(e.atMs)) {
    throw new SupportInputError(`Support event ${e.beliefId}/${e.opId} has a non-finite atMs.`);
  }
  if (e.atMs > asOfMs) {
    // Future evidence is a fixture/caller error, never silently zero-weighted.
    throw new SupportInputError(
      `Support event ${e.beliefId}/${e.opId} is dated after asOf (${e.atMs} > ${asOfMs}).`
    );
  }
  if (!Number.isFinite(e.weight) || e.weight < 0) {
    throw new SupportInputError(`Support event ${e.beliefId}/${e.opId} has an invalid weight.`);
  }
}

/** Canonical accumulation order: (beliefId, opId, atMs, verdict) ascending. */
export function canonicalizeEvents(events: readonly SupportEvent[]): SupportEvent[] {
  return [...events].sort((a, b) =>
    a.beliefId < b.beliefId ? -1 : a.beliefId > b.beliefId ? 1 :
    a.opId < b.opId ? -1 : a.opId > b.opId ? 1 :
    a.atMs !== b.atMs ? a.atMs - b.atMs :
    a.verdict < b.verdict ? -1 : a.verdict > b.verdict ? 1 : 0
  );
}

/**
 * Compute one belief's support opinion from its judged events.
 * Deterministic: identical inputs (in any order) yield identical
 * outputs; the caller supplies asOfMs — this module never reads a clock.
 */
export function computeSupportOpinion(
  events: readonly SupportEvent[],
  asOfMs: number,
  params: SupportParams = SUPPORT_PARAMS_V1
): SupportOpinion {
  if (!Number.isFinite(asOfMs)) throw new SupportInputError('asOfMs must be finite.');
  if (!Number.isFinite(params.priorWeight) || params.priorWeight <= 0) {
    throw new SupportInputError('priorWeight must be positive.');
  }
  if (!Number.isFinite(params.baseRate) || params.baseRate < 0 || params.baseRate > 1) {
    throw new SupportInputError('baseRate must lie in [0, 1].');
  }
  if (!Number.isFinite(params.halfLifeMs) || params.halfLifeMs <= 0) {
    throw new SupportInputError('halfLifeMs must be positive.');
  }

  const ordered = canonicalizeEvents(events);
  let r = 0;
  let s = 0;
  const counts = { clean: 0, drawback: 0, abstain: 0 };
  for (const e of ordered) {
    validateEvent(e, asOfMs);
    counts[e.verdict] += 1;
    if (e.verdict === 'abstain') continue; // abstention reaches u only by omission
    const wEff = e.weight * Math.pow(2, -(asOfMs - e.atMs) / params.halfLifeMs);
    if (e.verdict === 'clean') r += wEff;
    else s += wEff;
  }

  const denom = r + s + params.priorWeight;
  const b = r / denom;
  const d = s / denom;
  const u = params.priorWeight / denom;
  return { b, d, u, projected: b + params.baseRate * u, events: counts };
}
