# EL-10 proposal — controller activation and status-authority migration

Status: **RATIFIED July 15, 2026 — in the catalog as `EL-10`, not yet
implemented.**

Raised: July 15, 2026, by the EL-07 preflight gate.

Program ID: `trellis-engineering-loop`

The owner ratified EL-10 as a named harness feature gating EL-07, approved the
catalog changes, delegated the specification decision, and approved the §9
acceptance-ledger design. Landed under that ratification: SPEC §6.1 and its seven
`EL-REQ-BOOT-*` requirements, the `EL-10` catalog entry, EL-07's `blocked`
status, and recomputed renderer pins. §9.9 was added later the same day, after
external review found a deadlock in the original design.

No controller implementation exists yet. §9 is the design the implementing
session builds against.

## 1. Why this record exists

The `EL-07` preflight gate requires seven items to agree before any EL-07 edit
or trial: protected controller acceptance, `features.json` status, product
roadmap, root ledger, merged `origin/master`, clean assigned worktree, and
EL-07 dependency status. It closes with: *"Conversation or repository prose
alone is not acceptance."*

Six items agree. One is absent. The preflight instructs a stop without
implementation or paid work, and a report of the exact evidence.

## 2. Evidence

Each item below is independently reproducible from a clean checkout.

### 2.1 The six items that agree

| Item | Evidence |
|---|---|
| Merged `origin/master` | `origin/master` = `9d50b0e9013176b8c21f42bd1f429c9adf295803`, the EL-06 commit exactly; `git merge-base --is-ancestor` confirms |
| Clean assigned worktree | `git status --porcelain` empty; HEAD = `origin/master` |
| `features.json` status | EL-06 `accepted`; EL-07 `planned`, `paidWork: owner_gated` |
| EL-07 dependency status | `dependencies: ["EL-06"]`, satisfied |
| Product roadmap | `ROADMAP.md` §4 EL-06 Accepted; §8 EL-07 next unblocked |
| Root ledger | `TRELLIS_ROADMAP.md` §194 and the Session 60 entry; owner accepted July 15, 2026 |

### 2.2 The item that is absent: protected controller acceptance

No protected controller state exists. This is not stale or contradictory state.
It is state that has never been instantiated.

- `StateStore.open()` (`src/state_store.ts:249`) takes `stateRoot` as a
  caller-supplied option. No default, no environment variable, no fallback.
- Every caller of `StateStore.open()` is a test supplying a temporary
  directory.
- There is no CLI, entrypoint, `package.json` bin, or npm script under
  `tools/engineering-loop/`, and no module in `src/` imports it.
- No state root exists at any probed location on disk.

The controller has never run.

### 2.3 The corroborating finding

`features.json` declares:

```json
"statusAuthority": "bootstrap_git_until_el_02"
```

`feature.schema.json` constrains this field to
`["bootstrap_git_until_el_02", "protected_controller_state"]`.

`ROADMAP.md` §1 states:

> Until `EL-02` establishes protected controller state, this file and
> `features.json` temporarily carry bootstrap status in Git. After `EL-02`, the
> controller owns mutable run status outside the agent-writable worktree and the
> versioned catalog retains immutable feature definitions only.

The schema authors anticipated this migration and provided the target enum
value. It was never flipped. "Temporarily" has now spanned EL-02 through EL-06,
four features beyond its stated end.

`tests/requirements.test.ts:230` asserts only that `statusAuthority` is one of
the two permitted values. It never asserts which. The drift was machine-visible
and untested.

### 2.4 Scope of the pattern

The same shape recurs at three boundaries: the interface is defined and proven
under test, and the concrete adapter that would make it run was never built.

| Boundary | Interface | Real implementation |
|---|---|---|
| Protected state root | `StateStore.open()` | none — tests only |
| Approval channel | `ProtectedApprovalChannel` (`policy.ts:168`) | none — a test-local `class Channel` in `policy.test.ts:93` |
| Agent runner | `AgentRunner` | **`CodexAppServerRunner` exists and was smoke-tested under EL-05** |

