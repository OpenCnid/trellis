"""Tests for the concrete DB backends.

Every test here drives a **recording fake** — a connection, cursor, driver,
session, and transaction that write down what was asked of them and hold no
driver, no socket, and no credential. They are test doubles, not security
surfaces: nothing they do is evidence about what a real driver would do. What
they are evidence for is narrower and is the whole point of this file: that the
backend *issued* the statements the record says it issues, with the values from
`BrokerCaps`, on every checkout.

`postgres_backend_from_env` and `neo4j_backend_from_env` are never called. They
read credentials and open sockets, and neither belongs in a unit test.

The load-bearing test in this file is `test_the_fakes_would_notice_a_control_that
_was_never_applied`. A recording fake that would pass whether or not a setting
was issued proves nothing, so a deliberately crippled backend is run through the
same assertions and the assertions are required to fail.
"""

from __future__ import annotations

import ast
import inspect
import sys
from types import SimpleNamespace
from typing import Any

import pytest

from repl_sandbox import backends
from repl_sandbox.backends import (
    DEFAULT_PG_ROLE,
    FETCH_CHUNK,
    MAX_COLUMN_NAME_CHARS,
    Neo4jBackend,
    PostgresBackend,
    postgres_role_ddl,
)
from repl_sandbox.broker import Broker, ResultSet
from repl_sandbox.config import BrokerCaps
from repl_sandbox.errors import DeniedError, TimeoutError_, UpstreamError

SECRET = "sk-live-0xDEADBEEF-belief-row"
ROLE = "trellis_repl_ro"


# ---------------------------------------------------------------------------
# Recording fakes — Postgres
# ---------------------------------------------------------------------------


class FakePGCursor:
    """Records every statement and hands back whatever its connection was loaded with."""

    def __init__(self, conn: "FakePGConnection") -> None:
        self._conn = conn
        self._pending: list[Any] = []
        self.description: Any = None
        self.closed = False

    def execute(self, sql: str, params: Any = None) -> None:
        self._conn.statements.append((sql, params))
        if sql.strip().upper().startswith("SET "):
            # A session setting; the fake tracks the role the way a real session
            # would, so a pooled checkout can start out wrong.
            if sql.strip().upper().startswith("SET ROLE"):
                self._conn.current_role = sql.split('"')[1]
            return
        if self._conn.raise_on_query is not None:
            raise self._conn.raise_on_query
        self._pending = list(self._conn.rows)
        self.description = self._conn.description

    def fetchmany(self, size: int) -> list:
        self._conn.fetch_calls.append(size)
        chunk, self._pending = self._pending[:size], self._pending[size:]
        return chunk

    def close(self) -> None:
        self.closed = True
        self._conn.cursor_closes += 1


class FakePGConnection:
    """A DBAPI-shaped recorder. Not a security surface."""

    def __init__(
        self,
        rows: list | None = None,
        description: Any = None,
        raise_on_query: BaseException | None = None,
        current_role: str | None = None,
    ) -> None:
        self.rows = rows if rows is not None else []
        self.description = description
        self.raise_on_query = raise_on_query
        #: What a previous borrower of a pooled connection left behind.
        self.current_role = current_role
        self.statements: list[tuple[str, Any]] = []
        self.events: list[str] = []
        self.fetch_calls: list[int] = []
        self.cursor_closes = 0
        self.closed = 0

    def cursor(self) -> FakePGCursor:
        return FakePGCursor(self)

    def commit(self) -> None:
        self.events.append("commit")

    def rollback(self) -> None:
        self.events.append("rollback")

    def close(self) -> None:
        self.closed += 1

    # -- convenience readers used by the assertions -------------------------

    @property
    def sql(self) -> list[str]:
        return [statement for statement, _ in self.statements]

    @property
    def settings(self) -> list[str]:
        return [s for s in self.sql if s.strip().upper().startswith("SET ")]


def pg_backend(
    conn: FakePGConnection,
    caps: BrokerCaps | None = None,
    role: str | None = ROLE,
) -> PostgresBackend:
    return PostgresBackend(
        connect=lambda: conn, caps=caps or BrokerCaps(), role=role, read_only=True
    )


