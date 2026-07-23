"""Tests for the S4 probe's host-side logic — the half that needs no `/dev/kvm`.

`scripts/repl_sandbox_s4_probe.py` runs only on the provisioned Kata host with a
real Postgres, so without these it would be a few hundred lines that nobody on a
development box ever executes, and every mistake in its *verdict* logic would
surface as a confusing failure in the middle of a host run. What is under test
here is everything the probe decides: the five assessors that turn a guest report
into a pass/fail, the credential grep and its planted-canary positive control, and
— the strongest check available off-host — the whole shipping host-side chain
(broker, `policy.inspect_sql`, handle table, `guest_rpc` translation) driven end
to end over the loopback transport, so a guest that runs `run_query` then
`materialize` gets the fixture rows back and a write comes back denied, all without
a VM anywhere.

Three things this file deliberately does **not** test, because they cannot be
tested here and pretending otherwise is the failure mode the probe exists to
avoid: that a frame crosses a VM boundary; that Cloud Hypervisor's hybrid vsock
delivers it on the DB port; and that a real Postgres role refuses a real write.
The first two need a host with KVM; the third needs a real server. The loopback
run below is a **test double, not a boundary** (`transport.LoopbackListener`).
"""

from __future__ import annotations

import ast
import importlib.util
import threading
from pathlib import Path

import pytest

from repl_sandbox.audit import AuditLog
from repl_sandbox.broker import ResultSet
from repl_sandbox.config import SandboxConfig
from repl_sandbox.errors import DeniedError, SandboxError
from repl_sandbox.guest_rpc import GuestRpc
from repl_sandbox.host import TrellisSandboxHost
from repl_sandbox.transport import LoopbackListener, serve_forever

PROBE_PATH = (
    Path(__file__).resolve().parents[3] / "scripts" / "repl_sandbox_s4_probe.py"
)


