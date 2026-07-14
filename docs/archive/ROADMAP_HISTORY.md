# Trellis Roadmap Progress Log — Archive (July 4–12, 2026; T-items through Session 29)

Moved verbatim from `TRELLIS_ROADMAP.md` §5 on July 12, 2026 (owner
direction: the live roadmap keeps only the most recent five sessions).
Entries below are the dated ledger from the first Phase-1 commit through
Session 27 (Sessions 1–23 moved July 12, 2026; then one session entry
per PR under the same window rule — Session 24 with the Session 29 PR,
Session 25 with the Session 30 PR, Session 26 with the Session 31 PR,
Session 27 with the Session 32 PR, Session 28 with the Session 33 PR,
Session 29 with the Session 34 PR); nothing was edited in the moves.
The live ledger continues in `TRELLIS_ROADMAP.md` §5.

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

### July 5, 2026 — Deployment and CI readiness (items 3.2 #8 and 3.3 #5 — T18)

The backend now has a reproducible production and CI path without changing the PR #22 correctness boundaries:

- **Compiled production runtime:** [tsconfig.build.json](tsconfig.build.json) emits `dist/`; `npm start`, `start:api`, `start:workers`, and `db:init` execute emitted JavaScript with production dependencies. `tsx` and TypeScript remain dev-only. API and worker entrypoints are split for process isolation while `start_all.ts` retains the unified local path.
- **Node/Python image:** [Dockerfile](Dockerfile) builds TypeScript separately, installs only production Node modules in the runtime, runs as UID 1000 with a writable upload directory, and uses an init-then-`exec` entrypoint so SIGTERM reaches Node directly. Direct application dependencies and the imports required by `partition_pdf(strategy="fast")` are pinned in reviewed manifests; hi-res Torch/transformer packages are deliberately excluded. The final image is 583 MB and includes the RLM Python files, rubric, and PDF parser at their existing paths.
- **Failing schema gate and health contract:** `init_db.ts` now exits nonzero when either store or client cleanup fails. Compose waits for PostgreSQL, Neo4j, and Redis health before starting the API/workers, and the image entrypoint completes idempotent initialization before Node accepts traffic. `/healthz` is an unauthenticated liveness-only endpoint; dependency readiness is intentionally established by bootstrap/Compose rather than turning outages into restart loops.
- **Project-scoped Compose topology:** the obsolete version key and fixed container names are gone. API and workers share one image but run as separate services with service-DNS configuration. Ports are overrideable (including Docker-assigned port `0` for CI), and named volumes remain scoped to the selected Compose project.
- **Environment contract:** dotenv loads `.env` once before the existing Zod boundary and never overrides shell/Compose values. [.env.example](.env.example) covers every supported TypeScript variable plus `OPENAI_API_KEY`; README distinguishes bare-host loading from Compose interpolation and marks API/LLM keys as non-local requirements.
- **Deterministic CI:** [.github/workflows/ci.yml](.github/workflows/ci.yml) runs the offline suite/build/Python smoke check, builds the image, and starts an isolated Compose project. The compiled integration script starts no workers and receives no OpenAI key; it ingests a lone thematic break, verifies PostgreSQL document/root membership, seeds an `ACTION` whose nodes and edge carry `sourceNodeIds`, then proves `/retrieve` joins the fact to the physical hash.

**Verification:** `npm ci`; `npm test` (170 passing across 22 files); `npm run build`; `npm run python:check`; `docker compose --profile test config --quiet`; `docker build --tag trellis-backend:session3 .`; a disposable image check verified UID 1000, no TypeScript dev dependency, no Torch package, and Python runtime imports; the isolated Compose integration completed five assertions and removed only its project-scoped containers/volumes; `npm run test:api-hardening` passed 11 checks; `npm run test:rlm-sandbox` passed 4 checks. `git diff --check` passes.

**License gate at that session boundary:** OpenCnid's choice was still pending, so no license was inferred during Session 3. OpenCnid selected MIT on July 6, 2026; see the next entry.

### July 6, 2026 — Session 4 direction, documentation reconciliation, and MIT license

- Session 4 is scoped to the final open medium-term roadmap item: structured logging and basic metrics (T16). The handoff requires correlation fields across API requests and BullMQ jobs, counters for failures/dropped transitions/LLM usage, queue-depth gauges, and an explicit cross-process metrics design because API and workers run in separate containers.
- The component diagram in §1.1 now uses Mermaid and includes the version/diff/invalidation path, verification worker, RLM tool boundary, all five queues, and the split physical/semantic stores.
- The stale long-term document-update entry and suggested sequencing table now reflect the shipped Phase 4/5 and deployment work instead of re-proposing it.
- The operations runbook now uses project-scoped `docker compose` commands, removes assumptions about fixed container names, and replaces broad Redis destruction advice with scoped diagnosis and recovery guidance.
- OpenCnid selected the MIT License. A repository `LICENSE` was added, package metadata was aligned to `MIT`, and the README's pending-license statement was removed.

**Still open at that entry:** T16 implementation, T13's migration-dependent hash preimage, entity resolution, benchmark/scale maturity, semantic provenance scaling, whole-codebase ingestion, and frontend deployment.

### July 6, 2026 — Session 4: structured logging and basic metrics (item 3.2 #9 — T16)

Operational logging and metrics now describe the split API/worker topology directly instead of through greppable ad-hoc JSON.

**Structured logging.** A side-effect-free `src/core/observability/` module wraps `pino`: `buildLogger` is a pure factory (offline-testable against an in-memory sink) and the lazy process-root logger takes its level from a new Zod-validated `LOG_LEVEL` and stamps `service` from `TRELLIS_SERVICE` (Compose sets `api`/`workers` per container). Every operational line is one JSON object with a stable dot-namespaced `event` field, child-logger correlation bindings (`worker`, `queue`, `jobId`, `attempt`, `requestId`, `docKey`, `version`, `astNodeId`), and an `err` serializer preserving type/message/stack. All `src/api`, `src/workers`, `src/config`, and `src/core/runtime` console output converted; pre-existing machine-readable event names (`extraction.unresolved_action_endpoint`, `extraction.action_dropped`, `invalidation.shared_sources_retained`, `supervisor.evaluation_invalid`, `worker.error_classified`, `runtime.shutdown_*`, `database.initialization_failed`, …) are preserved as `event` values. The injected sinks in `withWorkerRetryPolicy`, `ShutdownCoordinator`, and `runInitializationTasks` changed from `(line: string)` to structured `(fields)` emitters defaulting to the root logger. Benchmark runners and maintenance CLIs deliberately keep human-formatted output. Request bodies, source text, prompts, SSE query content, embeddings, and secrets are never logged.

**Request/job correlation.** The API binds a generated `requestId` to every request (returned as the `x-request-id` header, logged in `http.request_completed`), and `/ingest` threads `requestId`/`docKey`/`version` into every extraction and invalidation job payload as optional fields (pre-T16 queued jobs still process), so a failed or dropped job resolves to the request and version that produced it.

**Metrics.** `prom-client` registries are per process — one process-local registry cannot describe both containers, so: the API serves authenticated `GET /metrics` (same API-key middleware as every operational endpoint; `/healthz` unchanged, liveness-only), and the worker process serves its own registry on an internal listener (`WORKER_METRICS_PORT`, default 9464) that Compose deliberately does not publish to the host. Metric handles come from a `createMetrics(registry)` factory, so duplicate registration is structurally impossible in tests. Instrumented: HTTP requests by method/normalized-route/status class (fixed route table — entity names, doc keys, and query strings can never mint label values); BullMQ outcomes `started`/`completed`/`failed_retryable`/`failed_exhausted`/`failed_unrecoverable` plus duration per worker/queue; extraction unresolved endpoints, dropped actions, and superseded/compensated liveness fences; invalidation candidates, globally retained shared hashes, contested/survived nodes and relationships, and batches; verification classified/agreed/disputed/skipped results; LLM calls and input/output/embedding tokens by operation/model; and scrape-time queue-depth gauges (`waiting`/`active`/`delayed`/`failed`) for all five queues, where a per-queue Redis read failure emits a structured warning plus a failure counter without breaking the scrape.

**RLM telemetry boundary.** `rlm_worker.ts` now feeds stdout chunks through a bounded line scanner (`rlm_telemetry.ts`) that parses the existing `TRELLIS_TELEMETRY: {...}` line into token/subcall/tool-call/duration metrics and an `rlm.telemetry` log event. The scanner is a pure observer: the Redis/SSE byte stream is published unchanged, split records and multiple records per chunk are handled, a final partial line is flushed at process exit, an oversized unterminated line is dropped without unbounded buffering, and a malformed payload emits `rlm.telemetry_malformed` plus a counter — never a job failure or stream corruption. Run exits feed `trellis_rlm_runs_total{exit_status}`.

**Verification.** Offline: 37 new assertions covering log shape/level filtering/child bindings/error serialization, route normalization and status classes, job-outcome classification incl. `UnrecoverableError` and missing jobs, queue gauge collection incl. isolated read failure, LLM usage present/absent, telemetry chunk-boundary/malformed/partial-line/oversized cases, exposition without duplicate registration, metrics listener lifecycle, job-context threading, and the bootstrap advisory lock (suite total 207 across 30 files, from 170/22). `npm run build`, `npm run python:check`, and `docker compose --profile test config --quiet` pass. Live zero-LLM: `npm run test:api-hardening` grew to 18 checks (metrics 401/200/content-type, ingest visible in counters, 401s counted, and every server stdout line parses as JSON with `api.started`/`http.request_completed` events); `npm run test:rlm-sandbox` passes 4 checks; the isolated Compose integration grew to 9 assertions — API `/metrics` authentication/content-type/counters after the deterministic ingest, the worker listener reachable via service DNS on the internal network (the `workers` service joined the integration's dependencies; the probe document still queues zero extraction jobs) with live queue gauges for all five queues, and an unchanged `/healthz` contract.

**Found and fixed: concurrent schema-bootstrap race.** Adding `workers` to the integration service's dependencies made CI start the API and worker containers against a fresh PostgreSQL simultaneously for the first time — and both entrypoints run the idempotent `db:init`. `CREATE EXTENSION IF NOT EXISTS` is not concurrency-safe (`duplicate key value violates unique constraint "pg_extension_name_index"`), so one container's bootstrap failed and Compose declared its dependency dead even though the restart succeeded. The race pre-dated Session 4 for any fresh-volume `docker compose up` of the full stack; CI had simply never started both app containers. `POSTGRES_SCHEMA_SQL` now begins with `SELECT pg_advisory_xact_lock(hashtext('trellis_schema_init'))`, serializing the whole single-transaction script; a unit test pins the lock as the first statement.

**Found and fixed: the Session 3 image's worker process could not start.** With workers actually exercised in CI, the container crash-looped at import: `verification.ts` resolves `trec_rubric.json` relative to `__dirname`, which is `dist/src/core/graph` in the compiled runtime, but the image only shipped the rubric at the Python path (`src/rlm/`). Every compiled `start:workers` run since Session 3 would have crashed the same way; local development never noticed because `tsx` runs from source where the relative path resolves. The Dockerfile now copies the same versioned rubric to `dist/src/rlm/` as well, and the Compose integration keeps workers in its dependency set so a worker-process import regression fails CI from now on.

**Documentation.** `.env.example` and README gained `LOG_LEVEL`, `TRELLIS_SERVICE`, `WORKER_METRICS_PORT`/`HOST`; `API_REFERENCE.md` §0 documents `GET /metrics`, the worker listener, and the `x-request-id` correlation contract; the runbook's §7 now catalogs the real metric names with diagnostic PromQL and log-trace recipes, and §3 gained a no-`redis-cli` queue-depth probe.

**Deliberately not included:** OpenTelemetry/vendor exporters and tracing (they can now layer on the stable local log/metric contract), per-metric persistence across process restarts (counters are process-lifetime by Prometheus convention), publishing the worker metrics port to the host, T13 re-hashing, entity resolution, and benchmark expansion.

**Still open:** T13's migration-dependent hash preimage, entity resolution, benchmark/scale maturity, semantic provenance scaling, whole-codebase ingestion, and frontend deployment.

### July 6, 2026 — The handoff loop

`HANDOFF.md` is now self-regenerating: it is both the prompt that starts a session and a deliverable that session must produce. Each session executes the objective the file specifies, records completion in this §5 log, then rewrites the file for the next objective — taken from the first unstruck row of the §4 sequencing table unless a discovered defect should jump the queue — updating the baseline facts (master commit, test counts, live-check counts) and preserving the permanent §0 loop protocol and invariant guardrails verbatim. A session that ships its objective but does not regenerate the handoff has not finished. The first handoff written under this protocol targets Session 5: entity resolution beyond exact-name identity (item 3.3 #2), designed as a `SAME_AS`/`DISTINCT_FROM` overlay belief with provenance that inherits the existing quarantine machinery — never a merge of Entity nodes.

### July 6, 2026 — Session 5: entity resolution beyond exact-name identity (item 3.3 #2)

Entity identity remains immutable — `globalEntityId` (`SHA-256(lowercase(name))`) and both merge Cyphers are byte-for-byte unchanged, and no Entity node is ever merged, renamed, or deleted. Equivalence became a first-class, quarantinable belief.

**Candidate generation (deterministic, LLM-free).** New pure module [alias_candidates.ts](src/core/graph/alias_candidates.ts): normalized-token containment ("globex" ⊂ "globex corporation"), acronym/initialism match ("ibm" ↔ "international business machines"), and a near-identity edit-distance guard (Levenshtein ≤ 1, ≤ 2 for names of 12+ characters — punctuation/typo variants). Kind discipline: only same-kind pairs among `generic`/`concept`; a NULL kind (extraction-created entities predate kind stamping) behaves as `generic` per the entity_kinds migration's rule 4; `q_<digits>` names and the six TREC labels are additionally excluded *by name* regardless of stamped kind, so the OOLONG flywheel's exact-id lookups are structurally untouchable. Pairs are emitted in canonical order (lexicographically smaller entity id first, sorted, deduplicated), making the candidate set, the edge direction, and the sweep cap deterministic.

**Adjudication (LLM, batched, validated).** New `resolution_queue` (standard retrying job options — verdict edges MERGE on the pair, so re-runs are idempotent) and [resolution_worker.ts](src/workers/resolution_worker.ts) on the verification-worker skeleton, wired into `queue.ts`, `start_workers.ts`, the queue-gauge list, and shutdown. `AliasAdjudicationSchema` (per pair: `sameEntity`, `confidence` 0..1, `reasoning`) crosses `parseLlmResponse`; hallucinated pairIds are discarded rather than written. Prompt context per pair is both names/types/kinds plus source-text snippets (600 chars max per entity) fetched from each endpoint's live `sourceNodeIds` — never whole documents. `makeOracleAdjudicator` mirrors `makeOracleClassifier` for zero-LLM drills. The sweep scheduler [resolve_sweep.ts](scripts/resolve_sweep.ts) (`npm run resolve:sweep`, flags `--max-pairs`/`--prefix`/`--oracle`/`--sync`/`--dry-run`) selects uncontested, provenance-bearing entities, excludes pairs already settled by a non-contested verdict, caps at `RESOLUTION_MAX_PAIRS_PER_SWEEP` (default 200), and enqueues one job.

**Verdict edges.** Positive: `(a)-[:SAME_AS]->(b)` in canonical id order; negative: `(a)-[:DISTINCT_FROM]->(b)` so a settled pair is never re-paid for. Both carry `confidence`, `adjudicatedAt`, `method` (`llm`/`oracle`), `model`, bounded `reasoning` (500 chars), and `sourceNodeIds` = the union of both endpoints' live provenance at adjudication time. The merge's ON MATCH mirrors `ENTITY_MERGE_CYPHER`'s `applyRederivation` semantics, so quarantine inheritance is free: the existing invalidation sweep contests a verdict edge when its provenance dies (its relationship pass matches any edge with `sourceNodeIds`), the contested pair becomes re-adjudicable on a later sweep, and a fresh verdict recovers the edge with `rederivedAt` stamped and the dead hash kept in `orphanedSourceIds` as audit. Zero new quarantine machinery.

**Retrieval integration.** `GET /retrieve` expands the seed across non-contested `SAME_AS` edges with `confidence >= RESOLUTION_MIN_CONFIDENCE` (default 0.8) — one undirected hop, since canonical direction is an id artifact — then runs the existing traversal over seed + aliases, unions provenance, and attributes each fact via a `viaAlias` field per graph row plus a `resolvedAliases` response field. `?resolveAliases=false` opts out; `includeContested` stays orthogonal and never relaxes the expansion filter. The fixed route-label table is untouched.

**Configuration and observability.** `RESOLUTION_MIN_CONFIDENCE` / `RESOLUTION_MAX_PAIRS_PER_SWEEP` / `RESOLUTION_BATCH_SIZE` (default 25 pairs per completion) flow through `src/config/index.ts` only. T16 house style throughout: child logger (`worker: 'resolution'`), `instrumentWorker`, `recordLlmCall`-equivalent spend under `operation: 'resolution'`, events `resolution.sweep_started`/`sweep_completed`/`alias_recorded`/`pair_distinct`, counters `trellis_resolution_candidates_total` and `trellis_resolution_pairs_total{verdict}`. Entity names appear in logs only, never in metric labels; telemetry emission lives in the side-effect-free [resolution_telemetry.ts](src/core/graph/resolution_telemetry.ts) so it is testable with injected fakes.

**Verification (all commands run, zero LLM calls end to end).** Offline: `npm test` = 247 passing across 33 files (baseline 207/30; +40 assertions covering containment/acronym/edit-distance signals, kind restrictions and the by-name question/TREC exclusion, canonical ordering/dedup/cap determinism/purity, `AliasAdjudicationSchema` through all three `parseLlmResponse` failure stages, verdict-param canonical direction/provenance union/reasoning bounding, verdict/selection/expansion Cypher pins, oracle adjudicator including absent pairs, telemetry metrics/log emission via fakes, and the sixth queue's gauge exposition). `npm run build`, `npm run python:check`, `docker compose --profile test config --quiet` pass; the isolated Compose integration's queue-gauge assertion now covers `resolution_queue`. Live zero-LLM: new `npm run test:entity-resolution` (33 checks) seeds "globex"/"globex corporation"/decoy "globex group" with distinct facts and real Merkle provenance, runs selection + the real worker over Redis in oracle mode, and proves canonical-direction `SAME_AS` with union provenance, the `DISTINCT_FROM` decoy verdict, settled-pair exclusion on re-selection, `/retrieve` alias expansion with attribution and union provenance (and `resolveAliases=false` restoring old behavior), quarantine inheritance through a real re-ingest diff + the existing sweep (expansion stops), and contested-pair re-adjudication recovering the edge. Existing suites stayed green: `test:api-hardening` (18), `test:rlm-sandbox` (4), `test:belief-recovery`, `test:invalidation-sweep`. `git diff --check` passes.

**Deliberately not included:** embedding-based candidate generation (entity names carry no embeddings today — documented follow-up), automatic entity merging or canonical-node rewriting, coreference/NLP libraries, RLM prompt changes to exploit `SAME_AS`, verification-worker spot-checks of `SAME_AS` beliefs (natural extension of the existing sampler), benchmark corpus expansion, and T13 re-hashing.

### July 6, 2026 — Session 6: benchmark maturity (item 3.3 #3)

The saturated v1 benchmark (F1 = 1.0 on all 20 queries; every city mention a literal capitalized token satisfiable by substring scan) now has a discriminating successor, and cache trustworthiness is a recorded metric instead of an out-of-band script.

**Dataset v2 — the anti-shortcut corpus.** New pure seeded generator [src/benchmarks/oolong/generate_v2.ts](src/benchmarks/oolong/generate_v2.ts) (`buildV2Dataset()`, seed 43, byte-identical across runs) emits [data/oolong_pairs_dataset_hard.json](data/oolong_pairs_dataset_hard.json) (`oolong-pairs-trec-synthetic-v2`): 220 questions (50 LOC + 50 HUM + 35 NUM + 35 ENTY + 35 DESC + 15 ABBR over the same 14 cities) plus 20 prose passages. Three shortcut breakers, all with offline-derivable ground truth: (1) **paraphrases** — a hand-authored per-city alias table ("the French capital"); 14 LOC + 14 HUM records mention their city only indirectly, `concepts` keeps the canonical name, the new optional `surface_forms` schema field records the alias, and a unit test pins that no paraphrased text contains its canonical token; (2) **near misses** — 6 LOC + 6 HUM records where the city token names a quoted artifact (`concepts: []`) and 8 ENTY records annotated with city Y while name-dropping city X, recorded in the new optional `distractor_mentions` field, all structurally excluded from ground truth; (3) **prose distractors** — a new optional `distractor_passages` dataset field (kept out of `records` so every question-record consumer — poison seeding, mutation, scoring — works on v2 unchanged), ingested as `:Passage` nodes with real provenance but no category and no `REFERENCES`, so they can never pair. Question ids are `q_1001..q_1220` — disjoint from v1's `q_0001..q_0220` so both corpora coexist in one graph, still matching the `q_\d+` shape pinned by `parsePredictedPairs` and the entity-kind question pattern (alias resolution keeps ignoring them by name). All v2 template wording is disjoint from v1's so no content-addressed block hash is shared between corpora.

**Filename deviation from the handoff, with reason:** the handoff suggested `data/oolong_pairs_dataset_v2.json`, but that file already exists — it is the Update Drill's MUTATED byte-version 2 of the v1 corpus (`oolong-pairs-trec-synthetic-v1-drill-v2`), referenced by `poison_drill_runner.ts` and the re-ingest drill. The harder corpus therefore lives at `data/oolong_pairs_dataset_hard.json`; the dataset `name` field keeps the handoff's `oolong-pairs-trec-synthetic-v2`.

**Harness generalization.** [scripts/ingest_oolong_dataset.ts](scripts/ingest_oolong_dataset.ts), [scripts/audit_flywheel_cache.ts](scripts/audit_flywheel_cache.ts), [scripts/test_oolong_pairs_query.ts](scripts/test_oolong_pairs_query.ts), and the benchmark runner accept `--dataset <path>` defaulting to v1 (shared plumbing in [dataset_cli.ts](src/benchmarks/oolong/dataset_cli.ts)); `prepare_oolong_flywheel.ts` needed no flag — contrary to the handoff's claim it reads no dataset path and already strips annotations graph-wide. The ingest loop gained passage phases with the same write → read-back → re-derive → constraint shape (`:Passage` verification asserts provenance resolves AND that no passage carries a category, `REFERENCES` edges, or a `:Question` id collision). The pairs query and the cache fetch are now id-scoped to their dataset so coexisting corpora cannot pollute each other's answer keys. `buildCorpus` binds passages through the identical heading+paragraph round trip (empty `boundPassages` for v1). The runner derives its city list from the dataset it is pointed at, defaults non-v1 results to `benchmark_results_v2.json` (or `--results <path>`), and refuses to write the committed v1 `benchmark_results.json` for any other dataset.

**Cache-audit accuracy as a first-class metric.** New pure module [src/benchmarks/oolong/cache_audit.ts](src/benchmarks/oolong/cache_audit.ts) (`auditCacheRows` → `{ cached, correct, wrong, unknown, accuracy, mistakes }`, accuracy `null` when nothing is gradable) with an id-scoped fetch of EFFECTIVE (non-contested) `has_category` edges — the audit grades what the cache actually serves. `scripts/audit_flywheel_cache.ts` became a thin caller; the benchmark runner appends a post-warm `cache_audit` block to its results file; the poison drill records `cache_audit_post_poison` and `cache_audit_post_detection` per policy from the same implementation, so poison recall and cache accuracy can never drift apart.

**Defect found and fixed along the way (1):** the first draft of the passage constraint check used a bare-node pattern comprehension (`size([(q:Question {id: p.id}) | 1])`), which Neo4j 5 rejects — pattern comprehensions require a relationship. Replaced with a `COUNT { MATCH ... }` subquery in both the ingest verification and the live test before merge; caught by running the live suite, not by review.

**Defect found and fixed along the way (2) — pre-existing concurrent-bootstrap deadlock on the Neo4j side.** This PR's first CI run failed with the backend container unhealthy: both app containers run the idempotent `db:init` against a fresh graph simultaneously, and the two concurrent `CREATE CONSTRAINT IF NOT EXISTS` calls deadlocked on the label lock (`Neo.TransientError.Transaction.DeadlockDetected`, `ForsetiClient ... can't acquire UpdateLock ... on LABEL(0)`). Session 4's fix serialized only the PostgreSQL half (`pg_advisory_xact_lock`); the Neo4j half ran as a bare `session.run` — one attempt, no retry — and had been a latent timing race in every fresh-volume dual-container start since. The bootstrap now goes through `executeWrite` in the extracted [src/config/neo4j_bootstrap.ts](src/config/neo4j_bootstrap.ts) (the driver's managed transaction function retries transient errors by contract), pinned by 4 unit tests with an injected fake driver (suite 283/37). Verified live by a stress harness: 8 rounds of two concurrent compiled `db:init` processes against a throwaway Neo4j with the constraint dropped before each round — 16/16 exits clean — plus a fresh isolated Compose integration pass.

**Verification (all commands run, zero LLM calls end to end).** Offline: `npm test` = **283 passing across 37 files** (baseline 247/33; +36 assertions covering generator determinism/schema/category distribution/id disjointness, the anti-shortcut pin (28 paraphrased records, no canonical token, alias table covers all 14 cities), near-miss and passage exclusion from ground truth, hand-computed pair fixture plus independent re-derivation and per-city aggregate cross-check, passage corpus binding round trips (including hash stability of record blocks when passages are appended), cache-audit arithmetic (correct/wrong/unknown, case-insensitivity, empty cache and all-unknown → null accuracy, mistake-sample bounding), `--dataset` flag parsing + committed-file validation for both corpora, and the Neo4j bootstrap retry pins from defect (2)). `npm run build`, `npm run python:check`, `docker compose --profile test config --quiet` pass; the isolated Compose integration passed its 9 assertions in a scoped project (`trellis-s6-integration`) and removed only its own volumes. Live zero-LLM: new `npm run test:benchmark-hardening` (**24 checks**) ingests v2 through the real `--dataset` flag path (exit 0 = hash round trip + constraints), proves the id-scoped `REFERENCES` traversal reproduces the 139-pair v2 ground truth exactly, asserts all 20 `:Passage` nodes carry resolvable provenance with no category/REFERENCES/`:Question` collision, seeds the oracle cache (`seedVerifiedCache`) and audits accuracy 1.0, poisons 11 labels and audits accuracy 209/220 with mistakes matching the manifest exactly, verifies v2 question/label entities carry kinds `question`/`category_label` and `selectResolutionCandidates` proposes zero pairs touching them, then cleans up everything it created while preserving pre-existing shared rows. Existing suites stayed green: `test:entity-resolution` (33), `test:api-hardening` (18), `test:rlm-sandbox` (4), `test:belief-recovery`, `test:invalidation-sweep`. `git diff --check` passes.

**Cost:** zero paid LLM calls. No benchmark run against v2 was executed; per the cost policy it requires explicit owner approval with an estimate derived from v1 telemetry ($0.81–$0.87 per 20-query run; a v2 run is expected to cost more in the warm phase because mention resolution is no longer a free substring scan).

**Deliberately not included:** real TREC import (needs a paid, non-deterministic annotation pass — recorded as future work in `docs/benchmarks/CRITIQUE_AND_FUTURE.md` §3.3), adversarial soft-label corpora, embedding-based candidate generation or retrieval changes, RLM prompt/protocol changes, 10k+ scale sweeps, provenance-scaling migrations (3.3 #4, next session), and T13 re-hashing.

**Still open:** T13's migration-dependent hash preimage, semantic provenance scaling behind its measured trigger, whole-codebase ingestion, and frontend deployment.

### July 6, 2026 — Session 7: semantic-provenance scale gate (item 3.3 #4 measurement)

Session 7 implemented the roadmap's measurement-first gate and did **not**
migrate provenance storage because the observed arrays and sweep curve stayed
below the declared thresholds.

**Deterministic corpus and production-path drill.** New pure module
[generate_scale_corpus.ts](src/benchmarks/scale/generate_scale_corpus.ts)
uses seed `20260706` and weighted sampling without replacement from 96 shared
entities. The default 300 documents contain 20 paragraph/extraction blocks
each (6,000 citations); one shared entity plus one unique detail per block
grows both hub arrays and total graph size without repeating a hub inside one
document. The five most frequent entities occur in 286/258/212/200/193
documents and the five least frequent in 23/21/21/20/19, pinned by tests.
`scripts/scale_provenance_drill.ts` (`npm run drill:scale`) drives every
document through `persistAstNodes` + read-back/re-hash verification,
`recordDocumentNodes`, `registerDocumentVersion`, and
`mergeExtractedGraph`; no extraction worker or OpenAI client is invoked.

**Measurements.** New pure
[statistics.ts](src/benchmarks/scale/statistics.ts) defines nearest-rank
percentiles and the predeclared gate: migrate if an observed fact reaches
1,000 live source hashes, or fixed-orphan-set median sweep latency grows by
more than 1.5 times semantic-fact growth. At 50/150/300 documents the graph
held 2,096/6,096/12,096 semantic facts; maximum node arrays were 47/144/286,
node means 1.82/1.94/1.97, and every `ACTION` array remained exactly 1.
Fixed-50-hash sweep medians were 15.32/17.50/21.81 ms: 1.42x latency growth
against 5.77x fact growth. The gate stayed closed with 714 entries of array
headroom. `scale_drill_results.json` preserves every raw min/mean/p50/p95 and
[SCALE_PROVENANCE_REPORT.md](docs/benchmarks/SCALE_PROVENANCE_REPORT.md)
records the decision and trigger.

**Merge, retrieval, and context evidence.** Whole-document merge p50 grew
40.18 → 98.16 → 204.77 ms as the graph grew, but same-graph no-op probes at
300 documents measured 7.72 ms for the 286-source hub and 7.78 ms for a
one-source detail. Array union is therefore not the observed merge bottleneck.
`ENTITY_MERGE_CYPHER` matches `Entity.name`, while bootstrap constrains only
`Entity.id`; the report records name-lookup/index profiling as a prerequisite
for repository-scale semantic enqueue rather than misattributing graph-size
growth to arrays. Real authenticated `/retrieve` p50 was 123.34 ms for the hub
(286 graph/provenance rows) versus 10.82 ms for the 19-source tail;
`fetchEntitySnippets` p50 was 4.46 versus 0.79 ms.

**Scale correctness and cleanup.** Twelve documents were re-ingested with two
changed blocks each: one re-derived the same fact from fresh bytes and one
replaced the semantic object. Global liveness retained all 60 orphan
candidates; the real sweep processed six 10-hash batches in 174.58 ms
(batch p50/p95 26.57/39.84 ms). Its counters were 12 contested nodes, 12
contested relationships, 35 fresh-surviving nodes, and 12
fresh-surviving relationships. Forty-eight explicit fact-state checks passed:
24 quarantined single-source details/edges and 24 fresh-surviving details/edges,
including live-source removal and orphan audit preservation. Cleanup removed
6,108 token-scoped graph nodes, 312 document versions, 12,792 membership rows,
and 12,360 new AST rows, then asserted zero seeded graph/document/AST residue;
pre-existing candidates are snapshotted and never deleted.

**Defect found and fixed along the way.** The first live smoke run launched two
`executeRead` calls concurrently on one Neo4j session while collecting node
and relationship cardinalities. Neo4j rejected the second managed transaction
with "session with ongoing work." The reads are now serialized on that
session. The smoke run also established that reduced corpora may not mention
every 96-member tail; the comparison now selects the rarest actually observed
entity. The corrected 12-document smoke completed 48/48 state checks and
zero-residue cleanup before the full run.

**Verification (all commands run, zero LLM calls end to end).** `npm ci`
installed 311 locked packages with 0 vulnerabilities. `npm test` = **294
passing across 40 files** (baseline 283/37; +11 assertions covering corpus
determinism/default shape/pinned Zipf distribution, percentile and aggregation
arithmetic, both migration-gate branches/headroom, and injectable end-to-end
plus per-batch sweep timing). `npm run build`, `npm run python:check`, and
`docker compose --profile test config --quiet` pass. `npm run drill:scale`
produced the committed numbers above in 57.2 seconds with zero seeded residue.
Live zero-LLM regressions passed: `test:benchmark-hardening` (24),
`test:entity-resolution` (33), `test:api-hardening` (18),
`test:rlm-sandbox` (4), `test:belief-recovery` (30), and
`test:invalidation-sweep` (17). The isolated `trellis-s7-integration` Compose
project passed all 9 assertions, then removed only its own containers and
volumes. `git diff --check` passes.

**Cost and decision:** zero paid calls. No `ASTRef`/`EVIDENCED_BY` nodes,
backfill, dual-write path, or relationship reification shipped: doing so with
max cardinality 286 and a sublinear measured sweep curve would violate the
measurement gate. Relationship arrays are especially unindicted (max 1).

**Still open:** T13's migration-dependent hash preimage; conditional semantic
provenance migration after an observed threshold crossing; whole-codebase
ingestion (Session 8); frontend deployment. The scale measurement phase is
complete, but roadmap item 3.3 #4 remains unstruck until a justified migration
actually ships.

### July 6, 2026 — Session 8: whole-codebase ingestion (item 3.3 #6)

One repository snapshot is now a bounded sequence of per-source-file verified
ingests with incremental diff/deletion semantics and zero paid work by
default. Full details and measurements: `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md`.

**Verified ingest service extracted.** The exact `POST /ingest` transaction
(`flattenAST` → `persistAstNodes` → read-back re-hash verification →
`recordDocumentNodes` → `registerDocumentVersion`) moved into
[src/core/ingestion/ingest_document.ts](src/core/ingestion/ingest_document.ts)
with the Merkle diff relocated *inside* the transaction, so an
over-budget extraction plan rolls the whole version back before any queue
write. Extraction policy is explicit ([plan_ingest.ts](src/core/ingestion/plan_ingest.ts)):
`none` (repository default — persist/diff/queue invalidation with an empty
fresh set, so dead facts quarantine conservatively) or `changed`
(pre-Session-8 behavior, optionally bounded by a hard `maxBlocks` budget
rejected before enqueue). The API is now a thin parse/validate/delegate layer
with unchanged defaults; its response gains `blocksEligible` and
`extractionPolicy`. Tombstones are ordinary verified ingests of a
deterministic empty root under policy `none`.

**Code-aware immutable AST.** [source_parser.ts](src/core/ast/source_parser.ts)
dispatches by an explicit extension/filename table: TypeScript/JavaScript via
`@babel/parser` (new production dependency; pure JS, deterministic), Python
via the stdlib `ast` module spawned through the pinned interpreter
([scripts/parse_python_source.py](scripts/parse_python_source.py), output
Zod-validated), Markdown unchanged on the T13 preimage, and a named
opaque-text fallback for configuration formats. Extraction blocks are
top-level functions, classes as containers with per-method child blocks, and
bounded chunks for imports/trivia; `collectExtractionBlocks` selects them
explicitly. Block content is the exact source slice — concatenated leaf
contents must reproduce the file byte-for-byte or the file is skipped with a
typed `coverage_error` — and parser ranges are ephemeral: nothing positional
is persisted, `rederiveAstNodeId` stays authoritative, and a live check
verified a stored `code_function` payload re-derives its Merkle id.

**Repository snapshots and deletion.** [src/core/repository/](src/core/repository/)
adds pure path safety (rejecting absolute/`..`/NUL/backslash paths; symlinks
skipped unfollowed; vendor/generated directories excluded), `git ls-files -z`
enumeration via `execFile` argument vectors, a pure manifest diff, and durable
snapshot membership in PostgreSQL (`repository_snapshots` +
`repository_snapshot_paths`, idempotent DDL under the existing advisory-lock
bootstrap). Only *published* snapshots are effective; publication is atomic
with the path rows and happens only after every file ingest and tombstone
succeeds, so a partial failure exits nonzero, leaves the previous snapshot as
the deletion baseline, and never marks unprocessed paths deleted. A removed
or no-longer-acceptable path tombstones through the service; a rename is
tombstone + new doc key (`repo:<repo-key>:<relative-path>`), with physical
root hashes deduplicating across the rename. Unchanged files (matching root
hash in the prior published snapshot) are recorded without new versions, so
an unchanged rerun is an auditable no-op.

**CLI, cost, and observability.** `npm run repo:ingest`
([scripts/ingest_repository.ts](scripts/ingest_repository.ts)) defaults to
`--extract none` and prints files/bytes/languages/skip counts and the exact
paid-job upper bound before any write (`--dry-run` stops there);
`--extract changed` demands a positive `--max-blocks` and
`--confirm-extraction`, is serialized so the running budget is exact, and the
plan is rejected before the snapshot row exists if the upper bound exceeds
the budget. File concurrency and total bytes in flight are bounded
(client-side pipeline; T6 request limits untouched). New bounded-label
metrics: `trellis_repo_snapshots_total{result}`,
`trellis_repo_files_total{outcome,language}`,
`trellis_repo_skipped_files_total{reason}`, `trellis_repo_blocks_total{stage}`,
plus `repo.*` structured log events. Repo keys, paths, and hashes never
become label values.

**Entity.name merge index (measured, then shipped).** `EXPLAIN` confirmed the
Session 7 suspicion: `ENTITY_MERGE_CYPHER`'s name `MERGE` ran as
NodeByLabelScan (only `Entity.id` was constrained). An idempotent
`entity_name_index` was added to
[neo4j_bootstrap.ts](src/config/neo4j_bootstrap.ts) under the same
`executeWrite` retry contract (unit-pinned). Re-running `drill:scale` on the
same machine: whole-document merge p50 went from 50.51/95.58/175.92 ms at
50/150/300 documents (no index, measured the same day) to a flat
13.77/13.24/14.82 ms — an 11.9x improvement at 300 documents that removes the
graph-size dependence, exonerating provenance arrays as Session 7
hypothesized. The 3.3 #4 gate stays closed: max cardinality 286 and sweep
growth 1.88x versus 5.77x fact growth (recorded separately from this index —
a name index is not an `ASTRef` migration).

**Defects found and fixed along the way:** (1) the first snapshot-sequence
insert used `$1` both as a bare SELECT output and a `repo_key` comparison, so
PostgreSQL failed with "inconsistent types deduced for parameter $1" —
caught by the live drill's first CLI run, fixed with explicit `::varchar`
casts; (2) drill assertions initially relied on PostgreSQL `ORDER BY`
(case-insensitive collation) and JSONB key order — fixed by canonical JS
sorting in the test.

**Verification (all commands run, zero LLM calls end to end).** Offline:
`npm test` = **345 passing across 44 files** (baseline 294/40; +51 covering
the new repository snapshot schema pins,
the ingest planner/executor transaction-order pins, policy and budget
semantics, tombstone planning, source-parser determinism/coverage/minimal
diffs for TS and Python (spawning the real interpreter), typed skips,
markdown preimage equivalence, chunk bounding, path/repo-key/manifest/scanner
rules, snapshot orchestration incl. partial-failure atomicity and budget
threading, bounded concurrency/byte-gate primitives, repo metric label pins,
and the two-statement Neo4j bootstrap). `npm run build`,
`npm run python:check`, `docker compose --profile test config --quiet` pass;
`git diff --check` clean. Live zero-LLM: new `npm run test:repo-ingest`
(**45 checks** — CLI fresh snapshot with pinned skip counts
binary/oversize/unsupported/vendor/symlink, verified membership, zero Redis
extraction jobs, no-op rerun, minimal one-method diff, delete/rename
tombstones with quarantine + shared-provenance survival via global liveness,
forced-failure atomicity and recovery). `npm run drill:scale` closed its gate
with zero residue. Existing suites stayed green: `test:benchmark-hardening`
(24), `test:entity-resolution` (33), `test:api-hardening` (18),
`test:rlm-sandbox` (4), `test:belief-recovery` (30),
`test:invalidation-sweep` (17). The isolated `trellis-s8-integration` Compose
project passed 9/9 and removed only its own containers and volumes (the
image now ships `parse_python_source.py` and the compiled repository CLI).

**Deliberately not included:** real paid repository extraction (requires
owner approval with a printed block count), cloning/fetching remote
repositories, zip/tar upload endpoints, more languages than
TS/JS/Python/Markdown/opaque-text, generated/vendor/binary ingestion,
`ASTRef` migration (gate closed), T13 re-hashing, RLM prompt changes, and
frontend work.

**Still open:** T13's migration-dependent hash preimage; conditional 3.3 #4
migration behind its unchanged trigger; frontend deployment and community
readiness remainder (3.3 #5 residue) — the Session 9 target.

### July 6, 2026 — Owner-approved extraction pilot on real code (post-Session-8)

With Session 8 acceptance closed, the owner approved one bounded paid pilot:
`repo:ingest --root src/core/graph --repo-key trellis-graph-pilot --extract
changed --max-blocks 150 --confirm-extraction` — 22 TypeScript files, 112
blocks. The pipeline was flawless (112/112 jobs, zero failures, zero
dropped/unresolved actions; 57,323 input / 46,862 output `gpt-5.4` tokens
plus 28,618 embedding tokens), producing 340 entities and 318 relationships
with pilot provenance, including genuine API-level facts.

**Findings recorded as prerequisites for repository-scale extraction:**
(1) *test-fixture contamination* — fixture strings in `alias_candidates.test.ts`
produced `globex corporation --[acquired]-> initech` and name-based identity
merged it onto the pre-existing demo entities, so the scanner needs a
test/fixture exclusion; (2) *generic-identifier hubs* — `entity` (14
sources), `name`, `id`, `action` will become mega-hubs at repo scale and a
spurious fast path to the 3.3 #4 trigger; (3) *prompt mismatch* — the
business-tuned extraction prompt improvises on source code, so a code-tuned
prompt with generic-identifier suppression is needed. These are the natural
Session 10 objective after the frontend session; details in
`docs/benchmarks/REPOSITORY_INGESTION_REPORT.md` §5.

The pilot was then cleaned up through the shipped deletion protocol itself:
a second snapshot against an empty tree tombstoned all 22 documents and the
real invalidation worker swept the globally dead code hashes, quarantining
the pilot-derived facts (mixed-provenance demo entities like `initech` stay
conservatively contested until next re-derived — the standard lazy recovery).

### July 6, 2026 — Session 9 redirected: agentic orchestration loop (3.3 #7)

The owner redirected the next session away from the sequencing default
(frontend deployment) to a new capability: Trellis must be able to work
agentically. The direction, recorded as roadmap item 3.3 #7 and the rewritten
`HANDOFF.md`:

- an **external agentic loop** that accepts a goal, decomposes it into tasks,
  dispatches them, evaluates results, and iterates;
- the loop is **mediated by the same LLM under a different system prompt**
  (an orchestrator persona making structured decisions through the existing
  T8 Zod boundary — not a second rlms REPL, whose `custom_system_prompt`
  would replace the execution protocol);
- the **RLM becomes its own reusable agent**: today `rlm_worker.ts` spawns
  `trellis_agent.py` once per `rlm_queue` job with exactly one query, and its
  `FINAL_ANSWER:`/`TRELLIS_TELEMETRY:` stdout contract is already
  machine-parseable — the loop reuses that as the single-task sub-agent so
  one goal can perform more than one task.

Frontend deployment is deferred to the next sequencing row, not dropped; the
repository-extraction prerequisites from the pilot follow it. No code changed
in this entry — it records the priority decision and the handoff rewrite so
the next session starts with zero external context.

### July 7, 2026 — Session 9: agentic orchestration loop (item 3.3 #7)

Trellis can now pursue a goal, not just answer a question: an external
loop, mediated by the same LLM under an orchestrator system prompt, drives
the RLM as a reusable single-task sub-agent.

**The RLM as a formal sub-agent.** `trellis_agent.py` prints one
machine-readable `TRELLIS_RESULT: {json}` envelope
(`{status: ok|protocol_violation|error, answer, toolCalls}`) on both the
success and exception paths, alongside the untouched `FINAL_ANSWER:`,
`TRELLIS_TELEMETRY:`, and `TRELLIS_PROTOCOL_VIOLATION` conventions. A new
bounded scanner ([rlm_result.ts](src/core/observability/rlm_result.ts))
observes the same stdout chunks the SSE path publishes; the shared
buffering moved to [line_scanner.ts](src/core/observability/line_scanner.ts)
with the telemetry scanner re-based on it (its unit tests pin no behavior
change). The `rlm_queue` payload is normalized by a pure helper
([rlm_job.ts](src/workers/rlm_job.ts)): the pre-Session-9 `{query, jobId}`
shape still processes (unit-pinned), with optional `goalId`/`taskId`
correlation, a per-task `maxIterations` forwarded as `--max-iterations`,
and a data-only `stub` replay mode (the `ResolutionJobData.oracle`
precedent — canned stdout through the identical publish/scan path, no
Python spawn, no field can name a script). The worker's completion value
is now the parsed envelope plus telemetry instead of a placeholder string.

**The orchestrator.** New `src/core/agent/`:
`OrchestratorDecisionSchema` (three actions only; cross-field checks make
dispatch-without-tasks, finish-without-answer, and fail-without-reason
schema-stage failures) crossing `parseLlmResponse` with
`zodResponseFormat`, exactly like extraction/verification/resolution; a
planner persona prompt ([orchestrator_prompt.ts](src/core/agent/orchestrator_prompt.ts))
consumed only by plain chat completions (never rlms — unit tests pin that
the Python harness cannot reference it and that it carries no REPL
fences/placeholders); pure transcript construction with per-answer
truncation; and the dependency-injected loop
([goal_loop.ts](src/core/agent/goal_loop.ts)): decision → dispatch →
await envelopes → observations → next decision. Task failures and
protocol violations are observations; a tripped bound, a boundary-failing
completion, or an exhausted oracle script is a typed streamed failure
(`iteration_bound`/`task_bound`/`concurrency_bound`/`decision_error`/
`orchestrator_fail`) with no further dispatches.

**Execution home and API.** New `agent_queue` with the rlm_queue
interactive no-retry precedent and [agent_worker.ts](src/workers/agent_worker.ts)
(dispatches tasks via `rlmQueue.add` + `waitUntilFinished` on a
`QueueEvents` subscriber with a 30-minute ceiling; publishes goal events
on `agent-stream:<goalId>`; records `operation: 'orchestration'` spend).
`GET /api/agent-stream` mirrors the RLM stream: API-key gated, its own
`StreamGate` (`AGENT_MAX_CONCURRENT_GOALS`) plus queue-depth backstop
(`AGENT_QUEUE_MAX_DEPTH`), subscribe-then-enqueue ordering, SSE ending on
the terminal event. Zero-LLM drills are an explicit opt-in
(`AGENT_ORACLE_ENABLED`, default false → oracle scripts get 400). Bounds
are Zod-validated with single-digit caps and defaults
(iterations 4, tasks 8, batch 2, task iterations 5). T16: events
`agent.*` and `rlm.result`; counters `trellis_agent_goals_total{outcome}`,
`trellis_agent_decisions_total{action}`, `trellis_agent_tasks_total{outcome}`;
`agent_queue` in the gauge list and shutdown coordinator; goal text and
task queries in no metric label and no log line.

**Defects found and fixed along the way:** (1) the loop initially passed
its mutable history array to the decision source by reference, so a
decision source could observe later rounds retroactively — caught by the
first goal-loop unit test, fixed by snapshotting at the decision boundary;
(2) the first prompt-hygiene test asserted no `/ORCHESTRATOR/i` anywhere in
the Python harness, which its own explanatory comment tripped — tightened
to the real coupling (`ORCHESTRATOR_SYSTEM_PROMPT`/`orchestrator_prompt`
references).

**Verification (all commands run, zero LLM calls end to end).** Offline:
`npm test` = **397 passing across 52 files** (baseline 345/44; +52
covering the decision schema through all three boundary stages incl.
hallucinated actions, the loop against injected fakes — multi-iteration
completion, fan-out aggregation, violations/crashes as observations, all
three bounds tripping typed with zero further dispatches, stub threading —
the result-envelope scanner mirror suite, rlm/agent job payload
normalization incl. the pre-Session-9 payload pin and data-only stub pin,
transcript/budget rendering and truncation, prompt hygiene, agent-bounds
config validation incl. the non-coercing oracle switch, metric label pins,
and `agent_queue` gauge exposition). `npm run build`,
`npm run python:check`, `docker compose --profile test config --quiet`,
and `git diff --check` pass. New live zero-LLM suite:
`npm run test:agent-loop` = **23 checks** (401 without key; oracle
rejected 400 by default and when malformed; one goal decomposing into two
stubbed tasks that round-trip through the real `agent_queue`/`rlm_queue`/
Redis pub-sub with answers and telemetry aggregating into
`goal_completed`; a protocol-violation task surfacing as an observation
with the oracle's reactive branch taken; task-bound and concurrency-bound
goals ending as streamed typed failures with zero further dispatches;
429 over the goal gate while a delayed goal holds it, which then still
completes; agent counters present with bounded labels and no goal text in
the exposition). Existing live suites stayed green: `test:repo-ingest`
(45), `test:benchmark-hardening` (24), `test:entity-resolution` (33),
`test:api-hardening` (18), `test:rlm-sandbox` (4), `test:belief-recovery`
(30), `test:invalidation-sweep` (17). `npm run drill:scale` closed its
gate (max cardinality 286, sweep growth 1.94x, zero residue). The
isolated `trellis-s9-integration` Compose project passed its 9 assertions
and removed only its own containers and volumes.

**Cost:** zero paid calls. A real goal run (owner-approved, needs
`OPENAI_API_KEY`) prints its per-goal bounds in the `goal_started` event
and reports aggregated decision/task spend on the terminal event and
under `operation="orchestration"`.

**Deliberately not included:** multi-orchestrator hierarchies or
recursive goal dispatch (the decision schema cannot express a goal, and
`max_depth` stays 1); RLM session reuse across tasks (one process per
task); autonomous goal triggers; new sandbox tools or write paths; rlms
modifications; frontend work.

**Still open:** frontend deployment and community readiness remainder
(3.3 #5 residue — the next session); repository-extraction prerequisites;
conditional 3.3 #4 migration behind its unchanged trigger; T13's
migration-dependent hash preimage.

### July 7, 2026 — Session 10 redirected: external tools for the RLM (3.3 #8, MCP first)

Immediately after Session 9's acceptance, the owner redirected the next
session away from the sequencing default (frontend deployment) to a new
capability: give the agentic sub-agent tools beyond its two databases.
The direction, recorded as roadmap item 3.3 #8 and the rewritten
`HANDOFF.md`:

- **MCP first**: an operator-configured Model Context Protocol client
  surface injected into the RLM alongside `trellis_neo4j`/
  `trellis_postgres`, with **web search as the first tool**;
- **A2A and further tool expansion follow** in later sessions, as the
  3.3 #8 continuation row in §4;
- **provenance is not negotiable**: MCP calls never satisfy the
  database-provenance requirement, and external content becomes citable
  only through the verified ingest path (content-addressed AST bytes) —
  `write_derived_insight` stays the single write path and still demands
  live AST provenance;
- **operator control**: servers, transports, and tool allowlists come
  from validated configuration only, never from job payloads or model
  choice; acceptance stays zero-paid via a local deterministic fixture
  MCP server.

Frontend deployment moves to sequencing row 3, deferred a second time,
not dropped. No code changed in this entry — it records the priority
decision and the handoff rewrite so the next session starts with zero
external context.

### July 7, 2026 — Session 10: MCP tool surface for the RLM sub-agent (item 3.3 #8, first slice)

The RLM sub-agent can now consult operator-configured external tools over
the Model Context Protocol — web search is the intended first tool — while
every provenance rule stays exactly where it was.

**Configuration is the only gate.** New `TRELLIS_MCP_SERVERS` env value: a
JSON array of `{name, command, tools, timeoutMs, maxResultBytes}`,
Zod-validated at startup by the new pure
[mcp_servers.ts](src/config/mcp_servers.ts) (name/tool charset
`^[a-z][a-z0-9_-]*$` so a name can never smuggle prompt braces or
whitespace; commands are argument vectors, never shell strings; unique
names; capped timeouts/sizes; max 8 servers; default empty).
`rlm_worker.ts` forwards the canonical re-serialization through the new
pure `buildAgentEnv` helper ([rlm_job.ts](src/workers/rlm_job.ts)) — which
also *strips* any raw inherited registry when none is configured, so the
child only ever sees validated values — and
[trellis_mcp.py](src/rlm/trellis_mcp.py) re-validates defensively with
bound-for-bound identical rules. Queue payloads carry nothing MCP-shaped
(unit-pinned); no model completion or REPL string can name a server or
tool outside the config.

**The client.** `src/rlm/trellis_mcp.py` wraps the official `mcp` SDK
(pinned `mcp==1.12.4` in `requirements.txt`, covered by `python:check`).
Stdio transport only: each server is spawned as a child of the RLM
process, handshaken once at construction, and closed in the agent's
`finally` alongside the database tools; each connection lives inside one
long-lived asyncio task on a background loop thread because anyio cancel
scopes are task-bound. One injected object (`trellis_mcp`) following the
`trellis_tools.py` discipline: JSON-string returns, errors raised with
real messages for REPL self-correction, `list_tools()` reporting the
configured surface with no I/O, and `call_tool(server, tool, arguments)`
enforcing the allowlist *before any I/O*. Every call is bounded twice
(the SDK's `read_timeout_seconds` plus a sync-side backstop so the REPL
thread can never hang) and size-capped with an explicit
`TRELLIS_MCP_TRUNCATED` marker (UTF-8-safe truncation). A dead-on-arrival
server raises a readable startup error instead of hanging.

**Provenance is structurally unchanged.** MCP calls increment their own
counter — never `_count_tool_call()` — so `TRELLIS_PROTOCOL_VIOLATION`
stays keyed to database tool calls and a run that only searched the web
is still provenance-free. `write_derived_insight` and its
`sourceNodeIds` validation are untouched. The prompt addendum generated
from the config (`build_mcp_addendum`; empty registry → empty string →
byte-identical prompt, unit- and live-pinned) states the contract in the
prompt itself: MCP results are research context, never `sourceNodeIds`;
external content earns citability only through the verified ingest path.
`TRELLIS_TELEMETRY` gains `mcp_calls` (backward-compatible in both
directions across the scanner and the benchmark `TelemetrySchema`), with
the label-free `trellis_rlm_mcp_calls_total` counter and an `rlm.mcp`
counts-only log event (T16 discipline: commands, arguments, and results
never reach labels or logs).

**Zero-paid acceptance.** New
[fixture_mcp_server.py](scripts/fixture_mcp_server.py): a local
deterministic FastMCP stdio server with a canned `web_search` plus
misbehaving modes (`slow_search`, `oversized_search`). The new
`npm run test:rlm-mcp` ([test_rlm_mcp.ts](scripts/test_rlm_mcp.ts) →
[test_rlm_mcp.py](scripts/test_rlm_mcp.py) under the pinned interpreter)
builds its registry with the Node-side Zod helpers and forwards it via
env exactly as the worker does, pinning the cross-language contract along
the real delivery path.

**Defects found and fixed along the way:** (1) the fixture's slow tool
originally used a synchronous `time.sleep`, which blocked the FastMCP
event loop and made the *following* call time out too — the first live
run caught it; fixed by making the misbehaving tool async so it stalls
only its own request; (2) `TrellisMcp.close()` initially gated the loop
shutdown on `is_running()`, leaving a hang window if close raced a loop
thread that had not reached `run_forever` yet — now the stop is always
scheduled and a closed loop is tolerated.

**Verification (all commands run, zero paid calls, no external network).**
Offline: `npm test` = **419 passing across 53 files** (baseline 397/52;
+22: registry validation pure and through the config import via the
reset-modules pattern, `buildAgentEnv` forwarding pins including the
raw-registry strip, the payload-carries-nothing-MCP pin, `mcp_calls`
telemetry compatibility in both directions in the scanner and the
benchmark schema, and the label-free metric name pin). `npm run build`,
`npm run python:check` (now compiles `trellis_mcp.py` and the fixture and
imports `mcp`), `docker compose --profile test config --quiet`, and
`git diff --check` pass. New live suite: `npm run test:rlm-mcp` =
**46 checks** (Python re-validation twins, addendum hygiene incl.
byte-identity on empty config and no unescaped braces, truncation
purity/UTF-8 safety, two fixture servers handshaking once, deterministic
canned search, unknown-server/unknown-tool/configured-but-not-allowlisted
rejections before I/O, the 2 s timeout tripping at 2.0 s, the 512-byte
cap with marker, database tool-call count staying **0** while
`mcp_calls` counted 6+, clean loop-thread shutdown, and the
dead-on-arrival server raising). `npm run test:agent-loop` (23 checks)
passed **both with `TRELLIS_MCP_SERVERS` set and unset** — config
presence does not disturb the stub path. Existing live suites stayed
green: `test:repo-ingest` (45), `test:benchmark-hardening` (24),
`test:entity-resolution` (33), `test:api-hardening` (18),
`test:rlm-sandbox` (4), `test:belief-recovery` (30),
`test:invalidation-sweep` (17). `npm run drill:scale` closed its gate
(max cardinality 286, sweep growth 1.99x, zero residue). The isolated
`trellis-s10-integration` Compose project passed its 9 assertions with
the rebuilt image (which now installs `mcp==1.12.4`) and removed only its
own containers and volumes.

**Cost:** zero paid calls; the fixture is the only server acceptance
configures. A real web-search MCP server is an owner-approved run:
print the configured allowlist first, record observed `mcp_calls`.

**Deliberately not included (the recorded follow-on, sequencing row 1):**
A2A interoperability; transports beyond stdio (HTTP/SSE/remote and their
auth story); orchestrator tools of any kind (the orchestrator stays
tool-free); a fetch-then-ingest pipeline or any new graph write path;
MCP through the API or job payloads; containerized tool servers in
Compose; vendor-specific web-search integrations.

**Still open:** the 3.3 #8 continuation (tool-surface expansion and A2A);
frontend deployment (3.3 #5 residue); repository-extraction
prerequisites; conditional 3.3 #4 migration behind its unchanged trigger;
T13's migration-dependent hash preimage.

### July 7, 2026 — Session 11: the A2A server surface over the goal loop (3.3 #8, second slice)

Trellis is now dispatchable by external agents through a standards
surface: the Agent2Agent protocol, served directly over the Session 9
goal loop. One A2A task is one agentic goal — a second door into the
same room, never a bypass.

**Protocol version pinned.** Built against **A2A specification v1.0.0**
(a2a-protocol.org / a2aproject/A2A; verified against
`specification/a2a.proto` and the §9 JSON-RPC binding before any wire
shape was written, per the handoff's do-not-build-from-memory rule).
v1.0 differs materially from the 2025 0.x line: PascalCase JSON-RPC
methods (`SendMessage`, `GetTask`, …), ProtoJSON serialization
(`TASK_STATE_*`/`ROLE_*` enums, camelCase fields, no `kind`
discriminators), the well-known card at `/.well-known/agent-card.json`,
blocking-by-default `SendMessage` with `configuration.returnImmediately`,
and a mandate that an absent `A2A-Version` header be interpreted as a
0.3 client (declined here with `VersionNotSupportedError`, supported
version advertised in the error detail). **SDK decision:** the official
`@a2a-js/sdk` (evaluated at 0.3.13) still implements the 0.3.x wire
format and brings its own Express app/executor/task-store machinery that
would bypass the `StreamGate` admission pattern and the Zod boundary
discipline — not adopted. The v1.0 subset is hand-rolled with Zod at the
boundary; **zero new dependencies** in either language.

**The surface** (`src/api/a2a.ts` + pure modules in `src/core/a2a/`;
mounted by `server.ts` only when `TRELLIS_A2A_ENABLED=true`, default
false, with the API byte-identical when unset — drill-pinned):

- `GET /.well-known/agent-card.json` — the Agent Card
  (`agent_card.ts`), served before the API-key middleware because
  discovery is how a client learns the required scheme; it carries only
  public contract (name/description/URL from validated config, JSONRPC
  1.0 interface, streaming capability, the `x-api-key` scheme
  declaration, one `goal-execution` skill). No-secret-leak pinned by
  unit test and drill.
- `POST /a2a/v1` — one JSON-RPC endpoint behind the existing API key.
  Every envelope and parameter crosses Zod schemas (`protocol.ts`) with
  the spec's error vocabulary: -32700/-32600/-32601/-32602 for transport
  failures, -32001 TaskNotFound, -32002 TaskNotCancelable (the loop has
  no abort path; cancel is always declined), -32003 for push-notification
  methods, -32004 for `ListTasks`/`SubscribeToTask`/`GetExtendedAgentCard`
  and for multi-turn `taskId`/client `contextId` attempts (goals are
  one-shot), -32005 for non-text parts, -32009 for version mismatches.
  Inbound size caps: ≤8 text parts, ≤32 KiB goal text.
- Dispatch shares the `/api/agent-stream` admission verbatim — the SAME
  `StreamGate` instance (one concurrent-goal cap across both surfaces)
  plus the `agent_queue` depth backstop; over-limit requests get HTTP
  429 carrying a JSON-RPC error body with a `RATE_LIMITED` detail. The
  concatenated message text is the only payload that enters the loop;
  oracle scripts ride only in `metadata.oracle` and only when
  `AGENT_ORACLE_ENABLED=true` (rejected with -32602 otherwise — the
  Session 9 SSE posture exactly).
- Task state is a TTL-bounded Redis record (`a2a:task:<goalId>`,
  `A2A_TASK_TTL_SECONDS`, default 3600) maintained by a per-goal
  server-side recorder subscribed to the existing
  `agent-stream:<goalId>` channel (subscribe-then-enqueue). The pure
  state machine and all wire rendering live in `task_record.ts`:
  SUBMITTED → WORKING on progress events → COMPLETED with one text
  artifact (`lastChunk: true` on the stream) or FAILED carrying the
  typed `kind: reason` as the status message — every goal lifecycle
  path and all five `GoalFailureKind`s pinned exhaustively by unit test.
  `SendMessage` blocks on the terminal event per spec (or returns the
  SUBMITTED task under `returnImmediately`); `SendStreamingMessage`
  streams JSON-RPC-enveloped `StreamResponse` frames and closes on the
  terminal status; `GetTask` renders the record. The recorder reclaims
  its subscriber and gate slot at the record TTL if a goal somehow
  outlives it (`a2a.recorder_ceiling`).
- Observability (T16): `trellis_a2a_requests_total{method}` (fixed
  vocabulary + `declined`/`invalid`) and
  `trellis_a2a_tasks_total{outcome}` in the API process; `a2a.*` events
  carry ids, states, and codes only — message content and artifacts
  never reach labels or logs.

**Defect found and fixed along the way:** the first live run wedged
every blocking send — the recorder issued its Redis `SUBSCRIBE` after an
unrelated `await` (the initial record write), which can land the
subscribe mid ready-check on a fresh ioredis connection; the connection
then loops on "Connection in subscriber mode" reconnects and delivers no
events. Fixed by subscribing in the same tick the connection is created
(the SSE endpoints' existing discipline) and writing the initial record
after the subscription is confirmed; recorder/store connections also
gained error listeners so transient connection errors cannot become
unhandled-error noise.

**Verification (all commands run, zero paid calls, no external
network).** Offline: `npm test` = **468 passing across 57 files**
(baseline 419/53; +49: A2A config validation via the reset-modules
pattern, the JSON-RPC envelope/params/version/method-classification
boundary, the exhaustive goal→task translation and stream-frame
rendering, Agent Card shape + no-secret-leak, and the a2a metric label
pins). `npm run build`, `npm run python:check`,
`docker compose --profile test config --quiet`, and `git diff --check`
pass. New live suite: `npm run test:a2a` = **46 checks** across three
server postures (disabled-default: routes absent; drill: discovery,
auth, version negotiation, the full malformed-JSON-RPC matrix, blocking
send with the answer artifact, returnImmediately + GetTask polling
across the lifecycle, the SSE stream from SUBMITTED task through
artifactUpdate/lastChunk to terminal status, a concurrency-bound trip
surfacing as TASK_STATE_FAILED with the typed reason, CancelTask/GetTask
error codes, 429 saturation with a JSON-RPC body, and API-process
metrics with no goal-text leakage; enabled-without-oracle: drill
metadata rejected before enqueue). Regression: `npm run test:agent-loop`
(23) green and untouched. Existing live suites stayed green:
`test:rlm-mcp` (46), `test:repo-ingest` (45), `test:benchmark-hardening`
(24), `test:entity-resolution` (33), `test:api-hardening` (18),
`test:rlm-sandbox` (4), `test:belief-recovery` (30),
`test:invalidation-sweep` (17). `npm run drill:scale` closed its gate
(max cardinality 286, sweep growth 1.23x, zero residue). The isolated
`trellis-s11-integration` Compose project passed its 9 assertions and
removed only its own containers and volumes.

**Deliberately not included (HANDOFF §8):** Trellis as an A2A *client*;
push notifications/webhooks; goal cancellation mid-flight; multi-turn
`input-required` interactions; MCP transport expansion (the recorded
next slice); exposing MCP through A2A in any form; authentication
schemes beyond the existing API key (OAuth is follow-on); frontend work.

**Still open:** the 3.3 #8 continuation (MCP remote/HTTP transports and
containerized tool servers); frontend deployment (3.3 #5 residue);
repository-extraction prerequisites; conditional 3.3 #4 migration behind
its unchanged trigger; T13's migration-dependent hash preimage.

### July 7, 2026 — Session 12: remote MCP transports and the containerized tool-server pattern (3.3 #8, third and closing slice)

The RLM's external tool surface was stdio-only: every MCP server had to
be a spawnable child inside the worker container. Session 12 moves the
*transport*, not the capabilities — the same allowlist-before-I/O,
per-call timeout, size-cap, and provenance-split discipline now holds
for tool servers reached over the network.

**Spec/SDK state verified before designing (recorded per the handoff):**
the pinned `mcp==1.12.4` SDK ships
`mcp.client.streamable_http.streamablehttp_client(url, headers, timeout,
sse_read_timeout, auth)` and speaks MCP protocol revision **2025-06-18**,
under which Streamable HTTP is the current remote transport and HTTP+SSE
is deprecated (and deliberately unsupported here). FastMCP serves
`streamable-http` natively with a `streamable_http_app()` ASGI export;
DNS-rebinding protection defaults off in this SDK version, so a
Compose-internal Host header needs no extra settings. **No SDK bump was
needed**: `requirements.txt`, the Docker image, and `python:check` stay
on `mcp==1.12.4`.

**The registry union.** `src/config/mcp_servers.ts` became a Zod union
discriminated on `transport`: the pre-Session-12 shape is
`{transport:'stdio', name, command, tools, timeoutMs, maxResultBytes}`
with `stdio` filled in when the field is absent (every existing registry
parses unchanged — unit-pinned, including the explicit-vs-defaulted
equivalence); the new variant is `{transport:'http', name, url, tools,
timeoutMs, maxResultBytes, auth?}`. URL posture, enforced identically in
Zod and the Python twin: `https://` always; plain `http://` only for
loopback, RFC1918, or dot-free (Compose/LAN service DNS) hosts, so a
credential is never sent in cleartext across a public network
(`isPrivateMcpHost` / `_is_private_mcp_host`, pinned host-by-host on
both sides including the 172.16/12 boundary octets).

**The operator-owned auth story.** `auth: {kind: 'bearer' | 'header',
header?, valueEnv}` — the registry carries a credential REFERENCE (an
environment variable name matching `^[A-Z][A-Z0-9_]*$`), never a value.
The new pure `resolveMcpCredentialEnv` resolves the named variables at
config load: a registry naming an unset variable fails startup with an
error that names the variable and the server, never a value (the
Guardrail-5 fail-fast posture). `buildAgentEnv` gained an explicit
`mcpCredentialEnv` map so the spawned agent receives exactly the named
variables (unit-pinned, including the stale-inherited-value override);
the Python side re-resolves from its own environment at construction,
before any I/O. **Redaction guarantee:** every resolved secret is
registered the moment it exists, and every exception crossing into the
model-visible REPL is scrubbed (`[REDACTED]`) — auth-failure drills
assert the secret is absent from raised errors, `list_tools()`, the
prompt addendum, and the canonical serialization. anyio's
`ExceptionGroup` wrapper is flattened (`_describe_exception`) so a 401
or connect refusal stays diagnosable instead of reading "unhandled
errors in a TaskGroup".

**One connection machinery, two dial functions.** In
`src/rlm/trellis_mcp.py` the per-server long-lived asyncio task,
handshake-once, allowlist, double timeout bound, truncation, and
close-in-`finally` machinery is untouched; the only transport-aware seam
is the new `_dial` async context manager (`stdio_client` vs
`streamablehttp_client` with the resolved auth header and a bounded
connect). An unreachable URL fails the run in seconds with a readable
startup error. `build_mcp_addendum` output is transport-blind
(names/tools/bounds only — never a URL or credential; empty-registry
byte-identity unchanged).

**The containerized tool-server pattern.**
`scripts/fixture_mcp_server.py` gained `--transport streamable-http
--host --port` plus an auth mode (`--auth-token-env` — the expected
token arrives via environment, never argv; a Starlette middleware over
`streamable_http_app()` returns 401 before any MCP handling). Compose
gained the `mcp-fixture` service under the `test` profile: own service
on the project network, no host-published port, bearer auth via env
reference, and — because a tool server needs no Trellis databases — an
entrypoint override that bypasses the image's schema bootstrap. The
integration builds its registry with the production Zod helpers and
probes the service through `scripts/compose_mcp_probe.py`. README and
RUNBOOK §8 document this as the deployment shape for operator-owned
tool servers.

**Observability decision (recorded per the handoff):**
`trellis_rlm_mcp_calls_total` **stays label-free**. A `transport` label
would require extending the `TRELLIS_TELEMETRY` wire line to split the
per-run count for a distinction the operator already knows from their
own registry; not worth the surface. The `rlm.mcp` event still carries
counts only.

**Defects found and fixed along the way:** (1) **the Docker image never
shipped `trellis_mcp.py`** — the Session 10 Dockerfile copies
`trellis_agent.py`/`trellis_tools.py` but not the module
`trellis_agent.py` has imported unconditionally since Session 10, so
every containerized RLM run would have crashed at import; the Compose
integration never runs an RLM job, which is how it slipped through.
Fixed (the image now also carries the fixture and probe for the test
profile), and the new containerized-fixture assertion imports the module
in-container so a regression cannot slip through silently again.
(2) The first containerized-fixture run failed because the fixture
inherited the image's schema-bootstrap entrypoint, spent ~65 s failing
to reach databases it does not need, and died before serving — fixed
with the entrypoint override now recorded in the compose file as part of
the pattern.

**Verification (all commands run, zero paid calls, no external
network — loopback and Compose-internal traffic only).** Offline:
`npm test` = **485 passing across 57 files** (baseline 468/57; +17: the
transport union incl. stdio-default backward compatibility, URL/auth
validation and rejection matrices, the private-host posture pinned
host-by-host, `resolveMcpCredentialEnv` exact-map/fail-fast/shared-var
behavior, secret-never-serialized, and the `buildAgentEnv` credential
passthrough pins). `npm run build`, `npm run python:check` (now also
compiles the probe), `docker compose --profile test config --quiet`, and
`git diff --check` pass. `npm run test:rlm-mcp` = **86 checks**
(baseline 46; the Python twin matrices for the http variant; a mixed
five-server stdio+HTTP registry — including a credentialed server —
handshaking in one client; deterministic canned search byte-identical
across transports; allowlist rejection before I/O, the 2 s per-call
timeout, and the 512-byte truncation cap all holding over HTTP; auth
success; wrong-credential failing fast (0.3 s) with a readable 401 and
both token values absent from the error; unset-`valueEnv` failing before
any I/O; an unreachable URL failing in 2.3 s; addendum and `list_tools`
carrying no URL or credential material). The isolated
`trellis-s12-mcp` Compose project passed **10 assertions** (the 9
existing plus the containerized credentialed fixture probe) and removed
only its own containers and volumes. Regression, all green:
`test:a2a` (46), `test:agent-loop` (23), `test:repo-ingest` (45),
`test:benchmark-hardening` (24), `test:entity-resolution` (33),
`test:api-hardening` (18), `test:rlm-sandbox` (4),
`test:belief-recovery` (30), `test:invalidation-sweep` (17).
`npm run drill:scale` closed its gate (max cardinality 286, sweep
growth 1.63x against 5.77x fact growth, zero residue).

**Deliberately not included (HANDOFF §8):** new tools or tool semantics;
OAuth flows for MCP servers (bearer/header env-referenced credentials
only); the deprecated HTTP+SSE transport; MCP server auto-discovery or
registry fetching; Trellis as an MCP server or A2A client; exposing MCP
through A2A; new RLM write paths; orchestrator tools; frontend work.

**Still open:** frontend deployment (3.3 #5 residue — sequencing row 1);
repository-extraction prerequisites; conditional 3.3 #4 migration behind
its unchanged trigger; T13's migration-dependent hash preimage. The
recorded 3.3 #8 scope is exhausted; further external-tool work is a new
owner direction.

### July 7, 2026 — Session 13: documentation, context alignment, and architectural consolidation (owner-directed)

The owner redirected Session 13 from the frontend deployment (initially
renumbered to Session 14; superseded by the close-out addendum below,
which defers it unscheduled) to a documentation and
context-engineering session. Origin: a one-shot design study (July 7,
2026) that assessed an explicit working memory for the RLM, was steered
by the owner toward harness-captured search/MCP results and the
compositional-intelligence direction, and closed with a
Document-Driven-Design audit of this repository's docs. No code changed;
`npm test` remained 485 passing across 57 files before and after.

**Landed:**

- **`docs/architecture/WORKSPACE_AND_MODULES.md`** — the design record
  (design only; nothing implemented). Contents: the four governing
  axioms with an anti-drift mandate; the two flywheels (knowledge —
  shipped; capability — designed) and the momentum law with its
  governing condition; the three-tier trust model; the Tier-3 workspace
  contract (mechanical harness capture of external-tool results into
  uuid-delimited, origin-stamped segments; stub returns;
  plan-in-workspace; a JSON-serializable data-not-objects contract; the
  verified `rlms==0.1.3` rebind-vs-mutate exception semantics; bounds
  and byte-identical injection gating); cross-task workspace lineage
  (serialize → park in TTL-bounded goal-scoped Redis → seed at spawn;
  the orchestrator routes by reference and stays tool-free — explicitly
  not a live blackboard, matching the batch-independence rule); the
  operator-gated promotion path (workspace segment → verified ingest →
  citable AST bytes, inheriting the update/quarantine machinery for
  refreshed external content); the L0–L3 self-editing capability ladder
  (L1 runtime config mutation FORBIDDEN, L2 hot-patching REJECTED, L3
  staged self-modification through the verified pipeline APPROVED as
  the capability flywheel's mechanism); the kernel/userspace boundary;
  the module manifest/registry/composition/gates design with module #0
  (extracting the hardcoded spatial-flywheel protocol behind a
  byte-identical composed-prompt pin); provenance-boundary enforcement
  (identifier disjointness plus the recorded `_normalize_fact`
  hardening: `^[0-9a-f]{64}$` format check and `ast_nodes` existence
  check — a severable pre-existing gap, writable-hallucinated-hash
  today); a six-step implementation sequence; a corrections ledger; and
  explicit exclusions.
- **`docs/GLOSSARY.md`** — canonical one-line definitions for the
  load-bearing terms (RLM = Recursive Language Model; provenance /
  `sourceNodeIds`; contested/quarantine; both flywheels;
  workspace/segment; graph-addressing vs. graph-addressed; the
  promotion path; kernel vs. userspace; module #0; addendum
  conventions), with a stated authority hierarchy: code > glossary >
  prose. Motivated by observed semantic drift in summarization
  pipelines during the design study (an "RLM" mis-expansion and an
  inverted reliability causality, both recorded in the design record's
  corrections ledger).
- **§1 drift fixes in this file** (the architecture overview had
  fossilized at its July 4 generation date while §3/§5 stayed current):
  the RLM harness paragraph now records three injected tool surfaces
  (read-only Neo4j, Postgres AST reader, operator-configured MCP) plus
  the Session 9/11 agentic and A2A surfaces; the §1.1 diagram gains
  `agent_queue`, the agent worker, and the A2A entry point; the storage
  table's Redis row lists all seven queues and the TTL-bounded A2A task
  records. The header now dates the §1 refresh and names `HANDOFF.md`
  §1 as the living mental model.
- **`HANDOFF.md`** — session list extended with Session 13 and its
  deliverable; the objective, problem statement, and acceptance
  language renumbered to Session 14 (frontend deployment, scope
  untouched).

**Close-out addendum (July 7, 2026, same session, second PR):** the
owner accepted the trajectory recommendation and took the sequencing
decision the paragraph above anticipated:

- **Session 14 is scoped to design-record §11 steps 2 + 1** — kernel
  hardening (the `_normalize_fact` `^[0-9a-f]{64}$` format check and
  batched `ast_nodes` existence check at the single write path, wired
  fail-fast before the WRITE session) first, then the Tier-3 workspace
  (harness-captured origin-stamped uuid segments, stub returns,
  plan-in-workspace, `TRELLIS_WORKSPACE_MAX_SEGMENTS`/`_MAX_BYTES`
  bounds, gating on MCP-configured-or-goalId with byte-identical
  baseline, `workspace_ops`/`workspace_segments`/`workspace_bytes`
  telemetry counts). One branch, one PR; zero-paid acceptance including
  the new `test:rlm-workspace` drill with a direct-`LocalREPL`
  semantics pin against the installed `rlms==0.1.3`; the paired-run
  behavioral probe stays owner-gated and is not an acceptance gate.
  Full spec: the regenerated `HANDOFF.md` §3–§8.
- **The frontend deployment (3.3 #5 residue) is deferred, unscheduled**
  (third deferral), scope preserved in §3.3 #5; it re-enters §4 when
  the owner schedules it. Design-record steps 3–6 are owner-sequenced
  after Session 14 (§4 row 2).
- **README aligned with the July 7 baseline:** a fourth (agency-layer)
  bullet in the architecture summary, an explicit pointer naming
  `HANDOFF.md` §1 the single source of truth for the active mental
  model (with the design record and glossary as companions), and
  `test:a2a` added to the live zero-LLM check list it had drifted out
  of.
- **Terminology invariant re-verified across README, HANDOFF, this
  file, the design record, and the glossary:** every expansion of RLM
  reads Recursive Language Model (MIT CSAIL formulation); the only
  occurrences of the erroneous forms are the corrections-ledger
  negations that exist to forbid them.
- Offline suite unchanged: 485 passing across 57 files;
  `npm run python:check` green.

### July 7, 2026 — Session 14: kernel hardening and the Tier-3 workspace (design record §11 steps 2 + 1)

Both halves of the owner-accepted scope shipped on one branch, hardening
first, exactly as sequenced. Design record
`docs/architecture/WORKSPACE_AND_MODULES.md` §11 steps 1 and 2 are now
marked done; steps 3–6 remain open and owner-sequenced.

**Write-path hardening (§10.2, first commit).** The single agent write
path now enforces what was previously convention:

- `_normalize_fact` ([trellis_tools.py](src/rlm/trellis_tools.py))
  rejects any `sourceNodeIds` element not matching `^[0-9a-f]{64}$`
  (module-level `AST_HASH_PATTERN`) with a `Provenance Violation` error
  carrying a bounded (80-char) repr echo.
- `TrellisPostgres.ast_hashes_exist(hashes)` returns a JSON list of the
  MISSING hashes via one `SELECT id FROM ast_nodes WHERE id = ANY(%s)`,
  with the same rollback-on-error posture as `get_ast_texts`. It is
  deliberately NOT counted as a database tool call: reading it never
  satisfies the provenance protocol, and the write it guards already
  counts.
- `TrellisNeo4j.__init__` accepts an `ast_existence_check` callable;
  `_run_insight_writes` verifies the deduped union of the batch's
  hashes BEFORE opening the WRITE session. Unknown hashes raise listing
  the first 5 plus a total count; no partial write. An infrastructure
  failure from the checker propagates as `RuntimeError` — never
  reported as a provenance verdict. `trellis_agent.py` wires the check
  unconditionally (no toggle).
- Structural-disjointness note: workspace segment ids are UUIDv4 and
  origin `argsHash` stamps are 16 hex chars, so no Tier-3 identifier
  can even be shape-confused with Tier-1 provenance.

**The Tier-3 workspace (§4, second commit).** New
[trellis_workspace.py](src/rlm/trellis_workspace.py): `TrellisWorkspace`
is injected via rlms `custom_tools` as `trellis_workspace` (non-callable
⇒ persistent REPL locals, by construction). Inner state is the plain
version-tagged dict `{version, plan, notes, segments}` — the
data-not-objects contract. Model-visible methods return JSON strings and
raise real exceptions: `read()` (bounded index — ids/origins/sizes/plan/
notes, never contents), `segment(id)`, `set_plan(plan)` (JSON-round-trip
enforced), `add_note(text)`, `drop(id)`, `snapshot()` (canonical
sorted-key JSON — the future lineage seam). Harness-side
`capture(server, tool, args_hash, content, truncated)` mints a uuid4
segment stamped `origin/fetchedAt/bytes/truncated` (+`goalId`/`taskId`
when present) and returns the stub; stamps are wrapper-owned.
`WorkspaceBudgetError` carries current usage and a `drop()` hint; stored
state is never silently truncated.

- **Capture and stub returns:** `TrellisMcp(servers, workspace=None)`;
  with a workspace attached, `call_tool` deposits the (already
  size-capped) result inside the call and returns
  `{"server","tool","segmentId","bytes","truncated","preview"}`
  (preview ≤ 500 chars); a capture that trips the budget raises before
  returning and the result is discarded deterministically. With no
  workspace the legacy full-result return is byte-identical (pinned).
- **Gating:** new `--goal-id` CLI arg on `trellis_agent.py`
  (`buildAgentArgs` forwards it when `job.goalId` exists); the
  workspace and its brace-free addendum (`dict(...)` example syntax,
  rebind-for-atomic-updates guidance, the workspace-never-provenance
  hard rule) are injected only when MCP servers are configured OR
  `--goal-id` is present. Otherwise the prompt is byte-identical
  (pinned).
- **Bounds:** `TRELLIS_WORKSPACE_MAX_SEGMENTS` (default 128, cap 1024)
  and `TRELLIS_WORKSPACE_MAX_BYTES` (default 4 MiB, cap 32 MiB),
  Zod-validated in `src/config/index.ts`, forwarded by `buildAgentEnv`
  (raw inherited values stripped when unset), re-validated defensively
  in Python (`parse_workspace_bounds`) with identical maxima.
- **Telemetry:** `TRELLIS_TELEMETRY` gains
  `workspace_ops`/`workspace_segments`/`workspace_bytes` — counts only
  (T16); the Node scanner parses them with degrade-to-0 for
  pre-Session-14 payloads. The provenance protocol is unchanged: zero
  DATABASE tool calls is still `TRELLIS_PROTOCOL_VIOLATION` regardless
  of workspace or MCP activity.
- **Shipping hygiene:** the Docker image `COPY` line and
  `check_python_runtime.py` gained `trellis_workspace.py` (the Session
  12 missing-module defect class, closed proactively); the isolated
  Compose integration rebuilt the image with the new module and passed.

**Acceptance (all zero-paid, July 7, 2026).** Exact commands and
observed counts:

- `npm test` — 493 passing across 58 files (baseline 485/57; new:
  `workspace_bounds.test.ts`, `--goal-id`/workspace-env forwarding in
  `rlm_job.test.ts`, workspace telemetry parsing pins in
  `rlm_telemetry.test.ts`).
- `npm run build`, `npm run python:check`,
  `docker compose --profile test config --quiet` — green.
- Isolated Compose integration (`trellis-s14-integration`, host ports
  0): 10/10 including the containerized credentialed MCP fixture probe.
- `npm run test:rlm-workspace` — NEW, 64 checks: bounds twins, holder
  surface, capture-inside-`call_tool` against the stdio fixture,
  truncation stamps, budget raise + `drop()` recovery, deterministic
  discard, gated-off byte-identity, and the direct-`LocalREPL`
  rlms==0.1.3 pin (persistence, scaffold restore, rebind-vs-mutate on
  exception, underscore filtering).
- `npm run test:rlm-sandbox` — 21 checks (was 4), extended with the
  hardening matrix.
- `npm run test:rlm-mcp` — 86; `npm run test:a2a` — 46;
  `npm run test:agent-loop` — 23; `npm run test:repo-ingest` — 45;
  `npm run test:benchmark-hardening` — 24;
  `npm run test:entity-resolution` — 34 (the drill has always had 34
  `check()` calls; the previously recorded 33 was a stale count, not a
  behavior change); `npm run test:api-hardening` — 18;
  `npm run test:belief-recovery` — 30;
  `npm run test:invalidation-sweep` — 17 — all unchanged and green.
- `npm run drill:scale` — migration gate CLOSED: maximum
  `sourceNodeIds` cardinality 286, sweep latency growth 1.85x against
  5.77x fact growth (within run-to-run variance of Session 12's 1.63x;
  both far under the superlinear trigger).

**Defects found along the way:** one, in the pre-existing test suite
rather than production code — `test_rlm_sandbox.py`'s write-path probe
had always written with the fake hash `sandbox-test-hash`, which is
exactly what the hardening now forbids; the probe was rewritten around a
token-scoped real AST row the test inserts and deletes. No production
defects surfaced; the Session 10–12 MCP suite passed unchanged against
the tuple-returning internal `call` seam.

**Not run (owner-gated):** the design record §11 step-1 paired-run
behavioral probe is PAID and remains proposed-not-executed; see the PR
for the cost estimate.

### July 7, 2026 — The paired-run workspace probe (design record §11 step 1, owner-approved paid run)

Executed after the owner approved the PR #40 proposal. Full protocol
and results: `docs/benchmarks/WORKSPACE_PROBE_REPORT.md`. One
sequential four-fetch task against the deterministic fixture (new
`archive_search` tool: ~3.9 KB payloads with the needed access code at
the END, past the 500-char stub preview), two runs identical except the
workspace; driver `scripts/probe_workspace_paired.py` (wrapper
`scripts/probe_workspace_paired.ts` — deliberately no npm alias; it is
the owner-gated paid path and joins no acceptance suite).

Results: both arms answered correctly. The workspace arm made exactly
the minimum 4 external calls (zero repeats) with a well-formed
end-of-run snapshot (4 uuid segments, wrapper-owned origin stamps, all
codes captured; `workspace_ops` 16, `workspace_bytes` 15,531); the
legacy arm made 8 — **every external call repeated** — the
scrollback-as-memory failure mode the design record predicts, observed
directly. Token cost comparable (14,221/1,035 vs 12,764/867
input/output). n=1 per arm: directional evidence, not statistics. The
probe was executed twice end-to-end (a log-capture defect in the first
execution's shell pipeline — an early-terminating `Select-Object` —
truncated the measurement JSON; both executions' answers were correct);
total spend ≈55K input / ≈4K output tokens, inside the approved
envelope.

### July 7, 2026 — Session 15: module registry + module #0 (design record §11 step 3, owner-directed)

The owner recorded the Session 15 direction on the PR #40 discussion:
design-record step 3, then step 4 as Session 16. Step 3 shipped on
branch `session-15-probe-and-modules` together with the probe above.

**The registry (design record §9.1–§9.3).** A module is a versioned
document-plus-assets artifact under `modules/<name>/`: a `module.json`
manifest (name charset `^[a-z][a-z0-9_-]*$`, integer version, purpose,
`research.sourceNodeIds` AST-hash list, bare-filename `addendum`,
`tools` — must be empty: this kernel edition supports PROTOCOL MODULES
only, the §9.3 first class — hard-capped `bounds.addendumMaxBytes`
default 8192/cap 16384, `status` active|contested|retired with only
`active` composable, `kernelCompat: 1`) plus a brace-free addendum text
file. Validators are bound-for-bound twins: `src/config/modules.ts`
(Zod, strict schema, fail-fast at config load — a process that cannot
compose its prompt surface must not run) and
`src/rlm/trellis_modules.py` (defensive re-validation at agent spawn).
Both normalize CRLF→LF so composition is byte-stable across checkout
conventions.

**Selection and composition (§9.2).** `TRELLIS_MODULES` is
operator-owned (Guardrail 5): unset → the DEFAULT selection
`["spatial-flywheel"]`; a JSON array → exactly that selection (max 4 per
run, duplicates rejected); `[]` → no modules. `buildAgentEnv` always
forwards the canonical validated serialization — a raw inherited value
can never leak through (unit-pinned). The composed addendum is
`TRELLIS_ADDENDUM_BASE` + Σ module addenda (each normalized to end with
one blank line, selection order) + `TRELLIS_WORKFLOW_RULES`; rubric
text enters through the single `<<TRELLIS_RUBRIC>>` substitution token,
replaced with the escape-doubled `_SAFE_RUBRIC`, and composition
re-verifies brace-freedom after substitution.

**Module #0 (§9.5).** The spatial-flywheel protocol was extracted from
the `TRELLIS_ADDENDUM` monolith MECHANICALLY (a script split the live
string and proved recomposition byte-identical before any source edit)
into `modules/spatial-flywheel/`. The pin of record: with the default
selection, sha256(SYSTEM_PROMPT) equals the recorded pre-extraction
value `abb945a6…f9b2` — the loader proved itself with zero behavior
change. The Docker image ships `modules/` and `trellis_modules.py`;
`python:check` verifies the module assets.

**Deferred with reason (§9.4):** the manifest-as-graph-entity
representation. Module #0 cites no research `sourceNodeIds` (it
predates the promotion path), so its graph entity would be empty and
unreachable by the invalidation sweep; the representation lands with
the first research-bearing module (steps 5–6), where contestation has a
substrate. Recorded in the design record §11 step 3.

**Acceptance (July 7, 2026, all zero-paid):** `npm test` = 513 passing
across 59 files (was 493/58; new `modules.test.ts` + the
`modulesJson` forwarding pin in `rlm_job.test.ts`); `npm run build`,
`npm run python:check` (now also validating module assets) green; NEW
`npm run test:modules` = 27 checks (selection twins, module #0
validation, the Node↔Python byte-identical addendum hash pin,
composition normalization, unescaped-brace rejection, the
byte-identical composed-prompt pin, the empty-selection pin);
`test:rlm-workspace` 64, `test:rlm-mcp` 86, `test:rlm-sandbox` 21,
`test:agent-loop` 23, `test:a2a` 46, `test:api-hardening` 18,
`test:invalidation-sweep` 17, `test:belief-recovery` 30,
`test:entity-resolution` 34, `test:benchmark-hardening` 24,
`test:repo-ingest` 45 — unchanged and green; `npm run drill:scale` gate
CLOSED (max provenance 286, sweep growth 2.26x this run — run-to-run
variance across 1.63x/1.85x/2.26x, all far under the superlinear
trigger); the isolated Compose integration
(`trellis-s15-integration`, host ports 0) rebuilt the image with
`modules/` + `trellis_modules.py` and passed 10/10. No defects found in
existing code this session.

### July 7, 2026 — Session 16: workspace lineage (design record §11 step 4, owner-directed)

The owner directed step 4 for Session 16 on the PR #40 discussion.
Design record §5 is normative and shipped as specified: workspace
inheritance along the goal iteration structure — explicitly not a live
blackboard.

**Serialize (agent side).** `trellis_agent.py` gains `--workspace-out`:
in the `finally`, success or failure, a non-empty workspace writes
`snapshot()` (canonical sorted-key JSON, the Session 14 seam) to the
worker-named temp file. Nothing new crosses stdout — the telemetry
scanner stays bounded and SSE clients see nothing new. A failed run
still serializes: its partial workspace can seed the retry.
`TrellisWorkspace.is_empty()` gates the write.

**Park (worker side).** For goal-correlated jobs `rlm_worker.ts` names
the temp file, and after process exit validates the snapshot against
the new Zod schema (`src/workers/workspace_scratch.ts`, twin of the
Python state dict: version 1, plan, notes, origin-stamped segments) and
parks it at `scratch:goal:<goalId>:task:<taskId>` with
`SCRATCH_TTL_SECONDS` (default 3600, hard cap 86400 — the
`a2a:task:<id>` retention precedent). A per-goal parked-bytes cap
(`SCRATCH_MAX_BYTES_PER_GOAL`, default 8 MiB, cap 64 MiB) is enforced
via a goal-scoped counter key expiring alongside; an over-cap snapshot
is refused with a counts-only warning. Redis is a parking lot for
checkpoints, never a live store the model queries. The job completion
value gains `workspaceRef` (`{taskId, segments, bytes}` — counts only).
Parking failures degrade to "nothing parked"; they never fail the run
that produced the result.

**Seed (dispatch side).** `RlmJobDataSchema` gains `seedTasks` (ids
only, requires `goalId`, bounded 8). The worker resolves each parked
snapshot BEFORE anything runs — a missing/expired reference or a
malformed parked payload is a readable dispatch-time failure with zero
spend, never a silent empty seed — merges them (notes concatenate,
segments union first-wins, last non-default plan wins), writes a seed
file, and passes `--seed-workspace`.
`TrellisWorkspace.seed_from_snapshot` restores it at spawn: wrapper
stamps preserved verbatim (a seeded segment still records the task that
fetched it), structural and integrity validation (a bytes-stamp/content
mismatch is a torn seed and raises), bounds re-enforced — an
over-budget seed fails the task fast. A seeded run always gets a
workspace, and its prompt appends the brace-free `SEEDED RUN` addendum
telling the model to `read()` first; the unseeded prompt is
byte-identical to Session 14 (pinned).

**Route by reference (orchestrator).** The orchestrator stays
tool-free. `AgentTaskSpecSchema` gains `seedFromTasks` (nullable for
the OpenAI strict-schema contract; max 8); the goal loop validates
every id against tasks dispatched in PRIOR iterations — unknown ids and
same-batch ids end the goal as a typed `decision_error` before any
dispatch (batches stay independent, per the §5 no-blackboard rule).
`TaskOutcome` gains the counts-only `workspaceRef`;
`buildDecisionMessages` renders it in observations; the orchestrator
prompt teaches routing by reference (byte-exact identifier transfer
instead of restating findings). Oracle scripts express seeded
dispatches, and `RlmStubSchema` gains a data-only `workspaceSnapshot`
parked through the identical validate/park path, so the whole
park/resolve loop drills with zero LLM calls.

**Acceptance (July 7, 2026, all zero-paid).** `npm test` = 536 passing
across 61 files (was 513/59; new `workspace_scratch.test.ts` and
`scratch_bounds.test.ts`, plus seed/lineage cases in `rlm_job`,
`decision`, `goal_loop`, `transcript`, and `oracle` tests);
`npm run build` and `npm run python:check` green. Live:
`test:rlm-workspace` 83 (was 64 — seed round-trips a real snapshot
byte-identically, stamps preserved, seed budgets raise, malformed/torn
seeds raise readable errors, seeded-addendum gating pinned);
`test:agent-loop` 35 (was 23 — a stub task parks a snapshot in real
Redis with byte-exact content and a bounded TTL, a second-iteration
task seeds from it by reference, the per-goal cap refuses an oversized
park live, and a missing reference fails the seeded task readably;
token-scoped cleanup). Unchanged and green: `test:modules` 27,
`test:rlm-mcp` 86, `test:rlm-sandbox` 21, `test:a2a` 46,
`test:api-hardening` 18, `test:belief-recovery` 30,
`test:invalidation-sweep` 17, `test:entity-resolution` 34,
`test:benchmark-hardening` 24, `test:repo-ingest` 45.
`npm run drill:scale`: gate CLOSED (max provenance 286, sweep growth
2.04x — within the recorded 1.63x–2.26x run-to-run band). The isolated
Compose integration (`trellis-s16-integration`, host ports 0) passed
10/10 on a rebuilt image. No new Python files shipped (the Dockerfile
`COPY` line and `check_python_runtime.py` were already complete for
`trellis_workspace.py`); no defects found in existing code this
session. The natural follow-up remains owner-gated: the paired-run
probe protocol across a two-task goal, measuring whether seeded
workspaces eliminate the cross-task re-derivation the Session 15 report
names.

### July 8, 2026 — The two-task lineage probe (Session 16 follow-up, owner-approved paid run)

The owner approved the Session 16 lineage follow-up the report named:
the paired workspace protocol lifted from one task to a two-task goal,
measuring whether seeded workspaces eliminate cross-task re-derivation.
Driver `scripts/probe_workspace_lineage.py` (wrapper
`tsx scripts/probe_workspace_lineage.ts`, no npm alias, PAID, excluded
from every zero-paid suite — the single-task probe precedent). One
upstream task fetched four `archive_search` results into a workspace and
parked the snapshot; one dependent task ran twice, identical except for
lineage — seeded (real `seed_from_snapshot` + `SEEDED RUN` addendum) vs
unseeded (fresh goal workspace). Task 1 ran once so both arms faced
identical upstream state; the only variable was seeding.

**Result (n=1 per arm, directional):** all three runs answered the four
codes correctly. Goal-total external calls **4 (seeded) vs 8 (unseeded)**
— the dependent task made **0** external calls when seeded (it read the
inherited four segments, stamps intact, and re-fetched nothing) and **4**
when unseeded (it re-fetched everything task 1 had already retrieved).
The Session 15 within-task 8-vs-4 effect, confirmed at the cross-task
level lineage targets. Token cost was higher in the seeded arm (22.4K vs
16.6K input — the seed carries the four full ~4 KB segments the model
pulls into context; the unseeded arm's own re-fetches return bounded
stubs), so at this deliberately small task size the external-call
elimination and the token cost roughly trade off, exactly the wash the
Session 15 report noted within a task. Combined spend ≈48.6K input /
≈3.4K output; `reported_cost_usd` not populated by the rlms usage
summary for this model, as in Session 15. Recorded in
`docs/benchmarks/WORKSPACE_LINEAGE_PROBE_REPORT.md`. No code changes; the
lineage mechanism stays pinned zero-paid by `test:rlm-workspace` (the
`seed_from_snapshot` round-trip) and `test:agent-loop` (the real Redis
park/seed path).

### July 7, 2026 — Session 17: the promotion path (design record §6, §11 step 5)

Design record §6 is normative and shipped as specified: the
operator-gated, byte-preserving bridge from a parked Tier-3 workspace
segment to the ordinary verified ingest path — the missing middle step
of "ephemeral intake → verified substrate → compounding belief →
continuous self-correction". No API surface, no new queue, no new
Python runtime file: the operator gate is a CLI.

**The pure planner** (`src/core/promotion/plan_promotion.ts`). Takes a
parsed `WorkspaceSnapshot` (reuses `parseWorkspaceSnapshot` /
`WorkspaceSnapshotSchema` from `src/workers/workspace_scratch.ts` — the
schema is not duplicated) plus a segment id and doc key, and returns
either the exact ingest request `{docKey, content, origin}` — content
byte-verbatim, no normalization — or a typed refusal:
`truncated_segment` (a size-capped capture is NOT the source bytes;
promoting it would mint verified hashes over corrupt content),
`empty_content`, `unknown_segment` (with a bounded listing of what the
snapshot does hold), or `invalid_doc_key`. Doc keys are never invented
silently: the operator supplies one explicitly (recommended `web:<url>`
for web content — stable across refreshes, which is what makes the
update machinery cover re-fetches), and the deterministic fallback
`mcp:<server>:<tool>:<argsHash>` (from `derivedDocKey`) is printed as a
hint for non-URL tool results. Key validation is conservative:
printable, whitespace-free, ≤512 chars, not shaped like an AST hash
(the anonymous-ingest namespace), not under the reserved `repo:` prefix
(the next `repo:ingest` run would tombstone it).

**Origin traceability.** The `documents` table gains a nullable,
additive `origin JSONB` column (`ALTER TABLE ... ADD COLUMN IF NOT
EXISTS` in the idempotent bootstrap); `registerDocumentVersion` takes an
optional origin argument and `IngestRequest.origin` threads it through
`ingestDocument`, so the stamp — server, tool, argsHash, fetchedAt,
segmentId, bytes, goal/task correlation, copied verbatim from the
wrapper-owned segment stamps — commits atomically with the version row.
Every pre-existing caller is unchanged and leaves the column NULL.

**The operator CLI** (`scripts/promote_segment.ts`, npm alias
`promote`; execution shared with the drill via
`src/core/promotion/promote_segment.ts`). LIST mode (default) is
read-only: each segment's id, origin stamps, size, truncation marker,
bounded preview, and doc-key hint; a missing/expired parked snapshot is
a readable failure naming `SCRATCH_TTL_SECONDS`. PROMOTE mode
(`--segment` + `--doc-key`) echoes exactly what will be ingested (doc
key, byte count, origin) before any write, runs the UNMODIFIED verified
ingest transaction in-process (persist → read-back re-hash → membership
→ registration with origin → in-transaction Merkle diff — promotion
bypasses nothing, which is why the resulting hashes are citable), and
prints the root hash plus the block-level hashes the RLM may now cite.
Zero paid work by default (`--extract none`); `--extract changed`
requires an explicit positive `--max-blocks` budget AND
`--confirm-extraction` (the `repo:ingest` double gate). One segment per
invocation; promotion consumes PARKED snapshots only, never a live
workspace.

**Acceptance (July 7, 2026, all zero-paid).** `npm test` = 554 passing
across 62 files (was 536/61; new `plan_promotion.test.ts` — 17 cases
over refusals, key validation, verbatim content, stamp copying,
bounded listings — plus an `ingest_document.test.ts` case pinning
origin threading and the NULL default). `npm run build` and
`npm run python:check` green. New live drill `npm run test:promotion`
(41 checks): parks a drill-authored snapshot at the production scratch
key; list mode inventories it through the real CLI; missing-snapshot,
truncated, unknown-segment, empty, missing-key (with the derived-key
hint), and reserved-key refusals all exercised against real Redis with
nothing ingested; then the earned-citability loop end to end —
`write_derived_insight` citing the would-be block hash is a Provenance
Violation BEFORE promotion and SUCCEEDS with the same hash after the
CLI promotes (the real hardened write path via
`scripts/test_promotion_write.py`); the documents row carries the
origin stamp; re-promoting changed bytes under the same doc key
registers version 2, the Merkle diff orphans the v1 block, and the
captured invalidation payload driven through
`findGloballyOrphanedAstNodeIds` + `sweepOrphanedProvenance` contests
the insight with the audit trail preserved (provenance moved to
`orphanedSourceIds`), v1 dead, v2 live. Token-scoped cleanup.
Unchanged and green: `test:rlm-workspace` 83, `test:agent-loop` 35,
`test:modules` 27, `test:rlm-mcp` 86, `test:rlm-sandbox` 21,
`test:a2a` 46, `test:api-hardening` 18, `test:belief-recovery` 30,
`test:invalidation-sweep` 17, `test:entity-resolution` 34,
`test:repo-ingest` 45. `npm run drill:scale`: gate CLOSED (max
provenance 286, sweep growth 2.17x — within the recorded 1.63x–2.26x
band). The isolated Compose integration (`trellis-s17-promotion`, host
ports 0, CI's exact recipe) passed 10/10 on the rebuilt Session 17
image — including the containerized credentialed MCP fixture probe —
with the schema bootstrap applying the `documents.origin` column
inside the container. The first attempt was blocked by host disk
exhaustion (the image rebuild filled C: to 0 bytes mid-build and
crashed Docker Desktop); after the operator freed disk space the run
completed clean on the second attempt, exit 0, project and volumes
removed.

**Defect found and fixed during the session (tooling, not product):**
an early draft of the doc-key validator embedded literal C0 control
bytes in its regex character class (an editor escape-decoding
artifact); the committed source spells the class with source-level
unicode escapes, the file is verified free of control bytes, and the
unit tests pin control-character rejection behaviorally
(`String.fromCharCode`, so no raw control byte ever sits in a source
file). No pre-existing tests needed adjustment — the `documents`
INSERT statement-prefix pins in `ingest_document.test.ts` were
unaffected by the added column.

### July 8, 2026 — Session 18: the first flywheel turn, machinery (design record §11 step 6 + the §9.4 deferral)

Every prerequisite for the capability flywheel existed after Session 17
— research into origin-stamped workspaces (S14), cross-task checkpoints
(S16), operator promotion to verified substrate (S17), and the module
registry (S15) whose manifest schema already carried format-checked
`research.sourceNodeIds` — but three pieces of machinery were missing
before the flywheel could turn: research provenance was never
existence-checked, module manifests were unreachable by the
invalidation sweep (the recorded §9.4 deferral), and nothing surfaced a
contested capability to the operator. Session 18 ships all three; the
module #1 PAID authoring turn itself stays owner-gated (below).

**Research existence gate.** Registration — not prompt composition,
which stays free of any PostgreSQL dependency — verifies every cited
research hash against `ast_nodes` before any write session opens
(`findMissingAstHashes` in the new
`src/core/graph/module_registration.ts`, the Session 14
`ast_hashes_exist` discipline applied to capability provenance). A
manifest citing a well-formed unknown hash refuses the WHOLE invocation
with a bounded missing-hash listing and the offending module named;
co-registered valid modules are not written either.

**Manifest-as-graph-entity (§9.4, deferral closed).** The new operator
CLI `npm run modules:register` (`scripts/register_modules.ts`) MERGEs
each research-bearing ACTIVE manifest as one ordinary
`(:Entity {kind: 'module_manifest', name: 'module:<name>'})` carrying
`sourceNodeIds` = the manifest's research hashes plus a `moduleVersion`
stamp. The ON MATCH mirrors `applyRederivation`
(`src/core/graph/provenance.ts`) field-for-field — the
`extraction_merge.ts` discipline, so the sweep transition and
registration commute and the UNCHANGED sweep (`sweepOrphanedProvenance`)
contests a module whose promoted research is superseded, with zero sweep
changes. The `module:` name prefix (validated lowercase charset) keeps
these entities out of every retrieval path that matches user-facing
names. Registration is idempotent, operator-only (no API endpoint,
never worker startup, never reachable from a model completion), and
skips two classes deliberately: empty-research manifests (module #0 —
the entity would be unreachable by the sweep; pinned no-op) and
contested/retired manifests (re-registration is the RECOVERY transition
and must follow re-review, never precede it — a re-run can never
silently un-contest a quarantined capability).

**Contested-module surfacing.** `npm run modules:verify` (read-only)
reports each registered entity's contested state, live/orphaned research
hash counts, bounded orphaned-hash listing, recovery timestamp, and the
on-disk manifest status, with an ACTION prescription for contested
modules. The loop stays human: sweep contests → operator reads the
report → flips manifest `status` to `contested` by hand (the Session 15
loader refuses composing it) → re-review lands refreshed research →
status back to `active` → re-registration recovers the entity
(`rederivedAt` stamped, orphaned audit trail preserved). Nothing
auto-edits manifest files from graph state.

**Loader seam (no behavior change).** `readModuleManifest` and
`listModuleNames` extracted in `src/config/modules.ts`; `loadModule`
now delegates to the former and is behavior-identical (the `test:modules`
sha256 composed-prompt pin did not move).

**Verification (all commands run, zero paid calls, no external
network).** Offline: `npm test` = **568 passing across 63 files**
(baseline 554/62; +14: the registration planner/param/refusal units in
`module_registration.test.ts`, and the `readModuleManifest`/
`listModuleNames` seam cases in `modules.test.ts`). `npm run build`,
`npm run python:check`, `docker compose --profile test config --quiet`,
and `git diff --check` pass. New live suite:
`npm run test:module-lifecycle` = **35 checks**: fixture research
promoted through the REAL Session 17 path (parked snapshot →
`planSegmentPromotion` → `promoteSegment`, policy `none`); a temp-dir
module citing the promoted hash registered through the real CLI; the
existence-gate refusal matrix over real PostgreSQL (unknown hash refused
with bounded listing, co-registered valid module not written); module #0
no-op pinned; MERGE idempotency (identical full entity state on re-run,
before and after recovery); the §9.4 loop live — re-promotion of changed
bytes under the same doc key orphans the research hash, the captured
invalidation payload driven through `findGloballyOrphanedAstNodeIds` +
`sweepOrphanedProvenance` contests the module entity with the audit
trail preserved, verify mode reports it, the flipped manifest is refused
composition AND skipped by re-registration, and re-registration with the
refreshed hash recovers per the state machine. All state token-scoped
and cleaned up. Unchanged and green: `test:promotion` 41,
`test:rlm-workspace` 82 (the 83 recorded by Sessions 16/17 was a
miscount — 82 PASS lines observed on the unmodified Session 17 master
too, drill green either way), `test:agent-loop` 35, `test:modules` 27
(the composed-prompt sha256 pin did not move), `test:rlm-mcp` 86,
`test:rlm-sandbox` 21, `test:a2a` 46, `test:repo-ingest` 45,
`test:benchmark-hardening` 24, `test:entity-resolution` 34,
`test:api-hardening` 18, `test:belief-recovery` 30,
`test:invalidation-sweep` 17. `npm run drill:scale`: gate CLOSED (max
provenance 286, sweep growth 1.80x — within the recorded 1.63x–2.26x
band). The isolated Compose integration (`trellis-s18-lifecycle`, host
ports 0, CI's exact recipe) passed 10/10 on the rebuilt image, project
and volumes removed.

**Defect found and fixed during the session (drill authoring, not
product):** the drill's first draft indexed the captured invalidation
payloads assuming the version-1 promotion queues one — it does not (a
first version has no prior root and queues no invalidation), so the
re-promotion's payload is `capturedSweeps[0]`, not `[1]`. Fixed with a
comment recording why.

**The module #1 paid authoring turn (owner-gated; proposed, not run).**
With the machinery green, the recorded proposal for the first real
flywheel turn: the owner picks the topic; one research goal (2–3 tasks,
MCP web-search or an owner-supplied corpus) into a goal workspace;
operator promotion of the load-bearing segments (`npm run promote`); one
authoring run drafting `modules/<name>/module.json` + brace-free
`addendum.txt` + a zero-paid drill citing the promoted hashes as
`research.sourceNodeIds`; landed as an ordinary human-reviewed PR, then
`npm run modules:register`. Estimated spend, grounded on the measured
lineage probe (a two-task goal ran ~32k input / ~2.3k output gpt-5.4
tokens per arm): roughly 100k–200k input plus 10k–20k output tokens
end-to-end — same order as the two paired probes combined. Awaiting
per-run owner approval.

**Still open:** repository-scale extraction prerequisites (the next
sequencing row); conditional 3.3 #4 migration behind its unchanged
trigger; frontend deployment (unscheduled 3.3 #5 residue); T13's
migration-dependent hash preimage.

### July 9, 2026 — Module #1 (workspace-discipline): the first paid flywheel turn

The Session 18 machinery was exercised end-to-end with a real, owner-approved
paid authoring run — the first turn of the capability flywheel (design record
§11 step 6). Owner picked the topic (workspace discipline) and authorized the
spend; no web-search MCP server is configured, so the research source was the
owner-supplied-corpus path the design permits.

**Phase 1 — research promoted (zero paid).** Two documents assembled from
Trellis's own workspace research — design record §4 (the workspace contract)
and the two measured probe reports — were parked as workspace segments and
promoted through the real `npm run promote` CLI (extraction `none`):
`research:trellis/workspace-discipline/contract` (root
`23637ac1…2293f1b`, 14 blocks) and `research:trellis/workspace-discipline/evidence`
(root `976f62ce…8098fe99`, 10 blocks) — 24 citable AST block hashes in
`ast_nodes`.

**Phase 2 — paid authoring run.** `trellis_agent.py --query <authoring brief>
--max-iterations 12`, model `gpt-5.4-2026-03-05`. Result envelope `status: ok`
(no protocol violation — 7 `get_ast_texts` calls read the promoted corpus).
Spend: **160,270 input / 7,827 output tokens** across 14 model calls, 44 tool
calls, 99.8 s — within the approved envelope. The run drafted the module
purpose, a brace-free `WORKSPACE DISCIPLINE PROTOCOL` addendum (1,729 bytes,
preserved essentially verbatim — a faithful synthesis of the corpus), a
research-hash list, and a drill spec.

**Operator correction (the gate earning its keep).** The run's *self-reported*
`research.sourceNodeIds` were NOT the promoted corpus: it surfaced unrelated
real TypeScript code blocks (entity-snippet-fetch code) through 21
`vector_search` calls and cited those. Those hashes exist in `ast_nodes`, so
the existence gate alone would have passed them — this is precisely the
"provenance laundering" residual design record §10 names (a real hash cited
for content the claim did not come from). The operator replaced the citations
with the actual 24 promoted corpus hashes before landing. Recorded in
`modules/workspace-discipline/RESEARCH.md`. This is why module landing is
operator-gated and nomination is prose: the human verifies cited provenance is
the provenance the capability actually derives from.

**Phase 3 — landed.** `modules/workspace-discipline/` (manifest citing the 24
promoted hashes, `status: active`, protocol-only; addendum; RESEARCH.md
provenance note). Its zero-paid acceptance extends `npm run test:modules`
(27 → 33 checks: module #1 loads, is brace-free and titled, composes after
module #0 when selected, stays brace-safe, and is NOT in the default selection
— the byte-identical pin is untouched, still `abb945a6…f9b2`). Registered live:
`npm run modules:register -- --module workspace-discipline` created
`module:workspace-discipline` (24 live research hashes, uncontested — the
existence gate passed all 24); `npm run modules:verify` reports it clean. The
module is NOT added to the default `TRELLIS_MODULES` selection; it composes
only when an operator selects it.

**Verification:** offline `npm test` 568/63 (unchanged — the module is
config/data, not code); `npm run build` and `npm run python:check` pass;
`npm run test:modules` 33/33. The flywheel has turned once: research → promote
→ author → gate → register, with the sweep now able to contest this capability
if its promoted research changes.

### July 9, 2026 — Grounded-authoring design record (module #1 follow-up)

The module #1 review surfaced that the turn's provenance-laundering
miscitation was structural, not incidental: authoring ran on the general
research agent (whole-database `vector_search`/`run_cypher`, self-reported
citations) under a brief that pre-stated the target directives — so access,
attribution, and derivation grounding all failed or went unproven, and only
the operator gate caught it. The remediation is designed, not yet
implemented: `docs/architecture/GROUNDED_AUTHORING.md` (PROPOSED) — a
kernel-owned `--mode author` scoped to a seeded read-only corpus workspace
with a `TRELLIS_DRAFT` contract, harness-pinned `research.sourceNodeIds`
(the model never chooses hashes; registration's existence gate unchanged),
a fixed harness-composed authoring template (sources in, protocol out), and
a derivation gate on the sampled-verifier rails (v1 deterministic anchor
coverage, zero-paid, joining the module acceptance drill; embedding and
narrow-entailment tiers class-gated later — note the measured constraint
that promoted-with-`none` blocks carry no embeddings, 0/50 on the module #1
corpus). No invariant is touched; the operator gate stays the backstop.
Phase 0 (procedure only) is effective immediately: authoring briefs must
not pre-state directives, and citations are pinned by the operator from
promotion output.

**Owner direction, recorded the same day (July 9, 2026):** the
implementation JUMPS the queue — grounded authoring (Phases 1–2) is
Session 19 (§4 row 1); repository-scale extraction prerequisites move to
row 2 (moved, not dropped). The HANDOFF was regenerated accordingly in the
same PR, and the §0 loop protocol gained a permanent step 5 (the
event-loop rule): work landing AFTER a session's handoff regeneration —
an owner-approved paid run, a follow-up fix, a new design record —
re-runs step 3's objective selection before handing off; pointer edits
are not a substitute, and a defect discovered in a pathway the flywheel
depends on satisfies the jump-the-queue rule even when an existing gate
contained it. Origin of the rule: this very sequence — the laundering
finding and its design record initially landed as standing-item pointers
while the handoff's §3 still named the pre-finding objective.

### July 9, 2026 — Session 19: grounded authoring (GROUNDED_AUTHORING.md Phases 1–2)

Implemented the kernel authoring mode and its gates so the flywheel's
authoring PATHWAY can no longer launder provenance the way module #1 did.
Everything points existing rails at authoring; no new trust machinery, no
new HTTP/A2A surface, no new queue, no Postgres DDL, no manifest schema
change (`kernelCompat` stays 1). Zero paid LLM calls and zero external
network in acceptance.

**The mode (`src/rlm/trellis_agent.py --mode author`, D1).** A distinct,
DB-free branch: `custom_tools` is exactly `{trellis_workspace}`; no
`TrellisPostgres`/`TrellisNeo4j`/MCP is constructed, so the process opens
no database connection. It seeds the promoted corpus, composes an
author-specific system prompt (rlms base + a brace-free author addendum +
the workspace surface + the driver's template), and emits a
`TRELLIS_DRAFT:` envelope (`purpose`/`addendum`/`gapNotes`, no hashes) —
never `TRELLIS_RESULT`/`TRELLIS_PROTOCOL_VIOLATION` (a draft is supposed to
make zero DB calls). Setup factored into `build_author_tools` /
`build_author_system_prompt` / `extract_draft_envelope` (testable without a
completion or a DB). `--mode research` (and no flag) is byte-identical to
before — the `test:modules` composed-prompt sha256 pin did not move.

**Pinned attribution (D4/D5, Layer 2).** `src/core/authoring/corpus.ts`
reads a promoted doc's current-version extraction blocks (hash + text)
straight from `ast_nodes`; `src/core/authoring/seed.ts` maps them
block-aligned into a `WorkspaceSnapshot` (one segment per block, content
verbatim, `origin.argsHash` = the block hash's first 16 hex — deterministic,
auditable, and structurally never a 64-hex provenance token). The driver
pins `research.sourceNodeIds` = the corpus block set, sorted and deduped
(D3 flat v1); the model contributes only prose.

**The template (§6, Layer 3).** `src/core/authoring/template.ts` — a
byte-pinned kernel constant composed from exactly the bounded topic and the
doc keys (sources in, protocol out; declare gaps, never invent). Pre-stating
directives is structurally impossible: the operator's only free text is the
topic (bounded, single-line, brace-free). Brace-free so it transits rlms
`.format()`.

**The anchor gate (§7 v1, D2).** `src/core/authoring/anchors.ts` extracts
corpus-specific anchors (numeric comparisons like `8 vs 4`/`0 vs 4`,
hyphenated mechanics like `build-new-then-rebind`, and distinctive
vocabulary with stopwords filtered) and scores draft coverage.
`ANCHOR_COVERAGE_THRESHOLD = 0.3` (kernel constant, unit-pinned): measured a
derived draft covers ~0.69–0.83, a corpus-blind generic draft 0.0; it fails
closed on an unanchorable corpus. Joins the module drill, so §9.4's sampled
re-verification re-runs it for free.

**The draft scanner.** `src/core/observability/rlm_draft.ts`, sibling of
`RlmResultScanner`: pure, bounded, Zod-validated `{purpose, addendum,
gapNotes}`; a draft carrying ANY 64-hex token is REFUSED (not parsed) — the
pen stays with the harness.

**The driver.** `scripts/author_module.ts` (`npm run modules:author`), in
the `promote`/`modules:register` house style. Reads the corpus, composes the
template, builds+budget-checks the seed, and: default echoes the plan
(corpus, template sha256, cost estimate) and refuses to spawn without
`--confirm-paid`; `--draft <file>` assembles from a saved envelope (the
zero-paid drill path, stub-replay precedent); `--confirm-paid` spawns the
paid author run and collects the draft. Assembly pins the manifest, writes
`addendum.txt` + a harness-generated `RESEARCH.md`, and validates via
`readModuleManifest`/`loadModule`. It NEVER registers, NEVER lands, and
refuses to author over an existing directory (Guardrail 4).

**Refinement recorded in the design record §12.1:** the seed budget is
enforced in the driver (`assertSeedWithinBudget`) as well as at the Python
seed, so `--draft` is gated identically to the paid path.

**Acceptance (all green).**

```
npm test                     # 608 passing across 69 files (was 568/63; +40 offline)
npm run build                # pass
npm run python:check         # pass
docker compose --profile test config --quiet   # pass
# Isolated Compose integration (project trellis_s19_ci, host ports 0): 10/10 PASS,
# torn down with --volumes; the dev stack left intact.
npm run test:module-lifecycle    # 60 PASS (was 35; +25 — authoring end-to-end §10–§11)
npm run test:modules             # 43 PASS (was 33; +10 author-mode; sha256 prompt pin UNMOVED)
npm run test:promotion           # 41 PASS
npm run test:rlm-workspace       # 82 PASS
npm run test:rlm-mcp             # 86 PASS
npm run test:rlm-sandbox         # 21 PASS
npm run test:agent-loop          # ALL CHECKS PASSED
npm run test:a2a                 # ALL CHECKS PASSED
npm run drill:scale              # gate CLOSED, max provenance 286, sweep growth 2.05x
npm run test:repo-ingest         # all checks passed
npm run test:benchmark-hardening # all checks passed
npm run test:entity-resolution   # all checks passed
npm run test:api-hardening       # all checks passed
npm run test:belief-recovery     # all checks passed
npm run test:invalidation-sweep  # all checks passed
git diff --check                 # clean
```

New offline suites (join `npm test`): `template.test.ts` (byte pin, topic
bounds, composition), `corpus.test.ts` (blocksFromRoot), `seed.test.ts`
(block-aligned mapping, argsHash prefix, schema-valid), `anchors.test.ts`
(extraction + coverage + threshold + module-#1 regression anchors),
`assemble.test.ts` (pinned sorted/deduped `sourceNodeIds`, loader-valid
directory), `rlm_draft.test.ts` (well-formed/hash-refused/size-cap/malformed).
`test:module-lifecycle` §10–§11 drive the REAL driver: promote a fixture
corpus → `--draft` assemble → register (existence gate) → §9.4 sweep contests
the authored entity; negatives — below-threshold refuses, hash-bearing
refuses, over-budget refuses, plan-only writes nothing.

No defects found in existing code during the session. Module #1's committed
artifacts were left untouched (the historical record of the pre-mode
pathway). The next paid authoring turn (module #2) is owner-gated and NOT
part of this acceptance; it should pick a corpus chosen for
anchor-testable specificity (design record §8).

**Next objective (§4 row 1): repository-scale extraction prerequisites** —
scanner test/fixture exclusion plus a code-tuned extraction prompt with
generic-identifier suppression, per the recorded pilot findings. HANDOFF
regenerated accordingly in this PR.

### July 9, 2026 — Provenance-citation A/B eval + a markdown-read bug fix (Session 19 follow-up)

An owner-approved paid eval (~$10 total; each run well under the $5/run
ceiling) settled whether anything reliably reduces citation laundering
(citing a real hash for a claim its bytes do not support). Full write-up:
`docs/benchmarks/PROVENANCE_CITATION_AB_REPORT.md`; design-record update:
GROUNDED_AUTHORING.md §12.2.

**Findings (isolated ground-truthed traps, pressure sweep, persisted-state
measurement):** laundering is **incentive-driven** — 0% in a neutral task,
but present the moment the task rewards over-citing ("cite ≥N blocks" when
only one supports the answer: baseline 100% at min-cite 2, 67% at min-cite
3). Structural checks do **not** catch it: the Session 14 existence check
passes it, and a readership gate is blind (`cited-but-unread = 0` in 100% of
laundered runs — the model reads the decoy then cites it). A prompt
"discipline" module is unreliable (0–100% across conditions). The **only**
reliable mechanism is the semantic **entailment** check (the §7 v3 tier):
as a post-hoc judge it flags exactly the laundered citations, and as an
inline gate (`TRELLIS_CITATION_ENTAIL`, prototyped, off by default) it
refuses unsupported citations so **0% laundering persists at every
pressure**. Cost ~1.5–2×; under an impossible over-citation demand it makes
the model write nothing rather than launder. **Standing design principle
(new):** never reward citation *count* anywhere; v3 entailment stays
class-gated/sampled for where the incentive cannot be removed.

**Instrumentation (all opt-in, off by default, production byte-identical):**
`TRELLIS_CITATION_AUDIT` (per-run read/search/cited hash sets),
`TRELLIS_CITATION_HINT` (readership gate — measured ineffective),
`TRELLIS_CITATION_ENTAIL` (semantic gate — the working mechanism), in
`src/rlm/trellis_tools.py` + `src/rlm/trellis_agent.py`. Experiments:
`scripts/exp_citation_ab.ts` (retrieval trap + `--min-cite` pressure sweep +
post-hoc entailment judge), `scripts/exp_citation_metadata.ts`.

**Bug found and FIXED (`get_ast_texts` / `vector_search`).** Both read
`data->>'content'`, which is NULL for markdown / container blocks
(paragraph/heading/listItem — their text lives in child nodes). Because the
`/ingest` API and the Session 17 promotion path both parse markdown, the RLM
could not read the text of markdown documents or promoted research it is
meant to cite — a provenance defect in a provenance system. Both tools now
reconstruct text from the stored node (`_node_text`, mirroring
`traverse.ts nodeText`); content-bearing blocks (OOLONG/unstructured) are
unchanged. Unit-pinned in `npm run test:rlm-workspace`.

Acceptance (all green): `npm test` 612/70, `npm run build`,
`npm run python:check`, `test:rlm-workspace` (86, +`_node_text` checks),
`test:rlm-sandbox` (21), `test:modules` (43, sha256 pin unmoved),
`test:module-lifecycle` (60). The next objective (§4 row 1, repository-scale
extraction prerequisites) is unchanged — this late work fixed its own defect
and did not surface one that jumps the queue.

### July 9, 2026 — Owner directive: the self-editing ladder is pruned (docs revision)

Owner directive, recorded verbatim in substance: *Anthropic edits Claude
Code's own codebase with Claude Code. Trellis is no different — it can work
on anything loaded into the REPL, including its own codebase. There are no
forbidden rungs. Prune the L0–L3 ladder in favor of a content pool and
standard industry-wide permissions for editing. The default state of
Trellis's environment is outside the REPL, but the user MUST be able to
implement L1/L2-class changes through Trellis.*

**What changed (docs only; zero code):** design record
`WORKSPACE_AND_MODULES.md` §7 rewritten (the L1 FORBIDDEN / L2 REJECTED
verdicts are withdrawn; self-editing = content pool + standard permissions;
the between-runs-through-source-control edit boundary and the mid-run
in-memory mutation cautions survive as engineering facts, not prohibitions);
§8 reframed (kernel/userspace is a packaging distinction, not a permission
hierarchy — kernel changes land as ordinary reviewed commits, which Trellis
may author); §13 exclusion rephrased accordingly. `GLOSSARY.md`: the
Capability-ladder entry replaced by Content pool + Self-editing; Kernel and
Userspace entries revised. `GROUNDED_AUTHORING.md`: §3, the §7 tier table
kernel row, and D5 revised (kernel = ordinary code review, outside the
module path). `HANDOFF.md`: guardrail 5 revised; the Session 13 historical
entry annotated. `COLLABORATOR_BRIEFING.md` aligned.

**Nothing needed restoring from a past branch:** the prohibition was
doctrine-only — no code ever enforced it, and the enabling surfaces already
exist (whole-codebase ingestion reads Trellis's own repo as verified AST
bytes since Session 8; the operator-owned MCP registry is the vehicle for
file/git write tooling since Sessions 10–12).

**Unchanged:** the runtime data-trust rails (the Session 14 write path,
promotion, module registration/composition gates) — those govern what enters
the belief graph, not who may edit code. Gate machinery stays kernel
constants at runtime (never env-tunable, never payload/completion-selectable);
changing it is now explicitly an ordinary reviewed commit.

**Candidate session (owner-schedulable): self-hosted editing enablement** —
the first supervised Trellis-edits-Trellis exercise: operator configures a
file/git MCP server against a checkout on a branch, the RLM authors a small
real change (candidate: a docs or test improvement), and it lands through an
ordinary reviewed PR — the L1/L2-class proof, analogous to module #1 proving
the flywheel. Not scheduled; Session 20 (extraction prerequisites) remains
the next row.

### July 9, 2026 — Core pillar ratified: code-mediated text (DDD; docs only)

From the collaborator's line-editing exchange (pandas as a line-store; the
localization-failure diagnosis of edit thrash) and its correction cycle, the
owner ratified a core pillar, recorded document-first per DDD as
`docs/architecture/CODE_MEDIATED_TEXT.md`: **the model never counts, and
the model never copies.** Owner's formulation, verbatim in substance:
*"Ingestion = pandas. Edits = pandas. No direct edits. Only code edits.
Rigidly. We get a giant context window that way."*

The pillar: the RLM handles all text through queryable REPL structures;
locations are engine-computed and returned by query (transient handles);
existing bytes are moved by code at computed addresses with hash-guarded
write-backs, never re-typed through attention; the model authors only
genuinely new text plus the code that manipulates everything else.
Localization error (edit thrash) and transcription error (the laundering
channel from the provenance-citation eval) are the same pathology —
attention doing code's job. Consequence: effective context bounded by REPL
memory, not the attention window. Lines locate, blocks mean. Enforcement
posture per the eval's lesson 7: tooling shape enforces, prompts reinforce.

**Alignment sweep (this entry's PR):** new record
`CODE_MEDIATED_TEXT.md`; HANDOFF §1 pillar bullet + permanent guardrail 14;
GLOSSARY entries (code-mediated text, engine-computed address, transient
frame, hash-guarded write); WORKSPACE_AND_MODULES §7 mechanics cross-ref;
GROUNDED_AUTHORING §12.2 generalization note; COLLABORATOR_BRIEFING
postscript + reading list. Zero code changes — the pillar's existing
instances (workspace capture stubs, harness-pinned citations, by-reference
orchestration, Merkle-diff ingestion, the `_node_text` reconstruction) all
predate it; the record names them and drives the rest.

**Follow-ups the record drives (owner-schedulable, in its §6):** (1) the
self-hosted editing toolkit — load/locate/splice/write_back with digest
guards, the enablement session's edit primitive; (2) a kernel prompt
revision teaching the discipline for research runs (a deliberate
composed-prompt sha256 pin move, its own commit); (3) the paired-run
effective-context probe (paid, extends the workspace-probe series) to turn
the giant-context claim into a number; (4) module #1 v2 through grounded
authoring (its "reconstructing stored text" line predates the pillar).
Session 20 (extraction prerequisites) remains the next scheduled row.

### July 9, 2026 — Owner re-sequencing + the measured structure-selection study

**Re-sequencing (owner directive):** Session 20 is now the code-mediated-
text follow-ups — the editing toolkit (pillar §6.1) and the kernel prompt
revision (§6.2); repository-scale extraction defers to §4 row 2 (deferred
again, not dropped). HANDOFF.md regenerated accordingly (§3–§8 replaced at
full concreteness: the `trellis_textedit` holder design — operator-owned
`TRELLIS_EDIT_ROOT` gating with byte-identical-when-unset pins, engine-
computed `locate`, staged `splice`, digest-guarded `write_back`, Zod/Python
twin bounds, `test:textedit` drill — and the §6.2 pin-move protocol).

**Structure-selection study (pillar §7, measured in the agent environment;
Python 3.13.1, pandas 2.2.3, pyarrow 24.0.0, polars 1.34.0 — the latter two
already present transitively):** pandas has NO line-count limit relevant to
Trellis; the constraint is memory, and discomfort begins around 10M rows
(1.1 GB object dtype / 708 MB Arrow; 1.1–1.5 s substring queries) — three
to five orders of magnitude above real Trellis frames. The whole repository
is 74,115 lines / 2.9 MB → a 13 MB frame with 16 ms queries; the largest
file (2,231 lines) locates in 0.5 ms and splices in 0.02 ms as a plain
list. Normative tiering recorded in pillar §7: list-of-lines for
single-file edit frames, pandas (object dtype) as the relational default
(model fluency > raw speed at these scales), `string[pyarrow]` past ~1M
lines (halves memory, ~25% faster), polars documented as the unneeded
escalation tier (5.9× faster at 10M: 247 ms vs 1,465 ms). Toolkit byte
caps align with the workspace bounds (4 MiB default / 32 MiB cap).

### July 9, 2026 — Session 20: the code-mediated editing toolkit + the kernel prompt revision (§4 row 1, pillar §6.1/§6.2)

The pillar's two implementation follow-ups, per the owner's July 9
re-sequencing. Two commits: the toolkit (everything byte-identical when
unconfigured) and the kernel prompt revision (the one deliberate global
change, with the pin recomputed in the same commit).

**The editing toolkit (`src/rlm/trellis_textedit.py`, pillar §6.1).**
A `TrellisTextEdit` holder injected via rlms `custom_tools` as
`trellis_textedit` ONLY when the operator sets `TRELLIS_EDIT_ROOT` —
config fails fast when the root is not an existing directory, the worker
forwards root + bounds through `buildAgentEnv` exactly when configured
and strips raw inherited values otherwise, and a queue payload carrying
anything textedit-shaped is ignored (all unit-pinned). The surface is
the pillar's §2 as tooling shape: `load` (held list-of-lines frame +
load-time sha256), `lines` (bounded half-open slices), `locate`
(engine-computed addresses for content/regex queries, bounded hits +
true total), `splice` (staged replacement at a computed range; list of
newline-free strings only), `diff` (bounded unified review), `revert`,
`drop` (frees a frame slot — the budget release valve, a §6.1
refinement recorded in the pillar record), and `write_back` (re-hashes
the CURRENT disk bytes; mismatch RAISES and writes nothing; else temp +
rename atomically). Frames are `text.split("\n")` lists: an unedited
round-trip is byte-identical and moved CRLF lines keep their bytes
verbatim. Containment is resolve-then-commonpath inside the real root —
`..`, absolute/rooted paths, and symlink escapes are refused before any
I/O. Bounds are Zod + Python twins (`TRELLIS_TEXTEDIT_MAX_FILE_BYTES`
4 MiB/32 MiB, `TRELLIS_TEXTEDIT_MAX_FILES` 16/64); slice (200), hit
(40), and diff (400) caps are kernel constants. Telemetry adds
counts-only `textedit_ops`/`textedit_files`/`textedit_writes`; toolkit
ops never count as database tool calls. A brace-free TEXTEDIT addendum
composes only when configured. Git stays out: landing is a human PR.

**The kernel prompt revision (pillar §6.2, own commit).** The candidate
wording adopted verbatim into `TRELLIS_ADDENDUM_BASE` (locate by query,
splice instead of retype, author only new text); the `test:modules`
composed-prompt pin moved `abb945a6…f9b2` → `170e9f7e…67e9`, recomputed
in the same commit, and the pin constant (renamed
`COMPOSED_SYSTEM_PROMPT_SHA256`) now records its move history in place.
The relative prompt pins in `test:rlm-workspace` held unmoved.

**Defect found and fixed during the drill:** Python 3.13 `ntpath.isabs`
treats a bare leading slash as drive-relative, not absolute, so
`/etc/passwd` fell through to the commonpath backstop (still refused,
wrong message). Rooted paths are now refused explicitly as absolute on
every platform.

**Acceptance (all green, July 9, 2026):** `npm test` 621/71 (baseline
612/70: + `textedit_bounds.test.ts`, extended `rlm_job.test.ts`);
`npm run build`; `npm run python:check` (trellis_textedit.py joined the
Dockerfile COPY line and the runtime check); `docker compose --profile
test config --quiet`; the new `npm run test:textedit` (81 checks:
bounds twins, bounded reads, staged splices, byte-compare write_back,
the digest guard with disk-untouched proof, containment incl. a live
symlink escape, budgets, gating byte-identity, LocalREPL persistence,
counts-only telemetry); `test:modules` (43, pin moved wittingly);
`test:module-lifecycle` (60); `test:promotion` (41);
`test:rlm-workspace` (86); `test:rlm-mcp` (86); `test:rlm-sandbox`
(21); `test:agent-loop` (35); `test:a2a` (46); `test:repo-ingest` (45);
`test:benchmark-hardening` (24); `test:entity-resolution` (34);
`test:api-hardening` (18); `test:belief-recovery` (30);
`test:invalidation-sweep` (17); `npm run drill:scale` (gate CLOSED at
286; sweep growth 1.70x, inside the recorded band); the isolated
Compose integration as project `trellis_s20_ci` (10 assertions, torn
down with `--volumes`); `git diff --check` clean.

**Standing owner-gated proposals (unchanged, not run):** the supervised
Trellis-edits-Trellis proof run (operator sets `TRELLIS_EDIT_ROOT` at a
branch checkout; one small real edit lands as a reviewed PR); the
effective-context probe (pillar §6.3, ≤$5); module #1 v2 (§6.4); the
module #2 authoring turn. Next scheduled row: the repository-scale
extraction prerequisites (§4 row 2).

### July 9, 2026 — The RLM reframing: documentation identity overhaul (owner-directed; same PR as Session 20)

Owner directive, after Session 20's close-out: Trellis's documentation
still introduced the system as "provenance-preserving GraphRAG," a
description the last twelve sessions outgrew — the graph-and-provenance
machinery is now the SUBSTRATE (Tiers 1–2 of the trust model), and the
system is the **Recursive Language Model runtime** standing on it. The
docs were rewritten to lead with what the system is, not what it grew
from.

**The synthesis the new framing records (root README, "What Trellis
is"):** five layered commitments — (1) the substrate (content-addressed
Merkle ASTs + beliefs carrying `sourceNodeIds`, with Merkle-diff →
sweep self-correction, measured at recall/precision 1.000); (2) the RLM
execution model (context is a database, not a scroll: the model reaches
stores, workspace, tools, and frames through code; attention holds
queries, handles, and bounded previews); (3) the trust pipeline (three
tiers, permanence earned only upward through operator-gated promotion,
provenance as structural enforcement at the single write path); (4) the
two flywheels — knowledge (derive once, cache with provenance, reuse;
measured) and capability (modules the RLM authors under grounded
authoring, registered as graph entities whose research basis the
UNCHANGED sweep contests — the system's capabilities are beliefs under
the same epistemology as its facts); (5) the code-mediated-text pillar
(never counts, never copies — localization error and transcription
error are one pathology). Plus the standing answer to "why not
GraphRAG": RAG retrieves to augment generation and is stateless between
questions; Trellis's unit of progress is a verified belief or verified
capability added to a compounding, self-correcting store, and
everything whose evidence dies — instructions included — is contested.

**Files changed (docs only; zero code, zero pins):** root `README.md`
(full rewrite: identity, the five commitments, the GraphRAG inversion,
the DDD authority chain, architecture-in-one-pass; every operational
section preserved verbatim-in-substance and regrouped under Getting
started / Feeding the substrate / Running the RLM / Working memory and
the trust pipeline / Modules / Editing / Benchmarks / Verification —
`test:textedit` added to the live-check list, which had been missed in
the Session 20 pass); `docs/README.md` (reading order rewritten:
orientation → living doctrine → measured evidence → operations →
product history, with each document's status named); `docs/GLOSSARY.md`
(new canonical **Trellis** entry); `HANDOFF.md` line 1 and
`TRELLIS_ROADMAP.md` §1 opening (identity lines updated);
`docs/COLLABORATOR_BRIEFING.md` Altitude −1 (same); status banners on
the three MVP-era records (`ARCHITECTURE.md`, `SYSTEM_ARCHITECTURE.md`,
`TECHNICAL_SPEC.md` — historical, preserved, living model pointed to).
`docs/product/*` and the dated benchmark reports are deliberately
untouched: they are the record, and DDD preserves the record.

**§0 step 5 re-check:** doctrinal work only — no defect surfaced, no
queue jump; Session 21 (extraction prerequisites) stands as handed off.

### July 9, 2026 — Owner directive: the pillar's remaining follow-ups are APPROVED; Session 21 re-pointed (readiness verified)

The owner approved the two formerly owner-gated follow-ups of the
code-mediated-text pillar and directed that the next session execute
them, with the Frankenstein corpus as the measurement substrate:

1. **The effective-context probe** (pillar §6.3, paid, ≤$5/run standing
   cap): a paired-run measurement — discipline-on vs discipline-off over
   the same question set on a corpus several times a practical working
   window — scoring correctness, bytes-through-attention, turn count,
   and spend. The giant-context claim becomes a number.
2. **Module #1 v2** (pillar §6.4, paid): re-author workspace-discipline
   through the grounded-authoring mode with the pillar record in its
   promoted corpus, retiring the pre-pillar "reconstructing stored text"
   mitigation language.

Extraction prerequisites defer a third time (row 2; deferred, never
dropped). `HANDOFF.md` §3–§8 regenerated for the new objective at full
concreteness.

**Readiness verification (run this day, zero-paid, all green):** pandas
2.2.3, pyarrow 24.0.0, and polars 1.34.0 import in the agent Python
(3.13.1); a list-of-lines/pandas frame round-trips bytes exactly and
answers substring queries by engine-computed index; the composed kernel
prompt carries the Session 20 CODE-MEDIATED TEXT hard-rule block;
Frankenstein (~440 KB) fits every relevant bound (`INGEST_MAX_BODY_MB`
5 MB, workspace 4 MiB default, textedit frame 4 MiB); the RLM can read
markdown block text (`_node_text`, pinned since the Session 19
follow-up). Hardening landed with the check: `pandas` joined the
`check_python_runtime.py` import list — it ships transitively via
`unstructured` but is now pillar-load-bearing, so its absence must fail
the runtime check, not a paid run (`npm run python:check` green).

### July 10, 2026 — Session 21: the pillar's measurements (§4 row 1; pillar §6.3 + §6.4) — the redo

**Context.** A first Session 21 attempt landed as PR #56 on July 9–10 and
was discarded wholesale by the owner the same day (revert PR #58; master
returned byte-identical to the Session 20 tree). This session is the
owner-directed full redo — same ratified objective, fresh implementation
in the repository's own idiom; nothing from the reverted tree was reused.
Both paid runs re-approved; actuals below.

**(a) The Frankenstein corpus (zero-paid).** `data/frankenstein.txt` is
Project Gutenberg #84 (the 1831 text, public domain), trimmed
deterministically — CRLF→LF, everything strictly between the
`*** START/END OF THE PROJECT GUTENBERG EBOOK ***` marker lines, blank
edge lines dropped, single trailing newline — 421,536 bytes, sha256
`bde72e69…34a8`, structure Letter 1–4 + Chapter 1–24. `.gitattributes`
marks it `-text` (this machine's `core.autocrlf=true` would otherwise
rewrite the working tree and silently move every ground truth); the
byte-stability (sha + length + LF-only) is unit-pinned. Ingested through
the ordinary verified path (`tsx scripts/exp_effective_context.ts
--ingest`): `book:gutenberg-84:frankenstein` version 1, root
`a2f9c97c…4439`, 1,708 nodes, 796 extraction-eligible blocks, policy
`none`, 0 queued; three sampled blocks (first/middle/last) read back
byte-exact through the REAL Python `get_ast_texts`; re-running the
identical ingest registered version 2 with the SAME root and an empty
Merkle diff (added 0 / orphaned 0 / retained 1,687) — the auditable
no-op. The corpus is deliberately durable substrate, not drill residue.

**(b) The discipline-off arm (`TRELLIS_EXP_OMIT_CMT`).** The §6.2
CODE-MEDIATED TEXT block became the named kernel constant
`CODE_MEDIATED_TEXT_BLOCK`; `TRELLIS_EXP_OMIT_CMT=1` composes the base
without exactly it. Unset, the composed prompt is byte-identical
(`COMPOSED_SYSTEM_PROMPT_SHA256 = 170e9f7e…67e9`, unmoved); set, it is
byte-identical to the RECORDED pre-Session-20 kernel
(`abb945a6…f9b2` — Session 20's only kernel change was adding the block,
re-proven on every run). Both pinned by the new `test:modules` [7]
(subprocess re-import; also pins default-carries-the-block-exactly-once
and default-minus-block equality). `buildAgentEnv` deletes the flag
unconditionally — it has no config field at all, so no worker can ever
forward it (`rlm_job.test.ts` pins the strip); only the experiment
runner's own spawn env sets it. It appears in no default, worker, or
Compose configuration and deliberately NOT in `.env.example`.

**(c) The effective-context probe (pillar §6.3, PAID — MEASURED).**
`scripts/exp_effective_context.ts` (the `exp_citation_ab.ts` house
style): plan-only default with a printed estimate, `--confirm-paid` to
run, `--max-spend-usd` cumulative abort (default the standing $5). Six
kernel-fixed questions, ground truth COMPUTED from the committed file by
`src/benchmarks/effective_context/ground_truth.ts` (pure; 17 unit tests
pin fixtures AND the committed-corpus answers): counts ("Justine"=55,
"Ingolstadt"=16), exact quotes (two sentences), localization (Chapter 5,
Letter 4). Addressing hands the agent only the document's root hash; a
representation-invariance check (file truths = stored-reconstruction
truths — the root text glues paragraph boundaries) runs before any
spawn. Command: `tsx scripts/exp_effective_context.ts --confirm-paid`;
12/12 runs completed, **$0.7320 actual** (estimate printed ≈$1.44).
Results (`docs/benchmarks/EFFECTIVE_CONTEXT_PROBE_REPORT.md`; n=6/arm,
directional): correct 5/6 (on) vs 6/6 (off); median input 7,870 vs
14,724 tokens; worst-run input 26,586 vs **110,550** — the off arm's
`quote-vanished` run handed the ENTIRE ~105k-token corpus to one
`llm_query` (7.6× the on arm's input for the same question, 5.4× the
dollars), while with the block present no run put the corpus through
attention; arm cost $0.2259 vs $0.5062 (2.2×); median iterations 2 vs 3.
The single wrong answer is the probe's sharpest exhibit: the on arm's
`count-justine` run wrote correct code, the engine printed
`{'simple': 55, 'regex': 55}`, and the model's next turn typed
`FINAL_ANSWER: 47` — the transcription channel live, in the one channel
the discipline does not yet mediate (the answer assignment as a fresh
literal instead of code interpolation). Pillar §6.3 marked MEASURED in
the record.

**(d) Module #1 v2 (pillar §6.4, PAID — landed after an owner
re-scope).** The pillar's §0+§2 (3,959 bytes, sliced from the record by
code) was parked at the production scratch key via a one-shot harness
(the `test_promotion.ts` [1] shape: `redis.set(scratchKey(goal, task))`
with a `trellis-repo/design-record` origin stamp, argsHash = content
sha256 first 16 hex; harness deleted after use) and promoted through the
REAL CLI: `npm run promote -- --goal
module1-workspace-discipline-v2-research --task corpus-2026-07-10
--segment <uuid> --doc-key
research:trellis/workspace-discipline/code-mediated-text` → version 1,
root `0a477d04…779e`, 103 nodes, 17 eligible blocks, extraction `none`.
The `--draft` drill (hand-written fixture envelope) passed the full
assembly path zero-paid first (gate 30/64; scratch dir deleted). The
paid run — `npm run modules:author -- --module-name
workspace-discipline-v2 --topic "workspace discipline for an RLM
operating under the code-mediated text doctrine" --doc-key <contract>
--doc-key <evidence> --doc-key <code-mediated-text> --confirm-paid`
(estimate $0.57 printed) — produced a faithful draft (**$0.127 actual**:
32,273 in / 4,632 out; 6 iterations; 41 workspace segments read; the
mitigation line retired; 8 honest gap notes), but the anchor gate
REFUSED assembly at 18/64 = 0.28 < 0.30. Measured decomposition: the
evidence doc's distinctive anchors are measured numerals ("8 vs 4",
ratios) the authoring TEMPLATE forbids a draft from restating, plus
report artifacts ("goal-total", "task-2") no protocol prose would use —
excluding the template-forbidden numerals the draft sits at exactly
18/60 = 0.30. The same draft covers 32/64 = 0.50 against the two
NORMATIVE docs. Per the gate's own documented remedy ("choose a more
specific corpus", grounded-authoring record §8) the owner re-scoped the
pinned corpus to contract + code-mediated-text on July 10 and the SAME
paid envelope landed by the zero-paid `--draft` replay — no re-run, no
gate/template/threshold change. The human swap kept the module name and
the `WORKSPACE DISCIPLINE PROTOCOL` title, set `version: 2`, pinned
`research.sourceNodeIds` to the 31 driver-pinned blocks, preserved v1's
laundering-correction history verbatim in `RESEARCH.md`, and confirmed
the "reconstructing stored text" line gone (`test:modules` [5]: version
pin moved 1→2 wittingly; a new pin keeps the mitigation line retired).
Re-registered live: `npm run modules:register -- --module
workspace-discipline` (ON MATCH refresh, `moduleVersion` 2; the graph
entity's live provenance is now the audit-preserving union of both
versions' bases, 41 hashes, all live); `npm run modules:verify` —
uncontested. The calibration finding is now §4 row 3.

**Paid-run ledger:** probe $0.7320 + authoring $0.127 = **$0.859 total**
(both behind printed estimates; standing ≤$5/run cap held with wide
margin).

**Defects found and fixed along the way:** (1) the ground-truth
sentence extractor originally scanned the whole normalized text, so an
unterminated section heading ("Chapter 1") glued onto a chapter-initial
sentence — caught by the unit fixture, fixed by extracting within the
containing blank-line paragraph (headings are their own paragraphs);
(2) the corpus file needed `.gitattributes -text` — with this machine's
`core.autocrlf=true` a plain commit would check out CRLF and move every
ground truth (caught before commit; the byte-stability test now pins
it). **Noted, not a defect:** `parseDraftPayload` (Node) accepts only
`gapNotes` while the model's raw answer uses `gap_notes` — the Python
envelope emitter canonicalizes to `gapNotes`, so only hand-written
draft files need care.

**Offline baseline moved 621/71 → 639/72** (the ground-truth suite +
the env-strip pin); `test:modules` 43 → 50 (section [7] + the [5]
retirement pin).

**Close-out (all green; drills run keyless via `env -u
OPENAI_API_KEY`):** `npm test` (639/72); `npm run build`; `npm run
python:check`; `docker compose --profile test config --quiet`;
`test:textedit` (81); `test:module-lifecycle` (60); `test:modules`
(50); `test:promotion` (41); `test:rlm-workspace` (86); `test:rlm-mcp`
(86); `test:rlm-sandbox` (21); `test:agent-loop` (35); `test:a2a`
(46); `npm run drill:scale` (gate CLOSED at max provenance 286; sweep
growth 1.88x, inside the recorded ~1.63x–2.26x band;
`scale_drill_results.json` refreshed and committed, house practice);
`test:repo-ingest` (45); `test:benchmark-hardening` (24);
`test:entity-resolution` (34); `test:api-hardening` (18);
`test:belief-recovery` (30); `test:invalidation-sweep` (17); the
isolated Compose integration as project `trellis_s21_ci` (10
assertions, incremental image rebuild — `package.json` untouched —
torn down with `--volumes`); `git diff --check` clean.

**Standing owner-gated proposals (unchanged, not run):** the extraction
pilot re-run (~112 completions ≈ 57k in / 47k out at the July 6 shape);
the supervised Trellis-edits-Trellis proof run; the module #2 authoring
turn.

### July 10, 2026 — Session 21 follow-ups: anchor-gate fix + owner re-sequencing (same PR)

After reviewing the Session 21 findings, the owner directed two changes
in the same PR before hand-off:

1. **Anchor-gate calibration fixed (§4 row 3, struck).** The derivation
   gate (`src/core/authoring/anchors.ts`) scored numeric anchor kinds
   (`comparison` like "8 vs 4", `ratio` like "2.26x") in its coverage
   denominator, but the authoring template FORBIDS a draft from writing
   measured numerals — so a compliant draft could never cover them and
   was penalized for compliance (this refused the module #1 v2 draft at
   18/64 = 0.28, its only misses being the four forbidden numerals).
   `evaluateAnchorGate` now scores only the coverable kinds (`compound`,
   `term`); `extractAnchors` still surfaces every kind for diagnostics.
   The previously refused three-doc draft now clears at 18/60 = 0.30
   (verified against the actual saved paid draft). Two regression tests
   pin it; offline suite 639 → **641**; the live gate drills
   (`test:module-lifecycle`, `test:modules`) are unchanged. Had this fix
   existed during the session, the module #1 v2 corpus re-scope would
   not have been necessary — but the landed two-doc corpus is still the
   correct, more-specific corpus and stands.

2. **Next objective re-pointed (§4 row 2).** The owner directed that the
   NEXT session be **effective-context probe, round 2 + the
   answer-channel fix** — NOT the repository-scale extraction
   prerequisites, which defer one more slot (now §4 row 3). The probe
   round-2 scope (obscure/private corpus, multi-file/repo scale, an edit
   round-trip, more runs per question, and the by-reference answer fix
   for the 55→47 transcription leak) is carried at full concreteness in
   the regenerated `HANDOFF.md` §3–§8.

### July 11, 2026 — Session 22: the effective-context probe round 2 + the answer-channel fix (§4 row 2)

**The answer-channel fix shipped first** (row 2 item (e); the round-1
55→47 transcription leak, closed as tooling shape per pillar §2.8,
never as prompt plea):

1. **`src/rlm/trellis_answer.py`** — `TrellisAnswer`, injected via rlms
   `custom_tools` as `trellis_answer` in EVERY research run (kernel
   surface, like the database tools; author mode does not carry it —
   pinned in `test:modules` [6]). The single model-visible method
   `submit(expression_text)` takes the TEXT of a Python expression,
   evaluates it in the calling REPL frame (`sys._getframe` — globals
   AND locals, so nested-helper calls resolve; the caller's
   `__builtins__` are rlms' safe table, so `eval` stays blocked inside
   the expression and the channel widens nothing), refuses bare
   literals structurally (`ast.parse` + no Name/Attribute/Subscript/
   Call ⇒ the retyped-literal class, refused with a teaching message),
   refuses `None` results and over-cap expressions/content (kernel
   constants 400 chars / 64 KiB), renders deterministically (str
   verbatim, int exact, float shortest-round-trip repr, containers as
   compact JSON), prefixes `FINAL_ANSWER: ` engine-side, and mutates
   the LIVE `answer` binding read from the caller frame each call (so
   rlms scaffold-restore replacing the object between turns can never
   leave the holder mutating a dead dict). ADDITIVE: direct
   `answer['content']` assignment still works; `TRELLIS_RESULT`
   semantics unchanged; telemetry gains counts-only `answer_submits`
   (the Node scanner tolerates unknown fields — zero TS changes).
2. **The kernel prompt teaches the channel** (TOOLS item 3, the TURN
   DISCIPLINE line, the final-answer workflow rule — brace-free), so
   BOTH composed-prompt pins moved wittingly and were recomputed in
   the same commit with recorded move history (`scripts/
   test_modules.py`): default `170e9f7e…67e9` → `9f09d7d2…dd68`;
   omit-arm `abb945a6…f9b2` → `9779b5c0…9e45`. The omit arm is NO
   LONGER byte-identical to the pre-Session-20 kernel — its meaning is
   now purely structural (the default kernel minus exactly
   `CODE_MEDIATED_TEXT_BLOCK`, re-proven structurally by
   `test:modules` [7] on every run). The historical probes
   (`probe_workspace_paired.py` / `probe_workspace_lineage.py`) mirror
   the agent's composition, so they inject the holder too.
3. **Regression: `npm run test:answer-channel`** (new,
   `scripts/test_answer_channel.{ts,py}`, 32 checks) — reproduces the
   55→47 class inside the REAL rlms `LocalREPL`: the REPL computes a
   count, `submit("counts['simple']")` carries it to
   `REPLResult.final_answer` unretyped; the hand-typed literal is
   refused in-REPL; a typo'd name is a loud NameError, never a silent
   wrong digit; nesting/sandbox/restore/additivity semantics and the
   successes-only counter are pinned. `trellis_answer.py` joined
   `python:check` and the Dockerfile's shipped `src/rlm` set (the
   Session 12 lesson).

**Round-2 measurement machinery** (rows (a)–(d)):

4. **The unmemorized corpus** —
   `src/benchmarks/effective_context/synthetic_corpus.ts`: seeded
   deterministic generation (mulberry32, integer ops — bit-identical
   everywhere; ASCII only). The chronicle
   (`data/synthetic_chronicle.txt`, COMMITTED: 293,411 bytes ≈ 73k
   tokens, sha256 `b56f6d32…f1e6` pinned in vitest along with
   byte-equality to the generator and `.gitattributes -text`; 48
   "Entry N" sections; invented substring-free vocabulary; one planted
   unique anomaly sentence per entry, mid-paragraph, phrase =
   `chronicleAnomalyPhrase(i)`) — quote/locate answers cannot come
   from parametric memory. Ingested zero-paid as
   `book:synthetic:ninth-circuit-chronicle` (root `f0ffaf20…7c23`,
   1,655 nodes, 827 blocks, extraction `none`; re-ingest observed as
   the auditable no-op; sampled blocks read back byte-exact through
   the real Python `get_ast_texts`). Durable substrate, not drill
   residue.
5. **The multi-document corpus** — 40 generated shipping ledgers
   (2,209 records, one canonical sentence shape, 185,301 bytes total,
   concat sha pinned), ingested as `ledger:synthetic:house-01…40`
   through the same verified path. `parseLedgerRecords` is SHAPE-based
   (global regex), not line-based — **defect found live at ingest:**
   the AST reconstruction concatenates paragraph blocks with unmarked
   boundaries, so the last record of one block glues onto the first of
   the next; line splitting is not representation-invariant but the
   record shape is (unit test pins the glued case). Ground truth =
   aggregations over records parsed FROM BYTES (`totalsByPort`,
   `topPortForMaterial` — tie-refusing, `totalForCaptainMaterial`),
   asserted identical on generated bytes and on every stored
   reconstruction before any spawn.
6. **Ground-truth generalization** (`ground_truth.ts`):
   `splitSectionsBy`/`sectionContainingBy`/`extractAnswerSectionBy`
   (parameterized heading kinds; the round-1 Letter/Chapter forms
   delegate) and `replaceUniqueLine` (expected post-edit bytes;
   refuses zero/multiple marker lines and multi-line replacements).
   Offline suite 641 → **659** across 73 files.
7. **The probe script round 2** (`scripts/exp_effective_context.ts`,
   still deliberately un-aliased): `--suites frank,chronicle,ledger,
   edit`, `--repeats` (1–5), `--questions` filter, per-suite corpus
   metadata in the plan, medians WITH [min..max] spread, per-run
   `submit`/`pandas` columns, and the edit suite — a fresh scratch
   `TRELLIS_EDIT_ROOT` per run (the Session 20 operator-gating
   mechanism pointed at a throwaway root), seeded notes file, scored
   on byte-exact post-edit contents (computed by `replaceUniqueLine`)
   AND the answer; actual post-edit bytes are captured next to each
   run log. `--ingest` covers all three corpora with Python read-back
   and representation-invariance checks. The zero-paid edit drill
   (toolkit `locate`→`splice`→`write_back` vs the computed expected
   bytes) agreed byte-for-byte before any paid run.

**The measured runs** (owner-directed objective; pre-flight estimates
printed, ≤$5 cumulative abort armed per invocation, none aborted):

- Commands: `--suites chronicle,ledger --arms on,off --repeats 2`
  (36 runs, $1.3975), `--suites edit --arms on,off --repeats 2`
  (8 runs, $0.2596), `--suites frank --arms on,off --repeats 1`
  (12 runs, $0.4532), plus one single-question smoke run ($0.0406).
  **Total Session 22 paid spend: $2.1509 across 57 runs.** Raw logs
  under `benchmark_logs/effective-context-2026-07-11T*` (gitignored);
  the numbers live in
  `docs/benchmarks/EFFECTIVE_CONTEXT_PROBE_REPORT.md` (round-2
  section).
- Headline findings: **the transcription channel is closed in
  practice** — 57/57 runs answered through `trellis_answer.submit`,
  every computed value landed digit-exact (including the round-1
  55→47 question, now 55 in both arms), zero transcription errors in
  56 scored runs vs 1-in-12 in round 1. **Read-fidelity isolated and
  held** (8/8 unmemorized anomaly quotes byte-faithful, ~10k median
  input tokens against a 73k-token corpus). **The edit round-trip is
  8/8 byte-exact** (first paid drive of the Session 20 toolkit).
  **The pandas null result**: 0/68 round-2 runs imported pandas, even
  for 40-document aggregation — plain loops stayed correct and cheap
  (a finding: the §7 DataFrame threshold sits above this scale).
  **The round-1 arm effect did not reproduce**: on/off medians are
  indistinguishable in every suite and round 2 saw no attention
  blowups — the strengthened tooling shape carries the discipline on
  these task shapes; measurement pressure belongs on shape, not
  prose. **Every round-2 miss (3 in 56) is localization-method error
  over the glued reconstruction** (line-anchored heading regexes: two
  loud sentinel answers "Entry None"/"Entry ?", one plausible
  TOC-anchored "Chapter 23") — recorded as an observation with a
  possible future kernel question (should `get_ast_texts` preserve
  block boundaries? that would move every pinned reconstruction
  truth, so witting or not at all), not patched mid-measurement.
- **Defects found and fixed along the way:** (1) the block-gluing
  representation hazard (item 5 — fixed as shape-based parsing before
  any paid run); (2) the `led-top-port` grader demanded the literal
  "Port X" prefix and falsely failed correct "Galeholt, 1679"-shaped
  answers — grader corrected in the committed script, the four
  affected rows re-scored, disclosure in the report; (3) the
  chronicle preamble omitted the "paragraph boundaries are unmarked"
  clause the frank preamble carries — left AS RUN for
  reproducibility, noted for a future round.

**Acceptance observed (July 11, 2026):** `npm test` 659/73 · `npm run
build` · `npm run python:check` (now imports `trellis_answer`) ·
`docker compose --profile test config --quiet` · `test:answer-channel`
32 · `test:modules` 51 (pins moved wittingly, recorded) ·
`test:textedit` 81 · `test:rlm-workspace` 86 · `test:rlm-mcp` 86 ·
`test:rlm-sandbox` 21 · the full drill block and the isolated Compose
integration recorded in the close-out below · `git diff --check`
clean. The dev graph now durably carries the two new corpora alongside
Frankenstein.

**Next objective re-pointed (July 11, 2026, same PR, per the §0
event-loop rule — step 5).** The regenerated handoff first named
Session 23 = the repository-scale extraction prerequisites (the
then-first-unstruck row). The owner then re-pointed the next session to
**effective-context probe, round 3** — closing the two measurement
threads round 2 left open (the repo-scale / pandas-payoff regime and
localization over the unmarked-boundary reconstruction), raising n, and
fixing the recorded question-design gaps. Rationale on record: round 2
proved transcription is closed and read-fidelity holds, but the
pillar's headline §7 payoff (structured frames earning their keep at
scale) is still unmeasured, and the round-2 misses point at a concrete
localization/representation question worth measuring before more
capability work. Extraction prerequisites drop to row 4 (never dropped;
the round-3 repo-scale arm builds tooling that row benefits from).
`HANDOFF.md` §3–§8 were regenerated for probe round 3 in this same PR.

### July 11, 2026 — Session 23: the effective-context probe round 3 (§4 row 3)

**The relational corpus** (row 3 item (a); the pillar §7 regime,
chosen over a live `repo:ingest` snapshot because a repository's
cross-file "joins" are either trivially greppable or semantic — not
computable from bytes by pure helpers — and because a generated corpus
stays durable where a snapshot drill must tombstone):

1. **`src/benchmarks/effective_context/relational_corpus.ts`** (+
   test): seeded deterministic generation (mulberry32, ASCII; concat
   sha256 `3bbbea18…a697` unit-pinned; 583,128 bytes ≈ 146k tokens —
   more bytes than the Frankenstein corpus). 102 documents of three
   kinds: 100 season-two ledgers (`ledger:synthetic:s2-house-001…100`,
   6,859 records in round 2's exact canonical record shape — the
   round-2 `parseLedgerRecords` parses them unchanged), one captain
   registry (`registry:synthetic:captains`: 36 unique captains → 8
   invented guilds, round-robin balanced — an `rng.pick` assignment
   skewed memberships badly enough that one guild topped EVERY
   aggregate, degenerating the join questions; found during corpus
   design, fixed before ingest), and one tariff schedule
   (`tariff:synthetic:port-schedule`: one line per (port, material)
   pair, 108). New shape-based parsers (`parseRegistryRecords`,
   `parseTariffRecords` — the gluing lesson applied from the start)
   and tie-refusing join truths (`buildGuildIndex`, `buildTariffIndex`,
   `totalsByGuildForMaterial`, `topGuildForMaterial`, `tariffIntoPort`,
   `totalTariffByGuild`, `topGuildByTariff`, `guildProfile`; unknown
   captains, missing tariffs, duplicates, and ties throw — Duskhollow's
   real port-frequency tie is the committed negative fixture). All 102
   ingested zero-paid through the verified path (extraction `none`),
   sampled blocks read back byte-exact through the real Python
   `get_ast_texts`, re-ingest observed as the auditable no-op (144
   documents no-op across all four corpora). Durable substrate.
2. **The probe script round 3** (`scripts/exp_effective_context.ts`):
   new `relational` suite (4 kernel-fixed join questions — 2-table,
   2-table+arithmetic, 3-table, and the multi-part guild profile as
   the answer-channel stress companion), `usedPolars` measured
   alongside `usedPandas`, two new chronicle locate anomalies (Entries
   24/37 join round 2's 6/43), per-run localization-method
   classification (`classifyLocalizationMethod` in `ground_truth.ts`:
   line-anchored / shape / unknown, from the saved run logs), the
   `--ingest` boundary-quantification printout, and the disclosure
   fix (row 3 item (d)): the chronicle and ledger preambles now carry
   the frank preamble's "paragraph boundaries are unmarked; line
   breaks inside paragraphs are preserved" clause verbatim.
3. **The zero-paid boundary quantification** (row 3 item (b);
   `boundaryPreservedReconstruction`/`lineAnchoredHeadingLabels` in
   `ground_truth.ts`, unit-pinned from the committed bytes): the glued
   reconstruction hides ALL 48 chronicle headings from a line-anchored
   scan (the glued chronicle is ONE line) and leaves frank with 26
   labels that are ALL misleading TOC lines ending at "Chapter 23";
   the boundary-preserved variant (same stored blocks joined with
   blank lines) restores 48/48 and 56 (all 28 real + 28 TOC), and
   `sectionContainingBy` over it equals the source-bytes truth.
   Offline suite 659 → **678** across 74 files.

**The measured runs** (owner-directed objective; estimates printed,
≤$5 cumulative abort armed per invocation, none aborted):

- Commands: one smoke run (`--suites relational --questions
  rel-top-guild --arms on`, $0.0593), `--suites relational --repeats 2`
  (16 runs, $0.9813), the localization arm (`--suites chronicle,frank
  --questions syn-locate-halloway,syn-locate-crayke,
  syn-locate-inglenook,syn-locate-vennbridge,locate-November
  --repeats 3`, 30 runs, $1.2586), and the higher-n arm (`--suites
  chronicle --questions syn-count-kelvorin,syn-count-torulf,
  syn-quote-verewood,syn-quote-pickering --repeats 5`, 40 runs,
  $1.3267). **Total Session 23 paid spend: $3.6260 across 87 runs**
  (79/87 correct; every run ≥1 database tool call and every run
  answered through `trellis_answer.submit`). Raw logs under
  `benchmark_logs/effective-context-2026-07-11T09*` (gitignored); the
  numbers live in `docs/benchmarks/EFFECTIVE_CONTEXT_PROBE_REPORT.md`
  (round-3 section).
- Headline findings: **the pandas null result persists at 3.1× scale
  with genuine joins** (0/87 runs imported pandas or polars; plain
  dict loops answered all 17 relational join runs digit-exact at
  ~8.7k median input tokens against a ~146k-token corpus — the
  structured-frame threshold sits above one-record-shape corpora of
  this size; what would plausibly move it is recorded: schema
  heterogeneity, fuzzy joins, or a long interactive session over one
  working set). **The localization class reproduced at rate** (7/30
  locate misses, all method error, none transcription; five loud
  sentinels + two plausible "Chapter 23"; recovering line-anchored
  runs paid 13k–27k input tokens vs ~3.6k for the runs that gave up
  — and the disclosure clause was IN the preamble, so prompt
  disclosure measurably does not retire the class). **A second
  representation trap found live and pinned**: gluing destroys
  trailing word boundaries too — a shape scan ending in `\b` cannot
  match a heading digit glued to the next block's first letter, which
  is exactly how BOTH rounds produced "Chapter 23". **The
  RECOMMENDATION was recorded** (all 10 cross-round localization misses
  are in the repaired class) — initially as a boundary-preserving
  reconstruction change, then RE-POINTED the same day to the additive
  `get_ast_blocks` accessor (§4 row 4; see the re-point entry below),
  which fixes the same class without moving any pinned reconstruction
  truth. **The load-bearing claims moved toward
  settled**: 87/87 submits, zero transcription errors (cumulative
  144/144 over rounds 2–3), 20/20 quote runs byte-faithful at
  n=5/arm/question, and the multi-part answer stress held 5/5. **One
  new miss shape, upstream of the channel**: a run assumed
  `get_ast_texts` returns a list, counted over the resulting empty
  string, and submitted the computed 0 in the SAME response block —
  faithful delivery of a wrong computation (result-shape mishandling +
  same-turn submit), not transcription. **The arm effect stayed in the
  tail**: medians indistinguishable; the round's single near-corpus
  attention pass (84,829 input tokens through one `llm_query`)
  happened in the off arm; zero such passes in 47 on-arm runs.
- **Defects found and fixed along the way:** (1) the skewed guild
  assignment (item 1 — fixed at design time, before the sha pin);
  (2) `classifyLocalizationMethod` initially missed anchored
  ALTERNATION patterns (`^(Letter|Chapter)`) — fixed with the
  committed classifier and the report's method tables re-classified
  from the saved logs with it (disclosed in the report; the summary
  aggregates in the run logs carry the pre-fix labels).

**Acceptance observed (July 11, 2026):** `npm test` 678/74 · `npm run
build` · `npm run python:check` · `docker compose --profile test
config --quiet` · the isolated Compose integration as project
`trellis_s23_ci` (all 10 PASS; image `trellis-backend:s23-ci`; torn
down `--volumes`) · `test:answer-channel` 32 · `test:modules` 51 (NO
pin moved — round 3 changed no kernel prompt) · `test:textedit` 81 ·
`test:module-lifecycle` · `test:promotion` · `test:rlm-workspace` ·
`test:rlm-mcp` · `test:rlm-sandbox` · `test:agent-loop` (ALL CHECKS
PASSED) · `test:a2a` · `test:repo-ingest` · `test:benchmark-hardening`
· `test:entity-resolution` · `test:api-hardening` ·
`test:belief-recovery` · `test:invalidation-sweep` · `npm run
drill:scale` gate CLOSED (max provenance 286, sweep growth 1.84x —
inside the recorded band; the committed `scale_drill_results.json` is
this run) · `git diff --check` clean. The dev PG now durably carries
the relational corpus alongside the three earlier probe corpora
(~293 documents total).

**Next objective re-pointed (July 11, 2026, same PR #61, per the §0
event-loop rule — step 5).** After the round-3 findings landed, the
owner reviewed the two threads round 3 surfaced and decided both forks,
which re-points Session 24 away from the extraction prerequisites (they
drop one slot to §4 row 5) to a localization fix + a documentation
demotion:

1. **The localization fix is an ADDITIVE accessor, not a reconstruction
   byte change.** Round 3 recommended repairing the glued-reconstruction
   localization misses by making `get_ast_texts`/`nodeText` preserve
   block boundaries (the then-§4 row 6) — but that moves every pinned
   reconstruction truth (probe invariants, per-block read-backs,
   entailment fetches). Investigation for the re-point found a cleaner
   path: `get_ast_texts` ALREADY returns blocks separately when handed a
   list of block hashes; the model only gets a glued blob because it is
   handed the ROOT hash and has no tool to enumerate a document's
   ordered blocks (its tools are `run_cypher` over the semantic graph,
   `vector_search` top-3, and `get_ast_texts` needing hashes it does not
   have). So the fix is a NEW ADDITIVE read tool `get_ast_blocks(rootHash)`
   returning `[{id, type, text}]` in document order (the
   `collectExtractionBlocks` set) — the model gets structure directly
   ("blocks mean, lines locate"), no stored/reconstructed byte moves,
   and only the composed-prompt pins move wittingly to teach the tool
   (the Session 22 `trellis_answer` precedent). The byte-change approach
   is SUPERSEDED (§4, struck), re-entering only if the accessor proves
   insufficient in the re-measure.
2. **Demote the pandas guidance per pillar §7's own contingency.** §7
   ends: "A continued null result would argue for demoting the 'pandas
   default' guidance to 'plain loops until a measured threshold.'" Round
   3 IS that continued null (0/87 at three-table-join scale), and §7's
   micro-benchmark already showed pandas has no speed advantage below
   ~1M lines — orders of magnitude past any Trellis frame. So the honest
   move is the pre-committed one: a docs-only, zero-paid edit to pillar
   §7 demoting "pandas is the default" to "plain loops until a measured
   threshold" (the mechanism claim — compute in code, effective context
   decoupled from attention — stays PROVEN by the loop runs; only the
   library-choice sub-claim is retired). NOT another paid probe: another
   null is the likely outcome and §7 already conceded the point.

Session 24 = the `get_ast_blocks` accessor + the §7 demotion + a paid
owner-gated localization re-measure confirming the miss rate drops.
`HANDOFF.md` §3–§8 were regenerated for it in this same PR; the
extraction prerequisites' full concreteness is preserved in this PR's
git history (the round-3 handoff that named them Session 24) for the
session after.


### July 11, 2026 — Session 24: the boundary-aware block accessor (`get_ast_blocks`) + the structure-selection demotion (§4 row 4)

The post-round-3 re-point executed: the ONE live failure class after
three probe rounds (localization method error over the glued
reconstruction — 10 misses across rounds 2–3) is fixed structurally
with an additive read tool, and pillar §7's library-choice sub-claim is
demoted per its own written contingency. No stored or reconstructed
byte moved; the composed-prompt pins moved once, wittingly, to teach
the tool.

1. **The accessor.** `TrellisPostgres.get_ast_blocks(root_hash)`
   (`src/rlm/trellis_tools.py`) fetches the root's `data` JSONB once
   and walks it into a JSON list of `{id, type, text}` in document
   order. The walk lives in the NEW dependency-free
   `src/rlm/trellis_blocks.py` (stdlib-only, imported by
   trellis_tools; `_node_text` moved there verbatim and is re-exported
   under its historical name). The block set is exactly
   `collectExtractionBlocks`'s and the text is exactly `nodeText`'s —
   pinned by the new cross-language parity test
   `src/core/ast/block_parity.test.ts`, which spawns the real Python
   walk against real parser output (markdown incl. the child-text
   reconstruction path, unstructured/PDF childless-content nodes, and
   code-aware trees with `code_class` traversed through). Design note,
   recorded: CI runs `npm test` BEFORE installing the Python runtime,
   so the walk had to live in a module that imports nothing beyond the
   stdlib — importing `trellis_tools` (psycopg2/neo4j at module top)
   from a unit test would fail there. The accessor counts a database
   tool call, joins the citation-audit read set with the same
   semantics as `get_ast_texts`, refuses non-string and unknown hashes
   loudly, and exposes no new citable ids. `trellis_blocks.py` joined
   `python:check` and the Dockerfile `src/rlm` COPY set.
2. **The kernel prompt teaches it (the only pin move).** One
   brace-free line under the `trellis_postgres` TOOLS entry in
   `_ADDENDUM_BASE_PREFIX` (prefer walking ordered blocks in code for
   section-structure/localization work over regexing a concatenated
   reconstruction). Both pins recomputed in the same commit with
   history recorded in place (`scripts/test_modules.py`): default
   `9f09d7d2…dd68` → `3f07295a…4b63`; omit-arm `9779b5c0…9e45` →
   `85362b81…71bb` (still structurally default minus exactly
   `CODE_MEDIATED_TEXT_BLOCK`, re-proven by `test:modules` [7]).
3. **The probe's round-4 machinery (zero-paid).**
   `classifyLocalizationMethod` gained the `structured` verdict — the
   marker is the CALL (`get_ast_blocks(` with the open paren) because
   the query is echoed into run logs and the preambles name the tool
   paren-free, so offering the tool can never classify as using it
   (unit-pinned both ways). The locate preambles now OFFER the
   accessor (`BLOCKS_OFFER`, scoped to locate questions so every other
   question's bytes stay round-comparable), the method table prints
   `structured`, and `--ingest` verifies the accessor round-trip live:
   frank 796 ordered blocks and chronicle 827, byte-identical to
   `collectExtractionBlocks`+`nodeText` over the stored roots, sampled
   text byte-matching `get_ast_texts` (run twice July 11; re-ingest
   stayed the auditable no-op, all root hashes unchanged).
4. **The §7 demotion (docs-only).**
   `docs/architecture/CODE_MEDIATED_TEXT.md` §7: "pandas is the
   default for relational/multi-file queries" is DEMOTED to "plain
   loops until a measured threshold" — round 3's 0/87 is the continued
   null result the §7 status note pre-committed to acting on (round 2:
   0/68). The micro-benchmark table, the mechanism claim, and the
   kernel prompt's "ingestion = pandas" metaphor (mechanism, not
   library — §0's own definition) are untouched. §6 gained item 6 (the
   accessor) and item 3 gained the round-3 close-out; the probe report
   gained its round-4 section.
5. **Acceptance.** `npm test` 683 passing across 75 files (baseline
   678/74: +3 parity, +2 classifier); `npm run build`,
   `npm run python:check` (now importing `trellis_blocks`),
   `docker compose --profile test config --quiet` all green. Live
   drills all green post-change: `test:modules` 51 (both pins moved
   wittingly), `test:answer-channel` 32, `test:textedit` 81,
   `test:module-lifecycle` 60, `test:promotion` 41,
   `test:rlm-workspace` 86, `test:rlm-mcp` 86, `test:rlm-sandbox` 21,
   `test:agent-loop` 35, `test:a2a` 46, `test:repo-ingest` 45,
   `test:benchmark-hardening` 24, `test:entity-resolution` 34,
   `test:api-hardening` 18, `test:belief-recovery` 30,
   `test:invalidation-sweep` 17. `drill:scale` CLOSED (results file
   committed per house practice). Isolated Compose integration run as
   project `trellis_s24_ci` (image rebuilt — the Dockerfile COPY set
   gained `trellis_blocks.py`; `package.json` untouched so the
   `npm ci` layer stayed cached), all 10 PASS, torn down with
   `--volumes`.
6. **The paid localization re-measure (probe round 4) — proposed with
   its estimate, OWNER-APPROVED, and MEASURED the same day.** Proposed
   ≈36 runs ≈ $1.6; actual $0.9452 across 36 runs (the round-3 locate
   set: chronicle ×4 + frank ×2, `--repeats 3`, both arms; run in
   question×arm chunks of 3 with the $5 abort armed per invocation,
   never hit). Result: **0/36 misses vs round 3's 7/30 (23%) on the
   same questions, with 36/36 runs classified `structured`** — every
   run in BOTH arms called `get_ast_blocks` and walked the ordered
   blocks; zero line-anchored, zero shape, zero unknown. The round-3
   "Chapter 23" TOC-trap question (`locate-November`) came back
   "Chapter 5" 6/6. Median input ~8.2k tokens (on 8,229 / off 8,264),
   median 2 iterations, no recovery loops (round 3's recovering runs
   paid 13k–27k); 36/36 submitted through `trellis_answer`
   (answer-channel record 180/180 across rounds 2–4); 0/36 pandas.
   The off arm's identical adoption rate is the pillar's enforcement
   thesis measured again: the tooling shape, not the §6.2 prompt
   block, carries the behavior. The pre-stated success criterion is
   met exactly; the superseded reconstruction-byte row STAYS closed
   (§0 event-loop re-check: the positive result re-opens nothing —
   Session 25 remains the extraction prerequisites, row 5).

### July 11, 2026 — Session 25: repository-scale extraction prerequisites (§4 row 5)

The July 6, 2026 extraction pilot's three recorded blockers
(REPOSITORY_INGESTION_REPORT §5) turned into machinery, all zero-paid.
The doctrine is the pilot's own lesson and the pillar's: ingest
everything, extract selectively; prompts request, gates enforce.

1. **The test/fixture extraction exclusion (finding 1).**
   `isTestOrFixturePath` (`src/core/repository/paths.ts`) — pure,
   kernel-fixed (Guardrail 5), case-insensitive: test/fixture directory
   segments (`__tests__`, `__mocks__`, `__fixtures__`, `test`, `tests`,
   `fixtures`, `testdata`) at any non-final depth, `*.test.*`/`*.spec.*`
   basenames, `conftest.py`, and a `test_*`/`*_test` STEM rule under any
   extension — deliberately wider than the recorded Python-only
   conventions because this repository's own `scripts/test_*.ts` drills
   carry seeded fixture strings (the exact contamination class the pilot
   recorded); the asymmetry is safe since a wrongly excluded source file
   merely skips semantic extraction while a wrongly included test file
   poisons the graph. Applied in `snapshot_ingest.ts` where the per-file
   extraction policy is selected: a classified file under
   `--extract changed` gets policy `none` — it still scans, parses,
   ingests, versions, and tombstones exactly as before (snapshot
   completeness is load-bearing). Reported before any write as typed
   counts distinct from scan skips: `PlannedFile.extractionExclusion`,
   plan/result `extractionExclusionCounts` +
   `blocksExcludedFromExtraction` (to-ingest files only — the same
   population the paid bound counts), the CLI plan echo line
   (`test_fixture_excluded=N; still ingested, never queued`), the
   published snapshot summary, and the bounded-label
   `trellis_repo_blocks_total{stage="test_fixture_excluded"}` counter.
   The paid bound itself is now post-exclusion, so exclusion shrinks the
   budget a `changed` run needs.
2. **Source-kind prompt routing (finding 3).** The extraction job
   payload gains OPTIONAL additive `sourceKind: 'code' | 'prose'` (+
   `language`) threaded from `IngestRequest` through
   `buildExtractionJobs`. The single producer (`ingestDocument`) stamps
   it on every queued job: repository snapshots map file language
   (`sourceKindForLanguage`: ts/js/py → `code`, markdown/text →
   `prose`); every other caller (API `/ingest`, promotion, probe
   corpora) is markdown prose by construction and defaults to `prose`
   at the enqueue. The worker side is the new pure
   `src/workers/extraction_job.ts` (the `workspace_scratch.ts` mold):
   `parseExtractionJobData` refuses unknown sourceKind/language values
   loudly BEFORE any I/O or paid call, and `buildExtractionPrompt`
   selects between the UNCHANGED document-generic prompt — a payload
   WITHOUT the field (anything already queued, any pre-Session-25
   producer) and a `prose` payload both compose the EXACT legacy bytes,
   unit-pinned in `extraction_job.test.ts` — and the NEW code-tuned
   prompt (API-level facts: exported symbols, modules/config keys/queue
   names used or constrained; qualified names as written; an explicit
   ban on bare generic identifiers; extreme sparsity). Same
   `GraphSchema`, same `zodResponseFormat`, same `parseLlmResponse`
   boundary — prompt text changed, the contract did not. The rlms
   kernel is untouched: both composed-prompt pins did NOT move.
3. **Deterministic generic-identifier suppression (finding 2).**
   `suppressGenericIdentifiers` (`src/core/graph/generic_suppression.ts`)
   runs in the worker after `parseLlmResponse` and BEFORE
   `resolveExtractedGraph`, for BOTH prompts: entities whose normalized
   name is in the kernel-constant denylist (exactly the recorded list:
   `entity`, `entities`, `name`, `id`, `ids`, `action`, `actions`,
   `data`, `value`, `values`, `key`, `keys`, `type`, `types`, `item`,
   `items`, `index`, `object`, `string`, `number`, `result`, `results`)
   or shorter than 3 characters are dropped, plus every action touching
   a dropped entity — and, one deliberate widening, every action whose
   UNRESOLVED endpoint id itself fails the name test (the resolve step
   passes unresolved ids through as names, so `subjectId: "entity"`
   with no local entity would MATCH a pre-existing `entity` hub at
   merge time; the filter closes that laundering hole; genuinely named
   unresolved endpoints still pass through — that path is a feature).
   Every drop is itemized: counts-only
   `trellis_extraction_suppressed_total{kind}` plus a bounded
   `extraction.generic_suppressed` log event carrying entity names in
   content per the dropped-action precedent. Suppression drops
   extraction CANDIDATES — it never deletes existing graph nodes
   (Guardrail 2). The division of labor is unit-pinned: the pilot's
   `globex corporation --[acquired]-> initech` PASSES the filter (it is
   fixture contamination, owned by the path exclusion, not generic).
4. **Acceptance.** `npm test` 712 passing across 77 files (baseline
   683/75: +5 classifier fixtures in `paths.test.ts`, +12
   `generic_suppression.test.ts`, +10 `extraction_job.test.ts`, +3
   `snapshot_ingest.test.ts`, +1 `persist.test.ts`, minus/plus exact
   splits per file); `npm run build`, `npm run python:check`,
   `docker compose --profile test config --quiet`, `git diff --check`
   all green. `test:repo-ingest` extended 45 → 56 checks with the new
   Part 6: a changed-mode snapshot over an edited source file + edited
   test file, extraction queue captured in memory (nothing reaches
   Redis) — the test file re-ingests to version 2 (IN the snapshot) yet
   contributes ZERO jobs; exactly the source file's new function block
   enqueued, its payload carrying `sourceKind: 'code'`,
   `language: 'typescript'`; the CLI echo pinned
   (`test_fixture_excluded=2`). Full standing drill block green
   (`test:answer-channel`, `test:textedit`, `test:module-lifecycle`,
   `test:modules` — pins unmoved this session, `test:promotion`,
   `test:rlm-workspace`, `test:rlm-mcp`, `test:rlm-sandbox`,
   `test:agent-loop`, `test:a2a`, `test:benchmark-hardening`,
   `test:entity-resolution`, `test:api-hardening`,
   `test:belief-recovery`, `test:invalidation-sweep`, `drill:scale`
   1.99x pre-pilot and 2.01x after the pilot re-run — both CLOSED,
   in-band; the committed results file is the post-pilot run —
   isolated Compose integration 10/10 as `trellis_s25_ci`).
   REPOSITORY_INGESTION_REPORT gained §5a (the prerequisites
   postscript). Defects found: none — the one behavioral judgment call
   (the unresolved-endpoint widening in item 3) is recorded above, not
   a defect.
5. **The pilot RE-RUN — proposed with its estimate, approved under the
   session's standing owner approval of paid/owner-gated tests, and
   MEASURED the same day** (report §5b). The zero-write `--dry-run`
   printed the plan first: 24 TypeScript files, 131,111 bytes; 10
   files `test_fixture_excluded` (29 blocks withheld); paid bound
   **103 blocks ≈ $0.29** at the recorded pilot telemetry. The run
   (`--repo-key trellis-graph-pilot-2`, budget 150; extraction +
   invalidation workers only): **103/103 jobs, zero failures, zero
   merge-dropped actions**, 35 unresolved endpoints (name
   pass-through, none errors), 103 embeddings, ~5 minutes.
   **Suppression live: 14 events, 18 entities + 23 actions dropped**
   — completions still emitted `Entity` despite the prompt ban; the
   gate enforced it every time (prompts request, gates enforce —
   measured). **Graph: 237 entities / 243 relationships** (July 6:
   340/318 from 112 blocks); **top entity `ast_nodes` at 4 sources vs
   `entity` at 14 — max hub cardinality 3.5× lower**; top-15 all
   genuine API-level identifiers; ZERO denylist names with pilot
   provenance (verified by live query). `globex corporation` (1
   source) and `initech` (2) byte-unchanged before/after — the
   fixture blocks never enqueued. Residual recorded, not acted on:
   `concept`/`kind`/`generic` at 3 sources each — first observed
   counts for future denylist candidates; 3 is not a hub. **Spend:
   55,891 in / 40,545 out + 20,543 embedding tokens ≈ $0.28** (2.5%
   fewer input, 13.5% fewer output tokens than the July 6 pilot's
   $0.31 — the sparser code prompt, as predicted; under the $0.29
   estimate). Cleanup: tombstone snapshot #2 (24 tombstones), the
   invalidation worker swept, post-sweep every pilot-provenance
   entity (521 incl. July-6 residue via shared content-addressed
   hashes) reads contested, zero uncontested. Total Session 25 paid
   spend: ≈$0.28.
6. **Objective selection for Session 26 (the §0 rule, recorded; the
   step-5 re-check ran after the pilot re-run).** Row 5 was the last
   self-serve implementation row. What remains in §4 is the
   trigger-blocked conditional migration (Sessions 23–25 read 1.84x /
   2.11x / 1.99x–2.01x — all CLOSED, in-band; the trigger has not fired)
   and the superseded/deferred dash rows. Proposal (a), the pilot
   re-run, was executed THIS session under the standing approval and
   surfaced NO defect in the Session 25 machinery — nothing jumps the
   queue. Per the handoff's recorded rule for this state, Session 26
   is an ADJUDICATION session over the two remaining owner-gated
   proposals: the supervised Trellis-edits-Trellis proof run
   (≈$0.10–$0.30, cap $1; edit target owner-picked) and the module #2
   authoring turn (≈$0.13–$0.30, topic owner-picked,
   prompt-movable, positive-control-testable). Execute what the owner
   approves, record the outcome here. No new implementation scope is
   self-served while the queue is in this state.

### July 11, 2026 — Session 26: the Trellis-edits-Trellis proof runs + module #2 (the adjudication session, both proposals approved)

The owner approved both standing proposals in-session, delegating the
open parameters: the proof run's edit targets ("a small supervised test
edit, if that goes well go deeper and expand the breadth") and module
#2's topic ("you can choose the recommended topic"). Total session paid
spend: ≈$0.70 (proof-run series ≈$0.58 under its $1 cap; module #2
authoring $0.122 under its $0.53 printed estimate).

1. **The proof-run series (six spawns, three edits landed, one real
   defect found and fixed).** Mechanics: `trellis_agent.py` spawned
   directly (the probe's `armEnv` mold, temp driver deleted after use)
   with `TRELLIS_EDIT_ROOT` at this branch checkout; every run's diff
   reviewed by the human via `git diff` before acceptance; the toolkit
   never touched git.
   - **Run 1 ($0.052, REJECTED at review):** the GLOSSARY Capability
     Flywheel status edit landed byte-precise but carried an
     instruction ambiguity verbatim ("version 2.0 --" — the task
     text's own dash) — the supervision gate exists for exactly this;
     reverted, task rewritten unambiguously.
   - **Run 1b ($0.098, honest no-write):** the revert had converted the
     working file to CRLF (autocrlf), and the run correctly REFUSED to
     force a write it could not stage cleanly, reporting why. File
     re-normalized to LF.
   - **Run 1c ($0.066, ACCEPTED):** one line changed, every other byte
     identical: "(designed;" → "(machinery shipped; module #1 live at
     version 2;" with the version READ FROM THE GRAPH
     (`module:workspace-discipline`.moduleVersion) and int-rendered in
     code — a DB-grounded edit, 2 tool calls, hash-guarded write_back,
     answer submitted by reference.
   - **Run 2 ($0.182, honest no-write — FOUND A REAL KERNEL DEFECT):**
     the two-file breadth task thrashed against
     `trellis_textedit.splice` refusing every replacement: the
     validation rejected "\r" alongside "\n", which made CRLF files
     (API_REFERENCE.md, docs/README.md) IMPOSSIBLE to line-replace —
     the replacement must carry the trailing "\r" to keep bytes
     verbatim, contradicting the toolkit's own documented
     CRLF-verbatim behavior. Reproduced zero-paid with a local
     harness, fixed (`src/rlm/trellis_textedit.py` now refuses only
     "\n", the frame delimiter), regression-pinned
     (`test:textedit` 81 → 82: replacing a CRLF line keeps the
     carriage return byte verbatim). No pinned check asserted the old
     behavior. THE FLYWHEEL RESULT: Trellis editing Trellis surfaced a
     bug in Trellis's own editing toolkit on its second real edit.
   - **Run 2b ($0.121, ACCEPTED):** on the fixed toolkit, both files
     edited in one run — API_REFERENCE.md "all five queues" → "all
     seven queues" (stale since Session 9; CRLF preserved) and a
     correctly formatted 4-line benchmarks-index entry for
     `EFFECTIVE_CONTEXT_PROBE_REPORT.md` authored and inserted into
     docs/README.md; 15 textedit ops, 2 files, 2 writes, answer by
     reference.
   - **Run 3 ($0.061, ACCEPTED — the "deeper" arc):** a
     graph-aggregation-informed edit: queried EVERY `module_manifest`
     entity, built the replacement phrase entirely in code from the
     query results (names prefix-stripped, versions int-rendered,
     sorted, joined), and updated the line run 1c wrote to "(machinery
     shipped; 2 modules live (estimation-discipline v1,
     workspace-discipline v2);" — the flywheel turning on its own
     prior output. Depth note: source-file edits are mechanically
     identical to docs edits (the toolkit is file-agnostic); the next
     depth increment is an owner-picked real code change.
2. **Module #2: `estimation-discipline` (topic chosen per the recorded
   constraints).** "Mechanical provenance threading" was NOT chosen —
   `docs/COLLABORATOR_BRIEFING.md` records it as a candidate
   ARCHITECTURE session (plumbing, not prompt) and records module
   topics must be behavioral with a decisive positive control; the
   briefing's own candidate list names estimation discipline ("when is
   an answer good enough to stop searching"), which has live measured
   evidence of the failure class. Corpus: two documents authored by
   the operator this session (no normative estimation prose existed in
   the repo), every evidence number verified against its committed
   report (8-vs-4 external calls; 0-external-call seeded task;
   110,550-token single sub-call; 13k–27k recovery-loop band vs ~8.2k
   median; the searching-past-held-evidence laundering incident);
   parked via the Session 21 one-shot harness shape (temp script
   deleted) and promoted through the REAL CLI as
   `research:trellis/estimation-discipline/contract` (root
   `9f5c46bc…8b62`, 11 blocks) and `…/evidence` (root `f6fa47e4…b4fa`,
   8 blocks), extraction `none`. The paid authoring run (estimate
   $0.53 printed; **$0.122 actual**, 36,442 in / 3,047 out, 23
   workspace ops over the 19 seeded blocks) produced a faithful
   six-section addendum with one honest gap note; the anchor gate
   PASSED first try at 21/58 = 0.36 ≥ 0.30; the harness pinned all 19
   corpus hashes; assembled, human-reviewed (corpus-authorship and
   positive-control sections added to RESEARCH.md), registered live
   (`module:estimation-discipline`, uncontested, `modules:verify`
   green). NOT in the default selection — both composed-prompt pins
   unmoved; per the briefing's rule it stays out until the positive
   control (designed this session, measurement owner-gated — new §4
   row 6) measures a real effect.
3. **Also answered in-session (owner question):** pandas was never
   forced head-to-head — rounds 2–4 measured whether the model REACHES
   for it (0/191 runs) and whether plain loops stayed correct (yes,
   digit-exact through 6,859 records and 3-table joins at ~8.7k median
   tokens). A forced pandas-arm vs loops-arm comparison on the
   recorded movers (schema heterogeneity, fuzzy joins) remains an
   owner-pickable future probe round.
4. **Acceptance.** `npm test` 712/77 (unchanged — the toolkit fix is
   Python, pinned by the live drill); `npm run build`,
   `npm run python:check`, `docker compose --profile test config
   --quiet`, `git diff --check` green; `test:textedit` **82** (the
   CRLF regression check); `test:modules` green with BOTH pins unmoved
   and module #2 present; full standing drill block green;
   `drill:scale` 1.78x CLOSED (in-band); Compose integration re-run as
   `trellis_s26_ci` (the Dockerfile COPY layer moved with
   `trellis_textedit.py`; `package.json` untouched, `npm ci` cached).
5. **Objective selection for Session 27 (the §0 rule).** New §4 row 6
   is the first unstruck actionable row: the estimation-discipline
   positive-control MACHINERY (zero-paid probe module-arm flag, the
   `TRELLIS_EXP_OMIT_CMT` mold) with the paired measurement proposed
   owner-gated (~$1–2). Behind it: row 7 (conditional migration) stays
   trigger-blocked. Also owner-conditional: the next proof-run depth
   increment (a real source-code change through the toolkit, target
   owner-picked), and the pandas head-to-head probe round if the owner
   wants it measured.

### July 11, 2026 — Session 27: the data-plane representation verdict recorded and its prerequisites pinned (§4 row 6a)

The July 11 data-plane review's three adopted recommendations (plus the
recommendation-5 doctrine line), all zero-paid — no LLM call anywhere in
the session.

**1. The polars pin (recommendation 2 — the found inconsistency
closed).** `requirements.txt` gains `polars==1.34.0` with a comment
recording what the pin is (the engine-side analytics tier of the
wall-clock report) and is not (adoption — no kernel, contract, or
prompt path imports it; the §8 exclusion stands).
`scripts/check_python_runtime.py` adds `polars` to the import list
under the pandas precedent's rationale: a broken environment must fail
the check, not a paid run. `scripts/bench_wallclock_text.py` (already
in the syntax-compile list) is now runnable in-container. The Compose
integration (`scripts/test_compose_roundtrip.ts`) gains an in-container
probe — `python -c "import polars"` via `config.python.executable`,
asserting exit 0 and the exact pinned version string — so the image's
venv is proven to carry it, not merely the local dev machine (10 → 11
assertions). No src/ file imports polars (verified by grep before
commit).

**2. The pillar §7 verdict paragraph (recommendation 3 + the
recommendation-5 doctrine, docs-only).** One paragraph in
`docs/architecture/CODE_MEDIATED_TEXT.md` §7 directly after the July 11
engine-side postscript: structure selection is operation-shaped, not
size-shaped; the data-plane contracts stay JSON at every boundary
(workspace index / MCP payloads / Redis snapshots canonical JSON,
PG/Neo4j database-native, splice-shaped editing list-of-lines); Option
C rejected by §4.5 doctrine, Option B unjustified at the 4–32 MiB caps,
canonical JSON byte-deterministic where Arrow IPC is not; polars pinned
not adopted; and the cap-raise doctrine — approach the 32 MiB cap ⇒
re-run the M1 drill at the target size BEFORE raising caps; cap raises,
not representation changes, are the first lever; a migration re-enters
only through the review's benchmark matrix and adoption thresholds with
owner sign-off. Both composed-prompt pins unmoved (`test:modules` [4]
and [7] green, default `3f07295a…4b63` / omit-arm `85362b81…71bb`).

**3. M1/M7 standing fixtures (recommendation 4).**
`scripts/test_rlm_workspace.py` gains sections [7] and [8], pure
stdlib, no new dependencies, **86 → 106 checks**:

- **[7] M1 park/seed round-trip at cap sizes:** workspaces filled to
  EXACTLY the byte cap (deterministic ASCII segments; plan + note
  accounted byte-for-byte), then `snapshot()` → `json.loads` →
  `seed_from_snapshot` at 4 MiB (default cap, 8 segments), 32 MiB
  (hard cap, 16 segments), and 1024 segments (the count hard cap):
  byte-lossless round-trips (`reseeded.snapshot()` byte-equal to the
  parked bytes), usage exactly == cap after seeding, and refusal at
  cap+1 (one segment grown one byte with a consistent stamp ⇒
  `WorkspaceBudgetError` byte budget; a synthetic 1025th segment ⇒
  segment budget). Wall-clock timings are PRINTED as telemetry, never
  asserted (CI variance) — observed locally: 32 MiB snapshot ~84 ms /
  parse ~27 ms / seed ~11 ms; 4 MiB ~9/4/0.3 ms; 1024 segments ~9 ms
  total. The Node-side Zod twin pins in `rlm_job.test.ts` were not
  duplicated.
- **[8] M7 torn-payload refusal + canonical determinism:** a
  validity-control fixture that seeds cleanly, then one mutation per
  previously-unpinned integrity class — non-string content, non-bool
  `truncated`, missing `origin.argsHash`, non-string `fetchedAt`
  (section [6] already pins the small-size torn stamp, wrong version,
  fully-stampless segment, and over-budget classes — extended, not
  duplicated) — plus torn-stamp and wrong-version refusals re-proven
  at the 4 MiB cap size, and the canonical-form determinism pin
  (parse + re-serialize byte-identical to the parked snapshot) at all
  three cap shapes — the property the review found Arrow IPC could
  not guarantee across library versions (adoption threshold 3).

**4. Prose reconciliation (the rest of recommendation 2).** HANDOFF §2's
environment line now states polars as pinned and the image's pandas as
3.0.3 (requirements-pdf-fast.txt) vs the local 2.2.3.
`docs/benchmarks/EFFECTIVE_CONTEXT_PROBE_REPORT.md` was verified to
carry NO container-availability claim about polars (grepped for
environment/installed/container and the version strings before
editing), so per HANDOFF §4(d)'s verify-before-editing instruction it
was left untouched.

**Verification (all commands run, zero LLM calls end to end).**
Offline: `npm test` = 712 passing across 77 files (unchanged — no new
offline tests; the drill additions are live-drill checks). `npm run
build`, `npm run python:check` (import list now includes polars —
verified green locally at 1.34.0), `docker compose --profile test
config --quiet` pass. The isolated Compose integration ran as project
`trellis_s27_ci` (host ports 0): the requirements.txt change
invalidated the pip layer as predicted, the image rebuilt (npm ci
layers stayed cached — `package.json` untouched), and all **11**
assertions passed including the new `pinned polars 1.34.0 imports
inside the container venv`; torn down with `--volumes`. Live zero-LLM:
`test:rlm-workspace` **106** (86 baseline + 20), `test:modules` green
with BOTH pins unmoved, `test:answer-channel` 32, `test:textedit` 82,
`test:module-lifecycle` 60, `test:promotion` 41, `test:rlm-mcp` 86,
`test:rlm-sandbox` 21, `test:agent-loop` ALL CHECKS PASSED, `test:a2a`
ALL CHECKS PASSED, `test:repo-ingest` 56, `test:benchmark-hardening`
24, `test:entity-resolution` 34, `test:api-hardening` 18,
`test:belief-recovery` 30, `test:invalidation-sweep` 17. `drill:scale`
read sweep growth **1.99x, gate CLOSED** (in the recorded
~1.48x–2.26x band); the rewritten `scale_drill_results.json` is
committed per house practice. `git diff --check` passes.

**Defects found: none.** One environment note: the fresh worktree's
stale `node_modules` initially resolved `tsx` from the parent
checkout and failed on a missing `dotenv` — `npm ci` in the worktree
fixed it (the documented fresh-worktree step, not a defect).

**Deliberately not included** (the §8 exclusions held): any
representation migration at any boundary; polars imports in src/;
cap raises; asserting on drill timings; the estimation-discipline
positive control (next session, unchanged); module #2 default-selection
entry or edits; extraction re-runs; reconstruction byte changes; a
fifth probe round; frontend work; `ASTRef` migration.

### July 11, 2026 — Session 28: the estimation-discipline positive control (§4 row 6 — machinery + the measured control)

The Session 26 module #2 follow-through: the control machinery landed
zero-paid, and the paired measurement ran the same day under the
session's standing owner approval of paid/owner-gated tests. Branch
`session-28-estimation-control`.

1. **The probe module-arm flag (`TRELLIS_EXP_MODULES`, the
   `TRELLIS_EXP_OMIT_CMT` mold).** New pure
   `src/benchmarks/effective_context/module_arm.ts`:
   `resolveProbeModuleSelection` returns the default selection when
   the flag is unset (the serialized value is byte-identical to the
   probe's historical hardcoded `'["spatial-flywheel"]'` — pinned in
   `module_arm.test.ts`) and otherwise validates the JSON array
   through the ORDINARY `parseModuleSelection` + `loadModules` path
   (shape, max 4, duplicates, registry existence, active status,
   addendum gates) BEFORE any spawn — malformed JSON, unknown names,
   and contested modules refuse the whole invocation spawn-free
   (verified live against `'["ghost-module"]'` and `'{bad'`).
   `armEnv` now takes the runner-resolved canonical `TRELLIS_MODULES`
   serialization and deletes `TRELLIS_EXP_MODULES` from the child env;
   `buildAgentEnv` deletes the flag unconditionally (no config field
   exists — unit-pinned mirroring the `TRELLIS_EXP_OMIT_CMT` pin). NO
   kernel change: both composed-prompt pins unmoved (the ON arm is an
   ordinary operator selection through the ordinary loader).
2. **The `est` suite (sufficiency-bounded, additive).** Five two-part
   questions whose parts share ONE read, over the four durable
   corpora; every earlier suite's question bytes untouched (rounds
   1–4 stay round-comparable; the shared preambles were extracted
   into `frankPreamble`/`ledgerPreamble`/`relationalPreamble`
   byte-identically). Truths + the recorded minimal-evidence bounds
   (1 db call per question, rationale on the constant) live in the
   new pure `src/benchmarks/effective_context/estimation_suite.ts`,
   unit-pinned from committed bytes in `estimation_suite.test.ts`
   (chronicle Kelvorin 163 / Torulf 125; anomaly 8 → Entry 9 with the
   pinned sentence; frank "dreary night" → Chapter 5, Ingolstadt 16;
   ledger Zelvane Wendrick × morrowleaf → 1046 crates / 13 ledgers;
   relational Glasswind → 41,793 crates / 4 captains; distinctness of
   every scored pair enforced loudly — equal values would make
   token-match scoring trivially satisfiable). The est anomaly (8) is
   pinned disjoint from every other suite's anomalies.
   `scripts/test_modules.py` gained section [8]: module #2 loads and
   composes with module #0 through the ordinary loader, brace-safe,
   NOT in the default selection.
3. **The measured control (50 runs, $2.3981 vs the ~$1–2 estimate —
   over estimate, disclosed; the per-invocation $5 abort never
   armed-fired).** 10 chunked invocations (question × module-arm,
   `--repeats 5`, both arms on the pinned default kernel).
   **Correctness 25/25 in BOTH arms. Median db tool calls: on 1 vs
   off 2 pooled (frank question median halved 4 → 2;
   minimal-evidence attainment 15/25 vs 10/25). Pooled median input
   tokens: on 13,240 vs off 9,217 — the token half of the pre-stated
   criterion FAILS pooled**, with the direction REVERSING on the two
   largest-corpus questions (est-led-captain on 13,268 vs off 19,335;
   est-rel-guild on 23,033 vs off 29,287). The 66k on-arm tail run is
   4 iterations re-feeding the 102-hash relational preamble, not an
   attention blowup (2 db calls, 0 subcalls). All 50 runs submitted
   through `trellis_answer` (230/230 cumulative, zero transcription
   errors); zero pandas/polars imports. **Verdict per the recorded
   rule: the criterion is NOT met; module #2 stays OUT of the default
   selection.** The candidacy decision on these numbers (retire vs
   re-scope to large-corpus/aggregate task shapes) is the owner's —
   §4 row 6 stays open on exactly that item. Full tables in the
   probe report's control section; per-invocation `summary.json`
   records `moduleSelection`/`moduleArmFlag`.

**Verification.** Offline: `npm test` = **728 passing across 79
files** (baseline 712/77; +16: module_arm 6, estimation_suite 9, the
`buildAgentEnv` strip pin 1). `npm run build`, `npm run python:check`,
`docker compose --profile test config --quiet` pass. Isolated Compose
integration as project `trellis_s28_ci` (host ports 0): **11/11
PASS**, all image layers cached (`package.json` and `requirements.txt`
untouched), torn down with `--volumes`. Live zero-LLM:
`test:modules` green with section [8] and BOTH pins unmoved
(`3f07295a…4b63` / `85362b81…71bb`), `test:answer-channel` 32,
`test:textedit` 82, `test:module-lifecycle` 60, `test:promotion` 41,
`test:rlm-workspace` 106, `test:rlm-mcp` 86, `test:rlm-sandbox` 21,
`test:agent-loop` ALL CHECKS PASSED, `test:a2a` ALL CHECKS PASSED,
`test:repo-ingest` 56, `test:benchmark-hardening` 24,
`test:entity-resolution` 34, `test:api-hardening` 18,
`test:belief-recovery` 30, `test:invalidation-sweep` 17. Probe plan
mode verified in all three flag states (unset/override/refusals).
`drill:scale`: first reading **2.65x CLOSED** — outside the recorded
~1.48x–2.26x band, so it was re-run per the Session 22 precedent and
came back **1.77x CLOSED** (in-band; the outlier did not reproduce —
most plausibly the day's drill traffic on the shared dev database;
the committed `scale_drill_results.json` is the 1.77x run).
`git diff --check` passes.

**Defects found: one, in this session's own new code, caught by the
zero-paid drill before any spend.** The est branch of
`buildSelectedQuestions` initially never assigned `relationalData`,
and the `&&`-chained guard SILENTLY skipped the whole est question
set ("No questions selected"). Fixed by assigning the data and
replacing the silent guard with a loud refusal (incomplete corpus
loading under est gating now throws). Lesson recorded: a guard that
degrades a wiring error into an empty selection hides the bug —
refuse loudly.

**Deliberately not included** (the §8 exclusions held): adding module
#2 to the default selection (owner's decision on the numbers);
editing module #2's addendum/manifest; any kernel or composed-prompt
change; a fifth probe round (the control is a module measurement —
round numbering untouched); representation migrations; polars
imports in src/; cap raises; extraction re-runs; row-8 coverage
hardening (queued next); frontend work; `ASTRef` migration.
### July 11, 2026 — Addendum to Session 28 (same day, in-session owner adjudication): module #2 RETIRED; direction re-pointed at tooling shape

On the control's numbers the owner retired `estimation-discipline`
outright ("completely useless" as a default-selection candidate) and
rejected the underlying target class: *"prove the prompt text moves
behavior" is not a proper engineering target* — prompt engineering is
not a valid capability increment. The repository's own measurements
agree (probe rounds 2–4: the prompt arm indistinguishable; every
decisive win — `trellis_answer`, `get_ast_blocks`, the suppression
gate, the splice fix — was tooling shape).

**Mechanics of the retirement (this PR):**
`modules/estimation-discipline/module.json` status `active` →
`retired` (the lifecycle transition, not a content edit); the ordinary
loader now REFUSES composition (`test:modules` [8] rewritten to pin
the refusal — the historical record, the 19 pinned research hashes,
and the parse-vs-load distinction; both composed-prompt pins never
felt any of it); `module_arm.test.ts` re-pinned (the historical
ON-arm selection now refuses through the real registry; the
active-module path re-proven with `workspace-discipline`);
`modules:verify` shows `module:estimation-discipline (version 1;
manifest: status retired), contested: false` — the graph entity stays
as the historical record (module entities are contested or retired,
never deleted). RESEARCH.md carries the retirement note.

**Recorded successor directions (owner-endorsed, pending scheduling —
NOT self-serve):**

1. **Kernel-level retrieval discipline** — mechanical closure of the
   behavior module #2 nudged: tool-layer dedup (a re-fetch of an
   already-held root serves from held state or refuses with a typed
   pointer) and a per-run retrieval budget with a typed over-budget
   refusal carrying the held-state inventory. The Session 28 `est`
   suite + minimal-evidence bounds are the acceptance harness
   (criterion: repeat-fetches 0 by construction, tokens ≤ baseline,
   correctness non-inferior).
2. **Mechanical provenance threading** (the collaborator briefing's
   item 2, already logged as a candidate architecture session) — the
   LAST transcription channel: `write_derived_insight` still takes
   model-asserted `sourceNodeIds`; thread addresses from the
   retrieval set by plumbing, constrain citable addresses to what the
   deriving run actually retrieved, sampled entailment for the
   semantic residual.

Prompt-module authoring is DEPRIORITIZED as a capability increment;
the module registry, gates, and flywheel machinery stay (they are the
mechanism for any future module class, including tool-bearing ones),
but no new protocol-module authoring turn is proposed without
explicit owner request.

### July 12, 2026 — Session 29: self-editing toolkit coverage hardening (§4 row 8)

The July 11 coverage audit's recorded priority items closed, all
zero-paid, three commits (CI wiring / kernel hardening / drill pins) —
the toolkit hardened before the source-editing flywheel (row 11)
deepens on it.

1. **CI wiring (audit #7, first commit).**
   `.github/workflows/ci.yml`'s `offline` job now runs
   `npm run test:textedit` directly after the existing Python-runtime
   install step (the drill needs no database or network). Zero new
   tests in this commit; the whole drill became regression-detected.
2. **`write_back` hardening (audit #2/#3/#4, kernel change — witting,
   its own commit).** All three closed INSIDE the existing contract:
   `StaleFileError` semantics, temp + rename atomicity, and the
   Session 26 splice semantics (refuse only `"
"`) did not move, and
   `TEXTEDIT_ADDENDUM` is byte-unchanged (both composed-prompt pins
   untouched: default `5d27e474…fe2a`, omit-arm `45987904…0b56`).
   (a) **Write-time containment (audit #3):** `write_back` re-runs the
   load-time `_resolve` against the CURRENT filesystem — a parent
   directory swapped for a symlink after load is refused at write
   time; additionally a path that resolves DIFFERENTLY than at load is
   refused as stale even when the target's bytes are identical (the
   in-root swap the digest guard alone cannot see). (b) **Mode
   preservation (audit #4):** the source's `stat.S_IMODE` is carried
   onto the mkstemp temp file (created 0600) before `os.replace` — the
   executable bit on a script or hook no longer vanishes on every
   edit; Windows mode bits are a harmless no-op. (c) **The narrowed
   TOCTOU window (audit #2):** the digest is re-checked immediately
   before `os.replace`, so a second writer landing while the temp file
   was being built is DETECTED (StaleFileError, temp unlinked, disk
   untouched) instead of overwritten. Honesty per the audit's own
   framing: the residual race between the final re-hash and
   `os.replace` remains — full elimination needs OS file locking,
   deliberately out of scope — and is documented in the `write_back`
   docstring and CODE_MEDIATED_TEXT.md §6 item 1, not claimed closed.
3. **Drill extension (`scripts/test_textedit.py` 82 → 105 checks on
   this Windows host; 106 on POSIX, where the executable-bit check
   also runs).** Section [11] pins each hardening behavior — mode
   preservation, the outside-root symlink-swap refusal (outside file
   untouched, no temp residue), the in-root resolution-change refusal,
   deterministic second-writer detection (a wrapped `mkstemp` lands
   the mutation inside the narrowed window), and no orphaned temp file
   after a refusal (the refusal-path half of audit #10, pinned in
   passing). Section [12] pins multi-file partial-failure semantics
   (audit #5) as INTENTIONAL per-file independence, in both orders:
   file A lands although B refuses (B keeps the second writer's bytes
   and its staged splice for re-derivation), and a refusal first never
   blocks a later independent write. Section [13] adds one adversarial
   check per previously untested guard branch (audit #6: boolean
   line/splice indexes, a boolean constructor bound, a non-string
   locate pattern, a non-string path, a non-string `new_lines`
   element, reload-discards-staging) — each fails if its branch is
   deleted, the cheap deterministic core of mutation coverage with
   zero new dependencies — plus the audit-#8 hygiene item: the
   toolkit's import set is pinned to an exact stdlib allowlist and its
   source must carry no git or subprocess token (the no-git guarantee
   now held by a check, not inspection).
4. **Audit disposition after this session:** #2 narrowed + documented,
   #3/#4/#5/#6/#7/#8 closed, #10 half-closed (refusal-path cleanup
   pinned; the abnormal-kill orphan stays unpinned hygiene), #9
   (content-borne injection) untouched — the Session 26 W4 live
   refusal stands as the evidence of record; #1 (cross-process
   isolation) is a proof run, owner-gated propose-with-estimate, never
   self-served.
5. **Acceptance (all green, commands per HANDOFF §6).** Offline:
   `npm test` 729 passing across 79 files observed BEFORE any Session
   29 change (the HANDOFF-recorded 728 was one short of the post-PR-69
   suite; no Session 29 change touches the unit suite), `npm run
   build`, `npm run python:check`,
   `docker compose --profile test config --quiet`. Live zero-paid:
   `test:answer-channel` 32, `test:textedit` 105 (was 82),
   `test:module-lifecycle` 60, `test:modules` green (section [8]
   refusal pinned, both prompt pins unmoved), `test:promotion` 41,
   `test:rlm-workspace` 106, `test:rlm-mcp` 86, `test:rlm-sandbox` 21,
   `test:agent-loop` 35 (ALL CHECKS PASSED), `test:a2a` 46 (ALL CHECKS
   PASSED), `test:repo-ingest` 56, `test:benchmark-hardening` 24,
   `test:entity-resolution` 34, `test:api-hardening` 18,
   `test:belief-recovery` 30, `test:invalidation-sweep` 17.
   `drill:scale` 1.97x CLOSED (in-band ~1.48x–2.26x; max provenance
   286; results file committed per house practice). Isolated Compose
   integration run as project `trellis_s29_ci` (host ports 0, torn
   down with `--volumes`): 11/11 PASS, every image layer cached (no
   manifest changed). `git diff --check` clean. No defect found in
   existing code — the audit's gaps were coverage gaps, and every
   pre-existing guard held under the new adversarial checks; the
   three hardening behaviors added enforcement where none existed.
6. **Documentation window (owner rule, July 12).** The Session 24 §5
   entry moved VERBATIM to `docs/archive/ROADMAP_HISTORY.md` (the
   live ledger keeps the most recent five sessions: 25–29); HANDOFF
   regenerated for row 9 with Session 24 compressed into its digest.

### July 12, 2026 — Session 30: mechanical provenance threading — the design record + retrieval-set tracking (§4 row 9, slices a + b)

Row 9's first two recorded slices, all zero-paid, two implementation
commits (the record, then the tracking), per the owner's
decompose-into-completable-slices direction.

1. **Slice (a) — the design record**
   (`docs/architecture/PROVENANCE_THREADING.md`, indexed in
   `docs/README.md`), document-first per the house DDD pattern. What it
   decides and records: **(i) the threat model as a two-channel
   taxonomy** — T1 transcription/choice (the model retypes an address:
   corrupted digits, scrollback memory, second-hand citation of another
   edge's provenance list — closable mechanically and completely) vs
   T2 semantic laundering (retrieved-but-unsupporting bytes cited —
   the A/B eval measured the readership gate flagging ZERO laundered
   runs because the model reads the decoy then cites it; only
   entailment catches T2). The record is explicit that the slice-(d)
   constraint closes T1, NOT T2 — the honest scope statement is in the
   record so nobody later claims more than the machinery delivers.
   **(ii) The claim→block factorization** (the collaborator briefing's
   live question): membership (`cited ⊆ retrieved(run)`) is engine-
   decidable and made total; support (`supports(text(h), claim)`) is
   structurally NOT engine-decidable (a claim is new text — no taint
   trail from retrieved bytes through attention), so it is sampled
   (slice e). Intermediate dataflow-narrowing designs were considered
   and rejected on §4.5 data-not-objects grounds. **(iii) The
   retrieval-set definition**: `get_ast_texts` returned keys
   (existence-filtered by construction), `get_ast_blocks` returned
   block ids (never the root argument — bytes for address, uniformly),
   `vector_search` result ids (content travels with them). Never
   contributing: `ast_hashes_exist` (probe-then-cite loophole),
   `fetch_texts` (harness plumbing), `run_cypher` (a `sourceNodeIds`
   property in a query result is a reference to bytes, not the bytes —
   re-read before citing, mechanically enforcing read-before-cite at
   the address level), MCP/workspace/textedit (Tier 3 has no
   standing), and seeded snapshots (a seeded run inherits NOTHING —
   a re-derivation re-retrieves). **(iv) Set semantics**: per run =
   per process (the `_tool_call_stats` mold); `llm_query` sub-frames
   at `max_depth` 1 are plain completions so process scope = run scope
   holds trivially (and nested tool-bearing frames would correctly
   join the same set); monotone within the run, dies with the process,
   never parked (a retrieval set in a snapshot would be a provenance
   claim Tier 3 cannot make). **(v) Slice (d)'s shape recorded**:
   membership check after format + existence, a typed `ValueError`
   naming unretrieved hashes (bounded first-5+count echo) teaching
   re-retrieval, wired by the `ast_existence_check` injection mold so
   bare construction (operator scripts, drills) is unaffected; no
   compat migration — write-time only, existing rows untouched.
   **(vi) Slice (e)'s sketch**: sampled post-hoc DETECTOR (flagged
   edges enter the ordinary contested machinery, never deleted), the
   inline gate stays experiment-gated for where a count incentive
   cannot be removed (the eval measured it correct but ~1.5–2× cost
   and it uncaches facts under impossible demands); rate/budget
   proposed with the slice's estimate, owner-gated. Row 10's
   held-root tracking is recorded as a DIFFERENT structure sharing
   call sites, not the set — nothing pre-implemented.
2. **Slice (b) — retrieval-set tracking** (`src/rlm/trellis_tools.py`):
   a module-level always-on `_retrieved_addresses` set fed INSIDE
   `_audit_add` when the bucket is `read` or `search` — the exact seam
   the opt-in citation audit already maintains at the three
   contributing call sites; one function, one lock, no parallel
   instrumentation. The `cited` bucket never feeds it. Unlike the
   audit buckets the set is NOT experiment-gated (slice d will consult
   it on every run); the audit's own gating and `get_citation_audit`
   semantics are byte-unchanged. Accessors return a copy and a count;
   `TRELLIS_TELEMETRY` gains counts-only `retrieved_addresses` in the
   `mcp_calls`/`answer_submits` mold (both research and author
   payloads; addresses never appear — T16), and the Node scanner's
   unknown-field tolerance — previously structural only — is now
   pinned explicitly (`rlm_telemetry.test.ts`, 9 → 10 tests). NO
   write-path behavior change, NO prompt bytes: both composed-prompt
   pins unmoved (`5d27e474…fe2a` / `45987904…0b56`).
3. **Pins** — `test:rlm-sandbox` section [5], 21 → 40 checks, all live
   against the dev stack: Cypher reads + existence checks +
   provenance-cited writes contribute nothing (including a live Cypher
   read that demonstrably surfaces the probe hash as a `sourceNodeIds`
   property); `get_ast_texts` adds exactly its returned keys (unknown
   hash excluded); repeat retrieval is inert (set semantics);
   `get_ast_blocks` adds the returned block id and never the root
   argument (a probe root row with an embedded paragraph child);
   `vector_search` drilled ZERO-PAID — a probe row inserted with a
   deterministic 1536-dim embedding and the `openai` module stubbed in
   `sys.modules` (the in-function import binds the stub; cosine
   distance 0 guarantees the probe is the top hit), every returned id
   joins the set; `ast_hashes_exist` stays outside even mid-run; the
   accessor returns a copy; audit buckets stay EMPTY while the
   always-on set is populated (the gating separation pinned); static
   pins in the Session 29 audit-#8 mold (the three Tier-3 modules
   never reference the tracking seam; the agent telemetry dict carries
   the field). Drill cleanup now deletes by the drill-owned
   `document_id` (covers the two new probe rows).
4. **Acceptance (all green, July 12, 2026).** `npm test` 730 passing /
   79 files (baseline 729/79 — the one new test is the telemetry
   tolerance pin), `npm run build`, `npm run python:check`,
   `docker compose --profile test config --quiet`. Live zero-paid:
   `test:answer-channel` 32, `test:textedit` 105 (Windows host),
   `test:module-lifecycle` 60, `test:modules` green (pins unmoved),
   `test:promotion` 41, `test:rlm-workspace` 106, `test:rlm-mcp` 86,
   `test:rlm-sandbox` 40 (was 21), `test:agent-loop` 35 (ALL CHECKS
   PASSED), `test:a2a` 46 (ALL CHECKS PASSED), `test:repo-ingest` 56,
   `test:benchmark-hardening` 24, `test:entity-resolution` 34,
   `test:api-hardening` 18, `test:belief-recovery` 30,
   `test:invalidation-sweep` 17. `drill:scale` run ALONE: 1.89x CLOSED
   (in-band ~1.48x–2.26x, first try; max provenance 286; results file
   committed per house practice). Isolated Compose integration as
   project `trellis_s30_ci` (host ports 0, torn down with
   `--volumes`): 11/11 PASS (no manifest changed — `package.json` and
   `requirements.txt` untouched). `git diff --check` clean. No defect
   found in existing code; the section [5] checks all passed on first
   run.
5. **Documentation window (owner rule, July 12).** The Session 25 §5
   entry moved VERBATIM to `docs/archive/ROADMAP_HISTORY.md` (the live
   ledger keeps the most recent five sessions: 26–30); HANDOFF
   regenerated for the row-9 continuation (slice c next) with Session
   25 compressed into its digest.

### July 12, 2026 — Session 31: mechanical provenance threading — the slice (c) adjudication + the slice (d) write-path constraint (§4 row 9)

Row 9's next two recorded slices, all zero-paid, three commits (the
verdict, the gate, the pins). No paid spend.

1. **Slice (c) — ADJUDICATED: SATISFIED BY EXISTING SHAPE** (recorded
   in `PROVENANCE_THREADING.md` §9, dated, amending §5.2 — no carriage
   gap, no implementation, no prompt byte). The inspection covered
   every surface that re-presents retrieved Tier-1 bytes to a writing
   run, each claim verified against the named code: **(i)** the three
   retrieval tool returns already thread address-with-content
   (`get_ast_texts` hash-keyed map; `get_ast_blocks` `{id, type,
   text}` per block; `vector_search` `{id, content}` rows — no
   retrieval surface returns bytes without their address); **(ii)**
   the workspace holds no Tier-1 retrievals by construction —
   `capture()` is invoked from exactly one place, inside
   `trellis_mcp.call_tool`, so segments hold MCP results only;
   database reads return directly to the REPL and are never
   workspace-captured; `add_note` is model-authored Tier-3 with no
   provenance standing by design; a "gap" here would mean BUILDING a
   new carriage surface, which the adjudication was explicitly not
   permitted to invent; **(iii)** the rlms scaffold
   (`local_repl.py`, rlms==0.1.3) performs no separate rendering of
   tool results — injected tools return values into the model's own
   REPL code and the transcript sees only that code's stdout/stderr
   (`execute_code` → `REPLResult`), so no harness rendering strips
   adjacency; **(iv)** the author path seeds one segment per corpus
   block with the block hash's first 16 hex as the engine-stamped
   origin argsHash, constructs no DB tools, and has no write path —
   nothing slice (d) needs. The §5.2 constraint (headers
   engine-stamped, never model-written) survives for any FUTURE
   surface.
2. **Slice (d) — the retrieval-membership write gate**
   (`src/rlm/trellis_tools.py` + the `trellis_agent.py` wiring;
   implemented exactly as §5.3 recorded, not re-designed).
   `TrellisNeo4j` gains a `retrieved_addresses_check` constructor seam
   in the `ast_existence_check` injection mold — a callable returning
   the run's current retrieved-address set (slice (b)'s
   `get_retrieved_addresses`, a copy per call). The check runs in
   `_run_insight_writes` AFTER `_verify_hashes_exist` and the
   cited-attempt audit (the A/B eval's measure-the-attempt
   discipline) and BEFORE the `CITATION_HINT`/`CITATION_ENTAIL`
   experimental gates; order pinned: format → existence → retrieval
   membership → experimental gates → write. The refusal is a typed
   `ValueError` in the Session 14 mold: "Provenance Violation", the
   unretrieved hashes bounded (first 5 + `+N more`), and the teaching
   remedy (call `get_ast_texts`, confirm the bytes support the claim,
   re-derive and cite). One unretrieved hash refuses the whole batch
   before any session opens; fail fast, no partial write. Wiring is
   explicit construction at the agent only — `trellis_agent.py` wires
   it beside `ast_existence_check` for research runs; bare
   `TrellisNeo4j(...)` (operator scripts, drills, harness paths)
   passes None and writes exactly as before. HONESTY (guardrail 8 /
   record §1): this closes T1 (transcription/choice — corrupted
   digits, scrollback hashes, second-hand citation of graph-surfaced
   provenance lists); it does NOT close T2 (read-then-cite
   laundering) — that is slice (e)'s sampled entailment tier.
   `TRELLIS_CITATION_HINT` untouched (different set, different
   gating — the A/B artifact). NO prompt bytes, both composed-prompt
   pins unmoved (`5d27e474…fe2a` / `45987904…0b56`); no telemetry
   beyond slice (b)'s count (a refusal is a raised ValueError the run
   recovers from in-REPL — record §5.5).
3. **Pins** — `test:rlm-sandbox` section [6], 40 → 53 checks, all live
   against the dev stack, all green on first run: a gated client
   (constructed exactly as the agent wires research runs) refuses an
   existent-but-unretrieved hash with the full typed message (named
   offender + teaching sentence), leaving NO partial graph state; the
   echo is bounded at seven offenders (`+2 more`); check order pinned
   (a nonexistent hash reports the EXISTENCE violation, never the
   retrieval one); the cited audit bucket records the refused ATTEMPT
   when the audit is enabled (module flag flipped and restored inside
   the drill — the env default stays unset); the SAME write succeeds
   after `get_ast_texts` retrieves the hash (the taught remedy works);
   a batch with one unretrieved hash refuses entirely (the retrieved
   fact is not written either — graph verified empty); a
   bare-constructed client writes an unretrieved hash exactly as
   before (the injection-mold pin); and a static pin holds the agent
   wiring (`retrieved_addresses_check=get_retrieved_addresses`).
   Sections [1]–[4] keep their existence-only client deliberately
   (they write before anything is retrieved); its stale "the
   trellis_agent.py wiring" comment was corrected to say so.
4. **Acceptance (all green, July 12, 2026).** `npm test` 730 passing /
   79 files (no new unit test — the session's pins are drill-level by
   design), `npm run build`, `npm run python:check`,
   `docker compose --profile test config --quiet`. Live zero-paid:
   `test:answer-channel` 32, `test:textedit` 105 (Windows host),
   `test:module-lifecycle` 60, `test:modules` green (pins unmoved),
   `test:promotion` 41, `test:rlm-workspace` 106, `test:rlm-mcp` 86,
   `test:rlm-sandbox` 53 (was 40), `test:agent-loop` 35 (ALL CHECKS
   PASSED), `test:a2a` 46 (ALL CHECKS PASSED), `test:repo-ingest` 56,
   `test:benchmark-hardening` 24, `test:entity-resolution` 34,
   `test:api-hardening` 18, `test:belief-recovery` 30,
   `test:invalidation-sweep` 17. `drill:scale` run ALONE: 2.09x CLOSED
   (in-band ~1.48x–2.26x, first try; max provenance 286; results file
   committed per house practice). Isolated Compose integration as
   project `trellis_s31_ci` (host ports 0, torn down with
   `--volumes`): 11/11 PASS (no manifest changed — all layers cached).
   `git diff --check` clean. No code defect found — every new check
   passed on first run. One DOC defect found and fixed: the §5 intro
   paragraph still read "through Session 24" although the Session 25
   entry had already moved with the Session 30 PR; corrected as part
   of this session's window move.
5. **Documentation window (owner rule, July 12).** The Session 26 §5
   entry moved VERBATIM to `docs/archive/ROADMAP_HISTORY.md` (the live
   ledger keeps the most recent five sessions: 27–31); HANDOFF
   regenerated for the row-9 remainder (slice (e) owner-gated
   propose-with-estimate + the slice (f) verify-and-strike, then row
   10) with Session 26 and its same-day follow-on compressed into the
   digest.

### July 12, 2026 — Session 32: mechanical provenance threading FINISHES — the slice (e) sampled-entailment detector + the slice (f) compat verify-and-strike (§4 row 9 closed)

Row 9's remainder, all machinery zero-paid, four commits (the drill
repair, the detector, the pins, the docs). No paid spend; the first
real judged sweep stands PROPOSED owner-gated (item 3).

0. **Pre-existing defect found and fixed FIRST (its own commit).**
   `test:verification-sweep` had been broken since the Session 14
   format enforcement landed (July 7): the drill seeded beliefs whose
   `sourceNodeIds` were token-scoped strings
   (`test-verify-<ts>-hash-qa`), which `_normalize_fact` refuses
   (`^[0-9a-f]{64}$`). The drill was absent from every close-out block
   since, so the breakage went unobserved — found by this session's
   first run into its own target area. Fix: provenance hashes are now
   sha256 digests of the token-scoped names (real 64-hex, unique per
   run, token-scoped teardown unchanged). All 35 pre-existing checks
   pass again. The drill joins the standing close-out block from this
   session on (the HANDOFF §6 instruction), so it cannot silently rot
   again.
1. **Slice (e) — the sampled entailment detector**
   (`src/core/graph/entailment_detection.ts`, the verification-sweep
   mold; the finalized design decisions recorded in
   `PROVENANCE_THREADING.md` §9 amending §5.4, per §4's
   decide-and-record-before-code instruction). The T2 residual tier: a
   post-hoc DETECTOR over persisted DERIVED_INSIGHT (edge, cited-hash)
   pairs — never a write gate, never a delete. The candidate pool is
   every non-contested DERIVED_INSIGHT edge with provenance (uniform
   class, `has_category` included — the verification sweep asks a
   different question of the same edges); the pure sampler expands
   unchecked pairs (cited minus judged, deduped), samples each at the
   operator-visible rate, and hard-caps selection at the judge budget
   with the overflow counted as `deferred`, never silently dropped
   (seeded `mulberry32` RNG for deterministic drills). Each pair is
   judged AT MOST ONCE, ever: a supported verdict appends the hash to
   the edge's additive `entailmentCheckedHashes`
   (+ `entailmentCheckedAt`); an unsupported verdict contests the edge
   through the ordinary Phase 4/5 transition with the typed reason
   `unsupported_citation` and appends the hash to the durable
   `unsupportedHashes` audit (+ `entailmentFlaggedAt`). Provenance
   fields are never mutated; recovery is re-derivation; a recovered
   edge never flaps back into contest over an already-judged pair (the
   `unsupportedHashes` record carries the finding for the human gate).
   The judge is one bounded completion per sampled pair through
   `parseLlmResponse` (`EntailmentResponseSchema`, the
   `make_entailment_check` prompt shape — the semantic reference; the
   `TRELLIS_CITATION_*` env flags untouched), with judge-all-then-write
   atomicity: every verdict is collected before any write, so an
   infrastructure failure aborts with ZERO partial state. Oracle mode
   (`makeOracleEntailmentJudge`, a pair-key -> verdict map) drills the
   whole path zero-LLM. Config twins `ENTAILMENT_SAMPLE_RATE` (0.1,
   the record's strawman) and `ENTAILMENT_JUDGE_BUDGET_PER_SWEEP`
   (25, max 500). Transport: the `entailment_sweep` job name on the
   existing `verification_queue`/worker — every other job name
   processes byte-identically; counts-only metric
   `trellis_entailment_pairs_total{result}` (T16: hashes never in
   labels or pino log content; the operator CLI prints them, the
   `promote` precedent). Scheduler `scripts/entailment_sweep.ts`
   (`npm run entailment:sweep`: `--rate`, `--budget`, `--seed`,
   `--prefix`, `--oracle`, `--sync`, `--dry-run`).
2. **Slice (e) pins.** Unit level (`entailment_detection.test.ts`, 10
   tests, `npm test` 730 → 740): pair expansion/dedup, the
   judged-at-most-once pool definition (a checked pair is never
   re-selected; a NEW hash on a re-derived edge is), per-edge pair
   identity, seeded determinism, rate-0 counting, the budget cap with
   deferred overflow, the pair key, oracle verdict/decline semantics.
   Drill level (`test:verification-sweep` sections [7]–[9], 35 → 66
   checks, all green on FIRST run): a planted unsupported citation
   (real ingested bytes, wrong claim — invisible to the existence and
   retrieval layers by construction) is flagged with the typed reason,
   the unsupported hash recorded, `sourceNodeIds` and the orphan
   ledger untouched, the supported pair on the SAME edge still
   stamped; contested edges and checked pairs leave the pool; recovery
   composes with the slice (d) gate (an unretrieved re-derivation is
   refused "Provenance Violation", a retrieval-gated one recovers the
   edge, the audit survives recovery, no contest flap); a judge
   infrastructure failure raises and contests NOTHING; the budget
   defers loudly; dead-byte pairs are skipped and counted; the
   entailment job name round-trips through the real worker over
   Redis/BullMQ (the worker/queue now close at the END of the drill so
   section [9] shares section [6]'s worker).
3. **The measured sweep — RAN July 13, 2026, owner-approved (the
   standing proposal executed the next day; proposal record: dev-graph
   dry-run read 283 non-contested DERIVED_INSIGHT edges / 566 unchecked
   pairs, default policy = 25 judge calls, estimate ≈ $0.02–$0.05).**
   Selection reproduced the recorded dry-run
   (`npm run entailment:sweep -- --sync --seed 32`): 60 sampled, 25
   within budget (35 deferred). Judged 25/25 — 8 supported, 17
   flagged, 15 edges contested; zero skips, zero judge failures,
   whole-batch atomicity held. ACTUALS: 2,176 input + 375 output
   tokens = $0.0093 (vs the $0.02–$0.05 estimate; the sync CLI now
   prints usage tokens — patched in this PR). Every flagged block was
   then verified against its stored bytes; the 17 flags decompose
   into two classes: **(i) 9 CONFIRMED weak citations** — the cited
   block is a HEADING whose entire text is the question id (e.g.
   bytes "q_0034" cited as provenance for `q_0034 mentions cairo`):
   real ingested bytes that do not support the claim, invisible to
   the format/existence/retrieval layers BY CONSTRUCTION — exactly
   the wrong-block class the detector was built to surface (the
   OOLONG-era extraction attributed facts to heading blocks alongside
   body blocks); **(ii) 8 strict-judge verdicts on
   derived-classification claims** — question-body paragraphs flagged
   for `has_category` (e.g. "What does HTTP stand for?" vs
   `has_category abbr`): the text supports the classification
   semantically but does not STATE it, and the judge (the recorded
   `make_entailment_check` prompt shape) reads "state or directly
   support" strictly. Recorded as a calibration observation for a
   future owner-picked decision (a classification-aware judge
   variant vs accepting conservative contests — recovery is one
   re-derivation either way); the judge prompt shape is NOT changed
   now. The 15 contested edges are OOLONG-era cache rows on the dev
   graph — standard lazy-recovery residue (a re-derivation citing the
   body block recovers each). No machinery defect: every behavior
   matched the section [7]–[9] pins.
4. **Slice (f) — compat VERIFIED against the code, no gap, row 9
   struck.** Every §5.3/§5.5 claim checked (the Session 27
   verify-first standard): **(i)** the (d) gate is write-time only —
   `_verify_hashes_retrieved` has exactly one caller
   (`_run_insight_writes`, `trellis_tools.py:396`); no sweep,
   migration, or read path references it; existing insight rows are
   never re-checked (the detector's stamps are additive audit
   properties, not migrations). **(ii)** Envelopes additive only —
   `TRELLIS_RESULT` is exactly `{status, answer, toolCalls}`
   (`trellis_agent.py:582–594`, no slice-(d) field);
   `TRELLIS_TELEMETRY` gained only slice (b)'s counts-only
   `retrieved_addresses` (both research and author payloads); a gate
   refusal is a raised ValueError the run recovers from in-REPL.
   **(iii)** No pre-threading writer class — the only gated
   construction is the agent's research-run wiring
   (`trellis_agent.py:413–417`); every other `TrellisNeo4j(`
   construction site (drills, probes, operator scripts, the poison
   drill runner) is bare/existence-only BY DESIGN under the injection
   mold, not a compat class; the TypeScript extraction door
   (`mergeWithAstLivenessFence`) is out of scope per the record §7.
   Nothing needed correcting in the record, so its §9 carries only the
   slice (e) decisions entry.
5. **Acceptance (all green, July 12, 2026).** `npm test` 740 passing /
   80 files (was 730/79), `npm run build`, `npm run python:check`,
   `docker compose --profile test config --quiet`. Live zero-paid:
   `test:answer-channel` 32, `test:textedit` 105 (Windows host),
   `test:module-lifecycle` 60, `test:modules` green (pins unmoved),
   `test:promotion` 41, `test:rlm-workspace` 106, `test:rlm-mcp` 86,
   `test:rlm-sandbox` 53, `test:verification-sweep` 66 (was 35 — and
   was BROKEN at session start, item 0), `test:agent-loop` 35 (ALL
   CHECKS PASSED), `test:a2a` 46 (ALL CHECKS PASSED),
   `test:repo-ingest` 56, `test:benchmark-hardening` 24,
   `test:entity-resolution` 34, `test:api-hardening` 18,
   `test:belief-recovery` 30, `test:invalidation-sweep` 17.
   `drill:scale` run ALONE: 2.04x CLOSED (in-band ~1.48x–2.26x, first
   try; max provenance 286; results file committed per house
   practice). Isolated Compose integration as project `trellis_s32_ci`:
   11/11 PASS (`package.json` changed — the npm ci layer rebuilt as
   expected; the pip layer stayed cached). `git diff --check` clean.
6. **Documentation window (owner rule).** The Session 27 §5 entry
   moved VERBATIM to `docs/archive/ROADMAP_HISTORY.md` (the live
   ledger keeps the most recent five sessions: 28–32); HANDOFF
   regenerated for row 10 (kernel-level retrieval dedup + budgets —
   the owner-approved step 3 of 4) with Session 27 compressed into the
   digest.

### July 13, 2026 — Session 33: kernel-level retrieval discipline — held-state dedup + the per-run budget (§4 row 10; machinery + pins zero-paid, the acceptance measurement proposed owner-gated)

The mechanical closure of the behavior the retired module #2 nudged
(the Session 28 control: median db calls 2 vs the recorded
minimal-evidence bound of 1 with no discipline; frank median 4 — all
whole-call repeats), per the owner's permanent tooling-shape
direction. Three implementation commits + docs, no prompt byte, zero
paid spend.

1. **Slice (a) — the design record, document-first.**
   `docs/architecture/RETRIEVAL_DISCIPLINE.md` ratified (indexed in
   docs/README.md; PROVENANCE_THREADING.md §4 now cross-references it,
   closing that record's forward note). Load-bearing decisions, each
   with its recorded reason: held state answers "were these bytes
   already served this run" and holds IDENTITIES only (hashes, roots,
   query strings — never content: serving from held state would need a
   store mirror the pillar forbids, so repeats REFUSE, never re-serve);
   request identities are per-hash **full-repeat-only** for
   `get_ast_texts` (partial overlap serves EVERYTHING byte-identically
   — serving the remainder would silently change the returned shape
   mid-run, refusing the whole call would burn a scarce REPL iteration;
   the measured failure class is whole-call repeats), per-root for
   `get_ast_blocks` (THE measured case; served block ids also join held
   addresses, the root argument never does — the Session 30 shape), and
   **exact-query-match only** for `vector_search` (semantic
   near-duplicate detection is a semantic judgment, not plumbing —
   excluded by decision; result ids never join held addresses because
   read-after-search is the confirm-before-cite pattern the Session 31
   write-gate refusal explicitly teaches). The recorded evasion is
   pinned honestly: padding a repeat with a never-held hash passes —
   teaching machinery in the write-gate mold, not a security boundary.
   Scope: per run = per process, module-level under its own lock (a
   sibling of the audit lock at the same call sites — `_audit_add`'s
   contract untouched), dies with the process, never parked; seeded
   runs inherit nothing.
2. **Slices (b)+(c) — the machinery** (`trellis_tools.py`; config
   twins in `src/config/index.ts` + `src/workers/rlm_job.ts`).
   Activation is one explicit constructor decision in the
   `retrieved_addresses_check` injection mold:
   `TrellisPostgres(retrieval_discipline=True, retrieval_budget=N)`
   enables dedup AND budget together; bare construction is
   byte-identical to before the machinery existed (recording and
   checking both happen only on disciplined instances). Refusals are
   typed `ValueError`s with the uniform `Retrieval Discipline:` prefix,
   bounded echo (first 5 + `+N more`), and the binding-reuse teaching
   sentence. The budget counts byte-returning fetches only (dedup
   refusals and empty returns consume nothing), kernel default
   `RETRIEVAL_BUDGET_DEFAULT = 64` / cap 1024, refuses at budget+1
   BEFORE any I/O with counts + a bounded held-root echo; check order
   pinned validation → dedup → budget → fetch (a repeat on an exhausted
   instance gets the DEDUP refusal — the actionable teaching). Env twin
   `TRELLIS_RETRIEVAL_BUDGET_PER_RUN` (Zod optional int ≤1024 +
   the Python `parse_retrieval_budget()` twin with identical bounds;
   `buildAgentEnv` forwards it ONLY when the operator set it and strips
   any inherited value otherwise). Research runs wire the discipline ON
   in `trellis_agent.py` (author mode constructs no DB tools);
   `TRELLIS_EXP_OMIT_RETRIEVAL=1` is the probe-runner-only OFF arm in
   the `TRELLIS_EXP_OMIT_CMT` mold — no config field, `buildAgentEnv`
   deletes it unconditionally (unit-pinned). Telemetry gains six
   counts-only fields (`retrieval_fetches`, `retrieval_dedup_refusals`,
   `retrieval_budget_refusals`, `held_addresses`, `held_roots`,
   `held_queries`) in both payloads; the Node scanner's unknown-field
   tolerance is already pinned. Guardrail 4 holds structurally: held
   state never feeds, filters, or gates the Session 30 retrieval set or
   the Session 31 write gate — a refused re-fetch changes nothing about
   citability. The vector_search constructor validates the budget
   BEFORE the connection opens so a refused bound never leaks one.
3. **Pins.** `test:rlm-sandbox` new section [7], 53 → 95 live checks,
   all green on FIRST run: the env-twin bounds (default when unset;
   refusals for malformed/zero/negative/over-cap; the constructor
   bound), first-fetch byte-identity against a bare instance on all
   three surfaces, the typed dedup refusals (bounded echo at 7 held
   hashes, teaching sentence), partial-overlap serve-everything, the
   padding evasion pinned honestly, cross-surface held addresses
   (`get_ast_texts` on exactly the served block ids repeats;
   `get_ast_texts([root])` after `get_ast_blocks(root)` serves),
   exact-query search dedup (rephrased query serves; the search-hit
   read-back serves — the taught pattern), the budget+1 refusal with
   counts + held-root echo, dedup-wins-on-exhausted order, refusals
   consuming no budget, the section [5]/[6] invariants re-proven under
   the new machinery (a dedup refusal leaves the retrieval set
   unchanged; disciplined serves still feed it; a dedup-refused hash
   still writes through the gated client), the injection-mold
   bare-construction pins, refused calls still counting as tool
   invocations, accessor copy semantics, and the static agent-wiring /
   telemetry / OFF-arm / Tier-3-seam pins. Unit level: 3 new
   `buildAgentEnv` pins (`npm test` 740 → 743 across 80 files).
4. **Slice (d) — the acceptance measurement stands PROPOSED,
   owner-gated (criterion recorded here BEFORE any spend).** The
   Session 28 `est` suite re-run as a paired measurement: 5 questions ×
   2 arms × `--repeats 5` = 50 runs. ON arm = the default kernel
   (discipline wired, budget at the kernel default 64); OFF arm = the
   identical invocation with `TRELLIS_EXP_OMIT_RETRIEVAL=1` in the
   probe runner's own environment (the runner's `armEnv` spreads its
   process env and strips only the flags it manages, so the flag
   reaches the spawned agent with zero runner change; each run's
   TRELLIS_TELEMETRY discipline counts verify the arm it actually ran
   under — the arm assignment is observable per run, not assumed).
   Pre-stated criterion: (i) repeat-serves 0 by construction on the ON
   arm (dedup refusal counts reported as observed); (ii) pooled median
   input tokens ON ≤ OFF; (iii) correctness non-inferior (ON ≥ OFF) —
   db calls and correctness reported TOGETHER, never calls alone, and
   never rewarding LOW counts (the Session 28 symmetric rule).
   Estimate: ~$2.40 (the Session 28 control's measured band — same
   suite, same shape, same repeats), under the standing ≤$5/run cap;
   actuals to be disclosed against the estimate. Run only on owner
   approval; row 10 is struck with the machinery landed and this
   proposal recorded, per the §6 close-out rule.
5. **Defects found: none in existing code; one design-stage defect
   caught by review before commit** — the first constructor draft
   validated the budget AFTER opening the psycopg2 connection, so a
   refused bound leaked a connection; validation now runs first
   (pinned: the drill constructs the refused instance and the refusal
   raises before any connection exists).
6. **Acceptance (all green, July 13, 2026).** `npm test` 743 passing /
   80 files (was 740/80), `npm run build`, `npm run python:check`,
   `docker compose --profile test config --quiet`. Live zero-paid:
   `test:answer-channel` 32, `test:textedit` 105 (Windows host),
   `test:module-lifecycle` 60, `test:modules` green (both
   composed-prompt pins unmoved — no prompt byte this session),
   `test:promotion` 41, `test:rlm-workspace` 106, `test:rlm-mcp` 86,
   `test:rlm-sandbox` 95 (was 53), `test:verification-sweep` 66,
   `test:agent-loop` 35 (ALL CHECKS PASSED), `test:a2a` 46 (ALL CHECKS
   PASSED), `test:repo-ingest` 56, `test:benchmark-hardening` 24,
   `test:entity-resolution` 34, `test:api-hardening` 18,
   `test:belief-recovery` 30, `test:invalidation-sweep` 17.
   `drill:scale` run ALONE: 1.94x CLOSED (in-band ~1.48x–2.26x, first
   try; max provenance 286; results file committed per house
   practice). Isolated Compose integration as project `trellis_s33_ci`:
   11/11 PASS (no manifest changed — all image layers cached).
   `git diff --check` clean.
7. **Documentation window (owner rule).** The Session 28 §5 entry and
   its same-day retirement addendum moved VERBATIM to
   `docs/archive/ROADMAP_HISTORY.md` (the live ledger keeps the most
   recent five sessions: 29–33); HANDOFF regenerated for row 11
   (Trellis-on-Trellis: full-repo extraction + graph-informed
   self-edits — the owner-approved step 4 of 4) with Session 28
   compressed into the digest.

### July 13, 2026 — Session 34: Trellis-on-Trellis stage 1 — the scoped-snapshot machinery + the full code-substrate extraction run (§4 row 11 stage 1)

The scaling flywheel's substrate step: Trellis's own code is now a
queryable semantic graph with content-addressed provenance, durable in
the dev stack. Two zero-paid implementation commits, the design
record, then the owner-approved run (approval given up front this
session), then the measured close-out.

1. **The cost problem that forced machinery.** The zero-paid full-repo
   dry run priced 4,575 post-exclusion blocks ≈ $12.35 at the §5b
   measured rate — over the standing ≤$5/run cap — and the budget gate
   is all-or-nothing (`ExtractionBudgetExceededError` rejects the
   whole snapshot before any row). Scope selection under ONE durable
   repo key became required machinery, not convenience.
2. **Scoped snapshots (`--include <prefix>`, repeatable;
   `SnapshotOptions.includePrefixes`).** Segment-boundary prefix
   match; doc keys stay root-relative so scoped and full runs agree on
   identity. Out-of-scope previously effective paths CARRY FORWARD at
   their previous root hash (published outcome `unchanged`, never
   read, never parsed, never tombstoned — deletion decisions belong to
   runs whose scope covers the path; a later covering run picks up
   deferred paths as ordinary changed-mode ingests). Out-of-scope
   paths with no prior version are typed `out_of_scope` skips (never
   parsed, so parse-level reasons cannot apply — drilled). Invalid
   prefixes refuse before any I/O; unset scope is byte-identical,
   pinned by plan equality. Plan echo prints `scope:` and
   `carried forward:` before any confirmation. Pins:
   `snapshot_ingest.test.ts` 17 → 24; `test:repo-ingest` 56 → 82
   (Part 7: carry-forward of an EDITED out-of-scope file at its
   pre-edit hash, deferred pickup by a covering run, in-scope deletion
   still tombstoning under scope, CLI round trip, invalid-prefix
   refusal).
3. **The stage-1 decisions, recorded BEFORE the run**
   (`REPOSITORY_INGESTION_REPORT.md` §5d): repo key `trellis` at the
   repository root; scope `src`+`scripts`+`modules` (printed bound
   1,423 blocks; 112 files / 498 blocks `test_fixture_excluded`);
   `docs/` + root prose DEFERRED to their own chunked proposal (~2,900
   blocks ≈ $7.8, prose-prompt value unmeasured); `data/` EXCLUDED by
   decision (measurement corpora are object text — extracting a novel
   would pour its characters into the self-substrate); durability = the
   residue persists, no tombstone cleanup, `repo:trellis:*` joins the
   durable list beside the probe corpora; estimate $2.4–$3.84; the
   five-part quality criterion pre-stated (§5d.3).
4. **The run (owner-approved, July 13, 2026).** Stale-consumer check
   first (none found; the July 12 precedent), fresh `dev:workers`
   instance, then
   `repo:ingest --repo-key trellis --root . --include src --include
   scripts --include modules --extract changed --max-blocks 1450
   --confirm-extraction`. Snapshot `trellis#1`: 298 ingested, 1,921
   eligible, 1,423 queued (the printed bound exactly), 498 excluded.
   Pipeline: **1,423/1,423 jobs, zero failures, 53m42s** (serial
   worker, ~26 jobs/min); 22 unresolved endpoints via the name
   pass-through; 9 merge-dropped actions (counted, logged — the
   observed base rate at scale, ~0.6%). Spend (fresh-instance worker
   metrics, exact): 892,363 input / 325,335 output completion tokens +
   388,944 embedding tokens — **≈ $2.75** at the basis that reproduces
   §5b's $0.28 (estimate band $2.4–$3.84; ceiling held). Criterion:
   ALL FIVE PASS — exclusion math exact (1,921 − 498 = 1,423);
   suppression 22 entities + 28 actions with ZERO denylist names
   carrying stage-1 provenance (query-verified); max hub `ast_nodes`
   at 29 distinct stage-1 sources = 2.04% of queued (bar ≤ 8%; top 15
   all genuine API-level identifiers, distribution published);
   `write_derived_insight`/`parsellmresponse`/`get_ast_blocks`/
   `trellis_answer` all resolve with provenance threading back to real
   `ast_nodes` bytes (fetched and checked, not just counted). Graph:
   1,995 entities / 1,788 ACTION relationships carry stage-1
   provenance (dev totals 2,613 / 2,366). Residual observations
   recorded, not acted on: `main` at 28 sources is the cross-file
   function-name class (first observed count for a future denylist
   review; a genuine identifier, so it stands as data); worker
   concurrency is a future reviewed kernel change if refresh latency
   ever matters (concurrent same-name merges are undrilled).
5. **Stage-2 seam observations recorded, nothing implemented**
   (§5d.5): dependency queries against real callers work today; the
   graph-to-textedit bridge is Cypher + existing surfaces (provenance
   hash → `document_nodes` → `repo:trellis:<path>` → `load`); entity
   names are lowercase-normalized so identifier lookups need
   `globalEntityId`'s normalization; substrate freshness is the
   ordinary churn loop.
6. **Acceptance (all green; commands per HANDOFF §6).** Offline:
   `npm test` 750 passing across 80 files (743 baseline + 7 scope
   pins), `npm run build`, `npm run python:check`,
   `docker compose config --quiet` + `--profile test config --quiet`.
   Live zero-paid: `test:answer-channel` 32, `test:textedit` 105,
   `test:module-lifecycle` 60, `test:modules` green (both prompt pins
   unmoved — no prompt byte this session), `test:promotion` 41,
   `test:rlm-workspace` 106, `test:rlm-mcp` 86, `test:rlm-sandbox` 95,
   `test:verification-sweep` 66, `test:agent-loop` 35,
   `test:a2a` 46, `test:repo-ingest` 82 (was 56),
   `test:benchmark-hardening` 24, `test:entity-resolution` 34,
   `test:api-hardening` 18, `test:belief-recovery` 30,
   `test:invalidation-sweep` 17. `drill:scale` run ALONE after the
   drain: 1.53x CLOSED (in-band ~1.48x–2.26x; max provenance 286 —
   the stage-1 substrate does not move the gate; results file
   committed per house practice). Isolated Compose integration as
   project `trellis_s34_ci` (host ports 0): 11/11.
   `git diff --check` clean. Defects found this session: NONE in
   existing code (two drill-expectation arithmetic errors during
   Part 7 authoring were fixed before commit and are recorded here
   for honesty).
7. **Documentation window (owner rule).** The Session 29 §5 entry
   moved VERBATIM to `docs/archive/ROADMAP_HISTORY.md` (the live
   ledger keeps the most recent five sessions: 30–34); HANDOFF
   regenerated for row 11 stage 2 with Session 29 compressed into the
   digest.

### July 13, 2026 — Session 35: Trellis-on-Trellis stage 2, increment 1 — the graph-informed self-edit harness (§4 row 11 stage 2; machinery + rehearsal zero-paid, the edit run PROPOSED owner-gated)

The first stage-2 increment: the machinery that lets an edit run be
HELD to graph evidence. Three commits (the design record, the harness,
the docs), no kernel byte, no prompt byte, zero paid spend. The row
does not strike — increments continue until the owner judges the
ladder complete.

1. **The increment design record, written BEFORE any code**
   (`REPOSITORY_INGESTION_REPORT.md` §5e, cross-referenced here). The
   target found by inspection and verified against the live substrate:
   `src/rlm/trellis_tools.py` carries two stale statements written in
   Session 30 and falsified by Session 31 — the module comment above
   `_retrieved_addresses` ("slice (d) will constrain citable addresses
   to this set on every run. Bookkeeping only today — no write-path
   behavior reads it yet.") and the `get_retrieved_addresses`
   docstring ("Slice (d)'s future input."). Both are false:
   `_verify_hashes_retrieved` consumes the set on every gated write
   through the `retrieved_addresses_check` constructor seam. Exactly
   the HANDOFF §3 example shape (a stale cross-reference comment
   misstating a dependency); the correction is comment/docstring-only,
   so edit risk is minimal while the edit content still depends on
   graph-verified facts. Live evidence recorded in §5e.1: the
   `get_retrieved_addresses` entity's `returns_copy_of` edge carries
   provenance `1f594ea9…ca61`, which bridges through `document_nodes`
   → `documents` to `repo:trellis:src/rlm/trellis_tools.py` (current
   version), and the stored block bytes contain the stale docstring;
   the consumer blocks (`667501…dc3e` `_verify_hashes_retrieved`,
   `faefe76e…6ace` `_run_insight_writes`) are in the substrate; no
   `_verify_hashes_retrieved` entity exists yet, so the run's recorded
   insight fills a real graph gap.
2. **The named failure mode and its mechanical detection.**
   Graph-misdirected editing: the run touches a file the graph
   evidence did not name, or edits on the basis of contested
   (quarantined) beliefs. `src/benchmarks/selfedit/check.ts` (pure —
   porcelain parsing, scope check, evidence check, pre-check; typed
   findings `out_of_scope_edit` / `named_file_unchanged` /
   `evidence_edge_missing` / `empty_evidence` / `contested_evidence` /
   `dead_evidence_hash` / `unbridged_evidence` /
   `target_entity_missing` / `contested_target` / `doc_missing`; 21
   unit pins, `npm test` 750 → 771) + `scripts/stage2_selfedit_check.ts`
   (`npm run stage2:check`): `--pre` gates the run on an uncontested
   target and a present substrate document (refresh-before-use); the
   post-run mode gathers `git status --porcelain` (read-only — the
   toolkit itself never touches git), the Neo4j evidence-edge state,
   and the PG current-version doc-key bridge, then evaluates; findings
   exit 1. The evidence check leans on Session 31 mechanically: the
   run must record one derived insight citing the blocks it fetched,
   and the write gate already refuses citations outside the run's
   retrieval set — a successful write IS proof of consultation. HONEST
   SCOPE recorded in §5e.2: the checker proves the recorded evidence
   chain and the diff scope, not every byte read and not
   query-before-edit ordering — the transcript (plus the opt-in
   `TRELLIS_CITATION_AUDIT=1` line) carries that, and the human review
   reads it.
3. **The drill (`npm run test:selfedit-harness`,
   `scripts/test_selfedit_harness.ts` + `test_selfedit_rehearsal.py`):
   39 checks, ALL GREEN ON FIRST RUN,** token-scoped fixture inserted
   and deleted by the drill. [1] the hash → current-version doc-key
   bridge: a live block bridges to its document; a superseded block
   (member of version 1 only, version 2 current) exists but reports NO
   current membership; an off-document block bridges only to the
   unnamed document; a ghost hash reports absent — plus a READ-ONLY
   live-substrate smoke (a real `repo:trellis:src/rlm/trellis_tools.py`
   code block bridges to its doc key, the path exists on disk, the
   stored bytes appear in the file; prints SKIP on a stack without the
   substrate). [2] the git gatherer + scope check over a scratch git
   repo: clean, named-file-only, and the planted out-of-scope edit
   FLAGGED. [3]/[3b] every evidence and pre-check code fires on its
   planted violation and clears on restore. [4] the scripted rehearsal
   drives the run's REAL tool sequence zero-LLM — `run_cypher`
   (provenance references) → `get_ast_texts` (bytes join the retrieval
   set; discipline-enabled construction) → `trellis_textedit`
   load/locate/splice/write_back → the retrieval-gated
   `write_derived_insight` — and the full checker reports ZERO
   findings on the clean arm. [5] the violation arm: the LIVE
   Session 31 gate refuses the unretrieved citation ("Provenance
   Violation … never retrieved" observed, not simulated) and the
   checker flags exactly the planted out-of-scope edit.
4. **The edit run stands PROPOSED, owner-gated — criterion pre-stated
   here before any spend.** Spawn per Session 26 mechanics
   (`trellis_agent.py` research mode, `--max-iterations 12`,
   `TRELLIS_EDIT_ROOT` = the session branch checkout with a CLEAN
   tree, `TRELLIS_CITATION_AUDIT=1` in the run's own env); the task
   text is verbatim in §5e.4. Estimate on the W-series basis:
   **$0.15–$0.45 for one run, at most one contingency re-run after a
   diagnosed clean failure, ≤$0.90 total** (cap $5). Criterion:
   (1) `git status --porcelain` under the edit root shows exactly
   `src/rlm/trellis_tools.py`; (2) the diff implements the §5e.4
   pre-scoped edit (two comment/docstring hunks, no executable line)
   and lands only after human `git diff` review; (3) `stage2:check`
   post-run reports ZERO findings; (4) counts and the diff reported
   TOGETHER — db tool calls, retrieval-discipline counts, textedit
   ops, `answer_submits`, actual dollars vs the estimate; (5) a
   harness flag means the increment FAILED — recorded, no silent
   retry. The pre-check ran live this session:
   `stage2:check --pre --entity get_retrieved_addresses --named-file
   src/rlm/trellis_tools.py` → PASS, zero findings (target
   uncontested, substrate present). The post-run mode was also
   exercised live against the session worktree mid-implementation and
   correctly flagged the session's own uncommitted files as
   out-of-scope plus the missing evidence edge — confirming the
   clean-tree requirement the design record states.
5. **Acceptance (all green; commands per HANDOFF §6).** Offline:
   `npm test` 771 passing across 81 files (750/80 baseline + the 21
   checker pins), `npm run build`, `npm run python:check` (the
   rehearsal script joined `check_python_runtime.py`'s compile list),
   `docker compose --profile test config --quiet`. Live zero-paid:
   `test:selfedit-harness` 39 (NEW), `test:answer-channel` 32,
   `test:textedit` 105 (Windows host), `test:module-lifecycle` 60,
   `test:modules` green (both composed-prompt pins unmoved — no
   prompt byte this session), `test:promotion` 41,
   `test:rlm-workspace` 106, `test:rlm-mcp` 86, `test:rlm-sandbox` 95,
   `test:verification-sweep` 66, `test:agent-loop` 35 (ALL CHECKS
   PASSED), `test:a2a` 46 (ALL CHECKS PASSED), `test:repo-ingest`
   green — 79 [PASS] lines observed this run vs Session 34's recorded
   82; the drill's printed count is environment-dependent by
   construction (a `symlinkCreated` conditional skip block and
   failure-only loop checks), and "All checks passed" is the
   acceptance signal — `test:benchmark-hardening` 24,
   `test:entity-resolution` 34, `test:api-hardening` 18,
   `test:belief-recovery` 30, `test:invalidation-sweep` 17.
   `drill:scale` run ALONE: 1.68x CLOSED (in-band ~1.48x–2.26x, first
   try; max provenance 286; results file committed per house
   practice). Isolated Compose integration as project `trellis_s35_ci`
   (host ports 0, torn down with `--volumes`): 11/11 PASS
   (`package.json` changed — the npm ci layer rebuilt; the pip layer
   cached). `git diff --check` clean. No defect found in existing
   code; every new check passed on first run.
6. **Documentation window (owner rule).** The Session 30 §5 entry
   moved VERBATIM to `docs/archive/ROADMAP_HISTORY.md` (the live
   ledger keeps the most recent five sessions: 31–35); HANDOFF
   regenerated per §0 — the next objective re-selected against this
   session's state (the run stands proposed-unapproved, so the §2
   standing owner-conditional menu plus the increment-1 run itself
   carry forward).


### July 13, 2026 — Session 36: Trellis-on-Trellis stage 2, increment 1 EXECUTED — the graph-informed self-edit run landed + the first freshness-policy refresh (§4 row 11 stage 2)

The owner approved gated and paid runs for the session up front. Two
paid steps ran: the increment-1 self-edit run (one contingency re-run
after a diagnosed clean failure — both recorded below) and the scoped
refresh. Total paid spend **$0.667** (runs $0.565 vs the ≤$0.90
proposal; refresh $0.102 vs the ≈$0.05–$0.25 band).

1. **Pre-flight (zero-paid), all green on the merged Session 35
   baseline:** `npm ci`; `npm test` 771/81; `npm run build`;
   `npm run python:check`; `docker compose config --quiet`;
   `test:selfedit-harness` 39/39; then
   `npm run stage2:check -- --pre --entity get_retrieved_addresses
   --named-file src/rlm/trellis_tools.py` → PASS, zero findings.
   Edit root = this session's worktree checkout,
   `git status --porcelain` empty before the spawn. The stale
   Session 30 bytes confirmed still in place (the module comment and
   the `get_retrieved_addresses` docstring).
2. **Run 1 — FAILED at human `git diff` review; recorded, reverted,
   diagnosed (criterion item 2; $0.2134 actual — 72,279 in / 3,268
   out).** Spawn per the §5e.4 recipe (research mode,
   `--max-iterations 12`, `TRELLIS_EDIT_ROOT` = the clean checkout,
   `TRELLIS_CITATION_AUDIT=1`; task text verbatim). The run resolved
   the graph entity, fetched the provenance and consumer blocks,
   produced a CORRECT hunk A — then mis-ranged hunk B's splice
   ([93,95) covered the `def` line instead of the docstring tail),
   observed the wrong diff preview and wrote back anyway, repaired
   with a second splice that still left the stale docstring tail as
   dead bytes below the function body, and — decisive — placed its
   final verification read and `trellis_answer.submit` in the SAME
   REPL cell, so the printout showing the leftover stale line could
   not inform the already-submitted success claim. The file was left
   syntax-broken (`SyntaxError: unmatched ')'` at line 100) with 11
   LF-only replacement lines. `stage2:check` reported zero findings
   (scope and evidence chain were genuinely clean — the checker
   proves consultation and scope, not diff semantics; §5e.2's honest
   scope, working as recorded) and the failure was caught exactly
   where the criterion places it: human `git diff` review. The
   toolkit behaved per contract throughout (splice did what was
   asked; `diff` told the truth; `write_back` wrote). Failure class:
   the run's own localization/verify discipline — verify-then-submit
   collapsed into one cell. Diff preserved at
   `benchmark_logs/session36_run1_failed_diff.patch` (gitignored);
   working tree reverted; original bytes re-verified compiling.
3. **Run 2 — the contingency re-run (identical spawn, task text
   byte-identical): LANDED ($0.3520 actual — 120,135 in / 5,165
   out).** All five criterion items: **(1)** named-file-only diff
   (`git status --porcelain` = exactly `src/rlm/trellis_tools.py`);
   **(2)** the pre-scoped edit — two comment/docstring-only hunks,
   zero executable lines, both stale claims excised, the correction
   naming `_verify_hashes_retrieved` and the
   `retrieved_addresses_check` seam with bare construction noted,
   the NOT-experiment-gated and telemetry sentences preserved —
   human-reviewed via the ordinary session-PR review (§5e.4's
   recorded location for it); **(3)** `stage2:check` zero findings
   (evidence edge present/uncontested, hashes live, bridged to the
   named file); **(4)** counts and diff together: 8 db tool calls, 5
   retrieval fetches / 1 dedup refusal / 0 budget refusals
   (retrieval discipline observed live in a real run), 33 textedit
   ops / 1 write_back, `answer_submits` 1, `py_compile` green,
   `npm test` 771/81 + `python:check` + `test:textedit` green with
   the diff applied; **(5)** no harness flag. The run recorded ONE
   derived insight (`_verify_hashes_retrieved` `consumes`
   `get_retrieved_addresses`) citing the two consumer blocks it
   fetched (`66750136…`, `3e478e14…`) — the Session 31 gate makes
   that write proof of consultation. Two long unwrapped comment
   lines (style-only) accepted at review. Three replacement lines
   are LF-only in the working copy; git normalizes on commit
   (in-repo representation unchanged).
4. **The refresh demonstration — the freshness policy's first
   execution ($0.102 actual — 14,751 in / 6,531 out / 5,991
   embedding tokens; 24 jobs, zero failures).** Stale-consumer check
   (none), fresh workers, zero-paid plan echo FIRST:
   `repo:ingest --repo-key trellis --root . --include src --include
   scripts --include modules --extract changed --max-blocks 200
   --confirm-extraction --dry-run` → 8 files to ingest (Session 35's
   harness files + the landed edit), 59-block paid bound, 0
   tombstones. Confirmed run published snapshot `trellis#2`: 8
   ingested / 295 unchanged / 24 blocks queued (19 test/fixture
   excluded); `trellis_tools.py` → version 2 (root `ca3e9a28…`, 3
   orphaned / 3 added / 38 retained). Churn loop verified live with
   counts: the old docstring block `1f594ea9…` is DEAD in v2
   (membership 0) and the invalidation sweep CONTESTED the stage-1
   `returns_copy_of` ACTION edge (provenance preserved in
   `orphanedSourceIds` — audit-preserving quarantine, as built);
   run 2's insight edge SURVIVED uncontested because it cites the
   unedited consumer blocks — the evidence outlived the edit it
   justified (better than the handoff's prediction that it would
   contest; recorded as observed). Recovery: an operator
   re-derivation citing the NEW v2 block
   (`09281f45…`) wrote the live `returns_copy_of` belief through the
   ordinary write path; the contested ACTION edge remains as the
   audit record per the standard lazy-recovery precedent — the
   refresh's own re-extraction did NOT spontaneously reproduce that
   exact triple (extraction variance, the recorded base-rate
   behavior; 1 generic-identifier suppression and 2 unresolved
   endpoints counted across the 24 jobs).
5. **Close-out (all green):** `npm test` 771/81; `npm run build`;
   `python:check`; `docker compose --profile test config --quiet`;
   the full standing drill block including `test:selfedit-harness`
   (ALL CHECKS PASSED × 18 suites); `drill:scale` run ALONE — 1.63x
   CLOSED (in-band ~1.48x–2.26x, first try; max provenance 286;
   results file committed per house practice). Isolated Compose
   integration as project `trellis_s36_ci` (host ports 0, torn down
   with `--volumes`): 11/11 PASS (no manifest changed — all layers
   cached). `git diff --check` clean. No defect found in existing
   machinery: run 1's failure was the run's, not the harness's, and
   every harness behavior matched its pins.
6. **Documentation window (owner rule).** The Session 31 §5 entry
   moved VERBATIM to `docs/archive/ROADMAP_HISTORY.md` (the live
   ledger keeps the most recent five sessions: 32–36);
   `REPOSITORY_INGESTION_REPORT.md` gained §5e.5 (the measured-run
   record); HANDOFF regenerated per §0 — next objective selected as
   stage-2 increment 2 (run landed AND refresh ran, per the
   recorded selection rule), owner-scoped.

### July 13, 2026 — Session 37: stage-2 increment 2 — the parse gate landed; BOTH edit runs failed and are recorded (§4 row 11 stage 2)

The session split exactly as designed: the run-1-escape closure landed
zero-paid FIRST; the owner-approved increment-2 runs then both FAILED
under the pre-stated criterion and are recorded — the increment's
product this session is measurement, not a landed diff. Paid total
$0.6356 (runs $0.3994 + $0.2362 vs the ≤$0.90 proposal) plus the
close-out refresh (recorded below). Design record:
`REPOSITORY_INGESTION_REPORT.md` §5f (written before the run).

1. **The parse gate (zero-paid, LANDED).** `named_file_unparseable`
   joins the checker's typed findings: `stage2:check` post-run mode
   now parses every named file — `.py` via the configured interpreter
   (`config.python.executable`) running builtin `compile()` over the
   file bytes (py_compile's check WITHOUT its bytecode write; the
   checker stays read-only), `.ts`/`.js` via the TypeScript
   single-file parse diagnostics (no project resolution, no type
   check, no emit); unwired extensions are honestly unchecked, never
   a finding. Pure evaluation in `check.ts` (`checkParseResults`,
   `parseGateLanguage`); gatherers in
   `src/benchmarks/selfedit/parse_gate.ts`; composes ADDITIVELY in
   the CLI — `evaluateSelfEditRun` and every Session 35 pin
   unchanged. Pins: 11 unit tests (`npm test` 771 → 782 across 82
   files; the planted run-1 shape per language, clean/unwired
   silence, the missing-file case) + drill section [6]
   (`test:selfedit-harness`, 36 → 41 [PASS] observed on this stack)
   planting the EXACT preserved run-1 failed-diff shape and observing
   the finding fire through the real interpreter. Post-run mechanical
   check only, never a write gate (guardrail 5).
2. **Candidate selection by substrate query (§5f.2).** The
   `slice (d) will` staleness family has exactly three surviving
   occurrences in the current `repo:trellis:*` versions: the
   `trellis_agent.py` research-mode telemetry comment (SELECTED —
   doubly false: the same `main()` block wires
   `retrieved_addresses_check=get_retrieved_addresses` eleven lines
   up), the landed increment-1 residue in `trellis_tools.py:78`
   (REJECTED — measured evidence, never hand-touched), and the drill
   fixture's deliberately planted stale line (REJECTED — fixture
   bytes). Broader staleness families queried EMPTY — the honest
   ladder consequence recorded: surviving falsifiable staleness is
   comment-class, so the step up was taken on depth (inside the
   13.7 KB `main()` body), near-duplicate disambiguation (twin
   telemetry sites at lines ~352/~579), and the
   verify-in-its-own-iteration task discipline. New named failure
   mode: near-duplicate mis-targeting.
3. **Run 1 — FAILED on a harness flag ($0.3994; 134,387 in / 6,343
   out).** The diff was CORRECT (one hunk, right site, comment-only)
   but `stage2:check` fired 2 × `unbridged_evidence` — the FIRST
   live firing of the Session 35 bridge check: the recorded insight
   cited two `trellis_tools.py` blocks, not the named file. Diagnosed
   deterministic (directional Cypher → 0 edges on `trellis_agent` →
   the task's vector_search widening branch → semantically-similar
   wrong-document blocks; the in-file wiring was confirmed through
   textedit reads, which correctly never feed the retrieval set).
   Tree reverted; the failed run's residual edge DELETED before the
   contingency (operator cleanup, recorded with the Cypher in §5f.5:
   the MERGE unions edge provenance, so the rejected hashes would
   have made the pre-stated contract mechanically unpassable;
   contest-instead-of-delete would equally have blocked it).
4. **Run 2 (contingency, task text v2 — amendments per the recorded
   diagnosis) — FAILED at human `git diff` review ($0.2362; 76,860
   in / 4,402 out).** The evidence chain was PERFECT (118 undirected
   edges → 26 provenance hashes → the in-file block `2f703511…2514`
   identified and cited; checker zero findings INCLUDING the parse
   gate) — but the splice replaced a 6-line window with 6
   HAND-RETYPED comment lines whose retype dropped two neighbors:
   the executable `"retrieved_addresses":
   get_retrieved_address_count(),` line and the Session 33 comment's
   first line. The file parses — the gate and checker are
   structurally blind to a parseable semantic deletion — and human
   review caught it, exactly where the criterion places diff
   semantics. The verify-in-its-own-iteration discipline WAS followed
   but its predicate checked only stale-text absence, never neighbor
   preservation. Failure named: retype-splice neighbor deletion (the
   CODE_MEDIATED_TEXT §1 pathology — the model re-typed existing
   bytes through attention instead of splicing the changed span).
   Tree reverted; both failed diffs preserved locally
   (`benchmark_logs/session37_run{1,2}_failed_diff.patch`).
5. **Increment verdict: FAILED under the pre-stated criterion; both
   proposed runs consumed; recorded and stopped — no third run.**
   What the failures bought: the bridge check's first live catch of
   real evidence substitution; confirmation the parse gate changes
   the review surface (run 1's diff was gate-clean AND
   checker-flagged — the layers separate concerns correctly); and
   the NEXT mechanically closable class named — a comment-class edit
   that deletes parseable executable neighbors, decidable from the
   diff alone (every changed named-file line must be comment/blank).
   That comment-class diff gate is the recorded zero-paid first step
   for the increment-2 RETRY (Session 38), per the
   tooling-over-prompt-modules direction. Run 2's insight edge
   (`trellis_agent` `wires` `get_retrieved_addresses`, citing the
   in-file block) STANDS — a true belief with live gate- and
   checker-verified provenance; the run's diff failed, its recorded
   evidence did not. The `trellis_agent.py` stale comment remains in
   place: still a valid target.
6. **Close-out.** The §5d.6 refresh executed post-landing (plan echo
   first: 7 files / 66-block bound / 0 tombstones; snapshot
   `trellis#3`, 17/17 jobs zero failures; $0.0656 actual — 10,326 in
   / 3,969 out / 4,101 embedding, metrics-port actuals; the
   `trellis_tools.py` re-ingest is checkout EOL-normalization churn,
   not an edit — recorded in §5f.5; both standing insight edges
   verified uncontested with live provenance after the refresh;
   session paid TOTAL $0.7012). The standing drill block green;
   `drill:scale` ALONE (result in the committed
   `scale_drill_results.json`); Compose isolated (`trellis_s37_ci`);
   `git diff --check` clean. NO kernel prompt byte; both
   composed-prompt pins unmoved; the only kernel-adjacent code diff
   this session is harness tooling (`src/benchmarks/selfedit/*`,
   `scripts/stage2_selfedit_check.ts`, the drill).
7. **Documentation window (owner rule).** The Session 32 §5 entry
   moved VERBATIM to `docs/archive/ROADMAP_HISTORY.md` (the live
   ledger keeps the most recent five sessions: 33–37);
   `REPOSITORY_INGESTION_REPORT.md` gained §5f (the increment-2
   design record) and §5f.5 (the measured-runs record); HANDOFF
   regenerated per §0 — next objective selected as the increment-2
   RETRY: the comment-class diff gate zero-paid first, then the
   re-proposed run (owner-gated).


### July 13, 2026 — Session 38: structural chunking increment 1 — the seam + cAST walk + shadow measurement landed zero-paid; the pilot ran and FAILED criterion item 3 as worded (§4 row 12)

The code-substrate granularity upgrade, implemented exactly as the
design record fixed it (algorithm and engine not re-litigated). One
machinery commit + docs; paid spend this session: the per-PR refresh
(~$0.29 est., actuals split across a worker incident — see item 6),
the pilot **$0.540 actual** vs ~$0.46 estimate, and 16 seam-query
embedding calls (150 tokens, <$0.001). The full measured record is
`docs/architecture/STRUCTURAL_CHUNKING.md` §10.

1. **The machinery (zero-paid).** The generic tree seam
   (`src/core/ast/generic_tree.ts`: `GenericTreeNode` byte spans with
   strict ordered/nested/in-parent validation — violations are typed
   errors, never guessed trees; spans are UTF-16 code units with
   `String.slice` semantics, verified against multi-byte content
   before adoption); the cAST split-merge walk
   (`structural_chunker.ts`, pure: fit = one chunk, oversized
   recurses, adjacent SAME-KIND siblings greedily merge to 3,000
   chars, oversized childless leaves stay whole, comments and gaps
   glue to the following construct, giant gaps become bounded
   `code_chunk` segments; split threshold 4,000 = policy 1's
   `MAX_CHUNK_CHARS`; byte-exact coverage enforced in the walk AND
   re-checked by `coversSource`); the engine
   (`treesitter_engine.ts`: `web-tree-sitter` 0.26.11 +
   `@vscode/tree-sitter-wasm` 0.3.1 grammar blobs, BOTH exact-pinned
   in package.json — a grammar bump is a substrate-identity event;
   ERROR/missing trees refuse as typed `parse_error`; per-language
   chunk profiles for TS/TSX/JS and Python). `parseSourceFile` gains
   `chunkingPolicy` (absent/1 byte-identical — pinned; 2 =
   structural; markdown/text ignore it); `repo:ingest` gains
   `--chunking-policy` with the snapshot-summary `chunkingPolicy`
   stamp (default 1, pinned). New kinds `code_import` / `code_const`
   / `code_type` / `code_statement` flow through BOTH block walks via
   the existing childless-with-content branch — neither walk changed
   a byte (parity re-pinned with a structural-kinds case in
   `block_parity.test.ts`). The recorded per-kind eligibility
   decision: `code_import` typed-and-skipped
   (`EXTRACTION_INELIGIBLE_BLOCK_TYPES` in traverse.ts, consumed by
   `planExtraction` — readable blocks, never paid extraction or
   embedding); the other three ELIGIBLE. `npm test` 782 → 823 across
   85 files (seam validation, walk pins incl. the 13.7 KB
   main()-shape recursion, engine pins incl. UTF-16 spans and the
   ERROR refusal, policy-1 byte-identity in the plan-equality mold,
   policy-2 determinism, eligibility pins, the snapshot stamp).
2. **Shadow measurement (zero-paid, `npm run chunking:shadow`).**
   285 code files, full scope, GREEN (zero coverage errors, zero
   policy-2 refusals on policy-1-accepted files): monoliths >8,000
   chars **15 → 0** (max 25,818 → 4,641); TS structureless share
   **51.6% → 0.4%** (PY 55% → 0%, JS 100% → 0%); blocks 2,332 →
   2,682; extraction-eligible 1,839 → 2,389 with 293 imports
   typed-and-skipped; 3 over-cap glued-prefix exceptions counted;
   boundary oracle **911/911** policy-1 functions/methods intact
   inside one policy-2 block (zero Babel/python-ast vs tree-sitter
   boundary disagreements). `code_function` 860 → 464 by design
   (small adjacent functions merge — the density rule; the oracle
   proves containment, not loss).
3. **The pilot (owner-approved up front; snapshot `trellis#6`).**
   Seam-query baseline FIRST (8 pre-stated kernel-surface queries,
   `npm run chunking:seam-queries`, pinned in the script): 5/8
   defining files in top 3. Then `--include src/rlm
   --chunking-policy 2 --extract changed --max-blocks 150
   --confirm-extraction`: plan echo 110-block bound (the shadow's
   exact number), 8 files, 304 carried forward; **110/110 jobs, zero
   failures; $0.540**. Criterion verdict (§10.3, judged as
   pre-stated): items 1/2/4/5 PASS (zero monoliths and zero over-cap
   persisted — DB-verified; structureless 27.3% → 0.0% in scope; max
   pilot-scope hub 5.45% ≤ 8% with `main`'s monolith hub-feeding
   gone; churn integrity green with 89 nodes / 202 rels contested,
   audit preserved). **Item 3 FAILED as worded: raw tool-shape
   seam queries read 4/8 after vs 5/8 before.** Root cause diagnosed
   and recorded, not argued away: dead-block embedding pollution —
   the re-chunk killed every old block but their embeddings stay
   searchable, and ~256 dead near-twins outrank the live re-chunks.
   The live-only diagnostic (explicitly NOT the criterion
   instrument) reads 5/8 → 5/8 with the HEADLINE case fixed (the
   §5f.5 `trellis_agent.py` telemetry query: not-in-top-5 →
   live-rank 2) and one genuine regression named (small-function
   merge dilution on `trellis_blocks.py`). **Pilot verdict: FAILED
   under §7's own rule; recorded and stopped — no retuning.** The
   policy-2 `src/rlm` substrate STANDS (reverting is a second churn
   event teaching nothing); two owner follow-up candidates recorded
   in §10.3: a liveness filter for `search_ast_nodes` (or an
   embedding sweep over superseded blocks) and the merge-density
   knob. Rollout continuation is the owner's call; row 12 stays
   open.
4. **Churn + recovery observed live (the third time).** The pilot
   quarantined the three standing TRUE beliefs whose evidence blocks
   died (Session 36's `returns_copy_of` recovery belief, the
   Session 36 run-2 `wires` insight, the Session 37 run-2 `consumes`
   insight — all audit-preserved with `orphanedSourceIds`); all
   three RECOVERED same-day as operator re-derivations through the
   ordinary write path citing live policy-2 blocks, verified
   uncontested with `rederivedAt` stamped. NOTE for Session 39:
   `src/rlm` block hashes CHANGED — the retry's evidence must be
   re-verified against the live substrate before any run
   (refresh-before-use; the wiring statement is now block
   `9b4c3159…`, a 2,961-char `code_statement`).
5. **The per-PR refresh ran BEFORE the pilot by design** (snapshot
   `trellis#5`, policy 1, scope src+scripts+modules: 17 files, 69
   jobs queued, zero failures) so it could not clobber the pilot's
   policy-2 roots. FUTURE refreshes must use the split-scope recipe
   in §10.4 of the record: policy-1 refresh over everything EXCEPT
   `src/rlm` (carry-forward preserves the pilot), plus a policy-2
   `src/rlm` refresh when that directory changed.
6. **Defect/incident record.** (a) The first worker start failed on
   a missing `benchmark_logs/` directory (fresh worktree) and
   ORPHANED an npm tree that kept consuming — the Session 37
   stale-consumer class reproduced from a new cause; caught by
   process-list inspection, both trees killed, queue verified
   drained (69/69, zero failures) before proceeding. Refresh token
   actuals were split across the two workers' registries and are
   reported as the ~$0.29 estimate, honestly unrecoverable. (b)
   `npm run chunking:shadow -- --include src/rlm` did not forward
   the flag on this npm; direct `npx tsx scripts/chunking_shadow.ts
   --include src/rlm` works (recorded, not chased). (c) Zero defects
   found in existing kernel code; no kernel prompt byte, both
   composed-prompt pins unmoved.
7. **Acceptance (all green, July 13, 2026).** `npm test` 823 passing
   / 85 files (was 782/82), `npm run build`, `npm run python:check`,
   `docker compose --profile test config --quiet`. The full standing
   drill block green (18 suites: selfedit-harness, answer-channel,
   textedit, module-lifecycle, modules — pins unmoved — promotion,
   rlm-workspace, rlm-mcp, rlm-sandbox, verification-sweep,
   agent-loop, a2a, repo-ingest, benchmark-hardening,
   entity-resolution, api-hardening, belief-recovery,
   invalidation-sweep). `drill:scale` run ALONE: 1.69x CLOSED
   (in-band ~1.48x–2.26x, first try; max provenance 286; results
   file committed). Isolated Compose integration as project
   `trellis_s38_ci`: 11/11 PASS (package.json changed — the npm ci
   layer rebuilt; the pip layer stayed cached); torn down with
   `--volumes`. `git diff --check` clean.
8. **Documentation window (owner rule).** The Session 33 §5 entry
   moved VERBATIM to `docs/archive/ROADMAP_HISTORY.md` (the live
   ledger keeps Sessions 34–38); HANDOFF regenerated for Session 39
   (the increment-2 retry: comment-class diff gate zero-paid first,
   then the re-proposed run with task text v3) with Session 33
   compressed into the digest.


### July 13, 2026 — Session 39: stage-2 increment 2 RETRY — the comment-class diff gate landed zero-paid; the approved run LANDED all five criterion items first shot (§4 row 11 stage 2)

The retry closed Session 37 run 2's measured escape mechanically,
then landed the same owner-scoped edit in one run. Session paid total
**$0.504** (run $0.347 + split-scope refresh $0.157). Design record:
`REPOSITORY_INGESTION_REPORT.md` §5g (written before the run).

1. **The comment-class diff gate (zero-paid, landed first, stays
   regardless).** `named_file_noncomment_change` joins the checker's
   typed findings: for a named file the increment DECLARES
   comment-class (new repeatable CLI flag `--comment-class`), every
   changed content line in its diff — removed AND added sides — must
   be blank or a line comment for the file's language (`#` for `.py`,
   `//` for `.ts`/`.js`; block-comment interiors honestly out of
   scope, flagged conservatively). Pure pieces in `check.ts`
   (`parseUnifiedDiffChangedLines`, `commentMarkerForFile`,
   `checkCommentClassDiff`); the read-only `git diff -- <file>`
   gatherer beside the status gatherer (the recorded widening of the
   harness's git surface — still read-only, the toolkit never touches
   git); declarations validate BEFORE any I/O (must be a named file,
   must have a wired marker, refused under `--pre` — all three
   refusals observed). Post-run mechanical check only, never a write
   gate; undeclared increments never see it. Pins: 13 unit tests
   (`npm test` 823 → 836/85) with the EXACT preserved run-2 failed
   diff inline as the reference violation, + drill section [7]
   (`test:selfedit-harness`) planting the run-2 shape in a scratch
   repo: the parse gate observed structurally BLIND to it, the new
   gate fires through the real git binary, a genuine comment-only
   edit stays silent.
2. **Live evidence re-verification (§5g.2, the §3 handoff
   requirement).** The pilot re-chunk moved everything: the wiring
   now lives in `code_statement` block `9b4c3159…6a730` (2,961
   chars), the stale comment in a SEPARATE `code_statement` block
   `ab87725e…f883` (2,949 chars) — both verified byte-verbatim on
   disk (no pre-run refresh needed). The §5f route through entity
   `main` is DEAD (contested since the pilot); task v3 re-routes
   step 1 through `get_retrieved_addresses`'s two undirected ACTION
   edges (`constrains_with` citing the wiring block; `returns_copy_of`
   citing a `trellis_tools.py` block — a live re-test of the run-1
   bridge trap). `stage2:check --pre` PASS over four entities.
3. **The run (LANDED, $0.347 — 110,447 in / 7,089 out; 9 db calls;
   32 textedit ops / 1 write_back; 1 retrieval fetch + 1 live dedup
   refusal; `answer_submits` 1).** Task v3 = v2 + splice-minimal-span
   + coded neighbor-preservation assertions. The citation audit read
   both hashes and cited ONLY the wiring block (the tools.py hash
   fetched, correctly not cited); the diff was one hunk, 2 comment
   lines removed / 3 added, the executable line and the `# Session
   33` head untouched CONTEXT lines this time; `stage2:check` ZERO
   findings across all four layers (scope, evidence, parse,
   comment-class); human `git diff` review ACCEPTED; offline gates
   green with the diff applied. Criterion items 1–5 ALL PASS —
   increment 2 CLOSED by the retry, no contingency run. Recorded
   observation: `write_back` wrote the three new lines LF into the
   CRLF file (641/3 on disk) — the Session 36 mixed-EOL commit
   class, git normalizes on commit.
4. **The split-scope refresh (the §5d.6 cadence under the §10.4
   recipe; $0.157 — 34,756 in / 6,936 out / 13,148 embedding
   tokens).** Plan echoes first, ZERO tombstones both scopes.
   `trellis#7` (policy 1, everything except `src/rlm`): 12 files —
   this session's four harness files + Session 38's machinery files
   re-hashed whole (checkout-EOL churn class, third observation).
   `trellis#8` (policy 2, `src/rlm`): exactly `trellis_agent.py` v3,
   Merkle-precise — 23 blocks retained / 3 orphaned / 3 added.
   **59/59 jobs, zero failures**; 13 invalidation sweeps contested
   63 nodes / 30 relationships (audit preserved, lazy recovery).
   Churn verification: the old stale-comment block DEAD, the wiring
   block RETAINED — all three standing beliefs (`wires` / `consumes`
   / `returns_copy_of`) uncontested on live provenance with NO
   recovery needed (first refresh where the standing insights rode
   through on retained blocks alone).
5. **Worker hygiene (the Session 37/38 class, managed).** Fresh
   `dev:workers` instance for the refresh; after the drain the child
   process tree was killed and zero node/tsx consumers verified
   before the queue drills. One self-inflicted kill artifact (the
   taskkill matched the killing shell's own command line) — noted,
   harmless, queues already drained.
6. **Acceptance (all green; commands per HANDOFF §6).** Offline:
   `npm test` 836 passing across 85 files, `npm run build`,
   `npm run python:check`, `docker compose --profile test config
   --quiet`. Live zero-LLM drill block green (counts in the HANDOFF
   §2 baseline); `drill:scale` run ALONE (see the committed results
   file); isolated Compose integration green. `git diff --check`
   clean. Defects found in existing kernel code: NONE.
7. **Documentation window (owner rule).** The Session 34 §5 entry
   moved VERBATIM to `docs/archive/ROADMAP_HISTORY.md` (the live
   ledger keeps Sessions 35–39); HANDOFF regenerated — the row-11
   increment ladder now stands at the owner's judgment (increment 1
   landed on contingency; increment 2 failed twice, both classes
   closed mechanically, retry landed first shot).

### July 13, 2026 — Session 40: the `search_ast_nodes` liveness filter — dead-block embedding pollution closed at the T15 seam (§4 row 12 continuation)

The Session 38 pilot's item-3 root cause closed by the recorded
recommendation (standing item 9, promoted): the query-time liveness
filter inside `search_ast_nodes`. One schema function changed; zero
bytes in either caller; the whole session zero-paid except the
pre-stated seam re-measure (**8 embedding calls, 75 tokens,
≈$0.000002 actual**). Design record: `STRUCTURAL_CHUNKING.md` §11
(written BEFORE implementation); measured record §11.4.

1. **The design record first (§11).** Liveness = membership in the
   CURRENT (max-version) root of at least one document — exactly the
   stage-2 checker's `gatherHashEvidence` bridge semantics, mirrored
   into SQL. The filter lives INSIDE the function (one
   `CREATE OR REPLACE` in `POSTGRES_SCHEMA_SQL`; signature unchanged;
   both callers — `trellis_tools.py vector_search` and
   `POST /retrieve` — change zero bytes; the idempotent bootstrap
   upgrades every stack on boot; reversal is one `CREATE OR REPLACE`
   back). The filter applies BEFORE `LIMIT`. The honest residual is
   recorded, not denied: a filtered HNSW scan can under-fill below
   pgvector's candidate truncation — observed behavior printed at
   measure time (no under-fill occurred: every query returned a full
   top-5; a count-5 probe timed 65.9 ms at dev scale, printed never
   asserted). The superseded-embedding SWEEP stays unchosen on the
   owner menu.
2. **Implementation (zero-paid, one commit for schema + pins).**
   `src/config/schema.ts`: the EXISTS clause (document_nodes →
   documents → max-version-per-doc_key join, probing the existing
   `idx_document_nodes_node_id`). `src/config/schema.test.ts`: a new
   shape pin moved in the SAME commit (EXISTS present, the
   max-version join present, filter-before-ORDER-BY-before-LIMIT
   ordering, signature unchanged); `npm test` 836 → **837** across
   85 files. Dev DB upgraded via `npm run db:init:dev`; measured
   state at that moment: 1,731 embedded rows / 286 dead / 1,445
   live.
3. **The planted-dead-twin drill (`test:repo-ingest` Part 8, ten new
   checks, first-run green).** Synthetic deterministic vectors, zero
   LLM: a twin document's v1 block gets an embedding EQUAL to the
   drill query vector (raw cosine distance 0); v2 re-hashes the block
   and gets a perturbed embedding. Observed: the v1 block surfaces at
   rank 1 while current; after supersession the RAW distance order
   still ranks the dead twin first (the planted proof that the
   filter, not distance, excludes it) while `search_ast_nodes`
   returns ONLY the live successor at rank 1; after tombstoning,
   neither generation surfaces; zero extraction jobs; cleanup clean.
   The twin vectors sit on a dimension orthogonal to the rlm-sandbox
   probe so a stale fixture can never tie at distance 0.
4. **One witting fixture consequence (recorded, not hidden).**
   `test:rlm-sandbox` [5]'s embedded probe row was a bare `ast_nodes`
   insert with no document membership — DEAD by the new definition,
   so the tool would rightly hide it. The fixture now registers the
   probe as its own single-node document (`sandbox:probe:embed`) with
   FK-ordered cleanup; every sandbox check is unchanged and the drill
   is green — which simultaneously proves criterion 3 (all other
   retrieval surfaces byte-identical; zero bytes changed in
   `trellis_tools.py`).
5. **The re-measure (one run, after; before-numbers = §10.3's).**
   `npm run chunking:seam-queries` (the eight PINNED queries, never
   tuned): **5/8 top-3 vs the 4/8 post-pilot before — criterion 2
   PASSES (≥5/8)**. The raw tool now reads exactly what the
   Session 38 live-only diagnostic read. The pilot's headline miss
   (the `trellis_agent.py` research-mode telemetry query — the §5f.5
   increment-2 run-1 miss class) is FIXED through the agent-visible
   tool: live rank 2 where ~256 dead near-twins previously buried
   it. No query moved down versus the before-column. Persisting
   misses NAMED, not chased: `trellis_blocks.py` (the §10.3
   merge-dilution case — merge-density, owner's rollout judgment)
   and the two both-column misses (`trellis_tools.py` provenance
   rank 4, `trellis_workspace.py` >5 — cross-file semantic
   competition, unchanged by chunking or the filter). Full table in
   §11.4; raw log `benchmark_logs/session40_seam_after.log`.
6. **Standing consequence.** Dead-block embedding pollution is
   CLOSED at the seam — the §1 "name the pollution" reporting duty
   is retired for tool-shaped vector-search results; retrieval
   quality no longer decays with the per-PR refresh cadence. Row 12
   rollout continuation (widening policy 2, the merge-density knob,
   or reverting the pilot) stays the owner's call, now with §10.3 +
   §11.4 together.
7. **Acceptance (all green; commands per HANDOFF §6).** Offline:
   `npm test` 837/85, `npm run build`, `npm run python:check`,
   `docker compose --profile test config --quiet`. Live zero-LLM
   drill block green (`test:repo-ingest` "All checks passed." with
   Part 8; `test:rlm-sandbox` "All sandbox checks passed."; the full
   standing block per HANDOFF §6). `drill:scale` run ALONE: 2.05x
   CLOSED (in-band ~1.48x–2.26x, first try; max provenance 286;
   results file committed per house practice). Isolated Compose
   integration as project `trellis_s40_ci` (host ports 0, torn down
   with `--volumes`). `git diff --check` clean. Defects found in
   existing kernel code: NONE.
8. **Documentation window (owner rule).** The Session 35 §5 entry
   moved VERBATIM to `docs/archive/ROADMAP_HISTORY.md` (the live
   ledger keeps Sessions 36–40); HANDOFF regenerated per §0 — the
   largest standing decisions (the row-11 increment-ladder judgment,
   the row-10 (d) acceptance measurement, the stage-1b prose chunk,
   structural splice addressing) present unchanged on the owner
   menu.

### July 13, 2026 — Session 41: structural splice addressing — the design record + the guarded splice family (§4 row 11 prerequisite; standing item 10)

The owner delegated the session's gated decisions and approved paid
runs up front. The deliverable order was document-first (the
row-9/10/12 mold): the design record ratified BEFORE implementation,
then only the increment it scopes, all zero-paid; the session's only
paid work was the adopted per-PR substrate refresh ($0.0955 actual).

1. **The design record (`docs/architecture/STRUCTURAL_SPLICE.md`,
   written first).** The failure class is defined from its two live
   instances (Session 36 run 1: address drift, syntax-broken file;
   Session 37 run 2: parseable neighbor deletion — both preserved as
   reverted patches and narrated in
   `REPOSITORY_INGESTION_REPORT.md` §5e/§5f.5). The central decision
   — the engine — enumerated four candidates against the Session 29
   import-allowlist pin, the Session 20 containment contract, and the
   pillar: Python stdlib `ast` REJECTED (comments are not AST nodes —
   the engine would be blind to the exact class it exists to close;
   `.py`-only; parse-guarding is measurably blind, the run-2 file
   parsed), `py-tree-sitter` REJECTED (a native wheel = an allowlist
   widening that buys nothing the class needs — both instances were
   byte-identity failures, not construct-identification failures;
   revisit trigger recorded: construct-granular addressing that
   content queries cannot express), an engine-side structural service
   REJECTED (the toolkit deliberately has no IPC surface; engine-side
   spans go stale under staged splices — a positional mirror, the
   T13 anti-pattern), and **parser-free anchor guards CHOSEN**: the
   guard is the frame's own bytes, total over every text file, exact,
   zero new imports. "Structural" resolves to the structure the
   toolkit already owns.
2. **The guarded splice family (zero-paid, additive — `splice`
   byte-untouched).** `replace_lines(relpath, start, end,
   expected_lines, new_lines)` verifies the stated removal manifest
   byte-exactly against the frame BEFORE staging
   (`AnchorMismatchError` on divergence, naming the first divergent
   line with bounded previews and teaching re-derive-by-query) and
   refuses over-wide windows sharing an unchanged leading/trailing
   line with new_lines, naming the computed minimal window;
   `insert_lines(relpath, at, new_lines, anchor_before/anchor_after)`
   requires at least one verified neighbor anchor and removes nothing
   by construction; `delete_lines(relpath, start, end,
   expected_lines)` makes deletion an explicit verified declaration.
   All three stage through the splice machinery (same budgets,
   pendingSplices, diff/revert/write_back — hash guard and Session 29
   hardening untouched). Telemetry: `stats()` grew three → five
   counters (`textedit_guarded_ops` / `textedit_raw_splices` — the
   executable-class criterion lever: a guarded-only run is
   raw_splices == 0; the drill pin moved wittingly in the same
   commit; the `trellis_agent.py` fallback dict grew the same keys
   zeroed; the Node scanner tolerates additive fields, pinned).
   `TEXTEDIT_ADDENDUM` teaches the family (brace-free; gated behind
   `TRELLIS_EDIT_ROOT` — both composed-prompt pins UNMOVED, verified
   by `test:modules` in the close-out block).
3. **Honest scope, pinned deliberately (record §4):** the run-1 class
   is PREVENTED at the call (anchor mismatch refuses; nothing
   stages); edge-neighbor retypes are PREVENTED (minimality); a
   kept line dropped INSIDE a correctly-declared removal window — the
   exact run-2 shape — STAGES: converted from silent side effect to
   explicit reviewable declaration, NOT prevented. The drill asserts
   the staging (the honest-scope pin) so the residual is measured,
   not denied. Raw `splice` stays callable (compatibility); the lever
   for future increments is the criterion, not the contract.
4. **Pins and drills (§6 criterion items 1–5 ALL PASS, first-run
   green):** `test:textedit` 105 → 129 on Windows (106 → 130 POSIX) —
   new section [14]: the run-1 shape refused with nothing staged, the
   over-wide refusal naming "[5, 6)", the run-2 manifest shape
   staging, the decomposed minimal edit landing with the executable
   neighbor byte-intact on disk, anchored insertion/deletion refusal
   branches, budget refusal staging nothing, the five-counter
   telemetry split, the addendum teaching check; the section-10
   telemetry pin moved three → five in the same commit.
   `test:selfedit-harness` 49 → 55 checks — the rehearsal gained mode
   `guarded` (`scripts/test_selfedit_rehearsal.py`) and section [8]
   drives the run's REAL sequence: cypher → fetch → one OBSERVED
   live `AnchorMismatchError` (a retyped-from-memory expected line) →
   the taught self-correction (re-read, minimal verified replace) →
   write_back → the Session 31 gated write; guarded-only telemetry
   (guarded_ops 1 / raw_splices 0); full checker ZERO findings;
   neighbors byte-intact. `npm test` stays 837/85 — the increment is
   Python-toolkit-side; its pins live in the two drills (recorded
   honestly; no artificial TS test was added).
5. **The close-out block, all green:** `npm test` 837/85; build;
   python:check; compose config; the full drill list
   (selfedit-harness 55, answer-channel, textedit 129,
   module-lifecycle, modules — pins unmoved, promotion,
   rlm-workspace, rlm-mcp, rlm-sandbox, verification-sweep,
   agent-loop, a2a, repo-ingest, benchmark-hardening,
   entity-resolution, api-hardening, belief-recovery,
   invalidation-sweep); `git diff --check`. The isolated Compose
   integration ran as project `trellis_s41_ci` (11/11 PASS, torn
   down `--volumes`). `drill:scale` ALONE read 1.39x CLOSED — below
   the recorded 1.48x–2.26x band, so it was RE-RUN per guardrail 8:
   1.45x CLOSED, consistent; two consecutive closed readings, the
   band's floor moves down; the committed
   `scale_drill_results.json` carries the 1.45x re-run (max
   cardinality 286 unchanged).
6. **The per-PR refresh (split-scope recipe §10.4, second execution;
   $0.0955 actual — 16,327 in / 5,452 out / 9,017 embedding tokens
   from the worker metrics port, read before the workers were
   killed).** Plan echoes FIRST, zero tombstones both scopes.
   `trellis#9` (policy 1, everything except src/rlm): 9 files —
   `src/config/schema.ts` (the Session 40 filter, 2 paid blocks) +
   test/EOL-churn re-hashes (excluded from extraction). `trellis#10`
   (policy 2, src/rlm): 3 files — `trellis_textedit.py`
   Merkle-precise 16 retained / 15 added / 8 orphaned (the guarded
   family), `trellis_agent.py` 24 retained / 2 added / 2 orphaned
   (the fallback dict), `trellis_answer.py` 8/8 re-hash (the
   checkout-EOL churn class, fourth observation). 20/20 extraction
   jobs, zero failures; 12 sweeps contested 38 nodes / 31
   relationships (audit preserved, lazy recovery). **All three
   standing beliefs (`wires` / `consumes` / `returns_copy_of`) rode
   through UNCONTESTED** — the `wires` evidence block
   `9b4c3159…6a730` was retained by the v-next agent ingest; the
   second consecutive refresh needing no recovery. Worker child tree
   killed and zero Trellis consumers verified afterward (the
   Session 37/38 stale-consumer discipline).
7. **The delegated ladder decision (row 11), recorded:** the row
   stays OPEN; the executable-class prerequisite is SATISFIED by this
   session; increment 3 = the first executable-class edit run under a
   guarded-only criterion (`textedit_raw_splices == 0` added to the
   standing five items), entering as a NEW proposal with its own
   estimate when a REAL in-scope target surfaces by substrate query —
   never manufactured. Cross-references landed in
   `STRUCTURAL_CHUNKING.md` §8 (DECIDED) and `CODE_MEDIATED_TEXT.md`
   §6.1 (the closure paragraph).
8. **Bookkeeping:** Session 36's §5 entry moved verbatim to
   `docs/archive/ROADMAP_HISTORY.md` (the five-session window is now
   37–41); HANDOFF regenerated per §0 with the §0 step 5 re-check
   (next objective: the row-10 slice (d) acceptance measurement —
   the longest-standing shovel-ready item now that the splice
   prerequisite is closed). No kernel prompt byte anywhere in the
   session; zero defects found in existing kernel code.

### July 13, 2026 — Session 42: the row-10 slice (d) acceptance measurement — BLOCKED ENVIRONMENTALLY (not run); staging verified end-to-end; two drill-defect classes found and fixed (§4 row 10)

The session ran in a Claude Code remote Linux container (fresh clone,
policy-restricted egress through a TLS-re-terminating session proxy) —
not the owner's dev machine. The owner opened the session with a
blanket delegation ("all owner-gated tasks approved, and paid LLM
runs"), so approval was never the blocker; the environment was. Spend:
**$0.0000**.

1. **The measurement did NOT run — the blocker is environmental and
   recorded, not routed around.** Two independent denials: (a) no
   `OPENAI_API_KEY` exists in this environment; (b) the session's
   egress policy denies `api.openai.com` outright (CONNECT 403 at the
   proxy, recorded by the proxy status endpoint as a policy denial —
   the proxy's own documentation instructs report-don't-circumvent).
   A zero-paid probe run with a placeholder key traversed the ENTIRE
   run path — runner plan, corpus verification, spend gate, agent
   spawn, tool injection — and failed exactly at the OpenAI call
   (`APIConnectionError`; `TRELLIS_RESULT` status `error`, toolCalls
   0; $0.0000). The pre-stated criterion (archived Session 33 §5
   entry item 4) was NOT measured against — there are no numbers, so
   there is no verdict, and `RETRIEVAL_DISCIPLINE.md` is deliberately
   untouched (the measured-verdict section lands only with numbers).
   The proposal STANDS as the next session's §3 objective.
2. **The staging is real and verified — the measurement is proven NOT
   dev-DB-bound.** On a fresh stack (pgvector/pg16, Neo4j 5.11,
   Redis 7 via compose; `npm run db:init:dev`), `npx tsx
   scripts/exp_effective_context.ts --ingest` staged all four durable
   est corpora zero-paid (144 documents; representation invariants
   green: "source truths = stored truths"; the frank/chronicle
   localization counts matched their pinned values). The ON/OFF arm
   mechanics were re-verified in code: the runner's `armEnv` spreads
   its process env and does NOT strip `TRELLIS_EXP_OMIT_RETRIEVAL`,
   and `trellis_agent.py` resolves it to
   `retrieval_discipline=not EXP_OMIT_RETRIEVAL_ENABLED` at the
   research `TrellisPostgres` construction — so the recorded run
   shape (ON: `--suites est --arms on --repeats 5 --confirm-paid`;
   OFF: identical with the flag in the runner's own environment) is
   correct as written. The runner's spend gate behaved exactly as
   designed: plan-only without `--confirm-paid`, the printed ≤$5.00
   cumulative hard stop with it.
3. **Defect class 1 found and fixed (the event-loop rule): hardcoded
   `'python'` + a hardcoded Windows `PYTHONPATH`** (`C:\Users\Darian\
   AppData\Roaming\Python\Python313\site-packages`) in four
   drill/benchmark scripts — `scripts/test_verification_sweep.ts`
   (2 spawn sites), `scripts/test_confidence_writes.ts` (2),
   `scripts/test_entity_kinds.ts` (1),
   `src/benchmarks/poison_drill_runner.ts` (1). All six sites now use
   `config.python.executable` and the house
   `...(config.python.pythonPath && { PYTHONPATH: ... })` pattern
   (the `test_rlm_sandbox.ts` mold). This was masked on the owner's
   machine, where bare `python` on PATH carries the deps; on any
   other host `test:verification-sweep` — a STANDING-BLOCK drill —
   failed with `ModuleNotFoundError`. Post-fix: 66/66 checks.
4. **Defect class 2 found and fixed (Session 32's exact precedent,
   finished):** `test:confidence-writes` and `test:entity-kinds`
   seeded non-sha256 fixture provenance (`test-…-hash-a`) and have
   been broken since Session 14's format+existence enforcement on
   EVERY machine — unnoticed because neither is in the standing
   block (Session 32 repaired only `test_verification_sweep.ts`).
   Both now seed real sha256 fixture rows into `ast_nodes` with
   FK-safe cleanup (the same `H(n)`/`insertAstText` pattern). Both
   read "All checks passed." post-fix. The write-path enforcement
   itself was NOT touched (guardrail 3): the live probe of a
   non-hex citation still refuses with the typed Provenance
   Violation.
5. **Close-out (everything runnable ran; the unrunnable is named).**
   `npm test` 837/85 first try on this fresh Linux container
   (Python 3.11 venv); `npm run build`; `npm run python:check`
   (environment recipe: `requirements.txt` PLUS
   `requirements-pdf-fast-nodeps.txt` + `pandas` — on a clean uv
   resolver, `unstructured==0.23.1` does not pull pandas
   transitively); `docker compose --profile test config --quiet`.
   The full standing 18-drill block green: selfedit-harness 52
   (environment-shaped count), answer-channel 32, textedit 130
   (POSIX), module-lifecycle 60, modules 56 (both composed-prompt
   pins unmoved), promotion 41, rlm-workspace 106, rlm-mcp 86,
   rlm-sandbox 95, verification-sweep 66 (post-fix), agent-loop 35,
   a2a 46, repo-ingest "All checks passed" (89 [PASS] this
   environment), benchmark-hardening 24, entity-resolution 34,
   api-hardening 18, belief-recovery 30, invalidation-sweep 17.
   `drill:scale` run ALONE: 1.10x CLOSED (below the recorded
   ~1.39x–2.26x band → guardrail-8 re-run) then **1.52x CLOSED**
   in-band; max provenance 286 both times; the committed results
   file carries the 1.52x re-run. The isolated Compose INTEGRATION
   could not run here: the image build's apt stage is denied by the
   same egress policy class (`deb.debian.org` 403) — recorded, not
   worked around. `git diff --check` clean.
6. **Environment bring-up notes for policy-restricted containers
   (recorded for reproducibility):** `npm ci` needs
   `REDISMS_DISABLE_POSTINSTALL=1` (the PoC-only
   `redis-memory-server` postinstall downloads a Redis binary and
   aborts the install behind restricted egress); the Python runtime
   wants a dedicated venv (Ubuntu's patched distutils breaks the
   `langdetect` sdist build under the distro pip) with BOTH
   requirements files; Docker Hub's blob CDN was policy-denied but
   `registry-mirrors: ["https://mirror.gcr.io"]` restored image
   pulls for the dev stack.
7. **Bookkeeping.** Session 37's §5 entry moved VERBATIM to
   `docs/archive/ROADMAP_HISTORY.md` (the live ledger keeps 38–42);
   row 10's §4 cell gains the attempt note; HANDOFF regenerated per
   §0 with the §0 step 5 re-check — the §3 objective is RETAINED
   (the same measurement, now with the environmental prerequisites
   named and the fresh-stack staging recipe recorded). The adopted
   per-PR refresh cadence: this PR changes four in-scope script
   files, so a scoped policy-1 refresh is OWED and DEFERRED to the
   next session with access to the owner's durable dev PG (this
   container's stack was ephemeral and never touched the durable
   substrate). No kernel byte, no prompt byte, no contract change
   anywhere in the session.

### July 13, 2026 — Session 43: the row-10 slice (d) acceptance measurement RAN and PASSED all three pre-stated criterion items (§4 row 10 CLOSED)

The paired `est`-suite measurement Session 33 proposed and Session 42
was environmentally blocked from running executed on the owner's dev
machine with both prerequisites verified first (a 401 from
`https://api.openai.com/v1/models` proving egress without spend;
`OPENAI_API_KEY` present). Owner approval was given at session start.
Total spend **$1.9619** ($1.0497 ON + $0.9122 OFF) against the ~$2.40
estimate, under the ≤$5/run cap. Verdict record:
`docs/architecture/RETRIEVAL_DISCIPLINE.md` §9 (the STRUCTURAL_CHUNKING
§11.4 mold). NO machinery change: zero code bytes moved for the
measurement itself; no prompt byte; both composed-prompt pins unmoved.

1. **The run shape (exactly as pre-stated, no retuning):** 5 questions
   × 2 arms × `--repeats 5` = 50 runs through
   `scripts/exp_effective_context.ts --suites est --arms on
   --repeats 5 --confirm-paid`; OFF arm identical with
   `TRELLIS_EXP_OMIT_RETRIEVAL=1` in the runner's own environment.
   Arm assignment verified PER RUN from TRELLIS_TELEMETRY: all 25 ON
   runs `retrieval_fetches` ≥ 1; all 25 OFF runs every discipline
   counter 0. Plan-only echo printed first (≈$0.12/run expected,
   $5.00 cumulative hard stop); the four durable est corpora verified
   live before any spend (4 + 40 + 100 distinct doc keys).
2. **Criterion verdict (pre-stated in the archived Session 33 §5
   entry item 4; judged item-by-item):** **(i) PASS** — repeat-serves
   0 by construction on the ON arm; 5 dedup refusals OBSERVED LIVE
   (est-chr-counts r2, est-chr-quote-entry r1/r2/r4,
   est-frank-locate-count r1), each refusing a repeat before any I/O,
   every refused run still correct; 0 budget refusals (the default 64
   never approached). **(ii) PASS, thin** — pooled median input
   tokens ON 8,756 ≤ OFF 8,807 (51 tokens ≈ 0.6%; per-question
   medians MIXED and recorded: OFF lower on both chronicle questions,
   ON lower on est-frank-locate-count, aggregates flat — the est
   questions need only 1–2 fetches, so little repeat-spend exists to
   reclaim). **(iii) PASS** — correctness ON 25/25 ≥ OFF 24/25 (the
   OFF miss answered "DEBUG_NEEDED, None" after 8 db calls — one
   run, reported with its counts, never claimed as a discipline
   correctness win). Pooled db calls: ON median 2 (total 39), OFF
   median 2 (total 49); answer_submits 50/50; zero
   TRELLIS_PROTOCOL_VIOLATION.
3. **What the verdict claims (record §9.3):** the mechanical claim
   only — repeats never re-serve bytes, the budget bounds spend, the
   discipline costs nothing measurable (correctness held, tokens did
   not regress). No token headline (0.6% is noise-adjacent on 25
   pairs), no correctness claim, padding-evasion and
   budget-sufficiency residuals stand as recorded. Row 10 is CLOSED:
   machinery (Session 33) + measurement (this session).
4. **The DEFERRED Session 42 refresh executed (split-scope recipe,
   third execution; $0.0161 actual — 2,997 in / 856 out / 1,895
   embedding tokens, metrics-port actuals read before the workers
   were killed).** Dry-run plan echo FIRST (7 to ingest / 0
   tombstones / 12 carried forward out-of-scope — the src/rlm pilot
   preserved). Snapshot `trellis#11` (policy 1, everything except
   src/rlm): the four Session 42 repair files
   (`scripts/test_verification_sweep.ts` v2 — 5 added / 5 orphaned /
   16 retained, `scripts/test_confidence_writes.ts` v2,
   `scripts/test_entity_kinds.ts` v2,
   `src/benchmarks/poison_drill_runner.ts` v2 — 4/4/13) plus three
   checkout-EOL re-hashes (`scripts/test_answer_channel.ts` v3,
   `scripts/test_selfedit_rehearsal.py` v3,
   `src/benchmarks/effective_context/synthetic_corpus.test.ts` v3 —
   the FIFTH observation of the recorded churn class). 3/3
   extraction jobs zero failures (only `poison_drill_runner.ts`
   carried extraction-eligible changed blocks; the three
   `scripts/test_*` files are kernel test/fixture-excluded —
   blocksQueued 0 by construction; 3 dropped actions / 3 unresolved
   endpoints counted, never silent). 7 sweeps contested 9 nodes / 6
   relationships (all `poison_drill_runner.ts` orphans; audit
   preserved, standard lazy recovery). ALL THREE standing beliefs
   (`wires` / `consumes` / `returns_copy_of`) read
   `contested: FALSE` after the refresh — the THIRD consecutive
   refresh needing no recovery. NO policy-2 leg: `src/rlm` is
   unchanged since `trellis#10`. Workers killed by child-tree PID
   after the metrics read; zero node/tsx consumers verified. This
   session's own PR is docs + committed-drill-artifact only — it
   owes no further refresh.

### July 13, 2026 — Session 44: row-11 increment-3 target search — NO real executable-class target survived scrutiny (recorded finding); the §2 menu taken: the judge-calibration measurement RAN ($0.0367)

The recorded shape (Session 41's delegated ladder decision) requires
a REAL target surfaced by substrate query, never manufactured. The
search was executed and is recorded in full; nothing survived; per
the standing instruction the session took the menu and produced the
data the judge-calibration decision was waiting on. Session paid
total **$0.0367** (the measurement) + ~$0.000003 (8 target-search
embedding calls). NO machinery footprint: zero code bytes moved,
docs + the committed drill artifact only, both composed-prompt pins
unmoved, no refresh owed (nothing in extraction scope changed).

1. **Pre-flight (the Session 43 trio, verified before anything
   else).** Egress probe `curl … /v1/models` → 401 (reachable,
   nothing spent); `OPENAI_API_KEY` present; the durable dev PG live
   (snapshots `trellis#11`/`#10` current; 1,427 documents, 313
   `repo:trellis:*` doc keys; 11,084 `ast_nodes`). `npm ci`;
   `npm test` 837/85 first try; build + python:check green. All
   three standing DERIVED_INSIGHT beliefs read `contested: FALSE`
   with live provenance (the `wires` evidence block
   `9b4c3159…6a730` retained).

2. **The target search (the §3 finding duty — every query family
   and every rejection recorded).** All queries ran against LIVE
   blocks only (current-version membership, the `search_ast_nodes`
   EXISTS join mirrored in SQL) plus the graph:
   1. Defect markers (`TODO|FIXME|XXX|HACK`) over live extraction
      scope: **zero hits**.
   2. Hardcoded `spawn('python')` (the Session 42 class): **zero** —
      the class is fully closed.
   3. Hardcoded absolute paths / drive letters: **zero**.
   4. Python defect patterns (mutable default args, silent
      `except: pass`, `== None`): one candidate —
      `trellis_mcp.py` `call_tool(... arguments: dict = None)`
      annotation/default mismatch. REJECTED: no behavior defect
      (style dressed as defect).
   5. Staleness vocabulary (deprecated/obsolete/workaround/"no
      longer"): 3 hits, all informational comments about EXTERNAL
      deprecations (Neo4j `id()`, the MCP HTTP+SSE transport).
      REJECTED.
   6. `TRELLIS_*` env-var census over live blocks: 33 names, all
      live surfaces; no stale reference.
   7. Telemetry counter-name census (producer, fallback dict,
      drills): the five counters consistent at every site.
   8. Duplicate function definitions across `src/rlm`: only
      `__init__`/`close` (ordinary methods). Nothing.
   9. Churn map (`MAX(version)` per doc): directed block-level
      reading of the top of the list — `trellis_agent.py` v4
      telemetry block (fallback dict five-key consistent),
      `trellis_textedit.py` v3 guarded family read block-by-block
      (`_verify_anchor_lines`, `_stage_window`, `replace_lines`,
      `insert_lines`, `delete_lines`, `diff`): no defect found.
   10. sha256-regex site survey (12 sites): all deliberate mirrors,
       no drift.
   11. `time.time()` sites: drill timing prints only.
   12. Graph ACTION-claim sample over kernel-surface entities
       (40 edges): claims consistent with current blocks.
   13. PYTHONPATH / interpreter portability audit: all 28 sites use
       the house `config.python.*` pattern.
   14. The §1 "all seven queues" gauge claim vs `metrics_server.ts`:
       all seven wired.
   15. Semantic defect-smell probe through the live
       `search_ast_nodes` seam (8 queries, bare `TrellisPostgres`
       construction, ≈$0.000003): topical matches only; one
       marginal candidate (`mutate_oolong_dataset.ts` `parseInt`
       NaN on a malformed `--seed`) REJECTED as an operator-CLI
       robustness nit, not a falsifiable defect.
   16. Cross-file sync claims ("must mirror"/"twin"/"keep in
       sync"), each verified mechanically: textedit bounds mirror
       HOLDS (4 MiB/32 MiB/16/64 both sides); workspace bounds
       mirror HOLDS (128/1024/4 MiB/32 MiB);
       `_is_private_mcp_host` vs `isPrivateMcpHost` — a REAL
       textual divergence found (Python `strip("[]")` strips
       unbounded from both ends; TS strips one anchored pair) but
       UNREACHABLE: both validators parse the URL first and both
       parsers reject the malformed-bracket forms that could
       diverge. REJECTED — no reachable input falsifies the twin
       claim.
   17. Cardinality claims ("three/five counters", "seven queues"):
       consistent everywhere.
   18. Dead TS exports (defined, exported, referenced by no other
       live document): 10 candidates; ground-truth grep confirmed
       ALL are definition + in-file use — the `export` keyword is
       superfluous, the code is live. REJECTED (style).
   19. Same analysis over `src/rlm` Python defs: all in-file used.
       REJECTED.
   20. Pricing constants vs the recorded gpt-5.4 rates: match
       ($2.50/M in, $10/M out).
   21. `trellis_agent.py` research-construction wiring vs its own
       comment claims: verified line-for-line.
   22. The three standing beliefs re-verified by Cypher: uncontested,
       live-cited.
   One further candidate surfaced DURING the menu measurement (item
   3 below) and was REJECTED after investigation — see the
   `PROVENANCE_THREADING.md` §10.2 incident record: the suspected
   `process.exit(0)` stdout truncation in
   `scripts/entailment_sweep.ts` was falsified (exact-count
   verification, 359 = 359; the session's own `tee | head` capture
   pipeline caused the observed loss). The CLI is exonerated;
   changing it has no demonstrated failure to stand on. **Verdict:
   no genuine executable-class stale-code/defect item exists in the
   extraction scope today that a bounded self-edit could fix. Row 11
   stays OPEN; the guarded-only criterion stands ready for the first
   real target.**

3. **The menu item executed: the judge-calibration measurement
   (owner-approved plan and spend up front; menu item 2's data via
   the existing detector, machinery byte-unchanged).** Pre-stated
   document-first in `PROVENANCE_THREADING.md` §10.1 (question,
   selection, estimate — with the dry-run echo), then run exactly as
   stated: `entailment_sweep.ts --prefix q_ --rate 0.2 --budget 100
   --seed 44 --sync` over the OOLONG-era `q_*` pool (268 edges / 528
   unchecked pairs; 106 sampled, 100 judged, 6 deferred, 0 skipped).
   **Verdicts: 12 supported / 88 flagged; 83 edges contested**
   (ordinary belief machinery, audit preserved, lazy recovery — the
   July 13 first-sweep residue class). Class split (graph-recovered,
   `contestedAt`-windowed): `has_category` 73 flagged / 74 judged
   (98.6%); `mentions` 15 flagged / 26 judged (57.7%). Usage 8,695
   input / 1,500 output tokens = **$0.0367 actual** vs the $0.037
   estimate. The measured answer for the owner: the strict judge is
   consistent, and the strictness is class-shaped in degree —
   derived-classification `has_category` claims flag near-uniformly
   (the label is never in the block text), `mentions` claims flag
   per-pair where the specific cited block lacks the mention (the
   "weak heading-block citation" class at scale). The remaining
   unchecked `q_` pool after this run: 356 pairs. The calibration
   DECISION stays the owner's; both options and their costs are
   recorded in §10.2. Rates are per this seeded 100-pair sample —
   reported with the claim (guardrail 8).

4. **Honesty record (guardrail 8, the §10.2 incident).** The first
   diagnosis of the missing FLAGGED lines blamed the CLI and even
   produced a plausible-looking "reproduction" (359 lines vs an
   EXPECTED 431); the expectation was then falsified — contesting 83
   edges removes their unchecked sibling pairs from the pool, the
   post-run pool header reads 356, and 3 + 356 = exactly the 359
   lines delivered, piped and file-redirected alike. The initial
   §10.2 incident paragraph was rewritten to the corrected story the
   same hour, before commit. The lesson joins the Session 42/43
   operational notes: never measure a long-output CLI through
   `tee | head` — head's early exit kills tee mid-stream and
   manufactures a truncation.

5. **Close-out (all green on the owner's Windows machine against the
   durable dev PG, post-measurement).** `npm test` 837/85; build;
   python:check; `docker compose --profile test config --quiet`; the
   isolated Compose integration as project `trellis_s44_ci` (all
   assertions PASS incl. the containerized MCP fixture and the
   in-container polars import; torn down `--volumes`); ALL 18
   standing drills green in one sequential chain; `drill:scale`
   ALONE read 1.04x CLOSED (below the recorded band) then, per the
   guardrail-8 re-run, 1.54x CLOSED in-band — max provenance 286
   both; the committed `scale_drill_results.json` carries the 1.54x
   run; `git diff --check` clean.

6. **Bookkeeping.** Session 39 compressed to the HANDOFF digest; its
   §5 entry moved verbatim to `docs/archive/ROADMAP_HISTORY.md`
   (window now 40–44). This PR is docs + the committed drill
   artifact only (two architecture-record sections, this entry, the
   row-11 cell, the regenerated HANDOFF): no refresh owed, no code
   byte, no prompt byte.

### July 13, 2026 — Session 45: the test-time-training research track OPENED (owner-directed) — research record, rung ladder, collaborator questions; zero runtime bytes

Owner-directed objective, jumping the §4 queue per HANDOFF §0 step 3
(the queued stage-1b prose chunk stays standing item 1, undiminished;
the reason recorded here): initiate research on Test-Time Training
(TTT) — the external collaborator's active line ("increasingly
optimized sparse models in this harness," fast weights trained during
test time each turn on the RLM's REPL-resident context and on the
harness's own meta-prompts) — and roadmap it with architectural
documentation for future sessions and collaborators. $0.0000 spent;
docs-only PR.

1. **Research method (disclosed).** The direction said "use Deep
   Research"; no such tool exists in this session's harness, so the
   session substituted multi-query web research over primary sources
   (arXiv abstracts fetched directly; ids verified July 13, 2026).
   The record's §10 reading list is the citable output — eleven works
   spanning the fast-weights lineage (Schmidhuber 1992 → Ba 2016 →
   Schlag 2021), the architectural family (TTT-Linear arXiv:2407.04620,
   Titans arXiv:2501.00663, ATLAS arXiv:2505.23735), the
   pretrained-adaptation family (ARC-TTT arXiv:2411.07279, TTT-NTP
   arXiv:2606.21803, agentic TTT arXiv:2607.03441), the compiled-state
   cousins (Cartridges, SEAL, Transformer²), and the behavioral-eval
   critique (Beyond Perplexity arXiv:2607.00368). Two calibrating
   findings adopted verbatim into the record: TTT gains in multi-turn
   agents are STABILITY-shaped, not capability-shaped (~1.9× serving
   cost); TTT perplexity wins frequently fail to appear behaviorally.
   NOT found (recorded): any unified TTT×sparse-MoE literature, and
   any direct study of fast-weight adaptation to a fixed harness
   meta-prompt — both are open questions put to the collaborator.
2. **The record (`docs/architecture/TEST_TIME_TRAINING.md`, the
   document-first mold one stage earlier — the record that decides
   whether a design record is ever warranted).** Contents: the claim
   decomposed (H1/H2/H3, each independently testable); the three
   mechanism families; the seams named against the code (the two
   hardcoded `backend_kwargs={"model_name": "gpt-5.4-2026-03-05"}`
   sites and the direct `openai.OpenAI()` checker client in
   `trellis_agent.py`; the `vector(1536)` + HNSW embedder-schema
   coupling in `POSTGRES_SCHEMA_SQL` — the embedding backend is
   schema-coupled and SEPARABLE from the completion backend, and an
   embedder move is a substrate-identity event; the composed-prompt
   byte pins as the natural prefix fast-state cache key — the house
   pin discipline is coincidentally the cache-key discipline H2's
   mechanism would need); the trust-model analysis (fast weights =
   Tier-3 analog with zero provenance standing; per-run-ephemeral
   ABSOLUTE — cross-run persistence is a promotion-shaped event
   needing its own record; every gate engine-side and model-agnostic,
   so a backend swap changes none of them — the tooling-shape doctrine
   paying out); the three named threats (injection amplification via
   adaptation data — any R4 proposal must pre-state its
   adaptation-data policy as precisely as the retrieval set defines
   citability; cross-run contamination; reproducibility — model
   checkpoints join grammar wasm blobs as exact-pinned
   substrate-identity objects); the measurement plan (the est suite
   and protocol/answer-channel counters are backend-independent
   instruments; positive-control duty restated for TTT; behavioral
   criteria only, perplexity recorded never criterial); and the
   owner-gated ladder R1→R5 with the cost-doctrine re-expression
   (GPU-hours under the same propose/actuals ceremony).
3. **Honest scope, pinned in the record §8:** TTT is IMPOSSIBLE on
   the current gpt-5.4 API backend — nothing changes today's runtime;
   "increasing quality of response overall" is an unmeasured
   hypothesis whose best current external calibration predicts
   stability-shaped wins; H2 has NO direct literature support; the
   track proceeding at all is the owner's call at every rung.
4. **Collaborator handoff (R1).** `docs/COLLABORATOR_BRIEFING.md`
   gained Postscript 3: it corrects the July 9 item-(4) answer (the
   module registry is PROMPT-level test-time adaptation; the
   collaborator's line is WEIGHT-level — the registry answer stands
   for what it is, but it was not an answer to TTT) and points to the
   record's §9 questions (mechanism selection; whether sparsity does
   WORK in their formulation or is the economics; the H2 mechanism
   question — what a gradient step over fully-attended prefix bytes
   adds; the adaptation-data policy). Delivery is owner-mediated.
5. **Bookkeeping.** Session 40's §5 entry moved VERBATIM to
   `docs/archive/ROADMAP_HISTORY.md` (live ledger now 41–45); found
   in passing and repaired: the §5 archive-pointer paragraph was
   three moves stale (still read "37–41" although Sessions 42–44
   each moved an entry) — the four missing moves are now recorded in
   it, this one included. §4 gained row 13 (this track). HANDOFF
   regenerated per §0: the next-session §3 objective is rung R2 (the
   zero-paid backend-seam audit), with the judge-calibration decision
   presentation duty carried at session start and the owner's
   standing alternates (stage-1b, row-12 continuation, a surfaced
   row-11 target) intact.
6. **Acceptance (docs-only).** The diff touches five markdown files
   and nothing else (`git diff --stat` in the PR); zero code, prompt,
   config, or schema bytes — both composed-prompt pins untouched by
   construction. `npm ci` + `npm test` run in the session worktree
   (result recorded in the PR); the live drill block, Compose
   integration, and `drill:scale` were NOT re-run — no non-markdown
   byte moved and the Session 44 baseline stands; a docs-only PR owes
   no substrate refresh under the adopted cadence (`docs/` is outside
   extraction scope until stage-1b lands).

### July 13, 2026 — Collaborator R1 exchange (post-Session-45, same day): the mechanism SELECTED (LaCT); the reliance claim recorded and decomposed

The owner relayed the collaborator's response to the Session 45 record
the day it was written (verbatim quote preserved in
`TEST_TIME_TRAINING.md` §12): the model they aim to use is LaCT
("Test-Time Training Done Right"); with open weights they intend to
add a synthetic set of layers that ARE the fast weights; Trellis
supplies provenance to check the procedure and the meta-prompt
adherence they expect it to sharpen; "the research shows this improves
base model performance — that's the claim we're relying on for our
application." Zero-paid; folded into the Session 45 PR under the §0
step-5 event-loop rule.

1. **The selection verified against the primary source** (LaCT =
   Zhang et al., MIT + Adobe, arXiv:2505.23884; re-fetched July 13):
   the "add fast-weight layers to open weights" plan is the paper's
   Wan-2.1 retrofit pattern — attention layers replaced by LaCT +
   sliding-window attention, then FINE-TUNED (a training job, not an
   inference-time configuration); the retrofit result reads
   COMPARABLE to full attention, not improved; the paper's
   superiority results are FROM-SCRATCH architecture comparisons
   (760M/3B language models at 32k beating GLA/DeltaNet on
   long-context loss); authors' own stated limitation: state-based
   models are weaker at reasoning.
2. **The reliance claim decomposed (record §12.2), the Session 28
   discipline — a premise relied on is a premise measured:** C1
   SUPPORTED (hardware efficiency + quality-preserving retrofit
   feasibility); C2 EXTRAPOLATED ("improves base model performance"
   for a retrofitted open LLM — LaCT does not show it; nearest
   support is TTT-NTP's +3–4 RULER and aTTT's stability-shaped
   gains; **the load-bearing gap R3/R4 exist to measure**); C3
   UNTESTED (meta-prompt adherence = H2 — no literature; Trellis's
   protocol counters are the meter). One overlap named honestly:
   LaCT's measured wins are long-context modeling — the job the RLM
   already removes from attention by construction; the expected win
   for THIS application narrows to serving efficiency + the C3
   adherence effect.
3. **Division of labor recorded (record §12.3):** the retrofit
   training job is COLLABORATOR-SIDE (or its own owner-funded
   proposal) — not a rung of this repo's ladder; Trellis contributes
   the acceptance instrument, the R2 serving-seam audit, and the
   design seed "provenance-gated adaptation data" (the fast-weight
   training signal restricted to engine-verified live blocks with the
   run's retrieval set as the eligibility boundary — bounding the
   injection-amplification threat and making what-the-model-absorbed
   auditable).
4. **Ladder deltas (record §12.4):** R1 question 1 ANSWERED;
   questions 2–4 stand, question 4 sharpened into a concrete proposal
   (adaptation-data eligibility = the retrieval set?); R3 gains the
   same-checkpoint requirement so R4 isolates the added layers; R4
   arms fixed (base checkpoint vs same checkpoint with trained-in
   large-chunk fast-weight layers); its criterion inherits C2 and C3
   explicitly — a stability-only result is a finding, not a failure,
   but it is not C2. No rung's gate moved.
5. **The follow-up exchange (later the same day; record §12.5):** the
   owner CORRECTED the entry-3 overlap point — large REPL dumps ARE
   long-context modeling in practice (the discipline stops retyping,
   not reading; printed fetch results and extraction working sets
   flow through attention every turn), so C1's long-context results
   apply to this application directly — and framed the undertaking as
   "our own private repro study with expansion." The landscape check
   (zero-paid): LaCT is published at ICLR 2026; official code exists
   (github.com/a1600012888/LaCT, fused Triton kernels); independent
   groups already retrain the LM setup (arXiv:2602.21204's own 760M
   LaCT-LLM on 100B tokens) and adopt the mechanism downstream; a
   TTT reproducibility-report culture exists (arXiv:2511.16691) but
   NO external study covers C2 or C3. Verdict recorded: the
   empiricals are worth running and are the ONLY route to C2/C3; the
   ladder is already shaped as the study (R3 = the reproduction half
   on our workload, R4 = the expansion half); gates unchanged.

### July 13, 2026 — Owner ratification (post-Session-45, same day): the TTT-track chunking (phases 0–3) and the feature-class self-edit rung

The owner ratified the track's decomposition and the proposal that
Trellis authors the Trellis-side seam code through the stage-2
harness ("build this using Trellis, then we come back and review
it"). Full record `TEST_TIME_TRAINING.md` §12.6. Ratification covers
the SHAPE only — every increment and paid run below still enters as
its own owner-approved proposal with its own estimate.

1. **The feature-class self-edit rung DEFINED (record §12.6):**
   task-assigned functionality increments authored by Trellis (the
   W-series / increments-1–2 lineage) — DISTINCT from the
   defect-class increment 3, whose never-manufacture rule is
   untouched. Criterion mold: the standing five + guarded-only
   (`textedit_raw_splices == 0`) + the parse gate + the increment's
   own new unit pins green. Toolkit never touches git; every diff
   human-reviewed; landing is a human PR.
2. **Spec-before-pen:** the seam design record (R2b) is
   HUMAN-authored before any T-increment runs; task texts derive
   from it.
3. **The phases:** Phase 0 = R2a (Session 46: census + rlms verdict)
   then R2b (the seam design record). Phase 1 = the T-series
   (feature-class, smallest first): T1 config surface → T2
   `buildAgentEnv` forwarding/strip → T3 the `trellis_agent.py`
   construction-site rewire (policy-2 substrate covers it) → T4 the
   zero-LLM fixture-endpoint drill. Phase 2 = R3a/R3b (the
   reproduction half) then R4a–R4d when the collaborator's retrofit
   checkpoint lands (exact-pinned). Phase 3 = R5.
4. **Dependencies named:** the record lives in `docs/` (outside
   extraction scope) — T-series task text carries the spec verbatim
   until stage-1b chunk A lands (synergy, not prerequisite);
   refresh-before-use applies per T-increment target area under the
   split-scope recipe.
5. HANDOFF re-pointed: Session 46 = R2a, with R2b + the T-series
   queued behind it; folded into the Session 45 PR under the §0
   step-5 event-loop rule.
