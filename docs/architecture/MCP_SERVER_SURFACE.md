# MCP Server Surface: Serving Trellis over MCP

**Status:** proposed design record (document-first), for owner review and sequencing. Written July 13, 2026. It specifies a still-open item, Trellis serving the Model Context Protocol, recorded as a deliberate exclusion in the Session 12 ledger entry ([`docs/archive/ROADMAP_HISTORY.md`](../archive/ROADMAP_HISTORY.md), July 7, 2026: "Trellis as an MCP server or A2A client" under "Deliberately not included") and named "a new owner direction, not a recorded remainder" in roadmap item 3.3 #8. The owner invitation that prompted this record is recorded in `TRELLIS_ROADMAP.md` §5 (July 13, 2026). Not yet sequenced; no implementation, drills, or paid runs are claimed here.
**Scope:** a new server surface that lets an external MCP host call Trellis. It reuses, and does not modify, the MCP client ([`src/rlm/trellis_mcp.py`](../../src/rlm/trellis_mcp.py), [`src/config/mcp_servers.ts`](../../src/config/mcp_servers.ts)), the A2A server ([`src/core/a2a/`](../../src/core/a2a/)), the goal loop, and the RLM read and answer surfaces.
**Parent doctrine:** [`PROVENANCE_THREADING.md`](PROVENANCE_THREADING.md) (every served fact traces to content-addressed bytes) and [`CODE_MEDIATED_TEXT.md`](CODE_MEDIATED_TEXT.md) (answers by reference, never retyped). The operator-gated posture of the MCP client is mirrored here in the opposite direction.

---

## 1. Problem statement: the direction that is missing

Roadmap item 3.3 #8 built external integration in three landed slices: the operator-configured stdio MCP client (`trellis_mcp.py`, Session 10), the A2A server (Session 11), which exposes the bounded goal loop to other agents behind the existing gates and bounds, and the remote Streamable HTTP transports with the containerized tool-server pattern (Session 12). The third direction is unbuilt: Trellis serving MCP, so an ordinary MCP host (Claude Desktop, Cursor, VS Code, an Antigravity agent, a custom client) can call Trellis as a tool.

The answering capability exists internally; missing are the envelope and one named piece of plumbing: the goal loop's result envelope (`src/core/observability/rlm_result.ts`) carries `{status, answer, count}` today, with no citation set. Serving a citation-bearing answer therefore requires new, bounded machinery (section 2, open decision O4), specified here rather than assumed. The A2A server is the proof of shape: a served surface over the goal loop, gated, bounded, and zero-paid-drilled. Serving MCP is the same move in a second protocol. This record specifies that surface as a thin, operator-gated adapter over surfaces that already exist. It proposes no change to how Trellis reasons, retrieves, or writes.

Honest scope: this exposes existing capability over a new protocol. It adds no reasoning power, and it widens nothing a caller may learn beyond what the goal loop and the read surfaces already return. The provenance and spend invariants that bind an A2A run or a local run bind a served MCP call identically.

## 2. What is served, and what is not

The server exposes one capability, in two shapes. The answer path is load-bearing internally today; the citation set beside it is new plumbing this record names explicitly (O4).

- A question answered over the substrate (primary). The host submits a goal; Trellis runs the bounded goal loop (the Session 9 orchestrator over the RLM) and returns the answer the loop produces, assembled through `trellis_answer` (answers by reference), exactly the A2A server's capability, re-served over MCP. The citation set served beside the answer is NEW machinery: today `sourceNodeIds` discipline lives on the run's DERIVED_INSIGHT writes (format, then existence, then retrieval-membership, the Session 31 gate), not on the answer envelope, and the `TRELLIS_RESULT` envelope carries no citations. Where the served citation set comes from is open decision O4; whatever is chosen, every served citation must resolve to a real content-addressed AST hash, and `TRELLIS_RESULT` changes stay additive-only per the standing compat guardrail.
- Direct read (secondary, open decision O1). Whether the Tier-1 read tools (`get_ast_texts`, `get_ast_blocks`, `vector_search`) are exposed to external hosts, or held back so the goal loop is the only served entry, is flagged here rather than settled (§7).

Never served: the write path (`write_derived_insight` and the promotion bridge), any Tier-3 workspace surface, the module registry, and anything that mutates state. A served MCP call is read-and-answer only. The server is a peer of the A2A server, not a new authority.

## 3. The provenance boundary

The MCP client established the structural rule in its direction: MCP tool output is counted by `_count_mcp_call()`, never `_count_tool_call()`, so external tool results can never satisfy or masquerade as `sourceNodeIds` provenance (the split is the enforcement, not a prompt instruction; see the `trellis_mcp.py` docstring). The server direction carries the mirror invariant.

