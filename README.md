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
   Python RLM (Recursive Language Model) traverses both stores through
   provenance-aware tools, with `write_derived_insight` as the single
   provenance-required write path.
4. **Agency layer:** an agentic goal loop decomposes one goal into many
   RLM runs behind hard bounds (a tool-free orchestrator plans; only the
   RLM touches data); external agents can dispatch goals over A2A
   (opt-in), and the RLM can call operator-configured external tools
   over MCP — whose results are research context only, never provenance.

This list is a high-level summary. The living architectural mental model
— the single source of truth a session loads first — is `HANDOFF.md` §1;
forward design lives in `docs/architecture/WORKSPACE_AND_MODULES.md`, and
canonical terminology in `docs/GLOSSARY.md` (authority: code > glossary >
prose).

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

## Repository ingestion

Whole-codebase ingestion (Session 8) turns one repository snapshot into a
bounded sequence of per-file document ingests through the same verified
service as `POST /ingest` — never one giant request or transaction:

```bash
npm run repo:ingest -- --repo-key my-repo --root /path/to/checkout --extract none
```

- **File set:** `git ls-files` (tracked files) by default;
  `--include-untracked` adds untracked files that `.gitignore` does not
  exclude. Paths are normalized POSIX-relative; absolute paths, `..`
  traversal, symlinks, vendor/generated directories (`node_modules/`,
  `dist/`, …), files over `--max-file-bytes` (default 2 MiB), binaries,
  and unsupported extensions are skipped with deterministic reason counts.
- **Languages:** TypeScript/JavaScript (`@babel/parser`) and Python
  (stdlib `ast` via the pinned interpreter) produce code-aware Merkle
  ASTs whose extraction blocks are top-level functions, classes with
  per-method child blocks, and bounded chunks for imports/trivia — each
  block's content is the exact source bytes. Markdown keeps the existing
  parser; common configuration/text formats use an opaque-text fallback.
- **Identity and deletion:** each file is one document
  (`repo:<repo-key>:<relative-path>`), so commit-to-commit edits are
  per-file Merkle diffs. Snapshots are recorded in PostgreSQL and only
  published after every file succeeds; a path present in the previous
  published snapshot but absent now receives a tombstone version, which
  quarantines (never deletes) the semantic facts its bytes evidenced. A
  rename is a tombstone plus a new document. Re-running an unchanged
  snapshot is an auditable no-op. A partial failure exits nonzero and
  leaves the previous snapshot effective.
- **Cost:** `--extract none` (default) performs zero paid work — no
  extraction or embedding jobs. `--extract changed` requires an explicit
  positive `--max-blocks` budget plus `--confirm-extraction`, and the CLI
  prints the exact files/bytes/blocks/paid-job bound before any write
  (`--dry-run` stops there).

Live coverage: `npm run test:repo-ingest` (zero LLM calls). Details and
measured results: `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md`.

## Agentic goals

The agentic orchestration loop (Session 9) lets one goal drive many RLM
runs. `GET /api/agent-stream?goal=...` enqueues a goal; the agent worker
runs an orchestrator — the same LLM under a planner system prompt, its
decisions validated at the Zod boundary — that decomposes the goal into
single-task RLM sub-agent runs (ordinary `rlm_queue` jobs), reads their
`TRELLIS_RESULT` envelopes, and iterates. Progress streams as goal-level
SSE events (`goal_started`, `decision`, `task_started`, `task_result`,
`goal_completed`/`goal_failed`).

Every goal is hard-bounded by validated config —
`AGENT_MAX_ITERATIONS_PER_GOAL` (default 4), `AGENT_MAX_TASKS_PER_GOAL`
(8), `AGENT_MAX_CONCURRENT_TASKS` per batch (2), and
`AGENT_TASK_MAX_ITERATIONS` forwarded to each RLM run (5) — and a tripped
bound ends the goal as a typed streamed failure. Admission mirrors the RLM
stream (`AGENT_MAX_CONCURRENT_GOALS`, `AGENT_QUEUE_MAX_DEPTH`; over-limit
requests get `429`). The orchestrator never touches either database:
`write_derived_insight` inside the RLM sandbox remains the single agentic
write path. A real goal makes paid LLM calls; the zero-LLM drill
(`npm run test:agent-loop`) exercises the whole loop with scripted oracle
decisions and stubbed tasks (`AGENT_ORACLE_ENABLED=true`, off by default).
See `API_REFERENCE.md` §4 for the event contract.

## Agent interoperability (A2A)

