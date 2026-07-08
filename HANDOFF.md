You are a principal systems engineer continuing development on Trellis Engine,
a provenance-preserving GraphRAG system (repository:
https://github.com/OpenCnid/trellis, local path `D:\trellis-engine` or the
current working directory). Trellis is an original OpenCnid project, not a
fork, and is unrelated to other projects named Trellis. The repository and its
documentation are the only sources of truth.

Sessions 1–15 are complete and merged:

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
  became a Zod union discriminated on `transport` (`stdio` default;
  new `http` variant carrying a Streamable HTTP URL, https required for
  public hosts) with an operator-owned auth story: `auth: {kind:
  bearer|header, header?, valueEnv}` NAMES a credential env var;
  `resolveMcpCredentialEnv` resolves it fail-fast at startup,
  `buildAgentEnv` forwards exactly the named variables, and every
  REPL-visible error is scrubbed of credential values. One
  transport-aware seam in the Python client (`_dial`); the
  allowlist/timeout/size-cap/handshake-once machinery is
  transport-agnostic. MCP protocol revision 2025-06-18 on the pinned
  `mcp==1.12.4`. Defect found and fixed there: the Docker image had
  never shipped `trellis_mcp.py`. The recorded 3.3 #8 scope is
  exhausted.
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
  drift fixes, Session 14 scoping, and README alignment.
- PR #40 — Session 14 (July 7, 2026): kernel hardening and the Tier-3
  workspace (design record §11 steps 2 + 1). **Hardening:**
  `_normalize_fact` (`src/rlm/trellis_tools.py`) rejects any
  `sourceNodeIds` element not matching `^[0-9a-f]{64}$`, and
  `_run_insight_writes` verifies the deduped union of a batch's hashes
  against `ast_nodes` BEFORE the WRITE session opens
  (`TrellisPostgres.ast_hashes_exist` injected as
  `TrellisNeo4j(ast_existence_check=...)` unconditionally). Unknown
  hashes raise with a bounded listing, no partial write; checker
  infrastructure failures propagate as `RuntimeError`, never a
  provenance verdict. **Workspace:** `src/rlm/trellis_workspace.py` —
  `TrellisWorkspace` injected via rlms `custom_tools` as
  `trellis_workspace` (non-callable ⇒ persistent REPL locals). State is
  the plain version-tagged dict `{version, plan, notes, segments}` (the
  data-not-objects contract); model surface `read()` (bounded index),
  `segment(id)`, `set_plan`, `add_note`, `drop`, `snapshot()`
  (canonical sorted-key JSON). Harness-side `capture()` mints uuid4
  segments stamped `origin{server,tool,argsHash(16 hex)}/fetchedAt/
  bytes/truncated` (+`goalId`); stamps are wrapper-owned.
  `WorkspaceBudgetError` carries usage + a `drop()` hint; stored state
  is never silently truncated. `TrellisMcp(servers, workspace=None)`
  deposits every result inside `call_tool` and returns the stub
  `{server,tool,segmentId,bytes,truncated,preview≤500}`; no workspace ⇒
  byte-identical legacy return (pinned). Gating: workspace + brace-free
  addendum injected only when MCP servers are configured OR `--goal-id`
  is present; otherwise byte-identical prompt (pinned). Bounds
  `TRELLIS_WORKSPACE_MAX_SEGMENTS` (default 128, cap 1024) /
  `TRELLIS_WORKSPACE_MAX_BYTES` (default 4 MiB, cap 32 MiB): Zod +
  Python twins. `TRELLIS_TELEMETRY` gains
  `workspace_ops`/`workspace_segments`/`workspace_bytes` (counts only).
- PR #41 — Session 15 (July 7, 2026; owner directed step 3 → step 4 on
  the PR #40 discussion): (a) the MEASURED paired-run workspace probe
  (`docs/benchmarks/WORKSPACE_PROBE_REPORT.md`: both arms correct; the
  workspace arm made the minimum 4 external calls with a well-formed
  snapshot; the legacy arm repeated every call, 8 vs 4 — n=1,
  directional) and (b) the protocol-module registry
  (`modules/<name>/` manifest + brace-free addendum;
  `src/config/modules.ts` Zod validator fail-fast at startup;
  `src/rlm/trellis_modules.py` Python twin; operator-owned
  `TRELLIS_MODULES` selection, default `["spatial-flywheel"]`, max 4,
  protocol modules only) and module #0 — the spatial-flywheel protocol
  extracted mechanically from `TRELLIS_ADDENDUM` behind the sha256
  byte-identical composed-prompt pin (`npm run test:modules`, 27
  checks). The §9.4 manifest-as-graph-entity representation is
  explicitly deferred to the first research-bearing module.

