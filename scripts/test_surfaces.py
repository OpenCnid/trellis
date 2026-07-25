# Live zero-LLM drill for the surface registry and its coverage
# diagnostic (Workstream B increment 2), run via `npm run test:surfaces`.
# No databases, no network, no paid work: the derivation parses source
# text and the registry is an in-process dict.
#
# What is under test (docs/architecture/SELF_DESCRIBING_SURFACES.md §11):
#   [1] registration semantics — a name is required because it is the
#       key; ARBITRARY FIELDS ARE ACCEPTED, because field shape is
#       deliberately not validated; identical re-registration is a
#       no-op and a conflicting one raises,
#   [2] derivation — injected names come from the injecting code by AST
#       (dict literal, subscript assignment) and dynamic contributions
#       are NAMED rather than dropped,
#   [3] coverage — described / undescribed / unwired split, computed
#       against an injected registry so both arms are exercised,
#   [4] the live seam — the real trellis_agent.py parses, and the one
#       shipped descriptor is found through the real registry,
#   [5] informs-never-refuses — a gap is a report, never an exception.
#
# `--negative-control` plants seven conditions the drill must detect and
# exits 3 when every one is caught (the check:repo-surface and judge-drill
# mold, rule 19(c)): a check that has never been seen to fail carries no
# information.

import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "rlm"))
import trellis_surfaces  # noqa: E402
from trellis_surfaces import (  # noqa: E402
    coverage_report,
    derive_injected_names,
    descriptor_for,
    format_coverage,
    register_surface,
    registry,
)

failures = 0
temp_paths = []


def check(name, ok, detail=""):
    global failures
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail and not ok else ""))
    if not ok:
        failures += 1


def expect_raises(name, fn, needle=""):
    try:
        fn()
        check(name, False, "expected ValueError, nothing raised")
    except ValueError as e:
        check(name, needle.lower() in str(e).lower(), f"message lacked {needle!r}: {e}")
    except Exception as e:  # noqa: BLE001
        check(name, False, f"expected ValueError, got {type(e).__name__}: {e}")


def write_fixture(text):
    handle, path = tempfile.mkstemp(prefix="trellis-surfaces-drill-", suffix=".py")
    with os.fdopen(handle, "w", encoding="utf-8") as f:
        f.write(text)
    temp_paths.append(path)
    return path


# A stand-in for the agent's seam: every static form the real one uses.
FIXTURE_SEAM = '''
def main():
    custom_tools = {
        "alpha_surface": 1,
        "beta_surface": 2,
    }
    if flag:
        custom_tools["gamma_surface"] = 3
    custom_tools.update(staged_helpers)


def author():
    custom_tools = build_author_tools(workspace)
'''


# --- 1. Registration semantics ---------------------------------------------
print("\n[1] registration: a key is required, a field set is not")

alpha = register_surface({"name": "alpha_surface", "purpose": "a"})
check("a descriptor registers and is returned for inline use",
      alpha == {"name": "alpha_surface", "purpose": "a"}
      and descriptor_for("alpha_surface") is alpha)

# THE §11 PROPERTY: no field validation. A descriptor carrying fields no
# spec ever named must register, because a vocabulary that became law
# early could not survive the iteration prompt authoring requires.
odd = register_surface({"name": "odd_surface", "invented_field": [1, 2],
                        "another": {"nested": True}})
check("arbitrary fields register — field shape is NOT validated",
      descriptor_for("odd_surface") is odd)
check("a descriptor carrying ONLY a name registers",
      register_surface({"name": "bare_surface"})["name"] == "bare_surface")

expect_raises("a nameless descriptor refuses (no key to register under)",
              lambda: register_surface({"purpose": "x"}), "non-empty string 'name'")
expect_raises("a blank name refuses",
              lambda: register_surface({"name": "   "}), "non-empty string 'name'")
expect_raises("a non-dict descriptor refuses",
              lambda: register_surface(["name"]), "must be a dict")

check("re-registering an identical descriptor is a no-op (re-import safe)",
      register_surface({"name": "alpha_surface", "purpose": "a"}) is not None
      and descriptor_for("alpha_surface")["purpose"] == "a")
expect_raises("two surfaces claiming one name refuses",
              lambda: register_surface({"name": "alpha_surface", "purpose": "DIFFERENT"}),
              "already registered")

# --- 2. Derivation from the injecting code ---------------------------------
print("\n[2] derivation: names come from the code that injects them")

fixture = write_fixture(FIXTURE_SEAM)
names, dynamic = derive_injected_names(fixture)
check("dict-literal keys are derived",
      "alpha_surface" in names and "beta_surface" in names)
check("subscript assignments are derived", "gamma_surface" in names)
check("the derived roster is exactly the static names, sorted",
      names == ["alpha_surface", "beta_surface", "gamma_surface"], str(names))
check("dynamic contributions are NAMED, never silently dropped",
      dynamic == ["build_author_tools", "staged_helpers"], str(dynamic))

# --- 3. Coverage over an injected registry ---------------------------------
print("\n[3] coverage: described / undescribed / unwired")

full = {n: {"name": n} for n in ("alpha_surface", "beta_surface", "gamma_surface")}
covered = coverage_report(fixture, full)
check("every injected surface described means no gaps",
      covered["undescribed"] == [] and len(covered["described"]) == 3)

partial = {"alpha_surface": {"name": "alpha_surface"},
           "ghost_surface": {"name": "ghost_surface"}}
gapped = coverage_report(fixture, partial)
check("an undescribed surface is named",
      gapped["undescribed"] == ["beta_surface", "gamma_surface"],
      str(gapped["undescribed"]))
check("a descriptor for something never injected shows as unwired",
      gapped["unwired"] == ["ghost_surface"], str(gapped["unwired"]))
