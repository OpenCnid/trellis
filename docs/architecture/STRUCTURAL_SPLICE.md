# Structural Splice Addressing — the design record

Status: RATIFIED in-repo, Session 41 (July 13, 2026). Written BEFORE
implementation (the row-9/10/12 document-first mold). The measured
verdict for the increment this record scopes is §8.

This record decides the mechanical closure of the **retype-splice
neighbor-deletion** failure class in the editing toolkit
(`src/rlm/trellis_textedit.py`), the recorded prerequisite for any
executable-class stage-2 self-edit increment
(`docs/benchmarks/REPOSITORY_INGESTION_REPORT.md` §5f.5 named the
class; `STRUCTURAL_CHUNKING.md` §8 named this candidate;
`CODE_MEDIATED_TEXT.md` §1 names the underlying pathology). It is a
toolkit-contract decision, not a chunking decision, so it gets its own
document.

## 1. The failure class and its observed instances

**Definition — retype-splice neighbor deletion:** a `splice(relpath,
start, end, new_lines)` call whose window `[start, end)` covers lines
the model intended to KEEP, with the kept lines re-typed (or silently
dropped) inside `new_lines` instead of left outside the window. The
removed span is only an index pair; nothing in the call states WHICH
bytes the model believes it is removing, and nothing constrains the
window to the lines actually changing. Existing bytes pass through
attention — the exact pathology `CODE_MEDIATED_TEXT.md` §1 names (the
model never copies).

Two live instances, both from owner-approved paid stage-2 runs, both
caught only at human `git diff` review, both preserved as reverted
patches (`benchmark_logs/session36_run1_failed_diff.patch`,
`benchmark_logs/session37_run2_failed_diff.patch` — gitignored, local
to their session worktrees; the committed narrative is
`REPOSITORY_INGESTION_REPORT.md` §5e/§5f.5):

1. **Session 36 run 1 (address drift).** Hunk B's splice range covered
   the WRONG lines — the model's belief about what sat at
   `[start, end)` had drifted from the frame. The write landed, the
   stale line survived below the replacement, and the file was left
   syntax-broken. The Session 37 parse gate now detects this instance
   class post-run; nothing prevents it at the call.
2. **Session 37 run 2 (neighbor deletion, parseable).** The window was
   at the right site but 6 lines wide for a 2-line change; the model
   hand-retyped all 6 as `new_lines` and the retype dropped two
   neighbors — the executable
   `"retrieved_addresses": get_retrieved_address_count(),` line and a
   comment head. The file still PARSED; the parse gate, the scope
   check, and the evidence chain were all structurally blind. The
   Session 39 comment-class diff gate detects exactly this shape
   post-run, but ONLY for increments declared comment-class;
   executable-class edits have no mechanical detection and no
   prevention — which is why they are sequenced behind this record.

The Session 39 retry landed first-shot by TASK DISCIPLINE (splice
minimal span + coded neighbor assertions). The permanent owner
direction (Session 28) is that behavioral failure classes close by
TOOLING SHAPE. This record is that closure.

## 2. The decision space

Four candidate engines were enumerated for syntax-aware or otherwise
guarded splice addressing, weighed against three standing fences: the
Session 29 static import-allowlist pin (`test:textedit` [13]:
stdlib-only exact import set, no `subprocess`, no git tokens — the
pins never weaken regardless of engine), the Session 20 containment
contract (every path strictly inside `TRELLIS_EDIT_ROOT`; the toolkit
self-contained in one process), and the pillar itself.

### 2.1 Python stdlib `ast` — REJECTED

Parse the held frame with `ast.parse` and offer construct-granular
addresses ("the docstring of function X spans lines [a, b)").
Stdlib-only, so the allowlist pin survives. Three defects:

- **`ast` cannot see comments.** Comments are not AST nodes; both
  observed instances were comment edits. The engine would be blind to
  the exact class it exists to close. (`tokenize` sees comments but
  yields a token stream, not construct spans — rebuilding construct
  addressing over it is a bespoke parser by another name.)
