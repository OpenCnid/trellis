# Phase 5 PRD: The Verification Layer — Earned Trust

## 1. Product Vision

Phase 4 made the flywheel unable to spin a lie about bytes that changed. Phase 5 makes it unable to *keep* a lie about bytes that didn't.

The [critique doc](../benchmarks/CRITIQUE_AND_FUTURE.md) names two ways a cached fact can be wrong. **Drift** — the fact was right, but its source bytes changed — is closed: the [Update Drill](../benchmarks/UPDATE_DRILL_REPORT.md) measured invalidation recall 1.000 on induced poisonings. **Original sin** — the fact was *born wrong*, with perfectly valid Merkle provenance over bytes that never change — remains wide open. Nothing in the system ever re-examines such a fact; the flywheel serves it deterministically, forever, and (aggravating factor #2 from the critique) a hesitant 55/45 sub-LLM call is indistinguishable in the graph from bedrock certainty.

Phase 5 builds the machinery that hunts original sin: **confidence-carrying writes**, a **background verifier** that spot-checks cached beliefs and quarantines disagreements, **trust accrual** so verification spend concentrates where it buys the most, and the **Poisoning Drill** — the benchmark from critique §3.3 that injects known-wrong facts over *unchanged* bytes (precisely the failure Phase 4 cannot see) and measures time-to-detection and recovery.

The strategic insight that makes this phase cheap: **Phase 4 already built the hard half.** Quarantine, contested-exclusion, lazy re-derivation, and audit-preserving un-contest are shipped and proven. Verification is a second *trigger* for the same machinery — drift contests a fact because its bytes died; verification contests a fact because a re-check disagreed. Everything downstream of `contested = true` is reused as-is.

## 2. Architectural Shift (The 3 Changes)

* **Change 1: Beliefs Carry Confidence.** `write_derived_insight` gains an optional confidence score, and the Spatial Flywheel Protocol's classification rubric returns `{label, confidence}` per question instead of a bare label. Confidence is the routing signal for verification: low-confidence edges get checked eagerly, high-confidence edges get sampled. Near-zero marginal write cost.
* **Change 2: Trust Is Earned, Not Assumed.** A new verifier worker re-derives sampled cached facts through a fresh sub-LLM call against the same versioned rubric. Agreement increments `verified_count` (edges graduate out of the sampling pool); disagreement sets `contested = true` with `contestedReason: 'disputed'` — reusing the Phase 4 quarantine path end-to-end. The cache's implicit contract changes from "derived once, trusted forever" to "trusted in proportion to survival of independent re-checks."
* **Change 3: The Graph Learns What Things Are.** The flat `:Entity` namespace (question ids, cities, and TREC labels all keyed by lowercased name) becomes kind-aware. This is both overdue debt — "paris" the city and "Paris" a person collide at scale — and a hard prerequisite: the verifier must find "classification beliefs" structurally, not by regex-matching names.

## 3. Milestones

### Milestone 1: Confidence-Carrying Writes & Bulk Throughput (`src/rlm/trellis_tools.py`, `src/rlm/trellis_agent.py`)

* `write_derived_insight(subject, verb, obj, sourceNodeIds, confidence=None)` — confidence stored as `r.confidence` (0.0–1.0), alongside `r.rubricVersion` (the rubric prompt is versioned text; see Milestone 3) and `r.derivedAt`.
* Protocol update: the embedded TREC rubric asks the sub-LLM to return `{"q_0001": {"label": "LOC", "confidence": 0.95}, ...}`; the agent passes confidence through on every cache write. Absent confidence (legacy writes) is treated as low.
* **Bulk writes:** `write_derived_insights(facts)` — a batched variant taking a list of (subject, verb, obj, sourceNodeIds, confidence) tuples in one Cypher `UNWIND`. The Update Drill's Act 1 spent 222 tool calls on cairo, dominated by one-MERGE-per-fact writes; the re-warm path and the verifier both hammer the same road. Protocol updated to prefer the bulk form for sweep-sized writes.

### Milestone 2: Entity Namespace Separation (`src/core/graph/`, migration script)

* Every flywheel-written node gains a `kind` property (`question` | `category_label` | `concept` | `generic`), supplied by the writer: the protocol knows what it is writing (`has_category` ⇒ subject is a question, object is a category label). `write_derived_insight(s)` accepts optional `subject_kind` / `object_kind`.
* One-shot migration script stamps kinds onto the existing graph (`q_\d+` → question; the six TREC labels → category_label; known concepts → concept) and is verified by a read-back audit.
* Fixes the Phase 4 asymmetry (re-derivation un-contests edges but not nodes): with kinds in place, re-derivation also drops orphaned hashes from the subject/object nodes' `sourceNodeIds` and clears their `contested` flag once no orphaned provenance remains. Node-level trust becomes derivable instead of latent.

### Milestone 3: The Verifier Worker (`src/workers/verification_worker.ts`, `src/core/graph/verification.ts`)

* A `verification_queue` + worker (same skeleton as the invalidation worker). A sweep scheduler (`npm run verify:sweep`) enqueues a sampled batch of `has_category`-class beliefs under a policy:
  * **Mandatory:** `confidence < 0.8`, missing confidence, or `rubricVersion` older than current.
  * **Sampled at rate *p*** (default 5%): everything else with `verified_count` below the graduation threshold (default 3).
  * **Graduated:** `verified_count >= 3` — rare spot-checks only.
* The worker re-classifies the question's *live text* (fetched by Merkle hash — provenance is the input, not the graph's current belief) via one batched sub-LLM call with the current rubric, then compares:
  * **Agree** → `verified_count += 1`, `lastVerifiedAt`, and confidence updated toward the fresh reading.
  * **Disagree** → `contested = true`, `contestedReason = 'disputed'`, `disputedLabel` recorded. No deletion, no in-place correction: the agent's next query treats it as missing and re-derives — arbitration by re-derivation, exactly the Phase 4 recovery path the Update Drill proved (1 batched sub-call, then zero).
