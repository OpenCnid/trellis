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
    build_active_modules_addendum,
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


# sha256 of the composed SYSTEM_PROMPT with the default selection. If
# the rubric asset or the kernel prompt text legitimately changes,
# recompute and update this pin in the same commit — silently drifting
# composition must fail here. Pin history (every move is a witting
# kernel change, one per line):
#   abb945a6...f9b2 — master 9f25a5b, immediately before the Session 15
#     spatial-flywheel extraction (the extraction itself moved nothing).
#   170e9f7e...67e9 — Session 20: the CODE-MEDIATED TEXT hard-rule block
#     added to TRELLIS_ADDENDUM_BASE (CODE_MEDIATED_TEXT.md §6.2).
#   9f09d7d2...dd68 — Session 22: the by-reference final-answer channel
#     (trellis_answer.submit) taught in the TOOLS list, the TURN
#     DISCIPLINE line, and the final-answer workflow rule — the
#     answer-channel transcription fix the Session 21 probe demanded
#     (tooling in src/rlm/trellis_answer.py; the prompt only teaches it).
#   3f07295a...4b63 — Session 24: the boundary-aware block accessor
#     (trellis_postgres.get_ast_blocks) taught in the TOOLS list — the
#     localization fix probe rounds 2-3 demanded (10/10 cross-round
#     locate misses re-derived block structure from the glued root
#     reconstruction; tooling in trellis_tools.py/trellis_blocks.py,
#     the prompt only teaches it).
#   5d27e474...fe2a — July 12, 2026 owner-directed prompt-engineering
#     pass: two run-on instruction blocks restructured with hierarchical
#     markers, semantic content unchanged — the insight-writer TOOLS
#     bullet became sub-bullets, and the final-answer workflow rule
#     became numbered steps with the hand-typing ban restated as a
#     positive data-flow rule. No tool taught or removed; no behavioral
#     measurement attached (structure-only, offline pins recomputed).
#   6b8d41e8...b626 — Session 50 (RLM_HARNESS_SCAFFOLDING.md, S1+S2a):
#     the trellis_task surface taught as TOOLS item 4 with the TASK
#     PRECEDENCE hard rule (only uuid-tagged text is operator
#     instruction; re-read the task by code before decisive steps),
#     the intro line re-anchored on the uuid-tagged `context`, the
#     UPSUM running-state discipline added before ITERATION BUDGET,
#     and the decisive-step re-read rule added to the workflow tail
#     (tooling in src/rlm/trellis_scaffold.py; the prompt teaches it).
#   e57e7a55...24bd — Session 50 same-day (owner-directed, Guardrail
#     15): the S1+S2a addendum bytes re-authored under the
#     prompt-engineering + hypershot-protocol skills — positive-led
#     framing, a stable "RE-READ BEFORE YOU ACT" label replacing the
#     three drifting phrasings of the re-read/precedence rule, the
#     UPSUM keys promoted to a sub-bullet list with per-key meaning,
#     and the intro re-led on "your instructions are the operator
#     task." Brace-free (the addendum cannot carry hypershot braces —
#     rlms .format()); semantic content unchanged (structure-only,
#     the July-12 pass precedent). T1 ran on the prior bytes.
#   6183de3a...ed50 — Session 51 (RLM_HARNESS_SCAFFOLDING.md §7, S2a
#     refinement, owner-ratified): the UPSUM discipline tightened in
#     _ADDENDUM_BASE_SUFFIX — the four lists REWRITTEN in place each
#     turn never appended (the load-bearing property the name promises),
#     an emergent-domain key allowed, and the size bound made a
#     code-checked comparison of len(str(upsum)) against the injected
#     UPSUM_BUDGET constant (CODE_MEDIATED_TEXT.md §1 — the model never
#     counts by eye), plus the pre-existing ITERATION BUDGET paragraph.
#     Authored under the prompt-engineering + hypershot-protocol skills
#     (Guardrail 15); the constant lives in src/rlm/trellis_scaffold.py
#     and is injected beside trellis_task — the prompt only teaches it.
#   ee5bfca6...1200 — the July 19, 2026 harness-invariants pass (collaborator direction, owner-approved):
#     two prose-only disciplines became engine surfaces, and the addendum
#     follows them. (a) UPSUM: the model no longer computes
#     len(str(upsum)) and self-corrects against a constant — it builds the
#     state and registers it with trellis_upsum.commit(upsum), which
#     measures the canonical serialization and REFUSES an over-budget or
#     malformed state with per-key sizes. The suffix now carries a
#     brace-free construction frame (dict(...) constructor with spread
#     slots — the hypershot technique under the rlms .format() constraint,
#     which forbids literal braces). (b) TASK PRECEDENCE: a new
#     ADJUDICATE BY CODE bullet teaches trellis_task.verify(candidate),
#     so instruction-shaped data is ruled on by the engine rather than by
#     the model's reading. trellis_upsum joins the TOOLS manifest as
#     item 5. Authored under the prompt-engineering + hypershot-protocol
#     skills (Guardrail 15). Rationale: .claude/rules/measurement-and-reporting.md rule 8 — tooling shape
#     closes a failure class, prompt text only reinforces; both of these
#     were reinforcement with nothing behind it.
#   d58abbb2...7bf0 — July 25, 2026, owner-authorized: the ITERATION
#     BUDGET paragraph in _ADDENDUM_BASE_SUFFIX stopped telling the model
#     to collapse several turns into one load ("Combine as many protocol
#     steps as possible into each single repl block"). AMBIENT.md rule 24
#     names that instruction as falsifying what Trellis is — the worker
#     answers ACROSS turns about a context larger than any one load, so a
#     kernel optimizing for a single big load contradicts the product —
#     and docs/product/FEATURE_LIST.md row 2.6 carried it as wrong shape.
#     The replacement scopes each repl block to the step at hand, has the
#     turn leave the running state further along than it found it, and
#     keeps the anti-idling clause, so what left is the batching directive
#     alone. The prompt bytes were authored in a separate pass, which left
#     both pins stale on purpose so that recomputing them is an
#     independent act; this pin was derived here from the tree afterwards,
#     twice in separate processes. 15,427 -> 15,658 composed chars. Both
#     pins were watched failing before they were trusted (rule 19(c)):
#     each went red at its stale value against the rewritten prompt, and
#     each went red again under a one-hex-digit perturbation of the
#     constant with the prompt restored — so the comparison discriminates
#     on both sides, not just on whichever one moved.
#   ce8f59e0...23a8 — July 25, 2026: modules/spatial-flywheel/addendum.txt
#     gained a retrieval step, and its write steps stopped prescribing
#     citations the engine refuses. The module is DEFAULT_MODULE_SELECTION,
#     so this composed into every research run: step 1 loaded
#     q.sourceNodeIds through run_cypher, and the mandatory cache write
#     cited those same values as provenance with nothing in between reading
#     the bytes at those addresses. run_cypher feeds neither the read nor
#     the search bucket of _audit_add by design — a sourceNodeIds property
#     in a query result is a REFERENCE to bytes rather than the bytes — so
#     _verify_hashes_retrieved (src/rlm/trellis_tools.py:443), wired
#     unconditionally on research runs, refused exactly the batch the
#     module made mandatory. The new step 2 retrieves the deduped union of
#     the catalog's addresses in ONE get_ast_texts call, which charges the
#     per-run retrieval budget once per CALL whatever the batch size
#     (trellis_tools.py:888) — one fetch of 64 at any sweep size — and the
#     three write steps now cite only the elements that came back.
#     Read-then-cite is the legitimate act here, not an evasion: the gate's
#     own docstring scopes it to transcription and second-hand citation and
#     leaves read-then-cite to the sampled entailment tier, so what it asks
#     is that the run actually held the bytes. No predicate, bound, default
#     or refusal message moved; the engine was right and the module was
#     wrong. Authored under the prompt-engineering + hypershot-protocol
#     skills (Guardrail 15), brace-free as both loaders require.
#     15,658 -> 17,214 composed chars. Both pins were watched failing at
#     their stale values against the rewritten addendum before either was
#     trusted (rule 19(c)), and each new value was derived twice in
#     separate processes. The failure class is now checked rather than
#     remembered: scripts/test_module.ts refuses a module that names a
#     write surface without naming a retrieval surface earlier in its own
#     text, with both surface sets derived from trellis_tools.py's own call
#     sites rather than listed by hand.
COMPOSED_SYSTEM_PROMPT_SHA256 = "ce8f59e04f5e36e6ac6d8b23a2d40c93238e8da458d2c31f75f63bc052323a38"

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

