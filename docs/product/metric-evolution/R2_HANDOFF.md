# R2 handoff — the engine-resolved-anchor increment, hardened by the R2 amendment (execute ONLY behind the double gate)

Status: **DOUBLY DORMANT.** Sibling of `R2_ROADMAP.md` (executes its
Phase 1); restates the PAUSED `HANDOFF.md` Appendix A objective as a
self-contained work order with the four R2 amendments woven in.

*** THE DOUBLE GATE — DO NOT EXECUTE A SINGLE STEP UNTIL BOTH HOLD ***

- **Gate 1:** the owner has re-prioritized the paused `HANDOFF.md`
  Appendix A objective ("retained for history, do not execute") by a
  recorded decision. The engineering-loop program is the
  owner-prioritized track; read its state via
  `npm run el:activate -- status`, never from prose.
- **Gate 2:** the owner has ratified the R2 amendment
  (`R2_ANCHORED_MEASUREMENT_HARNESS_PROPOSAL.md` §6, first half).

Where this document conflicts with the live `HANDOFF.md`, **the live
`HANDOFF.md` wins** — re-read it before every step. This packaging
never edits `HANDOFF.md` or `TRELLIS_ROADMAP.md`; §8 describes those
updates as the landing session's own actions.

**Terminology (one collision, named once).** *Calibration anchors* =
labeled known-bad/known-good fixtures (`METRIC_EVOLUTION.md` §6.5); the
new method's engine-resolved *anchor substring* is a splice anchor — a
different thing sharing the word. `{Braced_Names}` here are authoring
slots, never bytes to paste anywhere.

## 1. Objective (imperative; ONE zero-paid session; single increment)

Land the ENGINE-RESOLVED-ANCHOR guarded insert — working name
`insert_after_anchor`, final shape decided by the design record — on
`TrellisTextEdit` (`src/rlm/trellis_textedit.py`), beside the
Session 41 guarded family. Contract: the caller passes a UNIQUE anchor
SUBSTRING and the new lines (no line number, no `\r`); on EXACTLY ONE
frame line containing that substring, the engine computes the 0-based
insertion address (after that line) and the frame's own terminator and
stages through the SAME staging/containment/budget/`write_back`
machinery as the guarded family, counted in `textedit_guarded_ops`; on
ZERO or MORE-THAN-ONE match, a typed refusal (the `AnchorMismatchError`
mold, bounded message naming match count and anchor) staging NOTHING.
Uniqueness IS the safety: it removes the ambiguous bare-`});` failure
(§5i.7) and the stale-line-number failure (§5i.8) by construction.
Human-authored, ZERO-PAID, design-record-first, one PR to `master`.

## 2. Pre-flight (all before any byte moves)

1. Verify both gates as recorded owner decisions:
   {Gate1_Owner_Decision_Reference}, {Gate2_Owner_Decision_Reference}.
   Read the live `HANDOFF.md` §0; run `npm run el:activate -- status`
   and confirm Gate 1 covers this increment's place beside the EL
   program.
2. Porcelain clean; `npm ci`; `npm test` — record
   {Npm_Test_Baseline_At_Reactivation} (Appendix A.1's "876/87
   expected" is the STALE Session 54-era count; observe, never
   assume); `npm run build`; `npm run python:check`.
3. Required reads, in order: live `HANDOFF.md` Appendix A–A.5;
   `docs/architecture/STRUCTURAL_SPLICE.md` (whole record);
   `src/rlm/trellis_textedit.py`;
   `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md` §5i.6/§5i.7/§5i.8;
   `docs/architecture/CODE_MEDIATED_TEXT.md`; the R2 proposal;
   `R2_ROADMAP.md`; this handoff end to end.

## 3. Work plan (Appendix A.1's sequence; amendments bound at their exact steps)

1. **Design-record section FIRST (spec-before-pen).** Extend
   `docs/architecture/STRUCTURAL_SPLICE.md` with: the §1 contract;
   uniqueness/refusal semantics; the terminator rule (BOTH CRLF and LF
   frames — `\r` is an ordinary byte within a line under the frame's
   `split("\n")` representation); the one-method-vs-
   `insert_before_anchor`-twin-vs-batch decision with its reason (do
   not gold-plate); the honest-scope note (removes model
   line-number/terminator errors; does NOT make the model choose good
   anchors — non-unique still refuses, correctly). **AMENDMENT 3 binds
   here:** the section RECORDS the batch decision and pre-states the
   §5i.8 scenario fixture's pinned outcome either way: (a) batch
   variant — the engine re-resolves each splice anchor AFTER prior
   inserts stage; the fixture asserts all inserts land byte-exactly;
   (b) no batch — the fixture asserts the documented sequential idiom
   (resolve → stage → re-resolve) lands byte-exactly AND the naive
   §5i.8 replay refuses typed, never silently corrupts. No code byte
   until this section exists.
