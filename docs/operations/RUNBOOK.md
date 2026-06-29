# Trellis Engine Runbook

This runbook is intended for the DevOps and Backend Engineering teams responsible for monitoring, debugging, and maintaining the Trellis Engine MVP in a production-like environment.

## 1. Neo4j Operations

### Accessing the Browser
The Neo4j browser provides a visual interface to query the Semantic Layer.
- **URL:** `http://localhost:7474`
- **Default Credentials:** `neo4j` / `trellis_password`

### Common Cypher Queries
**Find All Nodes & Edges (The Sanity Check)**
```cypher
MATCH (n) RETURN n LIMIT 100
```

**Find Orphaned Entities**
Entities that have no connections (often a sign of a failed extraction or LLM hallucination).
```cypher
MATCH (e:Entity)
WHERE NOT (e)-[]-()
RETURN e
```

**Find Nodes Missing Provenance**
Ensure that the cryptographic bridge is intact.
```cypher
MATCH (e:Entity)
WHERE e.sourceNodeIds IS NULL OR size(e.sourceNodeIds) = 0
RETURN e
```

### The Nuclear Option
If the graph becomes corrupted during testing or you need a complete semantic wipe:
```cypher
MATCH (n) DETACH DELETE n
```
*(Warning: This does not clear PostgreSQL. The physical AST will remain.)*

---

## 2. PostgreSQL Operations

PostgreSQL stores the physical Immutable AST layer. It can be accessed via `docker exec` or a standard GUI client.

**CLI Access:**
```bash
docker exec -it trellis-postgres psql -U trellis_user -d trellis_db
```

### Common SQL Queries
**Count Total AST Nodes**
```sql
SELECT COUNT(*) FROM ast_nodes;
```

**View the Raw JSONB AST Content**
If you need to verify the Merkle-hashing properties of a specific document block:
```sql
SELECT id, data->>'type' as type, data->>'content' as content 
FROM ast_nodes 
LIMIT 10;
```

---

## 3. Queue Management (Redis / BullMQ)

BullMQ orchestrates the LLM extraction workers. If jobs are failing or stuck, Redis is the point of investigation.

**Monitor Redis Connections:**
```bash
docker exec -it trellis-redis redis-cli ping
```

**Common BullMQ Issues:**
- **Stuck Jobs / Not Processing:** Check if the extraction worker process (`src/workers/extraction_worker.ts`) is running. If the worker crashed (e.g., OOM or unhandled exception), jobs will remain in the `wait` or `active` state indefinitely until a worker is revived.
- **503 Rate Limits from OpenAI:** The BullMQ configuration automatically uses exponential backoff to handle 429 and 503 errors. Let the queue automatically retry before intervening.
- **Clearing the Queue Manually:** If you need to purge the Redis queue entirely, you can flush the Redis instance:
  ```bash
  docker exec -it trellis-redis redis-cli FLUSHALL
  ```
  *(Warning: This will destroy all pending and active jobs.)*
