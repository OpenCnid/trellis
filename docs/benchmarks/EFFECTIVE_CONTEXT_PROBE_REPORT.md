# Effective-Context Probe — Report

*The code-mediated-text pillar's §6.3 measurement
([CODE_MEDIATED_TEXT.md](../architecture/CODE_MEDIATED_TEXT.md)), owner-approved
July 9, 2026 and executed July 10, 2026 in Session 21. One paired run
(n=6 questions per arm): directional evidence, not statistics. Raw
per-run measurements: `benchmark_logs/session21_effective_context.json`
(committed with this report); runner: `scripts/exp_effective_context.ts`
over `src/benchmarks/effective_context/`.*

## Protocol

Six kernel-fixed questions over one verified corpus, each asked once per
arm (12 paid runs, counterbalanced order, no retries):

- **Corpus.** Frankenstein (Project Gutenberg #84), committed byte-stable
  at `data/frankenstein.txt` (421,536 bytes, sha256 `bde72e69…6934a8`)
  and ingested through the ordinary verified path as
  `book:gutenberg-84:frankenstein` with extraction `none` — AST root
  `12625e58…3c19e5`, 106 ordered `opaque_text` blocks, zero embeddings.
  Ground truth (whole-word counts, byte-exact sentences, chapter/letter
  localization) is computed from the committed file by unit-pinned pure
  helpers, never hand-typed.
- **Arms.** *discipline-on* — today's default composed kernel prompt
  (sha256 `170e9f7e…d1267e9`). *discipline-off* — the identical run with
  exactly the 252-byte Session 20 CODE-MEDIATED TEXT hard-rule block
  omitted via `TRELLIS_EXP_OMIT_CMT=1`, byte-identical to the recorded
  pre-Session-20 prompt (`abb945a6…9feef9b2`; both pinned in
  `test:modules`). The runner asserts the two spawn environments differ
  by nothing but that flag.
- **Task shape.** Each run gets a temp cwd containing only
  `handles.json` (the document's ordered block hashes plus its root
  hash) and must obtain corpus bytes exclusively through
  `trellis_postgres.get_ast_texts`. `TRELLIS_CITATION_AUDIT=1` records
  the exact read set in both arms. Model `gpt-5.4-2026-03-05`,
  `--max-iterations 5`, per-run timeout 20 min.
- **Scoring gate.** A row scores only if the process exited cleanly with
  telemetry, spend, and a well-formed result; made at least one database
  tool call and zero `vector_search` calls; and its audited read set
  covered **all 106** corpus blocks with **no** hash outside the
  manifest. The gate measures *corpus-grounded* work — Frankenstein is
  in every model's training data, and unaudited answers would measure
  recall, not the pillar.

Pre-flight planning estimate: ~1,408,608 input / ~48,000 output tokens
≈ **$4.00** against the $5.00 ceiling (the off arm was budgeted for two
full corpus passes per question through attention). The estimate is a
runner-side accounting gate re-checked after every subprocess, not a
provider-side hard dollar limit.

## Results (July 10, 2026)

| # | question | arm | status | scored correct | input tok | output tok | DB calls | blocks read | time | cost | audit outcome |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | count-justine | on | ok | **yes** | 22,901 | 1,505 | 2 | 106/106 | 20.7 s | $0.0723 | scored |
| 2 | count-justine | off | ok | no | 22,872 | 1,893 | 4 | 107/106 | 23.3 s | $0.0761 | get_ast_texts read 1 hash(es) outside the corpus manifest |
| 3 | count-safie | off | ok | no | 23,665 | 2,031 | 1 | 107/106 | 22.7 s | $0.0795 | get_ast_texts read 1 hash(es) outside the corpus manifest |
| 4 | count-safie | on | ok | no | 22,153 | 1,655 | 1 | 107/106 | 20.7 s | $0.0719 | get_ast_texts read 1 hash(es) outside the corpus manifest |
| 5 | quote-yellow-eye | on | protocol_violation | no | 30,897 | 2,198 | 0 | 0/106 | 24.3 s | $0.0992 | agent result status protocol_violation |
| 6 | quote-yellow-eye | off | protocol_violation | no | 24,355 | 1,726 | 0 | 0/106 | 20.7 s | $0.0781 | agent result status protocol_violation |
| 7 | quote-adam | off | ok | no | 25,166 | 3,116 | 1 | 0/106 | 29.0 s | $0.0941 | get_ast_texts missed 106/106 corpus block(s) |
| 8 | quote-adam | on | protocol_violation | no | 22,940 | 1,796 | 0 | 0/106 | 21.8 s | $0.0753 | agent result status protocol_violation |
| 9 | section-floating-ice | on | ok | no | 21,715 | 1,265 | 1 | 0/106 | 19.1 s | $0.0669 | get_ast_texts missed 106/106 corpus block(s) |
| 10 | section-floating-ice | off | ok | **yes** | 27,110 | 2,811 | 1 | 106/106 | 28.9 s | $0.0959 | scored |
| 11 | section-wedding-night | off | ok | no | 26,121 | 2,456 | 3 | 0/106 | 25.9 s | $0.0899 | get_ast_texts missed 106/106 corpus block(s) |
| 12 | section-wedding-night | on | ok | no | 21,246 | 1,048 | 2 | 0/106 | 18.6 s | $0.0636 | get_ast_texts missed 106/106 corpus block(s) |

Arm medians (every run; all 12 carried valid token accounting, every
cost is the token-estimate fallback at $2.50/M input + $10/M output —
the runtime reported no `reported_cost_usd`):

| Measure | discipline-on | discipline-off |
|---|---|---|
| Scored correct | 1/6 | 1/6 |
| Median input tokens | 22,527 | 24,761 |
| Median output tokens | 1,580 | 2,244 |
| Median REPL iterations | 5.0 (the ceiling) | 5.0 (the ceiling) |
| Median database tool calls | 1.0 | 1.0 |
| Vector searches (all runs) | 0 | 0 |
| Arm spend | $0.4493 | $0.5136 |

**Total observed spend: $0.9629 across 12/12 runs** (planning estimate
$4.00; the off arm never took the budgeted corpus-through-attention
path). Runner exit: completed, not aborted.

## Reading

1. **Tooling shape dominated the prompt delta — neither arm pulled the
   corpus through attention.** The ~110k-token corpus never entered
   either arm's context: median input tokens differ by ~10% (22.5k vs
   24.8k), nowhere near the ~110k a single full read would add. The only
   route to the bytes was `get_ast_texts` over engine-computed handles,
   and the base rlms REPL protocol already teaches structures + code.
   Removing the 252-byte §6.2 hard-rule block did not push the model
   into attention-reading. This is the pillar's own §2.8 ("prompts
   request, gates enforce") measured from the other side: the discipline
   lives in the tooling shape, and the prompt block's marginal
   contribution was not distinguishable at this n. The off arm was
   directionally chattier (+42% median output tokens, +14% spend).
