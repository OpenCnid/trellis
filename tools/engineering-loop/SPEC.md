# Trellis Engineering Loop — Normative Service Specification

Status: **RATIFIED for EL-01; implementation not started**

Version: 1

Date: July 14, 2026

Architecture record: [`docs/architecture/ENGINEERING_LOOP.md`](../../docs/architecture/ENGINEERING_LOOP.md)

Program roadmap: [`docs/product/engineering-loop/ROADMAP.md`](../../docs/product/engineering-loop/ROADMAP.md)

Feature catalog: [`docs/product/engineering-loop/features.json`](../../docs/product/engineering-loop/features.json)

## 1. Normative language

The key words **MUST**, **SHOULD**, and **MAY** are interpreted as follows:

- **MUST** identifies a mandatory conformance requirement. Every mandatory
  requirement has one stable `EL-REQ-*` identifier and appears exactly once in
  the conformance matrix.
- **SHOULD** identifies recommended behavior. A deviation needs a recorded
  engineering reason but does not by itself make an implementation
  non-conforming.
- **MAY** identifies permitted optional behavior.

Requirement identifiers are permanent. A superseded requirement is retained
with a disposition; its identifier is never reassigned to different semantics.
This document specifies protocol behavior independently of implementation
language. TypeScript is the planned reference implementation.

## 2. Goals and non-goals

The service controls one bounded repository engineering feature across one or
more agent episodes. It owns durable workflow truth, observes the repository,
compiles role-specific context, invokes an agent through an adapter, verifies
results, enforces protected gates, recovers after interruption, and renders
deterministic status views.

The initial service is not a product feature of Trellis, a general scheduler,
an issue tracker, a concurrent multi-agent coordinator, a source-control bot, a
replacement for human review, or a route around paid/destructive authorization.
It does not use Trellis databases, queues, APIs, workers, or the RLM as its state
store or execution dependency.

## 3. Terminology and component model

The protocol uses these components:

- **Controller:** the sole transition and mutable-state authority.
- **State store:** protected mutable snapshots, journal, locks, approvals, and
  evidence references outside the agent-writable worktree.
- **Repository observer:** code that reads branch, commit, status, changed paths,
  file digests, and command results.
- **Prompt compiler:** the EL-04 component that assembles role packets from
  invariant frames and typed data.
- **AgentRunner:** an adapter-neutral lifecycle interface for bounded agent
  episodes.
- **Worker agent:** an untrusted proposer that may edit only its assigned
  worktree scope.
- **Verifier:** controller-owned deterministic acceptance execution.
- **Checker:** a fresh, read-only reviewer whose semantic opinion is advisory.
- **Renderer:** a deterministic view generator over trusted state and evidence.
- **External effect target:** any system outside controller state, including a
  paid model, Git remote, tracker, package registry, or destructive host action.

### 3.1 Core boundary requirements

| ID | Requirement |
|---|---|
| `EL-REQ-CORE-001` | Stable workflow source, feature definitions, schemas, prompt source, and policy MUST live in the Trellis repository under ordinary source review. |
| `EL-REQ-CORE-002` | The controller MUST execute out of process and MUST NOT be imported into `src/`, the API, workers, BullMQ, Redis, PostgreSQL, Neo4j, the RLM, or `src/core/agent/`. |
| `EL-REQ-CORE-003` | Trusted mutable controller state, approvals, budgets, events, leases, and retained evidence MUST live outside every agent-writable worktree. |
| `EL-REQ-CORE-004` | Exactly one controller process holding the valid writer lock MUST be permitted to mutate one workflow instance in the initial implementation. |
| `EL-REQ-CORE-005` | The protocol core MUST remain language-independent while the first reference implementation uses TypeScript and repository-standard validation. |
| `EL-REQ-CORE-006` | A session MUST execute exactly one feature whose declared dependencies are accepted and whose scope is fixed before the first agent episode. |
| `EL-REQ-CORE-007` | The initial implementation MUST NOT include tracker polling, a scheduler, concurrent writers, automatic push, automatic merge, or an implicit durable-workflow dependency. |

## 4. Typed domain objects

The exact serialization schemas are an EL-02 implementation choice within the
following semantic objects:

- **Workflow:** immutable program identity, policy/schema versions, feature
  catalog digest, repository identity, and ordered feature set.
- **Feature:** catalog ID, dependencies, scope, artifacts, acceptance criteria,
  gates, paid-work class, and immutable definition digest.
- **Session:** one attempt at one feature, with expected repository state,
  budgets, lifecycle state, episode/evidence/approval references, and result.
- **Episode:** one bounded runner context with a role, semantic phase, context
  digest, runner/thread/turn references, budgets, and terminal reason.
- **Event:** the append-only transition record with sequence, previous digest,
  timestamp, actor, object references, type, and bounded payload.
- **Approval:** protected human authorization for one action and scope, with
  estimate/cap, repository preconditions, issuance, expiry, and consumption.
- **Evidence:** a typed controller observation or retained artifact reference,
  with provenance, digest, time, and bounded metadata.
- **Decision:** a proposed state transition with from/to state, reason,
  authority, evidence references, approval references, and policy version.
- **Report:** a deterministic bounded summary of result, artifacts,
  requirements, verification, findings, and next unblocked feature.

