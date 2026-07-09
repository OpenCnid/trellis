You are a principal systems engineer continuing development on Trellis Engine,
a provenance-preserving GraphRAG system (repository:
https://github.com/OpenCnid/trellis, local path `D:\trellis-engine` or the
current working directory). Trellis is an original OpenCnid project, not a
fork, and is unrelated to other projects named Trellis. The repository and its
documentation are the only sources of truth.

Sessions 1–17 are complete and merged:

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
  checks).
- PR #42 — Session 16 (July 7, 2026): workspace lineage (design record
  §11 step 4). Serialize: `--workspace-out` on `trellis_agent.py`
  writes the end-of-run `snapshot()` to a worker-named temp file in the
  `finally`. Park: `rlm_worker.ts` validates the snapshot against the
  Zod twin (`src/workers/workspace_scratch.ts`) and parks it at
  `scratch:goal:<goalId>:task:<taskId>` under `SCRATCH_TTL_SECONDS`
  (default 3600, cap 86400) and the per-goal `SCRATCH_MAX_BYTES_PER_GOAL`
  cap; the completion value gains the counts-only `workspaceRef`.
  Seed: `seedTasks` on the rlm job payload (ids only, goal-scoped,
  bounded 8) resolves BEFORE anything runs, merges (notes concatenate,
  segments union first-wins, last non-default plan wins), and passes
  `--seed-workspace`; `TrellisWorkspace.seed_from_snapshot` restores
  stamps verbatim, integrity-checked (torn seeds raise), bounds
  re-enforced. A seeded run appends the brace-free `SEEDED RUN`
  addendum; the unseeded prompt is byte-identical to Session 14
  (pinned). The orchestrator routes lineage BY REFERENCE
  (`seedFromTasks` validated against prior-iteration task ids only;
  `workspaceRef` rendered counts-only). The two-task lineage probe was
  owner-approved and MEASURED as a follow-up (July 8, 2026,
  `docs/benchmarks/WORKSPACE_LINEAGE_PROBE_REPORT.md`): goal-total
  external calls 4 seeded vs 8 unseeded; the seeded dependent task made
  0 external calls; n=1 per arm, directional.
- PR #43 — Session 17 (July 7, 2026): the promotion path (design record
  §6, §11 step 5) — the operator-gated, byte-preserving bridge from a
  parked Tier-3 workspace segment to the ordinary verified ingest path.
  Pure planner (`src/core/promotion/plan_promotion.ts`, reusing the
  Session 16 snapshot schema): the exact ingest request
  `{docKey, content, origin}` — content byte-verbatim — or a typed
  refusal (`truncated_segment`, `empty_content`, `unknown_segment` with
  a bounded listing, `invalid_doc_key`). Doc keys are operator-explicit
  (recommended `web:<url>`; the deterministic
  `mcp:<server>:<tool>:<argsHash>` fallback is printed, never applied
  silently), bounded, not AST-hash-shaped, not under the reserved
  `repo:` prefix. The `documents` table gained a nullable additive
  `origin JSONB` column — the promotion audit stamp, committed
  atomically with the version row; every other caller leaves it NULL.
  CLI `npm run promote` (`scripts/promote_segment.ts` over
  `src/core/promotion/promote_segment.ts`): LIST mode inventories a
  PARKED snapshot; PROMOTE mode echoes doc key/bytes/origin before any
  write, runs the UNMODIFIED verified ingest transaction in-process
  (extraction `none` by default; `changed` needs `--max-blocks` +
  `--confirm-extraction`), and prints the citable block hashes. One
  segment per invocation; no API surface. Zero-paid acceptance
  `npm run test:promotion` (41 checks): the same block hash is a
  Provenance Violation before promotion and writes cleanly after;
  re-promoting changed bytes under the same doc key versions the
  document and the sweep contests the citing insight, audit preserved.

