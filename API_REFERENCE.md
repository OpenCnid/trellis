# Trellis Engine API Reference

The Trellis Engine exposes a RESTful API to ingest documents into the deterministic pipeline and retrieve semantic graphs accompanied by physical provenance.

## 0. Health, Authentication, and Limits

### `GET /healthz`

Returns the unauthenticated process-liveness contract:

```json
{ "status": "ok", "scope": "liveness" }
```

This endpoint deliberately does not query PostgreSQL, Neo4j, or Redis.
Dependency readiness is established before startup by the failing schema
bootstrap and Compose service-health conditions. Keeping liveness separate
avoids restarting the application during a transient dependency outage.

When the `API_KEY` environment variable is set, every endpoint except
`/healthz` requires the key, supplied by any one of:

- `x-api-key: <key>` header
- `Authorization: Bearer <key>` header
- `?api_key=<key>` query parameter (for `EventSource`/SSE clients, which cannot set headers)

Requests without a matching key receive `401`. When `API_KEY` is unset the API is open — acceptable only for local development; the server logs a warning at startup.

**Size limits** (both configurable via environment):

| Limit | Default | Env var | Response when exceeded |
|---|---|---|---|
| Raw ingest body | 5 MB | `INGEST_MAX_BODY_MB` | `413` |
| PDF upload | 25 MB | `INGEST_MAX_UPLOAD_MB` | `413` |

Uploads must be PDFs (`400` otherwise) and are deleted from `uploads/` after parsing.

**RLM stream admission** (see §3): concurrent SSE streams are capped per process (`RLM_MAX_CONCURRENT_STREAMS`, default 4) and requests are refused while the `rlm_queue` backlog exceeds `RLM_QUEUE_MAX_DEPTH` (default 32); both cases return `429`.

**Agent stream admission** (see §4): concurrent goal streams are capped per process (`AGENT_MAX_CONCURRENT_GOALS`, default 2) and requests are refused while the `agent_queue` backlog exceeds `AGENT_QUEUE_MAX_DEPTH` (default 8); both cases return `429`.

### `GET /metrics`

Prometheus text exposition (`text/plain; version=0.0.4`) for the **API process**: request counters/durations by method, normalized route, and status class, LLM usage recorded in this process, and default Node.js process metrics. Authentication follows §0 — when `API_KEY` is set, an unauthenticated scrape receives `401`.

```bash
curl -H "x-api-key: $TRELLIS_API_KEY" http://localhost:3000/metrics
```

Route labels come from a fixed table (`/ingest`, `/retrieve`, `/api/rlm-stream`, `/healthz`, `/metrics`); any other path is labeled `unmatched`, so entity names, document keys, and query strings never become label values.

**Worker metrics are separate.** The worker container serves its own registry — BullMQ job outcomes, queue depth gauges for all five queues, extraction/invalidation/verification transition counters, LLM token spend, and RLM telemetry — on an internal HTTP listener (`WORKER_METRICS_PORT`, default `9464`, unauthenticated by design). Docker Compose does not publish that port to the host; it is reachable only on the Compose network (e.g. `http://workers:9464/metrics` from a sibling service or future scraper). See `docs/operations/RUNBOOK.md` §7 for the metric catalog.

Every request also produces one structured JSON log line (`event: "http.request_completed"`) carrying a generated `requestId`, which is returned to the client as the `x-request-id` response header; `/ingest` threads that `requestId` (with `docKey` and `version`) into the extraction and invalidation jobs it queues, so worker logs correlate back to the originating request.

## 1. Ingestion Endpoint

### `POST /ingest`
Accepts a raw Markdown string, parses it into a Merkle-hashed AST, persists it to PostgreSQL, and queues block-level nodes for background LLM extraction.

**Headers:**
- `Content-Type: text/markdown` or `text/plain`

**Query Parameters:**
- `doc_key` (optional): a stable identity for the document across versions. Re-ingesting under the same `doc_key` registers a new version and runs a Merkle diff against the previous one: unchanged subtrees are skipped entirely, only genuinely new block-level nodes are queued for extraction, and vanished node hashes are reported as per-document `orphaned` candidates. The invalidation worker filters those candidates against every document's latest version before quarantining semantic facts, so content shared by another live document is retained. Without `doc_key`, the root hash is used as the key and every ingest is version 1 of its own document. For multipart PDF uploads, `doc_key` may alternatively be sent as a form field.

**Request Body:**
Raw Markdown text.

**Example Request:**
```bash
curl -X POST "http://localhost:3000/ingest?doc_key=globex-report" \
  -H "Content-Type: text/markdown" \
  -d "# Globex Corporation
  
Globex recently completed a hostile takeover of Initech."
```