2. **The audit gate caught exactly the pathologies the pillar names.**
   The ten unscored rows decompose mechanically:
   - *Doubled frame* (rows 2–4): these runs read all 106 blocks **plus
     the root hash** (present in `handles.json`; the root's
     reconstructed text is the whole corpus again) and answered
     **exactly 2× ground truth** — 110 vs 55 Justine, 50 vs 25 Safie.
     Engine-perfect counting over a code-assembled but semantically
     wrong frame: localization-by-code is necessary but not sufficient
     when the frame itself is built wrong. The read-set audit refused
     all three rows.
   - *Parametric memory* (rows 7–9, 11–12): five runs answered without
     reading any corpus block. Both quote-adam answers gave the famous
     sub-clause from training data — missing the sentence's actual first
     clause ("Remember that I am thy creature;") and its real line
     breaks, precisely the transcription channel the pillar forbids.
     Rows 11–12 named the *right* section (Chapter 20) from memory; the
     audit correctly refused to score corpus-free answers even when the
     value was right. Row 9 answered Letter 4 (wrong; Letter 3) —
     memory, unaudited, is also just wrong sometimes.
   - *Workflow stall* (rows 5, 6, 8): three protocol violations (zero
     database calls). Rows 5–6 claimed `handles.json` was absent from
     the working directory — it was present, and five other runs read it
     from the identical cwd — then burned their turns re-deriving lookup
     paths.
3. **The 5-iteration ceiling was binding on every run.** All 12 runs
   report 5 iterations. The one clean on-arm success (row 1) fit the
   full workflow (manifest → 106-block fetch → ordered reconstruction →
   count → answer) inside 5 turns; most runs did not, and the
   protocol-violation/memory rows read as ceiling-forced exits. The
   ceiling came from this probe's fixed design, and it is the probe's
   single biggest self-inflicted constraint.
4. **What the two scored rows show.** One clean success per arm,
   symmetric (on: count-justine; off: section-floating-ice). Both read
   exactly 106/106 blocks, made 1–2 database calls, zero vector
   searches, and cost ~7–10¢. When the workflow completes, the
   discipline's mechanics work exactly as designed — the corpus stays in
   REPL structures, attention holds queries and handles, and the answer
   is engine-derived.

## Honest caveats

- n=6 per arm, one run each, and ten of twelve rows were refused by the
  audit gate — the correctness comparison between arms rests on two
  scored rows and is **not evidence for or against the prompt block's
  effect on accuracy**. The token/spend medians cover all 12 rows and
  are directional only.
- The audit gate measures corpus-grounded work by design; it refuses
  memory-correct answers. Reported "correct" here is therefore *grounded
  correctness*, deliberately stricter than raw answer accuracy.
- Frankenstein is in the model's training data. That contaminates any
  unaudited reading of this task and motivated the read-set gate; a
  corpus outside training data would remove the confound at the cost of
  the committed-corpus reproducibility this probe wanted.
- The spend ceiling is runner-side accounting between subprocesses, not
  a provider-side hard limit; all costs are token-estimates at the
  recorded prices because the runtime reported no cost.
- Probe-design defects found by the run itself, recorded for any future
  (owner-approved) v2: `handles.json` carried the root hash while the
  audit manifest excluded it (rows 2–4 died on that ambiguity — either
  drop the root from the file or admit it to the read set); 5 iterations
  is too tight for a 106-block workflow (row 1 shows it is *possible*,
  not comfortable); the task prompt should state explicitly that the
  manifest file sits in the process working directory. A v2 with those
  three deltas re-measures for roughly the same ~$1 actual (~$4
  budgeted) spend.

## §6.3 status

The giant-context claim now has its first numbers: a ~421 KB corpus was
worked through 106 engine-addressed handles with **~22–25k tokens of
median attention per run in both arms** (bounded by protocol overhead +
handles + bounded pulls, not corpus size), zero vector searches, and
grounded-correct answers only when the full read-set workflow completed.
The measured surprise is that the *tooling shape*, not the §6.2 prompt
block, carries the discipline — and that the audit gate, not the
scoring, did most of the measuring: it converted every failure into a
named pillar pathology (doubled frames, parametric transcription,
estimated-not-queried state).
