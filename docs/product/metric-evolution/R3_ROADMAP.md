# R3 roadmap — composed acceptance expression (dormant execution packaging)

Status: **DORMANT. NOT sequenced. Owner-gated.** This roadmap packages the
execution of [R3_COMPOSED_ACCEPTANCE_EXPRESSION_PROPOSAL.md](R3_COMPOSED_ACCEPTANCE_EXPRESSION_PROPOSAL.md)
for a future owner-sequenced session; it competes with NOTHING — the
owner-prioritized active track is the engineering-loop program, whose status
is read from the acceptance ledger (`npm run el:activate -- status`), never
from prose. The live root `HANDOFF.md` drives real sessions and
`TRELLIS_ROADMAP.md` is the root ledger; this document edits neither and
overrides neither. The increment is zero-paid, zero-LLM, and produces
**evidence for review, never authority**: it is not a write gate, gates no
merge, and cannot accept an increment — acceptance stays human.

Terminology, once: **calibration anchors** are labeled fixtures (the
`METRIC_EVOLUTION.md` §6.5 sense), distinct from splice anchors (the
`trellis_textedit.py` sense). Every "anchor" below is a calibration anchor.

## 1. Objective

Land the proposal's surface in one session: a three-valued verdict type
(`drawback`/`clean`/`abstain`) with adapters over the five existing
detectors in `src/benchmarks/selfedit/check.ts` (scope, evidence, parse
gate, comment-class diff gate, pre-check), the `any`/`all`/`k_of`
combinators with abstain-aware and fail-closed-root semantics, one committed
expression per increment class (`comment_class`, `executable_class`)
calibrated 10/10 against ten labeled anchors reconstructed from
`docs/benchmarks/REPOSITORY_INGESTION_REPORT.md`, a four-fixture held-out
audit set committed before any expression byte, and a strictly-appended
report block in `stage2:check` — all pure functions beside the checker,
changing no existing detector output and no exit-code semantics.

## 2. Session decomposition — one session, four ordered commits

The commit ORDER is a hard constraint, not a preference: proposal §6 item 1
requires the held-out audit-set file to land in a commit that PRECEDES every
expression-authoring commit and to be untouched by every later commit in the
increment, verifiable from `git log` at review. Audit fixtures are commit 1.

1. **Commit 1 — the held-out audit set.** New file
   `src/benchmarks/selfedit/audit_fixtures.ts` (working name): four labeled
   fixtures — two bad, two good — as evaluator-visible inputs
   (`SelfEditRunEvidence` + `FileParseResult[]` + `DiffChangedLine[]` +
   declared class, all types imported from `./check`), labels committed WITH
   the fixtures, each fixture citing its `REPOSITORY_INGESTION_REPORT.md`
   section or marked `synthetic (taxonomy-derived)`. Commit subject carries
   the `{Audit_Set_Commit_Marker}` token recorded at close. No other file
   moves in this commit; no later commit touches this file. Lands the
   ordering half of criterion item 1.
2. **Commit 2 — verdict type, adapters, combinators, unit pins.** New
   `src/benchmarks/selfedit/expression.ts` + `expression.test.ts`: the
   verdict type, five adapters wrapping (never editing) the exported check
   functions, `any`/`all`/`k_of` with abstain exclusion and the fail-closed
   root (`not_acceptable_evidence`), and vitest pins exercising every
   adapter in both firing and non-firing directions. Lands criterion item 2
   (adapters byte-preserving; every pre-existing pin passes unmodified) and
   the pre-check half of item 4.
3. **Commit 3 — expressions as data + calibration anchors + gates.** The
   two per-class expressions committed as data in `expression.ts`; the ten
   calibration anchors in `expression.test.ts` with per-fixture provenance;
   the 10/10 agreement pin per class expression; the validity gate with both
   planted degenerate candidates committed as rejected examples; the
   all-abstain root pin. Lands criterion items 3, 4, 5, and 6.
