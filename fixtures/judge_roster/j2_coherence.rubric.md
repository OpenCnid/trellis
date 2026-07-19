# J2 — Coherence rubric (taxonomy v1)

Registered artifact. This file's SHA-256 is the `rubricSha` of the
judge manifest that cites it; editing a byte is a NEW registration and
verdicts already issued stay attributed to the old hash
(JUDGE_CONTRACT_TEMPLATE §6 rule 5).

This document implements RECONCILIATION.md §2 (J2 — Coherence). Where
this file and that record differ, the record governs and this file is
the defect.

## 1. Jurisdiction

Decide whether the belief is internally coherent across its own
record. Judge consistency, never truth.

A coherent falsehood is `clean` under this rubric. An incoherent truth
is a drawback under it. The roles that judge whether a claim is
supported or corroborated are separate and run blind to this one.

Claim modes in jurisdiction: `fact`, `inference`, `prediction`,
`belief`. A claim arriving in any other mode lies outside this role's
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

A record that shows a claim contested and later recovered is the
system's designed lifecycle, not evidence of instability. Supersession
is how this substrate stores change; a superseded version is archive,
and its existence is never itself an inconsistency.

## 3. Declared inputs

Required: the claim; its own record — prior versions, contest and
recovery history.
Optional: the claim-kind position, when supplied.

External evidence is out of scope by design. No independent source,
no corroborating document, and no citation target informs a verdict
under this rubric.

## 4. Closed taxonomy

Exactly three drawback classes. There is no `other`: a case that fits
none of them is an abstention, not a new class.

| Class | Qualified parameter |
|---|---|
| `self_contradictory` | `consistency/internal` |
| `history_inconsistent` | `consistency/history` |
| `kind_incoherent` | `constraint_satisfaction/kind` |

## 5. The rubric questions

One question per class, one class per question, asked in this order.
The first question answered in the drawback direction decides the
verdict.

1. **Does the claim contradict itself?**
   → `self_contradictory` when **yes**.
2. **Does the claim contradict its own prior record?**
   → `history_inconsistent` when **yes**.
3. **Does the claim assert more certainty than its kind position
   admits?**
   → `kind_incoherent` when **yes**.

Answering all three in the clean direction yields `clean`.

## 6. Verdict discipline

`clean` means **no drawback of these three classes was found in this
record**. It never means the claim is true, supported, or fit for
promotion. Nothing in this rubric certifies.

The deciding evidence is reported as the shortest span — of the claim
or of its record — that settles the question. When the finding is a
contradiction between two places, the span is the one that cannot be
reconciled with the other.

## 7. Abstention

Abstain, rather than guess, when:

- the history is empty and no kind position is supplied, so the only
  available material is the claim text alone
  (`abstainReason: "evidence"`);
- the claim's mode lies outside §1's jurisdiction
  (`abstainReason: "jurisdiction"`).

An abstention reaches the composed opinion as absence of evidence. It
costs nothing to issue and is never a worse act than a guess.

## 8. Prohibited incentives

No line of this rubric rewards a quantity. The number of prior
versions, of contests survived, of recoveries recorded, or of
drawbacks found is not an input to any question above and must not
become one. A long history is not a worse record than a short one,
and a claim is never penalized for having been revised.

Nothing above asks how confident the claim's author was, how the
claim compares to others in the run, or what any other judge decided.

## 9. Frame for the judged item

The item is presented in this shape. The variables are slots; no
instantiated example appears in this document by design — a worked
example would teach what answers look like, which is what the anchor
fixture exists to do instead.

```
<claim>${Claim_Text_As_Stored}</claim>
<history>[${Prior_Versions_And_Contest_Records_Oldest_First}]</history>
<kind>{Claim_Kind_Coordinates_When_Supplied}</kind>
```