check("composed SYSTEM_PROMPT is byte-identical to the recorded kernel prompt",
      hashlib.sha256(trellis_agent.SYSTEM_PROMPT.encode("utf-8")).hexdigest()
      == COMPOSED_SYSTEM_PROMPT_SHA256,
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

# Session 51 (RLM_HARNESS_SCAFFOLDING.md §7, S2a refinement,
# owner-ratified): the base addendum teaches the load-bearing UPSUM
# properties — the four lists rewritten IN PLACE each turn (never
# appended) and the size bound checked BY CODE against the injected
# UPSUM_BUDGET constant (CODE_MEDIATED_TEXT.md §1), not eyeballed.
#
# the July 19, 2026 harness-invariants pass (collaborator direction, owner-approved) moved WHERE the check
# lives: the model no longer computes len(str(upsum)) and self-corrects
# against a constant it was trusted to compare by eye — it registers the
# state with trellis_upsum.commit(), which measures and refuses
# engine-side. The rewrite-not-append property is unchanged; the
# code-checked property is now enforced rather than requested, so the
# assertion below tracks the surface instead of the old prose formula.
_base_addendum = trellis_agent.TRELLIS_ADDENDUM_BASE
check("the base addendum teaches the rewrite-not-append UPSUM rule",
      "IN PLACE" in _base_addendum and "never append" in _base_addendum)
check("the base addendum teaches the engine-checked UPSUM commit",
      "UPSUM_BUDGET" in _base_addendum
      and "trellis_upsum.commit(upsum)" in _base_addendum
      and "ENGINE-CHECKED" in _base_addendum)
check("the base addendum carries the brace-free upsum construction frame",
      "upsum = dict(" in _base_addendum
      and "decisive_facts=[...]" in _base_addendum)
check("trellis_agent re-exports the injected UPSUM_BUDGET constant (2000)",
      trellis_agent.UPSUM_BUDGET == 2000)

# July 19, 2026 (harness-invariants pass): task precedence stopped being prose-only. The addendum
# teaches the adjudication surface, and the surface is what a run's
# telemetry records — the rule 8 posture applied to the instruction
# channel (RLM_HARNESS_SCAFFOLDING.md §2).
check("the base addendum teaches code adjudication of instruction-shaped data",
      "trellis_task.verify(candidate)" in _base_addendum
      and "ADJUDICATE BY CODE" in _base_addendum)

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
# Version pin history: 1 (the July 9, 2026 first flywheel turn) -> 2
# (Session 21, July 10, 2026: re-authored through grounded authoring
# with the code-mediated-text pillar in the corpus).
check("module #1 loads with its manifest identity",
      module1["name"] == "workspace-discipline" and module1["version"] == 2)
check("module #1 addendum is brace-free and titled",
      "{" not in module1["addendum_text"] and "}" not in module1["addendum_text"]
      and "WORKSPACE DISCIPLINE PROTOCOL" in module1["addendum_text"])
check("module #1 addendum is LF-normalized", "\r" not in module1["addendum_text"])
check("v2 retired the transcription-mitigation line (pillar §5)",
      "reconstructing stored text" not in module1["addendum_text"])

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

# --- 6. Grounded authoring mode (Session 19) --------------------------------
# The author-mode setup functions compose the author prompt and tool dict
# with no completion and no database connection (design record §4/§6).
# The research-mode prompt pin above is untouched: author mode is a
# separate branch and a separate system prompt.
print("\n[6] grounded authoring mode (Session 19)")

from trellis_workspace import TrellisWorkspace  # noqa: E402

author_ws = TrellisWorkspace(max_segments=8, max_bytes=64 * 1024)
tools = trellis_agent.build_author_tools(author_ws)
check("author tool surface is exactly {trellis_workspace}",
      set(tools) == {"trellis_workspace"} and tools["trellis_workspace"] is author_ws)

check("AUTHOR_ADDENDUM is brace-free (rlms .format() safety)",
      "{" not in trellis_agent.AUTHOR_ADDENDUM and "}" not in trellis_agent.AUTHOR_ADDENDUM)

sample_template = (
    "GROUNDED AUTHORING TASK\n\nTOPIC: workspace discipline for an RLM\n\n"
    "derive the operating protocol this research corpus implies; record a gap note "
    "where the corpus is silent.\n"
)
author_prompt = trellis_agent.build_author_system_prompt(sample_template)
check("author prompt extends the rlms base REPL prompt (never replaces it)",
      author_prompt.startswith(RLM_SYSTEM_PROMPT))
check("author prompt contains the composed template verbatim",
      sample_template in author_prompt)
check("author prompt teaches the workspace surface and the draft output contract",
      "trellis_workspace.read()" in author_prompt
      and "gap_notes" in author_prompt and "purpose" in author_prompt)
check("author prompt does NOT carry the research directives or the DB tools",
      "trellis_neo4j" not in author_prompt and "trellis_postgres" not in author_prompt)
check("author prompt does NOT carry the research answer channel (Session 22)",
      "trellis_answer" not in author_prompt)
appended = author_prompt[len(RLM_SYSTEM_PROMPT):]
check("the author-added prompt text is brace-free after the base prompt",
      "{" not in appended and "}" not in appended)

draft = trellis_agent.extract_draft_envelope(
    'prose\n{"purpose": "p", "addendum": "PROTOCOL\\nrebind atomically", "gap_notes": ["none"]} trailing'
)
check("extract_draft_envelope pulls purpose/addendum/gapNotes from the answer",
      draft == {"purpose": "p", "addendum": "PROTOCOL\nrebind atomically", "gapNotes": ["none"]})
check("extract_draft_envelope also accepts camelCase gapNotes",
      trellis_agent.extract_draft_envelope('{"purpose":"p","addendum":"a","gapNotes":[]}')
      == {"purpose": "p", "addendum": "a", "gapNotes": []})
check("extract_draft_envelope returns None on non-JSON and on missing fields",
      trellis_agent.extract_draft_envelope("no json here") is None
      and trellis_agent.extract_draft_envelope('{"purpose": "p"}') is None)

# --- 6b. The author path's per-surface description slot (July 25, 2026) -----
# rlms reserves one description line per `custom_tools` entry and fills an
# undescribed one with "A custom <Type> value". The research path composed
# that slot from each surface's registered descriptor; this path did not,
# so an author run's one surface reached its model as
# "A custom TrellisWorkspace value" — a type name in the highest-primacy
# text the run sees about what it has, while the coverage diagnostic
# reported the research seam and read as though it meant both.
#
# WHY THE SAME BYTES AS THE RESEARCH LINE, in a regime that is not the
# research one. The line is WORKSPACE_DESCRIPTOR's own `purpose`, and
# WORKSPACE_ADDENDUM — spliced into this very prompt by
# build_author_system_prompt — already opens by calling the surface the
# model's working memory for plan, self-notes, and captured external
# results. The slot therefore states nothing this prompt does not already
# state, and a second characterization composed for this path would put
# two readings of one surface into one prompt
# (SELF_DESCRIBING_SURFACES.md §9.1). That premise is asserted below
# rather than assumed, so an addendum edit that moved the claim would take
# the reasoning's support with it.
print("\n[6b] the author path composes its surface's description")

from trellis_contribution import (  # noqa: E402
    attach_contributions,
    compose_contributions,
    render_contribution,
)
from trellis_surfaces import derive_delivery, descriptor_for  # noqa: E402
from trellis_workspace import (  # noqa: E402
    WORKSPACE_ADDENDUM,
    WORKSPACE_DESCRIPTOR,
    derive_workspace_expects,
)
from rlm.environments.base_env import format_tools_for_prompt  # noqa: E402

# The one renderer, never a local reimplementation: composing the line here
# would assert on this drill's own copy of the frame.
_author_line = render_contribution(
    WORKSPACE_DESCRIPTOR, derive_workspace_expects(author_ws, seeded=True))
_research_line = render_contribution(
    WORKSPACE_DESCRIPTOR, derive_workspace_expects(author_ws, seeded=False))

check("the author surface composes a non-empty line",
      _author_line != "", "the slot renders as a bare type name when empty")
check("the line is the descriptor's own purpose, re-authored nowhere",
      _author_line == WORKSPACE_DESCRIPTOR["purpose"], _author_line)
check("it is byte-identical to the line the research path composes for the "
      "same surface",
      _author_line == _research_line, f"{_author_line!r} vs {_research_line!r}")
check("and the prompt it lands in already states that claim, which is why "
      "one reading rather than two is correct here",
      "plan, self-notes, and captured external results" in WORKSPACE_ADDENDUM
      and WORKSPACE_ADDENDUM in author_prompt)
check("the composed line is brace-free (rlms .format() safety)",
      "{" not in _author_line and "}" not in _author_line)

# END TO END, through rlms's own renderer rather than a local idea of it:
# the type-name fallback is what the author surface used to render as, and
# is what it must no longer render as.
_described = attach_contributions(tools, compose_contributions([
    (descriptor_for(name),
     derive_workspace_expects(author_ws, seeded=True)
     if name == "trellis_workspace" else None)
    for name in tools
]))
check("rlms renders the composed line where it rendered a type name",
      format_tools_for_prompt(_described)
      == f"- `trellis_workspace`: {_author_line}",
      repr(format_tools_for_prompt(_described)))
check("the bare mapping is what rendered the type name",
      format_tools_for_prompt(tools)
      == "- `trellis_workspace`: A custom TrellisWorkspace value",
      repr(format_tools_for_prompt(tools)))
check("attaching a description preserves the tool value and the tool set",
      _described["trellis_workspace"]["tool"] is author_ws
      and set(_described) == set(tools) == {"trellis_workspace"})

# The description rides on custom_tools, not on the system prompt: rlms
# splices the listing into its own base prompt at format time. Pinned so a
# later pass cannot move the line into build_author_system_prompt's text
# without this going red — and it is the reason section [4]'s and [7]'s
# byte-identical pins are untouched by any of this.
check("the author system prompt is unchanged by the composition",
      trellis_agent.build_author_system_prompt(sample_template) == author_prompt
      and _author_line not in author_prompt)
check("the author prompt still opens with the rlms base prompt entire "
      "(the one-base contract)",
      author_prompt.startswith(RLM_SYSTEM_PROMPT))

# REACHABILITY (AGENTS.md rule 15: correct is a different claim from
# reachable). Everything above establishes that the frame renders a line
# for this surface; whether the AUTHOR RUN composes one is a separate
# claim, derived from trellis_agent.py's own source by the same read the
# coverage diagnostic uses — never restated here. The section [9]
# precedent, one seam over.
_seams = {seam["scope"]: seam for seam in derive_delivery()["seams"]}
check("the author run composes at its own seam, not merely correctly here",
      "run_author_mode" in _seams,
      f"composing seam(s): {sorted(_seams)}")
check("and what it composes is attached back and handed to rlms",
      _seams.get("run_author_mode", {}).get("delivered") is True,
      str(_seams.get("run_author_mode")))
check("its roster is the author seam itself, so a surface added to "
      "build_author_tools is described the moment it registers a line",
      _seams.get("run_author_mode", {}).get("seam_wide") is True,
      str(_seams.get("run_author_mode")))
check("the research seam is a separate answer and still delivers",
      _seams.get("main", {}).get("delivered") is True,
      str(_seams.get("main")))
check("no run mode hands rlms a seam it composed nothing for",
      derive_delivery()["rendering_without_composing"] == [],
      str(derive_delivery()["rendering_without_composing"]))

# --- 7. The experiment omission flag (Session 21, pillar §6.3) --------------
# TRELLIS_EXP_OMIT_CMT=1 is the effective-context probe's discipline-off
# arm: exactly the §6.2 CODE-MEDIATED TEXT block absent, nothing else
# changed. Unset stays byte-identical (section [4] above IS that pin —
# this process never sets the flag). The omitted composition is checked
# in a subprocess because the flag is read at import time.
print("\n[7] the experiment omission flag (TRELLIS_EXP_OMIT_CMT)")

# sha256 of the composed SYSTEM_PROMPT with the flag set. Pin history
# (moves in lockstep with the default pin above — recompute BOTH in the
# same commit on any witting kernel change):
#   abb945a6...f9b2 — through Session 21 this equaled the RECORDED
#     pre-Session-20 kernel byte-for-byte, because Session 20's only
#     kernel change was adding the CODE-MEDIATED TEXT block.
#   9779b5c0...9e45 — Session 22: the answer-channel revision (see the
#     default pin's history) lands in BOTH arms — the transcription fix
#     is a kernel bug fix, not part of the discipline experiment — so the
#     omit arm is no longer byte-identical to the pre-Session-20 prompt.
#     Its meaning is now purely structural: the default kernel with
#     exactly the CODE_MEDIATED_TEXT_BLOCK absent (the check below
#     re-proves that structure on every run).
#   85362b81...71bb — Session 24: the get_ast_blocks TOOLS line (see the
#     default pin's history) lands in BOTH arms — a localization tooling
#     fix, not part of the discipline experiment (the Session 22
#     precedent; still structurally default minus exactly the block).
#   45987904...0b56 — July 12, 2026 prompt-engineering pass (see the
#     default pin's history) lands in BOTH arms — structural rewording,
#     not part of the discipline experiment (still structurally default
#     minus exactly the block).
#   5d3057f2...7dd6 — Session 50 scaffolding pass (see the default
#     pin's history) lands in BOTH arms — the task surface, precedence
#     rule, and upsum discipline are kernel scaffolding, not part of
#     the discipline experiment (still structurally default minus
#     exactly the block).
#   a37d2b4a...764e — Session 50 same-day skills pass (see the default
#     pin's history) lands in BOTH arms — the structural re-authoring
#     of the scaffold addendum is not part of the discipline
#     experiment (still structurally default minus exactly the block).
#   34b00be6...d02a — Session 51 S2a UPSUM refinement (see the default
#     pin's history) lands in BOTH arms — the UPSUM tightening is
#     kernel scaffolding, not part of the discipline experiment (still
#     structurally default minus exactly the block).
#   322cbe5d...45ae — the July 19, 2026 harness-invariants pass (see the default
#     pin's history) lands in BOTH arms — the upsum commit gate and the
#     task adjudication surface are kernel scaffolding, not part of the
#     discipline experiment (still structurally default minus exactly
#     the block; the structural check below re-proves that on every run).
#   51eab4af...c0aa — the July 25, 2026 ITERATION BUDGET rewrite (see the
#     default pin's history) lands in BOTH arms — the batching directive
#     sat in _ADDENDUM_BASE_SUFFIX, which is kernel scaffolding rather
#     than part of the discipline experiment (still structurally default
#     minus exactly the block; the structural check below re-proves that
#     on every run). 15,406 composed chars with the flag set.
#   174bbd84...7e09 — the July 25, 2026 spatial-flywheel retrieval-step
#     repair (see the default pin's history) lands in BOTH arms — a module
#     addendum composes outside CODE_MEDIATED_TEXT_BLOCK entirely, and a
#     module prescribing a write the engine refuses is a defect in both
#     arms rather than part of the discipline experiment (still
#     structurally default minus exactly the block; the structural check
#     below re-proves that on every run). 16,962 composed chars with the
#     flag set.
EXP_OMIT_CMT_SYSTEM_PROMPT_SHA256 = "174bbd84b7104bdc046e712126ea9910af1d1c4e7b28dc1a90de57d590397e09"

import subprocess  # noqa: E402

check("the flag is unset in this drill's own environment",
      os.environ.get("TRELLIS_EXP_OMIT_CMT") is None
      and trellis_agent.EXP_OMIT_CMT_ENABLED is False)
check("the default composition carries the block exactly once",
      trellis_agent.SYSTEM_PROMPT.count(trellis_agent.CODE_MEDIATED_TEXT_BLOCK) == 1)

_rlm_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "rlm")
_child_code = (
    f"import sys; sys.path.insert(0, {_rlm_path!r}); "
    "import hashlib, json, trellis_agent; "
    "print(json.dumps(dict("
    "sha=hashlib.sha256(trellis_agent.SYSTEM_PROMPT.encode('utf-8')).hexdigest(), "
    "absent=trellis_agent.CODE_MEDIATED_TEXT_BLOCK not in trellis_agent.SYSTEM_PROMPT, "
    "enabled=trellis_agent.EXP_OMIT_CMT_ENABLED)))"
)
_child = subprocess.run(
    [sys.executable, "-c", _child_code],
    env={**os.environ, "TRELLIS_EXP_OMIT_CMT": "1"},
    capture_output=True, text=True,
)
check("flagged subprocess composes and reports", _child.returncode == 0,
      f"exit {_child.returncode}: {_child.stderr.strip()[:300]}")