def assert_session_controls_applied(
    conn: FakePGConnection, caps: BrokerCaps, role: str | None = ROLE
) -> None:
    """The three controls of INTERFACES section 5 (Postgres controls), by exact text.

    Exact rather than substring: a test that accepted any statement mentioning
    `statement_timeout` would pass on `SET SESSION statement_timeout = 0`, which
    is Postgres for "no limit".
    """
    assert f"SET SESSION statement_timeout = {caps.statement_timeout_ms}" in conn.settings
    assert "SET SESSION default_transaction_read_only = on" in conn.settings
    if role is not None:
        assert f'SET ROLE "{role}"' in conn.settings


# ---------------------------------------------------------------------------
# Recording fakes — Neo4j
# ---------------------------------------------------------------------------


class FakeRecord:
    def __init__(self, values: list) -> None:
        self._values = values

    def values(self) -> list:
        return list(self._values)


class FakeBoltResult:
    def __init__(self, keys: list[str], records: Any) -> None:
        self._keys = keys
        self._records = records
        self.consumed = 0

    def keys(self) -> list[str]:
        return list(self._keys)

    def __iter__(self):
        for record in self._records:
            self.consumed += 1
            yield record


class FakeTx:
    def __init__(self, session: "FakeBoltSession", timeout: Any) -> None:
        self._session = session
        self.timeout = timeout
        self.runs: list[tuple[str, dict]] = []
        self.closed = 0

    def run(self, query: str, params: dict | None = None) -> FakeBoltResult:
        self.runs.append((query, dict(params or {})))
        self._session.driver.runs.append((query, dict(params or {})))
        if self._session.driver.raise_on_run is not None:
            raise self._session.driver.raise_on_run
        return self._session.driver.result

    def commit(self) -> None:
        self._session.driver.events.append("tx_commit")

    def close(self) -> None:
        self.closed += 1
        self._session.driver.events.append("tx_close")


class FakeBoltSession:
    def __init__(self, driver: "FakeBoltDriver") -> None:
        self.driver = driver
        self.closed = 0

    def begin_transaction(self, timeout: Any = None, **kwargs: Any) -> FakeTx:
        tx = FakeTx(self, timeout)
        self.driver.transactions.append(tx)
        return tx

    def close(self) -> None:
        self.closed += 1
        self.driver.events.append("session_close")


class FakeBoltDriver:
    """A Bolt-shaped recorder. Not a security surface."""

    def __init__(
        self,
        keys: list[str] | None = None,
        records: Any = (),
        raise_on_run: BaseException | None = None,
    ) -> None:
        self.result = FakeBoltResult(keys or [], records)
        self.raise_on_run = raise_on_run
        self.session_kwargs: list[dict] = []
        self.sessions: list[FakeBoltSession] = []
        self.transactions: list[FakeTx] = []
        self.runs: list[tuple[str, dict]] = []
        self.events: list[str] = []
        self.closed = 0

    def session(self, **kwargs: Any) -> FakeBoltSession:
        self.session_kwargs.append(dict(kwargs))
        session = FakeBoltSession(self)
        self.sessions.append(session)
        return session

    def close(self) -> None:
        self.closed += 1


def neo_backend(
    driver: FakeBoltDriver, caps: BrokerCaps | None = None, database: str | None = None
) -> Neo4jBackend:
    return Neo4jBackend(
        driver_factory=lambda: driver, caps=caps or BrokerCaps(), database=database
    )


def assert_read_session_opened(driver: FakeBoltDriver, caps: BrokerCaps) -> None:
    """Requirement 6's access mode and requirement 7's timeout, as issued."""
    assert driver.session_kwargs, "no Bolt session was ever opened"
    assert driver.session_kwargs[-1]["default_access_mode"] == "READ"
    assert driver.transactions, "no Bolt transaction was ever begun"
    assert driver.transactions[-1].timeout == pytest.approx(caps.bolt_timeout_ms / 1000.0)


# ---------------------------------------------------------------------------
# Postgres: the session controls
# ---------------------------------------------------------------------------


def test_statement_timeout_is_issued_with_the_value_from_caps():
    caps = BrokerCaps(statement_timeout_ms=2_500)
    conn = FakePGConnection(rows=[(1,)], description=[("n", 23)])
    pg_backend(conn, caps).run_query("select 1", [])
    assert "SET SESSION statement_timeout = 2500" in conn.settings


