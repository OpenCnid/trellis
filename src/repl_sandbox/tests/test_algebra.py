"""The algebra: closed over handles, and provably free of evaluation.

Covers repl_sandbox.algebra against REPL_SANDBOX_DATA_MODEL.md section 4 (The
handle algebra — slice-by-address). The load-bearing test in this file is
`test_handle_ops_never_evaluate_a_referent`: every handle-returning op runs
with an evaluator that raises if it is called at all, and with a referent that
raises if anything reads it.
"""

from __future__ import annotations

import pytest

from repl_sandbox.audit import AuditLog
from repl_sandbox.errors import DeniedError, UpstreamError
from repl_sandbox.handles import HandleTable
from repl_sandbox.algebra import (
    ALGEBRA_OPS,
    HANDLE_OPS,
    MAX_ADDRESS_RESULTS,
    MAX_ARGS_BYTES,
    Derivation,
    apply_op,
)

CID = 42
OTHER_CID = 43
TTL = 100.0


class Clock:
    def __init__(self, start: float = 0.0):
        self.t = start

    def __call__(self) -> float:
        return self.t

    def advance(self, dt: float) -> None:
        self.t += dt


class Referent:
    """A host-resident referent that fails the test if anything reads it."""

    def __iter__(self):
        raise AssertionError("a referent was read by the algebra")

    def __len__(self):
        raise AssertionError("a referent was read by the algebra")

    def __getitem__(self, item):
        raise AssertionError("a referent was read by the algebra")


def exploding_evaluator(entry):
    raise AssertionError("the algebra evaluated a referent")


def make_table(clock: Clock | None = None, audit: AuditLog | None = None) -> HandleTable:
    return HandleTable(TTL, now=clock or Clock(), audit=audit)


def roots(table: HandleTable, kind: str = "table", count: int = 2) -> list[str]:
    return [table.allocate(CID, kind, Referent()).id for _ in range(count)]


def args_for(op: str, handles: list[str]) -> dict:
    """A minimal valid arg set per op, for the sweeps below."""
    if op in ("union", "concat"):
        return {"handles": handles[:2]}
    if op == "join":
        return {"handles": handles[:2], "on": "id"}
    if op == "narrow":
        return {"handle": handles[0], "start": 0, "end": 10}
    if op == "project":
        return {"handle": handles[0], "cols": ["a", "b"]}
    if op == "filter":
        return {"handle": handles[0], "predicate": {"col": "a", "eq": 1}}
    if op in ("search", "vector_search"):
        return {"handle": handles[0], "query": "needle"}
    if op == "locate":
        return {"handle": handles[0], "pattern": "needle"}
    if op == "get_ast_blocks":
        return {"handle": handles[0]}
    raise AssertionError(f"no arg fixture for {op}")


# --- the closure property --------------------------------------------------


def test_handle_ops_never_evaluate_a_referent():
    """Zero content crosses because no referent is ever read. The whole point."""
    table = make_table()
    handles = roots(table)
    for op in HANDLE_OPS:
        result = apply_op(table, CID, op, args_for(op, handles), evaluator=exploding_evaluator)
        assert set(result) == {"handle"}
        assert set(result["handle"]) == {"id", "kind"}


def test_derived_referent_is_a_derivation_node_not_a_value():
    table = make_table()
    parent = table.allocate(CID, "table", Referent())
    result = apply_op(table, CID, "narrow", {"handle": parent.id, "start": 2, "end": 5})
    entry = table.resolve(CID, result["handle"]["id"])
    assert isinstance(entry.referent, Derivation)
    assert entry.referent.op == "narrow"
    assert entry.referent.parents == (parent.id,)
    assert entry.referent.args["start"] == 2 and entry.referent.args["end"] == 5
    assert entry.parents == (parent.id,)


def test_derivations_compose_and_stay_lineage_linked():
    """narrow -> filter -> search, arbitrarily deep, still only tokens in hand."""
    table = make_table()
    root = table.allocate(CID, "text-blocks", Referent())
    narrowed = apply_op(table, CID, "narrow", {"handle": root.id, "start": 0, "end": 100})["handle"]
    searched = apply_op(
        table, CID, "search", {"handle": narrowed["id"], "query": "needle"}
    )["handle"]
    assert searched["kind"] == "result-set"
    # A write under the root invalidates the whole chain.
    assert table.mark_stale(CID, root.id) == 3


