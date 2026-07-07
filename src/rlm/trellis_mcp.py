"""Operator-configured MCP client surface for the Trellis RLM (Session 10).

The RLM sub-agent gains external tools exclusively through this module:
`rlm_worker.ts` forwards the Zod-validated TRELLIS_MCP_SERVERS registry as
env (the NEO4J_* pattern), `parse_mcp_config` re-validates it defensively
with bounds identical to src/config/mcp_servers.ts, and `TrellisMcp` is
injected via rlms `custom_tools` next to the database tools.

Wrapper discipline (mirrors trellis_tools.py): every REPL-visible method
returns a JSON STRING; protocol and tool errors RAISE with real messages
so the REPL loop can self-correct; every call is time-bounded and
size-capped. The provenance invariant is structural: MCP usage is counted
by its own `_count_mcp_call()` — never `_count_tool_call()` — so
TRELLIS_PROTOCOL_VIOLATION stays keyed to database tool calls, and MCP
output can never satisfy or masquerade as `sourceNodeIds` provenance.

Transports (Session 12): `stdio` servers are spawned as children of the
RLM process from an explicit argument vector (never a shell string);
`http` servers are dialed over the MCP Streamable HTTP transport, with an
optional operator-owned credential resolved from an environment variable
the registry names (the value never sits in the registry, the prompt, or
any error message — see _scrub). Either way the server is handshaken once
at construction and closed in the agent's `finally`. anyio cancel scopes
are task-bound, so each connection lives inside one long-lived asyncio
task that opens and closes its own contexts.
"""

import asyncio
import json
import os
import re
import threading
from concurrent.futures import TimeoutError as FuturesTimeoutError
from contextlib import asynccontextmanager
from datetime import timedelta
from urllib.parse import urlsplit

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamablehttp_client

# --- Registry validation (must mirror src/config/mcp_servers.ts) --------

# Names appear verbatim in the rlms-formatted system prompt addendum, so
# the charset structurally excludes braces and whitespace tricks.
MCP_NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_-]*$")
MCP_VALUE_ENV_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]*$")
MCP_HEADER_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9-]*$")
MCP_MAX_SERVERS = 8
MCP_TIMEOUT_MS_MAX = 300_000
MCP_TIMEOUT_MS_DEFAULT = 10_000
MCP_MAX_RESULT_BYTES_MAX = 4 * 1024 * 1024
MCP_MAX_RESULT_BYTES_DEFAULT = 64 * 1024
MCP_URL_MAX_LENGTH = 2048

# Handshake ceiling for a configured server that spawns (or dials) but
# never completes initialize(); independent of the per-call timeout.
MCP_CONNECT_TIMEOUT_S = 30.0


def _is_private_mcp_host(hostname):
    """Twin of isPrivateMcpHost in src/config/mcp_servers.ts: plain http
    is acceptable only where traffic cannot leave operator-controlled
    networks — loopback, RFC1918, or dot-free (Compose/LAN DNS) hosts."""
    host = (hostname or "").lower().strip("[]")
    if host in ("localhost", "::1"):
        return True
    octets = re.match(r"^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$", host)
    if octets:
        parts = [int(p) for p in octets.groups()]
        if any(p > 255 for p in parts):
            return False
        a, b = parts[0], parts[1]
        if a in (127, 10):
            return True
        if a == 192 and b == 168:
            return True
        if a == 172 and 16 <= b <= 31:
            return True
        return False
    return "." not in host


def _require_name(value, what):
    if not isinstance(value, str) or not 1 <= len(value) <= 64 or not MCP_NAME_PATTERN.match(value):
        raise ValueError(
            f"Invalid TRELLIS_MCP_SERVERS: {what} {value!r} must match {MCP_NAME_PATTERN.pattern} (max 64 chars)."
        )
    return value


def _require_bounded_int(entry, key, default, maximum):
    value = entry.get(key, default)
    if not isinstance(value, int) or isinstance(value, bool) or not 0 < value <= maximum:
        raise ValueError(
            f"Invalid TRELLIS_MCP_SERVERS: {key} must be a positive integer <= {maximum}, got {value!r}."
        )
    return value


