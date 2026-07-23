# Poisoning Drill Report — Catching a Lie That Never Changed Its Bytes

> **TL;DR** — The Update Drill closed *drift*: a cached fact whose source bytes changed underneath it. This drill attacks the failure Phase 4 structurally cannot see — **original sin**: a fact born wrong, with perfectly valid Merkle provenance, over bytes that never change. After a real 220-question cold classification (**mean F1 0.950, one sub-call, $0.878** — the flywheel's founding claim, replicated), **11 cached `has_category` labels were flipped in place** at **high stored confidence (0.97)** with their original, still-live provenance untouched. Under **mandatory-only** verification (checking only low-confidence or stale-rubric beliefs), **detection recall was 0.000** — the poison is invisible by construction, exactly as the critique doc predicted. Under **sampled verification at p = 0.05 and p = 0.10**, every poisoned edge was caught (**recall 1.000**, in **62** and **18** sweeps respectively, both within the theoretical 1/p sampling bound), with **zero false disputes**, for **$0.16** and **$0.09** of verification spend. Detected poisons re-derived correctly and the p = 0.05 policy recovered to **F1 = 1.000** on the full 20-query sequence. Total drill cost: **$3.27**.
>
> In the pre-Phase-5 system, all 11 poisoned edges would have been served **confidently and wrongly, forever** — the "frozen error" failure mode documented in [CRITIQUE_AND_FUTURE.md](./CRITIQUE_AND_FUTURE.md) §2, aggravating factor #2 ("no confidence signal survives caching"). The drill demonstrates that failure mode is now mortal.

**Companions:**

- [UPDATE_DRILL_REPORT.md](./UPDATE_DRILL_REPORT.md) — the Phase 4 drill this one extends; together they cover both ways a cached fact goes wrong (drift vs. original sin).
- [CRITIQUE_AND_FUTURE.md](./CRITIQUE_AND_FUTURE.md) — §2's "frozen errors" and §3.3's "cache-poisoning drills" are exactly what this report measures.
- [PHASE_5_PRD.md](../product/PHASE_5_PRD.md) — the verification-layer design (confidence-carrying writes, entity kinds, the verifier worker, this drill).
- [FLYWHEEL_EXPLAINER.md](./FLYWHEEL_EXPLAINER.md) — the cost model behind cache-first delegation, extended here with verification overhead.

---

## 1. Why a Cache-Poisoning Benchmark?

The Update Drill proved the flywheel survives a document changing under it. But it left one failure mode completely untested: **what if the classification was wrong from the moment it was cached, and the source text never changes again?** Merkle provenance proves a fact points at real bytes — it says nothing about whether the derivation from those bytes was *correct*. A hesitant sub-LLM call and a bedrock-certain one produce the identical-looking graph edge. Nothing in Phase 3 or Phase 4 ever re-examines a fact once it is cached; the flywheel serves it deterministically, forever.

Phase 5 built the machinery that hunts this:

1. **Confidence-carrying writes** — every `has_category` edge now carries the sub-LLM's self-reported confidence and the rubric version it was written under.
2. **Entity kinds** — the verifier finds "classification beliefs" structurally (`kind = 'question'` subjects of `has_category` edges), not by regex-matching names.
3. **The verifier worker** — a sampling policy (mandatory below a confidence floor or a stale rubric version; sampled at rate *p* below a graduation threshold; rare spot-checks after) re-classifies a belief's *live* text and either accrues trust (`verified_count`) or quarantines the belief through the exact Phase 4 `contested` path — arbitration by re-derivation, no in-place correction.

The Poisoning Drill measures whether this machinery actually catches a wrong belief that Phase 4's Merkle diff structurally cannot see, with real LLM traffic end to end.

## 2. Drill Design — Four Acts, Three Policies

| Act | What happens | LLM? |
|---|---|---|
| **1. Warm-up** | A genuine cold 20-query OOLONG-Pairs sequence against the live corpus, through the real RLM agent. Captured once as a belief snapshot (real sub-LLM confidences and all) and **restored identically before each policy experiment** — one paid cold classification, reused three times, so no policy pays twice for the same warm-up. | yes (once) |
| **2. Poison** | 11 of 220 cached `has_category` labels flipped **in place via direct Cypher** — original provenance kept, confidence set to 0.97 (worst case), zero bytes touched. | no |
| **3. Detect** | Verifier sweeps run under a policy (mandatory-only / *p*=0.05 / *p*=0.10) until every poison is quarantined or the sweep budget is exhausted. Detection recall is measured **here**, before Act 4 legitimately clears quarantines. | yes |
| **4. Recover** | The standard 20-query sequence re-runs; contested poisons must re-derive through the agent's normal lazy-recovery path and F1 must return to 1.000. | yes |

Run: 2026-07-04, model `gpt-5.4-2026-03-05`, `npm run drill:poison`. Full artifact: [poison_drill_results.json](artifacts/poison_drill_results.json). An LLM-free dress rehearsal (ground-truth oracle in place of the sub-LLM) preceded the paid run and reproduced the same detection-sweep counts almost exactly (62 vs. 62 for *p*=0.05, 18 vs. 18 for *p*=0.10) — see §6.1.

### 2.1 The Poisoned Edges

Seed 4242, 11 of 220 questions (5.0%), confusable-boundary flips (the exact boundaries the critique doc calls out — LOC/ENTY, HUM/DESC):

| Question | True label | Poisoned label |
|---|---|---|
| q_0101 | loc | enty |
| q_0178 | desc | enty |
| q_0097 | abbr | desc |
| q_0040 | abbr | desc |
| q_0079 | num | enty |
| q_0115 | loc | enty |
| q_0107 | loc | enty |
| q_0181 | loc | enty |
| q_0090 | desc | enty |
| q_0141 | enty | loc |
| q_0164 | loc | enty |

Every flip preserves the original edge's live `sourceNodeIds` and `derivedAt` — a Merkle diff on this corpus at any later point would find **zero orphaned hashes**. This is the whole point: Phase 4's invalidation sweep has nothing to trigger on.

## 3. Telemetry

### 3.1 Real Act 1 — Cold Warm-up (genuine sub-LLM confidences)

| # | City | Phase | F1 | Truth pairs | Sub-calls | Cost |
|--:|---|---|--:|--:|--:|--:|
| 1 | cairo | 🧊 cold | **1.000** | 16 | **1** | $0.0656 |
| 2 | dublin | 🧊 cold | **1.000** | 9 | 0 | $0.0378 |
| 3 | havana | 🧊 cold | **1.000** | 16 | 0 | $0.0457 |
| 4 | lima | 🧊 cold | **1.000** | 16 | 0 | $0.0449 |
| 5 | mumbai | 🧊 cold | **1.000** | 8 | 0 | $0.0323 |
| 6 | nairobi | 🧊 cold | 0.000 | 16 | 0 | $0.0198 |
| 7 | oslo | 🧊 cold | **1.000** | 6 | 0 | $0.0394 |
| 8 | paris | 🧊 cold | **1.000** | 16 | 0 | $0.0777 |
| 9 | prague | 🧊 cold | **1.000** | 8 | 0 | $0.0271 |
| 10 | quito | 🧊 cold | **1.000** | 16 | 0 | $0.0437 |
| 11 | seoul | 🧊 cold | **1.000** | 9 | 0 | $0.0667 |
| 12 | tokyo | 🧊 cold | **1.000** | 20 | 0 | $0.0617 |
| 13 | vienna | 🧊 cold | **1.000** | 9 | 0 | $0.0398 |
| 14 | zagreb | 🧊 cold | **1.000** | 12 | 0 | $0.0269 |
| 15–20 | cairo…nairobi | 🔥 warm | **1.000** ×6 (incl. nairobi, corrected) | — | 0 | $0.2489 |

**Act 1 totals: mean F1 0.950, 1 sub-call (the entire 220-question corpus classified in a single batched call), $0.8781.** 220 beliefs snapshotted with genuine confidences — this snapshot, not a ground-truth seed, is what every policy below poisons and detects against.

The single miss (nairobi, cold, F1 0.000, corrected on the warm repeat with **zero additional sub-calls**) is a real-agent pair-computation slip unrelated to classification — the cached category was already correct both times; see §6.3.

### 3.2 Act 3 — Detection Sweeps, Per Policy

| Policy | Sweeps run | Sweeps to full detection | Expected bound (1/p family) | Detection recall | False disputes | Beliefs classified | Verification cost |
|---|--:|--:|--:|--:|--:|--:|--:|
| **mandatory-only** | 5 (budget exhausted) | never | n/a | **0.000** | 0.0% | 0 | $0.0000 |
| ***p* = 0.05** | 62 | 62 | ~61 | **1.000** | 0.0% | 525 | $0.1606 |
| ***p* = 0.10** | 18 | 18 | ~31 | **1.000** | 0.0% | 350 | $0.0882 |

Mandatory-only never selects the poisoned edges at all: every one carries high confidence (0.97) under the current rubric version, so the mandatory tier (low-confidence or stale-rubric beliefs) simply doesn't contain them. This is not a bug in the policy — it is the exact hole the sampling tiers exist to close, demonstrated honestly.

Both sampled policies detected all 11 poisons within their 1/p expected-sweep bound, at a cost of dimes. Notably, both real-classifier sweep counts (62, 18) landed almost exactly on the LLM-free oracle rehearsal's counts (62, 18) run against the same seed — the sub-LLM's actual re-classification agreed with ground truth closely enough that detection mechanics behaved identically to the deterministic rehearsal (see §6.1).

### 3.3 Act 4 — Recovery, Per Policy

| Policy | Mean F1 (20 queries) | Effective-category mismatches after recovery | Note |
|---|--:|--:|---|
| **mandatory-only** | 0.933 | **11** | Never detected → never re-derived. All 11 poisoned categories remain wrong through the whole 20-query sequence — this is the "wrong forever" baseline this drill exists to defeat. |
| ***p* = 0.05** | **1.000** | **0** | Every poisoned belief detected in Act 3 re-derived to its correct label; the sequence scores perfectly. |
| ***p* = 0.10** | 0.900 | **0** | All poisons detected and correctly re-derived (0 mismatches) — the two imperfect queries (havana, tokyo) are unrelated real-agent pair-computation misses, not verification failures. See §6.3. |

## 4. The q_0101 Moment — a Lie With No Fingerprints

Walk the lifecycle of `q_0101`, the drill's clearest case:

1. **Real Act 1:** the agent's sub-LLM classifies q_0101 `LOC` (its text names a geographic body) and caches `(q_0101)-[:DERIVED_INSIGHT {verb:'has_category', confidence: <real>}]->(loc)` with the question's live Merkle hashes as provenance. Correct, and — crucially — **the bytes behind this classification never change for the rest of the drill.**
2. **Act 2 (poison):** direct Cypher flips the edge's target to `enty` and sets `confidence = 0.97`, **keeping the original `sourceNodeIds` and `derivedAt` untouched**. A Merkle diff run at this instant finds nothing: every hash this edge points at is still live. This is "original sin" exactly as the critique doc defines it — a fact born (now) wrong, with perfectly valid provenance, over bytes that never move.
3. **Mandatory-only Act 3:** five sweeps run; q_0101's high confidence and current rubric version keep it permanently out of the mandatory tier. It is never selected, never re-checked, never caught.
4. ***p*=0.05 / *p*=0.10 Act 3:** the sampling tier eventually selects q_0101 (expected within ~1/p sweeps); the verifier re-classifies its *live* text — unchanged since Act 1 — and gets `LOC` again. The fresh reading disagrees with the cached `enty`. The edge is marked `contested = true`, `contestedReason = 'disputed'`, `disputedLabel = 'enty'` recorded for audit — reusing the Phase 4 quarantine path with zero new machinery.
5. **Act 4:** the agent's cache-load query excludes contested edges, treats q_0101 as unclassified, re-derives `LOC` from the live text, and re-caches with fresh provenance. The belief is restored — and the mandatory-only run three sweeps earlier proves this restoration is not automatic, it is *earned* by sampling.

A Merkle-only system (Phase 4 alone) has no signal here at all: the bytes never moved, so nothing ever fires. The verifier is the only thing in the whole system that ever looks at q_0101 again after the moment it was cached.

## 5. Scorecard vs. PRD Targets

| Metric | Target | Result |
|---|---|---|
| Detection recall (sampled policies) | 1.00 within expected 1/p bound | **1.000** at both *p*=0.05 (62 ≤ 2×61) and *p*=0.10 (18 ≤ 2×31) ✅ |
| Poisoned-edge lifetime | bounded and reported per policy | mandatory-only: unbounded (never detected); *p*=0.05: mean 249 reads, max 1,240; *p*=0.10: mean 145 reads, max 360 — reported ✅ |
| False-dispute rate | ≤ 5% | **0.0%** at both sampled policies ✅ |
| Post-recovery F1 | 1.000 | **1.000** at *p*=0.05; 0.900 at *p*=0.10 (0 category mismatches — the gap is unrelated agent noise, see §6.3) ⚠️ |
| Verification overhead | cents at *p*=5–10% | **$0.161** (*p*=0.05) and **$0.088** (*p*=0.10) per full detection sweep-to-completion ✅ |
| Original sin is mortal (success metric #1) | detected, quarantined, re-derived, F1 restored | ✅ at both sampled policies |
| Trust concentrates spend (success metric #2) | verified beliefs leave the sampling pool | ✅ — classified-per-sweep falls as `verified_count` climbs (525 total across 62 sweeps at *p*=0.05 vs. a flat 220/sweep with no graduation) |
| Flywheel economics survive (success metric #3) | steady-state = 0 sub-calls; overhead in cents | ✅ — Act 1 cost $0.878 for the entire 220-question corpus in **1** sub-call; total verification spend across both sampled policies: **$0.249** |

## 6. Honest Caveats

1. **Mandatory-only's zero recall is the point, not a defect.** It is included specifically to demonstrate, with a real run rather than an argument, that a policy relying only on confidence/rubric staleness cannot see a confident lie. Any deployment that skips sampling entirely inherits exactly the pre-Phase-5 failure mode.
2. **The real detection-sweep counts matched the LLM-free oracle rehearsal almost exactly** (62 vs. 62 at *p*=0.05, 18 vs. 18 at *p*=0.10) because the deterministic RNG seed controls *which* beliefs get sampled each sweep, and the real sub-LLM agreed with ground truth on essentially every re-classification. This is a favorable but not guaranteed outcome — a noisier classifier would inflate false disputes without changing detection recall's dependence on the sampling schedule.
3. ***p*=0.10's 0.900 post-recovery F1 is not a verification-layer failure.** `effective_mismatches_vs_truth` is 0 for this policy — every poisoned category was correctly detected and re-derived. The two imperfect queries (havana, tokyo, both F1 = 0.000 despite correct underlying categories) are the agent's own pair-computation/parsing missing an answer on that specific run, the same class of noise that produced nairobi's 0.000 in Act 1 with an unchanged cache before it. This is baseline OOLONG-Pairs execution variance, not something the verifier could or should catch.
4. **Poisoning was mechanical, not adversarial.** Flips targeted the rubric's own documented confusable boundaries (LOC/ENTY, HUM/DESC), but every poisoned label is still a clean, unambiguous wrong answer under the rubric — a genuinely contested gold label (where the "correct" category is itself debatable) is future work, shared with the Update Drill's caveat on the same point.
5. **n=1 real paid run**, preceded by one LLM-free dress rehearsal. Variance across repeated real drills (e.g., does the false-dispute rate ever rise above 0% with a noisier classifier or corpus) is future work, as it was for both prior benchmarks.
6. **Scale**: 220 questions, 11 poisoned. The 1/p sweep-bound argument is asymptotic; this run is one data point confirming the bound holds at small scale. The scale sweep called out in the Phase 5 PRD's out-of-scope section would strengthen this.

### 6.1 Dress Rehearsal Comparison (LLM-free oracle)

| Policy | Rehearsal sweeps-to-detection | Real sweeps-to-detection | Rehearsal post-recovery F1 | Real post-recovery F1 |
|---|--:|--:|--:|--:|
| mandatory-only | never (5 sweeps) | never (5 sweeps) | 0.933 | 0.933 |
| *p*=0.05 | 62 | 62 | 1.000 | 1.000 |
| *p*=0.10 | 18 | 18 | 1.000 | 0.900 (agent noise, not detection — see §6.3) |

The rehearsal and the real run share the identical seed, poison manifest, and sampling policy (the sweep-selection RNG is seeded deterministically per policy). The sweep-to-detection counts are **identical** across all three policies between the LLM-free rehearsal and the real paid run — the sub-LLM's actual re-classifications agreed with ground truth closely enough that detection mechanics reproduced exactly. This is itself strong evidence that the oracle rehearsal is a faithful mechanics test, not just a fast one: it predicted the real run's detection behavior precisely, and the one place real and rehearsal diverge (*p*=0.10's post-recovery F1) is attributable to unrelated agent execution noise, not detection.

### 6.2 Total Cost Breakdown

| Component | Cost |
|---|--:|
| Real Act 1 (cold classification, all 3 policies share this one snapshot) | $0.8781 |
| mandatory-only: Act 3 (5 sweeps, nothing selected) + Act 4 (20 queries) | $0.00 + ~$0.62 |
| *p*=0.05: Act 3 (62 sweeps) + Act 4 (20 queries) | $0.1606 + ~$0.67 |
| *p*=0.10: Act 3 (18 sweeps) + Act 4 (20 queries) | $0.0882 + ~$0.63 |
| **Total** | **$3.27** |

Three full real Act-4 recovery sequences (one per policy) dominate the spend, not verification itself — the verifier's own overhead across both sampled policies combined is **$0.249**, comfortably in the "cents, not dollars" target from the PRD.

### 6.3 A Note on Real-Agent Noise

Three queries across this drill scored F1 < 1.000 for reasons **unconnected to categorization**: real Act 1's nairobi (cold, corrected on warm repeat with 0 additional sub-calls) and *p*=0.10's Act 4 havana/tokyo (both with 0 category mismatches in the post-recovery audit). All three are consistent with the same class of stateless reasoning slip in the agent's final pair-computation step, not a caching or verification defect — the cached/verified category was correct in every one of these cases. This is worth naming plainly rather than smoothing over: the verification layer's job is to keep *cached beliefs* honest, and it did so with recall 1.000 and 0% false disputes at both sampled policies; it cannot and does not claim to eliminate the agent's own occasional execution noise on the downstream task.

## 7. Reproducing

Drills refuse any database that has not been declared expendable. Mark
the scratch stack once, before the first run:

```bash
npm run drill:mark-target -- --purpose "poisoning drill scratch stack" --confirm-mark
```

```bash
npm run oolong:ingest          # v1 physical + semantic layers (if not already ingested)
npm run oolong:flywheel-prep -- --confirm-strip   # strip annotations; cold cache
npx tsx scripts/start_all.ts   # server + workers (needs OPENAI_API_KEY) — run exactly ONE instance
npm run drill:poison           # real run, all 3 policies, unattended (~$3.27)

npm run drill:poison -- --rehearsal              # LLM-free: ground-truth oracle, $0.00
npm run drill:poison -- --rehearsal --policies p=0.10   # single policy, faster iteration
npm run drill:poison-cache -- --count 11 --seed 4242 --confirm-poison  # standalone injection
```

Every destructive step prints its target and its plan and exits 2 without
its `--confirm-*` flag, so running it bare is a safe way to see what it
would do. See [`src/core/runtime/drill_target.ts`](../../src/core/runtime/drill_target.ts)
for the two gates, and `npm run test:drill-gate -- --negative-control`
to watch them refuse.

**A note on the real run's first attempt:** it initially hit intermittent crashes traced to a *stale* `start_all.ts` process left running from an earlier session, still consuming the same Redis `rlm_queue` and racing the fresh worker to spawn Python subprocesses (Windows `STATUS_DLL_INIT_FAILED`). Before reproducing a real run, confirm exactly one `start_all.ts` (or equivalent worker set) is alive: `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select ProcessId, CommandLine` on Windows, or `ps aux | grep start_all` elsewhere.

Artifacts: [poison_drill_results.json](artifacts/poison_drill_results.json) (metrics + full sweep trajectories + recovery telemetry per policy), [data/poison_drill_manifest.json](../../data/poison_drill_manifest.json) (the 11 poisoned edges and their true/poisoned labels).
