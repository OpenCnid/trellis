"""The concrete DB backends — where the real client, the real credential, and the
primary Postgres and Neo4j controls actually live.

Source of truth: docs/product/repl-sandbox/REPL_SANDBOX_INTERFACES.md section 5
(DB-broker RPC surface) for the Postgres and Neo4j control tables;
REPL_SANDBOX_ARCHITECTURE.md section 7 (Security requirements) requirements 6, 7
and 9; REPL_SANDBOX_THREAT_MODEL.md for the surfaces those requirements cover.

**What this module enforces, and what it can only assert.** Requirement 9 is
"least-privilege Postgres role — `NOSUPERUSER`, no `pg_read_server_files` /
`pg_execute_server_program` / `dblink`", and it has two halves that live in two
different places:

* The *session* half is enforced here. `PostgresBackend` issues
  `statement_timeout`, `default_transaction_read_only`, and — where a role is
  configured — `SET ROLE`, on every connection it checks out. Those statements
  are what `_apply_session_settings` executes; a test can watch them go by.
* The *grant* half is not enforced here and cannot be. Whether the role exists,
  whether it is `NOSUPERUSER`, and whether it is a member of
  `pg_read_server_files` or `pg_execute_server_program` are properties of the
  database, established by DDL an operator runs as a superuser. This module
  ships that DDL (`postgres_role_ddl`) so the obligation is concrete, and it
  makes no claim that the role exists, that `SET ROLE` named a least-privilege
  role, or that a role named in configuration is the role in the DDL. `SET ROLE`
  to a role that happens to be a superuser would succeed and this code could not
  tell.

Requirement 7's `statement_timeout` is enforced server-side by Postgres once the
statement above lands, and the Bolt query timeout is carried on every
transaction `Neo4jBackend` opens. Requirement 6 is the APOC allowlist plus the
DB-host egress denial, and neither is here: the allowlist is the broker's
(`Broker.apoc`) and the egress denial is the deployment's. What this module
contributes on that axis is the `default_access_mode = READ` of INTERFACES
section 5 (Neo4j controls) — which is exactly the control requirement 6 exists
because `READ` alone does not cover `apoc.load.*`.

**Posture declarations are derived, never configured.** `Broker.__init__` trusts
`read_only` and `access_mode` at construction. Both classes below apply exactly
one posture — read-only, `READ` — so both refuse at construction any
configuration that would make the declaration untrue, rather than accepting the
configuration and declaring something the code contradicts.

**Result caps apply at the source.** Rows are counted and measured as they are
fetched, against `BrokerCaps.max_rows` and `BrokerCaps.max_result_bytes`, so an
oversized result is refused while it is still coming off the cursor rather than
after the whole thing is resident in host memory. The refusal class is
`DeniedError`, matching what the broker raises when it re-checks the landed
result, so one over-cap result produces one error code wherever it is caught.

**No driver text ever leaves.** A database error message can quote a row — a
unique-violation names the conflicting value, a type error names the literal — so
every driver exception is re-raised as a taxonomy error carrying the exception's
sanitised class name and nothing else.

**Nothing here is the exfiltration boundary.** The boundary is that
`run_query`/`run_cypher` hand the guest a handle and never a payload
(ARCHITECTURE section 3.1). These backends produce the host-side `ResultSet` that
becomes a handle's referent; the caps below bound the size of that referent and
are defense-in-depth, never the boundary.

Both real-client factories (`postgres_backend_from_env`, `neo4j_backend_from_env`)
import their driver locally, so this module is importable on a host with neither
`psycopg2` nor `neo4j` installed. Tests never call them: they read credentials
and open sockets, and neither belongs in a unit test.
"""

from __future__ import annotations

import os
import re
from typing import Any, Callable

# The broker's own serialiser, reused rather than re-implemented: the byte cap
# applied here and the byte check the broker runs on the landed result are then
# the same number, not two approximations that can disagree at the margin.
from repl_sandbox.broker import ResultSet, _json_bytes, _normalise
from repl_sandbox.config import BrokerCaps
from repl_sandbox.errors import (
    DeniedError,
    SandboxError,
    TimeoutError_,
    UpstreamError,
)

# ---------------------------------------------------------------------------
# Bounds and identifiers
# ---------------------------------------------------------------------------

#: Rows pulled from a Postgres cursor per `fetchmany`. Small enough that an
#: over-cap result is refused after one chunk rather than after the driver has
#: buffered the whole answer, large enough not to round-trip per row.
FETCH_CHUNK = 512

