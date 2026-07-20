---
name: self-play
description: Design and run a clean-room self-play test of an LLM-assisted feature — compose isolated sub-agent players (an adversary, a blind gatherer, a blind evaluator) so the builder's own reasoning, intent, and stake cannot leak into the evidence or the scoring. Use whenever you are prototyping or validating something whose "does it actually work / discriminate / hold up?" is the open question and your own read is not trustworthy evidence: a rubric or admission gate, a classifier or router, a retrieval or ranking strategy, a prompt template, a judge, a defeater, a summarizer, an extraction step, a tool-use or agent policy. Triggers include "test this feature", "does this rubric hold", "red-team this design", "clean-room eval", "adversarial game", "is this prompt doing what I think", "validate this without fooling myself", or wanting an impartial test of something you built. Do NOT use for a deterministic feature directly checkable without a clean room, or when the ceremony costs more than the answer. Pairs with subagent-composition and judge-composition; invoke prompt-engineering and hypershot-protocol first when authoring any player prompt bytes.
---

# Self-Play

> You cannot be a witness at your own trial. Isolation is the mechanism; everything else serves it.

## Provenance and ground

Distilled July 2026 from a run of this method against three unrelated targets in
one session — a codebase audit, a design keystone, and an external
fact-corpus discrimination test — plus the failures each cost. It is the
[[judge-composition]] clean-context principle generalized from *judging a
promotion candidate* to *testing any LLM-assisted feature you built*. Judges and
doubts were the worked example the method came out of; they are its range, not
its subject. The nine disciplines below are each paid for by a real failure in
that session, cited where it lands.

## The load-bearing why — do not lose this

**The builder cannot be trusted to evaluate their own LLM feature.** Their
reasoning and their stake in the outcome leak into the evidence and into the
scoring, and it reads as rigor the whole way down. This is the
self-invested-claimant problem: the same failure that makes a person a poor
judge of their own work makes a builder a poor judge of their own prototype.

Self-play removes the builder from the evaluation loop **by isolation** —
players who each lack exactly the piece of knowledge that would let them serve
the builder's wish. A gatherer who does not know the hypothesis cannot curate
toward it. An evaluator who never sees the prediction cannot mark an answer
sheet. An adversary who never sees the intent cannot perform to it. Every other
technique in this skill exists to protect that isolation or to keep the builder
honest about it.

## When to use — and when not

**Use** when prototyping or validating almost any LLM-assisted feature where
"does it actually work / discriminate / hold up?" is open and your own read is
not trustworthy evidence: a rubric, an admission gate, a classifier, a router, a
retrieval or ranking strategy, a tool-use or agent policy, a prompt template, a
judge, a summarizer, an extraction step, a defeater.

**Do not use** when the feature is deterministic and directly checkable without
a clean room, or when the clean-room ceremony would cost more than the answer is
worth. Over-ceremony is a real failure. Apply the **spawn gate** from
[[subagent-composition]] before fanning out: a cold player re-derives context you
already hold, so spawn only when isolation or context economy actually earns it.

**Also do not use self-play to prove an engineered instruction moves behavior** —
to A/B a prompt, skill, or agent instruction against a base-model baseline
("does it help"). That outcome is *entailed* by what an instruction is, not
uncertain, so the run measures nothing and burns credits (AGENTS.md rule 20).
Self-play is for *uncertain* outcomes — a subjective or stake-corruptible
**output**, or a failure mode — never for confirming that a well-engineered spec
constrains behavior. Measure an instruction against its engineering target, never
against a null baseline.

## The invariant skeleton — the five moves, always in this order

The order is not cosmetic. Each move closes a leak the previous one opened.

1. **Pre-register the prediction** — before any prompt or any evidence exists.
2. **Build the neutral ground — blind** — assembled by someone who does not know
   the hypothesis.
3. **Compose the clean-context players** — each isolated, each missing the one
   thing that would let it serve your wish.
4. **Evaluate blind** — the scorer sees neither the prediction nor which
   condition it judges.
5. **Calibrate honestly** — score the pre-registered prediction against the
   result, including the outcome you did not want.

What is invariant is these five moves and the isolation each protects. What is
free is the domain, the ground, the players' selections, and the metric. Swap
those and the same skeleton tests a water-chemistry claim, a comedy corpus, a
codebase, or a flat-Earth argument — the frame holds, the content is yours.

## The players — composed per context, isolated by construction

A player is a clean-context sub-agent given exactly its input and blind to one
specific thing. Three roles recur; compose more or fewer as the test needs, but
each must buy a blindness no other player buys, or it is decoration.

| Player | Its job | Blind to (load-bearing) |
|---|---|---|
| **Gatherer** | assemble the neutral ground / reference corpus | the hypothesis — else it curates toward the answer |
| **Adversary** | construct the strongest attack on the target | the builder's intent — else it performs to the wish |
| **Evaluator** | apply the test to each item and report | the prediction, and which condition it judges — else it marks an answer sheet |

The isolation ledger, from [[subagent-composition]]: your conversation, your
reasoning, your stake, and your prediction **do not cross** into a player unless
you put them there. That is a feature — it is the whole mechanism — so the one
thing you must never hand a player is the very thing it is blind to.

### Player prompt frame (a hypershot — free variables, no leaked content)

Author every player prompt as a frame, never a filled example; a concrete
expectation in the prompt is the leak you are testing against. Invoke
prompt-engineering and hypershot-protocol before writing these bytes.

