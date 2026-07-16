# R3 handoff — composed acceptance expression (dormant; do not execute)

**DORMANT. DO NOT EXECUTE. Owner sequencing required.** Execution packaging
for [R3_COMPOSED_ACCEPTANCE_EXPRESSION_PROPOSAL.md](R3_COMPOSED_ACCEPTANCE_EXPRESSION_PROPOSAL.md)
— NOT sequenced, NOT ratified, competing with nothing: the owner-prioritized
active track is the engineering-loop program, whose status is read from the
acceptance ledger (`npm run el:activate -- status`), never from prose. The
live root `HANDOFF.md` drives real sessions and WINS on any conflict with
this file. **If any pinned state named in §4 has moved when a session opens
this — codes, exports, CLI argument or output surface, test files — STOP
and re-derive this plan against the proposal before writing a byte.** The
increment is zero-paid, zero-LLM, and is evidence-for-review machinery:
NEVER a write gate, it gates no merge, and it cannot accept an increment —
acceptance stays human. Terminology, once: **calibration anchors** are
labeled fixtures (the `METRIC_EVOLUTION.md` §6.5 sense), distinct from
splice anchors (the `trellis_textedit.py` sense); every "anchor" below is a
calibration anchor.

## 1. Objective

Land the R3 surface in ONE zero-paid session as a single increment: the
three-valued verdict type and five adapters over the existing self-edit
detectors, abstain-aware combinators with a fail-closed root, two per-class
expressions committed as data and calibrated 10/10 against ten labeled
anchors, a four-fixture held-out audit set committed FIRST, and a
strictly-appended `stage2:check` report block — proposal §6 satisfied in
full.

## 2. Pre-flight

1. `npm ci`
2. `npm test` — record `{Vitest_Baseline_Count_At_Session_Start}`; the
   suite only GROWS this session, zero existing tests changed.
3. `npm run build`
4. Required reads, in order: the R3 proposal (§6 is immutable);
   `docs/product/metric-evolution/R3_ROADMAP.md` (commit decomposition and
   the §5 close-out frame this session fills);
   `src/benchmarks/selfedit/check.ts` and `parse_gate.ts`;
   `scripts/stage2_selfedit_check.ts`;
   `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md` §5e.5, §5f.5, §5g.4,
   §5h.11, §5i.7, §5i.8 (every non-synthetic fixture's citation target);
   `docs/product/metric-evolution/R1_PIN_VACUITY_AUDIT_PROPOSAL.md` §3
   (birth-gate pairing — the fixture rule).

## 3. Work plan, file level, in commit order

The order is criterion item 1 made mechanical: the audit set is commit 1,
and no later commit touches it.

1. **Commit 1 — `src/benchmarks/selfedit/audit_fixtures.ts` (new), ALONE.**
   Four labeled fixtures — two bad, two good, labels committed WITH the
   fixtures — over the evaluator-visible tuple `SelfEditRunEvidence` +
   `FileParseResult[]` + `DiffChangedLine[]` + declared class
   (`'comment_class' | 'executable_class'`), importing types ONLY from
   `./check`; each carries `label: 'bad' | 'good'` and a `provenance`
   string; all four scenario-distinct from the ten anchors. Commit subject
   carries `{Audit_Set_Commit_Marker}`. Later commits may import from this
   file; none edits it, ever.

   | Audit fixture | Label | Shape | Provenance |
   |---|---|---|---|
   | `audit_bad_unbridged_evidence` | bad | uncontested edge whose cited hashes live only in an UNNAMED document (`unbridged_evidence`) | §5f.5 run 1 |
   | `audit_bad_contested_evidence` | bad | a contested element in a found edge's chain (`contested_evidence`) | synthetic (taxonomy-derived) |
   | `audit_good_comment_class_added_only` | good | comment-class; added-side-only comment lines; clean elsewhere; parses | synthetic (taxonomy-derived) |
   | `audit_good_executable_insert_only` | good | executable-class insert-only `.ts` edit; one live bridging citation; parses | synthetic (taxonomy-derived) |

2. **Commit 2 — `src/benchmarks/selfedit/expression.ts` +
   `expression.test.ts` (both new).** Working names, all pure:
   `DetectorVerdict = 'drawback' | 'clean' | 'abstain'`; `RootVerdict =
   'drawback' | 'clean' | 'not_acceptable_evidence'`. Combinators
   `any`/`all`/`k_of`: abstaining children are excluded from their
   combinator; a node whose children all abstain abstains; a ROOT
   abstention is `not_acceptable_evidence`. Unit pins exercise every
   adapter in both firing and non-firing directions — the pre-check
   adapter's pair lives HERE over synthetic `SelfEditPreState` (the
   fixture tuple carries none). Adapters CALL the exported check
   functions and classify their findings, changing none of them:

   | Adapter | Wraps | Verdict rule |
   |---|---|---|
   | scope | `checkEditScope` | always opines; drawback iff any finding |
   | evidence | `checkEvidence` | always opines; drawback iff any finding |
   | parse | `checkParseResults` | abstains iff EVERY `FileParseResult.language` is null; mixed wired/unwired coverage opines |
   | comment-class | `checkCommentClassDiff` over declared files | abstains iff the class is `executable_class` |
   | pre-check | `evaluatePreCheck` | always opines given pre-state |

