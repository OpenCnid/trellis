"""The composition layer: one workspace, one session, one microVM.

Source of truth: docs/architecture/THE_REPL_IN_TRELLIS.md (what persists and
what is borrowed) and docs/product/repl-sandbox/REPL_SANDBOX_BUILD_PLAN.md
section 5.6 (the eighth item — who owns the host end of `LM_PORT`/`DB_PORT`).

**This module exists because nothing joined the two halves.** `KataLauncher`
boots a guest and knows nothing about a host; `TrellisSandboxHost` holds the
credentials and the policy and knows nothing about a VM; `KataREPL` speaks the
rlms contract and takes a session table it has no way to populate. Each half was
proved separately, five times, by substituting a stand-in for the other — every
probe binds real listeners against a real microVM but drives `ctr` by hand, and
the CLI selftest drives the real backend against an in-process double with no VM
at all. The diagonal — the real backend against the real boundary — had never
run. This is the block that already worked in those five places, promoted out of
`scripts/` and given a name.

**Why a context manager, and why that was never really a trade.** The durable
thing and the executing thing are different objects. A workspace persists
because its state is in the substrate; the microVM is compute borrowed for one
stretch of work. So a scope that closes is a VM released, never a session lost,
and the one genuinely unrecoverable mistake here — leaking a live microVM on a
host somebody pays for — becomes impossible to make by forgetting. rlms already
models exactly this: its own driver ends a non-persistent run with `cleanup()`.

**Ordering is forced, not chosen**, and every step is where it is because a
later position breaks something specific:

1. the lease, because two Trellises editing one workspace is the thing checkout
   exists to prevent, and it must be refused before any resource is allocated;
2. the host, because the listeners serve *its* handlers and the backend takes
   *its* session table;
3. `open_session`, because the CID binding is what the handlers authenticate
   against;
4. the boot, because the vsock socket path does not exist until the VMM does —
   this is the step that makes the whole order non-negotiable;
5. the listeners, because the guest dials outward on its first tool call and a
   dial with no listener is answered with a closed connection, not a wait;
6. the scaffold, which starts the guest process, and must therefore be last.

Teardown reverses it exactly. A failure at step *n* unwinds *n-1 … 1* and
nothing else, which is why each allocation is recorded the instant it is made
rather than after the sequence completes.
"""

from __future__ import annotations

import json
import os
import threading
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from typing import Any, Callable, Iterator, Sequence

from repl_sandbox.audit import AuditLog
from repl_sandbox.config import SandboxConfig
from repl_sandbox.errors import DeniedError, SandboxError
from repl_sandbox.launcher import KataLauncher, vmm_pids_carrying
from repl_sandbox.transport import HybridVsockListener, hybrid_socket_path, serve_forever

#: Schema version for a persisted manifest. A workspace written by a later
#: Trellis must not be silently half-read by an earlier one.
MANIFEST_SCHEMA_VERSION = 1

#: How long a stopping listener thread is given before teardown stops waiting.
LISTENER_JOIN_TIMEOUT_S = 5.0


# ---------------------------------------------------------------------------
# Identity
# ---------------------------------------------------------------------------


def _stamp(now: datetime | None = None) -> str:
    """UTC, to the finest granularity the platform clock offers, sortable.

    `datetime` carries microseconds, which is the smallest unit that survives
    into a filename without inventing precision the clock does not have. UTC
    rather than local time so two Trellises in different zones on one host still
    sort correctly against each other.
    """
    moment = now if now is not None else datetime.now(timezone.utc)
    return moment.strftime("%Y%m%dT%H%M%S.%f")