#: Longest column name carried back on the metadata path. A column name is
#: caller-chosen text (`SELECT 1 AS "..."`), so it is bounded like everything
#: else that crosses, even though it travels guest-to-guest.
MAX_COLUMN_NAME_CHARS = 128

#: A Postgres identifier as this module will accept one. `SET` takes no bind
#: parameters, so a role name reaches the statement by interpolation; this
#: pattern admits no quote, no whitespace, and no semicolon, and the name is
#: double-quoted at the point of use, so the two together leave no way to end the
#: identifier early. 63 is Postgres' `NAMEDATALEN - 1`.
_PG_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_$]{0,62}$")

#: A Neo4j database name. Passed as a driver keyword rather than interpolated
#: into a query, so this is a fail-fast shape check and not an injection guard.
_NEO4J_DB_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{2,62}$")

#: Driver exception class names that unambiguously mean "the server cancelled
#: this for time". Mapping them to `TimeoutError_` classifies the failure; it
#: does not enforce anything. The enforcing surface is the server-side
#: `statement_timeout` and the Bolt transaction timeout, which are what produced
#: the exception in the first place.
_TIMEOUT_EXC_NAMES: frozenset[str] = frozenset(
    {"QueryCanceled", "QueryCanceledError", "TransactionTimedOutError"}
)

#: Default name of the least-privilege role in the shipped DDL.
DEFAULT_PG_ROLE = "trellis_repl_ro"


def _pg_identifier(raw: object, what: str) -> str:
    """Accept a Postgres identifier safe to double-quote into a `SET`, or refuse."""
    if not isinstance(raw, str) or _PG_IDENT_RE.match(raw) is None:
        raise UpstreamError(
            f"{what} must be a Postgres identifier of 1-63 characters matching "
            "[A-Za-z_][A-Za-z0-9_$]*"
        )
    return raw


def _neo4j_database(raw: object) -> str:
    """Accept a Neo4j database name, or refuse."""
    if not isinstance(raw, str) or _NEO4J_DB_RE.match(raw) is None:
        raise UpstreamError(
            "database must be a Neo4j database name of 3-63 characters matching "
            "[A-Za-z0-9][A-Za-z0-9._-]*"
        )
    return raw


def _positive_ms(value: object, what: str) -> int:
    """A millisecond budget that is actually a budget.

    A zero or negative `statement_timeout` means *no limit* in Postgres, so a
    cap that arrived as 0 would read as a configured bound and behave as none at
    all. Refused at construction rather than issued.
    """
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise UpstreamError(f"{what} must be a positive integer number of milliseconds")
    return value


def _upstream(exc: BaseException, which: str) -> SandboxError:
    """Turn a driver exception into a taxonomy error that carries no driver text.

    Only the exception's class name survives, and even that is stripped to word
    characters and truncated: a class name is an identifier in every real driver,
    but this module does not need to trust that to hold in order to guarantee
    that no row value rides out on an error path.
    """
    name = re.sub(r"[^A-Za-z0-9_]", "", type(exc).__name__)[:64] or "Exception"
    if name in _TIMEOUT_EXC_NAMES:
        return TimeoutError_(f"{name} from the {which} driver")
    return UpstreamError(f"{name} from the {which} driver")


def _quiet_close(obj: Any) -> None:
    """Close a cursor, transaction, session, or connection from a `finally`.

    A close that fails while an exception is propagating would replace the real
    failure with a cleanup failure, and on the happy path the object is being
    discarded either way. The one thing that must not happen is a cleanup error
    reaching the guest in place of the answer.
    """
    try:
        obj.close()
    except Exception:  # noqa: BLE001 - cleanup must not mask the outcome
        pass


def _quiet_rollback(conn: Any) -> None:
    """Roll a connection back after a failed statement.

    Pool hygiene, not a control: a connection left in an aborted transaction
    fails every statement the next borrower issues, which would turn one bad
    query into a dead backend.
    """
    try:
        conn.rollback()
    except Exception:  # noqa: BLE001 - see `_quiet_close`
        pass


def _column_name(raw: object) -> str:
    return str(raw)[:MAX_COLUMN_NAME_CHARS]


# ---------------------------------------------------------------------------
# The role DDL — requirement 9's other half
# ---------------------------------------------------------------------------

