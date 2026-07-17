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

## 2. The six laws

Each law states the shared shape, then its two instantiations, then
where Trellis enforces it today. These are teachings, not new rules —
every one of them re-derives standing house doctrine; the value is
that one statement now covers both worlds.

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
| C11 | **Wire the backend seam; put model identity into evidence.** Verified live July 17: the four `TRELLIS_RLM_*` keys still carry "No consumer reads these values yet" (`config/index.ts:135–146`); `gpt-5.4-2026-03-05` hardcoded at `trellis_agent.py:111/353/589` and in runners. Complete the documented T2/T3 wiring; one model registry with named roles (extraction, entailment judge, RLM root); stamp model identity on `DERIVED_INSIGHT` edges so a model migration can contest model-coupled beliefs — R-27's implication made engine-native | L2 (validated-but-unconsumed config keys are unfunded organs); R-27 | `buildAgentEnv` + agent env reads; edge stamp consumed by the sweep | PROPOSED (inherits audit T1.1) |
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

## 6. Closing

The register holds the claims. This record holds the teaching. The
code holds the proof — and §5 is the list of proofs still owed.
