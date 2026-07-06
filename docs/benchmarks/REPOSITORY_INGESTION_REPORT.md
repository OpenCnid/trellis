# Repository Ingestion Report (Session 8)

*July 6, 2026 — roadmap item 3.3 #6. Zero LLM calls end to end.*

## 1. What shipped

Whole-codebase ingestion turns one repository snapshot into a bounded
sequence of per-source-file document ingests through the verified ingest
service extracted from `POST /ingest`:

- `src/core/ingestion/` — `planExtraction` (pure cost planning with an
  explicit `none`/`changed` policy and a hard block budget) and
  `ingestDocument`/`ingestTombstone` (the exact T15 transaction:
  persist → read-back re-hash verification → membership → registration,
  with the Merkle diff moved inside the transaction so a budget
  rejection rolls the whole version back before any queue write).
- `src/core/ast/source_parser.ts` — code-aware parsing.
  TypeScript/JavaScript via `@babel/parser` (pure JS, new production
  dependency); Python via the standard-library `ast` module
  (`scripts/parse_python_source.py`, same interpreter contract as
  `parse_pdf.py`, output validated at a Zod boundary); Markdown keeps
  the pinned `parseMarkdownToAST` preimage; a named allowlist of
  configuration/text formats becomes bounded `opaque_text` chunks.
  Blocks are top-level functions, classes as containers with per-method
  child blocks, and bounded chunks for imports/statements/trivia. Every
  block's content is the exact source slice; concatenated leaf contents
  must reproduce the file byte-for-byte or the file is skipped with a
  typed `coverage_error`. No offsets, line numbers, or spans are
  persisted — identity remains the unchanged SHA-256 Merkle preimage.
- `src/core/repository/` — path safety (POSIX-relative validation, no
  traversal/absolute/NUL/backslash, symlinks skipped unfollowed, vendor
  and generated directories excluded), `git ls-files -z` enumeration via
  an argument vector, a pure manifest diff, durable snapshot membership
  in PostgreSQL (`repository_snapshots`, `repository_snapshot_paths`),
  and the snapshot pipeline with bounded file concurrency and bytes in
  flight. Snapshots publish atomically only after every file ingest and
  tombstone succeeds; a partial failure leaves the previous snapshot
  effective.
- `scripts/ingest_repository.ts` (`npm run repo:ingest`) — default
  `--extract none` (zero paid work); `--extract changed` requires an
  explicit positive `--max-blocks` budget plus `--confirm-extraction`,
  and the exact files/bytes/blocks/paid-job bound prints before any
  write.
- Deletion protocol: a path in the previous published snapshot that is
  absent (or no longer acceptable) now ingests a tombstone version — a
  deterministic empty root with no extraction blocks — which makes its
  prior membership globally dead and queues invalidation. The sweep
  quarantines affected facts; belief history is never deleted. A rename
  is a tombstone plus a new document; content hashes deduplicate
  physically but document identities never merge.

## 2. Live drill results (`npm run test:repo-ingest`, 45 checks)

The drill copies the committed fixture (`fixtures/repo_ingest`: 2
Markdown, 1 TypeScript, 1 Python, 1 JSON file — 1,206 accepted bytes)
into a temporary git repository together with five hostile entries.

| Phase | Result |
|---|---|
| Fresh snapshot via the real CLI, `--extract none` | 5 files ingested, one latest document per path, snapshot 1 published; skip counts pinned: `binary=1, excluded_directory=1, oversize=1, unsupported_extension=1, symlink=1`; stored `code_function` payload re-derives its Merkle id; zero extraction jobs in Redis |
| Unchanged rerun via the CLI | snapshot 2 published with all five paths `unchanged`; zero new document versions |
| One-method edit | only `src/app.ts` re-ingested; Merkle diff added exactly `root + code_class + code_method` (3 nodes) and orphaned their 3 predecessors; both untouched `code_function` hashes survived |
| Delete + rename | `src/util.py` and `docs/overview.md` tombstoned; `docs/handbook.md` registered as a distinct doc key at version 1 sharing the identical physical root hash; the deleted Python function was globally orphaned and its seeded facts quarantined with the dead hash preserved in `orphanedSourceIds`; the renamed paragraph was globally retained by the new doc key and its seeded facts survived |
| Forced single-file failure | run exits nonzero, previous published snapshot remains effective, nothing tombstoned, exactly one unpublished snapshot row; the retry publishes (`ingested=1, unchanged=2, tombstoned=1`) and the handbook fact quarantines once its last live source dies |

