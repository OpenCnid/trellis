# Live zero-LLM test of the Session 20 code-mediated editing toolkit,
# run under the pinned interpreter via `npm run test:textedit`. No
# databases, no network, no paid work — every edit operates on
# token-scoped temp directories only (the wrapper creates the env-provided
# root; this drill creates its own throwaway roots for the rest).
#
# Layers under test (handoff §6 / design record CODE_MEDIATED_TEXT.md):
#   [1] defensive bounds re-validation (the parse_workspace_bounds twin),
#   [2] load/lines/locate — bounded slices and listings, engine-computed
#       addresses, over-cap raises,
#   [3] splice/diff/revert — staged edits compose, bounded correct diff,
#       revert restores the loaded frame,
#   [4] write_back happy path — atomic write, new digest, byte-compare,
#       byte-identical no-op round-trip (CRLF preserved),
#   [5] THE GUARD — disk mutation after load makes write_back RAISE and
#       write nothing; re-load recovers,
#   [6] containment — '..', absolute paths, and symlink escapes refused
#       before any I/O,
#   [7] budgets — per-file bytes and frame count refuse with usage;
#       drop() frees a slot,
#   [8] gating byte-identity — no TRELLIS_EDIT_ROOT means an unchanged
#       system prompt and an empty addendum; the on-addendum is
#       brace-free and teaches the discipline,
#   [9] LocalREPL persistence — the holder survives turns and scaffold
#       restore; the name does not exist when not injected,
#  [10] telemetry — counts only, never a path, pattern, or content,
#  [11] write_back hardening (Session 29, coverage audit #2/#3/#4) —
#       mode preservation, write-time containment re-verification,
#       resolution-change refusal, second-writer detection inside the
#       narrowed window, no orphaned temp file on refusal,
#  [12] multi-file partial-failure semantics (audit #5) — per-file
#       independence is intentional, pinned in both orders,
#  [13] guard adversarial checks (audit #6) — one check per previously
#       untested guard branch, plus the static no-subprocess/no-git
#       import guard (audit #8),
#  [14] the guarded splice family (Session 41, STRUCTURAL_SPLICE.md) —
#       anchor-verified minimal-span staging: the Session 36 run-1
#       address-drift shape refuses, the over-wide neighbor retype
#       refuses with the minimal window named, the Session 37 run-2
#       manifest shape STAGES (the honest-scope pin), the decomposed
#       minimal edit lands with neighbors byte-intact, and guarded
#       activity is counted separately from raw splices,
#  [15] guarded-only mode (the July 19, 2026 pass) — the explicit
#       off-switch: raw splice refused, guarded family intact, the
#       addendum follows the mode, defensive flag parsing,
#  [16] the self-describing descriptor (Workstream B increment 1,
#       HARNESS_SELF_MODEL.md §12.1) — the composed addendum reproduces
#       both hand-authored constants byte-exactly, one pin per arm; the
#       guard-expectation registry maps onto the rendered lines,
#  [17] the one-line contribution (July 25, 2026) — the other half of
#       the same self-description: the single line rlms reserves for
#       this surface orients and states no bound, byte-pinned, with the
#       section it addresses proved present in both rendered arms.
import ast
import hashlib
import json
import os
import re
import shutil
import stat
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "rlm"))
from trellis_textedit import (  # noqa: E402
    TrellisTextEdit,
    TextEditBudgetError,
    StaleFileError,
    AnchorMismatchError,
    RawSpliceDisabledError,
    TEXTEDIT_DESCRIPTOR,
    _TEXTEDIT_GUARD_EXPECTS,
    derive_textedit_expects,
    render_textedit_addendum,
    TEXTEDIT_SLICE_MAX_LINES,
    TEXTEDIT_LOCATE_MAX_HITS,
    TEXTEDIT_DIFF_MAX_LINES,
    TEXTEDIT_MAX_FILE_BYTES_DEFAULT,
    TEXTEDIT_MAX_FILES_DEFAULT,
    build_textedit_addendum,
    parse_textedit_bounds,
    parse_textedit_guarded_only,
)
import trellis_textedit as trellis_textedit_module  # noqa: E402
from trellis_tools import get_tool_call_count  # noqa: E402
# Section 17 composes through the one renderer, never a local copy of
# the frame: a drill that joined the pieces itself would be asserting
# on its own reimplementation rather than on what a run reads.
from trellis_contribution import render_contribution  # noqa: E402

failures = 0
temp_roots = []


def make_root():
    root = tempfile.mkdtemp(prefix="trellis-textedit-drill-")
    temp_roots.append(root)
    return root


def write_file(root, relpath, data):
    path = os.path.join(root, relpath)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
    return path


def read_file(root, relpath):
    with open(os.path.join(root, relpath), "rb") as f:
        return f.read()


def check(name, ok, detail=""):
    global failures
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail and not ok else ""))
    if not ok:
        failures += 1


def expect_raises(name, fn, exc_type, needle=""):
    try:
        fn()
        check(name, False, f"expected {exc_type.__name__}, nothing raised")
    except exc_type as e:
        check(name, needle.lower() in str(e).lower(), f"message lacked {needle!r}: {e}")
    except Exception as e:  # noqa: BLE001
        check(name, False, f"expected {exc_type.__name__}, got {type(e).__name__}: {e}")


# --- The addendum byte pins, one per mode arm --------------------------------
# The addendum is composed from TEXTEDIT_DESCRIPTOR plus the guard-derived
# expectations; these shas are what stops that composition from drifting.
# They do NOT touch the composed-prompt pins in scripts/test_modules.py:
# trellis_agent.SYSTEM_PROMPT, which those hash, does not contain this
# addendum — it is appended into the run's dynamic_system_prompt at
# injection time (SELF_DESCRIBING_SURFACES.md §11).
#
# HISTORY (append-only; recompute wittingly, never to make a test pass):
#   6b6db443…8948 / 27cc00b2…2835 — Workstream B increment 2, July 23,
#     2026: the seed values. These are the sha256 of the retired
#     TEXTEDIT_ADDENDUM and TEXTEDIT_ADDENDUM_GUARDED_ONLY constants
#     exactly as increment 1 proved the composition reproduces them, so
#     the pins inherit that proof rather than restating it. The
#     constants were retired in the same commit because keeping them
#     beside the descriptor shipped two encodings of one set of bytes —
#     SELF_DESCRIBING_SURFACES.md §9.1's failure class.
#   guarded arm → c673f0a0…f124 — increment 3, July 23, 2026: the
#     bijection orphan increment 1 recorded is CLOSED. The guarded-only
#     arm now states the line contract `_require_guarded_lines`
#     enforces, so a guarded-only run is no longer refused for a rule it
#     was never told. One bullet added, from the guard-owned
#     `newline_free` phrase the default arm already carried; the
#     DEFAULT arm's sha is unchanged, which is the check that the fix
#     reached exactly the arm that lacked the line. Neither
#     composed-prompt pin moves: this addendum is not in SYSTEM_PROMPT.
TEXTEDIT_ADDENDUM_SHA256 = "6b6db443e754561dee72d5815ea569c32b8ba1c0270225b37ed995b7e3638948"
TEXTEDIT_ADDENDUM_GUARDED_ONLY_SHA256 = "c673f0a07d8bd9c5c70cea729b8bfb13580c714ac53763ac280c82316a98f124"


# --- 1. Defensive bounds re-validation (twins of textedit_bounds.test.ts) ---
print("\n[1] parse_textedit_bounds re-validation")

check("unset env means the documented defaults",
      parse_textedit_bounds({}) == (TEXTEDIT_MAX_FILE_BYTES_DEFAULT, TEXTEDIT_MAX_FILES_DEFAULT)
      and (TEXTEDIT_MAX_FILE_BYTES_DEFAULT, TEXTEDIT_MAX_FILES_DEFAULT) == (4 * 1024 * 1024, 16))
check("blank values fall back to defaults",
      parse_textedit_bounds({"TRELLIS_TEXTEDIT_MAX_FILE_BYTES": " ",
                             "TRELLIS_TEXTEDIT_MAX_FILES": ""})
      == (4 * 1024 * 1024, 16))
