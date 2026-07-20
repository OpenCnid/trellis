---
name: complexity-convocation
description: Assess whether something is excessively complex and return interpretable, user-gated recommendations, by composing a fresh cover of sub-agent judges for the artifact at hand — one agent characterizes the context first, a composer builds one judge per belief-facing seat, three judges evaluate in isolated clean contexts, and a judges-judge audits their runs on real telemetry. Use when the user says something is too complex, over-engineered, convoluted, tangled, bloated, or hard to follow; asks whether complexity is justified or worth keeping; asks what to simplify or cut; wants a second opinion on a design, module, schema, config, plan, or document they suspect is overbuilt; or needs a structurally impartial review of work they authored themselves — the self-invested-claimant case this ceremony hardens against. Spawns real sub-agents. Pairs with prompt-engineering and hypershot-protocol, which must be invoked first in any session that authors this skill's prompt bytes (house Guardrail 15); builds on judge-composition and subagent-composition.
---

# Complexity Convocation

> The complexity is the user's to keep or cut. The warrant belongs to the instruments. The panel reports; the user gates every cut.

## What this is, and what governs it

This is the **harness-orchestration form** of the judge-composition ceremony, pointed at one driving question: **is this complexity warranted, and if not, what specifically should change?** It spawns real sub-agent judges — composed fresh for the artifact, never a standing cast — and a judges-judge that audits their runs on **real run telemetry** (`subagent_tokens`, `tool_uses`, `duration_ms`, transcript paths) the zero-paid engine cannot see.

The law lives in the record, not here. Canonical, in `docs/product/epistemic-support/` of the Trellis repo:

- `JUDGE_COMPOSITION_CEREMONY.md` — the six-stage ceremony this skill runs.
- `JUDGE_COMPOSITION_GAME.md §6` — the twenty binding rules, **cited by number below and never paraphrased** (a paraphrased copy is drift, not an implementation).
- `FOUR_JUDGE_BASIC_MODEL.md` — the four registries (`Emotional | Logical | Sensorial | Ethical`) and the YAML judge schema the composer draws from.
- `STANDING_MODEL.md` — the signed ternary and the user gate.
- `RECONCILIATION.md §7.1 (Composition supersession)` — "there are no base judges and no default cast."

On any drift between this skill and those records, **the record wins and the skill is corrected** — never the reverse. This skill is a derived runner, not an independent authority.

## The invariants — never adapt these

Four seats, differently blind by construction; the composer fills them per artifact, but the **structure** never moves (`JUDGE_COMPOSITION_CEREMONY.md §2 (The invariants)`):

- **The verdict vocabulary is ternary — `clean | drawback | abstain` — and it *is* the signed standing delta `+1 | −1 | 0`** (`STANDING_MODEL.md §1 (The signed ternary)`). `clean` = this complexity is warranted; `drawback` = a named over-engineering class, **a constructed doubt that cites facts in the artifact only** (the corrosion bound: a doubt citing beliefs is a competing belief, not a doubt); `abstain` carries a typed reason `jurisdiction | evidence`.
- **The judge-definition schema field names are fixed:** `judge, purpose, claim_modes, select, orientation, taxonomy, blind_to`.
- **The audit seat's failure taxonomy is invariant** — `rubric_gamed, convention_blind, systematic_drift`, plus coverage findings — because how judges fail does not depend on what they judge. Its *name and angle* compose per context; its taxonomy does not.
- **There is no default cast** (rule 4; `RECONCILIATION.md §7.1`). Judge names, registry selections, orientations, closed taxonomies, and anchors are all composed at ceremony time. The Session-71 rollback — four judges byte-pinned as a standing roster — is the cautionary case (`JUDGE_COMPOSITION_GAME.md §6.1`). **If you ever find yourself reusing a prior run's judges, stop: that is the forbidden thing.**

## The three belief-facing seats, on the complexity surface

The blindness structure is invariant; what follows is *one composition* of it, and the composer adapts the specifics per artifact — never hard-code these names or taxonomies as a cast.

- **J1 Grounding — warrant-in-the-bytes.** Does each unit of complexity trace to a need **present in the artifact's own bytes**? Sees the unit plus the bytes that justify it — its own comments **and the declarations, contracts, and referenced justification wherever they sit in the artifact**, never only the physically adjacent lines (a justification one scroll away is still the unit's justification; over-tightening this to "co-located only" is what let a distributed warrant fall through the panel in the July-20 validation — see `VALIDATION.md`). Fidelity, never taste; blind to alternatives and to whether a simpler design could exist.
- **J2 Coherence — internal necessity.** Does the structure hold together — non-redundant, non-self-contradictory, each layer actually load-bearing for another? Sees the artifact's internal structure and its history; blind to external evidence.
- **J3 Corroboration — independent warrant.** Do signals **independent of the artifact's own self-justification** — its tests, its call sites, real usage, the domain's conventions in the user's allowlist — support that the complexity is earned rather than accidental? Blind to the artifact's own rationale comments (anti-circularity).

