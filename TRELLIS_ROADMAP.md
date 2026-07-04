# Trellis Engine — Technical Roadmap

*Generated from a code-led review of the repository (July 2026). File and line references point at the current state of `master`-derived code in this working tree.*

---

## 1. Architecture Overview

Trellis is a provenance-preserving GraphRAG system. Its central design commitment is that every semantic fact must remain traceable to an immutable, content-addressed physical location in the source document. The system is organized as an asynchronous pipeline over a three-tier storage layout.

### 1.1 Components and Data Flow

```
                       ┌────────────────────────────────────────────┐
 Markdown / PDF ──►    │ Express API (src/api/server.ts, port 3000) │
                       └───────┬────────────────────────┬───────────┘
                               │ POST /ingest           │ GET /retrieve, /api/rlm-stream
                               ▼                        ▼
                   remark / unstructured.io      Neo4j 1-hop traversal
                   Merkle-hashed AST             + Postgres provenance lookup
                   (src/core/ast/parser.ts)      + pgvector fallback
                               │
                               ▼
                   PostgreSQL (ast_nodes: id, document_id, JSONB, vector(1536))
                               │
                               ▼ fan-out per leaf node
                   BullMQ / Redis (src/workers/queue.ts)
                               │
              ┌────────────────┼──────────────────────┐
              ▼                ▼                      ▼
   extraction_worker    rlm_worker             supervisor_worker
   (LLM structured      (spawns Python RLM     (contradiction scan →
    entity/action        agent, streams         LLM evaluation →
    extraction →         stdout via Redis       belief-state branching)
    Neo4j MERGE +        pub/sub → SSE)
    pgvector embed)
```

**Storage tiers:**

| Store | Role | Schema |
|---|---|---|
| PostgreSQL + pgvector | Physical layer: immutable AST nodes keyed by SHA-256 Merkle hash, plus embeddings | `ast_nodes(id, document_id, data JSONB, embedding vector(1536))` |
| Neo4j | Semantic layer: `Entity`, `Question`, `Concept` nodes; `ACTION`, `REFERENCES`, `CONTRADICTS`, `DERIVED_INSIGHT` edges, all carrying `sourceNodeIds` back-references | Uniqueness constraints on `Entity.id`, `Question.id`, `Concept.id` |
| Redis | BullMQ job queues (`extraction_queue`, `rlm_queue`, `supervisor_queue`) and pub/sub channels for SSE streaming | — |

**The RLM harness** ([src/rlm/trellis_agent.py](src/rlm/trellis_agent.py)) wraps the `rlms` recursive-LM library with two injected tools: a keyword-guarded read-only Neo4j client and a Postgres AST reader ([src/rlm/trellis_tools.py](src/rlm/trellis_tools.py)). The agent's only permitted graph write is `write_derived_insight`, which caches deduced facts as `DERIVED_INSIGHT` edges with mandatory provenance — the "flywheel" that makes repeat queries cheaper.

**The OOLONG-Pairs benchmark** (`src/benchmarks/`, `scripts/`) is a self-contained evaluation harness: a seeded deterministic dataset generator, a verify-as-you-go ingestion loop, a cache-stripping prep script, and a 20-query runner that scores set-based F1 and measures the cold→warm cost collapse. The committed [benchmark_results.json](benchmark_results.json) shows F1 = 1.0 on all 20 queries with mean sub-calls dropping from 0.36 (cold) to 0 (warm).

**The frontend** (`src/frontend/`) is a Next.js app with a force-directed graph pane and a provenance pane; clicking a graph node highlights the exact AST text blocks that produced it, proxied to the backend via a rewrite rule ([next.config.ts](src/frontend/next.config.ts)).

### 1.2 Design Paradigms

- **Pipeline / queue-driven**: ingestion is a fan-out of independent, retryable jobs (Architecture Invariant 4 in [.agents/AGENT_CODING_GUIDELINES.md](.agents/AGENT_CODING_GUIDELINES.md)).
- **Content addressing**: node identity is `SHA-256(type:content:metadata:childHashes)`; block hashes are context-free, which the ingestion loop exploits for independent re-derivation checks.
- **Verification-as-a-loop**: the OOLONG ingester ([scripts/ingest_oolong_dataset.ts](scripts/ingest_oolong_dataset.ts)) writes a batch, reads it back, re-derives every hash through the parser, and refuses to advance past a failing batch.
- **Boundary validation**: dataset files pass through Zod schemas ([src/benchmarks/oolong/schema.ts](src/benchmarks/oolong/schema.ts)) before touching the pipeline.