def parse_mcp_config(raw):
    """Re-validates the forwarded registry JSON. None/blank means no
    servers (byte-identical pre-Session-10 behavior). Bounds are
    deliberately identical to the Node-side Zod schema: a payload that
    passes one validator and not the other is a defect."""
    if raw is None or raw.strip() == "":
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"TRELLIS_MCP_SERVERS is not valid JSON: {e}") from e
    if not isinstance(data, list):
        raise ValueError("Invalid TRELLIS_MCP_SERVERS: expected a JSON array of server objects.")
    if len(data) > MCP_MAX_SERVERS:
        raise ValueError(f"Invalid TRELLIS_MCP_SERVERS: at most {MCP_MAX_SERVERS} servers are supported.")

    servers = []
    seen_names = set()
    for entry in data:
        if not isinstance(entry, dict):
            raise ValueError("Invalid TRELLIS_MCP_SERVERS: each server must be an object.")
        name = _require_name(entry.get("name"), "server name")
        if name in seen_names:
            raise ValueError(f"Invalid TRELLIS_MCP_SERVERS: duplicate server name {name!r}.")
        seen_names.add(name)

        # A missing `transport` is the pre-Session-12 stdio shape.
        transport = entry.get("transport", "stdio")
        if transport not in ("stdio", "http"):
            raise ValueError(
                f"Invalid TRELLIS_MCP_SERVERS: server {name!r} transport must be 'stdio' or 'http', got {transport!r}."
            )

        tools = entry.get("tools")
        if not isinstance(tools, list) or len(tools) == 0:
            raise ValueError(
                f"Invalid TRELLIS_MCP_SERVERS: server {name!r} tools must be a non-empty allowlist."
            )
        tools = [_require_name(tool, "tool name") for tool in tools]

        server = {
            "transport": transport,
            "name": name,
            "tools": tools,
            "timeoutMs": _require_bounded_int(entry, "timeoutMs", MCP_TIMEOUT_MS_DEFAULT, MCP_TIMEOUT_MS_MAX),
            "maxResultBytes": _require_bounded_int(
                entry, "maxResultBytes", MCP_MAX_RESULT_BYTES_DEFAULT, MCP_MAX_RESULT_BYTES_MAX
            ),
        }

        if transport == "stdio":
            command = entry.get("command")
            if (
                not isinstance(command, list)
                or len(command) == 0
                or not all(isinstance(part, str) and part for part in command)
            ):
                raise ValueError(
                    f"Invalid TRELLIS_MCP_SERVERS: server {name!r} command must be a non-empty array of non-empty strings."
                )
            server["command"] = list(command)
        else:
            server["url"] = _require_http_url(entry.get("url"), name)
            auth = entry.get("auth")
            if auth is not None:
                server["auth"] = _require_auth(auth, name)

        servers.append(server)
    return servers


def _require_http_url(url, server_name):
    """Twin of the Zod url validation: http(s) only, and plain http only
    for private-network hosts (see _is_private_mcp_host)."""
    if not isinstance(url, str) or not 1 <= len(url) <= MCP_URL_MAX_LENGTH:
        raise ValueError(
            f"Invalid TRELLIS_MCP_SERVERS: server {server_name!r} url must be a string of at most {MCP_URL_MAX_LENGTH} chars."
        )
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ValueError(
            f"Invalid TRELLIS_MCP_SERVERS: server {server_name!r} url must be a valid http(s) URL."
        )
    if parts.scheme == "http" and not _is_private_mcp_host(parts.hostname):
        raise ValueError(
            f"Invalid TRELLIS_MCP_SERVERS: server {server_name!r}: plain http is allowed only for "
            "loopback, RFC1918, or dot-free (private-network) hosts; use https."
        )
    return url


def _require_auth(auth, server_name):
    """Twin of McpAuthSchema: the registry carries a credential REFERENCE
    (an environment variable name), never a value."""
    if not isinstance(auth, dict):
        raise ValueError(f"Invalid TRELLIS_MCP_SERVERS: server {server_name!r} auth must be an object.")
    kind = auth.get("kind")
    if kind not in ("bearer", "header"):
        raise ValueError(
            f"Invalid TRELLIS_MCP_SERVERS: server {server_name!r} auth kind must be 'bearer' or 'header'."
        )
    header = auth.get("header")
    if kind == "header":
        if not isinstance(header, str) or not 1 <= len(header) <= 64 or not MCP_HEADER_PATTERN.match(header):
            raise ValueError(
                f"Invalid TRELLIS_MCP_SERVERS: server {server_name!r} auth kind 'header' requires a header "
                f"name matching {MCP_HEADER_PATTERN.pattern}."
            )
    elif header is not None:
        raise ValueError(
            f"Invalid TRELLIS_MCP_SERVERS: server {server_name!r} auth kind 'bearer' sends the "
            "Authorization header; do not set 'header'."
        )
    value_env = auth.get("valueEnv")
    if not isinstance(value_env, str) or not 1 <= len(value_env) <= 128 or not MCP_VALUE_ENV_PATTERN.match(value_env):
        raise ValueError(
            f"Invalid TRELLIS_MCP_SERVERS: server {server_name!r} auth valueEnv must name an environment "
            f"variable matching {MCP_VALUE_ENV_PATTERN.pattern}."
        )
    result = {"kind": kind, "valueEnv": value_env}
    if kind == "header":
        result["header"] = header
    return result


