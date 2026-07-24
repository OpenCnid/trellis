# Composed evaluators

This session is building a judge, rubric, panel, defeater, or sub-agent.
`AGENTS.md` rule 17 binds that work; the case that produced it is
`docs/architecture/COMPOSITION_FROM_PRIMITIVES.md` and the ceremony is
`docs/product/epistemic-support/JUDGE_COMPOSITION_CEREMONY.md`. Rule 16
governs these bytes, rule 8 governs how a failure class gets closed, and
rule 21 is the cheapest move when a composition is underdetermined.

## What the repository holds, and what a run holds

Every evaluator in this repository exists as three things: a parameter
registry, a schema, and a composition method. The instances those admit
are effectively unbounded and every one is a special case, so a composed
instance exists inside the run that composed it and inside that run's
record — those two places, and no third. Ahead of any context, what is
here is registries.

Composing an instance and picking one off a menu are different acts, and
this repository supports the first. A menu is instances written down
ahead of the context they will be used in; the registries are written
down ahead of the context, and the selections from them are not.

Frame-hood is read off a candidate rather than conferred on it. What is
invariant across every context the system will ever meet — field names,
verdict enums, schema shapes, and the structural slots whose distinctness
the design depends on — carries frame-hood, and that is what a wire
schema, a byte-pin, a registration, or an operator checklist contains.
**An instance that reaches a wire schema, a byte-pin, a registration, or
an operator checklist has silently become law** (rule 17). A selection
made for one context carries the standing of an example, and wherever one
appears the record beside it says which it is.

Two tells resolve the question in a session:

- **The plural test.** If a second instance would need a second
  registration under a different name, the first was never a frame.
- **The teaching test.** Whatever entered the record to *explain* how
  something works is an example, and examples anchor. An example's
  half-life here is the explanation it was written for: it illustrates,
  and then it is gone. One that survives is found by a later reader with
  no way to know it was a mad-lib filled in once.

## Composition follows the candidate

A ceremony's seats are composed after its candidate is filed, from a
characterization of the pool that candidate lives in, and they hold for
that one docket. The seats a run judges with did not exist before that
run's candidate was filed.

A prior selection's quality is evidence about the context it was composed
for, and that context has passed; the next context composes its own
seats, however well the last set performed. Where a context has no seats
composed for it, the ceremony's output is a typed refusal naming the
missing composition, so what runs is a composition and the record shows
when none was there (`judge-composition` Steps 3 and 7).

## Each instance is a special case, one at a time

Every selection, orientation, closed taxonomy, drawback-class name, judge
name, anchor set, and angle holds in the context it was composed for and
is composed again for the next one. That binds each instance
individually: a repertoire whose members differ from one another while
any single member travels unchanged into a second context has carried an
instance rather than composed one, and the carried member is the whole
finding.

There is one exception and it is the only one: the audit seat's
**failure** taxonomy is invariant vocabulary, because how judges fail does
not depend on what they judge. That seat's name and angle compose like
any other seat's (`JUDGE_CONTRACT_TEMPLATE.md`, dated correction July 21,
2026).

## The shape a seat is composed into

The schema is the frame and the values are free variables. A filled-in
one anchors every seat composed after it, which is why this frame stays
empty:

```yaml
judge: {Purpose_Bearing_Name}
  purpose: {The_One_Question_This_Seat_Answers}
  claim_modes: [...]
  select: [{registry.parameter/aspect}]   # sparse; each entry earns its place
  orientation: {Evidence_Standard_And_Uncertainty_Posture_And_Abstention_Boundary}
  taxonomy: {Closed_Drawback_Class} -> {Qualified_Parameter}
  blind_to: {Everything_Unselected_Stated_Explicitly}
```

A seat earns its place by buying a blindness no other seat buys — that is
what lets verdicts compose. A cover needs as many opens as cover the
space in front of it, so the count comes out of that space
(`COMPOSITION_FROM_PRIMITIVES.md` §4). Each composed seat has an
abstention path, a way to fail, and an anchor set it discriminates on
before it judges anything load-bearing.

## What a green run establishes here

A passing check establishes that the instance was built correctly. What
kind of thing should exist is a separate claim resting on a separate
source: the governing record, retrieved this session (rule 18). Session
71 authored four rubrics with fixed per-role taxonomies, byte-pinned
them, registered them as a standing roster, then went looking for
candidates — clean by every check the house had, and the wrong object,
because every check descended from the same instance promoted to a frame.
Rule 15's correct-is-a-different-claim-from-reachable extends here:
correct is also a different claim from *the right kind of thing*.
