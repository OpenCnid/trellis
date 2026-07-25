# Live zero-LLM test of the Session 22 by-reference final-answer channel
# (src/rlm/trellis_answer.py), run under the pinned interpreter via
# `npm run test:answer-channel`. No databases, no network, no paid work.
#
# THE REGRESSION UNDER TEST is the Session 21 effective-context probe's
# one wrong answer (EFFECTIVE_CONTEXT_PROBE_REPORT.md): the run's REPL
# computed a count of 55, printed it, and the model's final turn set
# answer['content'] to a hand-typed "FINAL_ANSWER: 47" — the computed
# value was retyped through attention and corrupted. The fix is tooling
# shape (pillar §2.8): trellis_answer.submit(expression_text) evaluates
# the expression in the live REPL namespace, so the number the code
# produced is the number that lands.
#
# Layers under test:
#   [1] the structural refusals — value-not-text, empty, oversized,
#       unparseable, and constant-only expressions (the retyped-literal
#       class) are refused with readable messages,
#   [2] deterministic rendering — str verbatim, int/float/bool exact,
#       containers as JSON, None refused,
#   [3] THE REGRESSION, in the real rlms LocalREPL — code computes 55,
#       submit carries 55 to REPLResult.final_answer unretyped; the
#       hand-typed-literal path is refused; a typo'd name is a loud
#       NameError, never a silently wrong digit,
#   [4] channel semantics in the REPL — nested-function calls, the
#       sandbox posture (submit's expression runs under the REPL's own
#       safe builtins), scaffold-restore interplay, and the additive
#       guarantee (direct answer['content'] assignment still works),
#   [5] telemetry — the submit counter counts successes only,
#   [6] prompt integration — the composed research prompt teaches the
#       channel (the sha pin itself lives in test:modules).
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "rlm"))

from trellis_answer import (  # noqa: E402
    ANSWER_CONTENT_MAX_CHARS,
    ANSWER_EXPRESSION_MAX_CHARS,
    ANSWER_PREFIX,
    TrellisAnswer,
    get_answer_submit_count,
)

failures = 0


from trellis_contribution import (  # noqa: E402
    ContributionShapeError,
    render_contribution,
)

# ORIENTING LENGTH, per line — a STATED target, and the same one the mcp,
# workspace, scaffold and contribution drills hold their lines to. The slot
# rlms reserves takes ONE ORIENTING line: what the surface is, and when to
# reach for it. Anything longer rides the addendum path instead
# (trellis_contribution.py, "WHAT THE SLOT CAN AND CANNOT CARRY").
#
# It replaces `CONTRIBUTION_BUDGET // 13`, which divided the shared budget by
# the number of surfaces that happened to carry a contribution the day it was
# written. That instance was hard-coded in five drills, and a fourteenth
# surface loosened all five at once: fourteen lines at the stale 153 sum to
# 2,142, past the 2,000-character budget, with every per-surface check green.
# This is a property of ONE line, so no surface count enters it. The
# whole-composition bound stays the engine's own — compose_contributions
# refuses over CONTRIBUTION_BUDGET, exercised over every registered
# contribution in scripts/test_contribution.py [7].
ORIENTING_LINE_MAX = 160

def check(name, ok, detail=""):
    global failures
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail and not ok else ""))
    if not ok:
        failures += 1


def run_in_namespace(code, extra=None):
    """Executes code the way LocalREPL does (a single dict as globals and
    locals) with a plain answer dict and an injected holder, and returns
    the namespace. Lets [1]/[2] exercise the caller-frame mechanics
    without spinning a full REPL per case."""
    ns = {"answer": {"content": "", "ready": False}, "trellis_answer": TrellisAnswer()}
    ns.update(extra or {})
    exec(code, ns, ns)
    return ns


def expect_refusal(name, code, needle, extra=None):
    """The refusal must raise AND leave the answer channel untouched."""
    ns = {"answer": {"content": "", "ready": False}, "trellis_answer": TrellisAnswer()}
    ns.update(extra or {})
    try:
        exec(code, ns, ns)
        check(name, False, "expected a refusal, nothing raised")
    except (ValueError, RuntimeError) as e:
        check(name,
              needle.lower() in str(e).lower() and ns["answer"]["ready"] is False,
              f"message lacked {needle!r} or answer moved: {e}")
    except Exception as e:  # noqa: BLE001
        check(name, False, f"expected ValueError/RuntimeError, got {type(e).__name__}: {e}")


