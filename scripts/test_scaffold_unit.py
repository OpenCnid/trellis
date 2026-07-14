# Session 50 (RLM_HARNESS_SCAFFOLDING.md): the scaffold-module unit
# battery, spawned by src/rlm/trellis_scaffold.test.ts inside plain
# `npm test` (the block_parity precedent — trellis_scaffold.py and
# trellis_textedit.py are stdlib-only, so no database runtime is
# needed). Prints ONE JSON line the vitest side asserts field by
# field. The citability probe's database half is drilled live by
# test:rlm-sandbox section [8]; here only its gating composes.
import json
import os
import shutil
import sys
import tempfile

sys.path.insert(0, sys.argv[1])

from trellis_scaffold import (  # noqa: E402
    CITABLE_ADDENDUM,
    HELPERS_ADDENDUM,
    TASK_GREP_MAX_HITS,
    TrellisTask,
    build_citable_addendum,
    build_helpers_addendum,
    build_scaffold_helpers,
    parse_task_named_files,
    wrap_task_text,
)
from trellis_textedit import TrellisTextEdit  # noqa: E402

out = {}


def raised(fn):
    """The exception message, or None when nothing raised."""
    try:
        fn()
        return None
    except Exception as e:  # noqa: BLE001
        return f"{type(e).__name__}: {e}"


# --- S1: the uuid wrapper ------------------------------------------------
out["wrap"] = wrap_task_text("TASK BODY", "abc-123")
out["wrap_refusals"] = [
    raised(lambda: wrap_task_text("", "u")),
    raised(lambda: wrap_task_text("t", "  ")),
    raised(lambda: wrap_task_text("t", "a{b}")),
    raised(lambda: wrap_task_text(None, "u")),
]

# --- S1: the trellis_task surface ---------------------------------------
TASK = "line one\nRULE: braces {stay} verbatim\r\nline three"
task = TrellisTask(TASK, "uuid-1")
out["task_text_verbatim"] = task.text() == TASK
out["task_uuid"] = task.uuid
out["task_refusals"] = [
    raised(lambda: TrellisTask("", "u")),
    raised(lambda: TrellisTask("t", "")),
]
out["grep"] = json.loads(task.grep("RULE"))
out["grep_invalid_regex"] = raised(lambda: task.grep("("))
out["grep_empty_pattern"] = raised(lambda: task.grep(""))
big = TrellisTask("\n".join(f"hit {i}" for i in range(TASK_GREP_MAX_HITS + 10)), "u")
g = json.loads(big.grep("hit"))
out["grep_cap"] = {
    "total": g["totalHits"],
    "returned": len(g["hits"]),
    "capped": g["capped"],
    "max": TASK_GREP_MAX_HITS,
}

# --- the named-files driver input ----------------------------------------
out["ptnf_unset"] = parse_task_named_files({}) is None
out["ptnf_blank"] = parse_task_named_files({"TRELLIS_TASK_NAMED_FILES": "  "}) is None
out["ptnf_empty_array"] = parse_task_named_files({"TRELLIS_TASK_NAMED_FILES": "[]"}) is None
out["ptnf_valid"] = parse_task_named_files({
    "TRELLIS_TASK_NAMED_FILES": json.dumps(
        ["src\\config\\index.ts", "src/config/rlm_backend.test.ts", "src/config/index.ts"]
    )
})
out["ptnf_refusals"] = [
    raised(lambda: parse_task_named_files({"TRELLIS_TASK_NAMED_FILES": "{oops"})),
    raised(lambda: parse_task_named_files({"TRELLIS_TASK_NAMED_FILES": '"x"'})),
    raised(lambda: parse_task_named_files({"TRELLIS_TASK_NAMED_FILES": json.dumps([str(i) for i in range(17)])})),
    raised(lambda: parse_task_named_files({"TRELLIS_TASK_NAMED_FILES": "[42]"})),
    raised(lambda: parse_task_named_files({"TRELLIS_TASK_NAMED_FILES": json.dumps(["x" * 513])})),
]

