"""The CID-keyed audit log every host-side surface writes to.

Source of truth: docs/product/repl-sandbox/REPL_SANDBOX_DATA_MODEL.md section 2
(Namespace, allocation, lifecycle, revocation) and section 6 (The bounded
materialisation exception); REPL_SANDBOX_INTERFACES.md section 5 (DB-broker RPC
surface) — "every call logged by CID with `op`, an args digest, and returned
row/byte counts and the policy decision" — and section 7 (Error model), which
requires every error to be audited by CID regardless of how it surfaces.

The log is telemetry. It is not a boundary and not an enforcing surface for one
(REPL_SANDBOX_SPEC.md section 6, the "NOT a boundary" row): it records what the
enforcing surfaces decided, after they decided it.

Two properties make it safe to keep in memory next to secret-bearing data:

* **It never stores content.** Every field value is normalised on the way in;
  anything longer than `MAX_FIELD_CHARS`, any `bytes`, and any object the
  normaliser does not recognise is replaced by a digest plus a length. An args
  digest is the record's word for it, and a digest is what gets stored. This is
  an engine, not a convention — `record` cannot be talked into keeping a payload.
* **It never raises on a value.** A log that a hostile value can crash is a log
  an attacker can silence before a denial is written. Normalisation degrades to
  a digest of the object's `repr`, and a `repr` that itself raises degrades to
  the type name.

The tail is bounded (`max_entries`) because an unbounded in-process log is a
memory-exhaustion path; `overflow` counts what the ring dropped, so the tail is
honest about being a tail.
"""

from __future__ import annotations

import hashlib
import math
import time
from collections import deque
from typing import Callable

#: Strings at or below this length are kept verbatim; longer ones are digested.
#: Sized to hold a handle id, an op name, an error code, or a short reason —
#: never a row, a block of document text, or a prompt.
MAX_FIELD_CHARS = 256

#: Sequences longer than this are digested rather than enumerated.
MAX_SEQUENCE_ITEMS = 32

#: Structural recursion limit for normalisation. Below it, containers are
#: walked; at it, they are digested.
MAX_FIELD_DEPTH = 3

#: Default ring size. Operators tail this; durable audit is the broker's job.
DEFAULT_MAX_ENTRIES = 4096

#: Keys the log owns. A caller field of the same name is renamed, never
#: allowed to overwrite the record's own framing.
RESERVED_FIELDS: tuple[str, ...] = ("seq", "ts", "cid", "op")


def digest(raw: bytes) -> str:
    """A short, stable, non-invertible stand-in for a value too large to keep."""
    return "sha256:" + hashlib.sha256(raw).hexdigest()[:16]


def _redacted(raw: bytes, kind: str, size: int) -> dict:
    return {"redacted": digest(raw), kind: size}


def _normalise(value: object, depth: int = 0) -> object:
    """Reduce an arbitrary value to something safe to keep in the log.

    Scalars survive; anything that could carry content is digested. Never
    raises: an unrepresentable value degrades to its type name.
    """
    if value is None or isinstance(value, (bool, int)):
        return value
    if isinstance(value, float):
        # NaN/inf are not JSON-representable; keep them as text so an operator
        # dump cannot fail on a value the log accepted.
        return value if math.isfinite(value) else repr(value)
    if isinstance(value, str):
        if len(value) <= MAX_FIELD_CHARS:
            return value
        return _redacted(value.encode("utf-8", "replace"), "chars", len(value))
    if isinstance(value, (bytes, bytearray, memoryview)):
        raw = bytes(value)
        # Raw bytes are never kept, at any length: they are the shape content
        # arrives in.
        return _redacted(raw, "bytes", len(raw))
    if isinstance(value, (list, tuple, set, frozenset)):
        items = list(value)
        if depth >= MAX_FIELD_DEPTH or len(items) > MAX_SEQUENCE_ITEMS:
            return _redacted(_safe_repr(items).encode("utf-8", "replace"), "items", len(items))
        return [_normalise(item, depth + 1) for item in items]
    if isinstance(value, dict):
        if depth >= MAX_FIELD_DEPTH or len(value) > MAX_SEQUENCE_ITEMS:
            return _redacted(_safe_repr(value).encode("utf-8", "replace"), "items", len(value))
        return {str(key): _normalise(item, depth + 1) for key, item in value.items()}
    text = _safe_repr(value)
    return {
        "redacted": digest(text.encode("utf-8", "replace")),
        "type": type(value).__name__,
    }


def _safe_repr(value: object) -> str:
    """`repr` that cannot raise. A hostile object must not be able to kill a log write."""
    try:
        return repr(value)
    except Exception:  # noqa: BLE001 - the whole point is to swallow anything
        return f"<unreprable {type(value).__name__}>"


class AuditLog:
    """A bounded, CID-keyed, content-free in-memory event tail.

    Not internally synchronised: the broker serialises per-CID work, and the
    only cross-CID state here is the ring itself. A threaded broker wraps it.
    """

    def __init__(
        self,
        max_entries: int = DEFAULT_MAX_ENTRIES,
        now: Callable[[], float] = time.time,
    ):
        if max_entries <= 0:
            raise ValueError(f"max_entries must be positive, got {max_entries}")
        self._entries: deque[dict] = deque(maxlen=max_entries)
        self._now = now
        self._seq = 0
        #: Entries the ring has dropped. The tail is a tail; this says how much.
        self.overflow = 0

    def record(self, cid: int, op: str, **fields) -> None:
        """Append one event. Never raises on the content of `fields`."""
        self._seq += 1
        if len(self._entries) == self._entries.maxlen:
            self.overflow += 1
        entry: dict = {
            "seq": self._seq,
            "ts": self._timestamp(),
            "cid": cid if isinstance(cid, int) and not isinstance(cid, bool) else _safe_repr(cid),
            "op": _normalise(op if isinstance(op, str) else _safe_repr(op)),
        }
        for key, value in fields.items():
            name = str(key)
            if name in RESERVED_FIELDS:
                name = "field_" + name
            entry[name] = _normalise(value)
        self._entries.append(entry)

    def _timestamp(self) -> float:
        try:
            return float(self._now())
        except Exception:  # noqa: BLE001 - a broken clock must not silence the log
            return -1.0

    def entries(self) -> list[dict]:
        """The current tail, oldest first. Copies, so a reader cannot edit history."""
        return [dict(entry) for entry in self._entries]

    def entries_for(self, cid: int) -> list[dict]:
        """The tail filtered to one session."""
        return [dict(entry) for entry in self._entries if entry.get("cid") == cid]

    def ops(self) -> list[str]:
        """Just the op sequence — the shape most assertions want."""
        return [entry["op"] for entry in self._entries]

    def __len__(self) -> int:
        return len(self._entries)
