# The contribution-frame drill.
#
# `src/rlm/trellis_contribution.py` composes the one line rlms reserves per
# injected surface, and its refusals are the safety property: a brace reaching
# rlms fails as a KeyError inside .format(), and a newline breaks the
# one-line-per-surface listing into an orphan line the model reads as a
# directive of its own. Both fail at runtime, in a paid run, silently at the
# point they matter.
#
# The module shipped with a docstring asserting this drill existed. It did not
# — the session that wrote the module ended before the drill — so every refusal
# below was unexercised until this file. That is the failure this drill closes
# and the reason it is written against the module's guards rather than against
# any surface's data.
#
# `--negative-control` plants eleven conditions the drill must detect, and exits
# 3 when every one of them is caught (rule 19(c)).
#
# Zero-paid: no model, no database, no network, no filesystem write.

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "rlm"))

from trellis_contribution import (  # noqa: E402
    CONTRIBUTES_FIELD,
    CONTRIBUTION_BUDGET,
    ContributionBudgetError,
    ContributionShapeError,
    attach_contributions,
    compose_contributions,
    measure_contributions,
    render_contribution,
)

# ORIENTING LENGTH, per line — a STATED engineering target (rule 20: a session
# that finds no target stated states one before choosing the shape of a test).
#
# What the target says. The slot rlms reserves takes ONE ORIENTING line: what
# the surface is, and when to reach for it. A surface whose account runs longer
# carries it on the addendum path instead — trellis_contribution.py, "WHAT THE
# SLOT CAN AND CANNOT CARRY" — so a line past this ceiling is not a long line,
# it is an account in the wrong place. 160 characters forecloses the two
# instances that produced the rule: the first pass's two full write-ups, at 361
# and 461 characters.
#
# Why it is not a share of the budget. This replaces `CONTRIBUTION_BUDGET // 13`,
# hard-coded here and in four sibling drills. Thirteen was the count of surfaces
# carrying a contribution the day it was written — an instance that reached five
# checks and became their denominator (COMPOSITION_FROM_PRIMITIVES.md §7, the
# plural test: a fourteenth surface would need the constant edited in five
# places, so thirteen was never a frame). A fourteenth surface LOOSENED all five
# at once: fourteen lines at the stale 153 sum to 2,142, past the 2,000-character
# budget, with every per-surface check still green. This target is a property of
# ONE line, so no surface count enters it and a fourteenth neither raises nor
# lowers it.
#
# The whole-composition bound is a separate check and stays the engine's own:
# compose_contributions refuses over CONTRIBUTION_BUDGET, and [7] below exercises
# that refusal over EVERY registered contribution rather than a hand-named pair.
# The pair covers the space — the sum is bounded by the budget the surfaces share,
# and no single line is allowed to become an account inside it.
ORIENTING_LINE_MAX = 160

failures = 0


def check(name, ok, detail=""):
    global failures
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail and not ok else ""))
    if not ok:
        failures += 1


def expect_shape(name, fn, needle=""):
    try:
        fn()
        check(name, False, "expected ContributionShapeError, nothing raised")
    except ContributionShapeError as e:
        check(name, needle.lower() in str(e).lower(), f"message lacked {needle!r}: {e}")
    except Exception as e:  # noqa: BLE001
        check(name, False, f"raised {type(e).__name__} instead: {e}")


def d(**fields):
    """A descriptor with only what a case needs. The registry validates no
    field set (SELF_DESCRIBING_SURFACES.md section 11), so neither does this."""
    base = {"name": "a_surface"}
    base.update(fields)
    return base


print("\n[1] the line the slot can take")

check("a descriptor with no contribution field renders nothing",
      render_contribution(d(purpose="x")) == "")
check("an absent descriptor renders nothing",
      render_contribution(None) == "")
check("editorial text is taken verbatim",
      render_contribution(d(**{CONTRIBUTES_FIELD: ["plain words"]})) == "plain words")
check("a descriptor slot pulls the descriptor's own field",
      render_contribution(d(purpose="the purpose",
                            **{CONTRIBUTES_FIELD: [("descriptor", "purpose")]}))
      == "the purpose")
check("an expects slot pulls the derived phrase",
      render_contribution(d(**{CONTRIBUTES_FIELD: [("expects", "k")]}),
                          {"k": "derived"}) == "derived")
check("pieces join with the empty string, so the frame adds no prose",
      render_contribution(d(**{CONTRIBUTES_FIELD: ["a", "b"]})) == "ab")
