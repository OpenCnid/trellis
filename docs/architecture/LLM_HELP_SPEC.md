# The `llm_help` Surface & Self-Documenting Descriptors — Specification

**Status: PROPOSED / UNRATIFIED — recorded July 21, 2026. Companion spec to the
design record [`SELF_DESCRIBING_SURFACES.md`](SELF_DESCRIBING_SURFACES.md)
(concept + the MASH correspondence); this file is the *buildable how*. It
authorizes NO build** — it sits behind
[`HARNESS_SELF_MODEL.md`](HARNESS_SELF_MODEL.md) §8's gate, of which `llm_help` is
the named Workstream B instantiation candidate. Authored under the house
`prompt-engineering` and `hypershot-protocol` protocols (Guardrail 15); the
schemas and frames below are hypershots — field names are invariant vocabulary,
values are placeholders, never filled examples.

---

## 0. What this documents

Half B of the design record, made concrete: (1) the **self-documenting
descriptor** every surface carries; (2) the **`llm_help`** runtime surface that
exposes them; (3) the **guard-derivation** that keeps the `expects` account
honest; (4) the **human-doc generation** that ends the orphan class; (5) the
**Trellis skills** as the pattern's first worked instance; (6) the **self-play**
validation gate. The one-line target: *a surface a run touches can always be
asked what it is, when to use it, and what it expects — and that answer is
composed by code from the surface's own descriptor and its own guards, so it can
neither be forgotten nor drift.*

## 1. The descriptor — self-documenting, enforced

Every surface (a module, a kernel tool, a skill) carries a descriptor bound *at
the site where the surface is defined* — **one call site, one commitment**
(MASH's `register_command(..., help=, category=, usage=)`, `mash_engine.py:306`).
Field names are invariant; values are placeholders:

```jsonc
{
  "name":      "{Surface_Name_Identical_Across_Every_Invocation}",
  "purpose":   "{One_Clause_What_This_Surface_Is}",            // exists on modules today
  "whenToUse": "{The_Intent_Or_Run_State_That_Should_Select_It}",
  "exposes":   ["{Named_Behavior_Or_Tool_It_Adds}"],
  "example":   "{One_Bounded_Usage_Sketch_Carrying_No_Provenance}",
  "category":  "{Grouping_Label_For_The_Alive_Catalog}",
  "seeAlso":   ["{Sibling_Surface_Name}"]
}
```

- **`expects` is deliberately absent.** The descriptor carries *intent*
  (`whenToUse`, `exposes`); it never carries *enforcement*. Enforcement is
  derived from the surface's guards (§3), so the two cannot disagree by
  authorship.
- **Enforced by tooling shape, not prose** (rule 8): a descriptor missing a
  required field fails validation. Trellis's `ModuleManifestSchema` is already
  `.strict()` (`src/config/modules.ts`), so this is a schema extension, not new
  machinery — an unknown field already fails; the change is adding required
  known fields.
- **`example` is documentation, never provenance** — it carries no
  `sourceNodeIds`/hashes and is scanned like any authored draft, so it cannot
  become a laundering channel.

## 2. `llm_help` — the runtime surface

A REPL kernel builtin, a sibling of `trellis_workspace` / `trellis_mcp`
(`src/rlm/trellis_agent.py` `custom_tools`), **always present** — *correct ≠
reachable*: a discovery surface that were itself opt-in could not be discovered.

**`llm_help()` — the alive catalog.** Lists *only the surfaces active in this
run* (the selected modules, the enabled tools, the workspace/textedit iff
configured) — MASH's "alive" sidebar and Trellis's *byte-identical-when-absent*,
from the model's side. The frame (a hypershot — the shape is fixed, the slots
vary per run):

```
Active surfaces (this run):
[{category}]
  {name} — {purpose}   (use when: {whenToUse})
  ...
```

**`llm_help("{name}")` — the per-surface account.** The frame:

```
{name} — {purpose}
  use when: {whenToUse}
  exposes:  [{Named_Behavior}, ...]
  expects:  {Bounds_Derived_From_The_Guard_Predicates_Not_Authored_Prose}
  example:  {Bounded_Usage_Sketch}
  see also: [{Sibling_Surface}, ...]
```

The catalog and the account are **composed by code**, never re-typed or invented
by the model — the code-mediated-text pillar binds
([`CODE_MEDIATED_TEXT.md`](CODE_MEDIATED_TEXT.md)).

## 3. Guard-derivation of `expects` — why it cannot drift

The `expects` line is **derived from the surface's guard predicates** — *the same
code that refuses is the code that explains* (`HARNESS_SELF_MODEL.md` §2). The
concrete failure this prevents is in the prior art: MASH's `@mind` command
documents `'…(Wizard only)'` as *authored prose* (`mash_engine.py:175`) while the
real gate is a separate `if not agent.wizard` check (`:3272`) — they agree today,
nothing binds them. Deriving `expects` from the guard makes that drift
**structurally impossible**.

**Source of truth (owner-resolved).** Guard-derived is authoritative; on a
*legitimate stalemate* between the guard-derived account and a human-authored
descriptor, **the human wins** — the user is the domain authority. Otherwise the
guard-derived account stands.

## 4. Human-doc generation — the orphan class, closed

