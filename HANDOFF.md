You are a principal systems engineer continuing development on Trellis Engine,
a provenance-preserving GraphRAG system (repository:
https://github.com/OpenCnid/trellis, local path `D:\trellis-engine` or the
current working directory). Trellis is an original OpenCnid project, not a
fork, and is unrelated to other projects named Trellis. The repository and its
documentation are the only sources of truth.

Sessions 1–14 are complete and merged:

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
  binding, hand-rolled with Zod; zero new dependencies) over the
  existing goal loop. `TRELLIS_A2A_ENABLED` (default false; unset ⇒
  byte-identical API, drill-pinned) mounts the public well-known Agent
  Card plus one key-gated JSON-RPC endpoint (`POST /a2a/v1`) whose
  `SendMessage`/`SendStreamingMessage`/`GetTask`/`CancelTask` dispatch
  goals through the SAME `StreamGate` + queue-depth gates and per-goal
  bounds as `/api/agent-stream`, record lifecycle in TTL-bounded Redis
  task records, and translate goal events to A2A task states through
  the pure `src/core/a2a/task_record.ts`. Zero-paid acceptance:
  `npm run test:a2a` (46 checks).
- PR #36 — remote MCP transports and the containerized tool-server
  pattern (Session 12, 3.3 #8 third and closing slice): the registry
  became a Zod union discriminated on `transport` (`stdio` default —
  every pre-Session-12 value parses unchanged; new `http` variant
  carrying a Streamable HTTP URL, https required for public hosts,
  plain http only for loopback/RFC1918/dot-free private hosts) with an
  operator-owned auth story: `auth: {kind: bearer|header, header?,
  valueEnv}` NAMES a credential env var; `resolveMcpCredentialEnv`
  resolves it fail-fast at startup, `buildAgentEnv` forwards exactly
  the named variables, and every REPL-visible error is scrubbed of
  credential values (`_scrub`/`_describe_exception` — anyio
  ExceptionGroups are flattened so a 401 stays diagnosable). One
  transport-aware seam in the Python client (`_dial`); the
  allowlist/timeout/size-cap/handshake-once machinery is
  transport-agnostic. MCP protocol revision 2025-06-18 on the pinned
  `mcp==1.12.4`; the deprecated HTTP+SSE transport is unsupported.
  Defect found and fixed there: the Docker image had never shipped
  `trellis_mcp.py`. The recorded 3.3 #8 scope is exhausted.
- PRs #37/#38 — Session 13 (July 7, 2026): documentation, context
  alignment, and architectural consolidation (owner-redirected; the
  frontend deployment deferred unscheduled, scope preserved in roadmap
  §3.3 #5). The design record `docs/architecture/WORKSPACE_AND_MODULES.md`
  (three-tier trust model, the Tier-3 workspace contract, cross-task
  lineage, the promotion path, the L0–L3 self-editing ladder with
  L1/L2 forbidden and L3 as the capability flywheel's mechanism, the
  kernel/userspace boundary, the module manifest/registry/gates design
  with module #0, and a six-step implementation sequence),
  `docs/GLOSSARY.md` (authority: code > glossary > prose), roadmap §1
  drift fixes, Session 14 scoping, and README alignment. No code
  changes; offline suite was 485 across 57 files.
- Session 14 (July 7, 2026, branch `d/jovial-hertz-399138`) — kernel
  hardening and the Tier-3 workspace (design record §11 steps 2 + 1, in
  that order, one PR). **Hardening:** `_normalize_fact`
  (`src/rlm/trellis_tools.py`) rejects any `sourceNodeIds` element not
  matching `^[0-9a-f]{64}$` (module-level `AST_HASH_PATTERN`, bounded
  80-char echo), and `_run_insight_writes` verifies the deduped union
  of a batch's hashes against `ast_nodes` BEFORE the WRITE session
  opens — `TrellisPostgres.ast_hashes_exist(hashes)` (one `ANY()`
  select returning the JSON list of MISSING hashes, deliberately not
  tool-call-counted) injected as
  `TrellisNeo4j(ast_existence_check=...)` unconditionally by
  `trellis_agent.py`. Unknown hashes raise listing the first 5 + total
  count, no partial write; checker infrastructure failures propagate as
  `RuntimeError`, never a provenance verdict. **Workspace:** new
  `src/rlm/trellis_workspace.py` — `TrellisWorkspace` injected via rlms
  `custom_tools` as `trellis_workspace` (non-callable ⇒ persistent REPL
  locals by construction). State is the plain version-tagged dict
  `{version, plan, notes, segments}` (the data-not-objects contract);
  model-visible methods return JSON strings and raise real exceptions —
  `read()` (bounded index, never contents), `segment(id)`,
  `set_plan(plan)` (JSON round-trip enforced), `add_note(text)`,
  `drop(id)`, `snapshot()` (canonical sorted-key JSON — the lineage
  seam). Harness-side `capture()` mints uuid4 segments stamped
  `origin{server,tool,argsHash(16 hex)}/fetchedAt/bytes/truncated`
  (+`goalId` when present); stamps are wrapper-owned.
  `WorkspaceBudgetError` carries usage + a `drop()` hint; stored state
  is never silently truncated. `TrellisMcp(servers, workspace=None)`
  deposits every result inside `call_tool` and returns the stub
  `{server,tool,segmentId,bytes,truncated,preview≤500}`; no workspace ⇒
  byte-identical legacy return (pinned). Gating: workspace + brace-free
  addendum injected only when MCP servers are configured OR `--goal-id`
  is present (new CLI arg; `buildAgentArgs` forwards it when
  `job.goalId` exists); otherwise byte-identical prompt (pinned).
  Bounds `TRELLIS_WORKSPACE_MAX_SEGMENTS` (default 128, cap 1024) /
  `TRELLIS_WORKSPACE_MAX_BYTES` (default 4 MiB, cap 32 MiB): Zod schema
  + Python `parse_workspace_bounds` twins; `buildAgentEnv` forwards
  validated values and strips raw inherited ones. `TRELLIS_TELEMETRY`
  gains `workspace_ops`/`workspace_segments`/`workspace_bytes` (counts
  only; Node scanner degrades missing fields to 0). The Docker image
  `COPY` line and `python:check` ship the new module (the Session 12
  missing-module defect class, closed proactively). Zero-paid
  acceptance: NEW `npm run test:rlm-workspace` (64 checks, including a
  direct-`LocalREPL` rlms==0.1.3 semantics pin) and the extended
  `npm run test:rlm-sandbox` (21 checks, was 4 — its old probe wrote
  with a fake hash, exactly what hardening now forbids; rewritten
  around a token-scoped real AST row). Offline suite 485→493. The paid
  paired-run behavioral probe was NOT run (owner-gated; proposed in the
  PR with a cost estimate).

OpenCnid selected the MIT License on July 6, 2026.

Your objective is **Session 15, which begins with an owner decision**:
the roadmap's first unstruck §4 row is "remaining design-record steps
(§11 steps 3–6), owner-sequenced — order to be recorded when directed."
The Session 14 PR asked the owner to choose among design-record step 3
(module registry + module #0), step 4 (workspace lineage), and the
deferred frontend. **Check the roadmap §4 table and the Session 14 PR
discussion for the recorded direction before doing anything else.** If a
direction is recorded, that is the objective — re-derive §4–§6 from the
design record at full concreteness before implementing. If not, §3–§6
below carry the RECOMMENDED DEFAULT (step 3: module registry +
module #0, the design record's own dependency order); state the
assumption in the PR. Do not re-plan or re-implement completed work. RLM
expands exclusively to Recursive Language Model (the MIT CSAIL
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
   - **Session 14 (kernel):** the single agent write path
     (`write_derived_insight`/`write_derived_insights` →
     `_normalize_fact` → `_run_insight_writes` in
     `src/rlm/trellis_tools.py`) ENFORCES provenance: every
     `sourceNodeIds` element must match `^[0-9a-f]{64}$` AND exist in
     `ast_nodes` (deduped batch union, checked via the injected
     `ast_existence_check` before the WRITE session opens). "An AST hash
     means verified ingested bytes" is enforcement, not convention.
     Never weaken or make this configurable.
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
     exactly the credential env vars the registry's http servers name —
     resolved fail-fast at startup — and, Session 14, the validated
     workspace bounds; unset config values are stripped, never passed
     through raw). `buildAgentArgs` forwards `--max-iterations` and
     `--goal-id` when present. The worker publishes every stdout chunk
     and feeds two pure bounded scanners over the identical bytes:
     `RlmTelemetryScanner` (`TRELLIS_TELEMETRY:` spend line, carrying
     `mcp_calls` and `workspace_ops`/`workspace_segments`/
     `workspace_bytes`) and `RlmResultScanner` (`TRELLIS_RESULT:` task
     envelope `{status, answer, toolCalls}`; shared buffering in
     `line_scanner.ts`). Job payloads are normalized by
     `parseRlmJobData`: pre-Session-9 `{query, jobId}` still processes;
     optional `goalId`/`taskId` correlation, `maxIterations`, and a
     data-only `stub` replay mode for zero-LLM drills. Payloads carry
     nothing MCP- or workspace-shaped (unit-pinned).
   - `src/rlm/trellis_agent.py` wraps the `rlms` recursive-LM library
     (model `gpt-5.4-2026-03-05`, `max_depth` 1) and injects tools via the
     rlms `custom_tools` mapping — `trellis_neo4j` (read-only Cypher via
     `default_access_mode=READ`, plus the hardened single write path
     `write_derived_insight`/`write_derived_insights`), `trellis_postgres`
     (`get_ast_texts`, `vector_search`, and `ast_hashes_exist` — the
     latter is write-path plumbing and never increments the tool-call
     counter), and — only when the operator configured servers —
     `trellis_mcp` (`src/rlm/trellis_mcp.py`): an MCP client over the
     pinned `mcp==1.12.4` SDK speaking protocol revision 2025-06-18.
     The registry (`src/config/mcp_servers.ts`, Python twin
     bound-for-bound identical) is a union discriminated on `transport`:
     `stdio` servers are spawned from explicit argument vectors; `http`
     servers are dialed over Streamable HTTP (https required for public
     hosts), optionally with env-referenced credentials, every
     REPL-visible error scrubbed. One transport-aware seam (`_dial`);
     handshake-once inside a long-lived asyncio task, allowlist BEFORE
     any I/O, double-bounded per-call timeouts, `TRELLIS_MCP_TRUNCATED`
     size caps, close-in-`finally` — all transport-agnostic. PROVENANCE
     SPLIT: database tools increment `_count_tool_call()`; MCP calls
     increment their own counter reported as `mcp_calls` — an answer
     with zero DATABASE tool calls emits `TRELLIS_PROTOCOL_VIOLATION`
     no matter how many MCP or workspace operations happened.
   - **The Tier-3 workspace (Session 14;
     `src/rlm/trellis_workspace.py`):** injected as `trellis_workspace`
     when MCP servers are configured OR the run carries `--goal-id`;
     otherwise nothing is injected and prompt/behavior are
     byte-identical (pinned by `test:rlm-workspace`). The holder's state
     is one plain JSON-serializable dict
     `{version, plan, notes, segments}` — the data-not-objects contract.
     With a workspace attached, `trellis_mcp.call_tool` captures every
     result INSIDE the call as an origin-stamped uuid4 segment (stamps
     wrapper-owned: server, tool, 16-hex argsHash, fetchedAt, bytes,
     truncated, goalId) and returns the bounded stub
     `{server,tool,segmentId,bytes,truncated,preview≤500}`; the model
     pulls full content deliberately via `segment(id)` or fans
     `llm_query` over segments (recursion-over-variables applied to
     external knowledge). Model surface: `read()` (bounded index),
     `segment(id)`, `set_plan`, `add_note`, `drop`, `snapshot()`
     (canonical JSON — the seam step 4's serialize/park/seed lineage
     will use). Budgets raise `WorkspaceBudgetError` with usage and a
     `drop()` hint — stored state is never silently truncated.
     Structural disjointness: uuid segment ids and 16-hex argsHashes can
     never match `^[0-9a-f]{64}$`, and the hardened write path rejects
     them independently. Tier 3 has NO provenance standing.
   - CRITICAL rlms constraints (verified against the installed
     rlms==0.1.3; pinned live by the `test:rlm-workspace` LocalREPL
     section): `custom_system_prompt` REPLACES the base REPL protocol
     prompt — Trellis EXTENDS `RLM_SYSTEM_PROMPT` via `TRELLIS_ADDENDUM`
     plus the MCP and workspace addenda; rlms runs `.format()` over the
     prompt so literal curly braces are forbidden (escape by doubling —
     see `_SAFE_RUBRIC`; addenda use `dict(...)` example syntax; the
     MCP/module name charset `^[a-z][a-z0-9_-]*$` keeps generated
     listings structurally brace-free). `LocalREPL` persists
     `self.locals` across turns; scaffold restore touches only
     `RESERVED_TOOL_NAMES` (injected tools persist untouched); on
     exception, rebindings are lost but in-place mutations persist
     (harness capture survives model errors in the same block;
     model-side atomic updates should build-new-then-rebind);
     underscore-prefixed names never persist.
   - The orchestrator (Session 9) lives in `src/core/agent/` and is a
     pure decision maker: `OrchestratorDecisionSchema` through
     `parseLlmResponse`, planner prompt never routed through rlms,
     dependency-injected `runGoalLoop` with typed failures
     (`iteration_bound`/`task_bound`/`concurrency_bound`/
     `decision_error`/`orchestrator_fail`), `agent_worker.ts` +
     `GET /api/agent-stream` with hard per-goal bounds (`AGENT_*`,
     single-digit-capped) and its own admission gate. The orchestrator
     has NO tools and no database access — tools belong to the RLM
     sub-agent; that split is deliberate and stays. Zero-LLM drills:
     `AGENT_ORACLE_ENABLED=true` accepts an `oracle` script —
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
     names, tool arguments, tool results, workspace content, server
     commands, URLs, and credentials never become label values or log
     content. Queue-depth gauges cover all seven queues;
     `trellis_rlm_mcp_calls_total` is label-free. Workspace telemetry is
     counts only on the `TRELLIS_TELEMETRY` line; no Prometheus metrics
     were added for it in Session 14 (revisit only with a concrete
     operational need).
6. **The frontend (DEFERRED — unscheduled, 3.3 #5 residue) and other stable subsystems**
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
     backend rejects keyless requests whenever `API_KEY` is set.
     `src/frontend/AGENTS.md` warns: this Next.js version has breaking
     changes vs. training data — read `node_modules/next/dist/docs/`
     before writing Next-specific code. These gaps are the deferred
     3.3 #5 residue (owner direction, July 7, 2026 — third deferral) —
     scope preserved in the roadmap; NOT this session's work unless the
     owner directs it.
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

- `master`: the Session 14 merge (use `git log -- HANDOFF.md` to
  identify it; Session 14 landed as one squash-merged PR from branch
  `d/jovial-hertz-399138`).
- Offline baseline: `npm test` = 493 passing across 58 files.
- `npm run build` and `npm run python:check` pass.
- `npm run drill:scale`: gate CLOSED at max provenance 286; sweep growth
  1.85x in the Session 14 run against 5.77x fact growth (run-to-run
  variance around Session 12's 1.63x; both far under the superlinear
  trigger).
- Live zero-LLM checks (Session 14 observed counts):
  `test:rlm-workspace` (64, new), `test:rlm-mcp` (86), `test:a2a` (46),
  `test:agent-loop` (23), `test:repo-ingest` (45),
  `test:benchmark-hardening` (24), `test:entity-resolution` (34 — the
  previously recorded 33 was a stale count, not a behavior change),
  `test:api-hardening` (18), `test:rlm-sandbox` (21, extended from 4),
  `test:belief-recovery` (30), `test:invalidation-sweep` (17).
- Isolated Compose integration: 10 assertions (`--profile test`, unique
  project name, host ports 0; includes the containerized credentialed
  MCP fixture probe and an image build that ships
  `trellis_workspace.py`).
- CI target is Node 22. Session 14's local environment was Node 20.19.2,
  Python 3.13.1, Docker Compose v2, PostgreSQL 16.x, Neo4j 5.11.
- Python runtime deps are pinned in `requirements.txt` (`rlms==0.1.3`,
  `openai`, `neo4j`, `psycopg2-binary`, `unstructured`, `mcp==1.12.4`);
  `npm run python:check` verifies syntax/imports/assets, including
  `trellis_workspace.py`.
- The frontend has NO offline tests and NO CI coverage today.

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

## 3. Session 15 problem statement

**First: resolve the owner decision.** The roadmap's first unstruck §4
row is "remaining design-record steps (§11 steps 3–6), owner-sequenced —
order to be recorded when directed." The Session 14 PR asked the owner
to choose among design-record step 3 (module registry + module #0),
step 4 (workspace lineage), and the deferred frontend. If a direction is
recorded in the roadmap or the PR thread, that is the objective —
re-derive §4–§6 from `docs/architecture/WORKSPACE_AND_MODULES.md` at
this file's level of concreteness before implementing. What follows is
the RECOMMENDED DEFAULT: **step 3**, per the design record's dependency
ordering (format → safety → **loader** → transport → permanence →
self-modification).

**Step 3 problem (design record §9, §9.5, §11 step 3).** The
spatial-flywheel protocol — the mandatory TREC classification workflow —
is fused into the monolithic `TRELLIS_ADDENDUM` string in
`src/rlm/trellis_agent.py`. It is already a module in everything but
form: a purpose-specific cognitive protocol with its own versioned asset
(`trec_rubric.json`, the single-source precedent shared with the Phase 5
verifier). Because it is fused, no capability can be added, versioned,
retired, or contested without hand-editing the kernel prompt, and the
capability flywheel (design record §2) has no substrate: no registry to
land agent-authored modules into, no loader to compose them, no
manifest-as-graph-entity representation to let the invalidation sweep
contest a module whose research basis dies (§9.4 — recorded as NOT
inherited for free). Module #0 — extracting the spatial-flywheel
protocol into the first registry entry behind a byte-identical
composed-prompt pin — is the loader's acceptance test with zero new
capability risk.

## 4. Required design (for the recommended step 3; re-derive if the owner directs otherwise)

The design record §9 is normative; deviations require a concrete reason
and equivalent tests, recorded in the roadmap §5 entry.

- **Manifest schema (§9.1).** A module is a versioned
  document-plus-assets artifact under `modules/<name>/` (manifest plus a
  brace-free addendum text file), validated by a Zod schema in a new
  `src/config/modules.ts` with a bound-for-bound Python twin: name
  charset `^[a-z][a-z0-9_-]*$` (the `MCP_NAME_PATTERN` discipline, so
  generated prompt listings stay structurally brace-free), integer
  `version`, one-sentence `purpose`, `research.sourceNodeIds` (AST
  hashes; may be empty for module #0 — it predates the promotion path),
  `addendum` path, optional namespaced `tools` (EMPTY this session —
  protocol modules only), hard-capped `bounds` (suggested
  `addendumMaxBytes` 8192), `acceptance.zeroPaid` naming a drill,
  `status: active|contested|retired`, `kernelCompat: 1`. Addendum text
  is validated brace-free and size-capped at registry load.
- **Registry + composition (§9.2).** Operator-configured selection (an
  env-named registry, the `TRELLIS_MCP_SERVERS` pattern; forwarded to
  the child by `buildAgentEnv`, re-validated defensively in Python):
  composed system prompt = `RLM_SYSTEM_PROMPT` + the residual base
  `TRELLIS_ADDENDUM` + Σ selected module addenda (+ MCP + workspace
  addenda) + query, with deterministic ordering and a hard cap on
  modules per run (suggested 4). Selection only ever WITHIN the
  registered allowlist (Guardrail 5). Empty registry ⇒ byte-identical
  prompt (pinned).
- **Module #0 (§9.5).** Extract the spatial-flywheel protocol section of
  `TRELLIS_ADDENDUM` into `modules/spatial-flywheel/`; the default
  configuration loads it, and the composed prompt is pinned
  BYTE-IDENTICAL to today's `SYSTEM_PROMPT` — the loader proves itself
  with zero behavior change. Keep the `_SAFE_RUBRIC` splice semantics
  intact (the rubric stays the versioned single source; decide whether
  the module addendum references it via the same escape-by-doubling
  splice, and pin whichever you choose).
- **Manifest-as-graph-entity (§9.4).** Represent registered modules as
  graph entities citing their `research.sourceNodeIds` so the existing
  invalidation sweep can reach them. Module #0 may carry empty research
  provenance and therefore no graph entity yet — decide and record. If
  this half is too large for one session, defer it explicitly to the
  step-6 flywheel turn with the reason recorded in the roadmap — do not
  silently drop it.
- **Gates (§9.3).** This session lands the protocol-module class only:
  automated brace/charset/size validation + zero-paid drill + human PR
  review. No auto-landing; tool-bearing modules and kernel changes stay
  out of scope.

## 5. File-level starting points

Inspect before editing:

- `docs/architecture/WORKSPACE_AND_MODULES.md` §9 (all subsections),
  §9.5, §11 step 3, §12 corrections ledger; `docs/GLOSSARY.md`;
  `.agents/AGENT_CODING_GUIDELINES.md`.
- `src/rlm/trellis_agent.py` (`TRELLIS_ADDENDUM`, `_SAFE_RUBRIC`, the
  `.format()` brace-contract comment block, the Session 14
  workspace-gating block — the composition point new module addenda
  join), `src/rlm/trellis_mcp.py` (`build_mcp_addendum` — the
  brace-free composition discipline), `src/rlm/trellis_workspace.py`
  (`build_workspace_addendum`, `parse_workspace_bounds` — the
  Python-twin validation pattern).
- `src/config/mcp_servers.ts` (the registry-validation pattern to
  mirror), `src/config/index.ts` (where the module registry config
  lands), `src/workers/rlm_job.ts` (`buildAgentEnv`/`buildAgentArgs` —
  pure, unit-pinned forwarding).
- `src/rlm/trec_rubric.json` and its loading in `trellis_tools.py`
  (the versioned-asset precedent).
- Test patterns: `scripts/test_rlm_workspace.ts`/`.py` (the freshest
  wrapper+drill pair, including prompt byte-identity pins),
  `src/config/workspace_bounds.test.ts` (the config-test pattern),
  `scripts/test_rlm_mcp.py` §2 (addendum hygiene checks).

## 6. Test strategy and acceptance

Test first. No paid LLM calls and no external network in acceptance.

Offline (joins `npm test`, baseline 493):

- manifest/registry validation twins: valid manifest parses; bad
  names/versions/sizes rejected; addendum brace and size validation;
  duplicate module names rejected; the modules-per-run cap; empty
  registry means no modules.
- composition purity: deterministic ordering; composed-prompt assembly
  as a pure function pinned by unit test.

New live zero-paid drill `npm run test:modules` (or extend an existing
drill — decide and record):

- **The byte-identical pin (the session's most important check):** the
  composed prompt with module #0 loaded equals the pre-extraction
  `SYSTEM_PROMPT` byte-for-byte; the empty-registry composed prompt
  equals `RLM_SYSTEM_PROMPT` + the residual base addendum.
- brace-freedom of every composed prompt; the rubric splice unchanged;
  the Zod and Python validators agree on the same manifest corpus
  (cross-language contract).
- If manifest-as-graph-entity ships: the invalidation sweep contests a
  module whose research hash is orphaned (fixture-scoped, cleaned up).

Required close-out (the standing block):

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
  and any defects found; record the completed design-record step in §4
  and in the design record §11.
- README and `.env.example` (the module registry is operator-facing
  configuration); `API_REFERENCE.md` only if a client-visible contract
  changes (it should not).
- If a new Python file ships under `src/rlm/`, add it to the Dockerfile
  `COPY` line and `check_python_runtime.py` (the Session 12 defect
  class; Session 14 kept this green — keep it that way).
- `HANDOFF.md`: regenerate per §0.

Standing owner-gated item (do NOT run unprompted): the design record §11
step-1 paired-run behavioral probe (a sequential multi-step task, paired
runs with the workspace on/off, measuring repeated tool calls,
end-of-run workspace well-formedness, and answer correctness) is PAID;
it was proposed in the Session 14 PR with a cost estimate and awaits
approval. If approved, run it under its recorded protocol and record
results in `docs/benchmarks/` and the roadmap.

## 7. Guardrails

1. Never mutate an AST. The T13 hash preimage is pinned;
   `rederiveAstNodeId` stays authoritative; nothing positional is ever
   persisted as identity.
2. Never merge, rename, or delete Entity nodes. Equivalence stays an
   overlay belief.
3. Preserve provenance on every semantic node and edge.
   `write_derived_insight` remains the single agent write path, and its
   Session 14 enforcement (hash format + `ast_nodes` existence, checked
   before the WRITE session opens) is kernel — never weaken, bypass, or
   make it configurable. Workspace ids/content and MCP output can never
   be passed as `sourceNodeIds`; external content earns citability only
   through the verified ingest path.
4. Tier 3 never satisfies the provenance protocol: an answer with zero
   database tool calls emits `TRELLIS_PROTOCOL_VIOLATION` no matter how
   many workspace or MCP operations occurred.
5. Operator control is absolute for the RLM tool surface AND the module
   space: servers, tools, modules, bounds, and credential references
   come from validated config only; no inbound payload or model
   completion may alter any of it mid-run; module selection is only ever
   within the operator-registered allowlist. L1 (runtime config
   mutation) and L2 (runtime code hot-patching) remain forbidden; L3
   lands only through the recorded gates.
6. Every external interaction is bounded; workspace writes are bounded
   by validated config and raise on budget — never silent truncation of
   stored state; module addenda are size-capped and brace-validated at
   registry load.
7. Validate at every boundary: bounds and registries cross Zod and
   Python twin validators; all LLM calls stay inside BullMQ workers or
   the RLM process; the orchestrator stays tool-free;
   `AGENT_ORACLE_ENABLED` and `TRELLIS_A2A_ENABLED` defaults stay
   pinned false.
8. Default to zero paid work and zero external network in acceptance;
   the fixture server remains the only MCP server acceptance
   configures; the paired-run probe is owner-gated.
9. Do not break existing consumers: with no workspace attached,
   `call_tool` returns and the system prompt are byte-identical; with an
   empty module registry the composed prompt is byte-identical; with
   module #0 loaded the composed prompt is byte-identical to today's
   `SYSTEM_PROMPT`; pre-Session-9 `rlm_queue` payloads still process;
   the `/api/agent-stream` SSE contract, the A2A v1.0 surface, and the
   backend API contract are untouched; the backend API key still never
   reaches any client bundle.
10. Respect the rlms prompt contract: extend `RLM_SYSTEM_PROMPT`, never
    replace it; no literal curly braces in anything rlms formats
    (addenda use `dict(...)` example syntax; validated name charsets
    keep generated listings structurally brace-free); no rlms library
    modifications.
11. Follow the T16 observability house style: workspace content, module
    addendum text, queries, tool arguments/results, hashes, and
    credentials never become metric label values or log content;
    telemetry carries counts only.
12. Keep API and worker processes split; project-scoped Compose
    commands; fixtures and drills clean up only token-scoped or
    pre-snapshotted state.
13. Ship one feature branch and one PR to `master`, plain engineering
    prose, no AI attribution or generated-by trailers. Regenerate this
    file in the same PR. RLM expands exclusively to Recursive Language
    Model.

## 8. Explicit exclusions

Do not include (unless the owner's recorded direction for Session 15
says otherwise): frontend work of any kind (deferred, unscheduled —
scope preserved in roadmap §3.3 #5); workspace lineage / Redis parking
(design record §11 step 4); the promotion path (step 5); the first
flywheel turn (step 6); tool-bearing modules or module auto-landing
(the protocol-module class must earn trust first, §9.3); orchestrator
tools or transcript changes; rlms `compaction` enablement; new MCP
servers, transports, or OAuth flows; A2A changes; repository-extraction
prerequisites; `ASTRef`/`EVIDENCED_BY` migration (gate closed at 286);
T13 re-hashing; rlms library modifications; weakening or toggling the
Session 14 write-path enforcement; paid LLM calls or external network
access as acceptance checks.
