You are a principal systems engineer continuing development on Trellis Engine,
a provenance-preserving GraphRAG system (repository:
https://github.com/OpenCnid/trellis, local path `D:\trellis-engine` or the
current working directory). Trellis is an original OpenCnid project, not a
fork, and is unrelated to other projects named Trellis. The repository and its
documentation are the only sources of truth.

Sessions 1–10 are complete and merged:

- PR #21 — async reliability and batch ingestion.
- PR #22 — provenance liveness closure and verified production ingestion.
- PR #23 — deployment and CI readiness.
- PR #25 — structured logging and Prometheus metrics (T16).
- PR #27 — entity resolution beyond exact-name identity (`SAME_AS` overlay
  beliefs, Session 5).
- PR #28 — benchmark maturity (anti-shortcut dataset v2 + first-class
  cache-audit metric, Session 6).
- PR #29 — semantic-provenance scale evidence (Session 7): the migration
  gate closed at 286 maximum sources; no `ASTRef` migration shipped.
- PRs #30/#31 — whole-codebase ingestion (Session 8): verified ingest
  service, code-aware TS/JS/Python ASTs, durable snapshots with tombstone
  deletion, `repo:ingest` CLI with a zero-paid-work default, the measured
  `Entity.name` merge index, and the recorded extraction-pilot findings.
- PR #33 — the agentic orchestration loop (Session 9, 3.3 #7):
  `GET /api/agent-stream` + `agent_queue`/`agent_worker.ts` run an
  orchestrator (same LLM, planner system prompt, Zod-validated decisions
  through the T8 boundary — never an rlms REPL) that dispatches the RLM
  as a reusable single-task sub-agent over ordinary `rlm_queue` jobs,
  reads their `TRELLIS_RESULT` envelopes, and iterates under hard
  per-goal bounds. Zero-LLM acceptance via oracle scripts + stubbed
  tasks (`npm run test:agent-loop`).
