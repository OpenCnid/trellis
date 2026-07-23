"""Transport tests: identity from `accept()`, and fail-closed framing.

Everything here runs over `LoopbackListener` / `LoopbackClient`, which are test
doubles and not a boundary (see their docstrings). What is under test is the
serve loop's behaviour — who the handler is told it is talking to, and what
happens to a connection that sends something it should not — and that behaviour
is transport-agnostic. The vsock path is exercised only for import safety on a
host without `AF_VSOCK`.

Every wait is bounded. A test that hangs here fails instead of blocking.
"""

from __future__ import annotations

import os
import socket
import struct
import threading
from contextlib import contextmanager

import pytest

from repl_sandbox.errors import (
    CapRateError,
    CapSpendError,
    FrameError,
)
from repl_sandbox.frame import buffer_recv, encode_frame, read_frame
from repl_sandbox.transport import (
    HybridVsockHostClient,
    HybridVsockListener,
    LoopbackClient,
    LoopbackListener,
    VsockClient,
    VsockListener,
    hybrid_connect_command,
    hybrid_socket_path,
    read_hybrid_ack,
    require_host_cid,
    serve_connection,
    serve_forever,
    vsock_available,
)

#: Small on purpose: the oversize test should cost four bytes, not 16 MiB.
MAX_FRAME_LEN = 4096

#: Bounds on every blocking call in this file.
CLIENT_TIMEOUT_S = 2.0
SERVER_READ_TIMEOUT_S = 1.0
JOIN_TIMEOUT_S = 5.0


@contextmanager
def running_server(handler, *, peer_cid: int = 3, max_frame_len: int = MAX_FRAME_LEN):
    """Run `serve_forever` on a loopback listener in a thread, and prove it stops."""
    listener = LoopbackListener(
        peer_cid=peer_cid,
        accept_timeout_s=0.05,
        read_timeout_s=SERVER_READ_TIMEOUT_S,
    )
    audit: list[tuple[str, dict]] = []

    def record(event: str, **fields: object) -> None:
        audit.append((event, fields))

    stop = threading.Event()
    thread = threading.Thread(
        target=serve_forever,
        args=(listener, handler, max_frame_len, record, stop),
        daemon=True,
    )
    thread.start()
    try:
        yield listener, audit
    finally:
        stop.set()
        listener.close()
        thread.join(timeout=JOIN_TIMEOUT_S)
        assert not thread.is_alive(), "serve_forever did not stop on its stop event"


def raw_connect(listener: LoopbackListener) -> socket.socket:
    """A bare socket to the listener, for frames the framer would refuse to build."""
    sock = socket.create_connection(listener.address, timeout=CLIENT_TIMEOUT_S)
    sock.settimeout(CLIENT_TIMEOUT_S)
    return sock


def assert_dropped(sock: socket.socket) -> None:
    """Assert the peer closed without answering.

    An orderly close surfaces as an empty read. When the server drops a
    connection whose receive queue still holds unread bytes — which is exactly
    what an oversized frame does — the stack may abort it instead, and the
    client sees a `ConnectionError`. Both are the same fact: no response, no
    connection.
    """
    try:
        assert sock.recv(4) == b"", "the peer answered instead of dropping the connection"
    except ConnectionError:
        pass


def events(audit: list[tuple[str, dict]]) -> list[str]:
    return [name for name, _ in audit]


def echo_handler(peer_cid: int, request: dict) -> dict:
    return {"ok": True, "peer_cid": peer_cid, "echo": request}


# ---------------------------------------------------------------------------
# Identity
# ---------------------------------------------------------------------------


def test_peer_cid_is_delivered_to_the_handler() -> None:
    """The handler is told who connected, by the listener, as its own argument."""
    seen: list[int] = []

    def handler(peer_cid: int, request: dict) -> dict:
        seen.append(peer_cid)
        return {"ok": True}

    with running_server(handler, peer_cid=17) as (listener, _audit):
        response = listener.client().request({"op": "ping"}, MAX_FRAME_LEN)

    assert response == {"ok": True}
    assert seen == [17]


