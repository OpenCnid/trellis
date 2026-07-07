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
import json
import os
import re
import sys
import uuid as uuid_module

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "rlm"))
from trellis_workspace import (  # noqa: E402
    TrellisWorkspace,
    WorkspaceBudgetError,
    build_workspace_addendum,
    parse_workspace_bounds,
    WORKSPACE_MAX_SEGMENTS_DEFAULT,
    WORKSPACE_MAX_BYTES_DEFAULT,
)
from trellis_tools import AST_HASH_PATTERN, get_tool_call_count  # noqa: E402
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

# ---------------------------------------------------------------------------
if failures:
    print(f"\n{failures} check(s) failed.")
    sys.exit(1)
print("\nAll workspace checks passed.")
