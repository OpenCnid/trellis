# Trellis REPL Sandbox — Handle / State Data Model

**Status: DESIGN — handle/state model for the ratified data-flow boundary; NOT built.**
This record makes [REPL_SANDBOX_ARCHITECTURE.md](REPL_SANDBOX_ARCHITECTURE.md) §3.1 (The
exfiltration resolution — data-flow, not content inspection) a precise, enforceable design. It
realises the core pillar of [CODE_MEDIATED_TEXT.md](../../architecture/CODE_MEDIATED_TEXT.md)
§0 (The pillar) — *the model never counts, never copies* — as the guest's **only** relationship
to host-resident data: the guest addresses data by handle; the broker resolves handles
host-side. Document-driven (leads implementation; nothing runs). This record defines what a
handle **is** and the semantics of resolving / slicing / materialising it; the vsock wire
encoding of every operation below belongs to [REPL_SANDBOX_INTERFACES.md](REPL_SANDBOX_INTERFACES.md)
(seam drawn in §10). **HARD RULE honoured throughout:** every boundary claim names the surface
that enforces it — a documented bound with no engine behind it is not a control.

---

## 0. The invariant this model makes real

> **The guest holds addressable handles; secret-bearing content lives only host-side and
> crosses into the guest through metered sinks, never by default.**

The boundary is a **data-flow property**, split into a load-bearing guarantee and a bounded
residual (REPL_SANDBOX_ARCHITECTURE.md §3.1):

- **Boundary (structural, holds under 100 % successful injection).** The bulk of the user's data
  — doubts / beliefs / facts, loaded corpora, DB rows — is **never materialised in the guest**,
  so the sanctioned crossings (`llm_query`, `answer`) cannot leak what was never there. A hostile
  document that fully steers the model still cannot fold into an answer bytes the model never held.
- **Residual (bounded, audited).** A narrow, explicit, per-byte materialisation channel the model
  must *deliberately drive* (§6). The caps/DLP/audit on it are **defense-in-depth on the residual,
  never promoted to the boundary** — the discipline of REPL_SANDBOX_ARCHITECTURE.md §3.1 and the
  §6/[REPL_SANDBOX_SPEC.md](REPL_SANDBOX_SPEC.md) §6 (Security invariants) "NOT a boundary" row.

**Enforcing surface of the boundary:** the broker's resolution discipline (§3) — the RPC facade
exposes **no operation that returns referent content to the guest except `materialize`**, and every
content-producing sink is metered *at the sink* (§6). The handle algebra (§4) is the only unmetered
path, and it never produces content.

## 1. What a handle is

A handle is an **opaque, unforgeable, CID-scoped, payload-free** reference to host-resident data.
Its guest-side shape is deliberately minimal:

```
Handle = { id: str,        # a random 128-bit token; meaningless without the host table
           kind: str }     # coarse type: table | text-blocks | scalar | result-set | graph-view
```

No shape, no count, no schema, no content field — those are value-bearing and cross only via §6.
The `kind` tag is the **only** inference the guest gets for free (it selects which §4 ops are valid).

| Property | Meaning | Enforcing surface |
|---|---|---|
| **Opaque** | the guest cannot parse it to learn content | guest-side holder has no content field; the token is a random id, inert without the host table |
| **Unforgeable** | the guest cannot mint a handle for data it was not given | broker per-`(CID, id)` allocation table, **fail-closed** on miss (§2); unguessable id is a secondary defense |
| **CID-scoped** | resolves only for the vsock CID it was allocated to | the session identity the listener supplies at `accept()`, matched to the allocation CID (native: the kernel peer CID; hybrid: the per-sandbox socket path — [INTERFACES §3.1a (Hybrid vsock)](REPL_SANDBOX_INTERFACES.md)) (REPL_SANDBOX_SPEC.md §4 (Host chokepoint contracts); REPL_SANDBOX_LEARNINGS.md §7 (Identity: the vsock CID)) |
| **Payload-free** | carries zero secret bytes | referent stored host-side; the §4 algebra returns handles; content crosses only via `materialize` (§6) |
| **Typed** | carries a coarse `kind`, structure not content | set host-side at allocation; reveals shape class, never values |

The handle **is** the "engine-computed address" of CODE_MEDIATED_TEXT.md §0 (The pillar), promoted
to a first-class, transport-safe object.

## 2. Namespace, allocation, lifecycle, revocation

