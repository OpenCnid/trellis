You are a principal systems engineer continuing development on Trellis Engine,
a provenance-preserving GraphRAG system (repository:
https://github.com/OpenCnid/trellis, local path `D:\trellis-engine` or the
current working directory). Trellis is an original OpenCnid project, not a
fork, and is unrelated to other projects named Trellis. The repository and its
documentation are the only sources of truth.

Sessions 1–11 are complete and merged:

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
- PR #34 — the MCP tool surface for the RLM sub-agent (Session 10,
  3.3 #8 first slice): an operator-configured stdio MCP client
  (`TRELLIS_MCP_SERVERS` → `src/config/mcp_servers.ts` →
  `src/rlm/trellis_mcp.py`, injected as `trellis_mcp` via rlms
  `custom_tools`) with allowlist-before-I/O enforcement, per-call
  timeouts, size-capped results, a separate `mcp_calls` telemetry
  counter that never satisfies the database-provenance requirement, and
  zero-paid acceptance against a local deterministic fixture server
  (`npm run test:rlm-mcp`).
- Session 11 (July 7, 2026) — the A2A server surface (3.3 #8 second
  slice, branch `session-11-a2a-server`): Trellis serves the Agent2Agent
  protocol (spec v1.0.0, JSON-RPC binding, hand-rolled with Zod — the
  official `@a2a-js/sdk` 0.3.13 still speaks the 0.3.x wire format and
  was not adopted; zero new dependencies) over the existing goal loop.
  `TRELLIS_A2A_ENABLED` (default false; unset ⇒ byte-identical API,
  drill-pinned) mounts the public well-known Agent Card plus one
  key-gated JSON-RPC endpoint (`POST /a2a/v1`) whose
  `SendMessage`/`SendStreamingMessage`/`GetTask`/`CancelTask` dispatch
  goals through the SAME `StreamGate` + queue-depth gates and per-goal
  bounds as `/api/agent-stream`, record lifecycle in TTL-bounded Redis
  task records, and translate goal events to A2A task states through the
  pure `src/core/a2a/task_record.ts`. Zero-paid acceptance:
  `npm run test:a2a` (46 checks).

OpenCnid selected the MIT License on July 6, 2026.

