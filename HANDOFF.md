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

Your objective is **Session 21: the pillar's measurements — the
Frankenstein corpus, the effective-context probe, and module #1 v2**
(roadmap §4 row 1; owner directive July 9, 2026: the two formerly
owner-gated follow-ups of `docs/architecture/CODE_MEDIATED_TEXT.md`
§6.3/§6.4 are APPROVED, and the extraction prerequisites defer a third
time to row 2 — deferred, not dropped), per §3–§6 below. Code-mediated
("pandas") ingestion readiness was VERIFIED on July 9 (roadmap §5) —
re-verify cheaply, do not re-derive. Do not re-plan or re-implement
completed work. RLM expands exclusively to Recursive Language Model
(the MIT CSAIL formulation).

**CONTINUATION CHECKPOINT — July 10, 2026.** Session 21 is IN PROGRESS,
not complete. A first implementation turn produced the committed-corpus
candidate and the probe/gating code described in §2 and §6, but the owner
directed that post-change tests and live work continue in the next session
to preserve context. NO paid run, database ingest, promotion, module-v2
authoring, module replacement, registration, benchmark report, roadmap
strike-through, commit, push, or PR happened. Resume THIS objective; do not
advance to Session 22 and do not re-implement the completed implementation
slice. Acceptance remains the boundary for every status change.

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
   - **Extraction (Sessions 1/8 — the deferred row-2 prerequisites'
     site):**
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
     repo:ingest`, live drill `npm run test:repo-ingest`. The deferred
     row-2 extraction prerequisites live HERE and in
     `src/workers/extraction_worker.ts`.
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

**Active Session 21 continuation state (July 10, 2026):**

- Branch `agent/session-21-effective-context` is cleanly based on merged
  Session 20 commit `95ff8c7`; the work is UNCOMMITTED. `node_modules` was
  installed from the lockfile (`npm ci`: 315 packages, 0 vulnerabilities;
  local Node remains 20.19.2 while CI targets 22).
- The official Gutenberg #84 UTF-8 download used for the candidate was
  448,885 bytes, sha256
  `7810cd483cffcf2cc8a1d8f0d5807931e69d4f48cd14149b8c76f88af82fead3`.
  `trimGutenbergBoilerplate` documents the fail-closed transform:
  CRLF→LF, exactly one ordered start/end marker pair, boilerplate removal,
  boundary-blank trim, exactly one final LF. The resulting
  `data/frankenstein.txt` candidate is 421,536 bytes, 419,337 characters,
  LF-only/no BOM, sha256
  `bde72e6909fb0caebf375b81f7a63140d2b6ffab49a473c670a498dee96934a8`;
  `.gitattributes` pins it to LF across Windows/CI.
- New implementation: `src/benchmarks/effective_context/ground_truth.ts`
  and `.test.ts` (fixed six-question count/byte-exact-quote/localization
  set, deterministic truth/scoring, median and planning-spend helpers,
  corpus/trim pins); `src/benchmarks/effective_context/runner.ts` plus thin
  `scripts/exp_effective_context.ts` (exact-byte `.txt` parser,
  verified-ingest `none`, mismatched-prior-root refusal, real Python
  `get_ast_texts` samples, counterbalanced paired runs from a temp cwd with
  handles only, full-corpus read-set audit, zero-vector-search gate,
  bounded capture/timeout, no retries, telemetry/result validation,
  post-run spend accounting, mandatory paid artifact); and the build include.
- Prompt isolation: `CODE_MEDIATED_TEXT_RULE` is a named 252-byte block;
  default `SYSTEM_PROMPT` remains the recorded `170e9f7e…d1267e9` pin;
  `TRELLIS_EXP_OMIT_CMT=1` removes exactly that block, producing the recorded
  pre-Session-20 `abb945a6…f9b2` prompt. `buildAgentEnv` strips the flag AFTER
  MCP credential forwarding, so neither inherited state nor a credential
  variable named `TRELLIS_EXP_OMIT_CMT` can weaken a normal worker prompt.
- Static review defects already fixed before this checkpoint: prompt split
  initially inserted one extra newline; worker flag deletion initially
  preceded credential forwarding; the first ingest sketch could discard a
  real invalidation on a mismatched existing root; global pre-existing
  embeddings were confused with work performed by this ingest; protocol
  violations/dummy DB calls could score; zero-token telemetry could satisfy
  accounting; no-telemetry rows could disappear from correctness medians;
  relative Python paths broke under the temp cwd; and paid output could be
  lost without `--out`.
- Validation actually observed: BEFORE the new edits, `npm test` passed
  621/621 across 71 files, `npm run build` passed, and
  `docker compose config --quiet` passed (Docker config access warnings
  only). AFTER the edits, `python -m py_compile src/rlm/trellis_agent.py`
  and `python -m py_compile scripts/test_modules.py` passed, and
  `git diff --check` passed. A subsequent PR #56 offline failure exposed one
  incorrect hand-copied expectation: the byte-exact creature quote omitted
  the corpus newline after `It was`. The expectation was corrected (the
  extractor was already preserving source bytes), and
  `npm test -- src/benchmarks/effective_context/ground_truth.test.ts` passed
  9/9. All broader post-change testing remains deferred to the next session.
  `python scripts/check_python_runtime.py` emitted no
  output and timed out once at 120.4 seconds and again at 600.3 seconds; treat
  this as an unresolved runtime-check hang, not a pass and not a test failure.
- Still missing by design at this checkpoint: literal `.txt` parser root hash,
  exact block count, and ordered-block-hash digest pins in the offline test;
  every live zero-paid step; both approved paid runs; module #1 v2 artifacts;
  the report and doctrine/README updates; the full close-out matrix; final
  HANDOFF regeneration for Session 22; commit/push/PR. `gh auth status` also
  reported the OpenCnid token invalid, so refresh authentication before the
  final publish step (not before implementation/acceptance).

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
  `trellis_textedit.py` since Session 20 and, since the July 9
  readiness check, the `pandas` import (pillar-load-bearing; installed
  transitively via `unstructured`, so a broken environment must fail
  the check, not a paid run). The agent environment carries pandas
  2.2.3 / pyarrow 24.0.0 / polars 1.34.0 (measured; pillar §7).
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

**The pillar's measurements (`docs/architecture/CODE_MEDIATED_TEXT.md`
§6.3 + §6.4 — owner-APPROVED July 9, 2026; roadmap §4 row 1; the
extraction prerequisites defer to row 2).**

Three connected deliverables:

1. **The corpus.** Frankenstein (Project Gutenberg #84, the 1831 text,
   ~440 KB ≈ 110k tokens of prose) becomes verified Tier-1 substrate
   through the ordinary ingest path, zero-paid (extraction `none`, no
   embeddings). It is the measurement substrate: large enough that
   reading it through attention is expensive and error-prone, small
   enough to fit every bound. Readiness was VERIFIED on July 9 (roadmap
   §5 entry): pandas 2.2.3 / pyarrow 24.0.0 / polars 1.34.0 import in
   the agent Python; a lines-frame round-trips bytes exactly and
   answers substring queries by engine-computed index; the kernel
   prompt carries the §6.2 CODE-MEDIATED TEXT block; the ~440 KB corpus
   fits `INGEST_MAX_BODY_MB` (5 MB) and the 4 MiB workspace default;
   `get_ast_texts` reconstructs markdown block text (`_node_text`,
   pinned). `check_python_runtime.py` now pins the `pandas` import.
2. **The effective-context probe (§6.3, paid).** The pillar's payoff
   claim — effective context bounded by REPL memory, not the attention
   window — is doctrine without a number. Nothing yet measures
   discipline-on vs discipline-off on the SAME task set over the same
   corpus: correctness, bytes-through-attention, turn count, spend.
   This probe extends the paired-run series
   (`WORKSPACE_PROBE_REPORT.md`, `WORKSPACE_LINEAGE_PROBE_REPORT.md`).
3. **Module #1 v2 (§6.4, paid).** `modules/workspace-discipline` was
   authored BEFORE both grounded authoring and the pillar (it is the
   module whose paid turn observed provenance laundering live). Its
   addendum still carries the "when reconstructing stored text,
   preserve real newlines" line — a transcription *mitigation* for an
   operation the pillar now forbids outright (reconstruction through
   attention). v2 re-authors the module through the Session 19
   grounded-authoring mode with the pillar's normative text in its
   promoted corpus, retiring the mitigation language.

Every seam exists: the verified ingest path; the paired-run experiment
house style (`scripts/exp_citation_ab.ts` — arm loop, deterministic
ground truth, persisted-state measurement, spend accounting); the
opt-in instrumentation precedent (`TRELLIS_CITATION_*`: off by default,
byte-identical unset, pinned); the zero-LLM parking path (stub
`workspaceSnapshot`) for corpus assembly; `npm run promote`; and
`npm run modules:author` with `estimateAuthorSpend`/`--max-spend-usd`.

## 4. Required design

**(a) Frankenstein ingestion (zero-paid, first).** Fetch Gutenberg #84
plain-text UTF-8 (`https://www.gutenberg.org/cache/epub/84/pg84.txt`),
trim the Project Gutenberg boilerplate header/footer to the novel text
(public domain; keep the trim deterministic and documented), and commit
the result as `data/frankenstein.txt` — the committed-corpus precedent
(OOLONG datasets): the probe's ground truth must be computable from a
byte-stable file. Ingest through the verified path with doc key
`book:gutenberg-84:frankenstein` and extraction policy `none` (zero
paid work; the probe addresses blocks directly, never vector search).
Verify: the document version registered; the block count reported;
`get_ast_texts` returns real text for sampled blocks; re-running the
identical ingest is an auditable no-op.

