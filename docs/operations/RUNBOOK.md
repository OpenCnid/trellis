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

**Check queue depth without redis-cli** (T16): scrape the worker metrics
listener from inside the Compose network:

```bash
docker compose exec workers node -e "fetch('http://127.0.0.1:9464/metrics').then(r => r.text()).then(t => console.log(t.split('\n').filter(l => l.startsWith('trellis_queue_jobs')).join('\n')))"
```

**Common BullMQ Issues:**
- **Jobs waiting:** verify that `workers` is running, then inspect its logs.
- **Retries:** typed OpenAI connection errors, 408/409/429, and 5xx failures
  retry with bounded exponential backoff. Permanent OpenAI 4xx failures become
  unrecoverable immediately.
- **Interactive RLM jobs:** `rlm_queue` deliberately has no automatic retry;
  its SSE client owns redispatch so a background retry cannot spend LLM budget
  without a listener.
- **Agentic goals:** `agent_queue` (Session 9) follows the same interactive
  no-retry policy — an interrupted goal must not silently re-run paid
  orchestrator and sub-agent work with no listener. Every goal is
  hard-bounded (`AGENT_MAX_ITERATIONS_PER_GOAL`, `AGENT_MAX_TASKS_PER_GOAL`,
  `AGENT_MAX_CONCURRENT_TASKS`, `AGENT_TASK_MAX_ITERATIONS`); a goal that
  trips a bound ends as a typed `goal_failed` stream event, so a stuck goal
  is a worker or Redis problem, not a runaway loop.
- **Queue cleanup:** do not use `FLUSHALL`. Trellis shares Redis across seven
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
npm run test:agent-loop
npm run test:rlm-mcp
npm run test:a2a
```

The isolated Compose round trip starts the API without workers and receives no
OpenAI key:

```bash
docker compose --profile test up --build --abort-on-container-exit --exit-code-from integration integration
docker compose --profile test down --volumes --remove-orphans
```

Use a unique `COMPOSE_PROJECT_NAME` when another Trellis stack is running.

## 7. Observability (T16)

### 7.1 Structured logs

Every operational log line is one JSON object on stdout. Stable fields:
`level`, `time`, `service` (`api`/`workers` under Compose), `event`
(dot-namespaced, greppable), and — when applicable — `worker`, `queue`,
`jobId`, `attempt`, `requestId`, `docKey`, `version`, `astNodeId`, and a
serialized `err` (`type`/`message`/`stack`). `LOG_LEVEL` (default `info`)
controls verbosity. Request bodies, source text, prompts, SSE query
content, embeddings, and secrets are never logged.

Trace one request end to end: take `requestId` from the API's
`http.request_completed` log line or the `x-request-id` response header
the client received, then:

```bash
docker compose logs backend workers | grep '"requestId":"<id>"'
```

Key events: `ingest.accepted`, `ingest.failed`, `extraction.started`,
`extraction.merged`, `extraction.unresolved_action_endpoint`,
`extraction.action_dropped`, `extraction.superseded_before_start`,
`extraction.superseded_before_merge`,
`extraction.raced_invalidation_compensated`,
`invalidation.sweep_completed`, `invalidation.shared_sources_retained`,
`supervisor.evaluation_invalid`, `verification.belief_disputed`,
`resolution.sweep_started`, `resolution.sweep_completed`,
`resolution.alias_recorded`, `resolution.pair_distinct`,
`rlm.telemetry`, `rlm.telemetry_malformed`, `rlm.result`,
`rlm.result_malformed`, `rlm.mcp` (counts only — never tool arguments or
results), `agent.goal_started`, `agent.decision`,
`agent.task_dispatched`, `agent.task_completed`, `agent.goal_completed`,
`agent.goal_failed`, `a2a.task_submitted`, `a2a.task_state` (ids and
state enums only — never message or artifact content),
`a2a.recorder_ceiling`, `a2a.record_write_failed`, `a2a.request_failed`,
`worker.error_classified`,
`runtime.shutdown_started` / `runtime.shutdown_completed`.

### 7.2 Metrics topology

Two registries, one per process:

- **API**: `GET /metrics` on the API port, authenticated by `API_KEY`
  like every operational endpoint.
- **Workers**: unauthenticated internal listener on `WORKER_METRICS_PORT`
  (default `9464`). Compose does not publish it to the host; scrape it
  from the Compose network (`http://workers:9464/metrics`).

`/healthz` remains liveness-only and carries no metrics.

### 7.3 Metric catalog and diagnostic queries

