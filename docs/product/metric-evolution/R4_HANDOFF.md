# R4 handoff — land the paired-judgment deterministic core

**DORMANT — DO NOT EXECUTE. Owner sequencing is required first.** This file
packages one zero-paid increment for `R4_OUTER_JUDGE_PROTOCOL_PROPOSAL.md`
(NOT sequenced). It is not authorization and never outranks the live root
`HANDOFF.md`, which drives real sessions and WINS on any conflict.
**STOP AND RE-DERIVE if pinned state moved:**
`src/benchmarks/paired_judgment/` exists, the proposal's §3.1/§3.2/§6 bytes
differ from the §5 quote below, or any file cited in §4 moved. **ZERO LLM
INVOCATIONS ANYWHERE IN THE LANDING:** no judge call, no LLM client import,
in the module or its tests. Judge calls belong to separate owner-gated PAID
proposals under the standing ≤ USD 5 doctrine; rubric bytes are prompt text
authored only in a USING increment under Guardrail 15.

## 1. Objective

In one zero-paid session, land `src/benchmarks/paired_judgment/` (to be
created): the proposal §3.1 surface — the seeded blinded position-complete
pairing plan builder; verdict aggregation with its typed protocol-violation
refusal; the total report type; budget math with the printed estimate line
and the hard call cap — with the proposal §3.2 checklist verbatim in the
module doc comment and every proposal §6 criterion item pinned by vitest
tests `npm test` collects. Ship pure functions only: no network, no
database, no child process, no LLM client.

## 2. Pre-flight

1. Confirm the owner sequenced this increment; this document is packaging,
   never authorization.
2. Confirm `src/benchmarks/paired_judgment/` is still absent; if it exists,
   STOP and re-derive against live state.
3. `npm ci`
4. `npm test` — record {Pre_Session_Test_And_File_Counts}; §8 records
   growth from exactly these counts with zero existing tests changed.
5. `npm run build`
6. Required reads, in order:
   `docs/product/metric-evolution/R4_OUTER_JUDGE_PROTOCOL_PROPOSAL.md`
   (§3.1, §3.2, §6 — all IMMUTABLE here);
   `docs/architecture/METRIC_EVOLUTION.md` §7 R4 row (corrected consumer
   list — the T2 re-attempt is NOT a consumer);
   `docs/product/metric-evolution/R4_ROADMAP.md` (§2, §4, §5);
   `docs/product/metric-evolution/R1_PIN_VACUITY_AUDIT_PROPOSAL.md`
   (birth-gate pairing, cited by criterion item 2);
   the §4 starting points below, headers at minimum.

## 3. Work plan (file level)

All files are NEW, under `src/benchmarks/paired_judgment/` (to be created).
Chosen split: four source files with colocated tests — the
`src/benchmarks/effective_context/` idiom exactly (focused single-purpose
modules, one `.test.ts` beside each source file, heavy header doc comments,
no index file, imports by path). Function names are working names.

1. `types.ts` — the module doc comment's home: its header CARRIES THE
   PROPOSAL §3.2 CHECKLIST VERBATIM, copied byte-for-byte including the
   Guardrail 15 line (criterion item 5 checks this file). Types: the
   per-(pair, order) verdict, naming BLINDED labels only, abstention
   first-class; the pairing plan, judge-facing fields typed SEPARATELY
   from the unblinding map (checklist item 4 — unblinding happens in
   aggregation); the aggregation result
   `{wins_a, wins_b, ties, decided, judged_pairs}`; the report type
   carrying non-optional the aggregation, the full `EL-REQ-OBS-008` field
   set, and rubric id + rubric version + judge model id — NOTE: §3.1's
   prose omits "interventions", but its governing phrase is "the
   `EL-REQ-OBS-008` fields"; carry the full SPEC list. Also the typed
   refusal: an Error subclass with a bounded message (the
   `AnchorMismatchError` mold), working name
   `PairedJudgmentProtocolViolation`.
2. `pairing.ts` — `buildPairingPlan(armAOutputs, armBOutputs, seed)`: two
   arms' output sets keyed by task id plus a seed; every shared task id
   yields the pair in BOTH orders; blinded labels randomized per order via
   a small seeded PRNG in the module (`Math.random` never appears); no arm
   name, module name, or run id in any judge-facing field. Task ids in
   only one arm: the proposal is silent — DECIDE typed-and-counted
   semantics (refuse, or exclude with an explicit count in the plan),
   record it in the doc comment, pin it with a test. Silent dropping is
   not a choice.
