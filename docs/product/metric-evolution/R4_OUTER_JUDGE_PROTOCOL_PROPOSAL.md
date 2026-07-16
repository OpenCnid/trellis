# R4 proposal — the outer-judge protocol for paired comparisons

Status: **PROPOSAL (NOT sequenced, NOT ratified; owner-gated).** Child of
`docs/architecture/METRIC_EVOLUTION.md` §7 R4; the paper's Appendix D
final-judge protocol, landed as a zero-paid deterministic core plus a
requirements checklist any paid use must satisfy. The landing itself spends
nothing; every use is a separate owner-gated proposal under the standing
paid doctrine (estimate printed first, ≤ USD 5 per run).

## 1. The failure class

**Unprotocoled judgment in paid comparisons.** Where a comparison's outcome
is decided mechanically, no judge belongs in the path — the Session 28
positive control was decided by computed truths and token counts, and the
paused T2 re-attempt's acceptance is the checker at zero findings; neither
needs this proposal (stated against the parent record's looser framing,
which listed the T2 re-attempt as a candidate consumer — it is not one).
The gap is comparisons where mechanical truth does not decide preference —
"is the module-on arm's *output* better?", any future report/answer-quality
control (the anticipated first consumer: a module #2 positive control, per
the collaborator-topic constraint that candidates be positive-control-
testable). For those, an unprotocoled LLM judgment has three documented
failure modes, all quantified in the paper:

1. **Position bias** — single-order pairwise judging is corrupted by
   presentation order; the paper's protocol judges every pair twice with
   positions swapped and counts a win only when both orders agree.
2. **Generic-rubric mis-grading** — a judge without the domain's format
   contract graded the *better* outputs as worse (preferred the baseline in
   ~88% of decided pairs, before AND after the defect was repaired), because
   it penalized the contract itself. Task-aware rubric or the measurement is
   noise.
3. **In-loop contamination** — a judge that participates in the loop it
   grades (same model role, same prompt lineage, reward-adjacent) can be
   co-opted by whatever games the loop learned; the paper's Goodhart episode
   was caught precisely because the judge sat outside all loops.

The repo has the adjacent machinery but not the protocol: the Session 28
paired-control mold (arms, computed truths, Guardrail 4's
counts-and-correctness-together), the entailment judge's budget-capped
detector-not-gate mold, and the versioned-rubric mold (`trec_rubric.json`:
version bump → mandatory re-check). Nothing composes them into a paired-
judgment standard.

## 2. The decision space

### 2.1 Judge each pair once (half the cost) — REJECTED

Position bias is the documented failure the protocol exists to kill. The
saved calls are repaid as an unquantifiable directional error in the
headline number. Cost control comes from the pair count and the budget cap,
never from unpairing the orders.

### 2.2 Absolute scoring (a 1–10 rubric per output, compare means) — REJECTED

Unanchored absolute scores drift with context and model temperament;
pairwise preference under an agreement rule is the robust primitive, and it
is what the paper validated. (Trellis's own graders are pass/fail at a
root for the same reason — `METRIC_EVOLUTION.md` §2.1.)

### 2.3 Reuse the entailment-judge machinery — REJECTED

Different role, wrong shape: the entailment judge scores single
`(edge, cited-hash)` pairs against a fixed house rubric inside the
provenance machinery, and its judged-at-most-once/detector-not-gate
invariants are load-bearing there (guardrail 3). The outer judge must sit
OUTSIDE the loop it audits, on a per-comparison rubric. Molds are borrowed
(budget cap, typed roles); machinery is not shared.

### 2.4 A deterministic pairing/aggregation core + per-use frozen task-aware rubric + outside-the-loop judge — CHOSEN

Everything deterministic lands now, unit-pinned, zero-paid. Everything
paid or domain-specific (the judge calls, the rubric bytes) belongs to the
using increment, which inherits a checklist it must satisfy verbatim.

## 3. The surface

### 3.1 The deterministic core (lands with this increment)

Pure functions under `src/benchmarks/paired_judgment/`, no LLM call
anywhere in the module or its tests:

- **Pairing plan.** Input: two arms' output sets keyed by task id, a seed.
  Output: every pair duplicated position-swapped, arm identities replaced
  by blinded labels randomized per order (deterministic given the seed).
  The judge-facing plan carries no arm names, module names, or run ids.
- **Verdict aggregation.** Input: per-(pair, order) judge verdicts. A win
  is counted only when both orders agree; disagreement or either-order
  abstention is a tie. Output is typed and total: `{wins_a, wins_b, ties,
  decided, judged_pairs}` — ties are first-class, never dropped silently.
  Feeding it single-order data is a typed refusal (protocol violation),
  not a degraded computation.
- **The report shape.** One structure carrying, together and mandatorily:
  the aggregation, raw call counts, retries and failures, tokens and cost,
  rubric id + version, judge model id, and unresolved anomalies — the
  `EL-REQ-OBS-008` fields, made non-optional at the type level so a
  partial report does not typecheck.