check("explicit values inside the caps parse",
      parse_textedit_bounds({"TRELLIS_TEXTEDIT_MAX_FILE_BYTES": str(32 * 1024 * 1024),
                             "TRELLIS_TEXTEDIT_MAX_FILES": "64"})
      == (32 * 1024 * 1024, 64))
for bad_env in (
    {"TRELLIS_TEXTEDIT_MAX_FILES": "0"},
    {"TRELLIS_TEXTEDIT_MAX_FILES": "65"},
    {"TRELLIS_TEXTEDIT_MAX_FILES": "2.5"},
    {"TRELLIS_TEXTEDIT_MAX_FILE_BYTES": "-1"},
    {"TRELLIS_TEXTEDIT_MAX_FILE_BYTES": str(32 * 1024 * 1024 + 1)},
    {"TRELLIS_TEXTEDIT_MAX_FILE_BYTES": "huge"},
):
    expect_raises(f"bad bounds {bad_env} rejected",
                  lambda e=bad_env: parse_textedit_bounds(e), ValueError)

forwarded = parse_textedit_bounds()
check("wrapper-forwarded bounds pass Python re-validation (cross-language contract)",
      forwarded[0] >= 1 and forwarded[1] >= 1)

wrapper_root = os.environ.get("TRELLIS_EDIT_ROOT")
check("wrapper forwarded a validated edit root",
      bool(wrapper_root) and os.path.isdir(wrapper_root))
expect_raises("a non-directory root is refused at construction",
              lambda: TrellisTextEdit(os.path.join(wrapper_root, "no-such-dir")),
              ValueError, "not an existing directory")

# --- 2. load / lines / locate ------------------------------------------------
print("\n[2] load / lines / locate: bounded reads, engine-computed addresses")

root = make_root()
fixture = "alpha\nbeta target\ngamma\ndelta target\nepsilon\n"
write_file(root, "src/sample.txt", fixture.encode("utf-8"))
ted = TrellisTextEdit(root)

info = json.loads(ted.load("src/sample.txt"))
check("load returns path, lineCount, bytes, digest",
      info["path"] == "src/sample.txt"
      and info["lineCount"] == 6  # trailing newline yields a final empty line
      and info["bytes"] == len(fixture.encode("utf-8"))
      and info["digest"] == hashlib.sha256(fixture.encode("utf-8")).hexdigest())

sliced = json.loads(ted.lines("src/sample.txt", 1, 3))
check("lines() returns the half-open [start, end) slice as [index, text] pairs",
      sliced["lines"] == [[1, "beta target"], [2, "gamma"]])
check("path spellings normalize to one frame key",
      json.loads(ted.lines("./src/../src/sample.txt", 0, 1))["lines"] == [[0, "alpha"]])
expect_raises("an out-of-range slice raises with re-locate guidance",
              lambda: ted.lines("src/sample.txt", 4, 99), ValueError, "re-run")
expect_raises("a backwards range raises",
              lambda: ted.lines("src/sample.txt", 3, 1), ValueError, "0-based")
expect_raises("a non-integer index raises",
              lambda: ted.lines("src/sample.txt", "1", 2), ValueError, "integer")

located = json.loads(ted.locate("src/sample.txt", "target"))
check("locate() computes the addresses and the total count",
      located["totalHits"] == 2 and located["capped"] is False
      and [h["line"] for h in located["hits"]] == [1, 3]
      and located["hits"][0]["preview"] == "beta target")
regex_hits = json.loads(ted.locate("src/sample.txt", r"^(beta|delta)", regex=True))
check("locate() supports regex queries", [h["line"] for h in regex_hits["hits"]] == [1, 3])
expect_raises("a broken regex raises a readable error",
              lambda: ted.locate("src/sample.txt", "(unclosed", regex=True),
              ValueError, "regular expression")
expect_raises("an empty pattern raises",
              lambda: ted.locate("src/sample.txt", ""), ValueError, "non-empty")
expect_raises("operations on an unloaded file demand load() first",
              lambda: ted.lines("src/other.txt", 0, 1), ValueError, "load")

many_root = make_root()
write_file(many_root, "many.txt", ("hit\n" * 500).encode("utf-8"))
many = TrellisTextEdit(many_root)
many.load("many.txt")
capped = json.loads(many.locate("many.txt", "hit"))
check("locate() hit listing is bounded with the true total reported",
      capped["totalHits"] == 500 and capped["capped"] is True
      and len(capped["hits"]) == TEXTEDIT_LOCATE_MAX_HITS)
expect_raises("a slice wider than the per-call bound raises with the bound",
              lambda: many.lines("many.txt", 0, TEXTEDIT_SLICE_MAX_LINES + 1),
              ValueError, str(TEXTEDIT_SLICE_MAX_LINES))
check("a bound-sized slice is served",
      len(json.loads(many.lines("many.txt", 0, TEXTEDIT_SLICE_MAX_LINES))["lines"])
      == TEXTEDIT_SLICE_MAX_LINES)

binary_root = make_root()
write_file(binary_root, "blob.bin", b"\xff\xfe\x00binary")
bin_ted = TrellisTextEdit(binary_root)
expect_raises("non-UTF-8 files are refused at load (text toolkit only)",
              lambda: bin_ted.load("blob.bin"), ValueError, "utf-8")
expect_raises("a directory path is refused as not a regular file",
              lambda: ted.load("src"), ValueError, "regular file")

# --- 3. splice / diff / revert ----------------------------------------------
print("\n[3] splice / diff / revert: staged edits compose; disk untouched")

target_line = json.loads(ted.locate("src/sample.txt", "beta target"))["hits"][0]["line"]
spliced = json.loads(ted.splice("src/sample.txt", target_line, target_line + 1,
                                ["beta REPLACED", "beta INSERTED"]))
check("splice stages a replacement and reports the new shape",
      spliced["removed"] == 1 and spliced["inserted"] == 2
      and spliced["lineCount"] == 7 and spliced["pendingSplices"] == 1)
check("staged edits are visible to lines() (addresses shifted — re-locate)",
      json.loads(ted.lines("src/sample.txt", 1, 3))["lines"]
      == [[1, "beta REPLACED"], [2, "beta INSERTED"]])
second_target = json.loads(ted.locate("src/sample.txt", "delta target"))["hits"][0]["line"]
check("re-locate after the splice finds the shifted address", second_target == 4)
json.loads(ted.splice("src/sample.txt", second_target, second_target + 1, []))
check("a deletion splice is an empty new_lines list",
      json.loads(ted.locate("src/sample.txt", "delta target"))["totalHits"] == 0)
check("the disk file is untouched while edits are staged",
      read_file(root, "src/sample.txt") == fixture.encode("utf-8"))

diff = json.loads(ted.diff("src/sample.txt"))
check("diff shows the staged change against the loaded snapshot",
      "-beta target" in diff["diff"] and "+beta REPLACED" in diff["diff"]
      and "-delta target" in diff["diff"] and diff["pendingSplices"] == 2
      and diff["truncated"] is False)

expect_raises("splice refuses a bare string for new_lines (list required)",
              lambda: ted.splice("src/sample.txt", 0, 1, "oops"), ValueError, "list")
expect_raises("splice refuses embedded newlines (one string per line)",
              lambda: ted.splice("src/sample.txt", 0, 1, ["a\nb"]), ValueError, "newline")
expect_raises("splice validates the range like lines()",
              lambda: ted.splice("src/sample.txt", 90, 91, ["x"]), ValueError, "0-based")

reverted = json.loads(ted.revert("src/sample.txt"))
check("revert restores the loaded frame and zeroes pending splices",
      reverted["lineCount"] == 6
      and json.loads(ted.diff("src/sample.txt"))["diff"] == ""
      and json.loads(ted.lines("src/sample.txt", 1, 2))["lines"] == [[1, "beta target"]])

