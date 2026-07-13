# The model-backend seam (R2b design record)

**Status:** DESIGN RECORD — ratified shape, zero implementation.
Authored Session 47 (July 13, 2026) as TTT-track rung R2b
(`TEST_TIME_TRAINING.md` §12.6 Phase 0 step 2, the spec-before-pen
rule). This record is the artifact the T-series task texts quote
verbatim; no code byte, config key, env twin, or default moves until
the corresponding T-increment lands through its own owner-approved
proposal.

**Home decision (recorded per the Session 46 handoff):** this record
lives in its own file rather than as `TEST_TIME_TRAINING.md` §14. It
is quoted verbatim by four separate T-increment task texts and one R3
proposal; a standalone file gives those texts one stable address and
keeps the research record's §13 census the read-only input it is.

**Inputs (recorded, not re-derived):** the R2a census
(`TEST_TIME_TRAINING.md` §13.2 site table), the rlms verdict (§13.1
with its four caveats), and the §13.3 unmanaged `OPENAI_BASE_URL`
pass-through discovery. Every site and line quoted below is quoted
from that census. No census correction was needed this session.

---

## 1. The problem this seam solves

The root RLM completion backend is hardcoded:
`backend_kwargs={"model_name": "gpt-5.4-2026-03-05"}` at both
`trellis_agent.py` construction sites (line 329 author mode, line 532
research mode), with transport and API key resolved from ambient
environment by the openai SDK. The TTT track's Phase 2 (R3: an open
sparse checkpoint behind an OpenAI-compatible endpoint) is impossible
until backend choice is expressible. The rlms verdict (§13.1) says
the seam is cheap: `RLM(backend=..., backend_kwargs={"model_name":
..., "base_url": ..., "api_key": ...})` — additive kwargs, no library
modification.

Meanwhile the census's one real discovery (§13.3) is that the
transport is ALREADY overridable today — every production client
resolves `OPENAI_BASE_URL` from ambient env — but unmanaged: no
validation, no typed refusal, no telemetry, no pin, and an inherited
value would redirect root completions, the experimental checker, AND
the `vector_search` embedder together, which is exactly the coupling
`TEST_TIME_TRAINING.md` §4.2 forbids.

So the seam design has two jobs, and they are the same job: make
backend choice expressible through validated config, and make it
expressible ONLY through validated config.

## 2. The three-way split — one design verdict per lane

The census divides completion/embedding traffic into three lanes.
They are separable decisions and this record keeps them separated.

### 2.1 Root RLM completion — the seam this record designs

The two `trellis_agent.py` construction sites (329/532) plus the
experimental checker client (87/101 — disposition in §5). Moves via
the T-series: T1 gives it a validated config surface, T2 carries that
surface across the process boundary, T3 rewires the construction
sites, T4 proves the switch and the default against a fixture
endpoint. The full config strawman is §3.

### 2.2 Worker/engine completions — model id done, transport deferred

The worker-side model id is ALREADY config-shaped through one seam
(`EXTRACTION_MODEL`, `src/config/index.ts:109` →
`config.llm.extractionModel`, ten consumers — census Class 2): a
worker-side model change is an env-var change today and needs nothing
from this record. The worker TRANSPORT (seven zero-arg `new OpenAI()`
sites) does NOT move in the T-series. **Verdict: deferred, with the
boundary made safe first.** A worker-transport override is a future
increment entering as its own proposal, and it has a prerequisite
this record names now: the worker completion client and the embedding
client are today the same `new OpenAI()` construction
(`extraction_worker.ts:26` serves both `chat.completions.create` and
`embeddings.create`), so any worker-transport override must first
SPLIT the completion client from the embedding client — otherwise the
override moves the embedder as a side effect, the forbidden §4.2
coupling. Until that split exists, the T1 ambient-variable refusal
(§4) makes the forbidden coupling structurally unreachable rather
than merely unmanaged: there is no expressible way to redirect worker
completions at all, which is the correct interim state.

### 2.3 The embedder — does not move (restated non-goal)

The three production embedding sites (`extraction_worker.ts:30`,
`trellis_tools.py:804`, `api/server.ts:263`, all
`text-embedding-3-small`) are schema-coupled (`vector(1536)` + HNSW)
and an embedder move is a substrate-identity event
(`TEST_TIME_TRAINING.md` §4.2): recorded, owner-visible, re-measured
against the eight pinned seam queries, never a side effect of the
completion backend moving. Nothing in this design gives the embedder
a config surface, and §4's ambient-variable disposition exists partly
to keep it that way.

