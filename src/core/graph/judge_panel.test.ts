import { describe, expect, it } from 'vitest';
import {
  ROLE_DEFINITIONS,
  COMPOSITION_ROLES,
  registryEntry,
  parseJudgeVerdict,
  parseJudgeManifest,
  JudgeVerdictSchemaError,
  JudgeManifestError,
  JudgeRegistryError,
  emptyRegistry,
  registerJudge,
  contestJudge,
  reRegisterJudge,
  assembleJudgeContext,
  BlindnessViolationError,
  ContextAssemblyError,
  composePanel,
  CompositionRefusedError,
  ContestedJudgeError,
  AuditVerdictInCompositionError,
  type JudgedCase,
  type PanelRole,
} from './judge_panel';
import { debiasedPreference, buildContestRequest, AuditProtocolError } from './judge_audit';

const P = { priorWeight: 2, baseRate: 0.5, halfLifeMs: 1_000_000 };
const AS_OF = 2_000_000;
const SHA = (c: string) => c.repeat(64);

const manifest = (judgeId: string, role: PanelRole, model = 'synthetic-model') => ({
  judgeId, role, rubricSha: SHA('a'), anchorSetSha: SHA('b'), taxonomyVersion: 'v1', targetModelIdentity: model,
});

const CASE: JudgedCase = {
  beliefId: 'b:1',
  claimMode: 'fact',
  assumptions: {
    cited_bytes_available: true,
    history_available: true,
    independent_evidence_pool_available: true,
  },
};

const verdict = (judgeId: string, role: PanelRole, partial: Partial<Record<string, unknown>> = {}) => ({
  judgeId, role, beliefId: 'b:1', verdict: 'clean', drawback: null, atMs: 1_000_000, weight: 1, ...partial,
});

function panelRegistry() {
  let r = emptyRegistry();
  r = registerJudge(r, manifest('j1', 'J1_GROUNDING'));
  r = registerJudge(r, manifest('j1x', 'J1_GROUNDING', 'synthetic-model-2'));
  r = registerJudge(r, manifest('j2', 'J2_COHERENCE'));
  r = registerJudge(r, manifest('j3', 'J3_CORROBORATION'));
  r = registerJudge(r, manifest('j4', 'J4_AUDIT'));
  return r;
}

describe('role definitions (RECONCILIATION.md §1–§2)', () => {
  it('keeps cross-role qualified selections pairwise disjoint — what licenses composition', () => {
    const roles = Object.keys(ROLE_DEFINITIONS) as PanelRole[];
    for (let i = 0; i < roles.length; i += 1) {
      for (let j = i + 1; j < roles.length; j += 1) {
        const a = ROLE_DEFINITIONS[roles[i]].qualifiedParameters;
        const b = ROLE_DEFINITIONS[roles[j]].qualifiedParameters;
        expect(a.filter((p) => b.includes(p))).toEqual([]);
      }
    }
  });

  it('maps every taxonomy class into its own sparse selection and keeps J4 out of composition', () => {
    for (const def of Object.values(ROLE_DEFINITIONS)) {
      for (const param of Object.values(def.taxonomy)) {
        expect(def.qualifiedParameters).toContain(param);
      }
    }
    expect(COMPOSITION_ROLES).not.toContain('J4_AUDIT');
    expect(registryEntry('logical.falsification/cited')).toBe('logical.falsification');
  });
});

describe('verdict and manifest schemas (closed taxonomies; R-27)', () => {
  it('refuses an unknown drawback class and a class from another role', () => {
    expect(() => parseJudgeVerdict(verdict('j1', 'J1_GROUNDING', { verdict: 'drawback', drawback: 'vibes_off' })))
      .toThrow(JudgeVerdictSchemaError);
    expect(() => parseJudgeVerdict(verdict('j2', 'J2_COHERENCE', { verdict: 'drawback', drawback: 'unsupported_citation' })))
      .toThrow(JudgeVerdictSchemaError);
  });

  it('requires abstainReason on abstains and forbids it elsewhere', () => {
    expect(() => parseJudgeVerdict(verdict('j1', 'J1_GROUNDING', { verdict: 'abstain' })))
      .toThrow(JudgeVerdictSchemaError);
    expect(() => parseJudgeVerdict(verdict('j1', 'J1_GROUNDING', { abstainReason: 'evidence' })))
      .toThrow(JudgeVerdictSchemaError);
    expect(parseJudgeVerdict(verdict('j1', 'J1_GROUNDING', { verdict: 'abstain', abstainReason: 'jurisdiction' })).abstainReason)
      .toBe('jurisdiction');
  });

  it('requires targetModelIdentity so a model migration can contest the judge (R-27)', () => {
    const { targetModelIdentity: _omitted, ...withoutModel } = manifest('jx', 'J1_GROUNDING');
    expect(() => parseJudgeManifest(withoutModel)).toThrow(/targetModelIdentity/);
    expect(() => parseJudgeManifest({ ...manifest('jx', 'J1_GROUNDING'), rubricSha: 'nope' }))
      .toThrow(JudgeManifestError);
  });
});