Session 16 (July 7, 2026, branch `d/vigilant-heyrovsky-724d4c`) is also
complete: **workspace lineage** (design record §11 step 4,
owner-directed). Serialize: `--workspace-out` on `trellis_agent.py`
writes the end-of-run `snapshot()` to a worker-named temp file in the
`finally` (success or failure — a failed run's partial workspace can
seed the retry); nothing new crosses stdout. Park: `rlm_worker.ts`
validates the snapshot against the Zod twin of the state dict
(`src/workers/workspace_scratch.ts`) and parks it at
`scratch:goal:<goalId>:task:<taskId>` with `SCRATCH_TTL_SECONDS`
(default 3600, cap 86400) under the per-goal
`SCRATCH_MAX_BYTES_PER_GOAL` cap (default 8 MiB, cap 64 MiB; a
goal-scoped counter key expires alongside); the completion value gains
the counts-only `workspaceRef` `{taskId, segments, bytes}`. Parking
failures degrade to "nothing parked"; a paid run is never failed over
its checkpoint. Seed: `seedTasks` on the rlm job payload (ids only,
requires `goalId`, bounded 8) resolves BEFORE anything runs — a
missing/expired reference is a readable dispatch-time failure with zero
spend — merges (notes concatenate, segments union first-wins, last
non-default plan wins), writes a seed file, and passes
`--seed-workspace`; `TrellisWorkspace.seed_from_snapshot` restores it
with stamps preserved verbatim, integrity checked (a bytes/content
mismatch is a torn seed and raises), and bounds re-enforced — an
over-budget seed fails the task fast, never silent truncation. A seeded
run always gets a workspace and appends the brace-free `SEEDED RUN`
addendum; the unseeded prompt is byte-identical to Session 14 (pinned).
The orchestrator stays tool-free and routes by reference:
`AgentTaskSpecSchema.seedFromTasks` (nullable, max 8), validated by the
goal loop against PRIOR-iteration task ids only (unknown and same-batch
ids end the goal as a typed `decision_error` before dispatch — batches
stay independent, never a blackboard); `TaskOutcome.workspaceRef`
rendered counts-only in `buildDecisionMessages`; the orchestrator
prompt teaches the field. Oracle scripts express seeded dispatches and
`RlmStubSchema.workspaceSnapshot` (data-only) parks through the
identical path, so the whole loop drills with zero LLM calls
(`test:agent-loop` 35, `test:rlm-workspace` 83; offline 536/61).

OpenCnid selected the MIT License on July 6, 2026.

Your objective is **Session 17: the promotion path** (design record §6,
§11 step 5) — the operator-gated route from a Tier-3 workspace segment
to verified, citable substrate, per §3–§6 below. Do not re-plan or
re-implement completed work. RLM expands exclusively to Recursive
Language Model (the MIT CSAIL formulation).

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
   - **Scratch parking (Session 16):** `scratch:goal:<goalId>:task:<taskId>`
     holds one task's end-of-run workspace snapshot, TTL-bounded
     (`SCRATCH_TTL_SECONDS`) and volume-capped per goal
     (`SCRATCH_MAX_BYTES_PER_GOAL` via `scratch:goal:<goalId>:bytes`).
     Redis is a parking lot for checkpoints, never a live store the
     model queries. Pure helpers (snapshot schema, merge, refs, keys)
     live in `src/workers/workspace_scratch.ts`; all I/O is in
     `rlm_worker.ts`.
