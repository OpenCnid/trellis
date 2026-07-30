---
name: density-chain
description: Write an OpenCnid three-tier chain-of-density note for a research paper, or scaffold a complete new paper repo around one. Use whenever the user asks to add, summarize, note, recognize, or "make a repo for" a research paper (arXiv, ACL Anthology, a lab blog post — any published research), mentions a density chain, CoD note, tier note, paper note, or the OpenCnid paper-repo collection — even if they never name this skill. Also use when updating, re-verifying, or extending existing OpenCnid paper repos, including batch runs across many paper repos at once. Also runs in SYSTEM MODE — a chain-of-density map of a whole codebase or system rather than a paper — a branching "density-trellis" reverse-engineered from the project's commit history, written to docs/density-chain/DENSITY-CHAIN.md with an interactive HTML+SVG render. Use system mode when the user asks to map, summarize at increasing density, or make a density-chain / density-trellis of a project, engine, codebase, or its features and roadmap.
---

# density-chain

Produce OpenCnid's house artifact: a three-tier chain-of-density note on a research
paper, verified against the source, living in a repo named after the paper.

## Who reads a note

This skill prepares summaries optimized for human, AI, and agentic readers. The
last of those shapes most of the rules below, and it is the reader a later
session forgets, because the study the method comes from measured only humans.

An agent arrives with a context budget rather than an attention span. It
retrieves one tier instead of skimming the chain, and it treats the tier it
retrieved as complete — there is no glance upward to catch what went missing on
the way down. Three rules follow from that, and this is where they come from:

- **Every tier is true standing alone.** The layer test is not tidiness. A
  reader that stops at T1 acts on T1.
- **A dropped qualifier is a changed claim.** A person often recovers it from
  context. An agent carries it forward as fact.
- **A locator is the only handle a reader has on you.** An agent cannot glance
  at the figure and notice a number looks wrong; it can only follow the address.

## Why the rules are shaped this way

Four findings from the method's own paper (Adams et al. 2023, arXiv:2309.04269)
drive everything below, so keep them in mind rather than following steps blindly:

- **Fixed length is the engine, and it binds on both sides.** Without a held word
  budget, "add detail" makes a summary longer, never denser. Every tier is
  rewritten *at the same length* — inside ±5%, not appended to. A **floor**
  carries as much weight as a ceiling: a tier sitting under budget was never
  compressed, and compression is the mechanism. The last tier is never longer
  than the first.
- **The best tier is not the densest, and three is enough.** Human preference
  peaked mid-chain (median step 3, expected 3.06), and marginal density collapses
  right after it — step 4 buys under a quarter of what step 2 buys. That is why
  we ship **T1–T3** and let the reader pick, never just the densest. The paper ran
  five steps in order to *find* the peak; we already know where it is.
  (Annotators barely agreed, κ = 0.112. Draw nothing from that number in either
  direction — it is as consistent with the summaries being hard to tell apart as
  with taste differing. The tiers rest on something simpler: a reader arrives
  with a budget, and three densities serve three budgets.)
- **The paper never tested CoD against an ordinary prompt.** No annotator in that
  study saw a chain-of-density summary beside a vanilla-prompt summary — every
  comparison was between steps of one chain. Never write, or imply, that CoD
  summarizes better than plain summarization. That trial does not exist.
- **The collection is only ground truth because the source always wins.** Pin
  the exact version studied, record the verification date, and if note and paper
  ever disagree, fix the note. Authority runs paper → note → inspirations
  entry, one direction only.

## Study the framework first

Study these two documents before writing anything; they are the canonical spec
and this file is only the field guide:

1. `METHOD.md` — the rules that don't bend, plus the document template
   (frontmatter, tiers, entity ledger, key results, our take, provenance).
2. `chain-of-density-synthesis-prompt.md` — the full authoring framework:
   evidence-unit extraction, map/reduce for long papers, the audit rubric that
   selects candidates (never "densest wins").

Where to find them, in order of preference: the repo root if you are inside the
chain-of-density repo; the local clone at `D:\chain-of-density\`; or raw from
GitHub at
`https://raw.githubusercontent.com/OpenCnid/chain-of-density/main/METHOD.md`
(same pattern for the synthesis prompt).

## The pipeline

