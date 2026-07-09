# Live zero-LLM test of the Session 15 module registry and module #0,
# run under the pinned interpreter via `npm run test:modules`. No
# databases, no network, no paid work — the subject is prompt
# composition and the cross-language registry contract.
#
# The single most important check is the BYTE-IDENTICAL PIN: with the
# default selection (module #0, spatial-flywheel), the composed
# SYSTEM_PROMPT must hash to the recorded pre-extraction value — the
# loader proves itself with zero behavior change (design record §9.5).
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "rlm"))

from trellis_modules import (  # noqa: E402
    DEFAULT_SELECTION,
    RUBRIC_TOKEN,
    build_modules_addendum,
    load_module,
    load_modules,
    parse_module_selection,
)

failures = 0


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


# sha256 of SYSTEM_PROMPT on master 9f25a5b, immediately before the
# spatial-flywheel extraction. If the rubric asset or the kernel prompt
# text legitimately changes, recompute and update this pin in the same
# commit — silently drifting composition must fail here.
PRE_EXTRACTION_SYSTEM_PROMPT_SHA256 = "abb945a6e0c998ccabe2e2a930ea6934cae696643c1230f733c3d13d9feef9b2"

# --- 1. Selection parsing (twins of src/config/modules.test.ts) -------------
print("\n[1] parse_module_selection re-validation")

check("unset means the default selection (module #0)",
      parse_module_selection(None) == list(DEFAULT_SELECTION) == ["spatial-flywheel"])
check("explicit selection and the empty selection parse",
      parse_module_selection('["spatial-flywheel"]') == ["spatial-flywheel"]
      and parse_module_selection('[]') == [])
expect_raises("malformed JSON rejected", lambda: parse_module_selection('{oops'), "not valid json")
expect_raises("non-array rejected", lambda: parse_module_selection('"x"'), "array")
for bad in ('["Spatial-Flywheel"]', '["1digit"]', '["has space"]', '["br{ace}"]', '[42]'):
    expect_raises(f"bad name {bad} rejected", lambda b=bad: parse_module_selection(b), "module name")
expect_raises("duplicates rejected", lambda: parse_module_selection('["a","a"]'), "duplicate")
expect_raises("beyond-cap selection rejected",
              lambda: parse_module_selection('["a","b","c","d","e"]'), "at most 4")

# --- 2. Module #0 loads and validates ---------------------------------------
print("\n[2] module #0 (spatial-flywheel)")

module0 = load_module("spatial-flywheel")
check("module #0 loads with its manifest identity",
      module0["name"] == "spatial-flywheel" and module0["version"] == 1)
check("addendum file is brace-free and carries the rubric token",
      "{" not in module0["addendum_text"] and "}" not in module0["addendum_text"]
      and RUBRIC_TOKEN in module0["addendum_text"]
      and "SPATIAL FLYWHEEL PROTOCOL" in module0["addendum_text"])
check("addendum is LF-normalized", "\r" not in module0["addendum_text"])
expect_raises("unregistered module rejected", lambda: load_module("ghost"), "not registered")

forwarded_sha = os.environ.get("TRELLIS_TEST_MODULE0_SHA")
check("wrapper forwarded the Node-side addendum hash", bool(forwarded_sha))
check("Node and Python loaders read byte-identical addendum text (cross-language pin)",
      hashlib.sha256(module0["addendum_text"].encode("utf-8")).hexdigest() == forwarded_sha)

# --- 3. Composition ----------------------------------------------------------
print("\n[3] composition")

check("empty selection composes the empty string (byte-identical prompt)",
      build_modules_addendum([]) == "")
composed = build_modules_addendum([module0], substitutions={RUBRIC_TOKEN: "SAFE {{RUBRIC}} TEXT"})
check("composition substitutes the rubric token and normalizes the tail",
      "SAFE {{RUBRIC}} TEXT" in composed and RUBRIC_TOKEN not in composed
      and composed.endswith("mention scan.\n\n"))
expect_raises(
    "unescaped braces after substitution are rejected",
    lambda: build_modules_addendum([module0], substitutions={RUBRIC_TOKEN: "bad {brace}"}),
    "unescaped braces",
)
two = build_modules_addendum(
    [dict(name="a", version=1, purpose="p", addendum_text="ALPHA\n\n\n"),
     dict(name="b", version=1, purpose="p", addendum_text="BETA")],
)
check("modules compose in selection order, each ending with one blank line",
      two == "ALPHA\n\nBETA\n\n")

