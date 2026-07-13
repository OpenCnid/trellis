# Structural Chunking: the code-substrate granularity upgrade (design record — roadmap §4 row 12)

Status: **SELECTED — the owner chose this row as the NEXT session
objective (July 13, 2026, same day as recording; Session 38).**
Nothing is implemented yet; the machinery lands zero-paid first and
the pilot stays owner-gated per §7. The previously queued objective
(the comment-class diff gate + the increment-2 retry) is DEFERRED one
session, not dropped — it follows as Session 39 by the same owner
decision. Document-first, per house pattern.

## 1. The measured problem

The stage-1 self-substrate absorbs code through
`src/core/ast/source_parser.ts` (Session 8): real per-language parsers
(`@babel/parser` for TS/JS; the stdlib `ast` module via the
`scripts/parse_python_source.py` subprocess for Python), with a
chunking POLICY on top that blocks only TOP-LEVEL functions and
classes; everything else is "gap material" sliced into ≤4,000-char
`code_chunk` blobs at line boundaries, and a large function stays one
block at any size.

Measured against the live `trellis#3` substrate (July 13, 2026):

- TS files: 964 `code_chunk` blocks (901,715 chars) vs 747
  `code_function` blocks (832,253 chars) — **over half the TypeScript
  bytes carry no structural identity.** This codebase's semantic
  backbone (Zod schemas, exported const configs, interfaces, type
  aliases, arrow-function handlers) is invisible as structure: no
  typed block, no per-construct embedding, no per-construct
  provenance.
- **15 blocks exceed 8,000 chars; the largest is 25,818.**
  `trellis_agent.py`'s `main()` is one 13.7 KB `code_function` block:
  one embedding vector, one extraction unit. Graph consequence,
  observed: entity `main` is a 118-edge hub with block-coarse
  provenance; Session 34 recorded the same signal (`main` at 28
  sources).
- Session 37's increment-2 run 1 showed the retrieval consequence
  live: vector search over monolith-block embeddings surfaced
  semantically-similar blocks from the WRONG file, and the run cited
  them (`unbridged_evidence`, §5f.5 of the ingestion report). Honest
  attribution: run 1's proximate cause was query guidance (fixed in
  run 2 with zero parser changes) — granularity is a quality
  amplifier here, not the sole cause. Run 2's retype-splice failure
  is an EDITOR-addressing problem, named out of scope in §8.

## 2. The future axes (what this design must scale to)

1. **Corpus growth.** 305 documents / ~2,300 code blocks today; the
   stage-1b prose chunk (~2,900 blocks) stands proposed; multi-repo
   substrates are already supported by repo keys. Chunking must stay
   O(file), deterministic, and policy-stable — because every policy
   change re-hashes affected blocks and re-buys extraction.
2. **Language growth.** Three code languages today. Each new language
   under the current design costs a bespoke parser integration plus a
   bespoke segmenter. A uniform tree interface makes a new language a
   grammar-plus-mapping, not a subsystem.
3. **Broken-file states.** `parse_error` is a typed skip today: a
   file that stops parsing keeps serving its last parseable version
   (or is absent if never parseable). Acceptable now; hostile to the
   self-edit flywheel later — mid-edit broken states become substrate
   blind spots exactly when the system is editing itself.
   Error-tolerant parsing (trees with ERROR nodes) is the structural
   answer.
4. **Extraction-spend control.** Block eligibility is decided by TYPE
   SET (`collectExtractionBlocks`, `CODE_BLOCK_TYPES`). Typed gap
   blocks turn "extract everything eligible" into a per-type policy:
   imports and license headers can be typed-and-skipped while schemas
   and consts become first-class — coverage of meaningful constructs
   rises while paid blocks per file can FALL.

## 3. The chunking algorithm: cAST-style recursive split-merge

The algorithm decision is separable from the parser decision, and the
literature has converged on a shape — cAST (Zhang et al., CMU/UIUC,
2025, arXiv:2506.15655; validated on RepoEval/SWE-bench retrieval):

- Walk the syntax tree top-down. A node whose exact byte span fits
  the size budget becomes one chunk. An oversized node recurses into
  its children; adjacent small siblings GREEDILY MERGE up to the
  budget (density — no confetti blocks).
- Chunk boundaries always align with syntactic units; concatenating
  chunk bytes in order reproduces the file byte-for-byte (the
  existing `coversSource` invariant, unchanged).