big_diff_root = make_root()
write_file(big_diff_root, "wide.txt", ("line\n" * 600).encode("utf-8"))
wide = TrellisTextEdit(big_diff_root)
wide.load("wide.txt")
wide.splice("wide.txt", 0, 600, ["changed-" + str(i) for i in range(600)])
wide_diff = json.loads(wide.diff("wide.txt"))
check("an oversized diff is truncated for display with the flag set (data untouched)",
      wide_diff["truncated"] is True
      and len(wide_diff["diff"].split("\n")) == TEXTEDIT_DIFF_MAX_LINES)

# --- 4. write_back happy path ------------------------------------------------
print("\n[4] write_back: atomic, digest-refreshing, byte-exact")

edit_line = json.loads(ted.locate("src/sample.txt", "gamma"))["hits"][0]["line"]
ted.splice("src/sample.txt", edit_line, edit_line + 1, ["gamma EDITED"])
written = json.loads(ted.write_back("src/sample.txt"))
expected = fixture.replace("gamma\n", "gamma EDITED\n").encode("utf-8")
check("write_back writes exactly the spliced frame (byte-compare)",
      read_file(root, "src/sample.txt") == expected
      and written["bytesWritten"] == len(expected)
      and written["newDigest"] == hashlib.sha256(expected).hexdigest())
check("write_back refreshes the held snapshot (diff empty, splices zeroed)",
      json.loads(ted.diff("src/sample.txt"))["diff"] == ""
      and json.loads(ted.diff("src/sample.txt"))["pendingSplices"] == 0)
ted.splice("src/sample.txt", 0, 1, ["alpha AGAIN"])
check("a second edit cycle against the refreshed digest succeeds",
      json.loads(ted.write_back("src/sample.txt"))["bytesWritten"] > 0)

crlf_root = make_root()
crlf_bytes = b"first\r\nsecond\r\nno-trailing-newline"
write_file(crlf_root, "crlf.txt", crlf_bytes)
crlf = TrellisTextEdit(crlf_root)
loaded = json.loads(crlf.load("crlf.txt"))
json.loads(crlf.write_back("crlf.txt"))
check("a no-op load -> write_back round-trip is byte-identical (CRLF preserved)",
      read_file(crlf_root, "crlf.txt") == crlf_bytes
      and json.loads(crlf.load("crlf.txt"))["digest"] == loaded["digest"])
hit = json.loads(crlf.locate("crlf.txt", "second"))["hits"][0]["line"]
crlf.splice("crlf.txt", hit + 1, hit + 1, ["inserted"])
crlf.write_back("crlf.txt")
check("moved CRLF lines keep their bytes verbatim; only authored lines are new",
      read_file(crlf_root, "crlf.txt") == b"first\r\nsecond\r\ninserted\nno-trailing-newline")

# Session 26 regression (found live by the Trellis-edits-Trellis proof
# run): REPLACING a line of a CRLF file must accept the replacement's
# trailing "\r" — under the split("\n") frame it is an ordinary byte
# within the line, and without it a CRLF line could never be replaced
# byte-verbatim.
crlf2_root = make_root()
write_file(crlf2_root, "crlf2.txt", b"alpha\r\nbeta\r\n")
crlf2 = TrellisTextEdit(crlf2_root)
crlf2.load("crlf2.txt")
beta_hit = json.loads(crlf2.locate("crlf2.txt", "beta"))["hits"][0]["line"]
beta_line = json.loads(crlf2.lines("crlf2.txt", beta_hit, beta_hit + 1))["lines"][0][1]
crlf2.splice("crlf2.txt", beta_hit, beta_hit + 1, [beta_line.replace("beta", "gamma")])
crlf2.write_back("crlf2.txt")
check("replacing a CRLF line keeps the carriage return byte verbatim",
      read_file(crlf2_root, "crlf2.txt") == b"alpha\r\ngamma\r\n")

# --- 5. THE GUARD ------------------------------------------------------------
print("\n[5] the hash guard: a moved file refuses the write, byte-provably")

guard_root = make_root()
original = b"guarded line one\nguarded line two\n"
write_file(guard_root, "guarded.txt", original)
guard = TrellisTextEdit(guard_root)
guard.load("guarded.txt")
guard.splice("guarded.txt", 0, 1, ["edited line one"])
# The file moves underneath the frame (a second writer).
moved = b"CHANGED BY ANOTHER WRITER\n"
write_file(guard_root, "guarded.txt", moved)
expect_raises("write_back RAISES on a digest mismatch",
              lambda: guard.write_back("guarded.txt"), StaleFileError, "digest mismatch")
check("the refused write left the disk file byte-untouched",
      read_file(guard_root, "guarded.txt") == moved)
expect_raises("the guard names the remedy (re-load and re-derive)",
              lambda: guard.write_back("guarded.txt"), StaleFileError, "re-load")
guard.load("guarded.txt")
guard.splice("guarded.txt", 0, 1, ["re-derived edit"])
check("re-load then write_back succeeds against the fresh digest",
      json.loads(guard.write_back("guarded.txt"))["bytesWritten"] > 0
      and read_file(guard_root, "guarded.txt") == b"re-derived edit\n")

os.unlink(os.path.join(guard_root, "guarded.txt"))
expect_raises("a deleted file is a stale frame, not a resurrection write",
              lambda: guard.write_back("guarded.txt"), StaleFileError, "no longer exists")
check("the stale write for the deleted file wrote nothing back",
      not os.path.exists(os.path.join(guard_root, "guarded.txt")))

# --- 6. Containment ----------------------------------------------------------
print("\n[6] containment: nothing outside the root is reachable, before any I/O")

jail_root = make_root()
write_file(jail_root, "inside.txt", b"inside\n")
outside_root = make_root()
outside_secret = write_file(outside_root, "secret.txt", b"outside the jail\n")
jail = TrellisTextEdit(jail_root)

expect_raises("'..' paths are refused",
              lambda: jail.load("../secret.txt"), ValueError, "escapes the edit root")
expect_raises("nested '..' escapes are refused",
              lambda: jail.load("a/../../secret.txt"), ValueError, "escapes the edit root")
expect_raises("POSIX absolute paths are refused",
              lambda: jail.load("/etc/passwd"), ValueError, "absolute")
expect_raises("Windows drive-absolute paths are refused",
              lambda: jail.load("C:/Windows/win.ini"), ValueError, "absolute")
expect_raises("empty paths are refused",
              lambda: jail.load(""), ValueError, "non-empty")

try:
    os.symlink(outside_secret, os.path.join(jail_root, "escape-link"))
    symlinks_available = True
except (OSError, NotImplementedError):
    symlinks_available = False
if symlinks_available:
    expect_raises("a symlink pointing outside the root is refused",
                  lambda: jail.load("escape-link"), ValueError, "outside the edit root")
    check("the symlink refusal never read the target",
          read_file(outside_root, "secret.txt") == b"outside the jail\n")
else:
    print("  [SKIP] symlink escape check (symlinks unavailable on this host/privilege level)")
check("paths inside the root still load normally",
      json.loads(jail.load("inside.txt"))["lineCount"] == 2)

# --- 7. Budgets ---------------------------------------------------------------
print("\n[7] budgets: per-file bytes and frame count refuse with usage")

budget_root = make_root()
write_file(budget_root, "big.txt", b"x" * 300)
write_file(budget_root, "ok.txt", b"small\n")
write_file(budget_root, "two.txt", b"second\n")
bounded = TrellisTextEdit(budget_root, max_file_bytes=200, max_files=1)
expect_raises("a file over the byte budget refuses at load",
              lambda: bounded.load("big.txt"), TextEditBudgetError, "file budget")
bounded.load("ok.txt")
expect_raises("a frame past the file-count budget refuses with usage and the drop() hint",
              lambda: bounded.load("two.txt"), TextEditBudgetError, "drop")
check("re-loading an already-held frame is not a new slot",
      json.loads(bounded.load("ok.txt"))["lineCount"] == 2)
dropped = json.loads(bounded.drop("ok.txt"))
check("drop() frees the slot and reports discarded staging",
      dropped["dropped"] is True and json.loads(bounded.load("two.txt"))["lineCount"] == 2)
