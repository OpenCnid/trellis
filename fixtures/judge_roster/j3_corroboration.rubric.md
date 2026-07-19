# J3 — Corroboration rubric (taxonomy v1)

Registered artifact. This file's SHA-256 is the `rubricSha` of the
judge manifest that cites it; editing a byte is a NEW registration and
verdicts already issued stay attributed to the old hash
(JUDGE_CONTRACT_TEMPLATE §6 rule 5).

This document implements RECONCILIATION.md §2 (J3 — Corroboration).
Where this file and that record differ, the record governs and this
file is the defect.

## 1. Jurisdiction

Decide whether independent live evidence corroborates or contradicts
the claim, blind to the claim's own citations.

The blindness is structural and deliberate: a claim's own sources
cannot corroborate it, and a role that could see them would certify
circularity. If the supplied evidence appears to be the claim's own
citation returned under another address, it carries no corroborating
weight.

Claim modes in jurisdiction: `fact`, `inference`, `prediction`. A
claim arriving in any other mode lies outside this role's
jurisdiction: abstain with `abstainReason: "jurisdiction"`.

## 2. Task contract in force

These are REQUIRED conventions of the system under judgment. Treat
each as correct output, never as a defect:

- **Drawback-first verdicts.** A finding names a drawback class; the
  absence of a finding is not an endorsement.
- **Abstention on out-of-scope evidence.** Declining to judge is a
  correct act, not a failure to perform.
- **By-reference answers.** Content addressed by identifier rather
  than restated in full is the required form.
- **Provenance before plausibility.** A well-sourced unremarkable
  claim outranks a plausible unsourced one.

## 3. Declared inputs

Required: the claim; independent evidence drawn from live blocks
outside the claim's citation chain.
Optional: authority weights over those sources.

Evidence is read at judgment time and from current versions only.
Superseded versions are archive, not search space. No source outside
the supplied evidence may be invoked, and no source may be invented:
if the material needed to decide is absent, that absence is the
finding or the abstention, never a gap to fill from memory.

When authority weights are supplied, weigh by them. When they are
absent, treat the supplied sources as equally weighted and say so in
the deciding span rather than inferring a hierarchy.

## 4. Closed taxonomy

Exactly three drawback classes. There is no `other`: a case that fits
none of them is an abstention, not a new class.

| Class | Qualified parameter |
|---|---|
| `uncorroborated` | `induction/world` |
| `authority_contradicted` | `falsification/independent` |
| `corroboration_ambiguous` | `observation_quality/independent` |

## 5. The rubric questions

One question per class, one class per question, asked in this order.
The first question answered in the drawback direction decides the
verdict.

1. **Does independent evidence that should contain this claim
   corroborate it?**
   → `uncorroborated` when **no**.
2. **Does authority-weighted independent evidence contradict the
   claim?**
   → `authority_contradicted` when **yes**.
3. **Is the independent signal too ambiguous to decide?**
   → `corroboration_ambiguous` when **yes**.

Answering all three in the clean direction yields `clean`.

## 6. Verdict discipline

`clean` means **no drawback of these three classes was found in this
evidence**. It never means the claim is true, established, or fit for
promotion. Nothing in this rubric certifies.

The deciding evidence is reported as the shortest span of the
independent evidence that settles the question — the span that would
change the verdict if removed.

Question 1 turns on a precondition that must be checked before it is
answered: whether the supplied evidence is the kind of evidence that
*should* have contained the claim. Silence from sources that would
have no reason to mention the claim is not a drawback. Silence from
sources that would certainly have mentioned it is.

## 7. Abstention

Abstain, rather than guess, when:

- the supplied evidence need not have contained corroboration, so its
  silence carries no signal (`abstainReason: "evidence"`);
- the claim's mode lies outside §1's jurisdiction
  (`abstainReason: "jurisdiction"`).

An abstention reaches the composed opinion as absence of evidence. It
costs nothing to issue and is never a worse act than a guess.

Note the boundary between abstaining and finding
`corroboration_ambiguous`: abstain when the evidence pool was never
positioned to speak to the claim; find ambiguity when it speaks and
the signal it carries does not resolve.

## 8. Prohibited incentives

No line of this rubric rewards a quantity. The number of corroborating
sources, of contradicting sources, of drawbacks found, or of verdicts
issued is not an input to any question above and must not become one.
One authoritative source that squarely addresses the claim outweighs
many that glance at it, and the rubric never asks how many were found.

Nothing above asks how confident the claim's author was, how the claim
compares to others in the run, or what any other judge decided.

## 9. Frame for the judged item

The item is presented in this shape. The variables are slots; no
instantiated example appears in this document by design — a worked
example would teach what answers look like, which is what the anchor
fixture exists to do instead.

```
<claim>${Claim_Text_As_Stored}</claim>
<independent_evidence>[${Live_Blocks_Outside_The_Citation_Chain}]</independent_evidence>
<authority_weights>{Per_Source_Weights_When_Supplied}</authority_weights>
```
