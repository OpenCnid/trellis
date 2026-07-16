# Support-Computation Oracle Drill

**Status: PROPOSED — UNRUN.** Nothing below has been implemented or
executed; no result exists; nothing here may be cited as evidence. This
is a docs-only proposal (July 16, 2026) for a bounded feature the owner
may authorize, amend, or refuse.

---

## 1. Source and claim operationalized

**§8 source (exact):**
[`docs/review/06_EPISTEMIC_SUPPORT_PROPOSAL.md`](../../review/06_EPISTEMIC_SUPPORT_PROPOSAL.md),
section **"8. Drills and acceptance (zero-paid first)"**, first item:

> *Support-computation oracle drill: seeded beliefs + scripted op
> verdicts → assert exact (b, d, u) arithmetic, decay behavior, and
> abstain → u routing. No LLM.*

(Disambiguation performed per operator instruction: this is not
`HANDOFF.md` §8, not a section of arXiv:2607.12790 — the paper has
lettered appendices, no §8 — and not any other repository §8.)

**Research claims operationalized** (IDs from
[`RESEARCH_MAP.md`](RESEARCH_MAP.md)): R-02 (anchor guards / validity
gate are mandatory and fail closed), R-04 (small byte-pinned anchor
fixtures), R-10 (writer confidence is excluded from support
computation), R-01 (drawback-first verdict routing: `abstain` feeds
uncertainty, never belief).

## 2. Purpose and narrow hypothesis

**Purpose.** Pin the arithmetic core of the proposed epistemic-support
layer before any judge, sweep, or database integration exists, so that
every later layer builds on behavior a drift pin already guards.

**Hypothesis (deliberately narrow).** Given a fixed set of synthetic
belief records, a fixed stream of scripted op verdicts with fixture
timestamps, and a fixed metric-expression set, a pure support-
computation module produces exactly the pre-computed (b, d, u) opinions;
routes every `abstain` to `u`; applies decay deterministically from
fixture timestamps; refuses vacuous metric candidates; and produces
byte-identical opinions whether or not writer-supplied `confidence` is
present on the input records.

## 3. What it proves and cannot prove

**Proves (if implemented and green):** the computation is deterministic,
its published arithmetic matches its behavior, its refusal gates fire,
and the confidence-exclusion invariant holds — i.e., the support layer's
*mechanics* are trustworthy.

**Cannot prove:** that the chosen aggregation function is *well-chosen*
(RESEARCH_MAP §6.2 — an open design question); that real judge ops are
calibrated (owner-gated paid follow-on, §16); that the sweep integration
is reachable (a later drill, once a `support_sweep` job exists); or
anything about live corpora. A passing drill is correctness, not
reachability, of the module it exercises — reachability is addressed by
naming the entrypoint in §7 and by the implementation boundary in §16.

## 4. Deterministic oracle design

Model judgment is replaced entirely by fixtures:

- **Scripted op verdicts** (`verdicts.json`): every op result the
  computation consumes is a fixture row `(beliefId, opId, verdict ∈
  drawback|clean|abstain, atTimestamp, weightKey)`. No op executes.
- **Expected opinions** (`expected_opinions.json`): the oracle truths,
  generated once by a standalone generator script committed beside the
  fixtures, then byte-pinned. The drill never regenerates them at run
  time; the generator is run manually only when the aggregation
  function's *specification* changes, in the same commit that re-pins.

**Nondeterministic dependencies and their removal:**

| Dependency | Removal |
|---|---|
| LLM judgment | none exists — all verdicts scripted (zero completions) |
| Wall clock (decay) | decay computed from fixture timestamps only; the drill never calls the system clock inside an assertion (house rule: timings printed, never asserted) |
| Float ordering / accumulation | canonical accumulation order (sorted by `(beliefId, opId, atTimestamp)`); comparison at absolute tolerance 1e-9 AND canonical sorted-key JSON serialization equality of rounded values |
| Map/object iteration order | canonical-form serialization (the `test:rlm-workspace` [8] pattern: parse + re-serialize byte-identical) |
| Randomness / sampling | none — input sets are exhaustive and fixed; no sampler exists in this drill |
| Environment leakage | drill refuses to run if any `TRELLIS_EXP_*` variable is set (mirrors `buildAgentEnv` hygiene) |

