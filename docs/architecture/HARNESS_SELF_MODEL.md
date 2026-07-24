# The Harness Self-Model — Design Record

*Status: PRINCIPLE ENDORSED (July 19, 2026). **WORKSTREAM B
IMPLEMENTATION AUTHORIZED — July 23, 2026** (owner, in session, on the
collaborator's proposal): §12 carries the authorization, its scope, and
its sequencing, and it supersedes this header's original
"implementation not authorized" for **Workstream B only**. **Workstream
A remains gated by §8**, as does every paid measurement. Recorded
July 19, 2026 from an owner/collaborator design exchange following the
July 18–19 REPL audit. Sibling of
[CODE_MEDIATED_TEXT.md](CODE_MEDIATED_TEXT.md) (whose §2.8 enforcement
posture this generalizes) and
[RLM_HARNESS_SCAFFOLDING.md](RLM_HARNESS_SCAFFOLDING.md) (whose §8
correction motivated it). A concrete `llm_help` instantiation candidate for this
record's Workstream B is developed in
[SELF_DESCRIBING_SURFACES.md](SELF_DESCRIBING_SURFACES.md).*

---

## 0. The principle

> **The interior surfaces of Trellis serve, in their various functions
> and in the operation of the RLM, as free meta-prompt composition
> primitives.**

The owner's framing: *Explainable AI, but for the AI.* When the harness
acts, it acts from a state composed of the current decision and the past
ones; the code that runs can carry the primitives for the action it is
purposed for, so the model reads an accurate account of how the system is
actually operating rather than inferring it from text authored at a
different time than the behavior.

The collaborator's precisification, which the record adopts as the
operative statement of the guarantee:

> **The model always gets a composed, bounded-context read of what the
> system actually expects. That composed read *is* the accurate read.**

This corrects a false dilemma that arose in the exchange — the claim that
"accurate" implies *complete state*, which is unbounded, therefore the
guarantee must weaken to "accurate whenever the model chooses to look."
Completeness was never the requirement. A bounded composed projection can
be **fully accurate about what it covers**, and what it must cover is the
system's expectations at the decision point. Nothing about that is
partial, and the guarantee does not weaken.

## 1. Origin

The July 18–19, 2026 audit of the whole REPL construction found
`.claude/rules/measurement-and-reporting.md` rule 8 — *tooling shape closes a failure class; prompt text
only reinforces* — violated in three places inside the harness that
states it: an advisory `UPSUM_BUDGET`, a raw `splice()` reachable with
the guarded family merely "preferred", and task precedence taught as a
hard rule with no surface that could rule on anything. Those three were
closed the same day (RLM_HARNESS_SCAFFOLDING.md §8, STRUCTURAL_SPLICE.md
§9). This record is what the exchange *about* those fixes produced: not
three patches, but the general law they were instances of.

Standing of the parts, recorded without possession claims
(ideas are terrain; attribution marks authority to bind, not ownership):
the surfaces-as-primitives framing and the "Explainable AI for the AI"
formulation are the owner's, who alone binds; the bounded-composed
precisification, the read counter, and the output-checking buffer are the
collaborator's proposals; the guard-derivation mechanism of §2 was
developed in the exchange and endorsed by the owner in it.

## 2. The mechanism — the guards *are* the expectations

The load-bearing move, and the reason this is buildable rather than
aspirational:

> **Every refusal path in Trellis already encodes what the system expects
> of the agent. The composed read can therefore be DERIVED from the guard
> predicates themselves — the same code that refuses is the code that
> explains.**

This satisfies the drift invariant structurally rather than by
discipline, and it is reachable specifically because Trellis is unusually
guard-dense. Existing guard sets that are already expectation sets:

| guard | the expectation it encodes |
|---|---|
| `TrellisUpsum._validate` | a dict; four standing keys; lists of single-line strings; domain keys under cap |
| `TrellisTextEdit._resolve` | relative path; no `..`; resolves inside the real root |
| `_verify_anchor_lines` | the bytes you state you are removing are the bytes that are there |
| `TrellisAnswer.submit` | a string; non-empty; within cap; parseable; references REPL state |
| `_verify_hashes_retrieved` | every cited hash was actually retrieved this run |
| `parse_textedit_guarded_only` | one of the documented spellings, or refuse |

### 2.1 The drift invariant (normative)

> **The account must read the same state the behavior reads, or it is
> documentation again.**

`guarded_only` is ONE bool that both makes `splice()` refuse *and* makes
the surface describe itself as guarded-only. The moment those become two
fields, "PREFER THE GUARDED FAMILY" returns — a prompt asserting
something the code does not do. This invariant is the whole design.

## 3. The bijection — the testable acceptance criterion

> **Every line in a surface's composed read maps to a guard that enforces
> it, and every guard maps to a line. Neither set has orphans.**

This is mechanizable, and it is what makes the principle a check rather
than a preference. Its retroactive property is the evidence for it: run
against the pre-July-19 kernel, the bijection **flags all three audit
findings automatically** — `UPSUM_BUDGET` was a line with no guard,
"PREFER THE GUARDED FAMILY" was a line with no guard, task precedence was
a line with no guard. The audit found them by reading; the check finds
them by running.

## 4. What is not guard-shaped, and the defect that exposes

Some expectations are **protocol**, not refusal: re-read before decisive
steps, combine steps into one REPL block, rewrite `upsum` every turn.
Nothing refuses when they are violated — which is precisely why they
drift. Under §3 they must either acquire a guard or be **explicitly
marked advisory**.

That marking matters more than it sounds, because of a defect the
principle exposes in the current kernel:

> **The agent cannot distinguish an enforced contract from an aspiration,
> because both are written in the same voice.**

"TURN DISCIPLINE (HARD RULE)" is backed by protocol-violation detection.
"TASK PRECEDENCE (HARD RULE)" was prose-only until July 19, 2026.
Identical typography, different reality. A read derived from guards would
label those differently *by construction* — the agent would know which
promises the system will actually keep. The point of the direction is not
that the agent receives more information; it is that the information it
receives **stops misrepresenting its own status**.

## 5. Boundedness

Accounts are REPL state the model queries, not output pushed into the
transcript. Pushing a complete account at every action would flood
scrollback, collide with the rlms 20,000-character per-block output cap,
and contradict the effective-context thesis the pillar exists to serve.
Per §0 this is not a weakening: the composed read is bounded *and*
complete with respect to the expectations it covers.

Two consequences:

1. **The read has a budget that RAISES, not a budget that is hoped for.**
   The self-model gets exactly the treatment the running state just got
   (`UPSUM_BUDGET` → `trellis_upsum.commit`). A bound enforced by
   authorial discipline is the very class this record exists to close;
   applying it to itself is not decoration, it is the first test of
   whether the law is real.
2. **Composition must be total.** "Always" means every action path
   produces a read. A path with no composition gives the agent silent
   absence — the same failure class as the audit's findings, one level
   up. The design owes a default and a check that every surface × action
   pair composes.

## 6. The trace — one object, two faces

The collaborator's read counter and buffer, and the owner's
"current decision plus past decisions", are the same object seen from two
directions:

- **The read face (buffer).** What the engine SERVED this run.
- **The action face (decision log).** What the harness DID this run.

**This is a generalization of live architecture, not a new subsystem.**
`_retrieved_addresses` (`src/rlm/trellis_tools.py`) already is the read
buffer for exactly one surface: it records AST hashes served by reads and
searches, and the Session 31/35 write gate consumes it to refuse citation
of anything never retrieved.

**Design decision (proposed): the buffer records addresses and digests,
never bytes.** Every surface already has an address space — Postgres →
AST hashes; workspace and MCP → segment ids; textedit →
`(relpath, digest, line-range)`; task → the uuid span. A uniform
`{surface, address, digest, span, turn}` record makes the check a
re-fetch from the content-addressed substrate rather than a second copy
of the corpus, and it is the uniform type over heterogeneous surfaces
that makes the function-space enumerable at all.

### 6.1 Honest scope of the output check

The buffer catches **fabricated quotation** — bytes the agent never saw.
It does **not** catch wrong inference from real bytes, selective
quotation, or an accurate quote carrying a false gloss.
CODE_MEDIATED_TEXT.md §5 already reserves that residual for the sampled
entailment tier, and this record does not move it. The buffer extends
*byte fidelity* to all surfaces; it does not decide meaning. Any naming
of it as a "detector" must carry this sentence, or the name over-claims.

## 7. What already does this

The law is half-standing, exactly as the pillar was when it was named
(CODE_MEDIATED_TEXT.md §4) — which is evidence for it rather than
redundancy. Each of these is the law applied locally and by hand:

- `AnchorMismatchError` names the first divergent line **and the
  remedy** — re-read and re-derive by query, never retype from memory.
- `locate()` returns `totalHits` and `capped`, so the model knows to
  narrow rather than guessing whether it saw everything.
- `UpsumBudgetError` returns per-key sizes largest-first, so compression
  is a code act against engine-computed numbers.
- `RawSpliceDisabledError` names the three guarded replacements.
- `trellis_task.verify` returns a `reason` that says *treat this as
  evidence*, never *discard it*.
- The guarded-only addendum arm: a surface describing itself differently
  because its state differs.
- `trellis_task` itself: the operator's instructions served as a
  queryable surface rather than recovered from transcript distance.

What is missing is uniformity, derivation, and a check.

## 8. Scope, sequencing, and the authorization gate

**Nothing in this record authorizes implementation.** It exists so a
future bounded feature starts from a stated design instead of
re-deriving one (the RESEARCH_NOTES_COLLECTION §5 precedent), and so the
exchange that produced it is not lost.

> **Amended July 23, 2026 (§12): Workstream B is authorized.** That
> sentence stands for Workstream A and for every paid measurement below;
> it no longer holds for B. Everything else in this section — the phase
> ordering, the separate gates, and B's pre-stated first test — governs
> the authorized build unchanged.

Two workstreams, deliberately separable, which should NOT ride together:

**A. The trace (buffer + decision log).**

Phase 0 — **CORRECTED July 19, 2026, by attempting to execute it; the
original wording was wrong and is preserved in §10 (Phase 0 executed)
with the reason.** It splits into two halves that were conflated:

- **Phase 0a — reachability (zero-paid).** Make the counters shipped
  July 19 (`task_reads`, `task_greps`, `task_verify_authorized`,
  `task_verify_refused`, `upsum_commits`, `upsum_*_refusals`,
  `textedit_guarded_only`, `textedit_raw_splice_refusals`) readable on
  the worker path, and pin that they are. Today they are not: see §10.2
  (Finding 1). Zero-paid, small, and independent of everything else.
- **Phase 0b — adoption (PAID, owner-gated).** Whether a model *reaches
  for* these surfaces when they would help. This **cannot be measured
  zero-paid at any price of effort** — see §10.1 (Finding 0), the
  correction that matters most. It needs a probe-mold run with a task
  set designed so the surfaces are genuinely load-bearing, and it is the
  measurement that would justify or refute Phases 1–4.

Phase 0b is the gating measurement; 0a is a cleanup that makes production
runs observable and is **not** a prerequisite for 0b (§10.2 explains why:
the probe drivers already parse the full payload).
Phase 1 — the read seam (turn boundary; currently absent, and it is what
any "this turn" semantics requires).
Phase 2 — buffer as pure observer: records and telemetry, gates nothing.
Phase 3 — an informing attestation surface (the `citable()` precedent:
informs, never gates).
Phase 4 — any gate. Separately owner-gated, with a measured before/after.

**B. The surface-descriptor convention.** Larger blast radius: it touches
every surface and **moves both composed-prompt sha256 pins**, so it wants
its own record, its own PR, and its own pin ceremony.

**The pre-stated first test for B, chosen because it is cheap and
decisive:** give `trellis_textedit` the full descriptor shape, derive its
addendum from it, and pin that the derived bytes **equal the current
addendum bytes exactly**. If that byte-identity holds, the refactor is
provably safe and can proceed surface by surface without moving a pin
until we choose to. If it does not hold, we have learned the descriptor
model is lossy before touching nine surfaces.

**No behavior claim attends this record** (guardrail 8). Nothing here is
measured to improve any outcome. Whether a derived self-model changes run
quality is open and unmeasured; the probe-round mold would answer it.

## 9. Relationship to the other records

| record | relationship |
|---|---|
| CODE_MEDIATED_TEXT.md | §2.8's enforcement posture generalized: this record says *how* a stated bound proves it has an engine behind it |
| RLM_HARNESS_SCAFFOLDING.md §8 | the three instances whose correction produced this law; §8.3's honest scope still governs those surfaces |
| STRUCTURAL_SPLICE.md §9 | the guarded-only mode is the first state-dependent self-description in the kernel — §2.1's worked example |
| PROVENANCE_THREADING.md | `_retrieved_addresses` is the existing single-surface read buffer §6 generalizes; T1/T2 taxonomy bounds what the buffer can catch |
| GROUNDED_AUTHORING.md | §7's verification tiers cover the semantic residual §6.1 deliberately leaves |
| `.claude/rules/measurement-and-reporting.md` rule 8 and `AMBIENT.md` rule 15 | the law is rule 8 made checkable; §4's voice-collapse defect is rule 15's shape applied to prompt claims rather than capabilities |

## 10. Phase 0 executed — what it found, and what it corrected

**July 19, 2026, owner-directed, read-only, zero-paid, $0 spent.** No
code changed; this section is the whole deliverable. Phase 0 was run as
§8 (Scope, sequencing, and the authorization gate) specified it, and the
attempt falsified the specification. Both findings are recorded here
because the second one is a live gap and the first is a trap that will
catch the next person who tries to measure model behavior cheaply.

### 10.1 Finding 0 — the specification was wrong: adoption cannot be measured zero-paid

The original §8 (Scope, sequencing, and the authorization gate) Phase 0
read: *"read the counters shipped July 19 …
against existing zero-paid drills, to establish whether runs already
re-read and whether the surfaces get adopted at all."*

That is not possible, for a reason that holds for **every** zero-paid
harness in this repository and is not specific to these counters:

> **A zero-paid run contains no model. Every zero-paid harness drives the
> tool sequence from a script, so any counter it moves records the
> script's author, not a model's decision.**

The clearest instance is the closest thing the repo has to a "run"
without spend: `scripts/test_selfedit_rehearsal.py` (the Session 35
scripted stage-2 rehearsal, which drives the run's REAL tool sequence
zero-LLM). It constructs a `TrellisTask` and calls `task.grep("notes.txt")`
— a line a human typed. Counting it would have yielded `task_greps: 1`
and that 1 would have meant nothing about adoption.

Adoption is a claim about model behavior. Observing model behavior
requires a model in the loop, which is a paid run. There is no cheap
substitute, and the honest consequence is that **Phase 0b is paid or it
does not happen.** The comparable precedent for scale and cost is the
effective-context probe rounds (`EFFECTIVE_CONTEXT_PROBE_REPORT.md`),
whose round 4 ran 36 runs for $0.9452.

This is guardrail 8 turned on this record itself: a stated measurement
with no mechanism behind it is the same defect class the July 19 pass
existed to close, reproduced in the record that documented the closing.
It survived authoring, review, and merge, and was caught only by someone
trying to run it — which is the argument for executing a specification
early rather than trusting that it reads well.

### 10.2 Finding 1 — the telemetry allowlist drops most counters on the worker path

Tracing whether the counters can be read anywhere surfaced a real,
**pre-existing** gap:

`parseTelemetryLine` (`src/core/observability/rlm_telemetry.ts`)
constructs an explicit **nine-field** result — `input_tokens`,
`output_tokens`, `subcall_count`, `tool_calls`, `mcp_calls`,
`workspace_ops`, `workspace_segments`, `workspace_bytes`,
`execution_time_s`. Every other key in the payload is parsed and
discarded. `src/workers/rlm_worker.ts` then logs five of those nine and
increments five metrics.

So on the worker path these never reach a consumer:

| dropped counters | shipped in |
|---|---|
| `upsum_commits`, `upsum_budget_refusals`, `upsum_shape_refusals`, `upsum_revision` | July 19, 2026 |
| `task_reads`, `task_greps`, `task_verify_authorized`, `task_verify_refused` | July 19, 2026 |
| `textedit_guarded_only`, `textedit_raw_splice_refusals` | July 19, 2026 |
| `textedit_ops`, `textedit_files`, `textedit_writes`, `textedit_guarded_ops`, `textedit_raw_splices` | Sessions 20 / 41 |
| `answer_submits` | Session 22 |
| `retrieved_addresses` | Session 30 |
| the retrieval-discipline counters | Session 33 |

**Nature and severity, stated precisely.** Nothing broke and nothing
regressed: the Python side grew counters across Sessions 20–70 and the
Node allowlist, written when nine fields existed, was never widened. No
behavior depends on the dropped fields — no gate reads them; they are
human-facing diagnostics. The consequence is that **an operator cannot
see these counts in production worker logs or metrics.** That is an
observability gap, not a correctness bug, and it should not be described
as one.

Note the precision the earlier record owed and did not give: Session 30
recorded that the scanner's *tolerance* of unknown fields was pinned.
Tolerance is exactly right — the scanner does not break on an unknown
key. It also does not record it. Those are different properties and only
the first was ever pinned.

**Why this does not block Phase 0b.** The probe drivers do not use the
worker path. `scripts/exp_effective_context.ts` parses the entire
`TRELLIS_TELEMETRY:` payload into an object and reads keys off it, so
every counter is already present there and reading a new one is a
one-line change per field. A paid adoption probe could run today without
touching the allowlist. The two findings are independent, and an earlier
draft of this analysis implied a causal link between them that does not
exist.

### 10.3 What Phase 0a should do

Widen the worker-path scanner so counts survive to a consumer, and pin
the property that was never pinned: that a named counter present in the
payload is present in the parsed result. Prefer a general shape (a
counts map) over extending a nine-item list by hand a fourth time — the
list has now been out of date across five sessions, and hand-extension
is what let it drift. Whatever lands owes a non-test caller by AGENTS.md
hard rule 15 (*Correct is not the same claim as reachable*): a scanner
that parses a field nothing reads has not made it reachable.

Not authorized by this section. It is a bounded feature and wants its own
authorization, like everything else in §8 (Scope, sequencing, and the
authorization gate).

## 11. The case behind .claude/rules/measurement-and-reporting.md rule 20 (dated entry — July 20, 2026)

Recorded July 22, 2026 at owner direction, because the rule it grounds
had no in-repo record: `.claude/rules/measurement-and-reporting.md` rule 20 cited this case, and the only
corroborating text was `.claude/skills/self-play/SKILL.md`, which cites
rule 20 back. A rule whose sole support is a derived artifact citing the
rule is circular, and rule 18 forbids exactly that substitution.

**What happened.** On July 20, 2026 a session validated the newly
authored `self-play` skill by running it against a no-skill baseline —
a with-skill/without-skill comparison asking whether the skill improved
the output. The run re-violated the owner's July 11, 2026
tooling-over-prompts direction (`.claude/rules/measurement-and-reporting.md` rule 8), which had already
ruled that "prove the prompt moves behavior" is anti-useful work:
measurement harnesses close *tooling* failure classes, and prompt text
only reinforces.

**Why it was wrong, stated as the rule rather than the incident.** A
well-engineered instruction constrains the model to its specification.
That it differs from, or beats, an unspecified base-model response is
*entailed* by what an instruction is — the comparison cannot return a
surprising result, so it purchases no information and burns credits.
This is the same defect §4 names for prompt claims and §10.1 found for
adoption: a measurement whose outcome is fixed by construction is not a
measurement.

**The generalization — the nearby-attractor trap.** The session did not
reach for a baseline out of ignorance of rule 8. It reached for one
because a familiar comparison shape was cognitively closer than the
unfamiliar act of naming a stated engineering target. The trap fires
whenever a target has not been stated: the baseline is the nearest
well-formed experiment, so it becomes the default. The countermeasure is
the ordering, not the prohibition — state the target first, and the
attractor stops being the only available shape.

**What remains permitted, so the rule is not read wider than it is.**
Reachability checks and functional-equivalence or regression comparisons
between two versions of an instruction are the rule-20-safe half
([SELF_DESCRIBING_SURFACES.md](SELF_DESCRIBING_SURFACES.md) §5); the
carve-out matters because iterating on a skill *requires* checking that
the new version still does what the old one did. What is barred is the
new-versus-null baseline.

**Standing.** This entry records a case and the direction already
ratified in `.claude/rules/measurement-and-reporting.md` rules 8 and 20. It authorizes no build and
changes no gate.

## 12. Workstream B authorized (dated entry — July 23, 2026, owner, in session)

The collaborator (Matt) proposed that
[`SELF_DESCRIBING_SURFACES.md`](SELF_DESCRIBING_SURFACES.md) be ratified
and this record's implementation authorized, on the argument that these
surfaces are where the RLM harness earns its keep over a stateless
recursive baseline — the harness building in intelligence rather than
inheriting it. The owner (Cnid) approved in session. The design record
was ratified the same day (its §9); this entry is the build
authorization, and its scope is narrower than the proposal's wording,
deliberately.

### 12.1 What is authorized

**Workstream B — the surface-descriptor convention — is authorized**, at
the scope §8 gives it: descriptors bound at each surface's definition
site, `expects` derived from that surface's guard predicates, the
`llm_help` runtime surface, and the human-doc generation that shares the
descriptors. The buildable specification is
[`LLM_HELP_SPEC.md`](LLM_HELP_SPEC.md); the concept and the MASH
correspondence are the design record's.

**Increment 1 is §8's pre-stated first test, unchanged:** give
`trellis_textedit` the full descriptor shape, derive its addendum from
it, and pin that the derived bytes **equal the current addendum bytes
exactly**. It is first because it is the cheap decisive one and because
it is the only thing that turns guard-derivation from an assertion into
an observation — today the closest live mechanism,
`build_textedit_addendum(textedit)` (`src/rlm/trellis_textedit.py`),
*selects* between two pre-authored constants on one state bool; it
derives nothing from a predicate (`SELF_DESCRIBING_SURFACES.md` §9.2).

**Observed, and it sharpens the test:** that selector has **two** arms —
`TEXTEDIT_ADDENDUM` and `TEXTEDIT_ADDENDUM_GUARDED_ONLY` — so increment
1 owes **two** byte-identity pins, one per arm, not one. The guarded-only
arm is the more informative of the two: it is the kernel's first
state-dependent self-description (§9's table), so if a descriptor can
reproduce it exactly, the descriptor model has already covered the case
§2.1 was written for. Byte-identity holding means the
refactor is provably safe and can proceed surface by surface without
moving a pin; byte-identity failing means the descriptor model is lossy,
learned before nine surfaces were touched. **Both outcomes are results.**
Sequencing after that is §8's: surface by surface, then `llm_help`
itself, whose landing is the pin-moving event.

### 12.2 What is NOT authorized, and why the scope is narrow

- **Workstream A — the trace (read buffer + decision log) — remains
  gated.** §8's own direction is that the two workstreams are
  deliberately separable and should NOT ride together; authorizing both
  because both were named in one proposal would discard that. A is a
  worthwhile build on its own merits and can be authorized on them,
  without re-opening this entry.
- **Phase 0b, the paid adoption probe, stays behind rule 7** — printed
  estimate, owner gate, $5/run cap — and §10.1 still governs how it may
  be framed: a zero-paid harness records the script's author, not a
  model's decision, so adoption is paid or it does not happen. It is not
  to be run as a new-versus-null baseline (rule 20; §11).
- **Phase 4 (any gate) is untouched.** Nothing derived from a descriptor
  or a buffer may refuse anything without its own owner gate and a
  measured before/after. `llm_help` informs; it does not adjudicate.
- **No behavior claim attends this authorization** (§8's closing
  sentence, which stands). Whether a derived self-model changes run
  quality remains open and unmeasured. What is authorized is the
  building, not a claim about the result.

### 12.3 What the build owes

- **The bijection (§3) is the acceptance criterion**, per surface it
  reaches: every line of a composed read maps to a guard that enforces
  it, and every guard maps to a line. Orphans in either direction are
  findings.
- **The drift invariant (§2.1) is the design**, not a preference: one
  piece of state both refuses and describes. The moment those become two
  fields, "PREFER THE GUARDED FAMILY" is back.
- **§4's marking duty.** What is not guard-shaped — protocol, not
  refusal — must acquire a guard or be **explicitly marked advisory**.
  An enforced contract and an aspiration written in the same voice is the
  defect this record exists to name.
- **Rule 15 (correct ≠ reachable):** name `llm_help`'s non-test caller,
  or say plainly there is none.
- **The self-play validation gate** (`LLM_HELP_SPEC.md` §6) binds before
  anything relies on the alive catalog — discrimination and
  drift/gaming resistance, with the *selected-on-a-lie* cell
  pre-committed as the falsifier.
- **Composition must be total (§5).** A surface × action pair with no
  composed read gives the agent silent absence, which is the audit's own
  failure class one level up. The build owes a default and a check.