def test_identity_in_the_payload_is_ignored() -> None:
    """A CID the peer wrote into the frame does not become the peer's identity."""
    with running_server(echo_handler, peer_cid=17) as (listener, _audit):
        response = listener.client().request(
            {"op": "ping", "peer_cid": 2, "cid": 2}, MAX_FRAME_LEN
        )

    assert response["peer_cid"] == 17


def test_foreign_cid_is_refused_on_the_control_port() -> None:
    """The control port answers only CID 2; anyone else is dropped and audited.

    No error frame comes back — the peer learns nothing about why.
    """

    def control_handler(peer_cid: int, request: dict) -> dict:
        require_host_cid(peer_cid)
        return {"ok": True}

    with running_server(control_handler, peer_cid=3) as (listener, audit):
        sock = raw_connect(listener)
        try:
            sock.sendall(encode_frame({"op": "ping"}, MAX_FRAME_LEN))
            assert_dropped(sock)
        finally:
            sock.close()

    denials = [fields for name, fields in audit if name == "connection_denied"]
    assert len(denials) == 1
    assert denials[0]["code"] == "auth"
    assert denials[0]["peer_cid"] == 3


def test_host_cid_is_accepted_on_the_control_port() -> None:
    """The positive control: CID 2 gets served, so the refusal above means something."""

    def control_handler(peer_cid: int, request: dict) -> dict:
        require_host_cid(peer_cid)
        return {"ok": True, "served": True}

    with running_server(control_handler, peer_cid=2) as (listener, audit):
        response = listener.client().request({"op": "ping"}, MAX_FRAME_LEN)

    assert response == {"ok": True, "served": True}
    assert "connection_denied" not in events(audit)


def test_require_host_cid_rejects_every_non_host_cid() -> None:
    from repl_sandbox.errors import AuthError

    require_host_cid(2)
    for cid in (0, 1, 3, 42, 0xFFFFFFFF):
        with pytest.raises(AuthError) as caught:
            require_host_cid(cid)
        assert caught.value.connection_terminal is True
        assert str(cid) in caught.value.message


# ---------------------------------------------------------------------------
# Fail-closed framing
# ---------------------------------------------------------------------------


def test_oversized_frame_drops_the_connection_before_allocating() -> None:
    """A declared length above the cap costs four bytes and the connection."""
    with running_server(echo_handler) as (listener, audit):
        sock = raw_connect(listener)
        try:
            sock.sendall(struct.pack(">I", MAX_FRAME_LEN + 1))
            sock.sendall(b"x" * 16)
            assert_dropped(sock)
        finally:
            sock.close()

    frame_errors = [fields for name, fields in audit if name == "frame_error"]
    assert len(frame_errors) == 1
    assert frame_errors[0]["code"] == "frame"
    assert "exceeds max_frame_len" in frame_errors[0]["message"]


def test_huge_declared_length_is_refused() -> None:
    """The 4-byte prefix admits 4 GiB; declaring it must not allocate it."""
    with running_server(echo_handler) as (listener, audit):
        sock = raw_connect(listener)
        try:
            sock.sendall(struct.pack(">I", 0xFFFFFFFF))
            assert_dropped(sock)
        finally:
            sock.close()

    assert "frame_error" in events(audit)


def test_truncated_frame_drops_the_connection() -> None:
    """A body shorter than its declared length is an error, not a partial read."""
    with running_server(echo_handler) as (listener, audit):
        sock = raw_connect(listener)
        try:
            sock.sendall(struct.pack(">I", 64) + b'{"op":"pi')
            sock.shutdown(socket.SHUT_WR)
            assert_dropped(sock)
        finally:
            sock.close()

    frame_errors = [fields for name, fields in audit if name == "frame_error"]
    assert len(frame_errors) == 1
    assert "connection closed after" in frame_errors[0]["message"]


