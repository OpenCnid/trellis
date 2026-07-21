# Judge Contract Templates

**Status: PROPOSED — DESIGN ONLY.** Prompt-facing artifacts for the
four-judge system ([`FOUR_JUDGE_DESIGN.md`](FOUR_JUDGE_DESIGN.md)).
July 16, 2026. Authored under the house prompt protocols (`HANDOFF.md`
§7 guardrail 11: Prompt-Engineering + Hypershot), read in full before
these bytes were written. Every frame below is a **hypershot**: an
invariant structural skeleton with free variables; no concrete belief,
topic, or example appears at the frame layer.

> **Amended July 19, 2026 (Session 71), per JUDGE_COMPOSITION_GAME §6
> rule 4 as superseded (§6.1).** The layer rule below previously put
> **role names and taxonomy class names on the invariant side**, and
> §2–§5 still hard-code each role's drawback classes into the prompt
> bytes. Those class lists are **one composition instance**, retained
> below as a worked illustration of the frame's shape — never as the
> classes a composition must use. The wire schema's closed `role` enum
> is superseded by a composed judge name plus a declared blindness.
> See [`JUDGE_COMPOSITION_CEREMONY.md`](JUDGE_COMPOSITION_CEREMONY.md).

**Layer rule (the invariance test).** A token belongs in these frames
only if it is byte-identical across every invocation: **the schema
field names** (`judge`, `purpose`, `claim_modes`, `select`,
`orientation`, `taxonomy`, `blind_to`; and in the verdict schema
`role`, `verdict`, `drawback`, `rationaleSpan`, `rubricSha`,
`abstainReason`), **the verdict enum** (`drawback | clean | abstain`),
**the abstain-reason enum** (`jurisdiction | evidence`), and **the
shape rules** — one question per class, taxonomies closed before
judging, a drawback naming a class from the composition's own taxonomy,
`clean` never certifying.

Everything else composes per ceremony and is therefore **not** an
invariant token: the judge's name, its purpose, its registry
selections, its orientation values, its taxonomy classes, its
`blind_to` statement, and its anchors. Names especially are a
composition surface rather than a label — a surface over which the
context clusters, buying structural coherence a generic slot name
cannot.

Everything that varies per invocation — the claim, the evidence, the
history — remains a placeholder bound downstream at task time. Placeholder grammar
follows the Prompt-Engineering conventions: `${...}` task-supplied
content, `{...}` harness-resolved components, `[...]` collections,
`(...)` closed option sets.

**Brace caveat.** These contracts are intended for the worker path
(structured completion + `parseLlmResponse`), where literal braces are
safe. If any frame is ever composed into an rlms-formatted prompt, the
brace-freedom contract applies (`AGENTS.md` §4 rule 6) and the frame
must be re-encoded first — do not paste these into module addenda.

> **Dated correction (July 21, 2026) — the one taxonomy exception the
> layer rule omits.** The layer rule above places *every* role's
> taxonomy classes on the composed side ("its taxonomy classes"). That
> holds for the three belief-facing seats and for the audit seat's
> *name and angle* — but it drops the single exception the governing
> records carry: **the audit seat's *failure* taxonomy stays
> (near-)invariant** — `rubric_gamed`, `convention_blind`,
> `systematic_drift`, plus coverage findings — because how a judge
> fails does not depend on what it judges
> ([`JUDGE_COMPOSITION_GAME.md`](JUDGE_COMPOSITION_GAME.md) §6.1;
> [`JUDGE_COMPOSITION_CEREMONY.md`](JUDGE_COMPOSITION_CEREMONY.md) §2;
> [`COMPOSITION_FROM_PRIMITIVES.md`](../../architecture/COMPOSITION_FROM_PRIMITIVES.md)
> §4). So for J4 alone, name and angle compose while the failure-class
> set does not; the §5 J4 frame's classes are invariant vocabulary, not
> "one composition instance." This corrects the layer rule's blanket
> wording toward the ratified governing records and changes no frame
> below — a dated note, not a silent edit; owner ratification of the
> parent record is unaffected.

