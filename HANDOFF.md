You are a principal systems engineer continuing development on Trellis Engine,
a provenance-preserving GraphRAG system (repository:
https://github.com/OpenCnid/trellis, local path `D:\trellis-engine` or the
current working directory). Trellis is an original OpenCnid project, not a
fork, and is unrelated to other projects named Trellis. The repository and its
documentation are the only sources of truth.

Sessions 1–7 are complete and merged:

- PR #21 — async reliability and batch ingestion.
- PR #22 — provenance liveness closure and verified production ingestion.
- PR #23 — deployment and CI readiness.
- PR #25 — structured logging and Prometheus metrics (T16).
- PR #27 — entity resolution beyond exact-name identity (`SAME_AS` overlay
  beliefs, Session 5).
- PR #28 — benchmark maturity (anti-shortcut dataset v2 + first-class
  cache-audit metric, Session 6).
- Session 7 — semantic-provenance scale evidence: a deterministic
  300-document zero-LLM drill measured arrays/sweeps/merge/retrieval/context,
  verified quarantine at scale, and closed the migration gate at 286 maximum
  sources. No `ASTRef` migration shipped because the evidence did not justify
  it.

OpenCnid selected the MIT License on July 6, 2026.

Your objective is to study the current code and `TRELLIS_ROADMAP.md`, present a
concrete design, and then implement **Session 8: whole-codebase ingestion
(roadmap item 3.3 #6)**. Do not re-plan or re-implement completed work.

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

A session that completes its objective but does not regenerate this file has
not finished.

---

## 1. Architectural mental model

Trellis's core invariant is that every semantic fact remains traceable to an
immutable, content-addressed physical location in source material.

1. **PostgreSQL + pgvector — physical layer**
   - `ast_nodes` stores immutable Merkle AST nodes and optional embeddings.
   - `documents` stores stable document keys and version history.
   - `document_nodes` stores per-root membership and supports global source
     liveness checks.
   - `POST /ingest` currently owns parsing, verified persistence, registration,
     diffing, and queue planning directly in `src/api/server.ts`.
   - Schema bootstrap is serialized by `pg_advisory_xact_lock`; Neo4j
     bootstrap uses `executeWrite` so concurrent fresh-graph starts retry
     transient label-lock deadlocks.
2. **Neo4j — semantic and belief layer**
   - `Entity` and `Conflict` nodes plus `ACTION`, `CONTRADICTS`,
     `DERIVED_INSIGHT`, `SAME_AS`/`DISTINCT_FROM`, and conflict-link edges.
   - Semantic nodes and edges carry `sourceNodeIds`.
   - `contested`, `contestedAt`, `contestedReason`, `orphanedSourceIds`, and
     `rederivedAt` form the audit-preserving quarantine/recovery state machine
     specified in `src/core/graph/provenance.ts`.
   - Entity identity is immutable; equivalence is an overlay belief. Retrieval
     expands one trusted `SAME_AS` hop with per-fact `viaAlias` attribution.
3. **Redis + BullMQ — asynchronous layer**
   - `extraction_queue`, `rlm_queue`, `supervisor_queue`,
     `invalidation_queue`, `verification_queue`, and `resolution_queue`.
   - Extraction is one paid chat completion plus one paid embedding call per
     new block. Repository ingestion must therefore expose a physical-only
     mode and an explicit bounded opt-in before it can enqueue at repo scale.
4. **Benchmark and scale evidence**
   - OOLONG v1 is the saturated committed baseline; anti-shortcut v2 adds
     paraphrases, near misses, and unpairable prose passages. Cache-audit
     accuracy is first-class and shared across the runner and poison drill.
   - Session 7 added `src/benchmarks/scale/`, `npm run drill:scale`,
     `scale_drill_results.json`, and
     `docs/benchmarks/SCALE_PROVENANCE_REPORT.md`. The drill uses real AST
     persistence, registry, graph merge, sweep, retrieval, and alias-context
     paths with deterministic pseudo-extraction and zero LLM calls.
   - At 300 documents × 20 blocks, the graph held 6,096 nodes and 6,000
     relationships; max node provenance was 286 and every relationship stayed
     at 1. Fixed-50-hash median sweep latency grew 1.42x while facts grew
     5.77x. `ASTRef` migration remains conditional on an observed 1,000-source
     fact or materially superlinear sweep growth.
   - Whole-document merge p50 grew from 40.18 ms at 50 documents to 204.77 ms
     at 300, while same-graph no-op probes for a 286-source hub and a
     one-source detail were both ~7.7 ms. The report records `Entity.name`
     lookup/index profiling as the likely prerequisite before blaming arrays
     or attempting repository scale.
5. **Observability and process boundaries**
   - `src/core/observability/` defines pino JSON logging and per-process
     Prometheus registries. Operational additions use stable dot-namespaced
     events and bounded labels.
   - API and workers run as separate Node processes/containers. Maintenance
     and benchmark CLIs may keep human-formatted console output.

The current Markdown/PDF ingest flow parses one request to a Merkle AST,
bulk-persists and re-hashes it inside the transaction, registers document
membership/version state, computes a Merkle diff, queues extraction only for
new block hashes, and queues invalidation for removed hashes. The invalidation
worker reduces candidates against every document's latest version before
quarantining graph facts. Extraction has early liveness, pre/post-merge
fencing, and compensating quarantine.

The RLM sandbox uses server-enforced read-only sessions for arbitrary Cypher
and one provenance-required write path. Verification and resolution workers
use Zod-validated structured outputs; zero-cost drills replace the sub-LLM
with deterministic oracles.

## 2. Current baseline

Repository state at handoff creation:

- `master`: `2f705e9` (PR #28) plus the Session 7 scale-evidence PR that ships
  this file; use `git log -- HANDOFF.md` to identify the merged Session 7
  commit.
- Offline baseline: `npm test` = **294 passing across 40 files**.
- `npm run build` and `npm run python:check` pass.
- `npm run drill:scale`: **300 documents, 6,000 blocks/citations, 12,096
  semantic facts, max provenance 286, 48/48 correctness checks, zero seeded
  residue, zero LLM calls**.
- Live zero-LLM checks: `test:benchmark-hardening` (24),
  `test:entity-resolution` (33), `test:api-hardening` (18),
  `test:rlm-sandbox` (4), `test:belief-recovery` (30), and
  `test:invalidation-sweep` (17).
- Isolated Compose integration: **9 assertions**, including authenticated
  metrics, all six queue gauges, and the `/healthz` contract.
- CI target remains Node 22. Session 7's recorded local measurement
  environment was Node 20.19.2, PostgreSQL 16.14, Neo4j 5.11.0.

Fresh worktrees do not contain `node_modules`. Start with:

```bash
git status --short --branch
git branch --show-current
npm ci
npm test
npm run build
docker compose config --quiet
```

Work on a feature branch and target `master`.

## 3. Session 8 problem statement

The update engine already has the right per-file identity model, but no
repository ingestion surface and no code-aware physical representation.

- **Raw source is parsed as Markdown.** `POST /ingest` sends every non-PDF body
  to `parseMarkdownToAST` (`src/api/server.ts`). Braces, decorators, comments,
  imports, functions, and classes therefore become Markdown paragraphs or
  incidental fenced-code nodes. `collectExtractionBlocks`
  (`src/core/ast/traverse.ts`) cannot produce function/class extraction units
  from an ordinary source file.
- **The ingest transaction is trapped in the HTTP handler.** Verified AST
  persistence, document registration, Merkle diffing, extraction-block
  planning, invalidation enqueue, and extraction `addBulk` all live in one
  route. A repository CLI would either duplicate correctness-critical logic or
  send one HTTP request per file without a reusable/testable plan.
- **There is no repository manifest or deletion protocol.** `doc_key` ties
  versions of one known document together, but nothing records which paths
  belonged to a repository snapshot. A removed file is never re-ingested, so
  its latest version remains globally live forever and its semantic facts
  cannot be quarantined. Renames need explicit old-path tombstone plus
  new-path ingest semantics.
- **Path safety and selection are undefined.** There is no normalized
  repo-relative path contract, `.gitignore`-aware enumeration, symlink escape
  defense, binary/generated/vendor exclusion, per-file size handling, or
  deterministic ordering. Archive upload would add zip-bomb and entry-count
  concerns and is not required.
- **Cost is unbounded.** `src/workers/extraction_worker.ts` performs a paid
  chat completion and embedding call for every queued block. A first scan of a
  50k-file repository cannot silently enqueue hundreds of thousands of paid
  jobs. The existing body/upload limits are per request and must remain.
- **Session 7 exposed a separate lookup concern.** Whole-document merge p50
  grew ~5x as the graph grew ~5.8x, while same-graph hub/single-source probes
  were equal. `ENTITY_MERGE_CYPHER` matches `Entity.name`, but Neo4j bootstrap
  constrains only `Entity.id`. Profile this before repository-scale semantic
  enqueue; do not misattribute it to provenance arrays.

Session 8 must make one repository snapshot a bounded sequence of per-source
document ingests, preserve incremental diff/deletion semantics, and default to
zero paid work.

## 4. Required design

Present the exact design after inspecting §5, then implement it. Deviations
require a concrete reason and equivalent tests.

### 4.1 Extract the verified ingest service

- Add a side-effect-free planning boundary and dependency-injected executor
  under `src/core/ingestion/` (for example `plan_ingest.ts` and
  `ingest_document.ts`). Input: `{rootNode, docKey, extractionPolicy,
  requestId}`. Output must retain the current response contract plus explicit
  `blocksEligible`, `blocksQueued`, and cost-policy fields.
- Move the exact physical transaction from `POST /ingest`: `flattenAST` →
  `persistAstNodes` → `verifyPersistedAstNodes` → `recordDocumentNodes` →
  `registerDocumentVersion`, then `diffVersions`, extraction block selection,
  invalidation enqueue, and extraction `addBulk`. The API becomes a thin
  parse/validate/delegate layer. Do not weaken the read-back verification or
  split registry state from the AST transaction.
- Extraction policy must be explicit:
  - `none` (repository default): persist/diff and enqueue invalidation, but
    queue no extraction/embedding work; fresh hashes are empty, so old facts
    quarantine conservatively.
  - `changed`: current behavior, but bounded by a caller-supplied maximum
    block budget. Reject before enqueue if the plan exceeds the budget.
- A byte-identical re-ingest remains a registered version with zero added,
  orphaned, and queued blocks. Existing single-document API defaults remain
  backward compatible (`changed` with existing limits).

### 4.2 Code-aware immutable AST

- Add a parser dispatcher such as `src/core/ast/source_parser.ts` with an
  explicit `SourceLanguage`/extension table. At minimum, support the languages
  present in Trellis's backend (`.ts`/`.tsx`/`.js`/`.jsx` and `.py`) with a
  real syntax parser; configuration/text formats may use a clearly named
  opaque-text fallback, and Markdown keeps `parseMarkdownToAST`.
- Code extraction blocks are top-level functions, classes, methods where the
  parser can expose them without nesting duplication, and bounded module
  chunks for imports/statements/trivia. `collectExtractionBlocks` must select
  these blocks explicitly. Each block's content must be the exact source bytes
  it represents; do not normalize or pretty-print bytes before hashing.
- Never persist character offsets, line numbers, or mutable spans as identity.
  Parser-library ranges may only be an ephemeral mechanism for obtaining exact
  block bytes. The durable identity remains the current SHA-256 Merkle
  preimage, and `rederiveAstNodeId` stays authoritative.
- Pin determinism, complete byte coverage/order, and minimal diffs: editing one
  function changes that function block plus ancestors, while untouched
  functions retain hashes. Do not change T13's existing Markdown/PDF preimage.
- Every parser result crosses a Zod or equivalent structural boundary before
  persistence; unsupported/binary files produce a typed skip reason, not a
  partially guessed AST.

### 4.3 Repository snapshot and deletion semantics

- Add a pure scanner/manifest module under `src/core/repository/` and a CLI
  such as `scripts/ingest_repository.ts` (`npm run repo:ingest`). Use
  `execFile` with `git -C <root> ls-files -z` (no shell interpolation) for the
  default tracked-file set; an explicit flag may include untracked,
  `.gitignore`-eligible files. Sort normalized POSIX-relative paths.
- Require a stable `--repo-key`; derive document identity as
  `repo:<repo-key>:<relative-path>`. Reject absolute paths, `..` traversal,
  NULs, symlinks escaping the resolved root, files over the configured
  per-file limit, binary/NUL-containing content, vendor/generated directories,
  and unsupported extensions with deterministic reason counts.
- Persist repository snapshot membership in PostgreSQL (new idempotent schema
  tables or an equivalently durable design). The database, not a disposable
  local file, must know the previous effective path set. Snapshot publication
  must happen only after every accepted file ingest/tombstone succeeds.
- A path present in the prior snapshot but absent now must ingest an explicit
  tombstone version through the same service. That version has no extraction
  blocks, makes prior membership globally dead, and queues invalidation. A
  rename is therefore old-path tombstone plus new-path document; content
  hashes may deduplicate physically, but document identities do not merge.
- Re-running an unchanged snapshot performs zero extraction work and publishes
  an auditable no-op snapshot. A partial failure leaves the previous snapshot
  effective and exits nonzero; it must never mark unprocessed paths deleted.

### 4.4 Cost, batching, and observability

- CLI default is `--extract none` and must print the planned files/bytes/blocks
  and paid-job count before writes. `--extract changed` requires both an
  explicit positive block budget and an explicit confirmation flag; no Session
  8 acceptance command uses it.
- Bound file concurrency and total bytes in flight. This is a client-side
  pipeline over per-file ingests, not a relaxation of `INGEST_MAX_BODY_MB` and
  not a single giant transaction/request.
- Add stable logs/metrics for repository snapshots, file outcomes, skipped
  reasons, tombstones, and planned/queued blocks. Labels may include bounded
  outcome/reason/language values; never repo keys, paths, AST hashes, or
  entity names.
- Profile the existing `Entity.name` merge lookup on the Session 7 scale
  fixture. If the query plan scans labels and an index materially improves the
  fixed-shape merge measurement, add an idempotent `Entity.name` index in
  `neo4j_bootstrap.ts` with retry-safe tests. This is independent of provenance
  storage; do not open the `ASTRef` migration gate without its recorded
  threshold.

### 4.5 Cost policy

Everything required for acceptance is zero-LLM. Repository scans use
`--extract none`; semantic behavior may be tested with deterministic
pseudo-extractions through `mergeExtractedGraph`. Any real extraction run
requires explicit owner approval after the CLI reports its exact block count
and estimates chat plus embedding cost from committed benchmark telemetry.

## 5. File-level starting points

Inspect before editing:

- `TRELLIS_ROADMAP.md` §3.3 #6, §4, and the Session 7 §5 entry;
  `docs/benchmarks/SCALE_PROVENANCE_REPORT.md` for the lookup/provenance
  distinction.
- `.agents/AGENT_CODING_GUIDELINES.md`.
- `src/api/server.ts` (`POST /ingest`, raw body parsing, transaction, diff,
  queue planning) and `src/core/ast/persist.ts`.
- `src/core/ast/parser.ts` (the pinned hash authority),
  `src/core/ast/traverse.ts`, `parser.test.ts`, and `traverse.test.ts`.
- `src/core/ast/registry.ts`, `diff.ts`, and their tests; the new repository
  manifest/deletion path must preserve global-liveness reduction.
- `src/config/schema.ts`, `init_db.ts`, and `neo4j_bootstrap.ts` for
  idempotent schema/index changes under concurrent app startup.
- `src/workers/extraction_worker.ts`, `queue.ts`, and `job_options.ts` for the
  true per-block paid work and retry semantics.
- `scripts/test_versioned_ingest.ts`, `test_belief_recovery.ts`,
  `test_invalidation_sweep.ts`, and `test_compose_roundtrip.ts`.
- `src/benchmarks/scale/`, `scripts/scale_provenance_drill.ts`, and
  `scale_drill_results.json`; use same-graph merge probes if evaluating the
  name index, and preserve the migration decision gate.
- `src/core/observability/` for log/metric house style.

Prefer pure helpers for path normalization, ignore/skip decisions, manifest
diffs, parser dispatch, extraction budgets, and snapshot summaries.

## 6. Test strategy and acceptance

Test first. No paid LLM calls are permitted for Session 8 acceptance.

Offline tests must cover:

- deterministic, byte-stable code ASTs for TypeScript/JavaScript and Python;
  exact byte coverage/order; minimal one-function edits; unsupported/binary
  typed failures; unchanged Markdown/PDF hash pins;
- path normalization and traversal/symlink rejection, deterministic
  `.gitignore`/tracked-file enumeration parsing, binary/size/vendor skips, and
  stable `repo:<key>:<path>` document keys;
- manifest diff for add/modify/retain/delete/rename-as-delete-plus-add;
  snapshot atomicity on partial failure and idempotent retry;
- ingest planner parity with the current route, `none` versus `changed`,
  budget rejection before queue writes, byte-identical no-op, and tombstone
  invalidation planning;
- new schema/index statements and retry/idempotence pins;
- bounded observability labels and exact planned/queued counters.

Live zero-LLM coverage against an isolated Compose stack:

- ingest a committed multi-language repository fixture through
  `npm run repo:ingest -- --extract none`; assert one latest document per
  accepted source path, verified AST membership, zero extraction jobs, and a
  published snapshot;
- rerun unchanged: zero added/orphaned/queued blocks and an auditable no-op
  snapshot;
- edit one function: only that code block plus ancestors changes; untouched
  function hashes survive;
- delete and rename files: old doc keys receive tombstones, globally orphaned
  provenance quarantines seeded facts, renamed content gets a distinct doc key,
  and the previous snapshot remains effective if one file ingest is forced to
  fail;
- path/symlink/binary/oversize fixture entries are skipped/rejected with pinned
  reason counts and never escape the fixture root;
- if the `Entity.name` index ships, rerun the same-graph scale merge probe and
  record before/after numbers without changing the Session 7 provenance gate;
- `drill:scale` still closes its gate and cleans up, and all existing live
  suites remain green.

Required close-out:

```bash
npm test
npm run build
npm run python:check
docker compose --profile test config --quiet
# Run the isolated zero-LLM Compose integration.
npm run drill:scale
npm run test:benchmark-hardening
npm run test:entity-resolution
npm run test:api-hardening
npm run test:rlm-sandbox
npm run test:belief-recovery
npm run test:invalidation-sweep
git diff --check
```

Update:

- README/API reference with repository CLI, language/skip policy, cost
  controls, snapshot/tombstone semantics, and examples.
- Add a repository-ingestion report or runbook with fixture counts and exact
  zero-LLM results.
- `TRELLIS_ROADMAP.md`: strike 3.3 #6 only after acceptance; record any
  conditional `Entity.name` index separately from still-open 3.3 #4; add a
  full-dated §5 entry with exact commands/counts.
- **`HANDOFF.md`: regenerate for the next objective per §0.** After 3.3 #6,
  use the first remaining unstruck sequencing row unless a discovered
  correctness defect should jump it.

## 7. Guardrails

1. Never mutate an AST. T13's current hash preimage is pinned; code parsing may
   add new node types but must use the same hash authority and exact source
   bytes.
2. Never merge, rename, or delete Entity nodes. Repository file renames affect
   document keys only; semantic identity and `SAME_AS` overlay behavior stay
   pinned.
3. Preserve provenance on every semantic node and edge. Tombstones quarantine;
   they never delete belief history. The provenance state machine,
   fresh-survival race, global-liveness reduction, and commuting transitions
   remain unchanged.
4. Validate every external parser result, manifest file, dataset file, and LLM
   response at a Zod/equivalent boundary. All LLM calls remain inside BullMQ
   workers or the RLM process.
5. Repository ingestion is per file. Do not raise or bypass T6 request/body
   limits, buffer an archive/repository as one request, or place a whole repo
   in one database transaction.
6. Default to zero paid work. No `changed` extraction without an explicit
   positive budget, confirmation, owner approval, and cost estimate; no paid
   calls are acceptance checks.
7. Do not migrate provenance arrays unless a fresh observed run crosses
   Session 7's 1,000-source or superlinear-sweep gate. An Entity name index is
   not an `ASTRef` migration.
8. Follow the T16 observability house style. Paths, repo keys, AST hashes, and
   entity names never become metric label values.
9. Keep API and worker processes split. Use project-scoped Compose commands
   and never remove another stack's volumes. Fixtures and drills clean up only
   token-scoped/pre-snapshotted state.
10. Ship one feature branch and one PR to `master`, plain engineering prose,
    with no AI attribution or generated-by trailers. Regenerate this file in
    the same PR.

## 8. Explicit exclusions

Do not include: conditional `ASTRef`/`EVIDENCED_BY` migration without a crossed
threshold; T13 re-hashing; automatic Entity merging; real paid repository
extraction; cloning/fetching remote repositories; zip/tar upload endpoints;
support for every programming language in one session; generated/vendor/binary
artifact ingestion; RLM prompt/agent protocol changes; benchmark corpus v3 or
paid OOLONG runs; frontend work; Kubernetes/cloud deployment; external
observability vendors.