- A served answer's citations come from the O4-chosen source (leaning: the run's gated DERIVED_INSIGHT writes), each resolvable to a content-addressed AST node. They are not synthesized for the host, and they are not weakened at the boundary.
- Citation payloads travel as structured data beside the answer; each carries its content address (the AST hash) so the host can resolve the exact bytes. Resolution is by reference (an MCP resource, §4.3), never by the server inlining and re-serializing store contents into the response; the CODE_MEDIATED_TEXT.md by-reference answer discipline (answers travel as references to content-addressed bytes, never as retyped store contents) holds across the boundary.
- The verified-ingest invariant is untouched: content that arrives through the server (a host's question text) is input, never a citable source. Only bytes that passed the ingest transaction can be cited, exactly as today.

## 4. The surface

### 4.1 Target standard and transports
Target the current stable MCP revision, `2025-11-25`. Mirror the client's transport decisions so both directions share one transport posture: Streamable HTTP as the sole remote transport (single endpoint) and stdio for hosts that spawn Trellis as a subprocess; HTTP+SSE is not used, exactly as the client already refuses it. Whether v1 ships both transports or Streamable HTTP first is open decision O2. The client remains pinned to `mcp==1.12.4` (spec 2025-06-18); the server targeting 2025-11-25 is a deliberate skew handled by MCP version negotiation, not a shared-pin claim.

### 4.2 Tools (model-controlled)
- `query`: submit a goal; receive the goal loop's answer plus a citation set sourced per O4. Bounded by the existing per-goal limits enforced on the goal loop; progress streams over the transport's notification channel. This is the A2A capability re-served, and it is the reason the surface exists.
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
| Served citations resolve to real content-addressed bytes | citations are drawn from the O4-chosen source (leaning: the run's gated DERIVED_INSIGHT writes), resolved through resources; nothing is inlined or synthesized at the boundary | drill: every served citation resolves; none is synthesized |
| A host credential is never confused with a Trellis credential | v1 validates the existing API key (the A2A posture); no inbound credential is ever forwarded onward (the client's no-passthrough rule, mirrored) | drill: request without the key rejected; static no-passthrough pin |
| Config that passes one validator passes the other | a Zod schema in `src/config/` with a bound-for-bound Python twin, in the `mcp_servers.ts` pattern | twin-validator unit pins on both sides |

Bounds reuse the client's constants: per-call timeout 10s default and 300s max; result 64KB default and 4MB max; plain http restricted to loopback, RFC1918, or dot-free hosts. Any server or tool name stays locked to the client's charset (`^[a-z][a-z0-9_-]*$`).

## 6. Auth and security (v1)
- v1 auth is API-key parity with the A2A server: the existing `apiKeyMiddleware` (`src/api/auth.ts`) guards the served endpoint, byte-identical posture to `POST /a2a/v1`. Trellis has no OAuth issuer or token infrastructure today; the MCP resource-server posture (audience-bound tokens, RFC 9728 protected-resource metadata) is DEFERRED to its own record, triggered when a host that cannot present a static key materializes. Deferring it keeps every section-5 pin executable against machinery this record actually specifies.
- Mark host-supplied content as untrusted input in the server's reasoning path (indirect-injection defense); the goal loop and the provenance discipline are the confused-deputy defenses.
- No token passthrough. The v1 server has no downstream to forward to; the rule becomes load-bearing only if the dual-role stretch (§8) is taken.

## 7. Open decisions (flagged, not settled)
- O1, read tools exposed. Ship goal-loop-only first (the smallest, safest served surface), or also expose `get_ast_texts`, `get_ast_blocks`, and `vector_search`. Leaning goal-loop-only for v1; the read tools are additive later.
- O2, transports for v1. Streamable HTTP only, or also stdio. Leaning Streamable HTTP first; stdio is cheap to add and mirrors the client.
- O3, adapter seam. Does `query` call the goal-loop entry the A2A server already uses, or a thin MCP-specific wrapper over the same entry. Leaning a thin wrapper over the same entry, so A2A and MCP stay one capability with two envelopes.
- O4, citation-set source. The served citation set does not exist in today's result envelope. Candidates: (a) the `sourceNodeIds` of the run's gated DERIVED_INSIGHT writes (leaning: these passed format, then existence, then retrieval-membership, so they are support-shaped by construction); (b) exporting the Session 30 retrieved-address set (leaning against: it is everything-fetched, not support, and over-citation is laundering-shaped per the Session 19 rule; the set is also pinned never-parked and never-serialized, so export is a recorded change with owner visibility); (c) a new citation parameter on the answer channel (touches the pinned `trellis_answer` contract); (d) v1 ships answer-only with no citation set (smallest, but forfeits this record's stated reason to exist). Any choice extends `TRELLIS_RESULT` additively only.
- O5, implementation language and SDK. No MCP server SDK exists in the repo today. Candidates: a TypeScript server via `@modelcontextprotocol/sdk` mounted beside the A2A server in `src/api/` (leaning: the goal-loop admission gates live there, and the new exact-pinned npm dependency is a recorded dependency event); or a Python server via the pinned `mcp` package, but `mcp==1.12.4` speaks spec 2025-06-18, so serving 2025-11-25 requires a version bump (its own recorded event) and a new process boundary. Related: the client remains at 2025-06-18 in either case; the revision skew is handled by MCP version negotiation, and a client-SDK bump is a separate decision, not taken here.

## 8. Stretch: dual role (separate record)
Trellis serving a host's call while itself calling downstream MCP servers (the existing client wired into the served path) is a later item with its own record. It inherits this record's flag, bounds, and no-passthrough rule, and it is out of scope here.

## 9. What this record does NOT touch
- The MCP client (`trellis_mcp.py`, `mcp_servers.ts`): unchanged; the server is a separate module in the opposite direction.
- The A2A server, the goal loop, the RLM read and answer surfaces, the write path, retrieval discipline, and the module registry: unchanged. The server binds them; it does not alter them.
- Both composed-prompt pins: no kernel prompt change is proposed. If a served tool description ever enters a pinned surface, that is a witting kernel change under the standing pin-recompute rule, not taken here.

## 10. Acceptance (when sequenced)
Document-first; implementation follows the normal session cadence once the owner sequences it. The surface is drillable zero-paid against a fixture MCP host, mirroring the client's `fixture_mcp_server.py` acceptance discipline: tool and resource listing; a `query` round-trip returning the goal loop's answer with a resolvable citation set (per the O4 choice) over the real stream plumbing (a stubbed loop suffices to prove wiring); rejection of a request that lacks the API key; byte-identical behavior with the flag unset; twin-validator pins on both sides. Any paid end-to-end run is owner-gated, propose-with-estimate, with the criterion recorded in the roadmap before spend.