### 4.1 Domain requirements

| ID | Requirement |
|---|---|
| `EL-REQ-DATA-001` | The implementation MUST validate versioned schemas for workflow, feature, session, episode, event, approval, evidence, decision, and report at every read and write boundary. |
| `EL-REQ-DATA-002` | Every persisted domain object MUST carry a stable identifier, schema version, creation time, and the identifiers needed to bind it to its workflow, feature, and session. |
| `EL-REQ-DATA-003` | A feature definition and its acceptance criteria MUST become immutable for an active session; any change MUST be a protected acceptance-change action that creates a new definition digest and session decision. |
| `EL-REQ-DATA-004` | Evidence MUST identify whether it was controller-observed, human-issued, runner-reported, checker-reported, or externally reconciled, and MUST carry a digest or immutable reference for retained bytes. |
| `EL-REQ-DATA-005` | An approval object MUST bind issuer, protected action, workflow, feature, session, exact scope, repository preconditions, estimate or limit when applicable, issue time, expiry, and consumption state. |
| `EL-REQ-DATA-006` | A report MUST contain `feature`, `result`, `artifacts`, `normative_requirements` with computed count and unmapped list, `verification`, `findings`, and `next_feature` fields derived from trusted state. |

## 5. State machine

### 5.1 States

| State | Class | Meaning |
|---|---|---|
| `selected` | ordinary | Feature and immutable definition are selected; no repository preflight yet |
| `preparing` | ordinary | Dependencies, repository state, scope, budgets, and context inputs are being established |
| `running` | ordinary | A bounded worker episode is active or resumable |
| `verifying` | ordinary | Controller-owned deterministic checks are running |
| `awaiting_approval` | protected wait | A named protected action is paused pending a matching approval |
| `awaiting_review` | protected wait | Deterministic checks passed and human semantic/diff review is pending |
| `recovering` | recovery | The writer is reconstructing state and reconciling observations after interruption |
| `accepted` | terminal | All acceptance evidence and required human decisions are recorded |
| `blocked` | terminal | Progress requires new authority or an external-state change; the reason is recorded |
| `failed` | terminal | The session ended with an unrecoverable implementation, specification, policy, or harness failure |
| `cancelled` | terminal | A human cancelled the session |

### 5.2 Allowed transition table

| From | To | Class | Preconditions and authority |
|---|---|---|---|
| none | `selected` | ordinary | Controller selects one dependency-satisfied catalog feature |
| `selected` | `preparing` | ordinary | Definition digest and session record committed |
| `preparing` | `running` | ordinary | Repository preflight, scope, budgets, and role packet valid |
| `running` | `running` | ordinary | Same episode is eligible for continuation or a same-phase bounded replacement starts |
| `running` | `verifying` | ordinary | Worker proposes completion; controller re-observes repository state |
| any nonterminal work state | `awaiting_approval` | protected | A named protected action is needed; resume state is recorded |
| `awaiting_approval` | recorded resume state | protected | Matching unexpired approval is consumed atomically with the decision |
| `awaiting_approval` | `blocked` | terminal | Approval is denied, expires, or cannot match the requested scope |
| `verifying` | `awaiting_review` | ordinary | Every deterministic acceptance command and scope check passes |
| `awaiting_review` | `accepted` | protected | Required owner/human review and acceptance decision are recorded |
| any nonterminal state | `recovering` | recovery | Restart or durable-boundary ambiguity requires reconstruction |
| `recovering` | reconstructed nonterminal state | recovery | Journal replay and external/repository reconciliation agree |
| any nonterminal state | `blocked` | terminal | Policy requires new authority, an unknown side effect exists, or an external prerequisite is absent |
| any nonterminal state | `failed` | terminal | A typed unrecoverable failure is recorded |
| any nonterminal state | `cancelled` | protected terminal | Human cancellation is recorded |

### 5.3 State requirements

| ID | Requirement |
|---|---|
| `EL-REQ-STATE-001` | Persisted state MUST be one of the states in §5.1, and unknown states MUST be rejected rather than coerced. |
| `EL-REQ-STATE-002` | The controller MUST implement only the allowed transitions in §5.2 and MUST reject every unlisted transition before any external effect. |
| `EL-REQ-STATE-003` | Each transition decision MUST name the prior state, proposed state, actor authority, policy version, reason, and exact evidence and approval identifiers used. |
| `EL-REQ-STATE-004` | Transition validation and durable event creation MUST occur in the single-writer controller, never in the runner, worker, checker, renderer, or worktree. |
| `EL-REQ-STATE-005` | Model output MUST NOT authorize, commit, or imply a protected or terminal transition. |
| `EL-REQ-STATE-006` | Ordinary progress MUST pass through `preparing`, `running`, `verifying`, and `awaiting_review`; a controller MUST NOT skip deterministic verification because a worker or checker reports success. |
| `EL-REQ-STATE-007` | A protected action MUST enter `awaiting_approval` or `awaiting_review` and MUST remain paused until a matching human record is validated. |
| `EL-REQ-STATE-008` | Terminal session state MUST be immutable; additional work requires a new session linked to the terminal predecessor. |
| `EL-REQ-STATE-009` | Recovery MUST reconstruct from durable records and observations and MUST NOT treat an in-memory object, conversation, or model summary as state truth. |
| `EL-REQ-STATE-010` | `accepted` MUST require satisfied dependencies, in-scope diff, passing deterministic acceptance, no unresolved unknown side effect, required protected approvals, and recorded human review. |

