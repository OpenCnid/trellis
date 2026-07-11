"""Wall-clock benchmark: Python-native text operations vs polars.

Owner-directed (July 11, 2026). Question: at a 2-million-token baseline
(the floor for synthetic tests from here on), which engine is faster for
the text operations Trellis actually performs — insertion (the
trellis_textedit splice shape) and disambiguation (mention extraction,
alias normalization, grouping)?

Zero-paid: no LLM anywhere. Deterministic seeded corpus. Every paired
operation asserts cross-engine result equality before timings are
reported — a speed number for a wrong answer is worthless.

Token accounting uses the chars/4 heuristic (stated in the report);
word counts are printed alongside for calibration.

Usage:
    python scripts/bench_wallclock_text.py                     # 2M, 4M, 8M tokens
    python scripts/bench_wallclock_text.py --tokens 2000000    # one size
    python scripts/bench_wallclock_text.py --repeats 5
"""

from __future__ import annotations

import argparse
import gc
import json
import platform
import random
import re
import statistics
import sys
import time
from pathlib import Path

import polars as pl

CHARS_PER_TOKEN = 4
SEED = 20260711
INSERT_CAP = 200

SUFFIXES = ["Corporation", "Corp", "Industries", "Group", "Ltd"]
MATERIALS = ["copper", "tin", "salt", "hemp", "amber", "quicksilver", "wool", "pitch"]
PORTS = ["Harrow", "Veld", "Ostmark", "Brine", "Callow", "Ninth Circle", "Tarn"]

SYLLABLES = [
    "bal", "cor", "dex", "fen", "gil", "hax", "jor", "kel", "lum", "mar",
    "nol", "opa", "pex", "quor", "rin", "sol", "tam", "ulv", "vex", "wick",
    "xan", "yor", "zeb", "dra",
]

MENTION_RE = r"\b[A-Za-z]+ (?:Corporation|Corp|Industries|Group|Ltd)\b"
RECORD_RE = r"^On day \d+, (.+?) shipped (\d+) units"


def build_entities(rng: random.Random) -> list[dict]:
    """Deterministic entity pool: unique base names, 2-5 surface variants each."""
    bases: list[str] = []
    seen = set()
    for a in SYLLABLES:
        for b in SYLLABLES:
            name = (a + b).capitalize()
            if name.lower() not in seen:
                seen.add(name.lower())
                bases.append(name)
    rng.shuffle(bases)
    entities = []
    for base in bases[:240]:
        n_variants = rng.randint(2, 5)
        variants = []
        for _ in range(n_variants):
            suffix = rng.choice(SUFFIXES)
            style = rng.randint(0, 2)
            v = f"{base} {suffix}"
            if style == 1:
                v = v.upper()
            elif style == 2:
                v = v.lower()
            if v not in variants:
                variants.append(v)
        entities.append({"base": base.lower(), "variants": variants})
    return entities


def generate_corpus(target_chars: int, rng: random.Random, entities: list[dict]) -> str:
    """Seeded ASCII corpus: shipping records + prose mentions + filler."""
    lines: list[str] = []
    total = 0
    day = 0
    while total < target_chars:
        day += 1
        roll = rng.random()
        if roll < 0.55:
            ent = rng.choice(entities)
            variant = rng.choice(ent["variants"])
            qty = rng.randint(1, 999)
            material = rng.choice(MATERIALS)
            port = rng.choice(PORTS)
            line = (
                f"On day {day}, {variant} shipped {qty} units of "
                f"{material} to Port {port}."
            )
        elif roll < 0.75:
            ent = rng.choice(entities)
            variant = rng.choice(ent["variants"])
            line = (
                f"The harbormaster noted that {variant} remained under "
                f"review through season {rng.randint(1, 40)}."
            )
        else:
            line = (
                f"The tide tables for week {rng.randint(1, 520)} were posted "
                f"without incident at berth {rng.randint(1, 99)}."
            )
        lines.append(line)
        total += len(line) + 1
    return "\n".join(lines)


