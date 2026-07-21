# Project skills

The Claude Code skills this project depends on, versioned here at
`.claude/skills/` — the project skill-load path — so Claude Code **loads
them for anyone working in this repository** (no per-person install), and
they are **inventoried with the collection a session consults**.
Auto-loading is the onboarding half; inventory is the other, and the direct
remedy for a failure the record paid for: a skill living only outside the
repository was part of why Session 71 rebuilt the standing judge roster the
rules forbid — without ever reading the game record or invoking the skill
that would have stopped it
([`judge-composition/README.md`](judge-composition/README.md);
`docs/product/epistemic-support/JUDGE_COMPOSITION_GAME.md §6.1`).

## Authority

Each skill here is subordinate to a canonical authority — its design record
— and on any drift **the authority wins and the copy is corrected**, never
the reverse. A paraphrased copy is drift, not an implementation — consumers
cite the record, they do not restate it. These copies also sit under the
house ordering **code > glossary > prose**; they bind nothing that code or
the glossary contradicts. The owner keeps personal mirrors under
`~/.claude/skills/` for use outside this repo; those and these are kept
byte-identical, and neither is authority over the record.

Versioning a skill here is an owner act
(`docs/product/epistemic-support/JUDGE_COMPOSITION_GAME.md §10`, open item
4 — "if the owner wants it versioned here"). This directory is therefore
**not exhaustive** of the harness skills in use, only those chosen for
in-repo custody.

## The skills

### Meta-prompting foundation (invoked first — house Guardrail 15)

- **[`prompt-engineering/`](prompt-engineering/)** — the Lexideck
  prompt-engineering protocol: structural clarity and manifold alignment
  over "magic words." Invoked, with the next skill, before any session
  authors prompt bytes (Guardrail 15). Canonical authority: the Lexideck
  Prompt Engineering Curriculum (Matthew Murphy); this `SKILL.md` is the
  deployed artifact, not the full curriculum.

- **[`hypershot-protocol/`](hypershot-protocol/)** — priming structure
  without priming content: a frame with free variables in place of
  contaminating few-shot examples. The mandatory pair with
  `prompt-engineering` under Guardrail 15 — the composition frames in the
  skills below *are* hypershots. Same Lexideck lineage.

### Composition and clean-room evaluation

- **[`subagent-composition/`](subagent-composition/)** — composing a
  Claude Code sub-agent (persona, the inherited-context ledger, tool
  budget, return contract): composition-from-primitives at the
  harness-agent boundary. `complexity-convocation` builds on it and
  `self-play` uses its spawn gate. House-authored, verified against the
  Claude Code docs (its `SKILL.md` carries the provenance).

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

### Loop orchestration

- **[`loop-orchestrator/`](loop-orchestrator/)** — runs one turn of the
  self-improving loop end to end (diagnose → author → spawn → adjudicate →
  user-gated promote), enforcing the house invariant at every seam and halting
  at the user gate. A sequencer, not a new capability: it composes the skills
  above and builds nothing evaluative of its own (no default cast). Composes
  every emitted prompt as a **functional** contribution (derived from the
  guards — the Harness Self-Model's "explainable AI for the AI") plus a
  **user/context-derived** contribution. Installed July 21, 2026 at owner
  direction; the map that produced it lives outside the repo (a private
  Artifact). Canonical grounds: `HARNESS_SELF_MODEL.md`,
  `TEST_TIME_TRAINING.md §12.6`, `STANDING_MODEL.md`. Companions
  (`loop-ledger`, `loop-cadence`, a wired `skill-creator`) are proposed, not
  built, and owner-gated.

### Authoring

- **[`density-chain/`](density-chain/)** — the OpenCnid five-tier
  chain-of-density method for research-paper notes and paper-repo
  scaffolding. Its subject is the separate research-notes collection rather
  than this codebase, but the same method shapes in-repo orientation docs,
  and it is versioned here as house doctrine. Canonical form: the OpenCnid
  chain-of-density spec / this `SKILL.md`.

### Harness self-steering

- **[`spark-steering/`](spark-steering/)** — diagnose which SPARK axis
  (Skills, Personalities, Approaches, Resources, Knowledge) is actually
  short before reaching for a fix, and move only that one: a wrong-axis fix
  stays installed and charges rent every turn. User-invoked
  (`disable-model-invocation`); the judgment lives in the body, the costed
  levers and cost classes in `references/`. Backed by a 373-primitive map
  of Claude Code surfaces (the PCF corpus), kept outside this repo with the
  research paper it belongs to. Canonical form: this `SKILL.md` + its
  `references/`.

## House note — authoring skill bytes

Editing any skill that primes a model's generation invokes Guardrail 15:
the `prompt-engineering` and `hypershot-protocol` skills must be invoked
first and authored against. A skill that is a verbatim mirror of a
user-level copy is kept byte-identical to it; a skill that carries its own
canonical text is the record, and outside copies are regenerated from it.
