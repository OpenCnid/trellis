# Trellis Engine

Trellis is OpenCnid's provenance-preserving GraphRAG engine. It is an original
codebase and is unrelated to other projects named Trellis.

Every semantic fact remains traceable to immutable, content-addressed source
bytes:

1. **Physical layer:** Markdown or PDF input becomes a SHA-256 Merkle AST in
   PostgreSQL/pgvector. PDF nodes retain bounding boxes when the parser
   provides them; Markdown nodes do not carry geometry.
2. **Semantic layer:** asynchronous workers extract Neo4j entities and
   relationships whose `sourceNodeIds` point back to AST hashes.
3. **Async/RLM layer:** Redis/BullMQ isolates retryable LLM work, and the
   Python RLM traverses both stores through provenance-aware tools.

## Prerequisites

- Node.js 22
- Python 3.11+ for bare-host RLM/PDF execution
- Docker Desktop with Compose v2
- `OPENAI_API_KEY` when running LLM workers

Trellis Engine is open source under the [MIT License](LICENSE).

## Bare-host development

Install the locked Node dependencies and create local configuration:

```bash
npm ci
cp .env.example .env
```

`src/config/environment.ts` loads `.env` once, then
`src/config/index.ts` validates all TypeScript configuration with Zod.
Existing shell values take precedence over `.env`. Set real `API_KEY` and
`OPENAI_API_KEY` values before non-local or paid-worker use.

Observability (T16): operational processes emit one JSON log line per
event on stdout, filtered by `LOG_LEVEL` (default `info`) and stamped
with `TRELLIS_SERVICE` (Compose sets `api`/`workers` per container). The
API serves authenticated Prometheus metrics at `GET /metrics`; the worker
process serves its own registry — including queue-depth gauges — on an
internal listener at `WORKER_METRICS_PORT` (default `9464`,
`WORKER_METRICS_HOST` default `0.0.0.0`) that Compose does not publish to
the host. See `API_REFERENCE.md` §0 and `docs/operations/RUNBOOK.md` §7.

Entity resolution (Session 5): `npm run resolve:sweep` proposes lexical
alias candidates and the resolution worker adjudicates them into
`SAME_AS`/`DISTINCT_FROM` overlay edges; `GET /retrieve` expands across
non-contested `SAME_AS` edges at or above `RESOLUTION_MIN_CONFIDENCE`
(default `0.8`; opt out per request with `?resolveAliases=false`).
`RESOLUTION_MAX_PAIRS_PER_SWEEP` (default `200`) caps each sweep's batch
and `RESOLUTION_BATCH_SIZE` (default `25`) sets pairs per LLM completion.

Start only the databases on Docker and initialize their schemas:

```bash
docker compose up -d postgres neo4j redis
npm run db:init:dev
```

Run the API and all workers:

```bash
npm run dev
```

API-only and worker-only development entrypoints are also available:

```bash
npm run dev:api
npm run dev:workers
```

## Production build

The checked-in build configuration emits CommonJS under `dist/`; `tsx` and
TypeScript remain development-only dependencies.

```bash
npm ci
npm run build
npm run db:init
npm start
```

`npm start` launches the API and every worker. `npm run start:api` and
`npm run start:workers` run split production processes.

The Python manifests separate direct application dependencies from the
reviewed imports needed by `partition_pdf(strategy="fast")`. Fast mode does
not ship the multi-gigabyte Torch/transformer stack used only by hi-res
inference:

```bash
python -m pip install --requirement requirements.txt --requirement requirements-pdf-fast.txt
python -m pip install --no-deps --requirement requirements-pdf-fast-nodeps.txt
npm run python:check
```

## Containers

Compose uses its normal `.env` interpolation path and supplies explicit
service-DNS connection values inside containers. The bare-host defaults in
`src/config/index.ts` remain unchanged.

```bash
cp .env.example .env
# Set API_KEY and OPENAI_API_KEY in .env before non-local use.
docker compose up --build -d
docker compose ps
```

The application image:

- compiles TypeScript in a build stage and installs production Node modules
  only in the runtime;
- includes the pinned Python RLM/PDF environment and PDF system packages;
- runs as the non-root `node` user with a writable `uploads/` directory;
- waits on healthy PostgreSQL, Neo4j, and Redis services;
- runs idempotent schema initialization before `exec`-ing Node.

Compose runs API and workers as separate services from the same image.
Removing fixed container names keeps containers and named volumes scoped to
the Compose project. Host ports can be overridden with
`TRELLIS_*_HOST_PORT`; setting them to `0` lets Docker allocate isolated CI
ports.

### Health and shutdown

`GET /healthz` is an unauthenticated, liveness-only endpoint:

```bash
curl http://localhost:3000/healthz
# {"status":"ok","scope":"liveness"}
```

Dependency readiness is established by Compose health conditions and the
failing schema bootstrap. Database outages do not intentionally trigger
container restart loops through `/healthz`.

The entrypoint replaces itself with Node after initialization, so
`docker compose stop` delivers SIGTERM directly to the application and PR
#21's phase-ordered shutdown closes admission, workers, queues, and database
clients.

## Verification

Offline checks require no Docker or API key:

```bash
npm test
npm run build
npm run python:check
```

The deterministic Compose round trip starts only the API—never the workers—
and does not receive `OPENAI_API_KEY`. It ingests a lone thematic break
(zero extraction jobs), verifies PostgreSQL document membership, seeds one
provenance-bearing Neo4j relationship, and retrieves it through the API:

```bash
docker compose --profile test up --build --abort-on-container-exit --exit-code-from integration integration
docker compose --profile test down --volumes --remove-orphans
```

Use a unique `COMPOSE_PROJECT_NAME` and host ports set to `0` when running this
beside another stack. The GitHub Actions workflow does this automatically and
removes only its isolated project and volumes.

Existing live, zero-LLM checks:

```bash
npm run test:api-hardening
npm run test:rlm-sandbox
npm run test:belief-recovery
npm run test:invalidation-sweep
```

See [API_REFERENCE.md](API_REFERENCE.md) for endpoint contracts.