## 5. Fixture and corpus design

New directory `fixtures/support_oracle/` (sibling of the existing
`fixtures/repo_ingest/`), all files committed and byte-pinned via a
`manifest.json` carrying each file's SHA-256:

- `beliefs.json` — synthetic belief records (token-scoped ids
  `support-oracle:<n>`). Any 64-hex strings inside are **synthetic
  placeholders that exist nowhere in `ast_nodes` and are never written
  to any database** — the drill is pure and opens no connection, so no
  provenance surface is touched. Several records deliberately carry a
  writer `confidence` field (including one at 0.97, mirroring the
  poison-drill value) for the exclusion test.
- `verdicts.json` — the scripted verdict stream, including: all-clean
  runs, all-drawback runs, mixed runs, abstain-heavy runs, multi-op
  disagreement, and two-timestamp sequences for decay.
- `metrics.json` — metric-expression candidates: valid compositions
  (`any`, `all`, K-of-k) plus three planted vacuous candidates
  (all-pass, all-fail, all-abstain) for the validity gate.
- `expected_opinions.json` / `expected_opinions_broken.json` — oracle
  truths, and a deliberately corrupted copy (one flipped digit in one
  `b` value) for the negative control.
- `generate_expected.ts` intent: the standalone generator (committed,
  documented, run manually — never by the drill).

Isolation: no database, queue, network, or repository-state dependence;
fixtures are self-contained; nothing in `data/` is touched.

## 6. Inputs, setup, execution sequence, expected outputs

**Inputs:** the fixture directory; optional `--results <path>`;
optional `--section <name>`; mode flags (`--negative-control`,
`--inject corrupt-expected`).

**Setup:** none beyond `npm ci` (pure Node/tsx; no Compose stack, no
Python, no env vars required).

**Execution sequence (sections, in order):**

1. `[manifest]` — hash every fixture file; refuse on any mismatch.
2. `[arithmetic]` — compute opinions for every (belief, verdict-stream)
   pair; assert exact equality with `expected_opinions.json` under §4's
   comparison rule.
3. `[abstain-routing]` — for the abstain-heavy streams, assert all
   abstain mass lands in `u` and `b + d + u = 1` within tolerance.
4. `[decay]` — for two-timestamp sequences, assert the later-timestamp
   opinion matches its expected row and that `u` is monotonically
   non-decreasing across the gap with no verdicts in between.
5. `[validity-gate]` — assert each planted vacuous metric candidate is
   refused with a typed error naming the vacuity class; assert the
   valid candidates load.
6. `[confidence-exclusion]` — compute opinions for the confidence-
   bearing records twice (field present / field stripped); assert
   byte-identical canonical serializations.
7. `[negative-control]` (only under `--negative-control`) — run
   `[arithmetic]` against `expected_opinions_broken.json`; the drill
   MUST exit nonzero naming the exact mismatched belief and field.
8. `[failure-injection]` (only under `--inject corrupt-expected`) —
   corrupt one expected value in memory post-load; assert the mismatch
   is detected and reported (the drill passes by observing its own
   detection).

**Expected output:** one line per section `[name] ok (N checks)`;
a final counts-only summary; exit 0 in default mode with all sections
green; exit nonzero with named findings otherwise.

## 7. Intended implementation files and the non-test entrypoint

| Artifact | Path (proposed; none exist today) |
|---|---|
| Computation module (pure) | `src/core/graph/support.ts` |
| Metric-expression loader + validity gate | `src/core/graph/support_metrics.ts` |
| Drill script | `scripts/test_support_oracle.ts` |
| Fixtures | `fixtures/support_oracle/` |
| **Non-test entrypoint** | **package script `test:support-oracle`** in `package.json`, invoking the drill script — the same reachability pattern as the existing `test:promotion` / `test:textedit` drills |