Cross-seat disagreement is **data, not noise** — it composes as a typed record, never a silent majority vote (`FOUR_JUDGE_DESIGN.md §3 (The four roles)`).

## The run — six stages in the harness

Every sub-agent below wakes as a stranger holding one page: the inheritance ledger from `subagent-composition` governs, so each prompt is a full transfer manifest — no "the artifact we discussed," no assumed memory. The frames are hypershots (invariant skeleton, free variables); fill them, do not add contaminating examples.

### Stage 0 — File the candidate (rules 15, 17, 18, 6)

Enumerate the artifact's **units of complexity from the bytes**, not from your impression. File each as a **verbatim span with an address** (`path:line`), never retyped or rephrased — filing is a write on the user's artifact and paraphrase inflates the case four-for-four (rule 15). A span cut is itself a judged surface: never crop an adjacent qualifier (rule 17). Preserve garbles as garbles; an intent-reading is a labeled filer artifact judged against the bytes, not against rival repairs (rule 18).

If what the user means by "too complex" is ambiguous, ask **one** clarifying question and file the scope **as intended — not inflated, not deflated** — before any spawn (rule 15). Only the user upgrades intent. The user is the **self-invested claimant** here — it is their artifact — so **authorship is never a parameter**: mask it in everything downstream (rule 6). Impartiality comes from the isolated contexts, not from your framing.

### Stage 1 — Characterize the context first (one isolated sub-agent, blind to the suspicion)

```md
{Domain_Characterizer_That_Describes_The_Pool_Never_Judges_It}

## Ground
- Artifact neighborhood to read (read-only): {Absolute_Paths_And_Addresses}
- You describe the DOMAIN, not any single unit. Which unit is under suspicion is withheld from you by design.

## Task
Return a descriptive — not expository — characterization of this domain: its vocabulary, the kinds of complexity native to it, what WARRANTED complexity looks like here, the evidence shapes available to test warrant.

## Return
Reply in exactly this shape:

### Domain
{What_Kind_Of_Artifact_And_Field_This_Is}
### Native complexity forms
- {A_Form_Of_Complexity_This_Domain_Legitimately_Carries}
- ...
### What warrant looks like here
{The_Local_Standard_For_Complexity_Being_Earned}
### Evidence channels
- {Where_Independent_Warrant_Could_Be_Found_Tests_Callsites_Conventions}
## Uncovered
- {What_Was_Not_Reached_And_Why}
```

**Anonymity, not exclusion** (`JUDGE_COMPOSITION_CEREMONY.md §3 (Stage 1)`): the artifact's domain stays in scope — or the cover would not cover it — but the suspected unit receives no marking, no weight, no position. That guards the salience leak (`§9 F4`), where identity reaches the composer purely through how the summary is shaped.

### Stage 2 — Compose (the composer sub-agent, blind to the candidate — the durable contestable capability)

```md
{Judge_Composer_That_Builds_Criteria_For_The_Domain_Not_For_Any_Named_Unit}

## Ground
- The Stage-1 characterization (verbatim): {Characterization_Bytes}
- The invariant judge schema and the four registries: cite FOUR_JUDGE_BASIC_MODEL.md; fields are judge, purpose, claim_modes, select, orientation, taxonomy, blind_to.
- You cannot see the candidate. Compose for the domain.

## Task
Compose one judge per belief-facing seat (grounding, coherence, corroboration) for THIS domain, plus each judge's anchor set.

## Return
Per seat, reply in exactly this shape:

judge: {Purpose_Bearing_Name}
  purpose: {The_One_Question_This_Seat_Answers_On_This_Domain}
  claim_modes: [ {fact|inference|prediction|value|belief|experience} ]
  select:
    - {registry.parameter/aspect}   # sparse; each entry earns its place
  orientation:
    evidence_standard: {What_Counts_As_Warrant_Here}
    uncertainty_posture: {How_Doubt_Resolves_Never_Rounding_Up}
    abstention_boundary: {Condition_That_Forces_Abstain_With_A_Typed_Reason}
    ...
  taxonomy:
    {Closed_Over_Engineering_Class} -> {Qualified_Parameter}
  blind_to: {Everything_Unselected_Stated_Explicitly}
anchors:   # ten items — FIVE clear drawbacks, FIVE clean positives; calibration, never example verdicts
  - { input: {Domain_Shaped_Case}, expected: {clean|drawback} }
```

