"""The handle table: opaque, unforgeable, CID-scoped, payload-free references.

Source of truth: docs/product/repl-sandbox/REPL_SANDBOX_DATA_MODEL.md sections
1 (What a handle is), 2 (Namespace, allocation, lifecycle, revocation) and 3
(Broker-side resolution semantics). The handle is CODE_MEDIATED_TEXT.md
section 0 (The pillar)'s engine-computed address promoted to a transport-safe
object: the model never counts and never copies, it addresses.

What the guest holds is `{id, kind}` and nothing else. The referent — the DB
query spec, the derivation node, the host bytes-ref that actually resolves to
content — lives in this table and never leaves the host. That absence is the
boundary: it holds under 100% successful prompt injection because a model
cannot fold into an answer bytes it never had.

**Resolution is fail-closed and uniform.** A miss on `(cid, id)` — unknown id,
or a token leaked from another session — takes the same branch and returns the
same message, so the table is not an oracle for "does this id exist somewhere".
That is structural, not a check bolted on: the lookup key *is* `(cid, id)`, so
a foreign token is simply absent. Beyond the miss, a handle that is dropped,
expired, stale, or closed also denies — never a silent empty, never a partial
(DATA_MODEL section 2, "Revocation is host-side and fail-closed").

**Staleness cascades.** When a broker write touches a referent, every handle
derived from it is stale too: a derived address computed over rows that have
since moved is exactly the stale positional identity CODE_MEDIATED_TEXT.md
section 2 (The discipline) clauses 3 and 6 forbid. `mark_stale` walks the
derivation tree, and stale resolution denies loudly and retryably so the model
re-queries rather than reading a shifted address.

Not internally synchronised: the broker serialises per-CID work.
"""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass, field
from typing import Callable, Iterator

from repl_sandbox.audit import AuditLog
from repl_sandbox.errors import DeniedError

#: The coarse type tags of DATA_MODEL section 1. `kind` is the only inference
#: the guest gets for free: it selects which algebra ops are valid and reveals
#: a shape class, never a value.
HANDLE_KINDS: tuple[str, ...] = (
    "table",
    "text-blocks",
    "scalar",
    "result-set",
    "graph-view",
)

#: The five states of DATA_MODEL section 2. Only `live` resolves.
HANDLE_STATES: tuple[str, ...] = ("live", "dropped", "expired", "stale", "closed")

#: Token width in bytes. 128 bits, per DATA_MODEL section 1 — unguessability is
#: a *secondary* defense; the CID-scoped table is the primary one.
TOKEN_BYTES = 16

#: The single message every unresolvable-token denial carries. One string for
#: "never existed" and "belongs to another session" is what keeps the table
#: from confirming the existence of another session's handle.
UNRESOLVABLE_MESSAGE = "handle is not resolvable for this session"

#: Ceiling on the lineage a single handle may declare, so a derivation chain
#: cannot be used to build an unbounded parent list in one call.
MAX_PARENTS = 32


@dataclass(frozen=True)
class Handle:
    """The guest-side shape, and the only shape that crosses.

    Deliberately two fields. No shape, no count, no schema, no content — those
    are value-bearing and cross only through the metered sinks of DATA_MODEL
    section 6.
    """

    id: str
    kind: str

    def __post_init__(self) -> None:
        if not isinstance(self.id, str) or not self.id:
            raise ValueError("handle id must be a non-empty string")
        if self.kind not in HANDLE_KINDS:
            raise ValueError(f"unknown handle kind {self.kind!r}")

    def to_wire(self) -> dict:
        """Exactly `{"id", "kind"}` — the wire rendering of DATA_MODEL section 1."""
        return {"id": self.id, "kind": self.kind}


@dataclass
class HandleEntry:
    """The host-side table row. This object never crosses to the guest.

    `referent` is the thing that resolves to content: a query spec, a
    derivation node, a host bytes-ref. It is the field whose absence from the
    guest is the boundary.
    """

    id: str
    cid: int
    kind: str
    referent: object
    parents: tuple[str, ...] = ()
    alloc_time: float = 0.0
    ttl: float = 0.0
    state: str = "live"
    #: Handles derived from this one. Maintained by the table; the cascade walks it.
    children: set[str] = field(default_factory=set)

    def handle(self) -> Handle:
        """The guest-side projection of this row."""
        return Handle(id=self.id, kind=self.kind)


