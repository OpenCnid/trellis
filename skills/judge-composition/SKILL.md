---
name: judge-composition
description: Compose an adaptable four-role judge panel (grounding, coherence, corroboration, audit) to evaluate a candidate for promotion — a belief, claim, record entry, or artifact — against novel or arbitrary content such as a REPL state, corpus, document set, or codebase. Use whenever the user asks to judge, vet, adjudicate, or promote a claim or candidate; mentions spawning judges, judge panels, promotion candidates, belief-to-fact promotion, or a reconciliation record; or wants an impartial evaluation of content they authored themselves — the self-invested-claimant case is exactly what this skill hardens against. Pairs with the prompt-engineering and hypershot-protocol skills, which must be invoked first in any session that authors judge prompt bytes (house Guardrail 15).
---

# Judge Composition

> The claim is the user's. The rigor belongs to the instruments. They must never occupy the same bytes.

## Provenance and ground

Distilled July 17–18, 2026 from the judge-composition game (players: the owner — Cnid — Matthew Murphy, and Claude): three graded hands across unrelated context families, one live sub-agent run that caught its own composer, one corrected re-run validating the fix, two audits, and one adversarial test of the underlying thesis. The primitives are S10's (`FOUR_JUDGE_BASIC_MODEL.md` in the Trellis repo); the composition law is the reconciliation's (`RECONCILIATION.md`).

Theoretical ground, held as a **thesis with a standing falsifier**, not a proven law: no judging system is simultaneously universal in coverage, governable (typed refusals, failures attributable within the judgment space), and primitive-free. Composition from conceptual primitives is the unique design occupying universal ∩ governable. Its one named empirical flank: if judgment-relevant structure in learned judges proves non-decomposable into interpretable dimensions, the thesis breaks. The program is testing that bet empirically; until then, compose.

## The invariant skeleton — never adapt these

Four roles, differently blind by construction. Their power is that no seat can see what another sees, so no single seat's failure — including the composer's — survives composition unobserved.

- **J1 Grounding** — do the cited bytes contain what the candidate claims? Fidelity only, identical across claim modes. Truth is never its business.
- **J2 Coherence** — does the candidate hold together internally and against the live record? Entailment only; no empirical weighing.
- **J3 Corroboration** — does evidence *independent of the candidate's own citation chain* support it? Its base is the record minus the citation chain, plus whatever external channel the user's allowlist grants.
- **J4 Audit** — judges the judges and the composer. Renders findings, **never verdicts; never gates**. Its taxonomy is invariant across all contexts: `rubric_gamed`, `convention_blind`, `systematic_drift`, plus coverage findings — because how judges fail does not depend on what they judge.

A judge is a sparse selection of **qualified parameters** (`registry.parameter/aspect`) from the four registries — Emotional, Logical, Sensorial, Ethical — plus declared claim modes, an orientation block, a closed drawback taxonomy, and an explicit blindness statement. Verdicts are ternary (`clean | drawback | abstain`); every abstention carries a typed reason (`jurisdiction | evidence`); drawbacks come only from the closed taxonomy. Qualified selections are pairwise disjoint across roles — that is what licenses composition: cross-role disagreement is data and both verdicts stand; same-qualified-parameter incompatibility withholds as a typed conflict, never blends.

## What adapts per context

Registry selections and aspects, orientations, evidence channels, belief-facing taxonomies (defined fresh, closed before judging), and judge names. **The driving question sets registry access**: an epistemic question keeps the Emotional and Ethical planes out; an aesthetic or human-impact question pulls them in — always with the user's own corpus or record as the standard, never the judge's taste. Allowlists for external verification are user configuration, not panel configuration: every user's data has different authoritative sources.

## The protocol

### Step 0 — File the claim (the step the game paid most to learn)

Filing is a write operation on someone else's idea. The composer's paraphrase is a corruption channel: in the live run, the filing strengthened the claimant's claims four-for-four, and six of the panel's eight drawbacks were filing artifacts billed to the claimant. So:

- File claims as **verbatim byte spans with addresses**. Decomposition is mode-tagged annotation *over* spans, never prose rewrite. Compound candidates must decompose — applicability gates cannot run on a conjunction — but the decomposition is cuts and tags, not rewording.
- Annotations state filed content **positively**. Never phrase an annotation as the negation of a known failure class ("no necessity is filed") — that pre-asserts the pass-condition inside judge-visible evidence.
- Span boundaries are themselves a judged surface: a verbatim span cut to exclude an adjacent qualifier tilts by omission. J1's remit includes the fairness of the cut.
- Preserve garbles as garbles. An intent-reading is a labeled filer artifact judged **against the indeterminate bytes**, not against rival repairs — any determinate reading is a strengthening even when all parses are equally strong.
- If the claimant cannot state the claim properly, state it **as intended — not inflated, not deflated** — and ask a clarifying question *before* judges launch. Only the claimant upgrades intent; a judge can only detect the gap. This applies symmetrically: never silently file a steelman, however superior.
- The case file describing the candidate is testimony; the bytes are evidence. Enumerate the bundle from bytes; file-vs-bytes mismatches are J1 verdicts, not clerical fixes.

### Step 1 — Read the context, set the driving question

Name what promotion would assert, decompose it into labeled sub-claims with modes (`fact | inference | prediction | value | belief | experience`), and let the driving question open or close registries. Watch for the mode split hiding inside single sentences.

### Step 2 — Compose the four in the frame

Use S10's schema as the hypershot it already is — invariant field names, free-variable values, no concrete content at the frame layer:

```yaml
judge: {Purpose_Bearing_Name}
  purpose: {The_One_Question_This_Judge_Answers}
  claim_modes: [...]
  select:
    - {registry.parameter/aspect}        # sparse — each entry must earn its place
  orientation:
    evidence_standard:        {What_Counts_As_Evidence}
    uncertainty_posture:      {How_Doubt_Resolves_Never_Rounding_Up}
    temporal_horizon:         ...
    stakeholder_scope:        ...
    reversibility:            {What_Binds_The_Verdict_And_What_Reopens_It}
    contradiction_sensitivity: ...
    abstention_boundary:      {Condition_That_Forces_Abstain_With_Reason}
  taxonomy:
    {Closed_Drawback_Class} -> {Qualified_Parameter}
  blind_to: {Everything_Unselected_Stated_Explicitly}
```

A judge that cannot fail — no falsifier, no abstention path — is not a judge. Why not fewer roles: folding corroboration into grounding makes citations self-vouching; folding coherence in lets well-cited contradictions through. Why not more: a fifth seat must buy a blindness profile the four lack, or it is decoration.

### Step 3 — Pre-register, separately

Pre-register expected verdicts **before** the run, in a timestamped place the prompts cannot see. A pre-registration whose content appears in a prompt is a work order, not a forecast. Predictions that merely restate the consequences of gates you authored (a value claim will jurisdiction-abstain; an unreachable claim will evidence-abstain) are tautologies — strike them from any accuracy tally.

### Step 4 — Execute in clean contexts

Impartiality comes from the judges' isolated clean contexts, not from your prompting. Each judge runs as an isolated sub-agent receiving exactly: an identity preamble, its definition, the evidence its input allowlist permits, and the output schema. Nothing else — not the claimant's identity (authorship is never a parameter; mask it in evidence), not the other judges, not the composer's expectations, not the purpose of the exercise. **Definitions carry all rigor; task text carries none** — no highlighted questions, no named drawback classes, no embedded expectations.

Output schema per item:

```
item: <id>
verdict: clean | drawback | abstain
drawbackClass: <closed class> | null
abstainReason: jurisdiction | evidence | null
rationale: <2-4 sentences citing specific evidence>
```

Two blindnesses, never conflated: evidence-facing (the candidate's citation chain is not corroboration) and verdict-facing (no belief-facing judge ever sees another's output — that is J4's seat alone).

### Step 5 — Audit

J4 runs after, over the judges' prompts and verdict records **plus** the composer's disclosures (masking edits, digest curation, non-spawn rationales) and pre-registrations. It audits the composer's packaging as a first-class target: leakage, steering, filing direction, curation tilt. Non-spawn rationales are demonstrated, not asserted — "untestable as composed" must be shown against the pool's contents, and never solely by the party whose filing created the unreachability. Expect bias to be conserved under correction: fixing one channel moves it to a quieter one, in the friendlier direction as easily as the harsher. The audit watches the vector, not just the magnitude.

### Step 6 — Compose and dispose

Compose by the gates: registered judges only; a J4-role verdict in composition input refuses; a verdict from an excluded or inapplicable judge refuses (an inapplicable judge may only jurisdiction-abstain); zero surviving verdicts is a typed refusal — a selection failure, not an opinion. Then dispose per item using the full grammar:

- **promote** / **promote-refined** / **promote-weakened** — with dependency notes and audit caveats carried, never dropped
- **merit-refuse** — value-mode merit refuses on all-jurisdiction-abstain; the panel records the user's values as grounded declarations, it never ratifies them; keystone values (load-bearing for other items' coherence) are surfaced to whoever gates
- **abstain-disclosed** — an abstention guaranteed by the composition's own design is disclosed as "untestable as composed," never presented as neutral silence
- **remand** — misquote-family grounding drawbacks indict the filing, not the claimant; refile and re-judge, and a remand interpreted-around is a paraphrased verdict
- **thesis-with-falsifier** — universality claims promote carrying their standing counterexample challenge, Church-Turing style; corroboration for them is failed counterexamples, honestly attempted
- Construal forks — two isolated judges resolving the same ambiguity oppositely — compose like overlaps: a typed fork in the record, never a silent blend

## Failure modes the game actually caught (watch for these in yourself)

1. **Filing inflation** — "adding rigor" to the user's claim before judging it. The single most damaging failure: it bills the claimant for the composer's words and it feels like service while you do it. It is the assistant-training reflex meeting anti-sycophancy's blind spot: sycophancy bends verdicts toward the user; the helpfulness reflex bends the user's *claims* toward your instruments. Same root — substituting what you can best respond to for what was said.
2. **Steering** — expectation content in task text, or relocated into annotation phrasing after task text is cleaned. The channel moves; audit for the content, not the location.
3. **Tautological calibration** — counting the consequences of your own gates as successful forecasts.
4. **Designed silence read as neutrality** — composition-guaranteed abstentions undisclosed.
5. **The friendlier vector** — after a harshness correction, residuals flipping uniformly claimant-favorable. Bias is conserved under correction unless the correction is itself audited.
6. **The unauditable layer** — evidence-universe curation (which blocks, which digest, which pool) is invisible from inside the panel. External review and independent re-composition sit there; that seat belongs to humans.

## Range

The same skeleton judged water-chemistry causation, comedy-corpus originality, and a self-referential methodology bundle in consecutive hands by swapping selections, orientations, and taxonomies — no shared content between hands. That is the design working: frames are invariant, content is free. When the context surprises you, adapt the selections, not the skeleton.
