# Update Drill Report — Surviving a Corpus Mutation with a Warm Cache

> **TL;DR** — Trellis's founding claim is that GraphRAG breaks when documents change and a Merkle-anchored graph does not. The Update Drill is the first benchmark to test that claim directly: after a real 20-query warm-up seeded the flywheel cache, **5% of the corpus was mutated** — including three questions whose *correct classification changed* — and re-ingested. The Merkle diff re-processed **exactly the 5% that changed**, the quarantine sweep contested **exactly the 11 affected cached facts (recall 1.000, precision 1.000)**, and the agent then scored a **perfect F1 = 1.000 on all 20 post-update queries** against the mutated ground truth, spending **one** sub-LLM call to re-derive everything the sweep had quarantined. Total drill cost: **$0.73**, versus $0.80 for the full-rebuild baseline measured in the same run.
>
> In the pre-Phase-4 system, the three category-flipped questions would have been answered **confidently and wrongly, forever** — the frozen-cache failure mode documented in [CRITIQUE_AND_FUTURE.md](./CRITIQUE_AND_FUTURE.md) §2. The drill demonstrates that failure mode is now closed.

**Companions:**

- [OOLONG_BENCHMARK_REPORT.md](./OOLONG_BENCHMARK_REPORT.md) — the original static-corpus benchmark this drill extends.
- [FLYWHEEL_EXPLAINER.md](./FLYWHEEL_EXPLAINER.md) — the cost model behind cache-first delegation.
- [CRITIQUE_AND_FUTURE.md](./CRITIQUE_AND_FUTURE.md) — the risk analysis that motivated Phase 4; §2's "frozen errors" is what this drill attacks.
- [PHASE_4_PRD.md](../product/PHASE_4_PRD.md) — the invalidation-loop design (registry, Merkle diff, quarantine sweep).
- [POISONING_DRILL_REPORT.md](./POISONING_DRILL_REPORT.md) — the Phase 5 sequel: this drill closes *drift* (bytes that changed); that one closes *original sin* (bytes that never do).

---

## 1. Why a Document-Update Benchmark?

OOLONG-Pairs proved the flywheel on a *static* corpus: classify once, cache with provenance, answer every later query from the graph. But the cache's greatest strength is also its sharpest risk — **a fact, once derived, is never re-derived**. If the world changes under a cached fact, a stateless agent eventually notices (it re-reads everything, every time); the flywheel, by design, does not. This is the exact failure mode that makes standard GraphRAG deployments rebuild their graphs from scratch on every document revision.

Phase 4 built the machinery that resolves this tension:

1. **Document registry** — a `doc_key` ties versions of a document together (`documents` / `document_nodes` tables).
2. **Merkle diff** — content-addressed node hashes make version comparison two set operations: unchanged subtrees share hashes and are skipped entirely.
3. **Quarantine sweep** — every graph fact whose `sourceNodeIds` intersect the orphaned-hash set is marked `contested` (never deleted); consumers treat contested facts as missing, forcing lazy re-derivation from live bytes.

The Update Drill measures whether these three mechanisms actually deliver the claim, with real LLM traffic end to end.

## 2. Drill Design — Four Acts

| Act | What happens | LLM? |
|---|---|---|
| **1. Warm-up** | Standard 20-query OOLONG-Pairs sequence against corpus v1 from a cold cache. Seeds the flywheel *and* measures the full-rebuild cost baseline. | yes |
| **2. Mutation** | Deterministic (seed 1337) mutation of 11 of 220 questions (5.0%). | no |
| **3. Re-ingest & sweep** | v2 re-ingested under the same `doc_key`; Merkle diff, semantic refresh of changed records, quarantine sweep, invalidation audit. | no |
| **4. Post-update** | The same 20-query sequence, scored against the **mutated** ground truth. | yes |

Run: 2026-07-03, model `gpt-5.4-2026-03-05`, single command (`npm run drill:update`). Full artifact: [update_drill_results.json](artifacts/update_drill_results.json).