### 5.4 Forbidden transitions

The following are forbidden by the table and requirements above:

- a worker or checker report directly to `accepted`;
- `running` directly to `awaiting_review` or `accepted`;
- an outgoing transition from a terminal state;
- retry from an unknown external-effect outcome;
- resuming a thread after its semantic phase, feature, role, definition digest,
  repository precondition, or context budget changed;
- a runner, checker, renderer, or agent-writable file mutating state; and
- a protected effect without a matching approval consumed for that exact
  effect.

## 6. State store and restart

The initial store is a local, protected, single-writer store. A general durable
workflow engine MAY replace it only through EL-08 after measured need and a
recorded migration design.

| ID | Requirement |
|---|---|
| `EL-REQ-STORE-001` | Startup MUST resolve the protected state root and MUST refuse any root that is inside, aliases into, or is writable through the assigned worktree. |
| `EL-REQ-STORE-002` | The controller MUST acquire an exclusive writer lock before reading mutable state for execution and MUST refuse a second writer without mutating state. |
| `EL-REQ-STORE-003` | The event journal MUST be append-only, monotonically sequenced, and integrity-linked to the preceding committed event. |
| `EL-REQ-STORE-004` | A transition event MUST be durably appended before the corresponding new snapshot is published or the transition is exposed as committed. |
| `EL-REQ-STORE-005` | A state snapshot MUST be written by atomic replacement, MUST identify the last applied event sequence and digest, and MUST never be edited in place. |
| `EL-REQ-STORE-006` | Restart MUST load the newest valid snapshot, replay every later valid event in order, and reconstruct the same logical state as uninterrupted execution. |
| `EL-REQ-STORE-007` | Missing sequences, digest mismatch, invalid schema, impossible transition, or snapshot/journal disagreement MUST stop recovery and require human reconciliation; the controller MUST NOT silently repair or discard history. |
| `EL-REQ-STORE-008` | Crash injection at each journal, snapshot, approval-consumption, and side-effect record boundary MUST demonstrate deterministic recovery without duplicated completed effects. |

## 7. Repository observation and scope

Repository observations are evidence produced by code. Implementations SHOULD
prefer stable machine-readable Git output and SHOULD retain bounded raw output
for diagnosis.

| ID | Requirement |
|---|---|
| `EL-REQ-REPO-001` | Before execution, the observer MUST compute repository root, branch, base commit, current HEAD, clean/dirty state, and configured remote identity without relying on model-authored values. |
| `EL-REQ-REPO-002` | The session MUST bind an explicit allowed-path scope and MUST compute every changed path before verification and review. |
| `EL-REQ-REPO-003` | Unexpected branch, HEAD, base, worktree, or out-of-scope-path divergence MUST stop execution before another edit, verification result, or protected effect is accepted. |
| `EL-REQ-REPO-004` | Command evidence MUST record exact argv, working directory, start/end time, exit status, timeout/cancellation state, bounded output metadata, and a digest or retained reference for output bytes. |
| `EL-REQ-REPO-005` | A worker statement about Git state, changed paths, command success, or test counts MUST remain a report and MUST NOT substitute for observer evidence. |
| `EL-REQ-REPO-006` | Controller state and approvals MUST NOT be written to, symlinked through, parked in, or reconstructed from the agent worktree. |

## 8. Prompt compilation contract

This section reserves EL-04 behavior and does not contain a production prompt
or meta-prompt. Planner, implementer, checker, and recovery analyst are the
planned roles. Role packets SHOULD disclose only the context tiers needed for
the current decision and MAY link to larger retained artifacts by digest.

| ID | Requirement |
|---|---|
| `EL-REQ-PROMPT-001` | Production prompt or meta-prompt bytes MUST be introduced only by EL-04 or a later named prompt-change feature, never incidentally by controller implementation. |
| `EL-REQ-PROMPT-002` | Every prompt artifact and amendment MUST be authored under the repository Prompt-Engineering and Hypershot protocols before its bytes are written. |
| `EL-REQ-PROMPT-003` | Reusable invariant structural frames MUST precede generation, while feature-specific facts, concrete task data, evidence, and repository observations MUST remain in typed downstream collections. |
| `EL-REQ-PROMPT-004` | Prompt compilation MUST draw separately from invariant policy, current typed state, active plan, verified evidence, bounded episode history, and archive references using progressive disclosure. |
| `EL-REQ-PROMPT-005` | Compiled prompt bytes MUST be normalized, role- and version-identified, hashed, context-budgeted, and snapshot-pinned with the compiler and policy versions. |
| `EL-REQ-PROMPT-006` | Every planner, implementer, checker, and recovery output MUST cross a strict validated schema before it can be recorded or considered by the controller. |
| `EL-REQ-PROMPT-007` | A reusable template MUST NOT contain a task-specific concrete input/output example, approval token, credential, or secret, and context-budget overflow MUST produce a deterministic refusal or fresh-episode boundary. |