expect_raises("dropping an unheld frame raises",
              lambda: bounded.drop("ok.txt"), ValueError, "no held frame")
expect_raises("a splice that would push the staged frame past the byte budget raises",
              lambda: bounded.splice("two.txt", 0, 0, ["y" * 300]),
              TextEditBudgetError, "file budget")
check("the over-budget splice staged nothing",
      json.loads(bounded.diff("two.txt"))["pendingSplices"] == 0)
expect_raises("constructor bounds are re-validated with the hard caps",
              lambda: TrellisTextEdit(budget_root, max_files=65), ValueError, "positive integer")

# --- 8. Gating byte-identity and the prompt addendum -------------------------
print("\n[8] gating: byte-identical prompt when off, brace-free addendum when on")

import trellis_agent  # noqa: E402
from rlm.utils.prompts import RLM_SYSTEM_PROMPT  # noqa: E402
from trellis_mcp import build_mcp_addendum  # noqa: E402
from trellis_workspace import build_workspace_addendum  # noqa: E402

check("module-level SYSTEM_PROMPT is untouched by Session 20",
      trellis_agent.SYSTEM_PROMPT == RLM_SYSTEM_PROMPT + trellis_agent.TRELLIS_ADDENDUM)
check("no toolkit means an empty addendum (byte-identical gated-off prompt)",
      build_textedit_addendum(None) == ""
      and trellis_agent.SYSTEM_PROMPT + build_mcp_addendum([])
      + build_workspace_addendum(None) + build_textedit_addendum(None)
      == trellis_agent.SYSTEM_PROMPT)

addendum = build_textedit_addendum(ted)
check("the toolkit addendum matches the recorded default-arm pin",
      hashlib.sha256(addendum.encode("utf-8")).hexdigest() == TEXTEDIT_ADDENDUM_SHA256)
check("addendum has no braces at all (rlms .format() safety)",
      "{" not in addendum and "}" not in addendum)
check("addendum teaches the discipline: locate, splice, re-locate, digest, atomic",
      "locate" in addendum and "splice" in addendum
      and "re-locate" in addendum.lower() and "digest" in addendum.lower()
      and "never retype" in addendum.lower())
check("addendum restates the hard provenance rule",
      "sourceNodeIds" in addendum and "NO provenance standing" in addendum)

# --- 9. LocalREPL persistence semantics --------------------------------------
print("\n[9] LocalREPL persistence (the workspace Appendix-A pin, re-pinned)")

from rlm.environments.local_repl import LocalREPL  # noqa: E402

pin_root = make_root()
write_file(pin_root, "pin.txt", b"one\ntwo\nthree\n")
pin_ted = TrellisTextEdit(pin_root)
repl = LocalREPL(context_payload="the context payload",
                 custom_tools={"trellis_textedit": pin_ted})
try:
    out = repl.execute_code("print(type(trellis_textedit).__name__)")
    check("injected toolkit holder is visible in the REPL",
          out.stdout.strip() == "TrellisTextEdit")
    repl.execute_code("import json\nframe = json.loads(trellis_textedit.load('pin.txt'))")
    out = repl.execute_code("print(frame['lineCount'])")
    check("REPL namespace and held frames persist across turns", out.stdout.strip() == "4")
    repl.execute_code("context = 'clobbered'")
    out = repl.execute_code("print(context)")
    check("scaffold restore puts `context` back after a model overwrite",
          out.stdout.strip() == "the context payload")
    out = repl.execute_code(
        "import json\nprint(json.loads(trellis_textedit.lines('pin.txt', 0, 1))['lines'])")
    check("scaffold restore leaves trellis_textedit and its frames intact",
          out.stdout.strip() == "[[0, 'one']]")
    out = repl.execute_code(
        "trellis_textedit.splice('pin.txt', 0, 1, ['ONE'])\nraise ValueError('boom')")
    check("the failing turn surfaces the exception", "ValueError: boom" in out.stderr)
    out = repl.execute_code(
        "import json\nprint(json.loads(trellis_textedit.diff('pin.txt'))['pendingSplices'])")
    check("holder mutations inside a failed block persist (staging survives model errors)",
          out.stdout.strip() == "1")
finally:
    repl.cleanup()

bare_repl = LocalREPL(context_payload="bare")
try:
    out = bare_repl.execute_code("print('trellis_textedit' in dir())")
    check("without the operator gate no trellis_textedit name exists in the REPL",
          out.stdout.strip() == "False")
finally:
    bare_repl.cleanup()

# --- 10. Telemetry -----------------------------------------------------------
print("\n[10] telemetry: counts only — never a path, pattern, or content")

stats = ted.stats()
check("stats() reports exactly the seven counters (five -> seven, July 19, 2026)",
      set(stats) == {"textedit_ops", "textedit_files", "textedit_writes",
                     "textedit_guarded_ops", "textedit_raw_splices",
                     "textedit_guarded_only", "textedit_raw_splice_refusals"}
      and stats["textedit_ops"] > 0 and stats["textedit_writes"] >= 2
      and stats["textedit_raw_splices"] > 0
      and stats["textedit_guarded_ops"] == 0
      # July 19, 2026 (harness-invariants pass): the mode itself is a bool so a run summary can tell a
      # raw-capable run that chose guarded calls from one where the
      # operator removed the raw path. Only the second is evidence about
      # the tool, so the two must not collapse into one zero.
      and stats["textedit_guarded_only"] is False
      and stats["textedit_raw_splice_refusals"] == 0
      and all(isinstance(v, (int, bool)) for v in stats.values()))
check("toolkit activity never increments the database tool-call count",
      get_tool_call_count() == 0)

# --- 11. write_back hardening (Session 29, coverage audit #2/#3/#4) ----------
print("\n[11] write_back hardening: mode, write-time containment, narrowed window")

import trellis_textedit as tt_module  # noqa: E402

# Audit #4: the replacement inode carries the source's mode. On POSIX the
# executable bit is the recorded failure (a script or git hook silently
# losing +x on every edit); on Windows mode equality is asserted so the
# behavior is pinned not-regressed on both platforms (handoff §6).
mode_root = make_root()
mode_path = write_file(mode_root, "hook.sh", b"#!/bin/sh\necho one\n")
if os.name == "posix":
    os.chmod(mode_path, 0o755)
mode_before = stat.S_IMODE(os.stat(mode_path).st_mode)
mode_ted = TrellisTextEdit(mode_root)
mode_ted.load("hook.sh")
mode_ted.splice("hook.sh", 1, 2, ["echo two"])
mode_ted.write_back("hook.sh")
check("write_back preserves the source file mode across the replacement",
      stat.S_IMODE(os.stat(mode_path).st_mode) == mode_before
      and read_file(mode_root, "hook.sh") == b"#!/bin/sh\necho two\n")
if os.name == "posix":
    check("the executable bit survives the replacement inode",
          os.stat(mode_path).st_mode & 0o111 == 0o111)
else:
    print("  [SKIP] executable-bit check (POSIX-only; mode equality asserted above)")

# Audit #3: containment re-verified at write time — a parent directory
# swapped for a symlink AFTER load is refused by the same load-time code
# path, re-run against the current filesystem.
def try_dir_symlink(src, dst):
    try:
        os.symlink(src, dst, target_is_directory=True)
        return True
    except (OSError, NotImplementedError):
        return False


