# Trellis Engineering Loop Research Record

Status: **research complete; design hypothesis carried into EL-01**

Date: July 14, 2026

This record preserves the evidence and reasoning that produced the
engineering-loop roadmap. It is a research input, not the normative
specification. `docs/architecture/ENGINEERING_LOOP.md` will own the Trellis
design decision; `tools/engineering-loop/SPEC.md` will own conformance.

## 1. Research question

How should Trellis replace the manual practice of pasting and rewriting
`HANDOFF.md` with a long-running engineering harness that can make incremental
progress across context windows without surrendering human control, weakening
paid-work gates, or coupling repository repair to the Trellis product runtime?

The research compared conversation continuation, compaction, fresh-context
episodes, file-based progress, tracker-driven orchestration, durable workflow
engines, agent-computer interfaces, independent evaluation, and hierarchical
memory. It also traced Trellis's existing RLM loop, product goal loop, session
protocol, and repository conventions.

## 2. Local evidence

### 2.1 Trellis already had a manual outer loop

[`HANDOFF.md`](../../../HANDOFF.md) §0 defines execute, record, regenerate,
ship, and late-event re-selection. The root
[`README.md`](../../../README.md) and
[`WORKSPACE_AND_MODULES.md`](../../architecture/WORKSPACE_AND_MODULES.md)
describe that cycle as the manual prototype of the capability flywheel.

The engineering problem was therefore not the absence of a loop. It was that
workflow state, architectural memory, current objective, test evidence,
historical ledger, and next-session prompt were combined in one manually
rewritten document.

At the research checkpoint, `HANDOFF.md` was approximately 2,550 lines and
158,000 normalized characters, roughly 40,000 tokens by a characters/4
heuristic. Git history showed 139 commits touching it over approximately eight
days. Its earliest measured version was about 12,300 characters; the current
form was about 12.8 times larger. Earlier and later passages could describe
the same work with different statuses, demonstrating that chronological prose
was not a safe current-state database.

The prompt pasted into the initiating Codex task matched repository
`HANDOFF.md` apart from its final newline. Root `AGENTS.md` was already small
enough for automatic Codex discovery and already instructed a new session to
read `HANDOFF.md`. Manual pasting added no repository fact.

### 2.2 Existing Trellis loops solve different problems

The RLM harness runs one bounded research task in a persistent Python REPL.
The product goal loop in
[`src/core/agent/goal_loop.ts`](../../../src/core/agent/goal_loop.ts) uses an
in-memory transcript and `dispatch`/`finish`/`fail` decisions to coordinate RLM
jobs. It does not model branch state, diffs, acceptance evidence, human review,
paid approval, pushes, merges, or durable interrupted-session recovery.

Reusing that loop would couple the engineering control plane to the product it
must be able to diagnose while broken. Its useful patterns—Zod boundaries,
bounded execution, structured decisions, and deterministic oracle tests—can be
reused without reusing its runtime or state model.

## 3. Primary-source findings

### 3.1 Repository legibility and progressive disclosure

OpenAI reports that a single large agent-instruction file accumulated stale
guidance and consumed scarce context. Its replacement used a small repository
map, structured documentation, first-class execution plans, repository tools,
mechanical architecture checks, and documentation gardening. Agents gathered
context from the environment rather than requiring humans to paste it.

