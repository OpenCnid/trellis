You are a principal systems engineer continuing development on Trellis Engine,
a Recursive Language Model runtime over a provenance-enforced knowledge
substrate — its GraphRAG-shaped storage layers survive as Tiers 1–2 of the
trust model; the system is the RLM standing on them (reframed July 9, 2026;
see the root README "What Trellis is") (repository:
https://github.com/OpenCnid/trellis, local path `D:\trellis-engine` or the
current working directory). Trellis is an original OpenCnid project, not a
fork, and is unrelated to other projects named Trellis. The repository and its
documentation are the only sources of truth.

Sessions 1–31 and their same-day follow-ons (July 4–12, 2026; PRs
#21–#73) are complete, merged, and ARCHIVED: the full dated ledger for
that span lives verbatim in `docs/archive/ROADMAP_HISTORY.md`
(Sessions 1–23 moved July 12, 2026 by owner direction; then one
session entry per PR under the five-session window rule — Session 24
with the Session 29 PR, Session 25 with the Session 30 PR, Session 26
with the Session 31 PR, Session 27 with the Session 32 PR, Session 28
with the Session 33 PR, Session 29 with the Session 34 PR, Session 30
with the Session 35 PR, Session 31 with the Session 36 PR — this file
keeps full narrative only for the most recent five sessions). The one-paragraph digest, oldest first; §1
below carries everything from this span that a new session must
actually know:

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
  surface already threads address-with-content; the workspace holds
  no Tier-1 retrievals by construction; verdict + evidence in
  `PROVENANCE_THREADING.md` §9 — no carriage gap, nothing built) and
  slice (d) landed as the retrieval-membership write gate:
  `retrieved_addresses_check` constructor seam in the
  `ast_existence_check` injection mold, `_verify_hashes_retrieved`
  refusing any batch citing an address outside the run's set (typed
  bounded "Provenance Violation" teaching re-retrieval; order pinned
  format → existence → retrieval membership → experimental gates →
  write; the cited audit records the attempt before the refusal;
  whole-batch refusal before any session opens). Wired for research
  runs in `trellis_agent.py`; bare construction byte-identical. T1
  CLOSED, T2 explicitly NOT (slice (e)'s detector). Pinned by
  `test:rlm-sandbox` [6] (40 → 53, first-run green).

**Session 32 (July 12, 2026, PR #74) is also complete: mechanical
provenance threading FINISHED — the slice (e) sampled-entailment
detector + the slice (f) compat verify-and-strike; roadmap §4 row 9 is
STRUCK** (all machinery zero-paid, four commits: the drill repair, the
detector, the pins, the docs). **(0) Pre-existing defect found and
fixed FIRST, its own commit:** `test:verification-sweep` had been
BROKEN since the Session 14 format enforcement landed (July 7) — the
drill seeded beliefs whose `sourceNodeIds` were token-scoped strings,
which `_normalize_fact` refuses (`^[0-9a-f]{64}$`); it was absent from
every close-out block since, so the breakage went unobserved. Fix:
provenance hashes are sha256 digests of the token-scoped names (real
64-hex, unique per run, teardown unchanged); all 35 pre-existing
checks pass again, and the drill is now IN the standing close-out
block so it cannot silently rot. **(1) Slice (e) — the sampled
entailment detector** (`src/core/graph/entailment_detection.ts`, the
verification-sweep mold; finalized decisions recorded in
`PROVENANCE_THREADING.md` §9 amending §5.4 BEFORE the code landed):
the T2 residual tier, a post-hoc DETECTOR over persisted
DERIVED_INSIGHT (edge, cited-hash) pairs — never a write gate, never a
delete. Uniform candidate class (every non-contested DERIVED_INSIGHT
edge with provenance, `has_category` included); the pure sampler
expands unchecked pairs (cited minus judged, deduped), samples at the
operator-visible rate, hard-caps at the judge budget with overflow
counted as `deferred` (seeded `mulberry32`). Each pair is judged AT
MOST ONCE ever: supported ⇒ the hash joins the edge's additive
`entailmentCheckedHashes` (+ `entailmentCheckedAt`); unsupported ⇒ the
edge contests through the ordinary Phase 4/5 transition with typed
reason `unsupported_citation` and the hash joins the durable
`unsupportedHashes` audit (+ `entailmentFlaggedAt`). Provenance fields
never mutated; recovery is re-derivation; no contest flap over an
already-judged pair. The judge: one bounded completion per pair
through `parseLlmResponse` (`EntailmentResponseSchema`; the
`make_entailment_check` prompt SHAPE — the `TRELLIS_CITATION_*` flags
untouched), with judge-all-then-write atomicity (every verdict
collected before any write; an infrastructure failure aborts with ZERO
partial state). Oracle mode drills the whole path zero-LLM. Config
twins `ENTAILMENT_SAMPLE_RATE` 0.1 / `ENTAILMENT_JUDGE_BUDGET_PER_SWEEP`
25 (max 500). Transport: the `entailment_sweep` job name on the
existing verification queue/worker (every other job name
byte-identical); counts-only `trellis_entailment_pairs_total{result}`;
scheduler `npm run entailment:sweep` (`--rate`, `--budget`, `--seed`,
`--prefix`, `--oracle`, `--sync`, `--dry-run`). **(2) Pins:** 10 unit
tests (`entailment_detection.test.ts`, `npm test` 730 → 740) — pool
definition, determinism, budget/deferred, oracle semantics; drill
sections [7]–[9] (`test:verification-sweep` 35 → 66, all green on
FIRST run) — the planted unsupported citation flagged with provenance
intact, the supported pair on the SAME edge still stamped, recovery
composing with the slice (d) gate (unretrieved re-derivation refused;
retrieval-gated one recovers; audit survives), judge failure contests
NOTHING, budget defers loudly, dead-byte pairs skipped and counted,
queue round trip through the real worker. **(3) The first REAL judged
sweep RAN owner-approved (July 13, 2026, the day after the proposal —
dev graph 283 edges / 566 unchecked pairs):** seed 32, 25/25 judged —
8 supported, 17 flagged, 15 edges contested; ACTUAL $0.0093 (2,176
input + 375 output tokens, vs the $0.02–$0.05 estimate). Verified
against stored bytes, the flags decompose: 9 CONFIRMED weak citations
(HEADING blocks — bytes like "q_0034" — cited as provenance for
question facts: the exact wrong-block class the detector exists for,
invisible to the three structural layers by construction) + 8
strict-judge verdicts on derived-classification `has_category` claims
(text supports but does not STATE the classification — a recorded
calibration observation, owner-picked follow-up; the judge prompt
shape unchanged). The 15 contested edges are OOLONG-era dev-graph
cache rows — standard lazy-recovery residue. No machinery defect:
every behavior matched the pins. **(4) Slice (f) — compat
VERIFIED, no gap:** the (d) gate is write-time only
(`_verify_hashes_retrieved` has exactly one caller); envelopes
additive only (`TRELLIS_RESULT` exactly `{status, answer, toolCalls}`;
telemetry gained only slice (b)'s count); no pre-threading writer
class (the only gated construction is the agent's research-run wiring;
every other construction site is bare BY DESIGN under the injection
mold). Evidence cited in the roadmap §5 entry. `drill:scale` 2.04x
CLOSED (in-band, first try). Compose isolated as `trellis_s32_ci`:
11/11 (`package.json` changed — npm ci layer rebuilt; pip layer
cached). Zero paid spend.

**Session 33 (July 13, 2026, PR #75) is also complete: kernel-level
retrieval discipline — held-state dedup + the per-run budget; roadmap
§4 row 10 is STRUCK (machinery + pins zero-paid; the slice (d)
acceptance measurement stands PROPOSED owner-gated).** Three
implementation commits + the design record, no prompt byte, zero paid
spend. **(1) The design record**
`docs/architecture/RETRIEVAL_DISCIPLINE.md` (indexed in docs/README.md;
`PROVENANCE_THREADING.md` §4 now cross-references it, closing that
record's forward note) decided BEFORE any code: held state answers
"were these bytes already served this run" and holds IDENTITIES only —
never content (serving from held state would need the store mirror
pillar guardrail 14 forbids, so repeats REFUSE, never re-serve);
request identities per surface: `get_ast_texts` FULL-REPEAT-ONLY (a
call refuses only when EVERY requested hash is already held; partial
overlap serves everything byte-identically — remainder-serving would
silently change the returned shape mid-run, whole-call refusal would
burn a scarce REPL iteration; the padding evasion — one never-held
hash makes a repeat pass — is recorded honestly: teaching machinery in
the write-gate mold, not a security boundary), `get_ast_blocks` PER
ROOT (THE measured class — the Session 28 frank median-4 repeats were
same-root re-reads; served block ids also join held addresses, the
root argument never does — the Session 30 shape), `vector_search`
EXACT-QUERY-MATCH only (semantic near-duplicate detection is a
semantic judgment, not plumbing — excluded by decision; result ids
never join held addresses, because read-after-search is the
confirm-before-cite pattern the Session 31 gate refusal explicitly
teaches). Scope: per run = per process, module-level under its own
`_held_lock` (a sibling of the audit lock at the same three call
sites; `_audit_add`'s contract untouched), dies with the process,
never parked; seeded runs inherit nothing. **(2) The machinery**
(`trellis_tools.py` + the config twin): activation is ONE explicit
constructor decision in the injection mold —
`TrellisPostgres(retrieval_discipline=True, retrieval_budget=N)`
enables dedup AND budget together; recording and checking BOTH happen
only on disciplined instances, so bare construction (every drill,
probe harness, operator script) is byte-identical; research runs wire
it ON in `trellis_agent.py` (author mode constructs no DB tools);
`TRELLIS_EXP_OMIT_RETRIEVAL=1` is the probe-runner-only OFF arm in the
`TRELLIS_EXP_OMIT_CMT` mold (no config field, `buildAgentEnv` deletes
it unconditionally — unit-pinned). Refusals are typed `ValueError`s
with the uniform `Retrieval Discipline:` prefix, bounded echo (first 5
+ `+N more`), and the binding-reuse teaching sentence. The budget
counts byte-returning fetches only (dedup refusals and empty returns
consume nothing), kernel default `RETRIEVAL_BUDGET_DEFAULT = 64` / cap
1024, refuses at budget+1 BEFORE any I/O (`vector_search` refuses
before the paid embedding call) with counts + a bounded held-root
echo; check order pinned validation → dedup → budget → fetch (a repeat
on an exhausted instance gets the DEDUP refusal — the actionable
teaching). Env twin `TRELLIS_RETRIEVAL_BUDGET_PER_RUN` (Zod optional
int ≤1024 + the Python `parse_retrieval_budget()` twin with identical
bounds; forwarded by `buildAgentEnv` ONLY when the operator set it —
the workspace-bounds stripping discipline). Telemetry gains six
counts-only fields (`retrieval_fetches`, `retrieval_dedup_refusals`,
`retrieval_budget_refusals`, `held_addresses`, `held_roots`,
`held_queries`) in both payloads. Held state never feeds, filters, or
gates the Session 30 retrieval set or the Session 31 write gate —
drilled: a dedup refusal leaves the set unchanged, and a dedup-refused
hash still writes through the gated client. **(3) Pins:**
`test:rlm-sandbox` new section [7], 53 → 95 live checks, ALL GREEN ON
FIRST RUN (env-twin bounds; first-fetch byte-identity against a bare
instance on all three surfaces; refusal anatomy incl. the bounded echo
at 7 held hashes; partial-overlap serve-everything; cross-surface held
addresses; the taught search-hit read-back serving; budget+1 anatomy;
dedup-wins-on-exhausted order; refusal accounting; the [5]/[6]
invariants re-proven under the new machinery; injection-mold
bare-construction pins; refused calls still counting as tool
invocations; accessor copy semantics; static agent-wiring / telemetry
/ OFF-arm / Tier-3-seam pins); `npm test` 740 → 743 (three new
`buildAgentEnv` unit pins). **(4) The slice (d) acceptance stands
PROPOSED owner-gated, criterion pre-stated in the roadmap §5 entry
item 4:** the `est` suite paired re-run, 5 questions × 2 arms ×
`--repeats 5` = 50 runs; ON = the default kernel, OFF = the identical
invocation with `TRELLIS_EXP_OMIT_RETRIEVAL=1` in the probe runner's
own environment (the runner's `armEnv` spreads its process env and
strips only the flags it manages, so the flag reaches the spawned
agent with ZERO runner change; each run's telemetry discipline counts
verify the arm it actually ran under). Criterion: repeat-serves 0 by
construction on the ON arm (refusal counts reported as observed);
pooled median input tokens ON ≤ OFF; correctness non-inferior — calls
and correctness reported TOGETHER, never rewarding low counts.
Estimate ~$2.40 (the Session 28 band); run only on owner approval.
One design-stage defect caught before commit: the first constructor
draft validated the budget AFTER opening the psycopg2 connection (a
refused bound leaked a connection) — validation now runs first,
drill-pinned. `drill:scale` 1.94x CLOSED (in-band, first try). Compose
isolated as `trellis_s33_ci`: 11/11 (no manifest changed — all layers
cached). OPERATIONAL NOTE recorded for future close-outs: the
isolation host-port variables are exactly `TRELLIS_POSTGRES_HOST_PORT`
/ `TRELLIS_NEO4J_HTTP_HOST_PORT` / `TRELLIS_NEO4J_BOLT_HOST_PORT` /
`TRELLIS_REDIS_HOST_PORT` / `TRELLIS_API_HOST_PORT` (set each to 0) —
a first attempt guessed `TRELLIS_PG_HOST_PORT`, collided with the dev
stack on 5433, and failed at network setup; torn down and re-run
clean. Zero paid spend.

**Session 34 (July 13, 2026, PR #76) is also complete:
Trellis-on-Trellis stage 1 — the scoped-snapshot machinery + the full
code-substrate extraction run; roadmap §4 row 11 stage 1 is STRUCK
(stage 2 stays open).** Two zero-paid implementation commits, the
design record, the owner-approved run (approval given up front), the
measured close-out. **(1) The forcing problem:** the full-repo dry run
priced 4,575 post-exclusion blocks ≈ $12.35 — over the ≤$5/run cap —
and the budget gate is all-or-nothing, so scope selection under one
durable repo key became required machinery. **(2) Scoped snapshots:**
`repo:ingest --include <prefix>` (repeatable;
`SnapshotOptions.includePrefixes`) — segment-boundary match, doc keys
root-relative; out-of-scope previously effective paths CARRY FORWARD
at their previous root hash (outcome `unchanged`, never read, never
tombstoned — deletion decisions belong to covering runs; a later
covering run picks up deferred paths as ordinary changed-mode
ingests); out-of-scope paths with no prior version are typed
`out_of_scope` skips (never parsed — parse-level reasons cannot
apply); invalid prefixes refuse before I/O; unset scope byte-identical
(plan-equality pinned). `snapshot_ingest.test.ts` 17 → 24;
`test:repo-ingest` 56 → 82 (Part 7). **(3) The decisions, recorded
before the run** (`REPOSITORY_INGESTION_REPORT.md` §5d): repo key
`trellis` at the repo root; scope `src`+`scripts`+`modules` (bound
1,423 blocks; 112 files / 498 blocks excluded); `docs/` + root prose
DEFERRED to their own chunked proposal (~2,900 blocks ≈ $7.8); `data/`
EXCLUDED by decision (measurement corpora are object text); the
residue DURABLE (no tombstone cleanup — `repo:trellis:*` joins the
durable list); five-part criterion pre-stated. **(4) The run:**
stale-consumer check (none), fresh workers, snapshot `trellis#1` —
298 ingested, 1,921 eligible, 1,423 queued (the printed bound
exactly), 498 excluded; **1,423/1,423 jobs, zero failures, 53m42s**
(serial worker ~26 jobs/min); 22 unresolved endpoints via
pass-through; 9 merge-dropped actions (~0.6%, the observed base rate
at scale); spend 892,363 in / 325,335 out / 388,944 embedding tokens
≈ **$2.75 actual** (band $2.4–$3.84). ALL FIVE criteria PASS: max hub
`ast_nodes` 29 = 2.04% of queued (bar ≤8%), zero denylist names
(query-verified), named kernel surfaces
(`trellis_neo4j.write_derived_insight`, `parsellmresponse`,
`trellis_postgres.get_ast_blocks`, `trellis_answer.submit`) resolve
with provenance threading back to real fetched bytes. Graph: 1,995
entities / 1,788 ACTION relationships carry stage-1 provenance (dev
totals 2,613 / 2,366). Residuals recorded, not acted on: `main` at 28
sources (the cross-file function-name class — first observed count
for a future denylist review; a genuine identifier, stands as data);
serial-worker throughput (concurrency would need merge-safety pins —
concurrent same-name merges are undrilled). **(5) Stage-2 seams
recorded, nothing implemented** (§5d.5): dependency Cypher against
real callers works today; graph→textedit bridge = provenance hash →
`document_nodes` → `repo:trellis:<path>` → `load` (no new machinery);
entity names are lowercase-normalized — identifier lookups need
`globalEntityId`'s normalization; freshness = the ordinary churn
loop. No prompt byte; both composed-prompt pins unmoved. Zero
defects found in existing code.

**Session 35 (July 13, 2026, PR #77) is also complete:
Trellis-on-Trellis stage 2, increment 1 — the graph-informed
self-edit HARNESS; the edit run itself stands PROPOSED owner-gated
(criterion and task text pre-stated).** Three commits (the design
record, the harness, the docs), no kernel byte, no prompt byte, zero
paid spend; roadmap §4 row 11 stage 2 is IN PROGRESS, not struck.
**(1) The increment design record** is
`REPOSITORY_INGESTION_REPORT.md` §5e (document-first, before any
code). The selected target: `src/rlm/trellis_tools.py` carries two
stale statements written in Session 30 and FALSIFIED by Session 31 —
the module comment above `_retrieved_addresses` ("slice (d) will
constrain citable addresses to this set on every run. Bookkeeping
only today — no write-path behavior reads it yet.") and the
`get_retrieved_addresses` docstring ("Slice (d)'s future input.");
in fact `_verify_hashes_retrieved` consumes the set on every gated
write via the `retrieved_addresses_check` seam. The pre-scoped edit
is comment/docstring-only (two hunks, zero executable lines); the
run must derive the correction from graph + fetched bytes. DO NOT
fix the stale comment by hand — it is the run's task; the substrate
blocks mirror the current bytes. Live evidence in §5e.1: the
`get_retrieved_addresses` entity's `returns_copy_of` edge provenance
`1f594ea9…ca61` bridges to `repo:trellis:src/rlm/trellis_tools.py`
(current version) and the stored bytes contain the stale docstring;
the consumer blocks `667501…dc3e` / `faefe76e…6ace` are in the
substrate; no `_verify_hashes_retrieved` entity exists — the run's
recorded insight fills a real gap. **(2) The named failure mode:**
graph-misdirected editing (the run touches a file the graph evidence
did not name, or edits on contested beliefs). Mechanical detection:
`src/benchmarks/selfedit/check.ts` (pure; typed findings
`out_of_scope_edit` / `named_file_unchanged` /
`evidence_edge_missing` / `empty_evidence` / `contested_evidence` /
`dead_evidence_hash` / `unbridged_evidence` /
`target_entity_missing` / `contested_target` / `doc_missing`; 21
unit pins) + `npm run stage2:check`
(`scripts/stage2_selfedit_check.ts`): `--pre` gates on an
uncontested target + present substrate doc (refresh-before-use); the
post-run mode gathers `git status --porcelain` (read-only; the
toolkit never touches git), the Neo4j evidence-edge state, and the
PG current-version doc-key bridge, then evaluates (findings exit 1).
The evidence check leans on Session 31 mechanically: the run records
ONE derived insight (subject `_verify_hashes_retrieved`, verb
`consumes`, object `get_retrieved_addresses`) citing the blocks it
fetched — the write gate already refuses unretrieved citations, so a
successful write IS proof of consultation. HONEST SCOPE (§5e.2): the
checker proves the recorded evidence chain and diff scope, not every
byte read and not query-before-edit ordering — the transcript (plus
opt-in `TRELLIS_CITATION_AUDIT=1`) carries that; human review reads
it. **(3) The drill** `npm run test:selfedit-harness`
(`test_selfedit_harness.ts` + `test_selfedit_rehearsal.py`): 39
checks, ALL GREEN ON FIRST RUN, token-scoped fixture — the bridge
(live / superseded / off-document / ghost hashes), every detection
code fired on its planted violation, the scripted rehearsal driving
the run's REAL tool sequence zero-LLM (`run_cypher` →
`get_ast_texts` → textedit load/locate/splice/write_back → the
retrieval-gated `write_derived_insight`; discipline-enabled
construction) with the clean arm passing the full checker at ZERO
findings and the violation arm observing the LIVE gate refusal
("Provenance Violation … never retrieved") plus the flagged
out-of-scope edit; a read-only live-substrate smoke bridges a real
`repo:trellis` block to its on-disk file. **(4) The run proposal**
(§5e.4, verbatim task text): Session 26 spawn mechanics, research
mode, `--max-iterations 12`, `TRELLIS_EDIT_ROOT` = a CLEAN session
checkout, `TRELLIS_CITATION_AUDIT=1` in the run's own env; estimate
**$0.15–$0.45/run, ≤$0.90 total**; five-part criterion pre-stated in
the roadmap §5 entry item 4 (named-file-only diff; the pre-scoped
edit lands only after human `git diff` review; `stage2:check` zero
findings; counts + diff + dollars together; a harness flag = the
increment FAILED, no silent retry). The `--pre` check ran live:
PASS, zero findings. `npm test` 750 → 771 (81 files);
`check_python_runtime.py` compiles the rehearsal script;
`drill:scale` 1.68x CLOSED; Compose `trellis_s35_ci` 11/11
(`package.json` changed — npm ci layer rebuilt). One observation
recorded: `test:repo-ingest` printed 79 [PASS] vs Session 34's 82 —
the count is environment-dependent by construction (a
`symlinkCreated` conditional + failure-only loop checks); "All
checks passed" is the acceptance signal.

**Session 36 (July 13, 2026, this PR) is also complete: stage-2
increment 1 EXECUTED and LANDED — the graph-informed self-edit run +
the freshness policy's first refresh** (roadmap §4 row 11 stage 2;
the row stays open pending the owner's increment-ladder judgment).
Owner approval for gated and paid runs was given up front; total paid
spend **$0.667** (runs $0.565 vs the ≤$0.90 proposal; refresh $0.102
vs ≈$0.05–$0.25). **(1) Pre-flight all green** on the merged
Session 35 baseline (`npm test` 771/81, build, python:check, compose
config, `test:selfedit-harness` 39/39, `stage2:check --pre` PASS;
edit root = the clean session worktree). **(2) Run 1 FAILED at human
`git diff` review ($0.2134; 72,279 in / 3,268 out) — recorded,
reverted, diagnosed, NO silent retry:** hunk A correct, but hunk B's
splice range [93,95) covered the `def get_retrieved_addresses` line
instead of the docstring tail; the run saw the wrong diff preview and
wrote back anyway; its repair splice still left the stale docstring
tail as dead bytes below the function body; decisively, the final
verification read and `trellis_answer.submit` sat in the SAME REPL
cell, so the printout showing the leftover stale line could not
inform the already-submitted success claim. The file was left
syntax-broken (`unmatched ')'`). `stage2:check` correctly reported
zero findings — scope and the evidence chain WERE clean; the checker
proves consultation and scope, not diff semantics (§5e.2's honest
scope), and the failure was caught exactly where the criterion places
it: human review. The toolkit behaved per contract throughout.
Failure class named: verify-then-submit collapsed into one cell (a
verification read that cannot precede the claim it should gate).
**(3) Run 2 — the diagnosed contingency re-run (identical spawn,
task text byte-identical) LANDED ($0.3520; 120,135 in / 5,165 out),
all five criterion items:** named-file-only diff; the pre-scoped
comment/docstring-only edit (two hunks, zero executable lines, both
stale claims excised, `_verify_hashes_retrieved` and the
`retrieved_addresses_check` seam named, the NOT-experiment-gated and
telemetry sentences preserved; two long unwrapped lines accepted as
style-only); `stage2:check` zero findings; counts + diff + dollars
together (8 db tool calls, 5 retrieval fetches / 1 dedup refusal
observed live / 0 budget refusals, 33 textedit ops / 1 write_back,
`answer_submits` 1, `py_compile` + `npm test` 771/81 + `python:check`
+ `test:textedit` green with the diff applied); no harness flag. The
run's ONE recorded insight (`_verify_hashes_retrieved` `consumes`
`get_retrieved_addresses`) cites the two fetched consumer blocks —
a Session 31 gated write, consultation proven mechanically. **(4) The
refresh — the §5d.6 freshness policy's first execution ($0.102;
14,751 in / 6,531 out / 5,991 embedding tokens):** zero-paid plan
echo FIRST (8 files, 59-block bound, 0 tombstones), then snapshot
`trellis#2` — 24/24 jobs zero failures (1 generic suppression, 2
unresolved endpoints counted); `trellis_tools.py` → v2 (3 orphaned /
3 added / 38 retained). The churn loop observed live end to end: the
old docstring block `1f594ea9…` DEAD in v2, the stage-1
`returns_copy_of` ACTION edge CONTESTED with provenance preserved in
`orphanedSourceIds`; run 2's insight edge SURVIVED uncontested (it
cites the unedited consumer blocks — the evidence outlived the edit
it justified, better than this file's prior prediction; recorded as
observed); recovery = an operator re-derivation citing the new v2
block `09281f45…` through the ordinary write path (a live
DERIVED_INSIGHT `returns_copy_of` belief on v2 bytes); the contested
ACTION edge stands as the audit record per the lazy-recovery
precedent — re-extraction did NOT spontaneously reproduce that exact
triple (extraction variance, the recorded base-rate behavior).
**(5) Close-out:** the full standing drill block green (18 suites);
`drill:scale` ALONE 1.63x CLOSED; Compose `trellis_s36_ci` 11/11
(no manifest changed — all layers cached); `git diff --check` clean.
No machinery defect found: run 1's failure was the run's, not the
harness's. NO kernel prompt byte; both composed-prompt pins unmoved
(the landed diff is Python comment/docstring bytes — not prompt
composition input; `test:modules` green with the diff applied).

OpenCnid selected the MIT License on July 6, 2026.

Your objective is **Session 37: stage-2 increment 2 — close the
run-1 escape mechanically (the parse gate), then design and execute a
deeper owner-scoped self-edit increment** (roadmap §4 row 11
stage 2), per §3–§6 below. Increment 1's measured lesson: the checker
verified scope and evidence but nothing mechanical verified the edited
file still PARSES — run 1 shipped a syntax-broken file that only
human review caught. Increment 2 (a) lands the parse gate in
`stage2:check` zero-paid FIRST (a post-run mechanical check, never a
write gate), then (b) proposes the deeper edit run to the owner:
graph-derived candidate targets, a NEW named failure mode, the same
harness + human `git diff` review, task text adding the
verify-in-its-own-iteration discipline. ASK THE OWNER before any
paid run (propose-with-estimate; the fallback menu is §2's standing
owner-conditional items). Each increment stays a single named failure
mode; the toolkit never touches git. Do not re-plan or re-implement
completed work. RLM expands exclusively to Recursive Language Model
(the MIT CSAIL formulation).

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
     column — the promotion audit stamp (which server/tool/args produced a
     promoted document's bytes, fetched when); only segment promotion
     writes it, inside the ingest transaction.
   - `repository_snapshots`/`repository_snapshot_paths` (Session 8) record
     which paths each published repository snapshot contained.
   - Durable measurement substrate (Sessions 21–23):
     `data/frankenstein.txt` and `data/synthetic_chronicle.txt`
     (committed, byte-stability unit-pinned, `.gitattributes -text`) are
     ingested as `book:gutenberg-84:frankenstein` and
     `book:synthetic:ninth-circuit-chronicle`; the 40 deterministic
     ledgers (`src/benchmarks/effective_context/synthetic_corpus.ts`,
     seeded generator, concat sha unit-pinned) as
     `ledger:synthetic:house-01…40`; and the Session 23 relational
     corpus (`relational_corpus.ts`, seeded, concat sha `3bbbea18…a697`
     unit-pinned) as `ledger:synthetic:s2-house-001…100` +
     `registry:synthetic:captains` + `tariff:synthetic:port-schedule`
     (all extraction `none`, no embeddings) — the effective-context
     probe's corpora, deliberately NOT drill residue. The three promoted
     research docs
     `research:trellis/workspace-discipline/{contract,evidence,code-mediated-text}`
     are module #1's corpus documents. NOTE (measured Sessions 22–23):
     the root-hash reconstruction (`nodeText`/`get_ast_texts`)
     concatenates paragraph blocks with UNMARKED boundaries — it breaks
     BOTH line-anchored parsing AND trailing word boundaries (`\d+\b`
     fails at glued digit→letter junctions); parse by shape without
     trailing `\b` (the `parseLedgerRecords` precedent). Session 24
     fixed the localization class structurally WITHOUT touching those
     bytes: `get_ast_blocks(root_hash)` returns the ordered blocks
     directly — measured (probe round 4): 0/36 misses vs round 3's
     7/30. The reconstruction-byte change is SUPERSEDED and stays
     closed.
   - The verified ingest transaction lives in `src/core/ingestion/`
     (`ingest_document.ts`: persist → read-back re-hash verification →
     membership → registration → in-transaction Merkle diff;
     `plan_ingest.ts`: explicit `none`/`changed` extraction policy with a
     hard block budget). `POST /ingest` is a thin delegate; tombstones are
     ordinary ingests of a deterministic empty root. Schema bootstrap is
     serialized by `pg_advisory_xact_lock`; Neo4j bootstrap retries
     transient label-lock deadlocks and creates `entity_name_index`.
   - **The promotion path (Session 17; `src/core/promotion/`):** the ONLY
     route from Tier 3 to Tier 1. `plan_promotion.ts` (pure planner:
     typed refusals for truncated/empty/unknown segments and bad doc
     keys; content byte-verbatim; doc keys operator-explicit with the
     `mcp:<server>:<tool>:<argsHash>` fallback offered, never applied
     silently) + `promote_segment.ts` (one planned request through the
     unmodified verified transaction, returning the citable block
     hashes) + the operator CLI `npm run promote` (list/promote over
     PARKED snapshots only, zero-paid default, `repo:ingest`-style
     extraction double gate). Because the doc key is stable,
     re-promoting refreshed external content versions the document and
     the existing Merkle-diff → sweep machinery contests stale beliefs
     for free. Drill: `npm run test:promotion`.
2. **Neo4j — semantic and belief layer**
   - `Entity` and `Conflict` nodes plus `ACTION`, `CONTRADICTS`,
     `DERIVED_INSIGHT`, `SAME_AS`/`DISTINCT_FROM` edges, all carrying
     `sourceNodeIds`. `contested`/`contestedAt`/`orphanedSourceIds`/
     `rederivedAt` form the audit-preserving quarantine/recovery state
     machine (`src/core/graph/provenance.ts`).
   - Entity identity is immutable; equivalence is an overlay belief.
     Retrieval expands one trusted `SAME_AS` hop with per-fact `viaAlias`.
   - **Extraction (Sessions 1/8/25):**
     `src/workers/extraction_worker.ts` consumes `extraction_queue` jobs
     `{astNodeId, text, sourceKind?, language?, ...}` enqueued by the
     verified ingest path when the operator selected extraction policy
     `changed`: pure payload parsing (`parseExtractionJobData` in
     `src/workers/extraction_job.ts` — unknown sourceKind/language
     refused loudly BEFORE any I/O; absent field = legacy) → liveness
     gate → one completion with the routed prompt
     (`buildExtractionPrompt`: `code` selects the Session 25 code-tuned
     API-level prompt; `prose`/absent compose the EXACT legacy
     document-generic bytes, unit-pinned; `GraphSchema` via
     `zodResponseFormat`, crossing `parseLlmResponse`) →
     `suppressGenericIdentifiers` (Session 25,
     `src/core/graph/generic_suppression.ts`) → `resolveExtractedGraph` →
     `mergeWithAstLivenessFence(mergeExtractedGraph)` (ON MATCH mirrors
     the quarantine/recovery semantics; dropped actions are counted and
     logged, never silent) → per-block embedding. Repository snapshots
     stamp sourceKind per file language and force policy `none` for
     `isTestOrFixturePath`-classified files (typed
     `test_fixture_excluded` counts everywhere). Extraction spend is
     always operator-gated (`plan_ingest.ts`: policy `none` default;
     `changed` needs an explicit block budget, and `repo:ingest` adds
     `--confirm-extraction`).
   - **Session 14 (kernel):** the single agent write path
     (`write_derived_insight`/`write_derived_insights` →
     `_normalize_fact` → `_run_insight_writes` in
     `src/rlm/trellis_tools.py`) ENFORCES provenance: every
     `sourceNodeIds` element must match `^[0-9a-f]{64}$` AND exist in
     `ast_nodes` (deduped batch union, checked via the injected
     `ast_existence_check` before the WRITE session opens). "An AST hash
     means verified ingested bytes" is enforcement, not convention.
     Never weaken or make this configurable. **Sessions 30–31 sit
     beside it:** the run's retrieved-address set
     (`docs/architecture/PROVENANCE_THREADING.md`) is recorded
     engine-side, always on — `get_ast_texts` returned keys,
     `get_ast_blocks` block ids, `vector_search` result ids, fed inside
     `_audit_add` at the citation-audit seam; `ast_hashes_exist`,
     `fetch_texts`, `run_cypher`, Tier-3 surfaces, and seeds NEVER
     contribute; accessors `get_retrieved_addresses()` (a copy) /
     `get_retrieved_address_count()`; counts-only `retrieved_addresses`
     telemetry. Session 31 activated slice (d) on top: research runs
     construct `TrellisNeo4j` with
     `retrieved_addresses_check=get_retrieved_addresses` (the
     `ast_existence_check` injection mold), and
     `_verify_hashes_retrieved` in `_run_insight_writes` refuses any
     batch citing an address outside the run's set — a typed bounded
     "Provenance Violation" teaching re-retrieval, order-pinned format
     → existence → retrieval membership → experimental gates → write,
     the cited audit recording the attempt before the refusal, the
     whole batch refused before any session opens. Bare construction
     (drills, operator scripts) passes None and writes exactly as
     before. T1 is CLOSED. **Session 32 finished the row:** T2
     (read-then-cite laundering) is MEASURED by the sampled entailment
     detector (`src/core/graph/entailment_detection.ts`, sweep-side,
     never in the write path): per persisted DERIVED_INSIGHT
     (edge, cited-hash) pair, judged at most once ever — supported
     pairs stamp the additive `entailmentCheckedHashes`, unsupported
     pairs contest the edge (typed reason `unsupported_citation`,
     durable `unsupportedHashes` audit) through the ordinary machinery;
     recovery is re-derivation; judge-all-then-write atomicity; oracle
     mode drills it zero-LLM (`test:verification-sweep` [7]–[9]). The
     detector is a SAMPLED measure of the T2 residual at a rate — it
     does not eliminate it; report the rate with every claim.
     **Session 33 sits beside all of it at the SAME surfaces, a
     DIFFERENT structure:** retrieval discipline
     (`docs/architecture/RETRIEVAL_DISCIPLINE.md`) — held-state dedup
     (typed `Retrieval Discipline:` refusals for repeat fetches:
     full-repeat-only per requested hash set for `get_ast_texts`, per
     root for `get_ast_blocks`, exact-query-match for
     `vector_search`) and the per-run budget (kernel default 64
     byte-returning fetches, cap 1024, env twin
     `TRELLIS_RETRIEVAL_BUDGET_PER_RUN`), active ONLY on
     discipline-enabled `TrellisPostgres` construction (research runs
     wire it on; bare construction byte-identical; the
     `TRELLIS_EXP_OMIT_RETRIEVAL` probe-only OFF arm). Held state
     holds identities only, never content, and never feeds the
     retrieval set or the write gate — bookkeeping over retrieval,
     never over citability (`test:rlm-sandbox` [7]).
   - **The verification layer (Phase 5 + Session 32;
     `src/core/graph/verification.ts` + `entailment_detection.ts` +
     `scripts/verify_sweep.ts` + `scripts/entailment_sweep.ts` +
     `src/workers/verification_worker.ts`):** two sampled re-check
     tiers over the shared `verification_queue`. The classifier sweep
     re-classifies cached `has_category` beliefs from live source text
     (policy tiers mandatory/sampled/graduated, trust accrual via
     `verified_count`, disagreement contests with reason `disputed`).
     The entailment sweep (job name `entailment_sweep`) judges sampled
     (edge, cited-hash) pairs for claim support (rate + budget config
     twins `ENTAILMENT_SAMPLE_RATE`/`ENTAILMENT_JUDGE_BUDGET_PER_SWEEP`;
     overflow deferred and counted). Both have oracle modes for
     zero-LLM drills; both contest through the Phase 4 path, never
     delete; both fetch block text engine-side and validate every
     completion through `parseLlmResponse`. Real sweeps are owner-gated
     per run. The first ran owner-approved July 13, 2026 (seed 32, 25
     pairs, $0.0093): 17 flagged — 9 VERIFIED weak heading-block
     citations (the wrong-block class the detector exists for) + 8
     strict-judge verdicts on derived-classification `has_category`
     claims (calibration observation, owner-picked follow-up); the
     roadmap §5 Session 32 entry item 3 records the decomposition.
   - **Module entities (Session 18; `src/core/graph/module_registration.ts`
     + `scripts/register_modules.ts`):** each research-bearing ACTIVE
     module manifest is registrable as
     `(:Entity {kind: 'module_manifest', name: 'module:<name>'})` whose
     `sourceNodeIds` are the manifest's research hashes
     (existence-gated against `ast_nodes` before any write) and whose
     ON MATCH mirrors `applyRederivation` — so the unchanged sweep
     contests a capability when its research basis changes. `npm run
     modules:register` / `modules:verify` are operator tooling in the
     `repo:ingest`/`promote` mold. Contested/retired manifests are
     skipped by registration; entities are contested/retired, never
     deleted.
3. **Redis + BullMQ — asynchronous layer**
   - Seven queues: `extraction_queue`, `rlm_queue`, `supervisor_queue`,
     `invalidation_queue`, `verification_queue`, `resolution_queue`, and
     `agent_queue`. `rlm_queue` and `agent_queue` use interactive no-retry
     job options (an interrupted paid run must not silently re-spend); the
     rest use bounded retries. All LLM calls live inside BullMQ workers or
     the RLM process; every worker-consumed completion crosses
     `parseLlmResponse` (`src/core/llm/boundary.ts`). Since Session 32
     `verification_queue` carries two job names — the existing
     verification shape and `entailment_sweep` — dispatched by
     `job.name` in the worker; the existing shape processes
     byte-identically.
   - **Scratch parking (Session 16):** `scratch:goal:<goalId>:task:<taskId>`
     holds one task's end-of-run workspace snapshot, TTL-bounded
     (`SCRATCH_TTL_SECONDS`) and volume-capped per goal
     (`SCRATCH_MAX_BYTES_PER_GOAL`). Redis is a parking lot for
     checkpoints, never a live store the model queries. Pure helpers
     live in `src/workers/workspace_scratch.ts`; all I/O is in
     `rlm_worker.ts`. Promotion consumes these parked snapshots — TTL
     expiry is BY DESIGN.
4. **RLM execution, the agentic loop, and external surfaces**
   - `GET /api/rlm-stream` (API-key gated, `StreamGate` + queue-depth
     backstop) subscribes to `rlm-stream:<jobId>`, then enqueues one
     `rlm_queue` job. `src/workers/rlm_worker.ts` spawns one Python process
     per job (`trellis_agent.py`) with config forwarded via env by the pure
     `buildAgentEnv` helper in `src/workers/rlm_job.ts` (`NEO4J_*`,
     `PG_DSN`, `PYTHONPATH`, the canonical `TRELLIS_MCP_SERVERS` registry,
     exactly the credential env vars the registry's http servers name,
     the validated workspace bounds, the canonical module selection, and —
     Session 20 — the textedit root + bounds exactly when the operator
     set `TRELLIS_EDIT_ROOT`; unset config values are stripped, never
     passed through raw). `buildAgentArgs` forwards `--max-iterations`,
     `--goal-id`, and (Session 16) the worker-named
     `--workspace-out`/`--seed-workspace` temp files — a queue payload
     can never pick filesystem paths. The worker publishes every stdout
     chunk and feeds two pure bounded scanners over the identical bytes:
     `RlmTelemetryScanner` (`TRELLIS_TELEMETRY:` spend line) and
     `RlmResultScanner` (`TRELLIS_RESULT:` task envelope
     `{status, answer, toolCalls}`). Job payloads are normalized by
     `parseRlmJobData`: pre-Session-9 `{query, jobId}` still processes;
     optional `goalId`/`taskId` correlation, `maxIterations`, `seedTasks`
     (ids only, never content), and a data-only `stub` replay mode (whose
     optional `workspaceSnapshot` parks through the identical path) for
     zero-LLM drills. Payloads carry nothing MCP-, workspace-content-, or
     textedit-shaped (unit-pinned).
   - `src/rlm/trellis_agent.py` wraps the `rlms` recursive-LM library
     (model `gpt-5.4-2026-03-05`, `max_depth` 1) and injects tools via the
     rlms `custom_tools` mapping — `trellis_neo4j` (read-only Cypher plus
     the hardened single write path), `trellis_postgres`
     (`get_ast_texts`, `get_ast_blocks` — Session 24, a document's
     extraction blocks in order as `{id, type, text}`, the walk in the
     dependency-free `trellis_blocks.py` parity-pinned against
     `collectExtractionBlocks`/`nodeText` by `block_parity.test.ts` —
     `vector_search`, and `ast_hashes_exist` — write-path plumbing,
     never tool-call-counted), `trellis_answer`
     (Session 22 — see the next bullet), and — only when the
     operator configured servers — `trellis_mcp`
     (`src/rlm/trellis_mcp.py`), an MCP client over the pinned
     `mcp==1.12.4` speaking protocol revision 2025-06-18: allowlist
     BEFORE any I/O, double-bounded per-call timeouts,
     `TRELLIS_MCP_TRUNCATED` size caps, credential scrubbing
     (`_scrub`/`_describe_exception`), one transport-aware seam
     (`_dial`). PROVENANCE SPLIT: database tools increment
     `_count_tool_call()`; MCP calls count separately as `mcp_calls` —
     an answer with zero DATABASE tool calls emits
     `TRELLIS_PROTOCOL_VIOLATION` no matter how many MCP, workspace,
     textedit, or answer-channel operations happened. **Sessions
     30–31:** the same module records the run's retrieved-address set,
     and the research write path consumes it (see the Session 14
     bullet above). **Session 33 (row 10) landed here too:** the three
     retrieval surfaces (`get_ast_texts`, `get_ast_blocks`,
     `vector_search`) carry the held-state dedup + budget checks on
     discipline-enabled instances — a different structure from the
     retrieval set, sharing only the call sites, exactly as the
     record §4 note required.
   - **The by-reference answer channel (Session 22;
     `src/rlm/trellis_answer.py`):** `TrellisAnswer` injected as
     `trellis_answer` in EVERY research run — kernel surface, not
     operator-gated (author mode does NOT carry it; its draft envelope
     is a different contract). `submit(expression_text)` takes the TEXT
     of a Python expression, evaluates it in the calling REPL frame
     (`sys._getframe(1)` — globals AND locals; the caller's
     `__builtins__` are rlms' safe table), structurally refuses bare
     literals (`ast.parse`: an expression with no
     Name/Attribute/Subscript/Call is a retyped literal — refused with
     a teaching message), refuses `None` results and over-cap
     expressions/content (kernel constants
     `ANSWER_EXPRESSION_MAX_CHARS` 400 / `ANSWER_CONTENT_MAX_CHARS`
     64 KiB), renders deterministically (str verbatim, int exact, float
     shortest repr, containers compact JSON), prefixes `FINAL_ANSWER: `
     engine-side, and sets `answer['content']`/`answer['ready']` on the
     LIVE binding read from the caller frame at each call. ADDITIVE:
     direct assignment still works; `TRELLIS_RESULT` semantics
     unchanged; telemetry gains counts-only `answer_submits`. Errors
     are LOUD by construction. Pinned by `npm run test:answer-channel`
     (32 checks, real LocalREPL). Measured: 230/230 cumulative paid
     runs answered through the channel with zero transcription errors.
   - **The Tier-3 workspace (Sessions 14/16;
     `src/rlm/trellis_workspace.py`):** injected as `trellis_workspace`
     when MCP servers are configured OR the run carries `--goal-id` OR
     the run is seeded; otherwise nothing is injected and prompt and
     behavior are byte-identical (pinned by `test:rlm-workspace`). State
     is one plain JSON dict `{version, plan, notes, segments}`. With a
     workspace attached, `trellis_mcp.call_tool` captures every result
     as an origin-stamped uuid4 segment and returns a bounded stub
     (`preview≤500`); the model pulls content deliberately via
     `segment(id)` or fans `llm_query` over segments. Budgets raise
     `WorkspaceBudgetError`; stored state is never silently truncated.
     Lineage: `snapshot()` serializes at task end; `seed_from_snapshot`
     restores parked snapshots at spawn — stamps verbatim, torn and
     over-budget seeds raise before the first turn. The park/seed seam
     is drill-pinned at cap sizes (Session 27, `test:rlm-workspace`
     [7]/[8]); any cap raise re-runs the M1 fixture at the target size
     FIRST (the cap-raise doctrine, pillar §7). Structural
     disjointness: uuid segment ids and 16-hex argsHashes can never
     match `^[0-9a-f]{64}$`, and the hardened write path rejects them
     independently. Tier 3 has NO provenance standing; permanence is
     earned only through the Session 17 promotion CLI. **Session 30:**
     seeded runs inherit NOTHING into the retrieval set.
   - **CORE PILLAR — code-mediated text (ratified July 9, 2026;
     `docs/architecture/CODE_MEDIATED_TEXT.md`, doctrine on par with the
     provenance invariant):** *the model never counts, and the model
     never copies.* The RLM handles all text through queryable REPL
     structures: locations are engine-computed and returned by query
     (transient handles — re-query, never remember); existing bytes are
     moved by code (splice at a computed address, hash-guarded
     write-back), never re-typed through attention; the model authors
     only genuinely new text plus the code that manipulates everything
     else. Localization error and transcription error (the laundering
     channel) are the same pathology — attention doing code's job.
     Payoff: effective context bounded by REPL memory, not the
     attention window. Lines locate, blocks mean. Enforcement lands as
     tooling shape; prompts reinforce only. Sessions 20–24 implemented
     §6.1/§6.2, measured rounds 1–4, closed the transcription channel
     (`trellis_answer`) and the localization read boundary
     (`get_ast_blocks`); Session 27 recorded the data-plane verdict
     (contracts stay JSON everywhere; polars pinned NOT adopted; cap
     raises, not representation changes, are the first lever).
     **Sessions 30–32 applied the pillar to the write path:**
     `docs/architecture/PROVENANCE_THREADING.md` — addresses travel by
     plumbing, never by model retyping; the row is COMPLETE: (a)+(b)
     Session 30, (c) adjudicated + (d) live Session 31, (e) detector +
     (f) compat Session 32. Measured standing: transcription CLOSED
     (144/144 rounds-2–3 runs by reference, zero retyped-value
     corruptions); read-fidelity holds (28/28 quotes byte-faithful);
     the structured-frame threshold sits ABOVE ~6,900 records /
     three-way joins (the pandas null result, twice); localization
     CLOSED by the accessor (0/36); the residual after transcription
     closes is computing faithfully over the WRONG input. **Session 33
     (row 10) applied the pillar to retrieval spend:** repeat fetches
     and unbounded retrieval are attention doing bookkeeping's job —
     the engine tracks held state, the engine enforces budgets, the
     model reuses bindings it already holds
     (`docs/architecture/RETRIEVAL_DISCIPLINE.md`; dedup closes REPEAT
     fetches, the budget bounds spend — neither claims optimality or
     sufficiency). **Row 11 is the pillar's payoff regime:** the
     large-corpus setting where the Session 28 control showed
     discipline pays — and the corpus is Trellis itself.
   - **The editing toolkit (Session 20; `src/rlm/trellis_textedit.py`):**
     `TrellisTextEdit` injected as `trellis_textedit` ONLY when the
     operator sets `TRELLIS_EDIT_ROOT` (never a default; never from a
     payload or completion; byte-identical prompt and namespace when
     unset — pinned by `npm run test:textedit`). Every path strictly
     resolves inside the real root: `..`, absolute/rooted paths, and
     symlink escapes are refused before any I/O. `load` holds a
     `text.split("\n")` frame + load-time sha256 (the join is the exact
     inverse — an unedited round-trip is byte-identical); `locate`
     returns engine-computed 0-based half-open addresses (bounded hits
     + true total); `splice` stages replacements (lists of strings free
     of "\n" — a "\r" is an ordinary byte WITHIN a line; Session 26
     fixed the CRLF refusal, regression-pinned); `diff`/`revert`/`drop`
     review and manage frames; `write_back` re-hashes the disk bytes
     and RAISES `StaleFileError` on mismatch, else writes temp +
     rename. Bounds: Zod + Python twins
     (`TRELLIS_TEXTEDIT_MAX_FILE_BYTES` default 4 MiB cap 32 MiB;
     `TRELLIS_TEXTEDIT_MAX_FILES` default 16 cap 64); slice (200) / hit
     (40) / diff (400) caps are kernel constants. Telemetry counts only
     — toolkit ops never satisfy the provenance protocol, and edited
     file content earns citability only through verified
     ingest/promotion. Session 29 hardened `write_back` inside the
     contract (write-time containment re-verification, source-mode
     preservation, the final pre-replace digest re-check narrowing
     TOCTOU — residual documented, not denied; the static
     import-allowlist/no-git-token pin). The 105/106-check drill runs
     in CI's `offline` job. The toolkit never touches git; landing is
     a human PR. The brace-free TEXTEDIT addendum composes only when
     configured. Author mode does NOT inject it.
   - **The module registry (Sessions 15/18; `src/config/modules.ts` +
     `src/rlm/trellis_modules.py`, `modules/<name>/`):**
     `TRELLIS_ADDENDUM` = `TRELLIS_ADDENDUM_BASE` + Σ selected module
     addenda + `TRELLIS_WORKFLOW_RULES`. Selection is operator-owned via
     `TRELLIS_MODULES` (unset ⇒ default `["spatial-flywheel"]`; `[]` ⇒
     base + rules only; max 4/run). PROTOCOL MODULES ONLY this kernel
     edition — manifests declaring tools are rejected. Addendum files
     are brace-free; rubric text enters through the single
     `<<TRELLIS_RUBRIC>>` substitution token. Both validators are
     bound-for-bound twins and normalize CRLF→LF. Session 28 added
     `TRELLIS_EXP_MODULES` (probe-runner-only, the
     `TRELLIS_EXP_OMIT_CMT` mold; `buildAgentEnv` deletes both
     unconditionally). The composed default prompt is pinned at
     `COMPOSED_SYSTEM_PROMPT_SHA256 = 5d27e474…fe2a` (the July 12, 2026
     prompt-engineering pass; the pin constant records its full move
     history in `scripts/test_modules.py` — it moves only with a
     witting kernel change, recomputed in the same commit). The §6.2
     block is the named constant `CODE_MEDIATED_TEXT_BLOCK`, and
     `TRELLIS_EXP_OMIT_CMT=1` (experiment instrumentation ONLY — never
     set by any default/worker/Compose config, `buildAgentEnv` deletes
     it unconditionally) composes exactly that block out
     (`45987904…0b56`, pinned structurally by `test:modules` [7]:
     the default kernel minus exactly the block, re-proven on every
     run). Module #1 (`workspace-discipline`) is at version 2. Module
     #2 (`estimation-discipline`) is RETIRED (owner decision, July 11,
     2026, on the Session 28 control's numbers; manifest status
     `retired`, loader refuses composition — `test:modules` [8]; the
     graph entity survives as the historical record). The owner's
     accompanying direction is PERMANENT: behavioral failure classes
     close by tooling shape, not prompt modules — prompt-module
     authoring is deprioritized (no new authoring turn without
     explicit owner request); the recorded successors were rows 9
     (DONE, Sessions 30–32) and 10 (DONE, Session 33).
   - **Grounded authoring (Session 19; `src/core/authoring/*` +
     `src/core/observability/rlm_draft.ts` + `scripts/author_module.ts`
     + `trellis_agent.py --mode author`):** the kernel mode that drafts
     a protocol module addendum from a FIXED promoted corpus and nothing
     else. Author runs see only `trellis_workspace` (no DB/search/write
     — no DB connection opens; no textedit), work from a block-aligned
     seeded corpus, and emit a hashes-free `TRELLIS_DRAFT` envelope. The
     harness holds the pen: `research.sourceNodeIds` is pinned from the
     corpus block set (`corpus.ts`/`seed.ts`), the authoring template is
     a byte-pinned kernel constant, the deterministic anchor gate
     (`anchors.ts`, `ANCHOR_COVERAGE_THRESHOLD = 0.3`) refuses a
     corpus-blind draft, and the draft scanner refuses any 64-hex
     token. `npm run modules:author` assembles a directory for human
     review only. The paid authoring run is owner-gated per run.
   - CRITICAL rlms constraints (verified against the installed
     rlms==0.1.3; pinned live by the `test:rlm-workspace` LocalREPL
     section): `custom_system_prompt` REPLACES the base REPL protocol
     prompt — Trellis EXTENDS `RLM_SYSTEM_PROMPT`; rlms runs `.format()`
     over the prompt so literal curly braces are forbidden (escape by
     doubling — see `_SAFE_RUBRIC`; addenda use `dict(...)` example
     syntax; validated name charsets keep generated listings
     structurally brace-free). `LocalREPL` persists `self.locals`
     across turns; scaffold restore touches only `RESERVED_TOOL_NAMES`
     (injected tools persist untouched); on exception, rebindings are
     lost but in-place mutations persist; underscore-prefixed names
     never persist.
   - The orchestrator (Sessions 9/16) lives in `src/core/agent/` and is
     a pure decision maker: `OrchestratorDecisionSchema` through
     `parseLlmResponse`, planner prompt never routed through rlms,
     dependency-injected `runGoalLoop` with typed failures
     (`iteration_bound`/`task_bound`/`concurrency_bound`/
     `decision_error`/`orchestrator_fail`), hard per-goal bounds
     (`AGENT_*`, single-digit-capped) and its own admission gate. The
     orchestrator has NO tools and no database access — and it routes
     workspace lineage BY REFERENCE: task specs carry `seedFromTasks`
     (prior iterations only), observations carry counts-only
     `workspaceRef`s, and snapshot content never enters the decision
     context. Zero-LLM drills: `AGENT_ORACLE_ENABLED=true` accepts an
     `oracle` script — `npm run test:agent-loop`.
   - **The A2A server surface (Session 11)** exposes the goal loop to
     external agents: `src/api/a2a.ts` over pure modules in
     `src/core/a2a/` (`protocol.ts`, `task_record.ts`,
     `agent_card.ts`). Enabled only by `TRELLIS_A2A_ENABLED` (default
     false; the API is byte-identical when unset). The card is served
     unauthenticated from `/.well-known/agent-card.json` (public
     contract only); `POST /a2a/v1` sits behind the API key and
     requires `A2A-Version: 1.0`. Dispatch shares the SAME `StreamGate`
     + queue-depth backstop as `/api/agent-stream`; one A2A task is one
     goal (taskId = goalId), recorded in TTL-bounded Redis records
     (`a2a:task:<id>`, `A2A_TASK_TTL_SECONDS`). IORedis gotcha (found
     live in Session 11): issue `subscribe` in the SAME tick the
     connection is created — a subscribe issued after an unrelated
     await can land mid ready-check and wedge the connection in a
     reconnect loop that delivers no events.
5. **Observability and process boundaries**
   - `src/core/observability/` defines pino JSON logging and per-process
     Prometheus registries; API and workers are separate processes/
     containers. Stable dot-namespaced events; bounded metric labels only —
     queries, goals, message content, artifacts, paths, hashes, entity
     names, tool arguments, tool results, workspace content, promoted
     content, module addendum text, file paths, file content, diffs,
     digests, server commands, URLs, credentials, and retrieved addresses
     never become label values or log content (entity names may appear in
     log CONTENT per the extraction dropped-action precedent; operator
     CLIs may print hashes — the `promote` precedent). Queue-depth
     gauges cover all seven queues; `trellis_rlm_mcp_calls_total` is
     label-free. Workspace, lineage, textedit, retrieval-set, and
     entailment telemetry is counts only
     (`trellis_entailment_pairs_total{result}` — Session 32).
6. **The frontend (DEFERRED — unscheduled, 3.3 #5 residue) and other stable subsystems**
   - `src/frontend/` is a Next.js 16.2.9 / React 19 app (its own
     `package.json` and lockfile, npm-installed separately) with one
     page: an entity search box over a force-directed graph pane
     (`react-force-graph-2d`) and a provenance pane; clicking a graph
     node highlights the exact AST text blocks that produced it
     (`SplitPaneViewer.tsx` fetches `/api/retrieve?entity=...`). Today
     it is dev-only: `next.config.ts` rewrites `/api/:path*` to
     `http://localhost:3000/:path*` with NO API-key injection, there is
     no production build wired into CI, no container, and no
     deployment documentation. `src/frontend/AGENTS.md` warns: this
     Next.js version has breaking changes vs. training data — read
     `node_modules/next/dist/docs/` before writing Next-specific code.
     NOT this session's work unless the owner directs it.
   - Whole-codebase ingestion: `src/core/repository/`, `npm run
     repo:ingest`, live drill `npm run test:repo-ingest` (82 checks —
     Part 6 exercises the Session 25 exclusion + routing under
     `--extract changed` with the queue captured in memory; Part 7 the
     Session 34 scope machinery). **Session 34 added scoped
     snapshots:** the repeatable `--include <prefix>` CLI flag
     (`SnapshotOptions.includePrefixes`) plans and ingests only paths
     under an included prefix (segment-boundary match, doc keys stay
     root-relative); a previously effective path OUTSIDE every prefix
     CARRIES FORWARD at its previous root hash (published outcome
     `unchanged`, never read, never tombstoned — deletion decisions
     belong to runs whose scope covers the path; a later covering run
     picks up deferred paths as ordinary changed-mode ingests); an
     out-of-scope path with no prior version is a typed `out_of_scope`
     skip (never parsed, so parse-level reasons cannot apply); invalid
     prefixes refuse before I/O; unset scope is byte-identical
     (plan-equality pinned). Extraction spend stays double-gated per
     run. **The stage-1 self-substrate is LIVE (July 13, 2026):**
     repo-key `trellis`, scope `src`+`scripts`+`modules`, doc keys
     `repo:trellis:<path>` — durable, never drill-cleaned; refresh by
     re-running the scoped snapshot (changed blocks re-extract, the
     Merkle diff → sweep contests stale beliefs). **Session 35 added
     the stage-2 self-edit harness on top:**
     `src/benchmarks/selfedit/check.ts` (pure typed findings for the
     graph-misdirected-editing failure mode; 21 unit pins), the
     operator CLI `npm run stage2:check` (`--pre` refresh-before-use
     gate; post-run scope + evidence verification over read-only
     `git status --porcelain`, the Neo4j evidence edge, and the PG
     current-version doc-key bridge; findings exit 1), and the
     39-check zero-LLM drill `npm run test:selfedit-harness`
     (token-scoped fixture + the scripted rehearsal of the run's real
     tool sequence, clean and violation arms, plus a read-only
     live-substrate smoke). Harness tooling, not a kernel gate: bare
     construction and every existing kernel surface are untouched.
     **Session 36 executed increment 1 through it** (run 1 failed
     human review — the verify-then-submit-in-one-cell class the §3
     parse gate targets; run 2 landed all five criterion items) and
     ran the freshness policy's first refresh (snapshot `trellis#2`,
     churn loop observed live: dead hash → contest with audit → live
     re-derivation on v2 bytes).
   - Benchmarks: OOLONG v1 saturated baseline; anti-shortcut v2 at
     `data/oolong_pairs_dataset_hard.json`; scale evidence in
     `docs/benchmarks/SCALE_PROVENANCE_REPORT.md` and
     `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md`; the paired-run
     workspace probes in `docs/benchmarks/WORKSPACE_PROBE_REPORT.md`
     and `WORKSPACE_LINEAGE_PROBE_REPORT.md`; the provenance-citation
     A/B eval in `docs/benchmarks/PROVENANCE_CITATION_AB_REPORT.md`
     (the evidence base for the row-9 threat model); the
     effective-context probe (rounds 1–4 + the Session 28 control) in
     `docs/benchmarks/EFFECTIVE_CONTEXT_PROBE_REPORT.md` over the four
     durable corpora (the `est` suite reads all four; truths +
     minimal-evidence bounds unit-pinned in `estimation_suite.ts` —
     row 10's acceptance harness).
   - The fixture MCP server (`scripts/fixture_mcp_server.py`; stdio and
     Streamable HTTP with an optional required-bearer mode) is the only
     MCP server acceptance ever configures; real web-search servers are
     owner-approved runs with the allowlist printed and `mcp_calls`
     recorded. The containerized tool-server pattern is the
     `mcp-fixture` Compose service (test profile).

## 2. Current baseline

Repository state at handoff creation:

- `master`: the head after the July 13, 2026 Session 36 PR (the
  landed increment-1 self-edit + the first refresh — the PR that
  carries this file).
  Sessions 25–35 (PRs #63/#64/#67/#68/#71/#72/#73/#74/#75/#76/#77), the
  wall-clock benchmark + expansion series (PR #65), the
  coverage-audit record (PR #66), the prompt-engineering pass
  (PR #69), and the root AGENTS.md (PR #70) are all merged. Use
  `git log -- HANDOFF.md` to confirm this PR landed; if it is still
  unmerged when this session starts, STOP and merge it first.
- `modules/workspace-discipline/` is at VERSION 2 (module #1); the dev
  graph carries its registered entity `module:workspace-discipline`
  (`moduleVersion` 2; manifest pins 31 research hashes; the entity's
  live provenance is the audit-preserving union of both versions'
  bases, 41 hashes) and THREE promoted corpus documents
  `research:trellis/workspace-discipline/{contract,evidence,code-mediated-text}`
  (none embedded). The dev PG also durably carries the four probe
  corpora: `book:gutenberg-84:frankenstein` (root `a2f9c97c…4439`, 796
  blocks), `book:synthetic:ninth-circuit-chronicle` (root
  `f0ffaf20…7c23`, 827 blocks), `ledger:synthetic:house-01…40`, and
  the Session 23 relational set `ledger:synthetic:s2-house-001…100` +
  `registry:synthetic:captains` + `tariff:synthetic:port-schedule`
  (roots and diffs stable — re-ingest is the auditable no-op) — and,
  since July 13, 2026, **the self-substrate at snapshot
  `trellis#2`** (Session 36's refresh over Session 34's `trellis#1`):
  303 effective `repo:trellis:<path>` documents, scope
  `src`+`scripts`+`modules` — stage-1 extraction produced 1,995
  entities / 1,788 ACTION relationships; the refresh re-extracted 24
  changed blocks (Session 35's harness files + the landed edit).
  DURABLE — never drill-cleaned, never tombstoned as cleanup; refresh
  = re-run the scoped snapshot (`repo:ingest --repo-key trellis
  --root . --include src --include scripts --include modules`, plan
  echo first, extraction gated per run). Known residue by design: the
  stage-1 `returns_copy_of` ACTION edge on `get_retrieved_addresses`
  reads contested with its dead v1 hash in `orphanedSourceIds` (the
  Session 36 churn demonstration; the live fact is the uncontested
  DERIVED_INSIGHT `returns_copy_of` belief citing the v2 block);
  ~630 documents total in `documents` (pilot residue tombstoned;
  pilot-provenance entities read contested — the standard
  lazy-recovery residue; the two promoted
  `research:trellis/estimation-discipline/{contract,evidence}` docs
  remain; the July 13 entailment sweep left 15 contested OOLONG-era
  edges — lazy-recovery residue, recovered by re-derivation citing the
  body block). Module #2 (`modules/estimation-discipline/`, version 1)
  is RETIRED (manifest status `retired`, loader refuses composition;
  the graph entity `module:estimation-discipline` persists as the
  historical record, uncontested, 19 research hashes). Roadmap §4 rows
  5/6/6a/8/9/10 and row 11 STAGE 1 are STRUCK; row 11 stage 2 is IN
  PROGRESS (increment 1 EXECUTED and LANDED Session 36; the row
  strikes only on the owner's increment-ladder judgment); row 7 stays
  trigger-blocked.
- Session 36 changed NO prompt byte — both composed-prompt pins
  unmoved (default `5d27e474…fe2a`, omit-arm `45987904…0b56` —
  recompute BOTH in the same commit only if the kernel prompt or
  rubric legitimately changes). Its code surface is exactly the
  RUN-AUTHORED diff: two comment/docstring hunks in
  `src/rlm/trellis_tools.py` (zero executable lines — the Session 30
  stale slice-(d) statements corrected by the increment-1 run itself;
  do not "improve" this diff by hand, it is measured evidence).
  Everything else is docs (`TRELLIS_ROADMAP.md`,
  `REPOSITORY_INGESTION_REPORT.md` §5e.5, the archive move, this
  file) plus the committed `scale_drill_results.json`. `package.json`
  and `requirements.txt` unchanged — all Docker layers cached. Run
  transcripts live in `benchmark_logs/` (gitignored, local only):
  `session36_selfedit_run1.log` / `session36_run1_failed_diff.patch`
  / `session36_selfedit_run2.log` / `session36_workers.log` /
  `session36_compose.log`.
  Reminder from Session 24: `block_parity.test.ts` SPAWNS the real
  Python walk inside plain `npm test` (interpreter from
  `PYTHON_EXECUTABLE` or the platform default) — a machine without
  Python on PATH will fail the unit suite; CI sets up Python 3.13
  before `npm test`.
- Offline baseline: `npm test` = 771 passing across 81 files
  (unchanged by Session 36 — no new test surface; the session's code
  diff is comment/docstring-only).
- `npm run build` and `npm run python:check` pass (the check imports
  polars — an environment without it fails the check by design).
- `npm run drill:scale`: gate CLOSED at max provenance 286.
  Session 36 read 1.63x CLOSED (in-band ~1.48x–2.26x, first try);
  Session 35 1.68x; Session 34 1.53x; Session 33 1.94x; Session 32 2.04x; Session 31
  2.09x; Session 30 1.89x; Session 29 1.97x; Session 28 first read
  2.65x — OUTSIDE the band — and the precedent re-run read 1.77x
  CLOSED (non-reproducing, most plausibly same-day drill traffic on
  the shared dev database). If a future run reads OPEN, re-run before
  believing it — and if it REPRODUCES, that is the recorded migration
  trigger (roadmap §4 row 7) and the owner adjudicates. The drill
  rewrites the tracked `scale_drill_results.json` — commit it with
  the session PR (house practice; the committed copy is Session 36's
  1.63x CLOSED run). Run the scale drill ALONE — never concurrently
  with other live drills on the shared dev database (the Session 28
  outlier's most plausible cause).
- Live zero-LLM checks (Session 36 observed, all green):
  `test:selfedit-harness` (39 — runs the rehearsal python, so
  it needs the Python runtime deps), `test:answer-channel` (32),
  `test:modules` (green — pins unmoved),
  `test:textedit` (105 on this Windows host; 106 on POSIX — the
  executable-bit check is POSIX-only; also in CI),
  `test:module-lifecycle` (60), `test:promotion` (41),
  `test:rlm-workspace` (106), `test:rlm-mcp` (86),
  `test:rlm-sandbox` (95), `test:verification-sweep` (66),
  `test:agent-loop` (35 / ALL CHECKS PASSED), `test:a2a` (46),
  `test:repo-ingest` (green — the printed [PASS] count is
  environment-dependent by construction — a `symlinkCreated`
  conditional and failure-only loop checks — so "All checks passed"
  is the acceptance signal, not the line count),
  `test:benchmark-hardening` (24),
  `test:entity-resolution` (34), `test:api-hardening` (18),
  `test:belief-recovery` (30), `test:invalidation-sweep` (17).
- Isolated Compose integration: 11 assertions (`--profile test`,
  unique project name; includes the containerized credentialed MCP
  fixture probe and the in-container `polars 1.34.0` import probe).
  Session 36 ran it as project `trellis_s36_ci` (all 11 PASS; no
  manifest changed — all layers cached) and tore it down with
  `--volumes`. The CI-mold invocation: env `COMPOSE_PROJECT_NAME` +
  the five host-port variables at 0 + an `API_KEY`, then
  `docker compose --profile test up --build
  --abort-on-container-exit --exit-code-from integration
  integration`, then `down --volumes --remove-orphans`. The isolation host-port variables
  are EXACTLY `TRELLIS_POSTGRES_HOST_PORT`,
  `TRELLIS_NEO4J_HTTP_HOST_PORT`, `TRELLIS_NEO4J_BOLT_HOST_PORT`,
  `TRELLIS_REDIS_HOST_PORT`, `TRELLIS_API_HOST_PORT` — set each to 0
  (Session 33's first attempt guessed `TRELLIS_PG_HOST_PORT`,
  collided with the dev stack on 5433, and failed at network setup —
  torn down and re-run clean). NOTE: the machine's C: drive runs
  close to full (~19 GB free at Session 36's close) and a FULL image
  rebuild needs several GB of headroom. Changing `package.json`
  invalidates the Docker `npm ci` layer; changing `requirements.txt`
  invalidates the pip layer.
- The standing owner-conditional items — all propose-with-estimate,
  never self-served: **(1) the row-10 slice (d) acceptance
  measurement** (proposed Session 33, criterion pre-stated in the
  roadmap §5 Session 33 entry item 4: the `est` suite paired re-run,
  50 runs, ON = default kernel vs OFF = `TRELLIS_EXP_OMIT_RETRIEVAL=1`
  in the probe runner's own env — zero runner change needed, telemetry
  verifies each run's actual arm; repeat-serves 0 by construction,
  tokens ≤ baseline, correctness non-inferior, calls and correctness
  together; est. ~$2.40); **(2) the judge-calibration decision for
  derived-classification claims** (the July 13, 2026 measured sweep —
  25 pairs, $0.0093 — found the strict judge flagging 8/25
  question-body `has_category` pairs whose text supports but does not
  STATE the classification; options: a classification-aware judge
  prompt variant vs accepting conservative contests; owner-picked —
  the 9 heading-block flags in the same sweep were VERIFIED real weak
  citations, so the detector's core class works as built); **(3) the
  stage-1b prose chunk** (docs/ + root prose, ~2,900 blocks ≈ $7.8 at
  the §5b rate — needs its own chunked proposal, two runs under the
  cap, and a prose-prompt value question answered; recorded in
  `REPOSITORY_INGESTION_REPORT.md` §5d.2); (4) the pandas
  head-to-head probe round; (5) the cross-process concurrency proof
  run (coverage-audit gap #1); **(6) executing the substrate freshness policy** —
  ADOPTED July 13, 2026 by owner direction
  (`REPOSITORY_INGESTION_REPORT.md` §5d.6: NOT real-time, stale
  tolerable between refreshes; one scoped refresh per merged PR +
  refresh-before-use ahead of stage-2 edit runs; incremental by
  Merkle diff, ≈$0.05–$0.25 typical; adoption sets the default
  cadence only — every refresh's extraction spend stays gated per
  run); **(7) the targeted stage-1 entailment sweep**
  (~100 pairs ≈ $0.04 — deliberate sampled-audit coverage over the
  substrate's semantic layer; the Session 36 refresh added 24 newly
  extracted blocks to that pool). Item (6)'s FIRST EXECUTION ran in
  Session 36 (snapshot `trellis#2`, $0.102) — the cadence stands (one
  scoped refresh per merged PR + refresh-before-use ahead of stage-2
  edit runs), each refresh still gated per run. The increment-2 parse
  gate and edit run are the Session 37 OBJECTIVE's own steps, not
  conditional items — but if the owner declines the run, this list is
  the fallback menu.
- CI target is Node 22 (the `offline` job also runs `test:textedit`
  after its Python-runtime install — Session 29). Session 33's local
  environment was Node 20.19.2, Python 3.13.1, Docker Compose v2,
  PostgreSQL 16.14, Neo4j 5.11.
- Python runtime deps are pinned in `requirements.txt` (`rlms==0.1.3`,
  `openai`, `neo4j`, `psycopg2-binary`, `unstructured`, `mcp==1.12.4`,
  and — Session 27 — `polars==1.34.0`, the engine-side analytics tier:
  pinned NOT adopted, no kernel/contract/prompt path imports it);
  `npm run python:check` verifies syntax/imports/assets — including
  `trellis_textedit.py`, `trellis_answer.py`, `trellis_blocks.py`, the
  `pandas` import (pillar-load-bearing; installed transitively via
  `unstructured`), and the `polars` import (a broken environment must
  fail the check, not a paid run). Local dev measured pandas 2.2.3 /
  pyarrow 24.0.0 / polars 1.34.0; the Docker image carries
  `pandas==3.0.3` (pinned in requirements-pdf-fast.txt) and polars
  1.34.0 (proven by the Compose probe). Pillar §7's structure guidance
  stands at "plain loops until a measured threshold".
- The `documents.origin` column ships in the idempotent bootstrap; run
  `npm run db:init:dev` (or restart a container) once against a
  pre-Session-17 database before using `npm run promote`.
- Raw probe run logs live under `benchmark_logs/` (gitignored — local
  only; the numbers live in the committed report).
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

## 3. Session 37 problem statement

**Stage-2 increment 2 (roadmap §4 row 11 stage 2): close increment
1's measured escape mechanically, then take one step deeper on the
edit ladder.** Increment 1 landed (Session 36) and left two facts a
new session must act on:

- **The measured escape:** run 1 shipped a syntax-broken
  `trellis_tools.py` (`SyntaxError: unmatched ')'`) that
  `stage2:check` PASSED — correctly, per its recorded scope (§5e.2:
  consultation + diff scope, not diff semantics) — and only human
  `git diff` review caught. The failure class is named in the
  Session 36 roadmap entry: verify-then-submit collapsed into one
  REPL cell (the run's final verification read printed the leftover
  stale bytes AFTER `trellis_answer.submit` was already staged in the
  same cell). A parse-level check is mechanically decidable and
  belongs in the checker: a self-edit that leaves the named file
  unparseable should be a typed finding, not a human catch.
- **The ladder position:** increment 1 was comment/docstring-only in
  one named file. The recorded escalation (roadmap §4 row 11) is
  "string constants toward reviewed kernel diffs" — increment 2's
  edit class is a genuine step up (an executable-line single-file
  edit, or a multi-file comment-class edit), owner-scoped, with a
  NEW named failure mode and the same harness + human review.

The session splits zero-paid machinery from the owner-gated run
exactly as Session 35/36 did: build and drill the parse gate FIRST
(no approval needed — harness tooling, not kernel), then propose the
increment-2 run with target, failure mode, criterion, and estimate,
and WAIT for owner approval before any paid spend.

## 4. Required design

- **Pre-flight (zero-paid):** confirm the Session 36 PR merged
  (`git log -- HANDOFF.md`); `npm ci`; full offline gates; the
  standing drill block green.
- **The parse gate (zero-paid, lands regardless of the run):** extend
  `src/benchmarks/selfedit/check.ts` with a typed finding
  `named_file_unparseable` and `scripts/stage2_selfedit_check.ts`
  with the post-run parse check on the named file — language-aware by
  extension: `.py` via a spawned `python -m py_compile` (the
  interpreter from the same config seam the harness already uses),
  `.ts`/`.js` via the TypeScript compiler API's parse-diagnostics (a
  single-file syntax parse, NOT a type-check — no project resolution,
  no emit). POST-RUN mechanical check only, never a write gate
  (guardrail 5's mold); a parse failure is a finding (exit 1), same
  as every other code. Unit pins in `check.test.ts` (a planted
  syntax-broken fixture per language, plus the clean-arm no-finding
  pin); a drill section in `test_selfedit_harness.ts` planting the
  EXACT run-1 shape (stale docstring tail left as dead bytes below a
  function body) and observing the finding fire. Run-1's preserved
  failed diff (`benchmark_logs/session36_run1_failed_diff.patch`,
  local) is the reference shape. The checker stays READ-ONLY.
- **The increment-2 proposal (owner-gated; present, then WAIT):**
  select 2–3 candidate targets BY GRAPH QUERY over the `trellis#2`
  substrate (the increment-1 mold: a recorded falsifiable staleness
  or mismatch the run can verify against fetched bytes — e.g. a
  docstring/comment contradicted by a later session's landed
  behavior, found by reading `run_cypher` results against stored
  blocks; do NOT hand-pick by reading the working tree alone — the
  graph-informed selection IS the increment's point). For each
  candidate record: the named file(s), the pre-scoped edit, the NEW
  named failure mode the increment measures, mechanical detection,
  estimate (the W-series/increment-1 basis: $0.15–$0.45/run for
  single-file; scale for multi-file), and the five-part criterion in
  the §5e.4 mold. Write the design record as
  `REPOSITORY_INGESTION_REPORT.md` §5f BEFORE any run. Task-text
  discipline (the run-1 lesson, run INPUT not kernel prompt): require
  the final verification read in its OWN iteration, with
  `trellis_answer.submit` only in a LATER cell after printing the
  verified bytes.
- **The run (only after owner approval):** Session 26 spawn
  mechanics, research mode, `TRELLIS_EDIT_ROOT` = the clean session
  worktree, `TRELLIS_CITATION_AUDIT=1`, `--max-iterations 12` (raise
  only with the owner if the deeper class needs it). Refresh-before-
  use: if the target file changed since `trellis#2`, run the scoped
  refresh (plan echo first, separately gated) BEFORE the run so the
  substrate mirrors current bytes. Post-run in order: `stage2:check`
  (now with the parse gate) → human `git diff` review → offline gates
  with the diff applied → land in the session PR. One contingency
  re-run only after a diagnosed clean failure, within the proposed
  budget; a harness flag = FAILED, record and stop.
- **Post-landing refresh (the adopted §5d.6 cadence, separately
  gated):** plan echo, approval, drain, churn verification with
  counts — the Session 36 mold.
- **What does NOT change:** rows 9/10 machinery; the textedit
  contract; the increment-1 landed diff (measured evidence — never
  "improved" by hand); every probe suite's question bytes; both
  composed-prompt pins.

## 5. File-level starting points

- `TRELLIS_ROADMAP.md` §5 Session 36 entry — the run-1 diagnosis
  (the failure class the parse gate closes) and the landed-run
  counts; §4 row 11 for the ladder.
- `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md` §5e (the
  increment-1 design record — the mold for §5f) and §5e.5 (the
  measured-run record).
- `src/benchmarks/selfedit/check.ts` + `check.test.ts` — the checker
  and its pins (typed findings list; add `named_file_unparseable`).
- `scripts/stage2_selfedit_check.ts` — the CLI (post-run mode gains
  the parse step; `--pre` unchanged).
- `scripts/test_selfedit_harness.ts` + `scripts/test_selfedit_rehearsal.py`
  — the drill (add the run-1-shape planted violation) and the
  spawn-env mold for the paid run (`runRehearsal`).
- `src/rlm/trellis_agent.py` — the spawn surface (unchanged; research
  mode wires gate + discipline).
- `scripts/ingest_repository.ts` — the refresh command.
- `src/config/index.ts` — the python-executable seam
  (`config.python.executable`) the parse gate should reuse.

## 6. Test strategy and acceptance

Zero-paid except the owner-gated increment-2 run and (separately
gated) any refresh extraction.

- **Zero-paid:** the parse gate's unit pins land in `npm test`
  (771/81 grows); `test:selfedit-harness` grows by the planted
  parse-failure section and stays green; the full standing drill
  block green; `stage2:check --pre` passes before any run.
- **The run (owner-gated):** judged by §5f's pre-stated five-part
  criterion (the §5e.4 mold: named-file-only scope, pre-scoped edit
  under human review, checker zero findings INCLUDING the parse gate,
  counts + diff + dollars together, harness flag = FAILED with no
  silent retry).
- **The refresh (owner-gated):** plan echo bound before approval;
  churn verified with counts post-drain.
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
- `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md`: §5f (the
  increment-2 design record, written BEFORE the run) + its measured
  subsection after.
- `HANDOFF.md`: regenerate per §0 — including the §0 step 5 re-check.
  NOTE for objective selection: if increment 2 lands, the natural
  next objective is increment 3 (further up the ladder, owner-scoped)
  or an owner-directed pivot to the §2 standing menu (the row-10 (d)
  acceptance and the stage-1b prose chunk are the largest standing
  measurements); if the owner declines increment 2's run, the parse
  gate still lands and the fallback is the §2 menu. Keep the
  five-session narrative window (33–37 after this session): compress
  Session 32 into the digest and move its roadmap §5 entry verbatim
  to `docs/archive/ROADMAP_HISTORY.md`.

## 7. Guardrails

1. Never mutate an AST. The T13 hash preimage is pinned;
   `rederiveAstNodeId` stays authoritative; nothing positional is ever
   persisted as identity.
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
   permanent: detector-not-gate (the entailment tier FLAGS into the
   contested machinery — it never deletes and never becomes a write
   gate); each (edge, cited-hash) pair judged AT MOST ONCE
   (`entailmentCheckedHashes` + `unsupportedHashes` are additive audit
   properties — provenance fields never mutated by a verdict); the
   typed reason `unsupported_citation`; judge-all-then-write atomicity
   (a judge infrastructure failure contests NOTHING — never a
   provenance verdict).
4. Extraction spend is operator-gated, ALWAYS: policy `none` default,
   the explicit block budget, `--confirm-extraction`, and the printed
   post-exclusion bound BEFORE any spend. The stage-1 run and any
   other paid run are owner-gated propose-with-estimate under the
   standing ≤$5/run cap, actuals recorded in the roadmap. Never reward
   citation count anywhere — and never reward LOW tool-call,
   retrieval, or extraction counts either (counts and correctness are
   reported TOGETHER).
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
   its contributing surfaces are exactly the three recorded ones; its
   exclusions are by decision not just by shape; the accessor returns
   a copy; the set is never parked/serialized), the Session 31
   write-gate invariants (the retrieval-membership check is the THIRD
   layer in the fixed order, wired ONLY by explicit construction at
   the agent — never module-global, never environment-gated, never
   default-on for bare construction — its refusal typed and bounded,
   the cited audit recording the attempt before the refusal), the
   Session 32 detector invariants (guardrail 3), and the Session 33
   retrieval-discipline invariants (held state holds IDENTITIES only,
   never content; recording and checking happen ONLY on
   discipline-enabled construction — never module-global, never
   environment-gated-on; bare construction and the FIRST fetch of
   every surface stay byte-identical; dedup refusals never mutate the
   retrieval set and held state never feeds, filters, or gates the
   Session 30/31 structures; the budget counts byte-returning fetches
   only; refusals are typed and bounded in the `Retrieval Discipline:`
   shape), and the Session 34 scope invariants (a scoped run NEVER
   tombstones an out-of-scope path — carry-forward publishes the
   previous root hash verbatim; deletion decisions belong to runs
   whose scope covers the path; unset/empty scope is byte-identical
   to full scope, plan-equality pinned; `out_of_scope` is a typed
   counted skip; invalid prefixes refuse before I/O; doc keys stay
   root-relative under every scope), and the Session 35 stage-2
   harness invariants (the checker and its CLI are READ-ONLY
   everywhere — the only git invocation is `git status --porcelain`,
   and the run/toolkit never touches git; `--pre` runs before any
   edit run; a harness flag FAILS the increment — never argued away,
   never re-run silently; the evidence contract stays "one recorded
   insight citing fetched blocks, verified through the Session 31
   gate" — the checker never becomes a write gate itself). None of
   these is ever weakened or made configurable.
   `TRELLIS_EXP_OMIT_CMT`, `TRELLIS_EXP_MODULES`, and
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
   extraction quality claims carry their counts (suppression,
   exclusion, hub cardinality) and their spot-check evidence together
   — a big graph is not a good graph.
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
   shape byte-for-byte; and the drills and probe scripts that fetch
   repeatedly today keep passing (their construction is bare by
   design).
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
    and the stage-1 repository extraction substrate (`repo:trellis:*`
    documents + their graph entities — LIVE since July 13, 2026) stay
    durable. Never tombstone or sweep the stage-1 residue as if it
    were drill state.
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
    retrieval spend (the engine tracks held state, the engine enforces
    budgets, the model reuses bindings it already holds). Prompt text
    may reinforce the discipline but never substitutes for tooling
    shape.

## 8. Explicit exclusions

Do not include: running the increment-2 edit run, any refresh
extraction, the row-10 (d) `est` acceptance measurement, the
stage-1b prose chunk (docs/ + root prose), or ANY paid run without
explicit owner approval (the run and any refresh are THIS objective's
gated steps — ask first, wait; everything else stands
propose-with-estimate; the first entailment sweep RAN owner-approved
July 13, 2026 — actuals in the Session 32 roadmap entry item 3; a
SECOND sweep or a judge-calibration change is a new owner decision);
hand-editing the increment-1 LANDED diff in `trellis_tools.py`
(measured evidence of the first landed self-edit — style cleanups
included; any change there is a NEW owner-visible edit, not a
touch-up); making the parse gate a write gate or wiring it anywhere
except the post-run checker path (guardrail 5's mold); letting the edit run or the toolkit
touch git in any form (landing is a human-reviewed PR, always);
committing an edit-run diff without human `git diff` review or with
a non-empty `stage2:check` finding list; widening the stage-2
increment beyond its single named failure mode mid-session;
re-running the scoped snapshot OUTSIDE the post-landing refresh step
(a scoped re-run without extraction budget is zero-paid but still
churns beliefs — owner-visible, not a convenience); weakening any
Session 35 harness pin or making the checker a write gate
(guardrail 5); tombstoning or sweeping the
stage-1 extraction residue as if it were drill state (durability is
the point — permanent now that the run has run; guardrail 12);
reworking the Session 34 scope machinery (carry-forward semantics,
the `out_of_scope` skip, the plan echo lines ship as recorded);
reworking rows 9 or 10 (the write gate, the detector, and the
retrieval discipline ship as recorded — do not change their stamps,
reasons, refusal bytes, identities, or wiring; do not wire the
detector into the write path; do not repurpose the
`TRELLIS_CITATION_*` env flags); feeding, filtering, or gating the
Session 30 retrieval set or the Session 31 write gate from row-10 held
state (the structures share call sites only); making dedup/budget
mutate what a FIRST fetch returns, silently serving stale or
transformed bytes on a repeat fetch, or parking/seeding held-root
state; redefining the retrieval set (its surfaces and exclusions are
recorded in `PROVENANCE_THREADING.md` §3 and pinned by
`test:rlm-sandbox` [5] — a change there is a recorded correction with
owner visibility, not a convenience edit); weakening, reordering, or
merging the three write-path layers (format → existence → retrieval
membership — fixed order, fail-fast); widening the generic-identifier
denylist or the test-fixture patterns without observed counts (the
`main`-at-28 observation is DATA for a future review, not a license
to act); un-retiring module #2 or authoring ANY new
protocol module (deprioritized permanently; explicit owner request
only); re-running or extending the Session 28 control or ANY measured
probe round outside the recorded owner-gated proposals; running the
cross-process concurrency proof run (coverage-audit gap #1) or any
proof-run depth increment without owner approval — propose with
estimates; weakening ANY Session 29 `write_back` hardening pin, the
`StaleFileError` semantics, the splice "\n"-only refusal, or any
textedit gating/containment/hash-guard pin; claiming full TOCTOU
closure (the residual window is documented, not closed — OS locking
stays out of scope); claiming the retrieval-set constraint closes
laundering (it closed T1; T2 is the detector's SAMPLED residual —
guardrail 8); claiming dedup/budgets make retrieval optimal (they
close repeats and bound spend — guardrail 8); ANY data-plane
representation migration at ANY boundary (the Session 27 verdict
stands; re-entry only through the review's benchmark matrix with owner
sign-off); importing polars in any `src/` path, kernel surface, or
prompt; raising any workspace/scratch/textedit cap without first
re-running the M1 fixture at the target size (the cap-raise doctrine,
pillar §7); asserting on wall-clock timings in any drill; changing
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
migration (gate CLOSED; Sessions 23–36 read 1.84x, 2.11x, 1.99x–2.01x,
1.78x, 1.99x, 1.77x-after-outlier, 1.97x, 1.89x, 2.09x, 2.04x, 1.94x,
1.53x, 1.68x, and 1.63x, inside the band — do not migrate on a noisy
reading); T13
re-hashing; rlms library modifications; weakening the Session 14
write-path enforcement, the Session 15/20/22/24 composition pins, the
Session 16 lineage pins, the Session 17 promotion refusals, the
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
`buildAgentEnv` unit pins, including the constructor-validates-
before-connect behavior and first-fetch byte-identity), or the
Session 34 scope pins (`snapshot_ingest.test.ts` scope section +
`test:repo-ingest` Part 7, including plan-equality for unset scope
and carry-forward-never-tombstones), or the Session 35 stage-2
harness pins (`check.test.ts` + the 39-check `test:selfedit-harness`
drill, including the live-gate refusal observation and the
clean-arm zero-findings pass).
