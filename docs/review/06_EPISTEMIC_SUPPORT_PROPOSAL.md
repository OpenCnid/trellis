# Epistemic Support: A Second Axis for Trellis (Design-Record Proposal)

*An external proposal from the sister research lab, July 16, 2026, extending the
review series in this directory. Written against commit `841f875` and guided by
arXiv:2607.12790 ("Who Grades the Grader? Co-Evolving Evaluation Metrics and
Skills for Self-Improving LLM Agents", Zhang et al., July 2026 — "the paper"
below). This is a proposal for OpenCnid review, not an implementation; it
follows the repository's design-record conventions (problem statement →
doctrine → mechanism → enforcement → drills → exclusions) so it can be
adopted, amended, or refused through the ordinary process.*

---

## 1. Problem statement

Trellis's trust tiers measure **chain of custody**, and custody is genuinely
binary: bytes either passed the verified ingest transaction or they did not;
a belief either cites live AST hashes or it does not. The doctrine is explicit
that provenance proves *origin, never correctness* — and therefore the system
deliberately has no representation of "true."

This is correct and should not change. But it leaves a real gap, easiest to
state with an example: *the theory of evolution*. No provenance chain can ever
make "evolution is correct" a Tier-1 fact — Tier 1 is bytes, and even a false
claim's bytes are legitimately Tier 1. Yet a mature knowledge system must be
able to distinguish:

- a belief corroborated by decades of independent derivations from
  authoritative sources, never successfully disputed, load-bearing for
  billions of dollars of downstream work; from
- a belief written once by one extraction run at self-reported confidence
  0.97, never re-examined.

Today Trellis cannot make that distinction queryable. The signals exist but
are scattered and uncomposed:

| Existing signal | Where | Limitation |
|---|---|---|
| `confidence` float in [0,1] | writer-supplied at `write_derived_insight` (`src/rlm/trellis_tools.py`) | **Self-reported and adversarially worthless** — the poisoning drill wrote its poison at confidence 0.97 |
| `verified_count` | incremented by the verification sweep (`src/core/graph/verification.ts`) | monotone counter, no dispute weighting, no recency |
| `contested` + `contestedReason` (`'disputed'`, `'unsupported_citation'`) | quarantine machinery (`src/core/graph/provenance.ts`, `verification.ts`, `entailment_detection.ts`) | binary: a belief is excluded or it is not |
| `entailmentCheckedHashes` / `unsupportedHashes` | sampled entailment sweep (`src/core/graph/entailment_detection.ts`) | per-(edge, hash) stamps, never aggregated |
| `rubricVersion`, `rederivedAt`, audit history | write path + sweep | lifecycle stamps, not a standing |

Meanwhile the lab direction is toward **automation** of trust flows. Every
trust elevation today is a human ceremony, which is the right default but does
not scale, and the honest question is which parts of the ceremony a judge can
carry.

## 2. The doctrine: two axes, never conflated

The proposal is one sentence: **add a second, orthogonal, continuous axis —
epistemic support — computed by an independent judge layer, while the custody
axis remains discrete, structural, and unchanged.**

- **Custody** (existing): where did this come from? Binary standing, enforced
  at the write path, elevated only through human-gated ceremonies. Unchanged
  by this proposal in every respect.
- **Support** (new): how well has this held up? A graded, decaying,
  evidence-derived score, computed sweep-side by judges, never asserted by
  the writer.

Three hard rules keep the axes apart, each an instance of an existing Trellis
doctrine:

1. **Support never mints custody.** No support score, however high, causes a
   tier crossing, mints provenance, or substitutes for `sourceNodeIds`
   validation. (The laundering lesson: a score that can buy standing becomes
   a target.)
2. **Custody never implies support.** A freshly written belief with perfect
   provenance starts at maximal *uncertainty*, not maximal support.
3. **The writer never sees the score.** Support is computed after the fact by
   independent judges, is never present in any task prompt, and is never a
   reward term in any task specification. (Their own A/B: a count-shaped
   incentive flipped laundering 0% → 100% in an agent that knew the right
   answer. "Never reward citation count" generalizes to "never reward score.")

