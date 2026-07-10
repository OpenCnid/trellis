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
- PR #29 — semantic-provenance scale evidence (Session 7): the migration gate
  closed at 286 maximum sources; no `ASTRef` migration shipped.
- PRs #30/#31 — whole-codebase ingestion (Session 8): verified ingest service,
  code-aware TS/JS/Python ASTs, durable snapshots with tombstone deletion,
  `repo:ingest` CLI with a zero-paid-work default, the measured `Entity.name`
  merge index, and the recorded extraction-pilot findings.
- PR #33 — the agentic orchestration loop (Session 9): `GET /api/agent-stream`
  + `agent_queue`/`agent_worker.ts` run an orchestrator (same LLM, planner
  system prompt, Zod-validated decisions through the T8 boundary — never an
  rlms REPL) that dispatches the RLM as a reusable single-task sub-agent over
  ordinary `rlm_queue` jobs under hard per-goal bounds. Zero-LLM acceptance:
  `npm run test:agent-loop`.
- PR #34 — the MCP tool surface (Session 10): operator-configured stdio MCP
  client (`TRELLIS_MCP_SERVERS` → `src/config/mcp_servers.ts` →
  `src/rlm/trellis_mcp.py`, injected as `trellis_mcp`), allowlist-before-I/O,
  per-call timeouts, size caps, the separate `mcp_calls` counter that never
  satisfies database provenance; zero-paid acceptance `npm run test:rlm-mcp`.
- PR #35 — the A2A server surface (Session 11): Agent2Agent v1.0.0 (JSON-RPC,
  hand-rolled with Zod) over the existing goal loop, `TRELLIS_A2A_ENABLED`
  default false (unset ⇒ byte-identical API, drill-pinned), same gates and
  bounds as `/api/agent-stream`, TTL-bounded Redis task records. Acceptance
  `npm run test:a2a` (46 checks).
- PR #36 — remote MCP transports (Session 12): the registry became a Zod union
  on `transport` (`stdio` | Streamable HTTP with env-referenced credentials
  resolved fail-fast; scrubbed errors); one transport seam (`_dial`); pinned
  `mcp==1.12.4`. The recorded 3.3 #8 scope is exhausted.
