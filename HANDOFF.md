You are a principal systems engineer continuing development on Trellis Engine,
a provenance-preserving GraphRAG system (repository:
https://github.com/OpenCnid/trellis, local path `D:\trellis-engine` or the
current working directory). Trellis is an original OpenCnid project, not a
fork, and is unrelated to other projects named Trellis. The repository and its
documentation are the only sources of truth.

Sessions 1–3 are complete and merged:

- PR #21 — async reliability and batch ingestion.
- PR #22 — provenance liveness closure and verified production ingestion.
- PR #23 — deployment and CI readiness.

OpenCnid selected the MIT License on July 6, 2026.

Your objective is to study the current code and `TRELLIS_ROADMAP.md`, present a
concrete design, and then implement **Session 4: structured logging and basic
metrics (T16)**. Do not re-plan or re-implement the completed correctness,
document-update, verification, or deployment work.

Session 4 must end with green offline tests, deterministic zero-LLM live
coverage, current operations/API documentation, a full-dated roadmap progress
entry, and a mergeable PR to `master`.

---

## 1. Architectural mental model

Trellis's core invariant is that every semantic fact remains traceable to an
immutable, content-addressed physical location in source material.

1. **PostgreSQL + pgvector — physical layer**
   - `ast_nodes` stores immutable Merkle AST nodes and optional embeddings.
   - `documents` stores stable document keys and version history.
   - `document_nodes` stores per-root membership and supports global source
     liveness checks.
2. **Neo4j — semantic and belief layer**
   - `Entity` and `Conflict` nodes plus `ACTION`, `CONTRADICTS`,
     `DERIVED_INSIGHT`, and conflict-link edges.
   - Semantic nodes and edges carry `sourceNodeIds`.
   - `contested`, `contestedAt`, `contestedReason`,
     `orphanedSourceIds`, and `rederivedAt` form an audit-preserving
     quarantine/recovery state machine.
   - Flywheel beliefs also carry confidence, rubric version, and verification
     state.
3. **Redis + BullMQ — asynchronous layer**
   - `extraction_queue`, `rlm_queue`, `supervisor_queue`,
     `invalidation_queue`, and `verification_queue`.
   - Redis pub/sub streams Python RLM stdout/stderr to SSE clients.

`POST /ingest` parses Markdown/PDF into a Merkle AST, bulk-persists it, reads it
back and re-derives every hash inside the transaction, registers document
membership/version state, computes a Merkle diff, queues extraction only for
new block hashes, and queues invalidation for hashes removed from that
document. The invalidation worker filters those candidates against every
document's latest version before quarantining graph facts.

Extraction has an early liveness gate plus pre/post-merge fencing and
compensating quarantine. PostgreSQL and Neo4j do not share a transaction, so
atomic visibility during the short merge/post-check interval is not claimed;
the settled state cannot remain trusted with dead provenance.

The RLM sandbox uses server-enforced read-only Neo4j sessions for arbitrary
Cypher and one explicit provenance-required write path. The verification
worker independently rechecks sampled cached beliefs, accrues trust on
agreement, and reuses the quarantine path on disagreement.

The backend and workers run as **separate Node processes/containers**. This is
load-bearing for the Session 4 metrics design: one process-local registry
cannot describe both processes.

## 2. Current baseline

Repository state at handoff creation:

