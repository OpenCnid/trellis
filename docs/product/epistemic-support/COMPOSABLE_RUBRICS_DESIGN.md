# Composable Rubrics — Design Record

**Status: PROPOSED — DESIGN ONLY.** July 16, 2026. Authorized as a
design direction by owner decision #4 (PROGRAM_CONTEXT §6): *"We're
going to need to build our own rubric and system here. The research is
brand new, no software available, but there is rubric data and outcome
data. We can reconstruct this from the research and incorporate the
WonderSuite conceptual primitives strategy to build adaptively-aligned
judges with composable rubrics."* Implementation is not authorized by
this record.

Parent doctrine: [`docs/architecture/EPISTEMIC_SUPPORT.md`](../../architecture/EPISTEMIC_SUPPORT.md).
Judge architecture: [`FOUR_JUDGE_DESIGN.md`](FOUR_JUDGE_DESIGN.md).
Contract frames: [`JUDGE_CONTRACT_TEMPLATE.md`](JUDGE_CONTRACT_TEMPLATE.md).
Binding bounds: AB-1, AB-3, AB-5, AB-8 (RESEARCH_MAP §9).

---

## 1. Problem statement

The four judge roles need rubrics — the `{Rubric_Sha}` targets of every
contract frame — and no off-the-shelf system exists: S1 (arXiv:2607.12790)
is days old and its software, while stated as released (Appendix H),
has **no locator recovered yet** (sharing-queue row 2, now the
program's top acquisition priority). What S1 does provide, once
located, is exactly the raw material a reconstruction needs: the
generic and task-aware judge rubrics from its 2×2, typed op specs
(drawback detectors with birth-gate statistics), per-round op-pool
histories, and outcome data (win rates, agreement scores) tying rubric
variants to measured consequences.

The design problem: rubrics must be **numerous** (four roles × claim
families × conventions in force), **auditable** (a rubric is a
capability with a hash and an anchor set), and **cheap to produce
correctly** — which rules out hand-writing each one as monolithic
prose. The answer is composition over a small closed vocabulary:
combinatorics, with guards.

## 2. The three-layer design

### 2.1 Rubric primitives (the vocabulary)

A **rubric primitive** is a typed, single-question check in the S7
Open-Variable *shape* but with Trellis semantics: the structure is an
engine-side data object the harness resolves — never free prose the
model interprets (AB-1). Each primitive maps 1:1 to a drawback class in
its role's closed taxonomy ("one question per op",
JUDGE_CONTRACT_TEMPLATE §6.4):

```jsonc
{
  "primitive": "{Check_Name}",
  "role": "(J1_GROUNDING | J2_COHERENCE | J3_CORROBORATION | J4_AUDIT)",
  "question": "${One_Decidable_Question_Text}",
  "drawbackClass": "{Class_From_Role_Taxonomy}",
  "inputs": ["{Declared_Context_Fields_Only}"],
  "costTier": "(static | execution | judge)"
}
```

