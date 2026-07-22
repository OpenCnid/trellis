"""Pytest bootstrap: put `src/` on the import path.

The REPL-sandbox package is imported as `repl_sandbox` from `src/repl_sandbox`,
matching how `src/rlm/*.py` is already spawned with `PYTHONPATH` pointed at the
repo. This file exists so `python -m pytest` works from a bare checkout without
an install step.
"""

import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))
