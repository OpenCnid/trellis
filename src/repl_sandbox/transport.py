"""The vsock transport and the frame-serving loop.

Source of truth: docs/product/repl-sandbox/REPL_SANDBOX_INTERFACES.md section 1
(Seam map), section 3 (The vsock bridge), and section 3.1 (vsock addressing).

Three properties this module exists to hold:

**Identity comes from `accept()`.** The peer CID is read from the accepted
address by the kernel and handed to the handler as a separate argument. Nothing
here ever reads an identity out of a frame, because a frame is written by the
peer and a peer is untrusted until its bytes have parsed
(INTERFACES section 3.1 — "never an id in the payload").

**The asymmetry is deliberate.** On `LM_PORT` and `DB_PORT` the *host* listens
and the guest connects, so the host gates every call by the CID it read at
`accept()`. On `CONTROL_PORT` the *guest supervisor* listens and only the
trusted host connects, so the supervisor refuses any peer CID other than
`VMADDR_CID_HOST` (2). Both directions use the same loop below; only the
handler's CID policy differs.

**Fail-closed framing.** Every read goes through `repl_sandbox.frame`, which
checks the declared length before allocating. An oversized, truncated,
non-UTF-8, or malformed frame drops the connection and is audited. No error
frame is written back on a frame error: the peer has already demonstrated that
it is not speaking the protocol, and answering it is a service we do not owe.

Nothing in this module is the boundary. The boundary is the microVM
(ARCHITECTURE section 2). This is the wire that crosses it.
"""

from __future__ import annotations

import socket
import threading
from typing import Callable, Protocol, runtime_checkable

from repl_sandbox.config import VMADDR_CID_HOST
from repl_sandbox.errors import AuthError, FrameError, SandboxError, UpstreamError
from repl_sandbox.frame import encode_frame, read_frame

#: `VMADDR_CID_ANY` — bind on every CID. Defined here so the module imports on a
#: host whose `socket` has no `AF_VSOCK` (Windows); the real constant is read
#: from `socket` when it exists.
VMADDR_CID_ANY = 0xFFFFFFFF

#: Default bound on a single blocking read, in seconds. INTERFACES section 3.2
#: (Read discipline) requires a bounded read timeout per frame so a peer cannot
#: pin a server thread by opening a connection and never finishing a frame.
DEFAULT_READ_TIMEOUT_S = 30.0

#: Default bound on a blocking `accept()`. This is not a security bound: it is
#: what lets `serve_forever` observe its stop event instead of parking in the
#: kernel forever.
DEFAULT_ACCEPT_TIMEOUT_S = 0.5


# ---------------------------------------------------------------------------
# Transport protocols
# ---------------------------------------------------------------------------


@runtime_checkable
class Connection(Protocol):
    """The three socket methods the serve loop needs.

    A `socket.socket` satisfies this structurally, which is why `accept()`
    returns the socket itself rather than a wrapper.
    """

    def recv(self, n: int, /) -> bytes: ...

    def sendall(self, data: bytes, /) -> None: ...

    def close(self) -> None: ...


@runtime_checkable
class Listener(Protocol):
    """A listening endpoint that reports who connected.

    `accept()` returns `(conn, peer_cid)`. The CID is the identity anchor for
    the session (LEARNINGS section 7 — Identity: the vsock CID) and comes from
    the kernel-supplied peer address, never from anything the peer wrote.
    """

    def accept(self) -> tuple[Connection, int]: ...

    def close(self) -> None: ...


AuditFn = Callable[..., None]
Handler = Callable[[int, dict], dict]


def _emit(audit: AuditFn | None, event: str, **fields: object) -> None:
    """Report one transport event. No-op when the caller supplied no auditor."""
    if audit is not None:
        audit(event, **fields)


# ---------------------------------------------------------------------------
# AF_VSOCK — the real transport
# ---------------------------------------------------------------------------


def vsock_available() -> bool:
    """True when this host's `socket` module has the vsock address family.

    False on Windows and on any kernel without `AF_VSOCK`. Callers use it to
    skip the vsock path; the module itself always imports.
    """
    return hasattr(socket, "AF_VSOCK")


def _require_vsock() -> None:
    if not vsock_available():
        raise RuntimeError(
            "AF_VSOCK is not available on this host; the microVM boundary "
            "cannot be reached from here. Use LoopbackListener/LoopbackClient "
            "for tests — they are a test double, not a boundary."
        )