- Oversized single leaves (a minified line, a giant literal) stay
  whole — blocks are exact bytes, never split mid-line (the existing
  rule, unchanged).
- The algorithm is language-invariant: it consumes tree SHAPE
  (`{type, byteSpan, children}`), not language semantics. Per-language
  knowledge reduces to one small map: node type → block kind
  (`code_function` / `code_method` / `code_class` / typed gap kinds —
  proposed additions: `code_import`, `code_const`, `code_type`,
  `code_statement`) plus which kinds are extraction-eligible.

Budget: target ~2,000–3,000 chars, hard cap 4,000 (today's
`MAX_CHUNK_CHARS`), tuned once during the pilot against the embedding
model and the code-extraction prompt. Under this algorithm the 25.8 KB
monolith becomes ~8–12 statement-aligned sub-blocks and the 4 KB blind
chunks become typed constructs.

## 4. The parser layer: one generic tree interface; web-tree-sitter as the scaling engine

Decision shape — a seam, then an engine:

- **The seam:** segmentation consumes ONE generic tree
  (`{type, start, end, children}` byte spans over exact source). The
  cAST walk is written ONCE against that interface. Today's parsers
  can populate it (Babel natively; the Python subprocess by emitting
  the nested tree instead of pre-cut segments), which keeps a
  zero-new-dependency fallback alive.
- **The engine for scale: `web-tree-sitter` (wasm).** Rationale
  against the axes in §2: one parser API for 100+ maintained
  grammars (axis 2 becomes grammar-plus-mapping); error-tolerant
  parsing with explicit ERROR nodes (axis 3 — a broken file can
  ingest as structure-with-ERROR-chunks instead of vanishing);
  byte-offset spans natively (the coverage invariant holds by
  construction); wasm rather than the `node-tree-sitter` native
  addon — no node-gyp toolchain on Windows/CI/Docker, hermetic and
  deterministic per pinned grammar blob. Parse speed is slower than
  native bindings and irrelevant here: ingestion cadence is bounded
  by the extraction worker (~26 LLM jobs/min), not parsing; the whole
  accepted corpus is 2.4 MB.
- **Honest costs:** new wasm assets per grammar (~1–2 MB each,
  version-pinned — a grammar bump can re-hash affected files exactly
  as a Babel bump can today, but the pin count grows per language);
  per-grammar node-type maps to maintain; replacing battle-tested
  Babel/ast segmentation carries regression risk. Mitigations: the
  typed-skip + `coversSource` machinery already refuses any parse
  that cannot reproduce the file; Babel and the Python `ast`
  segmenter are retained as TEST-TIME ORACLES (parity pins: identical
  byte coverage, sane boundary agreement on the current corpus)
  until the owner retires them.
- Rejected alternatives: `node-tree-sitter` (native addon; build
  toolchain cost, no benefit at this cadence); `astchunk` as a
  dependency (young toolkit; the harness holds the pen — we own the
  ~200-line walk and pin it); policy-upgrade-on-existing-parsers
  WITHOUT the seam (cheapest now, but duplicates the walk per
  language runtime and leaves axes 2–3 unaddressed — it survives as
  the fallback populate-the-seam path, not as the destination).

## 5. What does NOT change (the invariant fence)

- **T13 identity:** `createASTNode`'s SHA-256 preimage is untouched.
  New blocks are different CONTENT SPLITS, not a new hash function.
  Nothing positional is ever persisted; tree-sitter spans are the
  same ephemeral slicing mechanism Babel spans are today.
- **Byte-exact coverage:** depth-first leaf concatenation reproduces
  the file, enforced, violations are typed skips — unchanged.
- **The block walk:** `trellis_blocks.py` / `collectExtractionBlocks`
  walk STORED nodes generically; new types flow through as
  `{id, type, text}`. The Session 24 parity pin is unaffected.
- **The write path, retrieval discipline, provenance threading:**
  untouched. This is an ingestion-granularity change below them.
- **Session 27 data-plane verdict:** blocks stay JSONB rows in
  `ast_nodes` — this is NOT a representation migration. It IS a
  substrate-identity change, so it takes the migration-grade entry
  path anyway: owner sign-off, pre-stated criterion, budgeted runs.
- **Markdown and prose:** `parseMarkdownToAST` and its pinned
  geometry stay exactly as they are (the four durable probe corpora
  and every prose document are out of scope).

