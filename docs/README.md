# Trellis Engine Documentation

Trellis is document-driven (DDD): design records lead, implementation
follows, and every document is part of the system's accumulated
experience. Authority is explicit — **code > glossary > prose** — and
each document below states whether it is living doctrine, measured
evidence, or preserved history. A session loads root
[`AGENTS.md`](../AGENTS.md) first, then uses
[`ORIENTATION.md`](ORIENTATION.md) and the task's governing source
records; the root [`README.md`](../README.md) is a bounded router.

Paths here are markdown links, not backticked strings, so
`npm run check:repo-surface` fails when one goes stale.

## Reading order

### 1. Orientation (start here)

- **Root [`AGENTS.md`](../AGENTS.md)** — the entry point for coding agents, CLIs, and
  harnesses: the study protocol, the navigation map (which directory
  owns what; where each behavior's enforcement and pins live), and the
  permanent hard rules. Deliberately invariant-only; the collaborator's
  live task supplies volatile objective and scope.
- **Root [`README.md`](../README.md)** — the bounded repository router and fast path.
- **[`operations/OPERATOR_MANUAL.md`](operations/OPERATOR_MANUAL.md)** —
  the full system explanation and operator manual formerly housed at root.
- **[`ORIENTATION.md`](ORIENTATION.md)** — the chain-of-density
  orientation ladder: the whole system summarized five times at
  increasing density (D0 one sentence → D4 the concept-first index),
  each layer conceptually complete and safe to stop at. The on-ramp
  when the primary documents feel dense; subordinate to the glossary
  and code.
- **[`GLOSSARY.md`](GLOSSARY.md)** — canonical one-line definitions for
  every term that carries architectural load. If prose conflicts with
  this file, the prose has a defect; if this file conflicts with code,
  the code wins.
- **Root [`HANDOFF.md`](../HANDOFF.md)** — a deprecated compatibility router. It contains no
  objective or current baseline and is never a source of current work.
- **[`COLLABORATOR_BRIEFING.md`](COLLABORATOR_BRIEFING.md)** — the
  three-altitude briefing for a technically fluent outsider: where the
  work is right now, the system it lives inside, and the mechanisms one
  level down.
- **[`RESEARCH_NOTES_COLLECTION.md`](RESEARCH_NOTES_COLLECTION.md)** —
  the pointer record for the OpenCnid research-notes collection (one
  GitHub repo per studied paper: five-tier chain-of-density notes,
  locator-verified, machine-readable pins in `index.json`, no hosted
  PDFs), the authority ordering that keeps notes from masquerading as
  primary evidence, and the PROPOSED ingestion/staleness contract for
  consuming the collection.

### 2. Doctrine and forward design (`/architecture` — living)

- **[`WORKSPACE_AND_MODULES.md`](architecture/WORKSPACE_AND_MODULES.md)**
  — the parent design record: governing axioms, the two flywheels, the
  three-tier trust model, the workspace contract, lineage, promotion,
  self-editing (content pool + standard permissions), kernel/userspace,
  and the module system.
- **[`CODE_MEDIATED_TEXT.md`](architecture/CODE_MEDIATED_TEXT.md)** —
  the core pillar, doctrine on par with the provenance invariant: *the
  model never counts, and the model never copies.* Includes the measured
  structure-selection study and the implementation record of the editing
  toolkit and kernel prompt revision.
- **[`GROUNDED_AUTHORING.md`](architecture/GROUNDED_AUTHORING.md)** —
  the authoring-mode design record: the provenance-laundering finding
  from the first flywheel turn and the structural remediation (scoped
  access, harness-pinned attribution, derivation gates, verification
  tiers).
- **[`PROVENANCE_THREADING.md`](architecture/PROVENANCE_THREADING.md)**
  — the write-path closure design record (roadmap §4 row 9): the
  retrieval-set definition, the claim→block factorization (mechanical
  membership vs the sampled semantic residual), and the slice map that
  constrains citable addresses to what the deriving run actually
  retrieved.
- **[`RETRIEVAL_DISCIPLINE.md`](architecture/RETRIEVAL_DISCIPLINE.md)**
  — the retrieval-spend closure design record (roadmap §4 row 10):
  held-state dedup (typed refusals for repeat fetches) and the per-run
  retrieval budget at the three Tier-1 retrieval surfaces — the
  code-mediated-text pillar applied to retrieval spend, closing the
  failure class the retired module #2 nudged.
- **[`STRUCTURAL_CHUNKING.md`](architecture/STRUCTURAL_CHUNKING.md)**
  — the code-substrate granularity upgrade (roadmap §4 row 12;
  increments 1–2 implemented, Sessions 38–40, with the paid extraction
  pilot owner-gated per its §7): cAST-style size-budgeted
  syntax-aligned chunking over a generic tree seam, `web-tree-sitter`
  as the scaling engine, typed gap blocks as extraction-spend control;
  five-part pilot criterion pre-stated.
- **[`MATHEMATICAL_FOUNDATIONS.md`](architecture/MATHEMATICAL_FOUNDATIONS.md)**
  — the timeless substrate math: Merkle trees, content addressing, and
  why cryptographic identity solves the Shift Problem that positional
  addressing cannot.
- **[`EPISTEMIC_SUPPORT.md`](architecture/EPISTEMIC_SUPPORT.md)** — the
  second belief axis (adopted forward design, July 16, 2026): graded,
  judge-computed support opinions (b, d, u) orthogonal to the custody
  tiers; plane geometry, v1 arithmetic and metric grammar (drill-pinned),
  the judge layer, and the automation ladder. Working documents in
  `docs/product/epistemic-support/`. Its §5 states the judge layer as a
  standing cast; read it against `COMPOSITION_FROM_PRIMITIVES.md` below,
  which governs.
- **[`COMPOSITION_FROM_PRIMITIVES.md`](architecture/COMPOSITION_FROM_PRIMITIVES.md)**
  — **foundational lesson** (July 19, 2026): harness functions compose
  per context from categoric primitives, and there are no default
  instances. Frames are invariant; instances are not, and an instance
  that reaches a schema, byte-pin, or registration has silently become
  law. Judges are the worked example — including the case where this
  house lost the principle across seven documents and built the roster
  the rules forbid.
- **[`DOUBTS_WORKSPACE.md`](architecture/DOUBTS_WORKSPACE.md)** —
  **DESIGN, PROPOSED July 20, 2026, nothing built.** The third REPL
  type. Today `-1` is *residual* — the absence of support plus a label
  (`contestedReason`); this makes it constructed. Support composes as a
  cover, defeat as a search, so defeaters are never judges with an
  inverted sign. Scoped by the owner as a general critique engine, not a
  Trellis-only mechanism. **Read §11 and §12 before §2:** the keystone
  corrosion bound (*a doubt may cite facts only*) was **falsified by
  adversarial analysis the day it was written** (§11), then **partly
  recovered** (§12) — its positive-citation core was empirically
  validated against a real corpus of flat-earth arguments (13 of 14
  rejected, `fixtures/doubts_workspace/`), and the relevance gap resolved
  to a second layer (the applicability gate handles relevance; §2 handles
  positivity). The bootstrap and cost gaps stay open; nothing is built
  against §2 until they close. The test itself is a **derivation** test,
  not a citation test — which is why it catches corrosive doubt, whose
  defects are inferential.
- **[`RESIDUAL_STREAM_SIDECAR.md`](architecture/RESIDUAL_STREAM_SIDECAR.md)**
  — **future project, out of scope** (recorded July 17, 2026): the
  functional-affect instrumentation-and-control record — the evidence
  anchor (Anthropic's emotion-concepts paper), the owner-agreed bounds
  on any read/write sidecar, the mixture-candidate ladder, the
  percolative-Ising controller frame with typed caveats, and the
  prerequisite sequence (hosted A/B → local model → sidecar). Binds
  nothing until the owner sequences it; its §10 claims table carries
  the standings.
- **[`SESSION_GOVERNANCE.md`](architecture/SESSION_GOVERNANCE.md)** —
  the session-governance scoping record (adopted July 17, 2026): the
  substrate's provenance/quarantine/ratification law governs the
  beliefs Trellis stores, not the engineering session that builds
  Trellis; sessions run on ordinary source-control collaboration, a
  collaborator's clear current instruction outranks the committed
  record, and genuine ambiguity is one clarifying question, then
  action. Carries the verbatim scoping note and the application
  record.
- **[`REPOSITORY_ROOT_CONTRACT.md`](architecture/REPOSITORY_ROOT_CONTRACT.md)**
  — **RATIFIED July 21, 2026**: the repository's own surface as a
  machine-checkable contract — permitted root files with byte caps,
  permitted directories, deprecation markers, and the link and
  environment-coverage rules. Prose and machine twin change together,
  and `npm run check:repo-surface` (plus its `--negative-control`)
  is what proves it.
- **[`SELF_DESCRIBING_SURFACES.md`](architecture/SELF_DESCRIBING_SURFACES.md)**
  and **[`LLM_HELP_SPEC.md`](architecture/LLM_HELP_SPEC.md)** —
  **PROPOSED / UNRATIFIED (July 21, 2026)**: the program for surfaces
  that describe themselves to the agent operating them, with the
  description *derived from the guards that enforce behavior* rather
  than authored beside them. Prior art credited to MASH
  (Matthew Murphy). Companion:
  **[`HARNESS_SELF_MODEL.md`](architecture/HARNESS_SELF_MODEL.md)** —
  **principle endorsed, implementation not authorized**.
- [`ARCHITECTURE.md`](architecture/ARCHITECTURE.md),
  [`SYSTEM_ARCHITECTURE.md`](architecture/SYSTEM_ARCHITECTURE.md),
  [`TECHNICAL_SPEC.md`](architecture/TECHNICAL_SPEC.md) —
  **historical (Phase 1 MVP era)**, preserved as the record of the
  original substrate design. Read them for lineage, not current truth.

### 3. Evidence (`/benchmarks` — measured)

Every capability claim in the living docs traces to a dated report here:

- **[`FLYWHEEL_EXPLAINER.md`](benchmarks/FLYWHEEL_EXPLAINER.md)** — the
  RLM formulation and the knowledge-flywheel economics (why a stateless
  recursive baseline pays per query forever and Trellis pays once).
- **[`OOLONG_BENCHMARK_REPORT.md`](benchmarks/OOLONG_BENCHMARK_REPORT.md)**
  — the saturated flywheel baseline (F1 = 1.000).
- **[`UPDATE_DRILL_REPORT.md`](benchmarks/UPDATE_DRILL_REPORT.md)** — the
  founding claim tested: 5% corpus mutation → exactly the affected facts
  contested (recall/precision 1.000), perfect post-update answers.
- **[`POISONING_DRILL_REPORT.md`](benchmarks/POISONING_DRILL_REPORT.md)**
  — the verification layer against seeded bad facts.
- **[`SCALE_PROVENANCE_REPORT.md`](benchmarks/SCALE_PROVENANCE_REPORT.md)**
  — the provenance-cardinality migration gate (closed at 286 max
  sources; explicit reopen triggers recorded).
- **[`REPOSITORY_INGESTION_REPORT.md`](benchmarks/REPOSITORY_INGESTION_REPORT.md)**
  — whole-codebase ingestion acceptance plus the extraction-pilot
  findings that gate repository-scale extraction.
- **[`WORKSPACE_PROBE_REPORT.md`](benchmarks/WORKSPACE_PROBE_REPORT.md)**
  / **[`WORKSPACE_LINEAGE_PROBE_REPORT.md`](benchmarks/WORKSPACE_LINEAGE_PROBE_REPORT.md)**
  — paired-run measurements of the Tier-3 workspace and cross-task
  lineage (external-call halving; directional, n=1 per arm).
- **[`PROVENANCE_CITATION_AB_REPORT.md`](benchmarks/PROVENANCE_CITATION_AB_REPORT.md)**
  — the citation-laundering measurement campaign: laundering is
  incentive-driven, prompts don't stop it, only semantic entailment
  does; never reward citation count.
- **[`EFFECTIVE_CONTEXT_PROBE_REPORT.md`](benchmarks/EFFECTIVE_CONTEXT_PROBE_REPORT.md)**
  — the effective-context probe, rounds 1-4: paired-run
  measurements of the code-mediated-text discipline over the
  committed corpora.
- **[`WALL_CLOCK_TEXT_OPS_REPORT.md`](benchmarks/WALL_CLOCK_TEXT_OPS_REPORT.md)** —
  wall-clock benchmark of Python-native versus polars text operations at the
  2-million-token floor: insertion stays Python-native, while disambiguation
  is polars territory from about 100k tokens up.
- **[`CRITIQUE_AND_FUTURE.md`](benchmarks/CRITIQUE_AND_FUTURE.md)** —
  the honest ledger: open critiques, known limits, and what has not been
  proven yet.

### 4. Operations (`/operations`)

- **[`RUNBOOK.md`](operations/RUNBOOK.md)** — diagnostics and recovery
  for PostgreSQL, Neo4j, Redis/BullMQ, the release checklist, and the
  observability surfaces.
- **[`OOLONG_BENCHMARK_GUIDE.md`](operations/OOLONG_BENCHMARK_GUIDE.md)**
  — running the benchmark harness.

### 5. Product history (`/product` — historical)

The founding documents, preserved as written: the original pitch and PRD
(the "provenance-preserving GraphRAG" era), the phase PRDs that scheduled
the invalidation loop and the verification layer, the benchmark specs,
and the validation strategy. They record why the substrate was built the
way it was; the system-level framing has since moved on (root
`README.md`, "What Trellis is").

Active research/planning tracks also live here, one directory per
program (the [`engineering-loop/`](product/engineering-loop/ROADMAP.md)
pattern):

- **[`repl-sandbox/`](product/repl-sandbox/README.md)** — the isolation
  program for the RLM's Python REPL. **DESIGN records; decisions owner-ratified
  July 20–21, 2026; NOTHING BUILT and owner-gated.** Today the REPL runs
  model-authored Python in-process on the host with live database credentials in
  the namespace; this program is the boundary that does not yet exist. Its
  load-bearing move is a data-flow rule rather than content inspection — the
  executing code may *address* data but never *hold* it, so a sanctioned outbound
  channel cannot leak what was never materialized
  ([`DATA_MODEL`](product/repl-sandbox/REPL_SANDBOX_DATA_MODEL.md)). Read
  [`README.md`](product/repl-sandbox/README.md) first, then
  [`ARCHITECTURE`](product/repl-sandbox/REPL_SANDBOX_ARCHITECTURE.md),
  [`THREAT_MODEL`](product/repl-sandbox/REPL_SANDBOX_THREAT_MODEL.md) and
  [`BUILD_PLAN`](product/repl-sandbox/REPL_SANDBOX_BUILD_PLAN.md). One record is
  **not** ratified —
  [`DOUBT_FILTER`](product/repl-sandbox/REPL_SANDBOX_DOUBT_FILTER.md) is
  **PROPOSED**, composes the `-1` doubt tier, and is defense in depth, never the
  boundary.

- **[`epistemic-support/`](product/epistemic-support/PROGRAM_CONTEXT.md)**
  — the epistemic-support program (doctrine ADOPTED July 16, 2026 —
  `docs/architecture/EPISTEMIC_SUPPORT.md`; the oracle drill, judge
  intake, and judge convocation are IMPLEMENTED —
  `npm run test:support-oracle`, `test:judge-intake`,
  `test:judge-convocation`; no live judge run has ever executed and
  the paid queue is on hold).

  **[`STANDING_MODEL.md`](product/epistemic-support/STANDING_MODEL.md)**
  (RATIFIED as principle, July 20, 2026) is how a claim is *valued*: one
  signed-ternary standing axis (`-1` doubt / `0` belief / `+1` fact),
  user-gated ratification with a non-decaying in-address qualifier, and
  the principle that **the panel never moves standing — it records
  findings and the user gates**. Ratified as principle only; it
  authorizes no build, and two carve-outs (§3 removes no code; the
  corrosion bound is validated-core-only) mark where ratification stops.
  Its `-1` tier is `docs/architecture/DOUBTS_WORKSPACE.md` (§14
  ratification).

  **Read [`JUDGE_COMPOSITION_GAME.md`](product/epistemic-support/JUDGE_COMPOSITION_GAME.md)
  first.** It is the ratified
  canonical record for how judges are composed — twenty rules that are
  binding program law, cited by number and never restated — and it is
  the most instructive document the program has. Its companion is
  [`COMPOSITION_FROM_PRIMITIVES.md`](architecture/COMPOSITION_FROM_PRIMITIVES.md), which states the
  principle in general form: judges compose per context from parameter
  registries, and **there is no default cast**. Several older records
  below encode a standing four-judge roster and are being corrected;
  where they and the game record differ, the game record governs. The
  harness skills that carry these compositions out in an agent runtime are
  versioned as project skills at [`.claude/skills/`](../.claude/skills/README.md)
  — loaded for anyone working in the repo, governed by the records above.

  [`PRIMITIVE_ENCODING_AUDIT.md`](product/epistemic-support/PRIMITIVE_ENCODING_AUDIT.md) (FINDINGS, July 19, 2026) is what that
  correction has not yet reached: five verified statements about bytes
  in this repository, each with the command that re-checks it. The
  engine froze the two layers S10 presented as examples and dropped or
  left decorative the two it called primitive — `orientation` is
  specified four times in ratified `RECONCILIATION.md` and appears
  nowhere in [`src/`](../src/), and AB-7 has no enforcement code. Findings only;
  every correction named there is an owner act by dated entry.

  [`JUDGE_COMPOSITION_CEREMONY.md`](product/epistemic-support/JUDGE_COMPOSITION_CEREMONY.md) (DESIGN, July 19, 2026) is how that
  governance cashes out in a promotion: judges, taxonomies and anchors
  are all composed at ceremony time from a descriptive characterization
  of the REPL's fact and belief spaces, by a composer that never sees
  the candidate.

  Then: [`RECONCILIATION.md`](product/epistemic-support/RECONCILIATION.md)
  (RATIFIED July 18, 2026) is the panel law
  and governs [`FOUR_JUDGE_DESIGN.md`](product/epistemic-support/FOUR_JUDGE_DESIGN.md)
  / [`FOUR_JUDGE_BASIC_MODEL.md`](product/epistemic-support/FOUR_JUDGE_BASIC_MODEL.md)
  wherever they differ — their co-equality formally ended;
  [`PROGRAM_CONTEXT.md`](product/epistemic-support/PROGRAM_CONTEXT.md)
  is the entry point, orientation, and owner
  decision record; [`RESEARCH_MAP.md`](product/epistemic-support/RESEARCH_MAP.md)
  the evidence register (its own
  header carries the authoritative source/claim counts;
  adoption-bounds register in §9); `FOUR_JUDGE_BASIC_MODEL.md` (S10,
  the collaborator's source) is where the primitives are stated —
  registries, not judges; `FOUR_JUDGE_DESIGN.md` the originating
  architecture, read with RECONCILIATION beside it;
  [`JUDGE_CONTRACT_TEMPLATE.md`](product/epistemic-support/JUDGE_CONTRACT_TEMPLATE.md)
  the prompt-facing frames;
  [`COMPOSABLE_RUBRICS_DESIGN.md`](product/epistemic-support/COMPOSABLE_RUBRICS_DESIGN.md)
  the rubric-construction direction
  (owner ruling 4, BUILD — its "adaptive means selection" definition
  is under re-decision);
  [`JUDGE_INTAKE_DESIGN.md`](product/epistemic-support/JUDGE_INTAKE_DESIGN.md) and
  [`JUDGE_CONVOCATION_DESIGN.md`](product/epistemic-support/JUDGE_CONVOCATION_DESIGN.md)
  the two implemented slices;
  [`ORACLE_DRILL_PROPOSAL.md`](product/epistemic-support/ORACLE_DRILL_PROPOSAL.md)
  the first drill's
  record (implemented; its header carries the observed runs);
  [`IEG_TEACHINGS.md`](product/epistemic-support/IEG_TEACHINGS.md)
  the July 17, 2026 teaching record behind the
  register's S13 rows (the collaborator's UIT-IEG framework,
  registered at his request — R-32…R-38, synthesis §4.11; design
  vocabulary only per AB-1): the laws, the understanding ladder,
  and the PROPOSED change queue spanning the support plane, the hash
  authority, the engine's audit-era Tier-1 debts, and the substrate
  pipeline (its §5 table is authoritative for the rows).

### 6. Progress-log archive (`/archive` — historical)

- **[`archive/TRELLIS_ROADMAP_DEPRECATED.md`](archive/TRELLIS_ROADMAP_DEPRECATED.md)**
  — the former root technical roadmap and session ledger through Session 71,
  preserved for history and never used to select current work.
- **[`archive/ROADMAP_HISTORY.md`](archive/ROADMAP_HISTORY.md)** — older
  dated engineering sessions, preserved verbatim as history rather than
  maintained as a live ledger.

---
*For immediate tactical setup (Docker, env vars, running the code, API
endpoints), see [`reference/API_REFERENCE.md`](reference/API_REFERENCE.md) and
[`operations/OPERATOR_MANUAL.md`](operations/OPERATOR_MANUAL.md).*
