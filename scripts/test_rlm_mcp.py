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

# --- 1b. Session 12 twins: the http transport variant ----------------------
print("\n[1b] parse_mcp_config http variant (twins of the Zod union)")

check(
    "missing transport defaults to stdio (pre-Session-12 registries parse unchanged)",
    parse_mcp_config(json.dumps([valid_entry]))[0]["transport"] == "stdio",
)
expect_raises(
    "unknown transport rejected",
    lambda: parse_mcp_config(json.dumps([{**valid_entry, "transport": "sse"}])),
    ValueError, "transport",
)

valid_http = {"transport": "http", "name": "remote", "url": "https://tools.example.com/mcp", "tools": ["t"]}
parsed_http = parse_mcp_config(json.dumps([valid_http]))
check(
    "valid http server parses with default bounds",
    parsed_http[0]["url"] == valid_http["url"] and parsed_http[0]["timeoutMs"] == 10_000,
)
expect_raises(
    "http server without a url rejected",
    lambda: parse_mcp_config(json.dumps([{k: v for k, v in valid_http.items() if k != "url"}])),
    ValueError, "url",
)
for bad_url in ("ftp://x.example.com/mcp", "not a url", ""):
    expect_raises(
        f"bad url {bad_url[:20]!r} rejected",
        lambda u=bad_url: parse_mcp_config(json.dumps([{**valid_http, "url": u}])),
        ValueError,
    )
for private_url in (
    "http://127.0.0.1:8765/mcp",
    "http://localhost/mcp",
    "http://10.1.2.3/mcp",
    "http://192.168.0.9/mcp",
    "http://172.31.0.1/mcp",
    "http://mcp-fixture:9500/mcp",
):
    check(
        f"plain http allowed for private host {private_url}",
        parse_mcp_config(json.dumps([{**valid_http, "url": private_url}]))[0]["url"] == private_url,
    )
for public_url in ("http://tools.example.com/mcp", "http://8.8.8.8/mcp", "http://172.32.0.1/mcp"):
    expect_raises(
        f"plain http rejected for public host {public_url}",
        lambda u=public_url: parse_mcp_config(json.dumps([{**valid_http, "url": u}])),
        ValueError, "plain http",
    )
check(
    "bearer auth parses carrying only the env var NAME",
    parse_mcp_config(json.dumps([{**valid_http, "auth": {"kind": "bearer", "valueEnv": "MY_TOKEN"}}]))[0]["auth"]
    == {"kind": "bearer", "valueEnv": "MY_TOKEN"},
)
check(
    "header auth parses with its header name",
    parse_mcp_config(
        json.dumps([{**valid_http, "auth": {"kind": "header", "header": "x-api-key", "valueEnv": "MY_TOKEN"}}])
    )[0]["auth"]
    == {"kind": "header", "valueEnv": "MY_TOKEN", "header": "x-api-key"},
)
for bad_auth in (
    {"kind": "header", "valueEnv": "TOKEN"},                       # header kind without a header name
    {"kind": "bearer", "header": "x-api-key", "valueEnv": "TOKEN"},  # bearer with a header name
    {"kind": "bearer", "valueEnv": "lowercase"},                   # not an env var name
    {"kind": "basic", "valueEnv": "TOKEN"},                        # unsupported kind
    {"kind": "header", "header": "x api key", "valueEnv": "TOKEN"},  # header charset
    {"kind": "bearer"},                                            # no credential reference
):
    expect_raises(
        f"bad auth {bad_auth} rejected",
        lambda a=bad_auth: parse_mcp_config(json.dumps([{**valid_http, "auth": a}])),
        ValueError,
    )
