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

Session 22 (July 11, 2026, this PR) is also complete: **the
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

OpenCnid selected the MIT License on July 6, 2026.

Your objective is **Session 23: the effective-context probe, round 3**
(roadmap §4 row 3; owner-directed July 11, 2026 to precede the
repository-scale extraction prerequisites, which move to row 4), per
§3–§6 below. Round 2 proved the transcription channel closed and
read-fidelity holds, but left the pillar's headline §7 payoff unproven
(structured frames earning their keep at scale — round 2's pandas null
result) and surfaced a concrete localization/representation question
(all three round-2 misses were line-anchored regexes failing over the
unmarked-boundary reconstruction). Round 3 closes those threads with a
genuine repo-scale corpus, a localization arm, higher n, and the
recorded question-design fixes. Do not re-plan or re-implement
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
   - Durable measurement substrate (Sessions 21/22): `data/frankenstein.txt`
     and `data/synthetic_chronicle.txt` (committed, byte-stability
     unit-pinned, `.gitattributes -text`) are ingested as
     `book:gutenberg-84:frankenstein` and
     `book:synthetic:ninth-circuit-chronicle`, and the 40 deterministic
     ledgers (`src/benchmarks/effective_context/synthetic_corpus.ts`,
     seeded generator, concat sha unit-pinned) as
     `ledger:synthetic:house-01…40` (all extraction `none`, no
     embeddings) — the effective-context probe's corpora, deliberately
     NOT drill residue. The three promoted research docs
     `research:trellis/workspace-discipline/{contract,evidence,code-mediated-text}`
     are module #1's corpus documents. NOTE (measured Session 22): the
     root-hash reconstruction (`nodeText`/`get_ast_texts`) concatenates
     paragraph blocks with UNMARKED boundaries — line-anchored parsing
     over a reconstruction is not representation-invariant; parse by
     shape (the `parseLedgerRecords` precedent). Whether the
     reconstruction should preserve block boundaries is an open kernel
     question (it would move every pinned reconstruction truth — witting
     or not at all).
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
     write-path plumbing, never tool-call-counted), `trellis_answer`
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
     editing toolkit) and §6.2 (the kernel prompt hard-rule block);
     Session 21 measured §6.3 round 1 and landed module #1 v2 (§6.4);
     Session 22 measured §6.3 round 2 and closed the answer channel
     (the last unmediated channel) with `trellis_answer`. Measured
     standing: transcription is closed in practice; the residual
     failure class is LOCALIZATION method error over the
     unmarked-boundary reconstruction (3/56 round-2 runs), and the
     regime where structured frames beat plain loops remains
     unmeasured (the pandas null result at 40 documents).
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
     The composed default prompt is pinned at
     `COMPOSED_SYSTEM_PROMPT_SHA256 = 9f09d7d2…dd68` (Session 22: the
     answer-channel revision; the pin constant records its full move
     history in `scripts/test_modules.py` — it moves only with a witting
     kernel change, recomputed in the same commit). The §6.2 block is
     the named constant `CODE_MEDIATED_TEXT_BLOCK` (Session 21), and
     `TRELLIS_EXP_OMIT_CMT=1` (experiment instrumentation ONLY — the
     `TRELLIS_CITATION_*` mold: never set by any default/worker/Compose
     config, `buildAgentEnv` deletes it unconditionally) composes
     exactly that block out (`9779b5c0…9e45`, pinned by `test:modules`
     [7] — through Session 21 this equaled the pre-Session-20 kernel
     byte-for-byte; since Session 22 it is purely structural: the
     default kernel minus exactly the block, the structure re-proven on
     every run). Module #1 (`workspace-discipline`) is at version 2
     (Session 21: re-authored through grounded authoring with the
     pillar in its corpus; `test:modules` [5] pins name, title,
     version, and the retired mitigation line).
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
     repo:ingest`, live drill `npm run test:repo-ingest`. The Session 23
     probe's repo-scale arm (§3) uses `repo:ingest` to build a genuine
     multi-file corpus; the roadmap row-4 extraction prerequisites also
     live HERE and in `src/workers/extraction_worker.ts`.
   - Benchmarks: OOLONG v1 saturated baseline; anti-shortcut v2 at
     `data/oolong_pairs_dataset_hard.json`; scale evidence in
     `docs/benchmarks/SCALE_PROVENANCE_REPORT.md` and
     `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md`; the paired-run
     workspace probes in `docs/benchmarks/WORKSPACE_PROBE_REPORT.md`
     and `docs/benchmarks/WORKSPACE_LINEAGE_PROBE_REPORT.md`; the
     provenance-citation A/B eval in
     `docs/benchmarks/PROVENANCE_CITATION_AB_REPORT.md`; the
     effective-context probe (Sessions 21/22, pillar §6.3, rounds 1 and
     2) in `docs/benchmarks/EFFECTIVE_CONTEXT_PROBE_REPORT.md` over the
     committed `data/frankenstein.txt` and the Session 22 synthetic
     corpora.
   - The fixture MCP server (`scripts/fixture_mcp_server.py`; stdio and
     Streamable HTTP with an optional required-bearer mode) is the only
     MCP server acceptance ever configures; real web-search servers are
     owner-approved runs with the allowlist printed and `mcp_calls`
     recorded. The containerized tool-server pattern is the
     `mcp-fixture` Compose service (test profile).

## 2. Current baseline

Repository state at handoff creation:

- `master`: the head after the July 11, 2026 Session 22 PR (the probe
  round 2 + the answer-channel fix — the PR that carries this file).
  Use `git log -- HANDOFF.md` to confirm the Session 22 PR landed. If
  it is still unmerged when this session starts, STOP and merge it
  first.
- `modules/workspace-discipline/` is at VERSION 2 (module #1); the dev
  graph carries its registered entity `module:workspace-discipline`
  (`moduleVersion` 2; manifest pins 31 research hashes; the entity's
  live provenance is the audit-preserving union of both versions'
  bases, 41 hashes) and THREE promoted corpus documents
  `research:trellis/workspace-discipline/{contract,evidence,code-mediated-text}`
  (none embedded). The dev PG also durably carries the three probe
  corpora: `book:gutenberg-84:frankenstein` (root `a2f9c97c…4439`, 796
  blocks; at version 5 after Session 22's no-op re-ingest checks),
  `book:synthetic:ninth-circuit-chronicle` (root `f0ffaf20…7c23`, 827
  blocks, version 3), and `ledger:synthetic:house-01…40` (versions
  2–3) — ~191 documents total in `documents`. No module #2 exists (its
  paid turn is owner-gated and did not run).
- Session 22 added `src/rlm/trellis_answer.py` (+ its injection in
  `trellis_agent.py`, the kernel prompt revision, `python:check` and
  Dockerfile coverage), `scripts/test_answer_channel.{ts,py}` + the
  `test:answer-channel` npm alias (`package.json` WAS touched — the
  Docker `npm ci` layer rebuilt this session, image round trip green),
  `data/synthetic_chronicle.txt` (+ `.gitattributes -text`),
  `src/benchmarks/effective_context/synthetic_corpus.ts` (+ test),
  the `ground_truth.ts` generalizations, the round-2 probe script
  (suites/repeats/edit arm; still deliberately NO npm alias), and the
  report's round-2 section. `TRELLIS_EXP_OMIT_CMT` remains experiment
  instrumentation with NO `.env.example` entry.
- Offline baseline: `npm test` = 659 passing across 73 files
  (Session 22 added `synthetic_corpus.test.ts` and extended
  `ground_truth.test.ts`).
- `npm run build` and `npm run python:check` pass (`python:check` now
  imports `trellis_answer`).
- `npm run drill:scale`: gate CLOSED at max provenance 286. NOTE
  (Session 22): one run read the gate OPEN at 11.61x sweep-latency
  growth and the immediate re-run read 1.48x CLOSED — a
  non-reproducing outlier on the shared dev database (most plausibly
  planner-statistics drift right after the day's bulk corpus ingests).
  Recorded in the roadmap §5; the run-to-run band including Session 22
  is ~1.48x–2.26x plus that one outlier. If a future run reads OPEN,
  re-run before believing it — and if it REPRODUCES, that is the
  recorded row-4 trigger and the owner adjudicates. The drill rewrites
  the tracked `scale_drill_results.json` — commit it with the session
  PR (house practice; the committed copy is the second, CLOSED run).
- Live zero-LLM checks (Session 22 observed, all green):
  `test:answer-channel` (32, NEW), `test:modules` (51 — BOTH
  composed-prompt pins moved wittingly this session: default
  `9f09d7d2…dd68`, omit-arm `9779b5c0…9e45`; recompute BOTH in the same
  commit only if the kernel prompt or rubric legitimately changes),
  `test:textedit` (81), `test:module-lifecycle` (60), `test:promotion`
  (41), `test:rlm-workspace` (86), `test:rlm-mcp` (86),
  `test:rlm-sandbox` (21), `test:agent-loop` (35 / ALL CHECKS PASSED),
  `test:a2a` (46), `test:repo-ingest` (45), `test:benchmark-hardening`
  (24), `test:entity-resolution` (34), `test:api-hardening` (18),
  `test:belief-recovery` (30), `test:invalidation-sweep` (17).
- Isolated Compose integration: 10 assertions (`--profile test`, unique
  project name, host ports 0 via `TRELLIS_*_HOST_PORT=0`; includes the
  containerized credentialed MCP fixture probe). Session 22 ran it as
  project `trellis_s22_ci` (all 10 PASS, image rebuilt with the new
  `package.json` and shipped `trellis_answer.py`) and tore it down
  with `--volumes`. NOTE: the machine's C: drive runs close to full
  and an image rebuild needs several GB of headroom (~31 GB free at
  Session 22's close). Changing `package.json` invalidates the Docker
  `npm ci` layer, forcing that rebuild.
- CI target is Node 22. Session 22's local environment was Node 20.19.2,
  Python 3.13.1, Docker Compose v2, PostgreSQL 16.14, Neo4j 5.11.
- Python runtime deps are pinned in `requirements.txt` (`rlms==0.1.3`,
  `openai`, `neo4j`, `psycopg2-binary`, `unstructured`, `mcp==1.12.4`);
  `npm run python:check` verifies syntax/imports/assets — including
  `trellis_textedit.py`, `trellis_answer.py`, and the `pandas` import
  (pillar-load-bearing; installed transitively via `unstructured`, so a
  broken environment must fail the check, not a paid run). The agent
  environment carries pandas 2.2.3 / pyarrow 24.0.0 / polars 1.34.0
  (measured; pillar §7).
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

## 3. Session 23 problem statement

**Effective-context probe, round 3 (roadmap §4 row 3; owner-directed
July 11, 2026 over the extraction prerequisites, which drop to row 4).**

Round 2 (`docs/benchmarks/EFFECTIVE_CONTEXT_PROBE_REPORT.md`) settled
the two things it set out to: the transcription channel is closed in
practice (57/57 paid runs answered through `trellis_answer.submit`,
zero transcription errors in 56 scored runs), and read-fidelity is
isolated and holds (8/8 unmemorized anomaly quotes byte-faithful). But
it left three threads open and one recorded question-design gap — and
the pillar's headline §7 payoff is still unproven:

1. **The structured-frame regime is unmeasured (the pillar's §7
   claim).** Round 2 imported pandas in 0 of 68 runs; plain dict/regex
   loops answered a 40-document, 2,209-record aggregation correctly and
   cheaply. That is a NULL result, honestly reported: at ~46k tokens
   across 40 small documents the structure choice does not matter. The
   pillar claims a DataFrame *earns its keep* at genuine relational
   scale — and nothing yet reaches that scale. Until it does, "code
   holds the working set, attention stays small" is proven only at
   book-and-ledger scale, not at the scale the claim is really about.
2. **Localization over the unmarked-boundary reconstruction is the live
   failure class.** Every round-2 miss (3 of 56) was the SAME pathology:
   a line-anchored heading regex (`^Entry \d+$`, `^Chapter \d+$`) over
   the reconstruction that `get_ast_texts` returns, which concatenates
   paragraph blocks with NO blank line between them — so headings that
   sat at real line-starts in the source no longer do. Two produced
   loud sentinels ("Entry None"/"Entry ?"), one a plausible
   TOC-anchored "Chapter 23". This is localization error (the pillar's
   other half) invited by the representation. Whether `get_ast_texts`
   should preserve block boundaries is an open KERNEL question — it
   would move every pinned reconstruction truth, so it is witting or
   not at all.
3. **n is too small for the load-bearing claims.** Round 2 ran n=2 per
   question on the new suites (n=1 on frank). "Transcription closed" and
   "read-fidelity holds" are the claims the pillar now rests on; they
   deserve more runs before they are stated as settled.
4. **A recorded question-design gap.** The round-1 frank preamble
   disclosed "paragraph boundaries are unmarked"; the round-2 chronicle
   and ledger preambles omitted that clause, so the model was scored on
   a representation quirk it was never told about. The corpora are
   byte-pinned and correct; the SCRIPT preambles need the fix.

The objective: close threads 1–3 with new measurement and fix gap 4 —
all machinery zero-paid; the paid runs owner-gated per arm with printed
estimates under the standing ≤$5/run cap. Round 3 does NOT change the
kernel; the block-boundary question is investigated and RECOMMENDED,
never implemented unprompted.

## 4. Required design

Extend `scripts/exp_effective_context.ts` (the round-2 suite/`--repeats`
machinery) and the pure helpers; do not start a new script.

- **(a) A genuine repo-scale / relational arm.** Build a corpus far
  larger and more relational than the 40 small ledgers — the regime
  where a DataFrame could actually pay off. Two viable shapes, pick per
  what stays byte-reproducible and computable:
  - a REAL repository snapshot via the Session 8 `repo:ingest` path
    (many `repo:<key>:<path>` documents; ground truth = a fact that
    requires joining across files, computed from the committed source
    bytes at run time), or
  - a MUCH larger generated relational corpus (the `synthetic_corpus.ts`
    seeded-generator pattern — e.g. hundreds of ledgers, or a
    multi-table shape whose answer needs a join/group-by across
    documents), committed or regenerated deterministically with a
    unit-pinned sha.
  Measure per run: `usedPandas` (already scanned), input tokens through
  attention, correctness, and cost. A DataFrame earning its keep looks
  like: the model reaches for pandas AND stays cheaper/more-correct than
  the plain-loop arm at this scale. A continued null result is a
  finding — report the scale at which it still holds.
- **(b) A localization arm over the glued reconstruction.** Add
  questions whose correct answer requires locating a phrase to its
  section, and score BOTH the answer and (where observable in the run
  log) whether the model localized by shape (code that tolerates the
  glued boundaries) or by a line-anchored heuristic that the
  reconstruction breaks. Then, as a DESIGN FINDING, quantify the fix:
  compute (zero-paid, in the ground-truth helpers) how many round-2 +
  round-3 localization misses would disappear if `get_ast_texts`
  preserved block boundaries (e.g. a marker or a boundary-aware
  reconstruction), and write a RECOMMENDATION in the report. Do not
  change `get_ast_texts`/`nodeText` this session (Guardrail: it moves
  every pinned reconstruction truth — a witting kernel decision with
  owner sign-off, roadmap-tracked if pursued).
- **(c) Higher n with honest spread.** Raise `--repeats` on the claims
  that matter (recommend n≥5 on a focused question subset:
  transcription-sensitive counts and unmemorized quotes) and keep the
  full matrix within the $5 cap by trimming question count, not the
  abort. Report medians WITH min/max (the round-2 spread columns), and
  state the n explicitly. The point is to move "directional" toward
  "settled" on the two load-bearing claims, not to re-run everything.
- **(d) The preamble disclosure fix.** Restore the "paragraph
  boundaries are unmarked; line breaks inside paragraphs are preserved"
  clause (verbatim from the frank preamble) to the chronicle and ledger
  preambles in the script. This is a SCRIPT change; the committed
  corpora and their sha pins do not move. Note it in the report so the
  round-2 vs round-3 localization numbers are read fairly.
- **Optional companion (cheap, folds into existing suites):** keep the
  answer channel under mild stress — a question whose answer is a
  computed multi-part string (e.g. "Port X, N crates" interpolated in
  code) or prose-with-a-number — to confirm `trellis_answer` holds
  beyond round 2's shapes. Round 2 already showed the dict/tuple render
  paths work; this is confirmation, not new machinery.
- **What does NOT change:** the answer channel (`trellis_answer`), the
  editing toolkit, the promotion/authoring/registration gates
  (including the Session 21 anchor-gate fix), the Session 14 write
  path, every bound, the discipline-off flag `TRELLIS_EXP_OMIT_CMT` and
  its byte-identity pins, and the composed-prompt pins (`9f09d7d2…` /
  `9779b5c0…`) — NO kernel prompt change is in scope. The question
  sets and ground-truth logic stay kernel-fixed in the script
  (Guardrail 5), never env-tunable free text.

## 5. File-level starting points

Inspect before editing:

- `scripts/exp_effective_context.ts` — the round-2 suites
  (`frank`/`chronicle`/`ledger`/`edit`), `--repeats`, the spread
  reporting, `usedPandas`, the per-run edit-arm plumbing, the
  representation-invariance asserts, and the preambles to fix (`(d)`).
- `src/benchmarks/effective_context/synthetic_corpus.ts` (+ its test) —
  the seeded generator + `parseLedgerRecords` (shape-based, because the
  reconstruction glues blocks); the pattern to reuse or scale up for
  the repo-scale/relational arm.
- `src/benchmarks/effective_context/ground_truth.ts` (+ its test) —
  the pure computed-truth helpers (`splitSectionsBy`,
  `sectionContainingBy`, `countOccurrences`); add the localization-fix
  quantification and any repo-scale join truth here.
- `scripts/ingest_repository.ts` + `src/core/repository/` (`scanner.ts`,
  `snapshot_ingest.ts`, `paths.ts`) — the `repo:ingest` path if the
  repo-scale arm uses a real snapshot (`repo:<key>:<path>` doc keys).
- `src/rlm/trellis_tools.py` `get_ast_texts` / `src/core/ast/traverse.ts`
  `nodeText` — the reconstruction whose unmarked boundaries cause the
  localization misses (the `(b)` design finding; READ, do not change).
- `docs/benchmarks/EFFECTIVE_CONTEXT_PROBE_REPORT.md` — extend with a
  round-3 section (the pandas-regime result, the localization finding +
  the boundary recommendation, the higher-n numbers); the
  honest-caveats house style.
- `scripts/exp_citation_ab.ts` — the `--repeats` / spend-accounting
  house style, if a knob needs mirroring.

## 6. Test strategy and acceptance

The paid probe arms are owner-gated per run (estimate first, ≤$5/run
cap, actuals reported). Everything else is zero-paid and local.

Offline (joins `npm test`, baseline 659 across 73 files):

- Any new ground-truth helpers (repo-scale join truth, the
  localization-fix quantification) are pure and unit-tested against
  committed or deterministically generated inputs.
- A larger generated corpus (if that shape is chosen) is sha-pinned in
  a unit test exactly like the chronicle/ledgers, with its
  representation invariants asserted.
- No composed-prompt pin moves (no kernel prompt change); `test:modules`
  is untouched by this objective.

Live zero-paid:

- The new corpus ingests through the verified path and reads back
  byte-exact (the round-2 `--ingest` precedent); identical re-ingest is
  the auditable no-op. A repo snapshot arm publishes through
  `repo:ingest` with its zero-paid default.

Paid (owner-approved; estimate first, actuals recorded):

- The round-3 arms (repo-scale/relational, localization, raised
  repeats, the optional answer-channel stress). Abort past the cap.

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
  counts, token/spend actuals per paid run, and defects found; strike
  §4 row 3 only after acceptance.
- `docs/benchmarks/EFFECTIVE_CONTEXT_PROBE_REPORT.md`: the round-3
  numbers, with the pandas-regime result and the localization/boundary
  recommendation called out.
- README: point the benchmarks section at the round-3 results.
- `HANDOFF.md`: regenerate per §0 — including the §0 step 5 re-check.
  With round 3 done, the next first-unstruck row is the
  repository-scale extraction prerequisites (row 4); regenerate §3–§8
  for it (its full concreteness is preserved in this PR's git history —
  the Session 22-authored version named it Session 23; reuse that
  content, re-pointed).

Remaining owner-gated items (do NOT run unprompted; propose each with a
cost estimate):

- The `get_ast_texts` block-boundary change, IF the localization
  finding recommends it — a witting kernel decision (it moves every
  pinned reconstruction truth); roadmap-track it and get owner sign-off
  before touching `get_ast_texts`/`nodeText`.
- The extraction pilot RE-RUN over a repository root with the row-4
  exclusion + suppression + code prompt (once row 4 lands).
- The supervised Trellis-edits-Trellis proof run (operator sets
  `TRELLIS_EDIT_ROOT` at a branch checkout; one small real edit through
  the toolkit; lands as an ordinary reviewed PR).
- The module #2 turn (topic owner-picked, prompt-movable,
  positive-control-testable).

## 7. Guardrails

1. Never mutate an AST. The T13 hash preimage is pinned;
   `rederiveAstNodeId` stays authoritative; nothing positional is ever
   persisted as identity — probe ground truth is computed from
   committed or deterministically generated bytes, never stored as
   positions.
2. Never merge, rename, or delete Entity nodes. Equivalence stays an
   overlay belief; module entities are contested or retired, never
   deleted.
3. Preserve provenance on every semantic node and edge.
   `write_derived_insight` keeps its Session 14 enforcement. The
   probe's runs write no insights as acceptance criteria; if a run
   caches facts, they carry real provenance.
4. Paid work is exactly the owner-approved probe arms, each behind a
   printed pre-flight estimate and the standing ≤$5/run cap, actuals
   recorded. Everything else — corpus assembly, ingestion, the
   localization quantification — is zero-paid. Never reward citation
   count anywhere.
5. Gate machinery is kernel; operator control is absolute. The probe's
   question sets and ground-truth logic are kernel-fixed in the script —
   never env-tunable free text. The Session 20 textedit invariants, the
   Session 19 authoring gates (as calibrated in Session 21), and the
   Session 22 answer-channel invariants (structural literal refusal;
   caller-frame evaluation under the REPL's own builtins; the additive
   contract) are permanent. `TRELLIS_EXP_OMIT_CMT` stays experiment-only:
   off by default, byte-identical unset (pinned), never set by any
   default/worker/Compose config, never forwarded by `buildAgentEnv`.
6. Every external interaction is bounded; corpora are committed or
   deterministically generated and byte-stable; over-budget operations
   raise with usage — never silent truncation.
7. Validate at every boundary: every worker-consumed completion crosses
   `parseLlmResponse`; new job/envelope fields are optional and bounded;
   `AGENT_ORACLE_ENABLED` and `TRELLIS_A2A_ENABLED` defaults stay pinned
   false.
8. Report probes honestly: publish raw numbers, medians, AND spread,
   with the small-n caveat; a surprising or null result is a finding,
   not a reason to re-run until it flatters the pillar. The Session 22
   scale-gate outlier precedent applies to any gate/metric reading
   outside its recorded band: re-run before believing, and a
   REPRODUCING anomaly is escalated to the owner, never silently
   absorbed.
9. Do not break existing consumers: the composed-prompt pins
   (`9f09d7d2…dd68` default / `9779b5c0…9e45` omit-arm, `test:modules`
   [4]/[7]) do NOT move — round 3 changes no kernel prompt; module #1's
   pins hold; `TRELLIS_RESULT`/`TRELLIS_TELEMETRY` semantics are
   additive only; the API, A2A, and SSE contracts are untouched;
   `get_ast_texts`/`nodeText` reconstruction bytes do not change this
   session (the boundary question is a recommendation).
10. Respect the rlms prompt contract: extend `RLM_SYSTEM_PROMPT`, never
    replace it; no literal curly braces in anything rlms formats; no
    rlms library modifications.
11. Follow the T16 observability house style: corpus text, quotes,
    prompts, file paths, and diffs never become metric label values;
    probe artifacts live in the report, not in logs.
12. Keep API and worker processes split; project-scoped Compose
    commands; drills clean up token-scoped temp state only — the three
    round-1/round-2 probe corpora
    (`book:gutenberg-84:frankenstein`, `book:synthetic:ninth-circuit-chronicle`,
    `ledger:synthetic:house-*`) and the promoted research docs stay
    durable; any new committed probe corpus is likewise durable, and a
    real repo snapshot is tombstoned/cleaned per the `repo:ingest`
    drill's own token-scoped discipline.
13. Ship one feature branch and one PR to `master`, plain engineering
    prose, no AI attribution or generated-by trailers. Regenerate this
    file in the same PR — and re-run the §0 step 5 check before handing
    off.
14. Code-mediated text is doctrine (permanent; survives every rewrite).
    Any new or modified surface where the RLM touches text must follow
    `docs/architecture/CODE_MEDIATED_TEXT.md`: locations
    engine-computed, bytes moved by code, transient frames, hash-guarded
    writes, answers submitted by reference (`trellis_answer`) — never
    model-estimated positions, never model-retyped existing bytes,
    never a persistent in-memory mirror of a store. The localization
    arm measures exactly this discipline; prompt text may reinforce it
    but never substitutes for tooling shape.

## 8. Explicit exclusions

Do not include: changing `get_ast_texts`/`nodeText` block-boundary
semantics (the localization finding RECOMMENDS; it is a witting future
kernel decision with owner sign-off — it moves every pinned
reconstruction truth); the repository-scale extraction prerequisites
(now roadmap row 4 — do not start them; the round-3 repo-scale arm may
build corpora/tooling they later reuse, but the exclusion/suppression/
code-prompt work is a separate session); the extraction pilot re-run;
the module #2 turn and the standalone supervised Trellis-edits-Trellis
proof run (owner-gated — propose with estimates only); embedding or
extracting any probe corpus (`--extract none`); weakening or toggling
the §6.2 kernel block outside the `TRELLIS_EXP_OMIT_CMT` experiment
flag; a prompt-text "fix" for any measured failure (it must be tooling
shape); moving the composed-prompt pins (no kernel prompt change is in
scope); new MCP servers or transports; A2A changes; frontend work
(deferred unscheduled); polars adoption (reconsider ONLY if the
round-3 repo-scale arm actually exceeds pandas comfort, pillar §7);
`ASTRef`/`EVIDENCED_BY` migration (gate CLOSED; the Session 22 outlier
did not reproduce — do not migrate on a noisy reading); T13 re-hashing;
rlms library modifications; weakening the Session 14 write-path
enforcement, the Session 15/20/22 composition pins, the Session 16
lineage pins, the Session 17 promotion refusals, the Session 18
registration gates, the Session 19 authoring-mode / anchor-gate /
draft-scanner / template pins (as calibrated in Session 21), the
Session 20 textedit gating/containment/hash-guard pins, or the
Session 22 answer-channel refusals.