_omitted = json.loads(_child.stdout.strip().splitlines()[-1]) if _child.returncode == 0 else {}
check("flag set: the block is absent and the gate reports enabled",
      _omitted.get("absent") is True and _omitted.get("enabled") is True)
check("flag set: the composed prompt matches the recorded omit-arm pin",
      _omitted.get("sha") == EXP_OMIT_CMT_SYSTEM_PROMPT_SHA256,
      str(_omitted.get("sha")))
_default_minus_block = trellis_agent.SYSTEM_PROMPT.replace(
    trellis_agent.CODE_MEDIATED_TEXT_BLOCK, "")
check("flag set: exactly the block is absent and nothing else changed",
      _omitted.get("sha")
      == hashlib.sha256(_default_minus_block.encode("utf-8")).hexdigest())

# --- 8. Module #2 (estimation-discipline) — RETIRED ------------------------
# Session 28 measured the positive control (criterion not met) and the
# owner retired the module the same day (roadmap §5, July 11, 2026).
# The manifest stays in the registry as the historical record with
# status "retired"; the ordinary loader must REFUSE to compose it, the
# name must still parse (selection shape is independent of status), and
# the default selection stays untouched — so the byte-identical pins in
# [4]/[7] never felt any of this.
print("\n[8] module #2 (estimation-discipline) — retired; the loader refuses it")