- **`.py`-only.** The toolkit edits any UTF-8 text file; a
  grammar-shaped guard silently covers a subset and the honest-scope
  rule would force a "guarded for .py, unguarded elsewhere" split
  surface.
- **Parse-guarding the staged frame is already known-blind:** the
  Session 37 run-2 file PARSED. A syntax check at splice time is the
  parse gate moved earlier, and the parse gate measurably does not see
  this class.

### 2.2 `py-tree-sitter` — REJECTED (revisit trigger recorded)

Comment-aware, multi-language, and the TS side already pins the same
grammar family (Session 38). But it is a NATIVE WHEEL: adopting it
widens the Session 29 import allowlist and adds a runtime/platform
surface to the one file whose static pins are the toolkit's security
posture. The widening is a recorded owner-visible decision by
standing rule — and it buys nothing the failure class needs: neither
observed instance was a construct-identification failure. Both were
byte-identity failures (the model's belief about the removed bytes
diverging from the frame). Byte-identity is checkable without a
grammar, exactly. **Revisit trigger:** a future increment that needs
construct-granular ADDRESSING (e.g. "replace the body of function X"
where content queries cannot express the target) re-opens this
decision as its own owner-visible record.

### 2.3 An engine-side structural service — REJECTED

Let the existing TypeScript tree-sitter engine compute construct
spans and serve them to the toolkit. This violates the process
boundary the toolkit deliberately lacks an IPC surface for (Session 20
containment: one process, no sockets, no subprocess), and it has a
correctness hole the pillar forbids: spans computed engine-side go
STALE the moment a staged splice moves lines — a persistent positional
mirror of mutating state, the T13 anti-pattern applied to working
memory.

### 2.4 Parser-free anchor guards — CHOSEN

No grammar at all. The guard is the frame's own bytes: every guarded
operation carries the model's EXPLICIT statement of the bytes it
believes it is removing (or inserting beside), and the engine verifies
that statement against the frame byte-exactly BEFORE staging, refusing
on any divergence. "Structural" resolves to the structure the toolkit
already owns — the line structure of the held frame — rather than a
grammar: total over every text file, exact rather than heuristic,
zero new imports, zero allowlist motion, zero process-boundary motion.
This is the industry's anchored-`str_replace` meta (named in
`CODE_MEDIATED_TEXT.md` §1 origin item 3) done REPL-native: the
anchor is verified by the engine, and a mismatch is a typed teaching
refusal the REPL loop can self-correct on.

## 3. The surface: the guarded splice family

Three ADDITIVE methods on the existing `TrellisTextEdit` holder (the
injection mold — `splice` and every existing method keep byte-identical
signatures and semantics for current callers). Each stages into the
same frame machinery as `splice` (same budgets, same `pendingSplices`
accounting, same `diff`/`revert`/`write_back` path — `write_back`'s
hash guard and Session 29 hardening are untouched). Each verb names
exactly the lines it touches; neighbors are outside the operation by
construction.

### 3.1 `replace_lines(relpath, start, end, expected_lines, new_lines)`

Replaces the half-open window `[start, end)` — but only after the
engine verifies `frame[start:end] == expected_lines` byte-exactly.

- `expected_lines` and `new_lines` are lists of newline-free strings
  (the `splice` mold; a `"\r"` stays an ordinary byte within a line).
- `len(expected_lines)` must equal `end - start` (refused with the
  counts named, before any comparison).
- `expected_lines` empty is refused: a pure insertion belongs to
  `insert_lines`. `new_lines` empty is refused: a pure deletion
  belongs to `delete_lines`. The verbs stay honest so the telemetry
  and any future criterion can reason about intent.
- **The anchor check:** any divergence between `expected_lines` and
  the frame raises `AnchorMismatchError`, naming the first divergent
  index with bounded previews of expected vs actual, and teaching the
  remedy: re-run `locate()`/`lines()` and re-derive — never retype
  from memory. Nothing is staged.