# --- MCP usage counting (separate from database tool calls) -------------

_mcp_call_lock = threading.Lock()
_mcp_call_stats = {"count": 0}


def _count_mcp_call():
    with _mcp_call_lock:
        _mcp_call_stats["count"] += 1


def get_mcp_call_count() -> int:
    return _mcp_call_stats["count"]


# --- Credential redaction (Session 12) -----------------------------------
#
# Raised tool errors are model-visible (the REPL reads them to
# self-correct) and the agent's stdout is published to the SSE stream, so
# any exception text that crosses out of this module is scrubbed of every
# resolved credential value first. Registration is append-only: scrubbing
# a secret from a message that never contained it is free, missing one is
# a leak.

_redaction_lock = threading.Lock()
_redaction_secrets = []


def _register_secret(value):
    with _redaction_lock:
        if value and value not in _redaction_secrets:
            _redaction_secrets.append(value)


def _scrub(text):
    result = str(text)
    with _redaction_lock:
        for secret in _redaction_secrets:
            result = result.replace(secret, "[REDACTED]")
    return result


def _describe_exception(e):
    """anyio task groups wrap the real failure in ExceptionGroups whose
    str() is just 'unhandled errors in a TaskGroup' — surface the leaf
    exceptions so a 401 or connect refusal stays diagnosable."""
    if isinstance(e, BaseExceptionGroup):
        leaves = []

        def _walk(group):
            for sub in group.exceptions:
                if isinstance(sub, BaseExceptionGroup):
                    _walk(sub)
                else:
                    leaves.append(sub)

        _walk(e)
        if leaves:
            return "; ".join(f"{type(leaf).__name__}: {leaf}" for leaf in leaves)
    return str(e)


def resolve_mcp_auth(cfg):
    """Resolves an http server's credential from the environment variable
    the registry names. Returns the extra request headers (or None).
    Missing variable -> readable error BEFORE any I/O, naming the
    variable, never a value. The resolved value is registered for
    redaction the moment it exists."""
    auth = cfg.get("auth")
    if auth is None:
        return None
    value = os.environ.get(auth["valueEnv"], "")
    if value == "":
        raise ValueError(
            f"MCP server '{cfg['name']}' auth names environment variable "
            f"'{auth['valueEnv']}', which is not set for this process."
        )
    _register_secret(value)
    if auth["kind"] == "bearer":
        return {"Authorization": f"Bearer {value}"}
    return {auth["header"]: value}


# --- Pure helpers --------------------------------------------------------

def truncate_result(text: str, max_bytes: int) -> str:
    """UTF-8-safe size cap with an explicit marker (the snippet-cap idiom):
    an oversized tool result degrades to a bounded string, never an
    unbounded prompt-context payload."""
    encoded = text.encode("utf-8")
    if len(encoded) <= max_bytes:
        return text
    clipped = encoded[:max_bytes].decode("utf-8", errors="ignore")
    return clipped + f"...[TRELLIS_MCP_TRUNCATED: result exceeded {max_bytes} bytes]"


def build_mcp_addendum(servers) -> str:
    """Tools section appended to the Trellis system prompt when servers
    are configured. Empty registry returns the empty string so the prompt
    stays byte-identical to a pre-Session-10 run. rlms runs .format()
    over the prompt, so the template contains no literal braces and the
    validated name charset cannot introduce any."""
    if not servers:
        return ""
    lines = []
    for server in servers:
        tool_list = ", ".join(server["tools"])
        lines.append(
            f"- server '{server['name']}': tools {tool_list} "
            f"(per-call timeout {server['timeoutMs']}ms, results truncated beyond {server['maxResultBytes']} bytes)"
        )
    server_lines = "\n".join(lines)
    return f"""

=== EXTERNAL TOOLS (MCP) ===
The operator has configured external Model Context Protocol servers, available in the REPL as `trellis_mcp`:
- `trellis_mcp.list_tools()` returns the configured surface as a JSON string.
- `trellis_mcp.call_tool(server, tool, arguments)` invokes one allowlisted tool; `arguments` is a dict of that tool's parameters (or omitted). Returns a JSON STRING — wrap it in json.loads. Only the servers and tools listed below exist; anything else raises before any I/O. If a call raises, read the message, correct the call, and retry.

CONFIGURED SERVERS AND ALLOWLISTED TOOLS:
{server_lines}

EXTERNAL CONTENT CONTRACT (HARD RULE): MCP results are research context ONLY. They are not part of the Trellis corpus, they have NO AST hashes, and they must NEVER be passed as sourceNodeIds or written into the graph in any form. Database provenance remains mandatory for every answer and every cached insight: a run that only called MCP tools is still provenance-free and will be rejected. External content earns citability only after the operator ingests it through the verified ingest path — that is not your job and not possible from this session.
"""