swap_root = make_root()
write_file(swap_root, "sub/target.txt", b"inside sub\n")
outside_dir = make_root()
write_file(outside_dir, "target.txt", b"outside bytes\n")
swap = TrellisTextEdit(swap_root)
swap.load("sub/target.txt")
swap.splice("sub/target.txt", 0, 1, ["edited"])
shutil.rmtree(os.path.join(swap_root, "sub"))
if try_dir_symlink(outside_dir, os.path.join(swap_root, "sub")):
    expect_raises("a parent symlink swapped in after load refuses at write_back",
                  lambda: swap.write_back("sub/target.txt"),
                  ValueError, "outside the edit root")
    check("the refused write left the outside file untouched",
          read_file(outside_dir, "target.txt") == b"outside bytes\n"
          and not [n for n in os.listdir(outside_dir)
                   if n.startswith(".trellis-textedit-")])

    # A swap that stays INSIDE the root is caught by the resolution-change
    # refusal even when the target's bytes are identical (the digest guard
    # alone cannot see it — the resolution check is what refuses).
    move_root = make_root()
    write_file(move_root, "a/file.txt", b"same bytes\n")
    write_file(move_root, "b/file.txt", b"same bytes\n")
    mover = TrellisTextEdit(move_root)
    mover.load("a/file.txt")
    mover.splice("a/file.txt", 0, 1, ["edited"])
    shutil.rmtree(os.path.join(move_root, "a"))
    if try_dir_symlink(os.path.join(move_root, "b"), os.path.join(move_root, "a")):
        expect_raises("an in-root resolution change refuses even with identical bytes",
                      lambda: mover.write_back("a/file.txt"),
                      StaleFileError, "no longer resolves")
        check("the resolution-change refusal wrote nothing",
              read_file(move_root, "b/file.txt") == b"same bytes\n")
    else:
        print("  [SKIP] in-root resolution-change check (directory symlinks unavailable)")
else:
    print("  [SKIP] write-time containment swap checks (directory symlinks unavailable)")

# Audit #2: the narrowed window. A second writer landing while the temp
# file is being built (after the first digest check) is detected by the
# final re-check immediately before os.replace — simulated by wrapping
# mkstemp so the mutation lands deterministically inside the window.
narrow_root = make_root()
write_file(narrow_root, "narrow.txt", b"first bytes\n")
narrow = TrellisTextEdit(narrow_root)
narrow.load("narrow.txt")
narrow.splice("narrow.txt", 0, 1, ["edited bytes"])
second_writer = b"SECOND WRITER LANDED MID-WRITE\n"
real_mkstemp = tt_module.tempfile.mkstemp


def racing_mkstemp(*args, **kwargs):
    result = real_mkstemp(*args, **kwargs)
    write_file(narrow_root, "narrow.txt", second_writer)
    return result


tt_module.tempfile.mkstemp = racing_mkstemp
try:
    expect_raises("a second writer landing while the temp file is built is detected",
                  lambda: narrow.write_back("narrow.txt"),
                  StaleFileError, "second writer")
finally:
    tt_module.tempfile.mkstemp = real_mkstemp
check("the detected race left the second writer's bytes on disk",
      read_file(narrow_root, "narrow.txt") == second_writer)
check("the refused write left no orphaned temp file behind",
      [n for n in os.listdir(narrow_root) if n.startswith(".trellis-textedit-")] == [])

# --- 12. Multi-file partial-failure semantics (audit #5) ---------------------
print("\n[12] multi-file writes: per-file independence is intentional, both orders")

multi_root = make_root()
write_file(multi_root, "a.txt", b"alpha\n")
write_file(multi_root, "b.txt", b"beta\n")
multi = TrellisTextEdit(multi_root)
multi.load("a.txt")
multi.load("b.txt")
multi.splice("a.txt", 0, 1, ["alpha EDITED"])
multi.splice("b.txt", 0, 1, ["beta EDITED"])
write_file(multi_root, "b.txt", b"beta MOVED\n")
check("file A writes back even though file B's guard would refuse",
      json.loads(multi.write_back("a.txt"))["bytesWritten"] > 0
      and read_file(multi_root, "a.txt") == b"alpha EDITED\n")
expect_raises("file B refuses on its own digest, unaffected by A's success",
              lambda: multi.write_back("b.txt"), StaleFileError, "digest mismatch")
check("the partial outcome is intentional: A landed, B kept the second writer's bytes",
      read_file(multi_root, "a.txt") == b"alpha EDITED\n"
      and read_file(multi_root, "b.txt") == b"beta MOVED\n")
check("B's staged splice survives the refusal for re-derivation after re-load",
      json.loads(multi.diff("b.txt"))["pendingSplices"] == 1)

write_file(multi_root, "c.txt", b"gamma\n")
write_file(multi_root, "d.txt", b"delta\n")
multi2 = TrellisTextEdit(multi_root)
multi2.load("c.txt")
multi2.load("d.txt")
multi2.splice("c.txt", 0, 1, ["gamma EDITED"])
multi2.splice("d.txt", 0, 1, ["delta EDITED"])
write_file(multi_root, "c.txt", b"gamma MOVED\n")
expect_raises("a refusal FIRST (file C) is per-file too",
              lambda: multi2.write_back("c.txt"), StaleFileError, "digest mismatch")
check("file D still writes back after C's refusal",
      json.loads(multi2.write_back("d.txt"))["bytesWritten"] > 0
      and read_file(multi_root, "d.txt") == b"delta EDITED\n")

# --- 13. Guard adversarial checks (audit #6) + static import guard (#8) ------
print("\n[13] guard branches: one check per previously untested refusal branch")

adv_root = make_root()
write_file(adv_root, "adv.txt", b"one\ntwo\nthree\n")
adv = TrellisTextEdit(adv_root)
adv.load("adv.txt")
expect_raises("a boolean line index is refused (bool passes isinstance int)",
              lambda: adv.lines("adv.txt", True, 2), ValueError, "integer")
expect_raises("a boolean splice index is refused",
              lambda: adv.splice("adv.txt", 0, True, ["x"]), ValueError, "integer")
expect_raises("a boolean constructor bound is refused",
              lambda: TrellisTextEdit(adv_root, max_files=True),
              ValueError, "positive integer")
expect_raises("a non-string locate pattern is refused",
              lambda: adv.locate("adv.txt", 123), ValueError, "string")
expect_raises("a non-string path is refused before any I/O",
              lambda: adv.load(123), ValueError, "non-empty")
expect_raises("a non-string element inside new_lines is refused",
              lambda: adv.splice("adv.txt", 0, 1, ["ok", 5]), ValueError, "list")
adv.splice("adv.txt", 0, 1, ["staged-then-discarded"])
adv.load("adv.txt")
check("re-load refreshes from disk and discards staged splices (documented semantics)",
      json.loads(adv.diff("adv.txt"))["pendingSplices"] == 0
      and json.loads(adv.lines("adv.txt", 0, 1))["lines"] == [[0, "one"]])

# Audit #8: the no-git/no-subprocess guarantee held by inspection only —
# pin it statically. The import set is exact: a future subprocess or git
# surface fails this check before any reviewer has to catch it.
#
# Increment 2 widened it by exactly one first-party name,
# `trellis_surfaces`, so the toolkit can register its descriptor at its
# own definition site. That module is stdlib-only (ast, os) and holds a
# dict, so the no-subprocess/no-git guarantee is unchanged; the widening
# is recorded here rather than left to a reader to infer.
with open(tt_module.__file__, "r", encoding="utf-8") as f:
    toolkit_source = f.read()
imported = set()
for node in ast.walk(ast.parse(toolkit_source)):
    if isinstance(node, ast.Import):
        imported |= {alias.name.split(".")[0] for alias in node.names}
    elif isinstance(node, ast.ImportFrom):
        imported.add((node.module or "").split(".")[0])
allowed_imports = {"hashlib", "json", "os", "posixpath", "re", "stat",
                   "tempfile", "threading", "difflib", "trellis_surfaces"}
check("toolkit imports stay inside the pinned stdlib set",
      bool(imported) and imported <= allowed_imports,
      f"unexpected imports: {sorted(imported - allowed_imports)}")
check("no git or subprocess token anywhere in the toolkit source",
      re.search(r"\bgit\b", toolkit_source) is None
      and "subprocess" not in toolkit_source)

# --- 14. The guarded splice family (Session 41, STRUCTURAL_SPLICE.md) --------
print("\n[14] guarded splice family: anchor-verified, minimal-span staging")