3. `aggregation.ts` — `aggregateVerdicts(plan, verdicts)`: unblind via the
   plan; a win counts only when both orders agree; disagreement or
   either-order abstention is a tie, never dropped. Input missing either
   order of any pair raises the typed refusal and computes nothing.
4. `budget.ts` — `judgeCallsFor(plan)` = exactly 2 × judged pairs;
   `estimateLine(plan, ...)` prints the pre-spend estimate line (the paid
   doctrine's artifact) matching the plan's arithmetic;
   `assertUnderCap(plan, cap)` refuses an over-cap plan typed. All pure —
   the refusal sits upstream of any future spawn path by construction.
5. `types.test.ts`, `pairing.test.ts`, `aggregation.test.ts`,
   `budget.test.ts` — the §5 mechanics. `npm test` (`vitest run`) collects
   colocated tests automatically; add NO npm script.

## 4. File-level starting points

- `scripts/exp_effective_context.ts` — the Session 28 probe RUNNER (spawns
  arms: `spawnRun` under `armEnv`). Arms are named `'on' | 'off'`
  (`type Arm`), selected via `--arms on,off`; run logs are tagged
  `<arm>-<question>-r<repeat>`; the module control's two arms were two
  invocations of this script differing only in `TRELLIS_EXP_MODULES`.
  PRECEDENT ONLY — the paired-run machinery a future JUDGED comparison
  composes with; the R4 core is independent of it. Cite, never touch.
- `src/benchmarks/effective_context/module_arm.ts` — the spawn-env flag
  mold — and `module_arm.test.ts`, the spawn-env byte-identity pin this
  landing must leave holding: `probeModulesJson(undefined)` returns
  exactly `'["spatial-flywheel"]'`.
- `src/benchmarks/effective_context/estimation_suite.ts` — computed truths
  plus Guardrail 4 (counts and correctness together): the mold for
  comparisons mechanical truth DECIDES — the comparisons this protocol
  refuses (proposal §1).
- `src/core/graph/entailment_detection.ts` — the `judgeBudget` hard-cap
  mold ("Hard cap on judge calls per sweep; overflow is deferred,
  counted."). R4 borrows the HARD CAP, not the deferral: criterion item 4
  requires the cap to REFUSE an over-cap plan. Read; import nothing.
- `src/rlm/trec_rubric.json` — the version-field mold checklist item 2
  cites: top-level `"version": 2`, wording changes bound to a version
  bump, older stamps routed to the mandatory re-check tier. Never touch.
- `tools/engineering-loop/SPEC.md` §14, `EL-REQ-OBS-008` (line ~404) — the
  report field list derives from it exactly: "Reports and measurements
  MUST publish raw counts, retries, failures, interventions, tokens, cost,
  and unresolved findings together; null or surprising results MUST remain
  findings."

## 5. Test strategy and acceptance

The proposal's §6 pre-stated acceptance criterion, quoted verbatim
(IMMUTABLE; its internal § and R1 references are the proposal's own):

> Zero-paid, zero-LLM, all six required:
>
> 1. The pairing plan is pinned deterministic (same inputs + seed →
>    identical plan), position-complete (every pair appears in both
>    orders), and blind (a test asserts no arm identifier substring
>    survives into any judge-facing field).
> 2. Aggregation pins cover: both-orders-agree wins (each direction),
>    disagreement → tie, abstention → tie, and the planted protocol
>    violation — single-order input refuses typed, computing nothing
>    (birth-gate pairing per R1: each refusal fires on its planted
>    violation and stays clean on the compliant path).
> 3. The report type rejects partial reports at compile time (a fixture
>    omitting cost/tokens/rubric-version does not typecheck, asserted via
>    a type-level test or a runtime schema pin — implementation's choice,
>    pinned either way).
> 4. Budget math pins: calls = 2 × pairs on asymmetric fixtures; the
>    estimator's printed line matches the plan's arithmetic; the call cap
>    refuses a plan exceeding it before any spawn path is reached.
> 5. The protocol checklist (§3.2) appears verbatim in the landed module's
>    doc comment and in this record — the using increment's proposal
>    copies it as criterion items, and the checklist's Guardrail 15 line
>    is present.
> 6. Zero LLM invocations anywhere in the module and its tests (no judge
>    client import in the landing); the standing close-out block green.

Session mechanics, numbered by the criterion item each test pins:

1. `pairing.test.ts` — determinism: fix a literal seed, build twice from
   identical inputs, assert deep equality. Position-complete: every shared
   task id appears exactly twice, once per order. Blind: give fixture arms
   DISTINCTIVE multi-character identifiers (not `'on'`/`'off'` — a short
   label makes the substring assertion vacuous; R1's vacuity lesson),
   serialize every judge-facing field, assert no arm identifier substring
   occurs. The unblinding map is excluded by the type split, not by
   convention.
2. `aggregation.test.ts` — both-orders-agree win in EACH direction;
   disagreement → tie; either-order and both-orders abstention → tie; the
   planted violation: a verdict set missing one order of one pair refuses
   typed and computes nothing — BIRTH-GATE PAIRED with the compliant path
   (the same fixture family with both orders present aggregates cleanly).
3. `types.test.ts` — a fixture omitting cost/tokens/rubric-version does
   not typecheck (`@ts-expect-error` assertions), or the runtime schema
   pin if compile-time enforcement fails; implementation's choice, pinned
   either way; record choice and reason per roadmap §4.
4. `budget.test.ts` — calls = 2 × pairs on at least two fixtures with
   DIFFERENT pair counts; the estimator's printed line string-pinned
   against the plan's arithmetic; an over-cap plan refuses typed and an
   at-cap plan passes (birth-gate pairing).
5. A test reads `types.ts` from disk and asserts each of the six §3.2
   checklist items and the Guardrail 15 line occur verbatim.
6. Review the module's import lists: node stdlib and the module's own
   files only. Then the standing close-out block green (§8).

Acceptance IS: all six criterion items pinned green; `npm test` grown from
{Pre_Session_Test_And_File_Counts} to {Post_Session_Test_And_File_Counts}
with zero existing tests changed; the standing block green. NO behavior
claim attends this landing — the core is measurement infrastructure; the
first behavioral evidence belongs to the first owner-gated use.

## 6. Guardrails

- **ZERO LLM CLIENT IMPORTS — anywhere in the module or its tests.** No
  `openai`, no `src/core/llm/*`, no import from
  `src/core/graph/entailment_detection.ts`, no rlm client. Molds are
  READ, never imported.
- The `src/benchmarks/effective_context/` machinery and
  `scripts/exp_effective_context.ts` stay untouched and byte-identical;
  the `module_arm.test.ts` spawn-env byte-identity pins hold unchanged.
- No drill is added to the standing close-out block this edition and no
  npm script is added — `npm test` (`vitest run`) carries the pins.
- No behavior claims: report the module's mechanical contract only.
- No rubric bytes: rubric text is prompt text, authored only in a USING
  increment under Guardrail 15 (both prompt skills invoked before bytes).
- Frame variables in braces ({Like_This}) are filled at execution time
  from observation, never invented.

## 7. Exclusions — this session does NOT

- Call any judge, import any LLM client, or spend anything.
- Author rubric text of any kind, or any judge-prompt fragment.
- Touch `module_arm.ts`, `estimation_suite.ts`,
  `scripts/exp_effective_context.ts`, or any other
  `src/benchmarks/effective_context/` file or test.
- Edit the live root `HANDOFF.md` or `TRELLIS_ROADMAP.md` on this
  packaging's authority — root-document updates at execution time belong
  to the live session process, which the live `HANDOFF.md` governs.
- Add npm scripts or close-out-block drills.

## 8. Close-out — the landing session's actions

1. `npm test` — record {Post_Session_Test_And_File_Counts}; assert growth
   from the §2 pre-flight counts with zero existing tests changed.
2. Run the standing close-out block as the live `HANDOFF.md` states it at
   execution time (non-markdown bytes moved) — green.
3. Fill the `R4_ROADMAP.md` §5 close-out template from observation.
4. Append a dated landed-or-no-landing entry to the proposal §8 status
   ledger, including the item-3 enforcement-level choice and any
   owner-visible finding.
5. Flip THIS file's top banner: DORMANT →
   {Landed_With_Date_Or_No_Landing_With_Finding}.
6. Root-ledger recording (`TRELLIS_ROADMAP.md` §5 entry, `HANDOFF.md`
   regeneration) follows the live session process in force at execution
   time; the live `HANDOFF.md` wins over anything here.

---

Close as opened: **DORMANT — do not execute without owner sequencing.**
The landing is ZERO-PAID and ZERO-LLM: no judge call, no LLM client import,
no rubric byte anywhere in it. Every use of the landed core is a separate
owner-gated PAID proposal under the ≤ USD 5 doctrine, its rubric authored
under Guardrail 15. The live root `HANDOFF.md` wins on any conflict with
this file.