check("an empty derived phrase costs zero bytes",
      render_contribution(d(**{CONTRIBUTES_FIELD: ["a", ("expects", "k")]}),
                          {"k": ""}) == "a")

print("\n[2] what the slot refuses")

expect_shape("a literal brace is refused, never doubled",
             lambda: render_contribution(d(**{CONTRIBUTES_FIELD: ["a {brace}"]})), "brace")
expect_shape("a closing brace is refused too",
             lambda: render_contribution(d(**{CONTRIBUTES_FIELD: ["a } here"]})), "brace")
expect_shape("a newline is refused",
             lambda: render_contribution(d(**{CONTRIBUTES_FIELD: ["a\nb"]})), "newline")
expect_shape("a carriage return is refused",
             lambda: render_contribution(d(**{CONTRIBUTES_FIELD: ["a\rb"]})),
             "carriage return")
expect_shape("an empty contribution is refused rather than claiming a slot",
             lambda: render_contribution(d(**{CONTRIBUTES_FIELD: [""]})), "empty")
expect_shape("boundary whitespace is refused",
             lambda: render_contribution(d(**{CONTRIBUTES_FIELD: ["trailing "]})), "whitespace")
expect_shape("an empty contributes list is refused",
             lambda: render_contribution(d(**{CONTRIBUTES_FIELD: []})), "empty")
expect_shape("a contributes field that is not a list is refused",
             lambda: render_contribution(d(**{CONTRIBUTES_FIELD: "a string"})), "ordered list")
expect_shape("a nameless descriptor cannot contribute",
             lambda: render_contribution({CONTRIBUTES_FIELD: ["x"]}), "name")

print("\n[3] a slot that points at nothing is a hole, and is refused")

expect_shape("an unknown tag is refused",
             lambda: render_contribution(d(**{CONTRIBUTES_FIELD: [("table", "servers")]})),
             "either editorial text")
expect_shape("an expects slot with no derived mapping is refused",
             lambda: render_contribution(d(**{CONTRIBUTES_FIELD: [("expects", "k")]})),
             "no derived expectations")
expect_shape("an expects slot naming an absent phrase is refused",
             lambda: render_contribution(d(**{CONTRIBUTES_FIELD: [("expects", "gone")]}),
                                         {"other": "x"}), "do not carry")
expect_shape("a descriptor slot naming an absent field is refused",
             lambda: render_contribution(d(**{CONTRIBUTES_FIELD: [("descriptor", "gone")]})),
             "does not carry")
expect_shape("a non-string derived value is refused",
             lambda: render_contribution(d(**{CONTRIBUTES_FIELD: [("expects", "k")]}),
                                         {"k": True}), "not a string")

print("\n[4] the budget raises rather than being hoped for")

small = d(name="s", **{CONTRIBUTES_FIELD: ["x" * 40]})
composed = compose_contributions([(small, None)], budget=100)
check("a composition under budget returns its lines",
      composed["s"] == "x" * 40)

big_a = d(name="a", **{CONTRIBUTES_FIELD: ["x" * 80]})
big_b = d(name="b", **{CONTRIBUTES_FIELD: ["y" * 40]})
try:
    compose_contributions([(big_a, None), (big_b, None)], budget=100)
    check("an over-budget composition is refused", False, "nothing raised")
except ContributionBudgetError as e:
    msg = str(e)
    check("an over-budget composition is refused", True)
    check("the refusal carries the measured size", "120" in msg, msg)
    check("the refusal carries the budget", "100" in msg, msg)
    check("the refusal names the surfaces largest first",
          msg.index("'a'") < msg.index("'b'") if "'a'" in msg and "'b'" in msg
          else ("a" in msg and "b" in msg), msg)

measured = measure_contributions([(big_a, None), (big_b, None)], budget=100)
check("measure reports without refusing", measured["total"] == 120)
check("measure reports the overage", measured["headroom"] == -20, str(measured))
check("measure ranks per surface", measured["perSurface"] == {"a": 80, "b": 40}, str(measured))

print("\n[5] absence costs zero bytes")

check("a surface this run did not inject is skipped",
      compose_contributions([(None, None), (small, None)]) == {"s": "x" * 40})
check("a descriptor with no contribution is skipped",
      compose_contributions([(d(name="q", purpose="p"), None)]) == {})

