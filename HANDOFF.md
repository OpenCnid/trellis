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
- PRs #30/#31 — whole-codebase ingestion (Session 8): the verified ingest
  service extracted from `POST /ingest`, code-aware TypeScript/JavaScript/
  Python ASTs, durable repository snapshots with tombstone deletion/rename
  semantics, the `repo:ingest` CLI with a zero-paid-work default, the
  measured `Entity.name` merge index, and the owner-approved 112-block
  extraction pilot whose findings (test-fixture contamination,
  generic-identifier hubs, business-tuned prompt mismatch) are recorded as
  repository-extraction prerequisites.

OpenCnid selected the MIT License on July 6, 2026.

Your objective is to study the current code and `TRELLIS_ROADMAP.md`, present a
concrete design, and then implement **Session 9: the agentic orchestration
loop (roadmap item 3.3 #7, owner-directed July 6, 2026)**. Trellis must be
able to work agentically: an external loop, mediated by the same LLM under a
different system prompt, that decomposes a goal into tasks and drives the RLM
as a reusable single-task sub-agent so one goal can perform more than one
task. Do not re-plan or re-implement completed work.

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
     hard block budget). `POST /ingest` is a thin delegate; tombstones are
     ordinary ingests of a deterministic empty root.
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
     attribution. Entity merges seek `entity_name_index` (Session 8).
3. **Redis + BullMQ — asynchronous layer**
   - `extraction_queue`, `rlm_queue`, `supervisor_queue`,
     `invalidation_queue`, `verification_queue`, `resolution_queue`.
   - All LLM calls live inside BullMQ workers or the RLM process; every
     worker-consumed completion crosses `parseLlmResponse`
     (`src/core/llm/boundary.ts`) with typed empty/json/schema failures.
4. **RLM execution plumbing (the Session 9 subject)**
   - `GET /api/rlm-stream` (API-key gated, `StreamGate` concurrency cap +
     queue-depth backstop) subscribes to Redis channel `rlm-stream:<jobId>`,
     then enqueues one `rlm_queue` job `{query, jobId}`.
   - `src/workers/rlm_worker.ts` spawns one Python process per job:
     `trellis_agent.py --query <query>` with config forwarded via env. Every
     stdout chunk is published to the channel as `{type:'stdout'}` and fed
     to the pure `RlmTelemetryScanner`; exit publishes `{type:'done', code}`.
   - `src/rlm/trellis_agent.py` wraps the `rlms` recursive-LM library
     (model `gpt-5.4-2026-03-05`, `max_iterations` default 5) with two
     injected tools (read-only Cypher + AST reader; the single write path is
     `write_derived_insight`). Its stdout contract is machine-parseable:
     a `FINAL_ANSWER: ` line, one `TRELLIS_TELEMETRY: {json}` line, and a
     `TRELLIS_PROTOCOL_VIOLATION` line when zero database tool calls were
     made (an answer with no provenance).
   - CRITICAL rlms constraint: `custom_system_prompt` REPLACES the base
     REPL protocol prompt. Trellis therefore EXTENDS `RLM_SYSTEM_PROMPT`
     (see the `TRELLIS_ADDENDUM` comment), and rlms runs `.format()` over
     the prompt so literal curly braces are forbidden (escape by doubling).
   - Prior art for driving the RLM programmatically:
     `src/benchmarks/oolong/rlm_client.ts` consumes the SSE stream, extracts
     `FINAL_ANSWER`, detects protocol violations, and re-dispatches — the
     benchmark runner (`oolong_runner.ts`) is effectively a hard-coded,
     single-task orchestrator already.
5. **Observability and process boundaries**
   - `src/core/observability/` defines pino JSON logging and per-process
     Prometheus registries; API and workers are separate processes/
     containers. Stable dot-namespaced events; bounded metric labels only —
     queries, goals, paths, hashes, and entity names never become label
     values.
