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

Session 20 (July 9, 2026, PR #55) is also complete: **the
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

Session 21 (July 10, 2026, PR #59) is also complete: **the pillar's
measurements** (pillar §6.3 + §6.4; roadmap §4 row 1). A first attempt
at this objective (PR #56, July 9–10) was owner-discarded and reverted
wholesale (PR #58); this session is the fresh redo — nothing from the
reverted tree reused. **(1) The corpus:** `data/frankenstein.txt`
(Gutenberg #84, the 1831 text; deterministic trim; 421,536 bytes,
sha256 + LF-ness unit-pinned; `.gitattributes -text` so autocrlf can
never move the truths) ingested through the verified path as
`book:gutenberg-84:frankenstein` (root `a2f9c97c…4439`, 1,708 nodes,
796 blocks, extraction `none`; sampled blocks read back byte-exact
through the real Python `get_ast_texts`; identical re-ingest observed
as version 2 / same root / empty diff). Deliberately durable substrate.
**(2) The effective-context probe (§6.3 MEASURED,
`docs/benchmarks/EFFECTIVE_CONTEXT_PROBE_REPORT.md`):**
`scripts/exp_effective_context.ts` (plan-only default, `--ingest`
zero-paid setup, `--confirm-paid` + cumulative `--max-spend-usd` abort;
ground truth COMPUTED from the committed bytes by the unit-pinned
`src/benchmarks/effective_context/ground_truth.ts`). The
discipline-off arm is `TRELLIS_EXP_OMIT_CMT=1` — experiment
instrumentation in the `TRELLIS_CITATION_*` mold: unset composes the
byte-identical pinned kernel (`170e9f7e…67e9`, unmoved); set composes
exactly the §6.2 block out, byte-identical to the recorded
pre-Session-20 kernel (`abb945a6…f9b2`); both pinned by `test:modules`
[7]; `buildAgentEnv` strips the flag unconditionally (no config field
exists — unit-pinned). Measured (12 runs, $0.7320, n=6/arm
directional): median input 7.9k (on) vs 14.7k (off); with the block no
run put the corpus through attention, without it one run handed all
~105k corpus tokens to a single `llm_query` (110,550 input tokens,
7.6×); the one wrong answer was the on arm RETYPING an engine-computed
count (printed 55, answered 47) — the transcription channel live in
the unmediated answer path; tooling shape, not prompt text, is the
remaining fix there. **(3) Module #1 v2 (§6.4 DONE):** pillar §0+§2
promoted as `research:trellis/workspace-discipline/code-mediated-text`
(root `0a477d04…779e`, 17 blocks) via stub-park + the real promote CLI;
one paid grounded-authoring run ($0.127) drafted v2; the anchor gate
REFUSED the three-doc assembly at 18/64 = 0.28 (measured: the evidence
doc's distinctive anchors are numerals the template forbids a draft
from restating — with them excluded the draft sits at exactly 0.30);
the owner re-scoped the pinned corpus to the two NORMATIVE docs per the
gate's documented remedy (same draft: 32/64 = 0.50) and the envelope
landed by zero-paid `--draft` replay. The swap kept the module name and
title, set `version: 2` (test:modules [5] pin moved wittingly, plus a
new pin that the "reconstructing stored text" mitigation line stays
retired), pinned `research.sourceNodeIds` to the 31 driver-pinned
blocks, and preserved v1's laundering-correction history verbatim in
`RESEARCH.md`; re-registered live (ON MATCH refresh, `moduleVersion` 2,
uncontested). The gate finding is roadmap §4 row 3 (anchor-gate
calibration — a future reviewed kernel change; the corpus-choice remedy
worked, so it does not block). Total Session 21 paid spend: $0.859.

Session 22 (July 11, 2026, PR #60) is also complete: **the
effective-context probe round 2 + the answer-channel fix** (roadmap §4
row 2; owner-directed July 10, 2026). **(1) The answer-channel fix
(FIRST, tooling shape per pillar §2.8):** `src/rlm/trellis_answer.py` —
a `TrellisAnswer` holder injected as `trellis_answer` in EVERY research
run (kernel surface; author mode does not carry it, pinned).
`submit(expression_text)` evaluates the given Python expression TEXT in
the calling REPL frame (`sys._getframe`; globals AND locals, under the
caller's rlms safe builtins so the channel widens nothing), refuses
bare literals structurally (`ast.parse`: no
Name/Attribute/Subscript/Call ⇒ the retyped-literal class), refuses
`None` and over-cap content (kernel constants 400 chars / 64 KiB),
renders deterministically (str verbatim; int exact; float repr;
containers compact JSON), prefixes `FINAL_ANSWER: ` engine-side, and
mutates the LIVE `answer` binding read from the caller frame each call
(scaffold-restore-safe). ADDITIVE: direct `answer['content']`
assignment still works, `TRELLIS_RESULT` unchanged, telemetry gains
counts-only `answer_submits`. The kernel prompt teaches the channel
(TOOLS item 3, TURN DISCIPLINE, the final-answer workflow rule), so
BOTH composed-prompt pins moved wittingly with recorded history:
default `170e9f7e…67e9` → `9f09d7d2…dd68`; omit-arm `abb945a6…f9b2` →
`9779b5c0…9e45` — the omit arm is NO LONGER the historical
pre-Session-20 bytes; it is now purely structural (default minus
exactly `CODE_MEDIATED_TEXT_BLOCK`, re-proven structurally by
`test:modules` [7]). Regression: `npm run test:answer-channel` (32
checks) reproduces the 55→47 class in the REAL rlms LocalREPL.
`trellis_answer.py` joined `python:check` and the Dockerfile.
**(2) Round-2 corpora:** `data/synthetic_chronicle.txt` (committed;
seeded deterministic generator `synthetic_corpus.ts`, mulberry32, ASCII;
293,411 bytes ≈ 73k tokens; sha256 `b56f6d32…f1e6` pinned + generator
byte-equality + `.gitattributes -text`; 48 "Entry N" sections, one
planted unique anomaly sentence per entry) ingested as
`book:synthetic:ninth-circuit-chronicle` (root `f0ffaf20…7c23`, 827
blocks) — quote/locate answers CANNOT come from parametric memory; and
40 generated shipping ledgers (2,209 records, one canonical record
shape, concat sha pinned) ingested as `ledger:synthetic:house-01…40`.
Defect found live at ingest: the AST reconstruction glues paragraph
blocks with unmarked boundaries, so `parseLedgerRecords` is SHAPE-based
(global regex), never line-based (unit-pinned). Ground truth stays
computed from bytes (`splitSectionsBy`/`sectionContainingBy`/
`extractAnswerSectionBy`/`replaceUniqueLine` joined `ground_truth.ts`).
**(3) The measured round 2** (57 paid runs, $2.1509 total; estimates
printed, ≤$5 cumulative abort armed, none hit; report round-2 section):
the transcription channel is CLOSED in practice (57/57 runs answered
via `trellis_answer.submit`; every computed value landed digit-exact;
the round-1 55→47 question came back 55 in BOTH arms; zero
transcription errors in 56 scored runs vs 1-in-12 in round 1);
read-fidelity isolated and held (8/8 unmemorized anomaly quotes
byte-faithful at ~10k median input tokens vs a 73k-token corpus); the
edit round-trip is 8/8 byte-exact (first paid drive of the Session 20
toolkit — DB text and computed counts moved into files by code); the
pandas null result (0/68 round-2 runs imported pandas, even for
40-document aggregation — plain loops stayed correct and cheap; the §7
DataFrame threshold sits above this scale); the round-1 arm effect did
NOT reproduce (on/off medians indistinguishable per suite, no attention
blowups — the strengthened tooling shape carries the discipline on
these task shapes); every round-2 miss (3/56) is LOCALIZATION-method
error over the glued reconstruction (line-anchored heading regexes; two
loud sentinels "Entry None"/"Entry ?", one plausible TOC-anchored
"Chapter 23") — recorded, not patched mid-measurement. A `led-top-port`
grader defect (demanded the literal "Port " prefix) was fixed and the
four affected rows re-scored, disclosed in the report. **Also observed:**
one `drill:scale` run read the migration gate OPEN (sweep-latency
growth 11.61x) and the immediate re-run read 1.48x CLOSED — a
non-reproducing outlier on the shared dev database (most plausibly
planner-statistics drift after the day's bulk ingests), recorded in the
roadmap; the gate stands CLOSED and the do-not-migrate-on-noise
doctrine held.

**Session 23 (July 11, 2026, PR #61) is also complete: the
effective-context probe round 3** (roadmap §4 row 3; owner-directed
July 11, 2026 over extraction, which held at row 4).
**(1) The relational corpus** (pillar §7's regime; a generated
multi-table corpus chosen over a live `repo:ingest` snapshot because a
repository's cross-file joins are not computable from bytes by pure
helpers and a snapshot drill must tombstone where this corpus stays
durable): `src/benchmarks/effective_context/relational_corpus.ts` —
seeded (mulberry32, ASCII, concat sha256 `3bbbea18…a697` unit-pinned;
583,128 bytes ≈ 146k tokens), 102 documents: 100 season-two ledgers
(`ledger:synthetic:s2-house-001…100`, 6,859 records in round 2's exact
record shape), one captain registry (`registry:synthetic:captains`, 36
captains → 8 guilds, round-robin balanced — an rng assignment skewed
one guild into topping EVERY aggregate; fixed at design time), one
tariff schedule (`tariff:synthetic:port-schedule`, 108 (port, material)
pairs). Shape-based parsers (`parseRegistryRecords`/
`parseTariffRecords`) + tie-refusing join truths (`buildGuildIndex`/
`buildTariffIndex`/`topGuildForMaterial`/`tariffIntoPort`/
`totalTariffByGuild`/`topGuildByTariff`/`guildProfile`); all ingested
zero-paid (extraction `none`), byte-exact Python read-back, re-ingest
the auditable no-op; durable in dev PG (~293 documents total now).
**(2) The probe script round 3** (`exp_effective_context.ts`): new
`relational` suite (4 join questions incl. the multi-part
answer-channel stress `rel-guild-profile`), `usedPolars` scanned, two
new chronicle locate anomalies (Entries 24/37), per-run
localization-method classification (`classifyLocalizationMethod`), the
`--ingest` boundary quantification, and the disclosure fix (the
chronicle/ledger preambles now carry the frank "paragraph boundaries
are unmarked; line breaks inside paragraphs are preserved" clause
verbatim). Boundary quantification unit-pinned
(`boundaryPreservedReconstruction`/`lineAnchoredHeadingLabels`):
line-anchored heading visibility over glued reconstruction = chronicle
0/48 (the glued chronicle is ONE line), frank 26 ALL-misleading TOC
labels ending at "Chapter 23"; boundary-preserved = 48/48 and 56.
NO kernel change: both composed-prompt pins unmoved.
**(3) The measured round 3** (87 paid runs, $3.6260 total; estimates
printed, ≤$5 cumulative abort armed per invocation, none hit; report
round-3 section): the pandas null result PERSISTS at 3.1× scale with
genuine joins (0/87 runs imported pandas or polars; plain dict loops
answered all 17 relational join runs digit-exact at ~8.7k median input
tokens vs a ~146k-token corpus — the structured-frame threshold sits
above one-record-shape corpora of this size; movers recorded: schema
heterogeneity, fuzzy joins, long interactive sessions); the
localization class reproduced at rate (7/30 locate misses, ALL method
error, none transcription — five loud sentinels + two plausible
"Chapter 23"; recovering runs paid 13k–27k input tokens; the
disclosure clause was IN the preamble, so prompt disclosure measurably
does NOT retire the class); a SECOND representation trap found live:
gluing destroys trailing word boundaries (`\d+\b` cannot match a
heading digit glued to the next block's first letter — the exact
"Chapter 23" mechanism of both rounds, unit-pinned); the
load-bearing claims moved toward settled (87/87 submits, zero
transcription errors — cumulative 144/144 over rounds 2–3; 20/20
quote runs byte-faithful at n=5/arm/question; multi-part stress 5/5);
one NEW miss shape upstream of the channel (a run assumed
`get_ast_texts` returns a list, counted over the fallback empty
string, and submitted the computed 0 in the SAME response block —
result-shape mishandling + same-turn submit, faithfully delivered);
the arm effect stayed in the tail (medians indistinguishable; the
round's single near-corpus attention pass, 84,829 input tokens through
one `llm_query`, happened in the OFF arm; zero in 47 on-arm runs).
**The RECOMMENDATION was recorded and then re-pointed the same day**
(§0 event-loop rule): round 3 first recommended a boundary-preserving
`get_ast_texts`/`nodeText` reconstruction (which repairs all 10
cross-round misses but moves every pinned reconstruction truth), and
the owner instead chose the ADDITIVE `get_ast_blocks` accessor — same
repair, no reconstruction bytes moved — as the Session 24 objective
(§3 below). Classifier defect fixed mid-session (anchored alternations
like `^(Letter|Chapter)` initially classified as shape; report tables
re-classified from saved logs with the committed classifier,
disclosed). This session's `drill:scale` read 1.84x CLOSED — inside
the recorded band; no outlier.

**Session 24 (July 11, 2026, PR #62) is also complete: the
boundary-aware block accessor (`get_ast_blocks`) + the
structure-selection demotion** (roadmap §4 row 4; the post-round-3
re-point). **(1) The accessor (the localization fix, tooling shape per
pillar §2.8):** `TrellisPostgres.get_ast_blocks(root_hash)`
(`src/rlm/trellis_tools.py`) fetches the root's `data` JSONB once and
returns the document's extraction blocks IN DOCUMENT ORDER as a JSON
list of `{id, type, text}` — the block set exactly
`collectExtractionBlocks`'s, the text exactly `nodeText`'s, the ids
the same citable hashes `get_ast_texts` already exposes. The walk
lives in the NEW dependency-free `src/rlm/trellis_blocks.py`
(stdlib-only BY DESIGN: CI runs `npm test` before installing the
Python runtime, so the cross-language parity test
`src/core/ast/block_parity.test.ts` — which spawns the real Python
walk against real parser output, markdown/unstructured/code-aware
trees — could not import `trellis_tools`; `_node_text` moved there
verbatim and is re-exported under its historical name). The accessor
counts a database tool call, joins the citation-audit read set,
refuses non-string and unknown hashes loudly, exposes no new citable
ids; NO stored or reconstructed byte moved (the round-3
reconstruction-byte recommendation is SUPERSEDED, roadmap-struck).
`trellis_blocks.py` joined `python:check` and the Dockerfile COPY set
(`package.json` untouched — the `npm ci` layer stayed cached).
**(2) The kernel prompt teaches it** (one brace-free TOOLS line under
`trellis_postgres`), so BOTH composed-prompt pins moved wittingly with
recorded history: default `9f09d7d2…dd68` → `3f07295a…4b63`; omit-arm
`9779b5c0…9e45` → `85362b81…71bb` (still purely structural: default
minus exactly `CODE_MEDIATED_TEXT_BLOCK`, re-proven by `test:modules`
[7]). **(3) The round-4 probe machinery (zero-paid):**
`classifyLocalizationMethod` gained the `structured` verdict — the
marker is the CALL (`get_ast_blocks(` WITH the open paren) because
`trellis_agent.py` echoes the query into the run log and the locate
preambles now OFFER the accessor paren-free (`BLOCKS_OFFER`, scoped to
locate questions so every other question's bytes stay
round-comparable); offering the tool can never classify as using it
(unit-pinned both ways). `--ingest` now verifies the accessor
round-trip live: frank 796 ordered blocks / chronicle 827,
byte-identical to `collectExtractionBlocks`+`nodeText`, sampled text
byte-matching `get_ast_texts` (re-ingest stayed the auditable no-op).
**(4) The §7 demotion (docs-only):** pillar §7's "pandas is the
default for relational/multi-file queries" is DEMOTED to "plain loops
until a measured threshold" per §7's own written contingency (round
3's 0/87 was the continued null; round 2 was 0/68); the
micro-benchmark table, the mechanism claim, and the kernel's
"ingestion = pandas" metaphor are untouched; pillar §6 gained item 6
(the accessor) and the round-3 close-out; the probe report gained its
round-4 section. **(5) The localization re-measure (probe round 4) was proposed with
its estimate, OWNER-APPROVED, and MEASURED the same day** ($0.9452 /
36 runs vs the ≈$1.6 estimate; the round-3 locate set: chronicle ×4 +
frank ×2 questions, `--repeats 3`, both arms): **0/36 misses vs round
3's 7/30 on the same questions, with 36/36 runs in BOTH arms calling
`get_ast_blocks`** (classified `structured`; zero
line-anchored/shape/unknown); the round-3 "Chapter 23" trap question
came back "Chapter 5" 6/6; median input ~8.2k tokens (on 8,229 / off
8,264), median 2 iterations, no recovery loops (round 3's recovering
runs paid 13k–27k); 36/36 submitted through `trellis_answer` (180/180
across rounds 2–4, zero transcription errors). The off arm's
identical adoption is the pillar's enforcement thesis measured again:
tooling shape, not the §6.2 block, carries the behavior. The
pre-stated success criterion is met exactly; the superseded
reconstruction-byte row STAYS closed (§0 event-loop re-check ran: a
positive result re-opens nothing). Total Session 24 paid spend:
$0.9452. This session's `drill:scale` read 2.11x CLOSED — inside the
recorded band.

**Session 25 (July 11, 2026, PR #63) is also complete: the
repository-scale extraction prerequisites** (roadmap §4 row 5 — the
July 6, 2026 pilot's three recorded blockers turned into machinery,
all zero-paid). **(1) The test/fixture extraction exclusion:**
`isTestOrFixturePath` (`src/core/repository/paths.ts`) — pure,
kernel-fixed, case-insensitive: test/fixture directory segments
(`__tests__`/`__mocks__`/`__fixtures__`/`test`/`tests`/`fixtures`/
`testdata`) at any non-final depth, `*.test.*`/`*.spec.*` basenames,
`conftest.py`, and a `test_*`/`*_test` STEM rule under ANY extension
(deliberately wider than the recorded Python conventions: this
repository's own `scripts/test_*.ts` drills carry seeded fixture
strings — the exact recorded contamination class; asymmetry is safe
because a wrongly excluded file merely skips extraction). Applied
where `snapshot_ingest.ts` selects per-file extraction policy: a
classified file under `--extract changed` is forced to `none` while
still scanning/parsing/ingesting/versioning/tombstoning exactly as
before (snapshot completeness is load-bearing). Reported as typed
counts DISTINCT from scan skips (`PlannedFile.extractionExclusion`,
plan/result `extractionExclusionCounts` +
`blocksExcludedFromExtraction` counted over to-ingest files — the
paid bound's own population; the bound itself is now post-exclusion),
echoed by the CLI before `--confirm-extraction`
(`test_fixture_excluded=N; still ingested, never queued`), recorded
in the published snapshot summary, and counted label-bounded as
`trellis_repo_blocks_total{stage="test_fixture_excluded"}`.
**(2) Source-kind prompt routing:** the extraction job payload gained
OPTIONAL additive `sourceKind: 'code' | 'prose'` + `language`
(`IngestJobContext`, threaded from `IngestRequest`); the single
producer `ingestDocument` stamps every queued job — repository
snapshots map file language (`sourceKindForLanguage`: ts/js/py →
`code`; markdown/text → `prose`), every other caller (API `/ingest`,
promotion, probe corpora) defaults to `prose` at the enqueue. The
worker side is the NEW pure `src/workers/extraction_job.ts` (the
`workspace_scratch.ts` mold): `parseExtractionJobData` refuses unknown
sourceKind/language LOUDLY before any I/O or paid call;
`buildExtractionPrompt` composes the EXACT legacy bytes for absent
sourceKind AND for `prose` (unit-pinned in `extraction_job.test.ts` —
anything already queued processes byte-identically) and a NEW
code-tuned prompt for `code` (API-level facts, qualified names as
written, an explicit bare-generic ban, extreme sparsity). Same
`GraphSchema`/`zodResponseFormat`/`parseLlmResponse` — the contract
did not move, and NEITHER composed-prompt pin moved (extraction
prompts live in the worker, not the rlms kernel).
**(3) Deterministic generic-identifier suppression:**
`suppressGenericIdentifiers` (`src/core/graph/generic_suppression.ts`)
runs after `parseLlmResponse` and BEFORE `resolveExtractedGraph`, for
BOTH prompts: drops entities whose trimmed-lowercased name is in the
22-entry kernel denylist (`entity`, `entities`, `name`, `id`, `ids`,
`action`, `actions`, `data`, `value`, `values`, `key`, `keys`,
`type`, `types`, `item`, `items`, `index`, `object`, `string`,
`number`, `result`, `results`) or shorter than 3 chars, every action
touching a dropped entity, AND — one recorded deliberate widening —
every action whose UNRESOLVED endpoint id itself fails the name test
(resolve passes unresolved ids through as names, so `subjectId:
"entity"` with no local entity would MATCH a pre-existing `entity`
hub at merge; genuinely named unresolved endpoints still pass — that
path is a feature). Itemized, never silent: counts-only
`trellis_extraction_suppressed_total{kind}` + the bounded
`extraction.generic_suppressed` log event (entity names in content
per the dropped-action precedent). Suppression drops extraction
CANDIDATES — it never deletes existing graph nodes. The division of
labor is unit-pinned: `globex corporation --[acquired]-> initech`
PASSES the filter (fixture contamination is owned by the path
exclusion, not the name gate). **(4) Acceptance:** `npm test` 712/77
(baseline 683/75); `test:repo-ingest` extended 45 → 56 with Part 6 —
a changed-mode snapshot over an edited source + edited test file with
the extraction queue captured in memory: the test file re-ingested to
version 2 (IN the snapshot) with ZERO jobs, exactly the source file's
new function block enqueued carrying `sourceKind: 'code'` /
`language: 'typescript'`, nothing touched Redis; full standing drill
block green; `drill:scale` 1.99x pre-pilot and 2.01x post-pilot
re-run, both CLOSED (in-band); Compose
integration 10/10 as `trellis_s25_ci`. REPOSITORY_INGESTION_REPORT
gained §5a. **(5) The pilot RE-RUN was proposed with its estimate
(103 blocks ≈ $0.29 from the zero-write `--dry-run`), approved under
the session's standing owner approval of paid/owner-gated tests, and
MEASURED the same day** (report §5b): 103/103 jobs, zero failures;
suppression live (14 events, 18 entities + 23 actions — completions
still emitted `Entity` despite the prompt ban; the gate enforced it
every time); 237 entities / 243 relationships vs the July 6 pilot's
340/318 from 112 blocks; **top entity `ast_nodes` at 4 sources vs
`entity` at 14 — max hub cardinality 3.5× lower**, top-15 all genuine
API-level identifiers, ZERO denylist names with pilot provenance
(live-queried); `globex`/`initech` byte-unchanged (fixture blocks
never enqueued); residual recorded not acted on
(`concept`/`kind`/`generic` at 3 sources — first observed counts for
future denylist candidates). Spend 55,891 in / 40,545 out + 20,543
embedding tokens ≈ **$0.28** (under estimate; output 13.5% leaner —
the sparser code prompt). Cleanup: tombstone snapshot #2, sweep ran,
all 521 pilot-provenance entities (incl. July-6 residue via shared
content-addressed hashes) contested, zero uncontested. NO defect
surfaced — nothing jumps the queue. Total Session 25 paid spend:
≈$0.28.

**Session 26 (July 11, 2026, PR #64, stacked on PR #63) is also
complete: the Trellis-edits-Trellis proof runs + module #2** (the
adjudication session — the owner approved BOTH standing proposals
in-session, delegating the edit targets and the module topic).
**(1) The proof-run series** (six spawns ≈$0.58 under its $1 cap;
`TRELLIS_EDIT_ROOT` at this branch checkout, every diff human-reviewed
before acceptance, the toolkit never touched git): three edits landed
— the GLOSSARY Capability Flywheel status DB-grounded from
`module:workspace-discipline`.moduleVersion int-rendered in code (run
1c, after run 1's instruction-ambiguity rejection at review and run
1b's honest CRLF no-write); API_REFERENCE.md "all five queues" → "all
seven queues" + a correctly formatted 4-line docs/README.md
benchmarks-index entry for the probe report in ONE two-file run (2b);
and the "deeper" run 3 — a graph-aggregation edit building its
replacement phrase entirely in code from ALL `module_manifest`
entities ("2 modules live (estimation-discipline v1,
workspace-discipline v2)"), updating the very line run 1c wrote.
**THE FLYWHEEL RESULT: run 2 FOUND A REAL KERNEL DEFECT** —
`trellis_textedit.splice` refused "\r" alongside "\n", making CRLF
files IMPOSSIBLE to line-replace (the replacement must carry the
trailing "\r" to keep bytes verbatim, contradicting the toolkit's own
documented CRLF-verbatim behavior); reproduced zero-paid, FIXED
(refuse only "\n", the frame delimiter), regression-pinned
(`test:textedit` 81 → 82). No pinned check asserted the old behavior.
**(2) Module #2: `estimation-discipline`** — topic chosen from the
briefing's behavioral candidate list ("when is an answer good enough
to stop searching"; "mechanical provenance threading" was NOT chosen —
the briefing records it as a candidate ARCHITECTURE session, plumbing
not prompt). Corpus: two operator-authored docs (every evidence number
verified against its committed report), promoted as
`research:trellis/estimation-discipline/contract` (root
`9f5c46bc…8b62`, 11 blocks) + `…/evidence` (root `f6fa47e4…b4fa`, 8
blocks); the paid authoring run cost **$0.122** (est. $0.53 printed;
36,442 in / 3,047 out), the anchor gate PASSED first try at 21/58 =
0.36, the harness pinned all 19 corpus hashes, and the module is
registered live (`module:estimation-discipline`, uncontested) but NOT
in the default selection — both composed-prompt pins unmoved; per the
briefing's rule it stays out until the positive control (designed in
its RESEARCH.md; measurement owner-gated) measures a real effect.
Total Session 26 paid spend ≈$0.70.

**Owner-directed follow-on work (July 11, 2026, its own PR after
Session 26) is also complete: the wall-clock engine benchmark + the
Trellis-edits-Trellis EXPANSION series** (owner set a 2-million-token
FLOOR for synthetic tests going forward and granted the series a $20
paid cap). (1) `scripts/bench_wallclock_text.py` (zero-paid,
deterministic, cross-engine equality asserted) measured Python native
vs polars at ~100k–8M tokens: insertion (the splice shape) stays
Python-native at EVERY size (16.9x→2.6x, no crossover); disambiguation
(extract/normalize/group) is polars territory from ~100k tokens up
(~14x at the 2M baseline); regex scanning polars 19x–27x. Report:
`docs/benchmarks/WALL_CLOCK_TEXT_OPS_REPORT.md`; pillar §7 carries an
engine-side postscript; the §7 model-behavior demotion stands. (2) The
expansion series (four spawns ≈$0.35 total, every diff human-reviewed):
W1 docs/README.md index entry for the new report (CRLF preserved); W2
the pillar §7 postscript with every value extracted from the report BY
CODE; W3 **the recorded depth increment — the first RLM SOURCE-CODE
edit** (`scripts/check_python_runtime.py` PYTHON_FILES gains the bench
script; `python:check` green); W4 an adversarial containment probe
(out-of-root append demanded; both the `..` and rooted-path refusals
held LIVE, zero writes, honest refusal report by reference). No kernel
change anywhere; both composed-prompt pins unmoved.

**Session 27 (July 11, 2026, PR #67) is also complete: the
data-plane representation verdict recorded and its prerequisites
pinned** (roadmap §4 row 6a — the July 11 owner-commissioned
Polars/Arrow review's three adopted recommendations plus the
recommendation-5 doctrine line, all zero-paid; the review's verdict:
NO migration at any of the six data-plane boundaries — JSON/list/dict
contracts stand everywhere; structure selection is operation-shaped,
not size-shaped). **(1) The polars pin:** `polars==1.34.0` joined
`requirements.txt` (comment: engine-side analytics tier, pinned NOT
adopted — no kernel, contract, or prompt path imports it) and the
`python:check` import list (the pandas precedent: a broken environment
fails the check, not a paid run); the Compose integration gained an
in-container `import polars` probe asserting the exact pinned version
(10 → 11 assertions) — the found prose-vs-manifest inconsistency is
closed and `bench_wallclock_text.py` is now runnable in-container.
**(2) The pillar §7 verdict paragraph** (docs-only, both
composed-prompt pins unmoved): contracts stay JSON at every boundary;
Option C rejected by the §4.5 data-not-objects doctrine, Option B
unjustified at the 4–32 MiB caps, canonical JSON byte-deterministic
where Arrow IPC is not; plus the cap-raise doctrine — approach the
32 MiB cap ⇒ re-run the M1 drill at the target size BEFORE raising
caps; a migration re-enters only through the review's benchmark
matrix and adoption thresholds with owner sign-off. **(3) M1/M7
standing fixtures:** `test:rlm-workspace` sections [7]/[8] (86 → 106
checks, pure stdlib): M1 park/seed round-trips byte-lossless at
EXACTLY 4 MiB / 32 MiB / 1024 segments with cap+1 refusals
(consistent-stamp one-byte growth ⇒ byte-budget raise; synthetic
1025th segment ⇒ segment-budget raise; timings PRINTED never
asserted — 32 MiB parks in ~84 ms); M7 per-field torn-payload
refusals (non-string content, non-bool truncated, missing argsHash,
non-string fetchedAt — extending, not duplicating, section [6]'s
small-size pins), torn/wrong-version re-proven at the 4 MiB cap size,
and the canonical-form determinism pin (parse + re-serialize
byte-identical) at all three cap shapes. The probe report was
verified to carry NO container-availability claim, so it was left
untouched per §4(d)'s verify-first instruction. No defect found.
Compose ran isolated as `trellis_s27_ci` (pip layer rebuilt as
predicted, npm layers cached); `drill:scale` 1.99x CLOSED (in-band).
Zero paid spend.

**Session 28 (July 11, 2026, this PR) is also complete: the
estimation-discipline positive control — machinery AND the measured
control** (roadmap §4 row 6; the measurement ran the same day under
the session's standing owner approval of paid/owner-gated tests).
**(1) The probe module-arm flag** (`TRELLIS_EXP_MODULES`, the
`TRELLIS_EXP_OMIT_CMT` mold): the new pure
`src/benchmarks/effective_context/module_arm.ts` resolves it in the
probe runner ONLY — unset composes the byte-identical historical
spawn value `'["spatial-flywheel"]'` (pinned); a JSON array REPLACES
the spawned agent's `TRELLIS_MODULES`, validated through the ORDINARY
`parseModuleSelection` + `loadModules` registry path BEFORE any spawn
(malformed JSON / unknown / contested modules refuse the invocation
spawn-free, verified live). `armEnv` deletes the flag from the child
env; `buildAgentEnv` deletes it unconditionally (no config field —
unit-pinned mirroring `TRELLIS_EXP_OMIT_CMT`). NO kernel change; both
composed-prompt pins unmoved. **(2) The `est` suite** (additive —
every earlier suite's question bytes untouched, rounds 1–4 stay
round-comparable; shared preambles extracted byte-identically): five
sufficiency-bounded TWO-PART questions whose parts share ONE read,
over the four durable corpora; truths + recorded minimal-evidence
bounds (1 db call each) in the pure
`src/benchmarks/effective_context/estimation_suite.ts`, unit-pinned
from committed bytes (Kelvorin 163/Torulf 125; anomaly 8 → Entry 9;
frank → Chapter 5/Ingolstadt 16; Zelvane Wendrick × morrowleaf →
1046/13; Glasswind → 41,793 crates/4 captains; scored-pair
distinctness enforced loudly). `test_modules.py` gained section [8]
(post-retirement: pins the loader REFUSING the retired module #2, the
historical manifest record, and the parse-vs-load distinction). **(3) The measured control:
50 runs, $2.3981 (vs the ~$1–2 estimate, disclosed), 10 chunked
question×arm invocations, `--repeats 5`, both arms the pinned default
kernel. Correctness 25/25 BOTH arms; median db calls on 1 vs off 2
(the targeted behavior moved — frank median halved 4 → 2,
minimal-evidence attainment 15/25 vs 10/25); pooled median input
tokens on 13,240 vs off 9,217 — the token half of the pre-stated
criterion FAILS pooled, REVERSING on the two largest-corpus questions
(led-captain 13,268 vs 19,335; rel-guild 23,033 vs 29,287). Verdict
per the recorded rule: criterion NOT met — and the owner ADJUDICATED
in-session the same day: module #2 RETIRED outright (manifest status
`retired`, loader refuses composition — `test:modules` [8] pins the
refusal; the graph entity survives as the historical record), with
the broader direction that behavioral failure classes close by
TOOLING SHAPE, not prompt modules — prompt-module authoring is
DEPRIORITIZED as a capability increment, and the recorded successors
are kernel-level retrieval dedup/budgets (the `est` suite is their
acceptance harness) and mechanical provenance threading (roadmap §5
July 11 addendum)** (report: the probe report's control section;
RESEARCH.md measurement + retirement sections). All 50 runs submitted through `trellis_answer`
(230/230 cumulative, zero transcription errors); zero pandas/polars.
Defect found by the zero-paid drill in this session's own new code
before any spend: the est branch never assigned `relationalData` and
an `&&`-guard silently emptied the question set — fixed, and the
guard now refuses loudly. `drill:scale` read 2.65x CLOSED (outside
the ~1.48x–2.26x band → re-run per precedent → 1.77x CLOSED in-band,
non-reproducing). Compose isolated as `trellis_s28_ci`: 11/11, all
layers cached. Total Session 28 paid spend: $2.3981.

OpenCnid selected the MIT License on July 6, 2026.

Your objective is **Session 29: self-editing toolkit coverage
hardening** (roadmap §4 row 8 — the first actionable row: row 6 stays
open ONLY on the owner's module-candidacy decision, which no session
can self-serve, and row 7 stays trigger-blocked; priority order
recorded in the roadmap's July 11, 2026 coverage-audit entry), per
§3–§6 below. All of it is zero-paid. Do not re-plan or re-implement
completed work. RLM expands exclusively to Recursive Language Model
(the MIT CSAIL formulation).

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
   - Durable measurement substrate (Sessions 21–23):
     `data/frankenstein.txt` and `data/synthetic_chronicle.txt`
     (committed, byte-stability unit-pinned, `.gitattributes -text`) are
     ingested as `book:gutenberg-84:frankenstein` and
     `book:synthetic:ninth-circuit-chronicle`; the 40 deterministic
     ledgers (`src/benchmarks/effective_context/synthetic_corpus.ts`,
     seeded generator, concat sha unit-pinned) as
     `ledger:synthetic:house-01…40`; and the Session 23 relational
     corpus (`relational_corpus.ts`, seeded, concat sha `3bbbea18…a697`
     unit-pinned) as `ledger:synthetic:s2-house-001…100` +
     `registry:synthetic:captains` + `tariff:synthetic:port-schedule`
     (all extraction `none`, no embeddings) — the effective-context
     probe's corpora, deliberately NOT drill residue. The three promoted
     research docs
     `research:trellis/workspace-discipline/{contract,evidence,code-mediated-text}`
     are module #1's corpus documents. NOTE (measured Sessions 22–23):
     the root-hash reconstruction (`nodeText`/`get_ast_texts`)
     concatenates paragraph blocks with UNMARKED boundaries — it breaks
     BOTH line-anchored parsing AND trailing word boundaries (`\d+\b`
     fails at glued digit→letter junctions); parse by shape without
     trailing `\b` (the `parseLedgerRecords` precedent). Session 24
     fixed the localization class structurally WITHOUT touching those
     bytes: `get_ast_blocks(root_hash)` returns the ordered blocks
     directly, so structure never has to be re-derived from the glue —
     measured (probe round 4): 0/36 misses vs round 3's 7/30, 36/36
     accessor adoption. The reconstruction-byte change is SUPERSEDED
     and stays closed (it re-enters only if a future measurement finds
     the accessor insufficient).
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
   - **Extraction (Sessions 1/8/25):**
     `src/workers/extraction_worker.ts` consumes `extraction_queue` jobs
     `{astNodeId, text, sourceKind?, language?, ...}` enqueued by the
     verified ingest path when the operator selected extraction policy
     `changed`: pure payload parsing (`parseExtractionJobData` in
     `src/workers/extraction_job.ts` — unknown sourceKind/language
     refused loudly BEFORE any I/O; absent field = legacy) → liveness
     gate → one completion with the routed prompt
     (`buildExtractionPrompt`: `code` selects the Session 25 code-tuned
     API-level prompt; `prose`/absent compose the EXACT legacy
     document-generic bytes, unit-pinned; `GraphSchema` via
     `zodResponseFormat`, crossing `parseLlmResponse`) →
     `suppressGenericIdentifiers` (Session 25,
     `src/core/graph/generic_suppression.ts`: kernel denylist +
     length-<3 shape rule + touched-relationship and
     generic-unresolved-endpoint drops, counted in
     `trellis_extraction_suppressed_total{kind}` and logged, never
     silent; drops CANDIDATES only, never graph nodes) →
     `resolveExtractedGraph` →
     `mergeWithAstLivenessFence(mergeExtractedGraph)` (ON MATCH mirrors
     the quarantine/recovery semantics; dropped actions are counted and
     logged, never silent) → per-block embedding. Repository snapshots
     stamp sourceKind per file language (`sourceKindForLanguage` in
     `snapshot_ingest.ts`) and force policy `none` for
     `isTestOrFixturePath`-classified files (ingest everything, extract
     selectively — typed `test_fixture_excluded` counts in the plan
     echo, the summary, and metrics). Extraction spend is
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
     (`get_ast_texts`, `get_ast_blocks` — Session 24, a document's
     extraction blocks in order as `{id, type, text}`, the walk in the
     dependency-free `trellis_blocks.py` parity-pinned against
     `collectExtractionBlocks`/`nodeText` by `block_parity.test.ts` —
     `vector_search`, and `ast_hashes_exist` — write-path plumbing,
     never tool-call-counted), `trellis_answer`
     (Session 22 — see the next bullet), and — only when the
     operator configured servers — `trellis_mcp`
     (`src/rlm/trellis_mcp.py`), an MCP client over the pinned
     `mcp==1.12.4` speaking protocol revision 2025-06-18: allowlist
     BEFORE any I/O, double-bounded per-call timeouts,
     `TRELLIS_MCP_TRUNCATED` size caps, credential scrubbing
     (`_scrub`/`_describe_exception`), one transport-aware seam
     (`_dial`). PROVENANCE SPLIT: database tools increment
     `_count_tool_call()`; MCP calls count separately as `mcp_calls` —
     an answer with zero DATABASE tool calls emits
     `TRELLIS_PROTOCOL_VIOLATION` no matter how many MCP, workspace,
     textedit, or answer-channel operations happened.
   - **The by-reference answer channel (Session 22;
     `src/rlm/trellis_answer.py`):** `TrellisAnswer` injected as
     `trellis_answer` in EVERY research run — kernel surface, not
     operator-gated (author mode does NOT carry it; its draft envelope
     is a different contract). `submit(expression_text)` takes the TEXT
     of a Python expression, evaluates it in the calling REPL frame
     (`sys._getframe(1)` — globals AND locals, so nested helpers
     resolve; the caller's `__builtins__` are rlms' safe table, so the
     expression can do nothing REPL code cannot), structurally refuses
     bare literals (`ast.parse`: an expression with no
     Name/Attribute/Subscript/Call is a retyped literal — the exact
     55→47 error class — refused with a teaching message), refuses
     `None` results and over-cap expressions/content (kernel constants
     `ANSWER_EXPRESSION_MAX_CHARS` 400 / `ANSWER_CONTENT_MAX_CHARS`
     64 KiB), renders deterministically (str verbatim, int exact, float
     shortest repr, containers compact JSON), prefixes `FINAL_ANSWER: `
     engine-side, and sets `answer['content']`/`answer['ready']` on the
     LIVE binding read from the caller frame at each call (rlms
     scaffold restore may replace the answer object between turns — the
     holder never caches it). ADDITIVE: direct assignment still works;
     `TRELLIS_RESULT` semantics unchanged; telemetry gains counts-only
     `answer_submits` (the Node scanner tolerates unknown fields).
     Errors are LOUD by construction: a typo'd variable name is a
     NameError traceback, never a silently wrong digit. Pinned by
     `npm run test:answer-channel` (32 checks, real LocalREPL). Measured
     (probe round 2): 57/57 paid runs answered through the channel with
     zero transcription errors.
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
     over-budget seeds raise before the first turn. The park/seed seam
     is drill-pinned at cap sizes (Session 27, `test:rlm-workspace`
     [7]/[8]: byte-lossless round-trips at exactly 4 MiB / 32 MiB /
     1024 segments, cap+1 refusals, per-field torn-payload refusals,
     canonical-form determinism — parse + re-serialize byte-identical);
     any cap raise re-runs the M1 fixture at the target size FIRST
     (the cap-raise doctrine, pillar §7). Structural
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
     editing toolkit) and §6.2 (the kernel prompt hard-rule block);
     Session 21 measured §6.3 round 1 and landed module #1 v2 (§6.4);
     Session 22 measured §6.3 round 2 and closed the answer channel
     (the last unmediated channel) with `trellis_answer`; Session 23
     measured §6.3 round 3 (the relational corpus, the localization
     arm, higher n); Session 24 closed the localization read boundary
     with `get_ast_blocks` (pillar §6 item 6) and demoted §7's
     "pandas default" per its own contingency; Session 27 recorded
     the data-plane representation verdict in §7's orbit (no
     migration at any boundary — contracts stay JSON everywhere;
     polars pinned in requirements.txt as the engine-side tier, NOT
     adopted; cap raises, not representation changes, are the first
     lever). Measured standing:
     transcription is CLOSED (144/144 rounds-2–3 runs submitted by
     reference, zero retyped-value corruptions); read-fidelity holds
     (28/28 unmemorized quotes byte-faithful); the structured-frame
     threshold sits ABOVE ~6,900 records / three-way joins /
     one-record-shape corpora (the pandas null result, twice — §7 now
     says plain loops until a measured threshold); localization method
     error over the unmarked-boundary reconstruction (10 misses across
     rounds 2–3) is CLOSED by the accessor — round 4 measured 0/36
     misses with 36/36 adoption in both arms, so the superseded
     byte-change row stays closed; and the residual after
     transcription closes is computing faithfully over the WRONG input
     (one round-3 result-shape miss, submitted same-turn before its
     own evidence printed).
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
     + true total); `splice` stages replacements (lists of strings free
     of "\n" — the frame delimiter; a "\r" is an ordinary byte WITHIN a
     line, so CRLF lines replace byte-verbatim — Session 26 fixed the
     validation that refused "\r" and made CRLF files impossible to
     line-replace, found live by the proof run and regression-pinned;
     addresses are transient — re-locate after each splice);
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
     bound-for-bound twins and normalize CRLF→LF. Session 28 added a
     SECOND experiment flag in the `TRELLIS_EXP_OMIT_CMT` mold:
     `TRELLIS_EXP_MODULES` (read ONLY by the effective-context probe
     runner via `src/benchmarks/effective_context/module_arm.ts`)
     REPLACES the probe's spawned `TRELLIS_MODULES` after full
     registry validation before any spawn — unset is byte-identical
     (pinned), and `buildAgentEnv` deletes it unconditionally. The manifest carries
     `research.sourceNodeIds` (format-checked 64-hex; existence-checked
     at REGISTRATION, Session 18) and `status` (`active`/`contested`/
     `retired`; only `active` composes — and only `active` registers).
     The composed default prompt is pinned at
     `COMPOSED_SYSTEM_PROMPT_SHA256 = 3f07295a…4b63` (Session 24: the
     `get_ast_blocks` TOOLS line; the pin constant records its full move
     history in `scripts/test_modules.py` — it moves only with a witting
     kernel change, recomputed in the same commit). The §6.2 block is
     the named constant `CODE_MEDIATED_TEXT_BLOCK` (Session 21), and
     `TRELLIS_EXP_OMIT_CMT=1` (experiment instrumentation ONLY — the
     `TRELLIS_CITATION_*` mold: never set by any default/worker/Compose
     config, `buildAgentEnv` deletes it unconditionally) composes
     exactly that block out (`85362b81…71bb`, pinned by `test:modules`
     [7] — purely structural since Session 22: the default kernel minus
     exactly the block, the structure re-proven on every run; kernel
     bug fixes like the answer channel and the accessor land in BOTH
     arms). Module #1 (`workspace-discipline`) is at version 2
     (Session 21: re-authored through grounded authoring with the
     pillar in its corpus; `test:modules` [5] pins name, title,
     version, and the retired mitigation line). Module #2
     (`estimation-discipline`, Session 26) is RETIRED (owner decision,
     July 11, 2026, on the Session 28 control's numbers: both arms
     25/25 correct, db calls median on 1 vs off 2, but pooled input
     tokens on 13,240 vs off 9,217 — criterion not met). Manifest
     status `retired`; the ordinary loader REFUSES to compose it
     (`test:modules` [8] pins the refusal); the graph entity
     `module:estimation-discipline` survives as the historical record.
     The owner's accompanying direction is PERMANENT: behavioral
     failure classes close by tooling shape, not prompt modules —
     prompt-module authoring is deprioritized as a capability
     increment (no new authoring turn without explicit owner request);
     the recorded successors are kernel-level retrieval dedup/budgets
     and mechanical provenance threading (roadmap §5 July 11
     addendum). The corpus docs and RESEARCH.md stay as measurement
     provenance.
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
     repo:ingest`, live drill `npm run test:repo-ingest` (56 checks —
     Part 6 exercises the Session 25 exclusion + routing under
     `--extract changed` with the queue captured in memory). The
     Session 25 extraction prerequisites live here
     (`paths.ts`/`snapshot_ingest.ts`) and in
     `src/workers/extraction_worker.ts` + `extraction_job.ts` +
     `src/core/graph/generic_suppression.ts`; a repository-scale
     `changed` run is now DESIGNED-safe but still owner-gated per run.
   - Benchmarks: OOLONG v1 saturated baseline; anti-shortcut v2 at
     `data/oolong_pairs_dataset_hard.json`; scale evidence in
     `docs/benchmarks/SCALE_PROVENANCE_REPORT.md` and
     `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md`; the paired-run
     workspace probes in `docs/benchmarks/WORKSPACE_PROBE_REPORT.md`
     and `docs/benchmarks/WORKSPACE_LINEAGE_PROBE_REPORT.md`; the
     provenance-citation A/B eval in
     `docs/benchmarks/PROVENANCE_CITATION_AB_REPORT.md`; the
     effective-context probe (Sessions 21–24, pillar §6.3, rounds 1–4
     measured; plus the Session 28 estimation-discipline module
     control — NOT a round, round numbering untouched)
     in `docs/benchmarks/EFFECTIVE_CONTEXT_PROBE_REPORT.md` over the
     committed `data/frankenstein.txt`, the Session 22 synthetic
     corpora, and the Session 23 relational corpus (the Session 28
     `est` suite reads all four corpora; truths + minimal-evidence
     bounds unit-pinned in `estimation_suite.ts`).
   - The fixture MCP server (`scripts/fixture_mcp_server.py`; stdio and
     Streamable HTTP with an optional required-bearer mode) is the only
     MCP server acceptance ever configures; real web-search servers are
     owner-approved runs with the allowlist printed and `mcp_calls`
     recorded. The containerized tool-server pattern is the
     `mcp-fixture` Compose service (test profile).

## 2. Current baseline

Repository state at handoff creation:

- `master`: the head after the July 11, 2026 Session 28 PR (the
  estimation-discipline control — the PR that carries this file).
  Sessions 25/26/27 (PRs #63/#64/#67), the wall-clock benchmark +
  expansion series (PR #65), and the coverage-audit record (PR #66)
  are all merged. Use `git log -- HANDOFF.md` to confirm this PR
  landed; if it is still unmerged when this session starts, STOP and
  merge it first.
- `modules/workspace-discipline/` is at VERSION 2 (module #1); the dev
  graph carries its registered entity `module:workspace-discipline`
  (`moduleVersion` 2; manifest pins 31 research hashes; the entity's
  live provenance is the audit-preserving union of both versions'
  bases, 41 hashes) and THREE promoted corpus documents
  `research:trellis/workspace-discipline/{contract,evidence,code-mediated-text}`
  (none embedded). The dev PG also durably carries the four probe
  corpora: `book:gutenberg-84:frankenstein` (root `a2f9c97c…4439`, 796
  blocks), `book:synthetic:ninth-circuit-chronicle` (root
  `f0ffaf20…7c23`, 827 blocks), `ledger:synthetic:house-01…40`, and
  the Session 23 relational set `ledger:synthetic:s2-house-001…100` +
  `registry:synthetic:captains` + `tariff:synthetic:port-schedule`
  (roots and diffs stable — re-ingest is the auditable no-op) — ~320
  documents total in `documents` (the Session 25 pilot re-run added
  24 `repo:trellis-graph-pilot-2:*` docs, all tombstoned at version 2
  in cleanup; every pilot-provenance entity in the dev graph reads
  contested — the standard lazy-recovery residue, same as after the
  July 6 pilot; Session 26 added the two promoted
  `research:trellis/estimation-discipline/{contract,evidence}` docs).
  Module #2 (`modules/estimation-discipline/`, version 1) is RETIRED
  (Session 28 owner decision on the measured control; manifest status
  `retired`, loader refuses composition). The graph still carries TWO
  module entities — `module:estimation-discipline` persists as the
  historical record (uncontested, 19 research hashes; `modules:verify`
  reports its manifest status). Roadmap §4 row 6 is STRUCK.
- Session 25 added `src/core/graph/generic_suppression.ts` +
  `generic_suppression.test.ts` (the kernel denylist/shape filter),
  `src/workers/extraction_job.ts` + `extraction_job.test.ts` (payload
  parsing + prompt routing; the legacy prompt bytes are PINNED there —
  moving them is a witting change), `isTestOrFixturePath` in
  `src/core/repository/paths.ts`, the exclusion + `sourceKind`
  threading through `snapshot_ingest.ts`/`ingest_document.ts`/
  `persist.ts` (`IngestJobContext` gained optional
  `sourceKind`/`language`; `ingestDocument` stamps `prose` by default
  — every non-repository caller is markdown prose by construction),
  the reworked `extraction_worker.ts` pipeline (parse → route →
  complete → suppress → resolve → merge), the
  `trellis_extraction_suppressed_total{kind}` counter, the CLI plan
  echo exclusion line, and drill Part 6. NO Python file changed, NO
  kernel prompt change (both composed-prompt pins unmoved: default
  `3f07295a…4b63`, omit-arm `85362b81…71bb` — recompute BOTH in the
  same commit only if the kernel prompt or rubric legitimately
  changes). `package.json` was NOT touched (the Docker `npm ci` layer
  stayed cached). `TRELLIS_EXP_OMIT_CMT` remains experiment
  instrumentation with NO `.env.example` entry. Reminder from Session
  24: `block_parity.test.ts` SPAWNS the real Python walk inside plain
  `npm test` (interpreter from `PYTHON_EXECUTABLE` or the platform
  default) — a machine without Python on PATH will fail the unit
  suite; CI sets up Python 3.13 before `npm test`.
- Session 26 changed exactly one kernel file:
  `src/rlm/trellis_textedit.py` (the splice validation refuses only
  "\n" now — the "\r" refusal made CRLF files impossible to
  line-replace; found live by the proof run, reproduced zero-paid,
  regression-pinned). `scripts/test_textedit.py` gained the CRLF
  line-replace check (81 → 82). The three proof-run doc edits
  (docs/GLOSSARY.md, API_REFERENCE.md, docs/README.md) were AUTHORED
  BY THE RLM through the toolkit and human-reviewed —
  the first model-authored bytes to land in this repository.
  `modules/estimation-discipline/` is new (manifest + addendum +
  RESEARCH.md incl. the positive-control design). `package.json`
  untouched.
- Session 27 changed NO kernel Python and NO src/ TypeScript: it added
  the `polars==1.34.0` pin to `requirements.txt` (which invalidates
  the Docker pip layer — the image was rebuilt and verified this
  session), the `polars` import to
  `scripts/check_python_runtime.py`, the in-container polars probe to
  `scripts/test_compose_roundtrip.ts` (11 assertions now), drill
  sections [7]/[8] to `scripts/test_rlm_workspace.py` (86 → 106), and
  the §7 verdict paragraph to
  `docs/architecture/CODE_MEDIATED_TEXT.md`. Both composed-prompt
  pins unmoved (default `3f07295a…4b63`, omit-arm `85362b81…71bb` —
  recompute BOTH in the same commit only if the kernel prompt or
  rubric legitimately changes). `package.json` untouched.
- Session 28 changed NO kernel Python and NO kernel prompt: it added
  `src/benchmarks/effective_context/module_arm.ts` + test (the
  `TRELLIS_EXP_MODULES` flag — probe-runner-only, registry-validated
  before any spawn, byte-identical unset, `buildAgentEnv`-stripped),
  `estimation_suite.ts` + test (the est truths + minimal-evidence
  bounds, pinned from committed bytes), the `est` suite +
  preamble-extraction + flag threading in
  `scripts/exp_effective_context.ts` (existing suites' question bytes
  unchanged), the `buildAgentEnv` delete + pin in
  `src/workers/rlm_job.ts`/`.test.ts`, and `test_modules.py` section
  [8]. Both composed-prompt pins unmoved; `package.json` and
  `requirements.txt` untouched (all Docker layers stayed cached).
  Like `TRELLIS_EXP_OMIT_CMT`, `TRELLIS_EXP_MODULES` has NO
  `.env.example` entry — experiment instrumentation only.
- Offline baseline: `npm test` = 728 passing across 79 files
  (712/77 + Session 28's 16 across 2 new files).
- `npm run build` and `npm run python:check` pass (the check now
  imports polars — an environment without it fails the check by
  design).
- `npm run drill:scale`: gate CLOSED at max provenance 286. Session 28
  first read 2.65x — OUTSIDE the recorded ~1.48x–2.26x band — and the
  precedent re-run read 1.77x CLOSED (in-band; non-reproducing, most
  plausibly same-day drill traffic on the shared dev database).
  Session 27 read 1.99x, Session 26 1.78x, Session 25 1.99x/2.01x.
  If a future run reads OPEN, re-run before believing it — and if it
  REPRODUCES, that is the recorded migration trigger (roadmap §4
  conditional-migration row) and the owner adjudicates. The drill
  rewrites the tracked `scale_drill_results.json` — commit it with the
  session PR (house practice; the committed copy is Session 28's
  1.77x CLOSED run).
- Live zero-LLM checks (Session 28 observed, all green):
  `test:answer-channel` (32), `test:modules` (green with section [8]
  — the loader refuses the retired module #2; pins unmoved),
  `test:textedit` (82), `test:module-lifecycle`
  (60), `test:promotion` (41), `test:rlm-workspace` (106),
  `test:rlm-mcp` (86), `test:rlm-sandbox` (21),
  `test:agent-loop` (35 / ALL CHECKS PASSED), `test:a2a` (46),
  `test:repo-ingest` (56), `test:benchmark-hardening` (24),
  `test:entity-resolution` (34), `test:api-hardening` (18),
  `test:belief-recovery` (30), `test:invalidation-sweep` (17). The
  effective-context probe's plan mode was additionally verified in
  all three flag states (unset / valid override / refusals).
- Isolated Compose integration: 11 assertions (`--profile test`,
  unique project name, host ports 0 via `TRELLIS_*_HOST_PORT=0`;
  includes the containerized credentialed MCP fixture probe and — new
  this session — the in-container `polars 1.34.0` import probe).
  Session 28 ran it as project `trellis_s28_ci` (all 11 PASS; every
  image layer stayed cached — no manifest changed) and tore it down
  with `--volumes`. NOTE: the
  machine's C: drive runs close to full and a FULL image rebuild needs
  several GB of headroom (~21 GB free at Session 28's close; the pip
  layer alone rebuilt fine in that envelope). Changing `package.json`
  invalidates the Docker `npm ci` layer; changing `requirements.txt`
  invalidates the pip layer.
- CI target is Node 22. Session 28's local environment was Node
  20.19.2, Python 3.13.1, Docker Compose v2, PostgreSQL 16.14,
  Neo4j 5.11.
- Python runtime deps are pinned in `requirements.txt` (`rlms==0.1.3`,
  `openai`, `neo4j`, `psycopg2-binary`, `unstructured`, `mcp==1.12.4`,
  and — Session 27 — `polars==1.34.0`, the engine-side analytics tier:
  pinned NOT adopted, no kernel/contract/prompt path imports it);
  `npm run python:check` verifies syntax/imports/assets — including
  `trellis_textedit.py`, `trellis_answer.py`, `trellis_blocks.py`, the
  `pandas` import (pillar-load-bearing; installed transitively via
  `unstructured`), and the `polars` import (same rationale: a broken
  environment must fail the check, not a paid run). Version facts,
  reconciled by the July 11 data-plane review: local dev measured
  pandas 2.2.3 / pyarrow 24.0.0 / polars 1.34.0; the Docker image
  carries `pandas==3.0.3` (pinned in requirements-pdf-fast.txt) and
  now polars 1.34.0 (proven by the Compose probe). Pillar §7's
  structure guidance stands at "plain loops until a measured
  threshold".
- The `documents.origin` column ships in the idempotent bootstrap; run
  `npm run db:init:dev` (or restart a container) once against a
  pre-Session-17 database before using `npm run promote`.
- Raw probe run logs live under `benchmark_logs/` (gitignored — local
  only; the numbers live in the committed report).
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

## 3. Session 29 problem statement

**Self-editing toolkit coverage hardening (roadmap §4 row 8 — the
first unstruck actionable row; all zero-paid).** Row 6 is STRUCK
(module #2 retired by owner decision, July 11 — see the roadmap §5
addendum), row 7 stays trigger-blocked. Two owner-endorsed successor
directions are recorded and PENDING OWNER SCHEDULING (do not
self-serve; propose ordering if the owner has not slotted them by
session start): kernel-level retrieval dedup/budgets, and mechanical
provenance threading — both tooling-shape sessions per the owner's
July 11 direction. If the owner schedules either ahead of row 8, that
displaces this objective.

The July 11, 2026 owner-commissioned Trellis-edits-Trellis coverage
audit (roadmap §5 entry of that date — read it in full before
designing) mapped the editing toolkit's eleven stated guarantees
against the 82-check `test:textedit` drill and found ten gaps, none of
which weakens an existing safeguard. The recorded priority order:

1. **#7 (High, cheap): `npm run test:textedit` is not wired into CI.**
   The `offline` CI job already installs the Python runtime before
   `npm test`; the drill needs no database or network. Zero marginal
   cost, closes the largest regression-detection gap.
2. **#2 (High): TOCTOU window in `write_back`.** The digest re-check
   and the atomic `os.replace` are not one operation; a second writer
   landing between them is silently overwritten, not detected.
3. **#3 (High): containment is verified at `load()` only.** A
   parent-directory symlink/junction swapped in after load is not
   re-caught at `write_back()` — the OS resolves the stored absolute
   path fresh at write time.
4. **#4 (High): `write_back` drops the original file mode** on POSIX
   (`tempfile.mkstemp` + `os.replace` replaces the inode — the
   executable bit on a script or git hook vanishes on every edit).
5. **#5/#6 (Medium): multi-file partial-failure semantics unpinned;
   no mutation coverage for the guard code** (containment refusals,
   digest guard, budget checks).

Items #8–#10 (static no-git-import guard, content-borne prompt
injection, orphaned temp files) are hygiene — include only if cheap.

## 4. Required design

- **(a) CI wiring first (its own commit).** Add `npm run
  test:textedit` to `.github/workflows/ci.yml`'s `offline` job AFTER
  the Python-runtime install step (the drill spawns the real Python
  toolkit; `python:check` already proves the interpreter). No new
  tests; the 82 checks become regression-detected.
- **(b) `write_back` hardening (kernel change — witting, its own
  commit, regression-pinned in `test:textedit`).** Close #2/#3/#4
  INSIDE the existing contract: `StaleFileError` semantics, temp +
  rename atomicity, and the Session 26 splice semantics (refuse only
  "\n") must not move. Recommended shape: (i) re-run the containment
  check (resolve-then-commonpath, the load-time code path reused —
  never a second implementation) against the CURRENT resolved path
  before writing; (ii) preserve `st_mode` from the pre-write stat
  onto the temp file before `os.replace` (`os.chmod` on the temp fd;
  Windows no-ops harmlessly); (iii) narrow the TOCTOU window
  honestly: full elimination needs OS file locking, which is out of
  scope — hold the source open across hash-check and replace where
  the platform allows, and DOCUMENT the residual window in the
  docstring + audit entry rather than claiming closure (report
  honestly, Guardrail 8). Each fix gets a dedicated refusal/behavior
  check in `scripts/test_textedit.py` (82 → N, counted).
- **(c) Semantics pins (#5) and guard mutation coverage (#6).** Pin
  multi-file partial failure (file A written, file B refused —
  intentional, per-file independence) as explicit drill checks. For
  #6, prefer targeted adversarial checks over a mutation-test
  framework: for each guard branch (containment, digest, budgets,
  newline validation), one check that would FAIL if the branch were
  deleted — the cheap 80% of mutation coverage with zero new
  dependencies.
- **What does NOT change:** the toolkit's operator gating
  (`TRELLIS_EDIT_ROOT` only), the byte-identical-when-unset pins, the
  splice "\n"-only refusal, `StaleFileError` on digest mismatch, the
  kernel prompt and both composed-prompt pins (`3f07295a…4b63` /
  `85362b81…71bb`), the module registry, module #2's RETIRED status
  and historical record, the est suite and its truths, every probe
  suite's question bytes, and the four durable corpora. Git stays OUT
  of the toolkit.

## 5. File-level starting points

Inspect before editing:

- The roadmap §5 coverage-audit entry (July 11, 2026) — the gap
  matrix and priority order of record.
- `src/rlm/trellis_textedit.py` — `write_back` (the digest re-check,
  mkstemp, `os.replace`), the containment helpers (`load`-time
  resolve-then-commonpath), the budget checks.
- `scripts/test_textedit.py` — the 82-check drill this session
  extends; its check-count discipline (print counted PASS lines).
- `.github/workflows/ci.yml` — the `offline` job (Python runtime
  install already precedes `npm test`).
- `docs/architecture/CODE_MEDIATED_TEXT.md` §6.1 — the toolkit's
  stated guarantees (the docstring/documentation home for the
  residual-TOCTOU honesty note).
- `scripts/test_rlm_sandbox.py` / `textedit_bounds.test.ts` — where
  the Zod/Python bound twins are pinned today.

## 6. Test strategy and acceptance

Everything this session is zero-paid.

Offline (joins `npm test`, baseline 728 across 79 files):

- Any new pure helpers get unit tests; existing unit pins
  (`textedit_bounds.test.ts`, `rlm_job.test.ts`) stay green.

Live zero-paid:

- `npm run test:textedit` grows from 82 checks: mode preservation
  across `write_back` (POSIX-meaningful; assert not-regressed on
  Windows), write-time containment re-verification (symlink swap
  refused), second-writer detection within the narrowed window where
  testable, multi-file partial-failure pins, and the per-guard-branch
  adversarial checks.
- CI: the workflow change is proven by the PR's own CI run — the
  `offline` job must show the drill executing and passing.
- The full standing drill block (below) stays green
  (`test:rlm-workspace` 106, `test:modules` with section [8], both
  composed-prompt pins unmoved).

Required close-out (the standing block):

```
 npm test
 npm run build
 npm run python:check
 docker compose --profile test config --quiet
 # Run the isolated zero-LLM Compose integration (unique project name).
 npm run test:answer-channel
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
  counts, and defects found; strike §4 row 8 items as they close
  (the row may take more than one session — record what landed).
- `HANDOFF.md`: regenerate per §0 — including the §0 step 5 re-check.
  NOTE for objective selection: rows 6/6a are struck; row 7 stays
  trigger-blocked. The two owner-endorsed tooling-shape directions
  (retrieval dedup/budgets; mechanical provenance threading — roadmap
  §5 July 11 addendum) are pending owner scheduling and outrank any
  new prompt-module work permanently. The standing owner-conditional
  items are the next proof-run depth increment (the narrower
  single-failure-mode run defined in the coverage-audit entry — NOTE:
  it pairs naturally with row 8's #4 executable-bit fix), the pandas
  head-to-head probe round, and a broader-root extraction run — all
  propose-with-estimate, never self-served.

## 7. Guardrails

1. Never mutate an AST. The T13 hash preimage is pinned;
   `rederiveAstNodeId` stays authoritative; nothing positional is ever
   persisted as identity.
2. Never merge, rename, or delete Entity nodes. Equivalence stays an
   overlay belief; module entities are contested or retired, never
   deleted. Suppression DROPS extraction candidates before they become
   entities — it never deletes existing graph nodes.
3. Preserve provenance on every semantic node and edge.
   `write_derived_insight` keeps its Session 14 enforcement; extraction
   writes keep flowing through `mergeWithAstLivenessFence`.
4. Paid work this session is ZERO — row 8 is coverage hardening, and
   any owner-conditional paid run (proof-run depth increment, probe
   rounds) is propose-with-estimate under the standing ≤$5/run cap,
   actuals recorded in the roadmap. Never reward citation count
   anywhere — and never reward LOW tool-call counts either (the
   Session 28 control reported calls and correctness TOGETHER for
   exactly this reason; the citation-count lesson, inverted).
5. Gate machinery is kernel; operator control is absolute. The Session
   25 extraction invariants join the permanent list: the test/fixture
   patterns, the generic-identifier denylist, and both extraction
   prompts are kernel-fixed — never env-tunable free text (an operator
   exclusion override, if ever needed, is a future explicit CLI flag
   with its own confirmation). The Session 20 textedit invariants, the
   Session 19 authoring gates (as calibrated in Session 21), the
   Session 22 answer-channel invariants (structural literal refusal;
   caller-frame evaluation under the REPL's own builtins; the additive
   contract), the Session 24 accessor invariants (the block walk
   stays parity-pinned to `collectExtractionBlocks`/`nodeText`;
   `trellis_blocks.py` stays stdlib-only — the parity test runs before
   the Python runtime is installed in CI), the Session 26 splice
   semantics (refuse only "\n", the frame delimiter — CRLF lines
   replace byte-verbatim, regression-pinned in `test:textedit`), and
   the Session 27 data-plane invariants (the M1/M7 fixtures stay
   standing sections of `test:rlm-workspace`; the cap-raise doctrine —
   M1 at the target size BEFORE any cap raise; polars stays pinned,
   never imported by any src/ path) are permanent.
   `TRELLIS_EXP_OMIT_CMT` and `TRELLIS_EXP_MODULES` (Session 28) stay
   experiment-only: off by default, byte-identical unset (pinned),
   never set by any default/worker/Compose config, never forwarded by
   `buildAgentEnv` — and the module-arm flag is validated against the
   module registry before any spawn, permanently.
6. Every external interaction is bounded; suppression and exclusion
   report COUNTS, never silently vanish work; over-budget operations
   raise with usage. Drill timings are printed telemetry, never
   assertions (the Session 27 M1 precedent — CI variance).
7. Validate at every boundary: every worker-consumed completion crosses
   `parseLlmResponse`; new job fields are OPTIONAL and bounded with
   byte-identical legacy behavior pinned; `AGENT_ORACLE_ENABLED` and
   `TRELLIS_A2A_ENABLED` defaults stay pinned false.
8. Report honestly: publish counts and raw numbers; a surprising or
   null result is a finding. The Session 22 scale-gate outlier
   precedent applies: a gate reading outside the recorded band gets a
   re-run before it gets believed — and a REPRODUCING open reading is
   the migration trigger, escalated to the owner, never silently
   absorbed.
9. Do not break existing consumers: the composed-prompt pins
   (`3f07295a…4b63` default / `85362b81…71bb` omit-arm, `test:modules`
   [4]/[7]) do NOT move this session (row 8 touches the toolkit and
   its drill, never the kernel prompt; module #2 is RETIRED — the
   loader refuses it, pinned);
   module #1's pins hold; the legacy extraction-job payload (no
   `sourceKind`) and the `prose` payload both process with the exact
   pinned legacy prompt bytes (`extraction_job.test.ts`);
   `TRELLIS_RESULT`/`TRELLIS_TELEMETRY` semantics are additive only;
   the API, A2A, and SSE contracts are untouched; the
   `get_ast_texts`/`nodeText` reconstruction bytes do not change (the
   byte-change row is SUPERSEDED by `get_ast_blocks`, confirmed by the
   round-4 re-measure, and re-enters only if a future measurement
   finds the accessor insufficient — with owner sign-off).
10. Respect the rlms prompt contract: extend `RLM_SYSTEM_PROMPT`, never
    replace it; no literal curly braces in anything rlms formats; no
    rlms library modifications.
11. Follow the T16 observability house style: file paths, prompts, and
    extraction text never become metric label values; dropped-item
    counts are label-bounded; entity names may appear in log CONTENT
    per the dropped-action precedent.
12. Keep API and worker processes split; project-scoped Compose
    commands; drills clean up token-scoped temp state only — the four
    probe corpora (`book:gutenberg-84:frankenstein`,
    `book:synthetic:ninth-circuit-chronicle`,
    `ledger:synthetic:house-*`, and the relational
    `ledger:synthetic:s2-house-*`/`registry:synthetic:captains`/
    `tariff:synthetic:port-schedule`) and the promoted research docs
    stay durable.
13. Ship one feature branch and one PR to `master`, plain engineering
    prose, no AI attribution or generated-by trailers. Regenerate this
    file in the same PR — and re-run the §0 step 5 check before
    handing off.
14. Code-mediated text is doctrine (permanent; survives every rewrite).
    Any new or modified surface where the RLM touches text must follow
    `docs/architecture/CODE_MEDIATED_TEXT.md`: locations
    engine-computed, bytes moved by code, transient frames,
    hash-guarded writes, answers submitted by reference
    (`trellis_answer`), block structure read from the engine
    (`get_ast_blocks`) — never model-estimated positions, never
    model-retyped existing bytes, never a persistent in-memory mirror
    of a store. Prompt text may reinforce the discipline but never
    substitutes for tooling shape.

## 8. Explicit exclusions

Do not include: un-retiring module #2 or authoring ANY new protocol
module (prompt-module authoring is deprioritized by owner direction,
July 11, 2026 — a new authoring turn happens only on explicit owner
request); re-running or extending the Session 28 control (its numbers
are recorded and adjudicated); editing module #2's addendum or
research content (the directory is measurement provenance now);
starting the retrieval-dedup or provenance-threading implementation
without the owner slotting it (recorded directions, pending
scheduling — propose, don't self-serve); running the cross-process
concurrency proof
run (coverage-audit gap #1) or any proof-run depth increment without
owner approval — propose with estimates; OS-level file locking or any
claim of full TOCTOU closure (narrow and DOCUMENT the residual window
honestly instead); weakening `StaleFileError`, the splice
"\n"-only refusal, or any textedit gating/containment/hash-guard pin
while hardening around them; ANY data-plane representation migration
at ANY boundary (the Session 27-recorded verdict: JSON/list/dict
contracts stand; a migration re-enters only through the review's
benchmark matrix and adoption thresholds — roadmap §5 July 11 review
entry — with owner sign-off); importing polars in any `src/` path,
kernel surface, or prompt (pinned in requirements.txt is NOT adoption
— polars stays engine-side, future, owner-gated); raising any
workspace/scratch/textedit cap without first re-running the M1
fixture at the target size (the cap-raise doctrine, pillar §7);
asserting on wall-clock timings in any drill; re-running the
extraction pilot or widening the generic-identifier denylist /
test-fixture patterns without observed counts; changing
`get_ast_texts`/`nodeText` block-boundary semantics (SUPERSEDED by
the Session 24 `get_ast_blocks` accessor and CONFIRMED closed by the
round-4 re-measure — re-enters only if a future measurement finds the
accessor insufficient, and then as a witting kernel change with owner
sign-off); a fifth effective-context probe round (the §7
structured-frame movers and the pandas head-to-head stay future
owner-picked rounds, propose with estimates); embedding any probe
corpus; weakening or toggling the §6.2 kernel block outside the
`TRELLIS_EXP_OMIT_CMT` experiment flag; setting `TRELLIS_EXP_MODULES`
anywhere but a probe invocation's own environment; moving the
composed-prompt pins; new MCP servers or transports; A2A changes;
frontend work (deferred unscheduled);
`ASTRef`/`EVIDENCED_BY` migration (gate CLOSED; Sessions 23–28 read
1.84x, 2.11x, 1.99x–2.01x, 1.78x, 1.99x, and 1.77x-after-outlier,
inside the band — do not migrate on a noisy reading); T13 re-hashing;
rlms library modifications; weakening the Session 14 write-path
enforcement, the Session 15/20/22/24 composition pins, the Session 16
lineage pins, the Session 17 promotion refusals, the Session 18
registration gates, the Session 19 authoring-mode / anchor-gate /
draft-scanner / template pins (as calibrated in Session 21), the
Session 20 textedit gating/containment/hash-guard pins (as corrected
in Session 26: the splice refuses only "\n"), the Session 22
answer-channel refusals, the Session 24 block-walk parity pin, the
Session 25 extraction gates (exclusion patterns, denylist, pinned
legacy prompt bytes, the loud payload boundary), the Session 27 M1/M7
standing fixtures, or the Session 28 module-arm validation (registry
before any spawn) and est-suite truth pins.
