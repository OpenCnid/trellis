# Hardening the Trellis: A Prioritized Improvement Roadmap for OpenCnid's Recursive Language Model Runtime

## Abstract

Trellis is a working, unusually well-documented Recursive Language Model (RLM) runtime: a language model operating a persistent Python REPL over a provenance-enforced knowledge substrate (PostgreSQL Merkle ASTs, Neo4j belief graph, Redis/BullMQ orchestration). Its engineering discipline — byte-pinned prompts, zero-paid drills, quarantine-over-delete invalidation — is real and largely load-bearing. But the repository as it stands is a single-owner research vehicle, not an adoptable platform. This paper is a concrete, prioritized roadmap for a research lab that wants to run Trellis seriously. We verified each defect against the code and organize the findings in three tiers. Tier 1 (before any serious adoption): the OpenAI lock-in is total despite a designed-but-unwired backend seam (`config.rlmBackend` is validated and then read by no consumer; `gpt-5.4-2026-03-05` is hardcoded at three call sites in `trellis_agent.py` alone); embeddings are a hardcoded model name over a schema-pinned 1536-dim column with no versioning; the REPL process holds full-write database credentials, making the celebrated single-write-path a client-side convention rather than a boundary; telemetry rests on monkeypatched private internals of `rlms==0.1.3` and a scraped stdout banner. Tier 2 (before research conclusions): nearly every paid measurement is n=1 or n=2 on synthetic, self-graded corpora — we propose a ~$150 measurement campaign priced from the project's own telemetry ($0.09–$0.87 per run) that would convert directional findings into defensible ones. Tier 3 (long-term health): decomposing the 560-line API monolith and side-effectful config module, retiring the single-owner process encoded in a 2,827-line self-regenerating HANDOFF.md (which still hardcodes the owner's `D:\` paths), an HA/backup/disk-growth story beyond single-machine Compose, deeper CI, and managing the twin Python/TypeScript validator stack. We close with what we would explicitly *not* change: the comment density, the byte-pinning ceremony, the zero-paid drill culture, and the transport-level Cypher sandbox — features that look eccentric and are in fact the reason the system can be trusted at all.

---

## 1. Scope and method

Everything below was verified against the repository at `/home/user/trellis` (50 commits, effectively one author, sessions dated July 4–14, 2026). Each item states the defect, evidence (file:line), the risk it carries, a concrete fix, and rough effort — **S** (hours–a day), **M** (days–a week), **L** (multi-week). Costs for paid work use the project's own per-run telemetry.

A framing note: this is not a list of complaints. Trellis's own documentation is candid about most of these gaps (`docs/benchmarks/CRITIQUE_AND_FUTURE.md` is a model of honest self-critique). The problem is prioritization for an *adopter*: which gaps are safe to live with, and which will silently corrupt your results or your security posture on day one.

---

## 2. Tier 1 — Before any serious adoption

### T1.1 — Wire the model-backend seam; kill the OpenAI lock-in — **Effort: L**

**Defect.** Trellis is hardwired to OpenAI at every layer, while shipping a designed, validated, *dead* configuration seam for alternatives.

**Evidence.**
- `src/config/index.ts:109` — `EXTRACTION_MODEL: z.string().default('gpt-5.4-2026-03-05')`; consumed by six workers/factories (`extraction_worker.ts:77`, `resolution_worker.ts:65`, `supervisor_worker.ts:76`, `verification_worker.ts:79`, plus the decision/adjudicator/entailment factories in `src/core/`), all through `new OpenAI()` clients (nine instantiation sites across `src/`).
- `src/config/index.ts:134–147` — `TRELLIS_RLM_BACKEND` / `TRELLIS_RLM_MODEL` / `TRELLIS_RLM_BASE_URL` / `TRELLIS_RLM_API_KEY_ENV` are schema-validated with cross-field fail-fast checks (`index.ts:279–289`), and each carries the same comment: *"No consumer reads these values yet; T2/T3 wire them."* `buildAgentEnv` (`src/workers/rlm_job.ts:165–239`) forwards Neo4j, Postgres, MCP, workspace, textedit, and budget config to the spawned agent — and none of the `TRELLIS_RLM_*` values.
- `src/rlm/trellis_agent.py:353` and `:589` — `backend_kwargs={"model_name": "gpt-5.4-2026-03-05"}` hardcoded in both author and research modes; `:111` hardcodes the same model inside the entailment checker.
- `docs/architecture/MODEL_BACKEND_SEAM.md` documents the intended T2/T3 wiring that never landed.

**Risk.** A lab running Claude, Gemini, or local vLLM models cannot use Trellis without forking the kernel. Worse, the half-wired seam is a trap: an operator who sets `TRELLIS_RLM_BACKEND=vllm` and `TRELLIS_RLM_BASE_URL` passes validation, gets no error (the config even *rejects* `OPENAI_BASE_URL` at `index.ts:273–275` with a message pointing to the unwired variable), and silently keeps paying OpenAI. Every capability claim in the benchmark reports is also implicitly a claim about one frontier model (the reports say so); portability is a research-validity issue, not just an ops one.

**Fix.** (1) Complete the documented T2/T3 wiring: add `rlmBackend` to `AgentEnvConfig`, forward `TRELLIS_RLM_MODEL`/`BASE_URL`/key through `buildAgentEnv` (the set-or-delete mold already used for every other variable), and have `trellis_agent.py` read them with the hardcoded literal as the default — the design record already specifies exactly this. (2) Introduce a single model-registry module (`src/core/llm/models.ts` + a Python twin constant block) so "the extraction model," "the entailment judge," and "the RLM root model" are named roles resolved in one place. (3) Replace bare `new OpenAI()` with a factory honoring base URL/key config so an OpenAI-compatible proxy (vLLM, LiteLLM, an Anthropic gateway) works for the worker tier too. The prompt-pin ceremony already anticipates model changes (`rubricVersion` stamping); extend the same versioning to model identity on `DERIVED_INSIGHT` edges so beliefs record which model derived them.

### T1.2 — Abstract and version the embedding pipeline — **Effort: M**

**Defect.** `text-embedding-3-small` is hardcoded at three call sites in two languages, and the schema pins its dimensionality with no record of which model produced any stored vector.

**Evidence.** `src/workers/extraction_worker.ts:30` (`const EMBEDDING_MODEL = 'text-embedding-3-small'`), `src/api/server.ts:265`, `src/rlm/trellis_tools.py:806`; `src/config/schema.ts:14` and `:84` pin `vector(1536)`.

**Risk.** Changing embedding models — the first thing a lab with local infrastructure will do — silently produces a mixed index: old vectors and new queries in incompatible spaces, degrading `vector_search` and the `/retrieve` fallback with no error. The three call sites can also drift from each other (one already lives in Python).

**Fix.** One `EMBEDDING_MODEL`/`EMBEDDING_DIM` pair in config (env-validated, forwarded to Python via `buildAgentEnv` like everything else); an `embedding_model` column (or table-level metadata) on `ast_nodes`; a startup check that refuses to serve vector search over vectors from a different model, with a documented re-embed script. This is the same fail-fast philosophy the repo applies everywhere else — currently the embedding layer is its one blind spot.

### T1.3 — Credentials: defaults, blast radius, and the in-process "sandbox" — **Effort: M**

**Defect.** Three related problems. (a) Default passwords are baked into source, compose, and docs. (b) Authentication is one optional static API key for the whole surface. (c) Most seriously: the Python REPL — the process that executes *model-written code* — holds full-write database credentials in its environment, so every provenance gate on the write path is enforceable only against a cooperative model.

**Evidence.**
- `src/rlm/trellis_tools.py:226` — `password = os.getenv("NEO4J_PASSWORD", "trellis_password")`; `:601` — `PG_DSN` default embeds `password=trellis_password`. Same defaults in `docker-compose.yml:4–9, 45–47, 63, 74`, `.env.example`, and printed in `docs/operations/RUNBOOK.md:38–43`.
- `docker-compose.yml:17` — `API_KEY: ${API_KEY:-trellis-local-development-key}`; `src/api/auth.ts:49–56` — unset key degrades to a logged pass-through. One shared key, no rotation, no per-client identity, no rate limiting beyond the stream gates.
- `src/workers/rlm_job.ts:172–175` — `buildAgentEnv` forwards `NEO4J_PASSWORD` and the password-bearing `PG_DSN` into the spawned agent's environment. `trellis_tools.py:276` opens `READ_ACCESS` sessions and `:513` opens `WRITE_ACCESS` sessions *with the same credentials, chosen client-side*. The `run_cypher` keyword regex (`trellis_tools.py:260–265`) is honestly labeled "NOT the security boundary"; the transport-level `READ_ACCESS` mode is — but both live inside the process whose REPL runs model code. Nothing stops generated code from executing `GraphDatabase.driver(os.environ["NEO4J_URI"], auth=(...))` and issuing arbitrary writes, bypassing the 64-hex format gate, the existence gate, and the retrieval-membership gate entirely.

**Risk.** For a single-owner localhost deployment (ports are loopback-bound — good) this is acceptable and documented. For a lab: any prompt-injected or misaligned run can corrupt the belief graph *with valid-looking provenance*, which is precisely the failure the architecture exists to prevent; leaked compose files ship working credentials; one key means one principal and zero audit attribution.

**Fix.** (1) Startup refusal: when `TRELLIS_SERVICE` is not local/dev, refuse default passwords and unset `API_KEY` (the config module already has the fail-fast pattern; this is a few predicates). (2) Split DB principals: give the spawned agent a Postgres read-only role and a Neo4j reader account; route `write_derived_insight` through a separate writer — either a small privileged RPC the REPL tool calls (keeping the existing normalization/gates server-side), or at minimum a distinct writer credential *not* present in the REPL environment. This converts the provenance gates from convention to boundary. (3) Multiple named API keys (a JSON env map suffices) as a stopgap toward real tenancy; full multi-tenant isolation (per-tenant graphs/schemas) is a Tier 3 architecture question, but per-key attribution is cheap now.

### T1.4 — De-fragilize the `rlms` coupling — **Effort: M**

**Defect.** Run telemetry — the substance of every cost claim — depends on monkeypatching private internals of the pinned `rlms==0.1.3` package and regex-scraping its stdout banner.

**Evidence.** `src/rlm/trellis_agent.py:63–78` rebinds `LMRequestHandler._handle_single`/`_handle_batched` to count sub-calls, with a comment documenting that this works only because of how *this* rlms version routes REPL `llm_query` traffic; `trellis_agent.py:470–472` notes "this rlms version never fires `on_iteration_complete`," so `src/benchmarks/oolong/rlm_client.ts:33–39` parses iteration counts from the summary banner with `/Iterations\s+([\d,]+)/` and quietly returns `null` when absent.

**Risk.** The exact pin means a bump is deliberate, but the failure modes differ in loudness: if the private method is *renamed*, `python:check` (which imports `trellis_agent`) fails CI loudly; if a new rlms version keeps the method but reroutes sub-call traffic around it, `subcall_count` silently reads 0 and every flywheel cost comparison downstream is silently wrong. The banner regex fails silently by design. Silent-zero telemetry is the worst failure class for a measurement-driven project.

**Fix.** (1) A telemetry self-check canary: a zero-cost (or one-sub-call) drill that asserts `subcall_count > 0` and `iterations !== null` after a run known to make a sub-call; wire it next to `test:rlm-sandbox`. (2) A contract test importing rlms and asserting the patched attributes exist *and are called* via a stubbed local handler. (3) Upstream or vendor: propose an `on_subcall` hook to rlms (the package already has `on_subcall_complete` for depth>1) or vendor the 100-line handler. The pin plus canary is acceptable medium-term; the current pin-without-canary is not.

### T1.5 — Make the benchmark client honor authentication — **Effort: S**

**Defect.** The SSE benchmark client sends no API key at all.

**Evidence.** `src/benchmarks/oolong/rlm_client.ts:89–96` — the request carries only `Accept: text/event-stream`; `auth.ts` accepts keys via header, bearer, or `api_key` query param, and the client uses none.

**Risk.** Benchmarks only run against an unauthenticated API, which trains operators to leave `API_KEY` unset — undermining T1.3 — and means the paid measurement path exercises a configuration you should never deploy.

**Fix.** Read `API_KEY` from the environment and append the `api_key` query parameter (the EventSource-compatible path that already exists). One small change, plus a line in the benchmark guide.

---

## 3. Tier 2 — Before drawing research conclusions

### T2.1 — A minimal credible measurement campaign — **Effort: M (engineering S; ~$150 spend)**

**Defect.** Nearly every paid result is n=1 or n=2, on synthetic corpora, with no variance reporting; the hardened v2 benchmark has never been run.

**Evidence.** The reports say so, with admirable candor: `POISONING_DRILL_REPORT.md:136` ("n=1 real paid run"); `UPDATE_DRILL_REPORT.md:151` (same); `OOLONG_BENCHMARK_REPORT.md:66` (two runs, both F1=1.000); `EFFECTIVE_CONTEXT_PROBE_REPORT.md:118, 286, 302` ("n=6 per arm, one run each — directional, not conclusive"; "n=2 per question was too small for the load-bearing" comparison); `CRITIQUE_AND_FUTURE.md:89, 92` (multi-run variance and the v2 run explicitly open; "No paid benchmark run against v2 has been executed"). Scale evidence stops at 300 documents / a 286-source hub (`SCALE_PROVENANCE_REPORT.md:66`).

**Risk.** The headline claims — flywheel amortization, 26× projected cost advantage, perfect detection recall — are architecture demonstrations, not measurements with error bars. A lab citing them inherits that fragility; a referee will reject them.

**Fix.** Run a pre-registered campaign priced from the project's own telemetry ($0.81–$0.87 per OOLONG run, $0.73–$0.80 per update drill, $0.09–$0.16 per poison-detection sweep, $0.28 for the repo-ingest pilot):

| Experiment | Runs | Est. cost |
|---|---|---|
| OOLONG v1, fresh graph each time (variance in F1, sweep position, cost) | 10 | ~$9 |
| **OOLONG v2 (first ever run)** — alias-mention, near-miss, passage distractors | 10 | ~$10–15 |
| Update drill, full 3-act | 5 | ~$4 |
| Poison drill at p=0.05 and p=0.10 | 5 each | ~$2 |
| Effective-context suites at n≥10 per arm | — | ~$20–30 |
| Scale sweep: 2k and 10k-question corpora (one-time sweep cost + warm-phase amortization curve) | 2–3 | ~$30–60 |

Total well under $150 — inside two of the project's own $5-per-run owner gates per day for a fortnight. Report means, standard deviations, and min/max; treat any v2 F1 below 1.0 as the *informative* outcome the docs already predict. This single campaign converts the evidence base from anecdote to data at trivial cost, and the runners already exist.

### T2.2 — Break the self-grading loop — **Effort: M**

**Defect.** Ground truth is synthetic and internally generated; grading and adjudication use the same model family being evaluated; the entailment gate that polices citation laundering is itself `gpt-5.4` judging `gpt-5.4` (`trellis_agent.py:90–120`).

**Risk.** Correlated failure: a model blind spot appears identically in generation, classification, and verification, and the pipeline scores itself clean. The poison drill's 0% false-dispute rate may partly reflect judge/actor correlation rather than machinery quality.

**Fix.** (1) Human-label a stratified sample (100–200 questions) of the v2 corpus and report agreement. (2) Run the entailment judge and the poison-drill verifier with a *different* model family (this also depends on T1.1). (3) Publish grading scripts and raw per-run artifacts (partially done — `benchmark_logs/` exists) so external replication is mechanical. (4) The "Real TREC import" and "adversarial corpora" items already named in `CRITIQUE_AND_FUTURE.md:85–86` belong in this tier; the annotation pass is exactly the kind of one-time paid job the flywheel argument says is cheap.

### T2.3 — Results hygiene: get run artifacts out of the repo root — **Effort: S**

**Defect.** Benchmark runners write results JSON to the repository root, where four such files are committed (`benchmark_results.json`, `poison_drill_results.json`, `update_drill_results.json`, `scale_drill_results.json`).

**Evidence.** `src/benchmarks/oolong_runner.ts:31–48` — `REPO_ROOT` path construction, plus a guard that exists only to stop a v2 run from clobbering the committed v1 baseline (a guard whose necessity is the design smell).

**Risk.** Root clutter is cosmetic; the real risks are (a) accidental overwrite of canonical evidence by a routine run — the code already fights this — and (b) no structured home for the n>1 campaign of T2.1, which needs many dated artifacts per experiment, not one mutable file.

**Fix.** `results/<experiment>/<ISO-date>-<runid>.json`, git-ignored by default; a tiny `results/index` summarizer; committed canonical baselines move to `docs/benchmarks/data/` and become immutable by convention *and* location. Half a day, and it unblocks T2.1's bookkeeping.

### T2.4 — Contain the twin-validator duplication before it drifts — **Effort: M**

**Defect.** Every operator-facing contract is validated twice, by hand, in two languages: modules (`src/config/modules.ts`, 207 lines / `src/rlm/trellis_modules.py`, 161 lines), MCP registries (`mcp_servers.ts`, 225 lines / `trellis_mcp.py`'s `parse_mcp_config`), workspace bounds, textedit bounds, and the retrieval budget (`TRELLIS_RETRIEVAL_BUDGET_PER_RUN` in Zod at `config/index.ts:133` and `parse_retrieval_budget()` at `trellis_tools.py:166–185` with "identical bounds" asserted in comments).

**Risk.** The twins are currently kept honest by comments and a handful of parity tests, not by a shared artifact. Each new bound doubles the maintenance and adds a drift channel where the Node side accepts what the Python side refuses (a paid run dying mid-flight — exactly the failure the fail-fast doctrine exists to prevent).

**Fix.** Don't unify runtimes — the two-language split is structural (Node orchestration, Python REPL). Instead: (1) extract every shared bound into one committed JSON contract file (`contracts/bounds.json`) both validators load, so numbers can't diverge; (2) add golden-vector parity tests: a directory of valid/invalid payloads asserted to produce the same accept/reject verdicts in both languages (the `block_parity.test.ts` mold, which already spawns real Python inside `npm test`, proves this is cheap here). Keep the defensive re-validation in Python — belt-and-braces at a process boundary is correct — just source the braces from the same belt.

---

## 4. Tier 3 — Long-term health

### T3.1 — Decompose `server.ts` and de-side-effect `config/index.ts` — **Effort: M**

**Defect.** `src/api/server.ts` is a 560-line module mixing route handlers, SSE plumbing, upload handling, an inline embedding call, and process lifecycle; it uses `any[]` for graph/provenance accumulators (`server.ts:207, 256`) and has mid-file imports (`server.ts:301–302`, `import IORedis`/`import crypto` after 300 lines of routes). The two SSE endpoints (`/api/rlm-stream` at 311–409, `/api/agent-stream` at 416–529) are near-duplicate 100-line blocks. `src/config/index.ts` (435 lines) validates env, resolves MCP credentials, loads module manifests from disk, `statSync`s the edit root, and throws — all at import time (`index.ts:249–304`).

**Risk.** Moderate today (the file *works*, and the A2A surface was correctly factored out), but every new endpoint deepens the monolith; import-time side effects make config untestable without env gymnastics and make any future library-style reuse (embedding Trellis in a larger service) impossible. `listen()` on import (`server.ts:553`) means importing the module starts the server.

**Fix.** Routes to `src/api/routes/{ingest,retrieve,rlm_stream,agent_stream}.ts` with the shared SSE-subscribe-enqueue-cleanup pattern extracted once (the two stream gates already share `StreamGate`); type the Neo4j accumulation with the shapes `expandAliases` already defines; move `app.listen` behind a `main()` guard. For config: export `loadConfig(env) → Config` and keep a lazy singleton for compatibility. Mechanical, low-risk, and the pinned tests (auth, stream gate, health) already cover the seams.

### T3.2 — Module lifecycle legibility — **Effort: S**

**Defect.** Retired and contested modules ship in-tree beside active ones, indistinguishable at directory level, and the registry is protocol-only while the manifest schema advertises a `tools` field.

**Evidence.** `modules/estimation-discipline/module.json:36` — `"status": "retired"`; `modules/reasoning-templates/module.json:10` — `"status": "contested"`; loaders refuse to compose non-active modules (`src/config/modules.ts:176–177`, `trellis_modules.py:109–110` — good), but nothing at the filesystem or README level signals status. `modules.ts:9`: "this edition supports PROTOCOL MODULES only — manifests declaring tools" are refused.

**Risk.** A new adopter reads four modules as four capabilities; two are museum pieces preserved for provenance history (their graph entities can still be contested — a deliberate, good design). The empty-`tools` restriction is the difference between "prompt packs" and the module system the docs gesture at; unstated, it will surprise anyone who tries to author a tool-bearing module.

**Fix.** `modules/README.md` stating the lifecycle (`active → contested → retired`), a status table, and the protocol-only rule with a pointer to the design record; optionally move retired modules under `modules/archive/` (loaders already find modules by name, so keep registration working). Document the intended path to tool-bearing modules or explicitly disclaim it.

### T3.3 — The process transplant: from one owner to a five-person lab — **Effort: L**

**Defect.** The development methodology assumes exactly one human. This is not implicit — it is encoded: `HANDOFF.md` (2,827 lines, 174 KB) is a self-regenerating session prompt rewritten every PR, holding "the single source of volatile truth" including *the current objective* ("If you do session work, §3 is your objective; do not select your own" — `AGENTS.md:29–30`). `AGENTS.md` hard rules 7, 12, and 14 encode owner-gated spend, one-branch-one-PR-plus-HANDOFF-regeneration, and a protected-pause protocol addressed to a single approving owner. The canonical prompt hardcodes the owner's machine: `HANDOFF.md:6` names `D:\trellis-engine`; `HANDOFF.md:1489` places the acceptance-ledger "protected roots" at `D:\trellis-protected\engineering-loop\...` on what is evidently a personal Windows box (the baseline even documents Windows-specific test flakiness, `HANDOFF.md:1502–1508`). Git history: 44 of 50 commits by one identity.

**What breaks with five maintainers.** (1) HANDOFF.md is a guaranteed merge conflict on every concurrent PR — it is one file, mutated by rule in every session. (2) "Do not select your own objective" serializes the lab to one workstream. (3) Every paid run gates on one person's approval — with five people running T2.1-style campaigns, the owner becomes a $2 approval bottleneck. (4) The engineering-loop acceptance ledger lives on one person's disk; nobody else can record or verify acceptance. (5) Session numbering and the five-session narrative window assume a linear history.

**Fix (adaptation, not demolition — the discipline itself is worth keeping).** (1) Shard HANDOFF: keep §0–§2 (loop, mental model, baseline) as a slowly-changing `HANDOFF.md`, move §3–§8 (objective, design, guardrails, exclusions) to per-objective files (`objectives/<id>.md`) so concurrent sessions touch disjoint files; the ledger (`TRELLIS_ROADMAP.md §5`) already appends and merges tolerably. (2) Replace "the owner" with roles: CODEOWNERS for merge authority; a spend policy (per-person daily cap, e.g. $5, matching the existing per-run cap) replacing per-run approval for sub-cap work, owner approval retained above it. (3) Move the acceptance ledger and protected roots to shared infrastructure (a small service or a protected branch — the ledger design already has hash-chaining and approval-consumption semantics, so the hard part is done). (4) Keep rule 15 ("correct is not the same claim as reachable") and the regeneration discipline — they are the transplant-worthy organs.

### T3.4 — Ops maturity: HA, backups, disk growth, alerting — **Effort: M–L**

**Defect.** The deployment story is a single-machine Compose stack with no HA, no backup automation, no disk-growth accounting for stores that are append-only *by doctrine*, and metrics without alerting.

**Evidence.** `docker-compose.yml` — one instance each of pgvector Postgres, Neo4j 5.11 (community image — clustering is an enterprise feature), and Redis; restart policies but no replication. `RUNBOOK.md:84` — backup guidance is one sentence ("take a backup before destructive recovery"). Append-only growth is structural: superseded document versions are retained by hard rule (`AGENTS.md` rule 13: "archive, not search space"), quarantined beliefs are never deleted, and `orphanedSourceIds` audit history accumulates on nodes and edges (`trellis_tools.py:308–346`); only BullMQ history is retention-bounded (`config/index.ts:42–45` — the one bounded store). Queue-depth gauges exist and are scrape-refreshed (`src/core/observability/queue_gauges.ts`), but no alert rules or thresholds ship anywhere.

**Risk.** For a lab: a disk that fills at a rate nobody has modeled (every re-ingest of a large corpus adds a full version's worth of AST rows forever); a Neo4j volume with no dump schedule holding months of derived beliefs; a stuck worker discovered by a human reading a runbook rather than a page.

**Fix.** (1) A backup recipe in Compose: nightly `pg_dump` + `neo4j-admin database dump` sidecars to a mounted volume, documented restore drill (the zero-paid drill culture applies perfectly here — a restore drill is a zero-paid drill). (2) A disk-growth note in the runbook with measured bytes-per-document-version from the existing corpora, plus a `trellis_ast_nodes_total`/table-size gauge. (3) An `alerts/` directory of Prometheus rules for the metrics that already exist: queue depth over threshold for N minutes, `rlm_runs_total{exit_status="failure"}` rate, malformed-telemetry counter increments (which is also the T1.4 canary firing). (4) Document the managed-database deployment (RDS + Aura + managed Redis) as the sanctioned HA path rather than building clustering — right-sized for a research lab.

### T3.5 — Deepen CI beyond the offline suite — **Effort: M**

**Defect.** CI is one workflow (`.github/workflows/ci.yml`) gating: `npm test` (1,239 unit tests across 110 files — genuinely fast, pure-module tests, though `block_parity.test.ts` spawns real Python), `npm run build`, `python:check`, the zero-LLM textedit drill, a Docker build, and a Compose zero-LLM round trip. Not gated: the ~40 `test:*` live drills in `package.json` (sandbox, workspace, module lifecycle, answer channel, promotion, A2A, agent loop — all zero-LLM but DB-requiring), any linter (no ESLint/Prettier config exists anywhere), dependency audit (no dependabot config; `.github/` contains only the one workflow), or a second OS despite the baseline documenting Windows-specific flakiness (`HANDOFF.md:1502–1508`).

**Risk.** The live drills are the *real* acceptance surface — the close-out block in HANDOFF §6 runs them by hand every session. Anything only a human runs will eventually not be run; single-owner discipline currently substitutes for CI, which is exactly what stops working under T3.3's multi-maintainer future.

**Fix.** The integration job already stands up the full Compose stack; extend it to execute the zero-LLM drill block (the drills were designed to be paid-work-free precisely so they could run anywhere). Add ESLint with a minimal config (the codebase is clean; the linter is for the next five contributors), `npm audit`/dependabot, and a Windows unit-test job with `--no-file-parallelism` (the workaround the baseline already prescribes). Keep paid benchmarks out of CI — owner-gated spend is correct — but wire the T2.1 campaign as a manually-dispatched workflow so runs are reproducible and logged.

### T3.6 — Session-narrative comments: stop the rot without stopping the practice — **Effort: S (ongoing)**

**Defect.** Source comments narrate development history by session number: 347 occurrences of "Session N" across 123 files in `src/` (e.g., `trellis_agent.py` alone cites Sessions 9–51; `rlm_job.ts` cites 9, 10, 12, 14, 15, 16, 20, 21, 28, 33, 50).

**Risk.** These comments are currently *excellent* — they carry the why, cite the design record, and name the pin. The rot vector is the session numbers themselves: they are only resolvable through `TRELLIS_ROADMAP.md §5` and the 6,947-line `ROADMAP_HISTORY.md`, they will collide or lose meaning once multiple maintainers work concurrently (T3.3), and a refactor that moves code strands the narrative. In three years, "Session 33" will read like a dead hyperlink.

**Fix.** Adopt a citation convention, applied on touch rather than by sweep: comments cite the durable anchor first — design record and section (`RETRIEVAL_DISCIPLINE.md §5`), which most already do — with the session number as optional trailing history; add a one-page `docs/SESSIONS.md` index mapping session → PR → design record so the numbers stay resolvable forever. Explicitly do **not** bulk-strip the narration (see §5).

---

## 5. What we would explicitly not change

An adopting lab will be tempted to "clean up" several things that look eccentric. Most of them are load-bearing. Leave these alone:

**The comment density and design-record ceremony.** The ratio of explanation to code is far beyond industry norm, and it is the reason a total stranger (this reviewer) could verify forty claims against the code in an afternoon. The comments encode *invariants and their enforcement pins*, not restated syntax. Fix the session-number anchoring (T3.6); keep the narration.

**The byte-pinning ceremony.** SHA-pinned composed prompts, "byte-identical when unset" guarantees for every feature flag, and the recompute-both-pins-in-the-same-commit rule look like bureaucracy. They are the only reason the team can state — and test — that a disabled feature has literally zero effect on paid behavior. For a system whose outputs depend on prompt bytes, this is version control for the part of the program that lives in English. Any multi-backend work (T1.1) should extend the pin files per-backend, not weaken them.

**The zero-paid drill culture and owner-gated spend.** Every capability has an LLM-free rehearsal path (oracle scripts, stub replays, dress rehearsals), and paid runs require a printed estimate against a hard cap. This is the cheapest reproducibility instrument in the repo and the reason T2.1 costs $150 instead of $5,000 of trial-and-error. Adapt the approval *topology* for multiple maintainers (T3.3); keep the gate.

**The keyword regex in `run_cypher` — as long as its label stays.** It would be easy to either delete it ("not the security boundary, so why keep it?") or beef it up into a parser ("make it the boundary!"). Both are wrong. It is a *courtesy check* producing a readable error before a round trip, while `default_access_mode=READ` does the enforcing (`trellis_tools.py:257–276`) — verified live by the sandbox drill. The correct security work is T1.3 (credential separation), not regex archaeology.

**Quarantine-over-delete and append-only growth.** The disk-growth cost (T3.4) is real, but the never-delete-beliefs, contest-and-audit design is the system's central scientific claim — that a knowledge substrate should degrade *legibly*. Bound it with backups and dashboards; do not "fix" it with TTLs on beliefs.

**The Python/TypeScript split itself.** Twin validators are a cost (T2.4), but the split is not an accident: the REPL must be Python (that is where the RLM lives), and the orchestration tier's BullMQ/SSE/Zod machinery is idiomatic Node. Unifying on one language would trade a managed, parity-tested seam for a rewrite of whichever half you understand less.

**`HANDOFF.md`'s existence.** Shard it (T3.3), but the idea — a self-regenerating prompt that makes the repository its own onboarding — is the most transferable process invention here. The 1,161-green-tests-but-inert-library incident memorialized in `AGENTS.md` rule 15 exists because the handoff loop caught it. Labs adopting Trellis should adopt the loop too, in its multi-maintainer form.

---

## 6. Closing

The work sorts cleanly: Tier 1 removes the traps (a seam that validates but doesn't wire, a sandbox that isn't a boundary, telemetry that can zero silently); Tier 2 buys statistical legitimacy for roughly the price of a conference dinner; Tier 3 converts a one-person discipline into an institution. None of it requires abandoning what makes the project unusual. The highest-leverage single week of work is T1.1 + T1.4 + T2.1: wire the backend seam, canary the telemetry, and run the campaign — at which point Trellis stops being a compelling demonstration and starts being usable evidence.
