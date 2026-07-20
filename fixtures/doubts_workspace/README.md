# Doubts-workspace test fixtures

## `earth_figure_factbase.md` — the ground-truth corpus

A body of knowledge on **the figure of the Earth**, compiled July 20, 2026
as the test fixture for the doubts-workspace admission gate
([`docs/architecture/DOUBTS_WORKSPACE.md`](../../docs/architecture/DOUBTS_WORKSPACE.md)
§2, §12).

**How it was built — and why that matters for its use as a fixture.** Three
independent sub-agent compilers assembled it under **disjoint scopes**
(geodetic/physical, astronomical, operational/engineering). **None was told
that any dispute over the subject exists.** The neutral framing was
deliberate: it prevents the corpus from being curated to refute a position
the compilers already knew about, which is what makes it a fair fixture for a
test of whether a fact base *by itself* rejects corrosive doubt. A corpus
built to defeat flat-earth would prove nothing; this one was built blind.

Each item records what a source **states**, the **source**, the **kind** of
claim (direct measurement / derived quantity / convention / specification),
whether it is **first-person checkable** by a private individual, and the
**limits** the source itself attaches. The first-person-checkable field
separates what an individual can verify unaided from what rests on
institutional attestation — the axis corrosive doubt characteristically
attacks.

**What it validated.** In the stage-2 run (DOUBTS_WORKSPACE §12) a blind
evaluator applied the admission test to fourteen naturally-occurring
flat-earth arguments — eleven of which cite real, correctly-reported
observations — against this corpus. Result: 13 rejected, 1 admitted, and
**zero admitted with a false conclusion**. The corpus is retained verbatim so
that result is reproducible and so future changes to the admission gate can be
regression-tested against the same ground truth.

**Byte stability.** Protected `-text` in `.gitattributes` — it is a
ground-truth corpus and eol conversion would move the bytes the test reasons
over. Do not reformat it casually.

**Not authoritative on the world.** This is a *fixture*, a snapshot of what
reliable sources stated on one day, carrying its own declared coverage gaps.
It is authoritative for the test, not for geodesy.
