You are a principal systems engineer continuing development on Trellis Engine,
a Recursive Language Model runtime over a provenance-enforced knowledge
substrate — its GraphRAG-shaped storage layers survive as Tiers 1–2 of the
trust model; the system is the RLM standing on them (reframed July 9, 2026;
see the root README "What Trellis is") (repository:
https://github.com/OpenCnid/trellis, local path `D:\trellis-engine` or the
current working directory). Trellis is an original OpenCnid project, not a
fork, and is unrelated to other projects named Trellis. The repository and its
documentation are the only sources of truth.

Sessions 1–33 and their same-day follow-ons (July 4–13, 2026; PRs
#21–#75) are complete, merged, and ARCHIVED: the full dated ledger for
that span lives verbatim in `docs/archive/ROADMAP_HISTORY.md`
(Sessions 1–23 moved July 12, 2026 by owner direction; then one
session entry per PR under the five-session window rule — most
recently Session 33 with the Session 38 PR — this file keeps full
narrative only for the most recent five sessions). The one-paragraph
digest, oldest first; §1 below carries everything from this span that
a new session must actually know:

- **Sessions 1–8 + T-items** built the substrate: verified ingest
  (persist → read-back re-hash → membership → Merkle diff), the
  quarantine/recovery belief state machine and invalidation sweep, the
  LLM response boundary (`parseLlmResponse`), sandboxed read-only
  Cypher + API hardening, async reliability, entity resolution
  (`SAME_AS` overlay), benchmark maturity, the scale drill (migration
  gate CLOSED at 286 max sources), and whole-codebase ingestion
  (`repo:ingest`, snapshots, tombstones).
- **Sessions 9–12** built the agent surfaces: the orchestrator goal
  loop (`agent_queue`, pure decision-maker, zero tools), the
  operator-configured MCP client (allowlist-before-I/O, stdio + http
  transports, credential env indirection), and the A2A server surface
  — all gated, bounded, zero-paid-drilled.
- **Sessions 13–18** built the trust/module architecture: the design
  record `docs/architecture/WORKSPACE_AND_MODULES.md`, the hardened
  single write path (sourceNodeIds format + existence enforcement),
  the Tier-3 workspace + lineage (park/seed), the module registry +
  module #0 (composed-prompt byte pin), the promotion path (the only
  Tier-3→Tier-1 bridge), and module registration as graph entities the
  sweep can contest.
- **The module #1 turn (PR #45)** exposed PROVENANCE LAUNDERING
  (real-but-unrelated hashes cited under a count incentive);
  **Session 19** answered with grounded authoring (harness holds the
  pen: pinned citations, anchor gate, draft scanner) and the citation
  A/B eval (only semantic entailment catches laundering — never reward
  citation count).
