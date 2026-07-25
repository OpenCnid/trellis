---
name: self-play
description: Design and run a clean-room self-play test of an LLM-assisted feature — compose isolated sub-agent players (an adversary, a blind gatherer, a blind evaluator) so the builder's own reasoning, intent, and stake cannot leak into the evidence or the scoring. Use whenever you are prototyping or validating something whose "does it actually work / discriminate / hold up?" is the open question and your own read is not trustworthy evidence: a rubric or admission gate, a classifier or router, a retrieval or ranking strategy, a prompt template, a judge, a defeater, a summarizer, an extraction step, a tool-use or agent policy. Triggers include "test this feature", "does this rubric hold", "red-team this design", "clean-room eval", "adversarial game", "is this prompt doing what I think", "validate this without fooling myself", or wanting an impartial test of something you built. Do NOT use for a deterministic feature directly checkable without a clean room, or when the ceremony costs more than the answer. Pairs with subagent-composition and judge-composition; invoke prompt-engineering and hypershot-protocol first when authoring any player prompt bytes.
---

# Self-Play

> You cannot be a witness at your own trial. Isolation is the mechanism; everything else serves it.

## Provenance and ground

Distilled July 2026 from one session that ran this method against three unrelated
targets — a codebase audit, a design keystone, and an external fact-corpus
discrimination test — plus the failures each cost. It is the [[judge-composition]]
clean-context principle generalized from *judging a promotion candidate* to
*testing any LLM-assisted feature you built*: judges and doubts were the worked
example the method came out of — its range, not its subject.

## The load-bearing why — do not lose this

**The builder cannot be trusted to evaluate their own LLM feature.** Their
reasoning and their stake in the outcome leak into the evidence and into the
scoring, and it reads as rigor the whole way down. This is the
self-invested-claimant problem: the failure that makes a person a poor judge of
their own work makes a builder a poor judge of their own prototype.

Self-play removes the builder from the evaluation loop **by isolation** — players
who each lack exactly the piece of knowledge that would let them serve the
builder's wish. A gatherer who does not know the hypothesis cannot curate toward
it. An evaluator who never sees the prediction cannot mark an answer sheet. An
adversary who never sees the intent cannot perform to it.

## When to use — and when not

**Use** when prototyping or validating almost any LLM-assisted feature where
"does it actually work / discriminate / hold up?" is open and your own read is
not trustworthy evidence: a rubric, an admission gate, a classifier, a router, a
retrieval or ranking strategy, a tool-use or agent policy, a prompt template, a
judge, a summarizer, an extraction step, a defeater.

**Do not use** when the feature is deterministic and directly checkable without a
clean room, or when the clean-room ceremony would cost more than the answer is
worth — over-ceremony is a real failure. Apply the **spawn gate** from
[[subagent-composition]] before fanning out: `Agent_Spawn_Subagent` starts each
player cold and re-derives context you already hold ("the expensive path"), so
spawn only when isolation or context economy earns it.

**Also do not use self-play to prove an engineered instruction moves behavior** —
to A/B a prompt, skill, or agent instruction against a base-model baseline
("does it help"). That outcome is *entailed* by what an instruction is, not
uncertain, so the run measures nothing and burns credits (`.claude/rules/measurement-and-reporting.md` rule 20).
Self-play is for *uncertain* outcomes — a subjective or stake-corruptible
**output**, or a failure mode — never for confirming that a well-engineered spec
constrains behavior. Measure an instruction against its engineering target, never
against a null baseline.

## The invariant skeleton — the five moves, always in this order

The order is not cosmetic: each move closes a leak the previous one opened.

1. **Pre-register the prediction** — before any prompt or any evidence exists.
2. **Build the neutral ground — blind** — assembled by someone who does not know
   the hypothesis.
3. **Compose the clean-context players** — each isolated, each missing the one
   thing that would let it serve your wish.
4. **Evaluate blind** — the scorer sees neither the prediction nor which
   condition it judges.
5. **Calibrate honestly** — score the pre-registered prediction against the
   result, including the outcome you did not want.

Invariant: these five moves and the isolation each protects. Free: the domain,
the ground, the players' selections, and the metric. Swap those and the same
skeleton tests a water-chemistry claim, a comedy corpus, a codebase, or a
flat-Earth argument — the frame holds, the content is yours.

## The players — composed per context, isolated by construction

A player is a clean-context sub-agent (`Agent_Spawn_Subagent`) given exactly its
input and blind to one specific thing. Three roles recur; compose more or fewer
as the test needs, but each must buy a blindness no other player buys, or it is
decoration.