**(b) The effective-context probe (§6.3).** New
`scripts/exp_effective_context.ts` in the `exp_citation_ab.ts` house
style:

- **Arms (paired, identical question set).** *Discipline-on*: today's
  default composed prompt (the §6.2 block — the pinned kernel).
  *Discipline-off*: the same run with exactly that block omitted and
  nothing else changed. Recommended mechanism: an opt-in experiment
  flag in the `TRELLIS_CITATION_*` mold — `TRELLIS_EXP_OMIT_CMT=1`
  read by `trellis_agent.py`; unset ⇒ the composed prompt is
  byte-identical (add the pin to an existing drill in the same commit);
  never set by any default, worker, or Compose configuration; supplied
  only by the experiment script's spawn env. (Alternative if the
  session prefers zero kernel surface: experiment-owned prompt
  composition spawning rlms directly — but the env-gated omission keeps
  every other pipeline byte identical, which is what a paired run
  wants. The composed-prompt sha256 pin does NOT move either way: it
  measures the default.)
- **Questions (kernel-fixed in the script, n≈6 per arm).**
  Deterministically verifiable against `data/frankenstein.txt`:
  exact-quote retrieval ("quote the sentence in which …"), occurrence
  counting ("how many times does the name 'Justine' appear" — counting
  is exactly what the discipline delegates to code and what the off arm
  must push through attention), and localization ("in which
  chapter/letter does …"). Ground truth is computed by the script from
  the committed file — never hand-typed.
- **Metrics per run (from `TRELLIS_TELEMETRY` + the runner):**
  correctness; input tokens (the bytes-through-attention proxy); output
  tokens; REPL iterations; `subcall_count`; database tool calls; spend.
  Report per-question rows plus arm medians.
- **Budget:** print a pre-flight estimate before any spawn (the
  `--max-spend-usd` precedent, default $5); the off arm dominates cost
  (it can pull the ~110k-token corpus through attention), so size n to
  hold the standing ≤$5/run cap. OOLONG-era prices: $2.5/M input,
  $10/M output.
- **Report:** `docs/benchmarks/EFFECTIVE_CONTEXT_PROBE_REPORT.md` in
  the workspace-probe house style (arms, environment, raw numbers,
  honest caveats — n is small and directional). Mark pillar §6.3
  MEASURED with the headline numbers, in the record itself.

**(c) Module #1 v2 (§6.4).**

- **Corpus:** the two existing promoted docs
  (`research:trellis/workspace-discipline/{contract,evidence}`) PLUS
  the pillar's normative sections (§0 and §2 at minimum) promoted as
  `research:trellis/workspace-discipline/code-mediated-text`. Assembly
  is zero-LLM: park the excerpt through the stub `workspaceSnapshot`
  path, then `npm run promote` (extraction `none`).
- **Author:** the driver NEVER edits an existing module (Session 19
  invariant — keep it), so author under a scratch name:
  `npm run modules:author -- --module-name workspace-discipline-v2
  --topic "<one bounded sentence: workspace discipline under
  code-mediated text>" --doc-key <the three keys> --confirm-paid`
  (drill the `--draft` replay path first). The anchor gate and the
  64-hex draft scanner apply unchanged.
- **Land (human):** review the assembled directory; replace the CONTENT
  of `modules/workspace-discipline/` — addendum text, manifest
  `version: 2`, `research.sourceNodeIds` = the driver-pinned set — and
  refresh `RESEARCH.md` while PRESERVING the v1 laundering-correction
  history (it is the record of the finding that produced grounded
  authoring; add the v2 section, do not erase v1's). Keep the module
  NAME and the addendum TITLE (`WORKSPACE DISCIPLINE PROTOCOL` —
  `test:modules` [5] pins both). Delete the scratch directory. CONFIRM
  the "reconstructing stored text" mitigation line is gone and no other
  line re-imports transcription language.
- **Re-register:** `npm run modules:register -- --module
  workspace-discipline` — the Session 18 ON MATCH transition refreshes
  the research hashes and `moduleVersion`; `npm run modules:verify`
  shows the refreshed basis uncontested. No new machinery.
- The composed-prompt pin does NOT move (module #1 is not in the
  default selection).

**(d) What does NOT change:** the Session 14 write path, the
promotion/registration gates, the authoring template/anchor-gate/
draft-scanner, the module loader, merge semantics, every bound, and
the Session 20 textedit surface. New code is one experiment script,
its ground-truth helpers, and (if chosen) the one env-gated prompt
omission with its byte-identity pin.

## 5. File-level starting points

Inspect before editing:

- `docs/architecture/CODE_MEDIATED_TEXT.md` — §0/§2 (the corpus text
  for v2), §6.3/§6.4 (the objectives), §7 (the measured structure
  tiers the probe should observe the model actually using).
- `scripts/exp_citation_ab.ts` — the paired-run experiment house style
  (arm loop, deterministic ground truth, persisted-state measurement,
  spend accounting, `--min-cite`-style knobs).
- `src/rlm/trellis_agent.py` — the `TRELLIS_CITATION_*` opt-in
  instrumentation pattern (where a `TRELLIS_EXP_OMIT_CMT` gate would
  live) and `TRELLIS_ADDENDUM_BASE` (the block the off arm omits).
- `scripts/test_modules.py` — the composed-prompt pin (must not move)
  and the module #1 section [5] (name/title pins the v2 swap must keep
  green).
- `modules/workspace-discipline/` — the v1 artifacts: the addendum
  carrying the mitigation line, `module.json`, `RESEARCH.md` (the
  laundering-correction history to preserve).
- `scripts/author_module.ts` + `src/core/authoring/*` —
  `estimateAuthorSpend`, `--max-spend-usd`, the `--draft` drill path,
  the assembly/pinning flow.
- `src/workers/rlm_job.ts` (`RlmStubSchema.workspaceSnapshot`) +
  `scripts/promote_segment.ts` — the zero-LLM park-then-promote path
  for corpus assembly.
- `docs/benchmarks/WORKSPACE_PROBE_REPORT.md` /
  `WORKSPACE_LINEAGE_PROBE_REPORT.md` — the paired-run report format
  this probe extends.
- `data/oolong_pairs_dataset.json` — the committed-corpus precedent
  for `data/frankenstein.txt`.

## 6. Test strategy and acceptance

The two paid runs are APPROVED (July 9, 2026) — each still prints a
pre-flight estimate first and respects the standing ≤$5/run cap, with
actuals reported after. Everything else stays zero-paid and local.

**Continuation order (owner-directed July 10; tests/live work deferred to
the next session):**

1. Re-read the active diff; do not reset it. Diagnose the silent
   `check_python_runtime.py` hang first (process/import isolation, bounded
   observation; never weaken or remove the pandas pin). Then run, in order:

   ```
   npm test -- src/benchmarks/effective_context/ground_truth.test.ts src/workers/rlm_job.test.ts
   npm run build
   npm run test:modules
   npm run python:check
   git diff --check
   ```

   The first focused run must yield the exact `.txt` AST root, exact ordered
   block count, and sha256 of the ordered block-hash list. Replace the current
   range-only block assertion with literal pins, then rerun the focused set
   and full `npm test`. The expected post-change counts are observations to
   record, never assumptions. The default composed-prompt hash MUST remain
   `170e9f7e…d1267e9`; the off-arm hash MUST be `abb945a6…f9b2`.
2. With `OPENAI_API_KEY` removed and ONLY PostgreSQL/Neo4j/Redis started,
   initialize schema and run:

   ```
   npx tsx scripts/exp_effective_context.ts --ingest-only
   npx tsx scripts/exp_effective_context.ts
   ```

   The first command must report the verified `book:` version, zero queued
   extraction, real Python `get_ast_texts` samples, and an identical no-op
   replay. The second is plan-only: six fixed questions × two arms, five
   iterations, planning estimate about $4 under the $5 ceiling, no spawn.
   Never use `POST /ingest` for the book: it hardcodes `changed` extraction.
3. Only after steps 1–2 pass, restore the approved API key and run the ONE
   approved probe invocation, persisting raw measurements:

   ```
   npx tsx scripts/exp_effective_context.ts --max-spend-usd 5 --out benchmark_logs/session21_effective_context.json --confirm-paid
   ```

   The runner has no retries and counterbalances order. Every scored row must
   audit-read every distinct corpus block, make zero vector searches, carry
   positive token/reported-cost accounting, and record correctness, input/
   output tokens, iterations, subcalls, database calls, time, cost source,
   and spend. A surprising result is the result. The estimate/after-each-run
   stop is not a provider-side hard dollar limit; report that caveat.
4. Assemble the pillar §0+§2 excerpt through a temporary, data-only
   `RlmStubSchema.workspaceSnapshot` job and the REAL park→list→promote path
   under `research:trellis/workspace-discipline/code-mediated-text` with
   extraction `none`. There is no generic parking CLI: use a temporary
   operator harness patterned on `test:agent-loop`; do not add an API or use
   the unsafe `/ingest` endpoint. Remove the token-scoped task key and goal
   byte counter after recording the promotion output.
5. Run the author plan, then a saved-envelope `--draft` replay into a separate
   temporary `--out-dir` (delete it before paid work), then the ONE approved
   `--confirm-paid --max-spend-usd 5` author turn under scratch name
   `workspace-discipline-v2`. Human-land content into the existing module as
   version 2, preserve all v1 laundering history in `RESEARCH.md`, remove the
   reconstruction/transcription mitigation, delete the scratch module, update
   the module-version drill pin, re-register, and verify uncontested state.
6. Produce the raw-number report and all documentation named below; run the
   entire standing close-out matrix including isolated Compose. Only then
   strike roadmap row 1, run §0 step 5, select Session 22 (unless a defect
   jumps the queue), regenerate this file fully, commit, authenticate GitHub,
   push, and open the draft PR.

Offline (joins `npm test`, baseline 621 across 71 files):

- The probe script's ground-truth helpers (occurrence counts, quote
  extraction, chapter localization over the committed file) are pure
  and unit-tested.
