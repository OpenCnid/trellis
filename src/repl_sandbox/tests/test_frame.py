"""Adversarial unit suite for the wire frame reader.

INTERFACES section 3.5 (Fuzz + security-review requirement) makes a
coverage-guided pass over the length-and-JSON parser a merge gate, and
ARCHITECTURE section 7 (Security requirements) requirement 10 makes a standalone
security review a condition of shipping the bridge. This file is the
deterministic half of that gate; `fuzz_frame.py` next to it is the randomised
half.

Every test here is written from the guest's side of the trust boundary: the
declared length, the body bytes, and the JSON shape are all attacker-chosen. Two
things are asserted for each hostile input, not one:

* the failure is a `FrameError` — inside the taxonomy, so the caller's
  fail-closed path actually runs;
* the reader did not do work proportional to the *declared* length. A frame
  claiming 4 GiB must cost four bytes to refuse, and the way that is asserted is
  by counting the bytes the reader asked the transport for and by capping the
  peak heap delta — never by surviving the allocation.

Seven gaps this suite found have been closed in `frame.py`. Six came from the
first pass — a `struct.error` escape on an over-delivering prefix read, an
encoder that did not apply the depth bound, non-finite literals and escaped lone
surrogates crossing inbound, a traversal that cost thirty times the frame in
heap, and silent last-wins duplicate keys. The seventh came from re-reading the
fixes: `validate_payload` descended `dict` and `list`, but `json.dumps` also
serialises `tuple`, so everything the validator enforced was bypassed inside one
and the encoder emitted frames the reader then refused — the same asymmetry the
second and fourth fixes had just closed, reached through a type Python code
produces without thinking about it. `CONTAINER_TYPES` now names the set the
serialiser actually walks.

The tests that pinned each gap assert the closed contract instead, including the
accepting side of every new bound, because a refusal that overshoots is its own
defect: a check that rejects a valid surrogate pair, a large finite float, or an
ordinary shallow tuple would have broken the format in the name of fixing it.

Closing the tuple gap left the traversal visiting every node, so a flat in-bound
frame of millions of scalars still cost host CPU proportional to its element
count. `MAX_JSON_NODES` bounds that: depth bounds the traversal's shape, the node
ceiling bounds its work. Nothing in this file edits or monkey-patches `frame.py`.
"""

from __future__ import annotations

import json
import struct
import tracemalloc
from typing import Callable

import pytest

from repl_sandbox.errors import FrameError, SandboxError
from repl_sandbox.frame import (
    LENGTH_PREFIX_BYTES,
    MAX_JSON_DEPTH,
    MAX_JSON_NODES,
    buffer_recv,
    decode_payload,
    encode_frame,
    read_frame,
    read_frame_from_socket,
    recv_exactly,
    validate_payload,
)

#: Working bound for the tests that are not about the bound itself. Small on
#: purpose: a test that needs 16 MiB to make its point is testing the allocator.
MAX = 1 << 16

#: The full 4-byte prefix space. The hostile guest's opening move.
FOUR_GIB_MINUS_ONE = 0xFFFFFFFF

#: Ceiling on the heap a refusal may cost. Well above the tens of bytes a
#: refusal actually needs and far below any length the tests declare.
REFUSAL_ALLOC_BUDGET = 64 * 1024


# ---------------------------------------------------------------------------
# Instrumented transports
#
# All of these are test doubles over a byte string, not sockets. They exist so
# the reader's *requests* can be observed, which is how "no allocation
# proportional to the declared length" is asserted without ever allocating it.
# ---------------------------------------------------------------------------


class RecordingRecv:
    """A socket-shaped `recv` over a fixed buffer that logs what it was asked for.

    Test double. Short reads at the end of the buffer are returned exactly as a
    socket returns them, so truncation is exercised rather than papered over.
    """

    def __init__(self, data: bytes, *, chunk: int | None = None) -> None:
        self.data = data
        self.position = 0
        self.requests: list[int] = []
        self.chunk = chunk

    def __call__(self, count: int) -> bytes:
        self.requests.append(count)
        take = count if self.chunk is None else min(count, self.chunk)
        out = self.data[self.position : self.position + take]
        self.position += len(out)
        return out

    @property
    def largest_request(self) -> int:
        return max(self.requests, default=0)


class OverReadingRecv:
    """A transport that returns *more* bytes than requested.

    Test double for a broken or hostile transport implementation — a real
    `socket.recv` never over-delivers. Kept because the reader is documented as
    fail-closed against its transport, and `recv_exactly` carries an explicit
    check for exactly this.
    """

    def __init__(self, data: bytes, *, extra: int = 4) -> None:
        self.data = data
        self.position = 0
        self.extra = extra

    def __call__(self, count: int) -> bytes:
        out = self.data[self.position : self.position + count + self.extra]
        self.position += len(out)
        return out


class _BoundedAllocation:
    """Assert the block's peak heap delta stays under `limit`."""

    def __init__(self, limit: int) -> None:
        self.limit = limit
        self._was_tracing = False
        self._base = 0

    def __enter__(self) -> _BoundedAllocation:
        self._was_tracing = tracemalloc.is_tracing()
        if not self._was_tracing:
            tracemalloc.start()
        tracemalloc.reset_peak()
        self._base = tracemalloc.get_traced_memory()[0]
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        peak = tracemalloc.get_traced_memory()[1]
        if not self._was_tracing:
            tracemalloc.stop()
        if exc_type is None:
            delta = peak - self._base
            assert delta <= self.limit, (
                f"peak heap grew by {delta} bytes, above the {self.limit}-byte budget "
                "— the reader allocated on a length it should have refused"
            )
        return False