Trellis can serve its goal loop to external agents over the
[A2A protocol](https://a2a-protocol.org/) (Agent2Agent, Linux Foundation;
spec v1.0.0, JSON-RPC binding) — Session 11. The surface is **off by
default**: set `TRELLIS_A2A_ENABLED=true` to mount it; with the flag
unset the API is byte-identical to a pre-Session-11 process.

- **Discovery:** the Agent Card is served unauthenticated from
  `/.well-known/agent-card.json` (it is how a client learns the required
  security scheme, and it carries only public contract). Card fields come
  from validated config: `A2A_AGENT_NAME`, `A2A_AGENT_DESCRIPTION`, and
  `A2A_AGENT_URL` — set the URL to the externally reachable JSON-RPC
  endpoint for any non-local deployment.
- **Method surface:** one JSON-RPC 2.0 endpoint at `POST /a2a/v1` behind
  the existing API key, requiring `A2A-Version: 1.0`. `SendMessage`
  (blocking by default, `returnImmediately` supported),
  `SendStreamingMessage` (SSE status/artifact updates), `GetTask`
  (TTL-bounded Redis task records, `A2A_TASK_TTL_SECONDS` default 3600),
  and `CancelTask` (declined — the loop has no abort path). Everything
  else gets the spec's typed error codes.
- **Bounds inheritance:** an A2A task IS one agentic goal. Dispatch flows
  through the same admission gates as `/api/agent-stream` (one shared
  concurrent-goal cap, the `agent_queue` depth backstop → HTTP `429`
  with a JSON-RPC error body) and every `AGENT_*` per-goal bound holds.
  The message text is the only payload that crosses into the loop; no
  A2A parameter can name a tool, raise a bound, or reach the RLM/MCP
  layer. Nothing arriving over A2A touches either database directly.
- **Zero-paid drill:** `npm run test:a2a` exercises discovery, the full
  method surface, streaming, bound trips, auth/version rejection, the
  malformed-JSON-RPC matrix, and admission saturation with oracle
  decisions and stubbed tasks — no LLM calls, no external network.

See `API_REFERENCE.md` §5 for the wire contract.

## External tools (MCP)

The RLM sub-agent can call external tools over the Model Context Protocol
(Session 10) — web search is the first intended tool. The surface is
operator-configured and nothing else: set `TRELLIS_MCP_SERVERS` to a JSON
array of servers, each with a per-tool allowlist and per-call bounds.
Two transports (Session 12), discriminated by `transport`:

- **`stdio`** (the default when the field is absent, so pre-Session-12
  registries parse unchanged): an explicit argument vector spawned as a
  child of the RLM process — never a shell string.
- **`http`**: a remote server reached over the MCP Streamable HTTP
  transport (spec 2025-06-18; the deprecated HTTP+SSE transport is not
  supported). `https://` is always accepted; plain `http://` only for
  loopback, RFC1918, or dot-free (Compose/LAN service DNS) hosts, so a
  credential is never sent in cleartext across a public network.

```bash
TRELLIS_MCP_SERVERS='[
  {"name":"websearch","command":["python","/path/to/server.py"],"tools":["web_search"],"timeoutMs":10000,"maxResultBytes":65536},
  {"transport":"http","name":"hosted","url":"https://tools.example.com/mcp","tools":["web_search"],
   "auth":{"kind":"bearer","valueEnv":"HOSTED_MCP_TOKEN"}}
]'
```

**Credentials are references, never values.** An `http` server may carry
`auth: {kind: "bearer" | "header", header?, valueEnv}` — `valueEnv` NAMES
an environment variable; the worker resolves it at startup (a registry
naming an unset variable refuses to start) and forwards exactly the named
variables to the spawned agent. The value never appears in the registry
JSON, the system prompt, logs, metrics, or error messages — every raised
tool error is scrubbed (`[REDACTED]`) before it reaches the REPL.

The registry is Zod-validated at startup, forwarded to the spawned agent
like the database credentials, and re-validated in Python. The REPL then
sees one injected `trellis_mcp` object (`list_tools()`,
`call_tool(server, tool, arguments)`); tools outside the allowlist are
rejected before any I/O, every call is time-bounded over either
transport, and oversized results are truncated with an explicit marker.
No queue payload or model output can name, spawn, or dial a server. When
the variable is unset, nothing is injected and the RLM behaves
byte-identically to a pre-Session-10 run.

**Containerized tool servers** are the recommended deployment shape for
servers you operate yourself: run the tool server as its own Compose
service on the project network (own image, no host-published port) and
point an `http` registry entry at its service DNS name — see the
`mcp-fixture` service in `docker-compose.yml` (test profile) for the
working pattern, including bearer auth via an env-var reference.

