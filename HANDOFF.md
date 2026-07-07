You are a principal systems engineer continuing development on Trellis Engine,
a provenance-preserving GraphRAG system (repository:
https://github.com/OpenCnid/trellis, local path `D:\trellis-engine` or the
current working directory). Trellis is an original OpenCnid project, not a
fork, and is unrelated to other projects named Trellis. The repository and its
documentation are the only sources of truth.

Sessions 1–12 are complete and merged:

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
- PR #35 — the A2A server surface (Session 11, 3.3 #8 second slice):
  Trellis serves the Agent2Agent protocol (spec v1.0.0, JSON-RPC
  binding, hand-rolled with Zod — the official `@a2a-js/sdk` 0.3.13
  still spoke the 0.3.x wire format and was not adopted; zero new
  dependencies) over the existing goal loop. `TRELLIS_A2A_ENABLED`
  (default false; unset ⇒ byte-identical API, drill-pinned) mounts the
  public well-known Agent Card plus one key-gated JSON-RPC endpoint
  (`POST /a2a/v1`) whose
  `SendMessage`/`SendStreamingMessage`/`GetTask`/`CancelTask` dispatch
  goals through the SAME `StreamGate` + queue-depth gates and per-goal
  bounds as `/api/agent-stream`, record lifecycle in TTL-bounded Redis
  task records, and translate goal events to A2A task states through
  the pure `src/core/a2a/task_record.ts`. Zero-paid acceptance:
  `npm run test:a2a` (46 checks).
- Session 12 (July 7, 2026) — remote MCP transports and the
  containerized tool-server pattern (3.3 #8 third and closing slice,
  branch `session-12-mcp-http`): the registry became a Zod union
  discriminated on `transport` (`stdio` default — every pre-Session-12
  value parses unchanged; new `http` variant carrying a Streamable HTTP
  URL, https required for public hosts, plain http only for
  loopback/RFC1918/dot-free private hosts) with an operator-owned auth
  story: `auth: {kind: bearer|header, header?, valueEnv}` NAMES a
  credential env var; `resolveMcpCredentialEnv` resolves it fail-fast
  at startup, `buildAgentEnv` forwards exactly the named variables, and
  every REPL-visible error is scrubbed of credential values
  (`_scrub`/`_describe_exception` — anyio ExceptionGroups are flattened
  so a 401 stays diagnosable). One transport-aware seam in the Python
  client (`_dial`: `stdio_client` vs `streamablehttp_client`); the
  allowlist/timeout/size-cap/handshake-once machinery is
  transport-agnostic. The fixture serves Streamable HTTP with an
  optional required-bearer mode; Compose demonstrates the containerized
  pattern (`mcp-fixture` service, test profile, project network, no
  host port, entrypoint override — a tool server needs no Trellis
  databases). MCP protocol revision 2025-06-18 on the unchanged
  `mcp==1.12.4`; the deprecated HTTP+SSE transport is unsupported.
  Defect found and fixed: the Docker image had never shipped
  `trellis_mcp.py`, so every containerized RLM run since Session 10
  would have crashed at import. Zero-paid acceptance:
  `npm run test:rlm-mcp` (86 checks) + the 10-assertion Compose
  integration. The recorded 3.3 #8 scope is exhausted.

OpenCnid selected the MIT License on July 6, 2026.