expect_raises(
    "duplicate names across transports rejected",
    lambda: parse_mcp_config(json.dumps([valid_entry, {**valid_http, "name": valid_entry["name"]}])),
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
check("forwarded mixed registry passes Python re-validation (cross-language contract)",
      len(servers) == 5
      and {s["transport"] for s in servers} == {"stdio", "http"})

addendum = build_mcp_addendum(servers)
stripped = addendum.replace("{{", "").replace("}}", "")
check("configured addendum has no unescaped braces (rlms .format() safety)",
      "{" not in stripped and "}" not in stripped)
check("addendum lists every configured server and allowlisted tool",
      all(s["name"] in addendum for s in servers)
      and all(tool in addendum for s in servers for tool in s["tools"]))
check("addendum states the provenance contract", "sourceNodeIds" in addendum and "NEVER" in addendum)
check("addendum never carries URLs or credential material (Session 12)",
      "http://" not in addendum and "https://" not in addendum
      and "127.0.0.1" not in addendum
      and os.environ["MCP_HTTP_SEARCH_TOKEN"] not in addendum
      and "MCP_HTTP_SEARCH_TOKEN" not in addendum)

# --- 3. Pure result truncation --------------------------------------------
print("\n[3] result truncation")

check("small results pass through untouched", truncate_result("abc", 10) == "abc")
capped = truncate_result("x" * 100, 10)
check("oversized results are capped with an explicit marker",
      capped.startswith("x" * 10) and "TRELLIS_MCP_TRUNCATED" in capped)
snowman = truncate_result("☃" * 10, 4)  # 3 UTF-8 bytes each: cap splits a code point
check("truncation never splits a UTF-8 code point",
      snowman.startswith("☃") and "TRELLIS_MCP_TRUNCATED" in snowman)

# --- 4. The client against the live fixture servers ------------------------
print("\n[4] fixture servers: handshake, calls, bounds, isolation, shutdown")

by_name = {s["name"]: s for s in servers}
check("registry has the expected servers",
      set(by_name) == {"websearch", "misbehaving", "httpsearch", "httpmisbehaving", "authsearch"})

started = time.time()
client = TrellisMcp(servers)
try:
    check(f"all five servers (stdio + http, incl. credentialed) handshake once at construction ({time.time() - started:.1f}s)", True)

    surface = json.loads(client.list_tools())
    check("list_tools reports the configured surface as JSON",
          {entry["server"] for entry in surface} == set(by_name)
          and all(isinstance(entry["tools"], list) for entry in surface))
    surface_text = client.list_tools()
    check("list_tools never exposes URLs or credentials",
          "http://" not in surface_text and "127.0.0.1" not in surface_text
          and os.environ["MCP_HTTP_SEARCH_TOKEN"] not in surface_text)

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

    # --- Session 12: the same guarantees over Streamable HTTP -----------
    http_first = client.call_tool("httpsearch", "web_search", {"query": "trellis provenance"})
    check("http web_search returns the same canned deterministic payload as stdio",
          json.loads(json.loads(http_first)["result"]) == json.loads(json.loads(first)["result"]))

    auth_result = client.call_tool("authsearch", "web_search", {"query": "credentialed"})
    check("credentialed http server works when the named env var holds the right token",
          json.loads(json.loads(auth_result)["result"])["query"] == "credentialed")

    expect_raises("allowlist rejection before I/O holds for http servers",
                  lambda: client.call_tool("httpsearch", "oversized_search", {"query": "x"}),
                  ValueError, "not allowlisted")

    http_slow_started = time.time()
    expect_raises("per-call timeout trips over http",
                  lambda: client.call_tool("httpmisbehaving", "slow_search", {"query": "x"}),
                  RuntimeError, "timed out")
    http_slow_elapsed = time.time() - http_slow_started
    http_timeout_s = by_name["httpmisbehaving"]["timeoutMs"] / 1000.0
    check(f"http timeout tripped near the configured bound ({http_slow_elapsed:.1f}s)",
          http_timeout_s * 0.5 <= http_slow_elapsed <= http_timeout_s + 3.0)

    http_oversized = json.loads(client.call_tool("httpmisbehaving", "oversized_search", {"query": "x"}))["result"]
    http_cap = by_name["httpmisbehaving"]["maxResultBytes"]
    check("oversized http result truncated to the configured cap with marker",
          "TRELLIS_MCP_TRUNCATED" in http_oversized
          and len(http_oversized.encode("utf-8")) <= http_cap + 128)

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

# --- 6. Session 12: http credential failures stay readable and REDACTED ----
print("\n[6] http auth failure, missing credential, unreachable URL, redaction")

auth_port = os.environ["TRELLIS_TEST_HTTP_AUTH_PORT"]
wrong_token = os.environ["TRELLIS_TEST_WRONG_TOKEN"]
good_token = os.environ["MCP_HTTP_SEARCH_TOKEN"]


def auth_registry(value_env):
    return parse_mcp_config(json.dumps([{
        "transport": "http",
        "name": "authprobe",
        "url": f"http://127.0.0.1:{auth_port}/mcp",
        "tools": ["web_search"],
        "timeoutMs": 15_000,
        "auth": {"kind": "bearer", "valueEnv": value_env},
    }]))


expect_raises(
    "registry naming an unset valueEnv fails before any I/O",
    lambda: TrellisMcp(auth_registry("TRELLIS_TEST_UNSET_CREDENTIAL")),
    ValueError, "TRELLIS_TEST_UNSET_CREDENTIAL",
)

wrong_started = time.time()
try:
    TrellisMcp(auth_registry("TRELLIS_TEST_WRONG_TOKEN"))
    check("wrong credential fails the construction", False, "no error raised")
except RuntimeError as e:
    message = str(e)
    check("wrong credential degrades to a readable startup error",
          "authprobe" in message and "401" in message)
    check("the wrong credential value is REDACTED from the raised error",
          wrong_token not in message)
    check("the valid credential value never appears either", good_token not in message)
    check(f"credential failure is fast, never a hang ({time.time() - wrong_started:.1f}s)",
          time.time() - wrong_started < 30.0)
except Exception as e:  # noqa: BLE001
    check("wrong credential degrades to a readable startup error", False,
          f"expected RuntimeError, got {type(e).__name__}: {e}")

unreachable = parse_mcp_config(json.dumps([{
    "transport": "http",
    "name": "unreachable",
    "url": "http://127.0.0.1:9/mcp",  # discard port: nothing listens
    "tools": ["web_search"],
}]))
unreachable_started = time.time()
expect_raises("unreachable URL raises a readable startup error, never hangs",
              lambda: TrellisMcp(unreachable), RuntimeError, "unreachable")
check(f"unreachable URL failed fast ({time.time() - unreachable_started:.1f}s)",
      time.time() - unreachable_started < 35.0)

# ---------------------------------------------------------------------------
if failures:
    print(f"\n{failures} check(s) failed.")
    sys.exit(1)
print("\nAll MCP client checks passed.")
