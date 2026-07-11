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
The repository CLI's `--extract changed` path was exercised in
acceptance only with deterministic unit fixtures and budget-rejection
tests. A real extraction run over a repository requires owner approval
after the CLI prints its exact block count; estimate one paid chat
completion plus one embedding call per block from committed telemetry
before approving. One such owner-approved pilot ran after the session's
acceptance closed — see §5.

## 5. Owner-approved extraction pilot (post-acceptance, July 6, 2026)

After acceptance, the owner approved one bounded real-extraction pilot:
`repo:ingest --root src/core/graph --repo-key trellis-graph-pilot
--extract changed --max-blocks 150 --confirm-extraction` (22 TypeScript
files, 112 blocks, budget 150).

**Pipeline:** 112/112 extraction jobs completed with zero failures, zero
dropped actions, and zero unresolved endpoints in ~6 minutes.
**Spend:** 112 `gpt-5.4-2026-03-05` completions (57,323 input / 46,862
output tokens) and 112 `text-embedding-3-small` calls (28,618 tokens).
Output tokens nearly matched input, so extraction cost is
completion-heavy; a full self-ingest (2,532 blocks) extrapolates to
roughly 1.3M input + 1.1M output tokens.

**Graph produced:** 340 entities and 318 relationships carrying pilot
provenance. Genuine API-level facts appeared
(`generatealiascandidates --[constrains_by]-> entity kind`,
`globalentityid --[uses]-> sha-256 hash`), alongside three problems that
are prerequisites for any repository-scale extraction:

1. **Test-fixture contamination.** `alias_candidates.test.ts` fixture
   strings produced `globex corporation --[acquired]-> initech`, and
   name-based entity identity merged those onto the pre-existing demo
   entities — fictional facts from test files gain real-looking
   provenance. The scanner needs a test/fixture exclusion before any
   full-repo `changed` run.
2. **Generic-identifier hubs.** The top pilot entity was literally
   `entity` (14 sources), with `name`, `id`, and `action` close behind.
   At repo scale these become mega-hubs — and a spurious fast path to
   the 3.3 #4 migration trigger.
3. **Prompt mismatch.** The extraction prompt targets "macro-level
   business entities"; on source code it improvises
   (`organization --[is_default_type_for]-> organization`). A code-tuned
   extraction prompt with generic-identifier suppression is needed.

**Cleanup:** the pilot repo key was tombstoned through a second snapshot
(zero accepted files → 22 tombstones) and the invalidation worker swept
the globally dead code-block hashes, quarantining the pilot-derived
facts. Per the conservative mixed-provenance rule, pre-existing demo
entities that had absorbed pilot provenance (e.g. `initech`) are
contested until next re-derived from live bytes — the standard lazy
recovery path.

## 5a. Postscript (July 11, 2026): the §5 prerequisites landed

Session 25 turned the three recorded §5 findings into machinery (all
zero-paid; see the roadmap §5 entry of July 11, 2026 for commands and
counts):

1. **Test-fixture contamination** → the kernel-fixed path classifier
   `isTestOrFixturePath` (`src/core/repository/paths.ts`). Classified
   files still ingest — snapshot completeness, versioning, and
   tombstones are unchanged — but their extraction policy is forced to
   `none` even under `--extract changed`, reported as
   `test_fixture_excluded` file/block counts in the plan echo before
   `--confirm-extraction`.
2. **Generic-identifier hubs** → the deterministic suppression filter
   `suppressGenericIdentifiers` (`src/core/graph/generic_suppression.ts`),
   applied to BOTH prompts after `parseLlmResponse` and before
   `resolveExtractedGraph`: a kernel-constant denylist (the recorded
   offenders `entity`/`name`/`id`/`action` and their kin) plus a
   length-<3 shape rule, dropping touched relationships too — counted
   and logged, never silent.