- If the `TRELLIS_EXP_OMIT_CMT` gate ships: unset ⇒ the composed prompt
  is byte-identical (pinned); set ⇒ exactly the §6.2 block is absent
  and nothing else changed; the flag is never forwarded by
  `buildAgentEnv` (experiment-script spawn env only — extend the
  payload/env hygiene pins).

Live zero-paid:

- Frankenstein ingest verification: version registered, blocks
  readable via `get_ast_texts`, identical re-ingest is a no-op.
- The v2 corpus promotion through the REAL path (park → list →
  promote → citable hashes echoed).
- `npm run modules:author ... --draft` replay assembles v2 from a saved
  envelope BEFORE any paid spawn (the drill path), anchor gate green.
- The standing close-out block below — `test:modules` MUST stay green
  across the v1→v2 content swap (name/title pinned; brace-free; LF).

Paid (approved; estimate first, actuals recorded):

- The probe: n≈6 questions × 2 arms (expect the off arm to dominate
  spend; abort past the cap).
- One grounded-authoring run for module #1 v2.

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

- `TRELLIS_ROADMAP.md`: full-dated §5 entry with exact commands,
  counts, token/spend actuals per paid run, and defects found; strike
  §4 row 1 only after acceptance.
- `docs/architecture/CODE_MEDIATED_TEXT.md`: §6.3 marked MEASURED with
  the headline numbers; §6.4 marked DONE (v2 landed, mitigation
  language retired).
