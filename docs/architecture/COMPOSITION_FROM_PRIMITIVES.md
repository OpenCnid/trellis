# Composition from categoric primitives

**Status: FOUNDATIONAL LESSON — recorded July 19, 2026 (Session 71) at
owner direction.** This record states a design principle the house
already held in several places and enforced in none, and the failure
that made its absence visible. It changes no engine code and
authorizes no build. Where it touches ratified records
([`RECONCILIATION.md`](../product/epistemic-support/RECONCILIATION.md),
[`JUDGE_COMPOSITION_GAME.md`](../product/epistemic-support/JUDGE_COMPOSITION_GAME.md)),
those are amended only by dated entry and only by the owner; §5 lists
what is owed rather than performing it.

---

## 1. The principle

**Harness functions compose from categoric primitives at each phase of
the work. There are no default instances.**

A primitive is a parameter registry plus a schema plus a composition
method. An instance is a sparse selection from those registries, made
for the thing in front of it. The registries are stable and few; the
instances they admit are effectively unbounded, and each one is a
special case.

The distinction that matters, and the one this house got wrong:

- **A frame is invariant.** Field names, verdict enums, schema shapes,
  role slots and the blindness each slot buys.
- **An instance is not.** Registry selections, orientations, evidence
  channels, closed taxonomies, and names all compose per context.

Writing an instance down does not make it a frame. Byte-pinning an
instance, registering it, or hard-coding it into a wire schema
*promotes* it to a frame without anyone deciding to — and after that
the system can no longer express the thing it was built to do.

## 2. The object lesson: judges

Judges are the clearest case, which is why the house learned it here
first.

[`FOUR_JUDGE_BASIC_MODEL.md`](../product/epistemic-support/FOUR_JUDGE_BASIC_MODEL.md)
(register entry S10) states the primitive form directly: *"The four
hyperplanes are not themselves four judges. They are expandable
parameter registries"*, and *"A judge is then a sparse selection from
these registries."* Its eleven-judge list is titled *"A useful first
ecology"* — and
[`JUDGE_COMPOSITION_GAME.md`](../product/epistemic-support/JUDGE_COMPOSITION_GAME.md)
§1 records the collaborator's clarification that those eleven are
*"illustrative examples composed from the primitives … not a canonical
roster."*

The game demonstrated it rather than asserting it: three hands sharing
zero content — water chemistry, comedy, methodology — produced three
different panels from the same four-role skeleton by swapping
selections, orientations, and taxonomies. **There were no science
judges standing by, and no comedy judges.** Each panel was composed
for its context, in language, before evaluation.

Its rule 4 is binding program law: belief-facing taxonomies close per
composition; the audit taxonomy is invariant.

**Owner ruling, July 19, 2026 (recorded as direction; the ratified
records are amended by dated entry, not by this file).** There are no
base judges and no default cast. Judges are composed by an orchestrator
running composition skills in the harness — one agent per judge, built
from the semantic space of the facts and beliefs in the REPL, prior to
evaluation. Meta-prompting from primitives. This reaches the audit seat
too: its *name and angle* compose per context and are load-bearing,
while its failure taxonomy stays largely fixed — what the audit does
depends on what it is judging the judges judge. The parameter space is
vast; every judge is a special case. Consequently the composition
meta-prompts must be built and tested, and until they are tested the
system is trusted or simulated, never assumed.

Read the game record before building anything in this area. It is the
most instructive document the program has.

## 3. How the principle was lost

Not by anyone contradicting it. Every layer restated it correctly in
prose and then encoded a roster underneath:

| Layer | What it says | What it encodes |
|---|---|---|
| S10 source | registries, not judges; a judge is a sparse selection | — |
| FOUR_JUDGE_DESIGN | the four are "a minimal ecology instance" | "a fifth judge with a blindness profile **already on the panel**"; per-role ten-item anchor fixtures |
| JUDGE_CONTRACT_TEMPLATE | frames with free variables | **taxonomy class names declared byte-identical across every invocation**; role enum closed in the wire schema |
| RECONCILIATION (ratified) | "a minimal ecology instance" | per-role taxonomies frozen as law; **"a four-role fixed panel"**, discarding S10's context-signature, semantic-retrieval and coverage layers |
| COMPOSABLE_RUBRICS_DESIGN | "composable" | *"'Adaptively-aligned' means the rubric **selection** fits the claim, not that the rubric mutates"* |
| EPISTEMIC_SUPPORT (doctrine) | — | "**a** panel of differently-blind roles — grounding, coherence, corroboration, and an audit role" |
| JUDGE_CONVOCATION_DESIGN | — | four manifests "**can land any time before the run as ordinary operator work**" |