_manifest_path = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "modules",
    "estimation-discipline", "module.json")
with open(_manifest_path, "r", encoding="utf-8") as _fh:
    _manifest2 = json.load(_fh)
check("module #2 manifest survives as the historical record (retired, v1)",
      _manifest2["name"] == "estimation-discipline"
      and _manifest2["version"] == 1
      and _manifest2["status"] == "retired")
check("module #2 still pins its 19 research hashes (provenance is history, not status)",
      len(_manifest2["research"]["sourceNodeIds"]) == 19)
expect_raises("the ordinary loader refuses to compose a retired module",
              lambda: load_module("estimation-discipline"), "cannot be composed")
check("module #2 is NOT in the default selection (the byte-identical pin is untouched)",
      "estimation-discipline" not in list(DEFAULT_SELECTION))
check("the retired name still parses as selection shape (refusal happens at load)",
      parse_module_selection('["spatial-flywheel","estimation-discipline"]')
      == ["spatial-flywheel", "estimation-discipline"])

# --- 9. The active-modules segment (July 25, 2026) --------------------------
# `purpose` was validated by BOTH loaders (trellis_modules.load_module and
# src/config/modules.ts ModuleManifestSchema), carried into the loaded
# module dict by both, and read by nothing that composes a prompt. This
# section is that field's reader.
#
# The segment attaches at the RUN seam (dynamic_system_prompt), not inside
# TRELLIS_ADDENDUM, so the two byte-identical pins in [4] and [7] are
# untouched — which the checks below assert rather than assume.
#
# July 25, 2026 — the header stopped naming an author. Its first edition
# opened "The operator selected these protocol modules for this run",
# which rendered on the default run too: parse_module_selection returns
# the kernel's own DEFAULT_SELECTION when TRELLIS_MODULES is unset, so no
# operator act stood behind the sentence (.claude/rules/boundaries.md §3 — a
# gate has exactly one author, and a kernel default is not one). The
# replacement states the standing load_module actually settles and states
# the authorship as unrecorded. The checks below hold that line: they pin
# the arms IDENTICAL rather than merely happening to match, because the
# operator/kernel bit is unavailable in this process at all (see the
# TRELLIS_MODULES decoy check).
print("\n[9] the active-modules segment (what the run is told it is under)")