def test_output_kind_follows_the_record():
    table = make_table()
    handles = roots(table)
    assert apply_op(table, CID, "narrow", args_for("narrow", handles))["handle"]["kind"] == "table"
    assert apply_op(table, CID, "join", args_for("join", handles))["handle"]["kind"] == "result-set"
    assert (
        apply_op(table, CID, "vector_search", args_for("vector_search", handles))["handle"]["kind"]
        == "result-set"
    )


# --- denial paths ----------------------------------------------------------


def test_unknown_op_denies():
    table = make_table()
    handle = table.allocate(CID, "table", Referent()).id
    with pytest.raises(DeniedError):
        apply_op(table, CID, "materialize", {"handle": handle})
    with pytest.raises(DeniedError):
        apply_op(table, CID, "__import__", {})


def test_slice_is_not_an_algebra_op():
    """`slice` is the broker's metered content path; the algebra's op is `narrow`.

    The two records used one name for two operations, and the collision resolved
    itself by deletion — the algebra's op became unroutable. Keeping the names
    apart is what makes both reachable, so it is asserted rather than assumed.
    """
    assert "narrow" in HANDLE_OPS
    assert "slice" not in ALGEBRA_OPS
    table = make_table()
    handle = table.allocate(CID, "table", Referent()).id
    with pytest.raises(DeniedError):
        apply_op(table, CID, "slice", {"handle": handle, "start": 0, "end": 1})


def test_cross_cid_handle_arg_denies_for_every_op():
    """A leaked token is not usable from another session, op by op."""
    table = make_table()
    handles = roots(table)
    for op in ALGEBRA_OPS:
        with pytest.raises(DeniedError):
            apply_op(table, OTHER_CID, op, args_for(op, handles), evaluator=exploding_evaluator)


def test_dropped_handle_arg_denies():
    table = make_table()
    handle = table.allocate(CID, "table", Referent())
    table.drop(CID, handle.id)
    with pytest.raises(DeniedError):
        apply_op(table, CID, "narrow", {"handle": handle.id, "start": 0, "end": 1})


def test_expired_handle_arg_denies_on_the_injected_clock():
    clock = Clock()
    table = make_table(clock)
    handle = table.allocate(CID, "table", Referent())
    clock.advance(TTL)
    with pytest.raises(DeniedError):
        apply_op(table, CID, "project", {"handle": handle.id, "cols": ["a"]})


def test_stale_handle_arg_denies():
    table = make_table()
    handle = table.allocate(CID, "table", Referent())
    table.mark_stale(CID, handle.id)
    with pytest.raises(DeniedError) as excinfo:
        apply_op(table, CID, "search", {"handle": handle.id, "query": "x"})
    assert excinfo.value.retryable is True


@pytest.mark.parametrize(
    "op,args",
    [
        ("narrow", {"handle": "H", "start": -1}),
        ("narrow", {"handle": "H", "start": 5, "end": 2}),
        ("narrow", {"handle": "H", "end": "3"}),
        ("narrow", {"handle": "H", "step": 2}),
        ("narrow", {"handle": "H", "start": True}),
        ("project", {"handle": "H", "cols": []}),
        ("project", {"handle": "H", "cols": "a"}),
        ("project", {"handle": "H", "cols": [""]}),
        ("filter", {"handle": "H", "predicate": 7}),
        ("filter", {"handle": "H", "predicate": {}}),
        ("filter", {"handle": "H"}),
        ("join", {"handles": ["H"], "on": "id"}),
        ("join", {"handles": ["H", "H", "H"], "on": "id"}),
        ("join", {"handles": ["H", "H"], "on": 7}),
        ("union", {"handles": ["H"]}),
        ("union", {"handle": "H"}),
        ("search", {"handle": "H", "query": ""}),
        ("search", {"handle": "H", "query": "x", "limit": 0}),
        ("locate", {"handle": "H", "pattern": None}),
        ("get_ast_blocks", {"handle": "H", "limit": -1}),
        ("get_ast_blocks", {"handle": 7}),
    ],
)
def test_malformed_args_deny(op, args):
    """Strict schema: an unknown key, a wrong type, or a bad span is a denial."""
    table = make_table()
    handle = table.allocate(CID, "table", Referent()).id
    filled = {
        key: (handle if value == "H" else value)
        for key, value in args.items()
        if key != "handles"
    }
    if "handles" in args:
        filled["handles"] = [handle if item == "H" else item for item in args["handles"]]
    with pytest.raises(DeniedError):
        apply_op(table, CID, op, filled, evaluator=exploding_evaluator)