Cleanup removed every drill document, snapshot row, membership row,
graph entity, and AST row not shared with other documents; zero residue.

## 3. Entity.name merge lookup (profiled, index shipped)

Session 7 recorded that whole-document merge p50 grew ~5x as the graph
grew ~5.8x while same-graph no-op probes stayed flat, and named
`Entity.name` lookup profiling as the prerequisite before blaming
provenance arrays. Session 8 profiled it on the Session 7 scale fixture:

- `EXPLAIN` showed `ENTITY_MERGE_CYPHER`'s `MERGE (e:Entity {name: …})`
  running as **NodeByLabelScan** — bootstrap constrained only
  `Entity.id`, so every merged entity scanned the whole label.
- An idempotent range index (`entity_name_index`) was added to
  `neo4j_bootstrap.ts`, executed through the same `executeWrite` retry
  path as the constraint and pinned by unit tests. `EXPLAIN` now shows
  **NodeIndexSeek**.

`npm run drill:scale`, same machine, same day (Session 7 committed
numbers were from the same hardware two days earlier):

| Documents | Whole-doc merge p50 (no index) | p50 (with index) | p95 (no index) | p95 (with index) |
|---|---|---|---|---|
| 50 | 50.51 ms | 13.77 ms | 65.42 ms | 18.27 ms |
| 150 | 95.58 ms | 13.24 ms | 127.93 ms | 16.78 ms |
| 300 | 175.92 ms | 14.82 ms | 230.35 ms | 18.59 ms |

Merge latency no longer grows with graph size: the 300-document p50
dropped 11.9x and is now flat across scales, confirming the Session 7
hypothesis that the growth was the name label scan, not provenance
arrays. Same-graph probes (hub 286 sources vs. one-source detail)
remain equal (~4.4–5.1 ms p50 with the index), so array size is still
unindicted.

**The 3.3 #4 migration gate stays closed.** The with-index drill
reported maximum `sourceNodeIds` cardinality 286 (unchanged, threshold
1,000) and fixed-orphan-set sweep latency growth 1.88x against 5.77x
fact growth — below the 1.5×-growth trigger. No `ASTRef`/`EVIDENCED_BY`
migration shipped.

## 4. Cost

Zero paid LLM or embedding calls in every Session 8 acceptance command.
The repository CLI's `--extract changed` path exists but was exercised
only with deterministic unit fixtures and budget-rejection tests. A real
extraction run over a repository requires owner approval after the CLI
prints its exact block count; estimate one paid chat completion plus one
embedding call per block from the committed benchmark telemetry
(`benchmark_results.json` token counts) before approving.

## 5. Verification summary

- `npm test`: 345 passing across 44 files (baseline 294/40).
- `npm run build`, `npm run python:check`,
  `docker compose --profile test config --quiet`: pass.
- Isolated Compose integration (`trellis-s8-integration`): 9/9
  assertions, then removed only its own containers and volumes.
- `npm run drill:scale`: gate closed, zero seeded residue (numbers above).
- Live zero-LLM suites: `test:repo-ingest` (45), `test:benchmark-hardening`
  (24), `test:entity-resolution` (33), `test:api-hardening` (18),
  `test:rlm-sandbox` (4), `test:belief-recovery` (30),
  `test:invalidation-sweep` (17).
- `git diff --check`: clean.