Source: [Harness engineering: leveraging Codex in an agent-first
world](https://openai.com/index/harness-engineering/).

Implication for Trellis: keep `AGENTS.md` as the bootloader, progressively
disclose current feature artifacts, and compile prompts from observed state.

### 3.2 Tracker-driven orchestration

OpenAI's Symphony separates work from interactive sessions by treating issue
states as an orchestration control plane. Its repository-owned `WORKFLOW.md`
defines runtime behavior; each issue receives an isolated workspace; the
orchestrator owns dispatch, retries, reconciliation, and observability; a
successful automated run may terminate at human review rather than `Done`.

Sources:

- [Open-source Codex orchestration:
  Symphony](https://openai.com/index/open-source-codex-orchestration-symphony/)
- [Symphony service specification](https://github.com/openai/symphony/blob/main/SPEC.md)

Implication for Trellis: adopt repository-owned workflow policy, deterministic
workspaces, bounded retries, and human handoff states. Defer issue polling,
daemon scheduling, concurrency, and tracker dependence until a single-repo
controller is measured.

### 3.3 Incremental progress across fresh contexts

Anthropic found that compaction alone did not prevent long-running coding
agents from attempting too much work, leaving incomplete state, or declaring
completion prematurely. Its successful harness used an initializer, a
structured JSON feature list, one feature per session, Git history, progress
artifacts, startup checks, and a clean end state.

Source: [Effective harnesses for long-running
agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents).

Later Anthropic work found that clean context resets can be necessary even
when compaction exists, and that a separately prompted skeptical evaluator is
easier to tune than a generator evaluating its own output.

Source: [Harness design for long-running application
development](https://www.anthropic.com/engineering/harness-design-long-running-apps).

Implication for Trellis: resume a thread within one feature episode; create a
fresh thread at semantic boundaries; carry state through typed artifacts and
environmental evidence; use a fresh read-only checker.

### 3.4 Context is a budgeted working set

Anthropic frames context engineering as selecting the smallest set of
high-signal tokens that supports the next decision. Compaction, structured
notes, retrieval, and just-in-time environment exploration are complementary,
not interchangeable.

Source: [Effective context engineering for AI
agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).

The MemGPT research supplies the useful systems analogy: working context is a
limited fast tier, while larger durable memory is paged in only when relevant.

Source: [MemGPT: Towards LLMs as Operating
Systems](https://arxiv.org/abs/2310.08560).

Implication for Trellis: separate invariant policy, current control state,
active plan, verified evidence, episode history, and archive. Inject only the
working set; keep history addressable.

### 3.5 Agent-computer interface design

SWE-agent demonstrates that the tool and interaction interface materially
changes coding-agent performance. A good agent-computer interface makes
repository navigation, editing, and feedback legible rather than relying on a
stronger exhortation in the prompt.

Sources:

- [SWE-agent ACI background](https://github.com/SWE-agent/SWE-agent/blob/main/docs/background/aci.md)
- [SWE-agent paper](https://arxiv.org/abs/2405.15793)

Implication for Trellis: code computes Git state, scope, command results,
approval state, and allowed transitions. The model receives those facts through
a narrow interface and never self-certifies them.

### 3.6 Durable execution and human interrupts

Durable workflow systems converge on persisted state, checkpoints, explicit
human interrupts, idempotent side effects, bounded retry, and operator-visible
history:

- [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence)
  and [interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)
  checkpoint graph state and suspend for human input. Resumed nodes can rerun
  from their beginning, so pre-interrupt effects must be idempotent.
- [Temporal](https://docs.temporal.io/) reconstructs durable workflows through
  deterministic replay.
- [DBOS workflow recovery](https://docs.dbos.dev/production/workflow-recovery)
  checkpoints completed steps and recovers interrupted workflows.
- [Restate](https://docs.restate.dev/) combines durable execution, state,
  signals, and reliable communication.
- [Inngest durable agents](https://www.inngest.com/docs/learn/durable-agents)
  treats model calls, tools, waits, and delegated work as checkpointed steps.

Implication for Trellis: implement semantic checkpoints and explicit protected
wait states, but do not introduce a general durable-workflow dependency for the
initial single-writer, single-repository case. Reconsider after measurement
shows a need for concurrent writers, multiple machines, or distributed
recovery.

### 3.7 Evaluation must cover outcome and trajectory

Anthropic recommends combining deterministic outcome graders, model graders,
human review, transcript inspection, isolated environments, and repeated
trials. Agent behavior is stochastic; one successful run does not establish
reliability, and an incorrect grader can reject valid work.

Source: [Demystifying evals for AI
agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).

Implication for Trellis: deterministic transition/gate/recovery fixtures come
first. Paid model trials are repeated, budgeted, transcript-reviewed, and
compared with the manual baseline before handoff migration.

### 3.8 Codex execution surfaces

Codex supports persisted thread/turn lifecycle and resumption. Symphony uses
the app-server as its coding-agent process boundary. The TypeScript SDK is a
simpler wrapper, while the app-server exposes the lower-level lifecycle needed
for approvals, interruption, event capture, and continued turns.

Sources:

- [Codex app-server](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- [Codex TypeScript SDK](https://github.com/openai/codex/blob/main/sdk/typescript/README.md)

Implication for Trellis: define an implementation-independent `AgentRunner`;
retain a fake runner as the deterministic conformance oracle; implement the
Codex app-server adapter only after the control kernel and prompt contract.

## 4. Alternatives considered

| Alternative | Useful property | Rejection or retained role |
|---|---|---|
| Indefinitely resumed Codex thread | Minimal controller work | Retained only inside one episode; compaction is not durable workflow truth |
| Shell/Ralph loop | Extremely small prototype | Rejected as production shape because gates, evidence, recovery, and idempotency are weak |
| File-only episodic harness | Proven incremental progress | Foundation adopted, strengthened with protected state and typed transitions |
| Existing Trellis goal loop | Existing bounds and Zod decisions | Rejected because it is product runtime with the wrong state and trust model |
| Symphony-style tracker daemon | Strong work/session decoupling | Deferred as `EL-08`; first implementation has no tracker or scheduler |
| LangGraph or durable workflow engine | Mature checkpoints and human waits | Deferred until scale justifies dependency and replay complexity |
| Separate external repository immediately | Strong isolation and reuse | Rejected initially; workflow policy would drift from Trellis. Extraction remains an `EL-08` decision |
| Same repo, separate process | Versioned policy plus runtime isolation | Selected |

## 5. Prompt and meta-prompt protocols

The owner supplied `Prompt-Engineering.md` and `Hypershot-Protocol.md` as
binding authoring protocols for later prompts and meta-prompts. The relevant
requirements carried into `EL-04` are:

- semantic tagging and explicit hierarchy;
- structured placeholders and typed collections;
- explicit attention and precedence zones;
- positive instructions and iterative refinement;
- a content-free hypershot frame before the generation it shapes;
- invariant system-layer structure separated from variant downstream task
  data;
- no full concrete input/output example in a reusable system template.

No production prompt is authored in `EL-00` or `EL-01`.

## 6. Hypothesis and selected design

Hypothesis:

> A repository-owned episodic controller with protected external state,
> deterministic prompt compilation, one feature per context, and independent
> verification will reduce orientation context and stale-state errors without
> weakening owner control or increasing escaped defects.

Selected placement:

- source, spec, workflow policy, prompts, and feature definitions in Trellis;
- controller execution out of process;
- trusted mutable state outside the agent-writable worktree;
- no dependency on Trellis product services;
- optional sanitized Trellis ingestion only after a completed run and a later
  owner-approved design.

Selected continuity model:

- resume within one bounded episode;
- fresh thread across a semantic phase or context-budget boundary;
- reconstruct the next working set from typed state, Git observations,
  acceptance criteria, verified evidence, and bounded prior report;
- never treat conversation history or a model summary as authoritative state.

Selected authority model:

- human owns objectives, architecture, acceptance changes, paid/destructive
  authorization, push, and merge;
- controller owns transitions, observation, evidence capture, retry policy,
  and prompt assembly;
- worker proposes and edits within scope;
- checker is fresh and read-only;
- code-observed evidence outranks every model claim.

## 7. Pre-stated evaluation

The `EL-07` pilot must measure at least:

- cold-start prompt size and orientation time;
- stale or contradictory current-state facts;
- human steering interventions;
- deterministic acceptance reliability;
- protected-gate bypass attempts;
- duplicate side effects after injected crashes;
- token and monetary cost per accepted feature;
- time from feature selection to human review;
- failure attribution across agent, grader, environment, and harness.

Initial targets are at least an 80% cold-start-context reduction, zero protected
gate bypasses, zero fabricated acceptance transitions, zero duplicate paid or
external side effects after recovery, and no acceptance-reliability regression.
The targets are hypotheses to test, not shipped capability claims.

## 8. Remaining questions and owning features

- Exact state/event schemas and crash boundaries: `EL-01` specifies, `EL-02`
  implements.
- Exact prompt templates and budgets: `EL-04`.
- Exact pinned Codex app-server version and protocol adapter: `EL-05`.
- Retry classifications and approval expiry details: `EL-06`.
- Migration threshold and manual/generated handoff parity: `EL-07`.
- Tracker, scheduler, concurrency, multi-machine durability, or standalone
  extraction: `EL-08` only after measured need.
- Sanitized report ingestion and provenance policy: `EL-09`.
