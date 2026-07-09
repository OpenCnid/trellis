# Workspace and Modules — Design Record

*Status: approved design; §11 steps 1–5 implemented (Sessions 14–17,
July 7, 2026; the step-1 paired-run probe and the step-4 two-task
lineage probe are measured — see docs/benchmarks/WORKSPACE_PROBE_REPORT.md
and docs/benchmarks/WORKSPACE_LINEAGE_PROBE_REPORT.md), step 6 open. Origin: the
owner-directed design study of July 7,
2026 (a one-shot session outside the numbered HANDOFF loop). All code claims
verified against `master` at `c3b4c39` (485/485 offline tests) and the
installed `rlms==0.1.3` package source. Nothing described here is
implemented unless a section says otherwise.*

This document is the durable record of two connected designs: the **Tier 3
workspace** (a persistent, harness-managed working memory for the RLM) and the
**module system** (the capability flywheel by which the RLM authors its own
harness extensions through a human-sculpted pathway). It is written to be
self-contained: an implementing session needs no chat transcript, only this
repository. Canonical one-line definitions for every load-bearing term live in
[docs/GLOSSARY.md](../GLOSSARY.md).

**Authority and scope.** This is a design record, not a roadmap change. It does
not renumber sessions, does not alter the recorded sequencing in
`TRELLIS_ROADMAP.md` §4, and does not modify `HANDOFF.md`. Adopting any part of
it as a numbered session is an owner decision recorded in the roadmap when
taken. Every permanent guardrail in `HANDOFF.md` §7 survives this design
unchanged; where this document and a guardrail appear to conflict, the
guardrail wins and this document has a defect.

---

## 1. Governing axioms (canonical — do not let these drift)

- **Axiom 1′ (The RLM).** Trellis is built on a Recursive Language Model (the
  MIT CSAIL formulation — see
  [docs/benchmarks/FLYWHEEL_EXPLAINER.md](../benchmarks/FLYWHEEL_EXPLAINER.md))
  that treats context as data in a REPL namespace, enabling
  recursion-over-variables: the model reaches into large context with code and
  `llm_query` sub-calls over slices, instead of holding it in attention.
- **Axiom 2′ (Graph state).** Semantic beliefs are graph-stored and
  provenance-anchored. Working state (plans, search results, MCP returns) is
  ephemeral, TTL-bounded, and **graph-addressing, never graph-addressed**: it
  points into the verified layers by hash/id, but can never be pointed *at* as
  provenance.
- **Axiom 3′ (Causality of reliability).** Reliability comes from provenance,
  quarantine, and self-correction. That reliability substrate is what
  *licenses* open tools. Search and MCP extend reach and never anchor belief;
  external content earns permanence only through verified ingest (the
  promotion path, §6).
- **Axiom 4″ (The capability flywheel).** The RLM authors modular,
  research-grounded **userspace** extensions of its own harness through the
  human-sculpted update pathway. Modules carry provenance, pass
  class-appropriate gates, compose sparsely, and are governed by the same
  verification discipline that manages beliefs. Humans own the immutable
  kernel; runtime mutation of the running configuration or vessel remains
  strictly forbidden under Guardrail 5.

## 2. The two flywheels and the momentum law

Trellis is governed by cumulative momentum from two interlocking flywheels:

1. **The Knowledge Flywheel (shipped, measured).** Facts are derived once,
   cached with strict provenance (`write_derived_insight`), verified and
   quarantined over their life, and reused forever — collapsing stochastic
   runtime cost into amortized knowledge. See
   [FLYWHEEL_EXPLAINER.md](../benchmarks/FLYWHEEL_EXPLAINER.md) and the
   OOLONG results.
2. **The Capability Flywheel (this design).** Cognitive capabilities are built
   once as modules, landed with provenance, verified over their life, and
   composed forever. Without it, Trellis plateaus at whatever fixed repertoire
   its harness shipped with, and every new task type costs a human engineering
   session — which is exactly what the numbered HANDOFF loop is today. The
   HANDOFF §0 loop is the manual prototype of this flywheel; the design goal
   is to internalize it.

**The ecosystem invariant.** Both flywheels operate in a closed ecosystem
engineered so that added momentum *remains* added momentum: new knowledge
improves the belief database; new modules improve the execution substrate;
every run builds on the accumulated inertia of both.

**The governing condition (the honest ledger).** Momentum is signed.
[CRITIQUE_AND_FUTURE.md](../benchmarks/CRITIQUE_AND_FUTURE.md) records that a
cached error is *confidently wrong forever* — and a defective module is worse:
it is a **generator** of bad facts, systematizing its defect across every run
that composes it. The verification machinery (acceptance gates at birth,
telemetry regression and sampled re-verification in life, quarantine and
retirement at death — §9.4) is therefore not friction on the flywheel; it is
the bearing it spins on, exactly as the provenance requirement is not what
slows the knowledge flywheel but what makes cached facts worth reusing.