### 2.1 The Mutations

Three flavors, each stressing a different part of the loop:

| Question | Flavor | Change | Why it's hard |
|---|---|---|---|
| q_0043, q_0084, q_0107 | rewrite | LOC, same city, new wording | Cached label's provenance dies; honest re-derivation must reach the *same* answer |
| q_0117, q_0195 | rewrite | HUM, same city, new wording | Same, on the other pair-relevant category |
| **q_0041** | **category flip** | HUM → ENTY (oslo) | Cached `hum` is now **wrong**: its pairs must vanish |
| **q_0154** | **category flip** | LOC → NUM (oslo) | Cached `loc` is now **wrong**: its pairs must vanish |
| **q_0101** | **category flip** | NUM → LOC (tokyo) | Cached `num` is now **wrong**: four brand-new pairs must appear |
| q_0096 | city swap | zagreb → oslo (HUM) | Deterministic mention scan must track the new city |
| q_0181 | city swap | prague → mumbai (LOC) | Pairs must move between cities |
| q_0202 | city swap | vienna → dublin (HUM) | Pairs must move between cities |

Ground-truth pairs shift from **182 to 177**, with per-city rows changing in both directions. The category flips are the poisoned-cache scenario: after Act 1, the graph contains a `has_category` edge that is *correct for bytes that no longer exist*.

## 3. Telemetry

### 3.1 Act 1 — Warm-up (corpus v1, cold cache)

| # | City | Phase | F1 | Pairs | Tokens | Sub-calls | Cost | Time |
|--:|---|---|--:|--:|--:|--:|--:|--:|
| 1 | cairo | 🧊 cold | **1.000** | 16/16 | 31,414 | **5** | $0.1025 | 35.0s |
| 2 | dublin | 🧊 cold | **1.000** | 6/6 | 17,271 | 0 | $0.0492 | 13.1s |
| 3 | havana | 🧊 cold | **1.000** | 16/16 | 4,166 | 0 | $0.0195 | 12.7s |
| 4 | lima | 🧊 cold | **1.000** | 16/16 | 8,815 | 0 | $0.0297 | 12.3s |
| 5 | mumbai | 🧊 cold | **1.000** | 6/6 | 4,177 | 0 | $0.0197 | 15.2s |
| 6 | nairobi | 🧊 cold | **1.000** | 16/16 | 9,485 | 0 | $0.0326 | 15.2s |
| 7 | oslo | 🧊 cold | **1.000** | 9/9 | 23,282 | 0 | $0.0664 | 15.9s |
| 8 | paris | 🧊 cold | **1.000** | 16/16 | 9,336 | 0 | $0.0323 | 15.5s |
| 9 | prague | 🧊 cold | **1.000** | 12/12 | 21,110 | 0 | $0.0598 | 14.7s |
| 10 | quito | 🧊 cold | **1.000** | 16/16 | 12,740 | 0 | $0.0370 | 13.3s |
| 11 | seoul | 🧊 cold | **1.000** | 9/9 | 8,941 | 0 | $0.0314 | 13.1s |
| 12 | tokyo | 🧊 cold | **1.000** | 16/16 | 4,353 | 0 | $0.0214 | 12.8s |
| 13 | vienna | 🧊 cold | **1.000** | 12/12 | 4,524 | 0 | $0.0231 | 14.2s |
| 14 | zagreb | 🧊 cold | **1.000** | 16/16 | 9,381 | 0 | $0.0339 | 13.6s |
| 15–20 | cairo…nairobi | 🔥 warm | **1.000** ×6 | all exact | 66,598 | 0 | $0.2417 | ~13.7s avg |

