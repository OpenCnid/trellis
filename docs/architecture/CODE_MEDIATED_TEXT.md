# Code-Mediated Text — Design Record (Core Pillar)

*Status: DOCTRINE — ratified July 9, 2026 by the owner with the external
collaborator, from the line-editing design exchange recorded in the roadmap
§5 entry of the same date. Sibling of
[WORKSPACE_AND_MODULES.md](WORKSPACE_AND_MODULES.md) (authority: code >
glossary > prose). This record is document-driven: it leads, and the
implementation sessions it names in §6 follow it. Every future session
should treat this as a core pillar on par with the provenance invariant.*

---

## 0. The pillar

> **The model never counts, and the model never copies.**

Expanded:

1. **Never counts** — a location in text is *computed by the engine and
   returned by a query* (a row index, a hash, a segment id), never estimated
   by the model's attention over a line-numbered dump. Never make the model
   do arithmetic the environment can do.
2. **Never copies** — existing bytes are *moved by code* (slice, splice,
   join, filter over structures), never re-typed through the model's
   attention. The model's only legitimate text outputs are (a) genuinely
   NEW text it is authoring and (b) the CODE that manipulates everything
   else.

The owner's ratifying formulation, verbatim in substance: **"Ingestion =
pandas. Edits = pandas. No direct edits. Only code edits. Rigidly."**
"Pandas" here is the recommended concrete structure (pandas 2.2.3 is already
importable in the agent environment, transitively via `unstructured`);
compliance is defined by the properties — queryable, engine-addressed,
code-manipulated — not by the library. A plain list-of-lines with computed
indices complies; a hand-retyped paragraph does not.

**The payoff — a giant effective context window.** When text lives in
queryable REPL state and the model operates on it through code, the model's
attention holds only *queries, handles, and bounded previews*; the corpus
itself is bounded by process memory, not by the attention window. Effective
working-set size decouples from model context size. This is the Recursive
Language Model thesis taken seriously and applied rigidly: context is a
database, not a scroll.

## 1. Origin — the tipping point

Three findings converged on July 9, 2026:

1. **The provenance-citation eval**
   ([PROVENANCE_CITATION_AB_REPORT.md](../benchmarks/PROVENANCE_CITATION_AB_REPORT.md))
   showed that citation laundering is a *transcription-channel* failure: the
   model repeating addresses back through its attention, where incentives
   can corrupt them. The measured fix was structural (remove the channel),
   not behavioral (ask nicely).
2. **The collaborator's line-editing diagnosis**: the real cause of edit
   thrash in coding agents is *localization failure* — the model
   estimating positions (line numbers, near-exact anchor strings) and
   miscounting, then burning turns on re-lookup loops. Models compensate by
   rewriting ever-larger chunks, which is transcription again: bytes the
   model was merely *moving* pass through attention and can be corrupted
   silently.
3. **The REPL reframe**: the industry's anchored-`str_replace` meta exists
   because tool-call harnesses cannot run code, so the tool contract must do
   the anchoring. Trellis is REPL-native — the model CAN always delegate
   localization and byte movement to the engine. What other harnesses
   approximate with tool design, Trellis can do exactly.

Localization error and transcription error are the same pathology —
**attention doing a job that belongs to code** — and both die under one
principle. That is what makes this a pillar rather than a technique.

## 2. The discipline (normative)

For every RLM interaction with text — research runs, editing, authoring:

1. **Text enters as a structure.** Loaded text (files, `get_ast_texts`
   results, workspace segments, corpora) is parsed into queryable REPL
   state — a DataFrame of lines/blocks, a dict of hash→text, a list with
   indices — not pasted into scrollback for the model to "read whole."
2. **Reads are queries.** The model filters (`str.contains`, comprehensions,
   hash lookup) and pulls *bounded* results. The workspace stub/`segment(id)`
   pattern is the canonical shape: index first, deliberate pulls second.
