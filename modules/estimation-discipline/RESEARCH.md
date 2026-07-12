# estimation-discipline — research provenance

This module was authored under the grounded-authoring mode (design record
`docs/architecture/GROUNDED_AUTHORING.md`): the promoted research corpus below was
seeded block-aligned into a read-only-scope workspace, the draft was produced with
no database or search access, and `research.sourceNodeIds` in `module.json` was
pinned by the harness from the corpus — not chosen by the model (§5).

**Topic:** estimation discipline for an RLM: deciding when held evidence already determines the answer and stopping the search there

## Research corpus

| Promoted doc key | Version | Root hash | Blocks |
|---|---|---|---|
| `research:trellis/estimation-discipline/contract` | 1 | `9f5c46bc5b9fe1622650c1d786395aae77e9083257e14464939fd73231ac8b62` | 11 |
| `research:trellis/estimation-discipline/evidence` | 1 | `f6fa47e471ece50f5302a2e1d51d793fe56d57665318d6d43f15883a8846b4fa` | 8 |

Total pinned research blocks (deduped): 19.

Because these doc keys are stable, re-promoting changed corpus content versions the
same document and the invalidation sweep contests this module's graph entity
(`module:estimation-discipline`) once it is registered (design record §9.4). Recover it
by re-reviewing the protocol against the refreshed research and re-registering.

## Authoring provenance

Drafted by a paid RLM authoring run (model gpt-5.4-2026-03-05) under the grounded-authoring mode.

## Declared gaps

The draft declared these gaps — topics the corpus did not cover:

- The corpus supports concluding with a bounded answer when operands remain unbound near budget exhaustion, but it does not specify a more general operational trigger for conclusion beyond that condition.

## Corpus authorship (human, Session 26)

The two promoted corpus documents were written by the Session 26 operator
(July 11, 2026), not extracted from a pre-existing design record: no
normative estimation-discipline prose existed in the repository. Every
number in the evidence document was copied from a committed benchmark
report and verified against it at authoring time
(`WORKSPACE_PROBE_REPORT.md` 8-vs-4 external calls;
`WORKSPACE_LINEAGE_PROBE_REPORT.md` 0-external-call seeded task;
`EFFECTIVE_CONTEXT_PROBE_REPORT.md` 110,550-token single sub-call and
the 13k–27k recovery-loop band vs the ~8.2k round-4 median;
`modules/workspace-discipline/RESEARCH.md` searching-past-held-evidence
incident). The topic is one of the three behavioral candidates recorded
in `docs/COLLABORATOR_BRIEFING.md` ("Where you can help next" #1);
"mechanical provenance threading" was NOT chosen because the briefing
records it as a candidate architecture session — plumbing, not prompt.

## Positive control (designed; measurement owner-gated)

Per the briefing's rule ("build the positive control before spending"),
the control design was fixed before the authoring turn and the module
does not enter the default selection until the control measures a real
effect:

- **Arms:** identical runs with `TRELLIS_MODULES=["spatial-flywheel"]`
  (off) vs `["spatial-flywheel","estimation-discipline"]` (on).
- **Questions:** sufficiency-bounded questions over the durable probe
  corpora — each with a computable minimal evidence set (e.g. one
  `get_ast_blocks` read determines the answer) plus multi-part
  questions whose parts share reads (repeat-retrieval pressure).
- **Metrics:** `tool_calls`, iterations, and `input_tokens` from
  `TRELLIS_TELEMETRY`, correctness from the unit-pinned ground truth.
- **Decisive criterion:** the on arm's median tool calls and input
  tokens at or below the off arm's with non-inferior correctness; the
  failure class exists at recorded rate (probe round 1's 8-vs-4, round
  3's recovery loops), so a real effect is detectable at modest n.
- **Plumbing note:** the probe script pins `TRELLIS_MODULES` to the
  default; the control needs a module-arm flag in the
  `TRELLIS_EXP_OMIT_CMT` mold (byte-identical when unset). Built in
  Session 28 (`TRELLIS_EXP_MODULES`,
  `src/benchmarks/effective_context/module_arm.ts`).

## The measured control (Session 28, July 11, 2026)

The control ran as designed: the `est` probe suite (five
sufficiency-bounded two-part questions whose parts share one read,
truths and minimal-evidence bounds unit-pinned in
`src/benchmarks/effective_context/estimation_suite.ts`), n=5 per
question per arm, 50 runs, $2.3981 total, both arms on the pinned
default kernel. Full tables:
`docs/benchmarks/EFFECTIVE_CONTEXT_PROBE_REPORT.md`, "The
estimation-discipline module control".

**The pre-stated decisive criterion is NOT met — a mixed result.**
Correctness saturated at 25/25 in BOTH arms. Median database tool
calls moved the way the module intends (on 1 vs off 2 pooled; the
worst off-arm question's median 4 halved to 2; minimal-evidence
attainment 15/25 vs 10/25) — the retrieval-gating instruction
measurably gates retrieval. But pooled median input tokens went UP
(on 13,240 vs off 9,217): on the three small-corpus questions the
explicit operand/sufficiency bookkeeping cost more iterations than
the saved reads repaid, while on the two largest questions
(est-led-captain, est-rel-guild) the direction reversed and the on
arm was cheaper by ~6k median tokens.

**Standing per the recorded rule:** the module stays OUT of the
default selection. The candidacy decision on these numbers — retire,
or re-scope composition to large-corpus/aggregate task shapes where
the effect pays — is the owner's.

## Retired (owner decision, July 11, 2026)

The owner retired the module on the control's numbers the same day
(manifest `status: retired`; the graph entity
`module:estimation-discipline` remains as the historical record —
module entities are contested or retired, never deleted). The decision
carried a broader direction, recorded in the roadmap: behavioral
failure classes are closed by TOOLING SHAPE (mechanical enforcement
with typed refusals), not by prompt modules — the retrieval-discipline
behavior this module nudged is a candidate for kernel-level retrieval
dedup and budgets, with the Session 28 `est` suite as the acceptance
harness for that intervention. This directory stays as provenance for
the measurement.
