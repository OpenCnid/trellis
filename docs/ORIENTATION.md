# Trellis at Five Densities — the chain-of-density orientation ladder

**Status: living orientation aid** (authored July 17, 2026, owner-directed;
maintained by dated entry, never silent edit). This file is subordinate to
everything it summarizes — authority order **code > glossary > prose** binds
here with extra force: if any sentence below disagrees with
[`GLOSSARY.md`](GLOSSARY.md) or with code, the other source wins and this
file has a defect. It is **invariant-only**: no test counts, no module
counts, no current objective — all volatile state lives in `HANDOFF.md`
§2–§3 and the acceptance ledger (`npm run el:activate -- status`).

## How to read this file (the contract)

This file is one system summarized five times at increasing information
density, adapting **chain-of-density** summarization (Adams et al. 2023,
[arXiv:2309.04269](https://arxiv.org/abs/2309.04269): iteratively fold
missing salient entities into a summary of fixed length; human raters
prefer summaries densified to roughly human-written density). The
method's canonical home — the lab's methodology, synthesis prompt, and
note on the paper itself — is
[OpenCnid/chain-of-density](https://github.com/OpenCnid/chain-of-density);
the wider notes collection it anchors is recorded in
[`RESEARCH_NOTES_COLLECTION.md`](RESEARCH_NOTES_COLLECTION.md). The same method also runs in
**system mode** on Trellis itself, as a branching sibling to this single spine — see
[`density-chain/DENSITY-CHAIN.md`](density-chain/DENSITY-CHAIN.md) (one trunk, one fixed-length
branch per subsystem class). Three rules make the ladder safe to stop on at any rung:

1. **Each density is conceptually complete.** What D0 tells you is true
   and self-consistent on its own terms. A deeper layer *adds* entities
   and mechanism; it never corrects a shallower one. If it ever would,
   the shallow layer has a defect — fix it, don't rely on depth.
2. **Stop at the first density that answers your question.** D0–D2
   together are under 700 words; read them always. Read D3 before
   designing anything. Use D4 as the concept→authority index — the
   concept-first transpose of `AGENTS.md` §2, which maps path→content.
3. **Bold marks an entity's first introduction**; every bolded term is
   canonically defined in [`GLOSSARY.md`](GLOSSARY.md) or anchored to
   the named authority document. This file coins no vocabulary of its
   own except "orientation ladder" (this document's mechanism).

---

## D0 — one sentence

Trellis is a runtime in which a language model works only through code —
a persistent Python REPL over stores of verified text and derived belief
— where every belief carries a machine-checked chain of custody to exact
source bytes, is automatically contested when those bytes die, and where
every elevation of trust is a human running a gated command.

## D1 — one paragraph

The model is an **RLM** (Recursive Language Model, the MIT CSAIL
formulation): context is a database, not a scroll, and the model reaches
it by writing code and calling itself over slices. The database has three
trust tiers: **Tier 1**, immutable SHA-256 **Merkle AST** bytes in
PostgreSQL; **Tier 2**, semantic beliefs in Neo4j, each carrying
**sourceNodeIds** — the exact Tier-1 block hashes it was derived from;
**Tier 3**, a working-memory **workspace** with no trust standing at all.
Trust moves in one direction, upward, only through operator-gated
**promotion**. When a source document changes, a Merkle diff finds the
dead bytes and the **invalidation sweep** marks every dependent belief
**contested** — quarantined, audited, recoverable, never silently wrong.
Two **flywheels** compound on this: derived facts are cached once and
reused forever (knowledge), and the system's own operating instructions
are versioned **modules** governed as beliefs (capability). One
discipline binds the model's text handling: **code-mediated text** — the
model never counts, never copies. The living state of the work is
`HANDOFF.md`; the canonical vocabulary is `docs/GLOSSARY.md`.

## D2 — one page

*Everything in D1 holds; this layer adds the machinery by name.*

**Substrate.** Every source (markdown, PDF, code, promoted web content)
enters through one **verified ingest transaction** (persist → read-back
re-hash → membership → registration → in-transaction Merkle diff) and
becomes rows in `ast_nodes`. Re-ingesting a changed document versions it;
the diff drives the sweep. Whole repositories ingest per-file
(`npm run repo:ingest`), with tombstones for deletions. Discovery
surfaces read **live blocks only** — superseded versions are archive,
reachable solely by explicit hash (owner rule, July 13, 2026).

**Execution.** One Python process per task (`src/rlm/trellis_agent.py`)
with the substrate injected as REPL tools: `trellis_neo4j`,
`trellis_postgres`, the workspace, operator-configured **MCP** tools, and
— only when the operator sets `TRELLIS_EDIT_ROOT` — the
**textedit toolkit**. The single agentic write path is
`write_derived_insight`: every cited hash must be 64-hex, must exist in
`ast_nodes`, and (on research runs) must have been actually retrieved
this run. Answers leave the run **by reference** (`trellis_answer`),
never retyped. Above single tasks, a tool-free **orchestrator**
decomposes goals into bounded RLM tasks and routes workspace state
between them by reference (**lineage**); external agents can reach the
same loop over **A2A**. All LLM work crosses one Zod boundary
(`parseLlmResponse`) via bounded Redis/BullMQ queues.

**Self-governance.** Modules live as manifest + brace-free addendum,
composed into the system prompt under a sha-pinned kernel. A
research-bearing module cites promoted sources, is registered as a graph
entity, and is contested by the ordinary sweep when its research basis
dies — capabilities are beliefs. Module drafting runs under
**grounded authoring**: the author model sees only a seeded corpus and
the harness pins the citations, because the first flywheel turn observed
**provenance laundering** live (real-but-unrelated hashes cited under a
count incentive; only semantic entailment detects it — never reward
citation count). House doctrine since the module-#2 control: behavioral
failure classes close by **tooling shape**; prompts only reinforce.

**Second axis.** Orthogonal to custody (*where from*), **epistemic
support** (*how has it held up*) is an adopted forward design: a graded
opinion (b, d, u) computed sweep-side from judged events, never asserted
by the writer; support never mints custody.

**Culture.** The repo is document-driven (design records lead); every
capability claim traces to a dated report in `docs/benchmarks/`
(`CRITIQUE_AND_FUTURE.md` is the honest ledger of what is *not* proven);
every change follows the triple
`{Behavior_You_Want} → {Tooling_That_Enforces_It} → {Pin_That_Detects_Drift}`;
paid LLM work is owner-gated with a printed estimate first.

## D3 — the working model

*Everything in D2 holds; this layer is what a session needs before
designing a change.*

### 3.1 Substrate and custody

A Merkle AST's node identity is the SHA-256 of its content plus its
children's hashes — identity *is* content, as in git, which is why
positional addressing is never persisted (the Shift Problem;
`docs/architecture/MATHEMATICAL_FOUNDATIONS.md`). The ingest transaction
re-hashes what it persisted before committing. Documents have stable keys
(`repo:<key>:<path>`, `web:<url>`, `book:…`) so a changed source is a new
*version* of the same identity, and the in-transaction diff yields
exactly the orphaned blocks. The measured founding claim: a 5% corpus
mutation contested exactly the affected cached facts, recall and
precision 1.000 (`docs/benchmarks/UPDATE_DRILL_REPORT.md`).

### 3.2 Belief lifecycle

Extraction workers (operator-budgeted, never default) derive Neo4j
entities and relationships; the quarantine state machine
(`contested`/`orphanedSourceIds`/`rederivedAt`) governs their whole life.
Entity identity is immutable — equivalence is an overlay belief
(`SAME_AS`, adjudicated by the resolution worker, one trusted hop at
retrieval). Nothing is deleted; wrong beliefs are contested or retired
with audit history. Provenance proves *origin*, never *correctness* —
correctness is the support axis's job (§3.6).

### 3.3 The execution discipline

**Code-mediated text** (`docs/architecture/CODE_MEDIATED_TEXT.md`, core
pillar) unifies two observed failure classes — localization error and
transcription error — as one pathology: *attention doing code's job*.
Enforcement is tooling shape: locations are **engine-computed addresses**
returned by query (`locate`, `get_ast_blocks`); existing bytes move by
`splice` at computed ranges under **hash-guarded writes** (`write_back`
refuses stale digests); answers travel by reference. The workspace
captures every external result mechanically *inside the tool call* —
origin-stamped **segments** the model cannot forget to file or forge —
and retrieval spend is disciplined by held-state dedup and per-run
budgets (`docs/architecture/RETRIEVAL_DISCIPLINE.md`). Paired-run
measurements of the discipline live in
`docs/benchmarks/EFFECTIVE_CONTEXT_PROBE_REPORT.md`.

### 3.4 Flywheels, modules, and the laundering lesson

The knowledge flywheel's economics: a stateless recursive baseline pays
per query forever; Trellis derives once, caches with provenance, and the
sweep keeps the cache honest (`docs/benchmarks/FLYWHEEL_EXPLAINER.md`).
The capability flywheel applies the same law to instructions — but its
first turn taught the repo's most load-bearing lesson: asked to cite
sources, the model laundered (cited real, existing, *unrelated* hashes).
The remediation is structural, in three parts: scoped authoring (the
author sees only the corpus), harness-pinned citations (the model never
supplies provenance), and a derivation gate scoring engagement with
corpus-specific anchors (`docs/architecture/GROUNDED_AUTHORING.md`,
`docs/benchmarks/PROVENANCE_CITATION_AB_REPORT.md`). The follow-on
measurement (module #2's paired control) set permanent doctrine: close
failure classes with tooling shape — dedup, budgets, typed refusals —
not prompt modules.

### 3.5 Session governance

`HANDOFF.md` §0 is the **handoff loop**: the file is both the prompt
that starts a session and the deliverable the session must regenerate —
the manual prototype of the capability flywheel. Its §3 is the only
objective authority; sessions do not select their own work. Hard rules
live in `AGENTS.md` §4; two deserve early attention from any newcomer:
**correct is not reachable** (a passing suite never proves a caller
exists — name the non-test entrypoint or say plainly there is none) and
**a protected pause refuses only the effect it names** (an owner gate on
one effect is not authorization to stand down unblocked work). The
**engineering loop** program (`docs/architecture/ENGINEERING_LOOP.md`,
`tools/engineering-loop/SPEC.md`) mechanizes the session loop itself;
its activation and acceptance state live in the **acceptance ledger**
(`npm run el:activate -- status`) — never in Git and never in prose.

### 3.6 The support axis

Epistemic support (`docs/architecture/EPISTEMIC_SUPPORT.md`;
program documents `docs/product/epistemic-support/`) grades how a belief
has held up: **judge ops** — single-question drawback detectors
returning `drawback | clean | abstain` from closed taxonomies — feed a
sweep-side opinion (belief, disbelief, uncertainty; b+d+u=1). `clean`
never certifies correctness; a fresh belief starts at maximal
uncertainty; the writer never sees or asserts its own support. The
program's evidence register and adoption bounds live in
`docs/product/epistemic-support/RESEARCH_MAP.md`.

### 3.7 Where the humans are

Every trust elevation is a human at a gated CLI: `npm run promote`
(Tier 3 → Tier 1, the only bridge), `npm run modules:register`,
authoring spend (`--confirm-paid`), extraction spend
(`--confirm-extraction`, explicit block budgets), file editing
(`TRELLIS_EDIT_ROOT`, per run), and every change landing as one reviewed
PR to `master`. Paid runs are proposed with a printed estimate, hard
capped, and reported with actuals. Trellis may edit Trellis (content
pool + standard permissions), but edits land between runs through source
control — never as mid-run mutation.

### 3.8 Evidence culture

A claim without a dated report is a hypothesis; `docs/benchmarks/` holds
the reports and `docs/benchmarks/CRITIQUE_AND_FUTURE.md` holds the open
critiques. Null and surprising results are findings; outliers are re-run
before they are believed; counts and correctness are always reported
together. Documents are written agents-first — every document is a
prompt for a cold-start reader who cannot ask questions
(`docs/product/epistemic-support/IEG_TEACHINGS.md` §6, the authoring
canon this file follows).

## D4 — the dense index (concept → hook → authority)

*The transpose of `AGENTS.md` §2. One line per entity; the pointer is
the authority.*

### Execution model

| Entity | Hook | Authority |
|---|---|---|
| RLM | model + REPL, context as database, `llm_query` over slices | `docs/benchmarks/FLYWHEEL_EXPLAINER.md` |
| REPL namespace | persistent locals across turns = working memory | `GLOSSARY.md` |
| Kernel / userspace | trust core shipped as code / per-run composed modules | `docs/architecture/WORKSPACE_AND_MODULES.md` |
| Orchestrator | tool-free planner; decomposes goals; routes by reference | `src/core/agent/`, `API_REFERENCE.md` §4 |
| A2A surface | one goal per external task, same gates and bounds, off by default | root `README.md`, `API_REFERENCE.md` §5 |
| MCP tools | operator-allowlisted external tools; results are research context, never provenance | root `README.md` |
| UPSUM | code-checked size-budgeted state summary between REPL stages | `src/rlm/trellis_scaffold.py`, `docs/architecture/RLM_HARNESS_SCAFFOLDING.md` |

### Substrate and custody

| Entity | Hook | Authority |
|---|---|---|
| Merkle AST | content-addressed tree; identity is the SHA-256 preimage | `docs/architecture/MATHEMATICAL_FOUNDATIONS.md` |
| Verified ingest | persist → read-back re-hash → membership → Merkle diff, one transaction | `src/core/ingestion/` |
| sourceNodeIds | the only values with provenance standing; 64-hex, must exist | `GLOSSARY.md`, `src/rlm/trellis_tools.py` |
| Live-by-default retrieval | discovery reads current-version blocks only; history by explicit hash | `AGENTS.md` §4 rule 13 |
| Repository ingestion | per-file documents, snapshots, tombstones; paid extraction gated | root `README.md`, `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md` |
| Structural chunking | cAST-style size-budgeted syntax-aligned code blocks | `docs/architecture/STRUCTURAL_CHUNKING.md` |

### Belief lifecycle

| Entity | Hook | Authority |
|---|---|---|
| Contested / quarantine | evidence died → excluded, audited, recoverable | `GLOSSARY.md`, `src/core/graph/` |
| Invalidation sweep | Merkle diff → contest exactly the dependent beliefs | `docs/benchmarks/UPDATE_DRILL_REPORT.md` |
| Entity identity | immutable; equivalence is a `SAME_AS` overlay belief | `AGENTS.md` §4 rule 3 |
| Write path | `write_derived_insight`, the single agentic mutation | `src/rlm/trellis_tools.py` |
| Retrieval-membership gate | cite only what this run actually retrieved | `docs/architecture/PROVENANCE_THREADING.md` |

### Working state and trust movement

| Entity | Hook | Authority |
|---|---|---|
| Workspace / segment | Tier-3 scratch; origin stamped mechanically in the tool call | `src/rlm/trellis_workspace.py` |
| Lineage | park at task end, seed later tasks, by reference, TTL-bounded | root `README.md`, `docs/benchmarks/WORKSPACE_LINEAGE_PROBE_REPORT.md` |
| Promotion | operator CLI; segment → verified ingest → citable substrate; only bridge up | `src/core/promotion/` |

### Flywheels and modules

| Entity | Hook | Authority |
|---|---|---|
| Knowledge flywheel | derive once, cache with provenance, sweep keeps it honest | `docs/benchmarks/FLYWHEEL_EXPLAINER.md` |
| Capability flywheel | modules as beliefs; sweep contests instructions too | `docs/architecture/WORKSPACE_AND_MODULES.md` |
| Module | manifest + brace-free addendum; sha-pinned composition | `modules/`, `src/rlm/trellis_modules.py` |
| Grounded authoring | scoped corpus, harness-pinned citations, derivation gate | `docs/architecture/GROUNDED_AUTHORING.md` |
| Provenance laundering | real-but-unrelated hashes under a count incentive; entailment catches it | `docs/benchmarks/PROVENANCE_CITATION_AB_REPORT.md` |
| Tooling over prompts | failure classes close by tooling shape; prompts reinforce | `AGENTS.md` §4 rule 8 |

### The text discipline

| Entity | Hook | Authority |
|---|---|---|
| Code-mediated text | the model never counts, never copies | `docs/architecture/CODE_MEDIATED_TEXT.md` |
| Engine-computed address | locations by query, transient by definition; re-query, never remember | `GLOSSARY.md` |
| Hash-guarded write | stale digest → loud refusal, never overwrite | `src/rlm/trellis_textedit.py` |
| Answer by reference | results leave the run as addresses, never retyped prose | `src/rlm/trellis_answer.py` |
| Retrieval discipline | held-state dedup + per-run budgets at the Tier-1 surfaces | `docs/architecture/RETRIEVAL_DISCIPLINE.md` |

### The support axis

| Entity | Hook | Authority |
|---|---|---|
| Epistemic support | (b, d, u) sweep-side; support never mints custody | `docs/architecture/EPISTEMIC_SUPPORT.md` |
| Judge op | drawback \| clean \| abstain; clean ≠ correct | `GLOSSARY.md` |
| Judge composition | composed per context from primitives; no default cast; twenty rules are binding law | `docs/product/epistemic-support/JUDGE_COMPOSITION_GAME.md` |
| Composition from primitives | frames invariant, instances never; an encoded instance has become law | `docs/architecture/COMPOSITION_FROM_PRIMITIVES.md` |
| Derived-source substitution | a derivation never discharges an obligation to its source on a load-bearing act | `docs/architecture/CODE_MEDIATED_TEXT.md` §2.9 |
| Authority ordering | ratified → adopted → design → compression → derived; live instruction outranks the record | `AGENTS.md` §1.5 |
| Panel law | role definitions, R-29 gates, R-30 no-global-section; governs the older four-judge records | `docs/product/epistemic-support/RECONCILIATION.md` |
| Evidence register | sources, claims, adoption bounds, by dated entry | `docs/product/epistemic-support/RESEARCH_MAP.md` |
| IEG | collaborator's exchange-geometry frame; design vocabulary only (AB-1) | `docs/product/epistemic-support/IEG_TEACHINGS.md` |

### Governance and process

| Entity | Hook | Authority |
|---|---|---|
| Authority order | code > glossary > prose across the committed record; a collaborator's live instruction outranks it | `AGENTS.md`, `docs/architecture/SESSION_GOVERNANCE.md` |
| Handoff loop | the session prompt regenerates itself; §3 is the only objective authority | `HANDOFF.md` §0 |
| Engineering loop | the session loop mechanized; status in the acceptance ledger only | `docs/architecture/ENGINEERING_LOOP.md`, `tools/engineering-loop/SPEC.md` |
| Change triple | behavior → enforcing tooling → drift-detecting pin | `AGENTS.md` §3 |
| Byte-identical-when-absent | unconfigured feature = byte-identical prompt and behavior, pinned | `GLOSSARY.md` |
| Correct ≠ reachable | name the non-test caller or say there is none | `AGENTS.md` §4 rule 15 |
| Protected pause | refuses the named effect and nothing more | `AGENTS.md` §4 rule 14 |
| Owner gates | promotion, registration, paid spend, edit root, merges | root `README.md` |
| Honest ledger | open critiques and unproven claims, kept current | `docs/benchmarks/CRITIQUE_AND_FUTURE.md` |
| Agent-first authoring canon | every document is a prompt for a reader who cannot ask | `docs/product/epistemic-support/IEG_TEACHINGS.md` §6 |

---

## Maintaining the ladder (the method, applied to itself)

Per-layer budgets are fixed: D0 ≤ 60 words, D1 ≤ 180, D2 ≤ 550, D3 ≤
1,400, D4 one line per entity. Maintenance is densification, never
elongation:

- **New machinery enters at D4 first** — one row, one hook, one
  authority. It rises to D3 only if a session needs it before designing;
  to D2 only if the one-page story is wrong without it; D1/D0 change
  only when the *concept* of the system changes.
- **At a fixed budget, adding means compressing or evicting** something
  less salient — and the eviction is visible in the diff, reviewed like
  any edit (dated entries, never silent).
- **The layer test on every edit:** each layer read alone must still be
  true and self-consistent; a deeper layer may add, never contradict.
- **Counts stay out** (the pointers-never-counts rule): the ladder names
  mechanisms and points at authorities; anything that drifts with the
  week belongs in `HANDOFF.md` or the ledger.

## Postscript — density as custody

**Status: PROPOSED, unratified** (recorded July 17, 2026 at owner
direction as thinking, not design; no roadmap row, no implementation,
no acceptance drill — this section is inert until the owner sequences
it).

Summarization is the most custody-destroying operation in any LLM
pipeline: a summary is a new text whose every sentence silently
launders its sources. Chain-of-density suggests a tooling shape that
could change that. A CoD pass is a sequence of *diffs*: each iteration
names exactly which missing salient entities entered, at fixed length.
If the harness — never the model, the grounded-authoring mold — pinned
each entering entity to the source hashes it came from, a summary would
become a layered object with per-entity custody:

    {Layer_K} + [{Entity_Added} ← {Harness_Pinned_Source_Hashes}] → {Layer_K_Plus_1_Same_Length}

The invalidation sweep could then reach summaries the way it reaches
modules: when a cited block dies, contest exactly the layers whose
entities cite it, keep the rest. The derivation gate already scores a
draft's coverage of corpus-specific anchors — that gate and CoD
densification are the same operation run in opposite directions (check
entities present / add entities missing), so half the machinery has a
shipped precedent. Natural seams, if ever ratified: UPSUM (the
scaffold's budgeted state summary), `HANDOFF.md` regeneration, and this
file's own maintenance. Honest residual, stated up front: entity
salience is a model judgment — sampled, not engine-decidable — so this
would close the membership half and leave a semantic residual — the
same claim→block factorization `PROVENANCE_THREADING.md` records
(membership engine-decidable and total, support sampled). Before
any build: an acceptance drill and a paired-run probe showing pinned
densification preserves entity custody where free summarization drops
it.
