# R2 roadmap — execution packaging for the calibration-anchored hardening of the PAUSED engine-resolved-anchor increment

Status: **DOUBLY DORMANT. This document executes NOTHING by existing.**
Packaging for `R2_ANCHORED_MEASUREMENT_HARNESS_PROPOSAL.md` (this
directory), child of `docs/architecture/METRIC_EVOLUTION.md` §7 R2.

*** THE DOUBLE GATE — READ BEFORE ANY OTHER LINE ***

Every phase below is inert until BOTH gates are open, each opened only
by a recorded owner decision:

- **Gate 1 — re-prioritization.** The owner re-prioritizes the PAUSED
  tooling objective preserved in the live root `HANDOFF.md` Appendix A
  ("retained for history, do not execute"). The owner-prioritized
  active track is the engineering-loop program, whose status is read
  from the acceptance ledger via `npm run el:activate -- status` —
  never from prose, never from this document. This roadmap competes
  with nothing and creates zero execution pressure.
- **Gate 2 — amendment adoption.** The owner ratifies the R2 amendment
  (the proposal's §6 first half, quoted in Phase 0).

The gates are independent; neither implies the other. Neither R2
document ever edits the live `HANDOFF.md` or `TRELLIS_ROADMAP.md` —
those updates belong to the landing session's close-out. Where anything
here or in `R2_HANDOFF.md` conflicts with the live `HANDOFF.md`, **the
live `HANDOFF.md` wins**.

**Terminology (one collision, named once).** *Calibration anchors* are
labeled known-bad/known-good fixtures (`METRIC_EVOLUTION.md` §6.5); the
engine-resolved *anchor substring* of the proposed method is a splice
anchor — a different thing sharing the word.

## 1. Objective

NOW (Phase 0, docs-only): the owner adopts the proposal's §3 amendment
to the paused objective's recorded test strategy (`HANDOFF.md`
Appendix A.3) — fixture↔failure-record provenance, birth-gate pairing
as the admission rule, the §5i.8 multi-insert scenario fixture with a
pinned outcome, raw counts printed and recorded — moving zero
repository bytes outside `docs/`. ON RE-ACTIVATION (Phase 1,
zero-paid): ONE session lands the engine-resolved-anchor guarded insert
in `src/rlm/trellis_textedit.py` exactly as Appendix A shapes it —
design record, implementation, pins — with the four amendments folded
in at their exact steps, so the increment lands in the
anchored-measurement shape on its only pass.

## 2. Phases

### Phase 0 — amendment adoption (docs-only; effective on owner ratification)

The owner ratifies (or declines) the §3 amendment. No repository byte
moves outside `docs/`; the only motion is this file's ledger line (§6).
Criterion landed — the proposal §6 first half, verbatim:

> For THIS proposal (docs-only, effective immediately): it is adopted
> when the owner ratifies the amendment — the criterion is a recorded
> owner decision plus zero repository byte motion outside `docs/`.

Mechanics added (nothing else): record the decision as
{Gate2_Owner_Decision_Reference} in §5/§6. Phase 0 does NOT open
Gate 1 and schedules nothing.

### Phase 1 — the re-activated increment, ONE zero-paid session (both gates open)

Executed by `R2_HANDOFF.md` §3 (Appendix A.1's sequence with the
amendments woven in). The in-session order is fixed:

1. **Design-record section first** — extend
   `docs/architecture/STRUCTURAL_SPLICE.md` (its §6 criterion is the
   mold; its §3 family is what the new method joins): contract,
   uniqueness/refusal semantics, terminator rule, the
   one-method-vs-twin-vs-batch decision, honest scope. Amendment 3
   binds HERE: the section records the batch decision AND pre-states
   the §5i.8 scenario fixture's pinned outcome under whichever branch.
   No code byte before the section exists.
2. **Implementation** — the additive guarded method in
   `src/rlm/trellis_textedit.py` beside the Session 41 family, reusing
   its staging/containment/budget/`write_back` machinery.
3. **Addendum and pins** — Guardrail 15 BEFORE the addendum bytes; the
   composed-prompt pin ceremony (`test:modules` [4]/[7]) in the same
   commit; then the new `test:textedit` section. Amendments 1, 2, 4
   bind HERE: every planted violation carries its §5i citation (or an
   explicit synthetic marker), every new detection branch is admitted
   only as a birth-gate pair, the section prints checks-run/fired/clean
   raw counts.