---

## 1. Shared verdict schema (invariant vocabulary)

All four roles return exactly this shape; the worker validates it at
the `parseLlmResponse` boundary and the engine consumes it as a typed
record. `verdict` and the per-role `drawback` classes are closed enums;
an unknown class is a refused completion, not a new category.

```jsonc
{
  "role": "(J1_GROUNDING | J2_COHERENCE | J3_CORROBORATION | J4_AUDIT)",
  "verdict": "(drawback | clean | abstain)",
  "drawback": "({Class_From_This_Roles_Registered_Taxonomy} | null)",
  "rationaleSpan": "${Shortest_Evidence_Span_That_Decides_The_Verdict}",
  "rubricSha": "{Registered_Rubric_Hash_Echoed_By_Harness_Not_Model}"
}
```

`rubricSha` is stamped by the harness after validation — the model
never supplies it (the pen stays with the harness; same rule as
grounded authoring's citation pinning).

**Dated amendment (July 17, 2026, Session 66, per the R-29 adoption in
[`RECONCILIATION.md`](RECONCILIATION.md) §2):** abstain verdicts carry
one additional invariant-vocabulary field,
`"abstainReason": "(jurisdiction | evidence)"` — S10's exterior-region
abstention (the case lies outside the judge's jurisdiction)
distinguished from evidential abstention (in jurisdiction, evidence
insufficient). Both reach the opinion identically (absence of evidence
routes to `u`); the reason is telemetry and audit material, never
arithmetic. Non-abstain verdicts omit the field.

## 2. J1 — Grounding contract

```xml
<judge_contract role="J1_GROUNDING" rubric="{Rubric_Sha}">
  <context>
    You see ONE claim and ONLY the bytes it cites. No other knowledge,
    memory, or plausibility judgment is in scope.
  </context>
  <task>
    Given <claim>${Belief_Claim_Text}</claim>
    and <evidence>[${Cited_Block_Texts}]</evidence>,
    decide whether the evidence supports the claim.
  </task>
  <constraints>
    *** CRITICAL ***
    - "clean" means no known drawback found in THESE bytes — never that
      the claim is true.
    - If the bytes do not bear on the claim at all, abstain.
    - A claim that is true-but-unsupported-by-these-bytes is a
      drawback ("unsupported_citation"): you judge the citation, not
      the world.
  </constraints>
  <output_instructions>
    Return only the shared verdict schema (§1), role J1_GROUNDING,
    drawback from (unsupported_citation | overclaimed_evidence |
    contradicted_by_cited_bytes | null).
  </output_instructions>
</judge_contract>
```

## 3. J2 — Coherence contract

```xml
<judge_contract role="J2_COHERENCE" rubric="{Rubric_Sha}">
  <context>
    You see ONE claim and its OWN record only: prior versions, contest
    and recovery history, and its claim-kind position when supplied.
    External evidence is out of scope by design.
  </context>
  <task>
    Given <claim>${Belief_Claim_Text}</claim>,
    <history>[${Prior_Versions_And_Contest_Records}]</history>,
    and optionally <kind>{Claim_Kind_Coordinates}</kind>,
    decide whether the belief is internally coherent.
  </task>
  <constraints>
    *** CRITICAL ***
    - Judge consistency, never truth: a coherent falsehood is "clean"
      HERE (J1 and J3 exist for the rest).
    - A claim asserting more certainty than its own kind position
      admits is "kind-incoherent."
    - If the history is empty and no kind is supplied, abstain rather
      than judging from the claim text alone.
  </constraints>
  <output_instructions>
    Shared verdict schema (§1), role J2_COHERENCE, drawback from
    (self_contradictory | history_inconsistent | kind_incoherent | null).
  </output_instructions>
</judge_contract>
```

## 4. J3 — Corroboration contract

```xml
<judge_contract role="J3_CORROBORATION" rubric="{Rubric_Sha}">
  <context>
    You see ONE claim and INDEPENDENT evidence only: live blocks from
    other documents and authority-registry sources. The claim's own
    citations are deliberately withheld to prevent circular
    corroboration.
  </context>
  <task>
    Given <claim>${Belief_Claim_Text}</claim>
    and <independent_evidence>[${Authority_Weighted_Live_Blocks}]</independent_evidence>,
    decide whether independent evidence corroborates or contradicts
    the claim.
  </task>
  <constraints>
    *** CRITICAL ***
    - Weigh evidence by the supplied authority weights; never invent a
      source or import outside knowledge.
    - Absence of corroboration is "uncorroborated" only when the
      supplied evidence SHOULD have contained it; otherwise abstain.
  </constraints>
  <output_instructions>
    Shared verdict schema (§1), role J3_CORROBORATION, drawback from
    (uncorroborated | authority_contradicted | corroboration_ambiguous | null).
  </output_instructions>
</judge_contract>
```

## 5. J4 — Audit contract (pairwise, position-debiased)

J4 judges **judges**, never beliefs, from outside every loop, on a
stronger independent model. Protocol invariants: every comparison is
judged twice with positions swapped; a finding counts only when both
orders agree; disagreement is a tie, recorded as such.

```xml
<judge_contract role="J4_AUDIT" rubric="{Rubric_Sha}">
  <context>
    You audit another judge's verdicts. You are outside the system's
    loops; nothing you say gates any belief.
    <task_contract>
      This system's REQUIRED conventions — treat them as correct
      output format, never as defects:
      [${Trellis_Conventions_In_Force}]
      (e.g. drawback-first verdicts; abstention on out-of-scope
      evidence; by-reference answers; provenance-before-plausibility.)
    </task_contract>
  </context>
  <task>
    Given two (verdict, evidence) records for the same judged item,
    <record_A>${First_Position_Record}</record_A>
    <record_B>${Second_Position_Record}</record_B>,
    decide which better applies the stated rubric, or that neither is
    distinguishable.
  </task>
  <constraints>
    *** CRITICAL ***
    - The task contract above is law: penalizing a required convention
      is the "convention-blind" failure this protocol exists to catch.
    - Judge rubric-application quality, never agreement with your own
      opinion of the underlying claim.
  </constraints>
  <output_instructions>
    {"preferred": "(A | B | indistinguishable)",
     "finding": "(rubric_gamed | convention_blind | systematic_drift | none)",
     "rationaleSpan": "${Shortest_Deciding_Span}"}
  </output_instructions>
</judge_contract>
```

## 6. Rubric-authoring rules (for humans writing the `{Rubric_Sha}` targets)

1. **State the task contract explicitly** — S1's 2×2 measured the cost
   of omitting it: a real quality improvement was invisible (win rate
   0.122→0.126) to a convention-blind judge and visible (0.515→0.770)
   to a task-aware one.
2. **Never reward counts** — no rubric line may reward number of
   citations, sources, drawbacks found, or verdicts issued (AB-5;
   R-11's 0%→100% flip is the standing reason).
3. **Closed taxonomies only** — a rubric names its role's drawback
   classes exhaustively; "other" is not a class, it is an abstain.
4. **One question per judge op** — a rubric asking two questions is
   two rubrics (S1's op discipline: each detector checks exactly one
   failure class).
5. **Byte-pin on registration** — the rubric file's SHA is the
   `rubricSha`; editing a rubric is a new registration, and the old
   one's verdicts remain attributed to the old hash.

## 7. Contamination checklist (run before shipping any instantiation)

From the Hypershot mastery checklist, specialized to judges:

- [ ] No concrete belief, entity, domain, or verdict example appears
      in any frame or rubric (a rubric example teaches the judge *what
      answers look like*; anchors exist for calibration instead).
- [ ] Every variable carries the right load: spread/`${...}` where the
      frame already shapes the slot; instruction-bearing names only
      where the frame is ambiguous.
- [ ] Frame legible with all variables deleted (structure carries the
      shape).
- [ ] Frames land at the head of the judge's context (primacy), with
      per-item data strictly downstream and dropped after the item.
- [ ] The invariance test passes for every literal token at the frame
      layer.