3. **Handles are transient.** A computed address (row index, match offset)
   is valid within the turn that computed it. Re-query rather than remember;
   never persist a positional handle across mutations (the T13 invariant,
   applied to working state).
4. **Edits are splices at computed addresses.** Locate by content query →
   engine returns the address → code splices the change. Never emit a
   full-document rewrite of text that already exists ("no direct edits").
5. **Frames are transient; the store is the truth.** Load → query → splice →
   write → discard, ideally within one turn. No long-lived in-memory mirror
   of a file or corpus that a second writer can silently invalidate.
6. **Writes are hash-guarded.** Capture a digest of the bytes at load;
   verify the store still matches before write-back; mismatch is a loud,
   retryable refusal — never a silent overwrite. (The verified-ingest
   read-back re-hash discipline, applied to editing.)
7. **Lines locate; blocks mean.** Line/row granularity is for surgical
   writes; AST-block granularity (the verified substrate: `vector_search`,
   `run_cypher`, `get_ast_texts`) is for understanding and provenance. They
   compose: semantic search finds the neighborhood, the line splice does the
   surgery.
8. **Enforcement posture** (eval lesson 7: prompts request, gates enforce):
   the discipline lands primarily as *tooling shape* — helpers that accept
   structured operations rather than blobs, hash guards that refuse stale
   writes, review diffs that expose wholesale rewrites — with prompt text as
   reinforcement, never as the sole barrier.

   **Audit and correction, July 19, 2026 (collaborator direction,
   owner-approved).** A review of the whole REPL construction found this
   clause violated in three places *inside the harness that states it* —
   each one a bound the kernel announced with nothing behind it:
   `UPSUM_BUDGET` injected as a bare int with the size check asked of the
   model in prose; raw `splice()` reachable with the guarded family merely
   "preferred" in the addendum; and task precedence taught as a rule with no
   surface that could rule on a candidate. All three are now surfaces —
   `trellis_upsum.commit` (measures and refuses),
   `TRELLIS_TEXTEDIT_GUARDED_ONLY` (removes the raw path), and
   `trellis_task.verify` (adjudicates by code) — recorded in
   RLM_HARNESS_SCAFFOLDING.md §8 and STRUCTURAL_SPLICE.md §9. Two of the
   three still inform rather than gate; the honest scope is in those
   sections and is not restated here.

   The lesson generalizes past the three instances, so it belongs in the
   pillar: **a documented bound with no engine behind it reads exactly like
   an enforced one** — in a bounds table, in a design record, and to a
   session that trusts the record. When this clause is applied, the test is
   not "does the prompt teach it" but "what refuses, and what does the
   refusal say." Anything else is a claim about behavior wearing a
   guarantee's clothes — the same shape rule 15 names for capabilities that
   are correct but unreachable.

   The design exchange that followed this correction generalized it into a
   standing direction — surfaces as meta-prompt primitives, accounts
   derived from the guard predicates that enforce them, and a bijection
   between stated expectations and enforcing guards as the check.
   Recorded in [HARNESS_SELF_MODEL.md](HARNESS_SELF_MODEL.md) (principle
   endorsed July 19, 2026; implementation NOT authorized).

## 2.9 The pillar applied to authority (dated extension — July 19, 2026, Session 71)

The pillar says the model never copies: existing bytes are moved by
code, never re-typed through the model's attention, because attention
is a corruption channel. **A paraphrase of a governing record is a
re-typing of it.** Same channel, different object — and where the
object is authority rather than content, the corruption does not
surface as a garbled quote. It surfaces as a confident, well-formed
decision that should never have been made.

**The rule: a derived representation never satisfies an obligation to
its source on a load-bearing act.** Derived artifacts are meant to be
used — that is what `HANDOFF.md`'s compression, a design record, a
skill, or a memory is *for*. The boundary is what the artifact is being
used **for**:

- **To do the work** — the derivation is adequate. Orient from it,
  build from it, do not re-read the source for ordinary work.
- **To decide what work to do, or to state what the record
  establishes** — retrieve the source. Quote it. A summary cannot carry
  a claim about its own faithfulness.