## 3. The three-tier trust model

| Tier | Contents | Store | Lifetime | Trust standing |
|---|---|---|---|---|
| **1 — Verified substrate** | Immutable Merkle AST nodes (SHA-256 over `type:content:metadata:childHashes`), document versions, membership | PostgreSQL (`ast_nodes`, `documents`, `document_nodes`) | Permanent | Ground truth: "what the sources say," byte-verified on ingest |
| **2 — Derived belief** | Entities, relationships, `DERIVED_INSIGHT` edges — all carrying `sourceNodeIds` into Tier 1; quarantine/recovery state | Neo4j | Durable, self-correcting | Beliefs with chain of custody; contested when sources die, recovered on re-derivation |
| **3 — Working state** | Plans, notes, search results, MCP returns, cross-task handoffs | REPL workspace (in-run); Redis parking (cross-task, §5) | Ephemeral, TTL-bounded | **None.** Research context only; never provenance |

Tier 3 is the tier this design adds. Today working state is implicit and
broken across processes: REPL scrollback inside one run, the retrospective
`GoalIterationRecord[]` across tasks, nothing structured, nothing durable, and
external tool results evaporate into stdout. The design principle: **Tier 3 is
the intake stage of the trust pipeline, not a memory feature.** Unverified
material is allowed to exist there precisely *because* the tier is ephemeral,
bounded, and origin-labeled — and the only path to permanence is promotion
(§6). Anything that is a *fact worth keeping* belongs in Tier 2 with real
provenance; Tier 3 holds *process*: what we're doing, what we tried, what we
found, where we found it.

## 4. The workspace (Tier 3, in-run) contract

### 4.1 Capture is mechanical, not behavioral

The single biggest failure mode of prompt-convention scratchpads is reliance
on model discipline. Here, capture is guaranteed at the harness layer: the
`trellis_mcp.call_tool` wrapper (and any future external-tool wrapper)
deposits every result into the workspace **inside the tool call, before
returning** — whether or not the model does anything with the return value.

### 4.2 Segments: uuid-delimited, origin-stamped

Each captured result becomes one **segment** with wrapper-stamped metadata the
model never gets to claim for itself:

- `id` — a UUIDv4. Segment identifiers are **structurally disjoint from AST
  hashes** (uuids contain dashes; AST ids match `^[0-9a-f]{64}$`), so a
  Tier 3 identifier can never be shape-confused with Tier 1 provenance.
- `origin` — server name, tool name, and a hash of the arguments.
- `fetchedAt` — ISO-8601 timestamp.
- `bytes`, `truncated` — size and whether the MCP size cap truncated it.
- `goalId` / `taskId` — correlation, when present.
- `content` — the result text (already size-capped by the MCP layer).

