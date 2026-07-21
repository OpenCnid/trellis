/**
 * Read-time EXPLANATION render for the four-judge panel.
 *
 * Normative specification:
 *   docs/product/epistemic-support/JUDGE_CONVOCATION_DESIGN.md §13
 *   (Option A) — a pure, deterministic function that turns already-
 *   stored verdict records plus the read-time composition into
 *   human-readable explanation lines. It joins only what the engine
 *   already holds: role, verdict, the closed drawback class, the
 *   qualified parameter that class restricts, the abstain reason, and
 *   the composition-level conflicts / disagreements / exclusions.
 *
 * This render AUTHORS NO STORED BYTE and calls no model. It is the
 * engine-side, code-mediated analogue of the session-layer
 * `judge-composition` skill's per-item `rationale` — explainability
 * without model prose entering a record (docs/architecture/
 * CODE_MEDIATED_TEXT.md; the record-vs-session split the skill's Step 5
 * note draws). `clean` renders as "no known drawback found," never
 * certified correctness (R-01).
 *
 * Deliberately pure: no database, queue, network, or clock. Not on any
 * write or gating path (AB-9/AB-5): its only callers are the advisory
 * `support:report` surface and its unit pins.
 */

import { ROLE_DEFINITIONS } from './judge_panel';
import type { JudgeVerdict, PanelRole, PanelComposition } from './judge_panel';

/**
 * Human seat labels for the current fixed-instance roles. Under the
 * composition ceremony (JUDGE_COMPOSITION_CEREMONY.md) a composed judge
 * carries its own name; this map labels the pre-ceremony instance the
 * engine ships today.
 */
export const SEAT_LABELS: Readonly<Record<PanelRole, string>> = {
  J1_GROUNDING: 'Grounding',
  J2_COHERENCE: 'Coherence',
  J3_CORROBORATION: 'Corroboration',
  J4_AUDIT: 'Audit',
};

const humanizeClass = (drawback: string): string => drawback.replace(/_/g, ' ');

/** The qualified parameter a drawback class restricts, from the role's closed taxonomy. */
function dimensionOf(role: PanelRole, drawback: string | null): string | null {
  if (drawback === null) return null;
  const taxonomy = ROLE_DEFINITIONS[role].taxonomy;
  return drawback in taxonomy ? taxonomy[drawback] : null;
}

export interface VerdictExplanation {
  judgeId: string;
  role: PanelRole;
  seat: string;
  verdict: 'clean' | 'drawback' | 'abstain';
  drawback: string | null;
  /** The qualified parameter the drawback restricts, or null. */
  dimension: string | null;
  abstainReason?: 'jurisdiction' | 'evidence';
  /** One human-readable line. */
  text: string;
}

/** Render one stored verdict as a structured explanation plus a human line. */
export function explainVerdict(v: JudgeVerdict): VerdictExplanation {
  const seat = SEAT_LABELS[v.role];
  const dimension = dimensionOf(v.role, v.drawback);
  let text: string;
  if (v.verdict === 'clean') {
    text = `${seat}: clean — no known drawback found (not a certification of correctness).`;
  } else if (v.verdict === 'drawback') {
    const dim = dimension !== null ? ` [${dimension}]` : '';
    text = `${seat}: drawback — ${humanizeClass(v.drawback ?? 'unspecified')}${dim}.`;
  } else {
    const why =
      v.abstainReason === 'jurisdiction'
        ? "outside this seat's jurisdiction"
        : 'evidence insufficient to decide';
    text = `${seat}: abstain (${v.abstainReason}) — ${why}.`;
  }
  return {
    judgeId: v.judgeId,
    role: v.role,
    seat,
    verdict: v.verdict,
    drawback: v.drawback,
    dimension,
    ...(v.abstainReason !== undefined ? { abstainReason: v.abstainReason } : {}),
    text,
  };
}

export interface CandidateExplanation {
  selectionId: string;
  claimMode: string;
  verdictCount: number;
  refusal: string | null;
  verdicts: readonly VerdictExplanation[];
  /** Composition-level prose lines (opinion, counts, conflicts, disagreements, exclusions). */
  summary: readonly string[];
}

function dominantTag(o: { b: number; d: number; u: number }): string {
  if (o.u >= o.b && o.u >= o.d) return 'uncertainty-dominant';
  if (o.d >= o.b) return 'doubt-dominant';
  return 'belief-dominant';
}

/**
 * Explain one candidate's panel outcome: each seat's verdict rendered,
 * plus the composition-level opinion, counts, and typed conflicts.
 * Verdicts are the stored records for this candidate (the caller filters
 * them by belief id); nothing here reads or writes state.
 */
export function explainCandidate(input: {
  selectionId: string;
  claimMode: string;
  refusal: string | null;
  composition: PanelComposition | null;
  verdicts: readonly JudgeVerdict[];
}): CandidateExplanation {
  const verdicts = input.verdicts.map(explainVerdict);
  const summary: string[] = [];
  if (input.refusal !== null) {
    summary.push(`Composition refused (advisory): ${input.refusal}`);
  } else if (input.composition !== null) {
    const { opinion, conflicts, disagreements, exclusions, counts } = input.composition;
    summary.push(
      `Support opinion: belief ${opinion.b.toFixed(4)}, doubt ${opinion.d.toFixed(4)}, ` +
        `uncertainty ${opinion.u.toFixed(4)} (projected ${opinion.projected.toFixed(4)}) — ${dominantTag(opinion)}.`
    );
    summary.push(
      `Consumed ${counts.verdictsConsumed} verdict(s); withheld ${counts.verdictsWithheld} as conflict; ` +
        `${counts.jurisdictionAbstains} jurisdiction abstention(s).`
    );
    for (const c of conflicts) {
      summary.push(
        `No coherent ruling (no-global-section) on ${c.parameter}: ` +
          `${c.judges.map((j) => `${SEAT_LABELS[j.role]}=${j.verdict}`).join(' vs ')} — both withheld, opinion left uncertainty-dominant.`
      );
    }
    for (const d of disagreements) {
      summary.push(
        `Cross-role disagreement on ${d.registryEntry}: ` +
          `${d.judges.map((j) => `${SEAT_LABELS[j.role]}=${j.verdict}`).join(' vs ')} — both stand; flagged for the conflict path.`
      );
    }
    for (const e of exclusions) {
      summary.push(`Excluded ${e.judgeId}: required assumption "${e.assumption}" negated by the case.`);
    }
  }
  return {
    selectionId: input.selectionId,
    claimMode: input.claimMode,
    verdictCount: input.verdicts.length,
    refusal: input.refusal,
    verdicts,
    summary,
  };
}

/** Flatten a candidate explanation into printable lines for the advisory report. */
export function explanationLines(exp: CandidateExplanation): string[] {
  const lines: string[] = [`${exp.selectionId}  (mode ${exp.claimMode}, ${exp.verdictCount} verdict(s))`];
  for (const s of exp.summary) lines.push(`  ${s}`);
  for (const v of exp.verdicts) lines.push(`  ${v.text}`);
  return lines;
}
