"""The handle algebra: handle in, handle out, zero content.

Source of truth: docs/product/repl-sandbox/REPL_SANDBOX_DATA_MODEL.md section 4
(The handle algebra — slice-by-address, the pillar applied), with the
"addresses, not matched content" rule from CODE_MEDIATED_TEXT.md section 2
(The discipline) clause 4 and the block accessor of its section 6.

The algebra is the *unmetered* path, and it is unmetered precisely because
nothing value-bearing moves along it. `apply_op` composes derivations without
ever touching a referent: the new handle's referent is a `Derivation` node
recording `(op, parent ids, args)`, which the broker evaluates later,
host-side, at a sink. The model can compose `narrow -> filter -> join -> search`
arbitrarily deep while holding only opaque tokens.

The window op here is `narrow`, not `slice`. `slice` is the broker's metered
content path (INTERFACES section 5, DB-broker RPC surface), which returns
`{rows|text, truncated}`; `narrow` is this algebra's closed op, which returns a
handle and moves nothing. They are different operations and now have different
names, so both are routable from the guest.

That "never touches a referent" is testable, and it is tested: an evaluator
that raises on any call is passed through every handle-returning op.

Two ops are different, and are the only two: `locate` returns addresses and
`get_ast_blocks` returns block structure. Both need a host-side evaluation, so
both take the `evaluator` callback — and both are bounded in result count and
audited, because an address set is low-bandwidth information rather than none
(DATA_MODEL section 4, section 6 "Low-bandwidth side channels"). Their results
are validated field by field against an address allowlist: a record carrying
anything that is not an address is refused whole, never trimmed and returned.
A trimmed result is a result that leaked whatever the trimmer did not know to
look for.

Arg validation is strict-schema and fail-closed: an unknown op, an unknown key,
a wrong type, or an oversized arg blob is `DeniedError`, never a best-effort
interpretation (INTERFACES section 7, Error model).
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Callable

from repl_sandbox.errors import DeniedError, SandboxError, UpstreamError
from repl_sandbox.handles import Handle, HandleEntry, HandleTable

#: Ops that take handles and return a handle. No content crosses; no referent
#: is evaluated.
HANDLE_OPS: tuple[str, ...] = (
    "narrow",
    "project",
    "filter",
    "join",
    "union",
    "concat",
    "search",
    "vector_search",
)

#: Ops that return engine-computed addresses. Bounded in count and audited.
ADDRESS_OPS: tuple[str, ...] = ("locate", "get_ast_blocks")

#: The closed op set of DATA_MODEL section 4.
ALGEBRA_OPS: tuple[str, ...] = HANDLE_OPS + ADDRESS_OPS

#: Host-side referent evaluation, supplied by the broker. Called *only* for the
#: two address-returning ops.
Evaluator = Callable[[HandleEntry], object]

#: Ceiling on the JSON size of one op's args. Args arrive over the wire from
#: the guest; an unbounded arg blob is a memory-exhaustion path and a place to
#: park bytes inside the handle table.
MAX_ARGS_BYTES = 16 * 1024

#: Result-count ceilings for the two address-returning ops.
MAX_ADDRESS_RESULTS = 1024
MAX_BLOCK_RESULTS = 1024

#: Shape bounds on individual arg and result values.
MAX_QUERY_CHARS = 4096
MAX_NAME_CHARS = 128
MAX_COLUMNS = 256
MAX_ARITY = 32
MAX_ADDRESS_TOKEN_CHARS = 128
MAX_BLOCK_TYPE_CHARS = 64

#: The only field names an address record may carry. Every one of them is an
#: engine-computed position or length; none of them is a value. A record with a
#: key outside this set is refused — this is the surface that enforces
#: "addresses, never matched content".
ADDRESS_FIELDS: frozenset[str] = frozenset(
    {"index", "block_id", "start", "end", "line", "byte_offset", "byte_len", "type"}
)

#: `get_ast_blocks` returns exactly this shape per block, and no text.
BLOCK_FIELDS: frozenset[str] = frozenset({"block_id", "type", "byte_len"})

#: Which `kind`s each op accepts. `scalar` accepts none: a scalar is already a
#: value, and the way to see a value is the metered sink, not the algebra.
_INPUT_KINDS: dict[str, tuple[str, ...]] = {
    "narrow": ("table", "result-set", "text-blocks"),
    "project": ("table", "result-set"),
    "filter": ("table", "result-set", "graph-view"),
    "join": ("table", "result-set"),
    "union": ("table", "result-set", "text-blocks", "graph-view"),
    "concat": ("table", "result-set", "text-blocks"),
    "search": ("table", "result-set", "text-blocks", "graph-view"),
    "vector_search": ("table", "result-set", "text-blocks", "graph-view"),
    "locate": ("table", "result-set", "text-blocks", "graph-view"),
    "get_ast_blocks": ("text-blocks", "graph-view"),
}

#: Ops whose output kind is fixed rather than inherited from the input.
_FIXED_OUTPUT_KIND: dict[str, str] = {
    "join": "result-set",
    "search": "result-set",
    "vector_search": "result-set",
}

#: Strict arg schemas: op -> (required keys, optional keys).
_ARG_KEYS: dict[str, tuple[frozenset[str], frozenset[str]]] = {
    "narrow": (frozenset({"handle"}), frozenset({"start", "end"})),
    "project": (frozenset({"handle", "cols"}), frozenset()),
    "filter": (frozenset({"handle", "predicate"}), frozenset()),
    "join": (frozenset({"handles", "on"}), frozenset()),
    "union": (frozenset({"handles"}), frozenset()),
    "concat": (frozenset({"handles"}), frozenset()),
    "search": (frozenset({"handle", "query"}), frozenset({"limit"})),
    "vector_search": (frozenset({"handle", "query"}), frozenset({"limit"})),
    "locate": (frozenset({"handle", "pattern"}), frozenset({"limit"})),
    "get_ast_blocks": (frozenset({"handle"}), frozenset({"limit"})),
}


@dataclass(frozen=True)
class Derivation:
    """The referent of a derived handle: what to compute, not what was computed.

    Holds parent ids and validated args only. It is deliberately not a closure
    over a value and not a cached result — building one costs no evaluation,
    which is what keeps the algebra free of content.
    """

    op: str
    parents: tuple[str, ...]
    args: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        """Host-side rendering, for the broker's evaluator and for audit."""
        return {"op": self.op, "parents": list(self.parents), "args": dict(self.args)}


