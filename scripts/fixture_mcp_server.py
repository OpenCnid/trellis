"""Deterministic local MCP fixture server for zero-paid acceptance.

Speaks the real Model Context Protocol via the pinned `mcp` SDK — the
only server MCP acceptance ever configures. `web_search` returns canned
results derived deterministically from the query; the misbehaving tools
exercise the client's bounding guarantees (per-call timeout, result size
cap, unknown-tool rejection) without any network access or paid work.
Real networked/metered MCP servers are owner-approved runs only.

Transports (Session 12): stdio (default) or Streamable HTTP
(`--transport streamable-http --host H --port P`), the same shape as a
containerized or hosted tool server. `--auth-token-env VAR` makes the
HTTP mode require `Authorization: Bearer <value-of-VAR>` (or the header
named by `--auth-header`), so credential success AND failure are
drillable locally. The token arrives via environment, never argv.
Loopback/Compose-internal traffic only — this is a test fixture, not a
deployment-ready server.
"""

import argparse
import hashlib
import json
import os

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
def archive_search(query: str) -> str:
    """Deterministic archive lookup for the paired-run workspace probe:
    eight filler records (~2.8 KB total) with the query's access code at
    the END of the payload — deliberately past any bounded preview, so a
    stub-returning client must read the stored segment to extract it."""
    digest = hashlib.sha256(query.encode("utf-8")).hexdigest()
    records = [
        {
            "id": f"rec-{digest[:6]}-{i:02d}",
            "title": f"Archive record {i} for '{query}'",
            "body": (
                f"Filler paragraph {i} about {query}: "
                + " ".join(f"token{digest[(i + j) % 32]}{j}" for j in range(40))
            ),
        }
        for i in range(8)
    ]
    return json.dumps({"query": query, "records": records, "access_code": digest[:12]})


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


def _build_authenticated_app(expected_header: str, expected_value: str):
    """Wraps the FastMCP Streamable HTTP ASGI app with a bearer/header
    check, mirroring how a hosted MCP server fronts its endpoint. Wrong
    or missing credential -> 401 before any MCP handling."""
    from starlette.applications import Starlette
    from starlette.middleware import Middleware
    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.responses import JSONResponse
    from starlette.routing import Mount

    inner = server.streamable_http_app()

    class RequireToken(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            presented = request.headers.get(expected_header, "")
            if presented != expected_value:
                return JSONResponse({"error": "invalid or missing credential"}, status_code=401)
            return await call_next(request)

    # The session manager lifespan must run for the inner app to accept
    # requests; Starlette only runs the root app's lifespan.
    return Starlette(
        routes=[Mount("/", app=inner)],
        middleware=[Middleware(RequireToken)],
        lifespan=lambda app: inner.router.lifespan_context(inner),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--transport", choices=["stdio", "streamable-http"], default="stdio")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "--auth-token-env",
        help="HTTP mode only: name of the env var holding the required bearer token",
    )
    parser.add_argument(
        "--auth-header",
        default="Authorization",
        help="Header the token must arrive in (default Authorization, expecting 'Bearer <token>')",
    )
    args = parser.parse_args()

    if args.transport == "stdio":
        server.run()  # stdio transport
        return

    server.settings.host = args.host
    server.settings.port = args.port

    if args.auth_token_env:
        token = os.environ.get(args.auth_token_env, "")
        if not token:
            raise SystemExit(f"--auth-token-env names {args.auth_token_env}, which is not set")
        expected = f"Bearer {token}" if args.auth_header.lower() == "authorization" else token
        import uvicorn

        app = _build_authenticated_app(args.auth_header, expected)
        uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
    else:
        server.run(transport="streamable-http")


if __name__ == "__main__":
    main()
