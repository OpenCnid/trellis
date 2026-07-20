# AGENTS.md — how to study, navigate, and work on Trellis

You are an agent (CLI, harness, or model) opening this repository. This
file is your entry point. It teaches three things, in order: how to
STUDY the repo, how to NAVIGATE it, and the HARD RULES that survive
every session. It deliberately contains only *invariants* — facts that
hold across sessions. Everything volatile (current objective, test
counts, prompt pins, database state) lives in `HANDOFF.md` and is
POINTED TO, never copied here; if this file and `HANDOFF.md` disagree,
`HANDOFF.md` is newer and wins. Authority order across the committed
record: **code > glossary > prose**. That order ranks committed
artifacts against each other; it does not rank them against the people
directing the work. A collaborator's clear, current instruction is the
highest authority in a live session — the repository is the durable
record a context-free session relies on, not an oracle that outranks
the collaborator (`docs/architecture/SESSION_GOVERNANCE.md`). When an
input is genuinely ambiguous, ask exactly one clarifying question and
proceed; an unrecognized term is a question, not a quarantine event.

Trellis is OpenCnid's **Recursive Language Model runtime**: a language
model operating a persistent Python REPL over a provenance-enforced
knowledge substrate. Two doctrines govern everything Trellis stores
and every code path that touches it: every semantic fact traces to
immutable content-addressed source bytes, and *the model never counts,
never copies* — code does (locations engine-computed, bytes moved by
splice, answers submitted by reference). Both doctrines govern the
substrate; the engineering session that builds Trellis runs on
ordinary source-control collaboration (branches, review, merge
rights), not on the substrate's quarantine law.

---

## 1. Study protocol (read in this order)

1. **This file, fully.** The navigation tables below are the map.
2. **`HANDOFF.md`** — the self-regenerating session prompt and the
   single source of volatile truth. §0 the session loop, §1 the living
   architectural mental model, §2 the current baseline (branch state,
   test counts, prompt pins), §3–§8 the current objective, its design,
   acceptance, guardrails, and exclusions. If you do session work, §3
   is your objective; do not select your own.
3. **`docs/GLOSSARY.md`** — one-line canonical definitions for every
   load-bearing term (RLM, contested, promotion, module, workspace,
   provenance laundering, …). Read before any prose that uses them.
4. **Root `README.md`, "What Trellis is"** — the five commitments; the
   system-level framing and the operator manual.
5. **Task-directed depth** — use §2/§3 below to find the enforcement
   home of whatever you are changing, and read THAT file plus its
   pinned test before designing anything.
