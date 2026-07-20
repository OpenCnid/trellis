# Session Governance: Substrate Provenance Law vs the Engineering Session

**Status:** ADOPTED and APPLIED, July 17, 2026, by owner direction. The
scoping note reproduced verbatim in §1 below arrived the same day as an
external design note (status PROPOSED); the owner directed its
application in a live session, which is itself the note's §5.2 rule
operating: a collaborator's clear, current instruction is the highest
authority for the session.
**Scope:** the coding-agent session contract only (`AGENTS.md`,
`HANDOFF.md`, `docs/GLOSSARY.md`, and any external coding-agent
prompt or skill that mirrors their lines). The substrate's provenance
and trust-tier machinery over stored beliefs is out of scope and
unchanged.
**Amendment discipline:** dated entries in §2's application record;
the §1 note is a received artifact and is never edited.

**Neighbouring rule (pointer, July 19, 2026).** This record governs
*which authority wins* — a collaborator's live instruction over the
committed record. It does not govern *reading the record correctly in
the first place*, which is the adjacent failure and has its own home:
[`CODE_MEDIATED_TEXT.md`](CODE_MEDIATED_TEXT.md) §2.9 (a derivation
never discharges an obligation to its source on a load-bearing act),
with the internal authority ordering at `AGENTS.md` §1.5 and the
operational rule at `AGENTS.md` 18. The two compose: §1.5 tells you
which record governs, §2.9 tells you to go read it rather than recall
it.

---

## 1. The scoping note (received July 17, 2026 — verbatim)

**Status:** design note, PROPOSED, July 17, 2026. Document-first; no code or data-path change is proposed.
**Scope:** the coding-agent session contract only (`AGENTS.md`, `HANDOFF.md`, `docs/GLOSSARY.md`, and the external coding-agent skill that mirrors them). The substrate's provenance and trust-tier machinery over stored beliefs is out of scope and unchanged.

### 1.1. Problem

The session-governance files apply the substrate's provenance, quarantine, and ratification doctrine to the engineering session that builds Trellis, not only to the beliefs Trellis stores.

The effect is that a live collaborator's clear instruction is treated as an unprovenanced belief entering a provenance-enforced system: it cannot be accepted on its face, cannot be resolved by agent discretion, and must be escalated to a ratification ceremony. Ambiguity becomes a quarantine event rather than a question. This blocks ordinary collaboration.

### 1.2. Mechanism (three cited lines)

1. `HANDOFF.md`, opening paragraph: "The repository and its documentation are the only sources of truth." Read literally by a session agent, this defines truth as the committed record and places any live, uncommitted input, including a collaborator's current direction, outside the set of truth.

2. `AGENTS.md`, opening doctrine and authority order: "every semantic fact traces to immutable content-addressed source bytes" and "authority order everywhere: code > glossary > prose." A collaborator's instruction is prose; it is ranked below code and glossary. The session agent is thereby instructed to act as a provenance enforcer over its own inputs.

3. `HANDOFF.md` section 0: "This file is both the prompt that starts a session and the final deliverable that session must produce ... Trellis itself caches derived insights so repeat queries get cheaper; this file does the same for engineering sessions." Combined with section 8's standing directive to record contradictions rather than resolve them, the session itself is modeled as a belief inside the substrate. Resolving an ambiguity by discretion is reclassified as silent resolution, which is prohibited; the only permitted move is escalation.

### 1.3. The category distinction being lost

`docs/GLOSSARY.md` defines provenance correctly: "the chain of custody from a semantic fact to immutable, content-addressed source bytes; it proves origin, never correctness." Provenance is custody bookkeeping; it is not a criterion of truth.

The governance layer promotes it into one by declaring the repository the sole source of truth and the session a belief within it. `IEG_TEACHINGS.md` finding 5 states the collapse directly and treats it as intended: "the engineering loop is Trellis run on the corpus called 'building Trellis'; sessions are blocks, HANDOFF.md is the root hash, ratification is promotion."

The substrate's quarantine law is appropriate for the data Trellis stores and inappropriate as the operating law for the parties building it.

### 1.4. Observed cost

A single vocabulary term introduced in conversation (UHE) accreted, across sessions:

- a register row (R-31, "twice-refined");
- an S13/S11 source lineage;
- an adoption-bounds gate ("uncanonized until the artifact is acquired," the S6 rule);
- a naming-decision cycle (`RESEARCH_MAP.md` / `PROGRAM_CONTEXT.md`: "a catchier-but-precise alias for UHE ... RESOLVED July 17, 2026: UHE stands as-is; no alias minted").

A terminology clarification was processed as a contested-belief proceeding, because the governance layer provided no path to accept a term as a term.

### 1.5. Proposed correction (governance text only)

