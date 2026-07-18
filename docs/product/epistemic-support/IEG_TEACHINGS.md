# IEG × Trellis — Teaching Record and Design-Change Queue

**Status: TEACHING RECORD + PROPOSALS — docs only.** July 17, 2026.
Nothing here is implemented, authorized, or enforcement-bearing. The
typed claims live in [`RESEARCH_MAP.md`](RESEARCH_MAP.md) (S13,
R-32…R-38, synthesis §4.11) — that register is authoritative wherever
this document and it appear to disagree. AB-1 as amended binds: S13
enters as design vocabulary only. Per the DDD directive, every change
in §5 requires its own separately authorized bounded feature naming a
non-test entrypoint before any byte of implementation.

**Origin:** the July 17, 2026 owner–assistant dialogue sessions
(branch `d/sister-lab-repo-review-01bcf2`), following the
collaborator's supply of S13 (UIT-IEGv5.1) and his direction that
"everything in my work is really downstream of this lens." This
document records what the dialogue *taught* — the owner's findings,
the assistant's findings, and the corrections both accepted — so a
future session (or a new human) inherits the understanding and not
just the claims.

---

## 1. The relationship, stated once

Trellis and IEG do not layer. They are **two metrics on one
topology**: one abstract shape — *information crossing relations, at
a cost, inside bounds* — instantiated by physics in joules and by
Trellis in ceremonies. Structure transfers; numbers do not (§4.11's
named equivocation: "cost" means a physical theorem in S13, a
schema-enforced minimum at Trellis's write path, and a market price
at the API meter — three different kinds that must never be
converted into each other). The one genuinely vertical arrow is
historical, not logical: the collaborator built the lens first, and
the Trellis-side vocabulary (planes, gluing, registries) arrived
already shaped by it.

## 2. The laws

Each law states the shared shape, then its two instantiations, then
where Trellis enforces it today. These are teachings, not new rules —
every one of them re-derives standing house doctrine; the value is
that one statement now covers both worlds. (This section is the
authoritative list; other documents point here and do not restate how
many laws there are — the count has already grown once.)

**L1 — Nothing crosses a relation for free.**
Physics: erasing a bit costs at least k·T·ln 2 (Landauer, measured
1961/2012). Trellis: nothing persists below the write-path gates;
nothing elevates without a ceremony. Enforced: `_run_insight_writes`
gate sequence; `actor: 'human'` schema literal. Caveat carried from
§4.11: a floor is real only when it is **native to the number
system** — S13 builds its floor into U-Space; Trellis builds its
floors into types and schemas. A floor stated in prose is a wish.

**L2 — Existence and action are separately funded budgets.**
Physics: at its condensation threshold a particle holds exactly the
cost of its own existence — it can *be*, it cannot *do* (N = 1/ln 2).
Trellis: hard rule 15 — correct is not the same claim as reachable;
green tests fund existence, only a real caller funds action. This
repo shipped can-be-cannot-do machinery four times before naming the
law. Classroom form: *your beautifully tested module is a particle
with no surplus.*

**L3 — Surplus is relational; self-funding is forgery.**
Being called is something another part of the system does to you; no
entity can allocate itself reachability, custody, or acceptance. The
same law at every altitude: a belief cannot cite itself into
standing, the controller cannot accept its own work, a judge cannot
score itself, a test cannot be its own audience, and a seed ledger
cannot sign its own genesis (EL-10). Physics form: a particle *can*
spend its existence budget on action — that is decay, and it works
exactly once.

**L4 — Compose only where sections agree; disagreement is an output.**
Physics (S13): spacetime is valid gluing of local exchange data; no
valid gluing, no global section. Trellis: judge verdicts compose only
on agreeing overlaps; conflict is a typed record plus a u-dominant
opinion, never an average (R-30). Already enforced in miniature:
`TRELLIS_PROTOCOL_VIOLATION` is a gluing-failure detector — an answer
produced outside the consistency structure is recorded as
no-global-section, not blended in (§4.11).

