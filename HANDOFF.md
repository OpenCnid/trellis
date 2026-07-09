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
  L1/L2 forbidden and L3 as the capability flywheel's mechanism (the
  ladder's L1/L2 prohibition was WITHDRAWN by owner directive on
  July 9, 2026 — see the revised design record §7: content pool +
  standard editing permissions), the kernel/userspace boundary, the
  module manifest/registry/gates design with module #0, and a six-step
  implementation sequence),
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
idempotency (offline 568/63).

**The module #1 paid authoring turn RAN on July 9, 2026**
(owner-approved; PR #45, branch `d/module-1-workspace-discipline`,
stacked on #44): `modules/workspace-discipline/` — corpus assembled
from the design record §4 and the two measured probe reports, promoted
as `research:trellis/workspace-discipline/{contract,evidence}` (24
citable block hashes); one paid run (`gpt-5.4-2026-03-05`, 160,270
input / 7,827 output tokens, `status: ok`, zero protocol violations)
drafted the brace-free `WORKSPACE DISCIPLINE PROTOCOL` addendum;
landed with `test:modules` extended 27 → 33 (the composed-prompt
sha256 pin UNMOVED; the module is NOT in the default selection) and
registered live as `module:workspace-discipline` (24 uncontested
research hashes). **The turn also observed the §10 provenance-laundering
residual live:** the run's self-reported `research.sourceNodeIds` were
real-but-unrelated hashes surfaced by 21 whole-database `vector_search`
calls, not the promoted corpus — the existence gate cannot catch that
(the hashes exist); the operator caught and corrected it before landing
(`modules/workspace-discipline/RESEARCH.md`). The remediation was
designed the same day (PR #46, branch `d/grounded-authoring-design`,
stacked on #45): `docs/architecture/GROUNDED_AUTHORING.md` — the
NORMATIVE child design record that Session 19 implemented.

Session 19 (July 9, 2026, branch `d/session-19-grounded-authoring`) is
also complete: **grounded authoring** (`GROUNDED_AUTHORING.md` Phases
1–2). The kernel authoring mode and its gates now make the flywheel's
authoring PATHWAY unable to launder provenance the way module #1 did.
**(1) The mode** — `src/rlm/trellis_agent.py --mode author` (argparse
default `research`, byte-identical): a DB-free branch whose
`custom_tools` is exactly `{trellis_workspace}` (no
`TrellisPostgres`/`TrellisNeo4j`/MCP constructed — the process opens no
DB connection), which seeds the promoted corpus, composes an
author-specific system prompt (rlms base + a brace-free author addendum
+ the workspace surface + the driver's template), and emits a
`TRELLIS_DRAFT:` envelope (`purpose`/`addendum`/`gapNotes`, no hashes) —
never `TRELLIS_RESULT`/`TRELLIS_PROTOCOL_VIOLATION`. Author setup is
factored into `build_author_tools`/`build_author_system_prompt`/
`extract_draft_envelope` (testable without a completion or a DB).
**(2) Pinned attribution** — `src/core/authoring/corpus.ts` reads a
promoted doc's current-version extraction blocks (hash + text) from
`ast_nodes`; `src/core/authoring/seed.ts` maps them block-aligned into a
`WorkspaceSnapshot` (one segment per block, content verbatim,
`origin.argsHash` = the block hash's first 16 hex — deterministic,
auditable, never a 64-hex token); the driver pins
`research.sourceNodeIds` = the corpus block set, sorted+deduped (D3 flat
v1); the model contributes only prose. **(3) The template** —
`src/core/authoring/template.ts`, a byte-pinned kernel constant composed
from exactly the bounded topic and the doc keys (sources in, protocol
out; declare gaps, never invent), brace-free for rlms `.format()`.
**(4) The anchor gate** — `src/core/authoring/anchors.ts` extracts
corpus-specific anchors (numeric comparisons, hyphenated mechanics,
distinctive vocabulary; stopwords filtered) and scores draft coverage;
`ANCHOR_COVERAGE_THRESHOLD = 0.3` (kernel constant, unit-pinned), fails
closed on an unanchorable corpus. **(5) The draft scanner** —
`src/core/observability/rlm_draft.ts`, sibling of `RlmResultScanner`:
pure, bounded, Zod-validated `{purpose, addendum, gapNotes}`; a draft
carrying ANY 64-hex token is REFUSED (the pen stays with the harness).
**(6) The driver** — `scripts/author_module.ts` (`npm run
modules:author`, in the `promote`/`register` house style): default
echoes the plan and refuses to spawn without `--confirm-paid`; `--draft
<file>` assembles from a saved envelope (the zero-paid drill path);
`--confirm-paid` spawns the paid run and collects the draft. Assembly
pins the manifest, writes `addendum.txt` + a harness-generated
`RESEARCH.md`, validates via `readModuleManifest`/`loadModule`, and
NEVER registers, lands, or edits an existing module. Refinement (design
record §12.1): the seed budget is enforced in the driver
(`assertSeedWithinBudget`) as well as the Python seed, so `--draft` is
gated identically to the paid path. Acceptance: `test:module-lifecycle`
35 → 60 (authoring end-to-end §10–§11), `test:modules` 33 → 43 (the
composed-prompt sha256 pin UNMOVED), offline 568 → 608. **No module #2
paid run happened — it is owner-gated and separate.**

OpenCnid selected the MIT License on July 6, 2026.

Your objective is **Session 20: the code-mediated-text follow-ups —
the editing toolkit and the kernel prompt revision** (roadmap §4 row 1;
owner directive, July 9, 2026: this takes precedence, and the
repository-scale extraction prerequisites DEFER behind it to row 2 —
deferred, not dropped). The normative spec is the core pillar record
`docs/architecture/CODE_MEDIATED_TEXT.md` (§2 discipline, §6.1/§6.2
follow-ups, §7 measured structure selection and bounds), per §3–§6
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
     guards); prompts reinforce only. Follow-ups the record drives
     (§6, all owner-scheduled): the editing toolkit, a kernel prompt
     revision (a deliberate sha256-pin move), the effective-context
     probe, module #1 v2.
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
   - **Grounded authoring (Session 19; `src/core/authoring/*` +
     `src/core/observability/rlm_draft.ts` + `scripts/author_module.ts`
     + `trellis_agent.py --mode author`):** the kernel mode that drafts
     a protocol module addendum from a FIXED promoted corpus and nothing
     else. Author runs see only `trellis_workspace` (no DB/search/write
     — no DB connection opens), work from a block-aligned seeded corpus,
     and emit a hashes-free `TRELLIS_DRAFT` envelope. The harness holds
     the pen: `research.sourceNodeIds` is pinned from the corpus block
     set (`corpus.ts`/`seed.ts`), the authoring template is a byte-pinned
     kernel constant composed from (topic, doc keys), the deterministic
     anchor gate (`anchors.ts`, `ANCHOR_COVERAGE_THRESHOLD = 0.3`)
     refuses a corpus-blind draft, and the draft scanner refuses any
     64-hex token. `npm run modules:author` assembles a directory for
     human review only — it never registers, lands, or edits an existing
     module; registration stays the separate Session 18 CLI. This is the
     §10-laundering remediation from GROUNDED_AUTHORING.md — it removes
     the affordance (access) and moves the pen (attribution); derivation
     is measured (anchors), never proven. The paid authoring run is
     owner-gated per run; acceptance is `--draft` replay + plan-echo
     only (`test:module-lifecycle` §10–§11).
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

- `master`: the head after the July 9, 2026 sequence — Session 19
  (grounded authoring, PR #50) → the eval lessons (#51) → the
  collaborator briefing (#52) → the self-editing-ladder pruning (#53) →
  the code-mediated-text core pillar + this re-pointed handoff (#54).
  Use `git log -- HANDOFF.md` to confirm the pillar PR landed. If #54 is
  still unmerged when this session starts, STOP and merge it first.
- `modules/workspace-discipline/` exists (module #1); the dev graph
  carries its registered entity `module:workspace-discipline` (24 live
  research hashes) and the promoted corpus documents
  `research:trellis/workspace-discipline/{contract,evidence}` (50 AST
  nodes, none embedded — promotion policy `none` writes no embeddings).
  Session 19 added NO committed module (the module #2 paid run is
  owner-gated and did not run); it added `src/core/authoring/*`,
  `src/core/observability/rlm_draft.ts`, `scripts/author_module.ts`
  (`npm run modules:author`), and the `--mode author` branch of
  `src/rlm/trellis_agent.py`. A follow-up provenance-citation A/B eval
  (owner-approved paid, `docs/benchmarks/PROVENANCE_CITATION_AB_REPORT.md`)
  added opt-in, off-by-default, byte-identical citation instrumentation to
  `trellis_tools.py`/`trellis_agent.py` (`TRELLIS_CITATION_AUDIT`/`_HINT`/
  `_ENTAIL`) and the experiments `scripts/exp_citation_ab.ts` /
  `exp_citation_metadata.ts`, and FIXED a real bug: `get_ast_texts` /
  `vector_search` returned NULL for markdown/container block text (fixed via
  `_node_text` reconstruction; the RLM could not read markdown or promoted
  research). Finding: citation laundering is incentive-driven and only the
  semantic entailment check (§7 v3) catches/prevents it — never reward
  citation count. No module #2 authored (the candidate was measured
  unreliable).
- Offline baseline: `npm test` = 612 passing across 70 files (Session 19
  added `src/core/authoring/{template,corpus,seed,anchors,assemble,
  estimate}.test.ts` and `src/core/observability/rlm_draft.test.ts`).
- `npm run build` and `npm run python:check` pass.
- `npm run drill:scale`: gate CLOSED at max provenance 286 (run-to-run
  sweep-growth band ~1.63x–2.26x across Sessions 12–19; Session 19
  observed 2.05x, far under the superlinear trigger).
- Live zero-LLM checks (Session 19 observed counts):
  `test:module-lifecycle` (60 — Session 19 added the authoring
  end-to-end §10–§11; was 35), `test:modules` (43 — Session 19 added
  the author-mode section [6]; was 33; carries the byte-identical
  composed-prompt sha256 pin `abb945a6…f9b2`, which the author-mode
  addition did NOT move — recompute it in the same commit only if the
  kernel research prompt or rubric legitimately changes),
  `test:promotion` (41), `test:rlm-workspace` (86 — the follow-up added
  four `_node_text` markdown-reconstruction checks; was 82), `test:rlm-mcp` (86),
  `test:rlm-sandbox` (21), `test:agent-loop` (35 / ALL CHECKS PASSED),
  `test:a2a` (46), `test:repo-ingest` (45),
  `test:benchmark-hardening` (24), `test:entity-resolution` (34),
  `test:api-hardening` (18), `test:belief-recovery` (30),
  `test:invalidation-sweep` (17).
- Isolated Compose integration: 10 assertions (`--profile test`, unique
  project name, host ports 0 via `TRELLIS_*_HOST_PORT=0`; includes the
  containerized credentialed MCP fixture probe). Session 19 ran it as
  project `trellis_s19_ci` (all 10 PASS) and tore it down with
  `--volumes`. NOTE: the machine's C: drive runs close to full and an
  image rebuild needs several GB of headroom (a Session 17 build filled
  the disk mid-build; Session 19 had ~33 GB free on C: and the
  incremental rebuild fit). Changing `package.json` invalidates the
  Docker `npm ci` layer, forcing that rebuild.
- CI target is Node 22. Session 19's local environment was Node 20.19.2,
  Python 3.13.1, Docker Compose v2, PostgreSQL 16.x, Neo4j 5.11.
- Python runtime deps are pinned in `requirements.txt` (`rlms==0.1.3`,
  `openai`, `neo4j`, `psycopg2-binary`, `unstructured`, `mcp==1.12.4`);
  `npm run python:check` verifies syntax/imports/assets. Session 19
  shipped NO new Python file (the author-mode functions were added to
  the already-shipped `trellis_agent.py`), so the Dockerfile `COPY` and
  `check_python_runtime.py` were untouched.
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

## 3. Session 20 problem statement

**The code-mediated-text follow-ups (core pillar record
`docs/architecture/CODE_MEDIATED_TEXT.md` §6.1 + §6.2 — NORMATIVE for this
session; owner directive, July 9, 2026: takes precedence over extraction,
which defers to roadmap §4 row 2).**

The pillar is ratified doctrine: *the model never counts, and the model
never copies* — locations engine-computed and returned by query, existing
bytes moved by code at computed addresses, transient frames, hash-guarded
writes. The July 9 alignment sweep made it documentation-complete. Two
gaps keep it aspiration rather than machinery:

1. **There is no editing toolkit.** The RLM has no file surface at all —
   which is the correct DEFAULT (the environment sits outside the REPL;
   design record §7), but the revised self-editing doctrine requires that
   the operator MUST be able to bring a checkout into the content pool and
   drive edits through Trellis. Today that would mean raw `open()`/`write()`
   in the REPL with none of the pillar's guards: no digest check, no
   engine-computed addresses, no bounds, no telemetry. The pillar's §2
   discipline needs tooling shape, not good intentions (eval lesson 7).
2. **The kernel prompt does not teach the discipline.** Research runs
   still handle retrieved text by attention habit; nothing in
   `TRELLIS_ADDENDUM_BASE` says "load text into structures, locate by
   query, splice — never retype." The workspace addendum teaches segment
   pulls, which is the pillar's read half; the operate-by-code half is
   untaught.

Everything needed has a seam: the holder-injection pattern
(`trellis_workspace.py` via rlms `custom_tools`), operator-owned gating
env with byte-identical-when-unset pins (`TRELLIS_MCP_SERVERS`
precedent), Zod/Python twin bounds (`TRELLIS_WORKSPACE_*` precedent), the
composed-prompt sha256 pin-move protocol (`test:modules`), the env
forwarding + payload-hygiene seam (`buildAgentEnv`/`parseRlmJobData`),
and the component-drill pattern (`test_rlm_workspace.py`). Structure
selection and scale bounds are already MEASURED (pillar §7): list-of-lines
for single-file frames, pandas for relational queries, byte caps aligned
with the workspace bounds — pandas has no line-count limit relevant to
Trellis (discomfort begins ~10M rows; the whole repo is 74k lines / a
13 MB frame / 16 ms queries).

## 4. Required design

Pillar §2 (discipline) and §7 (structure selection, bounds) are normative;
refine only where the code forces a change and record any refinement in
the pillar record itself.

- **The editing toolkit — `src/rlm/trellis_textedit.py`.** A
  `TrellisTextEdit` holder injected via rlms `custom_tools` as
  `trellis_textedit` ONLY when the operator sets `TRELLIS_EDIT_ROOT` (a
  directory; every path strictly resolves inside it — reject `..`,
  absolute paths, and symlink escapes via resolve-then-commonpath). Unset
  ⇒ nothing injected, prompt and behavior byte-identical (pinned by
  test). House wrapper discipline: every model-visible method returns a
  JSON STRING; real exceptions with readable messages.
  - `load(relpath)` — reads the file, holds `{lines, sha256(bytes),
    mtime}` internally; returns `{path, lineCount, bytes, digest}`.
    Re-loading refreshes the frame and digest.
  - `lines(relpath, start, end)` — a BOUNDED slice `[ [i, text], … ]`
    (kernel-constant cap per call; over-cap raises with the bound).
  - `locate(relpath, pattern, regex=False)` — engine-computed addresses:
    bounded listing of `{line, preview}` hits plus a total count. The
    model never counts lines; it queries.
  - `splice(relpath, start, end, new_lines)` — replaces `lines[start:end]`
    in the HELD frame (staged, not written); returns the edited range and
    pending-edit count. Multiple splices compose; handles are transient —
    re-locate after each splice (document in the addendum).
  - `diff(relpath)` — bounded unified diff of the held frame vs the
    loaded snapshot (the in-REPL review affordance).
  - `write_back(relpath)` — THE hash guard: re-hash the CURRENT disk
    bytes; if they differ from the load-time digest, RAISE (the file
    moved — reload and re-derive); else write atomically (temp + rename)
    and return `{path, bytesWritten, newDigest}`. Never auto-reload.
  - `revert(relpath)` — discard staged edits.
  - Bounds (Zod + Python twins, workspace style):
    `TRELLIS_TEXTEDIT_MAX_FILE_BYTES` (default 4 MiB, cap 32 MiB),
    `TRELLIS_TEXTEDIT_MAX_FILES` (default 16, cap 64) — over-budget
    RAISES with usage; slice/hit caps are kernel constants, not env.
  - Telemetry counts only (`textedit_ops`/`textedit_files`/
    `textedit_writes` on `TRELLIS_TELEMETRY`); paths and content never in
    logs or labels (T16). Toolkit ops are NOT database tool calls — a
    separate counter in the `mcp_calls` mold; they never satisfy the
    provenance protocol.
  - `buildAgentEnv` forwards `TRELLIS_EDIT_ROOT` + bounds exactly when
    the operator set them; a queue payload can never supply them
    (unit-pinned, the payload-hygiene precedent). Git operations are OUT
    of this slice: the toolkit edits files; landing stays human.
  - A brace-free `TEXTEDIT` addendum injected only when configured
    (byte-identical otherwise, pinned): teaches locate → splice → diff →
    write_back; build new content, then splice — never retype existing
    lines; re-locate after mutations; digest-mismatch means reload.
- **The kernel prompt revision (pillar §6.2) — its own commit.** Add the
  brace-free CODE-MEDIATED TEXT hard-rule block (candidate wording in the
  pillar record §6.2) to `TRELLIS_ADDENDUM_BASE`, recompute the
  `test:modules` composed-prompt sha256 pin IN THE SAME COMMIT (the
  recorded pin-move protocol: the pin moves only with a witting kernel
  change), and verify the structural prompt pins in `test:rlm-workspace`
  still hold (they are relative, not absolute).
- **Runtime registration:** the new `src/rlm/trellis_textedit.py` joins
  the Dockerfile `COPY` line and `check_python_runtime.py` (the
  Session 12 defect class). `.env.example` documents `TRELLIS_EDIT_ROOT`
  and the two bounds. No new HTTP/A2A surface, no new queue, no DDL, no
  manifest schema change (`kernelCompat` stays 1).

## 5. File-level starting points

Inspect before editing:

- `docs/architecture/CODE_MEDIATED_TEXT.md` — §2 (the discipline the
  toolkit embodies), §6.1/§6.2 (this session's scope), §7 (measured
  structure selection and the bounds to enforce).
- `src/rlm/trellis_workspace.py` — the holder pattern to mirror: bounds
  validation with hard caps, JSON-string returns, budget raises with
  usage, `stats()` counts-only telemetry, the brace-free addendum and its
  byte-identical gating.
- `src/rlm/trellis_agent.py` — `main()` tool assembly and addendum
  composition (where `trellis_textedit` injects, gated on
  `TRELLIS_EDIT_ROOT`), and `TRELLIS_ADDENDUM_BASE` (the §6.2 edit site).
- `src/config/mcp_servers.ts` + `src/config/index.ts` — operator-owned
  config validation, fail-fast at startup, the bounds Zod shapes.
- `src/workers/rlm_job.ts` (`buildAgentEnv`) + `rlm_job.test.ts` — env
  forwarding and the payload-hygiene unit pins to extend.
- `scripts/test_rlm_workspace.py` / `scripts/test_rlm_workspace.ts` —
  the component-drill pattern (tsx wrapper spawning the pinned
  interpreter) for the new `test:textedit` drill.
- `scripts/test_modules.py` — the sha256 pin and its recompute protocol
  (comment at the pin explains the rule).
- `Dockerfile`, `scripts/check_python_runtime.py`, `.env.example` — the
  runtime-registration trio.

## 6. Test strategy and acceptance

Test first. No paid LLM calls and no external network in acceptance.
Acceptance edits operate on token-scoped temp directories only — the
live "Trellis edits Trellis's own checkout" exercise is the owner-gated
supervised proof run, NOT acceptance.

Offline (joins `npm test`, baseline 612 across 70 files):

- Bounds Zod tests (defaults, caps, rejects) mirroring the workspace
  bounds suite.
- `buildAgentEnv`: forwards `TRELLIS_EDIT_ROOT`/bounds when set; strips
  when unset; a job payload carrying any textedit-shaped key is ignored
  (extend the payload-hygiene pins).

Live zero-paid (new `npm run test:textedit`, the component-drill house
style; joins the close-out block):

- load/lines/locate: bounded slices and listings; over-cap raises; hit
  counts correct against a fixture file.
- splice/diff/revert: staged edits compose; diff is bounded and correct;
  revert restores the loaded frame.
- write_back happy path: atomic write, new digest returned, file content
  exactly the spliced frame (byte-compare).
- THE GUARD: mutate the file on disk after `load`; `write_back` RAISES
  and writes nothing (byte-compare proves the disk file untouched);
  re-`load` then succeeds.
- Containment: `..`, absolute paths, and a symlink pointing outside the
  root are refused before any I/O.
- Budgets: file over `TRELLIS_TEXTEDIT_MAX_FILE_BYTES` refuses at load;
  frame count over `TRELLIS_TEXTEDIT_MAX_FILES` refuses with usage.
- Gating byte-identity: with `TRELLIS_EDIT_ROOT` unset, the composed
  prompt is byte-identical to today's and no `trellis_textedit` name
  exists in the REPL namespace (extend the LocalREPL section).
- Persistence: the holder survives REPL turns and scaffold restore (the
  workspace LocalREPL precedent, re-pinned for this holder).
- Python-side telemetry: counts only; a run with the toolkit configured
  emits the new counters and never a path or content.

The kernel prompt commit: `test:modules` pin recomputed in the same
commit; the full suite re-run after (the composed prompt changes for
every run — this is the one deliberate global change; everything else
this session is byte-identical when unconfigured).

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
  and defects found; strike §4 row 1 only after acceptance.
- `docs/architecture/CODE_MEDIATED_TEXT.md`: §6.1/§6.2 marked
  IMPLEMENTED (date); record any refinement forced by the code in the
  record itself.
- README: the operator editing workflow (`TRELLIS_EDIT_ROOT`, the
  toolkit surface) beside the promotion/registration/authoring sections.
- `.env.example`, Dockerfile, `check_python_runtime.py` as §4 requires.
- `HANDOFF.md`: regenerate per §0 — including the §0 step 5 re-check.

Standing owner-gated items (do NOT run unprompted; propose each with a
cost estimate):

- **The supervised Trellis-edits-Trellis proof run** — operator sets
  `TRELLIS_EDIT_ROOT` at a branch checkout; the RLM performs one small
  real edit through the toolkit; it lands as an ordinary reviewed PR.
- **The effective-context probe** (pillar §6.3; paid, extends the
  workspace-probe series) — discipline-on vs discipline-off on a corpus
  several times the attention window; spend cap $5/run per the standing
  policy.
- **Module #1 v2** through grounded authoring (pillar §6.4) and the
  **module #2 turn** (topic owner-picked, prompt-movable,
  positive-control-testable).
- The extraction prerequisites are roadmap row 2 — next in queue after
  this session; the extraction pilot re-run stays owner-gated.

## 7. Guardrails

1. **Never mutate an AST.** The T13 hash preimage is pinned;
   `rederiveAstNodeId` stays authoritative; nothing positional is ever
   persisted as identity — including toolkit frame indices, which are
   transient by doctrine.
2. **Never merge, rename, or delete Entity nodes.** Equivalence stays an
   overlay belief; module entities are contested or retired, never
   deleted.
3. **Preserve provenance on every semantic node and edge.**
   `write_derived_insight` remains the single AGENT write path with its
   Session 14 enforcement intact. Toolkit operations NEVER satisfy the
   provenance protocol (separate counter, the `mcp_calls` precedent);
   file content earns citability only through verified ingest/promotion.
4. **The edit root is operator-owned, absolutely.** `TRELLIS_EDIT_ROOT`
   and the textedit bounds come only from operator env — never from a
   queue payload, an inbound request, or a model completion (unit-pinned).
   Unset means byte-identical prompt and namespace (pinned). All paths
   resolve strictly inside the root. The toolkit never touches git;
   landing stays a human PR under standard permissions (design record §7).
5. **Gate machinery is kernel; operator control is absolute.** Slice/hit
   caps and the addendum text are kernel constants — never env-tunable
   free text, never payload- or completion-selectable. Self-editing
   doctrine (revised July 9, 2026, design record §7): content pool +
   standard permissions; edits land between runs through source control.
6. **Every external interaction is bounded;** frames, slices, listings,
   and diffs cross validated bounds; over-budget raises with usage —
   never silent truncation. Display truncation is not data truncation.
7. **Validate at every boundary:** bounds cross Zod and the Python twin;
   `write_back` re-hashes before writing (mismatch raises, never
   auto-reloads); `AGENT_ORACLE_ENABLED` and `TRELLIS_A2A_ENABLED`
   defaults stay pinned false.
8. **Default to zero paid work and zero external network in acceptance;**
   the proof run, the effective-context probe, and all authoring turns
   are owner-approved, per-run, and NOT acceptance. Paid runs respect the
   standing $5/run ceiling with a pre-flight estimate.
9. **Do not break existing consumers:** with `TRELLIS_EDIT_ROOT` unset,
   prompt, namespace, envelopes, and behavior are byte-identical
   (pinned); the ONE deliberate global change is the §6.2 kernel prompt
   block, shipped in its own commit with the `test:modules` sha256 pin
   recomputed in that commit; `TRELLIS_RESULT`/`TRELLIS_TELEMETRY`
   semantics are additive only; pre-Session-9 payloads still process;
   the API, A2A, and SSE contracts are untouched.
10. **Respect the rlms prompt contract:** extend `RLM_SYSTEM_PROMPT`,
    never replace it; no literal curly braces in anything rlms formats
    (the new addendum and prompt block included); no rlms library
    modifications.
11. **Follow the T16 observability house style:** file paths, file
    content, diffs, patterns, and digests never become metric label
    values or log content; telemetry carries counts only.
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

Do not include: git tooling of any kind (status/commit/push/branch — the
toolkit edits files; landing is human this slice); MCP git or filesystem
servers as the edit path (the native guarded toolkit is the pillar's
tooling shape; MCP tool-servers can join a later slice); autonomous PR
creation or commits; enabling `TRELLIS_EDIT_ROOT` in any default,
worker, or Compose configuration; running the Trellis-edits-Trellis
proof run as acceptance (owner-gated, separate); the effective-context
probe and module #1 v2 (owner-gated, pillar §6.3/§6.4); the
repository-scale extraction prerequisites (roadmap row 2 — deferred by
the July 9 owner directive; do not partially implement); polars adoption
(measured unnecessary at Trellis scales — pillar §7; documented so it is
not re-litigated); persistent corpus mirrors or any long-lived frame
store (transient frames are doctrine); a promote-from-frame path
(promotion stays the Session 17 CLI over parked workspace snapshots);
editing module #1's committed artifacts; autonomous nomination,
registration, landing, or manifest editing; a module/authoring/editing
HTTP or A2A surface; tool-bearing modules; orchestrator tools; rlms
`compaction` enablement; new MCP servers or transports; A2A changes;
`ASTRef`/`EVIDENCED_BY` migration (gate closed at 286); T13 re-hashing;
rlms library modifications; weakening or toggling the Session 14
write-path enforcement, the Session 15 composition pins (beyond the one
witting §6.2 pin move), the Session 16 lineage byte-identity pins, the
Session 17 promotion refusals, the Session 18 registration gates, or the
Session 19 authoring-mode / anchor-gate / draft-scanner / template pins.
