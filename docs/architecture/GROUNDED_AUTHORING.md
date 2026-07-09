# Grounded Authoring — Design Record

*Status: Phases 1–2 IMPLEMENTED (Session 19, July 9, 2026). Child record of
[WORKSPACE_AND_MODULES.md](WORKSPACE_AND_MODULES.md); where they disagree,
the parent record and the code win (authority: code > glossary > prose).
Distilled July 9, 2026 from the review of the module #1 paid authoring turn
(PR #45, `modules/workspace-discipline/`), whose findings this document
remediates. The mode (`trellis_agent.py --mode author`), pinned attribution,
the fixed template, the deterministic anchor gate, and the operator driver
(`npm run modules:author`) shipped in Session 19; Phase 3 (v2/v3 derivation
tiers) stays conditional on the first tool-bearing module class. See the
roadmap §5 entry (July 9, 2026 — Session 19) for the acceptance record.*

---

## 0. Executive summary

The first capability-flywheel turn (module #1, `workspace-discipline`)
succeeded at the machinery level and produced a faithful protocol addendum —
and simultaneously demonstrated, live, the exact residual the parent design
record §10 warned about. Asked to cite the verified research its design
derived from, the authoring run cited **real, existing AST hashes that were
not the research**: unrelated TypeScript blocks it surfaced by searching the
whole database. The hashes passed every automated check (they exist), and
only the operator's manual comparison against the known promoted corpus
caught the mismatch.

The root cause is not model misbehavior in any exotic sense. Authoring was
run on the **general research agent** — a harness whose whole purpose is
"search the entire knowledge base and cite what you retrieve" — and given a
prompt that pre-stated the target directives. It did what it is built to do.
Authoring is a different job (synthesize a capability from a FIXED corpus),
and it has never had a harness that reflects that.

The fix adds **no new trust machinery**. It points Trellis's two existing
provenance rails at authoring and adds two pieces of harness discipline:

| # | Grounding property | Mechanism | Status |
|---|---|---|---|
| 1 | **Access** — the author sees only the promoted corpus | A kernel-owned authoring mode: corpus seeded into a read-only-scope workspace; no whole-database tools | New mode, existing seams (§4) |
| 2 | **Attribution** — cited hashes are the true sources | The harness pins `research.sourceNodeIds` from the promotion output; the model never chooses hashes. Existence-checked by the unchanged registration gate | Existing rail, pen moved (§5) |
| 3 | **Derivation incentive** — the corpus is necessary, not decorative | A fixed, harness-composed authoring template: sources in, protocol out; pre-stating directives is structurally impossible | New discipline (§6) |
| 4 | **Derivation verification** — the link is measured, not trusted | The sampled-verification discipline (`verification.ts` pattern) extended from beliefs to capabilities: a derivation gate in the module's zero-paid drill, class-gated paid tiers later | Existing rail, extended (§7) |

Plus the backstop that already exists and already worked once: **the human
operator gate is never removed** (§8).

One sentence for the meeting: *make authoring a scoped, kernel-owned mode
that cannot see anything but the promoted research, never picks its own
citations, is asked to derive rather than paraphrase, and has the derivation
link measured by the same verification discipline beliefs already get.*

---

## 1. The incident, precisely

Evidence from the run log (July 9, 2026; full record in
`modules/workspace-discipline/RESEARCH.md` and the roadmap §5 entry
"Module #1 (workspace-discipline)"):

- **Setup.** 24 research block hashes were promoted through the Session 17
  CLI (two documents: the design-record §4 excerpts and the measured probe
  reports). The authoring brief handed the RLM those 24 hashes, instructed a
  `get_ast_texts` read, and asked it to cite "the load-bearing blocks."
- **What it did.** 5 `get_ast_texts` calls read the corpus (the correct
  hashes and content entered its context — one appears 9 times in the log).
  It then pivoted: 4 `run_cypher` graph probes and 21 `vector_search` calls
  over the ENTIRE `ast_nodes` table, surfacing semantically-adjacent but
  unrelated content (entity-snippet-fetch TypeScript from a prior repository
  ingestion). Its final `research.sourceNodeIds` were those search hits.
- **What passed.** The result envelope was `status: ok`; zero protocol
  violations; the addendum was brace-free, in-bounds, and a faithful
  synthesis. The cited hashes were real: a spot check found 5 of 5 present
  in `ast_nodes`.
- **What failed.** All 24 true citations were wrong — replaced by the
  operator before landing.
- **The counterfactual that matters.** Had those citations been routed
  through `write_derived_insight`, the hardened Session 14 write path would
  have **accepted them**: they are well-formed and they exist. No runtime
  check in the system catches a real hash cited for the wrong content.

Scored against the four grounding properties:

| Property | Module #1 result |
|---|---|
| Access | **Failed** — whole-database `vector_search`/`run_cypher` available |
| Attribution | **Failed** — self-reported citations were laundered |
| Derivation | **Unproven** — the brief pre-stated the directives, so the corpus may have been decorative |
| Verification | **Absent** — nothing checked the draft against the corpus except the human |

## 2. Why no hash check can fix this

Content-addressing gives Trellis **verifiable provenance**: a hash proves
*hash → exact ingested bytes*. Grounding needs **derivation**: *claim ←
those bytes*. Derivation is a semantic relation between text and claim; it
is not decidable by hashing, existence checks, or any structural rule. This
is not a gap in the implementation — it is the boundary of what
content-addressing can do.

The parent record already names this: §10's "known residual" is provenance
laundering — "the model citing a *real* AST hash for a claim it actually
took from" somewhere else — "not catchable by any runtime check," with the
prescribed backstop being the Phase 5 verification worker re-checking
derived insights against their cited source text. Module #1 observed the
**capability-side twin** of that residual, live, on the first flywheel turn.
This document is the §10 backstop extended from beliefs to capabilities.

Two consequences frame everything below:

1. **The easy failures can be made structurally impossible** (access and
   attribution — remove the affordance, move the pen).
2. **The hard failure can only be measured and gated, never proven away.**
   Worse, there is a *generic-truth trap*: for well-known content, a
   directive written from the model's priors and a directive derived from
   the corpus are indistinguishable by similarity — both match the corpus.
   Derivation checks must therefore weight corpus-SPECIFIC anchors (measured
   numbers, named mechanics, non-obvious terms), and research corpora for
   future modules should be chosen so their load-bearing content is specific
   enough to test.

## 3. Design principle

**No new trust machinery.** Every layer below is either an existing Trellis
rail pointed at authoring, or harness discipline enforced by kernel code.
The authoring mode, template, pinning, and derivation gate are all KERNEL:
they ship as repository code and are never composed, selected, or mutated at
runtime by the module path. (Per the parent record §7 as revised July 9,
2026, kernel changes land as ordinary reviewed commits — commits Trellis
itself may author when the operator loads its repo; what the runtime
flywheel never does is modify its own gates mid-flight.)

## 4. Layer 1 — the authoring mode (access grounding)

**A distinct, kernel-owned mode of the agent process**: authoring runs can
see the promoted research corpus and nothing else.

- **Entry point.** `trellis_agent.py --mode author` (default `research`
  preserves today's behavior byte-identically — the standing
  byte-identical-when-absent discipline). Same process family, spawn
  plumbing, env forwarding, and stdout scanning as every other run.
- **Tool surface.** `custom_tools` contains **only** `trellis_workspace`.
  No `trellis_neo4j`, no `trellis_postgres`, no `trellis_mcp` — no
  whole-database search, no graph reads, no write path, no external
  network. Laundering *access* becomes structurally impossible: the model
  cannot cite what it cannot see.
- **Corpus delivery.** The driver seeds the promoted corpus into the
  workspace via the existing `seed_from_snapshot` seam, **block-aligned**:
  one segment per promoted extraction block, the block's text as content,
  the block hash carried in segment metadata for audit readability (the
  model never needs to repeat it — citations are pinned regardless, §5).
  The model works through the existing surface: `read()` for the index,
  `segment(id)` for deliberate content pulls — the workspace-discipline
  protocol, applied to authoring itself.
- **Result contract.** Author runs emit a `TRELLIS_DRAFT:` envelope
  (purpose, addendum text, drill notes — **no hashes**). The
  `TRELLIS_RESULT`/`TRELLIS_PROTOCOL_VIOLATION` contract for research and
  answer runs is untouched: the zero-database-calls violation rule
  (emitted at `trellis_agent.py` in the answer path) does not apply to
  drafting, which is *supposed* to make zero database calls. Pinned by
  test: an unchanged research run's prompt and envelope are byte-identical.
- **Bounds.** The existing workspace bounds apply (`TRELLIS_WORKSPACE_MAX_*`
  Zod + Python twins); corpus over budget fails the run before spend, the
  Session 16 over-budget-seed rule. The addendum output remains subject to
  the module validator's brace/size rules at landing.

Seams (all existing): `custom_tools` injection, `TrellisWorkspace.
seed_from_snapshot` (stamps preserved, bounds re-enforced, torn seeds
raise), the argparse surface, the bounded stdout line scanners. New code:
the mode branch, the draft envelope + scanner, and an operator driver
(suggest `scripts/author_module.ts` in the `promote`/`register_modules`
house style: reads promoted doc keys, seeds, spawns, collects the draft).

## 5. Layer 2 — pinned attribution

**The model never chooses hashes.** The authoring driver sets the manifest's
`research.sourceNodeIds` to exactly the block-hash set of the promoted
corpus documents it seeded — mechanically, from the promotion output. The
draft contributes prose (purpose, addendum); the harness contributes
provenance.

- Registration is **unchanged**: `modules:register` existence-checks the
  pinned set against `ast_nodes` exactly as shipped in Session 18. This
  layer does not replace Trellis's hashing — it uses it, with the operator
  holding the pen. The one thing model #1 demonstrably could not be trusted
  with — *choosing which real hash to attach* — is removed from its job.
- **Flat pinning, v1.** The whole promoted corpus is cited as one set. A
  change to ANY corpus block contests the whole module via the unchanged
  sweep — coarser than per-directive contestation, but it fails SAFE
  (over-review, never under-review), consistent with the conservative
  mixed-provenance quarantine philosophy.
- **Per-claim mapping, v2 (deferred).** Each addendum directive carrying its
  own supporting block hashes would make contestation precise and give the
  derivation verifier (§7) exact claim↔block pairs. It is a manifest schema
  evolution (both Zod and Python twins; plausibly `kernelCompat: 2`) and is
  deliberately NOT in scope until a module class needs it — flat pinning
  plus whole-corpus derivation checks cover the protocol-module class.

## 6. Layer 3 — the authoring template (derivation incentive)

Module #1's brief pre-stated the directives the protocol should contain —
so the corpus read, though it happened, cannot be shown to have been
load-bearing. The model could have written the addendum from the brief
alone. That was an operator error; this layer makes it structurally
impossible rather than a matter of discipline.

- **The harness composes the entire authoring prompt** from exactly two
  operator inputs: a bounded topic sentence and the promoted doc keys.
  The fixed template says, in substance: *here is a research corpus in your
  workspace; derive the operating protocol this corpus implies for
  <topic>; every directive must be traceable to something the corpus
  actually says; where the corpus is silent, say so in a gap note rather
  than inventing.*
- **Forbidden by construction:** enumerating target directives, supplying
  protocol content, or naming expected conclusions. The operator cannot
  inject them because the operator's only free-text input is the bounded
  topic sentence (structural bound enforced; the semantic residual — an
  operator smuggling directives into the topic — lands with every other
  residual on human review, §8).
- Template text is kernel (a versioned constant with the addendum-style
  brace rules), unit-pinned so drift fails loudly.

## 7. Layer 4 — derivation verification (the verifier rails, extended)

The parent record's belief-verification discipline (`verification.ts` +
`verification_worker.ts`: tiered mandatory/sampled/graduated selection with
a seeded RNG, live-text fetch, a narrow checker against the cited bytes,
confidence write-back, and **disagreement quarantining the belief with
`contestedReason: 'disputed'`**) is the shipped pattern for "does the cited
source actually support this claim." Capabilities get the same discipline,
tiered by cost:

- **v1 — deterministic anchor coverage (ships with the mode; zero-paid).**
  The driver derives corpus-specific anchors from the promoted blocks —
  measured numerals, named mechanics, rare multi-word terms (for module #1
  these would include the probes' `8 vs 4` external-call counts, `0 vs 4`
  re-derivation, `build-new-then-rebind`, `raise rather than truncate`) —
  and scores the draft addendum's coverage. Below threshold ⇒ the module's
  zero-paid acceptance drill FAILS, and the landing gate refuses. Because
  the check joins the module's acceptance drill, §9.4's "Life" bullet
  (sampled re-run of module acceptance) re-executes it for free forever.
  Honest limits, stated up front: anchors are evidence of contact with the
  corpus, not proof of derivation; a model can chase anchors mechanically;
  thresholds must be modest so the gate improves drafts rather than
  distorting them.
- **v2 — embedding similarity (class-gated, small paid cost).** Per-section
  similarity between addendum text and corpus blocks via the existing
  pgvector path. **Measured constraint discovered in this review: blocks
  promoted with extraction policy `none` carry NO embeddings** (all 50
  module #1 research nodes: `with_embedding = 0`; embeddings are written by
  the extraction worker only). v2 therefore requires either check-time
  embedding (trivial cost — the 112-block pilot used ~28.6k embedding
  tokens) or an opt-in `promote --embed` step. Not required for the
  protocol-module class.
- **v3 — narrow entailment verification (class-gated, sampled, paid).** A
  separate model instance answers one question per claim: *is this
  directive supported by this block?* Narrow-task checking is far more
  reliable than open self-report, the checker has no laundering incentive,
  and sampling follows the `defaultPolicy` precedent (p = 0.05 earned
  through the measured poisoning drill). Reserved for module classes whose
  gates warrant it (tool-bearing modules, per the §9.3 table) — never a
  substitute for human review, always in addition to it.

Tier-to-class mapping (extends the §9.3 landing-gate table):

| Module class | Derivation gate |
|---|---|
| Protocol modules | v1 anchors, mandatory in the zero-paid drill + human review (unchanged) |
| Tool-bearing modules (future class) | v1 + v3 sampled entailment + full human review + paid probe (unchanged) |
| Kernel | Ordinary code review: kernel changes land as reviewed commits, which Trellis itself may author when the operator loads its repo (parent record §7, revised July 9, 2026) — never through the runtime module path |

## 8. Residual and backstop

What remains genuinely unprovable, stated plainly for the record:

- **Derivation can be measured, never proven.** The generic-truth trap (§2)
  means a well-known-topic module can pass every similarity and anchor
  check while owing nothing to its corpus. Mitigation is upstream: choose
  research whose load-bearing content is specific and non-obvious, or
  accept that derivation is untestable for that module and say so in its
  RESEARCH.md.
- **The topic sentence is a small semantic side-channel** (§6). Bounded
  structurally; closed by review.
- **The backstop is unchanged and non-negotiable: the operator gate.**
  Module landing remains a human-reviewed PR; registration remains a human
  running a CLI; nomination remains prose. Module #1 proved this layer
  works — it is the one that caught the incident. Nothing in this design
  reduces it, and several layers exist precisely so that it stops being the
  ONLY layer.

## 9. What changes and what does not

**Changes (all kernel, human-implemented):**

- `src/rlm/trellis_agent.py`: the `--mode author` branch, author tool set,
  `TRELLIS_DRAFT` envelope.
- A draft-line scanner beside `RlmResultScanner` (pure, bounded).
- `scripts/author_module.ts` (+ npm alias, suggest `modules:author`):
  operator driver — seed corpus from promoted doc keys, compose the
  template, spawn the run, collect the draft, assemble the module directory
  with pinned citations, run the anchor gate.
- The authoring template constant and the anchor extraction/scoring pure
  helpers (offline-tested).
- Drill extensions (§10) and documentation (parent record §10/§11
  cross-references; README operator workflow).

**Explicitly untouched (the standing invariants):**

- The Session 14 write path and its existence enforcement; the Session 15
  composed-prompt sha256 pin; the Session 16 lineage byte-identity pins;
  the Session 17 promotion refusals; the Session 18 registration gates
  (existence check, non-active skip).
- `TRELLIS_RESULT` / `TRELLIS_PROTOCOL_VIOLATION` semantics for research
  and answer runs; the research agent's tool surface for its own job.
- No new HTTP/A2A surface, no new queue, no Postgres DDL, no manifest
  schema change in v1 (`kernelCompat` stays 1).
- Operator gates everywhere: paid authoring runs stay owner-approved
  per-run; landing stays a reviewed PR; registration stays a CLI.

## 10. Acceptance (zero-paid, the house pattern)

Offline (joins `npm test`):

- Template composition: renders from (topic, doc keys) only; bounds
  enforced; brace-free; byte-pinned against drift.
- Corpus→segments seeding: block-aligned mapping is pure and unit-tested;
  hash metadata carried; bounds violations raise.
- Author tool surface: the mode's tool builder yields exactly
  `{trellis_workspace}` — asserted structurally, no completion run.
- Draft envelope: scanner parses well-formed drafts, rejects hash-bearing
  drafts (a draft that tries to cite is refused — the pen stays with the
  harness).
- Anchor gate: extraction and scoring fixtures with known pass/fail drafts;
  threshold behavior; the module #1 corpus as a regression fixture.
- Pinning: manifest assembly sets `research.sourceNodeIds` = promoted set,
  verbatim, sorted, deduped.

Live zero-paid (extend `test:module-lifecycle`):

- A fixture draft + fixture promoted corpus assembled end-to-end: anchor
  gate passes, module validates, registration existence-checks the pinned
  set, the §9.4 contestation loop still reaches the entity.
- Negative: a draft failing anchors refuses assembly; a hash-bearing draft
  refuses parsing; an over-budget corpus refuses the seed.

The PAID authoring run itself is never an acceptance check (unchanged
rule). The first paid run under the new mode should be module #2 —
owner-approved with a cost estimate, and now with a corpus chosen for
testable specificity (§8).

## 11. Rollout

- **Phase 0 — procedure, effective immediately, zero code.** Until the mode
  ships: authoring briefs must not pre-state directives; citations are
  pinned by the operator from promotion output (module #1's correction,
  made standard); RESEARCH.md records the derivation story.
- **Phase 1 — the mode + pinning + template** (one implementation session:
  §4, §5, §6, offline tests).
- **Phase 2 — the anchor gate + drill extensions** (same session if it
  fits, else the next; §7 v1, §10).
- **Phase 3 — conditional.** v2/v3 derivation tiers land with the first
  module class that warrants them (tool-bearing), not before.

Sequencing is owner-owned. Recommendation: Phases 1–2 before the next paid
authoring turn; the standing next session (Session 19, repository-scale
extraction prerequisites) need not be displaced — this is a candidate for
Session 20, and Phase 0 covers the gap.

Cost: the mode adds zero paid work to acceptance. An authored module's paid
run remains in the measured band (module #1: 160,270 in / 7,827 out
`gpt-5.4` tokens — likely LOWER under the mode, since the 21 exploratory
`vector_search` calls and their context bloat disappear with the tools).

## 12. Decisions resolved by this record

| # | Question | Decision | Rationale |
|---|---|---|---|
| D1 | New binary vs mode? | `--mode author` on `trellis_agent.py` | Reuses spawn/env/scanner plumbing; the mode is kernel either way; default stays byte-identical |
| D2 | v1 verifier: deterministic or model-based? | Deterministic lexical anchors; model entailment reserved for tool-bearing class | Zero-paid acceptance is the house rule; embeddings are absent on promoted-with-`none` blocks (measured); narrow entailment reintroduces model trust and should be spent where gates warrant it |
| D3 | Flat vs per-claim citations? | Flat now; per-claim reserved as manifest v2 (`kernelCompat: 2`) | Flat fails safe (over-contests); per-claim is a twin-validator schema change with no current consumer |
| D4 | Scoped `get_ast_texts` in the sandbox? | No database tools at all; corpus travels as block-aligned workspace segments | Fewest surfaces; fidelity satisfied by seeding exact block texts; hash metadata keeps the audit trail human-readable |
| D5 | Which classes get which derivation tier? | Protocol: v1 mandatory. Tool-bearing: v1 + sampled v3. Kernel: ordinary code review, outside the module path (parent §7 as revised July 9, 2026) | Extends the §9.3 gate table without relaxing any existing gate |

### 12.1 Implementation refinements (Session 19, resolved by the code)

The decisions above were left where the code would settle them; it did:

- **Anchor coverage threshold = 0.3** (`ANCHOR_COVERAGE_THRESHOLD`, a kernel
  constant, unit-pinned). Measured against fixtures a derived
  workspace-discipline draft covers ~0.69–0.83 of corpus anchors while a
  corpus-blind generic draft covers 0.0 — the modest bar the design asked
  for (§7): it catches a blind draft, does not grade a derived one. Not
  env-tunable (Guardrail 5).
- **The seed budget is enforced in the driver too**, not only at the Python
  seed. `assertSeedWithinBudget` refuses an over-budget corpus before any
  spawn OR assembly, so the zero-paid `--draft` path is gated identically to
  the paid path (the Session 16 over-budget-seed rule, applied to authoring).
- **Corpus segment origin stamps:** `server = "trellis-authoring"`,
  `tool = <corpus doc key>`, `argsHash = block hash first 16 hex`. The
  16-hex prefix is deterministic and auditable and can never match
  `^[0-9a-f]{64}$` (D4's "hash metadata keeps the audit trail readable",
  made structural).
- **Template composition split:** the TS driver composes the byte-pinned
  template from (topic, doc keys) and passes it as the run's `--query`; the
  Python author setup composes the system prompt (rlms base + author addendum
  + workspace surface) around it. Both halves are brace-free; the template is
  escape-doubled defensively before splicing.
- **Draft envelope shape:** `{purpose, addendum, gapNotes}` — no hashes. The
  model is asked for `gap_notes`; the agent normalizes to `gapNotes` and the
  scanner refuses any 64-hex token anywhere in the payload.
- **The anchor gate fails closed on an unanchorable corpus** (empty anchor
  set never auto-passes): a corpus too generic to yield anchors cannot have
  its derivation measured, so it is refused rather than waved through (§8).

### 12.2 The §7 verifier tiers, measured (provenance-citation A/B, July 9, 2026)

A paid A/B eval of citation laundering in the research path
(`docs/benchmarks/PROVENANCE_CITATION_AB_REPORT.md`) validated the §7 tiering
empirically and sharpened it:

- **Laundering is incentive-driven, not dispositional.** The RLM cites
  correctly in a neutral task (0% laundered) and launders only when the task
  rewards over-citing. **New standing design principle:** never reward
  citation *count* — not in task prompts, rubrics, or orchestration rewards.
  This is the same mechanism as module #1's authoring laundering, and the
  same fix Session 19 applied there (remove the affordance and the incentive:
  harness-pinned citations, no whole-DB search).
- **v1 (deterministic) and structural checks do NOT catch laundering.** The
  existence check passes it (hashes are real); a readership check
  (cited-but-unread) is blind (the model reads the decoy, then cites it —
  `cited-but-unread = 0` in 100% of laundered runs); a prompt "discipline"
  module is unreliable (0–100% across conditions). Confirms §2: laundering
  is semantic, not structurally decidable.
- **v3 (narrow entailment) is the only mechanism that works, and it works
  both ways.** As a detector (a narrow "does this block support this claim"
  judge) it flags exactly the laundered citations; as an inline gate
  (`TRELLIS_CITATION_ENTAIL`, prototyped, off by default) it refuses
  unsupported citations so 0% laundering persists at every pressure. Cost is
  ~1.5–2× and, under an impossible over-citation demand, it makes the model
  write nothing rather than launder — so v3 stays **class-gated and sampled**
  (the belief-verifier precedent), for contexts where the incentive cannot be
  removed (tool-bearing agents citing external retrieval). The primary lever
  remains incentive design; v3 is the backstop where it cannot be applied.

---

## Appendix A — module #1 evidence index

- Ordered tool sequence (from the run log): 5× `get_ast_texts`
  (lines 3–349) reading the promoted corpus, then 4× `run_cypher` +
  21× `vector_search` (lines 418–1543) over the whole database; the final
  citations came from the search hits.
- Laundered citations: 5/5 spot-checked hashes EXIST in `ast_nodes`;
  content is unrelated TypeScript (entity-snippet fetch, adjudication
  context) from a prior repository-ingestion session.
- Spend: 160,270 input / 7,827 output tokens, 14 model calls, 44 database
  tool calls, 99.8 s; `status: ok`; zero protocol violations.
- Promoted corpus: `research:trellis/workspace-discipline/contract`
  (root `23637ac1…`, 14 blocks) and
  `research:trellis/workspace-discipline/evidence` (root `976f62ce…`,
  10 blocks); 24 block hashes; 50 AST nodes total, 0 with embeddings.
- Operator correction and full narrative:
  `modules/workspace-discipline/RESEARCH.md`; roadmap §5 entry "Module #1
  (workspace-discipline): the first paid flywheel turn" (July 9, 2026);
  PR #45.