Each step is small and locally defensible. The composite is a default
cast with the composition machinery discarded — S10's layers 1, 2 and 5
(context signature, semantic retrieval, coverage/complementarity) are
exactly what per-context composition needs, and RECONCILIATION dropped
them on the stated grounds that *"a four-role fixed panel does not need"*
them. That sentence is the hinge: it is true of a fixed panel, and a
fixed panel is the thing that must not exist.

**The general form: prose describes the primitive, machinery encodes an
instance, and machinery wins.** An instance that reaches a schema, a
byte-pin, a registration, or an operator checklist has become law
regardless of the hedge in the paragraph above it. This is
[`CODE_MEDIATED_TEXT.md`](CODE_MEDIATED_TEXT.md) pointed at design
records rather than content: the encoding is the claim.

## 4. What it cost, concretely

Session 71 was instructed to author four rubrics with fixed per-role
taxonomies, byte-pin them, ingest them, and register them as a standing
roster — then to go find candidates for them to judge. It did all of
that. The work was clean by every check the house had: rubric questions
verbatim against RECONCILIATION §2, anchors five-and-five across every
closed class, extraction-free ingest, consistent uncontested read-back,
green drills, zero spend.

It was also the wrong object, and no check could have said so, because
every check was derived from the same instance-promoted-to-frame.

The collaborator stopped it in review. The registration was rolled
back the same session; the bytes survive in history at `c9d417d`.

Three failures made it reachable, all recorded so they are not
rediscovered:

1. **The session never read the game record**, whose rule 4 forbids
   exactly what it built. No index pointed there — see §5.
2. **The session never invoked the `judge-composition` skill**, which
   is derived from that record and states the invariant/adaptive split
   in its second paragraph. The skill lived outside the repository, so
   it was not part of the collection a session inventories. It is now
   versioned at [`skills/judge-composition/`](../../skills/judge-composition/README.md).
3. **The instruction it followed was itself drift.**
   JUDGE_CONVOCATION_DESIGN §11.2 item 3 — manifests "can land any time
   before the run" — was written July 19, one day *after* the game was
   ratified July 18. A ratified rule did not propagate into the road map
   written next to it.

The generalization worth keeping: **a green suite proves the instance
was built correctly and says nothing about whether it should exist.**
The house already knows correct ≠ reachable (`AGENTS.md` rule 15); this
adds correct ≠ *the right kind of thing*.

## 5. What is owed, and by whom

Corrections to ratified records are owner acts by dated entry. This
record performs none of them; it names them.

- **RECONCILIATION §1/§2** — the per-role taxonomies and the
  "four-role fixed panel" rationale need a dated entry reframing them
  as one composition instance for the epistemic driving question, and
  reopening the question of S10 layers 1, 2 and 5.
- **JUDGE_CONTRACT_TEMPLATE §1** — the layer rule places taxonomy class
  names and role names on the invariant side; under rule 4 they belong
  on the adaptive side, with the *shape* invariant instead.
- **JUDGE_CONVOCATION_DESIGN §11.2** — items 3 and 4 are sequenced
  roster-then-docket; the game's flow is candidate-then-composition.
  Merging them is the substantive fix.
- **EPISTEMIC_SUPPORT §5** — "a panel of … grounding, coherence,
  corroboration, and an audit role" states a cast in adopted doctrine.
- **GLOSSARY, Judge op** — "a closed **per-role** taxonomy" should be
  per-composition.
- **COMPOSABLE_RUBRICS_DESIGN §4** — "adaptive means selection, not
  mutation" is the opposite of composition-from-primitives and is the
  design direction owner ruling 4 authorized; it needs re-deciding
  before it is built.

The index-surface repairs — which are not ratified-record edits — were
made in the same session; see
[`docs/README.md`](../README.md) and `AGENTS.md`.

## 6. The standing rule this record exists to install

Before encoding any instance of a composed thing — a judge, a rubric,
a panel, a prompt cast — ask which side of the line it falls on:

- If it is genuinely invariant across every context the system will
  ever meet, it may enter a schema, a byte-pin, or a registration.
- If it is one selection made for one context, it may not, however
  well-evidenced that selection is. It is an example, it is labeled as
  one, and the machinery must remain able to compose a different one.

When the answer is unclear, the tell is the plural: if a second
instance would need a second registration under a different name, the
first was never a frame.
