# AGENTS.md — how to study, navigate, and work on Trellis

**Status:** CANONICAL AGENT ENTRYPOINT — the repository-wide session
contract. Not a ratified record and never authority over one: it carries
only *invariants* and is amended by ordinary review on a feature branch
(rule 12), never by silent edit.
**Scope:** every agent, CLI, harness, and model opening this repository.
Directory-scoped `AGENTS.md` files add local rules on top; they never
relax these.
**Amendment discipline:** §4 rule numbers and the section numbers are
cited from code and from other records, so both are **append-only** —
add, never renumber. Cite as `AGENTS.md` rule N or `AGENTS.md` §N.

Trellis is OpenCnid's **Recursive Language Model runtime**: a language
model operating a persistent Python REPL over a provenance-enforced
knowledge substrate. Two doctrines govern everything Trellis stores and
every code path that touches it: every semantic fact traces to immutable
content-addressed source bytes, and *the model never counts, never
copies* — code does (locations engine-computed, bytes moved by splice,
answers submitted by reference). Both doctrines govern the substrate;
the engineering session that builds Trellis runs on ordinary
source-control collaboration (branches, review, merge rights), not on
the substrate's quarantine law.

**Where work comes from.** The collaborator's live task and its
governing records. When intent is clear, act. When an input is genuinely
ambiguous, ask exactly one clarifying question and **wait for the
answer**; an unrecognized term is a question, not a quarantine event
(rule 21).

**Who outranks what.** Authority order across the committed record:
**code > glossary > prose**. That order ranks committed artifacts
against each other; it does not rank them against the people directing
the work. A collaborator's clear, current instruction is the highest
authority in a live session — the repository is the durable record a
context-free session relies on, not an oracle that outranks the
collaborator (`docs/architecture/SESSION_GOVERNANCE.md`). §1.5 carries
the full chain and its limits.

| § | Section | Read it |
|---|---|---|
| 0 | The ladder | To find the depth you actually need |
| 1 | Study protocol | First, before anything else |
| 1.5 | Authority ordering | Before you trust any record you are reading |
| 2, 2.1 | Navigation map and record standing | To find the enforcement home of what you are changing |
| 3 | How things connect | Before designing a change |
| 4 | Hard rules (twenty-one, permanent) | Every session, in full |
| 5 | Working protocol (commands) | On a fresh checkout, and for the offline entrypoints |
| 6 | Last look | Immediately before you act |

---

## 0. The ladder (read to the depth you need)

Five tiers, each denser than the last and each complete on its own
terms: a deeper tier adds entities, it never corrects a shallower one.
T1–T3 carry orientation; T4 and T5 are pointers into §1.5 and §3, not
restatements of them. **The ladder orients; it never obliges.** Every
obligation lives in §4 and binds you at every tier, including if you
stop at T1 — so read §4 in full regardless of where you stop climbing.

**T1 — the gate.** You are an agent opening Trellis, OpenCnid's
Recursive Language Model runtime: a model operating a persistent Python
REPL over a provenance-enforced substrate. Your objective comes from the
collaborator's live task — never from a branch name, the deprecated
`HANDOFF.md`, or your own selection. Do not go from task to
implementation: orient, retrieve the record that governs the task, then
design. The two doctrines above govern the substrate. The twenty-one
hard rules in §4 are mandatory and appear at no other density.

**T2 — the routing.** Read this file whole, then the live task, then
`docs/GLOSSARY.md` before any prose using its terms, then
`docs/ORIENTATION.md` — the system's own five-density ladder, where the
whole-system model lives rather than here. Then go task-directed: find
the enforcement home of what you are changing and read it with its
pinned test. `docs/benchmarks/` holds measured claims; `docs/archive/`
holds history, worth opening only when past session evidence is genuinely
needed. The nearest directory-scoped `AGENTS.md` binds your edits too.
When two committed records disagree, standing decides.