Per `AGENTS.md` §4 rule 15 the module's *production* (non-drill)
reachability is deliberately out of scope here and is named as the
boundary in §16: `support.ts` gains its production caller only when a
`support_sweep` job name lands on the shared verification queue as its
own bounded feature.

## 8. Acceptance table

| Criterion | Enforcement mechanism | Observed value required | Falsifying result |
|---|---|---|---|
| Opinion arithmetic exact | section `[arithmetic]` comparison rule (§4) | 100% of pairs equal within 1e-9 + canonical-form equality | any mismatch |
| Abstain → u only | section `[abstain-routing]` invariant checks | all abstain mass in `u`; sum = 1 ± 1e-9 | abstain mass appearing in `b` or `d` |
| Decay deterministic and monotone in `u` | section `[decay]` | expected rows equal; `u` non-decreasing over verdict-free gaps | non-deterministic or decreasing `u` |
| Vacuous metrics refused | section `[validity-gate]` typed refusals | 3/3 planted candidates refused with named class; valid candidates load | any vacuous candidate loading |
| Writer confidence excluded | section `[confidence-exclusion]` byte-comparison | identical opinions with/without `confidence` | any byte difference |
| Fixture integrity | section `[manifest]` SHA pins | all files match `manifest.json` | drill proceeding past a mismatch |
| Harness can fail loudly | `--negative-control` mode | nonzero exit naming belief + field | exit 0, or an unnamed failure |
| Zero-paid boundary | static import check + no network/DB code paths (§14) | zero `openai` imports; zero connections opened | any completion, connection, or paid call |

## 9. Controls

- **Positive control:** the committed known-good fixture set passing
  end-to-end (sections 1–6 green) — proves the harness runs and agrees
  with an independently generated oracle.
- **Negative control (deliberately broken):**
  `expected_opinions_broken.json` under `--negative-control` — proves a
  wrong oracle is *detected and named*, not absorbed. A drill that
  passes its negative control by exiting zero is itself the failure.

## 10. Failure injection (false-confidence path)

The most dangerous silent failure for a support layer is **false
confidence**: an opinion that looks computed but was influenced by the
writer's self-reported `confidence` (the poison drill wrote poison at
0.97 — RESEARCH_MAP R-10). Section `[confidence-exclusion]` targets it
directly, and `--inject corrupt-expected` proves the comparison
machinery itself cannot pass on corrupted truths. Together they cover
the false-positive path (drill green while arithmetic wrong) and the
false-confidence path (opinion influenced by unjudged input).

## 11. Idempotency, cleanup, rerun

The drill is stateless and read-only: it writes nothing except the
optional `--results` file at an operator-chosen path (never inside
`fixtures/`, never at the repo root by default). Reruns are
byte-deterministic. There is no cleanup because there is no state.

## 12. Bounded telemetry and raw-results schema

Telemetry is counts-only (T16 discipline): section names, check counts,
refusal counts, exit status. No belief content, no fixture bytes, no
hashes in log lines.

Raw-results file (optional), authored as a structural frame — free
variables, no concrete filler (Hypershot construction rules A–C):

```jsonc
{
  "drill": "support-oracle",
  "fixtureManifestSha": "{Manifest_File_Sha256}",
  "mode": "(default | negative-control | inject)",
  "sections": [
    { "name": "{Section_Name}", "checks": "{Integer_Count}", "status": "(ok | failed)",
      "findings": [ { "beliefId": "{Token_Scoped_Id}", "field": "(b | d | u)",
                      "expected": "{Rounded_Value}", "observed": "{Rounded_Value}" } ] }
  ],
  "summary": { "sectionsRun": "{Integer}", "sectionsFailed": "{Integer}", "exitCode": "{Integer}" }
}
```

Field names above are invariant vocabulary (they pass the invariance
test: identical across all invocations); every value slot is variant
and therefore a placeholder.

