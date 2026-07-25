# Trellis — the feature list

> *Trellis: it's an expert at working with your data.*

**Status: PROPOSED, July 24, 2026. A planning artifact, not a design record and not an
authorization.** Written before security hardening deliberately: a hardening pass over an
unspecified feature set produces a queue of follow-ups rather than a boundary, because every
control has to be re-litigated the moment a feature it did not anticipate arrives.

**Governed by [AMBIENT.md rule 24](../../AMBIENT.md).** Every row below is a consequence of that
rule or a component that serves it. Where a row's status contradicts the rule, the rule wins and the
row is the work.

**How to read the status column.** `shipped` — built with a non-test caller. `built, unreachable` —
built with no non-test caller, which is not delivered ([rule 15](../../AMBIENT.md)). `partial` —
serves one case of a general capability. `absent` — nothing stands in for it. **`PLACEHOLDER`** — deferred by the owner and the collaborator pending a capability Trellis does not have (typically a model connection); the seam is roughed in so the shape exists, and the capability lands later.

---

## 1. Holds the information

The substrate. This layer is the one the audit found healthiest, and nothing here is on the
critical path.

| # | feature | what it means | status |
|---|---|---|---|
| 1.1 | Content-addressed store | Every stored fact traces to immutable source bytes; nodes final at write time | shipped |
| 1.2 | Verified ingest | One transaction every document crosses; parsers for markdown, code, PDF | shipped |
| 1.3 | Structural chunking | Syntax-aligned, size-budgeted blocks; byte-exact | shipped |
| 1.4 | Live-blocks-only retrieval | Superseded versions are archive, reachable only by explicit address | shipped |
| 1.5 | Repository snapshot ingest | Whole-repo scoped snapshots, carry-forward for out-of-scope paths | shipped |
| 1.6 | Multi-tenant identity | A principal the store can name | **CLOSED, not applicable** (owner, 2026-07-24) — **one user, one instance.** Ownership is the deployment boundary, so it needs no representation. Enterprise scales by cloning a base image of the raw data, each clone owned by its user. Nothing in the substrate names an owner and nothing needs to |

## 2. Reasons over it

The worker. This is the layer that drifted toward retrieval.

| # | feature | what it means | status |
|---|---|---|---|
| 2.1 | Persistent REPL per task | One process, one task; namespace survives turns | shipped |
| 2.2 | Flat sub-LLM fan-out | `llm_query` over slices at depth 1 | shipped |
| 2.3 | Code-mediated text | Engine computes locations; bytes move by splice or reference | shipped |
| 2.4 | **Corpus `locate` + bounded window** | Query the corpus for addresses; read a bounded range — what `trellis_textedit` already does for files | **built, unreachable** — `repl_sandbox/algebra.py` has `locate`, `narrow`, text-free `get_ast_blocks`, byte metering, handle-typed `llm_query` context. Nothing outside `src/repl_sandbox/` imports it; production spawns `src/rlm/trellis_agent.py` |
| 2.5 | Byte-metered extraction budget | "No more than needed" needs a unit; today the budget counts calls | **absent** in the live path, shipped in 2.4's layer |
| 2.6 | Turn budget affording composition | Several turns and multiple slices, per rule 24 | **wrong shape** — schema ceiling of 9, and the kernel instructs collapsing turns |
| 2.7 | **Iteration-exhaustion path that keeps its guards** | Running out of turns must not bypass the answer channel | **defect** — `rlms` re-prompts over the transcript and returns that as `FINAL_ANSWER`: no literal check, no cap, no telemetry, no protocol violation. See §6 |
| 2.8 | Durable artifact-under-construction state | A growing, engine-measured buffer the model deposits into across turns | **absent** — `upsum` is a 2,000-char shrinking summary; the workspace has no model-facing deposit path |

## 3. Produces a deliverable

**The hole, and the reason this list exists.** No layer of the system can express a deliverable that
is not a string.