g_root = make_root()
# The Session 37 run-2 neighborhood shape (REPOSITORY_INGESTION_REPORT.md
# §5f.5): a stale comment window above an executable line and a second
# comment head — the neighbors the retype-splice silently dropped.
g_seed = [
    "def main():",
    "    stats = {",
    '        "answer_submits": get_answer_submit_count(),',
    "        # Session 30: the size of the retrieved-address set -- a",
    "        # count only, never the addresses (T16). Bookkeeping;",
    "        # slice (d) will constrain citable addresses to the set.",
    '        "retrieved_addresses": get_retrieved_address_count(),',
    "        # Session 33: retrieval-discipline activity -- counts",
    "        # only, never an identity (T16).",
    "    }",
    "    return stats",
    "",
]
write_file(g_root, "telemetry.py", "\n".join(g_seed).encode("utf-8"))
gted = TrellisTextEdit(g_root)
gted.load("telemetry.py")

# (a) The Session 36 run-1 class: the model's belief about the removed
# bytes has drifted from the frame — refused before anything stages.
drifted = ["        # slice (d) would constrain citable addresses to the set."]
fresh = ["        # slice (d) is live: the constructor seam wires the set."]
expect_raises("the run-1 shape (address drift) refuses: stated bytes diverge from the frame",
              lambda: gted.replace_lines("telemetry.py", 5, 6, drifted, fresh),
              AnchorMismatchError, "anchor mismatch")
expect_raises("the anchor refusal teaches re-derive, never retype",
              lambda: gted.replace_lines("telemetry.py", 5, 6, drifted, fresh),
              AnchorMismatchError, "never retype lines from memory")
check("the anchor refusal staged nothing",
      json.loads(gted.diff("telemetry.py"))["pendingSplices"] == 0)

# (b) The minimality rule: a window sharing an unchanged leading line
# with new_lines is over-wide — refused, with the minimal window named.
expect_raises("an over-wide window with a retyped unchanged neighbor refuses",
              lambda: gted.replace_lines("telemetry.py", 4, 6,
                                         [g_seed[4], g_seed[5]],
                                         [g_seed[4], fresh[0]]),
              ValueError, "over-wide")
try:
    gted.replace_lines("telemetry.py", 4, 6, [g_seed[4], g_seed[5]], [g_seed[4], fresh[0]])
    check("the over-wide refusal names the minimal window", False, "nothing raised")
except ValueError as e:
    check("the over-wide refusal names the minimal window", "[5, 6)" in str(e), str(e))

# (c) The honest-scope pin (STRUCTURAL_SPLICE.md §4): the EXACT run-2
# shape driven through replace_lines with a fully-correct removal
# manifest STAGES — the removal of the executable neighbor is now an
# explicit verified declaration, not prevented. Asserted deliberately.
manifest = json.loads(gted.replace_lines(
    "telemetry.py", 5, 8,
    [g_seed[5], g_seed[6], g_seed[7]],
    ["        # slice (d) is live: this file wires the accessor into",
     "        # the write gate through the constructor seam on",
     "        # research runs."]))
check("the run-2 manifest shape STAGES (removal explicit, not prevented — honest scope)",
      manifest["guarded"] is True and manifest["removed"] == 3 and manifest["inserted"] == 3)
gted.revert("telemetry.py")

# (d) The decomposed correct edit: replace ONLY the changed line; the
# executable neighbor is outside the operation and survives on disk.
gted.replace_lines("telemetry.py", 5, 6, [g_seed[5]], fresh)
gted.write_back("telemetry.py")
g_after = read_file(g_root, "telemetry.py").decode("utf-8").split("\n")
check("the decomposed minimal edit landed with the executable neighbor byte-intact",
      g_after[5] == fresh[0] and g_after[6] == g_seed[6] and g_after[7] == g_seed[7])

# (e) Anchored insertion: nothing is removed by construction; a missing
# or diverged anchor refuses.
ins = json.loads(gted.insert_lines("telemetry.py", 2, ["        # inserted marker line"],
                                   anchor_before=g_seed[1], anchor_after=g_seed[2]))
check("anchored insertion stages between its verified neighbors",
      ins["at"] == 2 and ins["inserted"] == 1 and ins["guarded"] is True
      and ins["lineCount"] == len(g_seed) + 1)
gted.revert("telemetry.py")
expect_raises("insertion with no anchor refuses",
              lambda: gted.insert_lines("telemetry.py", 2, ["x"]),
              ValueError, "at least one anchor")
expect_raises("a diverged anchor_before refuses the insertion",
              lambda: gted.insert_lines("telemetry.py", 2, ["x"],
                                        anchor_before="    wrong = ("),
              AnchorMismatchError, "anchor_before")
expect_raises("anchor_before at index 0 is impossible",
              lambda: gted.insert_lines("telemetry.py", 0, ["x"], anchor_before="anything"),
              ValueError, "impossible")
expect_raises("anchor_after at the end index is impossible",
              lambda: gted.insert_lines("telemetry.py", len(g_seed), ["x"],
                                        anchor_after="anything"),
              ValueError, "impossible")

# (f) Guarded deletion: an explicit verified declaration.
write_file(g_root, "notes.txt", b"alpha\nbeta\ngamma\n")
gted.load("notes.txt")
expect_raises("a diverged expected_lines refuses the deletion",
              lambda: gted.delete_lines("notes.txt", 1, 2, ["betaX"]),
              AnchorMismatchError, "anchor mismatch")
del_res = json.loads(gted.delete_lines("notes.txt", 1, 2, ["beta"]))
check("guarded deletion removes exactly the declared verified line",
      del_res["removed"] == 1
      and json.loads(gted.lines("notes.txt", 0, 3))["lines"] == [[0, "alpha"], [1, "gamma"], [2, ""]])
gted.revert("notes.txt")
expect_raises("an empty expected_lines deletion refuses (state what you remove)",
              lambda: gted.delete_lines("notes.txt", 0, 0, []),
              ValueError, "non-empty")

# (g) Wrong-verb and shape refusals keep the verbs honest.
expect_raises("a pure insertion through replace_lines is steered to insert_lines",
              lambda: gted.replace_lines("notes.txt", 0, 0, [], ["x"]),
              ValueError, "insert_lines")
expect_raises("a pure deletion through replace_lines is steered to delete_lines",
              lambda: gted.replace_lines("notes.txt", 0, 1, ["alpha"], []),
              ValueError, "delete_lines")
expect_raises("a window/manifest length mismatch refuses before comparison",
              lambda: gted.replace_lines("notes.txt", 0, 2, ["alpha"], ["A"]),
              ValueError, "exactly the removed window")
expect_raises("identical expected and new lines refuse as a no-op",
              lambda: gted.replace_lines("notes.txt", 0, 1, ["alpha"], ["alpha"]),
              ValueError, "identical")
expect_raises("newline characters inside guarded new_lines are refused",
              lambda: gted.replace_lines("notes.txt", 0, 1, ["alpha"], ["a\nb"]),
              ValueError, "newline")

# (h) Budgets: an over-budget guarded staging refuses with usage and
# stages nothing (the section-7 mold).
tiny = TrellisTextEdit(g_root, max_file_bytes=32)
write_file(g_root, "tiny.txt", b"abcdef\n")
tiny.load("tiny.txt")
expect_raises("an over-budget guarded replacement refuses with usage",
              lambda: tiny.replace_lines("tiny.txt", 0, 1, ["abcdef"], ["x" * 64]),
              TextEditBudgetError, "budget exceeded")
check("the over-budget guarded call staged nothing",
      json.loads(tiny.diff("tiny.txt"))["pendingSplices"] == 0)

# (i) Telemetry: guarded activity counts separately from raw splices
# (the executable-class criterion lever: a guarded-only run is
# textedit_raw_splices == 0), and the addendum teaches the family.
g_stats = gted.stats()
check("guarded activity is counted separately from raw splices",
      g_stats["textedit_guarded_ops"] >= 4 and g_stats["textedit_raw_splices"] == 0)
