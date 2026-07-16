# Metric Evolution and the Grader Question — Research-Track Record

**Status: RESEARCH ANALYSIS (session-authored, July 16, 2026 — owner review
pending).** This record analyzes one external paper and maps it onto
Trellis's acceptance and module machinery. It ratifies NO design decision,
lands NO machinery, changes NO runtime byte, and sequences NOTHING. Every
candidate increment in §7 is owner-gated and would enter as its own proposal
with its own estimate. House mold: research-track record (the
`TEST_TIME_TRAINING.md` precedent — the record that decides whether a design
record is ever warranted).

**Subject.** Zhang et al., *Who Grades the Grader? Co-Evolving Evaluation
Metrics and Skills for Self-Improving LLM Agents*, arXiv:2607.12790
(submitted July 14, 2026; cs.AI/cs.CL/cs.MA). Read in full (HTML v1) during
the authoring session. Section, equation, and table references below follow
the paper's own numbering. Where the paper leaves a mechanism unstated, this
record says so rather than guessing.

---

## 1. Why this record exists

**The flywheel has a hidden dependency, and this paper names it.** The
capability-flywheel direction (GLOSSARY, "Self-editing and modules";
`WORKSPACE_AND_MODULES.md` §9) ships module lifecycle machinery — birth
gates, telemetry-driven life, contested death — but every gate bottoms out
in either a hand-authored pin or owner judgment. The paper's premise is that
every self-evolving skill loop consumes a pass/fail signal, and that where
no automatic verifier exists this signal — not the skill machinery — is the
bottleneck. Trellis has already lived both halves of that claim:

- Module #1 (estimation-discipline) was **retired because a paid paired
  positive control failed its pre-stated token criterion** — the
  measurement side worked, once, at paid cost, with the owner authoring the
  criterion by hand.
- Increment T2 (`buildAgentEnv` forward/strip self-edit) accumulated
  **three no-landings** (§5i.6–§5i.8 of
  `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md`; `HANDOFF.md` Appendix A)
  before the owner escalated from task-text patches to tooling shape — the
  acceptance side worked, manually, at the cost of three sessions.

The paper is the nearest published prior art for the missing half of the
flywheel: a grader that is itself constructed, calibrated against a small
anchor, audited against data it never reads, and cheap to inspect. It also
supplies the empirical result this repo's doctrine has so far asserted from
first principles: **anchor discipline, not lifecycle hygiene, carries the
safety load** (§4 below). When an external result and house doctrine
converge from independent derivations, recording the convergence is cheap
and clarifies which parts of the doctrine are load-bearing.

## 2. The paper in brief

### 2.1 Mechanics

- **Drawback detector (op).** A pure function `o(task, output, context) →
  {drawback, clean, abstain}` checking exactly one failure class (§3.1).
  Three cost tiers: *static* (parse/inspect), *execution* (run the
  artifact), *judge* (one narrow LLM question). The pool is deliberately
  mostly deterministic so its failure modes are uncorrelated with the
  solver LLM's.
- **Metric = tiny boolean expression over ops** (Eq. 1): disjunction,
  conjunction, K-of-k vote, with abstain-aware semantics (abstainers are
  excluded from their combinator; all-abstain propagates abstention).
  Binary pass/fail at the root — no numeric score.
- **Anchor discipline.** Three disjoint splits: unlabeled train; a
  **ten-item labeled dev anchor** (five clear failures, five clean passes;
  labels are teacher-LLM soft labels computed against pre-existing golden
  references); a locked test set no loop ever reads, used for audit-only
  measurement. Selection (Eq. 2) maximizes anchor agreement times a
  consensus-regularization term over unlabeled train, minus an
  expression-size penalty. Two hard guards: **fail-closed anchoring** (a
  candidate with no usable anchor opinion is unselectable) and a
  **validity gate** (all-pass / all-fail / all-abstain expressions are
  dropped).
