You are a principal systems engineer continuing development on Trellis Engine,
a provenance-preserving GraphRAG system (repository:
https://github.com/OpenCnid/trellis, local path `D:\trellis-engine` or the
current working directory). Trellis is an original OpenCnid project, not a
fork, and is unrelated to other projects named Trellis. The repository and its
documentation are the only sources of truth.

Sessions 1–5 are complete and merged:

- PR #21 — async reliability and batch ingestion.
- PR #22 — provenance liveness closure and verified production ingestion.
- PR #23 — deployment and CI readiness.
- PR #25 — structured logging and Prometheus metrics (T16).
- Session 5 — entity resolution beyond exact-name identity (`SAME_AS` overlay
  beliefs); merged via the PR that shipped this file (see `git log -- HANDOFF.md`).

OpenCnid selected the MIT License on July 6, 2026.

Your objective is to study the current code and `TRELLIS_ROADMAP.md`, present a
concrete design, and then implement **Session 6: benchmark maturity (roadmap
item 3.3 #3)**. Do not re-plan or re-implement completed work.

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
     containers run the idempotent `db:init` concurrently).
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
   - **Anything Session 6 adds must follow this style**; benchmark runners
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

- `master`: `e9fe06e` (PR #26) plus the Session 5 entity-resolution PR that
  ships this file.
- Offline baseline: `npm test` = **247 passing across 33 files**.
- `npm run build` and `npm run python:check` pass.
- Live zero-LLM checks: `npm run test:entity-resolution` (33 checks),
  `npm run test:api-hardening` (18 checks), `npm run test:rlm-sandbox`
  (4 checks), `npm run test:belief-recovery`, `npm run test:invalidation-sweep`.
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

## 3. Session 6 problem statement

The committed `benchmark_results.json` shows F1 = 1.0 on all 20 queries with
mean sub-calls falling 0.36 (cold) → 0 (warm): the benchmark proves the
flywheel works but no longer discriminates. Why it is saturated:

- `data/oolong_pairs_dataset.json` (`oolong-pairs-trec-synthetic-v1`, seed
  42, 220 records: 50 LOC + 50 HUM + 35 NUM + 35 ENTY + 35 DESC + 15 ABBR)
  is generated by `scripts/generate_oolong_dataset.ts` from roughly four
  templates per category crossed with 14 cities. Template questions are
  trivially classifiable and trivially groupable.
- Every city mention is the **literal capitalized city name** embedded in
  the question text, and `concepts: [city]` repeats it. An agent can satisfy
  the OOLONG-Pairs query by substring-scanning question text — the shortcut
  the roadmap calls out — without ever consulting cached classifications.
- There are no distractors: no question mentions a city it is not annotated
  with, no near-miss surface forms, and no non-question prose competes.
- Cache trustworthiness is measured only out-of-band:
  `scripts/audit_flywheel_cache.ts` prints accuracy to stdout, and the
  poison drill (`src/benchmarks/oolong/poison.ts`,
  `src/benchmarks/poison_drill_runner.ts`) measures detection recall — but
  `benchmark_results.json` records neither. The roadmap says the cache-audit
  accuracy becomes a first-class metric.

`docs/benchmarks/CRITIQUE_AND_FUTURE.md` already acknowledges this
direction. The runner infrastructure (shared scoring in
`src/benchmarks/oolong/scoring.ts`, verify-as-you-go ingestion in
`scripts/ingest_oolong_dataset.ts`, dress-rehearsal seeding in `poison.ts`)
is ready for a harder corpus.

## 4. Required design

Present the exact design after inspecting the files in §5, then implement it.
This is the recommended architecture; deviations require a concrete reason
and equivalent tests.

### 4.1 Dataset v2 (deterministic, harder, versioned)

- A new seeded generator (extend `scripts/generate_oolong_dataset.ts` with a
  version flag or add a sibling script) emitting
  `data/oolong_pairs_dataset_v2.json` with `name:
  'oolong-pairs-trec-synthetic-v2'`. **Never overwrite or regenerate v1** —
  the committed `benchmark_results.json`, the drills, and
  `audit_flywheel_cache.ts` reference it.
- **Paraphrased/indirect mentions:** a deterministic per-city alias table
  (e.g. "the French capital", "the city on the Seine" for paris) so a
  scored fraction of LOC/HUM questions mention the city only indirectly.
  `concepts` keeps the canonical city (ground truth stays derivable
  offline); a new schema field records the surface form used. The
  anti-shortcut property — the paraphrased text does not contain the
  canonical city token — must be pinned by a unit test.
- **Distractors:** (a) questions using a city surface form while annotated
  with a *different* concept or none (near-miss records), and (b)
  non-question prose paragraphs mentioning city surface forms, ingested as
  part of the corpus but never valid pair members. Extend
  `OolongRecordSchema`/`buildCorpus` (`src/benchmarks/oolong/schema.ts`,
  `corpus.ts`) minimally and keep the heading+paragraph binding round trip
  verifiable.
- `ground_truth.loc_hum_shared_concept_pairs` derives exactly as v1: LOC ×
  HUM pairs sharing a concept annotation.

### 4.2 Harness generalization

- `scripts/ingest_oolong_dataset.ts`, `scripts/prepare_oolong_flywheel.ts`,
  and `scripts/audit_flywheel_cache.ts` currently hardcode the v1 path;
  accept a `--dataset <path>` flag defaulting to v1 so both corpora work.
  The verify-as-you-go ingestion loop and the deterministic
  `(:Question)-[:REFERENCES]->(:Concept)` edges (built from annotations,
  zero LLM) are unchanged in kind.
- `buildQuery` in `scoring.ts` keeps naming the canonical city — the
  difficulty moves into the corpus, not the query string. The runner
  (`src/benchmarks/oolong_runner.ts`) derives its city list and sequence
  from the dataset it is pointed at; results for v2 land in a separate
  results file (e.g. `benchmark_results_v2.json`), never overwriting v1's.

### 4.3 Cache-audit accuracy as a first-class metric

- Extract the audit logic from `scripts/audit_flywheel_cache.ts` into a pure
  module (e.g. `src/benchmarks/oolong/cache_audit.ts`) returning
  `{ cached, correct, wrong, unknown, accuracy }` given the dataset truth
  and the cached rows; the script becomes a thin caller.
- The benchmark runner appends a post-warm cache-audit block to its results
  summary, and the poison drill reuses the same module so "poison recall"
  and "cache accuracy" are computed by one implementation.

### 4.4 Cost policy (explicit)

- Everything above is implementable and verifiable **zero-LLM**: generation
  is seeded, ingestion is deterministic, cache seeding uses
  `seedVerifiedCache` (`poison.ts`), and scoring is pure.
- A paid 20-query benchmark run against v2 is **not part of acceptance**.
  If run at all, it requires explicit approval from the repository owner
  first, with a cost estimate derived from the v1 telemetry in
  `benchmark_results.json`; record actual spend in the roadmap entry.

## 5. File-level starting points

Inspect before editing:

- `TRELLIS_ROADMAP.md`, especially §3.3 #3, §4, and §5.
- `.agents/AGENT_CODING_GUIDELINES.md`.
- `docs/benchmarks/CRITIQUE_AND_FUTURE.md` (the critique this session
  answers) and any benchmark spec under `docs/benchmarks/`.
- `scripts/generate_oolong_dataset.ts` (v1 generator; templates, seed,
  ground-truth derivation), `data/oolong_pairs_dataset.json`.
- `src/benchmarks/oolong/schema.ts` (Zod boundary), `corpus.ts` (markdown
  binding round trip), `scoring.ts` (`buildQuery`, `cityTruth`,
  `parsePredictedPairs`, `scoreF1`, `executeScoredQuery`).
- `src/benchmarks/oolong_runner.ts` (20-query sequence and results shape),
  `benchmark_results.json` (the saturated baseline).
- `scripts/ingest_oolong_dataset.ts` (verify-as-you-go loop),
  `scripts/prepare_oolong_flywheel.ts`, `scripts/audit_flywheel_cache.ts`.
- `src/benchmarks/oolong/poison.ts` (`seedVerifiedCache`, `poisonCache`,
  `auditPoisonDetection`) and `src/benchmarks/poison_drill_runner.ts`.
- `scripts/test_oolong_pairs_query.ts` (the deterministic zero-LLM pairs
  check to generalize).
- `src/core/graph/entity_kinds.ts` — v2 questions/labels must land in the
  `question`/`category_label` kinds exactly like v1, keeping them invisible
  to Session 5's alias candidate generation.

Prefer pure helpers: the generator's record builders, the alias table, and
the cache-audit computation should be importable and unit-testable without
databases.

## 6. Test strategy and acceptance

Test first. No paid LLM calls are permitted for Session 6 acceptance —
drills use the oracle seeding path; a real v2 benchmark run is out of scope
without explicit owner approval (§4.4).

Offline tests should cover:

- v2 generator determinism: two runs produce byte-identical output; the
  dataset validates against the extended Zod schema;
- the anti-shortcut pin: every paraphrased record's text does NOT contain
  its canonical city token (case-insensitive), and at least a known count
  of such records exist;
- distractor records: near-miss and prose distractors are never members of
  `ground_truth.loc_hum_shared_concept_pairs`;
- ground-truth derivation: pair counts match a hand-computed fixture for a
  small seeded sample;
- `buildCorpus` binding round trip for the v2 record shapes;
- the pure cache-audit module: correct/wrong/unknown/accuracy arithmetic,
  including empty-cache and unknown-id cases;
- scoring stays shared: `parsePredictedPairs`/`scoreF1` behavior unchanged
  (existing tests keep passing).

Live zero-LLM coverage (compose stack, no OpenAI key):

- ingest the v2 corpus through the verify-as-you-go loop via the new
  `--dataset` flag; hash round trip and constraint verification pass;
- the deterministic pairs query (generalized
  `scripts/test_oolong_pairs_query.ts` or a v2 sibling) returns exactly the
  v2 ground truth from `REFERENCES` edges;
- `seedVerifiedCache` + the cache-audit module report accuracy 1.0 on a
  clean seed; `poisonCache` + the audit reflect the flipped labels;
- v2 question/label entities carry kinds `question`/`category_label`, and
  Session 5's `selectResolutionCandidates` proposes zero pairs among them;
- clean up all seeded state.

Existing suites must stay green.

Required close-out:

```bash
npm test
npm run build
npm run python:check
docker compose --profile test config --quiet
# Run the isolated zero-LLM Compose integration.
npm run test:entity-resolution
npm run test:api-hardening
npm run test:rlm-sandbox
npm run test:belief-recovery
npm run test:invalidation-sweep
git diff --check
```

The baseline is 247 tests and may only increase.

Update:

- README/benchmark docs for the v2 dataset, flags, and results file.
- `docs/benchmarks/CRITIQUE_AND_FUTURE.md`: mark what v2 answers, note what
  remains (real TREC import, embedding-based retrieval difficulty).
- `TRELLIS_ROADMAP.md`: mark 3.3 #3 complete only after acceptance; add a
  full-dated §5 progress entry with exact checks/counts (and paid spend if
  an approved run happened).
- **`HANDOFF.md`: regenerate for Session 7 per §0.** Per the current
  sequencing table the next objective is semantic provenance scaling
  (3.3 #4), unless this session surfaces something that should jump the
  queue.

## 7. Guardrails

1. Never mutate an AST. T13's current hash preimage is pinned; changing it
   requires a re-hash migration and is out of scope.
2. Never merge, rename, or delete Entity nodes; `globalEntityId`, both merge
   Cyphers, and the Session 5 verdict-edge semantics are pinned by tests.
3. Preserve provenance on every semantic node and edge; the v2 corpus flows
   through the same verified ingestion and quarantine machinery as v1.
4. Validate every dataset file and LLM response at the existing Zod
   boundaries; all LLM calls remain inside BullMQ workers or the RLM
   process.
5. Never overwrite dataset v1, its committed `benchmark_results.json`, or
   the drills that reference them; v2 is additive and separately versioned.
6. Keep benchmark question/label entities in the `question`/
   `category_label` kinds so alias resolution structurally ignores them.
7. No paid LLM calls without explicit owner approval; deterministic/oracle
   paths are the acceptance surface.
8. Follow the T16 observability house style for anything operational; no
   high-cardinality metric labels.
9. Keep the API and worker process split; use project-scoped Compose
   commands and never remove another stack's volumes.
10. Close of work uses a feature branch, a PR to `master`, plain engineering
    prose, and no AI attribution or generated-by trailers. Finish by
    regenerating this file per §0 — the loop is part of acceptance.

## 8. Explicit exclusions

Do not include: importing real TREC questions (the OOLONG-Pairs task needs
per-question concept annotations that real TREC lacks; an annotation pass
would be paid and non-deterministic — record it as future work instead);
embedding-based candidate generation or retrieval changes; RLM prompt/agent
protocol changes beyond what the harder corpus itself exercises; automatic
entity merging; provenance-scaling migrations (3.3 #4, next session);
whole-codebase ingestion; frontend work; Kubernetes/cloud deployment;
external observability vendors; T13 re-hashing; paid benchmark runs as an
acceptance requirement.
