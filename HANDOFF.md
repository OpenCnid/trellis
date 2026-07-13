You are a principal systems engineer continuing development on Trellis Engine,
a Recursive Language Model runtime over a provenance-enforced knowledge
substrate — its GraphRAG-shaped storage layers survive as Tiers 1–2 of the
trust model; the system is the RLM standing on them (reframed July 9, 2026;
see the root README "What Trellis is") (repository:
https://github.com/OpenCnid/trellis, local path `D:\trellis-engine` or the
current working directory). Trellis is an original OpenCnid project, not a
fork, and is unrelated to other projects named Trellis. The repository and its
documentation are the only sources of truth.

Sessions 1–27 and their same-day follow-ons (July 4–11, 2026; PRs
#21–#67) are complete, merged, and ARCHIVED: the full dated ledger for
that span lives verbatim in `docs/archive/ROADMAP_HISTORY.md`
(Sessions 1–23 moved July 12, 2026 by owner direction; then one
session entry per PR under the five-session window rule — Session 24
with the Session 29 PR, Session 25 with the Session 30 PR, Session 26
with the Session 31 PR, Session 27 with the Session 32 PR — this file
keeps full narrative only for the most recent five sessions). The
one-paragraph digest, oldest first; §1 below carries everything from
this span that a new session must actually know:

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
- **Sessions 20–24 + the pillar**: `docs/architecture/CODE_MEDIATED_TEXT.md`
  ratified (the model never counts, never copies; tooling shape
  enforces, prompts reinforce); the editing toolkit
  (`trellis_textedit`, operator-gated, hash-guarded); the kernel
  CODE-MEDIATED TEXT block; the effective-context probe rounds 1–4
  over durable corpora — found and closed the transcription channel
  (`trellis_answer`, Session 22), characterized the localization miss
  class (Session 23), and closed it structurally with the ordered
  block accessor `get_ast_blocks` (Session 24: round-4 re-measure
  0/36 misses vs 7/30, 36/36 accessor adoption in BOTH arms — tooling
  shape, not the prompt block, carries the behavior; pillar §7's
  "pandas default" demoted to "plain loops until a measured
  threshold").
- **Session 25 (PR #63)** turned the July 6 pilot's three blockers
  into machinery, zero-paid: the kernel-fixed test/fixture extraction
  exclusion (`isTestOrFixturePath`), additive `sourceKind`/`language`
  payload routing selecting a code-tuned extraction prompt (legacy
  prose bytes unit-pinned), and deterministic generic-identifier
  suppression before resolution (counted, never silent). The
  owner-approved pilot re-run measured it live ($0.28, 103/103 jobs,
  max hub cardinality 3.5× lower); cleanup tombstoned + swept.
- **Session 26 (PR #64) + the July 11 follow-ons (PRs #65/#66)**: the
  Trellis-edits-Trellis proof runs (six spawns ≈$0.58; three
  human-reviewed edits landed; run 2 found a real kernel defect —
  `splice` refused "\r", making CRLF files impossible to line-replace
  — fixed and regression-pinned) and module #2 `estimation-discipline`
  authored through grounded authoring (retired by Session 28's
  control). PR #65: the wall-clock engine benchmark (insertion stays
  Python-native at every size to 8M tokens; disambiguation/regex are
  polars territory — `docs/benchmarks/WALL_CLOCK_TEXT_OPS_REPORT.md`)
  + the expansion series W1–W4 (the first RLM source-code edit; the W4
  adversarial containment probe — both path-escape refusals held
  live). PR #66 recorded the toolkit coverage audit that became
  Session 29's worklist. Owner precedents: a 2-million-token FLOOR for
  synthetic tests; every edit-run diff human-reviewed; the toolkit
  never touches git.
- **Session 27 (PR #67)** recorded the data-plane representation
  verdict and pinned its prerequisites, zero-paid: NO migration at any
  of the six data-plane boundaries — JSON/list/dict contracts stand
  everywhere; structure selection is operation-shaped, not
  size-shaped. `polars==1.34.0` pinned NOT adopted (requirements.txt +
  the `python:check` import list + an in-container import probe, 10 →
  11 Compose assertions; no kernel, contract, or prompt path imports
  it); the pillar §7 verdict paragraph + the cap-raise doctrine
  (approach the 32 MiB cap ⇒ re-run the M1 drill at the target size
  BEFORE raising caps; a migration re-enters only through the review's
  benchmark matrix with owner sign-off); and the M1/M7 standing
  fixtures (`test:rlm-workspace` [7]/[8], 86 → 106 checks: park/seed
  byte-lossless at EXACTLY 4 MiB / 32 MiB / 1024 segments, cap+1
  refusals, per-field torn-payload refusals, canonical-form
  determinism — parse + re-serialize byte-identical; timings PRINTED
  never asserted).

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
the process, never parked. **(2) Slice (b):** the always-on
`_retrieved_addresses` set in `trellis_tools.py`, fed INSIDE
`_audit_add` for the `read`/`search` buckets — the exact seam the
opt-in citation audit already maintains at the three call sites; one
function, one lock, no parallel instrumentation; the `cited` bucket
never feeds it; the audit's opt-in gating and `get_citation_audit`
are byte-unchanged. Accessors return a copy + a count;
`TRELLIS_TELEMETRY` gains counts-only `retrieved_addresses` (both
research and author payloads; the scanner's unknown-field tolerance
is now pinned explicitly — `rlm_telemetry.test.ts` 9 → 10). NO
write-path behavior change, NO prompt bytes — both composed-prompt
pins unmoved. **(3) Pins:** `test:rlm-sandbox` [5], 21 → 40 checks
live: cypher/existence/cited writes contribute nothing (including a
live Cypher read that demonstrably surfaces the probe hash as a
provenance property); returned-keys-only; repeat-inert;
block-ids-not-root; vector_search drilled ZERO-PAID (probe row with
deterministic 1536-dim embedding + `openai` stubbed in `sys.modules`
— the in-function import binds the stub, cosine distance 0 makes the
probe the top hit); copy semantics; audit-buckets-empty-while-set-
populated (the gating separation); and audit-#8-mold static pins
(Tier-3 modules never reference the seam; the agent telemetry dict
carries the field). `drill:scale` 1.89x CLOSED (in-band, first try).
Compose isolated as `trellis_s30_ci`: 11/11, no manifest changed. No
defect found; section [5] passed on first run. Zero paid spend.

**Session 31 (July 12, 2026, PR #73) is also complete: mechanical
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
and the agent-wiring static pin. `drill:scale` 2.09x CLOSED (in-band,
first try). Compose isolated as `trellis_s31_ci`: 11/11, all layers
cached. No code defect found; one DOC defect found and fixed (the
roadmap §5 intro paragraph). Zero paid spend.

**Session 32 (July 12, 2026, this PR) is also complete: mechanical
provenance threading FINISHED — the slice (e) sampled-entailment
detector + the slice (f) compat verify-and-strike; roadmap §4 row 9 is
STRUCK** (all machinery zero-paid, four commits: the drill repair, the
detector, the pins, the docs). **(0) Pre-existing defect found and
fixed FIRST, its own commit:** `test:verification-sweep` had been
BROKEN since the Session 14 format enforcement landed (July 7) — the
drill seeded beliefs whose `sourceNodeIds` were token-scoped strings,
which `_normalize_fact` refuses (`^[0-9a-f]{64}$`); it was absent from
every close-out block since, so the breakage went unobserved. Fix:
provenance hashes are sha256 digests of the token-scoped names (real
64-hex, unique per run, teardown unchanged); all 35 pre-existing
checks pass again, and the drill is now IN the standing close-out
block so it cannot silently rot. **(1) Slice (e) — the sampled
entailment detector** (`src/core/graph/entailment_detection.ts`, the
verification-sweep mold; finalized decisions recorded in
`PROVENANCE_THREADING.md` §9 amending §5.4 BEFORE the code landed):
the T2 residual tier, a post-hoc DETECTOR over persisted
DERIVED_INSIGHT (edge, cited-hash) pairs — never a write gate, never a
delete. Uniform candidate class (every non-contested DERIVED_INSIGHT
edge with provenance, `has_category` included); the pure sampler
expands unchecked pairs (cited minus judged, deduped), samples at the
operator-visible rate, hard-caps at the judge budget with overflow
counted as `deferred` (seeded `mulberry32`). Each pair is judged AT
MOST ONCE ever: supported ⇒ the hash joins the edge's additive
`entailmentCheckedHashes` (+ `entailmentCheckedAt`); unsupported ⇒ the
edge contests through the ordinary Phase 4/5 transition with typed
reason `unsupported_citation` and the hash joins the durable
`unsupportedHashes` audit (+ `entailmentFlaggedAt`). Provenance fields
never mutated; recovery is re-derivation; no contest flap over an
already-judged pair. The judge: one bounded completion per pair
through `parseLlmResponse` (`EntailmentResponseSchema`; the
`make_entailment_check` prompt SHAPE — the `TRELLIS_CITATION_*` flags
untouched), with judge-all-then-write atomicity (every verdict
collected before any write; an infrastructure failure aborts with ZERO
partial state). Oracle mode drills the whole path zero-LLM. Config
twins `ENTAILMENT_SAMPLE_RATE` 0.1 / `ENTAILMENT_JUDGE_BUDGET_PER_SWEEP`
25 (max 500). Transport: the `entailment_sweep` job name on the
existing verification queue/worker (every other job name
byte-identical); counts-only `trellis_entailment_pairs_total{result}`;
scheduler `npm run entailment:sweep` (`--rate`, `--budget`, `--seed`,
`--prefix`, `--oracle`, `--sync`, `--dry-run`). **(2) Pins:** 10 unit
tests (`entailment_detection.test.ts`, `npm test` 730 → 740) — pool
definition, determinism, budget/deferred, oracle semantics; drill
sections [7]–[9] (`test:verification-sweep` 35 → 66, all green on
FIRST run) — the planted unsupported citation flagged with provenance
intact, the supported pair on the SAME edge still stamped, recovery
composing with the slice (d) gate (unretrieved re-derivation refused;
retrieval-gated one recovers; audit survives), judge failure contests
NOTHING, budget defers loudly, dead-byte pairs skipped and counted,
queue round trip through the real worker. **(3) The first REAL judged
sweep RAN owner-approved (July 13, 2026, the day after the proposal —
dev graph 283 edges / 566 unchecked pairs):** seed 32, 25/25 judged —
8 supported, 17 flagged, 15 edges contested; ACTUAL $0.0093 (2,176
input + 375 output tokens, vs the $0.02–$0.05 estimate). Verified
against stored bytes, the flags decompose: 9 CONFIRMED weak citations
(HEADING blocks — bytes like "q_0034" — cited as provenance for
question facts: the exact wrong-block class the detector exists for,
invisible to the three structural layers by construction) + 8
strict-judge verdicts on derived-classification `has_category` claims
(text supports but does not STATE the classification — a recorded
calibration observation, owner-picked follow-up; the judge prompt
shape unchanged). The 15 contested edges are OOLONG-era dev-graph
cache rows — standard lazy-recovery residue. No machinery defect:
every behavior matched the pins. **(4) Slice (f) — compat
VERIFIED, no gap:** the (d) gate is write-time only
(`_verify_hashes_retrieved` has exactly one caller); envelopes
additive only (`TRELLIS_RESULT` exactly `{status, answer, toolCalls}`;
telemetry gained only slice (b)'s count); no pre-threading writer
class (the only gated construction is the agent's research-run wiring;
every other construction site is bare BY DESIGN under the injection
mold). Evidence cited in the roadmap §5 entry. `drill:scale` 2.04x
CLOSED (in-band, first try). Compose isolated as `trellis_s32_ci`:
11/11 (`package.json` changed — npm ci layer rebuilt; pip layer
cached). Zero paid spend.

OpenCnid selected the MIT License on July 6, 2026.

Your objective is **Session 33: kernel-level retrieval discipline —
dedup + budgets** (roadmap §4 row 10 — the owner-approved July 12,
2026 tooling-shape sequence, step 3 of 4; row 11 comes after; row 7
stays trigger-blocked), per §3–§6 below. The machinery and its drills
are zero-paid; the acceptance measurement (the `est` suite paired
re-run) is owner-gated propose-with-estimate. Do not re-plan or
re-implement completed work. RLM expands exclusively to Recursive
Language Model (the MIT CSAIL formulation).

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
     directly — measured (probe round 4): 0/36 misses vs round 3's
     7/30. The reconstruction-byte change is SUPERSEDED and stays
     closed.
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
     `src/core/graph/generic_suppression.ts`) → `resolveExtractedGraph` →
     `mergeWithAstLivenessFence(mergeExtractedGraph)` (ON MATCH mirrors
     the quarantine/recovery semantics; dropped actions are counted and
     logged, never silent) → per-block embedding. Repository snapshots
     stamp sourceKind per file language and force policy `none` for
     `isTestOrFixturePath`-classified files (typed
     `test_fixture_excluded` counts everywhere). Extraction spend is
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
     before. T1 is CLOSED. **Session 32 finished the row:** T2
     (read-then-cite laundering) is MEASURED by the sampled entailment
     detector (`src/core/graph/entailment_detection.ts`, sweep-side,
     never in the write path): per persisted DERIVED_INSIGHT
     (edge, cited-hash) pair, judged at most once ever — supported
     pairs stamp the additive `entailmentCheckedHashes`, unsupported
     pairs contest the edge (typed reason `unsupported_citation`,
     durable `unsupportedHashes` audit) through the ordinary machinery;
     recovery is re-derivation; judge-all-then-write atomicity; oracle
     mode drills it zero-LLM (`test:verification-sweep` [7]–[9]). The
     detector is a SAMPLED measure of the T2 residual at a rate — it
     does not eliminate it; report the rate with every claim.
   - **The verification layer (Phase 5 + Session 32;
     `src/core/graph/verification.ts` + `entailment_detection.ts` +
     `scripts/verify_sweep.ts` + `scripts/entailment_sweep.ts` +
     `src/workers/verification_worker.ts`):** two sampled re-check
     tiers over the shared `verification_queue`. The classifier sweep
     re-classifies cached `has_category` beliefs from live source text
     (policy tiers mandatory/sampled/graduated, trust accrual via
     `verified_count`, disagreement contests with reason `disputed`).
     The entailment sweep (job name `entailment_sweep`) judges sampled
     (edge, cited-hash) pairs for claim support (rate + budget config
     twins `ENTAILMENT_SAMPLE_RATE`/`ENTAILMENT_JUDGE_BUDGET_PER_SWEEP`;
     overflow deferred and counted). Both have oracle modes for
     zero-LLM drills; both contest through the Phase 4 path, never
     delete; both fetch block text engine-side and validate every
     completion through `parseLlmResponse`. Real sweeps are owner-gated
     per run. The first ran owner-approved July 13, 2026 (seed 32, 25
     pairs, $0.0093): 17 flagged — 9 VERIFIED weak heading-block
     citations (the wrong-block class the detector exists for) + 8
     strict-judge verdicts on derived-classification `has_category`
     claims (calibration observation, owner-picked follow-up); the
     roadmap §5 Session 32 entry item 3 records the decomposition.
   - **Module entities (Session 18; `src/core/graph/module_registration.ts`
     + `scripts/register_modules.ts`):** each research-bearing ACTIVE
     module manifest is registrable as
     `(:Entity {kind: 'module_manifest', name: 'module:<name>'})` whose
     `sourceNodeIds` are the manifest's research hashes
     (existence-gated against `ast_nodes` before any write) and whose
     ON MATCH mirrors `applyRederivation` — so the unchanged sweep
     contests a capability when its research basis changes. `npm run
     modules:register` / `modules:verify` are operator tooling in the
     `repo:ingest`/`promote` mold. Contested/retired manifests are
     skipped by registration; entities are contested/retired, never
     deleted.
3. **Redis + BullMQ — asynchronous layer**
   - Seven queues: `extraction_queue`, `rlm_queue`, `supervisor_queue`,
     `invalidation_queue`, `verification_queue`, `resolution_queue`, and
     `agent_queue`. `rlm_queue` and `agent_queue` use interactive no-retry
     job options (an interrupted paid run must not silently re-spend); the
     rest use bounded retries. All LLM calls live inside BullMQ workers or
     the RLM process; every worker-consumed completion crosses
     `parseLlmResponse` (`src/core/llm/boundary.ts`). Since Session 32
     `verification_queue` carries two job names — the existing
     verification shape and `entailment_sweep` — dispatched by
     `job.name` in the worker; the existing shape processes
     byte-identically.
   - **Scratch parking (Session 16):** `scratch:goal:<goalId>:task:<taskId>`
     holds one task's end-of-run workspace snapshot, TTL-bounded
     (`SCRATCH_TTL_SECONDS`) and volume-capped per goal
     (`SCRATCH_MAX_BYTES_PER_GOAL`). Redis is a parking lot for
     checkpoints, never a live store the model queries. Pure helpers
     live in `src/workers/workspace_scratch.ts`; all I/O is in
     `rlm_worker.ts`. Promotion consumes these parked snapshots — TTL
     expiry is BY DESIGN.
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
     and the research write path consumes it (see the Session 14
     bullet above). **Row 10 lands here:** the three retrieval
     surfaces (`get_ast_texts`, `get_ast_blocks`, `vector_search`) are
     the dedup/budget call sites — the record §4 note is binding: the
     shared seam with the retrieval set is the CALL SITES, not the
     set; held-root tracking is a DIFFERENT structure.
   - **The by-reference answer channel (Session 22;
     `src/rlm/trellis_answer.py`):** `TrellisAnswer` injected as
     `trellis_answer` in EVERY research run — kernel surface, not
     operator-gated (author mode does NOT carry it; its draft envelope
     is a different contract). `submit(expression_text)` takes the TEXT
     of a Python expression, evaluates it in the calling REPL frame
     (`sys._getframe(1)` — globals AND locals; the caller's
     `__builtins__` are rlms' safe table), structurally refuses bare
     literals (`ast.parse`: an expression with no
     Name/Attribute/Subscript/Call is a retyped literal — refused with
     a teaching message), refuses `None` results and over-cap
     expressions/content (kernel constants
     `ANSWER_EXPRESSION_MAX_CHARS` 400 / `ANSWER_CONTENT_MAX_CHARS`
     64 KiB), renders deterministically (str verbatim, int exact, float
     shortest repr, containers compact JSON), prefixes `FINAL_ANSWER: `
     engine-side, and sets `answer['content']`/`answer['ready']` on the
     LIVE binding read from the caller frame at each call. ADDITIVE:
     direct assignment still works; `TRELLIS_RESULT` semantics
     unchanged; telemetry gains counts-only `answer_submits`. Errors
     are LOUD by construction. Pinned by `npm run test:answer-channel`
     (32 checks, real LocalREPL). Measured: 230/230 cumulative paid
     runs answered through the channel with zero transcription errors.
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
     [7]/[8]); any cap raise re-runs the M1 fixture at the target size
     FIRST (the cap-raise doctrine, pillar §7). Structural
     disjointness: uuid segment ids and 16-hex argsHashes can never
     match `^[0-9a-f]{64}$`, and the hardened write path rejects them
     independently. Tier 3 has NO provenance standing; permanence is
     earned only through the Session 17 promotion CLI. **Session 30:**
     seeded runs inherit NOTHING into the retrieval set.
   - **CORE PILLAR — code-mediated text (ratified July 9, 2026;
     `docs/architecture/CODE_MEDIATED_TEXT.md`, doctrine on par with the
     provenance invariant):** *the model never counts, and the model
     never copies.* The RLM handles all text through queryable REPL
     structures: locations are engine-computed and returned by query
     (transient handles — re-query, never remember); existing bytes are
     moved by code (splice at a computed address, hash-guarded
     write-back), never re-typed through attention; the model authors
     only genuinely new text plus the code that manipulates everything
     else. Localization error and transcription error (the laundering
     channel) are the same pathology — attention doing code's job.
     Payoff: effective context bounded by REPL memory, not the
     attention window. Lines locate, blocks mean. Enforcement lands as
     tooling shape; prompts reinforce only. Sessions 20–24 implemented
     §6.1/§6.2, measured rounds 1–4, closed the transcription channel
     (`trellis_answer`) and the localization read boundary
     (`get_ast_blocks`); Session 27 recorded the data-plane verdict
     (contracts stay JSON everywhere; polars pinned NOT adopted; cap
     raises, not representation changes, are the first lever).
     **Sessions 30–32 applied the pillar to the write path:**
     `docs/architecture/PROVENANCE_THREADING.md` — addresses travel by
     plumbing, never by model retyping; the row is COMPLETE: (a)+(b)
     Session 30, (c) adjudicated + (d) live Session 31, (e) detector +
     (f) compat Session 32. Measured standing: transcription CLOSED
     (144/144 rounds-2–3 runs by reference, zero retyped-value
     corruptions); read-fidelity holds (28/28 quotes byte-faithful);
     the structured-frame threshold sits ABOVE ~6,900 records /
     three-way joins (the pandas null result, twice); localization
     CLOSED by the accessor (0/36); the residual after transcription
     closes is computing faithfully over the WRONG input. **Row 10 is
     the pillar applied to retrieval spend:** repeat fetches and
     unbounded retrieval are attention doing bookkeeping's job — the
     engine tracks held roots, the engine enforces budgets, the model
     reuses bindings it already holds.
   - **The editing toolkit (Session 20; `src/rlm/trellis_textedit.py`):**
     `TrellisTextEdit` injected as `trellis_textedit` ONLY when the
     operator sets `TRELLIS_EDIT_ROOT` (never a default; never from a
     payload or completion; byte-identical prompt and namespace when
     unset — pinned by `npm run test:textedit`). Every path strictly
     resolves inside the real root: `..`, absolute/rooted paths, and
     symlink escapes are refused before any I/O. `load` holds a
     `text.split("\n")` frame + load-time sha256 (the join is the exact
     inverse — an unedited round-trip is byte-identical); `locate`
     returns engine-computed 0-based half-open addresses (bounded hits
     + true total); `splice` stages replacements (lists of strings free
     of "\n" — a "\r" is an ordinary byte WITHIN a line; Session 26
     fixed the CRLF refusal, regression-pinned); `diff`/`revert`/`drop`
     review and manage frames; `write_back` re-hashes the disk bytes
     and RAISES `StaleFileError` on mismatch, else writes temp +
     rename. Bounds: Zod + Python twins
     (`TRELLIS_TEXTEDIT_MAX_FILE_BYTES` default 4 MiB cap 32 MiB;
     `TRELLIS_TEXTEDIT_MAX_FILES` default 16 cap 64); slice (200) / hit
     (40) / diff (400) caps are kernel constants. Telemetry counts only
     — toolkit ops never satisfy the provenance protocol, and edited
     file content earns citability only through verified
     ingest/promotion. Session 29 hardened `write_back` inside the
     contract (write-time containment re-verification, source-mode
     preservation, the final pre-replace digest re-check narrowing
     TOCTOU — residual documented, not denied; the static
     import-allowlist/no-git-token pin). The 105/106-check drill runs
     in CI's `offline` job. The toolkit never touches git; landing is
     a human PR. The brace-free TEXTEDIT addendum composes only when
     configured. Author mode does NOT inject it.
   - **The module registry (Sessions 15/18; `src/config/modules.ts` +
     `src/rlm/trellis_modules.py`, `modules/<name>/`):**
     `TRELLIS_ADDENDUM` = `TRELLIS_ADDENDUM_BASE` + Σ selected module
     addenda + `TRELLIS_WORKFLOW_RULES`. Selection is operator-owned via
     `TRELLIS_MODULES` (unset ⇒ default `["spatial-flywheel"]`; `[]` ⇒
     base + rules only; max 4/run). PROTOCOL MODULES ONLY this kernel
     edition — manifests declaring tools are rejected. Addendum files
     are brace-free; rubric text enters through the single
     `<<TRELLIS_RUBRIC>>` substitution token. Both validators are
     bound-for-bound twins and normalize CRLF→LF. Session 28 added
     `TRELLIS_EXP_MODULES` (probe-runner-only, the
     `TRELLIS_EXP_OMIT_CMT` mold; `buildAgentEnv` deletes both
     unconditionally). The composed default prompt is pinned at
     `COMPOSED_SYSTEM_PROMPT_SHA256 = 5d27e474…fe2a` (the July 12, 2026
     prompt-engineering pass; the pin constant records its full move
     history in `scripts/test_modules.py` — it moves only with a
     witting kernel change, recomputed in the same commit). The §6.2
     block is the named constant `CODE_MEDIATED_TEXT_BLOCK`, and
     `TRELLIS_EXP_OMIT_CMT=1` (experiment instrumentation ONLY — never
     set by any default/worker/Compose config, `buildAgentEnv` deletes
     it unconditionally) composes exactly that block out
     (`45987904…0b56`, pinned structurally by `test:modules` [7]:
     the default kernel minus exactly the block, re-proven on every
     run). Module #1 (`workspace-discipline`) is at version 2. Module
     #2 (`estimation-discipline`) is RETIRED (owner decision, July 11,
     2026, on the Session 28 control's numbers; manifest status
     `retired`, loader refuses composition — `test:modules` [8]; the
     graph entity survives as the historical record). The owner's
     accompanying direction is PERMANENT: behavioral failure classes
     close by tooling shape, not prompt modules — prompt-module
     authoring is deprioritized (no new authoring turn without
     explicit owner request); the recorded successors were rows 9
     (DONE, Sessions 30–32) and 10 (this session).
   - **Grounded authoring (Session 19; `src/core/authoring/*` +
     `src/core/observability/rlm_draft.ts` + `scripts/author_module.ts`
     + `trellis_agent.py --mode author`):** the kernel mode that drafts
     a protocol module addendum from a FIXED promoted corpus and nothing
     else. Author runs see only `trellis_workspace` (no DB/search/write
     — no DB connection opens; no textedit), work from a block-aligned
     seeded corpus, and emit a hashes-free `TRELLIS_DRAFT` envelope. The
     harness holds the pen: `research.sourceNodeIds` is pinned from the
     corpus block set (`corpus.ts`/`seed.ts`), the authoring template is
     a byte-pinned kernel constant, the deterministic anchor gate
     (`anchors.ts`, `ANCHOR_COVERAGE_THRESHOLD = 0.3`) refuses a
     corpus-blind draft, and the draft scanner refuses any 64-hex
     token. `npm run modules:author` assembles a directory for human
     review only. The paid authoring run is owner-gated per run.
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
     log CONTENT per the extraction dropped-action precedent; operator
     CLIs may print hashes — the `promote` precedent). Queue-depth
     gauges cover all seven queues; `trellis_rlm_mcp_calls_total` is
     label-free. Workspace, lineage, textedit, retrieval-set, and
     entailment telemetry is counts only
     (`trellis_entailment_pairs_total{result}` — Session 32).
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
     NOT this session's work unless the owner directs it.
   - Whole-codebase ingestion: `src/core/repository/`, `npm run
     repo:ingest`, live drill `npm run test:repo-ingest` (56 checks —
     Part 6 exercises the Session 25 exclusion + routing under
     `--extract changed` with the queue captured in memory). A
     repository-scale `changed` run is DESIGNED-safe but still
     owner-gated per run (row 11 stage 1).
   - Benchmarks: OOLONG v1 saturated baseline; anti-shortcut v2 at
     `data/oolong_pairs_dataset_hard.json`; scale evidence in
     `docs/benchmarks/SCALE_PROVENANCE_REPORT.md` and
     `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md`; the paired-run
     workspace probes in `docs/benchmarks/WORKSPACE_PROBE_REPORT.md`
     and `WORKSPACE_LINEAGE_PROBE_REPORT.md`; the provenance-citation
     A/B eval in `docs/benchmarks/PROVENANCE_CITATION_AB_REPORT.md`
     (the evidence base for the row-9 threat model); the
     effective-context probe (rounds 1–4 + the Session 28 control) in
     `docs/benchmarks/EFFECTIVE_CONTEXT_PROBE_REPORT.md` over the four
     durable corpora (the `est` suite reads all four; truths +
     minimal-evidence bounds unit-pinned in `estimation_suite.ts` —
     row 10's acceptance harness).
   - The fixture MCP server (`scripts/fixture_mcp_server.py`; stdio and
     Streamable HTTP with an optional required-bearer mode) is the only
     MCP server acceptance ever configures; real web-search servers are
     owner-approved runs with the allowlist printed and `mcp_calls`
     recorded. The containerized tool-server pattern is the
     `mcp-fixture` Compose service (test profile).

## 2. Current baseline

Repository state at handoff creation:

- `master`: the head after the July 12, 2026 Session 32 PR (row 9
  finished — the entailment detector + compat verification — the PR
  that carries this file). Sessions 25–31 (PRs
  #63/#64/#67/#68/#71/#72/#73), the wall-clock benchmark + expansion
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
  documents total in `documents` (pilot residue tombstoned;
  pilot-provenance entities read contested — the standard
  lazy-recovery residue; the two promoted
  `research:trellis/estimation-discipline/{contract,evidence}` docs
  remain). Module #2 (`modules/estimation-discipline/`, version 1) is
  RETIRED (manifest status `retired`, loader refuses composition; the
  graph entity `module:estimation-discipline` persists as the
  historical record, uncontested, 19 research hashes). Roadmap §4 rows
  5/6/6a/8/9 are STRUCK; row 10 is next; row 7 stays trigger-blocked.
- Session 32 changed NO Python kernel file and NO prompt byte. New:
  `src/core/graph/entailment_detection.ts` (+ its 10-test unit file),
  `scripts/entailment_sweep.ts`, the `EntailmentResponseSchema` in
  `schemas.ts`, the `ENTAILMENT_*` config twins, the
  `entailmentPairsTotal` metric, the verification worker's job-name
  dispatch (existing job shape byte-identical), and the
  `entailment:sweep` npm script (`package.json` changed — the Docker
  npm ci layer invalidated once, rebuilt in the Session 32 Compose
  run). `scripts/test_verification_sweep.ts` was REPAIRED
  (sha256-derived 64-hex fixture hashes — it had been broken since
  Session 14) and extended 35 → 66 checks (sections [7]–[9]; the
  worker/queue now close at the END of the drill). Detector edge
  properties (`entailmentCheckedHashes`, `entailmentCheckedAt`,
  `unsupportedHashes`, `entailmentFlaggedAt`, `contestedReason:
  'unsupported_citation'`) are additive audit fields — no existing
  field's semantics moved. Both composed-prompt pins unmoved (default
  `5d27e474…fe2a`, omit-arm `45987904…0b56` — recompute BOTH in the
  same commit only if the kernel prompt or rubric legitimately
  changes). Reminder from Session 24: `block_parity.test.ts` SPAWNS
  the real Python walk inside plain `npm test` (interpreter from
  `PYTHON_EXECUTABLE` or the platform default) — a machine without
  Python on PATH will fail the unit suite; CI sets up Python 3.13
  before `npm test`.
- July 12, 2026 (owner-directed prompt-engineering pass, PR #69):
  targeted structural prompt improvements — the code-extraction
  prompt's hypershot fact frame (legacy prose bytes UNTOUCHED), the
  orchestrator prompt's JSON hypershot frame, two kernel run-on
  instruction blocks restructured — a WITTING kernel prompt change:
  BOTH composed-prompt pins recomputed with history recorded
  (`test_modules.py`): default `3f07295a…4b63` → `5d27e474…fe2a`;
  omit-arm `85362b81…71bb` → `45987904…0b56`. The roadmap §5c entry
  records the two operational defects found mid-run (a stale pilot
  worker from another worktree consuming the queue — check for stale
  consumers BEFORE any paid enqueue; a worker instance orphaned by
  parent-only kill on Windows — kill worker trees by child PID). The
  same PR added the root `AGENTS.md` — the invariant-only agent entry
  point. Its layer contract is deliberate and PERMANENT: AGENTS.md
  carries ONLY cross-session invariants and POINTS here for everything
  volatile (objective, counts, pins, DB state) — never duplicate
  volatile facts into it, and keep it consistent when a permanent
  guardrail genuinely changes.
- Offline baseline: `npm test` = 740 passing across 80 files
  (Session 32 added `entailment_detection.test.ts`, 10 tests, over the
  730/79 base).
- `npm run build` and `npm run python:check` pass (the check imports
  polars — an environment without it fails the check by design).
- `npm run drill:scale`: gate CLOSED at max provenance 286. Session 32
  read 2.04x CLOSED (in-band ~1.48x–2.26x, first try); Session 31
  2.09x; Session 30 1.89x; Session 29 1.97x; Session 28 first read
  2.65x — OUTSIDE the band — and the precedent re-run read 1.77x
  CLOSED (non-reproducing, most plausibly same-day drill traffic on
  the shared dev database). If a future run reads OPEN, re-run before
  believing it — and if it REPRODUCES, that is the recorded migration
  trigger (roadmap §4 row 7) and the owner adjudicates. The drill
  rewrites the tracked `scale_drill_results.json` — commit it with the
  session PR (house practice; the committed copy is Session 32's 2.04x
  CLOSED run). Run the scale drill ALONE — never concurrently with
  other live drills on the shared dev database (the Session 28
  outlier's most plausible cause).
- Live zero-LLM checks (Session 32 observed, all green):
  `test:answer-channel` (32), `test:modules` (green — pins unmoved),
  `test:textedit` (105 on this Windows host; 106 on POSIX — the
  executable-bit check is POSIX-only; also in CI),
  `test:module-lifecycle` (60), `test:promotion` (41),
  `test:rlm-workspace` (106), `test:rlm-mcp` (86),
  `test:rlm-sandbox` (53), `test:verification-sweep` (66 — was 35, and
  was BROKEN at Session 32 start; now a permanent member of the
  close-out block), `test:agent-loop` (35 / ALL CHECKS PASSED),
  `test:a2a` (46), `test:repo-ingest` (56),
  `test:benchmark-hardening` (24), `test:entity-resolution` (34),
  `test:api-hardening` (18), `test:belief-recovery` (30),
  `test:invalidation-sweep` (17).
- Isolated Compose integration: 11 assertions (`--profile test`,
  unique project name, host ports 0 via `TRELLIS_*_HOST_PORT=0`;
  includes the containerized credentialed MCP fixture probe and the
  in-container `polars 1.34.0` import probe). Session 32 ran it as
  project `trellis_s32_ci` (all 11 PASS) and tore it down with
  `--volumes`. NOTE: the machine's C: drive runs close to full
  (~19 GB free at Session 32's close) and a FULL image rebuild needs
  several GB of headroom. Changing `package.json` invalidates the
  Docker `npm ci` layer; changing `requirements.txt` invalidates the
  pip layer.
- The standing owner-conditional items: **(1) the judge-calibration
  decision for derived-classification claims** (the July 13, 2026
  measured sweep — 25 pairs, $0.0093 — found the strict judge flagging
  8/25 question-body `has_category` pairs whose text supports but does
  not STATE the classification; options: a classification-aware judge
  prompt variant vs accepting conservative contests; owner-picked —
  the 9 heading-block flags in the same sweep were VERIFIED real weak
  citations, so the detector's core class works as built); (2) the
  next proof-run depth increment (the Session 29 mode-preservation fix
  unblocks the executable-file case as a candidate); (3) the pandas
  head-to-head probe round; (4) the cross-process concurrency proof
  run (coverage-audit gap #1). All propose-with-estimate, never
  self-served. Note the sweep left 15 contested OOLONG-era edges on
  the dev graph — standard lazy-recovery residue, recovered by
  re-derivation citing the body block.
- CI target is Node 22 (the `offline` job also runs `test:textedit`
  after its Python-runtime install — Session 29). Session 32's local
  environment was Node 20.19.2, Python 3.13.1, Docker Compose v2,
  PostgreSQL 16.14, Neo4j 5.11.
- Python runtime deps are pinned in `requirements.txt` (`rlms==0.1.3`,
  `openai`, `neo4j`, `psycopg2-binary`, `unstructured`, `mcp==1.12.4`,
  and — Session 27 — `polars==1.34.0`, the engine-side analytics tier:
  pinned NOT adopted, no kernel/contract/prompt path imports it);
  `npm run python:check` verifies syntax/imports/assets — including
  `trellis_textedit.py`, `trellis_answer.py`, `trellis_blocks.py`, the
  `pandas` import (pillar-load-bearing; installed transitively via
  `unstructured`), and the `polars` import (a broken environment must
  fail the check, not a paid run). Local dev measured pandas 2.2.3 /
  pyarrow 24.0.0 / polars 1.34.0; the Docker image carries
  `pandas==3.0.3` (pinned in requirements-pdf-fast.txt) and polars
  1.34.0 (proven by the Compose probe). Pillar §7's structure guidance
  stands at "plain loops until a measured threshold".
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

## 3. Session 33 problem statement

**Kernel-level retrieval discipline: dedup + budgets (roadmap §4
row 10)** — the mechanical closure of the behavior retired module #2
nudged. The Session 28 control measured the shape of the problem: with
the discipline module OFF, runs re-fetched evidence they already held
(median db calls 2 vs the recorded minimal-evidence bound of 1; the
frank corpus median 4) — and the prompt-module answer was retired
because it bought the behavior at a net token LOSS pooled. The owner's
permanent direction: close the failure class by tooling shape. Row 10
is that closure at the three retrieval surfaces in
`src/rlm/trellis_tools.py` (`get_ast_texts`, `get_ast_blocks`,
`vector_search`).

The recorded slices (roadmap §4 row 10):

- **(a) Held-root tracking** — engine-side bookkeeping of which
  roots/blocks/hashes this run already fetched, zero model judgment.
  This is a DIFFERENT structure from the Session 30 retrieval set
  (which is a provenance fact and must stay untouched); the
  `PROVENANCE_THREADING.md` §4 note is binding — the shared seam is
  the CALL SITES, not the set. Held-root state answers "were these
  bytes already served this run"; the retrieval set answers "which
  addresses may this run cite". They must never feed each other.
- **(b) Dedup: serve-or-refuse** — a re-fetch of already-held content
  either serves from held state or refuses with a typed pointer to
  the earlier fetch; NEVER a silent change to what a FRESH fetch
  returns.
- **(c) A per-run retrieval budget** — kernel constant + operator env
  twin (bounded like every other budget), with a typed over-budget
  refusal carrying the held-state inventory (bounded echo).
- **(d) Acceptance = the Session 28 `est` suite re-run as a paired
  measurement** (owner-gated): criterion recorded BEFORE the run —
  repeat-fetches 0 by construction, tokens ≤ baseline, correctness
  non-inferior; calls and correctness reported TOGETHER, never calls
  alone (the Session 28 retirement's symmetric rule: never reward LOW
  counts either).

The machinery and its drills are zero-paid; only the (d) measurement
spends, owner-gated propose-with-estimate (Session 28's 50-run control
cost $2.3981 — estimate in that band and disclose the actual).

## 4. Required design

- **Document-first (the house DDD pattern).** Write the short design
  record BEFORE code — recommend a new
  `docs/architecture/RETRIEVAL_DISCIPLINE.md` (indexed in
  docs/README.md; a `PROVENANCE_THREADING.md` §4 cross-reference). It
  must decide and record, minimum: **the held-state structure and its
  request identity** (per root hash for `get_ast_blocks`; per hash for
  `get_ast_texts` — and the partial-overlap semantics: a re-fetch
  where SOME hashes are new serves the new remainder, refuses the
  whole call, or serves everything? decide against drill evidence;
  `vector_search` dedup identity — exact-query-match only, or
  excluded from dedup this row? semantic-similarity dedup is NOT
  mechanical — if excluded, record why); **serve vs refuse** (a
  refusal teaches reuse of the in-REPL binding the model already
  holds — the pillar's discipline; silently re-serving re-spends
  tokens; recommend REFUSE with a typed, bounded message in the
  write-gate mold, but decide and record); **scope** (per run = per
  process, module-level state in the `_tool_call_stats` lock mold,
  dies with the process, never parked — seeded runs inherit NOTHING,
  matching the retrieval set's rule); and **wiring** (a dedup REFUSAL
  changes tool behavior for every caller including existing drills
  and probe scripts — recommend activation by explicit
  construction/flag at the agent in the `retrieved_addresses_check`
  injection mold so bare construction and every existing drill stay
  byte-identical, but decide and record; whatever the decision, the
  FIRST fetch of every surface must stay byte-identical everywhere).
- **(a)+(b) implementation** (`trellis_tools.py`): held-state fed at
  the same three call sites as `_audit_add` — but its OWN structure
  and lock discipline (a sibling helper in the same lock is
  acceptable; do not overload `_audit_add`'s contract). The dedup
  refusal is typed and bounded: names the repeat (the root/hashes
  already held, first 5 + `+N more`), teaches the remedy (reuse the
  variable holding the earlier return; re-derive from it in code),
  and NEVER fires on a fresh fetch. Accessors return copies; counts
  join `TRELLIS_TELEMETRY` as counts-only fields (e.g.
  `retrieval_dedup_refusals`, `held_roots` — the
  `retrieved_addresses` mold; the Node scanner's unknown-field
  tolerance is already pinned).
- **(c) the budget** (`trellis_tools.py` + `src/config/index.ts`):
  kernel default + env twin in the `ENTAILMENT_*` mold (e.g.
  `TRELLIS_RETRIEVAL_BUDGET_PER_RUN`, int, positive, capped;
  forwarded by `buildAgentEnv` ONLY when the operator set it — the
  workspace-bounds mold, unit-pinned). The over-budget refusal is
  typed, carries counts + a bounded held-root echo, and teaches
  working from held state. The budget counts FETCHES that returned
  bytes, not addresses; dedup refusals do not consume budget. Decide
  whether the budget shares the dedup wiring (recommended: same seam,
  one decision) and record it.
- **Prompt bytes:** target NO prompt change — the refusals teach
  through the same channel every provenance violation uses. If the
  session judges a TOOLS-line teaching sentence genuinely necessary,
  it is a WITTING kernel change: both composed-prompt pins recomputed
  in the same commit, history recorded in `test_modules.py`.
- **(d) the measured acceptance (owner-gated; propose, do not
  self-serve).** Propose the `est` suite paired re-run (discipline
  wired vs not — the Session 28 arm machinery exists; if a new
  experiment flag is needed to toggle the wiring for the OFF arm, it
  follows the `TRELLIS_EXP_*` mold exactly: probe-runner-only,
  registry-style validation where applicable, `buildAgentEnv` deletes
  it unconditionally, byte-identical unset, pinned) with repeats,
  question set, pre-stated criterion, and dollar estimate.
- **What does NOT change:** the Session 30 retrieval set (definition,
  always-on semantics, `test:rlm-sandbox` [5] pins) and the
  Session 31 write gate (order, wiring, refusal bytes — [6] pins); the
  Session 32 detector (sweep-side; row 9 is CLOSED — do not rework
  it); the citation-audit buckets and flags; `trellis_answer`/
  `trellis_workspace`/`trellis_textedit`/`trellis_mcp` contracts; the
  module registry; every probe suite's question bytes; the four
  durable corpora; both composed-prompt pins (unless the witting
  teaching-line decision above is taken).

## 5. File-level starting points

Inspect before designing:

- `src/rlm/trellis_tools.py` — the three retrieval surfaces
  (`get_ast_texts`, `get_ast_blocks`, `vector_search`), `_audit_add`
  and its lock (the call-site seam), `_tool_call_stats` (the
  module-level per-run state mold), `_verify_hashes_retrieved` (the
  typed-refusal mold and the injection-wiring precedent).
- `docs/architecture/PROVENANCE_THREADING.md` §4 — the recorded
  held-root note (different structure, shared call sites) and the
  per-run scope semantics row 10 must match.
- `src/benchmarks/effective_context/estimation_suite.ts` +
  `module_arm.ts` + the probe runner — the acceptance harness and the
  experiment-arm mold (Session 28).
- `src/config/index.ts` — the `ENTAILMENT_*` twins (the newest
  bounded-config example) and the workspace-bounds forwarding mold in
  `src/workers/rlm_job.ts` (`buildAgentEnv`).
- `scripts/test_rlm_sandbox.py` — sections [5]/[6] (the pin molds for
  tool-layer state and typed refusals; row 10's pins are the next
  section).
- `docs/architecture/CODE_MEDIATED_TEXT.md` §7 + the Session 28
  control section of
  `docs/benchmarks/EFFECTIVE_CONTEXT_PROBE_REPORT.md` — the measured
  evidence for what the discipline should buy (db calls median 2 vs
  bound 1 with no discipline; the token reversal on large corpora).

## 6. Test strategy and acceptance

Everything this session is zero-paid except the OWNER-GATED `est`
paired measurement (propose with estimates; run only on approval).

- **Unit level** (if any pure TS surface is added, e.g. an experiment
  flag resolver): the Session 28 `module_arm.ts` test mold. The
  Python-side logic is drill-pinned (the house pattern for
  `trellis_tools.py`).
- **Drill level** (`test:rlm-sandbox` new section, the [5]/[6] molds;
  counts reported before → after): fresh fetches unaffected (bytes
  byte-identical to today for the first fetch of every surface); a
  repeat fetch refuses with the typed message naming the held
  root/hashes (bounded echo) — or serves, per the recorded decision;
  partial-overlap semantics exactly as recorded; the budget refusal
  fires at budget+1 with the inventory echo; dedup refusals do not
  consume budget; bare construction (or the unwired default, per the
  recorded wiring decision) byte-identical to today — the
  injection-mold pin; the retrieval SET still records exactly as
  before (dedup/budget never mutate it — the section [5] invariants
  re-proven under the new machinery); seeded runs inherit no held
  state; telemetry counts present; a static agent-wiring pin.
- **The `est` acceptance run** (owner-gated): criterion pre-stated in
  the roadmap entry before spending; correctness AND calls reported
  together; actual cost disclosed against the estimate.
- The full standing drill block stays green; run `drill:scale` ALONE
  (never concurrent with other live drills — the Session 28 outlier
  precedent).

Required close-out (the standing block — `test:verification-sweep` is
a permanent member since Session 32):

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
  counts, and defects found; strike row 10 only when its machinery is
  landed AND its measured acceptance has either run (actuals recorded)
  or stands proposed owner-gated — record which.
- `HANDOFF.md`: regenerate per §0 — including the §0 step 5 re-check.
  NOTE for objective selection: the sequence is OWNER-APPROVED
  (July 12, 2026): after row 10, the next row is **row 11 —
  Trellis-on-Trellis: full-repo extraction + graph-informed
  self-edits** (two stages, each owner-gated at its paid step; stage 1
  proposes the full-repository extraction run with the CLI's printed
  post-exclusion block bound and estimate; stage 2 escalates self-edit
  depth with graph queries about the code being edited — single named
  failure mode per increment, human `git diff` review before
  acceptance, toolkit never touches git). Row 7 stays trigger-blocked;
  prompt-module authoring stays deprioritized permanently. Keep the
  narrative window: full paragraphs for the most recent FIVE sessions
  only (29–33 after this session) — compress the oldest into the
  digest and move its roadmap §5 entry verbatim to
  `docs/archive/ROADMAP_HISTORY.md`. The standing owner-conditional
  items: the judge-calibration decision for classification claims
  (from the July 13 measured sweep), the proof-run depth increment,
  the pandas head-to-head probe round, and the cross-process
  concurrency proof run — all propose-with-estimate, never
  self-served.

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
   `mergeWithAstLivenessFence`. The Session 32 detector invariants are
   permanent: detector-not-gate (the entailment tier FLAGS into the
   contested machinery — it never deletes and never becomes a write
   gate); each (edge, cited-hash) pair judged AT MOST ONCE
   (`entailmentCheckedHashes` + `unsupportedHashes` are additive audit
   properties — provenance fields never mutated by a verdict); the
   typed reason `unsupported_citation`; judge-all-then-write atomicity
   (a judge infrastructure failure contests NOTHING — never a
   provenance verdict).
4. Row-10 machinery is bookkeeping over retrieval, never over
   citability: held-root/budget state must NEVER feed, filter, or gate
   the Session 30 retrieval set or the Session 31 write gate — a
   refused re-fetch changes nothing about what the run may cite (it
   already retrieved those bytes). The machinery and its drills are
   ZERO-paid; the measured acceptance run and any proof run are
   owner-gated propose-with-estimate under the standing ≤$5/run cap,
   actuals recorded in the roadmap. Never reward citation count
   anywhere — and never reward LOW tool-call or retrieval counts
   either (report calls and correctness TOGETHER).
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
   no-git-token pin), the Session 30 retrieval-set invariants (the
   set is ALWAYS ON — never experiment-gated, never configurable off;
   its contributing surfaces are exactly the three recorded ones; its
   exclusions are by decision not just by shape; the accessor returns
   a copy; the set is never parked/serialized), the Session 31
   write-gate invariants (the retrieval-membership check is the THIRD
   layer in the fixed order, wired ONLY by explicit construction at
   the agent — never module-global, never environment-gated, never
   default-on for bare construction — its refusal typed and bounded,
   the cited audit recording the attempt before the refusal), and the
   Session 32 detector invariants (guardrail 3). None of these is
   ever weakened or made configurable. `TRELLIS_EXP_OMIT_CMT` and
   `TRELLIS_EXP_MODULES` stay experiment-only: off by default,
   byte-identical unset (pinned), never set by any
   default/worker/Compose config, never forwarded by `buildAgentEnv`
   — and any NEW experiment flag row 10 needs follows the same mold,
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
   implementation does not deliver. Row 9's version: slice (d) closed
   T1, not T2 — never describe the retrieval-set constraint as
   "closing laundering"; the record's §1 taxonomy is the required
   vocabulary; the detector is a SAMPLED measure of the T2 residual
   at a rate — report the rate with every claim. Row 10's version:
   dedup closes REPEAT fetches; it does not make retrieval optimal —
   the budget bounds spend, it does not guarantee sufficiency.
9. Do not break existing consumers: the composed-prompt pins
   (`5d27e474…fe2a` default / `45987904…0b56` omit-arm since the
   July 12, 2026 prompt-engineering pass, `test:modules` [4]/[7])
   move only with a witting kernel change, both recomputed in the
   same commit; module #1's pins hold; the legacy extraction-job
   payload and the `prose` payload both process with the exact pinned
   legacy prompt bytes; `TRELLIS_RESULT`/`TRELLIS_TELEMETRY`
   semantics are additive only; the API, A2A, and SSE contracts are
   untouched; the `get_ast_texts`/`nodeText` reconstruction bytes do
   not change; the FIRST fetch of every retrieval surface returns
   byte-identical results to today; bare `TrellisNeo4j(...)`
   construction keeps writing exactly as today; the verification
   worker keeps processing the existing job shape byte-for-byte; and
   the drills and probe scripts that fetch repeatedly today (sandbox
   sections [1]–[6], the probe corpora re-reads) must keep passing —
   decide the row-10 wiring so they do.
10. Respect the rlms prompt contract: extend `RLM_SYSTEM_PROMPT`,
    never replace it; no literal curly braces in anything rlms
    formats; no rlms library modifications.
11. Follow the T16 observability house style: file paths, prompts,
    extraction text, hashes, and retrieved addresses never become
    metric label values; counts are label-bounded; entity names may
    appear in log CONTENT per the dropped-action precedent; operator
    CLIs may print hashes (the `promote` precedent).
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
    write path; retrieval discipline (row 10) is this doctrine applied
    to retrieval spend: the engine tracks held state, the engine
    enforces budgets, the model reuses bindings it already holds.
    Prompt text may reinforce the discipline but never substitutes for
    tooling shape.

## 8. Explicit exclusions

Do not include: running the `est` paired acceptance measurement or
ANY paid run without explicit owner approval (all stand
propose-with-estimate; the first entailment sweep RAN owner-approved
July 13, 2026 — actuals in the Session 32 roadmap entry item 3; a
SECOND sweep or a judge-calibration change is a new owner decision);
reworking row 9 in any form (the detector ships as recorded —
detector-not-gate is permanent; do not wire it into the write path, do
not change its stamps, reasons, or judged-at-most-once semantics, do
not repurpose the `TRELLIS_CITATION_*` env flags); feeding, filtering,
or gating the Session 30 retrieval set or the Session 31 write gate
from row-10 held-state (guardrail 4 — the structures share call sites
only); redefining the retrieval set (its surfaces and exclusions are
recorded in `PROVENANCE_THREADING.md` §3 and pinned by
`test:rlm-sandbox` [5] — a change there is a recorded correction with
owner visibility, not a convenience edit); weakening, reordering, or
merging the three write-path layers (format → existence → retrieval
membership — fixed order, fail-fast); making row-10 dedup/budget
mutate what a FIRST fetch returns (dedup applies to repeats only;
fresh-fetch bytes are pinned byte-identical); silently serving stale
or transformed bytes on a repeat fetch (serve means the same bytes;
refuse means a typed refusal — decide and record, never blur); parking
or seeding held-root state (per run = per process, dies with the
process — the retrieval set's rule); un-retiring module #2 or
authoring ANY new protocol module (deprioritized permanently; explicit
owner request only); re-running or extending the Session 28 control or
ANY measured probe round outside the row-10 (d) acceptance proposal;
starting row 11 (full-repo extraction / graph-informed self-edits —
record seam observations in row-11 terms if found, implement nothing);
running the cross-process concurrency proof run (coverage-audit gap
#1) or any proof-run depth increment without owner approval — propose
with estimates; weakening ANY Session 29 `write_back` hardening pin,
the `StaleFileError` semantics, the splice "\n"-only refusal, or any
textedit gating/containment/hash-guard pin; claiming full TOCTOU
closure (the residual window is documented, not closed — OS locking
stays out of scope); claiming the retrieval-set constraint closes
laundering (it closed T1; T2 is the detector's SAMPLED residual —
guardrail 8); claiming dedup/budgets make retrieval optimal (they
close repeats and bound spend — guardrail 8); ANY data-plane
representation migration at ANY boundary (the Session 27 verdict
stands; re-entry only through the review's benchmark matrix with owner
sign-off); importing polars in any `src/` path, kernel surface, or
prompt; raising any workspace/scratch/textedit cap without first
re-running the M1 fixture at the target size (the cap-raise doctrine,
pillar §7); asserting on wall-clock timings in any drill; re-running
the extraction pilot or widening the generic-identifier denylist /
test-fixture patterns without observed counts; changing
`get_ast_texts`/`nodeText` block-boundary semantics (SUPERSEDED by
`get_ast_blocks`, confirmed closed by round 4); a fifth
effective-context probe round (the `est` acceptance re-run under
row 10(d) is NOT a probe round — round numbering stays untouched);
embedding any probe corpus; weakening or toggling the §6.2 kernel
block outside the `TRELLIS_EXP_OMIT_CMT` experiment flag; setting
`TRELLIS_EXP_MODULES` (or any new experiment flag) anywhere but a
probe invocation's own environment; moving the composed-prompt pins
outside the §4 witting-teaching-line decision; new MCP servers or
transports; A2A changes; frontend work (deferred unscheduled);
`ASTRef`/`EVIDENCED_BY` migration (gate CLOSED; Sessions 23–32 read
1.84x, 2.11x, 1.99x–2.01x, 1.78x, 1.99x, 1.77x-after-outlier, 1.97x,
1.89x, 2.09x, and 2.04x, inside the band — do not migrate on a noisy
reading); T13 re-hashing; rlms library modifications; weakening the
Session 14 write-path enforcement, the Session 15/20/22/24
composition pins, the Session 16 lineage pins, the Session 17
promotion refusals, the Session 18 registration gates, the Session 19
authoring-mode / anchor-gate / draft-scanner / template pins (as
calibrated in Session 21), the Session 20 textedit
gating/containment/hash-guard pins (as corrected in Session 26 and
hardened in Session 29), the Session 22 answer-channel refusals, the
Session 24 block-walk parity pin, the Session 25 extraction gates,
the Session 27 M1/M7 standing fixtures, the Session 28 module-arm
validation and est-suite truth pins, the Session 30 retrieval-set
tracking pins, the Session 31 write-gate pins, or the Session 32
detector pins (unit + drill sections [7]–[9], including the repaired
64-hex fixture-hash discipline in `test_verification_sweep.ts`).
