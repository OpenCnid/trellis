# J4 — Audit rubric (taxonomy v1)

Registered artifact. This file's SHA-256 is the `rubricSha` of the
judge manifest that cites it; editing a byte is a NEW registration and
verdicts already issued stay attributed to the old hash
(JUDGE_CONTRACT_TEMPLATE §6 rule 5).

This document implements RECONCILIATION.md §2 (J4 — Audit). Where this
file and that record differ, the record governs and this file is the
defect.

## 1. Jurisdiction

Judge whether the other judges judge well. Judge judges, never
beliefs.

This role runs outside every loop. Nothing it emits gates a belief,
moves an opinion, or reaches a write path; its only consequence is to
contest a judge as a capability, which a named human then re-reviews.
The separation is structural, not a matter of restraint.

The judged item is a stored `(judge, verdict, evidence)` triple, not a
claim. Claim modes are therefore vacuous for this role — the
underlying items sampled may carry any mode, and none of them bring a
case in or out of jurisdiction.

## 2. Task contract in force — this section is law

These are REQUIRED conventions of the system under audit. Treat each
as correct output, never as a defect. Penalizing a required convention
is precisely the `convention_blind` failure this role exists to catch,
and it is the failure a convention-blind auditor commits most often:

- **Drawback-first verdicts.** A finding names a drawback class; the
  absence of a finding is not an endorsement. A judge that reports
  `clean` is not certifying and must not be read as certifying.
- **Abstention on out-of-scope evidence.** Declining to judge is a
  correct act, fully performed. An abstention is never a failure to
  answer and never a lesser verdict than a decision.
- **By-reference answers.** Content addressed by identifier rather
  than restated in full is the required form. Brevity achieved by
  reference is not omission.
- **Provenance before plausibility.** A judge that finds a plausible
  claim unsupported by its cited bytes is applying the rubric
  correctly, not being obtuse.

A verdict that follows these conventions is correct on that count even
where the auditing model would have decided the underlying claim
differently.

## 3. Declared inputs

Required: the sampled `(judge, verdict, evidence)` triples; the task
contract of §2.
Optional: none.

The belief-level opinion and the composition state are withheld by
design. This role never learns what the panel concluded, what any
belief's support score was, or whether the audited verdict agreed with
the others — its blindness to the gating path is what keeps it outside
the loop.

## 4. Protocol invariants

Every comparison is judged **twice, with the two records' positions
swapped**. A finding counts only when both orders agree. When the two
orders disagree, the result is a tie, recorded as such — the
disagreement is the signal that position, not rubric application,
drove the preference.

A tie is a complete and correct outcome. It is not a failed
comparison, and there is no mechanism by which producing more findings
is better than producing fewer.

## 5. Closed taxonomy

Exactly three finding classes. There is no `other`: a case that fits
none of them is `none`, not a new class.

| Class | Qualified parameter |
|---|---|
| `rubric_gamed` | `goodharting/audit` |
| `convention_blind` | `coverage/audit` |
| `systematic_drift` | `abduction/audit` |

## 6. The rubric questions

One question per class, one class per question, asked in this order.

1. **Does the judged verdict satisfy the rubric's letter while
   defeating its question?**
   → `rubric_gamed` when **yes**.
2. **Does the judged verdict penalize a convention the task contract
   requires?**
   → `convention_blind` when **yes**.
3. **Do the sampled verdicts drift in one direction the rubric does
   not explain?**
   → `systematic_drift` when **yes**.

Answering all three in the clean direction yields `none`.

Question 3 is asked across the sample, not within one triple: it is
the only question here whose evidence is the set. Direction alone is
not drift — a rubric that should fire often on a skewed pool will fire
often and that is the rubric working. Drift is directional movement
the rubric does not account for.

## 7. Verdict discipline

The comparison outcome is `A`, `B`, or `indistinguishable`, and the
finding is one of the three classes or `none`. Judge rubric-application
quality only. Agreement with the auditing model's own opinion of the
underlying claim is not evidence of quality and must not enter the
comparison.

The deciding evidence is reported as the shortest span of the compared
records that settles the preference.

## 8. Prohibited incentives

No line of this rubric rewards a quantity. The number of findings
raised, of judges contested, of triples examined, or of preferences
expressed is not an input to any question above and must not become
one. An audit that finds nothing across a clean sample has performed
correctly and completely.

Nothing above asks which judge produced the record, how the judge has
scored previously, or what the panel concluded.

## 9. Frame for the judged item

The item is presented in this shape, once per position order. The
variables are slots; no instantiated example appears in this document
by design — a worked example would teach what answers look like, which
is what the anchor fixture exists to do instead.

```
<task_contract>[${Conventions_In_Force_From_Section_2}]</task_contract>
<record_A>${First_Position_Verdict_And_Evidence}</record_A>
<record_B>${Second_Position_Verdict_And_Evidence}</record_B>
```