3. **Commit 3 — expressions as data + the ten anchors + the gates**, same
   two files. The `comment_class` and `executable_class` expressions as
   committed data; the validity gate (reject any expression yielding one
   identical verdict across the whole calibration set) with an
   always-clean and an always-drawback planted candidate committed as
   rejected examples; the all-abstain root pin (a test-local expression
   over the parse and comment leaves only, on an input where both
   abstain, asserted `not_acceptable_evidence`). The 10/10 pin runs EACH
   class expression over ALL TEN anchors, each anchor's own declared
   class feeding the comment adapter. The anchors, each with `label` and
   `provenance`:

   | Calibration anchor | Label | Shape → firing leaf | Provenance |
   |---|---|---|---|
   | `bad_unparseable_named_file` | bad | clean scope/evidence; named `.py` file `parseable: false` → parse leaf (`named_file_unparseable`) | §5e.5 run 1 |
   | `bad_comment_class_removed_executable` | bad | comment-class; every OTHER detector clean (the file parses); removed-side executable line → comment leaf (`named_file_noncomment_change`) | §5f.5 run 2 |
   | `bad_no_landing_named_files_unchanged` | bad | empty `changedPaths`, two named files, no recorded edge → scope + evidence leaves (`named_file_unchanged` ×2, `evidence_edge_missing`) | §5i.7 + §5i.8 |
   | `bad_out_of_scope_edit` | bad | a changed path the task never named → scope leaf (`out_of_scope_edit`) | synthetic (taxonomy-derived) |
   | `bad_dead_evidence_hash` | bad | a cited hash dead or in no current document version → evidence leaf (`dead_evidence_hash`) | synthetic (taxonomy-derived) |
   | `good_docstring_edit_landed` | good | exactly the named file changed; uncontested edge; live bridging hashes; parses; executable-class | §5e.5 run 2 |
   | `good_comment_class_landed` | good | comment-class; removed and added comment lines only; parses; clean evidence | §5g.4 |
   | `good_feature_class_landed` | good | two named `.ts` files changed, nothing else; one live bridging citation; both parse; executable-class | §5h.11 |
   | `good_clean_synthetic_multi_file` | good | clean executable-class; parse results MIX a wired `.ts` and an unwired extension (parse opines clean on partial coverage) | synthetic (taxonomy-derived) |
   | `good_all_gates_abstaining_clean` | good | clean scope/evidence; no wired parser; executable-class (parse + comment abstain, excluded) | synthetic (taxonomy-derived) |