def apply_op(
    table: HandleTable,
    cid: int,
    op: str,
    args: dict,
    evaluator: Evaluator | None = None,
) -> dict:
    """Apply one algebra op for a session, returning a handle or addresses.

    Handle-returning ops never call `evaluator`. Address-returning ops require
    it, bound their result count, and validate every returned field.
    """
    if not isinstance(op, str) or op not in ALGEBRA_OPS:
        _audit(table, cid, "algebra.denied", algebra_op=op, reason="unknown_op")
        raise DeniedError(f"unknown algebra op {op!r}")

    checked = _check_args(table, cid, op, args)

    if op in HANDLE_OPS:
        return _apply_handle_op(table, cid, op, checked)
    return _apply_address_op(table, cid, op, checked, evaluator)


# ---------------------------------------------------------------------------
# Handle-returning ops
# ---------------------------------------------------------------------------


def _apply_handle_op(table: HandleTable, cid: int, op: str, args: dict) -> dict:
    """Compose a derivation. No referent is read; no content exists to cross."""
    parents = _parent_ids(args)
    entries = [table.resolve(cid, parent) for parent in parents]
    kinds = _check_kinds(table, cid, op, entries)

    if op in _FIXED_OUTPUT_KIND:
        out_kind = _FIXED_OUTPUT_KIND[op]
    else:
        out_kind = kinds[0]

    handle: Handle = table.allocate(
        cid,
        out_kind,
        Derivation(op=op, parents=parents, args=args),
        parents=parents,
    )
    _audit(
        table,
        cid,
        "algebra.derive",
        algebra_op=op,
        parents=len(parents),
        handle=handle.id,
        kind=handle.kind,
    )
    return {"handle": handle.to_wire()}


def _check_kinds(
    table: HandleTable, cid: int, op: str, entries: list[HandleEntry]
) -> list[str]:
    """Enforce the per-op `kind` table, and same-kind arity for union/concat."""
    allowed = _INPUT_KINDS[op]
    kinds = [entry.kind for entry in entries]
    for kind in kinds:
        if kind not in allowed:
            _audit(table, cid, "algebra.denied", algebra_op=op, reason="kind", kind=kind)
            raise DeniedError(f"op {op} does not accept a {kind} handle")
    if op in ("union", "concat", "join") and len(set(kinds)) != 1:
        _audit(table, cid, "algebra.denied", algebra_op=op, reason="mixed_kinds")
        raise DeniedError(f"op {op} requires operands of one kind, got {sorted(set(kinds))}")
    return kinds


