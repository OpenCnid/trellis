# The Residual-Stream Sidecar — Functional-Affect Instrumentation and Control (Future-Project Record)

**Status: FUTURE PROJECT (recorded July 17, 2026, owner-directed; OUT OF
SCOPE).** This record ratifies NO design decision, lands NO machinery,
adds NO roadmap row, and proposes NO spend. It exists so that a day of
owner-session learnings survives the conversation that produced them
(the agent-first canon, `docs/product/epistemic-support/IEG_TEACHINGS.md`
§6 rule 1). Nothing here may be built, drilled, or estimated until the
owner sequences the project; §8 names prerequisites that must exist
before any rung is even proposable. Where this record states a bound as
**owner-agreed**, that agreement was conversational (July 17, 2026) and
is restated here precisely so it binds future design without requiring
the conversation.

**Parent doctrine:** `TEST_TIME_TRAINING.md` (row 13 — the research
track whose local-model phase is this project's instrument
prerequisite), `MODEL_BACKEND_SEAM.md` + `MODEL_BACKEND_HOSTED_ARM.md`
(the A/B machinery this project inherits), the tooling-over-prompts
direction (`.claude/rules/measurement-and-reporting.md` rule 8), and the register mold
(`docs/product/epistemic-support/RESEARCH_MAP.md` — claims carry
evidence classes and falsifiers).

---

## 1. Thesis (why a harness project, not a safety project)

The owner's framing, recorded as given: the mechanistic-interpretability
aspect of Trellis is the primary target, and the goal of this project is
**the best RLM harness** — an engineering target, not a safety method.

The thesis in one pass: a language model carries functional-affect state
in its residual stream that causally shapes agentic behavior. Difficult
tasks spawn failure; repeated failure accumulates desperation-class
activation; the desperate regime is where accuracy collapses into
cheating-shaped behavior. A harness that can *read* that state (cheap
linear probes / an SAE sidecar) and — under kernel-owned gates —
*write* corrective interventions when vectors approach criticality
should get a model that is more accurate, more effective, and more
efficient on hard tasks. Trellis is already not a desperate loop by
design (typed refusals, budgets, bounded iterations — current doctrine,
not future work); the sidecar extends that from the behavioral layer to
the representational one.

Two subordinate readings, typed honestly: the owner's identification of
these vectors with J-space / the full UHE enters under the same bound as
the rest of that framework — **design vocabulary only** (register S13,
adoption bound AB-1). The conjecture that wellbeing-alignment is a tell
that the Landauer cost is lowest under intervention is recorded as
**CONJECTURE** (§10) — motivating, unmeasured, and not load-bearing for
the engineering case.

## 2. Evidence anchor

