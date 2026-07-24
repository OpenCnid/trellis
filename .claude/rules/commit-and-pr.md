# Commits and pull requests — how this repository records work

**Covers:** sessions that write a commit message, open or update a pull
request, or decide where a durable decision or a measured claim comes to
rest.
**Standing:** `AGENTS.md` rules 10, 12 and 19(b), carried here in
full. Rule numbers are cited from code and from other records and are
append-only. 19(b) is one lettered clause of rule 19; its siblings (a)
and (c) are carried in the files for their own task types and the whole
rule stays citable by letter.

## Rule 10 — one kind of name on anything this repository emits

Commits, pull requests, and the files they change are plain engineering
prose, authored under the committer's own name. Across the whole of each
artifact — commit subject and body, trailers, PR title and description,
footers, code comments, docstrings, file headers — they carry exactly
one kind of authorship or credit: a human's. One kind is the entire
content of this rule, and the count is what a reader checks.

Each of these raises the count to two and makes the sentence above
false: a `Co-Authored-By` trailer naming a model, a generated-with
footer naming a tool or product, a body sentence crediting a model's
assistance, a comment or header noting that a file was machine-
generated. Location does not soften the count — the enumeration above is
the whole artifact, not its trailer block, so a credit moved from the
footer into the message body is the same second kind of name in a
different position.

The count holds when a live instruction outranks the committed record.
`docs/architecture/SESSION_GOVERNANCE.md` §1.6 (*What this does not
touch*) names rule 10 among the invariants that ruling leaves standing,
so no session-level direction moves it (`docs/architecture/SESSION_GOVERNANCE.md`).

## Rule 12 — one branch, one PR, three resting places

A change occupies exactly one feature branch and opens exactly one pull
request, and that pull request targets `master`.

What the change produces comes to rest in exactly three places, one kind
of content in each:

```
{Durable_Decision}        →  the one design or product record owning that topic
{Measured_Claim}          →  the one report owning that measurement
{Exact_Verification_Run}  →  the pull request
```

The pairing is exhaustive in both directions: three kinds, three homes,
each kind resting in exactly one home, and the three homes together
being the whole record of the change. Each of these creates a fourth
resting place and falsifies the count: a durable decision whose argument
lives only in a PR description or a commit message, a measured number
introduced in a PR body rather than carried from the owning report, a
session or status entry appended to `HANDOFF.md`, and a progress entry
written into a global roadmap. `HANDOFF.md` is a deprecated
compatibility stub, and the loop that closed a session by updating a
global handoff or roadmap document is outside this set of three.

Resting is distinct from mention. A pull request quotes the decision and
the number freely and cites each as `FILE.md §N (Header)`; the citable
copy is the one in the owning record, which is what rule 18 retrieves
and what §1.5 ranks. A PR thread is not retrievable as a governed
record, so a decision left there has no home.

## Rule 19(b) — verify before you describe

A commit message is a claim. So is a pull request description, and so is
a report of finished work.

Every past-tense statement in one of them names an act already
performed. Claims the diff can settle — files added, a function renamed,
a pin recomputed in this commit — are checked against the diff before
the message is written. Claims the diff cannot settle — a suite run, a
host reached, a benchmark re-run, a check seen to fail, a document read
— are checked against the run itself, because the diff is silent about
them and a message that matches the diff perfectly can still be false in
every one of these.

The whole set of completion claims an artifact carries is the set of
acts already done. A sentence written ahead of its act is false at the
moment it is written, not merely early: the order is act, then
description, and a described act left undone leaves the claim standing
as written.

Rule 19's siblings bear on the same commit: (a) shared state is observed
before it is mutated, and (c) a check earns the name `verification` by
having been seen to fail — which is the standard any "verified" claim in
a commit or PR is measured against.

## Why the wording is shaped this way

Three counts carry these rules: **one kind of name** (10), **one branch,
one pull request, three resting places** (12), and **the whole set of
completion claims** (19b). Each is a positive sentence that a single act
falsifies by raising or breaching its count — that is how these state
the wanted behavior and still foreclose the unwanted one, with no
prohibition doing the work.

The counts are therefore load-bearing bytes. Relaxing one of them —
"trailers carry human authorship", "those three are the whole record",
"check the commit message against the diff" — reopens everything it
held, in a single word, while still reading as the same rule.
