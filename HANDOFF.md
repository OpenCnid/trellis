You are a principal systems engineer continuing development on Trellis Engine,
a provenance-preserving GraphRAG system (repository:
https://github.com/OpenCnid/trellis, local path `D:\trellis-engine` or the
current working directory). Trellis is an original OpenCnid project, not a
fork, and is unrelated to other projects named Trellis. The repository and its
documentation are the only sources of truth.

Sessions 1–6 are complete and merged:

- PR #21 — async reliability and batch ingestion.
- PR #22 — provenance liveness closure and verified production ingestion.
- PR #23 — deployment and CI readiness.
- PR #25 — structured logging and Prometheus metrics (T16).
- PR #27 — entity resolution beyond exact-name identity (`SAME_AS` overlay
  beliefs, Session 5).
- Session 6 — benchmark maturity (anti-shortcut dataset v2 + first-class
  cache-audit metric); merged via the PR that shipped this file (see
  `git log -- HANDOFF.md`).

OpenCnid selected the MIT License on July 6, 2026.

Your objective is to study the current code and `TRELLIS_ROADMAP.md`, present a
concrete design, and then implement **Session 7: semantic provenance scaling
(roadmap item 3.3 #4)** — measurement first, migration only if the
measurements justify it. Do not re-plan or re-implement completed work.

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
   - Schema bootstrap is serialized by `pg_advisory_xact_lock` (both app
     containers run the idempotent `db:init` concurrently); the Neo4j
     constraint bootstrap runs through `executeWrite`
     (`src/config/neo4j_bootstrap.ts`) so concurrent fresh-graph starts
     retry the transient label-lock deadlock instead of failing the
     container (defect found by Session 6's CI).
2. **Neo4j — semantic and belief layer**
   - `Entity` and `Conflict` nodes plus `ACTION`, `CONTRADICTS`,
     `DERIVED_INSIGHT`, `SAME_AS`/`DISTINCT_FROM`, and conflict-link edges.
   - Semantic nodes and edges carry `sourceNodeIds`.
   - `contested`, `contestedAt`, `contestedReason`, `orphanedSourceIds`, and
     `rederivedAt` form an audit-preserving quarantine/recovery state machine
     (`src/core/graph/provenance.ts` specifies it; the invalidation sweep and
     every write path implement commuting transitions).
   - Entities carry a `kind` namespace: `question`, `category_label`,
     `concept`, `generic` (`src/core/graph/entity_kinds.ts`). Flywheel
     beliefs also carry confidence, rubric version, and verification state.
   - **Entity resolution (Session 5):** identity is still
     `SHA-256(lowercase(name))` and is never rewritten. Equivalence is an
     overlay belief: deterministic lexical candidates
     (`src/core/graph/alias_candidates.ts`, kinds `generic`/`concept` only)
     are adjudicated by the resolution worker into
     `SAME_AS`/`DISTINCT_FROM` verdict edges with union provenance
     (`src/core/graph/alias_resolution.ts`), which the existing sweep
     quarantines like any belief. `GET /retrieve` expands one non-contested
     `SAME_AS` hop at `RESOLUTION_MIN_CONFIDENCE` (default 0.8) with
     per-fact `viaAlias` attribution; `?resolveAliases=false` opts out.
   - **Benchmark corpora (Session 6):** the OOLONG harness ships two seeded
     corpora — v1 (`data/oolong_pairs_dataset.json`, the saturated baseline
     behind the committed `benchmark_results.json`) and the anti-shortcut v2
     (`data/oolong_pairs_dataset_hard.json`,
     `oolong-pairs-trec-synthetic-v2`, pure generator
     `src/benchmarks/oolong/generate_v2.ts`): paraphrased city mentions that
     never contain the canonical token, near-miss questions name-dropping
     unannotated cities, and prose distractors ingested as `:Passage` nodes
     (provenance, no category, no `REFERENCES` — never pairable). Harness
     CLIs take `--dataset` (default v1,
     `src/benchmarks/oolong/dataset_cli.ts`); the runner writes non-v1
     results to `benchmark_results_v2.json` and refuses to overwrite v1's.
     Cache-audit accuracy is a first-class metric
     (`src/benchmarks/oolong/cache_audit.ts`) shared by the audit CLI, the
     runner's results block, and the poison drill. v2 question ids are
     `q_1001..q_1220` — disjoint from v1 but still `q_\d+`-shaped, so both
     corpora coexist in one graph and stay invisible to alias resolution.
3. **Redis + BullMQ — asynchronous layer**
   - `extraction_queue`, `rlm_queue`, `supervisor_queue`,
     `invalidation_queue`, `verification_queue`, and `resolution_queue`.
   - Redis pub/sub streams Python RLM stdout/stderr to SSE clients.
4. **Observability (T16)**
   - `src/core/observability/` is the house style: pino JSON logging (one
     object per line, validated `LOG_LEVEL`, `TRELLIS_SERVICE` process tag,
     child-logger correlation fields `service`/`worker`/`queue`/`jobId`/
     `attempt`/`requestId`/`docKey`/`version`/`astNodeId`, stable
     dot-namespaced `event` values) and per-process `prom-client` registries.
   - The API serves authenticated `GET /metrics`; the worker container serves
     an internal listener on `WORKER_METRICS_PORT` (9464, never published to
     the host) with scrape-time queue-depth gauges registered in
     `src/workers/metrics_server.ts`.
   - **Anything Session 7 adds must follow this style**; benchmark runners
     and maintenance CLIs may keep human-formatted console output.

`POST /ingest` parses Markdown/PDF into a Merkle AST, bulk-persists it, reads
it back and re-derives every hash inside the transaction, registers document
membership/version state, computes a Merkle diff, queues extraction only for
new block hashes, and queues invalidation for hashes removed from that
document. The invalidation worker filters candidates against every document's
latest version before quarantining graph facts. Extraction has an early
liveness gate plus pre/post-merge fencing and compensating quarantine.

The RLM sandbox uses server-enforced read-only Neo4j sessions for arbitrary
Cypher and one explicit provenance-required write path. The verification
worker independently rechecks sampled cached beliefs, accrues trust on
agreement, and reuses the quarantine path on disagreement. The verification
and resolution subsystems share one shape — a sweep script selects and
enqueues, a worker burns the batch down, and a ground-truth oracle
(`makeOracleClassifier` in `verification.ts`, `makeOracleAdjudicator` in
`alias_resolution.ts`) replaces the sub-LLM in zero-cost drills.

The backend and workers run as **separate Node processes/containers**.

## 2. Current baseline

Repository state at handoff creation:

- `master`: `5f8d96b` (PR #27) plus the Session 6 benchmark-maturity PR that
  ships this file.
- Offline baseline: `npm test` = **283 passing across 37 files**.
- `npm run build` and `npm run python:check` pass.
- Live zero-LLM checks: `npm run test:benchmark-hardening` (24 checks),
  `npm run test:entity-resolution` (33 checks), `npm run test:api-hardening`
  (18 checks), `npm run test:rlm-sandbox` (4 checks),
  `npm run test:belief-recovery`, `npm run test:invalidation-sweep`.
- The isolated Compose integration (`scripts/test_compose_roundtrip.ts`, 9
  assertions) starts the API and workers with no OpenAI key and asserts
  metrics auth/exposition, worker-listener reachability, queue gauges for
  all six queues, and the `/healthz` contract.
- CI (Node 22): offline tests/build/Python checks, image build, isolated
  Compose zero-LLM integration.

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

## 3. Session 7 problem statement

Provenance is stored as unbounded array properties, and the machinery that
reads them scales with graph size times array length:

- **Append-only unions.** `ENTITY_MERGE_CYPHER` and `ACTION_MERGE_CYPHER`
  (`src/core/graph/extraction_merge.ts`) union every incoming live block
  hash into `sourceNodeIds` on `ON MATCH`. The RLM write path
  (`_WRITE_INSIGHT_QUERY` in `src/rlm/trellis_tools.py`) does the same for
  `DERIVED_INSIGHT` edges and both endpoint nodes, `SAME_AS`/`DISTINCT_FROM`
  verdicts carry the union of both endpoints' provenance
  (`alias_resolution.ts`), and the OOLONG ingester appends per-batch to
  `Concept.sourceNodeIds`. A hub entity mentioned once per document
  accumulates one hash per mentioning block, forever. `orphanedSourceIds`
  audit arrays additionally grow monotonically and are never pruned (by
  design — but they multiply the property payload).
- **The sweep is a full-graph scan.** `CONTEST_NODES_CYPHER` /
  `CONTEST_RELS_CYPHER` (`src/core/graph/invalidation.ts`) run label-less
  `MATCH (n)` / `MATCH ()-[r]->()` with
  `any(h IN n.sourceNodeIds WHERE h IN $orphaned)` per 500-hash orphan
  batch. No index can serve array-membership predicates, so each re-ingest
  pays O(batches × (V + E) × mean array length).
- **Retrieval and adjudication read whole arrays.** `GET /retrieve`
  (`src/api/server.ts`) unions `sourceNodeIds` across the traversal and
  joins them to `ast_nodes`; alias adjudication fetches snippet text for
  every id in each endpoint's array (`fetchEntitySnippets` in
  `alias_resolution.ts`).
- **The roadmap's stated bar (3.3 #4):** consider provenance as first-class
  edges (`(:Entity)-[:EVIDENCED_BY]->(:ASTRef)`) once documents number in
  the hundreds — and "replace unbounded source arrays only when scale
  measurements justify the migration" (§4 sequencing rationale). No such
  measurements exist yet: nothing in the repo ingests hundreds of documents
  or measures sweep/merge/retrieval cost as arrays grow.

So Session 7 is measurement-first: build the scale evidence, then migrate
only what the evidence indicts — or record, with numbers, that the migration
is not yet justified and what threshold would justify it.

## 4. Required design

Present the exact design after inspecting the files in §5, then implement it.
This is the recommended architecture; deviations require a concrete reason
and equivalent tests.

### 4.1 Milestone A — deterministic scale drill (zero-LLM, required)

- A pure seeded corpus generator (e.g.
  `src/benchmarks/scale/generate_scale_corpus.ts`): N synthetic markdown
  documents (target ≥ 300, tunable) × ~15–25 blocks, mentioning a fixed
  entity pool with a skewed (Zipf-like) distribution so a few hub entities
  appear in most documents and a long tail appears rarely. Deterministic:
  same seed → byte-identical corpus; unit-test the mention distribution.
- A drill runner (e.g. `scripts/scale_provenance_drill.ts`, npm script
  `drill:scale`) that drives the corpus through the REAL machinery with no
  LLM: physical writes + `registerDocumentVersion` + `recordDocumentNodes`
  (the pattern in `scripts/test_entity_resolution.ts`'s `ingestVersion`),
  then deterministic pseudo-extractions through `mergeExtractedGraph` — the
  same code path production extraction uses.
- Measurements (committed as `scale_drill_results.json` + a
  `docs/benchmarks/SCALE_PROVENANCE_REPORT.md` summarizing them):
  - `sourceNodeIds` cardinality distribution per label/edge type (max, p95,
    mean) as document count grows (sample at e.g. 50/150/300 docs);
  - merge latency for hub entities as their arrays grow (the ON MATCH list
    comprehension is O(existing × incoming));
  - sweep latency vs. graph size and orphan-set size: re-ingest K modified
    documents, time `sweepOrphanedProvenance` end to end and per batch;
  - `/retrieve` latency for a hub entity vs. a tail entity;
  - alias adjudication context-fetch cost for hub entities (the snippet
    fetch iterates the whole array).
  Timing helpers should be pure/injectable where practical; the numbers in
  the report must come from the live drill against the compose stack.
- Cleanup: the drill must remove everything it created (token-prefixed
  names/doc keys, tracked AST rows — follow `test_benchmark_hardening.ts`'s
  pre-snapshot pattern).

### 4.2 Milestone B — migration, gated on A's evidence

- **Decision gate (record it in the roadmap either way):** migrate only if
  Milestone A shows superlinear sweep cost or hub arrays in the thousands at
  realistic document counts. If the evidence does not indict the arrays,
  record the measured headroom and the threshold that would trigger the
  migration, regenerate this file for the next objective, and stop — that is
  a valid, complete Session 7.
- If migrating, the recommended shape is **provenance as first-class edges**:
  `(:ASTRef {hash})` nodes (unique-constrained) with
  `(fact)-[:EVIDENCED_BY {orphaned, orphanedAt}]->(:ASTRef)` edges replacing
  array membership for *scan* purposes. The sweep becomes an indexed anchor
  lookup (`MATCH (ref:ASTRef) WHERE ref.hash IN $orphaned`) plus an edge
  traversal — no full-graph scan. Keep the quarantine state machine
  semantics of `provenance.ts` (contested/fresh-survival/audit history/
  commuting transitions) — its unit tests are the spec; extend them rather
  than weakening them. Relationships cannot carry `EVIDENCED_BY` edges
  (Neo4j has no edges on edges), so relationship provenance needs an
  explicit decision: keep arrays on edges (measure whether edges are a
  minority of hub growth first) or reify hot edges as nodes. Do not guess:
  choose from A's numbers.
- Any migration ships with: an idempotent backfill script for existing
  graphs (`scripts/migrate_provenance_refs.ts`), dual-form consistency
  checks during the transition, updated Cypher pins in the unit suite
  (deliberate, reviewed pin changes — the old pins encode the old storage,
  not the invariant), and a re-run of Milestone A's drill demonstrating the
  improvement with before/after numbers in the report.

### 4.3 Cost policy (explicit)

- Everything above is implementable and verifiable **zero-LLM**: the drill
  uses deterministic pseudo-extractions and the real merge/sweep/retrieve
  paths. No paid LLM calls are part of Session 7 acceptance. A paid
  benchmark run (v1 or v2) still requires explicit owner approval per the
  Session 6 cost policy, with an estimate derived from the v1 telemetry in
  `benchmark_results.json`.

## 5. File-level starting points

Inspect before editing:

- `TRELLIS_ROADMAP.md`, especially §3.3 #4, §4, and the Session 5/6 §5
  entries.
- `.agents/AGENT_CODING_GUIDELINES.md`.
- `src/core/graph/extraction_merge.ts` (both merge Cyphers and their ON
  MATCH array unions), `src/core/graph/provenance.ts` and
  `provenance.test.ts` (the state-machine spec any migration must honor).
- `src/core/graph/invalidation.ts` (the full-scan sweep Cyphers,
  `SWEEP_BATCH_SIZE`).
- `src/core/ast/registry.ts` (`registerDocumentVersion`,
  `recordDocumentNodes`, `isAstNodeLive`, global liveness reduction) and
  `src/core/ast/diff.ts`.
- `src/api/server.ts` (`GET /retrieve` provenance join and alias
  expansion), `src/core/graph/alias_resolution.ts`
  (`fetchEntitySnippets` iterates whole arrays; verdict union
  provenance).
- `src/rlm/trellis_tools.py` (`_WRITE_INSIGHT_QUERY` — the Python half of
  every provenance union; any storage change must update it in lockstep).
- `scripts/test_entity_resolution.ts` (`ingestVersion` — the zero-LLM
  versioned-ingest pattern the drill should reuse) and
  `scripts/test_benchmark_hardening.ts` (pre-snapshot cleanup pattern).
- `src/config/init_db.ts` (where any new constraint/index bootstrap lives)
  and `src/core/observability/metrics.ts` (if the sweep gains new
  counters/durations, follow the house style).
- `scripts/test_belief_recovery.ts` and `scripts/test_invalidation_sweep.ts`
  (the suites that pin quarantine/recovery behavior and must stay green
  through any migration).

Prefer pure helpers: the corpus generator, the mention-distribution math,
and any percentile/timing aggregation should be importable and
unit-testable without databases.

## 6. Test strategy and acceptance

Test first. No paid LLM calls are permitted for Session 7 acceptance.

Offline tests should cover:

- scale-corpus generator determinism (two runs byte-identical) and the
  mention distribution (hub entities appear in a pinned share of documents,
  tail entities in a pinned smaller share, for the default seed);
- percentile/aggregation helpers used by the report;
- if Milestone B proceeds: the new Cypher pins (ASTRef anchor lookup, edge
  creation, orphaned-flag transitions), provenance state-machine tests
  extended to the new storage (including the fresh-survival race and
  commutativity), and backfill idempotence logic in pure form;
- existing suites unchanged: `provenance.test.ts` semantics stay green
  (update pins only where storage deliberately changed).

Live zero-LLM coverage (compose stack, no OpenAI key):

- the scale drill runs end to end at the default document count, writes
  `scale_drill_results.json`, and cleans up all seeded state (pre-existing
  rows preserved — pre-snapshot pattern);
- sweep correctness at scale: re-ingest K modified documents, assert the
  same facts are contested/survived as the small-scale suites predict
  (correctness, not just latency);
- if Milestone B proceeds: `test:belief-recovery`,
  `test:invalidation-sweep`, `test:entity-resolution`, and
  `test:benchmark-hardening` all pass against the new storage, plus a
  before/after drill comparison demonstrating the improvement;
- existing suites must stay green either way.

Required close-out:

```bash
npm test
npm run build
npm run python:check
docker compose --profile test config --quiet
# Run the isolated zero-LLM Compose integration.
npm run test:benchmark-hardening
npm run test:entity-resolution
npm run test:api-hardening
npm run test:rlm-sandbox
npm run test:belief-recovery
npm run test:invalidation-sweep
git diff --check
```

The baseline is 283 tests and may only increase.

Update:

- `docs/benchmarks/SCALE_PROVENANCE_REPORT.md` (new) and README if the
  drill gains an npm script.
- `TRELLIS_ROADMAP.md`: mark 3.3 #4 complete only after acceptance — or, if
  the decision gate says "not yet", record the measured evidence and the
  trigger threshold, and strike the item only when the migration actually
  ships; add a full-dated §5 progress entry with exact checks/counts either
  way.
- **`HANDOFF.md`: regenerate for Session 8 per §0.** Per the current
  sequencing table the next objective is whole-codebase ingestion (3.3 #6),
  unless this session surfaces something that should jump the queue.

## 7. Guardrails

1. Never mutate an AST. T13's current hash preimage is pinned; changing it
   requires a re-hash migration and is out of scope.
2. Never merge, rename, or delete Entity nodes; `globalEntityId` and the
   Session 5 verdict-edge semantics are pinned by tests. The merge Cyphers
   may change form in Milestone B, but their provenance *semantics*
   (`provenance.ts` state machine, commuting transitions, audit history)
   are the invariant — change pins deliberately and extend the semantic
   tests, never delete them.
3. Preserve provenance on every semantic node and edge; any new storage
   form must keep every fact traceable to content-addressed AST hashes and
   keep quarantine/recovery behavior equivalent (proven by the existing
   live suites).
4. Validate every dataset file and LLM response at the existing Zod
   boundaries; all LLM calls remain inside BullMQ workers or the RLM
   process.
5. Never overwrite dataset v1, dataset v2
   (`data/oolong_pairs_dataset_hard.json`), the committed
   `benchmark_results.json`, or the drill files that reference them.
6. Migration is gated on measurement: do not ship Milestone B without
   Milestone A's committed numbers indicting the arrays, and record the
   decision either way in the roadmap.
7. No paid LLM calls without explicit owner approval; deterministic paths
   are the acceptance surface.
8. Follow the T16 observability house style for anything operational; no
   high-cardinality metric labels (AST hashes and entity names never
   become label values).
9. Keep the API and worker process split; use project-scoped Compose
   commands and never remove another stack's volumes. The scale drill
   cleans up everything it seeds.
10. Close of work uses a feature branch, a PR to `master`, plain engineering
    prose, and no AI attribution or generated-by trailers. Finish by
    regenerating this file per §0 — the loop is part of acceptance.

## 8. Explicit exclusions

Do not include: whole-codebase ingestion (3.3 #6, next in sequence);
embedding-granularity or vector-index changes (already shipped with T2/T14);
benchmark corpus v3, real TREC import, or paid benchmark runs; RLM
prompt/agent protocol changes; automatic entity merging; T13 re-hashing;
pruning or truncating `orphanedSourceIds` audit history (audit preservation
is the point — reify it if it must move, never drop it); frontend work;
Kubernetes/cloud deployment; external observability vendors.