- **Namespace.** Per-session, keyed by `(CID, id)`; disjoint across sessions; one broker table per
  live CID. Cross-session use of a leaked token fails the CID match (§1) — the confused-deputy /
  IDOR class REPL_SANDBOX_LEARNINGS.md §7 (Identity) names.
- **Allocation.** The broker mints a handle on any op producing a referent: `setup` / `load_context`
  (root handles, §7), and each §4 algebra op (derived handles). Table entry:
  `{ id, CID, kind, referent (DB query spec | derivation node | host bytes-ref), parent lineage,
  alloc_time, ttl, state }`. The referent — the thing that resolves to content — **never leaves the
  host table.**

| State | Meaning | Trigger |
|---|---|---|
| **live** | resolvable | on allocation |
| **dropped** | model released it | `drop(H)` — the model-visible release valve (the workspace `drop()` / `trellis_textedit.drop` precedent, CODE_MEDIATED_TEXT.md §6) |
| **expired** | TTL elapsed | broker sweep (align the workspace TTL) |
| **stale** | underlying rows mutated | a broker **write** touched the referent → dependent handles marked stale; resolution fails **loud + retryable** (CODE_MEDIATED_TEXT.md §2 (The discipline), clauses 3/6 — the hash-guard / no-stale-positional-handle rule). Rare: the DB role is read-only by default |
| **closed** | session end | broker frees the whole per-CID table and **zeroes any resolved-bytes cache** |

- **Transience** (CODE_MEDIATED_TEXT.md §2, clause 3). Handles are **session-scoped for reads** —
  the store is read-only by default, so addresses stay valid across the session; the model re-queries
  rather than persisting an address across a write, and no handle survives a mutation of its referent.
- **Revocation is host-side and fail-closed.** A guest holding a dropped / expired / stale / foreign
  token receives a resolution error and **zero content** — never a silent empty or a partial.

## 3. Broker-side resolution semantics

`resolve(CID, id)`:

1. Table lookup → verify CID match **and** `state == live`. Any failure → fail-closed error, **no
   content, no partial** (§2).
2. Evaluate the referent **host-side** (run the DB query / apply the derivation).
3. Hand the value to a **sink** — never back to the guest as raw bytes.

**The boundary invariant (enforced by facade shape).** Resolution feeds its value to exactly one of:
(a) a §4 **algebra op** → a new handle (no content crosses); or (b) a §6 **metered sink**
(`materialize` / `llm_query` / `answer`) → content crosses only under the §6 ledgers. There is **no
"get raw bytes of handle" RPC** other than `materialize`. That absence — not a runtime check the guest
could steer around — is what makes the boundary hold under 100 % injection.

- **Determinism.** Within a session a live handle resolves to the same value (reproducible audit +
  hash-guard); invalidation is explicit (§2).
- **Evaluation timing is the broker's choice** (eager+cache or lazy-at-sink); the handle *denotes* the
  value, and timing is unobservable to the guest beyond the `kind` tag.

## 4. The handle algebra — slice-by-address, the pillar applied

This is CODE_MEDIATED_TEXT.md §0/§2 realised as an API and REPL_SANDBOX_RESEARCH.md §7
(Prompt-composition-by-function) "slice-by-address": the model **locates by query and moves data by
address**, and the address is the handle. Two currencies cross **into** the guest here, both
non-content (class A):

1. **Handles + `kind`** — opaque, inert.
2. **Engine-computed addresses** — row indices, block-ids (the citable content-hashes
   CODE_MEDIATED_TEXT.md §6 item 6 (The boundary-aware block accessor) already exposes), line ranges,
   byte offsets. Addresses carry no content; a returned address *set* is low-bandwidth information, so
   address-returning ops are byte-capped (bounded result count) + audited — deeper side-channel
   accounting is [REPL_SANDBOX_THREAT_MODEL.md](REPL_SANDBOX_THREAT_MODEL.md)'s scope.