**The artifact is not a terminal output — it is a contribution to the store** (owner and
collaborator, 2026-07-24). A run composes it, it is **filed into the user's own REPL store**, and the
judges **promote and classify** it, so it lands as a fact, a belief, or a doubt and carries standing
like anything else the user owns. It then becomes part of the corpus the next query slices.

That closes the loop this system is named for: **the output becomes input.** It also means §3 and §6
are one pipeline rather than two subjects — a deliverable that carries standing is not a different
object from one that carries content, it is the same object after the judges have seen it. And it is
why 3.5 needs no new provenance structure: an artifact filed into the store inherits the machinery
every other stored thing already crosses.

| # | feature | what it means | status |
|---|---|---|---|
| 3.1 | **Response artifact object** | A durable, addressable, Trellis-side object a run composes and the orchestrator links. Not a rendering — the thing itself | **absent** |
| 3.2 | **Artifact sink** | A by-reference write path: the model names parts, the engine assembles. Distinct from `answer.submit`, which renders one value | **absent** — `answer.submit(H)` is documented in two records and was never built |
| 3.3 | **Output location** | A run-scoped place to create files. `TRELLIS_EDIT_ROOT` is an *edit* root and `load` refuses a non-existent file | **absent** |
| 3.4 | **Non-text artifact types** | Spreadsheet, PDF with chart, slide deck, text with illustration | **absent, PLACEHOLDER** — no `openpyxl`/`matplotlib`/`reportlab`/`pptx`-class dependency exists. Rough in the seam; some types need model connections that do not exist yet |
| 3.5 | **Artifact provenance** | Which slices composed which deliverable, resolvable to source bytes | **absent** — the system's own value proposition, unapplied to its output |
| 3.6 | Artifact receipt | The submitted string names the artifact rather than restating it | partial — `submit` is the right shape for a receipt and is currently doing both jobs |
| 3.7 | Repository as artifact | For code editing, the write is the deliverable | **partial** — `trellis_textedit` + `stage2_selfedit_check.ts` are a working loop; missing file *creation*, a link from run outcome to write, and any byte telling the worker the write was the point |

## 4. Acts in the world — MCP outbound

Trellis takes human-like actions: query a service, book a thing, request work. Today this is framed
as a research intake.

| # | feature | what it means | status |
|---|---|---|---|
| 4.1 | Allowlisted MCP client | stdio + streamable HTTP, per-server tool allowlist, bounded results | shipped |
| 4.2 | Harness-guaranteed capture | Results captured to workspace segments; model sees a stub | shipped |
| 4.3 | **MCP available to the orchestrator** | Rule 24 names MCP as the orchestrator's toolbox | **absent** — no MCP reference anywhere in `src/core/agent/`; it is injected into the RLM worker only |
| 4.4 | **Action semantics** | A tool call that *does* something, with a result that carries standing | **wrong shape** — `EXTERNAL CONTENT CONTRACT (HARD RULE): MCP results are research context ONLY` |
| 4.5 | **Non-text tool results** | Images and embedded resources the protocol already carries | **absent, PLACEHOLDER** — flattened to the literal string `[non-text content: <type>]` at the boundary. An image tool needs a model connection Trellis does not have; rough in the seam and defer the capability |
| 4.6 | Action authorization | Which side effects need a human gate, and how that is asked | **absent** — the allowlist is the only control, and it is configuration, not consent |

## 5. Serves peers — A2A inbound

Peer agents query Trellis as a human would, without knowing its internals.

