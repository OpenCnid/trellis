# Phase 4 PRD: The Invalidation Loop & Update Drill

## 1. Product Vision

Trellis's founding claim is that standard GraphRAG **breaks when documents are updated**, while our Merkle-hashed coordinate system survives drift. Phases 1–3 built the coordinate system and proved the flywheel (OOLONG-Pairs, F1 = 1.000 twice); but as of Phase 3 there is **no code path that handles a document update**. `/ingest` is insert-only (`ON CONFLICT (id) DO NOTHING`), documents have no identity across versions, and no process ever invalidates a derived fact whose source bytes have vanished. The differentiator is a claim, not a feature.

Phase 4 closes the loop. We build the **document-update lifecycle end-to-end** — versioned re-ingestion, Merkle tree diff, and provenance-driven quarantine of orphaned semantic facts — and we prove it with a new benchmark, the **Update Drill**, which measures exactly the property competitors cannot match: after a partial corpus mutation, Trellis re-processes *only what changed* and invalidates *only what was affected*, while a flat GraphRAG baseline must rebuild everything.

This also discharges the sharpest risk in [CRITIQUE_AND_FUTURE.md](../benchmarks/CRITIQUE_AND_FUTURE.md): the flywheel converts stochastic error into systematic error. Merkle-anchored invalidation is the first (and cheapest) verification machine — it bounds the lifetime of any cached fact to the lifetime of the bytes that justified it.

## 2. Architectural Shift (The 3 Changes)

* **Change 1: Documents Get Identity.** Today `document_id` in `ast_nodes` is just the root hash — two versions of the same document are unrelated strangers. We introduce a `documents` registry in PostgreSQL mapping a stable `doc_key` to its version history of root hashes. Re-ingesting under an existing `doc_key` creates a new version and triggers the diff, instead of a blind insert.
* **Change 2: The Merkle Diff Pays Its Rent.** The whole point of subtree hashing is that an unchanged subtree has an unchanged hash. On re-ingest we set-compare the new AST's node hashes against the prior version's: **shared hashes are skipped entirely** (no re-extraction, no re-embedding), only genuinely new leaf nodes enter the extraction queue, and hashes present in the old version but absent from the new one become the **orphan set**.
* **Change 3: Quarantine, Never Delete.** A new sweep stage walks Neo4j for every node and edge whose `sourceNodeIds` intersect the orphan set and marks them `contested: true` (with `contestedAt` and `orphanedSourceIds`). Nothing is deleted — the append-only belief-ledger stance from the critique doc holds. The RLM protocol and `/retrieve` are updated to exclude contested facts from effective resolution, which forces the flywheel to lazily re-derive them from the new bytes on next demand.

## 3. Milestones

### Milestone 1: Document Registry & Versioned Ingestion (`src/api/server.ts`, `src/config/init_db.ts`)

* New table:
  ```sql
  CREATE TABLE documents (
    doc_key    TEXT NOT NULL,
    version    INTEGER NOT NULL,
    root_hash  TEXT NOT NULL REFERENCES ast_nodes(id),
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (doc_key, version)
  );
  ```
* `/ingest` accepts an optional `doc_key` (query param or multipart field). Without it, behavior is unchanged (anonymous one-shot ingest, `doc_key` defaults to the root hash). With it:
  * If no prior version exists → register `(doc_key, 1, root_hash)` and proceed as today.
  * If a prior version exists → register version `n+1` and hand both root hashes to the diff engine (Milestone 2).
* Re-ingesting **byte-identical** content is a no-op: same root hash → same version's root hash → empty diff, zero queued jobs. Idempotency is the first correctness test.

### Milestone 2: Merkle Diff Engine (`src/core/ast/diff.ts`)

* A `document_nodes (root_hash, node_id)` membership table records every version's full node set at ingest time — `ast_nodes.document_id` is not authoritative for membership, because `ON CONFLICT DO NOTHING` pins a node shared across versions to whichever version inserted it first.
* `diffVersions(oldRootHash, newRootHash)` loads both versions' node-id sets from `document_nodes` (the new version's rows are persisted in the same transaction as its AST nodes) and returns:
  * `added: string[]` — hashes in new, not in old → these (leaf nodes only) are queued for extraction/embedding. **Nothing else is queued.**
  * `orphaned: string[]` — hashes in old, not in new → input to the quarantine sweep.
  * `retained: string[]` — the intersection; logged for telemetry (this is the "work avoided" number the Update Drill reports).
