---
name: density-chain
description: Write an OpenCnid five-tier chain-of-density note for a research paper, or scaffold a complete new paper repo around one. Use whenever the user asks to add, summarize, note, recognize, or "make a repo for" a research paper (arXiv, ACL Anthology, a lab blog post — any published research), mentions a density chain, CoD note, tier note, paper note, or the OpenCnid paper-repo collection — even if they never name this skill. Also use when updating, re-verifying, or extending existing OpenCnid paper repos, including batch runs across many paper repos at once.
---

# density-chain

Produce OpenCnid's house artifact: a five-tier chain-of-density note on a research
paper, verified against the source, living in a repo named after the paper.

## Why the rules are shaped this way

Three findings from the method's own paper (Adams et al. 2023, arXiv:2309.04269)
drive everything below, so keep them in mind rather than following steps blindly:

- **Fixed length is the engine.** Without a held word budget, "add detail" makes
  a summary longer, never denser. Every tier must be rewritten *at the same
  length*, not appended to.
- **The best tier is not the densest.** Human preference peaked mid-chain
  (median step 3), and annotators barely agreed with each other (Fleiss'
  κ = 0.112). That is why we ship all five tiers and let the reader pick —
  never just T5.
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
   exactly: pinned frontmatter, a declared tier word budget held constant,
   T1–T5, entity ledger with tier-introduced + locator per entity, a key
   results table of exact values, *our take* quarantined at the bottom, and a
   provenance section noting which rendering the locators follow.
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

## Non-negotiables

- Own words, always. At most one short attributed quote (<15 words) per note;
  never a figure, table, or passage; never commit a paper PDF.
- Exact numbers with locators, or nothing.
- Pin the source version and record the verification date.
- Authority runs paper → note → entry. Never backwards.

## Provenance of this skill

This is the user-level harness install. The canonical copy lives in the
chain-of-density repo at `.claude/skills/density-chain/SKILL.md`
(https://github.com/OpenCnid/chain-of-density) so cloners get it too. If the
methodology changes, update the repo copy first, then sync this one from it.