# --- 1. Structural refusals ---------------------------------------------------
print("\n[1] structural refusals (the retyped-literal class)")

expect_refusal("passing the VALUE instead of expression text is refused with teaching",
               "trellis_answer.submit(47)", "text of an expression")
expect_refusal("empty expression refused", "trellis_answer.submit('  ')", "empty")
expect_refusal("oversized expression refused with the cap",
               f"trellis_answer.submit('x' * {ANSWER_EXPRESSION_MAX_CHARS + 1})",
               str(ANSWER_EXPRESSION_MAX_CHARS))
expect_refusal("unparseable expression refused readably",
               "trellis_answer.submit('def not an expr')", "not a valid python expression")
expect_refusal("bare integer literal refused (THE 55->47 CLASS)",
               "trellis_answer.submit('47')", "bare literal")
expect_refusal("quoted-string literal refused",
               "trellis_answer.submit(\"'some retyped sentence'\")", "bare literal")
expect_refusal("arithmetic on literals refused",
               "trellis_answer.submit('40 + 7')", "bare literal")
expect_refusal("negated literal refused",
               "trellis_answer.submit('-47')", "bare literal")
expect_refusal("f-string with no interpolated state refused",
               "trellis_answer.submit('f\"47\"')", "bare literal")
expect_refusal("statement (walrus-free assignment) refused as non-expression",
               "trellis_answer.submit('x = 1')", "not a valid python expression")

# --- 2. Deterministic rendering ----------------------------------------------
print("\n[2] deterministic engine-side rendering")

ns = run_in_namespace("r = trellis_answer.submit('count')", {"count": 55})
check("int renders exactly and the prefix is engine-owned",
      ns["answer"] == {"content": "FINAL_ANSWER: 55", "ready": True}
      or (ns["answer"]["content"] == "FINAL_ANSWER: 55" and ns["answer"]["ready"] is True))
receipt = json.loads(ns["r"])
check("submit returns a JSON receipt with a bounded preview",
      receipt["submitted"] is True and receipt["content_chars"] == len("FINAL_ANSWER: 55")
      and receipt["preview"] == "FINAL_ANSWER: 55" and receipt["preview_truncated"] is False)

ns = run_in_namespace("trellis_answer.submit('sentence')",
                      {"sentence": "It was on a dreary night of November."})
check("str renders verbatim (quote fidelity)",
      ns["answer"]["content"] == "FINAL_ANSWER: It was on a dreary night of November.")

ns = run_in_namespace("trellis_answer.submit('ratio')", {"ratio": 0.1 + 0.2})
check("float renders as its shortest round-trip repr",
      ns["answer"]["content"] == f"{ANSWER_PREFIX}{repr(0.1 + 0.2)}")

ns = run_in_namespace("trellis_answer.submit('flag')", {"flag": True})
check("bool renders as JSON", ns["answer"]["content"] == "FINAL_ANSWER: true")

ns = run_in_namespace("trellis_answer.submit('stats')", {"stats": {"simple": 55, "regex": 55}})
check("dict renders as compact JSON",
      ns["answer"]["content"] == 'FINAL_ANSWER: {"simple": 55, "regex": 55}')

expect_refusal("None result refused (a function that returned nothing is not a result)",
               "trellis_answer.submit('missing.get(1)')", "none", {"missing": {}})
expect_refusal("over-cap content refused with usage, never truncated",
               "trellis_answer.submit('corpus')",
               str(ANSWER_CONTENT_MAX_CHARS),
               {"corpus": "x" * (ANSWER_CONTENT_MAX_CHARS + 1)})

# --- 3. THE REGRESSION in the real LocalREPL ---------------------------------
print("\n[3] the 55->47 regression in the real rlms LocalREPL")

from rlm.environments.local_repl import LocalREPL  # noqa: E402

