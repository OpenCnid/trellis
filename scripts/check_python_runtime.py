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
    RLM_DIR / "trellis_mcp.py",
    ROOT / "scripts" / "parse_pdf.py",
    ROOT / "scripts" / "fixture_mcp_server.py",
    ROOT / "scripts" / "compose_mcp_probe.py",
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
        "unstructured.partition.pdf",
        "trellis_tools",
        "trellis_mcp",
        "trellis_agent",
    ):
        importlib.import_module(module_name)

    rubric = RLM_DIR / "trec_rubric.json"
    if not rubric.is_file():
        raise FileNotFoundError(f"Missing runtime asset: {rubric}")

    print("Python runtime syntax, imports, and rubric asset verified.")


if __name__ == "__main__":
    main()
