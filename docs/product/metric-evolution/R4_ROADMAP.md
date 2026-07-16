# R4 roadmap — landing the outer-judge protocol's deterministic core

Status: **DORMANT (NOT sequenced; owner-gated). Execution packaging only.**
This file decomposes `R4_OUTER_JUDGE_PROTOCOL_PROPOSAL.md` (same directory),
which awaits an owner decision. The landing it packages is **ZERO-PAID and
ZERO-LLM**: a deterministic pairing/aggregation core plus a requirements
checklist, no LLM client imported anywhere in the module or its tests.
**Every USE of the landed core — any judge call, any rubric byte — is a
SEPARATE owner-gated PAID proposal** under the standing ≤ USD 5 doctrine.
Do not execute from this file: the live root `HANDOFF.md` drives real
sessions, `TRELLIS_ROADMAP.md` is the root ledger, and the engineering-loop
program (`docs/product/engineering-loop/ROADMAP.md`) is the owner-prioritized
active track, its status read only via `npm run el:activate -- status`. This
file sequences nothing and edits none of them.

## 1. Objective

Land `src/benchmarks/paired_judgment/` (to be created): the proposal §3.1
surface — a seeded, blinded, position-complete pairing plan builder; verdict
aggregation counting a win only when both orders agree, ties first-class,
refusing single-order input typed; a total report type whose field list
derives exactly from `EL-REQ-OBS-008` (`tools/engineering-loop/SPEC.md` §14)
plus rubric id + version and judge model id, all non-optional; and budget
math (calls = exactly 2 × judged pairs, the printed pre-spend estimate line,
a hard call cap in the `entailment_detection.ts` `judgeBudget` mold, refusing
rather than deferring) — with the proposal §3.2 checklist verbatim in the
module doc comment. Scope boundary, per the corrected §7 R4 row of
`docs/architecture/METRIC_EVOLUTION.md`: comparisons mechanical truth decides
are refused scope (Session 28 was decided by computed truths and token
counts); the T2 re-attempt is NOT a consumer; the anticipated first consumer
is the next module positive control.

## 2. Decomposition

### 2.1 The landing — one session, zero-paid

The core is a handful of pure functions plus their tests; a second session
would manufacture handoff overhead. Ordered work items, each mapped to the
proposal §6 criterion items it lands (file detail: `R4_HANDOFF.md` §3–§5):

| # | Work item | Lands §6 items |
|---|---|---|
| 1 | Types first: the per-(pair, order) verdict over blinded labels with first-class abstention; the pairing plan with judge-facing fields typed separately from the unblinding map; the report type carrying the full `EL-REQ-OBS-008` field set non-optional | 1 (the blind type split), 2 (verdict vocabulary), 3 |
| 2 | Pairing plan builder: deterministic given the seed, every pair in both orders, blinded labels randomized per order; no arm name, module name, or run id in any judge-facing field | 1 |
| 3 | Aggregation: both-orders-agree wins, disagreement or abstention → tie, output `{wins_a, wins_b, ties, decided, judged_pairs}` total; single-order input → the typed protocol-violation refusal, computing nothing | 2 |
| 4 | Budget math + estimator: calls = 2 × judged pairs; the printed estimate line matching the plan's arithmetic; the hard call cap refusing an over-cap plan | 4 |
| 5 | Checklist propagation: proposal §3.2 copied verbatim into the module doc comment, presence pinned by test | 5 |

Criterion item 6 (zero LLM invocations; the standing close-out block green)
is landed by the session as a whole, not by any single work item.

### 2.2 First use — NOT this increment

Any increment that calls a judge over a landed plan is a separate
owner-gated PAID proposal. Its proposal instantiates this structural frame;
braces are filled by the using increment — this file invents no numbers:

- Comparison: {Compared_Arms_And_The_Question_Mechanical_Truth_Cannot_Decide}
  — where computed truth decides, the protocol is refused scope.
- Criterion: the proposal §3.2 checklist items 1–6 copied VERBATIM as
  pre-stated criterion items, alongside {Using_Increment_Specific_Criteria}.
- Judge: {Outside_The_Loop_Judge_Model_Id} — not the solver, not any in-loop
  role of the compared runs; the owner decision recorded in the report.