4. **RLM execution, the agentic loop, and external surfaces**
   - `GET /api/rlm-stream` (API-key gated, `StreamGate` + queue-depth
     backstop) subscribes to `rlm-stream:<jobId>`, then enqueues one
     `rlm_queue` job. `src/workers/rlm_worker.ts` spawns one Python process
     per job (`trellis_agent.py`) with config forwarded via env by the pure
     `buildAgentEnv` helper in `src/workers/rlm_job.ts` (`NEO4J_*`,
     `PG_DSN`, `PYTHONPATH`, the canonical `TRELLIS_MCP_SERVERS` registry,
     exactly the credential env vars the registry's http servers name,
     the validated workspace bounds, and the canonical module selection;
     unset config values are stripped, never passed through raw).
     `buildAgentArgs` forwards `--max-iterations`, `--goal-id`, and
     (Session 16) the worker-named `--workspace-out`/`--seed-workspace`
     temp files — a queue payload can never pick filesystem paths. The
     worker publishes every stdout chunk and feeds two pure bounded
     scanners over the identical bytes: `RlmTelemetryScanner`
     (`TRELLIS_TELEMETRY:` spend line) and `RlmResultScanner`
     (`TRELLIS_RESULT:` task envelope `{status, answer, toolCalls}`).
     Job payloads are normalized by `parseRlmJobData`: pre-Session-9
     `{query, jobId}` still processes; optional `goalId`/`taskId`
     correlation, `maxIterations`, `seedTasks` (Session 16: prior task
     ids within the same goal, never content), and a data-only `stub`
     replay mode (whose optional `workspaceSnapshot` parks through the
     identical path) for zero-LLM drills. Payloads carry nothing MCP- or
     workspace-content-shaped (unit-pinned).
   - `src/rlm/trellis_agent.py` wraps the `rlms` recursive-LM library
     (model `gpt-5.4-2026-03-05`, `max_depth` 1) and injects tools via the
     rlms `custom_tools` mapping — `trellis_neo4j` (read-only Cypher plus
     the hardened single write path), `trellis_postgres`
     (`get_ast_texts`, `vector_search`, and `ast_hashes_exist` —
     write-path plumbing, never tool-call-counted), and — only when the
     operator configured servers — `trellis_mcp`
     (`src/rlm/trellis_mcp.py`), an MCP client over the pinned
     `mcp==1.12.4` speaking protocol revision 2025-06-18: allowlist
     BEFORE any I/O, double-bounded per-call timeouts,
     `TRELLIS_MCP_TRUNCATED` size caps, credential scrubbing
     (`_scrub`/`_describe_exception`), one transport-aware seam
     (`_dial`). PROVENANCE SPLIT: database tools increment
     `_count_tool_call()`; MCP calls count separately as `mcp_calls` —
     an answer with zero DATABASE tool calls emits
     `TRELLIS_PROTOCOL_VIOLATION` no matter how many MCP or workspace
     operations happened.
   - **The Tier-3 workspace (Sessions 14/16;
     `src/rlm/trellis_workspace.py`):** injected as `trellis_workspace`
     when MCP servers are configured OR the run carries `--goal-id` OR
     the run is seeded; otherwise nothing is injected and prompt and
     behavior are byte-identical (pinned by `test:rlm-workspace`). State
     is one plain JSON dict `{version, plan, notes, segments}`. With a
     workspace attached, `trellis_mcp.call_tool` captures every result
     as an origin-stamped uuid4 segment and returns a bounded stub
     (`preview≤500`); the model pulls content deliberately via
     `segment(id)` or fans `llm_query` over segments. Budgets raise
     `WorkspaceBudgetError` with usage and a `drop()` hint; stored
     state is never silently truncated. **Lineage (Session 16):**
     `snapshot()` serializes at task end (`--workspace-out`, written in
     the `finally`); `seed_from_snapshot(data, ...)` restores a parked,
     worker-merged snapshot at spawn — wrapper stamps preserved
     verbatim, torn seeds (bytes/content mismatch) and over-budget
     seeds raise before the first turn. Structural disjointness: uuid
     segment ids and 16-hex argsHashes can never match
     `^[0-9a-f]{64}$`, and the hardened write path rejects them
     independently. Tier 3 has NO provenance standing.
   - **The module registry (Session 15; `src/config/modules.ts` +
     `src/rlm/trellis_modules.py`, `modules/<name>/`):**
     `TRELLIS_ADDENDUM` = `TRELLIS_ADDENDUM_BASE` + Σ selected module
     addenda + `TRELLIS_WORKFLOW_RULES`. Selection is operator-owned via
     `TRELLIS_MODULES` (unset ⇒ default `["spatial-flywheel"]`, the
     composed prompt byte-identical to the pre-Session-15 monolith,
     sha256-pinned; `[]` ⇒ base + rules only; max 4/run). PROTOCOL
     MODULES ONLY this kernel edition — manifests declaring tools are
     rejected. Addendum files are brace-free; rubric text enters
     through the single `<<TRELLIS_RUBRIC>>` substitution token. Both
     validators are bound-for-bound twins and normalize CRLF→LF.
   - CRITICAL rlms constraints (verified against the installed
     rlms==0.1.3; pinned live by the `test:rlm-workspace` LocalREPL
     section): `custom_system_prompt` REPLACES the base REPL protocol
     prompt — Trellis EXTENDS `RLM_SYSTEM_PROMPT`; rlms runs `.format()`
     over the prompt so literal curly braces are forbidden (escape by
     doubling — see `_SAFE_RUBRIC`; addenda use `dict(...)` example
     syntax; validated name charsets keep generated listings
     structurally brace-free). `LocalREPL` persists `self.locals`
     across turns; scaffold restore touches only `RESERVED_TOOL_NAMES`
     (injected tools persist untouched); on exception, rebindings are
     lost but in-place mutations persist; underscore-prefixed names
     never persist.
   - The orchestrator (Sessions 9/16) lives in `src/core/agent/` and is
     a pure decision maker: `OrchestratorDecisionSchema` through
     `parseLlmResponse`, planner prompt never routed through rlms,
     dependency-injected `runGoalLoop` with typed failures
     (`iteration_bound`/`task_bound`/`concurrency_bound`/
     `decision_error`/`orchestrator_fail`), hard per-goal bounds
     (`AGENT_*`, single-digit-capped) and its own admission gate. The
     orchestrator has NO tools and no database access — and it routes
     workspace lineage BY REFERENCE: task specs carry `seedFromTasks`
     (prior iterations only; the loop rejects unknown and same-batch
     ids as a typed `decision_error` before any dispatch), observations
     carry counts-only `workspaceRef`s, and snapshot content never
     enters the decision context. Zero-LLM drills:
     `AGENT_ORACLE_ENABLED=true` accepts an `oracle` script —
     `npm run test:agent-loop`.
   - **The A2A server surface (Session 11)** exposes the goal loop to
     external agents: `src/api/a2a.ts` over pure modules in
     `src/core/a2a/` (`protocol.ts`, `task_record.ts`,
     `agent_card.ts`). Enabled only by `TRELLIS_A2A_ENABLED` (default
     false; the API is byte-identical when unset). The card is served
     unauthenticated from `/.well-known/agent-card.json` (public
     contract only); `POST /a2a/v1` sits behind the API key and
     requires `A2A-Version: 1.0`. Dispatch shares the SAME `StreamGate`
     + queue-depth backstop as `/api/agent-stream`; one A2A task is one
     goal (taskId = goalId), recorded in TTL-bounded Redis records
     (`a2a:task:<id>`, `A2A_TASK_TTL_SECONDS`). IORedis gotcha (found
     live in Session 11): issue `subscribe` in the SAME tick the
     connection is created — a subscribe issued after an unrelated
     await can land mid ready-check and wedge the connection in a
     reconnect loop that delivers no events.
