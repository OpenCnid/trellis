# Live zero-LLM test of the Session 10 MCP client surface, run under the
# pinned interpreter via `npm run test:rlm-mcp`. The only server involved
# is the local deterministic fixture (scripts/fixture_mcp_server.py) —
# no network, no paid work, no databases.
#
# The registry under test arrives through the real delivery path: the TS
# wrapper builds it with the Node-side Zod helpers and forwards it as
# TRELLIS_MCP_SERVERS, exactly as rlm_worker.ts does for a production
# agent run — so this suite also pins the cross-language config contract.
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "rlm"))
from trellis_mcp import (  # noqa: E402
    TrellisMcp,
    parse_mcp_config,
    build_mcp_addendum,
    get_mcp_call_count,
    truncate_result,
)
from trellis_tools import get_tool_call_count  # noqa: E402

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


# --- 1. Defensive re-validation (twins of src/config/mcp_servers.test.ts) ---
print("\n[1] parse_mcp_config re-validation")

check("blank/unset means empty registry", parse_mcp_config(None) == [] and parse_mcp_config("  ") == [])

valid_entry = {"name": "s", "command": ["python", "x.py"], "tools": ["t"]}
parsed = parse_mcp_config(json.dumps([valid_entry]))
check(
    "valid registry parses with default bounds",
    parsed[0]["timeoutMs"] == 10_000 and parsed[0]["maxResultBytes"] == 64 * 1024,
)
expect_raises("malformed JSON rejected", lambda: parse_mcp_config("{oops"), ValueError, "not valid JSON")
expect_raises("non-array rejected", lambda: parse_mcp_config('{"name":"x"}'), ValueError, "array")
for field in ("name", "command", "tools"):
    entry = {k: v for k, v in valid_entry.items() if k != field}
    expect_raises(f"missing {field} rejected", lambda e=entry: parse_mcp_config(json.dumps([e])), ValueError)
expect_raises(
    "shell-string command rejected (argument vectors only)",
    lambda: parse_mcp_config(json.dumps([{**valid_entry, "command": "python x.py"}])),
    ValueError, "command",
)
expect_raises(
    "empty tool allowlist rejected",
    lambda: parse_mcp_config(json.dumps([{**valid_entry, "tools": []}])),
    ValueError, "allowlist",
)
for bad_name in ("Web Search", "web{search}", "UPPER", "1digit", "a" * 65):
    expect_raises(
        f"bad name {bad_name[:20]!r} rejected",
        lambda n=bad_name: parse_mcp_config(json.dumps([{**valid_entry, "name": n}])),
        ValueError,
    )
for bad_bounds in ({"timeoutMs": 0}, {"timeoutMs": 300_001}, {"maxResultBytes": -1}, {"timeoutMs": 1.5}):
    expect_raises(
        f"bad bounds {bad_bounds} rejected",
        lambda b=bad_bounds: parse_mcp_config(json.dumps([{**valid_entry, **b}])),
        ValueError,
    )
expect_raises(
    "duplicate server names rejected",
    lambda: parse_mcp_config(json.dumps([valid_entry, valid_entry])),
    ValueError, "duplicate",
)

# --- 2. Prompt addendum hygiene -------------------------------------------
print("\n[2] prompt addendum")

import trellis_agent  # noqa: E402
from rlm.utils.prompts import RLM_SYSTEM_PROMPT  # noqa: E402

check("empty registry produces an empty addendum (byte-identical prompt)", build_mcp_addendum([]) == "")
check(
    "module-level SYSTEM_PROMPT is untouched by Session 10",
    trellis_agent.SYSTEM_PROMPT == RLM_SYSTEM_PROMPT + trellis_agent.TRELLIS_ADDENDUM,
)

registry_json = os.environ.get("TRELLIS_MCP_SERVERS")
check("wrapper forwarded TRELLIS_MCP_SERVERS", bool(registry_json))
servers = parse_mcp_config(registry_json)
check("forwarded registry passes Python re-validation (cross-language contract)", len(servers) == 2)

addendum = build_mcp_addendum(servers)
stripped = addendum.replace("{{", "").replace("}}", "")
check("configured addendum has no unescaped braces (rlms .format() safety)",
      "{" not in stripped and "}" not in stripped)
check("addendum lists every configured server and allowlisted tool",
      all(s["name"] in addendum for s in servers)
      and all(tool in addendum for s in servers for tool in s["tools"]))
check("addendum states the provenance contract", "sourceNodeIds" in addendum and "NEVER" in addendum)

# --- 3. Pure result truncation --------------------------------------------
print("\n[3] result truncation")

