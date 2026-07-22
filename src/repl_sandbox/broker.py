"""The host DB broker — the credentialed side of the DB seam.

Source of truth: docs/product/repl-sandbox/REPL_SANDBOX_INTERFACES.md section 5
(DB-broker RPC surface) for the `v1` envelope, the operation set, and the
Postgres/Neo4j control tables; REPL_SANDBOX_DATA_MODEL.md section 3
(Broker-side resolution semantics) for the resolution discipline;
REPL_SANDBOX_DATA_MODEL.md section 6 (The bounded materialisation exception) for
the metered sinks.

**The property that makes this component correct is an absence.** Of the
operations this broker serves, exactly two return referent content to the guest:
`slice` and `materialize` (`Broker.CONTENT_OPS`). `run_query` and `run_cypher`
return an opaque handle plus safe metadata — a row count and a column schema —
and no row ever rides back in their result. `resolve_meta` returns shape and
length. There is no "give me the bytes of this handle" operation anywhere else in
the surface, and that absence, not a runtime check the guest could steer around,
is what holds under total prompt injection: a fully-steered model cannot fold
into an answer bytes it was never given (ARCHITECTURE section 3.1, The
exfiltration resolution). The byte ledgers, the row and result caps, and the
audit log are defense-in-depth on the narrow residual that `slice` and
`materialize` deliberately leave; none of them is the boundary.

**The broker assumes the caller is hostile and already fully compromised.** It
takes the session identity from the CID the transport read at `accept()` and
never from the request body; it routes by its own `(cid, op)` dispatch table and
never by a routing token the request supplies. A denied tool is one that was
never granted, so no `dispatch_ref` exists for it and there is no dispatch path
to deny at call time (INTERFACES section 5, Tool denial).

This module holds no database driver. The real Postgres and Neo4j clients live
behind the `DBBackend` protocol, host-side, along with the credentials and the
network route; the guest holds a proxy stub and nothing else.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Protocol

from repl_sandbox.config import SandboxConfig
from repl_sandbox.errors import (
    CapBytesError,
    DeniedError,
    SandboxError,
    TimeoutError_,
    UpstreamError,
)
from repl_sandbox.policy import ApocAllowlist, inspect_cypher, inspect_sql

if TYPE_CHECKING:  # collaborators arrive by injection; only the types are needed here
    from repl_sandbox.audit import AuditLog
    from repl_sandbox.handles import Handle, HandleEntry, HandleTable
    from repl_sandbox.ledger import ByteLedger
    from repl_sandbox.session import SessionTable

try:  # the algebra module is optional at construction: a deployment that grants
    # no algebra op does not need it, and a granted algebra op without it is an
    # upstream fault rather than a silent pass-through.
    from repl_sandbox.algebra import ALGEBRA_OPS as _ALGEBRA_OPS
    from repl_sandbox.algebra import apply_op as _apply_op
except ImportError:
    _apply_op = None
    _ALGEBRA_OPS: tuple[str, ...] = ()


#: Envelope version of INTERFACES section 5. A removed or retyped field, or
#: changed op semantics, is a new `v` (INTERFACES section 8).
ENVELOPE_VERSION = 1

#: Broker-local ceiling on one request's serialised `args`.
#:
#: `config.max_frame_len` is sized for the largest legitimate frame across every
#: seam — a context load, a batched prompt set — which is far larger than any
#: legitimate broker request. The broker narrows it here so an oversized args
#: blob is refused at the seam that knows what a legitimate size is.
MAX_ARGS_BYTES = 256 * 1024

#: Longest `req_id` echoed back, and the characters allowed in it. The id is
#: guest-supplied and is echoed, never interpreted; bounding it stops an echo
#: amplification and keeps a control sequence out of the audit log.
MAX_REQ_ID_CHARS = 128
_REQ_ID_RE = re.compile(r"^[\x20-\x7e]{1,%d}$" % MAX_REQ_ID_CHARS)

#: Longest op name accepted. The op is matched against a fixed table, so a longer
#: name could never route; bounding it keeps the audit line bounded too.
MAX_OP_CHARS = 64

#: Envelope and args keys the broker refuses outright. None of them is ever read
#: — routing is by the `accept()` CID and the dispatch table — so their presence
#: means the caller is trying to supply its own identity or routing, which is the
#: confused-deputy attempt worth auditing rather than ignoring.
FORBIDDEN_KEYS: frozenset[str] = frozenset({"dispatch_ref", "cid", "session", "session_id"})

#: The ops this broker serves itself. Every one of them is in the table
#: `Broker.__init__` builds; nothing routes by any other name.
BROKER_OPS: frozenset[str] = frozenset(
    {"run_query", "run_cypher", "resolve_meta", "slice", "materialize"}
)

#: Ops routed on to the handle algebra (DATA_MODEL section 4): handle in, handle
#: or bounded address set out, no content. Taken from `algebra.ALGEBRA_OPS` so
#: the two modules cannot drift apart.
#:
#: This set used to be `frozenset(_ALGEBRA_OPS) - BROKER_OPS`. The subtraction was
#: compensating for a name collision: DATA_MODEL section 4 called the algebra's
#: windowing op `slice`, INTERFACES section 5 called the metered payload path
#: `slice`, and the subtraction silently dropped the algebra one — so a guest
#: could not narrow a handle without materialising it. The algebra op is now
#: `narrow`, the two names are disjoint, and the subtraction would only hide the
#: next collision the same way. It is gone; the disjointness is asserted in the
#: tests instead, where a future collision fails loudly rather than deleting an op.
ALGEBRA_OPS: frozenset[str] = frozenset(_ALGEBRA_OPS)

#: Deepest structure the JSON normaliser walks before stringifying a value.
_MAX_NORMALISE_DEPTH = 16


# ---------------------------------------------------------------------------
# Dispatch table
# ---------------------------------------------------------------------------


class DispatchTable:
    """The `(cid, op) -> dispatch_ref` routing table. Host-side, never guest-writable.

    Denial is structural (INTERFACES section 5, Tool denial): a denied tool is
    never granted, so it has no entry here, no `dispatch_ref` is materialised for
    it, and no proxy stub exists in the guest. `resolve_ref` on an ungranted
    `(cid, op)` raises before any backend, policy, or handle work happens.

    Only the trusted driver calls `grant`.
    """

    def __init__(self) -> None:
        self._refs: dict[tuple[int, str], str] = {}

    def grant(self, cid: int, op: str, dispatch_ref: str) -> None:
        """Grant `op` to `cid`, routed by `dispatch_ref`. Trusted-host call only."""
        if not isinstance(cid, int) or isinstance(cid, bool):
            raise UpstreamError(f"cid must be an int, got {type(cid).__name__}")
        if not isinstance(op, str) or not op:
            raise UpstreamError("op must be a non-empty string")
        if not isinstance(dispatch_ref, str) or not dispatch_ref:
            raise UpstreamError("dispatch_ref must be a non-empty string")
        self._refs[(cid, op)] = dispatch_ref

    def revoke(self, cid: int, op: str) -> None:
        """Remove a grant. Absence of a grant is the denial."""
        self._refs.pop((cid, op), None)

    def revoke_all(self, cid: int) -> None:
        """Drop every grant for a session, at session close."""
        for key in [key for key in self._refs if key[0] == cid]:
            del self._refs[key]

    def allows(self, cid: int, op: str) -> bool:
        """True when `(cid, op)` has a grant."""
        return (cid, op) in self._refs

    def resolve_ref(self, cid: int, op: str) -> str:
        """The host routing token for `(cid, op)`, or raise `DeniedError`.

        The token is resolved *from this table*. It is never read from a request:
        a guest-echoed routing token is the confused-deputy path.
        """
        try:
            return self._refs[(cid, op)]
        except KeyError:
            raise DeniedError(f"op {op!r} is not granted to this session") from None


# ---------------------------------------------------------------------------
# Backend contract
# ---------------------------------------------------------------------------


@dataclass
class ResultSet:
    """A host-side query result. Never crosses the seam as-is.

    `rows` stay host-side as the referent of a handle; only `rowcount` and
    `schema` — a column description, not a value — accompany the handle back to
    the guest.
    """

    rows: list[list] = field(default_factory=list)
    schema: list[dict] = field(default_factory=list)
    rowcount: int = 0


class DBBackend(Protocol):
    """The host-side client holder: real driver, real credentials, real route.

    Implementations own the session settings the broker cannot reach from here:
    the Postgres `NOSUPERUSER` read-only role and its server-side
    `statement_timeout`, and the Bolt session's `default_access_mode = READ`
    (INTERFACES section 5, the Postgres and Neo4j control tables). Those are the
    primary controls and this protocol does not enforce them; it only fixes the
    call shape the broker uses.

    An implementation may *declare* its posture with a `read_only: bool` or an
    `access_mode: str` attribute. Where it does, `Broker.__init__` refuses a
    declaration that contradicts policy. A declaration is not proof the driver
    applied the setting — see the module docstring of the backend that makes one.
    """

    def run_query(self, sql: str, params: list) -> ResultSet: ...

    def run_cypher(self, query: str, params: dict) -> ResultSet: ...


# ---------------------------------------------------------------------------
# JSON hygiene
# ---------------------------------------------------------------------------


def _normalise(value: Any, depth: int = 0) -> Any:
    """Coerce a driver value into something the frame codec can serialise.

    Rows arrive from a real driver carrying `datetime`, `Decimal`, `UUID`, and
    non-finite floats, none of which survive `json.dumps(allow_nan=False)`. The
    frame codec is fail-closed, so an unserialisable row would drop the whole
    response; normalising here keeps the failure out of the wire layer.
    """
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else str(value)
    if depth >= _MAX_NORMALISE_DEPTH:
        return str(value)
    if isinstance(value, (list, tuple)):
        return [_normalise(item, depth + 1) for item in value]
    if isinstance(value, dict):
        return {str(key): _normalise(item, depth + 1) for key, item in value.items()}
    return str(value)


def _json_bytes(value: Any) -> int:
    """Serialised size of an already-normalised value, in bytes."""
    return len(json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8"))


def _digest(blob: str) -> str:
    """The audit line's args digest — a hash, so no argument content is logged."""
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# The broker
# ---------------------------------------------------------------------------


