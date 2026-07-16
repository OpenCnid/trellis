# R3 proposal — the composed acceptance expression for self-edit increments

Status: **PROPOSAL (NOT sequenced, NOT ratified; owner-gated).** Child of
`docs/architecture/METRIC_EVOLUTION.md` §7 R3; the paper's Eq. 1 composition
semantics and ten-item calibration-anchor discipline, minus its evolutionary
synthesizer (deferred per the paper's own Table 3 — anchors carry the safety
load; evolution buys coverage at scale Trellis does not yet need). Zero-paid,
zero-LLM throughout.

## 1. The failure class

**Acceptance evidence without composition semantics.** A self-edit run today
is judged by a set of independent surfaces — the scope check, the evidence
check, the parse gate, the comment-class diff gate (`src/benchmarks/selfedit/
check.ts`), plus the drill pins — each a bespoke gate with its own output
shape. Three consequences, each observed or structurally latent:

1. **No single inspectable verdict.** "Did this run's evidence pass?" is
   answered by a human scanning heterogeneous outputs. The paper's final
   metrics are 1–3-leaf boolean expressions precisely because the audit
   surface being one small named expression is what makes a grader
   reviewable at a glance.
2. **Abstention is implicit and unnamed.** The parse gate already abstains
   honestly (extension with no wired parser: "never a finding" —
   `check.ts`, `parseGateLanguage` null); the comment-class gate is
   evaluated only for declared comment-class files. These are three-valued
   semantics in practice, but nothing in the output distinguishes "checked
   and clean" from "did not apply" — the distinction the paper's
   fail-closed rule (no usable opinion ⇒ unselectable) is built on. A
   review that reads absence-of-finding as clean when the gate abstained is
   the fail-open misread.
3. **Nothing calibrates the ensemble against labeled history.** The
   recorded failures (§5e/§5f.5/§5i of `REPOSITORY_INGESTION_REPORT.md`)
   are labeled known-bads; the landed increments are labeled known-goods.
   No committed artifact demonstrates that the assembled evidence surface,
   taken together, classifies those recorded shapes correctly.

## 2. The decision space

### 2.1 An LLM judge over run transcripts — REJECTED

The failure classes here are mechanically detectable (typed findings
already exist for every one of them), and the permanent owner direction is
tooling shape over model judgment where determinism is available. An LLM
judge belongs where mechanical detection ends (R4's outer-judge protocol,
paid, for paired comparisons) — not in the deterministic acceptance path.

### 2.2 More hard gates in `stage2:check` — REJECTED