describe('registry lifecycle (contest → refuse → human re-registration)', () => {
  it('contests, refuses recovery without a named reviewer, and keeps the superseded record', () => {
    let r = panelRegistry();
    r = contestJudge(r, 'j3', { finding: 'systematic_drift', reason: 'drift', contestedAtMs: 1 });
    expect(r.get('j3')!.contested).toBe(true);
    expect(() => reRegisterJudge(r, 'j3', { reviewedBy: '', atMs: 2 })).toThrow(JudgeRegistryError);
    r = reRegisterJudge(r, 'j3', { reviewedBy: 'operator', atMs: 2 });
    expect(r.get('j3')!.contested).toBe(false);
    expect(r.get('j3')!.history).toEqual([
      { finding: 'systematic_drift', reason: 'drift', contestedAtMs: 1, superseded: true },
    ]);
  });

  it('refuses duplicate registration and recovery of an uncontested judge', () => {
    const r = panelRegistry();
    expect(() => registerJudge(r, manifest('j1', 'J1_GROUNDING'))).toThrow(JudgeRegistryError);
    expect(() => reRegisterJudge(r, 'j1', { reviewedBy: 'operator', atMs: 2 })).toThrow(JudgeRegistryError);
  });
});

describe('context assembly — blindness as structure', () => {
  it('refuses a forbidden input with a typed error naming role and input', () => {
    try {
      assembleJudgeContext('J1_GROUNDING', { claim: 'c', citedBytes: ['x'], graphNeighbors: [] });
      expect.unreachable('forbidden input must refuse');
    } catch (err) {
      expect(err).toBeInstanceOf(BlindnessViolationError);
      expect((err as BlindnessViolationError).role).toBe('J1_GROUNDING');
      expect((err as BlindnessViolationError).input).toBe('graphNeighbors');
    }
  });

  it('fails closed on a missing required input and passes a clean context through', () => {
    expect(() => assembleJudgeContext('J3_CORROBORATION', { claim: 'c' })).toThrow(ContextAssemblyError);
    expect(assembleJudgeContext('J2_COHERENCE', { claim: 'c', history: [] }))
      .toEqual({ claim: 'c', history: [] });
  });
});