def test_transaction_is_set_read_only():
    conn = FakePGConnection(rows=[], description=[])
    pg_backend(conn).run_query("select 1", [])
    assert "SET SESSION default_transaction_read_only = on" in conn.settings


def test_set_role_is_issued_when_a_role_is_configured():
    conn = FakePGConnection(rows=[], description=[])
    pg_backend(conn, role="analytics_ro").run_query("select 1", [])
    assert 'SET ROLE "analytics_ro"' in conn.settings


def test_no_set_role_when_no_role_is_configured():
    """Absence is correct here: with no role configured there is nothing to drop to,
    and a `SET ROLE` to a guessed name would fail the whole call."""
    conn = FakePGConnection(rows=[], description=[])
    pg_backend(conn, role=None).run_query("select 1", [])
    assert not any(s.upper().startswith("SET ROLE") for s in conn.settings)
    assert_session_controls_applied(conn, BrokerCaps(), role=None)


def test_privileges_are_dropped_after_the_caps_are_set():
    """`SET ROLE` last, so a role too restricted to set a cap cannot be the reason
    the cap went unapplied."""
    conn = FakePGConnection(rows=[], description=[])
    pg_backend(conn).run_query("select 1", [])
    settings = conn.settings
    assert settings.index(f'SET ROLE "{ROLE}"') > settings.index(
        "SET SESSION statement_timeout = 15000"
    )
    assert settings.index(f'SET ROLE "{ROLE}"') > settings.index(
        "SET SESSION default_transaction_read_only = on"
    )


def test_pooled_connection_gets_the_settings_reapplied_per_checkout():
    """A pooled connection carries whatever the last borrower left on it, so the
    settings are re-issued on every checkout rather than inherited from the first."""
    conn = FakePGConnection(rows=[], description=[])
    backend = pg_backend(conn)
    backend.run_query("select 1", [])
    first = list(conn.settings)
    backend.run_query("select 2", [])
    second = conn.settings[len(first) :]
    assert first == second != []
    assert_session_controls_applied(conn, BrokerCaps())


def test_pooled_connection_left_in_another_role_is_not_trusted():
    """The fake starts in a role the previous borrower selected; the checkout must
    put it back rather than assume the session is already where it was left."""
    conn = FakePGConnection(rows=[], description=[], current_role="reporting_rw")
    pg_backend(conn).run_query("select 1", [])
    assert conn.current_role == ROLE


def test_checkout_rolls_back_before_it_sets_and_commits_after():
    """Order is the control. A connection sitting in an aborted transaction fails
    every `SET`; a session-level `SET` inside a transaction that is later rolled
    back is itself rolled back, so the commit is what makes the settings stick."""
    conn = FakePGConnection(rows=[], description=[])
    pg_backend(conn).run_query("select 1", [])
    assert conn.events[0] == "rollback"
    assert conn.events[1] == "commit"


def test_settings_are_applied_before_the_query_runs():
    conn = FakePGConnection(rows=[], description=[])
    pg_backend(conn).run_query("select 1", [])
    assert conn.sql[-1] == "select 1"
    assert all(s.upper().startswith("SET ") for s in conn.sql[:-1])


def test_zero_statement_timeout_is_refused_at_construction():
    """Postgres reads `statement_timeout = 0` as *no limit*, so a cap that arrived
    as zero would read as configured and behave as absent."""
    with pytest.raises(UpstreamError):
        PostgresBackend(
            connect=lambda: FakePGConnection(), caps=BrokerCaps(statement_timeout_ms=0)
        )


@pytest.mark.parametrize(
    "role",
    [
        'x"; SET ROLE postgres; --',
        "role with spaces",
        "role;drop",
        "",
        "x" * 64,
        "1role",
        None.__class__,  # not a string at all
    ],
)
def test_hostile_role_name_is_refused_at_construction(role):
    with pytest.raises(UpstreamError):
        PostgresBackend(connect=lambda: FakePGConnection(), caps=BrokerCaps(), role=role)