**Example Response:**
```json
{
  "message": "Accepted",
  "rootId": "21115bcdb74502b145bd50e38251e4e430071fe3129b8f06c5ecc069078f8e78",
  "docKey": "globex-report",
  "version": 1,
  "totalNodes": 5,
  "blocksEligible": 2,
  "blocksQueued": 2,
  "extractionPolicy": "changed",
  "diff": null
}
```
*Note: Before returning `202 Accepted`, ingestion reads every just-written AST row back inside the same PostgreSQL transaction, re-derives its ID through the parser's existing hash authority, and compares the complete stored payload. A missing or mismatched row rolls the version back. The response then indicates that the verified physical version was committed and the extraction jobs were placed in BullMQ. Extraction fans out one job per block-level node (paragraph, heading, list item, code block, or PDF element) carrying the block's full reconstructed inline text; `blocksQueued` counts those jobs, while `totalNodes` counts every stored AST node including inline leaves.*

On a re-ingest under an existing `doc_key`, `diff` reports the Merkle delta and `blocksQueued` counts only blocks new to this version — a byte-identical re-ingest queues zero jobs:
```json
{
  "message": "Accepted",
  "rootId": "de5a3c...",
  "docKey": "globex-report",
  "version": 2,
  "totalNodes": 5,
  "blocksEligible": 1,
  "blocksQueued": 1,
  "extractionPolicy": "changed",
  "diff": { "added": 3, "orphaned": 3, "retained": 2 }
}
```

Since Session 8 the endpoint is a thin parse/validate/delegate layer over
the verified ingest service (`src/core/ingestion/`), which also powers
the repository CLI. `blocksEligible` reports what a `changed` extraction
policy would pay for; the API always uses `changed` with no budget, so
`blocksQueued` equals `blocksEligible` — the repository CLI defaults to
`none`, queuing nothing.

---

## 1b. Repository Ingestion CLI

Whole-codebase ingestion is a client-side pipeline over per-file
`doc_key` ingests, not an API endpoint — the T6 request limits are
deliberately unchanged. See the README's "Repository ingestion" section
and `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md`:

```bash
npm run repo:ingest -- --repo-key my-repo --root /path/to/checkout --extract none
```

Each accepted file becomes one document (`repo:<repo-key>:<path>`) parsed
with a code-aware parser (TypeScript/JavaScript/Python/Markdown, plus an
opaque-text fallback for configuration formats). Snapshots are recorded
in PostgreSQL; a path missing from the next snapshot receives a tombstone
version whose invalidation sweep quarantines the facts it evidenced.
Extraction is opt-in (`--extract changed --max-blocks <n>
--confirm-extraction`) and prints the exact paid-job bound before writing.

---

## 2. Retrieval Endpoint

### `GET /retrieve`
Executes a graph traversal for a specific entity, finding all immediate 1-hop relationships. It then executes an $O(1)$ lookup to fetch the exact physical Markdown paragraphs from PostgreSQL that prove those relationships.

**Query Parameters:**
- `entity` (string, required): The name of the entity to query.
- `includeContested` (optional, default `false`): contested relationships — facts whose source bytes were orphaned by a document re-ingest and quarantined by the invalidation sweep — are excluded from results by default. Pass `true` to inspect the quarantined belief history (each contested edge carries `contested`, `contestedAt`, and `orphanedSourceIds`). A quarantined fact returns to default results once it is re-derived from live bytes — re-extracted by a re-ingest or re-written by the RLM. Dead hashes remain in `orphanedSourceIds`; if a document revert makes the identical hash live again, re-derivation moves that hash back to `sourceNodeIds`.
- `resolveAliases` (optional, default `true`): the seed entity is expanded one hop across non-contested `SAME_AS` edges whose `confidence` is at or above `RESOLUTION_MIN_CONFIDENCE` before the traversal, so facts recorded against an adjudicated alias (e.g. "globex" vs "globex corporation") are returned together with union provenance. Pass `false` to query the exact-name entity only. `includeContested` never relaxes the expansion filter — a contested equivalence does not widen results.

**Response fields (alias resolution):**
- `resolvedAliases`: the aliases the seed expanded across, as `{ name, confidence }` objects (empty when expansion is disabled or no qualifying `SAME_AS` edge exists).
- each `graph` entry carries `viaAlias`: the (lowercased) name of the seed-or-alias entity whose neighborhood produced that fact, so alias-contributed facts are attributable.

**Example Request:**
```bash
curl -X GET "http://localhost:3000/retrieve?entity=Globex%20Corporation"
```

**Example Response:**
```json
{
  "graph": [
    {
      "e": {
        "name": "globex corporation",
        "id": "e0ef3402...",
        "type": "Organization"
      },
      "r": {
        "verb": "acquired",
        "id": "globex_acquired_initech"
      },
      "neighbor": {
        "name": "initech",
        "id": "4cdc1a42...",
        "type": "Company"
      },
      "viaAlias": "globex corporation"
    }
  ],
  "provenance": [
    {
      "id": "2cc45731...",
      "content": "Globex recently completed a hostile takeover of Initech."
    }
  ],
  "fallback_active": false,
  "resolvedAliases": [
    { "name": "globex", "confidence": 0.93 }
  ]
}
```

---