# --- S3: frame helpers over a real toolkit --------------------------------
root = tempfile.mkdtemp(prefix="scaffold-unit-")
try:
    with open(os.path.join(root, "lf.txt"), "wb") as f:
        f.write(b"alpha\nbeta\ngamma\n")
    with open(os.path.join(root, "crlf.txt"), "wb") as f:
        f.write(b"one\r\ntwo\r\nthree")
    ted = TrellisTextEdit(root)
    helpers = build_scaffold_helpers(textedit=ted)
    out["helper_names"] = sorted(helpers)
    ted.load("lf.txt")
    ted.load("crlf.txt")

    out["frame_text_lf"] = helpers["frame_text"]("lf.txt") == "alpha\nbeta\ngamma\n"
    out["frame_text_crlf"] = helpers["frame_text"]("crlf.txt") == "one\r\ntwo\r\nthree"
    out["frame_text_unloaded"] = raised(lambda: helpers["frame_text"]("nope.txt"))

    out["region_lines"] = helpers["region_lines"]("lf.txt", 1, 3)
    out["region_lines_out_of_range"] = raised(lambda: helpers["region_lines"]("lf.txt", 2, 99))
    out["region_lines_bad_index"] = raised(lambda: helpers["region_lines"]("lf.txt", "0", 1))

    out["region_equal_true_crlf"] = helpers["region_equal"]("crlf.txt", 0, ["one\r", "two\r"])
    out["region_equal_false"] = helpers["region_equal"]("lf.txt", 0, ["alpha", "WRONG"])
    out["region_equal_newline_refused"] = raised(lambda: helpers["region_equal"]("lf.txt", 0, ["a\nb"]))
    out["region_equal_empty_refused"] = raised(lambda: helpers["region_equal"]("lf.txt", 0, []))

    out["concat"] = helpers["concat_files"](["lf.txt", "crlf.txt"])
    out["concat_unloaded"] = raised(lambda: helpers["concat_files"](["lf.txt", "nope.txt"]))
    out["concat_bad_arg"] = raised(lambda: helpers["concat_files"]([]))

    # Helpers read the WORKING frame: a staged splice is visible before
    # write_back, and region_equal tracks it.
    ted.splice("lf.txt", 0, 1, ["ALPHA"])
    out["frame_text_staged"] = helpers["frame_text"]("lf.txt") == "ALPHA\nbeta\ngamma\n"
    out["region_equal_staged"] = helpers["region_equal"]("lf.txt", 0, ["ALPHA"])

    # --- gating (the build_mcp_addendum precedent) ------------------------
    out["gate_bare"] = build_scaffold_helpers() == {}
    out["gate_textedit_only"] = sorted(build_scaffold_helpers(textedit=ted))
    out["gate_named_files_without_postgres"] = sorted(build_scaffold_helpers(
        named_files=["a.ts"], retrieved_addresses_fn=set))

    class FakePostgres:
        conn = None

    citable_only = build_scaffold_helpers(
        postgres=FakePostgres(), retrieved_addresses_fn=set, named_files=["a.ts"])
    out["gate_citable_only"] = sorted(citable_only)
    everything = build_scaffold_helpers(
        textedit=ted, postgres=FakePostgres(), retrieved_addresses_fn=set,
        named_files=["a.ts"])
    out["gate_everything"] = sorted(everything)

    # --- addenda -----------------------------------------------------------
    out["addenda_off_empty"] = (
        build_helpers_addendum({}) == "" and build_citable_addendum({}) == ""
        and build_helpers_addendum(citable_only) == ""
        and build_citable_addendum(build_scaffold_helpers(textedit=ted)) == ""
    )
    out["addenda_on"] = (
        build_helpers_addendum(everything) == HELPERS_ADDENDUM
        and build_citable_addendum(everything) == CITABLE_ADDENDUM
    )
    out["addenda_brace_free"] = (
        "{" not in HELPERS_ADDENDUM and "}" not in HELPERS_ADDENDUM
        and "{" not in CITABLE_ADDENDUM and "}" not in CITABLE_ADDENDUM
    )
finally:
    shutil.rmtree(root, ignore_errors=True)

print(json.dumps(out))