6. **Other subsystems (stable, not this session's subject)**
   - Whole-codebase ingestion: `src/core/repository/`, `npm run repo:ingest`,
     live drill `npm run test:repo-ingest`.
   - Benchmarks: OOLONG v1 saturated baseline; anti-shortcut v2 at
     `data/oolong_pairs_dataset_hard.json`; scale evidence in
     `docs/benchmarks/SCALE_PROVENANCE_REPORT.md` and
     `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md`.
   - Frontend: Next.js 16 app in `src/frontend/` with a dev-only proxy —
     deployment deferred to the next sequencing row.

## 2. Current baseline

Repository state at handoff creation:

- `master`: `c497129` (PR #31) plus the Session 9 redirect docs PR that
  ships this file; use `git log -- HANDOFF.md` to identify it.
- Offline baseline: `npm test` = 345 passing across 44 files.
- `npm run build` and `npm run python:check` pass.
- `npm run drill:scale`: gate CLOSED at max provenance 286; whole-document
  merge p50 13.77/13.24/14.82 ms at 50/150/300 documents with
  `entity_name_index`.
- Live zero-LLM checks: `test:repo-ingest` (45), `test:benchmark-hardening`
  (24), `test:entity-resolution` (33), `test:api-hardening` (18),
  `test:rlm-sandbox` (4), `test:belief-recovery` (30),
  `test:invalidation-sweep` (17).
- Isolated Compose integration: 9 assertions.
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
```

Work on a feature branch and target `master`.

## 3. Session 9 problem statement

Trellis can answer one question; it cannot pursue a goal.

- **One process, one task, one stream.** `rlm_worker.ts` spawns
  `trellis_agent.py --query <query>` exactly once per `rlm_queue` job, and
  `GET /api/rlm-stream` binds one SSE client to one job. There is no
  component that can take a goal ("audit every contested fact and re-derive
  the recoverable ones", "answer these five questions and reconcile the
  contradictions"), split it into tasks, run them, and decide what to do
  next based on the results.
- **The only multi-step driver is hard-coded.** `oolong_runner.ts` +
  `rlm_client.ts` already loop over queries, parse `FINAL_ANSWER` from the
  SSE stream, detect `TRELLIS_PROTOCOL_VIOLATION`, and re-dispatch — but the
  task list is a fixed benchmark sequence compiled into the runner. The
  decomposition intelligence the owner asked for (same LLM, different
  system prompt) does not exist anywhere.
- **The RLM is almost, but not quite, a reusable agent.** Its stdout
  contract (`FINAL_ANSWER: `, `TRELLIS_TELEMETRY: {json}`,
  `TRELLIS_PROTOCOL_VIOLATION`) is machine-parseable, and process-per-task
  isolation, telemetry, and the sandbox already work. What is missing is a
  formal task envelope: today the result is scraped from a prose stream by
  prefix, `rlm_worker.ts` resolves with a placeholder string rather than
  the answer, and nothing correlates N task jobs to one goal.
- **A second REPL is a trap, not a shortcut.** The obvious "give the
  orchestrator the same RLM harness" fails two ways: rlms
  `custom_system_prompt` replaces the REPL protocol prompt (see
  `trellis_agent.py`'s comment and the pinned addendum pattern), and an
  orchestrator does not need a Python REPL — it needs structured decisions.
  The T8 boundary (`parseLlmResponse` + Zod) is the correct instrument, and
  it already runs inside workers.
- **No budget model exists above one run.** `max_iterations` bounds one RLM
  run; `StreamGate` bounds concurrent SSE clients. Nothing bounds an
  agentic loop that could dispatch tasks indefinitely — per-goal iteration,
  task, and token ceilings must exist before the first real goal runs.

Session 9 must add the external loop without weakening any invariant: the
orchestrator decides, the RLM executes, provenance rules and the single
graph-write path stay exactly as they are.

## 4. Required design

Present the exact design after inspecting §5, then implement it. Deviations
require a concrete reason and equivalent tests.

### 4.1 The RLM as a formal single-task sub-agent

- Keep one Python process per task and the existing sandbox/telemetry
  untouched. Add an explicit machine-readable result envelope to
  `trellis_agent.py` — e.g. one `TRELLIS_RESULT: {json}` line carrying
  `{status, answer, toolCalls}` — alongside the existing `FINAL_ANSWER:`
  convention (which the benchmark client still consumes; do not break it).
- Extend the `rlm_queue` job payload with optional task correlation
  (`goalId`, `taskId`, and a per-task `maxIterations` override) following
  the `IngestJobContext` pattern: old payloads still process. The worker's
  completion value should carry the parsed result envelope instead of the
  current placeholder string, and a pure scanner (sibling of
  `RlmTelemetryScanner`) should extract the result line from the same
  chunk stream the SSE path publishes.

### 4.2 The orchestrator — same LLM, different system prompt

- New module `src/core/agent/` with the decision boundary as pure code:
  an orchestrator system prompt (a planner/mediator persona — NOT the
  rlms REPL prompt and never routed through rlms), and a Zod
  `OrchestratorDecisionSchema` along the lines of
  `{ assessment: string, action: 'dispatch' | 'finish' | 'fail',
  tasks?: [{ taskId, query }], finalAnswer?: string, reason?: string }`,
  validated via `parseLlmResponse` with structured outputs
  (`zodResponseFormat`), exactly like extraction/verification/resolution.
- The model is the same LLM the rest of Trellis uses
  (`config.llm.extractionModel`, currently the same `gpt-5.4-2026-03-05`
  string the RLM backend pins) — the difference is the system prompt, per
  the owner's direction.
- The loop (dependency-injected and unit-testable): goal → decision →
  dispatch tasks as `rlm_queue` jobs → await result envelopes → append
  observations (answers, protocol violations, failures, spend) to the
  transcript → next decision → until `finish`/`fail` or a bound trips.
  Task failures and protocol violations are observations for the next
  decision, not loop crashes.
- Execution home: a new `agent_queue` + `agent_worker.ts` (standard
  retrying options are WRONG here — an interrupted goal must not silently
  re-run paid work; follow the `rlm_queue` interactive precedent), so all
  LLM calls stay in worker processes. API surface: `GET /api/agent-stream`
  gated by the API key and admission control (reuse/extend `StreamGate`),
  streaming goal-level SSE events (`goal_started`, `decision`,
  `task_started`, `task_result`, `goal_completed`/`goal_failed`) on a
  `agent-stream:<goalId>` channel that multiplexes per-task activity.

### 4.3 Bounds and cost

- New Zod-validated config: max orchestrator iterations per goal, max
  tasks per goal, max concurrent tasks per goal, and a per-goal sub-agent
  iteration ceiling. Defaults must be small (single digits); a goal that
  trips a bound ends as a typed, streamed failure — never an unbounded
  loop. `max_depth` stays 1 in rlms; the orchestrator is the only outer
  loop and must not be able to dispatch goals to itself.
- Acceptance is zero-LLM (§6). Any real goal run is owner-approved, needs
  `OPENAI_API_KEY`, and should be preceded by the printed per-goal bounds;
  record the observed spend from `TRELLIS_TELEMETRY` aggregation.

### 4.4 Observability

- T16 house style: worker `agent`, queue `agent_queue`; events
  `agent.goal_started` / `agent.decision` / `agent.task_dispatched` /
  `agent.task_completed` / `agent.goal_completed` / `agent.goal_failed`;
  metrics like `trellis_agent_goals_total{outcome}`,
  `trellis_agent_decisions_total{action}`,
  `trellis_agent_tasks_total{outcome}`, plus LLM spend under
  `operation: 'orchestration'`. Goal text and task queries appear in no
  metric label and no log line (same rule as SSE queries today). Add the
  new queue to the gauge list and shutdown coordinator.

## 5. File-level starting points

Inspect before editing:

- `TRELLIS_ROADMAP.md` §3.3 #7, §4, and the Session 8/pilot/redirect §5
  entries; `.agents/AGENT_CODING_GUIDELINES.md`.
- `src/workers/rlm_worker.ts` (spawn/publish/telemetry/exit paths) and
  `src/core/observability/rlm_telemetry.ts` (the bounded line-scanner
  pattern to mirror for the result envelope).
- `src/rlm/trellis_agent.py` (prompt-extension constraint, brace escaping,
  FINAL_ANSWER/telemetry/violation lines) and `src/rlm/trellis_tools.py`
  (tool-call counting, the single write path).
- `src/benchmarks/oolong/rlm_client.ts` and `src/benchmarks/oolong_runner.ts`
  (existing FINAL_ANSWER extraction, violation detection, re-dispatch — the
  hard-coded loop this session generalizes).
- `src/api/server.ts` (`/api/rlm-stream` SSE + subscribe-then-enqueue
  ordering, `StreamGate`), `src/api/stream_gate.ts`.
- `src/workers/queue.ts`, `job_options.ts` (interactive vs retrying
  defaults), `start_workers.ts`, `scripts/start_all.ts`, and
  `src/core/observability/queue_gauges.ts` for wiring a new queue.
- `src/core/llm/boundary.ts` and `src/core/graph/schemas.ts` (the T8
  pattern for the decision schema), `src/config/index.ts` for new bounds.
- `scripts/test_e2e_rlm.ts`, `test_repl_error_routing.ts`, and
  `test_api_hardening.ts` for live-test house style around the RLM and API.

Prefer pure helpers for the decision schema, transcript construction,
bound accounting, result-envelope scanning, and SSE event shaping.

## 6. Test strategy and acceptance

Test first. No paid LLM calls are permitted for Session 9 acceptance.

Offline tests must cover:

- `OrchestratorDecisionSchema` through all three `parseLlmResponse` failure
  stages; rejection of hallucinated actions/missing fields;
- the loop against an injected fake decision source and fake task runner:
  multi-iteration goal completion, task fan-out and result aggregation,
  protocol violations and task failures becoming observations, and every
  bound (iterations, tasks, concurrent tasks) tripping into a typed
  failure with no further dispatches;
- the result-envelope scanner: chunk boundaries, malformed JSON, missing
  envelope, oversized lines (mirror `rlm_telemetry.test.ts`);
- job-payload correlation (goalId/taskId threading, backward-compatible
  optional fields — pin that a pre-Session-9 `{query, jobId}` payload
  still processes);
- orchestrator prompt hygiene: the prompt is not routed through rlms and
  contains whatever brace/format constraints apply where it IS used;
- config validation for the new bounds and metric label pins for the new
  counters; queue-gauge exposition for `agent_queue`.

Live zero-LLM coverage against the local stack:

- a deterministic oracle decision source (the `makeOracleClassifier`/
  `makeOracleAdjudicator` precedent) plus a stub task agent with the real
  `agent_queue`/`rlm_queue`/Redis pub-sub plumbing: one goal decomposes
  into at least two tasks, both round-trip through real queues and
  channels, results aggregate, and the goal-level SSE stream shows the
  full event lifecycle through the real API endpoint;
- admission control: 401 without a key, 429 over the concurrency cap
  (the `test:api-hardening` pattern);
- a bound-tripping goal ends as a streamed typed failure with zero
  further task dispatches;
- a task-level protocol violation surfaces as an observation and the
  oracle plan reacts to it;
- all existing live suites stay green: `test:repo-ingest`,
  `test:benchmark-hardening`, `test:entity-resolution`,
  `test:api-hardening`, `test:rlm-sandbox`, `test:belief-recovery`,
  `test:invalidation-sweep`; `drill:scale` still closes its gate.

Required close-out:

```
 npm test
 npm run build
 npm run python:check
 docker compose --profile test config --quiet
 # Run the isolated zero-LLM Compose integration.
 # Run the new zero-LLM agent-loop live suite.
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

- README and `API_REFERENCE.md` with the agent endpoint, event contract,
  bounds, and cost controls; the runbook with the new queue/metrics.
- `TRELLIS_ROADMAP.md`: strike 3.3 #7 only after acceptance; add a
  full-dated §5 entry with exact commands/counts and any defects found.
- `HANDOFF.md`: regenerate for the next objective per §0 — the first
  remaining unstruck sequencing row is the frontend deployment remainder
  (3.3 #5 residue), unless something discovered this session should jump
  the queue.

## 7. Guardrails

1. Never mutate an AST. The T13 hash preimage is pinned; `rederiveAstNodeId`
   stays authoritative; nothing positional is ever persisted as identity.
2. Never merge, rename, or delete Entity nodes. Equivalence stays an overlay
   belief; semantic identity and `SAME_AS` behavior stay pinned.
3. Preserve provenance on every semantic node and edge. The orchestrator
   NEVER writes to the graph; `write_derived_insight` (provenance-required)
   remains the single agent write path, and the RLM sandbox's read-only
   session enforcement is untouched.
4. Validate every LLM response at the `parseLlmResponse`/Zod boundary. All
   LLM calls remain inside BullMQ workers or the RLM process — the API
   process never calls a model.
5. Every agentic loop is hard-bounded: per-goal iteration/task/concurrency
   ceilings from validated config, `max_depth` 1 in rlms, and no path by
   which the orchestrator dispatches goals to itself or spawns a second
   orchestrator.
6. Default to zero paid work. Acceptance is zero-LLM (oracle decisions,
   stub tasks); a real goal run requires owner approval and recorded
   telemetry-based spend.
7. Do not break existing consumers of the RLM stream: `FINAL_ANSWER:`
   extraction in the benchmark client, `TRELLIS_TELEMETRY` parsing, SSE
   payload shapes, and pre-Session-9 `rlm_queue` payloads all keep working.
8. Respect the rlms prompt contract: extend `RLM_SYSTEM_PROMPT`, never
   replace it; no literal curly braces in anything rlms formats; the
   orchestrator persona is plain chat completions, not an rlms REPL.
9. Follow the T16 observability house style. Goal text, task queries,
   paths, hashes, and entity names never become metric label values.
10. Keep API and worker processes split; use project-scoped Compose
    commands; never remove another stack's volumes; fixtures and drills
    clean up only token-scoped or pre-snapshotted state.
11. Ship one feature branch and one PR to `master`, plain engineering
    prose, with no AI attribution or generated-by trailers. Regenerate this
    file in the same PR.

## 8. Explicit exclusions

Do not include: frontend work (deferred to the next sequencing row);
multi-orchestrator hierarchies, agent swarms, or recursive goal dispatch;
long-lived RLM daemon processes or session reuse across tasks (one process
per task stays); autonomous/scheduled goal triggers (goals start from an
authenticated request only); new RLM sandbox tools or write paths; rlms
library modifications; paid LLM calls as acceptance checks; benchmark
corpus v3 or paid OOLONG runs; the repository-extraction prerequisites
(scanner test/fixture exclusion, code-tuned extraction prompt — next after
frontend); `ASTRef`/`EVIDENCED_BY` migration (gate closed at 286); T13
re-hashing; Kubernetes/cloud deployment; external observability vendors.
