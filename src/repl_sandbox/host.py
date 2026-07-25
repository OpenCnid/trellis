"""The composition root: one object that is the whole host-side control plane.

Source of truth: docs/product/repl-sandbox/REPL_SANDBOX_INTERFACES.md section 1
(Seam map) for which handler serves which port, section 5 (DB-broker RPC surface)
for the dispatch discipline, section 6 (CapabilityDescriptor lifecycle — one
object, two renderings) for what a grant *is*, and
REPL_SANDBOX_DATA_MODEL.md section 2 (Namespace, allocation, lifecycle,
revocation) for the per-CID tables this object opens and closes together.

Every module under `repl_sandbox` that runs host-side is correct on its own and
composes with the others only if something composes them. This is that
something. It exists for one reason beyond convenience: **the per-CID tables are
opened together and must be closed together.** A session table binding, a handle
namespace, two ledgers, a dispatch grant set, and a capability registry are six
places a session's state lives, and a teardown that closes five of them leaves a
CID that a later session could inherit state from. `close_session` closes them in
one call, records what it could not close, and never raises.

**Backends and the provider are injected.** Nothing here reads a credential,
opens a socket, or imports a driver SDK, so the whole root is constructible with
in-process doubles and the same construction serves a real deployment with real
clients passed in.

**Nothing here is the boundary.** The boundary is the microVM
(REPL_SANDBOX_ARCHITECTURE.md section 2) plus the data-flow property that the
guest holds handles rather than secret-bearing payloads (section 3.1, The
exfiltration resolution). What this object contributes is that the surfaces
enforcing the *residual* bounds — the ledgers, the dispatch table, the handle
table — are all present, all keyed on the same CID, and all released at once.

**One per-CID table this object cannot close.** `LMHandler` keeps its own
per-CID state (the halted set, the rate buckets, the in-flight counters) behind
no public teardown method, so `close_session` cannot clear it. The leak is
stated here rather than papered over: every one of those three fails *closed* on
a recycled CID — a halted session stays halted, a spent bucket stays spent — so
the consequence is a refused call rather than an inherited capability. Closing
it needs an `LMHandler.close(cid)`, which is a change to that module.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

from repl_sandbox import surfaces
from repl_sandbox.audit import AuditLog
from repl_sandbox.broker import Broker, DBBackend, DispatchTable
from repl_sandbox.capabilities import (
    PRE_REGISTERED,
    CapabilityDescriptor,
    CapabilityRegistry,
)
from repl_sandbox.config import SandboxConfig
from repl_sandbox.dlp import DlpHook
from repl_sandbox.errors import DeniedError
from repl_sandbox.handles import HandleTable
from repl_sandbox.ledger import ByteLedger, SpendLedger
from repl_sandbox.lm_handler import LMHandler, Provider
from repl_sandbox.policy import ApocAllowlist
from repl_sandbox.session import SessionTable
from repl_sandbox.transport import Handler

try:  # imported for its registrations, on the same terms `broker.py` sets: a
    # deployment that grants no algebra op does not need the module, and its
    # absence removes those names from `BROKER_CAPABILITIES` rather than
    # granting a name that has no route.
    from repl_sandbox import algebra as _algebra  # noqa: F401
except ImportError:  # pragma: no cover - the module ships in this package
    _algebra = None

#: The descriptors this host can grant by name, read from the surface registry
#: rather than authored here.
#:
#: Every one of them is now registered at the definition site of the op it
#: describes — `broker.py`'s five through `@describes` on the `_op_*` handler
#: that serves them, `algebra.py`'s five beside the `_ARG_KEYS` table that
#: refuses their arguments. This module reads the result. Before this pass the
#: descriptors were authored in one dict here, and every one of the ten carried
#: at least one sentence restating a bound enforced two modules away; a guard
#: could move and the prose would go on reading as authoritative
#: (`SELF_DESCRIBING_SURFACES.md` §3.3). `test_surfaces.py` keeps those
#: sentences out of a `doc` now that each has one owner.
#:
#: This is a rendering of a fixed surface, not a policy: *which* of these a
#: session may call is `open_session`'s `ops` argument and nothing here. An op
#: that is not granted has no dispatch entry, no stub, and therefore no path —
#: that absence is what denial is (INTERFACES section 5, Tool denial).
#:
#: The set is `broker.BROKER_OPS` entire plus `algebra.DESCRIBED_ALGEBRA_OPS`,
#: which is a deliberate subset of `algebra.ALGEBRA_OPS`: `join`, `union`,
#: `concat`, `vector_search` and `get_ast_blocks` are routable and undescribed,
#: so they are not nameable in `ops=` and a caller wanting one passes its own
#: `(descriptor, port)` pair. That was already true when the dict was written by
#: hand; it is stated here because `surfaces.undescribed` now makes it
#: countable rather than something a reader has to notice.
BROKER_CAPABILITIES: dict[str, CapabilityDescriptor] = surfaces.registry()

#: The port each capability in `BROKER_CAPABILITIES` is served on. Everything the
#: broker serves is `DB_PORT`; the two pre-registered LM capabilities are
#: `LM_PORT` and are served by the LM handler, which has no dispatch table.
DB_PORT = "DB_PORT"
LM_PORT = "LM_PORT"


@dataclass
class OpenSession:
    """One live session's host-side identity and its grant set.

    Returned by `TrellisSandboxHost.open_session` so a caller can hand the
    per-session `capabilities` registry to a backend (`KataREPL(capabilities=...)`)
    without reaching into the host for it.
    """

    cid: int
    session_id: str
    capabilities: CapabilityRegistry
    granted_ops: tuple[str, ...] = ()
    #: Ops that were also granted in the broker's dispatch table. LM capabilities
    #: are absent from it: the LM handler routes nothing.
    dispatched_ops: tuple[str, ...] = ()

    def stub_source(self) -> str:
        """The guest-side proxy-stub source for this session's grants."""
        return self.capabilities.materialise(self.cid)


