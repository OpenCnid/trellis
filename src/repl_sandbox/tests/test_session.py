"""Session identity: the denials first, then the bindings that survive them.

Covers repl_sandbox.session against REPL_SANDBOX_DATA_MODEL.md section 2
(Namespace) and ARCHITECTURE section 7 requirement 4 (auth by kernel vsock peer
CID).
"""

from __future__ import annotations

import pytest

from repl_sandbox.audit import AuditLog
from repl_sandbox.errors import AuthError
from repl_sandbox.session import MIN_GUEST_CID, SessionTable, check_cid

GUEST_CID = 42
OTHER_CID = 43


# --- denial paths ----------------------------------------------------------


def test_session_for_unknown_cid_denies():
    """A CID that was never bound → AuthError, never a default session."""
    table = SessionTable()
    with pytest.raises(AuthError):
        table.session_for(GUEST_CID)


def test_session_for_after_close_denies():
    """Teardown revokes: the same CID stops resolving the moment it is closed."""
    table = SessionTable()
    table.bind(GUEST_CID, "s-1")
    table.close(GUEST_CID)
    with pytest.raises(AuthError):
        table.session_for(GUEST_CID)


@pytest.mark.parametrize("cid", [-1, 0, 1, 2])
def test_reserved_cids_are_refused(cid):
    """ANY / hypervisor / local / host are not guests, so they never bind."""
    table = SessionTable()
    with pytest.raises(AuthError):
        table.bind(cid, "s-1")
    with pytest.raises(AuthError):
        table.session_for(cid)


@pytest.mark.parametrize("cid", ["42", 42.0, None, True])
def test_malformed_cid_is_refused(cid):
    """A CID that the kernel could not have produced fails as an auth error."""
    with pytest.raises(AuthError):
        check_cid(cid)


def test_rebinding_a_live_cid_to_another_session_denies():
    """A recycled CID must not inherit the previous session's namespace."""
    table = SessionTable()
    table.bind(GUEST_CID, "s-1")
    with pytest.raises(AuthError):
        table.bind(GUEST_CID, "s-2")
    assert table.session_for(GUEST_CID) == "s-1"


def test_second_cid_claiming_a_live_session_denies():
    """One microVM per session: a second CID claiming it is refused."""
    table = SessionTable()
    table.bind(GUEST_CID, "s-1")
    with pytest.raises(AuthError):
        table.bind(OTHER_CID, "s-1")
    assert not table.is_bound(OTHER_CID)


@pytest.mark.parametrize("session_id", ["", None, 7])
def test_malformed_session_id_denies(session_id):
    table = SessionTable()
    with pytest.raises(AuthError):
        table.bind(GUEST_CID, session_id)


def test_cid_for_unknown_session_denies():
    table = SessionTable()
    with pytest.raises(AuthError):
        table.cid_for("never-bound")


# --- the paths that do work ------------------------------------------------


def test_bind_then_resolve():
    table = SessionTable()
    table.bind(GUEST_CID, "s-1")
    assert table.session_for(GUEST_CID) == "s-1"
    assert table.cid_for("s-1") == GUEST_CID
    assert table.is_bound(GUEST_CID)


def test_identical_rebind_is_idempotent():
    """A reconnect on the same CID within the same session is not an attack."""
    table = SessionTable()
    table.bind(GUEST_CID, "s-1")
    table.bind(GUEST_CID, "s-1")
    assert table.session_for(GUEST_CID) == "s-1"


def test_is_bound_is_false_rather_than_raising_for_junk():
    table = SessionTable()
    assert table.is_bound("not-a-cid") is False
    assert table.is_bound(0) is False


def test_close_is_idempotent_and_frees_the_session_id():
    """Close runs in teardown; raising there would mask the real failure."""
    table = SessionTable()
    table.bind(GUEST_CID, "s-1")
    table.close(GUEST_CID)
    table.close(GUEST_CID)
    table.close(99)
    table.bind(OTHER_CID, "s-1")  # the session id is free again
    assert table.session_for(OTHER_CID) == "s-1"


def test_sessions_snapshot_is_a_copy():
    table = SessionTable()
    table.bind(GUEST_CID, "s-1")
    snapshot = table.sessions()
    snapshot[999] = "forged"
    assert table.is_bound(999) is False


def test_min_guest_cid_sits_above_the_host_cid():
    assert MIN_GUEST_CID == 3


def test_both_copies_of_the_guest_cid_floor_agree():
    """One fact, two modules, and until now nothing tied them together.

    `session.MIN_GUEST_CID` is derived (`VMADDR_CID_HOST + 1`) and
    `capabilities.FIRST_GUEST_CID` is a literal, and both are the same fact:
    the lowest CID a guest may be keyed on. They happen to agree today, so a
    change to either -- the reserved-CID range widening, or the literal being
    edited -- would leave two enforcing surfaces disagreeing about which CIDs
    are admissible, with each module's own tests still green.

    Asserting the two constants against each other rather than each against a
    literal is the point: a literal-vs-literal check passes while the modules
    drift apart, which is the shape S6-entry found in the reserved names.
    """
    from repl_sandbox.capabilities import FIRST_GUEST_CID

    assert MIN_GUEST_CID == FIRST_GUEST_CID


# --- audit ------------------------------------------------------------------


def test_binding_and_denial_are_audited():
    audit = AuditLog()
    table = SessionTable(audit=audit)
    table.bind(GUEST_CID, "s-1")
    with pytest.raises(AuthError):
        table.session_for(OTHER_CID)
    table.close(GUEST_CID)
    assert audit.ops() == ["session.bind", "session.session_for.denied", "session.close"]
