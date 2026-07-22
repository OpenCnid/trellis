"""The wire frame: 4-byte big-endian length prefix + UTF-8 JSON payload.

This is byte-identical to rlms' own framing (`rlm.core.comms_utils.socket_send`
/ `socket_recv`), so the LM path needs no protocol redesign and the bridge can
carry rlms frames transparently.

**This module is the fuzz target.** INTERFACES section 3.5 makes a
coverage-guided fuzz pass plus a standalone security review a merge gate before
the bridge ships. It is deliberately small, single-purpose, and fail-closed:

* the declared length is checked against `max_len` **before** any allocation
  sized by it — the 4-byte prefix admits 4 GiB and a hostile guest will send it;
* a partial, truncated, non-UTF-8, malformed, or over-deep frame is an error,
  never a best-effort recovery;
* the top level must be a JSON object, because every envelope in this system is.

The reader takes a `recv`-shaped callable rather than a socket so the same code
serves vsock, loopback, and an in-memory buffer under fuzzing.
"""

from __future__ import annotations

import json
import struct
from typing import Callable, Protocol

from repl_sandbox.errors import FrameError

#: Width of the length prefix, in bytes.
LENGTH_PREFIX_BYTES = 4

#: Frame-format version. INTERFACES section 8: any bump re-triggers the
#: section 3.5 fuzz + security-review gate.
FRAME_FORMAT_VERSION = 1

#: Nesting depth above which a payload is rejected rather than parsed. Deeply
#: nested JSON is a cheap way to drive the decoder into the C-stack limit.
MAX_JSON_DEPTH = 64


class SupportsRecv(Protocol):
    """The one socket method the reader needs."""

    def recv(self, bufsize: int, /) -> bytes: ...


RecvFn = Callable[[int], bytes]


def encode_frame(payload: dict, max_len: int) -> bytes:
    """Serialise `payload` to a length-prefixed UTF-8 JSON frame.

    Every bound the reader enforces is enforced here too, so a host bug cannot
    emit a frame its peer is obliged to reject. That symmetry is the point: an
    encoder that admits what the decoder refuses is a documented bound with no
    engine behind it, which is the failure this house names by name.
    """
    if not isinstance(payload, dict):
        raise FrameError(f"frame payload must be a JSON object, got {type(payload).__name__}")
    validate_payload(payload, MAX_JSON_DEPTH)
    try:
        body = json.dumps(payload, allow_nan=False).encode("utf-8")
    except (TypeError, ValueError, RecursionError) as exc:
        raise FrameError(f"payload is not JSON-serialisable: {exc}") from exc
    if len(body) > max_len:
        raise FrameError(f"frame of {len(body)} bytes exceeds max_frame_len {max_len}")
    return struct.pack(">I", len(body)) + body


def recv_exactly(recv: RecvFn, count: int) -> bytes:
    """Read exactly `count` bytes, or raise.

    A short read at end-of-stream is a truncated frame, which is an error: the
    reader never returns a partial payload for a caller to interpret.
    """
    if count == 0:
        return b""
    chunks: list[bytes] = []
    remaining = count
    while remaining > 0:
        chunk = recv(remaining)
        if not chunk:
            raise FrameError(
                f"connection closed after {count - remaining} of {count} bytes"
            )
        chunks.append(chunk)
        remaining -= len(chunk)
        if remaining < 0:
            raise FrameError("transport returned more bytes than requested")
    return b"".join(chunks)


def _check_scalar(node: object) -> None:
    """Reject leaf values that decode cleanly but cannot be re-encoded.

    Two shapes get through a strict UTF-8 decode and a JSON parse and then
    fail on the way back out, which would split the two directions of this
    codec into disagreeing about what a legal frame is:

    * non-finite floats — `NaN` and `Infinity` are non-standard literals the
      decoder accepts by default, and `1e999` reaches infinity with no literal
      at all, while `encode_frame` refuses all three under `allow_nan=False`;
    * lone surrogates — `"\\ud800"` is plain ASCII on the wire, so the strict
      decode never sees it, but the resulting `str` raises on `.encode("utf-8")`
      for any consumer that puts it back on a wire or into Postgres.
    """
    if isinstance(node, float):
        if node != node or node in (float("inf"), float("-inf")):
            raise FrameError("frame carries a non-finite number")
    elif isinstance(node, str):
        try:
            node.encode("utf-8")
        except UnicodeEncodeError as exc:
            raise FrameError(f"frame carries an unencodable string: {exc}") from exc


#: Container types this validator descends. It must match the set `json.dumps`
#: serialises, or a payload rides through the encoder unvalidated: a tuple is
#: emitted as a JSON array, so anything inside one would bypass every bound
#: below and produce a frame the reader then refuses — the exact encode/decode
#: asymmetry these checks exist to prevent.
CONTAINER_TYPES = (dict, list, tuple)

