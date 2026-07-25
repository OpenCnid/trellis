"""The composition layer: identity, the manifest, the lease, and the unwind.

The properties under test are the ones that fail silently if they break: two
identifiers collapsed into one, a lease honoured on the strength of a dead
holder, and a partially-allocated session left standing after a failure.

No `ctr`, no VMM, no socket is created here. Everything the layer touches is
injected, which is what lets the ordering be asserted on a machine with no KVM.
"""

from __future__ import annotations

import json
import os
from datetime import date

import pytest

from repl_sandbox.config import SandboxConfig
from repl_sandbox.errors import DeniedError, SandboxError
from repl_sandbox.session_host import (
    MANIFEST_SCHEMA_VERSION,
    KataSession,
    WorkspaceLease,
    WorkspaceManifest,
    mint_session_id,
    open_workspace_session,
    reconstruct,
)

# ---------------------------------------------------------------------------
# Identity
# ---------------------------------------------------------------------------


def test_a_session_id_is_unique_per_opening_not_per_day() -> None:
    """Two sessions on one day is ordinary; a collision would share a ledger."""
    day = date(2026, 7, 25)
    first = mint_session_id("cnid", "physics", today=day)
    second = mint_session_id("cnid", "physics", today=day)
    assert first != second
    assert first.startswith("cnid-physics-2026-07-25-")


def test_the_workspace_component_is_stable_across_days() -> None:
    """A workspace is the same workspace next Tuesday, so its name cannot move.

    The date belongs to the session identifier and would silently break the
    workspace one -- which is the whole reason these are two values.
    """
    tuesday = mint_session_id("cnid", "physics", today=date(2026, 7, 21))
    next_tuesday = mint_session_id("cnid", "physics", today=date(2026, 7, 28))
    assert tuesday.split("-2026-")[0] == next_tuesday.split("-2026-")[0] == "cnid-physics"


def test_an_empty_identifier_is_refused() -> None:
    for bad in ("", "   "):
        with pytest.raises(SandboxError):
            mint_session_id(bad, "physics")
        with pytest.raises(SandboxError):
            mint_session_id("cnid", bad)


# ---------------------------------------------------------------------------
# The manifest
# ---------------------------------------------------------------------------


def test_a_new_workspace_ships_an_empty_manifest_and_reconstruction_is_a_no_op() -> None:
    """Day one: the form exists, so nothing has to be retrofitted around it."""
    manifest = WorkspaceManifest.empty("physics")
    assert manifest.is_empty is True
    assert reconstruct(manifest) == {"documents": 0, "handles": 0, "artifacts": 0, "empty": True}


def test_a_manifest_round_trips_through_json() -> None:
    filled = WorkspaceManifest(
        workspace_id="physics",
        live_documents=("doc:a", "doc:b"),
        root_handles=("h:facts",),
        artifacts=({"address": "ast:1", "standing": "belief"},),
    )
    restored = WorkspaceManifest.from_json(filled.to_json(), "physics")
    assert restored == filled
    assert restored.is_empty is False


def test_a_manifest_from_a_later_trellis_is_refused_not_half_read() -> None:
    """A partial reconstruction is a workspace that looks restored and is not."""
    raw = json.dumps({"workspace_id": "physics", "schema_version": MANIFEST_SCHEMA_VERSION + 1})
    with pytest.raises(SandboxError) as raised:
        WorkspaceManifest.from_json(raw, "physics")
    assert "schema version" in str(raised.value)


def test_a_manifest_holds_addresses_never_a_namespace() -> None:
    """The field set is the guarantee: nothing here can carry a pickled object.

    Restoring model-authored objects outside the sandbox would be an
    arbitrary-code-execution primitive running with the host's privileges, so the
    absence of any such field is a property worth pinning rather than assuming.
    """
    fields = set(WorkspaceManifest.empty("physics").__dataclass_fields__)
    assert fields == {
        "workspace_id", "schema_version", "live_documents", "root_handles", "artifacts",
    }


# ---------------------------------------------------------------------------
# The lease
# ---------------------------------------------------------------------------


def test_a_live_holder_keeps_the_workspace(tmp_path) -> None:
    """One workspace, one session -- the whole point of checkout."""
    lease = WorkspaceLease(str(tmp_path), "physics", liveness=lambda name: [4242])
    lease.acquire("session-a", "trellis-a-0001")

    second = WorkspaceLease(str(tmp_path), "physics", liveness=lambda name: [4242])
    with pytest.raises(DeniedError) as raised:
        second.acquire("session-b", "trellis-b-0002")
    assert "checked out" in str(raised.value)
    assert second.reclaimed_from is None


def test_a_dead_holder_is_reclaimed_automatically(tmp_path) -> None:
    """Auto-reclaim rests on an observation of the VM, never on a timeout.

    The lease names the sandbox its holder booted, so liveness is answerable
    directly -- and a timeout would be wrong in both directions: too short locks
    a user out mid-turn, too long strands a crashed workspace.
    """
    WorkspaceLease(str(tmp_path), "physics", liveness=lambda name: [1]).acquire(
        "session-a", "trellis-a-0001"
    )

    survivor = WorkspaceLease(str(tmp_path), "physics", liveness=lambda name: [])
    record = survivor.acquire("session-b", "trellis-b-0002")
    assert record.session_id == "session-b"
    assert survivor.reclaimed_from is not None
    assert survivor.reclaimed_from.session_id == "session-a"