* Because node ids are content hashes, the diff is two set operations — no tree alignment, no edit-distance. A moved-but-unchanged paragraph keeps its hash and costs nothing.
* **Design note — positional hashing rejected.** An earlier draft required adding the sibling index to the leaf hash so duplicate paragraphs get distinct ids. Implementation showed this breaks two load-bearing invariants: (1) the OOLONG ingestion pipeline's hash-integrity verification re-parses each record's *standalone* markdown and requires identical hashes ("content addressing makes block IDs context-free" — the Golden Rule of the AST), and (2) positional salts would contradict the moved-paragraph guarantee above, invalidating facts whose bytes never changed. Duplicate collapse is in fact *coherent* under content addressing: a derived fact anchored to hash X remains valid as long as content X exists anywhere in the document, which is exactly what the set diff computes. Per-version membership (including versions that share nodes) is tracked in `document_nodes`; per-occurrence spatial distinctness remains a known limitation of the bounding-box story, not of invalidation correctness.

### Milestone 3: Quarantine Sweep (`src/workers/invalidation_worker.ts`)

* A new BullMQ queue (`invalidation_queue`) receives `{ docKey, oldVersion, newVersion, orphanedHashes }` after each versioned re-ingest.
* The worker runs one Cypher pass per re-ingest (batched `UNWIND` over the orphan set):
  * Any `Entity`/`Question` node or `ACTION`/`REFERENCES`/`DERIVED_INSIGHT` edge whose `sourceNodeIds` intersect the orphan set gets `contested = true`, `contestedAt = timestamp()`, and `orphanedSourceIds` recording which hashes died.
  * Facts with **mixed** provenance (some sources orphaned, some alive) are still contested — a fact is only as trustworthy as its weakest source. Partial-provenance survival is explicitly out of scope for Phase 4 (see §5).
* Consumer updates:
  * `run_cypher` guidance and the Spatial Flywheel Protocol in [trellis_agent.py](../../src/rlm/trellis_agent.py): effective-category resolution ignores edges where `contested = true`; a contested classification is treated as *missing*, so the standard protocol re-delegates and re-caches it from the current bytes. The re-derived fact is written fresh; the contested edge remains as audit history.
  * `/retrieve` excludes contested edges from graph results by default (`?includeContested=true` to inspect them).

### Milestone 4: The Update Drill Benchmark (`src/benchmarks/update_drill_runner.ts`, `scripts/mutate_oolong_dataset.ts`)

The drill reuses the OOLONG-Pairs corpus and machinery ([oolong_runner.ts](../../src/benchmarks/oolong_runner.ts)) and runs in four acts:

1. **Warm-up:** ingest `oolong-pairs-trec-synthetic-v1` under `doc_key = oolong-corpus`, run the standard 20-query sequence to seed the flywheel cache, record baseline F1 and cost.
2. **Mutation:** `scripts/mutate_oolong_dataset.ts` produces corpus v2 by mutating ~5% of questions (≈11 of 220), in three flavors with per-question manifest entries:
   * *Rewrites* (same category, same city, new wording) — the cached category is now orphaned but re-derivation should reach the same label.
   * *Category flips* (e.g., a LOC question rewritten so the correct label becomes ENTY) — the poisoned-cache scenario: the old cached label is now **wrong**, and only invalidation saves us.
   * *City swaps* (question now mentions a different city) — exercises the deterministic mention scan against fresh text.
3. **Re-ingest & sweep:** re-ingest v2 under the same `doc_key`; capture diff and sweep telemetry, and measure the invalidation audit **here** (Act 4 legitimately clears quarantines by re-deriving, which would mask what the sweep caught).
4. **Post-update queries:** re-run the 20-query sequence against the mutated ground truth and score with the existing F1 machinery, plus a post-run [audit_flywheel_cache.ts](../../scripts/audit_flywheel_cache.ts) pass against v2 truth.

**As built (implementation notes):**

* The OOLONG corpus enters the system through the deterministic ingestion loop ([ingest_oolong_dataset.ts](../../scripts/ingest_oolong_dataset.ts)), not the LLM extraction pipeline — so Act 3 re-ingests via [reingest.ts](../../src/benchmarks/oolong/reingest.ts), which drives the same Phase 4 modules `/ingest` uses (registry, Merkle diff, quarantine sweep) and additionally refreshes the deterministic semantic layer for changed records only. Categories are **stripped** on refresh: the re-ingest must not leak ground-truth labels for exactly the mutated rows.
* If the registry has never seen `doc_key = oolong-corpus`, Act 3 first *adopts* the base corpus as v1 (registry + membership rows only; the semantic layer comes from `oolong:ingest`).
* Acts are individually runnable (`npm run drill:update -- --acts 2,3` is LLM-free); `npm run drill:reset` clears the drill's registry versions and semantic leftovers so the drill can re-run from Act 1 (`oolong:ingest` + `oolong:flywheel-prep` restore the v1 graph).
* Dress-rehearsal results (acts 2–3 against a simulated perfect warm-up cache): diff 23 added / 23 orphaned / 858 retained of 881 nodes; reprocessing ratio 5.0% of records (2.5% of leaves); invalidation recall **1.000**, precision **1.000**; byte-identical re-ingest yields an empty diff and zero sweep activity.

