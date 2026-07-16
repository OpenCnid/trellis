# Strong New Work on Old Foundations: The Novel-but-Precedented Mechanisms of Trellis

## Abstract

Trellis (OpenCnid) describes itself as a Recursive Language Model runtime: a language model operating a persistent Python REPL over a provenance-enforced knowledge substrate. A companion paper examines the handful of mechanisms in the repository that appear to be genuinely without precedent. This paper examines the larger and, in engineering terms, arguably more consequential middle stratum: mechanisms that are strong, original work but whose intellectual ancestry is identifiable — content-addressed storage, truth maintenance systems, program-aided language models, blackboard-era multi-agent control, CI/CD and durable-workflow engineering, and living documentation. For seven candidate mechanisms we verify the implementation in code, reconstruct the lineage, state the delta over precedent as precisely as the repository allows, and assess how well that delta is evidenced in-repo rather than merely asserted. The recurring pattern is not invention of new primitives but *transplantation under pressure*: Trellis repeatedly takes a mature idea from systems software — Merkle identity, dirty-bit invalidation, syscall-mediated accounting, single-writer journals — and re-derives it inside a trust model where the untrusted component is the language model itself. The transplants are usually accompanied by unusually strong in-repo evidence (exhaustive commutativity tests, adversarial poisoning drills with published raw numbers, byte-level prompt pins), which is itself part of the contribution. We close by forecasting which of these ideas the field will reinvent independently within a few years and which are unlikely to arise without this repository's particular obsessions.

---

## 1. Scope, method, and what "novel with precedent" means here

This paper deliberately excludes the mechanisms covered by its companion — the capability flywheel and module provenance, grounded authoring, the by-reference answer channel, the retrieval-membership write gate, and the acceptance ledger's human-pinning ceremonies. Where those systems border on our subjects we note the boundary and move on.

"Novel with precedent" is used in a specific sense: the mechanism would not be publishable as a new primitive, because a well-read reviewer can name its ancestor within a sentence; yet the *composition* — what the ancestor is applied to, what invariant it is made to carry, and what evidence discipline surrounds it — is new enough that a competent team told only the ancestor's name would probably not converge on this design.

Method: every load-bearing claim below was re-verified against the working tree at `/home/user/trellis` (July 2026 state). External lineage claims cite the published literature where a specific citation strengthens the argument.

---

## 2. The Merkle-AST content-addressed substrate

### Mechanism

Every ingested document — markdown, PDF-derived JSON, source code — is parsed into an AST whose node identity *is* its content hash. `createASTNode` in `src/core/ast/parser.ts` builds the preimage as `type[:content][:JSON(metadata)][:children-hash-concatenation]` and takes SHA-256 over it; a parent's identity therefore commits to its entire subtree, making the document root a Merkle root. The same file exports `rederiveAstNodeId`, which deliberately delegates back to `createASTNode` so that verification can never drift from construction ("persistence verification cannot drift from the current preimage behavior").

Two consequences are engineered rather than left implicit:

1. **Diff is set arithmetic.** `src/core/ast/diff.ts` computes version deltas as three set operations over node-id sets — `added`, `orphaned`, `retained` — with the comment noting "no tree alignment, no edit distance. A moved-but-unchanged block keeps its hash and lands in `retained`." The `retained` set is explicitly framed as "work avoided… the 'Merkle discount' the Update Drill reports": only `added` leaf blocks are eligible for paid LLM extraction and embedding.

2. **Ingest is a verified transaction.** `ingestDocument` in `src/core/ingestion/ingest_document.ts` runs, inside a single PostgreSQL transaction: persist all nodes → `verifyPersistedAstNodes` (read the immutable rows back and *re-derive every id through the parser* before anything can commit) → record version membership → register the version → run the Merkle diff against the prior version → plan extraction under a budget whose violation throws past the `ROLLBACK`. A corrupt row, a hash mismatch, or an over-budget plan leaves no version, no registry state, and no queue writes. Deletions are handled by an elegant degenerate case: `emptyDocumentRoot()` ingests the empty string through the same pinned hash authority as a tombstone version, making every prior node an orphan candidate through the ordinary machinery.

### Lineage