def bounded_allocation(limit: int = REFUSAL_ALLOC_BUDGET) -> _BoundedAllocation:
    return _BoundedAllocation(limit)


def framed(declared: int, body: bytes = b"") -> bytes:
    """A hand-built frame whose prefix may lie about the body that follows."""
    return struct.pack(">I", declared) + body


def nest_objects(levels: int) -> dict:
    """`{"n": {"n": ... }}` with `levels` dicts, innermost empty."""
    node: dict = {}
    for _ in range(levels - 1):
        node = {"n": node}
    return node


def nest_arrays(levels: int) -> dict:
    """A single object whose one value is `levels` nested arrays."""
    node: object = []
    for _ in range(levels - 1):
        node = [node]
    return {"a": node}


# ---------------------------------------------------------------------------
# 1. The declared length: refused before it is believed
# ---------------------------------------------------------------------------


def test_declared_length_of_four_gib_is_refused_at_a_cost_of_four_bytes() -> None:
    """The opening move: the prefix admits 4 GiB and the guest will send it.

    The refusal is asserted three ways — the error class, the bytes the reader
    asked for (the prefix and nothing else), and the heap it took.
    """
    recv = RecordingRecv(framed(FOUR_GIB_MINUS_ONE))
    with bounded_allocation():
        with pytest.raises(FrameError) as caught:
            read_frame(recv, MAX)

    assert recv.requests == [LENGTH_PREFIX_BYTES]
    assert recv.largest_request == LENGTH_PREFIX_BYTES
    assert recv.position == LENGTH_PREFIX_BYTES
    assert str(FOUR_GIB_MINUS_ONE) in str(caught.value)
    assert caught.value.code == "frame"
    assert caught.value.connection_terminal is True
    assert caught.value.retryable is False


def test_declared_length_one_byte_over_max_len_is_refused_before_the_body() -> None:
    """The bound is `>`, so `max_len + 1` is the first refused value."""
    recv = RecordingRecv(framed(MAX + 1, b"x" * 32))
    with bounded_allocation():
        with pytest.raises(FrameError, match="exceeds max_frame_len"):
            read_frame(recv, MAX)
    assert recv.requests == [LENGTH_PREFIX_BYTES]


def test_declared_length_exactly_at_max_len_is_accepted() -> None:
    """The other side of the same `>`: the bound is inclusive."""
    payload = {"k": "v"}
    body = json.dumps(payload).encode("utf-8")
    exact = len(body)

    recv = RecordingRecv(framed(exact, body))
    assert read_frame(recv, exact) == payload
    assert recv.requests == [LENGTH_PREFIX_BYTES, exact]


def test_encode_frame_agrees_with_the_reader_on_the_max_len_boundary() -> None:
    """A frame the encoder emits at the bound is one the reader accepts at it."""
    payload = {"k": "v"}
    exact = len(json.dumps(payload).encode("utf-8"))

    wire = encode_frame(payload, exact)
    assert read_frame(buffer_recv(wire), exact) == payload
    with pytest.raises(FrameError, match="exceeds max_frame_len"):
        encode_frame(payload, exact - 1)


def test_declared_length_of_zero_is_refused() -> None:
    """An empty body can never be a JSON object, so it is refused at the prefix."""
    recv = RecordingRecv(framed(0))
    with pytest.raises(FrameError, match="declared frame length is zero"):
        read_frame(recv, MAX)
    assert recv.requests == [LENGTH_PREFIX_BYTES]


def test_non_positive_max_len_is_refused_before_the_transport_is_touched() -> None:
    """A misconfigured bound is a host bug and must not degrade to unbounded."""
    for bad in (0, -1, -(1 << 40)):
        recv = RecordingRecv(framed(4, b"{}"))
        with pytest.raises(FrameError, match="max_frame_len must be positive"):
            read_frame(recv, bad)
        assert recv.requests == []


# ---------------------------------------------------------------------------
# 2. Truncation: the prefix, the body, and the one case that returns None
# ---------------------------------------------------------------------------


def test_clean_zero_byte_end_of_stream_returns_none() -> None:
    """The single non-error, non-payload outcome in the whole reader."""
    recv = RecordingRecv(b"")
    assert read_frame(recv, MAX) is None
    assert recv.requests == [LENGTH_PREFIX_BYTES]


def test_truncated_prefix_of_one_two_or_three_bytes_is_a_frame_error() -> None:
    """A stream that dies inside the length field is truncated, not empty."""
    for width in (1, 2, 3):
        recv = RecordingRecv(b"\x00" * width)
        with pytest.raises(FrameError, match="connection closed") as caught:
            read_frame(recv, MAX)
        assert caught.value.code == "frame"
        # The reader asked for the rest of the prefix and got nothing.
        assert recv.requests[0] == LENGTH_PREFIX_BYTES
        assert recv.requests[1] == LENGTH_PREFIX_BYTES - width


