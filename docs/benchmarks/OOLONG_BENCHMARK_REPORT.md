# OOLONG-Pairs Benchmark Report — Walkthrough & Telemetry Summary

> **TL;DR** — The Trellis RLM agent scored a **perfect F1 = 1.000 on all 20 queries** of the OOLONG-Pairs benchmark — in **two independent clean-sweep runs** — a task class on which flat-context frontier models degrade toward 0% accuracy at scale. More importantly, it did so while **amortizing its reasoning**: after the very first queries paid for sub-LLM classification, every subsequent query answered from cached graph facts with **zero sub-LLM calls**. Total run cost: **$0.81–$0.87** for 20 quadratic-aggregation queries.

This report walks through the benchmark configuration, presents the full telemetry from the clean-sweep run, and documents the two verification modules that guarantee the results are real — not artifacts of a model answering from memory.

**Companion documents:**

- [FLYWHEEL_EXPLAINER.md](./FLYWHEEL_EXPLAINER.md) — why the cold→warm cost collapse is a paradigm shift, not an optimization.
- [CRITIQUE_AND_FUTURE.md](./CRITIQUE_AND_FUTURE.md) — honest analysis of risks (frozen-cache errors) and the roadmap.
- [UPDATE_DRILL_REPORT.md](./UPDATE_DRILL_REPORT.md) — the Phase 4 sequel: the same corpus mutated under a warm cache, and the invalidation loop that keeps F1 at 1.000 through the change.

---

## 1. What Is OOLONG-Pairs, and Why Is It Hard?

OOLONG-Pairs (from the MIT CSAIL Recursive Language Model line of work) is a **pairwise aggregation** benchmark. A typical query looks like:

> *"Find every pair of questions (a, b) where **a** has TREC category `LOC`, **b** has TREC category `HUM`, and **both** mention the city `cairo`."*

This is brutally hard for flat-context LLMs for a structural reason: any entry in the corpus can pair with any other entry, so the search space scales **quadratically**:

$$\text{Search Space} \propto \frac{n(n-1)}{2} = O(n^2)$$

A "needle-in-a-haystack" task asks a model to find one fact. OOLONG-Pairs asks it to correctly classify *every* entry, extract the entity each one mentions, and then compute a full cross-product join — all without dropping or hallucinating a single pair. As context grows past ~8k tokens, standard frontier models experience "context rot" and accuracy collapses toward 0%. See the full problem statement in [docs/operations/OOLONG_BENCHMARK_GUIDE.md](../operations/OOLONG_BENCHMARK_GUIDE.md).

## 2. Test Configuration

### 2.1 The Corpus

The run uses `oolong-pairs-trec-synthetic-v1`, a synthetic TREC-style corpus validated at the boundary by [schema.ts](../../src/benchmarks/oolong/schema.ts) (Architecture Invariant 3: no unvalidated data touches the ingestion pipeline).

| Property | Value |
|---|---|
| Total questions | **220** |
| TREC category distribution | LOC 50 · HUM 50 · DESC 35 · ENTY 35 · NUM 35 · ABBR 15 |
| Cities (concepts) | **14** — cairo, dublin, havana, lima, mumbai, nairobi, oslo, paris, prague, quito, seoul, tokyo, vienna, zagreb |
| Ground-truth LOC×HUM pairs | **182** across all cities |

The corpus is ingested through the standard Trellis pipeline: every question becomes a Merkle-addressed AST node in PostgreSQL (`id = SHA256(type + ":" + content)`) and a `(:Question)` node in Neo4j whose `sourceNodeIds` property points back at those physical hashes.

> [!IMPORTANT]
> **The Merkle constraint is what makes the cache trustworthy.** Every semantic node and edge in Neo4j carries `sourceNodeIds` — the cryptographic hashes of the exact physical AST nodes it was derived from. A cached classification is never a free-floating opinion: it is permanently, verifiably anchored to the bytes that justified it. If the underlying text changes, its hash changes, and the stale provenance is detectable.