## 6. Churn economics and the rollout lever

A chunking-policy change re-hashes every affected code block: dead
hashes, contested extraction beliefs, re-extraction spend
(≈$2.75 for the full current scope at stage-1 rates — bounded,
budget-gated, but not free). Two mechanisms keep this controlled:

- **Policy versioning:** the segmenter stamps `chunkingPolicy` in the
  snapshot summary. Old-policy and new-policy documents coexist; the
  churn loop already handles superseded blocks (dead hash → contest
  with audit → lazy re-derivation) — the Session 36/37 refreshes
  drilled exactly this path live.
- **Scoped rollout:** Session 34's `--include` scope machinery makes
  adoption incremental and budget-gated per prefix — pilot one
  directory, measure, then extend. No big-bang re-ingest is ever
  required.

## 7. Pre-stated acceptance criterion (for the owner-gated pilot)

Pilot = one prefix (proposed: `src/rlm`, the flywheel's own surface)
re-ingested under policy v2 via a scoped snapshot. Measured
before/after, reported together with dollars:

1. **Size distribution:** zero blocks over the hard cap except
   whole-line exceptions (counted); monolith count (>8,000 chars)
   falls to ~0 in scope.
2. **Typed coverage:** the structureless share of TS bytes in scope
   (today >52%) falls below a pre-stated bar (proposed ≤15%).
3. **Seam-query retrieval:** for K pre-stated kernel-surface queries
   (the Session 34 §5d.3 named-surfaces mold, e.g. "retrieved
   addresses telemetry count"), `vector_search` ranks a block of the
   DEFINING file in its top 3 — measured before and after; after ≥
   before, with the increment-2 run-1 miss class as the headline
   case.
4. **Hub cardinality:** max hub share does not regress past the
   stage-1 bar (≤8%); `main`-class hub edge counts reported.
5. **Churn integrity:** contested/recovered counts reported; the
   coverage invariant green on every file; extraction spend actual
   vs estimate.

A criterion miss = the pilot FAILED; record and stop (no silent
retuning of the budget until a recorded owner decision).

## 8. Adjacent candidates named, deliberately OUT of scope

- **Structural splice addressing in `trellis_textedit`** (the
  mechanical closure of Session 37 run 2's retype-splice class —
  splice at syntax-node granularity instead of line ranges). Highest
  single-leverage child of this investigation, but it lives in the
  Python toolkit under the Session 29 import-allowlist pin
  (`py-tree-sitter` is a native wheel — an allowlist and runtime
  decision), and it needs its own design record. The Session 38
  comment-class diff gate DETECTS that class post-run either way and
  ships first regardless.
- **Error-tolerant ingestion of broken files** (§2 axis 3): enabled
  by the tree-sitter engine but a separate policy decision (what a
  substrate should assert about bytes that do not parse).
- **Prose/stage-1b chunking:** unchanged by this record.

## 9. Status ledger

- July 13, 2026 — recorded as CANDIDATE (this document), roadmap §4
  row 12. Owner-directed investigation the same day as Session 37's
  close; measured numbers from the live `trellis#3` substrate. No
  code, no dependency, no prompt byte. External basis: cAST
  (arXiv:2506.15655), the astchunk reference implementation, and the
  tree-sitter project's wasm bindings — consulted July 13, 2026.
- July 13, 2026 (later the same day) — owner SELECTED this row as the
  Session 38 objective; the increment-2 retry moves to Session 39.
  Sequencing recorded in the roadmap §5 entry and HANDOFF §3.
- July 13, 2026 (Session 38) — IMPLEMENTED as designed (§10 below):
  the seam (`src/core/ast/generic_tree.ts`), the walk
  (`structural_chunker.ts`), the engine (`treesitter_engine.ts`:
  web-tree-sitter 0.26.11 + @vscode/tree-sitter-wasm 0.3.1, both
  exact-pinned), `chunkingPolicy` on `parseSourceFile` and
  `repo:ingest --chunking-policy` with the snapshot-summary stamp;
  policy 1 byte-identity pinned. Shadow measured, pilot executed —
  the numbers are §10.

## 10. Measured record (Session 38, July 13, 2026)

### 10.1 Implementation decisions inside the fixed algorithm

Recorded refinements the cAST shape left open, decided before the
shadow run:

- **Same-kind merge only.** Adjacent small siblings merge only when
  they map to the SAME block kind (imports with imports, statements
  with statements). Merging across kinds would blur typed identity
  and extraction eligibility. Consequence: small adjacent functions
  DO merge into one `code_function` block (the cAST density rule).
- **Trivia glues forward.** Comments and gap bytes ride the FOLLOWING
  construct's block (a doc comment travels with its function); the
  trailing gap of a span appends to the preceding segment, descending
  into a trailing container. Gaps larger than the split threshold
  become bounded `code_chunk` segments instead of distorting a
  construct's block — so a glued prefix can push a block slightly
  past the hard cap (counted honestly below).
- **Budget constants:** `STRUCTURAL_SPLIT_THRESHOLD_CHARS = 4000`
  (equals policy 1's `MAX_CHUNK_CHARS` — no new over-cap class),
  `STRUCTURAL_MERGE_TARGET_CHARS = 3000` (top of the record's target
  band). Tuned once here; changes are recorded decisions.
- **Classes are ALWAYS containers** (never merged, never a leaf),
  preserving the Session 8 rule that class bytes are never an
  extraction unit; methods stay individually typed.
- **Eligibility (§2 axis 4):** `code_import` typed-and-skipped
  (readable in the walk, never extracted or embedded — import names
  are the cross-file generic-identifier class); `code_const` /
  `code_type` / `code_statement` ELIGIBLE. Recorded in
  `EXTRACTION_INELIGIBLE_BLOCK_TYPES` (traverse.ts), consumed by
  `planExtraction`.
- **ERROR trees refuse** (typed `parse_error`) — the §8 broken-file
  policy decision stays unmade.
- The walk consumes NAMED tree-sitter children; both block walks
  (`collectExtractionBlocks` / `trellis_blocks.py`) collect the new
  kinds through the existing childless-with-content branch — neither
  walk changed a byte (parity re-pinned).

### 10.2 Shadow measurement (zero-paid, full scope src+scripts+modules)

`npx tsx scripts/chunking_shadow.ts` over 285 measured code files
(305 accepted, 20 non-code), July 13, 2026. GREEN: zero coverage
errors under either policy, zero policy-2 parse refusals.

| Measure | Policy 1 | Policy 2 |
|---|---|---|
| Blocks | 2,332 | 2,682 |
| Monoliths >8,000 chars | 15 (max 25,818) | **0 (max 4,641)** |
| Blocks >4,000 chars | 41 | 3 (glued-prefix exceptions: 4,003 / 4,085 / 4,641) |
| TS structureless share | 51.6% | **0.4%** |
| PY structureless share | 55.0% | 0.0% |
| JS structureless share | 100.0% | 0.0% |
| Extraction-eligible blocks | 1,839 | 2,389 (293 `code_import` skipped) |

Policy-2 kind distribution: 997 `code_statement` / 690 `code_const` /
464 `code_function` / 293 `code_import` / 195 `code_type` /
41 `code_method` / 2 `code_chunk`. Boundary oracle: **911/911**
policy-1 functions/methods (≤4,000 chars) found intact inside one
policy-2 block — zero Babel/python-ast vs tree-sitter boundary
disagreements on this corpus. `code_function` count falls 860 → 464
because small adjacent functions merge (the density rule above);
none is split or lost (the oracle proves containment).

### 10.3 Pilot (owner-approved; scope src/rlm, policy 2)

Snapshot `trellis#6`, July 13, 2026: `repo:ingest --repo-key trellis
--root . --include src/rlm --chunking-policy 2 --extract changed
--max-blocks 150 --confirm-extraction` after the printed plan echo
(8 files to ingest, 110-block paid bound — exactly the shadow's
number; 304 out-of-scope paths carried forward; 1 unchanged text
file). **110/110 extraction jobs, zero failures**; spend **$0.540
actual** vs the ~$0.46 estimate (78,791 input + 34,231 output tokens
gpt-5.4 + 38,554 embedding tokens — finer blocks emit relatively
more graph JSON per input token; the per-block rate moved $0.0042 →
$0.0049). Seam-query baseline measured BEFORE the pilot on the same
day (`benchmark_logs/session38_seam_before.log`).

The five-part §7 criterion, judged as pre-stated:

1. **Size distribution: PASS.** Database-verified on the current
   versions: 118 typed blocks (60 statement / 30 method / 20
   function / 8 import), zero over the 4,000 hard cap, zero
   monoliths; the 13,656-char `main()` block is gone (max in scope
   3,999). Policy 1 in the same scope: 256 blocks, 1 monolith,
   4 over-cap.
2. **Typed coverage: PASS.** Structureless share in scope 27.3% →
   **0.0%** (bar ≤15%; the scope is all-Python — the full-corpus TS
   figure is §10.2's 51.6% → 0.4% shadow number).
3. **Seam-query retrieval: FAIL as worded.** Through the exact tool
   instrument (`search_ast_nodes` top 3): before 5/8, after **4/8**.
   Root cause diagnosed, not argued away: the re-chunk killed every
   old block but their EMBEDDINGS remain searchable — ~256 dead
   near-twins of the same bytes outrank the live re-chunks (the
   before-run's rank-1 hit for the `trellis_blocks.py` query is the
   after-run's rank-1 hit too, now dead). A live-only diagnostic
   (top 20 fetched, dead hits skipped — NOT the criterion
   instrument) reads before 5/8 → after 5/8 with **the headline case
   FIXED**: "retrieved addresses telemetry count in research mode"
   ranks a live `trellis_agent.py` block at 2 (before: not in top
   5 — the §5f.5 increment-2 run-1 miss class), and one genuine
   regression NAMED: `trellis_blocks.py`'s small functions merge
   with the module docstring under the density rule and the diluted
   block falls out of the top 5. Two findings for the owner: (a)
   dead-block embedding pollution is a substrate property every
   refresh worsens — a liveness filter in `search_ast_nodes` (or an
   embedding sweep over superseded blocks) is a recorded candidate,
   owner-gated because it changes agent-visible tool behavior; (b)
   same-kind merging trades small-file retrieval sharpness for
   density — retuning is a recorded decision, not a silent knob.
4. **Hub cardinality: PASS.** Max hub over pilot-scope current
   blocks: `trellis_mcp_servers` at 6/110 = **5.45%** (bar ≤8%).
   `main` gained ≤3 pilot-scope sources (its 30 historical sources /
   120 edges stand as audit) — the monolith-block hub-feeding
   pattern is gone; provenance lands on per-construct entities.
5. **Churn integrity: PASS.** 110/110 with byte coverage green on
   every file; the pilot window contested 89 nodes / 202
   relationships with audit preserved (`orphanedSourceIds`); the
   three standing TRUE beliefs whose evidence blocks died
   (Session 36's `returns_copy_of` recovery, Session 36 run-2's
   `wires` insight, Session 37 run-2's `consumes` insight) were
   quarantined by the sweep and RECOVERED the same day as operator
   re-derivations through the ordinary write path citing the live
   policy-2 blocks (`9b4c3159…`, `040b7f13…`+`e3df7336…`,
   `e3df7336…`) — all three read uncontested with `rederivedAt`
   stamped. Dollars reported with the counts above.

**Pilot verdict under §7's own rule: FAILED (item 3 missed as
worded); items 1, 2, 4, 5 pass.** Recorded and stopped — no budget
retuning, no query retuning, no instrument swap. The policy-2
`src/rlm` substrate STANDS as ingested (reverting would be a second
churn event teaching nothing); rollout continuation, the item-3
follow-ups, and any wider scope are the owner's call with this
record.

### 10.4 Rollout state after the pilot

- `src/rlm` is at chunking policy 2 (snapshot `trellis#6`); the rest
  of the scope is policy 1 (snapshot `trellis#5`, the Session 38
  per-PR refresh). Snapshot summaries stamp `chunkingPolicy`.
- **Refresh recipe until the owner widens the rollout:** the ordinary
  per-PR refresh must NOT re-parse `src/rlm` under policy 1 (it
  would revert the pilot and re-buy extraction). Run TWO scoped
  snapshots: (1) policy 1 with `--include src/core --include
  src/api --include src/workers --include src/benchmarks --include
  src/config --include src/frontend --include scripts --include
  modules` (everything except `src/rlm`; carried forward preserves
  the pilot), then (2) `--include src/rlm --chunking-policy 2` when
  `src/rlm` actually changed. Session 34's carry-forward semantics
  make this safe by construction.
- Nothing defaults to policy 2 anywhere; `--chunking-policy` is
  operator-explicit per run.