## 9. `AgentRunner` contract

The core interface is adapter-neutral. Codex app-server is the first planned
adapter because it exposes thread and turn lifecycle, continuation,
interruption, and event observation. EL-05 selects and pins its protocol
version; this specification does not import the current wire schema.

Conceptually, `AgentRunner` provides start, resume, interrupt, observe, and
dispose operations over typed requests and events. An implementation MAY expose
additional adapter diagnostics if they cannot mutate workflow truth.

| ID | Requirement |
|---|---|
| `EL-REQ-RUNNER-001` | The controller MUST depend on an adapter-neutral `AgentRunner` contract for start, resume, interrupt, event observation, and disposal. |
| `EL-REQ-RUNNER-002` | The Codex app-server adapter MUST pin and report its supported protocol version before a real episode starts. |
| `EL-REQ-RUNNER-003` | Adapter wire messages and unstable external types MUST be translated at the adapter boundary and MUST NOT become controller domain schemas. |
| `EL-REQ-RUNNER-004` | A deterministic fake runner and fake clock MUST remain the conformance oracle for the control kernel and MUST require no model call or paid service. |
| `EL-REQ-RUNNER-005` | A runner adapter MUST NOT write controller state, consume approvals, decide acceptance, or invoke a protected effect on its own authority. |
| `EL-REQ-RUNNER-006` | Start and resume results MUST carry stable runner, thread, turn, episode, and request identifiers sufficient to correlate every observed event. |
| `EL-REQ-RUNNER-007` | Timeout, stall, cancellation, interruption, adapter disconnect, and process exit MUST produce typed observations and bounded controller behavior. |
| `EL-REQ-RUNNER-008` | Runner events MUST be bounded, ordered per episode, and redacted before durable persistence or prompt reuse. |

## 10. Episode and context continuity

| ID | Requirement |
|---|---|
| `EL-REQ-EPISODE-001` | Every episode MUST bind one session, feature, role, semantic phase, definition digest, repository precondition, prompt digest, time budget, turn budget, and context budget. |
| `EL-REQ-EPISODE-002` | Thread continuation MUST be limited to the same bounded episode while all bindings in `EL-REQ-EPISODE-001` remain unchanged. |
| `EL-REQ-EPISODE-003` | A role change, semantic phase change, feature or acceptance change, recovery analysis, checker run, or context-budget boundary MUST create a fresh episode and fresh thread. |
| `EL-REQ-EPISODE-004` | The independent checker episode MUST be fresh, read-only, and unable to reuse the implementer's writable runner session or credentials. |
| `EL-REQ-EPISODE-005` | Conversation history, compaction output, runner memory, and model-generated summaries MUST NOT serve as durable workflow, approval, repository, or evidence truth. |
| `EL-REQ-EPISODE-006` | A fresh episode packet MUST be compiled from validated typed state, current repository observations, required policy, active plan, evidence references, and a bounded prior report. |
| `EL-REQ-EPISODE-007` | Repository divergence, stale definition digest, expired approval, or incompatible prompt/adapter version MUST invalidate continuation and force stop or fresh reconstruction. |
| `EL-REQ-EPISODE-008` | Every episode MUST end with a typed terminal observation and bounded report even when interrupted, timed out, or failed before the first model turn. |

## 11. Deterministic verification and evidence precedence

Evidence precedence is:

1. protected human authority records for decisions humans own;
2. controller-observed repository and command evidence;
3. deterministic derived checks over that evidence;
4. read-only checker recommendations;
5. worker and other model reports.

Higher layers do not make semantic quality infallible; they decide which source
is permitted to authorize a transition. A conflict at the same authoritative
layer is an error to reconcile, not an invitation to pick the convenient fact.

| ID | Requirement |
|---|---|
| `EL-REQ-VERIFY-001` | Acceptance commands MUST be launched and observed by the controller or its deterministic verifier, not by trusting runner text. |
| `EL-REQ-VERIFY-002` | The verifier MUST execute the immutable acceptance definition bound to the active feature and MUST record each command as separate evidence. |
| `EL-REQ-VERIFY-003` | Transition evaluation MUST apply the evidence precedence in §11 and MUST NOT let a lower-precedence report override a conflicting higher-precedence observation. |
| `EL-REQ-VERIFY-004` | A passing command MUST require the expected process exit status, no timeout or cancellation, valid repository preconditions, and output evidence sufficient to identify observed counts. |
| `EL-REQ-VERIFY-005` | Every required deterministic check, scope check, catalog dependency, and protected precondition MUST pass before `awaiting_review`. |
| `EL-REQ-VERIFY-006` | The checker MUST be read-only and advisory; its recommendation MAY block for human review but MUST NOT mark the feature accepted or edit the worktree. |
| `EL-REQ-VERIFY-007` | Missing, stale, contradictory, or unverifiable acceptance evidence MUST stop advancement and MUST be reported as a finding. |

## 12. Approvals and protected effects

Protected actions are: any paid model/service call; destructive filesystem,
database, queue, or external-system action; push; merge; acceptance-definition
change; controller, policy, schema, prompt, verifier, or gate self-modification;
and manual-to-generated handoff migration. PR creation and tracker writes are
external effects and remain separately authorized if later enabled.

