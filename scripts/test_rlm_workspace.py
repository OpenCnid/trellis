# Live zero-LLM test of the Session 14 Tier-3 workspace, run under the
# pinned interpreter via `npm run test:rlm-workspace`. The only server
# involved is the local deterministic fixture (spawned over stdio by the
# TrellisMcp client itself) — no network, no paid work, no databases.
#
# Four layers under test:
#   [1] defensive bounds re-validation (the parse_mcp_config precedent),
#   [2] the workspace holder surface (index/segment/plan/notes/drop/
#       snapshot, wrapper-owned stamps, budget raises, structural
#       disjointness from AST hashes),
#   [3] mechanical capture inside trellis_mcp.call_tool (stub returns,
#       truncation stamps, deterministic discard on budget),
#   [4] gated-off byte-identity and the direct-LocalREPL persistence
#       semantics pin against the installed rlms==0.1.3 (Appendix A of
#       the design record) — an rlms upgrade that changes namespace
#       semantics must fail this suite loudly.
import hashlib
import json
import os
import re
import sys
import time
import uuid as uuid_module

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "rlm"))
from trellis_workspace import (  # noqa: E402
    TrellisWorkspace,
    WorkspaceBudgetError,
    WORKSPACE_ADDENDUM,
    build_workspace_addendum,
    parse_workspace_bounds,
    WORKSPACE_MAX_SEGMENTS_DEFAULT,
    WORKSPACE_MAX_BYTES_DEFAULT,
    WORKSPACE_MAX_SEGMENTS_CAP,
    WORKSPACE_MAX_BYTES_CAP,
)
from trellis_tools import AST_HASH_PATTERN, get_tool_call_count, _node_text  # noqa: E402
from trellis_mcp import TrellisMcp, parse_mcp_config, get_mcp_call_count  # noqa: E402

failures = 0


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


# --- 0. AST text reconstruction (get_ast_texts markdown fix) ----------------
# get_ast_texts/vector_search read block text; markdown block nodes
# (paragraph/heading/listItem) carry no direct `content` (it lives in child
# nodes), so data->>'content' reads NULL. _node_text reconstructs it
# (mirrors traverse.ts nodeText) so the RLM can read markdown and promoted
# research it is meant to cite.
print("\n[0] _node_text reconstruction (markdown get_ast_texts fix)")
check("content-bearing node returns its content directly",
      _node_text({"type": "NarrativeText", "content": "direct text"}) == "direct text")
check("markdown-shaped block reconstructs text from children in order",
      _node_text({"type": "paragraph", "children": [
          {"type": "text", "content": "Globex "},
          {"type": "strong", "children": [{"type": "text", "content": "acquired"}]},
          {"type": "text", "content": " Initech"},
      ]}) == "Globex acquired Initech")
check("a JSON-string node payload is parsed before reconstruction",
      _node_text('{"type": "paragraph", "children": [{"type": "text", "content": "hi"}]}') == "hi")
check("childless, contentless node reconstructs to empty (not None)",
      _node_text({"type": "thematicBreak"}) == "")

# --- 1. Defensive bounds re-validation (twins of workspace_bounds.test.ts) --
print("\n[1] parse_workspace_bounds re-validation")

check("unset env means the documented defaults",
      parse_workspace_bounds({}) == (WORKSPACE_MAX_SEGMENTS_DEFAULT, WORKSPACE_MAX_BYTES_DEFAULT)
      and (WORKSPACE_MAX_SEGMENTS_DEFAULT, WORKSPACE_MAX_BYTES_DEFAULT) == (128, 4 * 1024 * 1024))
check("blank values fall back to defaults",
      parse_workspace_bounds({"TRELLIS_WORKSPACE_MAX_SEGMENTS": " ", "TRELLIS_WORKSPACE_MAX_BYTES": ""})
      == (128, 4 * 1024 * 1024))
check("explicit values inside the caps parse",
      parse_workspace_bounds({"TRELLIS_WORKSPACE_MAX_SEGMENTS": "1024",
                              "TRELLIS_WORKSPACE_MAX_BYTES": str(32 * 1024 * 1024)})
      == (1024, 32 * 1024 * 1024))
for bad_env in (
    {"TRELLIS_WORKSPACE_MAX_SEGMENTS": "0"},
    {"TRELLIS_WORKSPACE_MAX_SEGMENTS": "1025"},
    {"TRELLIS_WORKSPACE_MAX_SEGMENTS": "2.5"},
    {"TRELLIS_WORKSPACE_MAX_BYTES": "-1"},
    {"TRELLIS_WORKSPACE_MAX_BYTES": str(32 * 1024 * 1024 + 1)},
    {"TRELLIS_WORKSPACE_MAX_BYTES": "huge"},
):
    expect_raises(f"bad bounds {bad_env} rejected",
                  lambda e=bad_env: parse_workspace_bounds(e), ValueError)

forwarded = parse_workspace_bounds()
check("wrapper-forwarded bounds pass Python re-validation (cross-language contract)",
      forwarded[0] >= 1 and forwarded[1] >= 1)

# --- 2. The workspace holder surface ----------------------------------------
print("\n[2] workspace holder: index, segments, plan, notes, budgets, stamps")

ws = TrellisWorkspace(max_segments=8, max_bytes=64 * 1024, goal_id="goal-42", task_id="task-7")

empty_index = json.loads(ws.read())
check("empty index has the version-tagged dict shape",
      empty_index["version"] == 1 and empty_index["plan"] == [] and empty_index["notes"] == []
      and empty_index["segments"] == {} and empty_index["usage"]["segments"] == 0)

plan = [dict(id="s1", desc="find sources", status="pending"),
        dict(id="s2", desc="derive insight", status="pending")]
json.loads(ws.set_plan(plan))
json.loads(ws.add_note("checked the graph first"))
index = json.loads(ws.read())
check("plan and notes round-trip through the index",
      index["plan"] == plan and index["notes"] == ["checked the graph first"])
expect_raises("non-JSON-serializable plan rejected (data-not-objects contract)",
              lambda: ws.set_plan([dict(step=object())]), ValueError, "json-serializable")