def _render_content(blocks) -> str:
    """Flattens MCP content blocks to text; non-text blocks (images,
    embedded resources) become explicit placeholders rather than being
    silently dropped or blowing up the JSON envelope."""
    parts = []
    for block in blocks or []:
        text = getattr(block, "text", None)
        if isinstance(text, str):
            parts.append(text)
        else:
            parts.append(f"[non-text content: {getattr(block, 'type', 'unknown')}]")
    return "\n".join(parts)


# --- Connection lifecycle -------------------------------------------------

@asynccontextmanager
async def _dial(cfg, headers):
    """The single transport-aware seam: yields (read_stream, write_stream)
    for either transport. Everything else — handshake-once, allowlist,
    timeouts, truncation, shutdown — is transport-agnostic."""
    if cfg["transport"] == "http":
        # Streamable HTTP (MCP spec 2025-06-18; the deprecated HTTP+SSE
        # transport is deliberately unsupported). The connect itself is
        # bounded here; the sync side's MCP_CONNECT_TIMEOUT_S ready-wait
        # is the backstop.
        async with streamablehttp_client(
            cfg["url"],
            headers=headers,
            timeout=timedelta(seconds=MCP_CONNECT_TIMEOUT_S),
        ) as (read_stream, write_stream, _get_session_id):
            yield read_stream, write_stream
    else:
        params = StdioServerParameters(
            command=cfg["command"][0],
            args=cfg["command"][1:],
        )
        async with stdio_client(params) as (read_stream, write_stream):
            yield read_stream, write_stream


class _McpServerConnection:
    """One configured server. The transport and session contexts are
    entered and exited inside a single long-lived asyncio task (`_run`),
    because anyio cancel scopes must open and close in the same task; the
    synchronous REPL thread only ever schedules coroutines onto the loop
    and waits on thread-safe events/futures."""

    def __init__(self, cfg, loop, headers=None):
        self._cfg = cfg
        self._loop = loop
        self._headers = headers
        self._ready = threading.Event()
        self._startup_error = None
        self._session = None
        self._stop = None
        self._task = None

    def _startup_hint(self):
        # Errors name the server, never the URL or a credential: raised
        # messages are model-visible and stdout is published (Guardrail 11
        # keeps URLs and secrets out of every observable channel).
        if self._cfg["transport"] == "http":
            return "transport: http"
        return f"command: {self._cfg['command'][0]}"

    def start(self):
        self._task = asyncio.run_coroutine_threadsafe(self._run(), self._loop)
        if not self._ready.wait(MCP_CONNECT_TIMEOUT_S):
            self._task.cancel()
            raise RuntimeError(
                f"MCP server '{self._cfg['name']}' did not complete its handshake "
                f"within {MCP_CONNECT_TIMEOUT_S}s ({self._startup_hint()})."
            )
        if self._startup_error is not None:
            raise RuntimeError(
                f"MCP server '{self._cfg['name']}' failed to start: "
                f"{_scrub(_describe_exception(self._startup_error))}"
            ) from None

    async def _run(self):
        self._stop = asyncio.Event()
        try:
            async with _dial(self._cfg, self._headers) as (read_stream, write_stream):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    self._session = session
                    self._ready.set()
                    await self._stop.wait()
        except BaseException as e:  # noqa: BLE001 — reported to the sync side
            self._startup_error = e
        finally:
            self._session = None
            self._ready.set()

    def call(self, tool: str, arguments):
        session = self._session
        if session is None:
            raise RuntimeError(
                f"MCP server '{self._cfg['name']}' is not connected (it failed to start or has shut down)."
            )
        timeout_ms = self._cfg["timeoutMs"]

        async def _call():
            return await session.call_tool(
                tool,
                arguments,
                read_timeout_seconds=timedelta(milliseconds=timeout_ms),
            )

        future = asyncio.run_coroutine_threadsafe(_call(), self._loop)
        try:
            # read_timeout_seconds is the primary bound (raises McpError
            # inside the loop); the sync wait is a backstop against a
            # wedged transport so the REPL thread itself can never hang.
            result = future.result(timeout=timeout_ms / 1000.0 + 5.0)
        except FuturesTimeoutError:
            future.cancel()
            raise RuntimeError(
                f"MCP call '{self._cfg['name']}.{tool}' timed out after {timeout_ms}ms."
            ) from None
        except Exception as e:
            # Scrubbed and unchained: transport-layer exception text (and
            # its __cause__ repr) must never carry a credential into the
            # model-visible REPL error.
            raise RuntimeError(
                f"MCP call '{self._cfg['name']}.{tool}' failed: {_scrub(_describe_exception(e))}"
            ) from None

        # Rendered content is scrubbed on both paths: a server echoing a
        # credential back must not put it into model context or stdout.
        rendered = _scrub(_render_content(getattr(result, "content", None)))
        if getattr(result, "isError", False):
            raise RuntimeError(
                f"MCP tool error from '{self._cfg['name']}.{tool}': {truncate_result(rendered, 2000)}"
            )
        return truncate_result(rendered, self._cfg["maxResultBytes"])

    def stop(self, join_timeout_s: float = 10.0):
        if self._task is None:
            return
        if self._stop is not None:
            self._loop.call_soon_threadsafe(self._stop.set)
        try:
            self._task.result(timeout=join_timeout_s)
        except Exception:
            # Shutdown is best-effort: a misbehaving child must not turn
            # agent teardown into a hang or a spurious failure.
            self._task.cancel()


