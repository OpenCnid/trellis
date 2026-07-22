# Engineering Loop — Architecture Record

Status: **RATIFIED for EL-01**

Date: July 14, 2026

Program: `trellis-engineering-loop`

Normative companion: [`tools/engineering-loop/SPEC.md`](../../tools/engineering-loop/SPEC.md)

Program roadmap: [`docs/product/engineering-loop/ROADMAP.md`](../product/engineering-loop/ROADMAP.md)

Research record: [`docs/product/engineering-loop/RESEARCH.md`](../product/engineering-loop/RESEARCH.md)

**Dated amendment — July 21, 2026:** the collaborator retired the manual
`HANDOFF.md` and root roadmap as active session authorities without adopting a
generated handoff. This record remains the preserved architecture of the
controller program; it is not current repository routing and authorizes no new
program work. See [`REPOSITORY_ROOT_CONTRACT.md`](REPOSITORY_ROOT_CONTRACT.md).

This record explains the Trellis-specific boundary and trust decision for the
engineering-session loop. The companion specification defines conformance.
This feature authors both records and no controller runtime.

## 1. Problem

At ratification, Trellis had a manual outer engineering loop. `HANDOFF.md` §0 directed a
session to execute one objective, record evidence, regenerate the next handoff,
and re-select work when late findings change priority. That protocol works, but
its current representation combines several different kinds of information in
one manually rewritten document:

- invariant repository policy;
- current workflow state and objective;
- architectural memory;
- command and review evidence;
- historical session narrative; and
- the prompt for the next context window.

As the document grows, old and current status can coexist, orientation consumes
more of each context window, and model-authored summaries can drift from Git or
command truth. Conversation continuation and compaction reduce token pressure
but do not turn prose history into durable workflow state.

The engineering loop is distinct from both existing Trellis loops:

- The RLM loop runs one bounded research task in a persistent Python REPL over
  the provenance substrate. It is an execution environment for research, not a
  repository control plane.
- The product goal loop in `src/core/agent/goal_loop.ts` keeps an in-memory
  `GoalIterationRecord[]`, asks a decision source for `dispatch`, `finish`, or
  `fail`, and runs task batches through `Promise.all`. Its decision schema and
  prompt deliberately know nothing about branches, diffs, acceptance commands,
  human approvals, pushes, merges, durable restart, or protected controller
  state. It is a pure product planner and has no tools or database access.

Putting engineering control into either loop would make repair depend on the
product runtime being healthy and would give the wrong state model authority
over repository-changing work.

## 2. Decision

Trellis adopts a repository-owned, episodic engineering controller with the
following placement:

1. Stable source, schemas, workflow policy, prompt sources, feature definitions,
   and conformance tests live in this repository.
2. The controller executes as a separate operating-system process under
   `tools/engineering-loop/`. It is not imported into `src/`, the API, workers,
   BullMQ, Redis, PostgreSQL, Neo4j, the RLM, or `src/core/agent/`.
3. Trusted mutable state, the event journal, approvals, budgets, leases, runner
   records, and retained evidence live in a protected location outside every
   agent-writable worktree.
4. One controller owns all mutable state writes in the initial implementation.
   Agents, runner adapters, checkers, renderers, and repository worktrees are
   not state writers.
5. A coding-agent thread may continue within one bounded episode. A semantic
   phase change or context-budget boundary starts a fresh thread compiled from
   typed state and observed evidence.
6. Model output is an observation. Controller-observed repository state,
   controller-executed commands, validated approval records, and human review
   decide transitions.
7. Paid calls, destructive actions, pushes, merges, acceptance changes, and
   harness self-modification remain explicit protected actions.
8. The manual `HANDOFF.md` remains authoritative until the repeated EL-07 pilot
   supports migration and the owner records an adopt verdict.

TypeScript is the intended first implementation language because the repository
already uses TypeScript and Zod at control boundaries. The protocol remains
language-independent so its state and conformance semantics do not depend on a
particular runtime or Codex transport schema.

## 3. Process and dependency boundary

The controller is deliberately above and beside Trellis, not inside it:

```text
repository policy + feature catalog
                |
                v
out-of-process controller <---- protected external state + human approvals
        |               |
        v               v
 AgentRunner         deterministic verifier
        |               |
        v               v
bounded worktree     observed Git/command evidence
```