def test_the_liveness_check_is_asked_about_the_holders_sandbox(tmp_path) -> None:
    """Not about the claimant's -- asking the wrong one always reclaims."""
    asked: list[str] = []
    WorkspaceLease(str(tmp_path), "physics", liveness=lambda name: []).acquire(
        "session-a", "trellis-holder-0001"
    )
    WorkspaceLease(
        str(tmp_path), "physics", liveness=lambda name: asked.append(name) or []
    ).acquire("session-b", "trellis-claimant-0002")
    assert asked == ["trellis-holder-0001"]


def test_an_unreadable_lease_does_not_lock_a_workspace_forever(tmp_path) -> None:
    path = tmp_path / "physics.lease"
    path.write_text("{ this is not json", encoding="utf-8")
    lease = WorkspaceLease(str(tmp_path), "physics", liveness=lambda name: [1])
    assert lease.acquire("session-a", "trellis-a-0001").session_id == "session-a"


def test_release_is_idempotent(tmp_path) -> None:
    lease = WorkspaceLease(str(tmp_path), "physics", liveness=lambda name: [])
    lease.acquire("session-a", "trellis-a-0001")
    lease.release()
    lease.release()
    assert lease.read() is None


# ---------------------------------------------------------------------------
# The ordering and the unwind
# ---------------------------------------------------------------------------


class FakeGuest:
    def __init__(self, name: str, log: list[str]) -> None:
        self.sandbox_name = name
        self.uds_path = "/run/vc/vm/%s/clh.sock" % name
        self._log = log
        self.bridge = None

    def attach_bridge(self, bridge) -> None:
        self.bridge = bridge

    def shutdown(self) -> None:
        self._log.append("guest.shutdown")


class FakeLauncher:
    def __init__(self, log: list[str], fail_at_boot: bool = False) -> None:
        self._log = log
        self._fail = fail_at_boot
        self._cid = 16

    def mint_sandbox_name(self, session_id: str) -> str:
        return "trellis-%s-abcdef" % session_id[:8]

    def mint_cid(self) -> int:
        value, self._cid = self._cid, self._cid + 1
        return value

    def boot(self, session_id: str, *, sandbox_name=None):
        self._log.append("boot")
        if self._fail:
            raise SandboxError("planted: the boot failed")
        return FakeGuest(sandbox_name or "trellis-x", self._log)


class FakeHost:
    def __init__(self, log: list[str]) -> None:
        self._log = log
        self.lm_handler = lambda cid, request: {}
        self.broker_handler = lambda cid, request: {}

    def open_session(self, cid, session_id, *, ops=(), lm=True):
        self._log.append("open_session")
        return object()

    def close_session(self, cid) -> None:
        self._log.append("close_session")


def _session(tmp_path, log, **kwargs):
    return open_workspace_session(
        SandboxConfig(),
        "physics",
        user_id="cnid",
        lease_root=str(tmp_path),
        host_factory=lambda: FakeHost(log),
        launcher=FakeLauncher(log, **kwargs),
    )


def test_the_session_opens_in_the_forced_order(tmp_path, monkeypatch) -> None:
    """The boot must precede the bridge: the socket path does not exist before it."""
    monkeypatch.setattr("repl_sandbox.session_host.SessionBridge.start", lambda self: None)
    log: list[str] = []
    with _session(tmp_path, log) as session:
        assert isinstance(session, KataSession)
        assert session.workspace_id == "physics"
        assert session.reconstructed["empty"] is True
        assert log.index("open_session") < log.index("boot")
    assert log[-1] == "close_session"


def test_the_lease_is_released_when_the_scope_ends(tmp_path, monkeypatch) -> None:
    """The unmissable half: a scope that closes is a VM released."""
    monkeypatch.setattr("repl_sandbox.session_host.SessionBridge.start", lambda self: None)
    log: list[str] = []
    with _session(tmp_path, log):
        assert os.path.exists(os.path.join(str(tmp_path), "physics.lease"))
    assert not os.path.exists(os.path.join(str(tmp_path), "physics.lease"))


def test_a_body_that_raises_still_unwinds_everything(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("repl_sandbox.session_host.SessionBridge.start", lambda self: None)
    log: list[str] = []
    with pytest.raises(RuntimeError):
        with _session(tmp_path, log):
            raise RuntimeError("planted: the caller failed")
    assert "guest.shutdown" in log
    assert "close_session" in log
    assert not os.path.exists(os.path.join(str(tmp_path), "physics.lease"))


def test_a_boot_failure_releases_the_lease_it_had_already_taken(tmp_path) -> None:
    """A failure at step n unwinds n-1..1 and strands nothing.

    The lease is taken before the boot -- it has to be, since it records the
    sandbox name -- so a boot that raises is exactly the case where a workspace
    could be left locked by a session that never existed.
    """
    log: list[str] = []
    with pytest.raises(SandboxError):
        with _session(tmp_path, log, fail_at_boot=True):
            pass
    assert not os.path.exists(os.path.join(str(tmp_path), "physics.lease"))
    assert "close_session" in log
    assert "guest.shutdown" not in log