Session 18 (July 8, 2026, branch `d/session-18-first-flywheel-turn`) is
also complete: **the first flywheel turn, machinery** (design record
§11 step 6 machinery + the recorded §9.4 deferral, now closed). Three
pieces: **(1) The research existence gate** — module registration (not
prompt composition, which stays free of any PostgreSQL dependency)
verifies every manifest `research.sourceNodeIds` hash against
`ast_nodes` before any write session opens (`findMissingAstHashes` in
`src/core/graph/module_registration.ts`); a manifest citing a
well-formed unknown hash refuses the WHOLE invocation with a bounded
missing-hash listing, and co-registered valid modules are not written
either. **(2) Manifest-as-graph-entity (§9.4)** — the operator CLI
`npm run modules:register` (`scripts/register_modules.ts`) MERGEs each
research-bearing ACTIVE manifest as one ordinary
`(:Entity {kind: 'module_manifest', name: 'module:<name>'})` carrying
`sourceNodeIds` = the manifest's research hashes + a `moduleVersion`
stamp; ON MATCH mirrors `applyRederivation` field-for-field (the
`extraction_merge.ts` discipline — transitions commute), so the
UNCHANGED invalidation sweep contests a module whose promoted research
is superseded, with zero sweep changes. The `module:` prefix keeps the
entities out of name-matching retrieval. Idempotent; empty-research
manifests (module #0) register nothing (pinned no-op);
contested/retired manifests are SKIPPED — re-registration is the
recovery transition and must follow re-review, never precede it.
**(3) Contested-module surfacing** — `npm run modules:verify`
(read-only) reports contested state, live/orphaned hash counts, bounded
orphaned-hash listings, recovery timestamps, and on-disk manifest
status, with an ACTION prescription. The loop stays human: sweep
contests → operator flips manifest `status` by hand (the Session 15
loader refuses composing it) → re-review lands refreshed research →
re-registration recovers per the state machine. Loader seam:
`readModuleManifest`/`listModuleNames` extracted in
`src/config/modules.ts`; `loadModule` delegates, behavior-identical
(the `test:modules` sha256 pin did not move). Zero-paid acceptance
`npm run test:module-lifecycle` (35 checks) closes the §9.4 loop live:
promote fixture research through the REAL Session 17 path → register →
existence-gate refusals over real PostgreSQL → idempotency →
re-promotion orphans the hash and the sweep contests the module entity
(audit preserved) → verify reports → flipped manifest refused
composition AND skipped by registration → recovery → post-recovery
idempotency (offline 568/63). The module #1 PAID authoring turn is
owner-gated and was proposed with a measured-token cost estimate in the
roadmap §5 entry (July 8, 2026); it runs only with per-run owner
approval.

OpenCnid selected the MIT License on July 6, 2026.

Your objective is **Session 19: repository-scale extraction
prerequisites** (roadmap §4 row 1) — the scanner test/fixture exclusion
and the code-tuned extraction prompt with generic-identifier
suppression, per the recorded July 6, 2026 pilot findings and §3–§6
below. Do not re-plan or re-implement completed work. RLM expands
exclusively to Recursive Language Model (the MIT CSAIL formulation).

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
     hashes) + the operator CLI `npm run promote` (list/promote over
     PARKED snapshots only, zero-paid default, `repo:ingest`-style
     extraction double gate). Because the doc key is stable,
     re-promoting refreshed external content versions the document and
     the existing Merkle-diff → sweep machinery contests stale beliefs
     for free. Drill: `npm run test:promotion`.
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
   - **Module entities (Session 18; `src/core/graph/module_registration.ts`
     + `scripts/register_modules.ts`):** each research-bearing ACTIVE
     module manifest is registrable as
     `(:Entity {kind: 'module_manifest', name: 'module:<name>'})` whose
     `sourceNodeIds` are the manifest's research hashes
     (existence-gated against `ast_nodes` before any write) and whose
     ON MATCH mirrors `applyRederivation` — so the unchanged sweep
     contests a capability when its research basis changes, and
     re-registration after re-review recovers it. `npm run
     modules:register` / `npm run modules:verify` are operator tooling
     in the `repo:ingest`/`promote` mold: no API endpoint, never worker
     startup, never reachable from a model completion. Contested/retired
     manifests are skipped by registration (no silent un-contest);
     empty-research module #0 registers nothing. Like every Entity,
     module entities are contested/retired, never deleted (drills clean
     up only their own token-scoped names).
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
     (`SCRATCH_MAX_BYTES_PER_GOAL`). Redis is a parking lot for
     checkpoints, never a live store the model queries. Pure helpers
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
     correlation, `maxIterations`, `seedTasks` (ids only, never
     content), and a data-only `stub` replay mode (whose optional
     `workspaceSnapshot` parks through the identical path) for zero-LLM
     drills. Payloads carry nothing MCP- or workspace-content-shaped
     (unit-pinned).
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
     `WorkspaceBudgetError`; stored state is never silently truncated.
     Lineage: `snapshot()` serializes at task end; `seed_from_snapshot`
     restores parked snapshots at spawn — stamps verbatim, torn and
     over-budget seeds raise before the first turn. Structural
     disjointness: uuid segment ids and 16-hex argsHashes can never
     match `^[0-9a-f]{64}$`, and the hardened write path rejects them
     independently. Tier 3 has NO provenance standing; permanence is
     earned only through the Session 17 promotion CLI.
   - **The module registry (Sessions 15/18; `src/config/modules.ts` +
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
     manifest carries `research.sourceNodeIds` (format-checked 64-hex;
     existence-checked at REGISTRATION, Session 18) and `status`
     (`active`/`contested`/`retired`; only `active` composes — and only
     `active` registers). `readModuleManifest` (shape only) is the
     registration read seam; `loadModule` (status + addendum gates) is
     the composition seam.
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
     (prior iterations only), observations carry counts-only
     `workspaceRef`s, and snapshot content never enters the decision
     context. Zero-LLM drills: `AGENT_ORACLE_ENABLED=true` accepts an
     `oracle` script — `npm run test:agent-loop`.
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
     content, module addendum text, server commands, URLs, and
     credentials never become label values or log content. Queue-depth
     gauges cover all seven queues; `trellis_rlm_mcp_calls_total` is
     label-free. Workspace and lineage telemetry is counts only.
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

- `master`: the Session 18 merge (use `git log -- HANDOFF.md` to
  identify it; Session 18 landed as one squash-merged PR from branch
  `d/session-18-first-flywheel-turn`).
- Offline baseline: `npm test` = 568 passing across 63 files
  (Session 18 added `src/core/graph/module_registration.test.ts` and
  the `readModuleManifest`/`listModuleNames` cases in
  `src/config/modules.test.ts`).
- `npm run build` and `npm run python:check` pass.
- `npm run drill:scale`: gate CLOSED at max provenance 286 (run-to-run
  sweep-growth band 1.63x–2.26x across Sessions 12–18; all far under
  the superlinear trigger).
- Live zero-LLM checks (Session 18 observed counts):
  `test:module-lifecycle` (35 — NEW: the §9.4 capability-provenance
  loop end to end), `test:promotion` (41), `test:rlm-workspace` (82 —
  the 83 recorded by Sessions 16/17 was a miscount; 82 PASS lines
  observed on both the unmodified Session 17 master and this branch,
  drill green either way), `test:agent-loop` (35), `test:modules` (33 as
  of the July 9 module #1 turn; 27 at Session 18 — carries the
  byte-identical composed-prompt sha256 pin `abb945a6…f9b2`, which the
  module #1 addition did NOT move; recompute it in the same commit only
  if the kernel prompt or rubric legitimately changes), `test:rlm-mcp`
  (86), `test:a2a` (46),
  `test:repo-ingest` (45), `test:benchmark-hardening` (24),
  `test:entity-resolution` (34), `test:api-hardening` (18),
  `test:rlm-sandbox` (21), `test:belief-recovery` (30),
  `test:invalidation-sweep` (17).
- Isolated Compose integration: 10 assertions (`--profile test`, unique
  project name, host ports 0 via `TRELLIS_*_HOST_PORT=0`; includes the
  containerized credentialed MCP fixture probe). NOTE: the machine's
  C: drive runs close to full and an image rebuild needs several GB of
  headroom (a Session 17 build filled the disk mid-build).
- CI target is Node 22. Session 18's local environment was Node 20.19.2,
  Python 3.13.1, Docker Compose v2, PostgreSQL 16.x, Neo4j 5.11.
- Python runtime deps are pinned in `requirements.txt` (`rlms==0.1.3`,
  `openai`, `neo4j`, `psycopg2-binary`, `unstructured`, `mcp==1.12.4`);
  `npm run python:check` verifies syntax/imports/assets. Session 18
  shipped no new Python files.
- The `documents.origin` column ships in the idempotent bootstrap; run
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

## 3. Session 19 problem statement

**Repository-scale extraction prerequisites (roadmap §4 row 1; findings
recorded July 6, 2026 in `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md`
§5 and the roadmap §5 pilot entry).** The owner-approved extraction
pilot (`repo:ingest --root src/core/graph --extract changed`, 112
blocks, 112/112 jobs clean) proved the pipeline and surfaced three
defects that BLOCK any full-repository `changed` run:

1. **Test-fixture contamination.** The scanner
   (`src/core/repository/scanner.ts`, pure per-path `selectFile` with
   typed `ScanSkipReason`s) accepts test files; fixture strings in
   `alias_candidates.test.ts` produced
   `globex corporation --[acquired]-> initech`, and name-based entity
   identity merged those FICTIONAL facts onto pre-existing demo
   entities with real-looking provenance. There is no test/fixture
   exclusion today.
2. **Generic-identifier hubs.** The pilot's top entity was literally
   `entity` (14 sources), with `name`, `id`, and `action` close behind.
   At repo scale these become mega-hubs — degraded retrieval AND a
   spurious fast path to the 3.3 #4 migration trigger (an "observed
   1,000-source fact" that is an artifact, not evidence).
3. **Prompt mismatch.** The extraction prompt is inline in
   `src/workers/extraction_worker.ts` (`processJob`, the `promptData` +
   system message pair) and targets "macro-level business entities"; on
   source code it improvises
   (`organization --[is_default_type_for]-> organization`). A
   code-tuned prompt with generic-identifier suppression is needed.

The paid validation re-run of the pilot is NOT part of acceptance — it
is owner-gated (propose with the CLI's printed block count and a cost
estimate from the committed pilot telemetry: 112 blocks ran 57,323
input / 46,862 output `gpt-5.4` tokens + 28,618 embedding tokens).

## 4. Required design

Recommended shape (adjust against the code, not the other way around):

- **Scanner test/fixture exclusion.** A new typed skip reason (suggest
  `test_fixture`) in `ScanSkipReason`, applied inside the pure
  `selectFile` path selection with a deterministic, unit-pinned rule
  set over repo-relative paths — at minimum: `*.test.*`, `*.spec.*`,
  `__tests__/`, `__mocks__/`, `__fixtures__/`, `fixtures/`, `test/`,
  `tests/`, `testdata/`, `conftest.py`, `test_*.py`, `*_test.py`/
  `*_test.go`-style suffixes for the supported languages. Exclusion is
  the DEFAULT for `repo:ingest`; an explicit `--include-tests` flag
  (operator-owned) widens it back, mirroring the existing
  `--include-untracked` flag style. Skip counts surface in the scan
  report and CLI output like every other typed reason. Keep the rules
  in one exported, documented constant so the drill and README state
  the same truth.
- **Code-tuned extraction prompt, selected deterministically.** Extract
  the inline business prompt into a pure module (suggest
  `src/core/extraction/prompts.ts`) exporting the EXISTING prompt
  byte-identical (pin it — non-repo extraction behavior must not move)
  and a code-tuned variant targeting API-level facts (exported
  functions/classes/modules, their call/import/extends relations,
  suppressing generic identifiers by instruction). Selection is
  deterministic from data the job already carries: the `repo:` docKey
  prefix (repository ingests) picks the code prompt; everything else —
  including promoted `web:`/`mcp:` documents and legacy payloads
  without a docKey — keeps the business prompt byte-identical. NO job
  payload changes.
- **Deterministic generic-identifier suppression.** Prompt instruction
  alone is not enforcement: add a post-parse filter between
  `resolveExtractedGraph` and the merge — a bounded, validated stoplist
  (suggest an exported constant; make it operator-extensible via env
  only if genuinely needed, with Zod bounds) that drops entities whose
  lowercased name is a bare generic identifier (`entity`, `name`, `id`,
  `action`, `type`, `key`, `value`, `data`, `object`, `string`, ...),
  cascades the drop to actions citing them, and reports counts (log
  event + a label-free or bounded-label counter), never silently. It
  runs for CODE-prompt extractions; business-prompt extractions are
  untouched this session (their corpus was benchmarked; changing their
  graph shape invalidates baselines).
- **No new queues, no schema changes, no API changes.** The extraction
  job payload is untouched; the worker seam is prompt selection + the
  post-parse filter; the scanner seam is pure path selection.

## 5. File-level starting points

Inspect before editing:

- `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md` §5 (the pilot
  findings verbatim) and the roadmap §5 entry "Owner-approved
  extraction pilot on real code" (July 6, 2026).
- `src/core/repository/scanner.ts` (`ScanSkipReason`, `selectFile`,
  the git-ls-files enumeration) and `paths.ts`
  (`isExcludedDirectoryPath` — the existing exclusion precedent);
  `scanner`/`paths` unit tests for the pinning style.
- `scripts/ingest_repository.ts` (CLI flags, scan-report printing, the
  zero-paid default and extraction double gate).
- `src/workers/extraction_worker.ts` (`processJob`: the inline
  `promptData` + system message — the seam to extract; the
  `parseLlmResponse` → `resolveExtractedGraph` → merge sequence the
  suppression filter slots into).
- `src/core/graph/resolve_actions.ts` (what `resolveExtractedGraph`
  returns — entities/actions/unresolved — and how drops must cascade).
- `scripts/test_repo_ingest.ts` (the live drill to extend with
  exclusion-count assertions over its fixture repository).
- `src/config/index.ts` + `.env.example` (only if an operator bound
  ships); README §Repository ingestion.

## 6. Test strategy and acceptance

Test first. No paid LLM calls and no external network in acceptance.

Offline (joins `npm test`, baseline 568):

- Scanner: every exclusion rule accepts/rejects the exact paths it
  claims (table-driven over the exported rule set); `--include-tests`
  restores acceptance; non-test paths are untouched; skip counts typed
  as `test_fixture`.
- Prompts: the business prompt export is byte-identical to the string
  currently inline in `extraction_worker.ts` (pin the exact bytes —
  this is a Session 15-style extraction); selection by docKey prefix
  (`repo:` ⇒ code, `web:`/absent/anything else ⇒ business); the code
  prompt contains the suppression instruction.
- Suppression filter: stoplisted entities dropped with counts; actions
  citing a dropped endpoint dropped and counted; non-stoplisted
  entities and their actions pass through structurally unchanged; the
  filter is a no-op for business-prompt extractions; stoplist
  validation bounds (if env-extensible) reject junk fail-fast.

Live zero-paid:

- Extend `npm run test:repo-ingest`: the fixture repository gains a
  committed test-fixture file whose exclusion the scan report must
  count (and whose inclusion `--include-tests` must restore); snapshot
  publishing, tombstones, and the existing 45 checks stay green with
  policy `none` (no extraction spend — the prompt/filter seams get
  their live behavior only from the owner-gated pilot re-run, which is
  NOT acceptance).

Required close-out (the standing block):

```
 npm test
 npm run build
 npm run python:check
 docker compose --profile test config --quiet
 # Run the isolated zero-LLM Compose integration (unique project name).
 npm run test:repo-ingest
 npm run test:module-lifecycle
 npm run test:promotion
 npm run test:rlm-workspace
 npm run test:modules
 npm run test:rlm-mcp
 npm run test:rlm-sandbox
 npm run test:agent-loop
 npm run test:a2a
 npm run drill:scale
 npm run test:benchmark-hardening
 npm run test:entity-resolution
 npm run test:api-hardening
 npm run test:belief-recovery
 npm run test:invalidation-sweep
 git diff --check
```

Update:

- `TRELLIS_ROADMAP.md`: full-dated §5 entry with exact commands, counts,
  and any defects found; strike §4 row 1 only after acceptance.
- README §Repository ingestion (the exclusion default and
  `--include-tests` are operator-facing); `.env.example` only if a new
  bound ships; `API_REFERENCE.md` only if a client-visible contract
  changes (it should not).
- `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md`: a short addendum
  noting the prerequisites shipped and the owner-gated re-run proposal.
- If a new Python file ships under `src/rlm/`, add it to the Dockerfile
  `COPY` line and `check_python_runtime.py` (the Session 12 defect
  class; Sessions 14–18 kept this green — keep it that way).
- `HANDOFF.md`: regenerate per §0.

Standing owner-gated items (do NOT run unprompted; propose each with a
cost estimate):

- **The module #1 paid authoring turn** (design record §11 step 6) —
  **DONE (July 9, 2026), owner-approved.** The `workspace-discipline`
  protocol module (`modules/workspace-discipline/`) was authored by a
  paid RLM run (160,270 in / 7,827 out gpt-5.4 tokens) grounded in two
  promoted research documents (`research:trellis/workspace-discipline/
  contract` and `.../evidence`, 24 citable hashes), operator-corrected
  for a provenance-laundering miscitation, landed, and registered
  (`module:workspace-discipline`, 24 live hashes). `test:modules`
  27 → 33. Full record in the roadmap §5 entry "Module #1
  (workspace-discipline)". The flywheel has turned once; further
  module authoring turns remain owner-gated per-run.
- **The extraction pilot re-run** (after Session 19 ships): validates
  the code prompt + suppression on real code; propose with the printed
  block count (committed telemetry: ~512 in / ~419 out tokens per
  block).
- The paired-run behavioral probes (both MEASURED; the remaining open
  variant is a larger-payload/longer-horizon lineage probe where the
  token and external-call axes separate).

## 7. Guardrails

1. **Never mutate an AST.** The T13 hash preimage is pinned;
   `rederiveAstNodeId` stays authoritative; nothing positional is ever
   persisted as identity.
2. **Never merge, rename, or delete Entity nodes.** Equivalence stays an
   overlay belief. This includes `module_manifest` entities:
   contested/retired, never deleted — audit history is the point. The
   Session 19 suppression filter drops entities BEFORE they are ever
   written; it must never delete or rename nodes already in the graph.
3. **Preserve provenance on every semantic node and edge.**
   `write_derived_insight` remains the single AGENT write path, and its
   Session 14 enforcement (hash format + `ast_nodes` existence, checked
   before the WRITE session opens) is kernel — never weaken, bypass, or
   make it configurable. Workspace ids/content and MCP output can never
   be passed as `sourceNodeIds`; external content earns citability ONLY
   through the verified ingest path (the Session 17 promotion CLI).
   Harness-side writers (extraction merge, module registration) mirror
   the provenance state machine in `src/core/graph/provenance.ts` —
   never invent divergent semantics.
4. **Promotion and module landing are operator-gated, absolutely.** No
   autonomous path from Tier 3 to Tier 1; no API endpoint that
   promotes or registers modules; no model output that triggers
   ingestion, registration, or manifest edits. Registration skips
   non-active manifests (recovery follows re-review, never precedes
   it); nothing auto-edits manifest `status` from graph state.
5. **Operator control is absolute for the RLM tool surface AND the
   module space:** servers, tools, modules, bounds, credential
   references, scanner exclusions, and extraction stoplists come from
   validated config or exported constants only; no inbound payload or
   model completion may alter any of it mid-run. L1 (runtime config
   mutation) and L2 (runtime code hot-patching) remain forbidden; L3
   lands only through the recorded gates.
6. **Every external interaction is bounded;** workspace and scratch
   state is TTL- and byte-bounded by validated config; over-budget
   writes and seeds raise — never silent truncation. TTL expiry of
   parked snapshots is BY DESIGN; permanence is earned via promotion
   only.
7. **Validate at every boundary:** bounds and registries cross Zod and
   Python twin validators; all LLM calls stay inside BullMQ workers or
   the RLM process; every worker-consumed completion crosses
   `parseLlmResponse`; the orchestrator stays tool-free;
   `AGENT_ORACLE_ENABLED` and `TRELLIS_A2A_ENABLED` defaults stay
   pinned false.
8. **Default to zero paid work and zero external network in
   acceptance;** the fixture server remains the only MCP server
   acceptance configures; drills promote and cite fixture-produced or
   drill-authored bytes only; the extraction pilot re-run and the
   module #1 authoring turn are owner-approved, per-run.
9. **Do not break existing consumers:** the business extraction prompt
   stays byte-identical for every non-`repo:` document (pinned) —
   changing the benchmarked corpus's graph shape invalidates the
   committed baselines; with no workspace attached, `call_tool` returns
   and the system prompt are byte-identical; the unseeded prompt is
   byte-identical to Session 14; with module #0 loaded the composed
   prompt is byte-identical to the pre-Session-15 monolith (the sha256
   pin in `test:modules` must not move unless the kernel prompt
   legitimately changes — recompute in the same commit); pre-Session-9
   `rlm_queue` payloads still process; the `/api/agent-stream` SSE
   contract, the A2A v1.0 surface, and the backend API contract are
   untouched; non-promotion ingests leave `documents.origin` NULL; the
   backend API key never reaches any client bundle.
10. **Respect the rlms prompt contract:** extend `RLM_SYSTEM_PROMPT`,
    never replace it; no literal curly braces in anything rlms formats;
    no rlms library modifications.
11. **Follow the T16 observability house style:** workspace content,
    module addendum text, queries, tool arguments/results, hashes,
    promoted content, entity names, file paths, and credentials never
    become metric label values; suppression/exclusion telemetry is
    counts only.
12. **Keep API and worker processes split;** project-scoped Compose
    commands; fixtures and drills clean up only token-scoped or
    pre-snapshotted state.
13. **Ship one feature branch and one PR to `master`,** plain
    engineering prose, no AI attribution or generated-by trailers.
    Regenerate this file in the same PR. RLM expands exclusively to
    Recursive Language Model.

## 8. Explicit exclusions

Do not include: frontend work of any kind (deferred, unscheduled —
scope preserved in roadmap §3.3 #5); running the extraction pilot
re-run or ANY paid extraction as acceptance (owner-gated, per-run);
running the module #1 paid authoring turn (owner-gated, standing);
retro-filtering or deleting existing graph entities (the suppression
filter is pre-write only; the pilot's graph was already tombstoned);
changing the business extraction prompt's bytes or the benchmarked
corpus's graph shape; tool-bearing modules or module auto-landing;
autonomous nomination, promotion, registration, or manifest editing;
a promotion/module HTTP or A2A surface; batch promotion; orchestrator
tools; live intra-batch workspace sharing; durable cross-goal scratch
storage (TTL stays); rlms `compaction` enablement; new MCP servers,
transports, or OAuth flows; A2A changes; `ASTRef`/`EVIDENCED_BY`
migration (gate closed at 286); T13 re-hashing; rlms library
modifications; weakening or toggling the Session 14 write-path
enforcement, the Session 15 composition pins, the Session 16 lineage
byte-identity pins, the Session 17 promotion refusals, or the
Session 18 registration gates (existence check, non-active skip); paid
LLM calls or external network access as acceptance checks.