def mint_workspace_id(*, now: datetime | None = None) -> str:
    """A workspace's permanent identifier, minted **once, at creation**.

    Owner direction (Matt, 2026-07-25): the timestamp goes to the finest
    granularity the system offers and a UUID keeps it unique, with the
    human-facing label held as metadata instead.

    This is what dissolves the naming ambiguity rather than managing it. The
    earlier shape derived an identifier from the workspace's *name* and the
    *current* date, which forced a choice between stable and unique: a date made
    it unique per session and broke it as a lock key, and no date made two
    workspaces called "physics" the same workspace. Minting once at creation
    gives both properties at no cost — it never moves, and it never collides.

    The consequence worth stating: **"physics" is a display name, not an
    identity.** Renaming a workspace touches one metadata field and breaks
    nothing, because no lease, no manifest and no ledger ever referred to the
    name.
    """
    return f"ws-{_stamp(now)}-{uuid.uuid4().hex}"


def mint_session_id(
    user_id: str,
    workspace_id: str,
    *,
    now: datetime | None = None,
) -> str:
    """One session's identifier: unique per opening, and traceable to both ends.

    **Two identifiers, not one, and collapsing them is the trap.** A workspace id
    is permanent (`mint_workspace_id`) — it is what a lease locks and what a
    manifest is found by. A session id is *unique per opening*, because it keys
    the ledgers, the audit trail and the CID binding.

    The user component is deliberately **operational identity only**: it names
    who holds a lease on this machine, it lives in configuration, and it is never
    written to the substrate. `FEATURE_LIST.md` 1.6 is closed on the ground that
    nothing in the store names an owner and nothing needs to; a user id that
    reached the store would revise that ruling rather than apply it.

    Entropy is not decoration. One user opening two sessions inside the same
    clock tick is ordinary under automation, and a collision here is two sessions
    sharing a ledger.
    """
    for name, value in (("user_id", user_id), ("workspace_id", workspace_id)):
        if not isinstance(value, str) or not value.strip():
            raise SandboxError(f"{name} must be a non-empty string")
    return f"{_slug(user_id)}-{_stamp(now)}-{uuid.uuid4().hex[:12]}"


def _slug(raw: str) -> str:
    """A filesystem- and log-safe rendering of a caller-supplied identifier."""
    cleaned = "".join(char if char.isalnum() else "-" for char in raw).strip("-")
    return (cleaned or "x")[:32]


# ---------------------------------------------------------------------------
# The manifest
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class WorkspaceManifest:
    """What a workspace *is*, apart from its content.

    **It ships empty and a session clones it into the form it takes.** That is
    the whole reason it exists now rather than later: an empty manifest makes
    reconstruction a no-op, so the first real session is correct without a
    retrofit, and the shape is fixed before anything depends on its absence.

    What it deliberately does **not** hold: the namespace. A workspace does not
    remember by snapshotting live Python objects — those are model-authored, and
    deserialising them outside the sandbox would be an arbitrary-code-execution
    primitive running with the host's privileges, which inverts the boundary the
    microVM exists to provide. It also has no content identity, cannot be sliced
    by address, and cannot be the size a workspace actually is. What persists is
    the store; what this names is how to find the way back into it.

    So a turn's durable output is the filed artifact, never the namespace, and
    the artifact loop is not a feature sitting on top of persistence — it *is*
    the persistence mechanism.
    """

    workspace_id: str
    schema_version: int = MANIFEST_SCHEMA_VERSION
    #: What a person calls this workspace — "physics", "parts inventory".
    #:
    #: Metadata, deliberately, and never an identifier (owner direction, Matt,
    #: 2026-07-25). Nothing resolves it, nothing locks on it, and nothing joins
    #: by it, so renaming a workspace is a one-field edit that breaks no lease,
    #: no ledger and no manifest. It is also the only field here a user writes.
    human_readable_name: str = ""
    #: Document versions that are live for this workspace. Addresses, never bytes.
    live_documents: tuple[str, ...] = ()
    #: Root handles pre-allocated at session open (facts, beliefs, doubts).
    root_handles: tuple[str, ...] = ()
    #: Artifacts previous turns filed, by address, with the standing they carry.
    artifacts: tuple[dict, ...] = ()

    @property
    def is_empty(self) -> bool:
        """True when there is nothing to reconstruct — the day-one state."""
        return not (self.live_documents or self.root_handles or self.artifacts)

    def to_json(self) -> str:
        return json.dumps(
            {
                "workspace_id": self.workspace_id,
                "schema_version": self.schema_version,
                "human_readable_name": self.human_readable_name,
                "live_documents": list(self.live_documents),
                "root_handles": list(self.root_handles),
                "artifacts": list(self.artifacts),
            },
            indent=2,
            sort_keys=True,
        )

    @classmethod
    def empty(cls, workspace_id: str, human_readable_name: str = "") -> "WorkspaceManifest":
        return cls(workspace_id=workspace_id, human_readable_name=human_readable_name)

    @classmethod
    def from_json(cls, raw: str, workspace_id: str) -> "WorkspaceManifest":
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise SandboxError(f"manifest for {workspace_id!r} is not valid JSON: {exc}") from exc
        if not isinstance(data, dict):
            raise SandboxError(f"manifest for {workspace_id!r} must be a JSON object")

        version = data.get("schema_version")
        if version != MANIFEST_SCHEMA_VERSION:
            # Refused rather than best-effort read: a manifest from a later
            # Trellis names things this one does not understand, and a partial
            # reconstruction is a workspace that looks restored and is not.
            raise SandboxError(
                f"manifest for {workspace_id!r} is schema version {version!r}; "
                f"this Trellis reads version {MANIFEST_SCHEMA_VERSION}"
            )
        return cls(
            workspace_id=data.get("workspace_id", workspace_id),
            schema_version=version,
            human_readable_name=data.get("human_readable_name", ""),
            live_documents=tuple(data.get("live_documents", ())),
            root_handles=tuple(data.get("root_handles", ())),
            artifacts=tuple(data.get("artifacts", ())),
        )