## 3. The config surface (T1's strawman)

The mold is `TRELLIS_RETRIEVAL_BUDGET_PER_RUN`
(`src/config/index.ts:133` + `parse_retrieval_budget()` in
`trellis_tools.py:166`): TypeScript validates fail-fast at config
load; `buildAgentEnv` forwards a set value and strips an unset one;
the Python twin re-validates with identical bounds and raises before
any paid work; unset = stripped = kernel default, byte-identical.

### 3.1 The keys

| Key | Zod bound | Unset means |
|---|---|---|
| `TRELLIS_RLM_BACKEND` | `z.enum(['openai', 'vllm']).optional()` | rlms default `"openai"` — today's behavior |
| `TRELLIS_RLM_MODEL` | `z.string().min(1).max(256).optional()` | the kernel default literal `gpt-5.4-2026-03-05` (which stays in `trellis_agent.py`, Python-side, the `RETRIEVAL_BUDGET_DEFAULT` mold — config never re-defaults it, so unset is byte-identical trivially) |
| `TRELLIS_RLM_BASE_URL` | `z.url().optional()` + a refinement requiring the `http:`/`https:` scheme | no `base_url` kwarg passed at all — the SDK default endpoint, today's behavior |
| `TRELLIS_RLM_API_KEY_ENV` | `z.string().min(1).max(128).optional()` | no key indirection; see §3.3 |

Config export: a new `config.rlmBackend` block
(`{ backend?, model?, baseUrl?, apiKeyEnv? }` plus the fail-fast
resolved key value, never logged — the `config.mcp.credentialEnv`
precedent), consumed only by `buildAgentEnv`'s caller in
`rlm_worker.ts`.