check("the render names each gap and states that it refuses nothing",
      "beta_surface" in format_coverage(gapped)
      and "refuses nothing" in format_coverage(gapped))

# --- 4. The live seam ------------------------------------------------------
print("\n[4] the live seam parses and finds the shipped descriptor")

import trellis_textedit  # noqa: E402,F401  (importing is what registers)
# July 25, 2026: the roster of modules holding descriptors is itself a
# hand-kept list — the one list this diagnostic does not derive. It is
# kept here beside the report it feeds so a missing import shows up as
# an under-count in the same file that asserts on the count.
import trellis_tools  # noqa: E402,F401
import trellis_workspace  # noqa: E402,F401
import trellis_mcp  # noqa: E402,F401
import trellis_answer  # noqa: E402,F401
import trellis_scaffold  # noqa: E402,F401

live_names, live_dynamic = derive_injected_names()
check("the real agent seam parses and yields surfaces", len(live_names) >= 5,
      str(live_names))
check("the kernel surfaces are derived, not asserted",
      {"trellis_neo4j", "trellis_postgres", "trellis_answer",
       "trellis_textedit"} <= set(live_names), str(live_names))
check("the staged-helper seam is named as unenumerable",
      "scaffold_helpers" in live_dynamic, str(live_dynamic))

live = coverage_report()
check("the one shipped descriptor is found through the live registry",
      "trellis_textedit" in live["described"], str(live["described"]))
check("registry() reports the textedit descriptor by name",
      registry().get("trellis_textedit", {}).get("name") == "trellis_textedit")
# Honest scope, pinned so it cannot be quietly overstated later.
#
# RETIRED July 25, 2026: this slot pinned "most injected surfaces are
# still undescribed", which was true at increment 2 and is false now —
# 8 of 9 carry a descriptor, and the 9th (UPSUM_BUDGET) is a bare int
# deliberately declined rather than a gap. It was passing for the wrong
# reason: the drill imported one surface module, so it measured its own
# narrow view rather than the tree. Retired deliberately with its
# successor below rather than patched, because the claim changed.
#
# The successor is the ladder, and the honest scope is that it narrows
# at every rung: a name is REGISTERED, a registered descriptor may carry
# a CONTRIBUTION, and a contribution reaches a model only once it is
# WIRED into the custom_tools seam. Each step is a separate claim and
# the earlier ones do not establish the later ones (AMBIENT.md rule 15,
# applied inside one mechanism). A session that grows the first count
# and reports progress has moved the number this pin exists to
# distinguish from the one that matters.
_described = set(live["described"])
_contributing = {name for name, descriptor in registry().items()
                 if "contributes" in descriptor}
check("FINDING pinned: the ladder narrows — fewer contribute than are described",
      len(_contributing & _described) < len(_described),
      f"described={sorted(_described)} contributing={sorted(_contributing)}")
# trellis_textedit carries no contribution ON PURPOSE, and its absence is
# the honest half of the design rather than an omission: one line is an
# orienting line, and a surface whose guard-backed expectations run to
# several sentences carries them in its addendum instead of truncating
# them to fit (trellis_contribution.py, "WHAT THE SLOT CAN AND CANNOT
# CARRY"). Pinned so a later pass does not "fix" it by cramming.
check("trellis_textedit contributes via its addendum, not the one-line slot",
      "contributes" not in registry().get("trellis_textedit", {}),
      "textedit's expectations are addendum-carried by design")

# --- 5. Informs, never refuses ---------------------------------------------
print("\n[5] the diagnostic informs and refuses nothing")

check("a fully uncovered seam still returns a report rather than raising",
      coverage_report(fixture, {})["undescribed"] == [
          "alpha_surface", "beta_surface", "gamma_surface"])
check("an empty seam is a report, not an error",
      coverage_report(write_fixture("x = 1\n"), {})["injected"] == [])


# --- negative control ------------------------------------------------------
def negative_control():
    """Plant conditions this drill must detect; healthy is exit 3."""
    print("\n[negative control] planting conditions the drill must catch")
    caught = []

    def planted(label, ok):
        print(f"  [{'CAUGHT' if ok else 'MISSED'}] {label}")
        caught.append(ok)

    seam = write_fixture(FIXTURE_SEAM)
    planted("a missing descriptor appears as undescribed",
            "beta_surface" in coverage_report(seam, {})["undescribed"])
    planted("a stale registration appears as unwired",
            coverage_report(seam, {"gone": {"name": "gone"}})["unwired"] == ["gone"])
    planted("a new subscript injection is derived",
            "gamma_surface" in derive_injected_names(seam)[0])
    planted("a new dict-literal key is derived",
            "alpha_surface" in derive_injected_names(seam)[0])
    planted("an update() contribution is named",
            "staged_helpers" in derive_injected_names(seam)[1])
    try:
        register_surface({"purpose": "no name"})
        planted("a nameless descriptor raises", False)
    except ValueError:
        planted("a nameless descriptor raises", True)
    try:
        register_surface({"name": "alpha_surface", "purpose": "conflict"})
        planted("a name collision raises", False)
    except ValueError:
        planted("a name collision raises", True)

    total = len(caught)
    detected = sum(1 for c in caught if c)
    print(f"\n{detected}/{total} planted conditions detected.")
    return 3 if detected == total else 1


if __name__ == "__main__":
    try:
        if "--negative-control" in sys.argv:
            code = negative_control()
        elif failures:
            print(f"\n{failures} check(s) failed.")
            code = 1
        else:
            print("\nAll surface registry checks passed.")
            code = 0
    finally:
        for stale in temp_paths:
            try:
                os.unlink(stale)
            except OSError:
                pass
    sys.exit(code)
