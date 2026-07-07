# Containerized tool-server probe for the zero-LLM Compose integration
# (Session 12). Runs inside the integration container: parses the
# TRELLIS_MCP_SERVERS registry the Node side built with the production
# Zod helpers, dials the mcp-fixture service over Streamable HTTP on the
# project network (credentialed — the token arrives via the env var the
# registry names), and verifies a canned deterministic tool round trip.
# No network leaves the Compose project; no paid work.
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "rlm"))
from trellis_mcp import TrellisMcp, parse_mcp_config  # noqa: E402


def main() -> None:
    registry = parse_mcp_config(os.environ.get("TRELLIS_MCP_SERVERS"))
    if len(registry) != 1 or registry[0]["transport"] != "http":
        raise SystemExit("expected exactly one http server in TRELLIS_MCP_SERVERS")

    client = TrellisMcp(registry)
    try:
        first = client.call_tool(registry[0]["name"], "web_search", {"query": "compose fixture"})
        second = client.call_tool(registry[0]["name"], "web_search", {"query": "compose fixture"})
    finally:
        client.close()

    payload = json.loads(json.loads(first)["result"])
    assert first == second, "fixture web_search must be deterministic"
    assert payload["query"] == "compose fixture", f"unexpected payload: {payload}"
    assert payload["results"][0]["url"].startswith("https://fixture.invalid/"), "canned URLs expected"
    print("COMPOSE_MCP_PROBE_OK")


if __name__ == "__main__":
    main()
