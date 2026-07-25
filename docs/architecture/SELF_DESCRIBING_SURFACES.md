# Self-Describing Surfaces — Composed Intent & Discoverability — Design Record

**Status: RATIFIED — July 23, 2026 (owner, Cnid, in session), on the
collaborator's proposal (Matt / Matthew Murphy). Recorded July 21, 2026 as
PROPOSED from a design exchange out of his MASH engine.** What is ratified is
the **direction and the design**; the build it describes is authorized
separately and scoped by [`HARNESS_SELF_MODEL.md`](HARNESS_SELF_MODEL.md) §12,
which authorized **Workstream B** the same day. **§9 (Ratification) carries
what is ratified, what stays gated, and the honest scope** — read it before
treating any section below as a settled result. Amended only by dated entry,
never by silent edit. This record is the named instantiation of
[`HARNESS_SELF_MODEL.md`](HARNESS_SELF_MODEL.md) Workstream B, and it extends
[`WORKSPACE_AND_MODULES.md`](WORKSPACE_AND_MODULES.md) (the module manifest),
under [`CODE_MEDIATED_TEXT.md`](CODE_MEDIATED_TEXT.md) and
[`COMPOSITION_FROM_PRIMITIVES.md`](COMPOSITION_FROM_PRIMITIVES.md). The buildable
specification — the descriptor schema, the `llm_help` frames, the guard-derivation,
the human-doc generation, and the self-play validation gate — is
[`LLM_HELP_SPEC.md`](LLM_HELP_SPEC.md).

---

## 0. The one line

> **Every Trellis surface — module, tool, function — should carry its own
> description, and that self-description does double duty: it *composes into the
> meta-prompt that signals intent to the model*, and it is *exposed through a
> discoverability surface (`llm_help`) so capabilities are discoverable by
> default* — not wired by hand.**

The two halves are one idea seen from two sides: a surface that describes itself
is both easier to *compose from* (intent) and easier to *find* (discovery).

## 1. Prior art — MASH (collaborator origin)