### 2.2 The Query Sequence

The runner ([oolong_runner.ts](../../src/benchmarks/oolong_runner.ts)) executes **20 queries** against the live `/api/rlm-stream` SSE endpoint:

- **Queries 1–14 (Cold Phase):** one query per city, in alphabetical order. The semantic graph starts with **no cached classifications** — the agent must earn every category label.
- **Queries 15–20 (Warm Phase):** repeats of the first six cities (cairo → nairobi). The hypothesis: cached classifications should collapse sub-call count and cost.

### 2.3 The Agent Under Test

The agent is a Python RLM ([trellis_agent.py](../../src/rlm/trellis_agent.py)) running `gpt-5.4-2026-03-05` inside a REPL sandbox with exactly two injected tools ([trellis_tools.py](../../src/rlm/trellis_tools.py)):

| Tool | Layer | Capabilities |
|---|---|---|
| `trellis_neo4j` | Semantic graph | `run_cypher(query)` — **read-only** (mutation keywords blocked); `write_derived_insight(subject, verb, obj, sourceNodeIds)` — the **only** permitted write, and it refuses to run without provenance hashes |
| `trellis_postgres` | Physical AST | `get_ast_texts(hashes)` — exact text lookup by Merkle hash; `vector_search(query)` — pgvector hybrid fallback |

The system prompt enforces the **Spatial Flywheel Protocol**: check the graph's `DERIVED_INSIGHT` cache first; delegate only *uncached* classifications to batched `llm_query` sub-calls using a fixed TREC rubric; write every new label back with `write_derived_insight` before answering; resolve city mentions deterministically in Python (substring scan over `q.text`), never from cache absence.

## 3. The Telemetry — Cold Phase → Warm Phase

The benchmark was executed twice, independently, on two development branches — both clean sweeps at F1 = 1.000 on all 20 queries. **Run A** is the canonical run whose artifact is committed to the repository; **Run B** is an independent replication whose telemetry survives as the console log. The two runs differ in *where* the classification sweep lands (see §3.3), which is itself informative.

### 3.1 Run A (canonical — persisted artifact)

Full per-query results from [benchmark_results.json](../../benchmark_results.json), model `gpt-5.4-2026-03-05`:

| # | City | Phase | F1 | Pairs | Tokens | Sub-calls | Tool calls | Cost | Time |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | cairo | 🧊 cold | **1.000** | 16/16 | 26,290 | **5** | **222** | $0.0879 | 24.8s |
| 2 | dublin | 🧊 cold | **1.000** | 6/6 | 13,213 | 0 | 2 | $0.0384 | 12.0s |
| 3 | havana | 🧊 cold | **1.000** | 16/16 | 13,732 | 0 | 2 | $0.0399 | 13.1s |
| 4 | lima | 🧊 cold | **1.000** | 16/16 | 12,944 | 0 | 2 | $0.0387 | 14.2s |
| 5 | mumbai | 🧊 cold | **1.000** | 6/6 | 8,505 | 0 | 2 | $0.0306 | 14.1s |
| 6 | nairobi | 🧊 cold | **1.000** | 16/16 | 8,374 | 0 | 3 | $0.0290 | 13.1s |
| 7 | oslo | 🧊 cold | **1.000** | 9/9 | 20,348 | 0 | 16 | $0.0591 | 15.7s |
| 8 | paris | 🧊 cold | **1.000** | 16/16 | 16,387 | 0 | 2 | $0.0477 | 13.5s |
| 9 | prague | 🧊 cold | **1.000** | 12/12 | 13,673 | 0 | 4 | $0.0427 | 14.4s |
| 10 | quito | 🧊 cold | **1.000** | 16/16 | 18,350 | 0 | 2 | $0.0544 | 16.3s |
| 11 | seoul | 🧊 cold | **1.000** | 9/9 | 12,838 | 0 | 2 | $0.0380 | 12.1s |
| 12 | tokyo | 🧊 cold | **1.000** | 16/16 | 18,661 | 0 | 2 | $0.0554 | 14.6s |
| 13 | vienna | 🧊 cold | **1.000** | 12/12 | 14,334 | 0 | 4 | $0.0441 | 17.7s |
| 14 | zagreb | 🧊 cold | **1.000** | 16/16 | 8,748 | 0 | 4 | $0.0306 | 13.1s |
| 15 | cairo | 🔥 warm | **1.000** | 16/16 | 19,064 | 0 | 4 | $0.0558 | 15.1s |
| 16 | dublin | 🔥 warm | **1.000** | 6/6 | 11,821 | 0 | 2 | $0.0352 | 11.5s |
| 17 | havana | 🔥 warm | **1.000** | 16/16 | 12,733 | 0 | 15 | $0.0388 | 12.5s |
| 18 | lima | 🔥 warm | **1.000** | 16/16 | 4,688 | 0 | 30 | $0.0254 | 15.1s |
| 19 | mumbai | 🔥 warm | **1.000** | 6/6 | 12,192 | 0 | 2 | $0.0359 | 11.5s |
| 20 | nairobi | 🔥 warm | **1.000** | 16/16 | 12,831 | 0 | 2 | $0.0379 | 12.0s |

