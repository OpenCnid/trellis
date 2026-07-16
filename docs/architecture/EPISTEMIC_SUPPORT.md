# Epistemic Support — Design Record (Adopted Forward Design)

**Status: ADOPTED as forward design by owner ruling, July 16, 2026.**
Implementation is incremental and separately gated per feature; as of
adoption, exactly one bounded feature is authorized and implemented:
the support-computation oracle drill (`npm run test:support-oracle`).
Nothing else is built. This record is doctrine for what gets built and
how; the program's working documents live in
[`docs/product/epistemic-support/`](../product/epistemic-support/PROGRAM_CONTEXT.md),
and its evidence register (8 sources, 24 claims, adoption bounds
AB-1…AB-11) is
[`RESEARCH_MAP.md`](../product/epistemic-support/RESEARCH_MAP.md).
Historical origin: the sister-lab proposal
`docs/review/06_EPISTEMIC_SUPPORT_PROPOSAL.md`, accepted with the
rulings recorded in
[`PROGRAM_CONTEXT.md`](../product/epistemic-support/PROGRAM_CONTEXT.md) §6.

## 1. Doctrine

Trellis beliefs acquire a second, orthogonal axis:

- **Custody** (existing, unchanged): *where did this come from?*
  Discrete, structural, enforced at the single write path, elevated
  only through human-gated ceremonies. Provenance proves origin, never
  correctness.
- **Epistemic support** (this record): *how has it held up?* A graded,
  decaying opinion — belief mass `b`, disbelief mass `d`, uncertainty
  `u`, with `b + d + u = 1` — computed sweep-side from **judged
  events**, never asserted by the writer.

Three rules keep the axes apart, each enforced in tooling and pinned:

1. **Support never mints custody.** No opinion, however strong, causes
   a tier crossing or substitutes for `sourceNodeIds` validation.
2. **Custody never implies support.** A freshly written belief starts
   at maximal uncertainty.
3. **The writer is blind.** No support quantity, judge output, or
   panel structure is visible to the writing agent; no task spec or
   rubric rewards a countable proxy. (Origin: the citation-laundering
   A/B, the S1 Goodhart episode, and the S8 report/behavior
   dissociation — three independent observations of one law.)

### 1.1 Plane geometry (bounded)

Axes ship only as members of a **named plane** owning one governance
question with its own coherence rules: custody (exists), support (this
record), and a **named-but-deferred claim-kind plane** (*what kind of
claim is it?* — grounding, scope, modality as bipolar positions, judged,
never writer-authoritative). A new plane requires a governance question
no existing plane answers, plus its own drill sections, before any
consumer reads it. Claim-kind's engine role, when it enters, is op-pool
routing: a claim's grounding position predicts which op families can
render non-abstaining verdicts.

## 2. The support state

Per belief, additive optional fields (legacy behavior byte-identical
when absent): the opinion `(b, d, u)`, a derived scalar `projected`,
`asOf`, and the hash-pinned identity of the metric that produced it
(`metricId`, `metricSha`). Writer-supplied `confidence` remains stored
as an audit fact about the writer's claim and **never enters the
computation** (the poisoning drill wrote poison at confidence 0.97 —
the standing proof).

## 3. v1 support arithmetic (normative; drill-pinned)

Ratified with the oracle drill; amendable only with a same-commit
re-pin of the drill's expected-values fixture. The reference
implementation is `src/core/graph/support.ts`; the independent
generator (`fixtures/support_oracle/generate_expected.ts`) implements
this section separately and must not import the module it checks.

- **Event:** `(beliefId, opId, verdict ∈ {drawback, clean, abstain},
  atMs, weight w ≥ 0)`; unknown fields are ignored structurally (there
  is no field by which writer confidence could enter). An event with
  `atMs > asOf` is a refused input, not a zero-weight one.
- **Canonical order:** events are sorted by `(beliefId, opId, atMs,
  verdict)` before accumulation; floating-point accumulation order is
  therefore deterministic.
- **Decay:** `w_eff = w · 2^(−(asOf − atMs)/halfLifeMs)`.
- **Evidence masses:** `r = Σ w_eff` over `clean` events, `s = Σ w_eff`
  over `drawback` events. `abstain` contributes to neither — abstention
  reaches the opinion only as the *absence* of evidence (and is counted
  in telemetry).