The runner boundary is the control case: EL-05 built a real adapter, pinned the
wire protocol, and negotiated a live local smoke. The program is not uniformly
inert. The state and approval boundaries specifically were left at interface
plus test.

### 2.5 What the test suite does and does not establish

Repository-wide acceptance passes 1,161 tests across 105 files. That evidence is
sound and is not in question. It establishes that the control kernel is
**correct** — it does what it says when called.

It does not establish that the kernel is **reachable**. No test asserts that a
non-test caller exists. Correctness and deployment are independent claims, and
the suite speaks only to the first.

## 3. Analysis

### 3.1 This is not currently a live forgery risk

The architecture places protected state outside the agent-writable worktree so
that an agent, which can write the worktree, cannot forge its own acceptance
record. Today `bootstrapStatus` lives in `features.json`, inside the worktree —
the location the threat model excludes.

In practice nothing has been forged, because acceptance has been carried by a
human gate: the owner reviewed and ratified every feature, and `master` is
reached only through a reviewed pull request the agent cannot merge. The
Git-tracked status has been trustworthy. It has simply been trustworthy for a
reason other than the one the architecture specifies.

This proposal does not rest on an imminent-compromise argument.

### 3.2 The argument is specific to EL-07

EL-07 owns three requirements:

- `EL-REQ-OBS-003` — record model, tool, retry, intervention, verification,
  protected-action, token, cost, duration, stale-state, and terminal metrics;
- `EL-REQ-OBS-008` — retain bounded run evidence sufficient for repeated
  comparison and human failure analysis;
- `EL-REQ-VIEW-004` — migrate handoff authority only after repeated measurement
  against pre-stated thresholds, perfect protected-gate tests, no
  acceptance-reliability regression, human transcript review, and an owner
  verdict.

Its ratified design invariant is that **controller evidence outranks every
runner, checker, and grader report**.

Those metrics are meant to land in the controller's protected journal. That is
what makes them outrank the agent's own account of its performance. There is no
journal to land them in.

Running the pilot now means recording the deciding evidence into a temporary
directory created for the occasion, or into prose. EL-07 would then use
unprotected evidence to decide whether the protection machinery is trustworthy
enough to be given authority over `HANDOFF.md`. That is circular. The feature
that decides how far the evidence chain can be trusted is the worst place to
leave the evidence chain unestablished.

### 3.3 Why the migration cannot be deferred past activation

Seeding protected state while `computeNextFeature()` (`handoff_renderer.ts:111`)
still reads `bootstrapStatus` from the catalog produces two status records with
no defined precedence. The protected copy would be decorative — written, never
read. That reproduces the exact defect this record identifies, one layer down,
and would satisfy the preflight's letter while defeating its purpose.

Activation and status migration are therefore one change, not two.

## 4. Proposed feature

**`EL-10` — controller activation and status-authority migration.**

Outcome: the controller runs as a real process, owns mutable status in protected
state outside the agent-writable worktree, and the versioned catalog retains
immutable feature definitions only — completing the transition `ROADMAP.md` §1
scheduled for the end of EL-02.

Paid work: **forbidden.** This is deterministic throughout.

Gates: `owner_ratification`, `human_review`.

Dependencies: `EL-06`.

### 4.1 Scope

1. **Acceptance ledger.** A new program-scoped protected artifact holding
   per-feature status. §9 specifies it. This is new trust-bearing machinery, not
   wiring; see §4.6 for why nothing existing can hold this.
2. **Real approval channel.** A concrete `ProtectedApprovalChannel` reading
   owner-authored approval material from `protected_external`. The interface,
   `createProtectedApprovalRecord()`, and `authorizeProtectedAction()` already
   exist and are tested.