| Op | Input → Output | Crosses |
|---|---|---|
| `narrow(H, start, end)` | `[start, end)` half-open (CODE_MEDIATED_TEXT.md §6 Python-slice semantics) → `H'` | handle |
| `project(H, cols)` | column / field selection → `H'` | handle |
| `filter(H, predicate)` | broker evaluates the predicate host-side → `H'` | handle |
| `join(H1, H2, on)` | host-side relational join → `H'` | handle |
| `union(H…)` / `concat(H…)` | → `H'` | handle |
| `locate(H, pattern)` | content-query location → **addresses**, not matched content (CODE_MEDIATED_TEXT.md §2 clause 4) | bounded address set |
| `get_ast_blocks(H_root)` | document structure in order → `[{block-id, type, byte_len}]`, **no text** — the sandbox specialisation of CODE_MEDIATED_TEXT.md §6 item 6 (structure/addresses cross; text is materialised on demand) | addresses |
| `search(query)` / `vector_search(query)` | → `H'`, a handle to the result **set**, not the rows | handle |

**Naming (owner-authorized 2026-07-22).** The windowing op above was `slice` until this date, which is
also the name REPL_SANDBOX_INTERFACES.md §5 (DB-broker RPC surface) gives the metered content path —
two records, one name, two different operations; the collision resolved itself in code by deleting the
algebra one from the broker's routable set, so narrowing a handle without materialising it was
unreachable from the guest. The algebra's op is now `narrow`; `slice` keeps its INTERFACES meaning.

**The algebra is closed:** handle in, handle out, zero content. The model composes arbitrarily deep
host-side derivations (`narrow→filter→join→search`) while holding only opaque handles + addresses —
exactly the pillar's "attention holds only queries, handles, and bounded previews." Note the reframe of
`vector_search`: REPL_SANDBOX_ARCHITECTURE.md §3.1 lists it among the sanctioned crossings; under this
model it returns a **handle**, so its rows never cross — only a later `materialize` brings bounded
previews across, under §6.

## 5. What crosses, and what never crosses

| Direction / class | Item | Enforcing surface |
|---|---|---|
| **MAY cross → guest** | opaque handles + `kind` | broker allocation; guest holder has no content field (§1) |
| | engine-computed addresses (indices, block-ids, offsets, line ranges) | §4 algebra; bounded + audited |
| | bounded materialisations (content slices, counts, aggregates, summaries, sub-LLM answers) | **only** via the §6 metered path |
| **NEVER crosses → guest** | raw DB rows / full referent content (except bounded via §6) | resolution discipline (§3) |
| | DB credentials / DSN / live connection objects | held host-side by the broker (REPL_SANDBOX_SPEC.md §4.2 (Host broker); REPL_SANDBOX_ARCHITECTURE.md §2 (Trust model)) |
| | provider API key | held host-side by the LM handler (REPL_SANDBOX_SPEC.md §4.1 (LM handler)) |
| | another session's handles or data | CID scoping (§1/§2) |

The never-list is enforced by **absence**: those objects are never placed in the guest namespace at
all — the broker materialises **proxy stubs, not live clients** (REPL_SANDBOX_ARCHITECTURE.md §5 (The
RLM-compat seam); REPL_SANDBOX_SPEC.md §4.3 (CapabilityDescriptor); REPL_SANDBOX_LEARNINGS.md §4 (The
CapabilityDescriptor hinge)). You cannot leak what the interpreter cannot name.

## 6. The bounded materialisation exception — where the residual lives

The tension, named rather than hand-waved: the model must sometimes **see** derived data — a count, a
bounded slice, a summary — to reason. That is the one place content crosses. Everything here is the
residual the boundary deliberately leaves; its caps are defense-in-depth, **never** the boundary.

**The two metered crossings — the only content crossings in the system:**

| Ledger | Paths | Enforcing surfaces (host-side, CID-keyed) |
|---|---|---|
| **INBOUND** (host content → guest) | `materialize(H \| address-span)`; aggregate materialisations `count / describe / aggregate / summarize(H)`; the `llm_query` / `llm_query_batched` **completion return** | cumulative-byte counter with **hard-stop** on exhaustion + per-call byte cap + content-DLP scan (content-bearing crossings) + audit log (REPL_SANDBOX_SPEC.md §4.1 (LM handler)) |
| **OUTBOUND / egress** (guest or host-resolved content → world) | `llm_query` **outbound prompt** (a handle argument the broker resolves host-side still meters here); `answer.submit(expr)` resolving to content — the **audited egress control point**, not merely a 64 KB cap (REPL_SANDBOX_ARCHITECTURE.md §3.1) | outbound content-DLP + cumulative byte cap + audit at the LM handler / answer sink |