#: Ceiling on the total nodes one payload may contain. Depth bounds the *shape*
#: of the traversal; this bounds its *work*. Without it a flat, in-bound frame
#: of millions of small scalars costs host CPU proportional to its element
#: count on every frame, which a guest can repeat at whatever rate the caller's
#: bucket allows — a bound that holds while the work behind it does not.
MAX_JSON_NODES = 1_000_000


def validate_payload(value: object, limit: int, max_nodes: int = MAX_JSON_NODES) -> None:
    """Bound nesting depth, total node count, and unencodable leaves, iteratively.

    Only containers are pushed onto the stack; scalars are checked in place, so
    the stack holds container entries rather than one entry per node.
    """
    stack: list[tuple[object, int]] = [(value, 1)]
    seen = 0
    while stack:
        node, depth = stack.pop()
        if depth > limit:
            raise FrameError(f"frame nested deeper than {limit} levels")
        if isinstance(node, dict):
            items: object = node.items()
        elif isinstance(node, CONTAINER_TYPES):
            items = ((None, item) for item in node)
        else:
            _check_scalar(node)
            continue
        for key, item in items:  # type: ignore[union-attr]
            seen += 1
            if seen > max_nodes:
                raise FrameError(f"frame carries more than {max_nodes} values")
            if key is not None:
                _check_scalar(key)
            if isinstance(item, CONTAINER_TYPES):
                stack.append((item, depth + 1))
            else:
                _check_scalar(item)


def _reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict:
    """Build an object, refusing duplicate keys rather than taking the last.

    Silent last-wins resolution is the classic parser-differential shape: if
    anything host-side ever re-reads these bytes with different tooling — a
    broker in another language, a JSON tool in an audit path — the two readers
    can disagree about the value of a routing field. Refusing costs nothing,
    because no conforming encoder emits a duplicate.
    """
    seen: set[str] = set()
    for key, _ in pairs:
        if key in seen:
            raise FrameError(f"frame carries a duplicate object key: {key!r}")
        seen.add(key)
    return dict(pairs)


def decode_payload(body: bytes, max_len: int) -> dict:
    """Decode a frame body that has already been read and length-checked."""
    if len(body) > max_len:
        raise FrameError(f"frame body of {len(body)} bytes exceeds max_frame_len {max_len}")
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise FrameError(f"frame body is not valid UTF-8: {exc}") from exc
    try:
        payload = json.loads(text, object_pairs_hook=_reject_duplicate_keys)
    except (ValueError, RecursionError) as exc:
        raise FrameError(f"frame body is not valid JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise FrameError(
            f"frame payload must be a JSON object, got {type(payload).__name__}"
        )
    validate_payload(payload, MAX_JSON_DEPTH)
    return payload


def read_frame(recv: RecvFn, max_len: int) -> dict | None:
    """Read one frame. Returns `None` on a clean end-of-stream before any bytes.

    Ordering is the whole point: the declared length is compared to `max_len`
    and only then is a buffer of that size read. A frame declaring 4 GiB is
    refused at a cost of four bytes.
    """
    if max_len <= 0:
        raise FrameError(f"max_frame_len must be positive, got {max_len}")

    prefix = recv(LENGTH_PREFIX_BYTES)
    if not prefix:
        return None
    if len(prefix) > LENGTH_PREFIX_BYTES:
        # `recv_exactly` already refuses an over-delivering transport, but the
        # prefix read bypasses it, and an over-wide buffer would reach
        # `struct.unpack` and raise outside the taxonomy — so the caller's
        # fail-closed drop never runs and the fault is never audited.
        raise FrameError("transport returned more bytes than requested")
    if len(prefix) < LENGTH_PREFIX_BYTES:
        prefix += recv_exactly(recv, LENGTH_PREFIX_BYTES - len(prefix))

    (declared,) = struct.unpack(">I", prefix)
    if declared > max_len:
        raise FrameError(f"declared frame length {declared} exceeds max_frame_len {max_len}")
    if declared == 0:
        raise FrameError("declared frame length is zero")

    body = recv_exactly(recv, declared)
    return decode_payload(body, max_len)


def read_frame_from_socket(sock: SupportsRecv, max_len: int) -> dict | None:
    """`read_frame` bound to a socket-shaped object."""
    return read_frame(sock.recv, max_len)


def buffer_recv(data: bytes) -> RecvFn:
    """A `recv` over a fixed byte string — the fuzz and unit-test transport.

    Returns short reads at the end of the buffer exactly as a socket does, so a
    truncated frame is exercised rather than papered over.
    """
    view = memoryview(data)
    position = 0

    def recv(count: int) -> bytes:
        nonlocal position
        chunk = bytes(view[position : position + count])
        position += len(chunk)
        return chunk

    return recv
