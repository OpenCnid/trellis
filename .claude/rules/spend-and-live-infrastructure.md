# Spend and live infrastructure

How this repository works when a session spends real money on a model, or
changes shared running state — a database, a queue, a container, a volume, a
remote host. This file carries `AGENTS.md` rules **7** and **19(a)** at full
strength. Both keep their numbers: sibling clauses 19(b) and 19(c) live in
other task-type files and every clause stays citable by its own letter.

---

## Rule 7 — Paid LLM work is owner-gated

> **Paid LLM work is owner-gated**: propose with a printed estimate first,
> hard cap $5/run (typical well under $2), report actuals after. Zero-paid
> drills prove wiring before any spend. Check for stale queue consumers
> before any paid enqueue.

The rule holds these six binds. Each is stated so a single excluded act makes
the sentence false.

1. **Order.** The owner's approval and the run stand in exactly one order:
   the proposal is printed, the owner answers, and only then does the first
   paid call leave the machine. A run whose approval arrives after its
   spend has no approval — it has a notification.
2. **The estimate is printed.** Every paid run has **one estimate that
   exists in the transcript as a number** before the first paid call. An
   estimate held in reasoning, described in prose, or implied by "small" is
   not printed, so the proposal is not yet made.
3. **$5 bounds the whole run.** The cap counts **every paid call the run
   makes — completions, embeddings, retries, sub-agent and orchestrator
   calls — summed**, not each one separately. Typical runs land well under
   $2. Splitting one piece of work into several runs to keep each under the
   cap spends past it; the bound rides the work, not the invocation count.
4. **Two numbers per run.** A completed paid run leaves **exactly two
   figures on the record**: the estimate printed before, and the measured
   actual reported after. One figure means the run is unfinished business —
   restating the estimate as the outcome supplies no second number.
5. **Zero-paid drills come first.** **Every wire the paid run will cross**
   has already carried a zero-paid drill: config load, queue enqueue,
   worker pickup, response parse, persistence, teardown. A segment whose
   first exercise is a paid one was never proved, and paid tokens are the
   most expensive way to discover a typo.
6. **Stale consumers, before any paid enqueue.** The check enumerates **the
   whole set of processes currently attached to the target queue — whoever
   started them, whenever, from whichever worktree** — and confirms each is
   the intended consumer running the intended bytes. See rule 19(a); this
   is where the two rules meet.

### The proposal and the report

A frame, not an example — every slot varies per run:

```
PROPOSAL
  Command:        {Exact_Argv_Including_Confirmation_Flag}
  Unit of work:   {Countable_Unit_And_Its_Count_From_A_Plan_Echo}
  Estimate:       ${Dollar_Figure_Derived_From_Committed_Telemetry}
  Basis:          {Which_Recorded_Run_Or_Price_Table_The_Figure_Comes_From}
  Consumers:      {Enumerated_Processes_Attached_To_The_Target_Queue}

REPORT (after)
  Actual:         ${Measured_Figure} — {Token_Counts_By_Operation_And_Model}
  Coverage:       {Which_Jobs_The_Counters_Actually_Cover}
```

Coverage is a field because a counter reports only what its own process saw.
In `docs/benchmarks/REPOSITORY_INGESTION_REPORT.md` §5c an orphaned worker
consumed 53 of 107 jobs, so the surviving instance's counters covered 54 —
the totals were real and the *run's* totals were not.

### Binds rule 7 leans on that live outside this file

- **The paid gate outranks a live instruction.** `docs/architecture/SESSION_GOVERNANCE.md`
  (Authority ordering) grants a collaborator's current session instruction
  authority over the committed record, then names what that ruling leaves
  untouched: `docs/architecture/SESSION_GOVERNANCE.md` §1.6 exempts the
  zero-paid gate, so **rules 2, 3, 4, 7 and 10 hold regardless**. "Just run
  it" is not an approval; a printed estimate answered by the owner is.
- **What the gate withholds** is rule 14: an owner gate on a paid run
  withholds *that effect only*. Every unprotected preparatory step is
  discharged in the same turn the request is put — plan echo, drill,
  consumer enumeration, cost basis — and the request is specified in full.
- **How the question is asked** is rule 21(a): one question in the chat
  channel, in that same turn, then stop and wait for the answer.
- **What a paid run may be for** is rules 11 and 20: a null counts as a
  finding only once a positive control has fired, and a test measures
  against a stated engineering target. Buying an entailed outcome spends
  the cap on a foregone conclusion.
- **Environment**: paid probes read `OPENAI_API_KEY` from the **shell**
  environment — dotenv never overrides shell env (`AGENTS.md` §5). Live
  drills need the Compose stack.

---

## Rule 19(a) — Observe shared state first

> **Observe before you mutate.** Look at what is already running, present,
> or registered before starting or creating anything in it.

One root: **a session acts on an observation of state made this session,
never on a belief about state carried in from anywhere else.** A previous
session's true statement, a runbook's default, and a memory of last week are
each beliefs; a command run now is an observation.

1. **The observation covers four state kinds, plus the live ones.**
   `docs/architecture/SESSION_GOVERNANCE.md` fixes the set a session observes rather than assumes:
   **current Git, test, prompt-pin, and database state** — and it applies
   with equal force to containers, queues, volumes, and stores. Prompt-pin
   state earns its place: §5c's stale worker was dangerous precisely
   because it ran *old prompt bytes*, so the jobs would have been extracted
   under a prompt the session had already replaced.
2. **The enumeration covers occupants, not this session's occupants.** A
   session names **every process attached to each queue, container, port,
   and store it will touch, including ones no command in this session
   started**. §5c found a `_pilot_workers.tmp.ts` worker from *another
   worktree*, running for days, holding metrics port 9464 and eating
   `extraction_queue`. A check exhaustive over "processes I started" is
   satisfiable while that process runs, and satisfying it is how the jobs
   get eaten.
3. **A destructive command is confirmed over its whole reach.** Before
   `FLUSHALL`, `down --volumes`, `DETACH DELETE`, a truncate, or a volume
   removal, the session names **everything the command will reach** and
   confirms each item is its own disposable project's. Trellis shares one
   Redis across **seven queues plus pub/sub**, so `FLUSHALL` reaches six
   sets of pending jobs and coordination keys the session did not intend
   and does not own; retention policy or a reviewed queue-specific script
   removes history instead. `down --volumes` runs only against a Compose
   project name and data-retention intent that were both confirmed first,
   and `docker compose -p <name>` makes the target explicit
   (`docs/operations/RUNBOOK.md` §0, §3, §5).
4. **A stopped tree is confirmed stopped by observing it.** On Windows,
   killing an npm wrapper leaves the node child alive — §5c's session
   orphaned its own `dev:workers` this way and it consumed 53 jobs. Worker
   trees are killed by child PID, and the kill is followed by an
   observation that no consumer remains.

First response, before anything starts or stops: `docker compose ps`,
`docker compose logs --tail=200`, queue depth via the worker metrics
listener, and the Compose project name in hand
(`docs/operations/RUNBOOK.md` §0). Set `COMPOSE_PROJECT_NAME` when a second
Trellis stack could exist.