| ID | Requirement |
|---|---|
| `EL-REQ-APPROVAL-001` | Every protected action named in §12 MUST be represented by a typed request and MUST pause before execution until a matching human approval is validated. |
| `EL-REQ-APPROVAL-002` | Approval truth MUST be issued and stored through a protected channel outside the agent-writable worktree; model text and repository files MUST NOT constitute approval. |
| `EL-REQ-APPROVAL-003` | Approval validation MUST match action, workflow, feature, session, exact target/scope, repository preconditions, estimate or limit, issue time, expiry, and unused status. |
| `EL-REQ-APPROVAL-004` | An approval MUST authorize only the requested effect and MUST NOT be broadened, inherited by another session, or reused for a contingency, retry, or larger scope. |
| `EL-REQ-APPROVAL-005` | Paid work MUST present an estimate before approval, enforce the repository hard cap of no more than USD 5 per run, stop at the approved lower cap when one exists, and record actual tokens and cost. |
| `EL-REQ-APPROVAL-006` | Approval consumption MUST be atomic with the protected decision or durable intent record, and expired, revoked, mismatched, or previously consumed approvals MUST be refused. |
| `EL-REQ-APPROVAL-007` | Changing acceptance, policy, schema, prompt, verifier, controller, or gate behavior MUST be a named reviewed feature judged by the previously accepted controller and policy. |
| `EL-REQ-APPROVAL-008` | Approval identifiers MAY enter prompts for reference, but approval secrets, credentials, and bearer values MUST NOT enter prompts, worktrees, logs, diffs, or metric labels. |
| `EL-REQ-APPROVAL-009` | The initial controller MUST NOT automatically push or merge under any configuration; a later implementation requires separate protected actions and owner-ratified scope. |

## 13. Failure, idempotency, retry, and recovery

Failure taxonomy:

| Class | Meaning | Default disposition |
|---|---|---|
| `transient` | Explicitly typed temporary failure with proven no-effect or idempotent retry | Bounded automatic retry permitted |
| `environmental` | Missing service, tool, credential, quota, disk, network, or runtime prerequisite | Block pending external change |
| `implementation` | Candidate code or behavior violates the accepted spec or tests | Return to bounded implementation/recovery analysis; no silent retry |
| `specification` | Requirements conflict, are incomplete at priority zero, or cannot determine acceptance | Block for owner decision |
| `policy` | Requested action violates scope, approval, security, or repository policy | Refuse and block or fail as configured |
| `harness` | Controller, verifier, observer, runner adapter, or grader malfunction | Stop; diagnose the harness independently |
| `unknown_side_effect` | An external effect may have occurred but no authoritative outcome is available | Stop for human reconciliation; never automatic retry |
| `cancelled` | Human cancellation | Terminal cancellation |

| ID | Requirement |
|---|---|
| `EL-REQ-RECOVERY-001` | Every failure MUST be classified into the taxonomy in §13 before the controller chooses retry, block, fail, recover, or cancel. |
| `EL-REQ-RECOVERY-002` | Automatic retry MUST be limited to a typed transient failure for which no side effect occurred or the identical operation is proven idempotent under the same key. |
| `EL-REQ-RECOVERY-003` | Every retry policy MUST define a finite attempt bound and bounded delay, and exhausting the bound MUST stop rather than reset the counter or silently continue. |
| `EL-REQ-RECOVERY-004` | Before invoking an external effect, the controller MUST durably record an intent containing a stable operation ID, idempotency key when supported, target, exact scope, approval, and preconditions. |
| `EL-REQ-RECOVERY-005` | After an external effect, the controller MUST durably record a typed outcome or an explicit unknown outcome before committing any dependent transition. |
| `EL-REQ-RECOVERY-006` | A retry of an idempotent effect MUST reuse the same operation and idempotency identifiers and MUST reconcile any previously recorded target state first. |
| `EL-REQ-RECOVERY-007` | An unknown external-effect outcome MUST transition to `blocked`, MUST identify the reconciliation needed, and MUST NOT be retried automatically or treated as success. |
| `EL-REQ-RECOVERY-008` | Restart recovery MUST reconstruct controller state first, then re-observe the repository and reconcile every incomplete side-effect intent before starting or resuming an agent. |
| `EL-REQ-RECOVERY-009` | Environmental, specification, policy, harness, and unknown-side-effect failures MUST NOT consume an automatic implementation retry. |
| `EL-REQ-RECOVERY-010` | Human reconciliation or override MUST append a new signed decision and evidence record; it MUST NOT mutate, delete, or rewrite prior events or outcomes. |

## 14. Observability, redaction, and retention

Implementations SHOULD keep human-readable logs separate from the journal while
linking both through stable IDs. Metrics MAY aggregate across sessions only with
bounded labels.