_default_arm = build_textedit_addendum(TrellisTextEdit(g_root))
check("addendum teaches the guarded family and its anchor rule",
      "replace_lines" in _default_arm and "insert_lines" in _default_arm
      and "delete_lines" in _default_arm and "AnchorMismatchError" in _default_arm
      and "GUARDED FAMILY" in _default_arm)

# --- 15. Guarded-only mode: the explicit off-switch (the July 19, 2026 pass) -------------
# Session 41 built the guarded family but left raw splice() reachable with
# the preference stated only in prompt prose — the closure was available,
# not enforced, and the guarded/raw telemetry split could only measure the
# choice after the fact. This section pins the off-switch.
print("\n[15] guarded-only mode: raw splice refused, guarded family intact")

go_root = tempfile.mkdtemp(prefix="trellis_textedit_guardedonly_")
temp_roots.append(go_root)
with open(os.path.join(go_root, "m.py"), "w", encoding="utf-8", newline="") as fh:
    fh.write("alpha\nbeta\ngamma\n")

go = TrellisTextEdit(go_root, guarded_only=True)
go.load("m.py")
try:
    go.splice("m.py", 0, 1, ["ALPHA"])
    check("guarded-only refuses raw splice", False)
except RawSpliceDisabledError as e:
    check("guarded-only refuses raw splice", True)
    check("the refusal names the guarded replacements",
          "replace_lines" in str(e) and "insert_lines" in str(e)
          and "delete_lines" in str(e))

# The refusal must stage nothing: the frame is untouched afterwards.
check("a refused raw splice stages nothing",
      json.loads(go.lines("m.py", 0, 3))["lines"][0][1] == "alpha")
# The guarded family is unaffected by the mode.
check("the guarded family still stages under guarded-only",
      json.loads(go.replace_lines("m.py", 0, 1, ["alpha"], ["ALPHA"]))["inserted"] == 1)
go_stats = go.stats()
check("guarded-only telemetry distinguishes mode from behavior",
      go_stats["textedit_guarded_only"] is True
      and go_stats["textedit_raw_splice_refusals"] == 1
      and go_stats["textedit_raw_splices"] == 0
      and go_stats["textedit_guarded_ops"] >= 1)

# Default construction is unchanged — the additive rule for operator gates.
default_mode = TrellisTextEdit(go_root)
default_mode.load("m.py")
check("raw splice still works when the switch is off (default)",
      json.loads(default_mode.splice("m.py", 0, 1, ["ALPHA"]))["inserted"] == 1
      and default_mode.stats()["textedit_guarded_only"] is False)

# The addendum follows the mode: a run is never taught a call that refuses.
_guarded_arm = build_textedit_addendum(go)
_raw_arm = build_textedit_addendum(default_mode)
check("guarded-only swaps the addendum, never teaching the raw path",
      "GUARDED-ONLY MODE IS ACTIVE" in _guarded_arm
      and "RawSpliceDisabledError" in _guarded_arm
      and "new_lines)` stages the replacement" not in _guarded_arm
      and "new_lines)` stages the replacement" in _raw_arm
      and build_textedit_addendum(None) == "")
check("both addendum arms stay brace-free (rlms .format() safety)",
      "{" not in _guarded_arm and "}" not in _guarded_arm
      and "{" not in _raw_arm and "}" not in _raw_arm)
# The two arms differ ONLY in the mode block. With the hand-authored
# fragments retired, the property is asserted on the RENDERED arms: they
# share the header block and every family bullet, diverging only between.
_head_end = "\n- `trellis_textedit.load"
_tail_start = "- `trellis_textedit.replace_lines"
check("the two addendum arms share header and family bullets exactly",
      _raw_arm[:_raw_arm.index(_head_end)] == _guarded_arm[:_guarded_arm.index(_head_end)]
      and _raw_arm[_raw_arm.index(_tail_start):]
      == _guarded_arm[_guarded_arm.index(_tail_start):])

# The operator switch parses defensively: a misspelled safety flag must
# never silently resolve to the unsafe default.
check("the off-switch defaults to off when unset or blank",
      parse_textedit_guarded_only({}) is False
      and parse_textedit_guarded_only({"TRELLIS_TEXTEDIT_GUARDED_ONLY": "  "}) is False)
check("the off-switch accepts the documented truthy and falsy spellings",
      all(parse_textedit_guarded_only({"TRELLIS_TEXTEDIT_GUARDED_ONLY": v}) is True
          for v in ("1", "true", "TRUE", "Yes", "on"))
      and all(parse_textedit_guarded_only({"TRELLIS_TEXTEDIT_GUARDED_ONLY": v}) is False
              for v in ("0", "false", "No", "OFF")))
malformed_raised = []
for bad in ("yep", "2", "enabled", "-1"):
    try:
        parse_textedit_guarded_only({"TRELLIS_TEXTEDIT_GUARDED_ONLY": bad})
        malformed_raised.append(False)
    except ValueError:
        malformed_raised.append(True)
check("a malformed off-switch value raises rather than defaulting to unsafe",
      all(malformed_raised))
expect_raises("the constructor refuses a non-bool guarded_only",
              lambda: TrellisTextEdit(go_root, guarded_only="1"), ValueError)

# --- 16. The self-describing descriptor (Workstream B increments 1-2) ------
# Increment 1 (HARNESS_SELF_MODEL.md §12.1's pre-stated first test) proved
# the composition reproduces the hand-authored constants byte-exactly on
# both arms. Increment 2 retired those constants — keeping them beside the
# descriptor shipped two encodings of one set of bytes, which is
# SELF_DESCRIBING_SURFACES.md §9.1's failure class — so the pins are now
# sha256 over the RENDERED arms, seeded with the retired constants' own
# digests. The claim they carry: these bytes are still the bytes
# increment 1 validated, and the descriptor is the only place they live.
print("\n[16] descriptor-composed addendum: sha256 pin per arm")


