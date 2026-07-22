"""The handle table: every way a resolution can fail, then the ones that work.

Covers repl_sandbox.handles against REPL_SANDBOX_DATA_MODEL.md sections 1
(What a handle is), 2 (Namespace, allocation, lifecycle, revocation) and 3
(Broker-side resolution semantics).
"""

from __future__ import annotations

import pytest

from repl_sandbox.audit import AuditLog
from repl_sandbox.errors import DeniedError
from repl_sandbox.handles import (
    HANDLE_KINDS,
    MAX_PARENTS,
    UNRESOLVABLE_MESSAGE,
    Handle,
    HandleTable,
)

CID = 42
OTHER_CID = 43
TTL = 100.0


class Clock:
    """An injected clock: TTL expiry is tested by moving time, never by sleeping."""

    def __init__(self, start: float = 0.0):
        self.t = start

    def __call__(self) -> float:
        return self.t

    def advance(self, dt: float) -> None:
        self.t += dt


class Referent:
    """A stand-in for a host-resident query spec. Reading it is a test failure."""

    def __iter__(self):
        raise AssertionError("the handle table must never read a referent")

    def __len__(self):
        raise AssertionError("the handle table must never read a referent")


def make_table(clock: Clock | None = None, audit: AuditLog | None = None) -> HandleTable:
    return HandleTable(TTL, now=clock or Clock(), audit=audit)


# --- opacity ---------------------------------------------------------------


def test_wire_shape_is_exactly_id_and_kind():
    """No shape, no count, no schema, no content — DATA_MODEL section 1."""
    table = make_table()
    handle = table.allocate(CID, "table", Referent())
    assert set(handle.to_wire()) == {"id", "kind"}
    assert handle.to_wire()["kind"] == "table"


def test_token_is_a_random_128_bit_value():
    table = make_table()
    first = table.allocate(CID, "table", Referent()).id
    second = table.allocate(CID, "table", Referent()).id
    assert len(first) == 32 and int(first, 16) >= 0
    assert first != second


def test_handle_rejects_an_unknown_kind():
    with pytest.raises(ValueError):
        Handle(id="abc", kind="secret-payload")


def test_all_five_kinds_allocate():
    table = make_table()
    for kind in HANDLE_KINDS:
        assert table.allocate(CID, kind, Referent()).kind == kind


# --- denial paths ----------------------------------------------------------


def test_cross_cid_resolve_denies_identically_to_an_unknown_token():
    """A leaked token used from another session fails as an unknown one does."""
    table = make_table()
    handle = table.allocate(CID, "table", Referent())

    with pytest.raises(DeniedError) as leaked:
        table.resolve(OTHER_CID, handle.id)
    with pytest.raises(DeniedError) as unknown:
        table.resolve(OTHER_CID, "0" * 32)

    assert leaked.value.message == unknown.value.message == UNRESOLVABLE_MESSAGE
    assert leaked.value.code == "denied"


def test_unknown_token_denies():
    table = make_table()
    with pytest.raises(DeniedError):
        table.resolve(CID, "deadbeef")


@pytest.mark.parametrize("handle_id", ["", None, 7, b"abc"])
def test_malformed_handle_id_denies(handle_id):
    table = make_table()
    with pytest.raises(DeniedError):
        table.resolve(CID, handle_id)


def test_dropped_handle_denies():
    table = make_table()
    handle = table.allocate(CID, "table", Referent())
    table.drop(CID, handle.id)
    with pytest.raises(DeniedError) as excinfo:
        table.resolve(CID, handle.id)
    assert "dropped" in excinfo.value.message
    assert excinfo.value.retryable is False


def test_dropping_twice_denies():
    table = make_table()
    handle = table.allocate(CID, "table", Referent())
    table.drop(CID, handle.id)
    with pytest.raises(DeniedError):
        table.drop(CID, handle.id)


def test_dropping_another_sessions_handle_denies():
    table = make_table()
    handle = table.allocate(CID, "table", Referent())
    with pytest.raises(DeniedError):
        table.drop(OTHER_CID, handle.id)
    assert table.resolve(CID, handle.id).state == "live"


def test_expired_handle_denies_on_the_injected_clock():
    clock = Clock()
    table = make_table(clock)
    handle = table.allocate(CID, "table", Referent())
    clock.advance(TTL)  # exactly at the TTL counts as elapsed
    with pytest.raises(DeniedError) as excinfo:
        table.resolve(CID, handle.id)
    assert "expired" in excinfo.value.message


def test_stale_handle_denies_loudly_and_retryably():
    """CODE_MEDIATED_TEXT section 2 clause 3: re-query, never read a shifted address."""
    table = make_table()
    handle = table.allocate(CID, "table", Referent())
    table.mark_stale(CID, handle.id)
    with pytest.raises(DeniedError) as excinfo:
        table.resolve(CID, handle.id)
    assert excinfo.value.retryable is True


def test_marking_an_unknown_handle_stale_denies():
    table = make_table()
    with pytest.raises(DeniedError):
        table.mark_stale(CID, "0" * 32)


def test_closed_session_handles_stop_resolving():
    table = make_table()
    handle = table.allocate(CID, "table", Referent())
    table.close_session(CID)
    with pytest.raises(DeniedError) as excinfo:
        table.resolve(CID, handle.id)
    # The table is freed, so a surviving guest-side token is simply unknown.
    assert excinfo.value.message == UNRESOLVABLE_MESSAGE