* Rubric versioning: the rubric text lives in one place with a version stamp; bumping it lazily re-queues everything written under the old version (mandatory tier), with no thundering-herd eviction.

### Milestone 4: The Poisoning Drill (`src/benchmarks/poison_drill_runner.ts`, `scripts/poison_oolong_cache.ts`)

The quiet-failure benchmark from critique §3.3, structured like the Update Drill:

1. **Warm-up:** seed a fully-verified-state cache (real Act-1 run, or the LLM-free seeded cache for dress rehearsals).
2. **Poison:** flip ~11 cached `has_category` labels in place via direct Cypher — valid provenance, *high* stored confidence (worst case), unchanged bytes. Manifest records every poisoned edge. This is undetectable by Phase 4 by construction.
3. **Detect:** run verifier sweeps under policies (mandatory-only / p=5% / p=10%); a dress-rehearsal mode swaps the sub-LLM for a ground-truth oracle so detection *mechanics* are testable LLM-free.
4. **Recover:** run the standard 20-query sequence; contested poisons must re-derive and F1 must return to 1.000.

**Metrics reported** (written to `docs/benchmarks/artifacts/poison_drill_results.json`):

| Metric | Definition | Target |
|---|---|---|
| **Detection recall** | poisoned edges contested ÷ poisoned, per sweep pass | 1.00 within expected 1/p sampling bound |
| **Poisoned-edge lifetime** | cache reads served from a poisoned edge before quarantine | bounded and reported per policy |
| **False-dispute rate** | correct edges contested by a disagreeing verifier | ≤ 5% — self-healing (re-derivation restores them) but measured as cost |
| **Post-recovery F1** | mean F1 across 20 queries after detection + re-derivation | 1.00 |
| **Verification overhead** | verifier $ per 100 cached beliefs per sweep | reported; expected cents at p = 5–10% |

## 4. Success Metrics

Phase 5 is done when `npm run drill:poison` executes unattended and shows, in one run:

1. **Original sin is now mortal:** a wrong belief with valid provenance, high stored confidence, and unchanged source bytes was detected by sampled verification, quarantined with an audit trail, re-derived correctly, and the post-recovery sequence scored F1 = 1.000.
2. **Trust concentrates spend:** verified/graduated edges demonstrably leave the sampling pool (verification cost per sweep falls across consecutive clean sweeps).
3. **The flywheel economics survive:** steady-state queries still run at zero sub-calls; total verification overhead for the drill is reported in cents, not dollars.

## 5. Out of Scope (Phase 6 candidates)

* **Scale sweep (10k+ questions, 100+ concepts)** — the top *evidence* gap (the projected cost advantage rests on extrapolation), but a benchmark-hardening effort, not an architecture one. It is also the honest test of whether the two deferrals below matter in practice.
* **Partial-provenance survival** — conservative contest-on-any-dead-source is correct and cost ~$0.007 per affected fact in the Update Drill; complexity is not yet justified. Revisit with scale data.
* **Consensus writes (2-of-3) for confusable boundaries** — the verifier's disagree-then-re-derive path covers the same risk at lower cost; promote only if the Poisoning Drill's false-dispute rate says otherwise.
* **Eager re-warm worker** — lazy re-derivation demonstrated 1-sub-call recovery in the Update Drill; there is no latency pain to fix yet. The verifier worker shares its skeleton, so this stays a cheap stretch goal.
* **Adversarial corpora with contested gold labels** — measures how verification handles genuinely soft ground truth; belongs with the scale sweep in benchmark hardening.
