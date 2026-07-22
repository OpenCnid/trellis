"""Deterministic fuzz harness for the wire frame reader.

INTERFACES section 3.5 (Fuzz + security-review requirement) makes a
coverage-guided pass over the length-and-JSON parser a merge gate before the
bridge ships. `test_frame.py` next to this file is the hand-written half;
this is the randomised half.

    python src/repl_sandbox/tests/fuzz_frame.py --iterations 25000 --seed 0
    python src/repl_sandbox/tests/fuzz_frame.py --negative-control

**The outcome oracle.** `read_frame` has exactly three legal outcomes and the
harness asserts nothing else ever happens:

1. a `dict` — a frame it accepted;
2. a `FrameError` — a frame it refused, inside the taxonomy, so the caller's
   fail-closed drop path actually runs;
3. `None` — a clean end of stream before any bytes.

Anything else is a finding. `struct.error`, `MemoryError`, `RecursionError`,
`UnicodeDecodeError`, `IndexError`, a returned list, a returned string: each of
them means the parser has a path its caller does not know how to handle, and a
caller that catches `FrameError` to drop a connection will instead take an
unhandled traceback on attacker-chosen input. A slow iteration is a finding too
— a parser that can be driven into seconds of work on one small frame is a
denial-of-service surface whether or not it returns the right answer.

**The acceptance oracles.** Judging only *how* a reader fails leaves it blind
to a reader that accepts too much — an over-permissive parser returns a
perfectly ordinary dict. Three of the six defects found on the first pass were
that shape. So every accepted payload is also judged, differentially rather than
against hand-written expectations: it must survive `encode_frame` (the two
directions of one codec have to agree about what a legal frame is), and a second
scan of the same bytes must not find a duplicate key the reader resolved
silently.

**The transports here are test doubles, not sockets.** They read from a byte
string in memory. There is no VM, no vsock, and no trust boundary anywhere in
this file; it exercises the parser that will sit on one. Two of them are
deliberately hostile in ways a real `socket.recv` is not, and say so.

**The allocation tripwire.** The reader's central ordering claim is that a
declared length is compared to `max_len` *before* any buffer sized by it is
read. The harness asserts that directly and on every iteration: its transport
raises `AllocationTripwire` if it is ever asked for more than `max_len` bytes.
Nothing here allocates the multi-gigabyte buffer it is testing the refusal of —
the refusal is asserted by the request the reader makes, never by surviving it.

**The negative control** (`--negative-control`) is the reason to believe any of
the above. It patches in eight deliberately broken readers — one that allocates
before the bound check, ones that do not catch the decode errors, one that
recurses on nesting, one that returns a non-object, one that unpacks a short
prefix, one that accepts values it cannot re-encode, one that resolves duplicate
keys silently — and asserts the fuzzer *detects* each. A check nobody has
watched fail reports success on anything. Exit 3 means every planted break was
caught, which is the passing result for that mode.

Each plant is kept correct in every respect but one, deliberately. A plant with
two defects gets caught by whichever oracle fires first, and then the run has
not shown that the oracle aimed at its named defect works at all. That has
already gone wrong twice here — once when a UTF-8 plant was being caught by a
JSON error, and once when a non-object plant was being caught by the round-trip
oracle — and both times the fix was to the plant, never to the fuzzer.
"""

from __future__ import annotations

import argparse
import json
import random
import struct
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

if __package__ in (None, ""):  # run as a script, not imported by pytest
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from repl_sandbox.errors import FrameError
from repl_sandbox.frame import (
    LENGTH_PREFIX_BYTES,
    MAX_JSON_DEPTH,
    decode_payload,
    encode_frame,
    read_frame,
    recv_exactly,
    validate_payload,
)

#: Frame bound used for the run. Small on purpose: the point is to make the
#: over-cap branch cheap to reach, not to exercise the allocator.
FUZZ_MAX_LEN = 1 << 16

#: Per-iteration wall-clock budget. Above this the iteration is reported as a
#: stall, whatever it eventually returned.
DEFAULT_STALL_S = 2.0

DEFAULT_ITERATIONS = 25000

EXIT_CLEAN = 0
EXIT_FINDINGS = 1
EXIT_NEGATIVE_CONTROL_PASS = 3

#: The reader under test: a `(recv, max_len)` callable returning `dict | None`.
Reader = Callable[[Callable[[int], bytes], int], object]


