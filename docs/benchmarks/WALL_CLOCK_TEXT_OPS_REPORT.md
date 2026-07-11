# Wall-clock text operations: Python native vs polars

**Date:** July 11, 2026 (owner-directed).
**Script:** `scripts/bench_wallclock_text.py` (committed; deterministic seed 20260711).
**Cost:** $0 — no LLM anywhere in this benchmark.

## Question

At a 2-million-token corpus baseline — the owner-set floor for synthetic
tests from here on, anticipating 2M-token context models — which engine is
faster for the text operations Trellis actually performs: **insertion**
(the `trellis_textedit` splice shape) and **disambiguation** (mention
extraction, alias normalization, grouping)?

This measures ENGINE wall-clock, deliberately distinct from the
effective-context probe rounds 2–4, which measured whether the MODEL
reaches for a DataFrame (it never did, 0/191 runs) and whether plain loops
stayed correct (they did). Pillar §7's "plain loops until a measured
threshold" was about model behavior and correctness; this report supplies
the missing engine-side numbers.

## Method

- Corpus: seeded ASCII generator (240 entities, each with 2–5 surface
  variants across suffix and case forms; 55% shipping-record lines, 20%
  prose mentions, 25% filler). Token accounting is the chars/4 heuristic;
  word counts printed alongside for calibration.
- Sizes: ~100k, 500k, 1M, 2M, 4M, 8M tokens (0.4–32 MB).
- 3 repeats per operation, medians reported. `gc.collect()` before each
  timing. Every paired operation **asserts cross-engine result equality**
  before timings are believed (all assertions passed on every run).
- Environment: Python 3.13.1, polars 1.34.0 (eager API), Windows 10,
  Intel64 Family 6 Model 165 (Comet Lake). Single machine; RSS not
  measured.

Operations (Python native vs polars):

| operation | python | polars |
|---|---|---|
| load | `text.split("\n")` | `pl.DataFrame` from split (split cost included) |
| locate substring | list comp with `in` | `str.contains(literal=True)` + row index |
| locate regex | compiled `re.search` per line | `str.contains` (Rust regex) |
| insert ×K | slice `insert` loop AND single-pass batch rebuild | sort-merge (row-index float keys, concat, sort); slice-concat also measured, always slower |
| disambiguation | `re.finditer` over full text + dict loops | `str.extract_all` → explode → normalize → `group_by.agg` |
| aggregation | `re.finditer` + dict sum | `str.extract` groups → cast → `group_by.sum` |
| write-back | `"\n".join(lines)` | `to_list()` + join |

## Results (medians, ms)

### 2M tokens (8.0 MB, 107,769 lines, 26,898 mentions) — the baseline

| operation | python | polars | faster |
|---|---:|---:|---|
| load (split → frame) | 9.8 | 20.7 | py 2.1× |
| locate substring | 9.4 | 3.6 | pl 2.6× |
| locate regex | 125.9 | 4.6 | **pl 27.3×** |
| insert ×88 (loop) | 4.2 | 12.7 | py 3.0× |
| insert ×88 (batch) | 2.8 | 12.7 | **py 4.5×** |
| disambiguation | 245.9 | 17.0 | **pl 14.5×** |
| aggregation | 95.0 | 48.2 | pl 2.0× |
| write-back join | 3.7 | 13.7 | py 3.7× |

### Scaling (the winner and ratio per size)

| operation | 100k | 500k | 1M | 2M | 4M | 8M |
|---|---|---|---|---|---|---|
| load | py 2.0× | py 1.4× | py 2.2× | py 2.1× | py 1.6× | py 1.8× |
| locate substring | py 1.2× | pl 2.0× | pl 2.8× | pl 2.6× | pl 2.7× | pl 3.0× |
| locate regex | pl 8.1× | pl 18.4× | pl 20.4× | pl 27.3× | pl 26.6× | pl 19.6× |
| insert (batch) | py 16.9× | py 7.9× | py 6.4× | py 4.5× | py 4.0× | py 2.6× |
| disambiguation | pl 4.8× | pl 8.8× | pl 14.5× | pl 14.5× | pl 14.7× | pl 13.7× |
| aggregation | pl 1.4× | pl 2.0× | pl 2.1× | pl 2.0× | pl 2.2× | pl 2.1× |
| write-back join | py 2.1× | py 3.4× | py 4.2× | py 3.7× | py 3.0× | py 3.0× |

Absolute ceilings at 8M tokens (32 MB): python disambiguation 921.7 ms vs
polars 67.1 ms; python regex locate 449.3 ms vs polars 23.0 ms; python
batch insert 21.9 ms vs polars 57.5 ms.

## Findings

1. **Insertion: Python native wins at every size** (2.6×–17× on the
   batch rebuild; even the naive descending `list.insert` loop beats
   polars everywhere). A columnar frame has no cheap row insertion —
   sort-merge is its best shape and still loses. The gap narrows with
   size (16.9× at 100k → 2.6× at 8M) but never crosses. The
   `trellis_textedit` list-of-lines frame is the right representation;
   nothing to change.
2. **Disambiguation: polars wins from 100k tokens up, ~14× at the 2M
   baseline and above.** Extraction + normalization + grouping is where
   the Rust regex engine and parallel group_by pay. At 2M tokens the
   Python ceiling is 246 ms (tolerable); at 8M it is 0.9 s vs 67 ms and
   climbing linearly.
3. **Regex scanning is polars's biggest single win (19×–27×)** — a
   per-line compiled `re.search` loop is the slowest thing Python did at
   every size.
4. **Frame construction and write-back are pure overhead** if the
   pipeline only splices: py wins load 1.4×–2.2× and join 2×–4×. A
   pipeline that loads → locates once → splices → writes back should
   never round-trip through a DataFrame.
5. **The engine-side threshold the pillar's §7 contingency asked for is
   now measured:** for extraction/normalization/grouping work the
   crossover sits at or below ~100k tokens (polars already 4.8× there);
   for splice-shaped editing there is no crossover — plain lists win
   through 8M tokens. Model-behavior findings (rounds 2–4: plain loops
   stayed correct and cheap through 6,859 records) are unchanged; this
   report adds that when a future task IS frame-shaped at ≥2M tokens, the
   wall-clock argument for polars is real (order of magnitude), while for
   editing it is negative at every scale.

## Recommendation

Hybrid by operation shape, not by corpus size:

- **Insertion / splice / write-back: Python lists** (the existing
  `trellis_textedit` frame). Confirmed, not changed.
- **Disambiguation / bulk regex scanning / grouping at ≥100k tokens:
  polars** is worth reaching for — ~14× at the 2M-token baseline. If a
  future kernel surface does alias disambiguation over whole corpora
  (entity-resolution-shaped work), build it on polars.
- The 2M-token floor for synthetic tests is comfortably tractable for
  both engines end-to-end (<1 s single-threaded Python worst case per
  op); wall-clock alone does not force polars below 8M tokens, but the
  order-of-magnitude gap on disambiguation is free to take.

## Limitations

chars/4 token heuristic (word count ≈ 0.69× chars/4 on this corpus);
single machine, single run-day; eager polars API (lazy/streaming would
only help polars on the ops it already wins); no memory measurement; the
polars per-call overhead (~1–2 ms thread-pool/dispatch) dominates below
~100k tokens — at REPL-interactive scales the crossover moves with it.
Raw JSON: `benchmark_logs/wallclock_text_*.json` (gitignored, local).
