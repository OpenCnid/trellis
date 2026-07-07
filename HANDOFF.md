You are a principal systems engineer continuing development on Trellis Engine,
a provenance-preserving GraphRAG system (repository:
https://github.com/OpenCnid/trellis, local path `D:\trellis-engine` or the
current working directory). Trellis is an original OpenCnid project, not a
fork, and is unrelated to other projects named Trellis. The repository and its
documentation are the only sources of truth.

Sessions 1–13 are complete and merged:

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
- Session 13 (July 7, 2026, branch `d/musing-wilbur-5bf4b2`) —
  documentation, context alignment, and architectural consolidation
  (owner-redirected; the frontend deployment is deferred — unscheduled,
  scope preserved in roadmap §3.3 #5). The
  primary deliverable is the design record
  `docs/architecture/WORKSPACE_AND_MODULES.md`: the three-tier trust
  model, the Tier-3 workspace contract (harness-captured, origin-stamped,
  uuid-delimited segments; stub returns; plan-in-workspace; the
  data-not-objects contract and the verified rlms rebind-vs-mutate
  exception semantics), cross-task workspace lineage (serialize → park →
  seed; explicitly not a blackboard), the promotion path, the L0–L3
  self-editing capability ladder (L1/L2 forbidden; L3 — staged
  self-modification through the verified pipeline — is the capability
  flywheel's mechanism), the kernel/userspace boundary, the module
  manifest/registry/gates design with module #0 (extracting the
  spatial-flywheel protocol), and a six-step implementation sequence.
  DESIGN ONLY — none of it is implemented. Alongside it:
  `docs/GLOSSARY.md` (canonical one-line definitions; authority
  hierarchy code > glossary > prose) and the `TRELLIS_ROADMAP.md` §1
  drift fixes (three injected tool surfaces, all seven queues,
  `agent_queue` in the diagram). A close-out sweep in the same session
  scoped Session 14 (§3–§6 below), recorded the frontend deferral, and
  aligned README with the July 7 baseline (agency-layer summary,
  single-source-of-truth pointer, `test:a2a` added to its live-check
  list). No code changes; offline suite unchanged at 485.

OpenCnid selected the MIT License on July 6, 2026.

Your objective is to study the current code, `TRELLIS_ROADMAP.md`, and the
design record `docs/architecture/WORKSPACE_AND_MODULES.md` (sovereign on
`master`, with `docs/GLOSSARY.md`; authority: code > glossary > prose),
present a concrete design, and then implement **Session 14: kernel hardening
and the Tier-3 workspace** — design-record §11 steps 2 and 1, in that order,
on one branch and one PR: first the `sourceNodeIds` format + existence
checks at the single write path, then the harness-captured in-REPL workspace
with origin-stamped segments and stub returns. The frontend deployment
(3.3 #5 residue) is DEFERRED by owner direction — unscheduled, scope
preserved in the roadmap; do not pick it up. Design-record steps 3–6 are
owner-sequenced after this session. Do not re-plan or re-implement completed
work. RLM expands exclusively to Recursive Language Model (the MIT CSAIL
formulation).

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

- `master`: the Session 13 close-out merge (use `git log -- HANDOFF.md`
  to identify it; Session 13 landed as two squash-merged PRs).
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
```

Work on a feature branch and target `master`.

## 3. Session 14 problem statement

Two gaps, both recorded in `docs/architecture/WORKSPACE_AND_MODULES.md`
(the normative design; §ref markers below point into it):

- **The single write path enforces provenance only for non-emptiness
  (§10.2).** `_normalize_fact` in `src/rlm/trellis_tools.py` accepts any
  non-empty list as `sourceNodeIds`: a hallucinated 64-hex string, a
  uuid, or `q_0001` writes into the graph as if it were verified
  provenance. "An AST hash means verified ingested bytes" is convention,
  not enforcement — a live defect today, independent of any workspace.
- **External tool results evaporate (§3, §4).** An MCP result transits
  `call_tool`'s return value into stdout scrollback exactly once;
  nothing captures it, later turns cannot re-read it without re-calling,
  `llm_query` fan-out over accumulated findings is impossible, and the
  RLM has no Tier-3 working state at all — no plan object, no
  origin-stamped findings, no self-notes surviving a turn.

Session 14 closes both, hardening first, so Tier 3 lands into a system
where a scratch-shaped identifier cannot be written as provenance even
by a defective future change.

## 4. Required design

The design record is normative; deviations require a concrete reason and
equivalent tests, recorded in the roadmap §5 entry.

### 4.1 Write-path hardening (first commit; design record §10.2)

- `TrellisPostgres` gains `ast_hashes_exist(hashes)` → JSON list of
  MISSING hashes, one `SELECT id FROM ast_nodes WHERE id = ANY(%s)`,
  rollback-on-error mirroring `get_ast_texts`. Internal write-path use
  does not increment the model tool-call counter (leave every existing
  `_count_tool_call()` placement untouched).
- `_normalize_fact` rejects any `sourceNodeIds` element not matching
  `^[0-9a-f]{64}$` (lowercase — AST ids come from `digest('hex')`) with
  a readable `Provenance Violation` error carrying a bounded echo.
- `TrellisNeo4j.__init__` accepts an `ast_existence_check` callable;
  `_run_insight_writes` verifies the deduped union of the batch's hashes
  BEFORE opening the WRITE session; unknown hashes raise with a bounded
  list (first 5 + total count). Fail fast, no partial write, no config
  toggle — enforcement is unconditional. Wire the injection in
  `trellis_agent.py`. Distinguish infrastructure failure (raise as
  such) from verified-absent (provenance violation).

### 4.2 The workspace holder (design record §4, all eight subsections)

- New `src/rlm/trellis_workspace.py`: a holder object injected via rlms
  `custom_tools` as `trellis_workspace` (persists in REPL globals by
  construction — Appendix A). Inner state is a plain JSON-serializable
  dict (`version`, `plan`, `notes`, `segments`) — the data-not-objects
  contract. Methods return JSON STRINGS and raise real exceptions:
  `read()` (bounded index: ids/origins/sizes/plan/notes, never full
  contents), `segment(id)` (full content), `set_plan(plan)`,
  `add_note(text)`, `drop(id)`, `snapshot()` (canonical JSON; the
  future lineage seam), and harness-side
  `capture(server, tool, args_hash, content, truncated)` → creates a
  uuid4 segment stamped with `origin`/`fetchedAt`/`bytes`/`truncated`
  (+ `goalId`/`taskId` when present) and returns the stub. Stamps are
  wrapper-owned; the model can never forge them.
- Budget errors raise (`WorkspaceBudgetError` with current usage and a
  `drop()` hint); stored state is never silently truncated.

### 4.3 Capture and stub returns (design record §4.1, §4.3)

- `TrellisMcp(servers, workspace=None)`. In `call_tool`, after the
  existing truncation: with a workspace attached, deposit the result and
  return the stub
  `{"server","tool","segmentId","bytes","truncated","preview"}`
  (preview ≤ 500 chars); with no workspace, the legacy full-result
  return is byte-identical (pinned). A capture that trips the budget
  raises before returning; the result is discarded deterministically.

### 4.4 Gating and the addendum (design record §4.7)

- New `--goal-id` CLI arg on `trellis_agent.py`; `buildAgentArgs`
  forwards it when `job.goalId` exists. Inject the workspace + its
  addendum only when MCP servers are configured OR `--goal-id` is
  present; otherwise prompt and behavior are byte-identical (pinned,
  the empty-registry MCP precedent). The addendum is brace-free
  (`dict(...)` example syntax), instructs rebind-for-atomic-updates,
  and restates the hard rule: workspace ids/content never satisfy
  provenance.

### 4.5 Bounds and configuration (design record §4.7)

- `TRELLIS_WORKSPACE_MAX_SEGMENTS` (default 128, hard cap 1024) and
  `TRELLIS_WORKSPACE_MAX_BYTES` (default 4 MB, hard cap 32 MB),
  Zod-validated in `src/config/index.ts`, forwarded by `buildAgentEnv`
  (stripped when unset), re-validated defensively in Python with the
  same maxima.

### 4.6 Telemetry (design record §4.8)

- `TRELLIS_TELEMETRY` gains `workspace_ops`, `workspace_segments`,
  `workspace_bytes` — counts only; workspace content never appears in
  logs or metric labels (T16). The provenance protocol is unchanged:
  zero DATABASE tool calls is still `TRELLIS_PROTOCOL_VIOLATION`
  regardless of workspace or MCP activity.

## 5. File-level starting points

Inspect before editing:

- `docs/architecture/WORKSPACE_AND_MODULES.md` §4, §10.2, §11 steps 1–2,
  Appendix A; `docs/GLOSSARY.md`; `.agents/AGENT_CODING_GUIDELINES.md`.
- `src/rlm/trellis_tools.py` (`_normalize_fact`, `_run_insight_writes`,
  session access modes), `src/rlm/trellis_mcp.py` (`call_tool`,
  `truncate_result`, the addendum builder and its brace discipline),
  `src/rlm/trellis_agent.py` (tool construction, gating, telemetry
  payload, the `.format()` brace contract comment block).
- `src/workers/rlm_job.ts` (`buildAgentArgs`/`buildAgentEnv` — pure,
  unit-pinned), `src/config/index.ts` (validated config; AGENT_* bound
  style), `src/config/mcp_servers.ts` (bounds discipline to mirror).
- The installed rlms package (`rlm/environments/local_repl.py` — locate
  with `python -c "import rlm, os; print(os.path.dirname(rlm.__file__))"`)
  for the persistence/scaffold/exception semantics pinned in Appendix A.
- Test patterns: `scripts/test_rlm_mcp.ts` + `scripts/test_rlm_mcp.py`
  (fixture-driven Python drill with a Node runner),
  `scripts/test_rlm_sandbox.ts` + `.py` (live write-path probes),
  `scripts/fixture_mcp_server.py` (the only MCP server acceptance ever
  configures).

## 6. Test strategy and acceptance

Test first. No paid LLM calls and no external network in acceptance.

Offline (joins `npm test`, baseline 485):

- `rlm_job`: `--goal-id` forwarded when present, absent otherwise;
  workspace env vars forwarded when configured, stripped when not.
- config: workspace bounds validated with defaults and hard-cap
  rejection.

New live zero-paid drill `npm run test:rlm-workspace`
(`scripts/test_rlm_workspace.ts` driving `scripts/test_rlm_workspace.py`
against the fixture server):

- capture fires from inside `call_tool`; stub shape and preview bound;
  origin stamps present and unforgeable;
- segment ids are uuid-shaped and FAIL `^[0-9a-f]{64}$` (structural
  disjointness pin);
- budget exhaustion raises with usage; `drop()` recovers;
- gated-off runs: prompt byte-identical AND `call_tool` return
  byte-identical to pre-Session-14;
- direct-`LocalREPL` semantics pin against the installed rlms==0.1.3:
  persistence across `execute_code`, scaffold restore leaves
  `trellis_workspace` intact, rebind-vs-mutate on exception (in-place
  mutation persists, rebinding is lost), underscore names do not
  persist. An rlms upgrade that changes namespace semantics must fail
  this drill loudly.

Extend `npm run test:rlm-sandbox` with the hardening checks: malformed
hash rejected (uppercase hex, 63 chars, uuid-shaped, `q_0001`);
well-formed-but-unknown hash rejected with bounded message; real
ingested hash still writes (and cleans up); bulk variant validates the
deduped union once.

The design record §11 step-1 paired-run behavioral probe (sequential
multi-step task, workspace on/off, measuring repeated tool calls and
end-of-run workspace well-formedness) is PAID and requires explicit
owner approval — propose it with a cost estimate; do not run it
unprompted. It is not an acceptance gate.

Required close-out:

```
 npm test
 npm run build
 npm run python:check
 docker compose --profile test config --quiet
 # Run the isolated zero-LLM Compose integration (unique project name).
 npm run test:rlm-workspace
 npm run test:rlm-mcp
 npm run test:rlm-sandbox
 npm run test:agent-loop
 npm run test:a2a
 npm run drill:scale
 npm run test:repo-ingest
 npm run test:benchmark-hardening
 npm run test:entity-resolution
 npm run test:api-hardening
 npm run test:belief-recovery
 npm run test:invalidation-sweep
 git diff --check
```

Update:

- `TRELLIS_ROADMAP.md`: full-dated §5 entry with exact commands, counts,
  and any defects found; record design-record §11 steps 1–2 as complete
  only after acceptance.
- `docs/architecture/WORKSPACE_AND_MODULES.md`: mark §11 steps 1–2 done
  (dated), leaving steps 3–6 open.
- README (workspace env vars + a short External tools note that results
  are captured into the workspace when active), `.env.example`
  (workspace bounds), `API_REFERENCE.md` only if a client-visible
  contract changes (it should not — the SSE and queue contracts are
  untouched).
- `HANDOFF.md`: regenerate per §0. The next objective is owner-directed:
  design-record step 3 (module registry + module #0), step 4 (workspace
  lineage), or the deferred frontend — do not assume; ask via the PR or
  pick up the owner's recorded direction.

## 7. Guardrails

1. Never mutate an AST. The T13 hash preimage is pinned;
   `rederiveAstNodeId` stays authoritative; nothing positional is ever
   persisted as identity.
2. Never merge, rename, or delete Entity nodes. Equivalence stays an
   overlay belief.
3. Preserve provenance on every semantic node and edge.
   `write_derived_insight` remains the single agent write path — after
   this session it also enforces hash format and existence. Workspace
   ids/content and MCP output can never be passed as `sourceNodeIds`;
   external content earns citability only through the verified ingest
   path.
4. Tier 3 never satisfies the provenance protocol: an answer with zero
   database tool calls emits `TRELLIS_PROTOCOL_VIOLATION` no matter how
   many workspace or MCP operations occurred.
5. Operator control is absolute for the RLM tool surface: servers,
   tools, bounds, and credential references come from validated config
   only; no inbound payload or model completion may alter any of it.
   The workspace adds no such path. L1 (runtime config mutation) and
   L2 (runtime code hot-patching) remain forbidden.
6. Every external interaction is bounded; workspace writes are bounded
   by validated config and raise on budget — never silent truncation of
   stored state.
7. Validate at every boundary: workspace bounds cross Zod and Python
   validators; all LLM calls stay inside BullMQ workers or the RLM
   process; the orchestrator stays tool-free; `AGENT_ORACLE_ENABLED`
   and `TRELLIS_A2A_ENABLED` defaults stay pinned false.
8. Default to zero paid work and zero external network in acceptance;
   the fixture server remains the only MCP server acceptance
   configures; the paired-run probe is owner-gated.
9. Do not break existing consumers: with no workspace attached,
   `call_tool` returns and the system prompt are byte-identical;
   pre-Session-9 `rlm_queue` payloads still process; the
   `/api/agent-stream` SSE contract, the A2A v1.0 surface, and the
   backend API contract are untouched; the backend API key still never
   reaches any client bundle.
10. Respect the rlms prompt contract: extend `RLM_SYSTEM_PROMPT`, never
    replace it; no literal curly braces in anything rlms formats
    (addendum examples use `dict(...)` syntax); no rlms library
    modifications — the workspace is injected `custom_tools` state.
11. Follow the T16 observability house style: workspace content,
    queries, tool arguments/results, hashes, and credentials never
    become metric label values or log content; telemetry carries counts
    only.
12. Keep API and worker processes split; project-scoped Compose
    commands; fixtures and drills clean up only token-scoped or
    pre-snapshotted state.
13. Ship one feature branch and one PR to `master`, plain engineering
    prose, no AI attribution or generated-by trailers. Regenerate this
    file in the same PR. RLM expands exclusively to Recursive Language
    Model.

## 8. Explicit exclusions

Do not include: frontend work of any kind (deferred, unscheduled —
scope preserved in roadmap §3.3 #5); workspace lineage / Redis parking
(design record §11 step 4); the promotion path (step 5); the module
registry or module #0 (step 3); the first flywheel turn (step 6);
orchestrator tools or transcript changes; rlms `compaction` enablement;
new MCP servers, transports, or OAuth flows; A2A changes; repository-
extraction prerequisites; `ASTRef`/`EVIDENCED_BY` migration (gate closed
at 286); T13 re-hashing; rlms library modifications; paid LLM calls or
external network access as acceptance checks.