class AllocationTripwire(Exception):
    """The reader asked its transport for more bytes than `max_len` allows.

    Not part of the sandbox error taxonomy on purpose — it is a harness signal,
    and the fuzzer treats it exactly like any other taxonomy escape.
    """


# ---------------------------------------------------------------------------
# Transports (test doubles over a byte string — no socket, no vsock)
# ---------------------------------------------------------------------------


def tripwired_recv(
    data: bytes, max_len: int, *, chunk: int | None = None
) -> Callable[[int], bytes]:
    """A `recv` over a buffer that refuses to serve a request above `max_len`.

    Test double. Short reads at the end of the buffer, and optionally throughout,
    match stream-socket behaviour; a request larger than the frame bound cannot
    come from a reader that checked its bound first, so it trips.
    """
    position = 0

    def recv(count: int) -> bytes:
        nonlocal position
        if count > max_len:
            raise AllocationTripwire(
                f"reader requested {count} bytes with max_frame_len {max_len} "
                "- a length-sized read happened before the bound check"
            )
        take = count if chunk is None else min(count, chunk)
        out = data[position : position + take]
        position += len(out)
        return out

    return recv


def over_reading_recv(data: bytes, extra: int) -> Callable[[int], bytes]:
    """A transport that returns *more* than requested.

    Test double for a broken transport; a real `socket.recv` never
    over-delivers. Off by default (see `--hostile-transport`) because the guest
    does not choose the host's socket implementation, so this is a robustness
    class rather than an attack class.
    """
    position = 0

    def recv(count: int) -> bytes:
        nonlocal position
        out = data[position : position + count + extra]
        position += len(out)
        return out

    return recv


# ---------------------------------------------------------------------------
# Seed corpus
# ---------------------------------------------------------------------------

SEED_PAYLOADS: tuple[dict, ...] = (
    {},
    {"a": 1},
    {"op": "materialize", "handle": "h-0001", "range": [0, 4096]},
    {"prompt": "hello", "model": "m", "depth": 1},
    {"error": {"code": "frame", "message": "x", "retryable": False}},
    {"nested": {"list": [1, 2, {"deep": None}], "unicode": "é中"}},
    {"types": [True, False, None, 0, -1, 1.5, "", [], {}]},
    {"wide": {str(i): i for i in range(64)}},
    {"text": "x" * 2048},
    {"escapes": '"\\/\b\f\n\r\t\u0000'},
)


def seed_frame(rng: random.Random) -> bytes:
    """A well-formed frame to mutate away from."""
    return encode_frame(rng.choice(SEED_PAYLOADS), FUZZ_MAX_LEN)


# ---------------------------------------------------------------------------
# Mutators
# ---------------------------------------------------------------------------


def mutate_bit_flip(rng: random.Random, frame: bytes) -> bytes:
    if not frame:
        return frame
    out = bytearray(frame)
    for _ in range(rng.randint(1, 8)):
        index = rng.randrange(len(out))
        out[index] ^= 1 << rng.randrange(8)
    return bytes(out)


def mutate_length_field(rng: random.Random, frame: bytes) -> bytes:
    """Corrupt the declared length — the whole point of a length-prefixed parser."""
    body = frame[LENGTH_PREFIX_BYTES:]
    declared = rng.choice(
        [
            0,
            1,
            0xFFFFFFFF,
            0xFFFFFFFE,
            0x7FFFFFFF,
            0x80000000,
            FUZZ_MAX_LEN,
            FUZZ_MAX_LEN + 1,
            FUZZ_MAX_LEN - 1,
            max(0, len(body) - 1),
            len(body) + 1,
            rng.randrange(0, 0x100000000),
        ]
    )
    return struct.pack(">I", declared) + body


def mutate_truncate(rng: random.Random, frame: bytes) -> bytes:
    if not frame:
        return frame
    return frame[: rng.randrange(0, len(frame))]


def mutate_inject_bytes(rng: random.Random, frame: bytes) -> bytes:
    out = bytearray(frame)
    for _ in range(rng.randint(1, 16)):
        index = rng.randrange(len(out) + 1)
        out.insert(index, rng.randrange(256))
    return bytes(out)


def mutate_delete_bytes(rng: random.Random, frame: bytes) -> bytes:
    out = bytearray(frame)
    for _ in range(rng.randint(1, 8)):
        if not out:
            break
        del out[rng.randrange(len(out))]
    return bytes(out)


