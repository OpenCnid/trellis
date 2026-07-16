# R1 handoff — pin-vacuity audit, edition 1 (DORMANT — do not execute)

*** DORMANT. DO NOT EXECUTE. *** This handoff activates ONLY on an explicit
owner sequencing decision; none has been recorded. It packages
`R1_PIN_VACUITY_AUDIT_PROPOSAL.md` (NOT sequenced, owner-gated) and does not
compete with the engineering-loop program — the owner-prioritized active
track, whose status is read from the acceptance ledger
(`npm run el:activate -- status`), never from prose. Two rules bind any
activation:

- **Staleness rule:** if repository state has moved from the states pinned in
  §4 (paths, check structure, section numbering, tally behavior, suite
  totals), STOP and re-derive this handoff against the current tree before
  any byte moves. Everything below is a July 16, 2026 observation.
- **Conflict rule:** where this document conflicts with the live root
  `HANDOFF.md`, the live `HANDOFF.md` wins, always.

## 1. Objective

Land the pin-vacuity audit, edition 1, as one increment executed across the
two bounded sessions `R1_ROADMAP.md` §2 defines: build the check-inventory
manifest (`docs/benchmarks/pin_inventory.json` + prose companion
`docs/benchmarks/PIN_INVENTORY.md`) covering every check in the four covered
drills (`test:textedit`, `test:selfedit-harness`, `stage2:check`,
`test:modules`), classify every row `demonstrated` | `structural` |
`unfixtured` with firing evidence, plant a paired known-bad fixture for every
row that starts `unfixtured`, and add count pins so each covered drill asserts
its executed-check count against the manifest. ZERO-PAID and zero-LLM
throughout; additive-only; drill scripts, fixtures, and docs only.

## 2. Pre-flight (each session)

Run, in order, and require green:

```
npm ci
npm test
npm run build
npm run python:check
```

Record the observed vitest totals as
{Npm_Test_Files_And_Tests_Totals_Observed} — this dormant document pins no
suite total; a moved total is a fact to record, not a blocker. Required reads
before any byte moves:

1. `R1_PIN_VACUITY_AUDIT_PROPOSAL.md` in full — §6 is the immutable
   acceptance base (§5 below); then `R1_ROADMAP.md` §2 for session scope.
2. `docs/architecture/METRIC_EVOLUTION.md` §7 (R1 row) and
   `docs/architecture/STRUCTURAL_SPLICE.md` §6 — the parent record and the
   criterion mold whose items 2–4 name the already-demonstrated fixtures.
3. The drill bodies in §4, in full, for the drills this session covers.

## 3. Work plan (file level)

1. **Schema first (session R1-S1, before any tally byte).** Record the
   manifest schema in `docs/benchmarks/PIN_INVENTORY.md`, designed against
   all four observed drill shapes at once: one row per *executed* check —
   loops multiply call sites (`scripts/test_modules.py:114` runs five
   `expect_raises` checks from one site), so rows come from RUNTIME
   enumeration, never source grep; a condition marker for
   environment-conditional checks (the harness `[SKIP]` branch, §4); and
   detector-inventory rows for `stage2:check`, which has no scripted checks
   (§4). Each row: drill, check identifier, class, firing evidence.
2. **Create `docs/benchmarks/pin_inventory.json`** — single source, one row
   per check, parseable by the drills (Python side via stdlib `json`).
3. **Per-drill tally additions** (S1: `test:modules`; S2: the rest):
   - `scripts/test_modules.py` / `scripts/test_textedit.py`: count executed
     checks inside the existing `check(name, ok, detail)` helper (every
     `expect_raises` path already funnels through `check` exactly once),
     print the total beside the existing summary line, assert it equals the
     drill's manifest count. Counting stays in the Python process — the TS
     wrappers only spawn and forward exit codes.
   - `scripts/test_selfedit_harness.ts`: same counter in its `check()`
     (line 84), plus first-class skip accounting — tally `[SKIP]`-branch
     checks as skipped-with-reason and reconcile executed + skipped against
     the manifest total, so the pin holds on stacks with and without the
     ingested substrate document.
   - `stage2:check`: the covered checks are the twelve `SelfEditFindingCode`
     detectors declared at `src/benchmarks/selfedit/check.ts:16-28`. `src/`
     is read-only here and a TS type union is erased at runtime, so pin the
     inventory by the source-parse mold (house precedent:
     `scripts/test_textedit.py` section [13] pins the toolkit import set by
     parsing source): read `check.ts` bytes, extract the union members,
     assert set and count against the manifest. Placement (a new CLI flag on
     `scripts/stage2_selfedit_check.ts` vs. a new harness section) is a
     design decision recorded in `PIN_INVENTORY.md`.