---

## 2. Current State and Code Quality

### 2.1 Strengths

- **Provenance threading is consistent.** `sourceNodeIds` is carried through extraction ([extraction_worker.ts:59-76](src/workers/extraction_worker.ts:59)), ingestion verification ([ingest_oolong_dataset.ts:216-224](scripts/ingest_oolong_dataset.ts:216)), the RLM write path ([trellis_tools.py:60-62](src/rlm/trellis_tools.py:60), which rejects writes without provenance), and the retrieval join. This is the project's core differentiator and it is enforced, not just documented.
- **The ingestion verification loop is well-structured.** [ingest_oolong_dataset.ts](scripts/ingest_oolong_dataset.ts) separates write, hash-integrity read-back, semantic write, and constraint verification into named phases with a shared retry helper ([retry.ts](src/benchmarks/oolong/retry.ts)) and clear failure semantics.
- **The benchmark runner is defensively written.** [oolong_runner.ts:76-84](src/benchmarks/oolong_runner.ts:76) canonicalizes predicted tuples by category so tuple-ordering mistakes don't mask correct answers; protocol violations (zero tool calls) trigger bounded re-dispatch; per-query logs are persisted.
- **The RLM sandbox has layered guards**: a mutation-keyword blocklist, a single whitelisted write path, tool-call counting for provenance enforcement, and exceptions that propagate real tracebacks back into the REPL loop for self-correction.
- **Documentation is unusually thorough** for a project at this stage: architecture, math foundations, runbook, benchmark spec, and self-critique (`docs/benchmarks/CRITIQUE_AND_FUTURE.md`) all exist. Newer code (benchmarks, RLM harness) carries purposeful comments explaining invariants rather than restating syntax.

### 2.2 Technical Debt and Concerns

Ordered roughly by severity.

**T1 — No test suite.** `package.json:10` is the npm default stub (`echo "Error: no test specified" && exit 1`). There is no unit test framework anywhere in the repo. The scripts under `scripts/` (`test_e2e_rlm.ts`, `run_adversarial_tests.ts`, etc.) are manual end-to-end probes that require live Docker infrastructure and an OpenAI key — they are not automated, not assertion-based, and not CI-runnable. Several modules are pure functions that could be tested today with zero infrastructure: [parser.ts](src/core/ast/parser.ts), [corpus.ts](src/benchmarks/oolong/corpus.ts), and the parse/score functions in [oolong_runner.ts:76-94](src/benchmarks/oolong_runner.ts:76) and [rlm_client.ts:32-58](src/benchmarks/oolong/rlm_client.ts:32).

**T2 — Extraction granularity is wrong for markdown ingestion.** [server.ts:78](src/api/server.ts:78) selects "leaf nodes" as any node with string content. In a remark AST, leaves are inline tokens (`text`, `inlineCode`, …), not blocks — so `Globex **acquired** Initech` fans out as three separate extraction jobs (`"Globex "`, `"acquired"`, `" Initech"`), none of which contains the full relationship. Extraction should operate at block level (paragraph/heading) with concatenated child text, as [corpus.ts:27-30](src/benchmarks/oolong/corpus.ts:27) already does via `nodeText()`. This directly degrades graph quality for any formatted document.

**T3 — Runtime dependency misclassification.** `ioredis` is in `devDependencies` ([package.json:41](package.json:41)) but is imported at runtime by [server.ts:183](src/api/server.ts:183), [queue.ts:2](src/workers/queue.ts:2), and [rlm_worker.ts:5](src/workers/rlm_worker.ts:5). A production install with `--omit=dev` will not start. Conversely, `@types/*`, `typescript`, and `tsx` sit in `dependencies`.

**T4 — The repo violates its own configuration invariant.** [.agents/AGENT_CODING_GUIDELINES.md:13](.agents/AGENT_CODING_GUIDELINES.md) mandates a schema-validated config object exported from `src/config/index.ts`; that file does not exist. Instead, connection details and passwords are hardcoded: Postgres and Neo4j credentials in [db.ts:5-17](src/config/db.ts:5), Redis host/port in [queue.ts:4-8](src/workers/queue.ts:4) and duplicated in [server.ts:201-204](src/api/server.ts:201) and [rlm_worker.ts:7-10](src/workers/rlm_worker.ts:7). The Python tools ([trellis_tools.py:22-26](src/rlm/trellis_tools.py:22)) do read env vars, so the two halves of the system configure differently.