The two axes span a plane in which every belief has a position and a
trajectory — beliefs drift along the support axis as evidence accumulates,
decays, or breaks, while custody transitions remain discrete events. Nothing
about the geometry is decorative: the design work below is exactly the
machinery that moves points along one axis and forbids that motion from
leaking into the other.

## 3. The support state

Per belief (nodes and relationships that carry `sourceNodeIds`), an additive,
optional structure — new fields only, legacy behavior byte-identical when
absent, per hard rule 9:

```
support: {
  b: float,          // belief mass    — evidence the claim held
  d: float,          // disbelief mass — evidence the claim failed
  u: float,          // uncertainty    — b + d + u = 1
  projected: float,  // scalar projection for consumers that need one number
  asOf: timestamp,
  metricId: string,  // which composed metric produced this (see §4)
  metricSha: string  // byte-pin of the metric expression + op pool version
}
```

A **subjective-logic opinion** (b, d, u) rather than a bare fuzzy scalar,
for one load-bearing reason: a scalar 0.5 cannot distinguish *balanced
conflicting evidence* from *nothing has ever checked this*. Trellis's culture
is precisely about not letting ignorance impersonate knowledge; `u` is
ignorance made explicit. The scalar `projected` (e.g. b + a·u with a fixed
prior weight a) is derived, never stored authority.

Inputs to the computation, all of which already exist as events:

- verification-sweep agreements (+b) and disputes (+d) with recency weighting;
- entailment-sweep passes (+b) and `unsupported_citation` findings (+d);
- independent corroborations: distinct beliefs with the same normalized
  (subject, verb, object) derived from **disjoint** source documents, weighted
  by source authority (§5);
- churn decay: `u` grows as the cited documents' versions advance without
  re-verification (the belief may still be right, but the world moved);
- writer `confidence` is **excluded from the computation entirely.** It
  remains stored as an audit fact about what the writer claimed — the
  poisoning drill is the standing proof it carries no evidential weight.

Support is recomputed only by the sweep processes (a new job name on the
existing shared verification queue, mirroring how `entailment_sweep` was
added), never inline with writes, never by the RLM.

## 4. The judge layer, guided by the paper

The paper's architecture maps onto Trellis with almost no impedance, and
where it maps, we should take its measured lessons verbatim.

### 4.1 Judges are drawback detectors, not truth oracles

The paper's stance: *"we rarely know what good is, but given an output we can
usually find drawbacks, so a clean verdict means no known drawback was found,
not certified correctness."* This is the support-axis twin of "provenance
proves origin, never correctness" — adopt it as doctrine. Every judge is an
**op**: a pure function over (belief, evidence, context) returning
`{drawback, clean, abstain}`. Ops come in the paper's three cost tiers, which
Trellis already has instances of:

- **static ops** — deterministic checks (hash liveness, orphan status,
  corroboration counting, churn staleness): free, run always;
- **execution ops** — re-derivation against live bytes (the existing
  verification sweep's classifier call is one);
- **judge ops** — one narrow LLM question (the existing entailment judge is
  one: "do these bytes support this claim?").

### 4.2 Metrics are composed expressions with a fixed root

A support metric is an expression over ops — `any(...)`, `all(...)`,
K-of-k votes, abstain-aware exactly as the paper's grammar (an abstaining
child leaves its combinator; an all-abstain node abstains, feeding `u`, not
`b` or `d`). The **fixed, non-evolving root** — the paper's structural
validator that every composition is conjoined with — already exists in
Trellis: it is the write path's format → existence → retrieval-membership
gate sequence. Nothing judged is even eligible unless the root passed at
write time.

Two properties of the paper's design matter more than its evolution loop and
should be adopted first:

- **Mostly deterministic.** A bare LLM judge shares failure modes with the
  LLM whose beliefs it grades and "can drift into agreement with the solver
  before any optimization pressure exists"; deterministic detectors fail
  differently. Compose cheap static ops around the narrow judge ops.