Origin stamps extend "provenance proves origin" into the ephemeral tier at
near-zero cost, make the workspace auditable ("the agent believed X because
search Y said so"), and are exactly the metadata promotion (§6) needs. They
cannot be retrofitted later.

### 4.3 Stub returns: thin control channel, fat heap

`call_tool` returns a stub — `{segmentId, bytes, preview}` (preview bounded,
e.g. 500 chars) — instead of the full result. The full content lives only in
the workspace; the model pulls slices deliberately or fans `llm_query` out
over segments. Consequence: the root model's context stays O(plan) while
knowledge grows O(workspace). This is the recursion-over-variables property
(Axiom 1′) applied to external knowledge, and it is what keeps lengthening
horizons affordable. Trade-off accepted: when the model genuinely needs a full
result immediately, it costs one explicit read.

### 4.4 Plan-in-workspace

The workspace holds the agent's plan and self-notes in the same structure as
its evidence — the explicit-todo-list pattern of modern agent harnesses,
placed where the RLM paradigm wants it (in the namespace, not the scrollback).
Illustrative shape (final field names belong to the implementing session):

```
workspace = {
  "version": 1,
  "plan":     [{"id": "s1", "desc": "...", "status": "pending|done|blocked"}],
  "notes":    ["..."],
  "segments": {"<uuid>": {"origin": {...}, "fetchedAt": "...", "bytes": n,
                           "truncated": false, "content": "..."}}
}
```

### 4.5 The data-not-objects contract

The workspace **contract is the plain, JSON-serializable, version-tagged
dict** — never live object graphs, callables, or library types. The injected
holder object (§4.6) is transport; the dict is the interface. This is what
makes cross-task lineage (§5) nearly free, keeps the design portable across
rlms evolution (the library is at 0.1.3 and will change), and forbids nothing
the model needs.

### 4.6 Persistence mechanics (verified against `rlms==0.1.3`)

How this rides the REPL, per direct source reads of
`rlm/environments/local_repl.py` (July 7, 2026):

- `LocalREPL.execute_code` persists `self.locals` across every REPL turn of
  one `rlm.completion()` call; only scaffold names in `RESERVED_TOOL_NAMES`
  (`context`, `answer`, `llm_query`, …) are force-restored each turn. Injected
  `custom_tools` objects live in globals and persist by construction — so the
  workspace holder is injected as a tool-like object (alongside
  `trellis_neo4j` etc.), and the capture hook mutates it from inside wrappers.
  **No rlms modification is needed or permitted.**
- The literal `context` variable is force-restored from `context_0` every
  turn. The workspace must be its own name; it must also not start with `_`
  (underscore-prefixed names are filtered from persistence).
- **Rebind-vs-mutate exception semantics.** On an exception, the merged
  execution namespace is *not* copied back into `self.locals` — so variable
  **rebindings** from a failed block are discarded — but the merge is a
  shallow copy, so **in-place mutations** of existing objects persist even
  when a later line raises. Implications: (1) harness capture, which mutates
  the holder in place inside the wrapper, survives model errors in the same
  block — desirable; (2) model-side state transitions that must be atomic
  should build-new-then-rebind rather than mutate, and the prompt guidance
  says so; (3) a torn in-place update is possible and must be treated as
  benign-and-repairable (the model can re-read and fix), never as trusted
  state.
- Message-history compaction (`RLM(compaction=...)`) exists and Trellis does
  not enable it. Scrollback is therefore lossless at today's small iteration
  budgets; the workspace's value is sub-LLM leverage and capture now, and
  survival under compaction/long horizons later.

### 4.7 Bounds and injection gating

All bounds are Zod-validated configuration with hard maxima, following the
[src/config/mcp_servers.ts](../../src/config/mcp_servers.ts) discipline.
Suggested defaults (final values belong to the implementing session):
max segments per run 128 (cap 1024); max workspace bytes per run 4 MB (cap
32 MB); over-budget writes **raise** a readable error for REPL
self-correction — stored state is never silently truncated (unlike MCP
*results*, where truncation is safe, a torn stored entry would poison later
readers).

**Injection gating (v1 decision):** the workspace object and its prompt
addendum are injected only when at least one MCP server is configured **or**
the run carries a `goalId`. A bare pre-existing run stays byte-identical
(the empty-registry MCP-addendum precedent), pinned by test. Revisit after the
behavioral probe (§11 step 1) if plain runs demonstrably benefit. The
addendum text must be brace-free (the rlms `.format()` contract — see the
comment block at the top of
[src/rlm/trellis_agent.py](../../src/rlm/trellis_agent.py)); schema examples
in prompt text use `dict(...)` constructor syntax, the addendum's existing
idiom.

### 4.8 Telemetry and provenance posture

Workspace operations never increment the database tool-call counter. The
protocol invariant is unchanged: an answer produced with zero **database**
tool calls emits `TRELLIS_PROTOCOL_VIOLATION` regardless of workspace or MCP
activity. Telemetry may carry a separate bounded `workspace_ops` count
alongside `mcp_calls`; per the T16 rules, workspace *content* never appears in
logs or metric labels.

## 5. Cross-task lineage (explicitly not a blackboard)

One goal dispatches multiple RLM tasks, each a fresh subprocess. Today the
only cross-task channel is the orchestrator's paraphrase, truncated at 4,000
chars per observation
([src/core/agent/transcript.ts](../../src/core/agent/transcript.ts)) — lossy
for prose and hazardous for AST hashes, which get re-typed through two LLM
hops. The fix is **workspace inheritance along the goal's iteration
structure**, not a shared live store:

1. **Serialize** — at task end, the harness serializes the workspace dict
   (§4.5 makes this trivial) and emits its reference.
2. **Park** — goal-scoped, TTL-bounded storage in Redis
   (`scratch:goal:<goalId>`, the `a2a:task:<id>` precedent; suggested TTL
   3600 s, cap 24 h; per-goal parked-bytes cap, suggested 8 MB). Redis is a
   parking lot for checkpoints, not a live database the model queries.
3. **Seed** — the goal loop loads selected prior workspaces into the next
   task's REPL **at spawn, as data**, before the model's first turn.

The orchestrator **routes by reference and never holds a tool**: sub-agents
end answers naming the workspace/segments they produced; the orchestrator sees
those names in observations and directs seeding in the next task's query. Its
inputs remain pure typed history through `buildDecisionMessages`, so the
zero-LLM oracle drills stay faithful and the planner/doer split
(Guardrail 7) survives untouched.

Why lineage beats a blackboard here: the orchestrator prompt already mandates
that *tasks in one batch must not depend on each other* — live intra-batch
sharing is the one capability the architecture deliberately forbids.
Inheritance between iterations matches the existing dependency model, avoids
concurrent-write semantics entirely, gives byte-exact AST-hash transfer, and
makes every task's inputs a recorded immutable set — replayable and auditable,
which is the Trellis ethos applied to agent cognition itself.

## 6. The promotion path: earned permanence

Today "MCP output can never be `sourceNodeIds`" is a prohibition. The
workspace turns it into a workflow:

1. A segment the agent found load-bearing — origin-stamped, byte-preserved —
   is nominated as a **promotion candidate** (by the agent in its answer, or
   by the operator inspecting the workspace).
2. **The operator approves.** Promotion is operator-gated. No autonomous path
   from Tier 3 to Tier 1 exists.
3. The content enters the ordinary **verified ingest path** with a stable
   document key (for web content, the source URL), becoming Merkle-hashed AST
   bytes.
4. Insights derived from it are now fully provenance-clean, and — because the
   doc key is stable — **the existing update machinery covers refreshed
   external content for free**: re-fetch, re-ingest, Merkle diff, and the
   quarantine sweep contests beliefs whose web-sourced bytes changed, exactly
   as it does for edited documents.

The full pipeline of earned permanence: ephemeral intake (workspace) →
verified substrate (ingest) → compounding belief (knowledge flywheel) →
continuous self-correction (quarantine/verification).

## 7. The capability ladder (self-editing, decomposed)

"The model can edit its own harness" spans four capabilities with different
risk profiles. Verdicts:

- **L0 — self-shaping inside the sandbox. Exists, safe, encouraged.** The RLM
  writes arbitrary Python each turn: helpers, scaffolding, its own workflow in
  the namespace. Contained by transport-level read-only sessions and the
  single write path. The workspace formalizes and persists this.
- **L1 — runtime mutation of its own configuration. FORBIDDEN.** No
  completion may alter the tool registry, allowlists, timeouts, bounds, or
  budgets mid-run (Guardrail 5: "no inbound payload or model completion may
  alter any of it"). Live reason, not ceremony: with web search configured,
  retrieved content is attacker-controlled input; a model that can register
  MCP servers mid-run converts a prompt injection into an exfiltration
  channel. The containment vessel is not redesignable from inside while
  running.
- **L2 — hot-patching its own running code. REJECTED.** Trivial in Python,
  catastrophic architecturally: it deletes reproducibility, voids telemetry,
  and a model that can rewrite `_normalize_fact` in memory can delete the
  provenance requirement itself.
- **L3 — staged self-modification through the verified pipeline. APPROVED —
  and it is the capability flywheel's drive shaft, not a distant pilot.** The
  agent proposes harness changes as artifacts that flow through the same
  trust discipline as everything else: **propose → tests → class-appropriate
  gate (§9.3) → merge → the next run boots the new harness.** Three facts
  make this Trellis-native: (1) every RLM run is a fresh subprocess from
  source on disk — there is no long-lived process for hot mutation to
  benefit; the natural edit boundary is between runs, exactly where gates
  live; (2) whole-codebase ingestion (Session 8) means Trellis can ingest its
  own repository, so the agent reads its own harness as verified,
  content-addressed AST bytes and grounds proposed diffs in real source
  hashes; (3) the HANDOFF §0 loop already runs this pattern manually at the
  meta level.

Unifying principle: **self-editing is a write path, and Trellis already knows
what to do with write paths — gate them, provenance them, make them
recoverable.** "Agent proposes, pipeline verifies, operator admits, next run
inherits" is to code what "external content earns citability only through
verified ingest" is to knowledge.

## 8. The kernel/userspace boundary

- **Kernel — human-owned, changed only by hand, never by the flywheel:** the
  provenance write path and its validators
  ([src/rlm/trellis_tools.py](../../src/rlm/trellis_tools.py)); sandbox
  session access modes (READ transport enforcement); bounds enforcement and
  every Zod/Python config validator; credential handling and redaction; the
  telemetry/result line protocols (`TRELLIS_TELEMETRY`, `TRELLIS_RESULT`,
  `TRELLIS_PROTOCOL_VIOLATION`); the module loader and gate machinery itself.
- **Userspace — agent-authorable through L3:** modules (§9): prompt
  protocols/addenda, namespaced tools, retrieval and planning strategies,
  verifier modules.

Humans own the kernel; the agent authors userspace; every extension boots
fresh in the next subprocess. L1/L2 stay forbidden not as limits on the
flywheel but as what keeps its outputs trustworthy: the agent builds
extensions, never the vessel.

## 9. Modules

### 9.1 Manifest schema

A module is a versioned document-plus-assets artifact, not code fused into the
harness. First-edition schema (field names finalized by the implementing
session; illustrative):

```yaml
name: cache-first-classification        # charset ^[a-z][a-z0-9_-]*$, unique
version: 1
purpose: >-                             # one sentence, specific
  Cache-first TREC classification via rubric-guided sub-LLM delegation.
research:                               # provenance for the CAPABILITY:
  sourceNodeIds: []                     #   AST hashes of ingested papers/notes
                                        #   this design derives from (via §6)
addendum: modules/cache-first-classification/addendum.txt
                                        # brace-free protocol text composed
                                        # into the system prompt when loaded
tools: []                               # optional; namespaced (module_name.*)
bounds:                                 # contributions, each hard-capped
  addendumMaxBytes: 8192
  maxToolTimeoutMs: 10000
acceptance:
  zeroPaid: npm run test:module-cache-first   # drill required at every gate
  paidProbe: docs/modules/cache-first-probe.md # owner-approved behavioral spec
status: active                          # active | contested | retired
kernelCompat: 1                         # kernel interface version
```

The name charset matches `MCP_NAME_PATTERN` so generated prompt listings stay
structurally brace-free; addendum text is validated brace-free at registry
load, byte-identical-when-absent, exactly the
`build_mcp_addendum` discipline.

### 9.2 Sparse composition

The operator registers the module space (a validated registry, the
`TRELLIS_MCP_SERVERS` pattern extended). Per goal or task, a small subset is
selected from that registered space and composed: system prompt = base +
Σ selected addenda (+ MCP addendum) + query; tools = base ∪ namespaced module
tools; hard cap on modules per run (suggested: 4). Selection may be requested
by the orchestrator or the operator, but only ever *within* the registered
allowlist — Guardrail 5 is preserved because composition is free only inside
an operator-defined space. Sparsity is load-bearing twice over: it bounds
pairwise protocol-interaction blowup, and it keeps the composed intelligence
interpretable — every loaded module answers "what is this, where did it come
from, why is it present."

### 9.3 Module classes and gates (the sculpted pathway)

Humans sculpt the *pathway*, not each brick. The owner and colleagues define
module classes and each class's landing gate; per-change review relaxes
class-by-class as automated verification earns trust (the precedent: sampled
belief verification earned its p=0.05 through the measured poisoning drill).
First-edition classes:

| Class | Contents | Landing gate |
|---|---|---|
| **Protocol modules** (addendum-only) | Prompt protocol text, no code | Automated: brace/charset/size validation + zero-paid drill green; human review initially, first class to earn auto-land |
| **Tool-bearing modules** | Addendum + namespaced tools (code) | Human PR review + full acceptance (zero-paid drill; paid probe when behavior-critical), always |
| **Kernel changes** | Anything in §8's kernel list | Human-only, never authored by the flywheel |

### 9.4 Module lifecycle and verification

The belief-verification discipline, applied to capabilities:

- **Birth:** acceptance drills green at the gate; manifest complete; research
  provenance cited.
- **Life:** telemetry regression watched per module (runs composed with the
  module vs. without); sampled re-verification — periodically re-run the
  module's acceptance against the live stack, the code analog of Phase 5's
  sampled belief re-check.
- **Death:** a failing module is **contested** (excluded from composition,
  status `contested`) pending re-review; retirement is explicit and versioned.
- **Research-change contestation — SHIPPED (Session 18, July 8, 2026).**
  The invalidation sweep contests *Neo4j facts* whose source hashes died; it
  knows nothing about manifests. The bridge is the manifest-as-graph-entity
  representation: `npm run modules:register`
  ([scripts/register_modules.ts](../../scripts/register_modules.ts) over
  [src/core/graph/module_registration.ts](../../src/core/graph/module_registration.ts))
  MERGEs each research-bearing active manifest as one ordinary
  `(:Entity {kind: 'module_manifest', name: 'module:<name>'})` carrying
  `sourceNodeIds` = the manifest's research hashes, written with the same
  `applyRederivation` ON MATCH discipline as every other writer — so the
  UNCHANGED sweep reaches it, and the payoff holds precisely: a software
  capability automatically flagged for re-review when its research basis
  changes. The research existence gate runs at registration (every cited
  hash must exist in `ast_nodes` before any write; refusal lists missing
  hashes bounded), NOT at prompt composition, which stays free of any
  PostgreSQL dependency. The loop stays human: `npm run modules:verify`
  reports contested entities and orphaned hashes; the operator flips the
  manifest `status` by hand (a contested/retired manifest is also SKIPPED
  by re-registration — recovery must follow re-review, never precede it);
  re-registration with live research recovers the entity. Empty-research
  manifests (module #0) register nothing. Drilled zero-paid end to end by
  `npm run test:module-lifecycle`.

### 9.5 Module #0

The spatial-flywheel protocol hardcoded in `TRELLIS_ADDENDUM`
([src/rlm/trellis_agent.py](../../src/rlm/trellis_agent.py)) is already a
module in everything but form: a purpose-specific cognitive protocol fused
into the monolithic prompt string. Extracting it into the first registry
module — protocol text as a versioned artifact, loaded and composed at
startup, generalizing the `trec_rubric.json` single-source precedent — proves
the loader with **zero new capability risk**, because the composed prompt can
be pinned byte-identical to today's. Module #0 is the loader's acceptance
test.

## 10. Provenance boundary enforcement

Three layers, cheapest first:

1. **Structural disjointness.** Tier 3 identifiers (uuids, module names) can
   never match `^[0-9a-f]{64}$`. No shared helper, table, or prompt confusion
   can make a workspace id *look like* provenance.
2. **Runtime checks at the single door.** The only agent write path is
   `_normalize_fact` → `_run_insight_writes` in
   [src/rlm/trellis_tools.py](../../src/rlm/trellis_tools.py). Today it
   requires only non-emptiness — a hallucinated hash is writable now,
   workspace or no workspace. Harden it (severable, §11 step 2): every
   `sourceNodeIds` element must match `^[0-9a-f]{64}$`, and one batched
   `SELECT id FROM ast_nodes WHERE id = ANY(...)` existence check rejects
   writes citing unknown hashes. This turns "an AST hash means verified
   ingested bytes" from convention into enforcement.
3. **Telemetry split.** Workspace and MCP activity never satisfy the database
   provenance requirement (§4.8).

**Known residual, with its backstop.** Provenance laundering — the model
citing a *real* AST hash for a claim it actually took from an unverified
segment — is not created by the workspace (scrollback allows it today) and is
not catchable by any runtime check. The backstop is the Phase 5 verification
worker re-checking derived insights against their cited source text, plus the
confidence/rubric-version routing already shipped. **Observed live in the
module #1 authoring turn (July 9, 2026):** the drafting run cited real but
unrelated hashes it surfaced by whole-database vector search instead of the
promoted research it was given; the operator gate caught it. The
capability-side extension of this backstop — scoped authoring, harness-pinned
citations, and derivation verification on the sampled-verifier rails — is
designed in [GROUNDED_AUTHORING.md](GROUNDED_AUTHORING.md) (proposed).

## 11. Implementation sequence

Six steps, ordered by dependency (format → safety → loader → transport →
permanence → self-modification). Each is independently valuable; none
forecloses the others. Acceptance follows the house pattern: zero-paid proof
of every mechanism; paid runs only as small owner-approved behavioral probes.

1. **Workspace** (§4) — **DONE (Session 14, July 7, 2026).** Holder object
   (`src/rlm/trellis_workspace.py`, injected as `trellis_workspace`),
   capture hook in `trellis_mcp.call_tool`, origin stamps, stub returns,
   plan-in-workspace addendum, bounds in validated config
   (`TRELLIS_WORKSPACE_MAX_SEGMENTS`/`TRELLIS_WORKSPACE_MAX_BYTES`).
   Zero-paid acceptance: `npm run test:rlm-workspace` (64 checks) proves
   capture, stamping, stub shape, bounds, byte-identical gating, and the
   direct-`LocalREPL` rlms==0.1.3 semantics pin. The paid paired-run probe
   was owner-approved and MEASURED (July 7, 2026 —
   [docs/benchmarks/WORKSPACE_PROBE_REPORT.md](../benchmarks/WORKSPACE_PROBE_REPORT.md)):
   both arms answered correctly; the workspace arm made exactly the
   minimum 4 external calls with a well-formed end-of-run snapshot,
   while the legacy arm repeated every external call (8 vs 4) — the
   scrollback-as-memory failure mode §4.3 predicts, observed directly.
   n=1 per arm; directional, not statistical. This is the module R&D
   bench everything later uses.
2. **Write-path hardening** (§10.2) — **DONE (Session 14, July 7, 2026;
   shipped first, as sequenced).** Format check in `_normalize_fact`
   (`^[0-9a-f]{64}$`, bounded echo) and the batched existence check
   before the WRITE session (`TrellisPostgres.ast_hashes_exist` injected
   into `TrellisNeo4j`), unconditional. Extended `npm run
   test:rlm-sandbox` (21 checks) pins malformed shapes, unknown-hash
   rejection with bounded lists, deduped-union-once, and the
   infrastructure-failure/provenance-verdict distinction.
3. **Module registry + module #0** (§9.1, §9.5) — **DONE (Session 15,
   July 7, 2026), with one recorded deferral.** Registry schema
   (`modules/<name>/module.json` + brace-free addendum file; Zod in
   `src/config/modules.ts`, Python twin `src/rlm/trellis_modules.py`),
   operator-owned selection (`TRELLIS_MODULES`; default = module #0;
   max 4 per run; protocol modules only — manifests declaring tools are
   rejected by this kernel edition), composition base + Σ addenda +
   workflow rules with the `<<TRELLIS_RUBRIC>>` substitution token, and
   the spatial-flywheel extraction pinned BYTE-IDENTICAL by sha256
   (`npm run test:modules`, 27 checks). **Deferred at the time:** the
   manifest-as-graph-entity representation (§9.4) — module #0 cites no
   research `sourceNodeIds` (it predates the promotion path, step 5),
   so the entity would have been empty and unreachable by the sweep.
   That deferral is now closed: the representation shipped in
   Session 18 (July 8, 2026) as part of step 6's machinery — see §9.4.
4. **Workspace lineage** (§5) — **DONE (Session 16, July 7, 2026).**
   Serialize: `--workspace-out` on `trellis_agent.py` writes the
   end-of-run `snapshot()` to a worker-named temp file in the `finally`
   (success or not — a failed run's partial workspace can seed the
   retry); nothing new crosses stdout. Park: `rlm_worker.ts` validates
   the snapshot (Zod twin of the state dict) and parks it at
   `scratch:goal:<goalId>:task:<taskId>` with `SCRATCH_TTL_SECONDS`
   (default 3600, cap 86400) under the per-goal
   `SCRATCH_MAX_BYTES_PER_GOAL` cap (default 8 MiB, counter key expiring
   alongside); the completion value carries a counts-only
   `workspaceRef`. Seed: `seedTasks` on the rlm job payload (ids only,
   goal-scoped, bounded 8) resolves/merges/re-validates parked
   snapshots into `--seed-workspace`, restored by
   `TrellisWorkspace.seed_from_snapshot` — stamps preserved verbatim,
   bounds re-enforced, torn or over-budget seeds fail the task fast; a
   missing reference is a readable dispatch-time failure. The
   orchestrator routes by reference: `seedFromTasks` on the task spec,
   validated by the goal loop against prior-iteration task ids only
   (same-batch seeding rejected — never a blackboard), `workspaceRef`
   rendered counts-only in observations. Zero-paid acceptance:
   `test:rlm-workspace` extended to 83 (seed round-trip, stamp
   preservation, seed budgets, torn-seed rejection, the seeded
   addendum), `test:agent-loop` extended to 35 (park/resolve over real
   Redis via stub `workspaceSnapshot`, TTL and per-goal cap enforced
   live, missing-ref readable failure), plus the new
   `workspace_scratch.test.ts` / schema / goal-loop / transcript units.
5. **Promotion path** (§6) — **DONE (Session 17, July 7, 2026).**
   Operator-gated segment→ingest through the UNMODIFIED verified
   transaction. Pure planner (`src/core/promotion/plan_promotion.ts`,
   reusing the Session 16 snapshot schema): exact ingest request or a
   typed refusal — truncated captures, empty content, unknown segment
   ids (bounded listing), invalid doc keys. Operator CLI
   (`npm run promote`, `scripts/promote_segment.ts`): list mode
   inventories a PARKED snapshot (origin stamps, sizes, truncation
   markers, doc-key hints); promote mode takes an explicit
   `--doc-key` (recommended `web:<url>`; the deterministic
   `mcp:<server>:<tool>:<argsHash>` fallback is printed, never
   applied silently), echoes the exact bytes/origin before writing,
   defaults to zero paid work, and prints the now-citable block
   hashes. The origin stamp lands on the new nullable
   `documents.origin` JSONB column inside the ingest transaction, so
   "which server/tool/args produced these bytes, fetched when"
   survives promotion. One segment per invocation; no API surface —
   nomination is prose, promotion is a human running the CLI.
   Zero-paid acceptance (`npm run test:promotion`, 41 checks) closes
   the §6 loop live: the same block hash is a Provenance Violation
   before promotion and writes cleanly after; re-promoting refreshed
   bytes under the same doc key versions the document and the sweep
   contests the citing insight with audit preserved.
6. **First flywheel turn** — the RLM authors module #1 end-to-end through
   the pathway: research in the workspace, design grounded in ingested
   sources, manifest + addendum + drill proposed as a gated artifact, landed
   by the operator, composed in the next run. **Machinery DONE
   (Session 18, July 8, 2026); the paid authoring turn RAN,
   owner-approved, on July 9, 2026** — module #1
   (`modules/workspace-discipline/`, registered as
   `module:workspace-discipline` over 24 promoted research hashes;
   record in the roadmap §5 and the module's RESEARCH.md). The turn
   also observed the §10 laundering residual live: the drafting run
   self-cited real-but-unrelated hashes found by whole-database search,
   corrected at the operator gate — the grounded-authoring remediation
   is designed in [GROUNDED_AUTHORING.md](GROUNDED_AUTHORING.md)
   (proposed). What Session 18 shipped: the research existence gate
   (registration-time verification of every `research.sourceNodeIds`
   hash against `ast_nodes`, bounded missing-hash refusals, nothing
   registered on refusal), the §9.4 manifest-as-graph-entity
   representation (`npm run modules:register`, idempotent MERGE with
   the `applyRederivation` ON MATCH discipline; the unchanged sweep
   contests a module whose promoted research is superseded), and the
   contested-module surfacing (`npm run modules:verify`, read-only;
   the recovery loop stays human). Zero-paid acceptance:
   `npm run test:module-lifecycle` closes the loop live — promote →
   register → re-promote changed bytes → sweep contests the module →
   verify reports → manifest flip refused composition → re-review →
   recovery. The module #1 authoring runs (research through MCP,
   operator promotion, gated manifest+addendum+drill PR) run only with
   per-run owner approval and a cost estimate.

## 12. Corrections ledger (anti-drift)

Recorded so downstream summaries and compression pipelines re-anchor here
rather than propagating stale or drifted forms:

1. **RLM expands to Recursive Language Model** (MIT CSAIL formulation) —
   never "Representation Learning" or "Running Language Model."
2. **Graph-addressing vs. graph-addressed:** working state *addresses into*
   the verified layers (carries hashes/ids as references) and is never
   *addressed in* them. The suffix carries the invariant (Axiom 2′).
3. **Causality of reliability runs one way:** provenance and self-correction
   license open tools; search/MCP never anchor belief (Axiom 3′). Any
   summary reading "reliability is achieved by anchoring to web search" has
   inverted it.
4. **Module contestation on research change is designed, not inherited:** the
   invalidation sweep reaches modules only once manifests are represented as
   graph entities citing research `sourceNodeIds` (§9.4). Earlier phrasing
   that this falls out "for free" was wrong.

## 13. Explicit exclusions

Not in this design, deliberately: durable cross-goal unverified memory of any
kind (TTL is a feature; permanence is earned via promotion only); L1/L2
runtime mutation; rlms library forks or monkey-patching beyond the existing
counted-handler pattern; orchestrator tools of any kind (routing by reference
only); workspace content satisfying the provenance protocol; changes to the
backend API contract, the A2A surface, or recorded roadmap sequencing;
autonomous promotion (operator gate is absolute); module auto-landing before
its class has earned it under §9.3.

---

## Appendix A — Verified runtime mechanics (evidence base)

Verified July 7, 2026 by direct source reads of the installed `rlms==0.1.3`
package (locate with
`python -c "import rlm, os; print(os.path.dirname(rlm.__file__))"`),
`rlm/environments/local_repl.py`:

- `execute_code` docstring: "Execute code in the persistent namespace" —
  `self.locals` survives across all REPL turns of one `rlm.completion()`.
- `_restore_scaffold` force-restores only `RESERVED_TOOL_NAMES` each turn;
  `context` is restored from `context_0`; with `compaction` off (Trellis's
  configuration), `history` restores from `history_0`.
- Post-exec persistence loop skips keys starting with `_`.
- Exception path: the copy-back loop is skipped (rebindings lost) but the
  merged namespace is a shallow copy (in-place mutations persist) — the
  rebind-vs-mutate semantics of §4.6.
- Injected `custom_tools` are validated (`validate_custom_tools`) and live in
  the persistent globals — the workspace holder's persistence mechanism.

Repository facts this design leans on, all current at `c3b4c39`:
`TaskRequest.goalId` flows to every dispatched task
([src/core/agent/goal_loop.ts](../../src/core/agent/goal_loop.ts));
`buildAgentEnv` is the pure, unit-pinned env-forwarding seam
([src/workers/rlm_job.ts](../../src/workers/rlm_job.ts)); the MCP layer
already enforces allowlist-before-I/O, per-call timeouts, and size caps over
both transports ([src/rlm/trellis_mcp.py](../../src/rlm/trellis_mcp.py));
TTL-bounded goal-scoped Redis records have a shipped precedent
(`a2a:task:<id>`, [src/api/a2a.ts](../../src/api/a2a.ts)).