1. **Fetch and verify — never write from memory.** Research arrives in two
   shapes; the pipeline handles both:
   - **Papers** (arXiv, ACL Anthology, DOI journals): download the PDF into
     the session scratchpad and study it there, and/or pull the ar5iv/arXiv
     HTML rendering; check the abs page for license, version number, and
     date. Pin the exact version (vN). Locators: § section, Table N, Figure N.
   - **Lab articles** (Anthropic research pages and Transformer Circuits,
     OpenAI research/blog, DeepMind, and other labs' posts): study the
     article at its canonical URL. Articles have no vN, so the pin is the
     publication date plus the URL, with the access date recorded. Locators:
     section headings and figure names — articles have no page numbers.
   Either way, downloads are session study material — scratchpad only. A repo
   receives the *note* plus a one-command fetch (curl the arXiv PDF; for
   articles with no PDF, link the canonical URL — same principle, the source
   serves its own copy). Every number, author affiliation, and claim gets
   studied at the source in this session with a locator, and provenance
   records which rendering the locators follow. A quantity you "remember" is
   a quantity you don't write.
2. **Write the note as `density-chain.md`.** Follow METHOD.md's template
   exactly: pinned frontmatter, a declared tier word budget held inside ±5%,
   T1–T3, entity ledger with tier-introduced + locator per entity, a key
   results table of exact values, *our take* quarantined at the bottom, and a
   provenance section noting which rendering the locators follow.
   Then **count it, do not eyeball it** — `node tools/tier-budget.mjs
   density-chain.md` from the note's own repo (the script lives in
   chain-of-density; from another paper repo, run it by relative path). It
   holds every tier inside the declared band, refuses a tier that sits under
   the floor as well as one over the ceiling, and refuses a chain whose last
   tier is longer than its first. A budget nothing counts is a budget that
   drifts: this note's own tiers ran 142 to 161 words against a declared 150,
   densest tier longest, until a counter existed.