_active = build_active_modules_addendum([module0])

check("an empty selection composes the empty string (byte-identical prompt)",
      build_active_modules_addendum(load_modules([])) == ""
      and build_active_modules_addendum([]) == "")
check("the segment is brace-free (rlms .format() safety)",
      "{" not in _active and "}" not in _active)

# --- What the header claims about how this run's selection arose ----------
# The retired sentence, gone (the module #1 v2 retirement precedent in [5]).
check("the header no longer asserts an operator act",
      "The operator selected these protocol modules" not in _active)
# The standing load_module DOES settle before a module dict exists: the
# manifest is registered, its status is active, and it cleared every gate
# in the loader (trellis_modules.load_module).
check("the header states the standing the loader establishes",
      "registered active in this kernel's module registry" in _active
      and "passed the loader's validation before composition" in _active)
# The provenance fact that holds on BOTH arms: the selection is read once
# at import (trellis_agent.py:273, a module-level constant) and no later
# byte moves it.
check("the header states the selection is fixed at startup and holds for the run",
      "fixed from the process environment at startup" in _active
      and "holds unchanged for the whole run" in _active)
# Authorship is stated as unrecorded rather than left silent: a run reading
# this cannot claim an operator chose its protocol, and learns its protocol
# may be a kernel default.
check("the header states the selection's authorship is unrecorded",
      "How that selection arose is a fact this prompt does not carry" in _active
      and "treat its authorship as unknown to you" in _active)