def test_non_dict_args_deny():
    table = make_table()
    with pytest.raises(DeniedError):
        apply_op(table, CID, "narrow", ["not", "a", "dict"])


def test_oversized_args_deny():
    """Args ride in from the guest; an unbounded blob is not parked in the table."""
    table = make_table()
    handle = table.allocate(CID, "table", Referent()).id
    with pytest.raises(DeniedError):
        apply_op(
            table,
            CID,
            "filter",
            {"handle": handle, "predicate": {"blob": "x" * (MAX_ARGS_BYTES + 1)}},
        )


def test_unserialisable_args_deny():
    table = make_table()
    handle = table.allocate(CID, "table", Referent()).id
    with pytest.raises(DeniedError):
        apply_op(table, CID, "filter", {"handle": handle, "predicate": {"x": {1, 2}}})


def test_wrong_kind_denies():
    """`kind` selects which ops are valid; a scalar admits none of them."""
    table = make_table()
    scalar = table.allocate(CID, "scalar", Referent()).id
    graph = table.allocate(CID, "graph-view", Referent()).id
    with pytest.raises(DeniedError):
        apply_op(table, CID, "narrow", {"handle": scalar, "start": 0, "end": 1})
    with pytest.raises(DeniedError):
        apply_op(table, CID, "project", {"handle": graph, "cols": ["a"]})


def test_mixed_kinds_deny_for_union():
    table = make_table()
    a = table.allocate(CID, "table", Referent()).id
    b = table.allocate(CID, "text-blocks", Referent()).id
    with pytest.raises(DeniedError):
        apply_op(table, CID, "union", {"handles": [a, b]})


# --- the two address-returning ops -----------------------------------------


def test_locate_without_an_evaluator_denies():
    table = make_table()
    handle = table.allocate(CID, "text-blocks", Referent()).id
    with pytest.raises(DeniedError):
        apply_op(table, CID, "locate", {"handle": handle, "pattern": "x"})


def test_locate_returns_addresses():
    table = make_table()
    handle = table.allocate(CID, "text-blocks", Referent()).id
    result = apply_op(
        table,
        CID,
        "locate",
        {"handle": handle, "pattern": "needle"},
        evaluator=lambda entry: [3, 17, {"start": 40, "end": 46, "block_id": "b7"}],
    )
    assert result == {
        "addresses": [3, 17, {"start": 40, "end": 46, "block_id": "b7"}],
        "truncated": False,
    }


def test_locate_refuses_a_record_carrying_matched_content():
    """The field this rejects is exactly the one that would leak the match."""
    table = make_table()
    handle = table.allocate(CID, "text-blocks", Referent()).id
    with pytest.raises(DeniedError) as excinfo:
        apply_op(
            table,
            CID,
            "locate",
            {"handle": handle, "pattern": "needle"},
            evaluator=lambda entry: [{"start": 0, "end": 4, "text": "the secret line"}],
        )
    assert "not an address" in excinfo.value.message


def test_locate_refuses_an_over_long_address_token():
    """A 'block id' the length of a paragraph is a payload wearing an id's name."""
    table = make_table()
    handle = table.allocate(CID, "text-blocks", Referent()).id
    with pytest.raises(DeniedError):
        apply_op(
            table,
            CID,
            "locate",
            {"handle": handle, "pattern": "x"},
            evaluator=lambda entry: ["b" * 500],
        )


@pytest.mark.parametrize("bad", [[-1], [1.5], [None], [True], [{"start": -2}], [{"start": 1.5}]])
def test_locate_refuses_non_address_values(bad):
    table = make_table()
    handle = table.allocate(CID, "text-blocks", Referent()).id
    with pytest.raises(DeniedError):
        apply_op(
            table,
            CID,
            "locate",
            {"handle": handle, "pattern": "x"},
            evaluator=lambda entry: bad,
        )