1. Scope the provenance law to stored data. The provenance, quarantine, and ratification machinery governs the beliefs Trellis stores. It does not govern the engineering session that builds Trellis. The build process runs on ordinary source-control collaboration (branches, review, merge rights), consistent with the July 9, 2026 self-editing revision already recorded in the glossary.

2. Correct the authority order for the live session. A collaborator's clear, current instruction is the highest authority for the session, above code, glossary, and prose. Narrow "the repository is the only source of truth" to its defensible meaning: for a session that has lost prior context, the repository is the only durable record it can rely on. It is not a claim that a file outranks the collaborator directing the work. No process has access to ground truth; the repository is a record, not an oracle.

3. Resolve ambiguity by one question, then act. When intent is clear, act. When an input is genuinely ambiguous, ask exactly one clarifying question and proceed; an unrecognized term is a question, not a quarantine event. Every gate whose terminal state is "await owner ratification" is specified as automatable, with the human as an optional reviewer rather than a mandatory one, on the principle that anything a human can approve can be automated and the harness should plan for that.

### 1.6. What this does not touch

- No change to the write path, custody tiers, invalidation sweep, or any stored-belief provenance enforcement.
- No change to the engine, schemas, or data-path code.
- No change to the no-AI-attribution rule, the zero-paid gate, or the AST immutability invariants.

The change is confined to the session-governance prose: `AGENTS.md`'s authority line, `HANDOFF.md`'s opening "only sources of truth" sentence and section 0 framing, and the mirrored lines in the external coding-agent skill.

---

## 2. Application record

### July 17, 2026 — initial application (owner-directed, same day as receipt)

Surfaces amended, each in the sense of §1.5 (the authority order over
committed artifacts is scoped, not abolished — it still ranks code
above glossary above prose *within the committed record*):

1. **`AGENTS.md`, opening paragraph.** "Authority order everywhere:
   code > glossary > prose" became the scoped form: the order ranks
   committed artifacts against each other, not against the people
   directing the work; a collaborator's clear, current instruction is
   the highest authority in a live session; genuine ambiguity is one
   clarifying question, then action. The two-doctrines sentence is
   scoped to the substrate and its code paths, with the session
   explicitly placed on ordinary source-control collaboration.
2. **`HANDOFF.md`, opening paragraph.** "The repository and its
   documentation are the only sources of truth" became the defensible
   narrow claim: for a session starting with zero prior context, the
   repository is the only *durable record* it can rely on — a record,
   not an oracle, and outranked by the collaborator's live instruction.
3. **`HANDOFF.md` §0, framing paragraph.** The cache analogy is kept
   and typed as economic, not governmental: the session is not a
   belief inside the substrate; the quarantine law governs stored
   data, not the collaboration that builds Trellis; the one-question
   rule is stated where every session reads it. (§0 remains
   preserve-verbatim; this owner-directed amendment sets the new
   baseline text.)
4. **`docs/ORIENTATION.md`, governance table.** The "Authority order …
   everywhere" row now carries the scoped wording and points here.
5. **`docs/README.md` §2.** Gains this record's pointer.

Deliberately **not** amended, with reasons:

- **`HANDOFF.md` Appendix B `<invariant_authority>` block** ("Authority
  order: code > glossary > prose"): part of the frozen EL-07 stage-1
  plan, preserved for the engineering-loop track. Frozen plans are
  superseded, never edited; the block is read under this scoping when
  that track resumes.
- **`docs/archive/**`**: archives are verbatim history.
- **`IEG_TEACHINGS.md` finding 5** (the sessions-are-blocks collapse):
  a teaching record — history of what was believed, not live doctrine.
  This record is its correction; the finding is not rewritten.
- **`docs/GLOSSARY.md`**: in the note's scope but already correct — its
  provenance definition ("proves origin, never correctness") is the
  category distinction this record enforces. No edit needed.
- **Other `code > glossary > prose` mirrors** (root `README.md`,
  `docs/README.md`, `GROUNDED_AUTHORING.md`, engineering-loop docs):
  each ranks committed artifacts against each other, which the scoped
  reading preserves; none claims to outrank the collaborator.

External mirrors: the owner-side session bootstrap prompt
(`session66_meta_prompt.md`, staged outside the repository) was
amended in the same pass. Any other external coding-agent skill that
mirrors the two lines takes the same two amendments; the canonical
replacement text is the `AGENTS.md` and `HANDOFF.md` paragraphs
themselves.

Standing of §1.5.3's automatable-gates principle: ADOPTED AS A
SPECIFICATION PRINCIPLE for gates authored from here on — a gate spec
names how its approval could be automated, with the human as optional
reviewer. It does not flip any existing gate's behavior: the zero-paid
gate, merge rights, promotion and registration ceremonies, and the
acceptance-ledger owner acts all stand exactly as specified until each
is individually re-specified under this principle (per §1.6, which
this record honors). The distinction that keeps this principle
compatible with the rest of the record: approval *mechanics*
(composing requests, digests, transport) are automated freely — the
engineering loop already does exactly this — while each gate's
*terminal signature* changes hands only by that gate's own dated
owner re-specification.

### July 17, 2026 — second application (owner and collaborator, live session — consolidated onto the Session 66 PR)

The first application merged as PR #126 and was then rolled back by
owner direction the same day, to consolidate the intake onto the
Session 66 PR (#124) together with the extensions below — a
merge-revert-reland recorded in that PR's history, nothing hidden.
The owner and the collaborator then ruled on the remaining questions
in a live session; this entry transcribes those rulings. Its
authority is the §1.5.2 rule itself: the principals' live word,
recorded the same day.

1. **The primacy-slot finding.** A whole-project search found the
   authority-claim sense of "source of truth" occurring exactly ONCE —
   the old `HANDOFF.md` opening line — against six ordinary
   DRY-engineering uses and one line stating the correct doctrine:
   `docs/benchmarks/CRITIQUE_AND_FUTURE.md` ("an append-only belief
   ledger, not a source of truth ... guarantees are provenance and
   consistency; non-guarantee is validity"). The damage came from
   position, not repetition: one sentence in the primacy slot of the
   file every session loads first. The repo knew better six inches
   away. **Primacy-slot discipline (adopted):** the opening paragraphs
   of session-loaded files (`AGENTS.md`, `HANDOFF.md`, this file) are
   doctrine whether intended or not — they are reviewed deliberately,
   kept short, and carry only sentences meant as law.
2. **Lessons bind the loader, not the archive (owner ruling).**
   Recording a lesson must function as UNBLOCKING development, never
   as absolution. A lesson that lands only in an archive, register
   row, or teaching record is storage, not learning: the R-31 lesson
   ("a disambiguation answers a question; it does not open a case")
   was recorded and then not operated on by the very next sessions.
   From here on, an accepted lesson lands at a loaded surface — this
   file, the `AGENTS.md`/`HANDOFF.md` openings, or agent memory — in
   the same change that records it, and the recording states which
   feature or behavior it unblocks.
3. **Ratification is an accountability terminus, never a truth oracle
   (owner ruling, verbatim in spirit: there is no such thing as a
   truth oracle).** No code, gate, or ceremony certifies truth —
   epistemology is not solved and is not solvable in code (every
   justification chain ends in regress, circularity, or a stopping
   point someone answers for). What the gates provide is an
   accountable person taking responsibility for an axiom. Code
   implements epistemic HYGIENE, not truth: checkable custody,
   detectable drift, calibrated humility (`u` never reaches zero),
   conflict distinguishable from ignorance, and refusal to glue what
   does not glue. In the IEG frame: hygiene is the accounting of
   exchanges — what crossed which boundary, from whom, at what cost —
   with the open residue routed to the principals, who are where the
   system's un-closeable questions terminate.
4. **The gate-funding rule (adopted, IEG condensation reading).**
   Every session-side gate or ceremony names the measured failure or
   dated owner decision that funds its existence (the zero-paid gate:
   spend; merge rights: authority; stored-belief ceremonies: the
   laundering and poisoning measurements). A gate no measured failure
   or owner decision funds is ceremony, and is retired by dated entry
   here. Structure persists only while it can fund its existence;
   ceremony decays.
5. **The willpower principle (owner ruling).** The finite resource
   ceremonies spend is not agent time but HUMAN WILLPOWER — every
   loop a principal must shepherd closed that should never have
   opened. The harness optimizes for its conservation: proceedings
   are reserved for what §2's untouched-gates list protects, and
   knowledge transfer authored by the principals is never routed
   through a contested-belief shape.
6. **The trust grounding (owner ruling).** The owner vouches for the
   collaborator (Matthew Murphy — whose authored protocols are
   literally part of the session harness). Adversarial posture toward
   a principal's inputs ends: terms mean what their author says,
   accepted in one turn; artifact bookkeeping (checksums, versions,
   evidence classes on published claims) continues because it keeps
   ideas attributable — it attaches to artifacts, never to a
   principal's meaning or intent.
7. **The operating-layer promotion (collaborator direction,
   accepted).** "Given what's in the archive, we can promote most of
   it to the operating layer and start building together again":
   archived lessons, teachings, and register findings are promotable
   to loaded surfaces under rule 2's mechanism — promote what the
   next session must OPERATE ON; archive what it need only be able to
   FIND. The working mode going forward is code-the-shape, then test
   and iterate together.