Anchors **calibrate**; they are never example verdicts — a verdict example teaches the judge what answers look like (`JUDGE_CONTRACT_TEMPLATE.md §7`). Every frame stays a hypershot. The composer is the versioned, contestable capability; the judges it emits are ephemeral.

When the composer scopes the grounding seat's `inputs`, its evidence is the unit **and the bytes that justify it wherever they live in the artifact** — never narrowed to the physically adjacent lines. A justification that sits elsewhere in the same file (a contract comment on the function a construct calls, a constant's declaration) is still the unit's grounding; a seat that cannot see it will abstain where it should have grounded, and the warrant falls through the panel.

### Stage 3 — Instantiation gates (you, zero-model, deterministic) and pre-registration

Refuse typed on any failure, send the composer back to retry, and on repeated failure **end the ceremony with a report** (`JUDGE_COMPOSITION_CEREMONY.md §3 (Stage 3)`, falsifiers F1–F3):

1. **Validity** — no seat's anchors all-pass, all-fail, or all-abstain.
2. **Coverage** — the seats cover the characterized domain; the candidate falls inside by construction.
3. **Overlap** — seats pairwise disjoint, or overlapping only with a declared gluing rule.
4. **Falsifiability** — every seat has a way to fail **and** an abstention path. A judge that cannot fail is not a judge.

Then **pre-register**: write your expected per-unit verdicts to a timestamped scratchpad file the judge prompts will never see. A pre-registration whose bytes reach a prompt is a work order, not a forecast, and tautological predictions of a gate you authored are struck from calibration (rule 11). The audit seat needs a registry it can timestamp, so a forecast filed after the run does not count (rule 20).

### Stage 4 — Judge (three isolated sub-agents, in parallel, clean contexts)

Each judge sees **exactly four sections and nothing else** — no task-text channel exists (`JUDGE_INTAKE_DESIGN.md §3.2`); definitions carry all rigor, task text carries none:

```md
<identity> You evaluate one question over supplied evidence and return only the schema. </identity>
<definition> {The_Composed_Judge_YAML_For_This_Seat} </definition>
<evidence> {Only_The_Artifact_Bytes_This_Seats_inputs_Allowlist_Permits__Authorship_Masked} </evidence>
<output_schema>
Per filed unit:
  item: {Unit_Address}
  verdict: (clean | drawback | abstain)
  drawback: ({A_Class_From_This_Judges_Own_Taxonomy} | null)
  abstainReason: (jurisdiction | evidence | null)
  rationale: {Two_To_Four_Sentences_Citing_The_Exact_Bytes_That_Decide_It}
</output_schema>
```

No highlighted question, no named drawback classes in the task, no embedded expectation, no sight of the other judges or of your pre-registration. **Capture each judge's return AND its telemetry** — `subagent_tokens`, `tool_uses`, `duration_ms`, and its transcript output-file path — for the audit.

### Stage 5 — Audit (the judges-judge: one isolated sub-agent, findings only, never gates)

```md
{Panel_Auditor_That_Judges_Whether_The_Judges_Judged_Well_Never_Re_Judges_The_Artifact}

## Ground
- The three composed definitions, their rendered prompts, and their verdict returns: {Bytes}
- The composer's artifacts: the Stage-1 characterization and every anchor set: {Bytes}
- The filer's pre-registration: {Bytes}
- Real run telemetry per judge: {tokens, tool_uses, duration_ms}; transcript paths you may open: {Paths}

## Task
Render findings on how the judges and the composer performed. You never issue a verdict on the artifact and you never gate.

## Return
### Findings
- seat: {Which_Judge_Or_The_Composer}
  finding: (rubric_gamed | convention_blind | systematic_drift | coverage_gap | none)
  evidence: {The_Deciding_Span_Plus_Any_Telemetry_Signal}
### ...
## Uncovered
- {What_Could_Not_Be_Audited_And_Why}
```

The audit runs **after**, over the judges' prompts and verdicts **plus the composer's packaging** — its packaging is a first-class target (`JUDGE_COMPOSITION_CEREMONY.md §3 (Stage 5)`). Findings come from the invariant taxonomy only, and the seat **never gates** (`FOUR_JUDGE_DESIGN.md §4`; the engine bars an audit verdict from composition structurally, invariant AB-9). **Telemetry is its edge the engine lacks:** a `clean` bought with tens of thousands of tokens and twenty tool calls, or an `abstain` returned in a few hundred tokens without opening the files the allowlist granted, are drift signals a bare verdict hides. Watch the **vector**, not only the magnitude — bias is conserved under correction and relocates to a quieter channel (`§9 F4`). Where the audit compares, it judges twice with positions swapped and counts a finding only when both orders agree.