| ID | Requirement |
|---|---|
| `EL-REQ-OBS-001` | Controller and runner lifecycle events MUST include timestamp, workflow, feature, session, episode, event type, actor, correlation identifiers, and bounded status metadata. |
| `EL-REQ-OBS-002` | Metric labels MUST be bounded enums or coarse identifiers and MUST NOT contain prompts, task text, diffs, paths, commands, output, hashes, URLs, credentials, approval values, or model content. |
| `EL-REQ-OBS-003` | Session telemetry MUST report controller/policy version, feature, role, runner/adapter version, model identifier when used, prompt digest, episode/turn counts, token counts, elapsed time, and monetary actuals. |
| `EL-REQ-OBS-004` | Secrets and configured sensitive patterns MUST be redacted before any event, log, artifact, report, or future prompt is persisted. |
| `EL-REQ-OBS-005` | Large prompts, transcripts, command output, and diffs MUST be retained only as protected artifacts with digest, media/type metadata, byte count, and journal reference. |
| `EL-REQ-OBS-006` | A workflow MUST declare retention and deletion policy before execution, and retention expiry or operator deletion MUST leave a non-sensitive tombstone event rather than a dangling success claim. |
| `EL-REQ-OBS-007` | Raw credentials, approval secrets, bearer tokens, and unredacted secret-bearing environment values MUST NOT be persisted by the controller. |
| `EL-REQ-OBS-008` | Reports and measurements MUST publish raw counts, retries, failures, interventions, tokens, cost, and unresolved findings together; null or surprising results MUST remain findings. |

## 15. Generated views and handoff migration

| ID | Requirement |
|---|---|
| `EL-REQ-VIEW-001` | The renderer MUST produce byte-identical status and handoff previews from identical trusted state, evidence references, renderer version, and repository observations. |
| `EL-REQ-VIEW-002` | A rendered status, report, or handoff MUST be a derived view and MUST NOT mutate or outrank the event journal, snapshot, approvals, or evidence. |
| `EL-REQ-VIEW-003` | The manually maintained `HANDOFF.md` MUST remain authoritative through EL-06 and throughout the EL-07 comparison unless and until the owner records an adopt verdict. |
| `EL-REQ-VIEW-004` | Handoff migration MUST require repeated EL-07 measurement against pre-stated thresholds, perfect protected-gate tests, no acceptance-reliability regression, human transcript review, and an owner adopt/revise/reject decision. |
| `EL-REQ-VIEW-005` | Generated context MUST keep historical detail in bounded reports or archive references and MUST NOT paste the full event journal, transcripts, or roadmap history into each new episode. |

## 16. Threat model and security posture

The service assumes the worker and checker may be mistaken or prompt-injected,
the worktree is agent-writable, external services may time out after applying an
effect, and runner protocols may evolve. It relies on host permissions for the
protected state root and does not claim resistance to a fully compromised host
or malicious human authority.

Threats addressed structurally include forged approval, replayed approval,
scope widening, model-fabricated acceptance, worktree state tampering,
repository time-of-check/time-of-use divergence, duplicate effects after crash,
runner event spoofing, checker self-approval, secret retention, unbounded event
or context growth, controller self-modification, and Trellis product outage.

| ID | Requirement |
|---|---|
| `EL-REQ-SEC-001` | Host permissions and startup validation MUST prevent the agent worktree and runner identity from writing protected state, approvals, locks, or retained evidence. |
| `EL-REQ-SEC-002` | Worker and checker processes MUST receive least-privilege filesystem, credential, network, and external-effect capabilities for their role, with the checker read-only. |
| `EL-REQ-SEC-003` | Model and checker content MUST be treated as untrusted data at every controller boundary and MUST pass size, schema, enum, and identifier validation before persistence. |
| `EL-REQ-SEC-004` | Credentials MUST be supplied by protected indirection, scoped to the exact adapter or effect, redacted, and omitted entirely from roles that do not need them. |
| `EL-REQ-SEC-005` | Controller, policy, schema, prompt, verifier, gate, or renderer self-modification MUST run as an explicit feature under the previously accepted controller and MUST require protected review before activation. |
| `EL-REQ-SEC-006` | Controller startup, state recovery, repository observation, fake-runner acceptance, and deterministic verification MUST remain operable when Trellis product services are unavailable. |
| `EL-REQ-SEC-007` | Every external input and retained artifact MUST have explicit type and size bounds, and an over-bound value MUST be refused with bounded diagnostics rather than truncated into trusted state. |

## 17. Conformance profiles

The catalog recognizes four planned test classes:

- `static`: schema, unit, type, byte, and deterministic policy checks that need
  no external service;
- `integration`: multi-component, Git-fixture, crash/restart, adapter-fixture,
  or protected-gate tests in isolated environments;
- `review`: owner or human inspection of architecture, semantic scope, diff, or
  migration decision; and
- `measurement`: repeated empirical evaluation with raw counts and a pre-stated
  criterion.

Conformance is incremental. The matrix identifies the feature that implements
or ratifies each mandatory requirement and the exact existing catalog
acceptance item whose planned class covers it. A row is a plan, not a claim that
the current repository implements that requirement. Non-mandatory guidance does
not enter the matrix.

## 18. Conformance matrix