### 3.2 Run B (replication — independent branch)

Per-query results from the replication run's console log, same model, same 20-query sequence:

| # | City | Phase | F1 | Pairs | Tokens | Sub-calls | Tool calls | Cost | Time |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | cairo | 🧊 cold | **1.000** | 16/16 | 25,979 | **1** | 17 | $0.0790 | 21.5s |
| 2 | dublin | 🧊 cold | **1.000** | 6/6 | 20,501 | **1** | 14 | $0.0618 | 18.7s |
| 3 | havana | 🧊 cold | **1.000** | 16/16 | 14,760 | **1** | 16 | $0.0481 | 16.1s |
| 4 | lima | 🧊 cold | **1.000** | 16/16 | 18,955 | **4** | **184** | $0.0679 | 20.1s |
| 5 | mumbai | 🧊 cold | **1.000** | 6/6 | 4,261 | 0 | 4 | $0.0211 | 13.4s |
| 6 | nairobi | 🧊 cold | **1.000** | 16/16 | 3,944 | 0 | 2 | $0.0179 | 11.8s |
| 7 | oslo | 🧊 cold | **1.000** | 9/9 | 12,991 | 0 | 2 | $0.0423 | 14.5s |
| 8 | paris | 🧊 cold | **1.000** | 16/16 | 17,974 | 0 | 2 | $0.0509 | 12.3s |
| 9 | prague | 🧊 cold | **1.000** | 12/12 | 12,873 | 0 | 2 | $0.0404 | 13.8s |
| 10 | quito | 🧊 cold | **1.000** | 16/16 | 13,161 | 0 | 2 | $0.0390 | 12.3s |
| 11 | seoul | 🧊 cold | **1.000** | 9/9 | 12,645 | 0 | 2 | $0.0378 | 11.8s |
| 12 | tokyo | 🧊 cold | **1.000** | 16/16 | 13,015 | 0 | 2 | $0.0387 | 11.3s |
| 13 | vienna | 🧊 cold | **1.000** | 12/12 | 14,284 | 0 | 4 | $0.0435 | 11.8s |
| 14 | zagreb | 🧊 cold | **1.000** | 16/16 | 9,073 | 0 | 2 | $0.0322 | 12.8s |
| 15 | cairo | 🔥 warm | **1.000** | 16/16 | 8,975 | 0 | 2 | $0.0312 | 12.3s |
| 16 | dublin | 🔥 warm | **1.000** | 6/6 | 14,434 | 0 | 7 | $0.0480 | 16.5s |
| 17 | havana | 🔥 warm | **1.000** | 16/16 | 11,705 | 0 | 2 | $0.0343 | 11.4s |
| 18 | lima | 🔥 warm | **1.000** | 16/16 | 4,143 | 0 | 4 | $0.0199 | 11.6s |
| 19 | mumbai | 🔥 warm | **1.000** | 6/6 | 4,205 | 0 | 2 | $0.0205 | 13.0s |
| 20 | nairobi | 🔥 warm | **1.000** | 16/16 | 12,243 | 0 | 2 | $0.0367 | 12.5s |