**T5 — Machine-specific path hardcoded in the RLM worker.** [rlm_worker.ts:25](src/workers/rlm_worker.ts:25) sets `PYTHONPATH` to `C:\Users\Darian\AppData\Roaming\Python\Python313\site-packages`. The RLM pipeline cannot run on any other machine without editing source. The bare `python` executable name is also platform-dependent.

**T6 — No authentication, rate limiting, or concurrency control on the API.** All three endpoints are unauthenticated. `/api/rlm-stream` is the sharpest edge: each GET spawns a Python process that makes paid LLM calls and holds database connections ([server.ts:186-239](src/api/server.ts:186)). An unauthenticated caller can generate unbounded cost and process load. There is also no cap on concurrent RLM jobs beyond BullMQ's default worker concurrency.

**T7 — The Cypher read-only guard is a keyword blocklist, and APOC is enabled.** [trellis_tools.py:34-41](src/rlm/trellis_tools.py:34) blocks `CREATE/MERGE/SET/...` by word-boundary regex, but [docker-compose.yml:26](docker-compose.yml:26) installs the APOC plugin — `CALL apoc.create.node(...)` and similar procedures mutate the graph without using any blocked keyword. The blocklist also false-positives on legitimate queries that contain the words in string literals. The robust fix is transport-level: open sessions with `default_access_mode=READ` (and/or a read-only Neo4j user), keeping the blocklist only as a fast-fail courtesy check.

**T8 — LLM outputs are parsed without runtime validation, violating Guideline 2.** [extraction_worker.ts:30](src/workers/extraction_worker.ts:30) and [supervisor_worker.ts:76](src/workers/supervisor_worker.ts:76) call `JSON.parse(rawContent)` on the completion payload without `GraphSchema.parse()` / `safeParse()`. `zodResponseFormat` constrains the request, but nothing verifies the response, and the repo's own guidelines forbid exactly this pattern.

**T9 — Silent data loss in extraction ID resolution.** In [extraction_worker.ts:43-51](src/workers/extraction_worker.ts:43), if the LLM emits an action whose `subjectId`/`objectId` doesn't match any returned entity, the code falls back to the raw ID; the subsequent Cypher `MATCH` on the name then finds nothing and the action is dropped with no log line. Failed resolutions should at minimum be counted and logged.

**T10 — Supervisor worker defects.**
- The `Conflict` node created at [supervisor_worker.ts:89](src/workers/supervisor_worker.ts:89) is never connected to anything — it floats as an orphan carrying the reasoning text, unreachable from the entities it explains.
- [supervisor_worker.ts:50,54](src/workers/supervisor_worker.ts:50) join text fragments with the two-character literal `"\\n"` instead of a newline.
- The anomaly query ([supervisor_worker.ts:25](src/workers/supervisor_worker.ts:25)) uses `id()`, deprecated in Neo4j 5 (the resolution query already uses `elementId()`).
- Detection treats *any* same-verb fan-out as a candidate contradiction ("acquired X" and "acquired Y" is normal), relying on the LLM to filter — workable, but every false candidate costs a paid completion.
- The supervisor is also not wired into `start_all.ts` and only runs via the manual trigger script.

**T11 — Per-row inserts and per-job enqueues in the hot ingestion path.** [server.ts:62-68](src/api/server.ts:62) inserts AST nodes one query at a time inside a transaction, and [server.ts:79-84](src/api/server.ts:79) enqueues extraction jobs one `await` at a time. For large documents this is a straightforward N-round-trip bottleneck; multi-row `INSERT ... UNNEST` and `queue.addBulk()` are drop-in improvements. The same per-row pattern exists in [ingest_oolong_dataset.ts:36-42](scripts/ingest_oolong_dataset.ts:36), where it is more defensible (batch sizes of 40) but still doubles as an example.

**T12 — Document membership is not modeled.** `ast_nodes.document_id` is set once and `ON CONFLICT (id) DO NOTHING` ([server.ts:63-67](src/api/server.ts:63)) means a node shared by two documents (identical content) keeps whichever document ingested it first. Content addressing makes node reuse across documents *expected*, so membership needs a join table (`document_nodes(document_id, node_id)`) rather than a column.

**T13 — Hash preimage lacks canonical encoding.** [parser.ts:20-31](src/core/ast/parser.ts:20) builds the hash input by joining `type`, `content`, `JSON.stringify(metadata)`, and concatenated child hashes with `:` delimiters. Because none of the segments are length-prefixed, distinct `(type, content, metadata)` combinations can in principle produce identical preimages. Practical risk is low (types come from a fixed vocabulary), but a Merkle-integrity system should use an unambiguous encoding (length-prefixed segments or canonical JSON of the full tuple). Also, `if (content)` treats empty-string content as absent — a falsy check where an `!== undefined` check is meant.

