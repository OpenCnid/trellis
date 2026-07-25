# The response artifact — what a query produces

**Status: DOCTRINE stated by the collaborator (Matt) July 24, 2026; framing repairs AUTHORIZED by
the owner (Cnid) the same day. The findings in §3 are AUDITED AND UNRESOLVED — nothing in them is
authorized, and §5 says so explicitly.**

This record exists because the mechanisms were shipped and the frame was not. Every individual rule
below is already written down somewhere in this repository, and a reader can honour all of them and
still narrate Trellis as a system that reads a corpus. That happened, in this repository, on the day
this record was written — which is the evidence that the scattered form was insufficient.

---

## 1. The doctrine

**The worker never works with gigabytes at a time. It answers questions *about* gigabyte contexts.**

- **It reads slices intelligently — explicitly not everything.** The collaborator named the reason:
  *"Your current training goal is to read everything. This will explicitly not read everything."*
  The disposition being corrected for is exhaustive reading, and it is the model's default, not an
  occasional lapse.
- **Its job is not to regurgitate.** It never emits text to the orchestrator and calls itself done.
- **Every query builds a response artifact:** a derived deliverable — a spreadsheet, a PDF with a
  chart, a slide deck, text with an illustration, most often plain text. **Not one output.**
  Composed over several turns and multiple slices, *"without extracting more than needed."*
- **Bulk quotation is composed, never read.** If gigabytes of text must appear in the deliverable,
  the model composes the record **programmatically** and hands it to the artifact wholesale. It never
  reads five hundred slices to do it.
- **For code editing, the repository is the response artifact.** The write is the deliverable; the
  submitted string is a receipt.

This is [CODE_MEDIATED_TEXT.md](CODE_MEDIATED_TEXT.md) applied one level up. That record fixes how
bytes move — the engine computes positions, the engine splices, the model supplies addresses. This
one fixes **what a turn is for**, and the two share a consequence: *the model is never the
transport.*

**The tell.** Any sentence that computes how much of a corpus fits through the model — "N round
trips per GB", "the model loads the corpus", "reads the whole X" — is treating the model as the
transport. That arithmetic describes an operation this architecture does not have. One such sentence
was written into `src/repl_sandbox/config.py` and `REPL_SANDBOX_CONFORMANCE.md` §2.3 on July 24, 2026
and repaired the same day; it is quoted here because the author had just finished ratifying the
layering it contradicted.

## 2. What already holds it

The mechanisms ship. This is not an aspiration record.

| mechanism | what it holds | where |
|---|---|---|
| `trellis_answer.submit` | Refuses a **bare literal** by `ast.parse` — an expression referencing no REPL state is a retyped literal. Structural, not advisory. | `src/rlm/trellis_answer.py` |
| Handles, not payloads | The corpus never enters the guest; the algebra is handle-in / handle-out and crosses no content. | [REPL_SANDBOX_DATA_MODEL.md](../product/repl-sandbox/REPL_SANDBOX_DATA_MODEL.md) §4, §5 |
| By-reference sink (one of two) | `llm_query(context=[H])` resolves host-side; its `context` slot is typed `Handle` so a string does not fit. *"Prefer by-reference sinks; `materialize` is only for when the model itself must compute over the bytes."* **The answer-side twin, `answer.submit(H)`, is documented in two records and does not exist** — see §4. | same, §6 — titled **The bounded materialisation exception** |
| `locate` / `lines` | Query for an address; read a bounded slice. *"the model queries for a location, it never counts lines."* | `src/rlm/trellis_textedit.py` |
| Workspace index/segment | `read()` returns the index and **never** contents; a segment is a deliberate pull. | `src/rlm/trellis_workspace.py` |
| MCP capture | External results are captured mechanically; the model receives a stub with a preview. Harness-guaranteed, not model discipline. | `src/rlm/trellis_mcp.py` |
| `concat_files` | Builds sub-LLM buffers as one string *"instead of printing file contents through the REPL output cap"* — compose-and-hand-off, shipped. | `src/rlm/trellis_scaffold.py` |
| `trellis_upsum.commit` | Measures running state engine-side and refuses over budget with a per-key breakdown, so the model compresses against engine-computed numbers. | `src/rlm/trellis_scaffold.py` |
| Orchestrator routing | *"Route working state by reference, never by paraphrase."* | `src/core/agent/orchestrator_prompt.ts` |