describe('composePanel (RECONCILIATION.md §3)', () => {
  it('composes surviving verdicts through the drilled v1 arithmetic', () => {
    const result = composePanel(panelRegistry(), CASE, [
      verdict('j1', 'J1_GROUNDING'),
      verdict('j3', 'J3_CORROBORATION', { verdict: 'drawback', drawback: 'uncorroborated' }),
    ], AS_OF, P);
    // one clean and one drawback, each at one half-life: r = s = 0.5
    expect(result.opinion.b).toBeCloseTo(0.5 / 3, 12);
    expect(result.opinion.d).toBeCloseTo(0.5 / 3, 12);
    expect(result.opinion.u).toBeCloseTo(2 / 3, 12);
    expect(result.disagreements).toEqual([]); // induction has no kin in J1's selection
  });

  it('refuses contested judges, J4 verdicts, unregistered judges, and mixed beliefs', () => {
    const registry = panelRegistry();
    const contested = contestJudge(registry, 'j1', { finding: 'systematic_drift', reason: 'drift', contestedAtMs: 1 });
    expect(() => composePanel(contested, CASE, [verdict('j1', 'J1_GROUNDING')], AS_OF, P))
      .toThrow(ContestedJudgeError);
    expect(() => composePanel(registry, CASE, [verdict('j4', 'J4_AUDIT', { verdict: 'drawback', drawback: 'systematic_drift' })], AS_OF, P))
      .toThrow(AuditVerdictInCompositionError);
    expect(() => composePanel(registry, CASE, [verdict('ghost', 'J1_GROUNDING')], AS_OF, P))
      .toThrow(CompositionRefusedError);
    expect(() => composePanel(registry, CASE, [verdict('j1', 'J1_GROUNDING', { beliefId: 'b:2' })], AS_OF, P))
      .toThrow(CompositionRefusedError);
  });

  it('runs the R-29 gates: negated assumption excludes; a verdict past the gate refuses', () => {
    const gated: JudgedCase = { ...CASE, assumptions: { ...CASE.assumptions, independent_evidence_pool_available: false } };
    const clean = composePanel(panelRegistry(), gated, [verdict('j1', 'J1_GROUNDING')], AS_OF, P);
    expect(clean.exclusions).toEqual([{ judgeId: 'j3', assumption: 'independent_evidence_pool_available' }]);
    expect(() => composePanel(panelRegistry(), gated, [verdict('j3', 'J3_CORROBORATION')], AS_OF, P))
      .toThrow(CompositionRefusedError);
  });

  it('admits only jurisdiction abstains from inapplicable judges and refuses an all-jurisdiction panel', () => {
    const prediction: JudgedCase = { ...CASE, claimMode: 'prediction' };
    expect(() => composePanel(panelRegistry(), prediction, [verdict('j1', 'J1_GROUNDING')], AS_OF, P))
      .toThrow(CompositionRefusedError);
    const ok = composePanel(panelRegistry(), prediction, [
      verdict('j1', 'J1_GROUNDING', { verdict: 'abstain', abstainReason: 'jurisdiction' }),
      verdict('j2', 'J2_COHERENCE'),
    ], AS_OF, P);
    expect(ok.counts.jurisdictionAbstains).toBe(1);
    const valueCase: JudgedCase = { ...CASE, claimMode: 'value' };
    expect(() => composePanel(panelRegistry(), valueCase, [
      verdict('j1', 'J1_GROUNDING', { verdict: 'abstain', abstainReason: 'jurisdiction' }),
      verdict('j2', 'J2_COHERENCE', { verdict: 'abstain', abstainReason: 'jurisdiction' }),
    ], AS_OF, P)).toThrow(CompositionRefusedError);
  });

  it('emits no_global_section for same-jurisdiction conflict, withholds the pair, stays u-dominant over the blend', () => {
    const verdicts = [
      verdict('j1', 'J1_GROUNDING', { verdict: 'drawback', drawback: 'contradicted_by_cited_bytes' }),
      verdict('j1x', 'J1_GROUNDING'),
      verdict('j2', 'J2_COHERENCE'),
    ];
    const result = composePanel(panelRegistry(), CASE, verdicts, AS_OF, P);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].kind).toBe('no_global_section');
    expect(result.conflicts[0].parameter).toBe('logical.falsification/cited');
    expect(result.counts.verdictsWithheld).toBe(2);
    // survivors: one clean at half-life → r = 0.5; the blend would carry
    // r = 1.0, s = 0.5 (u = 2/3.5) — composed u must dominate it.
    expect(result.opinion.u).toBeCloseTo(2 / 2.5, 12);
    expect(result.opinion.u).toBeGreaterThan(2 / 3.5);
  });

  it('records cross-role disagreement as data — it composes and flags, never withholds', () => {
    const result = composePanel(panelRegistry(), CASE, [
      verdict('j1', 'J1_GROUNDING'),
      verdict('j3', 'J3_CORROBORATION', { verdict: 'drawback', drawback: 'authority_contradicted' }),
    ], AS_OF, P);
    expect(result.disagreements).toEqual([{
      kind: 'cross_role_disagreement',
      beliefId: 'b:1',
      registryEntry: 'logical.falsification',
      judges: [
        { judgeId: 'j3', role: 'J3_CORROBORATION', verdict: 'drawback', drawback: 'authority_contradicted' },
        { judgeId: 'j1', role: 'J1_GROUNDING', verdict: 'clean', drawback: null },
      ],
    }]);
    expect(result.counts.verdictsWithheld).toBe(0);
    expect(result.opinion.b).toBeGreaterThan(0);
    expect(result.opinion.d).toBeGreaterThan(0);
  });
});

describe('judge_audit (position-debiased protocol; never a gate)', () => {
  it('counts a preference only when both orders agree on the same original record', () => {
    expect(debiasedPreference({ firstOrder: 'A', swappedOrder: 'B' })).toBe('A');
    expect(debiasedPreference({ firstOrder: 'B', swappedOrder: 'A' })).toBe('B');
    expect(debiasedPreference({ firstOrder: 'A', swappedOrder: 'A' })).toBe('indistinguishable');
    expect(debiasedPreference({ firstOrder: 'indistinguishable', swappedOrder: 'B' })).toBe('indistinguishable');
  });

  it('builds a contest request only from an agreed finding — a tie never contests', () => {
    const agreed = { judgeId: 'j3', finding: 'systematic_drift' as const, rationale: 'drift', sampledCount: 25, agreementBothOrders: true };
    expect(buildContestRequest(agreed, 5).judgeId).toBe('j3');
    expect(() => buildContestRequest({ ...agreed, agreementBothOrders: false }, 5)).toThrow(AuditProtocolError);
    expect(() => buildContestRequest({ ...agreed, sampledCount: 0 }, 5)).toThrow(AuditProtocolError);
  });
});
