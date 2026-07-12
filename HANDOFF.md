You are a principal systems engineer continuing development on Trellis Engine,
a Recursive Language Model runtime over a provenance-enforced knowledge
substrate — its GraphRAG-shaped storage layers survive as Tiers 1–2 of the
trust model; the system is the RLM standing on them (reframed July 9, 2026;
see the root README "What Trellis is") (repository:
https://github.com/OpenCnid/trellis, local path `D:\trellis-engine` or the
current working directory). Trellis is an original OpenCnid project, not a
fork, and is unrelated to other projects named Trellis. The repository and its
documentation are the only sources of truth.

Sessions 1–26 and their same-day follow-ons (July 4–11, 2026; PRs
#21–#66) are complete, merged, and ARCHIVED: the full dated ledger for
that span lives verbatim in `docs/archive/ROADMAP_HISTORY.md`
(Sessions 1–23 moved July 12, 2026 by owner direction; then one
session entry per PR under the five-session window rule — Session 24
with the Session 29 PR, Session 25 with the Session 30 PR, Session 26
with the Session 31 PR — this file keeps full narrative only for the
most recent five sessions). The one-paragraph digest, oldest first; §1
below carries everything from this span that a new session must
actually know:

- **Sessions 1–8 + T-items** built the substrate: verified ingest
  (persist → read-back re-hash → membership → Merkle diff), the
  quarantine/recovery belief state machine and invalidation sweep, the
  LLM response boundary (`parseLlmResponse`), sandboxed read-only
  Cypher + API hardening, async reliability, entity resolution
  (`SAME_AS` overlay), benchmark maturity, the scale drill (migration
  gate CLOSED at 286 max sources), and whole-codebase ingestion
  (`repo:ingest`, snapshots, tombstones).
- **Sessions 9–12** built the agent surfaces: the orchestrator goal
  loop (`agent_queue`, pure decision-maker, zero tools), the
  operator-configured MCP client (allowlist-before-I/O, stdio + http
  transports, credential env indirection), and the A2A server surface
  — all gated, bounded, zero-paid-drilled.
- **Sessions 13–18** built the trust/module architecture: the design
  record `docs/architecture/WORKSPACE_AND_MODULES.md`, the hardened
  single write path (sourceNodeIds format + existence enforcement),
  the Tier-3 workspace + lineage (park/seed), the module registry +
  module #0 (composed-prompt byte pin), the promotion path (the only
  Tier-3→Tier-1 bridge), and module registration as graph entities the
  sweep can contest.
- **The module #1 turn (PR #45)** exposed PROVENANCE LAUNDERING
  (real-but-unrelated hashes cited under a count incentive);
  **Session 19** answered with grounded authoring (harness holds the
  pen: pinned citations, anchor gate, draft scanner) and the citation
  A/B eval (only semantic entailment catches laundering — never reward
  citation count).
- **Sessions 20–23 + the pillar**: `docs/architecture/CODE_MEDIATED_TEXT.md`
  ratified (the model never counts, never copies; tooling shape
  enforces, prompts reinforce); the editing toolkit
  (`trellis_textedit`, operator-gated, hash-guarded); the kernel
  CODE-MEDIATED TEXT block; the effective-context probe rounds 1–3
  over durable corpora (frank/chronicle/ledgers/relational) — found
  and closed the transcription channel (`trellis_answer`, Session 22)
  and characterized the localization miss class over the glued
  reconstruction (Session 23) that Session 24 then fixed.