repl = LocalREPL(custom_tools={"trellis_answer": TrellisAnswer()})
try:
    # The REPL computes the count — the drill never types 55 anywhere
    # near the answer path (the corpus is built by code, the count is
    # computed by code, the answer is set by evaluation).
    out = repl.execute_code(
        "text = ('Justine went to the market. ' * 54) + 'Justine rested.'\n"
        "counts = dict(simple=text.count('Justine'))\n"
        "print(counts['simple'])"
    )
    computed = out.stdout.strip()
    check("the REPL computed and printed the count", computed.isdigit())

    out = repl.execute_code("receipt = trellis_answer.submit(\"counts['simple']\")")
    check("submit carried the COMPUTED value to final_answer unretyped",
          out.final_answer == f"FINAL_ANSWER: {computed}",
          f"final_answer={out.final_answer!r} computed={computed!r}")

    # The counter-factual: the hand-typed literal that caused the
    # Session 21 wrong answer is structurally refused.
    out = repl.execute_code("trellis_answer.submit('47')")
    check("the hand-typed literal path is refused inside the REPL",
          "bare literal" in out.stderr and out.final_answer is None)

    # A typo'd variable name fails LOUDLY (NameError), never a silently
    # wrong digit — the property retyping can never have.
    out = repl.execute_code("trellis_answer.submit('cuonts')")
    check("a typo'd name is a loud NameError, not a silent wrong answer",
          "NameError" in out.stderr and out.final_answer is None)
finally:
    repl.cleanup()

# --- 4. Channel semantics in the REPL ----------------------------------------
print("\n[4] channel semantics: nesting, sandbox posture, restore, additivity")

repl = LocalREPL(custom_tools={"trellis_answer": TrellisAnswer()})
try:
    # Calling submit from inside a model-defined helper resolves the
    # helper's LOCAL variables too (caller-frame locals, not just globals).
    out = repl.execute_code(
        "def finish():\n"
        "    local_total = sum([5, 11])\n"
        "    return trellis_answer.submit('local_total')\n"
        "finish()"
    )
    check("submit inside a nested function sees that function's locals",
          out.final_answer == "FINAL_ANSWER: 16", f"final_answer={out.final_answer!r}")

    # Sandbox posture: the expression evaluates under the REPL's own
    # safe builtins — eval is blocked there, so it is blocked here.
    out = repl.execute_code("trellis_answer.submit(\"eval('1+1')\")")
    check("the expression runs under the REPL's safe builtins (eval stays blocked)",
          out.final_answer is None and out.stderr != "")

    # Scaffold-restore interplay: if the model rebound `answer` to a
    # plain dict in an earlier turn, rlms swaps a fresh _AnswerDict in at
    # restore; submit reads the CURRENT binding each call and still lands.
    repl.execute_code("answer = dict(content='', ready=False)")  # model clobbers the channel
    out = repl.execute_code("n_final = 21 * 2\ntrellis_answer.submit('n_final')")
    check("submit lands after a model rebind of answer (reads the live binding)",
          out.final_answer == "FINAL_ANSWER: 42", f"final_answer={out.final_answer!r}")
finally:
    repl.cleanup()

# The ADDITIVE guarantee: the pre-existing direct-assignment path is
# untouched — a legacy run that never calls submit still completes.
repl = LocalREPL(custom_tools={"trellis_answer": TrellisAnswer()})
try:
    out = repl.execute_code(
        "answer['content'] = 'FINAL_ANSWER: legacy path'\nanswer['ready'] = True")
    check("direct answer['content'] assignment still works (additive channel)",
          out.final_answer == "FINAL_ANSWER: legacy path")
finally:
    repl.cleanup()

# --- 5. Telemetry: successes only ---------------------------------------------
print("\n[5] the submit counter (counts-only telemetry)")

before = get_answer_submit_count()
try:
    run_in_namespace("trellis_answer.submit('47')")
except ValueError:
    pass
check("a refused submit does not count", get_answer_submit_count() == before)
run_in_namespace("trellis_answer.submit('v')", {"v": 1})
check("a successful submit counts once", get_answer_submit_count() == before + 1)

# --- 6. Prompt integration -----------------------------------------------------
print("\n[6] the composed research prompt teaches the channel")

import trellis_agent  # noqa: E402

check("TOOLS section teaches trellis_answer.submit",
      "trellis_answer.submit" in trellis_agent.SYSTEM_PROMPT)
check("the workflow rule forbids hand-typing computed values",
      "hand-typing one into answer['content'] or into the submitted "
      "expression is a protocol violation" in trellis_agent.SYSTEM_PROMPT)