**T3 — the working contract.** Every change is one triple:
`{Behavior_You_Want} → {Tooling_That_Enforces_It} → {Pin_That_Detects_Drift}`.
Prompts reinforce behavior, tooling shape enforces it, a pinned test
makes drift loud; change one leg and find the other two before starting.
Retrieve before you decide or claim, because a lossy summary reads
exactly like a faithful one from the inside — name the file and section
you opened *this session*. Observe shared state before mutating it,
check a claim against the diff before writing it, and know what would
make a passing check fail. Correct is not reachable: name a capability's
non-test caller, or say plainly there is none.

**T4 — the standing of records.** A superseded design record sits in the
reading path looking exactly as authoritative as the record governing
it, so standing is load-bearing and never inferable from tone or
placement. §1.5 carries the chain in full, §2.1 the vocabulary and where
the per-record index lives, and each file's own header — plus the dated
entries under it — governs that file. Skills and memories are derived:
on drift the record wins.

**T5 — the pinned seams.** Behavior is held in named files, each with a
pin that makes drift loud. §3's table maps every enforcement home to its
exact pin — read the row before you touch the file, and recompute pins
in the same commit, wittingly. Two seams bite hardest: the legacy
extraction prompt is a queue-compatibility byte pin that never moves,
and `search_ast_nodes` puts current-version membership before `LIMIT`,
so discovery reads live blocks only.

## 1. Study protocol (read in this order)

1. **This file, fully.** The navigation tables below are the map.
2. **The collaborator's live task.** It is the current objective. Do not
   recover an objective from the deprecated `HANDOFF.md`, the archived
   technical roadmap, a branch name, or an old progress entry. If no
   live task exists, the un-tool is the whole move: ask exactly one
   clarifying question in the chat channel and select no work of your
   own (rule 21).
3. **`docs/GLOSSARY.md`** — one-line canonical definitions for every
   load-bearing term (RLM, contested, promotion, module, workspace,
   quarantine, standing, …). Read before any prose that uses them.
4. **`docs/ORIENTATION.md`** — one system at five densities, D0 through
   D4. Read D0–D2 always (under 700 words together); read D3 before
   designing anything; use D4 as the concept→authority index. Stop at
   the first density that answers your question. The root `README.md` is
   only a bounded router; the full operator manual lives at
   `docs/operations/OPERATOR_MANUAL.md`.
5. **Task-directed depth** — use §2/§3 below to find the enforcement
   home of whatever you are changing, and read THAT file plus its
   pinned test before designing anything.
6. **Evidence and history** — `docs/benchmarks/*` for measured claims;
   `docs/archive/ROADMAP_HISTORY.md` and
   `docs/archive/TRELLIS_ROADMAP_DEPRECATED.md` only when historical
   session evidence is actually needed.

**Directory-scoped rules also apply.** The nearest `AGENTS.md` to the
file you are editing adds local rules on top of this one; check for one
before editing anywhere under `src/`.

## 1.5 Authority ordering (which record wins)

The navigation map below says where things live. It does not say which
one governs when two disagree — and a reader who assumes the document
in front of them is the top of the chain will build confidently against
a superseded one. The ordering:

```
ratified record  →  adopted doctrine  →  design record  →  orientation / historical compression  →  skill, memory
```

- **Ratified and adopted records win**, and are amended only by dated
  entry, never by silent edit. A record's own header carries its
  standing — read it before treating the body as law, and read the
  dated amendment entries below the header too: a status line can be
  superseded by a later dated entry inside the same file.
- **A design record leads its implementation** (document-driven design)
  but does not outrank a ratified record it was written under.
- **The old handoff and technical roadmap are deprecated historical
  compressions.** They may explain past decisions; they never select
  current work or establish current Git, test, prompt-pin, or database
  state. Observe current state and retrieve the governing record.
- **Skills and memories are derived artifacts.** Where a skill and its
  record drift, the record wins and the skill is corrected. A memory is
  a private note about a past state, never authority.
- **A collaborator's clear, current instruction in the live session
  outranks the committed record** — `docs/architecture/SESSION_GOVERNANCE.md`
  (ADOPTED and APPLIED, July 17, 2026). That ruling is **scoped to the
  session contract**: it settles which record governs how you work. It
  explicitly leaves the AST-immutability invariants, the zero-paid gate,
  and the no-AI-attribution rule untouched (that record's §1.6, *What
  this does not touch*), so rules 2, 3, 4, 7 and 10 hold regardless.