Draft primitive families per role (illustrative, to be reconciled
against S1's op packs when located): J1 — support/overclaim/
contradiction checks against cited spans; J2 — self-consistency,
history-consistency, kind-coherence checks; J3 — corroboration
presence, authority contradiction, ambiguity checks; J4 — rubric-gaming,
convention-blindness, drift checks. The `inputs` field is the blindness
profile made mechanical: a primitive whose inputs exceed its role's
declared visibility is refused at registration.

### 2.2 Composition (the combinatorics)

A **rubric** is a hash-pinned expression over primitives in the
already-ratified metric grammar (`any` / `all` / `kofk`, abstain-aware
— EPISTEMIC_SUPPORT §4). Composition is where the combinatorial power
lives: a small closed vocabulary of primitives yields a large space of
rubrics, every one of which is reproducible from its expression string
plus the primitive registry, inspectable leaf-by-leaf, and diagnosable
when it fails (S1's measured argument for composition over monolithic
judges: composed metrics beat the bare judge they contain, and
legibility is what made their Goodhart repair a one-detector fix).

Guards, inherited and mandatory: the **validity gate** (a composition
that is vacuous on the calibration set is refused), **anchor
discipline** (a composition is a judge configuration; it gets a
ten-item anchor fixture before load-bearing use — labels model-produced
per the AB-4 ruling, byte-pinned once labeled), and **no evolution in
first editions** (AB-8: compositions are hand-authored or exhaustively
enumerated from small sets; search machinery re-enters only behind its
own measured proposal).

### 2.3 Adaptive alignment (the selection)

"Adaptively-aligned" means the rubric *selection* fits the claim, not
that the rubric mutates: for a given judged item, the harness selects a
registered composition by deterministic, logged rules over the item's
observable coordinates — its claim-kind position when that plane
exists (op-pool routing, EPISTEMIC_SUPPORT §1.1), its detectability
regime (mechanical ops for empirical-pole claims, judge ops where only
semantics decides), and the conventions in force (which
`task_contract` items J4's rubric must state). Selection is
harness-side and auditable; **the judged model never selects or sees
its own rubric**, and the writing model never sees any of it (AB-5).
This is S7's "coherence calibration" and S8's context-dependent
workspace occupancy translated into tooling: same claim, different
task, different — but deterministic — rubric.

## 3. Reconstruction plan (from S1's released data, once located)

1. **Recover the artifacts** (blocking, sharing-queue row 2): the
   generic + task-aware final-judge rubrics, op-pack specs, birth-gate
   stats, and the 2×2 outcome records.
2. **Re-express S1's rubrics as primitive sets**: decompose each rubric
   line into single-question primitives; anything that resists
   decomposition is recorded as a candidate *new* primitive family.
3. **Calibrate against outcome data**: S1's win-rate deltas
   (0.122/0.126/0.515/0.770) identify which rubric lines carried
   measured weight — those become the seed primitives; lines with no
   measurable consequence are recorded but not seeded.
4. **Author the v1 compositions**: one hand-authored rubric per role
   (J1's grounding rubric first — its entailment core already exists in
   `entailment_detection.ts`), each with its anchor fixture.
5. **Drill before load** (AB-3): schema validation, blindness-input
   refusals, and validity-gate sections extend the existing oracle
   drill machinery zero-paid; judge-op calibration against anchors is
   the separately gated paid step.

## 4. Behavior → enforcement → pin

| Behavior | Tooling that enforces it | Pin that detects drift |
|---|---|---|
| One question per primitive, closed taxonomies | primitive registry schema; unknown class refused | registry unit pins |
| Blindness profiles mechanical | `inputs` validated against role visibility at registration | registration refusal drill section |
| Rubrics reproducible and pinned | expression string + registry version → `rubricSha` | hash pins; editing = new registration |
| Vacuous compositions refused | validity gate over calibration set | drill section (planted vacuous composition) |
| Selection deterministic and writer-blind | harness-side selection rules, logged; no model-visible surface | selection unit pins + kernel-prompt absence pin |
| No count-shaped rubric lines | rubric linter refuses reward-count patterns | linter unit pins (AB-5) |

## 5. Open questions

1. The S1 artifact locator (blocks §3.1; everything else can proceed
   on the draft primitive families).
2. Whether J4's audit rubrics should themselves be composable or
   deliberately monolithic (a composed auditor shares structure with
   what it audits — possible common-mode risk; record both options,
   measure at point of load).
3. Primitive granularity: when a "single question" hides two decisions,
   the split rule needs a worked convention (S1's clustered-miss
   taxonomy is the candidate method).
4. How outcome data maps to composition *weights* once weighted
   combinators are wanted — deferred with the aggregation constants
   (EPISTEMIC_SUPPORT §3 v1 defaults stand until a drill re-pin).