**Provenance rule (hard):** MCP results are research context only. They
carry no AST hashes, can never be passed as `sourceNodeIds`, and do not
count toward the database-provenance requirement — a run that only
searched the web is still a `TRELLIS_PROTOCOL_VIOLATION`. External content
earns citability only by being ingested through the verified ingest path.
MCP usage is reported separately as `mcp_calls` in the telemetry line and
the `trellis_rlm_mcp_calls_total` metric. Since Session 14 the write path
also enforces this structurally: every `sourceNodeIds` element must be a
64-lowercase-hex AST hash that exists in `ast_nodes`, checked before any
write session opens.

**Workspace capture (Session 14):** when the Tier-3 workspace is active
(MCP servers configured, or the run carries a goal id), every MCP result
is captured into the in-REPL workspace as an origin-stamped segment
inside the tool call itself, and `call_tool` returns a bounded stub
(`segmentId`, size, truncation flag, ≤500-char preview) instead of the
full payload. The model pulls full content deliberately with
`trellis_workspace.segment(id)` or fans `llm_query` out over segments —
context stays small while captured knowledge grows. The workspace also
holds the agent's plan and self-notes; bounds come from
`TRELLIS_WORKSPACE_MAX_SEGMENTS` (default 128) and
`TRELLIS_WORKSPACE_MAX_BYTES` (default 4 MiB), and over-budget writes
raise a readable error rather than silently truncating stored state.
Workspace state has no provenance standing and is reported in telemetry
as counts only (`workspace_ops`/`workspace_segments`/`workspace_bytes`).
With no MCP servers and no goal id, nothing is injected and prompt and
behavior are byte-identical to a pre-Session-14 run:

```bash
npm run test:rlm-workspace
```

**Workspace lineage (Session 16):** within one agentic goal, workspaces
are inherited between iterations. At task end the harness serializes a
non-empty workspace and parks the snapshot goal-scoped in Redis —
age-bounded by `SCRATCH_TTL_SECONDS` (default 3600, hard cap 24 h) and
volume-bounded per goal by `SCRATCH_MAX_BYTES_PER_GOAL` (default
8 MiB). The orchestrator sees each task's parked snapshot only as a
counts-only `workspaceRef` and routes by reference: a later task
dispatched with `seedFromTasks` names prior task ids, and the worker
resolves, merges, and re-validates their snapshots into that run's
workspace at spawn — plan, notes, segments, and origin stamps restored
verbatim, so exact identifiers (AST hashes above all) cross tasks
byte-exact instead of being re-typed through two LLM hops. Tasks in one
batch stay independent (inheritance, never a live blackboard); a
missing or expired reference fails the seeded task with a readable
error, and an over-budget seed fails fast rather than truncating.
Parked state keeps Tier-3 trust standing: none.

**Promotion (Session 17):** the operator-gated route by which a
workspace segment earns permanence. Promotion is a human running a CLI —
there is no API endpoint, and no model output can trigger it. It
consumes a PARKED snapshot only, one segment per invocation:

```bash
# LIST (default, read-only): inventory a task's parked snapshot —
# segment ids, origin stamps, sizes, truncation markers, previews,
# and a deterministic doc-key hint per segment.
npm run promote -- --goal <goalId> --task <taskId>

# PROMOTE: one segment, byte-verbatim, through the ordinary verified
# ingest transaction. Zero paid work by default (--extract none).
npm run promote -- --goal <goalId> --task <taskId> \
  --segment <segmentId> --doc-key web:https://example.com/page
```

Pick the doc key deliberately — it is the document's identity across
versions. Use `web:<url>` for web content: re-promoting the re-fetched
page later registers a new version of the SAME document, and the
existing Merkle-diff → invalidation sweep contests beliefs whose
web-sourced bytes changed, exactly as for an edited local document. For
non-URL tool results, list mode prints the deterministic fallback
`mcp:<server>:<tool>:<argsHash>`. Keys are never invented silently, and
truncated segments are refused outright (a size-capped capture is not
the source bytes). The CLI echoes the doc key, byte count, and origin
stamp before writing, records that origin on the `documents` row inside
the same transaction, and prints the resulting root and block hashes —
those block hashes are now verified substrate the RLM may cite as
`sourceNodeIds`. Extraction stays separately gated spend:
`--extract changed` requires an explicit `--max-blocks` budget plus
`--confirm-extraction`, exactly like `repo:ingest`. The end-to-end loop
(refusals, earned citability through the hardened write path, and the
contested transition on re-promotion) is drilled zero-paid:

```bash
npm run test:promotion
```

**Cost posture:** acceptance is zero-paid and local — the deterministic
fixture server (`scripts/fixture_mcp_server.py`, stdio and loopback
Streamable HTTP, with and without required auth) is the only server the
drill configures:

```bash
npm run test:rlm-mcp
```

## Modules (protocol registry)

The RLM's cognitive protocols are composed from a versioned module
registry (Session 15; design record §9). A module lives under
`modules/<name>/` as a `module.json` manifest plus a brace-free
addendum text file; the composed system prompt is kernel base +
selected module addenda + workflow rules. This kernel edition supports
**protocol modules only** — manifests declaring tools are rejected.

Selection is operator-owned via `TRELLIS_MODULES`: unset loads the
default selection (`["spatial-flywheel"]` — module #0, the extracted
spatial-flywheel protocol), which composes a prompt **byte-identical**
to the pre-extraction monolith (pinned by hash); a JSON array selects
exactly those registered modules (max 4); `[]` composes none. Both the
Node config (fail-fast at startup) and the Python agent (defensively,
at spawn) validate the same files with identical bounds. Addendum files
carry no literal braces (the rlms `.format()` contract); rubric text
enters through the single `<<TRELLIS_RUBRIC>>` substitution token.
Module #0 carries empty research provenance (it predates the promotion
path); the manifest-as-graph-entity representation for research-change
contestation lands with the first research-bearing module.

```bash
npm run test:modules
```

Real networked or metered MCP servers (an actual web-search provider) are
owner-approved runs: print the configured allowlist first and record the
observed `mcp_calls`.

## Benchmarks

The OOLONG-Pairs harness ships two committed, seeded corpora:

- `data/oolong_pairs_dataset.json` — v1 (`oolong-pairs-trec-synthetic-v1`),
  the saturated baseline behind the committed `benchmark_results.json`.
  Never regenerated; the update/poison drills reference it (and the update
  drill's mutated byte-version at `data/oolong_pairs_dataset_v2.json`).
- `data/oolong_pairs_dataset_hard.json` — v2
  (`oolong-pairs-trec-synthetic-v2`, `npm run oolong:generate:v2`), the
  anti-shortcut corpus: paraphrased city mentions that never contain the
  canonical token, near-miss questions that name-drop unannotated cities,
  and non-question prose distractors ingested as `:Passage` nodes.

The harness CLIs accept `--dataset <path>` and default to v1:

```bash
npm run oolong:ingest -- --dataset data/oolong_pairs_dataset_hard.json
npm run oolong:pairs -- --dataset data/oolong_pairs_dataset_hard.json
tsx scripts/audit_flywheel_cache.ts --dataset data/oolong_pairs_dataset_hard.json
npm run oolong:benchmark -- --dataset data/oolong_pairs_dataset_hard.json
```

A benchmark run appends a post-warm `cache_audit` block (shared with the
audit CLI and the poison drill via `src/benchmarks/oolong/cache_audit.ts`)
to its results. Runs against a non-v1 dataset write
`benchmark_results_v2.json` (or `--results <path>`); the runner refuses to
overwrite the committed v1 `benchmark_results.json` with another corpus's
results. Benchmark runs make paid LLM calls — see
`docs/benchmarks/CRITIQUE_AND_FUTURE.md` before running.

The semantic-provenance scale drill is deterministic and makes no LLM calls.
It writes 300 synthetic versioned documents through the physical registry and
the production graph merge, measures provenance cardinality and the real
sweep/retrieval/context-fetch paths, verifies quarantine and fresh-survival
behavior after 12 re-ingests, writes `scale_drill_results.json`, and removes
only its token-scoped state:

```bash
npm run drill:scale
# Optional shape overrides:
npm run drill:scale -- --documents 150 --blocks 20 --seed 20260706
```

## Verification

Offline checks require no Docker or API key:

```bash
npm test
npm run build
npm run python:check
```

The deterministic Compose round trip starts the API and workers with a
non-secret placeholder key but queues no paid work. It ingests a lone thematic
break (zero extraction jobs), verifies PostgreSQL document membership, seeds
one provenance-bearing Neo4j relationship, checks both metrics surfaces, and
retrieves the relationship through the API:

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
npm run test:entity-resolution
npm run test:benchmark-hardening
npm run test:repo-ingest
npm run test:agent-loop
npm run test:rlm-mcp
npm run test:promotion
npm run test:rlm-workspace
npm run test:modules
npm run test:a2a
```

See [API_REFERENCE.md](API_REFERENCE.md) for endpoint contracts.