Your objective is to study the current code and `TRELLIS_ROADMAP.md`, present a
concrete design, and then implement **Session 13: the frontend deployment and
community-readiness remainder (3.3 #5 residue)** — a production build,
container, and CI coverage for the Next.js frontend, plus an API-key story
that never hands the operator's backend key to the browser — without touching
the backend's contracts. Repository-scale extraction prerequisites are the
recorded following item — not this session unless the owner redirects. Do not
re-plan or re-implement completed work.

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
     `PG_DSN`, `PYTHONPATH`, the canonical `TRELLIS_MCP_SERVERS` registry,
     and — Session 12 — exactly the credential env vars the registry's
     http servers name, resolved fail-fast at startup by
     `resolveMcpCredentialEnv`; when no servers are configured the helper
     strips any raw inherited value so the child only ever sees validated
     config). The worker publishes every stdout chunk and feeds two pure
     bounded scanners over the identical bytes: `RlmTelemetryScanner`
     (`TRELLIS_TELEMETRY:` spend line, carrying `mcp_calls`) and
     `RlmResultScanner` (`TRELLIS_RESULT:` task envelope
     `{status, answer, toolCalls}`; shared buffering in
     `line_scanner.ts`). Job payloads are normalized by
     `parseRlmJobData`: pre-Session-9 `{query, jobId}` still processes;
     optional `goalId`/`taskId` correlation, `maxIterations`, and a
     data-only `stub` replay mode for zero-LLM drills. Payloads carry
     nothing MCP-shaped (unit-pinned).
   - `src/rlm/trellis_agent.py` wraps the `rlms` recursive-LM library
     (model `gpt-5.4-2026-03-05`, `max_depth` 1) and injects tools via the
     rlms `custom_tools` mapping — `trellis_neo4j` (read-only Cypher via
     `default_access_mode=READ`, plus the single write path
     `write_derived_insight`/`write_derived_insights`, which REQUIRES
     non-empty `sourceNodeIds` AST hashes), `trellis_postgres`
     (`get_ast_texts`, `vector_search`), and — only when the operator
     configured servers — `trellis_mcp` (`src/rlm/trellis_mcp.py`): an
     MCP client over the pinned `mcp==1.12.4` SDK speaking protocol
     revision 2025-06-18. The registry (`src/config/mcp_servers.ts`,
     Python twin bound-for-bound identical) is a union discriminated on
     `transport`: `stdio` servers are spawned from explicit argument
     vectors as children of the RLM process; `http` servers are dialed
     over Streamable HTTP (https required for public hosts; plain http
     only for loopback/RFC1918/dot-free private hosts), optionally with
     `auth: {kind: bearer|header, header?, valueEnv}` — the registry
     carries the env var NAME, both halves resolve the value from their
     own environment, and every REPL-visible error is scrubbed of
     credential values. One transport-aware seam (`_dial`); everything
     else — handshake-once inside a long-lived asyncio task (anyio
     cancel scopes are task-bound), allowlist BEFORE any I/O,
     double-bounded per-call timeouts, `TRELLIS_MCP_TRUNCATED` size
     caps, readable dead-on-arrival startup errors, close-in-`finally`
     — is transport-agnostic. PROVENANCE SPLIT: database tools increment
     `_count_tool_call()`; MCP calls increment their own counter
     reported as `mcp_calls` — an answer with zero DATABASE tool calls
     emits `TRELLIS_PROTOCOL_VIOLATION` no matter how many MCP calls
     happened. The addendum (`build_mcp_addendum`) lists
     names/tools/bounds only — never URLs or credentials; empty registry
     ⇒ byte-identical prompt (unit- and live-pinned).
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
     external agents: `src/api/a2a.ts` over pure modules in
     `src/core/a2a/` (`protocol.ts`, `task_record.ts`, `agent_card.ts`).
     Enabled only by `TRELLIS_A2A_ENABLED` (default false; the API is
     byte-identical when unset). The card is served unauthenticated from
     `/.well-known/agent-card.json` (public contract only, no-leak
     pinned); `POST /a2a/v1` sits behind the API key and requires
     `A2A-Version: 1.0`. Dispatch shares the SAME `StreamGate` instance
     and queue-depth backstop as `/api/agent-stream`; one A2A task is
     one goal (taskId = goalId), recorded in TTL-bounded Redis records
     (`a2a:task:<id>`, `A2A_TASK_TTL_SECONDS`). IORedis gotcha (found
     live in Session 11): issue `subscribe` in the SAME tick the
     connection is created — a subscribe issued after an unrelated await
     can land mid ready-check and wedge the connection in a reconnect
     loop that delivers no events.
