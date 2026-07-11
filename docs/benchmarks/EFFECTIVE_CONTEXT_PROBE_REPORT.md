# Effective-Context Probe — Report

*The code-mediated-text pillar's §6.3 measurement
(`docs/architecture/CODE_MEDIATED_TEXT.md`; owner-approved paid run,
July 9, 2026, executed July 10, 2026 in Session 21). Six kernel-fixed
questions per arm, one run each (n=6 per arm): directional evidence,
not statistics.*

## Protocol

The corpus is the committed `data/frankenstein.txt` — Project Gutenberg
#84, the 1831 text (public domain; 421,536 bytes ≈ 105k tokens; sha256
`bde72e69…34a8`, byte-stability unit-pinned) — ingested through the
ordinary verified path as `book:gutenberg-84:frankenstein` (extraction
`none`, no embeddings; root `a2f9c97c…4439`, 1,708 nodes, 796 blocks;
the byte-identical re-ingest was observed as version 2 with an empty
Merkle diff). It is large enough that reading it through attention is
expensive, small enough to fit every bound.

Two arms, identical in every respect except one prompt block
(`scripts/exp_effective_context.ts`, the `exp_citation_ab.ts` house
style):

- **on** — the pinned default kernel (`COMPOSED_SYSTEM_PROMPT_SHA256
  = 170e9f7e…67e9`), which carries the §6.2 CODE-MEDIATED TEXT hard
  rule.
- **off** — the same spawn with `TRELLIS_EXP_OMIT_CMT=1`: exactly that
  block absent, which is byte-identical to the recorded pre-Session-20
  kernel (`abb945a6…f9b2`). Both compositions are pinned by
  `test:modules` [7]; the flag is experiment-only (`buildAgentEnv`
  strips it unconditionally, pinned in `rlm_job.test.ts`).

Six questions, kernel-fixed in the script, each handing the agent the
document's root hash (the only addressing; the corpus has no embeddings
and no graph entities): two occurrence counts ("Justine" = 55,
"Ingolstadt" = 16 — counting is exactly the arithmetic the discipline
delegates to code), two exact-quote retrievals, two section
localizations. Every expected answer is computed from the committed
bytes by the unit-pinned `ground_truth.ts` helpers, and a
representation-invariance check (file truths = stored-reconstruction
truths) runs before any spawn. Model `gpt-5.4-2026-03-05`,
`max_iterations` 8, no MCP/workspace/textedit/citation instrumentation
in either arm. The runs write no insights.

## Results (July 10, 2026)

Per-run rows (`benchmark_logs/effective-context-2026-07-10T10-02-22-246Z/`):

| Arm | Question | Correct | Input tok | Output tok | Iter | Subcalls | DB calls | Cost |
|---|---|---|---:|---:|---:|---:|---:|---:|
| on | count-justine | **no** (said 47) | 3,409 | 747 | 1 | 0 | 2 | $0.0160 |
| on | count-ingolstadt | yes | 3,410 | 871 | 1 | 0 | 2 | $0.0172 |
| on | quote-vanished | yes | 14,457 | 1,730 | 3 | 0 | 3 | $0.0534 |
| on | quote-waves | yes | 7,719 | 672 | 2 | 0 | 1 | $0.0260 |
| on | locate-November | yes | 8,021 | 794 | 2 | 0 | 1 | $0.0280 |
| on | locate-stature | yes | 26,586 | 1,871 | 5 | 2 | 1 | $0.0852 |
| off | count-justine | yes | 7,504 | 520 | 2 | 0 | 1 | $0.0240 |
| off | count-ingolstadt | yes | 7,692 | 717 | 2 | 0 | 1 | $0.0264 |
| off | quote-vanished | yes | **110,550** | 1,379 | 3 | 1 | 1 | $0.2902 |
| off | quote-waves | yes | 11,629 | 550 | 3 | 0 | 1 | $0.0346 |
| off | locate-November | yes | 17,820 | 960 | 4 | 0 | 1 | $0.0542 |
| off | locate-stature | yes | 25,713 | 1,266 | 5 | 0 | 1 | $0.0769 |