def test_malformed_json_frame_drops_the_connection() -> None:
    """An unparseable body is denied, never best-effort recovered."""
    body = b"{not json at all"
    with running_server(echo_handler) as (listener, audit):
        sock = raw_connect(listener)
        try:
            sock.sendall(struct.pack(">I", len(body)) + body)
            assert_dropped(sock)
        finally:
            sock.close()

    frame_errors = [fields for name, fields in audit if name == "frame_error"]
    assert len(frame_errors) == 1
    assert "not valid JSON" in frame_errors[0]["message"]


def test_non_object_json_frame_drops_the_connection() -> None:
    """Every envelope in this system is a JSON object; a bare array is not one."""
    body = b"[1, 2, 3]"
    with running_server(echo_handler) as (listener, audit):
        sock = raw_connect(listener)
        try:
            sock.sendall(struct.pack(">I", len(body)) + body)
            assert_dropped(sock)
        finally:
            sock.close()

    assert "frame_error" in events(audit)


def test_clean_close_is_not_an_error() -> None:
    """A peer that hangs up between frames is audited as a close, not a fault."""
    with running_server(echo_handler) as (listener, audit):
        client = listener.client()
        sock = client.connect()
        try:
            sock.sendall(encode_frame({"op": "ping"}, MAX_FRAME_LEN))
            assert read_frame(sock.recv, MAX_FRAME_LEN) is not None
        finally:
            sock.close()
        # Give the server thread its turn to observe the close.
        listener.client().request({"op": "ping"}, MAX_FRAME_LEN)

    assert "peer_closed" in events(audit)
    assert "frame_error" not in events(audit)


# ---------------------------------------------------------------------------
# Handler error surfacing
# ---------------------------------------------------------------------------


def test_cap_spend_answers_then_closes_the_connection() -> None:
    """`cap_spend` is session-terminal: the peer is told, then the wire goes away."""

    def handler(peer_cid: int, request: dict) -> dict:
        raise CapSpendError("session ledger exhausted")

    with running_server(handler) as (listener, audit):
        sock = raw_connect(listener)
        try:
            sock.sendall(encode_frame({"op": "exec"}, MAX_FRAME_LEN))
            response = read_frame(sock.recv, MAX_FRAME_LEN)
            assert response is not None
            assert response["ok"] is False
            assert response["error"]["code"] == "cap_spend"
            assert response["error"]["retryable"] is False
            assert_dropped(sock)
        finally:
            sock.close()

    assert "session_halted" in events(audit)


def test_recoverable_error_keeps_the_connection() -> None:
    """A retryable cap is returned and the peer may keep talking."""
    calls: list[int] = []

    def handler(peer_cid: int, request: dict) -> dict:
        calls.append(1)
        if len(calls) == 1:
            raise CapRateError("slow down", retry_after_s=0.25)
        return {"ok": True, "second": True}

    with running_server(handler) as (listener, _audit):
        sock = raw_connect(listener)
        try:
            sock.sendall(encode_frame({"op": "a"}, MAX_FRAME_LEN))
            first = read_frame(sock.recv, MAX_FRAME_LEN)
            sock.sendall(encode_frame({"op": "b"}, MAX_FRAME_LEN))
            second = read_frame(sock.recv, MAX_FRAME_LEN)
        finally:
            sock.close()

    assert first is not None and first["error"]["code"] == "cap_rate"
    assert first["error"]["retry_after_s"] == 0.25
    assert second == {"ok": True, "second": True}


def test_handler_crash_becomes_an_upstream_error() -> None:
    """A bug in the handler is not a reason to leak a traceback or wedge the loop."""

    def handler(peer_cid: int, request: dict) -> dict:
        if request["op"] == "boom":
            raise ZeroDivisionError("division by zero")
        return {"ok": True}

    with running_server(handler) as (listener, audit):
        sock = raw_connect(listener)
        try:
            sock.sendall(encode_frame({"op": "boom"}, MAX_FRAME_LEN))
            first = read_frame(sock.recv, MAX_FRAME_LEN)
            sock.sendall(encode_frame({"op": "fine"}, MAX_FRAME_LEN))
            second = read_frame(sock.recv, MAX_FRAME_LEN)
        finally:
            sock.close()

    assert first is not None and first["error"]["code"] == "upstream"
    assert second == {"ok": True}
    assert "handler_crash" in events(audit)