§2.1, just below the navigation map, carries the standing vocabulary and
points at the per-record index. Rule 18 governs how you consume this
chain.

## 2. Navigation map (where things live)

| Path | What lives there |
|---|---|
| [`src/core/ingestion/`](src/core/ingestion/) | The verified ingest transaction (persist → read-back re-hash → membership → Merkle diff) and extraction cost planning |
| [`src/core/ast/`](src/core/ast/) | Merkle AST construction, parsers (markdown/code/PDF), block collection, persistence |
| [`src/core/graph/`](src/core/graph/) | Semantic layer: schemas (Zod), merge/provenance/quarantine-recovery, entity resolution, generic-identifier suppression, module registration |
| [`src/core/repository/`](src/core/repository/) | Whole-repo snapshot ingestion, path safety, test/fixture extraction exclusion |
| [`src/core/promotion/`](src/core/promotion/) | The ONLY Tier-3 → Tier-1 bridge (workspace segment → verified ingest) |
| [`src/core/agent/`](src/core/agent/) | The orchestrator: decision schema, prompt, transcript, goal loop — pure decision-maker, no tools |
| [`src/core/authoring/`](src/core/authoring/) | Grounded authoring: corpus seeding, byte-pinned template, anchor gate, assembly |
| [`src/core/a2a/`](src/core/a2a/), [`src/api/`](src/api/) | External surfaces: A2A protocol, HTTP API (thin delegates over core) |
| [`src/core/llm/`](src/core/llm/) | `parseLlmResponse` — the boundary EVERY worker-consumed completion crosses |
| [`src/core/observability/`](src/core/observability/) | pino logging + per-process Prometheus registries (bounded labels only) |
| [`src/config/`](src/config/) | Env validation (Zod), module/MCP-server loaders (Node twins of the Python validators) |
| [`src/workers/`](src/workers/) | BullMQ consumers; pure job-parsing/prompt-selection modules beside each worker (`extraction_job.ts` holds both extraction prompts) |
| [`src/rlm/`](src/rlm/) | The Python RLM harness: `trellis_agent.py` (kernel prompt + composition), `trellis_tools.py` (DB tools), `trellis_scaffold.py` (task wrapper, UPSUM, staged helpers), `trellis_blocks.py` (stdlib-only, parity-pinned), plus the `answer`/`workspace`/`textedit`/`modules`/`mcp` modules |
| [`src/benchmarks/`](src/benchmarks/) | Probe machinery: effective-context suites, est suite truths, OOLONG scoring |
| [`src/frontend/`](src/frontend/) | Next.js dev-only UI — has its own `AGENTS.md`; deferred, don't touch unasked |
| [`modules/`](modules/) | Protocol modules: `module.json` manifest + brace-free addendum text |
| [`scripts/`](scripts/) | Operator CLIs (`repo:ingest`, `promote`, `modules:*`) and live zero-LLM drills (`test_*.py`, `test_*.ts`) |
| [`docs/architecture/`](docs/architecture/) | Living doctrine (design records lead implementation) |
| [`docs/benchmarks/`](docs/benchmarks/) | Measured evidence — dated reports behind every claim |
| [`docs/operations/`](docs/operations/) | Operator manual, runbook, deployment records |
| [`docs/reference/`](docs/reference/) | HTTP, SSE, and external protocol references |
| [`docs/product/`](docs/product/) | PRDs, benchmark specs, and active programs. Standing and reading order for the epistemic-support records: §2.1 |
| [`.claude/skills/`](.claude/skills/) | Project skills auto-loaded by Claude Code and inventoried for every harness. Roster and triggers: [`.claude/skills/README.md`](.claude/skills/README.md) — read it before assuming no skill covers the task. The record each skill derives from is canonical over it |
| [`docs/archive/`](docs/archive/) | Preserved history (verbatim, never edited) |
| [`tools/repository-surface/`](tools/repository-surface/) | Machine root contract and deterministic repository-surface checker (`npm run check:repo-surface`) |
| Root: [`AGENTS.md`](AGENTS.md), [`README.md`](README.md), [`HANDOFF.md`](HANDOFF.md) | Canonical agent entrypoint / bounded router / deprecated compatibility stub |
| [`data/`](data/), [`fixtures/`](fixtures/) | Committed durable corpora (byte-pinned) / test fixtures (never extracted) |