| Player | Its job | Blind to (load-bearing) |
|---|---|---|
| **Gatherer** | assemble the neutral ground / reference corpus | the hypothesis — else it curates toward the answer |
| **Adversary** | construct the strongest attack on the target | the builder's intent — else it performs to the wish |
| **Evaluator** | apply the test to each item and report | the prediction, and which condition it judges — else it marks an answer sheet |

The isolation ledger, from [[subagent-composition]]: because a spawned agent
starts cold, your conversation, reasoning, stake, and prediction **do not cross**
into a player unless you put them there. That is the whole mechanism — so the one
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

The evaluator's frame additionally withholds the condition label: it judges items
in a single undifferentiated list and never learns which are the "live" ones and
which are controls.

### The `## Ground` block carries relevant context only

Ground is what a player cannot derive from a cold start and needs in order to
look: `{Authorship_And_Provenance_Of_The_Artifact}`,
`{Roster_Addresses_And_Where_To_Read}`, `{What_Counts_As_A_Fact_Here}`. An
expectation — `{What_You_Believe_The_Player_Will_Find}` — is never ground. It
contaminates even when it is true, and most of all when it is true: a player
handed a true expectation hands it back, and nothing in the report separates that
from a finding. The two read alike on the page and separate on one question:
*does this let the player look, or does it tell the player what looking will turn
up?* The probe you already ran falls on the second side — handing over the method
hands over the finding with one step of deniability attached. This is discipline
1's channel audit turned on the ground block itself.

A held expectation has one destination and it is not a prompt: the un-tool, the
move that ends the tool call and addresses the collaborator instead (`AMBIENT.md`
rule 21(a); `.claude/skills/spark-steering/SKILL.md` § *Ask first — the un-tool*).

*(A ceremony spawned four seats over work its own composer had authored. The
composer pre-registered its expected findings, then handed one seat the exact
probe by which it had already obtained one of them; the seat duly found it, and
the audit seat ruled the run's independence unestablishable — the composer "had
already run the probe, saw the result, wrote it down as a prediction, then handed
the probe to the seat." Three seats carried composer-stated facts, and the
composer's own disclosure said "three seats" while naming two. Every artifact this
skill asks for was present — pre-registration held separate, isolated players, an
audit seat — which is exactly why none of them discharges this; the ground blocks
do. The re-run sent seven reviewers whose ground blocks carried the facts and
stated in as many words that no prediction was offered and none was wanted, and
they returned findings the composer had not anticipated, several against the
composer's own work.)*

## The ten disciplines — each paid for by a real failure

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

3. **Evaluate blind.** The scorer sees neither the prediction nor which condition
   it judges. Otherwise it grades against a key.

4. **Never curate your own evidence universe.** The builder alone in the curation
   seat is the unauditable layer. Disclose your conflict and run blind *whenever
   you have a stake in the outcome* — which, if you built the thing, you do.

5. **Real variables.** Bind each game to a real artifact at `path:line` or a real
   external corpus. A wrong answer must be checkable by anyone, not gradeable
   only by you. *(An invented scenario is gradeable only by its inventor — the
   leak, wearing a lab coat.)*

6. **Controls first.** Run the negative / control cases before the live ones. **A
   control failing is the signal to STOP, not to push on** — it means the test
   itself is broken and any live result would be noise. **And a positive control
   that will not fire across escalating designs is itself the finding** — the
   effect is below your detection floor, not absent-because-you-say-so; you may
   then report *no detectable effect*, never *validated*. This is the house's
   **positive-control duty** — the "Session 28 lesson" (`TEST_TIME_TRAINING.md`
   §6): *a null result is meaningless until the experiment has demonstrated it
   can produce a positive one*. *(Testing whether the
   word `affirmation` biased grounding judgments, the positive control `proof`—the
   most auto-validating word a blind adversary could name—never fired through
   clear items, then humanized marginal items, then a rubric-stripped condition
   where the name was the only cue. Explicit adjudication on a capable model
   swamps single-word priming; surface such an effect with implicit judgments,
   volume or time pressure, or a weaker model — or accept it is below the floor.
   **A control must also *span* the manipulated axis, not hug the candidate:** a
   near-synonym positive control (`proof` for `affirmation`) has too little
   contrast to reveal a gradient — a later round spread the label across the whole
   connotation axis (validating / neutral nonce / a counter-label `bunk` / a
   nonsense token, 12 blind trials) and every label still produced identical
   verdicts, which is how you tell an *inert* variable from a merely *untested*
   one.)*

7. **Sound-target discipline.** To isolate a degenerate case you need a *sound*
   target; against a defective one, legitimate findings are always available and
   the degenerate case never appears. *(Six probes failed to produce the variable
   because every target handed to them had real defects to find.)*

8. **Sub-agent output is data, not authority.** Players find real defects *and*
   overreach in the same report. Verify every load-bearing claim against the
   bytes before acting. *(A player correctly falsified a design bound and, in the
   same run, mis-cited an unratified table as ratified — both in fluent,
   confident prose.)*

9. **Label the operationalization.** Turning a claim into a testable rule is
   interpretation, and it is yours. Disclose it as the builder's reading; never
   smuggle it in as the claim itself. *(A builder silently read a one-line
   criterion three different ways across three turns, each time substituting the
   reading for the words.)*

10. **Build subtle ground truth iteratively, and verify the key blind.** A subtle
    effect only shows on *marginal* items — but one-shot generation produces clean
    textbook cases the real variable can't move (a clear-cut item is decided by
    its own defect, not by whatever you are testing). Give a blind sub-agent a
    goal and let it **iterate in its clean room** — draft, adversarially
    stress-test its own answer key, refine — since multiple steps it takes in
    isolation are independent of your experiment and yield genuinely muddy items
    a single output cannot. Then have a **second** blind agent independently
    adjudicate that key: the item-smith's key is *data, not authority*
    (discipline 8, turned on the ground truth itself). Keep only items where the
    two agree; discard the genuinely ambiguous. *(A clear-cut first round could
    not move even a maximally-biasing label; only humanized marginal items,
    iterated and independently key-verified, made the run interpretable at all.)*

