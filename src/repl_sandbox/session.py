"""Session identity: the `(vsock CID -> session)` binding everything else is keyed on.

Source of truth: docs/product/repl-sandbox/REPL_SANDBOX_DATA_MODEL.md section 2
(Namespace, allocation, lifecycle, revocation) — "per-session, keyed by
`(CID, id)`; disjoint across sessions" — with the identity rule from
REPL_SANDBOX_ARCHITECTURE.md section 7 requirement 4 (auth by the session
identity the listener supplies at `accept()`, never a guest-supplied id) and
REPL_SANDBOX_SPEC.md section 4 (Host chokepoint contracts).

The CID is not data the guest can write. It is what the *listener* reports at
`accept()`, which is why it — and nothing in the payload — is what the handle
table, the ledgers, and the audit log key on. This module's whole job is to say
whether a CID the listener just handed us belongs to a live session, and to
refuse when it does not.

**What supplies that value depends on the VMM, and this module is deliberately
incurious about which.** Under native vhost-vsock it is a peer CID the host
kernel reads at `accept()`. Under the ratified VMM's hybrid vsock there is no
CID to read — a Unix-socket accept carries none — and it is instead the
host-assigned id bound to that sandbox's own socket path, a path only that one
VMM can deliver a connection to. Same property, different enforcing surface;
INTERFACES section 3.1a is the authoritative correction and the one place to
read it. Earlier revisions of this header said the value comes from the kernel
without qualification, which was true of the transport the records were first
written against and is not true of the one that shipped.

Two structural rules beyond the lookup, both enforced here rather than
documented and hoped for:

* **One CID, one session.** Re-binding a live CID to a different session id is
  refused. A CID recycled across sessions without an intervening `close` would
  let session B inherit session A's handle namespace — the confused-deputy case
  REPL_SANDBOX_LEARNINGS.md section 7 (Identity: the vsock CID) names.
* **One session, one CID.** ARCHITECTURE section 6 (Recursion & multiplicity)
  ratifies one microVM per session; a second CID claiming a live session id is
  therefore either a bug or an impersonation, and is refused.

Failure is `AuthError`, which is connection-terminal by taxonomy
(REPL_SANDBOX_INTERFACES.md section 7): an unrecognised peer is dropped, not
served a partial answer.
"""

from __future__ import annotations

from repl_sandbox.audit import AuditLog
from repl_sandbox.config import VMADDR_CID_HOST
from repl_sandbox.errors import AuthError

#: The lowest CID a guest can legitimately present. In the vsock address
#: family -1 is ANY, 0 is the hypervisor, 1 is local/loopback and 2 is the host
#: (`VMADDR_CID_HOST`). A peer claiming one of those on a guest-facing listener
#: is not a guest, so it never reaches a session.
MIN_GUEST_CID = VMADDR_CID_HOST + 1


def check_cid(cid: int) -> int:
    """Validate a peer CID's shape and range, or raise `AuthError`.

    Called before any table lookup so a malformed CID fails identically to an
    unknown one: no branch downstream of this can be reached with a CID the
    kernel could not have produced for a guest.
    """
    if isinstance(cid, bool) or not isinstance(cid, int):
        raise AuthError(f"peer CID must be an integer, got {type(cid).__name__}")
    if cid < MIN_GUEST_CID:
        raise AuthError(f"CID {cid} is reserved and cannot address a session")
    return cid


class SessionTable:
    """The live `(CID -> session id)` bindings, and the authority to deny.

    Not internally synchronised; the accept loop owns it.
    """

    def __init__(self, audit: AuditLog | None = None):
        self._by_cid: dict[int, str] = {}
        self._by_session: dict[str, int] = {}
        self.audit = audit

    # -- binding ---------------------------------------------------------

    def bind(self, cid: int, session_id: str) -> None:
        """Bind a peer CID to a session id at session start.

        Idempotent for an identical re-bind (a reconnect on the same CID within
        the same session). Any other collision is refused.
        """
        check_cid(cid)
        if not isinstance(session_id, str) or not session_id:
            raise AuthError("session id must be a non-empty string")

        existing = self._by_cid.get(cid)
        if existing is not None:
            if existing == session_id:
                return
            self._deny(cid, "bind", reason="cid_already_bound")
            raise AuthError(f"CID {cid} is already bound to another session")

        claimed_by = self._by_session.get(session_id)
        if claimed_by is not None and claimed_by != cid:
            self._deny(cid, "bind", reason="session_already_bound")
            raise AuthError(f"session {session_id} is already bound to another CID")

        self._by_cid[cid] = session_id
        self._by_session[session_id] = cid
        if self.audit is not None:
            self.audit.record(cid, "session.bind", session=session_id)

    # -- lookup ----------------------------------------------------------

    def session_for(self, cid: int) -> str:
        """The session bound to `cid`, or `AuthError`. Never a default, never `None`."""
        check_cid(cid)
        session_id = self._by_cid.get(cid)
        if session_id is None:
            self._deny(cid, "session_for", reason="unbound_cid")
            raise AuthError(f"CID {cid} is not bound to a session")
        return session_id

    def is_bound(self, cid: int) -> bool:
        """Whether `cid` addresses a live session. A malformed CID is simply not bound."""
        try:
            check_cid(cid)
        except AuthError:
            return False
        return cid in self._by_cid

    def cid_for(self, session_id: str) -> int:
        """The CID bound to a session id, or `AuthError`. The reverse of `session_for`."""
        cid = self._by_session.get(session_id) if isinstance(session_id, str) else None
        if cid is None:
            raise AuthError("session id is not bound to a CID")
        return cid

    def sessions(self) -> dict[int, str]:
        """A copy of the live bindings, for operators."""
        return dict(self._by_cid)

    # -- teardown --------------------------------------------------------

    def close(self, cid: int) -> None:
        """Release a binding at session end.

        Idempotent by design: teardown runs in `finally` blocks, and a close
        that raises there would mask the error that caused the teardown. After
        it, `session_for` denies — the deny path is where the fail-closed
        guarantee lives, not here.
        """
        if isinstance(cid, bool) or not isinstance(cid, int):
            return
        session_id = self._by_cid.pop(cid, None)
        if session_id is None:
            return
        if self._by_session.get(session_id) == cid:
            del self._by_session[session_id]
        if self.audit is not None:
            self.audit.record(cid, "session.close", session=session_id)

    # -- internals -------------------------------------------------------

    def _deny(self, cid: int, op: str, *, reason: str) -> None:
        if self.audit is not None:
            self.audit.record(cid, f"session.{op}.denied", reason=reason)
