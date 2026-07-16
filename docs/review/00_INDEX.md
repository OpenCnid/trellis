# Trellis Deep-Review Paper Series — Index

Five in-depth papers analyzing OpenCnid's Trellis repository (Recursive Language Model runtime), written July 16, 2026, as an external review by the sister research lab. Every claim was verified against the repository code and documentation at commit `841f875`; uniqueness verdicts were additionally checked against 2022–2026 prior art via web search. Read in any order; each paper is self-contained.

This series is review material only: it adds `docs/review/` and deliberately modifies no system files, no doctrine documents, and no code. It does not follow the `HANDOFF.md` session protocol because it is not session work.

| # | File | Subject | Words | Bottom line |
|---|------|---------|-------|-------------|
| 1 | `01_GENUINELY_UNIQUE.md` | **Genuinely unique** — prior-art audit of six claimed-unique mechanisms | 4,754 | Only the capability flywheel ("capabilities are beliefs") is fully UNIQUE; grounded authoring, the retrieval-membership gate, and code-mediated text are unique-as-synthesis; two mechanisms have real peers. |
| 2 | `02_NOVEL_WITH_PRECEDENT.md` | **Novel with precedent** — seven strong mechanisms with identifiable lineage | 5,054 | The pattern is "transplantation under pressure": mature systems-software ideas (Merkle identity, truth maintenance, single-writer journals) re-derived for a trust model where the untrusted component is the LLM. |
| 3 | `03_VAPORWARE_AUDIT.md` | **Vaporware** — forensic audit of fourteen specified-but-unrun surfaces | 4,285 | 12 of 14 gaps are honestly DECLARED in-repo; exactly one (the $1.12/query → 26× economics baseline) grades MISLEADING-BY-OMISSION. The perfect-F1 headline rests on the one corpus the authors admit is gameable. |
| 4 | `04_IMPROVEMENT_ROADMAP.md` | **Improvement roadmap** — prioritized, effort-tagged fixes for an adopting lab | 4,545 | Tier 1: break the total OpenAI lock-in, fix the in-process credential "sandbox," de-fragilize the rlms coupling. Tier 2: a ~$150 measurement campaign converts directional findings into defensible ones. |
| 5 | `05_FUTURE_IMPLICATIONS.md` | **Future implications** — what this means for agent-systems research | 4,933 | The durable contribution is method, not results: harness-as-experimental-subject, memory-as-epistemic-liability, self-improvement-as-chain-of-custody. Closes with 3 bets to make now, 2 to wait on, 1 to avoid. |
| 6 | `06_EPISTEMIC_SUPPORT_PROPOSAL.md` | **Design-record proposal** — an epistemic-support axis (graded, judged belief standing) orthogonal to the custody tiers | — | Adds a subjective-logic support opinion computed by anchor-disciplined drawback-detector metrics (guided by arXiv:2607.12790), judges registered as capabilities under the invalidation sweep, an authority registry for verifiable claims, and a human-gated automation ladder. Proposal for OpenCnid review, not implementation. |

**Follow-on program:** the epistemic-support design work that grew out
of paper 5 and document 06 now lives as its own program under
[`docs/product/epistemic-support/`](../product/epistemic-support/PROGRAM_CONTEXT.md)
(evidence register, four-judge design, judge contract templates, oracle
drill — all proposals).

## Cross-cutting synthesis

- **The single most valuable transferable finding** (papers 1, 5): provenance laundering is incentive-driven — a count-shaped incentive flipped it 0%→100% in an agent that knew the right answer; prompt discipline and readership gates did not stop it; only semantic entailment gating held 0% everywhere. Generalized rule: never attach an incentive to a countable proxy without a semantic gate behind it.
- **The deepest idea** (paper 1): registering the system's own prompt modules as provenance-bearing graph entities so the ordinary invalidation sweep contests a *capability* when its research basis dies — no known peer system does this.
- **The biggest credibility gap** (paper 3): every headline number is n=1–2, on synthetic self-graded corpora, and the anti-shortcut v2 benchmark that would actually test the flywheel has never been run.
- **The cheapest fix with the highest payoff** (paper 4): ~$150 of paid runs (v2 benchmark, repeated drills, n≥10 probe arms) using the project's own harnesses would settle most open questions.
- **The strategic read** (paper 5): if the harness-engineering methodology replicates, agent labs will need to run controlled experiments on their harnesses the way they do on models — and Trellis is the earliest working example of what that practice looks like.