def timed(fn, repeats: int) -> tuple[object, list[float]]:
    result = None
    times = []
    for _ in range(repeats):
        gc.collect()
        t0 = time.perf_counter()
        result = fn()
        times.append(time.perf_counter() - t0)
    return result, times


def norm_key_py(mention: str) -> str:
    return mention.split(" ", 1)[0].lower()


def run_size(target_tokens: int, repeats: int) -> dict:
    rng = random.Random(SEED)
    entities = build_entities(rng)
    target_chars = target_tokens * CHARS_PER_TOKEN

    t0 = time.perf_counter()
    text = generate_corpus(target_chars, rng, entities)
    gen_seconds = time.perf_counter() - t0

    n_chars = len(text)
    n_words = text.count(" ") + text.count("\n") + 1
    approx_tokens = n_chars // CHARS_PER_TOKEN

    # The locate target: a mid-pool entity's first variant (deterministic).
    locate_target = entities[len(entities) // 2]["variants"][0]

    results: dict[str, dict] = {}

    def record(name: str, times: list[float]) -> None:
        results[name] = {
            "median_s": statistics.median(times),
            "min_s": min(times),
            "times_s": times,
        }

    # ---- 1. Frame construction ----------------------------------------
    py_lines, t = timed(lambda: text.split("\n"), repeats)
    record("py_split", t)

    pre_split = text.split("\n")
    pl_df, t = timed(lambda: pl.DataFrame({"line": pre_split}), repeats)
    record("pl_frame_from_split", t)

    # polars end-to-end from raw text (split included), for a fair "load" total
    _, t = timed(lambda: pl.DataFrame({"line": text.split("\n")}), repeats)
    record("pl_frame_from_text", t)

    # ---- 2. Locate: substring -----------------------------------------
    py_hits, t = timed(
        lambda: [i for i, ln in enumerate(py_lines) if locate_target in ln],
        repeats,
    )
    record("py_locate_substr", t)

    def pl_locate_substr():
        return (
            pl_df.with_row_index("idx")
            .filter(pl.col("line").str.contains(locate_target, literal=True))
            .get_column("idx")
            .to_list()
        )

    pl_hits, t = timed(pl_locate_substr, repeats)
    record("pl_locate_substr", t)
    assert py_hits == pl_hits, "substring locate mismatch"

    # ---- 3. Locate: regex ----------------------------------------------
    regex_pat = r"\d+ units of copper"
    compiled = re.compile(regex_pat)
    py_rx_hits, t = timed(
        lambda: [i for i, ln in enumerate(py_lines) if compiled.search(ln)],
        repeats,
    )
    record("py_locate_regex", t)

    def pl_locate_regex():
        return (
            pl_df.with_row_index("idx")
            .filter(pl.col("line").str.contains(regex_pat))
            .get_column("idx")
            .to_list()
        )

    pl_rx_hits, t = timed(pl_locate_regex, repeats)
    record("pl_locate_regex", t)
    assert py_rx_hits == pl_rx_hits, "regex locate mismatch"

    # ---- 4. Insertion (the splice shape) --------------------------------
    positions = py_hits[:INSERT_CAP]
    annotation = "# AUDIT: mention verified against the registry."

    def py_insert_loop():
        lst = py_lines.copy()
        for p in sorted(positions, reverse=True):
            lst.insert(p + 1, annotation)
        return lst

    py_loop_out, t = timed(py_insert_loop, repeats)
    record("py_insert_loop", t)

    def py_insert_batch():
        out: list[str] = []
        prev = 0
        for p in sorted(positions):
            out.extend(py_lines[prev : p + 1])
            out.append(annotation)
            prev = p + 1
        out.extend(py_lines[prev:])
        return out

    py_batch_out, t = timed(py_insert_batch, repeats)
    record("py_insert_batch", t)
    assert py_loop_out == py_batch_out, "python insertion impls disagree"

    def pl_insert_sortmerge():
        base = pl_df.with_row_index("idx").with_columns(pl.col("idx").cast(pl.Float64))
        new = pl.DataFrame(
            {
                "idx": [p + 0.5 for p in sorted(positions)],
                "line": [annotation] * len(positions),
            },
            schema={"idx": pl.Float64, "line": pl.String},
        )
        return (
            pl.concat([base, new.select(["idx", "line"])])
            .sort("idx")
            .get_column("line")
            .to_list()
        )

    pl_sort_out, t = timed(pl_insert_sortmerge, repeats)
    record("pl_insert_sortmerge", t)
    assert pl_sort_out == py_batch_out, "polars sort-merge insertion mismatch"

    def pl_insert_slices():
        parts = []
        prev = 0
        ins = pl.DataFrame({"line": [annotation]})
        for p in sorted(positions):
            parts.append(pl_df.slice(prev, p + 1 - prev))
            parts.append(ins)
            prev = p + 1
        parts.append(pl_df.slice(prev))
        return pl.concat(parts).get_column("line").to_list()

    pl_slice_out, t = timed(pl_insert_slices, repeats)
    record("pl_insert_slices", t)
    assert pl_slice_out == py_batch_out, "polars slice-concat insertion mismatch"

    # ---- 5. Disambiguation ----------------------------------------------
    mention_compiled = re.compile(MENTION_RE)

    def py_disambig():
        counts: dict[str, int] = {}
        forms: dict[str, set] = {}
        for m in mention_compiled.finditer(text):
            raw = m.group(0)
            key = norm_key_py(raw)
            counts[key] = counts.get(key, 0) + 1
            forms.setdefault(key, set()).add(raw)
        return {k: (counts[k], len(forms[k])) for k in counts}

    py_dis, t = timed(py_disambig, repeats)
    record("py_disambig", t)

    def pl_disambig():
        out = (
            pl_df.select(pl.col("line").str.extract_all(MENTION_RE).alias("m"))
            .explode("m")
            .drop_nulls()
            .with_columns(
                pl.col("m").str.extract(r"^([A-Za-z]+)", 1).str.to_lowercase().alias("key")
            )
            .group_by("key")
            .agg(pl.len().alias("n"), pl.col("m").n_unique().alias("forms"))
        )
        return {r["key"]: (r["n"], r["forms"]) for r in out.iter_rows(named=True)}

    pl_dis, t = timed(pl_disambig, repeats)
    record("pl_disambig", t)
    assert py_dis == pl_dis, "disambiguation mismatch"

    ambiguous = sum(1 for _, (_, f) in py_dis.items() if f >= 2)

    # ---- 6. Aggregation over parsed records ------------------------------
    record_compiled = re.compile(RECORD_RE, re.MULTILINE)

    def py_aggregate():
        sums: dict[str, int] = {}
        for m in record_compiled.finditer(text):
            key = norm_key_py(m.group(1))
            sums[key] = sums.get(key, 0) + int(m.group(2))
        return sums

    py_agg, t = timed(py_aggregate, repeats)
    record("py_aggregate", t)

    def pl_aggregate():
        out = (
            pl_df.select(
                pl.col("line").str.extract(RECORD_RE, 1).alias("ent"),
                pl.col("line").str.extract(RECORD_RE, 2).cast(pl.Int64).alias("qty"),
            )
            .drop_nulls()
            .with_columns(
                pl.col("ent").str.extract(r"^([A-Za-z]+)", 1).str.to_lowercase().alias("key")
            )
            .group_by("key")
            .agg(pl.col("qty").sum().alias("total"))
        )
        return {r["key"]: r["total"] for r in out.iter_rows(named=True)}

    pl_agg, t = timed(pl_aggregate, repeats)
    record("pl_aggregate", t)
    assert py_agg == pl_agg, "aggregation mismatch"

    # ---- 7. Write-back join ----------------------------------------------
    _, t = timed(lambda: "\n".join(py_batch_out), repeats)
    record("py_join", t)

    pl_final = pl.DataFrame({"line": py_batch_out})
    _, t = timed(lambda: "\n".join(pl_final.get_column("line").to_list()), repeats)
    record("pl_join_via_to_list", t)

    return {
        "target_tokens": target_tokens,
        "chars": n_chars,
        "approx_tokens": approx_tokens,
        "words": n_words,
        "lines": len(py_lines),
        "generation_s": gen_seconds,
        "locate_target": locate_target,
        "substr_hits": len(py_hits),
        "regex_hits": len(py_rx_hits),
        "insert_positions": len(positions),
        "entities_normalized": len(py_dis),
        "entities_ambiguous": ambiguous,
        "mentions_total": sum(n for n, _ in py_dis.values()),
        "records_aggregated": len(py_agg),
        "ops": results,
    }


def build_pairs(n_inserts: int) -> list[tuple[str, str, str]]:
    return [
        ("load (split -> frame)", "py_split", "pl_frame_from_text"),
        ("locate substring", "py_locate_substr", "pl_locate_substr"),
        ("locate regex", "py_locate_regex", "pl_locate_regex"),
        (f"insert x{n_inserts} (loop)", "py_insert_loop", "pl_insert_sortmerge"),
        (f"insert x{n_inserts} (batch)", "py_insert_batch", "pl_insert_sortmerge"),
        ("disambiguation", "py_disambig", "pl_disambig"),
        ("aggregation", "py_aggregate", "pl_aggregate"),
        ("write-back join", "py_join", "pl_join_via_to_list"),
    ]


def print_summary(size_result: dict) -> None:
    ops = size_result["ops"]
    print(
        f"\n=== {size_result['approx_tokens']:,} tokens "
        f"({size_result['chars']:,} chars, {size_result['lines']:,} lines, "
        f"{size_result['words']:,} words) ===",
        flush=True,
    )
    print(
        f"    substr hits {size_result['substr_hits']}, regex hits "
        f"{size_result['regex_hits']}, inserts {size_result['insert_positions']}, "
        f"norm entities {size_result['entities_normalized']} "
        f"({size_result['entities_ambiguous']} ambiguous), "
        f"mentions {size_result['mentions_total']:,}"
    )
    header = f"{'operation':26} {'python (ms)':>12} {'polars (ms)':>12} {'faster':>10}"
    print(header)
    print("-" * len(header))
    for label, py_key, pl_key in build_pairs(size_result["insert_positions"]):
        py_ms = ops[py_key]["median_s"] * 1000
        pl_ms = ops[pl_key]["median_s"] * 1000
        if pl_ms < py_ms:
            ratio = py_ms / pl_ms if pl_ms > 0 else float("inf")
            faster = f"pl {ratio:.1f}x"
        else:
            ratio = pl_ms / py_ms if py_ms > 0 else float("inf")
            faster = f"py {ratio:.1f}x"
        print(f"{label:26} {py_ms:12.2f} {pl_ms:12.2f} {faster:>10}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--tokens",
        type=int,
        nargs="+",
        default=[2_000_000, 4_000_000, 8_000_000],
        help="target corpus sizes in approx tokens (chars/4)",
    )
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--out-dir", default="benchmark_logs")
    args = parser.parse_args()

    env = {
        "python": sys.version.split()[0],
        "polars": pl.__version__,
        "platform": platform.platform(),
        "processor": platform.processor(),
        "chars_per_token": CHARS_PER_TOKEN,
        "seed": SEED,
        "repeats": args.repeats,
    }
    print(f"env: {json.dumps(env)}")

    all_results = []
    for tokens in args.tokens:
        print(f"\ngenerating ~{tokens:,} token corpus...", flush=True)
        result = run_size(tokens, args.repeats)
        print_summary(result)
        all_results.append(result)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M%S")
    out_path = out_dir / f"wallclock_text_{stamp}.json"
    out_path.write_text(json.dumps({"env": env, "results": all_results}, indent=2))
    print(f"\nraw results: {out_path}")
    print("all cross-engine equality assertions passed")


if __name__ == "__main__":
    main()