- **The minimality rule:** if `expected_lines` and `new_lines` share a
  common leading or trailing line, the call is refused as over-wide —
  a shared edge line is PROOF the window includes an unchanged
  neighbor, and the refusal message computes and names the narrowed
  `[start', end')` call that would be minimal. (A shared edge is
  provably removable, so the refusal never blocks a legitimate edit;
  it converts a retype of an unchanged neighbor into a teaching
  correction.)

### 3.2 `insert_lines(relpath, at, new_lines, anchor_before=None, anchor_after=None)`

Inserts `new_lines` at index `at` (lines shift down; nothing is
removed, so nothing can be dropped — by construction). At least one
anchor is REQUIRED: `anchor_before` is the expected full text of line
`at - 1`, `anchor_after` of line `at`. Each supplied anchor is
verified byte-exactly (`AnchorMismatchError` on divergence);
`anchor_before` at `at == 0` and `anchor_after` at `at == line_count`
are refused as impossible (no such neighbor exists). The anchor is
what makes an address-drift insertion refusable instead of silent.

### 3.3 `delete_lines(relpath, start, end, expected_lines)`

Removes `[start, end)` after the same byte-exact `expected_lines`
verification (non-empty, length must match). Deletion under the
guarded family is EXPLICIT: the removed bytes are stated in the call
and verified, so a deletion can never be an accident of a retype — it
is a declaration.

### 3.4 Refusal taxonomy (typed, bounded, teaching — the house mold)

- `AnchorMismatchError` (new, module-level): the model's stated bytes
  diverge from the frame. Carries the first divergent index and
  bounded previews (`TEXTEDIT_PREVIEW_CHARS`); teaches re-locate.
  This is the run-1 class refused at the call site.
- `ValueError`: malformed arguments, wrong-verb usage (empty
  expected/new), length mismatch, impossible anchors, and the
  over-wide (minimality) refusal — which names the exact narrowed
  window so the correction is mechanical.
- `TextEditBudgetError`: unchanged semantics; a staged frame over the
  per-file byte budget refuses with usage, staging nothing.

### 3.5 Telemetry (counts only, T16)

`stats()` grows from three counters to five: `textedit_guarded_ops`
(guarded-family calls that staged) and `textedit_raw_splices`
(`splice` calls that staged) join the existing three. The
`trellis_agent.py` telemetry fallback dict grows the same two keys
zeroed; the Node scanner tolerates additive fields (recorded, pinned).
The counters are the lever a future executable-class criterion can
pre-state: **a guarded-only run is `textedit_raw_splices == 0`** —
mechanically checkable from the telemetry line, no checker change.

### 3.6 The prompt addendum

`TEXTEDIT_ADDENDUM` (injected only when the toolkit is injected;
brace-free) gains one bullet per new method and one rule line:
prefer the guarded family for every edit — state the bytes you
remove, keep neighbors outside the window. The composed-prompt pins
do not move: the addendum is gated behind `TRELLIS_EDIT_ROOT` and is
not part of the pinned composed default prompt (`test:modules` [4]/[7]
verified unchanged in §8).

## 4. What this PREVENTS vs what it only DETECTS (honest scope)

Per the §5e.2 tradition, stated before implementation:

**Prevented at the call (refusal before staging):**

- **Address drift (the Session 36 run-1 instance):** a window whose
  actual frame content diverges from the model's belief refuses via
  `AnchorMismatchError`. The wrong-lines write cannot stage.
- **Unchanged neighbors at the window edges (retyped identically):**
  the minimality rule refuses the over-wide window outright and names
  the minimal one.
- **Silent deletion outside the stated removal set:** impossible by
  construction — a guarded operation can only remove lines listed in
  `expected_lines` and verified present; `insert_lines` cannot remove
  anything.

**Converted from silent to explicit (NOT prevented):**