## 13. Stop conditions and refusal behavior

The drill refuses **before any section runs** when: a fixture file is
missing or fails its manifest SHA; the fixture schema version is
unknown; any `TRELLIS_EXP_*` variable is set. A failing section does
not halt later sections (all findings are reported, exit nonzero at the
end) — except `[manifest]`, whose failure halts everything, because
every later assertion depends on fixture integrity.

## 14. Zero-paid proof (exact)

- **Zero paid API calls / zero model completions:** no LLM client is
  imported anywhere in the module or drill; a static import-allowlist
  check (the `test:textedit` static-pin pattern) asserts `openai` and
  any HTTP client are absent from `support.ts`, `support_metrics.ts`,
  and `scripts/test_support_oracle.ts`.
- **Zero protected effects:** no acceptance-ledger, controller-state,
  git, push, or approval surface is touched or imported.
- **No production systems:** no PostgreSQL, Neo4j, Redis, queue, or API
  connection is opened; the drill has no connection code at all.
- **Network disabled:** nothing dials; no fixture transport is under
  test (unlike `test:rlm-mcp`, which legitimately exercises loopback).

## 15. Command skeletons

```bash
# Intended drill (after implementation is authorized and landed):
npm run test:support-oracle
npm run test:support-oracle -- --results /tmp/support_oracle_results.json
npm run test:support-oracle -- --negative-control
npm run test:support-oracle -- --inject corrupt-expected

# Focused sections during development:
npx tsx scripts/test_support_oracle.ts --section arithmetic
npx tsx scripts/test_support_oracle.ts --section validity-gate

# Focused unit tests (module-level, run inside npm test):
npx vitest run src/core/graph/support.test.ts
```

(Command names are the proposal; none resolve today.)

## 16. Limitations, residual risks, and the owner-gated follow-on

- **The oracle validates mechanics, not design.** The aggregation
  function itself is an open question (RESEARCH_MAP §6.2); the drill
  pins whatever function the owner ratifies and will need re-pinning
  (generator re-run, same-commit manifest update) if the specification
  changes — the composed-prompt-pin discipline applied to arithmetic.
- **Generator/model common-mode risk:** if the generator and module
  share a buggy helper, both could agree on wrong values. Mitigation:
  the generator must be a separate implementation of the *specification*
  (no imports from `support.ts`), stated as a review criterion.
- **Reachability boundary:** this drill makes the module reachable via
  a package script only. Production reachability (`support_sweep` on
  the shared verification queue, config twins, counts-only telemetry
  fields) is the next bounded feature and is **not** authorized by this
  document.
- **Paid follow-on (separate owner-gated proposal, not part of this
  drill):** judge-op calibration against ten-item human/mechanically
  labeled anchor fixtures (RESEARCH_MAP §4.4 divergence applies:
  no teacher-model labels without an explicit owner ruling), reported
  as agreement-with-n in `docs/benchmarks/` only after it runs. Any
  judge instruction authored for it must follow the house prompt
  protocols (`HANDOFF.md` §7 guardrail 11): an invariant, contamination-
  free frame at the system layer with belief content bound downstream
  per task — e.g.:

```xml
<judge_contract>
  <context>Registered metric: {Metric_Id}. Rubric: {Rubric_Sha}.</context>
  <task>Given <claim>${Belief_Claim_Text}</claim> and <evidence>${Cited_Block_Texts}</evidence>,
    return exactly one verdict.</task>
  <constraints>*** CRITICAL ***
    - Verdict means "{Named_Drawback_Found}" or "no known drawback found" — never certified correctness.
    - If the evidence does not bear on the claim, abstain.</constraints>
  <output_instructions>JSON: {"verdict": "(drawback | clean | abstain)", "drawback": "({Failure_Class_From_Registered_Taxonomy} | null)"}</output_instructions>
</judge_contract>
```

  The frame's vocabulary (`verdict`, the three enum values) is
  invariant; every content slot is a placeholder; no concrete belief,
  topic, or example appears at the frame layer.