4. **Commit 4 — the CLI report block + the audit machinery.** In
   `scripts/stage2_selfedit_check.ts`, post-run mode only: derive the
   declared class from the existing declarations
   (`commentClassFiles.length > 0` → `comment_class`, else
   `executable_class` — no new flag); render the block via a new pure
   function in `expression.ts`; print it in `main()` strictly AFTER
   `report(findings)` returns — `report()` stays byte-identical, `--pre`
   output unchanged. Block content: declared class, root verdict, each
   leaf's verdict (the pre-check leaf reports `abstain` — a post-run
   invocation carries no recorded pre-check outcome), raw per-family
   finding counts. Plus `scripts/r3_audit_run.ts` (new): loads the audit
   fixtures and both expressions, prints per-fixture verdicts and raw
   agreement; wired into NO npm script and NO drill.

## 4. File-level starting points

- `src/benchmarks/selfedit/check.ts` — the twelve `SelfEditFindingCode`
  values (`out_of_scope_edit`, `named_file_unchanged`,
  `evidence_edge_missing`, `empty_evidence`, `contested_evidence`,
  `dead_evidence_hash`, `unbridged_evidence`, `target_entity_missing`,
  `contested_target`, `doc_missing`, `named_file_unparseable`,
  `named_file_noncomment_change`); the four post-run evaluators
  (`checkEditScope`, `checkEvidence`, `checkParseResults`,
  `checkCommentClassDiff`) plus `evaluatePreCheck`; `parseGateLanguage`
  null = "never a finding" — the abstention the proposal names; the
  comment-class gate evaluated ONLY for declared files. Adapters wrap
  these; nothing here changes.
- `src/benchmarks/selfedit/parse_gate.ts` — gatherers producing
  `FileParseResult[]`; a named file missing on disk is unparseable; an
  unwired extension is `language: null, parseable: true`.
- `scripts/stage2_selfedit_check.ts` — arguments `--pre`, `--edit-root`,
  `--named-file`, `--comment-class`, `--entity`,
  `--subject`/`--verb`/`--object`, `--doc-prefix`; comment-class
  declarations validate BEFORE any I/O; `main()` composes the four
  evaluators' findings; `report()` prints the `PASS:`/`FLAG [...]` lines
  plus the count line and returns the exit code — the appended block
  prints after that return. `test:selfedit-harness` imports the gatherers
  from this script: existing exports are load-bearing.
- `src/benchmarks/selfedit/check.test.ts`, `parse_gate.test.ts` — the only
  unit-pin files existing today; both pass unmodified (criterion item 2).
- `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md` §5e.5 / §5f.5 / §5g.4 /
  §5h.11 / §5i.7 / §5i.8 — the committed narratives fixtures reconstruct
  (the original failure diffs are gitignored session-local patches;
  fixtures reconstruct the narrative, honestly labeled).

## 5. Test strategy and acceptance

The base is proposal §6, quoted verbatim and immutable:

```text
Zero-paid, zero-LLM, all seven required:

1. The audit-set file (four labeled fixtures) lands in a commit that
   precedes every expression-authoring commit, and no later commit in the
   increment touches it — verifiable from `git log` at review.
2. Adapters preserve existing semantics byte-for-byte: every pre-existing
   `check.ts` unit pin and the `stage2:check` / `test:selfedit-harness`
   drill pins pass unmodified; the CLI's pre-existing output lines are
   byte-identical (the report block is strictly appended).
3. Calibration agreement is **10/10** on the committed anchors for each
   class expression (deterministic adapters — exact agreement or the
   expression is wrong), asserted in vitest.
4. Every bad anchor is fired by at least one named leaf, and each of the
   five adapters is exercised in both firing and non-firing directions
   across the suite (birth-gate pairing, R1's rule).
5. The validity gate rejects a planted degenerate expression (an
   always-clean and an always-drawback candidate are both committed to the
   test as rejected examples).
6. The root fail-closed rule is pinned: a fixture whose gates all abstain
   yields `not_acceptable_evidence`, distinct from both clean and drawback.
7. The held-out audit runs once at close; raw agreement (n/4, per-fixture
   verdicts) is recorded in the roadmap §5 entry — reported whether flattering
   or not, with no threshold applied.
```