- **A kept-line dropped INSIDE a declared removal window (the exact
  Session 37 run-2 shape driven through `replace_lines`):** if the
  model lists the executable neighbor in `expected_lines` (verified,
  passes) and omits it from `new_lines`, the call stages. What
  changed: the removal is now a byte-exact DECLARATION in the
  transcript — `expected_lines` is a removal manifest human review
  and any future diff-side check can read — where `splice` removed
  those bytes as an unstated side effect of an index pair. The drill
  pins this staging behavior deliberately (§6), so the residual is
  measured, not denied.

**Unchanged residuals:**

- Raw `splice` remains callable (compatibility; existing callers and
  drills are pinned byte-identical). The lever for future increments
  is the criterion, not the contract: pre-state
  `textedit_raw_splices == 0`.
- Everything `write_back` already documents (the narrowed TOCTOU
  window) is untouched.
- The guarded family constrains REMOVAL, not authorship: wrong NEW
  text (a bad comment, a wrong constant in an authored line) is task
  semantics, exactly where §5e.2 left it — human review reads the
  diff.

## 5. Increment sequencing this record unblocks

The row-11 executable-class prerequisite is this record plus its
landed machinery. The recorded shape for the next ladder increment
(a NEW proposal with its own estimate when a real target exists —
never manufactured): task text requires the guarded family only;
criterion adds `textedit_raw_splices == 0` (from telemetry) to the
standing five items; the four checker layers and human review are
unchanged.

## 6. Pre-stated acceptance criterion (the increment landing with this record)

Zero-paid, zero-LLM, all five required:

1. The guarded family lands ADDITIVE: every pre-existing
   `test:textedit` check passes unmodified except the telemetry-shape
   pin (three counters → five, moved wittingly in the same commit).
