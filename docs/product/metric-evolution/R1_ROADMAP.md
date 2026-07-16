# R1 roadmap — pin-vacuity audit, edition 1 (execution packaging, DORMANT)

Status: **DORMANT — NOT sequenced — owner-gated.** This roadmap packages
`R1_PIN_VACUITY_AUDIT_PROPOSAL.md` for execution *if and when the owner
sequences it*. It does not compete with the engineering-loop program, which is
the owner-prioritized active track; that program's status is read from the
acceptance ledger (`npm run el:activate -- status`), never from prose.
Activation of R1 is an explicit owner decision. Until that decision is
recorded, no session executes any line of this file. `TRELLIS_ROADMAP.md`
remains the root ledger and the live root `HANDOFF.md` drives real sessions;
this file edits neither and defers to both.

## 1. Objective

Close the pin-vacuity failure class for the four acceptance-critical drills
(`test:textedit`, `test:selfedit-harness`, `stage2:check`, `test:modules`):
build the single-source inventory manifest (`docs/benchmarks/pin_inventory.json`
plus prose companion `docs/benchmarks/PIN_INVENTORY.md`) classifying every
check as `demonstrated` | `structural` | `unfixtured` with firing evidence,
plant a paired known-bad fixture for every row that starts `unfixtured`, and
add count pins so each covered drill asserts its executed-check count against
the manifest — all zero-paid, zero-LLM, additive-only, per the proposal's §6
pre-stated acceptance criterion (quoted verbatim in `R1_HANDOFF.md` §5; that
criterion is immutable and this packaging only adds session mechanics to it).

## 2. Session decomposition

Two sessions. The split is grounded in what the drills actually contain: the
four bodies together hold roughly 250 runtime checks (grep-counted call sites:
75 `check(` + 54 `expect_raises(` in `scripts/test_textedit.py`, 64 `check(`
in `scripts/test_selfedit_harness.ts`, 50 + 8 in `scripts/test_modules.py`,
with loops multiplying several call sites at runtime), two implementation
languages, one drill (`stage2:check`) that has no scripted check list at all
and needs its count-pin shape *designed*, and an unmeasured fixture backlog.
One session covering all of that is the diffuse-diff anti-pattern the
proposal's §2.1 already rejected at larger scope. Two bounded sessions keep
each diff reviewable; the schema is designed once, in session 1, against all
four observed drill shapes, so session 2 never reopens it.

### Session R1-S1 — prove the mechanism end-to-end on `test:modules`

- **Entry state:** owner has sequenced R1; fresh branch; pre-flight green per
  `R1_HANDOFF.md` §2; the repository states pinned in `R1_HANDOFF.md` §4
  re-verified (STOP and re-derive if any moved).