def test_locate_is_bounded_in_result_count():
    table = make_table()
    handle = table.allocate(CID, "text-blocks", Referent()).id
    result = apply_op(
        table,
        CID,
        "locate",
        {"handle": handle, "pattern": "x"},
        evaluator=lambda entry: range(MAX_ADDRESS_RESULTS + 50),
    )
    assert len(result["addresses"]) == MAX_ADDRESS_RESULTS
    assert result["truncated"] is True


def test_locate_honours_a_smaller_caller_limit():
    table = make_table()
    handle = table.allocate(CID, "text-blocks", Referent()).id
    result = apply_op(
        table,
        CID,
        "locate",
        {"handle": handle, "pattern": "x", "limit": 2},
        evaluator=lambda entry: [1, 2, 3, 4],
    )
    assert result == {"addresses": [1, 2], "truncated": True}


def test_get_ast_blocks_returns_structure_without_text():
    table = make_table()
    handle = table.allocate(CID, "text-blocks", Referent()).id
    result = apply_op(
        table,
        CID,
        "get_ast_blocks",
        {"handle": handle},
        evaluator=lambda entry: [{"block_id": "b1", "type": "paragraph", "byte_len": 412}],
    )
    assert result["blocks"] == [{"block_id": "b1", "type": "paragraph", "byte_len": 412}]
    assert result["truncated"] is False


@pytest.mark.parametrize(
    "block",
    [
        {"block_id": "b1", "type": "paragraph", "byte_len": 4, "content": "the text"},
        {"block_id": "b1", "type": "paragraph"},
        {"block_id": "b1", "type": "paragraph", "byte_len": -1},
        {"block_id": "b1", "type": "", "byte_len": 4},
        {"block_id": 7, "type": "paragraph", "byte_len": 4},
        "not-a-block",
    ],
)
def test_get_ast_blocks_refuses_anything_but_the_three_fields(block):
    table = make_table()
    handle = table.allocate(CID, "text-blocks", Referent()).id
    with pytest.raises(DeniedError):
        apply_op(
            table,
            CID,
            "get_ast_blocks",
            {"handle": handle},
            evaluator=lambda entry: [block],
        )


def test_evaluator_failure_does_not_surface_its_message():
    """An upstream message can quote the row that caused it, so it is not passed on."""
    table = make_table()
    handle = table.allocate(CID, "text-blocks", Referent()).id

    def boom(entry):
        raise RuntimeError("row 7 value 'patient name redacted' violated constraint")

    with pytest.raises(UpstreamError) as excinfo:
        apply_op(table, CID, "locate", {"handle": handle, "pattern": "x"}, evaluator=boom)
    assert "patient name" not in excinfo.value.message


def test_evaluator_returning_a_scalar_denies():
    table = make_table()
    handle = table.allocate(CID, "text-blocks", Referent()).id
    with pytest.raises(UpstreamError):
        apply_op(
            table,
            CID,
            "locate",
            {"handle": handle, "pattern": "x"},
            evaluator=lambda entry: "0,4,9",
        )


# --- audit ------------------------------------------------------------------


def test_derivations_and_denials_are_audited():
    audit = AuditLog()
    table = make_table(audit=audit)
    handle = table.allocate(CID, "table", Referent()).id
    apply_op(table, CID, "narrow", {"handle": handle, "start": 0, "end": 4})
    with pytest.raises(DeniedError):
        apply_op(table, CID, "nope", {})
    ops = audit.ops()
    assert "algebra.derive" in ops
    assert ops[-1] == "algebra.denied"


def test_address_returns_are_audited_with_their_count():
    audit = AuditLog()
    table = make_table(audit=audit)
    handle = table.allocate(CID, "text-blocks", Referent()).id
    apply_op(
        table,
        CID,
        "locate",
        {"handle": handle, "pattern": "x", "limit": 2},
        evaluator=lambda entry: [1, 2, 3],
    )
    entry = audit.entries()[-1]
    assert entry["op"] == "algebra.locate"
    assert entry["returned"] == 2
    assert entry["truncated"] is True
