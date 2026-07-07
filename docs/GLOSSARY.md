# Trellis Glossary

Canonical one-line definitions for the terms that carry architectural load.
This file exists to prevent semantic drift: summaries, prompts, and
belief-compression pipelines re-anchor here. If a definition here conflicts
with prose elsewhere, this file wins and the prose has a defect; if it
conflicts with code, the code wins and this file must be fixed. Design
context: [docs/architecture/WORKSPACE_AND_MODULES.md](architecture/WORKSPACE_AND_MODULES.md).

## Core execution model

- **RLM (Recursive Language Model)** — the MIT CSAIL formulation (see
  [FLYWHEEL_EXPLAINER.md](benchmarks/FLYWHEEL_EXPLAINER.md)): a language model
  given a Python REPL that treats context as data in the persistent namespace
  and calls itself (`llm_query`) as a subroutine over slices — never
  "Representation Learning" or "Running Language Model."
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
  (designed; see WORKSPACE_AND_MODULES.md §2, §9).

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

- **Capability ladder (L0–L3)** — L0 self-shaping inside the sandbox
  (exists, safe); L1 runtime config mutation (forbidden, Guardrail 5); L2
  runtime code hot-patching (rejected); L3 staged self-modification through
  the verified pipeline: propose → tests → gate → merge → next run inherits
  (approved; the capability flywheel's mechanism).
- **Kernel** — the human-owned trust core no module may touch: the provenance
  write path and validators, sandbox session modes, bounds enforcement,
  credential redaction, telemetry protocols, and the module loader/gates
  themselves.
- **Userspace** — the agent-authorable extension space: prompt protocols
  (addenda), namespaced tools, retrieval/planning/verifier strategies —
  everything a module may contain.
- **Module** — a versioned, manifest-described userspace extension (purpose,
  research `sourceNodeIds`, brace-free addendum, optional namespaced tools,
  bounds, acceptance drills, status) composed sparsely into runs from an
  operator-registered space.
- **Module #0** — the spatial-flywheel protocol currently hardcoded in
  `TRELLIS_ADDENDUM` ([trellis_agent.py](../src/rlm/trellis_agent.py)),
  extracted into the first registry module with a byte-identical
  composed-prompt pin: the loader's acceptance test, adding zero new
  capability.

## Prompt and protocol conventions

- **Addendum** — validated text composed into the RLM system prompt (Trellis
  directives, MCP tool listing, future module protocols); always *extends*
  `RLM_SYSTEM_PROMPT` (never replaces it) and must be brace-free because rlms
  runs `.format()` over the prompt.
- **Byte-identical-when-absent** — the injection discipline every optional
  surface follows and pins by test: with the feature unconfigured, the prompt
  and behavior are byte-for-byte identical to a run from before the feature
  existed.
