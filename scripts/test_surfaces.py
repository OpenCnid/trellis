# Live zero-LLM drill for the surface registry and its coverage
# diagnostic (Workstream B increment 2), run via `npm run test:surfaces`.
# No databases, no network, no paid work: the derivation parses source
# text and the registry is an in-process dict.
#
# What is under test (docs/architecture/SELF_DESCRIBING_SURFACES.md §11
# and §13's ladder table):
#   [1] registration semantics — a name is required because it is the
#       key; ARBITRARY FIELDS ARE ACCEPTED, because field shape is
#       deliberately not validated; identical re-registration is a
#       no-op and a conflicting one raises,
#   [2] derivation — injected names come from the injecting code by AST
#       (dict literal, subscript assignment) and dynamic contributions
#       are NAMED rather than dropped,
#   [3] coverage — described / undescribed / registered-not-injected
#       split, computed against an injected registry so both arms are
#       exercised,
#   [3b] THE WIRED RUNG — which surfaces a run passes to
#       compose_contributions, derived from the composing call by AST in
#       both shapes it can take: a roster drawn from custom_tools itself,
#       and a roster of literal names beside it,
#   [4] the live seam — the real trellis_agent.py parses, the shipped
#       descriptors are found through the real registry, and no finished
#       contribution is left unwired,
#   [5] informs-never-refuses — a gap is a report, never an exception.
#
# `--negative-control` plants thirteen conditions the drill must detect and
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
    derive_wired_names,
    descriptor_for,
    format_coverage,
    register_surface,
    registry,
)
# The one renderer, never a local reimplementation: a drill that composed
# the line itself would be asserting on its own copy of the frame.
from trellis_contribution import render_contribution  # noqa: E402

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

# The three wiring shapes, as source. Each carries the SAME injection
# seam, so the only thing that varies between them is the composing
# call — which is the variable the wired rung reads.
_FIXTURE_INJECTION = '''
def main():
    custom_tools = {
        "alpha_surface": 1,
        "beta_surface": 2,
    }
    custom_tools["gamma_surface"] = 3
'''

# The shape that closes the rung: the roster IS the seam, so a surface
# added above is wired without anyone editing the call below.
FIXTURE_WIRED_SEAM_WIDE = _FIXTURE_INJECTION + '''
    composed = compose_contributions([
        (descriptor_for(name), None)
        for name in custom_tools
    ])
'''

# The shape that produced the defect: a roster of literal names beside
# the seam. alpha is named, beta and gamma are not.
FIXTURE_WIRED_BY_HAND = _FIXTURE_INJECTION + '''
    composed = compose_contributions([
        (descriptor_for("alpha_surface"), derive_alpha_expects(alpha)),
    ])
'''

