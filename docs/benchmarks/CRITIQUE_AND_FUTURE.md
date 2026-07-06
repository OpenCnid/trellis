# OOLONG-Pairs: Critique, Risk Analysis & Roadmap

> **TL;DR** — The 20/20 perfect-F1 result is real — and replicated across two independent runs — but it should be read precisely: it was purchased with a frontier-class model, an explicit classification rubric, and a benchmark whose ground truth is internally consistent. The same flywheel mechanics that make Trellis cheap also make it *confidently wrong forever* if an early classification error slips into the graph. This document is the honest ledger: what the result does and does not prove, where the sharp edges are, and what we build next.

Companions: [OOLONG_BENCHMARK_REPORT.md](./OOLONG_BENCHMARK_REPORT.md) (the results) · [FLYWHEEL_EXPLAINER.md](./FLYWHEEL_EXPLAINER.md) (the mechanics).

---

## 1. The Accuracy vs. Cost Tradeoff — Why F1 Was Perfect, and What That Cost

Perfect scores deserve suspicion before celebration. Three deliberate choices produced them:

### 1.1 A larger model where it counts

The run used `gpt-5.4-2026-03-05` — full-size, not a mini variant — as both the root reasoner and the classification sub-LLM. Earlier iterations with smaller models exhibited exactly the failure mode TREC classification invites: **boundary confusion between categories**. *"Which river runs through Cairo?"* is `LOC` (the answer names a geographic body), but a weaker classifier reads "which ... thing" and answers `ENTY`; *"Who founded the settlement that became Oslo?"* is `HUM`, but drifts toward `DESC`. On a pairwise task these errors are vicious, because a single mis-labeled question deletes or fabricates an entire *row* of pairs: one LOC question wrongly tagged ENTY in a city with 4 HUM matches costs 4 pairs of recall at once. Quadratic tasks amplify linear errors.

### 1.2 An explicit rubric instead of vibes

The Spatial Flywheel Protocol does not ask the sub-LLM "what TREC category is this?" — it embeds a fixed rubric defining each category **by the type of answer the question expects**, with the confusable cases spelled out (a "which river" question is LOC *because the answer names a geographic body*). Classification prompts are templated, batched (~50 questions/call), and constrained to return a strict JSON mapping. The agent's own in-context guesses are declared inadmissible; only rubric-guided sub-LLM output may be cached.

### 1.3 Determinism everywhere the LLM isn't needed

City mentions are resolved by case-insensitive substring scan in Python; pair computation is a set join; answer parsing canonicalizes tuple order against the dataset's category index. The LLM touches exactly one decision per question — its category — and everything downstream of that decision is deterministic code.

**The tradeoff, stated plainly:** the flywheel makes the *expensive* configuration affordable. Spending frontier-model tokens on classification is only rational because each question is classified **once, ever** — $0.81–$0.87 total per run, versus a stateless agent re-paying frontier prices on all 20 queries. Cost went down *because* accuracy went up: cheaper models that mis-classify would trigger re-runs, cache poisoning, and downstream correction costs that dwarf the token savings.

> [!NOTE]
> **What this benchmark does *not* prove.** The corpus is synthetic, single-document, and 220 questions — small enough that one sweep fits in a handful of sub-calls. Real corpora bring ambiguous text where the "true" category is contestable, entity aliasing ("NYC" / "New York"), and documents that change after ingestion. The result proves the *architecture* — cache-first delegation with provenance-gated writes — not that F1 = 1.000 survives contact with production data.

## 2. The Double-Edged Cache — Frozen Errors

Here is the uncomfortable symmetry at the heart of the design:

> The flywheel's value is that a fact, once derived, is **never re-derived**.
> The flywheel's risk is that an error, once derived, is **never re-examined**.

If the sub-LLM had mis-classified `q_0042` as `ENTY` during the cold-phase sweep, `write_derived_insight` would have cached that error with perfectly valid Merkle provenance. Every subsequent query — cold, warm, this year, next year — would read the cache, skip re-classification (the protocol explicitly forbids re-classifying a question with an effective category), and reproduce the mistake **deterministically**. A stateless agent's errors are at least independent draws: it might mis-classify a question on Query 1 and get it right on Query 7. The flywheel converts stochastic error into systematic error.

Three specific aggravating factors:

1. **Provenance proves origin, not correctness.** `sourceNodeIds` guarantees a cached fact points at the exact bytes it was derived *from* — it says nothing about whether the derivation was right. The Merkle layer detects *drift* (source text changed under a cached fact) but is blind to *original sin* (the fact was born wrong).
2. **No confidence signal survives caching.** A sub-LLM's hesitant 55/45 call between `LOC` and `ENTY` is flattened into the same crisp `has_category` edge as a trivially obvious classification. Downstream readers cannot distinguish bedrock from coin-flips.
3. **Errors compound across consumers.** The graph is a shared substrate. A poisoned classification is inherited not just by future benchmark queries but by every agent and analyst who trusts `DERIVED_INSIGHT` edges — the same amplification that makes the flywheel valuable amplifies its defects.