class Broker:
    """Serves the DB seam for one host, keyed by the CID the transport accepted.

    The broker does not listen. A transport reads a frame, reads the peer CID
    from `accept()`, and calls `handle_request(cid, request)`; the CID argument is
    the only identity in play. `handle_request` returns a `v1` response envelope
    for every outcome and raises nothing, so a transport always has a frame to
    write back. Connection-terminal outcomes are recognisable from the error code
    (`errors.ERROR_CLASSES[code].connection_terminal`).
    """

    #: The two operations that return referent content, both metered and audited.
    #: Everything else in the surface returns handles, addresses, or metadata.
    CONTENT_OPS: frozenset[str] = frozenset({"slice", "materialize"})

    #: Ceiling on one request's serialised args; an instance attribute so a
    #: deployment (or a test) can tighten it.
    max_args_bytes: int = MAX_ARGS_BYTES

    def __init__(
        self,
        config: SandboxConfig,
        sessions: "SessionTable",
        handles: "HandleTable",
        byte_ledger: "ByteLedger",
        audit: "AuditLog",
        backends: dict[str, DBBackend],
        dispatch: DispatchTable,
    ) -> None:
        self.config = config
        self.sessions = sessions
        self.handles = handles
        self.byte_ledger = byte_ledger
        self.audit = audit
        self.backends = dict(backends)
        self.dispatch = dispatch
        #: Deny-by-default (policy.ApocAllowlist). The trusted driver replaces it
        #: with the reviewed set when a named tool grants an APOC procedure.
        self.apoc = ApocAllowlist()
        self._check_backend_posture()
        self._handlers = {
            "run_query": self._op_run_query,
            "run_cypher": self._op_run_cypher,
            "resolve_meta": self._op_resolve_meta,
            "slice": self._op_slice,
            "materialize": self._op_materialize,
        }

    # -- construction-time checks -------------------------------------------

    def _check_backend_posture(self) -> None:
        """Refuse a backend whose declared posture contradicts the read-only policy.

        Narrow on purpose. A backend that declares `read_only = False` or an
        `access_mode` other than `READ` is refused here; a backend that declares
        nothing is served, because this check reads a declaration and cannot
        inspect a driver's real session. The enforcing surfaces for the role and
        the access mode are the role and the session themselves.
        """
        for name, backend in self.backends.items():
            read_only = getattr(backend, "read_only", None)
            if read_only is not None and not read_only:
                raise UpstreamError(f"backend {name!r} declares itself not read-only")
            access_mode = getattr(backend, "access_mode", None)
            if access_mode is not None and str(access_mode).upper() != "READ":
                raise UpstreamError(
                    f"backend {name!r} declares access_mode {access_mode!r}, not READ"
                )

    # -- envelope ------------------------------------------------------------

    def handle_request(self, cid: int, request: dict) -> dict:
        """Serve one `v1` request for the session bound to `cid`.

        Order is the control. Identity first (the CID, never the body), then the
        envelope shape, then the refusal of any body-supplied routing token, then
        the args bound, then the op table, then the grant — a backend is not
        touched until every one of those has passed. Anything unparseable,
        oversized, unknown, or ungranted is denied and audited, never
        best-effort executed (INTERFACES section 7, Error model).
        """
        req_id = _safe_req_id(request)
        op = _safe_op(request)
        digest = "unavailable"
        extra: dict[str, Any] = {}
        try:
            session = self.sessions.session_for(cid)
            args = self._validate_envelope(request)
            blob = json.dumps(args, sort_keys=True, default=repr)
            if len(blob.encode("utf-8")) > self.max_args_bytes:
                raise DeniedError(
                    f"args of {len(blob.encode('utf-8'))} bytes exceed the broker "
                    f"bound {self.max_args_bytes}"
                )
            digest = _digest(blob)

            handler = self._handlers.get(op)
            if handler is None and op not in ALGEBRA_OPS:
                raise DeniedError(f"op {op!r} is not a broker operation")

            # Routing token comes from the table, keyed by the accepted CID.
            dispatch_ref = self.dispatch.resolve_ref(cid, op)
            extra["dispatch_ref"] = dispatch_ref

            if handler is None:
                result, handler_extra = self._op_algebra(cid, op, args)
            else:
                result, handler_extra = handler(cid, args, session)
            extra.update(handler_extra)
        except SandboxError as exc:
            self._audit(cid, op, req_id, digest, "denied", extra, error=exc)
            return _error_envelope(req_id, exc)
        except Exception as exc:  # noqa: BLE001 - every fault becomes a taxonomy error
            # The message is the exception *type*, never its text: a driver's
            # error string can echo row values, and that would put content on a
            # path that is neither metered nor meant to carry it.
            wrapped = UpstreamError(f"{type(exc).__name__} from the broker backend")
            self._audit(cid, op, req_id, digest, "error", extra, error=wrapped)
            return _error_envelope(req_id, wrapped)

        try:
            self._audit(cid, op, req_id, digest, "ok", extra)
        except Exception as exc:  # noqa: BLE001 - no unaudited call returns a result
            wrapped = UpstreamError(f"{type(exc).__name__} from the audit log")
            return _error_envelope(req_id, wrapped)
        return {"v": ENVELOPE_VERSION, "req_id": req_id, "ok": True, "result": result}

    def _validate_envelope(self, request: object) -> dict:
        """Check the request's shape and refuse any caller-supplied routing key."""
        if not isinstance(request, dict):
            raise DeniedError(
                f"request must be a JSON object, got {type(request).__name__}"
            )
        if request.get("v") != ENVELOPE_VERSION:
            raise DeniedError(f"unsupported envelope version {request.get('v')!r}")
        raw_req_id = request.get("req_id")
        if not isinstance(raw_req_id, str) or _REQ_ID_RE.match(raw_req_id) is None:
            raise DeniedError("req_id must be a short printable string")
        raw_op = request.get("op")
        if (
            not isinstance(raw_op, str)
            or not 0 < len(raw_op) <= MAX_OP_CHARS
            or not raw_op.isprintable()
        ):
            raise DeniedError("op must be a short printable non-empty string")
        args = request.get("args")
        if not isinstance(args, dict):
            raise DeniedError(
                f"args must be a JSON object, got {type(args).__name__}"
            )
        # Top level only: `params` values belong to the caller's query and are
        # never read for routing, so a Cypher parameter named `session_id` is a
        # legitimate parameter and not an attempt at anything.
        for key in FORBIDDEN_KEYS:
            if key in request or key in args:
                raise DeniedError(
                    f"request carries the caller-supplied key {key!r}; the broker "
                    "routes by the accepted CID and its own dispatch table"
                )
        return args

    def _audit(
        self,
        cid: int,
        op: str,
        req_id: str,
        digest: str,
        decision: str,
        extra: dict[str, Any],
        error: SandboxError | None = None,
    ) -> None:
        """Record one call by CID. Digests and counts only — never argument or row content."""
        fields: dict[str, Any] = {
            "req_id": req_id,
            "args_digest": digest,
            "decision": decision,
            "rows": extra.get("rows", 0),
            "bytes": extra.get("bytes", 0),
        }
        if "dispatch_ref" in extra:
            fields["dispatch_ref"] = extra["dispatch_ref"]
        if "elapsed_ms" in extra:
            fields["elapsed_ms"] = extra["elapsed_ms"]
        if error is not None:
            fields["error_code"] = error.code
            fields["error_message"] = error.message
        self.audit.record(cid, op, **fields)

    # -- operations ----------------------------------------------------------

    def _backend(self, name: str) -> DBBackend:
        backend = self.backends.get(name)
        if backend is None:
            raise UpstreamError(f"no {name} backend is configured on this broker")
        return backend

    def _op_run_query(
        self, cid: int, args: dict, session: Any
    ) -> tuple[dict, dict[str, Any]]:
        """Postgres read: returns a handle and safe metadata. No row crosses here."""
        sql = args.get("sql")
        params = args.get("params", [])
        if not isinstance(params, list):
            raise DeniedError(f"params must be a list, got {type(params).__name__}")
        inspect_sql(sql)
        bound = [self._substitute(cid, item) for item in params]

        backend = self._backend("postgres")
        started = time.monotonic()
        result = backend.run_query(sql, bound)
        elapsed_ms = (time.monotonic() - started) * 1000.0
        self._check_deadline(elapsed_ms, self.config.broker_caps.statement_timeout_ms, "statement")
        return self._land_result(cid, result, elapsed_ms)

    def _op_run_cypher(
        self, cid: int, args: dict, session: Any
    ) -> tuple[dict, dict[str, Any]]:
        """Neo4j read: returns a handle and safe metadata. No row crosses here."""
        query = args.get("query")
        params = args.get("params", {})
        if not isinstance(params, dict):
            raise DeniedError(f"params must be an object, got {type(params).__name__}")
        inspect_cypher(query)
        self.apoc.check(query)
        bound = {key: self._substitute(cid, item) for key, item in params.items()}

        backend = self._backend("neo4j")
        started = time.monotonic()
        result = backend.run_cypher(query, bound)
        elapsed_ms = (time.monotonic() - started) * 1000.0
        self._check_deadline(elapsed_ms, self.config.broker_caps.bolt_timeout_ms, "bolt")
        return self._land_result(cid, result, elapsed_ms)

    def _op_resolve_meta(
        self, cid: int, args: dict, session: Any
    ) -> tuple[dict, dict[str, Any]]:
        """Shape, length, and column schema of a handle's referent. No content."""
        referent = self._referent(cid, args)
        if isinstance(referent, ResultSet):
            shape = [referent.rowcount, len(referent.schema)]
            return (
                {"shape": shape, "length": referent.rowcount, "schema": referent.schema},
                {"rows": 0, "bytes": 0},
            )
        if isinstance(referent, str):
            return ({"shape": ["text", len(referent)], "length": len(referent), "schema": []}, {})
        if isinstance(referent, (list, tuple)):
            return ({"shape": [len(referent)], "length": len(referent), "schema": []}, {})
        raise UpstreamError(
            f"resolve_meta is not defined for a {type(referent).__name__} referent"
        )

    def _op_slice(self, cid: int, args: dict, session: Any) -> tuple[dict, dict[str, Any]]:
        """The bounded, audited, byte-charged path by which rows reach the guest.

        Half-open `[start, end)` (CODE_MEDIATED_TEXT.md section 6 slice
        semantics). The window is capped at `broker_caps.max_rows`, trimmed to
        `byte_caps.inbound_per_call`, flagged `truncated` when either bites, and
        charged against the session's inbound ledger before it is returned. A
        spent ledger raises and nothing crosses.
        """
        referent = self._referent(cid, args)
        start, end = _parse_span(args.get("span"))
        max_rows = self.config.broker_caps.max_rows
        cap = self.config.byte_caps.inbound_per_call

        # `truncated` means the broker returned less than was asked for, never
        # that the referent simply ended before the span did.
        if isinstance(referent, str):
            window = referent[start:end]
            truncated = False
            while window and _json_bytes(window) > cap:
                window = window[: int(len(window) * 0.9)]
                truncated = True
            nbytes = _json_bytes(window)
            self.byte_ledger.charge_inbound(cid, nbytes)
            return ({"text": window, "truncated": truncated}, {"rows": 0, "bytes": nbytes})

        rows = _rows_of(referent)
        truncated = False
        if end - start > max_rows:
            end = start + max_rows
            truncated = True
        window = [_normalise(row) for row in rows[start:end]]
        kept, size = _fit_rows(window, cap)
        truncated = truncated or len(kept) < len(window)
        self.byte_ledger.charge_inbound(cid, size)
        return ({"rows": kept, "truncated": truncated}, {"rows": len(kept), "bytes": size})

    def _op_materialize(
        self, cid: int, args: dict, session: Any
    ) -> tuple[dict, dict[str, Any]]:
        """The whole referent, metered. Refused rather than trimmed when over-cap.

        `slice` is how a caller reads something larger than one call's inbound
        cap; `materialize` either returns the referent whole or returns nothing,
        so a caller cannot mistake a silently trimmed result for the referent.
        """
        referent = self._referent(cid, args)
        cap = self.config.byte_caps.inbound_per_call
        if isinstance(referent, str):
            payload: Any = referent
            key = "text"
            rows = 0
        else:
            payload = [_normalise(row) for row in _rows_of(referent)]
            key = "rows"
            rows = len(payload)
        nbytes = _json_bytes(payload)
        if nbytes > cap:
            raise CapBytesError(
                f"materialize of {nbytes} bytes exceeds the per-call inbound cap "
                f"{cap}; slice it instead"
            )
        self.byte_ledger.charge_inbound(cid, nbytes)
        return ({key: payload, "truncated": False}, {"rows": rows, "bytes": nbytes})

    def _op_algebra(self, cid: int, op: str, args: dict) -> tuple[dict, dict[str, Any]]:
        """Route a handle-algebra op to `algebra.apply_op`.

        The algebra is closed over handles and addresses — handle in, handle or
        bounded address set out (DATA_MODEL section 4) — and that closure is
        `algebra.py`'s contract, not something this broker re-decides. What the
        broker adds is the bound the same section asks for: the result is capped
        at one call's inbound byte allowance and audited by size.

        No evaluator is passed. The two address-returning ops (`locate`,
        `get_ast_blocks`) need host-side referent evaluation that this broker does
        not implement, so they fail closed inside `apply_op` rather than being
        served by an evaluator that would have to guess at a referent's shape.
        """
        if _apply_op is None:
            raise UpstreamError("the handle algebra module is not available on this host")
        result = _apply_op(self.handles, cid, op, args)
        if not isinstance(result, dict):
            raise UpstreamError(
                f"algebra op {op!r} returned {type(result).__name__}, not an object"
            )
        result = _normalise(result)
        nbytes = _json_bytes(result)
        cap = self.config.byte_caps.inbound_per_call
        if nbytes > cap:
            raise CapBytesError(
                f"{op} returned {nbytes} bytes, over the per-call bound {cap}"
            )
        return result, {"bytes": nbytes}

    # -- shared machinery ----------------------------------------------------

    def _check_deadline(self, elapsed_ms: float, budget_ms: int, what: str) -> None:
        """Refuse a result the backend took longer than its budget to produce.

        The cancelling control is server-side: Postgres' `statement_timeout` and
        the Bolt query timeout, both set where the client session is opened. This
        check does not cancel anything — the query has already run. What it does
        is refuse the over-budget result, so a backend whose session timeout was
        never applied cannot quietly return one, and the overrun lands in the
        audit log.
        """
        if elapsed_ms > budget_ms:
            raise TimeoutError_(
                f"{what} took {elapsed_ms:.0f}ms, over the {budget_ms}ms budget"
            )

    def _land_result(
        self, cid: int, result: Any, elapsed_ms: float
    ) -> tuple[dict, dict[str, Any]]:
        """Cap a query result, park it host-side, and return the handle for it."""
        if not isinstance(result, ResultSet):
            raise UpstreamError(
                f"backend returned {type(result).__name__}, not a ResultSet"
            )
        rows = result.rows if isinstance(result.rows, list) else []
        rowcount = result.rowcount if isinstance(result.rowcount, int) else len(rows)
        caps = self.config.broker_caps
        if rowcount > caps.max_rows or len(rows) > caps.max_rows:
            raise DeniedError(
                f"result of {max(rowcount, len(rows))} rows exceeds the row cap "
                f"{caps.max_rows}"
            )
        size = _json_bytes(_normalise(rows))
        if size > caps.max_result_bytes:
            raise DeniedError(
                f"result of {size} bytes exceeds the result byte cap {caps.max_result_bytes}"
            )
        schema = result.schema if isinstance(result.schema, list) else []
        handle = self.handles.allocate(cid, "result-set", result)
        return (
            {
                "handle": {"id": handle.id, "kind": handle.kind},
                "rowcount": rowcount,
                "schema": _normalise(schema),
            },
            {"rows": 0, "bytes": 0, "elapsed_ms": round(elapsed_ms, 3)},
        )

    def _substitute(self, cid: int, value: Any) -> Any:
        """Replace a handle-shaped parameter with its host-side referent.

        A parameter of exactly `{"id": str, "kind": str}` is the wire form of a
        handle (DATA_MODEL section 8). The broker resolves it against its own
        table for the accepted CID and binds the referent into the statement
        host-side, so the guest composes over data it cannot itself read. A
        parameter that looks like a handle and does not resolve is an error, never
        a pass-through.
        """
        if not _is_handle_ref(value):
            return value
        entry = self.handles.resolve(cid, value["id"])
        return getattr(entry, "referent")

    def _referent(self, cid: int, args: dict) -> Any:
        """Resolve the `handle` argument of a content or metadata op, fail-closed."""
        ref = args.get("handle")
        if isinstance(ref, str):
            ref = {"id": ref, "kind": ""}
        if not isinstance(ref, dict) or not isinstance(ref.get("id"), str):
            raise DeniedError("handle must be an object carrying a string id")
        entry = self.handles.resolve(cid, ref["id"])
        return getattr(entry, "referent")