def test_prefix_delivered_one_byte_at_a_time_still_reads() -> None:
    """Short reads are the normal case on a stream socket, not an attack."""
    payload = {"ok": True}
    recv = RecordingRecv(encode_frame(payload, MAX), chunk=1)
    assert read_frame(recv, MAX) == payload


def test_body_shorter_than_declared_is_a_frame_error() -> None:
    """The prefix lies high; the reader must not return the short body."""
    body = b'{"a": 1}'
    recv = RecordingRecv(framed(len(body) + 16, body))
    with pytest.raises(FrameError, match="connection closed after") as caught:
        read_frame(recv, MAX)
    assert f"of {len(body) + 16} bytes" in str(caught.value)
    assert caught.value.code == "frame"


def test_stream_closing_mid_body_is_a_frame_error() -> None:
    """Same defect arriving as a mid-payload disconnect rather than a short buffer."""
    payload = {"data": "x" * 200}
    wire = encode_frame(payload, MAX)
    recv = RecordingRecv(wire[: LENGTH_PREFIX_BYTES + 7], chunk=3)
    with pytest.raises(FrameError, match="connection closed after 7 of"):
        read_frame(recv, MAX)


def test_declared_length_far_over_the_body_costs_only_the_bytes_on_the_wire() -> None:
    """A big-but-legal declaration still must not pre-allocate its declaration."""
    recv = RecordingRecv(framed(MAX, b"{}"))
    with bounded_allocation():
        with pytest.raises(FrameError, match="connection closed after 2 of"):
            read_frame(recv, MAX)


def test_recv_exactly_of_zero_bytes_never_touches_the_transport() -> None:
    recv = RecordingRecv(b"payload")
    assert recv_exactly(recv, 0) == b""
    assert recv.requests == []


# ---------------------------------------------------------------------------
# 3. The body bytes: UTF-8
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "label,body",
    [
        ("bare continuation byte", b'{"a":"\x80"}'),
        ("truncated two-byte sequence", b'{"a":"\xc3"}'),
        ("truncated three-byte sequence", b'{"a":"\xe2\x82"}'),
        ("truncated four-byte sequence", b'{"a":"\xf0\x9f\x92"}'),
        ("lone surrogate D800", b'{"a":"\xed\xa0\x80"}'),
        ("lone surrogate DFFF", b'{"a":"\xed\xbf\xbf"}'),
        ("overlong slash", b'{"a":"\xc0\xaf"}'),
        ("out-of-range F5", b'{"a":"\xf5\x80\x80\x80"}'),
        ("UTF-16 BOM as body", b"\xff\xfe{\x00}\x00"),
        ("all-high-bit noise", bytes(range(0x80, 0xC0))),
    ],
)
def test_invalid_utf8_body_is_a_frame_error(label: str, body: bytes) -> None:
    """The decode is strict; there is no replacement-character recovery path."""
    recv = RecordingRecv(framed(len(body), body))
    with pytest.raises(FrameError, match="not valid UTF-8") as caught:
        read_frame(recv, MAX)
    assert caught.value.code == "frame", label
    assert isinstance(caught.value.__cause__, UnicodeDecodeError)


def test_valid_but_hostile_utf8_that_is_still_json_is_accepted() -> None:
    """Astral-plane and NUL bytes inside a JSON string are legal input, not attacks."""
    payload = {"astral": "\U0001f600", "nul": "a\u0000b", "rtl-override": "\u202e"}
    assert read_frame(buffer_recv(encode_frame(payload, MAX)), MAX) == payload


# ---------------------------------------------------------------------------
# 4. The JSON: malformed, wrong-typed, and non-finite
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        b"{",
        b"}",
        b'{"a"',
        b'{"a":}',
        b'{"a":1,}',
        b"{'a': 1}",
        b'{"a": 01}',
        b'{"a": +1}',
        b'{"a": .5}',
        b'{"a": 1} trailing',
        b'{"a": "unterminated',
        b"\x00\x00\x00\x00",
        b"not json at all",
        b'{"a": undefined}',
        b'{"a": 1}\n{"b": 2}',
    ],
)
def test_malformed_json_is_a_frame_error(body: bytes) -> None:
    recv = RecordingRecv(framed(len(body), body))
    with pytest.raises(FrameError, match="not valid JSON") as caught:
        read_frame(recv, MAX)
    assert caught.value.code == "frame"


@pytest.mark.parametrize(
    "body,type_name",
    [
        (b"[1, 2, 3]", "list"),
        (b"[]", "list"),
        (b'"a string"', "str"),
        (b"12345", "int"),
        (b"1.5", "float"),
        (b"null", "NoneType"),
        (b"true", "bool"),
        (b"false", "bool"),
    ],
)
def test_valid_json_that_is_not_an_object_is_a_frame_error(
    body: bytes, type_name: str
) -> None:
    """Every envelope in this system is an object; a bare scalar is a protocol error."""
    recv = RecordingRecv(framed(len(body), body))
    with pytest.raises(FrameError, match="must be a JSON object") as caught:
        read_frame(recv, MAX)
    assert type_name in str(caught.value)
    assert caught.value.code == "frame"


