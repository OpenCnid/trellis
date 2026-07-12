# Trellis Engine Documentation

Trellis is document-driven (DDD): design records lead, implementation
follows, and every document is part of the system's accumulated
experience. Authority is explicit — **code > glossary > prose** — and
each document below states whether it is living doctrine, measured
evidence, or preserved history. The living architectural mental model a
session loads first is `HANDOFF.md` §1 at the repository root; the
system-level framing is the root `README.md`.

## Reading order

### 1. Orientation (start here)

- **Root `AGENTS.md`** — the entry point for coding agents, CLIs, and
  harnesses: the study protocol, the navigation map (which directory
  owns what; where each behavior's enforcement and pins live), and the
  permanent hard rules. Deliberately invariant-only; everything
  volatile stays in `HANDOFF.md`.
- **Root `README.md`** — what Trellis is (a Recursive Language Model
  runtime over a provenance-enforced substrate), the five commitments,
  and the full operator manual.
- **[`GLOSSARY.md`](GLOSSARY.md)** — canonical one-line definitions for
  every term that carries architectural load. If prose conflicts with
  this file, the prose has a defect; if this file conflicts with code,
  the code wins.
- **Root `HANDOFF.md`** — the self-perpetuating session prompt: §0 is
  the engineering loop (the manual prototype of the capability
  flywheel), §1 the living mental model, §3–§8 the next session's
  objective. Regenerated every session; always current.
- **[`COLLABORATOR_BRIEFING.md`](COLLABORATOR_BRIEFING.md)** — the
  three-altitude briefing for a technically fluent outsider: where the
  work is right now, the system it lives inside, and the mechanisms one
  level down.

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
- **[`MATHEMATICAL_FOUNDATIONS.md`](architecture/MATHEMATICAL_FOUNDATIONS.md)**
  — the timeless substrate math: Merkle trees, content addressing, and
  why cryptographic identity solves the Shift Problem that positional
  addressing cannot.
- `ARCHITECTURE.md`, `SYSTEM_ARCHITECTURE.md`, `TECHNICAL_SPEC.md` —
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

### 6. Progress-log archive (`/archive` — historical)

- **`archive/ROADMAP_HISTORY.md`** — the dated engineering ledger from
  July 4, 2026 (the first Phase-1 commit) through Session 23, moved
  verbatim out of `TRELLIS_ROADMAP.md` §5 on July 12, 2026. The live
  roadmap keeps only the most recent five sessions; older entries land
  here unedited.

---
*For immediate tactical setup (Docker, env vars, running the code, API
endpoints), see the root `README.md` and `API_REFERENCE.md`.*