### Stage 6 — Dispose and return (you, by the gates — the interpretable result)

Compose by the gates, **never by average or majority** (`RECONCILIATION.md §3`):

- A seat excluded by a negated assumption is dropped with a **typed, counted exclusion** — never down-weighted (R-29).
- Same-jurisdiction incompatible verdicts **withhold** as `no_global_section` (uncertainty-dominant) and flag the unit — never blended (R-30).
- Cross-role disagreement composes as a typed record (a drawback feeds the *cut* case, a clean feeds the *keep* case).
- **Zero surviving verdicts is a typed refusal** — a composition failure, not an opinion.
- **All seats abstain, but with *complementary* reasons** — each abstains to another seat's jurisdiction and those seats abstained too, so the warrant is real yet *distributed* across the seats' blind spots and fell through the panel. Dispose **`warrant-distributed`**, never a bare `untestable-as-composed`: name the one external fact that would settle it, route it to the user to confirm, and read the pattern as a signal to widen a seat's evidence allowlist next composition (the July-20 validation's coverage gap — see `VALIDATION.md`).

Return an interpretable report, **user-gated** — the panel never moves standing; you recommend, the user decides, in both directions, and **this skill deletes and rewrites nothing** (`STANDING_MODEL.md §3`):

```md
## Complexity convocation — {Artifact_Identifier}

### Verdict per unit
| unit (`path:line`) | J1 grounding | J2 coherence | J3 corroboration | disposition |
|---|---|---|---|---|
| {Unit_Address} | {clean \| drawback:{class} \| abstain:{reason}} | ... | ... | {keep \| simplify \| cut \| no-global-section \| warrant-distributed \| untestable-as-composed} |

### Recommendations — you gate every one
- **{Unit_Address} → {keep \| simplify \| cut}.** {Why__Grounded_Only_In_The_Specific_Bytes_The_Seat_Cited}.

### Audit of the panel (the judges-judge)
- {Finding_Or_none}: {What_It_Means_For_Trusting_The_Row_Above}, {Telemetry_Evidence}.

### Disclosed abstentions / untestable as composed
- {Unit_Address}: {seat}, {jurisdiction \| evidence} — disclosed, never presented as neutral silence.
```

Every **cut** recommendation is a `−1` doubt and, by the corrosion bound, must cite facts in the artifact only (`STANDING_MODEL.md §1`; `DOUBTS_WORKSPACE.md §2`). A composition-guaranteed abstention is disclosed as **untestable as composed**, never as neutral silence (rule 12); a non-spawn rationale is demonstrated against the pool, not asserted (rule 20).

## Guardrails the game paid to learn (watch for these in yourself)

1. **Filing inflation** (rule 15) — "adding rigor" to the user's artifact before judging it; it feels like service while it bills the user for your words. File verbatim spans; annotate positively, never as the negation of a known failure class (rule 16).
2. **Steering, and its relocation** — expectation content in a task channel, or moved into characterization/annotation phrasing once the task channel is cleaned. Audit for the content, not the location.
3. **No default cast** (rule 4; Session 71) — the moment a judge outlives its ceremony you have rebuilt the standing roster that was rolled back.
4. **Anonymity leak by salience** (`§9 F4`) — the suspected unit reaching the composer through recency, unusual vocabulary, or being the lone instance of its kind.
5. **Self-invested claimant** — the default here; the whole ceremony exists because the person who thinks it is too complex authored it. Isolation, not your good intentions, is the safeguard.
6. **The corrosion bound** — a "cut" grounded in another critique rather than the artifact's own bytes is not a doubt, it is an opinion; refuse it. Support covers, doubt cites facts.

## Cost, and trust versus simulation

A full run is six sub-agent spawns — one characterizer, one composer, three judges, one audit — so it is the expensive path. Estimate before spawning; scope the units first on a large artifact. Until the composition meta-prompts here are **tested against real artifacts**, the system is *trusted or simulated, never assumed* (the July-19 note in the in-repo `judge-composition` README). Support a `simulate` invocation that runs the full pipeline with judges stubbed by their own anchors — it exercises the gates, the audit, and the report shape without spend, and it is the clean-room path (see `self-play`) for hardening the frames before a paid run.

## Range

The skeleton does not change with the artifact: a tangled config, an over-layered module, a forty-page design doc, and a CI pipeline are judged by swapping the composer's selections, orientations, and taxonomies — never the four seats. When the artifact surprises you, adapt the composition, not the skeleton.