2. `test:textedit` grows a guarded-family section in the drill's
   existing molds where: the planted Session 36 run-1 shape (window
   content diverging from the model's belief) REFUSES via
   `AnchorMismatchError` and stages nothing; the over-wide window with
   a retyped unchanged neighbor REFUSES and names the narrowed window;
   the planted Session 37 run-2 shape driven through `replace_lines`
   with a fully-correct removal manifest STAGES (the honest-scope pin,
   asserted deliberately); and the decomposed minimal edit lands with
   the executable neighbor byte-intact on disk.
3. `insert_lines`/`delete_lines` refusal branches each fire on a
   planted violation (missing anchors, impossible anchors, anchor
   divergence, length mismatch, wrong-verb usage) and the happy paths
   compose with `diff`/`revert`/`write_back`.
4. The Session 35 rehearsal gains a guarded arm driving the run's REAL
   sequence (cypher → fetch → guarded edit with one OBSERVED
   anchor-mismatch refusal and self-correction → write_back → the
   Session 31 gated write): `test:selfedit-harness` passes with the
   full checker reporting ZERO findings on the guarded arm and the
   edited file's neighbors byte-intact.
5. The standing gates stay green: `npm test`, the full drill block,
   the Session 29 static pins ([13]: import set unchanged, no
   git/subprocess token), gating byte-identity ([8]/[9]: no toolkit →
   no addendum, byte-identical prompt), and both composed-prompt pins
   unmoved.

## 7. What does not change

`splice`'s signature and semantics (including the "\n"-only refusal);
`write_back`'s hash guard and Session 29 hardening; load/lines/locate/
diff/revert/drop; the containment contract; the bounds and their env
twins; the checker's read-only git surface; the toolkit-never-touches-
git rule; counts-only telemetry (the new fields are counts); the
kernel prompt (no composed-pin motion).

## 8. Status ledger and the measured verdict

- July 13, 2026 — record written (this document), BEFORE
  implementation; Session 41, roadmap standing item 10 promoted.
  Cross-referenced from `STRUCTURAL_CHUNKING.md` §8 and
  `CODE_MEDIATED_TEXT.md` §6.1.
- July 13, 2026 (same session) — IMPLEMENTED as designed and the §6
  criterion measured: see the roadmap §5 Session 41 entry for the
  drill counts. Criterion items 1–5 ALL PASS: the run-1 shape refused
  (`AnchorMismatchError`, nothing staged), the over-wide neighbor
  retype refused with the narrowed window named, the run-2 manifest
  shape staged exactly as §4 scopes (the honest-scope pin), the
  decomposed minimal edit left the executable neighbor byte-intact,
  and the rehearsal guarded arm passed the live Session 31 gate with
  the full checker at zero findings.

## 9. The explicit off-switch: guarded-only mode (the July 19, 2026 pass)

**Status: IMPLEMENTED the July 19, 2026 pass, July 19, 2026. Collaborator direction
(M. Murphy), owner-approved the same day.**

### 9.1 The gap this closes

Session 41 built the guarded family and this record scoped it honestly —
§4 is titled "what this PREVENTS vs what it only DETECTS." What neither
the record nor the code said plainly is that the *raw* path stayed fully
reachable: `splice(relpath, start, end, new_lines)` took a bare index
pair with no anchor, no verification, and no way for an operator to
remove it. The preference lived in the addendum ("PREFER THE GUARDED
FAMILY"), which under `.claude/rules/measurement-and-reporting.md` rule 8 is reinforcement, not closure.

The `textedit_raw_splices` / `textedit_guarded_ops` split (§8) was built
so an acceptance criterion could pre-state "a guarded-only run is
`textedit_raw_splices == 0`". That is a **post-hoc measurement of a
choice**, not a guarantee about the tool — and the failure class this
record exists to close could be reintroduced by a model that simply
called `splice()`.

### 9.2 What landed

`TRELLIS_TEXTEDIT_GUARDED_ONLY` (operator environment; constructor
parameter `guarded_only`), parsed by `parse_textedit_guarded_only`:

- **Off by default.** Unset or blank keeps the pre-Session-69 surface,
  telemetry, and prompt byte-identical — the additive rule every operator
  gate in this kernel follows.
- **On:** `splice()` raises `RawSpliceDisabledError` before touching the
  frame, and the refusal names the three guarded replacements and the
  re-derive step. Nothing is staged.
- **Malformed values RAISE** at parse time, before any paid work. An
  operator who misspells a safety switch must never silently receive the
  unsafe default; the accepted spellings are `1/true/yes/on` and
  `0/false/no/off`, case-insensitively.
- **The addendum follows the mode.** In guarded-only runs the toolkit
  text describes the guarded family as the whole surface and names the
  raw path as disabled, so a run is never taught a call that would refuse
  it. The two arms share head and tail exactly and differ only in the
  mode block (pinned); both are brace-free.
- **Telemetry gains `textedit_guarded_only` (bool) and
  `textedit_raw_splice_refusals`.** This is the point of the change for
  evidence purposes: a run summary can now distinguish a run that COULD
  have spliced raw and chose not to from one where the operator removed
  the path. Only the second is evidence about the tool, and before this
  the two collapsed into the same zero.

### 9.3 Honest scope

- **This is an operator gate, not a default.** The class is closed only
  in runs where the operator turns it on. Making guarded-only the default
  is a separate, behavior-changing proposal that would move the pinned
  surface and belongs to its own increment with a measured before/after —
  §4's honest-scope discipline applies to this section too.
- **Guarded-only does not make edits correct.** The family verifies that
  the bytes you *say* you are removing are the bytes that are *there*;
  it has never claimed the edit is the right edit. §4 stands unchanged.
- **No behavior claim attends this change** (guardrail 8). Nothing is
  measured to improve; the off-switch makes an existing closure
  enforceable.

Pinned by `npm run test:textedit` section [15] (13 checks: the refusal
and that it stages nothing, the guarded family unaffected, telemetry
distinguishing mode from behavior, default-off byte-identity, the
addendum swap and its shared head/tail, the env-parsing matrix, and the
malformed-value and non-bool refusals).