### 3.3 Flywheel Hypothesis Check — Both Runs

| Metric | Run A cold | Run A warm | Run B cold | Run B warm |
|---|--:|--:|--:|--:|
| Mean F1 | **1.000** | **1.000** | **1.000** | **1.000** |
| Mean sub-LLM calls | 0.36 | **0.00** | 0.50 | **0.00** |
| Mean cost / query | $0.0455 | $0.0382 | $0.0443 | $0.0318 |
| Mean tokens / query | 14,743 | 12,222 | 13,887 | 9,284 |
| **Total run cost** | **$0.8655** | | **$0.8115** | |

> [!TIP]
> **The most important number in these tables is the sub-call column — and the two runs tell the same story via different routes.** In **Run A**, Query 1 (cairo) paid the full price of understanding the corpus in one shot: 5 batched sub-LLM classification calls and 222 tool calls sweeping the *entire* 220-question corpus, writing every category label into Neo4j as `DERIVED_INSIGHT` edges — sub-calls are exactly 0 from Query 2 onward. In **Run B**, the agent classified incrementally: single sub-calls at cairo, dublin, and havana, then a bulk-classification sweep at Query 4 (lima: 4 sub-calls, 184 tool calls) mapping the remaining unclassified corpus — sub-calls are exactly 0 from Query 5 onward. Either way, **the flywheel finished spinning up while still deep inside the cold phase.** The cold/warm boundary at Q15 turned out to be a formality; the real transition happened at Q2 (Run A) or Q5 (Run B), and both runs held zero sub-calls for every query thereafter.

Note that per-query cost never drops to literally zero: every query still pays for the root model reading the protocol prompt and executing 2–4 REPL turns (~$0.03–0.05). What drops to zero is the *semantic* work — the sub-LLM classification calls that dominate standard RLM cost. See [FLYWHEEL_EXPLAINER.md](./FLYWHEEL_EXPLAINER.md) for the full cost-model analysis.

## 4. Verification Modules — Why You Can Trust These Numbers

Perfect scores invite skepticism. Two independent verification modules exist to close the loopholes a benchmark like this could otherwise hide.

### 4.1 Task 2b — REPL Error-Trapping Feedback Routing

**The question it answers:** *when a database call fails inside the sandbox, does the agent actually see the failure and recover — or does the pipeline silently swallow errors?*

The test ([scripts/test_repl_error_routing.ts](../../scripts/test_repl_error_routing.ts)) sends the agent a deliberately adversarial two-step instruction:

```
Step 1: Execute EXACTLY this Cypher string first, verbatim and unmodified:
        MATCH (q:Question WHERE q.category = 'LOC' RETRUN count(q AS n
Step 2: After observing what happens, figure out the correct query and
        determine how many Question nodes with category 'LOC' exist.
        Reply with FINAL_ANSWER: <integer>.
```

The injected query contains a genuine syntax error (`RETRUN`, plus an unclosed pattern) — chosen deliberately, because merely matching a non-existent label would *not* throw in Neo4j; it would just return 0 rows and prove nothing. The verified failure→recovery chain:

1. **The exception is raised, not masked.** `trellis_neo4j.run_cypher` executes the broken string verbatim (the agent's directives forbid pre-correcting a user-supplied query). Neo4j rejects it; the wrapper re-raises it as `RuntimeError("Neo4jError while executing Cypher: ...")` — a marker string that can only originate from a real database round-trip.
2. **The traceback is routed back as an observation.** The RLM REPL loop intercepts the Python traceback and injects it into the agent's next conversation turn, exactly like any other tool output.
3. **The agent self-corrects.** Reading the traceback, the model rewrites the query with valid syntax — `MATCH (q:Question) WHERE q.category = 'LOC' RETURN count(q)` — and gets the true answer: **50** (the corpus contains exactly 50 LOC questions).
4. **All within budget.** The recovery completes inside the 5-iteration limit, with full telemetry emitted.

The Postgres side has the matching safety property: `trellis_postgres` wraps every statement so that a failed SQL call issues `conn.rollback()` **before** re-raising. Without the rollback, PostgreSQL would leave the connection in an aborted-transaction state and *poison every subsequent query* — the agent's corrected retry would fail too, and the feedback loop would spiral. With it, each traceback is an isolated, recoverable observation.

> [!IMPORTANT]
> This is the property that makes an autonomous database agent viable at all: **errors are observations, not terminations.** The sandbox converts every database exception into structured feedback the model can reason about, while rollback guarantees the *next* attempt starts from a clean transaction.

### 4.2 Task 2c — Flywheel Telemetry Runner

**The question it answers:** *are the F1 scores and cost figures measured honestly, end to end, against the live system?*

The runner ([oolong_runner.ts](../../src/benchmarks/oolong_runner.ts)) is a Node.js harness that treats the agent as a black box behind the production `/api/rlm-stream` endpoint:

- **Streaming SSE transport** ([rlm_client.ts](../../src/benchmarks/oolong/rlm_client.ts)): each query is dispatched as a GET to `/api/rlm-stream`; the client accumulates `stdout`/`stderr` SSE frames, resolves on the `done` event, and extracts the `FINAL_ANSWER` text plus the machine-parseable `TRELLIS_TELEMETRY` JSON payload (tokens, sub-call count, tool calls, reported cost).
- **Canonicalizing pair parser:** predicted `(q_x, q_y)` tuples are extracted by regex and re-oriented to `(LOC id, HUM id)` using the dataset's category index — so a semantically correct pair written in the wrong order still scores, while pairs with genuinely wrong categories are kept and scored as spurious.
- **Set-based F1 scoring:** precision, recall, and F1 are computed per query against ground truth derived directly from the dataset (`LOC × HUM` cross-product per city).
- **Provenance enforcement:** any run that produced an answer with **zero database tool calls** is flagged `TRELLIS_PROTOCOL_VIOLATION` and re-dispatched (up to 3 attempts) — an answer that never touched either database has no provenance and is inadmissible, *even if it happens to be correct*. Crucially, the cost of every discarded attempt is still accumulated into the query's reported cost, so retries can't hide money.
- **Audit trail:** every query's full stdout/stderr is written to `benchmark_logs/`, and the aggregate report to [benchmark_results.json](../../benchmark_results.json).

## 5. Bottom Line

| Claim | Evidence |
|---|---|
| Perfect accuracy on a quadratic aggregation task | 20/20 queries at F1 = 1.000 in **both independent runs**; 182/182 ground-truth pairs recovered across each cold phase |
| Reasoning is cached, not repeated | Sub-calls hit exactly 0 by Q2 (Run A) / Q5 (Run B) and stayed there for every remaining query |
| Results have provenance | Every cached fact carries `sourceNodeIds` Merkle hashes; zero-tool-call answers are rejected outright |
| Failure handling is real | Task 2b: injected syntax error → traceback fed back → self-corrected answer of 50 within budget |
| Measurement is honest | Black-box SSE harness, retry costs accumulated, full logs persisted |

The result: a system that pays for understanding **once**, remembers it **with cryptographic provenance**, and answers every subsequent question about the corpus at the cost of a database lookup. Why that matters strategically is the subject of [FLYWHEEL_EXPLAINER.md](./FLYWHEEL_EXPLAINER.md).
