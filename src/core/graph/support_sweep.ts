/**
 * The support_sweep job: registered judges × ratified candidates →
 * verdict records, on the Session 32 entailment-sweep mold, property
 * by property.
 *
 * Normative specification:
 *   docs/product/epistemic-support/JUDGE_CONVOCATION_DESIGN.md §3.2,
 *   under RECONCILIATION.md §3.1/§3.4 (gates and composition law —
 *   nothing re-implemented here; `composePanel` is consumed) and
 *   JUDGE_COMPOSITION_GAME.md §6 rules 12, 14, 20 (binding program
 *   law, cited by number, never restated).
 *
 * Mold properties, adopted:
 *   - sweep-side, NEVER a write gate: nothing here touches the write
 *     path, custody tiers, or promotion; the computed opinion advises
 *     the human ceremony (EPISTEMIC_SUPPORT §6);
 *   - the sampling unit is the (candidate, judge) PAIR, judged at most
 *     once ever — candidate identity = selectionId + engine-computed
 *     candidateHash over canonical claim bytes and mode; judge
 *     identity = judgeId + rubricSha + targetModelIdentity; a
 *     re-ratified selection or re-registered judge is a NEW pair;
 *   - uniform pool, seeded sampler, hard judge budget with counted
 *     deferred overflow (rule 14: the mechanical pool + sampler is the
 *     engine's side of the curation seat);
 *   - run binding (rule 20): the run-open event is recorded through
 *     the slice-1 store BEFORE the first judge invocation;
 *   - judge-all-then-write: every verdict is collected before any
 *     verdict write; an infrastructure failure aborts with zero
 *     verdict records;
 *   - designed silence is disclosed (rule 12): exclusions and
 *     jurisdiction abstentions are counted per candidate in the run
 *     report. Jurisdiction abstentions are ENGINE-SYNTHESIZED at zero
 *     spend — S10 layer 3 is engine-decidable, so spawning a judge to
 *     learn its claim modes would buy nothing (§3.2 implementation
 *     note).
 *
 * Opinions are COMPUTED AT READ TIME (`computeConvocationReport`),
 * never stored: `asOf` decay makes a stored opinion a stale cache, and
 * a model-visible cache is what AB-5 forbids.
 *
 * The seeded sampler is mulberry32 (specified in the record's §3.2
 * implementation note so the drill's independent generator re-derives
 * the sequence from record text, never from this file).
 */

import { createHash } from 'crypto';
import {
  buildAddressSpace,
  buildCandidate,
  buildSelection,
  toPromptInput,
  type PromotionCandidate,
} from './judge_intake';
import { composeJudgePrompt, type ComposedJudgePrompt } from './judge_intake_prompt';
import {
  COMPOSITION_ROLES,
  ROLE_DEFINITIONS,
  composePanel,
  type ClaimMode,
  type JudgeManifest,
  type JudgeRegistry,
  type PanelComposition,
  type PanelRole,
} from './judge_panel';
import type { SupportParams } from './support';
import {
  appendThroughLaw,
  type ConvocationState,
  type ConvocationStore,
  type VerdictPayload,
} from './judge_convocation_store';
import { buildRegistryFromState, type JudgeEntityState } from './judge_registration';
import { buildEngineVerdict, type ConvocationJudge } from './judge_spawn';

// ---------------------------------------------------------------------------
// Pair identity (§3.2 — the pair-once bookkeeping key)
// ---------------------------------------------------------------------------

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(',')}}`;
}

/** Engine-computed over the canonical claim bytes and mode. */
export function candidateHashOf(candidate: Pick<PromotionCandidate, 'claimMode' | 'claims'>): string {
  const canonical = canonicalJson({
    claimMode: candidate.claimMode,
    claimContent: candidate.claims.map((c) => c.content),
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function candidateIdentityOf(selectionId: string, candidateHash: string): string {
  return `${selectionId}#${candidateHash}`;
}

export function judgeIdentityOf(manifest: Pick<JudgeManifest, 'judgeId' | 'rubricSha' | 'targetModelIdentity'>): string {
  return `${manifest.judgeId}|${manifest.rubricSha}|${manifest.targetModelIdentity}`;
}