#: Byte sequences that are individually illegal UTF-8: bare continuations,
#: truncated multi-byte leads, encoded surrogates, overlongs, out-of-range leads.
BAD_UTF8: tuple[bytes, ...] = (
    b"\x80",
    b"\xbf",
    b"\xc0",
    b"\xc0\xaf",
    b"\xc3",
    b"\xe2\x82",
    b"\xed\xa0\x80",
    b"\xed\xbf\xbf",
    b"\xf0\x9f\x92",
    b"\xf5\x80\x80\x80",
    b"\xfe\xff",
    b"\xff",
)


def mutate_utf8(rng: random.Random, frame: bytes) -> bytes:
    """Splice illegal UTF-8 into the body, then re-declare the new length."""
    body = bytearray(frame[LENGTH_PREFIX_BYTES:])
    for _ in range(rng.randint(1, 4)):
        index = rng.randrange(len(body) + 1)
        body[index:index] = rng.choice(BAD_UTF8)
    keep_length = rng.random() < 0.5 or len(frame) < LENGTH_PREFIX_BYTES
    declared = len(body) if keep_length else struct.unpack(">I", frame[:4])[0]
    return struct.pack(">I", declared) + bytes(body)


def mutate_nesting(rng: random.Random, frame: bytes) -> bytes:
    """Wrap a payload in brackets, straddling `MAX_JSON_DEPTH` in both directions.

    Three bands matter, not one. Around the ceiling proves the ceiling. The
    400-900 band is deeper than any walk of the decoded payload may recurse but
    still shallow enough that `json.loads` *accepts* it — that is the window in
    which a recursive depth check dies and an iterative one does not, and it is
    the window the negative control's recursion plant needs to be visible.
    Past ~1000 the decoder refuses first and nothing downstream is reached.
    """
    depth = rng.choice(
        [
            1,
            2,
            MAX_JSON_DEPTH - 2,
            MAX_JSON_DEPTH - 1,
            MAX_JSON_DEPTH,
            MAX_JSON_DEPTH + 1,
            200,
            400,
            700,
            900,
            2000,
            100_000,
        ]
    )
    # Both arms build in one pass: the obvious accumulate-in-a-loop form is
    # quadratic and would make the harness, not the parser, the slow thing.
    if rng.random() < 0.5:
        body = b'{"a":' + b"[" * depth + b"1" + b"]" * depth + b"}"
    else:
        body = b'{"n":' * depth + b"1" + b"}" * depth
    if rng.random() < 0.2:
        body = body[: len(body) // 2]  # deep and unbalanced at once
    return struct.pack(">I", len(body)) + body


def mutate_splice(rng: random.Random, frame: bytes) -> bytes:
    """Concatenate or interleave two frames; framing confusion between messages."""
    other = seed_frame(rng)
    if rng.random() < 0.5:
        return frame + other
    cut = rng.randrange(len(frame) + 1)
    return frame[:cut] + other


def mutate_random_bytes(rng: random.Random, frame: bytes) -> bytes:
    """No lineage to a valid frame at all."""
    size = rng.choice([0, 1, 2, 3, 4, 5, 8, 64, 1024])
    return bytes(rng.randrange(256) for _ in range(size))


def mutate_json_shape(rng: random.Random, frame: bytes) -> bytes:
    """A body that is valid JSON of the wrong shape, or nearly-valid JSON."""
    body = rng.choice(
        [
            b"[]",
            b"[1,2,3]",
            b'"a string"',
            b"12345",
            b"1.5",
            b"1e999",
            b"null",
            b"true",
            b"false",
            b"NaN",
            b"Infinity",
            b'{"a": NaN}',
            b'{"a": Infinity}',
            b'{"a": ' + b"9" * 5000 + b"}",
            b'{"a": "\\ud800"}',
            b'{"a": 1, "a": 2}',
            b"{",
            b"}",
            b'{"a":}',
            b'{"a": 1} trailing',
            b"{'a': 1}",
            b'{"\\u0000": 1}',
        ]
    )
    return struct.pack(">I", len(body)) + body


MUTATORS: tuple[tuple[str, Callable[[random.Random, bytes], bytes]], ...] = (
    ("bit_flip", mutate_bit_flip),
    ("length_field", mutate_length_field),
    ("truncate", mutate_truncate),
    ("inject_bytes", mutate_inject_bytes),
    ("delete_bytes", mutate_delete_bytes),
    ("utf8", mutate_utf8),
    ("nesting", mutate_nesting),
    ("splice", mutate_splice),
    ("random_bytes", mutate_random_bytes),
    ("json_shape", mutate_json_shape),
)


# ---------------------------------------------------------------------------
# The loop
# ---------------------------------------------------------------------------


@dataclass
class Finding:
    index: int
    seed: int
    mutator: str
    kind: str
    detail: str
    frame_head: str
    #: Flags the run carried, so the printed reproducer replays the conditions
    #: and not just the bytes.
    flags: str = ""

    def report(self, script: str) -> str:
        return (
            f"FINDING [{self.kind}] iteration {self.index} via {self.mutator}\n"
            f"  {self.detail}\n"
            f"  frame: {self.frame_head}\n"
            f"  reproduce: python {script} --seed {self.seed} "
            f"--only {self.index}{self.flags}"
        )


# ---------------------------------------------------------------------------
# Acceptance oracles
#
# The three-outcome oracle only judges *how* the reader failed. It is blind to
# the reader accepting something it should have refused, because an over-
# permissive reader returns a perfectly ordinary dict. Three of the six defects
# this harness helped find were exactly that shape — non-finite numbers, lone
# surrogates, and duplicate keys all crossed inbound as valid-looking payloads —
# so a fuzzer that cannot fail on an acceptance cannot see them come back.
#
# Both oracles below are differential rather than hand-written expectations:
# they compare the reader against another component that must agree with it.
# ---------------------------------------------------------------------------

#: Headroom for the round-trip oracle. `json.dumps` defaults to `ensure_ascii`,
#: so a body of raw UTF-8 re-encodes up to three times larger; the property
#: under test is that an accepted value is *representable*, never that it fits.
ROUNDTRIP_LEN_HEADROOM = 8


class _DuplicateKeySeen(Exception):
    """Sentinel raised by the independent duplicate-key scan."""


def _flag_duplicates(pairs: list[tuple[str, object]]) -> dict:
    seen: set[str] = set()
    for key, _ in pairs:
        if key in seen:
            raise _DuplicateKeySeen(key)
        seen.add(key)
    return dict(pairs)


def body_of(data: bytes, max_len: int) -> bytes | None:
    """The declared body of a frame, or None if the bytes do not describe one."""
    if len(data) < LENGTH_PREFIX_BYTES:
        return None
    (declared,) = struct.unpack(">I", data[:LENGTH_PREFIX_BYTES])
    if declared == 0 or declared > max_len:
        return None
    body = data[LENGTH_PREFIX_BYTES : LENGTH_PREFIX_BYTES + declared]
    return body if len(body) == declared else None


def check_acceptance(
    payload: dict, data: bytes, max_len: int
) -> tuple[str, str] | None:
    """Judge a frame the reader *accepted*. Returns (kind, detail) on a finding.

    Two independent properties, neither of which asserts a hand-written
    expectation about any particular input:

    1. **Round trip.** Whatever the reader accepts, the encoder must be able to
       emit — the two directions of one codec have to agree about what a legal
       frame is. A non-finite float or an unpaired surrogate breaks this, which
       is how the oracle sees a dropped leaf check.
    2. **Duplicate keys.** The same JSON scanner is re-run over the same bytes
       with an accumulator that only counts keys. If it finds a duplicate the
       reader resolved silently, the reader took one of two possible readings of
       an ambiguous frame without saying so.
    """
    try:
        encode_frame(payload, max_len * ROUNDTRIP_LEN_HEADROOM)
    except FrameError as exc:
        return (
            "asymmetric accept",
            f"reader accepted a payload the encoder refuses: {str(exc)[:140]} "
            "(the two directions disagree about what a legal frame is)",
        )
    except KeyboardInterrupt:
        raise
    except BaseException as exc:  # noqa: BLE001
        return (
            "taxonomy escape",
            f"{type(exc).__name__} escaped encode_frame on an accepted payload: "
            f"{str(exc)[:140]}",
        )

    body = body_of(data, max_len)
    if body is not None:
        try:
            json.loads(body.decode("utf-8"), object_pairs_hook=_flag_duplicates)
        except _DuplicateKeySeen as exc:
            return (
                "silent duplicate key",
                f"reader accepted a frame carrying a duplicate key {str(exc)!r} and "
                "resolved it silently (parser-differential: another reader of the "
                "same bytes may pick the other value)",
            )
        except KeyboardInterrupt:
            raise
        except BaseException:  # noqa: BLE001 — the scan is advisory, not the oracle
            pass
    return None


@dataclass
class Stats:
    accepted: int = 0
    refused: int = 0
    end_of_stream: int = 0
    findings: list[Finding] = field(default_factory=list)
    slowest_s: float = 0.0
    mutator_counts: dict[str, int] = field(default_factory=dict)


def build_case(rng: random.Random) -> tuple[str, bytes]:
    """Produce one hostile byte string and the name of the mutator that made it."""
    frame = seed_frame(rng)
    name, mutator = rng.choice(MUTATORS)
    data = mutator(rng, frame)
    # Chain a second mutation sometimes: single-mutation corpora plateau fast.
    if rng.random() < 0.35:
        name2, mutator2 = rng.choice(MUTATORS)
        data = mutator2(rng, data)
        name = f"{name}+{name2}"
    return name, data


def run_case(
    reader: Reader,
    data: bytes,
    rng: random.Random,
    max_len: int,
    *,
    hostile_transport: bool,
) -> object:
    """Drive `reader` once over `data`. Exceptions propagate to the classifier."""
    if hostile_transport and rng.random() < 0.25:
        recv = over_reading_recv(data, extra=rng.randint(1, 8))
    else:
        chunk = rng.choice([None, None, None, 1, 3, 7, 64])
        recv = tripwired_recv(data, max_len, chunk=chunk)
    return reader(recv, max_len)


def fuzz(
    reader: Reader,
    *,
    iterations: int,
    seed: int,
    max_len: int = FUZZ_MAX_LEN,
    stall_s: float = DEFAULT_STALL_S,
    only: int | None = None,
    hostile_transport: bool = False,
    stop_after_first: bool = False,
) -> Stats:
    """Run the loop and classify every outcome against the three-outcome oracle."""
    stats = Stats()
    flags = " --hostile-transport" if hostile_transport else ""
    if max_len != FUZZ_MAX_LEN:
        flags += f" --max-len {max_len}"
    indices = [only] if only is not None else range(iterations)

    for index in indices:
        # Derived per iteration so `--only K` reproduces byte for byte at any
        # iteration count.
        rng = random.Random(f"{seed}:{index}")
        mutator, data = build_case(rng)
        stats.mutator_counts[mutator] = stats.mutator_counts.get(mutator, 0) + 1
        head = data[:48].hex() + ("…" if len(data) > 48 else "")

        started = time.perf_counter()
        try:
            result = run_case(
                reader, data, rng, max_len, hostile_transport=hostile_transport
            )
        except FrameError:
            stats.refused += 1
            result = None
        except KeyboardInterrupt:
            raise
        except BaseException as exc:  # noqa: BLE001 — the whole point of the oracle
            stats.findings.append(
                Finding(
                    index=index,
                    seed=seed,
                    mutator=mutator,
                    kind="taxonomy escape",
                    detail=(
                        f"{type(exc).__name__} escaped the parser: {str(exc)[:160]} "
                        "(caller catching FrameError takes an unhandled traceback)"
                    ),
                    frame_head=head,
                    flags=flags,
                )
            )
            if stop_after_first:
                return stats
        else:
            if isinstance(result, dict):
                stats.accepted += 1
                acceptance = check_acceptance(result, data, max_len)
                if acceptance is not None:
                    kind, detail = acceptance
                    stats.findings.append(
                        Finding(
                            index=index,
                            seed=seed,
                            mutator=mutator,
                            kind=kind,
                            detail=detail,
                            frame_head=head,
                            flags=flags,
                        )
                    )
                    if stop_after_first:
                        return stats
            elif result is None:
                stats.end_of_stream += 1
            else:
                stats.findings.append(
                    Finding(
                        index=index,
                        seed=seed,
                        mutator=mutator,
                        kind="illegal return",
                        detail=(
                            f"returned {type(result).__name__}, but the contract is "
                            "dict | None - a non-object crossed the seam"
                        ),
                        frame_head=head,
                        flags=flags,
                    )
                )
                if stop_after_first:
                    return stats

        elapsed = time.perf_counter() - started
        stats.slowest_s = max(stats.slowest_s, elapsed)
        if elapsed > stall_s:
            stats.findings.append(
                Finding(
                    index=index,
                    seed=seed,
                    mutator=mutator,
                    kind="stall",
                    detail=(
                        f"one frame of {len(data)} bytes took {elapsed:.2f}s, over the "
                        f"{stall_s:.2f}s budget - unbounded work behind a bounded length"
                    ),
                    frame_head=head,
                    flags=flags,
                )
            )
            if stop_after_first:
                return stats

    return stats


# ---------------------------------------------------------------------------
# Negative control: deliberately broken readers the fuzzer must catch
#
# Each of these is a plausible way to write the reader wrong. None of them
# touches `frame.py`; they are local copies with one defect apiece, injected as
# the reader under test. If the fuzzer cannot tell them from the real one, its
# green result on the real one means nothing.
# ---------------------------------------------------------------------------


def _reject_duplicates(pairs: list[tuple[str, object]]) -> dict:
    """A local copy of the reader's duplicate-key hook, for plants that keep it."""
    seen: set[str] = set()
    for key, _ in pairs:
        if key in seen:
            raise FrameError(f"duplicate key {key!r}")
        seen.add(key)
    return dict(pairs)


def _read_prefix(recv: Callable[[int], bytes]) -> bytes | None:
    prefix = recv(LENGTH_PREFIX_BYTES)
    if not prefix:
        return None
    if len(prefix) < LENGTH_PREFIX_BYTES:
        prefix += recv_exactly(recv, LENGTH_PREFIX_BYTES - len(prefix))
    return prefix


def broken_allocate_before_bound_check(
    recv: Callable[[int], bytes], max_len: int
) -> object:
    """Reads the declared length before comparing it to the bound — the ordering bug."""
    prefix = _read_prefix(recv)
    if prefix is None:
        return None
    (declared,) = struct.unpack(">I", prefix)
    body = recv_exactly(recv, declared)  # trips the transport's allocation guard
    if declared > max_len:
        raise FrameError("too long")
    return decode_payload(body, max_len)


def broken_no_utf8_catch(recv: Callable[[int], bytes], max_len: int) -> object:
    """Decodes UTF-8 without converting the failure into the taxonomy.

    Everything *else* here is correct, deliberately: if this reader also let
    `JSONDecodeError` through, the fuzzer would catch it by the easier route and
    the run would not prove the UTF-8 branch was ever reached.
    """
    prefix = _read_prefix(recv)
    if prefix is None:
        return None
    (declared,) = struct.unpack(">I", prefix)
    if declared > max_len or declared == 0:
        raise FrameError("bad length")
    body = recv_exactly(recv, declared)
    text = body.decode("utf-8")
    try:
        payload = json.loads(text)
    except (ValueError, RecursionError) as exc:
        raise FrameError("bad json") from exc
    if not isinstance(payload, dict):
        raise FrameError("not an object")
    return payload


def broken_no_json_catch(recv: Callable[[int], bytes], max_len: int) -> object:
    """Catches the UTF-8 failure but lets `JSONDecodeError` through."""
    prefix = _read_prefix(recv)
    if prefix is None:
        return None
    (declared,) = struct.unpack(">I", prefix)
    if declared > max_len or declared == 0:
        raise FrameError("bad length")
    body = recv_exactly(recv, declared)
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise FrameError("bad utf-8") from exc
    payload = json.loads(text)
    if not isinstance(payload, dict):
        raise FrameError("not an object")
    return payload


def _recursive_max_depth(value: object, depth: int = 1) -> int:
    """Measure first, judge after — the shape that makes the walk itself the bug."""
    if isinstance(value, dict):
        return max(
            (_recursive_max_depth(item, depth + 1) for item in value.values()),
            default=depth,
        )
    if isinstance(value, list):
        return max(
            (_recursive_max_depth(item, depth + 1) for item in value), default=depth
        )
    return depth


def broken_recursive_depth_check(recv: Callable[[int], bytes], max_len: int) -> object:
    """Walks the decoded payload recursively, so nesting reaches the C stack.

    The defect is not "recursive" on its own — a recursive walk that early-exits
    at the ceiling never goes deeper than the ceiling. It is measuring the whole
    payload before comparing, which is what lets a decoder-accepted 900-level
    frame exhaust the interpreter stack.
    """
    prefix = _read_prefix(recv)
    if prefix is None:
        return None
    (declared,) = struct.unpack(">I", prefix)
    if declared > max_len or declared == 0:
        raise FrameError("bad length")
    body = recv_exactly(recv, declared)
    try:
        payload = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError, RecursionError) as exc:
        raise FrameError("bad body") from exc
    if not isinstance(payload, dict):
        raise FrameError("not an object")
    if _recursive_max_depth(payload) > MAX_JSON_DEPTH:
        raise FrameError("too deep")
    return payload