### 2.1 Standing of the load-bearing records

The map above says where things live; §1.5 says which wins. This says
how to find out what a record **is**, because a superseded design record
sits in every reading path looking exactly as authoritative as the
ratified record governing it.

**Each file's own header is the authority on its standing.** Read the
header, and the dated entries beneath it: a status line can be
superseded by a later dated entry inside the same file.

The standing vocabulary: **RATIFIED** and **ADOPTED** records win and
are amended only by dated entry; **DESIGN / PROPOSED** leads an
implementation without outranking the record it was written under;
**IMPLEMENTED** marks a landed slice; **SOURCE ARTIFACT** takes addenda,
not edits; **DEPRECATED / HISTORICAL** never establishes current state;
**DERIVED** (skills, memory) loses to its record on drift.

**The per-record index lives at `docs/ORIENTATION.md` D4 (Record
standing).** It moved there on July 22, 2026: a standing value changes
every time a record is ratified or a slice lands, and this file carries
only invariants (see the Status header). Rule 18 governs how you consume
the chain — the index orients, the header decides.

## 3. How things connect (the system in one screen)

**The path bytes take:**

    verified ingest (`src/core/ingestion/`)
      →  immutable Merkle AST in PostgreSQL
      →  operator-budgeted extraction jobs (Redis/BullMQ, `src/workers/`)
      →  Neo4j entities/relationships carrying `sourceNodeIds` (block hashes)
      →  invalidation sweep when a document version orphans blocks

Documents enter through ONE verified transaction. When a document
version orphans blocks, the sweep CONTESTS every belief citing them —
quarantine with audit, never delete.

**Who runs the work.** The RLM (`src/rlm/`) runs one task per spawned
process with the substrate injected as REPL tools, and answers by
reference through `trellis_answer`; above it, the orchestrator
(`src/core/agent/`) decomposes goals into self-contained tasks.

**Trust is tiered:**

- **Tier 1** — verified bytes.
- **Tier 2** — derived belief with provenance.
- **Tier 3** — workspace scratch with ZERO standing.

Promotion is the ONLY bridge up. Capability itself is provenance-tracked:
modules cite research hashes and the same sweep contests them when
evidence moves.

The change pattern is always the same triple:

    {Behavior_You_Want} → {Tooling_That_Enforces_It} → {Pin_That_Detects_Drift}

Prompts REINFORCE behavior; tooling shape ENFORCES it; a pinned test
makes drift loud. If you change any leg, find the other two before you
start. Worked instances of the frame:

| Enforcement home | Its pins |
|---|---|
| Kernel prompt (`trellis_agent.py` composition) | Composed-prompt sha pins + history in `scripts/test_modules.py` — recompute BOTH pins in the SAME commit, wittingly |
| Extraction prompts (`src/workers/extraction_job.ts`) | Byte pins in `extraction_job.test.ts` (legacy prompt = queue-compat contract: NEVER move) |
| Write-path provenance (`trellis_tools.py`) | 64-hex format + existence + retrieval-membership enforcement, in that order; `test:rlm-sandbox` [2]/[3]/[6], `test:rlm-workspace`, unit pins |
| Retrieval discipline (`trellis_tools.py`, discipline-enabled construction only) | Held-state dedup + per-run budget; identities only, never content; first fetch byte-identical; `test:rlm-sandbox` [7], `buildAgentEnv` unit pins |
| Retrieval liveness (`search_ast_nodes` in `src/config/schema.ts`, the T15 seam) | Current-version-membership EXISTS before LIMIT — discovery reads live blocks only; `schema.test.ts` filter pin, `test:repo-ingest` Part 8 (planted dead twin) |
| Editing toolkit (`trellis_textedit.py`) | `npm run test:textedit` (containment, digest guard, splice semantics) |
| Answer channel (`trellis_answer.py`) | `npm run test:answer-channel` (incl. kernel-prompt substring checks) |
| Module registry (`trellis_modules.py` + `src/config/modules.ts`) | Twin validators, `npm run test:modules` |
| Governed-document size (`root-contract.json` `maxBytes`) | `npm run check:repo-surface` refuses at the boundary; `npm run upsum -- <path>` names the heaviest sections so compression is computed, not eyeballed (`tools/document-upsum/upsum.test.ts`) |