The controller may run ordinary developer commands against the repository, but
its correctness cannot require Trellis queues, databases, APIs, workers, or the
RLM to be available. This independence is what lets the controller diagnose a
broken Trellis stack. Product services may be subjects of tests; they are never
the controller's state store or scheduling substrate.

The first implementation has no tracker polling, daemon scheduler, concurrent
agents, concurrent state writers, automatic push, or automatic merge. Those are
later decisions, not latent capabilities hidden behind configuration.

## 4. Authorities and trust boundaries

| Actor or surface | Authority | Explicit non-authority |
|---|---|---|
| Human owner/reviewer | Objectives, architecture ratification, acceptance changes, paid/destructive authorization, push, merge, and handoff migration | Does not need to hand-author observed Git or command facts |
| Controller | Sole mutable-state writer; validates transitions; observes repository state; executes verification; compiles bounded context; records evidence | Cannot invent approval, expand its scope, or merge without the protected human action |
| `AgentRunner` adapter | Starts, resumes, interrupts, and observes bounded agent episodes | Cannot write controller state or authorize any transition |
| Worker agent | Plans and edits only within the assigned feature and path scope; reports proposed results | Cannot certify commands, approvals, acceptance, push, merge, or its own semantic correctness |
| Independent checker | Fresh, read-only assessment over the diff, spec, and evidence | Advisory only; cannot edit, approve, or advance protected state |
| Repository/worktree | Versioned source and policy; worktree is the proposed-change surface | Agent-writable files are not trusted mutable workflow state or approval truth |
| External systems | Git remote, Codex, package registries, paid services, trackers, and other effect targets | Responses are observations until reconciled; unknown effect outcomes never imply success |
| Trellis product runtime | Subject of engineering and acceptance tests | Not a controller dependency and not an authority over the engineering loop |

The most important separation is between source and state. Repository source is
reviewable policy. Mutable run truth is protected external state. An agent that
can edit the policy under a named, reviewed feature still cannot retroactively
rewrite the approvals, events, evidence, or state that judge that edit.

## 5. Context model and progressive disclosure

The controller compiles a working set from six tiers:

| Tier | Contents | Use |
|---|---|---|
| Invariant policy | `AGENTS.md`, ratified architecture, normative spec, permanent repository rules | Small bootloader and non-negotiable constraints |
| Current typed state | Workflow, feature, session, state, approvals, budgets, branch/base/head, scope | Authoritative facts for the next transition |
| Active plan | The current role, bounded objective, permitted actions, definition of done | Episode-local work packet |
| Verified evidence | Controller-observed Git facts, command records, diff metadata, approval references | Transition inputs and acceptance proof |
| Episode history | Bounded reports and runner event references from the current feature | Local continuity and recovery |
| Archive | Prior features, full transcripts, historical ledgers, and large artifacts by address | Pulled only when the active task needs them |

The model receives the smallest high-signal subset needed for its role. Archive
material remains addressable but is not pasted into every context. Conversation
history and model summaries may aid orientation, but they never replace typed
state or observed evidence.

Continuation is intentionally local. Implementation turns that still serve the
same feature, role, semantic phase, and context budget may resume one thread.
Planning-to-implementation, implementation-to-independent-checking, recovery
analysis, a changed objective, or exhausted context starts a fresh thread. A
fresh thread receives a deterministic packet, not a paraphrased conversation.

## 6. Evidence and transition posture

The controller follows the Trellis enforcement doctrine: tooling shape enforces
behavior; prompt text explains it. Git state, changed paths, command exit status,
approval validity, retry eligibility, and allowed transitions are computed in
code. A worker's sentence that tests passed or permission exists carries no
transition authority.

Evidence is recorded by reference with digests and bounded metadata. Large
stdout, transcripts, and diffs may be retained as protected artifacts while the
event journal points to them. Conflicting or missing deterministic evidence
stops the transition; it is not resolved by asking the worker to restate the
claim.

External effects use intent and outcome records. A retry is automatic only when
the controller can prove that no effect occurred or when the target operation is
idempotent under the same key. If the outcome is unknown, the session stops for
human reconciliation. Repeating an unknown paid, destructive, push, merge, or
tracker effect is forbidden.