- Rubric: {Using_Increment_Rubric_Id} version
  {Using_Increment_Rubric_Version}, committed and version-stamped before the
  first trial (the `src/rlm/trec_rubric.json` mold); rubric bytes are prompt
  text, authored in the USING increment under Guardrail 15 — both prompt
  skills invoked before any byte. This landing ships zero rubric bytes.
- Spend: {Printed_Estimate_USD} printed before any call by the landed
  estimator; the standing ≤ USD 5 cap; the hard call cap
  {Per_Comparison_Call_Cap} wired upstream of the judge loop.
- Actuals: {Recorded_Actual_USD_Token_And_Call_Counts} recorded with the
  report.
- Report: every `EL-REQ-OBS-008` field populated — raw counts, retries,
  failures, interventions, tokens, cost, unresolved findings — plus rubric
  id + version and judge model id; ties reported, never dropped.

## 3. Dependencies

- **Independent of R1–R3.** No machinery shared with
  `R1_PIN_VACUITY_AUDIT_PROPOSAL.md`,
  `R2_ANCHORED_MEASUREMENT_HARNESS_PROPOSAL.md`, or
  `R3_COMPOSED_ACCEPTANCE_EXPRESSION_PROPOSAL.md`; R4 may land before or
  after any of them.
- **R1's birth-gate discipline is cited for R4's own pins** (a doctrine
  borrow, not a sequencing edge): every typed refusal lands paired — a
  planted violation it fires on, a compliant path it stays clean on.
- **Independent of the engineering-loop program**, the owner-prioritized
  active track; this proposal never preempts it.
- **Independent of the paused Appendix A objective** (`HANDOFF.md` Appendix
  A) and of the Session 28 probe machinery
  (`src/benchmarks/effective_context/`, `scripts/exp_effective_context.ts`)
  — cited as precedent, never touched, byte-identity pins holding.
- **Molds are read, never imported:**
  `src/core/graph/entailment_detection.ts` (the hard cap),
  `src/rlm/trec_rubric.json` (the version field), and `EL-REQ-OBS-008` (the
  report fields).

## 4. Failure handling

1. Any criterion item that cannot be met honestly is a NO LANDING: record a
   dated owner-visible finding in the proposal §8 status ledger (the house
   no-landing discipline — the §5i.6–§5i.8 records are the precedent).
   Never weaken a criterion item to land.
2. Specifically anticipated: if the report type cannot reject partial
   reports at the chosen compile-time enforcement level, take the fallback
   criterion item 3 itself allows — the runtime schema pin, its refusal
   pinned by test — and record the fallback and its reason in the proposal
   §8 ledger, rather than making any `EL-REQ-OBS-008` field optional.
3. If pinned state moved (`src/benchmarks/paired_judgment/` exists; the
   proposal's §3.1/§3.2/§6 bytes differ from `R4_HANDOFF.md` §5's quote; a
   cited file moved), STOP and re-derive; the live `HANDOFF.md` wins.

## 5. Close-out template

Filled by the landing session from observation; content-free until then:

```md
### {YYYY-MM-DD} — R4 landed: the paired-judgment deterministic core

- Result: {Landed_Or_No_Landing_With_Reason}
- Branch/PR: {Branch_And_PR_Reference}
- Files: [{Created_Source_And_Test_Files}]
- Tests: `npm test` {Pre_Session_Test_And_File_Counts} → {Post_Session_Test_And_File_Counts}; zero existing tests changed
- Criterion: §6 items 1–6, each with {Per_Item_Pass_Evidence_Pointer}
- Item-3 enforcement level: {Compile_Time_Or_Runtime_Schema_Pin_With_Reason}
- Standing close-out block: {Green_Or_The_Finding}
- Findings: [{Owner_Visible_Findings_Or_None}]
- Status flips: proposal §8 entry appended; this file §6 updated; `R4_HANDOFF.md` banner flipped
```

## 6. Status ledger

- **July 16, 2026** — Roadmap authored as DORMANT execution packaging
  (branch `d/trellis-paper-analysis-b9bec7`, the proposal's own session
  family). NOT sequenced; owner-gated; the landing zero-paid and zero-LLM;
  every use a separate owner-gated paid proposal. Awaiting owner decision.

---

Close as opened: **DORMANT — NOT sequenced, owner-gated.** This file
sequences nothing, edits nothing live, and authorizes nothing. The landing
is zero-paid and zero-LLM; rubric bytes and judge calls stay out of it, and
every use is a separate owner-gated paid proposal.