5. **Observability and process boundaries**
   - `src/core/observability/` defines pino JSON logging and per-process
     Prometheus registries; API and workers are separate processes/
     containers. Stable dot-namespaced events; bounded metric labels only —
     queries, goals, message content, artifacts, paths, hashes, entity
     names, tool arguments, tool results, server commands, URLs, and
     credentials never become label values or log content. Queue-depth
     gauges cover all seven queues; `trellis_rlm_mcp_calls_total` is
     label-free (a `transport` label was considered in Session 12 and
     rejected — it would grow the telemetry wire line for a distinction
     the operator's own registry already answers).
6. **The frontend (THIS SESSION'S SUBJECT) and other stable subsystems**
   - `src/frontend/` is a Next.js 16.2.9 / React 19 app (its own
     `package.json` and lockfile, npm-installed separately) with one
     page: an entity search box over a force-directed graph pane
     (`react-force-graph-2d`) and a provenance pane; clicking a graph
     node highlights the exact AST text blocks that produced it
     (`SplitPaneViewer.tsx` fetches `/api/retrieve?entity=...`). Today
     it is dev-only: `next.config.ts` rewrites `/api/:path*` to
     `http://localhost:3000/:path*` with NO API-key injection (a
     rewrite cannot add headers), there is no production build wired
     into CI, no container, and no deployment documentation. The
     backend rejects keyless requests whenever `API_KEY` is set, so the
     proxied page only works against an open local backend today.
     `src/frontend/AGENTS.md` warns: this Next.js version has breaking
     changes vs. training data — read `node_modules/next/dist/docs/`
     before writing Next-specific code.
   - Whole-codebase ingestion: `src/core/repository/`, `npm run
     repo:ingest`, live drill `npm run test:repo-ingest`.
   - Benchmarks: OOLONG v1 saturated baseline; anti-shortcut v2 at
     `data/oolong_pairs_dataset_hard.json`; scale evidence in
     `docs/benchmarks/SCALE_PROVENANCE_REPORT.md` and
     `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md`.
   - The fixture MCP server (`scripts/fixture_mcp_server.py`; stdio and
     Streamable HTTP with an optional required-bearer mode) is the only
     MCP server acceptance ever configures; real web-search servers are
     owner-approved runs with the allowlist printed and `mcp_calls`
     recorded. The containerized tool-server pattern is the
     `mcp-fixture` Compose service (test profile).

## 2. Current baseline

Repository state at handoff creation:

- `master`: the Session 12 PR merge (branch `session-12-mcp-http`; use
  `git log -- HANDOFF.md` to identify it).
- Offline baseline: `npm test` = 485 passing across 57 files.
- `npm run build` and `npm run python:check` pass.
- `npm run drill:scale`: gate CLOSED at max provenance 286; sweep growth
  1.63x in the Session 12 run against 5.77x fact growth.
- Live zero-LLM checks: `test:rlm-mcp` (86), `test:a2a` (46),
  `test:agent-loop` (23), `test:repo-ingest` (45),
  `test:benchmark-hardening` (24), `test:entity-resolution` (33),
  `test:api-hardening` (18), `test:rlm-sandbox` (4),
  `test:belief-recovery` (30), `test:invalidation-sweep` (17).
- Isolated Compose integration: 10 assertions (`--profile test`, unique
  project name, host ports 0; includes the containerized credentialed
  MCP fixture probe via `scripts/compose_mcp_probe.py`).
- CI target is Node 22. Session 12's local environment was Node 20.19.2,
  PostgreSQL 16.14, Neo4j 5.11.0, Python 3.13.1, Docker Compose v2.
- Python runtime deps are pinned in `requirements.txt` (`rlms==0.1.3`,
  `openai`, `neo4j`, `psycopg2-binary`, `unstructured`, `mcp==1.12.4`);
  `npm run python:check` verifies syntax/imports/assets.
- The frontend has NO offline tests and NO CI coverage today; its build
  has never been exercised in this repository's CI.

Fresh worktrees do not contain `node_modules`. Start with:

```
 git status --short --branch
 git branch --show-current
 npm ci
 npm test
 npm run build
 npm run python:check
 docker compose config --quiet
 # The frontend has its own package tree:
 cd src/frontend && npm ci && npm run build && cd ../..
```

Work on a feature branch and target `master`.

## 3. Session 13 problem statement

The backend has been deployable since Session 3; the frontend never
caught up. Three concrete gaps, all recorded under roadmap 3.3 #5:

- **No production build or container.** `src/frontend/package.json` has
  `next build`/`next start` scripts, but nothing in the repository runs
  them: CI never installs the frontend tree, `docker-compose.yml` has
  no frontend service, and the backend image deliberately excludes the
  frontend (recorded in the Session 3 §5 entry). A `next build`
  regression would land silently today.
- **The API-key story is a dev-only hole.** `next.config.ts` proxies
  `/api/:path*` straight to the backend with no key. Next rewrites
  cannot inject headers, so any deployment with `API_KEY` set (i.e.,
  every real deployment) gets 401s from the browser. Handing the
  backend key to the browser (`NEXT_PUBLIC_*`) is not acceptable — the
  key gates paid endpoints (`/api/rlm-stream`, `/api/agent-stream`,
  `/a2a/v1`) the page never uses. The key must live server-side, and
  the browser must reach exactly the endpoints the page needs.
- **No CI coverage.** Neither `next build` nor `eslint` runs in
  `.github/workflows/ci.yml`, and the Compose test profile proves
  nothing about the frontend.

Session 13 gives the frontend the same deployment discipline the
backend has: reproducible build, non-root container, health check,
key-safe backend access, and zero-LLM CI proof.

## 4. Required design

Present the exact design after inspecting §5, then implement it.
Deviations require a concrete reason and equivalent tests. Read
`src/frontend/AGENTS.md` first — Next.js 16 conventions may differ from
training data; consult `node_modules/next/dist/docs/` (after the
frontend `npm ci`) for route handlers, `output: 'standalone'`, and
config behavior before writing Next-specific code.

### 4.1 Key-safe backend access: a server-side proxy route

- Replace the dev rewrite as the production path with a Next route
  handler (e.g. `src/frontend/src/app/api/[...path]/route.ts`) that
  forwards ONLY an allowlisted set of backend endpoints — `/retrieve`
  is the only one the page uses today (plus `/healthz` if the container
  health check goes through the app) — and injects `x-api-key` from
  server-side env. Everything outside the allowlist returns 404 without
  touching the backend. The key must never appear in client-delivered
  JS, page props, or response/error bodies — assert this in the drill.
- The backend base URL and key come from server env (suggested:
  `TRELLIS_BACKEND_URL`, default `http://localhost:3000` for bare-host
  dev, the Compose service DNS in the container; reuse `API_KEY` or
  name a frontend-scoped variable — decide and document). Prefer ONE
  code path: the handler serves both dev and prod so the two cannot
  diverge; drop the rewrite if the handler fully replaces it.
- Keep it pure where possible: an allowlist/URL-mapping helper testable
  without a running server, following the repo's pure-helper convention.

### 4.2 Production build and container

- Set `output: 'standalone'` in `next.config.ts` and add a
  `src/frontend/Dockerfile` (multi-stage: `npm ci` + `next build` on
  `node:22-bookworm-slim`, then copy `.next/standalone` +
  `.next/static` + `public` into a non-root runtime stage; the backend
  `Dockerfile` shows the house style — non-root `node` user,
  HEALTHCHECK, pinned base). The frontend stays OUT of the backend
  image, as recorded in Session 3.
- Compose: a `frontend` service (its own build context `src/frontend`),
  loopback-published port (default 3001, env-tunable like the other
  host ports), env wiring for the backend URL + key, health check,
  `depends_on` backend healthy. Decide whether it joins the default
  profile or an opt-in profile; either is defensible — record the
  choice.

### 4.3 CI and the Compose proof

- CI: a frontend job (or steps) running `npm ci`, `eslint`, and
  `next build` in `src/frontend` on Node 22 — fail on lint or build
  errors. Cache per the existing workflow's style.
- Extend the Compose test profile so the integration proves the
  frontend serves: fetch the frontend root (200, expected page markers)
  and a proxied `/api/retrieve` for the entity the round trip already
  seeds — asserting the proxy injected the key (the Compose backend has
  `API_KEY` set) and the response carries the seeded provenance. Also
  assert a non-allowlisted path (e.g. `/api/metrics`) returns 404
  through the proxy, and that no fetched body contains the key value.

### 4.4 Observability and docs

- The frontend needs no Prometheus registry this session; its logs are
  Next's defaults. Do NOT log the API key anywhere; if the proxy logs
  requests, follow the T16 rule (no query content, no key material).
- Update README (frontend build/deploy/env contract),
  `docs/operations/RUNBOOK.md` (a frontend section: deploy, diagnose
  401 vs 404 through the proxy, rotate the key), `.env.example` for new
  variables, and `API_REFERENCE.md` only if a client-visible contract
  changes (it should not — the proxy forwards `/retrieve` verbatim).

### 4.5 Zero-paid acceptance

- Everything here is zero-LLM by construction: the page and proxy touch
  `/retrieve` only. The Compose integration extension must keep its
  no-`OPENAI_API_KEY` assertion intact. Frontend unit coverage (the
  allowlist helper) joins `npm test` only if the helper lives outside
  the frontend tree — otherwise give the frontend its own minimal test
  script and run it in CI; prefer whichever keeps `npm test`'s
  zero-config invariant intact. Record the choice.

## 5. File-level starting points

Inspect before editing:

- `TRELLIS_ROADMAP.md` §3.3 #5, §4, and the Session 3/12 §5 entries;
  `.agents/AGENT_CODING_GUIDELINES.md`; `src/frontend/AGENTS.md` (the
  Next.js version warning) and `node_modules/next/dist/docs/` after the
  frontend `npm ci`.
- `src/frontend/next.config.ts` (the dev rewrite to replace),
  `src/frontend/src/components/SplitPaneViewer.tsx` (the only backend
  consumer: `/api/retrieve?entity=...`), `src/frontend/package.json`.
- `Dockerfile` (house style for the frontend image),
  `docker-compose.yml` (service/profile/env conventions; the
  `mcp-fixture` entrypoint-override precedent),
  `scripts/test_compose_roundtrip.ts` (the integration to extend — it
  already seeds a provenance-bearing entity the frontend proxy can
  fetch).
- `.github/workflows/ci.yml` (job layout, Node 22, the isolated Compose
  invocation), `src/api/auth.ts` (what the backend accepts:
  `x-api-key` / Bearer / `api_key` query param).
- `docs/operations/RUNBOOK.md` and README's frontend/deployment
  sections.

## 6. Test strategy and acceptance

Test first. No paid LLM calls and no external network access are
permitted for Session 13 acceptance.

Offline tests must cover:

- the proxy allowlist mapping (pure helper): allowlisted path →
  backend URL, non-allowlisted → rejection, no key material in any
  returned structure;
- existing `npm test` unchanged and green (485 baseline; grows only if
  helpers land in the main tree — record either way);
- `next build` and `eslint` passing in `src/frontend` (CI-enforced).

Live zero-LLM coverage (local stack; Compose):

- the extended Compose integration: frontend root serves 200 with
  expected markers; proxied `/api/retrieve` returns the seeded entity's
  graph + provenance (proving key injection); a non-allowlisted proxy
  path → 404; no fetched body contains the key value; the existing 10
  assertions unchanged.
- regression: every suite in the §2 list stays green, including
  `test:rlm-mcp` (86) and `test:a2a` (46); `drill:scale` still closes
  its gate.

Required close-out:

```
 npm test
 npm run build
 npm run python:check
 (cd src/frontend && npm ci && npx eslint . && npm run build)
 docker compose --profile test config --quiet
 # Run the isolated zero-LLM Compose integration (unique project name).
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

- README (frontend build/deploy/env), `docs/operations/RUNBOOK.md`
  (frontend operations), `.env.example` (new frontend variables),
  `.github/workflows/ci.yml`.
- `TRELLIS_ROADMAP.md`: mark 3.3 #5 fully done only after acceptance
  (the license half closed July 6, 2026; this closes the frontend
  half); add a full-dated §5 entry with exact commands/counts and any
  defects found.
- `HANDOFF.md`: regenerate for the next objective per §0 — the next
  unstruck sequencing row is repository-scale extraction prerequisites
  (scanner test/fixture exclusion plus a code-tuned extraction prompt
  with generic-identifier suppression, per the recorded pilot
  findings), unless something discovered this session should jump the
  queue.

## 7. Guardrails

1. Never mutate an AST. The T13 hash preimage is pinned; `rederiveAstNodeId`
   stays authoritative; nothing positional is ever persisted as identity.
2. Never merge, rename, or delete Entity nodes. Equivalence stays an overlay
   belief; semantic identity and `SAME_AS` behavior stay pinned.
3. Preserve provenance on every semantic node and edge.
   `write_derived_insight` remains the single agent write path, still
   requiring live AST provenance. MCP output is research context and can
   never be passed as `sourceNodeIds`; external content earns citability
   only through the verified ingest path.
4. The backend API key never reaches the browser: not via
   `NEXT_PUBLIC_*`, not in client bundles, not in page props, not in
   proxied response or error bodies. The proxy forwards an explicit
   endpoint allowlist and nothing else — in particular the paid
   endpoints (`/api/rlm-stream`, `/api/agent-stream`, `/a2a/v1`) and
   `/metrics` stay unreachable through it unless the owner directs
   otherwise.
5. Operator control is absolute for the RLM tool surface: servers,
   URLs, transports, tool allowlists, timeouts, size caps, and
   credential *references* come from `TRELLIS_MCP_SERVERS` only;
   credential *values* come from named env vars resolved by the worker.
   No inbound payload or model completion may alter any of it.
   Credential values never appear in logs, labels, prompts,
   serializations, or raised errors (the Session 12 redaction
   guarantee).
6. Every external interaction is bounded: per-call timeouts and size
   caps hold over stdio and HTTP; connects are bounded; A2A task
   records keep their TTL; the frontend proxy must pass through the
   backend's own limits, not add unbounded buffering or retries.
7. Validate at every boundary: the registry crosses identical Zod and
   Python validators; inbound A2A JSON-RPC crosses its Zod schemas; all
   LLM calls remain inside BullMQ workers or the RLM process; the
   orchestrator stays tool-free; the `AGENT_ORACLE_ENABLED=false` and
   `TRELLIS_A2A_ENABLED=false` defaults stay pinned.
8. Default to zero paid work and zero external network in acceptance.
   The frontend work is zero-LLM by construction — keep it that way
   (the proxy never exposes paid endpoints; the Compose integration
   keeps its no-`OPENAI_API_KEY` assertion; fixture servers remain the
   only MCP servers acceptance configures).
9. Do not break existing consumers: the backend API contract
   (`API_REFERENCE.md`) is untouched; the backend image and its Compose
   services keep their shape (the frontend gets its OWN image);
   pre-Session-12 `TRELLIS_MCP_SERVERS` values parse identically, the
   `/api/agent-stream` SSE contract and the A2A v1.0 surface are
   untouched, and pre-Session-9 `rlm_queue` payloads still process.
10. Respect the rlms prompt contract: extend `RLM_SYSTEM_PROMPT`, never
    replace it; no literal curly braces in anything rlms formats
    (double them); the generated MCP addendum stays structurally
    brace-free and never carries URLs or credentials.
11. Follow the T16 observability house style. Queries, goals, message
    content, artifacts, tool arguments, results, server commands, URLs,
    credentials, API keys, paths, hashes, and entity names never become
    metric label values or log content.
12. Keep API and worker processes split; use project-scoped Compose
    commands; never remove another stack's volumes; fixtures and drills
    clean up only token-scoped or pre-snapshotted state.
13. Ship one feature branch and one PR to `master`, plain engineering
    prose, with no AI attribution or generated-by trailers. Regenerate this
    file in the same PR.

## 8. Explicit exclusions

Do not include: new frontend features, redesigns, or component work
beyond what the proxy/build requires (the page's function stays
exactly: search an entity, view graph + provenance); authentication FOR
the frontend itself (user logins, sessions — the page stays as open as
the operator's network makes it; only the backend-key handling is in
scope); exposing `/api/rlm-stream`, `/api/agent-stream`, `/a2a/v1`, or
`/metrics` through the proxy; server-side rendering of graph data or
any backend contract change; frontend Prometheus metrics; E2E browser
automation (the Compose proof is HTTP-level); MCP or A2A work of any
kind (the recorded 3.3 #8 scope is exhausted — new tools, OAuth flows,
Trellis as an MCP server or A2A client are new owner directions, not
remainders); repository-extraction prerequisites (the next sequencing
row); `ASTRef`/`EVIDENCED_BY` migration (gate closed at 286); T13
re-hashing; rlms library modifications; paid LLM calls or external
network access as acceptance checks.
