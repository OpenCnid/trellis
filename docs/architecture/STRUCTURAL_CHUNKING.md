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