**The operational tell:** you cannot name the file and section you
actually retrieved *this session* for the decision you are about to
take or the claim you are about to make.

**Why it needs stating.** A lossy summary is indistinguishable from a
faithful one from the inside. It reads complete, it is self-consistent,
and it emits no ragged edge — so nothing prompts the retrieval that
would correct it. And in a documents-lead program the damage compounds:
a wrong read of a governing record produces an implementation that
faithfully encodes the wrong thing, plus tests written from the same
misreading that confirm it. **Green suite, wrong object.**

**Recorded instance.** Session 71 authored four judge rubrics, byte-
pinned them, ingested them extraction-free and registered them as a
standing roster, working from `HANDOFF.md` §3 and `RECONCILIATION.md`
§2 without retrieving `JUDGE_COMPOSITION_GAME.md`, whose ratified
rule 4 forbade the object being built. Every check passed — rubric
lines verbatim 12/12, anchors balanced across every closed class,
paid-job bound 0, registration verified consistent and uncontested,
drills green, $0 spent. The work was rolled back in review. *Whether
the object should exist is not a detectable property of the object.*
Full case: [`COMPOSITION_FROM_PRIMITIVES.md`](COMPOSITION_FROM_PRIMITIVES.md)
§5.

**This is a generalization, not a new rule.** The same rule is already
ratified for external research sources in
[`docs/RESEARCH_NOTES_COLLECTION.md`](../RESEARCH_NOTES_COLLECTION.md)
§3: *"Notes are the fast orientation layer — load a tier, then verify
at the source before anything load-bearing,"* and a note *"never
satisfies a 'read the primary' obligation."* That rule was scoped to
papers and their density-chain notes; the repository's own records have
the identical structure and were never covered. The authority ordering
for internal records lives in `AGENTS.md`.

## 3. Scope

| surface | application of the pillar |
|---|---|
| Governing records (§2.9) | a derivation never discharges an obligation to its source on a load-bearing act: retrieve and quote the source to decide, or to state what it establishes |
| RLM research runs | in-REPL handling of all retrieved text: structures + queries + bounded pulls; `llm_query` fans out over slices, the root context stays thin |
| Self-editing (code) | the §6.1 toolkit: content-query location, computed-address splice, hash-guarded write-back — the enablement session's edit primitive |
| Authoring | corpus text is pulled by segment query and moved by code; the draft's *new* prose is authored, corpus bytes are never re-typed (the harness already pins citations — attribution was made mechanical in Session 19) |
| The TS ingest pipeline | already compliant by construction and OUT OF SCOPE for change: parser-computed ASTs, content addresses, read-back re-hash — no model in the loop anywhere |
| Provenance rails, gates, orchestrator | unchanged; the orchestrator already routes by reference (counts-only observations) |

Scoping note (stated so nobody over-reads "ingestion = pandas"): the pillar
governs how the *RLM* handles text inside the REPL. The system's verified
ingest transaction is TypeScript, model-free, and already embodies the
pillar's properties; it is not being rewritten around a dataframe.

## 4. What was already built this way

The pillar was half-standing before it was named — which is evidence for it,
not redundancy:

- **Workspace capture** (Session 14): tool results deposited mechanically as
  origin-stamped segments; the model receives a stub and pulls content
  deliberately. Capture is harness-side — the model never transcribes a
  fetch.
- **Harness-pinned citations** (Session 19): the authoring manifest's
  `research.sourceNodeIds` are computed from promotion output; a draft
  containing any 64-hex token is refused. The pen stays with the harness.
- **By-reference orchestration** (Sessions 9/16): the planner sees counts
  and ids, never content; lineage is routed as task ids resolved by the
  worker.
- **Merkle-diff ingestion** (Sessions 2/8): change detection is computed
  from content hashes, never re-derived by a model.
- **The markdown-read fix** (July 9, 2026): `get_ast_texts` reconstructs
  block text from the stored tree in code (`_node_text`) rather than
  trusting a single stored field — reconstruction is code's job.

