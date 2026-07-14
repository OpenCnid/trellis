# Research basis: reasoning-templates module

This document records the research basis for `modules/reasoning-templates/`.
`research.sourceNodeIds` is empty in `module.json` until the sources below are
ingested through the verified ingest path and promoted to `ast_nodes` hashes.
Until that promotion is complete, the module registers non-active and does not
compose (`status: contested`).

---

## Sources

### PCF (Polymorphic Combinatorial Frameworks)

Citation: arXiv 2508.01581

Role in this module: the combinatorial construction of the mode space. PCF's
SPARK categories (Skills, Personas, Approaches, Resources, Knowledge) frame each
reasoning primitive as a composed unit. The A (Approaches) axis is the
reasoning-mode set; the R (Resources) axis is the guarded-verb REPL operation
set. Each catalog entry in the addendum carries its Approaches dimension (mode
name and purpose) and its Resources dimension (guarded-verb call syntax), which
is the SPARK composition the module delivers. CLASS gives the combinatorial
distribution over the unfixed parameters the invariant leaves open; rough-fuzzy
classification begins exactly where the invariant ends.

### Persona-omission grounding

Two independent findings ground the deliberate omission of the P (Personas) axis
for an accuracy-critical code worker.

**Zheng et al., Findings of the ACL: EMNLP 2024**
Citation: arXiv 2311.10054

Finding relevant here: adding a persona to a system prompt does not improve
objective-task performance. The measurement covers prompt-based role assignment
across a range of tasks. For a code and reasoning worker where accuracy is the
primary criterion, a persona overlay is a constraint without measured benefit.

**Hu, Rostami, and Thomason, 2026**
Citation: arXiv 2603.18507

Finding relevant here: expert personas specifically degrade accuracy on
pretraining-dependent tasks, including coding and mathematics, while providing
benefit only on alignment-style tasks. A code worker running against a knowledge
graph is squarely in the pretraining-dependent class; an expert-persona overlay
would be expected to hurt, not help.

Consequence for the module: no P axis is composed for the worker. The pretrained
model's base behavior runs on its own. This is a configuration choice within the
PCF framework, not a gap in it; the framework explicitly treats P as optional and
independently selectable.

---

## What sourceNodeIds will reference (implementation note)

When the three sources above are ingested and promoted:

- The PCF source (arXiv 2508.01581) supplies the grounding for the SPARK
  composition claim (sections 15 and 17 of the design record).
- The Zheng et al. source (arXiv 2311.10054) supplies the grounding for the
  persona-omission claim (section 17, P-axis paragraph).
- The Hu, Rostami, and Thomason source (arXiv 2603.18507) supplies the
  grounding for the expert-persona accuracy-degradation claim (section 17,
  P-axis paragraph).

Each promoted source contributes one or more `ast_nodes` hashes. Those hashes
fill `research.sourceNodeIds` in `module.json`, and `npm run modules:register`
runs to represent the manifest as a `module:reasoning-templates` graph entity
citing verified provenance. `npm run modules:verify` confirms no contested
entities. The module status then changes from `contested` to `active`, the
composed-prompt sha pins are recomputed, and `npm run test:modules` goes green.