## 3. Where the system pulls the other way

Audited July 24, 2026 by four read-only sweeps over `docs/architecture/`, the prompt surface, the
REPL-sandbox record set, and the runtime. **Findings only.** Each names a surface; none is a change
this record makes.

### 3.1 The incentives point at one big read

- **The retrieval budget meters calls, not bytes.** `_held["fetches"] += 1` fires once per successful
  call at all three surfaces (`src/rlm/trellis_tools.py`). Sixty-four fetches buys sixty-four whole
  documents exactly as readily as sixty-four paragraphs, so a model optimising against the budget
  **maximises bytes per fetch**. The per-root dedup on `get_ast_blocks` sharpens it: one read of a
  document, ever — under-fetching is unrecoverable, over-fetching is free.
- **`ITERATION BUDGET` instructs the opposite of composition.** The kernel tells the worker it has
  *"very few REPL turns"*, to combine loading and computing into **one** block, and not to *"spend a
  turn on tiny exploratory prints"* — against a `--max-iterations` default of **5**. The doctrine
  wants an artifact composed over several turns and multiple slices.
- **No retrieval surface over the corpus has a `locate`.** `get_ast_blocks(root)` returns every block
  of a document with full text and no way to ask for a range. The editing half of the runtime has
  `load` (shape only), `locate` (addresses plus previews, capped) and a 200-line slice cap; **the
  corpus half has neither.** The slice-reading affordance exists, over files, and was never built
  over the substrate.
- **The friction gradient runs backwards.** Disciplined, budgeted, audited reads return JSON strings
  needing `json.loads`; the undisciplined twins return live Python values. `fetch_texts` is public,
  returns a real dict, and is *"NOT counted as a tool call and NOT audited"* — fewer keystrokes than
  the metered path, reachable by `dir()`, and the natural next move for a model that has just hit the
  dedup refusal. `trellis_postgres.conn` is the same gap with no ceiling.

### 3.2 The bytes that reach the model do not carry the frame

- **The word "artifact" reaches no model.** Nor "deliverable", "spreadsheet", "chart", "slide". With
  none of it present, *produce an answer* defaults to what the workflow rules literally say: a string.
- **The default module opens with an exhaustive load.** A default run's only protocol module is
  `spatial-flywheel`, whose first procedural instruction is *"Load the full question catalog in one
  query."* The module that states the discipline cleanly — `workspace-discipline`: *"Index first,
  then pull only the bounded material needed for the current step"* — is `active` but **not in the
  default selection**. The module that teaches stopping — `estimation-discipline`: *"If every required
  operand is bound and the answer is determined, stop searching immediately"* — is `retired` and
  cannot load.
- **Nothing tells an editing run that the repository is the deliverable.** After `write_back`, the
  worker is still told its final answer is a `FINAL_ANSWER` string, with no relation drawn between
  them. It will predictably restate the edit in prose.
- **Two bounds are invisible until they fire.** The 64-per-run retrieval budget and the 64 KiB answer
  cap are unstated in any addendum. The cap's refusal — *"Submit the result, not the corpus."* — is
  the clearest anti-regurgitation sentence in the codebase and the model sees it only after building
  the oversized answer.

### 3.3 Records that state the opposite

- **[TEST_TIME_TRAINING.md](TEST_TIME_TRAINING.md) §12.2 — LISTED HERE IN ERROR, withdrawn
  2026-07-24.** It was read as doctrine holding that large REPL dumps are the intended workload. It
  is not: §12 is a **literature-applicability** analysis, and §12.2 asks whether LaCT's long-context
  results transfer to Trellis. The first draft argued they do *not*, because the RLM keeps the corpus
  out of attention; the owner's correction overturned that — per-run token flow is genuine
  long-context load, **so those results apply here directly**. That is an argument about whether a
  research finding is relevant, not a statement of desired behaviour, and reading the second as the
  first is the error.

  **TTT is a mechanism for rule 24's second sentence, not a counterweight to it.** It targets an
  open-weights model served locally (§7 R3), which does not exist yet — `TRELLIS_RLM_BACKEND` is
  root-agent only and worker transport is explicitly not configurable. Its shape, from the
  collaborator: the harness composes a prompt from internal primitives, the composed prompt **sets
  the mode**, and the model self-plays over REPL data with **properly filtered programmatic slicing
  as the rewarded behaviour**, scored by RLVCG (arXiv:2607.19044). Slice discipline is what TTT pays
  for. Nothing here needs re-adjudication.

