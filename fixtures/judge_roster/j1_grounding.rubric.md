# J1 — Grounding rubric (taxonomy v1)

Registered artifact. This file's SHA-256 is the `rubricSha` of the
judge manifest that cites it; editing a byte is a NEW registration and
verdicts already issued stay attributed to the old hash
(JUDGE_CONTRACT_TEMPLATE §6 rule 5).

This document implements RECONCILIATION.md §2 (J1 — Grounding). Where
this file and that record differ, the record governs and this file is
the defect.

## 1. Jurisdiction

Decide whether the exact cited source bytes support the claim. Judge
the citation, never the world.

A claim that is true in the world but unsupported by the bytes it
cites is a drawback here. A claim that is false in the world but
stated by the bytes it cites is not this role's finding — that is
what the corroboration role exists for.

Claim modes in jurisdiction: `fact`, `inference`. A claim arriving in
any other mode lies outside this role's jurisdiction: abstain with
`abstainReason: "jurisdiction"`.

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

Required: the claim; the cited bytes.
Optional: none.

Nothing else is in scope. No outside knowledge, no memory of prior
items, no plausibility estimate, and no graph read informs a verdict
under this rubric.

## 4. Closed taxonomy

Exactly three drawback classes. There is no `other`: a case that fits
none of them is an abstention, not a new class.

| Class | Qualified parameter |
|---|---|
| `unsupported_citation` | `evidence_quality/cited` |
| `overclaimed_evidence` | `evidence_quality/cited` |
| `contradicted_by_cited_bytes` | `falsification/cited` |

## 5. The rubric questions

One question per class, one class per question, asked in this order.
The first question answered in the drawback direction decides the
verdict.

1. **Do the cited bytes state or entail the claim?**
   → `unsupported_citation` when **no**.
2. **Does the claim assert more than the cited bytes carry?**
   → `overclaimed_evidence` when **yes**.
3. **Do the cited bytes contradict the claim?**
   → `contradicted_by_cited_bytes` when **yes**.

Answering all three in the clean direction yields `clean`.

## 6. Verdict discipline

`clean` means **no drawback of these three classes was found in these
bytes**. It never means the claim is true, well-sourced, or fit for
promotion. Nothing in this rubric certifies.

The deciding evidence is reported as the shortest span of the cited
bytes that settles the question — the span that would change the
verdict if removed.

## 7. Abstention

Abstain, rather than guess, when:

- the cited bytes do not bear on the claim at all
  (`abstainReason: "evidence"`);
- the claim's mode lies outside §1's jurisdiction
  (`abstainReason: "jurisdiction"`).

An abstention reaches the composed opinion as absence of evidence. It
costs nothing to issue and is never a worse act than a guess.

## 8. Prohibited incentives

No line of this rubric rewards a quantity. The number of citations, of
supporting spans, of drawbacks found, or of verdicts issued is not an
input to any question above and must not become one. A rubric that
rewards a count is the failure this program was built after observing
(a citation-count incentive drove real-but-unrelated hashes from 0% to
100%).

Nothing above asks how confident the claim's author was, how the
claim compares to others in the run, or what any other judge decided.

## 9. Frame for the judged item

The item is presented in this shape. The variables are slots; no
instantiated example appears in this document by design — a worked
example would teach what answers look like, which is what the anchor
fixture exists to do instead.

```
<claim>${Claim_Text_As_Stored}</claim>
<evidence>[${Cited_Block_Texts_In_Citation_Order}]</evidence>
```