5. **Observability and process boundaries**
   - `src/core/observability/` defines pino JSON logging and per-process
     Prometheus registries; API and workers are separate processes/
     containers. Stable dot-namespaced events; bounded metric labels only —
     queries, goals, message content, artifacts, paths, hashes, entity
     names, tool arguments, tool results, workspace content, server
     commands, URLs, and credentials never become label values or log
     content. Queue-depth gauges cover all seven queues;
     `trellis_rlm_mcp_calls_total` is label-free. Workspace and lineage
     telemetry is counts only (`workspace_*` on the `TRELLIS_TELEMETRY`
     line; `workspaceRef` and park log events carry segment and byte
     counts, never content).
6. **The frontend (DEFERRED — unscheduled, 3.3 #5 residue) and other stable subsystems**
   - `src/frontend/` is a Next.js 16.2.9 / React 19 app (its own
     `package.json` and lockfile, npm-installed separately) with one
     page: an entity search box over a force-directed graph pane
     (`react-force-graph-2d`) and a provenance pane; clicking a graph
     node highlights the exact AST text blocks that produced it
     (`SplitPaneViewer.tsx` fetches `/api/retrieve?entity=...`). Today
     it is dev-only: `next.config.ts` rewrites `/api/:path*` to
     `http://localhost:3000/:path*` with NO API-key injection, there is
     no production build wired into CI, no container, and no
     deployment documentation. `src/frontend/AGENTS.md` warns: this
     Next.js version has breaking changes vs. training data — read
     `node_modules/next/dist/docs/` before writing Next-specific code.
     These gaps are the deferred 3.3 #5 residue (owner direction,
     July 7, 2026 — third deferral); NOT this session's work unless the
     owner directs it.
   - Whole-codebase ingestion: `src/core/repository/`, `npm run
     repo:ingest`, live drill `npm run test:repo-ingest`.
   - Benchmarks: OOLONG v1 saturated baseline; anti-shortcut v2 at
     `data/oolong_pairs_dataset_hard.json`; scale evidence in
     `docs/benchmarks/SCALE_PROVENANCE_REPORT.md` and
     `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md`; the paired-run
     workspace probe in `docs/benchmarks/WORKSPACE_PROBE_REPORT.md`.
   - The fixture MCP server (`scripts/fixture_mcp_server.py`; stdio and
     Streamable HTTP with an optional required-bearer mode) is the only
     MCP server acceptance ever configures; real web-search servers are
     owner-approved runs with the allowlist printed and `mcp_calls`
     recorded. The containerized tool-server pattern is the
     `mcp-fixture` Compose service (test profile).