check("small results pass through untouched", truncate_result("abc", 10) == "abc")
capped = truncate_result("x" * 100, 10)
check("oversized results are capped with an explicit marker",
      capped.startswith("x" * 10) and "TRELLIS_MCP_TRUNCATED" in capped)
snowman = truncate_result("☃" * 10, 4)  # 3 UTF-8 bytes each: cap splits a code point
check("truncation never splits a UTF-8 code point",
      snowman.startswith("☃") and "TRELLIS_MCP_TRUNCATED" in snowman)

# --- 4. The client against the live fixture server ------------------------
print("\n[4] fixture server: handshake, calls, bounds, isolation, shutdown")

by_name = {s["name"]: s for s in servers}
check("registry has the expected servers", set(by_name) == {"websearch", "misbehaving"})

started = time.time()
client = TrellisMcp(servers)
try:
    check(f"both servers handshake once at construction ({time.time() - started:.1f}s)", True)

    surface = json.loads(client.list_tools())
    check("list_tools reports the configured surface as JSON",
          {entry["server"] for entry in surface} == {"websearch", "misbehaving"}
          and all(isinstance(entry["tools"], list) for entry in surface))

    first = client.call_tool("websearch", "web_search", {"query": "trellis provenance"})
    second = client.call_tool("websearch", "web_search", {"query": "trellis provenance"})
    check("call_tool returns a JSON string", isinstance(first, str) and json.loads(first)["server"] == "websearch")
    check("fixture web_search is deterministic (same query, same bytes)", first == second)
    payload = json.loads(json.loads(first)["result"])
    check("canned results carry the query and fixture URLs",
          payload["query"] == "trellis provenance"
          and len(payload["results"]) == 2
          and payload["results"][0]["url"].startswith("https://fixture.invalid/"))

    expect_raises("unknown server rejected before any I/O",
                  lambda: client.call_tool("ghost", "web_search", {"query": "x"}), ValueError, "unknown mcp server")
    expect_raises("unknown tool rejected before any I/O",
                  lambda: client.call_tool("websearch", "nonexistent_tool", {"query": "x"}),
                  ValueError, "not allowlisted")
    # oversized_search exists on the fixture process behind 'websearch',
    # but its allowlist does not include it: configured != allowlisted.
    expect_raises("configured-but-not-allowlisted tool rejected before any I/O",
                  lambda: client.call_tool("websearch", "oversized_search", {"query": "x"}),
                  ValueError, "not allowlisted")
    expect_raises("non-dict arguments rejected",
                  lambda: client.call_tool("websearch", "web_search", "not a dict"), ValueError, "dict")

    slow_started = time.time()
    expect_raises("per-call timeout trips on the slow tool",
                  lambda: client.call_tool("misbehaving", "slow_search", {"query": "x"}),
                  RuntimeError, "timed out")
    slow_elapsed = time.time() - slow_started
    timeout_s = by_name["misbehaving"]["timeoutMs"] / 1000.0
    check(f"timeout tripped near the configured bound ({slow_elapsed:.1f}s)",
          timeout_s * 0.5 <= slow_elapsed <= timeout_s + 3.0)

    oversized = json.loads(client.call_tool("misbehaving", "oversized_search", {"query": "x"}))["result"]
    cap = by_name["misbehaving"]["maxResultBytes"]
    check("oversized result truncated to the configured cap with marker",
          "TRELLIS_MCP_TRUNCATED" in oversized
          and len(oversized.encode("utf-8")) <= cap + 128)

    # The provenance invariant, at the counter level: a run that only
    # searched the web made ZERO database tool calls and would still be
    # a TRELLIS_PROTOCOL_VIOLATION.
    check("MCP calls never increment the database tool-call count",
          get_tool_call_count() == 0)
    check("MCP usage is counted separately for telemetry",
          get_mcp_call_count() >= 6)
finally:
    close_started = time.time()
    client.close()

check(f"clean shutdown: loop thread joined ({time.time() - close_started:.1f}s)",
      not client._thread.is_alive())

# --- 5. A server that dies at startup degrades to a readable error --------
print("\n[5] startup failure containment")

broken = parse_mcp_config(json.dumps([{
    "name": "broken",
    "command": [sys.executable, "-c", "import sys; sys.exit(3)"],
    "tools": ["anything"],
}]))
expect_raises("dead-on-arrival server raises at construction, never hangs",
              lambda: TrellisMcp(broken), RuntimeError, "broken")

# ---------------------------------------------------------------------------
if failures:
    print(f"\n{failures} check(s) failed.")
    sys.exit(1)
print("\nAll MCP client checks passed.")