- **Sessions 20–24 + the pillar**: `docs/architecture/CODE_MEDIATED_TEXT.md`
  ratified (the model never counts, never copies; tooling shape
  enforces, prompts reinforce); the editing toolkit
  (`trellis_textedit`, operator-gated, hash-guarded); the kernel
  CODE-MEDIATED TEXT block; the effective-context probe rounds 1–4
  over durable corpora — found and closed the transcription channel
  (`trellis_answer`, Session 22), characterized the localization miss
  class (Session 23), and closed it structurally with the ordered
  block accessor `get_ast_blocks` (Session 24: round-4 re-measure
  0/36 misses vs 7/30, 36/36 accessor adoption in BOTH arms — tooling
  shape, not the prompt block, carries the behavior; pillar §7's
  "pandas default" demoted to "plain loops until a measured
  threshold").
- **Session 25 (PR #63)** turned the July 6 pilot's three blockers
  into machinery, zero-paid: the kernel-fixed test/fixture extraction
  exclusion (`isTestOrFixturePath`), additive `sourceKind`/`language`
  payload routing selecting a code-tuned extraction prompt (legacy
  prose bytes unit-pinned), and deterministic generic-identifier
  suppression before resolution (counted, never silent). The
  owner-approved pilot re-run measured it live ($0.28, 103/103 jobs,
  max hub cardinality 3.5× lower); cleanup tombstoned + swept.
- **Session 26 (PR #64) + the July 11 follow-ons (PRs #65/#66)**: the
  Trellis-edits-Trellis proof runs (six spawns ≈$0.58; three
  human-reviewed edits landed; run 2 found a real kernel defect —
  `splice` refused "\r", making CRLF files impossible to line-replace
  — fixed and regression-pinned) and module #2 `estimation-discipline`
  authored through grounded authoring (retired by Session 28's
  control). PR #65: the wall-clock engine benchmark (insertion stays
  Python-native at every size to 8M tokens; disambiguation/regex are
  polars territory — `docs/benchmarks/WALL_CLOCK_TEXT_OPS_REPORT.md`)
  + the expansion series W1–W4 (the first RLM source-code edit; the W4
  adversarial containment probe — both path-escape refusals held
  live). PR #66 recorded the toolkit coverage audit that became
  Session 29's worklist. Owner precedents: a 2-million-token FLOOR for
  synthetic tests; every edit-run diff human-reviewed; the toolkit
  never touches git.
- **Session 27 (PR #67)** recorded the data-plane representation
  verdict and pinned its prerequisites, zero-paid: NO migration at any
  of the six data-plane boundaries — JSON/list/dict contracts stand
  everywhere; structure selection is operation-shaped, not
  size-shaped. `polars==1.34.0` pinned NOT adopted (requirements.txt +
  the `python:check` import list + an in-container import probe, 10 →
  11 Compose assertions; no kernel, contract, or prompt path imports
  it); the pillar §7 verdict paragraph + the cap-raise doctrine
  (approach the 32 MiB cap ⇒ re-run the M1 drill at the target size
  BEFORE raising caps; a migration re-enters only through the review's
  benchmark matrix with owner sign-off); and the M1/M7 standing
  fixtures (`test:rlm-workspace` [7]/[8], 86 → 106 checks: park/seed
  byte-lossless at EXACTLY 4 MiB / 32 MiB / 1024 segments, cap+1
  refusals, per-field torn-payload refusals, canonical-form
  determinism — parse + re-serialize byte-identical; timings PRINTED
  never asserted).
- **Session 28 (PR #68)** measured the estimation-discipline positive
  control and ended the prompt-module era: the probe module-arm flag
  (`TRELLIS_EXP_MODULES`, resolved by `module_arm.ts` in the probe
  runner only) and the `est` suite (five sufficiency-bounded two-part
  questions over the four durable corpora; truths + minimal-evidence
  bounds unit-pinned in `estimation_suite.ts`) landed zero-paid; the
  50-run paired control ($2.3981, disclosed) moved the targeted
  behavior (median db calls on 1 vs off 2; frank median halved) but
  FAILED the token criterion pooled (13,240 vs 9,217, REVERSING on
  the two largest-corpus questions) — the owner RETIRED module #2
  outright the same day (manifest `retired`, loader refuses
  composition — `test:modules` [8]; the graph entity survives as the
  historical record) and set the PERMANENT direction: behavioral
  failure classes close by TOOLING SHAPE, not prompt modules. The
  recorded successors were rows 9 (Sessions 30–32) and 10
  (Session 33, whose acceptance harness the `est` suite became). All
  50 runs answered through `trellis_answer` (230/230 cumulative, zero
  transcription errors).
- **Session 29 (PR #71)** hardened the editing toolkit inside its
  unchanged contract, all zero-paid: CI's `offline` job now runs the
  textedit drill; `write_back` gained write-time containment
  re-verification (the load-time `_resolve` re-run), the in-root
  resolution-change refusal, source-mode preservation onto the
  replacement inode, and the final pre-replace digest re-check that
  NARROWS the TOCTOU window (residual documented in the docstring and
  pillar §6 item 1, never claimed closed); the drill grew 82 → 105/106
  checks (per-guard adversarial pins, multi-file per-file-independence
  in both orders, the stdlib import-allowlist / no-git-token static
  pin). Audit disposition: #2 narrowed + documented, #3–#8 closed,
  #10 half-closed, #9 stands on the Session 26 W4 live refusal, #1
  (cross-process proof run) stays owner-gated.
- **Session 30 (PR #72)** opened row 9 zero-paid:
  `docs/architecture/PROVENANCE_THREADING.md` ratified (the T1
  transcription / T2 laundering two-channel threat model; membership
  engine-decidable and total, support sampled — slice (d) closes T1,
  NOT T2) and the always-on `_retrieved_addresses` set landed at the
  citation-audit seam (`get_ast_texts` returned keys / `get_ast_blocks`
  block ids / `vector_search` result ids; NEVER `ast_hashes_exist`,
  `fetch_texts`, `run_cypher`, Tier-3 surfaces, or seeds; per run =
  per process, monotone, never parked; accessors return a copy;
  counts-only telemetry), pinned by `test:rlm-sandbox` [5] (21 → 40).
- **Session 31 (PR #73)** finished slices (c)+(d) zero-paid:
  slice (c) ADJUDICATED SATISFIED BY EXISTING SHAPE (every retrieval
  surface already threads address-with-content; verdict + evidence in
  `PROVENANCE_THREADING.md` §9) and slice (d) landed as the
  retrieval-membership write gate: `retrieved_addresses_check`
  constructor seam in the `ast_existence_check` injection mold,
  `_verify_hashes_retrieved` refusing any batch citing an address
  outside the run's set (typed bounded "Provenance Violation" teaching
  re-retrieval; order pinned format → existence → retrieval membership
  → experimental gates → write; the cited audit records the attempt
  before the refusal; whole-batch refusal before any session opens).
  Wired for research runs in `trellis_agent.py`; bare construction
  byte-identical. T1 CLOSED, T2 explicitly NOT (slice (e)'s detector).
  Pinned by `test:rlm-sandbox` [6] (40 → 53, first-run green).
- **Session 32 (PR #74)** finished row 9 zero-paid: a pre-existing
  drill breakage fixed first (`test:verification-sweep` seeded
  non-sha256 provenance since Session 14 — repaired); the slice (e)
  sampled entailment detector (`entailment_detection.ts`, sweep-side,
  never a write gate: uniform candidate pool, seeded sampler, judge
  budget with counted `deferred` overflow, each (edge, cited-hash)
  pair judged AT MOST ONCE ever — supported stamps additive
  `entailmentCheckedHashes`, unsupported contests with typed reason
  `unsupported_citation` + durable `unsupportedHashes`;
  judge-all-then-write atomicity; oracle mode; `entailment_sweep` job
  name on the shared verification queue; config twins rate 0.1 /
  budget 25 max 500; `npm run entailment:sweep`); 10 unit pins + drill
  sections [7]-[9] (`test:verification-sweep` 35 → 66); the first REAL
  judged sweep ran owner-approved July 13 (seed 32, 25/25 pairs,
  $0.0093: 9 CONFIRMED weak heading-block citations + 8 strict-judge
  verdicts on derived-classification `has_category` claims — the
  recorded calibration observation); slice (f) compat VERIFIED no-gap.
  T2 is MEASURED at a sampled rate, never eliminated — report the rate
  with every claim.
- **Session 33 (PR #75)** landed kernel-level retrieval discipline
  (roadmap row 10) zero-paid: `docs/architecture/RETRIEVAL_DISCIPLINE.md`
  document-first, then held-state dedup (IDENTITIES only, never
  content — full-repeat-only per requested hash set for
  `get_ast_texts` with partial-overlap serve-everything, per-root for
  `get_ast_blocks`, exact-query-match for `vector_search`; the
  padding evasion recorded honestly) + the per-run budget (kernel
  default 64 byte-returning fetches, cap 1024, env twin
  `TRELLIS_RETRIEVAL_BUDGET_PER_RUN`, refusal at budget+1 BEFORE any
  I/O; dedup refusals consume nothing; check order validation → dedup
  → budget → fetch), active ONLY on discipline-enabled
  `TrellisPostgres(retrieval_discipline=True, ...)` construction
  (research runs wire it on; bare construction byte-identical;
  `TRELLIS_EXP_OMIT_RETRIEVAL` is the probe-runner-only OFF arm,
  `buildAgentEnv` deletes it unconditionally). Typed bounded
  `Retrieval Discipline:` refusals; six counts-only telemetry fields;
  held state NEVER feeds the Session 30 retrieval set or the
  Session 31 write gate. Pinned by `test:rlm-sandbox` [7] (53 → 95,
  first-run green) + 3 `buildAgentEnv` unit pins. One design-stage
  defect caught pre-commit (the budget now validates BEFORE the
  connection opens — a refused bound leaks nothing). The slice (d)
  `est`-suite acceptance measurement stands PROPOSED owner-gated
  (~$2.40; criterion pre-stated in the archived §5 entry item 4).
  Row 10 STRUCK.

**Session 34 (July 13, 2026, PR #76) is complete: Trellis-on-Trellis
stage 1 — the scoped-snapshot machinery + the full code-substrate
extraction run; roadmap §4 row 11 stage 1 is STRUCK (stage 2 stays
open).** Two zero-paid implementation commits, the design record, the
owner-approved run (approval given up front), the measured close-out.
**(1) The forcing problem:** the full-repo dry run priced 4,575
post-exclusion blocks ≈ $12.35 — over the ≤$5/run cap — and the
budget gate is all-or-nothing, so scope selection under one durable
repo key became required machinery. **(2) Scoped snapshots:**
`repo:ingest --include <prefix>` (repeatable;
`SnapshotOptions.includePrefixes`) — segment-boundary match, doc keys
root-relative; out-of-scope previously effective paths CARRY FORWARD
at their previous root hash (outcome `unchanged`, never read, never
tombstoned — deletion decisions belong to covering runs); out-of-scope
paths with no prior version are typed `out_of_scope` skips (never
parsed); invalid prefixes refuse before I/O; unset scope
byte-identical (plan-equality pinned). `snapshot_ingest.test.ts` 17 →
24; `test:repo-ingest` 56 → 82 (Part 7). **(3) The decisions,
recorded before the run** (`REPOSITORY_INGESTION_REPORT.md` §5d):
repo key `trellis` at the repo root; scope `src`+`scripts`+`modules`
(bound 1,423 blocks; 112 files / 498 blocks excluded); `docs/` + root
prose DEFERRED to their own chunked proposal (~2,900 blocks ≈ $7.8);
`data/` EXCLUDED by decision; the residue DURABLE (`repo:trellis:*`
joins the durable list); five-part criterion pre-stated. **(4) The
run:** snapshot `trellis#1` — 298 ingested, 1,423 queued;
**1,423/1,423 jobs, zero failures, 53m42s** (serial worker
~26 jobs/min); 22 unresolved endpoints via pass-through; 9
merge-dropped actions (~0.6%); spend ≈ **$2.75 actual** (band
$2.4–$3.84). ALL FIVE criteria PASS: max hub `ast_nodes` 29 = 2.04%
of queued (bar ≤8%), zero denylist names, named kernel surfaces
resolve with provenance threading back to real fetched bytes. Graph:
1,995 entities / 1,788 ACTION relationships carry stage-1 provenance.
Residuals recorded, not acted on: `main` at 28 sources (the
cross-file function-name class); serial-worker throughput.
**(5) Stage-2 seams recorded, nothing implemented** (§5d.5):
dependency Cypher works today; graph→textedit bridge = provenance
hash → `document_nodes` → `repo:trellis:<path>` → `load`; entity
names lowercase-normalized; freshness = the ordinary churn loop. No
prompt byte; both composed-prompt pins unmoved.

**Session 35 (July 13, 2026, PR #77) is also complete:
Trellis-on-Trellis stage 2, increment 1 — the graph-informed
self-edit HARNESS (the edit run executed in Session 36).** Three
commits (the design record, the harness, the docs), no kernel byte,
no prompt byte, zero paid spend. **(1) The increment design record**
is `REPOSITORY_INGESTION_REPORT.md` §5e (document-first). The
selected target: `src/rlm/trellis_tools.py` carried two stale
Session 30 statements FALSIFIED by Session 31; the pre-scoped edit is
comment/docstring-only; the run must derive the correction from graph
+ fetched bytes. **(2) The named failure mode:** graph-misdirected
editing. Mechanical detection: `src/benchmarks/selfedit/check.ts`
(pure; typed findings `out_of_scope_edit` / `named_file_unchanged` /
`evidence_edge_missing` / `empty_evidence` / `contested_evidence` /
`dead_evidence_hash` / `unbridged_evidence` / `target_entity_missing`
/ `contested_target` / `doc_missing`; 21 unit pins) + `npm run
stage2:check` (`--pre` gates on an uncontested target + present
substrate doc; the post-run mode gathers `git status --porcelain`
(read-only), the Neo4j evidence-edge state, and the PG
current-version doc-key bridge, then evaluates — findings exit 1).
The evidence check leans on Session 31 mechanically: the run records
ONE derived insight citing the blocks it fetched — the write gate
already refuses unretrieved citations, so a successful write IS proof
of consultation. HONEST SCOPE (§5e.2): the checker proves the
recorded evidence chain and diff scope, not diff semantics — human
review reads the transcript. **(3) The drill** `npm run
test:selfedit-harness`: 39 checks, token-scoped fixture, every
detection code fired on its planted violation, the scripted rehearsal
driving the run's REAL tool sequence zero-LLM with the clean arm at
ZERO findings and the violation arm observing the LIVE gate refusal,
plus a read-only live-substrate smoke. **(4) The run proposal**
(§5e.4): Session 26 spawn mechanics, research mode,
`--max-iterations 12`, estimate $0.15–$0.45/run ≤$0.90 total,
five-part criterion pre-stated.

**Session 36 (July 13, 2026, PR #78) is also complete: stage-2
increment 1 EXECUTED and LANDED — the graph-informed self-edit run +
the freshness policy's first refresh** (roadmap §4 row 11 stage 2;
the row stays open pending the owner's increment-ladder judgment).
Total paid spend **$0.667** (runs $0.565 vs the ≤$0.90 proposal;
refresh $0.102). **(1) Run 1 FAILED at human `git diff` review
($0.2134) — recorded, reverted, diagnosed, NO silent retry:** hunk B's
splice range covered the wrong lines; the run saw the wrong diff
preview and wrote back anyway; decisively, the final verification
read and `trellis_answer.submit` sat in the SAME REPL cell, so the
printout showing the leftover stale line could not inform the
already-submitted success claim. The file was left syntax-broken.
`stage2:check` correctly reported zero findings — scope and evidence
WERE clean; diff semantics belong to human review (§5e.2's honest
scope). Failure class named: verify-then-submit collapsed into one
cell. **(2) Run 2 — the diagnosed contingency re-run LANDED
($0.3520), all five criterion items:** named-file-only diff; the
pre-scoped comment/docstring-only edit (two hunks, zero executable
lines); `stage2:check` zero findings; counts + diff + dollars
together; no harness flag. The run's ONE recorded insight
(`_verify_hashes_retrieved` `consumes` `get_retrieved_addresses`)
cites the two fetched consumer blocks — a Session 31 gated write,
consultation proven mechanically. **(3) The refresh — the §5d.6
freshness policy's first execution ($0.102):** plan echo FIRST, then
snapshot `trellis#2` — 24/24 jobs zero failures. The churn loop
observed live end to end: the old docstring block DEAD in v2, the
stage-1 ACTION edge CONTESTED with provenance preserved in
`orphanedSourceIds`, run 2's insight edge SURVIVED uncontested,
recovery = an operator re-derivation citing the new v2 block through
the ordinary write path. **(4)** No machinery defect found: run 1's
failure was the run's, not the harness's. NO kernel prompt byte.

**Session 37 (July 13, 2026, PR #79) is also complete: stage-2
increment 2 — the parse gate LANDED zero-paid; the owner-approved
deeper edit runs BOTH FAILED under the pre-stated criterion and are
recorded (roadmap §4 row 11 stage 2; the row stays open).** The
increment's product is measurement, not a landed diff; session paid
total **$0.7012** (runs $0.3994 + $0.2362; refresh $0.0656). Design
record: `REPOSITORY_INGESTION_REPORT.md` §5f + §5f.5. **(1) The parse
gate (landed, stays regardless):** `named_file_unparseable` joins the
checker's typed findings — `stage2:check` post-run mode parses every
named file (`.py` via the `config.python.executable` interpreter
running builtin `compile()` over the file bytes — py_compile's exact
syntax check WITHOUT its bytecode write, because the checker is
read-only; `.ts`/`.js` via `ts.createSourceFile` single-file parse
diagnostics; unwired extensions honestly unchecked). Pure evaluation
in `check.ts`; gatherers in `src/benchmarks/selfedit/parse_gate.ts`;
composes ADDITIVELY. Pins: 11 unit tests + drill section [6] planting
the EXACT preserved Session 36 run-1 failed-diff shape. **(2)
Selection by substrate query (§5f.2):** the `slice (d) will`
staleness family has exactly three surviving occurrences — the
`trellis_agent.py` research-mode telemetry comment (SELECTED: doubly
false, the same main() block wires
`retrieved_addresses_check=get_retrieved_addresses` eleven lines up),
the landed increment-1 residue (REJECTED — measured evidence), the
drill fixture's planted line (REJECTED — fixture bytes). New named
failure mode: near-duplicate mis-targeting. **(3) Run 1 FAILED on a
harness flag ($0.3994) — the FIRST live firing of the Session 35
bridge check:** the diff was CORRECT but the recorded insight cited
two `trellis_tools.py` blocks → 2 × `unbridged_evidence`. Diagnosed
DETERMINISTIC: directional Cypher saw 0 out-edges → the task's
vector_search widening branch → semantically-similar wrong-document
blocks. Tree reverted; operator cleanup recorded (the failed run's
residual edge DELETED before the contingency — bounded
acceptance-run hygiene, never belief-machinery precedent). **(4)
Run 2 (contingency, task text v2) FAILED at human `git diff` review
($0.2362):** the evidence chain was PERFECT (118 undirected edges →
26 provenance hashes → the in-file block identified and cited;
`stage2:check` ZERO findings INCLUDING the parse gate) — but the
splice replaced a 6-line window with 6 HAND-RETYPED comment lines
whose retype dropped two neighbors: the executable
`"retrieved_addresses": get_retrieved_address_count(),` line and the
Session 33 comment's first line. The file still PARSES — every
mechanical layer is structurally blind to a parseable semantic
deletion — and human review caught it, exactly where the criterion
places diff semantics. Failure named: **retype-splice neighbor
deletion** (the CODE_MEDIATED_TEXT §1 pathology). Both failed diffs
reverted and preserved locally
(`benchmark_logs/session37_run{1,2}_failed_diff.patch`). **Increment
verdict: FAILED; no third run.** Run 2's insight edge
(`trellis_agent` `wires` `get_retrieved_addresses`) STANDS; the
`trellis_agent.py` stale comment REMAINS IN PLACE (the retry's task —
do not hand-fix it). **(5)** The close-out refresh (snapshot
`trellis#3`; $0.0656) recorded the checkout EOL-normalization churn
class (cross-worktree snapshots re-hash mixed-EOL blocks —
environmental, not a defect). **(6) Close-out defect found and fixed
live:** harness-stopping `npm run dev:workers` on Windows orphans the
child tsx worker — the stale consumer STEALS queue-drill jobs
("timeout" while effects apply). KILL THE CHILD PROCESS TREE and
verify zero node/tsx worker processes before any queue drill.

**Session 38 (July 13, 2026, this PR) is also complete: structural
chunking increment 1 — the generic tree seam + the cAST split-merge
walk + the tree-sitter engine + shadow measurement landed zero-paid;
the owner-approved `src/rlm` pilot RAN and FAILED criterion item 3
as worded (roadmap §4 row 12; the row stays open on the owner's
rollout judgment).** Session paid total ≈ **$0.83** (refresh ~$0.29
est., pilot $0.540 actual, seam embeddings <$0.001). The full
measured record is `docs/architecture/STRUCTURAL_CHUNKING.md` §10.
**(1) The machinery (zero-paid, one commit):** the generic tree seam
`src/core/ast/generic_tree.ts` (`GenericTreeNode` = type + half-open
UTF-16 span + children; strict ordered/nested/in-parent validation —
violations typed, never guessed; spans verified `String.slice`-
semantics against multi-byte content); the cAST walk
`structural_chunker.ts` (pure: fit = one chunk; oversized recurses;
adjacent SAME-KIND siblings greedily merge to
`STRUCTURAL_MERGE_TARGET_CHARS` 3,000 — merging across kinds would
blur typed identity/eligibility, so small adjacent functions DO merge
into one `code_function` block, the density rule; oversized childless
leaves stay whole; comments/gaps glue to the FOLLOWING construct;
trailing gap appends to the preceding segment descending into
containers; gaps > threshold become bounded `code_chunk`; split
threshold 4,000 = policy 1's `MAX_CHUNK_CHARS`; byte coverage
enforced in the walk AND re-checked by `coversSource`; classes ALWAYS
containers); the engine `treesitter_engine.ts` (`web-tree-sitter`
0.26.11 runtime + `@vscode/tree-sitter-wasm` 0.3.1 grammar blobs for
typescript/tsx/javascript/python, BOTH exact-pinned in package.json —
a grammar bump is a substrate-identity event; ERROR/missing trees
refuse as typed `parse_error` — the broken-file policy stays unmade;
ECMA + Python chunk profiles with export/decorator unwrapping).
`parseSourceFile` gained `chunkingPolicy` (absent/1 = the Session 8
path BYTE-IDENTICAL, pinned in the plan-equality mold; 2 =
structural; markdown/text ignore it); `repo:ingest` gained
`--chunking-policy` + the `chunkingPolicy` snapshot-summary stamp
(default 1, pinned). New kinds
`code_import`/`code_const`/`code_type`/`code_statement` flow through
BOTH block walks via the existing childless-with-content branch —
NEITHER walk changed a byte (parity re-pinned with a structural-kinds
case). Recorded per-kind eligibility: `code_import` typed-and-skipped
(`EXTRACTION_INELIGIBLE_BLOCK_TYPES` in traverse.ts, consumed by
`planExtraction` — readable blocks, never paid extraction or
embedding); the other three ELIGIBLE. `npm test` 782 → 823 across 85
files. **(2) Shadow (zero-paid, `npm run chunking:shadow`):** 285
code files GREEN — monoliths >8,000 chars **15 → 0** (max 25,818 →
4,641); TS structureless share **51.6% → 0.4%** (PY 55% → 0%); blocks
2,332 → 2,682, eligible 1,839 → 2,389 (293 imports skipped); 3
over-cap glued-prefix exceptions counted; boundary oracle **911/911**
policy-1 functions intact inside one policy-2 block. **(3) The pilot
(snapshot `trellis#6`):** seam-query baseline FIRST (8 pre-stated
queries pinned in `scripts/chunking_seam_queries.ts`: 5/8 in top 3),
then `--include src/rlm --chunking-policy 2` — plan echo 110-block
bound (the shadow's exact number), 110/110 jobs zero failures,
$0.540. Criterion verdict (record §10.3): items 1/2/4/5 PASS (zero
monoliths and zero over-cap DB-verified — the 13,656-char `main()`
block is gone, max 3,999; structureless 27.3% → 0.0% in scope; max
pilot-scope hub `trellis_mcp_servers` 6/110 = 5.45% ≤ 8%, `main`'s
monolith hub-feeding gone; churn integrity green). **Item 3 FAILED as
worded: raw tool-shape seam queries 4/8 after vs 5/8 before.** Root
cause diagnosed, not argued away: DEAD-BLOCK EMBEDDING POLLUTION —
the re-chunk killed every old block but their embeddings stay
searchable in `search_ast_nodes` (no liveness filter), and ~256 dead
near-twins outrank the live re-chunks. The live-only diagnostic (NOT
the criterion instrument) reads 5/8 → 5/8 with the HEADLINE case
FIXED (the §5f.5 `trellis_agent.py` telemetry query: not-in-top-5 →
live-rank 2) and one genuine regression named (small-function merge
dilution on `trellis_blocks.py`). **Pilot verdict: FAILED under §7's
own rule; recorded and stopped — no retuning.** The policy-2
`src/rlm` substrate STANDS; two owner follow-up candidates recorded
(a liveness filter for `search_ast_nodes` or an embedding sweep over
superseded blocks — agent-visible tool behavior, owner-gated; the
merge-density knob). **(4) Churn + recovery observed live (third
time):** the pilot quarantined the three standing TRUE beliefs whose
evidence blocks died (Session 36's `returns_copy_of` recovery, the
Session 36 run-2 `wires` insight, the Session 37 run-2 `consumes`
insight — audit preserved); all three RECOVERED same-day as operator
re-derivations citing live policy-2 blocks, verified uncontested with
`rederivedAt` stamped. The `wires` evidence is now block
`9b4c3159…6a730` (a 2,961-char `code_statement` holding the main()
wiring); the old `2f703511…2514` is DEAD. **(5) The per-PR refresh
ran BEFORE the pilot by design** (snapshot `trellis#5`, policy 1:
17 files, 69/69 jobs zero failures) so it could not clobber the
pilot; FUTURE refreshes use the split-scope recipe (record §10.4).
**(6) Incidents:** a failed worker start (missing `benchmark_logs/`
in the fresh worktree broke the Tee pipeline) ORPHANED an npm tree
that kept consuming — the Session 37 stale-consumer class from a NEW
cause; caught by process-list inspection, both trees killed, queue
verified drained; refresh token actuals split across the two dead
registries (reported as the ~$0.29 estimate, honestly
unrecoverable). `npm run chunking:shadow -- --include x` does not
forward the flag on this npm — invoke `npx tsx
scripts/chunking_shadow.ts` directly. Zero defects in existing kernel
code; NO kernel prompt byte; both composed-prompt pins unmoved.

OpenCnid selected the MIT License on July 6, 2026.

Your objective is **Session 39: the increment-2 RETRY — the
comment-class diff gate zero-paid first, then the re-proposed
graph-informed edit run** (roadmap §4 row 11 stage 2; deferred from
Session 38 by the owner's July 13 sequencing decision, not dropped),
per §3–§6 below. Build and drill the gate FIRST (harness tooling, no
approval needed), then propose the run with task text v3 and WAIT for
owner approval before any paid spend. CRITICAL substrate note: the
Session 38 pilot re-chunked `src/rlm` under policy 2 — every
`src/rlm` block hash CHANGED; re-verify the retry's evidence against
the LIVE substrate before the run (§3). If the retry fails again,
STOP and put the three-failure record to the owner. The toolkit never
touches git. Do not re-plan or re-implement completed work. RLM
expands exclusively to Recursive Language Model (the MIT CSAIL
formulation).

---

## 0. The handoff loop (permanent — preserve this section in every rewrite)

This file is both the prompt that starts a session and the final deliverable
that session must produce. Trellis itself caches derived insights so repeat
queries get cheaper; this file does the same for engineering sessions. The
loop:

1. **Execute.** Study the repository and `TRELLIS_ROADMAP.md`, present the
   design for the objective in §3–§4 below, implement it, and pass every
   acceptance check in §6.
2. **Record.** Update `TRELLIS_ROADMAP.md`: mark the completed item(s) only
   after acceptance, and add a full-dated §5 progress entry with the exact
   commands run and counts observed, including any defects found along the
   way and how they were fixed.
3. **Regenerate.** Rewrite THIS file for the next session, in the same PR as
   the implementation:
   - Take the next objective from the first unstruck row of the roadmap's §4
     Suggested Sequencing table. If something discovered during this session
     should jump the queue (a correctness defect, a broken invariant), pick
     that instead and record the reason in the roadmap.
   - Update the session list above and §1 (mental model) with whatever
     architecture this session added.
   - Update §2 (baseline) with the new `master` commit, offline test counts,
     and live-check counts.
   - Replace §3–§6 with the next objective's specifics at the same level of
     concreteness as this file: a problem statement grounded in named
     files/functions, a recommended design with module names, an explicit
     offline/live test list, and the close-out command block.
   - Re-scope §7 (guardrails) and §8 (exclusions). Guardrails that encode
     permanent invariants (AST immutability, provenance, Zod boundaries,
     process split, no attribution) survive every rewrite.
   - Preserve THIS §0 verbatim.
   - The rewritten file must be fully self-contained: the next session starts
     with zero context beyond this repository.
4. **Ship.** One feature branch, one PR to `master`, plain engineering prose,
   no AI attribution or generated-by trailers anywhere (commits, PR bodies,
   code comments).
5. **Re-run the loop for late work (the event-loop rule; added by owner
   direction, July 9, 2026 — part of the permanent protocol from here on).**
   Regeneration is not a one-shot close-out. If further work lands in the
   same working period AFTER this file was rewritten — an owner-approved
   paid run, a follow-up fix, a new design record — re-run step 3's
   objective selection against what that work revealed before handing off.
   A defect discovered in a pathway the flywheel or the next objective
   depends on satisfies the jump-the-queue rule even when an existing gate
   contained it: containment is not remediation. Pointer edits to this file
   are not a substitute for re-selecting the objective. A handoff whose §3
   objective is stale relative to the session's own findings has not
   finished step 3. (Origin: the module #1 laundering finding and its
   design record initially landed as standing-item pointers while §3 still
   named the pre-finding objective; the owner corrected the priority.)

A session that completes its objective but does not regenerate this file has
not finished.

---

## 1. Architectural mental model

Trellis's core invariant is that every semantic fact remains traceable to an
immutable, content-addressed physical location in source material.

1. **PostgreSQL + pgvector — physical layer**
   - `ast_nodes` stores immutable Merkle AST nodes and optional embeddings.
   - `documents`/`document_nodes` store stable document keys, version
     history, and per-root membership (global source liveness checks).
     Since Session 17 `documents` also carries a nullable `origin JSONB`
     column — the promotion audit stamp; only segment promotion writes
     it, inside the ingest transaction.
   - `repository_snapshots`/`repository_snapshot_paths` (Session 8)
     record which paths each published repository snapshot contained.
     Since Session 38 the published summary stamps `chunkingPolicy`.
   - KNOWN SUBSTRATE PROPERTY (measured Session 38): `search_ast_nodes`
     has NO liveness filter — superseded blocks keep their embeddings
     and appear in vector-search results forever; every re-ingest adds
     dead near-twins that can outrank live blocks. A liveness filter or
     an embedding sweep over superseded blocks is a recorded
     owner-gated candidate (it changes agent-visible tool behavior) —
     do not build it unilaterally.
   - Durable measurement substrate (Sessions 21–23):
     `data/frankenstein.txt` and `data/synthetic_chronicle.txt`
     (committed, byte-stability unit-pinned, `.gitattributes -text`)
     are ingested as `book:gutenberg-84:frankenstein` and
     `book:synthetic:ninth-circuit-chronicle`; the 40 deterministic
     ledgers (`src/benchmarks/effective_context/synthetic_corpus.ts`)
     as `ledger:synthetic:house-01…40`; and the Session 23 relational
     corpus (`relational_corpus.ts`, concat sha `3bbbea18…a697`
     unit-pinned) as `ledger:synthetic:s2-house-001…100` +
     `registry:synthetic:captains` + `tariff:synthetic:port-schedule`
     (all extraction `none`, no embeddings). The three promoted
     research docs
     `research:trellis/workspace-discipline/{contract,evidence,code-mediated-text}`
     are module #1's corpus documents. NOTE (measured Sessions 22–23):
     the root-hash reconstruction (`nodeText`/`get_ast_texts`)
     concatenates paragraph blocks with UNMARKED boundaries — parse by
     shape without trailing `\b`. Session 24 fixed the localization
     class structurally: `get_ast_blocks(root_hash)` returns ordered
     blocks directly (round 4: 0/36 misses vs 7/30).
   - The verified ingest transaction lives in `src/core/ingestion/`
     (`ingest_document.ts`: persist → read-back re-hash verification →
     membership → registration → in-transaction Merkle diff;
     `plan_ingest.ts`: explicit `none`/`changed` extraction policy with
     a hard block budget — since Session 38 it also skips
     `EXTRACTION_INELIGIBLE_BLOCK_TYPES`, today exactly `code_import`).
     `POST /ingest` is a thin delegate; tombstones are ordinary ingests
     of a deterministic empty root. Schema bootstrap is serialized by
     `pg_advisory_xact_lock`; Neo4j bootstrap retries transient
     label-lock deadlocks and creates `entity_name_index`.
   - **Source parsing and chunking (Sessions 8 + 38;
     `src/core/ast/source_parser.ts`):** dispatch by language.
     `parseSourceFile(filePath, bytes, {pythonExecutable,
     chunkingPolicy?})` — policy absent/1 is the Session 8 path
     (top-level Babel/python-ast blocking, gap material in ≤4,000-char
     `code_chunk`s), BYTE-IDENTICAL and pinned; policy 2 (Session 38,
     operator-explicit per run, NEVER a default) routes the three code
     languages through `treesitter_engine.ts` (web-tree-sitter 0.26.11
     + @vscode/tree-sitter-wasm 0.3.1 grammar blobs, both EXACT-pinned;
     ERROR trees refuse as `parse_error`) into the generic tree seam
     (`generic_tree.ts`, validated UTF-16 spans) and the pure cAST
     split-merge walk (`structural_chunker.ts`: fit = one chunk,
     oversized recurses, same-kind greedy merge to 3,000 chars, split
     threshold 4,000, oversized childless leaves whole, trivia glues
     forward, classes always containers, byte coverage enforced
     twice). Policy-2 kinds: `code_import` (typed-and-skipped from
     extraction) / `code_const` / `code_type` / `code_statement` —
     leaves collected by BOTH block walks via the
     childless-with-content branch (no walk change; parity pinned).
     Markdown and every prose corpus keep their pinned geometry under
     every policy. Measurement scripts: `npm run chunking:shadow`
     (both-policy distribution + the Babel/python-ast boundary oracle;
     for scoped runs invoke `npx tsx scripts/chunking_shadow.ts
     --include <prefix>` directly — npm `--` forwarding is broken on
     this npm) and `scripts/chunking_seam_queries.ts` (the eight
     PINNED seam queries — never tune them between measurements).
   - **The promotion path (Session 17; `src/core/promotion/`):** the
     ONLY route from Tier 3 to Tier 1: `plan_promotion.ts` (typed
     refusals; content byte-verbatim) + `promote_segment.ts` (one
     planned request through the unmodified verified transaction) +
     the operator CLI `npm run promote`. Because the doc key is
     stable, re-promotion versions the document and the Merkle-diff →
     sweep machinery contests stale beliefs for free. Drill:
     `npm run test:promotion`.
2. **Neo4j — semantic and belief layer**
   - `Entity` and `Conflict` nodes plus `ACTION`, `CONTRADICTS`,
     `DERIVED_INSIGHT`, `SAME_AS`/`DISTINCT_FROM` edges, all carrying
     `sourceNodeIds`. `contested`/`contestedAt` (epoch millis)/
     `orphanedSourceIds`/`rederivedAt` form the audit-preserving
     quarantine/recovery state machine
     (`src/core/graph/provenance.ts`).
   - Entity identity is immutable; equivalence is an overlay belief.
     Retrieval expands one trusted `SAME_AS` hop with per-fact
     `viaAlias`.
   - **Extraction (Sessions 1/8/25):**
     `src/workers/extraction_worker.ts` consumes `extraction_queue`
     jobs `{astNodeId, text, sourceKind?, language?, ...}`: pure
     payload parsing (unknown sourceKind/language refused loudly
     BEFORE any I/O) → liveness gate → one completion with the routed
     prompt (`buildExtractionPrompt`: `code` selects the Session 25
     code-tuned prompt; `prose`/absent compose the EXACT legacy bytes,
     unit-pinned) → `suppressGenericIdentifiers` →
     `resolveExtractedGraph` →
     `mergeWithAstLivenessFence(mergeExtractedGraph)` (dropped actions
     counted, never silent) → per-block embedding. Repository
     snapshots stamp sourceKind per file language and force policy
     `none` for `isTestOrFixturePath` files. Extraction spend is
     always operator-gated.
   - **Session 14 (kernel):** the single agent write path
     (`write_derived_insight`/`write_derived_insights` in
     `src/rlm/trellis_tools.py`) ENFORCES provenance: every
     `sourceNodeIds` element must match `^[0-9a-f]{64}$` AND exist in
     `ast_nodes` (checked via the injected `ast_existence_check`
     before the WRITE session opens). Never weaken or make this
     configurable. **Sessions 30–31 sit beside it:** the run's
     retrieved-address set (`docs/architecture/PROVENANCE_THREADING.md`)
     is recorded engine-side, always on — `get_ast_texts` returned
     keys, `get_ast_blocks` block ids, `vector_search` result ids,
     fed inside `_audit_add`; `ast_hashes_exist`, `fetch_texts`,
     `run_cypher`, Tier-3 surfaces, and seeds NEVER contribute;
     accessors `get_retrieved_addresses()` (a copy) /
     `get_retrieved_address_count()`; counts-only telemetry.
     Session 31 activated slice (d): research runs construct
     `TrellisNeo4j` with
     `retrieved_addresses_check=get_retrieved_addresses`, and
     `_verify_hashes_retrieved` refuses any batch citing an address
     outside the run's set (typed bounded "Provenance Violation";
     order pinned format → existence → retrieval membership →
     experimental gates → write; the cited audit records the attempt
     before the refusal). Bare construction passes None and writes
     exactly as before. T1 CLOSED. **Session 32:** T2 (read-then-cite
     laundering) is MEASURED by the sampled entailment detector
     (`entailment_detection.ts`, sweep-side, never a write gate;
     recovery is re-derivation; oracle mode drills it zero-LLM). The
     detector is a SAMPLED measure at a rate — report the rate with
     every claim. **Session 33 sits beside all of it at the SAME
     surfaces:** retrieval discipline
     (`docs/architecture/RETRIEVAL_DISCIPLINE.md`) — held-state dedup
     (typed `Retrieval Discipline:` refusals: full-repeat-only for
     `get_ast_texts`, per-root for `get_ast_blocks`,
     exact-query-match for `vector_search`) and the per-run budget
     (default 64, cap 1024, env twin
     `TRELLIS_RETRIEVAL_BUDGET_PER_RUN`), active ONLY on
     discipline-enabled `TrellisPostgres` construction (research runs
     wire it on; bare construction byte-identical;
     `TRELLIS_EXP_OMIT_RETRIEVAL` probe-only OFF arm). Held state
     holds identities only, never content, never feeds the retrieval
     set or the write gate (`test:rlm-sandbox` [7]).
   - **The verification layer (Phase 5 + Session 32):** two sampled
     re-check tiers over the shared `verification_queue` — the
     classifier sweep and the entailment sweep (job name
     `entailment_sweep`; rate + budget config twins; overflow
     deferred and counted). Both have oracle modes; both contest
     through the Phase 4 path, never delete. Real sweeps are
     owner-gated per run.
   - **Module entities (Session 18):** each research-bearing ACTIVE
     module manifest is registrable as a graph entity whose
     `sourceNodeIds` are the manifest's research hashes; the unchanged
     sweep contests a capability when its research basis changes.
     Contested/retired manifests are skipped; entities are contested
     or retired, never deleted.
3. **Redis + BullMQ — asynchronous layer**
   - Seven queues: `extraction_queue`, `rlm_queue`, `supervisor_queue`,
     `invalidation_queue`, `verification_queue`, `resolution_queue`,
     and `agent_queue`. `rlm_queue` and `agent_queue` use interactive
     no-retry job options; the rest use bounded retries. All LLM calls
     live inside BullMQ workers or the RLM process; every
     worker-consumed completion crosses `parseLlmResponse`.
   - **Scratch parking (Session 16):**
     `scratch:goal:<goalId>:task:<taskId>` holds one task's end-of-run
     workspace snapshot, TTL-bounded and volume-capped. Redis is a
     parking lot, never a live store the model queries. Promotion
     consumes parked snapshots — TTL expiry is BY DESIGN.
4. **RLM execution, the agentic loop, and external surfaces**
   - `GET /api/rlm-stream` (API-key gated) enqueues one `rlm_queue`
     job. `src/workers/rlm_worker.ts` spawns one Python process per
     job (`trellis_agent.py`) with config forwarded via env by the
     pure `buildAgentEnv` helper in `src/workers/rlm_job.ts` (unset
     config values stripped, never passed through raw; experiment
     flags deleted unconditionally). `buildAgentArgs` forwards
     `--max-iterations`, `--goal-id`, and worker-named
     `--workspace-out`/`--seed-workspace` temp files. The worker
     publishes stdout and feeds two pure bounded scanners
     (`RlmTelemetryScanner`, `RlmResultScanner`). Payloads are
     normalized by `parseRlmJobData`; they carry nothing MCP-,
     workspace-content-, or textedit-shaped (unit-pinned).
   - `src/rlm/trellis_agent.py` wraps the `rlms` recursive-LM library
     (model `gpt-5.4-2026-03-05`, `max_depth` 1) and injects tools via
     `custom_tools` — `trellis_neo4j` (read-only Cypher + the hardened
     write path), `trellis_postgres` (`get_ast_texts`,
     `get_ast_blocks`, `vector_search`, `ast_hashes_exist`),
     `trellis_answer`, and — only when the operator configured servers
     — `trellis_mcp` (`src/rlm/trellis_mcp.py`: allowlist BEFORE any
     I/O, double-bounded timeouts, credential scrubbing). PROVENANCE
     SPLIT: database tools increment `_count_tool_call()`; MCP calls
     count separately — an answer with zero DATABASE tool calls emits
     `TRELLIS_PROTOCOL_VIOLATION`. Sessions 30–33 machinery lives here
     (see the Session 14 bullet).
   - **The by-reference answer channel (Session 22;
     `src/rlm/trellis_answer.py`):** `submit(expression_text)`
     evaluates in the calling REPL frame, structurally refuses bare
     literals, refuses `None`/over-cap, renders deterministically,
     prefixes `FINAL_ANSWER: ` engine-side. Measured: 230/230
     cumulative paid runs, zero transcription errors.
   - **The Tier-3 workspace (Sessions 14/16;
     `src/rlm/trellis_workspace.py`):** injected when MCP servers are
     configured OR `--goal-id` OR seeded; otherwise byte-identical
     prompt and namespace. Budgets raise `WorkspaceBudgetError`;
     park/seed drill-pinned at cap sizes; the cap-raise doctrine
     (pillar §7) stands. Tier 3 has NO provenance standing.
   - **CORE PILLAR — code-mediated text (ratified July 9, 2026;
     `docs/architecture/CODE_MEDIATED_TEXT.md`):** *the model never
     counts, and the model never copies.* Locations engine-computed;
     existing bytes moved by code (splice at a computed address,
     hash-guarded write-back), never re-typed through attention; the
     model authors only genuinely new text. Sessions 20–24 closed the
     transcription channel and the localization read boundary;
     Session 27 recorded the data-plane verdict; Sessions 30–32
     applied the pillar to the write path; Session 33 to retrieval
     spend; **Session 38 to the substrate's own granularity**
     (structure the engine can compute — typed construct blocks —
     instead of blob chunks attention must re-read). Session 37
     run 2's retype-splice neighbor deletion is the §1 pathology
     observed live — the mechanical closure candidate (structural
     splice addressing in `trellis_textedit`) is named in
     `STRUCTURAL_CHUNKING.md` §8, deliberately out of scope, own
     design record needed.
   - **The editing toolkit (Session 20; `src/rlm/trellis_textedit.py`):**
     injected ONLY when the operator sets `TRELLIS_EDIT_ROOT`. Every
     path strictly resolves inside the real root. `load` holds a
     frame + load-time sha256; `locate` returns engine-computed
     0-based half-open addresses; `splice` stages replacements (lists
     of strings free of "\n" — a "\r" is an ordinary byte WITHIN a
     line); `write_back` re-hashes disk bytes and RAISES
     `StaleFileError` on mismatch, else temp + rename (Session 29
     hardening inside the contract; TOCTOU residual documented, not
     denied). Telemetry counts only; toolkit ops never satisfy the
     provenance protocol. The toolkit never touches git.
   - **The module registry (Sessions 15/18):** `TRELLIS_ADDENDUM` =
     base + Σ selected module addenda + workflow rules. PROTOCOL
     MODULES ONLY this kernel edition. Addendum files are brace-free;
     both validators are bound-for-bound twins. The composed default
     prompt is pinned at `COMPOSED_SYSTEM_PROMPT_SHA256 =
     5d27e474…fe2a`; the omit-arm pin is `45987904…0b56`
     (`test:modules` [7] re-proves the structural relationship every
     run). Module #1 (`workspace-discipline`) is at version 2. Module
     #2 (`estimation-discipline`) is RETIRED (loader refuses
     composition — `test:modules` [8]). The owner direction is
     PERMANENT: behavioral failure classes close by tooling shape,
     not prompt modules.
   - **Grounded authoring (Session 19):** the kernel mode that drafts
     a protocol module addendum from a FIXED promoted corpus and
     nothing else; the harness holds the pen (pinned citations,
     anchor gate, draft scanner). The paid authoring run is
     owner-gated per run.
   - CRITICAL rlms constraints (verified against rlms==0.1.3):
     `custom_system_prompt` REPLACES the base REPL protocol prompt —
     Trellis EXTENDS `RLM_SYSTEM_PROMPT`; rlms runs `.format()` over
     the prompt so literal curly braces are forbidden (escape by
     doubling). `LocalREPL` persists `self.locals` across turns; on
     exception, rebindings are lost but in-place mutations persist;
     underscore-prefixed names never persist.
   - The orchestrator (Sessions 9/16) lives in `src/core/agent/` and
     is a pure decision maker with NO tools and no database access;
     it routes workspace lineage BY REFERENCE. Zero-LLM drills:
     `AGENT_ORACLE_ENABLED=true` — `npm run test:agent-loop`.
   - **The A2A server surface (Session 11)** exposes the goal loop to
     external agents behind `TRELLIS_A2A_ENABLED` (default false; the
     API is byte-identical when unset). IORedis gotcha: issue
     `subscribe` in the SAME tick the connection is created.
5. **Observability and process boundaries**
   - `src/core/observability/` defines pino JSON logging and
     per-process Prometheus registries; API and workers are separate
     processes. Bounded metric labels only — queries, goals,
     artifacts, paths, hashes, entity names, tool arguments/results,
     file content, diffs, digests, URLs, credentials, and retrieved
     addresses never become label values (entity names may appear in
     log CONTENT; operator CLIs may print hashes). Queue-depth gauges
     cover all seven queues. Workspace, lineage, textedit,
     retrieval-set, and entailment telemetry is counts only.
6. **The frontend (DEFERRED — unscheduled) and other stable subsystems**
   - `src/frontend/` is a Next.js 16.2.9 / React 19 app, dev-only; NOT
     this session's work unless the owner directs it.
     `src/frontend/AGENTS.md` warns: read
     `node_modules/next/dist/docs/` before writing Next-specific code.
   - Whole-codebase ingestion: `src/core/repository/`, `npm run
     repo:ingest`, live drill `npm run test:repo-ingest`. **Session 34
     added scoped snapshots** (`--include <prefix>`, carry-forward,
     typed `out_of_scope` skips, plan-equality for unset scope).
     **Session 38 added `--chunking-policy <1|2>`** (default 1; policy
     2 = structural; stamped in the snapshot summary; re-chunking
     re-hashes blocks and re-buys extraction — scope it). **The
     self-substrate is LIVE:** repo-key `trellis`, scope
     `src`+`scripts`+`modules`, doc keys `repo:trellis:<path>` —
     durable, never drill-cleaned. Substrate state after Session 38:
     `src/rlm` at chunking policy 2 (snapshot `trellis#6`), everything
     else policy 1 (snapshot `trellis#5`). THE SPLIT-SCOPE REFRESH
     RECIPE (record §10.4) is mandatory until the owner widens the
     rollout: policy-1 refresh with `--include src/core --include
     src/api --include src/workers --include src/benchmarks --include
     src/config --include src/frontend --include scripts --include
     modules` (everything EXCEPT src/rlm — carry-forward preserves the
     pilot), plus a separate `--include src/rlm --chunking-policy 2`
     run when src/rlm changed. A plain `--include src` policy-1
     refresh would REVERT the pilot and re-buy extraction.
     **Session 35 added the stage-2 self-edit harness**
     (`src/benchmarks/selfedit/check.ts`, `npm run stage2:check`,
     `test:selfedit-harness`); **Session 37 added the parse gate**
     (`named_file_unparseable` + `parse_gate.ts`); the comment-class
     diff gate is THIS session's addition (§4).
   - Benchmarks: OOLONG v1 saturated; anti-shortcut v2 at
     `data/oolong_pairs_dataset_hard.json`; scale evidence in
     `docs/benchmarks/SCALE_PROVENANCE_REPORT.md` and
     `REPOSITORY_INGESTION_REPORT.md`; the effective-context probe
     (rounds 1–4 + the Session 28 control) in
     `EFFECTIVE_CONTEXT_PROBE_REPORT.md` over the four durable
     corpora.
   - The fixture MCP server (`scripts/fixture_mcp_server.py`) is the
     only MCP server acceptance ever configures.

## 2. Current baseline

Repository state at handoff creation:

- `master`: the head after the July 13, 2026 Session 38 PR
  (structural chunking increment 1 — the PR that carries this file).
  Use `git log -- HANDOFF.md` to confirm this PR landed; if it is
  still unmerged when this session starts, STOP and merge it first.
- `modules/workspace-discipline/` is at VERSION 2 (module #1); module
  #2 (`estimation-discipline`) is RETIRED (loader refuses
  composition; the graph entity persists as history). The dev PG
  durably carries the four probe corpora, the three promoted research
  docs, and — since July 13, 2026 — **the self-substrate at snapshot
  `trellis#6`** (the Session 38 pilot: `src/rlm` re-chunked under
  policy 2 — 8 files, 118 typed blocks, 110 extracted) over
  `trellis#5` (the Session 38 per-PR refresh, policy 1, 313 accepted
  files) over `trellis#3`/`#2`/`#1`. Stage-1 extraction produced
  1,995 entities / 1,788 ACTION relationships; the pilot added
  fine-grained per-construct provenance for `src/rlm` and quarantined
  89 nodes / 202 relationships (audit preserved — standard lazy
  recovery, never "cleaned up"). Known state by design: the THREE
  standing DERIVED_INSIGHT beliefs (`trellis_agent` `wires`
  `get_retrieved_addresses`; `_verify_hashes_retrieved` `consumes`
  `get_retrieved_addresses`; `get_retrieved_addresses`
  `returns_copy_of` `_retrieved_addresses`) were quarantined by the
  pilot churn and RECOVERED as operator re-derivations citing live
  policy-2 blocks — all three read uncontested with `rederivedAt`
  stamped; the `wires` evidence block is now `9b4c3159…6a730` (a
  2,961-char `code_statement` holding the main() wiring — the OLD
  `2f703511…2514` is DEAD). The `main` entity reads contested (its 30
  monolith-era sources all died in the re-chunk; the new extraction
  feeds finer entities instead — data, not a defect; leave it). The
  `trellis_agent.py` stale telemetry comment (lines ~575–578 on disk)
  REMAINS IN PLACE — it is THIS session's run task; never hand-fix
  it. Dead-block embedding pollution stands as a recorded substrate
  property (§1) — name it whenever describing vector-search results.
  ~640 documents total in `documents`; the two promoted
  `research:trellis/estimation-discipline/{contract,evidence}` docs
  remain; 15 contested OOLONG-era edges from the July 13 entailment
  sweep remain (lazy-recovery residue). Roadmap §4 rows 5/6/6a/8/9/10
  and row 11 STAGE 1 are STRUCK; row 11 stage 2 is IN PROGRESS
  (increment 1 landed Session 36; increment 2 failed Session 37; the
  retry is THIS session); row 12 is IN PROGRESS (machinery + shadow
  landed, pilot ran and failed item 3 as worded — continuation is the
  owner's); row 7 stays trigger-blocked.
- Session 38 changed NO kernel prompt byte — both composed-prompt
  pins unmoved (default `5d27e474…fe2a`, omit-arm `45987904…0b56` —
  recompute BOTH in the same commit only if the kernel prompt or
  rubric legitimately changes). Its code surface:
  `src/core/ast/generic_tree.ts` + `structural_chunker.ts` +
  `treesitter_engine.ts` (new, with tests), `source_parser.ts` (the
  `chunkingPolicy` param), `traverse.ts`
  (`EXTRACTION_INELIGIBLE_BLOCK_TYPES` — the walk itself unchanged),
  `plan_ingest.ts` (the eligibility filter), `snapshot_ingest.ts`
  (the `chunkingPolicy` option + summary stamp),
  `scripts/ingest_repository.ts` (`--chunking-policy`),
  `scripts/chunking_shadow.ts` + `scripts/chunking_seam_queries.ts`
  (new operator measurement scripts), `package.json`
  (`web-tree-sitter` 0.26.11 + `@vscode/tree-sitter-wasm` 0.3.1,
  BOTH exact-pinned — a bump is a substrate-identity event). Run
  logs in `benchmark_logs/` (gitignored, local):
  `session38_workers.log` / `session38_pilot_workers.log` /
  `session38_pilot_ingest.log` / `session38_seam_before.log` /
  `session38_seam_after.log` / `session38_compose.log`. The
  Session 37 artifacts (`session37_run{1,2}_failed_diff.patch`,
  `session37_task_v2.txt`) remain — the retry's reference shapes.
  Reminder from Session 24: `block_parity.test.ts` SPAWNS the real
  Python walk inside plain `npm test` — a machine without Python on
  PATH fails the unit suite; CI sets up Python 3.13 before
  `npm test`.
- Offline baseline: `npm test` = 823 passing across 85 files
  (Session 38 added `generic_tree.test.ts`,
  `structural_chunker.test.ts`, `treesitter_engine.test.ts`, the
  parity structural-kinds case, and the snapshot-stamp pins).
- `npm run build` and `npm run python:check` pass (the check imports
  polars — an environment without it fails the check by design).
- `npm run drill:scale`: gate CLOSED at max provenance 286.
  Session 38 read 1.69x CLOSED (in-band ~1.48x–2.26x, first try);
  Session 37 1.76x; Session 36 1.63x; Session 35 1.68x. If a future
  run reads OPEN, re-run before believing it — a REPRODUCING open
  reading is the migration trigger (roadmap §4 row 7) and the owner
  adjudicates. The drill rewrites the tracked
  `scale_drill_results.json` — commit it with the session PR (the
  committed copy is Session 38's 1.69x CLOSED run). Run the scale
  drill ALONE — never concurrently with other live drills on the
  shared dev database.
- Live zero-LLM checks (Session 38 observed, all green):
  `test:selfedit-harness` (ALL CHECKS PASSED — the count is
  environment-shaped; runs the rehearsal python, so it needs the
  Python runtime deps), `test:answer-channel` (32), `test:textedit`
  (105 on Windows; 106 on POSIX), `test:module-lifecycle` (60),
  `test:modules` (green — pins unmoved), `test:promotion` (41),
  `test:rlm-workspace` (106), `test:rlm-mcp` (86),
  `test:rlm-sandbox` (95), `test:verification-sweep` (66),
  `test:agent-loop` (ALL CHECKS PASSED), `test:a2a` (ALL CHECKS
  PASSED), `test:repo-ingest` ("All checks passed" is the signal —
  the [PASS] count is environment-dependent by construction),
  `test:benchmark-hardening` (24), `test:entity-resolution` (34),
  `test:api-hardening` (18), `test:belief-recovery` (30),
  `test:invalidation-sweep` (17).
- Isolated Compose integration: 11 assertions (`--profile test`,
  unique project name; includes the containerized credentialed MCP
  fixture probe and the in-container `polars 1.34.0` import probe).
  Session 38 ran it as project `trellis_s38_ci` (11/11 PASS;
  package.json changed — the npm ci layer rebuilt) and tore it down
  with `--volumes`. The CI-mold invocation: env `COMPOSE_PROJECT_NAME`
  + the five host-port variables at 0 + an `API_KEY`, then
  `docker compose --profile test up --build
  --abort-on-container-exit --exit-code-from integration
  integration`, then `down --volumes --remove-orphans`. The isolation
  host-port variables are EXACTLY `TRELLIS_POSTGRES_HOST_PORT`,
  `TRELLIS_NEO4J_HTTP_HOST_PORT`, `TRELLIS_NEO4J_BOLT_HOST_PORT`,
  `TRELLIS_REDIS_HOST_PORT`, `TRELLIS_API_HOST_PORT` — set each to 0.
  NOTE: C: ran ~20 GB free at Session 38's close; a FULL image
  rebuild needs several GB of headroom. `requirements.txt` unchanged
  this session — the pip layer stays cached.
- The standing owner-conditional items — all propose-with-estimate,
  never self-served: **(1) the row-10 slice (d) acceptance
  measurement** (the `est` suite paired re-run, 50 runs, ~$2.40;
  criterion pre-stated in the archived Session 33 §5 entry item 4);
  **(2) the judge-calibration decision** for derived-classification
  claims (the July 13 sweep's 8/25 strict-judge verdicts); **(3) the
  stage-1b prose chunk** (~2,900 blocks ≈ $7.8, needs its own
  chunked proposal); (4) the pandas head-to-head probe round; (5)
  the cross-process concurrency proof run (coverage-audit gap #1);
  **(6) the substrate freshness cadence** (ADOPTED July 13: one
  scoped refresh per merged PR + refresh-before-use ahead of stage-2
  edit runs; each refresh's extraction spend still gated per run —
  NOW UNDER THE SPLIT-SCOPE RECIPE, §1 item 6); **(7) the targeted
  stage-1 entailment sweep** (~100 pairs ≈ $0.04); **(8) the row-12
  rollout continuation** (the pilot FAILED criterion item 3 as
  worded — dead-block embedding pollution — with items 1/2/4/5
  passing and the headline retrieval case fixed live-only; widening
  scope, retuning merge density, or reverting is the owner's call
  with the record §10.3); **(9) the `search_ast_nodes` liveness
  filter or superseded-embedding sweep** (agent-visible tool
  behavior — needs its own small design record); (10) structural
  splice addressing in `trellis_textedit` (the retype-splice
  mechanical closure — own record, import-allowlist implications).
  If the owner declines the retry run, this list is the fallback
  menu.
  OPERATIONAL NOTES (Windows): stopping `npm run dev:workers`
  through the session harness — OR a failed pipeline start (a
  missing `benchmark_logs/` directory broke a Tee and orphaned the
  npm tree, Session 38) — leaves stale consumers that steal
  queue-drill jobs ("timeout" while effects apply = the tell).
  Create `benchmark_logs/` before piping worker output; KILL THE
  CHILD PROCESS TREE and verify zero node/tsx worker processes
  (`Get-CimInstance Win32_Process`) before any queue drill. gpt-5.4
  $2.50/M in + $10/M out; metrics port 9464 for worker actuals
  (per-process registries — split consumers lose totals).
- CI target is Node 22 (the `offline` job also runs `test:textedit`
  after its Python-runtime install). Local environment: Node
  20.19.2, Python 3.13.1, Docker Compose v2, PostgreSQL 16.14,
  Neo4j 5.11.
- Python runtime deps are pinned in `requirements.txt` (`rlms==0.1.3`,
  `openai`, `neo4j`, `psycopg2-binary`, `unstructured`, `mcp==1.12.4`,
  `polars==1.34.0` — pinned NOT adopted, no kernel/contract/prompt
  path imports it); `npm run python:check` verifies
  syntax/imports/assets.
- The `documents.origin` column ships in the idempotent bootstrap.
- Raw probe/run logs live under `benchmark_logs/` (gitignored — local
  only; the numbers live in the committed reports).
- The frontend has NO offline tests and NO CI coverage today.

Fresh worktrees do not contain `node_modules`. Start with:

```
 git status --short --branch
 git branch --show-current
 npm ci
 npm test
 npm run build
 npm run python:check
 docker compose config --quiet
```

Work on a feature branch and target `master`.

## 3. Session 39 problem statement

**The increment-2 RETRY (roadmap §4 row 11 stage 2): close run 2's
measured escape mechanically, then re-run the same owner-scoped
edit.** Sessions 37–38 left three facts a new session must act on:

- **The measured escape (Session 37 run 2):** a comment-class edit
  that DELETED parseable executable neighbors — the splice replaced a
  6-line window with 6 hand-retyped comment lines, dropping the
  executable `"retrieved_addresses": get_retrieved_address_count(),`
  line and the Session 33 comment's first line — passed the scope
  check, the evidence check, AND the parse gate (the file parses),
  and only human `git diff` review caught it. For a declared
  comment-class increment this is mechanically decidable from the
  diff alone: every changed line (both removed and added sides) in
  the named file must be a comment line or blank. That check belongs
  in the checker as a typed finding.
- **The target still stands:** the `trellis_agent.py` research-mode
  telemetry comment ("Bookkeeping; slice (d) will constrain citable
  addresses to the set itself.", lines ~575–578 on disk) remains
  stale. Run 2's insight edge (`trellis_agent` `wires`
  `get_retrieved_addresses`) EXISTS, recovered and uncontested — a
  retry's gated write MERGEs onto it (provenance union). The
  failed-run diagnosis chain is in
  `REPOSITORY_INGESTION_REPORT.md` §5f.5; task text v2 (the working
  evidence path, preserved locally as
  `benchmark_logs/session37_task_v2.txt`) is the base for v3.
- **The substrate moved under the target (Session 38):** the pilot
  re-chunked `src/rlm` under chunking policy 2 (snapshot `trellis#6`)
  — every `src/rlm` block hash CHANGED. The §5f.5-era evidence block
  `2f703511…2514` is DEAD; the main() wiring now lives in the
  2,961-char `code_statement` block `9b4c3159…6a730` (policy 2 splits
  main() into statement runs, so the wiring and the telemetry dict
  are no longer one 13.7 KB blob — the retrieval consequence is
  already visible: the seam query for this surface now ranks the
  defining file at live-rank 2). RE-VERIFY the evidence live before
  writing §5g: query the current
  `repo:trellis:src/rlm/trellis_agent.py` version's blocks for the
  wiring and comment bytes, confirm `stage2:check --pre` passes, and
  record the live hashes in §5g — do NOT reuse §5f's hashes. Note for
  the task text: vector_search now also surfaces DEAD near-twin
  blocks of the old chunking (the Session 38 pollution finding) — the
  v2/v3 rule "cite only named-file bytes fetched this run" already
  guards the write, and the Session 35 bridge check flags any dead
  citation as `dead_evidence_hash`.

The session splits zero-paid machinery from the owner-gated run
exactly as Sessions 35–38 did: build and drill the comment-class
diff gate FIRST (harness tooling, no approval needed), then propose
the retry run with the amended task text and WAIT for owner approval
before any paid spend.

## 4. Required design

- **Pre-flight (zero-paid):** confirm the Session 38 PR merged
  (`git log -- HANDOFF.md`); `npm ci`; full offline gates; the
  standing drill block green (create `benchmark_logs/` and verify
  zero stale worker processes first — the §2 operational notes).
- **The comment-class diff gate (zero-paid, lands regardless of the
  run):** extend `src/benchmarks/selfedit/check.ts` with a typed
  finding (suggested `named_file_noncomment_change`) and a pure
  evaluation over a parsed unified diff: for a named file DECLARED
  comment-class (a new CLI flag, e.g. `--comment-class <file>` —
  the increment declares its class; the gate must not fire on future
  executable-class increments), every changed content line (`-` and
  `+` sides both) must be blank or a comment line for the file's
  language (`#` for `.py`; `//` for `.ts`/`.js` this edition —
  block-comment interiors are OUT of scope, recorded honestly; the
  retry targets a `.py` file). The gatherer runs read-only
  `git diff -- <named file>` under the edit root — a WIDENING of the
  harness's git surface from `status --porcelain` to `diff`, still
  read-only, recorded in the §5g design record. Pure parsing
  unit-pinned (the preserved run-2 diff
  `benchmark_logs/session37_run2_failed_diff.patch` is the reference
  shape: its removed executable line must fire the finding; a clean
  comment-only edit stays silent); a drill section in
  `test_selfedit_harness.ts` planting the EXACT run-2 shape (replace
  a comment+executable window with comment-only lines) and observing
  the finding fire through the real git binary. POST-RUN mechanical
  check only, never a write gate (guardrail 5's mold).
- **The retry proposal (owner-gated; present, then WAIT):** same
  target, same evidence contract (subject `trellis_agent`, verb
  `wires`, object `get_retrieved_addresses` — the existing recovered
  edge MERGEs additively), same spawn mechanics. Task text v3 = v2
  (the §5f.5-recorded amendments that produced run 2's PERFECT
  evidence chain) plus the run-2 lessons, run INPUT not kernel
  prompt: (1) SPLICE MINIMAL SPAN — splice exactly the lines whose
  content changes and NEVER retype unchanged lines (the run-2
  failure was a 6-line retype window for a 2-line change); (2) the
  verification predicate must assert NEIGHBOR PRESERVATION — after
  write_back, print the edited region AND assert the executable
  `"retrieved_addresses": get_retrieved_address_count(),` line and
  the `# Session 33` comment head are still present, in their own
  iteration, before any submit. Write §5g in
  `REPOSITORY_INGESTION_REPORT.md` BEFORE the run (the §5f mold:
  target evidence RE-VERIFIED LIVE against the policy-2 substrate
  per §3, failure mode, detection, estimate — the increment-1/2
  basis $0.15–$0.45/run, ≤$0.90 total — five-part criterion with the
  comment-class gate added to item 3).
- **The run (only after owner approval):** Session 26 spawn
  mechanics, research mode, `--max-iterations 12`,
  `TRELLIS_EDIT_ROOT` = the clean session worktree,
  `TRELLIS_CITATION_AUDIT=1` in the run's own env.
  Refresh-before-use: `trellis_agent.py` must be unchanged since
  `trellis#6` (it should be — if it changed, the src/rlm refresh
  runs POLICY 2 per the split-scope recipe). Post-run in order:
  `stage2:check` (scope + evidence + parse gate + the NEW
  comment-class gate) → human `git diff` review → offline gates with
  the diff applied → land in the session PR. One contingency re-run
  only after a diagnosed clean failure, within the proposed budget;
  a harness flag = FAILED, record and stop. If the retry fails
  again, STOP the ladder and put the increment-ladder judgment to
  the owner with the three failure records — do not design
  increment 3 unilaterally.
- **Post-landing refresh (the adopted §5d.6 cadence, separately
  gated, SPLIT-SCOPE per §1 item 6):** the landed edit changes
  `src/rlm/trellis_agent.py`, so the refresh for that file is the
  POLICY-2 scoped run (`--include src/rlm --chunking-policy 2`); the
  session's own harness-code changes refresh under policy 1 with the
  everything-except-src/rlm prefix list. Plan echo, approval, drain
  (fresh workers, then KILL THE CHILD TREE and verify zero
  consumers), churn verification with counts — the Session 36/37/38
  mold. Expect the standing beliefs to survive where their evidence
  blocks are in UNEDITED regions — verify, and re-derive through the
  ordinary write path if the churn cascades differently (the
  Session 38 recovery mold).
- **What does NOT change:** rows 9/10/12 machinery; the textedit
  contract; the increment-1 landed diff AND the still-stale
  `trellis_agent.py` comment (the run's task — never hand-fixed);
  chunking policy defaults (1 everywhere; policy 2 only via the
  split-scope recipe); every probe suite's question bytes; both
  composed-prompt pins.

## 5. File-level starting points

- `TRELLIS_ROADMAP.md` §5 Session 37 + 38 entries — the run
  diagnoses, the pilot verdict, and the recorded next step; §4
  rows 11/12 for the ladder and rollout state.
- `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md` §5f + §5f.5 (the
  increment-2 design record and measured-runs record — the mold and
  the evidence base for §5g).
- `docs/architecture/STRUCTURAL_CHUNKING.md` §10 (the Session 38
  measured record — the substrate state the retry stands on,
  including §10.4's split-scope refresh recipe).
- `src/benchmarks/selfedit/check.ts` + `check.test.ts` — the checker
  (typed findings list; add the comment-class finding beside
  `named_file_unparseable`).
- `src/benchmarks/selfedit/parse_gate.ts` + `parse_gate.test.ts` —
  the Session 37 parse gate (the structural mold for the new gate's
  gatherer/evaluation split).
- `scripts/stage2_selfedit_check.ts` — the CLI (post-run mode gains
  the declared-class flag + the diff gatherer; `--pre` unchanged).
- `scripts/test_selfedit_harness.ts` — the drill (section [6] is the
  parse gate; add the run-2-shape section).
- `benchmark_logs/session37_run2_failed_diff.patch` +
  `session37_task_v2.txt` (local, gitignored) — the reference escape
  shape and the task-text base.
- `src/rlm/trellis_agent.py` lines ~570–585 — the target region
  (read-only until the run).

## 6. Test strategy and acceptance

Zero-paid except the owner-gated retry run and (separately gated)
any refresh extraction.

- **Zero-paid:** the comment-class gate's unit pins land in
  `npm test` (823/85 grows); `test:selfedit-harness` grows by the
  planted run-2-shape section and stays green; the full standing
  drill block green; the §3 live evidence re-verification recorded
  in §5g; `stage2:check --pre` passes before any run (verified clean
  at Session 38 close: `trellis_agent`, `get_retrieved_addresses`,
  `_verify_hashes_retrieved`, `_retrieved_addresses` all uncontested
  with live provenance).
- **The run (owner-gated):** judged by §5g's pre-stated five-part
  criterion (the §5f.4 mold, comment-class gate included in the
  checker item).
- **The refresh (owner-gated, split-scope):** plan echo bound before
  approval; churn verified with counts post-drain.
- Run `drill:scale` ALONE (never concurrent with other live drills).

Required close-out (the standing block):

```
 npm test
 npm run build
 npm run python:check
 docker compose --profile test config --quiet
 # Run the isolated zero-LLM Compose integration (unique project name;
 # host ports 0 via TRELLIS_POSTGRES_HOST_PORT / TRELLIS_NEO4J_HTTP_HOST_PORT /
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

Update:

- `TRELLIS_ROADMAP.md`: full-dated §5 entry with exact commands,
  counts, the diff disposition, and ACTUAL dollars vs the estimate
  (run + refresh separately); row 11 stage-2 progress recorded (the
  row strikes only when the owner judges the increment ladder
  complete — record progress, do not strike unilaterally).
- `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md`: §5g (the retry
  design record, written BEFORE the run, with the LIVE re-verified
  evidence hashes) + its measured subsection after.
- `HANDOFF.md`: regenerate per §0 — including the §0 step 5
  re-check. NOTE for objective selection: if the retry lands, the
  natural next objective is the owner's increment-ladder judgment
  (present the ladder record and ask: deeper increment, pivot to the
  §2 standing menu — the row-10 (d) acceptance, the stage-1b prose
  chunk, and the row-12 rollout continuation are the largest
  standing decisions — or strike the row); if the retry fails, STOP
  and put the three-failure record to the owner. Keep the
  five-session narrative window (35–39 after this session): compress
  Session 34 into the digest and move its roadmap §5 entry verbatim
  to `docs/archive/ROADMAP_HISTORY.md`.

## 7. Guardrails

1. Never mutate an AST. The T13 hash preimage is pinned;
   `rederiveAstNodeId` stays authoritative; nothing positional is ever
   persisted as identity (tree-sitter spans included — the Session 38
   seam is ephemeral slicing, exactly like Babel spans).
2. Never merge, rename, or delete Entity nodes. Equivalence stays an
   overlay belief; module entities are contested or retired, never
   deleted. Suppression DROPS extraction candidates before they become
   entities — it never deletes existing graph nodes.
3. Preserve provenance on every semantic node and edge.
   `write_derived_insight` keeps its three-layer enforcement in fixed
   order — format (`_normalize_fact`), existence
   (`_verify_hashes_exist`), retrieval membership
   (`_verify_hashes_retrieved`, Session 31) — never replaced,
   reordered, or merged; extraction writes keep flowing through
   `mergeWithAstLivenessFence`. The Session 32 detector invariants are
   permanent: detector-not-gate; each (edge, cited-hash) pair judged
   AT MOST ONCE (`entailmentCheckedHashes` + `unsupportedHashes` are
   additive audit properties — provenance fields never mutated by a
   verdict); the typed reason `unsupported_citation`;
   judge-all-then-write atomicity (a judge infrastructure failure
   contests NOTHING).
4. Extraction spend is operator-gated, ALWAYS: policy `none` default,
   the explicit block budget, `--confirm-extraction`, and the printed
   post-exclusion bound BEFORE any spend. Any paid run is owner-gated
   propose-with-estimate under the standing ≤$5/run cap, actuals
   recorded in the roadmap. Never reward citation count anywhere —
   and never reward LOW tool-call, retrieval, or extraction counts
   either (counts and correctness are reported TOGETHER).
5. Gate machinery is kernel; operator control is absolute. The
   permanent list: the Session 25 extraction invariants (test/fixture
   patterns, denylist, both extraction prompts kernel-fixed), the
   Session 20 textedit invariants, the Session 19 authoring gates (as
   calibrated in Session 21), the Session 22 answer-channel
   invariants, the Session 24 accessor invariants (block walk
   parity-pinned; `trellis_blocks.py` stdlib-only), the Session 26
   splice semantics (refuse only "\n"), the Session 27 data-plane
   invariants (M1/M7 standing fixtures; the cap-raise doctrine;
   polars pinned never imported by src/), the Session 29 `write_back`
   hardening invariants (write-time containment re-verification, the
   resolution-change refusal, source-mode preservation, the final
   pre-replace digest re-check, the static import-allowlist /
   no-git-token pin), the Session 30 retrieval-set invariants (the
   set is ALWAYS ON — never experiment-gated, never configurable off;
   its contributing surfaces are exactly the three recorded ones; the
   accessor returns a copy; the set is never parked/serialized), the
   Session 31 write-gate invariants (the retrieval-membership check
   is the THIRD layer in the fixed order, wired ONLY by explicit
   construction at the agent — never module-global, never
   environment-gated, never default-on for bare construction — its
   refusal typed and bounded, the cited audit recording the attempt
   before the refusal), the Session 32 detector invariants
   (guardrail 3), the Session 33 retrieval-discipline invariants
   (held state holds IDENTITIES only, never content; recording and
   checking happen ONLY on discipline-enabled construction — never
   module-global, never environment-gated-on; bare construction and
   the FIRST fetch of every surface stay byte-identical; dedup
   refusals never mutate the retrieval set and held state never
   feeds, filters, or gates the Session 30/31 structures; the budget
   counts byte-returning fetches only; refusals are typed and bounded
   in the `Retrieval Discipline:` shape), the Session 34 scope
   invariants (a scoped run NEVER tombstones an out-of-scope path —
   carry-forward publishes the previous root hash verbatim; deletion
   decisions belong to runs whose scope covers the path; unset/empty
   scope is byte-identical to full scope, plan-equality pinned;
   `out_of_scope` is a typed counted skip; invalid prefixes refuse
   before I/O; doc keys stay root-relative under every scope), the
   Session 35 stage-2 harness invariants (the checker and its CLI are
   READ-ONLY everywhere — the git surface is read-only (`git status
   --porcelain` since Session 35; Session 39's comment-class gate may
   add read-only `git diff`), and the run/toolkit never touches git;
   `--pre` runs before any edit run; a harness flag FAILS the
   increment — never argued away, never re-run silently; the
   evidence contract stays "one recorded insight citing fetched
   blocks, verified through the Session 31 gate" — the checker never
   becomes a write gate itself), the Session 37 parse-gate invariants
   (post-run mechanical check ONLY, never a write gate; the Python
   parse spawns the configured interpreter and NEVER writes bytecode
   into the edit root; the TS parse is single-file diagnostics — no
   project resolution, no type check, no emit; extensions with no
   parser wired never produce a finding; the gate composes ADDITIVELY
   beside `evaluateSelfEditRun`, whose contract is unchanged — and
   every future mechanical gate in this harness follows the same
   mold), and the Session 38 structural-chunking invariants (chunking
   policy 1 is the DEFAULT everywhere — policy 2 is operator-explicit
   per run, stamped in the snapshot summary, never a default until a
   recorded owner decision; the grammar wasm pins are EXACT
   (`web-tree-sitter` 0.26.11, `@vscode/tree-sitter-wasm` 0.3.1) and
   a bump is a recorded substrate-identity event; the cAST walk's
   byte-coverage invariant is enforced in the walk AND at
   `coversSource` — a violation is a typed skip, never a partial
   tree; ERROR trees refuse as `parse_error` (the broken-file policy
   stays an unmade decision); policy-1 output NEVER contains the
   structural kinds (pinned); `EXTRACTION_INELIGIBLE_BLOCK_TYPES`
   changes are recorded owner-visible decisions; the block walks
   (`collectExtractionBlocks` / `trellis_blocks.py`) stay
   byte-identical and parity-pinned; the SPLIT-SCOPE refresh recipe
   holds until the owner widens the rollout). The Session 37
   operator-cleanup precedent is BOUNDED, permanently: deleting a
   graph edge is legitimate only for a failed acceptance-run's own
   residual write, before its contingency, with the exact Cypher and
   rationale recorded in the session's documents — never for
   extraction-produced beliefs, never for contested audit records,
   never silent. The Session 36/37/38 recovery precedent: operator
   re-derivation through the ordinary write path citing live blocks
   is the ONLY recovery route — never un-contesting in place, never
   editing provenance fields. None of these is ever weakened or made
   configurable. `TRELLIS_EXP_OMIT_CMT`, `TRELLIS_EXP_MODULES`, and
   `TRELLIS_EXP_OMIT_RETRIEVAL` stay experiment-only: off by default,
   byte-identical unset (pinned), never set by any
   default/worker/Compose config, never forwarded by `buildAgentEnv`
   — and any NEW experiment flag follows the same mold, permanently.
6. Every external interaction is bounded; new bookkeeping reports
   COUNTS, never silently vanishes work; over-budget operations raise
   with usage. Drill timings are printed telemetry, never assertions.
7. Validate at every boundary: every worker-consumed completion
   crosses `parseLlmResponse`; new job/telemetry fields are OPTIONAL
   and bounded with byte-identical legacy behavior pinned;
   `AGENT_ORACLE_ENABLED` and `TRELLIS_A2A_ENABLED` defaults stay
   pinned false.
8. Report honestly: publish counts and raw numbers; a surprising or
   null result is a finding. A scale-gate reading outside the band
   gets a re-run before it gets believed — and a REPRODUCING open
   reading is the migration trigger, escalated to the owner. The
   Session 29 TOCTOU precedent joins this rule: when a window can
   only be narrowed, DOCUMENT the residual — never claim closure the
   implementation does not deliver. Row 9's version: slice (d) closed
   T1, not T2 — never describe the retrieval-set constraint as
   "closing laundering"; the detector is a SAMPLED measure of the T2
   residual at a rate — report the rate with every claim. Row 10's
   version: dedup closes REPEAT fetches (and its full-repeat identity
   is evadable by padding — recorded, not denied); the budget bounds
   spend, it does not guarantee sufficiency. Row 11's version:
   extraction quality claims carry their counts and their spot-check
   evidence together — a big graph is not a good graph. Row 12's
   version (Session 38): a criterion miss is a FAILED pilot even when
   four of five items pass and the miss is artifact-explained —
   record the raw number, the diagnosis, AND the diagnostic number,
   then stop; the owner adjudicates. Dead-block embedding pollution
   is a recorded substrate property — never describe vector-search
   results without naming it.
9. Do not break existing consumers: the composed-prompt pins
   (`5d27e474…fe2a` default / `45987904…0b56` omit-arm since the
   July 12, 2026 prompt-engineering pass, `test:modules` [4]/[7])
   move only with a witting kernel change, both recomputed in the
   same commit; module #1's pins hold; the legacy extraction-job
   payload and the `prose` payload both process with the exact pinned
   legacy prompt bytes; `TRELLIS_RESULT`/`TRELLIS_TELEMETRY`
   semantics are additive only; the API, A2A, and SSE contracts are
   untouched; the `get_ast_texts`/`nodeText` reconstruction bytes do
   not change; the FIRST fetch of every retrieval surface returns
   byte-identical results; bare `TrellisNeo4j(...)` AND bare
   `TrellisPostgres(...)` construction keep behaving exactly as
   today; the verification worker keeps processing the existing job
   shape byte-for-byte; `parseSourceFile` WITHOUT `chunkingPolicy`
   (or with 1) stays byte-identical to Session 8 output; and the
   drills and probe scripts that fetch repeatedly today keep passing
   (their construction is bare by design).
10. Respect the rlms prompt contract: extend `RLM_SYSTEM_PROMPT`,
    never replace it; no literal curly braces in anything rlms
    formats; no rlms library modifications.
11. Follow the T16 observability house style: file paths, prompts,
    extraction text, hashes, and retrieved addresses never become
    metric label values; counts are label-bounded; entity names may
    appear in log CONTENT per the dropped-action precedent; operator
    CLIs may print hashes (the `promote` precedent).
12. Keep API and worker processes split; project-scoped Compose
    commands; drills clean up token-scoped temp state only — the four
    probe corpora (`book:gutenberg-84:frankenstein`,
    `book:synthetic:ninth-circuit-chronicle`,
    `ledger:synthetic:house-*`, and the relational
    `ledger:synthetic:s2-house-*`/`registry:synthetic:captains`/
    `tariff:synthetic:port-schedule`), the promoted research docs,
    and the repository extraction substrate (`repo:trellis:*`
    documents + their graph entities, including the policy-2
    `src/rlm` pilot state) stay durable. Never tombstone or sweep the
    stage-1/pilot residue as if it were drill state.
13. Ship one feature branch and one PR to `master`, plain engineering
    prose, no AI attribution or generated-by trailers. Regenerate this
    file in the same PR — and re-run the §0 step 5 check before
    handing off.
14. Code-mediated text is doctrine (permanent; survives every rewrite).
    Any new or modified surface where the RLM touches text must follow
    `docs/architecture/CODE_MEDIATED_TEXT.md`: locations
    engine-computed, bytes moved by code, transient frames,
    hash-guarded writes, answers submitted by reference
    (`trellis_answer`), block structure read from the engine
    (`get_ast_blocks`) — never model-estimated positions, never
    model-retyped existing bytes, never a persistent in-memory mirror
    of a store. Provenance threading is this doctrine applied to the
    write path; retrieval discipline is this doctrine applied to
    retrieval spend; structural chunking is this doctrine applied to
    the substrate's own granularity. Prompt text may reinforce the
    discipline but never substitutes for tooling shape.

## 8. Explicit exclusions

Do not include: running the retry edit run, any refresh extraction,
the row-10 (d) `est` acceptance measurement, the stage-1b prose chunk
(docs/ + root prose), the row-12 rollout continuation (widening
policy 2 beyond `src/rlm`, retuning the merge target or split
threshold, or reverting the pilot), the `search_ast_nodes` liveness
filter or any superseded-embedding sweep (owner-gated — it changes
agent-visible tool behavior and needs its own record), or ANY paid
run without explicit owner approval (the run and any refresh are THIS
objective's gated steps — ask first, wait; everything else stands
propose-with-estimate; the first entailment sweep RAN owner-approved
July 13, 2026 — a SECOND sweep or a judge-calibration change is a new
owner decision); hand-editing the increment-1 LANDED diff in
`trellis_tools.py` (measured evidence of the first landed self-edit —
style cleanups included); hand-fixing the `trellis_agent.py`
research-mode stale telemetry comment (it is the retry run's TASK —
fixing it by hand destroys the increment); deleting, contesting, or
"cleaning up" the three RECOVERED standing beliefs (`wires` /
`consumes` / `returns_copy_of` — true, live-cited,
`rederivedAt`-stamped) or any graph edge outside the bounded
operator-cleanup precedent (guardrail 5); "recovering" the contested
`main` entity or the pilot's 89/202 contested residue (standard lazy
recovery — re-derivation happens when something actually needs the
belief, never as cleanup); making the parse gate or the new
comment-class gate a write gate or wiring either anywhere except the
post-run checker path (guardrail 5's mold); firing the comment-class
gate on an increment that did not declare comment-class; letting the
edit run or the toolkit touch git in any form (the harness's own git
use stays read-only: status + diff; landing is a human-reviewed PR,
always); committing an edit-run diff without human `git diff` review
or with a non-empty `stage2:check` finding list; widening the stage-2
increment beyond its single named failure mode mid-session;
re-running any scoped snapshot OUTSIDE the gated refresh steps (a
scoped re-run without extraction budget is zero-paid but still churns
beliefs — and a policy-1 run over `src/rlm` REVERTS the pilot: the
split-scope recipe is mandatory, guardrail 5); weakening any
Session 35 harness pin, Session 37 parse-gate pin, or Session 38
structural-chunking pin, or making the checker a write gate
(guardrail 5); designing or running increment 3 (or any new ladder
step) unilaterally after a third failure — the increment-ladder
judgment belongs to the owner with the full failure record;
tombstoning or sweeping the extraction residue as if it were drill
state (guardrail 12); reworking the Session 34 scope machinery
(carry-forward semantics, the `out_of_scope` skip, the plan echo
lines ship as recorded); reworking rows 9, 10, or 12 (the write gate,
the detector, the retrieval discipline, and the chunking machinery
ship as recorded — do not change their stamps, reasons, refusal
bytes, identities, or wiring; do not wire the detector into the write
path; do not repurpose the `TRELLIS_CITATION_*` env flags); making
`chunkingPolicy` 2 a DEFAULT anywhere; bumping a pinned grammar wasm
blob casually (a grammar bump is a substrate-identity event —
recorded, owner-visible); adding grammars or languages to the engine
without an owner-scoped session; feeding, filtering, or gating the
Session 30 retrieval set or the Session 31 write gate from row-10
held state (the structures share call sites only); making
dedup/budget mutate what a FIRST fetch returns, silently serving
stale or transformed bytes on a repeat fetch, or parking/seeding
held-root state; redefining the retrieval set (its surfaces and
exclusions are recorded in `PROVENANCE_THREADING.md` §3 and pinned by
`test:rlm-sandbox` [5] — a change there is a recorded correction with
owner visibility, not a convenience edit); weakening, reordering, or
merging the three write-path layers (format → existence → retrieval
membership — fixed order, fail-fast); widening the generic-identifier
denylist or the test-fixture patterns without observed counts;
un-retiring module #2 or authoring ANY new protocol module
(deprioritized permanently; explicit owner request only); re-running
or extending the Session 28 control or ANY measured probe round
outside the recorded owner-gated proposals; running the cross-process
concurrency proof run (coverage-audit gap #1) or any proof-run depth
increment without owner approval — propose with estimates; weakening
ANY Session 29 `write_back` hardening pin, the `StaleFileError`
semantics, the splice "\n"-only refusal, or any textedit
gating/containment/hash-guard pin; claiming full TOCTOU closure (the
residual window is documented, not closed — OS locking stays out of
scope); claiming the retrieval-set constraint closes laundering (it
closed T1; T2 is the detector's SAMPLED residual — guardrail 8);
claiming dedup/budgets make retrieval optimal (they close repeats and
bound spend — guardrail 8); claiming structural chunking fixed
retrieval (the pilot's item 3 FAILED as worded — the live-only
diagnostic and the pollution finding are the honest record,
guardrail 8); ANY data-plane representation migration at ANY boundary
(the Session 27 verdict stands; re-entry only through the review's
benchmark matrix with owner sign-off); importing polars in any `src/`
path, kernel surface, or prompt; raising any
workspace/scratch/textedit cap without first re-running the M1
fixture at the target size (the cap-raise doctrine, pillar §7);
asserting on wall-clock timings in any drill; changing
`get_ast_texts`/`nodeText` block-boundary semantics (SUPERSEDED by
`get_ast_blocks`, confirmed closed by round 4); a fifth
effective-context probe round (the row-10 (d) acceptance re-run is
NOT a probe round — round numbering stays untouched); embedding any
probe corpus; weakening or toggling the §6.2 kernel block outside the
`TRELLIS_EXP_OMIT_CMT` experiment flag; setting `TRELLIS_EXP_MODULES`
or `TRELLIS_EXP_OMIT_RETRIEVAL` (or any new experiment flag) anywhere
but a probe invocation's own environment; moving the composed-prompt
pins without a witting kernel prompt change (both recomputed in the
same commit, history recorded); new MCP servers or transports; A2A
changes; frontend work (deferred unscheduled); `ASTRef`/`EVIDENCED_BY`
migration (gate CLOSED; Sessions 23–38 read 1.84x, 2.11x,
1.99x–2.01x, 1.78x, 1.99x, 1.77x-after-outlier, 1.97x, 1.89x, 2.09x,
2.04x, 1.94x, 1.53x, 1.68x, 1.63x, 1.76x, and 1.69x, inside the band
— do not migrate on a noisy reading); T13 re-hashing; rlms library
modifications; treating the checkout EOL-normalization churn class OR
the dead-block embedding pollution class as defects to "fix" in the
ingestion layer (recorded environmental/substrate behavior — the
pollution fix is the owner-gated liveness-filter candidate, not an
ingestion patch); weakening the Session 14 write-path enforcement,
the Session 15/20/22/24 composition pins, the Session 16 lineage
pins, the Session 17 promotion refusals, the Session 18 registration
gates, the Session 19 authoring-mode / anchor-gate / draft-scanner /
template pins (as calibrated in Session 21), the Session 20 textedit
gating/containment/hash-guard pins (as corrected in Session 26 and
hardened in Session 29), the Session 22 answer-channel refusals, the
Session 24 block-walk parity pin, the Session 25 extraction gates,
the Session 27 M1/M7 standing fixtures, the Session 28 module-arm
validation and est-suite truth pins, the Session 30 retrieval-set
tracking pins, the Session 31 write-gate pins, the Session 32
detector pins, the Session 33 retrieval-discipline pins
(`test:rlm-sandbox` [7] + the `buildAgentEnv` unit pins), the
Session 34 scope pins (`snapshot_ingest.test.ts` scope section +
`test:repo-ingest` Part 7), the Session 35 stage-2 harness pins
(`check.test.ts` + the `test:selfedit-harness` drill), the
Session 37 parse-gate pins (`parse_gate.test.ts` + drill section
[6]), or the Session 38 structural-chunking pins
(`generic_tree.test.ts` + `structural_chunker.test.ts` +
`treesitter_engine.test.ts` + the parity structural-kinds case + the
snapshot-stamp pins, including policy-1 byte-identity and the
policy-1-never-emits-structural-kinds pin).
