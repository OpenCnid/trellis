# Trellis Engineering Loop Roadmap

Status: **EL-10 implemented and activated and EL-11 implemented, owner acceptance not yet recorded for either; EL-00 through EL-06 accepted in the ledger; EL-07 blocked pending an owner unblock**

Owner direction: July 15, 2026

Program ID: `trellis-engineering-loop`

Current feature: `EL-10` (controller activation and status-authority migration),
pending owner acceptance. Implemented and activated July 15, 2026: the
controller runs, the activation run seeded eleven owner-approved records, and
`statusAuthority` is `protected_controller_state`. `EL-11` (the acceptance
ledger's steady-state write path and the approval-gate mapping) is implemented
as of July 16, 2026 (Session 63, PR #114); owner acceptance is recorded for
neither. EL-11's reachable-producer check (`EL-REQ-APPROVAL-010`) found that
EL-10's two recovery ceremonies have no non-test caller, so EL-10 fails
acceptance as unreachable until they are wired — the proposed next objective.
`EL-07` stays `blocked` until the owner records an unblock in the ledger; until
then `next_feature` resolving to `EL-10`, and to `null` once EL-10 is accepted,
is correct rather than a defect.

**Status now lives in the acceptance ledger, not this file and not
`features.json`.** The catalog carries immutable feature definitions only. Any
status stated in prose here is a convenience restatement of the ledger and is
never authority; read it with `npm run el:activate -- status`.

This roadmap decomposes the engineering-session loop into bounded features that
can be completed across fresh context windows. It is deliberately smaller than
`HANDOFF.md`: it records sequence, dependency, acceptance, and evidence
pointers, while architecture and implementation detail live in their own
artifacts.

## 1. Authority and use

Authority remains **code > glossary > prose**. Within the engineering-loop
program:

1. `TRELLIS_ROADMAP.md` decides whether this program is scheduled.
2. This file decides the program's feature sequence.
3. `features.json` is the machine-readable twin of that sequence.
4. `RESEARCH.md` preserves the evidence and hypothesis behind the sequence.
5. `tools/engineering-loop/SPEC.md` governs implementation conformance.
6. `HANDOFF.md` selects one bounded feature for the next session and points to
   the relevant sections; it must not copy this roadmap wholesale.
7. Code, tests, and captured command evidence decide whether a feature passed.

Until protected controller state exists, this file and `features.json` carry
bootstrap status in Git. Once it exists, the controller owns mutable run status
outside the agent-writable worktree and the versioned catalog retains immutable
feature definitions only.

**This transition was originally scheduled for the end of `EL-02` and did not
happen.** EL-02 built the state machinery and proved it under test, but nothing
was ever stood up to own status, so "temporarily" ran through `EL-06` —
`statusAuthority` still read `bootstrap_git_until_el_02`. The cause is recorded
here as a standing lesson: the transition was stated in this paragraph and
nowhere else. It had no `EL-REQ-*`, no conformance row, and no test that could
fail, so nothing caught four features of drift. `EL-10` both performs the
migration and makes it normative as `EL-REQ-BOOT-004`. Authority in this
repository is code > glossary > prose; a rule that lives only in prose is not
enforced, including this one.

## 2. Ratified program boundary

The research phase established these implementation constraints:

- Source, workflow policy, schemas, prompts, and feature definitions live in
  the Trellis repository.
- The controller runs as a separate process and does not enter
  `src/core/agent/`, the API, workers, BullMQ, PostgreSQL, Neo4j, or the RLM
  runtime.
- Trusted mutable state, approvals, budgets, and run events live outside the
  agent-writable worktree.
- One controller is the sole state writer in the first implementation.
- A Codex thread may resume within one bounded episode; a new semantic phase
  begins with a fresh thread compiled from typed state and observed evidence.
- Deterministic verification outranks model claims. Independent model review
  may recommend a transition but cannot perform it.
- Paid calls, destructive actions, pushes, and merges remain explicit human
  gates.
- `HANDOFF.md` becomes generated only after a deterministic renderer and
  migration check are accepted.
- No scheduler, issue tracker, concurrent writer, automatic push, or automatic
  merge is part of the initial implementation.

## 3. Context-window discipline

Every development session works on exactly one feature ID.

At session start:

1. Read `AGENTS.md` and `HANDOFF.md` as required by repository policy.
2. Read this roadmap's entry for the assigned feature.
3. Read only that feature's named architecture, specification, and code files.
4. Verify its dependencies are accepted in `features.json`.
5. Stop if the assigned feature would alter a ratified boundary without owner
   approval.

At session close:

1. Run the feature's acceptance checks.
2. Record exact commands and observed counts in the root roadmap ledger.
3. Reference controller evidence; status lives in the acceptance ledger
   (`npm run el:activate -- status`), never in the catalog or prose.
4. Regenerate `HANDOFF.md` with the next unblocked feature.
5. Keep historical detail in Git and the ledger, not in the next prompt.

## 4. Feature sequence

| Order | ID | Feature | Depends on | Paid work | Bootstrap status |
|---:|---|---|---|---|---|
| 0 | `EL-00` | Program roadmap and machine-readable feature catalog | — | Forbidden | Accepted |
| 1 | `EL-01` | Architecture record and normative service specification | `EL-00` | Forbidden | Accepted |
| 2 | `EL-02` | Control kernel: schemas, transitions, durable state, event journal, fake runner | `EL-01` | Forbidden | Accepted |
| 3 | `EL-03` | Repository observer and deterministic handoff renderer | `EL-02` | Forbidden | Accepted |
| 4 | `EL-04` | Prompt compiler, prompt contracts, pins, and context budgets | `EL-01`, `EL-02` | Forbidden | Accepted |
| 5 | `EL-05` | Codex app-server runner adapter and episode rotation | `EL-02`, `EL-04` | Forbidden in acceptance | Accepted |
| 6 | `EL-06` | Verification, protected gates, recovery, and independent checker | `EL-03`, `EL-04`, `EL-05` | Forbidden in deterministic acceptance | Accepted |
| 7 | `EL-07` | Bounded pilot, repeated evaluation, and `HANDOFF.md` migration decision | `EL-06` | Owner-gated | **Blocked on `EL-10`** |
| 8 | `EL-08` | Optional tracker, scheduler, concurrency, and multi-repository extraction decision | `EL-07` | Separately proposed | Deferred |
| 9 | `EL-09` | Optional verified ingestion of sanitized completed-run reports | `EL-07` | Separately proposed | Deferred |
| 10 | `EL-10` | Controller activation and status-authority migration | `EL-06` | Forbidden | Planned — **runs next, before `EL-07`** |

`EL-10` carries `order: 10` but executes before `EL-07`. Order is catalog
position, not execution sequence, for this one entry. The prerequisite is
carried by EL-07's `blocked` status rather than a dependency edge, because the
catalog audit requires every dependency to have a lower order than its
dependent and the owner declined a renumber. See the EL-10 record §4.4.

Dependency shape:

```text
EL-00 -> EL-01 -> EL-02 -> EL-03 -----------+
                 |                          |
                 +-------> EL-04 -> EL-05 -> EL-06 -> EL-10 -> EL-07
                                                                |  \
                                                                |   +-> EL-09
                                                                +-----> EL-08
```

The `EL-10 -> EL-07` edge is real but is not encoded in `features.json`
dependencies; EL-07's `blocked` status carries it. See §4 above.

## 5. Feature contracts

### EL-00 — roadmap and catalog

Outcome: a future session can identify the next feature, its dependencies,
scope, gates, and acceptance without reconstructing this research conversation.

Artifacts:

- `docs/product/engineering-loop/ROADMAP.md`
- `docs/product/engineering-loop/RESEARCH.md`
- `docs/product/engineering-loop/features.json`
- `docs/product/engineering-loop/feature.schema.json`
- One scheduling pointer in `TRELLIS_ROADMAP.md` §4

Acceptance:

- Both JSON files parse.
- Every feature ID is unique.
- Every dependency resolves to a declared feature.
- The dependency graph is acyclic.
- The human-readable and machine-readable order agree.
- No runtime code, prompt, model call, or paid work is introduced.

### EL-01 — architecture and normative specification

Outcome: a language-independent contract defines what a conforming controller
must do, while a Trellis architecture record explains why the selected boundary
exists.

Artifacts:

- `docs/architecture/ENGINEERING_LOOP.md`
- `tools/engineering-loop/SPEC.md`
- Ratified threat model and state-transition table
- Conformance matrix mapping every normative `MUST` to a feature and test

Acceptance focus:

- Process, trust, storage, episode, verification, approval, and recovery
  boundaries are explicit.
- Safe retry and unknown-side-effect behavior are specified.
- No unresolved priority-zero decision changes the trust boundary.
- No runtime implementation or production prompt is added.

Accepted July 14, 2026: the architecture record ratifies the repository-owned,
out-of-process, protected-state boundary and resolves all priority-zero trust
questions. The specification defined 106 stable mandatory requirements at
ratification; all 106 mapped to an existing feature, catalog acceptance item,
and planned test class, with zero unmapped requirements. EL-01 added no runtime
or prompt bytes. (`EL-10` later added `EL-REQ-BOOT-001` through
`EL-REQ-BOOT-007` on July 15, 2026, bringing the matrix to 113 rows, still with
zero unmapped requirements.)

### EL-02 — control kernel

Outcome: deterministic code owns workflow truth before any real agent can run.

Implemented capabilities:

- Zod schemas for workflow, feature, state, event, decision, and episode report
- Explicit allowed and forbidden transitions
- Atomic state snapshots and append-only JSONL events
- Single-writer locking
- Fake clock, fake repository, and fake agent runner
- Crash injection at every durable boundary

Acceptance focus:

- Restart reconstructs the same state.
- Completed side effects are not duplicated.
- Invalid transitions and forged approvals are refused.
- The entire suite is zero-model and zero-paid.

Deterministic acceptance passed July 14, 2026: the TypeScript reference kernel under
`tools/engineering-loop/` implements all 28 EL-02-owned requirements. Its
strict schemas, exhaustive 132-pair transition matrix (41 allowed / 91
forbidden), protected external state, exclusive writer lock, integrity-linked
event journal, event-first atomic snapshots, replay/corruption refusal, and
fake intent/outcome recovery passed 40 deterministic tool tests. Repository-
wide acceptance passed 916 tests across 92 files, the TypeScript build, Python
runtime checks, Compose configuration validation, catalog/schema/semantic
audits, SPEC linkage, and diff checks with zero model calls and zero paid work.
The owner reviewed and ratified the closeout on July 14, 2026, then explicitly
authorized commit, merge, and push to `master`.

### EL-03 — repository observer and handoff renderer

Outcome: Git and command observations replace model-authored claims about the
working tree, and the current handoff can be rendered deterministically.

Accepted capabilities:

- Branch, base commit, dirty state, changed-path, and scope observation
- Command evidence records with exit status and bounded output metadata
- Deterministic status view
- Generated handoff preview and manual-versus-generated migration diff

Acceptance focus:

- Identical state renders identical bytes.
- Out-of-scope edits and repository divergence stop the loop.
- The existing manual handoff remains authoritative until `EL-07`.

Deterministic acceptance passed July 14, 2026: the controller computes local
Git identity and complete NUL-delimited changed paths, refuses segment-scope
and repository divergence, executes bounded shell-free argv, retains full
output as protected digest-addressed artifacts, journals controller-observed
evidence, derives the strict report from trusted state, and renders byte-pinned
report, status, and handoff-preview bytes without external effects. All 12
EL-03 requirements have source and deterministic-test linkage; the focused
suite passed 64 tests across 5 files and repository-wide acceptance passed 977
tests across 96 files. Build, Python, Compose, catalog/schema, SPEC-linkage,
and diff checks passed with zero model calls and zero paid work. The owner
reviewed and ratified the EL-03 closeout on July 14, 2026, then explicitly
authorized commit, merge, and push to `master`. Manual `HANDOFF.md` remains
authoritative through the EL-07 migration decision.

### EL-04 — prompt compiler

Outcome: small role-specific prompt packets are compiled from invariant frames
and typed task data.

Planned prompt roles:

- Planner
- Implementer
- Read-only checker
- Recovery analyst

Acceptance focus:

- The attached Prompt-Engineering and Hypershot protocols govern every prompt
  and meta-prompt.
- Invariant hypershot frames precede generation; concrete task data remains in
  downstream context collections.
- Prompt bytes are normalized, versioned, hashed, budgeted, and snapshot-pinned.
- No task-specific concrete example contaminates a reusable system template.
- All model outputs cross a strict schema boundary.

Deterministic implementation evidence (Session 58): all seven EL-04
requirements map one-for-one to concrete source and deterministic tests. Four
normalized, versioned, hash-pinned invariant role assets compile ahead of six
separately bounded typed context collections. Strict input, packet, and
role-output schemas refuse unknown fields, role or identity mismatch,
duplicates, sensitive material, and byte-budget overflow. Static contamination
scans and pure-assembly import pins exclude mutable session facts and external
effects. Focused acceptance passed 60 tests across 3 files; repository-wide
acceptance passed 1,032 tests across 98 files, plus build, Python, Compose,
catalog/schema, and diff checks. Model calls = 0; paid calls = 0. The catalog
status was owner-ratified and merged as PR #104 at
`e1ee564923c9c02f532e08f1a5561d9837a7493a`.

### EL-05 — Codex runner and episode rotation

Outcome: the controller can start, observe, interrupt, and resume bounded Codex
episodes without treating a conversation as durable workflow truth.

Implemented capabilities:

- `AgentRunner` interface
- Fake runner remains the conformance oracle
- Codex app-server adapter
- Thread and turn identifiers in controller events
- Resume-within-episode and fresh-thread-at-boundary policy
- Timeout, stall, cancellation, and event-redaction handling

Acceptance focus:

- Protocol fixtures cover start, resume, interrupt, failure, and restart.
- Real integration smoke tests make no paid model call.
- The adapter cannot advance protected controller state directly.

Deterministic implementation evidence (Session 59): all 15 EL-05 requirements
map one-for-one to concrete source and deterministic tests. The versioned
adapter-neutral runner covers start, resume, interrupt, observe, and dispose;
the fake remains a zero-effect conformance oracle. The sole Codex wire boundary
pins `codex-app-server-jsonl:v2@0.144.2` and stable v2 schema SHA-256
`4d236168d44edcfb8df0244c90bd58b4fb8f85e443e29144d70bc564403ea8af`.
Lifecycle observations are ordered, correlated, byte/event/time bounded,
redacted before return, and terminal exactly once. The pure episode policy
resumes only unchanged current bindings and requires a fresh episode/thread at
every named semantic, repository, protocol, or context boundary. Focused
acceptance passed 69 tests across 4 files; repository-wide acceptance passed
1,094 tests across 101 files, plus build, Python, Compose, catalog/schema, and
diff checks. The explicit local smoke negotiated and disposed with outbound
methods `initialize`, `initialized`, zero thread requests, and zero turn
requests. Model completions = 0; paid calls = 0. On July 15, 2026, the owner
reviewed and ratified the EL-05 closeout and explicitly authorized commit,
merge, and push through the feature-branch pull-request path.

### EL-06 — verification, gates, recovery, and checker

Outcome: the loop can converge only through independent evidence and explicit
authority.

Planned capabilities:

- Immutable acceptance definitions and separate controller-observed command
  evidence with exact argv, cwd, environment, timeout, exit, repository,
  retained-output, and engine-count bindings
- External protected-channel approval policy for every §12 action, including
  estimates, expiry, exact scope, atomic consumption material, and impossible
  automatic push/merge
- Pure exhaustive failure classification, finite retry/recovery budgets,
  unknown-effect blocking, and append-only signed reconciliation
- Fresh start-only checker episodes with read-only filesystem access, no
  credentials/network/effects, strict correlations and output validation, and
  advisory-only authority
- Bounded coarse metric labels, pre-persistence redaction, retention
  declarations, and non-sensitive tombstones

Acceptance focus:

- Model claims cannot fabricate a passing command or approval.
- Only classified transient failures retry automatically.
- Unknown external side-effect outcomes stop for review.
- Automatic push and merge remain impossible.

Deterministic evidence on `implement-el06-verification-gates`: all 36 EL-06
requirements link one-for-one to implementation and tests; focused acceptance
passed 76 tests across 5 files; repository-wide acceptance passed 1,161 tests
across 105 files, plus build, Python, Compose, catalog/schema, and diff checks.
Model completions, paid calls, and real protected effects were zero. On July
15, 2026, the owner reviewed and accepted EL-06 and explicitly authorized
commit, merge, and push to `master`.

### EL-10 — controller activation and status-authority migration

Ratified July 15, 2026. Runs before `EL-07`. Paid work forbidden.

Outcome: the controller runs as a real process, owns mutable status in protected
state, and the catalog retains immutable feature definitions only — completing
the transition §1 scheduled for the end of `EL-02`.

Why it exists: the `EL-07` preflight requires protected controller acceptance
and states that repository prose is not acceptance. No protected controller
state existed. `StateStore.open()` had no caller outside tests, no entrypoint or
npm script existed, and no state root existed on disk. EL-02 through EL-06 built
a correct, well-tested, and entirely inert library. Separately, `statusAuthority`
still read `bootstrap_git_until_el_02` — the migration §1 promised after EL-02
never happened, because it was written as prose with no `EL-REQ-*`, no
conformance row, and no test that could fail.

Scope:

- A program-scoped **acceptance ledger**: a new append-only, integrity-linked
  protected artifact holding per-feature status. Required because
  `StateSnapshotSchema` is single-feature and nothing in protected state can
  express which features are accepted.
- A real `ProtectedApprovalChannel` reading owner-authored material from
  `protected_external`.
- A startup entrypoint resolving the ledger root, state root, worktree, and
  channel location.
- One-time seeding of EL-00 through EL-06 acceptance under a single
  owner-approved, atomically consumed `acceptance_change`.
- Status-authority migration: `statusAuthority` to `protected_controller_state`,
  `bootstrapStatus` removed from the catalog, status resolved from the ledger.

Requirements: `EL-REQ-BOOT-001` through `EL-REQ-BOOT-007` (SPEC §6.1). The
conformance matrix moves from 106 rows to 113. `BOOT-006` and `BOOT-007` are the
paired recovery ceremonies added July 15, 2026 after external review found the
original §6.1 left a corrupted ledger unrecoverable.

Design record: `EL10_CONTROLLER_ACTIVATION_PROPOSAL.md`. Its §9 is normative for
the implementing session and was owner-approved July 15, 2026.

Acceptance focus:

- Seeding is refused without owner approval, with forged, replayed, expired, or
  scope-mismatched approval, and against a non-empty ledger.
- A synthetic workflow history reaching `accepted` is forbidden; it would
  fabricate controller-attested events for runs that never occurred.
- All scoped records apply or none.
- The ledger refuses missing sequences, digest mismatch, and partial appends
  without silent repair, and routes each to its recovery ceremony.
- Both recovery ceremonies exist with disjoint, re-derived predicates: content
  corruption on a validating chain recovers by owner-approved append-superseding;
  integrity-chain corruption recovers only by out-of-band re-genesis, because a
  broken anchor cannot sign its own replacement.

Ordering constraint: activation has an owner-operated step in the middle. The
machinery lands first, the owner then authors approval material and runs
activation, and only then can `bootstrapStatus` leave the catalog — deleting it
earlier would leave the repository with no status source at all.

### EL-07 — pilot, evaluation, and migration

Outcome: measured evidence decides whether the loop replaces the manual session
workflow.

Planned evaluation:

- Isolated fixture repositories and deterministic fault injection
- Repeated model trials only after an owner-approved estimate
- Manual-versus-loop comparison for context size, orientation time, cost,
  interventions, stale-state defects, and acceptance reliability
- Human transcript review for failures and grader errors
- Explicit adopt, revise, or reject verdict

Migration gate:

- `HANDOFF.md` becomes generated only if the pilot meets the pre-stated
  thresholds and protected-gate tests remain perfect.

### EL-08 and EL-09 — deferred expansion

These features do not enter implementation automatically. Each requires a new
owner proposal after `EL-07`:

- `EL-08`: issue tracker, scheduler, concurrency, multi-machine durability, or
  extraction into a generic standalone project.
- `EL-09`: sanitization and verified ingestion of completed run reports for
  retrospective Trellis research.

## 6. Program-wide gates

- **Owner ratification:** architecture boundaries, acceptance changes, and the
  manual-to-generated handoff migration.
- **Paid-run gate:** printed estimate, explicit approval, hard cap, and actuals.
- **Self-modification gate:** prompt, schema, policy, verifier, or controller
  changes occur only as named harness features, never incidentally.
- **External-effect gate:** push, PR creation, merge, tracker writes, and
  destructive actions remain explicit.
- **Evidence gate:** a model report is an observation, never proof of command
  success.

## 7. Evidence ledger

Use one bounded entry per accepted or blocked feature. The structural frame is
intentionally content-free so future sessions fill it without copying prior
results:

```md
### {YYYY-MM-DD} — {FEATURE_ID}: {CONCISE_OUTCOME}

- Result: {ACCEPTED_OR_BLOCKED_WITH_REASON}
- Branch/PR: {REFERENCE}
- Artifacts: [{CHANGED_ARTIFACTS}]
- Commands: [{EXACT_COMMANDS}]
- Observations: [{RAW_COUNTS_AND_FINDINGS}]
- Defects: [{DEFECT_AND_DISPOSITION}]
- Next unblocked feature: {FEATURE_ID_OR_NONE}
```

The root roadmap §5 remains the canonical session ledger. This frame defines
the engineering-loop subset; it does not create a competing historical log.

## 8. Current next step

`EL-00` through `EL-06` are owner-accepted. **`EL-10`** — controller activation
and status-authority migration, ratified July 15, 2026 and zero-paid
throughout — is implemented and activated: the ledger, channel, entrypoint, and
seeder landed with deterministic tests; the owner authored the approval material
outside the controller (`EL-REQ-BOOT-002`, a step that cannot be self-served)
and the activation run seeded generation 0 (eleven records, chain valid,
approval consumed); `bootstrapStatus` left the catalog and status resolves from
the ledger. **`EL-11`** — the acceptance ledger's steady-state write path and
the approval-gate mapping — landed July 16, 2026 (Session 63, PR #114):
`recordAcceptanceChange` (`EL-REQ-BOOT-008`), the reachable-producer requirement
`EL-REQ-APPROVAL-010` with its static check, the `EL-REQ-APPROVAL-012`
conformance row, and the `EL-01-A2` mechanization.

What remains is owner action, not build: recording acceptance for EL-10 and
EL-11 in the ledger. EL-11's reachability check pins a live blocker on the
former — both EL-10 recovery ceremonies have no non-test caller, so EL-10 fails
acceptance as unreachable under `EL-REQ-APPROVAL-010` until they are wired to
real `activate.ts` commands (the proposed next objective).

`EL-07` is `blocked` until `EL-10` is accepted **and** the owner records an
explicit unblock. Until then `next_feature` resolves to `EL-10`, and after
EL-10's acceptance it resolves to `null` in the interval before the unblock — a
correct and existing state, not a defect.

Manual `HANDOFF.md` remains authoritative throughout EL-10, EL-11, and EL-07
unless the owner later records an adopt verdict.
