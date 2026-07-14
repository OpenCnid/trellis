# Trellis Engineering Loop Roadmap

Status: **prompt compiler ready for owner review; Codex runner proposed next**

Owner direction: July 14, 2026

Program ID: `trellis-engineering-loop`

Current feature: `EL-05` (proposed after owner acceptance of `EL-04`)

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

Until `EL-02` establishes protected controller state, this file and
`features.json` temporarily carry bootstrap status in Git. After `EL-02`, the
controller owns mutable run status outside the agent-writable worktree and the
versioned catalog retains immutable feature definitions only.

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
3. Update bootstrap status or, after `EL-02`, reference controller evidence.
4. Regenerate `HANDOFF.md` with the next unblocked feature.
5. Keep historical detail in Git and the ledger, not in the next prompt.

## 4. Feature sequence

| Order | ID | Feature | Depends on | Paid work | Bootstrap status |
|---:|---|---|---|---|---|
| 0 | `EL-00` | Program roadmap and machine-readable feature catalog | — | Forbidden | Accepted |
| 1 | `EL-01` | Architecture record and normative service specification | `EL-00` | Forbidden | Accepted |
| 2 | `EL-02` | Control kernel: schemas, transitions, durable state, event journal, fake runner | `EL-01` | Forbidden | Accepted |
| 3 | `EL-03` | Repository observer and deterministic handoff renderer | `EL-02` | Forbidden | Accepted |
| 4 | `EL-04` | Prompt compiler, prompt contracts, pins, and context budgets | `EL-01`, `EL-02` | Forbidden | Accepted (owner review pending) |
| 5 | `EL-05` | Codex app-server runner adapter and episode rotation | `EL-02`, `EL-04` | Forbidden in acceptance | Planned |
| 6 | `EL-06` | Verification, protected gates, recovery, and independent checker | `EL-03`, `EL-04`, `EL-05` | Forbidden in deterministic acceptance | Planned |
| 7 | `EL-07` | Bounded pilot, repeated evaluation, and `HANDOFF.md` migration decision | `EL-06` | Owner-gated | Planned |
| 8 | `EL-08` | Optional tracker, scheduler, concurrency, and multi-repository extraction decision | `EL-07` | Separately proposed | Deferred |
| 9 | `EL-09` | Optional verified ingestion of sanitized completed-run reports | `EL-07` | Separately proposed | Deferred |

Dependency shape:

```text
EL-00 -> EL-01 -> EL-02 -> EL-03 -----------+
                 |                          |
                 +-------> EL-04 -> EL-05 -> EL-06 -> EL-07
                                                       |  \
                                                       |   +-> EL-09
                                                       +-----> EL-08
```

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
questions. The specification defines 106 stable mandatory requirements; all
106 map to an existing feature, catalog acceptance item, and planned test
class, with zero unmapped requirements. EL-01 added no runtime or prompt bytes.

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

Planned capabilities:

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
status is the Session 58 bootstrap proposal; owner review and ratification have
not occurred.

### EL-05 — Codex runner and episode rotation

Outcome: the controller can start, observe, interrupt, and resume bounded Codex
episodes without treating a conversation as durable workflow truth.

Planned capabilities:

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

### EL-06 — verification, gates, recovery, and checker

Outcome: the loop can converge only through independent evidence and explicit
authority.

Planned capabilities:

- Deterministic acceptance-command executor
- Paid, destructive, push, merge, and acceptance-change gates
- Scoped approval records with estimates and expiry
- Transient, environmental, implementation, specification, policy, and harness
  failure classes
- Bounded retry policy
- Fresh, read-only checker episode

Acceptance focus:

- Model claims cannot fabricate a passing command or approval.
- Only classified transient failures retry automatically.
- Unknown external side-effect outcomes stop for review.
- Automatic push and merge remain impossible.

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

`EL-00` through `EL-03` are owner-accepted. `EL-04` has deterministic
acceptance and awaits owner review. After that review, the next
dependency-unblocked feature is `EL-05`: implement only the adapter-neutral
runner contract, pinned Codex app-server boundary, bounded lifecycle
observations, and episode-continuity/fresh-boundary policy defined by
`tools/engineering-loop/SPEC.md`. Acceptance uses deterministic protocol
fixtures and a zero-completion integration smoke test. It must not add the
EL-06 verifier, checker execution, approvals, protected effects, tracker,
scheduler, automatic push/merge, product-runtime integration, or paid/model
work. Manual `HANDOFF.md` remains authoritative until the EL-07 migration
verdict.