- `docs/benchmarks/EFFECTIVE_CONTEXT_PROBE_REPORT.md`: the new report.
- README: point the benchmarks section at the new report.
- `HANDOFF.md`: regenerate per §0 — including the §0 step 5 re-check.

Remaining owner-gated items (do NOT run unprompted; propose each with a
cost estimate):

- **The supervised Trellis-edits-Trellis proof run** — operator sets
  `TRELLIS_EDIT_ROOT` at a branch checkout; the RLM performs one small
  real edit through the toolkit; it lands as an ordinary reviewed PR.
- **The module #2 turn** (topic owner-picked, prompt-movable,
  positive-control-testable; collaborator input bears on the choice).
- **The extraction pilot re-run** (waits on the row-2 prerequisites).

## 7. Guardrails

1. **Never mutate an AST.** The T13 hash preimage is pinned;
   `rederiveAstNodeId` stays authoritative; nothing positional is ever
   persisted as identity — probe ground truth is computed from the
   committed file, never stored as positions.
2. **Never merge, rename, or delete Entity nodes.** Equivalence stays
   an overlay belief; module entities are contested or retired, never
   deleted — v2 re-registration is the Session 18 ON MATCH refresh,
   never a delete/recreate.
3. **Preserve provenance on every semantic node and edge.**
   `write_derived_insight` keeps its Session 14 enforcement. The
   probe's runs write no insights as acceptance criteria; if a run
   caches facts, they carry real provenance like any run's.