# ---------------------------------------------------------------------------
# Envelope helpers
# ---------------------------------------------------------------------------


def _error_envelope(req_id: str, error: SandboxError) -> dict:
    """The `v1` failure envelope, carrying exactly the spine's error object."""
    return {
        "v": ENVELOPE_VERSION,
        "req_id": req_id,
        "ok": False,
        "error": error.to_error_object(),
    }


def _safe_req_id(request: object) -> str:
    """Extract a `req_id` to echo, defensively.

    Echoed only — never interpreted, never routed on. A missing or malformed id
    still gets a response, because the caller needs to correlate a denial too.
    """
    if isinstance(request, dict):
        raw = request.get("req_id")
        if isinstance(raw, str) and _REQ_ID_RE.match(raw) is not None:
            return raw
    return "invalid"


def _safe_op(request: object) -> str:
    """The op name for the audit line, before validation has run."""
    if isinstance(request, dict):
        raw = request.get("op")
        if isinstance(raw, str) and 0 < len(raw) <= MAX_OP_CHARS and raw.isprintable():
            return raw
    return "invalid"


def _is_handle_ref(value: Any) -> bool:
    """True for the exact wire shape of a handle: `{id, kind}`, both strings."""
    return (
        isinstance(value, dict)
        and set(value) == {"id", "kind"}
        and isinstance(value.get("id"), str)
        and isinstance(value.get("kind"), str)
    )