tools = {"alpha": object(), "beta": object()}
same = attach_contributions(tools, {})
check("no contributions leaves every entry the bare value it was",
      all(same[k] is tools[k] for k in tools))
check("attach does not mutate its input",
      all(not isinstance(v, dict) for v in tools.values()))

wired = attach_contributions(tools, {"alpha": "a line"})
check("a described surface becomes the rlms tool-plus-description entry",
      isinstance(wired["alpha"], dict) and wired["alpha"]["description"] == "a line"
      and wired["alpha"]["tool"] is tools["alpha"])
check("an undescribed sibling keeps its bare value",
      wired["beta"] is tools["beta"])
check("key order is preserved, since rlms renders in iteration order",
      list(wired) == list(tools))

expect_shape("a contribution for a surface this run did not inject is refused",
             lambda: attach_contributions(tools, {"gamma": "orphan"}), "gamma")

print("\n[6] the budget is stated against a measured prompt, not guessed")

# The two figures every record cites and no drill held: the slot's offset and
# the protocol prompt's length. trellis_contribution.py's header ("spliced into
# the rlms base prompt at character 1,335 of 2,116 — both received from a
# command"), trellis_agent.py's composing comment, and the design record all
# state them. They are claims about a THIRD-PARTY artifact, so an rlms upgrade
# that moves either one makes those sentences false; pinning them here is where
# that shows up, and the failure detail names the repair (rule 22a).
SLOT_OFFSET = 1335
PROMPT_CHARS = 2116

try:
    from rlm.utils.prompts import RLM_SYSTEM_PROMPT
    from trellis_agent import SYSTEM_PROMPT  # noqa: E402
    base_len = len(RLM_SYSTEM_PROMPT)
    slot_at = RLM_SYSTEM_PROMPT.find("{custom_tools_section}")
    check("the rlms base prompt is reachable and carries the slot", slot_at > 0,
          f"slot index {slot_at}")
    check("the budget stays under the protocol prompt it is spliced into",
          CONTRIBUTION_BUDGET < base_len,
          f"budget {CONTRIBUTION_BUDGET} vs prompt {base_len}")
    # PRIMACY, and the premise it actually rests on.
    #
    # What stood here was `slot_at < base_len`, under the name "the slot
    # precedes the prompt's own midpoint, so it keeps primacy". A found index is
    # always inside the string it was found in, so that assertion is entailed by
    # the `slot_at > 0` check three lines above and could not fail while that one
    # passed: it reported primacy and tested nothing. The tautology was also
    # hiding a false sentence — the measured slot sits at 1,335 of 2,116, which
    # is 63% in, PAST the midpoint its own name claimed.
    #
    # Primacy does hold, on a different premise: every Trellis directive is
    # APPENDED to RLM_SYSTEM_PROMPT (.claude/rules/prompt-authoring.md rule 6,
    # "One base" — SYSTEM_PROMPT = RLM_SYSTEM_PROMPT + TRELLIS_ADDENDUM, and
    # build_author_system_prompt opens the same way), so a slot anywhere inside
    # the base precedes all of them however late in the base it sits. That
    # premise is a real claim about composed bytes, and it is what is checked.
    check("the base prompt is a prefix of the prompt Trellis composes, so every "
          "Trellis directive follows the slot",
          SYSTEM_PROMPT.startswith(RLM_SYSTEM_PROMPT) and len(SYSTEM_PROMPT) > base_len,
          f"composed {len(SYSTEM_PROMPT)} chars, base {base_len}, prefix "
          f"{SYSTEM_PROMPT.startswith(RLM_SYSTEM_PROMPT)}")
    check("the slot sits at the offset the records cite",
          slot_at == SLOT_OFFSET,
          f"slot {slot_at}, records say {SLOT_OFFSET} — repair the figure in "
          f"trellis_contribution.py's header, trellis_agent.py's composing "
          f"comment, and SELF_DESCRIBING_SURFACES.md")
    check("the protocol prompt is the length the records cite",
          base_len == PROMPT_CHARS,
          f"prompt {base_len}, records say {PROMPT_CHARS} — repair the same "
          f"three sentences")
    print(f"  slot at {slot_at} of {base_len}; {base_len - slot_at} characters of "
          f"protocol follow it inside the base, and all "
          f"{len(SYSTEM_PROMPT) - base_len} characters of Trellis directive "
          f"follow the whole base.")
except ImportError as exc:  # pragma: no cover
    check("the rlms base prompt is reachable", False, f"import failed: {exc}")