| Question | Metric |
|---|---|
| Request/error rate per route | `trellis_http_requests_total{method,route,status_class}`, `trellis_http_request_duration_seconds` |
| Failure/retry rate per worker | `trellis_jobs_total{queue,worker,outcome}` with outcomes `started`, `completed`, `failed_retryable`, `failed_exhausted`, `failed_unrecoverable`; `trellis_job_duration_seconds` |
| Queue backlog | `trellis_queue_jobs{queue,state}` for all seven queues (`extraction_queue`, `rlm_queue`, `supervisor_queue`, `invalidation_queue`, `verification_queue`, `resolution_queue`, `agent_queue`), states `waiting`/`active`/`delayed`/`failed`; read failures in `trellis_queue_depth_read_failures_total{queue}` |
| Unresolved/dropped actions | `trellis_extraction_unresolved_endpoints_total`, `trellis_extraction_dropped_actions_total` |
| Superseded/compensated extractions | `trellis_extraction_superseded_total{stage}` (`before_start`, `before_merge`, `post_merge_compensated`) |
| Invalidation behavior | `trellis_invalidation_candidate_hashes_total`, `trellis_invalidation_retained_shared_hashes_total`, `trellis_invalidation_contested_total{kind}`, `trellis_invalidation_survived_total{kind}`, `trellis_invalidation_sweep_batches_total` |
| Verification outcomes | `trellis_verification_beliefs_total{result}` (`classified`, `agreed`, `disputed`, `skipped_no_text`, `skipped_no_answer`) |
| Entity-resolution outcomes | `trellis_resolution_candidates_total`, `trellis_resolution_pairs_total{verdict}` (`same`, `distinct`, `skipped_no_text`, `skipped_no_answer`) |
| Repository snapshot runs | `trellis_repo_snapshots_total{result}` (`published`, `failed`), `trellis_repo_files_total{outcome,language}` (`ingested`/`unchanged`/`tombstoned` by source language), `trellis_repo_skipped_files_total{reason}`, `trellis_repo_blocks_total{stage}` (`eligible`, `queued`) |
| Agentic goal loop | `trellis_agent_goals_total{outcome}` (`completed`, `failed`), `trellis_agent_decisions_total{action}` (`dispatch`, `finish`, `fail`), `trellis_agent_tasks_total{outcome}` (`ok`, `protocol_violation`, `error`); goal text and task queries never appear in labels or logs |
| A2A server surface (API process) | `trellis_a2a_requests_total{method}` (`SendMessage`, `SendStreamingMessage`, `GetTask`, `CancelTask`, `declined`, `invalid`), `trellis_a2a_tasks_total{outcome}` (`completed`, `failed`); message content and artifacts never appear in labels or logs |
| LLM spend | `trellis_llm_calls_total{operation,model}`, `trellis_llm_input_tokens_total`, `trellis_llm_output_tokens_total`, `trellis_llm_embedding_tokens_total` (operations: `extraction`, `extraction_embedding`, `supervision`, `verification`, `resolution`, `orchestration`) |
| RLM agent cost/health | `trellis_rlm_runs_total{exit_status}`, `trellis_rlm_input_tokens_total`, `trellis_rlm_output_tokens_total`, `trellis_rlm_subcalls_total`, `trellis_rlm_tool_calls_total`, `trellis_rlm_duration_seconds`, `trellis_rlm_telemetry_malformed_total` |
| External MCP tool usage | `trellis_rlm_mcp_calls_total` (label-free; counted separately from database tool calls — MCP never satisfies provenance). Per-run counts appear in the `rlm.mcp` log event |

Example PromQL once a scraper is attached:

```promql
# Extraction failure ratio over 15 minutes
sum(rate(trellis_jobs_total{worker="extraction",outcome=~"failed_.*"}[15m]))
/ sum(rate(trellis_jobs_total{worker="extraction",outcome="started"}[15m]))

# Tokens spent per operation over the last hour
sum by (operation) (increase(trellis_llm_input_tokens_total[1h]) + increase(trellis_llm_output_tokens_total[1h]))

# Sustained extraction backlog
trellis_queue_jobs{queue="extraction_queue",state="waiting"} > 100
```

Label discipline: job IDs, request IDs, document keys, AST hashes, entity
names, and error messages appear only in logs, never as metric labels.
High-cardinality label growth in a scrape is a regression — report it.

## 8. External MCP tool servers (Sessions 10 and 12)

The RLM sub-agent's external tool surface comes from `TRELLIS_MCP_SERVERS`
(a JSON array of servers, `transport: "stdio"` — the default — or
`"http"`), validated at worker startup and re-validated by the spawned
agent. Unset means no external tools. A stdio server is a child of the
RLM process spawned from the configured argument vector — never a shell
string; an http server is dialed over the MCP Streamable HTTP transport,
optionally with a credential referenced by env-var name
(`auth.valueEnv`). Only allowlisted tools are callable on either
transport. Details: README §External tools (MCP).

