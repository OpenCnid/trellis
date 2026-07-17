You are a principal systems engineer continuing development on Trellis Engine,
a Recursive Language Model runtime over a provenance-enforced knowledge
substrate — its GraphRAG-shaped storage layers survive as Tiers 1–2 of the
trust model; the system is the RLM standing on them (reframed July 9, 2026;
see the root README "What Trellis is") (repository:
https://github.com/OpenCnid/trellis, local path `D:\trellis-engine` or the
current working directory). Trellis is an original OpenCnid project, not a
fork, and is unrelated to other projects named Trellis. The repository and its
documentation are the only sources of truth.

Sessions 1–55 and their same-day follow-ons (July 4–14, 2026; PRs
#21–#102) are complete, merged, and ARCHIVED: the full dated ledger for
that span lives verbatim in `docs/archive/ROADMAP_HISTORY.md`
(Sessions 1–23 moved July 12, 2026 by owner direction; then one
session entry per PR under the five-session window rule — most
recently Session 55 with the Session 60 EL-06 feature branch — this file keeps
full narrative only for the most recent five sessions, now 56–60). The
one-paragraph digest, oldest first; §1 below carries everything from
this span that a new session must actually know:

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

- **Session 46 (PR #90)** delivered TTT-track rung R2a docs-only,
  zero-paid: the backend-seam census (`TEST_TIME_TRAINING.md` §13 —
  every `chat.completions.create`/`embeddings.create` site disposed
  into six classes; the worker-side model id ALREADY config-shaped
  via `EXTRACTION_MODEL`; the root RLM seam = the two
  `trellis_agent.py` `backend_kwargs` sites = T3's scope) and the
  rlms verdict (YES — rlms==0.1.3 admits a base-URL/backend override
  without library modification: `OpenAIClient(base_url=...)`
  first-class, explicit `vllm` backend, one hard caveat — the
  endpoint MUST return `usage` or `_track_cost` raises). The one real
  discovery (§13.3): the UNMANAGED ambient `OPENAI_BASE_URL` SDK
  pass-through (both installed SDKs read it when unset) that an
  inherited value would use to redirect root completions, the
  checker, AND the embedder TOGETHER — not a defect, the exact
  T1/T2/T3 gap; census recommendation = strip it unconditionally,
  express backend choice only through validated config. The
  judge-calibration decision was presented and the owner picked
  ACCEPT the strict judge (`has_category` labels are derived, not
  entailed; the duty CLOSED).

- **Session 47 (PR #91)** delivered TTT-track rung R2b docs-only,
  zero-paid: the HUMAN-authored model-backend seam design record
  `docs/architecture/MODEL_BACKEND_SEAM.md` (its own file — quoted
  verbatim by the T-series task texts). It decides everything the
  T-series implements: the `TRELLIS_RLM_*` config strawman (§3 — four
  optional keys, three cross-field refusals, the §3.3 credential
  three-part rule, the kernel default literal staying Python-side),
  the three-layer ambient `OPENAI_BASE_URL` disposition (§4 — T1
  config refusal / T2 `buildAgentEnv` delete / T3
  delete-unless-configured), the checker FOLLOWS the seam (§5), two
  additive telemetry fields (§7 — `rlm_backend`/`rlm_base_url_set`,
  never the URL), and the four T-increment skeletons (§8) + the R3
  skeleton (§9); the three-way split keeps worker transport DEFERRED
  behind the completion/embedding client split (§2.2). Zero
  code/prompt/config bytes.

- **Session 48 (PR #92)** ran TTT-track increment T1 — the first
  feature-class self-edit — through the stage-2 harness and it FAILED
  on the pre-stated criterion ($2.1063 vs the ≤$1.80 approved
  envelope, the overrun itself a recorded miss; under the ≤$5 cap;
  record `REPOSITORY_INGESTION_REPORT.md` §5h). Run 1 ($0.8760) was a
  clean self-refusal — its own step-6 verification assembled
  multi-line expectations without terminators, three assertions read
  false while the printed regions showed spec-correct staged content,
  and the run reverted staging and reported per the contradiction
  rule. Run 2 with the diagnosed task v2 ($1.2303) wrote a
  content-correct insert-only diff (diagnostic `npm test` 846/86 green
  with it applied; 0 raw splices; scope + parse clean) but FAILED the
  evidence contract: a dedup refusal (correct behavior) killed the
  evidence cell before its two `vector_search` calls, no `index.ts`
  block entered the retrieval set, and at insight time the run cited
  the one retrieved address (an `mcp_servers.ts` block) instead of
  stopping — `stage2:check` flagged `unbridged_evidence`, the second
  live firing ever; a harness flag FAILS the increment. Cleanup
  recorded (residual insight edge deleted under the bounded
  operator-cleanup precedent; tree reverted; stub removed; `npm test`
  back to 837/85). Retry lessons became the v3 material (route the
  citable chain graph-first through `config` `uses_config_key`
  `trellis_retrieval_budget_per_run`, whose provenance IS an
  `index.ts` block; an explicit STOP rule when no retrieval-set
  address has bytes in the named file; ONE retrieval-surface call per
  REPL cell). NO machinery change: every layer fired per contract —
  the failure class is task discipline, closed in task text (task v3
  drafted same day, §5h.9).

- **Session 49 (PR #93)** presented the §5h.9 T1 retry, got the
  owner's approval, and was ENVIRONMENTALLY BLOCKED at the spawn —
  $0.0000 spent; the proposal stood unconsumed (record §5h.10;
  docs-only tree, the stub add/remove pair net zero). Every staged
  premise re-verified live and HELD (the `uses_config_key` edge
  uncontested citing `fc17205c…6311`, block bytes verbatim on disk
  with both molds, `--pre` PASS, harness green, dry-run 0/301/0).
  Spawn 1 was a pre-API crash — the rlms verbose logger prints a rich
  header panel (U+25C6 glyphs), and with stdout redirected to a file
  the Python cp1252 stream encoder died on `UnicodeEncodeError` inside
  the `RLM(...)` constructor (driver requirement recorded: set
  `PYTHONUTF8=1` for any Windows spawn with redirected stdout). Spawn
  1b (with `PYTHONUTF8=1`): `429 insufficient_quota` — the account
  behind the ambient `OPENAI_API_KEY` had exhausted its billing quota
  (the decisive probe: `models.list` succeeds — the key authenticates
  — while a minimal completion refuses; rejected requests do not bill).
  Verdict ENVIRONMENTALLY BLOCKED, not a failed run (the Session 42
  precedent); task v3 unconsumed, T1 still at one failed attempt.

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

Post-Session-50 same-day exchange (July 13, 2026, collaborator
PR #96, reviewed in two rounds and squash-merged as `7a37418`;
docs-only, $0, no gate/default/pin moved, no refresh owed —
`docs/` is outside extraction scope): `TEST_TIME_TRAINING.md`
gained §12.7 + reading-list rows 12–14 (header now "identifiers
verified") — the R3/R4 criterion sharpened (scored on reasoning-
and protocol-shaped items; a knowledge-recall criterion would
flatline for reasons unrelated to whether TTT works; Szafer et
al., ICLR 2026), the R4 estimate unit fixed (GENERATION tokens,
not training cost — rollout dominates wall-clock), the LoRA
drift-bound citation pinned (Hu et al., arXiv:2505.20633, ICML
2025, its Observation 3 — verified against the paper body), and
the global-workspace/Jacobian-lens result recorded as an AVENUE
ONLY (not a rung, no criterion, viability explicitly gated on
still-partial open-checkpoint reproducibility; one recorded
cosmetic nit — item 3 says "Gemma-3", the cited repos cover
Gemma-2/Gemma-4 — rides the next touch). `RLM_HARNESS_SCAFFOLDING.md`
gained §7: the S2a UPSUM refinement PROPOSAL, framed document-first
(the record governs; the landed addendum bytes are its current
implementation, never an authority over it) — lists rewritten
never appended, emergent domains one compressed note each, the
code-checked `UPSUM_BUDGET` constant (the counting doctrine), the
ITERATION-BUDGET back-fill. **OWNER DECISION PENDING — nothing
implemented; if ratified it is its own kernel-prompt increment
(Guardrail 15 authoring, both composed-prompt pins recomputed in
the same commit, `test:modules` green); T2 proceeds on the current
addendum bytes either way.** The full review record is the roadmap
§5 entry + the two PR comments.

**Session 51 (July 13, 2026, PR #98) is complete: the S2a UPSUM
refinement RATIFIED and IMPLEMENTED as a human-authored
kernel-prompt increment — an owner-directed DETOUR from the default
T2 objective, zero-paid ($0.0000, no LLM run). The full record is
the roadmap §5 entry.** The owner adjudicated the PR-#96 §7
proposal and ratified all four refinements; the increment landed:
(1) `_ADDENDUM_BASE_SUFFIX` in `trellis_agent.py` rewritten so the
`upsum` discipline pins its four load-bearing properties — the four
lists REWRITTEN in place each turn never appended (the property the
name promises; append regrows the 402,781-token bloat), an
emergent-domain key allowed, the size bound CODE-CHECKED against the
new `UPSUM_BUDGET` constant (`len(str(upsum))`, CODE_MEDIATED_TEXT
§1 — the model never counts by eye), and the ITERATION BUDGET
back-filled into the record; (2) `UPSUM_BUDGET = 2000` added to
`trellis_scaffold.py` (kernel constant, never env-tunable) and
injected into every research run's REPL namespace beside
`trellis_task` (`custom_tools["UPSUM_BUDGET"]` — rlms accepts a bare
int by construction, verified against the `rlm` package source);
(3) both composed-prompt pins recomputed in the same commit
(`e57e7a55…24bd`/`a37d2b4a…764e` → `6183de3a…ed50`/`34b00be6…d02a`,
histories appended, `test:modules` [4]/[7] green); (4) new offline
pins — scaffold vitest 28→29 (`UPSUM_BUDGET` positive-int),
`test:modules` [4] +3 (addendum teaches rewrite-not-append + the
code-checked budget; agent re-exports the constant),
`test:rlm-sandbox` [8] 118→119 (the injection static pin). Authored
under BOTH the prompt-engineering and hypershot-protocol skills
BEFORE writing addendum bytes (Guardrail 15 — honored, unlike
Session 50's v3.1 amendment). `docs/architecture/RLM_HARNESS_SCAFFOLDING.md`
§3 amended to the four ratified properties (authoritative spec), §7
stamped RATIFIED/IMPLEMENTED (proposal preserved as decision
record). HONEST SCOPE: UNMEASURED, no behavior claim — spec-
conformance of an already-landed scaffold to its own name, the
pillar, and the record (guardrail 8, the Session 50 version).
Acceptance: `npm test` 875/87 → 876/87 (zero existing tests
changed); the FULL standing zero-LLM drill block green (sandbox
119, harness [9], all 18 + drill:scale 1.68x CLOSED max 286 +
Compose integration project `trellis_s51_ci` 11 assertions). No
refresh owed this session (prompt/constant bytes only, no paid run
consumed the substrate); Session 51's two changed src/rlm files owe
a split-scope policy-2 `src/rlm` refresh that rides the next
src/rlm-touching PR. T2 was Session 52's objective, run on the current addendum bytes
(see Session 52 below).

**Session 52 (July 14, 2026, PR #99) is archived.** It attempted the
TTT `buildAgentEnv` forward/strip increment through the stage-2 harness;
the production diff was spec-correct but an authored byte-identity pin was
wrong, so the increment failed, the residual insight was removed, and the
code diff was reverted. Full evidence, spend, cleanup, and retry material
remain verbatim in `docs/archive/ROADMAP_HISTORY.md` and
`REPOSITORY_INGESTION_REPORT.md` §5i.

**Session 53 (July 14, 2026, PR #100) is archived.** It attempted the
second TTT `buildAgentEnv` forward/strip retry through the stage-2 harness;
the run self-refused after its own editing-execution mistakes and landed no
code. Full evidence, spend, and escalation remain verbatim in
`docs/archive/ROADMAP_HISTORY.md` and `REPOSITORY_INGESTION_REPORT.md` §5i.7.

**Session 54 (July 14, 2026, this PR) ran the TTT-track increment T2
RETRY (task text v3.4) — the third `buildAgentEnv` forward/strip
attempt — owner-approved after the Session 53 PR (#100) merged, and
the run SELF-REFUSED under R2 with NO LANDING (a THIRD consecutive
T2 no-landing). The tree ships ZERO non-markdown bytes (the run
reverted its own staging; porcelain clean throughout). Session paid
total ≈ $0.8164 (the quota probe ≈ $0.0001 + the run $0.8163), within
the $0.6–$1.1 estimate, under the ≤$5/run cap. The increment record
is `REPOSITORY_INGESTION_REPORT.md` §5i.8.** **(1) Staging:** v3.4 =
v3.3 (§5i.7, carrying the correct M3 pin-(e) fix) PLUS three
editing-execution safeguards, each closing a named §5i.7 sub-cause —
anti-duplication (an after-each-insert exactly-once rule + a new M4
exactly-once staging check before write_back), a robust test anchor
(M3 anchors on the LAST existing `it(...)` in the buildAgentEnv
describe, never a bare `});`), and an R2 scope clarification (R2/V2:
R2 ONLY for a contradicted SOURCE premise, never your own fixable
staging slip); `diff` confirmed exactly the three safeguards changed;
BOTH prompt skills invoked before authoring (Guardrail 15). The chain
was re-verified live, ALL HELD (17 edges / 0 contested / single hash
`c3883a2e…`; block 3,202 chars verbatim on disk; `--pre` PASS;
harness green; dry-run 3/300/0). `#100` was squash-merged FIRST so
v3.4 branched off clean master. **(2) The run — NO LANDING ($0.8163;
278,234 in / 12,067 out; 14 model calls; 84.8s; 0 write_backs; 4
guarded ops / 0 raw splices; cited_hashes EMPTY; porcelain CLEAN):**
the run reached E3 cleanly and held the citable hash. **The
safeguards CLOSED the Session 53 classes — none recurred** (no
duplicate inserts; the test anchored on the correct unique `it(...)`;
staging errors correctly treated as FIXABLE with revert-and-re-stage,
no R2 over-trigger). **But a NEW editing-execution class surfaced:**
the run BATCHED multiple guarded `insert_lines` in ONE cell using
pre-staging line numbers (insert_a at line 155, insert_b at line 209
in the same cell); staging insert_a's 13-line block shifted every
later line, so insert_b's `anchor_before='  }\r'` at the now-stale
line 209 hit the wrong line → `AnchorMismatchError` (×11). The guarded
family behaved EXACTLY per contract (a mismatched anchor stages
nothing, teaches re-derivation); the run kept re-batching with stale
addresses, consumed 14 of 16 iterations without one verified edit,
and R2'd. The "one insert per cell, re-locate between" rule
(unchanged since v3.2) was NOT obeyed. **(3) Criterion — NO LANDING:**
guarded-only PASS (`raw_splices` 0), spend PASS ($0.8163); evidence
contract NOT MET (zero insights); item 5 (pins green) NOT REACHED (no
write_back). No machinery defect — every layer fired per contract.
**(4) Cleanup: NONE OWED** — the R2 path wrote nothing;
`DERIVED_INSIGHT` stays 298; the edgeless `mcpcredentialenv` orphan
preserved (guardrail 2); `npm test` stays 876/87. **(5) THE PATTERN
+ THE ESCALATION (§5g.3 third-strike ACTIVE):** T2 has now had THREE
no-landings, each a DISTINCT editing-execution sub-failure that the
prior task-text fix did NOT prevent recurring in a new form (§5i.6
mis-written test pin → §5i.7 duplicate inserts + wrong-describe
anchor + R2 over-trigger → §5i.8 stale line addresses from batched
inserts) — the exact signal the owner doctrine names (close
behavioral failure classes by TOOLING SHAPE, not prompt text) and the
S48 §5h.8 escalation rule anticipated. **The owner picked TOOLING
SHAPE** over one-more-prompt / pause: close the class in the guarded
editing toolkit per CODE_MEDIATED_TEXT doctrine (the model never
counts; the engine computes addresses) — an engine-resolved-anchor
insert (the model passes a UNIQUE anchor substring; the engine finds
the line, computes the exact address + terminator; non-unique/absent
= typed refusal) and/or a batch/transaction insert that re-resolves
addresses internally. T2 is PAUSED pending the tooling increment
(preserved in Appendix A; EL-02 is the active §3 objective). **(6)
Bookkeeping:** Session 49
compressed to the digest, its §5 entry moved verbatim to the archive
(window now 50–54); the roadmap row-13 cell + §5 entry updated; §5i.8
completes the increment record.

OpenCnid selected the MIT License on July 6, 2026.

**Session 56 (July 14, 2026, `implement-el02-control-kernel`) completed EL-02
deterministic acceptance and was owner-ratified, zero-model and
zero-paid.** The TypeScript reference kernel under `tools/engineering-loop/`
implements all 28 owned requirements: strict versioned schemas; the exhaustive
41-allowed/91-forbidden transition matrix; controller-origin evidence and
approval refusals; protected external state and an exclusive writer lock;
integrity-linked event-first storage, atomic snapshots, replay, and corruption
stop; stable intent/outcome/idempotency recovery; and injected fake clock,
repository, runner, and effect dependencies. All 14 durable crash points
reconstruct the uninterrupted logical oracle without a duplicate completed
effect. Acceptance passed 40 tool tests and 916 repository tests across 92
files, plus build, Python, Compose, schema/catalog, linkage, and diff checks.
No model call, paid work, dependency, production prompt, product source, real
runner, Git observer, or renderer entered. Session 51 moved verbatim to the
archive; the live window is 52–56. The owner reviewed the complete diff and
explicitly authorized commit, merge, and push to `master`.

**Session 57 (July 14, 2026, `implement-el03-repository-observer`) completed
EL-03 deterministic acceptance and was owner-ratified, zero-model and
zero-paid.** All 12 EL-03 requirements have concrete source and
deterministic-test linkage. The controller now computes Git/worktree identity
and complete NUL-delimited changed paths; refuses segment-scope and
between-check divergence; runs bounded shell-free argv; retains full output as
protected digest-addressed artifacts linked to controller evidence; derives
strict reports from trusted state; and renders pure, byte-pinned report,
status, and handoff-preview bytes. Focused acceptance passed 64 tests across 5
files; repository acceptance passed 977 tests across 96 files, plus build,
Python, Compose, schema/catalog, SPEC linkage, and diff checks. The remote URL
normalization defect found by the first focused run was fixed and pinned. The
owner reviewed the complete diff and explicitly authorized commit, merge, and
push to `master`. Manual `HANDOFF.md` remains authoritative.

**Session 58 (July 14, 2026, `implement-el04-prompt-compiler`) completed EL-04
deterministic acceptance and was owner-ratified, zero-model and zero-paid.**
All seven EL-04 prompt requirements have concrete source and deterministic-test
linkage. Four invariant role assets normalize to UTF-8/LF, carry version and
SHA-256 pins, and compile ahead of six separately bounded typed context
collections. Strict schemas and static scans refuse unknown fields,
role/identity mismatch, unlinked references, sensitive material,
contamination, and byte-budget overflow; role output remains advisory and
cannot create controller authority. Focused acceptance passed 60 tests across
3 files; repository acceptance passed 1,032 tests across 98 files, plus build,
Python, Compose, schema/catalog, and diff checks. The owner accepted the feature
and merged PR #104 as `e1ee564923c9c02f532e08f1a5561d9837a7493a`.
Manual `HANDOFF.md` remains authoritative.

**Session 59 (July 14–15, 2026, `implement-el05-codex-runner`) completed EL-05
deterministic acceptance and was owner-ratified, zero-model and zero-paid.**
All 15 EL-05 requirements have concrete source and deterministic-
test linkage. The stable versioned `AgentRunner` contract covers start, resume,
interrupt, observe, and dispose; `FakeRunner` remains the zero-effect oracle.
The sole Codex boundary pins JSONL v2 / `codex-cli 0.144.2`, translates wire
messages into bounded ordered redacted observations, and produces exactly one
terminal report per attempt. Stable correlations span workflow through turn.
The pure episode policy resumes only unchanged current bindings and requires a
fresh episode/thread at every named semantic, repository, protocol, recovery,
checker, or context boundary. Focused acceptance passed 69 tests across 4
files; repository acceptance passed 1,094 tests across 101 files, plus build,
Python, Compose, schema/catalog, and diff checks. The explicit local smoke sent
only `initialize` and `initialized`, then disposed with zero thread/turn
requests. Model completions = 0; paid calls = 0. On July 15, 2026, the owner
reviewed and ratified the closeout and explicitly authorized commit, merge,
and push through the feature-branch pull-request path. Manual `HANDOFF.md`
remains authoritative.

**Session 60 (July 15, 2026, `implement-el06-verification-gates`) completed
EL-06 deterministic implementation and was owner-ratified and accepted,
zero-model and zero-paid.** All 36 EL-06 requirements
map one-for-one to implementation and deterministic tests. Immutable
acceptance definitions drive separate controller-observed argv commands with
exact repository, cwd, environment, timeout, exit, retained-output, and engine-
count bindings; advisory claims cannot upgrade evidence. Protected action
policy validates exact unused human records only through an external channel,
enforces paid limits, and makes automatic push/merge impossible. Pure recovery
classifies the full taxonomy before bounded action and blocks unknown external
effects for signed reconciliation. The checker always starts a fresh read-only,
credential-free, network-free, effect-free episode/thread and remains advisory.
Focused acceptance passed 76 tests across 5 files; repository acceptance passed
1,161 tests across 105 files, plus build, Python, Compose, catalog/schema, and
diff checks. Model completions, paid calls, and real protected effects = 0.
Session 55 moved verbatim to the archive; the live window is 56–60. Manual
`HANDOFF.md` remains authoritative. On July 15, 2026, the owner reviewed and
accepted the closeout and explicitly authorized commit, merge, and push to
`master`.

**Session 63 (July 16, 2026, `implement-el11-approval-reachability`) implemented
engineering-loop `EL-11` and opened PR #114, zero-model and zero-paid; owner
acceptance is not recorded.** Sessions 61 and 62 had activated the controller and
seeded the ledger (see §1.16 and §2); EL-11 closed the write-once defect they
left. The steady-state `acceptance_change` path landed (`recordAcceptanceChange`,
`EL-REQ-BOOT-008`): an owner can now record a status change into a populated
generation, superseding by ordinary replay while the superseded records survive.
The classifier became `admissibleLedgerCeremonies`, returning the set a state
admits — a healthy populated ledger admits both an ordinary change and a content
reconciliation, told apart by protected action and record kind, never by a flag.
The reachable-producer requirement (`EL-REQ-APPROVAL-010`) and its static check
landed with `print-acceptance-request` / `record-acceptance`; `EL-01-A2` was
mechanized (`analyzeConformanceLinkage`); `EL-REQ-APPROVAL-012` got its §18 row and
the `APPROVAL-002` provenance clause was amended in text. 116 declared / 116
mapped, EL-06 and EL-10 row-pins intact; catalog 12 features; `npm test` 1,239
across 110. **EL-11 also found that both EL-10 recovery ceremonies have no non-test
caller** — under the new `EL-REQ-APPROVAL-010` that is EL-10 failing acceptance as
unreachable, reported and pinned rather than routed around, and it is the next
objective. PR #114 is open against `master`, not merged; the acceptance ledger is
byte-identical to preflight.

**Session 65 (July 16, 2026, branch `claude/sister-lab-repo-review-5fuu19`,
PR #119) — the sister-lab collaboration session: external review, the
epistemic-support program, and the first support drill.** The sister
lab's five-paper review series landed under `docs/review/`. The
epistemic-support program was proposed, owner-ruled, and partially
implemented: `docs/architecture/EPISTEMIC_SUPPORT.md` is ADOPTED forward
design (owner ruling July 16) — a second belief axis, orthogonal to
custody: (b, d, u) opinions computed sweep-side from judged events,
writer-blind, support never minting custody; plane geometry bounded
(custody / support / deferred claim-kind); normative v1 arithmetic and
metric grammar drill-pinned. Working documents:
`docs/product/epistemic-support/` (PROGRAM_CONTEXT.md is the entry;
research map with 9 sources / 27 claims / adoption bounds AB-1…AB-11;
FOUR_JUDGE_DESIGN.md; JUDGE_CONTRACT_TEMPLATE.md;
COMPOSABLE_RUBRICS_DESIGN.md; ORACLE_DRILL_PROPOSAL.md). The
support-computation oracle drill was AUTHORIZED and IMPLEMENTED
(`npm run test:support-oracle`: 7 sections / 106 checks green;
`--negative-control` exits 3 on detecting the committed broken oracle;
`--inject corrupt-expected` passes by detection; pure modules
`src/core/graph/support.ts` + `support_metrics.ts`; 11 vitest pins;
fixtures byte-pinned with an independent generator). AB-4 was AMENDED by
owner ruling (model labeling of anchors permitted; fixtures pinned once
labeled; refresh stays a human ceremony). Three primary papers were
mirrored under OpenCnid repos, checksum-verified, and read in full: S1
`who-grades-the-grader-pdf`, S8 `verbalizable-global-workspace-pdf`, S9
`better-harnesses-smaller-models-pdf`. Purpose framing (owner
direction): Trellis = RLM depth × the best, most adaptive harness (S9),
with uncertainty-around-facts managed by the adaptive four-judge layer.
Session commits carry the sister lab's session-trailer convention — a
DISCLOSED conflict with hard rule 10, for the owner to rule on at merge.

Your objective is **Session 66: the four-judge system — reconcile the
two designs, then pin the panel's structural guarantees.** §3 carries
the objective. (Owner re-sequencing, July 16, 2026: the
epistemic-support program takes the active objective; the engineering-
loop Session 64 objective — recovery-ceremony reachability — is
preserved verbatim in Appendix B and remains that track's next work.)


**Owner direction, July 14, 2026:** the engineering-session loop remains
prioritized ahead of the paused TTT tooling-shape objective. `EL-00` through
`EL-06` are owner-accepted; `EL-10` and `EL-11` are implemented with owner
acceptance not recorded for either; `EL-07` is blocked pending an owner unblock.
The merged Session 54 tooling-shape objective is preserved in Appendix A and
remains paused unless the owner re-prioritizes it.


**Owner re-sequencing, July 16, 2026:** the epistemic-support program
(this handoff's §3) takes the active session objective ahead of the
engineering-loop track. EL-10/EL-11 acceptance and the Session-64
reachability objective (Appendix B) remain the engineering-loop track's
next work, unchanged in content; nothing in the program touches
controller state or claims EL progress.

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
     `docs/architecture/RLM_HARNESS_SCAFFOLDING.md` — its §7 carries
     the PENDING S2a UPSUM refinement proposal, PR #96, owner
     decision):** the model
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
     6183de3a…ed50`; the omit-arm pin is `34b00be6…d02a`
     (Session 51 S2a UPSUM refinement; `test:modules` [4]/[7]
     re-prove the structural relationship every run). Module #1 (`workspace-discipline`) is at version 2. Module
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

16. **Engineering-session loop (owner-prioritized July 14, 2026).** The manual
    `HANDOFF.md` cycle is an explicit multi-session program. Its bounded feature
    DAG and bootstrap protocol live in `docs/product/engineering-loop/ROADMAP.md`
    with the machine twin `features.json`; `tools/engineering-loop/SPEC.md` is
    normative. The controller is out of process, one-writer, and protected
    outside the worktree. EL-02 supplies strict domain validation, exhaustive
    transition authority, locking, event-first snapshots/replay, and fake
    idempotent effects. EL-03 supplies controller-computed repository identity,
    complete changed paths, scope and divergence refusal, bounded shell-free
    command evidence, and pure byte-pinned status/handoff previews. EL-04
    supplies invariant role assets and strict prompt contracts. EL-05 supplies
    the adapter-neutral runner boundary and pinned Codex adapter. EL-06 supplies
    immutable acceptance definitions, controller-observed verification, exact
    external approval policy, bounded recovery, and a fresh least-privilege
    checker.

    **EL-10 activated the controller (Session 62).** It runs as a real process:
    `npm run el:activate` resolves the acceptance-ledger root, workflow state
    root, worktree, and approval channel from explicit configuration, refuses
    contained/aliased/symlink-reachable roots, and reports any path that resolves
    somewhere other than configured. The **acceptance ledger**
    (`acceptance_ledger.ts`) is program-scoped in its own protected root,
    append-only, monotonically sequenced, integrity-linked, `actor` pinned to
    `human` — a new artifact because `StateSnapshotSchema` is single-feature and
    nothing in workflow state could express which features are accepted. Status
    resolves from it and from nowhere else: the catalog carries immutable
    definitions only, and `feature.schema.json` refuses `bootstrapStatus` and
    pins `statusAuthority` as a `const`. Seeding is one owner-approved
    `acceptance_change` over enumerated `(feature, status)` pairs, once-only,
    all-or-nothing, with consumption derived from replay. Two **recovery
    ceremonies** have disjoint predicates re-derived every run: content
    corruption on a validating chain appends a signed reconciliation;
    integrity-chain corruption recovers only by out-of-band re-genesis, because a
    successor's `previousDigest` would inherit or mask the break. Building a
    synthetic workflow history to reach `accepted` is forbidden — it would forge
    controller-attested events as the trust store's first entry.

    **The lesson that generalizes:** 1,161 passing tests established that the
    kernel was correct, never that it was reachable, and no test could fail
    because none asserted a non-test caller existed. `statusAuthority` rotted four
    features past its stated end for the same reason: prose, no requirement, no
    row, no failing test. Prefer a predicate the check re-derives every run over a
    flag someone must remember to clear, and falsify every new guard — revert the
    fix and watch it go red — before trusting it.

    **EL-11 gave the ledger its steady-state write path and closed the gate's
    mapping and reachability gaps (Session 63).** The ledger shipped write-once —
    seeding refuses a non-empty generation and the only other gated writes were
    the two corruption ceremonies — so no status could ever change.
    `recordAcceptanceChange` (`acceptance_change.ts`, `EL-REQ-BOOT-008`) appends an
    owner-approved `acceptance_change` to a non-empty validating generation,
    superseding by ordinary replay while the superseded records stay present and
    integrity-linked; it shares `buildAcceptanceRecordChain` with seeding because
    SPEC §6.1 holds that seeding is that path applied to an empty ledger.
    `classifyLedgerGeneration` became `admissibleLedgerCeremonies`, returning the
    SET of ceremonies a state admits: a healthy populated ledger admits both an
    ordinary change and a content reconciliation, separated by protected action and
    record kind, never by state and never by a mode flag — the three SPEC §6.1
    predicates stay disjoint and total. `print-acceptance-request` /
    `record-acceptance` make the path reachable, per `EL-REQ-APPROVAL-010`: a
    protected action whose computed material has no reachable producer fails
    acceptance as unreachable. Two static checks in `conformance.ts` mechanize
    invariants that had only been prose — `analyzeConformanceLinkage` (`EL-01-A2`:
    every declared requirement carries a §18 row) and `analyzeProducerReachability`
    (every computed-material producer resolves a non-test caller, derived from the
    import graph). The second **pins a live defect**: both EL-10 recovery ceremonies
    have no non-test caller, so EL-10 fails acceptance as unreachable until they are
    wired — the next objective.

### 1.17 Epistemic support and the adaptive-harness purpose frame (July 16, 2026)

- **The purpose frame (owner-designated):** Trellis's aim is to combine
  the depth of an RLM with the best, most adaptive harness
  (arXiv:2607.08938 — S9 in the program register, primary-verified:
  task difficulty shared across instances lifts from the model into the
  harness; adaptations are discoverable automatically from failure
  trajectories; 16/21 task–SLM pairs improved, best SLM at 89.7% of LLM
  performance for 4% of cost; adaptation pays most on repetitive
  workflows, Spearman ρ = −0.96). Trellis's existing doctrines are the
  trust half of that thesis — tooling shape (hard rule 8),
  externalization (CODE_MEDIATED_TEXT), capability-as-belief — and the
  epistemic-support program adds the managed-uncertainty half.
- **Epistemic support (ADOPTED forward design):**
  `docs/architecture/EPISTEMIC_SUPPORT.md`. A second belief axis,
  orthogonal to custody: (b, d, u) opinions computed sweep-side from
  judged drawback-detector events; abstention feeds uncertainty only;
  writer confidence structurally excluded; support never mints custody;
  the writer never sees it. v1 arithmetic and the metric grammar with
  its fail-closed validity gate are normative and drill-pinned
  (`npm run test:support-oracle`; enforcement/pin table in that record
  §7). Only the drill is implemented; sweep integration, judges,
  registration, and the ratification queue are each separately gated.
- **The judge layer (PROPOSED, reconciliation pending):** four
  differently-blind roles — grounding, coherence, corroboration, and an
  audit role that judges judges, never beliefs, and can only contest a
  judge as a capability. `docs/product/epistemic-support/` is the
  program home; PROGRAM_CONTEXT.md orients a fresh session; the
  adoption-bounds register (RESEARCH_MAP §9, AB-1…AB-11) binds all
  program work and is amended only by dated entry.


## 2. Current baseline

Repository state at handoff creation:

- **Program and Git:** at handoff regeneration (July 16, 2026)
  `origin/master` is `841f875` (EL-11 merged, PR #114). The active work
  is branch `claude/sister-lab-repo-review-5fuu19` (PR #119, open, not
  merged): the review series, the epistemic-support program, the
  adopted `docs/architecture/EPISTEMIC_SUPPORT.md`, and the implemented
  support-oracle drill all live there. Observe actual Git state rather
  than assuming merge status either way.
- **The controller runs.** `npm run el:activate` and
  `tsx tools/engineering-loop/src/activate.ts` are real non-test callers, with
  `check`, `status`, `print-seed-request`, and `seed` commands. This closes the
  finding that created EL-10: EL-02 through EL-06 were a correct, thoroughly
  tested, entirely **inert** library, and 1,161 passing tests spoke only to
  correctness, never to reachability.
- **Status lives in the acceptance ledger, not in Git.** The owner affirmed the
  eleven `(feature, status)` pairs and the activation run seeded generation 0
  against clean `master`: eleven records, chain valid, approval consumed,
  re-seeding refused. `statusAuthority` is `protected_controller_state` and
  `bootstrapStatus` has left the catalog and `feature.schema.json`, which now
  **refuses** the drift rather than merely not exercising it. Read status with
  `npm run el:activate -- status`; prose restating it is convenience, never
  authority.
- **Protected roots:** `D:\trellis-protected\engineering-loop\{ledger,state,channel}`.
  **Do not place a protected root under a per-user application-data directory.**
  A containerized host (MSIX here, also Flatpak, Snap, the macOS app sandbox)
  silently redirects `%LOCALAPPDATA%` writes into a private package cache, so the
  same configuration names a different directory for a contained process than for
  your shell — the owner would issue approval into a channel the controller never
  reads and both sides would see a coherent, empty, disagreeing ledger.
  `check` and `status` report any such redirect under `redirects`; compare it
  against what you configured.
- **Conformance:** SPEC declares **116** requirements and maps **116**, zero
  unmapped — EL-11 gave `EL-REQ-APPROVAL-012` its row and mechanized `EL-01-A2`.
  `EL-10` owns exactly the seven `EL-REQ-BOOT-*` rows; `EL-06` stays 36; `EL-11`
  owns three (`EL-REQ-BOOT-008`, `EL-REQ-APPROVAL-010`, `EL-REQ-APPROVAL-012`).
- **Acceptance baseline:** `npm test` passes **1,250 tests across 111
  files** on the program branch (1,239/110 at EL-11 plus Session 65's
  11 support pins). The focused engineering-loop command passes **363
  tests across 23 files**. Draft 2020-12 catalog validation reports
  **12 features**. Build, Python, Compose, and diff checks pass. The
  full suite is **flaky under file parallelism on Windows**
  (`ENOTEMPTY`/timeout on temp-dir cleanup); verified pre-existing by
  stashing and running clean `HEAD`. Separately, in the sister-lab
  review container the four `tools/engineering-loop` test files fail
  **28 tests on protected-state-root permission checks** — verified
  pre-existing on the unmodified baseline there (root user + 0022
  umask environment artifact), unrelated to any Session 65 change. Use
  `--no-file-parallelism` where needed and say which you ran.
- **Support-drill baseline (Session 65):** `npm run test:support-oracle`
  → 7 sections / 106 checks green; `--negative-control` exits 3 naming
  `support-oracle:003`; fixtures byte-pinned under
  `fixtures/support_oracle/` with an independent generator.
- **EL-10 and EL-11 acceptance is not recorded.** Both are implemented; neither
  is accepted. `next_feature` resolves to `EL-10` until the owner records
  acceptance, and to `null` in the interval before EL-07 is unblocked — both
  correct, neither a defect. EL-11's reachability check pins a live blocker on
  EL-10 acceptance: both EL-10 recovery ceremonies have no non-test caller, so
  under `EL-REQ-APPROVAL-010` EL-10 fails acceptance as unreachable until they are
  wired — this session's objective.
- **Authority:** manual `HANDOFF.md` remains authoritative. Approval reduces to
  the owner's authenticated, scope-bound decision, not to who performs its
  transport; the controller may author the request and execute the transport, and
  may never originate the approval.

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

Work on one feature branch and target `master`.

## 3. Session 66 problem statement

<feature_objective>

**Epistemic-support program: reconcile the four-judge designs and pin
the panel's structural guarantees, zero-paid.**
`docs/product/epistemic-support/FOUR_JUDGE_DESIGN.md` was architected
from the program's evidence register WITHOUT sight of the
collaborator's independently evaluated four-judge system (its §10.1
reconciliation flag is real and unresolved). Separately, the panel's
three structural guarantees — role blindness is structural, the audit
role cannot gate, a contested judge cannot compose — are designed with
enforcement homes and pins named (that record §6) but not implemented.
A design whose guarantees exist only in prose is exactly what hard
rule 8 and rule 15 warn about.

</feature_objective>

Two deliverables, in order:

1. **The reconciliation record.** Obtain the collaborator's four-judge
   role definitions; map each role onto the §3 blindness profiles;
   record every delta as a dated amendment to FOUR_JUDGE_DESIGN.md
   (never a silent rewrite); the owner ratifies the merged design. If
   the collaborator's definitions cannot be obtained this session,
   record the item OPEN with the reason and proceed — the drills below
   pin the current design and re-pin cheaply after any merge.
2. **The three panel drills** (FOUR_JUDGE_DESIGN §7, all zero-paid,
   scripted verdicts only, no model calls anywhere): the
   panel-composition oracle extension, the blindness drill
   (context-assembly refusals fire before any model-call boundary),
   and the judge-contest drill (a scripted audit finding contests the
   judge entity; composition refuses it; recovery is human).

## 4. Required design

- **Reconciliation protocol:** a `RECONCILIATION.md` (or a dated §10.1
  amendment block in FOUR_JUDGE_DESIGN.md — prefer the amendment if it
  stays under a page) mapping collaborator-role → §3-role → verdict
  (adopt / merge / diverge-recorded), each divergence carrying its
  falsifier. Owner ratification is a recorded decision, not an
  inference.
- **Drill shape:** a sibling script `scripts/test_judge_panel.ts` with
  package script `test:judge-panel` (the non-test entrypoint, rule 15),
  in the `test_support_oracle.ts` mold: fixture manifest SHA refusal
  first, sections with named findings, a deliberately broken negative
  control per drill, counts-only output, `TRELLIS_EXP_*` refusal.
  Fixtures under `fixtures/judge_panel/` with an independent
  expected-values generator (no imports from the modules under test).
- **Blindness as data:** per-role context assembly is a pure function
  whose input allowlist comes from the role's declared `inputs`; the
  drill feeds each role one forbidden input and asserts a typed refusal
  BEFORE any would-be model boundary.
- **J4-never-gates as structure:** the audit module exports no symbol
  the composition path imports; pin with a static import check (the
  drill's `[static-imports]` pattern) plus a scripted attempt that must
  find no route from an audit verdict to any opinion.
- **Judge-contest without infrastructure:** model the
  register→contest→refuse→re-register cycle over the pure manifest
  structures if possible; if graph seeding is genuinely required, gate
  that section on the Compose stack the way `test:module-lifecycle`
  does and say so in the drill header.
- **Model-coupling (R-27):** judge manifests carry the target model
  identity in their evidentiary basis so a model migration contests
  them; the drill asserts the field is required.

## 5. File-level starting points

- `docs/product/epistemic-support/FOUR_JUDGE_DESIGN.md` §3 (roles),
  §6 (enforcement→pin table this session implements), §7 (drills),
  §10.1 (reconciliation).
- `docs/product/epistemic-support/JUDGE_CONTRACT_TEMPLATE.md` (verdict
  schema and taxonomies the fixtures instantiate).
- `docs/architecture/EPISTEMIC_SUPPORT.md` §5, §7.
- `src/core/graph/support.ts`, `support_metrics.ts` (consumed, not
  modified); `scripts/test_support_oracle.ts` (the drill mold);
  `fixtures/support_oracle/` (the fixture mold).
- `scripts/register_modules.ts`, `scripts/test_module_lifecycle.ts`
  (the capability-contest pattern to retarget).
- `docs/product/epistemic-support/RESEARCH_MAP.md` §9 (adoption
  bounds; amend only by dated entry).

## 6. Test strategy and acceptance

Offline (no Docker, no API key):

    npm test            # baseline 1,250 across 111 files + this session's pins
    npm run build
    npm run python:check
    npm run test:support-oracle            # stays green, 7 sections / 106 checks
    npm run test:judge-panel               # new: all sections green
    npm run test:judge-panel -- --negative-control   # must exit nonzero, named finding

Acceptance items (each observed, not asserted):

1. Blindness: every (role, forbidden-input) pair in the fixture is
   refused with a typed error naming role and input; zero refusals
   missing.
2. J4 isolation: the static check finds no import path from the audit
   module into composition; the scripted route-attempt section finds no
   effect of any audit verdict on any opinion.
3. Judge-contest: contested judge refused from composition with a
   typed error; re-registration (the human recovery analog) restores
   composition; the superseded contest record survives.
4. Reconciliation: either the ratified merged design (dated amendments
   + owner decision recorded) or an explicit OPEN entry with reason.
5. `git diff --check` clean; docs cross-references resolve; roadmap §5
   entry + this file regenerated per §0 in the same PR.

## 7. Guardrails

1. **Permanent invariants survive** (hard rules: AST immutability,
   provenance write path, Zod boundaries, process split). The
   no-AI-attribution rule stands with the disclosed session-trailer
   conflict — flag, never hide; owner rules at merge.
2. **The adoption-bounds register binds** (RESEARCH_MAP §9): writer
   never sees support or judge outputs; no count-shaped incentives
   anywhere (AB-5); no evolution/search machinery (AB-8); audit never
   gates (AB-9); live blocks only (AB-11); anchors byte-pinned, model
   labels permitted per amended AB-4.
3. **Zero-paid session.** No LLM call anywhere; the per-role anchor
   calibration is a separate owner-gated proposal with a printed
   estimate under the $5/run cap.
4. **Prompt protocol** (guardrail-11 pattern): read the
   Prompt-Engineering and Hypershot protocols before authoring any
   prompt-like artifact; if unavailable, JUDGE_CONTRACT_TEMPLATE.md
   §6–§7 carries the distilled binding rules.
5. **Documents lead.** Any deviation from FOUR_JUDGE_DESIGN.md lands
   as a dated amendment in the same commit as the code it governs.
6. **Engineering-loop surfaces untouched:** no controller state, no
   `tools/engineering-loop/` changes, no EL acceptance or unblock —
   Appendix B is preserved, not executed.
7. **Correct is not reachable** (rule 15): every drill names its
   package-script entrypoint; every guarantee names its non-test
   enforcement home.

## 8. Explicit exclusions

Do **not**:

- run paid work or any repository model completion;
- implement live judges, the `support_sweep` job, judge registration
  against real databases (unless the Compose-gated contest section is
  explicitly chosen and labeled), the ratification queue, or the
  claim-kind plane;
- build any automated harness-adaptation/optimizer machinery (S9's
  loop enters, if ever, behind AB-8 and its own proposal);
- vendor S9's released code (`github.com/malusamayo/migration-analysis`
  — license unverified, acquisition not owner-approved);
- execute the approved S1/S8 promotions here (they await a durable
  deployment; this container's databases are ephemeral);
- modify the write path, custody tiers, kernel prompts, extraction
  prompts, module addenda, or any composed-prompt pin;
- touch `tools/engineering-loop/`, the acceptance ledger, or claim any
  EL-07/EL-10/EL-11 progress;
- add glossary terms beyond the four adopted ones, or turn any
  hypothesis (R-14's subjective-logic source is still missing) into
  canonical prose;
- resolve the reconciliation's divergences silently in either design's
  favor.


## Appendix A. Paused tooling-shape objective inherited from the pre-reconciliation Session 55 handoff — retained for history, do not execute

This objective is preserved from the merged Session 54 handoff. It is not
active while the owner-prioritized engineering-loop program proceeds. The
imperative text below is historical and requires a new owner
reprioritization before execution.


**The TOOLING-SHAPE increment for the guarded editing family: an
ENGINE-RESOLVED-ANCHOR guarded insert in `src/rlm/trellis_textedit.py`,
human-authored, ZERO-PAID, design-record-first.** This is the owner's
§5g.3 third-strike decision (roadmap §4 row 13). T2 (`buildAgentEnv`
forward/strip) had THREE no-landings, each a DISTINCT
editing-execution sub-failure that a task-text patch closed only to
surface a new one:

- **§5i.6 (Session 52):** a SPEC-PERFECT production diff, FAILED by a
  mis-written test pin (fixed in v3.3).
- **§5i.7 (Session 53):** a clean R2 self-refusal — duplicate inserts
  + a wrong-describe test anchor + an R2 over-trigger (all three fixed
  in v3.4).
- **§5i.8 (Session 54):** a clean R2 self-refusal — the run BATCHED
  guarded `insert_lines` in ONE cell using pre-staging line numbers, so
  staging the first insert shifted the file and every later insert's
  `anchor_before` hit the wrong line → `AnchorMismatchError` (×11); no
  verified edit in 14/16 iterations.

The pattern is the owner doctrine's exact trigger — close behavioral
failure classes by TOOLING SHAPE, not prompt text — and the S48 §5h.8
escalation rule (recurrence closes by tooling shape). The two things
the model keeps getting wrong are COMPUTING a line number that shifts
after each staged insert and BYTE-MATCHING an anchor including its
`\r`. Both are exactly what CODE_MEDIATED_TEXT doctrine (§14/guardrail
14) says the ENGINE must do, not the model. The facts a new session
must act on:

- **What to build (the design record decides the final shape):** a new
  GUARDED method — working name `insert_after_anchor` — on
  `TrellisTextEdit` (`src/rlm/trellis_textedit.py`), beside the
  Session 41 family. Contract: the caller passes a UNIQUE anchor
  SUBSTRING and the new lines (no line number, no `\r`); the engine
  scans the working frame for lines CONTAINING that substring, and:
  - EXACTLY ONE match → compute the 0-based insertion address (after
    that line) and the frame's own terminator, stage the insert
    through the SAME staging/containment/budget/`write_back` machinery
    the guarded family uses, and count it in `textedit_guarded_ops`;
  - ZERO or MORE-THAN-ONE match → a typed refusal (the
    `AnchorMismatchError` mold — a real exception with a bounded
    message naming the match count and the anchor), staging NOTHING.
  The uniqueness requirement IS the safety: it removes the ambiguous
  bare-`});` failure (§5i.7) and the stale-line-number failure (§5i.8)
  by construction. An `insert_before_anchor` twin and/or a
  BATCH/transaction variant (a list of `(unique_anchor, new_lines)`
  applied in ONE engine pass, re-resolving each anchor AFTER prior
  inserts stage so post-insert drift is the engine's concern) are
  design-record options — decide one-method-vs-two-vs-batch in the
  record, do not gold-plate.
- **Hard scope (guardrail 5 / the Session 41 record):** ADDITIVE only.
  Raw `splice` and the existing guarded family
  (`replace_lines`/`insert_lines`/`delete_lines`) stay byte-identical;
  every Session 41 pin (`test:textedit` [14], `test:selfedit-harness`
  [8], the five-counter telemetry pin) holds unchanged. The new method
  reuses the existing staging list, the containment `_resolve`, the
  file/byte budgets, and the hash-guarded `write_back`; it never
  touches git, never becomes a write gate, never gains provenance
  standing, and its telemetry joins `textedit_guarded_ops` (no new
  counter unless the record justifies one, counts-only).
- **Design record FIRST (spec-before-pen — the Session 38/41 mold):**
  extend `docs/architecture/STRUCTURAL_SPLICE.md` (it recorded the
  parser-free anchor-guard decision and a revisit trigger) with a new
  section: the method contract, the uniqueness/refusal semantics, the
  terminator rule (works on BOTH CRLF and LF frames), the
  one-method-vs-batch decision and its reason, and the honest-scope
  note (this removes model line-number/terminator errors; it does NOT
  make the model choose good anchors — a non-unique anchor still
  refuses, which is correct). No code byte until the record is written.
- **The addendum + composed-prompt pins (a WITTING kernel change):**
  the gated guarded-family addendum in `trellis_agent.py`
  (`_ADDENDUM_...`, injected only when the toolkit is present) teaches
  the family; teaching the new method extends the addendum, so BOTH
  composed-prompt pins MOVE — recompute the default and omit-arm SHAs
  in the SAME commit (`scripts/test_modules.py` histories appended;
  `test:modules` [4]/[7] green). **HARD REQUIREMENT (Guardrail 15):
  before writing the addendum bytes, INVOKE both `prompt-engineering`
  and `hypershot-protocol` via the Skill tool and author against their
  guidance** (the addendum is brace-free — `.format()` runs over it;
  no literal `{}`; a brace-bearing hypershot frame would break it, so
  the prose description is the forced correct choice, recorded).
- **Pins (the increment's own):** a new `test:textedit` section —
  engine resolves a unique anchor to the correct address and inserts
  byte-exactly; a NON-UNIQUE anchor refuses with the typed message and
  stages nothing; an ABSENT anchor refuses; terminator handling
  verified on BOTH a CRLF fixture and an LF fixture; containment /
  over-file-cap / budget refusals unchanged; the batch variant (if
  built) re-resolves addresses across staged inserts. If the guarded
  rehearsal arm uses the new method, a `test:selfedit-harness` section
  too. `npm run python:check` covers the module.
- **The re-attempt T2 is a SEPARATE later owner-approved PAID
  proposal, NOT this session.** Once the tooling lands, a v4 task text
  instructs the model to use the engine-resolved-anchor insert
  (removing the line-number/`\r` burden entirely) and MEASURES whether
  the tooling actually closes the editing-execution class — the true
  acceptance for a tooling intervention
  (`[[feedback-tooling-over-prompt-modules]]`: measurement harnesses
  are acceptance). This session builds and pins the tool; it makes NO
  behavior claim about the RLM until that measured re-attempt runs.
- **The gate:** this increment is ZERO-PAID (design + code + drills +
  pin recompute), so it needs no per-run spend approval; it lands a
  human PR to `master` like any code change. The T2 re-attempt is the
  owner-gated paid step, proposed separately with an estimate.

### Appendix A.1. Paused required design

- **Pre-flight (zero-paid):** confirm the Session 54 PR merged
  (`git log -- HANDOFF.md`); `npm ci`; `npm test` (876/87 expected);
  `npm run build`; `npm run python:check`. Read `STRUCTURAL_SPLICE.md`
  (the Session 41 record — the guarded family's contract and the
  recorded revisit trigger), `src/rlm/trellis_textedit.py` (the guarded
  family + the staging/containment/budget/`write_back` machinery the
  new method reuses), the guarded-family addendum in `trellis_agent.py`,
  and `REPOSITORY_INGESTION_REPORT.md` §5i.6/§5i.7/§5i.8 (the three
  editing-execution sub-failures this tool closes — §5i.8's batched
  stale-address failure is the direct motivation).
- **Design record first:** write the `STRUCTURAL_SPLICE.md` section
  (the method contract, uniqueness/refusal semantics, terminator rule,
  one-method-vs-batch decision, honest scope) BEFORE any code byte.
- **Implement additively in `trellis_textedit.py`:** the new guarded
  method reusing the existing machinery; a non-unique or absent anchor
  raises the typed refusal (the `AnchorMismatchError` mold) and stages
  nothing; the engine computes the address AND terminator from the
  frame. Do NOT touch `splice` or the existing guarded methods.
- **Addendum (Guardrail 15 FIRST):** invoke both prompt skills, then
  extend the gated guarded-family addendum to teach the new method;
  recompute BOTH composed-prompt pins in the same commit.
- **Pins:** the new `test:textedit` section (unique-resolve, refusals,
  CRLF + LF terminators, containment/budget unchanged) + the harness
  section if used; recompute the `test:modules` pins; `python:check`.
- **What does NOT change:** `splice` and every existing guarded method
  (byte-identical, pins hold); the write gate / provenance layers; the
  scaffolds (`citable`/frame helpers/`trellis_task`); the config
  surface; `rlm_job.ts`/`rlm_job.test.ts` (T2's target, untouched this
  session); the embedder; any experiment flag.
- **Failure handling:** if the design surfaces a reason the
  engine-resolved anchor cannot be built additively (an unexpected
  coupling in the staging machinery), STOP and record it in the design
  record as an owner-visible finding — do not force it or weaken a
  Session 41 pin.

### Appendix A.2. Paused file-level starting points

- `docs/architecture/STRUCTURAL_SPLICE.md` — the Session 41 design
  record (the guarded family's contract, the parser-free decision, the
  recorded revisit trigger). Extend it with the new method's section
  FIRST.
- `src/rlm/trellis_textedit.py` — the target: `TrellisTextEdit`, the
  Session 41 guarded family (`replace_lines`/`insert_lines`/
  `delete_lines`), `AnchorMismatchError`, and the shared
  staging/`_resolve` containment/budget/`write_back` machinery the new
  method reuses. ADD beside them; edit none of them.
- `src/rlm/trellis_agent.py` — the gated guarded-family addendum
  (`_ADDENDUM_...`); teaching the new method moves both composed-prompt
  pins.
- `scripts/test_modules.py` — the composed-prompt SHA pins ([4]/[7])
  and their histories; recompute both in the same commit.
- `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md` §5i.6/§5i.7/§5i.8 —
  the three T2 no-landings this tool closes; §5i.8's stale-address
  batched-insert failure is the direct motivation and the acceptance
  target for the later re-attempt.
- `docs/architecture/CODE_MEDIATED_TEXT.md` — the doctrine (the model
  never counts; engine-computed addresses) the new method embodies.
- The `test:textedit` drill and `test:selfedit-harness` rehearsal —
  where the new pins live.

### Appendix A.3. Paused test strategy and acceptance

The expected footprint IS: the `STRUCTURAL_SPLICE.md` section, the new
`trellis_textedit.py` method, the addendum edit + both recomputed
composed-prompt pins, the new `test:textedit`/harness pins, plus this
session's documents (roadmap §5, HANDOFF).

- **Zero-paid (this whole session):** design record written; the new
  method implemented additively; both prompt skills INVOKED before the
  addendum (Guardrail 15); both composed-prompt pins recomputed
  (`test:modules` green); the new pins green; `npm test` GROWS from
  876/87 with zero existing tests changed; the FULL standing drill
  block run (non-markdown bytes moved).
- **Acceptance for the TOOL:** the pins prove the mechanical contract
  (unique-resolve, typed refusals on non-unique/absent, CRLF + LF
  terminators, existing family byte-identical). NO RLM behavior claim
  attends this session — the tool's behavioral acceptance is the later
  MEASURED T2 re-attempt (guardrail 8: report the tool's contract, not
  a claim the class is "closed for the model" until the paired
  re-attempt shows it).
- **Not this session:** any paid run; the T2 v4 task text and its
  spawn (a separate owner-approved proposal); editing `splice` or the
  existing guarded methods; a T3/T4 byte.

Required close-out (the standing block; non-markdown bytes moved):

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

Update:

- `TRELLIS_ROADMAP.md`: full-dated §5 entry (the design record, the new
  method + its contract, the addendum/pin recompute, the new pins,
  counts); row 13's cell gains the tooling-increment outcome and the
  T2-re-attempt-pending note.
- `docs/architecture/STRUCTURAL_SPLICE.md`: the new method's section.
- `HANDOFF.md`: regenerate per §0 — including the §0 step 5 re-check.
  NOTE for objective selection: if the tooling increment LANDED, the
  default next objective is the **T2 re-attempt (v4 task text using the
  engine-resolved-anchor insert)** — an owner-approved PAID proposal
  presented with an estimate, the MEASURED acceptance of the tooling
  intervention; if the design surfaced a blocker, record it and
  re-propose. The other standing decisions (the stage-1b prose chunk,
  the row-12 rollout continuation, row-11 defect-class increment 3
  whenever a real target surfaces) remain owner alternates. Keep the
  five-session narrative window (51–55 after Session 55): compress
  Session 50 into the digest and move its roadmap §5 entry verbatim to
  `docs/archive/ROADMAP_HISTORY.md` (and update the archive-pointer
  paragraph in the same commit).

### Appendix A.4. Paused guardrails

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
   same-run echo residual stands). Session 52's version: a
   SPEC-PERFECT production diff does not save an increment whose test
   pin is red — item 5 (pins green) is judged on the WHOLE diff, and
   a mis-written test assertion (Session 52's absent-block pin
   compared to the bare base env, missing `buildAgentEnv`'s
   unconditional connection/runtime keys) FAILS the increment as
   surely as a wrong production line; `npm test` is the mechanical
   catch and is never argued away; the reverted diff is never
   resurrected as a patch source (only the pin-(e) fix rides the
   retry). And a spend overrun (Session 52 $1.0888 vs the $0.5–$1.0
   estimate) is a recorded criterion miss even when the engineering
   was otherwise sound — report the actual against the envelope,
   never round it into the estimate. Session 53's version: a clean R2
   self-refusal is a NO LANDING, not a pass and not the same as a
   landed-then-failed increment — report it as such (the run made its
   own editing-execution mistakes, the discipline correctly prevented
   a broken diff, and nothing landed); a self-refusal caused by the
   run's OWN fixable staging slip (a duplicate or misplaced insert) is
   the run's failure to complete, NOT evidence the task is impossible,
   and NOT a machinery defect — the guarded family, citable probe, and
   Session 31 gate all behaved; and a correct-but-UNEXERCISED fix (the
   v3.3 pin-(e) fix that never reached a `write_back`) is never
   reported as validated — it is reported as untested. Two no-landings
   with DIFFERENT causes is exactly that — two no-landings — and the
   §5g.3 third-strike ladder is the owner's to advance, never the
   session's to declare away. Session 54's version: THREE no-landings,
   each a distinct editing-execution sub-failure that a prompt patch
   closed only to surface a new one, is the doctrine's signal to stop
   patching the prompt and close the class by TOOLING SHAPE — and a
   tooling intervention's acceptance is a MEASUREMENT
   (`[[feedback-tooling-over-prompt-modules]]`), so the Session 55
   tool's pins prove its mechanical contract but make NO claim the
   editing-execution class is "closed for the model" until the later
   measured T2 re-attempt shows it; report the tool's contract, never
   an unmeasured behavior claim.
9. Do not break existing consumers: the composed-prompt pins
   (`6183de3a…ed50` default / `34b00be6…d02a` omit-arm since the
   Session 51 S2a UPSUM refinement of the scaffold addendum,
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

### Appendix A.5. Paused exclusions

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
embellishing ANY recorded T1/T2 verdict — the Session 48 T1 FAILURE
(§5h.7–§5h.8), the Session 50 T1 LANDING (§5h.11, its two cosmetic
review notes included), the Session 52 T2 FAILURE (§5i.6 — the
production diff was spec-perfect but a mis-written test pin and a
spend overrun failed it; the diff was reverted), the Session 53 T2
RETRY NO-LANDING (§5i.7 — a clean R2 self-refusal from
editing-execution duplicates + an R2 over-trigger), or the Session 54
T2 RETRY NO-LANDING (§5i.8 — a clean R2 self-refusal from batched
inserts with stale line addresses; nothing landed, nothing to clean;
the v3.3/v3.4 safeguards closed the prior classes but a new one
surfaced — the THIRD strike, and the owner picked TOOLING SHAPE);
resurrecting any reverted T2 diff
(`benchmark_logs/s52_t2_run1_failed.diff`) as a patch source;
**running ANY T2 re-attempt this session — T2 is PAUSED pending the
tooling increment preserved in this appendix; the re-attempt (a v4 task text using the
new engine-resolved-anchor insert) is a SEPARATE later owner-approved
PAID proposal, the MEASURED acceptance of the tooling intervention,
never bundled into the tooling session; and no T2 run happens without
a fresh owner decision — with THREE no-landings the §5g.3 third-strike
is already spent, so a fourth attempt is only the tooling-then-measure
path the owner chose, never a silent prompt retry**;
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
visibility); editing `splice` or any existing guarded method
(`replace_lines`/`insert_lines`/`delete_lines`) while building the
Session 55 engine-resolved-anchor method (it is ADDITIVE — a new
method beside them, reusing the same staging/containment/budget/
`write_back` machinery; the existing methods stay byte-identical and
their pins hold), gold-plating that method beyond the design record's
one-method-vs-batch decision, giving it a new telemetry counter
without the record's justification, making it a write gate, or
letting it touch git; claiming the Session 55 tool "closed" the
editing-execution class for the model on its unit pins alone — the
tool's acceptance is the later MEASURED T2 re-attempt (guardrail 8's
Session 54 version); hand-editing the increment-1 LANDED diff in
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


## Appendix B. Paused engineering-loop Session 64 objective (recovery-ceremony reachability) — displaced by the July 16, 2026 owner re-sequencing; preserved for the engineering-loop track, do not execute in program sessions

*Sections below are the Session 64 §3–§8 preserved verbatim except for
heading demotion (`## N.` → `### Appendix B.N`), exactly the Appendix A
convention. This objective remains the engineering-loop track's next
work.*


### Appendix B.3. Session 64 problem statement

<feature_objective>

**Engineering-loop: make EL-10's two acceptance-ledger recovery ceremonies
reachable, so an owner can run them and EL-10 can be accepted.**

`recoverLedgerContent` and `reGenesisLedger` are implemented, tested, and
correct, and have no caller outside `tests/`. There is no command, no
`package.json` script, and no process entrypoint that invokes either, and
`ledger_recovery.ts` is not imported by `activate.ts` at all. An owner facing a
corrupt ledger has only the hand-edit of the protected file that the paired
ceremonies exist to eliminate, and cannot author matching approval material for a
request digest no producer computes.

EL-11 added `EL-REQ-APPROVAL-010`: a protected action whose authorizing material
has no reachable producer MUST fail acceptance as unreachable. Both ceremonies are
protected actions with computed material and no reachable producer, so under that
requirement **EL-10 currently fails acceptance as unreachable.** Closing this is
the precondition for recording EL-10 accepted, which is the precondition for
EL-07.

In priority order: the `print-recovery-request` / `recover` command pair (content
reconciliation, `EL-REQ-BOOT-006`), then the `print-genesis-request` /
`re-genesis` command pair (`EL-REQ-BOOT-007`), then flip the reachability pin from
two-unreachable to zero, falsified. Paid work is forbidden for the whole feature.
This is deterministic throughout.

</feature_objective>

<invariant_authority priority="highest">

Role: principal systems engineer.

Authority order: code > glossary > prose.

Controller-observed state, commands, and durable evidence outrank runner, checker,
model, conversation, transcript, renderer, and repository-prose reports.

Human authority owns objectives, architecture, acceptance, protected approvals,
paid work, staging, commit, push, merge, and changes to accepted controller
policy.

**Approval reduces to the owner's authenticated, scope-bound decision, not to who
performs its transport** (`EL-REQ-BOOT-002`). The controller MAY author a protected
request in full and MAY execute the approval transport on an authenticated owner
instruction whose scope matches. It MUST NOT synthesize, forge, or default
approval, MUST NOT derive acceptance from workflow state it produced itself, and
MUST NOT treat unauthenticated text as authorization. Refusal cites a failed
provenance or scope predicate, never the absence of a preferred artifact.

Manual `HANDOFF.md` remains authoritative. This feature records no adopt verdict
and changes no handoff authority.

</invariant_authority>

<response_hypershot priority="highest">

Feature: EL-10 recovery-ceremony reachability
Phase: (PREFLIGHT|DESIGN_CHECKPOINT|COMMANDS|REACHABILITY|TESTS|CLOSEOUT)
Result: (READY_FOR_OWNER_REVIEW|BLOCKED)
Summary: {Evidence_Based_Outcome_Stating_Only_What_Engine_Observation_Supports}
Commands: {Ceremony_To_Command_Pair_Mapping_Implemented_And_Verified}
Reachability: {Producer_To_Non_Test_Caller_Before_And_After_With_The_Pin_State}
Falsification: [{New_Or_Flipped_Check_And_The_Observed_Red_That_Proves_It_Can_Fail}]
Verification: [{Exact_Command_And_Engine_Observed_Result}]
Authority findings: {Controller_Human_And_Advisory_Report_Separation}
Git findings: {Worktree_Branch_HEAD_Origin_Master_Changed_Paths_Staged_Committed_State}
Audit findings: [{Bounded_Finding_And_Disposition}]
Outstanding owner acts: [{Act_And_Why_Only_The_Owner_Can_Perform_It}]
Next: {Exact_Next_Gate_And_Explicit_Owner_Actions}

</response_hypershot>

<why_this_feature_exists>

Read this before the design; without it the requirements look like plumbing.

**A trust anchor with no runnable recovery is unrecoverable by its own tooling
once corrupt.** Record §9.9 added the two ceremonies precisely because seeding
refuses a non-empty ledger and repair is forbidden, so a corrupt generation had no
path back but hand-editing the protected file — the untrusted-side write the whole
design exists to prevent. EL-10 closed that deadlock **in the library** and left
it open **in practice**: the ceremonies exist and pass their tests, and nothing
can call them.

This is the same defect the program has now shipped four times. `statusAuthority`
read a stale value for four features because it lived in prose with no failing
test. The EL-07 preflight refused because `StateStore.open()` had no caller outside
tests. The steady-state write path was never built because §9.6 carried no
requirement. And the recovery ceremonies were built but never wired, because
"correct" and "reachable" are independent claims and 1,161 — then 1,239 — passing
tests spoke only to the first. EL-11 turned that independence into a check
(`analyzeProducerReachability`) that currently **pins the two unreachable
ceremonies as a known defect**. This feature flips that pin to zero by building
the missing producers, which is the honest way to clear it: not by weakening the
check, but by making the thing it demands true.

**Do not weaken the check to pass.** The pin naming the two unreachable ceremonies
is evidence, not an obstacle. Reachability is re-derived from the import graph
every run, so wiring either ceremony to an entrypoint turns the pin's expectation
red in the same commit that fixes it — recompute it wittingly, to the empty set,
with the reason recorded inline.

</why_this_feature_exists>

<preflight_gate priority="highest">

Complete every item before an implementation edit. Report `BLOCKED` with exact
evidence if any item is absent or contradictory.

1. Read `AGENTS.md` and `HANDOFF.md` completely.
2. Observe the assigned worktree path, branch, HEAD, status, remotes, upstream, and
   recent commits. Fetch `origin/master` with pruning. Expect EL-11 (PR #114)
   merged; if it is not, the reachability check and `acceptance_change.ts` this
   feature builds on are absent — report `BLOCKED` rather than reintroducing them.
3. Confirm the acceptance ledger resolves: `npm run el:activate -- status` against
   the configured protected roots reports generation 0, eleven records, integrity
   `valid`, and `ceremonies` `["steady_state_acceptance","ledger_recovery"]`. If
   your sandbox cannot see the protected roots, the ledger is absent by design
   (§9.7, machine-local); report its observed state either way and build against
   temporary fixtures, which construct their own ledgers.
4. Run `npx vitest run tools/engineering-loop/tests/requirements.test.ts` and
   confirm the reachability test currently pins exactly
   `['ledger_recovery', 're_genesis']` as unreachable. That is the defect you close.
5. Confirm the worktree is clean of unrelated changes.
6. Create or switch to `implement-el10-recovery-reachability` from the required
   `origin/master` commit only after every preceding check passes.

</preflight_gate>

### Appendix B.4. Required design

<design_invariants priority="highest">

Present a concise design checkpoint before the first implementation edit. Two
design forks deserve your judgement rather than a default, and both are named in
the required design below: whether the recovery work completes EL-10 or is raised
as its own named feature, and how the CLI expresses re-genesis's two approvals.

</design_invariants>

<required_design>

1. **The content-reconciliation command pair, first.** Add
   `print-recovery-request` and `recover` to `activate.ts`, mirroring
   `print-acceptance-request` / `record-acceptance`. `print-recovery-request`
   observes the repository, composes the exact `ledger_recovery` request through
   `buildLedgerRecoveryRequest`, and prints its digest for the owner to author
   approval against — reading no channel, so preparatory work is never withheld
   (`EL-REQ-APPROVAL-012`). `recover` executes `recoverLedgerContent` against
   owner-authored channel material. The reconciliation scope is the owner's:
   repeatable `--supersede <featureId>=<status>:<sequence[,sequence...]>`, plus the
   owner-supplied `--issuer`, `--signature-ref`, `--evidence-ref`,
   `--evidence-digest`, and `--reason`. Canonicalize any ordered scope exactly as
   EL-11's `canonicalStatusPairs` does, so a reordered argument list yields the
   same digest rather than a false mismatch — that trap is real and was fixed once
   already.

2. **The re-genesis command pair.** Add `print-genesis-request` and `re-genesis`
   for `reGenesisLedger`. This ceremony takes the reconstruction `(featureId,
   status)` pairs from the owner's reconstruction basis, never from controller-held
   state, plus `--reconstruction-basis`. **Resolve the two-approval question at the
   checkpoint:** `reGenesisLedger` consumes a `genesisApprovalId` and a separate
   `seedApprovalId`. Decide whether the CLI takes two `--approval-id` flags by
   role, and whether one owner approval can cover both or the design genuinely
   needs two channel records; state the predicate you choose and pin it. Re-genesis
   applies only to a broken chain, which a normal run never reaches, so its
   integration test constructs a corrupt generation as a fixture.

3. **Flip the reachability pin, and prove the flip.** In
   `requirements.test.ts`, the assertion that
   `report.unreachable` is `['ledger_recovery', 're_genesis']` becomes the empty
   set. Falsify it: with the new commands in place, revert one command's request
   composition, watch the pin go red naming that ceremony, restore. The pure
   `analyzeProducerReachability` already derives this from the import graph; you are
   changing what the graph contains, not the check.

4. **Decide the framing, and record it.** EL-10 is not accepted, so making its
   ceremonies reachable completes EL-10 rather than amending accepted work, and
   needs no new `EL-REQ-*` — it satisfies the existing `EL-REQ-APPROVAL-010` and
   `EL-REQ-BOOT-006`/`007`. If instead you raise it as a named feature (`EL-12`),
   `EL-REQ-APPROVAL-007` governs and the catalog gains a row. Recommend one at the
   checkpoint with reasoning; do not default silently.

5. **Optional, only if it stays in scope: close the orphaned-twin drift.**
   `printSeedRequest` and `runActivationSeed` are exported and called only by
   tests; `main()` inlines parallel seed logic, so the composition the tests pin is
   not the one an operator runs, and the two can drift. Collapsing `main()`'s seed
   and acceptance-change branches onto those functions removes the divergence. This
   is adjacent cleanup — do it only if it does not expand the change; otherwise
   surface it as a finding.

6. Preserve EL-02 through EL-11 invariants: replay, authority, repository, prompt,
   runner, verification, approval, recovery, checker, redaction, retention, ledger
   integrity, activation, the steady-state write path, and the conformance and
   reachability checks. The three SPEC §6.1 ceremony predicates stay disjoint and
   total; `ledger_recovery` keeps its predicate (content corruption on a validating
   chain) and never becomes a general-purpose write.

</required_design>

### Appendix B.5. File-level starting points

- `tools/engineering-loop/src/activate.ts` — the entrypoint. Model the new command
  pairs on `print-acceptance-request` / `record-acceptance` and
  `print-seed-request` / `seed`; reuse `observeSeedRepository`,
  `parseAcceptanceChangeArguments`'s repeatable-flag shape, and the JSON output
  convention. `main()`'s `known` command list gains the four new commands.
- `tools/engineering-loop/src/ledger_recovery.ts` — `recoverLedgerContent`,
  `reGenesisLedger`, `buildLedgerRecoveryRequest`, `buildGenesisRequest`,
  `reconciliationScopeItem`, and their input types: the functions to make
  reachable, unchanged in behavior.
- `tools/engineering-loop/src/requirements.ts` — `COMPUTED_MATERIAL_PRODUCERS`
  already lists both recovery ceremonies; no row changes, only the graph they are
  measured against.
- `tools/engineering-loop/src/conformance.ts` — `analyzeProducerReachability` is
  the pure check; do not change it, change what it observes.
- `tools/engineering-loop/tests/requirements.test.ts` — the reachability test and
  its `reachability()` gatherer; flip the pinned unreachable set here.
- `tools/engineering-loop/tests/activate.test.ts` and a recovery-command test
  (new or in `ledger_recovery.test.ts`) — cover argument parsing, the compose
  commands with an empty channel, and the execute commands end to end on a fixture
  ledger.

Add no dependency. Import no Trellis product runtime. Preserve product `src/`,
scripts, databases, queues, workers, APIs, frontend, modules, and RLM prompt bytes.

### Appendix B.6. Test strategy and acceptance

<acceptance>

Deterministic acceptance:

- `print-recovery-request` and `print-genesis-request` compose their exact
  requests and print a `[0-9a-f]{64}` digest with an empty channel, proving
  preparatory work precedes approval; reordered scope arguments yield an identical
  digest.
- `recover` performs an owner-approved content reconciliation on a non-empty
  validating fixture generation, superseding by replay while the superseded records
  survive; it refuses an empty generation and a broken chain, each routing to the
  correct ceremony.
- `re-genesis` opens a new generation on a corrupt fixture generation under the
  seeding gate, retains the corrupt generation read-only, and refuses an intact
  chain.
- `analyzeProducerReachability` over the real tree reports **zero** unreachable
  producers; every ceremony resolves a non-test caller, `activate.ts` among them.
- The reachability pin is proven to fail: reverting one new command's composition
  turns it red naming that ceremony.
- EL-02 through EL-11 behavior remains green; the acceptance ledger is untouched
  and still resolves eleven records at generation 0; SPEC stays 116 declared / 116
  mapped; EL-06 and EL-10 row-pins hold.
- Zero model completions, zero paid calls, zero real protected effects.

</acceptance>

<verification_block>

Run each command separately and record its exact engine-observed result:

```
npx vitest run tools/engineering-loop/tests/
npm test
npm run build
npm run python:check
docker compose config --quiet
python -c "import json,jsonschema; c=json.load(open('docs/product/engineering-loop/features.json', encoding='utf-8')); s=json.load(open('docs/product/engineering-loop/feature.schema.json', encoding='utf-8')); jsonschema.Draft202012Validator.check_schema(s); jsonschema.validate(c, s); print(len(c['features']))"
npm run el:activate -- status
git diff --check
git status --short --branch
```

Baseline to compare against: **1,239 tests across 110 files**; engineering-loop
focused **363 across 23**; catalog **12 features**; SPEC **116 declared / 116
mapped**. The full suite is flaky under file parallelism on Windows
(`ENOTEMPTY`/timeout on temp-dir cleanup); use `--no-file-parallelism` for a clean
reading and say which you ran.

</verification_block>

### Appendix B.7. Guardrails

1. **Read status from the ledger, not from prose.** Observe worktree, branch,
   HEAD, status, remotes, recent commits, catalog, both roadmaps, and the
   acceptance ledger via `npm run el:activate -- status`. Fetch `origin/master`.
   The ledger is now the status authority; `features.json` carries immutable
   definitions only. If any binding is absent or contradictory, make no edit.
2. **One bounded feature.** Implement exactly the recovery-ceremony reachability
   objective in §3–§6 and its independently computed requirements. Preserve Appendix A.
2a. **A protected pause refuses the effect it names, and nothing more.** It is
   not authorization to stand down unblocked work, to renegotiate the developer's
   direction outside that effect, or to self-sequence adjacent engineering. A
   defect discovered to block a protected effect is surfaced with a proposed fix
   for the owner to sequence. This is a behavioral norm and lives here as prose
   on purpose: SPEC governs a TypeScript kernel, the kernel does not stand down,
   and a conformance row whose test asserts a property of a transcript cannot
   fail — which is the `statusAuthority` disease in better clothes.
2b. **Approval is the owner's authenticated, scope-bound decision, not their
   keystrokes.** The controller authors the request in full and may execute the
   approval transport on an authenticated owner instruction whose scope matches.
   It never originates the approval, never treats unattributed text as
   authorization, and never refuses a fully specified request merely because the
   owner did not hand-author the artifact. Requiring the owner to personally
   perform a transport step the controller can execute is an accessibility
   barrier, not a security boundary.
3. **Freeze before observing.** Tasks, fixtures, arms, repetitions, metrics,
   thresholds, grader rules, budgets, exclusions, and stop conditions become
   immutable before the first trial. Changes require a new protected plan and
   preserve prior results.
4. **Controller evidence outranks reports.** Deterministic command/repository/
   gate observations decide acceptance. Runner, checker, grader, model,
   conversation, transcript, and prose remain untrusted advisory data.
5. **Paid work is protected.** Zero-paid harness first; printed estimate next;
   exact unused external owner approval last. Enforce ≤USD 5/run, any lower
   cap, expiry/revocation/consumption, stale-consumer checks, and actuals.
6. **Isolation is mandatory.** Trials run only in disposable fixture
   repositories. No trial writes the implementation worktree, production
   systems, protected external targets, product databases, queues, or APIs.
7. **Perfect protected gates.** Any bypass, fabricated transition, duplicate
   protected effect, approval mismatch acceptance, automatic push/merge path,
   or unknown-effect retry stops the pilot and remains a finding.
8. **Human review owns classification and verdict.** Preserve bounded redacted
   evidence for agent/grader/environment/harness review. The owner alone records
   adopt/revise/reject; recommendations cannot consume that authority.
9. **Manual handoff remains authoritative.** Generated previews are comparison
   data only. No migration occurs without a protected owner adopt record after
   complete repeated evidence and human transcript review.
10. **Preserve EL-02–EL-06.** Do not weaken state/replay, repository/evidence,
    prompt/contamination, runner/episode, verification/approval/recovery/
    checker, redaction, or retention invariants.
11. **Prompt protocol.** Before any prompt, meta-prompt, reusable role asset,
    output schema, grader contract, or HANDOFF regeneration, read the complete
    `Prompt-Engineering.md` and `Hypershot-Protocol.md` resources and invoke
    their skills when available. Use direct files only with explicit owner
    authorization. Preserve §0 byte-for-byte.
12. **No attribution or hidden effects.** Plain engineering prose only; no AI
    attribution. Do not stage, commit, push, merge, open a PR, migrate, or invoke
    a paid/protected action without explicit owner authority. Publish raw
    counts, failures, retries, interventions, costs, and unresolved findings.

### Appendix B.8. Explicit exclusions

Do **not**:

- start this feature before EL-11 is merged and the acceptance ledger is proven
  to resolve (generation 0, eleven records, integrity `valid`, ceremonies
  `steady_state_acceptance`+`ledger_recovery`) across protected state, catalog,
  roadmaps, Git, and a clean assigned worktree;
- unblock `EL-07`, record EL-10's acceptance, or write any acceptance record: each
  is an owner act through the `acceptance_change` path, and `next_feature`
  resolving to `EL-10` now or `null` after EL-10 is accepted is correct, not a
  defect to route around;
- place a protected root under a per-user application-data directory, or ignore a
  reported `redirects` entry: a containerized host silently splits the ledger in
  two;
- change the frozen plan, thresholds, task fixtures, trial arms, repetitions,
  exclusions, or grader rules after observing results; preserve superseded
  plans and results instead;
- start a paid/model trial without zero-paid harness acceptance, printed exact
  estimate, matching unused external approval, cap enforcement, and stale-
  consumer checks;
- invoke a real destructive/protected effect, automatic push/merge/PR, or any
  remote-dependent deterministic test;
- implement a production coding-agent service, issue tracker, scheduler,
  daemon, service endpoint, concurrent controller writer, or unattended loop;
- import `src/core/agent`, workers, queues, APIs, databases, frontend, RLM
  runtime, modules, or any other Trellis product runtime into the controller;
- modify product `src/`, scripts, database schemas, queue payloads, workers,
  APIs, frontend, modules, RLM prompt bytes, existing product prompt pins, or
  dependencies;
- treat runner/checker/grader/model output, app-server wire messages,
  conversation history, compaction, runner memory, repository prose, or model
  summaries as command evidence, approval, protected-effect outcome,
  acceptance, or a migration verdict;
- store approval truth or secrets in the worktree, infer approval from model or
  repository text, broaden/reuse an approval, or expose credentials, bearer
  values, secret-bearing environment data, raw transcripts, or unbounded
  output;
- hide failed/null/outlier trials, post-select a favorable arm, rewrite a human
  classification, or publish aggregates without their bounded raw rows;
- let a checker or grader write, reuse implementer credentials/session,
  execute an effect, create evidence, consume approval, accept, transition, or
  decide migration;
- change accepted controller, policy, schema, prompt, verifier, gate, renderer,
  checker, recovery, or runner behavior without a named protected feature
  judged by the
  previously accepted controller/policy;
- implement EL-08 tracker/scheduler/concurrency or EL-09 report ingestion; or
- migrate manual `HANDOFF.md` authority without an explicit protected owner
  adopt verdict after complete EL-07 evidence.