# The same defect wearing the fixed shape's clothes: a comprehension, but
# over a curated list rather than over the seam. It must NOT read as
# seam-wide, or reverting the fix would be invisible.
FIXTURE_WIRED_CURATED = _FIXTURE_INJECTION + '''
    _ROSTER = ["alpha_surface"]
    composed = compose_contributions([
        (descriptor_for(name), None)
        for name in _ROSTER
    ])
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
print("\n[3] coverage: described / undescribed / registered-not-injected")

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
check("a descriptor for something never injected is named as such",
      gapped["registered_not_injected"] == ["ghost_surface"],
      str(gapped["registered_not_injected"]))
check("the render names each gap and states that it refuses nothing",
      "beta_surface" in format_coverage(gapped)
      and "refuses nothing" in format_coverage(gapped))

# --- 3b. The wired rung ----------------------------------------------------
print("\n[3b] the wired rung: what the composing call actually draws from")

# The rung the previous version of this drill declared uncheckable from
# here, and the one the whole ladder is for. A surface can be registered
# and can carry a finished line and still reach no model, because whether
# a run passes it to compose_contributions is a third claim (AMBIENT.md
# rule 15 one level down: a named caller is what establishes reachability,
# and neither earlier rung is one).
#
# It is checkable because the composing call is in the same file as the
# injection seam and yields to the same AST read. What the read settles is
# WHAT THE ROSTER IS DRAWN FROM, which is the property, rather than which
# names appear today, which is a count that moves every time a surface
# lands.
seam_wide = write_fixture(FIXTURE_WIRED_SEAM_WIDE)
by_hand = write_fixture(FIXTURE_WIRED_BY_HAND)
curated = write_fixture(FIXTURE_WIRED_CURATED)

wide_names, wide_flag, wide_sources = derive_wired_names(seam_wide)
check("a roster drawn from custom_tools itself reads as seam-wide",
      wide_flag is True, f"{wide_names} {wide_flag} {wide_sources}")

hand_names, hand_flag, _hand_sources = derive_wired_names(by_hand)
check("a roster of literal names does NOT read as seam-wide",
      hand_flag is False, str(hand_flag))
check("the literally named surfaces are derived, never assumed",
      hand_names == ["alpha_surface"], str(hand_names))

curated_names, curated_flag, curated_sources = derive_wired_names(curated)
check("a comprehension over a curated list is NOT seam-wide either",
      curated_flag is False, str(curated_flag))
check("and the list it draws from is NAMED rather than dropped",
      "_ROSTER" in curated_sources, str(curated_sources))

no_call = write_fixture(FIXTURE_SEAM)
check("a seam with no composing call wires nothing",
      derive_wired_names(no_call) == ([], False, []),
      str(derive_wired_names(no_call)))

# The gap set, over a registry where all three surfaces carry a line.
_three = {n: {"name": n, "contributes": ["x"]}
          for n in ("alpha_surface", "beta_surface", "gamma_surface")}
check("a hand roster leaves the surfaces it forgot NAMED, not counted",
      coverage_report(by_hand, _three)["contributing_unwired"]
      == ["beta_surface", "gamma_surface"],
      str(coverage_report(by_hand, _three)["contributing_unwired"]))
check("a seam-wide roster leaves nothing unwired",
      coverage_report(seam_wide, _three)["contributing_unwired"] == [])
check("a curated roster the read cannot enumerate reports unwired, not wired",
      coverage_report(curated, _three)["contributing_unwired"]
      == ["alpha_surface", "beta_surface", "gamma_surface"],
      str(coverage_report(curated, _three)["contributing_unwired"]))
check("a surface with no line is not counted at the wired rung",
      coverage_report(by_hand, {"beta_surface": {"name": "beta_surface"}})
      ["contributing_unwired"] == [])
check("the render names the surfaces a hand roster left out",
      "beta_surface" in format_coverage(coverage_report(by_hand, _three))
      .split("CONTRIBUTES BUT IS NOT WIRED")[-1])

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
# The ladder has three rungs: a name is REGISTERED, a registered
# descriptor may carry a CONTRIBUTION, and a contribution reaches a model
# only once it is WIRED into the custom_tools seam. Each is a separate
# claim and the earlier ones do not establish the later (AMBIENT.md
# rule 15, applied inside one mechanism).
#
# RETIRED July 25, 2026, one pass after it was written: this slot held
# "the ladder narrows — fewer contribute than are described", which was
# honest scope while the work was half-done and became false the moment
# it was finished. Its successor is not a narrower version of the same
# claim but the opposite one: the ladder is now FLAT at the first two
# rungs, and flatness is the property worth holding, because it is what
# a later pass would break by adding a surface and forgetting its line.
#
# A pin that can only say "not yet" cannot notice completion. This one
# goes red on the regression rather than on the progress.
_described = set(live["described"])
_contributing = {name for name, descriptor in registry().items()
                 if "contributes" in descriptor}
_silent = sorted(_described - _contributing)
check("every described surface contributes a line — the ladder is flat here",
      _silent == [],
      f"described but silent in the listing: {_silent}")

# THE THIRD RUNG, which the line above does not establish.
#
# RETIRED July 25, 2026: the comment standing here said the wired rung
# "is not checkable from here", on the reasoning that the seam iterates
# custom_tools rather than a list this drill could compare against. That
# reasoning had the derivation backwards. What the seam iterates is not
# an obstacle to reading the rung — it IS the rung, and it yields to the
# same AST read that already gives this drill its injected roster. The
# sentence was written one pass after a seam that named two surfaces by
# hand shipped eleven finished lines to no model, which is precisely the
# state a readable wired rung would have shown.
#
# THE PROPERTY HELD: no surface carries a contribution that the composing
# call leaves out. Two shapes satisfy it and the check reads both — a
# roster drawn from custom_tools itself, where nothing per-surface is
# left to forget, and a literal roster that happens to cover every
# contributing surface. The property is the coverage, never the
# mechanism, so a future seam that closes it a third way stays green.
#
# WHY NOT A COUNT. "as many wired as contribute" passes on a rename that
# drops one surface and adds another, which is the same size and the
# wrong set. The set difference is computed and its MEMBERS are what the
# failure prints, because the repair needs the names.
#
# WHY THE SET IS SCOPED TO CONTRIBUTING SURFACES rather than to every
# injected one: UPSUM_BUDGET is a bare int deliberately declined a
# descriptor, and a check that reddened on it would be reddening on an
# honest state and would be switched off. A surface with no line has
# nothing at this rung.
#
# WHY IT IS NOT VACUOUS: it is paired below with a positive on the
# contributing rung. An empty contributing set — a renamed field, a
# missing import — would otherwise satisfy an empty difference and read
# exactly like a closed rung.
#
# Direction: `attach_contributions` already RAISES at runtime on a line
# composed for a surface the run does not inject. This holds the other
# direction, which nothing held: a surface injected with a finished line
# that the composing call never reaches. Between them both are covered.
check("the contributing rung is non-empty, so the wired check can fail",
      live["contributing"] != [], "no descriptor carries a contribution at all")
_orphaned = live["contributing_unwired"]
check("no surface carries a line the composing call leaves out",
      _orphaned == [],
      f"finished contribution(s) no run passes on: {_orphaned}")

# A check over the WHOLE registry belongs to neither rung and was tried
# here first: section 1 registers fixture descriptors to exercise the
# no-field-validation property, so the registry at this point is the live
# surfaces plus this drill's own scaffolding, and a sweep over it reports
# the fixtures as gaps. Scoping to `contributes` is what keeps those
# fixtures out — none of them carries one. The staged helpers are held by
# their own roster pin in scripts/test_scaffold_unit.py, which checks the
# stronger direction — that the descriptor roster names exactly the
# helpers the factory injects, so a sixth helper added without one goes
# red there.
# RETIRED July 25, 2026: this slot pinned
#
#   check("trellis_textedit contributes via its addendum, not the one-line slot",
#         "contributes" not in registry().get("trellis_textedit", {}), ...)
#
# on the reasoning that one line is an orienting line, and a surface
# whose guard-backed expectations run to several sentences carries them
# in its addendum instead of truncating them to fit. That reasoning
# conflated two claims. The first stands and is carried below: the
# expectations belong in the addendum, and not one of them is in the
# slot. The second does not — declining the slot did not leave it empty,
# because rlms fills an undescribed surface with "A custom
# TrellisTextEdit value", so the surface spent its line in the
# highest-primacy text a run sees saying a type name. Retired
# deliberately with its successor rather than patched, because the claim
# changed (the increment-2 precedent above).
#
# The successor holds the property the old one only reached by proxy:
# the one-line slot carries NO guard-backed expectation. Absence of a
# contribution was one way to satisfy that and never the only one, so
# the old assertion read the same on a surface that says nothing and on
# a surface that orients without stating a bound — it could not tell
# them apart, and it called the first one correct. This one forecloses
# the failure the original comment named — a later pass cramming a bound
# into the slot — and it is the ONLY thing it forecloses, so the surface
# stays free to say what it is. Held from both sides: the line exists,
# and no guard-owned phrase is in it.
#
# The derived expectations are passed even though the composition has no
# ("expects", ...) slot today. That is the point: an expects slot added
# later would resolve to its guard phrase and turn this check red, which
# a None here would silently let through as a shape error instead.
_textedit_descriptor = registry()["trellis_textedit"]
_textedit_line = render_contribution(
    _textedit_descriptor,
    trellis_textedit.derive_textedit_expects(None))
check("trellis_textedit orients in the one-line slot",
      _textedit_line != "", "the slot renders as a bare type name when empty")
check("trellis_textedit's one-line slot states no guard-backed expectation",
      not any(phrase in _textedit_line
              for phrase in trellis_textedit._TEXTEDIT_GUARD_EXPECTS.values()),
      f"a guard phrase reached the slot: {_textedit_line!r}")

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
    planted("a stale registration appears as not injected",
            coverage_report(seam, {"gone": {"name": "gone"}})
            ["registered_not_injected"] == ["gone"])
    planted("a new subscript injection is derived",
            "gamma_surface" in derive_injected_names(seam)[0])
    planted("a new dict-literal key is derived",
            "alpha_surface" in derive_injected_names(seam)[0])
    planted("an update() contribution is named",
            "staged_helpers" in derive_injected_names(seam)[1])

    # The wired rung. Every plant here is a way the 2-of-13 state comes
    # back — a roster beside the seam, a roster the read cannot settle,
    # or no roster at all — and the drill must name the surfaces left
    # out rather than report a closed rung.
    lines_for_all = {n: {"name": n, "contributes": ["x"]}
                     for n in ("alpha_surface", "beta_surface", "gamma_surface")}
    hand = write_fixture(FIXTURE_WIRED_BY_HAND)
    wide = write_fixture(FIXTURE_WIRED_SEAM_WIDE)
    curated_seam = write_fixture(FIXTURE_WIRED_CURATED)
    planted("a hand roster leaves the surfaces it forgot named",
            coverage_report(hand, lines_for_all)["contributing_unwired"]
            == ["beta_surface", "gamma_surface"])
    planted("a hand roster does not read as seam-wide",
            derive_wired_names(hand)[1] is False)
    planted("a roster over a curated list does not read as seam-wide",
            derive_wired_names(curated_seam)[1] is False)
    planted("an unenumerable roster reports unwired rather than wired",
            coverage_report(curated_seam, lines_for_all)["contributing_unwired"]
            == ["alpha_surface", "beta_surface", "gamma_surface"])
    planted("a deleted composing call leaves every line unwired",
            coverage_report(seam, lines_for_all)["contributing_unwired"]
            == ["alpha_surface", "beta_surface", "gamma_surface"])
    planted("a roster drawn from the seam itself is recognised as closing it",
            derive_wired_names(wide)[1] is True
            and coverage_report(wide, lines_for_all)["contributing_unwired"] == [])
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