## 2. Current baseline

Repository state at handoff creation:

- `master`: the Session 16 merge (use `git log -- HANDOFF.md` to
  identify it; Session 16 landed as one squash-merged PR from branch
  `d/vigilant-heyrovsky-724d4c`).
- Offline baseline: `npm test` = 536 passing across 61 files
  (Session 16 added `src/workers/workspace_scratch.test.ts` and
  `src/config/scratch_bounds.test.ts`, plus seed/lineage cases across
  the rlm_job/decision/goal_loop/transcript/oracle tests).
- `npm run build` and `npm run python:check` pass.
- `npm run drill:scale`: gate CLOSED at max provenance 286; sweep growth
  2.04x in the Session 16 run (run-to-run band 1.63x–2.26x across
  Sessions 12–16; all far under the superlinear trigger).
- Live zero-LLM checks (Session 16 observed counts):
  `test:rlm-workspace` (83, was 64 — adds the `seed_from_snapshot`
  section), `test:agent-loop` (35, was 23 — adds the lineage
  park/seed/cap/missing-ref phase over real Redis),
  `test:modules` (27 — carries the byte-identical composed-prompt
  sha256 pin `abb945a6…f9b2`; recompute it in the same commit if the
  kernel prompt or rubric legitimately changes), `test:rlm-mcp` (86),
  `test:a2a` (46), `test:repo-ingest` (45),
  `test:benchmark-hardening` (24), `test:entity-resolution` (34),
  `test:api-hardening` (18), `test:rlm-sandbox` (21),
  `test:belief-recovery` (30), `test:invalidation-sweep` (17).
- Isolated Compose integration: 10 assertions (`--profile test`, unique
  project name, host ports 0 via `TRELLIS_*_HOST_PORT=0`; includes the
  containerized credentialed MCP fixture probe).
- CI target is Node 22. Session 16's local environment was Node 20.19.2,
  Python 3.13.1, Docker Compose v2, PostgreSQL 16.x, Neo4j 5.11.
- Python runtime deps are pinned in `requirements.txt` (`rlms==0.1.3`,
  `openai`, `neo4j`, `psycopg2-binary`, `unstructured`, `mcp==1.12.4`);
  `npm run python:check` verifies syntax/imports/assets.
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

