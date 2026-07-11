# Effective-Context Probe — Report

*The code-mediated-text pillar's §6.3 measurement
(`docs/architecture/CODE_MEDIATED_TEXT.md`). Round 1 (Session 21,
July 10, 2026): six kernel-fixed questions per arm over the memorized
Frankenstein corpus, one run each. Round 2 (Session 22, July 11, 2026):
the answer-channel fix plus four new measurement arms — an unmemorized
synthetic corpus, a 40-document aggregation corpus, an edit round-trip
suite, and repeats with spread. Small n throughout: directional
evidence, not statistics.*

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

---

# Round 2 (Session 22, July 11, 2026)

## What changed since round 1

**The answer-channel fix shipped first** (the round-1 residual, as
tooling shape): `src/rlm/trellis_answer.py` injects `trellis_answer`
into every research run. `submit(expression_text)` evaluates the given
expression in the live REPL namespace (caller frame, under the REPL's
own safe builtins), structurally refuses bare literals, renders the
value engine-side with the `FINAL_ANSWER:` prefix, and sets
`answer['content']`/`answer['ready']` itself — the computed value lands
by reference, never retyped. The kernel prompt teaches the channel, so
both composed-prompt pins moved wittingly (`test:modules` [4]/[7]; the
omit arm is now purely structural — the default kernel minus exactly
the CODE-MEDIATED TEXT block — no longer the historical pre-Session-20
bytes). `npm run test:answer-channel` (32 checks) pins the 55→47
regression class inside the real rlms LocalREPL. Telemetry gains the
counts-only `answer_submits`; the probe reports it per run.

## Round-2 protocol

Three new corpora, all deterministic, ground truth computed from bytes
(the `synthetic_corpus.ts` / `ground_truth.ts` helpers, unit-pinned;
representation-invariance re-checked against the stored reconstruction
before any spawn):

- **chronicle** — `data/synthetic_chronicle.txt` (committed; 293,411
  bytes ≈ 73k tokens; sha256 `b56f6d32…f1e6`, `.gitattributes -text`),
  a seeded template-prose corpus (mulberry32, invented vocabulary, 48
  "Entry N" sections, one planted unique anomaly sentence per entry)
  that exists nowhere outside this repository — quote/locate answers
  CANNOT come from parametric memory. Ingested as
  `book:synthetic:ninth-circuit-chronicle` (root `f0ffaf20…7c23`,
  1,655 nodes, 827 blocks, extraction `none`; re-ingest observed as the
  auditable no-op). 6 questions: 2 counts (the memorization-immune
  control), 2 anomaly quotes, 2 anomaly locates.
- **ledger** — 40 generated shipping ledgers (185,301 bytes ≈ 46k
  tokens total; concat sha256 `85d43944…5a37`; one canonical record
  shape, 2,209 records) ingested as `ledger:synthetic:house-01`…`-40`.
  3 questions, each requiring filtering/aggregation ACROSS all 40
  documents (top port for a material with its total; a captain's
  material total; how many ledgers ship X to Y) — the multi-file regime
  where pillar §7 says a DataFrame earns its place. Whether the model
  reaches for pandas is measured, not required.
- **edit** — the "never copy" half: each run gets a fresh scratch
  `TRELLIS_EDIT_ROOT` seeded with a notes file carrying two placeholder
  lines; the tasks fetch the chronicle from the database, compute a
  value in code (the unique anomaly sentence / an occurrence count),
  and land it in the file through `trellis_textedit` (`load` → `locate`
  → `splice` → hash-guarded `write_back`) AND in the answer through
  `trellis_answer`. Scored on byte-exact post-edit file contents
  (computed by `replaceUniqueLine`) and answer correctness — the
  edit-tally task is the measured end-to-end cousin of the round-1
  55→47 bug.
- **frank** — the round-1 questions re-run under the fixed answer
  channel (same corpus, same six questions).

Same paired arms as round 1 (`on` = the pinned default kernel, now
`9f09d7d2…dd68`; `off` = `TRELLIS_EXP_OMIT_CMT=1`, now `9779b5c0…9e45`);
`--repeats 2` on the new suites. Model `gpt-5.4-2026-03-05`,
`max_iterations` 8. The runs write no insights.

## Round-2 results (July 11, 2026)

Aggregates (median [min..max] input tokens; `submit` = runs that set
the answer through `trellis_answer`; `pandas` = runs importing pandas).
Raw rows in `benchmark_logs/effective-context-2026-07-11T*`.

| Suite | Arm | Correct | Input tok med [min..max] | Iter med | submit | pandas | Cost |
|---|---|---|---|---:|---|---|---:|
| chronicle | on | 11/12 | 10,160 [3,590..25,147] | 2.5 | 12/12 | 0/12 | $0.4046 |
| chronicle | off | 11/12 | 10,254 [3,536..27,766] | 2.5 | 12/12 | 0/12 | $0.4632 |
| ledger | on | 6/6 | 13,659 [5,467..22,083] | 2 | 6/6 | 0/6 | $0.2750 |
| ledger | off | 6/6 | 12,796 [5,413..18,238] | 2 | 6/6 | 0/6 | $0.2546 |
| edit | on | 4/4 (files 4/4 byte-exact) | 9,375 [4,189..9,578] | 2 | 4/4 | 0/4 | $0.1214 |
| edit | off | 4/4 (files 4/4 byte-exact) | 9,776 [4,123..15,604] | 2 | 4/4 | 0/4 | $0.1382 |
| frank | on | 5/6 | 10,178 [3,613..27,094] | 2.5 | 6/6 | 0/6 | $0.2147 |
| frank | off | 6/6 | 8,978 [3,559..20,449] | 2 | 6/6 | 0/6 | $0.2384 |