4. **Close** — the full standing drill block, then the landing
   session's documents. Amendment 4's second half binds HERE: the
   `TRELLIS_ROADMAP.md` §5 entry records the raw counts beside the
   criterion verdict.

Criterion landed: Appendix A.3's criterion in full (restated in
`R2_HANDOFF.md` §5), PLUS the proposal §6 second half, verbatim:

> For the INCREMENT on re-activation — Appendix A.3's criterion stands
> in full, PLUS, zero-paid, zero-LLM, all four required:
>
> 1. Every planted violation in the new drill sections carries its §5i
>    citation (or an explicit synthetic marker); a reviewer can trace
>    each calibration anchor to the recorded failure it reproduces.
> 2. Every new detection branch is birth-gate paired (fires on the
>    planted violation, clean on the adjacent known-good), and the
>    drill would go red if either half were removed.
> 3. The §5i.8 multi-insert scenario fixture exists with its outcome
>    pinned per the design record's batch decision; the naive §5i.8
>    calling pattern has an asserted typed behavior (never silent
>    corruption).
> 4. The drill prints raw counts and the roadmap §5 entry records them
>    beside the criterion verdict.

("The roadmap §5 entry" = the landing session's full-dated entry in
`TRELLIS_ROADMAP.md` §5; the §5 template below mirrors it.)

## 3. Dependencies

- **The double gate — the only sequencing dependency.**
- **Independent of R1/R3/R4 landing.** Amendment 2 carries the pairing
  rule in its own text, so Phase 1 does not wait on R1 — but the
  discipline is R1's (`R1_PIN_VACUITY_AUDIT_PROPOSAL.md` defines the
  birth-gate pairing cited here), and §5i.6 is honestly R1 territory:
  a pin mis-written in the firing direction is a test-authoring
  failure this drill cannot reproduce.
- **The T2 re-attempt stays OUTSIDE** — a separate later owner-approved
  PAID proposal (Appendix A's gate, unchanged); nothing here schedules
  or prices it.

## 4. Failure handling

Appendix A.1's own rule, carried: if the design surfaces a reason the
engine-resolved anchor cannot be built additively (an unexpected
coupling in the staging machinery), STOP and record it in the design
record as an owner-visible finding — never force the implementation,
never weaken a Session 41 pin. A miss on ANY criterion item is a FAILED
increment even when every other item passes: record the raw number, the
diagnosis, and the diagnostic number, then stop — the owner adjudicates
(Guardrail 8's mold). A blocker returns the objective to the owner.

## 5. Close-out template (structural frame — fill only with observed values, never invented ones)

- {Gate2_Date} — amendment ratified: {Gate2_Owner_Decision_Reference}.
  Zero repository bytes moved outside `docs/`.
- {Gate1_Date} — Appendix A objective re-prioritized:
  {Gate1_Owner_Decision_Reference}.
- {Landing_Date} — increment landed (PR {PR_Number}):
  `STRUCTURAL_SPLICE.md` gained {New_Section_Number}; batch decision =
  {One_Method_Or_Twin_Or_Batch_With_Recorded_Reason}; new method =
  {Method_Name_As_Recorded}; composed-prompt pins =
  {Recomputed_Or_Verified_Unchanged_Per_R2_HANDOFF_Section_6}; drill
  raw counts = {Drill_Section_Counts_Checks_Fired_Clean}; `npm test`
  {Baseline_Count} → {Grown_Count}, zero existing tests changed;
  criterion = {Item_By_Item_Verdict_A3_Plus_R2_Items_1_To_4}; the same
  counts recorded in the `TRELLIS_ROADMAP.md` §5 entry.
- {Date_If_Blocked} — design-record blocker:
  {Owner_Visible_Finding_Reference}; objective returned to the owner.

## 6. Status ledger

- July 16, 2026 — packaging authored (branch
  `d/trellis-paper-analysis-b9bec7`) beside the proposal. DOUBLY
  DORMANT: Gate 1 closed (Appendix A PAUSED; the engineering-loop
  program is the owner-prioritized track), Gate 2 closed (amendment
  awaiting owner decision). No execution, no sequencing claim, no edit
  to any live planning document.

*** THE DOUBLE GATE, RESTATED AT CLOSE ***

Nothing here runs until the owner BOTH re-prioritizes the paused
`HANDOFF.md` Appendix A objective (Gate 1) AND ratifies the R2
amendment (Gate 2) — two separate recorded owner decisions. Until then
this document is an archive of intent, and the live `HANDOFF.md`
overrides it wherever they disagree.
