# Trellis Engine Runbook

This runbook covers diagnosis and recovery for the current project-scoped
Docker Compose topology. Run commands from the repository root and set
`COMPOSE_PROJECT_NAME` when operating more than one Trellis stack. Do not use
container names copied from another project: Compose intentionally generates
names so local, CI, and disposable stacks can coexist.

## 0. First response

Establish which project and services you are operating before changing state:

```bash
docker compose ps
docker compose logs --tail=200 backend workers postgres neo4j redis
curl http://localhost:3000/healthz
```

`/healthz` is process liveness only. A healthy response does not prove that
PostgreSQL, Neo4j, Redis, or OpenAI is reachable. Compose gates initial
application startup on dependency health and successful schema initialization.

For an isolated project:

```bash
docker compose -p <project-name> ps
docker compose -p <project-name> logs --tail=200 backend workers
```

Confirm the project name before any `restart`, `stop`, `down`, or volume
operation.

## 1. Neo4j Operations

### Accessing the Browser
The Neo4j browser provides a visual interface to query the Semantic Layer.
- **URL:** `http://localhost:7474`
- **Default Credentials:** `neo4j` / `trellis_password`

Use Compose for command-line access:

```bash
docker compose exec neo4j cypher-shell -u neo4j -p trellis_password
```

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

### Destructive semantic reset

For a disposable development project only, this deletes the semantic graph but
leaves PostgreSQL and Redis intact:

```cypher
MATCH (n) DETACH DELETE n
```

Stop workers first so queued jobs cannot immediately repopulate the graph:

```bash
docker compose stop workers
```

Do not run this against a shared or production project. Preserve evidence and
take a backup before destructive recovery.

---

## 2. PostgreSQL Operations

PostgreSQL stores immutable AST payloads, document versions, version
membership, and embeddings.

**CLI Access:**
```bash
docker compose exec postgres psql -U trellis_user -d trellis_db
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

**Inspect current document versions**

```sql
SELECT DISTINCT ON (doc_key)
       doc_key, version, root_hash, ingested_at
FROM documents
ORDER BY doc_key, version DESC;
```

**Check provenance membership for a hash**

```sql
SELECT d.doc_key, d.version, dn.root_hash
FROM document_nodes dn
JOIN documents d ON d.root_hash = dn.root_hash
WHERE dn.node_id = '<ast-node-hash>'
ORDER BY d.doc_key, d.version DESC;
```

---

## 3. Queue Management (Redis / BullMQ)

BullMQ orchestrates the LLM extraction workers. If jobs are failing or stuck, Redis is the point of investigation.

**Check Redis connectivity:**

```bash
docker compose exec redis redis-cli ping
```

**Common BullMQ Issues:**
- **Jobs waiting:** verify that `workers` is running, then inspect its logs.
- **Retries:** typed OpenAI connection errors, 408/409/429, and 5xx failures
  retry with bounded exponential backoff. Permanent OpenAI 4xx failures become
  unrecoverable immediately.
- **Interactive RLM jobs:** `rlm_queue` deliberately has no automatic retry;
  its SSE client owns redispatch so a background retry cannot spend LLM budget
  without a listener.
- **Queue cleanup:** do not use `FLUSHALL`. Trellis shares Redis across five
  queues and pub/sub; `FLUSHALL` destroys every pending job and coordination
  key. Prefer allowing configured age/count retention to remove history.
  Before any exceptional purge, stop API admission and workers, capture logs,
  identify the exact Compose project/Redis instance, and use a reviewed
  queue-specific maintenance script.

Restart workers without recreating data services:

```bash
docker compose restart workers
docker compose logs --tail=200 -f workers
```

## 4. Ingestion and provenance incidents

The ingestion response is `202` only after PostgreSQL has:

1. persisted the complete AST in one bulk write;
2. read it back inside the transaction;
3. re-derived every hash and compared the full payload;
4. registered the document version and membership.

Extraction and invalidation happen asynchronously afterward. For a reported
stale or missing fact, capture:

- `docKey`, version, root ID, and diff counts from `/ingest`;
- the extraction or invalidation BullMQ job ID;
- relevant worker log events;
- Neo4j `sourceNodeIds`, `orphanedSourceIds`, `contested`,
  `contestedReason`, and `rederivedAt`;
- PostgreSQL membership for each referenced AST hash.

Do not delete contested facts during diagnosis. Quarantine is an audit-preserving
state transition, and re-derivation is designed to restore live provenance.

## 5. Shutdown and project removal

Normal shutdown sends SIGTERM to Node so the phase-ordered shutdown coordinator
stops API admission, workers, queues/publishers, and database clients:

```bash
docker compose stop
```

Remove containers while preserving named volumes:

```bash
docker compose down --remove-orphans
```

For a confirmed disposable project only, remove its data volumes:

```bash
docker compose -p <disposable-project-name> down --volumes --remove-orphans
```

Never run `down --volumes` until the Compose project name and data-retention
intent are confirmed.

## 6. Verification

Offline checks:

```bash
npm test
npm run build
npm run python:check
```

Zero-LLM live checks:

```bash
npm run test:api-hardening
npm run test:rlm-sandbox
npm run test:belief-recovery
npm run test:invalidation-sweep
```

The isolated Compose round trip starts the API without workers and receives no
OpenAI key:

```bash
docker compose --profile test up --build --abort-on-container-exit --exit-code-from integration integration
docker compose --profile test down --volumes --remove-orphans
```

Use a unique `COMPOSE_PROJECT_NAME` when another Trellis stack is running.

## 7. Session 4 observability target

T16 remains implementation work. Session 4 will replace operational
`console.*` output with structured JSON logs and add process-appropriate
metrics for API requests, BullMQ jobs, retries/failures, dropped transitions,
LLM token usage, verification/invalidation outcomes, and queue depth.

Until those metrics ship, rely on Compose service health, BullMQ state, the
machine-readable JSON events already emitted at critical transitions, and the
database audits above. Do not document a `/metrics` endpoint as available
until its contract and authentication are implemented and tested.
