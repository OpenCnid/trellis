# docs/density-chain

The home for **system density-chains** — chain-of-density maps of Trellis *as a whole system*,
produced by the [`density-chain`](../../.claude/skills/density-chain/SKILL.md) skill in its
system mode.

A system density-chain is a **branching "density-trellis"**: one shared trunk (the whole system
at increasing density) plus one branch per subsystem *class*, each branch a fixed-length
five-tier chain of density whose tiers traverse **general essence → current shipped machinery →
frontier and future plans**. It is the [chain-of-density method](https://github.com/OpenCnid/chain-of-density)
(Adams et al. 2023, [arXiv:2309.04269](https://arxiv.org/abs/2309.04269)) applied to a codebase
reverse-engineered from its commit history, rather than to a research paper.

## Contents

| File | What it is |
|---|---|
| [`DENSITY-CHAIN.md`](DENSITY-CHAIN.md) | The density-trellis of the Trellis engine — trunk + 11 class branches + a general→current→future cross-section + the cross-link lattice. **Ground truth.** |
| [`DENSITY-CHAIN.html`](DENSITY-CHAIN.html) | A self-contained, theme-aware interactive render of the same trellis, with the house animated SVG banner. **The map.** |

## Conventions (scalable)

- **One system per file pair** (`<NAME>.md` + `<NAME>.html`). The default pair for the whole
  engine is `DENSITY-CHAIN.md` / `.html`. A density-chain scoped to a single subsystem or a
  sibling project gets its own descriptively-named pair in this folder (or a subfolder if it
  grows its own supporting files).
- **The markdown is ground truth; the HTML is a render of it.** Keep them in sync; if they
  disagree, the markdown wins — and both are subordinate to code > glossary > prose.
- **Status labels are load-bearing** everywhere: `shipped-pinned` ≠ `adopted / ratified-as-principle`
  ≠ `proposed / recorded-research`. Never blur them.

This folder is subordinate to everything it summarizes; it is an orientation aid, not an
authority. Live state lives in `HANDOFF.md` and the acceptance ledger.