## 3. RLM Agent Stream Endpoint

### `GET /api/rlm-stream`
Initiates an asynchronous Trellis RLM Agent execution to resolve physical contradictions and answers a user query dynamically. The endpoint streams the REPL thought process in real-time using Server-Sent Events (SSE).

**Query Parameters:**
- `query` (string, required): The prompt for the agent.
- `api_key` (required when `API_KEY` is configured): see §0 — `EventSource` cannot set headers.

**Responses:**
- `200` — SSE stream begins.
- `401` — missing/invalid API key (when configured).
- `429` — concurrency cap or queue-depth limit reached; retry later.
- `503` — the job queue is unreachable.

**Example Request:**
```bash
curl -N -X GET "http://localhost:3000/api/rlm-stream?query=Find%20the%20contradiction&api_key=$TRELLIS_API_KEY"
```

**Example Stream Output:**
```text
data: {"type": "stdout", "data": "Let's explore the graph...\n"}

data: {"type": "done", "code": 0}
```

The agent's stdout carries three machine-readable line conventions consumed
by clients and by the orchestrator (§4): `FINAL_ANSWER: <text>` (the prose
answer), `TRELLIS_TELEMETRY: {json}` (token/tool-call/duration accounting),
and `TRELLIS_RESULT: {json}` — the Session 9 task envelope
`{"status": "ok" | "protocol_violation" | "error", "answer": string | null, "toolCalls": number}`.
A `TRELLIS_PROTOCOL_VIOLATION` line additionally flags an answer produced
with zero database tool calls (no provenance).

---

## 4. Agentic Goal Stream Endpoint

### `GET /api/agent-stream`

Runs one **goal** through the agentic orchestration loop (Session 9): an
orchestrator — the same LLM under a planner system prompt, making
structured decisions validated at the Zod boundary — decomposes the goal
into single-task RLM runs, dispatches them as ordinary `rlm_queue` jobs,
observes their result envelopes, and iterates until it finishes, fails, or
trips a hard bound. Goal-level progress streams as SSE.

**Query Parameters:**
- `goal` (string, required): the goal to pursue.
- `api_key` (required when `API_KEY` is configured): see §0.
- `oracle` (JSON, optional; **rejected with `400` unless
  `AGENT_ORACLE_ENABLED=true`**): a scripted decision sequence with stubbed
  tasks for zero-LLM drills (`scripts/test_agent_loop.ts`). Production
  deployments leave the switch off.

**Responses:**
- `200` — SSE stream begins.
- `400` — missing goal, or an oracle script that is malformed/disabled.
- `401` — missing/invalid API key (when configured).
- `429` — goal concurrency cap or queue-depth limit reached; retry later.
- `503` — the job queue is unreachable.

**Stream events** (one JSON object per SSE `data:` frame; the stream ends
after a terminal event):

| Event | Payload highlights |
|---|---|
| `goal_started` | `goalId`, the effective per-goal bounds |
| `decision` | `iteration`, `action` (`dispatch`/`finish`/`fail`), `assessment`, `taskCount` |
| `task_started` | `iteration`, `taskId`, `query` |
| `task_result` | `outcome`: `{taskId, status, answer, toolCalls, spend}` |
| `goal_completed` *(terminal)* | `finalAnswer`, `iterations`, `tasksDispatched`, aggregated `spend` |
| `goal_failed` *(terminal)* | typed `failure` (`kind`, `reason`), `iterations`, `tasksDispatched`, `spend` |

Failure kinds: `iteration_bound`, `task_bound`, `concurrency_bound`
(bounds below), `decision_error` (the orchestrator completion failed the
schema boundary or the oracle script ran out), and `orchestrator_fail`
(the orchestrator itself declared the goal unachievable).

**Bounds and cost controls.** Every goal is hard-bounded by validated
configuration; tripping any bound ends the goal as a typed, streamed
failure with no further dispatches:

| Bound | Default | Env var |
|---|---|---|
| Decision rounds per goal | 4 | `AGENT_MAX_ITERATIONS_PER_GOAL` |
| Total tasks per goal | 8 | `AGENT_MAX_TASKS_PER_GOAL` |
| Tasks per dispatch batch (run concurrently) | 2 | `AGENT_MAX_CONCURRENT_TASKS` |
| RLM iterations per task (`--max-iterations`) | 5 | `AGENT_TASK_MAX_ITERATIONS` |

Task failures and protocol violations do **not** end the goal — they are
observations the next decision reacts to. The orchestrator never writes to
the graph; `write_derived_insight` inside the RLM sandbox remains the only
agentic write path. Aggregated spend (orchestrator completions plus
per-task `TRELLIS_TELEMETRY`) is reported on the terminal event and in the
worker's Prometheus registry under `operation="orchestration"`.

**Example Request:**
```bash
curl -N "http://localhost:3000/api/agent-stream?goal=Answer%20these%20two%20questions%20and%20reconcile%20them&api_key=$TRELLIS_API_KEY"
```
