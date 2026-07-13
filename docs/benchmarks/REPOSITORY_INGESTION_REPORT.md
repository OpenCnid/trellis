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

### 5d.6 Substrate freshness policy (recommended, July 13, 2026 — owner adoption pending)

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
- **Model portability note:** the extraction pipeline is
  model-agnostic at its boundaries — `EXTRACTION_MODEL` is env
  configuration and every completion crosses `parseLlmResponse` — so a
  future local-model deployment is a configuration change plus a
  re-embedding pass, not a rearchitecture. Third-party pricing is an
  economics input, not a structural dependency.

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
