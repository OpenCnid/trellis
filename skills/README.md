# In-repo harness skills

Versioned copies of the Claude Code (harness) skills this project depends
on, kept in the repository so they are **inventoried with the collection a
session consults**. This is the direct remedy for a failure the record
paid for: a skill living only outside the repository was part of why
Session 71 rebuilt the standing judge roster the rules forbid — without
ever reading the game record or invoking the skill that would have stopped
it ([`judge-composition/README.md`](judge-composition/README.md);
`docs/product/epistemic-support/JUDGE_COMPOSITION_GAME.md §6.1`).

## Authority — these are derived artifacts

Each skill here is subordinate to a canonical authority, and on any drift
**the authority wins and the copy is corrected**, never the reverse. A
paraphrased copy is drift, not an implementation — consumers cite the
record, they do not restate it. These copies also sit under the house
ordering **code > glossary > prose**; they bind nothing that code or the
glossary contradicts.

Versioning a skill here is an owner act
(`docs/product/epistemic-support/JUDGE_COMPOSITION_GAME.md §10`, open item
4 — "if the owner wants it versioned here"). This directory is therefore
**not exhaustive** of the harness skills in use, only those chosen for
in-repo custody.

## The skills

- **[`judge-composition/`](judge-composition/)** — composing the four-role
  judge panel (grounding, coherence, corroboration, audit) from parameter
  primitives, per context, with **no default cast**. A verbatim copy of
  the user-level skill; its canonical authority is
  `docs/product/epistemic-support/JUDGE_COMPOSITION_GAME.md` — the §6
  twenty rules are binding program law, cited by number, and §11
  (Ratification) governs the skill.

- **[`complexity-convocation/`](complexity-convocation/)** — the
  harness-orchestration form of that ceremony for one surface: *is this
  complexity warranted, and if not, what should change?* A characterizer
  reads the context first, a blind composer builds one judge per seat,
  three isolated judges evaluate in clean contexts, and a judges-judge
  audits their runs on real sub-agent telemetry; the return is
  interpretable and user-gated. Defers to the epistemic-support records it
  cites; clean-room validated
  ([`VALIDATION.md`](complexity-convocation/VALIDATION.md)).

- **[`self-play/`](self-play/)** — the clean-room method for testing an
  LLM-assisted feature: isolated players (gatherer, adversary, evaluator),
  each blind to the one thing that would let it serve the builder's wish,
  so the builder's stake cannot leak into the evidence or the scoring. Its
  own `SKILL.md` states it is canonical over any copy; worked examples live
  in `docs/architecture/DOUBTS_WORKSPACE.md §11–§12` and
  `docs/product/epistemic-support/PRIMITIVE_ENCODING_AUDIT.md`.

## House note — authoring skill bytes

Editing any skill that primes a model's generation invokes Guardrail 15:
the `prompt-engineering` and `hypershot-protocol` skills must be invoked
first and authored against. A skill that is a verbatim mirror of a
user-level copy is kept byte-identical to it; a skill that carries its own
canonical text is the record, and outside copies are regenerated from it.
