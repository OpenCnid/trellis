/**
 * Support-metric expressions (v1): the composition grammar over op
 * verdict streams, with the mandatory fail-closed validity gate.
 *
 * Normative specification: docs/architecture/EPISTEMIC_SUPPORT.md §4.
 * Pure module; sole caller today is the oracle drill. A metric is
 * reproducible from its expression plus the op pool; hashing the
 * canonical serialization yields `metricSha` (the composed-prompt pin
 * discipline applied to evaluators).
 *
 * Abstain semantics follow the S1 grammar: abstaining children are
 * excluded from their combinator, and a node whose children all
 * abstain abstains itself.
 */

import type { SupportVerdict } from './support';

export type MetricExpr =
  | { op: 'leaf'; opId: string }
  | { op: 'any'; children: MetricExpr[] }
  | { op: 'all'; children: MetricExpr[] }
  | { op: 'kofk'; k: number; children: MetricExpr[] };

export class MetricValidityError extends Error {
  constructor(
    public readonly vacuityClass: 'all_drawback' | 'all_clean' | 'all_abstain' | 'malformed',
    message: string
  ) {
    super(message);
  }
}

export function evaluateMetric(
  expr: MetricExpr,
  verdicts: ReadonlyMap<string, SupportVerdict>
): SupportVerdict {
  switch (expr.op) {
    case 'leaf':
      return verdicts.get(expr.opId) ?? 'abstain';
    case 'any':
    case 'all':
    case 'kofk': {
      const child = expr.children.map((c) => evaluateMetric(c, verdicts));
      const opining = child.filter((v) => v !== 'abstain');
      if (opining.length === 0) return 'abstain';
      const drawbacks = opining.filter((v) => v === 'drawback').length;
      if (expr.op === 'any') return drawbacks > 0 ? 'drawback' : 'clean';
      if (expr.op === 'all') return drawbacks === opining.length ? 'drawback' : 'clean';
      return drawbacks >= expr.k ? 'drawback' : 'clean';
    }
  }
}

function assertWellFormed(expr: MetricExpr): void {
  if (expr.op === 'leaf') {
    if (typeof expr.opId !== 'string' || expr.opId.length === 0) {
      throw new MetricValidityError('malformed', 'Metric leaf requires a non-empty opId.');
    }
    return;
  }
  if (!Array.isArray(expr.children) || expr.children.length === 0) {
    throw new MetricValidityError('malformed', `Metric "${expr.op}" node requires children.`);
  }
  if (expr.op === 'kofk' && (!Number.isInteger(expr.k) || expr.k < 1 || expr.k > expr.children.length)) {
    throw new MetricValidityError('malformed', 'kofk requires 1 <= k <= children.length.');
  }
  for (const c of expr.children) assertWellFormed(c);
}

/**
 * The fail-closed validity gate: a candidate metric evaluated against
 * the calibration verdict sets must not produce one verdict class on
 * every belief. A candidate with an empty calibration set is refused
 * outright — selection without a usable anchor opinion is refusal,
 * never default acceptance.
 */
export function validateMetric(
  expr: MetricExpr,
  calibration: ReadonlyArray<ReadonlyMap<string, SupportVerdict>>
): void {
  assertWellFormed(expr);
  if (calibration.length === 0) {
    throw new MetricValidityError(
      'malformed',
      'Validity gate refuses a candidate with no calibration verdict sets (fail-closed).'
    );
  }
  const seen = new Set<SupportVerdict>();
  for (const verdicts of calibration) seen.add(evaluateMetric(expr, verdicts));
  if (seen.size === 1) {
    const only = [...seen][0];
    const vacuityClass =
      only === 'drawback' ? 'all_drawback' : only === 'clean' ? 'all_clean' : 'all_abstain';
    throw new MetricValidityError(
      vacuityClass,
      `Validity gate refused a vacuous metric: verdict "${only}" on every calibration belief.`
    );
  }
}

/** Canonical serialization for hashing (`metricSha`): sorted-key JSON. */
export function canonicalMetricString(expr: MetricExpr): string {
  const canon = (e: MetricExpr): unknown =>
    e.op === 'leaf'
      ? { op: 'leaf', opId: e.opId }
      : e.op === 'kofk'
        ? { children: e.children.map(canon), k: e.k, op: 'kofk' }
        : { children: e.children.map(canon), op: e.op };
  return JSON.stringify(canon(expr));
}