## 3. Session 17 problem statement

**The promotion path (design record §6, §11 step 5).** Today "MCP
output can never be `sourceNodeIds`" is enforced structurally: the
Session 14 write path rejects anything that is not an existing AST
hash, and Tier-3 workspace content has no provenance standing. That
prohibition is only half the design — §6 turns it into a workflow:
"ephemeral intake (workspace) → verified substrate (ingest) →
compounding belief → continuous self-correction." The machinery for
every step EXCEPT the middle one already exists. A goal's tasks fetch
external content into origin-stamped segments (Session 14), those
segments survive the process as parked snapshots in Redis (Session 16:
`scratch:goal:<goalId>:task:<taskId>`, TTL-bounded), and the verified
ingest transaction (`src/core/ingestion/ingest_document.ts`) plus the
update machinery (Merkle diff → invalidation sweep → quarantine) are
production-hardened. What is missing is the operator-gated bridge:
there is no tool by which an operator can inspect a parked workspace,
select a load-bearing segment, and promote its byte-preserved content
into the verified ingest path under a stable document key — after
which insights citing the resulting AST hashes become fully
provenance-clean, and refreshed external content is contested by the
existing sweep exactly like an edited document. This is also the
prerequisite for §11 step 6: modules must cite research
`sourceNodeIds`, and the corpus they cite begins here.

## 4. Required design

Design record §6 is normative: promotion is OPERATOR-GATED (no
autonomous path from Tier 3 to Tier 1), byte-preserving, and lands in
the ordinary verified ingest path with a stable doc key so the
existing update machinery covers refreshed external content for free.

- **A pure promotion planner** (suggest
  `src/core/promotion/plan_promotion.ts`): given a parsed
  `WorkspaceSnapshot` (reuse `parseWorkspaceSnapshot`/
  `WorkspaceSnapshotSchema` from `src/workers/workspace_scratch.ts` —
  do not duplicate the schema) and a segment id, produce the exact
  ingest request `{docKey, content, origin}` or a typed refusal.
  Refuse truncated segments outright (`truncated: true` means the
  capture is NOT the source bytes — promoting a known-partial fetch
  would mint verified hashes over corrupt content); refuse empty
  content; refuse unknown segment ids with a bounded listing of what
  the snapshot does hold. Doc-key convention: the operator supplies
  `--doc-key` explicitly; recommend `web:<url>` for web content
  (stable across refreshes — the whole point) and offer a
  deterministic fallback derived from the origin stamp
  (`mcp:<server>:<tool>:<argsHash>`) for non-URL tool results.
  Validate against the existing document-key rules; never invent keys
  silently.
- **An operator CLI in the `repo:ingest` mold** (suggest
  `scripts/promote_segment.ts`, npm alias `promote`), zero-paid by
  default:
  - `npm run promote -- --goal <goalId> --task <taskId>` — LIST mode
    (default): read the parked snapshot from Redis, print each
    segment's id, origin stamps, size, truncation flag, and a bounded
    preview. Read-only; a missing/expired key is a readable failure
    naming `SCRATCH_TTL_SECONDS`.
  - `... --segment <id> --doc-key <key>` — PROMOTE mode: echo exactly
    what will be ingested (doc key, byte count, origin), then run the
    verified ingest transaction in-process (the `repo:ingest`
    precedent) with extraction policy `none` — extraction stays
    separately owner-approved spend (`--extract changed` opt-in at
    most, behind the existing block budget). Print the resulting root
    and node hashes; those hashes are what the RLM may now cite.
  - Promotion consumes a PARKED snapshot only — never a live
    workspace, never mid-goal state. One segment per invocation.
- **Origin traceability.** Record the origin stamp with the promoted
  document (inspect what the `documents` schema/ingest metadata seam
  already carries before adding anything; a genuinely new metadata
  column must be nullable and additive). The audit story "which
  server/tool/args produced these bytes, fetched when" must survive
  promotion.
- **Close the loop in the drill, not in prose:** after promoting a
  segment, a `write_derived_insight` citing the new AST hashes must
  SUCCEED through the hardened write path, and re-promoting changed
  content under the SAME doc key must version the document and drive
  the Merkle diff → invalidation sweep → contested-belief transition
  (the `test:belief-recovery` machinery is the precedent).