4. **Paid work is exactly the two approved runs,** each behind a
   printed pre-flight estimate and the standing ≤$5/run cap, actuals
   recorded in the roadmap entry. Everything else — ingestion, corpus
   assembly, promotion, drills — is zero-paid. Never reward citation
   count anywhere (the measured laundering incentive).
5. **Gate machinery is kernel; operator control is absolute.** The
   probe's question set and ground-truth logic are kernel-fixed in the
   script — never env-tunable free text. The Session 20 textedit
   invariants and the Session 19 authoring gates are permanent. If the
   `TRELLIS_EXP_OMIT_CMT` flag ships it is experiment instrumentation
   in the `TRELLIS_CITATION_*` mold: off by default, byte-identical
   unset (pinned), never set by any default/worker/Compose config,
   never forwarded by `buildAgentEnv`.
6. **Every external interaction is bounded;** the corpus is committed
   and byte-stable; over-budget operations raise with usage — never
   silent truncation.
7. **Validate at every boundary:** every worker-consumed completion
   crosses `parseLlmResponse`; the draft scanner and anchor gate apply
   to the v2 draft unchanged; `AGENT_ORACLE_ENABLED` and
   `TRELLIS_A2A_ENABLED` defaults stay pinned false.
8. **Report probes honestly:** n is small — publish raw numbers,
   medians, and the directional caveat, exactly like the workspace
   probe reports; a surprising result is a finding, not a reason to
   re-run until it flatters the pillar.