# ---------------------------------------------------------------------------
# Address-returning ops
# ---------------------------------------------------------------------------


def _apply_address_op(
    table: HandleTable,
    cid: int,
    op: str,
    args: dict,
    evaluator: Evaluator | None,
) -> dict:
    """Evaluate host-side, then admit only addresses, bounded and audited."""
    entry = table.resolve(cid, args["handle"])
    _check_kinds(table, cid, op, [entry])

    if evaluator is None:
        _audit(table, cid, "algebra.denied", algebra_op=op, reason="no_evaluator")
        raise DeniedError(f"op {op} requires host-side evaluation and none is configured")

    ceiling = MAX_ADDRESS_RESULTS if op == "locate" else MAX_BLOCK_RESULTS
    limit = min(int(args.get("limit", ceiling)), ceiling)

    raw = _evaluate(table, cid, op, entry, evaluator)
    items, truncated = _take(raw, limit, table, cid, op)

    if op == "locate":
        addresses = [_check_address(table, cid, item) for item in items]
        _audit(
            table,
            cid,
            "algebra.locate",
            handle=entry.id,
            returned=len(addresses),
            truncated=truncated,
        )
        return {"addresses": addresses, "truncated": truncated}

    blocks = [_check_block(table, cid, item) for item in items]
    _audit(
        table,
        cid,
        "algebra.get_ast_blocks",
        handle=entry.id,
        returned=len(blocks),
        truncated=truncated,
    )
    return {"blocks": blocks, "truncated": truncated}


def _evaluate(
    table: HandleTable, cid: int, op: str, entry: HandleEntry, evaluator: Evaluator
) -> object:
    """Call the broker's evaluator, converting a raw failure into a sandbox error.

    A raw exception message can quote the data that caused it, so an upstream
    failure is reported by class, not by text. The original is chained for the
    host's own traceback and never rendered toward the guest.
    """
    try:
        return evaluator(entry)
    except SandboxError:
        raise
    except Exception as exc:  # noqa: BLE001 - message may quote host-resident content
        _audit(table, cid, "algebra.denied", algebra_op=op, reason="evaluator_failed")
        raise UpstreamError(f"host-side evaluation of {op} failed") from exc


def _take(
    raw: object, limit: int, table: HandleTable, cid: int, op: str
) -> tuple[list, bool]:
    """Take at most `limit` items, reporting whether more were available."""
    if isinstance(raw, (str, bytes, bytearray, dict)) or not isinstance(raw, Iterable):
        _audit(table, cid, "algebra.denied", algebra_op=op, reason="evaluator_shape")
        raise UpstreamError(f"{op} evaluation must yield a sequence of records")
    items: list = []
    truncated = False
    for item in raw:
        if len(items) == limit:
            truncated = True
            break
        items.append(item)
    return items, truncated


def _check_address(table: HandleTable, cid: int, item: object) -> object:
    """Admit one address, or refuse the whole call.

    An int is a position, a str is an engine-computed id, a mapping is a record
    of positions. Every other shape — and every field name outside
    `ADDRESS_FIELDS` — is refused, because the field this rejects is the one
    carrying matched content.
    """
    if isinstance(item, bool):
        _deny_address(table, cid, "locate", "address_type")
    if isinstance(item, int):
        if item < 0:
            _deny_address(table, cid, "locate", "negative_address")
        return item
    if isinstance(item, str):
        return _check_address_token(table, cid, "locate", item)
    if isinstance(item, dict):
        record: dict = {}
        for key, value in item.items():
            if key not in ADDRESS_FIELDS:
                _deny_address(table, cid, "locate", f"non_address_field:{key}")
            record[key] = _check_address_value(table, cid, "locate", value)
        return record
    _deny_address(table, cid, "locate", "address_type")
    raise AssertionError("unreachable")  # pragma: no cover


def _check_address_value(table: HandleTable, cid: int, op: str, value: object) -> object:
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        _deny_address(table, cid, op, "address_field_type")
    if isinstance(value, int):
        if value < 0:
            _deny_address(table, cid, op, "negative_address")
        return value
    return _check_address_token(table, cid, op, value)


def _check_address_token(table: HandleTable, cid: int, op: str, value: str) -> str:
    """A block-id is a short token. A long one is a payload wearing an id's name."""
    if not value or len(value) > MAX_ADDRESS_TOKEN_CHARS:
        _deny_address(table, cid, op, "address_token_length")
    return value