def test_unserialisable_response_drops_the_connection() -> None:
    """A response we cannot frame is not half-sent."""

    def handler(peer_cid: int, request: dict) -> dict:
        return {"ok": True, "live_object": object()}

    with running_server(handler) as (listener, audit):
        sock = raw_connect(listener)
        try:
            sock.sendall(encode_frame({"op": "ping"}, MAX_FRAME_LEN))
            assert_dropped(sock)
        finally:
            sock.close()

    assert "response_frame_error" in events(audit)


def test_oversized_response_drops_the_connection() -> None:
    """The frame cap binds outbound as well as inbound."""

    def handler(peer_cid: int, request: dict) -> dict:
        return {"ok": True, "payload": "x" * (MAX_FRAME_LEN * 2)}

    with running_server(handler) as (listener, audit):
        sock = raw_connect(listener)
        try:
            sock.sendall(encode_frame({"op": "ping"}, MAX_FRAME_LEN))
            assert_dropped(sock)
        finally:
            sock.close()

    assert "response_frame_error" in events(audit)


# ---------------------------------------------------------------------------
# Loop lifecycle
# ---------------------------------------------------------------------------


def test_serve_connection_closes_the_connection_it_was_given() -> None:
    """Called directly, the loop still owns and releases the connection."""
    left, right = socket.socketpair()
    left.settimeout(CLIENT_TIMEOUT_S)
    right.settimeout(CLIENT_TIMEOUT_S)
    thread = threading.Thread(
        target=serve_connection,
        args=(right, 2, echo_handler, MAX_FRAME_LEN),
        daemon=True,
    )
    thread.start()
    try:
        left.sendall(encode_frame({"op": "ping"}, MAX_FRAME_LEN))
        assert read_frame(left.recv, MAX_FRAME_LEN) is not None
        left.shutdown(socket.SHUT_WR)
        thread.join(timeout=JOIN_TIMEOUT_S)
        assert not thread.is_alive()
        assert left.recv(4) == b""
    finally:
        left.close()
        right.close()


def test_serve_forever_serves_many_connections_in_sequence() -> None:
    with running_server(echo_handler, peer_cid=9) as (listener, audit):
        for index in range(3):
            response = listener.client().request({"op": "ping", "n": index}, MAX_FRAME_LEN)
            assert response["peer_cid"] == 9
            assert response["echo"]["n"] == index

    assert events(audit).count("accepted") == 3


def test_client_raises_when_the_peer_drops_without_answering() -> None:
    """A dropped connection is a `FrameError` client-side, not a silent `None`."""

    def control_handler(peer_cid: int, request: dict) -> dict:
        require_host_cid(peer_cid)
        return {"ok": True}

    with running_server(control_handler, peer_cid=3) as (listener, _audit):
        client = LoopbackClient(listener.address, timeout_s=CLIENT_TIMEOUT_S)
        with pytest.raises(FrameError, match="without answering"):
            client.request({"op": "ping"}, MAX_FRAME_LEN)


# ---------------------------------------------------------------------------
# The vsock path
# ---------------------------------------------------------------------------


def test_vsock_module_imports_without_af_vsock() -> None:
    """The module loads on a host with no vsock; only construction fails there."""
    if vsock_available():
        pytest.skip("AF_VSOCK exists on this host; the unavailable path is unreachable")
    with pytest.raises(RuntimeError, match="AF_VSOCK is not available"):
        VsockListener(5003)
    with pytest.raises(RuntimeError, match="AF_VSOCK is not available"):
        VsockClient(2, 5001)