#: The DDL an operator must run for requirement 9's grant half, as a template.
#:
#: Rendered by `postgres_role_ddl`. Kept as a module constant rather than a data
#: file so it cannot go missing from a package build, and so a test can assert
#: that the three roles requirement 9 names by name are in it.
POSTGRES_ROLE_DDL_TEMPLATE = """\
-- Least-privilege Postgres role for the Trellis REPL-sandbox DB broker.
-- ARCHITECTURE section 7 requirement 9; INTERFACES section 5 (Postgres controls).
--
-- Run this as a superuser against the target database. Nothing in
-- src/repl_sandbox/backends.py grants, revokes, or verifies any of it. That
-- module applies the per-session settings in step 6 on every connection
-- checkout; everything else below is a property of the database and exists only
-- if an operator has run these statements.

-- 1. The role. NOSUPERUSER is the attribute requirement 9 names; the rest close
--    the adjacent escalations, since a role that can create roles can grant
--    itself the file-reading ones.
CREATE ROLE "{role}"
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;

-- 2. Read, only read, and only where reading is intended.
GRANT CONNECT ON DATABASE "{database}" TO "{role}";
GRANT USAGE ON SCHEMA public TO "{role}";
GRANT SELECT ON ALL TABLES IN SCHEMA public TO "{role}";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO "{role}";
REVOKE CREATE ON SCHEMA public FROM "{role}";

-- 3. The predefined roles requirement 9 names. A freshly created role is a
--    member of none of them; these are written out so the obligation is
--    explicit and so re-running this file repairs a database where someone
--    granted one.
REVOKE pg_read_server_files      FROM "{role}";
REVOKE pg_write_server_files     FROM "{role}";
REVOKE pg_execute_server_program FROM "{role}";

-- 4. Server-side file and large-object reach that is not expressible as a role
--    membership. EXECUTE on these is revoked from PUBLIC by default on a
--    supported Postgres; the explicit form survives a database where it was
--    granted back.
REVOKE EXECUTE ON FUNCTION pg_read_file(text) FROM "{role}";
REVOKE EXECUTE ON FUNCTION pg_read_file(text, bigint, bigint) FROM "{role}";
REVOKE EXECUTE ON FUNCTION pg_read_binary_file(text) FROM "{role}";
REVOKE EXECUTE ON FUNCTION pg_ls_dir(text) FROM "{role}";
REVOKE EXECUTE ON FUNCTION lo_import(text) FROM "{role}";
REVOKE EXECUTE ON FUNCTION lo_export(oid, text) FROM "{role}";

-- 5. dblink and postgres_fdw are outbound network originating inside the
--    database, which is behind the DB host's deny-by-default egress rather than
--    in front of it. The supported posture is that neither extension is
--    installed in this database:
--        DROP EXTENSION IF EXISTS dblink;
--        DROP EXTENSION IF EXISTS postgres_fdw;
--    If another consumer requires them, revoke this role's reach instead:
--        REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA <dblink_schema> FROM "{role}";
--        REVOKE USAGE ON FOREIGN DATA WRAPPER postgres_fdw FROM "{role}";

-- 6. Session settings, pinned on the role as well. PostgresBackend applies the
--    first two on every checkout; pinning them here means a connection that
--    reached this database without going through PostgresBackend still starts
--    bounded. The idle timeout is pinned here only -- PostgresBackend does not
--    issue it.
ALTER ROLE "{role}" SET statement_timeout = '{statement_timeout_ms}ms';
ALTER ROLE "{role}" SET default_transaction_read_only = on;
ALTER ROLE "{role}" SET idle_in_transaction_session_timeout = '{idle_timeout_ms}ms';
{login_section}"""

_LOGIN_SECTION_DIRECT = """
-- 7. How the broker authenticates.
--    This rendering assumes the broker's DSN logs in AS this role, in which case
--    change NOLOGIN to LOGIN PASSWORD '...' in step 1 and construct
--    PostgresBackend with role=None -- there is nothing to SET ROLE down to.
"""

_LOGIN_SECTION_SET_ROLE = """
-- 7. How the broker authenticates: a shared login role that drops to this one.
GRANT "{role}" TO "{login_role}";
ALTER ROLE "{login_role}" NOINHERIT;
--    NOINHERIT means membership in "{role}" is not active until PostgresBackend
--    issues SET ROLE, so the broker's privileges are exactly what SET ROLE
--    selects. It does NOT remove privileges granted to "{login_role}" directly,
--    which is why that role should hold none beyond CONNECT.
--
--    SET ROLE is reversible with RESET ROLE, which is why the login role must be
--    unprivileged rather than merely un-inheriting. policy.inspect_sql refuses
--    both `set` and `reset` in a guest statement, but that inspection is
--    defense-in-depth and is not what makes this safe.
"""


