"""Offline syntax and import smoke check for container-shipped Python code."""

from __future__ import annotations

import importlib
import py_compile
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RLM_DIR = ROOT / "src" / "rlm"
PYTHON_FILES = [
    RLM_DIR / "trellis_agent.py",
    RLM_DIR / "trellis_tools.py",
    RLM_DIR / "trellis_blocks.py",
    RLM_DIR / "trellis_mcp.py",
    RLM_DIR / "trellis_workspace.py",
    RLM_DIR / "trellis_modules.py",
    RLM_DIR / "trellis_textedit.py",
    RLM_DIR / "trellis_answer.py",
    ROOT / "scripts" / "parse_pdf.py",
    ROOT / "scripts" / "fixture_mcp_server.py",
    ROOT / "scripts" / "compose_mcp_probe.py",
    ROOT / "scripts" / "bench_wallclock_text.py",
]


def main() -> None:
    for source in PYTHON_FILES:
        py_compile.compile(str(source), doraise=True)

    sys.path.insert(0, str(RLM_DIR))
    for module_name in (
        "neo4j",
        "openai",
        "psycopg2",
        "rlm",
        "mcp",
        # pandas ships transitively via unstructured but is load-bearing
        # for the code-mediated-text pillar (in-REPL frames — pillar §7),
        # so its absence must fail this check, not a paid run.
        "pandas",
        # polars is the pinned engine-side analytics tier (pillar §7
        # postscript; requirements.txt). No kernel or contract path
        # imports it — the pin exists so a broken environment fails this
        # check, not a paid run (the data-plane review, July 11, 2026).
        "polars",
        "unstructured.partition.pdf",
        "trellis_tools",
        "trellis_blocks",
        "trellis_mcp",
        "trellis_workspace",
        "trellis_modules",
        "trellis_textedit",
        "trellis_answer",
        "trellis_agent",
    ):
        importlib.import_module(module_name)

    rubric = RLM_DIR / "trec_rubric.json"
    if not rubric.is_file():
        raise FileNotFoundError(f"Missing runtime asset: {rubric}")

    # The default module selection must be loadable (Session 15): a
    # missing or malformed module #0 breaks every default agent run.
    module0 = ROOT / "modules" / "spatial-flywheel"
    for asset in (module0 / "module.json", module0 / "addendum.txt"):
        if not asset.is_file():
            raise FileNotFoundError(f"Missing runtime asset: {asset}")

    print("Python runtime syntax, imports, rubric, and module assets verified.")


if __name__ == "__main__":
    main()