The gates are per-invariant and additive by design (parse gate "composes
ADDITIVELY beside" the checker — `check.ts`); multiplying them does not
produce a composed verdict, abstention stays unnamed, and each new gate is
a new bespoke output for review to integrate. The missing piece is
composition, not another gate.

### 2.3 Evolutionary detector synthesis (the paper's full loop) — REJECTED (deferred)

The paper's Grow/Select machinery is its expensive, unpriced half, and its
own ablation shows the lifecycle is not where safety lives. Deferred to
`METRIC_EVOLUTION.md` §7 R5 with its recorded trigger (a recurring failure
class hand-authored detectors keep missing). Hand-composed expressions are
sufficient at the paper's own observed scale (final expressions: 1–3 leaves).

### 2.4 A hand-composed, anchor-calibrated expression over existing detectors — CHOSEN

Pure evaluation over outputs the repo already computes; three-valued
verdicts; one expression per increment class, committed as data; calibrated
against labeled history; audited against held-out fixtures it never read.

## 3. The surface

All pure functions beside the existing checker (`src/benchmarks/selfedit/`),
unit-pinned in vitest; the CLI wiring is additive and read-only.

1. **The verdict type and adapters.** `{drawback, clean, abstain}` per
   detector. Adapters map existing outputs, changing none of them:
   - scope check → `drawback` iff any `out_of_scope_edit` /
     `named_file_unchanged` finding; `clean` otherwise (it always has an
     opinion).
   - evidence check → `drawback` iff any evidence-family finding;
     `clean` otherwise.
   - parse gate → `abstain` for files with no wired parser (the existing
     null-language semantics, now named); else `drawback`/`clean`.
   - comment-class diff gate → `abstain` unless the increment declared
     comment-class (the existing conditional, now named); else
     `drawback`/`clean`.
   - pre-check (refresh-before-use) → `drawback` on its findings, `clean`
     otherwise.
2. **Combinators** (the paper's Eq. 1, exactly): `any` (drawback if any
   child fires), `all` (drawback only if all opining children fire),
   `k_of` (threshold over opining children); abstaining children are
   excluded from their combinator; a node whose children all abstain
   abstains. **Fail-closed root rule:** a root abstention is
   `not_acceptable_evidence` — a typed third outcome, never coerced to
   clean and never to drawback.
3. **Expressions as data.** One committed expression per increment class
   (this edition: `comment_class`, `executable_class`), each expected to be
   1–3 leaves over the five adapters. A **validity gate** in the tests
   rejects any expression yielding one identical verdict across the entire
   calibration set (the paper's all-pass/all-fail/all-abstain drop).
4. **Calibration anchors** (the `METRIC_EVOLUTION.md` §6.5 sense — labeled
   fixtures, not splice anchors). Ten committed fixtures as synthetic
   evaluator inputs (`SelfEditRunEvidence` + `FileParseResult[]` +
   `DiffChangedLine[]` + declared class), five bad / five good. Provenance
   rule: each fixture cites the recorded failure it reconstructs or is
   marked `synthetic (taxonomy-derived)` — the original failure diffs are
   gitignored session-local patches, so fixtures reconstruct the committed
   narrative, honestly labeled. The five bads, by source shape:
   §5e Session 36 run-1 (unparseable named file), §5f.5 Session 37 run-2
   (comment-class diff with an executable removed line), §5i.7/§5i.8
   no-landing signature (named files unchanged), plus two taxonomy-derived
   synthetics (an out-of-scope edit; a dead evidence hash). The five goods:
   reconstructions of landed-increment shapes plus taxonomy-derived clean
   synthetics, same citation rule.
5. **The held-out audit set.** Four additional labeled fixtures (two bad,
   two good) committed with their labels BEFORE any expression is authored,
   in their own file. The expression-authoring commits never touch that
   file. At close, the expression is evaluated against them ONCE and the
   raw agreement is REPORTED (roadmap §5 entry) — measurement only, no
   threshold gate, the paper's audit semantics exactly.
6. **CLI wiring.** `stage2:check` gains an additive report block: the
   expression verdict for the run's declared class, each leaf's verdict,
   and raw counts — printed beside the existing findings, changing no
   existing output line and no exit-code semantics this edition.

## 4. What this PREVENTS vs what it only DETECTS (honest scope)

- **Prevented:** the fail-open misread — abstention is now a named verdict,
  and a root abstention is typed `not_acceptable_evidence` rather than
  passing silently as absence-of-finding.
- **Detected:** ensemble drift — a change that makes the assembled evidence
  surface misclassify a recorded failure shape turns the calibration test
  red.
- **Not claimed:** anything beyond the §5e.2 boundary, which is inherited
  verbatim — the expression grades the RECORDED evidence (the chain the
  write gate constrained, the diff, the parse results), not every byte the
  run read and not query-before-edit ordering; the transcript and human
  review carry those. The expression is **evidence for review, never
  authority**: it is not a write gate (guardrail 5's mold), it gates no
  merge, and it cannot accept an increment — acceptance stays human (the
  acceptance ledger's `actor: 'human'` pin; program status is read from the
  ledger, `npm run el:activate -- status`, never from prose).
- **Calibration is agreement with ten labeled shapes, not proof of
  coverage.** A failure class outside the taxonomy scores nowhere; that
  discovery route stays what it is today (human review, and R5's recorded
  trigger if it recurs).

## 5. Increment sequencing

Depends on R1 in discipline only (birth-gate pairing as defined there; each
bad anchor doubles as a firing fixture for the leaf that catches it).
Independent of R2's paused track and of R4. Follow-ups recorded, not
scheduled: a `test:selfedit-harness` arm printing the expression on the
rehearsal run (touches pinned drill sections — its own witting increment);
exit-code integration, only ever as an owner decision (it changes what a
red CLI means); extension of the expression catalog when a new increment
class is declared.

## 6. Pre-stated acceptance criterion

Zero-paid, zero-LLM, all seven required:

1. The audit-set file (four labeled fixtures) lands in a commit that
   precedes every expression-authoring commit, and no later commit in the
   increment touches it — verifiable from `git log` at review.
2. Adapters preserve existing semantics byte-for-byte: every pre-existing
   `check.ts` unit pin and the `stage2:check` / `test:selfedit-harness`
   drill pins pass unmodified; the CLI's pre-existing output lines are
   byte-identical (the report block is strictly appended).
3. Calibration agreement is **10/10** on the committed anchors for each
   class expression (deterministic adapters — exact agreement or the
   expression is wrong), asserted in vitest.
4. Every bad anchor is fired by at least one named leaf, and each of the
   five adapters is exercised in both firing and non-firing directions
   across the suite (birth-gate pairing, R1's rule).
5. The validity gate rejects a planted degenerate expression (an
   always-clean and an always-drawback candidate are both committed to the
   test as rejected examples).
6. The root fail-closed rule is pinned: a fixture whose gates all abstain
   yields `not_acceptable_evidence`, distinct from both clean and drawback.
7. The held-out audit runs once at close; raw agreement (n/4, per-fixture
   verdicts) is recorded in the roadmap §5 entry — reported whether flattering
   or not, with no threshold applied.

## 7. What does not change

`check.ts` findings, codes, and function contracts (adapters wrap, never
edit); the checker/CLI read-only posture and its git surface; the parse and
comment-class gates' conditional semantics (named, not altered); the drill
block composition; the write gate and provenance layers; the harness pins
([8]/[9]); human acceptance authority and the EL ledger; the composed-prompt
pins (no prompt byte moves — this increment authors no prompt text, so
Guardrail 15 is not triggered).

## 8. Status ledger

- July 16, 2026 — proposal authored (session, branch
  `d/trellis-paper-analysis-b9bec7`), child of `METRIC_EVOLUTION.md` §7 R3.
  NOT sequenced; awaiting owner decision.
