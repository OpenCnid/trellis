# The OpenCnid Research-Notes Collection — Pointer and Ingestion Record

**Status: living pointer record; ingestion contract PROPOSED.**
July 18, 2026. Docs only — nothing in this file authorizes
implementation. Any consumer of the collection is its own bounded
feature under the DDD rule (root `AGENTS.md` rule 15: no implementation
without a separately authorized bounded feature naming its non-test
entrypoint).

This file exists so future sessions do not rediscover the collection by
accident. It is the single in-repo home for: what the collection is,
which repos exist, how they are meant to be consumed, and the safety
bounds on consuming them.

## 1. What the collection is

OpenCnid maintains a research-notes collection on GitHub: **one
repository per studied paper**, each named after the paper's most
searchable handle, each carrying:

- `density-chain.md` — a five-tier chain-of-density note: five rewrites
  at a fixed word budget, each tier folding in more salient entities,
  **every claim carrying a locator** back into the source (§ section,
  Table N, Figure N), exact numbers only, source version pinned,
  verification date recorded. Commentary is quarantined in a marked
  *our take* section; tiers, key results, and provenance are bone-dry.
- `index.json` — the machine face: schema_version, pinned version and
  date, `verified_against_source`, tags, note path.
- `README.md` / `AGENTS.md` / `LICENSE.md` — human and agent front
  doors. **No repo hosts a paper PDF**; each provides a one-command
  fetch from the paper's own source instead.

Two repos anchor the collection itself:

- [`chain-of-density`](https://github.com/OpenCnid/chain-of-density) —
  the canonical methodology home: `METHOD.md`, the synthesis prompt,
  and the runnable `density-chain` authoring skill. Every note repo
  links here; the methodology is never copied outward (one canonical
  home, no drift). This is the same method `docs/ORIENTATION.md`
  adapts for Trellis's own orientation ladder.
- [`llm-research-inspirations`](https://github.com/OpenCnid/llm-research-inspirations)
  — the recognition hub: a receipts-required map from papers to the
  OpenCnid work they shaped, including a "How the shelf maps onto
  Trellis" section that mirrors this repo's architecture from the
  outside, with influence-kind labels (caused / adopted as guide /
  validated / avenue). Entries are **interpretations by design** and
  are never evidence about a paper (see §3).

## 2. Inventory (as of July 18, 2026)

| repo | paper | pin | standing in Trellis |
|---|---|---|---|
| [`recursive-language-models`](https://github.com/OpenCnid/recursive-language-models) | Zhang, Kraska & Khattab, *Recursive Language Models* (MIT CSAIL) | arXiv:2512.24601**v3** (2026-05-11) | the formulation Trellis implements — root of `docs/architecture/ARCHITECTURE.md`, the "RLM depth" half of the HANDOFF purpose statement; no register S-row (architecture base, not program evidence) |
| [`who-grades-the-grader`](https://github.com/OpenCnid/who-grades-the-grader) | Zhang et al., *Who Grades the Grader?* | arXiv:2607.12790**v1** | register **S1**; reconstruction substrate for `COMPOSABLE_RUBRICS_DESIGN.md` |
| [`better-harnesses-smaller-models`](https://github.com/OpenCnid/better-harnesses-smaller-models) | Yang, Zhao, Wu & Kästner, *Better Harnesses, Smaller Models* (CMU) | arXiv:2607.08938**v1** | register **S9**; owner-adopted purpose-level guide (R-25) |
| [`global-workspace-in-llms`](https://github.com/OpenCnid/global-workspace-in-llms) | Gurnee et al., *Verbalizable Representations Form a Global Workspace in Language Models* (Anthropic) | Transformer Circuits, published 2026-07-06 (articles carry no vN; pin = date + URL) | register **S8** (R-20/R-21/R-23/R-24) |
| [`emotion-concepts-in-llms`](https://github.com/OpenCnid/emotion-concepts-in-llms) | Sofroniew et al., *Emotion Concepts and their Function in a Large Language Model* (Anthropic) | Transformer Circuits 2026-04-02; arXiv:2604.07729**v1** | register **S12**; evidence anchor of `RESIDUAL_STREAM_SIDECAR.md` |
| [`pcf-adaptive-agents`](https://github.com/OpenCnid/pcf-adaptive-agents) | Pearl, Murphy & Intriligator, *Polymorphic Combinatorial Frameworks* | arXiv:2508.01581**v1** | register **S11** (coverage-verified there; the note repo does not change register standing — see §3) |
| [`chain-of-density`](https://github.com/OpenCnid/chain-of-density) | Adams et al., *From Sparse to Dense* (NewSum 2023) | arXiv:2309.04269**v1** | the note-format method itself; adapted by `docs/ORIENTATION.md` |

Retired, for the record: the July-16 PDF mirrors
(`who-grades-the-grader-pdf`, `better-harnesses-smaller-models-pdf`,
`verbalizable-global-workspace-pdf`) were renamed and de-PDF'd by owner
ruling July 18, 2026; historical bytes remain in git history under the
recorded SHA-256 hashes (dated amendments: HANDOFF Session-65 block,
RESEARCH_MAP S1/S8/S9 + sharing-queue rows 1/8/9, PROGRAM_CONTEXT
network-reality bullet). The `verbalizable-global-workspace` signpost is
slated for deletion; `global-workspace-in-llms` is that paper's one
home.

## 3. Authority ordering (safety — read before consuming)

```
paper (canonical)  →  density-chain note (lab working ground truth)  →  inspirations entry (interpretation)
```

- **The paper always wins.** When a note and its paper disagree, the
  note is defective and gets fixed — never the reverse.
- **Notes are secondary sources for Trellis.** The register
  (`docs/product/epistemic-support/RESEARCH_MAP.md`) is a parallel
  consumer, not a downstream one: register rows record
  *primary-verified* reads with evidence classes and falsifiers. A
  note never substitutes for primary verification, never upgrades an
  evidence class, and never satisfies a "read the primary" obligation.
  Notes are the fast orientation layer — load a tier, then verify at
  the source before anything load-bearing.
- **Inspirations entries are never evidence.** They are claims about
  *OpenCnid's work*, receipts-linked, explicitly labeled by influence
  kind. Authority runs one direction; an entry can't cite itself into
  being true.
- **Promotion is a ceremony.** Nothing from the collection is citable
  as `sourceNodeIds` in Trellis without operator promotion (AB-10).
  Ingested notes enter unpromoted, under ordinary custody rules.

### 3.1 Consultation and repair (RATIFIED July 19, 2026 — collaborator proposal, owner approved)

The ordering above says which source wins. This says **when to go to
which, and what you owe afterwards**:

- **For work: the density-chain note is adequate.** Orient from the
  note, build from the note. Do not re-read a paper to do ordinary work
  against it.
- **For disputes: go to the full paper.** Any disagreement about what a
  source says — between people, between records, or between a record and
  a session's reading — resolves at the primary, never by arguing over
  distillations.
- **When a note fails, repair it.** Once the dispute is settled against
  the source, the re-discovered truth is written back **into the note,
  in the appropriate place** — the tier that should have carried it.
  This is the closing step, not an optional follow-up: a validated
  correction that isn't written back guarantees the same failure recurs
  at the same place. Same shape as the substrate's own loop — the note
  is a derived belief, the paper is ground truth, and a contested
  derivation is re-derived against source and rewritten.

**Motivating case (July 19, 2026).** A session reasoning about the S12
emotions paper worked from a record's §2 distillation and from ad-hoc
web extraction, and never opened the collection's own five-tier note on
that exact paper. Two errors followed: a cross-vector regularity
(r = 0.85, which vectors steer effectively) was cited as if it were the
behavioral dose-response, and a narrow query ("is calm *suppression*
tested?") returning no was read as covering calm *induction*, which the
paper does test as an antidote (§3.3.2). Both were caught by a
collaborator reading the source. The note was never at fault — **it was
never consulted.** The workflow above only pays if the note is the first
stop; going around it to a search engine forfeits the whole layer.
Corollary worth carrying: **absence claims need wider queries than
presence claims.**

## 4. The machine face (how consumption is designed to work)

- **Parse `index.json`, don't scrape markdown.** Every note repo
  carries one at the root; it holds the pin (`pinned_version`,
  `pinned_date`), `verified_against_source`, tags, and the note path.
- **The unit of ingestion is `density-chain.md`** — never a paper PDF.
  The collection hosts none; papers are fetched on demand from their
  sources (each repo's README carries the one-command fetch). In
  proxy-blocked environments where only github.com resolves
  (PROGRAM_CONTEXT, "network reality"), the notes are reachable when
  the papers are not — which is precisely when their locator discipline
  matters most.
- **Tier economics.** All five tiers share one fixed word budget:
  loading T1 costs the same context as T5. Select by need — T1 for
  orientation, T5 for dense work, the key-results table for exact
  values with locators. A whole note is bounded (~5 × ~150 words +
  tables), so worst-case ingestion cost is O(repos), never O(paper).
- **Discovery.** Note repos are enumerable without a hardcoded list:
  GitHub org `OpenCnid`, topics `research-notes` + `chain-of-density`.
  The inventory table above is the July-18 snapshot; the topic query is
  the living index.

## 5. Ingestion + staleness contract (PROPOSED — design only)

**Status: PROPOSED July 18, 2026.** Nothing below is built, and this
record does not authorize building it. It exists so a future bounded
feature starts from a stated contract instead of re-deriving one.

1. **Doc key convention.** A note ingests under
   `web:https://github.com/OpenCnid/<repo>/blob/main/density-chain.md`
   (github.com is the reliably reachable host). The paper itself, if
   ever ingested, keeps its own key (`web:https://arxiv.org/abs/…` or
   the canonical article URL) — note and paper are distinct sources
   and must never share a key.
2. **Ingestion.** Extract the note text (tiers + key results +
   provenance; *our take* is loadable but is commentary and must
   inherit that standing), `POST /ingest` under the doc key, enter
   unpromoted. Promotion to citable standing is an operator act
   (AB-10). Never ingest a PDF from these repos: HEAD contains none by
   ruling, and history-only bytes are provenance artifacts, not
   sources.
3. **Staleness sweep** (the "Trellis owns freshness" half the
   collection's own docs promise). For each repo: read `index.json`,
   compare `pinned_version` against the live source — the arXiv
   version list for papers; for versionless web articles, the age of
   `verified_against_source` (threshold: operator-set, default 90
   days). **Output is flags, never edits**: a stale pin is reported
   for a human/agent session to re-verify at the source and update the
   note repo. The sweep never rewrites a note, a register row, or a
   belief.
4. **Safety and budget bounds.** The sweep is read-only and
   zero-model — metadata comparison only; any re-verification that
   costs money or model calls is a separately authorized act. Network
   cost is O(repos) (one `index.json` + one version-list fetch each;
   8 repos today). Failures fail closed: an unreachable source is
   reported as UNVERIFIABLE, never marked fresh.
5. **Reserved entrypoint (unbuilt).** `npm run notes:staleness -- check`.
   Acceptance sketch for whoever builds it: against a fixture set, the
   sweep flags exactly the repos whose pin differs from the live
   version (or whose article verification has aged past threshold),
   flags UNVERIFIABLE on fetch failure, and touches nothing.

## 6. Where Trellis already points (cross-reference map)

- `HANDOFF.md` Session-65 block; `RESEARCH_MAP.md` S1/S8/S9/S11/S12 and
  sharing-queue rows 1/8/9; `PROGRAM_CONTEXT.md` network-reality bullet
  — all carry dated July-18 amendments naming the note repos.
- `docs/GLOSSARY.md` ("RLM") and
  `docs/architecture/TEST_TIME_TRAINING.md` (references row 1) — point
  at `recursive-language-models`.
- `docs/ORIENTATION.md` — names the method's canonical home.
- `docs/architecture/RESIDUAL_STREAM_SIDECAR.md` §2 — points at
  `emotion-concepts-in-llms`.
- The reverse map — what each paper changed *in Trellis*, with receipts
  — lives in
  [`llm-research-inspirations`](https://github.com/OpenCnid/llm-research-inspirations),
  deliberately outside this repo: influence claims are interpretations,
  and the register stays the authority on evidence.
