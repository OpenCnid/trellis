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
concrete design, and then implement **Session 10: external tools for the RLM
sub-agent — MCP first (roadmap item 3.3 #8, owner-directed July 7, 2026)**.
The agentic sub-agent must gain an operator-configured Model Context Protocol
(MCP) client surface, with **web search as the first tool**, without weakening
the provenance invariants or the zero-paid-work acceptance posture. A2A
(agent-to-agent) interoperability and further tool expansion are the recorded
follow-on (sequencing row 2) — not this session. Do not re-plan or
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
4. **RLM execution and the agentic loop (Session 9; THIS session extends
   the RLM's tool surface)**
   - `GET /api/rlm-stream` (API-key gated, `StreamGate` + queue-depth
     backstop) subscribes to `rlm-stream:<jobId>`, then enqueues one
     `rlm_queue` job. `src/workers/rlm_worker.ts` spawns one Python process
     per job (`trellis_agent.py`) with config forwarded via env
     (`NEO4J_*`, `PG_DSN`, `PYTHONPATH` passthrough), publishes every
     stdout chunk, and feeds two pure bounded scanners over the identical
     bytes: `RlmTelemetryScanner` (`TRELLIS_TELEMETRY:` spend line) and
     `RlmResultScanner` (`TRELLIS_RESULT:` task envelope
     `{status, answer, toolCalls}`; `src/core/observability/rlm_result.ts`,
     shared buffering in `line_scanner.ts`). The worker's completion value
     is the parsed envelope + telemetry (`RlmJobCompletion`). Job payloads
     are normalized by `src/workers/rlm_job.ts`: pre-Session-9
     `{query, jobId}` still processes; optional `goalId`/`taskId`
     correlation, `maxIterations` (forwarded as `--max-iterations`), and a
     data-only `stub` replay mode for zero-LLM drills.
   - `src/rlm/trellis_agent.py` wraps the `rlms` recursive-LM library
     (model `gpt-5.4-2026-03-05`, `max_depth` 1) and injects tools via the
     rlms `custom_tools` mapping — TODAY exactly two objects from
     `src/rlm/trellis_tools.py`: `trellis_neo4j` (read-only Cypher via
     `default_access_mode=READ`, plus the single write path
     `write_derived_insight`/`write_derived_insights`, which REQUIRES
     non-empty `sourceNodeIds` AST hashes) and `trellis_postgres`
     (`get_ast_texts`, `vector_search`). Wrapper discipline: every tool
     method returns a JSON STRING; database errors RAISE so the REPL
     surfaces real tracebacks for self-correction; every database tool
     invocation increments `_count_tool_call()`, and an answer with zero
     database tool calls emits `TRELLIS_PROTOCOL_VIOLATION` (no
     provenance) and a `protocol_violation` result envelope.
   - CRITICAL rlms constraint: `custom_system_prompt` REPLACES the base
     REPL protocol prompt. Trellis EXTENDS `RLM_SYSTEM_PROMPT` via
     `TRELLIS_ADDENDUM`, and rlms runs `.format()` over the prompt so
     literal curly braces are forbidden there (escape by doubling — see
     `_SAFE_RUBRIC`). Any tool listing added to the addendum must obey
     this.
   - The orchestrator (Session 9) lives in `src/core/agent/` and is a
     pure decision maker: Zod decision schema through `parseLlmResponse`,
     planner prompt never routed through rlms, dependency-injected
     `runGoalLoop` with typed failures, `agent_worker.ts` +
     `GET /api/agent-stream` with hard per-goal bounds. The orchestrator
     has NO tools and no database access — tools belong to the RLM
     sub-agent, and that split is deliberate and stays.
5. **Observability and process boundaries**
   - `src/core/observability/` defines pino JSON logging and per-process
     Prometheus registries; API and workers are separate processes/
     containers. Stable dot-namespaced events; bounded metric labels only —
     queries, goals, paths, hashes, and entity names never become label
     values. Queue-depth gauges cover all seven queues.
6. **Other subsystems (stable, not this session's subject)**
   - Whole-codebase ingestion: `src/core/repository/`, `npm run
     repo:ingest`, live drill `npm run test:repo-ingest`.
   - Benchmarks: OOLONG v1 saturated baseline; anti-shortcut v2 at
     `data/oolong_pairs_dataset_hard.json`; scale evidence in
     `docs/benchmarks/SCALE_PROVENANCE_REPORT.md` and
     `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md`.
   - Frontend: Next.js 16 app in `src/frontend/` with a dev-only proxy —
     deployment twice deferred by owner redirects (sequencing row 3).

## 2. Current baseline

Repository state at handoff creation:

- `master`: the Session 9 PR merge (branch `session-9-agentic-loop`, PR
  #33; use `git log -- HANDOFF.md` to identify it).
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
- Python runtime deps are pinned in `requirements.txt` (`rlms==0.1.3`,
  `openai`, `neo4j`, `psycopg2-binary`, `unstructured`);
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

## 3. Session 10 problem statement

The agentic loop can decompose a goal, but every task still bottoms out in
the same two databases.

- **The sub-agent's world is two tools.** `trellis_agent.py` injects
  exactly `trellis_neo4j` and `trellis_postgres` via rlms `custom_tools`.
  There is no web search, no external document access, no way to consult
  anything that was not previously ingested. A goal like "check whether
  the graph's claim about X still matches the vendor's current docs" is
  unanswerable by construction.
- **The extension point exists and is proven.** `custom_tools` accepts
  arbitrary Python objects whose methods become REPL-callable;
  `trellis_tools.py` establishes the wrapper discipline (JSON-string
  returns, raising errors with real tracebacks for REPL self-correction,
  call counting, bounded snippets). Adding tools is injection plus an
  addendum listing — but nothing in the repo speaks MCP, and no
  configuration surface describes external tool servers.
- **Provenance is the hard boundary.** `write_derived_insight` rejects any
  fact without `sourceNodeIds` (AST hashes) — see `_normalize_fact`'s
  "Provenance Violation" — and `TRELLIS_PROTOCOL_VIOLATION` fires when a
  run makes zero database tool calls. Web content has no AST hashes: a
  search result must never be writable into the graph as-is, and a run
  that ONLY searched the web must still count as provenance-free. The
  existing rule "external content earns citability only through the
  verified ingest path" (roadmap 3.3 #8) is the invariant to enforce, not
  a feature to build this session.
- **Operator control does not exist yet.** MCP servers are external
  processes. Today nothing validates, allowlists, spawns, or bounds them.
  The configuration surface must be Zod-validated on the Node side
  (`src/config/index.ts`), forwarded to Python by `rlm_worker.ts` exactly
  like `NEO4J_*`/`PG_DSN`, and re-validated in Python — and it must be
  impossible for a queue payload or a model completion to name a server,
  a command, or a tool that the operator did not configure.
- **Acceptance must stay zero-paid and deterministic.** A real web-search
  MCP server is networked and often metered. The precedent is the oracle/
  stub pattern: a local fixture MCP server speaking the real protocol over
  stdio with canned deterministic results.

Session 10 gives the RLM its MCP client surface with web search as the
first configured tool, leaving every write-path and provenance rule
exactly as it is.

## 4. Required design

Present the exact design after inspecting §5, then implement it. Deviations
require a concrete reason and equivalent tests.

### 4.1 Operator-configured MCP client in the RLM process

- New module `src/rlm/trellis_mcp.py`: a client wrapper over the official
  `mcp` Python SDK (add a pinned version to `requirements.txt`; verify it
  imports under the pinned interpreter via `python:check`). Stdio
  transport only this session: each configured server is spawned as a
  child of the RLM process from an explicit argument vector (never a
  shell string), handshaken once, and closed in the agent's `finally`
  block alongside the database tools.
- One injected object (e.g. `trellis_mcp`) whose surface follows the
  `trellis_tools.py` discipline exactly: methods return JSON STRINGS;
  protocol/tool errors RAISE with real messages so the REPL loop can
  self-correct; every call is time-bounded (per-call timeout from config)
  and size-capped (truncate oversized results with an explicit marker,
  mirroring the snippet-cap idiom). Expose only allowlisted tools — e.g.
  `trellis_mcp.call_tool(server, tool, arguments)` plus a
  `trellis_mcp.list_tools()` that reports the configured surface — and
  reject anything outside the allowlist before any I/O.
- MCP calls must NOT increment `_count_tool_call()` — the protocol-
  violation rule stays keyed to database tool calls. Count MCP usage
  separately and report it in the `TRELLIS_TELEMETRY` payload (e.g.
  `mcp_calls`), keeping the existing telemetry fields untouched so the
  benchmark client and scanners keep parsing.

### 4.2 Configuration and env forwarding

- Node side: a Zod-validated `TRELLIS_MCP_SERVERS` value in
  `src/config/index.ts` (JSON: per-server `name`, `command` argv array,
  allowlisted `tools`, per-call `timeoutMs`, `maxResultBytes`; default
  empty — with no servers configured, nothing is injected and RLM
  behavior is byte-identical to today). `rlm_worker.ts` forwards the
  validated JSON to the spawned agent via env, following the existing
  `NEO4J_*` pattern. Python re-validates the same payload defensively.
- The web-search tool is nothing special: it is whatever the operator's
  first configured server exposes (fixture in acceptance; a real MCP
  web-search server in owner-approved runs). Do not hardcode any vendor.

### 4.3 Prompt addendum

- Extend `TRELLIS_ADDENDUM` with a tools section generated from the
  validated config (names, allowlisted tools, usage contract: results are
  research context, NEVER `sourceNodeIds`; database provenance is still
  mandatory for any answer or cached insight). Respect the rlms format
  contract: no literal braces (double them), and keep the existing turn
  discipline and flywheel protocol text untouched. When no servers are
  configured, the addendum must not change at all.

### 4.4 Observability

- T16 house style: telemetry-driven counters in the worker (e.g.
  `trellis_rlm_mcp_calls_total`, optionally labeled by configured tool
  name — a bounded, operator-controlled vocabulary), an
  `rlm.mcp` info event with counts only. Server commands, arguments,
  queries, and results never reach metric labels or log lines.

### 4.5 The fixture server and zero-paid acceptance

- `scripts/fixture_mcp_server.py`: a deterministic local MCP server over
  stdio exposing a `web_search` tool with canned results (and a
  misbehaving mode — oversized result, slow response, unknown tool — for
  the bounding tests). It is the only server acceptance ever configures.
  Real networked/metered servers are owner-approved runs, preceded by the
  printed tool allowlist, with observed `mcp_calls` recorded.

## 5. File-level starting points

Inspect before editing:

- `TRELLIS_ROADMAP.md` §3.3 #8, §4, and the Session 9 + redirect §5
  entries; `.agents/AGENT_CODING_GUIDELINES.md`.
- `src/rlm/trellis_agent.py` (custom_tools injection, TRELLIS_ADDENDUM
  and its brace-escaping `_SAFE_RUBRIC` pattern, the `finally` cleanup,
  telemetry payload assembly) and `src/rlm/trellis_tools.py` (the wrapper
  discipline to mirror: JSON-string returns, raising errors, call
  counting, the single write path and its provenance validation).
- `src/workers/rlm_worker.ts` (env forwarding to the spawned agent) and
  `src/workers/rlm_job.ts` (payload normalization — note that NOTHING
  MCP-related may ride in job payloads).
- `src/config/index.ts` (Zod env validation; the `AGENT_*` bounds and
  `TRELLIS_MCP_SERVERS` belong to the same discipline) and
  `src/config/agent_bounds.test.ts` (the reset-modules pattern for
  config tests).
- `src/core/observability/rlm_telemetry.ts` + `rlm_telemetry.test.ts`
  (extending the telemetry payload without breaking the pinned parse) and
  `src/benchmarks/oolong/rlm_client.ts` `TelemetrySchema` (a consumer
  that must keep parsing — its schema may need a backward-compatible
  optional field).
- `scripts/test_rlm_sandbox.ts` and `scripts/parse_python_source.py`
  (house style for driving Python directly from a live script / spawning
  the pinned interpreter), `requirements.txt` and
  `scripts/check_python_runtime.py` (where the new dependency and import
  check land).

Prefer pure helpers for config parsing/validation (both languages), the
allowlist decision, result truncation, and addendum generation.

## 6. Test strategy and acceptance

Test first. No paid LLM calls and no external network access are permitted
for Session 10 acceptance.

Offline tests must cover:

- Zod validation of `TRELLIS_MCP_SERVERS` (valid registry, empty default,
  rejection of missing fields, non-array commands, empty allowlists,
  non-positive timeouts/byte caps) via the reset-modules config pattern;
- `rlm_worker.ts` env forwarding of the validated registry (pure helper
  pin) and a pin that `rlm_job.ts` payloads carry nothing MCP-shaped;
- addendum generation: configured tools listed, brace-safety preserved
  (extend the existing prompt-hygiene tests: the formatted addendum
  contains no unescaped literal braces; empty config produces the
  pre-Session-10 addendum byte-for-byte);
- telemetry compatibility: the extended `TRELLIS_TELEMETRY` payload still
  parses through `RlmTelemetryScanner` and the benchmark
  `TelemetrySchema` (old payloads without `mcp_calls` must also parse —
  pin both directions);
- metric label pins for any new counters.

Live zero-LLM coverage (local stack; the fixture server is local stdio):

- new `npm run test:rlm-mcp` driving `trellis_mcp` directly under the
  pinned interpreter against `scripts/fixture_mcp_server.py`: handshake
  and `list_tools`; a successful `web_search` call returning the canned
  JSON string; allowlist enforcement (configured-but-not-allowlisted and
  unknown tools rejected before I/O); per-call timeout tripping on the
  slow mode; oversized-result truncation with marker; MCP calls NOT
  incrementing the database tool-call count (protocol-violation
  semantics unchanged); clean shutdown of the child server;
- an end-to-end zero-LLM regression: a stubbed `rlm_queue` job and the
  `test:agent-loop` suite still pass with `TRELLIS_MCP_SERVERS` set
  (config presence must not disturb the stub path) and unset;
- all existing live suites stay green: `test:agent-loop`,
  `test:repo-ingest`, `test:benchmark-hardening`,
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
 # Run the new zero-LLM MCP live suite (fixture server).
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

- README (an "External tools (MCP)" section: config contract, provenance
  rule, fixture-server drill, cost posture), `API_REFERENCE.md` §3 if the
  telemetry line contract gains a field, the runbook (new env, metrics,
  events, and the "MCP server misbehaving" diagnostic), and
  `requirements.txt`/`check_python_runtime.py`.
- `TRELLIS_ROADMAP.md`: strike the 3.3 #8 first slice only after
  acceptance (the item stays open for the A2A/tool-expansion
  continuation); add a full-dated §5 entry with exact commands/counts and
  any defects found.
- `HANDOFF.md`: regenerate for the next objective per §0 — the first
  remaining unstruck sequencing row is the 3.3 #8 continuation
  (tool-surface expansion and A2A interop); scope it per the owner
  direction, unless something discovered this session should jump the
  queue.

## 7. Guardrails

1. Never mutate an AST. The T13 hash preimage is pinned; `rederiveAstNodeId`
   stays authoritative; nothing positional is ever persisted as identity.
2. Never merge, rename, or delete Entity nodes. Equivalence stays an overlay
   belief; semantic identity and `SAME_AS` behavior stay pinned.
3. Preserve provenance on every semantic node and edge.
   `write_derived_insight` remains the single agent write path, still
   requiring live AST provenance — MCP output is research context and can
   NEVER be passed as `sourceNodeIds`; external content earns citability
   only through the verified ingest path (not built this session). The
   read-only session enforcement and mutation blocklist are untouched.
4. MCP calls never satisfy the database-provenance requirement:
   `_count_tool_call()` counts database tools only, and
   `TRELLIS_PROTOCOL_VIOLATION` semantics are unchanged. A run that only
   searched the web is still provenance-free.
5. Operator control is absolute: servers, commands, transports, tool
   allowlists, timeouts, and size caps come from validated configuration
   only. No queue payload, model completion, or REPL string may name or
   spawn a server or tool outside that config. Argument vectors, never
   shell strings.
6. Every external call is bounded: per-call timeout, response size cap,
   child processes cleaned up on exit. A hung or oversized MCP server
   must degrade to a raised tool error, never a hung RLM run.
7. Validate every LLM response at the `parseLlmResponse`/Zod boundary. All
   LLM calls remain inside BullMQ workers or the RLM process; the
   orchestrator stays tool-free — MCP belongs to the RLM sub-agent only,
   and agentic bounds plus the `AGENT_ORACLE_ENABLED=false` default stay
   pinned.
8. Default to zero paid work and zero external network in acceptance: the
   fixture MCP server is local and deterministic. Real web-search runs are
   owner-approved, preceded by the printed tool allowlist, with observed
   `mcp_calls` and spend recorded.
9. Do not break existing consumers: `FINAL_ANSWER:`/`TRELLIS_TELEMETRY:`/
   `TRELLIS_RESULT:` parsing (telemetry extensions must be
   backward-compatible in both directions), SSE payload shapes,
   pre-Session-9 `rlm_queue` payloads, and empty-config byte-identical
   RLM behavior.
10. Respect the rlms prompt contract: extend `RLM_SYSTEM_PROMPT`, never
    replace it; no literal curly braces in anything rlms formats (double
    them); the orchestrator persona stays plain chat completions.
11. Follow the T16 observability house style. Queries, goals, tool
    arguments, results, server commands, paths, hashes, and entity names
    never become metric label values or log content.
12. Keep API and worker processes split; use project-scoped Compose
    commands; never remove another stack's volumes; fixtures and drills
    clean up only token-scoped or pre-snapshotted state.
13. Ship one feature branch and one PR to `master`, plain engineering
    prose, with no AI attribution or generated-by trailers. Regenerate this
    file in the same PR.

## 8. Explicit exclusions

Do not include: A2A interoperability (recorded follow-on, next
sequencing row); MCP transports beyond stdio (HTTP/SSE/remote servers —
follow-on with their own auth story); giving the orchestrator tools of
any kind; a fetch-then-ingest pipeline or any new graph write path
("ingest-then-cite" stays a documented pattern using the existing ingest
surface, not a Session 10 feature); exposing MCP through the API or job
payloads; MCP servers in Docker Compose (the fixture is a local child
process; containerized tool servers are follow-on); vendor-specific
web-search integrations or API keys; paid LLM calls or external network
access as acceptance checks; frontend work (sequencing row 3);
repository-extraction prerequisites; `ASTRef`/`EVIDENCED_BY` migration
(gate closed at 286); T13 re-hashing; rlms library modifications.