4. **Fixture additions** for every row that begins `unfixtured`: a planted
   violation on which the drill asserts the check FIRES, beside the
   known-good clean path, comment citing what it reproduces. For
   `stage2:check` rows, firing evidence maps each finding code to the
   harness check that drives it (sections [2], [3], [3b], [6], [7] already
   plant most codes); any undriven code gets a new planted fixture.
5. **The deliberate uncommitted mutation observation**, per covered drill:
   comment one check out locally and add one locally, observe the drill turn
   red BOTH ways via its count pin, revert, record
   {Observed_Red_Evidence_Per_Drill_Both_Directions}. Nothing from this step
   is committed.

## 4. File-level starting points (states pinned July 16, 2026)

- `scripts/test_textedit.py` (833 lines; run via the
  `scripts/test_textedit.ts` wrapper, npm alias `test:textedit`,
  `package.json:57`) — 14 sections `[1]`–`[14]`; `check()` at line 93 counts
  FAILURES ONLY and the summary prints no number ("All textedit checks
  passed."), so the executed-check tally must be ADDED. Grep-counted call
  sites: 75 `check(` + 54 `expect_raises(`, at least one check-driving loop
  (line 124). Section [14] holds the expected `demonstrated` exemplars
  (STRUCTURAL_SPLICE §6 items 2–3); section [13] is the source-parse mold §3
  step 3 reuses.
- `scripts/test_modules.py` (403 lines; wrapper `scripts/test_modules.ts`,
  npm alias `test:modules`, `package.json:59`) — 8 sections `[1]`–`[8]`;
  same failures-only `check()` mold (line 29); no number printed; tally must
  be ADDED. Call sites: 50 `check(` + 8 `expect_raises(`, one ×5 loop
  (line 114). Sections [4]/[7] are the composed-prompt SHA pins — expected
  `structural` exemplars (computed-vs-recorded; live artifact: the addendum
  text both loaders read). The wrapper forwards `TRELLIS_MODULES` /
  `TRELLIS_TEST_MODULE0_SHA`; counting stays Python-side.
- `scripts/test_selfedit_harness.ts` (717 lines; npm alias
  `test:selfedit-harness`, `package.json:53`) — 10 sections `[1]`, `[2]`,
  `[3]`, `[3b]`, `[4]`–`[9]`; failures-only `check()` (line 84); summary
  "ALL CHECKS PASSED" prints no number. 64 `check(` call sites; the section
  [1] live-substrate smoke (lines 276–306) is ENVIRONMENT-CONDITIONAL — it
  prints `[SKIP]` when `repo:trellis:src/rlm/trellis_tools.py` is absent and
  its nested branches execute zero to three checks — the reason §3 requires
  skip accounting rather than a flat equality. Needs live PostgreSQL/Neo4j.
- `scripts/stage2_selfedit_check.ts` (299 lines; npm alias `stage2:check`,
  `package.json:54`) — NOT a scripted drill: an argument-driven CLI
  (`--named-file` mandatory; `--pre` vs. post-run modes) over the pure
  checker, emitting "PASS: zero findings." or typed `FLAG [code]` lines.
  Zero `check()` calls, not bare-runnable, NOT in the root `HANDOFF.md`
  standing close-out list — its checks are the detector codes; its green
  path for criterion 5 is the deterministic exercise §3 step 3 defines.
- `src/benchmarks/selfedit/check.ts` — READ-ONLY grounding: the
  `SelfEditFindingCode` union (lines 16–28, twelve codes,
  `out_of_scope_edit` through `named_file_noncomment_change`) and the pure
  detectors the CLI and harness share.
- `docs/benchmarks/` — exists; `pin_inventory.json` and `PIN_INVENTORY.md`
  do not yet exist and are created here.

## 5. Test strategy and acceptance

The acceptance base is the proposal's §6 pre-stated criterion, quoted
verbatim and immutable — session mechanics below ADD to it and never weaken
or paraphrase it. From `R1_PIN_VACUITY_AUDIT_PROPOSAL.md` §6:

> Zero-paid, zero-LLM, all six required:
>
> 1. The manifest exists, covers **every** check in the four covered drills
>    (no sampling), and every row carries class + firing evidence. The prose
>    companion renders it and records each `structural` rationale.
> 2. Zero rows are `unfixtured` at close: every check that began unfixtured
>    has a planted known-bad fixture on which the drill asserts the check
>    FIRES, paired beside its known-good clean path.
> 3. Every count pin is live: each covered drill asserts executed-check count
>    == manifest count, and a deliberate local mutation (one check commented
>    out, one added — not committed) was observed turning the drill red during
>    the session, with the observation recorded in the session report.
> 4. Additive: no existing check is weakened, reordered, or removed; the only
>    edits to pre-existing assertions are the added tallies/fixtures, moved
>    wittingly in the same commit as their manifest rows.
> 5. The four covered drills run green with the new fixtures and count pins;
>    raw check counts are printed and recorded in the roadmap §5 entry.
> 6. The standing close-out block is green (`npm test`, `npm run build`,
>    `npm run python:check`, the full drill list, `git diff --check`) —
>    non-markdown bytes moved, so the full block applies.

Added session mechanics (additive to the above):

- **Which drills run when:** R1-S1 lands items 1–3 for the `test:modules`
  slice and runs the full standing block; R1-S2 lands the remaining three
  drills and completes all six items. "At close" (item 2) means close of
  R1-S2.
- **The mutation observation (item 3)** runs per covered drill —
  `test:modules` in R1-S1; the other three (the `stage2:check` case in its
  inventory-pin shape) in R1-S2.
- **Where counts get recorded (items 3 and 5):** printed by each drill's new
  tally line; recorded as {Measured_Check_Counts_Per_Drill}, with
  {Demonstrated_Structural_Unfixtured_Counts_At_Open} and
  {Unfixtured_Rows_Closed}, in the `R1_ROADMAP.md` §5 close-out entry AND
  the landing session's `TRELLIS_ROADMAP.md` §5 entry.
- **`stage2:check` green (item 5)** means its deterministic exercise path:
  the detector-inventory pin asserts and the harness sections driving its
  codes pass — the CLI itself stays argument-driven.

## 6. Guardrails

- ADDITIVE ONLY: never weaken, reorder, or remove an existing check; the
  only edits to pre-existing assertions are the added tallies and fixtures,
  moved wittingly in the same commit as their manifest rows.
- Drill scripts (`scripts/`), fixtures, and docs only — ZERO `src/` runtime
  bytes; `src/benchmarks/selfedit/check.ts` is read via source parse, never
  edited. Zero-paid, zero-LLM, zero databases beyond what the drills use.
- Every drill's exit semantics stay as they are; the count assertion is a
  new failure cause, never a new success path.
- NO behavior claims: the audit proves each covered pin CAN fire or is
  classified `structural` with rationale — it does not claim any pin checks
  the right invariant (proposal §4), and the session report says so.
- Future discipline stated in `PIN_INVENTORY.md`: a check added to a covered
  drill without a manifest row turns that drill red; the pin moves wittingly
  in the same commit that adds the check.

## 7. Exclusions

- The vitest unit suite (its vacuity story is a separate proposal, if ever).
- Every drill of the standing block outside the covered four (the proposal's
  §5 extension trigger stands recorded, not scheduled).
- Any `src/` runtime byte; any composed-prompt pin motion; any change to the
  drill block's composition; any paid or LLM call; any mutation-testing
  framework (proposal §2.2 REJECTED that shape).
- Editing the live root `HANDOFF.md` or `TRELLIS_ROADMAP.md` scope/status —
  the landing session appends the standard `TRELLIS_ROADMAP.md` §5 ledger
  entry and nothing else there; this track never edits the live `HANDOFF.md`.

## 8. Close-out (actions the LANDING session performs — none performed now)

1. Run the standing close-out block from the live root `HANDOFF.md`
   (non-markdown bytes moved, so the full block applies), recording
   {Exact_Commands_And_Raw_Result_Counts}.
2. Append the dated `TRELLIS_ROADMAP.md` §5 entry (measured counts, class
   tallies, unfixtured rows closed, mutation observations, block results).
3. Fill one `R1_ROADMAP.md` §5 close-out entry; update its §6 status ledger.
4. Append the landing (or the owner-visible blocker finding) to the
   proposal's §8 status ledger.
5. Flip this handoff's top and bottom banners from DORMANT to the landed (or
   blocked) state, dated.

---

*** RESTATED AT CLOSE: DORMANT. DO NOT EXECUTE. *** This document is
execution packaging for a NOT-sequenced, owner-gated proposal. It activates
only on an explicit owner sequencing decision; it yields to the live root
`HANDOFF.md` wherever they conflict; and if the §4 pinned states have moved,
STOP and re-derive before any byte moves.