# ---------------------------------------------------------------------------
# The control on the control
# ---------------------------------------------------------------------------


def test_the_fakes_would_notice_a_control_that_was_never_applied():
    """A recording fake that passes whether or not a setting was issued proves
    nothing. This runs the same assertions against a backend whose session
    settings are a no-op, and requires them to fail.

    The Bolt half does the same with a driver that was never asked for a session.
    """
    class NeverApplies(PostgresBackend):
        def _apply_session_settings(self, conn: Any) -> None:
            return None

    caps = BrokerCaps()
    conn = FakePGConnection(rows=[], description=[])
    NeverApplies(connect=lambda: conn, caps=caps, role=ROLE).run_query("select 1", [])
    assert conn.settings == []
    with pytest.raises(AssertionError):
        assert_session_controls_applied(conn, caps)

    driver = FakeBoltDriver(keys=[], records=())
    with pytest.raises(AssertionError):
        assert_read_session_opened(driver, caps)


# ---------------------------------------------------------------------------
# Postgres: results and their caps
# ---------------------------------------------------------------------------


def test_rows_and_schema_come_back_as_a_result_set():
    conn = FakePGConnection(rows=[(1, "a"), (2, "b")], description=[("n", 23), ("s", 25)])
    result = pg_backend(conn).run_query("select n, s from t", [])
    assert isinstance(result, ResultSet)
    assert result.rows == [[1, "a"], [2, "b"]]
    assert result.rowcount == 2
    assert result.schema == [
        {"name": "n", "type_code": 23},
        {"name": "s", "type_code": 25},
    ]


def test_params_reach_the_driver_as_bound_parameters():
    conn = FakePGConnection(rows=[], description=[])
    pg_backend(conn).run_query("select %s", [SECRET])
    assert conn.statements[-1] == ("select %s", [SECRET])


def test_row_cap_refuses_an_oversized_result():
    caps = BrokerCaps(max_rows=10)
    conn = FakePGConnection(rows=[(i,) for i in range(50)], description=[("n", 23)])
    with pytest.raises(DeniedError) as excinfo:
        pg_backend(conn, caps).run_query("select n from t", [])
    assert "row cap 10" in str(excinfo.value)


def test_row_cap_refuses_before_the_whole_result_is_drained():
    """Refused at the source: one chunk off the cursor, not fifty thousand rows
    resident in host memory first."""
    caps = BrokerCaps(max_rows=10)
    conn = FakePGConnection(rows=[(i,) for i in range(50_000)], description=[("n", 23)])
    with pytest.raises(DeniedError):
        pg_backend(conn, caps).run_query("select n from t", [])
    assert conn.fetch_calls == [FETCH_CHUNK]


def test_result_byte_cap_refuses_an_oversized_result():
    caps = BrokerCaps(max_result_bytes=64)
    conn = FakePGConnection(rows=[("x" * 40,), ("y" * 40,)], description=[("s", 25)])
    with pytest.raises(DeniedError) as excinfo:
        pg_backend(conn, caps).run_query("select s from t", [])
    assert "byte cap 64" in str(excinfo.value)


def test_a_refused_result_leaks_no_row_content_in_the_message():
    caps = BrokerCaps(max_result_bytes=8)
    conn = FakePGConnection(rows=[(SECRET,)], description=[("s", 25)])
    with pytest.raises(DeniedError) as excinfo:
        pg_backend(conn, caps).run_query("select s from t", [])
    assert SECRET not in str(excinfo.value)


def test_driver_native_values_are_normalised_at_the_source():
    """The referent a handle points at is JSON-safe before it is ever parked, so
    the frame codec cannot be handed something it will fail closed on later."""
    from decimal import Decimal

    conn = FakePGConnection(rows=[(Decimal("1.50"), float("inf"))], description=[])
    result = pg_backend(conn).run_query("select a, b from t", [])
    assert result.rows == [["1.50", "inf"]]


def test_column_names_are_bounded():
    conn = FakePGConnection(rows=[], description=[("c" * 500, 25)])
    schema = pg_backend(conn).run_query("select 1", []).schema
    assert len(schema[0]["name"]) == MAX_COLUMN_NAME_CHARS


# ---------------------------------------------------------------------------
# Postgres: driver failures
# ---------------------------------------------------------------------------


