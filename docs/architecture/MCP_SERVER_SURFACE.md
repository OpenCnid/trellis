# Trellis MCP Server Surface: Design Record (Draft)

**Status:** DRAFT for review (Matthew + cnidarian). Not yet a repo commit.
**Date:** July 13, 2026
**Author:** Lexi (Lexideck), with Matthew Murphy
**Consumer repo:** OpenCnid/trellis
**Grounding:** [MCP July 2026 standards report (Gus)](https://www.town.com/content/document/nx7bsapcck8yt4tsxf1j2043e58aexv1?secret=5e2060c4-635e-4443-b1c6-aea37f0becd6); Recursive Language Models (Zhang, Kraska, Khattab, MIT CSAIL, arXiv:2512.24601); context-rot findings (Chroma, 2025).

---

## Decisions of record (locked July 13, 2026)

1. **Target the current stable spec, `2025-11-25`.** Migration to `2026-07-28` is optional, later. Rationale: plenty of repos run older specs; keep it simple now.
2. **Auth: reuse Trellis's current system.** Existing API protection on the server side; operator-configured per-upstream credentials if/when the client side is wired (the stretch). No bespoke token-exchange machinery until forced.
3. **The headline tool exposes the RLM harness itself.** A caller poses a question; Trellis constructs a provenance-bearing answer over its addressed substrate. The function is query-and-construct-from-the-substrate. There is no separate assistant persona and no crawl step; Trellis answers from the private data it holds.
4. **Namespace proxied upstream tools as `origin.tool`** (applies to the dual-role stretch).
5. **v1 is server-only.** Dual-role fan-out is a stretch goal with a lighter spec rooted in this one.

---

## 1. Intent

Expose Trellis's query surface as an MCP server, so any MCP host (Claude Desktop, Cursor, VS Code, Antigravity, custom agents) can hand Trellis a question and receive a constructed, cited answer drawn from a private substrate far larger than any model's context window. To a host, Trellis appears as one high-value tool. That is the widest, lowest-ceremony adoption path, and it is the point. The A2A surface remains the agent-to-agent path; this is additive, not a replacement.

## 2. Mechanism (what the tool does, and why it is a superpower for private data)

Stated plainly, because it is the load-bearing idea:

- A frontier model degrades as its context grows. Every one of eighteen frontier models tested by Chroma (2025) lost accuracy well before its window filled: attention dilution, lost-in-the-middle, positional decay. Pouring a vast corpus into the prompt is the wrong move, and it gets worse as the corpus grows.
- Trellis follows the Recursive Language Model paradigm (Zhang, Kraska, Khattab, MIT CSAIL). The corpus is not fed to the neural network. It lives as addressed data in the runtime, and the model writes code to examine, slice, grep, and recursively sub-query exactly the portions each question needs, then constructs the answer from those slices. The full corpus never enters the model's working context; only the slices the question actually requires do.
- In that arrangement, the model is the attention head over the substrate. It decides what to pull into working context per query, instead of attending across everything at once. This is what lets the paradigm handle contexts one to two orders of magnitude beyond a model's window while matching or beating long-context scaffolds at comparable cost.
- Trellis already is this runtime: an addressed, provenance-enforced substrate, plus an RLM worker with read-only accessors (`get_ast_blocks`, `get_ast_texts`), semantic and graph retrieval, and a bounded loop that decomposes a question into sub-queries over the substrate.
- Exposing that over MCP is the superpower for private data. Any host model, without ingesting the private corpus or ever holding it in context, can pose a question and receive a constructed, citation-bearing answer grounded in content-addressed sources. The host gets substrate-scale reasoning over data it never has to carry.

## 3. Scope and non-goals

- **In scope (v1):** a unidirectional MCP server exposing the RLM query tool, single-hop retrieval, the block/text accessors, and citation resources.
- **Out of scope (v1, deferred to the stretch spec, section 9):** dual-role fan-out (Trellis serving a tool call while calling downstream MCP servers); any change to the A2A surface; migration to `2026-07-28`.

## 4. What already exists (reused, not rebuilt)

- **MCP client** (Sessions 10-12): operator-configured stdio + Streamable HTTP + auth + containerized tool servers; allowlist, timeout, and size-cap discipline. Reused in the stretch.
- **A2A server** (Session 11) over the bounded goal loop. Untouched.
- **`retrieve` API**, RLM read-only DB tools, `get_ast_blocks` / `get_ast_texts`, the single provenance-required write path, and the per-goal bounds (`AGENT_MAX_*`).
- **API protection** (T6): API-key middleware, concurrency and size caps.

## 5. Target standard: MCP `2025-11-25`

- **Transports:** Streamable HTTP (sole remote; single `/mcp` endpoint) plus stdio. HTTP+SSE is not used.
- **Lifecycle:** `initialize` / `initialized` handshake; session-based capability negotiation; `Mcp-Session-Id`.
- **Primitives:** tools (model-controlled), resources (application-controlled), prompts (user-controlled).
- **Consent:** Elicitation (server to user via host) for the provenance-required write. Swaps to `InputRequiredResult` if we ever migrate to the RC.
- **Auth:** OAuth 2.1 resource-server posture with RFC 8707 audience binding (MUST on stable); `iss` validation (RFC 9207) recommended now, MUST in the RC.
- **Migration note:** the RC (`2026-07-28`) goes stateless and deprecates Sampling / Elicitation / Roots / Logging with a 12-month runway. Nothing here depends on those beyond the write-consent Elicitation, which has a clean stateless replacement, so migration stays genuinely optional.

## 6. The surface

### 6.1 Tools (model-controlled), lowest rung to highest

- **`get_blocks(root_hash)`** and **`get_texts(hashes[])`**: exact, addressed fetch of blocks or bytes by content address. The lowest rung; lets a host pull precise slices itself.
- **`retrieve(query, namespace?, top_k?)`**: single-hop semantic and graph retrieval. Returns the relevant slices, each with provenance (`source_id`, `source_uri`, `write_proof`) and confidence. No construction; the calling model reasons over the slices.
- **`query(question, bounds?)`**: the RLM harness, exposed. Trellis runs its bounded recursive loop over the addressed substrate, slicing and sub-querying only what the question needs, and returns a constructed answer with its full citation set. Handles corpora far beyond any model's context window; the calling model never holds the corpus. SSE progress notifications stream during execution; the run is bounded by the existing per-goal limits. This is the headline tool, and the reason the surface exists. Contrast with `retrieve`: `retrieve` hands back slices for the caller to reason over; `query` reasons over the substrate and hands back the constructed, cited answer.
- **`write_derived_insight(...)`** (provenance-required): consent-gated via Elicitation; retains the existing retrieval-membership and existence gates. Its v1 exposure is open question O1 below.

### 6.2 Resources (application-controlled, the citation surface)

- **`trellis://kb/doc/{root_hash}`**: full document records (content-addressed).
- **`trellis://kb/entity/{id}`**, **`trellis://kb/schema/...`**: entity and graph catalogs and schemas.
- Tools return `source_uri` values pointing here; hosts fetch full documents by reference and cache them. This keeps the tool list short and the citation surface explicit.

### 6.3 Prompts

- None in v1.

## 7. Provenance and citation

On `2025-11-25`, `structuredContent` is an object, so provenance rides inside it:

```
{
  "results": [
    { "text": "...", "source_id": "...", "source_uri": "trellis://kb/doc/...", "write_proof": "sha256:...", "confidence": 0.92 }
  ],
  "query_id": "...",
  "model_version": "trellis-rlm-..."
}
```

`source_uri` resolves to a resource (6.2). This preserves Trellis's core commitment (every fact traceable to a content-addressed location) across the MCP boundary. The existing invariant holds unchanged: external or MCP content never becomes a citation without round-tripping the verified ingest path.

## 8. Auth and security (v1 server-side)

- Reuse Trellis's existing API protection; layer the OAuth 2.1 resource-server posture over it: validate that incoming tokens are issued for the Trellis MCP server's URI (RFC 8707 audience binding, MUST); publish RFC 9728 Protected Resource Metadata; keep the issuer stable.
- Mark returned content as untrusted data in tool results (indirect-injection defense). The bounded loop and the provenance write path are the confused-deputy defenses.
- No token passthrough (spec MUST NOT). This becomes load-bearing only when the client side is wired in the stretch; the v1 server has no downstream to forward to.

## 9. Increment ladder and acceptance (house discipline)

- **Increment 0:** this design record (document-first).
- **Increment 1: the MCP server surface.**
    - Feature flag `TRELLIS_MCP_SERVER_ENABLED` (default off; byte-identical API when unset).
    - Tools and resources per section 6; provenance per section 7; auth per section 8.
    - Acceptance, zero-paid against a fixture MCP host (mirroring the fixture-server discipline the MCP client tests already use): tool and resource listing; a `retrieve` round-trip with provenance intact; resource fetch by `source_uri`; a stubbed `query` run returning a constructed answer plus citation set over the real stream plumbing; Elicitation consent on the write path; audience-binding rejection of a mis-issued token; and byte-identical behavior when the flag is unset.
    - Composed-prompt pins: none expected (no kernel prompt change). If any tool-description text enters a pinned surface, recompute the pin wittingly.
- Every increment: pre-stated criterion, zero-paid acceptance, owner sign-off before any paid run.

## 10. Stretch: dual-role fan-out (lighter spec, rooted here)

When Trellis's own answering should fan out to external MCP tool servers (a live search server, a code-analysis server) while serving a host's tool call:

- Wire the existing MCP client (Sessions 10-12) into the server process; a served `query` / `retrieve` may call allowlisted downstream servers as part of constructing its answer.
- Namespace proxied upstream tools as `origin.tool` (Decision 4); sanitize upstream tool descriptions before re-exposing them.
- Tokens: operator-configured per-upstream credentials (Decision 2); never forward the host token across the boundary (MUST NOT).
- This gets its own short design record, inheriting this one's flags, acceptance shape, and security invariants.

## 11. Open questions (with leanings)

- **O1:** Expose the provenance-required write on the public MCP surface in v1, or ship read-only (`query` + `retrieve` + accessors + resources) first and add the write later? Leaning read-only-first for a clean, safe public debut.
- **O2:** Transport for v1: Streamable HTTP only, or also stdio (for hosts that spawn Trellis as a subprocess)? Leaning Streamable HTTP first; stdio is cheap to add.
- **O3:** Does `query` reuse the goal-loop worker directly, or a thin MCP-specific wrapper over the same worker? Leaning a thin wrapper over the same worker.

## 12. Sources

- Gus, [MCP July 2026 standards report](https://www.town.com/content/document/nx7bsapcck8yt4tsxf1j2043e58aexv1?secret=5e2060c4-635e-4443-b1c6-aea37f0becd6).
- Recursive Language Models: Zhang, Kraska, Khattab, arXiv:2512.24601 (MIT CSAIL / OASYS lab). The addressed-context-in-a-runtime paradigm this surface exposes.
- Context rot: Chroma (2025), eighteen-model degradation study; the lost-in-the-middle line (Liu et al., 2023).
- Related corpus-interaction lines, for reference: Direct Corpus Interaction / GrepSeek; RISE (retrieval as a bounded interaction space); dspy.RLM (LLM writes code to slice, grep, and recursively sub-query an addressed context).