- **Session 24 (PR #62)** closed the localization class structurally:
  `trellis_postgres.get_ast_blocks(root_hash)` returns a document's
  extraction blocks IN ORDER as `{id, type, text}` (the walk in the
  stdlib-only `src/rlm/trellis_blocks.py`, parity-pinned against
  `collectExtractionBlocks`/`nodeText` by `block_parity.test.ts`; no
  stored or reconstructed byte moved); both composed-prompt pins moved
  wittingly to teach it; pillar §7's "pandas default" demoted to
  "plain loops until a measured threshold" per its own contingency.
  The owner-approved round-4 re-measure ($0.9452, 36 runs) read 0/36
  localization misses vs round 3's 7/30, with 36/36 accessor adoption
  in BOTH arms — tooling shape, not the prompt block, carries the
  behavior; the reconstruction-byte row stays SUPERSEDED and closed.
- **Session 25 (PR #63)** turned the July 6 pilot's three recorded
  blockers into machinery, zero-paid: the kernel-fixed test/fixture
  extraction exclusion (`isTestOrFixturePath` in
  `src/core/repository/paths.ts` — classified files still ingest but
  extraction is forced to `none`, typed `test_fixture_excluded`
  counts everywhere), additive `sourceKind`/`language` payload routing
  selecting a code-tuned extraction prompt (`extraction_job.ts`;
  legacy prose bytes unit-pinned, unknown values refused loudly), and
  deterministic generic-identifier suppression before resolution
  (`generic_suppression.ts`: 22-entry kernel denylist + length-<3
  shape rule + touched-relationship and generic-unresolved-endpoint
  drops, counted and logged, never silent). The owner-approved pilot
  re-run measured the machinery live ($0.28, 103/103 jobs, max hub
  cardinality 3.5× lower, zero denylist names with pilot provenance);
  cleanup tombstoned + swept, all pilot entities contested.

- **Session 26 (PR #64) + the July 11 follow-ons (PRs #65/#66)**: the
  Trellis-edits-Trellis proof runs (six spawns ≈$0.58; three
  human-reviewed edits landed, including a graph-aggregation edit
  whose replacement phrase was built entirely in code; run 2 FOUND A
  REAL KERNEL DEFECT — `splice` refused "\r" alongside "\n", making
  CRLF files impossible to line-replace — fixed to refuse only "\n",
  regression-pinned `test:textedit` 81 → 82) and module #2
  `estimation-discipline` authored through grounded authoring ($0.122,
  anchor gate 0.36 first try, registered but never in the default
  selection; retired by Session 28's control). The follow-on PR #65:
  the wall-clock engine benchmark (`bench_wallclock_text.py`,
  ~100k–8M tokens: insertion stays Python-native at EVERY size,
  no crossover; disambiguation/regex are polars territory —
  `docs/benchmarks/WALL_CLOCK_TEXT_OPS_REPORT.md`, pillar §7
  postscript) + the expansion series W1–W4 (the first RLM SOURCE-CODE
  edit, `check_python_runtime.py`; the W4 adversarial containment
  probe — both path-escape refusals held LIVE, zero writes). PR #66
  recorded the toolkit coverage audit that became Session 29's
  worklist. Owner precedents set here: a 2-million-token FLOOR for
  synthetic tests; every edit-run diff human-reviewed; the toolkit
  never touches git.

**Session 27 (July 11, 2026, PR #67) is also complete: the
data-plane representation verdict recorded and its prerequisites
pinned** (roadmap §4 row 6a — the July 11 owner-commissioned
Polars/Arrow review's three adopted recommendations plus the
recommendation-5 doctrine line, all zero-paid; the review's verdict:
NO migration at any of the six data-plane boundaries — JSON/list/dict
contracts stand everywhere; structure selection is operation-shaped,
not size-shaped). **(1) The polars pin:** `polars==1.34.0` joined
`requirements.txt` (comment: engine-side analytics tier, pinned NOT
adopted — no kernel, contract, or prompt path imports it) and the
`python:check` import list (the pandas precedent: a broken environment
fails the check, not a paid run); the Compose integration gained an
in-container `import polars` probe asserting the exact pinned version
(10 → 11 assertions) — the found prose-vs-manifest inconsistency is
closed and `bench_wallclock_text.py` is now runnable in-container.
**(2) The pillar §7 verdict paragraph** (docs-only, both
composed-prompt pins unmoved): contracts stay JSON at every boundary;
Option C rejected by the §4.5 data-not-objects doctrine, Option B
unjustified at the 4–32 MiB caps, canonical JSON byte-deterministic
where Arrow IPC is not; plus the cap-raise doctrine — approach the
32 MiB cap ⇒ re-run the M1 drill at the target size BEFORE raising
caps; a migration re-enters only through the review's benchmark
matrix and adoption thresholds with owner sign-off. **(3) M1/M7
standing fixtures:** `test:rlm-workspace` sections [7]/[8] (86 → 106
checks, pure stdlib): M1 park/seed round-trips byte-lossless at
EXACTLY 4 MiB / 32 MiB / 1024 segments with cap+1 refusals
(consistent-stamp one-byte growth ⇒ byte-budget raise; synthetic
1025th segment ⇒ segment-budget raise; timings PRINTED never
asserted — 32 MiB parks in ~84 ms); M7 per-field torn-payload
refusals (non-string content, non-bool truncated, missing argsHash,
non-string fetchedAt — extending, not duplicating, section [6]'s
small-size pins), torn/wrong-version re-proven at the 4 MiB cap size,
and the canonical-form determinism pin (parse + re-serialize
byte-identical) at all three cap shapes. The probe report was
verified to carry NO container-availability claim, so it was left
untouched per §4(d)'s verify-first instruction. No defect found.
Compose ran isolated as `trellis_s27_ci` (pip layer rebuilt as
predicted, npm layers cached); `drill:scale` 1.99x CLOSED (in-band).
Zero paid spend.

**Session 28 (July 11, 2026, PR #68) is also complete: the
estimation-discipline positive control — machinery AND the measured
control** (roadmap §4 row 6; the measurement ran the same day under
the session's standing owner approval of paid/owner-gated tests).
**(1) The probe module-arm flag** (`TRELLIS_EXP_MODULES`, the
`TRELLIS_EXP_OMIT_CMT` mold): the new pure
`src/benchmarks/effective_context/module_arm.ts` resolves it in the
probe runner ONLY — unset composes the byte-identical historical
spawn value `'["spatial-flywheel"]'` (pinned); a JSON array REPLACES
the spawned agent's `TRELLIS_MODULES`, validated through the ORDINARY
`parseModuleSelection` + `loadModules` registry path BEFORE any spawn
(malformed JSON / unknown / contested modules refuse the invocation
spawn-free, verified live). `armEnv` deletes the flag from the child
env; `buildAgentEnv` deletes it unconditionally (no config field —
unit-pinned mirroring `TRELLIS_EXP_OMIT_CMT`). NO kernel change; both
composed-prompt pins unmoved. **(2) The `est` suite** (additive —
every earlier suite's question bytes untouched, rounds 1–4 stay
round-comparable; shared preambles extracted byte-identically): five
sufficiency-bounded TWO-PART questions whose parts share ONE read,
over the four durable corpora; truths + recorded minimal-evidence
bounds (1 db call each) in the pure
`src/benchmarks/effective_context/estimation_suite.ts`, unit-pinned
from committed bytes (Kelvorin 163/Torulf 125; anomaly 8 → Entry 9;
frank → Chapter 5/Ingolstadt 16; Zelvane Wendrick × morrowleaf →
1046/13; Glasswind → 41,793 crates/4 captains; scored-pair
distinctness enforced loudly). `test_modules.py` gained section [8]
(post-retirement: pins the loader REFUSING the retired module #2, the
historical manifest record, and the parse-vs-load distinction). **(3) The measured control:
50 runs, $2.3981 (vs the ~$1–2 estimate, disclosed), 10 chunked
question×arm invocations, `--repeats 5`, both arms the pinned default
kernel. Correctness 25/25 BOTH arms; median db calls on 1 vs off 2
(the targeted behavior moved — frank median halved 4 → 2,
minimal-evidence attainment 15/25 vs 10/25); pooled median input
tokens on 13,240 vs off 9,217 — the token half of the pre-stated
criterion FAILS pooled, REVERSING on the two largest-corpus questions
(led-captain 13,268 vs 19,335; rel-guild 23,033 vs 29,287). Verdict
per the recorded rule: criterion NOT met — and the owner ADJUDICATED
in-session the same day: module #2 RETIRED outright (manifest status
`retired`, loader refuses composition — `test:modules` [8] pins the
refusal; the graph entity survives as the historical record), with
the broader direction that behavioral failure classes close by
TOOLING SHAPE, not prompt modules — prompt-module authoring is
DEPRIORITIZED as a capability increment, and the recorded successors
are kernel-level retrieval dedup/budgets (the `est` suite is their
acceptance harness) and mechanical provenance threading (roadmap §5
July 11 addendum)** (report: the probe report's control section;
RESEARCH.md measurement + retirement sections). All 50 runs submitted through `trellis_answer`
(230/230 cumulative, zero transcription errors); zero pandas/polars.
Defect found by the zero-paid drill in this session's own new code
before any spend: the est branch never assigned `relationalData` and
an `&&`-guard silently emptied the question set — fixed, and the
guard now refuses loudly. `drill:scale` read 2.65x CLOSED (outside
the ~1.48x–2.26x band → re-run per precedent → 1.77x CLOSED in-band,
non-reproducing). Compose isolated as `trellis_s28_ci`: 11/11, all
layers cached. Total Session 28 paid spend: $2.3981.

**Session 29 (July 12, 2026, PR #71) is also complete: self-editing
toolkit coverage hardening** (roadmap §4 row 8 — the July 11 coverage
audit's recorded priority items, all zero-paid, three commits).
**(1) CI wiring (audit #7):** `.github/workflows/ci.yml`'s `offline`
job now runs `npm run test:textedit` directly after the
Python-runtime install step — the toolkit drill is
regression-detected. **(2) `write_back` hardening (audit #2/#3/#4;
kernel change, witting, its own commit; the contract UNMOVED:
`StaleFileError` semantics, temp + rename atomicity, the Session 26
splice semantics, `TEXTEDIT_ADDENDUM` bytes, and BOTH composed-prompt
pins untouched):** (a) write-time containment re-verification — the
load-time `_resolve` re-run against the CURRENT filesystem (never a
second implementation): a parent symlink swapped in after load
refuses at write time, and a path that resolves DIFFERENTLY than at
load refuses as stale even on identical bytes (the in-root swap the
digest guard alone cannot see); (b) source-mode preservation onto the
replacement inode (`stat.S_IMODE` + `os.chmod` on the 0600 mkstemp
temp — the executable bit on a script or hook survives edits; Windows
mode bits are a harmless no-op); (c) the NARROWED TOCTOU window — a
final digest re-check immediately before `os.replace`, so a second
writer landing while the temp file was being built is DETECTED
(StaleFileError, temp unlinked, disk untouched) instead of silently
overwritten. Honest residual, documented in the docstring and pillar
§6 item 1, never claimed closed: the race between the final re-hash
and the replace remains — full elimination needs OS file locking,
deliberately out of scope. **(3) The drill grew 82 → 105 checks
(Windows host; 106 on POSIX, where the executable-bit check also
runs):** section [11] pins each hardening behavior, including
deterministic second-writer detection (a wrapped `mkstemp` lands the
mutation inside the narrowed window) and no-orphaned-temp-on-refusal
(the refusal-path half of audit #10); section [12] pins multi-file
partial failure as INTENTIONAL per-file independence in both orders
(audit #5); section [13] adds one adversarial check per previously
untested guard branch (audit #6: boolean line/splice indexes, a
boolean constructor bound, non-string pattern/path/new_lines-element,
reload-discards-staging — each fails if its branch is deleted) plus
the audit-#8 static pin: the toolkit's imports must stay inside an
exact stdlib allowlist and its source must carry no git or subprocess
token. Audit disposition: #2 narrowed + documented, #3–#8 closed,
#10 half-closed, #9 stands on the Session 26 W4 live refusal, #1
(the cross-process proof run) stays owner-gated propose-with-estimate.
No defect found in existing code — every pre-existing guard held
under the new adversarial checks. `drill:scale` read 1.97x CLOSED
(in-band, no re-run needed). Compose isolated as `trellis_s29_ci`:
11/11, all layers cached. Zero paid spend.

**Session 30 (July 12, 2026, PR #72) is also complete: mechanical
provenance threading — the design record + retrieval-set tracking**
(roadmap §4 row 9 slices (a) + (b), all zero-paid, two implementation
commits). **(1) Slice (a):** `docs/architecture/PROVENANCE_THREADING.md`
ratified (indexed in docs/README.md), document-first in the house DDD
pattern. Its load-bearing decisions: the threat model is a TWO-CHANNEL
taxonomy — T1 transcription/choice (the model retypes an address:
corrupted digits, scrollback memory, second-hand citation of another
edge's provenance list) vs T2 semantic laundering (retrieved bytes
cited for a claim they do not support — the A/B eval measured the
readership gate flagging ZERO laundered runs because the model reads
the decoy then cites it; only entailment catches T2). The slice-(d)
constraint closes T1, NOT T2 — recorded explicitly so nobody later
claims more than the machinery delivers. The claim→block
factorization: membership (`cited ⊆ retrieved(run)`) is
engine-decidable and made total; support is structurally NOT
engine-decidable (a claim is new text — no taint trail through
attention), so it is sampled (slice e; detector-not-gate, flagged
edges enter the ordinary contested machinery). The retrieval set:
`get_ast_texts` returned keys + `get_ast_blocks` returned block ids
(never the root argument) + `vector_search` result ids; NEVER
`ast_hashes_exist` (probe-then-cite loophole), `fetch_texts`,
`run_cypher` (a `sourceNodeIds` property in a query result is a
reference to bytes, not the bytes), Tier-3 surfaces, or seeded
snapshots (a seeded run inherits NOTHING; a re-derivation
re-retrieves). Semantics: per run = per process, monotone, dies with
the process, never parked. Slice (d)'s recorded shape: membership
check after format + existence, typed bounded refusal teaching
re-retrieval, wired by the `ast_existence_check` injection mold (bare
construction unaffected), write-time only (existing rows never
migrated). **(2) Slice (b):** the always-on `_retrieved_addresses`
set in `trellis_tools.py`, fed INSIDE `_audit_add` for the
`read`/`search` buckets — the exact seam the opt-in citation audit
already maintains at the three call sites; one function, one lock, no
parallel instrumentation; the `cited` bucket never feeds it; the
audit's opt-in gating and `get_citation_audit` are byte-unchanged.
Accessors return a copy + a count; `TRELLIS_TELEMETRY` gains
counts-only `retrieved_addresses` (both research and author payloads;
the scanner's unknown-field tolerance is now pinned explicitly —
`rlm_telemetry.test.ts` 9 → 10). NO write-path behavior change, NO
prompt bytes — both composed-prompt pins unmoved. **(3) Pins:**
`test:rlm-sandbox` [5], 21 → 40 checks live: cypher/existence/cited
writes contribute nothing (including a live Cypher read that
demonstrably surfaces the probe hash as a provenance property);
returned-keys-only; repeat-inert; block-ids-not-root; vector_search
drilled ZERO-PAID (probe row with deterministic 1536-dim embedding +
`openai` stubbed in `sys.modules` — the in-function import binds the
stub, cosine distance 0 makes the probe the top hit); copy semantics;
audit-buckets-empty-while-set-populated (the gating separation); and
audit-#8-mold static pins (Tier-3 modules never reference the seam;
the agent telemetry dict carries the field). `drill:scale` 1.89x
CLOSED (in-band, first try). Compose isolated as `trellis_s30_ci`:
11/11, no manifest changed. No defect found; section [5] passed on
first run. Zero paid spend.

**Session 31 (July 12, 2026, this PR) is also complete: mechanical
provenance threading — the slice (c) adjudication + the slice (d)
write-path constraint** (roadmap §4 row 9, all zero-paid, three
commits: the verdict, the gate, the pins). **(1) Slice (c)
ADJUDICATED: SATISFIED BY EXISTING SHAPE** — verdict + evidence
recorded in `PROVENANCE_THREADING.md` §9 (dated, amending §5.2), every
claim verified against the named code: the three retrieval tool
returns already thread address-with-content (`get_ast_texts`
hash-keyed map, `get_ast_blocks` `{id, type, text}` per block,
`vector_search` `{id, content}` rows); the workspace holds no Tier-1
retrievals by construction (`capture()` is invoked from exactly one
place — inside `trellis_mcp.call_tool` — so segments hold MCP results
only; database reads return directly to the REPL; `add_note` is
model-authored Tier-3 by design; a "gap" would have meant BUILDING a
new carriage surface, which the adjudication was explicitly not
permitted to invent); the rlms scaffold performs no separate rendering
of tool results (`local_repl.py execute_code` → `REPLResult`: the
transcript sees only the model code's own stdout/stderr); the author
path is engine-stamped (16-hex block-hash argsHash pointers) and
write-free. No carriage gap, no implementation, no prompt byte; the
§5.2 constraint (headers engine-stamped, never model-written) survives
for any FUTURE surface. **(2) Slice (d) — the retrieval-membership
write gate** (implemented exactly as the record §5.3 specified, not
re-designed): `TrellisNeo4j` gains `retrieved_addresses_check` — a
constructor seam in the `ast_existence_check` injection mold, a
callable returning the run's current retrieved-address set (slice
(b)'s `get_retrieved_addresses`, a copy per call). The new
`_verify_hashes_retrieved` runs in `_run_insight_writes` AFTER
`_verify_hashes_exist` and the cited-attempt audit (the A/B eval's
measure-the-attempt discipline) and BEFORE the experimental
hint/entail gates — order pinned: format → existence → retrieval
membership → experimental gates → write. The refusal is a typed
`ValueError`: "Provenance Violation", the unretrieved hashes bounded
(first 5 + `+N more`), the teaching remedy (call `get_ast_texts`,
confirm the bytes support the claim, re-derive and cite). One
unretrieved hash refuses the whole batch before any session opens;
fail fast, no partial write. Wired in `trellis_agent.py` for research
runs beside `ast_existence_check`; bare `TrellisNeo4j(...)`
construction (operator scripts, drills, harness paths) is
byte-identical. HONEST SCOPE: T1 closed (transcription/choice), T2
NOT closed (read-then-cite laundering — slice (e)'s sampled
entailment). `TRELLIS_CITATION_HINT` untouched (different set,
different gating — the A/B artifact). NO prompt bytes; both
composed-prompt pins unmoved; no telemetry beyond slice (b)'s count.
**(3) Pins:** `test:rlm-sandbox` new section [6], 40 → 53 live checks,
all green on FIRST run: refusal message anatomy (offender named,
teaching sentence), no partial graph state after refusal, bounded echo
at seven offenders (`+2 more`), check order (a nonexistent hash
reports the EXISTENCE violation, never the retrieval one), the cited
bucket records the refused attempt when the audit is enabled, the
taught remedy WORKS (the same write succeeds after `get_ast_texts`),
whole-batch refusal with the graph verified empty, the injection-mold
pin (bare construction writes an unretrieved hash exactly as before),
and the agent-wiring static pin. Sections [1]–[4] keep their
existence-only client deliberately (they write before anything is
retrieved) — its stale "the trellis_agent.py wiring" comment was
corrected. `drill:scale` 2.09x CLOSED (in-band, first try). Compose
isolated as `trellis_s31_ci`: 11/11, all layers cached (no manifest
change). No code defect found; one DOC defect found and fixed (the
roadmap §5 intro paragraph had not been updated when the Session 25
entry moved with the Session 30 PR). Zero paid spend.

OpenCnid selected the MIT License on July 6, 2026.

Your objective is **Session 32: mechanical provenance threading
FINISHES — the slice (e) sampled-entailment detector (machinery
zero-paid; the measured sweep owner-gated propose-with-estimate) + the
slice (f) compat verify-and-strike** (roadmap §4 row 9 — the row's
remainder under the owner-approved July 12, 2026 sequence; row 7 stays
trigger-blocked and rows 10/11 come after), per §3–§6 below. The
machinery and its oracle-mode drills are zero-paid; the first real
judged sweep is owner-gated. Do not re-plan or re-implement completed
work. RLM expands exclusively to Recursive Language Model (the MIT
CSAIL formulation).

---

## 0. The handoff loop (permanent — preserve this section in every rewrite)

This file is both the prompt that starts a session and the final deliverable
that session must produce. Trellis itself caches derived insights so repeat
queries get cheaper; this file does the same for engineering sessions. The
loop:

1. **Execute.** Study the repository and `TRELLIS_ROADMAP.md`, present the
   design for the objective in §3–§4 below, implement it, and pass every
   acceptance check in §6.
2. **Record.** Update `TRELLIS_ROADMAP.md`: mark the completed item(s) only
   after acceptance, and add a full-dated §5 progress entry with the exact
   commands run and counts observed, including any defects found along the
   way and how they were fixed.
3. **Regenerate.** Rewrite THIS file for the next session, in the same PR as
   the implementation:
   - Take the next objective from the first unstruck row of the roadmap's §4
     Suggested Sequencing table. If something discovered during this session
     should jump the queue (a correctness defect, a broken invariant), pick
     that instead and record the reason in the roadmap.
   - Update the session list above and §1 (mental model) with whatever
     architecture this session added.
   - Update §2 (baseline) with the new `master` commit, offline test counts,
     and live-check counts.
   - Replace §3–§6 with the next objective's specifics at the same level of
     concreteness as this file: a problem statement grounded in named
     files/functions, a recommended design with module names, an explicit
     offline/live test list, and the close-out command block.
   - Re-scope §7 (guardrails) and §8 (exclusions). Guardrails that encode
     permanent invariants (AST immutability, provenance, Zod boundaries,
     process split, no attribution) survive every rewrite.
   - Preserve THIS §0 verbatim.
   - The rewritten file must be fully self-contained: the next session starts
     with zero context beyond this repository.
4. **Ship.** One feature branch, one PR to `master`, plain engineering prose,
   no AI attribution or generated-by trailers anywhere (commits, PR bodies,
   code comments).
5. **Re-run the loop for late work (the event-loop rule; added by owner
   direction, July 9, 2026 — part of the permanent protocol from here on).**
   Regeneration is not a one-shot close-out. If further work lands in the
   same working period AFTER this file was rewritten — an owner-approved
   paid run, a follow-up fix, a new design record — re-run step 3's
   objective selection against what that work revealed before handing off.
   A defect discovered in a pathway the flywheel or the next objective
   depends on satisfies the jump-the-queue rule even when an existing gate
   contained it: containment is not remediation. Pointer edits to this file
   are not a substitute for re-selecting the objective. A handoff whose §3
   objective is stale relative to the session's own findings has not
   finished step 3. (Origin: the module #1 laundering finding and its
   design record initially landed as standing-item pointers while §3 still
   named the pre-finding objective; the owner corrected the priority.)

A session that completes its objective but does not regenerate this file has
not finished.

---

## 1. Architectural mental model

Trellis's core invariant is that every semantic fact remains traceable to an
immutable, content-addressed physical location in source material.

1. **PostgreSQL + pgvector — physical layer**
   - `ast_nodes` stores immutable Merkle AST nodes and optional embeddings.
   - `documents`/`document_nodes` store stable document keys, version
     history, and per-root membership (global source liveness checks).
     Since Session 17 `documents` also carries a nullable `origin JSONB`
     column — the promotion audit stamp (which server/tool/args produced a
     promoted document's bytes, fetched when); only segment promotion
     writes it, inside the ingest transaction.
   - `repository_snapshots`/`repository_snapshot_paths` (Session 8) record
     which paths each published repository snapshot contained.
   - Durable measurement substrate (Sessions 21–23):
     `data/frankenstein.txt` and `data/synthetic_chronicle.txt`
     (committed, byte-stability unit-pinned, `.gitattributes -text`) are
     ingested as `book:gutenberg-84:frankenstein` and
     `book:synthetic:ninth-circuit-chronicle`; the 40 deterministic
     ledgers (`src/benchmarks/effective_context/synthetic_corpus.ts`,
     seeded generator, concat sha unit-pinned) as
     `ledger:synthetic:house-01…40`; and the Session 23 relational
     corpus (`relational_corpus.ts`, seeded, concat sha `3bbbea18…a697`
     unit-pinned) as `ledger:synthetic:s2-house-001…100` +
     `registry:synthetic:captains` + `tariff:synthetic:port-schedule`
     (all extraction `none`, no embeddings) — the effective-context
     probe's corpora, deliberately NOT drill residue. The three promoted
     research docs
     `research:trellis/workspace-discipline/{contract,evidence,code-mediated-text}`
     are module #1's corpus documents. NOTE (measured Sessions 22–23):
     the root-hash reconstruction (`nodeText`/`get_ast_texts`)
     concatenates paragraph blocks with UNMARKED boundaries — it breaks
     BOTH line-anchored parsing AND trailing word boundaries (`\d+\b`
     fails at glued digit→letter junctions); parse by shape without
     trailing `\b` (the `parseLedgerRecords` precedent). Session 24
     fixed the localization class structurally WITHOUT touching those
     bytes: `get_ast_blocks(root_hash)` returns the ordered blocks
     directly, so structure never has to be re-derived from the glue —
     measured (probe round 4): 0/36 misses vs round 3's 7/30, 36/36
     accessor adoption. The reconstruction-byte change is SUPERSEDED
     and stays closed (it re-enters only if a future measurement finds
     the accessor insufficient).
   - The verified ingest transaction lives in `src/core/ingestion/`
     (`ingest_document.ts`: persist → read-back re-hash verification →
     membership → registration → in-transaction Merkle diff;
     `plan_ingest.ts`: explicit `none`/`changed` extraction policy with a
     hard block budget). `POST /ingest` is a thin delegate; tombstones are
     ordinary ingests of a deterministic empty root. Schema bootstrap is
     serialized by `pg_advisory_xact_lock`; Neo4j bootstrap retries
     transient label-lock deadlocks and creates `entity_name_index`.
   - **The promotion path (Session 17; `src/core/promotion/`):** the ONLY
     route from Tier 3 to Tier 1. `plan_promotion.ts` (pure planner:
     typed refusals for truncated/empty/unknown segments and bad doc
     keys; content byte-verbatim; doc keys operator-explicit with the
     `mcp:<server>:<tool>:<argsHash>` fallback offered, never applied
     silently) + `promote_segment.ts` (one planned request through the
     unmodified verified transaction, returning the citable block
     hashes) + the operator CLI `npm run promote` (list/promote over
     PARKED snapshots only, zero-paid default, `repo:ingest`-style
     extraction double gate). Because the doc key is stable,
     re-promoting refreshed external content versions the document and
     the existing Merkle-diff → sweep machinery contests stale beliefs
     for free. Drill: `npm run test:promotion`.
2. **Neo4j — semantic and belief layer**
   - `Entity` and `Conflict` nodes plus `ACTION`, `CONTRADICTS`,
     `DERIVED_INSIGHT`, `SAME_AS`/`DISTINCT_FROM` edges, all carrying
     `sourceNodeIds`. `contested`/`contestedAt`/`orphanedSourceIds`/
     `rederivedAt` form the audit-preserving quarantine/recovery state
     machine (`src/core/graph/provenance.ts`).
   - Entity identity is immutable; equivalence is an overlay belief.
     Retrieval expands one trusted `SAME_AS` hop with per-fact `viaAlias`.
   - **Extraction (Sessions 1/8/25):**
     `src/workers/extraction_worker.ts` consumes `extraction_queue` jobs
     `{astNodeId, text, sourceKind?, language?, ...}` enqueued by the
     verified ingest path when the operator selected extraction policy
     `changed`: pure payload parsing (`parseExtractionJobData` in
     `src/workers/extraction_job.ts` — unknown sourceKind/language
     refused loudly BEFORE any I/O; absent field = legacy) → liveness
     gate → one completion with the routed prompt
     (`buildExtractionPrompt`: `code` selects the Session 25 code-tuned
     API-level prompt; `prose`/absent compose the EXACT legacy
     document-generic bytes, unit-pinned; `GraphSchema` via
     `zodResponseFormat`, crossing `parseLlmResponse`) →
     `suppressGenericIdentifiers` (Session 25,
     `src/core/graph/generic_suppression.ts`: kernel denylist +
     length-<3 shape rule + touched-relationship and
     generic-unresolved-endpoint drops, counted in
     `trellis_extraction_suppressed_total{kind}` and logged, never
     silent; drops CANDIDATES only, never graph nodes) →
     `resolveExtractedGraph` →
     `mergeWithAstLivenessFence(mergeExtractedGraph)` (ON MATCH mirrors
     the quarantine/recovery semantics; dropped actions are counted and
     logged, never silent) → per-block embedding. Repository snapshots
     stamp sourceKind per file language (`sourceKindForLanguage` in
     `snapshot_ingest.ts`) and force policy `none` for
     `isTestOrFixturePath`-classified files (ingest everything, extract
     selectively — typed `test_fixture_excluded` counts in the plan
     echo, the summary, and metrics). Extraction spend is
     always operator-gated (`plan_ingest.ts`: policy `none` default;
     `changed` needs an explicit block budget, and `repo:ingest` adds
     `--confirm-extraction`).
   - **Session 14 (kernel):** the single agent write path
     (`write_derived_insight`/`write_derived_insights` →
     `_normalize_fact` → `_run_insight_writes` in
     `src/rlm/trellis_tools.py`) ENFORCES provenance: every
     `sourceNodeIds` element must match `^[0-9a-f]{64}$` AND exist in
     `ast_nodes` (deduped batch union, checked via the injected
     `ast_existence_check` before the WRITE session opens). "An AST hash
     means verified ingested bytes" is enforcement, not convention.
     Never weaken or make this configurable. **Sessions 30–31 sit
     beside it:** the run's retrieved-address set
     (`docs/architecture/PROVENANCE_THREADING.md`) is recorded
     engine-side, always on — `get_ast_texts` returned keys,
     `get_ast_blocks` block ids, `vector_search` result ids, fed inside
     `_audit_add` at the citation-audit seam; `ast_hashes_exist`,
     `fetch_texts`, `run_cypher`, Tier-3 surfaces, and seeds NEVER
     contribute; accessors `get_retrieved_addresses()` (a copy) /
     `get_retrieved_address_count()`; counts-only `retrieved_addresses`
     telemetry. Session 31 activated slice (d) on top: research runs
     construct `TrellisNeo4j` with
     `retrieved_addresses_check=get_retrieved_addresses` (the
     `ast_existence_check` injection mold), and
     `_verify_hashes_retrieved` in `_run_insight_writes` refuses any
     batch citing an address outside the run's set — a typed bounded
     "Provenance Violation" teaching re-retrieval, order-pinned format
     → existence → retrieval membership → experimental gates → write,
     the cited audit recording the attempt before the refusal, the
     whole batch refused before any session opens. Bare construction
     (drills, operator scripts) passes None and writes exactly as
     before. T1 is CLOSED; T2 (read-then-cite laundering) stays slice
     (e)'s sampled entailment — never claim more.
   - **Module entities (Session 18; `src/core/graph/module_registration.ts`
     + `scripts/register_modules.ts`):** each research-bearing ACTIVE
     module manifest is registrable as
     `(:Entity {kind: 'module_manifest', name: 'module:<name>'})` whose
     `sourceNodeIds` are the manifest's research hashes
     (existence-gated against `ast_nodes` before any write) and whose
     ON MATCH mirrors `applyRederivation` — so the unchanged sweep
     contests a capability when its research basis changes, and
     re-registration after re-review recovers it. `npm run
     modules:register` / `npm run modules:verify` are operator tooling
     in the `repo:ingest`/`promote` mold: no API endpoint, never worker
     startup, never reachable from a model completion. Contested/retired
     manifests are skipped by registration (no silent un-contest);
     empty-research module #0 registers nothing. Like every Entity,
     module entities are contested/retired, never deleted (drills clean
     up only their own token-scoped names).
3. **Redis + BullMQ — asynchronous layer**
   - Seven queues: `extraction_queue`, `rlm_queue`, `supervisor_queue`,
     `invalidation_queue`, `verification_queue`, `resolution_queue`, and
     `agent_queue`. `rlm_queue` and `agent_queue` use interactive no-retry
     job options (an interrupted paid run must not silently re-spend); the
     rest use bounded retries. All LLM calls live inside BullMQ workers or
     the RLM process; every worker-consumed completion crosses
     `parseLlmResponse` (`src/core/llm/boundary.ts`).
   - **Scratch parking (Session 16):** `scratch:goal:<goalId>:task:<taskId>`
     holds one task's end-of-run workspace snapshot, TTL-bounded
     (`SCRATCH_TTL_SECONDS`) and volume-capped per goal
     (`SCRATCH_MAX_BYTES_PER_GOAL`). Redis is a parking lot for
     checkpoints, never a live store the model queries. Pure helpers
     live in `src/workers/workspace_scratch.ts`; all I/O is in
     `rlm_worker.ts`. Promotion consumes these parked snapshots — TTL
     expiry is BY DESIGN; anything worth keeping is promoted, not
     parked longer.
4. **RLM execution, the agentic loop, and external surfaces**
   - `GET /api/rlm-stream` (API-key gated, `StreamGate` + queue-depth
     backstop) subscribes to `rlm-stream:<jobId>`, then enqueues one
     `rlm_queue` job. `src/workers/rlm_worker.ts` spawns one Python process
     per job (`trellis_agent.py`) with config forwarded via env by the pure
     `buildAgentEnv` helper in `src/workers/rlm_job.ts` (`NEO4J_*`,
     `PG_DSN`, `PYTHONPATH`, the canonical `TRELLIS_MCP_SERVERS` registry,
     exactly the credential env vars the registry's http servers name,
     the validated workspace bounds, the canonical module selection, and —
     Session 20 — the textedit root + bounds exactly when the operator
     set `TRELLIS_EDIT_ROOT`; unset config values are stripped, never
     passed through raw). `buildAgentArgs` forwards `--max-iterations`,
     `--goal-id`, and (Session 16) the worker-named
     `--workspace-out`/`--seed-workspace` temp files — a queue payload
     can never pick filesystem paths. The worker publishes every stdout
     chunk and feeds two pure bounded scanners over the identical bytes:
     `RlmTelemetryScanner` (`TRELLIS_TELEMETRY:` spend line) and
     `RlmResultScanner` (`TRELLIS_RESULT:` task envelope
     `{status, answer, toolCalls}`). Job payloads are normalized by
     `parseRlmJobData`: pre-Session-9 `{query, jobId}` still processes;
     optional `goalId`/`taskId` correlation, `maxIterations`, `seedTasks`
     (ids only, never content), and a data-only `stub` replay mode (whose
     optional `workspaceSnapshot` parks through the identical path) for
     zero-LLM drills. Payloads carry nothing MCP-, workspace-content-, or
     textedit-shaped (unit-pinned).
   - `src/rlm/trellis_agent.py` wraps the `rlms` recursive-LM library
     (model `gpt-5.4-2026-03-05`, `max_depth` 1) and injects tools via the
     rlms `custom_tools` mapping — `trellis_neo4j` (read-only Cypher plus
     the hardened single write path), `trellis_postgres`
     (`get_ast_texts`, `get_ast_blocks` — Session 24, a document's
     extraction blocks in order as `{id, type, text}`, the walk in the
     dependency-free `trellis_blocks.py` parity-pinned against
     `collectExtractionBlocks`/`nodeText` by `block_parity.test.ts` —
     `vector_search`, and `ast_hashes_exist` — write-path plumbing,
     never tool-call-counted), `trellis_answer`
     (Session 22 — see the next bullet), and — only when the
     operator configured servers — `trellis_mcp`
     (`src/rlm/trellis_mcp.py`), an MCP client over the pinned
     `mcp==1.12.4` speaking protocol revision 2025-06-18: allowlist
     BEFORE any I/O, double-bounded per-call timeouts,
     `TRELLIS_MCP_TRUNCATED` size caps, credential scrubbing
     (`_scrub`/`_describe_exception`), one transport-aware seam
     (`_dial`). PROVENANCE SPLIT: database tools increment
     `_count_tool_call()`; MCP calls count separately as `mcp_calls` —
     an answer with zero DATABASE tool calls emits
     `TRELLIS_PROTOCOL_VIOLATION` no matter how many MCP, workspace,
     textedit, or answer-channel operations happened. **Sessions
     30–31:** the same module records the run's retrieved-address set,
     and the research write path now consumes it — the agent wires
     `retrieved_addresses_check` at the same construction site as
     `ast_existence_check` (see the Session 14 bullet above).
   - **The by-reference answer channel (Session 22;
     `src/rlm/trellis_answer.py`):** `TrellisAnswer` injected as
     `trellis_answer` in EVERY research run — kernel surface, not
     operator-gated (author mode does NOT carry it; its draft envelope
     is a different contract). `submit(expression_text)` takes the TEXT
     of a Python expression, evaluates it in the calling REPL frame
     (`sys._getframe(1)` — globals AND locals, so nested helpers
     resolve; the caller's `__builtins__` are rlms' safe table, so the
     expression can do nothing REPL code cannot), structurally refuses
     bare literals (`ast.parse`: an expression with no
     Name/Attribute/Subscript/Call is a retyped literal — the exact
     55→47 error class — refused with a teaching message), refuses
     `None` results and over-cap expressions/content (kernel constants
     `ANSWER_EXPRESSION_MAX_CHARS` 400 / `ANSWER_CONTENT_MAX_CHARS`
     64 KiB), renders deterministically (str verbatim, int exact, float
     shortest repr, containers compact JSON), prefixes `FINAL_ANSWER: `
     engine-side, and sets `answer['content']`/`answer['ready']` on the
     LIVE binding read from the caller frame at each call (rlms
     scaffold restore may replace the answer object between turns — the
     holder never caches it). ADDITIVE: direct assignment still works;
     `TRELLIS_RESULT` semantics unchanged; telemetry gains counts-only
     `answer_submits` (the Node scanner tolerates unknown fields).
     Errors are LOUD by construction: a typo'd variable name is a
     NameError traceback, never a silently wrong digit. Pinned by
     `npm run test:answer-channel` (32 checks, real LocalREPL). Measured
     (probe round 2): 57/57 paid runs answered through the channel with
     zero transcription errors.
   - **The Tier-3 workspace (Sessions 14/16;
     `src/rlm/trellis_workspace.py`):** injected as `trellis_workspace`
     when MCP servers are configured OR the run carries `--goal-id` OR
     the run is seeded; otherwise nothing is injected and prompt and
     behavior are byte-identical (pinned by `test:rlm-workspace`). State
     is one plain JSON dict `{version, plan, notes, segments}`. With a
     workspace attached, `trellis_mcp.call_tool` captures every result
     as an origin-stamped uuid4 segment and returns a bounded stub
     (`preview≤500`); the model pulls content deliberately via
     `segment(id)` or fans `llm_query` over segments. Budgets raise
     `WorkspaceBudgetError`; stored state is never silently truncated.
     Lineage: `snapshot()` serializes at task end; `seed_from_snapshot`
     restores parked snapshots at spawn — stamps verbatim, torn and
     over-budget seeds raise before the first turn. The park/seed seam
     is drill-pinned at cap sizes (Session 27, `test:rlm-workspace`
     [7]/[8]: byte-lossless round-trips at exactly 4 MiB / 32 MiB /
     1024 segments, cap+1 refusals, per-field torn-payload refusals,
     canonical-form determinism — parse + re-serialize byte-identical);
     any cap raise re-runs the M1 fixture at the target size FIRST
     (the cap-raise doctrine, pillar §7). Structural
     disjointness: uuid segment ids and 16-hex argsHashes can never
     match `^[0-9a-f]{64}$`, and the hardened write path rejects them
     independently. Tier 3 has NO provenance standing; permanence is
     earned only through the Session 17 promotion CLI. **Session 30:**
     seeded runs inherit NOTHING into the retrieval set (a parked
     snapshot's stubs are Tier-3 content; a re-derive re-retrieves).
   - **CORE PILLAR — code-mediated text (ratified July 9, 2026;
     `docs/architecture/CODE_MEDIATED_TEXT.md`, doctrine on par with the
     provenance invariant):** *the model never counts, and the model
     never copies.* The RLM handles all text through queryable REPL
     structures ("ingestion = pandas"): locations are engine-computed
     and returned by query (transient handles — re-query, never
     remember); existing bytes are moved by code (splice at a computed
     address, hash-guarded write-back), never re-typed through
     attention ("no direct edits, only code edits — rigidly"); the
     model authors only genuinely new text plus the code that
     manipulates everything else. Localization error and transcription
     error (the laundering channel) are the same pathology — attention
     doing code's job. Payoff: effective context bounded by REPL
     memory, not the attention window. Lines locate, blocks mean.
     Enforcement lands as tooling shape (structured ops + hash
     guards); prompts reinforce only. Session 20 implemented §6.1 (the
     editing toolkit) and §6.2 (the kernel prompt hard-rule block);
     Session 21 measured §6.3 round 1 and landed module #1 v2 (§6.4);
     Session 22 measured §6.3 round 2 and closed the answer channel
     (the last unmediated channel) with `trellis_answer`; Session 23
     measured §6.3 round 3 (the relational corpus, the localization
     arm, higher n); Session 24 closed the localization read boundary
     with `get_ast_blocks` (pillar §6 item 6) and demoted §7's
     "pandas default" per its own contingency; Session 27 recorded
     the data-plane representation verdict in §7's orbit (no
     migration at any boundary — contracts stay JSON everywhere;
     polars pinned in requirements.txt as the engine-side tier, NOT
     adopted; cap raises, not representation changes, are the first
     lever). **Sessions 30–31 applied the pillar to the write path:**
     `docs/architecture/PROVENANCE_THREADING.md` (roadmap row 9) —
     addresses travel by plumbing, never by model retyping; slices
     (a)+(b) landed (Session 30), (c) adjudicated satisfied-by-
     existing-shape and (d) live (Session 31); (e)+(f) remain, the
     row's last work. Measured
     standing:
     transcription is CLOSED (144/144 rounds-2–3 runs submitted by
     reference, zero retyped-value corruptions); read-fidelity holds
     (28/28 unmemorized quotes byte-faithful); the structured-frame
     threshold sits ABOVE ~6,900 records / three-way joins /
     one-record-shape corpora (the pandas null result, twice — §7 now
     says plain loops until a measured threshold); localization method
     error over the unmarked-boundary reconstruction (10 misses across
     rounds 2–3) is CLOSED by the accessor — round 4 measured 0/36
     misses with 36/36 adoption in both arms, so the superseded
     byte-change row stays closed; and the residual after
     transcription closes is computing faithfully over the WRONG input
     (one round-3 result-shape miss, submitted same-turn before its
     own evidence printed).
   - **The editing toolkit (Session 20; `src/rlm/trellis_textedit.py`):**
     `TrellisTextEdit` injected as `trellis_textedit` ONLY when the
     operator sets `TRELLIS_EDIT_ROOT` (never a default; never from a
     payload or completion; byte-identical prompt and namespace when
     unset — pinned by `npm run test:textedit`). Every path strictly
     resolves inside the real root: `..`, absolute/rooted paths, and
     symlink escapes are refused before any I/O (note: Python 3.13
     `ntpath.isabs` treats a bare leading slash as drive-relative — the
     toolkit refuses rooted paths explicitly). `load` holds a
     `text.split("\n")` frame + load-time sha256 (the join is the exact
     inverse — an unedited round-trip is byte-identical); `locate`
     returns engine-computed 0-based half-open addresses (bounded hits
     + true total); `splice` stages replacements (lists of strings free
     of "\n" — the frame delimiter; a "\r" is an ordinary byte WITHIN a
     line, so CRLF lines replace byte-verbatim — Session 26 fixed the
     validation that refused "\r" and made CRLF files impossible to
     line-replace, found live by the proof run and regression-pinned;
     addresses are transient — re-locate after each splice);
     `diff` (bounded) / `revert` / `drop` review and manage frames;
     `write_back` re-hashes the disk bytes and RAISES `StaleFileError`
     on mismatch (re-load and re-derive, never retype), else writes
     temp + rename. Bounds: Zod + Python twins
     (`TRELLIS_TEXTEDIT_MAX_FILE_BYTES` default 4 MiB cap 32 MiB;
     `TRELLIS_TEXTEDIT_MAX_FILES` default 16 cap 64); slice (200) / hit
     (40) / diff (400) caps are kernel constants. Telemetry counts only
     (`textedit_ops`/`textedit_files`/`textedit_writes`) — a separate
     counter in the `mcp_calls` mold; toolkit ops never satisfy the
     provenance protocol, and edited file content earns citability only
     through verified ingest/promotion. Session 29 hardened
     `write_back` inside the contract: containment is re-verified at
     write time (the load-time `_resolve` re-run — parent-symlink
     swaps and in-root resolution changes refuse), the source's mode
     is preserved onto the replacement inode, and a final digest
     re-check immediately before `os.replace` NARROWS the
     check-to-replace race (residual window documented, not denied;
     OS locking deliberately out of scope). The toolkit's import set
     is statically pinned to a stdlib allowlist (no git/subprocess
     token — the no-git guarantee is a check now), and the 105/106
     check drill runs in CI's `offline` job. The toolkit never touches
     git; landing is a human PR. The brace-free TEXTEDIT addendum
     composes only when configured. Author mode does NOT inject it.
   - **The module registry (Sessions 15/18; `src/config/modules.ts` +
     `src/rlm/trellis_modules.py`, `modules/<name>/`):**
     `TRELLIS_ADDENDUM` = `TRELLIS_ADDENDUM_BASE` + Σ selected module
     addenda + `TRELLIS_WORKFLOW_RULES`. Selection is operator-owned via
     `TRELLIS_MODULES` (unset ⇒ default `["spatial-flywheel"]`; `[]` ⇒
     base + rules only; max 4/run). PROTOCOL MODULES ONLY this kernel
     edition — manifests declaring tools are rejected. Addendum files
     are brace-free; rubric text enters through the single
     `<<TRELLIS_RUBRIC>>` substitution token. Both validators are
     bound-for-bound twins and normalize CRLF→LF. Session 28 added a
     SECOND experiment flag in the `TRELLIS_EXP_OMIT_CMT` mold:
     `TRELLIS_EXP_MODULES` (read ONLY by the effective-context probe
     runner via `src/benchmarks/effective_context/module_arm.ts`)
     REPLACES the probe's spawned `TRELLIS_MODULES` after full
     registry validation before any spawn — unset is byte-identical
     (pinned), and `buildAgentEnv` deletes it unconditionally. The manifest carries
     `research.sourceNodeIds` (format-checked 64-hex; existence-checked
     at REGISTRATION, Session 18) and `status` (`active`/`contested`/
     `retired`; only `active` composes — and only `active` registers).
     The composed default prompt is pinned at
     `COMPOSED_SYSTEM_PROMPT_SHA256 = 5d27e474…fe2a` (the July 12, 2026
     prompt-engineering pass; the pin constant records its full move
     history in `scripts/test_modules.py` — it moves only with a witting
     kernel change, recomputed in the same commit). The §6.2 block is
     the named constant `CODE_MEDIATED_TEXT_BLOCK` (Session 21), and
     `TRELLIS_EXP_OMIT_CMT=1` (experiment instrumentation ONLY — the
     `TRELLIS_CITATION_*` mold: never set by any default/worker/Compose
     config, `buildAgentEnv` deletes it unconditionally) composes
     exactly that block out (`45987904…0b56`, pinned by `test:modules`
     [7] — purely structural since Session 22: the default kernel minus
     exactly the block, the structure re-proven on every run; kernel
     bug fixes like the answer channel and the accessor land in BOTH
     arms). Module #1 (`workspace-discipline`) is at version 2
     (Session 21: re-authored through grounded authoring with the
     pillar in its corpus; `test:modules` [5] pins name, title,
     version, and the retired mitigation line). Module #2
     (`estimation-discipline`, Session 26) is RETIRED (owner decision,
     July 11, 2026, on the Session 28 control's numbers: both arms
     25/25 correct, db calls median on 1 vs off 2, but pooled input
     tokens on 13,240 vs off 9,217 — criterion not met). Manifest
     status `retired`; the ordinary loader REFUSES to compose it
     (`test:modules` [8] pins the refusal); the graph entity
     `module:estimation-discipline` survives as the historical record.
     The owner's accompanying direction is PERMANENT: behavioral
     failure classes close by tooling shape, not prompt modules —
     prompt-module authoring is deprioritized as a capability
     increment (no new authoring turn without explicit owner request);
     the recorded successors are kernel-level retrieval dedup/budgets
     and mechanical provenance threading (roadmap §5 July 11
     addendum). The corpus docs and RESEARCH.md stay as measurement
     provenance.
   - **Grounded authoring (Session 19; `src/core/authoring/*` +
     `src/core/observability/rlm_draft.ts` + `scripts/author_module.ts`
     + `trellis_agent.py --mode author`):** the kernel mode that drafts
     a protocol module addendum from a FIXED promoted corpus and nothing
     else. Author runs see only `trellis_workspace` (no DB/search/write
     — no DB connection opens; no textedit), work from a block-aligned
     seeded corpus, and emit a hashes-free `TRELLIS_DRAFT` envelope. The
     harness holds the pen: `research.sourceNodeIds` is pinned from the
     corpus block set (`corpus.ts`/`seed.ts`), the authoring template is
     a byte-pinned kernel constant composed from (topic, doc keys), the
     deterministic anchor gate (`anchors.ts`,
     `ANCHOR_COVERAGE_THRESHOLD = 0.3`) refuses a corpus-blind draft,
     and the draft scanner refuses any 64-hex token. `npm run
     modules:author` assembles a directory for human review only — it
     never registers, lands, or edits an existing module. The paid
     authoring run is owner-gated per run.
   - CRITICAL rlms constraints (verified against the installed
     rlms==0.1.3; pinned live by the `test:rlm-workspace` LocalREPL
     section): `custom_system_prompt` REPLACES the base REPL protocol
     prompt — Trellis EXTENDS `RLM_SYSTEM_PROMPT`; rlms runs `.format()`
     over the prompt so literal curly braces are forbidden (escape by
     doubling — see `_SAFE_RUBRIC`; addenda use `dict(...)` example
     syntax; validated name charsets keep generated listings
     structurally brace-free). `LocalREPL` persists `self.locals`
     across turns; scaffold restore touches only `RESERVED_TOOL_NAMES`
     (injected tools persist untouched); on exception, rebindings are
     lost but in-place mutations persist; underscore-prefixed names
     never persist.
   - The orchestrator (Sessions 9/16) lives in `src/core/agent/` and is
     a pure decision maker: `OrchestratorDecisionSchema` through
     `parseLlmResponse`, planner prompt never routed through rlms,
     dependency-injected `runGoalLoop` with typed failures
     (`iteration_bound`/`task_bound`/`concurrency_bound`/
     `decision_error`/`orchestrator_fail`), hard per-goal bounds
     (`AGENT_*`, single-digit-capped) and its own admission gate. The
     orchestrator has NO tools and no database access — and it routes
     workspace lineage BY REFERENCE: task specs carry `seedFromTasks`
     (prior iterations only), observations carry counts-only
     `workspaceRef`s, and snapshot content never enters the decision
     context. Zero-LLM drills: `AGENT_ORACLE_ENABLED=true` accepts an
     `oracle` script — `npm run test:agent-loop`.
   - **The A2A server surface (Session 11)** exposes the goal loop to
     external agents: `src/api/a2a.ts` over pure modules in
     `src/core/a2a/` (`protocol.ts`, `task_record.ts`,
     `agent_card.ts`). Enabled only by `TRELLIS_A2A_ENABLED` (default
     false; the API is byte-identical when unset). The card is served
     unauthenticated from `/.well-known/agent-card.json` (public
     contract only); `POST /a2a/v1` sits behind the API key and
     requires `A2A-Version: 1.0`. Dispatch shares the SAME `StreamGate`
     + queue-depth backstop as `/api/agent-stream`; one A2A task is one
     goal (taskId = goalId), recorded in TTL-bounded Redis records
     (`a2a:task:<id>`, `A2A_TASK_TTL_SECONDS`). IORedis gotcha (found
     live in Session 11): issue `subscribe` in the SAME tick the
     connection is created — a subscribe issued after an unrelated
     await can land mid ready-check and wedge the connection in a
     reconnect loop that delivers no events.
5. **Observability and process boundaries**
   - `src/core/observability/` defines pino JSON logging and per-process
     Prometheus registries; API and workers are separate processes/
     containers. Stable dot-namespaced events; bounded metric labels only —
     queries, goals, message content, artifacts, paths, hashes, entity
     names, tool arguments, tool results, workspace content, promoted
     content, module addendum text, file paths, file content, diffs,
     digests, server commands, URLs, credentials, and retrieved addresses
     never become label values or log content (entity names may appear in
     log CONTENT per the extraction dropped-action precedent). Queue-depth
     gauges cover all seven queues; `trellis_rlm_mcp_calls_total` is
     label-free. Workspace, lineage, textedit, and retrieval-set telemetry
     is counts only.
6. **The frontend (DEFERRED — unscheduled, 3.3 #5 residue) and other stable subsystems**
   - `src/frontend/` is a Next.js 16.2.9 / React 19 app (its own
     `package.json` and lockfile, npm-installed separately) with one
     page: an entity search box over a force-directed graph pane
     (`react-force-graph-2d`) and a provenance pane; clicking a graph
     node highlights the exact AST text blocks that produced it
     (`SplitPaneViewer.tsx` fetches `/api/retrieve?entity=...`). Today
     it is dev-only: `next.config.ts` rewrites `/api/:path*` to
     `http://localhost:3000/:path*` with NO API-key injection, there is
     no production build wired into CI, no container, and no
     deployment documentation. `src/frontend/AGENTS.md` warns: this
     Next.js version has breaking changes vs. training data — read
     `node_modules/next/dist/docs/` before writing Next-specific code.
     These gaps are the deferred 3.3 #5 residue (owner direction,
     July 7, 2026 — third deferral); NOT this session's work unless the
     owner directs it.
   - Whole-codebase ingestion: `src/core/repository/`, `npm run
     repo:ingest`, live drill `npm run test:repo-ingest` (56 checks —
     Part 6 exercises the Session 25 exclusion + routing under
     `--extract changed` with the queue captured in memory). The
     Session 25 extraction prerequisites live here
     (`paths.ts`/`snapshot_ingest.ts`) and in
     `src/workers/extraction_worker.ts` + `extraction_job.ts` +
     `src/core/graph/generic_suppression.ts`; a repository-scale
     `changed` run is now DESIGNED-safe but still owner-gated per run.
   - Benchmarks: OOLONG v1 saturated baseline; anti-shortcut v2 at
     `data/oolong_pairs_dataset_hard.json`; scale evidence in
     `docs/benchmarks/SCALE_PROVENANCE_REPORT.md` and
     `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md`; the paired-run
     workspace probes in `docs/benchmarks/WORKSPACE_PROBE_REPORT.md`
     and `docs/benchmarks/WORKSPACE_LINEAGE_PROBE_REPORT.md`; the
     provenance-citation A/B eval in
     `docs/benchmarks/PROVENANCE_CITATION_AB_REPORT.md` (the evidence
     base for the row-9 threat model); the effective-context probe
     (Sessions 21–24, pillar §6.3, rounds 1–4 measured; plus the
     Session 28 estimation-discipline module control — NOT a round,
     round numbering untouched)
     in `docs/benchmarks/EFFECTIVE_CONTEXT_PROBE_REPORT.md` over the
     committed `data/frankenstein.txt`, the Session 22 synthetic
     corpora, and the Session 23 relational corpus (the Session 28
     `est` suite reads all four corpora; truths + minimal-evidence
     bounds unit-pinned in `estimation_suite.ts`).
   - The fixture MCP server (`scripts/fixture_mcp_server.py`; stdio and
     Streamable HTTP with an optional required-bearer mode) is the only
     MCP server acceptance ever configures; real web-search servers are
     owner-approved runs with the allowlist printed and `mcp_calls`
     recorded. The containerized tool-server pattern is the
     `mcp-fixture` Compose service (test profile).

## 2. Current baseline

Repository state at handoff creation:

- `master`: the head after the July 12, 2026 Session 31 PR (the slice
  (c) adjudication + the slice (d) write-path gate — the PR that
  carries this file). Sessions 25/26/27/28/29/30 (PRs
  #63/#64/#67/#68/#71/#72), the wall-clock benchmark + expansion
  series (PR #65), the coverage-audit record (PR #66), the
  prompt-engineering pass (PR #69), and the root AGENTS.md (PR #70)
  are all merged. Use `git log -- HANDOFF.md` to confirm this PR
  landed; if it is still unmerged when this session starts, STOP and
  merge it first.
- `modules/workspace-discipline/` is at VERSION 2 (module #1); the dev
  graph carries its registered entity `module:workspace-discipline`
  (`moduleVersion` 2; manifest pins 31 research hashes; the entity's
  live provenance is the audit-preserving union of both versions'
  bases, 41 hashes) and THREE promoted corpus documents
  `research:trellis/workspace-discipline/{contract,evidence,code-mediated-text}`
  (none embedded). The dev PG also durably carries the four probe
  corpora: `book:gutenberg-84:frankenstein` (root `a2f9c97c…4439`, 796
  blocks), `book:synthetic:ninth-circuit-chronicle` (root
  `f0ffaf20…7c23`, 827 blocks), `ledger:synthetic:house-01…40`, and
  the Session 23 relational set `ledger:synthetic:s2-house-001…100` +
  `registry:synthetic:captains` + `tariff:synthetic:port-schedule`
  (roots and diffs stable — re-ingest is the auditable no-op) — ~320
  documents total in `documents` (pilot residue: the Session 25 and
  July 12 pilot re-runs' `repo:trellis-graph-pilot-{2,3}:*` docs are
  all tombstoned; pilot-provenance entities read contested — the
  standard lazy-recovery residue; Session 26 added the two promoted
  `research:trellis/estimation-discipline/{contract,evidence}` docs).
  Module #2 (`modules/estimation-discipline/`, version 1) is RETIRED
  (Session 28 owner decision on the measured control; manifest status
  `retired`, loader refuses composition). The graph still carries TWO
  module entities — `module:estimation-discipline` persists as the
  historical record (uncontested, 19 research hashes; `modules:verify`
  reports its manifest status). Roadmap §4 rows 5/6/6a/8 are STRUCK;
  row 9's slices (a)/(b)/(c)/(d) are struck inside the open row —
  (e)/(f) remain.
- Session 30 changed exactly TWO kernel Python files, neither with
  prompt bytes: `src/rlm/trellis_tools.py` (the always-on
  `_retrieved_addresses` set fed inside `_audit_add` for the
  `read`/`search` buckets + the two accessors — the citation audit's
  own gating and `get_citation_audit` byte-unchanged) and
  `src/rlm/trellis_agent.py` (the counts-only `retrieved_addresses`
  telemetry field in both the research and author payloads + the
  import). New: `docs/architecture/PROVENANCE_THREADING.md` (the row-9
  design record, indexed in docs/README.md);
  `src/core/observability/rlm_telemetry.test.ts` gained the explicit
  unknown-field tolerance test (9 → 10); `scripts/test_rlm_sandbox.py`
  gained section [5] (21 → 40 checks) and its cleanup now deletes by
  the drill-owned `document_id` (`sandbox_probe_doc`).
- Session 31 changed the SAME two kernel Python files, again with no
  prompt bytes: `src/rlm/trellis_tools.py` (the
  `retrieved_addresses_check` constructor seam + the
  `_verify_hashes_retrieved` gate called in `_run_insight_writes`
  between the cited-attempt audit and the experimental gates) and
  `src/rlm/trellis_agent.py` (the `get_retrieved_addresses` import +
  the research-run wiring beside `ast_existence_check`).
  `scripts/test_rlm_sandbox.py` gained section [6] (40 → 53 checks;
  the sections-[1]–[4] client comment corrected — it is deliberately
  existence-only because those sections write before anything is
  retrieved); `PROVENANCE_THREADING.md` §9 gained the slice (c)
  verdict. NO TypeScript change, NO new unit test (the pins are
  drill-level). Both composed-prompt pins unmoved (default
  `5d27e474…fe2a`, omit-arm `45987904…0b56` — recompute BOTH in the
  same commit only if the kernel prompt or rubric legitimately
  changes). `package.json` and `requirements.txt` untouched — every
  Docker layer stayed cached. Reminder from Session 24:
  `block_parity.test.ts` SPAWNS the real Python walk inside plain
  `npm test` (interpreter from `PYTHON_EXECUTABLE` or the platform
  default) — a machine without Python on PATH will fail the unit
  suite; CI sets up Python 3.13 before `npm test`.
- July 12, 2026 (owner-directed prompt-engineering pass, PR #69):
  targeted structural prompt improvements under the prompt-engineering
  / hypershot protocols — the code-extraction prompt's hypershot fact
  frame + positive specificity rule (`extraction_job.ts`; legacy prose
  bytes UNTOUCHED — the queue-compat pin holds); the orchestrator
  prompt's JSON hypershot frame (schema enforcement unchanged); two
  kernel run-on instruction blocks restructured — a WITTING kernel
  prompt change: BOTH composed-prompt pins recomputed with history
  recorded (`test_modules.py`): default `3f07295a…4b63` →
  `5d27e474…fe2a`; omit-arm `85362b81…71bb` → `45987904…0b56`.
  Deliberately NOT touched: module addenda, the authoring
  template/addendum, workspace/textedit addenda, probe question bytes
  and preambles, the legacy extraction prompt. Both paired
  measurements ran owner-approved the same day (est-suite kernel check
  $0.9402 — verdict SAFE; extraction pilot re-run §5c — ZERO denylist
  names, output tokens per block −53%, sparsity-vs-coverage question
  recorded open; cleaned up: tombstoned + swept). §5c also records the
  two operational defects found mid-run (a stale pilot worker from
  another worktree consuming the queue — check for stale consumers
  BEFORE any paid enqueue; a worker instance orphaned by parent-only
  kill on Windows — kill worker trees by child PID). The same PR added
  the root `AGENTS.md` — the invariant-only agent entry point. Its
  layer contract is deliberate and PERMANENT: AGENTS.md carries ONLY
  cross-session invariants and POINTS here for everything volatile
  (objective, counts, pins, DB state) — never duplicate volatile facts
  into it, and keep it consistent when a permanent guardrail genuinely
  changes.
- Offline baseline: `npm test` = 730 passing across 79 files
  (unchanged by Session 31 — its pins are drill-level; Session 30
  added the one telemetry-tolerance test over the 729/79 base).
- `npm run build` and `npm run python:check` pass (the check imports
  polars — an environment without it fails the check by design).
- `npm run drill:scale`: gate CLOSED at max provenance 286. Session 31
  read 2.09x CLOSED (in-band ~1.48x–2.26x, first try); Session 30
  1.89x; Session 29 1.97x; Session 28 first read 2.65x — OUTSIDE the
  band — and the precedent re-run read 1.77x CLOSED (non-reproducing,
  most plausibly same-day drill traffic on the shared dev database);
  Sessions 25–27 1.78x–2.01x. If a future run reads OPEN, re-run
  before believing it — and if it REPRODUCES, that is the recorded
  migration trigger (roadmap §4 conditional-migration row) and the
  owner adjudicates. The drill rewrites the tracked
  `scale_drill_results.json` — commit it with the session PR (house
  practice; the committed copy is Session 31's 2.09x CLOSED run). Run
  the scale drill ALONE — never concurrently with other live drills on
  the shared dev database (the Session 28 outlier's most plausible
  cause).
- Live zero-LLM checks (Session 31 observed, all green):
  `test:answer-channel` (32), `test:modules` (green — pins unmoved),
  `test:textedit` (105 on this Windows host; 106 on POSIX — the
  executable-bit check is POSIX-only; also in CI),
  `test:module-lifecycle` (60), `test:promotion` (41),
  `test:rlm-workspace` (106), `test:rlm-mcp` (86),
  `test:rlm-sandbox` (53 — was 40; section [5] is the Session 30
  retrieval-set pin home, section [6] the Session 31 write-gate pin
  home), `test:agent-loop` (35 / ALL CHECKS PASSED), `test:a2a` (46),
  `test:repo-ingest` (56), `test:benchmark-hardening` (24),
  `test:entity-resolution` (34), `test:api-hardening` (18),
  `test:belief-recovery` (30), `test:invalidation-sweep` (17). Also
  standing but not in the close-out block: `test:verification-sweep`
  (the Phase 5 verification drill — Session 32 extends this area).
- Isolated Compose integration: 11 assertions (`--profile test`,
  unique project name, host ports 0 via `TRELLIS_*_HOST_PORT=0`;
  includes the containerized credentialed MCP fixture probe and the
  in-container `polars 1.34.0` import probe).
  Session 31 ran it as project `trellis_s31_ci` (all 11 PASS; no
  manifest changed) and tore it down with `--volumes`. NOTE: the
  machine's C: drive runs close to full and a FULL image rebuild needs
  several GB of headroom (~21 GB free at Session 28's close; the pip
  layer alone rebuilt fine in that envelope). Changing `package.json`
  invalidates the Docker `npm ci` layer; changing `requirements.txt`
  invalidates the pip layer.
- CI target is Node 22 (the `offline` job also runs `test:textedit`
  after its Python-runtime install — Session 29). Session 31's local
  environment was Node 20.19.2, Python 3.13.1, Docker Compose v2,
  PostgreSQL 16.14, Neo4j 5.11.
- Python runtime deps are pinned in `requirements.txt` (`rlms==0.1.3`,
  `openai`, `neo4j`, `psycopg2-binary`, `unstructured`, `mcp==1.12.4`,
  and — Session 27 — `polars==1.34.0`, the engine-side analytics tier:
  pinned NOT adopted, no kernel/contract/prompt path imports it);
  `npm run python:check` verifies syntax/imports/assets — including
  `trellis_textedit.py`, `trellis_answer.py`, `trellis_blocks.py`, the
  `pandas` import (pillar-load-bearing; installed transitively via
  `unstructured`), and the `polars` import (same rationale: a broken
  environment must fail the check, not a paid run). Version facts,
  reconciled by the July 11 data-plane review: local dev measured
  pandas 2.2.3 / pyarrow 24.0.0 / polars 1.34.0; the Docker image
  carries `pandas==3.0.3` (pinned in requirements-pdf-fast.txt) and
  polars 1.34.0 (proven by the Compose probe). Pillar §7's structure
  guidance stands at "plain loops until a measured threshold".
- The `documents.origin` column ships in the idempotent bootstrap; run
  `npm run db:init:dev` (or restart a container) once against a
  pre-Session-17 database before using `npm run promote`.
- Raw probe run logs live under `benchmark_logs/` (gitignored — local
  only; the numbers live in the committed report).
- The frontend has NO offline tests and NO CI coverage today.

Fresh worktrees do not contain `node_modules`. Start with:

```
 git status --short --branch
 git branch --show-current
 npm ci
 npm test
 npm run build
 npm run python:check
 docker compose config --quiet
```

Work on a feature branch and target `master`.

## 3. Session 32 problem statement

**Mechanical provenance threading FINISHES: slice (e) — the sampled
entailment tier (detector machinery zero-paid; the measured sweep
owner-gated) — and slice (f), the compat verify-and-strike (roadmap §4
row 9).** With slice (d) live, T1 is closed mechanically: a research
run can no longer cite an address it did not retrieve. The measured
residual is T2 — read-then-cite laundering — which passes both the
existence gate and the retrieval-set gate BY CONSTRUCTION
(`docs/benchmarks/PROVENANCE_CITATION_AB_REPORT.md`: the readership
gate flagged ZERO laundered runs because the model reads the decoy
then cites it; only semantic entailment catches T2, both post-hoc —
100% of laundered citations — and inline). The record §5.4 fixes the
shipped mode: a sampled POST-HOC DETECTOR over persisted
(edge, cited-hash) pairs that FLAGS unsupported citations into the
ordinary contested machinery — detector, not gate; contested, never
deleted. The inline gate (`TRELLIS_CITATION_ENTAIL` +
`make_entailment_check` in `trellis_agent.py`) stays experiment-gated
as the A/B artifact.

The machinery is zero-paid buildable and drillable: the Phase 5
verification sweep already owns the exact pattern —
`scripts/verify_sweep.ts` (policy-tiered candidate selection, seeded
RNG, `--dry-run`, `--sync`, `--oracle`) → `verification_queue` →
`src/workers/verification_worker.ts` → `verifyBeliefs` in
`src/core/graph/verification.ts` with
`makeOpenAIClassifier`/`makeOracleClassifier` (the oracle is the
zero-LLM dress-rehearsal precedent), disagreement contesting through
the Phase 4 path with a typed `contestedReason`. Slice (e) is that
pattern applied to a NEW candidate class: `DERIVED_INSIGHT`
(claim, cited-block) pairs instead of `has_category` beliefs, with a
support judgment instead of a re-classification. The paid part — the
judge completions of a real sweep — is owner-gated
propose-with-estimate (sampling rate, judge budget, dollar estimate;
the standing ≤$5/run cap).

**Slice (f)** is a verification, not a build: the record §5.3/§5.5
already answer compat by construction (existing insight rows never
re-checked or migrated by the (d) gate; `TRELLIS_RESULT`/
`TRELLIS_TELEMETRY` additive only — slice (b)'s count is the only
envelope change; no pre-threading writer class exists because the only
writer is the agent process, which gained the gate atomically with its
wiring commit). Verify each claim against the code, record the
verification in the roadmap entry (and the record §9 if anything
needed correcting), then strike row 9.

## 4. Required design

- **(e) The detector machinery (zero-paid; the expected main
  implementation).** Finalize against the record §5.4 — the sketch is
  recorded, the session finalizes; where a decision is genuinely open,
  decide it in-session and record it in the design record §9 (or a
  §5.4 amendment) BEFORE the code lands:
  - **The candidate selector** (pure, unit-testable — the
    `selectVerificationCandidates` mold in
    `src/core/graph/verification.ts`, either extended in its own mold
    or a sibling module): the sampling unit is the
    (edge, cited-hash) PAIR; select from pairs not previously
    entailment-checked (recommend an audit-preserving per-edge stamp —
    e.g. `entailmentCheckedAt` plus the checked hash list, or a
    per-pair record; decide against the graph shape and record the
    decision; never mutate provenance fields), sampled at an
    operator-visible rate (the record's strawman: 10% of new pairs)
    under a per-sweep judge-call budget cap (kernel constant +
    operator env twin, the house bounded-config discipline). Seeded
    RNG for deterministic drills (the `mulberry32` precedent).
  - **The judge:** one bounded completion per sampled pair asking the
    §5.4 question — does the block's text support the claim
    `subject verb obj`? — through `parseLlmResponse`, worker- or
    harness-side, NEVER inside a writing run's REPL. The block text is
    fetched engine-side (the way `verifyBeliefs` already fetches
    source text; the Python twin's prompt shape in
    `make_entailment_check` is the semantic reference). A judge
    infrastructure failure is a RuntimeError, never a provenance
    verdict (the Session 14 discipline, already applied in both
    existing checkers).
  - **The flag path:** an unsupported pair CONTESTS the edge through
    the existing Phase 4/5 contested machinery with a distinct typed
    `contestedReason` (the `disputed` precedent) — audit-preserving,
    never a delete; re-derivation under the (d) gate is the recovery
    path, exactly what re-derivation already means. Flagged counts are
    reported per sweep (flagged/checked/skipped — counts only, T16).
  - **Oracle mode:** a deterministic pair→verdict map in the
    `makeOracleClassifier` mold so the entire path — selection,
    budget, judging, contesting, recovery — drills zero-LLM.
  - **No count rewards anywhere** — and the symmetric Session 28 rule:
    never reward LOW retrieval or citation counts; correctness and
    calls are reported together.
- **(e) The measured run (owner-gated; propose, do not self-serve).**
  Propose the first real judged sweep with its sampling rate, judge
  budget, per-pair token estimate, and dollar estimate (the dev
  graph's DERIVED_INSIGHT population is small — estimate from a
  `--dry-run` selection count). Run it ONLY on explicit owner
  approval; report actuals in the roadmap.
- **(f) The compat verification (small; reviewed prose).** The
  Session 27 verify-first standard: every §5.3/§5.5 compat claim
  checked against the code, evidence cited, nothing implemented unless
  a real gap is found. Then strike row 9 in the roadmap (the row
  closes with (e)'s machinery landed and its measured run either done
  or standing owner-gated — record which).
- **What does NOT change:** the Session 14 format + existence layers
  and the Session 31 retrieval-membership layer (order pinned); the
  retrieval-set definition and its section [5] pins; the (d) gate's
  wiring (the detector is sweep-side and never touches the write
  path); `TRELLIS_CITATION_*` flag semantics (the inline entail gate
  stays the experiment artifact — slice (e) may reuse its prompt
  SHAPE, never its env flag); `trellis_answer`/`trellis_workspace`/
  `trellis_textedit`/`trellis_mcp` contracts; the module registry;
  every probe suite's question bytes; the four durable corpora; both
  composed-prompt pins (`5d27e474…fe2a` / `45987904…0b56` — the
  detector is engine-side, no prompt byte should move).

## 5. File-level starting points

Inspect before designing:

- `docs/architecture/PROVENANCE_THREADING.md` — §5.4 (the recorded
  detector sketch: mode, sampling unit, strawman rate, judge boundary,
  no-count-reward), §5.5 + §5.3 (the compat claims slice (f)
  verifies), §9 (where any in-session design decision lands).
- `src/core/graph/verification.ts` — `selectVerificationCandidates`
  (the policy-tier selection mold), `verifyBeliefs` (the fetch → judge
  → contest loop), `makeOpenAIClassifier`/`makeOracleClassifier` (the
  judge + oracle molds), `defaultPolicy`/`mulberry32` (bounded config
  + seeded sampling).
- `scripts/verify_sweep.ts` — the scheduler shape: flags, `--dry-run`,
  `--sync`, `--oracle`, enqueue-vs-in-process.
- `src/workers/verification_worker.ts` — the queue consumer, counts,
  and metrics discipline the detector sweep inherits.
- `src/core/graph/provenance.ts` — the contested state machine the
  flags enter (quarantine/recovery semantics, `contestedReason`).
- `src/rlm/trellis_agent.py` — `make_entailment_check` (the claim →
  block support prompt, the semantic reference for the judge).
- `scripts/test_verification_sweep.ts` (`npm run
  test:verification-sweep`) — the existing verification drill the new
  machinery's drill either extends or siblings.
- `docs/benchmarks/PROVENANCE_CITATION_AB_REPORT.md` §0 — the honesty
  bar: what entailment catches, what it costs, and why
  detector-not-gate is the shipped mode.

## 6. Test strategy and acceptance

Everything this session is zero-paid except the OWNER-GATED measured
sweep (propose with estimates; run only on approval).

- **(e) machinery, unit level:** the pure selector — sampling
  determinism under a seed, the new-pair definition (a checked pair is
  not re-selected; a NEW hash on a re-derived edge is), the budget cap
  (selection never exceeds it, the overflow reported, never silently
  dropped), and the pair-stamp round-trip.
- **(e) machinery, drill level:** oracle-mode end-to-end — a seeded
  graph with known (claim, block) pairs; the oracle flags a planted
  unsupported pair; the edge reads contested with the new typed reason
  and its provenance/audit fields intact; a supported pair accrues its
  check stamp and is not re-selected next sweep; the planted edge
  recovers through re-derivation (under a GATED client, proving the
  (d) gate and the detector compose); judge infrastructure failure
  raises RuntimeError and contests NOTHING; counts reported. Extend
  `test:verification-sweep` (or add a sibling drill wired into
  package.json) — keep the count discipline: report before → after.
- **(f):** reviewed prose with code citations (the Session 27
  verify-first standard); no test unless a gap is found.
- The full standing drill block stays green; run `drill:scale` ALONE
  (never concurrent with other live drills — the Session 28 outlier
  precedent).

Required close-out (the standing block; `test:verification-sweep`
joins it this session — the machinery under change must be in the
block that gates it):

```
 npm test
 npm run build
 npm run python:check
 docker compose --profile test config --quiet
 # Run the isolated zero-LLM Compose integration (unique project name).
 npm run test:answer-channel
 npm run test:textedit
 npm run test:module-lifecycle
 npm run test:modules
 npm run test:promotion
 npm run test:rlm-workspace
 npm run test:rlm-mcp
 npm run test:rlm-sandbox
 npm run test:verification-sweep
 npm run test:agent-loop
 npm run test:a2a
 npm run drill:scale
 npm run test:repo-ingest
 npm run test:benchmark-hardening
 npm run test:entity-resolution
 npm run test:api-hardening
 npm run test:belief-recovery
 npm run test:invalidation-sweep
 git diff --check
```

Update:

- `TRELLIS_ROADMAP.md`: full-dated §5 entry with exact commands,
  counts, and defects found; strike row 9 per §4's (f) instruction —
  record whether the measured sweep ran or stands proposed.
- `HANDOFF.md`: regenerate per §0 — including the §0 step 5 re-check.
  NOTE for objective selection: the sequence is OWNER-APPROVED
  (July 12, 2026): after row 9 closes, the next row is **row 10 —
  kernel-level retrieval dedup + budgets** (slices recorded in the
  roadmap row: held-root tracking — a DIFFERENT structure from the
  retrieval set, sharing call sites, per the record §4's note; dedup
  serve-or-refuse; a per-run retrieval budget; acceptance = the
  Session 28 `est` suite re-run as a paired measurement, owner-gated,
  correctness and calls reported together) — then row 11 (full-repo
  extraction + graph-informed self-edits; paid stages
  propose-with-estimate per step). Row 7 stays trigger-blocked;
  prompt-module authoring stays deprioritized permanently. Keep the
  narrative window: full paragraphs for the most recent FIVE sessions
  only (28–32 after this session) — compress the oldest into the
  digest and move its roadmap §5 entry verbatim to
  `docs/archive/ROADMAP_HISTORY.md`. The standing owner-conditional
  items remain the next proof-run depth increment (the Session 29
  mode-preservation fix unblocks the executable-file case as a
  candidate, but ANY increment stays propose-with-estimate) and the
  pandas head-to-head probe round — never self-served.

## 7. Guardrails

1. Never mutate an AST. The T13 hash preimage is pinned;
   `rederiveAstNodeId` stays authoritative; nothing positional is ever
   persisted as identity.
2. Never merge, rename, or delete Entity nodes. Equivalence stays an
   overlay belief; module entities are contested or retired, never
   deleted. Suppression DROPS extraction candidates before they become
   entities — it never deletes existing graph nodes.
3. Preserve provenance on every semantic node and edge.
   `write_derived_insight` keeps its three-layer enforcement in fixed
   order — format (`_normalize_fact`), existence
   (`_verify_hashes_exist`), retrieval membership
   (`_verify_hashes_retrieved`, Session 31) — never replaced,
   reordered, or merged; extraction writes keep flowing through
   `mergeWithAstLivenessFence`. The slice (e) detector FLAGS into the
   contested machinery — it never deletes, and it never becomes a
   write gate.
4. The detector machinery and its oracle drills are ZERO-paid; the
   measured entailment sweep and any proof run are owner-gated
   propose-with-estimate under the standing ≤$5/run cap, actuals
   recorded in the roadmap. Never reward citation count anywhere —
   and never reward LOW tool-call or retrieval counts either (report
   calls and correctness TOGETHER).
5. Gate machinery is kernel; operator control is absolute. The
   permanent list: the Session 25 extraction invariants (test/fixture
   patterns, denylist, both extraction prompts kernel-fixed), the
   Session 20 textedit invariants, the Session 19 authoring gates (as
   calibrated in Session 21), the Session 22 answer-channel
   invariants, the Session 24 accessor invariants (block walk
   parity-pinned; `trellis_blocks.py` stdlib-only), the Session 26
   splice semantics (refuse only "\n"), the Session 27 data-plane
   invariants (M1/M7 standing fixtures; the cap-raise doctrine;
   polars pinned never imported by src/), the Session 29 `write_back`
   hardening invariants (write-time containment re-verification, the
   resolution-change refusal, source-mode preservation, the final
   pre-replace digest re-check, the static import-allowlist /
   no-git-token pin), the Session 30 retrieval-set
   invariants (the set is ALWAYS ON — never experiment-gated, never
   configurable off; its contributing surfaces are exactly the three
   recorded ones; its exclusions (`ast_hashes_exist`, `fetch_texts`,
   `run_cypher`, Tier-3 surfaces, seeds) are by decision not just by
   shape; the accessor returns a copy; the set is never
   parked/serialized), and — new, Session 31 — the write-gate
   invariants: the retrieval-membership check is the THIRD layer in
   the fixed order (format → existence → retrieval membership →
   experimental gates), wired ONLY by explicit construction at the
   agent (never module-global, never environment-gated, never
   default-on for bare construction), its refusal typed and bounded,
   the cited audit recording the attempt before the refusal. None of
   these is ever weakened or made configurable. `TRELLIS_EXP_OMIT_CMT` and `TRELLIS_EXP_MODULES`
   stay experiment-only: off by default, byte-identical unset
   (pinned), never set by any default/worker/Compose config, never
   forwarded by `buildAgentEnv` — and the module-arm flag is
   validated against the module registry before any spawn,
   permanently.
6. Every external interaction is bounded; new bookkeeping reports
   COUNTS, never silently vanishes work; over-budget operations raise
   with usage. Drill timings are printed telemetry, never assertions.
7. Validate at every boundary: every worker-consumed completion
   crosses `parseLlmResponse`; new job/telemetry fields are OPTIONAL
   and bounded with byte-identical legacy behavior pinned;
   `AGENT_ORACLE_ENABLED` and `TRELLIS_A2A_ENABLED` defaults stay
   pinned false.
8. Report honestly: publish counts and raw numbers; a surprising or
   null result is a finding. A scale-gate reading outside the band
   gets a re-run before it gets believed — and a REPRODUCING open
   reading is the migration trigger, escalated to the owner. The
   Session 29 TOCTOU precedent joins this rule: when a window can
   only be narrowed, DOCUMENT the residual — never claim closure the
   implementation does not deliver. Row 9's version of the same rule:
   slice (d) closed T1, not T2 — never describe the retrieval-set
   constraint as "closing laundering"; the record's §1 taxonomy is
   the required vocabulary. And slice (e) is a SAMPLED detector: it
   measures and flags the T2 residual at a rate, it does not
   eliminate it — report the rate with every claim.
9. Do not break existing consumers: the composed-prompt pins
   (`5d27e474…fe2a` default / `45987904…0b56` omit-arm since the
   July 12, 2026 prompt-engineering pass, `test:modules` [4]/[7]) do
   NOT move this session (the detector is engine-side sweep machinery,
   never prompt bytes; they move only with a witting kernel change,
   both recomputed in the same commit); module #1's pins hold; the
   legacy extraction-job payload and the `prose` payload both process
   with the exact pinned legacy prompt bytes;
   `TRELLIS_RESULT`/`TRELLIS_TELEMETRY` semantics are additive only;
   the API, A2A, and SSE contracts are untouched; the
   `get_ast_texts`/`nodeText` reconstruction bytes do not change;
   bare `TrellisNeo4j(...)` construction (drills, operator scripts)
   keeps writing exactly as today — the (d) gate activates only
   through the explicit agent wiring, and the existing verification
   sweep's `has_category` selection, policy tiers, and worker
   contract keep their current behavior byte-for-byte when the new
   candidate class is not requested.
10. Respect the rlms prompt contract: extend `RLM_SYSTEM_PROMPT`,
    never replace it; no literal curly braces in anything rlms
    formats; no rlms library modifications.
11. Follow the T16 observability house style: file paths, prompts,
    extraction text, hashes, and retrieved addresses never become
    metric label values; counts are label-bounded; entity names may
    appear in log CONTENT per the dropped-action precedent.
12. Keep API and worker processes split; project-scoped Compose
    commands; drills clean up token-scoped temp state only — the four
    probe corpora (`book:gutenberg-84:frankenstein`,
    `book:synthetic:ninth-circuit-chronicle`,
    `ledger:synthetic:house-*`, and the relational
    `ledger:synthetic:s2-house-*`/`registry:synthetic:captains`/
    `tariff:synthetic:port-schedule`) and the promoted research docs
    stay durable.
13. Ship one feature branch and one PR to `master`, plain engineering
    prose, no AI attribution or generated-by trailers. Regenerate this
    file in the same PR — and re-run the §0 step 5 check before
    handing off.
14. Code-mediated text is doctrine (permanent; survives every rewrite).
    Any new or modified surface where the RLM touches text must follow
    `docs/architecture/CODE_MEDIATED_TEXT.md`: locations
    engine-computed, bytes moved by code, transient frames,
    hash-guarded writes, answers submitted by reference
    (`trellis_answer`), block structure read from the engine
    (`get_ast_blocks`) — never model-estimated positions, never
    model-retyped existing bytes, never a persistent in-memory mirror
    of a store. Provenance threading is this doctrine applied to the
    write path: addresses travel by plumbing, never by model retyping.
    Prompt text may reinforce the discipline but never substitutes for
    tooling shape.

## 8. Explicit exclusions

Do not include: running any PAID judged sweep without explicit owner
approval (the machinery and its oracle drills are this session's
zero-paid scope; the first real sweep is propose-with-estimate —
sampling rate, judge budget, dollar estimate, actuals reported);
shipping the detector as an inline write gate or wiring it into the
write path in any form (detector-not-gate is the RECORDED mode — the
inline gate exists already as the `TRELLIS_CITATION_ENTAIL`
experiment artifact and stays experiment-gated); deleting, merging,
or renaming flagged edges (flags CONTEST through the ordinary
machinery; recovery is re-derivation); repurposing the
`TRELLIS_CITATION_*` env flags for the detector (their semantics are
A/B measurement artifacts — the judge may reuse the PROMPT SHAPE of
`make_entailment_check`, nothing else); mutating provenance fields
(`sourceNodeIds`/`orphanedSourceIds`/`contested*` beyond the ordinary
contest transition) to store check stamps — the stamp is additive,
audit-preserving, its shape decided and recorded before code;
weakening, reordering, or merging the three write-path layers (format
→ existence → retrieval membership — fixed order, fail-fast); making
the (d) gate module-global, environment-gated, or default-on for bare
construction; redefining the retrieval set (contributing surfaces and
exclusions are recorded in the design record §3 and pinned by
`test:rlm-sandbox` [5] — a change there is a recorded correction with
owner visibility, not a convenience edit); starting the row-10
dedup/budget implementation (its held-root tracking is a different
structure — record seam observations in row-10 terms if found,
implement nothing); un-retiring module #2 or authoring ANY new
protocol module (deprioritized permanently; explicit owner request
only); re-running or extending the Session 28 control or ANY measured
probe round; running the cross-process concurrency proof run
(coverage-audit gap #1) or any proof-run depth increment without
owner approval — propose with estimates; weakening ANY Session 29
`write_back` hardening pin, the `StaleFileError` semantics, the
splice "\n"-only refusal, or any textedit
gating/containment/hash-guard pin; claiming full TOCTOU closure (the
residual window is documented, not closed — OS locking stays out of
scope); claiming the retrieval-set constraint closes laundering (it
closed T1; T2 is the detector's SAMPLED residual — guardrail 8); ANY
data-plane representation migration at ANY boundary (the Session 27
verdict stands; re-entry only through the review's benchmark matrix
with owner sign-off); importing polars in any `src/` path, kernel
surface, or prompt; raising any workspace/scratch/textedit cap
without first re-running the M1 fixture at the target size (the
cap-raise doctrine, pillar §7); asserting on wall-clock timings in
any drill; re-running the extraction pilot or widening the
generic-identifier denylist / test-fixture patterns without observed
counts; changing `get_ast_texts`/`nodeText` block-boundary semantics
(SUPERSEDED by `get_ast_blocks`, confirmed closed by round 4); a
fifth effective-context probe round (the §7 structured-frame movers
and the pandas head-to-head stay future owner-picked rounds, propose
with estimates); embedding any probe corpus; weakening or toggling
the §6.2 kernel block outside the `TRELLIS_EXP_OMIT_CMT` experiment
flag; setting `TRELLIS_EXP_MODULES` anywhere but a probe invocation's
own environment; moving the composed-prompt pins (no prompt byte
changes are in scope); new MCP servers or transports; A2A changes;
frontend work (deferred unscheduled); `ASTRef`/`EVIDENCED_BY`
migration (gate CLOSED; Sessions 23–31 read 1.84x, 2.11x,
1.99x–2.01x, 1.78x, 1.99x, 1.77x-after-outlier, 1.97x, 1.89x, and
2.09x, inside the band — do not migrate on a noisy reading); T13
re-hashing; rlms library modifications; weakening the Session 14
write-path enforcement, the Session 15/20/22/24 composition pins, the
Session 16 lineage pins, the Session 17 promotion refusals, the
Session 18 registration gates, the Session 19 authoring-mode /
anchor-gate / draft-scanner / template pins (as calibrated in
Session 21), the Session 20 textedit gating/containment/hash-guard
pins (as corrected in Session 26 and hardened in Session 29), the
Session 22 answer-channel refusals, the Session 24 block-walk parity
pin, the Session 25 extraction gates, the Session 27 M1/M7 standing
fixtures, the Session 28 module-arm validation and est-suite truth
pins, the Session 30 retrieval-set tracking pins, or the Session 31
write-gate pins.