class VsockListener:
    """Listens on one vsock port and reports the guest CID from `accept()`.

    Used host-side on `LM_PORT` and `DB_PORT`, where the host is the chokepoint
    and the guest connects per RPC (INTERFACES section 3.1). Binds
    `VMADDR_CID_ANY`: vsock has no analogue of an all-interfaces IP bind, and
    choosing vsock over a forwarded `AF_INET` port is what forecloses the
    unauthenticated network exposure the loopback default warns about.

    The socket is created in `__init__` rather than at import, so this module
    loads cleanly on a host with no `AF_VSOCK` and only constructing it fails.
    """

    def __init__(
        self,
        port: int,
        *,
        backlog: int = 8,
        accept_timeout_s: float | None = DEFAULT_ACCEPT_TIMEOUT_S,
        read_timeout_s: float | None = DEFAULT_READ_TIMEOUT_S,
    ) -> None:
        _require_vsock()
        self.port = port
        self.read_timeout_s = read_timeout_s
        cid_any = getattr(socket, "VMADDR_CID_ANY", VMADDR_CID_ANY)
        self._sock = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
        self._sock.bind((cid_any, port))
        self._sock.listen(backlog)
        self._sock.settimeout(accept_timeout_s)

    def accept(self) -> tuple[Connection, int]:
        """Accept one connection; the CID is element 0 of the peer address."""
        conn, addr = self._sock.accept()
        conn.settimeout(self.read_timeout_s)
        return conn, int(addr[0])

    def close(self) -> None:
        self._sock.close()


class VsockClient:
    """Connects to `(cid, port)` and does one request per connection.

    Connect-per-request matches rlms' own client, so the bridge carries rlms
    frames without a protocol change (INTERFACES section 3.1).
    """

    def __init__(
        self,
        cid: int,
        port: int,
        *,
        timeout_s: float | None = DEFAULT_READ_TIMEOUT_S,
    ) -> None:
        _require_vsock()
        self.cid = cid
        self.port = port
        self.timeout_s = timeout_s

    def request(self, payload: dict, max_frame_len: int) -> dict:
        """Send one frame, read one frame back, close.

        A closed connection before a reply is a `FrameError`: a half-answer is
        never interpreted.
        """
        sock = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
        sock.settimeout(self.timeout_s)
        try:
            sock.connect((self.cid, self.port))
            return _request_over(sock, payload, max_frame_len)
        finally:
            sock.close()


# ---------------------------------------------------------------------------
# Loopback — a TEST DOUBLE, not a boundary
# ---------------------------------------------------------------------------


class LoopbackListener:
    """A loopback TCP stand-in for a vsock listener. **A test double.**

    This is not a boundary and must never be used to carry real traffic: it is
    an ordinary `AF_INET` socket on `127.0.0.1`, so any process on the host can
    connect to it and there is no microVM anywhere in the picture.

    The `peer_cid` it reports is **synthetic** — TCP has no CID, so the value is
    whatever the constructor was handed. It exists so the serve loop's real
    property (identity is supplied by the listener, not read out of a frame) is
    exercisable without `/dev/kvm`. Under the real transport that same value
    comes from the kernel and cannot be chosen by the peer.
    """

    def __init__(
        self,
        peer_cid: int = 3,
        *,
        backlog: int = 8,
        accept_timeout_s: float | None = DEFAULT_ACCEPT_TIMEOUT_S,
        read_timeout_s: float | None = DEFAULT_READ_TIMEOUT_S,
    ) -> None:
        self.peer_cid = peer_cid
        self.read_timeout_s = read_timeout_s
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.bind(("127.0.0.1", 0))
        self._sock.listen(backlog)
        self._sock.settimeout(accept_timeout_s)

    @property
    def address(self) -> tuple[str, int]:
        """The bound `(host, port)`. Tests dial this directly for raw bytes."""
        return self._sock.getsockname()[:2]

    def client(self) -> "LoopbackClient":
        """A client aimed at this listener."""
        return LoopbackClient(self.address, timeout_s=self.read_timeout_s)

    def accept(self) -> tuple[Connection, int]:
        conn, _addr = self._sock.accept()
        conn.settimeout(self.read_timeout_s)
        return conn, self.peer_cid

    def close(self) -> None:
        self._sock.close()


class LoopbackClient:
    """The dialing half of the loopback test double. **Not a boundary.**

    Same connect-per-request shape as `VsockClient` so a test exercises the
    serve loop the way the real transport will drive it.
    """

    def __init__(
        self,
        address: tuple[str, int],
        *,
        timeout_s: float | None = DEFAULT_READ_TIMEOUT_S,
    ) -> None:
        self.address = address
        self.timeout_s = timeout_s

    def connect(self) -> socket.socket:
        """Open a raw connection. Callers that want framing use `request`."""
        sock = socket.create_connection(self.address, timeout=self.timeout_s)
        sock.settimeout(self.timeout_s)
        return sock

    def request(self, payload: dict, max_frame_len: int) -> dict:
        sock = self.connect()
        try:
            return _request_over(sock, payload, max_frame_len)
        finally:
            sock.close()