4. **Commit 4 — CLI report block + the one-time audit run recorded.** The
   strictly-appended report block in `scripts/stage2_selfedit_check.ts`
   (post-run mode only; pre-existing output byte-identical; exit codes
   unchanged), a standalone audit runner `scripts/r3_audit_run.ts` wired
   into no npm script and no drill, the full drill evidence, the ONE audit
   evaluation, and its raw result transcribed into this file's §5 entry.
   Lands criterion items 1 (the never-touched half, now git-log-complete),
   2 (CLI byte-identity), and 7. **No split:** the wiring is one appended
   print site after `report(findings)` returns in `main()` plus a class
   derivation from the existing `--comment-class` declarations — too small
   for a fifth commit; a code-then-record split stays permitted provided
   the audit file stays untouched and the audit runs exactly once.

Known tension, recorded for the landing session: the proposal expects
expressions of 1–3 leaves, while criterion item 3 (immutable) demands 10/10
on all ten anchors per class expression — with the anchor set below, the
arithmetic points to a four-leaf `any` per class. The criterion wins over
the expectation; leaf count is not a criterion item.

## 3. Dependencies

- **R1 in discipline only.** The fixture rule throughout is R1's birth-gate
  pairing (`R1_PIN_VACUITY_AUDIT_PROPOSAL.md` §3.2): every check gains a
  planted violation on which it FIRES beside a known-good path on which it
  stays clean, and every fixture cites what it reproduces. R1 does not need
  to have landed; the discipline is adopted by reference.
- **Independent of R2** (which amends the PAUSED engine-resolved-anchor
  track) **and of R4** (the paid outer-judge protocol). No ordering edge
  either direction.
- **Additive beside the Session 35/37/39 checker.** The harness drill
  imports `check.ts`'s functions and the CLI's gatherers directly, so
  existing export signatures are load-bearing and must not move.

## 4. Failure handling

- Any blocker becomes an owner-visible finding in the proposal's §8 status
  ledger — never forced through, never argued away.
- **If an adapter cannot preserve existing semantics byte-for-byte, STOP.**
  Criterion item 2 is not negotiable: the moment wrapping requires editing
  `check.ts`, moving an export consumed by `test:selfedit-harness`, or
  altering a pre-existing CLI output line, the session halts and records
  the coupling; it does not weaken a pin.
- A calibration miss (any expression below 10/10) means the expression is
  wrong or a fixture misreconstructs its cited record. Fix the expression
  (authored data) or the reconstruction against the citation — NEVER the
  label, and never by widening a criterion.
- An unflattering audit result is recorded anyway (item 7 is
  threshold-free by construction).

## 5. Close-out entry (structural frame — filled only by the landing session)

```md
### {Landing_Date} — R3 composed acceptance expression: {Concise_Outcome}

- Commits in order: [{Four_Commit_Shas_Oldest_First}]
- Audit-set commit marker: {Audit_Set_Commit_Marker}; `git log` verification
  of criterion item 1: {One_Line_Git_Log_Evidence}
- Calibration agreement: {Calibration_Agreement_N_of_10} (comment_class);
  {Calibration_Agreement_N_of_10} (executable_class) — pinned in vitest
- Validity gate: {Planted_Degenerate_Rejection_Evidence}
- Fail-closed root pin: {All_Abstain_Fixture_Outcome}
- Held-out audit, run ONCE at close: {Audit_Agreement_N_of_4}; per-fixture
  verdicts: [{Per_Fixture_Audit_Verdicts_Reported_Threshold_Free}]
- Suite growth: {Vitest_Counts_Before_And_After}; drills:
  [{Standing_Drill_Block_Results}]
- Defects and dispositions: [{Findings_Or_None}]
```

## 6. Status ledger

- **July 16, 2026** — Roadmap authored as dormant execution packaging
  (branch `d/trellis-paper-analysis-b9bec7`), sibling of `R3_HANDOFF.md`,
  child of the R3 proposal. NOT sequenced; awaiting owner decision.

Close as opened: **DORMANT, owner-gated, zero-paid.** This packaging does
not compete with the engineering-loop program, does not edit the live
`HANDOFF.md` or `TRELLIS_ROADMAP.md`, and the increment it packages is
evidence for review only — never a write gate, and never the acceptor.
