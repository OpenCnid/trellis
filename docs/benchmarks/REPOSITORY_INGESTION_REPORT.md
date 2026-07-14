# Repository Ingestion Report (Session 8)

*July 6, 2026 — roadmap item 3.3 #6. Zero LLM calls end to end.*

## 1. What shipped

Whole-codebase ingestion turns one repository snapshot into a bounded
sequence of per-source-file document ingests through the verified ingest
service extracted from `POST /ingest`:

- `src/core/ingestion/` — `planExtraction` (pure cost planning with an
  explicit `none`/`changed` policy and a hard block budget) and
  `ingestDocument`/`ingestTombstone` (the exact T15 transaction:
  persist → read-back re-hash verification → membership → registration,
  with the Merkle diff moved inside the transaction so a budget
  rejection rolls the whole version back before any queue write).
- `src/core/ast/source_parser.ts` — code-aware parsing.
  TypeScript/JavaScript via `@babel/parser` (pure JS, new production
  dependency); Python via the standard-library `ast` module
  (`scripts/parse_python_source.py`, same interpreter contract as
  `parse_pdf.py`, output validated at a Zod boundary); Markdown keeps
  the pinned `parseMarkdownToAST` preimage; a named allowlist of
  configuration/text formats becomes bounded `opaque_text` chunks.
  Blocks are top-level functions, classes as containers with per-method
  child blocks, and bounded chunks for imports/statements/trivia. Every
  block's content is the exact source slice; concatenated leaf contents
  must reproduce the file byte-for-byte or the file is skipped with a
  typed `coverage_error`. No offsets, line numbers, or spans are
  persisted — identity remains the unchanged SHA-256 Merkle preimage.
- `src/core/repository/` — path safety (POSIX-relative validation, no
  traversal/absolute/NUL/backslash, symlinks skipped unfollowed, vendor
  and generated directories excluded), `git ls-files -z` enumeration via
  an argument vector, a pure manifest diff, durable snapshot membership
  in PostgreSQL (`repository_snapshots`, `repository_snapshot_paths`),
  and the snapshot pipeline with bounded file concurrency and bytes in
  flight. Snapshots publish atomically only after every file ingest and
  tombstone succeeds; a partial failure leaves the previous snapshot
  effective.
- `scripts/ingest_repository.ts` (`npm run repo:ingest`) — default
  `--extract none` (zero paid work); `--extract changed` requires an
  explicit positive `--max-blocks` budget plus `--confirm-extraction`,
  and the exact files/bytes/blocks/paid-job bound prints before any
  write.
- Deletion protocol: a path in the previous published snapshot that is
  absent (or no longer acceptable) now ingests a tombstone version — a
  deterministic empty root with no extraction blocks — which makes its
  prior membership globally dead and queues invalidation. The sweep
  quarantines affected facts; belief history is never deleted. A rename
  is a tombstone plus a new document; content hashes deduplicate
  physically but document identities never merge.

## 2. Live drill results (`npm run test:repo-ingest`, 45 checks)

The drill copies the committed fixture (`fixtures/repo_ingest`: 2
Markdown, 1 TypeScript, 1 Python, 1 JSON file — 1,206 accepted bytes)
into a temporary git repository together with five hostile entries.

| Phase | Result |
|---|---|
| Fresh snapshot via the real CLI, `--extract none` | 5 files ingested, one latest document per path, snapshot 1 published; skip counts pinned: `binary=1, excluded_directory=1, oversize=1, unsupported_extension=1, symlink=1`; stored `code_function` payload re-derives its Merkle id; zero extraction jobs in Redis |
| Unchanged rerun via the CLI | snapshot 2 published with all five paths `unchanged`; zero new document versions |
| One-method edit | only `src/app.ts` re-ingested; Merkle diff added exactly `root + code_class + code_method` (3 nodes) and orphaned their 3 predecessors; both untouched `code_function` hashes survived |
| Delete + rename | `src/util.py` and `docs/overview.md` tombstoned; `docs/handbook.md` registered as a distinct doc key at version 1 sharing the identical physical root hash; the deleted Python function was globally orphaned and its seeded facts quarantined with the dead hash preserved in `orphanedSourceIds`; the renamed paragraph was globally retained by the new doc key and its seeded facts survived |
| Forced single-file failure | run exits nonzero, previous published snapshot remains effective, nothing tombstoned, exactly one unpublished snapshot row; the retry publishes (`ingested=1, unchanged=2, tombstoned=1`) and the handbook fact quarantines once its last live source dies |

Cleanup removed every drill document, snapshot row, membership row,
graph entity, and AST row not shared with other documents; zero residue.

## 3. Entity.name merge lookup (profiled, index shipped)

Session 7 recorded that whole-document merge p50 grew ~5x as the graph
grew ~5.8x while same-graph no-op probes stayed flat, and named
`Entity.name` lookup profiling as the prerequisite before blaming
provenance arrays. Session 8 profiled it on the Session 7 scale fixture:

- `EXPLAIN` showed `ENTITY_MERGE_CYPHER`'s `MERGE (e:Entity {name: …})`
  running as **NodeByLabelScan** — bootstrap constrained only
  `Entity.id`, so every merged entity scanned the whole label.
- An idempotent range index (`entity_name_index`) was added to
  `neo4j_bootstrap.ts`, executed through the same `executeWrite` retry
  path as the constraint and pinned by unit tests. `EXPLAIN` now shows
  **NodeIndexSeek**.

`npm run drill:scale`, same machine, same day (Session 7 committed
numbers were from the same hardware two days earlier):

| Documents | Whole-doc merge p50 (no index) | p50 (with index) | p95 (no index) | p95 (with index) |
|---|---|---|---|---|
| 50 | 50.51 ms | 13.77 ms | 65.42 ms | 18.27 ms |
| 150 | 95.58 ms | 13.24 ms | 127.93 ms | 16.78 ms |
| 300 | 175.92 ms | 14.82 ms | 230.35 ms | 18.59 ms |

Merge latency no longer grows with graph size: the 300-document p50
dropped 11.9x and is now flat across scales, confirming the Session 7
hypothesis that the growth was the name label scan, not provenance
arrays. Same-graph probes (hub 286 sources vs. one-source detail)
remain equal (~4.4–5.1 ms p50 with the index), so array size is still
unindicted.

**The 3.3 #4 migration gate stays closed.** The with-index drill
reported maximum `sourceNodeIds` cardinality 286 (unchanged, threshold
1,000) and fixed-orphan-set sweep latency growth 1.88x against 5.77x
fact growth — below the 1.5×-growth trigger. No `ASTRef`/`EVIDENCED_BY`
migration shipped.

## 4. Cost

Zero paid LLM or embedding calls in every Session 8 acceptance command.
The repository CLI's `--extract changed` path was exercised in
acceptance only with deterministic unit fixtures and budget-rejection
tests. A real extraction run over a repository requires owner approval
after the CLI prints its exact block count; estimate one paid chat
completion plus one embedding call per block from committed telemetry
before approving. One such owner-approved pilot ran after the session's
acceptance closed — see §5.

## 5. Owner-approved extraction pilot (post-acceptance, July 6, 2026)

After acceptance, the owner approved one bounded real-extraction pilot:
`repo:ingest --root src/core/graph --repo-key trellis-graph-pilot
--extract changed --max-blocks 150 --confirm-extraction` (22 TypeScript
files, 112 blocks, budget 150).

**Pipeline:** 112/112 extraction jobs completed with zero failures, zero
dropped actions, and zero unresolved endpoints in ~6 minutes.
**Spend:** 112 `gpt-5.4-2026-03-05` completions (57,323 input / 46,862
output tokens) and 112 `text-embedding-3-small` calls (28,618 tokens).
Output tokens nearly matched input, so extraction cost is
completion-heavy; a full self-ingest (2,532 blocks) extrapolates to
roughly 1.3M input + 1.1M output tokens.

**Graph produced:** 340 entities and 318 relationships carrying pilot
provenance. Genuine API-level facts appeared
(`generatealiascandidates --[constrains_by]-> entity kind`,
`globalentityid --[uses]-> sha-256 hash`), alongside three problems that
are prerequisites for any repository-scale extraction:

1. **Test-fixture contamination.** `alias_candidates.test.ts` fixture
   strings produced `globex corporation --[acquired]-> initech`, and
   name-based entity identity merged those onto the pre-existing demo
   entities — fictional facts from test files gain real-looking
   provenance. The scanner needs a test/fixture exclusion before any
   full-repo `changed` run.
2. **Generic-identifier hubs.** The top pilot entity was literally
   `entity` (14 sources), with `name`, `id`, and `action` close behind.
   At repo scale these become mega-hubs — and a spurious fast path to
   the 3.3 #4 migration trigger.
3. **Prompt mismatch.** The extraction prompt targets "macro-level
   business entities"; on source code it improvises
   (`organization --[is_default_type_for]-> organization`). A code-tuned
   extraction prompt with generic-identifier suppression is needed.

**Cleanup:** the pilot repo key was tombstoned through a second snapshot
(zero accepted files → 22 tombstones) and the invalidation worker swept
the globally dead code-block hashes, quarantining the pilot-derived
facts. Per the conservative mixed-provenance rule, pre-existing demo
entities that had absorbed pilot provenance (e.g. `initech`) are
contested until next re-derived from live bytes — the standard lazy
recovery path.

## 5a. Postscript (July 11, 2026): the §5 prerequisites landed

Session 25 turned the three recorded §5 findings into machinery (all
zero-paid; see the roadmap §5 entry of July 11, 2026 for commands and
counts):

1. **Test-fixture contamination** → the kernel-fixed path classifier
   `isTestOrFixturePath` (`src/core/repository/paths.ts`). Classified
   files still ingest — snapshot completeness, versioning, and
   tombstones are unchanged — but their extraction policy is forced to
   `none` even under `--extract changed`, reported as
   `test_fixture_excluded` file/block counts in the plan echo before
   `--confirm-extraction`.
2. **Generic-identifier hubs** → the deterministic suppression filter
   `suppressGenericIdentifiers` (`src/core/graph/generic_suppression.ts`),
   applied to BOTH prompts after `parseLlmResponse` and before
   `resolveExtractedGraph`: a kernel-constant denylist (the recorded
   offenders `entity`/`name`/`id`/`action` and their kin) plus a
   length-<3 shape rule, dropping touched relationships too — counted
   and logged, never silent.
3. **Prompt mismatch** → additive `sourceKind` routing on the extraction
   job payload (`src/workers/extraction_job.ts`): repository snapshots
   stamp `code`/`prose` per file language; `code` selects a new
   API-level code-tuned prompt; `prose` and every pre-Session-25 payload
   compose the exact legacy prompt bytes (unit-pinned).

The measured before/after — a pilot RE-RUN over `src/core/graph` with
the new machinery — was proposed at 103 blocks ≈ $0.29, approved under
the session's owner approval, and ran the same day: see §5b.

## 5b. Owner-approved pilot RE-RUN with the Session 25 machinery (July 11, 2026)

The same root as the July 6 pilot, through the same CLI, with the
Session 25 machinery live:
`repo:ingest --repo-key trellis-graph-pilot-2 --root src/core/graph
--extract changed --max-blocks 150 --confirm-extraction` (workers:
extraction + invalidation only; supervisor/resolution are
operator-triggered and were not run).

**Plan echo (the exclusion working before any write):** 24 TypeScript
files, 131,111 bytes; 10 files `test_fixture_excluded` (29 blocks
withheld — including `alias_candidates.test.ts`, the recorded
contamination source); paid bound 103 blocks against budget 150. The
snapshot published 24 ingested / 132 eligible / 103 queued / 29
excluded.

**Pipeline:** 103/103 extraction jobs completed with zero failures,
zero merge-dropped actions, and 103 embeddings in ~5 minutes. 35
unresolved endpoints flowed through the name pass-through (the July 6
pilot had 0 — the code-tuned prompt references entities by qualified
name more often; none were errors, and generic unresolved endpoints
were suppressed, see below).

**Suppression observed live:** 14 `extraction.generic_suppressed`
events; 18 entities and 23 actions suppressed
(`trellis_extraction_suppressed_total`). The completions still emitted
`Entity` as an entity on `alias_resolution.ts` blocks DESPITE the
prompt's explicit ban — the deterministic filter dropped it and its
relationships every time. Prompts request, gates enforce: measured.

**Graph produced:** 237 entities and 243 relationships carrying pilot
provenance (July 6: 340/318 from 112 blocks — the code prompt is
sparser per block). The top entity by pilot sources is `ast_nodes` at
4 (July 6: literally `entity` at 14 — maximum hub cardinality 3.5×
lower), and the top 15 are all genuine API-level identifiers
(`classifierusage`, `same_as`, `current_rubric_version`,
`distinct_from`, `orphanedsourceids`, `sourcenodeids`,
`verificationtier`, `./schemas.js`, …). ZERO denylist names carry
pilot provenance — verified by query against the live graph, not just
asserted from the filter's structure.

**Fixture containment:** `globex corporation` (1 source) and `initech`
(2 sources) are byte-unchanged from the pre-run baseline and still
contested from the July 6 cleanup — their fixture source blocks never
reached the queue.

**Residual, recorded not acted on:** three near-generic names sit at
low cardinality (`concept`, `kind`, `generic` — 3 pilot sources each).
These are the first OBSERVED counts for future denylist candidates;
per the kernel-gate rule, additions require observed counts to justify
them, and 3 sources is not a hub.

**Spend:** 55,891 input / 40,545 output completion tokens
(`gpt-5.4-2026-03-05`) + 20,543 embedding tokens — 2.5% fewer input
and 13.5% fewer output tokens than the July 6 pilot's $0.31, ≈ $0.28
at the same prices (token-ratio bounds $0.27–$0.30), under the $0.29
estimate.

**Cleanup:** snapshot #2 tombstoned all 24 paths (zero accepted
files); the invalidation worker swept the globally dead hashes;
post-sweep, EVERY entity carrying pilot provenance live or orphaned
(521 total — the count includes July 6 pilot residue, since identical
file bytes share content-addressed block hashes across repo keys)
reads contested, zero uncontested. The standard lazy recovery path
applies, exactly as after the July 6 pilot.

## 5c. Owner-approved pilot RE-RUN with the decontaminated code prompt (July 12, 2026)

The same root through the same CLI, one day after §5b, with the July 12
prompt-engineering revision of the code-tuned extraction prompt live
(hypershot fact frame, no concrete repository-symbol examples, positive
specificity rule in place of the enumerated generic-name ban —
`extraction_job.ts`, commit 0c090d7):
`repo:ingest --repo-key trellis-graph-pilot-3 --root src/core/graph
--extract changed --max-blocks 150 --confirm-extraction` (workers:
local `dev:workers`; only extraction + invalidation saw jobs).

**Corpus delta vs §5b, recorded:** 26 files / 142,383 bytes vs 24 /
131,111 — the Session 25 `generic_suppression.ts` + test pair landed
after §5b's checkout. 11 files `test_fixture_excluded` (34 blocks
withheld); paid bound 107 blocks vs §5b's 103; the 103 shared blocks
are byte-identical (content-addressed).

**Pipeline:** 107/107 extraction jobs completed, zero failures, queue
drained in ~7 minutes.

**Operational defects found and fixed during the run (recorded per
Guardrail 8):** (1) a STALE §5b-era pilot worker process from another
worktree (`_pilot_workers.tmp.ts`, running for days, holding metrics
port 9464) was still consuming `extraction_queue` — killed BEFORE
enqueueing, or the jobs would have run under the OLD prompt bytes;
(2) this session's own first `dev:workers` instance was orphaned by a
parent-process stop (Windows: killing the npm wrapper leaves the node
child alive) and consumed 53 of the 107 jobs — SAME worktree and SAME
new prompt bytes, so the graph measurement is unaffected, but token
and suppression counters cover only the surviving instance's 54 jobs.
Lesson recorded: kill worker trees by child PID on Windows, and check
for stale queue consumers before any paid enqueue.