def postgres_role_ddl(
    caps: BrokerCaps,
    *,
    role: str = DEFAULT_PG_ROLE,
    database: str = "trellis_db",
    login_role: str | None = None,
    idle_timeout_ms: int | None = None,
) -> str:
    """Render the requirement-9 role DDL an operator must run as a superuser.

    This function produces text. It executes nothing, connects to nothing, and
    proves nothing about the database it is rendered for. Pass `login_role` when
    the broker authenticates as a shared login role and needs `SET ROLE`; leave
    it `None` when the broker's DSN logs in as `role` directly, which is the
    posture with the fewer moving parts.
    """
    role = _pg_identifier(role, "role")
    database = _pg_identifier(database, "database")
    statement_timeout_ms = _positive_ms(caps.statement_timeout_ms, "statement_timeout_ms")
    if idle_timeout_ms is None:
        idle_timeout_ms = statement_timeout_ms * 4
    idle_timeout_ms = _positive_ms(idle_timeout_ms, "idle_timeout_ms")

    if login_role is None:
        login_section = _LOGIN_SECTION_DIRECT
    else:
        login_section = _LOGIN_SECTION_SET_ROLE.format(
            role=role, login_role=_pg_identifier(login_role, "login_role")
        )
    return POSTGRES_ROLE_DDL_TEMPLATE.format(
        role=role,
        database=database,
        statement_timeout_ms=statement_timeout_ms,
        idle_timeout_ms=idle_timeout_ms,
        login_section=login_section,
    )


# ---------------------------------------------------------------------------
# Postgres
# ---------------------------------------------------------------------------