**A worker refuses to start after setting the variable**: the registry is
invalid, or it names a credential env var that is not set — the startup
error names the offending field or variable (never a credential value).
Fix the JSON or set the variable; do not work around it by moving the
value into a job payload (payloads carry nothing MCP-shaped by design).

**MCP server misbehaving** — symptoms and containment:

- *Hangs*: each call is bounded by the server's `timeoutMs`; the REPL sees
  a raised timeout error and the run continues. A server that hangs its
  handshake (spawn or dial) fails the run after 30 s with a readable
  error.
- *Unreachable URL* (http): the run fails fast at connect with a readable
  startup error naming the server. Check the service is up and the URL in
  your registry (errors name the server; the URL lives in your config).
- *Expired or wrong credential* (http): the server answers 401/403; the
  run fails at handshake with the status visible. The credential value
  itself is scrubbed to `[REDACTED]` in every raised error — the
  *redaction guarantee*: credential values never appear in logs, metrics,
  prompts, stdout, or error text. Rotate the value in the env var the
  registry names; the registry itself never changes for a rotation.
- *Oversized results*: truncated at `maxResultBytes` with an explicit
  `TRELLIS_MCP_TRUNCATED` marker in the tool result.
- *Dies at startup or mid-run*: the run fails (startup) or subsequent
  calls raise (mid-run); a stdio child's stderr lands on the agent's
  stderr.
- *Runaway usage*: watch `trellis_rlm_mcp_calls_total` and the per-run
  `rlm.mcp` event. Spend on a *metered* server is bounded per call, not
  per run — if a server bills per request, watch this counter closely.

Diagnosis: reproduce with the deterministic fixture
(`npm run test:rlm-mcp` — handshake, allowlist, timeout, truncation,
auth success/failure with redaction, and shutdown checks against
`scripts/fixture_mcp_server.py` over stdio and loopback Streamable
HTTP). If the fixture suite passes, the defect is in the configured
server, not the client. For a containerized tool server, the working
pattern is the `mcp-fixture` service in `docker-compose.yml` (test
profile): own service on the project network, no host port, bearer token
via env-var reference.

MCP calls never satisfy the database-provenance requirement: `mcp_calls`
is separate from `tool_calls` in `TRELLIS_TELEMETRY`, and a run with zero
database tool calls is still a `TRELLIS_PROTOCOL_VIOLATION` no matter how
much it searched.

## 9. A2A server surface (Session 11)

The A2A surface (`/.well-known/agent-card.json` + `POST /a2a/v1`) exists
only when `TRELLIS_A2A_ENABLED=true`; it dispatches external agents'
messages as ordinary agentic goals through the same gates and bounds as
`/api/agent-stream`. Environment: `TRELLIS_A2A_ENABLED`,
`A2A_AGENT_NAME`, `A2A_AGENT_DESCRIPTION`, `A2A_AGENT_URL` (the
advertised JSON-RPC URL — set it for any non-local deployment),
`A2A_TASK_TTL_SECONDS` (task-record retention, default 3600).
Contract: `API_REFERENCE.md` §5.

**External agent misbehaving** — symptoms and containment:

- *Request floods*: every dispatch passes the shared concurrent-goal gate
  (`AGENT_MAX_CONCURRENT_GOALS`) and the `agent_queue` depth backstop;
  over-limit requests get HTTP `429` and enqueue nothing. Watch
  `trellis_a2a_requests_total{method}` for volume and
  `trellis_queue_jobs{queue="agent_queue"}` for backlog. Confirm the
  `429`s in API logs (`http.request_completed` with `status: 429`).
- *Protocol garbage*: malformed JSON, bad envelopes, wrong params, and
  unsupported methods are answered with typed JSON-RPC errors and counted
  under `trellis_a2a_requests_total{method="invalid"}` (or `"declined"`
  for recognized-but-unserved spec methods). A rising `invalid` rate with
  a flat supported-method rate is a broken or hostile client, not a
  Trellis defect.
- *0.3-protocol clients*: a client that omits `A2A-Version: 1.0` is
  declined with `VersionNotSupportedError` (-32009) per spec — the fix is
  on the client side.
- *Goals that never finish*: a goal dispatched over A2A is bounded
  exactly like any other (see §3, agent_queue). The API-side task
  recorder additionally reclaims its subscriber and gate slot when the
  record TTL elapses (`a2a.recorder_ceiling` event); the Redis record
  then expires and `GetTask` returns `TaskNotFoundError`.
- *Spend*: A2A adds no new spend path — orchestrator/sub-agent spend
  appears under the existing agent metrics. To shut the surface off,
  unset `TRELLIS_A2A_ENABLED` and restart the API; in-flight goals run to
  their bounded end in the workers.

Emergency containment order: rotate/withdraw the API key (the RPC surface
is key-gated), then disable the flag. Task records are TTL-bounded Redis
keys (`a2a:task:<id>`); they never need manual cleanup.
