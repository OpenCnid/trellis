# MCP Server Surface: Serving Trellis over MCP

**Status:** proposed design record (document-first), for owner review and sequencing. Written July 13, 2026. It specifies a still-open item, Trellis serving the Model Context Protocol, recorded in [`docs/archive/ROADMAP_HISTORY.md`](../archive/ROADMAP_HISTORY.md) as an open non-goal and owner-invited July 13, 2026. Not yet sequenced; no implementation, drills, or paid runs are claimed here.
**Scope:** a new server surface that lets an external MCP host call Trellis. It reuses, and does not modify, the MCP client ([`src/rlm/trellis_mcp.py`](../../src/rlm/trellis_mcp.py), [`src/config/mcp_servers.ts`](../../src/config/mcp_servers.ts)), the A2A server ([`src/core/a2a/`](../../src/core/a2a/)), the goal loop, and the RLM read and answer surfaces.
**Parent doctrine:** [`PROVENANCE_THREADING.md`](PROVENANCE_THREADING.md) (every served fact traces to content-addressed bytes) and [`CODE_MEDIATED_TEXT.md`](CODE_MEDIATED_TEXT.md) (answers by reference, never retyped). The operator-gated posture of the MCP client is mirrored here in the opposite direction.

---

## 1. Problem statement: the direction that is missing

Roadmap row 8 built external integration in two landed slices: the operator-configured MCP client (`trellis_mcp.py`, Session 10; stdio and Streamable HTTP since Session 12), and the A2A server (Session 11), which exposes the bounded goal loop to other agents behind the existing gates and bounds. The third direction is unbuilt: Trellis serving MCP, so an ordinary MCP host (Claude Desktop, Cursor, VS Code, an Antigravity agent, a custom client) can call Trellis as a tool.

The capability exists internally; only the envelope is missing. The A2A server is the proof of shape: a served surface over the goal loop, gated, bounded, and zero-paid-drilled. Serving MCP is the same move in a second protocol. This record specifies that surface as a thin, operator-gated adapter over surfaces that already exist. It proposes no change to how Trellis reasons, retrieves, or writes.

Honest scope: this exposes existing capability over a new protocol. It adds no reasoning power, and it widens nothing a caller may learn beyond what the goal loop and the read surfaces already return. The provenance and spend invariants that bind an A2A run or a local run bind a served MCP call identically.

## 2. What is served, and what is not

The server exposes one capability, in two shapes, both already load-bearing internally.

- A question answered over the substrate (primary). The host submits a goal; Trellis runs the bounded goal loop (the Session 9 orchestrator over the RLM) and returns the answer the loop produces. The answer is provenance-bearing by construction: it is assembled through `trellis_answer` (answers by reference), and every `sourceNodeIds` element is a real, retrieved AST hash, under the write and answer discipline in PROVENANCE_THREADING.md, unchanged. This is the A2A server's capability, re-served over MCP.
- Direct read (secondary, open decision O1). Whether the Tier-1 read tools (`get_ast_texts`, `get_ast_blocks`, `vector_search`) are exposed to external hosts, or held back so the goal loop is the only served entry, is flagged here rather than settled (§7).

Never served: the write path (`write_derived_insight` and the promotion bridge), any Tier-3 workspace surface, the module registry, and anything that mutates state. A served MCP call is read-and-answer only. The server is a peer of the A2A server, not a new authority.

## 3. The provenance boundary

The MCP client established the structural rule in its direction: MCP tool output is counted by `_count_mcp_call()`, never `_count_tool_call()`, so external tool results can never satisfy or masquerade as `sourceNodeIds` provenance (the split is the enforcement, not a prompt instruction; see the `trellis_mcp.py` docstring). The server direction carries the mirror invariant.