# The arms are identical BY DESIGN now, not by accident. The composer takes
# module dicts and reads no environment, so the kernel-default selection and
# an explicit operator selection naming the same modules compose the same
# bytes — which is the honest rendering precisely because this process
# cannot tell the arms apart (next check).
_kernel_arm = build_active_modules_addendum(load_modules(parse_module_selection(None)))
_operator_arm = build_active_modules_addendum(
    load_modules(parse_module_selection(json.dumps(list(DEFAULT_SELECTION)))))
check("the kernel-default arm and the operator-set arm compose the same bytes",
      _kernel_arm == _operator_arm == _active)

# WHY the arm cannot be inferred here, pinned so a later session does not
# reach for the nearest available bit. `raw is None` is NOT the
# operator/kernel bit: rlm_worker.ts:298 forwards
# config.modules.selectionJson unconditionally and src/config/index.ts:413
# derives it from parseModuleSelection, which substitutes its own default
# when TRELLIS_MODULES is unset. This drill's wrapper (scripts/test_modules.ts)
# forwards it the same way, so THIS process is itself the demonstration:
# TRELLIS_MODULES is present and carries nothing but the kernel default.
check("a present TRELLIS_MODULES marks no operator act (this process is the case)",
      selection_env is not None
      and json.loads(selection_env) == list(DEFAULT_SELECTION)
      and parse_module_selection(selection_env) == parse_module_selection(None))