- **Budget math.** Judge calls = exactly 2 × judged pairs; a pure
  estimator over the plan produces the printed pre-spend estimate line
  (the paid doctrine's artifact) and the hard per-comparison call cap (the
  entailment `judgeBudget` mold).

### 3.2 The protocol checklist (requirements any using increment copies into its own criterion)

1. **Judge outside the loop:** the judge model is not the solver and not
   any in-loop role of the compared runs; stronger than or at minimum a
   different family from the solver (per-use owner decision, recorded in
   the report).
2. **Task-aware rubric, frozen and versioned:** the rubric encodes the
   domain's format contract (for house domains: the provenance/citation
   contract, UPSUM shape, answer-channel discipline — whichever the
   compared artifact carries); it is committed and version-stamped before
   the first trial (HANDOFF §7 rule 3: grader rules immutable before
   observation; the `trec_rubric.json` versioning mold), and the report
   records the version.
3. **Rubric bytes are prompt text:** authored in the USING increment under
   Guardrail 15 (both prompt skills invoked before writing) — this
   proposal deliberately lands zero rubric bytes.
4. **Blinding:** the judge sees blinded labels only; unblinding happens in
   aggregation, after verdicts are recorded.
5. **Each (pair, order) judged at most once** per comparison; retries are
   counted retries of failed calls, never re-rolls of disliked verdicts.
6. **Spend:** printed estimate before any call; the standing ≤ USD 5 cap;
   actuals recorded with the report.

## 4. What this PREVENTS vs what it only DETECTS (honest scope)

- **Prevented (at the type/refusal level):** position-biased headline
  numbers (single-order data refuses); silently vanished ties; partial
  reports (non-optional fields); unblinded judging (the plan never carries
  identities).
- **Detected:** nothing by itself — the protocol is measurement
  infrastructure. The Goodhart-tripwire property comes from the layered
  use (task-aware rubric + outside judge + raw ties reported), not from
  any single layer, and a rubric can itself be gamed; when that happens the
  repair loop is R-family territory (a new detector, per the paper's
  episode), not a silent rubric edit mid-comparison.
- **Not claimed:** that judged preference equals truth; that the paper's
  magnitudes (e.g., 0.770 post-repair) transfer to any Trellis domain; or
  that this protocol applies where computed truth decides (it is refused
  scope there — use the truth).

## 5. Increment sequencing

Independent of R1–R3 (shares R1's birth-gate discipline for its own pins).
Anticipated first consumer: the next module positive control whose output
quality is not mechanically computable. Uses are individually owner-gated
paid proposals; this landing creates no standing spend and adds no drill to
the close-out block this edition (the module's vitest suite carries the
pins).

## 6. Pre-stated acceptance criterion

Zero-paid, zero-LLM, all six required:

1. The pairing plan is pinned deterministic (same inputs + seed → identical
   plan), position-complete (every pair appears in both orders), and blind
   (a test asserts no arm identifier substring survives into any
   judge-facing field).
2. Aggregation pins cover: both-orders-agree wins (each direction),
   disagreement → tie, abstention → tie, and the planted protocol
   violation — single-order input refuses typed, computing nothing
   (birth-gate pairing per R1: each refusal fires on its planted violation
   and stays clean on the compliant path).
3. The report type rejects partial reports at compile time (a fixture
   omitting cost/tokens/rubric-version does not typecheck, asserted via a
   type-level test or a runtime schema pin — implementation's choice,
   pinned either way).
4. Budget math pins: calls = 2 × pairs on asymmetric fixtures; the
   estimator's printed line matches the plan's arithmetic; the call cap
   refuses a plan exceeding it before any spawn path is reached.
5. The protocol checklist (§3.2) appears verbatim in the landed module's
   doc comment and in this record — the using increment's proposal copies
   it as criterion items, and the checklist's Guardrail 15 line is present.
6. Zero LLM invocations anywhere in the module and its tests (no judge
   client import in the landing); the standing close-out block green.

## 7. What does not change

The Session 28 probe machinery and its byte-identity pins (`module_arm`
untouched; if a future use compares module arms, it goes through the
existing `TRELLIS_EXP_MODULES` path unchanged); the entailment judge and
its guardrail-3 invariants; `trec_rubric.json` (the mold is cited, the file
untouched); the paid doctrine (uses inherit it, never soften it); human
acceptance authority — a judged comparison produces evidence, and evidence
does not accept increments.

## 8. Status ledger

- July 16, 2026 — proposal authored (session, branch
  `d/trellis-paper-analysis-b9bec7`), child of `METRIC_EVOLUTION.md` §7 R4.
  NOT sequenced; awaiting owner decision. Corrects the parent record's
  consumer list: the T2 re-attempt is mechanically decided and is NOT a
  consumer of this protocol.
