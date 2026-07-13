# Retrieval Discipline: Held-State Dedup and Per-Run Budgets

**Status:** living design record (roadmap §4 row 10). Written July 13,
2026, Session 33 — document-first, before the implementation it
specifies.
**Scope:** the three Tier-1 retrieval surfaces in
[`trellis_tools.py`](../../src/rlm/trellis_tools.py) —
`get_ast_texts`, `get_ast_blocks`, `vector_search`.
**Parent doctrine:** [`CODE_MEDIATED_TEXT.md`](CODE_MEDIATED_TEXT.md)
(the pillar applied to retrieval spend) and
[`PROVENANCE_THREADING.md`](PROVENANCE_THREADING.md) §4 (the recorded
held-root note this record answers).

---

## 1. Problem statement — the measured shape

The Session 28 estimation-discipline control measured the failure
class directly (EFFECTIVE_CONTEXT_PROBE_REPORT.md, control section):
with no discipline, runs re-fetched evidence they already held —
median database calls 2 against a recorded minimal-evidence bound of
1, with the frank corpus median at 4. The prompt-module answer moved
the behavior (median 1 with the module on) but at a pooled token LOSS,
and the owner retired it with the permanent direction: behavioral
failure classes close by **tooling shape**, not prompt modules.

A repeat fetch is attention doing bookkeeping's job. The run already
holds the bytes in a REPL binding; re-fetching them re-spends input
tokens serializing the same content into the context a second time,
and re-reading re-risks choosing the wrong block. The pillar's answer:
the engine tracks what was already served, the engine enforces
budgets, the model reuses the bindings it already holds.

Honest scope (guardrail 8): dedup closes REPEAT fetches; it does not
make retrieval optimal. The budget bounds spend; it does not guarantee
sufficiency. Neither claims more.

## 2. Held state — the structure and its request identities

### 2.1 What held state is, and what it is not

Held state answers exactly one question: **"were these bytes already
served to this run?"** It is bookkeeping over retrieval, never over
citability. The Session 30 retrieval set answers a different question
("which addresses may this run cite") and the two structures must
never feed, filter, or gate each other (roadmap guardrail; the
PROVENANCE_THREADING.md §4 note is binding — the shared seam is the
**call sites**, not the set). A refused re-fetch changes nothing about
what the run may cite: it already retrieved those bytes, so they are
already in the retrieval set, which is monotone.

Held state is three module-level structures plus counters, guarded by
their own lock (`_held_lock` — a sibling of `_audit_lock` at the same
call sites; `_audit_add`'s contract is not overloaded):

| structure | fed by | request identity it serves |
|---|---|---|
| held **addresses** | `get_ast_texts` returned keys; `get_ast_blocks` returned block ids | a `get_ast_texts` call is a repeat when **every** requested hash is already held |
| held **roots** | `get_ast_blocks` root argument, on successful serve | a `get_ast_blocks` call is a repeat when its root was already served |
| held **queries** | `vector_search` query string, on successful serve | a `vector_search` call is a repeat when its **exact query string** was already searched |

### 2.2 `get_ast_texts` — per hash, full-repeat only

Identity is the requested hash set (string elements). The call refuses
as a repeat **only when every requested hash is already held** — a
call that could serve any new bytes passes in full.

**Partial-overlap semantics: serve everything.** A request where some
hashes are new is served completely, held hashes included, and the
returned bytes are byte-identical to what a bare fetch of the same
list returns. Decided against the alternatives on drill evidence and
contract grounds:

- *Serve only the new remainder* silently changes the returned map's
  shape mid-run — model code indexing the held keys gets `KeyError`
  on a call that looked successful. That is exactly the "silent change
  to what a fetch returns" the row's exclusions forbid.
- *Refuse the whole call* burns a scarce REPL iteration (the kernel's
  ITERATION BUDGET rule) to save bytes that are mostly about to be
  served anyway, and punishes the legitimate batch-read pattern.
- The measured failure class (Session 28: frank median 4 calls vs
  bound 1) is **whole-call repeats** — the same evidence re-fetched
  wholesale — not batches with stale stragglers. Full-repeat refusal
  targets what was measured.

Known and accepted: a model can evade the dedup by padding a repeat
request with a never-held hash. The dedup is teaching machinery in the
write-gate mold, not a security boundary; the budget still bounds
total spend, and the acceptance measurement reports what actually
happens. Recorded honestly rather than closed with complexity.

### 2.3 `get_ast_blocks` — per root

Identity is the root hash argument. A successful serve marks the root
held; a repeat call on a held root refuses with a typed pointer to the
earlier fetch. This is THE measured case: the frank-corpus repeats
were `get_ast_blocks` re-reads of the same root. The returned block
ids also join held addresses — the blocks' bytes were served, so a
later `get_ast_texts` on exactly those ids (all of them already held)
is a repeat by the §2.2 rule. A failed call (unknown root raises)
marks nothing: no bytes were served.

`get_ast_texts([root])` after `get_ast_blocks(root)` is NOT a repeat:
the root's own reconstruction bytes were never returned (the Session
30 rule — block ids join the retrieval set, never the root argument —
has the same shape, for the same reason).