> [!WARNING]
> Treat the cache as an **append-only belief ledger, not a source of truth**. Its guarantees are provenance and consistency — every reader sees the same belief, anchored to the same bytes. Its non-guarantee is validity. Any production deployment must budget for the verification machinery below; the benchmark run simply didn't need it because zero errors occurred.

### Mitigation strategies

| Strategy | Mechanism | Cost profile |
|---|---|---|
| **Verification-on-hit (sampled)** | **Shipped in Phase 5.** On each sweep, re-classify a sampled batch with probability *p* (default 5%) and compare against live text. Disagreement quarantines the edge through the Phase 4 `contested` path. Validated end-to-end by the [Poisoning Drill](./POISONING_DRILL_REPORT.md): detection recall 1.000 at *p*=0.05 and *p*=0.10 (both within the expected 1/p sweep bound), 0% false disputes, post-recovery F1 1.000 at *p*=0.05. Mandatory-only verification alone (no sampling) measured recall 0.000 — the failure this strategy exists to close. | Converts $O(1)$ hits into $(1-p)\cdot O(1) + p\cdot O(\text{subcall})$ — tunable; measured at $0.16 (p=0.05) / $0.09 (p=0.10) to fully detect 11 poisoned beliefs in a 220-question corpus. |
| **Confidence scoring at write time** | **Shipped in Phase 5.** `write_derived_insight`/`write_derived_insights` carry an optional `confidence` (0.0–1.0), stamped alongside a versioned `rubricVersion`. Low-confidence or stale-rubric edges are mandatory for verification; confident edges are sampled. Validated by the same Poisoning Drill run. | Near-zero marginal write cost, measured: Act 1's entire 220-question corpus classified in **1** sub-call, $0.878. |
| **Consensus writes for contested categories** | For rubric-identified confusable boundaries (LOC/ENTY, HUM/DESC), require 2-of-3 agreement across sub-calls before caching. | ~2–3× classification cost on the contested subset only — still one-time, still amortized. |
| **Merkle-anchored invalidation** | **Shipped in Phase 4.** Edges carry `sourceNodeIds`; re-ingesting a changed document diffs Merkle node sets and a quarantine sweep contests every derived fact whose source hashes disappeared. Validated end-to-end by the [Update Drill](./UPDATE_DRILL_REPORT.md): recall 1.000, precision 1.000, post-update F1 1.000 through three induced cache poisonings. | Free at read time; sweep runs as an ingestion-side worker (`invalidation_queue`). |

## 3. Future Improvements

### 3.1 Cache Eviction, TTL & Trust Decay

The current cache has one implicit TTL: *forever*. The roadmap replaces blind permanence with **earned permanence**:

- **Trust accrual:** each verification pass that confirms an edge increments a `verified_count`; edges below a trust threshold stay in the sampled-verification pool, edges above it graduate to rare spot-checks.
- **Time/version-based re-examination:** classifications older than the current rubric version (the rubric is itself versioned prompt text) are re-verified lazily on next hit rather than evicted eagerly — no thundering-herd re-classification.
- **Quarantine over deletion:** a disputed edge is never silently removed (that would break the append-only audit story); it is marked contested, excluded from effective-category resolution, and queued for arbitration. History remains inspectable.

> [!TIP]
> The economics stay favorable: even aggressive 10% verification-on-hit would have added roughly four sub-calls across this run's 19 post-sweep queries — a few cents — while bounding the lifetime of any frozen error to ~10 cache reads in expectation. Insurance against systematic error is one of the cheapest things the flywheel can buy.

### 3.2 Parallel Ingestion & Classification

The classification sweep ran as sequential micro-batches inside single REPL sessions in both runs — Run A: 5 sub-calls and 222 tool calls in Query 1 (24.8s); Run B: 7 sub-calls and ~230 tool calls spread across Queries 1–4, dominated by the 184-tool-call bulk sweep at lima. Fine at 220 questions, untenable at 220,000. The path forward:

- **Concurrent classification workers:** shard the unclassified catalog across *k* parallel `llm_query_batched` dispatches. Classification is embarrassingly parallel — no question's label depends on another's — so wall-clock drops roughly linearly in *k* until rate limits bind.
- **Bulk insight writes:** `write_derived_insight` currently issues one MERGE round-trip per fact (the dominant share of those 222 tool calls). A batched variant taking a list of (subject, verb, object, sourceNodeIds) tuples in a single Cypher `UNWIND` would collapse 220 writes into a handful.
- **Ingestion-time pre-classification:** the deepest fix is moving the sweep out of query time entirely — classify as a background stage of the `/ingest` pipeline, so the *first* user query already finds a warm graph. Query-time delegation then becomes the exception path for stragglers, not the rule. Idempotency is free: workers that re-derive the same fact MERGE into the same edge.

### 3.3 Benchmark Hardening

To convert "the architecture works" into "the architecture works under stress":

- **Anti-shortcut corpus (dataset v2)** — **shipped in Session 6.** The v1 corpus embedded every city mention as the literal capitalized token, so the substring scan in §1.3 could satisfy the pair query without ever consulting cached classifications — the shortcut this document called out. `data/oolong_pairs_dataset_hard.json` (`oolong-pairs-trec-synthetic-v2`, seeded generator in `src/benchmarks/oolong/generate_v2.ts`) breaks it three ways: 28 LOC/HUM questions mention their city only through a deterministic alias table ("the French capital" — the canonical token never appears, pinned by a unit test); 20 near-miss questions name-drop a city they are not annotated with (quoted artifacts like *"Who composed the waltz "Vienna"?"* plus cross-city ENTY records); and 20 non-question prose paragraphs mentioning city surface forms are ingested as `:Passage` nodes that can never pair. Ground truth still derives offline from annotations, and the deterministic `REFERENCES` traversal still reproduces it exactly (`npm run test:benchmark-hardening`). Gold labels stay uncontestable by construction — genuinely ambiguous questions remain future work below.
- **Cache-audit accuracy as a first-class metric** — **shipped in Session 6.** The audit arithmetic moved into `src/benchmarks/oolong/cache_audit.ts`, shared by `scripts/audit_flywheel_cache.ts`, the benchmark runner (which now appends a post-warm `cache_audit` block to its results file), and the poison drill (post-poison and post-detection effective-cache accuracy) — cache trustworthiness is recorded next to F1 instead of out-of-band.
- **Cache-poisoning drills** — **shipped in Phase 5** (see the [Poisoning Drill report](./POISONING_DRILL_REPORT.md)); Session 6 added the shared cache-accuracy metric to its results.
- **Real TREC import** — still open, deliberately: OOLONG-Pairs needs per-question concept annotations that real TREC lacks, so an import requires a paid, non-deterministic annotation pass. Record: future work, not attempted synthetically.
- **Adversarial corpora** — still open: deliberately ambiguous questions with contested gold labels, to measure how mitigation strategies handle genuinely soft ground truth rather than clean synthetic labels (v2 keeps labels clean on purpose).
- **Embedding-based retrieval difficulty** — still open: v2's paraphrases defeat lexical scans, but an embedding index would re-cheapen them; a future corpus should measure semantic-similarity shortcuts too.
- **Scale sweeps** — still open: 10k+ question corpora and 100+ concepts, where context rot destroys flat baselines and the one-time sweep cost becomes material enough to measure amortization curves properly.
- **Multi-run variance reporting** — still open: the two existing runs already show the sweep's position varying (all-in-Query-1 in Run A vs. spread across Queries 1–4 in Run B; see the [report §3.3](./OOLONG_BENCHMARK_REPORT.md#33-flywheel-hypothesis-check--both-runs)); moving from n=2 to reported distributions over many runs will make the amortization claim statistically robust, including variance in *when* zero-sub-call steady state is reached.

> [!NOTE]
> No paid benchmark run against v2 has been executed. The v1 telemetry ($0.81–$0.87 per 20-query run) is the cost basis for estimating one; a v2 run requires explicit owner approval first and its warm phase is expected to *discriminate* (the flywheel's cached categories help, but mention resolution is no longer free), so F1 below 1.0 is an acceptable — indeed informative — outcome.

## 4. Closing Assessment

The OOLONG-Pairs run validates the core bet: **an agent with a provenance-gated memory beats an agent with a bigger context window**, on exactly the task class designed to punish context windows. The 26× projected cost advantage at scale (see the [cost model](./FLYWHEEL_EXPLAINER.md#the-cost-model-side-by-side)) is real, and the perfect F1 shows the cache was seeded cleanly under benchmark conditions.

The mature reading is that Trellis has traded the *stochastic* error profile of stateless agents for a *systematic* one — a trade worth making only because systematic errors, unlike stochastic ones, sit still in a graph where verification machinery can hunt them. Building that machinery — confidence-carrying writes, sampled verification, quarantine-based arbitration, and parallel ingestion — is the roadmap. The flywheel is spinning; the next engineering phase is making sure it can never spin a lie for long.