**Spend (54-job measured basis, extrapolated for the full 107):**
measured 31,742 input / 9,997 output completion tokens + 12,034
embedding tokens. Per queued block: 588 input (+8% vs §5b's 543 — the
revised prompt is slightly longer) and **185 output (−53% vs §5b's
394)**. Extrapolated full run ≈62.9k in / 19.8k out — at any single
price basis roughly one-third cheaper than §5b
(≈$0.18 at §5b's own reported basis; §5b was $0.28).

**Graph produced:** 160 entities and 90 relationships carrying pilot
provenance (§5b: 237/243 from 103 blocks) — the revised prompt is
substantially sparser, which is the prompt's stated design goal ("a
few load-bearing API facts"); whether the extra sparsity loses
task-relevant facts is NOT decidable from graph shape alone and is
recorded as an open question for a retrieval-task eval. Top hubs:
`same_as` and `ast_nodes` at 4 pilot sources (max hub cardinality
unchanged vs §5b), top 15 all genuine API-level identifiers
(`trec_labels`, `module_entity_kind`, `current_rubric_version`,
`select_resolution_entities_cypher`, `config.llm.extractionmodel`, …).

**The decontamination checks (the run's purpose):**
- **ZERO denylist names with pilot provenance** — parity with §5b,
  now achieved WITHOUT naming the banned tokens in the prompt.
- **ZERO hypershot-variable leakage**: no entity name contains any
  frame-variable fragment (`exported_symbol`, `specific_verb`,
  `exactly_as_written`, `module_config_key`) — the frame primed
  structure without priming content, live-verified.
- **Residual near-generics shrank**: `concept` at 1 pilot source
  (§5b: `concept`/`kind`/`generic` at 3 each).
- **Suppression (partial accounting)**: the measured instance logged 4
  `extraction.generic_suppressed` events (4 entities + 5 actions) over
  its 54 jobs vs §5b's 14 events (18 + 23) over 103 — directionally
  fewer generic candidates emitted upstream, consistent with the
  positive-rule change, but the orphaned instance's counters were lost
  so this is indicative, not conclusive.

**Cleanup:** snapshot #2 tombstoned all 26 paths (zero accepted
files); the invalidation sweep quarantined exactly the 160
pilot-provenance entities (contested 394 → 554; entity total unchanged
at 796 — quarantine, never delete); both queues drained; the standard
lazy recovery path applies.

## 5d. Stage 1: the durable self-extraction substrate (Session 34, July 13, 2026)

*Roadmap §4 row 11 stage 1 — the owner-approved scaling flywheel, step 4
of 4 in the July 12, 2026 tooling-shape sequence. Decisions recorded
BEFORE the run; measured results appended after it.*

### 5d.1 The scope machinery (zero-paid, this session)

The budget gate rejects a whole snapshot whose post-exclusion bound
exceeds `--max-blocks` — there is no partial queueing — so a
full-repository `changed` run either fits one budget or does not run at
all. The July 13 full-scope dry run priced 4,575 post-exclusion blocks
(~$12.35 at the §5b measured rate): over the standing ≤$5/run cap, so
scope selection became a required capability, not a convenience.

`repo:ingest` gained a repeatable `--include <prefix>` flag
(`SnapshotOptions.includePrefixes`, Session 34):

- Only paths under an included prefix (segment-boundary match; `src`
  covers `src/a.ts`, never `src2/a.ts`) are read, parsed, planned, and
  ingested. Doc keys stay root-relative, so scoped and full runs agree
  on identity for every path.
- A previously effective path OUTSIDE every prefix is **carried
  forward**: re-published in the new snapshot at its previous root
  hash, never read, never re-ingested, and — decisively — **never
  tombstoned by a run whose scope does not cover it**. Deletion
  decisions belong to runs whose scope covers the path.
- An out-of-scope path with no prior version is a typed `out_of_scope`
  skip. (Because out-of-scope files are never read, parse-level skip
  reasons such as `binary` cannot apply to them — drilled.)
- An invalid prefix (`..`, absolute, backslash, empty) refuses before
  any I/O. Unset or empty scope is byte-identical to pre-Session-34
  behavior (unit-pinned by plan equality).
- The plan echo prints `scope:` and `carried forward:` lines before any
  confirmation, and the summary/result carry a `carriedForward` count.

Pins: `snapshot_ingest.test.ts` 17 → 24 unit tests;
`npm run test:repo-ingest` 56 → 82 live checks (Part 7: scoped
plan/execute, carry-forward of an *edited* out-of-scope file at its
pre-edit hash, deferred pickup by a covering full-scope run, in-scope
deletion still tombstoning under scope, CLI flag round trip, invalid
prefix refusal).

Operational consequence, recorded: a later scoped run whose scope
covers path P adjudicates P's liveness (tombstones it if absent); a
scoped run whose scope does not cover P leaves P exactly as the last
covering run did. Chunked scope staging under ONE repo key is therefore
safe: chunk N+1 picks up deferred paths as ordinary changed-mode
ingests (drilled in Part 7).

### 5d.2 Stage-1 decisions

- **Repo key `trellis`, root = repository root.** Doc keys are
  `repo:trellis:<repo-relative-path>` — stable across scoped and full
  runs, and a file rename remains tombstone + new document.
- **Scope: `src`, `scripts`, `modules`.** The code substrate stage 2
  queries when editing code — 298 accepted files, printed
  post-exclusion bound **1,423 blocks** (112 files / 498 blocks
  `test_fixture_excluded`; 77 `out_of_scope` skips at plan time).
- **Deferred, not rejected — `docs/` + root-level prose** (~2,900
  blocks ≈ $7.8 at the §5b rate): its own chunked proposal if the owner
  wants the architecture records queryable; the Session 25 routing
  sends Markdown to the LEGACY prose prompt by design, and that
  prompt's per-block value on engineering narrative is unmeasured.
- **Excluded by decision — `data/`** (231 blocks): the four durable
  measurement corpora are *object* text (a Gutenberg novel, synthetic
  ledgers), not knowledge about Trellis. Extracting them would pour
  novel characters and synthetic households into the same graph the
  self-substrate lives in. They stay ingestible (Tier-1 bytes,
  liveness) but out of every extraction scope this stage defines.
- **Durability: the residue PERSISTS.** No tombstone-and-sweep cleanup
  (the pilots' cleanup protocol explicitly does NOT apply). The dev
  graph becomes live self-substrate: `repo:trellis:*` documents join
  the durable list beside the probe corpora — drills keep cleaning
  token-scoped state only. Future sessions refresh the substrate by
  re-running the scoped snapshot: changed files re-extract their new
  blocks, and the Merkle diff → invalidation sweep contests beliefs
  whose source blocks died — the ordinary churn loop, now applied to
  Trellis's own code.
- **Estimate:** 1,423 blocks × ≈$0.0027/block (§5b measured, chat +
  embedding) ≈ **$3.84 ceiling**; the §5c revised-prompt basis
  (≈$0.0017/block) predicts ≈ **$2.4**. Under the standing ≤$5/run
  cap. Owner approval for this session's paid runs was given up front;
  the run proceeds at the printed bound.

### 5d.3 The quality-acceptance criterion (pre-stated)

Counts and spot checks together, never counts alone:

1. **Pipeline:** jobs completed = blocks queued, zero failed jobs, zero
   merge-dropped actions unaccounted.
2. **Exclusion:** the executed run's exclusion counts match the plan
   echo (112 files / 498 blocks withheld); zero extraction jobs carry a
   test/fixture path's doc key.
3. **Suppression:** `generic_suppressed` events counted; ZERO denylist
   names carry `repo:trellis` provenance, verified by live graph query.
4. **Hub shape:** max hub cardinality (by distinct stage-1 source
   blocks) ≤ 8% of queued blocks — twice the §5b good-shape ratio
   (4/103 ≈ 3.9%) — and the top 15 entities are all genuine API-level
   identifiers, published with the distribution.
5. **Spot checks:** named kernel surfaces (e.g. `write_derived_insight`,
   `parseLlmResponse`) resolve to entities whose `sourceNodeIds` fetch
   back real `ast_nodes` bytes containing the identifier.

### 5d.4 Measured results (the run, July 13, 2026)

`repo:ingest --repo-key trellis --root . --include src --include
scripts --include modules --extract changed --max-blocks 1450
--confirm-extraction` from the session worktree (workers: a fresh
`dev:workers` instance started after the stale-consumer check found
none; killed by child-PID tree after the drain, per the July 12
lesson).

**Snapshot:** `trellis#1` published — 298 ingested / 0 unchanged / 0
tombstoned; 1,921 blocks eligible, **1,423 queued** (the printed bound
exactly), 498 excluded (`test_fixture_excluded`, 112 files) — the
executed counts match the plan echo line for line.

**Pipeline:** 1,423/1,423 extraction jobs completed, zero failures,
queue drained in 53m42s (serial worker — BullMQ default concurrency 1;
~26 jobs/min end to end). 22 unresolved endpoints flowed through the
name pass-through; the merge dropped 9 actions whose endpoints matched
no entity (counted and logged, never silent — the pilots' §5b run had
zero at 103 blocks; ~0.6% of 1,423 jobs is recorded as the observed
base rate for the code prompt at scale).

**Spend (worker metrics, fresh instance = exact):** 1,423
`gpt-5.4-2026-03-05` completions — 892,363 input / 325,335 output
tokens (627 in / 229 out per block vs §5c's 588/185) — plus 1,423
`text-embedding-3-small` calls, 388,944 tokens. At the same price
basis that reproduces §5b's $0.28: **≈ $2.75** (estimate band was
$2.4–$3.84; the $3.84 ceiling held).

**The pre-stated criterion, all five parts:**

1. **Pipeline** — PASS (above).
2. **Exclusion** — PASS: queued = 1,921 − 498 = 1,423 exactly; the
   exclusion behavior itself is drill-pinned (Part 6/7).
3. **Suppression** — PASS: 19 `extraction.generic_suppressed` events
   (22 entities + 28 actions dropped); ZERO denylist names carry
   stage-1 provenance, verified by live graph query.
4. **Hub shape** — PASS: max hub `ast_nodes` at 29 distinct stage-1
   source blocks = **2.04%** of queued (criterion ≤ 8%; §5b good
   shape 3.9%). Top 15 (all genuine API-level identifiers):
   `ast_nodes` 29, `main` 28, `neo4jdriver` 27, `pgpool` 26,
   `node.js` 23, `derived_insight` 16, `trellis_mcp_servers` 15,
   `trellis_modules` 12, `config.python.executable` 12,
   `config.llm.extractionmodel` 11, `documents` 11, `eslint` 11,
   `question` 10, `config.python.pythonpath` 9, `document_nodes` 9.
   Residual observation, recorded not acted on: `main` at 28 is the
   cross-file function-name class (every CLI's `main` merges by
   name) — the first observed count for a future denylist candidate;
   per the kernel-gate rule an addition needs review, and `main` is a
   genuine identifier, so it stands as data.
5. **Spot checks** — PASS: `write_derived_insight` (4 entities, e.g.
   `trellis_neo4j.write_derived_insight`), `parsellmresponse`,
   `trellis_postgres.get_ast_blocks`, `trellis_answer.submit` all
   resolve with stage-1 provenance; a cited hash fetched from
   `ast_nodes` returned real block bytes containing the identifier
   (thread-back verified against stored bytes, not just counts).

**Graph produced:** 1,995 entities and 1,788 ACTION relationships now
carry stage-1 provenance (dev-graph totals 2,613 / 2,366 — the count
includes pre-existing entities, e.g. pilot-era `ast_nodes`, that
absorbed live stage-1 provenance; mixed-provenance recovery semantics
unchanged). The residue PERSISTS — no cleanup, by design (§5d.2).

### 5d.5 Stage-2 seam observations (recorded, nothing implemented)

What a graph-informed self-edit increment would actually ask, observed
against the live substrate:

- **"What depends on the surface I am editing?"** —
  `MATCH (e:Entity {name: 'trellis_neo4j.write_derived_insight'})<-[r:ACTION]-(caller)`
  style queries now return real callers/consumers with block-hash
  provenance; the edit run can fetch the cited blocks
  (`get_ast_texts`) to read the actual call sites before splicing.
- **"Which file owns this entity?"** — provenance hashes join
  `document_nodes`→`documents` rows, so `repo:trellis:<path>` doc keys
  give the toolkit the exact file to `load` — the graph-to-textedit
  bridge needs NO new machinery, just Cypher + the existing
  `trellis_postgres`/`trellis_textedit` surfaces.
- **Freshness is the loop's own churn:** an edit that lands and
  re-ingests (scoped snapshot rerun) re-extracts changed blocks and
  contests beliefs whose blocks died — the substrate self-corrects at
  exactly the granularity the edit touched.
- **Gap worth noting for the stage-2 design record:** entity names are
  lowercase-normalized (`parsellmresponse`), so name lookups from
  source identifiers need the same normalization
  (`globalEntityId`'s) — a resolved lookup helper, not raw
  string-match, is the right seam.
- **Worker throughput observation (not stage-2 blocking):** the
  extraction worker is serial by construction; a substrate refresh
  after a large merge re-extracts at ~26 jobs/min. If refresh latency
  ever matters, worker concurrency needs its own merge-safety pins
  (concurrent same-name entity merges are undrilled) — a reviewed
  kernel change, not a config flip.

### 5d.6 Substrate freshness policy (ADOPTED July 13, 2026 — owner direction)

Recommended at stage-1 close; the owner confirmed the direction the
same day (post-Session-35 exchange): NOT real-time, staleness
tolerable between refreshes, cadence = one scoped refresh per merged
PR plus refresh-before-use ahead of edit runs. Adoption sets the
default cadence only — every refresh's extraction spend stays
operator-gated per run (Guardrail 4, unchanged).

The residue ages as code changes. The Merkle diff makes refresh
INCREMENTAL by construction — unchanged files are auditable no-ops and
only changed blocks re-extract — so a typical session's refresh is
tens of blocks (≈ $0.05–$0.25 at the measured stage-1 rate), not a
re-run of the $2.75 baseline.

- **Not real-time.** Extraction spend is operator-gated per run
  (Guardrail 4, permanent), and nothing consults the substrate between
  merges — per-commit refresh would buy churn, not freshness.
- **Recommended cadence:** one scoped-snapshot refresh per MERGED
  session PR (the zero-paid plan echo prints the changed-block bound;
  the operator approves the increment), and ALWAYS a refresh before
  any stage-2 edit run whose target area changed since the last
  snapshot (refresh-before-use).
- **Why stale is tolerable between refreshes — the failure shape is
  right:** staleness can degrade ADVICE (a query may cite a
  previous-effective version's blocks), but it cannot corrupt an
  ACTION. The stage-2 edit path re-reads current bytes through
  `trellis_textedit.load` and the hash-guarded `write_back` refuses on
  any divergence (`StaleFileError`, write-time containment
  re-verification) — an edit premised on stale knowledge is REFUSED at
  the disk boundary, never silently applied. Advisory reads mitigate
  the same way the write gate teaches: fetch the cited bytes and
  confirm before relying.
- **Quality follow-up, propose-with-estimate:** a one-time targeted
  entailment sweep over stage-1 provenance pairs (~100 pairs ≈ $0.04
  at the measured July 13 sweep rate) would convert the semantic
  layer's sampled-audit coverage from opportunistic to deliberate for
  this corpus — standing owner item.
- **Model portability note (owner framing confirmed July 13, 2026):**
  the extraction pipeline is model-agnostic at its boundaries —
  `EXTRACTION_MODEL` is env configuration and every completion crosses
  `parseLlmResponse` — so a future local-model deployment is a
  configuration change plus a re-embedding pass, not a rearchitecture.
  Third-party pricing is an economics input, not a structural
  dependency. The project is proving the concept now and building on
  it: scalability is kept in mind (incremental refresh, bounded spend,
  recorded follow-ups like worker concurrency with merge-safety pins)
  and improves further later — recorded residuals are follow-ups, not
  blockers.

## 5e. Stage 2, increment 1: the graph-informed self-edit (design record, Session 35, July 13, 2026)

Recorded BEFORE any harness code or run, per the house document-first
pattern. This section operationalizes the §5d.5 seam observations as
the first stage-2 increment: one bounded task in which an edit run
must consult the stage-1 substrate about the code it is editing. The
increment demonstrates the NEW loop (query → read cited bytes → edit)
at LOW edit risk; it does not deepen edit risk. Cross-referenced from
the roadmap §5 Session 35 entry.

### 5e.1 The target (found by inspection, verified against the live substrate)

`src/rlm/trellis_tools.py` carries two stale statements, both written
in Session 30 (slice (b)) and both falsified by Session 31 (slice (d)):

1. The module-level comment above `_retrieved_addresses` claims
   "slice (d) will constrain citable addresses to this set on every
   run. Bookkeeping only today — no write-path behavior reads it
   yet."
2. The `get_retrieved_addresses` docstring ends "Slice (d)'s future
   input."

Both are false today: `_verify_hashes_retrieved` consumes the set on
every gated write, wired through the `retrieved_addresses_check`
constructor seam (`trellis_agent.py` research runs). This is exactly
the HANDOFF §3 example shape — a stale cross-reference comment that
misstates a dependency — and the correction is comment/docstring-only:
zero executable lines change, so edit risk is minimal while the edit
content still DEPENDS on graph-verified facts.

Live-substrate evidence observed while selecting the target (recorded
here; the drill re-proves the same bridge on a hermetic fixture):

- Entity `get_retrieved_addresses` exists in the dev graph with one
  ACTION edge (`verb: returns_copy_of` → `_retrieved_addresses`)
  whose provenance hash `1f594ea9…ca61` bridges through
  `document_nodes` → `documents` to
  `repo:trellis:src/rlm/trellis_tools.py` (version 1, current), and
  the stored block bytes are the `get_retrieved_addresses` function
  INCLUDING the stale docstring.
- The consumer blocks are in the substrate too:
  `667501…dc3e` (`_verify_hashes_retrieved`) and `faefe76e…6ace`
  (`_run_insight_writes`, the caller). No graph entity for
  `_verify_hashes_retrieved` exists yet — the run's recorded insight
  fills a real gap.

### 5e.2 The named failure mode and how the harness detects it

**Graph-misdirected editing:** the run touches a file the graph
evidence did not name, or edits on the basis of contested
(quarantined) beliefs. Detection is post-run and mechanical:

1. **Scope:** `git status --porcelain` under the edit root must show
   exactly the named file (`src/rlm/trellis_tools.py`) modified —
   any extra path is `out_of_scope_edit`, a missing named file is
   `named_file_unchanged`. (The harness runs read-only `git status`;
   the toolkit itself never touches git — Session 26 precedent.)
2. **Evidence:** the run must record exactly one derived insight
   (subject `_verify_hashes_retrieved`, verb `consumes`, object
   `get_retrieved_addresses`) citing the blocks it fetched. The
   Session 31 write gate makes this trail mechanical: a hash that was
   never retrieved in-run cannot be cited, so a successful write IS
   proof the graph/store was consulted. The checker then verifies:
   the edge exists and is uncontested, both endpoints are
   uncontested, every cited hash exists in `ast_nodes` AND is a
   member of the CURRENT version of a document whose key bridges
   (doc-key prefix `repo:trellis:`) to a named file. Violations:
   `evidence_edge_missing`, `empty_evidence`, `contested_evidence`,
   `dead_evidence_hash`, `unbridged_evidence`.
3. **Pre-check (refresh-before-use spirit):** before the run, the
   harness verifies the target entity exists and is uncontested, its
   ACTION edges are uncontested, and the named file's substrate
   document is present — an edit premised on quarantined beliefs is
   refused before any spend.

HONEST SCOPE: the checker proves the RECORDED evidence chain (which
the write gate enforces mechanically) and the diff scope. It does not
prove every byte the run read, and it does not prove the graph query
temporally preceded the edit — the run transcript (plus the opt-in
`TRELLIS_CITATION_AUDIT=1` line, set in the run's own environment per
the A/B-eval precedent) carries that, and the human review reads it.

### 5e.3 The harness machinery (zero-paid, this session)

- `src/benchmarks/selfedit/check.ts` — pure: porcelain parsing, scope
  evaluation, evidence evaluation, pre-check evaluation; typed
  findings; unit-pinned in `check.test.ts`.
- `scripts/stage2_selfedit_check.ts` — the operator CLI
  (`--pre` / post-run modes): gathers git status (read-only), the
  Neo4j edge/contested state, and the PG hash-liveness/doc-key
  bridge, then evaluates. Non-empty findings exit 1.
- `scripts/test_selfedit_harness.ts` + `test_selfedit_rehearsal.py`
  (`npm run test:selfedit-harness`) — the live zero-LLM drill:
  a token-scoped hermetic fixture (documents/document_nodes/ast_nodes
  rows + planted DERIVED_INSIGHT edges) proves the bridge query and
  every detection code fires (planted out-of-scope edit FLAGGED,
  planted contested/dead/unbridged evidence FLAGGED); the Python
  rehearsal drives the run's REAL tool sequence — `run_cypher` →
  `get_ast_texts` → `trellis_textedit` load/locate/splice/write_back
  → the retrieval-gated `write_derived_insight` — against the fixture
  in a scratch git repo, in a clean arm (checker passes) and a
  violation arm (unretrieved citation refused by the live gate;
  out-of-scope edit flagged by the checker). A live-substrate smoke
  (read-only) confirms the bridge against `repo:trellis:*` when the
  substrate is present and prints SKIP when it is not.

### 5e.4 The run proposal (owner-gated; NOT run this session unless approved)

- **Edit root:** the session branch checkout (the worktree that ships
  this PR) — the human `git diff` review is then the ordinary PR
  review. `TRELLIS_EDIT_ROOT` set in the spawn environment only.
- **Spawn (Session 26 mechanics):** `trellis_agent.py` spawned
  directly, research mode, `--max-iterations 12`, env: `NEO4J_*`,
  `PG_DSN`, `PYTHONPATH`, `TRELLIS_EDIT_ROOT=<checkout>`,
  `TRELLIS_CITATION_AUDIT=1` (observation), `OPENAI_API_KEY`.
- **The task text (the run INPUT, verbatim — never a kernel prompt
  byte; both composed-prompt pins stay unmoved):**

```
Stage-2 self-edit task (increment 1).

The file src/rlm/trellis_tools.py contains two stale statements
written before Session 31:
(1) the module-level comment above the _retrieved_addresses set
    claims "slice (d) will constrain citable addresses to this set
    on every run. Bookkeeping only today - no write-path behavior
    reads it yet."
(2) the get_retrieved_addresses docstring ends "Slice (d)'s future
    input."

Verify against the knowledge graph and the stored source bytes what
actually consumes the retrieved-address set today, then correct BOTH
stale statements so they accurately name the consumer.

1. Resolve the graph entity named 'get_retrieved_addresses' (entity
   names are lowercase-normalized) with trellis_neo4j.run_cypher;
   list its ACTION edges and their sourceNodeIds provenance hashes.
2. Fetch those provenance blocks with trellis_postgres.get_ast_texts
   and read them.
3. Find the write-path consumer with trellis_postgres.vector_search
   (for example 'retrieval membership write gate cited hashes') and
   fetch the blocks defining _verify_hashes_retrieved and its
   wiring; confirm from the fetched bytes that the write path
   consumes the set through the retrieved_addresses_check
   constructor seam.
4. Edit ONLY src/rlm/trellis_tools.py through trellis_textedit
   (load, locate, splice, diff, write_back): correct the two stale
   statements to say slice (d) is live - the write gate
   _verify_hashes_retrieved consumes this set through the
   retrieved_addresses_check seam on research runs; bare
   construction is unaffected. Keep both hunks
   comment/docstring-only; change no executable line; preserve the
   surrounding sentences that are still true (the
   NOT-experiment-gated statement and the telemetry sentence).
5. Record exactly one derived insight:
   trellis_neo4j.write_derived_insight(
     subject='_verify_hashes_retrieved', verb='consumes',
     obj='get_retrieved_addresses',
     sourceNodeIds=[the hashes of the blocks you fetched that show
     this]).
6. Submit a short report via trellis_answer.submit describing what
   the graph said, what the bytes confirmed, and what you changed.

Edit no other file. If the graph or the fetched bytes contradict the
task premise, stop, make no edit, and report the contradiction
instead.
```

- **The pre-scoped edit (semantic acceptance for the diff):** exactly
  two hunks in `src/rlm/trellis_tools.py`, both comment/docstring
  bytes only. Hunk A (the module comment): keeps the
  NOT-experiment-gated statement and the telemetry sentence, and
  replaces the "will constrain … no write-path behavior reads it
  yet" claim with the live fact — slice (d) landed (Session 31);
  `_verify_hashes_retrieved` refuses citations outside this set,
  wired via the `retrieved_addresses_check` constructor seam on
  research runs; bare construction unaffected. Hunk B (the
  docstring): "Slice (d)'s future input." becomes the live-input
  statement naming the consuming gate. Exact wording is the run's;
  the human review judges it against the fetched bytes.
- **Estimate:** W-series basis (W1 ≈$0.06, W2 ≈$0.18, W3 ≈$0.06 per
  run; this task is W2-complexity plus a vector_search and a gated
  write): **$0.15–$0.45 for one run; propose one run plus at most
  one contingency re-run after a diagnosed clean failure — ≤$0.90
  total**, well under the ≤$5/run cap. Actuals recorded in the
  roadmap regardless of outcome.
- **Acceptance criterion (pre-stated; also in the roadmap entry):**
  (1) scope: exactly the named file changed; (2) the diff implements
  the pre-scoped edit and lands only after human `git diff` review;
  (3) the checker reports ZERO findings (evidence edge present,
  uncontested, live, bridged to the named file); (4) counts and the
  diff reported TOGETHER — db tool calls, retrieval-discipline
  counts, textedit ops, `answer_submits`, actual dollars vs the
  estimate; (5) a harness flag means the increment FAILED — record
  it and stop, no silent retry.

### 5e.5 The measured run (Session 36, July 13, 2026 — owner-approved; run 1 failed review, run 2 landed)

- **Pre-flight:** `stage2:check --pre` PASS on the merged Session 35
  baseline; edit root = the session worktree, `git status
  --porcelain` empty; the stale bytes confirmed in place.
- **Run 1 — FAILED at human `git diff` review ($0.2134; 72,279 in /
  3,268 out; 9 db tool calls; 20 textedit ops / 2 write_backs).**
  Hunk A correct. Hunk B: the splice range [93,95) covered the `def`
  line instead of the docstring tail; the run saw the wrong diff
  preview and wrote back anyway; a repair splice still left the
  stale docstring tail as dead bytes below the function body; the
  final verification read and `trellis_answer.submit` sat in the
  SAME REPL cell, so the printout showing the leftover stale line
  could not inform the already-submitted success claim. File left
  syntax-broken (`unmatched ')'`). `stage2:check` reported zero
  findings — correctly: scope and the evidence chain WERE clean; the
  checker proves consultation and scope, not diff semantics (§5e.2),
  and the criterion places diff semantics with the human reviewer,
  where run 1 was caught. Toolkit behavior per contract throughout.
  Failure class: the run's localization/verify discipline
  (verify-then-submit collapsed into one cell). Tree reverted;
  contingency re-run per the recorded proposal.
- **Run 2 — LANDED ($0.3520; 120,135 in / 5,165 out).** All five
  criterion items pass: named-file-only diff; the pre-scoped
  comment/docstring-only edit (both stale claims excised, the
  consumer and seam named, surrounding true sentences preserved;
  two long unwrapped lines accepted at review as style-only);
  `stage2:check` zero findings; counts together — 8 db tool calls,
  5 retrieval fetches / 1 dedup refusal / 0 budget refusals, 33
  textedit ops / 1 write_back, `answer_submits` 1, `py_compile` +
  `npm test` 771/81 + `python:check` + `test:textedit` green with
  the diff applied; no harness flag. The recorded insight
  (`_verify_hashes_retrieved` `consumes` `get_retrieved_addresses`)
  cites the two fetched consumer blocks (`66750136…`, `3e478e14…`) —
  a Session 31 gated write, so consultation is proven mechanically.
- **The refresh (the freshness policy's first execution; $0.102 —
  14,751 in / 6,531 out / 5,991 embedding tokens):** plan echo
  first (8 files, 59-block bound, 0 tombstones), then snapshot
  `trellis#2` — 24/24 jobs, zero failures; `trellis_tools.py` v2
  (3 orphaned / 3 added / 38 retained). Churn verified: the old
  docstring block `1f594ea9…` dead in v2, the stage-1
  `returns_copy_of` ACTION edge contested with provenance preserved
  in `orphanedSourceIds`; run 2's insight edge SURVIVED (it cites
  the unedited consumer blocks — evidence outliving the edit);
  recovery = an operator re-derivation citing the new v2 block
  `09281f45…` (the contested ACTION edge stands as the audit record
  per the lazy-recovery precedent; re-extraction did not reproduce
  the exact triple — extraction variance, counted: 1 suppression,
  2 unresolved endpoints across 24 jobs).
- **Increment verdict: PASSED on run 2 under the pre-stated
  criterion; run 1 recorded as the diagnosed contingency.** Session
  paid total $0.667 ($0.565 runs vs ≤$0.90; $0.102 refresh vs
  ≈$0.05–$0.25).

## 5f. Stage 2, increment 2: the parse gate + the deep-context self-edit (design record, Session 37, July 13, 2026)

Recorded BEFORE the run, per the house document-first pattern.
Increment 1's measured lesson (§5e.5): run 1 shipped a syntax-broken
named file that the checker passed — correctly, per its recorded scope
— and only human review caught. Increment 2 (a) closes that escape
mechanically with the parse gate, landed zero-paid FIRST, and (b)
takes one owner-scoped step deeper on the edit ladder with a NEW named
failure mode. Cross-referenced from the roadmap §5 Session 37 entry.

### 5f.1 The parse gate (zero-paid, landed before the run)

`named_file_unparseable` joins the typed finding list: the post-run
mode of `stage2:check` now parses every named file — `.py` through the
operator-configured interpreter (`config.python.executable`) running
the builtin `compile()` over the file bytes (the same syntax check
`python -m py_compile` performs WITHOUT its bytecode write into the
edit root: the checker stays read-only, so `__pycache__` residue in
the reviewed tree is not acceptable), `.ts`/`.js` through the
TypeScript compiler's single-file parse diagnostics (no project
resolution, no type check, no emit). Extensions with no parser wired
are recorded as unchecked and never flag — the gate is honest about
what it checks. Post-run mechanical check only, never a write gate
(guardrail 5's mold). Pure evaluation (`checkParseResults`,
`parseGateLanguage`) in `check.ts`; gatherers in `parse_gate.ts`;
11 unit pins (`npm test` 771 → 782) including the planted run-1 shape
per language; drill section [6] (`test:selfedit-harness`) plants the
EXACT preserved run-1 failed-diff shape — the stale docstring tail
left as dead bytes below a live function body — and observes
`named_file_unparseable` fire through the real interpreter.

### 5f.2 Candidate selection (by substrate query, the increment mold)

Selection ran as queries over the CURRENT versions of `repo:trellis:*`
documents (PG `documents`/`document_nodes`/`ast_nodes` joins) plus
Neo4j entity/edge state — not by reading the working tree. The
staleness family that produced increment 1 (`content ~* 'slice \(d\)
will'`) has exactly THREE surviving occurrences:

1. **SELECTED — `src/rlm/trellis_agent.py` (block `2f703511…2514`,
   `code_function`, 13,656 bytes, the `main()` body):** the
   research-mode telemetry comment reads "Bookkeeping; slice (d)
   will constrain citable addresses to the set itself." — written in
   Session 30, falsified by Session 31, and doubly false in THIS
   file: eleven lines of the same block earlier, the research path
   itself constructs `TrellisNeo4j(...,
   retrieved_addresses_check=get_retrieved_addresses)` — the file
   carrying the stale "will" claim is the file that wires the live
   consumer.
2. **REJECTED — `src/rlm/trellis_tools.py:78`** ("slice (d) will
   constrain citable addresses to this set on research runs: …"):
   future-tense residue INSIDE the landed increment-1 diff. That diff
   is measured evidence (HANDOFF §8: never hand-improved; any change
   there is a NEW owner-visible edit) — recorded as data, not a
   target.
3. **REJECTED — `scripts/test_selfedit_harness.ts:102`**: the
   rehearsal fixture's deliberately planted stale line ("STALE:
   slice (d) will constrain this set…") — fixture bytes, not a stale
   claim; editing it would break the drill.

Broader staleness families were queried and came back EMPTY of
genuine hits: future-session claims (`a future session|later session
will|once (row|slice|session)|not yet wired|no (consumer|reader|
caller)|forward note`), stale count-claims in string literals, and
executable-string staleness in refusal/teaching/CLI-help text (all
current — sessions that changed behavior updated their strings). The
honest consequence for the ladder: the substrate's surviving
falsifiable staleness is comment-class. Inventing an executable-line
edit with no graph-derived falsifiable basis would break the
increment mold (graph-derived staleness IS the point), so the step up
is taken on the axes the target genuinely offers:

- **Depth:** the target sits ~578 lines into the file, INSIDE the
  13.7 KB `main()` function body, dense executable neighbors on both
  sides — exactly the region class where run 1's mis-splice broke the
  file, now with the parse gate watching mechanically.
- **Near-duplicate disambiguation:** the file contains TWO telemetry
  dict constructions each carrying an identical
  `"retrieved_addresses": get_retrieved_address_count(),` line — the
  author-mode dict (~line 352, whose comment is NOT stale) and the
  research-mode dict (~line 579, the target). A `locate` on the
  shared bytes returns multiple engine-computed addresses; the run
  must disambiguate by address and surrounding bytes, not by
  attention.
- **Task-text discipline (the run-1 lesson):** the verification read
  must sit in its OWN REPL iteration, with submission only in a LATER
  iteration after the printed confirmation — run input, never a
  kernel prompt byte.

### 5f.3 The named failure mode and how it is detected

**Near-duplicate mis-targeting:** the run edits the WRONG one of two
near-identical sites in the named file. By construction this is
invisible to the scope check (the edit is in the named file) AND to
the parse gate (a comment edit at the wrong site still parses) — it
is the next escape class after increment 1's two. Detection is
pre-stated and mechanical at review:

1. The diff has exactly ONE hunk, and its `@@` range lies within the
   research-mode telemetry region (after the research path's
   `TrellisNeo4j` construction; the author-mode region byte-identical
   — `git diff -U0` hunk header + a byte comparison of the
   author-mode comment block).
2. Every changed content line is a comment line (leading whitespace
   then `#`) — zero executable-line changes.
3. The standing checks continue: scope (`out_of_scope_edit` /
   `named_file_unchanged`), evidence (the Session 31 gate-verified
   insight), and the NEW parse gate (`named_file_unparseable`).

These review-time checks are recorded criterion items with exact
commands, not new checker machinery — the session's mechanical
machinery budget went to the parse gate, and the increment stays a
single named failure mode.

HONEST SCOPE (§5e.2 carried forward): the checker proves the recorded
evidence chain, diff scope, and now parseability — not diff semantics
and not which of two parseable comment edits is the right one; the
pre-stated hunk-location criterion and the human review carry that.

### 5f.4 The run proposal (owner-approved up front this session; estimate honored regardless)

- **Live evidence verified before the run (the §5e.1 parallel):**
  block `2f7035116064e95888bd8a89908ffc84a93e2c1ae897e193ad0a1b499fde2514`
  is a member of the CURRENT version of
  `repo:trellis:src/rlm/trellis_agent.py`, its stored bytes appear
  verbatim in the on-disk file (substrate mirrors disk — no pre-run
  refresh needed for the target), and it contains BOTH the stale
  comment and the live wiring. The hash is discoverable in-graph: it
  is `sourceNodeIds` provenance on entity `main`'s ACTION edges
  (`uses_config_key` → `trellis_edit_root` / `trellis_mcp_servers`).
  Entities `trellis_agent` and `get_retrieved_address_count` exist,
  uncontested, zero contested attached ACTION edges (the `--pre`
  list). Entity `get_retrieved_addresses` (the insight's object) is
  itself uncontested but deliberately NOT on the `--pre` list: its
  one attached contested ACTION edge is the Session 36 churn
  demonstration standing as the recorded audit — the post-run
  evidence check (entity contested state) still applies. No
  DERIVED_INSIGHT `trellis_agent` → `get_retrieved_addresses`
  exists — the run's recorded insight fills a real gap.
- **Edit root / spawn:** identical mechanics to §5e.4 — the session
  branch checkout, `trellis_agent.py` spawned directly, research
  mode, `--max-iterations 12`, `TRELLIS_EDIT_ROOT` +
  `TRELLIS_CITATION_AUDIT=1` in the run's own environment.
- **The task text (the run INPUT, verbatim — never a kernel prompt
  byte; both composed-prompt pins stay unmoved):**

```
Stage-2 self-edit task (increment 2).

The file src/rlm/trellis_agent.py contains one stale comment written
before Session 31. The file has TWO telemetry dict constructions that
each contain a "retrieved_addresses" entry: an author-mode one
(earlier in the file) and a research-mode one (later in the file, in
the research path). The stale comment sits ONLY above the
research-mode entry and ends: "Bookkeeping; slice (d) will constrain
citable addresses to the set itself." The author-mode telemetry
comment is NOT stale and must not change.

Verify against the knowledge graph and the stored source bytes what
actually consumes the retrieved-address set today, then correct ONLY
the stale research-mode comment.

1. Resolve the graph entities named 'trellis_agent' and 'main'
   (entity names are lowercase-normalized) with
   trellis_neo4j.run_cypher; list their ACTION edges and the
   sourceNodeIds provenance hashes on those edges.
2. Fetch those provenance blocks with trellis_postgres.get_ast_texts
   and read them. Confirm from the fetched bytes that this same file
   wires the live consumer: the research path constructs TrellisNeo4j
   with retrieved_addresses_check=get_retrieved_addresses, so the
   write gate _verify_hashes_retrieved consumes the set on research
   runs. If the fetched blocks do not show the wiring, widen with
   trellis_postgres.vector_search (for example 'retrieved addresses
   telemetry count') and fetch what it surfaces.
3. Edit ONLY src/rlm/trellis_agent.py through trellis_textedit
   (load, locate, splice, diff, write_back): correct the stale
   research-mode comment so it says slice (d) is live - this file
   wires get_retrieved_addresses into the write gate through the
   retrieved_addresses_check constructor seam on research runs.
   Keep the edit comment-lines-only; change no executable line;
   preserve the sentences that are still true (the count-only /
   never-the-addresses T16 sentence). The string
   "retrieved_addresses" appears at TWO telemetry sites; use the
   engine-computed locate addresses and the surrounding bytes to
   target the research-mode site only. Do NOT touch the author-mode
   telemetry comment or any other part of the file.
4. Verify in its OWN iteration: after write_back, in a NEW REPL
   iteration, re-load or locate the edited region and PRINT it;
   confirm the stale sentence is gone and the author-mode region is
   untouched. Do not submit in the same iteration as this
   verification read.
5. Only after you have seen the printed confirmation, in a LATER
   iteration: record exactly one derived insight
   trellis_neo4j.write_derived_insight(
     subject='trellis_agent', verb='wires',
     obj='get_retrieved_addresses',
     sourceNodeIds=[the hashes of the blocks you fetched that show
     the wiring]),
   then submit a short report via trellis_answer.submit describing
   what the graph said, what the bytes confirmed, and what you
   changed.

Edit no other file. If the graph or the fetched bytes contradict the
task premise, stop, make no edit, and report the contradiction
instead.
```

- **The pre-scoped edit (semantic acceptance for the diff):** exactly
  ONE hunk in `src/rlm/trellis_agent.py`, comment lines only, in the
  research-mode telemetry comment (currently "# Session 30
  (PROVENANCE_THREADING.md slice b): the size of / # the run's
  retrieved-address set — a count only, never the / # addresses
  (T16). Bookkeeping; slice (d) will constrain / # citable addresses
  to the set itself."). The correction keeps the count-only/T16
  sentence and replaces the stale tail with the live fact — slice (d)
  landed (Session 31); this file wires `get_retrieved_addresses` into
  the write gate via the `retrieved_addresses_check` constructor seam
  on research runs. Exact wording is the run's; the human review
  judges it against the fetched bytes. The executable line below the
  comment and the author-mode twin region are byte-identical.
- **Estimate:** the increment-1 basis (W2 complexity + a gated
  write): **$0.15–$0.45 for one run; one contingency re-run after a
  diagnosed clean failure at most — ≤$0.90 total**, under the ≤$5/run
  cap. Actuals recorded in the roadmap regardless of outcome.
- **Acceptance criterion (pre-stated; also in the roadmap entry):**
  (1) scope AND site: exactly the named file changed; exactly ONE
  hunk, located in the research-mode telemetry region; every changed
  content line a comment line; the author-mode region byte-identical;
  (2) the pre-scoped edit lands only after human `git diff` review;
  (3) `stage2:check` reports ZERO findings INCLUDING the parse gate;
  (4) counts and the diff and dollars reported TOGETHER — db tool
  calls, retrieval-discipline counts, textedit ops, `answer_submits`,
  actual dollars vs the estimate; (5) a harness flag means the
  increment FAILED — record it and stop, no silent retry.

### 5f.5 The measured runs (Session 37, July 13, 2026 — owner-approved up front; BOTH runs failed; increment 2 FAILED and recorded)

- **Pre-flight:** `stage2:check --pre` PASS (`trellis_agent`,
  `get_retrieved_address_count`; doc present); tree clean; substrate
  block `2f703511…2514` verified byte-verbatim in the on-disk file.
- **Run 1 — FAILED on a harness flag ($0.3994; 134,387 in / 6,343
  out; 7 db tool calls; 24 textedit ops / 1 write_back; 2 retrieval
  fetches / 1 dedup refusal observed live / 0 budget refusals;
  `answer_submits` 1).** The DIFF was correct — one hunk, the right
  site, comment-lines-only, author-mode untouched, and it would have
  passed the parse gate — but `stage2:check` FLAGGED the evidence:
  2 × `unbridged_evidence` (the recorded insight cited
  `09281f45…c58d` and `66750136…dc3e`, both blocks of
  `repo:trellis:src/rlm/trellis_tools.py`, not the named file). The
  FIRST live firing of the Session 35 bridge check. Diagnosis
  (deterministic, from the transcript): the run's directional Cypher
  saw `trellis_agent` with 0 out-edges and pivoted to the task's
  "widen with vector_search" branch; vector_search surfaced the
  semantically-similar tools.py consumer blocks; the run confirmed
  the in-file wiring through `trellis_textedit.lines()` reads —
  which correctly never feed the retrieval set — so the only
  CITABLE evidence it held was the wrong document's. Tree reverted
  (`session37_run1_failed_diff.patch` preserved, local). **Operator
  cleanup, recorded:** the failed run's residual edge was DELETED
  before the contingency (`MATCH (trellis_agent)-[r:DERIVED_INSIGHT
  {verb:'wires'}]->(get_retrieved_addresses) DELETE r`, 1 edge;
  entities untouched) — the write path's MERGE unions edge
  provenance, so leaving the rejected hashes would have made the
  pre-stated contract mechanically unpassable for any later run;
  contest-instead-of-delete would equally have blocked it
  (`contested_evidence`). Acceptance-run hygiene in the drill-cleanup
  mold, not belief-machinery precedent.
- **The contingency (task text v2, amendments recorded per the
  diagnosis):** step 1 queries `main`'s ACTION edges UNDIRECTED and
  collects their provenance; step 2 fetches those blocks and
  identifies the in-file one; a new step 3 states the bridge rule
  explicitly (cite ONLY hashes whose fetched bytes are part of the
  named file); the vector_search widening branch removed. The
  Session 36 contingency was byte-identical because its diagnosis
  was stochastic run discipline; this diagnosis was deterministic
  task guidance, so the guidance was fixed and the amendment
  recorded verbatim (`benchmark_logs/session37_task_v2.txt`).
- **Run 2 — FAILED at human `git diff` review ($0.2362; 76,860 in /
  4,402 out; 3 db tool calls; 26 textedit ops / 2 write_backs;
  1 retrieval fetch — the 26-hash `get_ast_texts` batch — 0 dedup /
  0 budget refusals; `answer_submits` 1).** The evidence chain was
  PERFECT this time: 118 undirected edges → 26 distinct provenance
  hashes → the in-file block `2f703511…2514` identified and cited;
  `stage2:check` zero findings INCLUDING the parse gate. The diff
  was one hunk at the right site — but the splice replaced a 6-LINE
  window `[574, 580)` with 6 HAND-RETYPED comment lines, and the
  retype dropped two neighbors: the executable line
  `"retrieved_addresses": get_retrieved_address_count(),` (the
  telemetry field silently vanishes from the research payload) and
  the first line of the Session 33 comment below it (left
  decapitated). The file still PARSES — the parse gate and every
  checker layer are structurally blind to a parseable semantic
  deletion — and the human review caught it, exactly where the
  criterion places diff semantics. The verify-in-its-own-iteration
  discipline WAS followed (write cell → verification cell printing
  the region → submit cell), but the verification predicate checked
  only stale-text absence and author-region presence — it never
  asserted the executable neighbors survived. Failure named:
  **retype-splice neighbor deletion** — the run re-typed existing
  true bytes through attention instead of splicing only the changed
  span, the exact pathology CODE_MEDIATED_TEXT §1 names (the model
  never copies). Tree reverted
  (`session37_run2_failed_diff.patch` preserved, local).
- **Increment verdict: FAILED under the pre-stated criterion (run 1
  item 3; run 2 items 1–2). Both proposed runs consumed; recorded
  and stopped — no third run.** Paid total $0.6356 vs the ≤$0.90
  proposal. Run 2's insight edge (`trellis_agent` `wires`
  `get_retrieved_addresses`, citing `2f703511…2514`) STANDS: it is
  a true belief with live in-file provenance, gate- and
  checker-verified — the run's recorded evidence passed; its diff
  did not. The stale comment in `trellis_agent.py` remains in place
  (still a valid future target).
- **What the failures buy (the increments' point is measurement):**
  (1) the Session 35 bridge check fired live for the first time and
  caught real evidence substitution; (2) the parse gate landed and
  run 1's diff showed the gate-visible class no longer reaches
  review unflagged (its diff parsed AND was comment-only — the gate
  passing was informative); (3) run 2 named the NEXT mechanically
  closable class: a comment-class edit that deletes parseable
  executable neighbors. The closure is decidable from the diff alone
  (every changed line in the named file must be a comment/blank
  line) — the recorded candidate for increment 2's retry
  (Session 38's parse-gate-mold zero-paid step), per the
  tooling-over-prompt-modules direction.
- **The close-out refresh (the §5d.6 cadence; $0.0656 — 10,326 in /
  3,969 out / 4,101 embedding tokens, actuals from the worker
  metrics port):** plan echo FIRST (7 files, 66-block printed bound
  against a 200 budget, 0 tombstones, 116 test/fixture files
  excluded from extraction), then snapshot `trellis#3` — 17/17
  extraction jobs, zero failures (1 dropped action + 1 unresolved
  endpoint counted, the base-rate behavior). Ingested: the four
  parse-gate harness files + their two test files (policy `none` by
  the kernel exclusion) + `src/rlm/trellis_tools.py` v3 — the
  tools.py re-ingest is NOT an edit: Session 36's run-authored
  splice lines were committed with mixed line endings from its own
  worktree, and this session's fresh checkout normalized the file
  to uniform CRLF, so the module-comment block re-hashed
  (`fe108c10…` dead in v3, replaced by `2c243fa3…` with
  byte-identical text modulo EOL). Recorded as the
  checkout-normalization churn class: a one-time re-hash when
  snapshots are taken from different worktrees, handled by the
  ordinary churn loop. Invalidation sweeps contested 25 nodes / 17
  relationships across the 5 re-versioned docs (audit preserved);
  re-extraction re-derived from the new bytes. Both standing
  beliefs verified UNCONTESTED with live provenance after the
  refresh: the Session 36 operator re-derivation
  (`get_retrieved_addresses` `returns_copy_of`
  `_retrieved_addresses`, citing `09281f45…` — retained in v3) and
  this session's run-2 insight (`trellis_agent` `wires`
  `get_retrieved_addresses`, citing `2f703511…2514` —
  `trellis_agent.py` was not re-ingested; both failed diffs were
  reverted before the refresh).

## 5g. Stage 2, increment 2 RETRY: the comment-class diff gate + the re-proposed edit (design record, Session 39, July 13, 2026)

Written BEFORE the run (the §5f mold). The retry closes Session 37
run 2's measured escape mechanically, then re-runs the same
owner-scoped edit with the run-2 lessons folded into the task text.

### 5g.1 The comment-class diff gate (zero-paid, landed before the run)

Session 37 run 2's escape — a comment splice whose hand-retyped
window dropped the executable
`"retrieved_addresses": get_retrieved_address_count(),` line and the
Session 33 comment head, leaving a file that still PARSES — is
mechanically decidable from the diff alone when the increment
DECLARES its edit comment-class: every changed content line in the
named file's diff, the removed side AND the added side, must be blank
or a line comment for the file's language.

- **The typed finding** `named_file_noncomment_change` joins the
  checker (`src/benchmarks/selfedit/check.ts`). Pure pieces:
  `parseUnifiedDiffChangedLines` (in-hunk `-`/`+` lines only; file
  headers, context lines, and the no-newline marker skipped; CR
  stripped; bounded to what `git diff` emits, not a general patch
  parser), `commentMarkerForFile` (`#` for `.py`, `//` for
  `.ts`/`.js`; unwired extensions null), and `checkCommentClassDiff`
  (blank or marker-prefixed after trim passes; anything else on
  either side is a finding with the bounded offending line quoted).
- **The declaration** is a new CLI flag `--comment-class <file>`
  (repeatable) on `scripts/stage2_selfedit_check.ts`'s post-run mode.
  The gate NEVER fires on an increment that did not declare
  comment-class — an executable-class increment never sees it.
  Declarations validate BEFORE any I/O: a comment-class file must be
  a `--named-file`, must have a wired line-comment marker, and the
  flag is refused under `--pre` (all three refusals observed).
- **The gatherer** is read-only `git diff -- <file>` under the edit
  root (`gatherGitDiff`) — the recorded Session 39 WIDENING of the
  harness's git surface from `status --porcelain` to status + diff,
  still read-only; the run and the toolkit never touch git.
- **HONEST SCOPE:** line comments only this edition. Block-comment
  interiors and docstrings are NOT recognized, so a comment-class
  edit touching them flags conservatively (a false FLAG a human can
  overrule, never a false pass). The gate is a post-run mechanical
  check in the parse-gate mold (guardrail 5), never a write gate.
- **Pins:** 13 unit tests in `check.test.ts` — the reference
  violation is the EXACT preserved run-2 failed diff reproduced
  inline (its removed executable line fires the finding exactly once;
  its added side, all comments, stays silent) — plus drill section
  [7] in `test:selfedit-harness`, which plants the run-2 shape in a
  scratch git repo, observes the parse gate's structural BLINDNESS to
  it (the file parses), and watches the new gate fire through the
  real git binary; the genuine comment-only edit arm stays silent.

### 5g.2 Live evidence re-verification (the policy-2 substrate)

The Session 38 pilot re-chunked `src/rlm` under chunking policy 2
(snapshot `trellis#6`) — every §5f-era `src/rlm` hash is dead. The
retry's evidence was re-verified against the LIVE substrate this
session (read-only probes, recorded here per §3 of the handoff):

- `repo:trellis:src/rlm/trellis_agent.py` current version 2, root
  `6a1c2309b9d305795e51d5d75453551bec9495e98eccd832f7044a66fe840623`,
  25 content-bearing blocks.
- **The wiring block:**
  `9b4c315986e342ebb741658d70ff04b21fef478cc2cdef103b261a294a6fa730`
  (`code_statement`, 2,961 chars) contains the research path's
  `TrellisNeo4j(... retrieved_addresses_check=get_retrieved_addresses)`
  construction; bytes verbatim on disk.
- **The stale-comment block:**
  `ab87725e1583b8bf84a209c31f441d771099f9a53fa7475e67edc998c13cf883`
  (`code_statement`, 2,949 chars) contains the stale
  "slice (d) will constrain" comment; bytes verbatim on disk. Policy
  2 SPLIT the wiring and the telemetry dict into separate blocks —
  §5f's premise that one block held both is no longer true, and task
  text v3 says so explicitly.
- Both blocks' bytes appearing verbatim on disk means
  `trellis_agent.py` is unchanged since `trellis#6`:
  refresh-before-use is satisfied with NO pre-run refresh.
- **The graph path (v3's step 1):** `get_retrieved_addresses` has
  exactly two undirected ACTION edges — `constrains_with`
  (`trellisneo4j`, citing the wiring block) and `returns_copy_of`
  (`_retrieved_addresses`, citing
  `e3df7336f60e53e183c9789551895542856e8959e8aff85a0060ba20cc619a81`,
  a `trellis_tools.py` block). §5f's route through entity `main` is
  DEAD (contested since the pilot churn — data, not a defect), so v3
  re-routes. The two-hash fan-out is well inside the retrieval
  budget, and the tools.py hash is a live re-test of the run-1 trap:
  the run will fetch it and must NOT cite it (task rule 3 + the
  Session 35 bridge check).
- **The standing edge the retry MERGEs onto:** `trellis_agent`
  `wires` `get_retrieved_addresses` exists, uncontested,
  `rederivedAt` stamped, citing the wiring block — the run's gated
  write unions provenance onto it.
- `stage2:check --pre` PASS (zero findings) over `trellis_agent`,
  `get_retrieved_addresses`, `_verify_hashes_retrieved`,
  `_retrieved_addresses`, doc present.

### 5g.3 The run proposal (approved this session; estimate honored regardless)

- **Task text v3** (run INPUT only — no kernel prompt byte; both
  composed-prompt pins unmoved) = v2's working evidence path re-based
  per §5g.2, plus the two run-2 lessons: **(1) SPLICE MINIMAL SPAN**
  — the splice window covers exactly the comment lines whose content
  changes; a replacement line identical to an existing line means the
  window is too wide; **(2) NEIGHBOR-PRESERVATION verification** —
  the post-write_back iteration asserts in code, and prints, that the
  executable `retrieved_addresses` line and the `# Session 33` head
  survived, the stale sentence is gone, and the author-mode region is
  untouched, before any submit. Verbatim:

```
Stage-2 self-edit task (increment 2, retry).

The file src/rlm/trellis_agent.py contains one stale comment written
before Session 31. The file has TWO telemetry dict constructions that
each contain a "retrieved_addresses" entry: an author-mode one
(earlier in the file) and a research-mode one (later in the file, in
the research path). The stale comment sits ONLY above the
research-mode entry and ends: "Bookkeeping; slice (d) will constrain
citable addresses to the set itself." The author-mode telemetry
comment is NOT stale and must not change.

Verify against the knowledge graph and the stored source bytes what
actually consumes the retrieved-address set today, then correct ONLY
the stale research-mode comment.

1. Query the graph with trellis_neo4j.run_cypher for the ACTION
   edges around the entity named 'get_retrieved_addresses' (entity
   names are lowercase-normalized). Use an UNDIRECTED relationship
   pattern, for example MATCH (e:Entity)-[r:ACTION]-(o:Entity) WHERE
   e.name = 'get_retrieved_addresses' RETURN r.verb, o.name,
   r.sourceNodeIds - edges carry provenance in either direction.
   Collect the distinct sourceNodeIds hashes from those edges.
2. Fetch those provenance blocks with trellis_postgres.get_ast_texts
   and read them. Among the fetched blocks, identify the block(s)
   whose bytes belong to src/rlm/trellis_agent.py itself. The source
   substrate stores this file as several fine-grained blocks: the
   block showing the research path's TrellisNeo4j construction with
   retrieved_addresses_check=get_retrieved_addresses is a code
   statement block and it is NOT the same block that holds the stale
   telemetry comment. Confirm the wiring from fetched bytes that
   appear verbatim in the file you are editing.
3. IMPORTANT provenance rule for this task: the derived insight you
   record in step 6 may cite ONLY hashes whose fetched bytes are
   part of src/rlm/trellis_agent.py (bytes that appear verbatim in
   the file you are editing). Blocks from other files (for example
   src/rlm/trellis_tools.py) describe the consumer but must NOT be
   cited here.
4. Edit ONLY src/rlm/trellis_agent.py through trellis_textedit
   (load, locate, splice, diff, write_back): correct the stale
   research-mode comment so it says slice (d) is live - this file
   wires get_retrieved_addresses into the write gate through the
   retrieved_addresses_check constructor seam on research runs.
   Keep the edit comment-lines-only; change no executable line;
   preserve the sentences that are still true (the count-only /
   never-the-addresses T16 sentence). The string
   "retrieved_addresses" appears at TWO telemetry sites; use the
   engine-computed locate addresses and the surrounding bytes to
   target the research-mode site only. Do NOT touch the author-mode
   telemetry comment or any other part of the file.
   SPLICE THE MINIMAL SPAN: your splice window must cover EXACTLY
   the comment lines whose content changes and nothing else. Never
   re-type a line whose content is not changing - not the executable
   "retrieved_addresses": get_retrieved_address_count(), line, not
   the "# Session 33" comment lines below it, not any unchanged
   comment line above. If a line in your replacement list is
   identical to a line already in the file at the same position,
   your window is too wide: shrink the window instead of re-typing
   that line.
5. Verify in its OWN iteration: after write_back, in a NEW REPL
   iteration, re-read the edited region and PRINT it, then assert
   NEIGHBOR PRESERVATION in code (substring checks over the region,
   each result printed): (a) the executable line
   "retrieved_addresses": get_retrieved_address_count(), is still
   present in the research-mode region, (b) the "# Session 33"
   comment line below it is still present, (c) the stale sentence
   ("slice (d) will constrain") is gone, (d) the author-mode
   telemetry region is untouched. Do not submit in the same
   iteration as this verification read.
6. Only after you have seen the printed confirmation of ALL FOUR
   assertions, in a LATER iteration: record exactly one derived
   insight
   trellis_neo4j.write_derived_insight(
     subject='trellis_agent', verb='wires',
     obj='get_retrieved_addresses',
     sourceNodeIds=[the hash(es) of the fetched block(s) from
     src/rlm/trellis_agent.py that show the wiring]),
   then submit a short report via trellis_answer.submit describing
   what the graph said, what the bytes confirmed, and what you
   changed.

Edit no other file. If the graph or the fetched bytes contradict the
task premise, stop, make no edit, and report the contradiction
instead.
```
- **Mechanics:** identical to §5e.4/§5f.4 — the session worktree as
  `TRELLIS_EDIT_ROOT`, `TRELLIS_CITATION_AUDIT=1` in the run's own
  environment, research mode, `--max-iterations 12`,
  `trellis_agent.py` spawned directly.
- **Estimate:** the increment-1/2 basis — **$0.15–$0.45 for one run;
  one contingency re-run after a diagnosed clean failure at most —
  ≤$0.90 total**, under the ≤$5/run cap. Actuals recorded regardless.
- **Acceptance criterion (pre-stated; the §5f.4 mold with the new
  gate folded into item 3):** (1) scope AND site: exactly the named
  file changed; exactly ONE hunk in the research-mode telemetry
  region; every changed content line a comment line; the author-mode
  region byte-identical; (2) the pre-scoped edit lands only after
  human `git diff` review; (3) `stage2:check` (with `--comment-class
  src/rlm/trellis_agent.py` declared) reports ZERO findings —
  including the parse gate AND the comment-class diff gate; (4)
  counts and the diff and dollars reported TOGETHER; (5) a harness
  flag means the increment FAILED — record and stop, no silent
  retry. A third consecutive increment failure STOPS the ladder and
  puts the three-failure record to the owner.

### 5g.4 The measured run (Session 39, July 13, 2026 — LANDED, all five criterion items, first shot)

- **The run ($0.347 computed from tokens — 110,447 in / 7,089 out at
  the gpt-5.4 rates; inside the $0.15–$0.45 band; 9 db tool calls;
  32 textedit ops / 1 write_back; 1 retrieval fetch — the two-hash
  `get_ast_texts` batch — 1 dedup refusal observed live / 0 budget
  refusals; `answer_submits` 1; 79.6s execution).** The evidence
  chain ran exactly as §5g.2 predicted: the two undirected ACTION
  edges → both hashes fetched in one batch → the citation audit
  shows `read` = both, `cited` = the wiring block ONLY (the tools.py
  hash fetched and correctly NOT cited — the run-1 trap re-tested
  and passed); the gated write MERGEd onto the standing edge with an
  unchanged provenance union. The run followed the v3 discipline
  observably: locate on both telemetry sites (author 351 / research
  578) plus the constructor seam (437), a minimal-span splice
  replacing exactly the two stale comment lines with three comment
  lines, and the neighbor-preservation iteration printing all four
  assertions (executable line present, `# Session 33` head present,
  stale sentence gone, author-mode region untouched) BEFORE the
  separate submit iteration. One transient run-authored REPL
  `ValueError` (a tuple-unpack in its own inspection code) was
  recovered in the next iteration — no tool or gate involvement.
- **Mechanical verdict:** `stage2:check --edit-root . --named-file
  src/rlm/trellis_agent.py --comment-class src/rlm/trellis_agent.py
  --subject trellis_agent --verb wires --object
  get_retrieved_addresses` → **PASS: zero findings** across all four
  layers (scope, evidence, parse gate, comment-class gate).
- **Human `git diff` review: ACCEPTED.** One hunk at the research
  telemetry site; removed 2 comment lines / added 3 comment lines;
  the executable `retrieved_addresses` line and the `# Session 33`
  head are untouched CONTEXT lines this time (run 2 deleted them);
  the author-mode twin region is byte-identical. Offline gates green
  with the diff applied (`npm test` 836/85, build, python:check).
  One recorded observation: `write_back` wrote the three new lines
  with LF endings into the otherwise-CRLF file (641 CRLF / 3 LF on
  disk) — git normalizes on commit; the Session 36 mixed-EOL commit
  class, recorded, not a defect.
- **Criterion verdict: items 1–5 ALL PASS. Increment 2 CLOSED by the
  retry; no contingency needed.** The ladder record now reads:
  increment 1 landed on contingency; increment 2 failed twice
  (Session 37), each failure class was closed by tooling shape (the
  parse gate; the comment-class gate) or task discipline
  (minimal-span + neighbor assertions), and the retry landed first
  shot.
- **The split-scope refresh (§5d.6 cadence under the §10.4 recipe;
  $0.157 actual — 34,756 in / 6,936 out / 13,148 embedding tokens
  from the fresh worker instance's metrics):** plan echoes FIRST for
  both scopes (policy-1 bound 76 blocks / 12 files; policy-2 bound
  24 blocks / 1 file; ZERO tombstones in both — carry-forward
  correct in both directions). Snapshot `trellis#7` (policy 1,
  everything except `src/rlm`): 12 files ingested — this session's
  four harness files plus the Session 38 machinery files re-hashed
  whole (the checkout-EOL churn class, third observation). Snapshot
  `trellis#8` (policy 2, `src/rlm`): exactly `trellis_agent.py` v3,
  Merkle-precise churn — 23 blocks RETAINED / 3 orphaned / 3 added,
  2 extraction jobs. Pipeline: **59/59 jobs, zero failures**; 13
  invalidation sweeps contested 63 nodes / 30 relationships (audit
  preserved; standard lazy recovery — the agent.py v3 sweep alone:
  5 nodes / 3 relationships from the superseded telemetry block's
  derivations). **Churn verification:** the old stale-comment block
  `ab87725e…f883` is DEAD in v3; the wiring block `9b4c3159…6a730`
  was RETAINED (the edit never touched its statement run), so ALL
  THREE standing beliefs (`wires` / `consumes` / `returns_copy_of`)
  read uncontested with live provenance and NO recovery was needed
  this time — the first refresh where the standing insights rode
  through on retained blocks alone.
- **Session paid total: $0.504** (run $0.347 + refresh $0.157),
  against the proposal's ≤$0.90 run budget + separately-gated
  refresh.

## 5h. Stage 2, the first FEATURE-CLASS increment: T1, the backend config surface (design record, Session 48, July 13, 2026)

Written BEFORE any run (the §5e/§5f/§5g mold). This is the first
increment of the ratified T-series (`TEST_TIME_TRAINING.md` §12.6): a
task-assigned functionality increment — the W-series / increments-1/2
lineage, distinct from the defect-class increment 3, whose
never-manufacture rule is untouched. The spec is
`docs/architecture/MODEL_BACKEND_SEAM.md` §3 + §4 layer 1, scoped by
its §8 T1 skeleton; because the design record lives in `docs/`
(outside extraction scope), the task text below carries the spec
verbatim — the task text IS the spec channel.

### 5h.1 Scope and named files

- `src/config/index.ts` — the four optional `TRELLIS_RLM_*` keys in
  `EnvSchema`; the three cross-field refusals; the ambient
  `OPENAI_BASE_URL` guard with the §4.1 message; the
  `config.rlmBackend` export with fail-fast key resolution.
- `src/config/rlm_backend.test.ts` — NEW; the per-topic config test
  mold (`textedit_bounds.test.ts` / `workspace_bounds.test.ts`); the
  increment's own unit pins.
- NO call-site change: no consumer reads `config.rlmBackend` in T1
  (T2/T3 scope). The kernel default model literal does not move
  (`trellis_agent.py`, T3 scope). A diff touching any other file
  fails the criterion.

Recorded shape decision (the spec names the export's four optional
fields and "the fail-fast resolved key value" without naming the
fifth field): the resolved value is exported as
`config.rlmBackend.apiKeyValue` (undefined when
`TRELLIS_RLM_API_KEY_ENV` is unset) — the `config.mcp.credentialEnv`
precedent: resolved fail-fast at load, never logged or serialized.

### 5h.2 The new-file constraint and the pre-staged stub (recorded decision)

`trellis_textedit.load()` refuses a path that is not an existing
regular file under the edit root — the toolkit edits existing files
only, and nothing in its contract creates one. T1 is the first
increment to name a NEW file. The recorded resolution, in the
harness-holds-the-pen lineage (the Session 19 grounded-authoring
precedent): the session pre-stages `src/config/rlm_backend.test.ts`
as a four-line header-comment stub, committed to the feature branch
BEFORE the run (so `git status --porcelain` is clean at run start and
the post-run porcelain shows exactly the run's own work). The run
authors the entire test body through guarded `insert_lines` anchored
on the header. The stub carries no test, no import, no executable
line; every byte of pin content is the run's. Consequences pinned by
the criterion: the header must survive byte-intact (human review),
and the toolkit contract is unchanged (no creation surface was
added).

The stub bytes, exactly (four comment lines, LF-committed like every
repo text file):

```
// Session 48 (TTT-track increment T1, MODEL_BACKEND_SEAM.md sections
// 3 and 4 layer 1): unit pins for the TRELLIS_RLM_* config surface.
// Pre-staged header (the editing toolkit loads existing files only);
// the test body below is authored by the stage-2 self-edit run.
```

Two consequences, recorded: (1) a `.test.ts` file with no tests FAILS
vitest, so the offline suite reads red between the stub commit and
the run's landing — the stub is therefore created and committed only
AFTER owner approval, immediately before the run, and an unapproved
or failed increment removes it before close-out (the suite is green
at every shipped state). (2) The stub has no substrate document until
the post-landing refresh — a file that did not exist at `trellis#11`
cannot have one. The `--pre` gate therefore names only
`src/config/index.ts` (its doc is present); the post-run check names
BOTH files (scope + parse gate); the evidence bridge runs through
`index.ts` blocks. Recorded as the honest shape for any future
new-file increment.

### 5h.3 Live evidence verification (the §5g.2 mold; probes read-only, July 13, 2026)

- `repo:trellis:src/config/index.ts` present, version 1, root
  `74b494fbfd9ee6f2bde906e14a6c033f1f9d7ba2a9c449d9106d16fb1ba3c825`
  (the `trellis#11` state).
- Four seam blocks, ALL bytes verbatim on disk — the file is
  unchanged since `trellis#11`, so refresh-before-use is satisfied
  with NO pre-run refresh (the split-scope policy-1 `--dry-run` echo
  read 0 to ingest / 301 unchanged / 0 tombstones):
  - `fc17205c4b1e129508c7fb5c675944300b124939b4c609bfe77352b39ab76311`
    (`code_chunk`, 3,959 ch) — the credential mold: the "Fail fast at
    startup on a malformed registry" comment + the
    `resolveMcpCredentialEnv(mcpServers, process.env)` call. The
    expected citation.
  - `a5930c920330a434d8d32b259d6d5a7f5f02624958af81f474cb78ef37abdcac`
    (`code_chunk`, 3,968 ch) — the budget mold:
    `TRELLIS_RETRIEVAL_BUDGET_PER_RUN`'s schema line + its design
    comment.
  - `ee175a534c2d734f45685a0065e98fe4fe7b941b7ddbfdf115844f2dadcbf796`
    (`code_chunk`, 1,625 ch) — the `credentialEnv: mcpCredentialEnv`
    export + its never-logged comment.
  - `0b3f685cf2df829b55715a43d3e280a3c09a00fb69f0089942c15bfd7f45d869`
    (`code_chunk`, 3,941 ch) — the file head / imports.
- Entity states: `resolvemcpcredentialenv` (1 ACTION edge, 0
  contested) and `mcpcredentialenv` (0 edges) are the `--pre`
  entities — `stage2:check --pre` PASS, zero findings, observed this
  session. `config` (59 edges, 1 contested: `-uses-`
  `scripts/stage2_selfedit_check.ts`, refresh-churn residue) and
  `trellis_retrieval_budget_per_run` (4 edges, 1 contested:
  `-reads_config-` `parse_retrieval_budget`, same class) are NOT
  named at `--pre`: each carries one contested attached edge that is
  lazy-recovery residue on an unrelated belief, and the pre-gate's
  contract is "an edit premised on quarantined beliefs is refused" —
  this task's premise (the two molds' bytes) relies on neither. Both
  contested edges are recorded here precisely so the owner reviews
  that reasoning instead of discovering it.
- The graph-first chain: the clean entities' edges cite
  `1a6b13761f1245280596de9a3aa4d30b30e5878e09d07940505b41df9a062d3f`
  (a `src/config/mcp_servers.ts` block) — informative, NOT citable
  (the increment-1 trap, re-tested live); the `index.ts` mold blocks
  are reached by `vector_search` (live-only since Session 40),
  fetched, and verified byte-verbatim against the loaded frame before
  citation.
- Expected insight: `config` `-resolves_fail_fast->`
  `mcpcredentialenv` (DERIVED_INSIGHT), citing the `index.ts`
  block(s) showing the fail-fast credential resolution — the exact
  mold T1's new key resolution mirrors. Post-run, both entities'
  own contested flags read false (the checker's evidence layer reads
  `e.contested`, not attached edges).
- Honest churn note, recorded in advance: the post-landing refresh
  re-chunks `index.ts` (policy-1 positional chunking), the cited
  blocks die, and the sweep will contest this fresh insight edge —
  ordinary lazy recovery (the §5e.5 precedent), never a criterion
  item.

### 5h.4 Named failure modes and the catching layer

- The run touches an unnamed file → checker scope
  (`out_of_scope_edit`); a named file left untouched →
  `named_file_unchanged`.
- The insight is missing, or cites dead or unbridged hashes → the
  evidence layer; the citable set is constrained in-run by the
  Session 31 write gate (only in-run retrieved addresses).
- A syntax-broken named file → the parse gate (both named files are
  `.ts`; single-file diagnostics are wired).
- Neighbor drop / address drift in `index.ts` → the guarded family
  refuses at staging (`AnchorMismatchError`); any raw splice fails
  the guarded-only criterion (`textedit_raw_splices` must read 0).
- Wrong bounds, wrong refusal messages, weak or wrong pins → the
  increment's own pins (`npm test` with the diff applied) + human
  `git diff` review against the spec — the layer that judges diff
  semantics by design (§5e.2).
- Stub header replaced or removed → human review (the header is the
  recorded anchor).

### 5h.5 Task text v1 (the run INPUT, verbatim — no kernel prompt byte; both composed-prompt pins unmoved)

```
Stage-2 self-edit task (feature-class increment T1: the backend
config surface).

Implement a new validated configuration surface in
src/config/index.ts and author its unit pins in
src/config/rlm_backend.test.ts. The specification below is quoted
from docs/architecture/MODEL_BACKEND_SEAM.md (its section 3 and
section 4 layer 1); this task text is the spec channel - follow it
exactly.

THE SPEC, part 1 - four new OPTIONAL environment keys in EnvSchema:
- TRELLIS_RLM_BACKEND: z.enum(['openai', 'vllm']).optional()
- TRELLIS_RLM_MODEL: z.string().min(1).max(256).optional()
- TRELLIS_RLM_BASE_URL: z.url().optional(), plus a refinement
  requiring the URL scheme to be http: or https:
- TRELLIS_RLM_API_KEY_ENV: z.string().min(1).max(128).optional()
Each key gets a comment block in the file's house style naming
MODEL_BACKEND_SEAM.md as the design record and stating that no
consumer reads these values yet (T2/T3 wire them).

THE SPEC, part 2 - imperative fail-fast checks after the schema
parse (the existing editRoot / mcpCredentialEnv precedent in the
same file), each throwing a plain Error whose message names every
key involved:
1. If OPENAI_BASE_URL is present in process.env (any value,
   including empty), throw with EXACTLY this message:
   Backend config: OPENAI_BASE_URL is not honored; set
   TRELLIS_RLM_BASE_URL (root agent) - worker transport is not yet
   configurable.
   (single line, an em dash between "(root agent)" and "worker",
   exactly as the design record states it)
2. TRELLIS_RLM_BACKEND set to 'vllm' with TRELLIS_RLM_BASE_URL
   unset: refuse.
3. TRELLIS_RLM_API_KEY_ENV set with TRELLIS_RLM_BASE_URL unset:
   refuse.
4. TRELLIS_RLM_API_KEY_ENV set: the variable it names must be
   present and non-empty in process.env; otherwise refuse. Resolve
   the value once here into a local.
A base URL WITHOUT a backend is allowed - add no check for it.

THE SPEC, part 3 - a new export block on the config object:
  rlmBackend: { backend, model, baseUrl, apiKeyEnv, apiKeyValue }
where the first four are the validated values (each undefined when
its key is unset) and apiKeyValue is the fail-fast resolved value
of the named key variable (undefined when TRELLIS_RLM_API_KEY_ENV
is unset). With every key unset every field is undefined and every
existing config consumer reads exactly what it read before. The
comment on the block follows the config.mcp.credentialEnv
precedent: the resolved value never appears in logs or
serializations. No other code reads rlmBackend yet - change NO call
site anywhere.

Steps:
1. Consult the graph first: with trellis_neo4j.run_cypher, list the
   ACTION edges around the entities named 'resolvemcpcredentialenv'
   and 'mcpcredentialenv' (entity names are lowercase-normalized;
   use an UNDIRECTED pattern, e.g.
   MATCH (e:Entity)-[r:ACTION]-(o:Entity) WHERE e.name IN
   ['resolvemcpcredentialenv','mcpcredentialenv'] RETURN r.verb,
   o.name, r.sourceNodeIds). Collect the distinct sourceNodeIds.
2. Fetch those blocks with trellis_postgres.get_ast_texts and read
   them. Some fetched blocks belong to OTHER files (for example
   src/config/mcp_servers.ts) - they inform but must NOT be cited
   in step 8.
3. Find the two molds inside src/config/index.ts with
   trellis_postgres.vector_search (for example 'per-run retrieval
   budget validated fail-fast env twin' and 'fail fast at startup
   malformed registry credential env var missing secret'). Fetch
   the hits you need. Load src/config/index.ts with
   trellis_textedit.load and verify which fetched blocks' bytes
   appear VERBATIM in the file you are editing: you need the block
   holding the TRELLIS_RETRIEVAL_BUDGET_PER_RUN validation (the
   optional-env-twin mold your new keys follow) and the block
   holding the "Fail fast at startup" comment with the
   resolveMcpCredentialEnv(mcpServers, process.env) call (the
   credential mold your key resolution follows).
4. Edit src/config/index.ts ONLY through the guarded family -
   replace_lines / insert_lines / delete_lines, NEVER raw splice
   (the increment fails its criterion if textedit_raw_splices is
   nonzero). Insertions dominate: (a) ONE guarded insert inside
   EnvSchema adding the four keys with their comments, anchored
   after the TRELLIS_RETRIEVAL_BUDGET_PER_RUN line's block; (b) ONE
   guarded insert after the existing editRoot fail-fast block
   adding the ambient guard and the three cross-field refusals;
   (c) ONE guarded insert inside the config object literal adding
   the rlmBackend block, anchored between existing blocks (for
   example after textedit or scratch). Read the neighbors with
   trellis_textedit.lines() first and supply byte-exact anchors.
   Do not modify, re-type, or re-wrap ANY existing line.
5. Author the test body in src/config/rlm_backend.test.ts. The file
   exists as a four-line header-comment stub - load it, keep the
   header byte-intact, and add everything below it with guarded
   insert_lines anchored on the header's last line. First read
   src/config/textedit_bounds.test.ts (trellis_textedit.load +
   lines) to learn the house per-topic config-test mold: a
   managed-keys env save/restore helper, vi.resetModules() plus a
   dynamic import('./index') per load, afterEach restore. Author
   fresh code in those conventions - never re-type another file's
   bytes as your own. The helper must manage: the four TRELLIS_RLM_*
   keys, OPENAI_BASE_URL, and one scratch variable name of your
   choice (for example TRELLIS_TEST_RLM_KEY) for the key-env pins.
   The pins, one describe block:
   (a) unset default: config.rlmBackend deep-equals the
       all-undefined five-field shape;
   (b) backend accepts 'openai' alone and 'vllm' with a base URL;
       refuses an unknown enum value;
   (c) model accepts an ordinary id; refuses '' and a 257-char
       string;
   (d) base URL accepts http://127.0.0.1:8000/v1 and an https URL
       with no backend set; refuses a non-URL and ftp://host/;
   (e) 'vllm' without base URL refuses and the message names both
       keys;
   (f) key-env without base URL refuses and the message names both
       keys;
   (g) key-env with base URL and the named variable set populates
       apiKeyEnv and apiKeyValue;
   (h) key-env naming an absent variable refuses; naming a present
       but empty variable refuses;
   (i) ambient OPENAI_BASE_URL set makes config load throw with the
       exact part-2 guard message.
6. Verify in its OWN REPL iteration (never the same cell as any
   later write or the submit): re-read the three edited regions of
   src/config/index.ts and the whole test file with
   trellis_textedit.lines(), PRINT them, and assert in code with
   each result printed: (a) the four TRELLIS_RLM_* schema lines
   appear exactly once each; (b) the ambient-guard message string
   appears exactly once in index.ts; (c) the
   TRELLIS_RETRIEVAL_BUDGET_PER_RUN line and the editRoot fail-fast
   block are byte-unchanged; (d) the rlmBackend block sits inside
   the config object literal with the neighboring export blocks
   intact; (e) the four-line stub header is byte-intact and the
   first non-header line of the test file is your own import line.
7. Only after every assertion in step 6 has printed true, in a
   LATER iteration: record exactly one derived insight
   trellis_neo4j.write_derived_insight(
     subject='config', verb='resolves_fail_fast',
     obj='mcpcredentialenv',
     sourceNodeIds=[the hash(es) of the fetched block(s) whose
     bytes appear verbatim in src/config/index.ts and show the
     fail-fast mcpCredentialEnv resolution]).
8. Submit a short report via trellis_answer.submit describing what
   the graph said, what the bytes confirmed, what you added, and
   the anchors you used.

Edit no other file. If the graph, the fetched bytes, or the file
contents contradict the task premise (for example the molds are not
where this task says they are, or the stub header is absent), stop,
make no edit, and report the contradiction instead.
```

### 5h.6 The run proposal (owner-gated; presented at session start)

- **Mechanics (the §5e.4/§5g.3 mold):** `trellis_agent.py` spawned
  directly, research mode, the session worktree as
  `TRELLIS_EDIT_ROOT`, `TRELLIS_CITATION_AUDIT=1` in the run's own
  environment, `--max-iterations 16` (recorded deviation from the
  increments-1/2 value of 12: this increment authors ~200 new lines
  across two files; the headroom is iteration count only, never
  spend authorization).
- **Estimate:** **$0.40–$0.90 for one run** (the landed-run basis
  $0.347–$0.352, scaled for a two-file authoring task with ~15k
  output tokens), one diagnosed-contingency re-run at most —
  **≤$1.80 total**, under the ≤$5/run cap. The post-landing
  split-scope policy-1 refresh adds ≈$0.05–$0.15 (`index.ts`
  re-extraction; the new test file is ingested but
  test/fixture-excluded from extraction). Actuals recorded
  regardless.
- **The criterion (pre-stated; the §12.6 feature-class mold):**
  1. named-file-only diff — exactly `src/config/index.ts` +
     `src/config/rlm_backend.test.ts`;
  2. exactly one recorded insight (`config` `-resolves_fail_fast->`
     `mcpcredentialenv`) through the Session 31 gate, citing only
     live `index.ts` blocks;
  3. `stage2:check` zero findings (scope + evidence + parse gate;
     comment-class not declared — this is an executable-class
     increment);
  4. guarded-only: `textedit_raw_splices == 0` in the run telemetry;
  5. the increment's own pins green: `npm test` grows from 837/85
     with every new test passing and zero existing tests changed
     (run by the human with the diff applied);
  6. human `git diff` review acceptance against the spec text
     (bounds, messages, export shape, stub header intact,
     insert-dominant diff over `index.ts`);
  7. spend within estimate; counts + diff + dollars reported
     TOGETHER.
  A harness flag or a failing pin FAILS the increment — record,
  stop, diagnose; a retry is its own proposal (the increments-1/2
  treatment).

### 5h.7 Run 1 (July 13, 2026 — clean self-refusal; diagnosed; the recorded contingency follows)

- **The run ($0.8760 computed from tokens — 290,167 in / 15,060 out
  at the gpt-5.4 rates; inside the $0.40–$0.90 band; 15 iterations,
  96.0s; 5 db tool calls; 74 textedit ops / 8 guarded ops / 0 raw
  splices / 0 write_backs; 3 retrieval fetches / 1 dedup refusal /
  0 budget refusals; `answer_submits` 1) ended in a clean
  SELF-REFUSAL:** its step-6 verification printed three assertions
  false, so it reverted its staged frames, wrote NO derived insight,
  and submitted a contradiction report per the task's final
  paragraph. `git status --porcelain` after the run: EMPTY — no byte
  reached disk (`textedit_writes` 0).
- **Diagnosis (from the transcript, `benchmark_logs/s48_t1_run1.log`):
  all three failures are artifacts of the run's own verification
  code, not of the edit.** The run assembled multi-line expectation
  strings and concatenated `lines()` text WITHOUT line terminators,
  so every multi-line substring assertion (`editroot_block_unchanged`,
  `rlmBackend_between_textedit_and_scratch`, `stub_header_intact`)
  read False while every single-line assertion (the four schema
  lines, the ambient-guard message, the budget line) read True. The
  SAME verification cell printed the actual regions, and they match
  the spec: the four keys with house comments after the budget
  block, the ambient guard + three cross-field refusals + the
  resolved local after the editRoot block, the `rlmBackend` block
  between `textedit` and `scratch`, the stub header intact with the
  vitest import as the first authored line. The run's own report
  even names the mechanism ("without line terminators preserved").
- **What worked as designed:** two live `AnchorMismatchError`
  refusals caught address-shift after earlier staged inserts (the
  run re-located and retried — the Session 41 teaching-refusal loop,
  observed twice); verify-then-write held (failed verification means
  nothing was written); the contradiction rule was followed to the
  letter. The failure class is run-internal verification string
  assembly — closed by task discipline, not by any machinery change.
- **Task text v2 (the recorded contingency's input) = v1 with two
  deltas, verbatim:** (1) appended to step 4: frame lines on this
  CRLF file carry a trailing `"\r"` — include it in every anchor;
  line addresses SHIFT after every staged insert — re-locate before
  EACH insert; an `AnchorMismatchError` stages nothing — re-locate
  and retry. (2) step 6 gains the ASSERTION DISCIPLINE paragraph:
  multi-line regions are compared as LISTS of consecutive line texts
  (or joined with `"\n"`), never as terminator-less concatenations;
  and a new step 7: an assertion printing false with the printed
  region showing the intended content means fix the ASSERTION and
  re-verify in a new iteration — only a genuine content mismatch in
  the printed region itself means stop, revert, and report (the
  run-1 false-abort class). Old steps 7/8 renumber to 8/9 (which
  also fixes v1's step-2 forward reference to "step 8").
- **Budget state:** $0.8760 of the ≤$1.80 approved total spent; the
  contingency run must land inside the remaining $0.9240 or the
  increment records a FAILED verdict with no third run.

### 5h.8 Run 2 and the increment verdict (July 13, 2026 — FAILED; recorded; no third run)

- **The run ($1.2303 computed from tokens — 402,781 in / 22,332 out
  at the gpt-5.4 rates; 14 calls, 123.5s; 4 db tool calls; 140
  textedit ops / 8 guarded ops / 0 raw splices / 2 write_backs; 1
  retrieval fetch / 1 dedup refusal / 0 budget refusals;
  `answer_submits` 1) WROTE both named files** — an insert-only diff
  (220 insertions, 0 deletions: the four keys, the ambient guard, the
  three cross-field refusals, the resolved local, the `rlmBackend`
  export, and the full test body under the byte-intact stub header) —
  and recorded its insight through the Session 31 gate.
- **The mechanical verdict: `stage2:check` flagged
  `unbridged_evidence`** — the recorded insight cites
  `1a6b13761f1245280596de9a3aa4d30b30e5878e09d07940505b41df9a062d3f`,
  which bridges only to `repo:trellis:src/config/mcp_servers.ts`, not
  to a named file. The transcript shows the mechanism precisely: the
  run's second evidence cell re-fetched the already-fetched graph
  hash, the dedup refusal raised and KILLED the cell BEFORE its two
  `vector_search` calls executed, the run never re-ran the searches,
  so no `index.ts` block ever entered the retrieval set — and at
  insight time the run cited the one address it had (the
  `mcp_servers.ts` implementation block) instead of stopping, despite
  the task rule and despite having verified the call-site bytes only
  in its loaded FRAME (frames confer no citability; retrieval does).
  The Session 31 gate correctly permitted the write (the hash WAS
  retrieved); the Session 35 bridge check correctly flagged it — the
  second live `unbridged_evidence` firing ever (Session 37 run 1 was
  the first).
- **Criterion verdict, item by item:** (1) named-file-only diff PASS
  (exactly the two files); (2) the evidence contract FAIL
  (unbridged citation); (3) `stage2:check` zero findings FAIL (one
  finding; scope and the parse gate themselves were clean); (4)
  guarded-only PASS (`textedit_raw_splices` 0); (5) the increment's
  own pins green PASS as a DIAGNOSTIC (with the diff applied,
  `npm test` read 846/86 — 9 new pins, all green, zero existing
  tests changed); (6) human diff review: content read
  spec-conformant (recorded as a diagnostic; review is moot under a
  harness flag); (7) spend within estimate FAIL — run 2 $1.2303
  exceeded the $0.40–$0.90 band, and the session's run total
  $2.1063 exceeded the ≤$1.80 approved envelope (still under the
  standing ≤$5/run cap). **Verdict: increment T1 FAILED — a harness
  flag plus a budget breach; recorded, no third run (the §5f.5
  precedent).**
- **The spend mechanism, reported honestly:** run 2 was spawned with
  $0.9240 of envelope remaining against a run-1 basis of $0.8760;
  its input tokens came in 39% over run 1 (larger frames — the file
  re-reads after every guarded insert — plus the full test-body
  authoring), and the overrun was only measurable after the fact.
  The feature-class estimate basis is re-based for any retry:
  two-file authoring runs cost $0.9–$1.3, not $0.4–$0.9.
- **Cleanup (both bounded, both recorded):** the residual insight
  edge was deleted under the Session 37 operator-cleanup precedent —
  `MATCH (s:Entity {name:'config'})-[r:DERIVED_INSIGHT
  {verb:'resolves_fail_fast'}]->(o:Entity {name:'mcpcredentialenv'})
  DELETE r` — count 1 before, 0 after, no entity touched; the
  working tree was reverted (`git checkout` of both named files) and
  the stub removed in a recorded commit (§5h.2's rule: the stub
  leaves with a failed increment; `npm test` back to 837/85 green).
  The graph write is otherwise audit-preserved in the run log
  (`benchmark_logs/s48_t1_run1.log`, `s48_t1_run2.log`,
  `s48_t1_run2.diff` — local, gitignored).
- **Retry lessons (task v3 material; the retry enters as its own
  owner-approved proposal):** (1) route the citable chain
  graph-first through the `config` `-uses_config_key-`
  `trellis_retrieval_budget_per_run` edge, whose provenance IS an
  `index.ts` block (`fc17205c…6311`) — noting the recorded `--pre`
  tension: entity `config` carries one contested attached edge
  (churn residue), so the retry proposal must either name different
  pre-gate entities or resolve that residue first, an open design
  point recorded for the proposal; (2) an explicit stop rule: if at
  insight time NO address in the retrieval set has bytes verbatim in
  the named file, write NOTHING and report — never substitute a
  related block; (3) one retrieval-surface call per REPL cell during
  evidence gathering — a typed refusal kills the entire cell and
  everything after it (run 2's `vector_search` calls died this way);
  (4) the re-based estimate above. The diff itself is preserved and
  content-correct; a retry re-authors it under the fixed evidence
  discipline rather than resurrecting bytes from a failed run.

### 5h.9 The retry proposal (staged same day, owner-directed; the run itself is Session 49's owner-approved decision)

Staged after the verdict under the §0 step-5 rule: the owner
directed drafting task text v3 NOW so the next session presents a
ready proposal. v3 was authored under the house prompt-engineering
and hypershot protocols (the July 12, 2026 kernel-prompt precedent,
applied to a task text for the first time): semantic tags to stop
context bleeding between the spec and the protocols, the two
decisive rules placed in attention zones at the head AND tail
(run 2's violated citation rule had been buried mid-step-3 prose),
positive instruction framing, and hypershot frames for every shape
the run must generate (the one free variable in the insight call is
instruction-bearing; no concrete filler content that could
contaminate the run's output — invariant tokens like tool names,
entity names, the spec bounds, and the exact guard message stay
concrete by the invariance test: they are the task's vocabulary,
identical across any run of this increment).

**Design decisions resolved here (closing §5h.8's open point):**

- **The `--pre` gate keeps the two clean entities**
  (`resolvemcpcredentialenv`, `mcpcredentialenv` — the insight
  object's neighborhood) while the task's evidence chain queries
  `trellis_retrieval_budget_per_run` with an explicit
  uncontested-edges-only filter in the Cypher. Reasoning: the
  pre-gate contract refuses edits premised on quarantined beliefs;
  the premise rides the UNCONTESTED `uses_config_key` edge, and the
  one contested edge on that entity (`reads_config`, churn residue,
  named in §5h.3) is filtered in-query and never consulted. Both
  contested edges stay recorded in §5h.3 for the owner's review; no
  residue recovery is proposed (lazy recovery stands).
- **The evidence chain, re-verified live this session (read-only):**
  `trellis_retrieval_budget_per_run` `-uses_config_key-` `config`
  reads uncontested with `sourceNodeIds` = [`fc17205c…6311`], and
  that block carries BOTH molds (the budget line in the export and
  the fail-fast comment + `resolveMcpCredentialEnv` call — §5h.3's
  probe), so it alone grounds the insight and bridges to the named
  file. `vector_search` is demoted to a bounded fallback (at most
  two calls, each its own cell).
- **Escalation rule (recorded now, so a recurrence is not
  re-litigated):** if the retry fails on the SAME evidence class,
  the next step is TOOLING SHAPE per the owner doctrine — a
  harness-side, read-only "citability" query (retrieval-set
  membership ∧ named-file bridge, the `gatherHashEvidence` join
  exposed to the run), proposed owner-gated as its own increment;
  never a write gate (the Session 35 invariant stands).
- **Estimate: $0.9–$1.3 for ONE run** (the §5h.8 re-based class);
  NO pre-bundled contingency — a second run, if ever, is its own
  owner decision, and a second T1 failure puts the three-failure
  question to the owner (the §5g.3 stopping rule). The criterion is
  §5h.6's, unchanged, with "spend within estimate" judged against
  THIS estimate.

**Task text v3 (the run INPUT, verbatim — no kernel prompt byte;
both composed-prompt pins unmoved):**

```
Stage-2 self-edit task (feature-class increment T1 retry: the
backend config surface).

<mission>
Implement a new validated configuration surface in
src/config/index.ts and author its unit pins in
src/config/rlm_backend.test.ts. The specification inside
<specification> is quoted from docs/architecture/MODEL_BACKEND_SEAM.md
(its section 3 and section 4 layer 1); this task text is the spec
channel - follow it exactly.
</mission>

<hard_rules>
*** CRITICAL - read these four rules first; re-read them before the
completion protocol. A violation fails the increment. ***
1. CITABILITY. The one derived insight you will record may cite
   ONLY hashes that satisfy BOTH conditions: (a) you retrieved the
   hash THIS RUN through trellis_postgres.get_ast_texts or
   trellis_postgres.vector_search, and (b) the retrieved text for
   that hash appears verbatim inside src/config/index.ts. Bytes
   visible in a trellis_textedit frame do not make a hash citable -
   only retrieval does.
2. STOP RULE. If you reach the completion protocol and NO hash
   satisfies rule 1, record NO insight: revert every staged edit
   with trellis_textedit.revert, and submit a report describing the
   situation via trellis_answer.submit. Citing a related block from
   another file is a violation, never a fallback.
3. ONE RETRIEVAL CALL PER CELL. Place every
   trellis_postgres.get_ast_texts and every
   trellis_postgres.vector_search call in its OWN REPL cell with
   nothing after it in that cell. A typed "Retrieval Discipline"
   refusal is a raised exception - it kills everything later in the
   same cell. If a refusal says a hash was already retrieved, reuse
   the variable holding the earlier result; re-fetch nothing.
4. GUARDED EDITS ONLY. Edit files only through
   trellis_textedit.replace_lines / insert_lines / delete_lines.
   The increment fails if textedit_raw_splices is nonzero.
</hard_rules>

<specification>
Part 1 - four new OPTIONAL environment keys in EnvSchema:
- TRELLIS_RLM_BACKEND: z.enum(['openai', 'vllm']).optional()
- TRELLIS_RLM_MODEL: z.string().min(1).max(256).optional()
- TRELLIS_RLM_BASE_URL: z.url().optional(), plus a refinement
  requiring the URL scheme to be http: or https:
- TRELLIS_RLM_API_KEY_ENV: z.string().min(1).max(128).optional()
Each key gets a comment block in the file's house style naming
MODEL_BACKEND_SEAM.md as the design record and stating that no
consumer reads these values yet (T2/T3 wire them).

Part 2 - imperative fail-fast checks after the schema parse (the
existing editRoot / mcpCredentialEnv precedent in the same file),
each throwing a plain Error whose message names every key involved:
1. If OPENAI_BASE_URL is present in process.env (any value,
   including empty), throw with EXACTLY this single-line message:
   Backend config: OPENAI_BASE_URL is not honored; set
   TRELLIS_RLM_BASE_URL (root agent) — worker transport is not yet
   configurable.
   (the dash between "(root agent)" and "worker" is an em dash,
   exactly as written above)
2. TRELLIS_RLM_BACKEND set to 'vllm' with TRELLIS_RLM_BASE_URL
   unset: refuse.
3. TRELLIS_RLM_API_KEY_ENV set with TRELLIS_RLM_BASE_URL unset:
   refuse.
4. TRELLIS_RLM_API_KEY_ENV set: the variable it names must be
   present and non-empty in process.env; otherwise refuse. Resolve
   the value once here into a local.
A base URL WITHOUT a backend is allowed - add no check for it.

Part 3 - a new export block on the config object:
  rlmBackend: { backend, model, baseUrl, apiKeyEnv, apiKeyValue }
where the first four are the validated values (each undefined when
its key is unset) and apiKeyValue is the fail-fast resolved value
of the named key variable (undefined when TRELLIS_RLM_API_KEY_ENV
is unset). With every key unset every field is undefined and every
existing config consumer reads exactly what it read before. The
comment on the block follows the config.mcp.credentialEnv
precedent: the resolved value never appears in logs or
serializations. No other code reads rlmBackend yet - change NO call
site anywhere.
</specification>

<evidence_protocol>
Goal: put at least one citable src/config/index.ts hash into your
retrieval set and confirm the task premise from its bytes.
1. (one cell) Query the graph with trellis_neo4j.run_cypher for the
   ACTION edges around the entity named
   'trellis_retrieval_budget_per_run' (entity names are
   lowercase-normalized; edges carry provenance in either
   direction, so use an undirected pattern in this shape:
   MATCH (e:Entity)-[r:ACTION]-(o:Entity)
   WHERE e.name = '{The_Entity_Named_Above}'
   RETURN r.verb, o.name, r.sourceNodeIds,
          coalesce(r.contested, false) AS contested).
   Keep ONLY uncontested edges. Among them, the edge with verb
   'uses_config_key' toward the entity named 'config' carries a
   sourceNodeIds hash whose block is part of src/config/index.ts -
   your primary citation candidate. Collect the distinct hashes
   from the uncontested edges.
2. (one cell - hard rule 3) Fetch ALL collected hashes in ONE
   trellis_postgres.get_ast_texts call. Print the first lines of
   each returned text.
3. (one cell) Load src/config/index.ts with trellis_textedit.load.
   Build the file text by joining the frame's lines with "\n"
   (frame lines keep their trailing "\r" on this CRLF file).
   Classify every fetched hash and PRINT the classification:
   CITABLE when its full retrieved text appears verbatim in the
   file text; NOT-CITABLE otherwise (blocks from other files, for
   example src/workers/rlm_job.ts or src/rlm/trellis_tools.py,
   inform you but stay uncitable - hard rule 1). Hold the citable
   hash(es) in a variable for the completion protocol. Confirm from
   the citable bytes: the TRELLIS_RETRIEVAL_BUDGET_PER_RUN
   validation (the optional-env-twin mold your new keys follow) and
   the "Fail fast at startup" comment with the
   resolveMcpCredentialEnv(mcpServers, process.env) call (the
   credential mold your key resolution follows) exist in this file.
4. (fallback, only if step 3 classified NO hash citable) You may
   make at most TWO trellis_postgres.vector_search calls - each in
   its own cell (hard rule 3) - with queries you compose about the
   budget validation or the credential fail-fast resolution in
   src/config/index.ts; fetch nothing you already hold; then
   re-classify. If still no citable hash: hard rule 2 applies.
</evidence_protocol>

<editing_protocol>
5. (one cell) Load src/config/rlm_backend.test.ts and
   src/config/textedit_bounds.test.ts. Verify the test stub is
   exactly a four-line header comment; read the bounds test to
   learn the house per-topic config-test mold: a managed-keys env
   save/restore helper, vi.resetModules() plus a dynamic
   import('./index') per load, afterEach restore. You will author
   fresh code in those conventions - never re-type another file's
   bytes as your own.
6. Edit src/config/index.ts with exactly three guarded inserts
   (hard rule 4): (a) the four keys with their comments inside
   EnvSchema, anchored after the TRELLIS_RETRIEVAL_BUDGET_PER_RUN
   line's comment block; (b) the ambient guard and the three
   cross-field refusals with the resolved local, after the existing
   editRoot fail-fast block; (c) the rlmBackend block inside the
   config object literal, anchored between existing export blocks
   (for example after textedit). Discipline for every insert: read
   the neighborhood with trellis_textedit.lines() in the same cell
   as the insert; anchors are byte-exact and include the trailing
   "\r"; line addresses SHIFT after every staged insert, so
   re-locate before EACH insert and never reuse an address computed
   before an earlier one; an AnchorMismatchError stages nothing -
   re-locate and retry. Do not modify, re-type, or re-wrap ANY
   existing line.
7. Author the test body in src/config/rlm_backend.test.ts below the
   byte-intact four-line header with guarded insert_lines anchored
   on the header's last line. Manage these keys in the helper: the
   four TRELLIS_RLM_* keys, OPENAI_BASE_URL, and one scratch
   variable name of your choice for the key-env pins. One describe
   block with these pins:
   (a) unset default: config.rlmBackend deep-equals the
       all-undefined five-field shape;
   (b) backend accepts 'openai' alone and 'vllm' with a base URL;
       refuses an unknown enum value;
   (c) model accepts an ordinary id; refuses '' and a 257-char
       string;
   (d) base URL accepts http://127.0.0.1:8000/v1 and an https URL
       with no backend set; refuses a non-URL and ftp://host/;
   (e) 'vllm' without base URL refuses and the message names both
       keys;
   (f) key-env without base URL refuses and the message names both
       keys;
   (g) key-env with base URL and the named variable set populates
       apiKeyEnv and apiKeyValue;
   (h) key-env naming an absent variable refuses; naming a present
       but empty variable refuses;
   (i) ambient OPENAI_BASE_URL set makes config load throw with the
       exact Part-2 guard message.
8. Review each file's staged state with trellis_textedit.diff, then
   write_back each file.
</editing_protocol>

<verification_protocol>
9. In its OWN REPL iteration (never the cell of any write or the
   submit): re-read the three edited regions of src/config/index.ts
   and the whole test file with trellis_textedit.lines(), PRINT
   them, and assert in code with each result printed. ASSERTION
   DISCIPLINE: lines() returns [index, text] pairs where text is
   one line WITHOUT its terminating newline (each line still
   carries its trailing "\r"). Compare multi-line regions as LISTS
   of consecutive line texts, in this shape:
   [t for _, t in region] == [{Expected_Line}, {Expected_Line}, ...]
   or join with "\n" before comparing. Never concatenate line texts
   without terminators and then substring-check a multi-line
   string - that check reads false even when the region is correct.
   Assert: (a) each of the four TRELLIS_RLM_* schema entries
   appears exactly once; (b) the ambient-guard message appears
   exactly once in index.ts; (c) the TRELLIS_RETRIEVAL_BUDGET_PER_RUN
   line is byte-unchanged and the editRoot fail-fast block's line
   list is byte-unchanged; (d) the rlmBackend block sits inside the
   config object literal with its neighboring blocks intact; (e)
   the four stub header lines compare equal AS A LIST to the four
   expected header lines, and the first non-header line of the test
   file is your own import line.
10. If an assertion prints false while the PRINTED region shows the
   intended content, the assertion is the bug: fix the assertion
   and re-verify in a new iteration. Only a genuine content
   mismatch, visible in the printed region itself, means hard
   rule 2: revert, no insight, report.
</verification_protocol>

<completion_protocol>
11. Re-read <hard_rules>. Only after every step-9 assertion has
   printed true, in a LATER iteration, record exactly one derived
   insight:
   trellis_neo4j.write_derived_insight(
     subject='config', verb='resolves_fail_fast',
     obj='mcpcredentialenv',
     sourceNodeIds=[{Citable_Index_Ts_Hashes_Held_From_Step_3}])
   where the list contains ONLY hashes your step-3 classification
   printed CITABLE (hard rules 1 and 2).
12. Submit a short report via trellis_answer.submit describing what
   the graph said, what the retrieved bytes confirmed, what you
   added, the anchors you used, and which hash(es) you cited and
   why they were citable.
</completion_protocol>

Edit no other file. If the graph, the retrieved bytes, or the file
contents contradict this task (the molds are absent, the stub
header is absent, or no citable hash exists), stop: revert staged
edits, record no insight, and report the contradiction.

*** THE TWO DECISIVE RULES, ONCE MORE ***
- Cite only hashes RETRIEVED THIS RUN whose bytes live verbatim in
  src/config/index.ts; none citable means NO insight at all.
- One retrieval call per REPL cell.
```

### 5h.10 The Session 49 retry attempt (July 13, 2026 — ENVIRONMENTALLY BLOCKED; $0.0000 spent; the staged proposal STANDS)

The retry was presented at session start per §5h.9 and approved by
the owner. Every staged premise was re-verified live and read-only
BEFORE the proposal (all held): the
`trellis_retrieval_budget_per_run` `-uses_config_key-` `config`
edge uncontested with `sourceNodeIds` =
[`fc17205c4b1e129508c7fb5c675944300b124939b4c609bfe77352b39ab76311`]
(the contested `reads_config` churn residue present exactly as
§5h.3 records it); that block's bytes verbatim on disk in
`src/config/index.ts` (raw byte-substring check, CRLF intact) and
carrying BOTH molds (the `TRELLIS_RETRIEVAL_BUDGET_PER_RUN` schema
line, the "Fail fast at startup" comment, the
`resolveMcpCredentialEnv(mcpServers, process.env)` call);
`stage2:check --pre` PASS zero findings on
`resolvemcpcredentialenv` + `mcpcredentialenv` with
`src/config/index.ts`; `test:selfedit-harness` ALL CHECKS PASSED;
the split-scope policy-1 `--dry-run` echo 0 to ingest / 301
unchanged / 0 tombstones (no drift since the §5h.3 echo — no
pre-run refresh owed); `npm test` 837/85 green after `npm ci`.

**The run never executed. Two environmental failures, both
pre-billing, $0.0000 total:**

- **Spawn 1: a Windows console-encoding crash inside the `RLM(...)`
  constructor, before any API call.** The rlms verbose logger
  prints a rich header panel whose box glyphs include U+25C6; with
  stdout redirected to a file the Python stream encoder was cp1252
  and the process died on `UnicodeEncodeError` — zero root
  iterations, zero tool calls, zero tokens
  (`benchmark_logs/s49_t1_retry_run1.log`). Driver requirement
  recorded: any Windows spawn that redirects the agent's stdout
  sets `PYTHONUTF8=1` (Session 48's spawns did not hit this; the
  stream encoding is shell-environment-shaped).
- **Spawn 1b (with `PYTHONUTF8=1`): the first root completion was
  refused `429 insufficient_quota`** — the OpenAI account behind
  the ambient `OPENAI_API_KEY` has exhausted its billing quota
  (`benchmark_logs/s49_t1_retry_run1b.log`). The decisive probe,
  recorded: `models.list` succeeds (the key AUTHENTICATES; 131
  models) while a minimal `chat.completions.create` refuses with
  the same `insufficient_quota` code — authentication proves
  nothing about completion quota. Rejected requests do not bill;
  the run spent $0.0000.

**Verdict: ENVIRONMENTALLY BLOCKED, not a failed run** (the
Session 42 precedent: owner approval was given and was never the
blocker). Task v3 is UNCONSUMED — zero LLM iterations, zero staged
edits, zero disk writes, zero graph writes — and this attempt does
NOT count against the §5g.3 attempt ladder; T1 still stands at ONE
failed attempt (Session 48). The §5h.9 proposal, its estimate, and
its escalation rule all stand as staged.

**Cleanup per §5h.2:** the stub was created and committed only
after approval (porcelain clean at spawn) and removed in a recorded
commit when the blockage was confirmed — the suite reads 837/85
green at every shipped state; the branch history carries the stub
add/remove pair (net zero), the Session 48 pattern.

**Unblock condition + the next spawn's pre-flight (recorded for
Session 50):** the owner restores OpenAI billing quota; the spawn
pre-flight then runs the minimal completion probe FIRST (a
fraction of a cent, inside the run envelope — `models.list` alone
is NOT sufficient), sets `PYTHONUTF8=1`, and proceeds under the
unchanged §5h.9 mechanics. Premise re-verification stays cheap and
read-only; re-run it if any substrate-touching work lands between
sessions.

### 5h.11 The v3.1 amendment and the Session 50 retry (July 13, 2026)

**Context.** The post-Session-49 owner direction (PR #94,
`docs/architecture/RLM_HARNESS_SCAFFOLDING.md`) re-scoped Session 50
to scaffolds-then-retry: Part A landed the S1/S2a/S3 scaffolds as a
human-authored kernel increment (the uuid task wrapper +
`trellis_task`, the `upsum` addendum discipline, and the staged
helpers including `citable()` — both composed-prompt pins recomputed;
`npm test` 837/85 → 866/86; `test:rlm-sandbox` 95 → 118;
`test:selfedit-harness` gains section [9] with the
citable-vs-`gatherHashEvidence` mirror pin), and the §5h.9 task v3 is
amended to v3.1 so the retry RUNS ON the scaffolds instead of
carrying their disciplines purely in prose. The run itself was
approved by the owner at session start (the blanket run approval
covering this staged proposal — ONE run, the §5h.9 estimate
$0.9–$1.3, no pre-bundled contingency).

**Pre-flight, in order (all held, July 13, 2026):**

- **The quota probe FIRST (the §5h.10 unblock condition):** one
  minimal `chat.completions.create` against `gpt-5.4-2026-03-05`
  returned normally (12 in / 4 out tokens, ≈$0.00007) — **quota is
  RESTORED**; the Session 49 blockage is over.
- **Premises re-verified live, read-only (the §5g.2 mold, third
  consecutive green):** the `trellis_retrieval_budget_per_run`
  `-uses_config_key-` `config` edge uncontested citing exactly
  [`fc17205c…6311`] (the contested `reads_config` churn residue
  present exactly as §5h.3 records); the block's bytes verbatim in
  `src/config/index.ts` by raw byte-substring check (3,959 chars =
  3,961 utf-8 bytes — reconciling §5h.10's byte count), carrying
  BOTH molds; `stage2:check --pre` PASS zero findings on
  `resolvemcpcredentialenv` + `mcpcredentialenv` with
  `src/config/index.ts` (the §5h.2 shape: the stub has no substrate
  document, so `--pre` names only `index.ts`);
  `test:selfedit-harness` ALL CHECKS PASSED (with the new section
  [9]).
- **Refresh-before-use:** the split-scope policy-1 `--dry-run` echo
  read 8 to ingest / 294 unchanged / 0 tombstones — the drift is
  EXACTLY this session's own eight Part-A files (scripts drills +
  `src/workers/rlm_job.*`), none of them the evidence-chain file
  (`src/config/index.ts` unchanged since `trellis#11`) and none a
  named file. The refresh is deferred to the single post-landing
  per-PR refresh covering Part A and T1 together; recorded here so
  the reasoning is reviewable.

**Task text v3.1 = v3 (§5h.9, verbatim) with six recorded deltas —
the scaffolds replacing prose-only discipline:**

- **D1 (hard rules, head + tail):** the re-reads route through the
  engine — `trellis_task.grep('CITABILITY|STOP RULE|RETRIEVAL
  CALL|GUARDED')` — instead of attention; the tail's first decisive
  rule adds "confirm with citable()".
- **D2 (new `<state_protocol>` block after `<hard_rules>`):** the
  `upsum` discipline (create in the first cell; update every cell;
  print + re-read the hard rules by code before each decisive step).
- **D3 (evidence step 3):** `frame_text('src/config/index.ts')`
  replaces the hand-joined frame text, and the step gains the
  `citable(all_fetched_hashes)` cross-check — a citation is
  permissible only when the byte-verbatim classification AND the
  probe's `citable` field both say yes.
- **D4 (verification step 9):** the ASSERTION DISCIPLINE paragraph
  now routes through `region_equal` / `region_lines` /
  `frame_text` (the run-1 class closed at the namespace level).
- **D5 (completion step 11):** the by-code hard-rules re-read +
  `upsum` print + a final `citable()` re-check before the ONE
  insight write (informational — the STOP rule is unchanged; the
  probe never gates).
- **D6 (driver):** the spawn env adds
  `TRELLIS_TASK_NAMED_FILES=["src/config/index.ts","src/config/rlm_backend.test.ts"]`
  (injecting `citable`) and `PYTHONUTF8=1` (the §5h.10 cp1252
  class); output to ONE log file, never `tee | head`.

Every other rule, the spec parts 1–3, the editing protocol, the
estimate ($0.9–$1.3, ONE run), the criterion (§5h.6 judged against
THIS estimate), and the escalation rule stand verbatim from §5h.9.

**Task text v3.1 (the run INPUT, verbatim):**

```
Stage-2 self-edit task (feature-class increment T1 retry: the
backend config surface).

<mission>
Implement a new validated configuration surface in
src/config/index.ts and author its unit pins in
src/config/rlm_backend.test.ts. The specification inside
<specification> is quoted from docs/architecture/MODEL_BACKEND_SEAM.md
(its section 3 and section 4 layer 1); this task text is the spec
channel - follow it exactly.
</mission>

<hard_rules>
*** CRITICAL - read these four rules first; re-read them BY CODE
before the completion protocol:
trellis_task.grep('CITABILITY|STOP RULE|RETRIEVAL CALL|GUARDED').
A violation fails the increment. ***
1. CITABILITY. The one derived insight you will record may cite
   ONLY hashes that satisfy BOTH conditions: (a) you retrieved the
   hash THIS RUN through trellis_postgres.get_ast_texts or
   trellis_postgres.vector_search, and (b) the retrieved text for
   that hash appears verbatim inside src/config/index.ts. Bytes
   visible in a trellis_textedit frame do not make a hash citable -
   only retrieval does. The injected citable(hashes) probe reports
   both halves; use it and believe it.
2. STOP RULE. If you reach the completion protocol and NO hash
   satisfies rule 1, record NO insight: revert every staged edit
   with trellis_textedit.revert, and submit a report describing the
   situation via trellis_answer.submit. Citing a related block from
   another file is a violation, never a fallback.
3. ONE RETRIEVAL CALL PER CELL. Place every
   trellis_postgres.get_ast_texts and every
   trellis_postgres.vector_search call in its OWN REPL cell with
   nothing after it in that cell. A typed "Retrieval Discipline"
   refusal is a raised exception - it kills everything later in the
   same cell. If a refusal says a hash was already retrieved, reuse
   the variable holding the earlier result; re-fetch nothing.
4. GUARDED EDITS ONLY. Edit files only through
   trellis_textedit.replace_lines / insert_lines / delete_lines.
   The increment fails if textedit_raw_splices is nonzero.
</hard_rules>

<state_protocol>
Maintain the upsum dict the system prompt requires: create it in
your FIRST repl cell with keys done, pending, blocked, and
decisive_facts; update it at the end of EVERY cell; print it - and
re-read the hard rules with trellis_task.grep - before each decisive
step (the first write_back, the insight write, the final submit). An
item still in pending is work you have NOT done, however far back
the transcript says otherwise.
</state_protocol>

<specification>
Part 1 - four new OPTIONAL environment keys in EnvSchema:
- TRELLIS_RLM_BACKEND: z.enum(['openai', 'vllm']).optional()
- TRELLIS_RLM_MODEL: z.string().min(1).max(256).optional()
- TRELLIS_RLM_BASE_URL: z.url().optional(), plus a refinement
  requiring the URL scheme to be http: or https:
- TRELLIS_RLM_API_KEY_ENV: z.string().min(1).max(128).optional()
Each key gets a comment block in the file's house style naming
MODEL_BACKEND_SEAM.md as the design record and stating that no
consumer reads these values yet (T2/T3 wire them).

Part 2 - imperative fail-fast checks after the schema parse (the
existing editRoot / mcpCredentialEnv precedent in the same file),
each throwing a plain Error whose message names every key involved:
1. If OPENAI_BASE_URL is present in process.env (any value,
   including empty), throw with EXACTLY this single-line message:
   Backend config: OPENAI_BASE_URL is not honored; set
   TRELLIS_RLM_BASE_URL (root agent) — worker transport is not yet
   configurable.
   (the dash between "(root agent)" and "worker" is an em dash,
   exactly as written above)
2. TRELLIS_RLM_BACKEND set to 'vllm' with TRELLIS_RLM_BASE_URL
   unset: refuse.
3. TRELLIS_RLM_API_KEY_ENV set with TRELLIS_RLM_BASE_URL unset:
   refuse.
4. TRELLIS_RLM_API_KEY_ENV set: the variable it names must be
   present and non-empty in process.env; otherwise refuse. Resolve
   the value once here into a local.
A base URL WITHOUT a backend is allowed - add no check for it.

Part 3 - a new export block on the config object:
  rlmBackend: { backend, model, baseUrl, apiKeyEnv, apiKeyValue }
where the first four are the validated values (each undefined when
its key is unset) and apiKeyValue is the fail-fast resolved value
of the named key variable (undefined when TRELLIS_RLM_API_KEY_ENV
is unset). With every key unset every field is undefined and every
existing config consumer reads exactly what it read before. The
comment on the block follows the config.mcp.credentialEnv
precedent: the resolved value never appears in logs or
serializations. No other code reads rlmBackend yet - change NO call
site anywhere.
</specification>

<evidence_protocol>
Goal: put at least one citable src/config/index.ts hash into your
retrieval set and confirm the task premise from its bytes.
1. (one cell) Query the graph with trellis_neo4j.run_cypher for the
   ACTION edges around the entity named
   'trellis_retrieval_budget_per_run' (entity names are
   lowercase-normalized; edges carry provenance in either
   direction, so use an undirected pattern in this shape:
   MATCH (e:Entity)-[r:ACTION]-(o:Entity)
   WHERE e.name = '{The_Entity_Named_Above}'
   RETURN r.verb, o.name, r.sourceNodeIds,
          coalesce(r.contested, false) AS contested).
   Keep ONLY uncontested edges. Among them, the edge with verb
   'uses_config_key' toward the entity named 'config' carries a
   sourceNodeIds hash whose block is part of src/config/index.ts -
   your primary citation candidate. Collect the distinct hashes
   from the uncontested edges.
2. (one cell - hard rule 3) Fetch ALL collected hashes in ONE
   trellis_postgres.get_ast_texts call. Print the first lines of
   each returned text.
3. (one cell) Load src/config/index.ts with trellis_textedit.load.
   Build the file text with frame_text('src/config/index.ts') - the
   canonical join, terminators included (frame lines keep their
   trailing "\r" on this CRLF file). Classify every fetched hash
   and PRINT the classification: CITABLE when its full retrieved
   text appears verbatim in the frame_text result; NOT-CITABLE
   otherwise (blocks from other files, for example
   src/workers/rlm_job.ts or src/rlm/trellis_tools.py, inform you
   but stay uncitable - hard rule 1). Cross-check with
   citable(all_fetched_hashes) and PRINT its report: a hash is a
   permissible citation ONLY when your byte-verbatim classification
   and the probe's citable field BOTH say yes. Hold the permissible
   hash(es) in a variable for the completion protocol. Confirm from
   the citable bytes: the TRELLIS_RETRIEVAL_BUDGET_PER_RUN
   validation (the optional-env-twin mold your new keys follow) and
   the "Fail fast at startup" comment with the
   resolveMcpCredentialEnv(mcpServers, process.env) call (the
   credential mold your key resolution follows) exist in this file.
4. (fallback, only if step 3 classified NO hash citable) You may
   make at most TWO trellis_postgres.vector_search calls - each in
   its own cell (hard rule 3) - with queries you compose about the
   budget validation or the credential fail-fast resolution in
   src/config/index.ts; fetch nothing you already hold; then
   re-classify. If still no citable hash: hard rule 2 applies.
</evidence_protocol>

<editing_protocol>
5. (one cell) Load src/config/rlm_backend.test.ts and
   src/config/textedit_bounds.test.ts. Verify the test stub is
   exactly a four-line header comment; read the bounds test to
   learn the house per-topic config-test mold: a managed-keys env
   save/restore helper, vi.resetModules() plus a dynamic
   import('./index') per load, afterEach restore. You will author
   fresh code in those conventions - never re-type another file's
   bytes as your own.
6. Edit src/config/index.ts with exactly three guarded inserts
   (hard rule 4): (a) the four keys with their comments inside
   EnvSchema, anchored after the TRELLIS_RETRIEVAL_BUDGET_PER_RUN
   line's comment block; (b) the ambient guard and the three
   cross-field refusals with the resolved local, after the existing
   editRoot fail-fast block; (c) the rlmBackend block inside the
   config object literal, anchored between existing export blocks
   (for example after textedit). Discipline for every insert: read
   the neighborhood with trellis_textedit.lines() in the same cell
   as the insert; anchors are byte-exact and include the trailing
   "\r"; line addresses SHIFT after every staged insert, so
   re-locate before EACH insert and never reuse an address computed
   before an earlier one; an AnchorMismatchError stages nothing -
   re-locate and retry. Do not modify, re-type, or re-wrap ANY
   existing line.
7. Author the test body in src/config/rlm_backend.test.ts below the
   byte-intact four-line header with guarded insert_lines anchored
   on the header's last line. Manage these keys in the helper: the
   four TRELLIS_RLM_* keys, OPENAI_BASE_URL, and one scratch
   variable name of your choice for the key-env pins. One describe
   block with these pins:
   (a) unset default: config.rlmBackend deep-equals the
       all-undefined five-field shape;
   (b) backend accepts 'openai' alone and 'vllm' with a base URL;
       refuses an unknown enum value;
   (c) model accepts an ordinary id; refuses '' and a 257-char
       string;
   (d) base URL accepts http://127.0.0.1:8000/v1 and an https URL
       with no backend set; refuses a non-URL and ftp://host/;
   (e) 'vllm' without base URL refuses and the message names both
       keys;
   (f) key-env without base URL refuses and the message names both
       keys;
   (g) key-env with base URL and the named variable set populates
       apiKeyEnv and apiKeyValue;
   (h) key-env naming an absent variable refuses; naming a present
       but empty variable refuses;
   (i) ambient OPENAI_BASE_URL set makes config load throw with the
       exact Part-2 guard message.
8. Review each file's staged state with trellis_textedit.diff, then
   write_back each file.
</editing_protocol>

<verification_protocol>
9. In its OWN REPL iteration (never the cell of any write or the
   submit): re-read the three edited regions of src/config/index.ts
   and the whole test file, PRINT them, and assert in code with
   each result printed. ASSERTION DISCIPLINE: verify each
   multi-line region with region_equal(relpath, start,
   expected_lines) where expected_lines is a LIST of newline-free
   strings (each line still carries its trailing "\r"), or compare
   region_lines(relpath, start, end) against your expected LIST.
   For whole-file substring checks use frame_text(relpath), which
   keeps the terminators. Never concatenate line texts without
   terminators and then substring-check a multi-line string - that
   check reads false even when the region is correct.
   Assert: (a) each of the four TRELLIS_RLM_* schema entries
   appears exactly once; (b) the ambient-guard message appears
   exactly once in index.ts; (c) the TRELLIS_RETRIEVAL_BUDGET_PER_RUN
   line is byte-unchanged and the editRoot fail-fast block's line
   list is byte-unchanged; (d) the rlmBackend block sits inside the
   config object literal with its neighboring blocks intact; (e)
   the four stub header lines compare equal AS A LIST to the four
   expected header lines, and the first non-header line of the test
   file is your own import line.
10. If an assertion prints false while the PRINTED region shows the
   intended content, the assertion is the bug: fix the assertion
   and re-verify in a new iteration. Only a genuine content
   mismatch, visible in the printed region itself, means hard
   rule 2: revert, no insight, report.
</verification_protocol>

<completion_protocol>
11. Re-read the hard rules BY CODE:
   trellis_task.grep('CITABILITY|STOP RULE|RETRIEVAL CALL|GUARDED'),
   and print upsum. Call citable() on your held candidate hash(es)
   and PRINT the report; keep only hashes whose citable field is
   True (hard rules 1 and 2). Only after every step-9 assertion has
   printed true, in a LATER iteration, record exactly one derived
   insight:
   trellis_neo4j.write_derived_insight(
     subject='config', verb='resolves_fail_fast',
     obj='mcpcredentialenv',
     sourceNodeIds=[{Citable_Index_Ts_Hashes_Held_From_Step_3}])
   where the list contains ONLY hashes your step-3 classification
   AND the citable() probe both reported citable.
12. Submit a short report via trellis_answer.submit describing what
   the graph said, what the retrieved bytes confirmed, what you
   added, the anchors you used, and which hash(es) you cited and
   why they were citable.
</completion_protocol>

Edit no other file. If the graph, the retrieved bytes, or the file
contents contradict this task (the molds are absent, the stub
header is absent, or no citable hash exists), stop: revert staged
edits, record no insight, and report the contradiction.

*** THE TWO DECISIVE RULES, ONCE MORE ***
- Cite only hashes RETRIEVED THIS RUN whose bytes live verbatim in
  src/config/index.ts - confirm with citable() and believe it; none
  citable means NO insight at all.
- One retrieval call per REPL cell.
```

(v3.1 is the historical input the LANDED T1 ran on, preserved
verbatim; §5h.12 records the skills-strengthened successor v3.2,
which SUPERSEDES v3.1 as the T-series template. The run below ran on
v3.1.)

**The run (July 13, 2026 — ONE spawn, first shot): $0.5781 computed
from tokens (192,978 in / 9,561 out at the gpt-5.4 rates; UNDER the
$0.9–$1.3 estimate), 11 root iterations of the 16 allowed, 66.4s;
3 db tool calls / 3 retrieved addresses / 1 retrieval fetch /
0 dedup refusals / 0 budget refusals; 32 textedit ops / 3 files
held / 2 write_backs / 4 guarded ops / 0 raw splices;
`answer_submits` 1; porcelain after the run: exactly the two named
files.** The run followed the amended protocols end to end: the
graph query surfaced the three uncontested provenance hashes, ONE
`get_ast_texts` call fetched all three (no dedup refusal ever
fired — the run-2 class never recurred), `frame_text` classified
exactly one hash byte-verbatim in `index.ts`, the `citable()` probe
agreed ("Permissible citable hash count for index.ts: 1" in the
run's own upsum), the `upsum` dict was created in the first cell
and visibly maintained through every iteration, ONE live
`AnchorMismatchError` fired mid-edit (an address computed before an
earlier staged insert) and the run re-located and retried — the
Session 41 teaching loop — and the completion protocol re-read the
hard rules through `trellis_task.grep` before the ONE gated insight
write. The uuid tags are not echoed anywhere in the transcript (the
prompt is never logged); the surface's function is observed through
the run's own grep calls. Log:
`benchmark_logs/s50_t1_retry_run1.log` (local, gitignored).

**Criterion verdict, item by item — ALL SEVEN PASS; increment T1
LANDED:**

1. Named-file-only diff PASS — porcelain shows exactly
   `src/config/index.ts` + `src/config/rlm_backend.test.ts`;
   insert-only (173 insertions, 0 deletions).
2. Evidence contract PASS — exactly one DERIVED_INSIGHT `config`
   `-resolves_fail_fast->` `mcpcredentialenv` through the
   Session 31 gate, citing exactly [`fc17205c…6311`] (retrieved
   this run; bridges to `repo:trellis:src/config/index.ts`); the
   citation audit reads cited ⊆ read, `citedButUnread` empty.
3. `stage2:check` zero findings PASS (scope + evidence + parse
   gate; comment-class not declared) — the FIRST zero-findings T1
   run.
4. Guarded-only PASS — `textedit_raw_splices` 0.
5. The increment's own pins green PASS — `npm test` 866/86 →
   875/87 with the diff applied: the run's nine pin groups all
   green, zero existing tests changed.
6. Human `git diff` review ACCEPTED against the spec — the four
   keys with their bounds, the EXACT ambient-guard message (em dash
   verified in the file bytes), the three cross-field refusals in
   spec order, the fail-fast resolved local, the five-field
   `rlmBackend` export, the byte-intact stub header with the vitest
   import as the first authored line, CRLF uniform (0 bare-LF
   lines), `git diff --check` clean. Two COSMETIC notes recorded
   (not spec violations; the landed diff is measured evidence and
   stays as written, the increments-1/2 no-hand-edit precedent):
   (a) the Part-2 guard block was inserted between the editRoot
   comment tail and its `const editRoot` line — the spec's
   placement ("after the schema parse") is satisfied, but the task
   text's step-6(b) anchor guidance ("after the existing editRoot
   fail-fast block") was not followed literally, and the editRoot
   comment now sits two blocks above its code; (b) one stray blank
   line between the `rlmBackend` and `textedit` export blocks.
7. Spend within estimate PASS — $0.5781 against $0.9–$1.3; session
   paid total including the quota probe ≈$0.5782, well under the
   ≤$5/run cap.

**The ladder record:** T1 landed on its second attempt overall
(Session 48 FAILED, Session 49 environmentally blocked and
unconsumed, this run LANDED first-shot on the scaffolds) — the
increment-2 shape repeated: failure classes closed mechanically
(the scaffolds) plus task discipline (v3.1), then a clean landing.
The §5h.9 escalation rule was never needed; the evidence class did
not recur. The honest attribution: this single landing cannot
separate the scaffolds' contribution from the v3.1 prose — what is
OBSERVED is that the run used `frame_text`/`citable()`/`upsum`/
`trellis_task.grep` at exactly the steps that failed in Session 48,
and none of those failure modes recurred.

**Post-landing (the §5h.3 churn note, EXECUTED and observed):** the
per-PR split-scope refresh ran the same day — policy-1 published
`trellis#12` (10 ingested / 305 unchanged / 0 tombstones; 7 blocks
queued of the 16-block printed bound) and the policy-2 `src/rlm`
leg published `trellis#13` (4 ingested / 313 unchanged / 0
tombstones; 26 queued of 32 eligible; the new
`trellis_scaffold.test.ts` test/fixture-excluded); extraction
actuals 27,073 in / 20,209 out + 15,029 embedding tokens ≈
**$0.2701**. The `index.ts` re-chunk killed the cited block and the
sweep CONTESTED the fresh insight edge exactly as pre-recorded —
ordinary lazy recovery, never a criterion item; the three standing
Session 36/39 beliefs rode through UNCONTESTED (their fourth
consecutive clean refresh).

### 5h.12 Task text v3.2 — the skills-strengthened successor (owner-directed, July 13, 2026; authored under `prompt-engineering` + `hypershot-protocol`)

The owner directed a genuine prompt-engineering pass over v3.1 with
both skills INVOKED (Guardrail 15), rejecting the earlier "PASS, no
change" audit as too lenient — that audit checked structural
COMPLIANCE (are semantic tags present? yes) but not STRENGTH (are the
highest-stakes rules maximally salient? are dense steps decomposed?
is the output schema'd? are hypershot frames used where braces are
allowed?). v3.1 stays recorded verbatim in §5h.11 as the historical
input the LANDED T1 ran on (never falsified); **v3.2 below is the
strengthened successor and is now the template the T-series inherits**
(the §5h.9→v3.1→v3.2 lineage). It was authored with `prompt-engineering`
and `hypershot-protocol` loaded and applied clause by clause.

**What the skills changed, mapped to their principles (the
iterative-refinement loop — `prompt-engineering` best practice 5,
tightening at each point of divergence):**

1. **Decoherence prevention (`prompt-engineering` BP3):** the
   `<mission>` now names the ONE failure the task exists to prevent
   (an insight citing an unretrieved block) instead of reading as a
   generic implement-task — the "why" is up front where it primes
   everything.
2. **Explicit prioritization + attention zone (`prompt-engineering`
   toolkit E):** the four rules are renamed R1–R4 with STABLE trigger
   tokens; THE STOP CONDITION (the load-bearing rule run 2 violated)
   is promoted to R2 with an explicit "the rule here wins" conflict
   ordering, and the grep pattern becomes the stable `R1|R2|R3|R4`.
3. **Positive instruction framing (`prompt-engineering` BP4):** every
   rule now LEADS with what to do ("Cite only what you retrieved",
   "When nothing is citable, write nothing", "Give every retrieval
   call its own cell", "Edit only through the guarded family") — the
   negations reinforce rather than lead.
4. **Hypershot frames where the addendum could not carry them
   (`hypershot-protocol` Rules B/C + §6):** the task text is NOT
   `.format()`-brace-constrained the way the composed-prompt addendum
   is (the completion query passes raw; the system-prompt splice
   doubles braces then `.format()` restores them), so `upsum` is now
   an instantiable FRAME with instruction-bearing variables — not a
   prose key list — and the final report is a `<output_contract>`
   frame (replacing v3.1's free-form "describe what the graph said").
   Invariance test preserved: tool names, entity names, the exact
   guard message, and spec bounds stay CONCRETE (the task's invariant
   vocabulary); only the run-specific fills are variables.
5. **Marker hierarchy matched to content (`prompt-engineering`
   toolkit B):** v3.1's dense multi-action steps (3, 6, 9, 11) are
   decomposed into labeled sub-sequences (E1–E4, M1–M4, V1–V2, C1–C3)
   with one action per bullet, so the model checks each off.
6. **Topological end-state (`prompt-engineering` BP1):** a new
   `<definition_of_done>` gives the model a crisp success frame to
   test itself against before submitting.
7. **Fixing the EXACT divergence the landed T1 diff showed
   (`prompt-engineering` BP5):** §5h.11's two cosmetic review notes
   (the Part-2 guard block landed between the editRoot comment tail
   and its `const`; a stray blank line) are addressed at the point of
   divergence — M2(b) now says place the guard block AFTER the
   editRoot block's closing line so the comment stays attached to its
   statement, and M2(c) states the one-blank-line block spacing. A
   stronger prompt would have prevented both.

**Task text v3.2 (the strengthened template — verbatim):**

```
Stage-2 self-edit task (feature-class increment T1: the backend
config surface).

<mission>
Add a validated configuration surface to src/config/index.ts and its
unit pins to src/config/rlm_backend.test.ts, exactly per
<specification>. This task text is the entire spec channel — the
design record it quotes lives outside your reach, so follow the bytes
here literally.
ONE failure has killed a prior attempt at this task: recording a
derived insight that cites a hash the run never retrieved from the
target file. <governing_rules> exists to make that failure
impossible. Read it first and obey it over every other instinct.
</mission>

<governing_rules>
*** CRITICAL — these four rules govern the whole run. Re-read them BY
CODE with trellis_task.grep('R1|R2|R3|R4') before each decisive step
(the first write_back, the insight write, the submit). If any
instruction below ever seems to conflict with a rule here, THE RULE
HERE WINS. ***

R1  CITE ONLY WHAT YOU RETRIEVED FROM THE TARGET. A hash is citable
    only when BOTH hold: you fetched it THIS RUN via
    trellis_postgres.get_ast_texts or
    trellis_postgres.vector_search, AND its retrieved text appears
    verbatim inside src/config/index.ts. Retrieval is what confers
    citability; a hash you have seen only inside a trellis_textedit
    frame is NOT citable. Call citable(hashes), read its `citable`
    field, and trust it.

R2  WHEN NOTHING IS CITABLE, WRITE NOTHING — THE STOP CONDITION. If
    you reach the completion protocol and no hash satisfies R1,
    revert every staged edit with trellis_textedit.revert, submit the
    <output_contract> report with cited_hashes empty and a reason,
    and end. Citing a related block from any other file is the exact
    failure this task guards against — it is forbidden, never a
    fallback.

R3  ONE RETRIEVAL CALL PER CELL. Give every get_ast_texts and every
    vector_search its OWN repl cell with nothing after it in that
    cell. A "Retrieval Discipline" refusal is a raised exception that
    kills the rest of its cell, so keep each retrieval behind its own
    cell boundary. When a refusal says a hash was already retrieved,
    reuse the variable you already hold and fetch nothing.

R4  EDIT ONLY THROUGH THE GUARDED FAMILY. Move bytes only with
    trellis_textedit.replace_lines / insert_lines / delete_lines.
    Success requires textedit_raw_splices == 0.
</governing_rules>

<state_protocol>
Keep a running upsum dict in the repl (the system prompt requires
it). Create it in your FIRST cell in exactly this shape, update it at
the END of every cell, and PRINT it before each decisive step:

  upsum = {
      "done": [{One_Line_Per_Completed_Step}],
      "pending": [{One_Line_Per_Step_Not_Yet_Done}],
      "blocked": [{One_Line_Per_Blocker_With_Its_Cause}],
      "decisive_facts": [{Citable_Hash_Ids}, {Anchor_Lines_Verified}],
  }

A step still in "pending" is work you have NOT done, however far back
the transcript claims otherwise — believe upsum over the scrollback.
</state_protocol>

<specification>
Part 1 - four new OPTIONAL environment keys in EnvSchema:
- TRELLIS_RLM_BACKEND: z.enum(['openai', 'vllm']).optional()
- TRELLIS_RLM_MODEL: z.string().min(1).max(256).optional()
- TRELLIS_RLM_BASE_URL: z.url().optional(), plus a refinement
  requiring the URL scheme to be http: or https:
- TRELLIS_RLM_API_KEY_ENV: z.string().min(1).max(128).optional()
Each key gets a comment block in the file's house style naming
MODEL_BACKEND_SEAM.md as the design record and stating that no
consumer reads these values yet (T2/T3 wire them).

Part 2 - imperative fail-fast checks after the schema parse (the
existing editRoot / mcpCredentialEnv precedent in the same file),
each throwing a plain Error whose message names every key involved:
1. If OPENAI_BASE_URL is present in process.env (any value,
   including empty), throw with EXACTLY this single-line message:
   Backend config: OPENAI_BASE_URL is not honored; set
   TRELLIS_RLM_BASE_URL (root agent) — worker transport is not yet
   configurable.
   (the dash between "(root agent)" and "worker" is an em dash,
   exactly as written above)
2. TRELLIS_RLM_BACKEND set to 'vllm' with TRELLIS_RLM_BASE_URL
   unset: refuse.
3. TRELLIS_RLM_API_KEY_ENV set with TRELLIS_RLM_BASE_URL unset:
   refuse.
4. TRELLIS_RLM_API_KEY_ENV set: the variable it names must be
   present and non-empty in process.env; otherwise refuse. Resolve
   the value once here into a local.
A base URL WITHOUT a backend is allowed - add no check for it.

Part 3 - a new export block on the config object:
  rlmBackend: { backend, model, baseUrl, apiKeyEnv, apiKeyValue }
where the first four are the validated values (each undefined when
its key is unset) and apiKeyValue is the fail-fast resolved value of
the named key variable (undefined when TRELLIS_RLM_API_KEY_ENV is
unset). With every key unset every field is undefined and every
existing config consumer reads exactly what it read before. The
comment on the block follows the config.mcp.credentialEnv precedent:
the resolved value never appears in logs or serializations. No other
code reads rlmBackend yet - change NO call site anywhere.
</specification>

<evidence_protocol goal="get one citable src/config/index.ts hash into your retrieval set, then confirm the task premise from its bytes">
E1 (one cell). Query the graph for the ACTION neighborhood of the
   entity 'trellis_retrieval_budget_per_run' (names are
   lowercase-normalized; provenance rides edges in either direction,
   so match undirected):
     MATCH (e:Entity)-[r:ACTION]-(o:Entity)
     WHERE e.name = '{The_Budget_Entity_Named_Above}'
     RETURN r.verb, o.name, r.sourceNodeIds,
            coalesce(r.contested, false) AS contested
   Keep only rows where contested is false. Your primary citation
   candidate is the sourceNodeIds hash on the uncontested edge with
   verb 'uses_config_key' toward entity 'config' — that hash's block
   belongs to src/config/index.ts. Collect the distinct hashes from
   all uncontested edges into a variable.

E2 (one cell — R3). Fetch every collected hash in ONE get_ast_texts
   call. Print the first line of each returned text.

E3 (one cell). Load src/config/index.ts, then classify:
   a. text = frame_text('src/config/index.ts')   # canonical join,
      "\r" terminators intact on this CRLF file.
   b. For each fetched hash: CITABLE when its full retrieved text is a
      verbatim substring of text; otherwise NOT-CITABLE (blocks from
      other files — e.g. src/workers/rlm_job.ts — inform you but stay
      uncitable, R1).
   c. Cross-check with citable(all_fetched_hashes) and PRINT the
      report. Keep a hash ONLY when your verbatim check AND the
      probe's `citable` field agree. Hold the survivors in a variable
      for the completion protocol.
   d. Confirm from the citable bytes that BOTH molds you mirror live
      in this file: the TRELLIS_RETRIEVAL_BUDGET_PER_RUN validation
      (the optional-env-twin your new keys follow) and the "Fail fast
      at startup" comment plus the
      resolveMcpCredentialEnv(mcpServers, process.env) call (the
      credential mold your key resolution follows).

E4 (fallback — ONLY if E3 left zero citable hashes). Make at most TWO
   vector_search calls, each in its own cell (R3), querying about the
   budget validation or the credential fail-fast resolution in
   src/config/index.ts; fetch nothing you already hold; re-run E3's
   classification. Still nothing citable ⇒ R2 (THE STOP CONDITION)
   governs.
</evidence_protocol>

<editing_protocol>
Author only genuinely NEW lines; move existing bytes by slicing them
in code — never retype an existing line as your own.

M1 (one cell). Load src/config/rlm_backend.test.ts and
   src/config/textedit_bounds.test.ts. Confirm the test stub is
   exactly a four-line header comment. Read the bounds test to learn
   the house per-topic config-test mold: a managed-keys env
   save/restore helper, vi.resetModules() + a dynamic
   import('./index') per load, an afterEach restore. You will write
   fresh code in these conventions.

M2. Apply exactly THREE guarded inserts to src/config/index.ts (R4).
   For EACH insert, in the same cell as the insert: read the
   neighborhood with trellis_textedit.lines(); build byte-exact
   anchors that INCLUDE the trailing "\r"; insert; then stop — line
   addresses shift after every staged insert, so re-locate before the
   next one and never reuse an address computed before an earlier
   insert. An AnchorMismatchError staged nothing → re-read and retry.
   Leave every existing line byte-unchanged.
   a. The four TRELLIS_RLM_* keys with their comments, INSIDE
      EnvSchema, immediately after the TRELLIS_RETRIEVAL_BUDGET_PER_RUN
      entry's own comment-and-line, so the schema entries stay
      grouped.
   b. The ambient guard + the three cross-field refusals + the
      resolved local, placed AFTER the closing line of the complete
      existing editRoot fail-fast block — so the editRoot comment
      stays attached to the editRoot code above it and your insert
      never splits an existing comment from its statement.
   c. The rlmBackend export block, INSIDE the config object literal,
      between two existing export blocks (e.g. immediately after the
      textedit block's closing line), with exactly one blank line on
      each side, matching the file's existing block spacing.

M3. Author the test body in src/config/rlm_backend.test.ts with
   guarded insert_lines anchored on the header's last (fourth) line,
   leaving all four header lines byte-intact. Manage these env keys
   in the save/restore helper: the four TRELLIS_RLM_* keys,
   OPENAI_BASE_URL, and one scratch key-env variable name of your
   choice. Write ONE describe block with these pins:
   (a) unset default: config.rlmBackend deep-equals the all-undefined
       five-field shape;
   (b) backend accepts 'openai' alone and 'vllm' with a base URL;
       refuses an unknown enum value;
   (c) model accepts an ordinary id; refuses '' and a 257-char
       string;
   (d) base URL accepts http://127.0.0.1:8000/v1 and an https URL
       with no backend set; refuses a non-URL and ftp://host/;
   (e) 'vllm' without base URL refuses and the message names both
       keys;
   (f) key-env without base URL refuses and the message names both
       keys;
   (g) key-env with base URL and the named variable set populates
       apiKeyEnv and apiKeyValue;
   (h) key-env naming an absent variable refuses; naming a present
       but empty variable refuses;
   (i) ambient OPENAI_BASE_URL set makes config load throw with the
       exact Part-2 guard message.

M4. Review each file with trellis_textedit.diff, then write_back each
   file.
</editing_protocol>

<verification_protocol>
V1 (its OWN iteration — never a write cell or the submit cell).
   Re-read the three edited regions of src/config/index.ts and the
   whole test file, PRINT each, and assert in code with each result
   printed. ASSERTION DISCIPLINE — compare STRUCTURE, never
   terminator-stripped text:
   - multi-line region: region_equal(relpath, start,
     [{Expected_Line_With_Trailing_CR}, ...]) OR
     region_lines(relpath, start, end) == your expected LIST.
   - whole-file substring: use frame_text(relpath) (terminators
     kept).
   A concatenation of lines() texts without terminators reads false
   even when the region is correct — never assert against one.
   Assert: (a) each of the four TRELLIS_RLM_* schema entries appears
   exactly once; (b) the ambient-guard message appears exactly once
   in index.ts; (c) the TRELLIS_RETRIEVAL_BUDGET_PER_RUN line is
   byte-unchanged and the editRoot fail-fast block's line list is
   byte-unchanged; (d) the rlmBackend block sits inside the config
   object literal with its neighboring blocks intact; (e) the four
   stub header lines compare equal AS A LIST to the four expected
   header lines, and the first non-header line of the test file is
   your own import line.

V2. When an assertion prints false but the PRINTED region shows the
   intended content, the assertion is the bug: fix the assertion and
   re-verify in a new iteration. A genuine content mismatch VISIBLE
   in the printed region itself is the ONE case that triggers R2
   (revert, no insight, report).
</verification_protocol>

<completion_protocol>
C1. In a LATER iteration, after every V1 assertion has printed true:
   re-read the rules with trellis_task.grep('R1|R2|R3|R4'), PRINT
   upsum, and call citable() on your held candidates once more. Keep
   only hashes whose `citable` field is True. If that leaves the list
   empty, R2 governs — take the empty-cited path in
   <output_contract>.

C2. Record EXACTLY ONE derived insight, citing only the survivors:
   trellis_neo4j.write_derived_insight(
       subject='config', verb='resolves_fail_fast',
       obj='mcpcredentialenv',
       sourceNodeIds=[{Citable_Index_Ts_Hash_Ids_From_E3}])

C3. Submit the report through trellis_answer.submit by REFERENCE
   (trellis_answer.submit("report")), instantiating the
   <output_contract> frame.
</completion_protocol>

<output_contract>
Build this dict and submit it by reference. Fill every field; leave
cited_hashes empty ONLY on the R2 path.

  report = {
      "graph_finding": "{What_The_Uncontested_ACTION_Edges_Named}",
      "bytes_confirmed": "{Which_Two_Molds_The_Citable_Block_Showed}",
      "edits_made": "{Each_index_ts_Insert_And_The_Test_Body_One_Line_Each}",
      "anchors_used": [{Byte_Exact_Anchor_Line_Per_Insert}],
      "cited_hashes": [{Hash_Ids_That_Passed_R1}],
      "why_citable": "{Retrieved_This_Run_AND_Verbatim_In_index_ts}",
  }
</output_contract>

<definition_of_done>
The run is correct when ALL hold: exactly src/config/index.ts and
src/config/rlm_backend.test.ts changed; textedit_raw_splices == 0;
every V1 assertion printed true; exactly one insight recorded, its
sourceNodeIds a subset of your R1-passing survivors; the report
submitted by reference. If any cannot be met, R2 governs: revert,
record no insight, submit the empty-cited report.
</definition_of_done>

Edit no other file. If the graph, the retrieved bytes, or the file
contents contradict this task (a mold is absent, the stub header is
absent, or nothing is citable), R2 governs.

*** THE TWO RULES THAT DECIDE THE RUN, ONCE MORE ***
- R1 + R2: cite only a hash RETRIEVED THIS RUN whose bytes are
  verbatim in src/config/index.ts, confirmed by citable(); if none
  qualifies, record NO insight at all.
- R3: exactly one retrieval call per repl cell.
```

**Scope of this pass, recorded honestly:** v3.2 is a STRUCTURAL
strengthening of v3.1 under the two skills — the specification, the
evidence chain, the criterion, and the invariant vocabulary are
byte-for-byte the same intent; nothing behavioral was added. T1 is
already LANDED on v3.1 (§5h.11) and is NOT re-run by this pass — v3.2
is recorded as the template the remaining T-series (T2 onward)
inherits and adapts. A live A/B of v3.1 vs v3.2 adherence would be
its own owner-approved paid proposal, not run here.

### 5i Increment T2 — the `buildAgentEnv` forward/strip increment (Session 52, staged July 14, 2026)

TTT-track increment T2 (roadmap §4 row 13, Phase 1 step 2; the
ratified queue's next step after T1 landed in Session 50). A
FEATURE-CLASS self-edit (§12.6) run through the stage-2 harness on
the Session 50 scaffolds: the task text is authored by the session
under the house `prompt-engineering` + `hypershot-protocol` skills
(both INVOKED before a byte of task text was written — Guardrail 15,
honored), presented with an estimate at session start, run ONLY on
the owner's yes, one diff human-reviewed, landing a human PR. The
spec is UNCHANGED and human-authored: `MODEL_BACKEND_SEAM.md` §3.3
(the credential three-part rule) + §4 layer 2 (the unconditional
`OPENAI_BASE_URL` delete) + the §8 T2 skeleton.

#### 5i.1 Scope, named files, and the wiring-deferral decision

Named files (exactly two — a diff touching any other file FAILS the
named-file/scope criterion):

- `src/workers/rlm_job.ts` — `AgentEnvConfig` gains the optional
  `rlmBackend` block (the `textedit`/`retrievalBudget` optional-block
  mold, `rlm_job.ts:132–155`); `buildAgentEnv` gains set-or-delete
  for each `TRELLIS_RLM_*` variable (the `TRELLIS_MCP_SERVERS` /
  `retrievalBudget` set-or-delete mold, `rlm_job.ts:179–209`); the
  unconditional `delete env.OPENAI_BASE_URL` joins the
  experiment-flag deletion block (`rlm_job.ts:216–232`, the
  `TRELLIS_EXP_*` mold); the named key variable's VALUE forwarded
  under its own name (the `mcpCredentialEnv` loop precedent,
  `rlm_job.ts:235–237`).
- `src/workers/rlm_job.test.ts` — new pins ADDED to the existing
  `buildAgentEnv` describe block WITHOUT modifying any existing test
  (the zero-existing-tests-changed criterion item covers it):
  set-forwards / unset-deletes per variable; `OPENAI_BASE_URL`
  stripped even when cfg sets a base URL (the child gets
  `TRELLIS_RLM_BASE_URL`, never the SDK variable); key value
  forwarded under its own name; absent-block byte-identity.

**The recorded open point, decided (§8 T2 note):** the one-line
`rlm_worker.ts` wiring that passes `config.rlmBackend` into
`buildAgentEnv`'s cfg (`rlm_worker.ts:291`, joining the
`retrievalBudget: config.retrieval.budgetPerRun` line) lands in **T3,
not T2**. T2 stays a pure-function increment with zero live consumers
(the T1 shape: the seam is built and pinned before anything feeds
it), and T3 — which rewires the agent side — wires the worker side in
the same increment. So `rlm_worker.ts` is NOT a named file for T2,
and the production path (`cfg.rlmBackend` absent) is the
absent-block-byte-identity path the pins cover.

#### 5i.2 No stub needed; the geometry difference from T1

Unlike T1 (§5h.2), NEITHER named file needs a pre-staged stub: both
`src/workers/rlm_job.ts` and `src/workers/rlm_job.test.ts` exist and
`rlm_job.test.ts` already carries a `buildAgentEnv` describe block, so
there is no editing-toolkit-cannot-create-files ceremony and no
vitest-red window. T2's test edit ADDS `it(...)` pins inside the
existing describe block; the existing tests stay byte-intact.

**One real geometry difference from T1, recorded honestly.** T1's
cited block (the index.ts budget/credential validation block) sat at
a location T1's inserts did NOT touch, so it stayed verbatim-
contiguous on disk and the completion-time re-check could re-scan
disk. T2's guarded inserts land INSIDE the cited `buildAgentEnv`
function-body block (the four `TRELLIS_RLM_*` set-or-delete section,
the `OPENAI_BASE_URL` delete, the key-value forward all sit inside
that block's span), so the block's original 3,202-char text is NOT a
verbatim-contiguous substring of the file after the edits. The
adaptation vs v3.2, spelled out in the task text: the disk-verbatim
citability check runs ONCE at the evidence phase (E3, before any
edit, block verbatim on disk + `citable()` agrees), the surviving
hash is HELD, and the completion-time re-check (C1) uses `citable()`
ONLY — which reads the substrate (retrieval-set membership + the
`gatherHashEvidence` current-version join), NOT the working frame, so
the guarded inserts interleaving the block on disk correctly do NOT
revoke citability. `stage2:check`'s evidence layer is DB-membership
based (`checkEvidence` → the current-version bridge) and is likewise
unaffected by the on-disk interleave. The Session 31 write gate
checks retrieval membership, satisfied identically. This keeps the
insight at completion time (post-verification — preserving the R2
revert-before-write integrity) while handling the geometry honestly.

#### 5i.3 Live evidence verification (the §5g.2/§5h.3 mold; probes read-only, July 14, 2026)

The substrate is FRESH for the target file: `repo:trellis:src/workers/rlm_job.ts`
is at version 2 (root `a0d3b0d2…3516`), the Session 50 policy-1
refresh (`trellis#12`, extraction ran July 13) that ingested
`rlm_job.ts` v2 WITH Session 50's `TRELLIS_TASK_NAMED_FILES` delete.
All premises verified read-only, ALL HELD:

- **The graph chain.** The entity `buildagentenv` has 17 ACTION
  edges, ALL uncontested (0 contested), and ALL cite the single
  sourceNodeIds hash `c3883a2ef98e7e2c5de039707cf4d8ed8b4fd10ec7035ef851539266c0b6d0b4`
  — the `buildAgentEnv` function-body block. Sample edges:
  `buildagentenv -deletes-> trellis_exp_omit_retrieval` (the
  experiment-flag deletion-block mold T2 extends with
  `OPENAI_BASE_URL`), `buildagentenv -sets-> trellis_mcp_servers`
  (the set-or-delete discipline T2 mirrors for the four
  `TRELLIS_RLM_*` variables). The primary citation candidate is that
  hash.
- **The block bytes.** Block `c3883a2e…d0b6d0b4` (3,202 chars /
  3,207 bytes, CRLF) is a VERBATIM SUBSTRING of the on-disk
  `src/workers/rlm_job.ts` (the file is uniform CRLF: 259 CRLF lines,
  0 lone LF). It carries BOTH molds T2 mirrors: the unconditional
  experiment-flag deletion block (`delete env.TRELLIS_EXP_OMIT_CMT`
  … `delete env.TRELLIS_TASK_NAMED_FILES;`) AND the credential
  forwarding loop (`for (const [name, value] of
  Object.entries(cfg.mcpCredentialEnv ?? {})) { env[name] = value; }`).
  It is a live member of the current-version root (a re-ingest during
  the run is impossible — the run edits the worktree, never
  re-ingests — so the block stays live at write time).
- **`--pre` gate.** `stage2:check --pre --entity buildagentenv
  --named-file src/workers/rlm_job.ts --named-file
  src/workers/rlm_job.test.ts` → `PASS: zero findings` (the entity
  found + uncontested + zero contested attached edges; both named-file
  substrate documents present, each at version 2).
- **Harness.** `test:selfedit-harness` → ALL CHECKS PASSED (the
  citable-vs-`gatherHashEvidence` mirror pins included).
- **Drift.** The split-scope policy-1 `--dry-run` echo read 3 to
  ingest / 300 unchanged / 0 tombstones; the 3 drifting files are
  Session 51's changed `scripts/*.py` (test_modules / test_scaffold_unit
  / test_rlm_sandbox), OUTSIDE T2's evidence chain and named files —
  the §5h.11 drift-reasoning precedent defers them to the post-landing
  refresh. `rlm_job.ts` is among the 300 unchanged; no pre-run refresh
  owed. (Session 51's src/rlm prompt-byte edits owe a policy-2
  `src/rlm` leg that rides the next src/rlm-touching PR; T2 touches
  only `src/workers`, so its post-landing refresh is a policy-1 leg
  and does not clear that carry-forward.)

**Pre-stated evidence edge (the criterion item-2 insight):**
`buildagentenv` `-forwards_by_name->` `mcpcredentialenv`, citing
exactly `[c3883a2e…d0b6d0b4]` — TRUE and grounded verbatim in the
cited block's credential-forwarding loop, and it is precisely the
§3.3 mold T2 extends (forward the named key variable's value under
its own name). The object `mcpcredentialenv` is created fresh by the
write (it has no ACTION edges in `rlm_job.ts`'s graph today — so it
is NOT passed to `--pre`, which would flag a missing entity; a fresh
entity is uncontested by construction). **Churn note:** a landed T2
re-chunks `rlm_job.ts`, and the next split-scope refresh kills
`c3883a2e…` and CONTESTS this fresh edge — ordinary lazy recovery,
never a criterion item and never "cleaned up" (exactly the T1
pattern, §5h.11).

**Named failure modes and their catching layers (the §5e mold):**

| Failure class | Caught by |
|---|---|
| Diff touches a file other than the two named | `stage2:check` scope layer (`checkEditScope`) + human review |
| Insight cites a hash not retrieved / not bridging to a named file | the task's R1/R2 (evidence-phase verbatim + `citable()`); `stage2:check` evidence layer (`checkEvidence` current-version bridge); the Session 31 write gate |
| A raw `splice` (address-drift / neighbor-retype risk) | the guarded-only criterion (`textedit_raw_splices == 0`), telemetry-pinned |
| A named file left unparseable | `stage2:check` parse gate (`named_file_unparseable`, `.ts` single-file parse) |
| An existing test modified / deleted | the zero-existing-tests-changed criterion (human `npm test` + diff review) |
| `buildAgentEnv` absent-block output drifts from today | the absent-block-byte-identity pin (clean base env → today's exact object) |

#### 5i.4 Task text (authored under `prompt-engineering` + `hypershot-protocol`; Guardrail 15 honored)

Authored on the §5h.12 v3.2 template — the skills-strengthened
T-series template — with T2's spec spliced and the geometry
adaptation (§5i.2) woven into R1/E3/C1. Both skills were INVOKED via
the Skill tool BEFORE any task-text byte was written (unlike
Session 50's v3.1 amendment; Guardrail 15). Skill principles applied:
the `<mission>` names the ONE failure the task prevents
(decoherence-prevention, `prompt-engineering` BP3); the four
governing rules carry stable `R1|R2|R3|R4` trigger tokens in
attention zones at head AND tail (toolkit E), positive-led
(`prompt-engineering` BP4); `upsum` and the final report are
instantiable hypershot FRAMES with instruction-bearing variables
(`hypershot-protocol` Rules B/C), while the invariant vocabulary —
tool names, the entity `buildagentenv`, the two mold strings, the
spec bounds — stays CONCRETE (the §6 invariance test); the cited hash
stays a hypershot variable `{Citable_Rlm_Job_Hash_From_E3}` because
the model must RETRIEVE it, never receive it in the prompt.

```
Stage-2 self-edit task (feature-class increment T2: the buildAgentEnv
backend forward/strip surface).

<mission>
Extend buildAgentEnv in src/workers/rlm_job.ts, and add its unit pins
to src/workers/rlm_job.test.ts, exactly per <specification>. This task
text is the entire spec channel — the design record it quotes
(MODEL_BACKEND_SEAM.md §3.3 and §4 layer 2) lives outside your reach,
so follow the bytes here literally.
ONE failure has killed a prior increment in this series: recording a
derived insight that cites a hash the run never retrieved from the
target file. <governing_rules> exists to make that failure
impossible. Read it first and obey it over every other instinct.
</mission>

<governing_rules>
*** CRITICAL — these four rules govern the whole run. Re-read them BY
CODE with trellis_task.grep('R1|R2|R3|R4') before each decisive step
(the first write_back, the insight write, the submit). If any
instruction below ever seems to conflict with a rule here, THE RULE
HERE WINS. ***

R1  CITE ONLY WHAT YOU RETRIEVED FROM THE TARGET, CONFIRMED BEFORE
    YOU EDIT. A hash is citable only when BOTH held at evidence step
    E3, BEFORE any edit: you fetched it THIS RUN via
    trellis_postgres.get_ast_texts or trellis_postgres.vector_search,
    AND its retrieved text appeared verbatim inside
    src/workers/rlm_job.ts. Retrieval plus that one pre-edit verbatim
    confirmation confer citability; HOLD the surviving hash in a
    variable. Your guarded inserts land INSIDE that block and will
    interleave its bytes on disk afterward — this is EXPECTED and does
    NOT revoke citability. Confirm with citable(hashes) — which reads
    the substrate, not your working frame — and trust its `citable`
    field. A hash you have seen only inside a trellis_textedit frame
    is NOT citable.

R2  WHEN NOTHING IS CITABLE, WRITE NOTHING — THE STOP CONDITION. If
    E3 leaves no hash satisfying R1, revert every staged edit with
    trellis_textedit.revert, submit the <output_contract> report with
    cited_hashes empty and a reason, and end. Citing a related block
    from any other file (for example src/config/index.ts) is the exact
    failure this task guards against — it is forbidden, never a
    fallback.

R3  ONE RETRIEVAL CALL PER CELL. Give every get_ast_texts and every
    vector_search its OWN repl cell with nothing after it in that
    cell. A "Retrieval Discipline" refusal is a raised exception that
    kills the rest of its cell, so keep each retrieval behind its own
    cell boundary. When a refusal says a hash was already retrieved,
    reuse the variable you already hold and fetch nothing.

R4  EDIT ONLY THROUGH THE GUARDED FAMILY. Move bytes only with
    trellis_textedit.replace_lines / insert_lines / delete_lines.
    Success requires textedit_raw_splices == 0.
</governing_rules>

<state_protocol>
Keep a running upsum dict in the repl (the system prompt requires
it). Create it in your FIRST cell in exactly this shape, update it at
the END of every cell, and PRINT it before each decisive step:

  upsum = {
      "done": [{One_Line_Per_Completed_Step}],
      "pending": [{One_Line_Per_Step_Not_Yet_Done}],
      "blocked": [{One_Line_Per_Blocker_With_Its_Cause}],
      "decisive_facts": [{Citable_Hash_Ids}, {Anchor_Lines_Verified}],
  }

A step still in "pending" is work you have NOT done, however far back
the transcript claims otherwise — believe upsum over the scrollback.
Keep len(str(upsum)) at or under UPSUM_BUDGET by REWRITING each list
in place, never appending endlessly.
</state_protocol>

<specification>
All edits are in src/workers/rlm_job.ts and src/workers/rlm_job.test.ts.
buildAgentEnv is a PURE function; when cfg.rlmBackend is undefined its
output must be byte-identical to today for a clean base env (this is
the T1 shape: the surface is built and pinned before any caller feeds
it — you change NO call site, and rlm_worker.ts is NOT yours to edit).

Part 1 — AgentEnvConfig gains ONE new OPTIONAL field, mirroring the
existing optional-block molds (textedit, retrievalBudget) already in
the interface:
  rlmBackend?: {
    backend?: string;
    model?: string;
    baseUrl?: string;
    apiKeyEnv?: string;
    apiKeyValue?: string;
  };
Add a doc comment in the file's house style naming
MODEL_BACKEND_SEAM.md §3.3/§4 as the design record: the block is
present ONLY when the operator configured backend keys; the first
four fields are config.rlmBackend's validated values (each undefined
when its key is unset) and apiKeyValue is the fail-fast resolved value
of the named key variable (the config.mcp.credentialEnv precedent —
never logged); when the whole block is omitted, every TRELLIS_RLM_*
variable is stripped so the child only ever sees validated backend
config (the TRELLIS_MCP_SERVERS discipline).

Part 2 — buildAgentEnv gains a set-or-delete section for the four
TRELLIS_RLM_* variables, one variable per if/else, in the exact shape
of the existing retrievalBudget block (if the field is defined set the
env var to it, else delete the env var):
  TRELLIS_RLM_BACKEND   <- cfg.rlmBackend?.backend
  TRELLIS_RLM_MODEL     <- cfg.rlmBackend?.model
  TRELLIS_RLM_BASE_URL  <- cfg.rlmBackend?.baseUrl
  TRELLIS_RLM_API_KEY_ENV <- cfg.rlmBackend?.apiKeyEnv
These values are already strings — no String() wrapping. Place this
section among the other set-or-delete blocks (immediately after the
retrievalBudget block's closing brace is natural), so an unset field —
or an entirely absent rlmBackend block — strips any raw inherited
value of that variable.

Part 3 — the unconditional ambient-transport strip. Add exactly one
line, delete env.OPENAI_BASE_URL;, to the experiment-flag deletion
block (immediately after delete env.TRELLIS_TASK_NAMED_FILES;), with a
comment naming MODEL_BACKEND_SEAM.md §4 layer 2: the worker never
forwards the ambient SDK transport variable, so an inherited value can
never redirect a spawned agent — the strip holds unconditionally, even
when cfg sets a base URL (the child gets TRELLIS_RLM_BASE_URL, never
OPENAI_BASE_URL) and even for callers that bypassed config validation.

Part 4 — forward the named key variable's VALUE under its own name
(the mcpCredentialEnv loop precedent, §3.3). After the existing
mcpCredentialEnv forwarding loop and before return env, add: when BOTH
cfg.rlmBackend?.apiKeyEnv and cfg.rlmBackend?.apiKeyValue are defined,
set env[cfg.rlmBackend.apiKeyEnv] = cfg.rlmBackend.apiKeyValue (the
child resolves the named variable to the fail-fast value; never
logged). The NAME itself is already forwarded by Part 2's
TRELLIS_RLM_API_KEY_ENV set — this Part forwards the VALUE under that
name.

No other behavior changes. No call site changes anywhere. rlm_worker.ts
is out of scope (its one-line wiring is T3's).
</specification>

<evidence_protocol goal="get one citable src/workers/rlm_job.ts hash into your retrieval set, confirm the task premise from its bytes, and HOLD it before any edit">
E1 (one cell). Query the graph for the ACTION neighborhood of the
   entity 'buildagentenv' (names are lowercase-normalized; provenance
   rides edges in either direction, so match undirected):
     MATCH (e:Entity)-[r:ACTION]-(o:Entity)
     WHERE e.name = '{The_Buildagentenv_Entity}'
     RETURN r.verb, o.name, r.sourceNodeIds,
            coalesce(r.contested, false) AS contested
   Keep only rows where contested is false. Every uncontested edge
   here carries the SAME sourceNodeIds hash — the buildAgentEnv
   function-body block, part of src/workers/rlm_job.ts. Collect the
   distinct hashes from all uncontested edges into a variable (there
   is one).

E2 (one cell — R3). Fetch every collected hash in ONE get_ast_texts
   call. Print the first line of each returned text.

E3 (one cell). Load src/workers/rlm_job.ts, then classify — THIS is
   the one-and-only pre-edit verbatim gate (R1):
   a. text = frame_text('src/workers/rlm_job.ts')   # canonical join,
      "\r" terminators intact on this CRLF file.
   b. For each fetched hash: CITABLE when its full retrieved text is a
      verbatim substring of text; otherwise NOT-CITABLE.
   c. Cross-check with citable(all_fetched_hashes) and PRINT the
      report. Keep a hash ONLY when your verbatim check AND the
      probe's `citable` field agree. HOLD the survivors in a variable
      for the completion protocol — you will NOT re-scan disk for
      verbatim later, because your edits interleave this block.
   d. Confirm from the citable bytes that BOTH molds you mirror live
      in this block: the unconditional experiment-flag deletion block
      (delete env.TRELLIS_EXP_OMIT_CMT … delete
      env.TRELLIS_TASK_NAMED_FILES;) that Part 3 extends, and the
      mcpCredentialEnv forwarding loop
      (for (const [name, value] of Object.entries(cfg.mcpCredentialEnv
      ?? {})) { env[name] = value; }) that Part 4 mirrors.

E4 (fallback — ONLY if E3 left zero citable hashes). Make at most TWO
   vector_search calls, each in its own cell (R3), querying about the
   buildAgentEnv forward/strip discipline or the mcpCredentialEnv
   forwarding loop in src/workers/rlm_job.ts; fetch nothing you
   already hold; re-run E3's classification. Still nothing citable =>
   R2 (THE STOP CONDITION) governs.
</evidence_protocol>

<editing_protocol>
Author only genuinely NEW lines; move existing bytes by slicing them
in code — never retype an existing line as your own. Line addresses
shift after every staged insert, so for EACH insert re-read its
neighborhood with trellis_textedit.lines() in the SAME cell, build
byte-exact anchors that INCLUDE the trailing "\r", insert, then stop
and re-locate before the next one. An AnchorMismatchError staged
nothing — re-read and retry. Leave every existing line byte-unchanged.

M1 (one cell). Read the current buildAgentEnv describe block in
   src/workers/rlm_job.test.ts and one neighboring buildAgentEnv it()
   (e.g. the retrieval-budget strip test) to learn the house test
   mold: buildAgentEnv(base, {...CFG, ...}) with a hand-built base env
   and a toEqual / `in` assertion. You will write fresh it() blocks in
   these conventions and modify NO existing test.

M2. Apply guarded inserts to src/workers/rlm_job.ts (R4), one insert
   per labeled item, each re-located in its own cell:
   a. The rlmBackend?: {...} optional field, INSIDE AgentEnvConfig,
      immediately after the retrievalBudget?: number; field's own
      comment-and-line, so the optional blocks stay grouped and the
      closing brace of the interface is untouched.
   b. The four TRELLIS_RLM_* set-or-delete if/else blocks in
      buildAgentEnv, placed immediately after the retrievalBudget
      set-or-delete block's closing line and before the
      experiment-flag deletion comments.
   c. The single delete env.OPENAI_BASE_URL; line plus its
      §4-layer-2 comment, placed immediately after
      delete env.TRELLIS_TASK_NAMED_FILES; and before the
      mcpCredentialEnv forwarding comment.
   d. The Part-4 key-value forward, placed immediately after the
      mcpCredentialEnv forwarding loop's closing brace and before
      return env;.

M3. Author the new pins in src/workers/rlm_job.test.ts with guarded
   insert_lines anchored on an existing line inside the buildAgentEnv
   describe block (for example the block's final closing "});"), so
   every existing test stays byte-intact. Add it() blocks pinning:
   (a) forwards each of the four TRELLIS_RLM_* variables when
       cfg.rlmBackend sets that field;
   (b) strips each TRELLIS_RLM_* variable when the field is unset
       (a raw inherited value is removed) and when the whole
       rlmBackend block is absent;
   (c) OPENAI_BASE_URL is stripped unconditionally — both when
       cfg.rlmBackend is absent AND when cfg.rlmBackend.baseUrl is
       set (assert the child env has TRELLIS_RLM_BASE_URL set and no
       OPENAI_BASE_URL key);
   (d) the named key variable's value is forwarded under its own name
       (cfg.rlmBackend = { apiKeyEnv: 'SOME_NAME', apiKeyValue: 'v', …}
       => env.SOME_NAME === 'v');
   (e) absent-block byte-identity: buildAgentEnv(cleanBase, CFG) with
       cfg.rlmBackend absent deep-equals the exact object today's
       buildAgentEnv returns for that clean base (no TRELLIS_RLM_*
       keys, no OPENAI_BASE_URL key added).

M4. Review each file with trellis_textedit.diff, then write_back each
   file.
</editing_protocol>

<verification_protocol>
V1 (its OWN iteration — never a write cell or the submit cell).
   Re-read the edited regions of src/workers/rlm_job.ts and the new
   test it() blocks, PRINT each, and assert in code with each result
   printed. ASSERTION DISCIPLINE — compare STRUCTURE, never
   terminator-stripped text:
   - multi-line region: region_equal(relpath, start,
     [{Expected_Line_With_Trailing_CR}, ...]) OR
     region_lines(relpath, start, end) == your expected LIST.
   - whole-file substring: use frame_text(relpath) (terminators kept).
   A concatenation of lines() texts without terminators reads false
   even when the region is correct — never assert against one.
   Assert: (a) the rlmBackend?: field appears exactly once inside
   AgentEnvConfig; (b) each of the four TRELLIS_RLM_* set-or-delete
   blocks appears exactly once in buildAgentEnv; (c) the line
   delete env.OPENAI_BASE_URL; appears exactly once; (d) the four
   existing experiment-flag deletes and the mcpCredentialEnv loop are
   byte-unchanged; (e) every existing it() in the test file is
   byte-unchanged and your new it() blocks are present.

V2. When an assertion prints false but the PRINTED region shows the
   intended content, the assertion is the bug: fix the assertion and
   re-verify in a new iteration. A genuine content mismatch VISIBLE
   in the printed region itself is the ONE case that triggers R2
   (revert, no insight, report).
</verification_protocol>

<completion_protocol>
C1. In a LATER iteration, after every V1 assertion has printed true:
   re-read the rules with trellis_task.grep('R1|R2|R3|R4'), PRINT
   upsum, and call citable() on your HELD survivors once more. This
   re-check reads the substrate (retrieval + current-version bridge),
   NOT the working frame — do NOT re-scan the file for verbatim, your
   edits interleaved the block on purpose. Keep only hashes whose
   `citable` field is True. If that leaves the list empty, R2 governs.

C2. Record EXACTLY ONE derived insight, citing only the survivors:
   trellis_neo4j.write_derived_insight(
       subject='buildagentenv', verb='forwards_by_name',
       obj='mcpcredentialenv',
       sourceNodeIds=[{Citable_Rlm_Job_Hash_From_E3}])

C3. Submit the report through trellis_answer.submit by REFERENCE
   (trellis_answer.submit("report")), instantiating the
   <output_contract> frame.
</completion_protocol>

<output_contract>
Build this dict and submit it by reference. Fill every field; leave
cited_hashes empty ONLY on the R2 path.

  report = {
      "graph_finding": "{What_The_Uncontested_buildagentenv_Edges_Named}",
      "bytes_confirmed": "{The_Deletion_Block_And_The_mcpCredentialEnv_Loop}",
      "edits_made": "{Each_rlm_job_ts_Insert_And_The_Test_Pins_One_Line_Each}",
      "anchors_used": [{Byte_Exact_Anchor_Line_Per_Insert}],
      "cited_hashes": [{Hash_Ids_That_Passed_R1}],
      "why_citable": "{Retrieved_This_Run_AND_Verbatim_In_rlm_job_ts_At_E3}",
  }
</output_contract>

<definition_of_done>
The run is correct when ALL hold: exactly src/workers/rlm_job.ts and
src/workers/rlm_job.test.ts changed; textedit_raw_splices == 0; every
V1 assertion printed true; every existing test byte-unchanged; exactly
one insight recorded, its sourceNodeIds a subset of your R1-passing
survivors; the report submitted by reference. If any cannot be met,
R2 governs: revert, record no insight, submit the empty-cited report.
</definition_of_done>

Edit no other file. If the graph, the retrieved bytes, or the file
contents contradict this task (a mold is absent, or nothing is
citable), R2 governs.

*** THE TWO RULES THAT DECIDE THE RUN, ONCE MORE ***
- R1 + R2: cite only a hash RETRIEVED THIS RUN whose bytes were
  verbatim in src/workers/rlm_job.ts at evidence step E3 (before your
  edits), confirmed by citable(); if none qualifies, record NO
  insight at all.
- R3: exactly one retrieval call per repl cell.
```

#### 5i.5 Run proposal and estimate

- **Gate:** owner-approved per run. The proposal is presented at
  session start; the run happens only on the owner's yes. Unapproved
  = zero-paid session: this §5i record + the verified chain + the
  handoff (the Session 42/49 mold).
- **Quota probe FIRST (the §5h.10 protocol):** one minimal completion
  before the spawn — `models.list` proves the key authenticates, NOT
  that the account has completion quota. A `429 insufficient_quota`
  ⇒ record ENVIRONMENTALLY BLOCKED, skip the spawn, hand off
  zero-paid.
- **Driver (the §5h.11 mold, verbatim):** porcelain clean at spawn;
  `trellis_agent.py` spawned directly, research mode,
  `--max-iterations 16`, `TRELLIS_EDIT_ROOT` at the worktree,
  `TRELLIS_CITATION_AUDIT=1`, `PYTHONUTF8=1`,
  `TRELLIS_TASK_NAMED_FILES=["src/workers/rlm_job.ts","src/workers/rlm_job.test.ts"]`,
  full stdout to ONE log file (never `tee | head`).
- **Estimate: $0.5–$1.0 for ONE run, no pre-bundled contingency**
  (T1's actual was $0.5781 for a two-file 173-insertion authoring
  run on the same scaffolds; T2 is a comparable two-file shape with a
  smaller spec). Under the ≤$5/run cap. The post-landing split-scope
  policy-1 refresh for the changed `src/workers` files adds roughly
  $0.10–$0.30 (Session 50's refresh actual was $0.2701 for 33 blocks
  across both legs; T2 changes two `src/workers` files — policy-1 leg
  only).
- **Criterion (the standing feature-class mold, judged item by
  item):** (1) named-file-only diff (exactly the two files);
  (2) exactly one recorded insight through the Session 31 gate citing
  the held live `rlm_job.ts` block — `buildagentenv`
  `forwards_by_name` `mcpcredentialenv`; (3) `stage2:check` zero
  findings (scope + evidence + parse; comment-class not declared);
  (4) guarded-only (`textedit_raw_splices == 0`); (5) the increment's
  own pins green — `npm test` grows from 876/87, zero existing tests
  changed; (6) human `git diff` review against the spec (the
  set-or-delete per variable, the unconditional strip's position in
  the deletion block, the credential-loop key-value forward,
  absent-block byte-identity); (7) spend within estimate. A harness
  flag or a failing pin FAILS the increment — record, stop, diagnose;
  a retry is its own proposal (the increments-1/2 treatment).


## 6. Verification summary

- `npm test`: 345 passing across 44 files (baseline 294/40).
- `npm run build`, `npm run python:check`,
  `docker compose --profile test config --quiet`: pass.
- Isolated Compose integration (`trellis-s8-integration`): 9/9
  assertions, then removed only its own containers and volumes.
- `npm run drill:scale`: gate closed, zero seeded residue (numbers above).
- Live zero-LLM suites: `test:repo-ingest` (45), `test:benchmark-hardening`
  (24), `test:entity-resolution` (33), `test:api-hardening` (18),
  `test:rlm-sandbox` (4), `test:belief-recovery` (30),
  `test:invalidation-sweep` (17).
- `git diff --check`: clean.