def _check_block(table: HandleTable, cid: int, item: object) -> dict:
    """Admit one `{block_id, type, byte_len}` record, exactly and only."""
    if not isinstance(item, dict):
        _deny_address(table, cid, "get_ast_blocks", "block_type")
    keys = set(item)
    if keys != BLOCK_FIELDS:
        extra = sorted(keys - BLOCK_FIELDS)
        reason = f"non_block_field:{extra[0]}" if extra else "missing_block_field"
        _deny_address(table, cid, "get_ast_blocks", reason)
    block_id = item["block_id"]
    block_type = item["type"]
    byte_len = item["byte_len"]
    if not isinstance(block_id, str):
        _deny_address(table, cid, "get_ast_blocks", "block_id_type")
    _check_address_token(table, cid, "get_ast_blocks", block_id)
    if not isinstance(block_type, str) or not block_type or len(block_type) > MAX_BLOCK_TYPE_CHARS:
        _deny_address(table, cid, "get_ast_blocks", "block_type_value")
    if isinstance(byte_len, bool) or not isinstance(byte_len, int) or byte_len < 0:
        _deny_address(table, cid, "get_ast_blocks", "byte_len_value")
    return {"block_id": block_id, "type": block_type, "byte_len": byte_len}


def _deny_address(table: HandleTable, cid: int, op: str, reason: str) -> None:
    _audit(table, cid, "algebra.denied", algebra_op=op, reason=reason)
    raise DeniedError(f"{op} returned a record that is not an address ({reason})")


# ---------------------------------------------------------------------------
# Arg validation
# ---------------------------------------------------------------------------


def _check_args(table: HandleTable, cid: int, op: str, args: dict) -> dict:
    """Strict-schema validation. Unknown keys and wrong types are denials."""
    if not isinstance(args, dict):
        _deny_args(table, cid, op, "args must be an object")
    _check_args_size(table, cid, op, args)

    required, optional = _ARG_KEYS[op]
    keys = set(args)
    missing = required - keys
    if missing:
        _deny_args(table, cid, op, f"missing arg(s) {sorted(missing)}")
    unknown = keys - required - optional
    if unknown:
        _deny_args(table, cid, op, f"unknown arg(s) {sorted(unknown)}")

    checked = dict(args)
    if "handle" in required:
        checked["handle"] = _check_handle_id(table, cid, op, args["handle"])
    if "handles" in required:
        checked["handles"] = _check_handle_list(table, cid, op, args["handles"])
    if "limit" in args:
        checked["limit"] = _check_limit(table, cid, op, args["limit"])

    if op == "narrow":
        checked["start"], checked["end"] = _check_span(table, cid, args)
    elif op == "project":
        checked["cols"] = _check_cols(table, cid, args["cols"])
    elif op == "filter":
        checked["predicate"] = _check_predicate(table, cid, args["predicate"])
    elif op == "join":
        checked["on"] = _check_on(table, cid, args["on"])
    elif op in ("search", "vector_search"):
        checked["query"] = _check_text(table, cid, op, args["query"], "query")
    elif op == "locate":
        checked["pattern"] = _check_text(table, cid, op, args["pattern"], "pattern")
    return checked


def _check_args_size(table: HandleTable, cid: int, op: str, args: dict) -> None:
    """Args ride in over the JSON wire; anything that will not serialise is malformed."""
    try:
        encoded = json.dumps(args, allow_nan=False)
    except (TypeError, ValueError):
        _deny_args(table, cid, op, "args are not JSON-representable")
        return
    if len(encoded.encode("utf-8")) > MAX_ARGS_BYTES:
        _deny_args(table, cid, op, f"args exceed {MAX_ARGS_BYTES} bytes")


def _parent_ids(args: dict) -> tuple[str, ...]:
    if "handles" in args:
        return tuple(args["handles"])
    return (args["handle"],)


def _check_handle_id(table: HandleTable, cid: int, op: str, value: object) -> str:
    if not isinstance(value, str) or not value:
        _deny_args(table, cid, op, "handle must be a non-empty string")
    return value  # type: ignore[return-value]