class HandleTable:
    """Per-broker allocation table, keyed `(CID, id)`.

    One logical namespace per live CID, disjoint across sessions (DATA_MODEL
    section 2). The table holds every referent; nothing here hands one back.
    """

    def __init__(
        self,
        ttl_s: float,
        now: Callable[[], float] = time.monotonic,
        audit: AuditLog | None = None,
    ):
        if not isinstance(ttl_s, (int, float)) or isinstance(ttl_s, bool):
            raise ValueError("ttl_s must be a number")
        if ttl_s < 0:
            raise ValueError(f"ttl_s must be non-negative, got {ttl_s}")
        self._ttl = float(ttl_s)
        self._now = now
        self._entries: dict[tuple[int, str], HandleEntry] = {}
        self.audit = audit

    # -- allocation ------------------------------------------------------

    def allocate(
        self,
        cid: int,
        kind: str,
        referent: object,
        parents: tuple[str, ...] = (),
    ) -> Handle:
        """Mint a handle for `referent` in `cid`'s namespace.

        Every declared parent must resolve live for the same CID first, so a
        derived handle can never outlive — or be forged over — a lineage the
        session does not hold.
        """
        _check_cid(cid)
        if kind not in HANDLE_KINDS:
            raise DeniedError(f"unknown handle kind {kind!r}")
        parent_ids = _check_parents(parents)
        for parent_id in parent_ids:
            self.resolve(cid, parent_id)

        handle_id = self._mint(cid)
        entry = HandleEntry(
            id=handle_id,
            cid=cid,
            kind=kind,
            referent=referent,
            parents=parent_ids,
            alloc_time=self._now(),
            ttl=self._ttl,
            state="live",
        )
        self._entries[(cid, handle_id)] = entry
        for parent_id in parent_ids:
            self._entries[(cid, parent_id)].children.add(handle_id)
        self._record(cid, "handle.allocate", handle=handle_id, kind=kind, parents=len(parent_ids))
        return entry.handle()

    def _mint(self, cid: int) -> str:
        """A random 128-bit token, checked unique within the CID's namespace."""
        while True:
            token = secrets.token_hex(TOKEN_BYTES)
            if (cid, token) not in self._entries:
                return token

    # -- resolution ------------------------------------------------------

    def resolve(self, cid: int, handle_id: str) -> HandleEntry:
        """Return the live entry for `(cid, handle_id)`, or deny.

        The only way to reach a referent. Denies on: a malformed id, an unknown
        id, another session's id, and any non-live state. There is no partial
        result and no empty result — only an entry or an exception.
        """
        _check_cid(cid)
        if not isinstance(handle_id, str) or not handle_id:
            raise DeniedError(UNRESOLVABLE_MESSAGE)

        entry = self._entries.get((cid, handle_id))
        if entry is None:
            # Unknown and foreign land here identically, by key construction.
            self._record(cid, "handle.resolve.denied", handle=handle_id, reason="unresolvable")
            raise DeniedError(UNRESOLVABLE_MESSAGE)

        if entry.state == "live" and self._is_expired(entry):
            self._transition(entry, "expired", "handle.expire")

        if entry.state != "live":
            self._record(
                cid, "handle.resolve.denied", handle=handle_id, reason=entry.state
            )
            # Stale is the one retryable case: the rows moved, so re-query and
            # take a fresh address (CODE_MEDIATED_TEXT.md section 2, clause 3).
            raise DeniedError(
                f"handle is {entry.state}", retryable=(entry.state == "stale")
            )
        return entry

    def peek(self, cid: int, handle_id: str) -> str | None:
        """The recorded state of a handle without resolving it, for operators.

        Host-side introspection only. Nothing guest-facing calls this: it
        distinguishes "unknown" from "dropped", which `resolve` deliberately
        does not.
        """
        entry = self._entries.get((cid, handle_id))
        return None if entry is None else entry.state

    def _is_expired(self, entry: HandleEntry) -> bool:
        """TTL elapsed. Exactly-at-TTL counts as elapsed."""
        return (self._now() - entry.alloc_time) >= entry.ttl

    # -- lifecycle -------------------------------------------------------

    def drop(self, cid: int, handle_id: str) -> None:
        """The model's release valve (`drop(H)`, DATA_MODEL section 2).

        Resolves first, so dropping an unknown or foreign token denies exactly
        as reading it would. Does not cascade: dropping a parent is a release
        of that address, not a mutation of the rows underneath it. Derived
        handles stay live and stay evaluable only while their own lineage
        resolves — the broker's later host-side evaluation re-resolves parents
        under this same fail-closed rule.
        """
        entry = self.resolve(cid, handle_id)
        self._transition(entry, "dropped", "handle.drop")

    def mark_stale(self, cid: int, handle_id: str) -> int:
        """Mark a handle and every handle derived from it stale.

        Called host-side when a broker write touches the referent. Returns the
        number of handles that transitioned. The cascade is the point: a
        derived address over mutated rows is a stale positional identity, and
        the house forbids resolving one.
        """
        _check_cid(cid)
        entry = self._entries.get((cid, handle_id))
        if entry is None:
            raise DeniedError(UNRESOLVABLE_MESSAGE)

        marked = 0
        for node in self._walk(cid, handle_id):
            if node.state == "live":
                node.state = "stale"
                marked += 1
        self._record(
            cid, "handle.stale", handle=handle_id, marked=marked
        )
        return marked

    def _walk(self, cid: int, root_id: str) -> Iterator[HandleEntry]:
        """Depth-first over a handle and its descendants, cycle-safe."""
        seen: set[str] = set()
        stack = [root_id]
        while stack:
            current = stack.pop()
            if current in seen:
                continue
            seen.add(current)
            entry = self._entries.get((cid, current))
            if entry is None:
                continue
            yield entry
            # Descendants of a non-live node are still walked: a dropped
            # intermediate must not shelter a live grandchild from the cascade.
            stack.extend(entry.children)

    def close_session(self, cid: int) -> None:
        """Free the whole per-CID table at session end (DATA_MODEL section 2).

        Entries are marked `closed` and removed, so a token surviving in guest
        memory resolves as unresolvable afterwards. There is no resolved-bytes
        cache in this layer to zero — this table never holds resolved content,
        only referents.
        """
        if isinstance(cid, bool) or not isinstance(cid, int):
            return
        doomed = [key for key in self._entries if key[0] == cid]
        for key in doomed:
            entry = self._entries.pop(key)
            entry.state = "closed"
            entry.children.clear()
        if doomed:
            self._record(cid, "handle.close_session", freed=len(doomed))

    def sweep(self) -> int:
        """Expire every live handle whose TTL has elapsed. Returns the count.

        `resolve` expires lazily as well, so the sweep is about reclaiming rows
        nobody touches again, not about correctness of a read.
        """
        expired = 0
        for entry in self._entries.values():
            if entry.state == "live" and self._is_expired(entry):
                self._transition(entry, "expired", "handle.expire")
                expired += 1
        return expired

    # -- introspection ---------------------------------------------------

    def count(self, cid: int | None = None) -> int:
        """Rows held, optionally for one session."""
        if cid is None:
            return len(self._entries)
        return sum(1 for key in self._entries if key[0] == cid)

    # -- internals -------------------------------------------------------

    def _transition(self, entry: HandleEntry, state: str, op: str) -> None:
        if state not in HANDLE_STATES:
            raise ValueError(f"unknown handle state {state!r}")
        entry.state = state
        self._record(entry.cid, op, handle=entry.id)

    def _record(self, cid: int, op: str, **fields) -> None:
        if self.audit is not None:
            self.audit.record(cid, op, **fields)


def _check_cid(cid: int) -> None:
    """CIDs come from `accept()`; a non-integer here is a host-side bug."""
    if isinstance(cid, bool) or not isinstance(cid, int):
        raise ValueError(f"cid must be an integer, got {type(cid).__name__}")


def _check_parents(parents: tuple[str, ...]) -> tuple[str, ...]:
    if isinstance(parents, str) or not isinstance(parents, (tuple, list)):
        raise DeniedError("parents must be a sequence of handle ids")
    if len(parents) > MAX_PARENTS:
        raise DeniedError(f"lineage of {len(parents)} exceeds the {MAX_PARENTS} parent ceiling")
    for parent in parents:
        if not isinstance(parent, str) or not parent:
            raise DeniedError("parent handle ids must be non-empty strings")
    return tuple(parents)
