# Trellis Engine API Reference

The Trellis Engine exposes a RESTful API to ingest documents into the deterministic pipeline and retrieve semantic graphs accompanied by physical provenance.

## 1. Ingestion Endpoint

### `POST /ingest`
Accepts a raw Markdown string, parses it into a Merkle-hashed AST, persists it to PostgreSQL, and queues the leaf nodes for background LLM extraction.

**Headers:**
- `Content-Type: text/markdown` or `text/plain`

**Request Body:**
Raw Markdown text.

**Example Request:**
```bash
curl -X POST http://localhost:3000/ingest \
  -H "Content-Type: text/markdown" \
  -d "# Globex Corporation
  
Globex recently completed a hostile takeover of Initech."
```

**Example Response:**
```json
{
  "message": "Accepted",
  "rootId": "21115bcdb74502b145bd50e38251e4e430071fe3129b8f06c5ecc069078f8e78",
  "totalNodes": 3,
  "leafNodesQueued": 1
}
```
*Note: The HTTP `202 Accepted` indicates the document was parsed and stored, and the extraction jobs have been placed in the BullMQ queue.*

---

## 2. Retrieval Endpoint

### `GET /retrieve`
Executes a graph traversal for a specific entity, finding all immediate 1-hop relationships. It then executes an $O(1)$ lookup to fetch the exact physical Markdown paragraphs from PostgreSQL that prove those relationships.

**Query Parameters:**
- `entity` (string, required): The name of the entity to query.

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

**Example Request:**
```bash
curl -N -X GET "http://localhost:3000/api/rlm-stream?query=Find%20the%20contradiction"
```

**Example Stream Output:**
```text
data: {"type": "stdout", "data": "Let's explore the graph...\n"}

data: {"type": "done", "code": 0}
```
