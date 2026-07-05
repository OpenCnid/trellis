# Trellis Engine — Technical Roadmap

*Generated from a code-led review of the repository (July 4, 2026). File and line references point at the current state of `master`-derived code in this working tree.*

*Status: Phase 1 (Foundations & Portability — short-term items 3.1 #1–3 and #7) is complete and verified. See §5 Progress Log for what was fixed, what was found along the way, and what remains open.*

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

**T1 — No test suite.** *Resolved (July 4, 2026) — see §5.* `package.json:10` was the npm default stub (`echo "Error: no test specified" && exit 1`). There is no unit test framework anywhere in the repo. The scripts under `scripts/` (`test_e2e_rlm.ts`, `run_adversarial_tests.ts`, etc.) are manual end-to-end probes that require live Docker infrastructure and an OpenAI key — they are not automated, not assertion-based, and not CI-runnable. Several modules are pure functions that could be tested today with zero infrastructure: [parser.ts](src/core/ast/parser.ts), [corpus.ts](src/benchmarks/oolong/corpus.ts), and the parse/score functions in [oolong_runner.ts:76-94](src/benchmarks/oolong_runner.ts:76) and [rlm_client.ts:32-58](src/benchmarks/oolong/rlm_client.ts:32).

**T2 — Extraction granularity is wrong for markdown ingestion.** *Resolved (July 4, 2026) — see §5.* [server.ts:78](src/api/server.ts:78) selected "leaf nodes" as any node with string content. In a remark AST, leaves are inline tokens (`text`, `inlineCode`, …), not blocks — so `Globex **acquired** Initech` fans out as three separate extraction jobs (`"Globex "`, `"acquired"`, `" Initech"`), none of which contains the full relationship. Extraction should operate at block level (paragraph/heading) with concatenated child text, as [corpus.ts:27-30](src/benchmarks/oolong/corpus.ts:27) already does via `nodeText()`. This directly degrades graph quality for any formatted document.

**T3 — Runtime dependency misclassification.** *Resolved (July 4, 2026) — see §5.* `ioredis` was in `devDependencies` ([package.json:41](package.json:41)) but is imported at runtime by [server.ts:183](src/api/server.ts:183), [queue.ts:2](src/workers/queue.ts:2), and [rlm_worker.ts:5](src/workers/rlm_worker.ts:5). A production install with `--omit=dev` will not start. Conversely, `@types/*`, `typescript`, and `tsx` sit in `dependencies`.

**T4 — The repo violates its own configuration invariant.** *Resolved (July 4, 2026) — see §5.* [.agents/AGENT_CODING_GUIDELINES.md:13](.agents/AGENT_CODING_GUIDELINES.md) mandates a schema-validated config object exported from `src/config/index.ts`; that file did not exist. Instead, connection details and passwords are hardcoded: Postgres and Neo4j credentials in [db.ts:5-17](src/config/db.ts:5), Redis host/port in [queue.ts:4-8](src/workers/queue.ts:4) and duplicated in [server.ts:201-204](src/api/server.ts:201) and [rlm_worker.ts:7-10](src/workers/rlm_worker.ts:7). The Python tools ([trellis_tools.py:22-26](src/rlm/trellis_tools.py:22)) do read env vars, so the two halves of the system configure differently.

**T5 — Machine-specific path hardcoded in the RLM worker.** *Resolved (July 4, 2026) — see §5.* [rlm_worker.ts:25](src/workers/rlm_worker.ts:25) set `PYTHONPATH` to `C:\Users\Darian\AppData\Roaming\Python\Python313\site-packages`. The RLM pipeline cannot run on any other machine without editing source. The bare `python` executable name is also platform-dependent.

**T6 — No authentication, rate limiting, or concurrency control on the API.** *Resolved (July 4, 2026) — see §5.* All three endpoints are unauthenticated. `/api/rlm-stream` is the sharpest edge: each GET spawns a Python process that makes paid LLM calls and holds database connections ([server.ts:186-239](src/api/server.ts:186)). An unauthenticated caller can generate unbounded cost and process load. There is also no cap on concurrent RLM jobs beyond BullMQ's default worker concurrency.

**T7 — The Cypher read-only guard is a keyword blocklist, and APOC is enabled.** *Resolved (July 4, 2026) — see §5.* [trellis_tools.py:34-41](src/rlm/trellis_tools.py:34) blocks `CREATE/MERGE/SET/...` by word-boundary regex, but [docker-compose.yml:26](docker-compose.yml:26) installs the APOC plugin — `CALL apoc.create.node(...)` and similar procedures mutate the graph without using any blocked keyword. The blocklist also false-positives on legitimate queries that contain the words in string literals. The robust fix is transport-level: open sessions with `default_access_mode=READ` (and/or a read-only Neo4j user), keeping the blocklist only as a fast-fail courtesy check.

**T8 — LLM outputs are parsed without runtime validation, violating Guideline 2.** *Resolved (July 4, 2026) — see §5.* [extraction_worker.ts:30](src/workers/extraction_worker.ts:30) and [supervisor_worker.ts:76](src/workers/supervisor_worker.ts:76) call `JSON.parse(rawContent)` on the completion payload without `GraphSchema.parse()` / `safeParse()`. `zodResponseFormat` constrains the request, but nothing verifies the response, and the repo's own guidelines forbid exactly this pattern.

**T9 — Silent data loss in extraction ID resolution.** *Resolved (July 4, 2026) — see §5.* In [extraction_worker.ts:43-51](src/workers/extraction_worker.ts:43), if the LLM emits an action whose `subjectId`/`objectId` doesn't match any returned entity, the code falls back to the raw ID; the subsequent Cypher `MATCH` on the name then finds nothing and the action is dropped with no log line. Failed resolutions should at minimum be counted and logged.

**T10 — Supervisor worker defects.** *Resolved (July 4, 2026) — see §5; the detection-cost heuristic (fourth bullet) remains open by design.*
- The `Conflict` node created at [supervisor_worker.ts:89](src/workers/supervisor_worker.ts:89) is never connected to anything — it floats as an orphan carrying the reasoning text, unreachable from the entities it explains.
- [supervisor_worker.ts:50,54](src/workers/supervisor_worker.ts:50) join text fragments with the two-character literal `"\\n"` instead of a newline.
- The anomaly query ([supervisor_worker.ts:25](src/workers/supervisor_worker.ts:25)) uses `id()`, deprecated in Neo4j 5 (the resolution query already uses `elementId()`).
- Detection treats *any* same-verb fan-out as a candidate contradiction ("acquired X" and "acquired Y" is normal), relying on the LLM to filter — workable, but every false candidate costs a paid completion.
- The supervisor is also not wired into `start_all.ts` and only runs via the manual trigger script.

**T11 — Per-row inserts and per-job enqueues in the hot ingestion path.** *Resolved (July 4, 2026) — see §5.* [server.ts:62-68](src/api/server.ts:62) inserted AST nodes one query at a time inside a transaction, and [server.ts:79-84](src/api/server.ts:79) enqueued extraction jobs one `await` at a time. For large documents this was a straightforward N-round-trip bottleneck. The production path now uses one multi-row `INSERT ... UNNEST` and one `queue.addBulk()` call. The benchmark ingester retains its small, verification-oriented batches.

**T12 — Document membership is not modeled.** *Resolved prior to this review's publication (Phase 4 versioned-ingest work) — see §5.* `ast_nodes.document_id` is set once and `ON CONFLICT (id) DO NOTHING` ([server.ts:63-67](src/api/server.ts:63)) means a node shared by two documents (identical content) keeps whichever document ingested it first. Content addressing makes node reuse across documents *expected*, so membership needs a join table (`document_nodes(document_id, node_id)`) rather than a column.

**T13 — Hash preimage lacks canonical encoding.** *Open by design for now; current behavior is pinned by unit tests — see §5.* [parser.ts:20-31](src/core/ast/parser.ts:20) builds the hash input by joining `type`, `content`, `JSON.stringify(metadata)`, and concatenated child hashes with `:` delimiters. Because none of the segments are length-prefixed, distinct `(type, content, metadata)` combinations can in principle produce identical preimages. Practical risk is low (types come from a fixed vocabulary), but a Merkle-integrity system should use an unambiguous encoding (length-prefixed segments or canonical JSON of the full tuple). Also, `if (content)` treats empty-string content as absent — a falsy check where an `!== undefined` check is meant.

**T14 — No embedding/queue hygiene.** *Resolved (July 4, 2026) — see §5.*
- ~~No pgvector index; vector fallback is a sequential scan.~~ A partial cosine HNSW index is now created idempotently with the schema.
- ~~Queues lack retry and retention policy.~~ Background queues use bounded exponential retries, permanent OpenAI 4xx failures stop immediately, and completed/failed history is bounded by age and count. The interactive RLM queue retains the history bounds but deliberately has no automatic retries.
- ~~Uploaded PDF files land in `uploads/` via multer ([server.ts:12](src/api/server.ts:12)) with no size/type limit and are never deleted.~~ *Resolved with T6 (July 4, 2026): PDF-only, size-capped, deleted after parsing.*
- ~~No graceful shutdown.~~ SIGINT/SIGTERM now stop API admission, close workers, publishers and queues, then drain PostgreSQL/Neo4j clients in phase order.

**T15 — Duplicated helpers and drift between pipelines.** *Resolved (July 5, 2026) — see §5.* The traversal-helper duplication was resolved with T2. Vector similarity ordering now lives in the PostgreSQL `search_ast_nodes` function consumed by both [server.ts](src/api/server.ts) and [trellis_tools.py](src/rlm/trellis_tools.py). Production `/ingest` now performs its own transactional write → read-back → parser re-derivation check before version registration commits. The OOLONG ingester retains its benchmark-specific semantic constraint verification.

**T16 — Observability is `console.log`.** No unified structured logger, log levels, or metrics/counters (queue depth, extraction failure rate, LLM token spend). The runbook exists but the signals it would need are not emitted. Critical transition/error sites increasingly emit single-line JSON events, including enqueue failures and retry classification, but the instrumentation remains incomplete.

**T17 — Minor documentation drift.** *Resolved (July 4, 2026) — see §5.* [README.md:6](README.md:6) now limits the bounding-box claim to PDF nodes whose parser output supplies coordinates; markdown nodes are explicitly documented as geometry-free. The extraction model had already been consolidated into validated configuration.

---

## 3. Roadmap

### 3.1 Short-Term (immediate fixes, low-hanging fruit)

1. ~~**Fix dependency classification** (T3)~~ — **done** (July 4, 2026): `ioredis` moved to `dependencies`; `@types/*`, `typescript`, `tsx` moved to `devDependencies`.
2. ~~**Remove the hardcoded PYTHONPATH** (T5)~~ — **done** (July 4, 2026): interpreter comes from `PYTHON_EXECUTABLE` (platform-aware default), `PYTHONPATH` is an optional passthrough, and a missing `rlms` package produces an actionable error.
3. ~~**Create `src/config/index.ts`** (T4)~~ — **done** (July 4, 2026): Zod-validated config read once from env, consumed by `db.ts`, `queue.ts`, `server.ts`, and the workers; Neo4j/Postgres settings are forwarded to the spawned Python process. Also collapsed the model-string duplication (part of T17).
4. ~~**Validate LLM responses** (T8)~~ — **done** (July 4, 2026): every worker-consumed completion crosses `parseLlmResponse` in the new `src/core/llm/boundary.ts` (empty / JSON / schema failure stages); structural failures throw into the BullMQ retry flow, now enabled by bounded queue-level retry defaults.
5. ~~**Fix the supervisor bugs** (T10)~~ — **done** (July 4, 2026): the `Conflict` node is linked to the subject and both branch objects with provenance on every created node/edge, text fragments join with real newlines, detection orders by `elementId()`, and the supervisor worker starts with `start_all.ts`. Cypher and pure helpers live in `src/core/graph/conflict_resolution.ts`.
6. ~~**Log dropped actions in the extraction worker** (T9)~~ — **done** (July 4, 2026): unresolved endpoints are logged at resolution time (`src/core/graph/resolve_actions.ts`) and the merge Cypher returns the merged action ids so Cypher-level drops are detected and logged post-merge.
7. ~~**Stand up a unit test harness** (T1)~~ — **done** (July 4, 2026): vitest wired into `npm test`; 45 tests over parser hashing determinism (including the T13 empty-content and delimiter edge cases, pinned as current behavior), `buildCorpus` round trips, `parsePredictedPairs`/`scoreF1`/`estimateCost`, and the SSE extractors in `rlm_client.ts`. No infrastructure required.
8. ~~**Correct the README bounding-box claim** (T17)~~ — **done** (July 4, 2026): README now distinguishes PDF geometry from geometry-free markdown nodes.

### 3.2 Medium-Term (correctness, performance, robustness)

1. ~~**Fix extraction granularity** (T2)~~ — **done** (July 4, 2026): `/ingest` fans out block-level nodes (paragraph, heading, list item, code, PDF element) with reconstructed inline text via the new `src/core/ast/traverse.ts`, which also consolidates the duplicated `flattenAST`/`nodeText` (the traversal-helper half of T15). See §5.
2. ~~**Harden the RLM sandbox** (T7)~~ — **done** (July 4, 2026): `run_cypher` sessions open with `default_access_mode=READ` (server-enforced; blocklist retained as fast-fail courtesy), `write_derived_insight` uses an explicit WRITE session, APOC dropped from the compose file. Verified live by `npm run test:rlm-sandbox`.
3. ~~**Add API protection** (T6)~~ — **done** (July 4, 2026): API-key middleware (header / Bearer / query param), concurrency cap + queue-depth limit on `/api/rlm-stream` (429), body and upload size limits (413), PDF-only uploads with post-parse cleanup. Verified live by `npm run test:api-hardening`.
4. ~~**Queue hygiene** (T14)~~ — **done** (July 4, 2026): bounded retry/retention defaults, typed permanent-vs-transient OpenAI error classification, phase-ordered SIGINT/SIGTERM shutdown, and a cosine HNSW index.
5. ~~**Model document membership properly** (T12)~~ — **done prior to this roadmap review**: version membership is represented by `documents` and `document_nodes`; see §5 Phase 1 findings.
6. ~~**Batch the ingestion hot path** (T11)~~ — **done** (July 4, 2026): `/ingest` uses a single `UNNEST` insert for AST nodes and `addBulk` for extraction fan-out.
7. ~~**Promote the verified-ingestion loop from the benchmark script into the main pipeline** (T15)~~ — **done** (July 5, 2026): `/ingest` reads every bulk-written AST row back inside the same PostgreSQL transaction, re-derives its hash through `parser.ts`, compares the complete JSON payload, and rolls the version back on any mismatch.
8. **Integration tests against Docker infrastructure**: a compose-based CI job running `init_db` + a small ingest + retrieve round trip, plus the corpus binding validation. The e2e probe scripts can be converted into assertion-based tests incrementally.
9. **Structured logging and basic metrics** (T16): pino (or similar) with job IDs as correlation keys; counters for extraction failures, dropped actions, LLM tokens, queue depth.

### 3.3 Long-Term (strategic direction)

1. **The document-update story.** The Merkle architecture's motivating claim (README: GraphRAG "breaks when documents are updated") is not yet exercised: there is no re-ingest/diff path that detects changed subtrees by hash, prunes semantic facts whose `sourceNodeIds` no longer exist, and re-extracts only changed blocks. This is the feature the physical layer was built for and should anchor the next phase. It depends on T12 (membership) and a garbage-collection policy for orphaned graph facts.
2. **Entity resolution beyond exact-name identity.** Entity IDs are `SHA-256(lowercased name)` ([extraction_worker.ts:37](src/workers/extraction_worker.ts:37)), so "Globex" and "Globex Corporation" are permanently distinct nodes. Aliasing/canonicalization (embedding-similarity candidate generation + LLM adjudication, recorded as `SAME_AS` edges with provenance) is the natural fit for the existing supervisor pattern.
3. **Benchmark maturity.** The committed results show F1 = 1.0 on all 20 queries — the synthetic template dataset is saturated and no longer discriminates. Next iterations: real TREC questions, paraphrased/indirect city mentions (breaking the substring-scan shortcut in the flywheel protocol), distractor documents, and adversarial cache poisoning (the `audit_flywheel_cache.ts` accuracy check becomes a first-class metric). `docs/benchmarks/CRITIQUE_AND_FUTURE.md` already acknowledges this direction; the runner infrastructure is ready for it.
4. **Scalability of the semantic layer.** Entity `sourceNodeIds` arrays grow unboundedly under the append-only `ON MATCH` pattern ([extraction_worker.ts:63](src/workers/extraction_worker.ts:63)); heavily-referenced entities will accumulate thousands of array elements on a single node property. Consider provenance as first-class edges (`(:Entity)-[:EVIDENCED_BY]->(:ASTRef)`) once documents number in the hundreds. Similarly, add the HNSW index and evaluate embedding at block rather than inline-leaf granularity.
5. **Deployment and community readiness.** No CI, no Dockerfile for the app itself (only infrastructure), no LICENSE decision beyond the default ISC stub, `.env.example` missing. If external contributors are a goal, these plus the unit-test scaffold from 3.1 are the gate. The frontend also pins a note that its Next.js version diverges from common conventions ([src/frontend/AGENTS.md](src/frontend/AGENTS.md)) — worth documenting for human contributors too.

6. **Whole-codebase ingestion.** A stated future direction is consuming entire repositories. Decision recorded July 4, 2026: this is a pipeline feature, **not** a relaxation of the T6 per-request limits. The natural unit is one document per source file (`doc_key` = repo-relative path), so per-file Merkle diffs drive incremental re-extraction commit-to-commit — exactly what the physical layer was built for — fed by a batch client/CLI rather than one giant request. A single-blob upload of a repo would defeat per-file identity, diff granularity, and the streaming-free `express.text`/single-transaction ingest (the whole body is buffered in memory and inserted row-by-row). Individual source files fit comfortably inside the 5 MB default (generated artifacts that don't should be excluded, or the env knob raised). Prerequisites before this feature: T11 batching (multi-row inserts + `addBulk` for thousands-of-files fan-out), the rest of T14 (queue hygiene at that job volume), a code-aware parser path (tree-sitter or similar — extraction blocks should be functions/classes, not markdown paragraphs), and extraction cost controls (tiered/selective extraction; one LLM call per block across a 50k-file repo is cost-prohibitive). If a convenience archive-upload endpoint is added, the upload allowlist expands to zip/tar with decompressed-size and entry-count guards (zip bombs) — independent of the per-request caps, which stay small on purpose (each request's body is held fully in memory).

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

---

## 5. Progress Log

### July 4, 2026 — Phase 1: Foundations & Portability (items 3.1 #1–3, #7)

Completed as three commits, each verified before the next was started (module smoke-loads, ad-hoc `tsc --noEmit` typecheck, and the unit suite).

1. **T3 resolved** — `fix: classify runtime and dev dependencies correctly`. `ioredis` is a runtime dependency; `@types/*`, `typescript`, and `tsx` are dev-only. A `--omit=dev` production install can now start.
2. **T4 + T5 resolved** — `feat: unified Zod-validated configuration module`. `src/config/index.ts` reads and validates the environment exactly once; invalid values fail fast with a readable error. Defaults match the docker-compose development stack, so a bare local run needs no `.env`. All hardcoded Postgres/Neo4j/Redis values, the API port, the extraction-model string, and the Python interpreter selection now flow from this module. `rlm_worker.ts` forwards `NEO4J_URI`/`NEO4J_USER`/`NEO4J_PASSWORD`/`PG_DSN` to the spawned agent so the TypeScript and Python halves configure from one source. Spawn failures and a missing `rlms` package produce actionable error messages.
3. **T1 resolved** — `test: add vitest unit-test harness for the pure modules`. `npm test` runs 45 assertions across `parser.ts`, `scoring.ts`, `rlm_client.ts`, and `corpus.ts` with no database, Docker, or API key. Failure detection was verified with a deliberate negative-control test.

**Findings recorded during this work:**

- **T12 was already resolved** by the Phase 4 versioned-ingest work before this phase began: `documents` and `document_nodes` tables exist ([init_db.ts](src/config/init_db.ts)), `/ingest` records per-version membership and runs Merkle diffs, and orphaned provenance triggers invalidation sweeps. `ast_nodes.document_id` remains as a non-authoritative column, documented as such in `init_db.ts`.
- **New issue found and fixed: ioredis version split.** `bullmq` pins `ioredis@5.10.1` exactly, while the app declared `^5.11.1`; npm therefore installed two copies whose TypeScript types are nominally incompatible. The app now pins `5.10.1` to match. If bullmq's pin moves, the two declarations must move together.
- **T13 is deliberately left open.** Changing the hash preimage (empty-content falsy check, unprefixed `:` delimiters) invalidates every hash already stored in `ast_nodes`, so the fix requires a re-hash migration story. Until then, the current behavior is pinned by tests in [parser.test.ts](src/core/ast/parser.test.ts) so any accidental change to the preimage fails the suite.

**Still open** (unchanged by this phase): T6 (API authentication/rate limiting), T7 (transport-level read-only Cypher sessions; APOC), T8 (Zod validation of LLM responses), T9 (dropped-action logging), T10 (supervisor defects), T11 (ingestion batching), T14 (queue hygiene, pgvector index, upload cleanup, graceful shutdown), T16 (structured logging/metrics), and the T17 README bounding-box correction.

### July 4, 2026 — Phase 2 start: extraction granularity (item 3.2 #1)

**T2 resolved** — `/ingest` now fans out one extraction job per block-level node instead of per inline leaf. `Globex **acquired** Initech` is a single extraction unit carrying the full sentence, rather than three fragments none of which contains the relationship.

- New module [src/core/ast/traverse.ts](src/core/ast/traverse.ts): `collectExtractionBlocks` stops at the top-most block (paragraph, heading, list item, fenced code) and traverses through containers (root, list, blockquote); childless content nodes (PDF elements from unstructured.io) remain units as-is; content-less structural nodes (thematic breaks) are skipped from extraction while still being hashed and persisted.
- `flattenAST`/`nodeText` are consolidated here (previously duplicated between `server.ts` and `corpus.ts` — the traversal-helper half of T15); `corpus.ts` re-exports them so existing imports are unaffected. The vector-search SQL duplication and the verified-loop divergence noted in T15 remain open.
- Re-ingest behavior is preserved: an inline edit changes its parent block's Merkle hash, so exactly that block lands in `diff.added` and re-extracts; byte-identical re-ingests queue nothing. Both properties are covered by unit tests ([traverse.test.ts](src/core/ast/traverse.test.ts), 14 new assertions; suite total 59).
- The `/ingest` response field `leafNodesQueued` was renamed to `blocksQueued`; `API_REFERENCE.md` is updated. Provenance is unchanged: queued jobs carry the block's AST hash as `astNodeId`, which extraction threads into `sourceNodeIds` as before — block hashes are stored in `ast_nodes` like every other node.

**Follow-up noted for the semantic layer** (pre-existing, now more visible): embeddings are written per extraction unit, so they now land on block nodes rather than inline leaves — this matches the 3.3 #4 suggestion to embed at block granularity.

### July 4, 2026 — Belief-quarantine recovery gap for extraction-produced facts (found by live smoke test, fixed)

**The gap.** [invalidation.ts](src/core/graph/invalidation.ts) promises that a contested fact is excluded from `/retrieve` "until it is re-derived from live bytes" — but for extraction-produced facts, re-derivation never cleared the flag. The extraction worker MERGEs actions on `(subject, verb, object)` and its `ON MATCH` only appended `sourceNodeIds`; the only paths that ever set `contested = false` were the RLM's `write_derived_insight` ([trellis_tools.py](src/rlm/trellis_tools.py)) and benchmark helpers. Reproduced live: editing "acquired Initech in 2024" to "in 2025" and re-ingesting re-extracts the same `(globex corporation)-[ACTION {verb:'acquired'}]->(initech)` edge with fresh block provenance, yet the edge stayed `contested = true` and hidden from `/retrieve` forever — a frozen quarantine with a live source. Entity endpoint nodes had the same defect.

**The fix** converges every writer on one belief-provenance state machine, specified as pure functions in the new [provenance.ts](src/core/graph/provenance.ts) (`applyQuarantineSweep` / `applyRederivation`) and mirrored by the Cypher:

- **Extraction merge recovers** ([extraction_merge.ts](src/core/graph/extraction_merge.ts), extracted from the worker so scripts can drive the identical Cypher): `ON MATCH` clears `contested`, stamps `rederivedAt` when the fact was quarantined, keeps `sourceNodeIds` live-only (known-dead hashes stay filtered out; an incoming hash that was once orphaned is resurrected — document reverts re-create old content hashes), and leaves `contestedAt`/`orphanedSourceIds` behind as audit history. Same semantics as the RLM write path, now for `Entity` nodes and `ACTION` edges too.
- **The sweep is order-independent** ([invalidation.ts](src/core/graph/invalidation.ts)): the extraction workers and the invalidation worker race on separate queues, so `/ingest` now passes the version's queued extraction-block hashes as a **fresh set** alongside the orphan set. A fact already carrying fresh provenance was re-derived from live bytes by a racing extraction job and escapes quarantine; dead hashes still move into `orphanedSourceIds` either way. The two transitions commute — proved exhaustively in [provenance.test.ts](src/core/graph/provenance.test.ts) (14 new vitest assertions; suite total 73) and verified against the live stack in both worker orders by the new `npm run test:belief-recovery` ([test_belief_recovery.ts](scripts/test_belief_recovery.ts), 24 checks incl. quarantine → recovery → revert/resurrection).
- **A liveness gate closes the cross-version race** ([registry.ts](src/core/ast/registry.ts) `isAstNodeLive`, called by the worker before the paid LLM call): a queue-lagged extraction job whose block was superseded by a newer re-ingest is skipped instead of resurrecting facts from dead bytes. Registry-unknown nodes (unversioned ingests) are treated as live. Backed by a new `document_nodes(node_id)` index ([init_db.ts](src/config/init_db.ts)).
- The Update Drill re-ingest ([reingest.ts](src/benchmarks/oolong/reingest.ts)) now passes `diff.added` as the fresh set, so its deterministic semantic refresh gets the same recovery semantics as production extraction; its previously "on purpose" permanently-contested refreshed `REFERENCES` edges now recover. The invalidation-recall/precision audit is unaffected (cached `has_category` insights carry no fresh provenance at sweep time and are quarantined exactly as before). `SweepResult` gained `survivedNodes`/`survivedRelationships` telemetry.

**Preserved semantics:** mixed provenance is still contested conservatively per PHASE_4_PRD.md §5 — a part-dead fact survives only if one of its live sources is *fresh* (just re-derived); a fact supported only by *retained* (unchanged) blocks is still quarantined and recovers lazily on next re-derivation, exactly the PRD's story. `npm run test:invalidation-sweep` (RLM write path + sweep) passes unchanged.

**Known residuals (open):** (1) orphan sets are computed per document, so a source hash shared with another live document is still treated as dead — content-addressed cross-document sharing needs a global liveness notion (pre-existing; the `isAstNodeLive` helper is the building block); (2) a sub-millisecond check-then-write window remains if a re-ingest of the same document lands between the worker's liveness check and its merge and the sweep's Cypher executes first (documented in registry.ts); (3) the RLM write path still filters *incoming* provenance against `orphanedSourceIds`, so an agent citing a resurrected (reverted) hash does not un-orphan it the way extraction does — harmless today, worth unifying when trellis_tools.py is next touched.

### July 4, 2026 — LLM response boundary + dropped-action telemetry (items 3.1 #4, #6 — T8, T9)

**T8 resolved.** Raw completions no longer reach `JSON.parse` directly. The new [src/core/llm/boundary.ts](src/core/llm/boundary.ts) exports `parseLlmResponse(schema, raw, context)`, which distinguishes three failure stages — `empty` (nullable/blank content), `json` (malformed or truncated payload), `schema` (valid JSON that fails Zod) — and throws `LlmResponseError` carrying the stage, caller context, and a bounded raw-payload snippet for diagnosis.

- The extraction worker validates against `GraphSchema` and lets the error propagate: the job fails into BullMQ's retry flow, where a fresh (sampled) completion usually parses.
- The supervisor worker validates each conflict evaluation against `ConflictEvaluationSchema` (moved into [schemas.ts](src/core/graph/schemas.ts) so it is importable without the worker's side effects). An invalid evaluation is logged with context and skipped so one bad completion cannot block the other candidate pairs, but any failure still fails the job at the end — the affected pairs still have `belief_state = NULL`, so the retried scan picks them up. The previous `if (!rawContent) continue` silent skip is gone.
- **Retry flow enabled (minimal T14 slice):** the queues in [queue.ts](src/workers/queue.ts) now carry `defaultJobOptions` (`attempts: 3`, exponential backoff), without which "route to the retry flow" was a no-op — a thrown error was a permanent failure. The `rlm_queue` is deliberately excluded: its jobs stream to an interactive SSE client that re-dispatches at its own layer, and a background re-run would spend LLM budget with no listener. The rest of T14 (`removeOnComplete`/`removeOnAge`, retryable-vs-permanent classification, graceful shutdown) remains open. Retried extraction jobs are safe to re-run: the merge is idempotent and the liveness gate re-checks.

**T9 resolved.** Dropped actions are now detected at both layers where they could vanish:

- **Resolution time:** the ID-resolution logic moved out of the worker into the pure [src/core/graph/resolve_actions.ts](src/core/graph/resolve_actions.ts) (`resolveExtractedGraph`), which reports every action whose `subjectId`/`objectId` matched no extracted entity. The worker emits a structured `extraction.unresolved_action_endpoint` warning per occurrence. Unresolved actions are still submitted (unchanged behavior): the raw id passes through as the endpoint name and can legitimately match a pre-existing entity by name.
- **Merge time (the definitive check):** `ACTION_MERGE_CYPHER` now ends with `RETURN act.id`, and `mergeExtractedGraph` returns the merged ids. The worker diffs submitted vs. merged and emits a structured `extraction.action_dropped` warning for each action the Cypher `MATCH` filtered out. The per-job summary log reports `merged/submitted` counts.

Telemetry is single-line JSON on `console.warn` — greppable and machine-parsable now, and a trivial mechanical swap when structured logging lands (T16).

**Tests:** 21 new unit assertions, no infrastructure required ([boundary.test.ts](src/core/llm/boundary.test.ts): all three failure stages, context propagation, snippet bounding; [resolve_actions.test.ts](src/core/graph/resolve_actions.test.ts): pins the SHA-256-of-lowercased-name entity identity, purity, endpoint-level unresolved reporting). Suite total 94, all passing. `mergeExtractedGraph`'s signature change (`Promise<void>` → `Promise<MergeResult>`) is backward compatible for `scripts/test_belief_recovery.ts`, which ignores the return value.

**Why this over the PR #17 residuals:** T8/T9 were the next unstruck short-term roadmap items, violate the repo's own Guidelines 1–2 on the paid-LLM hot path of every ingestion, and are fully unit-testable offline. Of the residuals, global liveness is a design-level change (global orphan tracking) worth its own phase, the check-then-write race is sub-millisecond with no cheap cross-database fix, and the RLM resurrection alignment is documented as harmless today.

### July 4, 2026 — Supervisor worker fixes (item 3.1 #5 — T10)

The supervisor's Cypher and pure helpers moved into [src/core/graph/conflict_resolution.ts](src/core/graph/conflict_resolution.ts) (same importable-without-side-effects pattern as `extraction_merge.ts`); the worker consumes them.

- **The `Conflict` node is no longer an orphan.** The resolution Cypher now creates `(subj)-[:HAS_CONFLICT]->(c:Conflict)` and `(c)-[:CONFLICT_BRANCH {beliefState, actionElementId}]->(obj1/obj2)`, so the reasoning is reachable from all three entities it explains. Neo4j cannot point an edge at a relationship, so each branch records the `elementId` of the ACTION it explains. The node also gains `detectedAt` and the evaluation's `resolutionType` (previously discarded), and — per the architecture invariant — the `Conflict` node and every created edge carry `sourceNodeIds` (each branch inherits its ACTION's provenance; the node, `HAS_CONFLICT`, and `CONTRADICTS` carry the union of both sides; a pre-existing `CONTRADICTS` keeps its original provenance as audit).
- **Real newlines.** Prompt text fragments fetched from Postgres are joined with `"\n"` via the pure `joinAstTexts`/`astRowText` helpers (fallback order `data.value` → `data.text` → raw JSON preserved and pinned by tests) instead of the two-character literal `"\\n"`.
- **`id()` → `elementId()`** in the anomaly query's candidate ordering, matching the resolution query and Neo4j 5 deprecation.
- **Startup wiring:** `scripts/start_all.ts` imports the supervisor worker, so a full-stack start listens on `supervisor_queue` (jobs are still enqueued via the manual trigger script).

**Still open by design:** detection continues to treat any same-verb fan-out as a candidate contradiction, so every false candidate costs one paid evaluation (T10's cost bullet); the schema-validated evaluation boundary from the T8 work is unchanged.

**Tests:** 10 new unit assertions in [conflict_resolution.test.ts](src/core/graph/conflict_resolution.test.ts) — no deprecated `id()` calls, conflict-node linkage and provenance parameters present in the Cypher, evaluation→params mapping with order-preserving provenance union, and the newline-join regression. Suite total 104, all passing; both queries verified to compile against the live Neo4j 5.11 via `EXPLAIN`.

### July 4, 2026 — Sandbox and API hardening (items 3.2 #2, #3 — T7, T6)

**T7 resolved.** The RLM sandbox's read-only guarantee is now transport-level, not lexical:

- [trellis_tools.py](src/rlm/trellis_tools.py) opens every `run_cypher` session with `default_access_mode=READ`, so the Neo4j server itself rejects any write in that session — including write *procedures* whose names contain no blocked keyword. The keyword blocklist is retained as a fast-fail courtesy check (readable error, no round trip); `write_derived_insight` opens its session with explicit WRITE access and remains the single whitelisted mutation path.
- APOC is dropped from [docker-compose.yml](docker-compose.yml): nothing in the codebase calls `apoc.*`, and its procedures were the canonical blocklist bypass. The compose comment records the re-add recipe (plugin + `dbms.security.procedures.allowlist`) should a future feature need it.
- **Live verification:** `npm run test:rlm-sandbox` ([test_rlm_sandbox.ts](scripts/test_rlm_sandbox.ts) spawning [test_rlm_sandbox.py](scripts/test_rlm_sandbox.py) with production env forwarding). The decisive probe is `CALL db.createLabel(...)` — a genuine write whose name defeats `\bCREATE\b` (no word boundary inside `CREATELABEL`), so only the READ session stops it. Before this fix the probe mutated the graph; now the server rejects it, and the write path still works (probe fact written then cleaned up).

**T6 resolved.** All endpoints and the expensive stream path are protected:

- **Authentication:** [src/api/auth.ts](src/api/auth.ts) — when `API_KEY` is set, every endpoint requires it via `x-api-key`, `Authorization: Bearer`, or the `api_key` query parameter (EventSource cannot set headers); comparison is constant-time. Unset ⇒ open with a startup warning, keeping the bare local-dev run working. Auth runs before body parsing.
- **RLM stream admission** ([src/api/stream_gate.ts](src/api/stream_gate.ts) + server wiring): a per-process concurrency gate (`RLM_MAX_CONCURRENT_STREAMS`, default 4) and an `rlm_queue` waiting-depth backstop (`RLM_QUEUE_MAX_DEPTH`, default 32) both return 429 before any SSE/Redis/Python resources are allocated; the gate slot is reclaimed on response close (abort or normal end). The previously fire-and-forget `rlmQueue.add` inside the subscribe callback now reports enqueue failure to the client as an SSE `error` event instead of hanging the stream (the T16 note).
- **Size and type limits:** raw body capped at `INGEST_MAX_BODY_MB` (default 5 MB → 413), uploads PDF-only (→ 400) and capped at `INGEST_MAX_UPLOAD_MB` (default 25 MB → 413), single file; parsed uploads are deleted from `uploads/` in a `finally` (part of T14's hygiene list). A JSON error handler replaces the default HTML error page.
- Config additions are Zod-validated in [src/config/index.ts](src/config/index.ts) with compose-compatible defaults; [API_REFERENCE.md](API_REFERENCE.md) gains §0 (authentication and limits) and the stream endpoint's 401/429/503 semantics.

**Tests:** 19 new unit assertions ([auth.test.ts](src/api/auth.test.ts): constant-time validation incl. length mismatch, key extraction precedence, middleware 401/pass-through; [stream_gate.test.ts](src/api/stream_gate.test.ts): cap admission, release semantics, double-release guard) — suite total 123, all passing offline. Live: `npm run test:api-hardening` boots the real server with a key and asserts 401s on all endpoints, 202 authorized ingest (via header and Bearer), 413 oversize body, and 400 non-PDF upload — designed to queue zero extraction jobs and make zero LLM calls (the probe document is a lone thematic break). `npm run test:rlm-sandbox` covers T7 (4 checks).

**Deliberately not done here:** per-key rate limiting/quotas (single shared key only), TLS termination, and horizontal-scale coordination of the stream gate (each process enforces its own cap; the queue-depth check is the shared backstop) — all deployment-story items for 3.3 #5. The RLM write-path resurrection alignment (PR #17 residual 3) remains open: this change touched `trellis_tools.py`'s session modes only, not the `_WRITE_INSIGHT_QUERY` provenance semantics, which deserve their own belief-state test pass.

### July 4, 2026 — Async reliability and ingestion batching (items 3.1 #8, 3.2 #4 and #6 — T17, T14, T11)

**T14 resolved.** Queue behavior is now bounded and failure-aware:

- Background queues retain three attempts with exponential backoff. Typed OpenAI connection failures, HTTP 408/409/429, and 5xx responses retry; typed permanent 4xx responses become BullMQ `UnrecoverableError` and skip wasteful remaining attempts. Classification uses SDK error types and status fields, never message substrings. Structural `LlmResponseError` and unknown infrastructure failures remain retryable under the bounded policy.
- Every queue now bounds completed and failed history by both age and count. The limits are Zod-validated configuration. `rlm_queue` gets retention but still no automatic retries because an SSE client owns re-dispatch and a background retry would spend tokens without a listener.
- A phase-ordered shutdown coordinator handles SIGINT/SIGTERM: stop API admission, wait for workers, close the RLM publisher and BullMQ queues/connection, then drain PostgreSQL and Neo4j clients. Registration is shared by combined and single-process entry points.
- Database initialization creates a partial cosine HNSW index over non-null `ast_nodes.embedding` values. The TypeScript vector query now uses the same explicit `::vector` cast as the Python path.

**T11 resolved.** `/ingest` replaces one PostgreSQL call per AST node with one aligned-array `INSERT ... UNNEST`, and replaces one BullMQ call per extraction block with `queue.addBulk()`. Transaction boundaries, immutable hash identity, version membership, diff filtering, and per-block job payloads are unchanged.

**Boundary and no-loss findings fixed while completing the retry path.**

- The verification classifier was the one worker-consumed LLM completion still using raw `JSON.parse` despite the earlier T8 record. It now requests strict structured output and crosses `parseLlmResponse(VerificationResponseSchema, ...)`; malformed or partial batches fail into the bounded retry flow instead of silently dropping answers.
- Supervisor resolution transaction failures were logged and swallowed, allowing the scan job to report success after losing a conflict transition. They now fail the job and enter the same retry policy.
- `scripts/start_all.ts` now starts the verification worker, so the unified process consumes every declared production queue.

**T17 resolved.** README now states that bounding boxes are preserved for PDF nodes only when parser coordinates exist; markdown nodes do not carry geometry.

**Tests:** 29 new offline assertions cover typed retry decisions and BullMQ conversion, RLM retry exclusion plus retention defaults, one-round-trip AST persistence and bulk-job payloads, shutdown ordering/idempotence/failure continuation, strict verification payload/coverage validation, and HNSW schema presence. Suite total: 152 passing.

**Deliberately not included:** structured logging/metrics (T16), the provenance residuals from the belief-recovery entry, verified production ingestion (T15), CI/container packaging, entity resolution, benchmark expansion, and hash-preimage changes (T13).

### July 5, 2026 — Provenance residuals and verified production ingestion (item 3.2 #7 — T15)

The correctness residuals recorded after belief-quarantine recovery are closed at their owning boundaries:

- **Global source liveness:** a per-document Merkle diff now supplies orphan *candidates*. At invalidation-worker execution time, [registry.ts](src/core/ast/registry.ts) retains any candidate present in the latest version of another registered document. Skipped shared hashes emit the `invalidation.shared_sources_retained` JSON event with job/document context. The live belief-recovery script proves that one document can remove a block while another keeps the identical content hash without quarantining its semantic evidence.
- **Extraction check/write race:** the early liveness gate still avoids a paid completion for queue-lagged dead bytes. A second check immediately precedes the Neo4j merge; a post-merge check applies a compensating quarantine if a re-ingest committed during the merge. A pre-dead retry also compensates in case an earlier BullMQ attempt committed Neo4j and failed before its post-check. [extraction_liveness.ts](src/core/graph/extraction_liveness.ts) specifies the ordering without worker side effects. PostgreSQL and Neo4j do not share a transaction, so atomic reader visibility during the short merge/post-check interval is not claimed; the settled state cannot remain trusted with dead provenance.
- **RLM resurrection alignment:** `_WRITE_INSIGHT_QUERY` now implements the same `applyRederivation` transition as extraction. Incoming live hashes are authoritative, including a reverted hash previously present in `orphanedSourceIds`; that hash moves back to `sourceNodeIds` on the edge and both endpoint nodes. Other orphan history remains.
- **Verified production ingestion:** after the existing bulk `UNNEST` write, `/ingest` performs one read-back query inside the same transaction. Every expected row must exist, its stored payload must re-derive the expected ID through the unchanged parser preimage, and its full JSON payload must match parser output. Any failure rolls back AST rows, membership, and version registration before jobs can be queued.
- **Vector-query deduplication:** cosine ordering, null filtering, and result shape now live in the schema-level `search_ast_nodes(vector, count)` function. The Express and Python clients call that function instead of carrying parallel `<=>` queries.

**Tests:** 14 new offline assertions cover global-orphan query behavior, tracked/untracked liveness, all liveness-fence orders including compensation failure, read-back success/missing/corrupt/payload-drift cases, and schema-level vector search; suite total 166 passing. Live verification: `test:belief-recovery` (30 checks, including global sharing and real Neo4j race compensation), `test:invalidation-sweep` (17 checks, including Python RLM revert resurrection), `test:api-hardening` (9 checks, exercising verified `/ingest` with zero extraction jobs), and `test:rlm-sandbox` (4 checks). A direct 1536-dimension zero-vector call verified the database function without an LLM call.

**Deliberately not included:** the T13 hash-preimage migration, structured logging/metrics (T16), CI/container packaging, entity resolution, benchmark expansion, and whole-codebase ingestion.