Round-2 spend: $2.1103 across 56 runs (plus a $0.0406 single-question
smoke run: $2.1509 total, 57 runs), against a ≤$5 cap per invocation
with the cumulative abort armed; no invocation aborted, and every run
made ≥1 database tool call (no protocol violations).

## Round-2 reading

- **The transcription channel is closed in practice.** Every round-2
  run set its answer through `trellis_answer.submit` (the kernel prompt
  teaches it; nothing forces it — direct assignment still works), and
  every computed value that reached an answer arrived exactly: all
  counts (55, 16, 163, 125, 139, 727, 12, 1,679) match the
  byte-computed truths digit for digit, across both arms. Round 1 had
  one transcription corruption in 12 runs; round 2 had zero in 56.
  The failure mode the channel was built to prevent did not recur.
- **Read-fidelity is isolated and holds.** The chronicle's planted
  anomaly sentences exist nowhere in any training corpus, and the
  quote runs reproduced them byte-faithfully (8/8 quote runs correct
  across arms) with ~10k median input tokens against a ~73k-token
  corpus. The round-1 concern that Frankenstein quotes might come from
  parametric memory does not transfer: the model is genuinely reading
  through the REPL.
- **The round-1 failure retested and gone.** The frank rerun's
  `count-justine` — the exact question the round-1 on arm corrupted
  (computed 55, answered 47) — came back 55 in BOTH arms, submitted
  through the channel.
- **Every round-2 miss is a LOCALIZATION-method failure over the glued
  reconstruction — none is a transcription error.** Three misses in 56
  runs, one family: the stored reconstruction concatenates paragraph
  blocks with unmarked boundaries, so line-anchored heading regexes
  (`^Entry \d+$`, `^Chapter \d+$`) match only where headings happen to
  sit at real line starts. `syn-locate-halloway` (on): zero headings
  matched, `entry_num` stayed `None`, the channel faithfully delivered
  a visibly broken "Entry None" (the off-arm miss was an analogous
  "Entry ?") — under the old answer path these could have been
  plausible wrong digits; by-reference submission converts silent
  corruption into visible nonsense. `locate-November` (frank, on): the
  regex matched ONLY the table-of-contents lines, so "nearest heading
  before the phrase" resolved to the last TOC entry — a
  plausible-looking "Chapter 23". Localization error is the pillar's
  other half, and the reconstruction's unmarked boundaries actively
  invite it; whether `get_ast_texts` should preserve block boundaries
  is a kernel design question worth weighing (it would move every
  pinned reconstruction truth, so it is a witting future change, not a
  patch). (Question-design note: the round-1 frank preamble disclosed
  "paragraph boundaries are unmarked"; the chronicle preamble omitted
  that clause — worth restoring in a future round. The committed
  script is exactly what ran.)
- **The pandas null result.** Zero of the round-2 runs imported pandas
  — including all 12 ledger runs, where a 40-document, 2,209-record
  aggregation is exactly the regime pillar §7 nominates for a
  DataFrame. Plain dict/regex loops answered every aggregation
  correctly at ~13k median input tokens. Finding, not failure: at this
  scale the structure choice does not matter (§7's own claim — "pandas
  earns its place" at a threshold that evidently sits above 40 small
  documents). The regime where it matters remains unmeasured.
- **The edit round-trip works end to end.** 8/8 runs produced
  byte-exact post-edit files through `locate` → `splice` →
  hash-guarded `write_back` — database text and computed counts moved
  into a file by code, with the identical value landing in the answer
  channel. The Session 20 toolkit had never been driven by a paid run
  before; it held.
- **The arm effect visible in round 1 did not reproduce at round-2
  scale.** On/off medians are statistically indistinguishable in every
  suite (chronicle 10.2k vs 10.3k; ledger 13.7k vs 12.8k; edit 9.4k vs
  9.8k), and round 2 saw no attention blowups in any run (round 1's
  off arm pushed ~105k corpus tokens through one `llm_query`). Honest
  reading: the strengthened tooling shape (the submit channel plus the
  established REPL surface) carries the discipline on these task
  shapes with or without the §6.2 prompt block; the block's measured
  margin at this n is ~zero. That is consistent with the pillar's own
  enforcement posture — tooling shape enforces, prompts reinforce —
  and argues for keeping measurement pressure on shape, not prose.
- **One grader defect found and fixed mid-measurement** (disclosed):
  the `led-top-port` checker demanded the literal "Port X" prefix and
  falsely failed correct "Galeholt, 1679"-shaped answers; the four
  affected rows were re-scored with the corrected checker (now in the
  committed script), and the tables above carry the corrected counts.
- **Caveats.** n=2 per question per arm on the new suites (n=1 on
  frank round 2) — spread is reported but still small; the synthetic
  corpora are template prose with lower entropy than natural text
  (counting needles appear in regular contexts); the ledger corpus at
  ~46k tokens is "many documents" but not repo-scale; and the edit
  tasks are single-line replacements, not multi-hunk edits.

## Standing

Repeatable: `tsx scripts/exp_effective_context.ts --ingest` (zero-paid
setup/verify for all corpora), then `--confirm-paid` with `--suites
frank,chronicle,ledger,edit`, `--arms`, `--repeats`, `--questions`
(paid — owner approval per run applies; `--max-spend-usd` defaults to
the standing $5 cumulative abort). The plan-only default spawns
nothing. NOT an acceptance gate; excluded from every zero-paid suite.
The round-1 answer-channel residual is CLOSED (Session 22,
`trellis_answer`); the open thread is the regime where structured
frames beat plain loops — larger/relational corpora than 40 small
ledgers.
