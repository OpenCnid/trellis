# Mechanical Provenance Threading — Design Record

*Status: ACTIVE (roadmap §4 row 9). Written July 12, 2026 (Session 30),
document-first per the house DDD pattern
([WORKSPACE_AND_MODULES.md](WORKSPACE_AND_MODULES.md),
[CODE_MEDIATED_TEXT.md](CODE_MEDIATED_TEXT.md)): this record is reviewed
before implementation, each slice lands against it, and refinements the
code forces are recorded back in the corrections ledger (§9). The
engineering origin is the external collaborator's proposal
([COLLABORATOR_BRIEFING.md](../COLLABORATOR_BRIEFING.md) item 2:
address-in-header, provenance from plumbing), promoted from candidate to
scheduled work when the owner retired module #2 and made the
tooling-shape direction permanent (July 11–12, 2026).*

---

## 0. Position

`write_derived_insight` / `write_derived_insights`
([src/rlm/trellis_tools.py](../../src/rlm/trellis_tools.py)) are the
last surface where the model retypes addresses: every other address in
the system already travels by plumbing. Workspace segment origins are
stamped by the wrapper, author-mode citations are pinned by the harness,
textedit addresses are engine-computed and transient, answers are
submitted by reference. The research write path alone still asks the
model to repeat `sourceNodeIds` back from its context window — a
transcription channel, and transcription channels are where laundering
lives ([CODE_MEDIATED_TEXT.md](CODE_MEDIATED_TEXT.md) §2: transcription
and localization are one pathology — attention doing code's job).

This record closes that channel the same way every prior channel was
closed: by tooling shape, not prompt text. The run's retrieved-address
set is recorded engine-side (slice b), retrieved content travels with
its address (slice c), and the write path constrains citable addresses
to the set the deriving run actually retrieved (slice d) — additive to,
never replacing, the Session 14 format + existence gate. What plumbing
cannot decide — whether the retrieved bytes semantically *support* the
claim — is measured by a sampled entailment tier (slice e), never
guessed at by a structural check.

## 1. Threat model — laundering as measured

**The finding (live, PR #45; parent record
[WORKSPACE_AND_MODULES.md](WORKSPACE_AND_MODULES.md) §10).** The module
#1 authoring turn cited real, existing AST hashes that were not the
sources it used — addresses it surfaced by whole-database vector search
under a citation-count incentive. Every automated check passed (the
hashes exist); only the human reviewer caught it.

**The measurement
([PROVENANCE_CITATION_AB_REPORT.md](../benchmarks/PROVENANCE_CITATION_AB_REPORT.md)).**
Laundering is a response to an incentive, not a disposition: 0%
laundered on neutral tasks, laundering appears the moment the task
rewards over-citing. Structural checks cannot see it:

- The **Session 14 existence check** passes it — the cited hashes are
  real ingested bytes, just the wrong ones.
- The **readership gate** (`TRELLIS_CITATION_HINT`, the experimental
  read-before-cite arm) flagged **zero** laundered runs:
  `cited-but-unread = 0` in every laundered run, because the model
  *reads* the decoy block and then cites it. Support is a semantic
  relation between bytes and claim, not a structural property of the
  citation.
- Only the **semantic entailment check** works, both as a post-hoc
  judge (flagged 100% of laundered citations where readership flagged
  0%) and as an inline gate (0% laundering persisted at every pressure
  level, at ~1.5–2× run cost).

**The channel taxonomy this record works from.** Two distinct failure
channels flow through model-asserted `sourceNodeIds`:

| channel | mechanism | closed by |
|---|---|---|
| **T1 — transcription/choice** | the model retypes an address: a corrupted digit, a hash remembered from scrollback, a hash copied from another edge's provenance list, any existent hash it never retrieved this run | **plumbing** — slices (b)+(c)+(d): the citable set is mechanical, membership is engine-decided |
| **T2 — semantic (laundering proper)** | the model retrieved the bytes and cites them for a claim they do not support | **sampled entailment** (slice e) + the standing no-count-incentive doctrine + the human gate |

Honest scope statement, so nobody later claims more than the machinery
delivers: **the retrieval-set constraint (slice d) closes T1, not T2.**
The measured PR #45 laundering — read the search hit, cite the search
hit — passes a retrieval-set check by construction, exactly as it
passed the readership gate. The value of closing T1 is that it is
closable *mechanically and completely* (a set-membership test, zero
model judgment, zero paid cost), it removes the transcription half of
the pathology (wrong-by-a-digit provenance, second-hand citation), and
it shrinks the residual that the paid semantic tier must cover to
precisely the claim→block support relation. This is the layered design
already recorded in the briefing: *addresses threaded by plumbing*
(removes transcription/choice), *no counting incentives anywhere*
(removes the gradient — the A/B eval's primary finding), *sampled
entailment* (measures the residual), *human gate* (backstop).

## 2. The claim→block factorization

The briefing's live question: if the write path constrains citable
addresses to the retrieval set of the deriving computation, what does
the claim→block mapping look like formally — is there a factorization
that minimizes the semantic residual?

Write the provenance obligation for one persisted fact as two nested
claims:

1. **Membership** — every cited address is in `retrieved(run)`:
   `cited(fact) ⊆ retrieved(run)`. Decidable engine-side: the engine
   observes every retrieval (it executes them) and every write attempt
   (single door). No model judgment anywhere.
2. **Support** — each cited block's bytes support the fact:
   `∀ h ∈ cited(fact): supports(text(h), claim(fact))`. NOT decidable
   engine-side, and this is a structural fact about the architecture,
   not a temporary limitation: the derivation happens partly in model
   attention (reading, judging, composing the claim) and partly in REPL
   code. The engine can watch bytes flow into the frame, but which
   retrieved bytes *informed* which authored claim is not recoverable
   from dataflow — a claim is new text, and new text has no taint
   trail. Full mechanization of (2) would require the engine to decide
   semantic entailment, which is the judge's job, not plumbing's.

The factorization that minimizes the residual is therefore exactly this
split: **make (1) total and mechanical** (slices b–d: every fact, every
write, zero cost), **make (2) sampled and semantic** (slice e: a judge
over persisted (claim, block) pairs, at a measured rate and budget).
Anything between the two — e.g. per-claim dataflow narrowing ("cite
only from the variables your code touched near this claim") — buys
little: the model authors the claim text either way, so the semantic
gap survives any narrowing, while the narrowing itself adds kernel
complexity and new refusal surfaces to teach. Rejected on the
WORKSPACE_AND_MODULES.md §4.5 data-not-objects grounds: keep the
mechanical layer a plain set.

One further factorization decision falls out of the answer-channel
precedent ([trellis_answer.py](../../src/rlm/trellis_answer.py): the
engine evaluates, the model never retypes): slice (c) reduces T1
*errors* even before slice (d) refuses them, because an address the
model copies from an adjacent header is an address it never
regenerates from memory. Plumbing first, refusal second.

## 3. The retrieval set — definition

`retrieved(run)` is the set of AST addresses whose **bytes a retrieval
tool returned to the run**. Address and bytes travel together or not at
all. Three surfaces contribute; everything else is excluded by
decision, each with its reason.

### 3.1 Contributing surfaces (all in `trellis_tools.py`)

| surface | what joins the set | why this and not more |
|---|---|---|
| `get_ast_texts(hashes)` | the **keys of the returned map** — existence-filtered by construction (a hash not in `ast_nodes` returns no entry) | the argument list is the model's assertion; the returned keys are what the engine actually served bytes for |
| `get_ast_blocks(root_hash)` | the **returned block ids** (each block's own AST hash), NOT the root argument | the run received the blocks' bytes; the root's reconstruction was never returned. A run that wants to cite the root itself calls `get_ast_texts([root])` — bytes for address, uniformly |
| `vector_search(query)` | the **result row ids** | search results carry their content (the Session 19 reconstruction fix), so the bytes genuinely travel. Recording them is honest even though it means slice (d) alone cannot catch cite-from-search laundering — that is T2, owned by slice (e). The citation audit's separate `search` bucket (module #1's signature detector) is unchanged |

### 3.2 Excluded surfaces — never contribute

- **`ast_hashes_exist`** — write-path plumbing for the Session 14
  existence gate, already deliberately un-counted and un-audited.
  Including it would open a probe-then-cite loophole: existence-check a
  guessed hash, then cite it, no bytes ever read.
- **`fetch_texts`** — harness-side plumbing (the entailment checker's
  read path), deliberately outside both the tool-call count and the
  audit; the model cannot call it.
- **`run_cypher`** — the graph is a map of provenance, not a source of
  bytes. Cypher reads surface `sourceNodeIds` *properties* of existing
  entities and edges — 64-hex addresses visible in results — but a
  provenance list is a reference to bytes, not the bytes. Citing an
  address copied from another edge's provenance is second-hand
  citation, precisely a T1 channel. A run that learns an address from
  the graph re-reads it (`get_ast_texts`) before citing — one cheap
  call that converts hearsay into retrieval, mechanically enforcing
  read-before-cite at the address level.
- **MCP results, workspace segments, textedit frames** — Tier 3 has no
  provenance standing ([WORKSPACE_AND_MODULES.md](WORKSPACE_AND_MODULES.md)
  §3, §10). Their identifiers (uuids, 16-hex argsHashes, paths) are
  structurally disjoint from `^[0-9a-f]{64}$` anyway, but the exclusion
  is by decision, not just by shape: even a 64-hex token *inside* MCP
  or workspace content never joins the set, because no retrieval tool
  returned those bytes from `ast_nodes`.
- **Seeded workspace snapshots** — a seeded run inherits **nothing**
  into its retrieval set. A parked snapshot's segments are Tier-3
  content (stamped stubs of a *previous* run's captures); the seeding
  run has retrieved none of those bytes from the verified store. A
  re-derivation re-retrieves — this is the same rule that already
  governs re-deriving contested edges, applied at run start. (The
  lineage stamps stay verbatim; nothing about park/seed changes.)

### 3.3 Set contents

By construction the set holds `ast_nodes` ids (64-lowercase-hex) — the
contributing surfaces return database ids only. The tracking layer
applies the same `isinstance(str)` filter as the citation audit and
does not re-validate shape: shape enforcement belongs to
`_normalize_fact`, and a second validator would be the parallel-seam
mistake this record exists to avoid.

## 4. Set semantics across the run

- **Scope: per run = per process.** One Python process per job
  (`rlm_worker.ts` spawns `trellis_agent.py` per job), so module-level
  state in `trellis_tools.py` — the `_tool_call_stats` /
  citation-audit mold, lock-guarded — is exactly run-scoped. No new
  scoping machinery.
- **`llm_query` sub-frames.** At the pinned `max_depth = 1`, sub-LM
  calls are plain completions: tools execute only in the root REPL
  frame, so every retrieval any part of the run performs lands in the
  root process's set, and process scope = run scope holds trivially. If
  a future rlms configuration ever ran nested tool-bearing frames
  in-process, their retrievals would join the same set — which is
  *correct*: the run's derivation retrieved those bytes. Recorded so
  the invariant ("the set is the run's, not the frame's") survives a
  depth change.
- **Monotone within the run.** Addresses are never evicted: retrieval
  is a fact about the run's history, not a cache. The set is bounded by
  run activity (3 ids per search, blocks per document, hashes per
  explicit read — all already bounded surfaces), so growth is not a new
  risk class. Note for row 10 (retrieval dedup/budgets): its held-root
  tracking is a *different* structure (which roots are held, for
  serving/refusing re-fetches) that will naturally share call sites
  with this one. The shared seam is the call sites, not the set —
  record that in row-10 terms when that design is written; nothing
  here pre-implements it. (Recorded: the row-10 design is
  [`RETRIEVAL_DISCIPLINE.md`](RETRIEVAL_DISCIPLINE.md) — held state is
  its own module-level structure under its own lock, activation is
  explicit construction at the agent, and the two structures never
  feed each other.)
- **Reset: none needed.** The process exits at run end; the set dies
  with it. Nothing is persisted, parked, or serialized — a retrieval
  set in a snapshot would be a provenance claim Tier 3 is not allowed
  to make (§3.2).

## 5. The slices

The owner's decomposition direction (July 12, 2026): completable slices,
each landing with its own pins. Session 30 delivers (a) — this record —
and (b). Slices (c)–(f) are their own sessions, sequenced by this
record; do not bundle them.

### 5.1 Slice (b) — retrieval-set tracking (Session 30)

Engine-side bookkeeping only. In `trellis_tools.py`:

- A module-level `_retrieved_addresses` set, guarded by the existing
  audit lock, fed inside `_audit_add` when the bucket is `read` or
  `search` — the **same seam** the citation audit already maintains at
  the three contributing call sites (`get_ast_texts` returned keys,
  `get_ast_blocks` block ids, `vector_search` result ids). One
  function, one lock, no parallel instrumentation. The `cited` bucket
  never feeds it. Unlike the audit buckets (opt-in via
  `TRELLIS_CITATION_AUDIT`/`_HINT`, unchanged), the retrieval set is
  **always on**: slice (d) will consult it on every run, so it cannot
  be experiment-gated.
- Accessors `get_retrieved_addresses()` (a copy — callers can never
  mutate run state) and `get_retrieved_address_count()`.
- Telemetry: `retrieved_addresses` (a count, never contents) joins the
  `TRELLIS_TELEMETRY` dict in `trellis_agent.py` — the `mcp_calls` /
  `answer_submits` mold. The Node scanner tolerates unknown fields
  structurally (`parseTelemetryLine` in
  `src/core/observability/rlm_telemetry.ts` extracts named keys only);
  slice (b) adds the explicit unknown-field tolerance test to
  `rlm_telemetry.test.ts` so the additive-only contract is pinned, not
  just implied. T16 holds: addresses never become metric labels or log
  content.

**No behavior change anywhere else**: writes proceed exactly as today
(the constraint is slice d), no prompt byte moves, both composed-prompt
pins stay unmoved, `get_citation_audit` semantics unchanged.

**Pins (test:rlm-sandbox, new section [5]; count reported
before → after):** the set is empty after Cypher reads, existence
checks, and provenance-cited *writes* (i.e. none of those contribute —
including a live Cypher read that returns a real `sourceNodeIds`
property); `get_ast_texts` contributes exactly its returned keys
(unknown hashes contribute nothing); `get_ast_blocks` contributes block
ids and not the root argument; `vector_search` contributes its result
ids (drilled zero-paid: a probe row with a deterministic embedding and
a stubbed `openai` module); repeat retrieval leaves the count unchanged
(set semantics); the accessor returns a copy; and static pins in the
Session 29 audit-#8 mold — `trellis_mcp.py`, `trellis_workspace.py`,
and `trellis_textedit.py` contain no reference to the tracking seam,
and the agent's telemetry dict carries the field.

### 5.2 Slice (c) — address-in-header threading (own session)

Retrieved content travels with its address wherever it is
*re-presented*, so citing becomes copying from plumbing-provided
adjacency instead of regenerating from memory. `get_ast_texts` already
keys by hash and `get_ast_blocks` already carries `id` per block — the
tool returns are done. The open design surface is downstream carriage:
the workspace capture path (a segment holding database-read content
should carry the source addresses in its stamped header, giving Tier-3
notes a mechanical pointer back to Tier 1 without granting them
standing) and any harness rendering that interleaves block text with
prose. Decision deferred to the slice's own session with one
constraint fixed now: headers are engine-stamped, never model-written
— a model-authored header is just transcription wearing a uniform.
Expected prompt impact: possibly a TOOLS-line teaching sentence; if
any kernel prompt byte moves it is witting, with both composed-prompt
pins recomputed in the same commit.

### 5.3 Slice (d) — the write-path constraint (own session)

- **Shape:** in `_run_insight_writes`, after the Session 14 existence
  gate and before any experimental gates, a membership check:
  `cited ⊆ retrieved(run)`. Refusal is typed in the Session 14 mold —
  a `ValueError` naming the unretrieved hashes (bounded echo, first 5
  + count) and teaching the remedy: *call `get_ast_texts` on them,
  confirm the bytes support the claim, then re-derive and cite*. Check
  order stays: format (`_normalize_fact`) → existence
  (`_verify_hashes_exist`) → **retrieval membership** → experimental
  entailment gate if enabled → write. Fail fast, no partial write, no
  session opens for a refused batch.
- **Wiring:** activation by explicit construction at the agent — the
  `ast_existence_check` injection mold — not by module-global default.
  `trellis_agent.py` wires it on; bare `TrellisNeo4j(...)` construction
  (operator scripts, drills, the verifier's harness paths) behaves
  exactly as today. This keeps the gate precisely where model-asserted
  addresses flow and nowhere else.
- **Relation to `TRELLIS_CITATION_HINT`:** the hint gate (read-set
  only, experiment-gated, measured NOT to stop laundering) stays as
  the A/B record's artifact, untouched. Slice (d) is the shipped,
  always-on-for-agent-runs gate over the *full* retrieval set
  (read ∪ blocks ∪ search). They are different sets and different
  gating; nothing is weakened by keeping both.
- **Compat/migration:** none needed, by construction. The constraint
  is write-time only: existing insight rows are never re-checked,
  swept, or migrated by this slice. Re-deriving an old (possibly
  contested) edge under the constraint requires the re-deriving run to
  have retrieved what it cites — the correct semantics, identical to
  what re-derivation already means. Pre-threading writers do not exist
  as a compat class: the only writer is the agent process, and it
  gains the gate atomically with the wiring commit.
- **Failure honesty:** an infrastructure failure in the tracking layer
  is impossible by construction to *misreport* — the set is in-process
  memory, there is no I/O to fail; an empty set refuses everything
  unretrieved, which is the safe direction.
- **Pins:** sandbox-drill positive and negative checks (retrieved hash
  writes; unretrieved-but-existent hash refuses with the teaching
  message; the refusal names the offenders bounded; batch semantics —
  one unretrieved hash refuses the whole batch before any session
  opens), plus the injection-mold pin (bare construction unaffected).

### 5.4 Slice (e) — the sampled entailment tier (own session, owner-gated)

The T2 residual: per persisted (claim, cited block) pair, does the
block's text support the claim? Design sketch, to be finalized in its
own session:

- **Mode: detector, not gate.** The A/B eval measured the inline gate
  correct but costly (~1.5–2×; under an impossible demand the model
  writes nothing rather than launder — correct, but the fact goes
  uncached). The shipped tier is a sampled post-hoc judge that FLAGS;
  flagged edges enter the ordinary belief machinery (contested, not
  deleted — guardrail: entities/edges are never deleted by a checker).
  The inline gate (`TRELLIS_CITATION_ENTAIL` + `make_entailment_check`
  in `trellis_agent.py`) stays experiment-gated for class-gated use
  where a count incentive cannot be removed.
- **Sampling unit and rate:** the (edge, cited-hash) pair, sampled per
  verification sweep; strawman 10% of new pairs with a per-sweep budget
  cap, both operator-visible. Rate and budget are proposed with the
  slice's estimate, owner-gated per run (standing ≤$5/run cap).
- **Judge boundary:** one bounded completion per sampled pair through
  the same discipline as every paid call (worker-side or harness-side,
  never inside the writing run's REPL); a judge infrastructure failure
  is a RuntimeError, never a provenance verdict (the Session 14
  discipline, already applied in `make_entailment_check`).
- **Never a count reward anywhere** — and the symmetric rule from the
  Session 28 retirement: never reward LOW retrieval counts either;
  correctness and calls are reported together.

### 5.5 Slice (f) — compat (folds into d/e sessions)

Existing insight rows untouched (no migration, no sweep — §5.3);
`TRELLIS_RESULT` and `TRELLIS_TELEMETRY` additive only (the
`retrieved_addresses` count is slice (b)'s only telemetry change;
slice (d) adds nothing to the envelopes — a refusal is a raised
`ValueError` the run recovers from in-REPL, exactly like every other
provenance violation today).

## 6. Kernel prompt expectations

Slice (b) moves **nothing**: no prompt bytes, both composed-prompt pins
(the values then current, `5d27e474…fe2a` default / `45987904…0b56`
omit-arm; later witting kernel changes re-pinned both —
`scripts/test_modules.py` is authoritative) unmoved. Slice (d)
should also move nothing — the gate teaches through its typed refusal
message, the same channel every existing provenance violation uses; the
kernel prompt's existing provenance rules already say "cite the AST
hashes the data actually came from." If slice (c) or a tool-signature
change ever requires a prompt line, it is a witting kernel change: both
pins recomputed in the same commit, history recorded in
`test_modules.py`, per the standing rule.

## 7. What does NOT change

The Session 14 format + existence enforcement (this design is additive
at every point); `trellis_answer`, `trellis_workspace`,
`trellis_textedit`, `trellis_mcp` contracts; the citation-audit
experiment flags and `get_citation_audit`'s shape; the module registry
and the retired module #2; every probe suite's question bytes; the four
durable corpora; the `get_ast_texts`/`nodeText` reconstruction bytes;
extraction's TypeScript write path (`mergeWithAstLivenessFence` — a
different door with its own provenance mechanics, out of scope);
park/seed lineage mechanics.

## 8. Relationship to the other records

- **[CODE_MEDIATED_TEXT.md](CODE_MEDIATED_TEXT.md)** — this is the
  pillar applied to the write path: addresses travel by plumbing, never
  by model retyping. §6's follow-up list gains no new entry; the write
  path was always the recorded last channel.
- **[WORKSPACE_AND_MODULES.md](WORKSPACE_AND_MODULES.md) §10** — the
  "known residual, with its backstop" paragraph remains true; this
  record is the capability-side extension it anticipated, replacing
  "not catchable by any runtime check" with the honest split: T1
  catchable and closed, T2 measured by sampling.
- **[GROUNDED_AUTHORING.md](GROUNDED_AUTHORING.md)** — authoring solved
  the same problem for its narrower surface by removing the affordance
  (harness pins citations). The research path cannot remove the
  affordance — deriving and citing is the job — so it constrains the
  domain instead.
- **[PROVENANCE_CITATION_AB_REPORT.md](../benchmarks/PROVENANCE_CITATION_AB_REPORT.md)**
  — the evidence base for every claim in §1; its instrumentation
  (audit buckets) is slice (b)'s seam.

## 9. Corrections ledger (anti-drift)

*(Refinements the implementation forces are recorded here, dated, with
the section they amend.)*

- **July 12, 2026 (Session 31) — slice (c) adjudicated: SATISFIED BY
  EXISTING SHAPE. No carriage gap; no implementation; the slice is
  struck.** Amends §5.2, which deferred the carriage decision to this
  inspection. Every surface that re-presents retrieved Tier-1 bytes to
  a writing run was inspected against the code:
  1. **The tool returns** (`src/rlm/trellis_tools.py`) already thread
     address-with-content: `get_ast_texts` returns the hash-keyed map
     (each text delivered under its own address), `get_ast_blocks`
     returns `{id, type, text}` per block (the block's own citable
     hash rides beside its bytes), and `vector_search` returns
     `{id, content}` rows. No retrieval surface returns bytes without
     their address.
  2. **The workspace** (`src/rlm/trellis_workspace.py`) never holds
     Tier-1 retrievals: `capture()` is invoked from exactly one place
     — inside `trellis_mcp.call_tool` — so its origin-stamped segments
     hold MCP results only; database reads return directly to the REPL
     and are never workspace-captured; `add_note` stores model-authored
     Tier-3 notes with no provenance standing by design; `read` and
     `segment` re-present only that Tier-3 content. No existing surface
     strips adjacency, because no engine path deposits Tier-1 bytes
     into Tier-3 state — and building one (a workspace DB-capture
     path) would be a NEW carriage surface, which this adjudication was
     explicitly not permitted to invent.
  3. **The rlms scaffold** (`rlm/environments/local_repl.py`,
     rlms==0.1.3) performs no separate rendering of tool results:
     injected tools return values into the model's own REPL code, and
     the transcript sees only that code's stdout/stderr
     (`execute_code` → `REPLResult`). The engine never interleaves
     block text with prose; what the model chooses to print is model
     behavior governed by the pillar, not a harness carriage surface.
  4. **The author path** (`src/core/authoring/corpus.ts`/`seed.ts`)
     seeds one segment per corpus block with the block hash's first 16
     hex as the origin `argsHash` — a deterministic, engine-stamped
     pointer that is structurally never full provenance — and author
     mode constructs no database tools and has no write path; its
     citations are harness-pinned (`assemble.ts`). Nothing slice (d)
     needs.
  The §5.2 prompt contingency (a TOOLS-line teaching sentence) was not
  needed: no prompt byte moved, both composed-prompt pins unmoved. The
  fixed constraint survives for any FUTURE surface: headers are
  engine-stamped, never model-written.

- **July 12, 2026 (Session 32) — slice (e) finalized and landed
  (`src/core/graph/entailment_detection.ts`). Amends §5.4 with the
  decisions the sketch left open:**
  1. **Check-stamp shape: additive per-edge audit properties, decided
     against the graph shape.** A supported verdict appends the hash to
     `entailmentCheckedHashes` (+ `entailmentCheckedAt`); an unsupported
     verdict contests the edge through the ordinary Phase 4/5 transition
     with the typed reason `unsupported_citation` and appends the hash
     to `unsupportedHashes` (+ `entailmentFlaggedAt`). Provenance fields
     (`sourceNodeIds` / `orphanedSourceIds`) are never mutated by either
     verdict; no per-pair node class was added (WORKSPACE_AND_MODULES.md
     §4.5 data-not-objects:
     two list properties on the edge, not a new graph shape).
  2. **Judged at most once.** Selection excludes BOTH stamp kinds, so
     every judge completion buys new information and a recovered edge
     never flaps back into contest over an already-judged pair — the
     durable `unsupportedHashes` record already carries the finding for
     the human gate and any future sweep policy. A NEW hash on a
     re-derived edge is a new pair and re-enters the pool. Consequence
     recorded honestly: the write path's union semantics keep an
     unsupported hash in `sourceNodeIds` after recovery; the edge
     recovers (re-derivation clears the contest, exactly as everywhere
     else), the audit survives, and the pair is not re-judged.
  3. **Uniform candidate class.** Every non-contested `DERIVED_INSIGHT`
     edge with provenance is in the pool — `has_category` edges
     included (the verification sweep re-classifies them; the detector
     asks a different question of the same edges).
  4. **Judge-all-then-write atomicity.** Every verdict is collected
     before any write; a judge infrastructure failure aborts the sweep
     with zero partial stamps and zero partial contests — strengthening
     "never a provenance verdict" to "never partial state" (drilled:
     `test:verification-sweep` [9]).
  5. **Transport.** The detector rides `verification_queue` under its
     own job name (`entailment_sweep`); the existing verification job
     shape processes byte-identically. A pair whose bytes died since
     the write is skipped and counted (`skipped_no_text`) — dead bytes
     are the quarantine sweep's territory, never a semantic verdict.
  The oracle-mode machinery is zero-paid end to end; the first real
  judged sweep stays owner-gated propose-with-estimate per §5.4.

## 10. The judge-calibration measurement (Session 44)

*Pre-stated before the run (the RETRIEVAL_DISCIPLINE.md §9 mold: the
question, the selection, and the estimate are fixed here first; the
measured record in §10.2 is appended after and never retunes them.)*

### 10.1 Pre-statement (written before the run)

- **Question.** The first real judged sweep (July 13, 2026; seed 32,
  25 pairs, $0.0093) returned 8 strict-judge verdicts on
  derived-classification `has_category` claims alongside 9 confirmed
  weak heading-block citations. The standing owner decision — accept
  the strict judge or recalibrate its rubric for derived-classification
  claims — needs a rate, not an anecdote. This measurement asks: is
  the strict behavior class-shaped (concentrated in `has_category`,
  absent from verbatim-supportable `mentions`) and rate-stable at a
  4× sample?
- **Instrument.** The existing sweep CLI byte-unchanged
  (`npx tsx scripts/entailment_sweep.ts`), `--sync`, real judge. No
  machinery, config, or rubric change of any kind; the detector's
  invariants (detector-not-gate, at-most-once per pair,
  judge-all-then-write) stand as recorded.
- **Selection (pre-stated; dry-run echoed before the run).**
  `--prefix q_ --rate 0.2 --budget 100 --seed 44`: pool 268 edges /
  528 unchecked pairs; seeded Bernoulli sampling selects 106, budget
  keeps 100 (74 `has_category`, 26 `mentions`), 6 deferred (counted).
  The `q_` prefix targets exactly the OOLONG-era classification
  corpus the calibration question is about; the three standing
  repo-substrate beliefs are outside the prefix and cannot be
  sampled by this run.
- **Estimate.** 100 pairs at the July 13 per-pair actual
  (~$0.00037/pair) ≈ $0.037; ceiling $0.10. Well under the ≤$5/run
  cap. Owner approval was given up front for this session's
  recommended plan and spend.
- **What will be reported (and nothing else claimed).** Supported /
  flagged / skipped counts split by verb class; judge sub-calls and
  token usage; edges contested. The rates are reported with the
  claim (guardrail 8); flagged pairs contest their edges through the
  ordinary belief machinery (durable, lazy recovery — the same class
  as the July 13 residue). This is a measurement for the owner's
  calibration decision, not a pass/fail acceptance: no criterion, no
  retuning, the decision stays the owner's.

### 10.2 The measured record (July 13, 2026 — run exactly as pre-stated, no retuning)

- **Execution.** `npx tsx scripts/entailment_sweep.ts --prefix q_
  --rate 0.2 --budget 100 --seed 44 --sync`; selection matched the
  §10.1 dry-run echo exactly (pool 268 edges / 528 unchecked pairs;
  106 sampled, 100 within budget, 6 deferred). 100 judged, 0 skipped
  (no live text), 0 skipped (no answer), 100 judge sub-calls.
  Judge model `gpt-5.4-2026-03-05` (config `EXTRACTION_MODEL`
  default). Usage 8,695 input / 1,500 output tokens = **$0.0367
  actual** (estimate was $0.037; ceiling $0.10).
- **Verdicts.** 12 supported / 88 flagged; **83 edges contested**
  (68 `has_category`, 15 `mentions`), every one through the ordinary
  belief machinery (`contestedReason = 'unsupported_citation'`,
  audit preserved, lazy recovery — the same class as the July 13
  first-sweep residue).
- **The class split** (per-verb, recovered from the graph — see the
  incident note below): `has_category` **73 flagged / 74 judged**
  (1 supported, 98.6% flagged); `mentions` **15 flagged / 26 judged**
  (11 supported, 57.7% flagged). Rates are per this seeded 100-pair
  sample of a 528-pair pool — a sampled measure, not a census.
- **Answer to the pre-stated question.** The strict behavior is NOT
  confined to the derived-classification class, but it is
  class-shaped in degree: `has_category` claims flag near-uniformly
  (the category label is a dataset-derived classification no
  question's block text states), while `mentions` claims flag
  per-pair where the SPECIFIC cited block lacks the mention —
  multi-hash `sourceNodeIds` writes whose weakest citations fail
  individually (the July 13 "weak heading-block citation" class,
  now measured at scale: 15 of 26). The judge is consistent; the
  flags measure real per-pair citation weakness of the OOLONG-era
  write style, not judge noise. The calibration DECISION stays the
  owner's; the data now on the table: accepting the strict judge
  means the remaining unchecked `q_` pool (356 pairs after this run,
  the post-run dry-run header's count; `has_category` dominates it)
  contests at high rates as sampling reaches it; treating
  derived-classification verbs as a distinct judged class is a
  rubric change — a recorded owner decision, not a session edit.
- **Incident, investigated and resolved AGAINST the initial
  diagnosis (the honesty rule at work).** The session's observation
  pipeline captured only 54 of the 88 `FLAGGED` detail lines, and the
  first diagnosis blamed `scripts/entailment_sweep.ts`'s
  `process.exit(0)` for terminating before the piped stdout buffer
  drained — seemingly "reproduced" by a `--dry-run --rate 1
  --budget 500` run that printed 359 lines against an EXPECTED 431.
  Both halves of that story were then falsified: the 431 expectation
  had assumed pool = 528 − 100 judged, but contesting 83 edges also
  removes their unchecked sibling pairs, and the dry-run's own header
  read `356 unchecked pair(s)` — 3 header + 356 = **exactly the 359
  lines delivered, zero lost** (confirmed identical piped and
  file-redirected). The real culprit was the session's own capture
  pipeline (`... | tee log | head -40`: head exits at 40 lines, tee
  dies on the resulting EPIPE, the log freezes at 58 lines). The CLI
  is exonerated; no code defect; the candidate was REJECTED as a
  Session 44 self-edit target for failing falsifiability. The
  per-verb split above was recovered from the graph
  (`contestedAt`-windowed, fresh edges only — previously-contested
  edges are excluded from selection, so a fresh edge's
  `unsupportedHashes` are exactly this run's), which is authoritative
  regardless of any console capture: judge-all-then-write atomicity
  had committed every stamp and contest before the first report line
  printed. The detector machinery (selection, judging, stamps,
  contests) behaved exactly as pinned. Durable note for future
  operators: `process.exit(0)` exists in that CLI because all seven
  BullMQ queues share one IORedis connection that
  `verificationQueue.close()` alone does not quit — output loss was
  NOT observed through it at these volumes, and any future change
  there needs its own demonstrated failure first.