**T14 — No embedding/queue hygiene.**
- No pgvector index (HNSW/IVFFlat) is created in [init_db.ts:10-18](src/config/init_db.ts:10); the vector fallback is a sequential scan. Fine at current scale, a cliff later.
- Queues are created with default job options — no `attempts`, no backoff, no `removeOnComplete` ([queue.ts:11-13](src/workers/queue.ts:11)), so a transient OpenAI 502 fails the job permanently (contrary to Guideline 5) and completed jobs accumulate in Redis.
- Uploaded PDF files land in `uploads/` via multer ([server.ts:12](src/api/server.ts:12)) with no size/type limit and are never deleted.
- No graceful shutdown anywhere: workers and pools are never closed on SIGTERM.

**T15 — Duplicated helpers and drift between pipelines.** `flattenAST` exists twice ([server.ts:19-27](src/api/server.ts:19) and [corpus.ts:32-38](src/benchmarks/oolong/corpus.ts:32)); the vector-search SQL exists in both [server.ts:153-159](src/api/server.ts:153) and [trellis_tools.py:138-146](src/rlm/trellis_tools.py:138) (the TS version omits the `::vector` cast the Python version includes). The main `/ingest` path and the OOLONG ingestion loop are parallel implementations of "persist an AST" with different guarantees — the verified-loop pattern lives only in the benchmark script.

**T16 — Observability is `console.log`.** No structured logging, no log levels, no metrics/counters (queue depth, extraction failure rate, LLM token spend). The runbook exists but the signals it would need are not emitted. The fire-and-forget `rlmQueue.add` inside the subscribe callback ([server.ts:216](src/api/server.ts:216)) also swallows enqueue failures — the SSE client would hang with no event.

**T17 — Minor documentation drift.** [README.md:6](README.md:6) states bounding boxes are tracked "for every node," but only the PDF path populates them ([parser.ts:57-79](src/core/ast/parser.ts:57)); markdown nodes carry no geometry. The extraction model string (`gpt-5.4-2026-03-05`) is hardcoded in three files rather than configured.

---

## 3. Roadmap

### 3.1 Short-Term (immediate fixes, low-hanging fruit)

1. **Fix dependency classification** (T3): move `ioredis` to `dependencies`; move `@types/*`, `typescript`, `tsx` to `devDependencies`.
2. **Remove the hardcoded PYTHONPATH** (T5): pass it via env/config, resolve the Python executable per platform, and fail with a clear message if the `rlms` package is missing.
3. **Create `src/config/index.ts`** (T4): a Zod-validated config object (DB hosts, credentials, Redis, model name, ports) read once from env, consumed by `db.ts`, `queue.ts`, `server.ts`, and exported to the Python side via env vars. This also collapses the model-string duplication (T17).
4. **Validate LLM responses** (T8): replace `JSON.parse(rawContent)` with `GraphSchema.parse(...)` / `ConflictEvaluationSchema.parse(...)` and route failures through the job-retry path.
5. **Fix the supervisor bugs** (T10): link the `Conflict` node to the two relationships it explains, replace `"\\n"` with `"\n"`, and replace `id()` with `elementId()`.
6. **Log dropped actions in the extraction worker** (T9).
7. **Stand up a unit test harness** (T1): vitest or node:test over the pure modules — parser hashing determinism (including the empty-content and delimiter edge cases from T13), `buildCorpus` round-trip failures, `parsePredictedPairs`/`scoreF1`, and the SSE extractors in `rlm_client.ts`. No infrastructure required; wire into `npm test`.
8. **Correct the README bounding-box claim** (T17).

### 3.2 Medium-Term (correctness, performance, robustness)

