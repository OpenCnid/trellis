# The surface-descriptor coverage diagnostic — the operator-facing half
# of Workstream B increment 2 (docs/architecture/SELF_DESCRIBING_SURFACES.md
# §11, the owner ruling: coverage is the enforced property, field shape is
# not; the diagnostic informs and never refuses).
#
# Run it with `npm run check:surfaces`. It walks the LADDER — registered,
# contributes, wired — for every surface the agent injects into the REPL
# namespace, deriving both the injected roster and the wired roster from
# the injecting and composing code itself, so neither can drift from the
# seam.
#
# WHY ALL THREE RUNGS AND NOT THE FIRST. This check used to report
# registration alone. It read "8 of 9 injected surfaces carry a
# descriptor" at a moment when eleven of thirteen finished description
# lines were reaching no model at all, because the composing call named
# two surfaces by hand. The number was true and answered the easy
# question; the rung that decides whether a model ever sees the bytes was
# the one nothing reported. A report that measures the cheap rung makes
# the expensive gap look measured, which is worse than reporting nothing.
#
# EXIT CODES, and why they are not a gate. 1 names a gap nobody has
# decided about, 2 an internal error, 0 everything else. This mirrors
# `npm run wiki:check`, whose staleness half is deliberately NOT wired
# into CI: a report that reddens every honest in-progress branch gets
# switched off, and gaps here are expected while the program is mid-build.
# Nothing in a run consults this, and no gate reads it (Phase 4 stays
# owner-gated, HARNESS_SELF_MODEL.md §12.2). Every rung joins the exit
# code on the same terms it joins the report: advisory, and out of CI, so
# an in-progress branch is described rather than blocked.
#
# WHAT 1 MEANT UNTIL NOW, AND WHY IT WAS WORTH NOTHING. It counted
# UPSUM_BUDGET — a bare int declined a descriptor on purpose
# (SELF_DESCRIBING_SURFACES.md §13) — as an undescribed surface, so the
# check exited 1 on a clean tree and had exited 1 on every tree since the
# rung shipped. A code that is already 1 cannot go to 1, so the one thing
# an exit code is for was spent: a real gap arriving changed nothing a
# caller could read, and the report had to be read by eye to find it,
# which is what a report is for and not what a status is for.
# `trellis_surfaces.DECLINED` records that judgment where the derivation
# can subtract it, and the roster is held honest from both sides — a
# declination for a name the seam stopped injecting, or for a name that
# has since registered a descriptor, is itself one of the conditions
# below. So 0 now means "no undecided gap", 1 means "something here has
# not been decided about", and the difference between them is a fact
# rather than a constant.
#
# THE SEVEN CONDITIONS 1 REPORTS, each a state a model would be affected
# by and nobody chose:
#   * gaps                    — an injected surface with no descriptor and
#                               no recorded declination,
#   * contributing_unwired    — a finished line the composing call omits,
#   * delivery not delivered  — composed lines that reach no model at all,
#                               answered per composing seam and true only
#                               when every run mode delivers,
#   * rendering_without_composing
#                             — a whole run mode handing rlms a seam it
#                               composed nothing for, so its surfaces
#                               reach their model as type names,
#   * expects_unsupplied      — a slot with no supplier, which ends the
#                               run at composition rather than at the line,
#   * declined_not_injected   — a dead exemption still able to cover a
#                               future surface that takes the name,
#   * declined_but_described  — an exemption contradicted by the registry.
#
# WHY THE FOURTH JOINED. Until July 25, 2026 the file held one run mode
# that composed and one that did not, and every condition above was blind
# to the second: its surfaces arrive through a factory, so nothing counts
# them; it owns no composing call, so no rung reads it; and its delivery
# answer did not exist to be false. A status that cannot go to 1 on a
# whole undescribed run mode is the same spent code this header already
# describes, one level up from the surface it describes it at.
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
    undecided = (report["gaps"]
                 or report["contributing_unwired"]
                 or report["expects_unsupplied"]
                 or report["declined_not_injected"]
                 or report["declined_but_described"]
                 or report["delivery"]["rendering_without_composing"]
                 or not report["delivery"]["delivered"])
    return 1 if undecided else 0


if __name__ == "__main__":
    sys.exit(main())