3. **Startup entrypoint.** A real process that resolves the ledger root, the
   workflow state root, the worktree, and the channel location, refusing any
   root inside, aliasing into, or writable through the assigned worktree.
   `EL-REQ-STORE-001` already specifies root resolution and
   `validateProtectedStateRoot()` already implements it; EL-10 supplies its
   first non-test caller.
4. **Acceptance seeding.** A one-time bootstrap writing the EL-00 through EL-06
   acceptances, EL-07's blocked status, and the EL-08/EL-09 deferrals into an
   empty ledger under one owner-approved, atomically consumed
   `acceptance_change`.
5. **Status-authority migration.** Flip `statusAuthority` to
   `protected_controller_state`; remove `bootstrapStatus` from the catalog
   schema and entries; resolve `computeNextFeature()` and the renderer's
   `CatalogSchema` status reads from the ledger; tighten
   `requirements.test.ts:230` to assert the exact value.

### 4.6 Correction: this is not wiring

An earlier draft of this record asserted that EL-10 mostly wires existing,
tested parts to an entrypoint. That was wrong, and the correction is the reason
§9 exists.

`StateSnapshotSchema` (`domain.ts:320`) is single-feature: one `featureId`, one
`state`. A state root holds one workflow, and `StateStore.open()` refuses a root
belonging to another. Nothing in protected state can express "EL-00 through
EL-06 are accepted." `acceptedFeatureIds` is caller-supplied at every site that
uses it — `kernel.ts:66` and `handoff_renderer.ts:142` — and no code derives it
from state.

The container does not exist. Seeding had nowhere to write. The approval
machinery is reusable as claimed; the destination is not, and had to be
designed.

### 4.2 The seeding operation is the highest-risk element

Item 3 deserves explicit attention, because a bootstrap that writes "EL-00
through EL-06 are accepted" into protected state is, described neutrally, the
precise forgery tool the architecture exists to prevent. Built carelessly it
would hand the agent a one-shot path to grant itself any acceptance.

It must therefore be built as a consumer of the existing approval machinery,
never as a privileged side door:

- `acceptance_change` is already a member of `PROTECTED_ACTIONS`
  (`policy.ts:47`). No new protected action is required, and none should be
  added.
- Approval material is owner-authored, read from `protected_external` via the
  channel, and consumed atomically — the agent supplies the request, never the
  authorization.
- Seeding is refused if protected state already holds any acceptance record, so
  it cannot be replayed to overwrite history.
- Each seeded acceptance is journaled as an ordinary integrity-linked event, not
  written directly to a snapshot.

If the design cannot satisfy these constraints, the correct outcome is to stop
and return to the owner, not to relax them.

### 4.3 Proposed acceptance criteria

| ID | Kind | Requirement |
|---|---|---|
| `EL-10-A1` | integration | A real non-test entrypoint resolves a protected state root outside the assigned worktree and refuses contained, aliased, and symlink-reachable roots. |
| `EL-10-A2` | integration | Acceptance seeding succeeds only with owner approval material read from the protected external channel and atomically consumed; it is refused without approval, with forged or replayed approval, and against non-empty acceptance state. |
| `EL-10-A3` | static | The catalog carries no mutable status; `statusAuthority` is `protected_controller_state`; every status read resolves to protected state; and a test asserts the exact authority value. |
| `EL-10-A4` | integration | With status in protected state, the derived report, status view, and handoff preview render deterministically and resolve `next_feature` to `EL-07`. |

### 4.4 Catalog changes — as landed

`feature.schema.json` constrains feature IDs to `^EL-[0-9]{2}$`, so no
fractional or suffixed ID is admissible. This record originally proposed
inserting `EL-10` at `order: 7` and shifting `EL-07`/`EL-08`/`EL-09` down. The
owner declined the shift: `EL-10` keeps `order: 10`, and the prerequisite is
documented rather than renumbered.

That choice forecloses the obvious mechanism. The catalog audit
(`requirements.test.ts:204`) requires every dependency to have a **lower order**
than its dependent:

```js
expect((byId.get(dependency)).order).toBeLessThan(feature.order);
```

`order` must also equal array index (`requirements.test.ts:190`), so `order` is
constrained to be a dense, valid topological sort of the dependency graph. A
forward edge from `EL-07` (order 7) to `EL-10` (order 10) is therefore not
expressible. Adding `EL-10` to EL-07's `dependencies` fails the audit.

Prose alone is also not viable: with EL-07 left `planned`,
`computeNextFeature()` would keep resolving `next_feature` to `EL-07` while the
prose said otherwise — reproducing the exact prose-versus-machine divergence
this feature exists to eliminate.

**As landed:** `EL-10` appended at `order: 10` with `dependencies: ["EL-06"]`,
and `EL-07` moved from `planned` to `blocked`. `computeNextFeature()` filters to
`planned` candidates, so EL-07 leaves the candidate set and `EL-10` — planned,
with its one dependency accepted — becomes `next_feature`. Verified: the derived
report resolves `EL-10`, and the full catalog audit passes with no test change.

This mutates no existing entry's order and no accepted feature's definition.
Every feature ID and acceptance binding, including the `EL-07-A1` through
`EL-07-A4` bindings that `HANDOFF.md` references, is preserved.

Two consequences to accept deliberately:

1. The prerequisite is not machine-readable as a graph edge. `blocked` records
   *that* EL-07 is blocked, not *what* blocks it; the reason lives in this
   record, EL-07's roadmap contract, and the ledger.
2. Unblocking EL-07 after EL-10 is accepted is a manual owner act, not an
   automatic consequence of the dependency graph. Given that owner authority is
   the point of the gate, an explicit unblock is defensible — but it is a step
   that can be forgotten, and it is recorded here so it is not.

### 4.5 Specification impact

SPEC currently defines 106 stable mandatory requirements, all mapped to a
feature, acceptance item, and test class, with zero unmapped.

Resolved and landed. SPEC §6.1 adds five requirements —
`EL-REQ-BOOT-001` through `EL-REQ-BOOT-007` — covering entrypoint resolution,
approval-gated seeding, seeding refusals, status authority, and ledger
integrity, and the two recovery ceremonies of §9.9. The conformance matrix moves
from 106 rows to 113, all mapped, with
zero unmapped requirements.

A new `BOOT` family was chosen over extending `STORE` or `APPROVAL`: activation
is a distinct concern, and a separate family keeps it greppable without
inflating an accepted feature's requirement set.

`EL-REQ-VIEW-003` was reviewed and deliberately left unchanged. It holds manual
`HANDOFF.md` authoritative until the owner records an adopt verdict; EL-10
records no verdict, so it is already covered, and amending an EL-03-owned
requirement would be churn against an accepted feature.

## 5. Non-goals

EL-10 does not include: any paid call; any model trial; scheduler, daemon,
tracker, or concurrent writer; product-runtime integration; automatic push or
merge; changes to `src/core/agent/`, the API, workers, BullMQ, PostgreSQL,
Neo4j, or the RLM runtime; any EL-07 implementation; and any change to handoff
authority. Manual `HANDOFF.md` remains authoritative.

## 6. Risks

- **Size.** Four coupled pieces, and §3.3 argues they cannot be split without
  leaving a dual-truth state worse than either endpoint. This may exceed one
  bounded session. If the owner prefers a split, the honest seam is
  activation-plus-seeding (items 1–3) and migration (item 4) landing in
  immediate succession, accepting a brief dual-truth window under an explicit
  recorded caveat — not an open-ended one.
- **Renderer pins.** EL-03 byte-pins report, status, and handoff-preview output.
  Moving status reads to protected state changes those bytes; the pins must be
  recomputed, and the recomputation reviewed rather than blindly accepted.
- **Test-shape change.** Tests currently construct state from temp roots. A real
  entrypoint introduces a first-class configuration surface that the suite must
  cover without weakening the existing fakes-as-oracle discipline.

