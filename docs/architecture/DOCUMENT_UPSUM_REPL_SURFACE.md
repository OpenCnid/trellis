# The document-UPSUM REPL surface — Design Record

**Status: DESIGN — PROPOSED July 22, 2026. Nothing built, nothing
authorized.** Owner direction, in session: record the REPL form of
document-UPSUM "in depth and great detail so that it can be
reproduced." This record specifies; it authorizes no build. Two gates
stand above it: `RLM_HARNESS_SCAFFOLDING.md` header (*"Further
increments owner-gated per run"*) and, for any paid probe,
`.claude/rules/spend-and-live-infrastructure.md` rule 7.

**Relationship to the record that owns the family.** The CLI form landed
July 22, 2026 and is recorded at `RLM_HARNESS_SCAFFOLDING.md` §8.6 (The
document surface — UPSUM gets a second caller). That entry states in its
own text that it made *"no change to the REPL surface or to any
composed-prompt pin"* — so the REPL form is **disclaimed by** §8.6, not
covered by it. This record extends §8.6; it does not restate the
transposition table, the section model, or the no-rewrite rule, all of
which §8.6 and `tools/document-upsum/upsum.ts` already settle (`code >
prose`). Retrieve those there.

**Authored under** `prompt-engineering` and `hypershot-protocol`
(Guardrail 15, `.claude/rules/prompt-authoring.md` rule 16), because §7 below contains proposed
addendum bytes.

---

## 0. The one-sentence claim

An RLM run that is editing a governed document can ask the engine what
the document weighs and which of its sections carry that weight —
including the version it has staged but not yet written — instead of
estimating from scrollback.

## 1. Why the CLI form does not already cover this

`npm run upsum` measures a file **on disk**. Inside a run, the object
being authored is a `trellis_textedit` frame: a line list held in
process, carrying staged splices that exist nowhere else yet
(`src/rlm/trellis_textedit.py:336`). The disk file is the *pre-edit*
version for as long as the edit is in flight.

So the CLI can answer "was this document within budget before I started"
and cannot answer "will it be within budget when I write back." The
second question is the one an editing run actually has, and it is
unanswerable today by anything except the model estimating — the posture
`CODE_MEDIATED_TEXT.md` §0 (The pillar) forbids and
`RLM_HARNESS_SCAFFOLDING.md` §8.1 (What was wrong) already had to
repair once for the running state.

## 2. What it measures — the object decision

**It measures a held frame, never a path.** This is the decision the
whole design rests on, and it is what keeps the surface small.

| Candidate object | Verdict | Why |
|---|---|---|
| `trellis_textedit` held frame | **CHOSEN** | Raw file bytes as a line list, `##`/`###` markers verbatim; the engine already computes the total identically (`_frame_bytes`, `src/rlm/trellis_textedit.py:286`); already containment-checked; and it is the only object that can be measured *with staged splices applied* |
| A path on disk | Rejected | Would need a second file-read path with its own containment root, duplicating `_resolve` (`trellis_textedit.py:239`); and it cannot see staged edits, which is the whole point |
| AST extraction blocks | Rejected | Heading **depth is dropped at parse time** (`src/core/ast/parser.ts:57-64`); `##` versus `###` is unrecoverable, so the section model cannot be reconstructed |
| Root-hash reconstruction | Rejected | Concatenates blocks with **unmarked boundaries** by design (`src/rlm/trellis_tools.py:699`); any section split derived from it is a guess |
| Workspace notes | Rejected | No per-note address and no per-note byte record (`trellis_workspace.py:256` accumulates one total) — a refusal could name a size but not *which* note |
| Workspace segments | Rejected | Cross-segment bytes already exist via `read()`; intra-segment structure is not guaranteed to exist at all |

**Consequence, and it is the design's best property: the surface opens no
new file-read path.** It reads frames the run already loaded through the
already-gated, already-containment-checked toolkit. `TRELLIS_EDIT_ROOT`
remains the only route by which a run touches files.

## 3. Gating, and why it costs no pin ceremony

**Gated with `trellis_textedit`.** No frames exist without it, so the
surface has nothing to measure when the toolkit is absent. Injection
therefore rides the existing conditional at
`src/rlm/trellis_agent.py:573-585`, and its addendum is a
`build_*_addendum(x) -> str` returning `""` when the surface is absent —
the mold at `trellis_scaffold.py:665`.

This is load-bearing for cost. Per-run conditional addenda are spliced
into `dynamic_system_prompt` (`src/rlm/trellis_agent.py:611`), which
**no sha pin covers**. A conditional surface therefore moves *neither*
composed-prompt pin, and the recompute ceremony
(`scripts/test_modules.py:119` and `:375`) does not apply. Putting the
same text in `_ADDENDUM_BASE_PREFIX` or `_ADDENDUM_BASE_SUFFIX` would
move both pins and land the text in both experiment arms.

Byte-identical-when-absent is the house invariant here
(`WORKSPACE_AND_MODULES.md` §4.7, `STRUCTURAL_SPLICE.md` §9.2), pinned
as an exact sorted key list per construction combination
(`src/rlm/trellis_scaffold.test.ts:241-261`).

## 4. The surface

Three methods, transposing `TrellisUpsum` (`trellis_scaffold.py:137`)
onto frames. Method names are invariant vocabulary; every value below is
a placeholder.

    trellis_docupsum.size(relpath)
      Non-raising probe. Returns the engine-computed byte total of the
      frame AS CURRENTLY STAGED. Never counted as a refusal — probing
      before committing is the taught behavior (the size/commit split,
      RLM_HARNESS_SCAFFOLDING.md 8.2).

    trellis_docupsum.measure(relpath)
      Returns a JSON string: total, preamble bytes, and one entry per
      section with its byte count and its subsection roll-up, ranked
      largest-first. Shape-validates before measuring.

    trellis_docupsum.check(relpath, budget)
      Measures and REFUSES over budget, raising with the per-section
      sizes largest-first. Returns a receipt on success: size, budget,
      headroom, section count.

**Return-type convention.** All three return JSON strings, not Python
objects: they are bounded structured listings the model reads, which is
the `locate()` mold (`trellis_workspace.py:17`). The S3 helpers return
plain Python because their output feeds code
(`trellis_scaffold.py:46`); this surface's output feeds a decision.

**The budget is always an argument.** There is no in-REPL default and no
contract lookup. A spawned research run has no guaranteed access to
`tools/repository-surface/root-contract.json`, and inventing a number in
the Python module would be the encoded default instance rule 17 forbids
— the same call §8.6 already made for the CLI. Where a caller wants the
governed number, the operator passes it in the task text, which is
verbatim and verifiable (`trellis_task.text()`).

**Two typed refusals, counted separately** (shape validation runs before
measurement, so one folded counter would under-report whichever raised
first — rule 11, and the reasoning at `trellis_scaffold.py:158`):

- `DocFrameShapeError` — the frame has no `##` sections, so there is
  nothing to rank. A bare total is what `check:repo-surface` already
  gives; this surface exists to add the ranking.
- `DocFrameBudgetError` — over budget, message carrying total, budget,
  overage, and per-section sizes largest-first.

## 5. What it gates, stated honestly

**It informs; it does not gate.** `write_back` is unchanged and will
still write an over-budget document. Nothing forces a run to call this
surface at all, exactly as `verify()` informs without gating
(`RLM_HARNESS_SCAFFOLDING.md` §8.3) and `citable()` is never a gate (§4,
the Session 35 invariant).

Coupling `write_back` to a budget check is a **separate, behavior-changing
proposal** that would move the pinned textedit surface, and under
`STRUCTURAL_SPLICE.md` §9.3 it belongs to its own increment. It is named
here so a future session does not mistake this record for authorizing
it.

## 6. Telemetry

    docupsum_measures        probes and measurements performed
    docupsum_checks          budget checks performed
    docupsum_shape_refusals  frames with no measurable structure
    docupsum_budget_refusals over-budget refusals

Counts only, never a path, a section title, or document content
(`trellis_textedit.py:827`; `WORKSPACE_AND_MODULES.md` §4.8). Spread
into the run summary at the single emission point
(`trellis_agent.py:675`), with a zeros-dict fallback when the surface is
absent so the key set does not vary by configuration.

**Do not claim these are observable in production.**
`HARNESS_SELF_MODEL.md` §10.2 (Finding 1) establishes that
`parseTelemetryLine` builds an explicit named-field result and silently
drops everything else — the existing `upsum_*` counters already fail to
reach a worker-path consumer, and this is unremediated (§10.3 is "Not
authorized by this section"). These counters will be visible in raw
stdout and in direct-spawn drivers only, until Phase 0a lands.

## 7. Proposed addendum bytes

Conditional, spliced per run, brace-free. **No literal `{` or `}` may
appear** — `rlms` runs the composed prompt through `.format()`
(`rlm/utils/prompts.py:228`), so a stray brace raises `KeyError` or
`IndexError` at prompt-build time on a paid run. The `dict(...)`
constructor idiom is the house workaround (`trellis_agent.py:220`).

    DOCUMENT SIZE (WHEN EDITING A BUDGETED FILE): the engine measures the
    frame, you never estimate it. trellis_docupsum.size(relpath) returns the
    staged byte total; trellis_docupsum.measure(relpath) returns the
    per-section ranking largest-first; trellis_docupsum.check(relpath, budget)
    refuses over budget and names which sections carry the weight. Measure the
    STAGED frame before write_back, not the file on disk - the disk still
    holds the pre-edit version. When a check refuses, compress the sections it
    names, in order, and check again. Do not compress by eye.

**Note the ASCII hyphen** in "disk - the disk". The records say the
addenda are ASCII (`RLM_HARNESS_SCAFFOLDING.md` §7); in fact the live
kernel already contains em dashes and nothing enforces ASCII, while
every spawn path does set `PYTHONIOENCODING=utf-8`
(`src/workers/rlm_job.ts:177`). The real constraint is the encoding on
the spawn path, not the character set — recorded here because the prose
constraint and the enforced one differ, which is itself the defect class
`CODE_MEDIATED_TEXT.md` §2 names.

## 8. Reproduction — the ordered build checklist

Each step cites the convention that requires it. Nothing here is
authorized; this is what the work would be.

1. **`src/rlm/trellis_docupsum.py`** — stdlib-only at module scope, so
   the unit battery can spawn it inside plain `npm test` (the
   `trellis_blocks` precedent, `trellis_scaffold.py:63-69`). Holds the
   two exception classes, the measurement, and `build_docupsum_addendum(x)`
   returning `""` when absent.
2. **Reuse the frame, do not re-read the file.** Take the `trellis_textedit`
   instance by injection and read `frame["lines"]`; measure with
   `len("\n".join(lines).encode("utf-8"))` so the total agrees with
   `_frame_bytes` (`trellis_textedit.py:286`) exactly.
3. **`src/rlm/trellis_agent.py`** — import at top level (module-level
   import failure kills the process before spend, which is the intended
   fail-fast); construct **per run** inside the existing
   `if edit_root and edit_root.strip():` block so counters are
   run-scoped (`trellis_agent.py:505-510` states the rule); add
   `custom_tools["trellis_docupsum"]`. Check the key against
   `RESERVED_TOOL_NAMES` (`rlm/environments/base_env.py:13`) — the eight
   reserved names are `llm_query`, `llm_query_batched`, `rlm_query`,
   `rlm_query_batched`, `SHOW_VARS`, `answer`, `context`, `history`.
4. **Addendum term** in `dynamic_system_prompt` (`trellis_agent.py:611`),
   NOT in the static prefix/suffix. Authored under Guardrail 15.
5. **`scripts/check_python_runtime.py`** — add the new file to
   `PYTHON_FILES` and the import list, or the offline syntax/import
   smoke check does not cover it.
6. **`scripts/test_scaffold_unit.py` + `src/rlm/trellis_scaffold.test.ts`**
   — the zero-paid battery, the only pin that runs in plain `npm test`.
   Emit fields into the single `out` dict (`:253`) and assert
   field-by-field. Required assertions, each from an established
   convention:
   - byte conservation: preamble + sections = frame total, on LF **and**
     CRLF (the CLI's core pin, `tools/document-upsum/upsum.test.ts:29`);
   - ranking genuinely sorted descending;
   - a refusal list where **every** malformed shape raised, not one
     (`trellis_scaffold.test.ts:37`);
   - whole-dict `toEqual` on telemetry, so a new counter cannot appear
     unnoticed (`:102`);
   - gated-off addendum is `""`, gated-on is exactly the constant, both
     brace-free (`:264-274`);
   - the measure is invariant under staged-splice ordering, mirroring
     the canonical-serialization pin (`:74`).
7. **Parity pin against the TypeScript authority.** Two implementations
   of one section model will drift. The house has exactly one precedent
   — `trellis_blocks.py` pinned by `src/core/ast/block_parity.test.ts`,
   with TypeScript declared the authority — and this surface owes the
   same: spawn Python over a fixture document and assert its section
   ranking equals `measureDocument`'s from `tools/document-upsum/upsum.ts`.
   Without it, `npm run upsum` and the REPL can disagree about the same
   file.
8. **`scripts/test_rlm_sandbox.py`** — a numbered section adding the
   static seam pins: positive on `trellis_agent.py` (the exact injection
   expression, `:933`) and negative on the new module — it must contain
   none of `_retrieved_addresses`, `_audit_add`, `_held`,
   `_count_tool_call` (`:951`). This is what keeps the surface out of
   the provenance path.
9. **A `--negative-control`, and a decision about where it lives.**
   `.claude/rules/measurement-and-reporting.md` rule 19(c) requires one; healthy exit is **3**, absorbed
   is 1. **No Python drill in this repository ships one today** — the
   convention exists only in four `scripts/test_*.ts` drills and two
   `tools/*/cli.ts` entrypoints. So this surface either establishes the
   Python precedent or carries its control on the TypeScript side of the
   battery. That choice belongs in this record, and it is left **open**
   for the owner (§10).
10. **Name the non-test caller** (`AMBIENT.md` rule 15). For a REPL
    surface the caller is the injection expression in
    `trellis_agent.py`'s `custom_tools`, pinned by step 8 — not an npm
    script. State it plainly rather than implying an entrypoint exists.

## 9. What this must NOT do

- **Never rewrite.** Compression is an authoring act under Guardrail 15
  (`RLM_HARNESS_SCAFFOLDING.md` §8.6). The engine computes; the author
  edits.
- **Never acquire provenance standing.** Frame bytes are Tier-3-class
  and never join the retrieved-address set
  (`PROVENANCE_THREADING.md` §3.2). Do not increment the database
  tool-call counter — a non-database surface that did would let a
  zero-provenance answer pass the `TRELLIS_PROTOCOL_VIOLATION` check
  (`trellis_agent.py:702`).
- **Never open its own database or file handle.** Frames arrive by
  injection, exactly as `citable` reaches Postgres only through the
  injected instance.
- **Never ship as a module.** Both loaders refuse a manifest with a
  non-empty `tools` list (`trellis_modules.py:104`,
  `src/config/modules.ts:55`). A REPL surface is a kernel change.
- **Never be validated by a with/without baseline.** Barred by
  `.claude/rules/measurement-and-reporting.md` rule 20 and `HARNESS_SELF_MODEL.md` §11. Zero-paid
  reachability and parity are permitted; a paid adoption probe is
  separately gated under rule 7.

## 10. Open — owner decisions this record does not make

1. **Whether to build at all.** Nothing above authorizes it.
2. **Where the negative control lives** (step 9): establish the Python
   precedent, or carry it on the TypeScript battery side.
3. **Whether the model may shadow the surface.** Non-callable entries
   land in REPL `locals` (`rlm/environments/local_repl.py:236-242`), and
   `_restore_scaffold` (`:514`) restores only reserved names — so a
   model that rebinds `trellis_docupsum` loses it for the rest of the
   run. Exposing the methods as `globals`-resident closures through
   `build_scaffold_helpers` instead would make them un-shadowable. The
   existing `trellis_upsum` carries the same exposure and has not been
   ruled on.
4. **Whether the surface survives the sandbox migration.**
   `REPL_SANDBOX_ARCHITECTURE.md` §3 ratifies a guest that holds
   *handles, not payloads*. A surface returning computed sizes and
   section titles is metadata, not payload, and so appears
   sandbox-compatible — but the frame it reads is in-guest file bytes,
   and no record says what happens to in-guest file readers at
   migration.

## 11. Honest scope

This record specifies a surface that does not exist. Every convention it
cites was read from code this session; every claim about what the code
does carries an address. No behavior claim attends it: the pins it
proposes would prove reachability, byte conservation, refusal, and
cross-language parity — never that a model uses the surface or is
helped by it. Whether an RLM actually reaches for a measurement it has
been given is a paid-adoption question, separately gated, and a
zero-paid drill would record the script author rather than the model.