**Why only two backend values:** rlms routes eight backends, but
`openai` and `vllm` are the only two arms the ratified track needs
(the current API backend and an OpenAI-compatible serving endpoint —
R3's shape). Every additional arm is dead config surface with its own
credential semantics; widening the enum is a one-line recorded
decision when a rung actually needs it.

### 3.2 Cross-field validation (fail-fast, at config load)

1. `TRELLIS_RLM_BACKEND='vllm'` REQUIRES `TRELLIS_RLM_BASE_URL` — rlms
   itself asserts this at construction (§13.1 item 2); the config
   surface refuses it at startup instead of letting the child die
   mid-spawn.
2. `TRELLIS_RLM_API_KEY_ENV` REQUIRES `TRELLIS_RLM_BASE_URL` — key
   indirection exists only for non-default endpoints; the default
   OpenAI endpoint keeps resolving `OPENAI_API_KEY` from ambient env
   exactly as today (that inheritance is by design — the census Class
   1 note — and this record does not touch it).
3. `TRELLIS_RLM_BASE_URL` without `TRELLIS_RLM_BACKEND` is ALLOWED —
   an OpenAI-compatible proxy on the default `openai` backend is a
   legitimate configuration (rlms's own docstring: "Works with vLLM
   as well").
4. When `TRELLIS_RLM_API_KEY_ENV` is set, the named variable must be
   present and non-empty at config load — resolved fail-fast, the
   `mcpCredentialEnv` precedent exactly.

### 3.3 Credential expression without new credential handling

The decision the Session 46 handoff required: how does a local
endpoint's dummy `api_key` get expressed? Three-part answer, all
existing molds:

- **Default endpoint (no `TRELLIS_RLM_BASE_URL`):** no `api_key`
  kwarg is passed. The SDK resolves `OPENAI_API_KEY` from the child's
  env, which inherits from the worker by design. Byte-identical to
  today.
- **Custom endpoint, no key named:** T3 passes the explicit literal
  dummy `api_key="trellis-local"`. This is the §13.1 caveat made
  mechanical: a local vLLM endpoint ignores the key, but passing an
  explicit dummy means the run never depends on an unrelated real
  `OPENAI_API_KEY` being present, and rlms's import-time key
  resolution never engages.
- **Custom endpoint, real key needed (a hosted open-model service):**
  `TRELLIS_RLM_API_KEY_ENV` names the variable; config resolves it
  fail-fast at startup; `buildAgentEnv` forwards BOTH the name (so
  the child knows where to look) and the named variable's value
  (explicitly set into the child env) — exactly the
  `mcpCredentialEnv` forwarding contract, values never logged or
  serialized. T3 passes `api_key=os.environ[<name>]`.

No plaintext key ever appears in config, argv, telemetry, or logs.

## 4. The ambient-transport disposition (`OPENAI_BASE_URL`)

The census recommendation is adopted: **backend choice is expressible
ONLY through the validated config surface, and the ambient SDK
variable is refused/stripped at every layer the T-series touches.**
Three layers, one per increment:

1. **T1 (config, Node side): fail-fast refusal.** Config validation
   fails with a typed message when ambient `OPENAI_BASE_URL` is set
   in the process environment, naming the validated keys
   (`Backend config: OPENAI_BASE_URL is not honored; set
   TRELLIS_RLM_BASE_URL (root agent) — worker transport is not yet
   configurable.`). This protects every config-loading process — API,
   workers, drills — and, per §2.2, makes the completion/embedder
   coupling unreachable instead of unmanaged. Nothing sets the
   variable today (census §13.3: "not a defect — nothing sets it"),
   so the refusal breaks no one; it converts a silent redirect into a
   loud instruction.
2. **T2 (`buildAgentEnv`): unconditional delete.** `delete
   env.OPENAI_BASE_URL` joins the experiment-flag deletion block
   (`rlm_job.ts:216–226` — the `TRELLIS_EXP_*` mold: the worker never
   forwards it, so an inherited value can never redirect a spawned
   agent regardless of what the worker's own environment carries).
   `buildAgentEnv` is a pure function pinned by unit test; the strip
   holds even for callers that bypassed config validation.
3. **T3 (the agent, Python side): delete-unless-configured before
   construction.** After the twin parse, if no validated
   `TRELLIS_RLM_BASE_URL` was provided, the agent removes
   `OPENAI_BASE_URL` from its own `os.environ` before constructing
   `RLM` or the checker client. This closes the one channel T2 cannot
   reach: rlms runs `load_dotenv()` at import (§13.1 caveat 4), and
   `load_dotenv` sets ABSENT variables — so a `.env` file in the
   agent's working directory could re-introduce the variable after
   T2's strip. Import-time dotenv runs before `main()`; client
   construction happens inside `main()`; the delete therefore wins.
   When the variable was never present the delete is a no-op and the
   default path stays byte-identical.

**Recorded residual (guardrail 8):** the `load_dotenv()` channel is
closed for `OPENAI_BASE_URL` only. A `.env` file remains an input
channel for OTHER variables (including `OPENAI_API_KEY`, which is
wanted). Managing the dotenv channel wholesale would mean modifying
rlms (guardrail 10 forbids) or sanitizing the child's entire
environment (out of scope, its own decision if ever wanted). Named,
bounded, not denied.

## 5. The checker client — FOLLOWS the seam (T3 scope)

`make_entailment_check` (`trellis_agent.py:87,101`) constructs a
direct `openai.OpenAI()` with a hardcoded model literal, only under
`TRELLIS_CITATION_ENTAIL=1` (experimental). Decision: **it follows
the seam.** When the validated config provides a base URL/key/model,
the checker client is constructed with the same values; unset, its
construction is byte-identical to today.

Reasons: (a) it runs inside the agent process and ALREADY shares the
root's transport by construction — both resolve the same ambient env
today; freezing it would take NEW code (a hardcoded explicit
`base_url`) rather than less, and would recreate the §13.3 split
(root on one backend, checker silently on another) inside a single
process. (b) It is off by default and its verdicts are not
comparability-bearing across backends: any paired measurement
pre-states its arms, and a cross-backend run that enables the checker
records the checker's backend with the run (the R4 proposal's
arm-verification duty, Session 43 mold). (c) The frozen instruments
stay frozen — the probe scripts (`probe_workspace_lineage.py:157`,
`probe_workspace_paired.py:89`) and the experiment scripts named
frozen in census Class 1/Class 6 are NOT rewired; retrofitting them
would invalidate comparability with their recorded runs.

## 6. Typed refusals — where each failure surfaces

There is no in-run refusal surface for backend config: every check is
construction-time, before any paid work (the
`parse_retrieval_budget` doctrine — "a malformed budget env raises
here, before any paid work").

| Failure | Layer | Shape |
|---|---|---|
| Bad enum value, bad URL scheme, over-length | T1 zod, config load | config validation error naming the key and bound |
| `vllm` without base URL; key-env without base URL; named key var absent/empty | T1 cross-field refinement | same, naming both keys involved |
| Ambient `OPENAI_BASE_URL` set | T1 guard | the §4.1 typed message |
| Twin disagreement (raw env reached the child malformed) | T3 `parse_rlm_backend()`, before construction | `ValueError` in the `Invalid TRELLIS_RETRIEVAL_BUDGET_PER_RUN:` message mold — fails the task fast, spends nothing |
| Endpoint lacks `usage` on completions | rlms `_track_cost` (unchanged) | rlms raises; R3a's FIRST smoke assertion and T4's stub both exist to catch this before any real run does |

## 7. Telemetry (T16 house style)

Additive, counts-and-echoes only, no new counters:

- `TRELLIS_TELEMETRY` gains `rlm_backend` (the resolved backend
  string — a bounded enum value) and `rlm_base_url_set` (boolean).
  The URL itself NEVER appears — URLs never become telemetry content
  or metric label values (T16). The Node telemetry scanner tolerates
  additive fields (pinned — the Session 41 counter split precedent
  rode through with zero scanner change).
- `model_usage` already keys by model name; a new backend's model
  appears as a new key with no shape change (census Class 5).
- No Prometheus change: the worker's existing `model` label is
  already a bounded label value; a backend change changes label
  VALUES only.

## 8. The T-increment task-text skeletons

Ratified shape (`TEST_TIME_TRAINING.md` §12.6): each T-increment is a
feature-class self-edit — authored by Trellis through the stage-2
harness, task-assigned, owner-gated ≤$5, one increment record each in
the `REPOSITORY_INGESTION_REPORT.md` §5e/§5g mold, every diff
human-reviewed, landing a human PR. **The criterion, identical for
all four:** the standing five items (named-file-only diff; the
evidence contract's one recorded insight through the Session 31 gate;
`stage2:check` zero findings; human `git diff` review acceptance;
spend within estimate) PLUS guarded-only (`textedit_raw_splices ==
0`) PLUS the parse gate PLUS the increment's own new unit pins green.
Because this record lives in `docs/` (outside extraction scope), each
task text carries its spec section VERBATIM — the increments-1/2
channel. Refresh-before-use applies to each increment's target area
under the split-scope recipe (`src/rlm` is the policy-2 leg).

### T1 — the config surface (no call-site change)

- **Named files:** `src/config/index.ts` (the four §3.1 keys in the
  env schema; the §3.2 refinements; the §4.1 ambient guard; the
  `config.rlmBackend` export with fail-fast key resolution),
  `src/config/rlm_backend.test.ts` (NEW — the suite's per-topic test
  mold: `textedit_bounds.test.ts` / `workspace_bounds.test.ts`) for
  the new unit pins.
- **Task-text skeleton:** "Add the backend config surface specified
  in MODEL_BACKEND_SEAM.md §3–§4 layer 1 (spec text follows
  verbatim). Add the four optional keys with exactly the stated
  bounds; add the three cross-field refusals and the ambient
  `OPENAI_BASE_URL` guard with the stated message; export
  `config.rlmBackend`; resolve the named key variable fail-fast.
  Change NO call site: no consumer reads the new block yet. New unit
  pins: each key's bound (accept/refuse pairs), each cross-field
  refusal, the ambient guard, unset-config byte-identity of the
  export (all fields undefined)."
- **New unit pins (the increment's own):** validation accept/refuse
  per key; the four refusal messages; `config.rlmBackend` shape;
  no-op when everything is unset.

### T2 — `buildAgentEnv` forward/strip (the experiment-flag mold)

- **Named files:** `src/workers/rlm_job.ts` (`AgentEnvConfig` gains
  the optional `rlmBackend` block; `buildAgentEnv` set-or-delete for
  each `TRELLIS_RLM_*` variable; the unconditional
  `delete env.OPENAI_BASE_URL` in the experiment-flag block; the
  key-env name+value forwarding per §3.3), `src/workers/rlm_job.test.ts`
  for the pins. (The one-line wiring in `rlm_worker.ts` that passes
  `config.rlmBackend` into `buildAgentEnv`'s cfg may land here or in
  T3 — the increment proposal states which; the pure function's
  contract is T2's substance either way.)
- **Task-text skeleton:** "Extend `buildAgentEnv` per
  MODEL_BACKEND_SEAM.md §3.3 and §4 layer 2 (spec text follows
  verbatim). Forward each configured `TRELLIS_RLM_*` value; delete
  each unconfigured one (the `TRELLIS_MCP_SERVERS` discipline);
  delete `OPENAI_BASE_URL` unconditionally alongside the
  `TRELLIS_EXP_*` deletions; forward the named key variable
  explicitly (the `mcpCredentialEnv` loop precedent). New unit pins:
  forwarding both directions, the unconditional strip, inherited-raw
  values never leak, byte-identical env when the block is absent."
- **New unit pins:** set-forwards / unset-deletes per variable;
  `OPENAI_BASE_URL` stripped even when cfg sets a base URL (the child
  gets `TRELLIS_RLM_BASE_URL`, never the SDK variable); key value
  forwarded under its own name; absent-block byte-identity.

### T3 — the `trellis_agent.py` construction-site rewire

- **Named files:** `src/rlm/trellis_agent.py` only (the twin
  `parse_rlm_backend()` in the `parse_retrieval_budget` mold —
  identical bounds, `ValueError` before paid work; both `RLM(...)`
  construction sites gain `backend=` and the assembled
  `backend_kwargs` per §3; the §4 layer-3 delete-unless-configured;
  the checker client construction per §5; the §7 telemetry fields in
  both telemetry payloads). The policy-2 substrate covers this file —
  graph-informed editing works today.
- **Task-text skeleton:** "Rewire the two RLM construction sites per
  MODEL_BACKEND_SEAM.md §3, §4 layer 3, §5, §7 (spec text follows
  verbatim). Unset config must produce byte-identical construction
  calls: `backend` defaults to `'openai'`, `backend_kwargs` contains
  exactly `model_name='gpt-5.4-2026-03-05'` and nothing else, no
  `base_url`/`api_key` keys present. The kernel default literal stays
  in this file. Add `parse_rlm_backend()`; delete ambient
  `OPENAI_BASE_URL` before construction when no base URL was
  configured; apply §3.3's three-part key rule; emit the two additive
  telemetry fields."
- **New unit pins:** the twin parse (accept/refuse, identical bounds
  to T1); unset-arm construction-kwargs byte-identity (assembled dict
  equality); the dummy-key rule; the ambient delete;
  telemetry-payload fields present with backend echoes. (These land
  as `test:rlm-sandbox`-style drill sections or a dedicated unit file
  — the increment proposal states which; the sandbox drill stubs the
  `openai` module already.)

### T4 — the fixture-endpoint drill (zero-LLM, the fixture-MCP-server precedent)

- **Named files:** `scripts/fixture_openai_server.py` (NEW — a
  stdlib-only stub OpenAI-compatible server in the
  `fixture_mcp_server.py` mold: deterministic canned completions,
  loopback only, never a deployment surface; it MUST return a `usage`
  object on non-streaming completions — the §13.1 hard caveat is the
  drill's reason to exist), `scripts/test_backend_seam.ts` (NEW — the
  drill: spawns the agent against the fixture endpoint via the
  validated config path and asserts the switch; spawns the unset arm
  and asserts byte-identical default construction), `package.json`
  (the `test:backend-seam` script entry).
- **Task-text skeleton:** "Build the zero-LLM backend-seam drill per
  MODEL_BACKEND_SEAM.md §8 T4 (spec text follows verbatim). The stub
  serves `POST /v1/chat/completions` with deterministic content and a
  well-formed `usage` block; one misbehaving mode omits `usage` so
  the drill can assert rlms's typed failure is caught loudly (the
  fixture server's misbehaving-tools precedent). The drill proves:
  (1) a configured run's completions arrive at the fixture (request
  observed, response consumed); (2) the unset arm never contacts the
  fixture and constructs today's exact defaults; (3) an ambient
  `OPENAI_BASE_URL` pointing at the fixture is stripped and ignored."
- **New unit pins:** the drill's own assertions (it IS the pin — the
  `test:rlm-mcp` fixture precedent); the no-usage mode's loud
  failure.

**Failure handling:** a failed T-increment gets the increments-1/2
treatment — diagnose, close the class mechanically, retry as its own
proposal (§12.6). A T-increment never lands with a non-empty
`stage2:check` finding list or without human diff review.

## 9. The R3 proposal skeleton (Phase 2 — a future session's document)

R3 enters only after T1–T4 land (the seam must exist before anything
can be served through it). Two chunks, each its own owner-approved
proposal:

- **R3a — serving bring-up + protocol smoke.** One owner-chosen open
  sparse checkpoint, exact-pinned by hash (substrate-identity
  doctrine), behind an OpenAI-compatible endpoint (vLLM is the
  default assumption — rlms's own `vllm` arm and the aTTT serving
  stack both point there). **FIRST assertion, before anything else:
  the endpoint returns `usage` on non-streaming completions** — the
  §13.1 caveat; a failure here stops the rung at a recorded finding
  that costs minutes, not a run. Then the protocol smoke: a handful
  of research-mode runs against the durable corpora, counting
  protocol violations, answer-channel usage, and REPL-block
  discipline — no criterion yet, just the existence proof and the
  violation-rate first read.
- **R3b — the paired baseline (the reproduction half).** The est
  suite (five questions, truths unit-pinned — the row-10 instrument,
  backend-independent by construction) plus a protocol-adherence
  block, open-checkpoint arm paired against a same-day gpt-5.4 arm.
  Criterion pre-stated in the proposal; the GATING question is
  protocol competence (can the open model drive the house REPL
  protocol at an acceptable violation rate at all) — if R3b fails,
  the track PAUSES at a recorded finding. Arm assignment verified per
  run from telemetry, both directions (the Session 43 mold; §7's
  `rlm_backend` echo exists for exactly this). The positive-control
  duty (§6 of the research record) applies before any null is
  believed.
- **Estimate class:** local serving prices in GPU-hours under an
  owner-set per-run compute budget stated in the proposal; a hosted
  open-model endpoint prices per-token and stays under the standing
  ≤$5/run cap as-is. Estimate before, actuals after, in the roadmap
  §5 entry — unchanged ceremony. The gpt-5.4 comparison arm is
  ordinary API spend under the same cap.

## 10. Non-goals and residuals

- **NO implementation lands in R2b.** T1 is the first code-touching
  step and enters as its own proposal. This file changes no default,
  no pin, no gate, no prompt byte.
- **The embedder does not move** (§2.3; `TEST_TIME_TRAINING.md`
  §4.2). No key in §3 touches embeddings, and §4 makes accidental
  embedder redirection refuse loudly.
- **Worker transport does not move** (§2.2) — deferred behind the
  completion/embedding client split, its own future proposal.
- **The pricing constants stay estimate-only** (census Class 4): an
  R3 serving arm prices in its own units per §9; nobody stretches
  `PRICE_PER_M_INPUT` to cover a backend it does not describe.
- **The frozen instruments stay frozen** (census Classes 1/6): probe
  scripts and archived experiment scripts keep their recorded shapes.
- **rlms is never modified** (guardrail 10). The seam is additive
  kwargs plus config, exactly as the verdict allows.
- **Residuals, named:** the `load_dotenv()` channel is closed for
  `OPENAI_BASE_URL` only (§4); rlms's `usage` requirement is caught
  by T4's stub and R3a's first assertion but remains a hard
  compatibility constraint on any endpoint; the token/context lookup
  coupling (§13.1 caveat 2) stays non-blocking and unmanaged
  (compaction is never enabled); a cross-backend run that enables the
  experimental checker records the checker's backend with the run
  (§5).

## 11. What acceptance looks like for this record

R2b is accepted when: the four Session 46 handoff deliverables exist
in this file (§2 the split design, §3–§7 the config strawman with
every named decision made and reasoned, §8 the four T-increment
skeletons with scope/files/criterion, §9 the R3 skeleton with its
estimate class); every decision the handoff enumerated is decided
here with its reason (§3.3 credentials, §4 the strip, §5 the checker,
§7 telemetry, home-file choice in the header); and the repository's
offline suite is untouched-green (docs-only). The T-series may then
quote §3–§8 verbatim into task texts without re-deriving anything.