2. **Implement additively in `src/rlm/trellis_textedit.py`.** Add the
   method inside the Session 41 guarded region (after `delete_lines`,
   before `diff`), reusing `_require_frame` and the `_stage_window`
   mold (budget-check-first; a refusal stages nothing; increments
   `_guarded_ops`); `_resolve` containment and `write_back` untouched;
   messages `TEXTEDIT_PREVIEW_CHARS`-bounded. Do NOT touch `splice`,
   `replace_lines`, `insert_lines`, or `delete_lines`.
3. **Addendum — Guardrail 15 FIRST (§6 item 1).** Invoke both prompt
   skills via the Skill tool, THEN extend `TEXTEDIT_ADDENDUM` (in
   `trellis_textedit.py`; composed at the `trellis_agent.py` site via
   `build_textedit_addendum` only when the toolkit is injected) with
   one bullet teaching the new method — brace-free bytes. Run the pin
   ceremony (§6 item 2) in the SAME commit.
4. **Pins and drills.** Grow `test:textedit` with: unique-resolve
   happy path (engine-computed address; byte-exact insert); NON-UNIQUE
   refusal; ABSENT-anchor refusal; terminator handling on a CRLF
   fixture AND an LF fixture; containment / over-file-cap / budget
   refusals unchanged; the §5i.8 scenario fixture per the record's
   branch; a `test:selfedit-harness` section if the rehearsal arm uses
   the new method; `npm run python:check` covers the module.
   **AMENDMENT 1 (fixture provenance):** every planted violation
   carries a comment naming the record it reproduces — the
   ambiguous/duplicate-anchor refusal cites §5i.7 (the bare-`});`
   class); the stale-address scenario cites §5i.8; a fixture with no
   citation is a synthetic addition and SAYS SO. §5i.6 is NOT
   reproducible by this drill and is never cited by a fixture (a pin
   mis-written in the firing direction is R1 territory — the
   proposal's own honesty note, carried). **AMENDMENT 2 (birth-gate
   pairing):** every new detection branch (non-unique, absent,
   terminator, containment/budget if extended) is admitted ONLY as the
   pair — planted violation → FIRES and stages nothing; adjacent
   known-good → clean and stages byte-exactly. No unpaired pin enters
   the drill; the drill goes red if either half is removed.
   **AMENDMENT 4 (raw counts):** the section prints its
   checks-run/fired/clean counts (the `EL-REQ-OBS-008` mold applied to
   a drill). The calibration anchors, quoted for the fixture author:
   - **§5i.7** (S53; NO LANDING, clean R2 self-refusal; 9 guarded ops,
     0 write_backs): the `rlmBackend?` field and the four
     `TRELLIS_RLM_*` blocks each inserted TWICE; test pins anchored on
     the ambiguous bare `});` landed on
     `describe('buildAgentArgs', () => {` — OUTSIDE the target
     describe; plus an R2 over-trigger on the run's own fixable slip.
   - **§5i.8** (S54; NO LANDING, clean R2 self-refusal; 4 guarded ops,
     0 write_backs): guarded `insert_lines` BATCHED in ONE repl cell
     with pre-staging line numbers (insert_a at 155, insert_b at 209);
     the 13-line first insert shifted the frame so
     `anchor_before='  }\r'` at stale line 209 met
     `  // spawn env can set it.\r` → `AnchorMismatchError` ×11; 14 of
     16 iterations without one verified completed edit. The direct
     motivation; the amendment-3 fixture drives exactly this shape.
   - **§5i.6** (S52; FAILED): a SPEC-PERFECT production diff failed by
     ONE mis-written pin — `toEqual({ PATH: '/usr/bin' })` where
     `buildAgentEnv` unconditionally injects connection/runtime keys
     (`1 failed | 36 passed`) — plus $1.0888 against the $0.5–$1.0
     estimate. Listed ONLY as not reproducible here.
5. **Close per §8**, recording the raw counts (amendment 4's second
   half).

## 4. File-level starting points (Appendix A.2 carried, with observed structure)

- `docs/architecture/STRUCTURAL_SPLICE.md` — §2.2 the `py-tree-sitter`
  revisit trigger; §3 the family the method joins; §6 the criterion
  mold the new section imitates. Extend FIRST.
