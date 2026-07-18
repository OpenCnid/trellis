/**
 * J4 audit protocol structures: position-debiased pairwise comparison
 * and the contest-request builder.
 *
 * Normative specification:
 *   docs/product/epistemic-support/RECONCILIATION.md §2 (the J4
 *   definition) and FOUR_JUDGE_DESIGN.md §3 row 4 / §4;
 *   JUDGE_CONTRACT_TEMPLATE.md §5 (protocol invariants: judged twice
 *   with positions swapped; a finding counts only when both orders
 *   agree; disagreement is a tie, recorded as such).
 *
 * STRUCTURAL INVARIANT (AB-9, drill-pinned in both directions): this
 * module imports NO gating surface — not `judge_panel.ts`, not
 * `support.ts`, not `support_metrics.ts` — and `judge_panel.ts`
 * imports nothing from here. An audit finding reaches a judge only as
 * a contest of the judge capability, carried by a mediator outside
 * both modules (the sweep in production; the drill script here). No
 * code path exists from a J4 verdict to any belief opinion.
 */

export type AuditFindingClass = 'rubric_gamed' | 'convention_blind' | 'systematic_drift';

export type AuditPreference = 'A' | 'B' | 'indistinguishable';

/**
 * One comparison judged twice. `firstOrder` is the preference over
 * (A, B); `swappedOrder` is the preference the second run reported
 * over (B, A), IN THE SWAPPED FRAME — a swapped-frame 'A' names the
 * original B.
 */
export interface PositionedComparison {
  firstOrder: AuditPreference;
  swappedOrder: AuditPreference;
}

/**
 * The debias rule: a preference counts only when both orders agree on
 * the same ORIGINAL record; everything else is a tie.
 */
export function debiasedPreference(c: PositionedComparison): AuditPreference {
  if (c.firstOrder === 'A' && c.swappedOrder === 'B') return 'A';
  if (c.firstOrder === 'B' && c.swappedOrder === 'A') return 'B';
  return 'indistinguishable';
}

export interface AuditFinding {
  judgeId: string;
  finding: AuditFindingClass;
  rationale: string;
  sampledCount: number;
  /** True only when the position-swapped protocol agreed in both orders. */
  agreementBothOrders: boolean;
}

export class AuditProtocolError extends Error {}

const FINDING_CLASSES: ReadonlySet<string> = new Set([
  'rubric_gamed',
  'convention_blind',
  'systematic_drift',
]);

/**
 * Build the contest-request record a mediator may apply to the judge
 * registry. A tie never contests: a finding without both-orders
 * agreement is refused here, before it can reach any registry.
 * The returned shape is a plain record — this module holds no
 * reference to the registry or any composition surface.
 */
export function buildContestRequest(
  finding: AuditFinding,
  atMs: number
): { judgeId: string; finding: string; reason: string; contestedAtMs: number } {
  if (!FINDING_CLASSES.has(finding.finding)) {
    throw new AuditProtocolError(`Unknown audit finding class "${finding.finding}" (closed taxonomy).`);
  }
  if (!finding.agreementBothOrders) {
    throw new AuditProtocolError(
      `Contest refused for judge "${finding.judgeId}": the position-swapped orders disagree — a tie is recorded, never acted on.`
    );
  }
  if (!Number.isInteger(finding.sampledCount) || finding.sampledCount < 1) {
    throw new AuditProtocolError(`Contest refused for judge "${finding.judgeId}": a finding requires at least one sampled comparison.`);
  }
  return {
    judgeId: finding.judgeId,
    finding: finding.finding,
    reason: finding.rationale,
    contestedAtMs: atMs,
  };
}