export function pairKeyOf(candidateIdentity: string, judgeIdentity: string): string {
  return createHash('sha256').update(`${candidateIdentity}::${judgeIdentity}`, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// The seeded sampler (mulberry32 — record §3.2 implementation note)
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SweepPolicy {
  /** Sampling rate over unjudged applicable pairs. */
  sampleRate: number;
  /** Hard cap on judge invocations per sweep; overflow is deferred, counted. */
  judgeBudget: number;
  /** Injectable RNG; seeded runs use mulberry32(seed). */
  random: () => number;
}

// ---------------------------------------------------------------------------
// Evidence gatherers (engine code, deterministic, injected; §3.2)
// ---------------------------------------------------------------------------

export interface EvidenceGather {
  /** false negates the role's required assumption — the R-29 gate excludes the judge, typed and counted. */
  available: boolean;
  /** The role's non-claim allowlisted inputs (assembleJudgeContext enforces the allowlist). */
  context: Record<string, unknown>;
}

export interface EvidenceGatherers {
  /** J1: live bytes at the candidate's cited hashes (fetchBlockTexts mold). */
  citedBytes(candidate: PromotionCandidate): Promise<EvidenceGather>;
  /** J2: the belief's own record, assembled mechanically — bounded, verbatim, no paraphrase. */
  history(candidate: PromotionCandidate): Promise<EvidenceGather>;
  /** J3: live blocks only (AB-11), excluding the candidate's citation chain (rule 2). */
  independentEvidence(candidate: PromotionCandidate): Promise<EvidenceGather>;
}

const GATHER_BY_ROLE: Record<string, keyof EvidenceGatherers> = {
  J1_GROUNDING: 'citedBytes',
  J2_COHERENCE: 'history',
  J3_CORROBORATION: 'independentEvidence',
};

// ---------------------------------------------------------------------------
// The sweep run
// ---------------------------------------------------------------------------

export interface SweepDeps {
  store: ConvocationStore;
  state: ConvocationState;
  graphStates: readonly JudgeEntityState[];
  gatherers: EvidenceGatherers;
  judge: ConvocationJudge;
  policy: SweepPolicy;
  runId: string;
  nowMs: () => number;
  /** The engine constant every verdict record carries (never model-supplied). */
  verdictWeight: number;
}

export interface SweepExclusion {
  judgeId: string;
  assumption: string;
  selectionId: string;
}

export interface SweepReport {
  runId: string;
  poolCandidates: number;
  poolJudges: number;
  /** Applicable, non-excluded, unjudged pairs (the sampled universe). */
  poolPairs: number;
  sampled: number;
  deferred: number;
  judged: number;
  skippedNoAnswer: number;
  /** Engine-synthesized jurisdiction abstentions recorded this run (rule 12 disclosure). */
  jurisdictionAbstains: number;
  exclusions: SweepExclusion[];
  verdictsAppended: number;
}

interface PreparedCandidate {
  selectionId: string;
  candidate: PromotionCandidate;
  candidateIdentity: string;
  gathers: Record<keyof EvidenceGatherers, EvidenceGather>;
}

/**
 * One convocation sweep run. Event order (each step typed): registry
 * assembly with consistency refusals → run-open through the slice-1
 * law (BEFORE any judging) → candidate preparation from the ratified
 * bytes → R-29 exclusion / applicability partition → seeded sampling
 * under the budget → judging (all collected, no writes) → ONE
 * append-many of every verdict record plus the run report.
 */
export async function runConvocationSweep(deps: SweepDeps): Promise<SweepReport> {
  const registry = buildRegistryFromState(deps.state.manifests, deps.graphStates);

  const beliefJudges = [...registry.values()]
    .filter((j) => (COMPOSITION_ROLES as readonly PanelRole[]).includes(j.manifest.role))
    .sort((a, b) => (a.manifest.judgeId < b.manifest.judgeId ? -1 : 1));

  // Rule 20: the run-open event precedes the first judge invocation.
  let prereg = await appendThroughLaw(deps.store, deps.state.prereg, {
    kind: 'run_open',
    key: deps.runId,
    payload: { runId: deps.runId, openedAtMs: deps.nowMs() },
  });

  // Candidates rebuild from the ratified bytes (the confirmed entries
  // ride the ratification payload — the sweep judges exactly what the
  // user ratified).
  const prepared: PreparedCandidate[] = [];
  for (const [selectionId, payload] of [...deps.state.ratifications.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const space = buildAddressSpace(payload.entries);
    const selection = buildSelection(space, payload.selection);
    const candidate = buildCandidate(space, prereg, selection);
    const gathers = {
      citedBytes: await deps.gatherers.citedBytes(candidate),
      history: await deps.gatherers.history(candidate),
      independentEvidence: await deps.gatherers.independentEvidence(candidate),
    };
    prepared.push({
      selectionId,
      candidate,
      candidateIdentity: candidateIdentityOf(selectionId, candidateHashOf(candidate)),
      gathers,
    });
  }

  // Partition: R-29 exclusions (typed, counted), engine-synthesized
  // jurisdiction abstentions (zero spend), and the sampled universe.
  const exclusions: SweepExclusion[] = [];
  const toSynthesize: Array<{ prep: PreparedCandidate; manifest: JudgeManifest; pairKey: string; judgeIdentity: string }> = [];
  const universe: Array<{ prep: PreparedCandidate; manifest: JudgeManifest; pairKey: string; judgeIdentity: string }> = [];

  for (const prep of prepared) {
    for (const entry of beliefJudges) {
      const manifest = entry.manifest;
      const def = ROLE_DEFINITIONS[manifest.role];
      const gather = prep.gathers[GATHER_BY_ROLE[manifest.role]];
      const judgeIdentity = judgeIdentityOf(manifest);
      const pairKey = pairKeyOf(prep.candidateIdentity, judgeIdentity);
      if (!gather.available) {
        for (const assumption of def.requiredAssumptions) {
          exclusions.push({ judgeId: manifest.judgeId, assumption, selectionId: prep.selectionId });
        }
        continue;
      }
      if (deps.state.judgedPairKeys.has(pairKey)) continue; // judged once, ever
      if (!def.claimModes.includes(prep.candidate.claimMode as ClaimMode)) {
        toSynthesize.push({ prep, manifest, pairKey, judgeIdentity });
        continue;
      }
      universe.push({ prep, manifest, pairKey, judgeIdentity });
    }
  }

  // Seeded sampling under the hard budget (the entailment mold).
  const sampledPairs: typeof universe = [];
  let sampled = 0;
  for (const pair of universe) {
    if (deps.policy.random() < deps.policy.sampleRate) {
      sampled += 1;
      if (sampledPairs.length < deps.policy.judgeBudget) sampledPairs.push(pair);
    }
  }
  const deferred = sampled - sampledPairs.length;

  // Judge everything BEFORE any verdict write.
  const collected: VerdictPayload[] = [];
  let judged = 0;
  let skippedNoAnswer = 0;
  for (const { prep, manifest, pairKey, judgeIdentity } of sampledPairs) {
    const context = prep.gathers[GATHER_BY_ROLE[manifest.role]].context;
    const composed: ComposedJudgePrompt = composeJudgePrompt(
      manifest.role,
      manifest.judgeId,
      toPromptInput(prep.candidate),
      context
    );
    const response = await deps.judge(composed, pairKey);
    if (response === null) {
      skippedNoAnswer += 1;
      continue;
    }
    judged += 1;
    collected.push({
      verdict: buildEngineVerdict({
        judgeId: manifest.judgeId,
        role: manifest.role,
        beliefId: prep.selectionId,
        response,
        atMs: deps.nowMs(),
        weight: deps.verdictWeight,
      }),
      promptHash: composed.promptHash,
      pairKey,
      candidateIdentity: prep.candidateIdentity,
      judgeIdentity,
      runId: deps.runId,
      synthesized: false,
    });
  }
  for (const { prep, manifest, pairKey, judgeIdentity } of toSynthesize) {
    collected.push({
      verdict: buildEngineVerdict({
        judgeId: manifest.judgeId,
        role: manifest.role,
        beliefId: prep.selectionId,
        response: { verdict: 'abstain', drawback: null, abstainReason: 'jurisdiction' },
        atMs: deps.nowMs(),
        weight: deps.verdictWeight,
      }),
      promptHash: null,
      pairKey,
      candidateIdentity: prep.candidateIdentity,
      judgeIdentity,
      runId: deps.runId,
      synthesized: true,
    });
  }

  const report: SweepReport = {
    runId: deps.runId,
    poolCandidates: prepared.length,
    poolJudges: beliefJudges.length,
    poolPairs: universe.length,
    sampled,
    deferred,
    judged,
    skippedNoAnswer,
    jurisdictionAbstains: toSynthesize.length,
    exclusions,
    verdictsAppended: collected.length,
  };

  // The single write moment: every verdict plus the run report.
  for (const payload of collected) {
    await deps.store.append({ kind: 'verdict', key: payload.pairKey, payload });
  }
  await deps.store.append({ kind: 'run_report', key: deps.runId, payload: report });
  return report;
}

// ---------------------------------------------------------------------------
// The read-time report (opinions computed, never cached model-visible)
// ---------------------------------------------------------------------------

export interface CandidateReport {
  selectionId: string;
  claimMode: string;
  verdicts: number;
  composition: PanelComposition | null;
  /** A typed composition refusal (e.g. a contested judge) surfaces per candidate, never silently. */
  refusal: string | null;
}

export function computeConvocationReport(
  state: ConvocationState,
  graphStates: readonly JudgeEntityState[],
  asOfMs: number,
  params: SupportParams
): CandidateReport[] {
  const registry: JudgeRegistry = buildRegistryFromState(state.manifests, graphStates);
  const bySelection = new Map<string, VerdictPayload[]>();
  for (const payload of state.verdicts) {
    const list = bySelection.get(payload.verdict.beliefId) ?? [];
    list.push(payload);
    bySelection.set(payload.verdict.beliefId, list);
  }
  const reports: CandidateReport[] = [];
  for (const [selectionId, ratification] of [...state.ratifications.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const payloads = bySelection.get(selectionId) ?? [];
    let composition: PanelComposition | null = null;
    let refusal: string | null = null;
    try {
      composition = composePanel(
        registry,
        { beliefId: selectionId, claimMode: ratification.record.claimMode as ClaimMode, assumptions: {} },
        payloads.map((p) => p.verdict),
        asOfMs,
        params
      );
    } catch (err) {
      refusal = `${(err as Error).constructor.name}: ${(err as Error).message}`;
    }
    reports.push({
      selectionId,
      claimMode: ratification.record.claimMode,
      verdicts: payloads.length,
      composition,
      refusal,
    });
  }
  return reports;
}