6. **Evidence and history** — `TRELLIS_ROADMAP.md` §4 (sequencing) and
   §5 (dated progress ledger, most recent five sessions);
   `docs/archive/ROADMAP_HISTORY.md` (older sessions, verbatim);
   `docs/benchmarks/*` (every capability claim's measured report).

Directory-scoped `AGENTS.md` files add local rules; the nearest one to
the file you are editing also applies (`src/frontend/AGENTS.md` exists
today).

**Do not skip step 2's mental-model half to reach the objective.**
`HANDOFF.md` §1 is the living architectural model and §3 is the current
task; a session that reads §2/§3 and skips §1 gets an objective without
a model. Recorded because it happened: Session 71 skipped §1, which is
where the pointer to the ratified record governing its work lived, and
built the wrong object.

## 1.5 Authority ordering (which record wins)

The navigation map below says where things live. It does not say which
one governs when two disagree — and a reader who assumes the document
in front of them is the top of the chain will build confidently against
a superseded one. The ordering:

```
ratified record  →  adopted doctrine  →  design record  →  HANDOFF / roadmap compression  →  skill, memory
```

- **Ratified and adopted records win**, and are amended only by dated
  entry, never by silent edit. A record's own header carries its
  standing — read it before treating the body as law.
- **A design record leads its implementation** (document-driven design)
  but does not outrank a ratified record it was written under.
- **`HANDOFF.md` and `TRELLIS_ROADMAP.md` are compressions.** They are
  the single source of *volatile* truth — branch state, counts, the
  current objective — and they are downstream of the records they
  summarize. A task instruction in `HANDOFF.md` §3 that conflicts with
  a ratified record is drift in the handoff, not new law. This has
  happened: `JUDGE_CONVOCATION_DESIGN.md` §11.2 was written one day
  after the rule it contradicted was ratified.
- **Skills and memories are derived artifacts.** Where a skill and its
  record drift, the record wins and the skill is corrected. A memory is
  a private note about a past state, never authority.
- **A collaborator's clear, current instruction in the live session
  outranks the committed record** — `docs/architecture/SESSION_GOVERNANCE.md`,
  scoped July 17, 2026.

Standing is shown in the navigation map's third column so it is visible
at the index, not only inside each file. Rule 18 governs how you consume
this chain.

## 2. Navigation map (where things live)

| Path | What lives there |
|---|---|
| `src/core/ingestion/` | The verified ingest transaction (persist → read-back re-hash → membership → Merkle diff) and extraction cost planning |
| `src/core/ast/` | Merkle AST construction, parsers (markdown/code/PDF), block collection, persistence |
| `src/core/graph/` | Semantic layer: schemas (Zod), merge/provenance/quarantine-recovery, entity resolution, generic-identifier suppression, module registration |
| `src/core/repository/` | Whole-repo snapshot ingestion, path safety, test/fixture extraction exclusion |
| `src/core/promotion/` | The ONLY Tier-3 → Tier-1 bridge (workspace segment → verified ingest) |
| `src/core/agent/` | The orchestrator: decision schema, prompt, transcript, goal loop — pure decision-maker, no tools |
| `src/core/authoring/` | Grounded authoring: corpus seeding, byte-pinned template, anchor gate, assembly |
| `src/core/a2a/`, `src/api/` | External surfaces: A2A protocol, HTTP API (thin delegates over core) |
| `src/core/llm/` | `parseLlmResponse` — the boundary EVERY worker-consumed completion crosses |
| `src/core/observability/` | pino logging + per-process Prometheus registries (bounded labels only) |
| `src/config/` | Env validation (Zod), module/MCP-server loaders (Node twins of the Python validators) |
| `src/workers/` | BullMQ consumers; pure job-parsing/prompt-selection modules beside each worker (`extraction_job.ts` holds both extraction prompts) |
| `src/rlm/` | The Python RLM harness: `trellis_agent.py` (kernel prompt + composition), `trellis_tools.py` (DB tools), `trellis_answer.py`, `trellis_workspace.py`, `trellis_textedit.py`, `trellis_modules.py`, `trellis_mcp.py`, `trellis_scaffold.py` (task wrapper, UPSUM, staged helpers), `trellis_blocks.py` (stdlib-only, parity-pinned) |
| `src/benchmarks/` | Probe machinery: effective-context suites, est suite truths, OOLONG scoring |
| `src/frontend/` | Next.js dev-only UI — has its own `AGENTS.md`; deferred, don't touch unasked |
| `modules/` | Protocol modules: `module.json` manifest + brace-free addendum text |
| `scripts/` | Operator CLIs (`repo:ingest`, `promote`, `modules:*`) and live zero-LLM drills (`test_*.py`, `test_*.ts`) |
| `docs/architecture/` | Living doctrine (design records lead implementation) |
| `docs/benchmarks/` | Measured evidence — dated reports behind every claim |
| `docs/operations/` | Runbook |
| `docs/product/` | PRDs, benchmark specs, and ACTIVE programs — `epistemic-support/` is live work, not history. Building anything judge-shaped starts at `docs/product/epistemic-support/JUDGE_COMPOSITION_GAME.md` (ratified; its twenty rules are binding program law) and `docs/architecture/COMPOSITION_FROM_PRIMITIVES.md` |
| `skills/` | Composition skills versioned in-repo (`judge-composition`); the record each derives from is canonical over it |
| `docs/archive/` | Preserved history (verbatim, never edited) |
| Root: `HANDOFF.md`, `TRELLIS_ROADMAP.md`, `API_REFERENCE.md` | Session prompt / sequencing + dated ledger / HTTP + SSE contract |
| `data/`, `fixtures/` | Committed durable corpora (byte-pinned) / test fixtures (never extracted) |

### 2.1 Standing of the load-bearing records

The map above says where things live; §1.5 says which wins. This says
what each one **is**, because standing was invisible at the index and a
superseded design record sat in every reading path looking exactly as
authoritative as the ratified record governing it.

**Each file's own header is the authority on its standing** — this
table is an index, kept current as records are ratified, not a
substitute for reading the header.

| Record | Standing |
|---|---|
| `docs/architecture/CODE_MEDIATED_TEXT.md` | **RATIFIED** pillar (July 9, 2026) — the model never counts, never copies; §2.9 extends it to authority |
| `docs/product/epistemic-support/JUDGE_COMPOSITION_GAME.md` | **RATIFIED** (July 18, 2026, §11) — its twenty §6 rules are **binding program law**, cited by number, never restated. Read first for anything judge-shaped |
| `docs/product/epistemic-support/RECONCILIATION.md` | **RATIFIED** (July 18, 2026, §7) — panel law; governs FOUR_JUDGE_DESIGN and FOUR_JUDGE_BASIC_MODEL where they differ |
| `docs/architecture/EPISTEMIC_SUPPORT.md` | **ADOPTED** doctrine (July 16, 2026) — amended by dated entry |
| `docs/RESEARCH_NOTES_COLLECTION.md` §3.1 | **RATIFIED** (July 19, 2026) — consultation and repair for external sources |
| `docs/architecture/SESSION_GOVERNANCE.md` | **SCOPED RULING** (July 17, 2026) — live instruction vs committed record |
| `docs/architecture/COMPOSITION_FROM_PRIMITIVES.md` | **FOUNDATIONAL LESSON** (July 19, 2026) — no default instances; authorizes no build |
| `docs/product/epistemic-support/FOUR_JUDGE_DESIGN.md` | **DESIGN, GOVERNED BY RECONCILIATION** — the co-equality with FOUR_JUDGE_BASIC_MODEL formally ended July 18, 2026; read them together |
| `docs/product/epistemic-support/FOUR_JUDGE_BASIC_MODEL.md` | **SOURCE ARTIFACT** (S10), committed verbatim — takes addenda, not edits |
| `docs/product/epistemic-support/JUDGE_CONTRACT_TEMPLATE.md`, `COMPOSABLE_RUBRICS_DESIGN.md` | **PROPOSED — DESIGN ONLY**; both carry July 19, 2026 corrections |
| `docs/product/epistemic-support/JUDGE_INTAKE_DESIGN.md`, `JUDGE_CONVOCATION_DESIGN.md` | **IMPLEMENTED** (slices 1 and 2); §6 rows merged into RECONCILIATION §5.1/§5.2 |
| `docs/product/epistemic-support/JUDGE_COMPOSITION_CEREMONY.md` | **DESIGN — nothing built** (July 19, 2026) |
| `HANDOFF.md`, `TRELLIS_ROADMAP.md` | **COMPRESSIONS** — volatile truth (branch state, counts, current objective), downstream of the records they summarize |
| `skills/`, agent memory | **DERIVED** — the record wins on drift; a memory is never authority |

## 3. How things connect (the one-paragraph system)

Documents enter through ONE verified transaction
(`src/core/ingestion/`) and become immutable Merkle ASTs in PostgreSQL;
operator-budgeted extraction jobs flow through Redis/BullMQ workers
(`src/workers/`) into Neo4j as entities/relationships carrying
`sourceNodeIds` (block hashes); when a document version orphans blocks,
the invalidation sweep CONTESTS every belief citing them (quarantine
with audit, never delete). The RLM (`src/rlm/`) runs one task per
spawned process with the substrate injected as REPL tools, and answers
by reference through `trellis_answer`; above it, the orchestrator
(`src/core/agent/`) decomposes goals into self-contained tasks. Trust
is tiered: Tier 1 verified bytes, Tier 2 derived belief with
provenance, Tier 3 workspace scratch with ZERO standing — promotion is
the only bridge up. Capability itself is provenance-tracked: modules
cite research hashes and the same sweep contests them when evidence
moves.

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

## 4. Hard rules (permanent — survive every session)

*** CRITICAL ***

1. **Read `HANDOFF.md` before any work.** Its §7 guardrails and §8
   exclusions bind the current session; this list is only the
   never-changing core.
2. **Never mutate an AST node; never persist positional identity.**
   Identity is the SHA-256 Merkle preimage.
3. **Never merge, rename, or delete Entity nodes.** Equivalence is an
   overlay belief; wrong entities are contested or retired.
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
10. **No AI attribution anywhere** — no Co-Authored-By trailers, no
    generated-with footers, in commits, PRs, or code. Plain
    engineering prose.
11. **Report honestly**: publish counts and raw numbers; a null or
    surprising result is a finding; re-run outliers before believing
    them.
12. **One feature branch, one PR to `master`**, and if you ran a
    session: update `TRELLIS_ROADMAP.md` §5 (dated entry, exact
    commands, counts, defects) and regenerate `HANDOFF.md` per its §0
    in the same PR.
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
    sequence it. This norm lives in prose on purpose: it binds an
    agent in a session, not a kernel, and a conformance test asserting
    a property of a transcript cannot fail — which is an unenforced
    invariant wearing a row's clothes.
15. **Correct is not the same claim as reachable.** A passing suite
    says the code is right, never that anything can invoke it. Before
    calling a capability delivered, name its non-test caller — a
    process entrypoint, a package script — and if there is none, say
    so plainly. This repo has shipped the same defect three times:
    `StateStore.open()` with no caller outside tests behind 1,161
    green tests, a seeder whose request digest nobody could produce,
    and both acceptance-ledger recovery ceremonies with no entrypoint
    at all.
16. **Prompt authoring runs the protocols** (permanent; owner-directed
    July 13, 2026). ANY session that creates or edits prompt text — a
    kernel or module addendum, an RLM task text, an agent or sub-agent
    instruction, an extraction or classification prompt, an output
    schema, a hypershot frame, a judge rubric or anchor item — MUST
    FIRST invoke BOTH the `prompt-engineering` and `hypershot-protocol`
    skills and author against their loaded guidance. A process gate
    checked before the bytes are written, never a claim made in prose
    after. Judge-shaped work adds `judge-composition`. (Restated here
    because it is permanent and `HANDOFF.md` §7, its only prior home,
    is regenerated every session.)
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
18. **Retrieve before you decide or claim.** A derived representation
    never satisfies an obligation to its source on a load-bearing act.
    Use `HANDOFF.md`'s compression, a design record, a skill, or a
    memory **to do the work**; **retrieve and quote the source** to
    decide what work to do, or to state what a record establishes. The
    tell: you cannot name the file and section you actually retrieved
    *this session*. A lossy summary reads exactly like a faithful one
    from the inside, so nothing prompts the retrieval that would
    correct it — and in a documents-lead repo the result is a green
    suite around the wrong object. This is
    `docs/architecture/CODE_MEDIATED_TEXT.md` §2.9 (the pillar applied
    to authority) and generalizes the rule already ratified for papers
    in `docs/RESEARCH_NOTES_COLLECTION.md` §3. See §1.5 below for the
    authority ordering it depends on.
19. **Observe before you mutate; verify before you describe; and prove
    the check can fail.** Three habits, one root — acting on a belief
    about state instead of an observation of it.
    (a) **Observe shared state first.** Look at what is already
    running, present, or registered before starting or creating
    anything in it. §2's own instruction to observe actual Git state
    rather than assume applies to containers, databases, and stores
    equally.
    (b) **Verify before you describe.** A commit message is a claim.
    Check it against the diff before making it; never write that
    something was done and then not do it.
    (c) **A verification you have not seen fail is not a
    verification.** Every drill here ships a `--negative-control` that
    must exit 3 for exactly this reason. Before trusting a check that
    passed, know what would make it fail — a check that cannot fail
    reports success on anything, including bytes about to become
    registration hashes.

## 5. Working protocol (commands)

Fresh checkout (worktrees ship without `node_modules`):

    git status --short --branch
    npm ci
    npm test
    npm run build
    npm run python:check

The full live-drill close-out block, with current expected counts, is
maintained in `HANDOFF.md` §6 — run it from there, not from memory.
Live drills need the Compose stack (`docker compose`); paid probes
additionally need `OPENAI_API_KEY` in the SHELL environment (dotenv
never overrides shell env). The Python runtime is pinned by
`requirements.txt`; `npm run python:check` verifies it. CI is Node 22
and installs Python before `npm test` (`block_parity.test.ts` spawns
real Python inside the unit suite).