class TrellisMcp:
    """The single injected MCP object. Exposes only allowlisted tools on
    operator-configured servers; every REPL-visible method returns a JSON
    string; violations and failures raise with real messages."""

    def __init__(self, servers):
        if not servers:
            raise ValueError("TrellisMcp requires at least one configured server; with none, do not construct it.")
        self._servers = {server["name"]: server for server in servers}
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(target=self._run_loop, name="trellis-mcp-loop", daemon=True)
        self._thread.start()
        self._connections = {}
        try:
            # Credentials resolve for every server BEFORE any connection
            # is dialed: a registry naming a missing env var fails fast
            # with zero I/O, and every secret is registered for redaction
            # before it can appear in any connect-time error.
            headers_by_name = {name: resolve_mcp_auth(cfg) for name, cfg in self._servers.items()}
            for name, cfg in self._servers.items():
                connection = _McpServerConnection(cfg, self._loop, headers=headers_by_name[name])
                connection.start()
                self._connections[name] = connection
        except BaseException:
            self.close()
            raise

    def _run_loop(self):
        asyncio.set_event_loop(self._loop)
        self._loop.run_forever()

    def list_tools(self) -> str:
        """The configured surface (registry truth, no I/O): which servers
        exist, which tools are allowlisted, and the per-call bounds."""
        return json.dumps([
            {
                "server": cfg["name"],
                "tools": cfg["tools"],
                "timeoutMs": cfg["timeoutMs"],
                "maxResultBytes": cfg["maxResultBytes"],
            }
            for cfg in self._servers.values()
        ])

    def call_tool(self, server: str, tool: str, arguments: dict = None) -> str:
        """Invokes one allowlisted tool on one configured server. The
        allowlist decision happens before any I/O; results are research
        context with no provenance standing (never sourceNodeIds)."""
        _count_mcp_call()
        cfg = self._servers.get(server)
        if cfg is None:
            raise ValueError(
                f"Unknown MCP server '{server}'. Configured servers: {', '.join(sorted(self._servers))}."
            )
        if tool not in cfg["tools"]:
            raise ValueError(
                f"Tool '{tool}' is not allowlisted on MCP server '{server}'. "
                f"Allowlisted tools: {', '.join(cfg['tools'])}."
            )
        if arguments is not None and not isinstance(arguments, dict):
            raise ValueError("MCP tool arguments must be a dict (or omitted).")

        result_text = self._connections[server].call(tool, arguments)
        return json.dumps({"server": server, "tool": tool, "result": result_text})

    def close(self):
        for connection in self._connections.values():
            connection.stop()
        self._connections = {}
        try:
            # Scheduled rather than gated on is_running() so a loop that
            # has not reached run_forever yet still stops immediately.
            self._loop.call_soon_threadsafe(self._loop.stop)
        except RuntimeError:
            pass  # loop already closed
        self._thread.join(timeout=10.0)
        if not self._thread.is_alive():
            self._loop.close()