| Measure (median unless noted) | on (§6.2 present) | off (§6.2 absent) |
|---|---|---|
| Correct | 5/6 | 6/6 |
| Input tokens | **7,870** | **14,724** (1.9×) |
| Input tokens, worst run | 26,586 | **110,550** (4.2×) |
| Output tokens | 833 | 839 |
| REPL iterations | 2 | 3 |
| Database tool calls | 1.5 | 1 |
| Arm cost (total) | $0.2259 | $0.5062 (2.2×) |

Total spend: **$0.7320** across 12 runs (pre-flight estimate ≈$1.44
expected / $5.00 hard abort; every run made ≥1 database tool call — no
protocol violations).

## Reading

- **The headline number: with the §6.2 block present, no run put the
  corpus through attention; without it, one did.** The off arm's
  `quote-vanished` run retrieved the text into a variable, then handed
  the ENTIRE document to a single `llm_query` ("return ONLY that exact
  sentence…" + `text`) — ~105k corpus tokens through a sub-LM's
  attention window to do a job `str.find` does in one line. That single
  run cost 7.6× the on arm's input tokens for the same question (110,550
  vs 14,457) and 5.4× its dollars. The on arm's worst run stayed at
  26.6k input; its two subcalls (`locate-stature`) fanned bounded slices
  — the recursion pattern the pillar endorses.
- **Effective context decoupled from the attention window in both
  arms:** every run answered questions over a ~105k-token corpus with
  median per-run input of 7.9k (on) / 14.7k (off) — the corpus lived in
  REPL state, queried by code. The tooling shape (a tool that returns
  text into a variable, a REPL that can compute) carries most of the
  discipline on its own; the prompt block's measured margin at n=6 is
  fewer iterations (median 2 vs 3), half the median input, and the
  absence of attention blowups.
- **The one wrong answer is the pillar's own pathology, caught live in
  the answer channel.** The on arm's `count-justine` run wrote correct
  code; the engine printed `{'simple': 55, 'regex': 55}` — and the
  model's next turn typed `FINAL_ANSWER: 47`. Localization and counting
  were code's; the final VALUE was retyped through attention and
  corrupted. This is transcription error exactly as §1 defines it,
  surviving in the one channel the discipline does not yet mediate
  (`answer['content']` assignment as a fresh literal instead of code
  interpolation from the computed variable). Consistent with eval
  lesson 7 and §2 point 8: prompts request, tooling shape enforces —
  the block did not prevent what only shape can.
- **Correctness is not the discriminating metric at this task size**
  (5/6 vs 6/6 is one transcription slip, not an arm effect). The
  discriminating metrics are bytes-through-attention and its cost.
- **Caveats.** n=6 per arm, one run per question — directional, not
  statistics. Frankenstein is in the model's training data; parametric
  memory could in principle answer quote/locate questions unread (both
  arms nonetheless made ≥1 database call in every run, and the count
  questions are not memorizable). The root-hash reconstruction glues
  paragraph boundaries (blank lines are not stored between blocks); the
  probe verifies its truths are invariant under that representation
  before any spawn, and the observed runs handled it in code.

## Standing

Repeatable: `tsx scripts/exp_effective_context.ts --ingest` (zero-paid
setup/verify), then `--confirm-paid` (paid — owner approval per run
applies; `--max-spend-usd` defaults to the standing $5 cumulative
abort). The plan-only default spawns nothing. NOT an acceptance gate;
excluded from every zero-paid suite. Follow-up worth considering: the
answer-channel residual above suggests a tooling-shape treatment (the
result envelope carrying an engine-computed value by reference rather
than a retyped literal) before any prompt-side reinforcement is
attempted.