| Requirement | Owning feature | Catalog acceptance | Planned class |
|---|---|---|---|
| `EL-REQ-CORE-001` | `EL-01` | `EL-01-A1` | review |
| `EL-REQ-CORE-002` | `EL-01` | `EL-01-A1` | review |
| `EL-REQ-CORE-003` | `EL-02` | `EL-02-A3` | static |
| `EL-REQ-CORE-004` | `EL-02` | `EL-02-A3` | static |
| `EL-REQ-CORE-005` | `EL-01` | `EL-01-A1` | review |
| `EL-REQ-CORE-006` | `EL-02` | `EL-02-A1` | static |
| `EL-REQ-CORE-007` | `EL-01` | `EL-01-A1` | review |
| `EL-REQ-DATA-001` | `EL-02` | `EL-02-A1` | static |
| `EL-REQ-DATA-002` | `EL-02` | `EL-02-A1` | static |
| `EL-REQ-DATA-003` | `EL-06` | `EL-06-A2` | integration |
| `EL-REQ-DATA-004` | `EL-02` | `EL-02-A1` | static |
| `EL-REQ-DATA-005` | `EL-06` | `EL-06-A1` | static |
| `EL-REQ-DATA-006` | `EL-03` | `EL-03-A2` | static |
| `EL-REQ-STATE-001` | `EL-02` | `EL-02-A1` | static |
| `EL-REQ-STATE-002` | `EL-02` | `EL-02-A1` | static |
| `EL-REQ-STATE-003` | `EL-02` | `EL-02-A1` | static |
| `EL-REQ-STATE-004` | `EL-02` | `EL-02-A1` | static |
| `EL-REQ-STATE-005` | `EL-06` | `EL-06-A1` | static |
| `EL-REQ-STATE-006` | `EL-02` | `EL-02-A1` | static |
| `EL-REQ-STATE-007` | `EL-06` | `EL-06-A2` | integration |
| `EL-REQ-STATE-008` | `EL-02` | `EL-02-A1` | static |
| `EL-REQ-STATE-009` | `EL-02` | `EL-02-A2` | integration |
| `EL-REQ-STATE-010` | `EL-06` | `EL-06-A1` | static |
| `EL-REQ-STORE-001` | `EL-02` | `EL-02-A3` | static |
| `EL-REQ-STORE-002` | `EL-02` | `EL-02-A3` | static |
| `EL-REQ-STORE-003` | `EL-02` | `EL-02-A2` | integration |
| `EL-REQ-STORE-004` | `EL-02` | `EL-02-A2` | integration |
| `EL-REQ-STORE-005` | `EL-02` | `EL-02-A2` | integration |
| `EL-REQ-STORE-006` | `EL-02` | `EL-02-A2` | integration |
| `EL-REQ-STORE-007` | `EL-02` | `EL-02-A2` | integration |
| `EL-REQ-STORE-008` | `EL-02` | `EL-02-A2` | integration |
| `EL-REQ-REPO-001` | `EL-03` | `EL-03-A1` | static |
| `EL-REQ-REPO-002` | `EL-03` | `EL-03-A1` | static |
| `EL-REQ-REPO-003` | `EL-03` | `EL-03-A3` | integration |
| `EL-REQ-REPO-004` | `EL-03` | `EL-03-A1` | static |
| `EL-REQ-REPO-005` | `EL-03` | `EL-03-A1` | static |
| `EL-REQ-REPO-006` | `EL-03` | `EL-03-A3` | integration |
| `EL-REQ-PROMPT-001` | `EL-04` | `EL-04-A1` | review |
| `EL-REQ-PROMPT-002` | `EL-04` | `EL-04-A1` | review |
| `EL-REQ-PROMPT-003` | `EL-04` | `EL-04-A2` | static |
| `EL-REQ-PROMPT-004` | `EL-04` | `EL-04-A2` | static |
| `EL-REQ-PROMPT-005` | `EL-04` | `EL-04-A3` | static |
| `EL-REQ-PROMPT-006` | `EL-04` | `EL-04-A4` | static |
| `EL-REQ-PROMPT-007` | `EL-04` | `EL-04-A2` | static |
| `EL-REQ-RUNNER-001` | `EL-05` | `EL-05-A1` | integration |
| `EL-REQ-RUNNER-002` | `EL-05` | `EL-05-A1` | integration |
| `EL-REQ-RUNNER-003` | `EL-05` | `EL-05-A1` | integration |
| `EL-REQ-RUNNER-004` | `EL-02` | `EL-02-A4` | static |
| `EL-REQ-RUNNER-005` | `EL-05` | `EL-05-A3` | static |
| `EL-REQ-RUNNER-006` | `EL-05` | `EL-05-A1` | integration |
| `EL-REQ-RUNNER-007` | `EL-05` | `EL-05-A1` | integration |
| `EL-REQ-RUNNER-008` | `EL-05` | `EL-05-A1` | integration |
| `EL-REQ-EPISODE-001` | `EL-05` | `EL-05-A2` | static |
| `EL-REQ-EPISODE-002` | `EL-05` | `EL-05-A2` | static |
| `EL-REQ-EPISODE-003` | `EL-05` | `EL-05-A2` | static |
| `EL-REQ-EPISODE-004` | `EL-06` | `EL-06-A4` | integration |
| `EL-REQ-EPISODE-005` | `EL-05` | `EL-05-A2` | static |
| `EL-REQ-EPISODE-006` | `EL-05` | `EL-05-A2` | static |
| `EL-REQ-EPISODE-007` | `EL-05` | `EL-05-A1` | integration |
| `EL-REQ-EPISODE-008` | `EL-05` | `EL-05-A1` | integration |
| `EL-REQ-VERIFY-001` | `EL-06` | `EL-06-A1` | static |
| `EL-REQ-VERIFY-002` | `EL-06` | `EL-06-A1` | static |
| `EL-REQ-VERIFY-003` | `EL-06` | `EL-06-A1` | static |
| `EL-REQ-VERIFY-004` | `EL-06` | `EL-06-A1` | static |
| `EL-REQ-VERIFY-005` | `EL-06` | `EL-06-A1` | static |
| `EL-REQ-VERIFY-006` | `EL-06` | `EL-06-A4` | integration |
| `EL-REQ-VERIFY-007` | `EL-06` | `EL-06-A1` | static |
| `EL-REQ-APPROVAL-001` | `EL-06` | `EL-06-A2` | integration |
| `EL-REQ-APPROVAL-002` | `EL-06` | `EL-06-A1` | static |
| `EL-REQ-APPROVAL-003` | `EL-06` | `EL-06-A2` | integration |
| `EL-REQ-APPROVAL-004` | `EL-06` | `EL-06-A2` | integration |
| `EL-REQ-APPROVAL-005` | `EL-06` | `EL-06-A2` | integration |
| `EL-REQ-APPROVAL-006` | `EL-06` | `EL-06-A2` | integration |
| `EL-REQ-APPROVAL-007` | `EL-06` | `EL-06-A2` | integration |
| `EL-REQ-APPROVAL-008` | `EL-06` | `EL-06-A1` | static |
| `EL-REQ-APPROVAL-009` | `EL-06` | `EL-06-A2` | integration |
| `EL-REQ-RECOVERY-001` | `EL-06` | `EL-06-A3` | static |
| `EL-REQ-RECOVERY-002` | `EL-06` | `EL-06-A3` | static |
| `EL-REQ-RECOVERY-003` | `EL-06` | `EL-06-A3` | static |
| `EL-REQ-RECOVERY-004` | `EL-02` | `EL-02-A2` | integration |
| `EL-REQ-RECOVERY-005` | `EL-02` | `EL-02-A2` | integration |
| `EL-REQ-RECOVERY-006` | `EL-02` | `EL-02-A2` | integration |
| `EL-REQ-RECOVERY-007` | `EL-06` | `EL-06-A4` | integration |
| `EL-REQ-RECOVERY-008` | `EL-02` | `EL-02-A2` | integration |
| `EL-REQ-RECOVERY-009` | `EL-06` | `EL-06-A3` | static |
| `EL-REQ-RECOVERY-010` | `EL-06` | `EL-06-A1` | static |
| `EL-REQ-OBS-001` | `EL-05` | `EL-05-A1` | integration |
| `EL-REQ-OBS-002` | `EL-06` | `EL-06-A1` | static |
| `EL-REQ-OBS-003` | `EL-07` | `EL-07-A1` | measurement |
| `EL-REQ-OBS-004` | `EL-06` | `EL-06-A1` | static |
| `EL-REQ-OBS-005` | `EL-03` | `EL-03-A2` | static |
| `EL-REQ-OBS-006` | `EL-06` | `EL-06-A1` | static |
| `EL-REQ-OBS-007` | `EL-06` | `EL-06-A1` | static |
| `EL-REQ-OBS-008` | `EL-07` | `EL-07-A1` | measurement |
| `EL-REQ-VIEW-001` | `EL-03` | `EL-03-A2` | static |
| `EL-REQ-VIEW-002` | `EL-03` | `EL-03-A4` | review |
| `EL-REQ-VIEW-003` | `EL-03` | `EL-03-A4` | review |
| `EL-REQ-VIEW-004` | `EL-07` | `EL-07-A4` | review |
| `EL-REQ-VIEW-005` | `EL-03` | `EL-03-A2` | static |
| `EL-REQ-SEC-001` | `EL-02` | `EL-02-A3` | static |
| `EL-REQ-SEC-002` | `EL-06` | `EL-06-A4` | integration |
| `EL-REQ-SEC-003` | `EL-06` | `EL-06-A1` | static |
| `EL-REQ-SEC-004` | `EL-06` | `EL-06-A1` | static |
| `EL-REQ-SEC-005` | `EL-06` | `EL-06-A2` | integration |
| `EL-REQ-SEC-006` | `EL-01` | `EL-01-A1` | review |
| `EL-REQ-SEC-007` | `EL-02` | `EL-02-A1` | static |

## 19. Deferred implementation choices

The architecture record §12 assigns concrete lower-priority decisions to their
owning features. In particular, EL-02 owns exact storage schema and crash
boundaries; EL-04 owns prompt bytes and budgets; EL-05 owns the pinned Codex
wire adapter; EL-06 owns retry/backoff, approval-expiry, redaction, and retention
defaults; EL-07 owns the measured migration verdict; EL-08 alone owns tracker,
scheduler, concurrency, standalone extraction, and workflow-engine adoption;
and EL-09 owns any sanitized Trellis ingestion of completed reports.

None of those choices may weaken same-repository policy, out-of-process
execution, protected external mutable state, single-writer authority, evidence
precedence, protected human gates, or manual-handoff authority without a new
owner-ratified architecture change.
