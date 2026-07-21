# Self-Describing Surfaces — Composed Intent & Discoverability — Design Record

**Status: PROPOSED / UNRATIFIED — recorded July 21, 2026 from a collaborator
design exchange (Matt / Matthew Murphy, from his MASH engine). This record
authorizes NO build; it develops a concept and maps it onto Trellis.** It is a
concrete instantiation candidate for
[`HARNESS_SELF_MODEL.md`](HARNESS_SELF_MODEL.md) Workstream B (which remains
*principle endorsed, implementation not authorized*, and whose §8 gate governs
sequencing), and it extends
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
  shape; the self-model's §8 gate still governs whether and when it is built.
- **`WORKSPACE_AND_MODULES.md`** — additive manifest fields only; *capabilities
  are beliefs* is unaffected, because doc-metadata carries no provenance.
- **`CODE_MEDIATED_TEXT.md`** — the catalog and the `expects` account are
  composed by code, never re-typed or invented by the model.
- **`COMPOSITION_FROM_PRIMITIVES.md`** — the catalog is the run's *actual cover*,
  composed per context; there is no default cast of "available tools."
- **`GROUNDED_AUTHORING.md`** — if a module's descriptor is drafted by the RLM,
  it goes through the grounded-authoring mold (harness-pinned), like any addendum.

## 5. Acceptance shape, if ever sequenced — no build authorized

Recorded so a future build inherits the right gate, not to authorize one:

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
- **Status: PROPOSED / UNRATIFIED. Authorizes no build.** It sits behind
  `HARNESS_SELF_MODEL.md` §8's gate; the owner sequences. A design record leads
  its implementation but binds nothing until ratified.