def broken_no_object_check(recv: Callable[[int], bytes], max_len: int) -> object:
    """Returns whatever JSON produced, so a list or a scalar crosses the seam.

    Validates depth and leaves like the real reader, so the *only* thing wrong
    with it is the missing top-level type check. Without that care the payload
    oracles catch it first and the run would not prove the return-type check
    ever fires.
    """
    prefix = _read_prefix(recv)
    if prefix is None:
        return None
    if len(prefix) > LENGTH_PREFIX_BYTES:
        raise FrameError("over-read")
    (declared,) = struct.unpack(">I", prefix)
    if declared > max_len or declared == 0:
        raise FrameError("bad length")
    body = recv_exactly(recv, declared)
    try:
        payload = json.loads(body.decode("utf-8"), object_pairs_hook=_reject_duplicates)
    except (ValueError, UnicodeDecodeError, RecursionError) as exc:
        raise FrameError("bad body") from exc
    validate_payload(payload, MAX_JSON_DEPTH)
    return payload


def broken_bare_prefix_unpack(recv: Callable[[int], bytes], max_len: int) -> object:
    """Unpacks the prefix without topping up a short read — `struct.error` on truncation."""
    prefix = recv(LENGTH_PREFIX_BYTES)
    if not prefix:
        return None
    (declared,) = struct.unpack(">I", prefix)
    if declared > max_len or declared == 0:
        raise FrameError("bad length")
    return decode_payload(recv_exactly(recv, declared), max_len)