```md
{Role_As_A_Disposition_Naming_What_It_Prioritizes_Refuses_And_Reports}

## Ground
- {Real_Artifact_At_Path_Line_Or_Named_External_Corpus_Never_An_Invented_Scenario}
- {What_Counts_As_A_Fact_Here_Stated_Without_Naming_The_Hypothesis}

## Task
{One_Bounded_Objective_That_Does_Not_Reveal_What_Outcome_Is_Wanted}

## Return
Reply in exactly this shape:

{Nested_Deliverable_Frame_With_Every_Claim_Carrying_Its_Address}

If {Blocking_Condition}: report what you found and stop. Do not {Named_Wrong_Continuation}.
```

The evaluator's frame additionally withholds the condition label: it judges
items presented in a single undifferentiated list and never learns which are the
"live" ones and which are controls.

## The nine disciplines — each paid for by a real failure

1. **Pre-register before the prompts exist.** A forecast that shares bytes with
   the prompt *or with the evidence the players see* is a work order, not a
   forecast. **The channel moves — audit for the leaked content, not its
   location.** *(A builder kept the forecast out of the task text but left it in
   the evidence corpus the evaluator read; the "hit" was tautological and
   calibration went 1-for-4 → 0-for-4 on correction.)*

2. **Build the ground blind.** Whoever assembles the reference material must not
   know the hypothesis, or they select toward it. *(A blind-built fact base is
   what made the one clean result trustworthy — and it surfaced, unprompted, the
   very material a corrosive objection would later feed on.)*

3. **Evaluate blind.** The scorer sees neither the prediction nor which
   condition it judges. Otherwise it is grading against a key.

4. **Never curate your own evidence universe.** The builder alone in the
   curation seat is the unauditable layer. Disclose your conflict and run blind
   *whenever you have a stake in the outcome* — which, if you built the thing,
   you do.

5. **Real variables.** Bind each game to a real artifact at `path:line` or a real
   external corpus. A wrong answer must be checkable by anyone, not gradeable
   only by you. *(An invented scenario is gradeable only by its inventor — which
   is the leak, wearing a lab coat.)*

6. **Controls first.** Run the negative / control cases before the live ones. **A
   control failing is the signal to STOP, not to push on** — it means the test
   itself is broken and any live result would be noise.

7. **Sound-target discipline.** To isolate a degenerate case you need a *sound*
   target. Against a defective target, legitimate findings are always available
   and the degenerate case never appears. *(Six probes failed to produce the
   variable because every target handed to them had real defects to find.)*

8. **Sub-agent output is data, not authority.** Players find real defects *and*
   overreach, in the same report. Verify every load-bearing claim against the
   bytes before acting on it. *(A player correctly falsified a design bound and,
   in the same run, mis-cited an unratified table as ratified — both in fluent,
   confident prose.)*

9. **Label the operationalization.** Turning a claim into a testable rule is
   interpretation, and it is yours. Disclose it as the builder's reading; never
   smuggle it in as if it were the claim itself. *(A builder silently read a
   one-line criterion three different ways across three turns and each time
   substituted the reading for the words.)*

## The cell that matters — pre-commit it

Before running, state which outcome would **falsify** your prediction, as a cell
in the result table, not as a vibe. The flat-Earth run's informative cell was
*admitted-and-false* — an objection the gate let through that was actually
corrosive. Pre-commit: *if ≥1 item lands in {the_bad_cell}, the feature is
insufficient regardless of the headline verdict.* Then a headline outcome that
every candidate design would produce (the tautological win) cannot be mistaken
for evidence that yours works.

## Failure modes — watch for these in yourself

- **Leak by evidence.** You cleaned the task text and left the tell in the
  corpus. Audit content, not location (discipline 1).
- **Curating your way to the answer.** Three broken experiments in a row usually
  means the builder is still in a seat they should have vacated (disciplines 4,
  7).
- **Reading the outcome you wanted.** After a run you have a stake in, the
  friendlier interpretation arrives first. Score the cell you pre-committed, not
  the story (the cell that matters).
- **Trusting the player.** Its confidence is not verification (discipline 8).
- **Ceremony for its own sake.** If the answer is directly checkable, a clean
  room is theater. Re-read the spawn gate.

## Range — proof the frame is domain-free

The same five-move skeleton ran, unchanged, against three targets sharing no
content, by swapping only the ground and the players:

- a **codebase audit** that found real defects — two of whose own findings a
  later self-play probe then withdrew, the method catching itself;
- a **design keystone**, where an adversarial run falsified a bound its author
  had called "least adjustable";
- an **external fact-corpus discrimination test**, where a blind evaluator
  rejected 13 of 14 flat-Earth arguments against a blind-built fact base.

None shared any content. That is the skill working: the frame is invariant, the
game is free. When a target surprises you, adapt the ground and the players'
selections — never the skeleton or the isolation it protects.

## Where to read what happened (worked examples, this repo)

Provenance, not law — these are one program's instances of the general method,
kept short-lived on purpose so they illustrate rather than anchor:

- `docs/architecture/DOUBTS_WORKSPACE.md` §11–§12 — the adversarial run and the
  fact-corpus run, with the falsification recorded inline.
- `docs/product/epistemic-support/PRIMITIVE_ENCODING_AUDIT.md` — the audit run;
  findings 1 and 3 were later **withdrawn** by a follow-up probe.
- `fixtures/doubts_workspace/earth_figure_factbase.md` — the blind-built corpus.
- Memory: `project-corrosion-bound-critique`, `feedback-encoding-tracks-presentation`.

## House note

In this repository, authoring any player prompt bytes triggers Guardrail 15:
invoke prompt-engineering **and** hypershot-protocol via the Skill tool first,
and author against them. This record is canonical over any copy of the skill;
where the two drift, this record wins and the copy is regenerated.