| # | feature | what it means | status |
|---|---|---|---|
| 5.1 | JSON-RPC surface | `SendMessage`, `SendStreamingMessage`, `GetTask`, `CancelTask`; live-wired behind `config.a2a.enabled` | shipped |
| 5.2 | Spec-faithful refusal | Out-of-scope operations declined whole, with the spec's own error codes | shipped |
| 5.3 | Admission bounded ahead of allocation | `StreamGate` counts a stream in before resources exist | shipped |
| 5.4 | **Typed artifact parts** | A2A's `artifacts` array carries `oneof (text \| raw \| url \| data)` | **wrong shape** — `renderArtifact` hardcodes one `text` part from `finalAnswer`; the agent card declares `text/plain` as capability. **The envelope the target needs is already there, empty** |
| 5.5 | Peer identity and trust | Which peer asked, and what that entitles | **absent** — bearer key or open |

## 6. Forms beliefs and doubts

The epistemic layer — **and, after the 2026-07-24 rulings, the second half of §3 rather than a
separate concern.** The judges are what turn a composed artifact into a filed one with standing.

**The gate everyone has been respecting is on a *removal*, and the thing that is wanted is an
*addition* — those were conflated, which is why this has sat.**

`STANDING_MODEL.md` was ratified July 20, 2026 and its status line says it "authorizes **no build**."
Its §3 says exactly what the withheld authorization covers: if the panel never moves standing, the
promotion machinery reduces to a findings recorder plus a user gate, and *"**that reduction removes
shipped engine surface**"* — so deleting or rewriting shipped disposition code needs its own owner
dated entry and drills. **The gate is on deleting code.**

Surfacing `doubts` / `beliefs` / `facts` as REPL state spaces is not that. It is an addition, it is
already designed — [DATA_MODEL §7](repl-sandbox/REPL_SANDBOX_DATA_MODEL.md) specifies three
**pre-allocated root handles** at `setup`, `kind = graph-view`, sliced by the algebra and never
materialised whole — and **no gate covers it.** It was never scheduled, not never approved.

| # | feature | what it means | status |
|---|---|---|---|
| 6.1 | Provenance-bound beliefs | `sourceNodeIds` enforced by the write path, not by prompt | shipped |
| 6.2 | Invalidation sweep | Beliefs contest when their source bytes die | shipped |
| 6.3 | Support arithmetic | Graded, decaying (b,d,u) computed sweep-side, writer-blind | shipped |
| 6.4 | Composed judge ceremony | Judges composed per context from primitives | design-resolved, unbuilt |
| 6.5 | Doubts / objections / defeaters | The −1 tier; a doubt is *based on* its objection | ratified as principle, no build |
| 6.6 | Signed ternary + user gate | −1/0/+1 standing; the user ratifies; the panel never moves standing | ratified as principle, no build |

## 7. Builds its own modules — the capability flywheel

| # | feature | what it means | status |
|---|---|---|---|
| 7.1 | Grounded authoring | A run with **zero retrieval affordance** derives a protocol from a seeded corpus and writes `modules/<name>/{module.json,addendum.txt,RESEARCH.md}` | **shipped** — and it is the response artifact, done, for one case |
| 7.2 | Derivation gate | Assembly refuses below a derivation threshold | shipped |
| 7.3 | Module registry + byte-pinned composition | Manifest, acceptance criterion naming its own module, composed-prompt pins | shipped |
| 7.4 | Self-editing | Trellis may edit Trellis; the repo is the artifact | partial — see 3.7 |

## 8. Knows the user

Rule 24's "one mega-context" includes the user. This is the thinnest column in the list.

| # | feature | what it means | status |
|---|---|---|---|
| 8.1 | **Stored user preferences** | Preferences live in the substrate and are pulled each run, not configured per deployment | **absent** — no preference, profile, or persona retrieval anywhere in `src/core/agent/` |
| 8.2 | **Orchestrator rules from the REPL** | The orchestrator's behaviour is data-driven from the user's own store | **absent** — `ORCHESTRATOR_SYSTEM_PROMPT` is a static string |
| 8.3 | User gate on ratification | The user, not a panel, moves standing | ratified as principle, no build |

---

## What blocks what

