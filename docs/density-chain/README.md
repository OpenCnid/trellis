# `docs/density-chain/` — the Trellis density-trellis

A branching chain-of-density map of the whole system, reverse-engineered from the commit log rather
than recalled from prose.

| File | What it is |
|---|---|
| [`DENSITY-CHAIN.md`](DENSITY-CHAIN.md) | **ground truth.** Trunk + 13 subsystem-class branches + cross-link lattice + self-index + constellation |
| [`DENSITY-CHAIN.html`](DENSITY-CHAIN.html) | the interactive, theme-aware render. Kept in sync; markdown wins on drift |
| [`index.json`](index.json) | machine index: the branch roster and the connected-repository constellation. **No verification state** — schema 3 removed the last stored pin |

## What a density-trellis is

**Chain of density** (Adams et al. 2023, [arXiv:2309.04269](https://arxiv.org/abs/2309.04269)) rewrites
one summary five times *at a fixed length*, fusing new entities in by compressing what is already
there. Fixed length is the engine — drop it and "add detail" just produces a longer summary.

A **density-trellis is the second tier of that format: several density-chains stacked together.** One
shared trunk, one five-tier chain per subsystem class, and a lattice of cross-links so the branches
interlock rather than standing in parallel columns. A single spine can only carry one salience order;
a system has many at once.

Two siblings, deliberately different shapes:

- [`docs/ORIENTATION.md`](../ORIENTATION.md) — the **single spine**: one system, summarized at a
  growing budget. Read it first if you want depth-on-demand about Trellis as one thing.
- `DENSITY-CHAIN.md` — the **trellis**: read the trunk, then jump to the branch that owns your
  subsystem. Read it if you want to know what one class ships, what it does not, and what it owes.

Neither outranks the other, and neither outranks anything it summarizes. Both sit at the *orientation
compression* rung of [`AGENTS.md`](../../AGENTS.md) §1.5 (Authority ordering) — below every ratified
record, adopted doctrine, and design record.

## How to read it

1. **Trunk first.** T0 (a sentence), T1 (a paragraph), T2 (the class map). Under 500 words.
2. **Then one branch.** Each is complete at every tier: T1 is true on its own terms, and deeper tiers
   *add* rather than *correct* (the layer test). Stop at the first tier that answers you.
3. **Watch the status labels.** `shipped-pinned` ≠ `implemented, not accepted` ≠ `ratified as
   principle (no build)` ≠ `proposed` ≠ `rolled back`. Blurring them is the failure this house keeps
   paying for.
4. **Read the reachability lines.** Hard rule 15 — *correct is not the same claim as reachable*. Every
   branch names what has no non-test caller. Those are findings, not accusations.
5. **Every number is as recorded, never re-run.** A scripted zero-paid harness's counters belong to the
   script's author, not to any model.

## The living-wiki loop

The map is maintained by machine-detected staleness, not by anyone remembering to update it.

```bash
npm run wiki:check
```

[`tools/density-chain/wiki_check.mjs`](../../tools/density-chain/wiki_check.mjs) diffs each branch
class against **its own** `verified_at` pin in [`index.json`](index.json), routes the changed paths
through the **Declares** column of the map's self-index, and prints only the branches actually
implicated.

| Invocation | Effect |
|---|---|
| `npm run wiki:check -- --verify` | **the CI half.** Every visible path routes; every class declares something; every declared glob matches something; the roster agrees three ways; no residue rule shadows a declaration. Exit **0** pass, **1** fail |
| `npm run wiki:check` | **the session half.** Per-class staleness. Exit **0** current, **1** stale, **2** error |
| `npm run wiki:check -- --explain <path>` | which classes a path routes to, via which glob, and whether by declaration, heuristic or fallback |
| `npm run wiki:check -- --emit-class-map` | the derived routing table, for review — never committed |
| `npm run wiki:check -- --print-sections` | each branch section's line range and normalized hash |
| `npm run wiki:check -- --json` / `-- --list-classes` | the report as JSON / the roster |
| `npm run wiki:check -- --negative-control` | the falsifier. Plants **eighteen** conditions the gate must detect; **healthy is exit 3**, matching [`check:repo-surface`](../../tools/repository-surface/cli.ts) and the judge drills |

**The split is deliberate.** `--verify` runs in CI because its invariants hold at any history
depth — and CI checks out shallow, so the staleness diff would silently see nothing there. Staleness
itself is *not* a build failure: an in-progress branch is legitimately stale, and a gate that reddens
every honest PR gets switched off. So CI enforces the contract; the session reports the drift.

A `Stop` hook in [`.claude/settings.json`](../../.claude/settings.json) runs the checker in `--hook`
mode and raises the stale roster **once per session**. It fires on `Stop` rather than on `Write|Edit`
on purpose: a tool matcher's reach stops short of "the repository changed" — files also move through
Bash, scripts and merges — while a `git`-based check at end of turn sees all of it.

### Where the routing comes from

**Nowhere authored.** The `Declares` column of the self-index table inside
[`DENSITY-CHAIN.md`](DENSITY-CHAIN.md) states, per branch, the paths that branch covers, and the
checker parses that table at run time. There is no committed routing table, so the map and the router
cannot disagree — the divergence is *unrepresentable*, not merely detected.

It was detected once, which is why this changed: the self-index said C8 owned `src/config/index.ts`
while an authored `class-map.json` routed it to C11 — under a sentence claiming the two were the same
data. That is precisely the drift the self-describing-surfaces record cites as its worked failure
(prose says "Wizard only", a separate conditional does the gating), reproduced inside the artifact
that cites it.

Two branches may declare the same path and both go stale — the router unions rather than picking,
because the map already answered. What the map deliberately does *not* describe lives in
[`routing-residue.json`](../../tools/density-chain/routing-residue.json): churn no branch owns, the
script-naming heuristics no branch should enumerate, and the broad fallbacks. Every entry owes a
`why`, and `--verify` refuses any that shadows a declaration.

### What counts as a branch being current

**Nothing is stored.** A branch is current when **the last commit that changed its section is at or
after the last commit that changed any code it covers** — both derived from git, per class. There is
no pin, no stamp, and no write mode.

An earlier edition *did* store a per-class `verified_at` commit, and storing it was the mistake. A pin
is a claim about a commit that a squash merge or a rebase can erase, and this repository squashes
(hard rule 12: one branch, one PR). When the pin evaporated the class failed stale — correct — and the
only remedy, a re-stamp, was refused because the section was unedited — also correct. Two right
answers composed into a permanent deadlock, demonstrated before it shipped. Deriving from git removes
the pin, the write mode, the hollow-stamp problem, and the deadlock in one move.

Order of satisfaction, and what each rules out:

1. **An orphaned section** — the class has no `#### Cn` heading. Stale, and `--verify` fails.
2. **An uncommitted edit of that branch's own section** — current. You are doing the work now, and a
   session that edits code and its branch together is the ideal case, not a conflict. *Not* a sibling
   section (rewriting the trunk satisfies nothing) and *not* a sibling file.
3. **Uncommitted changes to code the branch covers** — stale, with the paths named.
4. **The committed comparison.** A commit is its own ancestor, so a section committed *alongside* the
   code it describes is current permanently — which is exactly the habit worth rewarding.

Two things deliberately do not count as edits: a **whitespace reflow** (section hashes collapse
whitespace first — not cosmetic, since `core.autocrlf=true` means the working tree holds CRLF while
`git show` returns LF, and a raw byte hash would read "edited" forever and report permanently fresh);
and **an unmapped path merely being printed** — a brand-new top-level subsystem is the change most
likely to need a whole new *branch*, so it makes the map stale rather than appearing in a list nobody
reads.

Two windows are unknowable rather than stale, and are reported without gating: a **shallow clone**, and
a repository where the map is **not yet committed**. An unknown window must not block.

### Updating the map when it goes stale

**One updating sub-agent per touched class.** This is the house rule, not a preference. Siblings cannot
see each other, so a per-class agent cannot smear one subsystem's status onto another's; and the
cross-cutting composition — trunk, cross-section, lattice — belongs to whoever assembles their returns,
after they come back. Give each agent the same verbatim ground block and a rigid return frame, and
forbid it to read the branch it is replacing, so the derivation stays independent.

Then:

1. **Densify, never append.** New machinery enters a branch's **T4** first, as one entity, and rises
   toward T1 only as the *concept* of the subsystem changes. At a fixed per-tier budget, adding means
   compressing or evicting something less salient — and that shows up in the diff.
2. **Hold the layer test.** Each tier, read alone, must still be true.
3. **Re-render the HTML.** Nothing in `index.json` is stamped — schema 3 stores no verification state, and the section edit *is* the update (see "What counts as a branch being current"). Add a roster line only when the branch is new.
4. **Keep volatile counts out.** This file names mechanisms and points at authorities. Anything that
   drifts with the week belongs in observed evidence, not in a map.

Prompt bytes for those agents are authored under `prompt-engineering` and `hypershot-protocol` first —
[`AGENTS.md`](../../AGENTS.md) hard rule 16, no exceptions, checked before the bytes are written.

## Open items (raised by review, not yet closed)

Four review agents attacked this loop before it shipped. What they found and this session fixed is
recorded in the map's [Provenance & method](DENSITY-CHAIN.md#provenance--method). What they found and
this session **did not** fix, in the order it should be decided:

**Closed since the first edition** — kept here because the reasons are the useful part:

- ~~One global `snapshot_commit`~~ → then per-class stored pins → **now nothing stored at all.** The
  global pin degraded toward "all 13 stale"; per-class pins fixed that and introduced a deadlock
  (squash merge erases the pin → fail-stale → re-stamp refused because the section is unedited);
  deriving both halves from git dissolves the whole class of problem.
- ~~Merge conflicts multiply by thirteen~~ → nothing writes `index.json` during maintenance, so there
  is nothing to conflict.
- ~~`--stamp` makes the checker impure~~ → there is no `--stamp`. The checker reads and reports.
- ~~The roster is a frozen instance (rule 17)~~ → derived from the `#### C{n}` headings. Adding a
  branch is now writing a branch; no JSON declares the taxonomy. One authored mirror remains in
  `index.json`, pinned equal — see below.
- ~~Should this fold into `repository-surface`?~~ → **No, decided.** The two prove different
  propositions, and the deciding fact is mechanical: this checker is zero-dependency ESM so it can run
  from a hook before any install, while `check:repo-surface` needs `tsx` and `zod`. Folding would
  either delete the hook or ship a second no-build entrypoint — which is this tool under another name.
  What was worth taking from it *was* taken: the injection seam that lets the falsifier exercise the
  shipped predicate rather than a copy.

**Still open:**

1. **`index.json.branches` is an authored mirror of the roster** (`id`, `title`, `tier` — the mutable
   pin fields are gone). `--verify` holds it identical to the map's headings, so it cannot drift, but
   adding C14 still means writing a branch *and* adding one line here.
2. **`routing-residue.json` is authored hand-wiring**, reduced by roughly 70%, not eliminated. It is
   where future ad-hoc rules will try to hide; the `why` requirement and the shadow check are the only
   things holding that.
3. **Derivation is inverted relative to the record's principle.** `SELF_DESCRIBING_SURFACES.md` says an
   account must be derived from *the guard that enforces behaviour*. Here the mechanism is derived from
   the account, because the routing table enforces nothing — it selects which prose to re-check, and
   the authoritative source for "which branch covers this path" is editorial. Same principle (one
   encoding, owned by whoever is authoritative for the fact), different kind of fact. The record
   anticipated only the first kind; a dated addendum drawing that distinction is owed.
4. **No mechanism can catch mis-attribution.** `--verify` catches a declaration naming code that does
   not exist. It cannot catch a declaration that is *wrong about which branch should own* an existing
   path. That is editorial and needs a human or a composed judge. The cheapest available strengthening:
   cross-check the paths a branch mentions in its own prose against what it declares.
5. **The hook's payload is prose instructions**, which hard rule 8 reserves for tooling shape. The
   detection is enforced; "spawn one sub-agent per stale class" is a sentence. Deliberate — it is the
   part a checker cannot do — and it says so in its own text.
6. **Staleness is reported, never enforced.** By design; only `--verify` fails a build.
7. **`git log -L` costs a history walk.** One full-history pass to attribute commits to classes (183 ms
   measured over 157 first-parent commits) plus one range query per class. Fine at this size; it grows
   with history, and nothing currently bounds it.

## Provenance

The current edition was derived at commit `2b937e8` by **fifteen parallel read-only sub-agents** —
thirteen class cartographers, one commit historian, one constellation indexer — each blind to the
previous edition and to each other. Method, honest gaps, and everything the run could not verify are
recorded in `DENSITY-CHAIN.md` under
[Provenance & method](DENSITY-CHAIN.md#provenance--method). The method itself lives canonically in
[OpenCnid/chain-of-density](https://github.com/OpenCnid/chain-of-density) and is packaged as the
`density-chain` skill — linked, never copied, so there is one home and no drift.

The system-mode idea has prior art in this constellation:
[MASH](https://github.com/OpenCnid/MASH/tree/main/docs/density-chain) carries its own trellis, and
MASH's self-documenting commands are the acknowledged seed of Trellis's own
[`SELF_DESCRIBING_SURFACES.md`](../architecture/SELF_DESCRIBING_SURFACES.md). This file is the build
criterion applied to itself: **the wiki is the density-trellis, and the repository maintains it.**