- PRs #37/#38 — Session 13: documentation and consolidation. The design record
  `docs/architecture/WORKSPACE_AND_MODULES.md` (three-tier trust model, Tier-3
  workspace contract, lineage, promotion, the self-editing doctrine — revised
  July 9, 2026: content pool + standard editing permissions, §7 —, the
  kernel/userspace boundary, the module system with module #0),
  `docs/GLOSSARY.md` (authority: code > glossary > prose), roadmap fixes.
- PR #40 — Session 14: kernel hardening + the Tier-3 workspace. The single
  agent write path (`_normalize_fact`/`_run_insight_writes` in
  `src/rlm/trellis_tools.py`) enforces `^[0-9a-f]{64}$` AND `ast_nodes`
  existence for every `sourceNodeIds` element before the WRITE session opens.
  `src/rlm/trellis_workspace.py`: the harness-captured workspace — plain
  version-tagged dict, origin-stamped uuid4 segments, bounded stubs
  (`preview≤500`), `WorkspaceBudgetError` (never silent truncation), gated
  injection (byte-identical prompt when off, pinned), Zod + Python twin
  bounds, counts-only telemetry.
- PR #41 — Session 15: the MEASURED paired-run workspace probe
  (`docs/benchmarks/WORKSPACE_PROBE_REPORT.md`: 8 vs 4 external calls, n=1,
  directional) and the protocol-module registry (`modules/<name>/`,
  `src/config/modules.ts` + `src/rlm/trellis_modules.py` twins,
  operator-owned `TRELLIS_MODULES`, max 4, protocol modules only) with module
  #0 extracted behind the sha256 byte-identical composed-prompt pin
  (`npm run test:modules`).
- PR #42 — Session 16: workspace lineage. Serialize (`--workspace-out`) → park
  (`scratch:goal:<goalId>:task:<taskId>`, TTL + per-goal byte cap) → seed
  (`seedTasks` ids only, merged, `--seed-workspace`, stamps verbatim, torn
  seeds raise). The orchestrator routes lineage BY REFERENCE. The two-task
  lineage probe was measured July 8, 2026 (4 vs 8 goal-total external calls;
  the seeded dependent task made 0).
- PR #43 — Session 17: the promotion path — the ONLY route from Tier 3 to
  Tier 1. Pure planner with typed refusals, content byte-verbatim,
  operator-explicit doc keys, the additive `documents.origin` audit column,
  and the `npm run promote` CLI (list/promote over PARKED snapshots, zero-paid
  default, extraction double gate). Acceptance `npm run test:promotion` (41).

Session 18 (July 8, 2026, PR #47) is also complete: the first flywheel turn,
machinery — the research existence gate at module registration
(`findMissingAstHashes`), the §9.4 manifest-as-graph-entity representation
(`npm run modules:register` MERGEs research-bearing ACTIVE manifests as
`(:Entity {kind: 'module_manifest', name: 'module:<name>'})` with ON MATCH
mirroring `applyRederivation`, so the unchanged sweep contests a module whose
promoted research is superseded), and `npm run modules:verify` (read-only).
The recovery loop stays human; contested/retired manifests are skipped by
registration. Acceptance `npm run test:module-lifecycle`.

The module #1 paid authoring turn RAN July 9, 2026 (PR #45):
`modules/workspace-discipline/` v1 — corpus promoted as
`research:trellis/workspace-discipline/{contract,evidence}` (24 citable block
hashes), one paid draft, landed and registered live. The turn observed the
§10 provenance-laundering residual live (self-reported hashes were
real-but-unrelated, surfaced by whole-database `vector_search`, not the
corpus); the operator caught and corrected it before landing. The remediation
design (PR #46, `docs/architecture/GROUNDED_AUTHORING.md`) became Session 19.

Session 19 (July 9, 2026, PR #50) is also complete: grounded authoring —
`trellis_agent.py --mode author`, a DB-free branch whose `custom_tools` is
exactly `{trellis_workspace}` (no DB connection opens), seeded with the
promoted corpus block-aligned (`src/core/authoring/corpus.ts`/`seed.ts`),
composing rlms base + a brace-free author addendum + the byte-pinned template
(`template.ts`), and emitting a hashes-free `TRELLIS_DRAFT` envelope. The
harness holds the pen: `research.sourceNodeIds` pinned from the corpus block
set; the deterministic anchor gate (`anchors.ts`,
`ANCHOR_COVERAGE_THRESHOLD = 0.3`) refuses a corpus-blind draft; the draft
scanner (`src/core/observability/rlm_draft.ts`) refuses any 64-hex token.
`npm run modules:author`: plan-echo default, `--draft` zero-paid replay,
`--confirm-paid` spawn; assembly writes a directory for human review only. A
follow-up provenance-citation A/B eval
(`docs/benchmarks/PROVENANCE_CITATION_AB_REPORT.md`) added the opt-in
`TRELLIS_CITATION_AUDIT`/`_HINT`/`_ENTAIL` instrumentation, found citation
laundering is incentive-driven (never reward citation count), and fixed
`_node_text` reconstruction so `get_ast_texts`/`vector_search` can read
markdown/promoted block text.

Session 20 (July 9, 2026, PR #55) is also complete: pillar §6.1 + §6.2.
(1) The editing toolkit (`src/rlm/trellis_textedit.py`): `trellis_textedit`
injected ONLY when the operator sets `TRELLIS_EDIT_ROOT`; strict
resolve-then-commonpath containment (rooted paths refused explicitly — the
Python 3.13 `ntpath.isabs` drive-relative trap was found and fixed here);
`load` (lines frame + load-time sha256, byte-identical unedited round-trip),
`locate` (engine-computed 0-based half-open addresses), `splice` (staged;
addresses transient), `diff`/`revert`/`drop`, `write_back` (re-hash current
disk bytes; mismatch raises `StaleFileError`, else temp + rename). Zod +
Python twin bounds; counts-only telemetry; toolkit ops never count as
database calls; unset ⇒ byte-identical prompt and namespace, pinned by
`npm run test:textedit` (81). Git stays out; landing is a human PR.
(2) The kernel prompt revision: the brace-free CODE-MEDIATED TEXT hard-rule
block joined `TRELLIS_ADDENDUM_BASE` in its own commit; the composed-prompt
pin moved wittingly (`abb945a6…f9b2` → `170e9f7e…67e9`, recomputed in the
same commit; the constant `COMPOSED_SYSTEM_PROMPT_SHA256` records its move
history in place). The same PR carried the RLM reframing documentation
overhaul (docs only).

Session 21 (July 9–10, 2026, PR #56 + the completion PR carrying this file)
is complete EXCEPT one leg: the pillar's measurements (roadmap §4 row 1;
§6.3 + §6.4 owner-APPROVED July 9). PR #56 landed the implementation slice:
the committed corpus `data/frankenstein.txt` (Gutenberg #84, trimmed
fail-closed: 421,536 bytes, sha256 `bde72e69…6934a8`, LF-pinned in
`.gitattributes`), `src/benchmarks/effective_context/{ground_truth,runner}.ts`
+ tests + thin `scripts/exp_effective_context.ts` (exact-byte `.txt` parser
path; verified ingest `none`; six kernel-fixed count/byte-exact-quote/
localization questions with ground truth computed from the committed file;
counterbalanced paired arms; a temp cwd holding only the ordered-handles
manifest; mandatory full-corpus read-set audit + zero-vector-search gate;
bounded capture/timeout, no retries; positive spend accounting; mandatory
paid `--out`), and the experiment-only prompt omission:
`CODE_MEDIATED_TEXT_RULE` is a named 252-byte block in `trellis_agent.py`;
exactly `TRELLIS_EXP_OMIT_CMT=1` (set only by the experiment script's spawn
env; `buildAgentEnv` deletes it AFTER credential forwarding; never a
worker/Compose setting) removes exactly that block, reproducing the recorded
pre-Session-20 prompt; unset ⇒ byte-identical default (both pinned in
`test:modules`, now 47 checks). The completion PR then: diagnosed the
`check_python_runtime.py` hang (not reproducible — every import ≤6.93 s in
isolation; the check now prints flushed per-step progress so a recurrence
names its culprit; pandas pin untouched); pinned the parser literals (root
`12625e58…3c19e5`, exactly 106 ordered unique `opaque_text` blocks,
ordered-list sha256 `4edbff59…e8a18`); ingested Frankenstein live
(`book:gutenberg-84:frankenstein` v1: 107 nodes / 106 eligible / 0 queued;
identical re-ingest = auditable no-op v2, diff 0/0/107; Python
`get_ast_texts` samples byte-exact; 0 embeddings); RAN the approved paid
probe — 12/12 counterbalanced runs, **$0.9629 actual** vs $4.00 estimate
(`docs/benchmarks/EFFECTIVE_CONTEXT_PROBE_REPORT.md`; pillar §6.3 MEASURED).
Probe headline: neither arm pulled the ~110k-token corpus through attention
(median input 22,527 on / 24,761 off) — the tooling shape, not the §6.2
prompt block, carries the discipline; the read-set audit refused 10 of 12
rows and decomposed every failure into a named pillar pathology (doubled
frames counting EXACTLY 2× truth after reading root + blocks;
parametric-memory answers with corrupted quote boundaries, correctly refused
even when the value was right; three protocol violations; the 5-iteration
ceiling binding on all 12 runs); grounded-correct 1/6 per arm, symmetric.
It then promoted the pillar's §0+§2 as the third corpus doc
(`research:trellis/workspace-discipline/code-mediated-text` v1, root
`fa324411…3fff00`, 19 citable blocks) through a temporary stub-park harness
+ the REAL `npm run promote` path (scratch keys cleaned, harness deleted,
shape preserved in the roadmap §5 entry), and RAN the approved paid module
#1 v2 authoring turn (37,801 in / 4,142 out ≈ **$0.136**): the draft derives
pillar §2 essentially point-by-point and retires the v1 mitigation line, but
the deterministic anchor gate REFUSED assembly at **19/64 = 0.2969 < 0.3**,
one anchor short. Measured root cause: the pillar excerpt is compound-dense —
52 of the 64 anchors are exact-match hyphenated compounds with NO stem
credit, so faithful paraphrases score zero; the SAME draft passes the
v1-era two-doc corpus at 0.328. The gate held as designed and was not
changed; the envelope is preserved at
`benchmark_logs/session21_author_v2_draft.json` (replay-verified to
reproduce exactly 19/64). Module v2 is NOT landed; roadmap §4 row 1 is NOT
struck. Session 21 paid spend: $1.099 total across the two approved runs.

OpenCnid selected the MIT License on July 6, 2026.

Your objective is Session 22: close roadmap §4 row 1 — land module #1 v2
from the preserved draft envelope, resolving the anchor-gate refusal per the
owner's decision (§3–§4 present the two paths and the measured
recommendation; obtaining that decision is the first item), then strike
row 1. Do not re-plan or re-implement completed work; do not re-run the
probe. RLM expands exclusively to Recursive Language Model (the MIT CSAIL
formulation).

## 0. The handoff loop (permanent — preserve this section in every rewrite)

This file is both the prompt that starts a session and the final deliverable
that session must produce. Trellis itself caches derived insights so repeat
queries get cheaper; this file does the same for engineering sessions. The
loop:

1. Execute. Study the repository and `TRELLIS_ROADMAP.md`, present the design
   for the objective in §3–§4 below, implement it, and pass every acceptance
   check in §6.
2. Record. Update `TRELLIS_ROADMAP.md`: mark the completed item(s) only after
   acceptance, and add a full-dated §5 progress entry with the exact commands
   run and counts observed, including any defects found along the way and how
   they were fixed.
3. Regenerate. Rewrite THIS file for the next session, in the same PR as the
   implementation:
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
4. Ship. One feature branch, one PR to `master`, plain engineering prose, no
   AI attribution or generated-by trailers anywhere (commits, PR bodies, code
   comments).
5. Re-run the loop for late work (the event-loop rule; added by owner
   direction, July 9, 2026 — part of the permanent protocol from here on).
   Regeneration is not a one-shot close-out. If further work lands in the
   same working period AFTER this file was rewritten — an owner-approved paid
   run, a follow-up fix, a new design record — re-run step 3's objective
   selection against what that work revealed before handing off. A defect
   discovered in a pathway the flywheel or the next objective depends on
   satisfies the jump-the-queue rule even when an existing gate contained it:
   containment is not remediation. Pointer edits to this file are not a
   substitute for re-selecting the objective. A handoff whose §3 objective is
   stale relative to the session's own findings has not finished step 3.
   (Origin: the module #1 laundering finding and its design record initially
   landed as standing-item pointers while §3 still named the pre-finding
   objective; the owner corrected the priority.)

A session that completes its objective but does not regenerate this file has
not finished.

## 1. Architectural mental model

Trellis's core invariant is that every semantic fact remains traceable to an
immutable, content-addressed physical location in source material.

1. PostgreSQL + pgvector — physical layer
   - `ast_nodes` stores immutable Merkle AST nodes and optional embeddings.
   - `documents`/`document_nodes` store stable document keys, version
     history, and per-root membership. Since Session 17 `documents` also
     carries a nullable `origin JSONB` column — the promotion audit stamp;
     only segment promotion writes it, inside the ingest transaction.
   - `repository_snapshots`/`repository_snapshot_paths` (Session 8) record
     which paths each published repository snapshot contained.
   - The verified ingest transaction lives in `src/core/ingestion/`
     (`ingest_document.ts`: persist → read-back re-hash verification →
     membership → registration → in-transaction Merkle diff;
     `plan_ingest.ts`: explicit `none`/`changed` extraction policy with a
     hard block budget). `POST /ingest` is a thin delegate that hardcodes
     `changed` extraction — never use it for zero-paid corpus work;
     tombstones are ordinary ingests of a deterministic empty root. Schema
     bootstrap is serialized by `pg_advisory_xact_lock`; Neo4j bootstrap
     retries transient label-lock deadlocks.
   - The promotion path (Session 17; `src/core/promotion/`): the ONLY route
     from Tier 3 to Tier 1. Pure planner (typed refusals; content
     byte-verbatim; operator-explicit doc keys) + `promote_segment.ts` (one
     planned request through the unmodified verified transaction, returning
     the citable block hashes) + `npm run promote` (list/promote over PARKED
     snapshots only, zero-paid default, extraction double gate). Stable doc
     keys mean re-promotion versions the document and the sweep contests
     stale beliefs for free. Drill: `npm run test:promotion`.
   - Durable measurement substrate (Session 21): `book:gutenberg-84:
     frankenstein` (version 2 = the no-op re-ingest of the identical root
     `12625e58…3c19e5`; 106 ordered `opaque_text` blocks, no embeddings)
     mirrors the committed `data/frankenstein.txt` byte-for-byte — the
     probe's ground truth is computed from the file and the stored root is
     cross-checked at every probe start. It is the corpus, not drill
     residue. The three promoted research docs
     `research:trellis/workspace-discipline/{contract,evidence,
     code-mediated-text}` (14 + 10 + 19 eligible blocks, 43 deduped) are
     module #1's corpus, v2 included.

2. Neo4j — semantic and belief layer
   - `Entity` and `Conflict` nodes plus `ACTION`, `CONTRADICTS`,
     `DERIVED_INSIGHT`, `SAME_AS`/`DISTINCT_FROM` edges, all carrying
     `sourceNodeIds`. `contested`/`contestedAt`/`orphanedSourceIds`/
     `rederivedAt` form the audit-preserving quarantine/recovery state
     machine (`src/core/graph/provenance.ts`).
   - Entity identity is immutable; equivalence is an overlay belief.
     Retrieval expands one trusted `SAME_AS` hop with per-fact `viaAlias`.
   - Extraction (the deferred roadmap-row-2 prerequisites' site):
     `src/workers/extraction_worker.ts` consumes `extraction_queue` jobs
     enqueued only under operator-selected policy `changed`. The extraction
     prompt today is one hardcoded document-generic string. Extraction spend
     is always operator-gated.
   - Session 14 (kernel): the single agent write path
     (`write_derived_insight`/`write_derived_insights` → `_normalize_fact` →
     `_run_insight_writes` in `src/rlm/trellis_tools.py`) ENFORCES
     provenance: every `sourceNodeIds` element must match `^[0-9a-f]{64}$`
     AND exist in `ast_nodes` (deduped batch union, checked before the WRITE
     session opens). Never weaken or make this configurable.
   - Module entities (Session 18; `src/core/graph/module_registration.ts` +
     `scripts/register_modules.ts`): research-bearing ACTIVE manifests
     register as `(:Entity {kind: 'module_manifest', name: 'module:<name>'})`
     with existence-gated research hashes and ON MATCH mirroring
     `applyRederivation` — the unchanged sweep contests a capability when its
     research basis changes. Operator tooling only. Contested/retired
     manifests are skipped; module entities are contested or retired, never
     deleted. The dev graph currently carries `module:workspace-discipline`
     (v1, 24 hashes, uncontested) — this session's re-registration refreshes
     it to the 43-hash v2 basis via the ON MATCH path.

3. Redis + BullMQ — asynchronous layer
   - Seven queues: `extraction_queue`, `rlm_queue`, `supervisor_queue`,
     `invalidation_queue`, `verification_queue`, `resolution_queue`,
     `agent_queue`. `rlm_queue` and `agent_queue` use interactive no-retry
     job options; the rest bounded retries. All LLM calls live inside BullMQ
     workers or the RLM process; every worker-consumed completion crosses
     `parseLlmResponse` (`src/core/llm/boundary.ts`).
   - Scratch parking (Session 16): `scratch:goal:<goalId>:task:<taskId>`
     holds one task's end-of-run workspace snapshot, TTL-bounded
     (`SCRATCH_TTL_SECONDS`, default 3600) and volume-capped per goal. Pure
     helpers in `src/workers/workspace_scratch.ts`; all I/O in
     `rlm_worker.ts`. Promotion consumes parked snapshots — TTL expiry is BY
     DESIGN. A data-only stub job (`RlmStubSchema.workspaceSnapshot` +
     `goalId` + `taskId`) parks through the IDENTICAL path with zero LLM
     work — Session 21's pillar-excerpt promotion used a temporary operator
     harness in this shape (recreate, use, delete, record; shape preserved
     in the roadmap §5 entry of July 10, 2026).

4. RLM execution, the agentic loop, and external surfaces
   - `GET /api/rlm-stream` (API-key gated, `StreamGate` + queue-depth
     backstop) enqueues one `rlm_queue` job. `src/workers/rlm_worker.ts`
     spawns one Python process per job (`trellis_agent.py`) with config
     forwarded by the pure `buildAgentEnv` (`src/workers/rlm_job.ts`):
     `NEO4J_*`, `PG_DSN`, `PYTHONPATH`, the canonical MCP registry + exactly
     its named credential vars, validated workspace bounds, canonical module
     selection, textedit root + bounds exactly when configured; unset config
     values are stripped, never passed through raw; `TRELLIS_EXP_OMIT_CMT`
     is deleted AFTER credential forwarding so neither inherited state nor a
     colliding credential-env name can weaken a worker prompt (unit-pinned).
     `buildAgentArgs` forwards `--max-iterations`, `--goal-id`, and
     worker-named lineage temp files. Payloads are normalized by
     `parseRlmJobData`; the data-only `stub` replay mode supports zero-LLM
     drills; payloads carry nothing MCP-, workspace-content-, textedit-, or
     experiment-flag-shaped (unit-pinned).
   - `src/rlm/trellis_agent.py` wraps rlms (model `gpt-5.4-2026-03-05`,
     `max_depth` 1); tools via `custom_tools` — `trellis_neo4j` (read-only
     Cypher + the hardened write path), `trellis_postgres` (`get_ast_texts`,
     `vector_search`, `ast_hashes_exist`), and `trellis_mcp` only when
     operator-configured. PROVENANCE SPLIT: database tools increment
     `_count_tool_call()`; MCP/workspace/textedit ops count separately — an
     answer with zero DATABASE tool calls emits `TRELLIS_PROTOCOL_VIOLATION`.
   - The Tier-3 workspace (Sessions 14/16; `src/rlm/trellis_workspace.py`):
     injected when MCP servers are configured OR `--goal-id` is present OR
     the run is seeded; otherwise byte-identical prompt (pinned). Tier 3 has
     NO provenance standing; permanence is earned only through promotion.
   - CORE PILLAR — code-mediated text (ratified July 9, 2026;
     `docs/architecture/CODE_MEDIATED_TEXT.md`, doctrine on par with the
     provenance invariant): the model never counts, and the model never
     copies. Locations are engine-computed and returned by query (transient
     handles — re-query, never remember); existing bytes are moved by code
     (splice at a computed address, hash-guarded write-back), never re-typed
     through attention; the model authors only genuinely new text plus the
     code that manipulates everything else. Enforcement lands as tooling
     shape; prompts reinforce only. §6.1 + §6.2 IMPLEMENTED (Session 20);
     §6.3 MEASURED (Session 21 — the tooling shape carries the discipline;
     the read-set audit converts failures into named pillar pathologies);
     §6.4 ATTEMPTED and anchor-gate-refused — THIS session's objective.
   - The editing toolkit (Session 20; `src/rlm/trellis_textedit.py`):
     injected ONLY when the operator sets `TRELLIS_EDIT_ROOT`; strict
     containment; digest-guarded atomic `write_back`; byte-identical prompt
     and namespace when unset (pinned by `npm run test:textedit`). The
     toolkit never touches git; landing is a human PR.
   - The module registry (Sessions 15/18): `TRELLIS_ADDENDUM` =
     `TRELLIS_ADDENDUM_BASE` + Σ selected module addenda +
     `TRELLIS_WORKFLOW_RULES`. Selection operator-owned via `TRELLIS_MODULES`
     (default `["spatial-flywheel"]`; max 4; protocol modules only). Addendum
     files are brace-free; rubric text enters through `<<TRELLIS_RUBRIC>>`.
     The composed default prompt is pinned at
     `COMPOSED_SYSTEM_PROMPT_SHA256 = 170e9f7e…d1267e9` in
     `scripts/test_modules.py` (move history recorded in place; moves only
     with a witting kernel change, recomputed in the same commit). Session 21
     added the sibling pin `PRE_CODE_MEDIATED_TEXT_SYSTEM_PROMPT_SHA256 =
     abb945a6…9feef9b2` — the discipline-off experiment arm must always
     equal the recorded pre-Session-20 bytes.
   - Grounded authoring (Session 19; `src/core/authoring/*` +
     `src/core/observability/rlm_draft.ts` + `scripts/author_module.ts` +
     `trellis_agent.py --mode author`): drafts a protocol module addendum
     from a FIXED promoted corpus and nothing else. Author runs see only
     `trellis_workspace` (no DB connection opens), work from a block-aligned
     seeded corpus, and emit a hashes-free `TRELLIS_DRAFT` envelope
     (`{purpose, addendum, gapNotes}`; any 64-hex token ⇒ refusal). The
     harness pins `research.sourceNodeIds`; the byte-pinned template
     composes from (topic ≤200 chars, doc keys) and instructs "write the
     durable mechanic, not the measured numbers"; the deterministic anchor
     gate refuses assembly below `ANCHOR_COVERAGE_THRESHOLD = 0.3`.
     `npm run modules:author`: plan-echo default; `--draft <file>` is the
     zero-paid replay/assembly path (the file is the raw draft-envelope JSON
     with camelCase `gapNotes`); `buildManifest` always emits `version: 1` —
     a v2 landing sets the version by hand. SESSION 21 FINDING (this
     session's objective): `extractAnchors` caps at 64 anchors (structural
     kinds first — numeric comparisons, ratios, hyphenated compounds — then
     document-frequency terms); TERM anchors get 6-char stem credit
     (`TERM_STEM_LENGTH`) but COMPOUND anchors require exact substring
     match, so a compound-dense corpus (the pillar excerpt: 52/64 compounds)
     turns the gate into a spelling test — a faithful paraphrase scores
     zero. The gate's stated purpose (its own header) is catching
     corpus-blind drafts, not grading derived ones.
   - CRITICAL rlms constraints (rlms==0.1.3): `custom_system_prompt`
     REPLACES the base REPL protocol prompt — Trellis EXTENDS
     `RLM_SYSTEM_PROMPT`; rlms runs `.format()` over the prompt so literal
     curly braces are forbidden (escape by doubling); `LocalREPL` persists
     `self.locals` across turns; underscore-prefixed names never persist.
   - The orchestrator (Sessions 9/16, `src/core/agent/`) is a pure decision
     maker with NO tools and no database access; it routes workspace lineage
     BY REFERENCE. Zero-LLM drills: `npm run test:agent-loop`.
   - The A2A surface (Session 11): `TRELLIS_A2A_ENABLED` default false;
     byte-identical API when unset. IORedis gotcha: issue `subscribe` in the
     SAME tick the connection is created.
   - The effective-context benchmark (Session 21;
     `src/benchmarks/effective_context/` + `scripts/exp_effective_context.ts`):
     the paired-run §6.3 machinery — committed-corpus fingerprint checks,
     `--ingest-only` (verified ingest + no-op replay + Python read-back
     samples), plan-only default, `--confirm-paid --out` (mandatory
     artifact), per-run read-set audit via `TRELLIS_CITATION_AUDIT`, arm
     isolation asserted (spawn envs differ by exactly
     `TRELLIS_EXP_OMIT_CMT=1`), spend gates before and after every
     subprocess. Ground-truth helpers are pure and unit-pinned
     (`ground_truth.test.ts` pins the corpus bytes, the trim, the parser
     root/count/digest literals, and the six expected answers). The probe
     ran once (July 10); re-running is owner-gated.

5. Observability and process boundaries
   - `src/core/observability/`: pino JSON logging, per-process Prometheus
     registries; API and workers are separate processes/containers. Bounded
     metric labels only — queries, goals, content, paths, hashes, tool
     arguments/results, workspace/promoted/module text, diffs, digests,
     URLs, and credentials never become label values. Queue-depth gauges
     cover all seven queues. Workspace/lineage/textedit telemetry is counts
     only.
   - `scripts/check_python_runtime.py` (`npm run python:check`) compiles the
     shipped Python and imports the pinned runtime deps (including the
     pillar-load-bearing `pandas`). Since Session 21 it prints flushed
     one-step-ahead progress lines because a silent hang was observed once
     (July 9, never reproduced); if it ever stalls again, the last printed
     line names the culprit. Never weaken or remove the pandas pin.

6. The frontend (DEFERRED — unscheduled) and other stable subsystems
   - `src/frontend/` is a Next.js 16.2.9 / React 19 app, dev-only, no CI
     coverage. `src/frontend/AGENTS.md` warns this Next.js version has
     breaking changes vs. training data. NOT this session's work.
   - Whole-codebase ingestion: `src/core/repository/`, `npm run repo:ingest`,
     drill `npm run test:repo-ingest`. The deferred row-2 extraction
     prerequisites live HERE and in `src/workers/extraction_worker.ts` (spec
     preserved in roadmap §5: selection-side `isTestOrFixturePath`,
     kernel-constant stoplist pre-merge, `buildExtractionPrompt` document
     branch byte-pinned).
   - Benchmarks: OOLONG v1 saturated; anti-shortcut v2; the scale gate; the
     paired-run probes (`WORKSPACE_PROBE_REPORT.md`,
     `WORKSPACE_LINEAGE_PROBE_REPORT.md`,
     `EFFECTIVE_CONTEXT_PROBE_REPORT.md`); the provenance-citation A/B eval.
   - The fixture MCP server (`scripts/fixture_mcp_server.py`) is the only
     MCP server acceptance ever configures.

## 2. Current baseline

Repository state at handoff creation:

- `master` is at `672d8c3` (PR #56, the Session 21 implementation slice).
  THIS file ships in the Session 21 completion PR together with: the literal
  parser pins in `ground_truth.test.ts`; the `check_python_runtime.py`
  progress lines; the author-driver gate-ratio print at four decimals (the
  refusal used to print "ratio 0.30, threshold 0.3" — a contradiction on its
  face — when 19/64 rounds up); `docs/benchmarks/
  EFFECTIVE_CONTEXT_PROBE_REPORT.md`; the pillar §6.3 MEASURED / §6.4
  ATTEMPTED-NOT-LANDED status updates; the README benchmarks pointer; the
  rewritten `scale_drill_results.json`; the roadmap §5 completion entry; and
  the two force-added `benchmark_logs/` artifacts —
  `session21_effective_context.json` (raw probe rows) and
  `session21_author_v2_draft.json` (THE PRESERVED DRAFT ENVELOPE this
  session lands; replay-verified 19/64). Use `git log -- HANDOFF.md` to
  confirm that PR landed. If it is still unmerged when this session starts,
  STOP and merge it first.
- The dev stack (containers `trellis-postgres` host port 5433,
  `trellis-neo4j` 7687, `trellis-redis` 6379 — their compose project labels
  point at an unrelated worktree path; the fixed `container_name`s mean
  exactly one such stack exists machine-wide) carries: the three promoted
  corpus docs `research:trellis/workspace-discipline/{contract,evidence,
  code-mediated-text}` (v1 each; 14/10/19 eligible blocks; 43 deduped), the
  registered `module:workspace-discipline` entity (v1, 24 hashes,
  uncontested), and the durable Frankenstein corpus
  (`book:gutenberg-84:frankenstein` v2, root `12625e58…3c19e5`, 106 blocks,
  no embeddings). The worktree `.env` points at those ports;
  `OPENAI_API_KEY` is empty in `.env` but PRESENT in the owner's shell
  environment — dotenv never overrides shell values, so strip it explicitly
  (`env -u OPENAI_API_KEY`) for every zero-paid step.
- Offline baseline: `npm test` = 631 passing across 72 files.
  `npm run build`, `npm run python:check` (now with progress lines),
  `docker compose --profile test config --quiet`, `git diff --check` pass.
- Live zero-LLM checks (Session 21 observed): `test:textedit` 81,
  `test:module-lifecycle` 60, `test:modules` 47 (the composed-prompt pin
  `170e9f7e…d1267e9` and the off-arm pin `abb945a6…9feef9b2` both held),
  `test:promotion` 41, `test:rlm-workspace` 86, `test:rlm-mcp` 86,
  `test:rlm-sandbox` 21, `test:agent-loop` 35, `test:a2a` 46,
  `test:repo-ingest` 45, `test:benchmark-hardening` 24,
  `test:entity-resolution` 34, `test:api-hardening` 18,
  `test:belief-recovery` 30, `test:invalidation-sweep` 17. `drill:scale`:
  gate CLOSED at max provenance 286, sweep growth 2.25x (band 1.63x–2.26x
  across Sessions 12–21).
- Isolated Compose integration: 10 assertions, ran as project
  `trellis_s21_ci` (host ports 0), all PASS, torn down with `--volumes`.
  `package.json` did not change in Session 21, so the Docker `npm ci` layer
  stays cached; C: had ~33 GB free.
- Local Node 20.19.2 (CI targets 22), Python 3.13.1, Docker Compose v2,
  PostgreSQL 16.x, Neo4j 5.11. Python deps pinned in `requirements.txt`
  (`rlms==0.1.3`, `mcp==1.12.4`, `pandas` transitively via `unstructured` —
  pinned by `python:check`).
- `gh auth status` reported the OpenCnid token invalid at the July 10
  checkpoint and it could not be refreshed non-interactively. Verify
  authentication before the publish step (not before
  implementation/acceptance).
- Paid-run posture: Session 21 consumed BOTH approved paid runs ($0.9629
  probe + $0.136 author = $1.099 total). NO paid run is currently approved.
  This session's recommended path lands v2 with ZERO paid spend; the
  alternative re-run path needs explicit owner approval first.

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

## 3. Session 22 problem statement

Roadmap §4 row 1 has one open leg: module #1 v2 is drafted but not landed.
The one approved authoring turn ran on July 10 and produced a faithful
draft — it derives pillar §2 essentially point-by-point, retires the v1
"when reconstructing stored text, preserve real newlines"
transcription-mitigation line, and declares five honest gaps — but
`evaluateAnchorGate` refused assembly at 19/64 = 0.2969, one anchor below
the 0.3 threshold. The envelope is preserved byte-faithfully at
`benchmark_logs/session21_author_v2_draft.json` (replaying it through
`--draft` reproduces exactly 19/64).

The measured root cause (roadmap §5, July 10 entry) is a gate-design
artifact, not a corpus-blind draft: `extractAnchors` over the enlarged
three-doc corpus yields 64 anchors of which 52 are hyphenated COMPOUNDS
requiring exact substring match (the pillar excerpt is compound-dense) and 4
are numeric kinds (`8 vs 4`, `2.2`, `3.9`, `5.4`) the authoring template
itself forbids the draft to restate; only TERM anchors (8 left after the
64-cap) enjoy the 6-char stem credit that embodies the gate's
contact-not-spelling intent. Faithful paraphrases — "moved by code" for
`code-manipulated`, "computed addresses" for `engine-addressed` — score
zero. The SAME draft passes the v1-era two-doc corpus at 21/64 = 0.328.

Two resolution paths exist. THE FIRST ITEM OF THIS SESSION is to put the
decision to the owner on the Session 21 completion PR (or read it there if
already given) and proceed on the chosen path:

- Path B — RECOMMENDED: refine the anchor extractor's compound coverage (a
  reviewed kernel edit in `src/core/authoring/anchors.ts`, spec in §4), then
  land v2 from the PRESERVED envelope via the zero-paid `--draft` replay.
  Zero additional paid spend. A Session 21 simulation over the
  known-missing compounds showed segment-stem matching flips at least 8 of
  them to covered, putting the saved draft comfortably over threshold
  (recompute exactly once implemented). This is also the principled fix:
  the gate's own header says it exists "to catch a corpus-blind draft, not
  to grade a derived one", and terms already stem-match for exactly that
  reason.
- Path A — alternative (needs a NEW owner approval for paid spend): re-run
  the identical authoring turn (~$0.14 actual last time; drafts are
  stochastic and the miss was one anchor) and assemble whichever draft
  passes the unchanged gate. Mechanical, no kernel edit, but it spends money
  to route around a measured gate defect and leaves the defect in place for
  every future compound-dense corpus.

If the owner is unavailable this session: implement and unit-pin the Path B
refinement (it is correct independent of the landing), run every drill, but
DO NOT land v2 or re-register — leave the landing to an owner go-ahead,
record the state honestly, and regenerate this file accordingly. Landing a
protocol module is an owner-reviewed act (Session 18/19 doctrine).

## 4. Required design

(a) The anchor-gate refinement (Path B; `src/core/authoring/anchors.ts`).
In `anchorCovered`, a `compound` anchor is covered when EITHER the exact
compound appears in the normalized draft (today's rule) OR every hyphen
segment of length ≥ 3 appears in the draft stemmed to `TERM_STEM_LENGTH`
(6) — i.e. `anchor.value.split('-').filter(s => s.length >= 3).every(s =>
draft.includes(s.slice(0, TERM_STEM_LENGTH)))`. Comparison/ratio kinds stay
exact-match (do NOT silently drop them in author mode without the owner's
word — record the 4-anchor template tension as prose instead). The threshold
stays 0.3; the empty-set fail-closed rule stays; the bounded missing listing
stays. Update the module docstring's honest-limits paragraph: segment stems
can match independently across the draft, which weakens per-anchor evidence
slightly — acceptable because the gate measures aggregate contact and the
threshold is unchanged. Unit-pin in `src/core/authoring/anchors.test.ts`
with the measured Session 21 examples: `engine-addressed` covered by a draft
saying "engine-computed queries or addresses"; `build-new-then-rebind`
covered by "build the new state first and then rebind"; a compound with an
absent segment NOT covered; an exact compound still covered; short segments
(< 3 chars, e.g. "of" in `list-of-lines`) not required. Tests never read
`benchmark_logs/`; record the envelope's recomputed live coverage in the
roadmap entry instead.

(b) The v2 landing (both paths converge here; all steps human, in this
order):

1. Replay: `npm run modules:author -- --module-name workspace-discipline-v2
   --topic "Workspace discipline for RLM goal runs under the code-mediated
   text pillar: handle all text as queryable structures moved by code, never
   retyped through attention." --doc-key
   research:trellis/workspace-discipline/contract --doc-key
   research:trellis/workspace-discipline/evidence --doc-key
   research:trellis/workspace-discipline/code-mediated-text --draft
   benchmark_logs/session21_author_v2_draft.json` (the topic must be
   byte-identical to Session 21's — it is baked into the assembled
   RESEARCH.md). The gate must now pass; the assembled directory appears at
   `modules/workspace-discipline-v2/`. Record covered/total at four
   decimals.
2. Review the assembled directory like any module PR. The draft's five gap
   notes are honest and stay.
3. Land into `modules/workspace-discipline/` (the driver NEVER edits an
   existing module; this swap is the human act): replace `addendum.txt` with
   the drafted text PREFIXED by the pinned title line
   `WORKSPACE DISCIPLINE PROTOCOL` and a blank line (the draft's body starts
   at "Workspace capture"; the title is a human landing edit — record it in
   RESEARCH.md; `test:modules` [5] pins the title and composition order).
   Replace `module.json` with the assembled manifest EDITED to `version: 2`
   (assembly always emits 1) and confirm `research.sourceNodeIds` is the
   driver-pinned 43-hash set. Rewrite `RESEARCH.md` as: the assembled v2
   skeleton (corpus table now three docs, gap notes, provenance note naming
   the July 10 paid run + the replay landing + the title-line edit)
   FOLLOWED BY the v1 history section preserved verbatim (the laundering
   finding and its correction are the record that produced grounded
   authoring — never erase them). CONFIRM the "when reconstructing stored
   text, preserve real newlines" line is gone and no other line re-imports
   transcription language.
4. Delete `modules/workspace-discipline-v2/` (the scratch directory).
5. Update the `scripts/test_modules.py` [5] pin `module1["version"] == 1` →
   `== 2` (line ~173). The name and title pins stay. The composed-prompt
   sha256 pin does NOT move (module #1 is not in the default selection).
6. Re-register: `npm run modules:register -- --module workspace-discipline`
   — the Session 18 ON MATCH refreshes the research hashes (24 → 43) and
   `moduleVersion`; then `npm run modules:verify` shows the refreshed basis
   uncontested.
7. Update `docs/architecture/CODE_MEDIATED_TEXT.md` §6.4 from ATTEMPTED to
   DONE (landed date, the refinement or re-run that unblocked it) and its §5
   note about module #1's mitigation line (now historical); strike roadmap
   §4 row 1 with a completion note.

(c) What does NOT change: the Session 14 write path, the
promotion/registration gates, the authoring template and its sha256, the
draft scanner, the anchor THRESHOLD and fail-closed posture, the module
loader, the composed-prompt pins (`170e9f7e…d1267e9` default,
`abb945a6…9feef9b2` off-arm), the probe machinery and its committed
artifacts, every bound, and the Session 20 textedit surface. New code is one
bounded coverage-rule change in `anchors.ts` plus its unit pins (Path B), or
nothing (Path A).

## 5. File-level starting points

Inspect before editing:

- `benchmark_logs/session21_author_v2_draft.json` — the preserved envelope
  (`purpose`/`addendum`/`gapNotes`). Its addendum has four titled sections
  starting at "Workspace capture"; no title line; no braces; no hashes.
- `src/core/authoring/anchors.ts` — `extractAnchors` (the 64-cap, kind
  order), `anchorCovered` (the term-stem precedent), `TERM_STEM_LENGTH`, the
  honest-limits header. `anchors.test.ts` beside it.
- `scripts/author_module.ts` — `assembleModule` (the gate call + the
  four-decimal ratio print), the `--draft` replay path, the
  refuse-to-author-over-existing-directory guard.
- `modules/workspace-discipline/` — v1: `addendum.txt` (the title line + the
  mitigation line to retire), `module.json` (version 1, 24 hashes),
  `RESEARCH.md` (the v1 laundering history to preserve verbatim).
- `scripts/test_modules.py` — section [5] (name/version/title pins; the
  version pin moves 1→2 at landing), the composed-prompt pin block (does not
  move).
- `docs/architecture/CODE_MEDIATED_TEXT.md` — §6.4 (ATTEMPTED → DONE at
  landing), §5 (the module-#1 note), §0/§2 (the corpus text — already
  promoted, do not re-promote).
- `TRELLIS_ROADMAP.md` — §4 row 1 (strike at completion), the two July 10 §5
  entries (the full Session 21 record this session builds on).
- `docs/benchmarks/EFFECTIVE_CONTEXT_PROBE_REPORT.md` — the §6.3 record; its
  "Honest caveats" section is the spec for any future owner-approved probe
  v2 (do not run one this session).

## 6. Test strategy and acceptance

NO paid run is approved for this session's recommended path. Path A requires
a fresh owner approval BEFORE any `--confirm-paid` invocation (estimate
first, ≤$5 cap, actuals recorded).

Order:

1. Baseline (fresh worktree): the §2 command block. Confirm the Session 21
   completion PR is merged; STOP and merge it first if not.
2. Owner decision: put §3's two paths (with the measured numbers) on the PR
   discussion, or read the decision if already given. Default to Path B's
   implementation work while waiting; do not land without the go-ahead.
3. Path B offline: the `anchors.ts` refinement + unit pins. `npm test`
   (expect 631 + the new anchor cases), `npm run build`,
   `npm run test:modules` (47, pins intact), `git diff --check`.
4. Live zero-paid, `OPENAI_API_KEY` removed: the `--draft` replay (§4(b)1) —
   the gate line must print a passing four-decimal ratio; record
   covered/total exactly. Assemble, review, land, delete scratch, update the
   version pin, re-register, verify (§4(b)2–6). Re-run
   `npm run test:modules` (title/version pins green at v2) and
   `npm run test:module-lifecycle` (the registered entity carries 43
   hashes).
5. Docs: §4(b)7. Then the standing close-out block below, including the
   isolated Compose integration (unique project name, host ports 0) and
   `drill:scale` (commit the rewritten `scale_drill_results.json`).
6. Roadmap: strike §4 row 1 only after everything above is green; full-dated
   §5 entry with exact commands, counts, the recomputed gate coverage, and
   zero (or Path A actual) paid spend. Run §0 step 5, select Session 23 from
   the first unstruck row (row 2: the repository-scale extraction
   prerequisites — unless a discovery jumps the queue), regenerate this
   file, commit, verify `gh auth status`, push, open the draft PR.

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

- `TRELLIS_ROADMAP.md`: the §5 entry; strike §4 row 1 after acceptance.
- `docs/architecture/CODE_MEDIATED_TEXT.md`: §6.4 → DONE; the §5 module-#1
  note.
- `modules/workspace-discipline/`: the v2 landing per §4(b)3.
- `HANDOFF.md`: regenerate per §0 — including the §0 step 5 re-check.

Remaining owner-gated items (do NOT run unprompted; propose each with a cost
estimate):

- Path A's authoring re-run (~$0.14) — only if the owner picks it over
  Path B.
- The effective-context probe v2 (~$1 actual, ~$4 budgeted) with the three
  recorded deltas (root hash out of `handles.json` or into the audit set; a
  higher iteration ceiling; explicit manifest-location wording) — the
  report's caveats section is its spec.
- The supervised Trellis-edits-Trellis proof run (operator sets
  `TRELLIS_EDIT_ROOT` at a branch checkout; one small real edit through the
  toolkit; lands as an ordinary reviewed PR).
- The module #2 turn (topic owner-picked, prompt-movable,
  positive-control-testable; collaborator input bears on the choice).
- The extraction pilot re-run (waits on the row-2 prerequisites).

## 7. Guardrails

1. Never mutate an AST. The T13 hash preimage is pinned; `rederiveAstNodeId`
   stays authoritative; nothing positional is ever persisted as identity.
2. Never merge, rename, or delete Entity nodes. Equivalence stays an overlay
   belief; module entities are contested or retired, never deleted — the v2
   re-registration is the Session 18 ON MATCH refresh, never a
   delete/recreate.
3. Preserve provenance on every semantic node and edge.
   `write_derived_insight` keeps its Session 14 enforcement.
   `research.sourceNodeIds` on the landed v2 manifest is exactly the
   driver-pinned 43-hash set — never hand-edited beyond what assembly
   emitted.
4. Paid work: NONE is pre-approved this session. Path B is zero-paid by
   design. Any paid invocation (Path A, probe v2, module #2) needs its own
   owner approval, a printed pre-flight estimate, the standing ≤$5/run cap,
   and actuals recorded in the roadmap entry. Never reward citation count
   anywhere.
5. Gate machinery is kernel; operator control is absolute. The anchor-gate
   refinement (if Path B) changes ONE coverage rule under review,
   unit-pinned, with the threshold, fail-closed posture, bounded listings,
   and the template/scanner untouched. The gate never becomes env-tunable.
   The Session 19 authoring gates and Session 20 textedit invariants are
   permanent.
6. Every external interaction is bounded; over-budget operations raise with
   usage — never silent truncation.
7. Validate at every boundary: every worker-consumed completion crosses
   `parseLlmResponse`; the draft scanner applies to the replayed envelope
   unchanged; `AGENT_ORACLE_ENABLED` and `TRELLIS_A2A_ENABLED` defaults stay
   pinned false.
8. Report honestly: the landed v2's RESEARCH.md names the paid run that
   drafted it, the gate refusal, the refinement (or re-run) that unblocked
   it, and the title-line landing edit. The v1 laundering history is
   preserved verbatim. A gate that refuses again is a finding to record, not
   a reason to lower the threshold.
9. Do not break existing consumers: the composed-prompt sha256 pins
   (`170e9f7e…d1267e9` default, `abb945a6…9feef9b2` off-arm) do NOT move;
   `test:modules` [5] keeps the module name and addendum title across the v2
   swap (the version pin moves 1→2 wittingly, in the landing commit);
   `TRELLIS_RESULT`/`TRELLIS_TELEMETRY` semantics are additive only; the
   API, A2A, and SSE contracts are untouched; the committed probe artifacts
   and report are immutable history — corrections are new entries, not
   edits.
10. Respect the rlms prompt contract: extend `RLM_SYSTEM_PROMPT`, never
    replace it; no literal curly braces in anything rlms formats (the landed
    v2 addendum included — it is already brace-free); no rlms library
    modifications.
11. Follow the T16 observability house style: corpus text, draft text, and
    file paths never become metric label values; artifacts live in reports
    and `benchmark_logs/`, not in logs.
12. Keep API and worker processes split; project-scoped Compose commands;
    drills clean up token-scoped temp state only —
    `book:gutenberg-84:frankenstein` and the three `research:` docs are
    deliberately durable substrate, not drill residue.
13. Ship one feature branch and one PR to `master`, plain engineering prose,
    no AI attribution or generated-by trailers. Regenerate this file in the
    same PR — and re-run the §0 step 5 check before handing off.
14. Code-mediated text is doctrine (permanent; survives every rewrite). Any
    new or modified surface where the RLM touches text must follow
    `docs/architecture/CODE_MEDIATED_TEXT.md`: locations engine-computed,
    bytes moved by code, transient frames, hash-guarded writes — never
    model-estimated positions, never model-retyped existing bytes, never a
    persistent in-memory mirror of a store. Prompt text may reinforce the
    discipline but never substitutes for tooling shape. This applies to the
    session's own editing work too: the v2 landing moves the drafted bytes
    by file operations and replay, never by retyping them.

## 8. Explicit exclusions

Do not include: re-running the effective-context probe or touching its
machinery/artifacts (probe v2 is owner-gated; the one approved invocation is
spent and its result stands); any paid run without a fresh owner approval;
re-promoting the pillar excerpt or any corpus doc (all three are live at
v1); changing `ANCHOR_COVERAGE_THRESHOLD`, the fail-closed empty-set rule,
the authoring template, or the draft scanner; dropping the comparison/ratio
anchor kinds without the owner's word (record the tension, don't code around
it); the repository-scale extraction prerequisites (roadmap row 2 — next in
queue AFTER row 1 closes; do not partially implement); the extraction pilot
re-run; the supervised Trellis-edits-Trellis proof run and the module #2
turn (owner-gated — propose with estimates only); embedding or extracting
Frankenstein; weakening or toggling the §6.2 kernel block outside the
existing experiment flag; moving the composed-prompt sha256 pins; authoring
v2 under the driver against the existing module directory (the driver's
refusal is correct — landing is the human swap); erasing module #1's v1
laundering-correction history from `RESEARCH.md`; new MCP servers or
transports; A2A changes; frontend work (deferred unscheduled); polars
adoption; `ASTRef`/`EVIDENCED_BY` migration (gate closed at 286); T13
re-hashing; rlms library modifications; weakening the Session 14 write-path
enforcement, the Session 15/20/21 composition pins, the Session 16 lineage
pins, the Session 17 promotion refusals, the Session 18 registration gates,
the Session 19 authoring-mode pins, or the Session 20 textedit
gating/containment/hash-guard pins.