**Full-run results (2026-07-03, all four acts, `gpt-5.4-2026-03-05`; artifact: [update_drill_results.json](../../update_drill_results.json)):**

| Metric | Result | Target |
|---|---|---|
| Act 1 baseline | F1 = 1.000 on all 20 queries, $0.8002, 5 sub-calls (all in query 1) | — |
| Reprocessing ratio | **5.0%** of records (2.5% of leaves) | ≤ 7% |
| Invalidation recall | **1.000** (11/11 affected cached facts contested) | 1.000 |
| Invalidation precision | **1.000** (0 false quarantines) | ≥ 0.95 |
| Post-update F1 | **1.000** on all 20 queries vs. mutated truth — incl. all 3 category flips (e.g. tokyo 16→20 pairs after the NUM→LOC flip re-derived) | 1.000 |
| Amortization survival | **1 sub-call total** in Act 4: the single batched re-derivation of all 11 contested questions, landing in query 1; 19 subsequent queries ran at 0 | ≈ 0 after re-warm |
| Cost | drill **$0.7263** vs. full-rebuild baseline **$0.8002** | measured, not estimated |

Note on the amortization metric: the protocol re-classifies *all* contested questions in one batch on the first post-update query regardless of which city that query targets, so "sub-calls on unmutated-city queries = 1" is the re-warm itself, not a cache miss. The per-mutation marginal cost of the update was ~$0.007 of sub-LLM spend. The cost gap vs. rebuild understates the advantage at scale: at 220 questions the rebuild's classification sweep is a single cheap batch — the [FLYWHEEL_EXPLAINER cost model](../benchmarks/FLYWHEEL_EXPLAINER.md) covers how the gap widens with corpus size.

**Metrics reported** (written to `update_drill_results.json`):

| Metric | Definition | Target |
|---|---|---|
| **Reprocessing ratio** | leaf nodes re-extracted ÷ total leaf nodes | ≤ mutation rate + 2 pp (i.e., ~5–7%, not 100%) |
| **Invalidation recall** | affected cached insights contested ÷ affected (from mutation manifest) | 1.00 — a missed invalidation is a frozen lie |
| **Invalidation precision** | affected contested ÷ total contested | ≥ 0.95 — over-quarantine is tolerable, but measured |
| **Post-update F1** | mean F1 across the 20 queries vs. v2 ground truth | 1.00 — including every category-flipped question |
| **Amortization survival** | sub-calls in post-update queries touching *unmutated* questions | ≈ 0 — the cache must survive for the 95% that didn't change |
| **Cost vs. rebuild** | drill cost ÷ (full re-ingest + cold 20-query run) | headline chart: the Merkle discount, in dollars |

**The baseline:** the comparison column is "GraphRAG-style full rebuild" — wipe derived state, re-ingest v2 from scratch, re-run cold. We already have all the machinery to run this honestly; the drill report presents both columns side by side.

## 4. Success Metrics

Phase 4 is done when a single command (`npm run drill:update`) executes the four acts unattended and the results show, on the same run:

1. **The claim is now a feature:** a category-flipped question's stale cached label was contested by the sweep, re-derived from the new bytes, and the post-update query answered correctly — with the full audit trail (contested edge + fresh edge + provenance) inspectable in Neo4j.
2. **The Merkle discount is real:** reprocessing ratio ≈ mutation rate, and unmutated questions still answer with zero sub-calls after the update.
3. **Byte-identical re-ingest is free:** version bump, empty diff, zero queued jobs, zero contested edges.

## 5. Out of Scope (Phase 5 candidates)

* **Partial-provenance survival** — keeping a fact alive when only some of its sources changed requires per-source contribution tracking; Phase 4 contests conservatively.
* **Confidence-carrying writes & sampled verification-on-hit** — the second verification machine from the critique roadmap; invalidation handles *drift*, these handle *original sin*.
* **Eager re-derivation** — Phase 4 re-derives contested facts lazily on next query; a background "re-warm" worker is a straightforward follow-on once the sweep exists.
* **Entity namespace separation** (`kind` labels on derived nodes) — acknowledged debt; scheduled alongside the Merkle v2 hash change if migration timing allows.