@dataclass
class TeardownReport:
    """What `close_session` released, and anything it could not.

    `errors` being empty is the claim worth making: every per-CID table this
    object owns was closed. It never includes the `LMHandler` state named in the
    module docstring, because there is no method to call for it.
    """

    cid: int
    session_id: str | None
    handles_freed: int = 0
    dispatch_revoked: int = 0
    errors: list[str] = field(default_factory=list)

    @property
    def clean(self) -> bool:
        return not self.errors


class TrellisSandboxHost:
    """The host-side control plane for one sandbox host.

    Builds, from one `SandboxConfig`: the audit log, the session table, the
    handle table, the byte and spend ledgers, the dispatch table, the broker over
    the injected `DBBackend`s, and the LM handler over the injected `Provider`.

    The two `Handler` callables the transport serves are `broker_handler` and
    `lm_handler` — pass either to `transport.serve_forever` with the listener for
    its port. Both take the peer CID from the transport's `accept()` as their
    first argument and read no identity from the request body.
    """

    def __init__(
        self,
        config: SandboxConfig,
        backends: dict[str, DBBackend],
        provider: Provider,
        *,
        audit: AuditLog | None = None,
        dlp: DlpHook | None = None,
        apoc: ApocAllowlist | None = None,
    ) -> None:
        self.config = config
        self.audit = audit if audit is not None else AuditLog()
        self.sessions = SessionTable(self.audit)
        self.handles = HandleTable(config.handle_ttl_s, audit=self.audit)
        self.byte_ledger = ByteLedger(config.byte_caps, self.audit)
        self.spend_ledger = SpendLedger(config.lm_caps.spend_usd, self.audit)
        self.dispatch = DispatchTable()
        self.broker = Broker(
            config=config,
            sessions=self.sessions,
            handles=self.handles,
            byte_ledger=self.byte_ledger,
            audit=self.audit,
            backends=backends,
            dispatch=self.dispatch,
        )
        if apoc is not None:
            # Deny-by-default otherwise (`Broker.__init__` installs an empty
            # `ApocAllowlist`). A non-empty set is a review decision made where
            # the host is constructed, never inferred from a query.
            self.broker.apoc = apoc
        self.lm = LMHandler(
            config=config,
            sessions=self.sessions,
            spend_ledger=self.spend_ledger,
            byte_ledger=self.byte_ledger,
            audit=self.audit,
            provider=provider,
            dlp=dlp,
            #: The same table the broker allocates from, so `llm_query(context=H)`
            #: resolves a handle the guest already holds. Without it the handler
            #: refuses every context call — a closed gate, but one that would have
            #: made the feature correct and unreachable.
            handles=self.handles,
        )
        #: One capability registry per live CID. Per-session rather than
        #: host-wide because `CapabilityRegistry` has no per-CID revocation, and
        #: a registry that outlived its session would keep a closed CID's grants
        #: renderable.
        self._open: dict[int, OpenSession] = {}

    # -- the two handlers the transport serves -----------------------------

    @property
    def broker_handler(self) -> Handler:
        """`Broker.handle_request` — serve this on `DB_PORT`."""
        return self.broker.handle_request

    @property
    def lm_handler(self) -> Handler:
        """`LMHandler.handle_request` — serve this on `LM_PORT`."""
        return self.lm.handle_request

    # -- sessions ----------------------------------------------------------

    def open_session(
        self,
        cid: int,
        session_id: str,
        *,
        ops: Sequence[str] = (),
        capabilities: Sequence[tuple[CapabilityDescriptor, str]] = (),
        lm: bool = True,
    ) -> OpenSession:
        """Bind a CID to a session and grant that session's capabilities.

        `ops` names capabilities from `BROKER_CAPABILITIES`; `capabilities` takes
        `(descriptor, port)` pairs a caller composed itself. `lm` grants the two
        pre-registered LM capabilities (INTERFACES section 6), which every
        session gets unless a caller says otherwise.

        A grant is two writes for a broker op and one for an LM op: the registry
        entry, which is what materialises a guest-side stub, and — for `DB_PORT`
        only — the dispatch entry the broker resolves routing from. The LM
        handler has no dispatch table, so an LM grant makes no entry in one; a
        grant that did would be a routing token the broker could be asked to
        honour for an op it does not serve.

        Atomic: a failure anywhere rolls the whole session back, because a
        half-granted session is one whose CID is bound to capabilities nobody
        chose.
        """
        if cid in self._open:
            raise DeniedError(f"cid {cid} already has an open session on this host")

        grants: list[tuple[CapabilityDescriptor, str]] = []
        for name in ops:
            descriptor = BROKER_CAPABILITIES.get(name)
            if descriptor is None:
                raise DeniedError(
                    f"{name!r} is not a broker or algebra capability; the set is "
                    f"{sorted(BROKER_CAPABILITIES)}"
                )
            grants.append((descriptor, DB_PORT))
        grants.extend(capabilities)
        if lm:
            grants.extend((descriptor, LM_PORT) for descriptor in PRE_REGISTERED)

        self.sessions.bind(cid, session_id)
        registry = CapabilityRegistry()
        session = OpenSession(cid=cid, session_id=session_id, capabilities=registry)
        self._open[cid] = session

        granted: list[str] = []
        dispatched: list[str] = []
        try:
            for descriptor, port in grants:
                registry.register(cid, descriptor, port)
                granted.append(descriptor.name)
                if port == DB_PORT:
                    self.dispatch.grant(cid, descriptor.name, descriptor.dispatch_ref)
                    dispatched.append(descriptor.name)
        except BaseException:
            self.close_session(cid)
            raise

        session.granted_ops = tuple(granted)
        session.dispatched_ops = tuple(dispatched)
        self.audit.record(
            cid,
            "host.session_opened",
            session=session_id,
            granted=len(granted),
            dispatched=len(dispatched),
        )
        return session

    def session(self, cid: int) -> OpenSession:
        """The open session for `cid`, or `DeniedError`."""
        session = self._open.get(cid)
        if session is None:
            raise DeniedError(f"cid {cid} has no open session on this host")
        return session

    def open_sessions(self) -> dict[int, str]:
        """`{cid: session_id}` for every live session, for operators."""
        return {cid: session.session_id for cid, session in self._open.items()}

    def close_session(self, cid: int) -> TeardownReport:
        """Release every per-CID table this host owns, in one call.

        Idempotent and non-raising: teardown runs from `finally`-shaped paths,
        and a close that raised there would mask the failure that caused it.
        Every step is attempted and each failure is recorded in the report.

        The one per-CID table not closed here is `LMHandler`'s — see the module
        docstring. Nothing in this method claims otherwise.
        """
        session = self._open.pop(cid, None)
        report = TeardownReport(
            cid=cid, session_id=session.session_id if session is not None else None
        )

        try:
            report.dispatch_revoked = len(
                session.dispatched_ops if session is not None else ()
            )
            self.dispatch.revoke_all(cid)
        except Exception as exc:  # noqa: BLE001 - teardown must not raise
            report.errors.append(f"dispatch: {type(exc).__name__}: {exc}")

        try:
            report.handles_freed = self.handles.count(cid)
            self.handles.close_session(cid)
        except Exception as exc:  # noqa: BLE001 - teardown must not raise
            report.errors.append(f"handles: {type(exc).__name__}: {exc}")

        for name, close in (
            ("byte_ledger", self.byte_ledger.close),
            ("spend_ledger", self.spend_ledger.close),
            ("sessions", self.sessions.close),
        ):
            try:
                close(cid)
            except Exception as exc:  # noqa: BLE001 - teardown must not raise
                report.errors.append(f"{name}: {type(exc).__name__}: {exc}")

        self.audit.record(
            cid,
            "host.session_closed",
            session=report.session_id,
            handles_freed=report.handles_freed,
            errors=report.errors,
        )
        return report

    def close(self) -> list[TeardownReport]:
        """Close every open session. For a host driver's own `finally`."""
        return [self.close_session(cid) for cid in list(self._open)]


__all__ = [
    "BROKER_CAPABILITIES",
    "DB_PORT",
    "LM_PORT",
    "OpenSession",
    "TeardownReport",
    "TrellisSandboxHost",
]