What was *missing* — and what this record now mandates — is the same rigor
at the two remaining attention chokepoints: the model re-typing text it is
moving, and the model estimating where text lives.

## 5. What this does NOT change

- The provenance invariant and every runtime data-trust rail (the Session 14
  write path, promotion, registration, the sweep) — untouched.
- The self-editing doctrine (§7 of the parent record, revised July 9, 2026):
  content pool + standard permissions. This pillar specifies *how* edits are
  made mechanically sound; §7 specifies *who may make them and how they
  land* (between runs, through source control, under review).
- The entailment finding: code-mediated moves make *byte fidelity*
  mechanical, but whether moved-or-cited bytes *support a claim* remains
  semantic — the sampled entailment tier (§7 v3) is still the only check for
  that. The pillar removes the transcription channel; it does not decide
  meaning.
- Module #1's committed artifacts (the historical record). Note: its
  addendum line "when reconstructing stored text, preserve real newlines"
  predates the pillar — it mitigates transcription where the pillar now
  forbids it. A module #1 v2 through the grounded-authoring path is
  owner-gated future work, not an edit to the record.

## 6. Follow-ups this record drives (document first, implementation after)

1. **The self-hosted editing enablement session** — **IMPLEMENTED
   (Session 20, July 9, 2026):** `src/rlm/trellis_textedit.py`, the
   `trellis_textedit` holder injected only when the operator sets
   `TRELLIS_EDIT_ROOT` (strict resolve-then-commonpath containment;
   byte-identical prompt and namespace when unset, pinned by
   `npm run test:textedit`). The surface is the pillar's §2 —
   `load(relpath)` → held list-of-lines frame + load-time digest;
   `locate(relpath, pattern)` → bounded engine-computed addresses;
   `splice(relpath, start, end, new_lines)` → staged replacement at a
   computed range; `diff`/`revert` for in-REPL review; `write_back(relpath)`
   refusing on digest mismatch, else atomic (temp + rename). Bounds per the
   measured §7 (Zod + Python twins: `TRELLIS_TEXTEDIT_MAX_FILE_BYTES`
   4 MiB default / 32 MiB cap, `TRELLIS_TEXTEDIT_MAX_FILES` 16 / 64;
   slice/hit/diff caps are kernel constants). Refinements the code forced,
   recorded here per the DDD contract: (a) `drop(relpath)` joins the
   surface — a bounded frame budget needs a model-visible release valve
   (the workspace `drop()` precedent), and the budget raise hints it;
   (b) addresses are 0-based half-open `[start, end)` — Python slice
   semantics, so the REPL-native model composes them without conversion;
   (c) the frame representation is `text.split("\n")`, whose join is the
   exact inverse — an unedited load → write_back round-trips
   byte-identically, and moved CRLF lines keep their bytes verbatim (only
   authored lines are new bytes). Landing stays human: the toolkit never
   touches git. **Session 29 hardening (July 12, 2026, coverage audit
   #2/#3/#4):** `write_back` re-verifies containment against the CURRENT
   resolved path (the load-time check re-run — a parent symlink swapped in
   after load is refused at write time, and an in-root resolution change
   is refused as stale even when the bytes match), preserves the source
   file's mode onto the replacement inode (the executable bit survives
   edits), and re-checks the digest immediately before the atomic replace.
   That final re-check NARROWS the check-to-replace race to the interval
   between the last re-hash and `os.replace`; it does not eliminate it —
   full elimination needs OS file locking, deliberately out of scope. A
   second writer landing inside the residual window is still silently
   overwritten; the window is documented, not denied. **Session 41
   (July 13, 2026): the guarded splice family** — the mechanical closure
   of the retype-splice neighbor-deletion class this section's §1
   pathology predicted and Sessions 36/37 observed live
   (`replace_lines`/`insert_lines`/`delete_lines`: byte-exact verified
   removal manifests, anchor-guarded insertion, minimal-span refusals;
   `AnchorMismatchError` teaches re-derive-by-query). The engine
   decision (parser-free anchor guards over stdlib `ast`,
   `py-tree-sitter`, or an engine-side service) and the honest
   prevents-vs-detects scope are its own record:
   `docs/architecture/STRUCTURAL_SPLICE.md`.