## 7. Priority-zero decisions

All trust-boundary questions that could block implementation are resolved:

| ID | Question | Ratified answer |
|---|---|---|
| P0-1 | Where do policy and code live? | In the Trellis repository, under ordinary review |
| P0-2 | Where does the controller run? | In a separate process, independent of Trellis product services |
| P0-3 | Where does mutable truth live? | In protected external state outside the agent-writable worktree |
| P0-4 | Who writes state? | One controller initially; runner, worker, checker, and renderer never do |
| P0-5 | What outranks model claims? | Human authority plus controller-observed repository, command, and approval evidence |
| P0-6 | What is the continuity unit? | Resume within one episode; fresh context across semantic or budget boundaries |
| P0-7 | Which actions remain human gates? | Paid, destructive, push, merge, acceptance change, harness self-modification, and migration |
| P0-8 | When does `HANDOFF.md` become generated? | Only after EL-07 measurement and an explicit owner adopt verdict |
| P0-9 | Does the initial controller schedule or coordinate concurrent writers? | No; scheduler, tracker, and concurrency are deferred to EL-08 |
| P0-10 | Is a generic durable-workflow dependency required now? | No; a single-writer journal and atomic snapshots are measured first |

There is no unresolved priority-zero question in EL-01.

## 8. Alternatives considered

| Alternative | Retained value | Disposition |
|---|---|---|
| Indefinitely resumed Codex thread | Cheap continuity inside a bounded episode | Rejected as durable truth; compaction and summaries cannot authorize transitions or reconstruct effects |
| Shell or Ralph loop | Minimal experiment and useful command-driving pattern | Rejected as the control kernel; weak approvals, recovery, evidence, and idempotency |
| File-only episodic harness | One feature per fresh context, progress files, clean Git handoff | Adopted as a foundation, strengthened with protected state and typed transitions |
| Existing Trellis goal loop | Zod decisions, bounds, injected dependencies, deterministic oracle tests | Runtime reuse rejected; it has the wrong domain, durability, authority, and failure dependency. Patterns may be reimplemented in the new boundary |
| Symphony-style tracker daemon | Repository policy, isolated workspaces, work/session decoupling, reconciliation | Tracker polling, daemon scheduling, and concurrency deferred to EL-08; the service-spec discipline is adopted now |
| Generic durable workflow engine | Mature replay, signals, timers, and distributed recovery | Deferred until measured need justifies dependency and deterministic-replay complexity |
| Separate standalone repository immediately | Strong isolation and possible reuse | Rejected initially because policy would drift from Trellis; extraction criteria are defined in §11 |

## 9. Consequences

Positive consequences:

- Current state becomes typed and reconstructible instead of chronological
  prose.
- The agent works from bounded feature packets and fresh semantic contexts.
- Product outages do not disable the repair controller.
- Approval, retry, and acceptance behavior can be exhaustively tested without a
  model or paid call.
- The manual handoff can be compared with a deterministic generated view before
  authority moves.

Costs and constraints:

- The repository owns another protocol and its compatibility burden.
- Single-writer execution sacrifices concurrency during the pilot.
- External protected state needs installation, permissions, backup, redaction,
  and retention discipline.
- Adapters must translate unstable external protocols without leaking them into
  the core domain.
- Human review and protected effects remain deliberate stops; the design
  optimizes reliability and orientation, not unattended throughput.

## 10. Risks and mitigations

| Risk | Structural mitigation | Residual |
|---|---|---|
| Worker prompt injection or self-certification | Worker cannot write state; commands and transitions are controller-owned | A worker may still produce a poor diff; deterministic checks and human review remain necessary |
| Worktree edits forge state or approvals | State and approval records are outside the writable worktree | Host compromise is outside the application trust boundary and requires operating-system controls |
| Crash duplicates an external effect | Intent/outcome journal, idempotency keys, bounded retry, unknown-outcome stop | Some external systems cannot prove outcome; human reconciliation remains |
| Repository changes during an episode | Re-observe branch/head/status at transition boundaries and stop on divergence | A narrow observation-to-effect race remains and is handled by target preconditions |
| Checker agrees with worker or is contaminated by its context | Fresh read-only checker with a distinct packet | Model review is still advisory and may be wrong |
| Secrets leak into events or prompts | Redaction before persistence, protected artifacts, bounded telemetry | Operators must configure secret sources and retention correctly |
| Controller policy edits weaken its own gates | Named self-modification feature, protected approval, old controller judges the candidate, immutable prior events | A malicious host or reviewer can still subvert policy; that is human/host authority, not model authority |
| Single writer becomes a bottleneck | Measure first | Concurrency enters only through EL-08 with a new consistency design |