def broken_no_scalar_check(recv: Callable[[int], bytes], max_len: int) -> object:
    """Bounds nesting but does not validate leaves.

    Refuses everything malformed, returns a well-formed dict, and is wrong
    anyway: `NaN`, `Infinity`, `1e999`, and escaped lone surrogates all cross as
    ordinary-looking values the encoder cannot emit. Invisible to an oracle that
    only judges how a reader fails, which is why the round-trip oracle exists.
    """
    prefix = _read_prefix(recv)
    if prefix is None:
        return None
    if len(prefix) > LENGTH_PREFIX_BYTES:
        raise FrameError("over-read")
    (declared,) = struct.unpack(">I", prefix)
    if declared > max_len or declared == 0:
        raise FrameError("bad length")
    body = recv_exactly(recv, declared)
    try:
        payload = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError, RecursionError) as exc:
        raise FrameError("bad body") from exc
    if not isinstance(payload, dict):
        raise FrameError("not an object")
    _depth_only(payload, MAX_JSON_DEPTH)
    return payload


def _depth_only(value: object, limit: int) -> None:
    """The pre-F3/F4 traversal: depth bound, no leaf validation."""
    stack: list[tuple[object, int]] = [(value, 1)]
    while stack:
        node, depth = stack.pop()
        if depth > limit:
            raise FrameError("too deep")
        if isinstance(node, dict):
            for item in node.values():
                if isinstance(item, (dict, list)):
                    stack.append((item, depth + 1))
        elif isinstance(node, list):
            for item in node:
                if isinstance(item, (dict, list)):
                    stack.append((item, depth + 1))


