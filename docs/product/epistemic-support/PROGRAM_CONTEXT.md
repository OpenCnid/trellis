# Epistemic-Support Program — Context for a Fresh Session

**Status: living program orientation.** July 16, 2026. You are probably
an agent (or human) opening this program with no memory of the sessions
that produced it. This file is your entry point; it is deliberately
self-contained and points at everything else. Repo-wide rules still
bind you first: read root `AGENTS.md`, then `HANDOFF.md` (whose §7/§8
bind the *current engineering-loop session*, not this program — but
whose permanent rules bind everyone), then this file.

## 1. What this program is

A proposed **second axis for Trellis beliefs**: graded *epistemic
support* — a subjective-logic opinion (b, d, u) computed sweep-side by
judged events — orthogonal to the existing custody tiers, which remain
untouched. Custody answers *where did this come from*; support answers
*how has it held up*; a third, deferred plane (claim-kind) answers
*what kind of claim is it*. Standing as of July 16, 2026: the axis is
**ADOPTED forward design** (`docs/architecture/EPISTEMIC_SUPPORT.md`),
the support-computation oracle drill is **implemented and observed
green**, and everything else (judges, sweep, registration, ratification
queue, rubrics) remains proposal awaiting its own bounded feature —
see the decision record (§6).

## 2. Reading order (program-local)

1. [`docs/review/06_EPISTEMIC_SUPPORT_PROPOSAL.md`](../../review/06_EPISTEMIC_SUPPORT_PROPOSAL.md)
   — the parent design record: the two-axis doctrine, the support
   state, the judge layer, the authority registry, the automation
   ladder, drills, exclusions. §2.1 is the plane geometry.
2. [`RESEARCH_MAP.md`](RESEARCH_MAP.md) — the evidence register:
   sources, claims with evidence classes and falsifiers (its
   register-summary header carries the current counts — trust it over
   any prose restatement), the cross-row syntheses (§4), the
   contradictions (§6), the sharing queue (§7), and the **adoption
   bounds register** — the live rules bounding what may be built on
   which evidence.
3. [`FOUR_JUDGE_DESIGN.md`](FOUR_JUDGE_DESIGN.md) — the judged-input
   architecture: four differently-blind roles (grounding, coherence,
   corroboration, audit), engine-side composition, judges as
   contestable capabilities.
4. [`JUDGE_CONTRACT_TEMPLATE.md`](JUDGE_CONTRACT_TEMPLATE.md) — the
   prompt-facing hypershot frames and rubric-authoring rules.
5. [`ORACLE_DRILL_PROPOSAL.md`](ORACLE_DRILL_PROPOSAL.md) — the first
   drill (implemented July 16, 2026; its header carries the observed
   runs): pins the support arithmetic before any judge or sweep
   exists. `npm run test:support-oracle`.
6. The review series ([`docs/review/00_INDEX.md`](../../review/00_INDEX.md))
   for how this program emerged from an external repo review.

## 3. Context you cannot infer from the artifacts alone