- **No API surface change.** No new HTTP endpoints, no A2A changes, no
  new queue. The CLI is the operator gate.

## 5. File-level starting points

Inspect before editing:

- `docs/architecture/WORKSPACE_AND_MODULES.md` §6 (the promotion
  contract), §11 step 5; `docs/GLOSSARY.md` (Promotion path, Lineage).
- `src/core/ingestion/ingest_document.ts` + `plan_ingest.ts` (the
  verified transaction and the extraction-policy/block-budget seam) and
  how `src/core/repository/` + the `repo:ingest` script drive them
  in-process (the CLI precedent, including its zero-paid default).
- `src/workers/workspace_scratch.ts` (snapshot schema, scratch keys —
  reuse, do not duplicate) and the park path in
  `src/workers/rlm_worker.ts` (Session 16).
- `src/core/graph/invalidation.ts` and the sweep drills
  (`scripts/test_belief_recovery.ts`,
  `scripts/test_invalidation_sweep.ts`) for the contested-transition
  acceptance pattern.
- `src/rlm/trellis_tools.py` (`ast_hashes_exist`, the write path the
  promoted hashes must satisfy).
- `src/config/index.ts` and `package.json` scripts (bounds and alias
  style); `.env.example`; README (the workspace/lineage sections to
  extend with the promotion workflow).

## 6. Test strategy and acceptance

Test first. No paid LLM calls and no external network in acceptance.

Offline (joins `npm test`, baseline 536):

- `plan_promotion`: truncated segment refused; empty content refused;
  unknown segment id refused with a readable listing; doc-key
  validation (explicit key honored, `mcp:` fallback derived exactly
  from the origin stamp, malformed keys rejected); the planned request
  carries the segment's bytes verbatim (no normalization, no
  trimming).
- CLI argument parsing pure helpers, if extracted (list vs promote
  mode, refusal without `--doc-key`).

Live zero-paid (new `npm run test:promotion`, plus extensions only if
they fit an existing drill better):

- Park a snapshot through the REAL path (a stub rlm job with
  `workspaceSnapshot` — the `test:agent-loop` harness precedent — or
  direct Redis setup with the production key helpers), then: list mode
  prints the segment inventory; promote mode ingests one segment with
  extraction `none`; the document exists under the doc key with
  read-back-verified AST nodes; `ast_hashes_exist` confirms the new
  hashes; a `write_derived_insight` citing them SUCCEEDS (earned
  citability, end to end); a second promotion of CHANGED content under
  the same doc key versions the document and the invalidation sweep
  contests the insight (audit-preserving quarantine). Missing parked
  snapshot and truncated-segment refusal are exercised against real
  Redis. All state token-scoped and cleaned up (graph nodes,
  documents, AST rows, scratch keys).

Required close-out (the standing block):