- **Work items (numbered = sequential):**
  1. Design the manifest schema FIRST and record it in
     `docs/benchmarks/PIN_INVENTORY.md` before any tally byte moves. The
     schema must already express the shapes observed in ALL FOUR drills:
     loop-born checks (one call site executing several checks at runtime),
     environment-conditional checks (the harness's `[SKIP]` branch), and
     detector-inventory rows (the `stage2:check` finding codes).
  2. Enumerate `test:modules` checks at RUNTIME (not by source grep — loops
     multiply call sites), classify every row, and write the manifest slice
     plus prose rationale for each `structural` row (the section [4]/[7]
     composed-prompt SHA pins are the expected exemplars of that class).
  3. Add the executed-check tally inside the drill's `check()` helper
     (`scripts/test_modules.py`), print the total beside the existing summary
     line, and assert it equals the manifest count for this drill.
  4. Plant a paired known-bad fixture for every `test:modules` row that
     began `unfixtured`; each fixture comment cites what it reproduces.
  5. Perform the criterion's deliberate uncommitted mutation observation on
     this drill (one check commented out, one added — observed red both
     ways, reverted, recorded).
  6. Run the full standing close-out block (non-markdown bytes moved).
- **Proposal-criterion items landed:** items 1–3 for the `test:modules`
  slice; item 4 in full for the bytes this session moves; items 5–6 for this
  session's scope.
- **Exit state:** manifest schema frozen; one drill fully covered, fixtured,
  count-pinned, and mutation-verified; measured counts recorded in a §5 entry
  below and in the `TRELLIS_ROADMAP.md` §5 session entry.

### Session R1-S2 — extend to the remaining three drills and close the criterion

- **Entry state:** R1-S1 landed; schema frozen; pre-flight green; pinned
  states re-verified.
- **Work items:**
  1. `scripts/test_textedit.py` (largest body, sections [1]–[14]): runtime
     enumeration, classification, tally in its `check()` helper, fixtures
     for every unfixtured row, mutation observation.
  2. `scripts/test_selfedit_harness.ts` (sections [1]–[9] incl. [3b]): same,
     plus the skip-accounting design its environment-conditional
     live-substrate block requires (executed + skipped-with-reason must
     reconcile to the manifest total — a flat executed==manifest equality
     would flap across stacks).
  3. `stage2:check`: pin the twelve-code detector inventory
     (`SelfEditFindingCode`, `src/benchmarks/selfedit/check.ts`) against the
     manifest via the source-parse mold (`src/` stays read-only), map each
     code to the harness check that drives it, and fixture any code nothing
     drives; mutation observation in the inventory-pin shape.
  4. Full standing close-out block; then the close-out actions named in
     `R1_HANDOFF.md` §8 (root ledger entry, proposal §8 ledger append,
     status flips here and in the handoff).
- **Proposal-criterion items landed:** items 1–6 complete — zero rows
  `unfixtured` at close, all four count pins live and mutation-verified.
- **Exit state:** edition 1 closed; the proposal's §5 extension trigger
  (remaining drills of the block) stands recorded, not scheduled.

## 3. Dependencies

- On other proposals: **none.** R1 is self-contained (proposal §5); it
  depends on no R2/R3/R4 byte and on no paused track.
- Ordering preference: R3 and R4 cite R1's birth-gate discipline as their
  fixture vocabulary, so R1-first is *preferred* — but it is not required,
  and nothing blocks the owner sequencing them in another order.
- On the engineering-loop program: none in either direction. R1 touches
  drill scripts and docs only; the EL program's authority chain is untouched
  (proposal §7).

## 4. Failure handling

- A blocker (a check that cannot be classified honestly, a tally that cannot
  be added additively, a fixture backlog that defeats the session bound) is
  recorded as an owner-visible finding in the proposal's §8 status ledger —
  never forced through, never closed by weakening an existing check.
- Known risk, named now: the `stage2:check` inventory shape and the harness
  skip accounting are design decisions; if either resists the additive
  constraint, record the finding and stop rather than bend criterion 4.
- If R1-S2's fixture backlog proves too large for one bounded session, split
  at the drill boundary (one drill per session) and record the re-split in a
  §5 entry; the criterion is landed at close of the last session, and no
  intermediate state is reported as acceptance.

## 5. Close-out entry template (one instance per landing session)

```md
### {YYYY-MM-DD} — R1-S{Session_Number}: {Concise_Outcome}

- Result: {Landed_Or_Blocked_With_Owner_Visible_Finding}
- Branch/PR: {Reference}
- Manifest coverage: {Drills_Covered_This_Session} of the four
- Measured check counts per drill: [{Measured_Check_Counts_Per_Drill}]
- Class tallies at open: [{Demonstrated_Structural_Unfixtured_Counts_At_Open}]
- Unfixtured rows closed: [{Unfixtured_Rows_Closed}]
- Mutation observations: [{Observed_Red_Evidence_Per_Drill_Both_Directions}]
- Standing block: [{Exact_Commands_And_Raw_Result_Counts}]
- Deviations/findings: [{Deviation_Or_Finding_And_Disposition}]
- Next: {Next_Session_Or_Edition_Closed}
```

## 6. Status ledger

- July 16, 2026 — Execution packaging authored (this file and
  `R1_HANDOFF.md`), same session and branch as the proposal
  (`d/trellis-paper-analysis-b9bec7`). **DORMANT: NOT sequenced, NOT
  ratified, owner-gated.** No repository byte outside these two documents
  moved. Awaiting an explicit owner sequencing decision; the engineering-loop
  program remains the active track.

---

**Restated at close: this roadmap is DORMANT packaging for a NOT-sequenced,
owner-gated proposal.** It sequences nothing by itself, competes with nothing,
and yields to the live root `HANDOFF.md` and `TRELLIS_ROADMAP.md` wherever
they speak. Execute only after the owner records the activation decision.