class RowQuotingError(Exception):
    """A driver error that names the offending value, the way real ones do."""


def test_driver_exception_surfaces_as_upstream_with_no_driver_text():
    conn = FakePGConnection(
        raise_on_query=RowQuotingError(f"duplicate key value: ({SECRET})")
    )
    with pytest.raises(UpstreamError) as excinfo:
        pg_backend(conn).run_query("select 1", [])
    message = str(excinfo.value)
    assert SECRET not in message
    assert "duplicate key" not in message
    assert message == "RowQuotingError from the postgres driver"


def test_a_failed_query_rolls_the_connection_back():
    conn = FakePGConnection(raise_on_query=RowQuotingError("boom"))
    with pytest.raises(UpstreamError):
        pg_backend(conn).run_query("select 1", [])
    assert conn.events[-1] == "rollback"


def test_a_hostile_exception_class_name_is_bounded_and_stripped():
    """The class name is the only thing that survives the wrapper, so it is
    stripped to word characters and truncated rather than trusted to be an
    identifier. This bounds what an adversarial driver can put in an audit line;
    it is not a claim that a class name is a content channel — no real driver
    derives one from row data, and the content property is the message test
    above."""
    hostile = type("Err " + "\n=" * 200, (Exception,), {})
    conn = FakePGConnection(raise_on_query=hostile("x"))
    with pytest.raises(UpstreamError) as excinfo:
        pg_backend(conn).run_query("select 1", [])
    name = str(excinfo.value).split(" from ")[0]
    assert name == "Err"
    assert len(name) <= 64
    assert name.isidentifier()


def test_a_server_side_cancellation_is_classified_as_a_timeout():
    """Classification, not enforcement. The enforcing surface is the
    `statement_timeout` that produced the cancellation."""
    cancelled = type("QueryCanceledError", (Exception,), {})
    conn = FakePGConnection(raise_on_query=cancelled("canceling statement"))
    with pytest.raises(TimeoutError_):
        pg_backend(conn).run_query("select pg_sleep(60)", [])


def test_postgres_backend_does_not_serve_cypher():
    with pytest.raises(UpstreamError):
        pg_backend(FakePGConnection()).run_cypher("MATCH (n) RETURN n", {})


def test_close_closes_the_connection():
    conn = FakePGConnection(rows=[], description=[])
    backend = pg_backend(conn)
    backend.run_query("select 1", [])
    backend.close()
    assert conn.closed == 1


# ---------------------------------------------------------------------------
# Neo4j
# ---------------------------------------------------------------------------


def test_session_is_opened_read_with_a_timeout_from_caps():
    caps = BrokerCaps(bolt_timeout_ms=4_000)
    driver = FakeBoltDriver(keys=["n"], records=[FakeRecord([1])])
    neo_backend(driver, caps).run_cypher("MATCH (n) RETURN n", {})
    assert driver.session_kwargs[-1]["default_access_mode"] == "READ"
    assert driver.transactions[-1].timeout == pytest.approx(4.0)
    assert_read_session_opened(driver, caps)


def test_database_is_pinned_when_configured():
    driver = FakeBoltDriver(keys=[], records=())
    neo_backend(driver, database="trellis").run_cypher("MATCH (n) RETURN n", {})
    assert driver.session_kwargs[-1]["database"] == "trellis"


def test_database_is_omitted_when_not_configured():
    driver = FakeBoltDriver(keys=[], records=())
    neo_backend(driver).run_cypher("MATCH (n) RETURN n", {})
    assert "database" not in driver.session_kwargs[-1]


@pytest.mark.parametrize("database", ["no", "bad name", "x" * 64, ".leading", 7])
def test_hostile_database_name_is_refused_at_construction(database):
    with pytest.raises(UpstreamError):
        Neo4jBackend(
            driver_factory=lambda: FakeBoltDriver(), caps=BrokerCaps(), database=database
        )


def test_every_call_opens_its_own_read_session():
    driver = FakeBoltDriver(keys=[], records=())
    backend = neo_backend(driver)
    backend.run_cypher("MATCH (a) RETURN a", {})
    backend.run_cypher("MATCH (b) RETURN b", {})
    assert len(driver.session_kwargs) == 2
    assert all(kwargs["default_access_mode"] == "READ" for kwargs in driver.session_kwargs)


