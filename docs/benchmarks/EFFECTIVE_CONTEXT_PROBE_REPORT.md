# Effective-Context Probe — Report

*The code-mediated-text pillar's §6.3 measurement
(`docs/architecture/CODE_MEDIATED_TEXT.md`). Round 1 (Session 21,
July 10, 2026): six kernel-fixed questions per arm over the memorized
Frankenstein corpus, one run each. Round 2 (Session 22, July 11, 2026):
the answer-channel fix plus four new measurement arms — an unmemorized
synthetic corpus, a 40-document aggregation corpus, an edit round-trip
suite, and repeats with spread. Round 3 (Session 23, July 11, 2026): a
102-document multi-table relational corpus, a localization-method arm
with the glued-reconstruction quantification, and n raised to 5/arm on
the load-bearing claims. Small n throughout: directional-to-settling
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

# Round 3 (Session 23, July 11, 2026)

## What round 3 asks

Round 2 left three threads open and one recorded question-design gap:
(1) the pillar's headline §7 payoff — structured frames earning their
keep at genuine relational scale — was a null result at 40 small
ledgers; (2) every round-2 miss was a localization-method failure over
the glued reconstruction, pointing at a concrete representation
question; (3) n=2 per question was too small for the load-bearing
claims; and (4) the chronicle/ledger preambles omitted the "paragraph
boundaries are unmarked" disclosure the frank preamble carries. Round 3
closes all four. No kernel change: the composed-prompt pins
(`9f09d7d2…dd68` / `9779b5c0…9e45`) did not move, and the boundary
question below is a RECOMMENDATION, not an implementation.

## Round-3 protocol

**The relational corpus** (`relational_corpus.ts`; seeded mulberry32
generation, ASCII, concat sha256 `3bbbea18…a697` unit-pinned): 102
documents, 583,128 bytes ≈ 146k tokens — more bytes than the
Frankenstein corpus, 3.1× round 2's record count, and RELATIONAL, not
just multi-document:

- 100 season-two ledgers (`ledger:synthetic:s2-house-001…100`,
  ~6,859 records in round 2's exact canonical record shape);
- one captain registry (`registry:synthetic:captains`: 36 unique
  captains → 8 guilds, round-robin balanced so no guild degenerately
  tops every aggregate);
- one tariff schedule (`tariff:synthetic:port-schedule`: one line per
  (port, material) pair, 9×12 = 108).

Every question requires a genuine JOIN across document kinds — top
guild for a material (ledger×registry), total tariff silver into a
port (ledger×tariff), top guild by total tariff (all three), and a
multi-part guild profile (crates + distinct captains + modal port; the
answer-channel stress companion: two integers and a name interpolated
in code). Ground truth is computed from the generated bytes by
tie-refusing join helpers (`buildGuildIndex`, `buildTariffIndex`,
`topGuildForMaterial`, `tariffIntoPort`, `topGuildByTariff`,
`guildProfile` — unknown captains, missing tariffs, and ties throw);
all 102 documents ingest through the verified path (extraction `none`),
read back byte-exact through the real Python `get_ast_texts`, and
re-ingest as the auditable no-op. Registry/tariff parsing is
shape-based like the ledgers (`parseRegistryRecords`/
`parseTariffRecords` — the round-2 gluing lesson, applied from the
start). Whether the model reaches for a DataFrame is measured
(`usedPandas`, plus `usedPolars` new this round), never required.

**The localization arm**: the chronicle locate suite grew from 2 to 4
planted-anomaly questions (Entries 6/43 kept from round 2 for
comparability; 24/37 new), run at `--repeats 3` both arms alongside
frank's `locate-November` (the round-2 TOC-trap miss). Each locate
run's method is classified from its saved log by the committed
best-effort classifier (`classifyLocalizationMethod`: `line-anchored`
= a `^`-anchored heading pattern or line iteration, the method the
glue breaks; `shape` = a position-independent heading scan; `unknown`
otherwise; a run showing both markers counts as line-anchored — the
anchor's presence is the finding, and several correct runs visibly
tried the anchored method first, got nothing, and paid extra
iterations to recover). Classification for the tables below was
computed from the saved run logs with the committed classifier (the
in-run values predate a fix for anchored alternation patterns like
`^(Letter|Chapter)`; same data, corrected lens — disclosed).

**The zero-paid boundary quantification** (the design finding's
arithmetic, unit-pinned in `ground_truth.test.ts` and printed by
`--ingest` from the stored roots): how many own-line headings can the
naive line-anchored method see?

| Text | Source bytes | Stored (glued) reconstruction | Boundary-preserved reconstruction |
|---|---:|---:|---:|
| chronicle (`^Entry \d+$`) | 48 | **0** (the glued text is ONE line) | 48 |
| frank (`^(Letter\|Chapter) \d+$`) | 28 | **26 — ALL misleading TOC lines**, ending at "Chapter 23" | 56 (all 28 real + 28 TOC) |

And the second trap, found live this round: the glue also destroys
trailing word boundaries. A position-independent shape scan ending in
`\b` (`(Letter|Chapter)\s+\d+\b`) cannot match a heading digit glued
to the next block's first letter ("Chapter 5It was on…"), so
nearest-heading-before-phrase resolves to "Chapter 23" over the glued
text and to the correct "Chapter 5" over the boundary-preserved text
(chronicle: 0 vs 48 headings visible to that scan). "Boundary-
preserved" here means the same stored blocks joined with blank lines
(`boundaryPreservedReconstruction`) — measurement apparatus only; the
real reconstruction did not change.

**Higher n on the load-bearing claims**: the chronicle counts
(transcription-sensitive) and chronicle quotes (unmemorized
read-fidelity) at `--repeats 5` both arms.

**The disclosure fix**: the chronicle and ledger preambles now carry
the frank preamble's clause verbatim ("paragraph boundaries are
unmarked; line breaks inside paragraphs are preserved"). Round 3's
localization numbers were measured WITH the disclosure; round 2's
chronicle numbers were measured without it — read the comparison with
that in mind.

## Round-3 results (July 11, 2026)

Four invocations (each with the pre-flight estimate printed and the
≤$5 cumulative abort armed; none aborted). Raw rows in
`benchmark_logs/effective-context-2026-07-11T*`; every run made ≥1
database tool call (no protocol violations) and every run answered
through `trellis_answer.submit`.

| Invocation | Command shape | Runs | Correct | Spend |
|---|---|---:|---:|---:|
| smoke | `--suites relational --questions rel-top-guild --arms on` | 1 | 1/1 | $0.0593 |
| A (relational) | `--suites relational --repeats 2` | 16 | 16/16 | $0.9813 |
| B (localization) | 4 chronicle locates + `locate-November`, `--repeats 3` | 30 | 23/30 | $1.2586 |
| C (higher n) | chronicle counts + quotes, `--repeats 5` | 40 | 39/40 | $1.3267 |
| **Total** | | **87** | **79/87** | **$3.6260** |

Per suite × arm (median [min..max] input tokens; `frames` = runs
importing pandas OR polars):

| Suite | Arm | Correct | Input tok med [min..max] | Iter med | submit | frames | Cost |
|---|---|---|---|---:|---|---|---:|
| relational | on | 9/9 | 8,652 [8,629..41,355] | 1 | 9/9 | 0/9 | $0.5338 |
| relational | off | 8/8 | 18,879 [8,575..45,520] | 2 | 8/8 | 0/8 | $0.5069 |
| chronicle | on | 28/32 | 8,339 [3,598..27,077] | 2 | 32/32 | 0/32 | $1.1015 |
| chronicle | off | 30/32 | 8,121 [3,544..84,829] | 2 | 32/32 | 0/32 | $1.3253 |
| frank | on | 2/3 | 8,326 [3,651..13,773] | 2 | 3/3 | 0/3 | $0.0867 |
| frank | off | 2/3 | 3,597 [3,597..9,221] | 1 | 3/3 | 0/3 | $0.0717 |

The localization arm (30 locate runs, methods classified from the
saved logs):

| Method | Runs | Correct |
|---|---:|---:|
| line-anchored | 24 | 18/24 |
| shape | 6 | 5/6 |

## Round-3 reading

- **The pandas null result PERSISTS at 3.1× scale with genuine
  joins.** 0 of 87 runs imported pandas or polars — including all 17
  relational runs, where a 6,859-record, three-table join/group-by is
  as close to "relational scale" as this probe has built. Plain dict
  loops over shape-parsed records answered every join digit-exact
  (17/17 relational correct, both arms), at ~8.7k median input tokens
  against a ~146k-token corpus. The honest conclusion after two rounds
  of raising the stakes: on tasks with one canonical record shape and
  a handful of aggregate questions, the structured-frame threshold is
  ABOVE this scale, and correctness does not detect the difference —
  plain loops are simply sufficient. What would plausibly move it
  (recorded for a future owner-picked round, not assumed): schema
  heterogeneity (several record shapes per document), fuzzy joins, or
  a long INTERACTIVE session re-querying the same working set where a
  frame amortizes. Corpus size alone evidently does not.
- **The localization failure class reproduced at rate and stayed
  method-shaped.** 7 of 30 locate runs missed (23%), with the
  disclosure clause IN the preamble. Every miss is method error over
  the glued reconstruction, none is transcription: five were loud
  sentinels a line-anchored scan produced when zero headings matched
  ("NOT_FOUND", "Entry ?" ×3, "Entry UNKNOWN"), and two were the
  plausible "Chapter 23" — the TOC trap, once per arm. The correct
  line-anchored runs recovered by falling back to glue-tolerant scans,
  and paid for it: recovering runs sit at 13k–27k input tokens vs
  ~3.6k for the runs that gave up (and vs one-iteration success when
  the method fits the representation). Prompt disclosure measurably
  did NOT retire the class — representation shape wins over prompt
  text, which is the pillar's own enforcement thesis.
- **The second trap: gluing breaks word boundaries, not just line
  anchors.** The off-arm `locate-November` miss used a
  position-independent shape scan — classified glue-tolerant — that
  ended in `\b`: at a glued junction the heading's final digit abuts
  the next block's first letter ("Chapter 5It was on…"), `\d+\b`
  cannot match, and nearest-heading-before-phrase resolves to the last
  TOC line, "Chapter 23". Both rounds' "Chapter 23" wrong answers are
  this exact arithmetic (now unit-pinned: nearest-before over glued =
  "Chapter 23", over boundary-preserved = "Chapter 5").
- **RECOMMENDATION (the design finding): preserve block boundaries in
  the reconstruction.** All 10 cross-round localization misses (3 in
  round 2, 7 in round 3) fall in the class a boundary-preserving
  `get_ast_texts`/`nodeText` reconstruction repairs: joining stored
  block texts with blank lines restores every own-line heading
  (chronicle 0→48, frank 26-misleading→56 including all 28 real
  headings) and every block-junction word boundary, and
  `sectionContainingBy` over the boundary-preserved text equals the
  source-bytes truth for every probe phrase. Caveat quantified: TOC
  lines still match heading patterns (frank 56 = 28 real + 28 TOC), so
  count-based heuristics can still be confused — the repair claim is
  that the REAL headings become visible, which fixes nearest-before
  localization. This is a WITTING kernel change — it moves every
  pinned reconstruction truth — so it is roadmap-tracked (§4 row 6)
  for owner sign-off, NOT implemented here. Until then the mitigation
  is what round 3 already practices: disclose the representation and
  parse by shape without trailing `\b`.
- **The load-bearing claims moved from directional toward settled.**
  Transcription: 87/87 runs submitted by reference; every digit that
  reached an answer equals the value its code computed; zero
  transcription errors (cumulative with round 2: 144/144 runs through
  the channel, 0 retyped-value corruptions). Read-fidelity: 20/20
  round-3 quote runs reproduced planted anomaly sentences
  byte-faithfully at n=5/arm/question (cumulative 28/28 across rounds
  2–3). The multi-part answer-channel stress held: `rel-guild-profile`
  interpolated two integers and a port name in code, 5/5 runs
  digit-exact (including the smoke run and repeats).
- **One new miss shape, upstream of the answer channel:** the on-arm
  `syn-count-torulf` r5 answered a computed 0. Its code assumed
  `get_ast_texts` returns a LIST, indexed `[0]`, fell through to an
  empty string, counted 0 — and submitted in the SAME response block,
  so its own printed evidence ("Doc text length: 0") never reached
  attention before the submit. The channel worked exactly as designed
  (the answer IS the computed value); the defect is unchecked
  empty-input arithmetic plus same-turn submit. Result-shape
  mishandling, not transcription; its four sibling repeats handled the
  dict shape correctly. Recorded as a question-design-independent
  observation: the discipline's residual risk after transcription is
  closed is computing faithfully over the WRONG input.
- **The arm effect stayed small and one-sided at the tails.** Medians
  are indistinguishable in chronicle (8.3k vs 8.1k); the relational
  medians differ (8.7k on vs 18.9k off) but n=8–9/arm with overlapping
  spreads — directional at most. The single near-corpus attention pass
  of the round (84,829 input tokens: an `llm_query` explicitly planned
  as the "if ambiguous" fallback, carrying most of the 73k-token
  chronicle) happened in the OFF arm; the on arm produced zero such
  passes in 47 runs. Consistent with rounds 1–2: the tooling shape
  carries the discipline; the §6.2 block's measurable margin lives in
  the worst-case tail, not the median.
- **Caveats.** n=3/arm on the locate questions and n≤5/arm elsewhere —
  larger than round 2, still small; the method classifier is
  best-effort over logs (runs that tried the anchored method first and
  recovered count as line-anchored); the relational corpus has ONE
  record shape per document kind, which is exactly the regime where
  plain loops shine — the frames question is answered for THIS shape,
  not for messy data; and the localization comparison to round 2 is
  confounded (round 3 added the disclosure clause and two new
  questions, deliberately, disclosed above).

# Round 4 (Session 24, July 11, 2026) — the localization fix

## What changed since round 3

Round 3's recommendation (a boundary-preserving reconstruction) was
re-pointed by the owner to an ADDITIVE fix, implemented this session:

- **The kernel gained `trellis_postgres.get_ast_blocks(root_hash)`** —
  a document's extraction blocks IN DOCUMENT ORDER as a JSON list of
  `{id, type, text}` objects, where the block set is exactly
  `collectExtractionBlocks`'s and the text reconstruction is exactly
  `get_ast_texts`'s. The model localizes over engine-provided structure
  instead of re-parsing a glued string; NO stored or reconstructed byte
  moved (every round-1..3 number over `get_ast_texts` remains
  byte-comparable). The walk is the dependency-free
  `src/rlm/trellis_blocks.py`, parity-pinned block-for-block against
  the TypeScript authority by `src/core/ast/block_parity.test.ts`; the
  kernel prompt teaches the tool (both composed-prompt pins moved
  wittingly — `test:modules` [4]/[7] histories record the move).
- **`--ingest` now verifies the accessor round-trip live:** frank
  returned 796 ordered blocks and chronicle 827, both byte-identical to
  `collectExtractionBlocks`+`nodeText` over the stored roots, with a
  sampled block's text byte-matching `get_ast_texts` for the same id
  (July 11, 2026, against the durable dev corpora — root hashes
  unchanged, re-ingest still the auditable no-op).
- **The method classifier gained a third verdict:** `structured` — the
  run CALLED `get_ast_blocks` (the marker requires the call's open
  paren; the preambles name the tool paren-free, and the query is
  echoed into the log, so offering the tool can never classify as
  using it). Precedence: structured > line-anchored > shape > unknown,
  because per-block texts make even anchored patterns safe (each
  own-line heading is its own block).
- **The locate preambles now OFFER the accessor** (the round-4
  intervention), scoped to the locate questions only so every other
  question's bytes stay comparable across rounds.

## Round-4 protocol (the re-measure)

Re-run the round-3 locate set — chronicle `syn-locate-*` ×4 + frank
`locate-*` ×2, `--repeats 3`, both arms ≈ 36 runs — with the accessor
taught (kernel) and offered (preamble). Success criterion, stated up
front: the glue-class localization misses fall materially, ideally to
~0 for runs classified `structured`; a null result (the model ignores
the tool, or uses it and still mislocates) is a FINDING that re-opens
the superseded reconstruction-byte row for owner adjudication.

## Round-4 results (July 11, 2026 — owner-approved, $0.9452 / 36 runs)

| arm | runs | correct | structured | inTok med [min..max] | iter med | cost |
|---|---|---|---|---|---|---|
| on  | 18 | 18/18 | 18/18 | 8,229 [3,734..13,871] | 2 | $0.4852 |
| off | 18 | 18/18 | 18/18 | 8,264 [3,680..14,158] | 2 | $0.4601 |

- **The miss rate went from 7/30 (23%) to 0/36 on the same question
  set.** Every run — BOTH arms, all six questions, all repeats —
  called `get_ast_blocks` and localized over the ordered blocks
  (36/36 classified `structured`; zero line-anchored, zero shape,
  zero unknown). The success criterion pre-stated above ("ideally to
  ~0 for runs that use the accessor") is met exactly: 100% adoption,
  100% correct.
- **The round-3 traps are gone at their exact sites.**
  `locate-November` — the "Chapter 23" TOC-trap question that both
  rounds got wrong — came back "Chapter 5" in 6/6 runs across both
  arms; the two new round-3 anomalies (Entries 24/37) and the loud
  sentinel producers all answered digit-exact.
- **The fix is the tooling, not the prompt block.** The off arm
  (§6.2 CODE-MEDIATED TEXT block absent) adopted the accessor at the
  same 18/18 rate with indistinguishable medians — the accessor is
  kernel surface plus a preamble offer, and that shape alone carried
  the behavior. Consistent with rounds 1–3: tooling shape carries the
  discipline.
- **Cheaper AND correct.** Round 3's recovering line-anchored runs
  paid 13k–27k input tokens; round 4's median is ~8.2k with a 14.2k
  worst case and a median of 2 iterations — no recovery loops,
  because the first method fits the representation. All 36 runs
  submitted through `trellis_answer` (answer-channel record now
  180/180 across rounds 2–4, zero transcription errors), 36/36 with
  zero pandas imports.
- **Consequence for the superseded row:** the re-measure is a clear
  positive, so the reconstruction-byte change
  (`get_ast_texts`/`nodeText` boundary preservation) stays SUPERSEDED
  and closed; it would re-enter only if a future measurement finds the
  accessor insufficient.
- **Caveats.** n=3/arm/question, same as round 3's locate set; the
  preamble OFFERS the tool (adoption in the wild without the offer is
  unmeasured — but the kernel prompt also teaches it, and the off arm
  proves the §6.2 block is not what carries it); the classifier's
  `structured` precedence means a run that also ran regexes over the
  per-block texts still counts as structured (safe over per-block
  texts — each own-line heading is its own block).

## Standing

Repeatable: `tsx scripts/exp_effective_context.ts --ingest` (zero-paid
setup/verify for all corpora, including the 102-document relational
set, the boundary quantification printout, and the Session 24
`get_ast_blocks` round-trip), then `--confirm-paid` with
`--suites frank,chronicle,ledger,edit,relational`, `--arms`,
`--repeats`, `--questions` (paid — owner approval per run applies;
`--max-spend-usd` defaults to the standing $5 cumulative abort). The
plan-only default spawns nothing. NOT an acceptance gate; excluded
from every zero-paid suite. Measured standing after four rounds: the
transcription channel is CLOSED (Session 22 `trellis_answer`; 180/180
round-2..4 runs submitted by reference, zero transcription errors);
read-fidelity holds at n=7 per question per arm (28/28 anomaly quotes
byte-faithful); the pandas/structured-frame threshold sits ABOVE
~6,900 records and three-way joins (null at every scale measured so
far — pillar §7's "pandas default" guidance is demoted accordingly,
Session 24); and the localization failure class is CLOSED by
`get_ast_blocks` (Session 24; round 4 measured 0/36 misses with 36/36
accessor adoption vs round 3's 7/30 on the same questions — the
superseded reconstruction-byte change stays closed unless a future
measurement finds the accessor insufficient). No live failure class
remains open in this probe series; the recorded residual is computing
faithfully over the WRONG input (the round-3 result-shape miss).