3. **Prompt mismatch** → additive `sourceKind` routing on the extraction
   job payload (`src/workers/extraction_job.ts`): repository snapshots
   stamp `code`/`prose` per file language; `code` selects a new
   API-level code-tuned prompt; `prose` and every pre-Session-25 payload
   compose the exact legacy prompt bytes (unit-pinned).

The measured before/after — a pilot RE-RUN over `src/core/graph` with
the new machinery — was proposed at 103 blocks ≈ $0.29, approved under
the session's owner approval, and ran the same day: see §5b.

## 5b. Owner-approved pilot RE-RUN with the Session 25 machinery (July 11, 2026)

The same root as the July 6 pilot, through the same CLI, with the
Session 25 machinery live:
`repo:ingest --repo-key trellis-graph-pilot-2 --root src/core/graph
--extract changed --max-blocks 150 --confirm-extraction` (workers:
extraction + invalidation only; supervisor/resolution are
operator-triggered and were not run).

**Plan echo (the exclusion working before any write):** 24 TypeScript
files, 131,111 bytes; 10 files `test_fixture_excluded` (29 blocks
withheld — including `alias_candidates.test.ts`, the recorded
contamination source); paid bound 103 blocks against budget 150. The
snapshot published 24 ingested / 132 eligible / 103 queued / 29
excluded.

**Pipeline:** 103/103 extraction jobs completed with zero failures,
zero merge-dropped actions, and 103 embeddings in ~5 minutes. 35
unresolved endpoints flowed through the name pass-through (the July 6
pilot had 0 — the code-tuned prompt references entities by qualified
name more often; none were errors, and generic unresolved endpoints
were suppressed, see below).

**Suppression observed live:** 14 `extraction.generic_suppressed`
events; 18 entities and 23 actions suppressed
(`trellis_extraction_suppressed_total`). The completions still emitted
`Entity` as an entity on `alias_resolution.ts` blocks DESPITE the
prompt's explicit ban — the deterministic filter dropped it and its
relationships every time. Prompts request, gates enforce: measured.

**Graph produced:** 237 entities and 243 relationships carrying pilot
provenance (July 6: 340/318 from 112 blocks — the code prompt is
sparser per block). The top entity by pilot sources is `ast_nodes` at
4 (July 6: literally `entity` at 14 — maximum hub cardinality 3.5×
lower), and the top 15 are all genuine API-level identifiers
(`classifierusage`, `same_as`, `current_rubric_version`,
`distinct_from`, `orphanedsourceids`, `sourcenodeids`,
`verificationtier`, `./schemas.js`, …). ZERO denylist names carry
pilot provenance — verified by query against the live graph, not just
asserted from the filter's structure.

**Fixture containment:** `globex corporation` (1 source) and `initech`
(2 sources) are byte-unchanged from the pre-run baseline and still
contested from the July 6 cleanup — their fixture source blocks never
reached the queue.

**Residual, recorded not acted on:** three near-generic names sit at
low cardinality (`concept`, `kind`, `generic` — 3 pilot sources each).
These are the first OBSERVED counts for future denylist candidates;
per the kernel-gate rule, additions require observed counts to justify
them, and 3 sources is not a hub.

**Spend:** 55,891 input / 40,545 output completion tokens
(`gpt-5.4-2026-03-05`) + 20,543 embedding tokens — 2.5% fewer input
and 13.5% fewer output tokens than the July 6 pilot's $0.31, ≈ $0.28
at the same prices (token-ratio bounds $0.27–$0.30), under the $0.29
estimate.

**Cleanup:** snapshot #2 tombstoned all 24 paths (zero accepted
files); the invalidation worker swept the globally dead hashes;
post-sweep, EVERY entity carrying pilot provenance live or orphaned
(521 total — the count includes July 6 pilot residue, since identical
file bytes share content-addressed block hashes across repo keys)
reads contested, zero uncontested. The standard lazy recovery path
applies, exactly as after the July 6 pilot.

## 6. Verification summary

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
