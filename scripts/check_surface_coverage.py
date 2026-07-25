# The surface-descriptor coverage diagnostic — the operator-facing half
# of Workstream B increment 2 (docs/architecture/SELF_DESCRIBING_SURFACES.md
# §11, the owner ruling: coverage is the enforced property, field shape is
# not; the diagnostic informs and never refuses).
#
# Run it with `npm run check:surfaces`. It answers ONE question — which
# surfaces the agent injects into the REPL namespace carry a descriptor,
# and which do not — by deriving the injected names from the injecting
# code itself, so the roster cannot drift from the seam.
#
# EXIT CODES, and why they are not a gate. 0 when every injected surface
# is described, 1 when gaps remain, 2 on an internal error. This mirrors
# `npm run wiki:check`, whose staleness half is deliberately NOT wired
# into CI: a report that reddens every honest in-progress branch gets
# switched off, and gaps here are expected while the program is mid-build.
# Nothing in a run consults this, and no gate reads it (Phase 4 stays
# owner-gated, HARNESS_SELF_MODEL.md §12.2).
#
# Zero-paid, no database, no network: it parses one file and reads a
# registry populated by importing the surface modules.

import os
import sys

_RLM = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "rlm")
sys.path.insert(0, _RLM)

from trellis_surfaces import coverage_report, format_coverage  # noqa: E402

# Importing a surface module is what registers its descriptor (one call
# site, one commitment). Every module holding a registered surface must
# be imported here, or its descriptor is invisible to the report — which
# would make the diagnostic under-report rather than over-report, so the
# import list is part of the check, not incidental to it.
import trellis_textedit  # noqa: E402,F401
import trellis_tools  # noqa: E402,F401
import trellis_workspace  # noqa: E402,F401
import trellis_answer  # noqa: E402,F401
import trellis_scaffold  # noqa: E402,F401

try:  # trellis_mcp is import-light but keep the roster honest if it moves
    import trellis_mcp  # noqa: E402,F401
except Exception as _exc:  # noqa: BLE001
    print(f"surface coverage: WARNING — trellis_mcp did not import ({_exc});"
          " its descriptor, if any, is invisible to this report.", flush=True)


def main():
    try:
        report = coverage_report()
    except Exception as exc:  # noqa: BLE001
        print(f"surface coverage: ERROR — {exc}", flush=True)
        return 2
    print(format_coverage(report), flush=True)
    return 1 if report["undescribed"] else 0


if __name__ == "__main__":
    sys.exit(main())