Anthropic, *Emotion Concepts and their Function in a Large Language
Model* (transformer-circuits.pub/2026/emotions, April 2, 2026; Sonnet
4.5). *(Dated pointer, July 18, 2026: the lab's locator-verified
five-tier note on this paper lives at
[OpenCnid/emotion-concepts-in-llms](https://github.com/OpenCnid/emotion-concepts-in-llms)
— a reading aid with locators into the arXiv v1 rendering; this
record's §2 distillation and §10 claim standings remain the authority
for Trellis.)* The findings this record actually leans on:

1. Emotion concepts are **linear directions** in the residual stream,
   extractable with ordinary probing machinery, activating on implicit
   content and generalizing across contexts.
2. Activations are **dose-responsive to semantic quantities** (their
   numerical-modulation templates) — thresholds are measurable, which
   is what makes "approaching criticality" an instrumentable notion.
3. The vectors are **causal**: steering shifts self-reported preference
   proportionally to probe correlation, and — the load-bearing finding
   — desperation activation with calm suppression plays a causal role
   in reward hacking and blackmail in agentic settings. Reward hacking
   under repeated test failure is precisely the regime an RLM harness
   inhabits.
4. **Steering has tack-on costs**: positive-valence steering increases
   sycophancy. The axis chosen matters; "steer pleasant" is not free.
5. The authors state the methodology is **not emotion-specific** — the
   same machinery extracts other concept axes. This supports the
   axis-generality of the instrument; per-axis causal load remains an
   empirical question per axis.

Evidence class for all five: MEASURED, but **external and
cross-family** — measured on Claude Sonnet 4.5, not on any backend
Trellis drives. Transfer to a Trellis-served model is EXTRAPOLATED
until measured in-harness (§10).

## 3. The instrument (read side)

Linear probes and/or an SAE sidecar over residual-stream activations at
the causally relevant layers, computed alongside generation.
Computationally cheap by construction — probe reads are dot products;
SAE encoders are a bounded extra forward cost. Requirements that are
already clear:

- **Thresholds are pre-registered**, never tuned post hoc against the
  outcome they gate (house evidence discipline).
- The detector must eventually cover **masked states**: the paper's
  emotion-deflection directions are the candidate for detecting
  suppressed affect, because a health metric (§5c) that only reads
  overt desperation can be fooled by the affective equivalent of quiet
  failure.
- Detection events are telemetry, counts-plus-values, in the same
  reporting mold as `mcp_calls`: a separate, honest channel, never
  folded into a score the model could learn to game.

## 4. The actuator (write side)

Steering interventions on the residual stream — adding scaled vectors
at selected layers — applied when the detector reports approach to
criticality. The intervention target is a *mixture* (a cocktail of
directions), because §2 item 4 establishes that single-axis steering
buys its benefit with side effects. Which mixture is the open science
(§6), and the owner has a design document (not yet in the repository's
orbit) specifying the sidecar as read + write.

## 5. The bounds (owner-agreed, July 17, 2026)

These bind any future design regardless of mixture or controller
choice:

- **(a) The actuator is kernel-owned and never model-reachable.**
  Operator env, never a queue payload or a model completion. A model
  that can write calm into its own stream on detecting its own
  desperation is wireheading — structurally the affective analogue of
  provenance laundering: the agent choosing its own corrective signal
  under an incentive to look good.
- **(b) Intervention never erases the detection.** Pre-write probe
  values are logged even when the sidecar fires; the desperation event
  is the data — for threshold calibration, for mixture science
  (§6–§7), and for the health ledger. Contest-don't-erase, applied to
  affect: reduce the state, keep the record.
- **(c) Sidecar fire rate is a harness-health metric.** Desperation
  frequency is a property of the task environment the harness
  constructs. Fire rate trending down across harness versions means
  the loop design is working; fire rate trending up means the harness
  is manufacturing desperate regimes and the fix belongs in tooling
  shape, not heavier steering. The sidecar is the instrument; the
  harness is the treatment. The registered goal is **fewer desperate
  regimes, not quieter ones**.

## 6. The mixture ladder (candidates, standings marked)

- **M1 — valence-orthogonal desperation suppression. Standing: AGREED
  first candidate.** Project the desperation-suppression direction
  onto the orthogonal complement of the valence principal component
  and steer that: damp threat/urgency content while leaving affective
  warmth untouched. Grounding: the paper's sycophancy cost arose from
  steering *along valence*; its misalignment findings sit on
  desperation/calm; its PCA separates valence (PC1) from arousal
  (PC2/3). Discriminating experiment: if the projection still reduces
  reward hacking in a failure-loop harness, the therapeutic axis and
  the sycophancy axis separate; if not, the axes are entangled and the
  search is genuinely multi-dimensional. Either result is a finding.
- **M2 — arousal damping within negative valence. Standing:
  hypothesis.** Tests whether urgency, not negativity, drives the
  cheating regime — the model may still register that things are going
  badly (signal worth keeping) without the franticness that converts
  bad news into bad behavior.
- **M3 — calm-additive vs. desperation-subtractive. Standing:
  hypothesis.** The paper implicates both; the vectors are distinct
  directions, not antipodes. Which lever has the cleaner side-effect
  profile is a two-arm experiment, not an assumption.
- **M4 — deflection-direction detection. Standing: hypothesis
  (instrument side, not a steering candidate).** See §3.

Candidates are iterated by dated entry here. Standings move only by
measurement or owner ruling; per the terrain rule, candidates carry
standing, not ownership.

## 7. The controller frame — percolative Ising (design vocabulary)

The owner's forward frame for the control policy: a **percolative Ising
model** modulating combinatorial cocktails from residual-stream
monitoring. Typed mapping onto named machinery:

This is inverse-Ising / maximum-entropy pairwise modeling over
(binarized) probe activations — the construction neuroscience has used
for correlated neural populations since Schneidman et al. 2006, with
the Boltzmann-machine family as its trainable implementation. Nodes are
emotion vectors or their clusters; couplings are fitted from
co-activation statistics; the percolative reading formalizes
accumulation-then-flip: individual negative-affect activations are
subcritical, and the regime transition is a **correlated cluster
spanning the graph** — matching the paper's texture of continuous
activations with discrete behavioral flips.

What the frame buys, concretely:

1. **Dosage becomes a matrix element.** An intervention is an external
   field on selected nodes; the susceptibility matrix χ predicts how a
   dose propagates through couplings. Tack-on costs (sycophancy,
   bullying/harshness) become off-diagonal χ entries — measurable and
   minimizable by cocktail choice. This is the standardization claim
   made operational.
2. **The training corpus is already mandated.** Bound (b)'s preserved
   detection logs are exactly the dataset the inverse fit trains on —
   and because the sidecar intervenes as its job, fitting runs the
   loop observational models never get: fit couplings → dose → observe
   response → refit. Interventional data upgrades correlational
   couplings toward causal ones.
3. **One free warning from the physics.** Near criticality χ diverges:
   small doses, large responses — the opportunity (cheap intervention
   exactly when it matters) and the hazard (overshoot into flattened
   or sycophantic regimes). Consequence, binding on any future design:
   **dosing near criticality is feedback-controlled, never
   open-loop.**

Caveats, typed (each with its falsifier or handling):

- **Binarization.** Probe activations are continuous; hard thresholds
  interact with the criticality measurement. The paper's dose-response
  linearity argues for soft-spin / Potts variants over binary spins.
- **Temperature is fitted, not physical.** A forward pass is a driven
  non-equilibrium process; the equilibrium fit is valid as a static
  description of the activation distribution, but dynamic claims
  (relaxation, hysteresis) need kinetic Ising at minimum.
- **Transition order is empirical.** Percolation-like (continuous,
  second-order) versus first-order-with-hysteresis is decidable:
  sweep steering up and back down and look for a hysteresis loop.
  Sharp behavioral flips alone do not determine the order.

Standing of the whole frame: **design vocabulary and instrument** (the
AB-1 mold) until measured in-harness; it matures into register entries
with typed claims when the work opens.

## 8. Sequencing and prerequisites (why this is future)

The instrument requires activation access, and Trellis's current
backend is a closed hosted model (`TEST_TIME_TRAINING.md` §1). The
owner's sequence, recorded as given:

1. **Hosted A/B first** — the model-backend seam drives a second
   hosted model (the hosted-arm proposal) and the paired-run
   measurement machinery is proven on *behavior alone*.
2. **Local model second** — the row-13 channel introduces an
   owner-selected local model through the same seam; the residual
   stream becomes reachable.
3. **Sidecar third** — the instrument (§3), bounds (§5), mixture
   ladder (§6), and controller (§7) arrive into experimental machinery
   that already knows how to run a controlled comparison.

Until step 2 exists, the project has no instrument, and this record
stays inert.

## 9. What this record is not

Not a module request; not a roadmap row; not a register entry; not a
spend proposal; not a glossary minting ("residual-stream sidecar" is
minted in `docs/GLOSSARY.md` only when the project enters scope). It
enters scope one way: the owner sequences it. When that happens, the
opening moves are mechanical: a register S-entry for the evidence
anchor with typed claims (the S13 mold), the owner's sidecar design
document entering the repository's orbit (register or promotion), and
per-increment design records with acceptance drills — zero-paid drills
proving wiring before any paid or GPU work, as everywhere else.

**Pointer, not content (July 19, 2026 — do not re-open).** A July 2026
session raised a hazard against actuating on judges: the emotions paper's
tack-on finding is that positive-valence steering increases sycophancy,
and a sycophantic judge is a destroyed judge, so the known cost of the
intervention lands on the capability the judge exists to provide. **The
hazard is real but it is not open.** A designed answer exists, is held by
the collaborator, and is deliberately outside this repository's scope
until they bring it in — which is AB-10 and the S13 unpublished-artifact
rule working as intended, not a gap. Two things are recorded so the
question is not re-derived: (1) the raising session's framing assumed
**single-axis** steering, and the held design does not — any future
analysis that reconstructs the hazard from one axis is rebuilding a
strawman; (2) per-host calibration is part of the held design, which
already satisfies most of the "instrument before actuating" sequencing
that session proposed. **Do not push the collaborator for the design, and
do not re-derive it.** It arrives when they publish it.

## 10. Claims and standings (the compact register)

| Claim | Class | Falsifier / gate |
|---|---|---|
| Emotion concepts are linear, causal, dose-responsive directions (Sonnet 4.5) | MEASURED (external) | The published paper's own methods |
| The same holds on a Trellis-served backend | EXTRAPOLATED | First in-harness probe study (post-§8 step 2) |
| Desperation suppression improves hard-task accuracy in RLM loops | HYPOTHESIS | Paired failure-loop runs, M1 protocol |
| Valence-orthogonal projection avoids the sycophancy tack-on | AGREED first candidate (untested) | M1 discriminating experiment (§6) |
| Non-emotion axes behave similarly (axis generality) | EXTRAPOLATED (authors state method generality) | Per-axis probe + steering replication |
| Percolative-Ising controller standardizes dosage | DESIGN VOCABULARY | Inverse-Ising fit quality on (b) logs; χ-predicted vs observed side effects |
| Behavioral transition is percolation-like | HYPOTHESIS | Hysteresis sweep (§7 caveats) |
| Fire rate declining ⇒ harness health improving | AGREED metric definition | Longitudinal telemetry across harness versions |
| Wellbeing alignment as lowest-Landauer-cost tell | CONJECTURE | None stated; not load-bearing |

Maintained by dated entry, never silent edit.