### 2.4 `vector_search` — exact-query-match only

Identity is the exact query string (byte equality). A repeat of the
identical query refuses: the search is deterministic over an unchanged
store, so re-asking re-spends an embedding call to learn nothing.
**Semantic-similarity dedup is explicitly excluded**: deciding that
two different query strings are "the same question" is a semantic
judgment, not plumbing — the engine would be guessing at intent, the
exact failure mode the mechanical/semantic factorization in
PROVENANCE_THREADING.md §2 exists to avoid. A rephrased query is a new
fetch, by decision.

**`vector_search` result ids do NOT join held addresses.** Reading a
search hit's full text via `get_ast_texts` after searching is the
legitimate confirm-before-cite pattern the Session 31 write-gate
refusal explicitly teaches ("call `get_ast_texts` on them, confirm the
bytes support your claim"). Marking search results as held would make
the taught remedy refuse — the machinery would contradict its own
teaching channel.

## 3. Serve or refuse — REFUSE, and why

A repeat fetch **refuses** with a typed, bounded error in the
write-gate mold. It never serves from held state, silently or
otherwise.

- Serving from held state would require the engine to keep the served
  bytes — a persistent in-memory mirror of the store, which
  CODE_MEDIATED_TEXT.md forbids outright (guardrail 14: "never a
  persistent in-memory mirror of a store"). Held state therefore holds
  **identities only** (hashes, roots, query strings), never content.
- Silently re-serving re-spends the tokens the discipline exists to
  save: the serialized bytes enter the context again either way.
- The refusal is the teaching channel — the same channel every
  provenance violation uses, requiring zero prompt bytes. Each message
  names the repeat (bounded echo: first 5 + `+N more`) and teaches the
  remedy: reuse the variable holding the earlier return; re-derive
  from it in code.

All discipline refusals are `ValueError` with the uniform prefix
`Retrieval Discipline:` — typed, greppable, structurally distinct from
`Provenance Violation:` (which stays reserved for the write path).

## 4. The per-run budget

- **What consumes budget:** fetches that returned bytes — a successful
  call of any of the three surfaces whose return was non-empty
  (non-empty texts map, non-empty blocks list, non-empty search rows).
  Dedup refusals consume nothing. Empty returns consume nothing (no
  bytes served). The budget counts FETCHES, never addresses.
- **The bound:** kernel default `RETRIEVAL_BUDGET_DEFAULT = 64`
  fetches per run, hard cap 1024 — generous headroom over every
  measured workload (Session 28 medians 1–4 calls/run) so the budget
  catches runaway loops, not real work. Operator env twin
  `TRELLIS_RETRIEVAL_BUDGET_PER_RUN` in the `ENTAILMENT_*` mold:
  validated in `src/config/index.ts` (int, positive, max 1024,
  optional) and re-validated by the Python twin
  `parse_retrieval_budget()` with identical bounds; forwarded by
  `buildAgentEnv` ONLY when the operator set it (the workspace-bounds
  stripping discipline: an unset config deletes any inherited value,
  and the child applies the kernel default).
- **The refusal:** typed (`Retrieval Discipline:`), fires on the
  fetch after the budget is exhausted (budget N serves N fetches; call
  N+1 refuses before any I/O), carries the counts (fetches served,
  held addresses/roots/queries) plus a bounded held-root echo (first 5
  + `+N more`), and teaches working from held state. It refuses
  conservatively: once exhausted, a would-be fetch refuses without
  asking the database what it would have returned.
- **Check order within a call:** existing validation → dedup → budget
  → fetch. A repeat call when the budget is also exhausted gets the
  DEDUP refusal — "reuse your binding" is the actionable teaching;
  "you are out of budget" would only tell it to stop.
- **Shared wiring:** the budget and the dedup activate together
  through one constructor decision (§5) — one seam, one flag, no
  half-disciplined configuration.

## 5. Scope and wiring

- **Scope: per run = per process.** Module-level state in
  `trellis_tools.py` under its own lock (the `_tool_call_stats` /
  retrieval-set mold). It dies with the process, is never parked,
  serialized, or seeded — **a seeded run inherits NO held state**,
  matching the retrieval set's rule (PROVENANCE_THREADING.md §3.2):
  the seeding run was served none of those bytes.
- **Activation: explicit construction at the agent, the
  `retrieved_addresses_check` injection mold.**
  `TrellisPostgres(retrieval_discipline=True, retrieval_budget=N)`
  enables both mechanisms on that instance; the default
  (`retrieval_discipline=False`) is byte-identical to today — bare
  construction in drills, operator scripts, probe harnesses, and the
  verification sweep records nothing and refuses nothing. Recording
  and checking BOTH happen only on disciplined instances: held state
  exists solely to serve dedup/budget, so feeding it from undisciplined
  paths would be dead bookkeeping on paths pinned byte-identical.
- **Research runs wire it ON.** `trellis_agent.py` constructs the
  research `TrellisPostgres` with `retrieval_discipline=True` and the
  parsed budget — the discipline is kernel behavior for every research
  run, like the Session 31 write gate. Author mode constructs no
  database tools and is untouched.
- **The experiment escape (the OFF arm of the acceptance
  measurement):** `TRELLIS_EXP_OMIT_RETRIEVAL=1` makes the agent
  construct the undisciplined instance. The `TRELLIS_EXP_OMIT_CMT`
  mold exactly: probe-runner-only, off by default, byte-identical
  unset (pinned), never set by any default/worker/Compose config, and
  `buildAgentEnv` deletes it unconditionally so only an experiment
  runner's own spawn env can set it.
- **First fetch byte-identical everywhere.** The disciplined path adds
  checks before and bookkeeping after the serve; the served bytes of
  any non-repeat call are byte-identical to a bare instance's — pinned
  by the drill against the same probe rows.
- **Prompt bytes: none.** The refusals teach through the exception
  channel; both composed-prompt pins stay unmoved. If a future session
  judges a TOOLS-line teaching sentence necessary, that is a witting
  kernel change under the standing pin-recompute rule — not taken
  here.
- **Tool-call counting:** a refused call still increments
  `_count_tool_call()` (it ran before the checks), matching the
  write-path refusal behavior — a refusal is an attempted database
  operation, and the count feeds the protocol-violation floor, never a
  reward.

## 6. Telemetry

Counts only, in the `retrieved_addresses` mold (T16: identities never
become label values or telemetry content): `retrieval_fetches`,
`retrieval_dedup_refusals`, `retrieval_budget_refusals`,
`held_addresses`, `held_roots`, `held_queries` join
`TRELLIS_TELEMETRY` via a copy-returning accessor
(`get_retrieval_discipline_stats()`). The Node scanner's unknown-field
tolerance is already pinned (`rlm_telemetry.test.ts`), so no scanner
change is needed. Undisciplined runs report zeros.

## 7. What this row does NOT touch

- The Session 30 retrieval set: definition, always-on semantics,
  contributing surfaces, exclusions, accessors — byte-unchanged
  (`test:rlm-sandbox` [5] pins re-proven under the new machinery).
- The Session 31 write gate: order, wiring, refusal bytes ([6] pins).
  Held state never feeds `_verify_hashes_retrieved` and the gate never
  consults held state.
- The Session 32 detector, the citation-audit buckets and
  `TRELLIS_CITATION_*` flags, `fetch_texts` and `ast_hashes_exist`
  (plumbing — neither disciplined nor held-tracked), every Tier-3
  surface, the module registry, and both composed-prompt pins.
- The bytes any FIRST fetch returns, anywhere.

## 8. Acceptance

The machinery and its drills are zero-paid (`test:rlm-sandbox` new
section [7]; `buildAgentEnv` unit pins). The measured acceptance is
the Session 28 `est` suite re-run as a paired measurement
(discipline on vs `TRELLIS_EXP_OMIT_RETRIEVAL=1`), owner-gated
propose-with-estimate, criterion recorded in the roadmap BEFORE any
spend: repeat-fetches 0 by construction on the disciplined arm, tokens
≤ baseline, correctness non-inferior — calls and correctness reported
TOGETHER, never calls alone (the Session 28 symmetric rule: never
reward LOW counts either).