print("\n[7] the shipped surfaces compose through this frame")

import trellis_agent  # noqa: E402,F401  (registers descriptors by import)
import trellis_surfaces as ts  # noqa: E402
import trellis_tools as tt  # noqa: E402


class _Stub:
    pass


pg = _Stub()
pg._retrieval_discipline = True
pg._retrieval_budget = 64
neo = _Stub()
neo._retrieved_addresses_check = lambda: set()
neo._ast_existence_check = lambda h: True
neo._entailment_check = None

# THE ROSTER IS DERIVED, NEVER LISTED. `import trellis_agent` above runs the
# same surface imports the research seam runs, so by this line every surface
# that registers a descriptor is in the registry; the roster is whatever
# carries a contribution, which is exactly what the seam composes (the
# composing call in trellis_agent.py iterates `custom_tools` itself). A surface
# added tomorrow is composed here the moment it registers a line, with nothing
# in this file to remember.
#
# What this replaces: two names typed by hand, under the assertion "the two
# wired surfaces compose" — stale from before thirteen were wired. The budget
# was therefore exercised at 276 of 2,000 characters and the total that
# actually ships was measured by no drill, while the five per-surface ceilings
# were the only thing standing between the composition and the bound.
#
# A line carrying an ("expects", key) slot needs its derive_*_expects result,
# and only two surfaces have one. This mapping FAILS CLOSED: a fourteenth
# surface that needs a derivation and is missing here raises out of
# render_contribution, so the drill reddens naming that surface rather than
# quietly composing a shorter roster.
_DERIVED = {
    "trellis_postgres": tt.derive_postgres_expects(pg),
    "trellis_neo4j": tt.derive_neo4j_expects(neo),
}
_registered = ts.registry()
_entries = [(descriptor, _DERIVED.get(name))
            for name, descriptor in sorted(_registered.items())]
_report = ts.coverage_report()

# measure_contributions does not refuse an over-budget composition, so the
# total is readable even in the state the budget check exists to catch;
# compose_contributions is the shipped path and does refuse. Both are run, so
# an over-budget roster reddens as a measured number AND as the engine's own
# refusal instead of as a traceback.
live_measured = None
live = {}
try:
    live_measured = measure_contributions(_entries)
    check("every registered contribution resolves through the shipped frame", True)
except ContributionShapeError as exc:
    check("every registered contribution resolves through the shipped frame",
          False, str(exc))
try:
    live = compose_contributions(_entries)
    check("the shipped composer returns the whole roster rather than refusing", True)
except (ContributionShapeError, ContributionBudgetError) as exc:
    check("the shipped composer returns the whole roster rather than refusing",
          False, str(exc))

# An unmeasurable composition is a defect, not a size: the fallback is over
# budget on purpose, so the bound below reddens rather than passing on a zero.
if live_measured is None:
    live_measured = {"total": CONTRIBUTION_BUDGET + 1, "budget": CONTRIBUTION_BUDGET,
                     "headroom": -1, "surfaces": 0, "perSurface": {}}
live_total = live_measured["total"]

check("the composed roster is every registered contribution, derived not listed",
      sorted(live) == _report["contributing"],
      f"composed {sorted(live)} vs contributing rung {_report['contributing']}")
# ANTI-TRIVIAL FLOOR. A drill that reads a registry passes vacuously when the
# registry is empty, so the floor comes from a source the registry cannot
# supply: coverage_report derives the injected roster by AST from
# trellis_agent.py's own seam text. Every name that read finds which also
# carries a contribution must be in the composition, and there must be at least
# one — an empty or half-imported registry empties that intersection and
# reddens here rather than reporting a comfortable zero.
_seam_backed = [n for n in _report["described"] if n in _report["contributing"]]
check("the seam's own described surfaces are all composed, and there is at least one",
      len(_seam_backed) > 0 and set(_seam_backed) <= set(live),
      f"{len(_seam_backed)} seam-backed name(s), {len(live)} composed")
check("the composed total is under budget",
      live_total <= CONTRIBUTION_BUDGET, f"{live_total} of {CONTRIBUTION_BUDGET}")
check("every composed line is brace-free",
      bool(live) and all("{" not in v and "}" not in v for v in live.values()))
check("every composed line is one line",
      bool(live) and all("\n" not in v and "\r" not in v for v in live.values()))
check("the budget number a run is told is the number it is refused past",
      str(64) in live.get("trellis_postgres", ""))