def test_allocate_rejects_an_unknown_kind():
    table = make_table()
    with pytest.raises(DeniedError):
        table.allocate(CID, "payload", Referent())


def test_allocate_over_a_dead_parent_denies():
    """A derived handle cannot outlive the lineage its meaning depends on."""
    table = make_table()
    parent = table.allocate(CID, "table", Referent())
    table.drop(CID, parent.id)
    with pytest.raises(DeniedError):
        table.allocate(CID, "table", Referent(), parents=(parent.id,))


def test_allocate_over_another_sessions_parent_denies():
    table = make_table()
    parent = table.allocate(CID, "table", Referent())
    with pytest.raises(DeniedError):
        table.allocate(OTHER_CID, "table", Referent(), parents=(parent.id,))


def test_allocate_rejects_an_oversized_lineage():
    table = make_table()
    with pytest.raises(DeniedError):
        table.allocate(CID, "table", Referent(), parents=tuple("h" for _ in range(MAX_PARENTS + 1)))


@pytest.mark.parametrize("parents", ["h1", 7, (None,), ("",)])
def test_allocate_rejects_malformed_parents(parents):
    table = make_table()
    with pytest.raises(DeniedError):
        table.allocate(CID, "table", Referent(), parents=parents)


# --- the stale cascade -----------------------------------------------------


def test_stale_cascades_to_every_descendant():
    """A write under the root invalidates every address derived from it."""
    table = make_table()
    root = table.allocate(CID, "table", Referent())
    child = table.allocate(CID, "table", Referent(), parents=(root.id,))
    grandchild = table.allocate(CID, "table", Referent(), parents=(child.id,))
    sibling = table.allocate(CID, "table", Referent())

    assert table.mark_stale(CID, root.id) == 3

    for dead in (root, child, grandchild):
        with pytest.raises(DeniedError):
            table.resolve(CID, dead.id)
    assert table.resolve(CID, sibling.id).state == "live"


def test_stale_cascade_passes_through_a_dropped_intermediate():
    """A dropped middle handle must not shelter a live grandchild."""
    table = make_table()
    root = table.allocate(CID, "table", Referent())
    middle = table.allocate(CID, "table", Referent(), parents=(root.id,))
    leaf = table.allocate(CID, "table", Referent(), parents=(middle.id,))
    table.drop(CID, middle.id)

    assert table.mark_stale(CID, root.id) == 2  # root + leaf; middle was already dropped
    assert table.peek(CID, leaf.id) == "stale"
    assert table.peek(CID, middle.id) == "dropped"


def test_stale_cascade_reaches_a_multi_parent_join():
    table = make_table()
    left = table.allocate(CID, "table", Referent())
    right = table.allocate(CID, "table", Referent())
    joined = table.allocate(CID, "result-set", Referent(), parents=(left.id, right.id))

    assert table.mark_stale(CID, left.id) == 2
    assert table.peek(CID, joined.id) == "stale"
    assert table.peek(CID, right.id) == "live"


def test_marking_stale_twice_reports_no_new_transitions():
    table = make_table()
    root = table.allocate(CID, "table", Referent())
    assert table.mark_stale(CID, root.id) == 1
    assert table.mark_stale(CID, root.id) == 0


# --- lifecycle bookkeeping -------------------------------------------------


def test_sweep_expires_only_what_has_elapsed():
    clock = Clock()
    table = make_table(clock)
    old = table.allocate(CID, "table", Referent())
    clock.advance(TTL - 1)
    fresh = table.allocate(CID, "table", Referent())
    clock.advance(1)

    assert table.sweep() == 1
    assert table.peek(CID, old.id) == "expired"
    assert table.peek(CID, fresh.id) == "live"
    assert table.sweep() == 0


def test_close_session_frees_only_that_session():
    table = make_table()
    mine = table.allocate(CID, "table", Referent())
    theirs = table.allocate(OTHER_CID, "table", Referent())
    table.close_session(CID)
    table.close_session(CID)  # idempotent

    assert table.count(CID) == 0
    assert table.resolve(OTHER_CID, theirs.id).state == "live"
    assert table.peek(CID, mine.id) is None


def test_zero_ttl_expires_immediately():
    """The stricter reading of a TTL: at zero, nothing is ever live to a reader."""
    table = HandleTable(0.0, now=Clock())
    handle = table.allocate(CID, "table", Referent())
    with pytest.raises(DeniedError):
        table.resolve(CID, handle.id)


def test_negative_ttl_is_a_construction_error():
    with pytest.raises(ValueError):
        HandleTable(-1.0)


def test_non_integer_cid_is_a_host_side_error():
    table = make_table()
    with pytest.raises(ValueError):
        table.allocate("42", "table", Referent())


# --- audit ------------------------------------------------------------------


def test_lifecycle_events_are_audited():
    audit = AuditLog()
    clock = Clock()
    table = make_table(clock, audit)
    handle = table.allocate(CID, "table", Referent())
    with pytest.raises(DeniedError):
        table.resolve(OTHER_CID, handle.id)
    table.mark_stale(CID, handle.id)
    table.close_session(CID)

    assert audit.ops() == [
        "handle.allocate",
        "handle.resolve.denied",
        "handle.stale",
        "handle.close_session",
    ]


def test_audit_records_no_referent():
    """The referent is the field whose absence from the guest is the boundary."""
    audit = AuditLog()
    table = make_table(audit=audit)
    table.allocate(CID, "table", Referent())
    entry = audit.entries()[0]
    assert set(entry) == {"seq", "ts", "cid", "op", "handle", "kind", "parents"}
