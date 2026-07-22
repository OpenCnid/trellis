# Semantic Provenance Scale Report

**Run date:** July 6, 2026
**Result artifact:** [`scale_drill_results.json`](artifacts/scale_drill_results.json)
**Cost:** zero LLM calls

## Decision

Do not migrate provenance arrays to `ASTRef`/`EVIDENCED_BY` storage yet.

The default drill created 300 versioned documents with 20 extraction blocks
each, 6,000 deterministic citations, 6,096 semantic nodes, and 6,000
relationships. The largest `sourceNodeIds` array contained 286 hashes, leaving
714 entries of headroom below the predeclared 1,000-entry migration trigger.
At a fixed 50-hash orphan set, median no-hit sweep latency grew from 15.32 ms
to 21.81 ms while semantic fact count grew from 2,096 to 12,096. That is
1.42x latency growth against 5.77x fact growth, not the predeclared
superlinear gate of more than 1.5 times fact growth.

The trigger remains explicit: rerun the drill and migrate node provenance to
indexed `ASTRef` anchors when an observed live array reaches 1,000 hashes, or
when fixed-orphan-set median sweep latency grows by more than 1.5 times the
semantic-fact growth. Extrapolation is not a substitute for that rerun. Under
this corpus's one-citation-per-entity-per-document shape, the 286-entry hub at
300 documents suggests that the array threshold is more likely around one
thousand documents than a few hundred.

## Method

`src/benchmarks/scale/generate_scale_corpus.ts` uses seed `20260706` and
weighted sampling without replacement from 96 entities. Sampling without
replacement prevents a synthetic document from inflating one hub with
repeated mentions. The five largest hubs occur in 286, 258, 212, 200, and 193
documents; the five smallest tails occur in 23, 21, 21, 20, and 19.

The runner uses production paths:

- Markdown is parsed into the immutable Merkle AST.
- `persistAstNodes` writes each AST in bulk and
  `verifyPersistedAstNodes` reads and re-hashes it before commit.
- `recordDocumentNodes` and `registerDocumentVersion` record physical
  membership and document history.
- Deterministic pseudo-extractions enter Neo4j only through
  `mergeExtractedGraph`.
- No-hit measurements call `sweepOrphanedProvenance` with 1, 50, and 500
  hashes at 50, 150, and 300 documents.
- Hub and tail retrieval use the real authenticated `GET /retrieve` route.
- Alias context measurements call the production `fetchEntitySnippets`.
- Twelve documents are re-ingested with two changed blocks each, then the
  real global-liveness reduction and quarantine sweep verify both contested
  and fresh-survival outcomes.

Each semantic block links one shared-pool entity to one unique detail entity.
This grows the graph with document count while allowing hub-node arrays to
grow naturally. Every `ACTION` remains single-source, so relationship arrays
are measured separately instead of assumed to share node growth.

## Measurements

### Cardinality and merge

| Documents | Semantic facts | Node max | Node p95 | Node mean | Relationship max | Document merge p50 | Hub no-op merge p50 | One-source no-op merge p50 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 50 | 2,096 | 47 | 6 | 1.82 | 1 | 40.18 ms | 8.94 ms | 8.27 ms |
| 150 | 6,096 | 144 | 1 | 1.94 | 1 | 98.16 ms | 6.66 ms | 5.92 ms |
| 300 | 12,096 | 286 | 1 | 1.97 | 1 | 204.77 ms | 7.72 ms | 7.78 ms |

The same-graph no-op probes isolate the `ON MATCH` union better than the
whole-document timing: at 300 documents, re-merging the 286-source hub and a
one-source detail both took about 7.7 ms median. The array union is not the
observed merge bottleneck at this scale.

Whole-document merge latency did grow with graph size even though every
document still supplied 20 blocks. That measurement should not be attributed
to provenance arrays: `ENTITY_MERGE_CYPHER` matches on `Entity.name`, while
the current Neo4j constraint indexes `Entity.id`. The no-op comparison above
shows no hub-array penalty. An `Entity.name` lookup/index profile should be
evaluated before interpreting document-merge growth or before repository-scale
ingestion; it is independent of an `ASTRef` migration.

### Sweep

Median no-hit sweep latency:

| Documents | 1 orphan hash | 50 orphan hashes | 500 orphan hashes |
|---:|---:|---:|---:|
| 50 | 16.38 ms | 15.32 ms | 16.85 ms |
| 150 | 11.96 ms | 17.50 ms | 15.92 ms |
| 300 | 15.63 ms | 21.81 ms | 18.54 ms |

Three repetitions were used at each point; medians are the gate input because
the local Docker run contained occasional 90–118 ms outliers. The committed
JSON retains every min/mean/p50/p95 value.

The real modification sweep reduced 60 Merkle orphan candidates to 60 global
orphans and processed them in six 10-hash batches:

- end-to-end: 174.58 ms;
- batch p50/p95: 26.57/39.84 ms;
- sweep counters: 12 contested nodes, 12 contested relationships, 35
  fresh-surviving nodes, and 12 fresh-surviving relationships;
- explicit state checks: 48 facts, exactly 24 contested and 24 survived.

The 35 surviving nodes exceed the 24 explicitly checked facts because shared
subject entities also received fresh provenance. The drill intentionally
asserts exact state only for single-source detail nodes and their `ACTION`
edges, where the expected outcome is unambiguous.

### Retrieval and alias context

| Path | Hub (286 sources) p50 | Tail (19 sources) p50 | Hub output | Tail output |
|---|---:|---:|---:|---:|
| `GET /retrieve` | 123.34 ms | 10.82 ms | 286 graph/provenance rows | 19 graph/provenance rows |
| `fetchEntitySnippets` | 4.46 ms | 0.79 ms | bounded 600-char snippet | bounded 600-char snippet |

Both paths scale with evidence read, as expected. The hub retrieval is
materially slower than the tail, but at 286 sources it remains below the
migration trigger and returns 15 times as many facts. This measurement should
be watched as the corpus crosses one thousand documents.

## Cleanup and reproducibility

Cleanup removed 6,108 token-scoped graph nodes, 312 document-version rows,
12,792 membership rows, and 12,360 newly created AST rows. It then asserted
zero seeded graph nodes, document versions, and AST rows remained. Candidate
AST rows and graph names are pre-snapshotted so a collision cannot delete
pre-existing state.

The recorded environment was Node 20.19.2 on Windows x64, PostgreSQL 16.14,
and Neo4j 5.11.0. Run against a project-scoped Compose stack:

```bash
npm run db:init:dev
npm run drill:scale
```

Optional `--documents`, `--blocks`, `--seed`, and `--results` flags support
smaller smoke runs and future threshold runs. No OpenAI key or paid call is
used.