@pytest.mark.parametrize("literal", [b"NaN", b"Infinity", b"-Infinity"])
def test_non_finite_json_literals_are_refused(literal: bytes) -> None:
    """F3 closed: the two directions of the codec now agree.

    `json.loads` accepts the non-standard `NaN` / `Infinity` / `-Infinity`
    literals by default, so a float the *encoder* refuses under
    `allow_nan=False` used to cross inbound and become unreturnable. The
    validator now rejects it at the leaf, inside the taxonomy.
    """
    body = b'{"a": ' + literal + b"}"
    with pytest.raises(FrameError, match="non-finite number") as caught:
        read_frame(buffer_recv(framed(len(body), body)), MAX)
    assert caught.value.code == "frame"
    assert caught.value.connection_terminal is True


def test_non_finite_values_are_refused_wherever_they_are_nested() -> None:
    """A leaf check that only ran at the top level would be no check at all."""
    for body in (
        b'{"a": {"b": NaN}}',
        b'{"a": [1, 2, Infinity]}',
        b'{"a": {"b": [{"c": [-Infinity]}]}}',
        b'{"a": [[[1e999]]]}',
    ):
        with pytest.raises(FrameError, match="non-finite number"):
            read_frame(buffer_recv(framed(len(body), body)), MAX)


def test_escaped_lone_surrogate_is_refused() -> None:
    """F4 closed: the escape door into an unencodable string is shut.

    The raw bytes of a lone surrogate were always refused by the strict UTF-8
    decode, but the `\\uD800` *escape* is plain ASCII on the wire, so the decode
    never saw it and `json.loads` built the unpaired code point. The reader used
    to hand its caller a `str` that raises on `.encode("utf-8")`.
    """
    body = b'{"a": "\\ud800"}'
    with pytest.raises(FrameError, match="unencodable string") as caught:
        read_frame(buffer_recv(framed(len(body), body)), MAX)
    assert caught.value.code == "frame"
    assert isinstance(caught.value.__cause__, UnicodeEncodeError)


def test_escaped_lone_surrogate_in_a_key_is_refused() -> None:
    """Keys are strings on the wire too, and the validator checks them."""
    body = b'{"\\udfff": 1}'
    with pytest.raises(FrameError, match="unencodable string"):
        read_frame(buffer_recv(framed(len(body), body)), MAX)


def test_a_valid_surrogate_pair_is_still_accepted() -> None:
    """The surrogate check must reject unpaired code points, not astral characters.

    `\\ud83d\\ude00` is a legal escaped pair for U+1F600. Refusing it would be a
    fix that broke the format, so the boundary is asserted from both sides.
    """
    body = b'{"a": "\\ud83d\\ude00"}'
    payload = read_frame(buffer_recv(framed(len(body), body)), MAX)
    assert payload == {"a": "\U0001f600"}
    assert payload["a"].encode("utf-8") == b"\xf0\x9f\x98\x80"


def test_duplicate_object_keys_are_refused() -> None:
    """F6 closed: last-wins resolution is now an error, not a silent choice.

    Two readers of the same frame disagreeing about which value wins is the
    classic smuggling shape. Refusing costs nothing because no conforming
    encoder emits a duplicate.
    """
    body = b'{"a": 1, "a": 2}'
    with pytest.raises(FrameError, match="duplicate object key") as caught:
        read_frame(buffer_recv(framed(len(body), body)), MAX)
    assert caught.value.code == "frame"


def test_duplicate_keys_are_refused_in_a_nested_object() -> None:
    """The hook runs per object, so depth must not be a way around it."""
    for body in (
        b'{"x": {"a": 1, "a": 2}}',
        b'{"x": [{"a": 1, "b": 2, "a": 3}]}',
    ):
        with pytest.raises(FrameError, match="duplicate object key"):
            read_frame(buffer_recv(framed(len(body), body)), MAX)


def test_distinct_keys_that_merely_look_similar_still_round_trip() -> None:
    """The duplicate check compares code points; it must not normalise or fold.

    `\u00e9` and `e\u0301` render identically and are different keys. A check
    that collapsed them would reject legal frames, which is how a fix for a
    parser-differential becomes a parser-differential of its own.
    """
    payload = {"a": 1, "A": 2, "a ": 3, "é": 4, "é": 5}
    assert len(payload) == 5
    assert read_frame(buffer_recv(encode_frame(payload, MAX)), MAX) == payload


def test_integers_beyond_the_str_conversion_limit_are_a_frame_error() -> None:
    """CPython's int/str digit limit surfaces as ValueError; the reader catches it."""
    body = b'{"a": ' + b"9" * 100_000 + b"}"
    with pytest.raises(FrameError, match="not valid JSON"):
        read_frame(buffer_recv(framed(len(body), body)), len(body) + 8)


def test_float_overflow_to_infinity_is_refused() -> None:
    """The same F3 gap by another door, and the door is shut too.

    `1e999` reaches infinity by IEEE rules with no non-standard literal
    involved, so a fix that only refused the spelled-out `Infinity` token would
    have left the value reachable. The check is on the decoded float, not on the
    text, which is why this case closes with the others.
    """
    for body in (b'{"a": 1e999}', b'{"a": -1e999}', b'{"a": 1E400}'):
        with pytest.raises(FrameError, match="non-finite number"):
            read_frame(buffer_recv(framed(len(body), body)), MAX)


