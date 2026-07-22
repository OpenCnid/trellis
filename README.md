# Trellis Engine

Trellis is OpenCnid's Recursive Language Model runtime: a model operating a
persistent Python REPL over a provenance-enforced knowledge substrate. Source
bytes become immutable Merkle ASTs, derived beliefs cite those bytes, and stale
evidence contests rather than silently deletes the beliefs that depend on it.

## Start here

- **Agents, LLMs, and coding harnesses:** read [`AGENTS.md`](AGENTS.md).
- **System orientation:** read [`docs/ORIENTATION.md`](docs/ORIENTATION.md) at
  the smallest useful depth, then use [`docs/README.md`](docs/README.md) to find
  the governing record for the task.
- **Canonical vocabulary:** [`docs/GLOSSARY.md`](docs/GLOSSARY.md).
- **Operators:** [`docs/operations/OPERATOR_MANUAL.md`](docs/operations/OPERATOR_MANUAL.md)
  and [`docs/operations/RUNBOOK.md`](docs/operations/RUNBOOK.md).
- **HTTP and SSE contracts:** [`docs/reference/API_REFERENCE.md`](docs/reference/API_REFERENCE.md).
- **Human contributors:** [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md).

`HANDOFF.md` and the former root technical roadmap are deprecated as active
session authorities. Current work comes from the collaborator's live task and
the task's governing records, not from a stale global objective queue.

## System shape

1. PostgreSQL stores immutable content-addressed AST nodes and document-version
   membership.
2. Neo4j stores semantic beliefs carrying `sourceNodeIds` back to exact source
   blocks.
3. Redis and BullMQ isolate asynchronous extraction, verification, resolution,
   RLM, and orchestration work.
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

Offline verification:

```bash
npm run check:repo-surface
npm test -- --no-file-parallelism
npm run build
npm run python:check
docker compose config --quiet
```

The project is licensed under the [MIT License](LICENSE).