check("the turn-discipline line routes completion through the channel",
      "finish by calling trellis_answer.submit" in trellis_agent.SYSTEM_PROMPT)
check("the taught surface is brace-free beyond the rlms base (format safety)",
      "trellis_answer" in trellis_agent.TRELLIS_ADDENDUM
      and "{" not in trellis_agent.TRELLIS_ADDENDUM.replace("{{", "")
      .replace("}}", ""))

# --- 7. The surface descriptor -------------------------------------------------
# docs/architecture/SELF_DESCRIBING_SURFACES.md §9.1 (one encoding, owned
# by whoever is authoritative for the fact) and §11 (a descriptor is a
# REGISTRATION, not a validated schema). rlms reserves one description
# line per injected surface; unregistered, this one reads to the model as
# a bare type name.
print("\n[7] the surface descriptor")

from trellis_answer import ANSWER_DESCRIPTOR  # noqa: E402
from trellis_surfaces import descriptor_for  # noqa: E402


def descriptor_strings(value):
    """Every string reachable inside the descriptor."""
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        acc = []
        for key, item in value.items():
            if isinstance(key, str):
                acc.append(key)
            acc.extend(descriptor_strings(item))
        return acc
    if isinstance(value, (list, tuple)):
        return [s for item in value for s in descriptor_strings(item)]
    return []


check("the descriptor is bound at the surface's own definition site",
      descriptor_for("trellis_answer") is ANSWER_DESCRIPTOR)
check("it carries a non-empty one-line purpose for the rlms description slot",
      bool(ANSWER_DESCRIPTOR["purpose"].strip()))
# Every property a guard enforces lives once, in the expects mapping;
# `purpose` states no bound, so the two cannot disagree (§9.1).
check("guard-backed expectations are keyed by guard class, not folded into purpose",
      sorted(ANSWER_DESCRIPTOR["expects"]) == [
          "content_bound", "expression_bound", "expression_text",
          "no_bare_literal", "none_refused"])
# NO derive_answer_expects exists, and that is the finding: this surface
# takes no constructor arguments and every bound it enforces is a kernel
# constant, so a derivation would return one mapping on every run.
import trellis_answer  # noqa: E402

check("no derive_*_expects is shipped — nothing here varies per run",
      not any(n.startswith("derive_") for n in dir(trellis_answer)))
_strings = descriptor_strings(ANSWER_DESCRIPTOR)
check("every reachable descriptor string is brace-free (rlms .format safety)",
      len(_strings) > 10
      and all("{" not in s and "}" not in s for s in _strings))


def contributed_line(descriptor):
    """The line this descriptor composes to, THROUGH THE SHIPPED FRAME.

    This was a local reimplementation of the frame's resolution rule. It
    joined with "" and skipped `_guard_line`, so it checked this module's
    data against a COPY of the rule rather than the rule — and a change to
    the real join would have kept this drill green while the shipped line
    moved. It now calls `render_contribution`, so the data is checked
    against the composer that actually runs. None when a slot cannot
    resolve, which the frame reports by raising."""
    try:
        return render_contribution(descriptor) or None
    except ContributionShapeError:
        return None


line = contributed_line(ANSWER_DESCRIPTOR)
check("the contributed pieces all resolve against this descriptor's own fields",
      line is not None)
# The four ways rlms's one-line description slot breaks: empty, edge
# whitespace, more than one line, or a brace.
check("they compose to exactly one clean, bounded description line",
      bool(line) and line == line.strip()
      and "\n" not in line and "\r" not in line
      and "{" not in line and "}" not in line)
# Orienting length, not an account: the 320 this once allowed was twice the
# ceiling, and a line at it is a write-up in the slot reserved for a pointer.
check("the composed line stays inside the orienting-line ceiling",
      len(line) <= ORIENTING_LINE_MAX, f"{len(line)} of {ORIENTING_LINE_MAX}")
# The line PULLS rather than restates: everything but the connective
# comes from a field the descriptor already owns (§9.1).
check("the line pulls from descriptor fields rather than restating them",
      sum(len(p) for p in ANSWER_DESCRIPTOR["contributes"]
          if isinstance(p, str)) <= 32)

# ---------------------------------------------------------------------------
if failures:
    print(f"\n{failures} check(s) failed.")
    sys.exit(1)
print("\nAll answer-channel checks passed.")