def sha_of(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


rendered_default = render_textedit_addendum(
    TEXTEDIT_DESCRIPTOR, derive_textedit_expects(default_mode))
check("PIN default arm: rendered bytes match the recorded sha256",
      sha_of(rendered_default) == TEXTEDIT_ADDENDUM_SHA256,
      f"got {sha_of(rendered_default)} over {len(rendered_default)} chars")

rendered_guarded = render_textedit_addendum(
    TEXTEDIT_DESCRIPTOR, derive_textedit_expects(go))
check("PIN guarded arm: rendered bytes match the recorded sha256",
      sha_of(rendered_guarded) == TEXTEDIT_ADDENDUM_GUARDED_ONLY_SHA256,
      f"got {sha_of(rendered_guarded)} over {len(rendered_guarded)} chars")

# The descriptor is now the SOLE encoding of these bytes: the retired
# constants must not come back, because a second copy beside the
# descriptor is precisely what §9.1 forbids.
check("the retired constants stay retired (one encoding, not two)",
      not hasattr(trellis_textedit_module, "TEXTEDIT_ADDENDUM")
      and not hasattr(trellis_textedit_module, "TEXTEDIT_ADDENDUM_GUARDED_ONLY")
      and not hasattr(trellis_textedit_module, "_TEXTEDIT_ADDENDUM_HEAD"))

# The live path ships the composition (trellis_agent.py holds the
# non-test caller), so section 15's constants-equality checks above
# already exercised the renderer end to end; re-state it explicitly.
check("build_textedit_addendum ships the composition on both arms",
      build_textedit_addendum(default_mode) == rendered_default
      and build_textedit_addendum(go) == rendered_guarded)

# One state refuses AND describes (HARNESS_SELF_MODEL.md §2.1): the arm
# selection reads the same _guarded_only bool splice() refuses on — the
# refusal itself was pinned in section 15 on these same holders.
check("the mode account derives from the refusing bool itself",
      derive_textedit_expects(go)["guarded_only"] is True
      and derive_textedit_expects(default_mode)["guarded_only"] is False)

# The registry→line half of the bijection (HARNESS_SELF_MODEL.md §3 /
# §12.3): every guard-owned phrase renders into the arm(s) it belongs
# to, and the shared anchor-guard phrase reaches BOTH arms from ONE
# encoding — the two arms cannot drift apart on it.
# Increment 3 moved `newline_free` from raw-only to shared: closing the
# orphan is exactly that key gaining a line in the guarded arm.
_guarded_only_keys = {"guarded_mode_active", "raw_disabled"}
_shared_keys = set(_TEXTEDIT_GUARD_EXPECTS) - _guarded_only_keys
check("every shared guard phrase renders in both arms",
      all(_TEXTEDIT_GUARD_EXPECTS[k] in rendered_default
          and _TEXTEDIT_GUARD_EXPECTS[k] in rendered_guarded
          for k in _shared_keys))
check("the mode-specific phrases render only in their own arm",
      all(_TEXTEDIT_GUARD_EXPECTS[k] in rendered_guarded
          and _TEXTEDIT_GUARD_EXPECTS[k] not in rendered_default
          for k in _guarded_only_keys))
check("the anchor-guard expectation is one encoding rendered once per arm",
      rendered_default.count(_TEXTEDIT_GUARD_EXPECTS["anchor_guard"]) == 1
      and rendered_guarded.count(_TEXTEDIT_GUARD_EXPECTS["anchor_guard"]) == 1)

# The orphan increment 1 recorded, now CLOSED (increment 3): the guarded
# arm enforces the newline-free line contract through
# _require_guarded_lines, and now states it, so a guarded-only run is not
# refused for a rule it was never told. Held from BOTH sides — the line
# is present, and it comes from the same single encoding the default arm
# renders, so the two arms cannot drift apart on it.
check("the newline-free contract now has a line in the guarded arm",
      _TEXTEDIT_GUARD_EXPECTS["newline_free"] in rendered_guarded)
check("that line is the guarded family's own contract, stated once",
      rendered_guarded.count("expected_lines and new_lines are each") == 1
      and rendered_guarded.count(_TEXTEDIT_GUARD_EXPECTS["newline_free"]) == 1)

# The guard-expectation inventory is closed and pre-stated: a key
# added or dropped without touching this pin is drift.
check("the guard-expectation inventory is exactly the pre-stated set",
      set(_TEXTEDIT_GUARD_EXPECTS) == {
          "containment", "addressing", "slice_bound", "locate_bound",
          "newline_free", "anchor_guard", "replace_match", "over_wide",
          "insert_anchor", "delete_verified", "digest_guard", "budgets",
          "guarded_mode_active", "raw_disabled"})

# One encoding, enforced both ways: no guard-owned phrase may be
# restated inside the descriptor's editorial strings (the second-copy
# failure class SELF_DESCRIBING_SURFACES.md §9.1 exists to close).
_editorial_bits = [TEXTEDIT_DESCRIPTOR["purpose"], TEXTEDIT_DESCRIPTOR["category"]]
_editorial_bits += list(TEXTEDIT_DESCRIPTOR["usage"].values())
for _e in TEXTEDIT_DESCRIPTOR["exposes"]:
    for _g in ([_e] if "group" not in _e else _e["group"]):
        _editorial_bits += [p for p in _g.get("doc", []) if isinstance(p, str)]
check("no guard-owned phrase is restated in an editorial field",
      not any(phrase in bit
              for phrase in _TEXTEDIT_GUARD_EXPECTS.values()
              if len(phrase) >= 30
              for bit in _editorial_bits))

# --- 17. The one-line contribution (July 25, 2026) --------------------------
# The other half of this surface's self-description. rlms renders each
# custom_tools entry as exactly one line, `- name: description`, spliced
# into its base prompt ahead of every Trellis directive; until this
# increment trellis_textedit passed a bare value, so the highest-primacy
# sentence a run read about this surface was "A custom TrellisTextEdit
# value" — a type name.
#
# The split section 16 pins and this section pins hold together, and
# neither is the whole read on its own: the guard-backed expectations
# are carried IN FULL by the addendum and NOT ONE of them is in the
# one-line slot, because a bound stated by half is worse than a bound
# read where it is enforced (trellis_contribution.py, "WHAT THE SLOT CAN
# AND CANNOT CARRY"). What the slot carries instead is orientation plus
# the address of the section that does state the contract — which is why
# the pointer's target is proved present below rather than assumed.
#
# The literal below is a SECOND COPY on purpose, in the test and only
# here (the PINNED_LEGACY_SYSTEM precedent, .claude/rules/boundaries.md
# §2): editing the descriptor alone turns this red. Measured at 142
# characters by the renderer, not estimated.
print("\n[17] the one-line contribution: orientation, no bound")

TEXTEDIT_CONTRIBUTION = (
    "edits files under the operator-configured edit root. Its contract "
    "is stated in full in the TEXT EDITING (CODE-MEDIATED, HASH-GUARDED) "
    "section.")

composed_line = render_contribution(
    TEXTEDIT_DESCRIPTOR, derive_textedit_expects(default_mode))
check("PIN: the composed line is the recorded bytes",
      composed_line == TEXTEDIT_CONTRIBUTION,
      f"got {composed_line!r} ({len(composed_line)} chars)")

# The frame refuses each of these, so this asserts on the value a run
# actually reads rather than trusting the refusal to have been reached.
check("the line is one line, brace-free, and edge-trimmed",
      "\n" not in composed_line and "\r" not in composed_line
      and "{" not in composed_line and "}" not in composed_line
      and composed_line == composed_line.strip()
      and composed_line != "")

# The addendum swaps arms; the listing line does not. A guarded-only run
# reads the same orientation, because nothing in this composition is
# mode-selected — the mode account is an expectation, and expectations
# are addendum-carried.
check("the line is identical on both mode arms",
      render_contribution(TEXTEDIT_DESCRIPTOR, derive_textedit_expects(go))
      == composed_line)

# The property the retired scripts/test_surfaces.py pin reached only by
# proxy, stated directly and held from both sides: the slot orients, and
# no guard-owned phrase is in it. The derived expectations are passed
# even though the composition has no ("expects", ...) slot today —
# that is the point, since a slot added later would resolve to its guard
# phrase and turn this red.
check("no guard-owned phrase reaches the one-line slot",
      not any(phrase in composed_line
              for phrase in _TEXTEDIT_GUARD_EXPECTS.values()),
      f"a guard phrase reached the slot: {composed_line!r}")

# One encoding, enforced on the line itself: both fact-carrying pieces
# are ("descriptor", field) slots, so the bytes that state something are
# the descriptor's and the bytes this list authors are the connective
# only (SELF_DESCRIBING_SURFACES.md §9.1).
_pulled = composed_line.replace(TEXTEDIT_DESCRIPTOR["purpose"], "", 1)
_pulled = _pulled.replace(TEXTEDIT_DESCRIPTOR["category"], "", 1)
check("the line restates nothing: its facts are pulled, its authored bytes connect",
      TEXTEDIT_DESCRIPTOR["purpose"] in composed_line
      and TEXTEDIT_DESCRIPTOR["category"] in composed_line
      and _pulled == "".join(p for p in TEXTEDIT_DESCRIPTOR["contributes"]
                             if isinstance(p, str)),
      f"remainder {_pulled!r}")

# The pointer resolves. Both come from `category`, so they cannot drift
# apart in wording — what this catches is the renderer dropping the
# banner, which would leave the line addressing a section no run has.
check("the section the line addresses is present in both rendered arms",
      TEXTEDIT_DESCRIPTOR["category"] in rendered_default
      and TEXTEDIT_DESCRIPTOR["category"] in rendered_guarded)

# Section 16's shas are the standing proof that adding this field moved
# no addendum byte; restated here so the two halves are read together.
check("adding the contribution moved no addendum byte",
      sha_of(rendered_default) == TEXTEDIT_ADDENDUM_SHA256
      and sha_of(rendered_guarded) == TEXTEDIT_ADDENDUM_GUARDED_ONLY_SHA256)

# ---------------------------------------------------------------------------
for stale_root in temp_roots:
    shutil.rmtree(stale_root, ignore_errors=True)

if failures:
    print(f"\n{failures} check(s) failed.")
    sys.exit(1)
print("\nAll textedit checks passed.")
