You are a principal systems engineer continuing development on Trellis Engine,
a provenance-preserving GraphRAG system (repository:
https://github.com/OpenCnid/trellis, local path `D:\trellis-engine` or the
current working directory). Trellis is an original OpenCnid project, not a
fork, and is unrelated to other projects named Trellis. The repository and its
documentation are the only sources of truth.

Sessions 1–16 are complete and merged:

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
- PR #42 — Session 16 (July 7, 2026): workspace lineage (design record
  §11 step 4, owner-directed). **Serialize:** `--workspace-out` on
  `trellis_agent.py` writes the end-of-run `snapshot()` to a
  worker-named temp file in the `finally` (success or failure — a
  failed run's partial workspace can seed the retry); nothing new
  crosses stdout. **Park:** `rlm_worker.ts` validates the snapshot
  against the Zod twin of the state dict
  (`src/workers/workspace_scratch.ts`) and parks it at
  `scratch:goal:<goalId>:task:<taskId>` with `SCRATCH_TTL_SECONDS`
  (default 3600, cap 86400) under the per-goal
  `SCRATCH_MAX_BYTES_PER_GOAL` cap (default 8 MiB, cap 64 MiB; a
  goal-scoped counter key expires alongside); the completion value
  gains the counts-only `workspaceRef` `{taskId, segments, bytes}`.
  Parking failures degrade to "nothing parked"; a paid run is never
  failed over its checkpoint. **Seed:** `seedTasks` on the rlm job
  payload (ids only, requires `goalId`, bounded 8) resolves BEFORE
  anything runs — a missing/expired reference is a readable
  dispatch-time failure with zero spend — merges (notes concatenate,
  segments union first-wins, last non-default plan wins), writes a seed
  file, and passes `--seed-workspace`;
  `TrellisWorkspace.seed_from_snapshot` restores it with stamps
  preserved verbatim, integrity checked (a bytes/content mismatch is a
  torn seed and raises), and bounds re-enforced — an over-budget seed
  fails the task fast, never silent truncation. A seeded run always
  gets a workspace and appends the brace-free `SEEDED RUN` addendum;
  the unseeded prompt is byte-identical to Session 14 (pinned). The
  orchestrator stays tool-free and routes by reference:
  `AgentTaskSpecSchema.seedFromTasks` (nullable, max 8), validated by
  the goal loop against PRIOR-iteration task ids only (unknown and
  same-batch ids end the goal as a typed `decision_error` before
  dispatch — batches stay independent, never a blackboard);
  `TaskOutcome.workspaceRef` rendered counts-only in
  `buildDecisionMessages`; the orchestrator prompt teaches the field.
  Oracle scripts express seeded dispatches and
  `RlmStubSchema.workspaceSnapshot` (data-only) parks through the
  identical path, so the whole loop drills with zero LLM calls. The
  two-task lineage probe was owner-approved and MEASURED as a follow-up
  (July 8, 2026, `docs/benchmarks/WORKSPACE_LINEAGE_PROBE_REPORT.md`):
  goal-total external calls 4 seeded vs 8 unseeded; the seeded
  dependent task made 0 external calls — cross-task re-derivation
  eliminated; n=1 per arm, directional.

Session 17 (July 7, 2026, branch `d/keen-moser-080be2`) is also
complete: **the promotion path** (design record §6, §11 step 5) — the
operator-gated, byte-preserving bridge from a parked Tier-3 workspace
segment to the ordinary verified ingest path. **Planner** (pure,
`src/core/promotion/plan_promotion.ts`, reusing
`WorkspaceSnapshotSchema` from `workspace_scratch.ts`): produces the
exact ingest request `{docKey, content, origin}` — content
byte-verbatim — or a typed refusal (`truncated_segment`: a size-capped
capture is NOT the source bytes; `empty_content`; `unknown_segment`
with a bounded listing; `invalid_doc_key`). Doc keys are operator-
explicit, never invented: recommended `web:<url>` for web content
(stable across refreshes); the deterministic fallback
`mcp:<server>:<tool>:<argsHash>` (`derivedDocKey`) is printed as a
hint. Keys must be printable/whitespace-free/≤512 chars, not shaped
like an AST hash (the anonymous-ingest namespace), and not under the
reserved `repo:` prefix. **Origin traceability:** the `documents` table
gained a nullable additive `origin JSONB` column;
`registerDocumentVersion` takes an optional origin and
`IngestRequest.origin` threads it through `ingestDocument`, so the
wrapper-owned stamp (server/tool/argsHash/fetchedAt/segmentId/bytes +
goal/task correlation) commits atomically with the version row; every
pre-existing caller leaves it NULL. **CLI** (`npm run promote`,
`scripts/promote_segment.ts`, execution shared with the drill via
`src/core/promotion/promote_segment.ts`): LIST mode (default,
read-only) inventories a PARKED snapshot (ids, stamps, sizes,
truncation markers, bounded previews, key hints; a missing/expired key
is a readable failure naming `SCRATCH_TTL_SECONDS`); PROMOTE mode
(`--segment` + `--doc-key`) echoes doc key/bytes/origin before any
write, runs the UNMODIFIED verified ingest transaction in-process, and
prints the root and citable block hashes. Zero paid work by default
(`--extract none`); `changed` needs `--max-blocks` +
`--confirm-extraction` (the `repo:ingest` double gate). One segment per
invocation; parked snapshots only, never a live workspace; no API
surface — promotion is a human running the CLI. **Acceptance**
(`npm run test:promotion`, 41 checks, zero-paid): list/refusals over
real Redis; earned citability end to end — `write_derived_insight`
citing the would-be block hash is a Provenance Violation BEFORE
promotion and SUCCEEDS with the same hash after (the real hardened
write path via `scripts/test_promotion_write.py`); the origin stamp on
the documents row; re-promoting changed bytes under the same doc key
versions the document and the sweep contests the citing insight with
audit preserved (offline 554/62).

OpenCnid selected the MIT License on July 6, 2026.

Your objective is **Session 18: the first flywheel turn** (design
record §11 step 6, §9.3–§9.5) — the machinery by which a
research-bearing module is grounded in promoted sources and reachable
by the invalidation sweep, plus the owner-gated authoring of module #1
through the sculpted pathway, per §3–§6 below. Do not re-plan or
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
     Since Session 17 `documents` also carries a nullable `origin JSONB`
     column — the promotion audit stamp (which server/tool/args produced a
     promoted document's bytes, fetched when); only segment promotion
     writes it, inside the ingest transaction.
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
   - **The promotion path (Session 17; `src/core/promotion/`):** the ONLY
     route from Tier 3 to Tier 1. `plan_promotion.ts` (pure planner:
     typed refusals for truncated/empty/unknown segments and bad doc
     keys; content byte-verbatim; doc keys operator-explicit with the
     `mcp:<server>:<tool>:<argsHash>` fallback offered, never applied
     silently) + `promote_segment.ts` (one planned request through the
     unmodified verified transaction, returning the citable block
     hashes) + the operator CLI `npm run promote`
     (`scripts/promote_segment.ts`: list/promote over PARKED snapshots
     only, zero-paid default, `repo:ingest`-style extraction double
     gate). Because the doc key is stable, re-promoting refreshed
     external content versions the document and the existing
     Merkle-diff → sweep machinery contests stale beliefs for free.
     Drill: `npm run test:promotion`.
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
     `rlm_worker.ts`. Promotion consumes these parked snapshots — TTL
     expiry is BY DESIGN; anything worth keeping is promoted, not
     parked longer.
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
     independently. Tier 3 has NO provenance standing; permanence is
     earned only through the Session 17 promotion CLI.
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
     validators are bound-for-bound twins and normalize CRLF→LF. The
     manifest already carries `research.sourceNodeIds` (format-checked
     64-hex; module #0's list is empty) and `status`
     (`active`/`contested`/`retired`; only `active` composes —
     `loadModules` refuses the rest with a readable error). What does
     NOT exist yet is Session 18's scope: existence verification for
     research hashes, the manifest-as-graph-entity representation, and
     contested-module surfacing.
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
     names, tool arguments, tool results, workspace content, promoted
     content, server commands, URLs, and credentials never become label
     values or log content. Queue-depth gauges cover all seven queues;
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
     workspace probes in `docs/benchmarks/WORKSPACE_PROBE_REPORT.md`
     and `docs/benchmarks/WORKSPACE_LINEAGE_PROBE_REPORT.md`.
   - The fixture MCP server (`scripts/fixture_mcp_server.py`; stdio and
     Streamable HTTP with an optional required-bearer mode) is the only
     MCP server acceptance ever configures; real web-search servers are
     owner-approved runs with the allowlist printed and `mcp_calls`
     recorded. The containerized tool-server pattern is the
     `mcp-fixture` Compose service (test profile).

## 2. Current baseline

Repository state at handoff creation:

- `master`: the Session 17 merge (use `git log -- HANDOFF.md` to
  identify it; Session 17 landed as one squash-merged PR from branch
  `d/keen-moser-080be2`).
- Offline baseline: `npm test` = 554 passing across 62 files
  (Session 17 added `src/core/promotion/plan_promotion.test.ts` and an
  origin-threading case in `src/core/ingestion/ingest_document.test.ts`).
- `npm run build` and `npm run python:check` pass.
- `npm run drill:scale`: gate CLOSED at max provenance 286; sweep growth
  2.17x in the Session 17 run (run-to-run band 1.63x–2.26x across
  Sessions 12–17; all far under the superlinear trigger).
- Live zero-LLM checks (Session 17 observed counts):
  `test:promotion` (41 — NEW: the earned-citability loop end to end),
  `test:rlm-workspace` (83), `test:agent-loop` (35),
  `test:modules` (27 — carries the byte-identical composed-prompt
  sha256 pin `abb945a6…f9b2`; recompute it in the same commit if the
  kernel prompt or rubric legitimately changes), `test:rlm-mcp` (86),
  `test:a2a` (46), `test:repo-ingest` (45),
  `test:benchmark-hardening` (24), `test:entity-resolution` (34),
  `test:api-hardening` (18), `test:rlm-sandbox` (21),
  `test:belief-recovery` (30), `test:invalidation-sweep` (17).
- Isolated Compose integration: 10 assertions (`--profile test`, unique
  project name, host ports 0 via `TRELLIS_*_HOST_PORT=0`; includes the
  containerized credentialed MCP fixture probe). OPEN ITEM from
  Session 17: its close-out run was blocked by host disk exhaustion
  (the image rebuild filled C: to 0 bytes and crashed Docker Desktop;
  the drive was already near-full with unrelated state). The
  Session 16 run of the identical topology passed 10/10, and nothing
  the integration exercises changed beyond the additive
  `documents.origin` column — but re-run it early in Session 18 once
  disk space is freed, before building anything new.
- CI target is Node 22. Session 17's local environment was Node 20.19.2,
  Python 3.13.1, Docker Compose v2, PostgreSQL 16.x, Neo4j 5.11.
- Python runtime deps are pinned in `requirements.txt` (`rlms==0.1.3`,
  `openai`, `neo4j`, `psycopg2-binary`, `unstructured`, `mcp==1.12.4`);
  `npm run python:check` verifies syntax/imports/assets.
- The `documents.origin` column ships in the idempotent bootstrap
  (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`); run
  `npm run db:init:dev` (or restart a container) once against a
  pre-Session-17 database before using `npm run promote`.
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

## 3. Session 18 problem statement

**The first flywheel turn (design record §11 step 6, with the recorded
§9.4 deferral now due).** Every prerequisite is shipped: the RLM can
research through MCP into an origin-stamped workspace (S14), checkpoint
it across a goal's tasks (S16), and the operator can promote
load-bearing segments into verified, citable substrate (S17). The
module system exists (S15) and its manifest schema already carries
`research.sourceNodeIds` (format-validated 64-hex in
`src/config/modules.ts` and the Python twin) and a `status` field whose
non-`active` values are refused composition. But the capability
flywheel has never turned, and three pieces of machinery are missing
before it can:

1. **Research provenance is format-checked but never existence-checked.**
   A manifest can cite 64 well-formed hex chars that correspond to
   nothing. The write path enforces existence for belief provenance
   (Session 14); capability provenance deserves the same discipline at
   its gate.
2. **Modules are unreachable by the sweep (§9.4, recorded deferral).**
   The invalidation sweep contests any Neo4j node/relationship whose
   `sourceNodeIds` intersect a dead set — but module manifests exist
   only as files. Until a research-bearing manifest is represented as a
   graph entity citing its research hashes, "a software capability
   automatically flagged for re-review when its research basis changes"
   is prose, not machinery. Session 15 deferred this deliberately
   because module #0 cites no research (it predates promotion) — the
   entity would have been empty and unreachable. The first
   research-bearing module is exactly when it lands.
3. **The pathway has never been exercised.** §11 step 6: the RLM
   authors module #1 end-to-end — research in the workspace, design
   grounded in ingested (promoted) sources, manifest + addendum + drill
   proposed as a gated artifact, landed by the operator, composed in
   the next run. The authoring runs are PAID and owner-gated; the
   machinery they flow through must be proven zero-paid first.

## 4. Required design

Design record §9.3–§9.5 and §11 step 6 are normative: modules land only
through class-appropriate gates (protocol modules: automated validation
+ zero-paid drill green + human review), the kernel (loader, gates,
validators) stays human-owned, and nothing about module selection or
registration is ever writable by a model completion.

- **Research existence gate.** Wherever module manifests are validated
  against the database (NOT at every prompt composition — composition
  is config-time and must not grow a PostgreSQL dependency), verify
  every `research.sourceNodeIds` hash exists in `ast_nodes` before
  accepting the module for registration; reuse the
  `ast_hashes_exist`/bounded-listing discipline from Session 14. A
  module citing unknown hashes is refused fail-fast with the missing
  hashes listed (bounded).
- **Manifest-as-graph-entity (§9.4).** An operator-run, idempotent
  registration step — suggest `scripts/register_modules.ts`, npm alias
  `modules:register` — that, for each registry module with non-empty
  research provenance, MERGEs one graph entity (suggest
  `(:Entity {name: 'module:<name>', kind: 'module_manifest'})` — the
  `module:` prefix keeps it out of every retrieval path that matches
  user-facing entity names; document the choice) carrying
  `sourceNodeIds` = the manifest's research hashes and the module
  version. Write it with the SAME provenance state-machine semantics as
  every other writer (`src/core/graph/provenance.ts`; the
  `extraction_merge.ts` ON MATCH discipline: re-registration with live
  hashes un-contests and re-stamps `rederivedAt`, orphaned hashes move
  to the audit trail) so the existing sweep
  (`sweepOrphanedProvenance`) contests it with zero sweep changes.
  Module #0 (empty research) registers nothing — pinned by test.
  Registration is operator tooling in the `repo:ingest`/`promote`
  mold: never an API endpoint, never reachable from a model
  completion, never part of worker startup.
- **Contested-module surfacing.** A read-only verify mode (suggest
  `npm run modules:register -- --verify` or a `modules:verify` alias)
  that reports each registered module entity's contested state and
  orphaned hashes. The LOOP stays human: the sweep contests the graph
  entity; the operator reads the report and flips the manifest `status`
  to `contested` (the Session 15 loader already refuses composing it);
  re-review and re-registration recover it. Do NOT auto-edit manifest
  files from the graph state — that would be the flywheel modifying
  its own gate.
- **The paid turn itself (owner-gated; propose, do not run).** With the
  machinery green, propose the module #1 authoring plan to the owner
  with a cost estimate: topic (owner's call), research runs (MCP
  web-search or an owner-supplied corpus) into a goal workspace,
  operator promotion of the load-bearing segments (`npm run promote`),
  an authoring run that drafts `modules/<name>/module.json` +
  brace-free `addendum.txt` + a zero-paid drill citing the promoted
  hashes as `research.sourceNodeIds`, and an ordinary human-reviewed PR
  that lands it. Nomination is prose; the artifact enters the repo only
  through the gate. If the owner defers the paid turn, the session is
  still complete when the machinery ships with its zero-paid
  acceptance — record the deferral in the roadmap.
- No API surface change, no new queue, no schema change beyond what the
  graph entity needs (it is an ordinary `Entity` node; expect zero
  Postgres DDL).

## 5. File-level starting points

Inspect before editing:

- `docs/architecture/WORKSPACE_AND_MODULES.md` §9.3–§9.5 (gates,
  lifecycle, module #0), §11 step 6; §9.4 for the exact contestation
  contract; `docs/GLOSSARY.md` (Module, Kernel, Userspace, Capability
  ladder).
- `src/config/modules.ts` + `src/rlm/trellis_modules.py` (the manifest
  schema — `research.sourceNodeIds` and `status` already exist; the
  loader's `status !== 'active'` refusal; the composed-prompt sha256
  pin in `scripts/test_modules.ts` that must NOT move).
- `src/core/graph/extraction_merge.ts` and
  `src/core/graph/provenance.ts` (the ON MATCH recovery semantics the
  registration MERGE must mirror) and `src/core/graph/invalidation.ts`
  (the sweep that must reach the new entity unchanged).
- `src/core/promotion/` and `scripts/promote_segment.ts` (Session 17 —
  the drill promotes its fixture research corpus through this);
  `scripts/test_promotion.ts` (the drill pattern to extend, including
  the captured-invalidation-payload sweep technique).
- `src/rlm/trellis_tools.py` (`ast_hashes_exist` — the existence-check
  precedent) and `TrellisPostgres` wiring in `scripts/test_rlm_sandbox.py`.
- `scripts/ingest_repository.ts` / `scripts/promote_segment.ts` (the
  operator-CLI house style: parse args, echo the plan, act, print
  results, close handles).
- `package.json` scripts; README (Modules section to extend);
  `.env.example` only if a new bound ships (none is expected).

## 6. Test strategy and acceptance

Test first. No paid LLM calls and no external network in acceptance.

Offline (joins `npm test`, baseline 554):

- Registration planning pure helpers (if extracted — recommended):
  research-bearing vs empty-research module selection (module #0 ⇒
  no-op), the entity name/kind derivation (`module:<name>`), Cypher
  parameter shapes.
- Manifest validation stays pinned: module #0 composes byte-identically
  (existing sha256 pin), `status: contested` refuses composition with a
  readable error (existing behavior, re-asserted where touched).

Live zero-paid (new `npm run test:module-lifecycle`, or extend
`test:modules` if the stack dependency stays acceptable there —
`test:modules` is currently offline-only, so a NEW drill is cleaner):

- Fixture research corpus: park a drill-authored snapshot and promote
  one segment through the REAL Session 17 path (`plan_promotion` +
  `promoteSegment`, or the CLI as subprocess) — the promoted block hash
  is the research provenance.
- A temp module directory (drill-owned, token-scoped, NOT under
  `modules/` — point the loader/registrar at it explicitly) citing the
  promoted hash: validator accepts; registration creates the graph
  entity with `sourceNodeIds` = [the hash], uncontested.
- Registration refusals: a manifest citing a well-formed unknown hash
  is refused with a bounded listing (existence gate); module #0
  registers nothing (empty research no-op).
- The §9.4 loop: re-promote changed bytes under the same doc key; drive
  the captured invalidation payload through
  `findGloballyOrphanedAstNodeIds` + `sweepOrphanedProvenance`; the
  module entity is contested with the audit trail preserved; the verify
  mode reports it; a manifest flipped to `status: contested` is refused
  composition with a readable error; re-registration after re-promotion
  of the original bytes (or citing the new hash) recovers the entity
  per the provenance state machine.
- Idempotency: registering twice changes nothing (MERGE semantics).
- All state token-scoped and cleaned up (graph entities, documents, AST
  rows, scratch keys, temp module dirs).

Required close-out (the standing block):

```
 npm test
 npm run build
 npm run python:check
 docker compose --profile test config --quiet
 # Run the isolated zero-LLM Compose integration (unique project name).
 npm run test:module-lifecycle
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
  and in the design record §11 (and strike the §9.4 deferral note where
  it is recorded).
- README (the module lifecycle/registration workflow is
  operator-facing); `.env.example` only if a new bound ships;
  `API_REFERENCE.md` only if a client-visible contract changes (it
  should not — §4 forbids new endpoints).
- If a new Python file ships under `src/rlm/`, add it to the Dockerfile
  `COPY` line and `check_python_runtime.py` (the Session 12 defect
  class; Sessions 14–17 kept this green — keep it that way).
- `HANDOFF.md`: regenerate per §0.

Standing owner-gated items (do NOT run unprompted): the paired-run
behavioral probes (`tsx scripts/probe_workspace_paired.ts`,
`tsx scripts/probe_workspace_lineage.ts` — both MEASURED and recorded;
the remaining open variant is a larger-payload/longer-horizon lineage
probe where the token and external-call axes separate), and — new this
session — the module #1 paid authoring turn itself (§4 above: research
runs, promotion, authoring run). Propose any paid run with a cost
estimate; do not run it unprompted.

## 7. Guardrails

1. **Never mutate an AST.** The T13 hash preimage is pinned;
   `rederiveAstNodeId` stays authoritative; nothing positional is ever
   persisted as identity.
2. **Never merge, rename, or delete Entity nodes.** Equivalence stays an
   overlay belief. The `module_manifest` entity (if you ship it as
   designed) follows the same rule: contested/retired, never deleted —
   audit history is the point.
3. **Preserve provenance on every semantic node and edge.**
   `write_derived_insight` remains the single AGENT write path, and its
   Session 14 enforcement (hash format + `ast_nodes` existence, checked
   before the WRITE session opens) is kernel — never weaken, bypass, or
   make it configurable. Workspace ids/content and MCP output can never
   be passed as `sourceNodeIds`; external content earns citability ONLY
   through the verified ingest path (the Session 17 promotion CLI is
   that path's operator gate). Harness-side writers (extraction merge,
   module registration) mirror the provenance state machine in
   `src/core/graph/provenance.ts` — never invent divergent semantics.
4. **Promotion and module landing are operator-gated, absolutely.** No
   autonomous path from Tier 3 to Tier 1; no API endpoint that promotes
   or registers modules; no model output that triggers ingestion,
   registration, or manifest edits. Nomination is prose; landing is a
   human running a CLI or merging a reviewed PR. Tier 3 never satisfies
   the provenance protocol: an answer with zero database tool calls
   emits `TRELLIS_PROTOCOL_VIOLATION` regardless of workspace/MCP
   activity.
5. **Operator control is absolute for the RLM tool surface AND the
   module space:** servers, tools, modules, bounds, and credential
   references come from validated config only; no inbound payload or
   model completion may alter any of it mid-run; module selection is
   only ever within the operator-registered allowlist; module `status`
   lives in the manifest file and is edited only by humans. L1 (runtime
   config mutation) and L2 (runtime code hot-patching) remain
   forbidden; L3 lands only through the recorded gates — protocol
   modules: automated validation + zero-paid drill + human review,
   always, this edition.
6. **Every external interaction is bounded;** workspace and scratch
   state is TTL- and byte-bounded by validated config; over-budget
   writes and seeds raise — never silent truncation. Durable cross-goal
   unverified memory stays a non-feature: TTL expiry of parked
   snapshots is BY DESIGN; permanence is earned via promotion only.
7. **Validate at every boundary:** bounds and registries cross Zod and
   Python twin validators; all LLM calls stay inside BullMQ workers or
   the RLM process; the orchestrator stays tool-free and routes lineage
   by reference only; `AGENT_ORACLE_ENABLED` and `TRELLIS_A2A_ENABLED`
   defaults stay pinned false.
8. **Default to zero paid work and zero external network in
   acceptance;** the fixture server remains the only MCP server
   acceptance configures; promotion/module drills promote and cite
   fixture-produced or drill-authored bytes, never live web content;
   the module #1 paid turn is owner-approved, per-run.
9. **Do not break existing consumers:** with no workspace attached,
   `call_tool` returns and the system prompt are byte-identical; an
   unseeded workspace run's prompt is byte-identical to Session 14;
   with module #0 loaded the composed prompt is byte-identical to the
   pre-Session-15 monolith (the sha256 pin in `test:modules` must not
   move unless the kernel prompt legitimately changes — recompute in
   the same commit); pre-Session-9 `rlm_queue` payloads still process;
   the `/api/agent-stream` SSE contract, the A2A v1.0 surface, and the
   backend API contract are untouched; non-promotion ingests leave
   `documents.origin` NULL; the backend API key still never reaches any
   client bundle.
10. **Respect the rlms prompt contract:** extend `RLM_SYSTEM_PROMPT`,
    never replace it; no literal curly braces in anything rlms formats
    (addenda use `dict(...)` example syntax); no rlms library
    modifications.
11. **Follow the T16 observability house style:** workspace content,
    module addendum text, queries, tool arguments/results, hashes,
    promoted content, and credentials never become metric label values
    or log content; telemetry carries counts only.
12. **Keep API and worker processes split;** project-scoped Compose
    commands; fixtures and drills clean up only token-scoped or
    pre-snapshotted state.
13. **Ship one feature branch and one PR to `master`,** plain
    engineering prose, no AI attribution or generated-by trailers.
    Regenerate this file in the same PR. RLM expands exclusively to
    Recursive Language Model.

## 8. Explicit exclusions

Do not include: frontend work of any kind (deferred, unscheduled —
scope preserved in roadmap §3.3 #5); tool-bearing modules or any
relaxation of the protocol-modules-only kernel edition (the class must
earn trust first, §9.3); module auto-landing of any kind (the gate is
the feature); autonomous nomination, promotion, registration, or
manifest editing (operator gates are absolute); a module or promotion
HTTP/A2A surface; auto-flipping manifest `status` from graph state;
batch promotion or whole-snapshot promotion (one segment per invocation
this edition); running the module #1 paid authoring turn without
per-run owner approval and a cost estimate; orchestrator tools (routing
stays by reference); live intra-batch workspace sharing (lineage is
inheritance between iterations, never a blackboard); durable cross-goal
scratch storage (TTL stays); rlms `compaction` enablement; new MCP
servers, transports, or OAuth flows; A2A changes;
repository-extraction prerequisites (separately sequenced);
`ASTRef`/`EVIDENCED_BY` migration (gate closed at 286); T13 re-hashing;
rlms library modifications; weakening or toggling the Session 14
write-path enforcement, the Session 15 composition pins, the
Session 16 lineage byte-identity pins, or the Session 17 promotion
refusals (truncated captures stay unpromotable, period); paid LLM calls
or external network access as acceptance checks.
