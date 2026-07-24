# Rule 9 — boundaries and external surfaces

`AGENTS.md` rule 9 reads *validate at every boundary* and names three clauses. In
this repository those clauses are instances of "every boundary" rather than the
whole set: a surface carrying untrusted bytes with no clause of its own is still
inside rule 9. Four surfaces exist today.

| Surface | Home | What crossing is |
|---|---|---|
| Model completions | `src/core/llm/boundary.ts` | `parseLlmResponse`, which throws |
| Job payloads | `src/workers/*_job.ts` | optional · bounded · legacy byte-pinned |
| Operator gates | `src/config/index.ts` | one author, one read, at startup |
| External specs | `src/core/a2a/protocol.ts`, `src/api/` | the cited spec version, declined whole |

## 1. Model completions

A completion returned by a chat-completions call becomes a typed value through
**exactly one function**: `parseLlmResponse` (`src/core/llm/boundary.ts:47`). The
set of call sites that turn completion text into a value by another route is
empty.

That set is empty **across the repository**, not across `src/workers/`. Four of
the six production call sites sit outside it:

- `src/core/graph/alias_resolution.ts:231`
- `src/core/graph/entailment_detection.ts:230`
- `src/core/graph/verification.ts:243`
- `src/core/agent/decision_source.ts:61`
- `src/workers/extraction_worker.ts:89`
- `src/workers/supervisor_worker.ts:88`

`boundary.ts`'s own header sentence and the `src/core/llm/` row of the `AGENTS.md`
navigation table each say *worker-consumed*. The class rule 9 ranges over is
completions, and the call sites are what settle it.

Crossing carries **one outcome** for a bad payload: the typed value never comes
into existence and `LlmResponseError` leaves the call site. Workers let it
propagate so BullMQ re-dispatches — completions are sampled, so a fresh attempt
usually parses. A call site that catches the error and substitutes a default has
relocated the boundary into itself.

A line on a spawned RLM process's stdout belongs to a different class: a process
envelope, not a completion. It has **exactly two** readers, both bounded line
scanners over the byte stream the SSE/Redis path publishes — `rlm_result.ts` and
`rlm_draft.ts`. Each validates with plain Zod and degrades (`malformed`; for a
draft carrying any 64-hex token, `refused`) rather than throwing, since an
envelope fault would otherwise corrupt the client stream. Those two postures —
throw at the completion boundary, degrade at the envelope scanner — are the whole
set, and every reader of model-authored bytes sits in one of them.

The draft scanner's refusal is a provenance bind rather than a size bind: the
harness pins research citations from the promotion output, so a draft emitting an
AST-hash-shaped token is refused as an attempt to cite. Rule 4 owns the write
path.

## 2. Job payloads

A new job field carries **exactly three** properties: optional, bounded, and
legacy-byte-pinned.

- **Optional.** Absent is a state distinct from every present value.
  `parseExtractionJobData` returns `sourceKind: null` for a payload predating the
  field.
- **Bounded.** The bound sits at the declaration:
  `maxIterations: z.number().int().positive().max(50)`,
  `seedTasks … .max(MAX_SEED_TASKS)`,
  `maxResultBytes … .max(MCP_MAX_RESULT_BYTES_MAX)`.
- **Legacy byte-pinned.** Absent `sourceKind` and `'prose'` both yield
  `LEGACY_EXTRACTION_SYSTEM_PROMPT` byte-for-byte. `extraction_job.test.ts` holds
  its own literal copy (`PINNED_LEGACY_SYSTEM`) and compares the module's
  constant against it, so editing the constant alone turns the suite red.

A field with a closed vocabulary has **the whole set** written down in the
module — `KNOWN_LANGUAGES`, `ExtractionSourceKind`, `RLM_TASK_STATUSES`,
`ORCHESTRATOR_ACTIONS` — and a value outside the set ends the job at the parse,
ahead of any I/O or paid call. `language` is refused rather than interpolated into
a prompt.

Registries read from the environment hold the same shape:
`McpServerSchema`'s `preprocess` fills `transport: 'stdio'` so pre-Session-12
registry values parse byte-identically.

## 3. Operator gates

An operator gate — an env allowlist, a budget, a confirmation flag — has **exactly
one author: the operator**. Authorship of the bytes is what the gate turns on,
rather than permission to apply them: a value the model composes and the operator
applies has two authors, and a gate with two authors is a gate the model wrote.

The kernel is **the one place** a gate's value is decided. Residing in a kernel
module is a weaker property, one a runtime-settable value also has.

The process performs **exactly one read**, at import:
`EnvSchema.safeParse(process.env)` runs once at module load
(`src/config/index.ts:261`) and throws on a malformed environment. A gate that
cannot be established is a startup failure rather than a default — an
`OPENAI_BASE_URL` present, a registry naming an absent credential variable, and a
`TRELLIS_EDIT_ROOT` that is not a directory each end the process before any run.

A bound may travel on a job payload and stay operator-authored:
`AGENT_MAX_ITERATIONS_PER_GOAL` → `config.agent.maxIterationsPerGoal` →
`goal_loop.ts:206` → `rlm_job.ts:47`, where `.max(50)` is a second kernel ceiling
at the queue boundary. Direction is the invariant — a payload value selects
**within** a kernel ceiling, and raising a ceiling takes an environment change.
`OrchestratorDecisionSchema` carries no budget field: the orchestrator names task
ids and queries, and every bound on their execution arrives from the environment.

## 4. Surfaces answerable to an outside specification

`src/core/a2a/protocol.ts` answers to a2a-protocol.org v1.0.0 and speaks **exactly
one** protocol version (`A2A_SUPPORTED_VERSION = '1.0'`). Each schema cites the
spec section it implements (§3.6, §5.4, §5.7, §8.2, §9.5), which is how a later
session checks a change against the source rather than against the code (rule 18).
Every inbound JSON-RPC envelope and method parameter crosses a Zod schema before
it influences anything.

Inbound caps are declared numbers — `A2A_MAX_PARTS = 8`,
`A2A_MAX_GOAL_CHARS = 32_768`, `A2A_MAX_ID_CHARS = 128` — so a misbehaving
external agent degrades to a protocol error rather than resource exhaustion.
Out-of-scope operations (multi-turn continuations, client-supplied context ids,
push notifications, task listing, non-text parts) are declined **whole**, each
with one of the spec's own error codes; partial acceptance is a shape this surface
does not have. The module is pure: no I/O, no Express, no Redis.

In `src/api/`, admission is decided ahead of allocation — `StreamGate` counts a
stream in before the Redis subscriber and the paid Python process exist.
`isValidApiKey` compares with `crypto.timingSafeEqual` and short-circuits on a
length mismatch. With no key configured the API stays open and logs a warning: a
documented local-development state, so tightening it is a behavior change to put
to the collaborator (rule 21) rather than a defect to fix in passing.