- **Opinion:** with prior weight `W` (v1 default 2) and base rate `a`
  (v1 default 0.5): `denom = r + s + W`; `b = r/denom`; `d = s/denom`;
  `u = W/denom`; `projected = b + a·u`.
- **Properties (each a drill section):** `b + d + u = 1` (±1e-9);
  all-abstain histories yield `(0, 0, 1)`; over a verdict-free gap, `u`
  is monotonically non-decreasing as `asOf` advances; output is
  byte-identical whether or not a `confidence` field is present on the
  input records.

## 4. v1 metric expressions (normative; drill-pinned)

A support metric is an expression over op verdict streams in the
composition grammar: `leaf(opId)`, `any[…]`, `all[…]`, `kofk(K)[…]`.
Abstaining children are excluded from their combinator; a node whose
children all abstain abstains. `any` is a drawback if any
non-abstaining child finds one; `all` only if all do; `kofk` if at
least K do. A metric is reproducible from its expression string plus
the registered op pool, and is identified by `metricSha`.

**Validity gate (mandatory, fail-closed):** evaluated against a
calibration verdict set, a candidate that produces the same verdict
class on every belief (all-drawback, all-clean, or all-abstain) is
refused with a typed vacuity class. Selection without a usable anchor
opinion is refusal, not default acceptance. (Origin: S1's naive
ablation, where removing exactly these guards collapsed the metric on
three of three seeds. Anchor drift, not pool drift, is the watched
failure.)

## 5. The judge layer

Judged events come from a panel of **differently-blind roles** —
grounding, coherence, corroboration, and an audit role that judges
judges rather than beliefs, sits outside every loop, and can only
contest a judge as a capability. The design record is
[`FOUR_JUDGE_DESIGN.md`](../product/epistemic-support/FOUR_JUDGE_DESIGN.md);
prompt-facing contracts are
[`JUDGE_CONTRACT_TEMPLATE.md`](../product/epistemic-support/JUDGE_CONTRACT_TEMPLATE.md);
rubric construction is
[`COMPOSABLE_RUBRICS_DESIGN.md`](../product/epistemic-support/COMPOSABLE_RUBRICS_DESIGN.md).
Judges and metrics are **registered capabilities**: manifests citing
rubric and anchor hashes, contested by the ordinary invalidation sweep
when their evidentiary basis moves — the capability flywheel applied to
evaluators.

Anchor discipline binds every judge and metric: committed, byte-pinned
ten-item fixtures (labels may be model-produced per the AB-4 ruling of
July 16, 2026; fixtures are pinned once labeled and refreshed only by
human ceremony), a locked held-out set no loop reads, and the validity
gate above.

## 6. Automation ladder

Scoring is automated (sweep-side); **trust elevation is not**. Beliefs
crossing pre-stated thresholds queue for *batch* human ratification;
beliefs whose disbelief crosses a threshold enter the existing
contested flow. Automating any tier crossing itself requires a paired
pilot with pre-stated criteria and an owner verdict — the engineering
loop's premise ("an agent must not forge the record of its own
success") applies verbatim to a judge that could elevate beliefs.

## 7. Enforcement homes and pins

| Behavior | Enforcement home | Pin |
|---|---|---|
| Opinion arithmetic, abstain routing, decay | `src/core/graph/support.ts` (pure) | `npm run test:support-oracle` sections [arithmetic]/[abstain-routing]/[decay] |
| Writer-confidence exclusion | event type has no confidence path | drill section [confidence-exclusion] |
| Vacuous metrics refused | `src/core/graph/support_metrics.ts` validity gate | drill section [validity-gate] |
| Fixture integrity | SHA-256 manifest checked before any section | drill section [manifest]; refusal halts |
| Harness can fail loudly | committed broken-fixture negative control | drill `--negative-control` must exit nonzero |
| Everything else (judges, sweep, registration, ratification queue) | **not yet built** — each is a separately gated bounded feature | named in its own proposal before implementation |

## 8. Exclusions (standing)

No new tier; no change to the write path; no support-based automatic
promotion, registration, or un-contesting; no writer-visible scores;
no evolution/search machinery in first editions (AB-8); corroboration
and judging read live blocks only (hard rule 13). The adoption-bounds
register (RESEARCH_MAP §9) binds all future work under this record and
is amended only by dated entry.