def broken_last_wins_duplicate_keys(
    recv: Callable[[int], bytes], max_len: int
) -> object:
    """Correct in every way except that duplicate keys resolve to the last value.

    Returns a valid, encodable dict, so only the differential key scan can see
    it. This is the plant that proves the duplicate-key oracle is load-bearing
    rather than decorative.
    """
    prefix = _read_prefix(recv)
    if prefix is None:
        return None
    if len(prefix) > LENGTH_PREFIX_BYTES:
        raise FrameError("over-read")
    (declared,) = struct.unpack(">I", prefix)
    if declared > max_len or declared == 0:
        raise FrameError("bad length")
    body = recv_exactly(recv, declared)
    try:
        payload = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError, RecursionError) as exc:
        raise FrameError("bad body") from exc
    if not isinstance(payload, dict):
        raise FrameError("not an object")
    validate_payload(payload, MAX_JSON_DEPTH)
    return payload


PLANTED_BREAKS: tuple[tuple[str, Reader], ...] = (
    ("allocates before the bound check", broken_allocate_before_bound_check),
    ("does not catch the UTF-8 decode error", broken_no_utf8_catch),
    ("does not catch the JSON decode error", broken_no_json_catch),
    ("recurses over the decoded payload", broken_recursive_depth_check),
    ("returns a non-object payload", broken_no_object_check),
    ("unpacks a short length prefix", broken_bare_prefix_unpack),
    ("accepts values it cannot re-encode", broken_no_scalar_check),
    ("resolves duplicate keys silently", broken_last_wins_duplicate_keys),
)


