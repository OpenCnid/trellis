# Trellis Engine API Reference

The Trellis Engine exposes a RESTful API to ingest documents into the deterministic pipeline and retrieve semantic graphs accompanied by physical provenance.

## 0. Authentication and Limits

When the `API_KEY` environment variable is set, **every endpoint** requires the key, supplied by any one of:

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
  "blocksQueued": 2,
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
  "blocksQueued": 1,
  "diff": { "added": 3, "orphaned": 3, "retained": 2 }
}
```

---

## 2. Retrieval Endpoint

### `GET /retrieve`
Executes a graph traversal for a specific entity, finding all immediate 1-hop relationships. It then executes an $O(1)$ lookup to fetch the exact physical Markdown paragraphs from PostgreSQL that prove those relationships.

**Query Parameters:**
- `entity` (string, required): The name of the entity to query.
- `includeContested` (optional, default `false`): contested relationships — facts whose source bytes were orphaned by a document re-ingest and quarantined by the invalidation sweep — are excluded from results by default. Pass `true` to inspect the quarantined belief history (each contested edge carries `contested`, `contestedAt`, and `orphanedSourceIds`). A quarantined fact returns to default results once it is re-derived from live bytes — re-extracted by a re-ingest or re-written by the RLM. Dead hashes remain in `orphanedSourceIds`; if a document revert makes the identical hash live again, re-derivation moves that hash back to `sourceNodeIds`.

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
      }
    }
  ],
  "provenance": [
    {
      "id": "2cc45731...",
      "content": "Globex recently completed a hostile takeover of Initech."
    }
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