## 4. Hard rules (permanent — survive every session)

*** CRITICAL *** — all twenty-one bind every session. The groupings
below are attention aids; they establish no precedence among the rules.

**A. Where the objective comes from**

1. **Take the objective only from the collaborator's live task.** Read
   this file, orient at the shallowest `ORIENTATION.md` density that
   answers your question (D3 before designing anything), and retrieve
   the task's governing records before deciding or editing. The
   deprecated handoff and archived roadmap never select work.

**B. Substrate and text-path invariants — never weaken**

2. **Address AST nodes by content; write new nodes rather than changing
   old ones.** Identity is the SHA-256 Merkle preimage. Never mutate an
   AST node; never persist positional identity.
3. **Correct entities with overlay beliefs.** Equivalence is an overlay
   belief; a wrong entity is contested or retired. Never merge, rename,
   or delete Entity nodes.
4. **Provenance is enforced, not asked for**: every `sourceNodeIds`
   element must be a real, existing AST hash — and, on agent research
   runs, one the run actually retrieved. Never weaken the write path.
5. **Code-mediated text is doctrine**
   (`docs/architecture/CODE_MEDIATED_TEXT.md`): locations
   engine-computed, existing bytes moved by code, hash-guarded writes,
   answers by reference. Never make the model count or retype.
6. **The rlms prompt contract**: EXTEND `RLM_SYSTEM_PROMPT`, never
   replace it; no literal curly braces in anything rlms formats
   (`.format()` runs over it — escape by doubling; module addenda are
   brace-free with `<<TRELLIS_RUBRIC>>` as the only substitution).

**C. Spend, enforcement, and boundaries**

7. **Paid LLM work is owner-gated**: propose with a printed estimate
   first, hard cap $5/run (typical well under $2), report actuals
   after. Zero-paid drills prove wiring before any spend. Check for
   stale queue consumers before any paid enqueue.
8. **Tooling shape closes behavioral failure classes; prompt text only
   reinforces** (owner doctrine). Never reward citation counts or low
   tool-call counts; report calls and correctness together.
9. **Validate at every boundary**: completions cross
   `parseLlmResponse`; new job fields are optional and bounded with
   legacy behavior byte-pinned; operator gates (env allowlists,
   budgets, confirmation flags) are kernel, never model-writable.

**D. What you emit: attribution, reporting, branches**

10. **Write commits, PRs, and code as plain engineering prose.** No AI
    attribution anywhere — no Co-Authored-By trailers, no
    generated-with footers.
11. **Report honestly**: publish counts and raw numbers; a null or
    surprising result is a finding — **but only once a positive control
    has fired**: a control that never discriminates means the test was
    blind, so the result is noise, not a null (the positive-control
    duty, `docs/architecture/TEST_TIME_TRAINING.md` §6). Re-run outliers
    before believing them.
12. **One feature branch, one PR to `master`.** Record durable decisions
    in the owning design/product record, measured claims in the owning
    report, and exact verification in the PR. Do not revive the
    deprecated global handoff/roadmap loop.

**E. Standing of state: what is searchable, what a pause blocks, what counts as delivered**