Session mechanics on top (mechanics only; the criterion moves for no
reason):

1. After commit 1: `npm test` (count unchanged) + `npm run build` (the new
   file compiles). After commits 2 and 3: `npm test` (suite GROWS) +
   `npm run build`. After commit 4: those two plus
   `npm run test:selfedit-harness` — pinned sections [8]/[9] included,
   unmodified; the full standing drill block runs at close (§8).
2. Item 1's git-log verifiability: the audit file lands ALONE in commit 1,
   whose subject carries `{Audit_Set_Commit_Marker}`;
   `git log --oneline -- src/benchmarks/selfedit/audit_fixtures.ts` lists
   exactly that one commit, the earliest of the increment.
3. Item 5's planted candidates are the landing session's choice; the
   requirement is only that both are committed and both are rejected.
4. Item 7's run is §8 step 2 — once, at close, after every drill is green.

## 6. Guardrails

- Adapters WRAP and never edit `check.ts`: codes, contracts, and outputs
  byte-identical; no export the harness drill imports moves.
- The CLI's pre-existing output is byte-identical; the block is strictly
  appended after the final pre-existing line; `--pre` prints no block.
- Exit-code semantics unchanged this edition: findings exit 1, clean 0,
  errors 2; the expression verdict NEVER influences the exit code.
- Never a write gate, gates no merge, cannot accept — acceptance stays
  human (the acceptance ledger's `actor: 'human'` pin).
- No prompt text moves this increment — no addendum, rubric, or task-text
  byte — so **Guardrail 15 is not triggered**; if scope drifts toward
  prompt text, STOP: that is a different increment.
- No behavior claims: report the mechanical contract and raw measurements,
  never a claim about model behavior.
- Zero-paid, zero-LLM throughout; every new function pure and unit-pinned.

## 7. Exclusions

- Touching `test:selfedit-harness` pinned sections [8]/[9] — a rehearsal
  arm printing the expression is a recorded follow-up, its own witting
  increment.
- Exit-code integration — only ever an owner decision (it changes what a
  red CLI means).
- The evolutionary synthesizer (R5, deferred with its recorded trigger).
- Any paid call.
- Editing the live `HANDOFF.md` or `TRELLIS_ROADMAP.md` — this track's
  close-out lives in `R3_ROADMAP.md` §5/§6 and the proposal §8 ledger;
  root-document integration is the owner's at sequencing time.

## 8. Close-out (the landing session's actions)

1. Run the standing drill block (non-markdown bytes moved):

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

2. THE ONE AUDIT RUN: with every drill green, run
   `npx tsx scripts/r3_audit_run.ts` exactly ONCE. Transcribe its raw
   output threshold-free into the `R3_ROADMAP.md` §5 frame —
   `{Audit_Agreement_N_of_4}` plus per-fixture verdicts — whether
   flattering or not; the audit is never re-run to improve the number.
3. Fill the rest of the `R3_ROADMAP.md` §5 frame (commits, marker,
   `{Calibration_Agreement_N_of_10}` per class, suite growth, drill
   evidence, defects); append dated entries to `R3_ROADMAP.md` §6 and the
   proposal's §8 ledger.

Close as opened: **DORMANT — do not execute without owner sequencing; the
live `HANDOFF.md` wins on conflict; STOP and re-derive if §4's pinned state
has moved.** Zero-paid, zero-LLM; evidence for review — never a write gate,
never the acceptor; acceptance stays human.