- `src/rlm/trellis_textedit.py` — the target. Observed structure
  (re-locate by name; line numbers drift): module-level
  `TextEditBudgetError`/`StaleFileError`/`AnchorMismatchError`; kernel
  viewport constants incl. `TEXTEDIT_PREVIEW_CHARS`; `TrellisTextEdit`
  holding `_frames` (per-file: working `lines`, load-time digest,
  pending-`splices` count) and counters
  `_ops`/`_writes`/`_raw_splices`/`_guarded_ops`; containment
  `_resolve` (reject-absolute + `..` + realpath/commonpath before any
  I/O); `splice`; the guarded region — `_require_guarded_lines`,
  `_verify_anchor_lines`, `_stage_window`, `replace_lines`,
  `insert_lines`, `delete_lines`; `write_back` (digest guard +
  containment re-run); `stats` (five counters); `TEXTEDIT_ADDENDUM` +
  `build_textedit_addendum` (empty string when the toolkit is absent).
  ADD beside all of it; edit none of it.
- `src/rlm/trellis_agent.py` — the composition site
  (`+ build_textedit_addendum(textedit)`) and the telemetry fallback
  dict. NOTE, correcting Appendix A.2: the `_ADDENDUM_*` strings HERE
  are the KERNEL addendum (always composed; bytes there DO move the
  composed-prompt pins); the guarded-family addendum bytes live in
  `trellis_textedit.py` as `TEXTEDIT_ADDENDUM`, gated on the toolkit.
- `scripts/test_modules.py` — [4] default / [7] omit-arm SHAs and pin
  histories. `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md`
  §5i.6–§5i.8 — the calibration anchors (signatures in §3 step 4).
  `docs/architecture/CODE_MEDIATED_TEXT.md` — the doctrine. The
  `test:textedit` drill and `test:selfedit-harness` rehearsal — where
  the new pins live.

## 5. Test strategy and acceptance

Appendix A.3's criterion, restated and binding in full:

- **Expected footprint:** the `STRUCTURAL_SPLICE.md` section, the new
  method, the addendum edit + pin-ceremony outcome, the new
  `test:textedit`/harness pins, the landing session's documents.
  Nothing else.
- **Zero-paid (the whole session):** design record written; the method
  implemented additively; both prompt skills INVOKED before the
  addendum bytes; the pin ceremony run in the same commit
  (`test:modules` green); the new pins green; `npm test` GROWS from
  {Npm_Test_Baseline_At_Reactivation} with zero existing tests
  changed; the FULL standing drill block run (non-markdown bytes
  moved).
- **Acceptance for the TOOL:** the pins prove the mechanical contract
  (unique-resolve, typed refusals on non-unique/absent, CRLF + LF
  terminators, existing family byte-identical). NO RLM behavior claim
  attends this session — behavioral acceptance is the later MEASURED
  T2 re-attempt (Guardrail 8: report the tool's contract, never a
  claim the class is "closed for the model" until the paired
  re-attempt shows it).
- **Not this session:** any paid run; the T2 v4 task text and its
  spawn; editing `splice` or the existing guarded methods; a T3/T4
  byte (§7 expands).

PLUS the R2 amendment — the proposal §6 second half, verbatim, the
ADDITIONAL numbered block:

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