3. **Index it.** Add or update `index.json` (schema: see the chain-of-density
   repo's copy). Trellis consumes these; a note without an index entry is
   invisible to the staleness machinery.
4. **New paper? New repo, named after the paper's most searchable handle.**
   Kebab-case the method name, acronym, or title hook the community actually
   uses (`chain-of-density`, `lost-in-the-middle`, `pcf-adaptive-agents`). Be
   creative when the full title is unwieldy — an acronym plus a domain
   keyword often beats a truncated title — because full discoverability is
   recovered through the description and topics (step 6): the name catches
   the eye, the metadata catches the search. Scaffold: `density-chain.md`,
   `index.json`, `README.md`, `AGENTS.md` (how agents consume and maintain the
   note — mirror the canonical one in chain-of-density), `LICENSE.md` (CC BY
   4.0 for prose), and a *link* to chain-of-density for METHOD.md and the
   synthesis prompt — never a copy (one canonical home, no drift).
5. **README in house style.** Load the `prompt-engineering` and
   `hypershot-protocol` skills first — README furniture and templates prime
   future generation, and they should be authored under those protocols. Use
   the chain-of-density repo's README as the living template. The required furniture: a theme-neutral animated SVG banner
   (mid-tone palette #58a6ff→#9b8cf7→#ef6fd0, mono type), shields badges
   including joke badges that state real guarantees, the one-way-rule alert, a
   "standing on the shoulders of giants" section naming the authors with
   affiliations *as printed on the paper*, a "want the PDF? one command,
   straight from the source" section (curl from arXiv — we never host papers),
   a "cite the humans, not us" section carrying the official BibTeX — fetch
   it from the ACL Anthology `.bib` endpoint, arXiv's `/bibtex/<id>` export,
   or the article's own "cite this" block; when a lab article offers none,
   build an `@misc` entry from metadata verified on the page (title, authors,
   publisher, URL, dates) — verified fields, never memory — honest notes
   including the human+AI co-authorship disclosure,
   references, and a footer joke. Voice: high-level, fun, educational; wry
   parentheticals, no marketing.
6. **Make it findable: description and topics.** The repo description
   carries the search terms the name can't — full paper title, first author,
   year, and the arXiv ID or source lab. Then add topics with
   `gh repo edit --add-topic`: the method name and acronym, three to six
   domain keywords, the source tag (`arxiv`, or the lab's name for articles),
   plus the house tags `research-notes` and `chain-of-density`. Topics are
   GitHub's search index — this is where the SEO lives, which is what frees
   the repo name to be memorable.
7. **Humor placement.** READMEs and *our take* only. The tiers, the key
   results, and the provenance stay bone-dry — they are the ground truth, and
   jokes in ground truth age like milk.
8. **Inspirations entry — only with a receipt.** If the paper demonstrably
   shaped OpenCnid work (a commit, design doc, or shipped feature you can
   link), add an entry to
   [llm-research-inspirations](https://github.com/OpenCnid/llm-research-inspirations)
   in its entry-format frame. No receipt, no entry — admiration is free;
   entries are earned.

## Batch mode: bringing existing paper repos up to standard

When the user provides a set of repos to run this skill across, work them **one
repo at a time to completion** — verify, write, audit, commit — rather than
half-finishing several; a partially noted repo is worse than an unnoted one
because it looks done.

For each repo:

1. **Find the paper.** Read the repo's README.md and locate the source link
   (arXiv, ACL Anthology, DOI, lab blog). Pin the version it points at.
2. **Run the pipeline above** — scratchpad download, locator verification,
   `density-chain.md`, `index.json`, `AGENTS.md` if the repo lacks one.
3. **Bring the README to house style while preserving the owner's writing.**
   Restructure, don't delete: fold existing prose into the house sections
   (giants, PDF one-liner, cite-the-humans, honest notes). The owner's voice
   and any content they wrote survives the makeover.
4. **Commit per repo** with a descriptive message; push when the user has
   asked for the repos to be updated on GitHub.

Pause and surface instead of guessing when: a README has no findable paper
link (ask which paper the repo studies), or a repo already contains a committed
paper PDF (report it and suggest replacing it with the one-command fetch
section — removing someone's committed file is the owner's call, not the
skill's).

## System mode: an in-repo density-trellis of a whole codebase

The subject is sometimes not a paper but a **whole system** — a codebase, an
engine, a project's features and roadmap. Same method, different shape and home.

**Shape — a trellis, not a spine.** A paper note is one spine (T1–T3). A system
is a **branching lattice**: a shared *trunk* (the whole system summarized at
increasing density — T0 sentence, T1 paragraph, T2 class map) plus one *branch
per subsystem class*. Each branch is its own fixed-length five-tier chain of
density whose densification traverses time by salience:

    T1 {General_Essence} · T2–T3 {Current_Shipped_Machinery} · T4–T5 {Frontier_And_Future_Plans}

**Why system mode keeps five where paper mode ships three.** They are not the
same object. A branch's tiers partition *time-depth*; they are not five rewrites
of one content at rising density, so T5 is a different subject from T4 rather
than a denser account of it. The three-tier rule follows the paper's preference
peak over a nested chain, and a partition is not a nested chain — so that rule
does not reach here, and neither do the paper's density statistics. Say which
kind of ladder an artifact carries; the two are easy to conflate and the claims
that ride on them are different.

Seed the classes from what the user names; branch out and add classes as
coverage demands. Compose the trunk, a general→current→future cross-section
table, and a cross-link lattice yourself, after the branches exist.

**Source of truth is the repo — reverse-engineer it, never write from memory.**
The commit log *is* the paper: `git log` reconstructs the true build order;
design records and source are the locators. This is the system-mode form of "the
source always wins." Status labels are load-bearing and must be *verified*, not
assumed, against the **six** the map declares: `shipped-pinned` (committed code +
a passing drill) ≠ `implemented, not accepted` ≠ `adopted / ratified-as-principle
(no build)` ≠ `proposed / design-record` ≠ `recorded-research` ≠ `rolled back /
retired`. That set is stated in three places — here, the map's own reading
contract, and the folder README — and all three carry the same members; a
taxonomy enumerated two ways is one nobody can check against. A capability you
cannot locate in the repo is one you do not write.

**Scale by fan-out (optional).** For a large system, spawn one read-only
sub-agent per class against a shared, *verbatim* ground block and a rigid return
frame (five tiers + entity ledger with locators + commit receipts + cross-links +
an explicit "uncovered" slot); compose the cross-cutting trunk and lattice
yourself, since siblings cannot see each other. Author every sub-agent prompt
under the `prompt-engineering`, `hypershot-protocol`, and `subagent-composition`
skills (Guardrail 15).

**Output — a file pair in `docs/density-chain/`:**

1. `docs/density-chain/DENSITY-CHAIN.md` — the trellis in markdown (**ground
   truth**): a dated status header (PROPOSED, subordinate to code > glossary >
   prose), the trunk, the branches (each: charter, T1–T5, a compact status
   ledger, cross-links), the temporal cross-section, the cross-link lattice, and
   a provenance/method section with an honest ledger of what could not be
   verified.
2. `docs/density-chain/DENSITY-CHAIN.html` — a self-contained, theme-aware
   interactive render (**the map**), carrying the same banner furniture as a
   paper README: a **theme-neutral animated SVG banner** (mid-tone palette
   #58a6ff→#9b8cf7→#ef6fd0, mono type), the five-tier **density ramp** as its
   colour gradient, and click-to-expand tiers. Keep it in sync with the markdown;
   the markdown wins on disagreement. Author its furniture under
   `prompt-engineering` + `hypershot-protocol`, as with any README.
3. `docs/density-chain/README.md` — a one-screen explainer of the folder and its
   conventions, if the folder does not already have one.

The folder is the scalable home: one `<NAME>.md` / `<NAME>.html` pair per system,
the whole engine being `DENSITY-CHAIN`. Everything in "Why the rules are shaped
this way" and "Non-negotiables" still binds — fixed length per tier, own words,
exact locators, and the source (here the repo) always wins. Tier *count* is the
one thing that does not carry across: a paper note ships three, a system branch
five, for the reason given above.

## Non-negotiables

- Own words, always. At most one short attributed quote (<15 words) per note;
  never a figure, table, or passage; never commit a paper PDF.
- Exact numbers with locators, or nothing.
- Pin the source version and record the verification date.
- Authority runs paper → note → entry. Never backwards.