The ancestry is dense and undisguised. Git gave the world Merkle identity for trees of content; Nix and the content-addressed build systems (Bazel's action cache, Buck2, Shake's early cutoff) established that hashing inputs lets you skip recomputation exactly when bytes are unchanged; IPFS generalized content-addressed DAGs to a storage substrate; Dolt makes database diff a first-class Merkle operation; Unison content-addresses code itself. Closer to the present, content-addressed knowledge structures are appearing in the research literature — e.g., Astrolabe's content-addressable semantic hypergraph ([arXiv:2604.10435](https://arxiv.org/pdf/2604.10435)) — and provenance tracking is a recognized GraphRAG concern.

### The delta

Three things distinguish Trellis's use from all of these ancestors:

- **The unit of identity is the semantic block of a parsed document**, not a file, blob, or store object. Hashing at AST granularity is what makes the diff *meaningful to beliefs*: a paragraph's hash is the natural foreign key for "facts derived from this paragraph."
- **The diff output is wired to epistemics, not storage.** In git and Nix, the orphaned-object set is garbage-collection input. Here `diff.orphaned` is the input to belief quarantine (§3), and `diff.added` is the input to a *spend* planner — Merkle early-cutoff repurposed as an LLM cost-control instrument. The "Merkle discount" framing is, to our knowledge, original: incremental-build economics applied to extraction dollars.
- **Write-time self-verification.** Git verifies hashes on read (`fsck`); Trellis re-hashes read-back rows *inside the ingest transaction*, refusing to let unverified bytes become citable substrate. This is a trust-model choice — the database is not assumed faithful — that none of the storage ancestors make at write time.

### Evidence in-repo

Strong. The transaction ordering is unit-pinned (`ingest_document.test.ts`, `persist.test.ts`), the hash authority has pinned quirk tests (the "T13 empty-content and delimiter quirks… pinned by tests" comment in `parser.ts`), and the payoff is measured: the Update Drill (`update_drill_results.json`, `docs/benchmarks/UPDATE_DRILL_REPORT.md`) reports the retained/added/orphaned economics of a 5% corpus mutation with per-query token and cost figures. The delta is demonstrated, not narrated.

---

## 3. The contested/quarantine belief lifecycle

### Mechanism

