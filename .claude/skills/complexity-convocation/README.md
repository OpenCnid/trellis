# In-repo copy of the `complexity-convocation` skill

This directory versions the operational runner that applies the
judge-composition ceremony to one surface: **is this complexity
warranted, and if not, what should change?** It spawns real sub-agent
judges composed fresh for the artifact and a judges-judge that audits
their runs on real harness telemetry, returning interpretable,
user-gated recommendations.

## Provenance

Authored July 20, 2026 from a collaborator proposal (Matthew Murphy,
Lexideck) — "a skill that spawns three sub-agent judges using the same
composition method as Trellis, one agent evaluating the context first,
and a judges-judge over the telemetry and logs of the sub-agent runs"
— at owner (Cnid) direction. It is a **fresh** skill: the earlier
`complexity-ceremony` skill on the same surface was neither consulted
nor built upon, at the owner's instruction, and has since been
deprecated and then deleted in favor of this one.

`SKILL.md` here is a verbatim copy of the user-level skill as of that
date. It is a derived artifact; this directory is not an independent
authority.

It was validated the same day in a clean-room [`self-play`] run — a blind
adversary built the target, the real six-spawn ceremony ran, and a blind
evaluator scored it against a double-confirmed key. Both pre-committed
falsifying cells came back empty; the single earned refinement (the
grounding seat's evidence scope, plus a Stage-6 gluing rule) is folded
into `SKILL.md`. See [`VALIDATION.md`](VALIDATION.md) — the skill was
tested, not assumed.

## The drift rule governs, and it points one way

The epistemic-support record is canonical over this skill. On any
drift between the two, **the record wins and the skill is corrected**
— never the reverse. The binding sources, cited by section header, not
reproduced here (a paraphrased copy is drift, not an implementation):

- [`JUDGE_COMPOSITION_CEREMONY.md`](references/JUDGE_COMPOSITION_CEREMONY.md)
  — the six-stage ceremony (characterize → compose → gate → judge →
  audit → dispose) this skill runs in the harness.
- [`JUDGE_COMPOSITION_GAME.md`](references/JUDGE_COMPOSITION_GAME.md)
  §6 — the twenty binding rules, cited by number in `SKILL.md`.
- [`STANDING_MODEL.md`](references/STANDING_MODEL.md)
  — the signed ternary (`clean | drawback | abstain` = `+1 | −1 | 0`)
  and the user gate the skill's disposition obeys.
- [`FOUR_JUDGE_BASIC_MODEL.md`](references/FOUR_JUDGE_BASIC_MODEL.md)
  — the four registries and the YAML judge schema the composer draws
  from.
- [`RECONCILIATION.md`](references/RECONCILIATION.md)
  §7.1 — composition supersession: "there are no base judges and no
  default cast."

## What is invariant, and what is not

- **Four seats are invariant** — grounding, coherence, corroboration,
  audit — because each buys a blindness the others lack. The verdict
  vocabulary and the audit seat's failure taxonomy
  (`rubric_gamed | convention_blind | systematic_drift` + coverage) are
  invariant too.
- **The judges filling those seats are not.** Names, registry
  selections, orientations, closed over-engineering taxonomies, and
  anchors are composed per artifact by the Stage-2 composer, from the
  Stage-1 characterization. **There is no default cast** — the
  Session-71 standing-roster rollback
  ([`JUDGE_COMPOSITION_GAME.md`](references/JUDGE_COMPOSITION_GAME.md)
  §6.1) is the cautionary case, and a judge that outlives its ceremony
  has rebuilt exactly that.

## The seam this fills (and the one thing it must earn)

The engine's convocation machinery (`src/core/graph/*`, PR #134) is
zero-paid and arithmetic-gated, and emits no token or cost counter.
This skill lives one layer up, in the harness, where the `Agent` tool
returns **real per-run telemetry** — the composition-from-primitives
that the July-19 note in the `judge-composition` skill's own `README.md`
says "must be built and tested." Until these composition meta-prompts
are tested against real artifacts, the system is **trusted or
simulated, never assumed**; `SKILL.md`'s `simulate` path and the
[`self-play`] clean-room are how that testing happens before any paid
run.
