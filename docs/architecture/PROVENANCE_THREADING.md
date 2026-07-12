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
complexity and new refusal surfaces to teach. Rejected on the §4.5
data-not-objects grounds: keep the mechanical layer a plain set.

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
  here pre-implements it.
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
(`5d27e474…fe2a` default / `45987904…0b56` omit-arm) unmoved. Slice (d)
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

*(Empty at ratification. Refinements the implementation forces are
recorded here, dated, with the section they amend.)*