MASH ([github.com/gusthemole/MASH](https://github.com/gusthemole/MASH),
Matthew Murphy) is a Python "semantic reality engine" on TinyMUSH foundations —
a Streamlit interface, a persistent database layer, and AI integration through
Google's Gemini SDK (`ai_layer.py`). Two of its features are the seed of this
record; the standing of each is marked, because only the README is
independently verified here and the design intent is the collaborator's:

- **Self-documented commands — confirmed in code.** Each command registers
  *with* its metadata: `mash_engine.py:67` declares
  `command_meta: name → {help, category, aliases, usage}` (and `:68`
  `function_meta`), and every command is registered inline with those fields
  (`mash_engine.py:93`: `category='Movement', usage='go <exit>', help='Move
  through an exit'`). Building the command *includes its docs*, so it is
  **discoverable by default** and grouped by category for the help system.
- **The Loom composes prompts from state objects — confirmed in code.**
  `ai_layer.py` carries a **Sensory Loom** (`:32`, "System instructions to
  maintain style and character") and a **Visual Loom** (`:334`, "Converts MASH
  state into a high-fidelity image prompt"); commands pass the object itself as
  context (`mash_engine.py:1466`: `context={'action':'get','object':
  target.to_dict()}`), and a **"bloom"** step has one model compose the prompt
  for another (`ai_layer.py:365`). Intent is signalled to the model *from the
  objects acting on the current function*.
- **`world.json` is the fact-workspace — the collaborator's own mapping.** Matt:
  *"you can think of the help as being part of the REPL, but the `world.json` is
  the fact-workspace in the REPL."* `world.json` is gitignored **runtime** state
  (`.gitignore`), loaded at `mash_engine.py:4504` — the persistent world of
  objects the Looms and commands read and mutate.

Corroborating shapes: a `help [command]` / `help <topic>` system; a
**context-aware sidebar** that, in the README's words, *"monitors your state and
environment to surface relevant tools"*; and a split between **hardcoded kernel
commands** (for speed) and **softcoded, extensible triggers** (`$`/`^` patterns).

Recorded as design vocabulary, unratified — ideas are terrain; the attribution
marks the authority to bind, not possession.

### 1.1 Why the shape transfers — MASH ↔ Trellis

| MASH | Trellis today |
|---|---|
| hardcoded kernel commands / softcoded triggers | **kernel base** / **userspace modules** |
| "alive" sidebar surfaces tools by *state* | *byte-identical-when-absent* — only configured/active surfaces exist in a run |
| `world.json` — the persistent world of objects (the facts) | the **fact-workspace** — the user's data as objects in the REPL (facts = +1 standing / Tier-1 substrate) *(Matt's mapping)* |
| help system exposes command metadata (`command_meta`) | **the gap** — no in-REPL "what is here and how do I use it?" |
| the Loom composes prompts from state objects | judges, grounded authoring, and kernel+module composition already compose the meta-prompt; the **SPARK-space internal messaging** thesis (each function-chain composes the next meta-prompt) is the same shape |

The correspondence is close enough that MASH reads less as an analogy than as a
sibling design that already solved two problems Trellis has named but not yet
surfaced.

## 2. Half A — composed intent from objects (the visual-loom analogue)

The principle is **not new to Trellis** — it is the harness self-model's
principle already: *the interior surfaces serve as free meta-prompt composition
primitives*, and the model gets a **composed, bounded read of what the system
expects** (`HARNESS_SELF_MODEL.md` §0). It is already instantiated in several
places:

- **Judges** compose per context from primitives — no default cast
  (`COMPOSITION_FROM_PRIMITIVES.md`).
- **Grounded authoring** composes an authoring context from a fixed, promoted
  corpus (`GROUNDED_AUTHORING.md`).
- The **kernel + module** composition builds the system prompt, hash-pinned.
- The **SPARK-space internal messaging** thesis: each chain of each internal
  function composes the meta-prompt for its next operation (the product-thesis
  block in the density-trellis; `docs/density-chain/DENSITY-CHAIN.md`).

**What MASH adds is a discipline, not a new runtime path:** *each object is
responsible for its own contribution.* An object acting on the current function
emits a bounded fragment describing what it expects and offers *at this decision
point*, and the harness composes those self-descriptions — by code, never by the
model — into the intent signal. Half A is therefore the harness self-model's
"composed, bounded read" **made per-object and systematic**, with the object,
not a central author, owning its fragment.

## 3. Half B — self-documenting surfaces & `llm_help`

### 3.1 The gap today

Modules already carry a one-line `purpose` (`modules/*/module.json`), so they
are *partially* self-documenting. What is missing:

- No `whenToUse` (the intent/state that selects a surface), no `exposes` (what
  it adds), no bounded usage sketch.
- **No runtime discoverability surface at all.** The RLM learns its tools only
  from the composed system prompt; there is no in-REPL "what is available, and
  how do I use it?" — no help function. MASH has one; Trellis does not.
- **Human-side, discoverability is wired by hand.** This session's density-trellis
  had to be *manually* pointed to from `AGENTS.md`, `docs/README.md`, and
  `ORIENTATION.md`; a surface that described itself would make that automatic.

### 3.2 Extend the manifest — discoverable by default, *enforced*

Additive `module.json` fields (and the analogous descriptor for kernel tools) —
field names are the invariant vocabulary; the values below are placeholders,
not examples:

```jsonc
{
  "purpose":   "{One_Clause_What_This_Surface_Is}",          // exists today
  "whenToUse": "{The_Intent_Or_Run_State_That_Selects_It}",  // proposed
  "exposes":   ["{Named_Behavior_Or_Tool_It_Adds}"],         // proposed
  "example":   "{One_Bounded_Usage_Sketch_Carrying_No_Provenance}", // proposed
  "seeAlso":   ["{Sibling_Surface_Name}"]                    // proposed
}
```

"Discoverable by default" is **enforced by tooling shape, not requested by
prose** (rule 8): a surface whose descriptor is missing a required field fails
validation — exactly MASH's move, *building the command includes its docs*. The
`example` field must carry no `sourceNodeIds`/hashes (it is documentation, never
provenance) and is scanned like any authored draft.

**MASH's shipped precedent** is precisely this: `command_meta: name → {help,
category, aliases, usage}` (`mash_engine.py:67`) is bound at the *same call site*
as the handler (`register_command(...)`, `mash_engine.py:306`), so a command
cannot exist without its doc fragment — *one call site, one commitment*. The map
across: MASH `help` ↔ Trellis `purpose`; `usage` ↔ `example`; and `category`
groups surfaces for the alive catalog (recommended to adopt). And it is
**enforcement-ready today**: `ModuleManifestSchema` is already `.strict()`
(`src/config/modules.ts`), so adding required descriptor fields is a schema
extension, not new machinery.

### 3.3 The surface — `llm_help`, a kernel builtin

A REPL-injected function, a sibling of `trellis_workspace` / `trellis_mcp`,
**always present** so discovery is always reachable (*correct ≠ reachable* argues
against making the discovery surface itself opt-in):

- **`llm_help()`** — the *alive catalog*: only the surfaces **active in this
  run** — the kernel tools, the selected modules, MCP tools iff configured, the
  workspace / textedit toolkit iff enabled — each self-described. This is MASH's
  "alive" sidebar and Trellis's byte-identical-when-absent, seen from the model's
  side: you can only discover what is actually there.
- **`llm_help("{Surface_Name}")`** — the full account for one surface: its
  descriptor fields **plus the guard-derived expectations** — because *the same
  code that refuses is the code that explains* (`HARNESS_SELF_MODEL.md` §2), so
  the "expects" line cannot drift from what the engine actually enforces.

The per-surface return is a frame, not free text (a hypershot — the shape is
fixed, the slots vary per surface):

```
{Surface_Name} — {purpose}
  use when: {whenToUse}
  exposes:  [{Named_Behavior}, ...]
  expects:  {Bounds_Derived_From_The_Guard_Predicates_Not_Stale_Prose}
  see also: [{Sibling_Surface}, ...]
