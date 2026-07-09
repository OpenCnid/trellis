# workspace-discipline — research provenance

This module is the first product of the capability flywheel (design record
§11 step 6): a protocol module authored by an RLM run, grounded in verified
research substrate, and landed by an operator through the gate.

## Research corpus

The `research.sourceNodeIds` in `module.json` are the block-level AST hashes
of two documents promoted from a Tier-3 workspace into the verified ingest
path (Session 17 promotion CLI, `npm run promote`, extraction policy `none`).
They are Trellis's own workspace research — the owner-supplied corpus the
design record permits when no web-search MCP server is configured:

| Promoted doc key | Root hash | Source |
|---|---|---|
| `research:trellis/workspace-discipline/contract` | `23637ac155b44a71903f79dee28076ae9c445d483599cdf013a4195172293f1b` | design record `WORKSPACE_AND_MODULES.md` §4 (the workspace contract) |
| `research:trellis/workspace-discipline/evidence` | `976f62cefb855e8fc7846b6a551d53b4ef5d7b6e596690a9e58e48918098fe99` | the two measured probe reports (`WORKSPACE_PROBE_REPORT.md`, `WORKSPACE_LINEAGE_PROBE_REPORT.md`) |

Because these doc keys are stable, re-promoting a changed §4 or a revised
probe report versions the same document and the invalidation sweep contests
this module's graph entity (`module:workspace-discipline`) — the flywheel's
research-change contestation (design record §9.4). Recover it by re-reviewing
the protocol against the refreshed research and re-registering.

## Authoring and the operator correction

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
provenance is the provenance the capability actually derives from.
