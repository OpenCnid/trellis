"""Deterministic local MCP fixture server for zero-paid acceptance.

Speaks the real Model Context Protocol over stdio via the pinned `mcp`
SDK — the only server Session 10 acceptance ever configures. `web_search`
returns canned results derived deterministically from the query; the
misbehaving tools exercise the client's bounding guarantees (per-call
timeout, result size cap, unknown-tool rejection) without any network
access or paid work. Real networked/metered MCP servers are owner-approved
runs only.
"""

import hashlib
import json

import anyio
from mcp.server.fastmcp import FastMCP

server = FastMCP("trellis-fixture", log_level="WARNING")

# Sleep must comfortably exceed the short per-call timeout the test
# configures, while staying under the client's backstop-independent test
# runtime budget.
SLOW_SEARCH_SLEEP_S = 5.0

# Comfortably larger than the small maxResultBytes the truncation test
# configures, and larger than the client default (64 KiB).
OVERSIZED_RESULT_BYTES = 128 * 1024


@server.tool()
def web_search(query: str) -> str:
    """Deterministic canned web search: same query, same results, forever."""
    digest = hashlib.sha256(query.encode("utf-8")).hexdigest()[:12]
    return json.dumps({
        "query": query,
        "results": [
            {
                "title": f"Fixture result A for '{query}'",
                "url": f"https://fixture.invalid/a/{digest}",
                "snippet": f"Deterministic snippet A about {query}.",
            },
            {
                "title": f"Fixture result B for '{query}'",
                "url": f"https://fixture.invalid/b/{digest}",
                "snippet": f"Deterministic snippet B about {query}.",
            },
        ],
    })


@server.tool()
async def slow_search(query: str) -> str:
    """Misbehaving mode: hangs past any reasonable per-call timeout.
    Async so only this request stalls — a sync sleep would block the
    server's event loop and fail every later call in the same run."""
    await anyio.sleep(SLOW_SEARCH_SLEEP_S)
    return json.dumps({"query": query, "results": []})


@server.tool()
def oversized_search(query: str) -> str:
    """Misbehaving mode: returns a result far beyond the size cap."""
    return "x" * OVERSIZED_RESULT_BYTES


if __name__ == "__main__":
    server.run()  # stdio transport
