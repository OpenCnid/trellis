You are a principal systems engineer continuing development on Trellis Engine,
a provenance-preserving GraphRAG system (repository:
https://github.com/OpenCnid/trellis, local path `D:\trellis-engine` or the
current working directory). Trellis is an original OpenCnid project, not a
fork, and is unrelated to other projects named Trellis. The repository and its
documentation are the only sources of truth.

Sessions 1–4 are complete and merged:

- PR #21 — async reliability and batch ingestion.
- PR #22 — provenance liveness closure and verified production ingestion.
- PR #23 — deployment and CI readiness.
- PR #25 — structured logging and Prometheus metrics (T16).

OpenCnid selected the MIT License on July 6, 2026.

Your objective is to study the current code and `TRELLIS_ROADMAP.md`, present a
concrete design, and then implement **Session 5: entity resolution beyond
exact-name identity (roadmap item 3.3 #2)**. Do not re-plan or re-implement
completed work.

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
     `DERIVED_INSIGHT`, and conflict-link edges.
   - Semantic nodes and edges carry `sourceNodeIds`.
   - `contested`, `contestedAt`, `contestedReason`, `orphanedSourceIds`, and
     `rederivedAt` form an audit-preserving quarantine/recovery state machine
     (`src/core/graph/provenance.ts` specifies it; the invalidation sweep and
     both write paths implement commuting transitions).
   - Entities carry a `kind` namespace: `question`, `category_label`,
     `concept`, `generic` (`src/core/graph/entity_kinds.ts`). Flywheel
     beliefs also carry confidence, rubric version, and verification state.
3. **Redis + BullMQ — asynchronous layer**
   - `extraction_queue`, `rlm_queue`, `supervisor_queue`,
     `invalidation_queue`, and `verification_queue`.
   - Redis pub/sub streams Python RLM stdout/stderr to SSE clients.
4. **Observability (T16, new in Session 4)**
   - `src/core/observability/` is the house style: pino JSON logging (one
     object per line, validated `LOG_LEVEL`, `TRELLIS_SERVICE` process tag,
     child-logger correlation fields `service`/`worker`/`queue`/`jobId`/
     `attempt`/`requestId`/`docKey`/`version`/`astNodeId`, stable
     dot-namespaced `event` values) and per-process `prom-client` registries.
   - The API serves authenticated `GET /metrics`; the worker container serves
     an internal listener on `WORKER_METRICS_PORT` (9464, never published to
     the host) with scrape-time queue-depth gauges registered in
     `src/workers/metrics_server.ts`.
   - `/ingest` generates a `requestId` (returned as `x-request-id`) and
     threads it with `docKey`/`version` into job payloads.
   - **Anything Session 5 adds must follow this style**: child logger with
     bindings, `instrumentWorker` on any new BullMQ worker, LLM usage
     recorded via `recordLlmCall` with a fixed `operation` label, no
     high-cardinality metric labels.

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
agreement, and reuses the quarantine path on disagreement — its
sweep-selects/worker-burns-down split and its zero-LLM oracle classifier
(`makeOracleClassifier` in `src/core/graph/verification.ts`) are the pattern
Session 5 should mirror.

The backend and workers run as **separate Node processes/containers**.

## 2. Current baseline

Repository state at handoff creation:

- `master` merge commit: `12bedea` (PR #25).
- Offline baseline: `npm test` = **207 passing across 30 files**.
- `npm run build` and `npm run python:check` pass.
- Live zero-LLM checks: `npm run test:api-hardening` (18 checks),
  `npm run test:rlm-sandbox` (4 checks), `npm run test:belief-recovery`,
  `npm run test:invalidation-sweep`.
- The isolated Compose integration (`scripts/test_compose_roundtrip.ts`, 9
  assertions) starts the API **and workers** with no OpenAI key and asserts
  metrics auth/exposition, worker-listener reachability, queue gauges, and
  the `/healthz` contract.
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

## 3. Session 5 problem statement

Entity identity is exact-name identity. `globalEntityId` in
`src/core/graph/resolve_actions.ts` is `SHA-256(lowercase(name))`, and
`ENTITY_MERGE_CYPHER` in `src/core/graph/extraction_merge.ts` merges on
`{name: toLower(ent.name)}`. Consequences:

- "Globex" and "Globex Corporation" are permanently distinct `Entity` nodes;
  facts land on whichever surface form each extraction emitted.
- `GET /retrieve?entity=Globex` cannot see actions recorded against
  "globex corporation", and vice versa — the graph silently under-reports.
- The supervisor's contradiction detection only compares same-subject
  fan-outs, so cross-alias contradictions are structurally invisible.

The roadmap (3.3 #2) prescribes the direction: aliasing/canonicalization with
candidate generation plus LLM adjudication, recorded as `SAME_AS` edges with
provenance — an overlay belief, never a merge. Entity nodes, their ids, and
the extraction merge are load-bearing and pinned by tests; identity stays
immutable while equivalence becomes a first-class, quarantinable belief.

## 4. Required design

Present the exact design after inspecting the files in §5, then implement it.
This is the recommended architecture; deviations require a concrete reason
and equivalent tests.

### 4.1 Identity invariants

- `globalEntityId` and both merge Cyphers are unchanged. No Entity node is
  ever merged, renamed, or deleted by resolution.
- `SAME_AS` is an equivalence **claim** between two existing entities,
  carrying the same audit machinery as every other belief: `sourceNodeIds`,
  and therefore automatic quarantine by the existing invalidation sweep when
  its provenance dies. Do not build new quarantine machinery — inherit it,
  and prove the inheritance in tests.

### 4.2 Candidate generation (deterministic, LLM-free)

- New pure module, e.g. `src/core/graph/alias_candidates.ts`: given
  `(name, kind)` pairs, propose candidate pairs via lexical signals —
  normalized token containment ("globex" ⊂ "globex corporation"),
  acronym/initialism match, and a near-identity edit-distance guard. Fully
  unit-testable with zero infrastructure.
- **Kind discipline:** only pair entities of the same `kind`, and only kinds
  `generic` and `concept`. Never propose candidates involving `question` or
  `category_label` entities — those namespaces are structural, and the
  OOLONG flywheel depends on exact-id lookups.
- Canonical pair ordering (lexicographically smaller entity id first) so the
  candidate set and the edge direction are deterministic and deduplicated.
- Selection runs in a sweep script (`scripts/resolve_sweep.ts`, npm script
  `resolve:sweep`) that reads entities from Neo4j, excludes pairs already
  carrying a non-contested verdict edge, caps the batch
  (`RESOLUTION_MAX_PAIRS_PER_SWEEP`, suggested default 200), and enqueues one
  job — the verification sweep's exact shape.
- Embedding-based candidate generation is a documented follow-up, not part
  of this session (entity names carry no embeddings today).

### 4.3 Adjudication (LLM, batched, validated)

- New `resolution_queue` and `src/workers/resolution_worker.ts` following the
  verification worker skeleton. The queue uses the standard retrying job
  options (adjudication is idempotent); it joins `queue.ts`,
  `scripts/start_workers.ts`, the queue-gauge list in
  `src/workers/metrics_server.ts`, and shutdown registration.
- `AliasAdjudicationSchema` in `src/core/graph/schemas.ts` (structured
  output): per pair `sameEntity: boolean`, `confidence: 0..1`, bounded
  `reasoning`. Every completion crosses `parseLlmResponse`.
- Prompt context per pair: both names, types, kinds, and **bounded** source
  text snippets fetched via each entity's live `sourceNodeIds` (the
  supervisor's `joinAstTexts` pattern). Never whole documents.
- `makeOracleAdjudicator` mirroring `makeOracleClassifier`: a ground-truth
  pair→verdict map for zero-LLM live drills.

### 4.4 Verdict edges

- Positive: `(a)-[:SAME_AS]->(b)` in canonical id order. Negative:
  `(a)-[:DISTINCT_FROM]->(b)` — recording negatives prevents re-paying for
  the same pair on every sweep.
- Both carry: `confidence`, `adjudicatedAt`, `method` (`llm`/`oracle`),
  `model`, bounded `reasoning`, and `sourceNodeIds` = the union of both
  endpoints' live provenance at adjudication time.
- When provenance dies, the sweep contests the verdict edge like any belief;
  a contested pair becomes re-adjudicable on a later sweep — arbitration by
  re-derivation, consistent with the rest of the system.

### 4.5 Retrieval integration

- `GET /retrieve` expands the seed entity across non-contested `SAME_AS`
  edges with `confidence >= RESOLUTION_MIN_CONFIDENCE` (suggested default
  0.8) — one alias hop — before the existing traversal, unions provenance,
  and attributes which alias contributed each fact in the response shape.
- `?resolveAliases=false` opts out; `includeContested` semantics stay
  orthogonal and unchanged.
- Route metric labels are untouched (fixed route table).

### 4.6 Configuration and observability

- New config through `src/config/index.ts` only:
  `RESOLUTION_MIN_CONFIDENCE`, `RESOLUTION_MAX_PAIRS_PER_SWEEP`,
  `RESOLUTION_BATCH_SIZE` (pairs per completion, suggested default 25).
- Worker instrumentation per the T16 house style: child logger
  (`worker: 'resolution'`), `instrumentWorker`, `recordLlmCall` with
  `operation: 'resolution'`, events such as `resolution.sweep_started`,
  `resolution.sweep_completed`, `resolution.alias_recorded`,
  `resolution.pair_distinct`, plus counters (suggested:
  `trellis_resolution_pairs_total{verdict}`,
  `trellis_resolution_candidates_total`). Entity names belong in logs, never
  in metric labels.

## 5. File-level starting points

Inspect before editing:

- `TRELLIS_ROADMAP.md`, especially §2.2, §3.3 #2, §4, and §5.
- `.agents/AGENT_CODING_GUIDELINES.md`.
- `src/core/graph/resolve_actions.ts` (identity), `extraction_merge.ts`
  (merge semantics), `entity_kinds.ts` (kind namespace), `provenance.ts` and
  `invalidation.ts` (quarantine machinery `SAME_AS` must inherit),
  `verification.ts` (sweep/worker/oracle pattern), `schemas.ts`,
  `conflict_resolution.ts` (`joinAstTexts`).
- `src/workers/verification_worker.ts` (the skeleton to mirror), `queue.ts`,
  `job_options.ts`, `metrics_server.ts`.
- `src/api/server.ts` (`/retrieve` traversal and response shape).
- `src/core/observability/` (house style to reuse, not extend ad hoc).
- `src/config/index.ts`, `.env.example`, `docker-compose.yml`, CI.
- `scripts/verify_sweep.ts` and `scripts/test_verification_sweep.ts` (the
  sweep-script and live-drill shapes to mirror).
- `API_REFERENCE.md`, `docs/operations/RUNBOOK.md`.

Prefer pure helpers and dependency injection so candidate generation,
adjudication mapping, and Cypher parameter building are offline-testable
without importing worker modules that open database or Redis connections.

## 6. Test strategy and acceptance

Test first. No paid LLM calls are permitted for Session 5 verification —
adjudication in tests uses the oracle.

Offline tests should cover:

- candidate generation: token containment, acronym matching, edit-distance
  guard, same-kind restriction, exclusion of `question`/`category_label`,
  canonical ordering, cap determinism, purity;
- `AliasAdjudicationSchema` validation through `parseLlmResponse` (empty /
  json / schema failure stages);
- verdict-edge Cypher parameter building: canonical direction, provenance
  union, positive vs negative edge type, bounded reasoning;
- retrieval expansion query: pins that the Cypher filters on non-contested +
  confidence threshold and that `resolveAliases=false` bypasses expansion;
- oracle adjudicator behavior (including pairs absent from the truth map);
- resolution worker metrics/log events via injected fakes;
- queue-gauge coverage for the sixth queue.

Live zero-LLM coverage (new `npm run test:entity-resolution`, compose-stack
style like `test_belief_recovery.ts`):

- seed `globex` and `globex corporation` entities with distinct facts and
  real provenance; run the sweep + worker with the oracle adjudicator;
- assert the `SAME_AS` edge exists with canonical direction, confidence, and
  union provenance;
- assert `GET /retrieve?entity=Globex` now returns the alias's facts with
  union provenance and alias attribution, and that `resolveAliases=false`
  restores the old behavior;
- orphan one endpoint's provenance through the existing invalidation path
  and assert the `SAME_AS` edge is contested and expansion stops —
  quarantine inheritance proven live;
- clean up all seeded state; zero extraction jobs, zero LLM calls.

Existing suites must stay green: the OOLONG benchmark scripts' exact-id
lookups must be unaffected (`question`/`category_label` exclusion is the
mechanism).

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

The baseline is 207 tests and may only increase.

Update:

- `.env.example` and README for new configuration.
- `API_REFERENCE.md` for the `/retrieve` alias parameters and response
  attribution.
- `docs/operations/RUNBOOK.md`: six queues, new metrics and events in the §7
  catalog.
- `TRELLIS_ROADMAP.md`: mark 3.3 #2 complete only after acceptance; add a
  full-dated §5 progress entry with exact checks/counts.
- **`HANDOFF.md`: regenerate for Session 6 per §0.** Per the current
  sequencing table the next objective is benchmark maturity (3.3 #3), unless
  this session surfaces something that should jump the queue.

## 7. Guardrails

1. Never mutate an AST. T13's current hash preimage is pinned; changing it
   requires a re-hash migration and is out of scope.
2. Never merge, rename, or delete Entity nodes. `globalEntityId` and both
   merge Cyphers are pinned; `SAME_AS` is an overlay belief, not a rewrite.
3. Preserve provenance on every new edge; verdict edges must be contestable
   by the existing sweep with zero new quarantine machinery.
4. Validate every LLM response at the existing Zod boundary; all LLM calls
   remain inside BullMQ workers.
5. Never adjudicate across kinds or touch the `question`/`category_label`
   namespaces; benchmark exact-id lookups must be unaffected.
6. Preserve the RLM queue's no-automatic-retry rule; the resolution queue
   uses the standard retrying defaults.
7. Follow the T16 observability house style for everything new; no
   high-cardinality metric labels (entity names stay in logs).
8. Keep the API and worker process split; use project-scoped Compose
   commands and never remove another stack's volumes.
9. Close of work uses a feature branch, a PR to `master`, plain engineering
   prose, and no AI attribution or generated-by trailers.
10. Finish by regenerating this file per §0 — the loop is part of acceptance.

## 8. Explicit exclusions

Do not include: automatic entity merging or canonical-node rewriting;
embedding-based candidate generation (documented follow-up); coreference/NLP
libraries; changes to `globalEntityId` or the extraction merge; RLM prompt
changes to exploit `SAME_AS` (follow-up once edges exist in production
graphs); verification-worker spot-checks of `SAME_AS` beliefs (natural later
extension of the existing sampler); benchmark corpus expansion; T13
re-hashing; whole-codebase ingestion; frontend work; Kubernetes/cloud
deployment; external observability vendors; paid benchmark runs.