def _load_probe():
    """Import the probe by path — it is a script, not a package module."""
    spec = importlib.util.spec_from_file_location("repl_sandbox_s4_probe", PROBE_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


probe = _load_probe()


# ---------------------------------------------------------------------------
# A good guest report, and the shapes the assessors read
# ---------------------------------------------------------------------------


def _good_guest_report(canary: str = "CANARY-XYZ") -> dict:
    """What the guest prints on a clean crossing. Assessors read this shape."""
    return {
        "run_query_ok": True,
        "handle": {"id": "h1", "kind": "result-set"},
        "rowcount": len(probe.FIXTURE_ROWS),
        "schema": [{"name": "id"}, {"name": "label"}, {"name": "value"}],
        "materialize_ok": True,
        "rows": [list(r) for r in probe.FIXTURE_ROWS],
        "truncated": False,
        "write": {"denied": True, "code": "denied", "message": "sql begins with 'insert'"},
        "escapes": {
            "pg_read_file": {"denied": True, "code": "denied"},
            "copy_to_program": {"denied": True, "code": "denied"},
        },
        "dump": {
            "environ": {"PATH": "/usr/bin", "TRELLIS_S4_CANARY": canary},
            "environ_raw": f"PATH=/usr/bin\x00TRELLIS_S4_CANARY={canary}\x00",
            "cmdline": f"python3\x00guest_db.py\x00--canary\x00{canary}",
            "argv": ["guest_db.py", "--canary", canary],
            "globals_repr": "{'VMADDR_CID_HOST': 2}",
            "surfaces_scanned": ["os.environ", "/proc/self/environ"],
            "surfaces_not_scanned": ["raw process heap (not portable from Python)"],
        },
    }


# ---------------------------------------------------------------------------
# assess_read — the crossing is the witness's to prove
# ---------------------------------------------------------------------------


def test_read_passes_when_rows_match_and_the_witness_counted_two() -> None:
    failures: list[str] = []
    probe.assess_read(_good_guest_report(), witness_accepted=5, failures=failures)
    assert failures == []


def test_read_fails_when_the_witness_saw_nothing_even_if_rows_are_right() -> None:
    """The negative control's whole point: correct rows, but nothing crossed.

    A guest answering itself produces the fixture rows perfectly; the only thing
    it cannot produce is a connection arriving at the host. `witness_accepted = 0`
    with otherwise-perfect rows is exactly that case, and it must fail.
    """
    failures: list[str] = []
    probe.assess_read(_good_guest_report(), witness_accepted=0, failures=failures)
    assert any("nothing crossed the DB bridge" in f for f in failures)


def test_read_fails_when_rows_are_not_the_fixture() -> None:
    report = _good_guest_report()
    report["rows"] = [[1, "alpha", 10], [2, "beta", 20]]  # a row short
    failures: list[str] = []
    probe.assess_read(report, witness_accepted=5, failures=failures)
    assert any("are not the fixture" in f for f in failures)


def test_read_fails_when_the_handle_is_not_a_result_set() -> None:
    report = _good_guest_report()
    report["handle"] = {"id": "h1", "kind": "text"}
    failures: list[str] = []
    probe.assess_read(report, witness_accepted=5, failures=failures)
    assert any("not a result-set" in f for f in failures)


# ---------------------------------------------------------------------------
# assess_credential — the grep needs its own positive control
# ---------------------------------------------------------------------------


def test_credential_passes_when_canary_present_and_no_secret() -> None:
    failures: list[str] = []
    record = probe.assess_credential(
        _good_guest_report("CANARY-XYZ"),
        secrets_=["postgresql://ro:pw@h/db", "pw"],
        canary="CANARY-XYZ",
        failures=failures,
    )
    assert failures == []
    assert record["canary_found"] is True
    assert record["secret_found"] is False


def test_credential_fails_when_the_grep_cannot_find_its_own_canary() -> None:
    """A grep that matches nothing would pass the real claim by being broken."""
    report = _good_guest_report("CANARY-XYZ")
    failures: list[str] = []
    probe.assess_credential(
        report, secrets_=["pw"], canary="A-DIFFERENT-CANARY", failures=failures
    )
    assert any("did not find the planted canary" in f for f in failures)


def test_credential_fails_when_a_real_secret_is_in_the_guest() -> None:
    report = _good_guest_report("CANARY-XYZ")
    report["dump"]["environ"]["LEAK"] = "postgresql://ro:pw@h/db"
    failures: list[str] = []
    probe.assess_credential(
        report,
        secrets_=["postgresql://ro:pw@h/db", "pw"],
        canary="CANARY-XYZ",
        failures=failures,
    )
    assert any("credential value(s) were found in the guest" in f for f in failures)


def test_credential_assessor_never_returns_the_secret() -> None:
    """The record is printed; it must carry booleans, never the secret itself."""
    report = _good_guest_report("CANARY-XYZ")
    report["dump"]["environ"]["LEAK"] = "sk-super-secret"
    failures: list[str] = []
    record = probe.assess_credential(
        report, secrets_=["sk-super-secret"], canary="CANARY-XYZ", failures=failures
    )
    assert "sk-super-secret" not in repr(record)


# ---------------------------------------------------------------------------
# assess_denials — write and the requirement-9 escapes
# ---------------------------------------------------------------------------


def test_denials_pass_when_write_and_escapes_are_all_refused() -> None:
    failures: list[str] = []
    probe.assess_denials(_good_guest_report(), failures)
    assert failures == []


def test_denials_fail_when_a_write_slips_through() -> None:
    report = _good_guest_report()
    report["write"] = {"denied": False, "note": "the statement was NOT refused"}
    failures: list[str] = []
    probe.assess_denials(report, failures)
    assert any("not denied by the broker" in f for f in failures)


def test_denials_fail_when_an_escape_primitive_slips_through() -> None:
    report = _good_guest_report()
    report["escapes"]["pg_read_file"] = {"denied": False}
    failures: list[str] = []
    probe.assess_denials(report, failures)
    assert any("pg_read_file" in f for f in failures)


# ---------------------------------------------------------------------------
# assess_role_write — the primary control, shown on its own
# ---------------------------------------------------------------------------


def test_role_write_passes_on_a_read_only_refusal() -> None:
    failures: list[str] = []
    record = probe.assess_role_write(
        "ReadOnlySqlTransaction: cannot execute INSERT in a read-only transaction",
        failures,
    )
    assert failures == []
    assert record["role_denied_write"] is True


def test_role_write_fails_when_the_insert_succeeds() -> None:
    """A `None` error means the write went through — the primary control is a lie."""
    failures: list[str] = []
    probe.assess_role_write(None, failures)
    assert any("SUCCEEDED" in f for f in failures)


def test_role_write_fails_on_a_refusal_for_the_wrong_reason() -> None:
    failures: list[str] = []
    probe.assess_role_write("UndefinedTable: relation does not exist", failures)
    assert any("wrong reason" in f for f in failures)


# ---------------------------------------------------------------------------
# assess_egress — the honest weak proxy, and it stays weak
# ---------------------------------------------------------------------------


def test_egress_passes_when_no_network_extension_is_installed() -> None:
    failures: list[str] = []
    record = probe.assess_egress(["plpgsql"], failures)
    assert failures == []
    assert record["sql_egress_extensions_present"] == []


def test_egress_fails_when_dblink_is_installed() -> None:
    failures: list[str] = []
    probe.assess_egress(["plpgsql", "dblink"], failures)
    assert any("network-originating extension" in f for f in failures)


def test_egress_record_labels_itself_as_not_a_boundary() -> None:
    """The claim must never read as a NIC boundary it is not (BUILD_PLAN §6 req 6)."""
    record = probe.assess_egress(["plpgsql"], [])
    assert "not a NIC boundary" in record["note"] or "NIC boundary" in record["note"]
    assert "GB" in record["note"]


# ---------------------------------------------------------------------------
# The guest program is valid Python
# ---------------------------------------------------------------------------


def test_guest_program_compiles() -> None:
    ast.parse(probe.GUEST_DB_SOURCE)


# ---------------------------------------------------------------------------
# End-to-end over the loopback double — the whole host chain, minus the VM
# ---------------------------------------------------------------------------


class _FixtureBackend:
    """A `DBBackend` that returns the fixture, so the chain runs with no Postgres.

    The broker calls `policy.inspect_sql` *before* this, so a write or an escape
    never reaches here — this only ever serves the read. Declares the read-only
    posture the broker checks at construction.
    """

    read_only = True

    def run_query(self, sql: str, params: list) -> ResultSet:
        return ResultSet(
            rows=[list(r) for r in probe.FIXTURE_ROWS],
            schema=[{"name": "id"}, {"name": "label"}, {"name": "value"}],
            rowcount=len(probe.FIXTURE_ROWS),
        )

    def run_cypher(self, query: str, params: dict) -> ResultSet:  # pragma: no cover
        raise SandboxError("this fixture backend serves no cypher")


@pytest.fixture()
def db_over_loopback():
    """The real host chain wired to the loopback double, granting the S4 ops."""
    config = SandboxConfig()
    host = TrellisSandboxHost(
        config=config,
        backends={"postgres": _FixtureBackend()},
        provider=probe.probe.ScriptedProvider(),
        audit=AuditLog(),
    )
    host.open_session(probe.GUEST_CID, "s4-test", ops=probe.GRANTED_OPS, lm=False)
    listener = LoopbackListener(peer_cid=probe.GUEST_CID, read_timeout_s=5.0)
    stop = threading.Event()
    server = threading.Thread(
        target=serve_forever,
        args=(listener, host.broker_handler, config.max_frame_len, None, stop),
        daemon=True,
    )
    server.start()
    rpc = GuestRpc({"DB_PORT": listener.client()}, config.max_frame_len)
    try:
        yield rpc
    finally:
        stop.set()
        listener.close()
        server.join(timeout=5.0)
        host.close()


def _run_query(rpc, sql: str) -> dict:
    return rpc("DB_PORT", {"v": 1, "req_id": "r", "op": "run_query",
                           "args": {"sql": sql, "params": []}})


def test_guest_flow_reads_the_fixture_rows_through_the_real_chain(db_over_loopback) -> None:
    """run_query → handle → materialize → the fixture rows, through the shipping code.

    This is the whole point of S4 exercised without a VM: the guest's calling
    convention, the broker's dispatch and inspection, the handle table, and the
    metered `materialize` sink. Only the boundary is a double.
    """
    rpc = db_over_loopback
    opened = _run_query(rpc, probe.READ_SQL)
    assert opened["handle"]["kind"] == "result-set"
    assert opened["rowcount"] == len(probe.FIXTURE_ROWS)

    got = rpc("DB_PORT", {"v": 1, "req_id": "m", "op": "materialize",
                          "args": {"handle": opened["handle"]}})
    assert got["rows"] == [list(r) for r in probe.FIXTURE_ROWS]
    assert got["truncated"] is False


def test_the_write_is_denied_by_the_broker_before_any_backend(db_over_loopback) -> None:
    with pytest.raises(DeniedError):
        _run_query(db_over_loopback, probe.WRITE_SQL)


def test_the_escape_primitives_are_denied_by_the_broker(db_over_loopback) -> None:
    for sql in probe.ESCAPE_SQLS.values():
        with pytest.raises(DeniedError):
            _run_query(db_over_loopback, sql)


def test_an_ungranted_op_has_no_route(db_over_loopback) -> None:
    """`slice` was not granted, so there is no dispatch entry and no path.

    Denial is structural: the session was opened with `run_query` and
    `materialize` only, so `slice` is refused before any handle work.
    """
    with pytest.raises(SandboxError):
        rpc = db_over_loopback
        rpc("DB_PORT", {"v": 1, "req_id": "s", "op": "slice",
                        "args": {"handle": {"id": "x", "kind": "result-set"},
                                 "span": {"start": 0, "end": 1}}})