def _request_over(sock: socket.socket, payload: dict, max_frame_len: int) -> dict:
    """One framed request/response exchange over an open socket."""
    sock.sendall(encode_frame(payload, max_frame_len))
    response = read_frame(sock.recv, max_frame_len)
    if response is None:
        raise FrameError("peer closed the connection without answering")
    return response


# ---------------------------------------------------------------------------
# The serve loop
# ---------------------------------------------------------------------------


def serve_connection(
    conn: Connection,
    peer_cid: int,
    handler: Handler,
    max_frame_len: int,
    audit: AuditFn | None = None,
) -> None:
    """Serve framed requests on one connection until it ends.

    `peer_cid` arrives from the listener and is passed to `handler` as its own
    argument. The handler decides what that CID is allowed to do; this loop only
    guarantees the CID is the kernel's answer and not the peer's.

    Termination rules, from INTERFACES section 7 (Error model):

    * a `FrameError` from the reader — oversized, truncated, non-UTF-8, or
      malformed — drops the connection and is audited. Nothing is written back;
      fail-closed, with no best-effort recovery;
    * a handler error whose class is connection-terminal (`auth`) drops the
      connection and is audited by attempted CID, and is not offered back to the
      peer as a recoverable error;
    * a handler error whose class is session-terminal (`cap_spend`) is returned
      as an error response and *then* the connection closes;
    * every other handler error is returned as an error response and the loop
      continues, so it reaches the in-guest stub as a Python exception and feeds
      the model's self-debug loop.

    This function owns the connection for its lifetime and closes it on return.
    """
    try:
        while True:
            try:
                request = read_frame(conn.recv, max_frame_len)
            except FrameError as exc:
                _emit(audit, "frame_error", peer_cid=peer_cid, code=exc.code, message=exc.message)
                return
            except OSError as exc:
                # A read timeout or a reset peer. Neither is answerable.
                _emit(audit, "transport_error", peer_cid=peer_cid, message=str(exc))
                return

            if request is None:
                _emit(audit, "peer_closed", peer_cid=peer_cid)
                return

            close_after_response = False
            try:
                response = handler(peer_cid, request)
            except SandboxError as exc:
                if exc.connection_terminal:
                    _emit(
                        audit,
                        "connection_denied",
                        peer_cid=peer_cid,
                        code=exc.code,
                        message=exc.message,
                    )
                    return
                _emit(audit, "handler_error", peer_cid=peer_cid, code=exc.code, message=exc.message)
                response = {"ok": False, "error": exc.to_error_object()}
                close_after_response = exc.session_terminal
            except Exception as exc:  # noqa: BLE001 - a handler bug is not the peer's business
                wrapped = UpstreamError(f"{type(exc).__name__}: {exc}")
                _emit(audit, "handler_crash", peer_cid=peer_cid, message=wrapped.message)
                response = {"ok": False, "error": wrapped.to_error_object()}

            try:
                conn.sendall(encode_frame(response, max_frame_len))
            except FrameError as exc:
                # The response we produced does not fit the wire we promised.
                _emit(audit, "response_frame_error", peer_cid=peer_cid, message=exc.message)
                return
            except OSError as exc:
                _emit(audit, "transport_error", peer_cid=peer_cid, message=str(exc))
                return

            if close_after_response:
                _emit(audit, "session_halted", peer_cid=peer_cid)
                return
    finally:
        try:
            conn.close()
        except OSError:
            pass


def serve_forever(
    listener: Listener,
    handler: Handler,
    max_frame_len: int,
    audit: AuditFn | None = None,
    stop: "threading.Event | None" = None,
) -> None:
    """Accept connections one at a time and serve each to completion.

    Sequential by design: every seam here is one connection per RPC, and a
    serialised loop is the shape whose resource use is obvious. Concurrency
    ceilings live in the handler, keyed by CID (INTERFACES section 4), never in
    an unbounded thread-per-connection accept loop.

    `stop` is checked between connections; the listener's own accept timeout is
    what makes that check reachable, so the loop always terminates on request.
    Returns when `stop` is set or the listener is closed.
    """
    while stop is None or not stop.is_set():
        try:
            conn, peer_cid = listener.accept()
        except TimeoutError:
            continue
        except OSError:
            # The listener was closed underneath us; that is a normal shutdown.
            return

        if stop is not None and stop.is_set():
            conn.close()
            return

        _emit(audit, "accepted", peer_cid=peer_cid)
        serve_connection(conn, peer_cid, handler, max_frame_len, audit)


def require_host_cid(peer_cid: int) -> None:
    """Raise `AuthError` unless the peer is the trusted host CID.

    The control-port policy of INTERFACES section 1: the guest supervisor
    listens, and only CID 2 may speak to it. Kept next to the transport because
    the CID it judges is the transport's to supply.
    """
    if peer_cid != VMADDR_CID_HOST:
        raise AuthError(
            f"control port accepts only the host CID {VMADDR_CID_HOST}, got {peer_cid}"
        )
