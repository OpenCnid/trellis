import { describe, expect, it } from 'vitest';
import { explainVerdict, explainCandidate, explanationLines, SEAT_LABELS } from './judge_explain';
import type { JudgeVerdict, PanelComposition } from './judge_panel';
import type { SupportOpinion } from './support';

const mk = (over: Partial<JudgeVerdict> & Pick<JudgeVerdict, 'role' | 'verdict'>): JudgeVerdict =>
  ({ judgeId: 'j', beliefId: 'b1', drawback: null, atMs: 0, weight: 1, ...over } as JudgeVerdict);

const opinion = (b: number, d: number, u: number, projected: number): SupportOpinion =>
  ({ b, d, u, projected } as unknown as SupportOpinion);

describe('judge_explain', () => {
  it('renders clean as "no known drawback found", never certified correctness (R-01)', () => {
    const e = explainVerdict(mk({ role: 'J1_GROUNDING', verdict: 'clean' }));
    expect(e.verdict).toBe('clean');
    expect(e.seat).toBe('Grounding');
    expect(e.drawback).toBeNull();
    expect(e.dimension).toBeNull();
    expect(e.text).toContain('no known drawback found');
    expect(e.text).toContain('not a certification of correctness');
    // never asserts the claim was verified/proven correct
    expect(e.text.toLowerCase()).not.toContain('verified');
    expect(e.text.toLowerCase()).not.toContain('proven');
  });

  it('renders a drawback with its humanized class and qualified-parameter dimension', () => {
    const e = explainVerdict(mk({ role: 'J1_GROUNDING', verdict: 'drawback', drawback: 'overclaimed_evidence' }));
    expect(e.verdict).toBe('drawback');
    expect(e.dimension).toBe('logical.evidence_quality/cited');
    expect(e.text).toContain('overclaimed evidence');
    expect(e.text).toContain('[logical.evidence_quality/cited]');
  });

  it('distinguishes jurisdiction and evidence abstentions', () => {
    const j = explainVerdict(mk({ role: 'J3_CORROBORATION', verdict: 'abstain', abstainReason: 'jurisdiction' }));
    const ev = explainVerdict(mk({ role: 'J3_CORROBORATION', verdict: 'abstain', abstainReason: 'evidence' }));
    expect(j.abstainReason).toBe('jurisdiction');
    expect(j.text).toContain("outside this seat's jurisdiction");
    expect(ev.text).toContain('evidence insufficient to decide');
    expect(j.text).not.toBe(ev.text);
  });

  it('labels every role and covers J4 audit', () => {
    expect(SEAT_LABELS.J4_AUDIT).toBe('Audit');
    expect(explainVerdict(mk({ judgeId: 'a', role: 'J4_AUDIT', verdict: 'drawback', drawback: 'rubric_gamed' })).dimension)
      .toBe('logical.goodharting/audit');
  });

  it('explains a candidate: opinion in words, counts, and the typed conflicts', () => {
    const composition: PanelComposition = {
      opinion: opinion(0.1, 0.2, 0.7, 0.45),
      conflicts: [
        {
          kind: 'no_global_section',
          beliefId: 'b1',
          parameter: 'logical.falsification/independent',
          judges: [
            { judgeId: 'j3a', role: 'J3_CORROBORATION', verdict: 'clean', drawback: null },
            { judgeId: 'j3b', role: 'J3_CORROBORATION', verdict: 'drawback', drawback: 'authority_contradicted' },
          ],
        },
      ],
      disagreements: [
        {
          kind: 'cross_role_disagreement',
          beliefId: 'b1',
          registryEntry: 'logical.falsification',
          judges: [
            { judgeId: 'j1', role: 'J1_GROUNDING', verdict: 'clean', drawback: null },
            { judgeId: 'j3', role: 'J3_CORROBORATION', verdict: 'drawback', drawback: 'authority_contradicted' },
          ],
        },
      ],
      exclusions: [{ judgeId: 'j2', assumption: 'history_available' }],
      counts: { verdictsConsumed: 2, verdictsWithheld: 2, jurisdictionAbstains: 1 },
    };
    const exp = explainCandidate({
      selectionId: 'b1',
      claimMode: 'fact',
      refusal: null,
      composition,
      verdicts: [
        mk({ judgeId: 'j1', role: 'J1_GROUNDING', verdict: 'drawback', drawback: 'overclaimed_evidence' }),
        mk({ judgeId: 'j3', role: 'J3_CORROBORATION', verdict: 'abstain', abstainReason: 'evidence' }),
      ],
    });
    expect(exp.verdictCount).toBe(2);
    expect(exp.verdicts).toHaveLength(2);
    const joined = exp.summary.join('\n');
    expect(joined).toContain('Support opinion');
    expect(joined).toContain('uncertainty-dominant');
    expect(joined).toContain('Consumed 2 verdict(s)');
    expect(joined).toContain('No coherent ruling (no-global-section) on logical.falsification/independent');
    expect(joined).toContain('Cross-role disagreement on logical.falsification');
    expect(joined).toContain('Excluded j2');
  });

  it('reports belief- and doubt-dominant opinions distinctly', () => {
    const base = { conflicts: [], disagreements: [], exclusions: [], counts: { verdictsConsumed: 1, verdictsWithheld: 0, jurisdictionAbstains: 0 } };
    const believe = explainCandidate({ selectionId: 'b1', claimMode: 'fact', refusal: null, composition: { ...base, opinion: opinion(0.8, 0.1, 0.1, 0.82) }, verdicts: [] });
    const doubt = explainCandidate({ selectionId: 'b1', claimMode: 'fact', refusal: null, composition: { ...base, opinion: opinion(0.1, 0.8, 0.1, 0.14) }, verdicts: [] });
    expect(believe.summary.join('\n')).toContain('belief-dominant');
    expect(doubt.summary.join('\n')).toContain('doubt-dominant');
  });

  it('surfaces a composition refusal without inventing an opinion', () => {
    const exp = explainCandidate({
      selectionId: 'b1',
      claimMode: 'fact',
      refusal: 'ContestedJudgeError: judge "j1" is contested.',
      composition: null,
      verdicts: [],
    });
    expect(exp.summary.some((s) => s.includes('Composition refused'))).toBe(true);
    expect(exp.summary.every((s) => !s.includes('Support opinion'))).toBe(true);
  });

  it('is pure and deterministic', () => {
    const v = mk({ role: 'J2_COHERENCE', verdict: 'drawback', drawback: 'self_contradictory' });
    expect(explainVerdict(v)).toEqual(explainVerdict(v));
  });

  it('explanationLines yields a header plus indented detail lines', () => {
    const exp = explainCandidate({
      selectionId: 'b1',
      claimMode: 'fact',
      refusal: null,
      composition: { opinion: opinion(0.5, 0.2, 0.3, 0.56), conflicts: [], disagreements: [], exclusions: [], counts: { verdictsConsumed: 1, verdictsWithheld: 0, jurisdictionAbstains: 0 } },
      verdicts: [mk({ role: 'J1_GROUNDING', verdict: 'clean' })],
    });
    const lines = explanationLines(exp);
    expect(lines[0]).toContain('b1');
    expect(lines[0]).toContain('mode fact');
    expect(lines.slice(1).every((l) => l.startsWith('  '))).toBe(true);
    expect(lines.some((l) => l.includes('no known drawback found'))).toBe(true);
  });
});