expect_raises("empty note rejected", lambda: ws.add_note(""), ValueError, "non-empty")

stub = ws.capture(server="websearch", tool="web_search", args_hash="ab12cd34ef56ab78",
                  content="the fetched result body", truncated=False)
check("capture returns the stub shape",
      set(stub) == {"server", "tool", "segmentId", "bytes", "truncated", "preview"}
      and stub["bytes"] == len("the fetched result body") and stub["truncated"] is False)
segment_id = stub["segmentId"]
check("segment ids are uuid-shaped",
      str(uuid_module.UUID(segment_id)) == segment_id)
check("segment ids FAIL the AST hash pattern (structural disjointness pin)",
      not AST_HASH_PATTERN.match(segment_id))

record = json.loads(ws.segment(segment_id))
check("segment() returns the full origin-stamped record",
      record["content"] == "the fetched result body"
      and record["origin"] == {"server": "websearch", "tool": "web_search", "argsHash": "ab12cd34ef56ab78"}
      and record["truncated"] is False
      and re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", record["fetchedAt"]))
check("segments carry goal/task correlation when present",
      record["goalId"] == "goal-42" and record["taskId"] == "task-7")
check("the index never carries segment content",
      "content" not in json.loads(ws.read())["segments"][segment_id])
expect_raises("unknown segment id raises a readable error",
              lambda: ws.segment("nope"), ValueError, "unknown workspace segment")

snapshot = json.loads(ws.snapshot())
check("snapshot() is the canonical full state dict (the lineage seam)",
      snapshot["version"] == 1 and snapshot["segments"][segment_id]["content"] == "the fetched result body"
      and ws.snapshot() == json.dumps(snapshot, sort_keys=True, separators=(",", ":")))

dropped = json.loads(ws.drop(segment_id))
check("drop() frees the segment and reports the freed bytes",
      dropped["freedBytes"] == stub["bytes"] and json.loads(ws.read())["segments"] == {})
expect_raises("dropping an unknown id raises",
              lambda: ws.drop(segment_id), ValueError, "unknown workspace segment")

# Budgets: raises carry usage and the drop() hint; state is never torn.
tiny = TrellisWorkspace(max_segments=2, max_bytes=200)
tiny.capture(server="s", tool="t", args_hash="h1", content="a" * 50, truncated=False)
second = tiny.capture(server="s", tool="t", args_hash="h2", content="b" * 50, truncated=False)
expect_raises("segment budget exhaustion raises with usage and a drop() hint",
              lambda: tiny.capture(server="s", tool="t", args_hash="h3", content="c", truncated=False),
              WorkspaceBudgetError, "drop")
check("a failed capture stores nothing (deterministic discard)",
      json.loads(tiny.read())["usage"]["segments"] == 2)
tiny.drop(second["segmentId"])
recovered = tiny.capture(server="s", tool="t", args_hash="h3", content="c" * 50, truncated=False)
check("drop() recovers the budget for a retry", bool(recovered["segmentId"]))
byte_ws = TrellisWorkspace(max_segments=8, max_bytes=200)
expect_raises("byte budget exhaustion raises before storing",
              lambda: byte_ws.capture(server="s", tool="t", args_hash="h4", content="d" * 201, truncated=False),
              WorkspaceBudgetError, "byte budget")
check("the over-byte-budget capture stored nothing",
      json.loads(byte_ws.read())["usage"]["bytes"] == 0)
expect_raises("notes respect the byte budget too",
              lambda: byte_ws.add_note("n" * 201), WorkspaceBudgetError, "byte budget")
expect_raises("plans respect the byte budget too",
              lambda: byte_ws.set_plan(["p" * 201]), WorkspaceBudgetError, "byte budget")
expect_raises("constructor bounds are re-validated with the hard caps",
              lambda: TrellisWorkspace(max_segments=4096), ValueError, "positive integer")

stats = ws.stats()
check("stats() reports counts only (ops/segments/bytes)",
      set(stats) == {"workspace_ops", "workspace_segments", "workspace_bytes"}
      and stats["workspace_ops"] > 0 and stats["workspace_segments"] == 0)

# --- 3. Mechanical capture inside trellis_mcp.call_tool ---------------------
print("\n[3] capture fires inside call_tool against the live fixture")

servers = parse_mcp_config(os.environ.get("TRELLIS_MCP_SERVERS"))
check("wrapper forwarded the two-server registry",
      {s["name"] for s in servers} == {"websearch", "smallcap"})

capture_ws = TrellisWorkspace(max_segments=8, max_bytes=256 * 1024, goal_id="goal-live")
client = TrellisMcp(servers, workspace=capture_ws)
legacy_client = TrellisMcp(servers)  # no workspace: the pre-Session-14 surface
try:
    stub_raw = client.call_tool("websearch", "web_search", {"query": "trellis provenance"})
    stub = json.loads(stub_raw)
    check("call_tool returns a JSON stub when a workspace is attached",
          set(stub) == {"server", "tool", "segmentId", "bytes", "truncated", "preview"}
          and stub["server"] == "websearch" and stub["tool"] == "web_search")
    check("stub preview is bounded to 500 chars", len(stub["preview"]) <= 500)
    check("stub segment id is uuid-shaped and fails the AST hash pattern",
          str(uuid_module.UUID(stub["segmentId"])) == stub["segmentId"]
          and not AST_HASH_PATTERN.match(stub["segmentId"]))

    legacy_raw = legacy_client.call_tool("websearch", "web_search", {"query": "trellis provenance"})
    legacy = json.loads(legacy_raw)
    check("without a workspace, call_tool returns the byte-identical legacy shape",
          set(legacy) == {"server", "tool", "result"}
          and legacy_raw == json.dumps({"server": "websearch", "tool": "web_search",
                                        "result": legacy["result"]}))

    captured = json.loads(capture_ws.segment(stub["segmentId"]))
    check("the captured segment holds the FULL result the legacy path returns",
          captured["content"] == legacy["result"] and captured["bytes"] == stub["bytes"])
    check("origin stamps are wrapper-owned and match the actual call",
          captured["origin"]["server"] == "websearch" and captured["origin"]["tool"] == "web_search"
          and re.match(r"^[0-9a-f]{16}$", captured["origin"]["argsHash"])
          and not AST_HASH_PATTERN.match(captured["origin"]["argsHash"]))
    check("segments from goal runs carry the goal id", captured["goalId"] == "goal-live")

    stub2 = json.loads(client.call_tool("websearch", "web_search", {"query": "trellis provenance"}))
    check("same arguments, same argsHash (deterministic origin)",
          json.loads(capture_ws.segment(stub2["segmentId"]))["origin"]["argsHash"]
          == captured["origin"]["argsHash"])
    stub3 = json.loads(client.call_tool("websearch", "web_search", {"query": "different"}))
    check("different arguments, different argsHash",
          json.loads(capture_ws.segment(stub3["segmentId"]))["origin"]["argsHash"]
          != captured["origin"]["argsHash"])

    big = json.loads(client.call_tool("smallcap", "oversized_search", {"query": "x"}))
    big_seg = json.loads(capture_ws.segment(big["segmentId"]))
    check("a size-capped result is captured with truncated=True stamped",
          big["truncated"] is True and big_seg["truncated"] is True
          and "TRELLIS_MCP_TRUNCATED" in big_seg["content"])

    # Budget trip THROUGH call_tool: the raise crosses out of the tool
    # call and the result is discarded deterministically.
    one_slot = TrellisWorkspace(max_segments=1, max_bytes=256 * 1024)
    one_client = TrellisMcp(servers, workspace=one_slot)
    try:
        one_client.call_tool("websearch", "web_search", {"query": "first"})
        expect_raises("a capture that trips the budget raises out of call_tool",
                      lambda: one_client.call_tool("websearch", "web_search", {"query": "second"}),
                      WorkspaceBudgetError, "drop")
        check("the over-budget result was discarded, stored state untouched",
              json.loads(one_slot.read())["usage"]["segments"] == 1)
    finally:
        one_client.close()

    # The MCP surface's result-shape account, on both live arms. The
    # sentence about what call_tool returns when a workspace is attached
    # lives in WORKSPACE_ADDENDUM today, but the predicate that decides it
    # is trellis_mcp.call_tool's `self._workspace is not None` branch — so
    # the descriptor layer homes it there, and derive_mcp_expects selects
    # the arm by reading the very attribute the branch reads
    # (HARNESS_SELF_MODEL.md §2.1). Both clients above just exercised their
    # own arm, so the account is checked against observed return shapes.
    from trellis_mcp import derive_mcp_expects, _MCP_GUARD_EXPECTS  # noqa: E402
    attached = derive_mcp_expects(client)
    detached = derive_mcp_expects(legacy_client)
    check("the result-shape account is selected by the attribute call_tool branches on",
          attached["capturesToWorkspace"] is True
          and detached["capturesToWorkspace"] is False
          and attached["result_shape"] is _MCP_GUARD_EXPECTS["capture_stub"]
          and detached["result_shape"] is _MCP_GUARD_EXPECTS["direct_result"])
    check("the attached arm's account names the stub this run actually received",
          all(word in attached["result_shape"]
              for word in ("STUB", "server", "tool", "segment id", "preview"))
          and set(stub) == {"server", "tool", "segmentId", "bytes", "truncated", "preview"})
    check("the detached arm's account names the inline result this run actually received",
          "inline" in detached["result_shape"] and set(legacy) == {"server", "tool", "result"})

    check("workspace and MCP activity never increment the database tool-call count",
          get_tool_call_count() == 0)
    check("MCP usage is still counted separately for telemetry", get_mcp_call_count() >= 5)
    live_stats = capture_ws.stats()
    check("workspace telemetry counters reflect captures (counts only)",
          live_stats["workspace_segments"] == 4 and live_stats["workspace_bytes"] > 0)
finally:
    client.close()
    legacy_client.close()

# --- 4. Gating byte-identity and the prompt addendum ------------------------
print("\n[4] gating: byte-identical prompt when off, brace-free addendum when on")

import trellis_agent  # noqa: E402
from rlm.utils.prompts import RLM_SYSTEM_PROMPT  # noqa: E402
from trellis_mcp import build_mcp_addendum  # noqa: E402

check("module-level SYSTEM_PROMPT is untouched by Session 14",
      trellis_agent.SYSTEM_PROMPT == RLM_SYSTEM_PROMPT + trellis_agent.TRELLIS_ADDENDUM)
check("no workspace means an empty addendum (byte-identical gated-off prompt)",
      build_workspace_addendum(None) == ""
      and trellis_agent.SYSTEM_PROMPT + build_mcp_addendum([]) + build_workspace_addendum(None)
      == trellis_agent.SYSTEM_PROMPT)

addendum = build_workspace_addendum(ws)
check("workspace addendum has no braces at all (rlms .format() safety)",
      "{" not in addendum and "}" not in addendum)
check("addendum teaches the surface and the atomic-update idiom",
      "trellis_workspace.read()" in addendum and "segment(" in addendum
      and "rebind" in addendum.lower())
check("addendum restates the hard provenance rule",
      "sourceNodeIds" in addendum and "NEVER" in addendum)

# --- 5. Direct-LocalREPL semantics pin against rlms==0.1.3 ------------------
print("\n[5] LocalREPL persistence semantics (Appendix A pin, rlms==0.1.3)")

from rlm.environments.local_repl import LocalREPL  # noqa: E402

pin_ws = TrellisWorkspace(max_segments=8, max_bytes=64 * 1024)
repl = LocalREPL(context_payload="the context payload",
                 custom_tools={"trellis_workspace": pin_ws})
try:
    # Plain variables persist across execute_code calls.
    repl.execute_code("x = 41")
    out = repl.execute_code("x += 1\nprint(x)")
    check("REPL namespace persists across turns", out.stdout.strip() == "42")

    # The injected holder is live in the namespace and is the SAME object
    # the harness holds: a harness-side capture between turns is visible
    # from REPL code on the next turn.
    out = repl.execute_code("print(type(trellis_workspace).__name__)")
    check("injected workspace holder is visible in the REPL", out.stdout.strip() == "TrellisWorkspace")
    harness_stub = pin_ws.capture(server="s", tool="t", args_hash="deadbeefdeadbeef",
                                  content="between-turn capture", truncated=False)
    out = repl.execute_code(
        "import json\nprint(json.loads(trellis_workspace.read())['usage']['segments'])")
    check("harness-side capture is visible from REPL code (shared object, not a copy)",
          out.stdout.strip() == "1")

    # Scaffold restore: `context` is force-restored, the workspace name
    # is NOT scaffold-managed and survives untouched.
    repl.execute_code("context = 'clobbered'")
    out = repl.execute_code("print(context)")
    check("scaffold restore puts `context` back after a model overwrite",
          out.stdout.strip() == "the context payload")
    out = repl.execute_code(
        "import json\nprint(json.loads(trellis_workspace.segment('%s'))['content'])"
        % harness_stub["segmentId"])
    check("scaffold restore leaves trellis_workspace intact", out.stdout.strip() == "between-turn capture")

    # Rebind-vs-mutate on exception (§4.6): in-place mutations of
    # existing objects persist even when a later line raises; rebindings
    # from the failed block are discarded.
    repl.execute_code("state = dict(items=[])")
    out = repl.execute_code(
        "state['items'].append('kept')\nrebound_name = 'set'\nraise ValueError('boom')")
    check("the failing turn surfaces the exception", "ValueError: boom" in out.stderr)
    out = repl.execute_code("print(state['items'], 'rebound_name' in dir())")
    check("in-place mutation persists through the exception; rebinding is lost",
          out.stdout.strip() == "['kept'] False")

    # A holder mutation inside a failed block also persists — this is
    # what makes harness capture safe against model errors in the same
    # REPL block.
    out = repl.execute_code(
        "trellis_workspace.add_note('note before the crash')\nraise RuntimeError('after capture')")
    check("the crash after the holder call still raised", "RuntimeError: after capture" in out.stderr)
    out = repl.execute_code(
        "import json\nprint(json.loads(trellis_workspace.read())['notes'])")
    check("holder mutations inside a failed block persist (capture survives model errors)",
          out.stdout.strip() == "['note before the crash']")

    # Underscore-prefixed names are filtered from persistence.
    repl.execute_code("_scratch = 7")
    out = repl.execute_code("print('_scratch' in dir())")
    check("underscore names do not persist", out.stdout.strip() == "False")
finally:
    repl.cleanup()

# --- 6. Cross-task lineage: seed_from_snapshot (Session 16, §5) -------------
print("\n[6] seed_from_snapshot: round-trip, stamp preservation, seed budgets")

source = TrellisWorkspace(max_segments=8, max_bytes=64 * 1024, goal_id="goal-42", task_id="task-1")
source.set_plan([dict(id="s1", desc="fetch evidence", status="done")])
source.add_note("hash abc123 looked load-bearing")
seg_a = source.capture(server="websearch", tool="web_search", args_hash="ab12cd34ef56ab78",
                       content="first fetched body", truncated=False)
seg_b = source.capture(server="websearch", tool="web_search", args_hash="cd34ef56ab78ab12",
                       content="second fetched body — non-ascii too", truncated=True)
source_snapshot = json.loads(source.snapshot())

seeded = TrellisWorkspace.seed_from_snapshot(
    source_snapshot, max_segments=8, max_bytes=64 * 1024,
    goal_id="goal-42", task_id="task-2")
check("a seeded workspace's snapshot is byte-identical to its source (canonical JSON)",
      seeded.snapshot() == source.snapshot())
seeded_index = json.loads(seeded.read())
check("plan and notes survive seeding",
      seeded_index["plan"] == [dict(id="s1", desc="fetch evidence", status="done")]
      and seeded_index["notes"] == ["hash abc123 looked load-bearing"])
seeded_seg = json.loads(seeded.segment(seg_a["segmentId"]))
check("wrapper stamps survive seeding verbatim (origin, fetchedAt, truncated, taskId)",
      seeded_seg["origin"] == {"server": "websearch", "tool": "web_search",
                               "argsHash": "ab12cd34ef56ab78"}
      and seeded_seg["taskId"] == "task-1"
      and json.loads(seeded.segment(seg_b["segmentId"]))["truncated"] is True)
check("seeded usage accounts every inherited byte",
      seeded_index["usage"]["bytes"] == json.loads(source.read())["usage"]["bytes"])

seeded.add_note("continuing where task-1 stopped")
check("a seeded workspace keeps working normally", len(json.loads(seeded.read())["notes"]) == 2)
dropped_seed = json.loads(seeded.drop(seg_a["segmentId"]))
check("seeded segments can be dropped to free budget",
      dropped_seed["freedBytes"] == seg_a["bytes"])

# Budgets are re-enforced at seed time: an over-budget seed fails fast.
expect_raises("a seed with more segments than the budget raises (fails the task fast)",
              lambda: TrellisWorkspace.seed_from_snapshot(source_snapshot, max_segments=1),
              WorkspaceBudgetError, "segment budget")
expect_raises("a seed larger than the byte budget raises (never silent truncation)",
              lambda: TrellisWorkspace.seed_from_snapshot(dict(source_snapshot),
                                                          max_segments=8, max_bytes=16),
              WorkspaceBudgetError, "byte budget")

# Structural validation: malformed and torn seeds raise readable errors.
expect_raises("a non-snapshot seed raises",
              lambda: TrellisWorkspace.seed_from_snapshot(["not", "a", "dict"]),
              ValueError, "version-1 snapshot")
expect_raises("a wrong-version seed raises",
              lambda: TrellisWorkspace.seed_from_snapshot({**source_snapshot, "version": 2}),
              ValueError, "version-1 snapshot")
expect_raises("empty note strings in a seed raise",
              lambda: TrellisWorkspace.seed_from_snapshot({**source_snapshot, "notes": [""]}),
              ValueError, "non-empty")
stampless = {**source_snapshot,
             "segments": {"seg-x": {"content": "no stamps at all"}}}
expect_raises("a segment without wrapper stamps raises",
              lambda: TrellisWorkspace.seed_from_snapshot(stampless),
              ValueError, "stamps")
torn_seg = dict(json.loads(source.segment(seg_b["segmentId"])))
torn_seg.pop("segmentId")
torn_seg["bytes"] = torn_seg["bytes"] + 1
torn = {**source_snapshot, "segments": {"seg-torn": torn_seg}}
expect_raises("a torn segment (bytes stamp vs content mismatch) raises",
              lambda: TrellisWorkspace.seed_from_snapshot(torn),
              ValueError, "torn")

# is_empty gates serialization: only non-empty workspaces are parked.
check("a fresh workspace is empty; plan, notes, or segments make it non-empty",
      TrellisWorkspace(max_segments=2, max_bytes=200).is_empty()
      and not source.is_empty())

# The seeded addendum: gated, additive, brace-free; the unseeded prompt
# is byte-identical to Session 14's (pinned).
check("unseeded addendum is byte-identical to the Session 14 addendum",
      build_workspace_addendum(source) == WORKSPACE_ADDENDUM
      and build_workspace_addendum(source, seeded=False) == WORKSPACE_ADDENDUM)
seeded_addendum = build_workspace_addendum(seeded, seeded=True)
check("seeded addendum extends the base addendum and announces the seed",
      seeded_addendum.startswith(WORKSPACE_ADDENDUM) and "SEEDED RUN" in seeded_addendum
      and "trellis_workspace.read()" in seeded_addendum)
check("seeded addendum has no braces at all (rlms .format() safety)",
      "{" not in seeded_addendum and "}" not in seeded_addendum)
check("no workspace still means an empty addendum, seeded or not",
      build_workspace_addendum(None, seeded=True) == "")

# --- 7. M1 standing fixture: park/seed round-trip at cap sizes --------------
# Adopted from the July 11, 2026 data-plane representation review
# (docs/archive/TRELLIS_ROADMAP_DEPRECATED.md §5, benchmark matrix row M1): the park/seed seam is
# exercised at the real byte caps (4 MiB default, 32 MiB hard cap) and at
# the segment-count hard cap (1024), asserting byte-lossless round-trips
# and bound enforcement at exactly-cap and cap+1. Wall-clock timings are
# PRINTED as telemetry, never asserted (CI variance) — correctness is the
# check. Any future cap raise re-runs this fixture at the target size
# FIRST (the review's recommendation-5 doctrine).
print("\n[7] M1: park/seed round-trip at cap sizes (timings printed, never asserted)")


def build_at_cap_workspace(max_bytes, segment_count, label):
    """A workspace filled to EXACTLY max_bytes with deterministic ASCII
    content spread over segment_count segments."""
    ws = TrellisWorkspace(max_segments=segment_count, max_bytes=max_bytes)
    plan = [dict(id="m1", desc=f"fill {label} to the byte cap", status="done")]
    ws.set_plan(plan)
    ws.add_note(f"M1 fixture at {label}")
    used = len(json.dumps(plan).encode("utf-8")) + len(f"M1 fixture at {label}".encode("utf-8"))
    fill = max_bytes - used
    chunk = fill // segment_count
    for i in range(segment_count):
        size = chunk if i < segment_count - 1 else fill - chunk * (segment_count - 1)
        ws.capture(server="m1", tool="fixture", args_hash="%016x" % i,
                   content=("%08d" % i) + "x" * (size - 8), truncated=False)
    return ws


def roundtrip_at_cap(max_bytes, segment_count, label):
    source_ws = build_at_cap_workspace(max_bytes, segment_count, label)
    check(f"{label} at-cap workspace fills to exactly the byte cap",
          json.loads(source_ws.read())["usage"]["bytes"] == max_bytes)

    t0 = time.perf_counter()
    parked = source_ws.snapshot()
    t1 = time.perf_counter()
    parsed = json.loads(parked)
    t2 = time.perf_counter()
    reseeded = TrellisWorkspace.seed_from_snapshot(
        parsed, max_segments=segment_count, max_bytes=max_bytes)
    t3 = time.perf_counter()
    print(f"       {label}: snapshot {(t1 - t0) * 1000:.1f} ms, parse {(t2 - t1) * 1000:.1f} ms, "
          f"seed {(t3 - t2) * 1000:.1f} ms ({len(parked)} serialized bytes, "
          f"{segment_count} segments)")

    check(f"{label} park/parse/seed round-trip is byte-lossless at exactly the cap",
          reseeded.snapshot() == parked)
    check(f"{label} seeded usage accounts every byte (usage == cap)",
          json.loads(reseeded.read())["usage"]["bytes"] == max_bytes)

    # cap+1: grow ONE segment by one byte (stamp kept consistent so the
    # torn check cannot fire first) — the byte budget must refuse.
    over_segments = dict(parsed["segments"])
    grow_id = next(iter(over_segments))
    grown = dict(over_segments[grow_id])
    grown["content"] = grown["content"] + "y"
    grown["bytes"] = grown["bytes"] + 1
    over_segments[grow_id] = grown
    expect_raises(f"{label} cap+1 seed refuses (byte budget enforced at the boundary)",
                  lambda: TrellisWorkspace.seed_from_snapshot(
                      {**parsed, "segments": over_segments},
                      max_segments=segment_count, max_bytes=max_bytes),
                  WorkspaceBudgetError, "byte budget")
    return parsed, parked


snap_default, parked_default = roundtrip_at_cap(
    WORKSPACE_MAX_BYTES_DEFAULT, 8, "4 MiB (default cap)")
snap_hard, parked_hard = roundtrip_at_cap(
    WORKSPACE_MAX_BYTES_CAP, 16, "32 MiB (hard cap)")

# The segment-count hard cap (1024): a full-width snapshot round-trips;
# one segment more refuses.
count_ws = TrellisWorkspace(max_segments=WORKSPACE_MAX_SEGMENTS_CAP,
                            max_bytes=WORKSPACE_MAX_BYTES_DEFAULT)
for i in range(WORKSPACE_MAX_SEGMENTS_CAP):
    count_ws.capture(server="m1", tool="fixture", args_hash="%016x" % i,
                     content="segment payload %08d" % i, truncated=False)
t0 = time.perf_counter()
count_parked = count_ws.snapshot()
count_parsed = json.loads(count_parked)
count_reseeded = TrellisWorkspace.seed_from_snapshot(
    count_parsed, max_segments=WORKSPACE_MAX_SEGMENTS_CAP,
    max_bytes=WORKSPACE_MAX_BYTES_DEFAULT)
t1 = time.perf_counter()
print(f"       1024 segments: park+parse+seed {(t1 - t0) * 1000:.1f} ms "
      f"({len(count_parked)} serialized bytes)")
check("1024-segment (hard cap) snapshot round-trips byte-lossless",
      count_reseeded.snapshot() == count_parked
      and len(json.loads(count_reseeded.read())["segments"]) == WORKSPACE_MAX_SEGMENTS_CAP)


def synthetic_segment(content):
    return {
        "origin": {"server": "m7", "tool": "fixture", "argsHash": "ab12cd34ef56ab78"},
        "fetchedAt": "2026-07-11T00:00:00+00:00",
        "bytes": len(content.encode("utf-8")),
        "truncated": False,
        "content": content,
    }


over_count_segments = dict(count_parsed["segments"])
over_count_segments["one-more-than-the-cap"] = synthetic_segment("the 1025th segment")
expect_raises("a 1025-segment seed refuses at the 1024 hard cap (cap+1)",
              lambda: TrellisWorkspace.seed_from_snapshot(
                  {**count_parsed, "segments": over_count_segments},
                  max_segments=WORKSPACE_MAX_SEGMENTS_CAP,
                  max_bytes=WORKSPACE_MAX_BYTES_DEFAULT),
              WorkspaceBudgetError, "segment budget")

# --- 8. M7 standing fixture: torn-payload refusal + canonical determinism ---
# The review's failure-injection row: one fixture per integrity class the
# seed boundary must refuse (section [6] already pins the small-size torn
# stamp, wrong version, stampless segment, and over-budget classes — these
# extend per-field and at-cap, never duplicate), plus the canonical-form
# determinism pin (snapshot → parse → re-serialize → byte-equal) that any
# future representation change must hold to (the review's adoption
# threshold 3).
print("\n[8] M7: torn-payload refusal fixtures + canonical-form determinism")

m7_base = {"version": 1, "plan": [], "notes": [],
           "segments": {"seg-m7": synthetic_segment("well-formed payload")}}
check("the well-formed M7 base fixture seeds cleanly (fixture validity control)",
      TrellisWorkspace.seed_from_snapshot(json.loads(json.dumps(m7_base)))
      .snapshot() == json.dumps(m7_base, sort_keys=True, separators=(",", ":")))


def mutated_seed(**field_overrides):
    fixture = json.loads(json.dumps(m7_base))
    fixture["segments"]["seg-m7"].update(field_overrides)
    return lambda: TrellisWorkspace.seed_from_snapshot(fixture)


expect_raises("non-string segment content refuses (never coerced)",
              mutated_seed(content=12345, bytes=5), ValueError, "stamps")
expect_raises("non-bool truncated stamp refuses (never coerced)",
              mutated_seed(truncated="false"), ValueError, "stamps")
expect_raises("missing origin argsHash refuses",
              mutated_seed(origin={"server": "m7", "tool": "fixture"}),
              ValueError, "stamps")
expect_raises("non-string fetchedAt stamp refuses",
              mutated_seed(fetchedAt=1752192000), ValueError, "stamps")

# Torn and wrong-version at the 4 MiB cap size — the small-size versions
# are pinned in [6]; these prove the checks hold on real cap-scale
# payloads.
torn_at_cap_segments = dict(snap_default["segments"])
torn_id = next(iter(torn_at_cap_segments))
torn_at_cap_segments[torn_id] = {**torn_at_cap_segments[torn_id],
                                 "bytes": torn_at_cap_segments[torn_id]["bytes"] + 1}
expect_raises("a torn bytes stamp refuses at the 4 MiB cap size",
              lambda: TrellisWorkspace.seed_from_snapshot(
                  {**snap_default, "segments": torn_at_cap_segments}),
              ValueError, "torn")
expect_raises("a wrong-version snapshot refuses at the 4 MiB cap size",
              lambda: TrellisWorkspace.seed_from_snapshot(
                  {**snap_default, "version": 2}),
              ValueError, "version-1 snapshot")

# Canonical-form determinism: parse + re-serialize reproduces the parked
# bytes exactly, at both cap sizes and at the segment-count cap. This is
# what makes the snapshot pin-compatible — the property the data-plane
# review found Arrow IPC could not guarantee across library versions.
check("4 MiB snapshot parse + re-serialize is byte-identical (canonical form)",
      json.dumps(snap_default, sort_keys=True, separators=(",", ":")) == parked_default)
check("32 MiB snapshot parse + re-serialize is byte-identical (canonical form)",
      json.dumps(snap_hard, sort_keys=True, separators=(",", ":")) == parked_hard)
check("1024-segment snapshot parse + re-serialize is byte-identical (canonical form)",
      json.dumps(count_parsed, sort_keys=True, separators=(",", ":")) == count_parked)

# --- 9. The surface descriptor (Workstream B, July 25, 2026) ---------------
# One encoding per fact (SELF_DESCRIBING_SURFACES.md §9.1). The claim under
# test is not that prose exists but that the guard-backed half is read off
# the guards: the two budget sentences carry THIS run's numbers because
# they are composed from the same attributes capture() and
# _require_byte_budget compare against, and each is checked against the
# refusal those guards actually raise. Nothing here renders, and the
# addendum equality checks in sections 4 and 6 are what hold the live
# prompt bytes still.
print("\n[9] surface descriptor: registration, brace-freedom, and the budget tie")

from trellis_surfaces import descriptor_for  # noqa: E402
from trellis_workspace import (  # noqa: E402
    WORKSPACE_DESCRIPTOR,
    WORKSPACE_SEEDED_ADDENDUM,
    _WORKSPACE_GUARD_EXPECTS,
    derive_workspace_expects,
)


def authored_strings(node):
    """Every string a human wrote into a descriptor. Tuples are guard
    REFERENCES rather than authored bytes, so their contents are skipped;
    everything else is walked generically. Walking beats naming the fields
    here: descriptors are a registration and fields vary per surface
    (SELF_DESCRIBING_SURFACES.md §11), so a helper that listed them would
    silently stop covering the field somebody adds next."""
    if isinstance(node, str):
        return [node]
    if isinstance(node, tuple):
        return []
    if isinstance(node, dict):
        out = []
        for key, value in node.items():
            out.append(key)
            out += authored_strings(value)
        return out
    if isinstance(node, list):
        out = []
        for item in node:
            out += authored_strings(item)
        return out
    return []


check("the descriptor is registered at the surface's own definition site",
      descriptor_for("trellis_workspace") is WORKSPACE_DESCRIPTOR)

ws_strings = authored_strings(WORKSPACE_DESCRIPTOR) + list(_WORKSPACE_GUARD_EXPECTS.values())
check("every authored descriptor string is brace-free (rlms .format() safety)",
      all("{" not in s and "}" not in s for s in ws_strings))

# The tie that makes a budget sentence guard-backed rather than authored:
# the number the account states is the number the guard refuses past. Both
# bounds sit well under the defaults so the refusal is reachable here and
# a default leaking in would be visible.
tiny = TrellisWorkspace(max_segments=1, max_bytes=400, goal_id="goal-desc")
tiny_expects = derive_workspace_expects(tiny)
check("the derived budgets are this run's own bounds, not the defaults",
      tiny_expects["maxSegments"] == 1 and tiny_expects["maxBytes"] == 400
      and tiny_expects["maxSegments"] != WORKSPACE_MAX_SEGMENTS_DEFAULT
      and tiny_expects["maxBytes"] != WORKSPACE_MAX_BYTES_DEFAULT)
check("each budget sentence carries its own guard's number",
      "budget for this run is 1;" in tiny_expects["segment_budget"]
      and "budget for this run is 400," in tiny_expects["byte_budget"])

tiny.capture(server="s", tool="t", args_hash="0" * 16, content="a", truncated=False)
segment_refusal = ""
try:
    tiny.capture(server="s", tool="t", args_hash="0" * 16, content="b", truncated=False)
except WorkspaceBudgetError as e:
    segment_refusal = str(e)
check("the segment number in the account is the number in the refusal",
      str(tiny_expects["maxSegments"]) in segment_refusal
      and "segment budget exceeded" in segment_refusal.lower())

byte_ws = TrellisWorkspace(max_segments=4, max_bytes=400)
byte_expects = derive_workspace_expects(byte_ws)
byte_refusal = ""
try:
    byte_ws.add_note("x" * 500)
except WorkspaceBudgetError as e:
    byte_refusal = str(e)
check("the byte number in the account is the number in the refusal",
      str(byte_expects["maxBytes"]) in byte_refusal
      and "byte budget exceeded" in byte_refusal.lower())

# Activation cause 1 of 3 — goal scope — is DERIVED, from the very
# attribute capture() stamps onto a segment.
goal_expects = derive_workspace_expects(capture_ws)
check("goalScoped derives from the attribute capture stamps segments with",
      goal_expects["goalScoped"] is True
      and goal_expects["goalId"] == captured["goalId"]
      and derive_workspace_expects(TrellisWorkspace())["goalScoped"] is False)

# Activation cause 2 of 3 — seeding — is NOT derivable: seed_from_snapshot
# leaves no mark on the instance and no guard consults seededness, so it
# arrives as a caller flag and the phrase it selects is editorial.
check("seeded is a caller flag, not a read: one holder answers both ways",
      derive_workspace_expects(capture_ws, seeded=True)["seeded"] is True
      and derive_workspace_expects(capture_ws)["seeded"] is False)
check("the seeded account sits in the editorial half, not among the guard phrases",
      "seeded_run" in WORKSPACE_DESCRIPTOR["usage"]
      and not any("seed" in key for key in _WORKSPACE_GUARD_EXPECTS))

# Activation cause 3 of 3 — an attached MCP client — is the OTHER
# surface's state, so its sentence is not restated here.
check("the capture-stub sentence is homed on trellis_mcp, not restated here",
      _MCP_GUARD_EXPECTS["capture_stub"] not in " ".join(ws_strings)
      and "call_tool" not in " ".join(authored_strings(WORKSPACE_DESCRIPTOR)))

# Run ids arrive from argv and are never charset-validated, so they stay
# DATA in the derived dict and reach no phrase: a brace in a goal id must
# not become a brace in a string rlms will run .format() over.
hostile = TrellisWorkspace(goal_id="goal-{0}", task_id="task-{1}")
hostile_expects = derive_workspace_expects(hostile, seeded=True)
hostile_phrases = {key: value for key, value in hostile_expects.items()
                   if isinstance(value, str) and key not in ("goalId", "taskId")}
check("derived phrases stay brace-free even when the run ids carry braces",
      all("{" not in v and "}" not in v for v in hostile_phrases.values())
      and hostile_expects["goalId"] == "goal-{0}"
      and hostile_expects["taskId"] == "task-{1}")

# The inventories are closed and pre-stated: a key added or dropped
# without touching this pin is drift.
check("the guard-expectation inventory is exactly the pre-stated set",
      set(_WORKSPACE_GUARD_EXPECTS) == {
          "index_excludes_content", "unknown_segment", "plan_json",
          "plan_replacement", "note_shape", "goal_stamped"})
check("the derived keys are the guard phrases plus the run-state account",
      set(tiny_expects) == set(_WORKSPACE_GUARD_EXPECTS) | {
          "maxSegments", "maxBytes", "goalId", "taskId", "goalScoped",
          "seeded", "segment_budget", "byte_budget"})

# One encoding, enforced both ways: no guard-owned phrase may be restated
# inside an editorial field, and every reference the descriptor makes must
# resolve to an owner.
check("no guard-owned phrase is restated in an editorial field",
      not any(phrase in bit
              for phrase in _WORKSPACE_GUARD_EXPECTS.values()
              if len(phrase) >= 30
              for bit in authored_strings(WORKSPACE_DESCRIPTOR)))
ws_refs = [p[1] for entry in WORKSPACE_DESCRIPTOR["exposes"]
           for p in entry["doc"] if isinstance(p, tuple)]
check("every guard reference in exposes resolves in the derived expectations",
      bool(ws_refs) and all(key in tiny_expects for key in ws_refs))
check("every tail reference resolves to its owner",
      all(key in (tiny_expects if kind == "expects" else WORKSPACE_DESCRIPTOR["usage"])
          for kind, key in WORKSPACE_DESCRIPTOR["tail"]))

# --- The one description line rlms reserves ---------------------------------
# Composed THROUGH THE SHIPPED FRAME. A local reimplementation of the
# resolution rule would check this descriptor's data against a COPY of that
# rule, so a change to the real join would leave this drill green while the
# shipped line moved; two sibling drills made exactly that mistake and were
# corrected. render_contribution is the composer that actually runs.
from trellis_contribution import (  # noqa: E402
    CONTRIBUTION_BUDGET,
    render_contribution,
)

ws_line = render_contribution(WORKSPACE_DESCRIPTOR, tiny_expects)
# The per-surface fair share of the kernel budget across the thirteen
# surfaces this pass wires. A CEILING, not an equality: a line under it never
# forces a sibling out of the composition, and the budget is what refuses.
WS_FAIR_SHARE = CONTRIBUTION_BUDGET // 13
check("the contributed pieces resolve and compose to one clean line",
      bool(ws_line) and ws_line == ws_line.strip()
      and "\n" not in ws_line and "\r" not in ws_line
      and "{" not in ws_line and "}" not in ws_line)
check("the composed line stays inside the per-surface fair share",
      len(ws_line) <= WS_FAIR_SHARE, f"{len(ws_line)} of {WS_FAIR_SHARE}")
# The line PULLS and authors nothing: every character came out of a field
# this descriptor already owns, so there is no second copy here to disagree
# with the first (SELF_DESCRIBING_SURFACES.md §9.1).
check("the line authors no bytes of its own — it pulls purpose entire",
      ws_line == WORKSPACE_DESCRIPTOR["purpose"]
      and not any(isinstance(p, str) for p in WORKSPACE_DESCRIPTOR["contributes"]))
# No bound is stated by half. The slot carries no guard-owned phrase and no
# opening fragment of one, and it does not need to: the addendum states them
# in full and is emitted on EXACTLY the runs this surface is injected on,
# because build_workspace_addendum and trellis_agent gate on the same holder.
check("no guard-owned phrase, whole or partial, rides the one-line slot",
      not any(phrase[:40] in ws_line
              for phrase in _WORKSPACE_GUARD_EXPECTS.values()))
check("the addendum reaches every run the line reaches, and states the bounds",
      build_workspace_addendum(tiny) != "" and build_workspace_addendum(None) == ""
      and "Budgets are bounded" in build_workspace_addendum(tiny)
      and "never full contents" in build_workspace_addendum(tiny))
# §13 (The description slot, and the gate this did not run) binds §6's
# self-play validation gate before whenToUse reaches any composed line. It
# has not run, so no intent claim rides this slot.
check("the line carries no intent claim — whenToUse stays out of the slot",
      WORKSPACE_DESCRIPTOR["whenToUse"][:40] not in ws_line)
# Seededness is the activation cause that changes what a model should do
# FIRST, and it is a caller flag rather than a refusing predicate. The line
# is the same on both arms by construction; the seeded addendum is where the
# read-before-you-fetch discipline is stated, on the same runs.
check("the line is arm-independent, and the seeded addendum carries the difference",
      render_contribution(WORKSPACE_DESCRIPTOR,
                          derive_workspace_expects(tiny, seeded=True)) == ws_line
      and "VERY FIRST repl block" in build_workspace_addendum(tiny, seeded=True))

# Recorded, not retired: WORKSPACE_ADDENDUM still hand-authors the budget
# line the guards now own, because moving those bytes is a separate
# authorized pass. This check fails the day someone moves them silently.
check("the addendum still carries its own budget line (recorded, not retired)",
      "Budgets are bounded" in WORKSPACE_ADDENDUM
      and tiny_expects["byte_budget"] not in WORKSPACE_ADDENDUM)
check("the descriptor layer moved no addendum bytes",
      build_workspace_addendum(capture_ws) == WORKSPACE_ADDENDUM
      and build_workspace_addendum(capture_ws, seeded=True)
      == WORKSPACE_ADDENDUM + WORKSPACE_SEEDED_ADDENDUM)

# PIN: the addendum bytes themselves, recorded July 25, 2026 BEFORE the
# descriptor layer was added and unchanged by it. The equality checks
# above compare the composition against the constant, so an edit to the
# constant moves both sides together and neither notices; a digest
# recorded outside the run is what catches that.
WORKSPACE_ADDENDUM_SHA256 = (
    "9b2c27c3d138edd3df61aa53bca9980f84644125074f3652663ad1bde42a6e0f")
WORKSPACE_SEEDED_ADDENDUM_SHA256 = (
    "7d47c68963c87740c1567c8b1a228c243e190d89b8839de8d8f3d73901d5740a")
unseeded_sha = hashlib.sha256(
    build_workspace_addendum(capture_ws).encode("utf-8")).hexdigest()
seeded_sha = hashlib.sha256(
    build_workspace_addendum(capture_ws, seeded=True).encode("utf-8")).hexdigest()
check("PIN: the unseeded addendum bytes are the recorded ones",
      unseeded_sha == WORKSPACE_ADDENDUM_SHA256,
      f"got {unseeded_sha} over {len(WORKSPACE_ADDENDUM)} chars")
check("PIN: the seeded addendum bytes are the recorded ones",
      seeded_sha == WORKSPACE_SEEDED_ADDENDUM_SHA256,
      f"got {seeded_sha} over "
      f"{len(WORKSPACE_ADDENDUM + WORKSPACE_SEEDED_ADDENDUM)} chars")

# ---------------------------------------------------------------------------
if failures:
    print(f"\n{failures} check(s) failed.")
    sys.exit(1)
print("\nAll workspace checks passed.")