```
 npm test
 npm run build
 npm run python:check
 docker compose --profile test config --quiet
 # Run the isolated zero-LLM Compose integration (unique project name).
 npm run test:promotion
 npm run test:rlm-workspace
 npm run test:modules
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
- README (the promotion workflow is operator-facing) and `.env.example`
  if any new bound ships; `API_REFERENCE.md` only if a client-visible
  contract changes (it should not — §4 forbids new endpoints).
- If a new Python file ships under `src/rlm/`, add it to the Dockerfile
  `COPY` line and `check_python_runtime.py` (the Session 12 defect
  class; Sessions 14–16 kept this green — keep it that way).
- `HANDOFF.md`: regenerate per §0.

Standing owner-gated item (do NOT run unprompted): the paired-run
behavioral probe (driver `tsx scripts/probe_workspace_paired.ts`, no
npm alias, PAID — per-run owner approval). With lineage landed
(Session 16), the recorded natural follow-up is the same paired
protocol across a TWO-TASK goal, measuring whether seeded workspaces
eliminate the cross-task re-derivation the Session 15 report names
(8-vs-4 external calls). Propose it with a cost estimate; do not run
it unprompted.

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
   be passed as `sourceNodeIds`; external content earns citability ONLY
   through the verified ingest path — which is exactly what promotion
   is, and why promotion may not bypass any part of that transaction.
4. Promotion is operator-gated, absolutely: no autonomous path from
   Tier 3 to Tier 1, no API endpoint that promotes, no model output
   that triggers ingestion. Nomination is prose; promotion is a human
   running a CLI. Tier 3 never satisfies the provenance protocol: an
   answer with zero database tool calls emits
   `TRELLIS_PROTOCOL_VIOLATION` no matter how many workspace or MCP
   operations occurred.
5. Operator control is absolute for the RLM tool surface AND the module
   space: servers, tools, modules, bounds, and credential references
   come from validated config only; no inbound payload or model
   completion may alter any of it mid-run; module selection is only
   ever within the operator-registered allowlist. L1 (runtime config
   mutation) and L2 (runtime code hot-patching) remain forbidden; L3
   lands only through the recorded gates.
6. Every external interaction is bounded; workspace and scratch state
   is TTL- and byte-bounded by validated config; over-budget writes and
   over-budget seeds raise — never silent truncation of stored state.
   Durable cross-goal unverified memory stays a non-feature: TTL expiry
   of parked snapshots is BY DESIGN; permanence is earned via promotion
   only.
7. Validate at every boundary: bounds and registries cross Zod and
   Python twin validators; all LLM calls stay inside BullMQ workers or
   the RLM process; the orchestrator stays tool-free and routes lineage
   by reference only; `AGENT_ORACLE_ENABLED` and `TRELLIS_A2A_ENABLED`
   defaults stay pinned false.
8. Default to zero paid work and zero external network in acceptance;
   the fixture server remains the only MCP server acceptance
   configures; the paired-run probe is owner-gated; promotion drills
   promote fixture-produced or drill-authored bytes, never live web
   content.
9. Do not break existing consumers: with no workspace attached,
   `call_tool` returns and the system prompt are byte-identical; an
   unseeded workspace run's prompt is byte-identical to Session 14;
   with module #0 loaded the composed prompt is byte-identical to the
   pre-Session-15 monolith; pre-Session-9 `rlm_queue` payloads still
   process; the `/api/agent-stream` SSE contract, the A2A v1.0
   surface, and the backend API contract are untouched; the backend
   API key still never reaches any client bundle.
10. Respect the rlms prompt contract: extend `RLM_SYSTEM_PROMPT`, never
    replace it; no literal curly braces in anything rlms formats
    (addenda use `dict(...)` example syntax); no rlms library
    modifications.
11. Follow the T16 observability house style: workspace content, module
    addendum text, queries, tool arguments/results, hashes, promoted
    content, and credentials never become metric label values or log
    content; telemetry carries counts only.
12. Keep API and worker processes split; project-scoped Compose
    commands; fixtures and drills clean up only token-scoped or
    pre-snapshotted state.
13. Ship one feature branch and one PR to `master`, plain engineering
    prose, no AI attribution or generated-by trailers. Regenerate this
    file in the same PR. RLM expands exclusively to Recursive Language
    Model.

## 8. Explicit exclusions

Do not include: frontend work of any kind (deferred, unscheduled —
scope preserved in roadmap §3.3 #5); the first flywheel turn (design
record §11 step 6 — it builds on promotion but is its own session);
autonomous nomination or promotion machinery of any kind (the operator
gate is the feature); a promotion HTTP/A2A surface; batch promotion or
whole-snapshot promotion (one segment per invocation this edition);
tool-bearing modules or module auto-landing (the protocol-module class
must earn trust first, §9.3); the manifest-as-graph-entity
representation (recorded deferral — lands with the first
research-bearing module); orchestrator tools (routing stays by
reference); any live intra-batch workspace sharing (lineage is
inheritance between iterations, never a blackboard); durable
cross-goal scratch storage (TTL stays); rlms `compaction` enablement;
new MCP servers, transports, or OAuth flows; A2A changes;
repository-extraction prerequisites; `ASTRef`/`EVIDENCED_BY` migration
(gate closed at 286); T13 re-hashing; rlms library modifications;
weakening or toggling the Session 14 write-path enforcement, the
Session 15 composition pins, or the Session 16 lineage byte-identity
pins; paid LLM calls or external network access as acceptance checks.