**L5 — Time is the count of exchanges.**
Physics: entropic time stops at zero exchange (Barontini). Trellis:
its native clock ticks on ingests, verdicts, sweeps, sessions;
between ticks, no native time passes, and `u` growing over a
verdict-free gap is honest aging. Two consequences the dialogue
surfaced: **starvation is legible** (an unqueried Trellis converges
to "I existed, and I no longer know" — visibly, unlike ordinary
software rot), and **cessation is dormancy, not death** — a system
whose time is exchange-indexed hibernates; `HANDOFF.md` is engineered
germination ("the next session starts with zero context beyond this
repository"). The honest exception is pinned: v1 support decay is
wall-clock (`halfLifeMs`), not exchange-indexed — see C1.

**L6 — A check becomes a caller when its output is consumed.**
The criterion that separates rehearsal from metabolism: does anything
downstream branch on the result? A test whose verdict is thrown away
is rehearsal wherever it runs; a check whose verdict moves state (the
verification sweep quarantining a belief, a support opinion steering
a ratification queue) has been promoted into the living system.
Checks are promoted by **wiring their output into a decision** —
never by declaring the check itself to be an audience (that would
violate L3).

**L7 — Partition is the founding act; boundaries are where everything
lives.** *(added July 17, 2026, from the partition dialogue.)*
Cutting data creates boundaries; boundaries create exchange; exchange
is where cost, evidence, and time live (the cold-atom experiment is
the literal demonstration: partition a system, count the crossings,
and a clock appears). Five consequences, each already enforced
somewhere in the house: (i) **cells need names** — provenance
requires partition; you can cite a cell, never a smear, and hash
granularity is the resolution of accountability; (ii) **cuts must
follow semantic cleavage** — the boundary-blind incident (7/30 block
misses, fixed structurally to 0/36) is what a partition through the
middle of a thought costs; (iii) **distinctions are cheap to keep and
costly to erase** — Landauer charges the merge, not the cut, and
append-only quarantine-never-delete is monotone partition refinement:
the substrate never pays the erasure bill; (iv) **partition of sight
is the precondition for evidence** — corroboration counts only across
disjoint sources, and the judges' blindness profiles are engineered
partitions that make agreement informative; (v) **a summary crossing
a cut is a lossy section** (raw evidence beats summaries, R-27) —
glue lossy sections wittingly or not at all. The ML-side instances
that ground the law: tokenization bounds the verbalizable alphabet
(S8's single-token limit, held per AB-2); the train/test split is the
sacred partition and leakage its cardinal sin (S1's locked held-out
set is that partition, revered); the R-36 knee asks whether the task
space partitions into a cell dense enough to fund a condensate.

## 3. The owner's findings (dated, attributed)

1. **Self-ingestion closes the practice (July 16–17).** "If the
   trellis-engine can live in the harness and create maps/nodes
   throughout the harness itself — and it updates only when things
   change in the hash." The engine ingesting its own harness makes
   the system and its self-knowledge one substrate under one
   invalidation law, at O(changed) cost — the Merkle discount applied
   to self-awareness. The exhale becomes the inhale.
2. **The foliation model (July 17).** The query is a stalk of fixed
   cross-section (the context window); Trellis is the foliation that
   multiplies surface area without widening the stem; xylem carries
   context up, phloem carries answers home — *and to storage*: the
   flywheel is photosynthate banked in the rootstock. Each floret is
   recursively a stalk (`llm_query` over a slice). A stateless
   baseline is cut broccoli: no roots, regrown per query.
3. **The funding chain (July 17).** What keeps Trellis alive:
   **queries fund it** (income), exchanges are its currency, sweeps
   are its metabolism, the human gate is its mouth. Without queries
   it does not rot silently — it starves legibly, writes its seed,
   and stops its clock (L5).
4. **The harness-space thesis (July 17, relaying the collaborator;
   R-35).** Optimal harness engineering is informatic exchange
   geometry within a parameter-mapped harness-space. Typed
   posited-and-fitting in §4.11: a productive posit with three-way
   convergent fit (S9, S10, S13) and no derivation.
5. **The collapse recognition (July 17).** "Everything we've been
   building collapses on top of the same layer at different viewpoints
   topologically." *Dated addendum (July 17, 2026, owner-flagged):*
   the collapse has a predictive form — **condensation thresholds
   wearing another domain's clothes, collapsing onto the same
   layer** — and it is now pre-registered against the next session's
   paper (HANDOFF §3): if the paper's phase transitions fit the
   condensation shape, the lens predicted across domains again; if
   they don't, the un-fit is recorded per R-30. Confirmed in the
   small the same day it was first stated: the
   engineering loop *is* Trellis run on the corpus called "building
   Trellis" — sessions are blocks, `HANDOFF.md` is the root hash,
   ratification is promotion, and a consistency pass is an
   invalidation sweep over prose. The owner's access note stands with
   it: seeing the collapse requires decent fluency in more than one
   domain, and software-engineering / computer-science vocabulary is
   the cheapest ticket in.
6. **Vocabulary control is sight and authority (July 17).** The
   owner's own word for it: *salience*. What has a name can be
   attended to, cited, and governed; what lacks one is invisible even
   when present — anchor discipline was practiced unnamed in this
   repo until R-03 named it, and only then became refreshable by
   ceremony. The mechanistic rhyme (held as vocabulary per AB-2):
   S8's measured workspace reads single-token-nameable concepts —
   naming a thing compresses it to an addressable token. The GLOSSARY
   is therefore not a convenience; it is the system's conceptual
   tokenizer, and controlling it is controlling what future sessions
   can see. Its enforcement homes already exist: canonical terms with
   `code > glossary > prose` authority, and dated-entry amendment.
   *Dated addendum (July 17, 2026 — the owner's reading of the public
   J-Lens).* The instrument for this finding now exists in public:
   Neuronpedia's interactive Jacobian Lens (Gurnee et al.;
   Qwen3.6-27B and Gemma 3 12B, neuronpedia.org/qwen3.6-27b/jlens).
   The owner's reading is adopted: **the J-Lens exposes salience** —
   its readout is a ranked table of which nameable concepts are
   present in the workspace at a position, its STEER/SWAP controls
   are salience *writes*, and its demo set is the five properties of
   a salience buffer (verbal report, directed modulation, multi-hop,
   general broadcast, selective mediation). Sharpest exhibit: in the
   multi-hop demo ("how many legs do the animals that spin webs
   have?" → "Eight", empty think block), the top-ranked readout item
   is `␣spiders` — the un-verbalized intermediate hop, present in
   neither input nor output: the "un-verbalized stream parallel to
   execution" (R-31), on screen. The lens reads concepts across
   surface forms (spider / Spider / 蜘蛛 / 蛛 rank together), so
   salience is concept-level and names are its handles — vocabulary
   is the address space, salience is the state, the lens is the
   debugger. Its blind spot proves the finding in the negative: what
   cannot be named in a token cannot be read; the unnamed is
   invisible even to the instrument. Harness corollary: context
   engineering is external salience writing; AB-5's writer-blindness
   is salience hygiene; prompt injection is an adversarial salience
   write. AB-2 still binds (bag-of-concepts, no binding structure,
   per-model charts) — and with the lens public on open-weights
   models, S8's scale-generality question and R-31's
   registry-separability probe are now publicly runnable.

## 4. The understanding ladder (teaching form)

The dialogue's pedagogy, kept because the *method* transfers: climb
rungs, mark what changed at each, and record un-learnings as
first-class results.

- **Rung 0:** two mundane facts — erasing a bit makes heat; a
  well-formatted claim can be wrong.
- **Rung 1:** each side generalizes — physics makes information
  physical; Trellis makes persistence priced.
- **Rung 2:** the shared move — install a floor: convert "should"
  into a structural impossibility (constraint, not comment).
- **Rung 3:** floors + ceilings make an economy — existence is funded
  separately from action (L2, L3).
- **Rung 4:** gluing — compose only where sections agree; permission
  to fail is the honesty mechanism (L4).
- **Rung 5:** exchange-indexed time (L5). *Un-learning #1:* v1 decay
  is wall-clock; the correspondence holds at design level only.
- **Rung 6:** neither is what it looks like — both are lenses over
  their object level (theories; claims), not competitors within it.
- **Rung 7:** the boundary — numbers do not transfer. *Un-learning
  #2:* "cost" equivocates three ways; a lens that transfers numbers
  is numerology. One differentiated prediction keeps the lens honest
  (the R-36 knee).

A correspondence you cannot state together with its exceptions is
mimicry. The two un-learnings above are what distinguish this record
from decoration.

## 5. Change queue for existing code (all PROPOSED; DDD binds)

What the dialogue implies for what is already built — each item names
its law, its register row, and its reachability spine. None is
authorized by this document.

**Precedence (added July 17, 2026, on the owner's question).** This
queue is an inventory, not a work order, and it displaces nothing.
The active session objective remains whatever `HANDOFF.md` §3 names,
per the standing rule that a session never selects its own objective
(a parenthetical here restating §3's then-current content was removed
July 17, 2026 — volatile state rots exactly like restated counts; §3
is the pointer); the engineering-loop track's objective stays
preserved in HANDOFF Appendix B. `PROGRAM_CONTEXT.md`
§6's follow-up queue (CI wiring plus the four code-hardening items
from the PR #119 merge review) predates this table and keeps its
standing — C2(b) cross-references it rather than duplicating it.
Sequencing any C-item into a session is an owner ruling at or after
ratification; the recommended first spend is C16.

**Sequencing ruling (July 17, 2026, evening — the dual-track
re-sequencing, `HANDOFF.md` §3):** C11's core (the T2/T3 backend-seam
wiring) is SEQUENCED — it rides the reactivated TTT T-series
(`TEST_TIME_TRAINING.md` §14), with T2 held minimal as specced; C11's
model-registry and `DERIVED_INSIGHT` model-stamp extensions are named
successor increments after T4, each its own bounded feature. C5 is
OFFERED to EL-07 stage 1's design checkpoint as a candidate telemetry
shape (adoption is a checkpoint decision recorded in the frozen pilot
plan, `HANDOFF.md` Appendix B.0). Everything else in the table keeps
its PROPOSED standing; C16 remains the recommended first spend among
the unsequenced items.

One counting rule,
learned at the PR #119 consistency pass and re-learned on this table
the same day it was written: **other documents point at this table;
they never restate its row count** — a stated count rots the day the
next row lands.

| # | Change | Law / row | Spine (non-test caller) | Status |
|---|--------|-----------|-------------------------|--------|
| C1 | **Exchange-indexed churn decay** for support opinions: decay driven by sweeps-since-last-verdict (exchange count) alongside or instead of `halfLifeMs`. Requires a dated amendment to `EPISTEMIC_SUPPORT.md` §3 with a same-commit drill re-pin | L5; R-34 as amended | the future `support_sweep` consumer | PROPOSED |
| C2 | **Fund the drilled organs**: (a) `support_sweep` job on the shared verification queue — the first real caller of `support.ts`; (b) CI wiring of `test:support-oracle` incl. a `--negative-control` exit-3 step (already queued, `PROGRAM_CONTEXT.md` §6); (c) a Level-1 read surface displaying (b, d, u) beside retrieval results (display only; no behavior branches) | L2, L6; §4.9 | (a) queue worker; (b) CI workflow; (c) read API/UI | PROPOSED |
| C3 | **Give node-level `contested` its first reader** (retrieval filter or sweep report) — a trust bit nothing reads is an unfunded organ; latent-not-live is L2 applied to a bit instead of a module | L2; vaporware-audit item 6 (branch history) | retrieval path or sweep report | PROPOSED |
| C4 | **Admission estimator**: pre-dispatch check extending the goal loop's count bounds to estimated-exchange-cost-vs-ceiling; a task whose floor exceeds its ceiling is refused with a typed reason and zero side effects | L1; R-37 | `goal_loop.ts` pre-dispatch path | PROPOSED |
| C5 | **Cost-per-detected-drawback telemetry** (counts-only) in drill and future sweep output, so metric composition can later optimize detection per unit cost | L1 instrumented; R-35 row | drill/sweep telemetry consumers | PROPOSED (zero-paid) |
| C6 | **Record per-family repetitiveness** wherever judgment families are defined, pre-registering the benefit-vs-diversity curve so the R-36 knee-vs-slope question is measurable when adaptive-rubric work begins (the paid test itself is separately gated; exceeds the per-run cap; AB-3 binds) | R-36 | future rubric-selection records | PROPOSED (bookkeeping zero-paid) |
| C7 | **Injective preimage v2 + identity versioning** for the hash authority (`src/core/ast/parser.ts`). The v1 preimage is non-injective by construction: `:`-delimited fields with falsy-skip (the pinned T13 quirks) admit **constructible collisions** — e.g. a parent `(type, content, children=[H])` and a leaf `(type, content + ":" + H)` produce byte-identical preimages, in a substrate whose own documents legitimately contain 64-hex strings and whose threat model is adversarial content. Fix: domain-separated, length-prefixed (or canonical-CBOR) preimage; canonical (sorted-key) metadata serialization folded in — **all preimage repairs batched into one versioned event**, since any change re-mints every id; `hashVersion` recorded per node; dual-hash transition with lazy belief migration. A preimage change is a phase transition, not a diff — it cannot ride the Merkle discount and must be planned like a condensation event | L1 (identity is the number system); the flywheel principle applied to the one currently uncontestable authority | its own design record first; migration tooling + `verifyPersistedAstNodes` v2 path | PROPOSED (large; design record required) |
| C8 | *(folded into C7 — canonical metadata serialization; kept as a named line so the defect is individually citable: `JSON.stringify(metadata)` is insertion-order-dependent, stable today only because one code path builds the object)* | L1 | C7's event | FOLDED INTO C7 |
| C9 | **Orphan→added lineage annotations** in the ingest diff path: pair orphaned and added blocks by normalized-content fingerprint (whitespace/punctuation-normalized hash or similarity), recording candidate-successor edges and a `normal_form_equal` flag as **judge-consumable evidence only** — never auto-un-contesting (custody stays binary; support never mints custody). Prices re-derivation by information actually exchanged: today a typo orphans a block and costs the same ceremony as a rewrite, though it carries ~zero new content | L1 (exchange cost should scale with the information exchanged); paper-01's over-firing deflation | invalidation sweep + re-derivation ceremony surfaces consume the annotation | PROPOSED (zero-paid) |

*(C10–C14 added July 17, 2026, second pass — the engine pillar
proper. C11–C14 adopt the sister-lab audit's Tier-1 findings (paper
04, PR #119 branch history) into the queue after re-verifying each at
the cited lines on this tree; C10 is a new finding from re-reading
the hash authority.)*

| C10 | **Identity/annotation field split in the preimage** (`parser.ts`): `bounding_box` (float layout coordinates) and `page_number` participate in identity via `JSON.stringify(metadata)`, so a PDF re-extraction with jittered coordinates re-mints ids for byte-identical text — over-firing orphans and forfeiting the Merkle discount on exactly the corpus class that pays most for it. Fix: split identity-bearing fields (*what it is*) from annotation fields (*where it was seen*); annotations leave the preimage and become node columns. Must batch with C7's versioned event — same phase transition | L1 (identity commits to information, never to its projection coordinates) | C7's design record + migration event | PROPOSED (batch with C7) |
| C11 | **Wire the backend seam; put model identity into evidence.** Verified live July 17: the four `TRELLIS_RLM_*` keys still carry "No consumer reads these values yet" (`config/index.ts:135–146`); `gpt-5.4-2026-03-05` hardcoded at `trellis_agent.py:111/353/589` and in runners. Complete the documented T2/T3 wiring; one model registry with named roles (extraction, entailment judge, RLM root); stamp model identity on `DERIVED_INSIGHT` edges so a model migration can contest model-coupled beliefs — R-27's implication made engine-native | L2 (validated-but-unconsumed config keys are unfunded organs); R-27 | `buildAgentEnv` + agent env reads; edge stamp consumed by the sweep | PROPOSED (inherits audit T1.1); core SEQUENCED July 17, 2026 via the TTT T-series — see the precedence note |
| C12 | **Version the embedding space.** Verified live July 17: `text-embedding-3-small` hardcoded at `extraction_worker.ts:30`, `server.ts:265`, `trellis_tools.py:806`; the schema pins `vector(1536)` with no record of which model produced any stored vector. Swapping models silently yields a mixed index — old vectors, new queries, incompatible spaces, zero errors. Fix: one config pair, an `embedding_model` stamp per vector, and a fail-closed startup refusal to search across spaces, with a documented re-embed path | L4 (vectors from different spaces must not glue — refuse, never blend) | startup refusal + re-embed script | PROPOSED (inherits audit T1.2) |
| C13 | **Make the write path a boundary, not a convention.** Verified live July 17: `rlm_job.ts:174–175` forwards `NEO4J_PASSWORD` and the password-bearing `PG_DSN` into the process that executes model-written code; generated code can open its own driver and write with valid-looking provenance, bypassing every gate (`run_cypher`'s regex is honestly labeled "NOT the security boundary"). Fix: read-only DB principals for the REPL; `write_derived_insight` routes through a privileged writer (a small RPC, or at minimum a writer credential absent from the REPL environment) | L1 — a floor is real only when native to the permission system; a floor enforceable only against a cooperative model is a prose floor | the writer service/credential + a sandbox-drill extension proving the bypass now fails | PROPOSED (inherits audit T1.3) |
| C14 | **Canary the exchange ledger.** Verified live July 17: `trellis_agent.py:63–77` monkeypatches `rlms==0.1.3` private handlers to count sub-calls; a future rlms reroute reads silently as zero, corrupting every downstream cost claim. Fix: a canary run known to make one sub-call asserting `subcall_count > 0` and `iterations !== null`, plus a contract test that the patched attributes exist and fire | L5 (telemetry is the exchange ledger; a clock that can silently stop is worse than no clock) | canary wired beside `test:rlm-sandbox` | PROPOSED (inherits audit T1.4; stub-runnable zero-paid) |

*(C15–C18 added July 17, 2026, third pass — a substrate-focused sweep
of the Tier-1/Tier-2 pipeline itself: `diff.ts`, `ingest_document.ts`,
`invalidation.ts`, `verification.ts`, `schema.ts`, each read in full
that day. The substrate is functional and honestly drilled; these are
the places where "functional at 300 documents" and "scalable, safe,
efficient at production" part ways.)*

| C15 | **Provenance as indexable edges.** Verified live: the quarantine sweep (`invalidation.ts:46–80`) matches `MATCH (n) WHERE any(h IN n.sourceNodeIds WHERE h IN $orphaned)` — and the same over `()-[r]->()` — a **full scan of every node and every relationship per 500-orphan batch**, because array-property membership cannot be indexed in Neo4j. Sweep cost grows with the whole graph, not with the change — the scale report's pre-declared migration trigger, its mechanism now confirmed in code. Fix: represent citations as edges to per-hash `:SourceBlock` nodes (uniquely indexed); the sweep becomes an indexed lookup from orphaned blocks to citing beliefs, O(orphans × degree); the unbounded `orphanedSourceIds` audit arrays (hub beliefs accrete forever) become edge state with history | Merkle-discount economics at the graph layer: exchange cost must scale with what changed | provenance migration + sweep v2 + a re-proof of the two-writer commutativity on the new shape | PROPOSED (large; the Phase-5-class migration) |
| C16 | **Close the enqueue gap.** Verified live: `ingest_document.ts` commits the version (line 119) and only *then* enqueues the invalidation sweep (135) and extraction jobs (152). A crash between commit and enqueue registers the version but never contests the beliefs whose bytes died — silently violating "never confidently wrong forever," the exact failure class the substrate exists to prevent, with no error and no detector. Fix: a sweep-debt record written inside the ingest transaction, consumed by the worker and reconciled at startup (or a full transactional outbox for both queues) | L1 — the floor must hold across crashes, not only on the happy path | startup reconciler + worker consumption; a crash-injection drill in the EL-store mold | PROPOSED |
| C17 | **Live-flagged partial vector index.** `schema.ts:83–108`: `search_ast_nodes` orders by HNSW cosine distance, then filters candidates to LIVE blocks through a three-join `EXISTS` — ANN post-filtering. As superseded versions accumulate, the index's nearest-k fills with archive embeddings and the LIVE filter starves the result set: **retrieval recall decays structurally with archive growth**, and the per-call `MAX(version)` group-by grows with document count. Fix: a denormalized liveness flag on `ast_nodes` maintained inside the version-registration transaction, a partial HNSW index over live embeddings, and a latest-version lookup table | Hard rule 13 enforced at the index level: the archive must not occupy the live search space's candidate slots | version-registration transaction + both retrieval surfaces (`search_ast_nodes` callers) | PROPOSED |
| C18 | **Delta-scoped read-back verification.** `ingest_document.ts:107` re-reads and re-derives **every** node of **every** version (`verifyPersistedAstNodes` over `allNodes`) — the one pipeline step that never receives the Merkle discount: extraction pays O(changed), verification pays O(document), forever. Fix: verify inserted nodes exactly, plus a sampled slice of retained rows — the poison-drill lesson applied to bytes (sample the unchanged; mandatory-only checking of the new is structurally blind to storage rot) | Merkle-discount economics; the R-12 sampling pattern | `persist.ts` verify path + ingest transaction tests | PROPOSED |

**What we would explicitly not change.** No floor gets quoted in
joules and no code comment imports physics constants (the §4.11
equivocation is the standing reason). The wall-clock decay in
`support.ts` stays byte-identical until C1's own bounded proposal —
the drill pins it, and a silent "fix" would be the exact drift the
pin exists to catch. No new plane or axis enters without a driving
governance question (AB-7): the S13 content manifold is vocabulary,
not a license to add dimensions. And the human gate is not a
scaling bug to engineer away — under L3 and the past-hypothesis
reading (R-32 lineage), the owner is the system's inherited boundary
condition, and a boundary condition cannot be derived from inside.

## 6. The documentation stance: agents first (owner directive, July 17, 2026)

Future collaborators here are mostly agents, and they will do the
majority of the work. Therefore **every document in this repository
is a prompt**: it will be read by a session that arrives with zero
context, cannot ask the author anything, and will act on exactly what
the bytes say. The canon below invents nothing — each rule names a
practice this repo already enforces somewhere — but it is stated
once, for authors, with the agent as the design reader:

1. **Self-contained entry points.** The reader starts cold
   (`HANDOFF.md` §0's rule; `PROGRAM_CONTEXT.md`'s "you are probably
   an agent" opener). If understanding a document requires a
   conversation that no longer exists, the document is broken.
2. **Standing before content.** Status headers first; an
   "authoritative wherever they disagree" clause resolves conflicts
   in advance, because the agent reading two documents cannot
   arbitrate between them and must not guess.
3. **Pointers, never restated counts** — the twice-learned lesson,
   learned a third time in this very section's authoring when "the
   six laws" appeared in three pointer documents the day L7 landed.
4. **Dated entries, never silent edits.** Ledgers append
   (postscripts); living documents update; history is refined, never
   erased (L7.iii applied to prose).
5. **Names are load-bearing — coin sparingly, define canonically,
   use exactly.** Vocabulary control is sight (owner finding 6): an
   agent can attend to what is named and is blind to what is not.
   One name per concept; the GLOSSARY is the single mint.
6. **Claims carry evidence classes and falsifiers** (the register
   mold). An agent inheriting an unclassed claim inherits it as
   truth; the class is what lets it inherit doubt at the right dose.
7. **Reusable frames stay contamination-free** (the invariant/variant
   split; the prompt protocols; EL-04's scanner is the enforcement
   home). Session-specific facts in a reusable frame are poison an
   agent cannot distinguish from doctrine.
8. **Write for the reader who cannot ask.** Every ambiguity becomes
   the next session's misread, silently propagated with full
   confidence. The cost of precision is paid once by the author; the
   cost of ambiguity is paid by every reader forever — the flywheel
   economics of prose.

## 7. Closing

The register holds the claims. This record holds the teaching. The
code holds the proof — and §5 is the list of proofs still owed.