- Session 10 (July 7, 2026) — the MCP tool surface for the RLM sub-agent
  (3.3 #8 first slice, branch `session-10-mcp-tools`): an
  operator-configured stdio MCP client (`TRELLIS_MCP_SERVERS` →
  `src/config/mcp_servers.ts` → `src/rlm/trellis_mcp.py`, injected as
  `trellis_mcp` via rlms `custom_tools`) with allowlist-before-I/O
  enforcement, per-call timeouts, size-capped results, a separate
  `mcp_calls` telemetry counter that never satisfies the
  database-provenance requirement, and zero-paid acceptance against a
  local deterministic fixture server (`npm run test:rlm-mcp`).

OpenCnid selected the MIT License on July 6, 2026.

Your objective is to study the current code and `TRELLIS_ROADMAP.md`, present a
concrete design, and then implement **Session 11: the 3.3 #8 continuation,
first A2A slice — expose Trellis as an A2A (Agent2Agent protocol) server over
the existing agentic goal loop**, so external agents can dispatch goals to
Trellis through a standard interoperability surface without weakening the
admission gates, per-goal bounds, provenance invariants, or the zero-paid
acceptance posture. Further MCP tool-surface expansion (remote/HTTP
transports, containerized tool servers) is the recorded following slice —
not this session unless the owner redirects. Do not re-plan or re-implement
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
   - `documents`/`document_nodes` store stable document keys, version
     history, and per-root membership (global source liveness checks).
   - `repository_snapshots`/`repository_snapshot_paths` (Session 8) record
     which paths each published repository snapshot contained.
   - The verified ingest transaction lives in `src/core/ingestion/`
     (`ingest_document.ts`: persist → read-back re-hash verification →
     membership → registration → in-transaction Merkle diff;
     `plan_ingest.ts`: explicit `none`/`changed` extraction policy with a
     hard block budget). `POST /ingest` is a thin delegate; tombstones are
     ordinary ingests of a deterministic empty root. Schema bootstrap is
     serialized by `pg_advisory_xact_lock`; Neo4j bootstrap retries
     transient label-lock deadlocks and creates `entity_name_index`.
2. **Neo4j — semantic and belief layer**
   - `Entity` and `Conflict` nodes plus `ACTION`, `CONTRADICTS`,
     `DERIVED_INSIGHT`, `SAME_AS`/`DISTINCT_FROM` edges, all carrying
     `sourceNodeIds`. `contested`/`contestedAt`/`orphanedSourceIds`/
     `rederivedAt` form the audit-preserving quarantine/recovery state
     machine (`src/core/graph/provenance.ts`).
   - Entity identity is immutable; equivalence is an overlay belief.
     Retrieval expands one trusted `SAME_AS` hop with per-fact `viaAlias`.
3. **Redis + BullMQ — asynchronous layer**
   - Seven queues: `extraction_queue`, `rlm_queue`, `supervisor_queue`,
     `invalidation_queue`, `verification_queue`, `resolution_queue`, and
     `agent_queue`. `rlm_queue` and `agent_queue` use interactive no-retry
     job options (an interrupted paid run must not silently re-spend); the
     rest use bounded retries. All LLM calls live inside BullMQ workers or
     the RLM process; every worker-consumed completion crosses
     `parseLlmResponse` (`src/core/llm/boundary.ts`).
4. **RLM execution, the agentic loop, and external tools**
   - `GET /api/rlm-stream` (API-key gated, `StreamGate` + queue-depth
     backstop) subscribes to `rlm-stream:<jobId>`, then enqueues one
     `rlm_queue` job. `src/workers/rlm_worker.ts` spawns one Python process
     per job (`trellis_agent.py`) with config forwarded via env by the pure
     `buildAgentEnv` helper in `src/workers/rlm_job.ts` (`NEO4J_*`,
     `PG_DSN`, `PYTHONPATH`, and — Session 10 — the canonical
     `TRELLIS_MCP_SERVERS` registry; when no servers are configured the
     helper strips any raw inherited value so the child only ever sees
     validated config). The worker publishes every stdout chunk and feeds
     two pure bounded scanners over the identical bytes:
     `RlmTelemetryScanner` (`TRELLIS_TELEMETRY:` spend line — since
     Session 10 carrying `mcp_calls`, backward-compatible in both
     directions) and `RlmResultScanner` (`TRELLIS_RESULT:` task envelope
     `{status, answer, toolCalls}`; shared buffering in
     `line_scanner.ts`). The worker's completion value is the parsed
     envelope + telemetry (`RlmJobCompletion`). Job payloads are
     normalized by `parseRlmJobData`: pre-Session-9 `{query, jobId}` still
     processes; optional `goalId`/`taskId` correlation, `maxIterations`
     (forwarded as `--max-iterations`), and a data-only `stub` replay mode
     for zero-LLM drills. Payloads carry nothing MCP-shaped (unit-pinned).
   - `src/rlm/trellis_agent.py` wraps the `rlms` recursive-LM library
     (model `gpt-5.4-2026-03-05`, `max_depth` 1) and injects tools via the
     rlms `custom_tools` mapping — `trellis_neo4j` (read-only Cypher via
     `default_access_mode=READ`, plus the single write path
     `write_derived_insight`/`write_derived_insights`, which REQUIRES
     non-empty `sourceNodeIds` AST hashes), `trellis_postgres`
     (`get_ast_texts`, `vector_search`), and — Session 10, only when the
     operator configured servers — `trellis_mcp`
     (`src/rlm/trellis_mcp.py`): a stdio MCP client over the pinned
     `mcp==1.12.4` SDK. Each configured server is spawned from an explicit
     argument vector as a child of the RLM process, handshaken once inside
     a long-lived asyncio task on a background loop thread (anyio cancel
     scopes are task-bound), and closed in the agent's `finally`.
     `call_tool(server, tool, arguments)` enforces the operator allowlist
     BEFORE any I/O, bounds every call (SDK `read_timeout_seconds` plus a
     sync-side backstop so the REPL thread can never hang), and truncates
     oversized results with an explicit `TRELLIS_MCP_TRUNCATED` marker.
     Wrapper discipline everywhere: JSON STRING returns; errors RAISE with
     real messages for REPL self-correction. PROVENANCE SPLIT: database
     tools increment `_count_tool_call()`; MCP calls increment their own
     counter reported as `mcp_calls` — an answer with zero DATABASE tool
     calls emits `TRELLIS_PROTOCOL_VIOLATION` no matter how many MCP
     calls happened. The prompt addendum generated from the config
     (`build_mcp_addendum`) is empty for an empty registry (byte-identical
     prompt, unit- and live-pinned) and states the contract: MCP results
     are research context, never `sourceNodeIds`.
   - CRITICAL rlms constraint: `custom_system_prompt` REPLACES the base
     REPL protocol prompt. Trellis EXTENDS `RLM_SYSTEM_PROMPT` via
     `TRELLIS_ADDENDUM` (plus the MCP addendum), and rlms runs `.format()`
     over the prompt so literal curly braces are forbidden there (escape
     by doubling — see `_SAFE_RUBRIC`; the MCP name charset
     `^[a-z][a-z0-9_-]*$` makes generated tool listings structurally
     brace-free).
   - The orchestrator (Session 9) lives in `src/core/agent/` and is a
     pure decision maker: `OrchestratorDecisionSchema` through
     `parseLlmResponse`, planner prompt never routed through rlms,
     dependency-injected `runGoalLoop` with typed failures
     (`iteration_bound`/`task_bound`/`concurrency_bound`/`decision_error`/
     `orchestrator_fail`), `agent_worker.ts` + `GET /api/agent-stream`
     with hard per-goal bounds (`AGENT_*`, single-digit-capped) and its
     own admission gate (`StreamGate` + `AGENT_QUEUE_MAX_DEPTH` → 429).
     The orchestrator has NO tools and no database access — tools belong
     to the RLM sub-agent; that split is deliberate and stays. Zero-LLM
     drills: `AGENT_ORACLE_ENABLED=true` accepts an `oracle` script
     (scripted decisions + stubbed tasks) — `npm run test:agent-loop`.
     THIS SESSION builds on this loop: A2A is a new inbound surface that
     dispatches the same goals through the same queue, gates, and bounds.
5. **Observability and process boundaries**
   - `src/core/observability/` defines pino JSON logging and per-process
     Prometheus registries; API and workers are separate processes/
     containers. Stable dot-namespaced events; bounded metric labels only —
     queries, goals, paths, hashes, entity names, tool arguments, and tool
     results never become label values or log content. Queue-depth gauges
     cover all seven queues; `trellis_rlm_mcp_calls_total` is label-free
     with a counts-only `rlm.mcp` event.
6. **Other subsystems (stable, not this session's subject)**
   - Whole-codebase ingestion: `src/core/repository/`, `npm run
     repo:ingest`, live drill `npm run test:repo-ingest`.
   - Benchmarks: OOLONG v1 saturated baseline; anti-shortcut v2 at
     `data/oolong_pairs_dataset_hard.json`; scale evidence in
     `docs/benchmarks/SCALE_PROVENANCE_REPORT.md` and
     `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md`.
   - The fixture MCP server (`scripts/fixture_mcp_server.py`) is the only
     MCP server acceptance ever configures; real web-search servers are
     owner-approved runs with the allowlist printed and `mcp_calls`
     recorded.
   - Frontend: Next.js 16 app in `src/frontend/` with a dev-only proxy —
     deployment deferred by owner redirects (sequencing row 3).

## 2. Current baseline

Repository state at handoff creation:

- `master`: the Session 10 PR merge (branch `session-10-mcp-tools`; use
  `git log -- HANDOFF.md` to identify it).
- Offline baseline: `npm test` = 419 passing across 53 files.
- `npm run build` and `npm run python:check` pass (the Python check now
  imports `mcp` and compiles `trellis_mcp.py` + the fixture server).
- `npm run drill:scale`: gate CLOSED at max provenance 286; sweep growth
  1.99x against 5.77x fact growth.
- Live zero-LLM checks: `test:rlm-mcp` (46), `test:agent-loop` (23, green
  with `TRELLIS_MCP_SERVERS` both set and unset), `test:repo-ingest` (45),
  `test:benchmark-hardening` (24), `test:entity-resolution` (33),
  `test:api-hardening` (18), `test:rlm-sandbox` (4),
  `test:belief-recovery` (30), `test:invalidation-sweep` (17).
- Isolated Compose integration: 9 assertions (`--profile test`; the image
  installs `mcp==1.12.4`).
- CI target is Node 22. Session 10's local environment was Node 20.19.2,
  PostgreSQL 16.14, Neo4j 5.11.0, Python 3.13.1, Docker Compose v2.
- Python runtime deps are pinned in `requirements.txt` (`rlms==0.1.3`,
  `openai`, `neo4j`, `psycopg2-binary`, `unstructured`, `mcp`);
  `npm run python:check` verifies syntax/imports/assets.

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

## 3. Session 11 problem statement

Trellis can pursue goals and consult external tools, but nothing external
can dispatch a goal to Trellis except a bespoke SSE client.

- **The goal loop has one inbound surface.** `GET /api/agent-stream`
  (`src/api/server.ts`) is a Trellis-specific SSE contract: query-param
  goal, custom event names (`goal_started`, `decision`, `task_started`,
  `task_result`, `goal_completed`/`goal_failed`), API-key auth. An
  external agent framework cannot discover it, negotiate with it, or
  consume it without hand-written glue.
- **A2A is the standard for exactly this.** The Agent2Agent protocol
  (Linux Foundation) defines an Agent Card for discovery, JSON-RPC 2.0
  methods (message send/stream, task get/cancel), a task lifecycle state
  vocabulary, and SSE streaming — an interoperability wrapper whose
  semantics map almost one-to-one onto what the goal loop already does:
  a goal is a task, goal events are status updates, the final answer is
  an artifact, a typed failure is a failed task with a reason. The owner
  direction (roadmap 3.3 #8, sequencing row 1) names A2A as the
  continuation of the external-tools work.
- **The plumbing to reuse is proven.** `agent_worker.ts` + `agent_queue`
  + the `agent-stream:<goalId>` pub/sub channel already execute goals
  with hard bounds and typed failures; the API layer already has the
  admission pattern (`StreamGate` + queue-depth backstop → 429), API-key
  middleware, and subscribe-then-enqueue ordering. A2A must be a thin
  adapter over these — a second door into the same room, never a bypass.
- **Verify the protocol against its current spec before designing wire
  shapes.** A2A has evolved since its 2025 announcement (well-known
  agent-card path, method names, task-state vocabulary). Session 11 must
  read the spec version it builds against and record it in the roadmap
  entry; do not build from memory. Evaluate the official Node SDK
  (`@a2a-js/sdk`) versus a minimal hand-rolled JSON-RPC subset validated
  with Zod — prefer whichever keeps the surface small, dependency-light,
  and fully Zod-validated at the boundary (the T8 discipline applies to
  inbound protocol payloads exactly as it does to LLM output).
- **Acceptance must stay zero-paid.** The oracle/stub machinery
  (`AGENT_ORACLE_ENABLED`, scripted decisions, stubbed RLM tasks) already
  drives the full goal loop with zero LLM calls. The A2A drill dispatches
  oracle goals through the real A2A surface and asserts the protocol
  responses — no paid work, no external network.

Session 11 gives Trellis a standards-compliant inbound agent surface over
the existing loop, leaving every bound, gate, and invariant in place.

## 4. Required design

Present the exact design after inspecting §5 (including the current A2A
spec and SDK versions), then implement it. Deviations require a concrete
reason and equivalent tests.

### 4.1 A2A server surface (API process)

- New modules (suggested `src/api/a2a.ts` for the Express mounting plus
  `src/core/a2a/` for pure helpers): an A2A endpoint set on the existing
  API process and port, gated by the same API-key middleware (declare the
  scheme in the Agent Card). Zod schemas for every inbound JSON-RPC
  envelope and method params; malformed requests get proper JSON-RPC
  error responses, never stack traces.
- Agent Card served at the spec's well-known path: operator-configured
  name/description/URL via validated config, one skill (goal execution),
  streaming capability declared. The card must never leak secrets,
  internal hosts, or values that are not already public contract.
- Method mapping: message send → enqueue a goal (subscribe-then-enqueue
  on the existing `agent-stream:<goalId>` channel) and return the task
  per spec; message stream → SSE of A2A task-status/artifact events
  translated from the goal events; task get → current state from a
  bounded Redis-backed task record (TTL — the queue-retention idiom);
  task cancel → decline as unsupported (the goal loop has no abort path;
  do not invent one this session).
- State translation is a pure function (goal lifecycle → A2A task
  states; final answer → one text artifact; typed failures → failed
  state with the typed reason). Unit-test it exhaustively.

### 4.2 Admission and bounds

- A2A dispatch flows through the SAME gates as `/api/agent-stream`: the
  goal `StreamGate` concurrency cap, `AGENT_QUEUE_MAX_DEPTH` backstop,
  and all per-goal bounds. Over-limit A2A requests get the spec's error
  mapping of the 429 semantics; the bounds stay config-owned. No A2A
  parameter may raise a bound, name a tool, or reach the RLM/MCP layer;
  the goal text is the only payload that crosses into the loop.

### 4.3 Configuration

- `TRELLIS_A2A_ENABLED` (default `false` — the surface does not exist
  unless the operator turns it on) plus the minimal card fields, all
  Zod-validated in `src/config/index.ts` following the Session 10
  `TRELLIS_MCP_SERVERS` discipline. With it off, the API is
  byte-identical to today (pinned by test).

### 4.4 Observability

- T16 house style: an `a2a.*` event family (request received, task state
  transitions — ids and states only, never goal text or message
  content), bounded counters (e.g. `trellis_a2a_requests_total{method}`
  with the method enum as the only label; task outcomes reusing the
  agent outcome vocabulary). Goal text, messages, and artifacts never
  reach labels or logs.

### 4.5 Zero-paid acceptance

- New `npm run test:a2a`: a fixture A2A client (plain Node HTTP against
  the real server, or the adopted SDK's client) that fetches the Agent
  Card, dispatches oracle goals via send and stream, polls task state,
  asserts the state translation for success, failure, and bound-tripped
  goals, and exercises the disabled-by-default posture, auth rejection,
  malformed JSON-RPC rejection, and admission-gate saturation — all
  against oracle decisions and stubbed tasks, zero LLM calls, zero
  external network.

## 5. File-level starting points

Inspect before editing:

- `TRELLIS_ROADMAP.md` §3.3 #8, §4, and the Session 9/10 §5 entries;
  `.agents/AGENT_CODING_GUIDELINES.md`.
- The current A2A specification and SDK state (record adopted versions):
  the a2a-project spec and `@a2a-js/sdk`. Pin what you adopt; validate
  everything you expose regardless.
- `src/api/server.ts` — the `/api/agent-stream` handler: API-key
  middleware, `StreamGate`, queue-depth backstop, subscribe-then-enqueue,
  SSE frame shapes; this is the pattern (and the plumbing) A2A adapts.
- `src/core/agent/goal_loop.ts` + `src/workers/agent_worker.ts` — the
  goal event vocabulary on `agent-stream:<goalId>` and the terminal
  event shapes the A2A translation consumes; `src/workers/agent_job.ts`
  for the goal payload contract (oracle threading included).
- `scripts/test_agent_loop.ts` — the zero-LLM drill harness this
  session's `test:a2a` mirrors (server spawn with env overrides, oracle
  scripts, stubbed tasks, metrics scrape assertions).
- `src/config/index.ts` + `src/config/mcp_servers.ts` — the validated
  config discipline (Session 10's registry is the closest precedent for
  an operator-owned feature toggle with structured fields);
  `src/config/agent_bounds.test.ts` + `src/config/mcp_servers.test.ts`
  for the reset-modules test pattern.
- `src/core/observability/metrics.ts` and `metrics.test.ts` — where the
  `a2a` counters and their label pins land.

Prefer pure helpers for the state translation, card construction, and
JSON-RPC envelope validation; keep Express handlers thin delegates.

## 6. Test strategy and acceptance

Test first. No paid LLM calls and no external network access are permitted
for Session 11 acceptance.

Offline tests must cover:

- Zod validation of the A2A config (disabled default, card fields,
  rejection cases) via the reset-modules pattern;
- JSON-RPC envelope/method-param validation: valid requests for every
  supported method, malformed envelope, unknown method, wrong params —
  each mapped to the correct JSON-RPC error code;
- the pure goal→A2A state translation: every goal lifecycle path
  (completed, every typed failure, every bound trip) to the correct task
  state/artifact/reason, exhaustively;
- Agent Card construction: well-known shape, and no secret leakage —
  assert the serialized card contains no API key, internal ports, or
  non-public values;
- metric label pins for the new counters.

Live zero-LLM coverage (local stack; oracle + stubs only):

- new `npm run test:a2a` per §4.5, including: card fetch; a send-mode
  goal completing with the oracle answer as an artifact; a stream-mode
  goal observed through its A2A status events; task-state polling before
  and after completion; a bound-tripped oracle goal surfacing as a failed
  task with the typed reason; auth rejection without the key; malformed
  JSON-RPC rejected with proper error responses; the surface absent when
  `TRELLIS_A2A_ENABLED` is unset; admission-gate saturation behaving per
  the spec mapping;
- regression: `test:agent-loop` unchanged and green (the SSE surface and
  oracle gating must be untouched);
- all existing live suites stay green: `test:rlm-mcp`,
  `test:agent-loop`, `test:repo-ingest`, `test:benchmark-hardening`,
  `test:entity-resolution`, `test:api-hardening`, `test:rlm-sandbox`,
  `test:belief-recovery`, `test:invalidation-sweep`; `drill:scale` still
  closes its gate.

Required close-out:

```
 npm test
 npm run build
 npm run python:check
 docker compose --profile test config --quiet
 # Run the isolated zero-LLM Compose integration.
 # Run the new zero-LLM A2A live suite (oracle goals + stubbed tasks).
 npm run test:a2a
 npm run test:rlm-mcp
 npm run test:agent-loop
 npm run drill:scale
 npm run test:repo-ingest
 npm run test:benchmark-hardening
 npm run test:entity-resolution
 npm run test:api-hardening
 npm run test:rlm-sandbox
 npm run test:belief-recovery
 npm run test:invalidation-sweep
 git diff --check
```

Update:

- README (an "Agent interoperability (A2A)" section: enablement, card
  discovery, method surface, bounds inheritance, zero-paid drill),
  `API_REFERENCE.md` (a new section for the A2A surface), the runbook
  (new env, metrics, events, and an "external agent misbehaving"
  diagnostic), and dependency manifests if an SDK is adopted.
- `TRELLIS_ROADMAP.md`: record the A2A slice under 3.3 #8 only after
  acceptance (the item stays open for MCP transport expansion); add a
  full-dated §5 entry with exact commands/counts, the pinned A2A
  spec/SDK versions, and any defects found.
- `HANDOFF.md`: regenerate for the next objective per §0 — the next
  unstruck sequencing rows are the remaining 3.3 #8 continuation (MCP
  tool-surface expansion: remote/HTTP transports with their auth story,
  containerized tool servers) and then the frontend remainder (3.3 #5),
  unless something discovered this session should jump the queue.

## 7. Guardrails

1. Never mutate an AST. The T13 hash preimage is pinned; `rederiveAstNodeId`
   stays authoritative; nothing positional is ever persisted as identity.
2. Never merge, rename, or delete Entity nodes. Equivalence stays an overlay
   belief; semantic identity and `SAME_AS` behavior stay pinned.
3. Preserve provenance on every semantic node and edge.
   `write_derived_insight` remains the single agent write path, still
   requiring live AST provenance. MCP output is research context and can
   never be passed as `sourceNodeIds`; external content earns citability
   only through the verified ingest path. Nothing arriving over A2A
   touches either database directly — an A2A message is only ever a goal
   handed to the existing loop.
4. MCP calls never satisfy the database-provenance requirement:
   `_count_tool_call()` counts database tools only, and
   `TRELLIS_PROTOCOL_VIOLATION` semantics are unchanged. A run that only
   searched the web is still provenance-free.
5. Operator control is absolute: the A2A surface is off by default and
   configured only through validated env; MCP servers, commands,
   transports, tool allowlists, timeouts, and size caps come from
   `TRELLIS_MCP_SERVERS` only. No inbound A2A payload, queue payload, or
   model completion may name a server or tool, raise a bound, or alter
   admission behavior. Argument vectors, never shell strings.
6. Every external interaction is bounded: A2A goals inherit every
   `AGENT_*` bound and admission gate (the spec's mapping of the 429
   semantics); MCP calls keep their per-call timeout and size cap; A2A
   task records in Redis carry a TTL. A misbehaving external agent must
   degrade to protocol errors, never resource exhaustion.
7. Validate at every boundary: inbound A2A JSON-RPC crosses Zod schemas
   exactly as LLM output crosses `parseLlmResponse`; all LLM calls remain
   inside BullMQ workers or the RLM process; the orchestrator stays
   tool-free; the `AGENT_ORACLE_ENABLED=false` and
   `TRELLIS_A2A_ENABLED=false` defaults stay pinned.
8. Default to zero paid work and zero external network in acceptance:
   oracle decisions + stubbed tasks drive the A2A drill; the fixture MCP
   server remains the only MCP server acceptance configures. Real
   external-agent or web-search runs are owner-approved, with the
   configured surface printed first and observed spend recorded.
9. Do not break existing consumers: the `/api/agent-stream` SSE contract,
   `FINAL_ANSWER:`/`TRELLIS_TELEMETRY:`/`TRELLIS_RESULT:` parsing
   (telemetry stays backward-compatible in both directions),
   pre-Session-9 `rlm_queue` payloads, empty-config byte-identical RLM
   behavior, and the disabled-by-default byte-identical API surface.
10. Respect the rlms prompt contract: extend `RLM_SYSTEM_PROMPT`, never
    replace it; no literal curly braces in anything rlms formats (double
    them); the orchestrator persona stays plain chat completions.
11. Follow the T16 observability house style. Queries, goals, message
    content, artifacts, tool arguments, results, server commands, paths,
    hashes, and entity names never become metric label values or log
    content.
12. Keep API and worker processes split; use project-scoped Compose
    commands; never remove another stack's volumes; fixtures and drills
    clean up only token-scoped or pre-snapshotted state.
13. Ship one feature branch and one PR to `master`, plain engineering
    prose, with no AI attribution or generated-by trailers. Regenerate this
    file in the same PR.

## 8. Explicit exclusions

Do not include: Trellis as an A2A *client* (calling other agents — a
later slice; the orchestrator stays tool-free either way); A2A push
notifications/webhooks (their auth story is its own work); goal
cancellation mid-flight (the loop has no abort path; the cancel method
may decline per spec); multi-turn `input-required` interactions (goals
are one-shot); MCP transport expansion (remote/HTTP servers,
containerized tool servers — the recorded next slice); new RLM tools or
write paths; exposing MCP through A2A in any form; authentication
schemes beyond the existing API key (declare it in the card; OAuth is
follow-on); frontend work (sequencing row 3); repository-extraction
prerequisites; `ASTRef`/`EVIDENCED_BY` migration (gate closed at 286);
T13 re-hashing; rlms library modifications; paid LLM calls or external
network access as acceptance checks.