- `master` merge commit: `f23c6c6` (PR #23).
- Offline baseline: `npm test` = **170 passing across 22 files**.
- `npm run build` passes.
- CI uses Node.js 22 and runs offline tests/build/Python checks, image build,
  and an isolated Compose zero-LLM integration.
- The backend image is compiled, non-root, and contains production Node and
  pinned Python dependencies.
- Compose uses project-scoped names/volumes, dependency health checks, schema
  bootstrap, split API/workers, and a liveness-only `/healthz`.

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

## 3. Session 4 problem statement

Operational code still mixes human-formatted `console.log/error` messages with
a small number of machine-readable JSON warnings. There is no unified logger,
stable field contract, log-level configuration, or metrics surface. Operators
cannot directly answer:

- Which request/version produced a failed or dropped job?
- What are failure and retry rates per worker?
- How many actions were unresolved or dropped?
- What is each queue's waiting/active/delayed/failed depth?
- How many LLM calls and tokens were spent by extraction, supervision,
  verification, embeddings, and RLM execution?
- How many facts were quarantined, retained through global liveness, disputed,
  recovered, or verified?

`docs/operations/RUNBOOK.md` documents the current manual fallback, but T16
should make these signals directly observable.

## 4. Required design

Present the exact design after inspecting the files below, then implement it.
The following is the recommended architecture; deviations require a concrete
reason and equivalent tests.

### 4.1 Structured logging

- Add a side-effect-free observability module, preferably under
  `src/core/observability/`, backed by `pino` or an equivalently small
  structured logger.
- Production logs are one JSON object per line on stdout/stderr.
- Support a validated `LOG_LEVEL` configuration value. Configuration still
  crosses TypeScript only through `src/config/index.ts`.
- Create child loggers/bindings rather than manually interpolating prefixes.
  Stable correlation fields should include, when applicable:
  - `service`
  - `worker`
  - `queue`
  - `jobId`
  - `attempt`
  - `requestId`
  - `docKey`
  - `version`
  - `astNodeId`
  - `event`
- Convert operational code under `src/api`, `src/workers`, `src/config`, and
  `src/core/runtime`. Preserve existing event names that tests, scripts, or
  operators may consume.
- Benchmark runners and human-facing maintenance CLIs may keep formatted
  console output. Do not turn tables/progress displays into JSON without an
  operational reason.
- Never log request bodies, source document text, API keys, passwords, DSNs,
  full embeddings, raw LLM prompts/responses, or SSE query content.
- Errors must retain useful type/message/stack information without leaking
  secrets.

### 4.2 Metrics

Use Prometheus-compatible metric names and `prom-client` unless inspection
finds a better repository-native choice.

Recommended process topology:

- The API exposes an authenticated `GET /metrics` from its own registry.
- The worker process exposes a separate internal metrics HTTP listener
  (recommended default port `9464`) because workers run in another container.
- Do not publish the worker metrics port to the host by default. Compose may
  expose it only to the internal network for a future scraper.
- Keep `/healthz` liveness-only.
- If a single aggregated endpoint is chosen instead, define counter
  persistence/reset and multi-replica semantics explicitly; do not smuggle
  custom aggregation through Redis without tests.

At minimum instrument:

- API request count and duration by method/route/status class.
- BullMQ job started/completed/failed/retried/unrecoverable by worker/queue.
- Extraction unresolved endpoints and dropped actions.
- Invalidation candidates, globally retained hashes, contested nodes/edges,
  compensated races, and batches.
- Verification classified/agreed/disputed/skipped results.
- LLM calls, input tokens, output tokens, and embedding tokens where the SDK
  reports them, labeled by operation/model rather than prompt or document.
- RLM input/output tokens, subcalls, tool calls, duration, and exit status by
  parsing the existing `TRELLIS_TELEMETRY:` line.
- Queue waiting/active/delayed/failed counts for all five queues.

Avoid high-cardinality metric labels. Job IDs, request IDs, document keys, AST
hashes, entity names, and error messages belong in logs, never metric labels.

### 4.3 RLM telemetry boundary

`src/rlm/trellis_agent.py` already emits one machine-readable
`TRELLIS_TELEMETRY: {...}` line. Parse it in `rlm_worker.ts` while preserving
the existing Redis/SSE byte stream.

stdout chunks do not align with lines. Implement a bounded line buffer and
test split records, multiple records per chunk, malformed payloads, and final
partial lines. A malformed telemetry line must emit a structured warning but
must not corrupt the client stream or silently turn a successful RLM answer
into failure.

## 5. File-level starting points

Inspect before editing:

- `TRELLIS_ROADMAP.md`, especially §2.2, §3, and §5.
- `.agents/AGENT_CODING_GUIDELINES.md`.
- `src/api/server.ts`, `auth.ts`, and `health.ts`.
- Every file under `src/workers/`.
- `src/workers/queue.ts`, `job_options.ts`.
- `src/core/async/retry.ts`.
- `src/core/runtime/shutdown.ts` and `database_init.ts`.
- `src/core/graph/verification.ts`, `invalidation.ts`, and extraction modules.
- `src/rlm/trellis_agent.py` and `trellis_tools.py`.
- `src/config/index.ts`, `.env.example`, Dockerfile, Compose, CI.
- `docs/operations/RUNBOOK.md` and `API_REFERENCE.md`.

Prefer pure helpers and dependency injection so logger/metric behavior is
offline-testable without importing worker modules that immediately open
database or Redis connections.

## 6. Test strategy and acceptance

Test first. No paid LLM calls are permitted for Session 4 verification.

Offline tests should cover:

- structured log shape, level filtering, child bindings, and error
  serialization;
- request route normalization so entity names/query strings never become
  metric labels;
- counter increments for completed, failed, retryable, and unrecoverable job
  outcomes;
- queue gauge collection, including Redis/BullMQ read failure behavior;
- LLM usage extraction when usage exists or is absent;
- RLM telemetry line buffering/parsing and malformed records;
- metrics exposition without duplicate-registration failures;
- shutdown of any metrics listener/timer in the existing phase order.

Live/Compose coverage should prove:

- API metrics authentication and content type;
- worker metrics are reachable only on the intended internal path;
- a deterministic zero-LLM ingest updates API/queue metrics;
- existing `/healthz` behavior is unchanged;
- logs remain parseable JSON during startup, request handling, and shutdown.

Required close-out:

```bash
npm test
npm run build
npm run python:check
docker compose --profile test config --quiet
# Run the isolated zero-LLM Compose integration.
npm run test:api-hardening
npm run test:rlm-sandbox
git diff --check
```

The baseline is 170 tests and may only increase.

Update:

- `.env.example` and README for new configuration.
- `API_REFERENCE.md` for metrics endpoints/authentication.
- `docs/operations/RUNBOOK.md` with real metric names and diagnostic queries.
- `TRELLIS_ROADMAP.md`: mark T16 and 3.2 #9 complete only after acceptance,
  and add a full-dated §5 progress entry with exact checks/counts.

## 7. Guardrails

1. Never mutate an AST. T13's current hash preimage is pinned; changing it
   requires a re-hash migration and is outside Session 4.
2. Preserve provenance on every semantic node and edge.
3. Validate every LLM response at the existing Zod boundary.
4. All LLM calls remain inside BullMQ workers.
5. Preserve the RLM queue's no-automatic-retry rule.
6. Do not introduce high-cardinality metrics.
7. Do not expose secrets or source text through logs or metrics.
8. Keep the API and worker process split.
9. Use project-scoped Compose commands; never remove another stack's volumes.
10. Close of work uses a feature branch, a PR to `master`, plain engineering
    prose, and no AI attribution or generated-by trailers.

## 8. Explicit exclusions

Do not include T13 re-hashing, entity resolution/SAME_AS, benchmark corpus
expansion, whole-codebase ingestion, frontend containerization, Kubernetes,
cloud deployment, external observability vendors, tracing, or paid benchmark
runs. OpenTelemetry/vendor exporters can follow once the stable local
log/metric contract exists.