# The bytes come from the manifest, not from this drill and not from the
# composer: read module.json off disk and require the purpose verbatim.
_module0_manifest_path = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "modules",
    "spatial-flywheel", "module.json")
with open(_module0_manifest_path, "r", encoding="utf-8") as _fh:
    _manifest0 = json.load(_fh)
check("the line carries the manifest purpose verbatim (nothing re-authored)",
      f"- spatial-flywheel: {_manifest0['purpose']}" in _active
      and _manifest0["purpose"] == module0["purpose"])
check("one line per module, in selection order, each self-delimited",
      _active.startswith("\n\n=== PROTOCOL MODULES ACTIVE IN THIS RUN ===\n")
      and _active.endswith(f"{_manifest0['purpose']}\n")
      and len([ln for ln in _active.splitlines() if ln.startswith("- ")]) == 1)
_two_active = build_active_modules_addendum([module0, module1])
_two_lines = [ln for ln in _two_active.splitlines() if ln.startswith("- ")]
check("two selected modules compose two lines in selection order",
      len(_two_lines) == 2
      and _two_lines[0].startswith("- spatial-flywheel: ")
      and _two_lines[1].startswith("- workspace-discipline: "))

# The four ways a one-line entry breaks, refused rather than repaired.
def _fake(purpose):
    return [dict(name="m", version=1, purpose=purpose, addendum_text="")]