- **Fully reproducible and legible.** A metric is its expression string plus
  a versioned op pool — byte-pinnable, exactly Trellis's composed-prompt
  discipline (`metricSha` above is the analog of the kernel prompt pin). The
  paper's evolved metrics ended as 2–3 leaf expressions naming failure
  classes a practitioner recognizes; an inspectable metric is what made
  their Goodhart diagnosis and one-detector repair possible.

### 4.3 Anchor discipline is the safety load-bearer

The paper's central ablation result: removing the detector lifecycle does
*not* collapse the metric; removing the **anchor guards** collapses it into a
vacuous always-pass grader on three of three seeds. The guards are:

- a **tiny anchored dev set** (ten items suffice — their subsample study held
  0.85–0.88 agreement from four items up) with golden references, the only
  supervised signal any loop reads;
- a **locked held-out set** no loop ever reads, reporting transfer only;
- **fail-closed selection** (a candidate metric with no usable anchor opinion
  is unselectable) and a **validity gate** (all-pass / all-fail / all-abstain
  candidates are dropped).

Trellis is unusually well positioned here because it already maintains
committed, byte-pinned oracle corpora and drill manifests. The natural
anchors: the update-drill and poisoning-drill manifests (known-good and
known-poisoned beliefs by construction), the citation A/B's zorbex corpus
(known-supporting and known-decoy blocks), and ten-item hand-labeled sets in
the same style for any new task family. **"The anchor cannot be
manufactured"** — the paper's own limitation — is the honest boundary:
evolution/search expands coverage; it never creates ground truth. Where no
anchor can exist, `u` stays high and the system says so.

### 4.4 Judges are capabilities: close the "who grades the grader" loop natively

The paper answers its title with "an anchor the grader must predict, one it
never sees, and an outside judge." Trellis can go one step further with
machinery it already has: **register every metric and judge op as a module
manifest citing its rubric text, anchor corpus, and design rationale as
promoted research hashes** (`npm run modules:register` pattern,
`scripts/register_modules.ts`). Then:

- the invalidation sweep **contests a judge** when its anchor corpus or
  research basis is re-promoted or superseded — the capability flywheel
  applied to evaluators;
- judge verdicts become provenance-bearing records (metric id + `metricSha` +
  input hashes + verdict), auditable like any belief;
- `rubricVersion` on judged beliefs (already stamped) points into a versioned
  registry instead of a loose string.

This composition — the paper's anchor discipline plus Trellis's
capability-as-belief registration — is, to our knowledge, not built anywhere
yet, and it is the piece that makes an automated judge layer *governable*:
a judge whose evidentiary basis died is automatically excluded from
composition pending human re-review, exactly like any other contested
capability.

### 4.5 The outer audit and the 2×2 lesson

The paper's most instructive episode: evolved skills gamed a rubric's tag
counter; the *inner* metric could not see it; an **independent, stronger,
position-debiased pairwise judge outside all loops** caught it; one detector
repaired it; and then the **judge itself** was found miscalibrated (a generic
rubric blamed the task's required format — win rate stuck at 0.12 — until a
task-aware rubric stating the format contract separated real quality from
convention-blindness, 0.515 → 0.770).

Both directions transfer as standing rules for any Trellis support layer:

1. **The gate judge and the audit judge must be independent** — different
   role, ideally different model, and the audit sits outside every loop that
   could optimize against it. (Trellis already splits write-gate entailment
   from sweep-side detection; preserve that split in the support layer.)
2. **The audit needs the task contract.** A convention-blind judge produces
   confident, wrong verdicts about disciplined output. Audit rubrics must
   state Trellis's own contracts (by-reference answers, provenance
   requirements, hedging conventions) or they will grade the discipline
   itself as a defect.

### 4.6 The detectability spectrum bounds the ambition

The paper's within-task contrast (Spider 2.0 before/after prompt grounding)
is the honest scoping tool: composed metrics buy the most **where failures
are mechanically detectable**; when residual failures became semantically
wrong values under clean execution, held-out agreement fell to coin-flip and
the burden shifted to judge ops and outer audits. Applied here:

- **Verifiable claims** (a date, a quantity, a code relationship): static +
  execution ops against authoritative sources (§5) carry the load; support
  can move confidently.