```

The `expects` line is **derived and composed by code**, never authored by the
model — the code-mediated-text pillar and the harness self-model both bind here.
**Source of truth (owner-resolved):** the guard-derived account is authoritative;
on a *legitimate stalemate* with a human-authored descriptor, the human wins (the
user is the domain authority). Why guard-derivation is the load-bearing move — a
concrete instance from the prior art itself: MASH's `@mind` command documents
`'…(Wizard only)'` as *authored prose* (`mash_engine.py:175`) while the actual
gate is a separate `if not agent.wizard` check (`mash_engine.py:3272`). They
agree today, but nothing binds them; deriving `expects` from the guard is the
correction that makes that drift **structurally impossible** — a fix *on top of*
MASH, not a copy of it.

### 3.4 It closes the discoverability gap in general

A self-describing surface is discoverable *by construction*: the RLM finds it
through `llm_help`, and the **same** descriptor + guard-derivation can generate
the human-facing navigation pointers — the density-trellis wiring we did by hand
this session becomes generated output of one source of self-description, two
audiences. Discoverability stops being a manual maintenance chore and becomes a
property of the component.

## 4. Where it sits in the existing machinery

- **`HARNESS_SELF_MODEL.md`** — `llm_help` is a concrete instantiation of
  Workstream B (the surface-descriptor convention). This record proposes its
  shape; the self-model's §8 gate governed whether and when it is built, and
  §12 (July 23, 2026) opened it for Workstream B only.
- **`WORKSPACE_AND_MODULES.md`** — additive manifest fields only; *capabilities
  are beliefs* is unaffected, because doc-metadata carries no provenance.
- **`CODE_MEDIATED_TEXT.md`** — the catalog and the `expects` account are
  composed by code, never re-typed or invented by the model.
- **`COMPOSITION_FROM_PRIMITIVES.md`** — the catalog is the run's *actual cover*,
  composed per context; there is no default cast of "available tools."
- **`GROUNDED_AUTHORING.md`** — if a module's descriptor is drafted by the RLM,
  it goes through the grounded-authoring mold (harness-pinned), like any addendum.

## 5. Acceptance shape — the rule-20-safe half

*Written before sequencing, so the build would inherit the right gate. The
build was authorized July 23, 2026 (§9); this section is now the acceptance it
inherits, unchanged.*

- The manifest schema and `llm_help` surface are **deterministic**, so a
  **zero-paid drill can verify correctness and reachability**: the fields
  validate, `llm_help()` lists exactly the active surfaces, and each `expects`
  matches the guard predicate it derives from. This is the rule-20-safe half —
  reachability and equivalence, never "does the prompt help."
- Whether *exposing* `llm_help` improves model behaviour is the harness
  self-model's **paid-adoption probe** (its Phase-0 finding: a zero-paid harness
  records the script, not model adoption). Separately owner-gated; do not test it
  as a new-vs-null baseline.
- *Byte-identical-when-absent* still binds: with no modules or tools configured,
  `llm_help()` lists the kernel surfaces only.

## 6. Resolved (owner, July 21, 2026) & still open

**Resolved this session (Cnid):**

- **Source of truth for `expects`:** the **guard-derived account is authoritative
  and cannot drift**; on a *legitimate stalemate* with a human-authored descriptor,
  **the human wins** — the user is the domain authority. Guard-derived otherwise.
- **Half A's runtime shape:** DECIDED — the existing prompt composition made
  *per-object* plus a descriptor; **a discipline and a descriptor, not new
  machinery.**
- **Human-doc generation** from the descriptors (auto-generating the navigation
  pointers we wired *by hand* this session): **in scope for this concept**, not a
  follow-on — one self-description, two audiences (the RLM via `llm_help`, humans
  via generated pointers). MASH does not do this — Trellis would extend past its
  ceiling, not catch up.
- **Building `llm_help`:** compose and validate it **via the `self-play` skill
  first** (clean-room isolated players) so the alive catalog and the guard-derived
  `expects` are shown to actually work before anything relies on them.

**Still open:**

- **Where `llm_help` composes from at runtime:** static descriptors, live
  run-state, and guard predicates are three sources; the alive catalog needs all
  three, which is why it belongs next to the run's tool-injection seam
  (`src/rlm/trellis_agent.py` `custom_tools`), not a static doc.
- **The exact descriptor field set** (§3.2) versus MASH's shipped
  `{help, category, aliases, usage}` — which fields Trellis adopts (`category` is
  recommended; `aliases` only where a surface has genuine alternates).

## 7. MASH ↔ Trellis — the six-axis correspondence (verified July 21, 2026)

Six read-only agents read the MASH clone against the Trellis records. The one-line
finding: **MASH and Trellis solve overlapping problems, but MASH is a lower-stakes
narrative engine where a model may freely author state and prompts, while Trellis
is an epistemic engine that constrains exactly those moves** — so several MASH
mechanisms are best read as the *un-guarded* version of a Trellis discipline, and
this record's proposals are corrections on top of MASH, not imports of it.

| Axis | MASH (verified in code) | Trellis | The finding |
|---|---|---|---|
| **Self-documenting commands** | `command_meta: name → {help,category,aliases,usage}` bound at the handler's call site (`mash_engine.py:67`, `:306`); one `_cmd_help` renders the categorized catalog | `purpose` on `module.json`; schema already `.strict()` (`src/config/modules.ts`) | Tight — and Trellis *improves* on it: MASH's `@mind` help reads "(Wizard only)" as prose (`:175`) while the gate is a separate `if not agent.wizard` check (`:3272`) — drift nothing prevents. Guard-derived `expects` is that fix. |
| **`world.json` = fact-workspace** | one `dict[dbref → GameObject]`, whole-file overwrite, an `attrs` catch-all with *silent field-drop* on schema drift, LLM output written straight into `memo`/`status`, no provenance (`database.py`) | Tier-1 Merkle facts + Tier-2 `sourceNodeIds` beliefs; Tier-3 workspace (trust: NONE) | Matt's mapping holds at the *framing* level; at the *mechanism* level `world.json` ≈ Trellis's **Tier-3** scratch (also one JSON dict, no trust standing), not Tier-1/2 facts (which add the custody MASH lacks). The three-workspace triad is the aspiration; MASH shows what facts-without-custody looks like. |
| **The Loom (compose prompt from objects)** | code-composed `to_dict` → context → prompt (no model); the **"bloom"** lets a text model author the image model's prompt *ungated* (`ai_layer.py:365`) | grounded authoring + `judge_explain` compose by code, with pinned attribution / anchor gates | Tight on the code-composed half; **inverted** on the bloom — MASH's ungated model-authors-the-next-prompt *is* the laundering failure class Trellis's rails exist to close. Half A (per-object descriptors) is the disciplined form. |
| **Kernel / softcode extensibility** | hardcoded kernel dispatches first, softcode `$`/`^` triggers as fallback, `@set`/`@create`/`@agent` live-instantiate, gated only by ownership + tokens (`mash_engine.py:552`, `:780`) | kernel / userspace modules — between-runs, human-gated, capabilities-are-beliefs (contested by the invalidation sweep) | Tight at the boundary, **inverted** on timing: MASH = live / in-session / ungoverned; Trellis = between-runs / provenance-governed. Trellis is *ahead* on lifecycle. Possible borrow: a finer-grained extension unit below "module." |
| **Runtime & language (the Rust question)** | one Gemini call per turn vs. O(1) in-memory dict ops (unmeasured) | *measured*: the slowest local text op sits far under a multi-second REPL turn; polars (Rust-backed) adoption **rejected** absent a real bulk surface | **Python is sufficient in both; a Rust rewrite is not justified** — Trellis's own `WALL_CLOCK_TEXT_OPS_REPORT` + the Session-27 no-migration ruling settle it. |
| **System shape** | one shared-memory MUSH world; `to_dict()` everything; **one bracket-command wire format** shared by players, softcode, *and* the AI (`mash_engine.py:2576`) | an RLM over a provenance substrate; a typed single write path; a distinct tool-calling surface | MASH's shared input/output wire (narration = action = softcode, one syntax) is its most distinctive move — elegant for a game, the opposite of Trellis's typed provenance boundary. |

**Two meta-lessons.**

1. **MASH is the un-guarded twin.** Its `attrs` silent-drop, its `@mind`/`@agent`
   doc-vs-code drift (the README even lists `@agent` at 5 tokens while the code
   enforces 500 — `mash_engine.py:28`), and its ungated "bloom" are, one for one,
   the failure classes Trellis's typed schemas, guard-derivation, and pinned
   attribution exist to close. MASH validates *why* those disciplines are the
   right call — it is the counterfactual, not a template.
2. **The one thing to genuinely borrow is the self-documentation *discipline*
   itself** — "one call site, one commitment," the category-grouped catalog, and
   — *past MASH's own ceiling* — exposing it to the agent (`llm_help`) and
   generating human docs from the same descriptors. MASH proves the pattern is
   small and works; Trellis's job is to add the guard-derivation and the
   provenance MASH never needed.

## 8. Provenance & standing

- **Collaborator origin & credit.** The concepts — the Loom composing prompts
  from state objects, self-documented commands carrying their own metadata, the
  help-function discoverability, and the `world.json`-as-fact-workspace mapping —
  are **Matthew Murphy's (Lexideck)**, from his **MASH** engine
  ([github.com/gusthemole/MASH](https://github.com/gusthemole/MASH)). Trellis owes
  the discoverability direction, and a sharper framing of composed intent, to
  MASH; this record maps them onto Trellis, develops the `llm_help` shape, and
  records the six-axis correspondence (§7). The mapping and the Trellis
  instantiation are the session's work — the seed and the prior art are his, and
  the debt is acknowledged in strong regard. A full chain-of-density map of MASH
  itself, reverse-engineered from the code, lives in OpenCnid's fork at
  [`docs/density-chain/`](https://github.com/OpenCnid/MASH/tree/main/docs/density-chain).
- **Byte-accurate on MASH — verified in the clone, not merely described.** The
  command doc-metadata registry (`mash_engine.py:67`, `:306`), the Sensory /
  Visual Loom and the "bloom" (`ai_layer.py:32`, `:334`, `:365`), and `world.json`
  as gitignored runtime state (`mash_engine.py:4504`) were read directly this
  session and are cited with locators throughout — upgrading them from
  "collaborator-described" to verified. Kept honest where the clone is silent: the
  referenced `mash_mcp_architecture.md` and `reference_tinymush/` are gitignored
  and absent from the public clone, so anything they add is not represented here.
- **Status: RATIFIED July 23, 2026** — see §9. The line this bullet carried
  until then (*PROPOSED / UNRATIFIED; authorizes no build; sits behind
  `HARNESS_SELF_MODEL.md` §8's gate*) is superseded by that dated entry, which
  is also where the build's remaining gates are stated.

## 9. Ratification (dated entry — July 23, 2026, owner, in session)

Proposed for ratification by the collaborator (Matt), on the argument that
these surfaces are where the RLM harness earns its keep over a stateless
recursive baseline — *MASH is proof-positive that composite prompts work; this
is what makes a smarter harness* — and ratified by the owner (Cnid) in the same
session. The companion authorization is
[`HARNESS_SELF_MODEL.md`](HARNESS_SELF_MODEL.md) §12, which opened §8's gate
for **Workstream B only**; the buildable specification is
[`LLM_HELP_SPEC.md`](LLM_HELP_SPEC.md), which takes its standing from this
record.

**RATIFIED as direction and design:**

- **§0 — the one line.** Every surface carries its own description, and that
  self-description does double duty: it composes into the meta-prompt that
  signals intent, and it is exposed through a discoverability surface. The two
  halves are one idea from two sides.
- **§2 — Half A as a discipline, not new machinery.** Each object is
  responsible for its own contribution; the harness composes those fragments by
  code. This is the existing prompt composition made per-object, as §6 already
  recorded the owner deciding.
- **§3 — Half B: the descriptor and `llm_help`.** Discoverability is enforced
  by tooling shape (a descriptor missing a required field fails validation),
  not requested by prose — *one call site, one commitment*. `llm_help` is
  always present, because a discovery surface that were itself opt-in could not
  be discovered.
- **§3.3 — guard-derivation, and the stalemate rule.** The `expects` account is
  derived from the guard predicates and composed by code, never authored by the
  model. On a *legitimate stalemate* with a human-authored descriptor the human
  wins: the user is the domain authority, by the target function's own
  definition ([`STANDING_MODEL.md`](../product/epistemic-support/STANDING_MODEL.md) §0).
- **§3.4 — one self-description, two audiences.** Human-facing navigation
  pointers generate from the same descriptors. In scope for the concept, not a
  follow-on.
- **§5 — the acceptance shape**, including the split it names: the
  deterministic reachability drill is the rule-20-safe half, and whether
  *exposing* `llm_help` improves model behaviour is a separate paid question.
- **§7 — MASH is the un-guarded twin.** The proposals here are corrections on
  top of the prior art, not imports of it. The credit in §8 stands as written.

### 9.1 The addendum owed on kinds of fact — paid here

[`docs/density-chain/README.md`](../density-chain/README.md) (*Still open*,
item 3) recorded an open item against this record and named a dated addendum as
owed: its routing table is derived *from* the account rather than the account
from a guard, because the table enforces nothing — "which branch covers this
path" is editorial. The record anticipated only the enforced kind. Paid:

> **One encoding, owned by whoever is authoritative for the fact.** Where the
> **engine** is authoritative — a bound it will actually refuse on — the
> account is derived from the guard, and no one hand-authors a second copy
> beside it. Where a **human** is authoritative — intent, grouping, which
> siblings are worth reading — the human authors it once, and nothing derives a
> second copy.

Guard-derivation is the instance of that invariant for enforced facts, not the
whole of it. The descriptor of §3.2 is deliberately mixed: `expects` is
guard-derived because a guard is authoritative for it, while `whenToUse`,
`category` and `seeAlso` are editorial — no predicate refuses when they are
wrong, and no derivation can supply them. A builder who goes looking for the
predicate behind `seeAlso` will not find one; that is the wrong kind of fact,
not a gap in the mechanism. The failure class both halves close is identical: a
second encoding that can disagree with the first.

This is also why §3.3's stalemate resolution is not an exception to
guard-derivation but the same rule at the other end of the axis.

### 9.2 Honest scope — what ratification does not claim

- **Guard-derivation is specified, not demonstrated.** *(Superseded July 25,
  2026 — §13. This sentence was already false when written: `composeJudgePrompt`
  derives from the taxonomy its own parser refuses against.)* No shipped surface
  derives its self-description from its guard predicates today. The closest
  live thing is `build_textedit_addendum(textedit)`
  (`src/rlm/trellis_textedit.py`), and read precisely it *selects* between two
  pre-authored constants on the one `_guarded_only` bool that also makes
  `splice()` refuse. That honors `HARNESS_SELF_MODEL.md` §2.1's drift invariant
  for a single bool — one piece of state both refuses and describes — but it
  derives nothing from a predicate, and the prose in both arms is
  hand-authored. `HARNESS_SELF_MODEL.md` §8's pre-stated first test is what
  converts the assertion into an observation, and that is why §12 sequences it
  as increment 1.
- **The bijection is not claimed to hold anywhere yet.**
  `HARNESS_SELF_MODEL.md` §3 is the acceptance criterion for the surfaces a
  build reaches, not an established property of the current kernel.
- **No behavior claim attends this ratification** (rule 8; rule 20). Nothing
  here is measured to improve any outcome. That these surfaces make the harness
  smarter is the design's argument, not a result — the measurement that would
  test it is paid and separately gated.

### 9.3 What remains gated

- **Workstream A** of `HARNESS_SELF_MODEL.md` §8 (the trace: read buffer and
  decision log) is **not** authorized. §8's own direction that the two
  workstreams should not ride together is the reason.
- **The paid adoption probe** — whether exposing `llm_help` changes what a
  model does — stays behind rule 7 (printed estimate, owner gate, $5/run cap)
  and is not to be run as a new-versus-null baseline (rule 20).
- **Both composed-prompt sha256 pins move** when `llm_help` lands in the
  kernel. Recompute both, together, in the same commit, wittingly (`AGENTS.md`
  §3) — the pin ceremony §8 of the self-model reserves for Workstream B.
- **§6's two still-open questions** — where `llm_help` composes from at
  runtime, and the exact descriptor field set against MASH's shipped
  `{help, category, aliases, usage}` — are **build-time decisions, not
  ratified answers.** Ratifying the design does not settle them.
- **The self-play validation gate** (§6, resolved; specified at
  `LLM_HELP_SPEC.md` §6) binds before anything relies on the alive catalog.

## 10. Increment 1 executed — the descriptor model is lossless on trellis_textedit (dated entry — July 23, 2026)

[`HARNESS_SELF_MODEL.md`](HARNESS_SELF_MODEL.md) §12.1's pre-stated first test
ran and **byte-identity holds on both arms**: the addendum composed from a
descriptor plus guard-derived expectations equals the hand-authored constants
exactly — `TEXTEDIT_ADDENDUM` (3,066 chars) and
`TEXTEDIT_ADDENDUM_GUARDED_ONLY` (3,067 chars), one pin per arm
(`scripts/test_textedit.py` §16, *descriptor-composed addendum*). Each pin was
made to fail once on a planted one-byte perturbation and named the first
divergent byte before being restored (rule 19(c)); the perturbed live path was
also caught independently by the pre-existing constants-equality checks. The
refactor can proceed surface by surface without a pin ceremony: the
composed-prompt sha256 pins did not move, because the composition ships bytes
identical to the constants.

**What shipped.** `TEXTEDIT_DESCRIPTOR` carries the editorial fields
(`LLM_HELP_SPEC.md` §1 vocabulary); `_TEXTEDIT_GUARD_EXPECTS` owns every
guard-backed sentence, one phrase per guard class, keyed by the guard;
`render_textedit_addendum` is the invariant frame and contributes no prose;
`build_textedit_addendum` now ships the composition, so its non-test caller is
the kernel-prompt seam in `src/rlm/trellis_agent.py`. The mode account is
selected by the same `_guarded_only` bool that makes `splice()` refuse — §2.1
of the self-model, now an observation. This supersedes §9.2's first bullet
**for this surface**: `trellis_textedit` no longer selects between two
pre-authored constants. Honest scope of "derived": the phrase *text* is still
human-authored once per guard class and pinned; what the engine derives is the
selection (from the refusing state) and the single-encoding ownership (a
guard-backed sentence exists in exactly one place, enforced by a drill check).
Nothing generates prose from predicate code, and the other eight surfaces are
untouched.

**Findings, recorded rather than fixed** (fixing any of them moves
kernel-prompt bytes, which this increment is forbidden to do):

1. **A bijection orphan in the guarded arm.** `_require_guarded_lines`
   enforces the newline-free line contract on `expected_lines`/`new_lines`,
   but the guarded arm renders no line for it — the phrase rides only the raw
   `splice()` bullet. Pinned as a finding in the drill.
2. **The §3.2/§1 field set had no slot for cross-cutting protocol lines**
   (the JSON-return convention, the raw-arm PREFER bullet, the provenance
   HARD RULE). MASH's `usage` field was adopted **provisionally** to carry
   them. This is evidence for §9.3's open field-set decision, not its
   settlement.
3. **The advisory census** (`HARNESS_SELF_MODEL.md` §4's marking duty): the
   lines no predicate on this surface enforces are the JSON-return
   convention, the LOCATE-NEVER-COUNT tail, "Addresses are transient", the
   raw-arm PREFER bullet, "Re-loading refreshes … DISCARDS", diff's display
   truncation, and the provenance HARD RULE (enforced by the database write
   path, a different surface). They are marked advisory as descriptor
   metadata; the rendered bytes cannot carry the marking until a pin-moving
   pass is authorized.
4. **The banner qualifier "(CODE-MEDIATED, HASH-GUARDED)" restates two
   guard-backed properties inside an editorial field** — a mild §9.1 tension:
   the second encoding it forbids, at one-word scale, in the grouping label.
5. **Bijection granularity is the guard class, not the raise site.** One
   digest line accounts for the whole `StaleFileError` family; operator-facing
   guards (`parse_textedit_bounds`, `parse_textedit_guarded_only`'s
   malformed-value refusal, the root validation) deliberately have no line,
   because they refuse the operator before a run exists.

## 11. Descriptors are a registration, not a schema (dated entry — July 23, 2026, owner, in session)

Proposed by the collaborator (Matt) on reading increment 1's field-set
question, and approved by the owner (Cnid) in session. It answers §9.3's
open field-set item by **dissolving** it rather than settling it.

**The argument.** A project whose central iteration is prompt authoring
cannot afford a descriptor vocabulary that becomes law early. Prompt
engineering is iterative by nature — unexpected behaviour is discovered,
not predicted — so the machinery around it must let a field be added,
renamed, or dropped without a migration. A frozen required-field set buys
consistency at exactly the cost this project can least pay.

**What is ruled.**

- **The descriptor is a registration, not a validated schema**, while the
  shape is still being learned. Fields vary per surface; adding one is an
  edit, not a ceremony. There is no single frozen set to ratify, so §9.3's
  field-set question is closed as *dissolved* — MASH's `{help, category,
  aliases, usage}` and §3.2's set are vocabularies to draw from, not
  competing laws.
- **Coverage is the enforced property; field shape is not.** The duty worth
  mechanizing is *every live surface carries a descriptor* — the question
  that stays stable while the fields move. That is the "ensure all added
  surfaces get prompts" diagnostic in the proposal's own words, and it is
  what a registration system exists to make answerable.
- **The diagnostic informs; it does not refuse.** Consistent with
  [`HARNESS_SELF_MODEL.md`](HARNESS_SELF_MODEL.md) §12.2: nothing derived
  from a descriptor may gate anything without its own owner gate.
- **This amends §3.2.** Its "a surface whose descriptor is missing a
  required field fails validation" no longer governs descriptor **fields**.
  Rule 8 is still satisfied by tooling shape — the shape is now a registry
  plus a coverage report, rather than a required-field schema. Per-surface
  byte-identity pins (§10) remain the drift check on the bytes themselves.

**What does not change.** `expects` stays guard-derived and code-composed
(§3.3, §9.1) — one encoding owned by whoever is authoritative for the fact.
Guard-derivation was never a field-set question, and this ruling does not
touch it. The strict `ModuleManifestSchema` (`src/config/modules.ts`) is
untouched: it validates `modules/*/module.json` and has never seen a
descriptor. Putting descriptor fields into it remains a separate future
decision, and this ruling makes it the less likely one.

**A correction this exposes.** The session that shipped increment 1
described the field set as one strict-schema landing away from becoming
law. That overstated the constraint: the shipped descriptor is a Python
dict literal with no validator anywhere in the tree, and the strict schema
it named governs a different artifact class. Changing a field today costs
one file — the condition this ruling now preserves deliberately rather
than by accident.

**A second overstatement from the same session, corrected here because it
governs sequencing.** §10's findings were described as needing `llm_help`'s
pin ceremony before they could be fixed. They do not. Both composed-prompt
sha256 pins hash `trellis_agent.SYSTEM_PROMPT`, and the textedit addendum
is **not part of it** — verified: that string contains neither the addendum
banner nor the substring `trellis_textedit`. The addendum is appended into
the run's `dynamic_system_prompt` at injection time. So addendum bytes are
pinned by `npm run test:textedit` alone; the composed-prompt pins move only
when the **base** prompt changes, which is why `llm_help` — an
always-present kernel builtin taught in the base TOOLS manifest — is the
pin-moving event while a conditional addendum is not. Fixing §10's findings
is a drill-pinned edit, and nothing in it waits on `llm_help`.

## 12. Increments 2 and 3 — the registry, the coverage diagnostic, and the orphan closed (dated entry — July 23, 2026)

Built on the owner's approval of the §11 plan, in the order recommended and
approved: registry first, then the duplicate encoding retired, then the
orphan fixed. All zero-paid. Neither composed-prompt sha pin moved, for the
reason §11 records.

**Increment 2a — the surface registry.** `src/rlm/trellis_surfaces.py`
holds `register_surface(descriptor)` / `registry()` / `descriptor_for(name)`.
A surface binds its descriptor at its own definition site — MASH's *one
call site, one commitment* — and `trellis_textedit` now does. Faithful to
§11, the registry validates **no field set**: a descriptor may carry any
fields, and only a non-empty `name` is required, because that is the key
rather than a validated field. Drilled both ways: a descriptor with
invented fields registers, a nameless one refuses.

**Increment 2b — the coverage diagnostic.** `npm run check:surfaces`
answers *which injected surfaces carry a descriptor*. The roster is
**derived from the injecting code** — the `custom_tools` construction in
`trellis_agent.py`, read by AST at diagnostic time — so it cannot drift
from the seam the way a hand-kept list would, the same move the
density-chain checker makes on its own routing table. Dynamic
contributions it cannot enumerate statically (`scaffold_helpers`,
`build_author_tools`) are **named in the output** rather than dropped,
because silent absence is `HARNESS_SELF_MODEL.md` §5's failure class.
First run: **1 of 9 injected surfaces described.** It reports and refuses
nothing; its exit code mirrors `wiki:check`'s staleness half and is
deliberately not wired into CI.

**Increment 2c — the duplicate encoding retired.** `TEXTEDIT_ADDENDUM`,
`TEXTEDIT_ADDENDUM_GUARDED_ONLY` and their four fragments are **deleted**.
Increment 1 proved the composition reproduces them byte-for-byte; keeping
both afterwards shipped two encodings of one set of bytes, which is §9.1's
failure class sitting inside the artifact built to demonstrate it. Drift is
now caught by a sha256 pin per arm in `scripts/test_textedit.py`, **seeded
with the retired constants' own digests**, so the pins inherit increment
1's proof rather than restating it. A drill check holds the constants
retired, since a second copy returning is the regression that matters.

**Increment 3 — the bijection orphan closed.** The guarded-only arm now
states the line contract `_require_guarded_lines` enforces: a guarded-only
run is no longer refused for a rule it was never told. One bullet,
rendered from the **same** guard-owned phrase the default arm already
carried, so the two arms cannot drift apart on it. The guarded arm's pin
moved wittingly (`27cc00b2…2835` → `c673f0a0…f124`, 3,067 → 3,139 chars)
with its history recorded at the pin; the **default arm's sha is
unchanged**, which is the evidence the fix reached exactly the arm that
lacked the line. Each pin was seen to fail on a planted one-byte
perturbation and restored (rule 19(c)), and the drill's
`--negative-control` detects 7/7 planted conditions, exiting 3.

**What remains open, unchanged.** The advisory-marking duty
(`HARNESS_SELF_MODEL.md` §4) is deliberately still open: how an account
marks enforced-versus-aspirational is a presentation convention that
should be settled once across every surface, and deciding it for one
surface would make an instance into law by accident (rule 17). It belongs
with `llm_help`'s frame. The banner-qualifier tension (§10, finding 4) and
guard-class granularity (finding 5) stand as recorded; eight surfaces still
carry no descriptor, which the diagnostic now reports rather than leaving
to memory. *(That count is superseded — see §13: 8 of 9 are described.)*

## 13. The description slot, and the gate this did not run (dated entry — July 25, 2026)

Half A reached a model. Not through `llm_help`, which is still unbuilt, but
through a slot rlms already reserved and Trellis had never filled: every
`custom_tools` entry renders as one line in the base prompt, `parse_tool_entry`
accepts `{"tool": …, "description": …}`, and the listing splices in at character
1,335 of the 2,116-character protocol prompt — ahead of every Trellis directive.
Trellis passed bare values, so each injected surface rendered as its type name.

**This supersedes two claims above.** §12's closing sentence — *eight surfaces
still carry no descriptor* — is false: `npm run check:surfaces` reports **8 of 9
described**, and the ninth, `UPSUM_BUDGET`, is a bare int declined on purpose
rather than a gap. §9.2's first bullet — *No shipped surface derives its
self-description from its guard predicates today* — was already false when
written, and is further false now: `composeJudgePrompt`
(`src/core/graph/judge_intake_prompt.ts`) renders the same `taxonomy` object
`parseJudgeVerdict` refuses against, with `buildSpawnRequest` re-rendering and
re-hashing before transport, and it predates increment 1 in a different
subsystem and a different language.

**What the frame owns.** `src/rlm/trellis_contribution.py` composes a surface's
line from its registered descriptor and its derived expectations, joins pieces
with the empty string so the frame contributes no prose of its own, and refuses
a brace, a newline, an empty line, boundary whitespace, and a whole composition
over `CONTRIBUTION_BUDGET`. That budget is §5 of `HARNESS_SELF_MODEL.md` paid:
a bound that raises rather than one held by authorial discipline. It is drilled
by `npm run test:contribution`, whose `--negative-control` detects nine plants
and exits 3.

**The ladder, and which rung a number names.** Three claims, and the earlier ones
do not establish the later:

| rung | property | count today |
|---|---|---|
| registered | the surface carries a descriptor | 8 of 9 injected |
| contributing | that descriptor carries a `contributes` list | 13 |
| wired | a run passes it to `compose_contributions` | 8, plus 5 the static read cannot settle |

*(Figures corrected July 25, 2026 — this table first read 5 contributing and 2
wired, which was the state when the rung split was written and not the state it
shipped in.)*

**The ladder is flat now, and it is flat structurally rather than by
bookkeeping.** The composing call draws its roster from `custom_tools` itself,
so every surface a run injects is wired and no per-surface wiring decision
exists to forget. The five it cannot settle are the staged helpers, injected
conditionally, which the report names rather than counts — unestablished is not
established (rule 15).

`check:surfaces` reports all three rungs, and `scripts/test_surfaces.py` holds
the property that matters: **no surface carries a line the composing call
leaves out.** That check was run against the real historical seam from
`34538be^` and went red naming eleven surfaces, while the two rungs above it
stayed green — which is the failure it exists to catch, the cheap rungs reading
as progress while eleven finished lines reached no model. Its predecessor
asserted that the ladder *narrows*, which turned an unfinished wiring into a
pinned property; that assertion is retired.

**The gate this did not run, stated as outstanding rather than declined
silently.** `attach_contributions` computes the registry × `custom_tools`
intersection, which `LLM_HELP_SPEC.md` §12 defines as the alive catalog, and
hands it to a production model. §6's self-play validation gate — discrimination,
and drift resistance with *selected-on-a-lie* as the pre-committed falsifier —
binds before anything relies on that catalog, and it did not run.

The judgment made instead, so a later session can overturn it rather than
inherit it unstated: the gate's concern is barely engaged at two wired surfaces.
`whenToUse` — the field the *selected-on-a-lie* cell targets — is deliberately
absent from both wired lines, both of which carry guard-derived bounds rather
than intent claims, and a discrimination test over two surfaces measures
nothing. **The trigger is therefore stated rather than the gate waived: §6 binds
before `whenToUse` reaches any composed line, and before any queryable catalog
surface lands.** Either event, and the gate runs first.

**Reachability is unchanged.** `src/repl_sandbox/` still has no non-test caller;
`FEATURE_LIST.md` row 2.4 stands. Nothing here measures whether a model behaves
differently for reading any of it — that remains the separately gated paid probe
of `HARNESS_SELF_MODEL.md` §12.2, and rule 20 still bars running it as a
new-versus-null arm.

### 13.1 The drift half of §6 is struck (collaborator ruling — July 25, 2026)

§13 above stated a trigger: *§6 binds before `whenToUse` reaches any composed
line*. `whenToUse` now reaches three composed lines, so that trigger has fired
— and the collaborator (Matt) ruled the test it points at is not a legitimate
target. Recorded here in his terms rather than paraphrased into agreement.

**The ruling.** `LLM_HELP_SPEC.md` §6's second test asks whether a *lying*
descriptor — a `whenToUse` that oversells — can mislead the model, with
*selected-on-a-lie* as the pre-committed falsifier. Matt: *"If someone wants to
reverse-engineer Trellis to do something pointlessly nefarious with the internal
metaprompts, like lying to the interior model, there is nothing that will stop
that. Not ever."* And: *"We know what happens if you give a language model the
wrong context. It's not a mystery."*

**Why the test cannot inform.** Its adversary is whoever writes a descriptor,
and descriptors are repository code authored under rule 16 and reviewed. So the
adversary is a reviewer, the threat crosses no boundary, and the experiment
reduces to *if we commit a lie, does the model believe it* — whose answer is
entailed by what a language model is. That is rule 20's own failure: an
outcome fixed by construction, reached for because the comparison was closer to
hand than a target. The measurement would report the design.

**What this strikes, and what it leaves.** The drift/gaming half of §6 is
struck, and with it the `whenToUse` trigger §13 stated, which was scoped to it.
§6's **discrimination** half is untouched and stands on its own merits — given a
task and a queryable catalog, does an agent select the right surface — but it
needs a catalog to select *within* and a live model to select, so it is a paid
question under rule 7 and belongs with `llm_help`, not with a per-tool listing
that is always present entire.

**What still binds.** Nothing here weakens the guard-derivation of §3.3, which
was never a test — it is the structural reason an `expects` line cannot drift
from the predicate that refuses, and it holds whether or not anyone probes it.
The descriptor drills hold the same property by construction: a guard-owned
phrase restated in an editorial field is refused by the drills, not by a study.