1. **Fix extraction granularity** (T2): fan out block-level nodes (paragraph, heading, list item) with concatenated inline text instead of raw inline leaves. This is the single highest-leverage change for graph quality on real documents. Reuse `nodeText()` from `corpus.ts` and consolidate the duplicated `flattenAST` while there (T15).
2. **Harden the RLM sandbox** (T7): open Neo4j sessions with `default_access_mode=READ` for `run_cypher` (write session only inside `write_derived_insight`), and either drop APOC from the compose file or restrict it via `apoc.*` procedure allowlists.
3. **Add API protection** (T6): an API-key middleware at minimum, a concurrency cap + queue-depth limit on `/api/rlm-stream`, request size limits, and multer file-type/size limits with post-parse cleanup of `uploads/`.
4. **Queue hygiene** (T14): configure `attempts`/exponential backoff and `removeOnComplete`/`removeOnAge` defaults; classify errors (retryable 5xx/timeout vs. permanent 4xx) per Guideline 5; add graceful shutdown (close workers, drain pools) on SIGTERM.
5. **Model document membership properly** (T12): introduce `document_nodes(document_id, node_id)` and backfill; this is prerequisite work for the update/re-ingest story the Merkle design exists to support.
6. **Batch the ingestion hot path** (T11): multi-row inserts and `addBulk` in `/ingest`.
7. **Promote the verified-ingestion loop from the benchmark script into the main pipeline** (T15): the write → read-back → re-derive pattern in `ingest_oolong_dataset.ts` is the architecture's stated invariant; `/ingest` should get the same guarantee (as an async post-write verification job if latency matters).
8. **Integration tests against Docker infrastructure**: a compose-based CI job running `init_db` + a small ingest + retrieve round trip, plus the corpus binding validation. The e2e probe scripts can be converted into assertion-based tests incrementally.
9. **Structured logging and basic metrics** (T16): pino (or similar) with job IDs as correlation keys; counters for extraction failures, dropped actions, LLM tokens, queue depth.

### 3.3 Long-Term (strategic direction)

1. **The document-update story.** The Merkle architecture's motivating claim (README: GraphRAG "breaks when documents are updated") is not yet exercised: there is no re-ingest/diff path that detects changed subtrees by hash, prunes semantic facts whose `sourceNodeIds` no longer exist, and re-extracts only changed blocks. This is the feature the physical layer was built for and should anchor the next phase. It depends on T12 (membership) and a garbage-collection policy for orphaned graph facts.
2. **Entity resolution beyond exact-name identity.** Entity IDs are `SHA-256(lowercased name)` ([extraction_worker.ts:37](src/workers/extraction_worker.ts:37)), so "Globex" and "Globex Corporation" are permanently distinct nodes. Aliasing/canonicalization (embedding-similarity candidate generation + LLM adjudication, recorded as `SAME_AS` edges with provenance) is the natural fit for the existing supervisor pattern.
3. **Benchmark maturity.** The committed results show F1 = 1.0 on all 20 queries — the synthetic template dataset is saturated and no longer discriminates. Next iterations: real TREC questions, paraphrased/indirect city mentions (breaking the substring-scan shortcut in the flywheel protocol), distractor documents, and adversarial cache poisoning (the `audit_flywheel_cache.ts` accuracy check becomes a first-class metric). `docs/benchmarks/CRITIQUE_AND_FUTURE.md` already acknowledges this direction; the runner infrastructure is ready for it.
4. **Scalability of the semantic layer.** Entity `sourceNodeIds` arrays grow unboundedly under the append-only `ON MATCH` pattern ([extraction_worker.ts:63](src/workers/extraction_worker.ts:63)); heavily-referenced entities will accumulate thousands of array elements on a single node property. Consider provenance as first-class edges (`(:Entity)-[:EVIDENCED_BY]->(:ASTRef)`) once documents number in the hundreds. Similarly, add the HNSW index and evaluate embedding at block rather than inline-leaf granularity.
5. **Deployment and community readiness.** No CI, no Dockerfile for the app itself (only infrastructure), no LICENSE decision beyond the default ISC stub, `.env.example` missing. If external contributors are a goal, these plus the unit-test scaffold from 3.1 are the gate. The frontend also pins a note that its Next.js version diverges from common conventions ([src/frontend/AGENTS.md](src/frontend/AGENTS.md)) — worth documenting for human contributors too.

---

## 4. Suggested Sequencing

| Order | Item | Rationale |
|---|---|---|
| 1 | Config module + dependency fixes (3.1 #1–3) | Unblocks running on any machine; everything else builds on it |
| 2 | Unit test harness (3.1 #7) | Cheap now, protects every later refactor |
| 3 | Extraction granularity fix (3.2 #1) | Highest impact on output quality; currently produces fragmented graphs for real markdown |
| 4 | Sandbox + API hardening (3.2 #2–3) | Required before any non-local deployment |
| 5 | Queue/retry hygiene + supervisor fixes | Reliability of the async tier |
| 6 | Document-update pipeline (3.3 #1) | The architecture's core promise; largest single work item |