def _parse_span(span: Any) -> tuple[int, int]:
    """Parse a half-open `[start, end)` span from the wire, fail-closed."""
    if isinstance(span, dict):
        start, end = span.get("start"), span.get("end")
    elif isinstance(span, (list, tuple)) and len(span) == 2:
        start, end = span
    else:
        raise DeniedError("span must be {start, end} or a two-element list")
    if isinstance(start, bool) or isinstance(end, bool):
        raise DeniedError("span bounds must be integers")
    if not isinstance(start, int) or not isinstance(end, int):
        raise DeniedError("span bounds must be integers")
    if start < 0 or end < start:
        raise DeniedError(f"span [{start}, {end}) is not a valid half-open range")
    return start, end


def _rows_of(referent: Any) -> list:
    """The row sequence of a referent, or refuse."""
    if isinstance(referent, ResultSet):
        return referent.rows if isinstance(referent.rows, list) else []
    if isinstance(referent, (list, tuple)):
        return list(referent)
    raise UpstreamError(
        f"a {type(referent).__name__} referent has no rows to return"
    )


def _fit_rows(rows: list, cap: int) -> tuple[list, int]:
    """The longest prefix of `rows` that serialises within `cap` bytes.

    Sized from per-row costs in one pass rather than by re-serialising the whole
    window per dropped row, then confirmed exactly — the returned size is the
    real serialised size of what is returned, because that is what gets charged.
    """
    if not rows:
        return [], _json_bytes([])
    sizes = [_json_bytes(row) + 1 for row in rows]
    total = 2  # the enclosing brackets
    kept = 0
    for size in sizes:
        if total + size > cap:
            break
        total += size
        kept += 1
    prefix = rows[:kept]
    exact = _json_bytes(prefix)
    while prefix and exact > cap:
        prefix = prefix[:-1]
        exact = _json_bytes(prefix)
    return prefix, exact