- **Unverifiable claims** (interpretations, syntheses, "evolution is
  correct"): judge ops + corroboration structure + the outer audit; support
  moves slowly and `u` stays honest. This is precisely the regime the user's
  fuzzy-score intuition targets, and the honest answer is a graded opinion
  with explicit uncertainty, not a verdict.

## 5. The authority registry (verifiable claims)

For claims checkable against sources, maintain an operator-owned registry
mapping **promoted doc-key patterns to authority weights**:

```
TRELLIS_AUTHORITIES: [
  { pattern: "web:https://docs.python.org/**", weight: 0.9, basis: <sourceNodeIds> },
  { pattern: "repo:trellis:**",                weight: 0.8, basis: [...] },
  ...
]
```

Three constraints, each inherited from existing doctrine:

1. **Authorities are promoted content.** A source earns registry membership
   only through the existing promotion path (`npm run promote`) — the
   registry points at doc keys, never at raw URLs. Re-promoting a changed
   authoritative page already flows through the Merkle diff → invalidation
   sweep, so beliefs corroborated by a superseded authority page are
   contested by machinery that exists today.
2. **Authority weight is itself a belief.** Each entry carries a `basis`
   (why this source is authoritative, as promoted hashes) and is registered
   as a graph entity the sweep can contest — authorities get discredited,
   and a hardcoded weight is a belief with no custody.
3. **Corroboration reads live blocks only.** "Superseded versions are
   archive, not search space" (hard rule 13) applies: corroboration ops
   query current-version membership, the same EXISTS discipline as
   `search_ast_nodes`.

## 6. The automation ladder

Automation enters bottom-up, each level gated on the one below, tier
crossings human until measured:

- **Level 0 (today):** all trust elevation is human ceremony. Unchanged.
- **Level 1 — automated scoring:** support opinions computed sweep-side on
  the existing queue cadence; counts-only telemetry (T16 discipline: scores
  and claims never become log content); read surfaces may *display* support
  alongside retrieval results (an operator seeing (b, d, u) beside a fact),
  but no behavior branches on it.
- **Level 2 — judge triage, human ratification in batch:** beliefs crossing
  pre-stated thresholds (high b, low d, multi-judge agreement,
  authority-corroborated, anchors fresh) enter a **ratification queue**; a
  human approves or refuses *batches* through a gated CLI in the promotion
  mold. The ceremony survives; its unit cost drops from per-item to
  per-batch. Symmetrically, beliefs whose d crosses a threshold enter the
  existing contested flow automatically (this half already exists — the
  sweep contests on `disputed`).
- **Level 3 — automated crossings (future, explicitly not now):** any
  proposal to let a support threshold *itself* elevate standing must run an
  EL-07-style **paired pilot** first: identical corpora through the manual
  ceremony and the automated one, pre-stated criteria (zero forged
  elevations, dispute-recall parity, human-review agreement rate), owner
  verdict on the measurements. The engineering-loop program's premise — an
  agent must not forge the record of its own success — applies verbatim to
  a judge that could elevate beliefs.

## 7. Goodhart guardrails (standing rules)

Compiled from Trellis's own citation A/B and the paper's ablations; these
are invariants of the support layer, not preferences:

1. The writer never sees, and is never rewarded on, any support quantity.
2. Support is computed only sweep-side by registered judges; no inline path.
3. Gate judges and audit judges are independent; the outer audit sits
   outside all loops and its rubric states the task contract.
4. Anchor guards are fail-closed; vacuous metrics (all-pass/all-fail/
   all-abstain) are structurally unselectable; anchor sets are committed,
   byte-pinned fixtures.
5. Judges and metrics are hash-pinned, registered capabilities; a judge with
   a dead evidentiary basis is contested and excluded from composition.
6. Writer-supplied `confidence` never enters the computation.
7. Watch **anchor drift, not pool drift**: the paper's ablation shows a
   bloated op pool is survivable and a drifted anchor is not. Anchor
   refresh is a human ceremony with its own audit stamp.

## 8. Drills and acceptance (zero-paid first)

In the repository's drill culture, each mechanism lands with a zero-LLM
drill before any paid run:

- **Support-computation oracle drill:** seeded beliefs + scripted op verdicts
  → assert exact (b, d, u) arithmetic, decay behavior, and abstain → u
  routing. No LLM. *Drafted as a concrete specification (PROPOSED —
  UNRUN): [`docs/product/epistemic-support/ORACLE_DRILL_PROPOSAL.md`](../product/epistemic-support/ORACLE_DRILL_PROPOSAL.md);
  claim-level research map: [`docs/product/epistemic-support/RESEARCH_MAP.md`](../product/epistemic-support/RESEARCH_MAP.md).*
- **Validity-gate drill:** plant an all-pass metric candidate; assert it is
  unselectable (the paper's naive-collapse detector as a pin).
- **Poisoning-drill extension:** re-run the existing poison drill; assert
  the poisoned beliefs' d rises and projected support falls *before* the
  contested transition — support should see what custody cannot.
- **Judge-contest drill:** register a judge citing anchor hashes; re-promote
  the anchor; assert the sweep contests the judge and composition refuses
  it (the module-lifecycle drill, retargeted).
- **Ratification-queue drill:** threshold crossing enqueues; nothing
  elevates without the gated CLI; a refused batch changes nothing.
- **Anchored dev fixtures:** ten-item labeled sets per task family,
  committed and byte-pinned like the existing durable corpora.

Paid acceptance (owner-gated, priced from existing telemetry): a sampled
support sweep over the OOLONG corpus (the entailment sweep's $0.0093/25-pair
cost bounds the estimate), and a small anchored calibration run comparing
judge-op verdicts to the anchor labels, reported as agreement with n, in the
`docs/benchmarks/` mold.

## 9. Explicit exclusions

- **No new tier.** Custody stays three-tiered; support is an axis, not a rung.
- **No change to the write path.** Format → existence → retrieval-membership
  enforcement is untouched; the root is fixed by definition.
- **No support-based automatic promotion, registration, or un-contesting**
  (Level 3 is design-only until its pilot).
- **No writer-visible scores, no score-bearing task specs, no score-derived
  incentives anywhere.**
- **No self-evolving metrics in the first edition.** The paper's evolution
  loop (birth gates, shadow tiers, LOO retirement) is the roadmap for
  *scaling the op pool*, not the entry point; the entry point is a small
  hand-authored pool under anchor discipline — the paper's own data shows
  final metrics compose 1–3 leaves and "their exact contents barely matter
  because the lifecycle grows and prunes the pool from there."
- **No archive search.** Corroboration and judging read live blocks only.

## 10. Mechanism map (paper → Trellis seam)

| Paper mechanism | Trellis seam |
|---|---|
| Drawback detector op {drawback, clean, abstain} | new op contract in the sweep workers; existing entailment judge and verification classifier become the first two judge/execution ops |
| Fixed non-evolving root | the write path's gate sequence (already enforced) |
| Metric expression + op pool, reproducible from string | hash-pinned metric registry, `metricSha` (composed-prompt pin discipline) |
| Ten-item anchored dev set, teacher soft labels | committed drill manifests + new ten-item fixtures (durable-corpus discipline) |
| Locked held-out set, never read | held-out anchor fixtures excluded from every loop, reported in `docs/benchmarks/` |
| Fail-closed selection + validity gate | drill-pinned refusals (§8) |
| Birth gate / shadow tier / LOO retirement | deferred (first edition: hand-authored pool) |
| Independent position-debiased final judge | audit-role judge, separate model config, outside all sweeps |
| Task-aware audit rubric | rubric states Trellis contracts (by-reference answers, provenance discipline, hedging) |
| "Anchor cannot be manufactured" | high-`u` honesty for unanchorable claims; no synthetic ground truth |
| Metric-as-capability (not in paper) | module registration + invalidation sweep — the composition this proposal adds |

---

*Summary in one line: fuzzy support, yes — computed, not self-reported; on a
new axis, not a new tier; judged by drawback-detecting, anchor-disciplined,
hash-pinned metrics that are themselves registered capabilities under the
invalidation sweep; with automation of scoring now, ratification-by-batch
next, and automated trust elevation only behind a paired pilot.*