**The killer pattern (why handles beat `materialize`).** Sinks accept **handle arguments** and resolve
them host-side, so the model can direct host-resident data to a sink **without ever holding it**:
`llm_query(prompt="summarise", context=beliefs)` resolves the belief handle host-side, the sub-LLM
summarises, and only the bounded summary returns (inbound-metered) — the model reasoned over the belief
base without a row of it entering the guest. Likewise `answer.submit(H)`: the referent leaves via the
audited answer egress, never through the guest namespace. **Prefer by-reference sinks; `materialize`
is only for when the model itself must compute over the bytes.**

**Metering rule (crisp).** Content is metered at **every sink**; only the pure address/handle algebra
(§4) is free. There is no unmetered path from a referent to content anywhere — inbound via `materialize`
(inbound ledger), outbound via the `llm_query` prompt / `answer` (egress ledger). **No bypass.**

**The quantified residual — where the exfil-rate bound lives.** Under 100 % successful injection the
model can exfiltrate at most `min(inbound-admitted, egress-cap)` bytes of host-resident secret per
session, at the rate the ledgers permit — **not** the corpus, because the corpus never entered the
guest. The boundary makes bulk / verbatim exfil *structurally* impossible; the ledgers bound the *rate*
of the narrow residual. Strip the caps and bulk exfil is **still** impossible — the model must still
drive it byte-by-byte through explicit, audited sinks — which is exactly why the caps are the residual's
rate-bound, not the boundary. **The residual exfil-rate == the inbound + egress cumulative-byte
ceilings, CID-keyed and host-enforced.**

**Low-bandwidth side channels (honest residual).** The coarse `kind` tag (§1), returned address sets
(§4), and aggregate counts each leak a few bits; each is bounded by its per-call cap + audit. Full
quantification (and the content-hash confirmation-oracle risk of emitting block-ids) is
REPL_SANDBOX_THREAT_MODEL.md's scope.

## 7. doubts / beliefs / facts as handles

The user's three canonical workspaces — **doubts / beliefs / facts**, the queryable REPL structures
that *are* Trellis' expertise — live host-side in the graph / AST store behind the broker. They surface
to the guest as three **pre-allocated root handles** at `setup` / `load_context`: `doubts`, `beliefs`,
`facts`, each `kind = graph-view` (or `table`). **No row of the user's knowledge is ever placed in the
guest as a payload**; the model slices / filters / searches them via the §4 algebra and materialises
bounded slices via §6 to reason.

This is the boundary applied to the user's **own** knowledge base: a hostile document cannot make the
model exfiltrate the belief base, because the belief base was never in the guest — only handles to it
were. It also honours WORKSPACE_AND_MODULES.md §4.5 (The data-not-objects contract): the guest holds
data-shaped references, never live objects.

**`load_context` resolution.** A payload **referencing** host-resident workspaces resolves to handles;
a small caller-supplied **literal** (the task framing itself, not a host secret) MAY inline into the
guest under the inbound byte cap. The reserved `context` variable (REPL_SANDBOX_SPEC.md §2 (Backend
interface)) thus holds handles for host-resident referents, a literal only for caller-inlined framing.
*(Design call — flagged §10.)*

## 8. `execute_code` result marshaling

`REPLResult` (REPL_SANDBOX_SPEC.md §2 — instance attributes; the dataclass field list says
`llm_calls`, so `repr()` and `==` raise: `stdout, stderr, locals, execution_time, rlm_calls,
final_answer`) plus the REPL_SANDBOX_RESEARCH.md §6 (The swappable seam) `ExecResult` shape
(`value_repr, truncated, spill_handle`) marshal back under these rules:

- **Handles marshal as `{id, kind}` — never resolved.** A handle as the block's last expression →
  `value_repr` = the token + `kind` + a `spill_handle` the model materialises on demand
  (REPL_SANDBOX_RESEARCH.md §7 — the capped `repr`/`head` + `spill_handle`, `df.head()` made a
  first-class seam field). Content is never in `value_repr`.
- **`locals` never serialises a raw referent.** The namespace holds handles (opaque) + guest-local
  values the model already materialised (bounded, already charged §6). An un-materialised secret is not
  in `locals` because it was never in the guest — the boundary does its work at the marshaling seam by
  construction, not by a filter over the outgoing struct.
- **`stdout` / `stderr`** are byte-capped (the 20 KB / 64 KB caps REPL_SANDBOX_SPEC.md §6 flags as
  telemetry-only — here they bound the marshaling crossing, still not the boundary). Printed content was
  already materialised + charged at its §6 sink.