9. **Do not break existing consumers:** the composed-prompt sha256 pin
   (`170e9f7e…67e9`) does NOT move this session; `test:modules` [5]
   pins module #1's name and addendum title across the v2 swap;
   `TRELLIS_RESULT`/`TRELLIS_TELEMETRY` semantics are additive only;
   the API, A2A, and SSE contracts are untouched.
10. **Respect the rlms prompt contract:** extend `RLM_SYSTEM_PROMPT`,
    never replace it; no literal curly braces in anything rlms formats
    (v2's addendum included); no rlms library modifications.
11. **Follow the T16 observability house style:** corpus text, quotes,
    prompts, and file paths never become metric label values; probe
    artifacts live in the report, not in logs.
12. **Keep API and worker processes split;** project-scoped Compose
    commands; drills clean up token-scoped temp state only —
    `book:gutenberg-84:frankenstein` is deliberately durable (it is
    the corpus, not drill residue).
13. **Ship one feature branch and one PR to `master`,** plain
    engineering prose, no AI attribution or generated-by trailers.
    Regenerate this file in the same PR — and re-run the §0 step 5
    check before handing off.
14. **Code-mediated text is doctrine (permanent; survives every
    rewrite).** Any new or modified surface where the RLM touches text
    must follow `docs/architecture/CODE_MEDIATED_TEXT.md`: locations
    engine-computed, bytes moved by code, transient frames,
    hash-guarded writes — never model-estimated positions, never
    model-retyped existing bytes, never a persistent in-memory mirror
    of a store. Prompt text may reinforce the discipline but never
    substitutes for tooling shape. (This session MEASURES the doctrine;
    the discipline-off arm exists only inside the experiment.)

## 8. Explicit exclusions

Do not include: the repository-scale extraction prerequisites (roadmap
row 2 — deferred a third time by the July 9 owner directive; do not
partially implement); the extraction pilot re-run; the supervised
Trellis-edits-Trellis proof run and the module #2 turn (still
owner-gated — propose with estimates only); embedding or extracting
Frankenstein (`--extract none`; the probe needs neither); weakening or
toggling the §6.2 kernel block outside the experiment's opt-in flag;
moving the composed-prompt sha256 pin; editing module #1 through the
authoring driver (author under a scratch name; landing is the human
swap); erasing module #1's v1 laundering-correction history from
`RESEARCH.md`; new MCP servers or transports; A2A changes; frontend
work (deferred unscheduled); polars adoption (measured unnecessary —
pillar §7); `ASTRef`/`EVIDENCED_BY` migration (gate closed at 286);
T13 re-hashing; rlms library modifications; weakening the Session 14
write-path enforcement, the Session 15/20 composition pins, the
Session 16 lineage pins, the Session 17 promotion refusals, the
Session 18 registration gates, the Session 19 authoring-mode /
anchor-gate / draft-scanner / template pins, or the Session 20
textedit gating/containment/hash-guard pins.