expect_raises("an empty purpose is refused",
              lambda: build_active_modules_addendum(_fake("")), "empty active-modules line")
expect_raises("a purpose with trailing slop is refused",
              lambda: build_active_modules_addendum(_fake("p  ")), "whitespace")
expect_raises("a multi-line purpose is refused",
              lambda: build_active_modules_addendum(_fake("p\nq")), "newline")
expect_raises("a purpose carrying a brace is refused",
              lambda: build_active_modules_addendum(_fake("p {x}")), "format")

# Inert modules contribute nothing by the SAME predicate that keeps their
# addenda out of the prompt: load_module refuses any status but active, so
# no module dict for them ever reaches the composer.
expect_raises("a contested module never becomes a composable module dict",
              lambda: load_module("reasoning-templates"), "cannot be composed")
check("only active modules can reach the composer (retired and contested refused at load)",
      all(load_module(n)["name"] == n for n in ("spatial-flywheel", "workspace-discipline")))

# Reachability (AGENTS.md rule 15: correct is a different claim from
# reachable). The composer is called at the research seam, derived from
# trellis_agent.py's own source rather than restated here.
import ast as _ast  # noqa: E402

with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                       "src", "rlm", "trellis_agent.py"), encoding="utf-8") as _src:
    _agent_tree = _ast.parse(_src.read())
_seam_calls = []
for _node in _ast.walk(_agent_tree):
    if isinstance(_node, _ast.Assign) and any(
            isinstance(t, _ast.Name) and t.id == "dynamic_system_prompt" for t in _node.targets):
        for _sub in _ast.walk(_node.value):
            if isinstance(_sub, _ast.Call) and isinstance(_sub.func, _ast.Name):
                _seam_calls.append(_sub.func.id)
check("the run seam calls the composer (reachable, not merely correct)",
      "build_active_modules_addendum" in _seam_calls)
check("trellis_agent selected exactly the modules the segment would name",
      [m["name"] for m in trellis_agent._SELECTED_MODULES] == list(DEFAULT_SELECTION))

# The pins in [4] and [7] are over SYSTEM_PROMPT. The segment lives past
# it, so both stayed put — asserted here so a later move into
# TRELLIS_ADDENDUM cannot happen quietly.
check("the segment is outside the pinned SYSTEM_PROMPT",
      "=== PROTOCOL MODULES ACTIVE IN THIS RUN ===" not in trellis_agent.SYSTEM_PROMPT
      and "=== PROTOCOL MODULES ACTIVE IN THIS RUN ===" not in trellis_agent.TRELLIS_ADDENDUM)

# ---------------------------------------------------------------------------
if failures:
    print(f"\n{failures} check(s) failed.")
    sys.exit(1)
print("\nAll module registry checks passed.")
