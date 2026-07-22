# Trellis Glossary

Canonical one-line definitions for the terms that carry architectural load.
This file exists to prevent semantic drift: summaries, prompts, and
belief-compression pipelines re-anchor here. If a definition here conflicts
with prose elsewhere, this file wins and the prose has a defect; if it
conflicts with code, the code wins and this file must be fixed. Design
context: [docs/architecture/WORKSPACE_AND_MODULES.md](architecture/WORKSPACE_AND_MODULES.md).

## Core execution model

- **Trellis** — OpenCnid's Recursive Language Model runtime: the RLM plus
  the provenance-enforced substrate it operates on (the three trust
  tiers), the self-correction machinery (Merkle diff → invalidation sweep
  → contested/recovery), and the two flywheels. The older description
  "provenance-preserving GraphRAG" now names the Tier-1/2 substrate
  viewed from the retrieval angle, not the system (reframed July 9,
  2026; `docs/operations/OPERATOR_MANUAL.md`, "What Trellis is").
- **Target function (ratified as principle July 20, 2026)** — what
  Trellis *is for*, from which its primitives derive: **a personalized
  composable expert system whose expertise is the user's data** — not
  strictly a coding tool, not strictly a RAG system. Its load-bearing
  consequence: the user is the domain authority, so standing moves by a
  user gate wherever no fact compels it. Canonical:
  [STANDING_MODEL.md](product/epistemic-support/STANDING_MODEL.md) §0.
