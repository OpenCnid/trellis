# Standing configuration — rule 21(b)

**Covers:** a session whose output includes something a later session loads
without having asked for it — a permission rule, an MCP server, a hook, a
skill, a memory file, a sub-agent definition, a module addendum, a scheduled
job.
**Standing:** `AGENTS.md` §4 rule 21(b), carried here in full. 21(a) — the
question the collaborator alone can answer, and the one-question cap that
governs it — keeps its text in `AGENTS.md` and is cited from here rather than
restated; both letters stay citable and rule numbers stay append-only. Rule 8
(tooling shape closes behavioral failure classes) and rule 14 (a protected
pause refuses the effect it names) keep their text there too. Construction:
`.claude/skills/spark-steering/SKILL.md` § *Ask first — the un-tool*
(derived; §1.5).

## 1. What this ranges over

**One property fixes the set; the named items are members of it.** Standing
configuration is anything this session writes that a later session loads
without having asked for it. The eight items above are the instances this
repository has met so far, and the set is fixed by the property rather than
by the list — so a form nobody has named yet sits inside 21(b) on the day it
is first reached for: a settings key, a committed env default, a
directory-scoped `AGENTS.md`, a plugin, an `if` clause widened on an existing
hook, a `disable-model-invocation` flag flipped off, a line added to a file
that is already injected. The test is one question about a later turn: does a
session that never read this transcript now carry something it did not
choose? Yes → this is standing configuration, whatever the change is filed
as.

**Exactly one property is irrelevant to that test: how small the change is.**
A one-line `permissions.allow` entry and a whole MCP server differ in install
cost and not in kind. Permission rules merge across every settings scope
rather than override, and each registered server is a reach surface every
later permission and audit pass accounts for
(`.claude/skills/spark-steering/references/steer-3-costs.md`, classes 3 and
7). Editing an installed thing is an install: the edited configuration is
what every later turn loads.

## 2. Who pays

**Exactly one party to an install pays none of its recurring charge: the
session that performs it.** The charge falls on every turn after the install
and on no turn before it. The budget being spent therefore belongs entirely
to sessions that are not present to be consulted, and to the collaborator,
who receives the context tax, the latency, the approval prompts, the dilution
of every later dispatch, and the eventual reconciliation of a store that does
not prune itself.

**The installing session observes exactly one turn under the configuration —
its own — and that turn is the single one in which the configuration is known
to be relevant.** An estimate drawn from that one observation is drawn from
the whole of the favourable case. Twelve cost classes are written down in
`steer-3-costs.md` and none of them scales to zero; a capability that does
nothing on a given turn still charges for that turn.

**A fix installed on an axis the gap does not sit on charges the same rent
and closes nothing** (`SKILL.md`, opening). Which axis is short is the
question the diagnosis answers, and the self-check block in that skill
carries two lines that record the un-tool having been reached for first:
`Cheaper move considered:` and `Left unmoved:`.

**Removal runs the opposite way from installation.** An install takes one
session. A removal takes a session that first attributes a diffuse per-turn
charge to one specific installed thing — so the set of sessions positioned to
notice the charge is smaller than the set paying it, and the default fate of
an installed thing is to stay.

## 3. The two kinds of gap

**A gap that prompts an install is exactly one of two kinds, and each kind
has exactly one closing move.**

- **An underdetermined instruction.** The live task admits more than one
  reading, or the call is a values or scope call the collaborator makes.
  Closed by the question, at its source (21(a)). The whole set of things a
  session can install closes none of it: a permission rule, a hook, a skill,
  a sub-agent, and a memory file each act on a reading the session has
  already picked, so installing one settles the ambiguity by the session's
  own guess and then keeps that guess for every later turn, unread.
- **A behavioral failure class.** A way the work goes wrong repeatedly, under
  every reading of the instruction. Closed by tooling shape (rule 8). A
  question closes none of it: an answer binds the turn that asked, and the
  class recurs in the turns that did not — so a question standing in for
  tooling leaves the class open while reading as diligence.

**A gap of both kinds carries both closures, discharged separately.** No
single move covers both, and a session holding one of them has the other
still open. Which kind a gap is settles which move applies; how much a
session would prefer to be finished settles nothing.

## 4. What satisfies 21(b)

**Exactly one thing satisfies 21(b): the question, put to the collaborator in
the chat channel, in the session that would perform the install, before the
install.** The whole set of records a session can produce instead satisfies
none of it — a comment in the config file explaining the choice, a PR body, a
commit message, a handoff line, a `Left unmoved:` line, a sentence inside the
memory file being written, this paragraph quoted back. Each of those is a
description of a decision already taken, and a description is never the
question, so a transcript carrying one without the question is a transcript
of an unconsulted install. The repair when it happens is stated plainly and
the configuration comes out; an attestation written afterwards does not reach
back and consult anyone.

**The question names the recurring charge and not the install.** What a
session already knows is that installing costs one edit. What the
collaborator is positioned to weigh is the run of turns afterwards: what
fires the thing, how often, on whose turns, what it displaces, and what
removing it would later take. A question that puts only the edit costs the
same turn of attention and returns an answer about the cheap half.

## 5. Between the question and the answer

**The set of standing configuration a session installs between putting its
question and receiving its answer is empty.** A session that asks and then
installs on its own guess has answered its own question; the collaborator's
answer then arrives to a decision already made, and the turn of attention it
cost bought nothing. The answer arrives to a decision that is still open, or
the question was decoration.

**Every preparatory step whose result does not depend on the answer is
discharged in the turn that carries the question** (rule 14). That set is
usually large — reading the current configuration, locating the file the
change would land in, checking what already covers the case, running the
diagnosis, drafting the exact bytes for review — and it is discharged and
reported in that same turn. Stopping is not standing down: the preparatory
work is already done and reported when the question is put, and what waits is
the install alone.

## 6. What needs no question

**The whole set 21(b) gates is the set this session proposes itself.**
Standing configuration the collaborator's live task names is already
answered — rule 1's objective is the answer, and putting it again spends the
one-question cap on a settled point (21(a)). A session under such a task
carries the ordinary duties instead: the diagnosis, the smallest scope that
covers the named case, and a plain report of what the thing will charge on
every later turn.

**One kind of edit sits outside this file entirely: removing standing
configuration, or narrowing what an installed thing matches.** Both reduce
the recurring charge, which is the interest 21(b) protects, and both are
ordinary work under the rules that govern any other change.

## 7. This file

**This file is standing configuration and pays the charge it describes** —
class 1, re-injected on every matching trigger, on turns where it applies and
turns where it does not. It is named here so that the rule's own cost is
visible to the sessions carrying it, and so that a later session weighing
whether it still earns its place has the accounting in front of it.