2. **Kernel prompt revision** — **IMPLEMENTED (Session 20, July 9, 2026):**
   the candidate wording below was adopted verbatim into
   `TRELLIS_ADDENDUM_BASE` in its own commit, with the `test:modules`
   composed-prompt sha256 pin recomputed in that commit (the pin constant
   now records its move history in place):
   *"CODE-MEDIATED TEXT (HARD RULE): load text into structures and operate
   on them with code. Locate by query, never by counting lines or guessing
   positions. Move existing text by slicing and splicing, never by retyping
   it. Author only genuinely new text."*
3. **The effective-context probe** — **MEASURED (Session 21, July 10,
   2026; `docs/benchmarks/EFFECTIVE_CONTEXT_PROBE_REPORT.md`; n=6 per
   arm, directional).** Six deterministic questions over the committed
   ~105k-token Frankenstein corpus (`book:gutenberg-84:frankenstein`),
   the pinned kernel vs the same kernel with exactly the §6.2 block
   omitted (`TRELLIS_EXP_OMIT_CMT=1`, experiment-only, byte-identity
   pinned both ways). Headlines: median input 7.9k tokens (on) vs
   14.7k (off); with the block present no run put the corpus through
   attention, without it one run handed the ENTIRE document to a single
   `llm_query` (110,550 input tokens — 7.6× the on arm for the same
   question); arm cost 2.2×. Both arms otherwise worked the corpus as
   REPL state — the tooling shape carries most of the discipline, the
   prompt block trims iterations and suppresses the blowups. The one
   wrong answer (on arm) was the pillar's own pathology in the one
   unmediated channel: the engine printed the computed count (55) and
   the model retyped it into `answer['content']` as 47 — transcription
   error at the answer boundary, evidence that the residual needs
   tooling shape (a by-reference result value), not more prompt text.
   **Round 2 (Session 22, July 11, 2026; same report) closed that
   residual (item 5) and deepened the measurement:** an unmemorized
   synthetic corpus isolated read-fidelity (8/8 planted-anomaly quotes
   reproduced byte-faithfully — the model genuinely reads through the
   REPL, not from training memory); a 40-document aggregation corpus
   and an edit round-trip were added; across 57 paid runs the
   transcription channel held (zero transcription errors vs 1-in-12 in
   round 1, the round-1 55→47 question now correct in both arms) and
   the edit round-trip was 8/8 byte-exact. TWO threads stayed open for
   round 3: (i) the §7 structure-selection claim is still only
   micro-benchmarked — end to end the model imported pandas in 0 of 68
   runs and answered a 40-document aggregation correctly with plain
   loops, so the scale at which a DataFrame actually earns its keep is
   unmeasured; (ii) every round-2 miss (3 of 56) was LOCALIZATION error
   (§1's other half) — a line-anchored heading regex failing over the
   `get_ast_texts` reconstruction, which concatenates paragraph blocks
   with unmarked boundaries. Whether that reconstruction should preserve
   block boundaries is an open kernel question (it moves every pinned
   reconstruction truth — witting or not at all).
   **Round 3 (Session 23, July 11, 2026; same report) closed both
   threads:** (i) the structured-frame null PERSISTED at 3.1× scale
   with genuine three-table joins — 0 of 87 runs imported pandas or
   polars while plain dict loops answered every relational join
   digit-exact at ~8.7k median input tokens against a ~146k-token
   corpus — the continued null result §7 pre-committed to acting on
   (see §7's demoted status); (ii) the localization class reproduced at
   rate (7/30 locate misses, ALL method error, none transcription) WITH
   the boundary disclosure present in the preamble — prompt disclosure
   measurably does not retire the class — and a second representation
   trap was pinned: gluing destroys trailing word boundaries, so even a
   position-independent shape scan ending in a digit-plus-boundary
   pattern fails at a glued digit-to-letter junction (the exact
   "Chapter 23" mechanism of both rounds). Round 3 first recommended a
   boundary-preserving reconstruction; the owner re-pointed the fix to
   the ADDITIVE accessor of item 6 — same repair, no stored or
   reconstructed byte moves.
4. **Module #1 v2** — **DONE (Session 21, July 10, 2026):**
   workspace-discipline re-authored through the grounded-authoring mode
   with §0+§2 of this record promoted into its corpus
   (`research:trellis/workspace-discipline/code-mediated-text`); the
   "reconstructing stored text" mitigation line is retired (pinned by
   `test:modules` [5]). The anchor gate refused the original three-doc
   corpus at 18/64 = 0.28 — measured cause: the evidence doc's
   distinctive anchors are numerals the authoring template forbids a
   draft from restating (excluding them the draft sits at exactly
   0.30). Per the gate's documented remedy the owner re-scoped the
   pinned corpus to the two normative docs (the same paid draft covers
   32/64 = 0.50) and the envelope landed by zero-paid replay; no gate,
   template, or threshold changed. The module's RESEARCH.md carries the
   full account.
5. **The by-reference answer channel** — **IMPLEMENTED (Session 22,
   July 11, 2026):** the tooling-shape fix item 3 identified for the
   last unmediated channel — the model authoring its final answer.
   `src/rlm/trellis_answer.py` injects `trellis_answer` into every
   research run; `submit(expression_text)` evaluates the given Python
   expression in the live REPL frame, structurally refuses a bare
   literal (`ast.parse`: an expression referencing no REPL state is a
   retyped literal — the 55→47 class), renders the value engine-side,
   and sets `answer['content']`/`answer['ready']` itself with the
   `FINAL_ANSWER:` prefix. The computed value flows to the answer by
   reference; the model never retypes it, and a typo'd name is a loud
   NameError rather than a silent wrong digit — §1's transcription
   pathology closed at the one boundary code did not yet mediate.
   Additive (direct assignment still works; `TRELLIS_RESULT` unchanged);
   the kernel prompt teaches the channel, so both composed-prompt pins
   moved wittingly (recomputed in the same commit). Pinned by
   `npm run test:answer-channel`. Consistent with §2.8: enforcement is
   tooling shape (a structured submit that cannot carry a retyped
   value), and the prompt only teaches it.
6. **The boundary-aware block accessor** — **IMPLEMENTED (Session 24,
   July 11, 2026):** the localization tooling-shape fix rounds 2–3
   demanded (10 misses across the rounds, every one the model
   re-deriving block structure from the glued root reconstruction).
   `trellis_postgres.get_ast_blocks(root_hash)` returns a document's
   extraction blocks IN DOCUMENT ORDER as id/type/text objects — the
   engine hands the model the block structure it already stores, so
   section structure is never re-parsed out of a glued string (§1's
   localization pathology closed at the read boundary, the way item 5
   closed transcription at the answer boundary). The walk lives in the
   dependency-free `src/rlm/trellis_blocks.py` and is parity-pinned
   block-for-block, byte-for-byte against the TypeScript authority
   (`collectExtractionBlocks`/`nodeText`) by
   `src/core/ast/block_parity.test.ts`; the block ids are the same
   citable hashes `get_ast_texts` already exposes; the accessor counts
   as a database tool call and joins the citation audit's read set.
   Reconstruction bytes did NOT change — the byte-changing
   boundary-preservation approach is superseded by this additive read
   (it re-enters only if the round-4 re-measure shows the accessor
   insufficient). The kernel prompt teaches the tool, so both
   composed-prompt pins moved wittingly in the same commit (the item 5
   precedent). **The localization re-measure ran owner-approved the
   same day (probe round 4; $0.9452 / 36 runs): 0/36 misses vs round
   3's 7/30 on the same locate set, with 36/36 runs adopting the
   accessor in BOTH arms — 100% adoption, 100% correct, median input
   ~8.2k tokens and 2 iterations (no recovery loops). The off arm
   adopted at the same rate, so the tooling shape, not the §6.2
   prompt block, carries the behavior — the pillar's enforcement
   thesis measured again. The localization pathology is CLOSED; the
   superseded byte-change stays closed.**

## 7. Structure selection and scale bounds (measured July 9, 2026)

The owner asked whether pandas has line-count limitations that should shape
the spec, or whether a better library exists. Measured in the actual agent
environment (Python 3.13.1, pandas 2.2.3, pyarrow 24.0.0, polars 1.34.0 —
the latter two already installed transitively; zero new dependencies
required for any tier below):

| scale | structure | memory | substring query | splice |
|---|---|---|---|---|
| largest repo file (2,231 lines) | list-of-lines | — | 0.5 ms locate | 0.02 ms |
| largest repo file | pandas (object) | — | 1.1 ms | 0.9 ms |
| whole repo (342 files, 74,115 lines, 2.9 MB) | pandas (object) | 13 MB | 16 ms | — |
| whole repo | pandas (`string[pyarrow]`) | 7 MB | 13 ms | — |
| whole repo scale | polars | — | 1.8 ms | — |
| 1M lines (synthetic) | pandas (object) | 111 MB | 143 ms | 11 ms |
| 1M lines | pandas (arrow) | 70 MB | 104 ms | — |
| 10M lines | pandas (object) | 1,118 MB | 1,465 ms | 125 ms |
| 10M lines | pandas (arrow) | 708 MB | 1,138 ms | — |
| 10M lines | polars | 628 MB | 247 ms | — |

**Findings:**

1. **pandas has no line-count limit relevant to Trellis.** There is no hard
   row cap; the constraint is memory (~110 bytes/row at object dtype for
   ~60-char lines; ~70 bytes/row Arrow-backed), and the discomfort zone
   begins around 10M rows — three to five orders of magnitude above every
   real Trellis frame (single files ≤ a few thousand lines; the whole
   repository is 74k lines / a 13 MB frame / 16 ms queries; workspace-
   bounded corpora cap at 32 MiB ≈ well under 1M lines).
2. **Tiering is by job, not by scale anxiety:**
   - **list-of-lines** for single-file edit frames — fastest at file scale,
     zero overhead, and the hardest structure to misuse;
   - **pandas (object dtype)** for relational/multi-file queries —
     available and fast, but NO LONGER the default (demoted Session 24;
     see the status note below): measured behaviour twice chose plain
     dict/regex loops and stayed digit-exact and cheap through ~6,900
     records and three-way joins, so the guidance is plain loops until a
     measured threshold;
   - **`string[pyarrow]` dtype** when a corpus frame passes ~1M lines
     (halves memory, ~25% faster) — a one-line `astype`, no new dependency;
   - **polars** (already installed) is the escalation tier if a frame ever
     exceeds pandas comfort (5–6× faster queries at 10M, multithreaded) —
     documented so nobody re-litigates it, NOT recommended now: no Trellis
     frame is within two orders of magnitude of needing it.
3. **Bounds, not limits.** The toolkit enforces byte caps in the workspace-
   bounds house style (validated config, hard maxima, over-budget RAISES
   with usage — never silent truncation): per-file edit frames default
   4 MiB, corpus frames default 32 MiB (aligned with the workspace cap,
   since frames live in the same REPL memory).
4. **Display truncation is not data truncation.** A printed DataFrame
   elides rows (`...`); the model must query frames, never parse their
   printed form — printing a frame wholesale is scrollback-pasting through
   the back door.

**Status of this guidance (updated Session 24, July 11, 2026 — the
demotion the previous status pre-committed to):** the table above is a
MICRO-benchmark — raw query/splice timings on pre-built frames. It says
a DataFrame is *fast enough* at every Trellis scale; it never said the
model *reaches for one* when it would help. The behavioural evidence is
now in, twice: probe round 2 measured 0 of 68 runs importing pandas
over a 40-document, 2,209-record aggregation; round 3 raised the scale
3.1× (102 documents, 6,859 records, genuine three-table joins) and
measured 0 of 87 — plain dict/regex loops stayed digit-exact at ~8.7k
median input tokens against a ~146k-token corpus. That is the continued
null result this note pre-committed to acting on, so the "pandas is the
default for relational/multi-file queries" recommendation is DEMOTED
to: **plain loops until a measured threshold.** pandas and polars stay
installed, fast at every Trellis scale (the table stands), and
available the moment a frame earns its keep; the mechanism claim —
compute in code, effective context decoupled from attention — is
untouched and proven by the same runs. The kernel prompt's "ingestion =
pandas" metaphor names the mechanism, not the library (§0's own
definition: compliance is the properties, not the import), and is
deliberately not edited — this demotion is a spec-doc change, not a
prompt change. The movers that could cross the threshold are recorded
from the round-3 logs — schema heterogeneity (many record shapes),
fuzzy joins, long interactive sessions over one corpus — and measuring
them is a future owner-picked probe round, not a standing objective.

A separate engine-side wall-clock question was measured on July 11, 2026
and recorded in docs/benchmarks/WALL_CLOCK_TEXT_OPS_REPORT.md. For
splice-shaped insertion, the report finds plain Python lists faster at
every measured size from 100k to 8M tokens, with insertion wins ranging
from 16.9× at 100k to 2.6× at 8M. For extraction/normalization/grouping
(disambiguation), polars takes over from roughly 100k tokens up; at the
2M-token baseline it is 14× faster. That measures engine execution rather
than model behavior, so the demotion above — plain loops until the
model-behavior threshold is measured — stands unchanged.

**The data-plane representation verdict (owner-commissioned review,
July 11, 2026; full record in TRELLIS_ROADMAP.md §5, same date):**
structure selection is operation-shaped, not size-shaped, and the
data-plane contracts stay JSON at every boundary — the workspace index,
MCP payloads, and Redis park/seed snapshots stay canonical JSON;
PostgreSQL and Neo4j stay database-native; splice-shaped editing stays
list-of-lines (the wall-clock report above: plain lists win insertion at
every measured size, no crossover). Polars/Arrow storage was evaluated
at all six boundaries and rejected everywhere: a DataFrame as a public
contract violates the data-not-objects doctrine
(WORKSPACE_AND_MODULES.md §4.5), Arrow payloads are unjustified at the
4–32 MiB caps, and canonical JSON is byte-deterministic where Arrow IPC
bytes are not guaranteed stable across library versions. polars is
pinned in requirements.txt as the engine-side analytics tier — pinned,
not adopted; no kernel, contract, or prompt path imports it. Cap-raise
doctrine: if workspace corpus work ever approaches the 32 MiB cap,
re-run the M1 park/seed drill (a standing `test:rlm-workspace` fixture
since Session 27) at the target size BEFORE raising caps — cap raises,
not representation changes, are the first lever; a migration re-enters
only through the review's recorded benchmark matrix and adoption
thresholds, with owner sign-off.

## 8. Relationship to the other records

| record | relationship |
|---|---|
| WORKSPACE_AND_MODULES.md | parent trust model; §4's workspace contract is the pillar's first instance; §7 (self-editing, revised) governs landing, this record governs mechanics |
| GROUNDED_AUTHORING.md | harness-pinned attribution is the pillar applied to citations; its §7 verification tiers cover the semantic residual the pillar deliberately leaves |
| PROVENANCE_CITATION_AB_REPORT.md | the measurement campaign that exposed the transcription channel and established the enforcement posture (lessons 5–7) |
| GLOSSARY.md | carries the pillar's vocabulary: code-mediated text, engine-computed address, transient frame, hash-guarded write |