def test_large_but_finite_floats_are_still_accepted() -> None:
    """The non-finite check must not become a magnitude check."""
    body = b'{"a": 1.7976931348623157e308, "b": 5e-324, "c": -0.0}'
    payload = read_frame(buffer_recv(framed(len(body), body)), MAX)
    assert payload["a"] == 1.7976931348623157e308
    assert payload["b"] == 5e-324


# ---------------------------------------------------------------------------
# 5. Nesting: the depth ceiling and the decoder's own stack
# ---------------------------------------------------------------------------


def test_nesting_at_the_object_depth_ceiling_is_accepted() -> None:
    payload = nest_objects(MAX_JSON_DEPTH)
    assert read_frame(buffer_recv(encode_frame(payload, MAX)), MAX) == payload


def test_nesting_one_level_above_the_object_ceiling_is_refused() -> None:
    body = json.dumps(nest_objects(MAX_JSON_DEPTH + 1)).encode("utf-8")
    with pytest.raises(FrameError, match=f"nested deeper than {MAX_JSON_DEPTH} levels"):
        read_frame(buffer_recv(framed(len(body), body)), MAX)


def test_nesting_via_arrays_is_refused_at_the_same_ceiling() -> None:
    """The stack walk descends lists as well as dicts; both doors are the same door.

    The ceiling counts nodes, not containers of one kind, so the mandatory
    wrapping object costs the array chain one level: 63 arrays under an object
    is the same total depth as 64 nested objects.
    """
    ok = nest_arrays(MAX_JSON_DEPTH - 1)
    assert read_frame(buffer_recv(encode_frame(ok, MAX)), MAX) == ok

    body = json.dumps(nest_arrays(MAX_JSON_DEPTH)).encode("utf-8")
    with pytest.raises(FrameError, match="nested deeper than"):
        read_frame(buffer_recv(framed(len(body), body)), MAX)


def test_mixed_object_and_array_nesting_is_refused() -> None:
    body = (b'{"a":' + b'[{"b":' * 60 + b"1" + b"}]" * 60 + b"}")
    with pytest.raises(FrameError, match="nested deeper than"):
        read_frame(buffer_recv(framed(len(body), body)), MAX)


def test_deep_nesting_beyond_the_ceiling_is_refused_without_a_deep_walk() -> None:
    """The depth check must not itself recurse; 5000 levels proves it does not."""
    body = b'{"a":' + b"[" * 5000 + b"]" * 5000 + b"}"
    with bounded_allocation(2 * 1024 * 1024):
        with pytest.raises(FrameError) as caught:
            read_frame(buffer_recv(framed(len(body), body)), len(body) + 8)
    assert isinstance(caught.value, FrameError)


def test_payload_that_would_recurse_the_decoder_is_a_frame_error() -> None:
    """100k open brackets drives `json.loads` into RecursionError, which is caught.

    This is the case the taxonomy would leak if `decode_payload` caught only
    `ValueError`, so it is asserted on the class, not on surviving the call.
    """
    depth = 100_000
    body = b'{"a":' + b"[" * depth + b"]" * depth + b"}"
    with pytest.raises(FrameError, match="not valid JSON") as caught:
        read_frame(buffer_recv(framed(len(body), body)), len(body) + 8)
    assert isinstance(caught.value.__cause__, RecursionError)
    assert caught.value.code == "frame"


def test_unbalanced_deep_nesting_is_a_frame_error() -> None:
    """Open brackets with no close: recursion and malformity at once."""
    body = b'{"a":' + b"[" * 100_000
    with pytest.raises(FrameError, match="not valid JSON"):
        read_frame(buffer_recv(framed(len(body), body)), len(body) + 8)