## 11. Extraction and dependency criteria

Moving the controller into a standalone project is an EL-08 decision. It becomes
reasonable only when at least one of these is measured:

- two or more repositories require the same controller and Trellis-specific
  policy can be isolated behind a versioned workflow package;
- Trellis release cadence blocks independent controller fixes or vice versa;
- a stable protocol and conformance suite can test repository adapters without
  copying Trellis policy;
- protected state location, upgrade, backup, and compatibility responsibilities
  have a named owner outside this repository; or
- reuse benefit exceeds the cost of cross-repository schema, prompt, and policy
  versioning.

A generic durable-workflow dependency is reconsidered only when measurement
shows that local single-writer durability is insufficient—for example,
multi-machine execution, concurrent writers, long-lived external signals,
distributed timers, or recovery requirements the append-only journal cannot
meet without rebuilding a workflow engine. Adoption requires a migration and
failure-semantics comparison, not feature-count preference.

## 12. Deferred choices and owners

| Choice | Owning feature |
|---|---|
| Exact schema fields, canonical serialization, event checksum, lock primitive, snapshot cadence, and crash points | EL-02 |
| Repository observer command set, evidence artifact layout, and generated-handoff byte layout | EL-03 |
| Production prompt text, role templates, exact context budgets, normalization, hashes, and schema pins | EL-04 |
| Pinned Codex app-server version, wire adapter, timeout constants, and interruption protocol | EL-05 |
| Exact retry limits/backoff, approval expiry defaults, reconciliation UI, redaction rules, and retention durations | EL-06 |
| Pilot trial count, final migration comparison, and adopt/revise/reject verdict | EL-07 |
| Tracker, scheduler, concurrency, multi-machine operation, standalone extraction, or workflow-engine adoption | EL-08 |
| Sanitization and verified ingestion of completed-run reports into Trellis | EL-09 |

These are lower-priority implementation choices. None changes the ratified trust
boundary in §2.

## 13. Relationship to Trellis doctrine

**Code-mediated text.** The controller computes repository state, paths, command
results, transition eligibility, and evidence addresses. Agents author new code
and prose but do not count locations, retype observed output as truth, or replace
code-observed facts with summaries. Edits continue to land through ordinary
source control and human diff review.

**Provenance.** Controller events and reports are engineering evidence, not
Trellis Tier-1 source or Tier-2 belief. They gain no substrate provenance by
existing. EL-09 may later define sanitized verified ingestion after a run is
complete; the live controller never depends on that ingestion.

**Paid-work doctrine.** Paid work is estimated, owner-approved, hard-capped per
run, and reported with actuals. The controller records and enforces the gate;
prompt wording cannot grant it.

**Prompt contracts and pins.** EL-01 writes no production prompt. EL-04 owns
prompt artifacts under the Prompt-Engineering and Hypershot protocols, strict
output schemas, context budgets, normalization, versions, and byte pins.
Existing RLM and orchestrator prompt bytes and pins are untouched.

**Generated handoff.** EL-03 may render a deterministic preview from typed state
and evidence. The preview is a view, not workflow truth. Only EL-07 measurement
plus owner ratification can make `HANDOFF.md` generated and change its authority.

## 14. Ratification and next implementation boundary

This record and the companion specification settle EL-01's architecture and
normative protocol. Implementation begins with EL-02 only after EL-01
acceptance. EL-02 may choose concrete schemas and storage mechanics within this
boundary; changing same-repository source, out-of-process execution, protected
external mutable state, single-writer authority, evidence precedence, protected
human gates, or manual-handoff authority requires a new owner-visible
architecture decision.