# ---------------------------------------------------------------------------
# The lease
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class LeaseRecord:
    """Who holds a workspace, and what to check to find out if they still do."""

    workspace_id: str
    session_id: str
    sandbox_name: str
    pid: int
    acquired_at: float


class WorkspaceLease:
    """Checkout: one workspace, one holder, no concurrency by design.

    Instances run in parallel — a machine may serve inventory, billing and parts
    at once, each its own Trellis with its own database. **Workspaces are what
    must not be shared**, and this is the lock that says so.

    **Auto-reclaim, on an observation rather than a timeout.** A held lease names
    the sandbox its holder booted, so liveness is answerable directly: walk
    `/proc` and ask whether a real Cloud Hypervisor still carries that name. If
    none does, the holder is gone and the lease is reclaimed. That is the same
    exe-verified check the launcher uses to refuse a boot that produced no VM,
    which is worth noting — the primitive built to catch a phantom VM is exactly
    the one that proves a real one is gone.

    A timeout would have been the wrong instrument twice over: too short locks a
    user out of their own data during a long turn, too long leaves a crashed
    workspace unopenable, and neither answers the question actually being asked.
    """

    def __init__(
        self,
        root: str,
        workspace_id: str,
        *,
        liveness: Callable[[str], list[int]] | None = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.root = root
        self.workspace_id = workspace_id
        self.path = os.path.join(root, f"{_slug(workspace_id)}.lease")
        self._liveness = liveness if liveness is not None else vmm_pids_carrying
        self._clock = clock
        self.reclaimed_from: LeaseRecord | None = None

    def read(self) -> LeaseRecord | None:
        try:
            with open(self.path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
        except FileNotFoundError:
            return None
        except (OSError, json.JSONDecodeError):
            # An unreadable lease is treated as no lease: it cannot name a live
            # holder, so honouring it would lock a workspace on the strength of
            # bytes nobody can interpret.
            return None
        try:
            return LeaseRecord(**data)
        except TypeError:
            return None

    def acquire(self, session_id: str, sandbox_name: str) -> LeaseRecord:
        """Take the lease, reclaiming a dead holder's automatically."""
        held = self.read()
        if held is not None:
            survivors = self._liveness(held.sandbox_name)
            if survivors:
                raise DeniedError(
                    f"workspace {self.workspace_id!r} is checked out by session "
                    f"{held.session_id!r} (sandbox {held.sandbox_name}, live VMM pids "
                    f"{survivors}). One workspace, one session."
                )
            # The holder is gone: no VMM carries the sandbox it booted.
            self.reclaimed_from = held

        os.makedirs(self.root, exist_ok=True)
        record = LeaseRecord(
            workspace_id=self.workspace_id,
            session_id=session_id,
            sandbox_name=sandbox_name,
            pid=os.getpid(),
            acquired_at=self._clock(),
        )
        with open(self.path, "w", encoding="utf-8") as handle:
            json.dump(record.__dict__, handle, indent=2, sort_keys=True)
        return record

    def release(self) -> None:
        """Drop the lease. Idempotent; never raises."""
        try:
            os.unlink(self.path)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# The bridge
# ---------------------------------------------------------------------------


class SessionBridge:
    """The host end of `LM_PORT` and `DB_PORT`, for one sandbox.

    This is the eighth item of BUILD_PLAN section 5.6, and the reason it is here
    rather than in `KataLauncher` or `KataREPL` is ownership of failure. Binding
    the second listener can fail after the first is bound and after a microVM is
    running. Only a component holding the listeners *and* the guest handle can
    unwind both in the right order — the launcher has no host, and the backend
    would be part-way through `setup()` with sockets open and no handle assigned.

    Each listener binds at `<uds>_<port>`: the per-sandbox socket path the
    hypervisor created, which is what carries session identity now that the host
    side is `AF_UNIX` and `accept()` reports no CID (INTERFACES section 3.1a).
    """

    def __init__(
        self,
        uds_path: str,
        cid: int,
        config: SandboxConfig,
        ports: Sequence[tuple[int, Callable[[int, dict], dict]]],
        audit: AuditLog | None = None,
    ) -> None:
        self.uds_path = uds_path
        self.cid = cid
        self.config = config
        self._ports = list(ports)
        self.audit = audit
        self._stop = threading.Event()
        self._listeners: list[HybridVsockListener] = []
        self._threads: list[threading.Thread] = []
        self.bound: tuple[str, ...] = ()

    def start(self) -> None:
        """Bind every granted port, or bind none and leave nothing behind.

        **Idempotent, and that is load-bearing rather than defensive.** The
        composition layer binds at its step 5, because it owns the failure: a
        second listener can fail after the first is bound and a microVM is
        already running, and only the party holding both can unwind them. But
        `KataREPL.setup()` also calls `start_bridge()`, because from the
        backend's side "the bridge is up before any untrusted worker" is a
        precondition it is right to assert. Both callers are correct, so the
        second call confirms rather than rebinds — a re-bind would fail on the
        socket path the first one already holds.
        """
        if self.bound:
            return
        bound: list[str] = []
        try:
            for port, handler in self._ports:
                listener = HybridVsockListener(self.uds_path, port, self.cid)
                self._listeners.append(listener)
                thread = threading.Thread(
                    target=serve_forever,
                    args=(listener, handler, self.config.max_frame_len, None, self._stop),
                    name=f"trellis-bridge-{self.cid}-{port}",
                    daemon=True,
                )
                thread.start()
                self._threads.append(thread)
                bound.append(hybrid_socket_path(self.uds_path, port))
        except BaseException:
            self.stop()
            raise
        self.bound = tuple(bound)

    def stop(self) -> None:
        """Close every listener and join its thread. Idempotent; never raises."""
        self._stop.set()
        for listener in self._listeners:
            try:
                listener.close()
            except OSError:
                pass
        self._listeners.clear()
        for thread in self._threads:
            thread.join(timeout=LISTENER_JOIN_TIMEOUT_S)
        self._threads.clear()


# ---------------------------------------------------------------------------
# The session
# ---------------------------------------------------------------------------


@dataclass
class KataSession:
    """One open workspace session: everything the caller needs, already wired."""

    workspace_id: str
    session_id: str
    cid: int
    manifest: WorkspaceManifest
    host: Any
    guest: Any
    bridge: SessionBridge
    backend: Any = None
    reclaimed_from: LeaseRecord | None = None
    reconstructed: dict = field(default_factory=dict)


def reconstruct(manifest: WorkspaceManifest) -> dict:
    """Rebuild what a workspace knows, from its manifest.

    A no-op on an empty manifest, which is the day-one state and the reason the
    manifest ships now: the first real session is already correct, and no later
    session has to retrofit a mechanism around an absence.

    What reconstruction is *not*: restoring a namespace. Handles are re-issued
    and `context` re-bound from addresses the store can still resolve. Nothing
    model-authored comes back as a code object.
    """
    return {
        "documents": len(manifest.live_documents),
        "handles": len(manifest.root_handles),
        "artifacts": len(manifest.artifacts),
        "empty": manifest.is_empty,
    }


@contextmanager
def open_workspace_session(
    config: SandboxConfig,
    workspace_id: str,
    *,
    user_id: str,
    lease_root: str,
    host_factory: Callable[[], Any],
    launcher: KataLauncher | None = None,
    manifest_store: Callable[[str], WorkspaceManifest] | None = None,
    ops: Sequence[str] = (),
    lm: bool = True,
    audit: AuditLog | None = None,
) -> Iterator[KataSession]:
    """Open one workspace in one microVM, and release everything on the way out.

    The six ordered steps and why the order is forced are in this module's
    header. `host_factory` is a callable rather than a host because the host
    holds credentials and the caller decides where those come from; this module
    never reads one.
    """
    session_id = mint_session_id(user_id, workspace_id)
    launcher = launcher if launcher is not None else KataLauncher(config, audit=audit)
    load_manifest = manifest_store if manifest_store is not None else WorkspaceManifest.empty

    lease = WorkspaceLease(lease_root, workspace_id)
    sandbox_name = launcher.mint_sandbox_name(session_id)
    lease.acquire(session_id, sandbox_name)

    host = None
    guest = None
    bridge = None
    cid = None
    try:
        manifest = load_manifest(workspace_id)
        host = host_factory()
        cid = launcher.mint_cid()
        opened = host.open_session(cid, session_id, ops=tuple(ops), lm=lm)

        guest = launcher.boot(session_id, sandbox_name=sandbox_name)

        ports: list[tuple[int, Callable[[int, dict], dict]]] = []
        if lm:
            ports.append((config.ports.lm, host.lm_handler))
        if ops:
            ports.append((config.ports.db, host.broker_handler))
        bridge = SessionBridge(guest.uds_path, cid, config, ports, audit=audit)
        # Step 5, performed rather than merely prepared. An earlier draft only
        # attached the bridge and left starting it to `KataREPL.setup()`, which
        # meant a session composed without a backend came up with no host end at
        # all — the guest's first tool call would have met a closed connection.
        # Found by running the diagonal on real hardware, where `bound` was
        # empty; no off-host test could see it, because none of them opens a
        # session without also driving a backend.
        bridge.start()
        guest.attach_bridge(bridge)

        yield KataSession(
            workspace_id=workspace_id,
            session_id=session_id,
            cid=cid,
            manifest=manifest,
            host=host,
            guest=guest,
            bridge=bridge,
            reclaimed_from=lease.reclaimed_from,
            reconstructed=reconstruct(manifest),
        )
    finally:
        # Reverse order, and each step independently guarded: a failure while
        # releasing one resource must not strand the ones behind it. The lease
        # goes last, because a workspace is only free once its VM is gone.
        if bridge is not None:
            bridge.stop()
        if guest is not None:
            try:
                guest.shutdown()
            except SandboxError:
                pass
        if host is not None and cid is not None:
            try:
                host.close_session(cid)
            except (DeniedError, SandboxError):
                pass
        lease.release()
