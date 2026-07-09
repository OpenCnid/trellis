You are a principal systems engineer continuing development on Trellis Engine,
a Recursive Language Model runtime over a provenance-enforced knowledge
substrate — its GraphRAG-shaped storage layers survive as Tiers 1–2 of the
trust model; the system is the RLM standing on them (reframed July 9, 2026;
see the root README "What Trellis is") (repository:
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
  lineage, the promotion path, the self-editing doctrine (revised
  July 9, 2026 by owner directive: content pool + standard editing
  permissions — see the design record §7), the kernel/userspace
  boundary (packaging, not permission), the module
  manifest/registry/gates design with module #0, and a six-step
  implementation sequence), `docs/GLOSSARY.md` (authority: code >
  glossary > prose), roadmap §1 drift fixes, Session 14 scoping, and
  README alignment.
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
  byte-identical composed-prompt pin (`npm run test:modules`).
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
  `npm run test:promotion` (41 checks).

Session 18 (July 8, 2026, PR #47) is also complete: **the first
flywheel turn, machinery** — the research existence gate at module
registration (`findMissingAstHashes` in
`src/core/graph/module_registration.ts`; a manifest citing any unknown
hash refuses the WHOLE invocation with a bounded listing), the §9.4
manifest-as-graph-entity representation (`npm run modules:register`
MERGEs each research-bearing ACTIVE manifest as
`(:Entity {kind: 'module_manifest', name: 'module:<name>'})` carrying
the manifest's research hashes, ON MATCH mirroring `applyRederivation`
so the UNCHANGED invalidation sweep contests a module whose promoted
research is superseded), and contested-module surfacing
(`npm run modules:verify`, read-only, with an ACTION prescription). The
recovery loop stays human; contested/retired manifests are SKIPPED by
registration; empty-research module #0 registers nothing. Zero-paid
acceptance `npm run test:module-lifecycle`.

**The module #1 paid authoring turn RAN on July 9, 2026** (PR #45):
`modules/workspace-discipline/` — corpus promoted as
`research:trellis/workspace-discipline/{contract,evidence}` (24 citable
block hashes); one paid run drafted the brace-free addendum; landed with
the composed-prompt pin unmoved (the module is NOT in the default
selection) and registered live. **The turn also observed the §10
provenance-laundering residual live:** the run's self-reported
`research.sourceNodeIds` were real-but-unrelated hashes surfaced by 21
whole-database `vector_search` calls, not the promoted corpus — the
existence gate cannot catch that (the hashes exist); the operator caught
and corrected it before landing. The remediation design (PR #46,
`docs/architecture/GROUNDED_AUTHORING.md`) is what Session 19
implemented.

Session 19 (July 9, 2026, PR #50) is also complete: **grounded
authoring** — `trellis_agent.py --mode author`, a DB-free branch whose
`custom_tools` is exactly `{trellis_workspace}` (no
`TrellisPostgres`/`TrellisNeo4j`/MCP constructed — the process opens no
DB connection), seeded with the promoted corpus block-aligned
(`src/core/authoring/corpus.ts`/`seed.ts`; `origin.argsHash` = the block
hash's first 16 hex), composing rlms base + a brace-free author addendum
+ the workspace surface + the driver's byte-pinned template
(`template.ts`), and emitting a hashes-free `TRELLIS_DRAFT` envelope.
The harness holds the pen: `research.sourceNodeIds` is pinned from the
corpus block set; the deterministic anchor gate (`anchors.ts`,
`ANCHOR_COVERAGE_THRESHOLD = 0.3`) refuses a corpus-blind draft; the
draft scanner (`src/core/observability/rlm_draft.ts`) refuses any 64-hex
token. The operator driver `npm run modules:author` echoes the plan and
refuses to spawn without `--confirm-paid`; `--draft` is the zero-paid
drill path; assembly writes a module directory for human review only. A
follow-up provenance-citation A/B eval (owner-approved paid;
`docs/benchmarks/PROVENANCE_CITATION_AB_REPORT.md`) added opt-in,
off-by-default citation instrumentation
(`TRELLIS_CITATION_AUDIT`/`_HINT`/`_ENTAIL`), found that citation
laundering is incentive-driven (only the semantic entailment check
catches it — never reward citation count), and FIXED a real bug:
`get_ast_texts`/`vector_search` returned NULL for markdown/container
block text (`_node_text` reconstruction — the RLM could not read
markdown or promoted research). No module #2 was authored.

Session 20 (July 9, 2026, this PR) is also complete: **the
code-mediated-text follow-ups** (core pillar record
`docs/architecture/CODE_MEDIATED_TEXT.md` §6.1 + §6.2; owner directive
July 9 — extraction deferred behind it). **(1) The editing toolkit**
(`src/rlm/trellis_textedit.py`): a `TrellisTextEdit` holder injected as
`trellis_textedit` ONLY when the operator sets `TRELLIS_EDIT_ROOT` (Zod
fails fast when not an existing directory; `buildAgentEnv` forwards
root + bounds exactly when configured and strips raw inherited values;
payloads carrying anything textedit-shaped are ignored — all
unit-pinned). Surface = the pillar's §2 as tooling shape: `load` (held
`text.split("\n")` frame + load-time sha256; unedited round-trips are
byte-identical, moved CRLF lines keep their bytes verbatim), `lines`
(bounded half-open slices), `locate` (engine-computed 0-based addresses,
bounded hits + true total), `splice` (staged replacement at computed
ranges; lists of newline-free strings only; addresses transient —
re-locate after each splice), `diff`/`revert`/`drop`, and `write_back`
(re-hash the CURRENT disk bytes; mismatch RAISES `StaleFileError` and
writes nothing; else temp + rename atomic). Containment is
resolve-then-commonpath — `..`, absolute/rooted paths, and symlink
escapes are refused before any I/O. Bounds are Zod + Python twins
(`TRELLIS_TEXTEDIT_MAX_FILE_BYTES` 4 MiB/32 MiB,
`TRELLIS_TEXTEDIT_MAX_FILES` 16/64); slice/hit/diff caps are kernel
constants. Counts-only telemetry
(`textedit_ops`/`textedit_files`/`textedit_writes`); toolkit ops never
count as database tool calls. Unset ⇒ byte-identical prompt and
namespace, pinned by the new `npm run test:textedit` (81 checks). Git
stays out of the toolkit: landing is a human PR. **(2) The kernel
prompt revision** (§6.2, its own commit): the brace-free CODE-MEDIATED
TEXT hard-rule block joined `TRELLIS_ADDENDUM_BASE`; the `test:modules`
composed-prompt pin moved wittingly (`abb945a6…f9b2` → `170e9f7e…67e9`,
recomputed in the same commit; the constant, renamed
`COMPOSED_SYSTEM_PROMPT_SHA256`, records its move history in place).
Defect found and fixed during the drill: Python 3.13 `ntpath.isabs`
treats a bare leading slash as drive-relative, so `/etc/passwd` was
refused by the commonpath backstop with the wrong message — rooted
paths are now refused explicitly as absolute on every platform. **The
supervised Trellis-edits-Trellis proof run did NOT happen — it is
owner-gated and separate.** The same PR also carries the owner-directed
**RLM reframing documentation overhaul** (docs only, zero code, zero
pins): the root README rewritten around Trellis-as-RLM-runtime (the
five commitments, the GraphRAG inversion, the DDD authority chain),
`docs/README.md` reorganized by document status, a canonical **Trellis**
GLOSSARY entry, identity lines updated here and in the roadmap §1 and
the collaborator briefing, and historical banners on the three MVP-era
architecture records — see the roadmap §5 entry of July 9, 2026.

OpenCnid selected the MIT License on July 6, 2026.

Your objective is **Session 21: the repository-scale extraction
prerequisites** (roadmap §4 row 2; deferred behind Session 20 by the
July 9, 2026 owner directive — deferred, not dropped): the test/fixture
extraction exclusion, the generic-identifier stoplist, and the
code-tuned extraction prompt, per the recorded pilot findings
(`docs/benchmarks/REPOSITORY_INGESTION_REPORT.md` §5) and §3–§6 below.
Do not re-plan or re-implement completed work. RLM expands exclusively
to Recursive Language Model (the MIT CSAIL formulation).

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
5. **Re-run the loop for late work (the event-loop rule; added by owner
   direction, July 9, 2026 — part of the permanent protocol from here on).**
   Regeneration is not a one-shot close-out. If further work lands in the
   same working period AFTER this file was rewritten — an owner-approved
   paid run, a follow-up fix, a new design record — re-run step 3's
   objective selection against what that work revealed before handing off.
   A defect discovered in a pathway the flywheel or the next objective
   depends on satisfies the jump-the-queue rule even when an existing gate
   contained it: containment is not remediation. Pointer edits to this file
   are not a substitute for re-selecting the objective. A handoff whose §3
   objective is stale relative to the session's own findings has not
   finished step 3. (Origin: the module #1 laundering finding and its
   design record initially landed as standing-item pointers while §3 still
   named the pre-finding objective; the owner corrected the priority.)

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
   - **Extraction (Sessions 1/8 — the Session 21 objective's site):**
     `src/workers/extraction_worker.ts` consumes `extraction_queue` jobs
     `{astNodeId, text, ...}` enqueued by the verified ingest path when
     the operator selected extraction policy `changed`: liveness gate →
     one completion (`GraphSchema` via `zodResponseFormat`, crossing
     `parseLlmResponse`) → `resolveExtractedGraph` →
     `mergeWithAstLivenessFence(mergeExtractedGraph)` (ON MATCH mirrors
     the quarantine/recovery semantics; dropped actions are counted and
     logged, never silent) → per-block embedding. The extraction prompt
     today is one hardcoded document-generic string ("macro-level
     business entities"), blind to source kind. Extraction spend is
     always operator-gated (`plan_ingest.ts`: policy `none` default;
     `changed` needs an explicit block budget, and `repo:ingest` adds
     `--confirm-extraction`).
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
     the validated workspace bounds, the canonical module selection, and —
     Session 20 — the textedit root + bounds exactly when the operator
     set `TRELLIS_EDIT_ROOT`; unset config values are stripped, never
     passed through raw). `buildAgentArgs` forwards `--max-iterations`,
     `--goal-id`, and (Session 16) the worker-named
     `--workspace-out`/`--seed-workspace` temp files — a queue payload
     can never pick filesystem paths. The worker publishes every stdout
     chunk and feeds two pure bounded scanners over the identical bytes:
     `RlmTelemetryScanner` (`TRELLIS_TELEMETRY:` spend line) and
     `RlmResultScanner` (`TRELLIS_RESULT:` task envelope
     `{status, answer, toolCalls}`). Job payloads are normalized by
     `parseRlmJobData`: pre-Session-9 `{query, jobId}` still processes;
     optional `goalId`/`taskId` correlation, `maxIterations`, `seedTasks`
     (ids only, never content), and a data-only `stub` replay mode (whose
     optional `workspaceSnapshot` parks through the identical path) for
     zero-LLM drills. Payloads carry nothing MCP-, workspace-content-, or
     textedit-shaped (unit-pinned).
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
     `TRELLIS_PROTOCOL_VIOLATION` no matter how many MCP, workspace, or
     textedit operations happened.
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
   - **CORE PILLAR — code-mediated text (ratified July 9, 2026;
     `docs/architecture/CODE_MEDIATED_TEXT.md`, doctrine on par with the
     provenance invariant):** *the model never counts, and the model
     never copies.* The RLM handles all text through queryable REPL
     structures ("ingestion = pandas"): locations are engine-computed
     and returned by query (transient handles — re-query, never
     remember); existing bytes are moved by code (splice at a computed
     address, hash-guarded write-back), never re-typed through
     attention ("no direct edits, only code edits — rigidly"); the
     model authors only genuinely new text plus the code that
     manipulates everything else. Localization error and transcription
     error (the laundering channel) are the same pathology — attention
     doing code's job. Payoff: effective context bounded by REPL
     memory, not the attention window. Lines locate, blocks mean.
     Enforcement lands as tooling shape (structured ops + hash
     guards); prompts reinforce only. Session 20 implemented §6.1 (the
     editing toolkit) and §6.2 (the kernel prompt hard-rule block); the
     remaining §6 follow-ups (the effective-context probe §6.3, module
     #1 v2 §6.4) stay owner-gated.
   - **The editing toolkit (Session 20; `src/rlm/trellis_textedit.py`):**
     `TrellisTextEdit` injected as `trellis_textedit` ONLY when the
     operator sets `TRELLIS_EDIT_ROOT` (never a default; never from a
     payload or completion; byte-identical prompt and namespace when
     unset — pinned by `npm run test:textedit`). Every path strictly
     resolves inside the real root: `..`, absolute/rooted paths, and
     symlink escapes are refused before any I/O (note: Python 3.13
     `ntpath.isabs` treats a bare leading slash as drive-relative — the
     toolkit refuses rooted paths explicitly). `load` holds a
     `text.split("\n")` frame + load-time sha256 (the join is the exact
     inverse — an unedited round-trip is byte-identical); `locate`
     returns engine-computed 0-based half-open addresses (bounded hits
     + true total); `splice` stages replacements (lists of newline-free
     strings; addresses are transient — re-locate after each splice);
     `diff` (bounded) / `revert` / `drop` review and manage frames;
     `write_back` re-hashes the disk bytes and RAISES `StaleFileError`
     on mismatch (re-load and re-derive, never retype), else writes
     temp + rename. Bounds: Zod + Python twins
     (`TRELLIS_TEXTEDIT_MAX_FILE_BYTES` default 4 MiB cap 32 MiB;
     `TRELLIS_TEXTEDIT_MAX_FILES` default 16 cap 64); slice (200) / hit
     (40) / diff (400) caps are kernel constants. Telemetry counts only
     (`textedit_ops`/`textedit_files`/`textedit_writes`) — a separate
     counter in the `mcp_calls` mold; toolkit ops never satisfy the
     provenance protocol, and edited file content earns citability only
     through verified ingest/promotion. The toolkit never touches git;
     landing is a human PR. The brace-free TEXTEDIT addendum composes
     only when configured. Author mode does NOT inject it.
   - **The module registry (Sessions 15/18; `src/config/modules.ts` +
     `src/rlm/trellis_modules.py`, `modules/<name>/`):**
     `TRELLIS_ADDENDUM` = `TRELLIS_ADDENDUM_BASE` + Σ selected module
     addenda + `TRELLIS_WORKFLOW_RULES`. Selection is operator-owned via
     `TRELLIS_MODULES` (unset ⇒ default `["spatial-flywheel"]`; `[]` ⇒
     base + rules only; max 4/run). PROTOCOL MODULES ONLY this kernel
     edition — manifests declaring tools are rejected. Addendum files
     are brace-free; rubric text enters through the single
     `<<TRELLIS_RUBRIC>>` substitution token. Both validators are
     bound-for-bound twins and normalize CRLF→LF. The manifest carries
     `research.sourceNodeIds` (format-checked 64-hex; existence-checked
     at REGISTRATION, Session 18) and `status` (`active`/`contested`/
     `retired`; only `active` composes — and only `active` registers).
     Since Session 20 the composed default prompt is pinned at
     `COMPOSED_SYSTEM_PROMPT_SHA256 = 170e9f7e…67e9` (the §6.2 kernel
     block included; the pin constant records its move history in
     `scripts/test_modules.py` — it moves only with a witting kernel
     change, recomputed in the same commit).
   - **Grounded authoring (Session 19; `src/core/authoring/*` +
     `src/core/observability/rlm_draft.ts` + `scripts/author_module.ts`
     + `trellis_agent.py --mode author`):** the kernel mode that drafts
     a protocol module addendum from a FIXED promoted corpus and nothing
     else. Author runs see only `trellis_workspace` (no DB/search/write
     — no DB connection opens; no textedit), work from a block-aligned
     seeded corpus, and emit a hashes-free `TRELLIS_DRAFT` envelope. The
     harness holds the pen: `research.sourceNodeIds` is pinned from the
     corpus block set (`corpus.ts`/`seed.ts`), the authoring template is
     a byte-pinned kernel constant composed from (topic, doc keys), the
     deterministic anchor gate (`anchors.ts`,
     `ANCHOR_COVERAGE_THRESHOLD = 0.3`) refuses a corpus-blind draft,
     and the draft scanner refuses any 64-hex token. `npm run
     modules:author` assembles a directory for human review only — it
     never registers, lands, or edits an existing module. The paid
     authoring run is owner-gated per run.
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
     content, module addendum text, file paths, file content, diffs,
     digests, server commands, URLs, and credentials never become label
     values or log content (entity names may appear in log CONTENT per
     the extraction dropped-action precedent). Queue-depth gauges cover
     all seven queues; `trellis_rlm_mcp_calls_total` is label-free.
     Workspace, lineage, and textedit telemetry is counts only.
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
     repo:ingest`, live drill `npm run test:repo-ingest`. The Session 21
     objective lives HERE and in `src/workers/extraction_worker.ts`.
   - Benchmarks: OOLONG v1 saturated baseline; anti-shortcut v2 at
     `data/oolong_pairs_dataset_hard.json`; scale evidence in
     `docs/benchmarks/SCALE_PROVENANCE_REPORT.md` and
     `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md`; the paired-run
     workspace probes in `docs/benchmarks/WORKSPACE_PROBE_REPORT.md`
     and `docs/benchmarks/WORKSPACE_LINEAGE_PROBE_REPORT.md`; the
     provenance-citation A/B eval in
     `docs/benchmarks/PROVENANCE_CITATION_AB_REPORT.md`.
   - The fixture MCP server (`scripts/fixture_mcp_server.py`; stdio and
     Streamable HTTP with an optional required-bearer mode) is the only
     MCP server acceptance ever configures; real web-search servers are
     owner-approved runs with the allowlist printed and `mcp_calls`
     recorded. The containerized tool-server pattern is the
     `mcp-fixture` Compose service (test profile).

## 2. Current baseline

Repository state at handoff creation:

- `master`: the head after the July 9, 2026 sequence ending in
  Session 20 (the editing toolkit + the kernel prompt revision, the PR
  that carries this file; stacked on the PR #54 pillar record). Use
  `git log -- HANDOFF.md` to confirm the Session 20 PR landed. If it is
  still unmerged when this session starts, STOP and merge it first.
- `modules/workspace-discipline/` exists (module #1); the dev graph
  carries its registered entity `module:workspace-discipline` (24 live
  research hashes) and the promoted corpus documents
  `research:trellis/workspace-discipline/{contract,evidence}` (50 AST
  nodes, none embedded — promotion policy `none` writes no embeddings).
  Sessions 19–20 added NO committed module (the module #2 paid run is
  owner-gated and did not run).
- Session 20 added `src/rlm/trellis_textedit.py` (in the Dockerfile
  COPY line and `check_python_runtime.py`), the `src/config` textedit
  validation (`TRELLIS_EDIT_ROOT` + two bounds, root existence
  fail-fast), `buildAgentEnv` textedit forwarding with strip-when-unset,
  the gated injection + brace-free TEXTEDIT addendum in
  `trellis_agent.py`, the §6.2 CODE-MEDIATED TEXT block in
  `TRELLIS_ADDENDUM_BASE` (composed-prompt pin moved wittingly to
  `170e9f7e…67e9`), `scripts/test_textedit.{py,ts}` (`npm run
  test:textedit`), `src/config/textedit_bounds.test.ts`, and README /
  `.env.example` operator documentation. `TRELLIS_EDIT_ROOT` is set in
  NO default, worker, or Compose configuration — enabling it is a
  per-run operator decision.
- Offline baseline: `npm test` = 621 passing across 71 files
  (Session 20 added `textedit_bounds.test.ts` and extended
  `rlm_job.test.ts`).
- `npm run build` and `npm run python:check` pass.
- `npm run drill:scale`: gate CLOSED at max provenance 286 (run-to-run
  sweep-growth band ~1.63x–2.26x across Sessions 12–20; Session 20
  observed 1.70x).
- Live zero-LLM checks (Session 20 observed counts): `test:textedit`
  (81, NEW), `test:module-lifecycle` (60), `test:modules` (43 — the
  composed-prompt sha256 pin moved ONCE, wittingly, with the §6.2
  kernel block; recompute it in the same commit only if the kernel
  prompt or rubric legitimately changes again), `test:promotion` (41),
  `test:rlm-workspace` (86), `test:rlm-mcp` (86), `test:rlm-sandbox`
  (21), `test:agent-loop` (35 / ALL CHECKS PASSED), `test:a2a` (46),
  `test:repo-ingest` (45), `test:benchmark-hardening` (24),
  `test:entity-resolution` (34), `test:api-hardening` (18),
  `test:belief-recovery` (30), `test:invalidation-sweep` (17).
- Isolated Compose integration: 10 assertions (`--profile test`, unique
  project name, host ports 0 via `TRELLIS_*_HOST_PORT=0`; includes the
  containerized credentialed MCP fixture probe). Session 20 ran it as
  project `trellis_s20_ci` (all 10 PASS) and tore it down with
  `--volumes`. NOTE: the machine's C: drive runs close to full and an
  image rebuild needs several GB of headroom (Session 20 started with
  ~31 GB free and the incremental rebuild fit). Changing `package.json`
  invalidates the Docker `npm ci` layer, forcing that rebuild.
- CI target is Node 22. Session 20's local environment was Node 20.19.2,
  Python 3.13.1, Docker Compose v2, PostgreSQL 16.x, Neo4j 5.11.
- Python runtime deps are pinned in `requirements.txt` (`rlms==0.1.3`,
  `openai`, `neo4j`, `psycopg2-binary`, `unstructured`, `mcp==1.12.4`);
  `npm run python:check` verifies syntax/imports/assets — including
  `trellis_textedit.py` since Session 20. Session 21 should ship NO new
  Python file (see §4), so the Dockerfile `COPY` and
  `check_python_runtime.py` stay untouched.
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

## 3. Session 21 problem statement

**The repository-scale extraction prerequisites (roadmap §4 row 2; the
recorded pilot findings are NORMATIVE —
`docs/benchmarks/REPOSITORY_INGESTION_REPORT.md` §5).**

The July 6, 2026 owner-approved extraction pilot (112 blocks from
`src/core/graph`, zero pipeline failures, 340 entities / 318
relationships) proved the mechanics and surfaced three blockers that
make a full-repository `--extract changed` run irresponsible today:

1. **Test-fixture contamination.** Fixture strings in
   `alias_candidates.test.ts` produced `globex corporation
   --[acquired]-> initech`, and name-based entity identity merged those
   onto pre-existing demo entities — fictional facts from test files
   gain real-looking provenance. Nothing in
   `src/core/repository/scanner.ts` / `paths.ts` distinguishes test or
   fixture paths: `classifyRepositoryPath` knows only validation,
   `EXCLUDED_SEGMENTS` (vendor/artifact directories), language, and
   size. The fix must NOT drop these files from ingestion — test files
   are legitimate verified substrate (citable bytes, liveness,
   provenance) — it must keep their blocks out of SEMANTIC EXTRACTION.
2. **Generic-identifier hubs.** The top pilot entity was literally
   `entity` (14 sources), with `name`, `id`, and `action` close behind.
   At repo scale these become mega-hubs — and a spurious fast path to
   the 3.3 #4 migration trigger (`drill:scale` watches maximum
   `sourceNodeIds` cardinality). Today nothing between
   `parseLlmResponse` and `mergeExtractedGraph` filters entity names.
3. **Prompt mismatch.** The extraction prompt
   (`src/workers/extraction_worker.ts`, `promptData`) targets
   "macro-level business entities"; on source code it improvises
   (`organization --[is_default_type_for]-> organization`). The prompt
   is one hardcoded string, blind to what kind of document the block
   came from.

Everything needed has a seam: the pure path predicates in
`src/core/repository/paths.ts` (the `isExcludedDirectoryPath` pattern),
the per-file extraction policy already threaded through
`plan_ingest.ts`/`snapshot_ingest.ts` (policy `none` produces zero
extraction jobs for a file — finding #1 can be pure selection, no
worker change), the extraction job payload and prompt assembly in
`extraction_worker.ts` (finding #3), and the post-parse, pre-merge gap
between `resolveExtractedGraph` and `mergeExtractedGraph` (finding #2).
The extraction pilot RE-RUN that would validate all three fixes live is
owner-gated paid work — this session ships the prerequisites with
zero-paid acceptance.

## 4. Required design

Findings #1–#3 map to three independent, individually testable changes.
Keep each pure and unit-pinned; keep every behavior change visible in
CLI output and logs (counts, never silence).

- **The test/fixture extraction exclusion (finding #1) — selection,
  not worker.** A pure predicate `isTestOrFixturePath(relativePath)` in
  `src/core/repository/paths.ts`: path segments `test`, `tests`,
  `__tests__`, `spec`, `specs`, `fixtures`, `__fixtures__`, `testdata`,
  `__mocks__`, `mocks`; basename patterns `*.test.*`, `*.spec.*`,
  `test_*.py`, `*_test.{ts,js,py}`, `conftest.py`. Exact segment and
  pattern matches only — `contest.ts`, `attest/`, and `latest.py` must
  NOT match. Wire it where the repo ingest computes each file's
  extraction policy (`snapshot_ingest.ts` / `scripts/ingest_repository.ts`):
  under `--extract changed`, matching files get per-file policy `none`
  — still ingested, still citable, zero extraction jobs. Report the
  count (`extractionExcluded: N`) in the CLI summary next to the
  existing accepted/skipped counts. An explicit `--extract-tests` flag
  includes them wittingly (the `--confirm-extraction` double-gate house
  style — default excluded, override loud). API-path ingest
  (`POST /ingest`) and promotion are untouched: the predicate is
  repository-ingest policy, keyed on repo-relative paths, not a global
  rule. Do NOT overload `ScanSkipReason` — exclusion is not a skip; the
  files stay in the snapshot.
- **The generic-identifier stoplist (finding #2) — post-parse,
  pre-merge.** A kernel-constant stoplist (never env-tunable; the
  slice-cap precedent) of normalized generic identifiers — seed it from
  the pilot's observed hubs (`entity`, `name`, `id`, `action`, `type`,
  `value`, `data`, `result`, `key`, `node`, `object`, `list`, `string`,
  `error`, `config`, and the session's judgment from the pilot report)
  — applied by a pure helper (recommended:
  `src/core/graph/extraction_stoplist.ts`) between
  `resolveExtractedGraph` and the merge in `extraction_worker.ts`: drop
  stoplisted entities AND the actions referencing them; return exact
  dropped counts; log (`extraction.stoplist_dropped` — names allowed in
  log content per the existing dropped-action precedent) and count (a
  new bounded metric, `extractionStoplistDroppedTotal`). Exact
  normalized-name match only — no fuzzy matching, no substrings.
  Document-sourced extraction crosses the same filter (a generic hub is
  a hub regardless of source); state this in the roadmap entry.
- **The code-tuned extraction prompt (finding #3) — additive job
  field.** The extraction job payload gains an optional
  `sourceKind: 'code' | 'document'` (absent ⇒ `document` ⇒ the
  byte-identical legacy prompt — pinned): the verified ingest path sets
  it from the parser that produced the block (`detectLanguage` non-null
  ⇒ `code`) when enqueueing extraction jobs. In `extraction_worker.ts`,
  factor the prompt into a pure `buildExtractionPrompt(sourceKind,
  text, astNodeId)` (unit-testable; the current string becomes the
  `document` branch VERBATIM — do not reword it this session). The
  `code` branch targets API-level facts (modules, exported
  functions/classes, the contracts between them: "X uses Y", "X
  validates Z"), instructs sparseness, and explicitly forbids
  extracting generic identifiers (variable names, parameter names,
  primitive type names) as entities — the prompt half of finding #2;
  the stoplist stays the enforcement half (prompts request, gates
  enforce).
- **What does NOT change:** the extraction merge semantics
  (`extraction_merge.ts` — transitions must keep commuting with the
  sweep), the liveness fence, `GraphSchema`, the embedding step, the
  `plan_ingest.ts` budget gates, and the worker retry policy. No new
  queue, no DDL, no API surface, no Python/RLM changes this session
  (the composed-prompt pin must not move).

## 5. File-level starting points

Inspect before editing:

- `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md` §5 — the three
  findings verbatim, with the observed entity/relationship numbers.
- `src/core/repository/paths.ts` — `EXCLUDED_SEGMENTS` /
  `isExcludedDirectoryPath` (the pure-predicate pattern to mirror) and
  `validateRepoRelativePath`.
- `src/core/repository/scanner.ts` — `classifyRepositoryPath` and the
  `ScanSkipReason` vocabulary (do not overload it; exclusion is not a
  skip).
- `src/core/repository/snapshot_ingest.ts` + `scripts/ingest_repository.ts`
  — where per-file ingest requests and the extraction policy are
  assembled and where the CLI summary counts print.
- `src/core/ingestion/plan_ingest.ts` — the `none`/`changed` policy and
  block-budget contract the per-file exclusion rides on.
- `src/workers/extraction_worker.ts` — `promptData` (the string to
  factor into `buildExtractionPrompt`), the
  `parseLlmResponse`/`resolveExtractedGraph`/`mergeWithAstLivenessFence`
  sequence (the stoplist insertion point), and the existing
  dropped-action logging/metric pattern to mirror.
- `src/core/graph/resolve_actions.ts` + `src/core/graph/schemas.ts` —
  the resolved-graph shapes the stoplist helper consumes.
- `src/core/observability/metrics.ts` — where
  `extractionDroppedActionsTotal` and friends are declared (the new
  counter's home).
- `scripts/test_repo_ingest.ts` — the live drill to extend with the
  exclusion counts.

## 6. Test strategy and acceptance

Test first. No paid LLM calls and no external network in acceptance —
the extraction pilot re-run over the fixed pipeline is owner-gated and
NOT acceptance.

Offline (joins `npm test`, baseline 621 across 71 files):

- `isTestOrFixturePath`: a table test over accepted and rejected paths
  (segments, basenames, nested cases, case handling, lookalikes that
  must NOT match — `contest.ts`, `attest/util.ts`, `latest.py`,
  `protest/spec_of_work.md`).
- Per-file policy assembly: under `--extract changed`, matching files
  produce policy `none` and are counted; `--extract-tests` restores
  `changed` for them; `--extract none` runs are unaffected (no counts,
  no jobs).
- The stoplist helper: drops stoplisted entities and their actions,
  keeps everything else identical, returns exact counts; the empty
  graph and the all-stoplisted graph both behave.
- `buildExtractionPrompt`: the `document` branch is byte-identical to
  the pre-Session-21 string (pinned); absent `sourceKind` ⇒ `document`;
  the `code` branch carries the generic-identifier prohibition.
- Extraction job payload: `sourceKind` is optional and bounded to the
  two values; pre-Session-21 payloads still process.

Live zero-paid (extend `npm run test:repo-ingest`):

- A drill tree containing a test file with a distinctive fixture
  string: under the drill's zero-paid posture, the test file is
  ingested and citable but contributes zero extraction jobs; the
  exclusion count matches; `--extract-tests` produces jobs for it.
- The stoplist and prompt changes need no live drill beyond the offline
  pins (they sit behind the paid boundary); re-run
  `test:invalidation-sweep` and the offline suite to prove the worker
  path is undisturbed.

Required close-out (the standing block):

```
 npm test
 npm run build
 npm run python:check
 docker compose --profile test config --quiet
 # Run the isolated zero-LLM Compose integration (unique project name).
 npm run test:textedit
 npm run test:module-lifecycle
 npm run test:modules
 npm run test:promotion
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
  and defects found; strike §4 row 2 only after acceptance.
- `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md`: a §5 postscript
  noting the prerequisites shipped (date, mechanism per finding).
- README: the repo-ingest section gains the exclusion/override flags.
- `HANDOFF.md`: regenerate per §0 — including the §0 step 5 re-check.

Standing owner-gated items (do NOT run unprompted; propose each with a
cost estimate):

- **The extraction pilot re-run** over the fixed pipeline (the direct
  validation of this session's work; the July 6 pilot spent 112
  completions ≈ 57k input / 47k output tokens — estimate before
  proposing, per the standing $5/run policy).
- **The supervised Trellis-edits-Trellis proof run** (Session 20's
  standing item) — operator sets `TRELLIS_EDIT_ROOT` at a branch
  checkout; the RLM performs one small real edit through the toolkit;
  it lands as an ordinary reviewed PR.
- **The effective-context probe** (pillar §6.3; paid, extends the
  workspace-probe series) — spend cap $5/run per the standing policy.
- **Module #1 v2** through grounded authoring (pillar §6.4) and the
  **module #2 turn** (topic owner-picked, prompt-movable,
  positive-control-testable).

## 7. Guardrails

1. **Never mutate an AST.** The T13 hash preimage is pinned;
   `rederiveAstNodeId` stays authoritative; nothing positional is ever
   persisted as identity.
2. **Never merge, rename, or delete Entity nodes.** Equivalence stays an
   overlay belief; module entities are contested or retired, never
   deleted. The stoplist prevents CREATION of generic entities going
   forward — it never deletes or renames existing ones (pre-existing
   hubs age out through the ordinary contested/liveness machinery).
3. **Preserve provenance on every semantic node and edge.**
   `write_derived_insight` remains the single AGENT write path with its
   Session 14 enforcement intact. Extraction-excluded files are still
   INGESTED — the exclusion narrows semantic extraction, never
   provenance or citability.
4. **Extraction spend stays operator-gated.** The `none` default, the
   block budget, and `--confirm-extraction` are untouched;
   `--extract-tests` widens scope only inside an already-confirmed
   extraction run. No paid calls in acceptance.
5. **Gate machinery is kernel; operator control is absolute.** The
   stoplist and the prompt variants are kernel constants — never
   env-tunable free text, never payload- or completion-selectable. The
   Session 20 textedit invariants are permanent: `TRELLIS_EDIT_ROOT`
   and its bounds come only from operator env (never payload, never
   completion; unset ⇒ byte-identical, pinned); all paths resolve
   strictly inside the root; the toolkit never touches git; landing
   stays a human PR under standard permissions (design record §7).
6. **Every external interaction is bounded;** listings and reports
   cross validated bounds; over-budget raises with usage — never silent
   truncation. Dropped extraction output is counted and logged, never
   silent.
7. **Validate at every boundary:** every worker-consumed completion
   crosses `parseLlmResponse`; new job-payload fields are optional,
   bounded, and Zod-validated; pre-existing payloads keep processing;
   `AGENT_ORACLE_ENABLED` and `TRELLIS_A2A_ENABLED` defaults stay
   pinned false.
8. **Default to zero paid work and zero external network in acceptance;**
   the pilot re-run, the proof run, the effective-context probe, and all
   authoring turns are owner-approved, per-run, and NOT acceptance. Paid
   runs respect the standing $5/run ceiling with a pre-flight estimate.
9. **Do not break existing consumers:** the `document` extraction
   prompt is byte-identical when `sourceKind` is absent (pinned); merge
   semantics keep commuting with the sweep; `TRELLIS_RESULT`/
   `TRELLIS_TELEMETRY` semantics are additive only; pre-Session-9 rlm
   payloads still process; the API, A2A, and SSE contracts are
   untouched; the Session 20 composed-prompt pin (`170e9f7e…67e9`) does
   not move this session.
10. **Respect the rlms prompt contract:** extend `RLM_SYSTEM_PROMPT`,
    never replace it; no literal curly braces in anything rlms formats;
    no rlms library modifications. (This session should not touch the
    RLM prompt at all.)
11. **Follow the T16 observability house style:** file paths, file
    content, diffs, digests, and prompts never become metric label
    values; new counters are bounded and label-light; entity names in
    log CONTENT follow the existing dropped-action precedent.
12. **Keep API and worker processes split;** project-scoped Compose
    commands; drills clean up token-scoped temp state only.
13. **Ship one feature branch and one PR to `master`,** plain
    engineering prose, no AI attribution or generated-by trailers.
    Regenerate this file in the same PR — and re-run the §0 step 5
    check before handing off.
14. **Code-mediated text is doctrine (permanent; survives every
    rewrite).** Any new or modified surface where the RLM touches text
    must follow `docs/architecture/CODE_MEDIATED_TEXT.md`: locations
    engine-computed, bytes moved by code, transient frames, hash-guarded
    writes — never model-estimated positions, never model-retyped
    existing bytes, never a persistent in-memory mirror of a store.
    Prompt text may reinforce the discipline but never substitutes for
    tooling shape.

## 8. Explicit exclusions

Do not include: the paid extraction pilot re-run (owner-gated; propose
with the estimate); any full-repository `--extract changed` run;
deleting, renaming, or retro-filtering EXISTING generic-hub entities
(creation-side prevention only — the pilot's residue was already
recovered through tombstoning); dropping test/fixture files from
INGESTION (they stay verified substrate; only extraction is excluded);
fuzzy or embedding-based stoplist matching (exact normalized names
only); an env-tunable stoplist or prompt (kernel constants); rewording
the `document` extraction prompt (byte-identical pin); `GraphSchema`
changes; extraction-merge or sweep-semantics changes; new queues, DDL,
or API surfaces; Python/RLM changes of any kind (the composed-prompt
pin must not move); the supervised Trellis-edits-Trellis proof run, the
effective-context probe, and module #1 v2 / module #2 (owner-gated
standing items); the frontend (deferred unscheduled); polars adoption
(measured unnecessary — pillar §7); `ASTRef`/`EVIDENCED_BY` migration
(gate closed at 286; the stoplist REMOVES a spurious path to that
trigger — do not treat pilot hubs as trigger evidence); T13 re-hashing;
rlms library modifications; weakening or toggling the Session 14
write-path enforcement, the Session 15/20 composition pins, the
Session 16 lineage byte-identity pins, the Session 17 promotion
refusals, the Session 18 registration gates, the Session 19
authoring-mode / anchor-gate / draft-scanner / template pins, or the
Session 20 textedit gating/containment/hash-guard pins.