def run_negative_control(seed: int, iterations: int, stall_s: float) -> int:
    """Assert the fuzzer detects every planted break. Exit 3 when it does."""
    print(f"negative control: {len(PLANTED_BREAKS)} planted breaks, "
          f"{iterations} iterations each, seed {seed}\n")
    undetected: list[str] = []

    for name, reader in PLANTED_BREAKS:
        stats = fuzz(
            reader,
            iterations=iterations,
            seed=seed,
            stall_s=stall_s,
            stop_after_first=True,
        )
        if stats.findings:
            first = stats.findings[0]
            print(f"  DETECTED  {name}")
            print(f"            -> [{first.kind}] {first.detail[:96]}")
            print(f"            -> iteration {first.index} via {first.mutator}")
        else:
            undetected.append(name)
            print(f"  MISSED    {name}  <-- the fuzzer cannot see this defect")

    print()
    if undetected:
        print(f"negative control FAILED: {len(undetected)} planted break(s) undetected:")
        for name in undetected:
            print(f"  - {name}")
        print("A green run against the real reader proves nothing until this passes.")
        return EXIT_FINDINGS

    print(f"negative control PASSED: all {len(PLANTED_BREAKS)} planted breaks detected.")
    return EXIT_NEGATIVE_CONTROL_PASS


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Deterministic fuzz harness for repl_sandbox.frame.read_frame."
    )
    parser.add_argument("--iterations", type=int, default=DEFAULT_ITERATIONS)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument(
        "--only", type=int, default=None, help="run one iteration index; the reproducer"
    )
    parser.add_argument("--stall-s", type=float, default=DEFAULT_STALL_S)
    parser.add_argument("--max-len", type=int, default=FUZZ_MAX_LEN)
    parser.add_argument(
        "--hostile-transport",
        action="store_true",
        help="also drive an over-delivering transport (a broken socket, not a "
             "guest-chosen input); reproduces the known prefix over-read defect",
    )
    parser.add_argument(
        "--negative-control",
        action="store_true",
        help="fuzz deliberately broken readers and assert the harness detects them",
    )
    args = parser.parse_args(argv)

    script = "src/repl_sandbox/tests/fuzz_frame.py"

    if args.negative_control:
        return run_negative_control(
            args.seed, max(200, args.iterations // 8), args.stall_s
        )

    started = time.perf_counter()
    stats = fuzz(
        read_frame,
        iterations=args.iterations,
        seed=args.seed,
        max_len=args.max_len,
        stall_s=args.stall_s,
        only=args.only,
        hostile_transport=args.hostile_transport,
    )
    elapsed = time.perf_counter() - started

    total = 1 if args.only is not None else args.iterations
    print(
        f"fuzz_frame: {total} iterations, seed {args.seed}, "
        f"max_frame_len {args.max_len}, {elapsed:.2f}s"
    )
    print(
        f"  accepted {stats.accepted}  refused {stats.refused}  "
        f"end-of-stream {stats.end_of_stream}  slowest {stats.slowest_s * 1000:.1f}ms"
    )
    print(f"  mutators exercised: {len(stats.mutator_counts)}")

    if not stats.findings:
        print("  findings: none - every outcome legal, every acceptance symmetric")
        return EXIT_CLEAN

    print(f"  findings: {len(stats.findings)}\n")
    for finding in stats.findings[:20]:
        print(finding.report(script))
        print()
    if len(stats.findings) > 20:
        print(f"... and {len(stats.findings) - 20} more")
    return EXIT_FINDINGS


if __name__ == "__main__":
    sys.exit(main())