## 7. Owner decisions — recorded July 15, 2026

1. **Ratified.** `EL-10` is a named harness feature gating `EL-07`.
2. **Amended.** The owner declined the `order` shift; `EL-10` keeps `order: 10`
   and the prerequisite is documented rather than encoded as a dependency edge.
   §4.4 records the mechanism this forced.
3. **Delegated.** Specification decisions were left to the implementing
   session's judgment; §4.5 records what was chosen and why.
4. **Superseded.** The owner elected one session. That is no longer reachable:
   §4.6 found that the seeding destination does not exist, so EL-10 grew an
   acceptance-ledger design (§9) that must be ratified before implementation.
   The owner approved writing that design; implementation is a fresh session.

## 8. Alternatives considered

- **Amend the preflight.** Rule that the reviewed pull-request path *is* the
  protected channel for bootstrap status, and correct the gate wording. This is
  a coherent position: `master` is branch-protected, the agent cannot merge, and
  the owner ratifies each feature. It is cheaper and it is not a strawman. It
  does not address §3.2 — EL-07 still has no journal for its metrics — and it
  weakens "prose is not acceptance" immediately before the feature that most
  depends on it.
- **Owner override.** Waive the protected-acceptance item for EL-07 only,
  recorded in the ledger. Fastest. Leaves §3.2 unaddressed and leaves the §1
  migration owed indefinitely.
- **Proceed and migrate afterward.** Run the pilot, migrate later. Rejected:
  EL-07's output is the migration verdict itself, so its evidence would be
  produced by the machinery it is evaluating, recorded outside the protection
  whose adequacy it is meant to measure.

## 9. Acceptance ledger design

Owner-approved July 15, 2026. This section is the design EL-10 implements
against; it is normative for the implementing session and is mirrored by
`EL-REQ-BOOT-001` through `EL-REQ-BOOT-007` in SPEC §6.1.

### 9.1 Why a new artifact rather than workflow state

Two rejected alternatives, recorded so they are not revisited:

**Reuse the workflow snapshot.** Impossible: it is single-feature (§4.6).

**One state root per feature, where "EL-06 accepted" means the EL-06 workflow's
snapshot reads `accepted`.** This needs no schema change and must still be
rejected. The transition matrix forbids jumping to `accepted`; reaching it
requires walking `selected → preparing → running → verifying → awaiting_review →
accepted`, which manufactures controller-attested events for runs that never
happened. It would write forged provenance into the trust store as its first
act — the module #1 laundering failure, reintroduced at the foundation. SPEC
§6.1 forbids it normatively.

Feature status is program-scoped; workflow state is feature-scoped. They are
different facts and get different artifacts.

### 9.2 Placement and locking

The ledger lives in its own protected root, resolved independently and
validated by the existing `validateProtectedStateRoot()`:

```text
<ledgerRoot>/
  .writer.lock                      # WriterLock, unchanged, workflowId 'workflow:program-acceptance'
  generations/
    0/acceptance.jsonl              # generation 0
    1/acceptance.jsonl              # a later generation, if re-genesis ever occurs
  current                           # names the current generation
```

Generations exist because of §9.9: integrity-chain corruption cannot be repaired
in place or appended past, so recovery establishes a new generation and retains
the corrupt one read-only. A program that never corrupts its ledger has exactly
one generation and can ignore the concept.

`WriterLock.acquire()` writes `join(root, '.writer.lock')` — the lock is scoped
by *path*, and the workflow ID only identifies the holder inside the record. A
distinct root therefore reuses the locking code unchanged, with a sentinel
workflow ID, and cannot contend with a workflow state root's lock.

This keeps EL-02's accepted surface untouched: no change to `domain.ts`,
`state_store.ts`, `writer_lock.ts`, or the 132-pair transition matrix. The
ledger is strictly additive.

### 9.3 Record schema