class PostgresBackend:
    """The Postgres half of the DB seam: one connection, bounded on every checkout.

    `connect` is a callable returning a DBAPI connection. It is injected so this
    class holds no driver import and so every test drives a recording fake. It
    should hand back the *same* connection (or a pool checkout), not open a fresh
    one per call — `postgres_backend_from_env` builds exactly such a callable.

    **Every checkout re-applies every setting.** Not once at construction: a
    pooled connection carries whatever the last borrower left on it, including a
    `SET ROLE` to something else, a relaxed `statement_timeout`, and an aborted
    transaction. `_checkout` rolls back first to clear the transaction state,
    issues the three settings, and commits — a session-level `SET` inside a
    transaction that is later rolled back is itself rolled back, so the commit is
    what makes the settings outlive the statements that set them.

    **Privileges are dropped last.** `statement_timeout` and
    `default_transaction_read_only` are issued before `SET ROLE`, so a role too
    restricted to set them cannot be the reason a cap went unapplied.
    """

    #: Declared posture, read by `Broker._check_backend_posture`. Derived, not
    #: configured: this class has exactly one code path and it is the read-only
    #: one.
    read_only: bool

    def __init__(
        self,
        connect: Callable[[], Any],
        caps: BrokerCaps,
        role: str | None = None,
        read_only: bool = True,
    ) -> None:
        if not callable(connect):
            raise UpstreamError("connect must be a callable returning a DBAPI connection")
        if not read_only:
            # The declaration must match what the code applies. This class issues
            # `default_transaction_read_only = on` unconditionally, so a
            # `read_only = False` backend would declare a posture its own session
            # contradicts. Writes are a distinct capability with a distinct grant
            # (INTERFACES section 5, Postgres controls), not a flag here.
            raise UpstreamError(
                "PostgresBackend has no write path: it applies "
                "default_transaction_read_only on every checkout, so read_only=False "
                "would be a declaration this backend's own session contradicts"
            )
        self._connect = connect
        self._caps = caps
        self._statement_timeout_ms = _positive_ms(
            caps.statement_timeout_ms, "caps.statement_timeout_ms"
        )
        self.role = _pg_identifier(role, "role") if role is not None else None
        self.read_only = True
        self._conn: Any | None = None

    # -- session settings ----------------------------------------------------

    def _apply_session_settings(self, conn: Any) -> None:
        """Issue the three controls on `conn`. The enforcing surface for the session
        half of requirements 7 and 9.

        The interpolation is deliberate and bounded: Postgres' `SET` accepts no
        bind parameters, the timeout is an `int` checked positive at
        construction, and the role matched `_PG_IDENT_RE` at construction and is
        double-quoted here, a character the pattern does not admit.
        """
        # Clear whatever the previous borrower left open. A connection sitting in
        # an aborted transaction fails every statement below.
        conn.rollback()
        cur = conn.cursor()
        try:
            cur.execute(f"SET SESSION statement_timeout = {self._statement_timeout_ms}")
            cur.execute("SET SESSION default_transaction_read_only = on")
            if self.role is not None:
                cur.execute(f'SET ROLE "{self.role}"')
        finally:
            _quiet_close(cur)
        # Session-level SET is undone by a rollback, so the settings are only
        # durable past this transaction once it commits. Nothing else is pending.
        conn.commit()

    def _checkout(self) -> Any:
        conn = self._connect()
        if conn is None:
            raise UpstreamError("the injected postgres connect callable returned no connection")
        try:
            self._apply_session_settings(conn)
        except SandboxError:
            raise
        except Exception as exc:  # noqa: BLE001 - a failed control is a failed call
            _quiet_rollback(conn)
            raise _upstream(exc, "postgres") from None
        self._conn = conn
        return conn

    # -- queries -------------------------------------------------------------

    def run_query(self, sql: str, params: list) -> ResultSet:
        """Run one read on a freshly bounded session and return the host-side rows.

        The rows stay here. What reaches the guest is the handle the broker
        allocates over this `ResultSet` plus its row count and column schema.
        """
        conn = self._checkout()
        try:
            cur = conn.cursor()
            try:
                cur.execute(sql, list(params) if params else None)
                schema = _pg_schema(cur)
                rows = self._collect(cur)
            finally:
                _quiet_close(cur)
            conn.commit()
        except SandboxError:
            _quiet_rollback(conn)
            raise
        except Exception as exc:  # noqa: BLE001 - no driver text crosses this line
            _quiet_rollback(conn)
            raise _upstream(exc, "postgres") from None
        return ResultSet(rows=rows, schema=schema, rowcount=len(rows))

    def run_cypher(self, query: str, params: dict) -> ResultSet:
        """Not served here. Present so a backend map that put this object under
        `"neo4j"` fails loudly instead of falling through to an attribute error."""
        raise UpstreamError("the postgres backend does not serve run_cypher")

    def _collect(self, cur: Any) -> list[list]:
        """Fetch rows in chunks, refusing the moment either cap is passed.

        Both caps are checked per row as the row is measured, so the refusal
        happens while the rest of the answer is still on the cursor. Rows are
        normalised on the way in: the referent a handle points at is then already
        JSON-safe, the byte measure here is exactly the one the broker will
        compute on the landed result, and no driver-native `Decimal` or
        `datetime` survives to surprise the frame codec later.
        """
        caps = self._caps
        rows: list[list] = []
        # Two brackets, then one separator per row: never an underestimate of
        # what `_json_bytes(rows)` will return.
        nbytes = 2
        while True:
            chunk = cur.fetchmany(FETCH_CHUNK)
            if not chunk:
                break
            for raw in chunk:
                if len(rows) + 1 > caps.max_rows:
                    raise DeniedError(
                        f"result exceeds the row cap {caps.max_rows}"
                    )
                row = _normalise(list(raw))
                nbytes += _json_bytes(row) + 1
                if nbytes > caps.max_result_bytes:
                    raise DeniedError(
                        f"result exceeds the result byte cap {caps.max_result_bytes}"
                    )
                rows.append(row)
        return rows

    def close(self) -> None:
        """Close the connection this backend is holding, if it owns one.

        A `connect` that hands back a pool checkout is handing back something the
        pool owns; in that deployment this method closes the last connection seen
        and the pool's own lifecycle is the operator's concern, not this class's.
        """
        conn, self._conn = self._conn, None
        if conn is not None:
            _quiet_close(conn)


def _pg_schema(cur: Any) -> list[dict]:
    """Column metadata from a DBAPI cursor description. Names and type codes only.

    A column description is shape, not content (INTERFACES section 5): it is what
    accompanies a handle back to the guest, and no row value appears in it.
    """
    description = getattr(cur, "description", None) or ()
    schema: list[dict] = []
    for column in description:
        if isinstance(column, (list, tuple)):
            name = column[0] if len(column) > 0 else None
            type_code = column[1] if len(column) > 1 else None
        else:
            name = getattr(column, "name", None)
            type_code = getattr(column, "type_code", None)
        schema.append({"name": _column_name(name), "type_code": _normalise(type_code)})
    return schema


