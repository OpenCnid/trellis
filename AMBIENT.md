# AMBIENT.md — the rules whose trigger is that a session exists

**Status:** part of the repository-wide session contract. `AGENTS.md`
describes Trellis and routes; the task-type files fire on a matched file
or command; this file carries what is left. Invariants only, amended by
ordinary review on a feature branch (rule 12), never by silent edit.
**Scope:** every agent, CLI, harness, and model opening this repository.

Trellis is OpenCnid's Recursive Language Model runtime: a language model
operating a persistent Python REPL over a knowledge store where every
stored fact traces to immutable content-addressed source bytes.

Most rules in this repository wait for an event — a file opened, a
command run, bytes written. These five wait for nothing. A session has
an objective, sits under whatever gates the collaborator has set, claims
things are delivered, rests those claims on records, and can ask. That
is the whole trigger. Numbers are append-only and cite exactly as they
did in `AGENTS.md` §4. Rule 21 is split: 21(a) is here, and 21(b) —
asking before installing standing configuration — has a detectable
trigger and lives with the task-type files.

## Rule 1 — where the objective comes from

The session takes its objective from exactly one source: the
collaborator's live task. Every other artifact a session can read — a
branch name, `HANDOFF.md`, an archived roadmap, a prior session's
progress entry, a governing record, the session's own sense of what is
next — bounds or informs how the work is done and selects none of what
work happens. The session reads `AGENTS.md`, orients at the shallowest
`ORIENTATION.md` density that answers its question (D3 before designing
anything), and retrieves the task's governing records before it decides
or edits. A session holding no live task holds no objective, and its
whole next move is the rule-21(a) question.

## Rule 14 — what a protected pause withholds

A protected pause refuses the effect it names, and nothing more. An
owner gate on a paid run, a push, a merge, or an acceptance record
withholds exactly that one effect: the whole of what a gate blocks is
the effect named in it. Work the gate leaves unnamed continues under the
direction already given, and the owner keeps sequencing authority over
the whole of it — the session surfaces a discovered defect with a
proposed fix, and the owner chooses when it lands. The session
discharges every unprotected preparatory step and specifies the request
in full. It refuses a specified request on exactly two grounds: a failed
provenance predicate, or a failed scope predicate. The gate withholds an
effect and leaves the chat channel open (rule 21(a)).

## Rule 15 — correct is a different claim from reachable

A passing suite establishes that the code is right. The whole of what
establishes reachability is a named non-test caller — a process
entrypoint, a package script — so a suite of any size leaves
reachability exactly where it found it. Before every claim that a
capability is delivered, the session names that caller; when the set of
non-test callers is empty, it says so plainly in the same breath as the
claim. This repo has shipped the same defect three times, most recently
`StateStore.open()` with no caller outside tests behind 1,161 green
tests.

## Rule 18 — retrieve before you decide or claim

Exactly one thing discharges a load-bearing act's obligation to its
record: the source, retrieved and quoted this session. Every derived
representation — an orientation compression, a design record, a skill, a
memory, a sub-agent's report, this session's own earlier summary of a
file it read — carries the work and discharges none of that obligation.
Deciding what work to do and stating what a record establishes are both
load-bearing acts. The tell is that the session cannot name the file and
section it retrieved *this session*. A lossy summary reads exactly like
a faithful one from the inside, so retrieval is what corrects it.
`docs/architecture/CODE_MEDIATED_TEXT.md` §2.9 (the pillar applied to
authority) generalizes the rule ratified for papers in
`docs/RESEARCH_NOTES_COLLECTION.md` §3; Session 71 is the case;
`AGENTS.md` §1.5 (Authority ordering) is the chain it rests on.

## Rule 21(a) — ask the collaborator

The cheapest available move is a question in the chat channel (the
un-tool; owner-directed July 22, 2026). Declining to call anything and
asking is a move: no schema, no install, no recurring cost, and the only
move of any kind that resolves an underdetermined instruction at its
source. Two occasions are ambient — an instruction whose intent is
underdetermined, and a values or scope call that is the collaborator's
to make; rule 21(b) carries the standing-configuration case. The cap is
exactly one question, asked in the turn that has already discharged
every preparatory step rule 14 leaves unprotected. The session then
stops and waits, and the whole of what closes the question is the
collaborator's answer (owner ruling, July 22, 2026,
`docs/architecture/SESSION_GOVERNANCE.md` §2). Stopping is not standing
down: the preparatory work is done and reported when the question is
put. Asking resolves ambiguity in an instruction; the whole of what
closes a behavioral failure class is tooling shape (rule 8). A move with
no surface stays invisible until it is named, and this rule is that
name. Construction: `.claude/skills/spark-steering/SKILL.md` § *Ask
first — the un-tool* (derived; `AGENTS.md` §1.5).