```ts
AcceptanceRecordSchema = z.strictObject({
  id: StableIdSchema,              // acceptance:<featureId>:<sequence>
  schemaVersion: z.literal(DOMAIN_SCHEMA_VERSION),
  sequence: z.number().int().nonnegative(),
  previousDigest: DigestSchema,    // sha256 of the prior record; 64 zeros for sequence 0
  createdAt: TimestampSchema,
  featureId: StableIdSchema,
  status: z.enum(['planned', 'active', 'accepted', 'blocked', 'deferred']),
  catalogDigest: DigestSchema,     // catalog bytes this record was authorized against
  approvalId: StableIdSchema,      // the consumed approval
  requestDigest: DigestSchema,     // the protected request this answers
  actor: z.literal('human'),       // authority; never 'controller' or 'model'
})
```

`status` mirrors the catalog's existing `bootstrapStatus` enum so migration is a
move, not a redefinition. `actor` is pinned to `human`: no other authority can
produce an acceptance record, which is the schema-level statement of "the
controller cannot accept its own work."

Integrity follows `EL-REQ-STORE-003`: `previousDigest` links each record to
`sha256Canonical()` of its predecessor, reusing `events.ts` helpers.

### 9.4 Resolution

`resolveFeatureStatus(ledger)` replays every record in sequence, verifies the
digest chain, and takes the **last record per `featureId`** as current. Accepted
IDs are the subset whose current status is `accepted`. This is what feeds the
`acceptedFeatureIds` parameter that `kernel.ts:66` and `handoff_renderer.ts:142`
already accept — those signatures do not change, so the migration is a matter of
supplying a real producer where callers previously supplied fixtures.

Tests keep supplying fixture status directly. That separation is correct: the
renderer's job is deterministic rendering given status, not knowing the truth.

Per `EL-REQ-BOOT-005`, a missing sequence, digest mismatch, invalid schema, or
truncated final line stops resolution and requires human reconciliation. The
controller never repairs, truncates, or skips a bad record.

`catalogDigest` is recorded for provenance, not enforcement. The catalog changes
legitimately, so a mismatch between a record's `catalogDigest` and the current
catalog is normal and MUST be reported in the derived view rather than refused
or silently ignored.

### 9.5 Seeding

One `acceptance_change` protected action, not ten:

- The request's scope enumerates every `(featureId, status)` pair explicitly —
  eleven at activation, within `MAX_PROTECTED_SCOPE_ITEMS` (64).
- The owner authors one approval covering that exact scope, into the channel.
- `authorizeProtectedAction()` verifies it; the approval is consumed atomically.
- All records append or none do. A partial append is a `EL-REQ-BOOT-005` stop.

One approval rather than eleven is a deliberate ergonomic choice that costs no
safety: the scope names each pair exactly, so approving it is approving each
claim individually, and the digest binding means a single altered pair
invalidates the whole approval.

Refusals required by `EL-REQ-BOOT-003`, each with a test:

| Condition | Behavior |
|---|---|
| Ledger already holds any record | Refuse; seeding is once-only |
| No approval in the channel | Refuse |
| Approval scope differs from request scope | Refuse |
| Approval digest mismatch | Refuse |
| Approval already consumed | Refuse; no replay |
| Approval expired | Refuse |
| Any record invalid | Refuse all; no partial |

### 9.6 Steady state after activation

Acceptance is never written by workflow completion. A workflow reaching
`awaiting_review` is the controller's work; moving a feature to `accepted` in
the ledger is a separate owner act through the same `acceptance_change` path
that seeding uses. Seeding is not a privileged special case — it is the ordinary
path applied to an empty ledger, which is why it needs no privileged code.