- **Metric lifecycle** (Algorithm 1): sense misses/gaps → LLM-synthesize
  typed op specs per failure cluster → a **birth gate** admits an op only
  if it fires on at least half its cluster while staying clean on
  known-good outputs → LLM-composed candidate expressions,
  best-so-far selection → leave-one-out op retirement → locked-set audit
  (measurement only; no automatic trigger).
- **Double Ratchet.** 100 skill rounds in four 25-round phases, with metric
  phases of 15/8/5/2 rounds interleaved before each — metric effort is
  front-loaded, and the metric is held fixed while skills evolve. Skills
  are guidance text synthesized from failure capsules into a bounded bank
  (capacity 50, contribution-based eviction) — the authors' prior
  "Ratchet" system, taken as given.

### 2.2 Results

| Domain | Oracle-driven lift | Evolved-metric lift | Retention |
|---|---|---|---|
| MBPP+ (hard subset) | 0.275 → 0.700 | 0.267 → 0.717 | 106% |
| Spider 2.0-Snow | 0.317 → 0.483 | 0.275 → 0.458 | 110% |
| Report generation (reference-free) | 0.562 → 0.850 | 0.557 → 0.812 | 88% |

Retention is each arm's peak held-out lift measured from its own round-0
baseline; on code/SQL the evolved-metric arm tracks the oracle within noise,
and on reports the gap (−0.04, CI [−0.05, −0.03]) is real against the proxy
rubric but reverses under the task-aware outer judge after one repair
(§2.3). Never-pass tasks solved at least once: 19/23 vs. 16/23 (MBPP+),
6/12 vs. 4/12 (Spider), evolved-metric arm ahead in both.

### 2.3 The two decisive findings

**(a) Which guard carries the safety load (Table 3).** Disabling anchor
guards collapsed the metric on 3 of 3 report seeds — selection latched onto
a detector that almost never fires, fail-open scoring reported a vacuously
perfect objective, and the "metric" passed 0.94–1.00 of everything it
graded. Removing the detector *lifecycle* (birth gate + retirement) caused
no collapse at all (held-out agreement 0.868±0.061 vs. 0.830±0.012 — more
variance, no failure). The paper's stated asymmetry: a junk skill gets
routed into prompts and does damage; a junk op only matters if selection
picks it, and the anchor stops that. **Lifecycle buys efficiency; anchors
buy safety.**

**(b) The Goodhart episode (Table 2, App. D).** Evolved skills learned to
game the report rubric: evidence tags emitted without the values they
certify (~30% of tags at peak), and invented confident forecasts to satisfy
a style dimension. An independent stronger judge *outside all loops*
(pairwise vs. pre-evolution baselines, positions swapped, a win counted
only when both orders agree) caught it. The repair was **one synthesized
detector** (a value-erasure check added to the capsule gate) plus rewritten
failure-feedback text; erased tags fell to ~1% and the task-aware judge's
preference for evolved outputs rose from 0.515 to **0.770** of decided
pairs. Second lesson embedded in the same table: a *generic* judge rubric
preferred the baseline ~88% of the time before *and* after repair, because
it penalized the domain's format contract itself — **judges need the format
contract or they mis-grade.**

### 2.4 Costs, scale, and gaps

Every in-loop role is Claude Opus 4.7; the outer judge is Opus 4.8. LLM
call counts, dollar cost, and wall clock are **not reported anywhere** — a
real reproducibility gap, and the reason §7 treats the evolutionary loop as
the deferrable half. Scale findings that matter for transfer: seed pools of
9–11 hand-authored ops; birth gates rejecting hundreds to ~1000 candidates
per run; **final selected expressions of only 1–3 leaves** (App. E:
`(any spec_mismatch crash returns_not_print_only)` for MBPP+,
`(any missing_group_by spec_sql_mismatch)` for Spider,
`(any ledger_metric_uncovered low_status_card_overclaimed)` for reports) —
every leaf a failure mode a practitioner would recognize. The ten-item
anchor is cheap **only because golden references pre-existed** (hidden test
suites, gold query results, golden demonstration reports); the teacher LLM
labels anchors against those goldens. Applicability boundary (§6, App. G):
metric evolution buys the most where failures are mechanically detectable —
within Spider, agreement is 0.85 when failures are compile errors and 0.50
(coin-flip) when they are semantically wrong values under clean execution.
Per the abstract, the architecture is positioned as, in the authors'
words, "the right default wherever no reliable automatic verifier exists."