- A served answer's citations are the goal loop's own `sourceNodeIds`, each resolvable to a content-addressed AST node. They are not synthesized for the host, and they are not weakened at the boundary.
- Citation payloads travel as structured data beside the answer; each carries its content address (the AST hash) so the host can resolve the exact bytes. Resolution is by reference (an MCP resource, §4.3), never by the server inlining and re-serializing store contents into the response; the CODE_MEDIATED_TEXT.md rule against a persistent in-memory mirror of a store holds across the boundary.
- The verified-ingest invariant is untouched: content that arrives through the server (a host's question text) is input, never a citable source. Only bytes that passed the ingest transaction can be cited, exactly as today.

## 4. The surface

### 4.1 Target standard and transports
Target the current stable MCP revision, `2025-11-25`. Mirror the client's transport decisions so both directions share one posture: Streamable HTTP as the sole remote transport (single endpoint) and stdio for hosts that spawn Trellis as a subprocess; HTTP+SSE is not used, exactly as the client already refuses it. Whether v1 ships both transports or Streamable HTTP first is open decision O2.

### 4.2 Tools (model-controlled)
- `query`: submit a goal; receive the goal loop's provenance-bearing answer with its citation set. Bounded by the existing per-goal limits enforced on the goal loop; progress streams over the transport's notification channel. This is the A2A capability re-served, and it is the reason the surface exists.
- The Tier-1 read tools are exposed or withheld per O1.

### 4.3 Resources (application-controlled, the citation surface)
- `trellis://kb/node/{hash}`, plus the entity and schema catalogs, resolve a citation to its content-addressed record. A `query` result returns citation addresses; the host fetches full records by reference through these resources and caches them. This keeps the tool surface small, keeps the citation surface explicit, and keeps the answer channel free of inlined store bytes (§3).

### 4.4 Prompts
None in v1.

## 5. Enforcement: behavior, tooling, pin

Per the change triple (AGENTS.md §3): behavior is enforced by tooling shape and detected by a pin; prompt text does not carry it.

| Behavior wanted | Tooling that enforces it | Pin that detects drift |
|---|---|---|
| Server is off unless an operator turns it on | `TRELLIS_MCP_SERVER_ENABLED` gate (kernel, not model-writable); unset means no server is bound, behavior byte-identical to today | zero-paid drill: byte-identical API with the flag unset |
| A served call is read-and-answer only | the server binds only the goal loop and, per O1, the read tools; the write path and Tier-3 surfaces are never wired in | drill: the served surface exposes no write or mutation tool |
| Served citations resolve to real content-addressed bytes | citations are the goal loop's `sourceNodeIds`, resolved through resources; nothing is inlined | drill: every served citation resolves; none is synthesized |
| A host token is never confused with a Trellis credential | the server validates inbound auth against its own resource identity; no inbound token is forwarded onward (the client's no-passthrough rule, mirrored) | drill: audience-binding rejection of a mis-issued token |
| Config that passes one validator passes the other | a Zod schema in `src/config/` with a bound-for-bound Python twin, in the `mcp_servers.ts` pattern | twin-validator unit pins on both sides |

Bounds reuse the client's constants: per-call timeout 10s default and 300s max; result 64KB default and 4MB max; plain http restricted to loopback, RFC1918, or dot-free hosts. Any server or tool name stays locked to the client's charset (`^[a-z][a-z0-9_-]*$`).

## 6. Auth and security (v1)
- Reuse the existing API-key protection middleware and layer the MCP resource-server posture over it: validate that an inbound token is issued for the Trellis MCP server's own resource URI (audience binding), publish the protected-resource metadata, and keep the issuer stable.
- Mark host-supplied content as untrusted input in the server's reasoning path (indirect-injection defense); the goal loop and the provenance discipline are the confused-deputy defenses.
- No token passthrough. The v1 server has no downstream to forward to; the rule becomes load-bearing only if the dual-role stretch (§8) is taken.

## 7. Open decisions (flagged, not settled)
- O1, read tools exposed. Ship goal-loop-only first (the smallest, safest served surface), or also expose `get_ast_texts`, `get_ast_blocks`, and `vector_search`. Leaning goal-loop-only for v1; the read tools are additive later.
- O2, transports for v1. Streamable HTTP only, or also stdio. Leaning Streamable HTTP first; stdio is cheap to add and mirrors the client.
- O3, adapter seam. Does `query` call the goal-loop entry the A2A server already uses, or a thin MCP-specific wrapper over the same entry. Leaning a thin wrapper over the same entry, so A2A and MCP stay one capability with two envelopes.

## 8. Stretch: dual role (separate record)
Trellis serving a host's call while itself calling downstream MCP servers (the existing client wired into the served path) is a later item with its own record. It inherits this record's flag, bounds, and no-passthrough rule, and it is out of scope here.

## 9. What this record does NOT touch
- The MCP client (`trellis_mcp.py`, `mcp_servers.ts`): unchanged; the server is a separate module in the opposite direction.
- The A2A server, the goal loop, the RLM read and answer surfaces, the write path, retrieval discipline, and the module registry: unchanged. The server binds them; it does not alter them.
- Both composed-prompt pins: no kernel prompt change is proposed. If a served tool description ever enters a pinned surface, that is a witting kernel change under the standing pin-recompute rule, not taken here.

## 10. Acceptance (when sequenced)
Document-first; implementation follows the normal session cadence once the owner sequences it. The surface is drillable zero-paid against a fixture MCP host, mirroring the client's `fixture_mcp_server.py` acceptance discipline: tool and resource listing; a `query` round-trip returning a provenance-bearing answer with a resolvable citation set over the real stream plumbing (a stubbed loop suffices to prove wiring); audience-binding rejection of a mis-issued token; byte-identical behavior with the flag unset; twin-validator pins on both sides. Any paid end-to-end run is owner-gated, propose-with-estimate, with the criterion recorded in the roadmap before spend.
