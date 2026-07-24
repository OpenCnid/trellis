# Substrate writes

`AGENTS.md` rules 2, 3, 4, 5 and 13, carried for work that touches the
content-addressed store, the provenance it carries, or the surface that
retrieves it. Each states something that is true of Trellis: an edit that
makes one of these sentences false has corrupted the substrate rather than
changed it. The numbers are cited from code and from other records and stay
as they are. Rules 9 (`boundaries.md`), 18 (`AMBIENT.md`), and 19 (split across the
spend, commit, and measurement leaves) apply to this work too.

## 2. Content addressing; a node is final at write time

AST nodes are addressed by content. Identity is the SHA-256 Merkle preimage,
and content identity is the only kind this repository persists — a line
number, offset, ordinal, or position in a tree is data recorded about a node,
never a name that resolves to one.

A node in the store is byte-identical to the node that was written and
re-reads at its own hash for the life of the store: every node ever persisted
is still present, still readable at the hash it was stored under, still
hashing to it, across every one of its persisted fields, whether or not that
field enters the preimage. A session that changes something writes an
additional node; the change is the arrival of the new node, and the older node
stands intact behind it, including once a later version has left it behind.
Persistence is `ON CONFLICT (id) DO NOTHING` (`src/core/ast/persist.ts`) and
version membership is its own row (`src/core/ast/registry.ts`), so re-writing
known bytes is a no-op rather than an overwrite.

## 3. Entities corrected by overlay belief

Corrections to entities are written beside them. Equivalence is an overlay
belief — a `SAME_AS` edge, its negation a `DISTINCT_FROM` edge
(`src/core/graph/alias_resolution.ts`). An entity found wrong is contested or
retired, which is a standing stamp the sweep sets and the audit keeps
(`src/core/graph/invalidation.ts`: the graph is an append-only belief ledger).

Every Entity node ever written is present in the graph under the name and the
kind it was written with, carrying the provenance it was written with. What a
correction adds is standing and edges: a `contested` stamp with its
`contestedAt` and `orphanedSourceIds` audit, a retirement, or a verdict edge
to another entity that is itself still present under its own name. Two
entities a verdict unifies are two nodes afterwards, each addressable; the
unified reading is composed at read time across the edge.

## 4. Provenance enforced by the write path

Provenance holds because the write path refuses, not because a prompt asks for
it. Every element of `sourceNodeIds` is a real, existing AST hash, and on an
agent research run it is one whose bytes a retrieval tool returned to that run.

Three checks establish that, in a pinned order, over the deduped union of the
batch: 64-lowercase-hex format (`AST_HASH_PATTERN`, in `_normalize_fact`),
then existence in `ast_nodes` (`_verify_hashes_exist`), then retrieval
membership on research runs (`_verify_hashes_retrieved`, through the
`retrieved_addresses_check` seam) — all in `src/rlm/trellis_tools.py`. One
failing element refuses the whole batch before any write session opens, so a
refused batch leaves nothing partial behind.

Changes to that path leave each of the three running, in that order, over the
same elements, with the coverage it has now. A `sourceNodeIds` element reaches
the graph after format and existence have passed on it, and after membership
has passed on it when the run is a research run — no flag, environment value,
argument, caller, or second write path stands between an element and those
checks. Pins: `test:rlm-sandbox` [2]/[3]/[6], `test:rlm-workspace`, and the
unit pins beside them.

## 5. Code-mediated text

Code-mediated text is doctrine (`docs/architecture/CODE_MEDIATED_TEXT.md`).
Every location a write uses is a number the engine computed and returned.
Every byte that already exists arrives where it is going by an
engine-performed splice or by reference, under a hash guard that fails the
write when the target moved. Answers are submitted by reference.

The model's whole contribution is addresses, identifiers, parameters, and
prose it is authoring for the first time. Counting belongs to the engine:
positions, offsets, spans, lengths, occurrence counts, and sizes are values
the engine computes and the model receives. Moving existing bytes belongs to
the engine too — text already in the store or in a document reaches an edit,
an answer, or another document as an address the engine resolves, so those
bytes travel without passing through the model's output. Enforcement homes:
`trellis_textedit.py` with `npm run test:textedit` (containment, digest guard,
splice semantics), `trellis_answer.py` with `npm run test:answer-channel`.

## 13. Live blocks are the search space

Superseded versions are archive, not search space (owner direction, July 13,
2026).

Every default-discovery retrieval surface here — the ones present now, the
ones added later, and each under every parameterization it accepts — returns
live blocks only: members of some document's current version. The single route
to a superseded block is its explicit address, a hash or id the caller already
holds and supplies because that caller deliberately asked for history. Search
by predicate reaches live blocks and stops there, so no filter value, mode,
option, or default reaches superseded content by describing it.

Reference semantics: the `search_ast_nodes` EXISTS join, which places
current-version membership before `LIMIT` so discovery reads live blocks only
(`src/config/schema.ts`; the `schema.test.ts` filter pin and `test:repo-ingest`
Part 8, the planted dead twin), and the stage-2 checker's `gatherHashEvidence`
bridge, which is what a deliberate history read looks like.