**Failure handling (Appendix A.1's rule, in force):** if the design
surfaces a reason the engine-resolved anchor cannot be built additively
(an unexpected coupling in the staging machinery), STOP and record it
in the design record as an owner-visible finding — do not force it or
weaken a Session 41 pin.

## 6. Guardrails

1. **Guardrail 15 (HARD REQUIREMENT, Appendix A's placement): before
   writing the addendum bytes, INVOKE both `prompt-engineering` and
   `hypershot-protocol` via the Skill tool and author against their
   guidance** — a process gate before the bytes, never a prose claim
   after. The addendum is brace-free — `.format()` runs over it; no
   literal `{}`; where a brace-bearing hypershot frame would break it,
   the prose description is the forced correct choice, recorded.
2. **Composed-prompt pin ceremony, SAME commit.** Run `test:modules`
   [4]/[7] in the landing commit. Expected per the Session 41 record
   §3.6: `TEXTEDIT_ADDENDUM` is gated OUT of the pinned default
   composition, so extending it should leave both SHAs UNCHANGED —
   verify, never assume. If any kernel prompt byte moves, recompute
   BOTH SHAs in that same commit, histories appended. Record the
   outcome as {Composed_Prompt_Pin_Outcome}.
3. **Additive only.** `splice` and the Session 41 family stay
   byte-identical; every Session 41 pin holds (`test:textedit` [14],
   `test:selfedit-harness` [8], the five-counter telemetry pin). New
   telemetry joins `textedit_guarded_ops`; no new counter unless the
   record justifies one, counts-only.
4. **Toolkit invariants.** Never touches git, never a write gate, no
   provenance standing; the checker stays read-only; the Session 29
   static pins never weaken (stdlib-only imports, no `subprocess`, no
   git tokens); `py-tree-sitter` re-enters only via the record's §2.2
   revisit trigger as a recorded owner decision.
5. **No behavior claims; paid doctrine; honest reporting.** The tool's
   mechanical contract is what lands; whether the MODEL stops failing
   the editing-execution class is decided only by the separate
   owner-approved paid T2 re-attempt (shape pre-stated in the proposal
   §5 — never this session's to run or price). Zero-paid end to end;
   any paid run is owner-gated propose-with-estimate under the ≤$5/run
   cap. Publish raw counts; a null or surprising result is a finding;
   a miss on any criterion item is a FAILED increment the owner
   adjudicates.

## 7. Exclusions (do not include, any of it)

- Any paid run or LLM spawn of any kind.
- The T2 v4 task text or its spawn — a SEPARATE later owner-approved
  PAID proposal with an estimate (Appendix A's gate, unchanged).
- Editing `splice`, `replace_lines`, `insert_lines`, `delete_lines`.
- Any byte in `src/workers/rlm_job.ts` or
  `src/workers/rlm_job.test.ts` (T2's targets, untouched).
- Executing any step of this handoff while either gate is closed.
- Editing the live `HANDOFF.md` or `TRELLIS_ROADMAP.md` from this
  packaging — §8's updates are the landing session's own actions.
- Weakening any Session 41 pin; widening the import allowlist; adding
  any git or subprocess token to the toolkit.
- Resurrecting `benchmark_logs/s52_t2_run1_failed.diff` as a patch
  source. T3/T4 scope; modifying the rlms library.

## 8. Close-out (the landing session's own actions)

Run the standing drill block (Appendix A.3's copy; if the live
`HANDOFF.md` block differs at re-activation, the live block wins):

```
 npm test
 npm run build
 npm run python:check
 docker compose --profile test config --quiet
 # Isolated zero-LLM Compose integration (unique project name; host ports 0 via
 # TRELLIS_POSTGRES_HOST_PORT / TRELLIS_NEO4J_HTTP_HOST_PORT /
 # TRELLIS_NEO4J_BOLT_HOST_PORT / TRELLIS_REDIS_HOST_PORT / TRELLIS_API_HOST_PORT).
 npm run test:selfedit-harness
 npm run test:answer-channel
 npm run test:textedit
 npm run test:module-lifecycle
 npm run test:modules
 npm run test:promotion
 npm run test:rlm-workspace
 npm run test:rlm-mcp
 npm run test:rlm-sandbox
 npm run test:verification-sweep
 npm run test:agent-loop
 npm run test:a2a
 npm run drill:scale
 npm run test:repo-ingest
 npm run test:benchmark-hardening
 npm run test:entity-resolution
 npm run test:api-hardening
 npm run test:belief-recovery
 npm run test:invalidation-sweep
 git diff --check
```

Then, in the landing session's PR:

1. `TRELLIS_ROADMAP.md` §5: a full-dated entry — the design-record
   section, the new method and contract, the pin-ceremony outcome, the
   new pins, AND the drill's raw counts
   {Drill_Section_Counts_Checks_Fired_Clean} recorded BESIDE the
   item-by-item criterion verdict (amendment 4's second half).
2. `docs/architecture/STRUCTURAL_SPLICE.md`: the new section gains its
   measured-verdict ledger line (the record's §8 mold).
3. `HANDOFF.md`: regenerate per the live §0 AT RE-ACTIVATION (the
   Session-55-era narrative-window instructions inside Appendix A.3
   are historical; the then-current recipe governs). Carry A.3's
   objective-selection note: if the increment LANDED, the default next
   objective is the T2 re-attempt (a v4 task text using the
   engine-resolved-anchor insert), an owner-approved PAID proposal
   with an estimate — the MEASURED acceptance of the tooling
   intervention; if the design surfaced a blocker, record it and
   re-propose.
4. `R2_ROADMAP.md` §6: the outcome line, filling its §5 frame
   variables with observed values only.

*** THE DOUBLE GATE, RESTATED AT CLOSE ***

No step above executes until the owner BOTH re-prioritizes the paused
`HANDOFF.md` Appendix A objective (Gate 1) AND ratifies the R2
amendment (Gate 2) — two separate recorded owner decisions. This
handoff creates zero execution pressure against the engineering-loop
program, and wherever it disagrees with the live `HANDOFF.md`, the live
`HANDOFF.md` wins.