- **RLM (Recursive Language Model)** — the MIT CSAIL formulation (see
  [FLYWHEEL_EXPLAINER.md](benchmarks/FLYWHEEL_EXPLAINER.md)): a language model
  given a Python REPL that treats context as data in the persistent namespace
  and calls itself (`llm_query`) as a subroutine over slices — never
  "Representation Learning" or "Running Language Model." The paper (Zhang,
  Kraska & Khattab, arXiv:2512.24601) and the lab's locator-verified note:
  [OpenCnid/recursive-language-models](https://github.com/OpenCnid/recursive-language-models).
- **REPL namespace** — the persistent variable space (`self.locals`) that
  survives across all REPL turns of one `rlm.completion()` call; the RLM's
  working memory substrate, as distinct from conversation scrollback.
- **Recursion-over-variables** — the RLM's core move: hold large context in
  REPL variables and reach into it with code and sub-LLM calls, instead of
  holding it in the root model's attention.

## Provenance and belief

- **Provenance** — the chain of custody from a semantic fact to immutable,
  content-addressed source bytes; it proves *origin*, never *correctness*.
- **sourceNodeIds** — the array, carried by every semantic node/edge, of
  SHA-256 Merkle AST hashes (`^[0-9a-f]{64}$`, rows in `ast_nodes`) the fact
  was derived from; the only values with provenance standing.
- **Standing / signed ternary (ratified as principle July 20, 2026;
  not built)** — a claim's value on one axis: **`-1` doubt / `0` belief
  / `+1` fact**. Mode, verdict and standing are one vocabulary at two
  times — a seat returns a *signed delta*, and standing moves only by a
  user gate. Canonical:
  [STANDING_MODEL.md](product/epistemic-support/STANDING_MODEL.md).
- **Doubt / Objection / Defeater (ratified as vocabulary July 20, 2026;
  not built)** — the `-1` tier: a **doubt** is the standing, *based on* its
  objection(s) — no objection, no doubt; an
  **objection** is the fact-grounded object that attacks a claim
  (sustained / overruled / outstanding); a **defeater** is the composed
  instrument that searches for objections. A doubt must cite facts, and
  enters the workspace only if it survives the fact base — a fact-refuted
  doubt held anyway is delusion. Its `+1` mirror object — the fact-grounded
  thing that *supports* a claim — is the **affirmation** (proposed July 21,
  2026, this session; gateable): `affirmation / fact / judge` mirrors
  `objection / doubt / defeater`, and a **defeater shares the judge's schema**
  (methods and prompts differ; the schema does not). Canonical:
  [DOUBTS_WORKSPACE.md](architecture/DOUBTS_WORKSPACE.md). Under this
  vocabulary **Contested** (below) becomes a *derived* predicate — "carries
  outstanding objections?" — once built.
- **Contested** — the belief state of a fact whose cited source bytes were
  orphaned or whose verification failed: excluded from retrieval, preserved
  with audit history, recoverable by re-derivation from live bytes.
- **Quarantine** — the machinery (invalidation sweep + `contested`/
  `orphanedSourceIds`/`rederivedAt` state) that contests facts when sources
  die and restores them when re-derived; Trellis's answer to "confidently
  wrong forever."
- **Write path** — the single permitted agent mutation,
  `write_derived_insight`/`write_derived_insights`
  ([trellis_tools.py](../src/rlm/trellis_tools.py)), which requires non-empty
  `sourceNodeIds`; every other agent session is transport-level read-only.

## The two flywheels

- **Knowledge Flywheel** — derive a fact once, cache it with provenance,
  verify and quarantine it over its life, reuse it forever: stochastic
  runtime cost collapses into amortized, self-correcting knowledge (shipped;
  measured in the OOLONG results).
- **Capability Flywheel** — build a cognitive capability once as a module,
  land it with research provenance through the sculpted pathway, verify it
  over its life, compose it forever: the RLM authoring its own userspace
  extensions so the execution substrate compounds like the belief base
  (machinery shipped; 2 modules active (spatial-flywheel v1, workspace-discipline v2), estimation-discipline retired, reasoning-templates contested; see WORKSPACE_AND_MODULES.md §2, §9).

## Tiers and working state

- **Tier 1 / Tier 2 / Tier 3** — verified bytes (`ast_nodes`) / derived
  beliefs with provenance (Neo4j) / ephemeral working state (workspace); trust
  descends, and permanence is earned only upward through promotion.
- **Workspace** — the harness-managed, TTL-scoped Tier 3 structure in the
  REPL namespace holding the agent's plan, notes, and captured external
  results; JSON-serializable data by contract, never provenance.
- **Segment** — one uuid-identified, origin-stamped entry in the workspace
  (server, tool, timestamp, size stamped by the harness, never claimed by the
  model), typically one captured MCP/search result.
- **Graph-addressed** — stored or identified *in* the verified layers (an AST
  hash, a graph entity): what Tier 1/2 content is, and what working state must
  never be.
- **Graph-addressing** — pointing *into* the verified layers by hash/id while
  residing outside them: what the workspace does with AST hashes it carries as
  references; the reference is a hint, only the write path's validation makes
  it provenance.
- **Lineage** — cross-task workspace inheritance (serialize at task end, park
  goal-scoped in Redis with TTL, seed into later tasks at spawn), routed by
  the orchestrator by reference; deliberately not a shared live blackboard.
- **Promotion path** — the only route from Tier 3 to permanence: an
  operator-approved segment enters the verified ingest path (stable doc key,
  e.g. the source URL), becomes Merkle-hashed AST bytes, and only then can be
  cited as provenance.

## Self-editing and modules

- **Content pool** — everything the operator has loaded into the agent's
  reach: ingested documents and repositories (including Trellis's own),
  workspace content, configured tools. Trellis's environment sits outside
  the REPL by default; bringing it into the pool is an operator action
  (design record §7).
- **Self-editing (revised July 9, 2026, owner directive)** — Trellis may
  work on anything in the content pool, including its own codebase,
  governed by standard editing permissions (branches, review, merge rights,
  tool allowlists) — the same pattern as Anthropic editing Claude Code with
  Claude Code. The former L0–L3 ladder with L1/L2 forbidden is withdrawn;
  edits land between runs through source control, never as mid-run
  in-memory mutation.
- **Code-mediated text (core pillar; ratified July 9, 2026)** — the RLM's
  text discipline: *the model never counts, and the model never copies.*
  Text is loaded into queryable REPL structures ("ingestion = pandas");
  locations are engine-computed and returned by query; existing bytes are
  moved by code (splice at a computed address), never re-typed through the
  model's attention ("no direct edits, only code edits"). The model authors
  only genuinely new text plus the code that manipulates everything else.
  Consequence: effective context is bounded by REPL memory, not the
  attention window. Canonical record:
  `docs/architecture/CODE_MEDIATED_TEXT.md`.
- **Harness self-model (principle endorsed July 19, 2026; not built)** —
  the direction that Trellis's interior surfaces serve as *free
  meta-prompt composition primitives*, so the model always receives a
  **composed, bounded-context read of what the system actually expects**
  rather than inferring the system's behavior from text authored at a
  different time. The owner's framing: *Explainable AI, but for the AI.*
  Record: `docs/architecture/HARNESS_SELF_MODEL.md`.
- **Composed read** — the bounded projection of a surface's expectations
  served at a decision point. Bounded and *complete with respect to what
  it covers*: boundedness is not a weakened accuracy claim
  (HARNESS_SELF_MODEL.md §0).
- **Guard-derived account** — a composed read generated from the guard
  predicates that enforce it, so the same code that refuses is the code
  that explains. The mechanism that makes the self-model resist drift
  structurally rather than by authorial discipline (§2).
- **Drift invariant** — *the account must read the same state the
  behavior reads, or it is documentation again* (§2.1). One field drives
  both the refusal and the self-description; two fields reintroduce the
  prose-only class.
- **The bijection (self-model acceptance criterion)** — every line in a
  surface's composed read maps to an enforcing guard, and every guard
  maps to a line; neither set has orphans (§3). Run against the
  pre-July-19 kernel it flags all three audit findings automatically.
- **Advisory vs enforced voice** — the named defect that the current
  kernel writes enforced contracts and unbacked aspirations in identical
  typography ("HARD RULE" for both), so the agent cannot tell which
  promises the system will keep (§4).
- **Engine-computed address** — a location handle (row index, hash, segment
  id) produced by a query and consumed by code in the same turn; transient
  by definition — re-query rather than remember. The opposite of a
  model-estimated position (a counted line number, an eyeballed anchor).
- **Transient frame** — the per-task in-REPL structure a text is loaded
  into for querying and splicing (load → query → splice → write → discard).
  Never a persistent mirror: the file/store remains the single source of
  truth.
- **Hash-guarded write** — write-back that verifies the store's bytes still
  match the digest captured at load; a mismatch refuses loudly instead of
  overwriting (the verified-ingest read-back re-hash discipline applied to
  editing).
- **Kernel** — the trust core that ships as repository code and boots
  identically for every run: the provenance write path and validators,
  sandbox session modes, bounds enforcement, credential redaction,
  telemetry protocols, and the module loader/gates. Changed through
  ordinary reviewed commits (which Trellis may author), never composed or
  mutated at runtime.
- **Userspace** — the extension space composed per run from the module
  registry: prompt protocols (addenda), namespaced tools,
  retrieval/planning/verifier strategies — everything a module may contain.
- **Module** — a versioned, manifest-described userspace extension (purpose,
  research `sourceNodeIds`, brace-free addendum, optional namespaced tools,
  bounds, acceptance drills, status) composed sparsely into runs from an
  operator-registered space.
- **Module #0** — the spatial-flywheel protocol formerly hardcoded in
  `TRELLIS_ADDENDUM` ([trellis_agent.py](../src/rlm/trellis_agent.py)),
  now loaded from `modules/spatial-flywheel/` as the default selection —
  extracted into the first registry module with a byte-identical
  composed-prompt pin: the loader's acceptance test, adding zero new
  capability.
- **Module registration** (Session 18) — the operator-run bridge
  (`npm run modules:register`,
  [register_modules.ts](../scripts/register_modules.ts)) that represents
  each research-bearing active manifest as one graph entity
  (`module:<name>`, kind `module_manifest`) citing its research
  `sourceNodeIds`, after verifying every hash exists in `ast_nodes` — so
  the unchanged invalidation sweep contests a capability when its
  research basis changes. `npm run modules:verify` reports contested
  entities; recovery is human: re-review, flip the manifest status back
  to active, re-register. Empty-research manifests register nothing.

## Epistemic support (adopted as forward design July 16, 2026)

- **Epistemic support** — the second belief axis, orthogonal to custody:
  a graded opinion (belief `b`, disbelief `d`, uncertainty `u`; b+d+u=1)
  computed sweep-side from judged events, never asserted by the writer
  and never visible to it; support never mints custody. Canonical
  record: `docs/architecture/EPISTEMIC_SUPPORT.md`.
- **Informatic exchange geometry (IEG)** — the collaborator's frame
  (register S13, UIT-IEGv5.1): modeling as information crossing
  relational operators, priced by a floor and bounded by a ceiling.
  Relation to Trellis: two metrics on one topology — structure
  transfers (floors, budgets, funded existence, honest gluing,
  exchange-indexed time); numbers do not. Enters as design vocabulary
  only (adoption bound AB-1). Records:
  `docs/product/epistemic-support/RESEARCH_MAP.md` §4.11 and
  `docs/product/epistemic-support/IEG_TEACHINGS.md`.
- **Plane (belief geometry)** — a named bundle of related axes owning
  exactly one governance question (custody: *where from*; support: *how
  held up*; claim-kind, deferred: *what kind of claim*); a new plane
  requires a governance question no existing plane answers, plus drills.
- **Judge op** — a drawback detector over a belief: a single-question
  check returning `drawback | clean | abstain` with a named class from
  a closed taxonomy; `clean` means no known drawback found,
  never certified correctness; abstention feeds uncertainty only.
  Belief-facing taxonomies close **per composition**, not per role
  (`docs/product/epistemic-support/JUDGE_COMPOSITION_GAME.md` §6
  rule 4, binding program law); the audit taxonomy is invariant.
- **Derived-source substitution** — acting on a compression of a
  governing record (a handoff, a design record, a skill, a memory, a
  recollection) instead of retrieving the record, on a load-bearing
  act: deciding what to build, or stating what the record establishes.
  The derivation is fluent and self-consistent, so nothing signals the
  loss; the resulting work passes every check because the checks derive
  from the same misreading. Canonical record:
  `docs/architecture/CODE_MEDIATED_TEXT.md` §2.9; operational rule
  `AGENTS.md` 18; authority ordering `AGENTS.md` §1.5.
- **Composition ceremony** — the per-candidate sequence that judges one
  promotion: ratify the candidate, characterize the REPL's fact and
  belief spaces, compose each seat and its anchors for that pool, run
  the instantiation gates, judge on the forward pass, audit, record.
  Nothing is authored ahead of it and no composition is reused.
  Canonical record:
  `docs/product/epistemic-support/JUDGE_COMPOSITION_CEREMONY.md`.
- **Characterization** — the descriptive (never expository) summary of
  the fact and belief spaces that a composer builds criteria from,
  produced by an isolated agent. The candidate's domain is in scope;
  its identity is not privileged — **anonymity, not exclusion**, since
  excluding the claim's region would leave the composed cover with a
  hole exactly where the candidate sits.
- **Cover** — the composed set of judge seats over a claim's linguistic
  topology. Constructed for the space in front of it, required to cover
  it, never carried between topologies; seats are pairwise disjoint or
  overlap with a declared gluing rule. The number of seats is not fixed
  by the design.
- **Judge composition** — building a judge as a sparse selection from
  the four parameter registries plus claim modes, orientation, a closed
  taxonomy, and a declared blindness, composed for the context in front
  of it. There is no default cast: registries and role slots are the
  invariant frame, and every judge filling a slot is a special case.
  Canonical record:
  `docs/product/epistemic-support/JUDGE_COMPOSITION_GAME.md`; the
  general principle:
  `docs/architecture/COMPOSITION_FROM_PRIMITIVES.md`.
- **Adoption bounds register** — the live, dated rule set (AB-1…, in
  `docs/product/epistemic-support/RESEARCH_MAP.md` §9) bounding what may
  be built on which evidence class; amended by dated entry, never
  silent edit.

## Prompt and protocol conventions

- **Addendum** — validated text composed into the RLM system prompt (Trellis
  directives, MCP tool listing, future module protocols); always *extends*
  `RLM_SYSTEM_PROMPT` (never replaces it) and must be brace-free because rlms
  runs `.format()` over the prompt.
- **Byte-identical-when-absent** — the injection discipline every optional
  surface follows and pins by test: with the feature unconfigured, the prompt
  and behavior are byte-for-byte identical to a run from before the feature
  existed.
