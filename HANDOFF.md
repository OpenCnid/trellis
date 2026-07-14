You are a principal systems engineer continuing development on Trellis Engine,
a Recursive Language Model runtime over a provenance-enforced knowledge
substrate — its GraphRAG-shaped storage layers survive as Tiers 1–2 of the
trust model; the system is the RLM standing on them (reframed July 9, 2026;
see the root README "What Trellis is") (repository:
https://github.com/OpenCnid/trellis, local path `D:\trellis-engine` or the
current working directory). Trellis is an original OpenCnid project, not a
fork, and is unrelated to other projects named Trellis. The repository and its
documentation are the only sources of truth.

Sessions 1–42 and their same-day follow-ons (July 4–13, 2026; PRs
#21–#85) are complete, merged, and ARCHIVED: the full dated ledger for
that span lives verbatim in `docs/archive/ROADMAP_HISTORY.md`
(Sessions 1–23 moved July 12, 2026 by owner direction; then one
session entry per PR under the five-session window rule — most
recently Session 42 with the Session 47 PR — this file keeps full
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
  `est`-suite acceptance measurement (criterion pre-stated in the
  archived §5 entry item 4) ran in Session 43 and PASSED all three
  items. Row 10 STRUCK, then CLOSED by the measurement.
- **Session 34 (PR #76)** opened Trellis-on-Trellis (row 11 stage 1,
  STRUCK): scoped snapshots (`repo:ingest --include <prefix>`,
  segment-boundary match, doc keys root-relative; out-of-scope
  previously effective paths CARRY FORWARD at their previous root
  hash — outcome `unchanged`, never tombstoned by a non-covering run;
  typed `out_of_scope` skips; invalid prefixes refuse before I/O;
  unset scope plan-equality pinned) landed zero-paid because the
  full-repo bound priced over the cap (4,575 blocks ≈ $12.35 vs the
  all-or-nothing budget gate); the owner-approved run then extracted
  the durable code substrate under repo key `trellis` (scope
  `src`+`scripts`+`modules`, snapshot `trellis#1`: 298 ingested,
  1,423/1,423 jobs zero failures in 53m42s, ≈$2.75 actual, ALL FIVE
  pre-stated criteria PASS — max hub `ast_nodes` 2.04% vs the ≤8%
  bar, zero denylist names, named kernel surfaces thread to real
  bytes; 1,995 entities / 1,788 ACTION relationships). `docs/` + root
  prose DEFERRED to their own chunked proposal (~2,900 blocks ≈
  $7.8); `data/` EXCLUDED by decision; `repo:trellis:*` joined the
  durable list. Stage-2 seams recorded, nothing implemented: the
  graph→textedit bridge is provenance hash → `document_nodes` →
  `repo:trellis:<path>` → `load`; entity names lowercase-normalized;
  freshness = the ordinary churn loop.
- **Session 35 (PR #77)** built the stage-2 self-edit HARNESS
  zero-paid: the increment design record mold
  (`REPOSITORY_INGESTION_REPORT.md` §5e, document-first), the named
  failure mode "graph-misdirected editing" with mechanical detection
  (`src/benchmarks/selfedit/check.ts` — pure, typed findings;
  `npm run stage2:check` — `--pre` gate + the post-run gatherers),
  the evidence contract "ONE recorded insight citing fetched blocks —
  the Session 31 write gate makes a successful write proof of
  consultation," the HONEST SCOPE (§5e.2: the checker proves scope
  and the evidence chain, never diff semantics — human review reads
  the transcript), and the `test:selfedit-harness` drill (scripted
  rehearsal driving the run's real tool sequence zero-LLM).
- **Session 36 (PR #78)** EXECUTED stage-2 increment 1 ($0.667
  total): run 1 FAILED at human `git diff` review (a mis-ranged
  hunk-B splice left the file syntax-broken; verify-then-submit had
  collapsed into one REPL cell — recorded, reverted, diagnosed, no
  silent retry; `stage2:check` was correctly blind: diff semantics
  belong to human review); the diagnosed contingency run 2 LANDED all
  five criterion items ($0.352 — the ONE recorded insight
  `_verify_hashes_retrieved` `consumes` `get_retrieved_addresses`
  cites the two fetched consumer blocks, a Session 31 gated write);
  the §5d.6 freshness policy's first refresh then ran (snapshot
  `trellis#2`, 24/24 jobs, $0.102) and the churn loop was observed
  live end to end: old block DEAD → stage-1 ACTION edge CONTESTED
  with audit preserved → operator re-derivation citing the new v2
  block through the ordinary write path. No machinery defect: run 1's
  failure was the run's, not the harness's.
- **Session 37 (PR #79)** ran stage-2 increment 2 to a RECORDED
  FAILURE ($0.7012 total): the parse gate landed zero-paid first
  (`named_file_unparseable` — `.py` via the configured interpreter's
  builtin `compile()` with no bytecode write, `.ts`/`.js` via
  single-file parse diagnostics; 11 unit pins + drill section [6]);
  the target (the `trellis_agent.py` stale telemetry comment) was
  selected by substrate query; run 1 FAILED on the first live
  `unbridged_evidence` firing (vector-search widening cited
  wrong-document blocks; deterministic; residual edge deleted as
  bounded operator cleanup), run 2 FAILED at human `git diff` review
  — **retype-splice neighbor deletion** (6 hand-retyped comment lines
  dropped an executable neighbor while still PARSING; every
  mechanical layer structurally blind; human review caught it exactly
  where the criterion places diff semantics). Verdict FAILED, no
  third run; run 2's insight edge (`trellis_agent` `wires`
  `get_retrieved_addresses`) stands. Also recorded: the checkout
  EOL-normalization churn class (refresh `trellis#3`) and the
  Windows orphaned-worker tell (kill the child process tree; verify
  zero node/tsx workers before any queue drill).
- **Session 38 (PR #80)** landed structural chunking increment 1
  zero-paid (roadmap §4 row 12; full record
  `docs/architecture/STRUCTURAL_CHUNKING.md` §10): the generic tree
  seam `src/core/ast/generic_tree.ts`, the pure cAST split-merge
  walk `structural_chunker.ts` (merge target 3,000 / split threshold
  4,000; byte coverage enforced twice; trivia glues forward; classes
  always containers), the wasm engine `treesitter_engine.ts`
  (`web-tree-sitter` 0.26.11 + `@vscode/tree-sitter-wasm` 0.3.1 both
  EXACT-pinned — a grammar bump is a substrate-identity event; ERROR
  trees refuse as `parse_error`); `chunkingPolicy` 2
  operator-explicit per run, policy 1 byte-identical pinned; new
  kinds `code_import`/`code_const`/`code_type`/`code_statement`
  through BOTH block walks unchanged (parity re-pinned);
  `code_import` extraction-ineligible. Shadow: monoliths 15 → 0, TS
  structureless 51.6% → 0.4%, boundary oracle 911/911. The
  owner-approved `src/rlm` pilot (snapshot `trellis#6`, $0.540)
  passed items 1/2/4/5 and FAILED item 3 AS WORDED (raw-tool seam
  queries 4/8 vs 5/8) — root-caused to dead-block embedding
  pollution (Session 40's fix), recorded and stopped, no retuning;
  the policy-2 substrate STANDS. The pilot's churn quarantined the
  three standing TRUE beliefs; all three recovered same-day through
  the ordinary write path (the third live churn-loop observation).
  Incidents recorded: the missing-`benchmark_logs/` orphaned-npm-tree
  worker trap; npm not forwarding `--include` to `chunking:shadow`.
- **Session 39 (PR #81)** ran the increment-2 RETRY to a first-shot
  LANDING ($0.504 total): the comment-class diff gate
  (`named_file_noncomment_change`, declared via `--comment-class`,
  both diff sides, read-only `git diff` gatherer, 13 unit pins +
  drill section [7]) landed zero-paid FIRST and closed run 2's
  retype-splice escape mechanically; the approved run (task v3 =
  splice-minimal-span + coded neighbor-preservation assertions,
  evidence re-verified live against the policy-2 substrate) landed
  ALL FIVE criterion items in one run ($0.347) — one hunk, comment
  lines only, executable neighbors untouched, `stage2:check` zero
  findings across all four layers, the `trellis_agent.py` stale
  comment FIXED AND LANDED. The first split-scope refresh executed
  (`trellis#7` policy 1 + `trellis#8` policy 2; 59/59 jobs; all
  three standing beliefs UNCONTESTED — the first refresh needing no
  recovery). Ladder record: increment 1 landed on contingency;
  increment 2 failed twice, each class closed mechanically, retry
  landed first shot.
- **Session 40 (PR #82)** closed dead-block embedding pollution at
  the T15 seam zero-paid (≈$0.000002 re-measure spend): the
  `search_ast_nodes` liveness filter — LIVENESS = current
  (max-version) root membership, the `gatherHashEvidence` bridge
  mirrored into SQL, EXISTS before `LIMIT`; signature unchanged, both
  callers zero bytes, the idempotent bootstrap carries it; superseded
  history stays queryable BY HASH everywhere else; the filtered-HNSW
  under-fill residual documented, none observed. Pins: the
  `schema.test.ts` filter pin (`npm test` 836 → 837/85) +
  `test:repo-ingest` Part 8 (planted dead twin: raw distance ranks it
  FIRST, the tool returns only the live successor) + the
  `sandbox:probe:embed` fixture consequence. Re-measure: seam queries
  through the raw tool 4/8 → 5/8 (criterion PASS; the
  `trellis_agent.py` headline miss FIXED at live rank 2; persisting
  misses NAMED, not chased). Same day the owner RATIFIED the general
  rule: superseded versions are ARCHIVE, not search space —
  default-discovery surfaces read LIVE blocks only, history solely by
  explicit address (HANDOFF guardrail 5).
- **Session 41 (PR #83)** landed structural splice addressing
  zero-paid (design record `docs/architecture/STRUCTURAL_SPLICE.md`,
  document-first; the row-11 executable-class prerequisite
  SATISFIED; the only spend the per-PR refresh, $0.0955):
  parser-free anchor guards CHOSEN — stdlib `ast` rejected
  (comment-blind), `py-tree-sitter` rejected (an allowlist widening
  buying nothing the class needs; recorded revisit trigger), an
  engine-side service rejected (no IPC; spans go stale). The guarded
  splice family ADDITIVE in `trellis_textedit` (`splice`
  byte-untouched): `replace_lines` (byte-exact removal manifest
  verified BEFORE staging; over-wide windows refused with the
  minimal window named), `insert_lines` (verified neighbor anchor;
  removes nothing by construction), `delete_lines` (explicit
  verified deletion); `AnchorMismatchError` the typed teaching
  refusal; telemetry three → five counters (`textedit_guarded_ops` /
  `textedit_raw_splices` — the executable-class criterion lever:
  guarded-only = raw_splices == 0). Honest scope pinned
  deliberately: the exact run-2 manifest shape STAGES — explicit
  reviewable declaration, NOT prevented. Pins: `test:textedit` [14]
  (129 Windows / 130 POSIX), `test:selfedit-harness` [8] (55; one
  OBSERVED live AnchorMismatchError → taught self-correction → the
  Session 31 gated write). Split-scope refresh `trellis#9`/`#10`;
  all three standing beliefs UNCONTESTED. The delegated ladder
  decision recorded: row 11 stays OPEN; increment 3 = guarded-only
  criterion, a NEW proposal when a REAL target surfaces — never
  manufactured.
- **Session 42 (PR #85)** ran in a policy-restricted remote Linux
  container and recorded the row-10 acceptance measurement as
  ENVIRONMENTALLY BLOCKED ($0.0000): the container's egress policy
  denied `api.openai.com` (CONNECT 403) and carried no
  `OPENAI_API_KEY` — owner approval was given up front and was never
  the blocker. What it proved zero-paid: the measurement is NOT
  dev-DB-bound (a fresh Compose stack staged all four durable est
  corpora, 144 documents, invariants green; a placeholder-key probe
  traversed the ENTIRE path and failed exactly at the OpenAI call);
  the ON/OFF arm mechanics re-verified in code; the runner's spend
  gate observed live. Two drill-defect classes found and fixed
  (the event-loop rule): hardcoded `'python'` + a hardcoded Windows
  `PYTHONPATH` at six sites in four drill/benchmark scripts (all now
  `config.python.executable` + the house `config.python.pythonPath`;
  `test:verification-sweep` — a STANDING drill — 66/66 post-fix on
  any host), and non-sha256 fixture provenance in
  `test:confidence-writes`/`test:entity-kinds` (broken since
  Session 14 on every machine; both now seed real sha256 `ast_nodes`
  rows with cleanup and pass — the write path itself untouched).
  Restricted-container bring-up notes recorded (§2); the isolated
  Compose integration could not run there (the image build's apt
  stage denied by the same egress class — recorded, not routed
  around); the four-file scoped refresh was DEFERRED and executed by
  Session 43.

- **Session 43 (PR #86)** ran the row-10 slice (d) acceptance
  measurement owner-approved on the dev machine ($1.9780 total:
  measurement $1.9619 + the deferred Session 42 refresh $0.0161),
  prerequisites verified FIRST (egress 401 probe, key present,
  corpora live): ALL THREE pre-stated criterion items PASS —
  repeat-serves 0 by construction (5 dedup refusals observed live,
  0 budget refusals), pooled median input tokens ON 8,756 ≤ OFF
  8,807 (thin, 0.6%; per-question medians mixed and recorded),
  correctness ON 25/25 ≥ OFF 24/25 — **row 10 CLOSED** (machinery
  Session 33 + this measurement). The verdict
  (`RETRIEVAL_DISCIPLINE.md` §9) claims the MECHANICAL story only:
  no token headline, no correctness claim; padding-evasion and
  budget-sufficiency residuals stand. Arm assignment was verified
  per run from telemetry in both directions (the Session 43 mold
  R3b reuses). The refresh published snapshot `trellis#11`
  (policy 1: 7 ingested / 0 tombstones / 12 carried forward; all
  three standing beliefs uncontested — the third consecutive clean
  refresh; no policy-2 leg, `src/rlm` unchanged since
  `trellis#10`).

- **Session 44 (PR #88)** recorded the row-11 increment-3 NO-TARGET
  FINDING (22 query families over live blocks + the graph; every
  candidate rejected with its reason — closest: the UNREACHABLE
  `_is_private_mcp_host` twin divergence, ten superfluous `export`
  keywords, a falsified CLI-truncation suspicion; no target was
  manufactured, the row stays OPEN) and ran the judge-calibration
  measurement through the UNCHANGED Session 32 detector ($0.0367:
  106 sampled / 100 judged over the OOLONG-era `q_` pool — 12
  supported / 88 flagged / 83 edges contested as lazy-recovery
  residue; class split `has_category` 98.6% flagged vs `mentions`
  57.7%; the judge is CONSISTENT; the decision data delivered,
  remaining unchecked pool 356 pairs). The honesty incident
  recorded in §10.2: a plausible `process.exit(0)` truncation
  diagnosis was FALSIFIED (3 + 356 = exactly 359; the loss was the
  session's own `tee | head` capture — never measure a long-output
  CLI through `tee | head`).

- **Session 45 (PR #89) + its same-day follow-ons** OPENED the TTT
  research track (row 13) docs-only, $0.0000:
  `docs/architecture/TEST_TIME_TRAINING.md` decomposed the relayed
  collaborator claim into H1 context adaptation / H2 meta-prompt
  adaptation / H3 the sparse-model vehicle, mapped the July-2026
  literature into three mechanism families, and adopted two
  calibrating findings verbatim (agentic-TTT gains are
  STABILITY-shaped at ~1.9x serving cost; TTT perplexity wins often
  fail behaviorally - criteria are task-behavior counts, never loss
  curves); named the seams against the code (`backend_kwargs`
  hardcoded at both `trellis_agent.py` construction sites; the
  `vector(1536)` embedder-schema coupling as a substrate-identity
  boundary; the composed-prompt pins as the natural prefix
  fast-state cache key); recorded the trust-model verdict (fast
  weights = Tier-3 analog, zero provenance standing, per-run
  ephemeral ABSOLUTE; every gate engine-side and model-agnostic;
  checkpoints exact-pinned substrate-identity objects; three named
  threats) and the owner-gated ladder R1-R5. Same day: R1 RETURNED -
  the collaborator selected LaCT (arXiv:2505.23884; open-weights
  retrofit with fast-weight layers = a collaborator-side TRAINING
  job), the reliance claim decomposed C1 SUPPORTED / C2 EXTRAPOLATED
  (the load-bearing gap R3/R4 measure) / C3 UNTESTED; the owner
  framed the undertaking as a PRIVATE REPRO STUDY WITH EXPANSION and
  RATIFIED the chunking (record SS12.6): Phase 0 human-authored
  R2a/R2b -> Phase 1 the Trellis-authored FEATURE-CLASS T-series
  (T1-T4; distinct from defect-class increment 3, whose
  never-manufacture rule is untouched) -> Phase 2 R3/R4 -> Phase 3
  R5; question 4 sharpened to "eligibility boundary = the run's
  retrieval set?". Honest scope: TTT impossible on the current API
  backend; H2 has no direct literature support.

**Session 46 (July 13, 2026, PR #90) is complete: TTT-track rung
R2a — the backend-seam census + the rlms verdict — delivered
docs-only, zero-paid, READ-ONLY (roadmap §4 row 13, Phase 0 step 1;
the full deliverable is `TEST_TIME_TRAINING.md` §13). Zero code
bytes, zero prompt bytes (both composed-prompt pins unmoved), zero
config changes, zero rlms bytes; no refresh owed.** **(1) The
judge-calibration decision, presented at session START (the duty
that had carried two sessions): the owner picked ACCEPT the strict
judge.** No action — the benchmark-era `q_` pool contests at high
rates as sampling reaches it, lazy recovery handles it, the strict
verdict is honest (`has_category` labels are derived, never entailed
by block text). A rubric change stays available as its own designed
session if derived-classification claims ever become load-bearing.
The decision duty is CLOSED. **(2) The census (§13.2):** every
`chat.completions.create` (11) and `embeddings.create` (5) site
disposed into six classes — the root RLM seam (the two
`trellis_agent.py` `backend_kwargs` sites at lines 329/532 = T3's
exact scope, the experimental checker client, two FROZEN probe
instruments); worker/engine completions where the model id is
ALREADY config-shaped through ONE seam (`EXTRACTION_MODEL`,
`src/config/index.ts:109` → `config.llm.extractionModel`, ten
consumers — a worker-side model change is an env-var change today)
and only the transport is assumed (seven zero-arg `new OpenAI()`
constructions); the embedder (NON-GOAL — three production
`text-embedding-3-small` literals, schema-coupled `vector(1536)`);
pricing constants (`PRICE_PER_M_INPUT 2.5`/`PRICE_PER_M_OUTPUT 10`
in `oolong/scoring.ts` + `AUTHOR_EST_PRICE_PER_1K_USD 0.02` —
estimate-only by design, unit-pinned); token accounting (moves
cleanly; ONE recorded asymmetry — house `chatUsage` tolerates
missing `usage`, rlms `_track_cost` THROWS on it); report stamps
(gate nothing). **(3) The rlms verdict (§13.1): YES — rlms==0.1.3
admits a base-URL/backend override WITHOUT library modification.**
`RLM(backend=...)` selectable (default "openai"); `get_client`
routes eight backends including an explicit `vllm` arm (the OpenAI
client + asserted mandatory `base_url`);
`OpenAIClient.__init__(api_key, model_name, base_url, ...)` takes
`base_url` first-class into `openai.OpenAI(**client_kwargs)`
("Works with vLLM as well"); `other_backends` gives depth-1
sub-call separability. The seam = additive kwargs at the two
construction sites. Caveats recorded: the endpoint MUST return
`usage` on completions or rlms raises (R3a smoke asserts this
FIRST); token/context lookups are compaction-only with safe
fallbacks; local endpoints want an explicit dummy `api_key`; rlms
runs `load_dotenv()` at import — an unmanaged credential input
channel handed to R2b. **(4) The one real discovery (§13.3): the
unmanaged `OPENAI_BASE_URL` pass-through.** Both installed SDKs
(Node `openai@^6.45.0`, Python `openai==2.44.0`) resolve their base
URL from ambient `OPENAI_BASE_URL` when unset (verified in both SDK
sources) — the transport is ALREADY overridable today, but
UNMANAGED: no validation, no typed refusal, no telemetry, no pin,
and `buildAgentEnv` neither deliberately forwards nor strips it. An
inherited value would redirect root completions, the checker, AND
the `vector_search` embedder TOGETHER — the exact coupling the
record's §4.2 forbids. NOT a defect (nothing sets it, nothing
broke; the event-loop rule was checked: no queue jump) — it is the
precise gap T1/T2/T3 close, with the census recommendation to R2b:
strip `OPENAI_BASE_URL` unconditionally and express backend choice
only through validated config. **(5) Close-out (docs-only mold):**
`npm test` 837/85 green first try after `npm ci`; live drills NOT
re-run (zero non-markdown bytes — the Session 45 precedent, reason
recorded); Session 41 compressed to the digest, its §5 entry moved
verbatim to the archive (window now 42–46).

**Session 47 (July 13, 2026, PR #91) is complete: TTT-track rung
R2b — the HUMAN-authored model-backend seam design record —
delivered docs-only, zero-paid (roadmap §4 row 13, Phase 0 step 2;
the deliverable is `docs/architecture/MODEL_BACKEND_SEAM.md`, its
own file by recorded choice — it is quoted verbatim by four
T-increment task texts and one R3 proposal, so it gets one stable
address). Zero code bytes, zero prompt bytes (both composed-prompt
pins unmoved), zero config keys, zero env twins, zero rlms bytes;
no refresh owed; NO census correction needed (§13 stands as
recorded).** **(1) The three-way split, decided per lane (record
§2):** the root RLM completion moves via the T-series; the worker
TRANSPORT is DEFERRED with its prerequisite named — the worker
completion client and the embedding client are today ONE
`new OpenAI()` construction (`extraction_worker.ts:26` serves both
call classes), so any future worker-transport override must first
SPLIT the two clients or it moves the embedder as a side effect,
the forbidden §4.2 coupling (until that split exists, the T1
ambient guard makes the coupling structurally unreachable, not just
unmanaged); the embedder does not move; the worker MODEL id needs
nothing (already config-shaped via `EXTRACTION_MODEL`). **(2) The
T1 config strawman (record §3):** four optional keys —
`TRELLIS_RLM_BACKEND` (`z.enum(['openai','vllm'])`; only the two
arms the track needs, widening is a later recorded decision),
`TRELLIS_RLM_MODEL` (the kernel default literal STAYS in
`trellis_agent.py` Python-side, the `RETRIEVAL_BUDGET_DEFAULT` mold
— unset is byte-identical trivially), `TRELLIS_RLM_BASE_URL`
(`z.url()` + http/https refinement), `TRELLIS_RLM_API_KEY_ENV`
(name-indirection, the `mcpCredentialEnv` mold, resolved
fail-fast); three cross-field refusals (vllm requires base URL;
key-env requires base URL; the named variable must resolve
non-empty); the credential three-part rule (§3.3: default endpoint
= no `api_key` kwarg, ambient `OPENAI_API_KEY` inheritance
unchanged by design; custom endpoint without a named key = the
explicit literal dummy `api_key="trellis-local"`; custom with a
real key = named-env value forwarded under its own name, never
logged). **(3) The ambient-transport disposition (record §4) — the
census §13.3 recommendation ADOPTED, three layers:** T1 refuses
ambient `OPENAI_BASE_URL` fail-fast at config load with a typed
message naming the validated keys; T2 deletes it unconditionally in
`buildAgentEnv` (the `TRELLIS_EXP_*` deletion-block mold); T3
deletes it from the agent's own environment before construction
unless a validated base URL was configured — which also closes the
rlms `load_dotenv()` re-introduction channel for this variable
(import-time dotenv runs before `main()`; construction happens
inside `main()`; the delete wins). Recorded residual: the dotenv
channel stays open for OTHER variables (`OPENAI_API_KEY` is
wanted); managing it wholesale would mean modifying rlms
(guardrail 10) — named, bounded, not denied. **(4) The checker
decision (record §5): FOLLOWS the seam (T3 scope)** — it already
shares the root's ambient transport by construction; freezing it
would take NEW code and recreate the §13.3 split inside one
process; it is off by default, and a cross-backend run that enables
it records the checker's backend with the run. The frozen
instruments (probe scripts, archived experiment scripts) stay
frozen. **(5) Refusals and telemetry (record §6–§7):** every
backend-config check is construction-time — no in-run refusal
surface exists; the Python twin `parse_rlm_backend()` raises in the
`parse_retrieval_budget` message mold before any paid work.
Telemetry: two additive `TRELLIS_TELEMETRY` fields (`rlm_backend`
enum echo, `rlm_base_url_set` boolean — the URL itself NEVER, T16);
`model_usage` already keys by model name; no Prometheus change.
**(6) The T-increment skeletons (record §8), all four pre-stated**
with scope, named files, task-text skeleton, and the full
feature-class criterion: T1 `src/config/index.ts` + NEW
`src/config/rlm_backend.test.ts` (no call-site change); T2
`src/workers/rlm_job.ts` + `rlm_job.test.ts`; T3
`src/rlm/trellis_agent.py` only (unset-arm construction-kwargs
byte-identity pinned); T4 NEW `scripts/fixture_openai_server.py` +
`scripts/test_backend_seam.ts` + the `package.json` entry (the stub
MUST return `usage` and gains a no-usage misbehaving mode). Task
texts carry spec sections VERBATIM (the record lives in `docs/`,
outside extraction scope); refresh-before-use per increment under
the split-scope recipe. **(7) The R3 skeleton (record §9):** R3a
serving bring-up + protocol smoke (FIRST assertion: the endpoint
returns `usage` on non-streaming completions); R3b the paired
est-suite + protocol-adherence baseline against a same-day gpt-5.4
arm, arm assignment verified per run from telemetry both directions
(the Session 43 mold — the `rlm_backend` echo exists for exactly
this); estimate class = GPU-hours under an owner-set per-run
compute budget, or hosted per-token under the ≤$5/run cap.
**(8) Close-out (docs-only mold):** `npm test` 837/85 green first
try after `npm ci`; build, python:check, compose config green; live
drills NOT re-run (zero non-markdown bytes — the Session 45/46
precedent, reason recorded); Session 42 compressed to the digest,
its §5 entry moved verbatim to the archive (window now 43–47; the
archive-pointer paragraph updated in the same commit).

**Session 48 (July 13, 2026, PR #92) ran TTT-track increment T1 —
the first feature-class self-edit — owner-approved through the
stage-2 harness, and the increment FAILED on the pre-stated
criterion; the verdict is recorded in full and the final tree ships
ZERO code bytes (the failed diff reverted, the pre-staged stub
removed; no prompt byte; both composed-prompt pins unmoved; no
refresh owed). Session paid total $2.1063 against the ≤$1.80
approved envelope — the overrun is itself a recorded criterion
failure — under the standing ≤$5 cap. The increment record is
`REPOSITORY_INGESTION_REPORT.md` §5h.** **(1) Zero-paid staging,
all green before the proposal:** the §5h record document-first;
`stage2:check --pre` PASS on `resolvemcpcredentialenv` +
`mcpcredentialenv` (the contested attached edges on `config` and
`trellis_retrieval_budget_per_run` — both churn residue — are
recorded in §5h.3 with the reasoning for not pre-gating on them);
the split-scope policy-1 dry-run echo read 0 to ingest / 301
unchanged / 0 tombstones; `test:selfedit-harness` green; two
staging discoveries recorded — the editing toolkit CANNOT create
files (`load` refuses non-files; resolved by a four-line pre-staged
stub header the run anchors on, §5h.2, with the vitest-red-window
consequence) and a `.test.ts` with no tests fails vitest (the stub
lands only with an approved run and leaves with a failed one).
**(2) Run 1 ($0.8760; 290,167 in / 15,060 out; 0 write_backs, 0 raw
splices): clean SELF-REFUSAL.** Its own step-6 verification
assembled multi-line expectations without line terminators, three
assertions read false while the printed regions showed spec-correct
staged content, and the run reverted staging and reported per the
contradiction rule. Two live `AnchorMismatchError` refusals caught
address-shift inserts (the Session 41 teaching loop). Diagnosis +
task v2 (line-LIST assertions; the re-locate rule; the
fix-the-assertion-not-the-edit step) recorded in §5h.7 before the
contingency spawned. **(3) Run 2 ($1.2303; 402,781 in / 22,332 out;
2 write_backs, 0 raw splices): content-correct diff, evidence
contract FAILED.** The insert-only 220-insertion diff across
exactly the two named files was spec-conformant (diagnostic
`npm test` with it applied: 846/86 all green) — but a dedup refusal
(correct behavior) killed the evidence cell BEFORE its two
`vector_search` calls executed, the run never re-ran them, no
`index.ts` block entered the retrieval set, and at insight time the
run cited the one retrieved address (a `mcp_servers.ts`
implementation block) instead of stopping. `stage2:check` flagged
`unbridged_evidence` — the second live firing ever. The Session 31
gate correctly permitted the write; the bridge check correctly
caught it; frames confer no citability. **(4) Verdict FAILED (flag
+ spend breach), no third run (the §5f.5 precedent); cleanup
recorded:** the residual insight edge deleted under the bounded
operator-cleanup precedent (Cypher + before/after counts in §5h.8);
tree reverted; stub removed; `npm test` back to 837/85. Run logs
and the preserved diff in `benchmark_logs/` (local, gitignored).
**(5) Retry lessons (§5h.8, the v3 task material):** route the
citable chain graph-first through `config` `-uses_config_key-`
`trellis_retrieval_budget_per_run` (its provenance IS the
`index.ts` block `fc17205c…6311`; the `--pre` tension with
`config`'s unrelated contested edge is an open design point for the
retry proposal); an explicit STOP rule when no retrieval-set
address has bytes verbatim in the named file; ONE retrieval-surface
call per REPL cell during evidence gathering (a typed refusal kills
the whole cell); estimate re-based to $0.9–$1.3 per two-file
authoring run. NO machinery change anywhere: every layer fired per
contract — the failure class is task discipline, closed in task
text. **(6) Bookkeeping:** Session 43 compressed to the digest, its
§5 entry moved verbatim to the archive (window now 44–48); row 13's
cell gains the T1 outcome. **(7) Same-day addendum (owner-directed,
§0 step 5): task text v3 is DRAFTED and staged in §5h.9** — authored
under the house prompt-engineering + hypershot protocols (semantic
tags; the two decisive rules in attention zones at head AND tail;
hypershot frames, no contaminating filler; invariant tokens — tool
names, entity names, spec bounds, the exact guard message — stay
concrete by the invariance test). The §5h.8 `--pre` design point is
RESOLVED (clean pre-gate entities kept; the task filters
uncontested edges in-query; the `uses_config_key` chain re-verified
live). The escalation rule is recorded: recurrence of the evidence
class closes by TOOLING SHAPE (a harness-side read-only citability
query), owner-gated, never a write gate. Session 49 presents the
staged proposal; the run is still the owner's per-run decision.

**Session 49 (July 13, 2026, PR #93) presented the §5h.9 retry,
got the owner's approval, and was ENVIRONMENTALLY BLOCKED at the
spawn — $0.0000 spent; the proposal STANDS UNCONSUMED (the full
record is `REPOSITORY_INGESTION_REPORT.md` §5h.10; the shipped
tree is docs-only; the branch history carries the stub add/remove
pair, net zero, the Session 48 pattern).** **(1) Every staged
premise re-verified live first (zero-paid, read-only, ALL HELD):**
the `trellis_retrieval_budget_per_run` `-uses_config_key-`
`config` edge uncontested citing `fc17205c…6311` (the contested
`reads_config` churn residue present exactly as §5h.3 records);
the block's 3,961 bytes verbatim in `src/config/index.ts` by raw
byte-substring check, carrying BOTH molds; `stage2:check --pre`
PASS zero findings on the two clean entities;
`test:selfedit-harness` ALL CHECKS PASSED; the split-scope
policy-1 `--dry-run` echo 0 to ingest / 301 unchanged / 0
tombstones (no drift, no refresh owed); `npm test` 837/85 after
`npm ci`. **(2) Spawn 1: a pre-API crash, $0** — the rlms verbose
logger prints a rich header panel (U+25C6 glyphs); with stdout
redirected to a file the Python stream encoder was cp1252 and the
process died on `UnicodeEncodeError` inside the `RLM(...)`
constructor, zero iterations, zero tool calls. Driver requirement
recorded: set `PYTHONUTF8=1` for any Windows spawn with redirected
stdout. **(3) Spawn 1b (with `PYTHONUTF8=1`):
`429 insufficient_quota`, $0** — the OpenAI account behind the
ambient `OPENAI_API_KEY` has EXHAUSTED its billing quota. The
decisive probe: `models.list` succeeds (the key authenticates)
while a minimal completion refuses with the same code —
authentication proves nothing about quota; rejected requests do
not bill. **(4) Verdict: ENVIRONMENTALLY BLOCKED, not a failed
run** (the Session 42 precedent — approval was never the blocker).
Task v3 is UNCONSUMED; T1 still stands at ONE failed attempt
(Session 48); the §5g.3 three-failure ladder is untouched.
**(5) Cleanup + close-out:** the stub (committed post-approval,
porcelain clean at spawn) removed in a recorded commit on
confirmation; `npm test` 837/85 at every shipped state; docs-only
close-out mold (build, python:check, compose config green; live
drills beyond the two run this session not re-run, reason
recorded). **(6) Bookkeeping:** Session 44 compressed to the
digest, its §5 entry moved verbatim to the archive (window now
45–49).

**Session 50 (July 13, 2026, this PR) is complete, BOTH parts: the
RLM harness scaffolds LANDED (Part A, zero-paid) and TTT-track
increment T1 LANDED first-shot on the retry (Part B, $0.5781 —
roadmap §4 row 13, Phase 1 step 1 COMPLETE; the run record is
`REPOSITORY_INGESTION_REPORT.md` §5h.11). Session paid total
$0.5782 (the quota probe ≈$0.0001 + the run) + the per-PR refresh
$0.2701 actual, all far under the ≤$5 cap.** **(1) Part A (the
S1+S2a+S3 increment implementing `RLM_HARNESS_SCAFFOLDING.md`,
human-authored):** the NEW stdlib-only pure module
`src/rlm/trellis_scaffold.py` — `wrap_task_text` (per-run uuid
tags), `TrellisTask` (`.text()` verbatim plain string,
`.grep(pattern)` bounded engine-side regex returning JSON, `.uuid`),
`parse_task_named_files` (the `TRELLIS_TASK_NAMED_FILES` driver
input, fail-fast, `[]` ≡ unset), and the gated factory
`build_scaffold_helpers` — frame helpers (`frame_text` /
`region_lines` / `region_equal` / `concat_files`, reading held
frames through the toolkit's own accessor under its lock) inject
ONLY beside an injected toolkit; `citable()` (retrieved-this-run ∧
bridges-to-a-named-file; the `gatherHashEvidence` MAX(version)
membership join mirrored in SQL) injects ONLY when the driver
passed named files. Recorded return-type convention: helpers return
PYTHON VALUES (outputs feed code); `grep` returns a JSON string.
`trellis_agent.py` research mode: one uuid per run, the task
wrapped at BOTH injection points, `trellis_task` kernel surface,
helpers through the factory, two conditional addenda (empty when
gated off — byte-identical prompt pinned). The always-on addendum
gained TOOLS item 4 + TASK PRECEDENCE, the UPSUM discipline, and
the decisive-step re-read workflow rule — a WITTING composed-prompt
change (pins recomputed), then RE-AUTHORED same-day under the
`prompt-engineering` + `hypershot-protocol` skills (Guardrail 15;
positive-led framing, the stable "RE-READ BEFORE YOU ACT" label,
the UPSUM keys as a per-meaning sub-bullet list — brace-free, the
addendum cannot carry hypershot braces). Current pins: default
`e57e7a55…24bd`, omit-arm `a37d2b4a…764e` (T1 ran on the prior
`6b8d41e8` bytes; both recomputes are in the same PR, histories
appended). `buildAgentEnv` deletes `TRELLIS_TASK_NAMED_FILES`
unconditionally (the experiment-flag mold) + unit pin. Author mode
untouched (recorded scope decision). S2b (rlms compaction) NOT
enabled — deferred exactly as the record states. Pins: NEW
`src/rlm/trellis_scaffold.test.ts` (28 tests over one spawned
stdlib-only python battery, `scripts/test_scaffold_unit.py`);
`test:rlm-sandbox` [8] (95 → 118: live citable classifications,
probe-is-bookkeeping-inert, NEVER-A-GATE observed live — the probe
describes an uncitable hash and the Session 31 gate still refuses
it, plus the static seam pins); `test:selfedit-harness` [9] (the
guarded arm drives `trellis_task.grep` + `region_equal` +
`citable()`; the citable report MIRROR-PINNED against the
TypeScript `gatherHashEvidence` on the same fixture — live, dead,
off-document, ghost all agree); `python:check` covers the module.
**(2) Part B pre-flight:** the minimal completion probe FIRST —
quota RESTORED (12 in / 4 out; `models.list` was not trusted, per
§5h.10); staged premises re-verified live read-only, ALL HELD (the
`uses_config_key` edge uncontested citing `fc17205c…6311`; 3,959
chars = 3,961 utf-8 bytes verbatim on disk, both molds;
`stage2:check --pre` PASS; harness green); the dry-run echo read
8 to ingest / 294 unchanged / 0 tombstones — drift EXACTLY the
session's own Part-A files, none in the evidence chain or named
files (refresh deferred to the single post-landing run, reasoning
recorded). Task v3 → v3.1 (recorded verbatim in §5h.11; six
deltas: hard-rule re-reads via `trellis_task.grep`, the
`<state_protocol>` upsum block, `frame_text` + the `citable()`
cross-check in evidence step 3, `region_equal`/`region_lines`
assertion discipline, the final `citable()` re-check at step 11,
the driver's named-files + `PYTHONUTF8=1` env); everything else
verbatim from v3; the owner's session-start approval covered the
re-presented proposal (ONE run, $0.9–$1.3). Stub re-created
(§5h.2 bytes) and committed post-approval; porcelain clean at
spawn. **(3) The run — ALL SEVEN criterion items PASS ($0.5781;
192,978 in / 9,561 out; 11/16 iterations, 66.4s; 0 dedup refusals;
4 guarded ops / 0 raw splices; insert-only 173-insertion diff over
exactly the two named files):** scope PASS; the ONE gated insight
`config` `-resolves_fail_fast->` `mcpcredentialenv` citing exactly
[`fc17205c…6311`] PASS (`citedButUnread` empty); `stage2:check`
ZERO findings PASS (the FIRST zero-findings T1 run); guarded-only
PASS; the run's nine pin groups green — `npm test` 866/86 → 875/87,
zero existing tests changed — PASS; human diff review ACCEPTED with
two COSMETIC notes recorded in §5h.11 (the Part-2 guard block sits
between the editRoot comment tail and its `const` — spec placement
satisfied, task anchor guidance not followed literally; one stray
blank line in the config object; the landed diff stays as written,
the no-hand-edit precedent); spend PASS (under estimate). Scaffolds
observed live: `upsum` maintained every iteration, one
`AnchorMismatchError` → taught re-locate recovery, the `citable()`
probe driving the citation choice, the completion-protocol re-read
through `trellis_task.grep`. The Session 48 failure classes did NOT
recur. HONEST ATTRIBUTION (§5h.11): one landing cannot separate the
scaffolds' contribution from the v3.1 prose — never claim the
scaffolds "fixed" the class. **The `TRELLIS_RLM_*` config surface +
the ambient `OPENAI_BASE_URL` guard are LIVE in
`src/config/index.ts` with ZERO consumers (T2/T3 wire them).**
**(4) The per-PR refresh (BOTH legs — src/rlm changed):** policy-1
published `trellis#12` (10 ingested / 305 unchanged / 0 tombstones;
7 blocks queued of the 16 printed bound) and policy-2 src/rlm
published `trellis#13` (4 ingested / 313 unchanged / 0 tombstones;
26 queued of 32 eligible); extraction actuals 27,073 in / 20,209
out ≈ $0.2701. Post-refresh churn EXACTLY as pre-recorded: the
three standing beliefs UNCONTESTED; the fresh T1 insight edge
CONTESTED (the index.ts re-chunk killed its cited block) — ordinary
lazy recovery, never cleaned up. **(5) Close-out:** the FULL
standing drill block green (all 18 drills; sandbox 118, harness
with [9]); `drill:scale` ALONE 1.90x CLOSED in-band (max 286;
`scale_drill_results.json` committed); the isolated Compose
integration in the CI mold (project `trellis_s50_ci`); `npm test`
875/87, build, python:check, compose config green.
**(6) Bookkeeping:** Session 45 compressed to the digest; its §5
entries (session + the same-day R1-exchange and ratification
entries, all PR #89 records) moved verbatim to the archive (window
now 46–50); the roadmap row-13 cell and §5 entry updated; task
texts and records §5h.11 in the increment record.

OpenCnid selected the MIT License on July 6, 2026.

Your objective is **Session 51: TTT-track increment T2 — the
`buildAgentEnv` forward/strip increment (roadmap §4 row 13, Phase 1
step 2; the RATIFIED queue's next step after T1 landed in
Session 50). The spec is UNCHANGED and human-authored:
`docs/architecture/MODEL_BACKEND_SEAM.md` §3.3 (the credential
three-part rule) + §4 layer 2 (the unconditional `OPENAI_BASE_URL`
delete) + the §8 T2 skeleton. Like T1, T2 is a FEATURE-CLASS
self-edit increment (record §12.6): the task text is authored by the
session under the house prompt-engineering + hypershot protocols
(the v3.1 lineage — route the disciplines through the Session 50
scaffolds: `trellis_task.grep` re-reads, the `upsum` state
protocol, `frame_text`/`region_equal` verification, `citable()`
before the insight write, `TRELLIS_TASK_NAMED_FILES` set by the
driver), presented with an estimate at session START, run ONLY on
the owner's yes, one diff human-reviewed, landing a human PR.**
Scope (the §8 T2 skeleton, exactly): `src/workers/rlm_job.ts` —
`AgentEnvConfig` gains the optional `rlmBackend` block;
`buildAgentEnv` set-or-delete for each `TRELLIS_RLM_*` variable
(the `TRELLIS_MCP_SERVERS` discipline); the unconditional
`delete env.OPENAI_BASE_URL` joining the experiment-flag deletion
block; the named key variable forwarded explicitly under its own
name (the `mcpCredentialEnv` loop precedent) — and
`src/workers/rlm_job.test.ts` for the pins (set-forwards /
unset-deletes per variable; `OPENAI_BASE_URL` stripped even when
cfg sets a base URL — the child gets `TRELLIS_RLM_BASE_URL`, never
the SDK variable; key value forwarded under its own name;
absent-block byte-identity). The record leaves ONE open point for
the proposal to state: the one-line `rlm_worker.ts` wiring that
passes `config.rlmBackend` into `buildAgentEnv`'s cfg may land in
T2 or T3 — recommend T3 (keeps T2 a pure-function increment with
zero live consumers, the T1 shape). Estimate class: T1's actual was
$0.5781 for a two-file 173-insertion authoring run; T2 is a
comparable two-file shape — propose $0.5–$1.0, ONE run, no
pre-bundled contingency, under the ≤$5 cap. Evidence-chain staging
(the §5g.2/§5h.3 mold, zero-paid, BEFORE the proposal): the
substrate is FRESH for this exact file (`trellis#12` ingested
`src/workers/rlm_job.ts` v2 with Session 50's
`TRELLIS_TASK_NAMED_FILES` delete; its extraction ran July 13) —
find an uncontested graph edge whose provenance is a live
`rlm_job.ts` block carrying the deletion-block and/or
`mcpCredentialEnv`-loop molds, verify the bytes on disk, pick clean
`--pre` entities, and record the chain in the increment record
(§5i, the §5h mold) before presenting. The driver sets
`TRELLIS_TASK_NAMED_FILES=["src/workers/rlm_job.ts","src/workers/rlm_job.test.ts"]`,
`PYTHONUTF8=1`, ONE log file. The criterion is the standing
feature-class mold: the five items + guarded-only
(`textedit_raw_splices == 0`) + the parse gate + the increment's
own pins green (`npm test` grows from 875/87, zero existing tests
changed) + spend within estimate — a harness flag or failing pin
FAILS the increment (record, stop, diagnose; a retry is its own
proposal). NO OPENAI quota risk is assumed: run the minimal
completion probe FIRST anyway (the §5h.10 protocol — cheap, inside
the envelope). Part A of Session 50 needs NO follow-up (S2b rlms
compaction stays DEFERRED behind its own measured proposal — do not
enable it). If the owner instead directs the stage-1b prose chunk
(standing item, §2 menu), the row-12 rollout continuation, or a
surfaced row-11 increment-3 target, take that. The toolkit never
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
   - **The liveness filter (Session 40): `search_ast_nodes`** (the
     single schema-level SQL function BOTH the API and the Python RLM
     client call — `src/config/schema.ts`, the T15 seam) returns ONLY
     LIVE blocks: members of the CURRENT (max-version) root of at
     least one document (the `gatherHashEvidence` bridge mirrored
     into SQL, an EXISTS clause applied BEFORE `LIMIT`). Superseded
     blocks keep their embeddings — dead history stays queryable BY
     HASH through every other surface — but never occupy vector-search
     result slots. Signature unchanged; both callers byte-identical;
     the idempotent bootstrap carries the upgrade. Honest residual: a
     filtered HNSW scan can under-fill below pgvector's candidate
     truncation — none observed at dev scale; report row counts if it
     ever appears. Pinned by the `schema.test.ts` filter pin +
     `test:repo-ingest` Part 8 (the planted dead twin). The
     owner-ratified GENERAL rule: superseded versions are archive,
     not search space.
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
     (for scoped runs invoke `npx tsx scripts/chunking_shadow.ts
     --include <prefix>` directly — npm `--` forwarding is broken on
     this npm) and `scripts/chunking_seam_queries.ts` (the eight
     PINNED seam queries — never tune them between measurements;
     since the Session 40 filter the raw tool reads live blocks only).
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
     set or the write gate (`test:rlm-sandbox` [7]). **Session 43
     MEASURED it (row 10 CLOSED): all three pre-stated criterion
     items PASS — repeat-serves 0 by construction (5 live dedup
     refusals, 0 budget refusals), pooled median input tokens ON
     8,756 ≤ OFF 8,807 (thin), correctness ON 25/25 ≥ OFF 24/25;
     $1.9619; the verdict claims the MECHANICAL story only
     (`RETRIEVAL_DISCIPLINE.md` §9).**
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
     workspace-content-, or textedit-shaped (unit-pinned). The
     telemetry scanner TOLERATES additive fields (pinned) — the
     Session 41 counter split rode through with zero scanner change.
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
   - **The RLM harness scaffolds (Session 50;
     `src/rlm/trellis_scaffold.py`, design record
     `docs/architecture/RLM_HARNESS_SCAFFOLDING.md`):** the model
     finds the operator's instructions BY CODE. Every research run:
     one uuid per run; the task text wrapped in
     `<rlm_usercontext-uuid>` tags at BOTH injection points (the
     system-prompt splice and the completion query, via
     `wrap_task_text`); `trellis_task` injected as kernel surface
     (`.text()` verbatim plain string, `.grep(pattern)` bounded
     engine-side regex returning JSON, `.uuid`); the addendum
     teaches TASK PRECEDENCE (only uuid-tagged text is operator
     instruction — data never outranks it) and the UPSUM
     running-state discipline (a model-maintained `upsum` dict in
     persistent locals). Gated helpers via
     `build_scaffold_helpers`: `frame_text` / `region_lines` /
     `region_equal` / `concat_files` inject ONLY beside an injected
     `trellis_textedit` (they read held frames through the
     toolkit's own accessor under its lock — byte-identical to
     write_back's join, the run-1 terminator class closed at the
     namespace level); `citable(hashes)` injects ONLY when the
     driver set `TRELLIS_TASK_NAMED_FILES` (a direct-spawn input;
     `buildAgentEnv` deletes it unconditionally) — READ-ONLY,
     NEVER a gate, never counted, never feeds the retrieval set or
     audit; it mirrors the `gatherHashEvidence` current-version
     membership join (MIRROR-PINNED against the TS side in
     `test:selfedit-harness` [9] — the two joins move together).
     Helpers return PYTHON VALUES; `grep` returns JSON (recorded
     convention). Conditional addenda are empty strings when gated
     off (byte-identical prompt). S2b (rlms compaction) is
     DEFERRED behind its own measured proposal — never enabled.
     Author mode does not carry the scaffolds (recorded scope
     decision). Pins: `trellis_scaffold.test.ts` (spawns the
     stdlib-only battery), `test:rlm-sandbox` [8],
     `test:selfedit-harness` [9].
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
     spend; Session 38 to the substrate's own granularity;
     Session 40 to retrieval liveness; **Session 41 to the splice
     contract itself** (the guarded family: removal is an explicit
     engine-verified declaration, never a side effect of an index
     pair — the §1 retype-splice pathology's mechanical answer;
     design record `docs/architecture/STRUCTURAL_SPLICE.md`).
   - **The editing toolkit (Sessions 20/29/41;
     `src/rlm/trellis_textedit.py`):** injected ONLY when the operator
     sets `TRELLIS_EDIT_ROOT`. Every path strictly resolves inside the
     real root. `load` holds a frame + load-time sha256; `locate`
     returns engine-computed 0-based half-open addresses; `splice`
     stages replacements (lists of strings free of "\n" — a "\r" is an
     ordinary byte WITHIN a line); **the guarded family (Session 41):
     `replace_lines` (byte-exact expected_lines manifest verified
     before staging; over-wide windows refused with the minimal window
     named), `insert_lines` (at least one verified neighbor anchor;
     removes nothing by construction), `delete_lines` (explicit
     verified deletion) — `AnchorMismatchError` is the typed teaching
     refusal; ADDITIVE beside `splice`, same staging/budget/write_back
     machinery;** `write_back` re-hashes disk bytes and RAISES
     `StaleFileError` on mismatch, else temp + rename (Session 29
     hardening inside the contract; TOCTOU residual documented, not
     denied). Telemetry counts only — five counters since Session 41
     (`textedit_guarded_ops`/`textedit_raw_splices` join the three);
     toolkit ops never satisfy the provenance protocol. The toolkit
     never touches git.
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
   - **The TTT research track (Sessions 45–49;
     `docs/architecture/TEST_TIME_TRAINING.md` +
     `docs/architecture/MODEL_BACKEND_SEAM.md`):** research + design
     only so far — no machinery, no runtime byte (Session 48's T1
     attempt FAILED and its diff was reverted; Session 49's re-spawn
     was quota-blocked pre-edit; the attempt record is
     `REPOSITORY_INGESTION_REPORT.md` §5h); the owner-gated
     rung ladder R1–R5 (roadmap §4 row 13). The seam facts a session
     needs (the R2a census, record §13, is the authoritative site
     table; the R2b design record is the buildable spec): the model
     backend is HARDCODED at the root (`backend_kwargs={"model_name":
     "gpt-5.4-2026-03-05"}` at both `trellis_agent.py` construction
     sites — T3's exact scope) but the worker-side model id is
     ALREADY config-shaped (`EXTRACTION_MODEL` →
     `config.llm.extractionModel`, ten consumers); the rlms verdict
     is ANSWERED (Session 46): rlms==0.1.3 admits a base-URL/backend
     override without library modification (`OpenAIClient` takes
     `base_url` first-class; explicit `vllm` backend; one hard
     caveat — the endpoint MUST return `usage` or `_track_cost`
     raises); the transport everywhere else is zero-arg
     `new OpenAI()`/`openai.OpenAI()`, which reads the UNMANAGED
     ambient `OPENAI_BASE_URL` (the §13.3 discovery — not a defect,
     the T1/T2/T3 gap); **the R2b seam design (Session 47,
     MODEL_BACKEND_SEAM.md) decides everything the T-series
     implements:** the `TRELLIS_RLM_*` config surface (§3), the
     three-layer ambient-variable disposition (§4: T1 config
     refusal / T2 `buildAgentEnv` delete / T3 delete-unless-
     configured), the checker FOLLOWS the seam (§5), two additive
     telemetry fields (§7), the four T-increment skeletons (§8), the
     R3 skeleton (§9); the embedding backend is SCHEMA-COUPLED
     (`vector(1536)` + HNSW) and SEPARABLE from the completion
     backend — an embedder move is a substrate-identity event and
     the embedder NEVER moves as a side effect of the completion
     backend moving (the worker-transport prerequisite: split the
     completion client from the embedding client BEFORE any worker
     override — record §2.2); fast weights, if ever present, are a
     Tier-3 analog (zero provenance standing, per-run ephemeral
     absolute) and every provenance gate is engine-side and
     model-agnostic by construction.
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
     durable, never drill-cleaned. Substrate state after Session 43:
     `src/rlm` at chunking policy 2 (snapshot `trellis#10` —
     `trellis_textedit.py` with the guarded family,
     `trellis_agent.py` with the five-key fallback dict), everything
     else policy 1 (snapshot `trellis#11`, the Session 43 refresh —
     the four Session 42 repair files at v2 + three EOL re-hashes).
     THE SPLIT-SCOPE REFRESH
     RECIPE (record §10.4; executed by Sessions 39, 41, and 43) is
     mandatory until the owner widens the rollout: policy-1 refresh
     with `--include src/core --include src/api --include
     src/workers --include src/benchmarks --include src/config
     --include src/frontend --include scripts --include modules`
     (everything EXCEPT src/rlm — carry-forward preserves the pilot),
     plus a separate `--include src/rlm --chunking-policy 2` run when
     src/rlm changed. A plain `--include src` policy-1 refresh would
     REVERT the pilot and re-buy extraction. **The stage-2 self-edit
     harness (Sessions 35/37/39):** `src/benchmarks/selfedit/check.ts`,
     `npm run stage2:check`, `test:selfedit-harness` — the checker's
     four layers are scope, evidence, parse
     (`named_file_unparseable`), comment-class
     (`named_file_noncomment_change`, fired only on `--comment-class`
     declared files). The Session 41 rehearsal guarded arm (drill
     section [8]) proves the guarded splice family composes with the
     write gate and the checker.
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

- `master`: the head after the July 13, 2026 Session 50 PR
  (Part A scaffolds + the LANDED T1 increment — the PR that carries
  this file; code surface: `src/rlm/trellis_scaffold.py` +
  `trellis_scaffold.test.ts` + `scripts/test_scaffold_unit.py` NEW,
  `trellis_agent.py` wired, `rlm_job.ts`/`rlm_job.test.ts` strip
  pin, drill/check extensions, plus the RUN-AUTHORED T1 diff:
  `src/config/index.ts` + the NEW `src/config/rlm_backend.test.ts`).
  Use `git log -- HANDOFF.md` to confirm this PR landed; if it is
  still unmerged when this session starts, STOP and merge it first.
- `modules/workspace-discipline/` is at VERSION 2 (module #1); module
  #2 (`estimation-discipline`) is RETIRED (loader refuses
  composition; the graph entity persists as history). The dev PG
  durably carries the four probe corpora, the three promoted research
  docs, and — since July 13, 2026 — **the self-substrate at snapshots
  `trellis#12`** (Session 50 policy-1 refresh, everything except
  src/rlm: the T1-landed `src/config/index.ts` + the new
  `rlm_backend.test.ts` + `rlm_job.*` + the Part-A drill files —
  10 ingested / 305 unchanged / 0 tombstones) **and `trellis#13`**
  (Session 50 policy-2 src/rlm refresh: `trellis_agent.py` with the
  scaffold wiring, the NEW `trellis_scaffold.py`,
  `trellis_scaffold.test.ts` — 4 ingested / 0 tombstones) over
  `trellis#11`/`#10`/`#9`/`#8`/`#7`/`#6`/`#5`/`#3`/`#2`/`#1`.
  Stage-1 extraction produced 1,995 entities / 1,788 ACTION
  relationships; refresh churn quarantines are standard lazy
  recovery, never "cleaned up" (Session 43's refresh contested 9
  nodes / 6 relationships — all `poison_drill_runner.ts` orphans).
  Known state by design: the THREE
  standing DERIVED_INSIGHT beliefs (`trellis_agent` `wires`
  `get_retrieved_addresses`; `_verify_hashes_retrieved` `consumes`
  `get_retrieved_addresses`; `get_retrieved_addresses`
  `returns_copy_of` `_retrieved_addresses`) all read UNCONTESTED
  after the Session 50 refresh (FOURTH consecutive clean refresh
  for them). The FOURTH derived insight — Session 50's T1 evidence
  edge `config` `resolves_fail_fast` `mcpcredentialenv` — reads
  CONTESTED exactly as pre-recorded (§5h.3/§5h.11: the `index.ts`
  re-chunk killed its cited block `fc17205c…6311`) — ordinary lazy
  recovery, NEVER "cleaned up"; re-derive through the ordinary
  write path only when something actually needs the belief. The
  `main` entity reads contested (monolith-era sources died in the
  re-chunk — data, not a defect; leave it).
  Dead-block embedding pollution is CLOSED at the T15 seam
  (Session 40); the dead embeddings REMAIN in storage (queryable by
  hash; the sweep alternative stays an owner menu item). ~650+
  documents in `documents`; the contested OOLONG-era edges now
  number 98 (15 from the July 13 first sweep + 83 from the
  Session 44 judge-calibration measurement — lazy-recovery residue,
  never "cleaned up"; the remaining unchecked `q_` pool is 356
  pairs). Roadmap
  §4 rows 5/6/6a/8/9/**10 (CLOSED — Session 43's measured verdict)**
  and row 11 STAGE 1 are STRUCK; row 11's
  executable-class prerequisite (structural splice addressing) is
  SATISFIED — increment 3 stays ARMED but has no target (the
  Session 44 search found none; it enters as a NEW proposal when a
  real one surfaces); row 12 increments 1–2 are done; row 7 stays
  trigger-blocked. Everything in this bullet
  describes the OWNER'S durable dev PG (Session 43 ran on it;
  Session 42's ephemeral container staging died with the container,
  by design).
- Session 50 moved code AND prompt bytes WITTINGLY: the
  composed-prompt pins are now default `e57e7a55…24bd` / omit-arm
  `a37d2b4a…764e` (the Session 50 scaffolding pass, then the
  same-day skills re-authoring of the addendum — Guardrail 15;
  histories in `scripts/test_modules.py` — recompute BOTH in the
  same commit only if the kernel prompt or rubric legitimately
  changes; `test:modules` green). The T1 diff is LANDED and is measured
  evidence — `src/config/index.ts` + `src/config/rlm_backend.test.ts`
  as the run authored them, two recorded cosmetic notes included
  (§5h.11); NEVER hand-edit it (the increments-1/2 precedent). The
  `TRELLIS_RLM_*` surface has ZERO consumers until T2/T3 wire it.
  Run logs `benchmark_logs/s50_t1_retry_run1.log` (+ the Session
  48/49 logs) are local, gitignored. Reminder from Session 24: `block_parity.test.ts` SPAWNS
  the real Python walk inside plain `npm test` — a machine without
  Python on PATH fails the unit suite; CI sets up Python 3.13
  before `npm test`. Reminder from Session 41 pre-flight: a
  worktree with a PRE-POPULATED but stale `node_modules` fails the
  four tree-sitter-importing test files with module-not-found — run
  `npm ci` before believing a fresh worktree's `npm test`.
  Session 42 bring-up notes for policy-restricted containers:
  `REDISMS_DISABLE_POSTINSTALL=1 npm ci` (the PoC-only
  `redis-memory-server` postinstall downloads a binary and aborts
  behind restricted egress); Python in a dedicated venv with BOTH
  requirements files PLUS `pandas` (a clean uv resolver does not
  pull pandas transitively from `unstructured==0.23.1`); Docker Hub
  blob-CDN denials are recoverable with
  `registry-mirrors: ["https://mirror.gcr.io"]`.
- Offline baseline: `npm test` = **875 passing across 87 files**
  (Session 50: 837/85 pre-session → 866/86 after Part A → 875/87
  after the landed T1 diff; the run's nine pin groups + the 28
  scaffold pins + the buildAgentEnv strip pin; zero existing tests
  changed).
- `npm run build` and `npm run python:check` pass (the check imports
  polars — an environment without it fails the check by design).
- `npm run drill:scale`: gate CLOSED at max provenance 286.
  Session 50 read 1.90x CLOSED in-band, first try; Session 44 read
  1.04x (below band) then 1.54x in-band on the guardrail-8 re-run;
  Session 43 1.64x; Session 42 (fresh Linux container DB) 1.10x
  then 1.52x; Session 41 1.39x/1.45x; Session 40 2.05x; Session 39
  2.18x; Session 38 1.69x.
  If a future run reads OPEN, re-run before believing it — a
  REPRODUCING open reading is the migration trigger (roadmap §4
  row 7) and the owner adjudicates. The drill rewrites the tracked
  `scale_drill_results.json` — commit it with the session PR (the
  committed copy is Session 50's 1.90x CLOSED run). Run the scale
  drill ALONE — never concurrently with other live drills on the
  shared dev database.
- Live zero-LLM checks: Session 50 observed ALL 18 standing drills
  green on the owner's Windows machine against the durable dev PG
  (post-refresh, one sequential chain): `test:selfedit-harness`
  (ALL CHECKS PASSED — with the NEW section [9]; the count is
  environment-shaped; runs the rehearsal python, so it needs the
  Python runtime deps), `test:answer-channel`, `test:textedit`
  (129 on Windows is the pin; 130 POSIX), `test:module-lifecycle`,
  `test:modules` (pins at their NEW Session 50 values),
  `test:promotion`, `test:rlm-workspace`, `test:rlm-mcp`,
  `test:rlm-sandbox` (**118** — with the new section [8]),
  `test:verification-sweep` (66 — it CANNOT pass on a host where
  bare `python` lacks the runtime deps),
  `test:agent-loop`, `test:a2a`, `test:repo-ingest` ("All
  checks passed" is the signal — the [PASS] count is
  environment-dependent by construction),
  `test:benchmark-hardening`, `test:entity-resolution`,
  `test:api-hardening`, `test:belief-recovery`,
  `test:invalidation-sweep`. A Session 51 that lands T2
  (non-markdown bytes) runs the FULL standing block again.
- Isolated Compose integration: 11 assertions (`--profile test`,
  unique project name; includes the containerized credentialed MCP
  fixture probe and the in-container `polars 1.34.0` import probe).
  Session 50 ran it as project `trellis_s50_ci` (all assertions
  PASS) and tore it down with `--volumes`, as Sessions 43/44 had;
  Session 42 could not (its remote
  container's egress policy denied the image build's apt stage —
  recorded, not routed around). The CI-mold invocation:
  env `COMPOSE_PROJECT_NAME` + the five host-port variables at 0 +
  an `API_KEY`, then `docker compose --profile test up --build
  --abort-on-container-exit --exit-code-from integration
  integration`, then `down --volumes --remove-orphans`. The isolation
  host-port variables are EXACTLY `TRELLIS_POSTGRES_HOST_PORT`,
  `TRELLIS_NEO4J_HTTP_HOST_PORT`, `TRELLIS_NEO4J_BOLT_HOST_PORT`,
  `TRELLIS_REDIS_HOST_PORT`, `TRELLIS_API_HOST_PORT` — set each to 0.
  NOTE: C: runs tight on free space; a FULL image rebuild needs
  several GB of headroom. `requirements.txt` and `package.json`
  unchanged in Sessions 39–50 — both layers stay cached.
- The standing owner-conditional items — all propose-with-estimate,
  never self-served: **(1) TTT-track increment T2 — THE OBJECTIVE
  (§3)** (T1 LANDED in Session 50 — record §5h.11; the RATIFIED
  queue: T2 → T3 → T4 → Phase 2, record §12.6, spec
  MODEL_BACKEND_SEAM.md §8; T2's task text is authored fresh this
  session under the prompt-engineering + hypershot protocols on the
  Session 50 scaffolds, presented with the estimate at session
  START, run ONLY on the owner's yes; the quota probe runs FIRST
  regardless — §5h.10);
  **(2) the judge-calibration decision — RESOLVED July 13, 2026: the
  owner picked ACCEPT the strict judge** (presented Session 46;
  recorded in the roadmap §5 entry; no action — the contested `q_`
  edges stay lazy-recovery residue; a rubric change re-enters only
  with new data, as its own designed session); **(3) the stage-1b
  prose chunk** (~2,900 blocks ≈ $7.8
  full bound at Session 34 pricing — re-derive with a zero-paid plan
  echo before proposing; CHUNKED owner-gated scoped runs under the
  ≤$5/run cap; the recorded partition strawman: run A =
  `docs/architecture`, run B = `docs/benchmarks` + remaining
  `docs/`, run C = root markdown; the churn question the proposal
  MUST price for the owner: `HANDOFF.md`/`TRELLIS_ROADMAP.md` are
  rewritten every session — exclude them, include-and-price the
  recurring refresh, or include only the append-mostly
  `docs/archive/ROADMAP_HISTORY.md`; prose chunks under policy 1;
  the stage-1 criterion mold adapted to prose; a landed stage-1b
  joins the policy-1 refresh leg — full §3-grade spec preserved in
  the Session 44-era HANDOFF in git history; NOTE: a landed
  stage-1b would also make MODEL_BACKEND_SEAM.md queryable from the
  substrate — a synergy for the T-series, not a prerequisite);
  **(4) the row-11
  executable-class increment 3** (prerequisite SATISFIED by
  Session 41; guarded-only criterion — `textedit_raw_splices == 0`
  joins the standing five items; the Session 44 search found NO real
  target — it re-enters as a NEW proposal only when one genuinely
  surfaces, never manufactured); (5) the pandas head-to-head probe
  round; (6) the cross-process concurrency proof run (coverage-audit
  gap #1); **(7) the substrate freshness cadence** (ADOPTED July 13:
  one scoped refresh per merged PR + refresh-before-use ahead of
  stage-2 edit runs; each refresh's extraction spend still gated per
  run — UNDER THE SPLIT-SCOPE RECIPE, §1 item 6; Session 50 paid
  its own refresh in-session — `trellis#12`/`#13`, $0.2701; a
  landed T2 owes a policy-1 refresh for its changed `src/workers`
  files); **(8)
  the targeted stage-1 entailment sweep AS WORDED IS BLOCKED BY
  SHAPE** (recorded by
  Session 44: stage-1 extraction wrote ACTION edges; the detector
  selects DERIVED_INSIGHT only — widening its selection is a
  recorded owner-visible design change to row-9 machinery, not a
  flag; the item stays on the menu as that design decision); **(9)
  the row-12 rollout continuation** (widening policy-2 scope,
  retuning merge density, or reverting the pilot — owner's call with
  the record §10.3 + §11.4 together); **(10) the
  superseded-embedding SWEEP** (storage reclamation only;
  destructive, re-buys embeddings on recovery; stays unchosen);
  **(11) the TTT-track RATIFIED QUEUE beyond T2** (record §12.6;
  each step its own owner-approved proposal): **T3–T4** (Phase 1
  continues after T2: T3 the `trellis_agent.py`
  construction-site rewire per §3/§4 layer 3/§5/§7 + §8 — the twin
  `parse_rlm_backend()`, the delete-unless-configured, the checker
  following the seam, the two telemetry fields, and the
  `rlm_worker.ts` cfg wiring if T2 deferred it; T4 the
  zero-LLM fixture-endpoint drill per §8 (the stub MUST return
  `usage` and gains a no-usage misbehaving mode) — each owner-gated
  ≤$5, each an increment record in the §5e/§5g mold, each diff
  human-reviewed); **Phase 2** R3a
  serving bring-up + protocol smoke, R3b the paired baseline (the
  reproduction half; the baseline arm = the SAME open checkpoint the
  retrofit starts from; GPU-hours or hosted per-token, priced in the
  proposal — the skeleton is MODEL_BACKEND_SEAM.md §9), then R4a–R4d
  when the collaborator's retrofit
  checkpoint lands exact-pinned (the expansion half — C2/C3, which
  NO external study covers); **Phase 3** R5. Context: R1 question 1
  ANSWERED (LaCT, record §12; retrofit training COLLABORATOR-SIDE;
  the reliance claim decomposed C1 supported / C2 extrapolated — the
  load-bearing gap / C3 untested); questions 2–4 stand, question 4
  sharpened to "eligibility boundary = the run's retrieval set?";
  official LaCT code exists (ICLR 2026). Row 10's measurement
  (Session 43), the judge-calibration MEASUREMENT (Session 44), the
  calibration DECISION (ACCEPT, Session 46), the R2a census
  (Session 46), the R2b design record (Session 47), the harness
  scaffolds (Session 50 Part A), and increment T1 (Session 50
  Part B) are DONE and off this list. If the owner approves
  nothing this session, the zero-paid proposal-staging work in §3
  still stands alone. OPERATIONAL NOTES (Windows): stopping
  `npm run dev:workers` through the session harness — OR a failed
  pipeline start (a missing `benchmark_logs/` directory broke a Tee
  and orphaned the npm tree, Session 38) — leaves stale consumers
  that steal queue-drill jobs ("timeout" while effects apply = the
  tell). Create `benchmark_logs/` before piping worker output; KILL
  THE CHILD PROCESS TREE and verify zero node/tsx worker processes
  (`Get-CimInstance Win32_Process`) before any queue drill. gpt-5.4
  $2.50/M in + $10/M out; metrics port 9464 for worker actuals
  (per-process registries — split consumers lose totals; read the
  metrics BEFORE killing workers). Session 44's lesson: NEVER
  capture a long-output CLI through `tee | head` — head's early
  exit kills tee on EPIPE mid-stream and manufactures a truncation
  (redirect to a file, then read the file). Session 49's lessons:
  set `PYTHONUTF8=1` when spawning `trellis_agent.py` with
  redirected stdout on Windows (the rlms rich logger prints U+25C6
  panel glyphs; a cp1252 stream encoder kills the process inside
  the `RLM(...)` constructor, pre-API); and `models.list`
  succeeding proves the key AUTHENTICATES, not that the account
  has completion quota — the minimal completion probe is the
  decisive pre-flight check before any paid spawn.
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

## 3. Session 51 problem statement

**TTT-track increment T2: the `buildAgentEnv` forward/strip
increment — the second FEATURE-CLASS self-edit, run through the
stage-2 harness on the Session 50 scaffolds.** T1 landed in
Session 50 (record §5h.11): the `TRELLIS_RLM_*` config surface and
the ambient `OPENAI_BASE_URL` guard are LIVE in
`src/config/index.ts` with ZERO consumers. T2 makes the worker's
child-environment builder honor them. The facts a new session must
act on:

- **What T2 lands (the spec is `MODEL_BACKEND_SEAM.md` §3.3 + §4
  layer 2 + the §8 T2 skeleton — quote the spec sections VERBATIM
  into the task text; the record lives in `docs/`, outside
  extraction scope):** in `src/workers/rlm_job.ts` —
  `AgentEnvConfig` gains the optional `rlmBackend` block (the
  `textedit` block mold); `buildAgentEnv` set-or-delete for EACH
  `TRELLIS_RLM_*` variable (the `TRELLIS_MCP_SERVERS` discipline:
  the child only ever sees validated values; unset means any raw
  inherited value is stripped); the unconditional
  `delete env.OPENAI_BASE_URL` joins the experiment-flag deletion
  block (§4 layer 2: the strip holds even for callers that bypassed
  config validation, and even when cfg sets a base URL — the child
  gets `TRELLIS_RLM_BASE_URL`, never the SDK variable); the named
  key variable's VALUE forwarded explicitly under its own name (the
  `mcpCredentialEnv` loop precedent, §3.3 — never logged). In
  `src/workers/rlm_job.test.ts` — the pins: set-forwards /
  unset-deletes per variable; the unconditional strip (both with
  and without a configured base URL); inherited raw values never
  leak; absent-block byte-identity (`buildAgentEnv` output
  byte-identical to today when `cfg.rlmBackend` is absent).
- **The recorded open point the proposal must state:** the one-line
  `rlm_worker.ts` wiring that passes `config.rlmBackend` into
  `buildAgentEnv`'s cfg may land in T2 or T3 (§8 T2 note). The
  RECOMMENDED answer: defer to T3 — T2 stays a pure-function
  increment with zero live consumers (the T1 shape: the seam is
  built and pinned before anything feeds it), and T3 (which wires
  the agent side) wires the worker side in the same increment. The
  proposal states the choice; the owner's yes covers it.
- **Feature-class mechanics (record §12.6, the T1/v3.1 lineage):**
  the task text is authored THIS session under the house
  prompt-engineering + hypershot protocols. **HARD REQUIREMENT
  (Guardrail 15, owner-directed July 13, 2026): before writing a
  single byte of the T2 task text, INVOKE both skills via the Skill
  tool — `prompt-engineering` (the meta-prompting protocol) AND
  `hypershot-protocol` — and author against their loaded guidance;
  this is a process gate, not a claim to make in prose. Session 50
  authored v3.1 as an amendment WITHOUT re-invoking them (the
  retroactive audit found the bytes compliant but the step skipped —
  roadmap §5); T2 is net-new task text and gets the full treatment.**
  Apply the scaffold
  disciplines: hard rules re-read through `trellis_task.grep`; the
  `<state_protocol>` upsum block; ONE retrieval call per cell;
  guarded-only edits; `frame_text`/`region_equal` verification;
  `citable()` before the ONE insight write; the STOP rule (no
  citable hash = no insight). Use hypershot instruction-bearing
  variables for the run-specific fills (entity names, cited-hash
  list) and keep the task's invariant vocabulary (tool names, the
  exact spec bounds, guard messages) concrete — the §6 invariance
  test. The driver sets
  `TRELLIS_TASK_NAMED_FILES=["src/workers/rlm_job.ts","src/workers/rlm_job.test.ts"]`,
  `PYTHONUTF8=1`, `TRELLIS_EDIT_ROOT` at the worktree,
  `TRELLIS_CITATION_AUDIT=1`, `--max-iterations 16`, ONE log file
  (never `tee | head`).
- **The new-file question does NOT arise:** both named files EXIST
  (no stub, no §5h.2 ceremony, no vitest-red window). The test file
  already carries pins — the task must ADD a describe block (or
  extend the existing `buildAgentEnv` suite) WITHOUT modifying any
  existing test (the zero-existing-tests-changed criterion item
  covers it).
- **Evidence chain (stage fresh THIS session, the §5g.2/§5h.3
  mold, zero-paid, read-only, BEFORE the proposal):** the substrate
  is FRESH for the named file (`trellis#12` ingested
  `src/workers/rlm_job.ts` at v2 on July 13 WITH Session 50's
  `TRELLIS_TASK_NAMED_FILES` delete; its extraction ran the same
  day). Query the graph for uncontested edges whose provenance is a
  live `rlm_job.ts` block carrying the §4-layer-2 molds (the
  `TRELLIS_EXP_*` deletion block and/or the `mcpCredentialEnv`
  forwarding loop); verify the block bytes on disk raw
  byte-substring; pick clean `--pre` entities (entities named after
  rlm_job surfaces — e.g. `buildagentenv` — checked for contested
  attached edges first; the §5h.3 reasoning pattern if residue
  exists); record the chain in a NEW §5i increment record
  (document-first, the §5h mold) BEFORE presenting. If no
  uncontested live-provenance edge reaches an `rlm_job.ts` block,
  the v3.1 fallback shape applies (bounded `vector_search`, own
  cells) — and if the premise cannot be verified at all, STOP and
  re-stage rather than run.
- **The criterion (the standing feature-class mold, judged item by
  item):** (1) named-file-only diff (exactly the two files);
  (2) exactly one recorded insight through the Session 31 gate
  citing live `rlm_job.ts` block(s) — subject/verb/object chosen at
  staging and pre-stated in the proposal; (3) `stage2:check` zero
  findings (scope + evidence + parse; comment-class not declared);
  (4) guarded-only (`textedit_raw_splices == 0`); (5) the
  increment's own pins green — `npm test` grows from 875/87, zero
  existing tests changed (run by the human with the diff applied);
  (6) human `git diff` review against the spec (set-or-delete per
  variable, the unconditional strip's position in the deletion
  block, the credential loop shape, absent-block byte-identity);
  (7) spend within estimate — counts + diff + dollars reported
  TOGETHER. A harness flag or a failing pin FAILS the increment —
  record, stop, diagnose; a retry is its own proposal.
- **Estimate:** T1's actual was $0.5781 for a two-file
  173-insertion authoring run on the scaffolds; T2 is a comparable
  two-file shape with a smaller spec — **propose $0.5–$1.0, ONE
  run, no pre-bundled contingency**, under the ≤$5/run cap. The
  post-landing split-scope policy-1 refresh adds roughly $0.10–$0.30
  (the Session 50 actual was $0.2701 for 33 blocks across both
  legs; T2 changes two `src/workers` files — policy-1 leg only
  unless src/rlm moves).
- **The gate:** owner-approved per run, proposal + estimate at
  session START. Unapproved = zero-paid session: stage the §5i
  record, verify the chain, hand off (the Session 42/49 mold).

## 4. Required design

- **Pre-flight (zero-paid):** confirm the Session 50 PR merged
  (`git log -- HANDOFF.md`); `npm ci`; `npm test` (875/87
  expected); re-read `MODEL_BACKEND_SEAM.md` §3.3/§4/§8-T2 and
  `REPOSITORY_INGESTION_REPORT.md` §5h.11 (the T1 landing IS the
  design input — its task shape is the template); the Windows
  stale-worker check before any queue use (§2 operational notes).
- **The quota probe FIRST** (one minimal completion — `models.list`
  proves nothing; §5h.10). Refused = record, skip the spawn, hand
  off zero-paid with the staged §5i record.
- **INVOKE `prompt-engineering` AND `hypershot-protocol` (Skill
  tool) BEFORE authoring the §5i.4 task text** — Guardrail 15, a
  hard process gate: load both, author the task text against their
  guidance (semantic tags, attention zones head+tail, hypershot
  instruction-bearing variables for run-specific fills, the §6
  invariance test for concrete vocabulary), and note in §5i.4 that
  they were invoked. This applies to ANY prompt-authoring work in
  any session, not only T2 (Guardrail 15).
- **Stage the §5i increment record document-first (the §5h mold):**
  scope + named files (§5i.1), no stub needed (both files exist —
  record the difference from §5h.2), the live evidence verification
  (§5i.2, the §5h.3 shape: graph edges, block bytes, `--pre`
  entities, the expected insight subject/verb/object, the honest
  churn note — a landed T2 re-chunks `rlm_job.ts` and the fresh
  edge contests on the next refresh), the named failure modes +
  catching layers (§5i.3), the task text VERBATIM (§5i.4, authored
  under the protocols — both Skills INVOKED, Guardrail 15 — on the
  **v3.2 template (§5h.12), the skills-strengthened successor to
  v3.1**, with T2's spec spliced), and the run proposal with the
  estimate (§5i.5).
- **Verify the evidence chain live BEFORE proposing** (read-only;
  the §5g.2 mold): the chosen edge(s) uncontested with live
  `rlm_job.ts` provenance; block bytes verbatim on disk;
  `stage2:check --pre` PASS on the chosen entities with
  `src/workers/rlm_job.ts`; `test:selfedit-harness` green.
- **Refresh-before-use:** the zero-paid dry-run plan echo
  (split-scope policy-1, no `--confirm-extraction`); Session 50
  left the substrate fresh — refresh only if the echo shows drift
  in files the task consults (the §5h.11 drift-reasoning precedent:
  drift confined to files outside the evidence chain and named
  files defers to the post-landing refresh).
- **The run mechanics (the §5h.11 driver, verbatim mold):**
  porcelain clean at spawn; `trellis_agent.py` spawned directly,
  research mode, `--max-iterations 16`, `TRELLIS_EDIT_ROOT` at the
  worktree, `TRELLIS_CITATION_AUDIT=1`, `PYTHONUTF8=1`,
  `TRELLIS_TASK_NAMED_FILES` as §3 states, full stdout to ONE log
  file; post-run `stage2:check` (scope, evidence, parse;
  comment-class not declared); human `git diff` review; the human
  runs `npm test` for the new pins.
- **Post-landing duties:** the split-scope policy-1 refresh for the
  changed `src/workers` files (owner-gated extraction spend, the
  per-PR cadence); the roadmap §5 entry with actuals; the §5i
  verdict item by item; HANDOFF regeneration (§0 step 5 re-check —
  if T2 lands, the default next objective is T3).
- **What does NOT change:** `src/config/index.ts` (T1's landed
  surface is measured evidence — no hand edits, no "cleanup" of the
  two recorded cosmetic notes); `trellis_agent.py` and the rlms
  library (T3 scope); the embedder; any default, pin, gate, or
  prompt byte (both composed-prompt pins stand at their Session 50
  values); the scaffolds (they are the RUN'S tools now — a scaffold
  defect discovered mid-staging is a jump-the-queue candidate under
  §0 step 3, not an inline edit).
- **Failure handling:** a failed T2 is ONE failed attempt — the
  increments-1/2 treatment (diagnose, close the class, a retry is
  its own proposal); never argue away a harness flag; never re-run
  silently; a failed run's residual insight write is cleaned under
  the bounded operator-cleanup precedent with the Cypher recorded.

## 5. File-level starting points

- `docs/architecture/MODEL_BACKEND_SEAM.md` — THE spec: §3.3 (the
  credential three-part rule), §4 layer 2 (the unconditional
  delete), §8 T2 (scope, named files, task-text skeleton, pins, the
  `rlm_worker.ts` open point). Quote verbatim into the task text.
- `src/workers/rlm_job.ts` — the target: `AgentEnvConfig`
  (~line 108) with the `textedit`/`retrievalBudget` optional-block
  molds; `buildAgentEnv` (~line 165) with the set-or-delete
  sections, the experiment-flag deletion block (now FOUR deletes —
  Session 50 added `TRELLIS_TASK_NAMED_FILES`), and the
  `mcpCredentialEnv` forwarding loop the key-value forwarding
  mirrors.
- `src/workers/rlm_job.test.ts` — the pin file: the `CFG` fixture,
  the forwarding/strip test mold (Sessions 33/50 pins are the exact
  shape T2's new pins follow).
- `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md` §5h — the FULL
  T1 record: §5h.5/§5h.9/§5h.11 task texts v1/v3/v3.1, **§5h.12 the
  skills-strengthened v3.2 (T2's TEMPLATE — study its structure:
  governing_rules with stable R1–R4 tokens, positive-led framing,
  the upsum and output_contract hypershot frames, decomposed
  sub-sequences, definition_of_done)**, §5h.11 the landed-run record
  and driver; §5e.4 / §5g.3 — the proposal mold.
- `docs/architecture/RLM_HARNESS_SCAFFOLDING.md` +
  `src/rlm/trellis_scaffold.py` — the scaffolds the task text
  leans on (what `citable()`/`frame_text`/`region_equal`/
  `trellis_task.grep` actually return — the task must describe
  them accurately).
- `scripts/stage2_selfedit_check.ts` / `src/benchmarks/selfedit/`
  — the harness (`--pre` and post-run); `test:selfedit-harness` —
  the zero-LLM rehearsal.
- `benchmark_logs/s50_t1_retry_run1.log` (LOCAL, gitignored — the
  owner's machine): the T1 landing transcript; diagnostic
  reference for what a clean scaffolded run looks like.

## 6. Test strategy and acceptance

The expected machinery footprint IS the T2 diff (two named files) —
authored by the run, landed by the human PR — plus this session's
documents (§5i, roadmap, HANDOFF).

- **Zero-paid (unconditional):** the §5i record staged
  document-first; the evidence chain verified live read-only;
  `stage2:check --pre` green on the chosen entities;
  `test:selfedit-harness` green; the dry-run refresh plan echo
  read; the proposal presented.
- **Paid (owner-approved only):** the quota probe, then ONE run
  within the estimate; the full §3 criterion judged item by item,
  counts recorded (actuals in the roadmap §5 entry; telemetry
  echoed — `textedit_raw_splices` MUST read 0; the citation audit
  echoed — `cited` must bridge to `src/workers/rlm_job.ts`).
- **Post-landing:** `npm test` with the GROWN count recorded; the
  FULL standing drill block (non-markdown bytes moved);
  `drill:scale` ALONE; the isolated Compose integration in the §2
  CI mold; the split-scope policy-1 refresh for the changed files.
- **If the session ends zero-paid** (not approved, or quota
  refused): the docs-only close-out mold applies (npm test + build
  + python:check + compose config; live drills skipped with the
  reason recorded — the Session 45–47/49 precedent).

Required close-out (the standing block; docs-only note above):

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

- `TRELLIS_ROADMAP.md`: full-dated §5 entry (the staged chain, the
  proposal, the run with its outcome and actuals, the criterion
  verdict item by item, defects found with disposition); row 13's
  cell gains the T2 outcome.
- `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md`: the NEW §5i
  increment record (staged document-first; completed with the run
  record).
- The per-PR refresh for this session's changed in-scope files
  (split-scope recipe; a zero-paid session owes nothing).
- `HANDOFF.md`: regenerate per §0 — including the §0 step 5
  re-check. NOTE for objective selection: if T2 LANDED, the
  RATIFIED queue makes the default next objective **T3 (the
  `trellis_agent.py` construction-site rewire, from
  MODEL_BACKEND_SEAM.md §8 T3 — the twin `parse_rlm_backend()`,
  delete-unless-configured, the checker following the seam, the two
  telemetry fields, plus the `rlm_worker.ts` cfg wiring if T2
  deferred it)**; if T2 FAILED, diagnose and re-propose (the
  increments-1/2 treatment — T2 would stand at ONE failed attempt);
  if unapproved, re-present the staged §5i proposal. The other
  standing decisions (the stage-1b prose chunk, the row-12 rollout
  continuation, row-11 defect-class increment 3 whenever a real
  target surfaces) remain owner alternates. Keep the five-session
  narrative window (47–51 after this session): compress Session 46
  into the digest and move its roadmap §5 entry verbatim to
  `docs/archive/ROADMAP_HISTORY.md` (and update the archive-pointer
  paragraph in the same commit).

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
   --porcelain` since Session 35; read-only `git diff -- <file>` for
   declared comment-class files since Session 39, nothing wider), and
   the run/toolkit never touches git;
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
   mold), the Session 39 comment-class-gate invariants (the gate
   fires ONLY on files the increment DECLARED via `--comment-class`
   — an undeclared increment never sees it; declarations validate
   BEFORE any I/O: a comment-class file must be a named file and
   must have a wired line-comment marker, and the flag is refused
   under `--pre`; the harness git surface stays read-only — exactly
   `status --porcelain` + `diff -- <file>`, nothing wider; both diff
   sides are checked; block-comment interiors stay honestly out of
   scope — the gate flags conservatively rather than pass silently;
   post-run mechanical check only, never a write gate), the
   Session 40 liveness-filter invariants (liveness = current-version
   membership, the `gatherHashEvidence` semantics — the SQL join and
   the checker's bridge move TOGETHER or not at all; the filter
   lives ONLY inside `search_ast_nodes` at the T15 seam — never
   re-implemented in a caller, never widened to `fetch_texts` /
   `get_ast_texts` / `get_ast_blocks` / `ast_hashes_exist`, which
   serve history BY HASH by design; the function signature moves
   only with a witting recorded change; the filter applies before
   `LIMIT`; no planner GUC inside the function; under-fill, if ever
   observed, is reported with row counts, never patched by loosening
   the filter; and the owner-ratified GENERAL rule — superseded
   versions are archive, not search space: any default-discovery
   retrieval surface, present or FUTURE, reads live blocks only,
   with superseded content reachable solely by explicit address),
   the Session 41 guarded-splice invariants (anchor verification is
   BYTE-EXACT and happens BEFORE staging — a refusal stages nothing;
   the family is ADDITIVE: `splice`'s signature and semantics for
   existing callers never change, and raw `splice` is never removed
   or deprecated out from under its pinned drills;
   `AnchorMismatchError` stays a typed teaching refusal — a real
   exception with bounded previews, never a silent auto-correction;
   the minimality rule refuses only provably-narrowable windows
   (shared edge lines) and names the minimal window; the
   honest-scope pin is deliberate — a correctly-declared removal
   manifest STAGES, and converting that documented residual into
   prevention is a recorded design change, never a silent "fix";
   the telemetry split stays counts-only and additive; the guarded
   family never becomes a write gate, never gains provenance
   standing, and never touches git; the rejected `py-tree-sitter`
   allowlist widening re-enters ONLY through the record's revisit
   trigger as a recorded owner-visible decision — the
   no-git/no-subprocess static pins never weaken regardless), and
   the Session 38 structural-chunking invariants (chunking
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
   holds until the owner widens the rollout), and the Session 45
   TTT-track invariants (the track is RESEARCH-ONLY until a rung
   lands machinery through its own owner-approved proposal; fast
   weights, if ever present, have NO provenance standing and are
   per-run ephemeral ABSOLUTE — cross-run persistence is a
   promotion-shaped event needing its own design record; model
   checkpoints and embedders are exact-pinned substrate-identity
   objects, and the embedder NEVER moves as a side effect of the
   completion backend moving; any TTT arm flag follows the
   `TRELLIS_EXP_*` mold; no rung changes any default without a
   recorded owner decision; the rlms library is never modified —
   the seam, if built, is config + an OpenAI-compatible endpoint;
   and the FEATURE-CLASS self-edit rung (ratified July 13, 2026,
   record §12.6) keeps its definition: task-assigned functionality
   increments are a class of their own — they never count as, and
   never weaken, the defect-class never-manufacture rule; each
   T-increment is owner-gated with the full criterion mold, every
   diff human-reviewed, landing always a human PR), and the
   Session 47 seam-design invariants (the T-series implements
   MODEL_BACKEND_SEAM.md as written — a deviation discovered
   mid-increment is a recorded design-record correction, never a
   silent drift; backend choice is expressible ONLY through the
   validated `TRELLIS_RLM_*` config surface once T1 lands — the
   ambient `OPENAI_BASE_URL` disposition is refusal/strip/delete at
   its three layers, never a fourth channel; the kernel default
   model literal lives Python-side and unset config stays
   byte-identical at every layer; credential values ride the
   `mcpCredentialEnv` mold — name-indirection, fail-fast resolution,
   never logged, never in argv or telemetry), and the Session 50
   scaffold invariants (every research run wraps the operator task
   in its per-run uuid tags at BOTH injection points and injects
   `trellis_task` as kernel surface — never payload-selectable,
   never gated off; the frame helpers inject EXACTLY when the
   editing toolkit does, and `citable()` EXACTLY when the driver
   set `TRELLIS_TASK_NAMED_FILES` — a variable `buildAgentEnv`
   deletes unconditionally, the experiment-flag mold; `citable()`
   is READ-ONLY forever: never a gate, never counted as a database
   tool call, never feeding the retrieval set, the citation audit,
   or held state; its liveness join mirrors `gatherHashEvidence`
   and the two sides move TOGETHER or the harness mirror pin fails
   — never a silent divergence; the conditional scaffold addenda
   are empty strings when gated off, so a gated-off run's prompt
   stays byte-identical; the helpers' return-type convention
   (Python values; `grep` JSON) is recorded API — a change is a
   witting kernel decision; S2b/rlms compaction stays OFF until its
   own measured owner-approved proposal; and the uuid same-run echo
   residual stays recorded, not denied).
   The Session 37
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
   spend, it does not guarantee sufficiency — and the Session 43
   measured verdict claims the MECHANICAL story only
   (`RETRIEVAL_DISCIPLINE.md` §9.3: no token headline — the 0.6%
   pooled margin is noise-adjacent; no correctness claim — one run;
   never re-argue or embellish it). Row 11's version: extraction quality
   claims carry their counts and their spot-check evidence together —
   a big graph is not a good graph. Row 12's version (Session 38): a
   criterion miss is a FAILED pilot even when four of five items pass
   and the miss is artifact-explained — record the raw number, the
   diagnosis, AND the diagnostic number, then stop; the owner
   adjudicates. Session 40's version: the liveness filter closed the
   pollution CLASS at the tool — the dead embeddings still exist in
   storage, the two both-column seam misses persist, and the
   filtered-HNSW under-fill residual is documented, not denied —
   never describe the filter as having "fixed retrieval."
   Session 41's version: the guarded family PREVENTS address drift
   and edge-neighbor retypes and makes removal EXPLICIT — it does
   NOT prevent a correctly-declared manifest from dropping a kept
   line; never describe it as "closing" the run-2 class outright
   (the drill pins the staging deliberately). Session 45's version:
   "increases quality of response overall" is an UNMEASURED
   hypothesis — no TTT claim exists until a paired arm exists; any
   future TTT number is reported with the record's calibration
   attached (external evidence predicts stability-shaped gains at
   ~2× serving cost; behavioral criteria only, perplexity recorded
   never criterial). Session 47's version: the seam design manages
   the `OPENAI_BASE_URL` channel and closes the `load_dotenv()`
   re-introduction for THAT VARIABLE only — the dotenv channel
   stays open for other variables by design; never describe T1–T3
   as having "sealed" the child's environment. Session 48's
   version: a content-correct diff under a harness flag is a FAILED
   increment — the flag is never argued away, the diff is reverted
   and never resurrected as a patch source, the spend actuals are
   reported against the approved envelope even when the overrun is
   the only miss, and a failed run's residual graph write is
   cleaned under the bounded operator-cleanup precedent with the
   Cypher recorded; frames confer no citability — only retrieval
   does. Session 50's version: ONE landed run cannot separate the
   scaffolds' contribution from the amended task prose — never
   claim the scaffolds "fixed" the Session 48 failure class; what
   is claimable is the observed mechanics (the run used
   `frame_text`/`citable()`/`upsum`/`trellis_task.grep` at exactly
   the previously-failing steps and the classes did not recur), and
   the injection defense covers PRE-EXISTING data only (the
   same-run echo residual stands).
9. Do not break existing consumers: the composed-prompt pins
   (`e57e7a55…24bd` default / `a37d2b4a…764e` omit-arm since the
   Session 50 skills re-authoring of the scaffold addendum,
   `test:modules` [4]/[7])
   move only with a witting kernel change, both recomputed in the
   same commit; module #1's pins hold; the legacy extraction-job
   payload and the `prose` payload both process with the exact pinned
   legacy prompt bytes; `TRELLIS_RESULT`/`TRELLIS_TELEMETRY`
   semantics are additive only; the API, A2A, and SSE contracts are
   untouched; the `get_ast_texts`/`nodeText` reconstruction bytes do
   not change; the FIRST fetch of every retrieval surface returns
   byte-identical results (vector search's Session 40 filtered shape
   IS the pinned baseline; the next change there needs the same
   ceremony); bare `TrellisNeo4j(...)` AND bare
   `TrellisPostgres(...)` construction keep behaving exactly as
   today; the verification worker keeps processing the existing job
   shape byte-for-byte; `parseSourceFile` WITHOUT `chunkingPolicy`
   (or with 1) stays byte-identical to Session 8 output; `splice`
   and every pre-Session-41 textedit method stay byte-identical for
   existing callers; the LANDED T1 config block is ADDITIVE — every
   existing config consumer reads exactly what it read before, and
   unset `TRELLIS_RLM_*` keys change nothing anywhere (pinned by
   the run-authored `rlm_backend.test.ts`); T2's `buildAgentEnv`
   changes must keep the absent-block output byte-identical; and
   the drills and probe scripts that fetch
   repeatedly today keep passing (their construction is bare by
   design).
10. Respect the rlms prompt contract: extend `RLM_SYSTEM_PROMPT`,
    never replace it; no literal curly braces in anything rlms
    formats; no rlms library modifications.
11. Follow the T16 observability house style: file paths, prompts,
    extraction text, hashes, and retrieved addresses never become
    metric label values; counts are label-bounded; entity names may
    appear in log CONTENT per the dropped-action precedent; operator
    CLIs may print hashes (the `promote` precedent). Base URLs and
    credential values join the never-a-label-value list (the
    Session 47 record §7: `rlm_base_url_set` is a boolean echo, the
    URL itself never appears).
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
    the substrate's own granularity; the guarded splice family is
    this doctrine applied to the splice contract itself. Prompt text
    may reinforce the discipline but never substitutes for tooling
    shape.
15. Prompt authoring runs the protocols (permanent; owner-directed
    July 13, 2026 — survives every rewrite). ANY session that
    creates or edits prompt text — a kernel/module addendum, an
    RLM task text, an agent or sub-agent instruction, an extraction
    or classification prompt, an output schema, a hypershot frame,
    or any artifact that primes a model's generation — MUST FIRST
    invoke BOTH the `prompt-engineering` skill (the Lexideck
    meta-prompting protocol: semantic tags, hierarchical markers,
    structured placeholders, collections, attention management) AND
    the `hypershot-protocol` skill (contamination-free structural
    examples: frames with free variables, the primacy/invariance
    rules) via the Skill tool, and author against their loaded
    guidance. This is a PROCESS gate, checked before the bytes are
    written — never a claim asserted in prose after the fact. It
    applies even to amendments of protocol-authored text (Session 50
    skipped it for the v3.1 amendment; the retroactive audit found
    the bytes compliant but the step missing — the rule closes that
    gap so future prompts get the discipline by construction, not by
    luck). The invariance test (`hypershot-protocol` §6) governs
    what may sit at the system/prompt layer: only tokens identical
    across every invocation (tool names, fixed schema fields, the
    exact guard messages, spec bounds) stay concrete; everything
    run-specific becomes a hypershot variable or moves to the data
    layer. The rlms no-literal-braces constraint on composed-prompt
    addenda still binds — where a brace-bearing hypershot frame
    would break `.format()`, the prose description is the forced and
    correct choice (recorded so it is not mistaken for a protocol
    lapse). Recompute both composed-prompt pins in the same commit
    whenever kernel prompt bytes move (Guardrail 9).

## 8. Explicit exclusions

Do not include: retuning, re-arguing, or embellishing the RECORDED
Session 43 slice (d) verdict (`RETRIEVAL_DISCIPLINE.md` §9 is the
measured record — the mechanical claim only) OR the RECORDED
Session 44 judge-calibration measurement (`PROVENANCE_THREADING.md`
§10.2 is the measured record, incident correction included);
re-running either measurement or the Session 28 control (all are
recorded verdicts); re-opening the RESOLVED judge-calibration decision (the owner picked
ACCEPT the strict judge, July 13, 2026 — Session 46's roadmap §5
entry; it re-enters only with new data, and a rubric change for
derived-classification verbs stays its own designed owner-visible
session touching row-9 machinery, never an inline edit); widening the
detector's selection beyond DERIVED_INSIGHT edges (the
"stage-1 entailment sweep" menu item is BLOCKED BY SHAPE until the
owner makes that recorded design decision); treating the 98
contested OOLONG-era `q_` edges as cleanup targets (lazy recovery,
never "recovered" en masse);
changing the `est` suite's pinned truths,
bounds, or question set; changing the discipline machinery's refusal
bytes, identities, telemetry shape, or wiring;
the superseded-embedding SWEEP (storage reclamation, owner decision);
any refresh extraction beyond the adopted per-PR cadence (Session 50
owes one only for files its own PR changes — a zero-paid session
owes nothing);
the row-12 rollout
continuation (widening policy 2 beyond `src/rlm`, retuning the merge
target or split threshold, or reverting the pilot); ANY paid run
without explicit owner approval (the T1 retry run itself included —
the proposal is presented at session START and the run happens only
on the owner's yes; serving infrastructure, model downloads, GPU or
hosted-endpoint spend are Phase-2 owner-approved proposals);
re-arguing or
embellishing ANY recorded T1 verdict — the Session 48 FAILURE
(§5h.7–§5h.8) or the Session 50 LANDING (§5h.11, its two cosmetic
review notes included: the landed diff stays as written);
hand-editing the LANDED T1 diff in `src/config/index.ts` /
`src/config/rlm_backend.test.ts` (it joins the increments-1/2
landed diffs as measured evidence of self-edits — style cleanups
included); running T2 beyond ONE run without a fresh owner
decision (a failed T2 is diagnosed and re-proposed — the
increments-1/2 treatment);
implementing T3/T4 scope inside T2 (no `trellis_agent.py` byte, no
fixture server, and no `rlm_worker.ts` byte if the proposal defers
the cfg wiring to T3 — each is its own increment with its own
proposal; a T2 diff that touches an unnamed file FAILS the
named-file/scope criterion); widening
the backend enum beyond `openai`/`vllm`, adding config keys beyond
the four landed, or "improving" the design record mid-increment
(a deviation is a recorded design-record correction with owner
visibility, never a silent drift); acting on the ambient
`OPENAI_BASE_URL` disposition at any layer other than the
increment's own (T1's config refusal is LANDED; the `buildAgentEnv`
delete is T2's, the agent-side delete is T3's — never inline
edits); enabling S2b/rlms compaction, making `citable()` (or any
scaffold surface) a gate, giving the scaffolds provenance standing,
injecting the task surface or helpers into author mode, changing
the scaffold return-type convention or injection gating, or
setting `TRELLIS_TASK_NAMED_FILES` in any default/worker/Compose
configuration (it is a direct-spawn driver input, stripped by
`buildAgentEnv` permanently); running any T-series
increment without its own owner-approved proposal and increment
record (ratification of the §12.6 chunking covers the SHAPE, never
individual spend); conflating the feature-class rung with
defect-target discovery (task-assigned increments are not
"surfaced targets" and never satisfy or weaken the increment-3
never-manufacture rule); modifying the rlms library in any
form (guardrail 10);
moving,
re-keying, or re-embedding the embedding backend (schema-coupled
`vector(1536)`; a substrate-identity event, out of the T-series'
scope by the record's §4.2 and MODEL_BACKEND_SEAM.md §2.3); giving
the worker transport a config surface (deferred behind the
completion/embedding client split — MODEL_BACKEND_SEAM.md §2.2, its
own future proposal); persisting fast weights across runs, designing
warm-start conveniences, or giving any adapted state provenance
standing (per-run ephemeral is ABSOLUTE within the track;
cross-run persistence needs its own design record); treating H1/H2
as findings or writing any "TTT increases quality" claim without a
paired measurement (guardrail 8's Session 45 version);
manufacturing or planting a row-11 increment-3 target (the
Session 44 search verdict stands: none exists today — the increment
re-enters only when a real one surfaces);
weakening, re-implementing, or widening the Session 40
liveness filter (it lives ONLY in `search_ast_nodes`; the
history-by-hash surfaces never filter; under-fill is reported, never
patched by loosening — guardrail 5); tuning the eight pinned seam
queries, their embedding text, or the top-3 threshold (guardrail 8 —
they are the standing instrument); installing `py-tree-sitter` or ANY
native wheel in the toolkit's environment — the Session 41 record
REJECTED the widening; it re-enters only through the record's
recorded revisit trigger (construct-granular addressing content
queries cannot express) as an owner-visible decision, and the
no-git/no-subprocess pins never weaken regardless; changing
`splice`'s existing signature or semantics, removing or deprecating
raw `splice`, or making the guarded family mandatory at the contract
level (the guarded-only requirement is a per-increment CRITERION,
enforced by pre-stated telemetry counts, never by breaking the
compat surface); weakening any Session 41 guarded-splice pin
(`test:textedit` [14], `test:selfedit-harness` [8], the five-counter
telemetry pin) or silently converting the honest-scope staging pin
into a refusal (that is a recorded design change with owner
visibility); hand-editing the increment-1 LANDED diff in
`trellis_tools.py` OR the increment-2 retry's LANDED diff in
`trellis_agent.py` (both are measured evidence of landed self-edits
— style cleanups included); deleting, contesting, or "cleaning up"
the three standing beliefs (`wires` / `consumes` / `returns_copy_of`
— true, live-cited, uncontested) or any graph edge outside the
bounded operator-cleanup precedent (guardrail 5); "recovering" the
contested `main` entity or the contested churn residue (standard
lazy recovery — re-derivation happens when something actually needs
the belief, never as cleanup); making the parse gate or the
comment-class gate a write gate or wiring either anywhere except the
post-run checker path (guardrail 5's mold); firing the comment-class
gate on an increment that did not declare comment-class; letting any
edit run or the toolkit touch git in any form (the harness's own git
use stays read-only: status + diff; landing is a human-reviewed PR,
always); committing an edit-run diff without human `git diff` review
or with a non-empty `stage2:check` finding list; re-running any
scoped snapshot OUTSIDE the gated refresh steps (a scoped re-run
without extraction budget is zero-paid but still churns beliefs —
and a policy-1 run over `src/rlm` REVERTS the pilot: the split-scope
recipe is mandatory, guardrail 5); weakening any Session 35 harness
pin, Session 37 parse-gate pin, Session 39 comment-class-gate pin,
Session 38 structural-chunking pin, or making the checker a write
gate (guardrail 5); designing or running any new stage-2 ladder
increment unilaterally — increment 3's shape is RECORDED
(guarded-only criterion) but each run enters as its own
owner-approved proposal; tombstoning or sweeping the extraction
residue as if it were drill state (guardrail 12); reworking the
Session 34 scope machinery (carry-forward semantics, the
`out_of_scope` skip, the plan echo lines ship as recorded);
reworking rows 9, 10, or 12 (the write gate, the detector, the
retrieval discipline, and the chunking machinery ship as recorded —
do not change their stamps, reasons, refusal bytes, identities, or
wiring; do not wire the detector into the write path; do not
repurpose the `TRELLIS_CITATION_*` env flags); making
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
(deprioritized permanently; explicit owner request only);
running the cross-process concurrency proof run (coverage-audit gap
#1) or any proof-run depth increment without owner approval —
propose with estimates; weakening ANY Session 29 `write_back`
hardening pin, the `StaleFileError` semantics, the splice "\n"-only
refusal, or any textedit gating/containment/hash-guard pin; claiming
full TOCTOU closure (the residual window is documented, not closed —
OS locking stays out of scope); claiming the retrieval-set constraint
closes laundering (it closed T1; T2 is the detector's SAMPLED
residual — guardrail 8); claiming dedup/budgets make retrieval
optimal (they close repeats and bound spend — guardrail 8); claiming
structural chunking fixed retrieval (the pilot's item 3 FAILED as
worded — guardrail 8); claiming the guarded splice family closed the
run-2 class outright (guardrail 8 — the honest-scope pin exists
precisely because it did not); claiming T1–T3 "seal" the child
environment (guardrail 8's Session 47 version — the dotenv residual
stands); ANY data-plane representation
migration at ANY boundary (the Session 27 verdict stands; re-entry
only through the review's benchmark matrix with owner sign-off);
importing polars in any `src/` path, kernel surface, or prompt;
raising any workspace/scratch/textedit cap without first re-running
the M1 fixture at the target size (the cap-raise doctrine, pillar
§7); asserting on wall-clock timings in any drill; changing
`get_ast_texts`/`nodeText` block-boundary semantics (SUPERSEDED by
`get_ast_blocks`, confirmed closed by round 4); a fifth
effective-context probe round; weakening or toggling the §6.2 kernel
block outside the `TRELLIS_EXP_OMIT_CMT` experiment flag; setting
`TRELLIS_EXP_MODULES` or `TRELLIS_EXP_OMIT_RETRIEVAL` (or any new
experiment flag) anywhere but a probe invocation's own environment;
moving the composed-prompt pins without a witting kernel prompt
change (both recomputed in the same commit, history recorded); new
MCP servers or transports; A2A changes; frontend work (deferred
unscheduled); `ASTRef`/`EVIDENCED_BY` migration (gate CLOSED;
Sessions 23–41 read 1.84x, 2.11x, 1.99x–2.01x, 1.78x, 1.99x,
1.77x-after-outlier, 1.97x, 1.89x, 2.09x, 2.04x, 1.94x, 1.53x,
1.68x, 1.63x, 1.76x, 1.69x, 2.18x, 2.05x, and 1.39x/1.45x, all
CLOSED — do not migrate on a noisy reading); T13 re-hashing; rlms
library modifications; treating the checkout EOL-normalization churn
class as a defect to "fix" in the ingestion layer (recorded
environmental behavior, five observations); weakening the Session 14
write-path enforcement, the Session 15/20/22/24 composition pins,
the Session 16 lineage pins, the Session 17 promotion refusals, the
Session 18 registration gates, the Session 19 authoring-mode /
anchor-gate / draft-scanner / template pins (as calibrated in
Session 21), the Session 20 textedit gating/containment/hash-guard
pins (as corrected in Session 26 and hardened in Session 29), the
Session 22 answer-channel refusals, the Session 24 block-walk parity
pin, the Session 25 extraction gates, the Session 27 M1/M7 standing
fixtures, the Session 28 module-arm validation and est-suite truth
pins, the Session 30 retrieval-set tracking pins, the Session 31
write-gate pins, the Session 32 detector pins, the Session 33
retrieval-discipline pins (`test:rlm-sandbox` [7] + the
`buildAgentEnv` unit pins), the Session 34 scope pins
(`snapshot_ingest.test.ts` scope section + `test:repo-ingest`
Part 7), the Session 35 stage-2 harness pins (`check.test.ts` + the
`test:selfedit-harness` drill), the Session 37 parse-gate pins
(`parse_gate.test.ts` + drill section [6]), the Session 39
comment-class-gate pins (the run-2-shape unit pins in `check.test.ts`
+ drill section [7]), the Session 38 structural-chunking pins
(`generic_tree.test.ts` + `structural_chunker.test.ts` +
`treesitter_engine.test.ts` + the parity structural-kinds case + the
snapshot-stamp pins, including policy-1 byte-identity and the
policy-1-never-emits-structural-kinds pin), the Session 40
liveness-filter pins (the `schema.test.ts` filter pin +
`test:repo-ingest` Part 8's planted dead twin + the
`sandbox:probe:embed` membership fixture), or the Session 41
guarded-splice pins (`test:textedit` [14] incl. the honest-scope
staging pin + `test:selfedit-harness` [8] + the five-counter
telemetry pin).