Consequence for EL-07: after EL-10 is accepted, EL-07 remains `blocked` until
the owner records a status change unblocking it, and `next_feature` resolves to
`null` in the interval. That is correct — the unblock is an owner decision, and
a null next feature is an existing, meaningful state (it was observed during
EL-06's own review window).

### 9.7 What this does not do

No scheduler, daemon, concurrent writer, or multi-machine durability. No change
to `HANDOFF.md` authority. No paid call. No product-runtime import. The ledger
is local, single-writer, and program-scoped; a general durable store remains an
EL-08 question.

### 9.8 Open questions for the implementing session

1. Whether the ledger root and workflow state root may be the same directory
   with distinct filenames. This record assumes separate roots because a shared
   `.writer.lock` would couple program-scoped seeding to workflow-scoped
   execution. Confirm before implementing.
2. Whether `resolveFeatureStatus()` belongs in a new `acceptance_ledger.ts` or
   alongside the renderer. This record assumes the former: the renderer must not
   grow a dependency on protected state.
3. Exact on-disk approval material format, which the owner must author. Present
   it for approval before the activation run, not after.

### 9.9 Recovery ceremonies (amendment, July 15, 2026)

**This section corrects a deadlock in the original §9**, found by external review
and reproduced against the merged SPEC before fixing.

**The defect.** `EL-REQ-BOOT-003` refused seeding against a non-empty ledger and
forbade repair. `EL-REQ-BOOT-005` stopped on corruption and required "human
reconciliation" — an outcome with no tooling named. Composed: a corrupted,
non-empty ledger had **no path back to a good state**. Seeding refused it, repair
was forbidden twice, and the only remaining recovery was hand-editing the
protected file — precisely the untrusted-side write this whole design exists to
prevent. The bootstrap ceremony shipped without its paired recovery ceremony,
which the trust-anchor literature treats as mandatory (KSK rollover, RFC 5011).

**The first fix was also wrong**, and is recorded because the reasoning matters.
Reusing EL-06's append-only signed reconciliation (`EL-REQ-RECOVERY-010`) covers
*content* corruption on a validating chain. It cannot cover integrity-chain
corruption, because the reconciliation record's `previousDigest` would have to
point at a corrupt predecessor — inheriting or masking the break. And
integrity-chain corruption is exactly what `EL-REQ-BOOT-005` stops on. The
proposed fix did not reach the case that produced the deadlock.

**Two ceremonies, disjoint predicates:**

| Case | Predicate | Ceremony |
|---|---|---|
| Content corruption | Generation non-empty, chain validates | `ledger_recovery`: append a signed reconciliation under `EL-REQ-RECOVERY-010`, marking superseded records without mutating them. Owner-approved through the channel, atomically consumed. |
| Integrity-chain corruption | Chain broken (missing sequence, digest mismatch, invalid schema, partial append) | Re-genesis: a new generation under the seeding gate, opened by a signed genesis record naming the break point, expected and observed digests, and the reconstruction basis. The corrupt generation is retained read-only and stays resolvable as history. |

`ledger_recovery` is a new protected action. It is trust-bearing, so it belongs in
`PROTECTED_ACTIONS`; adding it is a `policy_change` and is gated as one. It is
distinct from `acceptance_change` for a reason beyond taxonomy: distinct actions
keep the three refusal predicates disjoint and mechanically checkable — seeding
requires an empty generation, `ledger_recovery` requires a non-empty validating
one, re-genesis requires a broken one. Folding recovery into `acceptance_change`
would force a mode flag to distinguish them, and a flag is what rots.

**Why re-genesis needs no new gate.** A new generation is empty, so
`EL-REQ-BOOT-003`'s refusal governs it unchanged and seeding applies as written.
Re-genesis is not a privileged path around the seeding gate; it is the seeding
gate, applied to a fresh generation, with a genesis record explaining why the
generation exists.

**Residual, stated rather than closed.** Re-genesis reconstructs from a basis the
owner supplies, and the corrupt generation is evidence, not authority. Nothing
here establishes that the reconstruction is *correct* — only that it is
owner-authorized, that the break is named, and that the corrupt history survives
for audit. Correctness of a reconstruction is a human judgment and stays one.