# ---------------------------------------------------------------------------
# Neo4j
# ---------------------------------------------------------------------------


class Neo4jBackend:
    """The Neo4j half of the DB seam: every session `READ`, every transaction timed.

    `driver_factory` is a callable returning a Bolt driver. It is injected so
    this class holds no driver import and so every test drives a recording fake.
    It is called once and the driver is reused; a Bolt driver is itself a
    connection pool, so building one per query would be the expensive mistake.

    The access mode is applied where the session is opened, which is the only
    place it can be applied — `default_access_mode = READ` routes the session to a
    follower on a cluster and makes the server refuse a write on either topology,
    and there is nothing to reach for once the transaction is running. The
    timeout rides on the
    transaction rather than on the session, because that is the granularity the
    Bolt protocol carries it at.
    """

    #: Declared posture, read by `Broker._check_backend_posture`. Derived, not
    #: configured: `run_cypher` opens sessions one way.
    access_mode: str

    def __init__(
        self,
        driver_factory: Callable[[], Any],
        caps: BrokerCaps,
        database: str | None = None,
        *,
        access_mode: str = "READ",
    ) -> None:
        if not callable(driver_factory):
            raise UpstreamError("driver_factory must be a callable returning a Bolt driver")
        if not isinstance(access_mode, str) or access_mode.upper() != "READ":
            # As with `PostgresBackend.read_only`: the declaration must match what
            # the code applies, and `run_cypher` has one session-opening path.
            raise UpstreamError(
                "Neo4jBackend opens every session with default_access_mode=READ, so "
                f"access_mode={access_mode!r} would be a declaration this backend's "
                "own session contradicts"
            )
        self._driver_factory = driver_factory
        self._caps = caps
        self._timeout_s = (
            _positive_ms(caps.bolt_timeout_ms, "caps.bolt_timeout_ms") / 1000.0
        )
        #: Pinned rather than defaulted. A driver's default database is a server
        #: setting that can change under the deployment; naming it here means the
        #: broker reads the graph it was configured for or fails.
        self.database = _neo4j_database(database) if database is not None else None
        self.access_mode = "READ"
        self._driver: Any | None = None

    def _driver_once(self) -> Any:
        if self._driver is None:
            try:
                driver = self._driver_factory()
            except Exception as exc:  # noqa: BLE001 - no driver text crosses this line
                raise _upstream(exc, "neo4j") from None
            if driver is None:
                raise UpstreamError("the injected neo4j driver factory returned no driver")
            self._driver = driver
        return self._driver

    def run_query(self, sql: str, params: list) -> ResultSet:
        """Not served here. Present so a backend map that put this object under
        `"postgres"` fails loudly instead of falling through to an attribute error."""
        raise UpstreamError("the neo4j backend does not serve run_query")

    def run_cypher(self, query: str, params: dict) -> ResultSet:
        """Run one read in a `READ` session under the Bolt timeout.

        The transaction is closed, never committed: it read, there is nothing to
        commit, and closing an unfinished transaction rolls it back, which is the
        outcome a read-only path wants on both the success and the failure edge.
        """
        driver = self._driver_once()
        kwargs: dict[str, Any] = {"default_access_mode": self.access_mode}
        if self.database is not None:
            kwargs["database"] = self.database
        try:
            session = driver.session(**kwargs)
        except Exception as exc:  # noqa: BLE001 - no driver text crosses this line
            raise _upstream(exc, "neo4j") from None
        try:
            tx = session.begin_transaction(timeout=self._timeout_s)
            try:
                result = tx.run(query, dict(params) if params else {})
                schema = _bolt_schema(result)
                rows = self._collect(result)
            finally:
                _quiet_close(tx)
        except SandboxError:
            raise
        except Exception as exc:  # noqa: BLE001 - no driver text crosses this line
            raise _upstream(exc, "neo4j") from None
        finally:
            _quiet_close(session)
        return ResultSet(rows=rows, schema=schema, rowcount=len(rows))

    def _collect(self, result: Any) -> list[list]:
        """Consume a Bolt result, refusing the moment either cap is passed.

        Same discipline as the Postgres side: measured per record as it arrives,
        so an over-cap answer is refused while records are still streaming.
        """
        caps = self._caps
        rows: list[list] = []
        nbytes = 2
        for record in result:
            if len(rows) + 1 > caps.max_rows:
                raise DeniedError(f"result exceeds the row cap {caps.max_rows}")
            values = record.values() if hasattr(record, "values") else record
            row = _normalise(list(values))
            nbytes += _json_bytes(row) + 1
            if nbytes > caps.max_result_bytes:
                raise DeniedError(
                    f"result exceeds the result byte cap {caps.max_result_bytes}"
                )
            rows.append(row)
        return rows

    def close(self) -> None:
        """Close the Bolt driver and its pool."""
        driver, self._driver = self._driver, None
        if driver is not None:
            _quiet_close(driver)