# --- 4. The byte-identical pin -----------------------------------------------
print("\n[4] the byte-identical composed-prompt pin")

selection_env = os.environ.get("TRELLIS_MODULES")
check("wrapper forwarded the canonical default selection",
      selection_env is not None and json.loads(selection_env) == ["spatial-flywheel"])

import trellis_agent  # noqa: E402
from rlm.utils.prompts import RLM_SYSTEM_PROMPT  # noqa: E402

check("composed SYSTEM_PROMPT is byte-identical to the pre-extraction monolith",
      hashlib.sha256(trellis_agent.SYSTEM_PROMPT.encode("utf-8")).hexdigest()
      == PRE_EXTRACTION_SYSTEM_PROMPT_SHA256,
      hashlib.sha256(trellis_agent.SYSTEM_PROMPT.encode("utf-8")).hexdigest())
check("SYSTEM_PROMPT is still base-prompt + composed addendum",
      trellis_agent.SYSTEM_PROMPT == RLM_SYSTEM_PROMPT + trellis_agent.TRELLIS_ADDENDUM)
check("the composed addendum is structurally base + module #0 + rules",
      trellis_agent.TRELLIS_ADDENDUM
      == trellis_agent.TRELLIS_ADDENDUM_BASE
      + build_modules_addendum([module0], substitutions={RUBRIC_TOKEN: trellis_agent._SAFE_RUBRIC})
      + trellis_agent.TRELLIS_WORKFLOW_RULES)

empty_addendum = (
    trellis_agent.TRELLIS_ADDENDUM_BASE
    + build_modules_addendum(load_modules([]))
    + trellis_agent.TRELLIS_WORKFLOW_RULES
)
check("the empty selection composes exactly base + workflow rules",
      empty_addendum == trellis_agent.TRELLIS_ADDENDUM_BASE + trellis_agent.TRELLIS_WORKFLOW_RULES)

stripped = trellis_agent.TRELLIS_ADDENDUM.replace("{{", "").replace("}}", "")
check("the composed addendum has no unescaped braces (rlms .format() safety)",
      "{" not in stripped and "}" not in stripped)

# --- 5. Module #1 (workspace-discipline) — the first flywheel-turn module ----
# Loads and validates the registry's first research-bearing module WITHOUT
# adding it to the default selection, so the byte-identical pin above is
# untouched. This is the module's acceptance drill (its manifest names
# `npm run test:modules`). The research provenance is existence-checked
# live by `npm run modules:register` / `npm run test:module-lifecycle`, not
# here (this drill stays database-free).
print("\n[5] module #1 (workspace-discipline)")

module1 = load_module("workspace-discipline")
check("module #1 loads with its manifest identity",
      module1["name"] == "workspace-discipline" and module1["version"] == 1)
check("module #1 addendum is brace-free and titled",
      "{" not in module1["addendum_text"] and "}" not in module1["addendum_text"]
      and "WORKSPACE DISCIPLINE PROTOCOL" in module1["addendum_text"])
check("module #1 addendum is LF-normalized", "\r" not in module1["addendum_text"])

selected = build_modules_addendum([module0, module1],
                                  substitutions={RUBRIC_TOKEN: trellis_agent._SAFE_RUBRIC})
check("module #1 composes after module #0 in selection order",
      module1["addendum_text"].splitlines()[0] in selected
      and selected.index("WORKSPACE DISCIPLINE PROTOCOL")
      > selected.index("SPATIAL FLYWHEEL PROTOCOL"))
selected_stripped = selected.replace("{{", "").replace("}}", "")
check("a selection including module #1 stays brace-safe after substitution",
      "{" not in selected_stripped and "}" not in selected_stripped)
check("module #1 is NOT in the default selection (the byte-identical pin is untouched)",
      "workspace-discipline" not in list(DEFAULT_SELECTION))

# ---------------------------------------------------------------------------
if failures:
    print(f"\n{failures} check(s) failed.")
    sys.exit(1)
print("\nAll module registry checks passed.")