Every semantic fact in Neo4j carries three provenance fields, specified in `src/core/graph/provenance.ts`: `sourceNodeIds` (live Merkle hashes justifying the fact), `orphanedSourceIds` (hashes whose bytes a re-ingest killed — "audit trail, kept forever — the append-only belief ledger"), and `contested` (excluded from effective resolution until re-derived from live bytes). Exactly two transitions may mutate this state: `applyQuarantineSweep` (a re-ingest's orphan set arrives) and `applyRederivation` (the fact is re-asserted from live bytes).

The file's most distinctive engineering commitment is order-independence: because BullMQ gives no ordering between the invalidation worker and the extraction worker, the two transitions "MUST commute for that re-ingest's inputs," and `provenance.test.ts` "proves the commutation exhaustively over a small hash universe." The Cypher sweep in `invalidation.ts` mirrors the pure state machine (dead hashes migrate to `orphanedSourceIds`; quarantine is skipped only when a surviving source is in the re-ingest's *fresh* set, meaning a racing re-extraction already recovered the fact). Nothing is ever deleted; recovery clears `contested` and can even *resurrect* a formerly orphaned hash when a document reverts to an earlier version and the old content hash lives again.

A second, orthogonal contest pathway lives in `src/core/graph/verification.ts`: sampled re-verification. Cached beliefs are tiered (`mandatory` for low-confidence or stale-rubric beliefs, `sampled` at rate p, `graduated` at p/10 after three agreements), re-classified from live text fetched *by Merkle hash* ("provenance is the input, not the graph's current belief"), and on disagreement pushed through the same quarantine path — `contested = true`, the fresh reading recorded as `disputedLabel` for audit, "no deletion, no in-place correction — … arbitration by re-derivation."

### Lineage

This is a truth maintenance system, and the repository's structure makes the family resemblance exact: Doyle's JTMS (1979) stored beliefs with justifications and toggled them in/out as justifications changed; de Kleer's ATMS (1986) tracked which assumption sets support which conclusions; AGM belief revision (1985) supplied the axiomatic account of minimal change. The broader mechanism — invalidate derived state when inputs change — is also the core of build systems, spreadsheet recalculation, and materialized-view maintenance. The problem is newly urgent in the agent-memory literature: STALE asks whether LLM agents can know when memories are invalid ([arXiv:2605.06527](https://arxiv.org/html/2605.06527v1)); a 2026 survey of evidence tracing in LLM agents explicitly recommends using "provenance to invalidate stale memory, quarantine contaminated evidence" ([arXiv:2606.04990](https://arxiv.org/html/2606.04990)); systems such as TOKI and Kumiho are building contradiction-resolution and AGM-compliant revision for agent memory.

### The delta

Four differences from classical TMS are substantive:

1. **Justifications are byte-hashes, not propositions.** A JTMS justification points at other beliefs; Trellis's points at immutable source bytes. This grounds the maintenance problem in something mechanically checkable — a hash either is or is not a member of some document's current version — where classical TMS grounding bottomed out in assumptions.
2. **Two invalidation triggers, one lifecycle.** Drift (bytes died) and original sin (an independent re-check disagreed *over unchanged bytes*) are distinct epistemic failures, and the second is invisible to any dependency-propagation scheme by construction — no input changed. Trellis handles both through one quarantine path. The poisoning drill (`poison_drill_results.json`) makes the point empirically: 11 labels flipped in place with valid Merkle provenance ("invisible to Phase 4 by construction"); the mandatory-only policy achieved detection recall 0.000 across five sweeps, while sampling at p = 0.05 reached recall 1.000 (full detection within a bounded 62-sweep expectation; p = 0.10 in 18), with a measured false-dispute rate of 0.
3. **Quarantine-never-delete with a permanent audit field.** `orphanedSourceIds` is an append-only history on the belief itself; a contested fact remains inspectable forever. Classical TMS "out" labels carried no forensic record; build systems simply discard stale artifacts.
4. **Concurrency as a proof obligation.** Making the two writers a commutative state machine because the queue gives no ordering — and pinning that commutativity with an exhaustive small-universe test — is distributed-systems discipline (CRDT-style thinking) applied to belief maintenance. None of the TMS lineage needed this because none of it ran on racing queue consumers.

### Evidence in-repo

Exceptionally strong — this is the best-evidenced mechanism in the repository. The state machine is a pure module with an exhaustive commutation test; the sweep mirrors it in Cypher with a documented WHERE-clause correspondence; and both failure modes have adversarial drills with published raw results (update drill: a 5% corpus mutation contested exactly the 11 affected cached facts, recall and precision 1.000; poison drill: the numbers above, including per-policy cost accounting). The honest reporting of the mandatory-only policy's total failure (recall 0.000) is characteristic of the repo's evidence culture.

---

## 4. The RLM execution model, systematized

### Mechanism

Trellis adopts the MIT CSAIL Recursive Language Model formulation wholesale and says so: the README defines RLM as "the MIT CSAIL formulation: a language model given a Python REPL that treats context as data in a persistent namespace and calls itself (`llm_query`) as a subroutine over slices," with the slogan "Context is a database, not a scroll." The formulation is Zhang, Kraska, and Khattab, "Recursive Language Models" ([arXiv:2512.24601](https://arxiv.org/abs/2512.24601), December 2025), which demonstrated the inference *strategy*: REPL-mediated decomposition beating compaction, CodeAct-with-subcalls, and long-context baselines on OOLONG and related benchmarks.

Trellis's claim is that it takes the formulation "seriously as a *system design* rather than a prompting technique." Concretely, verified in code:

- **A persistent substrate under the REPL** rather than a per-query prompt variable: the Merkle/graph stores of §2–§3 injected as tools (`trellis_tools.py`), so decomposition results can outlive the query that produced them.
- **Process and queue discipline:** one task per spawned process, dispatched via BullMQ (`src/workers/rlm_worker.ts`), with per-task iteration ceilings inherited from goal bounds (§6).
- **Typed result envelopes and machine-parseable telemetry:** `trellis_agent.py` emits a `TRELLIS_TELEMETRY` line (tokens, subcall counts, tool calls, workspace/textedit/answer-channel counters — "counts only, never content") and a `TRELLIS_RESULT` envelope for the orchestrator.
- **Protocol-violation detection:** a run that answers with zero database tool calls is stamped `TRELLIS_PROTOCOL_VIOLATION` and its envelope status set to `protocol_violation` — "the answer has no provenance and the runner should re-dispatch" (`trellis_agent.py`, lines 656–674). Answer quality is irrelevant; provenance discipline is the acceptance criterion.

### Lineage

The chain is short and public: PAL/Program-of-Thoughts (2022) offloaded computation to code; ReAct interleaved reasoning and acting; CodeAct (2024) made code the unified action space; MemGPT (2023) gave the model an OS-flavored memory hierarchy; the RLM paper composed these into recursive REPL decomposition. Trellis credits the formulation explicitly rather than claiming it.

### The delta

The delta is the runtime, and it is real but partially shared with the field's general direction. What the RLM paper leaves as a stateless per-query environment, Trellis makes an operated service: persistence (the flywheel economics — the README contrasts "the MIT-style stateless baseline pays ~$1.12 per query, forever; Trellis pays once"), bounded and typed failure, telemetry sufficient for cost accounting, and — most distinctively — *protocol enforcement as a first-class run outcome*. No prior program-aided-LM system we know of treats "answered without touching the substrate" as a structured failure status that a supervising loop reacts to. That specific move only makes sense in a system whose core commitment is provenance, which is why it did not appear in the inference-technique lineage.

### Evidence in-repo

Good but of mixed kinds. The systematization itself is directly verifiable in code and drills (`benchmark_results.json`, the OOLONG-based update/poison drills run *through* the RLM harness). The comparative claim against stateless baselines is measured in the flywheel benchmarks. The headline "giant effective context window" claim is, by the README's own admission, partially pending ("a measured paired-run probe of that claim is on the owner-gated queue") — a candor worth noting.

---

## 5. Mechanical workspace capture and cross-task lineage

### Mechanism

`src/rlm/trellis_workspace.py` implements Tier-3 working memory as a holder object injected into the REPL's persistent locals. Its defining property is *where capture happens*: "the MCP wrapper calls it from inside `call_tool`, so external results are deposited mechanically — capture is guaranteed at the harness layer, never dependent on model discipline… and its origin stamps are wrapper-owned: the model has no API to forge them." The model receives only a stub (server, tool, `argsHash`, segment id, byte count, 500-char preview); the full result is already stored, stamped with origin and fetch time, before the model sees anything.

Three supporting disciplines are enforced in the same file: segment ids are UUIDv4, "structurally disjoint from AST hashes (`^[0-9a-f]{64}$`) — nothing stored here ever… passes as `sourceNodeIds`" (a type system for trust standing built out of identifier syntax); budgets *raise* with usage details rather than silently truncating ("a torn stored entry would poison later readers"); and `seed_from_snapshot` validates inherited state field-by-field, including a bytes-stamp-vs-content integrity check that rejects torn segments before the run's first turn.

Lineage across tasks is by reference only. `src/workers/workspace_scratch.ts` parks end-of-run snapshots in Redis under goal-scoped TTL keys ("Redis is a parking lot for checkpoints, never a live store the model queries"); the orchestrator sees a counts-only `WorkspaceRef` (`{taskId, segments, bytes}` — "content never crosses into the decision context," `decision.ts`), and names prior task ids in `seedFromTasks`; the worker resolves, merges, and re-validates; Python re-validates again with its twin checks. Wrapper stamps survive inheritance: a seeded segment still records the task that originally fetched it.

### Lineage

Scratchpads and agent memory are crowded territory: MemGPT's paged memory, LangChain buffers, file-based memory in Claude Code/Manus-style harnesses, tool-result caching everywhere. The deeper precedent is from operating systems: capture inside the tool call is syscall-mediated accounting — the kernel records what the process did because the record is written in the trap path, not by the process's good behavior. Provenance-stamped data flow also echoes taint tracking and information-flow control.

### The delta

Every prior agent-memory system we can identify makes the *model* the librarian: it decides to save, decides what metadata to attach, and could fabricate both. Trellis moves the librarian into the trap path. Combined with disjoint id spaces (workspace content is *syntactically incapable* of being cited as provenance) and refuse-don't-truncate budgets, the workspace becomes untrusted-by-construction storage whose *metadata* is nonetheless trustworthy — a combination absent from the memory literature, which generally either trusts the whole memory or none of it. The by-reference lineage design (orchestrator routes references; content never transits the planner's context) is the same instinct applied to inheritance, and prefigures a capability the field mostly still implements by pasting summaries between agents.

### Evidence in-repo

Strong on mechanism, moderate on payoff. The unforgeability and torn-seed properties are unit-pinned (`test:rlm-workspace` covers byte-exact park/seed at the 4 MiB/32 MiB/1024-segment caps, cap+1 refusals, per-field torn-payload refusals); the lineage path has a zero-LLM drill and paired probes (`scripts/probe_workspace_*`). What is *not* strongly evidenced is that seeded lineage improves task outcomes — the probes measure integrity, not utility.

---

## 6. The tool-free bounded orchestrator and A2A inheritance

### Mechanism

`src/core/agent/goal_loop.ts` implements the supervising loop above the RLM. Its design commitments, all verified in code:

- The decision model can express exactly three actions — `dispatch`, `finish`, `fail` — via a Zod schema with cross-field refinements (`decision.ts`); "anything else fails schema validation before it can influence the loop." The orchestrator has *no tools*, "never writes to the graph and has no path by which it can dispatch another goal."
- Hard bounds (`maxIterationsPerGoal`, `maxTasksPerGoal`, `maxConcurrentTasks`, `taskMaxIterations`) are checked *before* any task starts, "so a tripping decision dispatches nothing."
- Failure is typed at every exit (`iteration_bound`, `task_bound`, `concurrency_bound`, `decision_error`, `orchestrator_fail`), and "a crashed task is an observation, not a goal crash."
- There is no blackboard. Tasks in one batch are independent; state inheritance happens only by naming prior-iteration task ids, and "same-batch ids are rejected… a decision naming a task this goal never dispatched is exactly as malformed as an invalid action."

The A2A surface (`src/core/a2a/protocol.ts`, `src/api/a2a.ts`) is "a second door into the Session 9 goal loop, never a bypass. One A2A task is one agentic goal dispatched through the SAME queue, admission gates, and hard per-goal bounds… the concatenated message text is the only payload that crosses into the loop." Inbound envelopes cross Zod schemas with semantic size caps (32,768-char goals, 8 parts) so "a misbehaving external agent must degrade to protocol errors, never resource exhaustion"; unsupported spec features are declined with the spec's own error vocabulary, never partially accepted.

### Lineage

Planner–executor splits go back through HuggingGPT and Plan-and-Solve to HTN planning; shared-memory coordination is the blackboard tradition (Hearsay-II, 1970s); the modern frameworks — AutoGen, LangGraph, CrewAI — all offer supervisor/worker topologies. Budgeted execution and typed errors are ordinary distributed-systems hygiene. A2A itself is an external spec (a2a-protocol.org) Trellis merely implements.

### The delta

The delta is subtractive, which is why it is easy to underrate. Where the frameworks compete on what the orchestrator *can* do, Trellis's contribution is a worked example of how little it should: a pure decision function whose entire influence on the world is a validated JSON object, with every resource bound enforced outside it and every anomaly returned to it as data. Two specific moves exceed the precedents: pre-dispatch bound checking as an atomicity property (a violating decision has *zero* side effects — most frameworks kill loops mid-flight), and the anti-blackboard stance made structural rather than stylistic (same-batch seeding is a schema-level protocol violation, not a discouraged pattern). The A2A posture — an external protocol surface that *inherits* every internal bound because it can only enqueue through the same gate, with message text as the only payload — is a clean instance of a principle the multi-agent security literature is only now converging on: new doors, never new authority.

### Evidence in-repo

Strong for a control component: the loop is fully dependency-injected and unit-tested with zero infrastructure (`goal_loop.test.ts`), the A2A drill (`scripts/test_a2a.ts`) exercises the surface, and the "zero-paid-drilled" discipline means the bound and violation paths were exercised with oracle stubs before any model spend. Utility evidence (does the decomposition help?) lives in the paid drills and is thinner.

---

## 7. The engineering loop

### Mechanism

`tools/engineering-loop/` is a controller for LLM-driven software engineering on the Trellis repository itself, specified before implementation in a 609-line RFC-style document (`SPEC.md`) with permanent `EL-REQ-*` identifiers and a conformance matrix. Verified structure:

- **A deterministic control kernel** (`src/kernel.ts`, `state_machine.ts`) owning an 11-state machine (`selected`, `preparing`, `running`, `verifying`, `awaiting_approval`, `awaiting_review`, `recovering`, `accepted`, `blocked`, `failed`, `cancelled`) with an explicit allowed-transition table and enumerated forbidden transitions (e.g., "a worker or checker report directly to `accepted`").
- **Trusted-state separation:** controller state, approvals, and evidence live outside every agent-writable worktree (`EL-REQ-CORE-003`), under a single writer lock; the journal is "append-only, monotonically sequenced, and integrity-linked to the preceding committed event" (`EL-REQ-STORE-003`), with crash injection at every durability boundary a conformance requirement (`EL-REQ-STORE-008`).
- **Model output as observation, never authority:** "Model output MUST NOT authorize, commit, or imply a protected or terminal transition" (`EL-REQ-STATE-005`); a five-layer evidence precedence (§11) places worker reports at the bottom, below controller-observed command evidence — "a worker statement about Git state, changed paths, command success, or test counts MUST remain a report" (`EL-REQ-REPO-005`).
- **Controller-executed verification:** acceptance commands are launched and observed by the controller's verifier, never trusted from runner text (`EL-REQ-VERIFY-001`), with full argv/exit/digest command evidence.
- **A prompt compiler with contamination scanning:** `prompt_compiler.ts` pins the four role prompts by SHA-256 digest and scans reusable prompt assets for eleven contamination patterns — concrete examples, commit hashes, repository paths, transcript turns, diff material, mutable session claims, dates — enforcing the invariant-frame-vs-typed-data split (`EL-REQ-PROMPT-003`) mechanically.
- **Human approval gates** for every protected effect (paid calls, push, merge, self-modification), matched on exact scope with atomic consumption; the acceptance ledger's human-pinning design is the companion paper's subject and is not analyzed here.

### Lineage

Each ingredient has a mature ancestor: the state machine and journal are event sourcing and write-ahead logging; integrity-linked append-only records are Schneier–Kelsey secure audit logs and certificate-transparency-style chains; durable execution with crash-consistent recovery is Temporal/workflow-engine territory; GitOps contributed reconciliation-against-observed-state; SWE-agent, Devin, and OpenHands established the bounded-episode coding-agent harness; AutoGen/LangGraph the orchestration; and the general posture — validate model output, gate high-risk operations on humans, treat tool output as untrusted — is by 2026 documented harness best practice (see, e.g., the survey and practitioner literature on agent harnesses and [formal policy enforcement for agentic systems](https://arxiv.org/pdf/2602.16708)).

### The delta

What none of the coding-agent precedents do — and what Trellis's spec does with unusual rigor — is *complete the trust inversion*. SWE-agent-style harnesses constrain what the agent can touch; they still largely believe what the agent says happened. The engineering loop's three-part answer is: (1) a physically separate trusted state root the agent's worktree cannot write, symlink into, or park data in (`EL-REQ-REPO-006`); (2) an explicit evidence-precedence lattice under which a model claim can never override a controller observation; and (3) verification the controller runs itself, recording command evidence at the argv/exit-status level. Add the contamination-scanned, hash-pinned prompt assets — configuration management applied to prompt bytes, with the scanner enforcing that reusable frames stay free of session-specific facts — and the loop reads less like an agent framework than like an avionics-grade control system whose actuator happens to be an LLM. The spec-first form (permanent requirement IDs, superseded-requirements retained with dispositions, per-requirement conformance classes) has RFC/DO-178C ancestry but is, as far as we know, unprecedented applied to an agent harness.

### Evidence in-repo

Strong on conformance, appropriately incomplete on outcomes. The kernel, state machine, store, recovery, prompt compiler, and approval paths all have dedicated test suites (23 test files), and the spec's conformance matrix maps every mandatory requirement to an acceptance item. The repo is candid that this is machinery whose end-to-end value is still being measured (EL-07's handoff-migration comparison is explicitly gated on owner review), and `AGENTS.md` Rule 15 records — with unusual honesty — that the loop's own history includes shipping "correct but unreachable" code three times behind green tests, which is precisely the failure class its later requirements (`EL-REQ-APPROVAL-010`) were written to close.

---

## 8. The self-regenerating handoff and the doctrine triple

### Mechanism

`HANDOFF.md` §0 states the loop plainly: "This file is both the prompt that starts a session and the final deliverable that session must produce." Each session executes the objective specified in §3–§6, records results in the roadmap, then *rewrites the handoff for its successor* in the same PR — selecting the next objective, updating the mental model and baseline counts, preserving §0 verbatim, and leaving a file that must be "fully self-contained: the next session starts with zero context beyond this repository." The closing line is the enforcement: "A session that completes its objective but does not regenerate this file has not finished." A later amendment (the "event-loop rule," step 5) requires re-running objective selection if further work lands after the rewrite — regeneration is a loop, not a close-out step.

The companion discipline is `AGENTS.md` §3's change pattern: `{Behavior_You_Want} → {Tooling_That_Enforces_It} → {Pin_That_Detects_Drift}` — "Prompts REINFORCE behavior; tooling shape ENFORCES it; a pinned test makes drift loud. If you change any leg, find the other two before you start" — with a table mapping each behavior to its enforcement home and its pins. Two pin idioms recur throughout the codebase: *byte-identical-when-absent* (a gated-off feature must leave the composed prompt byte-identical — `build_workspace_addendum` returns the empty string and is pinned by test, following the `build_mcp_addendum` precedent) and *hash-pinned composed prompts* (`scripts/test_modules.py` asserts the SHA-256 of the fully composed system prompt and maintains a dated pin history; drifting the prompt without wittingly recomputing both pins in the same commit fails the suite).

### Lineage

For the handoff: runbooks, onboarding documents, architecture decision records, "living documentation," and — nearest in time — the CLAUDE.md/AGENTS.md conventions that emerged across agent-assisted repositories in 2025–26. The self-referential structure has older echoes: quines, self-hosting compilers, and Gawande-style checklists that include maintaining the checklist. For the doctrine triple: defense-in-depth, Deming-style process control (every defect gets a detector), test-pinning ("golden" tests), and policy-as-code.

### The delta

Session-handoff files exist elsewhere; what does not, to our knowledge, is the *closed loop with a fixed protocol*: the successor's prompt is a required deliverable of the current session, produced under a preserved-verbatim kernel (§0), with staleness itself defined as incompleteness — a rule codified after a documented failure case (the module #1 laundering finding landing as pointer edits while §3 still named the old objective). The README's own gloss is apt: the file is a manual capability flywheel — the same amortize-derivation-once economics as the knowledge cache, applied to engineering context. The doctrine triple, similarly, is defense-in-depth converted from an architecture-review heuristic into a *change-time obligation with named artifacts*: every behavior has an addressable enforcement home and an addressable drift detector, and byte-level prompt pinning gives prompts the review discipline binaries get. That the triple is enforced against the repo's own preferences is shown by the prompt-module era's end: a paid 50-run control *failed* its token criterion and the module was retired outright, hardening the doctrine "behavioral failure classes close by TOOLING SHAPE, not prompt modules."

### Evidence in-repo

Strong for a process mechanism, with the caveat that process claims are inherently harder to pin than code. The regeneration protocol's observance is verifiable in history (55+ sessions, each PR carrying the rewrite; the archive under `docs/archive/ROADMAP_HISTORY.md`); the pins are executable (`test:modules` sections [4]–[8] with recorded pin history); the enforcement-home table is accurate against the tree (we spot-checked five rows). What cannot be shown in-repo is the counterfactual — whether sessions would degrade without the loop — though the recorded origin incidents are suggestive.

---

## 9. Which of these will be reinvented, and which required this repository

A useful sorting question for "novel with precedent" work: does the delta follow from pressures everyone faces, or from commitments almost no one holds?

**Near-certain independent reinvention (pressure: cost and scale).** Content-addressed chunk identity with diff-driven incremental re-extraction (§2's economic half) will be folk practice in RAG pipelines within a couple of years if it is not already; the moment ingestion bills matter, someone rediscovers early cutoff, and content hashing is the obvious key. Likewise the RLM-as-runtime direction (§4): the RLM paper's results guarantee that multiple teams are productionizing REPL decomposition with persistence and telemetry now; Trellis is early and unusually disciplined, not alone. The bounded, schema-validated orchestrator (§6) is being converged on from the safety side by every serious framework — though the specifically subtractive form (tool-free planner, pre-dispatch atomic bound checks, structural anti-blackboard) may take longer, because frameworks are commercially rewarded for adding capabilities, not removing them.

**Probable partial reinvention (pressure: correctness, but only half the idea).** Belief invalidation on document change (§3's drift half) is already being called for in the agent-memory literature and will be reinvented as "contest facts whose sources changed," most likely as embedding-refresh with soft deletion. The parts unlikely to be reinvented without deliberate study are precisely the parts that make Trellis's version trustworthy: the never-delete audit ledger on the belief itself, the exhaustively tested commutativity of racing writers, and above all the *sampled original-sin sweep* — the poisoning drill's mandatory-only recall of 0.000 is a demonstration that the intuitive design (only re-check what changed) is structurally blind, and that lesson generalizes badly from intuition. Mechanical workspace capture (§5) will be reinvented in its convenience form (harnesses auto-caching tool results is already common); the trust form — unforgeable origin stamps, disjoint id spaces so scratch can never be laundered into provenance — requires already believing provenance laundering is your threat model, which Trellis learned from a live incident.

**Unlikely without this repository's obsessions.** The engineering loop's full trust inversion (§7) — evidence-precedence lattices, model-output-as-observation, contamination-scanned hash-pinned prompts, crash-injected journal conformance, all under an RFC-grade spec — sits at an intersection (formal-methods temperament × agent harness × self-hosting ambition) that market pressure does not select for; fragments will appear in security-conscious harnesses, the whole almost certainly not. The self-regenerating handoff and the doctrine triple (§8) are the least likely of all to arise independently in this form. They stem from the repository's one truly peculiar obsession, visible in every section above: *everything is a build artifact with provenance and a drift detector — including the system's own instructions, its own process documents, and the prompt that will create its own next session.* Teams reinvent mechanisms; they rarely reinvent epistemologies. The mechanisms in this paper are strong precisely because an unusual epistemology was applied to ordinary, well-precedented parts — and that combination is the part that will not happen twice by accident.

---

### Sources

- Zhang, Kraska, Khattab, *Recursive Language Models*, [arXiv:2512.24601](https://arxiv.org/abs/2512.24601)
- *Astrolabe: A Content-Addressable Hypergraph for Semantic Knowledge Management*, [arXiv:2604.10435](https://arxiv.org/pdf/2604.10435)
- *STALE: Can LLM Agents Know When Their Memories Are No Longer Valid?*, [arXiv:2605.06527](https://arxiv.org/html/2605.06527v1)
- *From Agent Traces to Trust: A Survey of Evidence Tracing and Execution Provenance in LLM Agents*, [arXiv:2606.04990](https://arxiv.org/html/2606.04990)
- *Formal Policy Enforcement for Real-World Agentic Systems*, [arXiv:2602.16708](https://arxiv.org/pdf/2602.16708)
- Repository sources: `/home/user/trellis` — `src/core/ast/parser.ts`, `src/core/ast/diff.ts`, `src/core/ingestion/ingest_document.ts`, `src/core/graph/provenance.ts`, `src/core/graph/invalidation.ts`, `src/core/graph/verification.ts`, `src/rlm/trellis_agent.py`, `src/rlm/trellis_workspace.py`, `src/workers/workspace_scratch.ts`, `src/core/agent/goal_loop.ts`, `src/core/agent/decision.ts`, `src/core/a2a/protocol.ts`, `src/api/a2a.ts`, `tools/engineering-loop/SPEC.md`, `tools/engineering-loop/src/prompt_compiler.ts`, `tools/engineering-loop/src/kernel.ts`, `HANDOFF.md`, `AGENTS.md`, `README.md`, `poison_drill_results.json`, `update_drill_results.json`, `scripts/test_modules.py`