- **[REASONING_TEMPLATES.md](REASONING_TEMPLATES.md) §17** gives all eight reasoning modes the same
  out-port, `answer`, and the locked port vocabulary offers no artifact type. `construction` — *"Build
  or modify a file artifact in the edit root"* — routes `write_back` as a mid-flow node and terminates
  at a submitted string. A mode space built from it cannot express a query that produces an artifact.
  The apparatus is catalog text with no kernel behind it yet, which makes this the cheap moment.
- **`REPL_SANDBOX_SPEC.md` §4.2** writes `run_query(sql, params) -> rows`, putting the result set in
  the namespace on the first call. `LEARNINGS` §10c already flagged this exact line on July 23 and the
  correction never reached the record it names.
- **`REPL_SANDBOX_ARCHITECTURE.md` §3** says *"The root worker splits context"* — to split it you must
  hold it. The shipped fan-out names handles and the host splices referents.

## 4. The open design question

**The doctrine's escape hatch is currently closed by the security model, and nothing distinguishes a
large legitimate deliverable from bulk exfil.**

The doctrine says: when gigabytes must be quoted, compose the record programmatically and hand it to
the artifact wholesale. But `answer.submit` sits on the outbound ledger under a cumulative byte cap,
`THREAT_MODEL` prices the channel at `ANSWER_CONTENT_MAX_CHARS` (64 KiB), and
[DATA_MODEL](../product/repl-sandbox/REPL_SANDBOX_DATA_MODEL.md) §6 makes that same ceiling the
quantified exfil-rate residual. Under that reading a wholesale hand-off is not reachable at all.

Worse, the two are presently indistinguishable by construction: `submit("'\n'.join(b['text'] for b in
blocks))` references REPL state, passes the literal check, and delivers 64 KiB of corpus text
engine-rendered and unretyped — **satisfying the pillar exactly while doing what the doctrine calls
regurgitation.** `submit` closes transcription error. It does not close volume.

This is an owner decision, not a wording fix. It probably wants a distinct artifact sink — a
deliverable that is *written* by reference rather than *submitted* as a value, charged against a
different ledger from the exfil residual, with the provenance of its parts intact.

## 5. What this record does not authorize

- **No prompt bytes.** The collaborator's standing is that the doctrine *"will be prompted later and
  enforced"*; authoring those bytes runs under `AGENTS.md` rule 16 and is not opened by this record.
- **No engine change.** Every item in §3 is a finding. The budget's metering, the missing corpus
  `locate`, `fetch_texts`, the iteration budget, and the module selection are each a separate change
  with its own gate.
- **Nothing about TEST_TIME_TRAINING.** §12.2 was listed in §3.3 in error and is withdrawn there;
  it needed no adjudication, because it never said what it was read as saying.

**Reachability, stated rather than implied:** this record has no enforcing surface. Nothing refuses a
wholesale print, no guard couples a decisive step to a bounded read, and the term "response artifact"
reaches no model. It is a frame for work that has not been done, and it should be read as one until a
row in §2 says otherwise.

---

*Siblings: [CODE_MEDIATED_TEXT.md](CODE_MEDIATED_TEXT.md) (how bytes move — this record is its
upper storey) · [RETRIEVAL_DISCIPLINE.md](RETRIEVAL_DISCIPLINE.md) (held state and the per-run budget)
· [WORKSPACE_AND_MODULES.md](WORKSPACE_AND_MODULES.md) §4.3 (thin control channel, fat heap) ·
[REPL_SANDBOX_DATA_MODEL.md](../product/repl-sandbox/REPL_SANDBOX_DATA_MODEL.md) §6 (the bounded
materialisation exception).*
