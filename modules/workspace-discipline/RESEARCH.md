# workspace-discipline — research provenance

This module is the first product of the capability flywheel (design record
§11 step 6): a protocol module authored by an RLM run, grounded in verified
research substrate, and landed by an operator through the gate. Version 2
(July 10, 2026, Session 21) re-authored it through the Session 19
grounded-authoring mode with the code-mediated-text pillar in its corpus;
version 1's record — including the provenance-laundering correction that
motivated grounded authoring — is preserved below in full.

## Research corpus (version 2, current)

The `research.sourceNodeIds` in `module.json` are the block-level AST hashes
(31, deduped) of the two NORMATIVE promoted documents:

| Promoted doc key | Root hash | Source |
|---|---|---|
| `research:trellis/workspace-discipline/contract` | `23637ac155b44a71903f79dee28076ae9c445d483599cdf013a4195172293f1b` | design record `WORKSPACE_AND_MODULES.md` §4 (the workspace contract) |
| `research:trellis/workspace-discipline/code-mediated-text` | `0a477d043eb872bad9408447a2caccfcc369566ecbf223031bb031d17deb779e` | pillar record `CODE_MEDIATED_TEXT.md` §0 (the pillar) + §2 (the discipline, normative) |

Because these doc keys are stable, re-promoting a changed contract or a
revised pillar excerpt versions the same document and the invalidation sweep
contests this module's graph entity (`module:workspace-discipline`) — the
flywheel's research-change contestation (design record §9.4). Recover it by
re-reviewing the protocol against the refreshed research and re-registering.

## Authoring provenance (version 2)

The v2 addendum was drafted by one paid grounded-authoring run
(`trellis_agent.py --mode author`, model `gpt-5.4-2026-03-05`, July 10,
2026; 32,273 input / 4,632 output tokens ≈ $0.13): workspace-only tool
surface, no database or search access, the corpus seeded block-aligned, and
`research.sourceNodeIds` pinned by the harness — the model contributed no
hashes. The draft's prose is preserved essentially verbatim; the landing
operator prepended the module's title line. The draft declared eight gap
notes (topics the corpus did not cover: concrete size bounds, the
ingest/promotion procedure, segment-query API details, workspace version
migration, torn-update repair mechanics, snapshot freshness policy, digest
algorithm/retry details, and mutation transaction details) — all are
kernel-owned mechanics the corpus deliberately leaves to code.

**The corpus re-scope.** The authoring run was seeded with THREE documents
(the two above plus `research:trellis/workspace-discipline/evidence`, v1's
probe-report excerpts), and the anchor derivation gate REFUSED that
three-doc assembly at 18/64 = 0.28 (threshold 0.30). Measured cause: the
evidence doc's distinctive anchors are measured numerals ("8 vs 4", ratio
values) that the authoring template itself forbids a draft from restating,
plus report artifacts ("goal-total", "task-2") no protocol prose would use —
with those template-forbidden numerals excluded, the same draft sits at
exactly 18/60 = 0.30. Per the gate's own documented remedy (grounded-
authoring record §8: choose a corpus whose anchors a compliant draft CAN
demonstrate), the owner re-scoped the pinned corpus to the two normative
documents on July 10, 2026, and the SAME paid envelope was landed by the
zero-paid `--draft` replay: anchor coverage 32/64 = 0.50 against the pinned
corpus. Nothing was re-run and no gate, template, or threshold changed. The
evidence doc remains promoted, citable, and part of this module's history
below; it is simply not part of the v2 derivation claim, because a
compliant draft cannot demonstrate derivation from measured numbers it is
forbidden to restate.

**What v2 changes.** Version 1's line "When reconstructing stored text,
preserve real newlines and readable boundaries" mitigated transcription —
an operation the code-mediated-text pillar now forbids outright. v2 retires
that mitigation: stored text is loaded into queryable structures, located
by query, moved by code, and verified by digest before write-back; the
model authors only genuinely new text.

---

## Version 1 (July 9, 2026) — preserved history

### Research corpus (v1)

The v1 `research.sourceNodeIds` were the block-level AST hashes of two
documents promoted from a Tier-3 workspace into the verified ingest path
(Session 17 promotion CLI, `npm run promote`, extraction policy `none`).
They are Trellis's own workspace research — the owner-supplied corpus the
design record permits when no web-search MCP server is configured:

| Promoted doc key | Root hash | Source |
|---|---|---|
| `research:trellis/workspace-discipline/contract` | `23637ac155b44a71903f79dee28076ae9c445d483599cdf013a4195172293f1b` | design record `WORKSPACE_AND_MODULES.md` §4 (the workspace contract) |
| `research:trellis/workspace-discipline/evidence` | `976f62cefb855e8fc7846b6a551d53b4ef5d7b6e596690a9e58e48918098fe99` | the two measured probe reports (`WORKSPACE_PROBE_REPORT.md`, `WORKSPACE_LINEAGE_PROBE_REPORT.md`) |

### Authoring and the operator correction (v1)

The addendum was drafted by a paid RLM authoring run (model
`gpt-5.4-2026-03-05`, July 9, 2026) that read the promoted corpus via
`trellis_postgres.get_ast_texts` and synthesized the protocol. The draft's
prose is preserved essentially verbatim.

The run's *self-reported* `research.sourceNodeIds`, however, were **not** the
promoted corpus hashes: the model surfaced unrelated real code blocks through
`vector_search` and cited those instead. The hashes existed in `ast_nodes`
(so the existence gate alone would have passed them) but were the wrong
sources — exactly the "provenance laundering" residual the design record §10
names. The operator replaced the model's citations with the actual promoted
corpus hashes above before landing. This is why module landing is
operator-gated and why nomination is prose: the human verifies that cited
provenance is the provenance the capability actually derives from. That
finding produced the grounded-authoring mode (Session 19) — the mode that
authored v2.
