You are a principal systems engineer continuing development on Trellis Engine,
a provenance-preserving GraphRAG system (repository:
https://github.com/OpenCnid/trellis, local path `D:\trellis-engine` or the
current working directory). Trellis is an original OpenCnid project, not a
fork, and is unrelated to other projects named Trellis. The repository and its
documentation are the only sources of truth.

Sessions 1–9 are complete and merged:

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
- Session 9 (July 7, 2026) — the agentic orchestration loop (3.3 #7):
  `GET /api/agent-stream` + `agent_queue`/`agent_worker.ts` run an
  orchestrator (same LLM, planner system prompt, Zod-validated decisions
  through the T8 boundary — never an rlms REPL) that dispatches the RLM as
  a reusable single-task sub-agent over ordinary `rlm_queue` jobs, reads
  their new `TRELLIS_RESULT` envelopes, and iterates under hard per-goal
  bounds. Zero-LLM acceptance via oracle scripts + stubbed tasks
  (`npm run test:agent-loop`).

OpenCnid selected the MIT License on July 6, 2026.

Your objective is to study the current code and `TRELLIS_ROADMAP.md`, present a
concrete design, and then implement **Session 10: frontend deployment and
community readiness remainder (roadmap item 3.3 #5 residue)**. The Next.js
frontend must gain a production build, a container in the Compose topology,
API-key handling that never ships the operational key to the browser, and CI
coverage — without weakening any backend invariant. Do not re-plan or
re-implement completed work.

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
     `agent_queue` (Session 9). `rlm_queue` and `agent_queue` use
     interactive no-retry job options (an interrupted paid run must not
     silently re-spend); the rest use bounded retries. All LLM calls live
     inside BullMQ workers or the RLM process; every worker-consumed
     completion crosses `parseLlmResponse` (`src/core/llm/boundary.ts`).
4. **RLM execution and the agentic loop (Session 9)**
   - `GET /api/rlm-stream` (API-key gated, `StreamGate` + queue-depth
     backstop) subscribes to `rlm-stream:<jobId>`, then enqueues one
     `rlm_queue` job. `src/workers/rlm_worker.ts` spawns one Python process
     per job (`trellis_agent.py`), publishes every stdout chunk, and feeds
     two pure bounded scanners over the identical bytes:
     `RlmTelemetryScanner` (`TRELLIS_TELEMETRY:` spend line) and
     `RlmResultScanner` (`TRELLIS_RESULT:` task envelope
     `{status, answer, toolCalls}`; `src/core/observability/rlm_result.ts`,
     shared buffering in `line_scanner.ts`). The worker's completion value
     is the parsed envelope + telemetry (`RlmJobCompletion`). Job payloads
     are normalized by `src/workers/rlm_job.ts`: pre-Session-9
     `{query, jobId}` still processes; optional `goalId`/`taskId`
     correlation, `maxIterations` (forwarded as `--max-iterations`), and a
     data-only `stub` replay mode for zero-LLM drills.
   - The orchestrator lives in `src/core/agent/`: `decision.ts`
     (`OrchestratorDecisionSchema` — dispatch/finish/fail with cross-field
     checks), `orchestrator_prompt.ts` (planner persona, consumed ONLY by
     plain chat completions), `transcript.ts` (pure message construction,
     per-answer truncation), `decision_source.ts` (OpenAI + oracle),
     `oracle.ts` (scripted decisions with an `onProtocolViolation` branch;
     stubs ride outside the LLM schema), and `goal_loop.ts` (the
     dependency-injected loop; typed failures `iteration_bound`/
     `task_bound`/`concurrency_bound`/`decision_error`/`orchestrator_fail`).
     `src/workers/agent_worker.ts` wires it: tasks dispatch via
     `rlmQueue.add` + `waitUntilFinished` on a `QueueEvents` subscriber,
     goal events publish to `agent-stream:<goalId>`, orchestration spend
     records under `operation: 'orchestration'`. `GET /api/agent-stream`
     mirrors the RLM stream (gate `AGENT_MAX_CONCURRENT_GOALS`, backstop
     `AGENT_QUEUE_MAX_DEPTH`, subscribe-then-enqueue, terminal-event end).
     Bounds come from validated config with single-digit caps; oracle
     scripts require `AGENT_ORACLE_ENABLED=true` (default off).
   - CRITICAL rlms constraint: `custom_system_prompt` REPLACES the base
     REPL protocol prompt. Trellis EXTENDS `RLM_SYSTEM_PROMPT` (see the
     `TRELLIS_ADDENDUM` comment), and rlms runs `.format()` over the
     prompt so literal curly braces are forbidden there. The orchestrator
     prompt is NOT rlms-routed and is exempt (unit-pinned).
5. **Observability and process boundaries**
   - `src/core/observability/` defines pino JSON logging and per-process
     Prometheus registries; API and workers are separate processes/
     containers. Stable dot-namespaced events; bounded metric labels only —
     queries, goals, paths, hashes, and entity names never become label
     values. Queue-depth gauges cover all seven queues.
6. **The frontend (THIS session's subject)**
   - `src/frontend/` is a Next.js 16.2.9 / React 19.2.4 app (bootstrapped
     with create-next-app; `npm run dev` = `next dev -p 3001`) with its own
     `package.json`/`package-lock.json`, deliberately excluded from the
     backend image. `page.tsx` is an entity search box;
     `SplitPaneViewer.tsx` fetches `/api/retrieve?entity=...` and renders a
     force-directed graph pane (`GraphPane.tsx`, react-force-graph-2d)
     beside a provenance pane highlighting the AST blocks behind a clicked
     node. `next.config.ts` holds a dev-only rewrite proxying
     `/api/:path*` → `http://localhost:3000/:path*`.
   - `src/frontend/AGENTS.md` warns that this Next.js major differs from
     training data: read `node_modules/next/dist/docs/` before writing
     frontend code. Keep that note intact.
7. **Other subsystems (stable, not this session's subject)**
   - Whole-codebase ingestion: `src/core/repository/`, `npm run
     repo:ingest`, live drill `npm run test:repo-ingest`.
   - Benchmarks: OOLONG v1 saturated baseline; anti-shortcut v2 at
     `data/oolong_pairs_dataset_hard.json`; scale evidence in
     `docs/benchmarks/SCALE_PROVENANCE_REPORT.md` and
     `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md`.

## 2. Current baseline

Repository state at handoff creation:

- `master`: the Session 9 PR merge (branch `session-9-agentic-loop`; use
  `git log -- HANDOFF.md` to identify it). Prior anchor: `4cee28e` (PR #32).
- Offline baseline: `npm test` = 397 passing across 52 files.
- `npm run build` and `npm run python:check` pass.
- `npm run drill:scale`: gate CLOSED at max provenance 286; sweep growth
  1.94x against 5.77x fact growth.
- Live zero-LLM checks: `test:agent-loop` (23), `test:repo-ingest` (45),
  `test:benchmark-hardening` (24), `test:entity-resolution` (33),
  `test:api-hardening` (18), `test:rlm-sandbox` (4),
  `test:belief-recovery` (30), `test:invalidation-sweep` (17).
- Isolated Compose integration: 9 assertions (`--profile test`).
- CI target is Node 22. Session 9's local environment was Node 20.19.2,
  PostgreSQL 16.14, Neo4j 5.11.0, Python 3.13, Docker Compose v2.

Fresh worktrees do not contain `node_modules` (neither root nor
`src/frontend`). Start with:

```
 git status --short --branch
 git branch --show-current
 npm ci
 npm test
 npm run build
 docker compose config --quiet
 cd src/frontend && npm ci && npm run lint && npm run build
```

Work on a feature branch and target `master`.

## 3. Session 10 problem statement

The backend is deployable and community-ready; the frontend is a dev-only
artifact.

- **No production path.** `src/frontend/package.json` has `next build`/
  `next start` scripts, but nothing in the repository ever runs them: no
  Dockerfile stage, no Compose service, no CI job. The only documented way
  to run the UI is `next dev -p 3001` against a bare-host backend.
- **The proxy only exists in dev.** `next.config.ts` rewrites
  `/api/:path*` → `http://localhost:3000/:path*`. That hostname is
  meaningless inside a container network, and the target must become
  configuration, not a hardcoded localhost literal.
- **The API key cannot reach the browser.** `SplitPaneViewer.tsx` calls
  `/api/retrieve` with no credentials, so the UI only works against an
  unauthenticated backend (`API_KEY` unset — the local-dev exception). Any
  deployed backend sets `API_KEY`, and the browser must NOT receive that
  key (an `NEXT_PUBLIC_` env or client-side header would publish it).
  Key injection has to happen server-side, in the Next server process.
- **No CI coverage at all.** The root workflow (`.github/workflows/ci.yml`)
  runs offline tests, an image build, and the isolated Compose round trip —
  none of which would catch a frontend that does not even compile. The
  frontend's `README.md` is still the stock create-next-app template
  (community-readiness debt), while the root README describes the frontend
  only in passing.
- **Version note.** The app pins Next 16.2.9 — `src/frontend/AGENTS.md`
  explicitly warns its conventions differ from training data. Read
  `node_modules/next/dist/docs/` (e.g. the deployment/standalone-output
  guide) before writing configuration.

Session 10 must make the frontend a first-class deployable service without
touching backend invariants: T6 limits, auth semantics, and the API/worker
process split stay exactly as they are.

## 4. Required design

Present the exact design after inspecting §5, then implement it. Deviations
require a concrete reason and equivalent tests.

### 4.1 Server-side backend proxy with key injection

- Replace the dev-only rewrite as the production path with a Next.js
  route handler (e.g. `src/frontend/src/app/api/[...path]/route.ts`) that
  forwards requests to `BACKEND_URL` (server-side env, default
  `http://localhost:3000` bare-host, `http://backend:3000` under Compose)
  and injects `x-api-key` from `BACKEND_API_KEY` — both read only in the
  Next server process, never exposed via `NEXT_PUBLIC_`. The browser keeps
  calling same-origin `/api/...`; the operational key never leaves the
  server. Keep an allowlist of forwardable backend routes (at minimum
  `/retrieve`; add `/healthz` if the container healthcheck uses it) — the
  proxy must not become an open relay to `/ingest`/`/metrics`/SSE cost
  surfaces unless deliberately enabled and documented.
- The dev rewrite can remain for keyless local development, but route
  handlers take precedence over rewrites, so behavior must be identical in
  both modes. Client components (`SplitPaneViewer.tsx`) should not need to
  change their fetch paths.

### 4.2 Container and Compose topology

- Multi-stage `src/frontend/Dockerfile` on Node 22: `npm ci` → `next
  build` with standalone output (`output: 'standalone'` in
  `next.config.ts` — verify against the in-repo Next 16 docs) → a minimal
  non-root runtime stage running the standalone server. No Python, no
  backend code, no secrets baked into the image (the API key arrives as
  runtime env).
- New Compose service `frontend` joining the existing project: depends on
  a healthy `backend`, receives `BACKEND_URL=http://backend:3000` and
  `BACKEND_API_KEY=${API_KEY}`, publishes a host port via
  `TRELLIS_FRONTEND_HOST_PORT` (default 3001, `0` for CI isolation), and
  carries a container healthcheck. The backend/worker services and their
  images are untouched; project-scoped volumes/naming conventions hold.

### 4.3 CI and community readiness

- Extend `.github/workflows/ci.yml` with a frontend job (Node 22,
  `npm ci`, `npm run lint`, `npm run build` in `src/frontend`) and build
  the frontend image alongside the backend image job. If the isolated
  Compose integration can cheaply assert the frontend (container healthy +
  proxied `/api/retrieve` round trip with the key enforced), add that to
  the integration service; otherwise a dedicated live script (§6) covers
  it locally.
- Replace the stock `src/frontend/README.md` with real documentation
  (dev mode, production build, container, env contract, key handling);
  update the root README's frontend section and `API_REFERENCE.md` if the
  proxy surface warrants a note. Preserve `src/frontend/AGENTS.md`.

### 4.4 What must NOT change

- No backend endpoint, limit, or auth change; the frontend consumes the
  documented API as-is. No new backend queue/worker. The RLM/agent SSE
  surfaces are not proxied this session unless trivially safe — the UI
  does not use them yet.

## 5. File-level starting points

Inspect before editing:

- `src/frontend/next.config.ts`, `package.json`, `src/app/page.tsx`,
  `src/components/SplitPaneViewer.tsx` (the only backend consumer),
  `src/frontend/AGENTS.md`, and the Next 16 docs under
  `src/frontend/node_modules/next/dist/docs/` after `npm ci`.
- `Dockerfile` (backend multi-stage precedent: build stage, non-root
  runtime, entrypoint), `docker-compose.yml` (service topology, health
  conditions, `TRELLIS_*_HOST_PORT` conventions, the `test` profile), and
  `.env.example`.
- `.github/workflows/ci.yml` (offline/image/integration job layout) and
  `scripts/test_compose_roundtrip.ts` (the integration service's checks).
- `src/api/auth.ts` and `src/api/server.ts` §0 auth semantics — what the
  proxy must satisfy; `scripts/test_api_hardening.ts` for the live-test
  house style (spawn, poll `/healthz`, `check()` assertions, exit code).
- `src/config/index.ts` — backend config is Zod-validated once; mirror
  that discipline for the frontend's few server-side envs where Next's
  conventions allow.

Prefer pure helpers where logic exists (e.g. the proxy's route allowlist
and header construction), so they are unit-testable without a server.

## 6. Test strategy and acceptance

Test first. No paid LLM calls are permitted for Session 10 acceptance.

Offline checks must cover:

- root suite stays green: `npm test` (397 baseline) — backend code is
  untouched or additions are pinned by new tests;
- `cd src/frontend && npm run lint && npm run build` both pass (CI runs
  them; treat them as the frontend's offline gate);
- if the proxy allowlist/header logic is a pure module, unit tests for it
  (forwardable route filtering, key header injection, non-allowlisted
  rejection) — and assert no `NEXT_PUBLIC_` key reference exists anywhere,
  so the secret cannot reach a client bundle.

Live zero-LLM coverage against the local stack:

- a new live script (suggested `npm run test:frontend`, house style of
  `test_api_hardening.ts`): boot the backend API with `API_KEY` set and
  the built frontend server with `BACKEND_URL`/`BACKEND_API_KEY`; assert
  (1) the page HTML serves, (2) a direct unauthenticated backend
  `/retrieve` gets 401 while the same query through the frontend proxy
  succeeds (key injected server-side), (3) a non-allowlisted backend path
  through the proxy is refused, (4) no response ever echoes the key;
- the isolated Compose project (unique `COMPOSE_PROJECT_NAME`, host ports
  `0`) comes up with the frontend service healthy and the proxied round
  trip passing — either inside the integration service or via the live
  script pointed at the Compose ports;
- all existing live suites stay green: `test:agent-loop`,
  `test:repo-ingest`, `test:benchmark-hardening`, `test:entity-resolution`,
  `test:api-hardening`, `test:rlm-sandbox`, `test:belief-recovery`,
  `test:invalidation-sweep`; `drill:scale` still closes its gate.

Required close-out:

```
 npm test
 npm run build
 npm run python:check
 (cd src/frontend && npm run lint && npm run build)
 docker compose --profile test config --quiet
 # Run the isolated zero-LLM Compose integration (frontend included).
 # Run the new frontend live script.
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

- `src/frontend/README.md` (real documentation), the root README's
  frontend/containers sections, `.env.example`, and the runbook (frontend
  service operations, env contract).
- `TRELLIS_ROADMAP.md`: strike the 3.3 #5 residue only after acceptance;
  add a full-dated §5 entry with exact commands/counts and any defects
  found.
- `HANDOFF.md`: regenerate for the next objective per §0 — the first
  remaining unstruck sequencing row is the repository-scale extraction
  prerequisites (scanner test/fixture exclusion + code-tuned extraction
  prompt), unless something discovered this session should jump the queue.

## 7. Guardrails

1. Never mutate an AST. The T13 hash preimage is pinned; `rederiveAstNodeId`
   stays authoritative; nothing positional is ever persisted as identity.
2. Never merge, rename, or delete Entity nodes. Equivalence stays an overlay
   belief; semantic identity and `SAME_AS` behavior stay pinned.
3. Preserve provenance on every semantic node and edge. The frontend and its
   proxy are read-only consumers; `write_derived_insight` remains the single
   agent write path.
4. Validate every LLM response at the `parseLlmResponse`/Zod boundary. All
   LLM calls remain inside BullMQ workers or the RLM process — the API and
   frontend processes never call a model.
5. The operational API key never reaches a browser: no `NEXT_PUBLIC_` key
   env, no key in client bundles, no key echoed in proxy responses or
   logged. Key injection happens only in the Next server process.
6. The proxy is an allowlist, not a relay: only deliberately exposed backend
   routes are forwardable; T6 limits, auth, and admission control on the
   backend are not weakened or bypassed. Agentic bounds and the
   `AGENT_ORACLE_ENABLED=false` default stay pinned.
7. Default to zero paid work. Acceptance is zero-LLM; any real RLM/agent
   goal run requires owner approval and recorded telemetry-based spend.
8. Do not break existing consumers: `FINAL_ANSWER:`/`TRELLIS_TELEMETRY:`/
   `TRELLIS_RESULT:` parsing, SSE payload shapes, pre-Session-9 `rlm_queue`
   payloads, and the backend Compose services/images all keep working.
9. Respect the rlms prompt contract: extend `RLM_SYSTEM_PROMPT`, never
   replace it; no literal curly braces in anything rlms formats; the
   orchestrator persona stays plain chat completions.
10. Follow the T16 observability house style. Goal text, task queries,
    entity names, paths, and hashes never become metric label values.
11. Keep API and worker processes split; the frontend is a third, separate
    service. Use project-scoped Compose commands; never remove another
    stack's volumes; fixtures and drills clean up only token-scoped or
    pre-snapshotted state.
12. Heed `src/frontend/AGENTS.md`: this Next.js major differs from training
    data — consult `node_modules/next/dist/docs/` before writing frontend
    configuration or route handlers.
13. Ship one feature branch and one PR to `master`, plain engineering
    prose, with no AI attribution or generated-by trailers. Regenerate this
    file in the same PR.

## 8. Explicit exclusions

Do not include: new UI features (RLM/agent stream views, ingest UI, auth
screens — the existing entity/provenance viewer is the deliverable);
proxying paid SSE surfaces (`/api/rlm-stream`, `/api/agent-stream`) or
`/ingest`/`/metrics` through the frontend; user-facing authentication/
sessions (the single operational API key model stays); Kubernetes/cloud
deployment or external hosting (Vercel etc. — the deliverable is the
container in this Compose topology); frontend test-framework buildout
beyond lint/build and the live script; backend endpoint changes; the
repository-extraction prerequisites (next session); `ASTRef`/
`EVIDENCED_BY` migration (gate closed at 286); T13 re-hashing; rlms
library modifications; paid LLM calls as acceptance checks.
