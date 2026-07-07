# Paired-Run Workspace Probe — Report

*Design record §11 step 1's behavioral probe (owner-approved paid run,
July 7, 2026 — approval recorded on PR #40). Executed against the
Session 14 Tier-3 workspace as merged in `9f25a5b`. This is a single
paired run (n=1 per arm): directional evidence for the workspace
mechanism, not statistics.*

## Protocol

One sequential multi-step task, two runs identical in every respect
except the workspace:

- **Run A** — workspace attached: `trellis_mcp.call_tool` captures each
  result as an origin-stamped segment and returns a bounded stub
  (≤500-char preview); the workspace addendum is composed into the
  system prompt.
- **Run B** — the pre-Session-14 surface: full results returned into
  REPL scrollback, no workspace, no addendum.

The task (driver: `scripts/probe_workspace_paired.py`, wrapper:
`scripts/probe_workspace_paired.ts` — deliberately no npm alias; it is
the owner-gated paid path): call the deterministic fixture tool
`archive_search` once for each of four queries, extract the
`access_code` from each result, run one graph query for database
provenance, and answer with the four codes in order. Each fixture
result is ~3.9 KB with the access code at the END of the payload —
past the stub preview, so Run A must read stored segments
(`trellis_workspace.segment(id)`) to answer, and Run B carries four
full payloads in scrollback. Expected codes are sha256-derived from
the queries, so correctness is exact-match deterministic. Model
`gpt-5.4-2026-03-05`, `max_iterations` 8, fixture over stdio, no
external network.

## Results (July 7, 2026)

| Measure | Run A (workspace) | Run B (legacy) |
|---|---|---|
| Answer correct | **yes** | **yes** |
| MCP calls (minimum 4) | **4 — zero repeats** | **8 — every call repeated** |
| Database tool calls | 1 | 1 |
| Input tokens | 14,221 | 12,764 |
| Output tokens | 1,035 | 867 |
| Execution time | 13.2 s | 9.4 s |
| End-of-run workspace | well-formed (below) | n/a |

Run A workspace well-formedness: the snapshot parsed as canonical JSON;
exactly 4 segments; all ids UUIDv4; every origin stamp wrapper-owned
and complete (`server`/`tool`/16-hex `argsHash`, ISO `fetchedAt`,
`goalId` correlation); all four access codes present in stored segment
content; telemetry counters `workspace_ops` 16 / `workspace_segments` 4
/ `workspace_bytes` 15,531.

## Reading

- **The headline effect is repeated external calls: 8 vs 4.** Without
  captured segments, the model re-fetched every result rather than
  reusing what it already had; with the workspace it called each tool
  exactly once and read segments deliberately. Against the free local
  fixture this only costs time; against a real metered web-search
  server it doubles external spend and latency — precisely the failure
  mode design record §4.3 predicts for scrollback-as-memory.
- **Correctness was unaffected in both arms** at this task size; the
  stub protocol did not degrade the answer.
- **Token cost was comparable** (Run A +11% input, driven by the
  workspace addendum and the extra segment-read turns; Run B's repeated
  calls partially offset its lack of addendum). At larger result sizes
  or longer horizons the workspace's O(plan) context property should
  dominate; this probe was sized to fit one context comfortably by
  design.
- `reported_cost_usd` was not populated by the rlms usage summary for
  this model; spend is bounded by the token counts above (≈27K input /
  ≈1.9K output for the pair). The probe was executed twice end-to-end
  (a log-capture defect in the first execution's harness pipeline, not
  in the probe, truncated the measurement JSON; the first execution's
  answers were also both correct), so total spend is ≈2× those counts —
  well inside the approved envelope.

## Standing

The probe is repeatable (`tsx scripts/probe_workspace_paired.ts`,
requires `OPENAI_API_KEY`; paid — owner approval per run applies). It
is NOT an acceptance gate and is excluded from every zero-paid suite.
Follow-up worth considering when lineage (design record §11 step 4)
lands: the same paired protocol across a two-task goal, measuring
whether seeded workspaces eliminate cross-task re-derivation.