def test_transaction_and_session_are_closed_not_committed():
    driver = FakeBoltDriver(keys=["n"], records=[FakeRecord([1])])
    neo_backend(driver).run_cypher("MATCH (n) RETURN n", {})
    assert driver.events == ["tx_close", "session_close"]


def test_cypher_rows_and_keys_come_back_as_a_result_set():
    driver = FakeBoltDriver(
        keys=["a", "b"], records=[FakeRecord([1, "x"]), FakeRecord([2, "y"])]
    )
    result = neo_backend(driver).run_cypher("MATCH ... RETURN a, b", {})
    assert result.rows == [[1, "x"], [2, "y"]]
    assert result.rowcount == 2
    assert result.schema == [{"name": "a"}, {"name": "b"}]


def test_cypher_params_reach_the_driver():
    driver = FakeBoltDriver(keys=[], records=())
    neo_backend(driver).run_cypher("MATCH (n {k: $k}) RETURN n", {"k": SECRET})
    assert driver.runs[-1] == ("MATCH (n {k: $k}) RETURN n", {"k": SECRET})


def test_cypher_row_cap_refuses_before_the_stream_is_drained():
    caps = BrokerCaps(max_rows=10)

    def records():
        for i in range(50_000):
            yield FakeRecord([i])

    driver = FakeBoltDriver(keys=["n"], records=records())
    with pytest.raises(DeniedError):
        neo_backend(driver, caps).run_cypher("MATCH (n) RETURN n", {})
    assert driver.result.consumed == caps.max_rows + 1


def test_cypher_byte_cap_refuses_an_oversized_result():
    caps = BrokerCaps(max_result_bytes=64)
    driver = FakeBoltDriver(
        keys=["s"], records=[FakeRecord(["x" * 40]), FakeRecord(["y" * 40])]
    )
    with pytest.raises(DeniedError) as excinfo:
        neo_backend(driver, caps).run_cypher("MATCH ... RETURN s", {})
    assert "byte cap 64" in str(excinfo.value)


def test_bolt_driver_exception_surfaces_as_upstream_with_no_driver_text():
    driver = FakeBoltDriver(raise_on_run=RowQuotingError(f"failed on ({SECRET})"))
    with pytest.raises(UpstreamError) as excinfo:
        neo_backend(driver).run_cypher("MATCH (n) RETURN n", {})
    assert SECRET not in str(excinfo.value)
    assert str(excinfo.value) == "RowQuotingError from the neo4j driver"


def test_a_failed_cypher_call_still_closes_its_session():
    driver = FakeBoltDriver(raise_on_run=RowQuotingError("boom"))
    with pytest.raises(UpstreamError):
        neo_backend(driver).run_cypher("MATCH (n) RETURN n", {})
    assert driver.sessions[-1].closed == 1


def test_the_bolt_driver_is_built_once_and_reused():
    driver = FakeBoltDriver(keys=[], records=())
    built = []

    def factory() -> FakeBoltDriver:
        built.append(1)
        return driver

    backend = Neo4jBackend(driver_factory=factory, caps=BrokerCaps())
    backend.run_cypher("MATCH (a) RETURN a", {})
    backend.run_cypher("MATCH (b) RETURN b", {})
    assert len(built) == 1


def test_neo4j_backend_does_not_serve_sql():
    with pytest.raises(UpstreamError):
        neo_backend(FakeBoltDriver()).run_query("select 1", [])


def test_close_closes_the_driver():
    driver = FakeBoltDriver(keys=[], records=())
    backend = neo_backend(driver)
    backend.run_cypher("MATCH (n) RETURN n", {})
    backend.close()
    assert driver.closed == 1


# ---------------------------------------------------------------------------
# Posture declarations
# ---------------------------------------------------------------------------


def test_postures_are_declared_true_and_the_broker_accepts_them():
    """The declaration `Broker.__init__` trusts, checked against the real check.

    `_check_backend_posture` reads only `self.backends`, so it runs here against a
    stand-in without dragging the broker's other collaborators in.
    """
    pg = pg_backend(FakePGConnection())
    neo = neo_backend(FakeBoltDriver())
    assert pg.read_only is True
    assert neo.access_mode == "READ"
    Broker._check_backend_posture(
        SimpleNamespace(backends={"postgres": pg, "neo4j": neo})
    )