The *same* descriptors that feed `llm_help` also **generate the human-facing
navigation pointers**. A generator walks the live surfaces + their descriptors
and emits pointer lines into the navigation docs (`AGENTS.md` §2, `docs/README.md`,
`docs/density-chain/README.md`), idempotently, with drift detection — the way a
sha-pin detects a stale composition.

This closes a failure class the project has now paid for **three times in one
session** — the density-trellis, the density-chain skill, and the MASH map were
each born orphans and each wired to discoverability *by hand*. One
self-description, two audiences (the RLM via `llm_help`, humans via generated
pointers); the manual toil disappears because discoverability becomes a
*property of the surface*, not a maintenance chore.

## 5. Worked example — the Trellis skills are already self-documenting surfaces

The cheapest first instance is in the repo already. Every skill under
[`.claude/skills/`](../../.claude/skills/README.md) carries YAML frontmatter that
*is* a descriptor:

| Skill frontmatter | Descriptor field |
|---|---|
| `name` | `name` |
| `description` — "what it does. **Use when** {trigger vocabulary}" | `purpose` + `whenToUse` |
| the SKILL.md body (what it emits, its frames) | `exposes` + `example` |
| pairs-with / builds-on cross-references in the body | `seeAlso` |

The skills are ~80% of the way to the descriptor by construction — the
`description` field is *literally* the "purpose + when-to-use" the schema wants,
written in the user's trigger words (that is what makes automatic delegation
fire). A **`skill-help`** surface (or `llm_help` scoped to skills) would render
the active skills' descriptors as the alive catalog with no new authoring — and
would have *told* a cold session that `self-play`, `judge-composition`, and
`spark-steering` exist, which is exactly the discoverability we keep supplying by
hand. The skills are also the **authoring tools for this very document** —
`prompt-engineering` and `hypershot-protocol` shaped the hypershots above under
Guardrail 15 — so the skills appear here twice: as the worked subject, and as the
instruments.

## 6. The self-play validation gate

Per owner direction — *compose and validate `llm_help` via `self-play` first, so
it works* — the discovery surface is validated in a clean room before anything
relies on it, using the [`self-play`](../../.claude/skills/self-play/SKILL.md)
skill. **Framed correctly (its own rule):** self-play tests *uncertain,
stake-corruptible* outcomes, **never** "does `llm_help` help vs nothing" (that
outcome is entailed by what a good spec is — AGENTS.md rule 20). The uncertain
outcomes worth a clean room here are two:

- **Discrimination.** Given a task and an alive catalog, does an agent select the
  *right* surface? A blind **gatherer** assembles real task→surface pairs from
  the repo (blind to which surface is "correct"); a clean-context **agent** picks
  using only `llm_help`; a blind **evaluator** scores selections against ground
  truth it never saw predicted.
- **Drift/gaming resistance.** Can a *lying* descriptor (a `whenToUse` that
  oversells) mislead the agent, and does the **guard-derived `expects`** override
  it? An **adversary** (blind to intent) crafts an oversold descriptor whose
  guard says otherwise; the pre-committed falsifying cell is *selected-on-a-lie*
  — **if ≥1 item lands there, the descriptor layer is insufficient regardless of
  the headline discrimination score**, and the guard-derivation of §3 is the
  required fix, not an optional one.

Disciplines that bind the run: pre-register before prompts exist; build the
ground blind; evaluate blind; controls first (a control failing STOPs the run);
real variables at `path:line`; sub-agent output is data, not authority. This is
the rule-20 carve-out — a fidelity/discrimination test, not a null-baseline A/B.

## 7. Acceptance & status

- **Zero-paid reachability drill** (deterministic, the rule-20-safe half): the
  extended schema validates; `llm_help()` lists *exactly* the active surfaces;
  each `expects` matches the guard predicate it derives from; the human-doc
  generator's output is idempotent and drift-flagged.
- **The self-play discrimination + drift game** (§6) — clean-room, before
  reliance.
- **The paid-adoption probe** — whether *exposing* `llm_help` changes model
  behavior in real runs — is the harness-self-model's separately gated question
  (its Phase-0 finding: a zero-paid harness records the script, not adoption). Do
  not run it as a null baseline.
- *Byte-identical-when-absent* still binds: with no modules or tools configured,
  `llm_help()` lists the kernel surfaces only.

**Status: PROPOSED / no build.** A design record and its spec lead implementation
but bind nothing until the owner ratifies and sequences (`HARNESS_SELF_MODEL.md`
§8).

## 8. Provenance

- **Prior art:** MASH (Matthew Murphy / Lexideck) — the `command_meta` registry
  and `_cmd_help` catalog (`mash_engine.py:67`, `:1835`), read this session and
  mapped in [`SELF_DESCRIBING_SURFACES.md`](SELF_DESCRIBING_SURFACES.md) §7. Its
  self-documentation is human-help-only and its help can drift from enforcement;
  this spec's guard-derivation and model-facing surface are the corrections *on
  top of* it, not imports of it.
- **Authored under** `prompt-engineering` + `hypershot-protocol` (Guardrail 15),
  with `self-play` as the named validation method — the house skills used to
  produce the documentation *of* the surface that would eventually expose the
  house skills.
- **Standing:** collaborator-seeded (MASH), owner-resolved on the four open
  questions of the design record; PROPOSED / unratified; subordinate to
  code > glossary > prose.
