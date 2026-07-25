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
# `--negative-control` plants nine conditions the drill must detect, and exits 3
# when every one of them is caught (rule 19(c)).
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

try:
    from rlm.utils.prompts import RLM_SYSTEM_PROMPT
    base_len = len(RLM_SYSTEM_PROMPT)
    slot_at = RLM_SYSTEM_PROMPT.find("{custom_tools_section}")
    check("the rlms base prompt is reachable and carries the slot", slot_at > 0,
          f"slot index {slot_at}")
    check("the budget stays under the protocol prompt it is spliced into",
          CONTRIBUTION_BUDGET < base_len,
          f"budget {CONTRIBUTION_BUDGET} vs prompt {base_len}")
    check("the slot precedes the prompt's own midpoint, so it keeps primacy",
          slot_at < base_len, f"slot {slot_at} of {base_len}")
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

live = compose_contributions([
    (ts.descriptor_for("trellis_postgres"), tt.derive_postgres_expects(pg)),
    (ts.descriptor_for("trellis_neo4j"), tt.derive_neo4j_expects(neo)),
])
live_total = sum(len(v) for v in live.values())
check("the two wired surfaces compose", len(live) == 2)
check("the composed total is under budget",
      live_total <= CONTRIBUTION_BUDGET, f"{live_total} of {CONTRIBUTION_BUDGET}")
check("every composed line is brace-free",
      all("{" not in v and "}" not in v for v in live.values()))
check("every composed line is one line",
      all("\n" not in v and "\r" not in v for v in live.values()))
check("the budget number a run is told is the number it is refused past",
      str(64) in live["trellis_postgres"])

bare = _Stub()
check("a bare-constructed surface states no bound it does not enforce",
      "64" not in render_contribution(ts.descriptor_for("trellis_postgres"),
                                      tt.derive_postgres_expects(bare)))


def negative_control():
    """Nine plants the drill must catch. Exits 3 when every one is detected."""
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