def _check_handle_list(table: HandleTable, cid: int, op: str, value: object) -> tuple[str, ...]:
    if not isinstance(value, (list, tuple)):
        _deny_args(table, cid, op, "handles must be a list")
    arity = len(value)  # type: ignore[arg-type]
    if op == "join" and arity != 2:
        _deny_args(table, cid, op, "join takes exactly two handles")
    if arity < 2 or arity > MAX_ARITY:
        _deny_args(table, cid, op, f"handles must number 2..{MAX_ARITY}, got {arity}")
    return tuple(_check_handle_id(table, cid, op, item) for item in value)  # type: ignore[union-attr]


def _check_span(table: HandleTable, cid: int, args: dict) -> tuple[int, int | None]:
    """`[start, end)` half-open, Python-slice semantics, non-negative only.

    A negative index is an address whose meaning depends on a length the guest
    does not have and the host would have to reveal. Addresses stay
    engine-computed, so negatives are refused rather than normalised.
    """
    start = args.get("start", 0)
    end = args.get("end", None)
    if isinstance(start, bool) or not isinstance(start, int) or start < 0:
        _deny_args(table, cid, "narrow", "start must be a non-negative integer")
    if end is not None:
        if isinstance(end, bool) or not isinstance(end, int) or end < 0:
            _deny_args(table, cid, "narrow", "end must be a non-negative integer or null")
        if end < start:
            _deny_args(table, cid, "narrow", "end must not precede start")
    return start, end  # type: ignore[return-value]


def _check_cols(table: HandleTable, cid: int, value: object) -> list[str]:
    if not isinstance(value, (list, tuple)) or not value:
        _deny_args(table, cid, "project", "cols must be a non-empty list")
    if len(value) > MAX_COLUMNS:  # type: ignore[arg-type]
        _deny_args(table, cid, "project", f"cols exceed the {MAX_COLUMNS} column ceiling")
    for col in value:  # type: ignore[union-attr]
        if not isinstance(col, str) or not col or len(col) > MAX_NAME_CHARS:
            _deny_args(table, cid, "project", "each column must be a bounded non-empty string")
    return list(value)  # type: ignore[arg-type]


def _check_predicate(table: HandleTable, cid: int, value: object) -> object:
    """A structured predicate, or a bounded expression string the broker compiles."""
    if isinstance(value, dict):
        if not value:
            _deny_args(table, cid, "filter", "predicate must not be empty")
        return dict(value)
    if isinstance(value, str):
        if not value or len(value) > MAX_QUERY_CHARS:
            _deny_args(table, cid, "filter", "predicate string must be bounded and non-empty")
        return value
    _deny_args(table, cid, "filter", "predicate must be an object or a string")


def _check_on(table: HandleTable, cid: int, value: object) -> object:
    if isinstance(value, str):
        if not value or len(value) > MAX_NAME_CHARS:
            _deny_args(table, cid, "join", "join key must be a bounded non-empty string")
        return value
    if isinstance(value, (list, tuple)):
        if not value or len(value) > MAX_COLUMNS:
            _deny_args(table, cid, "join", "join key list must be bounded and non-empty")
        for key in value:
            if not isinstance(key, str) or not key or len(key) > MAX_NAME_CHARS:
                _deny_args(table, cid, "join", "each join key must be a bounded non-empty string")
        return list(value)
    if isinstance(value, dict):
        if not value:
            _deny_args(table, cid, "join", "join key mapping must not be empty")
        return dict(value)
    _deny_args(table, cid, "join", "join key must be a string, list, or object")


def _check_text(table: HandleTable, cid: int, op: str, value: object, name: str) -> str:
    if not isinstance(value, str) or not value or len(value) > MAX_QUERY_CHARS:
        _deny_args(table, cid, op, f"{name} must be a non-empty string of at most {MAX_QUERY_CHARS} chars")
    return value  # type: ignore[return-value]


def _check_limit(table: HandleTable, cid: int, op: str, value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        _deny_args(table, cid, op, "limit must be a positive integer")
    return value  # type: ignore[return-value]


def _deny_args(table: HandleTable, cid: int, op: str, reason: str) -> None:
    _audit(table, cid, "algebra.denied", algebra_op=op, reason="malformed_args", detail=reason)
    raise DeniedError(f"{op}: {reason}")


def _audit(table: HandleTable, cid: int, event: str, **fields) -> None:
    """Write through the handle table's log, if the broker configured one.

    The algebra op travels as `algebra_op`: `op` is the audit record's own
    field for the event name and the log will not let a caller shadow it.
    """
    audit = getattr(table, "audit", None)
    if audit is not None:
        audit.record(cid, event, **fields)
