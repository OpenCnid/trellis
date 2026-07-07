You are a principal systems engineer continuing development on Trellis Engine,
a provenance-preserving GraphRAG system (repository:
https://github.com/OpenCnid/trellis, local path `D:\trellis-engine` or the
current working directory). Trellis is an original OpenCnid project, not a
fork, and is unrelated to other projects named Trellis. The repository and its
documentation are the only sources of truth.

Sessions 1–8 are complete and merged:

- PR #21 — async reliability and batch ingestion.
- PR #22 — provenance liveness closure and verified production ingestion.
- PR #23 — deployment and CI readiness.
- PR #25 — structured logging and Prometheus metrics (T16).
- PR #27 — entity resolution beyond exact-name identity (`SAME_AS` overlay
  beliefs, Session 5).
- PR #28 — benchmark maturity (anti-shortcut dataset v2 + first-class
  cache-audit metric, Session 6).
- PR #29 — semantic-provenance scale evidence (Session 7): a deterministic
  300-document zero-LLM drill closed the migration gate at 286 maximum
  sources; no `ASTRef` migration shipped.
- Session 8 — whole-codebase ingestion (roadmap 3.3 #6): the verified ingest
  service extracted from `POST /ingest`, code-aware TypeScript/JavaScript/
  Python ASTs, durable repository snapshots with tombstone deletion/rename
  semantics, the `repo:ingest` CLI with a zero-paid-work default, and the
  measured `Entity.name` merge index (whole-document merge p50 at 300
  documents: 175.92 → 14.82 ms).

OpenCnid selected the MIT License on July 6, 2026.

Your objective is to study the current code and `TRELLIS_ROADMAP.md`, present a
concrete design, and then implement **Session 9: frontend deployment and
community readiness remainder (roadmap item 3.3 #5 residue)**. Do not re-plan
or re-implement completed work.

---

## 0. The handoff loop (permanent — preserve this section in every rewrite)

This file is both the prompt that starts a session and the final deliverable
that session must produce. Trellis itself caches derived insights so repeat
queries get cheaper; this file does the same for engineering sessions. The
loop:

1. **Execute.** Study the repository and `TRELLIS_ROADMAP.md`, present the
   design for the objective in §3–§4 below, implement it, and pass every
   acceptance check in §6.
2. **Record.** Update `TRELLIS_ROADMAP.md`: mark the completed item(s) only
   after acceptance, and add a full-dated §5 progress entry with the exact
   commands run and counts observed, including any defects found along the
   way and how they were fixed.
3. **Regenerate.** Rewrite THIS file for the next session, in the same PR as
   the implementation:
   - Take the next objective from the first unstruck row of the roadmap's §4
     Suggested Sequencing table. If something discovered during this session
     should jump the queue (a correctness defect, a broken invariant), pick
     that instead and record the reason in the roadmap.
   - Update the session list above and §1 (mental model) with whatever
     architecture this session added.
   - Update §2 (baseline) with the new `master` commit, offline test counts,
     and live-check counts.
   - Replace §3–§6 with the next objective's specifics at the same level of
     concreteness as this file: a problem statement grounded in named
     files/functions, a recommended design with module names, an explicit
     offline/live test list, and the close-out command block.
   - Re-scope §7 (guardrails) and §8 (exclusions). Guardrails that encode
     permanent invariants (AST immutability, provenance, Zod boundaries,
     process split, no attribution) survive every rewrite.
   - Preserve THIS §0 verbatim.
   - The rewritten file must be fully self-contained: the next session starts
     with zero context beyond this repository.
4. **Ship.** One feature branch, one PR to `master`, plain engineering prose,
   no AI attribution or generated-by trailers anywhere (commits, PR bodies,
   code comments).

A session that completes its objective but does not regenerate this file has
not finished.

---

## 1. Architectural mental model

Trellis's core invariant is that every semantic fact remains traceable to an
immutable, content-addressed physical location in source material.

1. **PostgreSQL + pgvector — physical layer**
   - `ast_nodes` stores immutable Merkle AST nodes and optional embeddings.
   - `documents` stores stable document keys and version history;
     `document_nodes` stores per-root membership and supports global source
     liveness checks.
   - `repository_snapshots`/`repository_snapshot_paths` (Session 8) record
     which paths each published repository snapshot contained; only published
     snapshots are the deletion baseline.
   - The verified ingest transaction lives in `src/core/ingestion/`
     (`ingest_document.ts`: persist → read-back re-hash verification →
     membership → registration → in-transaction Merkle diff;
     `plan_ingest.ts`: explicit `none`/`changed` extraction policy with a
     hard block budget rejected before any queue write). `POST /ingest` in
     `src/api/server.ts` is a thin parse/validate/delegate layer; tombstones
     are ordinary ingests of a deterministic empty root.
   - Schema bootstrap is serialized by `pg_advisory_xact_lock`; Neo4j
     bootstrap uses `executeWrite` (constraint + `entity_name_index`) so
     concurrent fresh-graph starts retry transient label-lock deadlocks.
2. **Neo4j — semantic and belief layer**
   - `Entity` and `Conflict` nodes plus `ACTION`, `CONTRADICTS`,
     `DERIVED_INSIGHT`, `SAME_AS`/`DISTINCT_FROM`, and conflict-link edges.
   - Semantic nodes and edges carry `sourceNodeIds`. `contested`,
     `contestedAt`, `orphanedSourceIds`, and `rederivedAt` form the
     audit-preserving quarantine/recovery state machine specified in
     `src/core/graph/provenance.ts`.
   - Entity identity is immutable; equivalence is an overlay belief.
     Retrieval expands one trusted `SAME_AS` hop with per-fact `viaAlias`
     attribution. Entity merges seek `entity_name_index` (Session 8) — merge
     latency no longer grows with graph size.
3. **Redis + BullMQ — asynchronous layer**
   - `extraction_queue`, `rlm_queue`, `supervisor_queue`,
     `invalidation_queue`, `verification_queue`, `resolution_queue`.
   - Extraction is one paid chat completion plus one paid embedding call per
     new block. Repository ingestion therefore defaults to `--extract none`;
     `changed` requires an explicit budget plus confirmation.
4. **Code-aware physical parsing (Session 8)**
   - `src/core/ast/source_parser.ts` dispatches by an explicit extension
     table: TS/JS via `@babel/parser`, Python via the stdlib `ast` module
     (`scripts/parse_python_source.py`, Zod-validated), Markdown on the
     pinned T13 preimage, opaque-text fallback for config formats. Blocks are
     top-level functions, classes with per-method child blocks, and bounded
     chunks; content is the exact source slice, byte-coverage enforced, and
     nothing positional is persisted.
   - `src/core/repository/` owns path safety, `git ls-files -z` enumeration,
     manifest diffs, and the snapshot pipeline (bounded concurrency and bytes
     in flight; publish-after-success atomicity). CLI:
     `npm run repo:ingest` (`scripts/ingest_repository.ts`); live drill:
     `npm run test:repo-ingest`.
5. **Frontend (the Session 9 subject)**
   - `src/frontend/` is a Next.js 16 app (React 19, `react-force-graph-2d`)
     with a force-directed graph pane and a provenance pane
     (`src/components/SplitPaneViewer.tsx`, `GraphPane.tsx`,
     `ProvenancePane.tsx`).
   - It has its own `package.json`/lockfile and dev server on port 3001.
     `next.config.ts` rewrites `/api/:path*` to `http://localhost:3000/:path*`.
   - `src/frontend/AGENTS.md` warns that this Next.js version differs from
     training data: read `node_modules/next/dist/docs/` before writing
     frontend code, and heed deprecation notices.
6. **Observability and process boundaries**
   - `src/core/observability/` defines pino JSON logging and per-process
     Prometheus registries; API and workers run as separate processes/
     containers. Stable dot-namespaced events; bounded metric labels only —
     paths, repo keys, hashes, and entity names never become label values.
   - Benchmark and maintenance CLIs keep human-formatted console output.

The RLM sandbox uses server-enforced read-only sessions for arbitrary Cypher
and one provenance-required write path. Verification and resolution workers
use Zod-validated structured outputs; zero-cost drills replace the sub-LLM
with deterministic oracles. OOLONG v1 is the saturated committed baseline;
anti-shortcut v2 lives at `data/oolong_pairs_dataset_hard.json`. Scale
evidence: `docs/benchmarks/SCALE_PROVENANCE_REPORT.md` and
`docs/benchmarks/REPOSITORY_INGESTION_REPORT.md`.

## 2. Current baseline

Repository state at handoff creation:

- `master`: `b30004b` (PR #29) plus the Session 8 PR that ships this file;
  use `git log -- HANDOFF.md` to identify the merged Session 8 commit.
- Offline baseline: `npm test` = 345 passing across 44 files.
- `npm run build` and `npm run python:check` pass.
- `npm run drill:scale`: gate CLOSED at max provenance 286; whole-document
  merge p50 13.77/13.24/14.82 ms at 50/150/300 documents with
  `entity_name_index`.
- Live zero-LLM checks: `test:repo-ingest` (45), `test:benchmark-hardening`
  (24), `test:entity-resolution` (33), `test:api-hardening` (18),
  `test:rlm-sandbox` (4), `test:belief-recovery` (30),
  `test:invalidation-sweep` (17).
- Isolated Compose integration: 9 assertions (project
  `trellis-s8-integration` was the last run).
- CI target is Node 22. Session 8's local measurement environment was
  Node 20.19.2, PostgreSQL 16.14, Neo4j 5.11.0, Python 3.13.

Fresh worktrees do not contain `node_modules`. Start with:

```
 git status --short --branch
 git branch --show-current
 npm ci
 npm test
 npm run build
 docker compose config --quiet
 (cd src/frontend && npm ci && npm run build)   # establish the frontend baseline too
```

Work on a feature branch and target `master`.

## 3. Session 9 problem statement

The backend is containerized, health-gated, and CI-covered; the frontend is a
dev-only artifact that cannot run against a protected backend.

- **The proxy is hardcoded and unauthenticated.**
  `src/frontend/next.config.ts` rewrites `/api/:path*` to
  `http://localhost:3000/:path*` with no environment override. Since T6,
  every operational endpoint requires `API_KEY` when set; the rewrite
  forwards no key, so `SplitPaneViewer.tsx`'s `fetch('/api/retrieve?...')`
  receives `401` against any protected deployment. Putting the key in
  client-side code or `NEXT_PUBLIC_*` would publish it to every browser —
  the key must be injected server-side only.
- **No production build or container.** The root `Dockerfile` deliberately
  excludes the frontend; there is no frontend image, no Compose service, no
  health check, and no non-root/production `next start` path. The root
  `.dockerignore`/build context and the frontend's own lockfile have never
  been reconciled.
- **No CI coverage.** `.github/workflows/ci.yml` never installs, lints, or
  builds `src/frontend`; a frontend-breaking change merges green today.
- **SSE and streaming semantics are unverified through a proxy.**
  `/api/rlm-stream` is an EventSource endpoint; whatever proxy path Session 9
  chooses must not buffer SSE (and must pass the key without exposing it —
  the backend accepts `api_key` as a query parameter precisely because
  EventSource cannot set headers, but that parameter must not carry the real
  key in browser-visible URLs).
- **Community-readiness gaps.** The frontend README is the create-next-app
  stub; the root README's frontend story is one sentence; there is no
  documented end-to-end quickstart (backend stack + frontend against it).
- **Version caution.** `src/frontend/AGENTS.md`: this Next.js (16.2.9) has
  breaking changes relative to training data. Read
  `node_modules/next/dist/docs/` for rewrites/route-handler/proxy semantics
  before writing code, and verify behavior against the real dev server, not
  memory.

## 4. Required design

Present the exact design after inspecting §5, then implement it. Deviations
require a concrete reason and equivalent tests.

### 4.1 Authenticated server-side proxy

- Replace the static rewrite with a server-side proxy that injects the API
  key: either Next route handlers under `src/frontend/src/app/api/[...path]/`
  or the rewrites function reading env — but the key must live only in the
  Next server process (`TRELLIS_API_BASE_URL`, `TRELLIS_API_KEY` env vars,
  no `NEXT_PUBLIC_` prefix). The browser keeps calling relative `/api/...`
  paths and never sees the key.
- Restrict the proxy to the endpoints the UI uses (`/retrieve`, and
  `/api/rlm-stream` if the UI streams); do not blanket-forward `/ingest` or
  `/metrics` through an unauthenticated browser surface without an explicit
  decision recorded in the roadmap entry.
- SSE must stream through unbuffered. Verify with a real EventSource against
  the protected backend.
- A missing backend or bad key must surface as a readable UI/HTTP error, not
  a hung fetch.

### 4.2 Production build and container

- Frontend production must run via `next build` + `next start` (or the
  standalone output mode if the Next 16 docs recommend it), as a non-root
  user, with its own Dockerfile (multi-stage, lockfile-driven `npm ci`) —
  do not graft the frontend into the backend image; keep the process split.
- Add a Compose service (`frontend`) joining the existing network,
  configured entirely by environment (`TRELLIS_API_BASE_URL=http://backend:3000`,
  key from `.env`), with a container health check and an overridable host
  port. Backend services, volumes, and the isolated-test profile must be
  untouched for existing users; the frontend service must not become a
  dependency of the `test` profile's integration run unless the round trip
  asserts something through it.
- `.env.example` and README document the new variables; Compose interpolation
  and bare-host `npm run dev` (port 3001, dev proxy) both keep working.

### 4.3 CI and community readiness

- Extend `.github/workflows/ci.yml` with a frontend job: `npm ci`,
  `npm run lint`, `npm run build` in `src/frontend` (Node 22, npm cache
  keyed on the frontend lockfile). If an image build is added to CI, keep it
  cached and non-publishing like the backend's.
- Replace the create-next-app stub README with the real frontend story
  (what the panes show, dev vs production, env contract) and give the root
  README an end-to-end quickstart: stack up → db init → ingest a sample →
  open the frontend → click a node → see provenance.
- Keep `src/frontend/AGENTS.md` intact and follow it.

### 4.4 Cost policy

Everything required for acceptance is zero-LLM. The UI round trip uses
directly seeded provenance-bearing facts (the Compose integration already
seeds one) or `--extract none` repository ingests. No paid extraction, no
benchmark runs.

## 5. File-level starting points

Inspect before editing:

- `TRELLIS_ROADMAP.md` §3.3 #5, §4, and the Session 8 §5 entry.
- `.agents/AGENT_CODING_GUIDELINES.md` and `src/frontend/AGENTS.md` (and the
  Next docs under `src/frontend/node_modules/next/dist/docs/` after
  `npm ci`).
- `src/frontend/next.config.ts`, `package.json`, `src/app/page.tsx`,
  `src/components/SplitPaneViewer.tsx` (the `/api/retrieve` fetch),
  `GraphPane.tsx`, `ProvenancePane.tsx`.
- `src/api/server.ts` (`apiKeyMiddleware` acceptance forms: `x-api-key`,
  Bearer, `api_key` query param; SSE endpoint semantics; fixed route-label
  table if any proxy-visible route changes).
- `Dockerfile`, `docker-compose.yml`, `.env.example`,
  `.github/workflows/ci.yml`, `scripts/test_compose_roundtrip.ts`.
- `scripts/test_api_hardening.ts` for the live-test house style around
  starting the API with a key.

Prefer small pure helpers for anything unit-testable (env parsing, proxy
target construction, error mapping).

## 6. Test strategy and acceptance

Test first. No paid LLM calls are permitted for Session 9 acceptance.

Offline (must not require Docker or a running backend):

- root `npm test` stays green; any new root-side helpers get vitest
  coverage;
- frontend `npm run lint` and `npm run build` pass with the production
  proxy configuration present;
- a grep/assertion that the built client bundles contain neither the API
  key variable name's value path nor any `NEXT_PUBLIC_` leak of it (pin the
  mechanism, e.g. a script that builds with a sentinel key and greps
  `.next/static` for the sentinel).

Live zero-LLM coverage:

- start the protected backend (real `API_KEY`) plus the frontend against it;
  prove the browser-path round trip: seed one provenance-bearing fact
  directly (as `test_compose_roundtrip.ts` does), fetch through the frontend
  proxy (`/api/retrieve`), and assert the graph and provenance payload
  arrive without the key appearing in any response, HTML, or client asset;
- prove an unauthenticated direct backend call still gets `401` (the proxy
  did not widen access) and a wrong-key frontend surfaces a readable error;
- if the UI streams RLM output, prove SSE passes through the proxy
  unbuffered using a zero-cost path (the queue-full `429`/error event is
  acceptable evidence — do not spend tokens);
- the frontend container runs as non-root, reports healthy, and serves the
  app on the Compose network; existing isolated Compose integration (9
  assertions) still passes untouched;
- all existing live suites stay green: `test:repo-ingest`,
  `test:benchmark-hardening`, `test:entity-resolution`,
  `test:api-hardening`, `test:rlm-sandbox`, `test:belief-recovery`,
  `test:invalidation-sweep`.

Required close-out:

```
 npm test
 npm run build
 npm run python:check
 (cd src/frontend && npm ci && npm run lint && npm run build)
 docker compose --profile test config --quiet
 # Run the isolated zero-LLM Compose integration.
 # Run the new frontend round-trip check.
 npm run drill:scale
 npm run test:repo-ingest
 npm run test:benchmark-hardening
 npm run test:entity-resolution
 npm run test:api-hardening
 npm run test:rlm-sandbox
 npm run test:belief-recovery
 npm run test:invalidation-sweep
 git diff --check
```

Update:

- README (end-to-end quickstart, frontend env contract) and
  `src/frontend/README.md` (real content); `.env.example`.
- `TRELLIS_ROADMAP.md`: strike the 3.3 #5 remainder only after acceptance;
  add a full-dated §5 entry with exact commands/counts and any defects found.
- `HANDOFF.md`: regenerate for the next objective per §0. After 3.3 #5, the
  first remaining unstruck sequencing row is the conditional 3.3 #4
  migration, which stays blocked until its trigger crosses — pick the next
  actionable objective (for example a repository-scale semantic pilot with
  owner-approved bounded extraction, or T13's canonical-preimage migration
  design) and record the reasoning in the roadmap.

## 7. Guardrails

1. Never mutate an AST. The T13 hash preimage is pinned; `rederiveAstNodeId`
   stays authoritative; nothing positional is ever persisted as identity.
2. Never merge, rename, or delete Entity nodes. Equivalence stays an overlay
   belief; semantic identity and `SAME_AS` behavior stay pinned.
3. Preserve provenance on every semantic node and edge. Tombstones and
   sweeps quarantine; they never delete belief history. The provenance state
   machine, fresh-survival race, global-liveness reduction, and commuting
   transitions remain unchanged.
4. Validate every external input at a Zod/equivalent boundary. All LLM calls
   remain inside BullMQ workers or the RLM process.
5. The API key must never reach a browser: no `NEXT_PUBLIC_` key variables,
   no key in client bundles, HTML, or browser-visible URLs. The proxy widens
   nothing — endpoints the UI does not need are not forwarded.
6. Default to zero paid work. No paid calls are acceptance checks; real
   extraction requires an explicit budget, confirmation, owner approval, and
   a cost estimate.
7. Keep processes split: API, workers, and frontend are separate processes/
   containers. Do not graft the frontend into the backend image, weaken T6
   request limits, or alter the backend Compose topology for existing users.
8. Follow the T16 observability house style. Paths, repo keys, AST hashes,
   entity names, and API keys never become metric label values or log
   payloads.
9. Use project-scoped Compose commands; never remove another stack's
   volumes. Fixtures and drills clean up only token-scoped or
   pre-snapshotted state.
10. Ship one feature branch and one PR to `master`, plain engineering prose,
    with no AI attribution or generated-by trailers. Regenerate this file in
    the same PR.
11. Heed `src/frontend/AGENTS.md`: verify Next.js 16 behavior against its
    shipped docs and a running dev server, not training-data memory.

## 8. Explicit exclusions

Do not include: visual redesign or new UI features beyond what deployment
requires; exposing `/ingest`, `/metrics`, or admin surfaces to the browser;
per-user auth/sessions/multi-tenancy (single shared key stays); TLS
termination and domain/CDN setup; Kubernetes or cloud deployment; paid LLM
calls of any kind; `ASTRef`/`EVIDENCED_BY` migration (gate closed at 286);
T13 re-hashing; new languages for the code parser; benchmark corpus v3 or
paid OOLONG runs; RLM prompt/agent protocol changes; external observability
vendors.