**Act 1 totals: mean F1 1.000, 5 sub-calls (all in query 1's classification sweep), $0.8002** — a third independent clean sweep of the original benchmark, replicating Runs A and B.

### 3.2 Act 3 — Merkle Diff & Quarantine Sweep (no LLM)

```
v1 (root ded67f9a…) -> v2 (root 54cd8bb9…)
Diff:  added 23 | orphaned 23 | retained 858   (of 881 nodes)
       = 11 new paragraphs + their 11 text children + the new root
Changed records: 11/220 (5.0%) — exactly the mutation manifest
Sweep: contested 11 has_category edges + 14 entity nodes, 1 batch
```

**Invalidation audit** (measured here, *before* Act 4 legitimately clears quarantines):

| Metric | Result | Target |
|---|---|---|
| Recall — affected cached facts contested | **11/11 = 1.000** | 1.000 |
| Precision — contested facts that were affected | **11/11 = 1.000** | ≥ 0.95 |

The sweep caught every poisoned entry and quarantined nothing else. The 858 retained hashes are the Merkle discount: 97.4% of the physical layer (including every unchanged question's provenance) was never touched.

### 3.3 Act 4 — Post-Update Queries (corpus v2 ground truth)

| # | City | F1 | Pairs (Act 1 →) | Sub-calls | Cost | What changed |
|--:|---|--:|---|--:|--:|---|
| 1 | cairo | **1.000** | 16/16 (=) | **1** | $0.0758 | the single batched re-derivation of all 11 contested questions |
| 2 | dublin | **1.000** | 9/9 (6 → 9) | 0 | $0.0469 | gained q_0202's pairs (swap in from vienna) |
| 3 | havana | **1.000** | 16/16 (=) | 0 | $0.0386 | rewrite re-derived to same label |
| 4 | lima | **1.000** | 16/16 (=) | 0 | $0.0306 | rewrite re-derived to same label |
| 5 | mumbai | **1.000** | 8/8 (6 → 8) | 0 | $0.0240 | gained q_0181's pairs (swap in from prague) |
| 6 | nairobi | **1.000** | 16/16 (=) | 0 | $0.0308 | untouched |
| 7 | oslo | **1.000** | 6/6 (9 → 6) | 0 | $0.0301 | lost pairs to two category flips; gained q_0096 |
| 8 | paris | **1.000** | 16/16 (=) | 0 | $0.0552 | rewrite re-derived to same label |
| 9 | prague | **1.000** | 8/8 (12 → 8) | 0 | $0.0269 | lost q_0181 (swap out) |
| 10 | quito | **1.000** | 16/16 (=) | 0 | $0.0309 | rewrite re-derived to same label |
| 11 | seoul | **1.000** | 9/9 (=) | 0 | $0.0541 | untouched |
| 12 | **tokyo** | **1.000** | **20/20 (16 → 20)** | 0 | $0.0667 | **q_0101's flipped label re-derived NUM → LOC: 4 new pairs** |
| 13 | vienna | **1.000** | 9/9 (12 → 9) | 0 | $0.0433 | lost q_0202 (swap out) |
| 14 | zagreb | **1.000** | 12/12 (16 → 12) | 0 | $0.0310 | lost q_0096 (swap out) |
| 15–20 | repeats | **1.000** ×6 | all exact | 0 | $0.1412 | steady state: pure cache reads |

**Act 4 totals: mean F1 1.000, 1 sub-call, $0.7263.**

## 4. The Tokyo Moment — a Frozen Lie, Caught

The single most important row in this report is tokyo. Walk the lifecycle of `q_0101`:

1. **Act 1:** the text reads *"What is the population of Tokyo?"* The agent's sub-LLM classifies it `NUM` and caches `(q_0101)-[:DERIVED_INSIGHT {verb:'has_category'}]->(num)` with the question's Merkle hashes as provenance. Correct.
2. **Act 2:** the text becomes *"Which lake lies along the eastern edge of Tokyo?"* The correct label is now `LOC`. The cached edge is now a **lie with valid provenance** — exactly the "original sin becomes systematic error" scenario from the critique doc, except here the sin is induced by drift.
3. **Act 3:** the Merkle diff orphans the old paragraph's hashes; the sweep finds the `has_category` edge's provenance intersects the orphan set and marks it `contested`. No opinion about *correctness* is needed — the bytes that justified the belief are gone, so the belief is suspended.
4. **Act 4:** the agent's cache-load query excludes contested edges, treats q_0101 as unclassified, re-derives `LOC` from the live text in the batched sub-call, and re-caches with fresh provenance (the old edge's audit trail — `orphanedSourceIds`, `rederivedAt` — is preserved). Tokyo's answer grows from 16 to 20 pairs, and every one of them is correct.

A stateless agent gets this right by brute force (it never remembers anything). The pre-Phase-4 flywheel gets it **wrong forever**. The Phase 4 flywheel gets it right *and* still answers 19 of 20 queries with zero sub-calls.

## 5. Scorecard vs. PRD Targets

| Metric | Target | Result |
|---|---|---|
| Reprocessing ratio | ≤ mutation rate + 2pp | **5.0%** of records (2.5% of leaves) ✅ |
| Invalidation recall | 1.000 | **1.000** ✅ |
| Invalidation precision | ≥ 0.95 | **1.000** ✅ |
| Post-update F1 | 1.000 incl. category flips | **1.000** on all 20 ✅ |
| Amortization survival | ≈ 0 sub-calls after re-warm | **1 batched call, then 0 × 19** ✅ |
| Byte-identical re-ingest | empty diff, zero sweep | verified (dress rehearsal) ✅ |
| Cost vs. full rebuild | measured | **$0.7263 vs $0.8002** ✅ |

## 6. Honest Caveats

1. **The cost gap is small at this corpus size — by design of the corpus, not the architecture.** At 220 questions, a full rebuild's classification sweep is a handful of cheap batched sub-calls, so the drill saves only ~9%. The structural difference is that drill cost scales with the *mutation* (11 questions ≈ $0.007 of sub-LLM spend each) while rebuild cost scales with the *corpus*. At 220k questions and the same 5% churn, the rebuild re-classifies 220k questions; the drill re-classifies 11k. See the [FLYWHEEL_EXPLAINER cost model](./FLYWHEEL_EXPLAINER.md#the-cost-model-side-by-side) for the scaling argument.
2. **The amortization target ("0 sub-calls on unmutated cities") was mis-phrased in the PRD.** The protocol re-derives *all* contested questions in one batch on the first post-update query, whichever city that is (here: cairo, itself unmutated). That one call *is* the re-warm, not a cache miss; the meaningful observation is 1 → 0 × 19.
3. **Node-level quarantine is conservative and asymmetric.** Re-derivation un-contests the *edge*; contested Entity nodes stay contested until the Phase 5 entity-namespace work. No consumer currently reads node-level `contested`, so this is latent, not live.
4. **Mutations were mechanical, not adversarial.** Every mutated text still classifies cleanly under the rubric; ambiguous rewrites with contestable gold labels remain future work ([CRITIQUE_AND_FUTURE §3.3](./CRITIQUE_AND_FUTURE.md#33-benchmark-hardening)).
5. **n=1 full drill run** (plus an LLM-free dress rehearsal of Acts 2–3 with identical invalidation results). Variance reporting across repeated drills is future work, as it was for the original benchmark.

## 7. Reproducing

```bash
npm run oolong:ingest          # v1 physical + semantic layers
npm run oolong:flywheel-prep   # strip annotations; cold cache
npx tsx scripts/start_all.ts   # server + workers (needs OPENAI_API_KEY)
npm run drill:update           # all four acts, unattended (~$1.55)

npm run drill:update -- --acts 2,3   # LLM-free: mutation + diff + sweep + audit
npm run drill:reset                  # clear registry + drill leftovers to re-run
```

Artifacts: [update_drill_results.json](artifacts/update_drill_results.json) (metrics + per-query telemetry), [data/update_drill_manifest.json](../../data/update_drill_manifest.json) (the 11 mutations), [data/oolong_pairs_dataset_v2.json](../../data/oolong_pairs_dataset_v2.json) (mutated corpus + recomputed ground truth).
