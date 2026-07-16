# R2 proposal — calibration-anchored acceptance for the engine-resolved-anchor increment

Status: **PROPOSAL (NOT sequenced, NOT ratified; owner-gated).** Child of
`docs/architecture/METRIC_EVOLUTION.md` §7 R2. **The tooling objective this
proposal hardens is PAUSED** (`HANDOFF.md` Appendix A: "retained for history,
do not execute"; the EL program is the owner-prioritized track). This
proposal executes nothing and re-prioritizes nothing — it upgrades the
paused objective's recorded test strategy (Appendix A.3) so that, on the day
the owner re-activates it, the increment lands in the anchored-measurement
shape. Docs-only until then; zero-paid when active.

**Terminology (one collision, named).** This proposal uses *calibration
anchors* for labeled known-bad/known-good fixtures (the paper's sense,
adopted in `METRIC_EVOLUTION.md` §6.5). The engine-resolved *anchor
substring* of `insert_after_anchor` is a splice anchor — a different thing
that happens to share the word.

## 1. What Appendix A already fixes, and the gap this proposal closes

Appendix A.1–A.3 already specify: design-record-first (a new
`STRUCTURAL_SPLICE.md` section), the additive method contract (unique
substring → engine computes address + terminator; zero/multi match → typed
refusal staging nothing), Guardrail 15 before the addendum bytes, both
composed-prompt pins recomputed in the same commit, the new drill pins
(unique-resolve, non-unique refusal, absent refusal, CRLF + LF terminators,
containment/budget unchanged), and the split between the TOOL's mechanical
acceptance (zero-paid pins) and the RLM behavior claim (deferred to the
separate owner-approved paid T2 re-attempt).

That is already most of an anchored harness. Three things are missing, and
they are exactly the three the paper's protocol supplies:

1. **Fixture provenance.** A.3 requires refusal pins but does not bind each
   planted violation to the recorded failure it reproduces. Unbound fixtures
   drift into synthetic convenience shapes; the recorded failures (§5i.6–§5i.8
   of `REPOSITORY_INGESTION_REPORT.md`) are the calibration anchors this
   increment exists to close, and the pins should say so.
2. **Birth-gate pairing.** A.3 lists refusal cases and happy paths
   separately; it does not state the pairing rule — every detection branch
   fires on a planted violation AND stays clean on the adjacent known-good —
   as the admission requirement for each new pin.
3. **The §5i.8 scenario decision, pinned.** The direct motivation (batched
   inserts whose pre-staging line numbers went stale — `AnchorMismatchError`
   ×11, no verified edit in 14/16 iterations) is a *multi-insert* scenario.
   Appendix A leaves the batch variant a design option ("do not gold-plate"),
   which is right — but whichever way the design record decides, the
   **scenario itself must be a fixture with a pinned outcome**, else the
   increment can land green while the motivating failure shape was never
   driven through it.

## 2. The decision space

### 2.1 Leave A.3 as-is; rely on the design record to add rigor — REJECTED

The design record decides the method contract; test strategy hardening left
implicit is how fixture provenance gets dropped under session pressure. The
whole point of pre-stated criteria (house rule: written before
implementation) is that rigor is cheap to specify now and expensive to
retrofit after a green landing.

### 2.2 Expand scope to a general anchored-harness framework — REJECTED

No framework. The increment needs exactly: provenance comments, pairing
discipline, one scenario fixture, and raw counts. R3 owns the general
composed-expression machinery; building it here would couple a paused
increment to an unsequenced one.

### 2.3 Amend the paused test strategy with the three missing disciplines — CHOSEN

A surgical amendment to Appendix A.3's shape, carried by this proposal until
re-activation, then folded into the increment's design-record section.

## 3. The surface (amendments to Appendix A.3, verbatim-adoptable)

1. **Calibration-anchor provenance.** Each planted violation in the new
   `test:textedit` section carries a comment naming the record it
   reproduces: the ambiguous/duplicate-anchor refusal cites §5i.7 (the
   bare-`});` class); the stale-address scenario cites §5i.8; the
   spec-perfect-diff-vs-pin case cites §5i.6 where applicable (that one is
   R1 territory — a pin mis-written in the firing direction — and is listed
   here only as NOT reproducible by this drill, honestly). A fixture with no
   citation is a synthetic addition and says so.
2. **Birth-gate pairing.** Every new detection branch (non-unique refusal,
   absent-anchor refusal, terminator handling, containment/budget refusals
   if extended) is admitted with the pair: planted violation → FIRES +
   stages nothing; adjacent known-good → clean + stages byte-exactly. No
   unpaired pin enters the drill.
3. **The §5i.8 scenario fixture.** One fixture drives the recorded shape —
   multiple inserts prepared against one frame in one pass — through the new
   method. The pinned outcome is whichever the design record chooses:
   (a) batch variant: the engine re-resolves each splice anchor after prior
   inserts stage, and the fixture asserts all inserts land byte-exactly; or
   (b) no batch variant: the fixture asserts the documented sequential
   idiom (resolve → stage → re-resolve) lands byte-exactly AND that the
   naive replay of the §5i.8 calling pattern is refused typed, not
   corrupted. Either way the motivating failure shape has a decided,
   asserted behavior.
4. **Raw counts.** The drill section prints checks-run/fired/clean counts;
   the roadmap §5 entry records them (the `EL-REQ-OBS-008` reporting mold,
   applied to a drill).

## 4. What this PREVENTS vs what it only DETECTS (honest scope)

- **Prevented:** the increment landing green without the motivating failure
  shapes ever exercised against the new contract (the vacuous-green landing).
- **Detected:** regression of the contract later — the paired pins are
  standing.
- **Not claimed:** any RLM behavior change. Appendix A's own split stands —
  these pins prove the tool's mechanical contract; whether the *model*
  stops failing the editing-execution class is decided only by the later
  measured re-attempt (§5). Guardrail 8's mold: report the contract, never
  claim the class closed for the model until the paired re-attempt shows it.

## 5. What the later paid T2 re-attempt inherits (pre-stated now, priced then)

The re-attempt remains a SEPARATE owner-approved paid proposal (Appendix A's
gate, unchanged). This proposal pre-states only its measurement shape, so
the shape is frozen long before any spend estimate exists:

- **Its own round-0 baseline:** the three recorded no-landings (§5i.6–§5i.8)
  are the baseline arm — no new baseline run is purchased.
- **Frozen criterion before the run** (HANDOFF §7 rule 3): a verified landed
  edit with the full checker at zero findings within the pre-stated
  iteration budget; `textedit_raw_splices == 0` (the Session 41 record's
  recorded lever); refusal counts and guarded-op counts REPORTED TOGETHER
  with the outcome (Guardrail 4's mold — refusals are self-correction
  signal, never a penalized count, never a rewarded one).
- **Honest failure reporting:** a no-landing is recorded as a fourth
  no-landing, with its distinct cause — never as "validated."

## 6. Pre-stated acceptance criterion

For THIS proposal (docs-only, effective immediately): it is adopted when the
owner ratifies the amendment — the criterion is a recorded owner decision
plus zero repository byte motion outside `docs/`.

For the INCREMENT on re-activation — Appendix A.3's criterion stands in
full, PLUS, zero-paid, zero-LLM, all four required:

1. Every planted violation in the new drill sections carries its §5i
   citation (or an explicit synthetic marker); a reviewer can trace each
   calibration anchor to the recorded failure it reproduces.
2. Every new detection branch is birth-gate paired (fires on the planted
   violation, clean on the adjacent known-good), and the drill would go red
   if either half were removed.
3. The §5i.8 multi-insert scenario fixture exists with its outcome pinned
   per the design record's batch decision; the naive §5i.8 calling pattern
   has an asserted typed behavior (never silent corruption).
4. The drill prints raw counts and the roadmap §5 entry records them beside
   the criterion verdict.

## 7. What does not change

The pause itself (this proposal creates no execution pressure; Appendix A's
"requires a new owner reprioritization" governs); the Appendix A.1/A.2/A.3
content it amends (carried intact, amended additively on re-activation);
`splice` and the Session 41 guarded family (byte-identical, their pins
untouched); the Guardrail 15 hard requirement before addendum bytes; the
composed-prompt pin recompute discipline; the separation between tool
acceptance (zero-paid pins) and behavioral acceptance (the paid measured
re-attempt).

## 8. Status ledger

- July 16, 2026 — proposal authored (session, branch
  `d/trellis-paper-analysis-b9bec7`), child of `METRIC_EVOLUTION.md` §7 R2.
  NOT sequenced; amends a PAUSED objective without activating it; awaiting
  owner decision.