# ORIENTING LENGTH, per line. The budget alone is satisfiable by a couple of
# surfaces eating it between them, which is the state the first pass shipped:
# two full accounts at 361 and 461 characters. The ceiling is stated at the top
# of this file and is the same one the mcp, workspace, answer and scaffold
# drills hold their own lines to — a property of one line, carrying no count of
# how many lines there are.
for _name, _size in sorted(live_measured["perSurface"].items()):
    check(f"{_name} stays inside the orienting-line ceiling",
          _size <= ORIENTING_LINE_MAX, f"{_size} of {ORIENTING_LINE_MAX}")
print(f"  composed {live_measured['surfaces']} surface(s): {live_total} of "
      f"{CONTRIBUTION_BUDGET} characters, headroom {live_measured['headroom']}; "
      f"longest line {max(live_measured['perSurface'].values(), default=0)} of "
      f"{ORIENTING_LINE_MAX}")

bare = _Stub()
check("a bare-constructed surface states no bound it does not enforce",
      "64" not in render_contribution(ts.descriptor_for("trellis_postgres"),
                                      tt.derive_postgres_expects(bare)))


def negative_control():
    """Eleven plants the drill must catch. Exits 3 when every one is detected."""
    planted = []

    def caught(name, fn):
        try:
            fn()
            planted.append((name, False))
        except (ContributionShapeError, ContributionBudgetError, AssertionError):
            planted.append((name, True))
        except Exception:  # noqa: BLE001
            planted.append((name, True))

    caught("a brace reaches the slot",
           lambda: render_contribution(d(**{CONTRIBUTES_FIELD: ["{x}"]})))
    caught("a newline reaches the slot",
           lambda: render_contribution(d(**{CONTRIBUTES_FIELD: ["a\nb"]})))
    caught("an empty line claims a slot",
           lambda: render_contribution(d(**{CONTRIBUTES_FIELD: [""]})))
    caught("boundary whitespace survives",
           lambda: render_contribution(d(**{CONTRIBUTES_FIELD: [" x"]})))
    caught("an unknown tag resolves",
           lambda: render_contribution(d(**{CONTRIBUTES_FIELD: [("usage", "k")]})))
    caught("a slot points at an absent phrase",
           lambda: render_contribution(d(**{CONTRIBUTES_FIELD: [("expects", "gone")]}), {}))
    caught("a slot points at an absent descriptor field",
           lambda: render_contribution(d(**{CONTRIBUTES_FIELD: [("descriptor", "gone")]})))
    caught("the budget is exceeded without refusal",
           lambda: compose_contributions([(big_a, None), (big_b, None)], budget=100))
    caught("a contribution names a surface no run injected",
           lambda: attach_contributions({"alpha": object()}, {"ghost": "x"}))

    # The two properties this pass repaired, planted so each is watched failing
    # rather than argued for (rule 19c). Both are drill predicates rather than
    # module guards, so each plant asserts and the AssertionError is the catch.
    def _line_grows_into_an_account():
        stretched = d(name="stretched",
                      **{CONTRIBUTES_FIELD: ["x" * (ORIENTING_LINE_MAX + 1)]})
        rendered = render_contribution(stretched)
        assert len(rendered) <= ORIENTING_LINE_MAX, \
            f"{len(rendered)} of {ORIENTING_LINE_MAX}"

    def _roster_reverts_to_a_hand_named_pair():
        pair = [(_registered[n], _DERIVED.get(n))
                for n in ("trellis_postgres", "trellis_neo4j")]
        composed = compose_contributions(pair)
        assert sorted(composed) == _report["contributing"], \
            f"composed {sorted(composed)} of {len(_report['contributing'])} contributing"

    caught("a description line grows past the orienting ceiling",
           _line_grows_into_an_account)
    caught("the composing roster reverts to a hand-named pair",
           _roster_reverts_to_a_hand_named_pair)

    detected = sum(1 for _, ok in planted if ok)
    print(f"\nnegative control: {len(planted)} planted, {detected} detected")
    for name, ok in planted:
        print(f"  [{'caught' if ok else 'MISSED'}] {name}")
    return 3 if detected == len(planted) else 1


if __name__ == "__main__":
    if "--negative-control" in sys.argv:
        sys.exit(negative_control())
    print(f"\n{failures} check(s) failed." if failures else "\nAll contribution-frame checks passed.")
    sys.exit(1 if failures else 0)