- **Provenance standing of this program: none.** It was authored by a
  sister-lab session (branch `claude/sister-lab-repo-review-5fuu19`,
  PR #119) collaborating with an external polymath collaborator whose
  frameworks (WonderSuite, S7; the Lexideck prompt protocols, S2/S3)
  supplied the plane geometry and authoring discipline. Session
  reasoning is Tier-3; only the committed documents carry forward.
- **The collaborator has an independent four-judge system under
  evaluation that is NOT specified anywhere in this repo.**
  `FOUR_JUDGE_DESIGN.md` was architected from the evidence register
  alone. Owner direction (July 16, 2026, recorded in its amended
  §10.1): the next session COMPLETES the role definitions by
  reconstruction from the acquired artifacts rather than waiting;
  externally supplied definitions reconcile against the completed set.
  Until ratification, do not treat the design as agreed.
- **The prompt-protocol mandate is real but its resources are not in
  the repo.** `HANDOFF.md` §7 guardrail 11 requires the
  Prompt-Engineering and Hypershot protocols before authoring any
  prompt-like artifact. Those documents were supplied in-session
  (Lexideck lineage, Patreon-distributed — AB-6 forbids committing
  them without authorization). If you cannot obtain them, the distilled
  operational rules survive in `JUDGE_CONTRACT_TEMPLATE.md` §6–§7 and
  the layer rule at its head.
- **Network reality:** this environment's proxy blocks most hosts
  (arxiv.org, transformer-circuits.pub) but allows github.com. All
  three primary papers now have checksum-verified OpenCnid mirrors —
  `who-grades-the-grader-pdf` (S1), `verbalizable-global-workspace-pdf`
  (S8), and `better-harnesses-smaller-models-pdf` (S9) — and all three
  have been read in full. None is promoted; citing any as
  `sourceNodeIds` requires operator promotion first (AB-10). S9's
  released code is ACQUIRED: the OpenCnid fork
  `github.com/OpenCnid/migration-analysis` is cloned (reference only,
  outside the Trellis worktree at `/workspace/migration-analysis`;
  **no license artifact in the fork** — vendoring blocked, register §7
  row 9). S1's released-code locator remains missing.
- **Why the map is unusually insistent about incentives:** two
  independent measurements (Trellis's citation A/B, R-11; S1's
  Goodhart episode) plus a mechanistic frame (S8's report/behavior
  dissociation, R-21) all show count-shaped incentives corrupting
  agents that verbalize the right answer. Every writer-blindness and
  never-reward-counts rule descends from that triple convergence.
  Treat those rules as load-bearing, not stylistic.

## 4. Directives for any session working this program

1. **DDD**: documents lead; no implementation without a separately
   authorized bounded feature naming its non-test entrypoint
   (`AGENTS.md` rule 15).
2. **Zero-paid first**, always; paid runs are owner-gated with printed
   estimates (repo rule; the program's costs are bounded by existing
   telemetry — entailment sweep $0.0093/25 pairs, est-suite ~$2.40/50
   runs).
3. **Check the adoption bounds register before building on any
   source** — the register, not the prose, is authoritative for what
   an evidence class may carry. Amend it by dated entry, never silent
   edit.
4. **Keep the axes apart**: support never mints custody; custody never
   implies support; the writer never sees either.
5. **Record contradictions, don't resolve them silently** — the map's
   §6 items (model-in-the-anchor above all) are owner decisions.
6. **Update `RESEARCH_MAP.md` when evidence changes state** (e.g.,
   coverage-derived → primary-verified happened once already; the
   upgrade pattern is in the S8 row and R-20/R-21 history).
7. Commits on this branch carry the sister-lab session's trailer
   convention, which conflicts with `AGENTS.md` rule 10; the conflict
   is disclosed in PR #119 discussion — flag, don't hide, and let the
   owner rule at merge time.

## 5. State of the world (as of July 16, 2026)

- Branch: `claude/sister-lab-repo-review-5fuu19`, PR #119 (open,
  unreviewed). Program artifacts live in this directory,
  `docs/review/06_…`, and `docs/architecture/EPISTEMIC_SUPPORT.md`.
- Trellis `master` at `841f875` (EL-11). Root `HANDOFF.md` was
  regenerated July 16 per its §0: the active objective is Session 66
  (four-judge role-definition completion + panel drills); the
  engineering-loop Session 64 objective is preserved as its Appendix B.
- Implemented so far: the support-oracle drill (modules, fixtures,
  entrypoint, 11 unit pins). Not implemented: judges, `support_sweep`,
  registration, ratification queue, rubrics, claim-kind plane. No
  support fields exist in any production schema; no judges are
  registered.

## 6. Decision record (owner rulings, July 16, 2026) and what remains open

The five decisions originally listed here were ruled on by the owner on
July 16, 2026:

1. **Epistemic-support axis: ACCEPTED as forward design.** Doctrine
   graduated to `docs/architecture/EPISTEMIC_SUPPORT.md`; glossary
   terms added in the same change. The review-series document 06
   remains as the historical proposal.
2. **Model-in-the-anchor: model labeling PERMITTED** (AB-4 amended by
   dated entry with the owner's rationale — the labeler is itself a
   rough fuzzy classifier; anchors rely on sparse priming
   representations' connection to the verbalizable workspace).
   Residual guards unchanged: byte-pinned fixtures, human refresh
   ceremony, no count-shaped incentives for the labeler.
3. **Support-computation oracle drill: AUTHORIZED** as the program's
   first bounded feature (implementation began the same day; see
   `ORACLE_DRILL_PROPOSAL.md` header for live status and observed
   results — do not trust this line over that header).
4. **Composable rubrics: BUILD** — no off-the-shelf software exists;
   reconstruct from S1's released rubric/outcome data (locator still
   missing — top acquisition priority, sharing-queue row 2) plus the
   WonderSuite conceptual-primitives strategy. Design record:
   [`COMPOSABLE_RUBRICS_DESIGN.md`](COMPOSABLE_RUBRICS_DESIGN.md).
5. **Promotion of S1/S8 (S7 optional): APPROVED** — execution pending
   on a durable deployment (this container's databases are ephemeral;
   promotion here would mint provenance that dies with the container).
   Statuses and command paths: RESEARCH_MAP §7.

**Still open:**
- Session 66's first task (owner direction, July 16): COMPLETE the
  four-judge role definitions by reconstruction from the acquired
  artifacts (S1 mirror; the S9 replication-package fork cloned at
  `/workspace/migration-analysis`), then ratify — design §10.1 as
  amended.
- The S9 fork's **license artifact** (no LICENSE file at `b9d3611`;
  owner understands it as CMU MIT) — blocks vendoring, not reference
  use. S1's released-code locator also remains missing (row 2).
- Aggregation constants beyond the drilled v1 defaults (architecture
  record §"v1 arithmetic"; amendable with drill re-pin).
- Actual execution of the approved promotions on a durable deployment.
