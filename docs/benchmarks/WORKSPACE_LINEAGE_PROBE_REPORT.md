# Two-Task Lineage Probe — Report

*The Session 16 follow-up to the design-record §11 step-1 workspace
probe (owner-approved paid run, July 8, 2026). Executed against the
Session 16 lineage mechanism as implemented on branch
`d/vigilant-heyrovsky-724d4c` (PR #42). This is a single paired run
(n=1 per arm): directional evidence for the lineage mechanism, not
statistics. It is the follow-up the Session 15 report
([WORKSPACE_PROBE_REPORT.md](WORKSPACE_PROBE_REPORT.md)) named — the
same paired protocol lifted from one task to a two-task goal.*

## Protocol

One upstream task runs once; one dependent task runs twice, identical in
every respect except lineage.

- **Task 1 (upstream, runs once)** — with a Tier-3 workspace attached
  (a goal run), call the deterministic fixture tool `archive_search`
  once for each of four queries, run one graph query for database
  provenance, and answer the four access codes. Each result is ~2.8 KB
  with the code at the END of the payload, past the 500-char stub
  preview, so the codes live only in stored segments. This produces the
  end-of-run workspace snapshot that lineage parks.
- **Task 2 (runs twice, identical query text)** — "you are continuing a
  goal … obtain the four access codes … do not do redundant external
  work." The four queries are restated because the sub-agent shares no
  context with task 1 (the orchestrator would restate them too). The
  query is phrased as a goal, not an explicit fetch instruction, so each
  arm reaches the codes however it can:
  - **Seeded arm** — task 2's workspace is built with the REAL
    `TrellisWorkspace.seed_from_snapshot()` from task 1's snapshot, and
    the `SEEDED RUN` addendum is composed into the prompt — exactly what
    the worker does when it passes `--seed-workspace`. Task 2 begins
    already holding task 1's four segments.
  - **Unseeded arm** — task 2 gets a fresh goal workspace, no seed, no
    seeded addendum. It has no memory of task 1's fetches.

Running task 1 once means both task-2 arms face identical upstream state
(the same snapshot for the seeded arm, nothing for the unseeded arm), so
the ONLY variable is seeding — the single-task probe's isolate-one-
variable design lifted to the cross-task level. The probe exercises the
`snapshot()` → `seed_from_snapshot()` seam in-process; the worker's Redis
park/seed is transport around that seam and is covered zero-paid by
`npm run test:agent-loop`. Model `gpt-5.4-2026-03-05`, `max_iterations`
8, fixture over stdio, no external network. Access codes are
sha256-derived from the queries, so correctness is exact-match
deterministic. Driver: `scripts/probe_workspace_lineage.py`, wrapper
`scripts/probe_workspace_lineage.ts` (deliberately no npm alias; the
owner-gated paid path).

## Results (July 8, 2026)

| Measure | Task 1 (upstream) | Task 2 — seeded | Task 2 — unseeded |
|---|---|---|---|
| Answer correct | yes | **yes** | **yes** |
| External (MCP) calls | 4 | **0** | **4** |
| Database tool calls | 1 | 1 | 1 |
| Input tokens | 9,660 | 22,405 | 16,561 |
| Output tokens | 1,079 | 1,162 | 1,171 |
| Execution time | 12.6 s | 13.4 s | 12.1 s |
| End-of-run segments | 4 | 4 (no re-fetch) | 4 (own re-fetches) |

**Goal totals**

| | Seeded goal | Unseeded goal |
|---|---|---|
| Total external calls (task1 + task2) | **4** | **8** |
| Cross-task re-derivation (task 2 external calls) | **0** | **4** |

Seeded arm inherited-workspace well-formedness, checked BEFORE task 2
ran: snapshot parsed as canonical JSON; exactly 4 segments; all ids
UUIDv4; every origin stamp wrapper-owned and complete
(`server`=`archive`, 16-hex `argsHash`, ISO `fetchedAt`); all four access
codes present in inherited segment content — the material crossed the
task boundary byte-exact, stamps intact.

## Reading

- **The headline effect is cross-task re-derivation: 8 vs 4.** With the
  workspace seeded from the upstream task, the dependent task re-fetched
  NOTHING (0 external calls) — it read the inherited segments and
  answered. Without seeding, the dependent task re-fetched all four
  results the upstream task had already retrieved (4 external calls),
  because a fresh sub-agent has no channel to the prior task's fetched
  bytes. This is the exact within-task effect the Session 15 probe
  measured (8 vs 4 repeated calls), now confirmed at the level lineage
  targets: between the tasks of one goal. Against the free local fixture
  it only costs time; against a real metered web-search server it halves
  the goal's external spend and latency, and — because the seed carries
  origin-stamped bytes rather than an LLM paraphrase — it transfers
  exact identifiers (AST hashes above all) with zero re-typing risk.
- **Correctness was unaffected in all three runs** at this task size;
  seeding did not degrade the answer, and the unseeded arm still reached
  the right codes by re-fetching.
- **Token cost was higher in the seeded arm** (+35% input over the
  unseeded arm: 22.4K vs 16.6K). The seed carries task 1's four full
  ~4 KB segments, and the model pulled them into context via
  `segment(id)` to read the codes; the unseeded arm's own re-fetches
  returned bounded stubs, so its scrollback grew more slowly until it
  read its captured segments. At this deliberately small task size the
  external-call elimination and the token cost roughly trade off — the
  same wash the Session 15 report noted within a task. The mechanism's
  value is the eliminated external calls (metered spend, latency, and
  byte-exact identifier fidelity), not a token saving; at larger fetched
  payloads or metered servers the external-call axis dominates, while
  the token axis is bounded by what the task actually reads.
- `reported_cost_usd` was not populated by the rlms usage summary for
  this model (as in Session 15); spend is bounded by the token counts
  above — ≈48.6K input / ≈3.4K output for the three runs combined, well
  inside the approved envelope.

## Standing

The probe is repeatable (`tsx scripts/probe_workspace_lineage.ts`,
requires `OPENAI_API_KEY`; paid — owner approval per run applies). It is
NOT an acceptance gate and is excluded from every zero-paid suite; the
mechanism itself is pinned zero-paid by `npm run test:rlm-workspace`
(the `seed_from_snapshot` round-trip) and `npm run test:agent-loop` (the
real Redis park/seed path). A larger-payload or longer-horizon variant —
where the token axis and the external-call axis separate rather than
trade off — is the natural next measurement, if a research question ever
warrants the spend.