- **The composed root-LM prompt crosses outbound.** The rlms driver folds the marshaled transcript into
  the next root completion; that prompt leaves via the LM handler under outbound DLP + cumulative byte
  cap (REPL_SANDBOX_SPEC.md §4.1). Because the transcript can contain only handles + already-materialised
  bounded content, **even the root-LM prompt cannot leak an un-materialised secret.**
- **`final_answer`** marshals via the `answer` channel's audited egress (§6). `rlm_calls` /
  `execution_time` are non-content telemetry (uncapped).

## 9. Relationship to the composed doubt-filter (Layers 1–2)

The data-flow boundary specified here is **Layer 0 — the guarantee**. The provenance-gated instruction
authority (Layer 1) and the semantic defeater panel (Layer 2) of REPL_SANDBOX_ARCHITECTURE.md §3.1 are
defense-in-depth composed from the −1 doubt tier (DOUBTS_WORKSPACE.md §7 (What doubts do not do),
§8 (Composed defeaters), §9 (Scope — this is a critique engine)); their spec is
[REPL_SANDBOX_DOUBT_FILTER.md](REPL_SANDBOX_DOUBT_FILTER.md), **not this record**.

Discipline restated at the seam: Layers 1–2 reduce the *rate* at which the model acts on injected
instructions; they **must never** appear in the "Enforced by" column of the §6 / REPL_SANDBOX_SPEC.md §6
invariants. This record's ledgers (§6) + resolution discipline (§3) are the enforcing surfaces; the
doubt-filter sits **under** them, per DOUBTS_WORKSPACE.md §7 (doubts attach findings, never enforce).

## 10. Seams & under-determined items (flagged for the owner)

**Seams (draw, do not duplicate):**

- **→ REPL_SANDBOX_INTERFACES.md.** This record defines the handle **abstraction** + resolve / slice /
  materialise **semantics**; INTERFACES.md owns the **vsock wire encoding** — framing, serialization,
  RPC opcodes. On the wire a handle is an `id` string + a `kind` enum; its bytes are INTERFACES.md's.
- **→ REPL_SANDBOX_THREAT_MODEL.md.** The adversary model, full quantification of the §4/§6
  low-bandwidth residual side channels, and the block-id content-hash confirmation-oracle risk.
- **→ [REPL_SANDBOX_BUILD_PLAN.md](REPL_SANDBOX_BUILD_PLAN.md).** The broker handle-table + the two
  ledgers are build items behind the research hold.

**Under-determined (owner calls):**

1. **Handle metadata bandwidth.** This record attaches only a coarse `kind`; cardinality / schema are
   materialised (§6). Confirm the coarse `kind` is acceptably low-bandwidth, or route it through the
   ledger too.
2. **Handle lifetime.** Session-scoped (this record) vs turn-scoped (a stricter reading of
   CODE_MEDIATED_TEXT.md §2 clause 3). Read-only default makes session-scoped safe; a write-grant session
   may warrant turn-scoping.
3. **`load_context` inlining.** Whether caller literals may inline at all, or everything must route
   through handles (§7).
4. **Eager vs lazy referent evaluation** is left to the broker (§3). If audit requires materialisation
   timing pinned, make it explicit.

---

*Boundary & requirements: [REPL_SANDBOX_ARCHITECTURE.md](REPL_SANDBOX_ARCHITECTURE.md) §3/§3.1 ·
Pillar: [CODE_MEDIATED_TEXT.md](../../architecture/CODE_MEDIATED_TEXT.md) ·
Interface & wire: [REPL_SANDBOX_SPEC.md](REPL_SANDBOX_SPEC.md) ·
[REPL_SANDBOX_INTERFACES.md](REPL_SANDBOX_INTERFACES.md) ·
Adversary & residual: [REPL_SANDBOX_THREAT_MODEL.md](REPL_SANDBOX_THREAT_MODEL.md) ·
Doubt-filter (Layers 1–2): [REPL_SANDBOX_DOUBT_FILTER.md](REPL_SANDBOX_DOUBT_FILTER.md) ·
Full trail: [REPL_SANDBOX_RESEARCH.md](REPL_SANDBOX_RESEARCH.md) ·
Learnings: [REPL_SANDBOX_LEARNINGS.md](REPL_SANDBOX_LEARNINGS.md).*
