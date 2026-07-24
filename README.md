# Trellis Engine

Trellis is OpenCnid's Recursive Language Model runtime: a model operating a
persistent Python REPL over a provenance-enforced knowledge substrate. Source
bytes become immutable Merkle ASTs, derived beliefs cite those bytes, and stale
evidence contests rather than silently deletes the beliefs that depend on it.

> **Agents, LLMs, and coding harnesses start at [`AGENTS.md`](AGENTS.md).** It
> carries the project basis, the annotated file tree, and an index that fans out
> to [`AMBIENT.md`](AMBIENT.md), which binds every session whatever the task,
> and to [`.claude/rules/`](.claude/rules/), where each file carries the rules
> that fire on one kind of work.

## System shape

1. PostgreSQL stores immutable content-addressed AST nodes and document-version
   membership.
2. Neo4j stores semantic beliefs carrying `sourceNodeIds` back to exact source
   blocks.
3. Redis and BullMQ isolate asynchronous extraction, verification, invalidation,
   resolution, RLM, and orchestration work.
4. The Python RLM harness exposes bounded database, workspace, MCP, editing,
   and by-reference answer surfaces inside a persistent REPL.
5. Promotion is the only Tier-3-to-Tier-1 bridge; provenance is enforced at the
   write path.
6. The model never counts and never copies: locations are engine-computed and
   existing bytes move through guarded code operations.

## Fast path

Prerequisites are Node.js 22.18+ or 24.11+, Python 3.11+, and Docker Compose v2.

```bash
npm ci
cp .env.example .env
docker compose up -d postgres neo4j redis
npm run db:init:dev
npm run dev
```

Verification, all of it offline — no database, no containers, no network:

```bash
npm run check:repo-surface
npm run wiki:check -- --verify
npm test
npm run build
npm run python:check
npm run test:textedit
docker compose --profile test config --quiet
```

`python:check` and `test:textedit` run against the bare-host Python runtime,
which the operator manual below installs.

## Where to go next

| You want to | Open |
|---|---|
| orient at the shallowest depth that answers you | [`docs/ORIENTATION.md`](docs/ORIENTATION.md) — the whole system five times over, D0 one sentence through D4 the index |
| settle what a load-bearing term means | [`docs/GLOSSARY.md`](docs/GLOSSARY.md) |
| find the record that governs a topic | [`docs/README.md`](docs/README.md) |
| deploy, operate, or recover the stack | [`docs/operations/OPERATOR_MANUAL.md`](docs/operations/OPERATOR_MANUAL.md) and [`docs/operations/RUNBOOK.md`](docs/operations/RUNBOOK.md) |
| call the HTTP and SSE surfaces | [`docs/reference/API_REFERENCE.md`](docs/reference/API_REFERENCE.md) |
| contribute code | [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md) |

The project is licensed under the [MIT License](LICENSE).