## The cell that matters — pre-commit it

Before running, state which outcome would **falsify** your prediction, as a cell
in the result table, not as a vibe. The flat-Earth run's informative cell was
*admitted-and-false* — an objection the gate let through that was actually
corrosive. Pre-commit: *if ≥1 item lands in {the_bad_cell}, the feature is
insufficient regardless of the headline verdict.* Then a headline outcome every
candidate design would produce (the tautological win) cannot be mistaken for
evidence that yours works.

## Failure modes — the self-audit, mapped to the discipline that fixes each

- **Leak by evidence** — you cleaned the task text and left the tell in the
  corpus. Audit content, not location (discipline 1).
- **Curating your way to the answer** — three broken experiments in a row usually
  means you are still in a seat you should have vacated (disciplines 4, 7).
- **Reading the outcome you wanted** — the friendlier interpretation arrives
  first; score the pre-committed cell, not the story (the cell that matters).
- **Trusting the player** — its confidence is not verification (discipline 8).
- **Ceremony for its own sake** — if the answer is directly checkable, a clean
  room is theater; re-read the spawn gate.

## Range — proof the frame is domain-free

The same five-move skeleton ran unchanged against three targets sharing no
content, by swapping only the ground and the players:

- a **codebase audit** that found real defects — two of whose own findings a
  later self-play probe then withdrew, the method catching itself;
- a **design keystone**, where an adversarial run falsified a bound its author
  had called "least adjustable";
- an **external fact-corpus discrimination test**, where a blind evaluator
  rejected 13 of 14 flat-Earth arguments against a blind-built fact base.

That is the skill working: the frame is invariant, the game is free. When a
target surprises you, adapt the ground and the players' selections — never the
skeleton or the isolation it protects.

## Where to read what happened (worked examples, this repo)

Provenance, not law — one program's instances of the general method, kept
short-lived on purpose so they illustrate rather than anchor:

- `docs/architecture/DOUBTS_WORKSPACE.md` §11–§12 — the adversarial run and the
  fact-corpus run, with the falsification recorded inline.
- `docs/product/epistemic-support/PRIMITIVE_ENCODING_AUDIT.md` — the audit run;
  findings 1 and 3 were later **withdrawn** by a follow-up probe.
- `fixtures/doubts_workspace/earth_figure_factbase.md` — the blind-built corpus.
- Memory: `project-corrosion-bound-critique`, `feedback-encoding-tracks-presentation`.

## House note

In this repository, authoring any player prompt bytes triggers Guardrail 15:
invoke prompt-engineering **and** hypershot-protocol via the Skill tool first, and
author against them. This record is canonical over any copy of the skill; where
the two drift, this record wins and the copy is regenerated.