def wide_flat_payload(wire_bytes: int) -> tuple[bytes, list]:
    """A legal, in-bound frame body of small integers, and its decoded form.

    The worst case for a traversal that costs per *node*: maximum node count per
    wire byte, minimum container count.
    """
    body = b'{"a":[' + b"0," * (wire_bytes // 2 - 4) + b"0]}"
    return body, json.loads(body.decode("utf-8"))["a"]


def measure_validation_peak(payload: dict) -> int:
    """Peak heap `validate_payload` itself allocates, in bytes.

    Measured on an already-decoded payload on purpose. End to end, `read_frame`
    is dominated by `json.loads` materialising a Python object per element,
    which is inherent to decoding and would drown the signal; the traversal is
    the surface that regressed and the surface this pins.
    """
    tracing = tracemalloc.is_tracing()
    if not tracing:
        tracemalloc.start()
    tracemalloc.reset_peak()
    base = tracemalloc.get_traced_memory()[0]
    validate_payload(payload, MAX_JSON_DEPTH)
    peak = tracemalloc.get_traced_memory()[1]
    if not tracing:
        tracemalloc.stop()
    return peak - base


def test_validation_of_a_wide_flat_payload_allocates_almost_nothing() -> None:
    """F5 closed, as an absolute bound rather than a ratio.

    The pre-fix traversal pushed a `(node, depth)` tuple for every node
    including scalars, so this payload cost about 32 times its wire size in host
    heap — 134.5 MB for a 4 MiB frame that passed every bound the reader checks.
    Containers only, and the stack now holds two entries no matter how many
    elements the list has, so the measured cost is effectively zero.

    The budget below is roughly a thousand times the observed allocation and
    still an order of magnitude under what the old traversal would take at this
    size, so it discriminates hard without depending on this machine.
    """
    wire = 256 * 1024
    body, _ = wide_flat_payload(wire)
    payload = read_frame(buffer_recv(framed(len(body), body)), len(body) + 8)
    assert isinstance(payload, dict)

    peak = measure_validation_peak(payload)
    assert peak < 64 * 1024, (
        f"validate_payload allocated {peak} bytes walking a {wire}-byte payload; "
        "the traversal is scaling with node count again (FINDING F5 regression)"
    )


def test_validation_cost_does_not_scale_with_node_count() -> None:
    """The machine-independent half: quadruple the nodes, and the cost must not follow.

    An absolute budget can be tuned around; a scale-invariance check cannot. The
    old traversal grew strictly linearly in node count, so a fourfold payload
    cost fourfold heap. The fixed one is flat in the element count and grows
    only with nesting, which this payload does not have.
    """
    small_body, _ = wide_flat_payload(256 * 1024)
    large_body, _ = wide_flat_payload(1024 * 1024)
    small = read_frame(buffer_recv(framed(len(small_body), small_body)), len(small_body) + 8)
    large = read_frame(buffer_recv(framed(len(large_body), large_body)), len(large_body) + 8)
    assert len(large["a"]) > 3 * len(small["a"])

    small_peak = measure_validation_peak(small)
    large_peak = measure_validation_peak(large)
    # Compare against the element ratio, not against a byte count.
    assert large_peak <= small_peak + 64 * 1024, (
        f"validation peak went {small_peak} -> {large_peak} bytes for a 4x larger "
        "element count; the traversal is node-proportional again"
    )


# ---------------------------------------------------------------------------
# 6. The transport contract
# ---------------------------------------------------------------------------


def test_transport_over_delivering_mid_body_is_a_frame_error() -> None:
    """`recv_exactly` carries the check, and here it fires."""
    payload = {"data": "x" * 64}
    wire = encode_frame(payload, MAX) + b"TRAILING GARBAGE"
    # The prefix is delivered honestly so the reader gets past it; the body read
    # is the one that over-delivers, which is where `recv_exactly`'s check sits.
    calls = {"n": 0}

    def staged(count: int) -> bytes:
        calls["n"] += 1
        if calls["n"] == 1:
            return wire[:LENGTH_PREFIX_BYTES]
        return wire[LENGTH_PREFIX_BYTES : LENGTH_PREFIX_BYTES + count + 8]

    with pytest.raises(FrameError, match="more bytes than requested") as caught:
        read_frame(staged, MAX)
    assert caught.value.code == "frame"
    assert caught.value.connection_terminal is True


@pytest.mark.parametrize("extra", [1, 2, 3, 4, 8, 64])
def test_transport_over_delivering_on_the_prefix_is_a_frame_error(extra: int) -> None:
    """F1 closed: the prefix read is now bounded on both sides.

    `read_frame` calls `recv(4)` directly rather than through `recv_exactly`,
    which is where the over-delivery check lives. Before the fix, an over-wide
    buffer reached `struct.unpack(">I", prefix)` and raised `struct.error` —
    outside `SandboxError`, so the caller's fail-closed drop for a frame fault
    never ran and the event was never audited. Parametrised across widths
    because a check written as `!= 4` and a check written as `> 4` behave the
    same at one byte over and differently nowhere, but a check written against
    the wrong constant would show up here.
    """
    wire = encode_frame({"a": 1}, MAX)
    with pytest.raises(FrameError, match="more bytes than requested") as caught:
        read_frame(OverReadingRecv(wire, extra=extra), MAX)
    assert caught.value.code == "frame"
    assert caught.value.connection_terminal is True
    assert not isinstance(caught.value, struct.error)


def test_prefix_over_read_is_refused_before_the_length_is_believed() -> None:
    """The refusal must not be reached by way of trusting the over-wide bytes.

    An over-delivering transport whose extra bytes spell a huge length must be
    refused as a transport fault, not read as a length and then refused for
    being large — the ordering is what keeps `struct.unpack` off attacker-shaped
    buffers.
    """
    wire = framed(FOUR_GIB_MINUS_ONE) + b"\xff" * 64
    with pytest.raises(FrameError, match="more bytes than requested"):
        read_frame(OverReadingRecv(wire, extra=8), MAX)


def test_every_reader_failure_in_this_suite_is_a_sandbox_error() -> None:
    """The taxonomy claim, asserted directly rather than left to each test."""
    cases = [
        framed(FOUR_GIB_MINUS_ONE),
        framed(0),
        framed(MAX + 1),
        b"\x00\x00",
        framed(64, b"short"),
        framed(4, b"\xff\xff\xff\xff"),
        framed(2, b"{{"),
        framed(2, b"[]"),
    ]
    for wire in cases:
        with pytest.raises(SandboxError) as caught:
            read_frame(buffer_recv(wire), MAX)
        assert caught.value.code == "frame"
        assert caught.value.to_error_object()["retryable"] is False


# ---------------------------------------------------------------------------
# 7. Round trip and the encoder's own refusals
# ---------------------------------------------------------------------------


def test_round_trip_encode_then_read() -> None:
    """What the encoder emits is exactly what the reader accepts."""
    payloads = [
        {},
        {"a": 1},
        {"nested": {"list": [1, 2, {"deep": None}], "unicode": "é中"}},
        {"big": "x" * 4096},
        {"types": [True, False, None, 0, -1, 1.5, "", []]},
    ]
    for payload in payloads:
        wire = encode_frame(payload, MAX)
        assert len(wire) == LENGTH_PREFIX_BYTES + struct.unpack(">I", wire[:4])[0]
        assert read_frame(buffer_recv(wire), MAX) == payload


def test_empty_object_round_trips_because_its_body_is_two_bytes() -> None:
    """The zero-length refusal must not be reachable from a legal empty payload."""
    wire = encode_frame({}, MAX)
    assert wire[:LENGTH_PREFIX_BYTES] == struct.pack(">I", 2)
    assert read_frame(buffer_recv(wire), MAX) == {}


def test_consecutive_frames_read_off_one_stream_then_return_none() -> None:
    """The reader is re-entrant on a stream; end of stream is the terminating case."""
    first, second = {"seq": 1}, {"seq": 2}
    recv = buffer_recv(encode_frame(first, MAX) + encode_frame(second, MAX))
    assert read_frame(recv, MAX) == first
    assert read_frame(recv, MAX) == second
    assert read_frame(recv, MAX) is None


def test_encode_frame_refuses_an_over_cap_payload() -> None:
    """The bound is enforced outbound so a host bug cannot emit an illegal frame."""
    payload = {"data": "x" * 1024}
    with pytest.raises(FrameError, match="exceeds max_frame_len") as caught:
        encode_frame(payload, 64)
    assert caught.value.code == "frame"


@pytest.mark.parametrize(
    "payload", [[], "str", 1, 1.5, None, True, (1, 2), {1, 2}, object()]
)
def test_encode_frame_refuses_a_non_object_payload(payload: object) -> None:
    with pytest.raises(FrameError, match="must be a JSON object"):
        encode_frame(payload, MAX)  # type: ignore[arg-type]


def test_encode_frame_refuses_an_unserialisable_payload() -> None:
    """An object `json.dumps` cannot render still fails inside the taxonomy.

    `validate_payload` now runs first and passes an arbitrary object through —
    it is neither a container nor a checked scalar — so this exercises the
    `json.dumps` except path rather than the validator.
    """
    with pytest.raises(FrameError, match="not JSON-serialisable") as caught:
        encode_frame({"f": object()}, MAX)
    assert isinstance(caught.value.__cause__, TypeError)


def test_encode_frame_refuses_a_circular_payload_on_the_depth_bound() -> None:
    """A cycle now terminates on the depth ceiling instead of on `json.dumps`.

    The message moved as a consequence of F2: `validate_payload` runs before
    serialisation, and a self-referential dict exceeds `MAX_JSON_DEPTH` after 64
    pops rather than reaching `json.dumps`'s circular-reference detector. The
    class is unchanged, which is the property that matters, but this asserts the
    new path deliberately rather than matching loosely on the class alone.
    """
    circular: dict = {}
    circular["self"] = circular
    with pytest.raises(FrameError, match=f"nested deeper than {MAX_JSON_DEPTH} levels"):
        encode_frame(circular, MAX)

    mutual_a: dict = {}
    mutual_b: dict = {"a": mutual_a}
    mutual_a["b"] = mutual_b
    with pytest.raises(FrameError, match="nested deeper than"):
        encode_frame(mutual_a, MAX)


def test_encode_frame_refuses_non_finite_floats_on_the_validator() -> None:
    """F3's outbound half: refused by the leaf check, not by `allow_nan=False`.

    Both directions now reject the same value for the same stated reason, which
    is the symmetry the encoder's docstring claims.
    """
    for value in (float("nan"), float("inf"), float("-inf")):
        with pytest.raises(FrameError, match="non-finite number"):
            encode_frame({"v": value}, MAX)

    # Nested and as a key, since the validator walks both.
    with pytest.raises(FrameError, match="non-finite number"):
        encode_frame({"a": {"b": [float("inf")]}}, MAX)
    with pytest.raises(FrameError, match="non-finite number"):
        encode_frame({float("nan"): 1}, MAX)


def test_encode_frame_refuses_a_string_it_could_not_put_on_the_wire() -> None:
    """F4's outbound half: `ensure_ascii` would have escaped it past the encoder.

    `json.dumps` escapes a lone surrogate to `\\ud800` and that encodes to ASCII
    fine, so without the leaf check the encoder emitted a frame the reader is
    obliged to reject.
    """
    with pytest.raises(FrameError, match="unencodable string"):
        encode_frame({"v": "\ud800"}, MAX)
    with pytest.raises(FrameError, match="unencodable string"):
        encode_frame({"\udfff": 1}, MAX)


def test_encode_frame_refuses_a_payload_above_the_depth_ceiling() -> None:
    """F2 closed: the encoder applies `MAX_JSON_DEPTH` the reader enforces.

    The docstring's claim — that a host bug cannot emit a frame its peer is
    obliged to reject — now has an engine behind it for the depth bound as well
    as the byte bound.
    """
    with pytest.raises(FrameError, match=f"nested deeper than {MAX_JSON_DEPTH} levels"):
        encode_frame(nest_objects(MAX_JSON_DEPTH + 1), MAX)
    with pytest.raises(FrameError, match="nested deeper than"):
        encode_frame(nest_arrays(MAX_JSON_DEPTH), MAX)

    # And the accepting side of the same bound, so the fix did not overshoot.
    assert encode_frame(nest_objects(MAX_JSON_DEPTH), MAX)
    assert encode_frame(nest_arrays(MAX_JSON_DEPTH - 1), MAX)


def test_encode_frame_refuses_a_very_deep_payload_inside_the_taxonomy() -> None:
    """A payload that would recurse `json.dumps` is refused before it gets there.

    Pre-fix this raised `RecursionError` out of `encode_frame` — the outbound
    mirror of the escape `decode_payload` had always refused to allow. It is now
    caught by the depth bound at 65 levels, long before the interpreter stack is
    in question, so no deep walk happens at all.
    """
    with pytest.raises(FrameError, match="nested deeper than") as caught:
        encode_frame(nest_objects(20_000), 64 * 1024 * 1024)
    assert caught.value.code == "frame"
    assert not isinstance(caught.value, RecursionError)


def test_every_encoder_refusal_is_a_frame_error() -> None:
    """The outbound taxonomy claim, asserted across every refusal shape at once."""
    circular: dict = {}
    circular["self"] = circular
    cases: list[object] = [
        [],
        "not a dict",
        {"f": object()},
        {"v": float("nan")},
        {"v": "\ud800"},
        nest_objects(MAX_JSON_DEPTH + 1),
        circular,
        {"big": "x" * (MAX + 1)},
    ]
    for payload in cases:
        with pytest.raises(SandboxError) as caught:
            encode_frame(payload, MAX)  # type: ignore[arg-type]
        assert caught.value.code == "frame"
        assert caught.value.connection_terminal is True


def test_encode_frame_applies_its_bounds_through_a_tuple() -> None:
    """F7, closed.

    `json.dumps` serialises `tuple` as a JSON array, so a validator that
    descended only `dict` and `list` let everything inside a tuple bypass every
    bound — the encoder emitted, the reader refused. `CONTAINER_TYPES` now names
    the set the serialiser actually walks, so both bounds reach through.
    """
    deep: object = (1,)
    for _ in range(100):
        deep = (deep,)
    with pytest.raises(FrameError, match="nested deeper than"):
        encode_frame({"a": deep}, MAX)

    with pytest.raises(FrameError, match="unencodable string"):
        encode_frame({"a": ("\ud800",)}, MAX)


def test_a_shallow_tuple_still_round_trips() -> None:
    """The tuple fix must close the bypass without refusing legal payloads.

    A tuple is a perfectly ordinary way to hold a JSON array host-side; it
    serialises to the same bytes a list does and must survive.
    """
    wire = encode_frame({"a": (1, "two", [3])}, MAX)
    assert read_frame(buffer_recv(wire), MAX) == {"a": [1, "two", [3]]}


def test_a_payload_above_the_node_ceiling_is_refused_on_both_paths() -> None:
    """The residual half of F5: depth bounds the shape, node count bounds the work.

    A flat, in-bound frame of millions of small scalars passes every other check
    while costing host CPU proportional to its element count, on every frame, at
    whatever rate the caller's bucket allows.
    """
    wide = {"a": list(range(64))}
    with pytest.raises(FrameError, match="more than 32 values"):
        validate_payload(wide, MAX_JSON_DEPTH, max_nodes=32)

    with pytest.raises(FrameError, match="more than"):
        encode_frame({"a": list(range(MAX_JSON_NODES + 2))}, MAX)


def test_the_node_ceiling_does_not_refuse_an_ordinary_payload() -> None:
    """The positive control for the ceiling: it must not fire on normal traffic."""
    validate_payload({"a": list(range(1000)), "b": {"c": "d"}}, MAX_JSON_DEPTH)


# ---------------------------------------------------------------------------
# 8. The socket-shaped entry point and the buffer transport
# ---------------------------------------------------------------------------


class _FakeSocket:
    """A `recv`-shaped object. Test double, not a socket."""

    def __init__(self, data: bytes) -> None:
        self._recv: Callable[[int], bytes] = buffer_recv(data)

    def recv(self, bufsize: int, /) -> bytes:
        return self._recv(bufsize)


def test_read_frame_from_socket_binds_to_the_recv_method() -> None:
    payload = {"via": "socket"}
    assert read_frame_from_socket(_FakeSocket(encode_frame(payload, MAX)), MAX) == payload
    assert read_frame_from_socket(_FakeSocket(b""), MAX) is None
    with pytest.raises(FrameError):
        read_frame_from_socket(_FakeSocket(framed(FOUR_GIB_MINUS_ONE)), MAX)


def test_buffer_recv_returns_short_reads_at_the_end_of_the_buffer() -> None:
    recv = buffer_recv(b"abcdef")
    assert recv(4) == b"abcd"
    assert recv(4) == b"ef"
    assert recv(4) == b""
    assert recv(4) == b""


def test_decode_payload_re_checks_the_length_bound_on_an_already_read_body() -> None:
    """Belt and braces: the body check is reachable independently of the prefix."""
    body = b'{"a": "' + b"x" * 200 + b'"}'
    with pytest.raises(FrameError, match="frame body of"):
        decode_payload(body, 64)