# ---------------------------------------------------------------------------
# The hybrid-vsock path — what the ratified VMM actually provides
# ---------------------------------------------------------------------------
#
# Cloud Hypervisor and Firecracker bridge guest `AF_VSOCK` to host `AF_UNIX`, so
# the host side of the ratified stack is a Unix socket and there is no CID to
# read at `accept()`. The pure-bytes half of that handshake is tested
# everywhere; the socket half needs `AF_UNIX` and is skipped on Windows, where
# the VMM does not run either.

needs_af_unix = pytest.mark.skipif(
    not hasattr(socket, "AF_UNIX"),
    reason="AF_UNIX is unavailable on this host (Windows); the VMM is Linux-only",
)


def test_hybrid_socket_path_appends_underscore_and_port() -> None:
    """The path convention is the VMM's: launch socket + `_` + guest-side port."""
    assert hybrid_socket_path("/run/vc/vm/abc/clh.sock", 5001) == (
        "/run/vc/vm/abc/clh.sock_5001"
    )


def test_hybrid_connect_command_is_a_newline_terminated_line() -> None:
    """The newline is load-bearing: a VMM has crashed on its absence."""
    assert hybrid_connect_command(5003) == b"CONNECT 5003\n"


def test_hybrid_ack_stops_at_the_newline_and_leaves_the_frame_alone() -> None:
    """The handshake and the first frame share a stream; the ack may not over-read.

    This is the whole reason the ack is read a byte at a time. A buffered read
    would swallow the length prefix and the frame after it would parse as
    garbage — the failure would look like a codec bug, not a handshake bug.
    """
    frame = encode_frame({"op": "ping"}, MAX_FRAME_LEN)
    recv = buffer_recv(b"OK 1234\n" + frame)

    assert read_hybrid_ack(recv) == 1234
    assert read_frame(recv, MAX_FRAME_LEN) == {"op": "ping"}


def test_hybrid_ack_raises_on_a_refusal() -> None:
    """No guest listener on that port is a failed connect, not an open stream."""
    with pytest.raises(FrameError, match="refused"):
        read_hybrid_ack(buffer_recv(b"connection refused\n"))


def test_hybrid_ack_raises_on_an_unterminated_line() -> None:
    with pytest.raises(FrameError, match="no newline"):
        read_hybrid_ack(buffer_recv(b"OK " + b"9" * 200))


def test_hybrid_ack_raises_when_the_vmm_closes_mid_handshake() -> None:
    with pytest.raises(FrameError, match="closed"):
        read_hybrid_ack(buffer_recv(b"OK 12"))


def test_hybrid_ack_raises_when_ok_carries_no_port() -> None:
    with pytest.raises(FrameError, match="no port"):
        read_hybrid_ack(buffer_recv(b"OK\n"))


@contextmanager
def running_hybrid_server(handler, *, session_cid: int, uds_path: str, port: int = 5001):
    """`serve_forever` over a `HybridVsockListener`, and prove it stops."""
    listener = HybridVsockListener(
        uds_path,
        port,
        session_cid,
        accept_timeout_s=0.05,
        read_timeout_s=SERVER_READ_TIMEOUT_S,
    )
    audit: list[tuple[str, dict]] = []

    def record(event: str, **fields: object) -> None:
        audit.append((event, fields))

    stop = threading.Event()
    thread = threading.Thread(
        target=serve_forever,
        args=(listener, handler, MAX_FRAME_LEN, record, stop),
        daemon=True,
    )
    thread.start()
    try:
        yield listener, audit
    finally:
        stop.set()
        listener.close()
        thread.join(timeout=JOIN_TIMEOUT_S)
        assert not thread.is_alive(), "serve_forever did not stop on its stop event"


def hybrid_request(path: str, payload: dict) -> dict:
    """One framed request over the host-side Unix socket, as the VMM delivers it."""
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(CLIENT_TIMEOUT_S)
    try:
        sock.connect(path)
        sock.sendall(encode_frame(payload, MAX_FRAME_LEN))
        response = read_frame(sock.recv, MAX_FRAME_LEN)
        assert response is not None
        return response
    finally:
        sock.close()