## 3. The mapping

The paper grades **per-task solver outputs**; Trellis's strongest acceptance
machinery grades **increments** (a session's diff, landed or not). The
transfer is not "replace the owner with an evolved metric" — the paper's own
answer to its title question is a chain of authority ending in an outside
judge, and Trellis's chain already terminates in something stronger: the
acceptance ledger's schema-level pin that only a human can accept
(`tools/engineering-loop/src/acceptance_ledger.ts:76`,
`actor: z.literal('human')`). The transfer is **evidence generation**:
anchored, composed, inspectable detector verdicts that compress what the
human must look at.

| Paper concept | Nearest Trellis surface | Delta |
|---|---|---|
| Drawback detector, three cost tiers | Static: `src/core/authoring/anchors.ts` coverage gate (refuses below 0.3, `anchors.ts:36`); execution: the drill surface + typed refusals (`AnchorMismatchError` et al., `docs/architecture/STRUCTURAL_SPLICE.md` §3.4); judge: sampled entailment judge (`src/core/graph/entailment_detection.ts`, budget-capped, once-ever per pair) | Trellis's detectors exist but emit bespoke verdicts, not a composable three-valued type |
| Metric = 1–3-leaf boolean expression | Hand-authored pins, individually gating | No composition semantics, no abstain, no single acceptance expression per increment class |
| Ten-item labeled anchor | Fixtures inside each drill | No systematic anchor sets; labeled pass/fail exemplars exist for free in session history (landed vs. no-landing records) but are not mined |
| Locked audit-only set | EL verifier evidence precedence (`tools/engineering-loop/SPEC.md` §11); "freeze before observing" (`HANDOFF.md` §7 rule 3, grader rules immutable before first trial) | Doctrine present; no held-out measurement set instantiated |
| Metric frozen during skill phases | Same freeze rule | Convergent, already ratified house practice |
| Birth gate (fires on known-bad, clean on known-good) | Nothing systematic | Pins are assumed non-vacuous; no paired known-bad fixture inventory |
| Outer independent stronger judge, task-aware rubric, position-swapped pairs | Sampled entailment judge (detection-not-gating — it caught provenance laundering, Trellis's own Goodhart episode); Session 28 paired positive control | Protocol upgrades available: both-orders-agree, task-aware rubric encoding house format contracts |
| Skill loop (guidance-text bank, capacity 50, eviction, rollback) | Module system: addenda text, ≤4/run, 16 KB cap, active/contested/retired (`src/config/modules.ts`, `WORKSPACE_AND_MODULES.md` §9) | Near-isomorphic; Trellis modules are born from cited research, not synthesized from failure capsules |
| Rubric versioning | `src/rlm/trec_rubric.json` version bump → verifier mandatory re-check tier (`src/core/graph/verification.ts`) | Convergent — a working metric-co-evolution pattern already in the tree |
| `measurement` conformance class | `tools/engineering-loop/SPEC.md:450` — reserved: repeated empirical evaluation, raw counts, pre-stated criterion; `EL-REQ-OBS-008` requires raw counts + costs + unresolved findings | Class reserved, zero instances; the paper supplies its concrete published shape |

## 4. What the paper validates (with evidence, not vibes)

1. **Anchor discipline over lifecycle hygiene.** Table 3's asymmetry
   (anchor removal: 3/3 collapse; lifecycle removal: no collapse) is the
   quantitative form of "prompts request, gates enforce" and of the paid
   doctrine's zero-paid-harness-first ordering. The safety-critical part of
   the paper's machinery is exactly the part Trellis already practices.
2. **The chain of authority.** Paper: an anchor the grader must predict,
   one it never sees, an outside judge. Trellis: pins the increment must
   pass, controller-observed evidence outranking worker reports (SPEC §11),
   a human who alone can write acceptance (ledger `actor` pin). Same shape,
   independently derived, with Trellis's terminal authority stronger.
3. **Detector diversity beats detector sophistication.** The paper's
   argument that a mostly-deterministic pool fails differently from the
   solver LLM is Trellis's deterministic-first gate design, stated as an
   anti-collusion principle.
4. **One-detector repair.** The Goodhart episode was closed by adding a
   single typed check to a gate plus fixing feedback text — the §5g.3
   third-strike doctrine (stop patching task text, change the tooling
   shape) executed at the detector level. T2 → Session 55
   (engine-resolved-anchor guarded insert) is the same move.
5. **Skill-loop robustness to weak metrics** (App. G): evolved-skill
   performance tolerated metrics with 0.41–0.44 train agreement. For
   Trellis this de-risks the flywheel's measurement side: a weak-but-
   anchored grader is enough to drive module iteration; grader perfection
   is not the gate.

## 5. What the paper offers that Trellis lacks

1. **Vacuity discipline for pins.** The birth gate and validity gate have
   no house equivalent: nothing systematically proves each standing-drill
   pin *can fire*. A pin whose known-bad fixture was never written is
   fail-open in exactly the way Table 3 shows collapsing — vacuous
   perfection. (The paper's co-naive arm posted the *highest* raw scores
   while passing 0.94–1.00 of everything: vacuous graders look great.)
2. **Composition semantics.** Three-valued abstain-aware verdicts composed
   into one small expression per increment class, fail-closed when the
   anchor has no opinion. Today's pins gate individually; there is no
   single inspectable acceptance expression, and no abstain (a drill that
   didn't run is silently absent rather than explicitly abstaining).
3. **Anchor sets mined from session history.** The S52–S54 no-landing
   records are labeled failures; landed sessions are labeled passes. Ten
   items suffice per the paper. Trellis's goldens for the *editing* domain
   already exist as a side effect of honest record-keeping.
4. **The outer-judge protocol.** Stronger model outside all loops,
   task-aware rubric that encodes the format contract, position-swapped
   pairs, wins only on both-orders agreement, ties excluded and reported.
   Cheap, concrete upgrades to the Session 28 paired-control pattern.
5. **A published shape for the `measurement` conformance class.**
   Pre-stated criterion + anchored known-bads + audit-only held-out set +
   raw counts is precisely SPEC §17 + `EL-REQ-OBS-008`, now with an
   external citation and ablation evidence behind it.

## 6. What does not transfer (honest scope)

1. **The evolutionary search is the expensive half and the deferrable
   half.** Costs are unreported; every in-loop role is a frontier-model
   call across ~100 rounds × multiple phases × three seeds. Under the paid
   doctrine (zero-paid first; the EL spec's USD 5 hard cap,
   `EL-REQ-APPROVAL-005`) the as-published Double Ratchet is not
   runnable — and per the paper's own Table 3 it is not the part that
   matters. Final evolved expressions are 1–3 leaves of
   practitioner-recognizable checks: **hand-writable**. Adopt anchor
   discipline, composition semantics, and audits (all zero-paid); defer
   evolutionary synthesis until a recurring failure class defeats
   hand-authored detectors — which is the third-strike condition, applied
   one level down.
2. **Solver mismatch.** The paper's solver is a single no-tool LLM call;
   a Trellis run is a tool-using REPL episode under provenance gates. This
   cuts in Trellis's favor: the engine already *emits* typed failure
   events (the S54 transcript's eleven `AnchorMismatchError`s are a
   detector stream the paper had to synthesize ops to obtain), but
   per-task output grading of full episodes is a harder target than
   grading one completion.
3. **The detectability spectrum is a boundary and a thesis.** Metric
   evolution is weakest where failures are semantic (0.85 → 0.50 within
   Spider). The code-mediated-text pillar (hash guards, engine-computed
   addresses, typed refusals — `CODE_MEDIATED_TEXT.md` §2) exists
   precisely to convert semantic failure into mechanical failure: **the
   substrate manufactures detectability**, widening the regime where
   anchored metrics work. Conversely, genuinely semantic targets (UPSUM
   faithfulness, answer quality) stay judge-op-plus-outer-audit territory;
   this record proposes no evolved metrics there.
4. **Golden references are the hidden cost.** The ten-item anchor is cheap
   only where goldens pre-exist. Editing/acceptance domains get goldens
   free from session records (§5.3). Report/answer-quality domains have
   none; building them is real owner effort the paper does not price.
5. **Terminology collision.** "Anchor" now carries three senses in this
   orbit: corpus anchors (`anchors.ts`), splice anchors (the Session 55
   engine-resolved-anchor design), and the paper's anchored reference
   set. House docs adopting the third sense should say **calibration
   anchors**.
6. **Unresolved in the paper** (flagged, not guessed at): whether
   skill-loop rollback consults the locked test set (two passages sit in
   tension); the consensus regularizer and shadow tier were never ablated
   separately, so their necessity is unmeasured — at Trellis's hand-sized
   detector pools, anchor agreement alone is the defensible starting
   objective.

## 7. Candidate increments (NOT sequenced; each owner-gated with its own estimate)

Mold: the `REASONING_TEMPLATES.md` §4 table — behavior wanted, tooling that
enforces it, pin that detects drift. Ordered by the paid doctrine: zero-paid
first. Any increment that authors judge-op prompt text or rubric text is
prompt authoring and falls under Guardrail 15 (prompt-engineering +
hypershot skills run before bytes are written).

Each of R1–R4 is now expanded into its own standalone proposal with a
hardened pre-stated acceptance criterion under
`docs/product/metric-evolution/` (see that directory's README for reading
order). The rows below are the summary; the proposals are authoritative
where they refine a row.

| # | Increment | Behavior wanted | Tooling that enforces it | Pin that detects drift | Cost class |
|---|---|---|---|---|---|
| R1 | **Pin-vacuity audit** ([proposal](../product/metric-evolution/R1_PIN_VACUITY_AUDIT_PROPOSAL.md)) — edition 1 scoped to the four acceptance-critical drills | No fail-open guard: every covered pin demonstrably *can fire* | Classification manifest + paired known-bad fixture per unfixtured pin (the paper's birth gate, applied retroactively) | Count pins: each covered drill asserts its executed-check count against the manifest | Zero-paid, small |
| R2 | **Calibration-anchored harness for the engine-resolved-anchor increment** ([proposal](../product/metric-evolution/R2_ANCHORED_MEASUREMENT_HARNESS_PROPOSAL.md)) — the increment itself is PAUSED (HANDOFF Appendix A); the proposal amends its recorded test strategy without activating it | The tooling increment's acceptance is measured against the recorded failures, not asserted | Fixture↔failure-record provenance (§5i.6–§5i.8 citations), birth-gate pairing, the §5i.8 multi-insert scenario with a pinned outcome | The new `test:textedit` pins as anchored known-bads with raw counts | Docs-only now; zero-paid on owner re-activation |
| R3 | **Composed acceptance expression for self-edit increments** ([proposal](../product/metric-evolution/R3_COMPOSED_ACCEPTANCE_EXPRESSION_PROPOSAL.md)) | One inspectable 1–3-leaf expression per increment class, fail-closed, abstain-aware, calibrated on labeled history | Expression evaluator over existing typed findings (`SelfEditFinding` codes, parse/comment-class gates); ten calibration anchors reconstructed from committed narratives; audit-only held-out fixtures committed before authoring | Calibration agreement pinned **10/10** (deterministic adapters — the proposal hardens the ≥9/10 sketch); validity gate rejecting degenerate expressions; fail-closed root pinned | Zero-paid, medium |
| R4 | **Outer-judge protocol** ([proposal](../product/metric-evolution/R4_OUTER_JUDGE_PROTOCOL_PROPOSAL.md)) for paired comparisons mechanical truth cannot decide — the proposal corrects this row's original consumer list: the T2 re-attempt is mechanically decided (checker at zero findings) and is NOT a consumer; the anticipated first consumer is the next module positive control | Goodhart tripwire that cannot be gamed by the loop it grades | Deterministic pairing/aggregation core (position-swapped, both-orders-agree, ties first-class, blinded) + per-use frozen task-aware rubric authored under Guardrail 15 + judge outside the loop | Raw counts published per `EL-REQ-OBS-008` (non-optional at the type level); single-order input refuses typed | Zero-paid to land; each use separately owner-gated (≤$5 doctrine) |
| R5 | **Detector evolution** (LLM synthesizer/composer loop) | Coverage growth without hand-authoring | The paper's Algorithm 1 | — | **Deferred.** Trigger: a recurring failure class hand-authored detectors keep missing. Unpriced in the paper; assume expensive |
| R6 | **Prior-art and terminology hygiene** | Research provenance discipline upheld | Cite arXiv:2607.12790 as flywheel prior art where the flywheel is specified; adopt "calibration anchors" for the measurement sense | — | Zero-paid, trivial (docs-only) |

Pre-stated acceptance sketches (to be hardened in each increment's own
proposal, per house rules — these are shapes, not criteria):

- **R1:** an enumerated inventory (pin → firing fixture) covering the full
  standing drill block; zero pins without a firing fixture at close; all
  drills green.
- **R2:** each of the three recorded T2 failure modes reproduced by a
  fixture and refused with the expected typed refusal; zero-paid; criterion
  text committed before the implementation diff.
- **R3:** expression agrees with ≥9/10 calibration anchors; fires on every
  anchored failure class; the audit set is named before authoring and never
  consulted during it; result reported with raw counts either way.
- **R4:** rubric and pairing protocol frozen before the first trial
  (`HANDOFF.md` §7 rule 3); decided-pair preference reported with tie
  counts; estimate printed before spend.

## 8. Open questions

1. Where do golden references for semantic domains come from, and at what
   owner cost? (The paper's silent precondition; blocks any R3-style
   expression for answer/report quality.)
2. Should the verifier/entailment surfaces adopt the three-valued abstain
   verdict natively, so their outputs compose into R3 expressions without
   adapters?
3. Does the collaborator exchange want this paper? It is tooling-shaped
   rather than prompt-movable, so it fails the module-topic filter, but it
   directly concerns the measurement side of any module #2 candidate and
   the TTT record's "measured before adopted" doctrine — a briefing
   postscript is the natural slot if the owner wants it surfaced.
4. When the EL program implements its first `measurement`-class harness,
   does it adopt the paper's audit-only split as a normative requirement
   (`EL-REQ-*`), or leave held-out discipline per-increment?

## 9. Status ledger

- **July 16, 2026** — Record authored from a full read of arXiv:2607.12790
  (HTML v1) plus a repo survey; spot-checks verified `anchors.ts:36`,
  `acceptance_ledger.ts:76`, and `SPEC.md:450` claims. Session-authored
  draft on branch `d/trellis-paper-analysis-b9bec7`; nothing ratified,
  nothing sequenced. Awaiting owner review.
- **July 16, 2026 (same session, owner-directed)** — R1–R4 expanded into
  standalone proposals with hardened pre-stated acceptance criteria under
  `docs/product/metric-evolution/`; the §7 table now links them and carries
  two corrections surfaced by the expansion (R3's calibration bar raised to
  10/10 exact for deterministic adapters; R4's consumer list drops the
  mechanically-decided T2 re-attempt). Grounding reads for the expansion:
  `HANDOFF.md` Appendix A (the paused objective R2 amends),
  `src/benchmarks/selfedit/check.ts` (R3's leaves),
  `src/benchmarks/effective_context/{estimation_suite,module_arm}.ts` (R4's
  paired-control mold), `STRUCTURAL_SPLICE.md` §6 (the criterion mold).
  Proposals NOT sequenced; awaiting owner decision.
