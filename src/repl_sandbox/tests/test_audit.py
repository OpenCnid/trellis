"""The audit log: it must not store content, and it must not be silenceable.

Covers repl_sandbox.audit against REPL_SANDBOX_INTERFACES.md section 5 (every
call logged by CID with an args digest) and section 7 (every error audited).
"""

from __future__ import annotations

import pytest

from repl_sandbox.audit import (
    MAX_FIELD_CHARS,
    MAX_SEQUENCE_ITEMS,
    AuditLog,
    digest,
)


class Clock:
    """An injected monotonic-ish clock. No test sleeps."""

    def __init__(self, start: float = 1000.0):
        self.t = start

    def __call__(self) -> float:
        return self.t

    def advance(self, dt: float) -> None:
        self.t += dt


class Hostile:
    """An object whose `repr` raises — the value that would silence a log."""

    def __repr__(self):
        raise RuntimeError("no repr for you")


# --- the content-free property ---------------------------------------------


def test_long_string_field_is_digested_not_stored():
    """A field big enough to be a payload is replaced by a digest and a length."""
    log = AuditLog()
    secret = "s" * (MAX_FIELD_CHARS + 1)
    log.record(3, "broker.query", args=secret)
    field = log.entries()[0]["args"]
    assert secret not in str(field)
    assert field["redacted"].startswith("sha256:")
    assert field["chars"] == MAX_FIELD_CHARS + 1


def test_bytes_are_never_stored_at_any_length():
    """Raw bytes are the shape content arrives in; they never survive a record."""
    log = AuditLog()
    log.record(3, "sink.materialize", payload=b"row-bytes")
    field = log.entries()[0]["payload"]
    assert field == {"redacted": digest(b"row-bytes"), "bytes": 9}


def test_oversized_sequence_is_digested():
    log = AuditLog()
    log.record(3, "algebra.locate", addresses=list(range(MAX_SEQUENCE_ITEMS + 1)))
    field = log.entries()[0]["addresses"]
    assert field["items"] == MAX_SEQUENCE_ITEMS + 1
    assert field["redacted"].startswith("sha256:")


def test_deeply_nested_structure_is_digested_at_the_depth_limit():
    log = AuditLog()
    log.record(3, "broker.query", args={"a": {"b": {"c": {"d": "deep-secret"}}}})
    rendered = str(log.entries()[0]["args"])
    assert "deep-secret" not in rendered


def test_unknown_object_is_reduced_to_type_and_digest():
    log = AuditLog()
    log.record(3, "handle.allocate", referent=object())
    field = log.entries()[0]["referent"]
    assert field["type"] == "object"
    assert field["redacted"].startswith("sha256:")


def test_short_scalars_survive_verbatim():
    log = AuditLog()
    log.record(3, "ledger.inbound", nbytes=512, truncated=False, handle="abc123", ratio=0.5)
    entry = log.entries()[0]
    assert entry["nbytes"] == 512
    assert entry["truncated"] is False
    assert entry["handle"] == "abc123"
    assert entry["ratio"] == 0.5


# --- the never-raises property ---------------------------------------------


def test_a_value_whose_repr_raises_does_not_kill_the_record():
    """An attacker must not be able to crash the log before a denial is written."""
    log = AuditLog()
    log.record(3, "algebra.denied", offender=Hostile())
    assert log.entries()[0]["offender"]["type"] == "Hostile"


def test_non_finite_float_is_kept_as_text():
    log = AuditLog()
    log.record(3, "ledger.spend", usd=float("nan"))
    assert log.entries()[0]["usd"] == "nan"


def test_reserved_field_names_cannot_be_overwritten():
    """A caller field named like the record's own framing is renamed, not honoured.

    `cid` and `op` cannot even be attempted — they are named parameters, so
    Python rejects the duplicate before the log sees it. `ts` and `seq` are the
    two that reach the rename.
    """
    log = AuditLog()
    log.record(3, "algebra.derive", **{"ts": "forged", "seq": 999})
    entry = log.entries()[0]
    assert entry["cid"] == 3
    assert entry["op"] == "algebra.derive"
    assert entry["seq"] == 1
    assert entry["field_ts"] == "forged"
    assert entry["field_seq"] == 999

    with pytest.raises(TypeError):
        log.record(3, "op", **{"cid": 1})


def test_a_broken_clock_does_not_kill_the_record():
    def broken() -> float:
        raise OSError("clock gone")

    log = AuditLog(now=broken)
    log.record(3, "op")
    assert log.entries()[0]["ts"] == -1.0


# --- ordering, bounding, isolation -----------------------------------------


def test_sequence_and_timestamp_come_from_the_injected_clock():
    clock = Clock()
    log = AuditLog(now=clock)
    log.record(3, "first")
    clock.advance(5.0)
    log.record(3, "second")
    entries = log.entries()
    assert [e["seq"] for e in entries] == [1, 2]
    assert [e["ts"] for e in entries] == [1000.0, 1005.0]


def test_ring_is_bounded_and_counts_what_it_dropped():
    log = AuditLog(max_entries=3)
    for index in range(5):
        log.record(3, f"op{index}")
    assert log.ops() == ["op2", "op3", "op4"]
    assert log.overflow == 2
    assert len(log) == 3


def test_entries_are_copies():
    log = AuditLog()
    log.record(3, "op", handle="h1")
    log.entries()[0]["handle"] = "forged"
    assert log.entries()[0]["handle"] == "h1"


def test_entries_for_filters_by_cid():
    log = AuditLog()
    log.record(3, "a")
    log.record(4, "b")
    assert [e["op"] for e in log.entries_for(4)] == ["b"]