@needs_af_unix
def test_hybrid_listener_reports_the_host_assigned_session_id(tmp_path) -> None:
    """There is no CID to read, so the id comes from the socket the host created."""
    uds = str(tmp_path / "clh.sock")
    with running_hybrid_server(echo_handler, session_cid=7, uds_path=uds) as (listener, audit):
        assert listener.path == f"{uds}_5001"
        response = hybrid_request(listener.path, {"op": "ping", "cid": 99, "peer_cid": 99})

    # The id the peer wrote into the frame is ignored here for the same reason it
    # is on the native transport: identity comes from the listener.
    assert response["peer_cid"] == 7
    assert events(audit).count("accepted") == 1


@needs_af_unix
def test_hybrid_listener_reclaims_a_stale_socket(tmp_path) -> None:
    """A leftover node from a crashed session must not block the next one."""
    uds = str(tmp_path / "clh.sock")
    stale = f"{uds}_5001"
    with open(stale, "wb"):
        pass

    with running_hybrid_server(echo_handler, session_cid=3, uds_path=uds) as (listener, _a):
        assert hybrid_request(listener.path, {"op": "ping"})["peer_cid"] == 3


@needs_af_unix
def test_hybrid_listener_refuses_to_steal_a_live_socket(tmp_path) -> None:
    """Unlinking a live path would hand one sandbox's guest another's caps.

    The negative case of the test above: `_reclaim_path` must tell a corpse from
    a live listener, or "reclaim the stale socket" becomes "take over the running
    session's port."
    """
    uds = str(tmp_path / "clh.sock")
    with running_hybrid_server(echo_handler, session_cid=3, uds_path=uds) as (listener, _a):
        with pytest.raises(RuntimeError, match="live listener"):
            HybridVsockListener(uds, 5001, 4)
        # The first listener is untouched and still serving its own session.
        assert hybrid_request(listener.path, {"op": "ping"})["peer_cid"] == 3


@needs_af_unix
def test_hybrid_listener_removes_its_socket_on_close(tmp_path) -> None:
    uds = str(tmp_path / "clh.sock")
    listener = HybridVsockListener(uds, 5002, 3, accept_timeout_s=0.05)
    path = listener.path
    assert os.path.exists(path)
    listener.close()
    assert not os.path.exists(path)


@needs_af_unix
def test_hybrid_host_client_performs_the_connect_handshake(tmp_path) -> None:
    """Host→guest: dial the launch socket, `CONNECT <port>`, then frames.

    The fake VMM here answers the handshake and then serves one frame, which is
    what Cloud Hypervisor does once it has bridged the connection to the guest
    listener.
    """
    uds = str(tmp_path / "clh.sock")
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(uds)
    server.listen(1)
    server.settimeout(JOIN_TIMEOUT_S)
    seen: list[bytes] = []

    def fake_vmm() -> None:
        conn, _ = server.accept()
        conn.settimeout(CLIENT_TIMEOUT_S)
        line = bytearray()
        while not line.endswith(b"\n"):
            line += conn.recv(1)
        seen.append(bytes(line))
        conn.sendall(b"OK 4242\n")
        request = read_frame(conn.recv, MAX_FRAME_LEN)
        conn.sendall(encode_frame({"ok": True, "echo": request}, MAX_FRAME_LEN))
        conn.close()

    thread = threading.Thread(target=fake_vmm, daemon=True)
    thread.start()
    try:
        client = HybridVsockHostClient(uds, 5003, timeout_s=CLIENT_TIMEOUT_S)
        response = client.request({"op": "ping"}, MAX_FRAME_LEN)
    finally:
        thread.join(timeout=JOIN_TIMEOUT_S)
        server.close()

    assert seen == [b"CONNECT 5003\n"]
    assert response == {"ok": True, "echo": {"op": "ping"}}
    assert client.assigned_port == 4242