13. **Superseded versions are archive, not search space** (owner
    direction, July 13, 2026): any default-discovery retrieval
    surface — present or future — reads LIVE blocks only (members of
    some document's current version). Superseded content is reachable
    solely by explicit address (hash/id) when a caller deliberately
    asks for history. Reference semantics: the `search_ast_nodes`
    EXISTS join / the stage-2 checker's `gatherHashEvidence` bridge.
14. **A protected pause refuses the effect it names, and nothing
    more.** An owner gate on a paid run, a push, a merge, or an
    acceptance record withholds THAT effect. It is not authorization
    to stand down unblocked work, to renegotiate the developer's
    direction outside that effect, or to self-sequence adjacent
    engineering. Discharge every unprotected preparatory step and
    specify the request in full; refuse only on a failed provenance or
    scope predicate, never on the absence of your preferred artifact.
    Surface a discovered defect with a proposed fix and let the owner
    sequence it: the gate withholds an effect, never the chat channel,
    and one question about scope costs less than self-sequencing around
    it (rule 21).
15. **Correct is not the same claim as reachable.** A passing suite
    says the code is right, never that anything can invoke it. Before
    calling a capability delivered, name its non-test caller — a
    process entrypoint, a package script — and if there is none, say
    so plainly. This repo has shipped the same defect three times, most
    recently `StateStore.open()` with no caller outside tests behind
    1,161 green tests.

**F. Authoring: prompts and composition**

16. **Prompt authoring runs the protocols** (permanent; owner-directed
    July 13, 2026). ANY session that creates or edits prompt text — a
    kernel or module addendum, an RLM task text, an agent or sub-agent
    instruction, an extraction or classification prompt, an output
    schema, a hypershot frame, a judge rubric or anchor item — MUST
    FIRST invoke BOTH the `prompt-engineering` and `hypershot-protocol`
    skills and author against their loaded guidance. A process gate
    checked before the bytes are written, never a claim made in prose
    after. Judge-shaped work adds `judge-composition`.
17. **Compose from primitives; never encode a default instance.**
    Harness functions compose per context from parameter registries.
    Frames are invariant (schema shapes, field names, role slots and
    the blindness each buys); instances are not (selections,
    orientations, closed taxonomies, names). An instance that reaches
    a wire schema, a byte-pin, a registration, or an operator
    checklist has silently become law. The tell: if a second instance
    would need a second registration under a different name, the first
    was never a frame. Full record with the case that produced it:
    `docs/architecture/COMPOSITION_FROM_PRIMITIVES.md`.

**G. Before you decide, mutate, or measure**

18. **Retrieve before you decide or claim.** A derived representation
    never satisfies an obligation to its source on a load-bearing act.
    Use an orientation compression, a design record, a skill, or a
    memory **to do the work**; **retrieve and quote the source** to
    decide what work to do, or to state what a record establishes. The
    tell: you cannot name the file and section you actually retrieved
    *this session*. A lossy summary reads exactly like a faithful one
    from the inside, so nothing prompts the retrieval that would
    correct it — and in a documents-lead repo the result is a green
    suite around the wrong object. Session 71 built the wrong object
    after following a stale compression without retrieving the ratified
    record; the remedy is source retrieval, not another global prompt.
    This is `docs/architecture/CODE_MEDIATED_TEXT.md` §2.9 (the pillar
    applied to authority) and generalizes the rule already ratified for
    papers in `docs/RESEARCH_NOTES_COLLECTION.md` §3. See §1.5
    (Authority ordering) above for the chain it depends on.
19. **Observe before you mutate; verify before you describe; and prove
    the check can fail.** Three habits, one root — acting on a belief
    about state instead of an observation of it.
    (a) **Observe shared state first.** Look at what is already
    running, present, or registered before starting or creating
    anything in it. §1.5's instruction to observe current Git, test,
    prompt-pin, and database state rather than assume applies to
    containers, databases, and stores equally.
    (b) **Verify before you describe.** A commit message is a claim.
    Check it against the diff before making it; never write that
    something was done and then not do it.
    (c) **A verification you have not seen fail is not a
    verification.** The judge-program drills (`test:judge-intake`,
    `test:judge-panel`, `test:judge-convocation`, `test:support-oracle`)
    each ship a `--negative-control` that exits 3 when every planted
    break is detected, for exactly this reason. Before trusting a check
    that passed, know what would make it fail — a check that cannot
    fail reports success on anything, including bytes about to become
    registration hashes.
20. **Instructions are specifications, not hypotheses — measure one
    only against a stated engineering target, or probe it for failure
    modes (leak, over-trigger, break); if no target is stated, set
    one.** Never test that a prompt moves behavior, and never validate
    a prompt, skill, or agent instruction by baseline comparison ("with
    vs without", "does it help") — do not substitute a comparison for a
    target. A well-engineered instruction constrains the model to its
    spec; that it differs from, or beats, an unspecified base-model
    response is *entailed* by what an instruction is, not an open
    question, and re-proving it burns credits (rule 8, applied to
    testing). Measurement harnesses are for tooling interventions,
    never for proving prompts. The tell: you are about to run a test
    whose outcome is entailed, because a familiar comparison was easier
    to reach for than naming the target — the **nearby-attractor**
    trap. Reachability checks and functional-equivalence or regression
    comparisons between two versions remain permitted: they are the
    rule-20-safe half (`docs/architecture/SELF_DESCRIBING_SURFACES.md`
    §5), and what is barred is the new-versus-null baseline. The case
    that produced this rule: `docs/architecture/HARNESS_SELF_MODEL.md`
    §11.
21. **The cheapest available move is not a tool call — put the question
    to the collaborator in the chat channel** (the un-tool;
    owner-directed July 22, 2026). Declining to call anything and
    asking is a move, not the absence of one: no schema, no install, no
    recurring cost, and the only move that resolves an underdetermined
    instruction at its source instead of routing around it. Reach for
    it BEFORE any lever that installs permanent configuration — a
    permission rule, an MCP server, a new skill or memory file, a
    sub-agent, a module addendum — and before guessing through a values
    or scope call only the collaborator can make. The one-question cap
    still binds: ask it in the same turn that discharges every
    preparatory step you can already take (rule 14), then **stop and
    wait** — asking and then proceeding on your own guess spends the
    collaborator's attention and discards the answer (owner ruling,
    July 22, 2026, recorded in `SESSION_GOVERNANCE.md` §2). Stopping is
    not standing down: the preparatory work is already done and
    reported when the question is put. Asking resolves ambiguity in an
    instruction; it never
    closes a behavioral failure class, which still takes tooling shape
    (rule 8). The corpus survey found no lever toward *more*
    interruption — an artifact of enumerating only moves that have a
    surface. A move with no surface stays invisible until named; this
    rule is that name. Construction:
    `.claude/skills/spark-steering/SKILL.md` § *Ask first — the
    un-tool* (derived; §1.5).

## 5. Working protocol (commands)

Fresh checkout (worktrees ship without `node_modules`):

    git status --short --branch
    npm ci
    npm test
    npm run build
    npm run python:check
    npm run check:repo-surface

Editing a contracted root file (this one included)? `npm run upsum --
<path>` prints its size against the contracted budget and ranks its
sections largest-first — rewrite the heaviest, never append past the
bound.

Task-specific records define their own acceptance checks. The root
package provides the common offline entrypoints.
Live drills need the Compose stack (`docker compose`); paid probes
additionally need `OPENAI_API_KEY` in the SHELL environment (dotenv
never overrides shell env). The Python runtime is pinned by
`requirements.txt`; `npm run python:check` verifies it. CI is Node 22
and installs Python before `npm test` (`block_parity.test.ts` spawns
real Python inside the unit suite).

## 6. Last look before you act

Pointers, not restatements — each rule's text in §4 governs.

- The objective comes from the collaborator's live task (rule 1).
- Retrieve and quote the source before you decide or claim (rule 18).
- Observe state before you mutate it, and prove the check can fail
  (rule 19).
- Authoring prompt bytes? Invoke `prompt-engineering` and
  `hypershot-protocol` FIRST (rule 16).
- Paid work is owner-gated: printed estimate first, $5/run cap, actuals
  after (rule 7).
- Underdetermined? Ask one question in the chat channel rather than
  guessing or installing something (rule 21).
- When two records disagree: §1.5 (Authority ordering).