Your objective is to study the current code and `TRELLIS_ROADMAP.md`, present a
concrete design, and then implement **Session 12: the 3.3 #8 continuation,
MCP tool-surface expansion — remote (Streamable HTTP) MCP transports with an
operator-owned auth story, plus a containerized tool-server pattern**, so the
RLM sub-agent can consult tool servers that do not live inside the worker
container, without weakening the allowlist/timeout/size-cap discipline, the
provenance split, or the zero-paid acceptance posture. The frontend
deployment remainder (3.3 #5) is the recorded following item — not this
session unless the owner redirects. Do not re-plan or re-implement completed
work.

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
4. **RLM execution, the agentic loop, and external surfaces**
   - `GET /api/rlm-stream` (API-key gated, `StreamGate` + queue-depth
     backstop) subscribes to `rlm-stream:<jobId>`, then enqueues one
     `rlm_queue` job. `src/workers/rlm_worker.ts` spawns one Python process
     per job (`trellis_agent.py`) with config forwarded via env by the pure
     `buildAgentEnv` helper in `src/workers/rlm_job.ts` (`NEO4J_*`,
     `PG_DSN`, `PYTHONPATH`, and the canonical `TRELLIS_MCP_SERVERS`
     registry; when no servers are configured the helper strips any raw
     inherited value so the child only ever sees validated config). The
     worker publishes every stdout chunk and feeds two pure bounded
     scanners over the identical bytes: `RlmTelemetryScanner`
     (`TRELLIS_TELEMETRY:` spend line, carrying `mcp_calls` since
     Session 10, backward-compatible in both directions) and
     `RlmResultScanner` (`TRELLIS_RESULT:` task envelope
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
     (`get_ast_texts`, `vector_search`), and — only when the operator
     configured servers — `trellis_mcp` (`src/rlm/trellis_mcp.py`): a
     stdio MCP client over the pinned `mcp==1.12.4` SDK. Each configured
     server is spawned from an explicit argument vector as a child of the
     RLM process, handshaken once inside a long-lived asyncio task on a
     background loop thread (anyio cancel scopes are task-bound), and
     closed in the agent's `finally`. `call_tool(server, tool, arguments)`
     enforces the operator allowlist BEFORE any I/O, bounds every call
     (SDK `read_timeout_seconds` plus a sync-side backstop so the REPL
     thread can never hang), and truncates oversized results with an
     explicit `TRELLIS_MCP_TRUNCATED` marker. Wrapper discipline
     everywhere: JSON STRING returns; errors RAISE with real messages for
     REPL self-correction. PROVENANCE SPLIT: database tools increment
     `_count_tool_call()`; MCP calls increment their own counter reported
     as `mcp_calls` — an answer with zero DATABASE tool calls emits
     `TRELLIS_PROTOCOL_VIOLATION` no matter how many MCP calls happened.
     The prompt addendum generated from the config (`build_mcp_addendum`)
     is empty for an empty registry (byte-identical prompt, unit- and
     live-pinned) and states the contract: MCP results are research
     context, never `sourceNodeIds`. THIS SESSION extends this client:
     the registry gains a remote transport variant, and the same
     allowlist/timeout/cap machinery must hold for servers reached over
     HTTP.
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
     to the RLM sub-agent; that split is deliberate and stays.
     Zero-LLM drills: `AGENT_ORACLE_ENABLED=true` accepts an `oracle`
     script (scripted decisions + stubbed tasks) —
     `npm run test:agent-loop`.
   - **The A2A server surface (Session 11)** exposes the goal loop to
     external agents: `src/api/a2a.ts` (Express integration) over pure
     modules in `src/core/a2a/` (`protocol.ts` — the Zod JSON-RPC
     boundary, spec error codes, `A2A-Version` negotiation;
     `task_record.ts` — the goal→task state machine and all ProtoJSON
     wire rendering; `agent_card.ts`). Enabled only by
     `TRELLIS_A2A_ENABLED` (default false; the API is byte-identical
     when unset). The card is served unauthenticated from
     `/.well-known/agent-card.json` (public contract only, no-leak
     pinned); `POST /a2a/v1` sits behind the API key and requires
     `A2A-Version: 1.0` (spec: an absent header means a 0.3 client and
     is declined). Dispatch shares the SAME `StreamGate` instance and
     queue-depth backstop as `/api/agent-stream`; one A2A task is one
     goal (taskId = goalId), recorded in TTL-bounded Redis records
     (`a2a:task:<id>`, `A2A_TASK_TTL_SECONDS`) by a per-goal recorder
     subscribed to `agent-stream:<goalId>`. IORedis gotcha (found live
     in Session 11): issue `subscribe` in the SAME tick the connection
     is created — a subscribe issued after an unrelated await can land
     mid ready-check and wedge the connection in a reconnect loop that
     delivers no events. Message text is the only payload that crosses
     into the loop; `metadata.oracle` is honored only when
     `AGENT_ORACLE_ENABLED=true` and rejected otherwise. Cancel is
     declined (-32002); goals are one-shot; push notifications,
     ListTasks, SubscribeToTask, and the extended card are declined with
     typed spec errors. Metrics: `trellis_a2a_requests_total{method}`,
     `trellis_a2a_tasks_total{outcome}`; `a2a.*` events carry ids and
     states only.
5. **Observability and process boundaries**
   - `src/core/observability/` defines pino JSON logging and per-process
     Prometheus registries; API and workers are separate processes/
     containers. Stable dot-namespaced events; bounded metric labels only —
     queries, goals, message content, artifacts, paths, hashes, entity
     names, tool arguments, and tool results never become label values or
     log content. Queue-depth gauges cover all seven queues;
     `trellis_rlm_mcp_calls_total` is label-free with a counts-only
     `rlm.mcp` event.
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
     recorded. THIS SESSION teaches the fixture to serve the remote
     transport so acceptance stays local and deterministic.
   - Frontend: Next.js 16 app in `src/frontend/` with a dev-only proxy —
     deployment deferred by owner redirects (sequencing row 2).

## 2. Current baseline

Repository state at handoff creation:

- `master`: the Session 11 PR merge (branch `session-11-a2a-server`; use
  `git log -- HANDOFF.md` to identify it).
- Offline baseline: `npm test` = 468 passing across 57 files.
- `npm run build` and `npm run python:check` pass.
- `npm run drill:scale`: gate CLOSED at max provenance 286; sweep growth
  1.23x in the Session 11 run against 5.77x fact growth.
- Live zero-LLM checks: `test:a2a` (46), `test:rlm-mcp` (46),
  `test:agent-loop` (23), `test:repo-ingest` (45),
  `test:benchmark-hardening` (24), `test:entity-resolution` (33),
  `test:api-hardening` (18), `test:rlm-sandbox` (4),
  `test:belief-recovery` (30), `test:invalidation-sweep` (17).
- Isolated Compose integration: 9 assertions (`--profile test`, unique
  project name, host ports 0; the image installs `mcp==1.12.4`).
- CI target is Node 22. Session 11's local environment was Node 20.19.2,
  PostgreSQL 16.14, Neo4j 5.11.0, Python 3.13.1, Docker Compose v2.
- Python runtime deps are pinned in `requirements.txt` (`rlms==0.1.3`,
  `openai`, `neo4j`, `psycopg2-binary`, `unstructured`, `mcp`);
  `npm run python:check` verifies syntax/imports/assets.
- The A2A wire contract is pinned to spec v1.0.0; `@a2a-js/sdk` was
  evaluated at 0.3.13 and not adopted (0.3.x wire format).

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

## 3. Session 12 problem statement

The RLM's external tool surface is stdio-only: every MCP server must be
a spawnable child process inside the worker container.

- **The transport is the bottleneck, not the client.**
  `src/rlm/trellis_mcp.py` already enforces the operator allowlist
  before I/O, bounds every call, caps every result, and counts usage
  separately from database provenance — but `McpServerSchema`
  (`src/config/mcp_servers.ts`) only describes `{name, command, tools,
  timeoutMs, maxResultBytes}`, and the client only opens
  `mcp.client.stdio` connections. Real tool ecosystems (hosted
  web-search providers, shared internal tool services, anything not
  installable into the worker image) speak the MCP **Streamable HTTP**
  transport. An operator today would have to wrap every remote server
  in a local stdio proxy.
- **Remote servers need an auth story — operator-owned, secret-safe.**
  Hosted MCP servers require credentials (typically a bearer token or
  API-key header). Those credentials are configuration, never payload:
  they must be referenced from the validated registry, reach only the
  HTTP client, and never appear in logs, metric labels, the prompt
  addendum, `TRELLIS_RESULT`/`TRELLIS_TELEMETRY` lines, or error
  messages that flow back into the REPL (a raised tool error is
  model-visible — redact before raising).
- **Containerized tool servers are the deployment shape.** A tool server
  the operator controls should be runnable as its own Compose service on
  the project network (own image, no host publishing), reached over the
  remote transport — not baked into the worker image. The repository
  should demonstrate that pattern with its own fixture.
- **Verify the current MCP spec/SDK state before designing wire
  shapes.** The pinned `mcp==1.12.4` SDK ships a Streamable HTTP client;
  the older HTTP+SSE transport is deprecated in the MCP spec. Session 12
  must read the SDK/spec versions it builds against, record them in the
  roadmap entry, and pin what it adopts. If the SDK must move, the
  fixture, the Docker image, and `python:check` move with it.
- **Acceptance must stay zero-paid and local.** The fixture server gains
  a Streamable HTTP mode (FastMCP serves it natively) bound to
  127.0.0.1 for the bare-host drill and to a Compose-internal service
  for the integration, including an auth-required mode so credential
  success and failure are both drillable. No external network, no
  metered server, ever, in acceptance.

Session 12 lets an operator point the RLM at tool servers anywhere —
child process, localhost, or a containerized service — under the same
allowlist, bounds, and provenance split.

## 4. Required design

Present the exact design after inspecting §5 (including the current MCP
spec/SDK transport state), then implement it. Deviations require a
concrete reason and equivalent tests.

### 4.1 Registry schema: a transport-discriminated union

- Extend `src/config/mcp_servers.ts` to a Zod discriminated union on
  `transport`: the existing shape becomes `{transport: 'stdio', name,
  command, tools, timeoutMs, maxResultBytes}` with `stdio` as the
  DEFAULT so every existing registry value parses unchanged
  (backward-compatibility unit-pinned); new
  `{transport: 'http', name, url, tools, timeoutMs, maxResultBytes,
  auth?}`. `url` must be http(s); decide and document the posture on
  plain `http://` (recommended: allow it only for loopback/private
  hosts, require https otherwise — enforce in Zod and mirror in Python).
- Auth: `auth: {kind: 'bearer' | 'header', header?, valueEnv}` — the
  credential VALUE never sits in the registry JSON; `valueEnv` names an
  environment variable the worker resolves at connect time. A registry
  naming a missing env var fails startup with a readable error (the
  Guardrail-5 fail-fast posture). The canonical serialization forwarded
  to the child (`serializeMcpServers`) keeps only `valueEnv`; the Python
  side resolves it from its own environment, which `buildAgentEnv` must
  pass through for exactly the named variables — a pure helper change,
  unit-pinned.
- The Node and Python validators stay bound-for-bound identical twins;
  extend both and their twin tests.

### 4.2 Python client: one connection machinery, two dial functions

- In `src/rlm/trellis_mcp.py`, keep the per-server long-lived asyncio
  task + handshake + allowlist + timeout + truncation machinery exactly
  as is; vary only the connection factory: stdio servers keep
  `stdio_client(...)`, HTTP servers use the SDK's Streamable HTTP
  client with the configured URL and auth header. Same
  handshake-once-at-construction, same close-in-`finally`, same
  dead-on-arrival readable startup error (an unreachable URL must fail
  the run fast, never hang — bound the connect like the calls).
- Redaction: the credential value must never appear in `list_tools()`
  output, the prompt addendum, raised error messages (wrap/scrub
  exceptions from the HTTP layer before re-raising into the REPL), or
  stdout. Pin with tests that force auth failures and assert the secret
  is absent from every observable channel.
- `build_mcp_addendum` output for HTTP servers lists name and tools
  exactly like stdio servers — never the URL or auth material. Empty
  registry stays byte-identical (existing pin).

### 4.3 Containerized tool-server pattern

- Teach `scripts/fixture_mcp_server.py` a `--transport streamable-http
  --port <p>` mode (FastMCP supports it) with an optional
  require-token auth mode, keeping the canned `web_search` and
  misbehaving tools identical across transports.
- Compose: a fixture tool service under the existing `test` profile (or
  a dedicated profile) running over Streamable HTTP on the project
  network with no host port; the integration proves a worker-side client
  can call it through the validated registry. Document the pattern in
  the README/runbook as the way operators deploy their own tool servers.

### 4.4 Observability

- Keep the T16 label discipline. `trellis_rlm_mcp_calls_total` is
  label-free today; a bounded `transport` label (`stdio`/`http`) is
  acceptable if it earns its keep — decide and record the decision
  either way. The `rlm.mcp` event may carry per-server counts only if
  operator-chosen server names remain the only identifying values —
  URLs and credentials never appear in logs or labels.

### 4.5 Zero-paid acceptance

- Extend `npm run test:rlm-mcp` (or add `test:rlm-mcp-http` if runtime
  cost warrants a split): the HTTP fixture on 127.0.0.1 — handshake,
  canned search, allowlist rejection before I/O, timeout, truncation,
  auth success, auth failure (readable + redacted), a registry naming a
  missing `valueEnv` failing startup, and a mixed stdio+HTTP registry in
  one run; the existing stdio suite unchanged. The Compose integration
  gains the containerized-fixture check. `test:agent-loop` and
  `test:a2a` stay green untouched.

## 5. File-level starting points

Inspect before editing:

- `TRELLIS_ROADMAP.md` §3.3 #8, §4, and the Session 10/11 §5 entries;
  `.agents/AGENT_CODING_GUIDELINES.md`.
- The MCP spec's current transport section and the pinned `mcp` SDK's
  Streamable HTTP client API (record adopted versions; check whether
  `mcp==1.12.4` suffices or a bump is needed — if bumped, update
  `requirements.txt`, the Docker image, and `python:check` together).
- `src/config/mcp_servers.ts` + `mcp_servers.test.ts` — the registry
  schema and its validation pins; `src/config/index.ts` (fail-fast
  parse at startup).
- `src/rlm/trellis_mcp.py` — the connection machinery to extend;
  `scripts/test_rlm_mcp.ts`/`test_rlm_mcp.py` — the drill to grow;
  `scripts/fixture_mcp_server.py` — the FastMCP fixture.
- `src/workers/rlm_job.ts` (`buildAgentEnv`) — the env forwarding
  contract that must learn to pass through exactly the configured
  `valueEnv` variables; `rlm_job.test.ts` pins.
- `docker-compose.yml` + `scripts/test_compose_roundtrip.ts` — the
  `test` profile and integration assertions.
- `docs/operations/RUNBOOK.md` §8 — the MCP operations section to
  extend with the remote/auth story.

Prefer pure helpers for registry parsing/serialization and env
resolution; keep the Python connection factory the only transport-aware
seam.

## 6. Test strategy and acceptance

Test first. No paid LLM calls and no external network access are
permitted for Session 12 acceptance (loopback and Compose-internal
traffic is local, not external).

Offline tests must cover:

- the discriminated registry union: stdio-default backward
  compatibility (every pre-Session-12 registry parses identically), the
  http variant's URL/auth validation, rejection cases (bad scheme,
  missing valueEnv name, name collisions across transports), and the
  canonical serialization;
- `buildAgentEnv` passing through exactly the configured credential
  variables — no more, no less — with the existing strip behavior
  preserved;
- Python twin validation of both variants (mirroring
  `test_rlm_mcp.py`'s registry twins);
- addendum construction for HTTP servers (names/tools only; no URL, no
  credential; empty-registry byte-identity unchanged);
- any new metric/label pins.

Live zero-LLM coverage (local stack; fixture servers only):

- the extended `test:rlm-mcp` (or split suite) per §4.5, including auth
  success/failure with secret redaction asserted on every observable
  channel, per-call timeout and truncation over HTTP, and a mixed
  stdio+HTTP registry;
- the Compose-profile containerized fixture check;
- regression: `test:agent-loop` (23) and `test:a2a` (46) unchanged and
  green; all other live suites stay green: `test:repo-ingest`,
  `test:benchmark-hardening`, `test:entity-resolution`,
  `test:api-hardening`, `test:rlm-sandbox`, `test:belief-recovery`,
  `test:invalidation-sweep`; `drill:scale` still closes its gate.

Required close-out:

```
 npm test
 npm run build
 npm run python:check
 docker compose --profile test config --quiet
 # Run the isolated zero-LLM Compose integration (unique project name).
 # Run the extended zero-LLM MCP suite(s) against the local fixtures.
 npm run test:rlm-mcp
 npm run test:a2a
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

- README (§External tools: the http transport, the auth story, the
  containerized pattern), `docs/operations/RUNBOOK.md` §8
  (remote-server diagnostics: unreachable URL, expired credential, the
  redaction guarantee), `requirements.txt`/Docker image if the SDK
  moves, and `.env.example` if credential env conventions are
  documented there.
- `TRELLIS_ROADMAP.md`: record the slice under 3.3 #8 only after
  acceptance (state explicitly whether the owner's recorded 3.3 #8
  scope is now exhausted or what remains); add a full-dated §5 entry
  with exact commands/counts, the pinned MCP spec/SDK versions, and any
  defects found.
- `HANDOFF.md`: regenerate for the next objective per §0 — the next
  unstruck sequencing row is the frontend deployment remainder (3.3 #5:
  production build, container, API-key handling, CI coverage), unless
  something discovered this session should jump the queue.

## 7. Guardrails

1. Never mutate an AST. The T13 hash preimage is pinned; `rederiveAstNodeId`
   stays authoritative; nothing positional is ever persisted as identity.
2. Never merge, rename, or delete Entity nodes. Equivalence stays an overlay
   belief; semantic identity and `SAME_AS` behavior stay pinned.
3. Preserve provenance on every semantic node and edge.
   `write_derived_insight` remains the single agent write path, still
   requiring live AST provenance. MCP output is research context and can
   never be passed as `sourceNodeIds` — a remote transport changes where
   a tool runs, never what its output is allowed to become; external
   content earns citability only through the verified ingest path.
4. MCP calls never satisfy the database-provenance requirement:
   `_count_tool_call()` counts database tools only, and
   `TRELLIS_PROTOCOL_VIOLATION` semantics are unchanged, over every
   transport.
5. Operator control is absolute: servers, URLs, transports, tool
   allowlists, timeouts, size caps, and credential *references* come
   from `TRELLIS_MCP_SERVERS` only; credential *values* come from named
   env vars resolved by the worker. No inbound A2A payload, queue
   payload, or model completion may name a server, tool, URL, or
   credential, raise a bound, or alter admission behavior. Argument
   vectors, never shell strings.
6. Every external interaction is bounded: per-call timeouts and size
   caps hold over HTTP exactly as over stdio, connects are bounded, and
   A2A task records keep their TTL. A misbehaving or unreachable tool
   server must degrade to a raised, readable, REDACTED tool error —
   never a hung REPL, never resource exhaustion, never a leaked secret.
7. Validate at every boundary: the registry crosses identical Zod and
   Python validators; inbound A2A JSON-RPC crosses its Zod schemas; all
   LLM calls remain inside BullMQ workers or the RLM process; the
   orchestrator stays tool-free; the `AGENT_ORACLE_ENABLED=false` and
   `TRELLIS_A2A_ENABLED=false` defaults stay pinned.
8. Default to zero paid work and zero external network in acceptance:
   fixture servers (stdio, loopback HTTP, Compose-internal) are the only
   MCP servers acceptance configures; oracle decisions + stubbed tasks
   drive loop drills. Real remote/metered servers are owner-approved
   runs, with the configured surface printed first and observed
   `mcp_calls` recorded.
9. Do not break existing consumers: pre-Session-12 `TRELLIS_MCP_SERVERS`
   values parse identically (stdio default), empty-config byte-identical
   RLM behavior stays pinned, the `/api/agent-stream` SSE contract and
   the A2A v1.0 surface are untouched,
   `FINAL_ANSWER:`/`TRELLIS_TELEMETRY:`/`TRELLIS_RESULT:` parsing stays
   backward-compatible, and pre-Session-9 `rlm_queue` payloads still
   process.
10. Respect the rlms prompt contract: extend `RLM_SYSTEM_PROMPT`, never
    replace it; no literal curly braces in anything rlms formats (double
    them); the generated MCP addendum stays structurally brace-free and
    never carries URLs or credentials.
11. Follow the T16 observability house style. Queries, goals, message
    content, artifacts, tool arguments, results, server commands, URLs,
    credentials, paths, hashes, and entity names never become metric
    label values or log content.
12. Keep API and worker processes split; use project-scoped Compose
    commands; never remove another stack's volumes; fixtures and drills
    clean up only token-scoped or pre-snapshotted state.
13. Ship one feature branch and one PR to `master`, plain engineering
    prose, with no AI attribution or generated-by trailers. Regenerate this
    file in the same PR.

## 8. Explicit exclusions

Do not include: new tools or tool semantics (this session moves
transports, not capabilities); Trellis as an MCP *server* or A2A
*client*; exposing MCP through A2A in any form; OAuth flows for MCP
servers (bearer/header credentials only — OAuth is its own follow-on if
the owner asks); MCP server auto-discovery or registry fetching (the
operator writes the registry by hand); the deprecated HTTP+SSE MCP
transport; A2A push notifications, cancellation, or multi-turn
interactions (unchanged from Session 11's exclusions); new RLM write
paths; orchestrator tools; frontend work (sequencing row 2);
repository-extraction prerequisites; `ASTRef`/`EVIDENCED_BY` migration
(gate closed at 286); T13 re-hashing; rlms library modifications; paid
LLM calls or external network access as acceptance checks.
