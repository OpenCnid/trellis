# The AGENTS.md trunk restructure — Design Record

**Status: IMPLEMENTED — 2026-07-24.** The trunk (`AGENTS.md`), the ambient
rules (`AMBIENT.md`), and the nine task-type leaves (`.claude/rules/*.md`) are
committed on branch `d/agents-md-restructure-31b998` — commits `e22a50f`
(navigation-map + density-trellis repair), `d16d084` (the restructure), and
`f0154d2` (following the moved rule-number citations). Delivery today is the
trunk's fan-out index plus the skills. **DESIGN, not built:** the hook channel
that would inject a leaf on a file or command match, and the budget-ladder /
`governedPrefixes` proposal in §6 — both recorded here for a later owner
decision, neither authorized. Amended only by dated entry, never by silent edit.

This record leads the implementation it describes: it is the provenance a
session that was not here reads to understand why `AGENTS.md` is now a stalk of
routing rather than a wall of rules. Every measured claim is grounded in
`scratchpad/RESULTS.md` (filed 2026-07-23, scored against pre-registrations) or
in a commit; where a result is loosely attributed, the record says so, because
that honesty is the point of writing it down.

## Contents

1. [The problem](#1-the-problem) — a byte-capped monolith, compression-exhausted
2. [The design](#2-the-design) — trunk / ambient / leaves, and the one fan-out rule
3. [The task-type taxonomy](#3-the-task-type-taxonomy) — ten kinds, and ambient vs triggered
4. [The audit inside the restructure](#4-the-audit-inside-the-restructure) — silently weakened binds, repaired in place; rules 22 and 23
5. [The evidence](#5-the-evidence) — demonstrated vs attributed-loosely
6. [The honest edges](#6-the-honest-edges) — the worst case, the unbuilt hook, the budget-ladder proposal

---

## 1. The problem

`AGENTS.md` is the house prompt: read at 100% duty cycle by every agent, CLI,
harness, and model that opens the repository. Before this restructure it carried
all twenty-one hard rules inline, and it had grown the only way an append-only
invariant file grows — by accretion. It sat at **31,345 bytes against a
32,768-byte ceiling** (the `root-contract.json` `agent`-class budget). Roughly
1.4 KB of headroom remained, and every future rule, exception, or worked example
had to be paid for out of it.

The file was **compression-exhausted, not verbose.** The rules it carried are
mutually orthogonal invariants — how the substrate is written, how a paid run is
gated, how a judge is composed, how a commit is named — and orthogonal
invariants do not fold into each other. There was no redundancy left to squeeze;
the next edit had to either evict a rule or breach the cap. This is the failure
mode `scratchpad/staging/rule22-merged.md` names in its bytes clause: a byte
ceiling "refuses at the boundary and bills whoever crosses it, not the sessions
that spent the headroom," so the file "has repeatedly arrived at its cap with
nobody responsible."

Underneath the byte problem was a structural one. **The stalk carried every rule
for every task at all times.** A session renaming a variable paid the full
context cost of the paid-run gate, the judge-composition law, the A2A boundary
contract, and the retrieval-discipline rule — none of which its work could
trip. The monolith optimized for having-said-it-somewhere at the cost of
saying-it-where-the-work-is.

---

## 2. The design

The monolith split into three tiers, joined by one rule.

- **The trunk — `AGENTS.md` (7,402 bytes).** What Trellis is (the two governing
  doctrines and the authority ordering `code > glossary > prose`, a live
  instruction outranking all three), an annotated file tree, and an index. It
  states one rule and routes everything else.
- **The ambient layer — `AMBIENT.md` (5,517 bytes, `root-contract.json`
  `agent`-class, 8,192-byte budget).** The rules whose trigger is that a session
  exists at all: 1, 14, 15, 18, 21(a). These bind every session whatever the
  task, so they cannot be delivered by a task match — they are read up front.
- **The leaves — `.claude/rules/*.md` (nine files, 55,374 bytes in total).**
  Each carries the rules that fire on one kind of work, delivered only when that
  work begins.

### The one rule is the whole method

> **Fan out from this file as far as the work needs, and no further.**
> (`AGENTS.md` § *The one rule*)

Every obligation sits one hop from the trunk, named in an index that pairs a
*moment* with *where it is settled*: a rule fires on a kind of work, a skill on
a kind of task, a record on a kind of question. Before acting, a session opens
the ambient rules, then the leaf that fires on its work, then the skill that
fits its task, then the record that governs what it touches, then the nearest
directory-scoped `AGENTS.md` where it edits. The trunk holds none of the rule
text — it holds the map to it. This is the entire architecture: **the routing is
the design, and the leaves are the payload it routes to.**

### A leaf is a composed payload (the SPARK reading)

Each leaf is not a slice of prose but a composed payload over three of the five
SPARK axes the `spark-steering` skill names (Skills · Personalities · Approaches
· Resources · Knowledge — `.claude/skills/spark-steering/SKILL.md`):

- **Approach — the rule itself.** The normative text: what is true of Trellis
  and what an edit must not make false.
- **Knowledge — the records it cites.** The design records, code homes, and
  dated owner rulings a session must retrieve to discharge the rule (rule 18).
  `substrate-writes.md`, for one, names `src/core/ast/persist.ts`,
  `alias_resolution.ts`, `CODE_MEDIATED_TEXT.md`, and the test pins beside each.
- **Skills — the invocations the work triggers.** `composed-evaluators.md`
  points at `judge-composition`; `prompt-authoring.md` opens the
  `prompt-engineering` + `hypershot-protocol` gate before the first byte.

The two axes a leaf does *not* carry — Personalities and Resources — are why the
tier exists rather than a flat rule list: a leaf steers *the work's own SPARK
coordinates*, it does not impersonate a role or grant a capability. This reading
is not decorative; §5's ablation cut the Knowledge and Approach axes of one leaf
as separate experimental arms.

### Delivery: fan-out index plus skills now, hooks later

Today a leaf reaches a session because the session reads the trunk's index,
recognizes its moment in a row, and opens the file that row names — plus the
skills, which fire on their own descriptions. **There is no hook that injects a
leaf on a file or command match.** `.claude/settings.json` carries only the
density-chain checker on `SessionStart` and `Stop`; no leaf-injection hook is
wired (verified against the file, 2026-07-24). The hook channel is the intended
future delivery — a leaf pushed the moment a matching file is opened or command
run, closing the gap between "the index names the leaf" and "the session opened
it" — but it is unbuilt, and §6 records why that gap is not closeable from
inside a session.

---

## 3. The task-type taxonomy

The twenty-one rules were partitioned by the work that trips them. Eight
independent passes, each blind to the others' groupings (the same blind-seat
discipline the session applied to its studies — §4, and
`scratchpad/staging/SESSION_METHOD.md` § *What each seat was blind to*),
converged on **ten kinds of work.** Nine became leaves; the tenth is the ambient
floor.

| Leaf | Fires when the work… | Rules carried |
|---|---|---|
| `substrate-writes` | touches the content-addressed store, its provenance, or a retrieval surface | 2, 3, 4, 5, 13 |
| `prompt-authoring` | writes bytes that will enter a model's context as instruction | 16, 6 |
| `composed-evaluators` | builds a judge, panel, rubric, defeater, or sub-agent | 17 |
| `measurement-and-reporting` | designs a test or publishes a measured number | 8, 11, 19(c), 20 |
| `spend-and-live-infrastructure` | spends money or touches a live DB, queue, or host | 7, 19(a) |
| `governed-documents` | edits a byte-budgeted document or the navigation map | 22, 23 (new) |
| `commit-and-pr` | authors a commit message or a pull request | 10, 12, 19(b) |
| `boundaries` | consumes a completion or changes an external surface | 9 |
| `standing-configuration` | installs anything that persists past the session | 21(b) |
| **ambient** (`AMBIENT.md`) | **a session exists** | 1, 14, 15, 18, 21(a) |

Rule 19 fans out by clause — (a) observe-before-mutate to
`spend-and-live-infrastructure`, (b) verify-before-describe to `commit-and-pr`,
(c) watched-failing to `measurement-and-reporting` — each clause landing where
its work lives, the whole rule staying citable by letter. Rule 21 splits the
same way: 21(a) is ambient, 21(b) is a leaf.

### The principle that decided ambient vs triggered

**A rule with a detectable trigger event becomes a leaf; a rule whose trigger is
being-in-session-at-all stays ambient.** `AMBIENT.md` states it in its own
words: "Most rules in this repository wait for an event — a file opened, a
command run, bytes written. These five wait for nothing. A session has an
objective, sits under whatever gates the collaborator has set, claims things are
delivered, rests those claims on records, and can ask. That is the whole
trigger."

The split of rule 21 is the principle at work on a single rule. 21(a) — *ask the
collaborator when an instruction is underdetermined or a values call is theirs
to make* — has no trigger but the session itself, so it is ambient. 21(b) — *ask
before installing standing configuration* — fires on a detectable event (a
permission rule, a hook, a memory file about to be written), so it is a leaf.
The same rule number lives in two tiers because its two clauses answer to two
different triggers. This is the sorting rule made concrete: the question is never
"is this rule important" — all twenty-one are — but "what event, if any, tells a
session it is now on the hook."

---

## 4. The audit inside the restructure

Moving the rules was not a copy. A prior compression pass — the July
positive-framing rewrite that turned prohibitions into positive statements of
wanted behaviour — had **silently weakened a set of rules while preserving every
appearance of rigor.** The restructure repaired each bind as it moved it, and
added two rules to keep the failure from recurring.

### The failure mechanism: the operator held, the noun slid

The positive-framing pass preserved each rule's **exhaustiveness operator**
(*every*, *all*, *only*, *the whole set*) while the **noun beneath it moved** to
a broader or narrower one. The sentence still read rigorous and held nothing.
`scratchpad/staging/SESSION_METHOD.md` catalogues three independent instances
found this session: *"every literal brace"* came to quantify over
braces-within-one-string where the original quantified over strings; *"writable
by the operator alone"* came to quantify over permission where the original
quantified over provenance. The addressable evidence is the diff
`agents_before.md` → `agents_after.md`, whose mechanism column is filed as
`scratchpad/bind-key.md`.

**How many rules were weakened is a reconstruction, not a ledger.** The
artifacts support "**roughly eleven**" (`SESSION_METHOD.md`: the before/after
diff "reads better throughout and weakens roughly eleven rules"), and
`SESSION_METHOD.md` states plainly that "the audit that produced 'eleven' … is
not itself filed here." The corpus counts that *are* filed are the bind-gate
corpus (12 real migrations, 10 constructed widenings, 1 historical leak). The
count of weakened rules should be read as an order-of-magnitude reconstruction,
not a verified figure.

### The repair: a cardinality operator on the right noun

Each leaf repaired its own binds while moving them, re-anchoring the operator to
the noun the rule actually foreclosed on. The pattern is visible throughout the
committed leaves:

- `boundaries.md`: "`parseLlmResponse` … The set of call sites that turn
  completion text into a value by another route is **empty** … **across the
  repository**, not across `src/workers/`" — the operator re-pinned to the
  right scope, with the six real call sites enumerated so the claim is checkable.
- `commit-and-pr.md`: "**one kind of name**", "**one branch, one pull request,
  three resting places**", "**the whole set of completion claims**" — three
  cardinality operators, each over a named noun, with the file's closing note:
  "Relaxing one of them … reopens everything it held, in a single word, while
  still reading as the same rule."
- `governed-documents.md` clause (c): "each index … carries a row for exactly
  the entities its membership rule admits" — the operator bound to *the
  membership rule*, not *the rows the session happened to touch*.

### Rules 22 and 23 are new

The audit's lesson is that a governed document's *meaning* can rot while every
machine check stays green. Two new rules close that class, split at the seam a
governed-document edit actually has — *is the document still true about the
world* versus *did this edit do what it says* (`rule22-merged.md`; numbers are
append-only, so the pair takes 22 and 23 rather than renumbering):

- **Rule 22 — the document's claims about the repository.** The session updates
  every claim the document makes about the repo, in the commit that falsifies
  it. (a) **Counts** — recompute every stated number by a named command, and
  repair the whole set of sentences stating it, repository-wide. (b)
  **Addresses** — follow every section/rule/heading identifier it moves to every
  citation, bare `§` references and code-comment citations included. (c)
  **Rows** — settle each enumeration's membership rule, because
  *named-implies-exists* is what `check:repo-surface` proves and
  *exists-implies-named* is not.
- **Rule 23 — the edit's claims about itself.** For every directive it rewrote,
  the session names one case the original foreclosed and the rewrite still
  forecloses. "A green suite, a met byte budget, and intact numbering all held
  while rule 19(c) once shipped as its own converse."

The two rules were drafted by two agents working blind from deliberately
different starting points — one from the record of failures, one from what the
existing checkers can and cannot see. They converged on three clauses and each
found one the other could not: the failure-first draft found **binds** (rule 23,
the clause that would have caught this very audit); the tooling-first draft found
**bytes** (the ceiling that bills the last editor). Picking a single winner would
have shipped a rule missing either its most important clause or the one that
explains the file's whole history. The full derivation, including four candidate
duties dropped for already being tooled, is `scratchpad/staging/rule22-merged.md`
— written for the collaborator to improve, with its open questions still open.

---

## 5. The evidence

Four pre-registered studies ran against the restructure. Each named a forecast
and a falsifier before its run; `scratchpad/RESULTS.md` resolves them. The honest
split is between what the studies **demonstrated** and what they only
**attribute loosely** — the latter confounded by four instrumentation flaws
found, by the session's own account, "by reading a return carefully, never by
designing carefully."

### Demonstrated

- **The material reaches sessions and changes what they do.** *Compliance*
  (`RESULTS.md` §3): five traps posed as ordinary work, no probe mentioning
  rules, run across three model sizes. Result: **four hard passes and one soft
  failure** — a history-search-by-keyword trap (rule 13) refused on sonnet, a
  standing four-judge roster (rule 17) caught unprompted on haiku, sonnet, *and*
  opus, and a "see the lift" A/B (rule 20) refused at design time on sonnet. No
  model gradient on rule 17: the leaf carried it at every capability level. The
  honest note the owner's category requires — **haiku passed compliance and
  fabricated `Rules 17a/17b/17c`, which do not exist**, so compliance and
  provenance came apart; the board is 4 hard + 1 soft, not 5/5.
- **A broken index fails loudly.** *(`RESULTS.md` §5, "the one thing measured
  cleanly.")* Across ~10 sessions, 3 models, and 4 payload variants, **every
  probe detected and reported the dangling index rows** (six of nine index rows
  pointed at leaves not yet written when the routing test ran). Not one proceeded
  as though a missing leaf existed; several searched the whole repository to
  confirm absence; one made flagging it a numbered plan step. This needed no
  baseline and no attribution — a session either notices a broken pointer or it
  does not — and it is the property the architecture most needed, because the
  whole design rests on pointers.

### Attributed loosely — which channel deserves the credit

- **Routing was reachable 4/4, but not shown to happen unprompted.** *(§2.)*
  Four sessions, one entrypoint with an index, none told routing was measured,
  each reached the correct leaf (including a multi-row task and a control task
  with no correct leaf, which reported and asked rather than over-routing). The
  pre-committed falsifier — a confident wrong route — stayed empty. **The
  confound, found after:** the return contract asked each agent to name the rules
  governing its work, "which is a prompt to go looking for them. This measures
  that routing is *reachable*, never that it happens unprompted."
- **The SPARK ablation was uninformative on self-sufficiency, by construction.**
  *(§4.)* One task, one model (`claude-sonnet-5`), three payloads cut from the
  `composed-evaluators` leaf: control (5,389 bytes — the intact leaf),
  no-knowledge (4,387), no-approach (3,728); the no-skills arm was cut when its
  builder measured the removal at 162 bytes of 5,389, "close to a null." **All
  three passed — and all three read the intact 21-rule `AGENTS.md` anyway**, so
  no arm's pass is attributable to its leaf. Two causes, both the designer's: the
  arm prompts *named* the root file while trying to deprecate it, and the
  directory names (`ablate/control/`, `ablate/no-knowledge/`) encoded the
  condition to anyone who listed them. One real signal survived the noise: the
  no-knowledge arm went to the root file *for the stated reason that its leaf
  only summarized rules 6, 16 and 21* — it detected its own insufficiency and
  sought the source, exactly as its builder predicted.
- **The bind gate is sensitive, not shown to discriminate.** *(§1.)* On 23
  unlabelled pairs, v2 (after an exception sweep was added) reached 10/10 recall
  on adjudicator-confirmed leaks with the pre-committed falsifier cell empty, and
  **the positive control fired** — A10, rule 19(c) shipped as its own converse,
  caught with the mechanism named exactly. But 21-of-23 flagged is *sensitivity*;
  the batch-2 corpus built to test discrimination (12 fresh mechanisms + 3
  genuine style-only controls) was never run. A finding fell out of the run
  regardless: the gate, an independent adjudicator, and the author's own reading
  all agreed that three of the twelve "faithful" migrations were *not* faithful —
  **the answer key was the defect, not the gate.**

### The four confounds, and the prediction record

The instrumentation flaws, in the order found (`RESULTS.md` §7): (1) the return
contract asked agents to name governing rules; (2) the intact 21-rule
`AGENTS.md` was left reachable on every path; (3) arm prompts named that file
while deprecating it; (4) directory names encoded the experimental condition.
"A clean round needs neutral path names, no mention of the superseded file, and
no request to cite anything — run once, deliberately." None of that clean round
has been run.

**The restructure is not shown to improve anything.** No such measurement was
attempted, and it would be barred if it were: a with-versus-without run is the
new-versus-null baseline rule 20 forecloses (`measurement-and-reporting.md`
§ Rule 20 — "a null arm returns its own premise").

The prediction record is **1 of 8** (`RESULTS.md` §6). Seven misses, every one
pessimistic; the single hit was the designer predicting that their own ablation
would be uninformative. The direction of the bias is itself the finding: the
session "systematically underestimated what a well-built page does." That is
recorded here because a method that logs only its hits is not a method.

---

## 6. The honest edges

- **The floor is low; the worst case is high.** Every-session read dropped from
  **31,345 to 13,006 bytes** (commit `d16d084`; a fresh LF `wc -c` gives 7,402 +
  5,517 = 12,919, the small delta being CRLF normalization in the working tree).
  But a session that trips all nine leaves reads the floor **plus ~55 KB**
  (55,374 bytes across the nine files) — roughly 68 KB, more than double the old
  always-on monolith. The design wins whenever a session touches few leaves and
  loses whenever it touches most.
- **The distribution that decides net cost is unmeasured.** Whether the
  restructure reduces total context spend depends on how many leaves a real
  session trips on average, and that distribution has not been measured. The
  demonstrated results (§5) concern reachability and behaviour change, not net
  byte cost. This is the central open empirical question and it is open.
- **The hook channel is wired nowhere and unverifiable from inside a session.**
  Delivery today is the fan-out index plus skills; the file-or-command-match hook
  that would push a leaf automatically does not exist in `.claude/settings.json`.
  Worse, a hook's presence cannot be confirmed from within a session that would
  benefit — a session cannot observe the injection mechanism that fed it — so the
  hook tier, when built, will need verification from outside the session (a
  harness-level test), not a self-report. Until then the index is load-bearing,
  which is exactly why "does a broken index fail loudly?" was the property worth
  measuring first (§5, demonstrated).
- **Rules 22 and 23 lean on prose where a checker would be stronger.**
  `rule22-merged.md` § *What should not stay prose* marks every clause as interim
  under rule 8 and flags clause 22(a) (Counts) as "a sentence guarding a silent,
  permanent failure" until tooled, and clause 23's binds as "the one no checker
  will ever hold" (no static analysis sees a converse). A re-derivation cannot be
  distinguished from a copy in a diff, so the rules make the omission *nameable*
  in review; they cannot make it impossible.

### The budget-ladder proposal (recorded, not built)

The single 32,768-byte `agent`-class ceiling treats the trunk and a heavy leaf
as the same kind of object. A **budget ladder** — measured per-class ceilings,
one for the trunk, one for the ambient layer (already carved out at 8,192
bytes), and one for the leaf class — would let each tier be governed at the size
its job warrants rather than borrowing against a shared cap. This is recorded as
a proposal for a later owner decision; no ceiling change is authorized here.

The ladder pairs with a **`governedPrefixes` / section-cap** extension to
`root-contract.json`, aimed at the gap rule 22(c) names in prose:
`check:repo-surface` proves *named-implies-exists* (every listed path is real)
but not *exists-implies-named* (every leaf under `.claude/rules/` is indexed).
A `governedPrefixes` declaration — "every `*.md` under this prefix must appear in
the trunk index and carry a section cap" — would close the exists-implies-named
gap mechanically, and it is the same shape as the `declaredCounts` block
`rule22-merged.md` proposes for clause (a) (pair each counter with the regex of
the number-words asserting it, so `wiki_check`'s `roster.length` is compared to
the "13 subsystem-class branches" string it currently computes two lines away
from and never checks). Both are proposals; neither is built.

### A count drift found in passing

The restructure's own self-application demonstrated rule 22(a) in miniature. Rules
22 and 23 make the rule set **twenty-three**, and rule 22(a) obliges the same change
to repair every sentence stating the old count. `AGENTS.md` no longer states a count
(the restructure deleted the section that did), but `docs/density-chain/DENSITY-CHAIN.md`
line 680 and its HTML render read "twenty-one hard rules" — a live instance of exactly
the failure rule 22(a) governs, a count claim left stale by an edit elsewhere. The
cleanup pass caught both and corrected them to twenty-three, closing the cascade in
the same change that opened it.

---

## Provenance

- Committed artifacts: `AGENTS.md`, `AMBIENT.md`, `.claude/rules/*.md`,
  `tools/repository-surface/root-contract.json`, `.claude/settings.json`;
  commits `e22a50f`, `d16d084`, `f0154d2`.
- Staged evidence (session scratchpad, not committed): `RESULTS.md`,
  `staging/SESSION_METHOD.md`, `staging/rule22-merged.md`, and the bind corpus
  and pre-registration files they cite.
- Doctrine this record rests on: `docs/architecture/COMPOSITION_FROM_PRIMITIVES.md`
  (frame-hood read off a candidate), `docs/architecture/SESSION_GOVERNANCE.md`
  (the authority ordering and what a live instruction outranks),
  `.claude/skills/spark-steering/SKILL.md` (the SPARK axes a leaf composes over).