```
rule 24 (landed)
   │
   ├─ 3.1 artifact object ──┬─ 3.2 sink ─┬─ 3.3 location ─ 3.4 non-text types
   │                        │            └─ 3.5 provenance ← needs 1.6 principal
   │                        └─ 5.4 A2A typed parts        (rendering, not home)
   │
   ├─ 2.7 exhaustion defect ─── 2.6 turn budget   (2.6 is unsafe to widen before 2.7)
   │
   ├─ 2.4 reachability ─── 2.5 byte budget        (mostly migration, not construction)
   │
   └─ 4.3 orchestrator MCP ─── 4.4 action semantics ─── 4.6 authorization
```

**Three orderings I hold with some confidence.** The artifact object (3.1) precedes its renderings —
A2A parts and the UI are two views of one Trellis-side thing, not two places it lives. The
exhaustion defect (2.7) precedes widening the turn budget (2.6), because more turns currently means
more chance of landing on the guard-free path. And artifact provenance (3.5) needs a principal (1.6)
before "these are the requester's own bytes" is a sentence the system can form.

**What this list deliberately does not do:** sequence the work, estimate it, or authorize any of it.
It exists so a security pass has a fixed surface to harden against.

## Open questions for the owner

**Answered by the collaborator, July 24, 2026.**

1. **The artifact is a Trellis-side object; A2A is one rendering.** Confirmed. 3.1 precedes 5.4, and
   the human UI and a peer agent are two views of one thing.
2. **An artifact carries standing.** It is filed as a **fact, a belief, or a doubt**, depending on
   its purpose and what it carries — so §3 and §6 are one subject, not two, and 3.5 rides the
   provenance machinery that already exists rather than needing a new structure.
   [DATA_MODEL §7](repl-sandbox/REPL_SANDBOX_DATA_MODEL.md) already designs the shape: `doubts`,
   `beliefs` and `facts` as three **pre-allocated root handles** at `setup`, `kind = graph-view`,
   sliced by the algebra and never materialised whole. *(My original question meant multi-tenant
   owner identity — still open as 1.6, and a smaller question than it looked, since ownership is now
   a property of a filed artifact rather than a prerequisite for having one.)*
3. **`TEST_TIME_TRAINING` §12.2 needed no adjudication.** It was misread. §12 is a
   literature-applicability analysis; §12.2 argues that LaCT's long-context results *do* transfer,
   which is a claim about research relevance and not about desired behaviour. **TTT is the mechanism
   for rule 24's second sentence** — the harness composes a prompt from internal primitives, the
   composed prompt sets the mode, the model self-plays over REPL data, and **properly filtered
   programmatic slicing is the rewarded behaviour**, scored by RLVCG (arXiv:2607.19044). It targets a
   local open-weights model that does not exist yet (§7 R3; `TRELLIS_RLM_BACKEND` is root-agent only,
   worker transport not configurable), which is why it reads as forward-looking rather than current.

**Ruled by the owner, 2026-07-24 — both open questions closed.**

- **Identity: one user, one instance.** Ownership is the deployment boundary and is never
  represented in the store. Enterprise expands by cloning a base image of the raw data, each clone
  owned by its user; symlinking the shared base is the variant. 1.6 is closed as not applicable.
- **Sequencing: artifacts now.** They ship into the single-tenant store immediately, with no
  recipient slot — a hedge that only earns its place when more than one recipient is possible, which
  under one-user-one-instance it never is. The migration story is image cloning, which carries
  artifacts with everything else and needs no backfill against append-only rows.

**Nothing in this list is now blocked on an owner decision.** What remains open is build
authorization, which is a different gate.

*Siblings: [AMBIENT.md rule 24](../../AMBIENT.md) (what is being built) ·
[RESPONSE_ARTIFACT.md](../architecture/RESPONSE_ARTIFACT.md) (the doctrine and the audit) ·
[CODE_MEDIATED_TEXT.md](../architecture/CODE_MEDIATED_TEXT.md) (how bytes move).*