def _bolt_schema(result: Any) -> list[dict]:
    """Column metadata from a Bolt result: the record keys, bounded. No values."""
    keys = result.keys()
    return [{"name": _column_name(key)} for key in keys]


# ---------------------------------------------------------------------------
# Real clients — constructed only by the trusted host driver, never by a test
# ---------------------------------------------------------------------------


def postgres_backend_from_env(
    caps: BrokerCaps,
    *,
    dsn_var: str = "TRELLIS_PG_DSN",
    role_var: str = "TRELLIS_PG_ROLE",
) -> PostgresBackend:
    """Build the real Postgres backend from host-side environment variables.

    Called by the trusted host driver only. Tests never call it: it reads a
    credential and opens a socket, and neither belongs in a unit test. The driver
    import is local, so this module stays importable on a host with no
    `psycopg2`.

    The DSN carries the credential. It is read here, handed to `psycopg2`, and
    never stored anywhere this process logs, audits, or serialises. The returned
    `connect` closure keeps one connection and reconnects only when the server
    has dropped it; every checkout re-applies the session settings regardless, so
    a reconnect is never a session that came up unbounded.

    Setting `role_var` is what makes the `SET ROLE` in `_apply_session_settings`
    fire. Whether the role it names is the least-privilege role of
    `postgres_role_ddl` is a deployment fact this function cannot check.
    """
    dsn = os.environ.get(dsn_var)
    if not dsn:
        raise RuntimeError(f"{dsn_var} is not set; the DB broker has no Postgres credential")
    role = os.environ.get(role_var) or None

    import psycopg2  # local import: never at module scope

    held: dict[str, Any] = {}

    def connect() -> Any:
        conn = held.get("conn")
        if conn is None or getattr(conn, "closed", 0):
            conn = psycopg2.connect(dsn)
            held["conn"] = conn
        return conn

    return PostgresBackend(connect=connect, caps=caps, role=role, read_only=True)


def neo4j_backend_from_env(
    caps: BrokerCaps,
    *,
    uri_var: str = "TRELLIS_NEO4J_URI",
    user_var: str = "TRELLIS_NEO4J_USER",
    password_var: str = "TRELLIS_NEO4J_PASSWORD",
    database_var: str = "TRELLIS_NEO4J_DATABASE",
) -> Neo4jBackend:
    """Build the real Neo4j backend from host-side environment variables.

    Called by the trusted host driver only; tests never call it, for the same
    reason as the Postgres factory. The driver import is local, so this module
    stays importable on a host with no `neo4j`.

    The password is read here, handed to `GraphDatabase.driver`, and never stored
    anywhere this process logs, audits, or serialises.
    """
    uri = os.environ.get(uri_var)
    user = os.environ.get(user_var)
    password = os.environ.get(password_var)
    if not uri:
        raise RuntimeError(f"{uri_var} is not set; the DB broker has no Neo4j route")
    if not user or not password:
        raise RuntimeError(
            f"{user_var} and {password_var} must both be set; the DB broker has no "
            "Neo4j credential"
        )
    database = os.environ.get(database_var) or None

    from neo4j import GraphDatabase  # local import: never at module scope

    def driver_factory() -> Any:
        return GraphDatabase.driver(uri, auth=(user, password))

    return Neo4jBackend(driver_factory=driver_factory, caps=caps, database=database)


__all__ = [
    "DEFAULT_PG_ROLE",
    "FETCH_CHUNK",
    "MAX_COLUMN_NAME_CHARS",
    "POSTGRES_ROLE_DDL_TEMPLATE",
    "Neo4jBackend",
    "PostgresBackend",
    "neo4j_backend_from_env",
    "postgres_backend_from_env",
    "postgres_role_ddl",
]