def test_a_write_posture_is_refused_at_construction():
    """Refused here rather than declared and refused by the broker: this class
    applies read-only settings unconditionally, so `read_only=False` would be a
    declaration its own session contradicts."""
    with pytest.raises(UpstreamError):
        PostgresBackend(connect=lambda: FakePGConnection(), caps=BrokerCaps(), read_only=False)


@pytest.mark.parametrize("mode", ["WRITE", "write", "read", "", 1])
def test_a_non_read_access_mode_is_refused_at_construction(mode):
    if mode == "read":
        # Case is not the contradiction; a lowercase spelling of READ is accepted
        # and normalised, because what it declares is what the code applies.
        backend = Neo4jBackend(
            driver_factory=lambda: FakeBoltDriver(), caps=BrokerCaps(), access_mode=mode
        )
        assert backend.access_mode == "READ"
        return
    with pytest.raises(UpstreamError):
        Neo4jBackend(
            driver_factory=lambda: FakeBoltDriver(), caps=BrokerCaps(), access_mode=mode
        )


def test_a_non_callable_connector_is_refused_at_construction():
    with pytest.raises(UpstreamError):
        PostgresBackend(connect="postgres://localhost/db", caps=BrokerCaps())
    with pytest.raises(UpstreamError):
        Neo4jBackend(driver_factory="bolt://localhost", caps=BrokerCaps())


# ---------------------------------------------------------------------------
# The deployment obligation this module ships but cannot enforce
# ---------------------------------------------------------------------------


def test_the_role_ddl_names_every_requirement_9_privilege():
    ddl = postgres_role_ddl(BrokerCaps())
    for token in (
        "NOSUPERUSER",
        "pg_read_server_files",
        "pg_execute_server_program",
        "dblink",
    ):
        assert token in ddl


def test_the_role_ddl_carries_the_timeout_from_caps():
    ddl = postgres_role_ddl(BrokerCaps(statement_timeout_ms=7_000))
    assert "statement_timeout = '7000ms'" in ddl
    assert "default_transaction_read_only = on" in ddl


def test_the_role_ddl_emits_set_role_membership_only_for_a_shared_login():
    direct = postgres_role_ddl(BrokerCaps())
    shared = postgres_role_ddl(BrokerCaps(), login_role="trellis_broker")
    assert "GRANT" in shared and f'GRANT "{DEFAULT_PG_ROLE}" TO "trellis_broker"' in shared
    assert 'TO "trellis_broker"' not in direct


@pytest.mark.parametrize("bad", ['x"; DROP DATABASE trellis; --', "a b", "", 3])
def test_the_role_ddl_refuses_a_hostile_identifier(bad):
    with pytest.raises(UpstreamError):
        postgres_role_ddl(BrokerCaps(), role=bad)


def test_the_module_claims_no_grant_it_cannot_make():
    """A documented bound with no engine behind it is not a control, so the
    docstring has to say which half of requirement 9 lives in the database."""
    doc = backends.__doc__ or ""
    assert "cannot" in doc
    assert "postgres_role_ddl" in doc


# ---------------------------------------------------------------------------
# Import safety
# ---------------------------------------------------------------------------


def test_no_driver_is_imported_at_module_scope():
    """This module must import on a host with neither driver installed, which is
    the host these tests run on."""
    tree = ast.parse(inspect.getsource(backends))
    for node in tree.body:
        if isinstance(node, ast.Import):
            names = {alias.name.split(".")[0] for alias in node.names}
        elif isinstance(node, ast.ImportFrom):
            names = {(node.module or "").split(".")[0]}
        else:
            continue
        assert not names & {"psycopg2", "neo4j"}, f"module-scope driver import: {names}"


def test_the_drivers_really_are_absent_here():
    """The negative control on the test above: it would be vacuous on a host where
    something else had already imported a driver."""
    assert "psycopg2" not in sys.modules
    assert "neo4j" not in sys.modules
