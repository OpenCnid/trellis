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

## 3. Scope

| surface | application of the pillar |
|---|---|
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

1. **The self-hosted editing enablement session** (candidate, owner-
   schedulable; extends the July 9 roadmap candidate): the edit toolkit IS
   the pillar's §2 — `load(path) → (frame, digest)`;
   `locate(frame, query) → handles`; `splice(frame, handle, new_text)`;
   `write_back(path, frame, digest)` refusing on digest mismatch — exposed
   to the RLM as REPL helpers, landing as ordinary commits under review.
2. **Kernel prompt revision** (candidate, separate deliberate change — it
   moves the composed-prompt sha256 pin, so it ships in its own commit with
   the pin recomputed): brace-free rule text teaching the discipline for
   research runs. Candidate wording (brace-free by construction):
   *"CODE-MEDIATED TEXT (HARD RULE): load text into structures and operate
   on them with code. Locate by query, never by counting lines or guessing
   positions. Move existing text by slicing and splicing, never by retyping
   it. Author only genuinely new text."*
3. **The effective-context probe** (owner-gated, paid; extends the
   workspace-probe series): a paired-run measurement on a corpus several
   times the attention window — discipline-on vs. discipline-off — scoring
   correctness, bytes-through-attention, and turn count. The "giant context
   window" claim becomes a number.
4. **Module #1 v2** (owner-gated): re-author workspace-discipline through
   the grounded-authoring mode with the pillar in its corpus, retiring the
   "reconstructing stored text" mitigation language.

## 7. Relationship to the other records

| record | relationship |
|---|---|
| WORKSPACE_AND_MODULES.md | parent trust model; §4's workspace contract is the pillar's first instance; §7 (self-editing, revised) governs landing, this record governs mechanics |
| GROUNDED_AUTHORING.md | harness-pinned attribution is the pillar applied to citations; its §7 verification tiers cover the semantic residual the pillar deliberately leaves |
| PROVENANCE_CITATION_AB_REPORT.md | the measurement campaign that exposed the transcription channel and established the enforcement posture (lessons 5–7) |
| GLOSSARY.md | carries the pillar's vocabulary: code-mediated text, engine-computed address, transient frame, hash-guarded write |
