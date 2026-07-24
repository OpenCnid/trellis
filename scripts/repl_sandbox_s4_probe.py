"""REPL-sandbox S4 probe: a real DB query from inside the guest, on a real host.

Specification: docs/product/repl-sandbox/REPL_SANDBOX_BUILD_PLAN.md section 5.4
(S4 - DB broker minimal proof), the **`[R]` half**. The load-bearing thing S4
proves that S3 could not: a *real Postgres query completes from inside the guest
with zero credential material ever in the guest*, through the host-side DB broker,
over a **second** vsock port (`config.ports.db`, 5002) - reusing the exact
hybrid-vsock bridge S3 stood up on `config.ports.lm` (5001). Entrypoint:
`npm run repl-sandbox:s4-probe` (the non-test caller, AMBIENT.md rule 15).

**This script only runs on the provisioned Linux host**, as root. It shells out to
`ctr`, reads `/dev/kvm`, binds a Unix socket in the VMM's per-sandbox directory,
and drives a real Postgres. On the Windows development box it refuses in its first
check. S2 (boundary + persistence) and S3 (the vsock bridge) are its predecessors;
this reuses S3's boot / bridge-discovery / witness / teardown wholesale by import,
exactly as `repl_sandbox_s3_paid.py` does - a second copy of that plumbing would be
a second thing to keep true.

**Zero-paid.** No model runs. The query is scripted (this author fixed the SQL and
knows the fixture rows in advance), so "scripted query returns rows" is a
statement about a real database reached through the real broker, not a fake one.
The metered `[A]` half of S4 - a real model driving the `run_query` facade to
answer a real workspace question - is a separate, owner-gated run.

**The credential never enters the guest, and that is the property under test.** The
broker holds the Postgres DSN host-side (`postgres_backend_from_env` reads
`TRELLIS_PG_DSN` on the host and hands it to `psycopg2`); the guest holds a
materialised `run_query` proxy stub and nothing else (ARCHITECTURE section 3.1,
The exfiltration resolution). So the "zero credential in guest" check is run
**host-side**: the guest dumps its own environment, argv, and globals - all of
which are secret-free by construction - and the host greps that dump for the real
DSN and password. The secret is never sent into the guest to look for it. A
planted **canary** is the grep's positive control: a fake secret the guest *is*
given, which the same grep must find, so a grep that silently matches nothing
cannot pass the real claim by being broken (.claude/rules/measurement-and-reporting.md rule 19(c)).

**Write denial is proven at both layers, and the docs are explicit about which is
primary.** The primary control is the Postgres role: a `NOSUPERUSER` role whose
session is `default_transaction_read_only = on`. On top sits `policy.inspect_sql`,
defense-in-depth. So the probe checks both: the guest's `INSERT` (and the
`pg_read_file` / `COPY TO PROGRAM` escape primitives of requirement 9) come back
**denied by the broker's inspector** having crossed the bridge; and, separately,
the probe connects **directly as the read-only role** (bypassing the broker
entirely) and watches Postgres itself refuse the same `INSERT`. Either alone would
prove only the weaker half.

**The egress claim is the weak one, and it says so.** BUILD_PLAN section 5.4 lists
"the DB host has no internet/metadata route" among S4's `[R]` properties, but the
deny-by-default host/VMM-NIC egress that would enforce it **is not in the merged
code** (BUILD_PLAN section 6 requirement 6 is marked "S4 + GB"; the NIC policy is
GB's). For a throwaway Postgres colocated with the broker there is no separate "DB
host" hop at all. So the probe asserts only what it honestly can - that neither
`dblink` nor `postgres_fdw` is installed, closing the SQL-level origination path -
and labels it as *not* a Trellis-built boundary. The real boundary is deferred to
GB, and the probe's report says so rather than over-claiming.

What is being proved, in separable claims:

  1. **A real query crosses and rows come back.** The guest calls the shipping
     path (`guest_rpc.GuestRpc` over `transport.VsockClient`) `run_query(sql)` ->
     an opaque handle plus row count and schema, then `materialize(handle)` ->
     the rows. The rows equal the known fixture. The host-side witness counts the
     connections that arrived - the one thing a guest answering itself cannot forge.
  2. **Zero credential in the guest.** A host-side grep of the guest's dumped
     environment/argv/globals for the real DSN and password finds nothing; the
     planted canary is found (the grep's positive control).
  3. **A write is denied by the broker inspector.** The guest's `INSERT` crosses
     the bridge and comes back a `denied` refusal.
  4. **The requirement-9 escape primitives are denied.** `pg_read_file(...)` and
     `COPY ... TO PROGRAM` are refused the same way.
  5. **A write is denied by the role itself.** A direct connection as the
     read-only role - no broker in the path - has Postgres refuse the same `INSERT`
     with a read-only-transaction error. The primary control, shown independent of
     the inspector.
  6. **No SQL-level egress origination.** `dblink` / `postgres_fdw` are absent.
     Labeled explicitly as the weak proxy for requirement 6, not a NIC boundary.
  7. **Identity is the host's.** After the host closes the session, the same guest
     on the DB port is dropped without an answer.
  8. **Clean teardown.** Listener socket, container, and VMM process all gone; the
     throwaway Postgres objects are dropped.

Modes:
  default             boot once, provision, run all claims
  --negative-control  the guest answers ITSELF over in-guest loopback with canned
                      rows and canned denials, never dialing the DB port. Every
                      guest-visible claim still passes and only the host-side
                      witness catches it. DETECTED (exit 3) is the healthy result;
                      a pass means the probe cannot tell a crossed boundary from a
                      guest talking to itself and proves nothing about the bridge.
  --external-pg       do not provision: use the Postgres the environment already
                      names (TRELLIS_PG_ADMIN_DSN for setup, TRELLIS_PG_DSN for the
                      broker). The default path provisions a throwaway server.
  --keep              leave the sandbox and Postgres running (skips teardown)
  --json              emit the observation record as JSON on stdout

**Provisioning (default path), and its scope limit.** With no `TRELLIS_PG_DSN` in
the environment the probe stands up a throwaway Postgres itself: it ensures the
`postgresql` package is present, creates a `trellis_db` with a three-row fixture
table, and creates the least-privilege login role from the shipped DDL
(`backends.postgres_role_ddl`) with a random password it holds host-side only. All
of that runs `sudo -u postgres psql` - it has **only ever been exercised on the
host, never on the Windows development box**, the same status the `ctr` calls carry.
The broker's own client is `psycopg2`, imported host-side by
`backends.postgres_backend_from_env`, so the host venv needs it installed (as the
S3 `[A]` run needed `openai`); its absence surfaces as an `ImportError` at broker
construction, before any sandbox boots.
The host-side *verdict* logic - every assessor that turns a guest report into a
pass/fail - is under test off-host in `src/repl_sandbox/tests/test_s4_probe.py`, so
a mistake in what counts as a pass surfaces on a development box, not mid-run.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import secrets
import subprocess
import sys
import threading
import time
import uuid

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO_ROOT, "src"))


def _load_probe():
    """Import the S3 `[R]` probe by path and reuse its host/bridge plumbing.

    It is a script, not a package module, so it is loaded the way its own test
    loads it. `Sandbox`, `Witness`, `discover_vsock_uds`, `preconditions`,
    `ScriptedProvider`, `ProbeError`, and the guest-dir constants all come from
    there; nothing host-and-bridge shaped is re-implemented here.
    """
    path = os.path.join(REPO_ROOT, "scripts", "repl_sandbox_s3_probe.py")
    spec = importlib.util.spec_from_file_location("repl_sandbox_s3_probe", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


probe = _load_probe()

from repl_sandbox.audit import AuditLog  # noqa: E402
from repl_sandbox.backends import (  # noqa: E402
    DEFAULT_PG_ROLE,
    postgres_backend_from_env,
    postgres_role_ddl,
)
from repl_sandbox.config import SandboxConfig  # noqa: E402
from repl_sandbox.host import TrellisSandboxHost  # noqa: E402
from repl_sandbox.transport import HybridVsockListener, serve_forever  # noqa: E402

#: Reused from the S3 probe so there is one copy of each. `GUEST_DIR` is "/run/s3"
#: - a cosmetic name from S3; the guest program below hard-codes the same literal
#: in its `sys.path` insert, matching `repl_sandbox_s3_paid.py`.
GUEST_DIR = probe.GUEST_DIR
GUEST_CID = probe.GUEST_CID


# ---------------------------------------------------------------------------
# The fixture — a tiny known table the scripted query checks against
# ---------------------------------------------------------------------------

PG_DATABASE = "trellis_db"
FIXTURE_TABLE = "probe_fixture"

#: Three rows, values unremarkable and distinct so a per-row mismatch is
#: unambiguous. The broker normalises a Postgres row to a JSON list, so the
#: expected shape the guest reports back is a list of `[id, label, value]` lists.
FIXTURE_ROWS = [[1, "alpha", 10], [2, "beta", 20], [3, "gamma", 30]]

READ_SQL = f"SELECT id, label, value FROM {FIXTURE_TABLE} ORDER BY id"
WRITE_SQL = f"INSERT INTO {FIXTURE_TABLE} (label, value) VALUES ('delta', 40)"

#: Requirement 9's named escape primitives. Each must be refused by the broker
#: inspector before any backend is touched (policy.SQL_DENIED_TOKENS).
ESCAPE_SQLS = {
    "pg_read_file": "SELECT pg_read_file('/etc/passwd')",
    "copy_to_program": f"COPY {FIXTURE_TABLE} TO PROGRAM 'id'",
}

#: The grant the guest session gets: read a query into a handle, then read the
#: handle's rows. No write op, no algebra - the minimal set S4 needs.
GRANTED_OPS = ("run_query", "materialize")


# ---------------------------------------------------------------------------
# The guest program — the shipping GuestRpc path, driving a real DB query
# ---------------------------------------------------------------------------
#
# Runs inside the guest, prints one JSON object. It drives `run_query` then
# `materialize` through `guest_rpc.GuestRpc` over `transport.VsockClient` - the
# same path a materialised `run_query` stub takes - so a pass is a statement about
# the code that ships. In `--fake-local` it never dials the DB port: it answers
# itself with canned replies, and only the host witness can tell.
GUEST_DB_SOURCE = r'''
import argparse, json, os, socket, sys

sys.path.insert(0, "/run/s3")

from repl_sandbox.errors import DeniedError, SandboxError
from repl_sandbox.guest_rpc import GuestRpc
from repl_sandbox.transport import VsockClient

VMADDR_CID_HOST = 2
ENVELOPE_VERSION = 1


class FakeRpc:
    """The negative control's guest-local answerer. NOT a boundary crossing.

    Returns the canned replies the host broker would have returned - a handle for
    run_query, the fixture rows for materialize, a raised DeniedError for a write -
    without ever opening a socket. Every guest-visible claim passes; only the
    host's witness, counting connections that never arrived, can tell.
    """

    def __init__(self, canned, read_sql):
        self._canned = canned
        self._read_sql = read_sql

    def __call__(self, port_name, request):
        op = request.get("op")
        if op == "run_query":
            sql = request.get("args", {}).get("sql", "")
            # Forge the broker's behaviour *exactly*: the one benign read
            # succeeds and everything else is refused. An earlier version keyed
            # this on "starts with select", which let `SELECT pg_read_file(...)`
            # through — so the escape claim failed on the fake rather than on the
            # witness, and the control was blunter than it must be. A control that
            # is caught by a guest-visible claim is not testing what it says it
            # tests: the witness has to be the only thing that can tell.
            if sql.strip() != self._read_sql.strip():
                raise DeniedError("denied: fabricated by the negative control")
            return dict(self._canned["run_query"])
        if op == "materialize":
            return dict(self._canned["materialize"])
        raise DeniedError("denied: fabricated by the negative control")


def _dump_self(canary):
    """The guest's own secret-free surfaces, for the host to grep.

    The credential is never sent into the guest, so there is nothing here to find
    unless something leaked it. `canary` is planted into this dump on purpose: the
    host grep must find it (its positive control) and must NOT find the real
    secret. Grepping the raw process heap is not portable from Python, so the
    scanned surfaces are named honestly and the host records that scope.
    """
    os.environ["TRELLIS_S4_CANARY"] = canary
    try:
        environ_raw = open("/proc/self/environ", "rb").read().decode("utf-8", "replace")
    except OSError:
        environ_raw = ""
    try:
        cmdline = open("/proc/self/cmdline", "rb").read().decode("utf-8", "replace")
    except OSError:
        cmdline = ""
    return {
        "environ": dict(os.environ),
        "environ_raw": environ_raw,
        "cmdline": cmdline,
        "argv": list(sys.argv),
        "globals_repr": repr({k: v for k, v in list(globals().items()) if not k.startswith("__")}),
        "surfaces_scanned": ["os.environ", "/proc/self/environ", "/proc/self/cmdline",
                             "sys.argv", "module globals"],
        "surfaces_not_scanned": ["raw process heap (not portable from Python)"],
    }


def _run_flow(rpc, read_sql, write_sql, escape_sqls, max_frame_len):
    report = {}

    # -- claim 1: read a real query into a handle, then read the rows ----------
    try:
        opened = rpc("DB_PORT", {
            "v": ENVELOPE_VERSION, "req_id": "s4-read", "op": "run_query",
            "args": {"sql": read_sql, "params": []},
        })
        report["run_query_ok"] = True
        report["handle"] = opened.get("handle")
        report["rowcount"] = opened.get("rowcount")
        report["schema"] = opened.get("schema")
    except Exception as exc:
        report["run_query_ok"] = False
        report["run_query_error"] = "%s: %s" % (type(exc).__name__, exc)
        report["handle"] = None

    if report.get("handle") is not None:
        try:
            got = rpc("DB_PORT", {
                "v": ENVELOPE_VERSION, "req_id": "s4-materialize", "op": "materialize",
                "args": {"handle": report["handle"]},
            })
            report["materialize_ok"] = True
            report["rows"] = got.get("rows")
            report["truncated"] = got.get("truncated")
        except Exception as exc:
            report["materialize_ok"] = False
            report["materialize_error"] = "%s: %s" % (type(exc).__name__, exc)
    else:
        report["materialize_ok"] = False

    # -- claim 3: a write is refused (broker inspector layer) ------------------
    report["write"] = _expect_denied(rpc, "s4-write", write_sql, max_frame_len)

    # -- claim 4: requirement-9 escape primitives are refused ------------------
    report["escapes"] = {
        name: _expect_denied(rpc, "s4-escape-%s" % name, sql, max_frame_len)
        for name, sql in escape_sqls.items()
    }
    return report


def _expect_denied(rpc, req_id, sql, max_frame_len):
    """Issue a statement the read-only path must refuse; report the refusal."""
    try:
        rpc("DB_PORT", {
            "v": ENVELOPE_VERSION, "req_id": req_id, "op": "run_query",
            "args": {"sql": sql, "params": []},
        })
        return {"denied": False, "note": "the statement was NOT refused"}
    except SandboxError as exc:
        return {"denied": True, "code": getattr(exc, "code", None),
                "message": "%s" % exc}
    except Exception as exc:
        return {"denied": True, "code": None, "message": "%s: %s" % (type(exc).__name__, exc)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--max-frame-len", type=int, required=True)
    parser.add_argument("--spec", required=True, help="path to the flow spec JSON")
    parser.add_argument("--canary", required=True)
    parser.add_argument("--fake-local", default="", help="canned replies path; negative control")
    args = parser.parse_args()

    spec = json.load(open(args.spec))
    report = {
        "kernel": os.uname().release,
        "boot_id": open("/proc/sys/kernel/random/boot_id").read().strip(),
        "fake_local": bool(args.fake_local),
    }

    if args.fake_local:
        rpc = FakeRpc(json.load(open(args.fake_local)), spec["read_sql"])
        report["dialed"] = "in-guest (negative control)"
    else:
        client = VsockClient(VMADDR_CID_HOST, args.port, timeout_s=60.0)
        rpc = GuestRpc({"DB_PORT": client}, args.max_frame_len)
        report["dialed"] = "AF_VSOCK (%d, %d)" % (VMADDR_CID_HOST, args.port)

    report.update(_run_flow(rpc, spec["read_sql"], spec["write_sql"],
                            spec["escape_sqls"], args.max_frame_len))
    report["dump"] = _dump_self(args.canary)
    print(json.dumps(report))


if __name__ == "__main__":
    main()
'''


# ---------------------------------------------------------------------------
# Postgres provisioning — the host-specific half (host-only, untested off-host)
# ---------------------------------------------------------------------------


class PostgresFixture:
    """Stands up (or adopts) the Postgres the broker serves, and tears it down.

    Two postures:

    * **provisioned** (default): with no `TRELLIS_PG_DSN` in the environment,
      create `trellis_db`, the fixture table, and the least-privilege login role
      from the shipped DDL, all via `sudo -u postgres psql`. A random password is
      generated and held here host-side; the role's DSN is what the broker reads.
    * **external** (`--external-pg`): the environment already names the server -
      `TRELLIS_PG_ADMIN_DSN` for setup, `TRELLIS_PG_DSN` for the broker. Setup is
      still run (idempotent) so the fixture and role exist.

    Nothing here is under off-host test: it runs `sudo`, `psql`, and (maybe)
    `apt-get`, none of which belong in a unit test. The verdict logic that reads
    what this produces is tested; this is the host affordance that produces it.
    """

    def __init__(self, *, external: bool) -> None:
        self.external = external
        self.role = DEFAULT_PG_ROLE
        self.password = secrets.token_urlsafe(24)
        self.admin_dsn = os.environ.get("TRELLIS_PG_ADMIN_DSN")
        self.ro_dsn = os.environ.get("TRELLIS_PG_DSN")
        self.facts: dict = {"external": external, "role": self.role}

    # -- lifecycle ----------------------------------------------------------

    def setup(self, caps) -> None:
        if self.external:
            if not self.admin_dsn:
                raise probe.ProbeError(
                    "--external-pg needs TRELLIS_PG_ADMIN_DSN (a superuser DSN) to "
                    "create the fixture and role."
                )
            if not self.ro_dsn:
                raise probe.ProbeError(
                    "--external-pg needs TRELLIS_PG_DSN (the read-only role's DSN) "
                    "for the broker."
                )
        else:
            self._ensure_server()
            self.admin_dsn = None  # peer auth as the postgres OS user, via sudo
            self.ro_dsn = (
                f"host=127.0.0.1 port=5432 dbname={PG_DATABASE} "
                f"user={self.role} password={self.password}"
            )
        self._apply_ddl(caps)
        # The broker reads TRELLIS_PG_DSN host-side. Set it here, in this process
        # only; it is never written into the guest's environment.
        os.environ["TRELLIS_PG_DSN"] = self.ro_dsn
        os.environ.pop("TRELLIS_PG_ROLE", None)  # direct-login posture: nothing to SET ROLE to
        self.facts["dsn_set_host_side"] = True

    def teardown(self) -> None:
        if self.external:
            # Leave an operator's own server alone but drop what we created.
            self._psql(self.admin_dsn, f'DROP OWNED BY "{self.role}"; '
                                       f'DROP ROLE IF EXISTS "{self.role}";', check=False)
            return
        # Provisioned: drop the role; the throwaway db/table can stay for --keep.
        self._psql_admin(f'DROP OWNED BY "{self.role}"; DROP ROLE IF EXISTS "{self.role}";',
                         check=False)

    # -- setup steps --------------------------------------------------------

    def _ensure_server(self) -> None:
        """Ensure a running Postgres on 127.0.0.1:5432. Best effort, host-only."""
        if not _which("psql"):
            probe.run(["apt-get", "install", "-y", "postgresql"], timeout=600.0)
        # The Debian/Ubuntu package auto-starts a cluster; nudge it in case not.
        probe.run(["service", "postgresql", "start"], check=False, timeout=60.0)
        self.facts["server"] = "system postgresql on 127.0.0.1:5432"

    def _apply_ddl(self, caps) -> None:
        """Create the db, the fixture table, and the login role. Idempotent."""
        # Database + fixture, as the postgres superuser.
        self._psql_admin(f'CREATE DATABASE {PG_DATABASE};', check=False, database=None)
        fixture_sql = (
            f"DROP TABLE IF EXISTS {FIXTURE_TABLE};"
            f"CREATE TABLE {FIXTURE_TABLE} (id int PRIMARY KEY, label text, value int);"
            + "".join(
                f"INSERT INTO {FIXTURE_TABLE} (id, label, value) VALUES "
                f"({r[0]}, '{r[1]}', {r[2]});"
                for r in FIXTURE_ROWS
            )
        )
        self._psql_admin(fixture_sql, database=PG_DATABASE)

        # The least-privilege role, from the shipped DDL (direct-login posture),
        # then made loginable with the host-held password. Drop first so a re-run
        # rebuilds a clean role.
        self._psql_admin(f'DROP OWNED BY "{self.role}"; DROP ROLE IF EXISTS "{self.role}";',
                         check=False, database=PG_DATABASE)
        ddl = postgres_role_ddl(caps, role=self.role, database=PG_DATABASE)
        self._psql_admin(ddl, database=PG_DATABASE)
        self._psql_admin(f'ALTER ROLE "{self.role}" WITH LOGIN PASSWORD %s;'
                         % _sql_literal(self.password), database=PG_DATABASE)

    # -- psql plumbing ------------------------------------------------------

    def _psql_admin(self, sql: str, *, check: bool = True, database: str | None = PG_DATABASE) -> None:
        if self.external:
            self._psql(self.admin_dsn, sql, check=check, database=database)
        else:
            self._psql_sudo(sql, check=check, database=database)

    def _psql_sudo(self, sql: str, *, check: bool, database: str | None) -> None:
        argv = ["sudo", "-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1"]
        if database is not None:
            argv += ["-d", database]
        argv += ["-c", sql] if ";" not in sql.rstrip(";") else ["-f", "-"]
        self._run_psql(argv, sql, check)

    def _psql(self, dsn: str | None, sql: str, *, check: bool, database: str | None = PG_DATABASE) -> None:
        argv = ["psql", "-v", "ON_ERROR_STOP=1", dsn or ""]
        argv += ["-c", sql] if ";" not in sql.rstrip(";") else ["-f", "-"]
        self._run_psql(argv, sql, check)

    @staticmethod
    def _run_psql(argv: list[str], sql: str, check: bool) -> None:
        stdin = sql if argv[-1] == "-" else None
        completed = subprocess.run(argv, input=stdin, capture_output=True, text=True, timeout=120.0)
        if check and completed.returncode != 0:
            raise probe.ProbeError(
                f"psql exited {completed.returncode}: {completed.stderr.strip()}"
            )


def _sql_literal(value: str) -> str:
    """A single-quoted SQL string literal (password), doubling embedded quotes."""
    return "'" + value.replace("'", "''") + "'"


def _which(name: str) -> bool:
    return subprocess.run(["sh", "-c", f"command -v {name}"], capture_output=True).returncode == 0


# ---------------------------------------------------------------------------
# Host-side verdict logic — pure, and under off-host test
# ---------------------------------------------------------------------------


def assess_read(guest: dict, witness_accepted: int, failures: list[str]) -> dict:
    """Claim 1: the query crossed and the rows are the fixture's.

    The witness count is the load-bearing half - a guest answering itself
    produces perfectly good rows and never crosses, so `witness_accepted` is the
    only thing that separates the two. Two RPCs (run_query, materialize) must
    have arrived for the read alone.
    """
    record = {"witness_accepted": witness_accepted}
    if witness_accepted < 2:
        failures.append(
            f"the host accepted {witness_accepted} connections; the read makes two "
            "RPC calls (run_query, materialize), so nothing crossed the DB bridge"
        )
    if not guest.get("run_query_ok"):
        failures.append("run_query failed in the guest: " + str(guest.get("run_query_error")))
    if not guest.get("materialize_ok"):
        failures.append("materialize failed in the guest: " + str(guest.get("materialize_error")))
    rows = guest.get("rows")
    record["rows"] = rows
    record["rowcount"] = guest.get("rowcount")
    if rows != FIXTURE_ROWS:
        failures.append(f"the rows the guest read {rows!r} are not the fixture {FIXTURE_ROWS!r}")
    if guest.get("rowcount") != len(FIXTURE_ROWS):
        failures.append(
            f"run_query reported rowcount {guest.get('rowcount')}, not {len(FIXTURE_ROWS)}"
        )
    handle = guest.get("handle") or {}
    if handle.get("kind") != "result-set":
        failures.append(f"run_query returned a {handle.get('kind')!r} handle, not a result-set")
    return record


def assess_credential(guest: dict, secrets_: list[str], canary: str, failures: list[str]) -> dict:
    """Claim 2: the real credential is nowhere in the guest, and the grep works.

    `secrets_` are the real DSN and password; they stay host-side and are searched
    for here, never sent into the guest. The canary is a fake secret the guest was
    given: the same grep must find it, or a grep that matches nothing would pass
    the real claim by being broken (rule 19(c)).
    """
    blob = json.dumps(guest.get("dump", {}))
    canary_found = canary in blob
    leaked = [s for s in secrets_ if s and s in blob]
    record = {
        "canary_found": canary_found,
        "secret_found": bool(leaked),
        "surfaces_scanned": guest.get("dump", {}).get("surfaces_scanned"),
        "surfaces_not_scanned": guest.get("dump", {}).get("surfaces_not_scanned"),
    }
    if not canary_found:
        failures.append(
            "the credential grep did not find the planted canary: the grep instrument "
            "is broken, so its 'no secret found' result proves nothing"
        )
    if leaked:
        # Never print the secret itself; name only that one leaked and how.
        failures.append(
            f"{len(leaked)} real credential value(s) were found in the guest's dumped "
            "environment/argv/globals: the credential is not host-side-only"
        )
    return record


def assess_denials(guest: dict, failures: list[str]) -> dict:
    """Claims 3 and 4: the write and the escape primitives were refused."""
    write = guest.get("write", {})
    record = {"write_denied": bool(write.get("denied")), "escapes": {}}
    if not write.get("denied"):
        failures.append(f"the INSERT was not denied by the broker: {write}")
    for name, outcome in (guest.get("escapes") or {}).items():
        denied = bool(outcome.get("denied"))
        record["escapes"][name] = denied
        if not denied:
            failures.append(f"the escape primitive {name!r} was not denied: {outcome}")
    return record


def assess_role_write(direct_write_error: str | None, failures: list[str]) -> dict:
    """Claim 5: the role itself - no broker in the path - refused the write.

    `direct_write_error` is the string Postgres raised when the probe connected
    as the read-only role and issued the INSERT. A read-only-transaction refusal
    is the pass; anything else (including success) is a failure of the primary
    control.
    """
    record = {"direct_write_error": direct_write_error}
    text = (direct_write_error or "").lower()
    denied = ("read-only" in text) or ("read only" in text) or ("cannot execute" in text)
    record["role_denied_write"] = denied
    if direct_write_error is None:
        failures.append(
            "a direct INSERT as the read-only role SUCCEEDED: the NOSUPERUSER "
            "read-only role is not the primary control it is claimed to be"
        )
    elif not denied:
        failures.append(
            f"a direct INSERT as the read-only role failed for the wrong reason: "
            f"{direct_write_error!r} is not a read-only refusal"
        )
    return record


def assess_egress(extensions: list[str], failures: list[str]) -> dict:
    """Claim 6: no SQL-level egress origination. The weak one, labeled as such."""
    forbidden = [e for e in extensions if e in ("dblink", "postgres_fdw")]
    record = {
        "installed_extensions": extensions,
        "sql_egress_extensions_present": forbidden,
        "note": (
            "this is the honest weak proxy for requirement 6: it proves neither "
            "dblink nor postgres_fdw is installed, closing the SQL-level origination "
            "path. It is NOT a deny-by-default NIC boundary - that surface is not in "
            "the merged code and is deferred to GB."
        ),
    }
    if forbidden:
        failures.append(
            f"a network-originating extension is installed: {forbidden}; the DB can "
            "originate outbound connections from inside SQL"
        )
    return record


# ---------------------------------------------------------------------------
# The probe
# ---------------------------------------------------------------------------


def install_guest_payload(sandbox) -> None:
    """Ship only what S4's guest actually runs: the package, and nothing else.

    Deliberately *not* the S3 probe's `install_sources`, which also ships S3's
    guest probe, S3's control listener and S3's request JSON — none of which S4
    executes. Each of those is several chunked `ctr task exec` calls, and on this
    host `task exec` intermittently wedges for its full timeout (observed once in
    six consecutive runs, inside `install_sources`, writing a file S4 never uses).
    Every exec removed is one fewer window on that flake, so shipping less is a
    reliability change and not only a tidiness one.
    """
    sandbox.put_bytes(probe.source_tarball(), f"{GUEST_DIR}/repl_sandbox.tgz")
    sandbox.exec(
        f"cd {GUEST_DIR} && tar xzf repl_sandbox.tgz && python3 -c "
        f"'import sys; sys.path.insert(0, \"{GUEST_DIR}\"); import repl_sandbox'",
        exec_id="unpack",
    )


def _canned_replies() -> dict:
    """The replies the negative-control guest answers itself with.

    Built from the known fixture so the fabricated rows are byte-plausible - the
    control tests a guest that replays a *correct-looking protocol*, which is the
    case a cheating guest would actually attempt, not a strawman.
    """
    return {
        "run_query": {"handle": {"id": "canned-handle", "kind": "result-set"},
                      "rowcount": len(FIXTURE_ROWS),
                      "schema": [{"name": "id"}, {"name": "label"}, {"name": "value"}]},
        "materialize": {"rows": FIXTURE_ROWS, "truncated": False},
    }


def _direct_role_write() -> str | None:
    """Connect as the read-only role, attempt the INSERT, return Postgres' error.

    No broker in the path: this is the primary control - the role itself - shown
    on its own. Returns the error string on refusal, or `None` if the write
    unexpectedly succeeded.
    """
    import psycopg2  # local import: never at module scope, host-only

    dsn = os.environ["TRELLIS_PG_DSN"]
    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()
        try:
            cur.execute(WRITE_SQL)
            conn.commit()
            return None  # it succeeded - the control failed
        except Exception as exc:  # noqa: BLE001 - the refusal string is the datum
            conn.rollback()
            return f"{type(exc).__name__}: {exc}".strip()
        finally:
            cur.close()
    finally:
        conn.close()


def _installed_extensions() -> list[str]:
    """The extensions installed in the fixture database, read as the RO role."""
    import psycopg2  # local import: host-only

    conn = psycopg2.connect(os.environ["TRELLIS_PG_DSN"])
    try:
        cur = conn.cursor()
        try:
            cur.execute("SELECT extname FROM pg_extension ORDER BY extname")
            return [row[0] for row in cur.fetchall()]
        finally:
            cur.close()
    finally:
        conn.close()


def probe_s4(
    image: str,
    *,
    negative_control: bool,
    external_pg: bool,
    keep: bool,
) -> tuple[dict, list[str]]:
    """Run the S4 claims. Returns (record, failures)."""
    record: dict = {"mode": "negative-control" if negative_control else "default"}
    failures: list[str] = []
    record["host"] = probe.preconditions()

    config = SandboxConfig()
    canary = f"postgresql://canary:{uuid.uuid4().hex}@canary.invalid/db"

    # -- provision (or adopt) the Postgres the broker serves ------------------
    fixture = PostgresFixture(external=external_pg)
    fixture.setup(config.broker_caps)
    record["postgres"] = dict(fixture.facts)
    # The real secret values - held here, searched for in the guest dump, never
    # placed in `record` (which is printed) and never sent into the guest.
    real_secrets = [os.environ["TRELLIS_PG_DSN"], fixture.password]

    audit = AuditLog()
    backend = postgres_backend_from_env(config.broker_caps)  # reads TRELLIS_PG_DSN host-side
    host = TrellisSandboxHost(
        config=config,
        backends={"postgres": backend},
        provider=probe.ScriptedProvider(),
        audit=audit,
    )
    host.open_session(GUEST_CID, "s4-guest", ops=GRANTED_OPS, lm=False)

    name = f"s4-{uuid.uuid4().hex[:10]}"
    sandbox = probe.Sandbox(name, image)
    record["sandbox"] = name
    record["image"] = image

    witness = probe.Witness()
    listener = None
    stop = threading.Event()
    server: threading.Thread | None = None

    started = time.monotonic()
    sandbox.boot()
    record["ctr_run_detached_seconds"] = round(time.monotonic() - started, 3)

    try:
        record["guest"] = sandbox.guest_identity()
        if record["guest"]["kernel"] == record["host"]["host_kernel"]:
            failures.append(
                f"guest kernel equals host kernel ({record['guest']['kernel']}): "
                "this is not a VM boundary and the query would cross no bridge"
            )

        # -- the host end of the DB bridge (hybrid vsock, on config.ports.db) --
        discovered = probe.discover_vsock_uds(sandbox)
        record["bridge"] = {"kind": "hybrid", **discovered}
        listener = HybridVsockListener(
            discovered["uds_path"],
            config.ports.db,
            GUEST_CID,
            accept_timeout_s=0.05,
            read_timeout_s=60.0,
        )
        record["bridge"]["listen_path"] = listener.path
        record["bridge"]["port"] = config.ports.db

        server = threading.Thread(
            target=serve_forever,
            args=(
                listener,
                witness.counted(host.broker_handler),
                config.max_frame_len,
                witness.audit,
                stop,
            ),
            daemon=True,
        )
        server.start()

        # -- ship sources + the guest program + the flow spec -----------------
        install_guest_payload(sandbox)
        sandbox.put_bytes(GUEST_DB_SOURCE.encode(), f"{GUEST_DIR}/guest_db.py")
        sandbox.put_bytes(
            json.dumps({
                "read_sql": READ_SQL,
                "write_sql": WRITE_SQL,
                "escape_sqls": ESCAPE_SQLS,
            }).encode(),
            f"{GUEST_DIR}/spec.json",
        )
        if negative_control:
            sandbox.put_bytes(json.dumps(_canned_replies()).encode(), f"{GUEST_DIR}/canned.json")

        # -- drive the guest --------------------------------------------------
        command = (
            f"cd {GUEST_DIR} && python3 guest_db.py --port {config.ports.db} "
            f"--max-frame-len {config.max_frame_len} --spec {GUEST_DIR}/spec.json "
            f"--canary {canary}"
        )
        if negative_control:
            command += f" --fake-local {GUEST_DIR}/canned.json"
        raw = sandbox.exec(command, exec_id=f"s4-{uuid.uuid4().hex[:8]}", timeout=180.0)
        try:
            guest = json.loads(raw.strip().splitlines()[-1])
        except (ValueError, IndexError) as exc:
            raise probe.ProbeError(f"the guest produced no parsable report: {raw!r}") from exc
        record["guest_report"] = guest
        record["witness"] = {"accepted": witness.accepted, "requests": witness.requests}

        # -- the claims -------------------------------------------------------
        record["read"] = assess_read(guest, witness.accepted, failures)
        record["credential"] = assess_credential(guest, real_secrets, canary, failures)
        record["denials"] = assess_denials(guest, failures)

        # Claims 5 and 6 are host-side facts about the real Postgres, not the
        # guest's report - a self-answering guest cannot touch them, so they run
        # every mode. In the negative control they still pass (the DB is real);
        # only the witness catches the fabricated crossing.
        record["role_write"] = assess_role_write(_direct_role_write(), failures)
        record["egress"] = assess_egress(_installed_extensions(), failures)

        # -- claim 7: identity is the host's ----------------------------------
        host.close_session(GUEST_CID)
        after = sandbox.exec(
            f"cd {GUEST_DIR} && python3 guest_db.py --port {config.ports.db} "
            f"--max-frame-len {config.max_frame_len} --spec {GUEST_DIR}/spec.json "
            f"--canary {canary}"
            + (f" --fake-local {GUEST_DIR}/canned.json" if negative_control else ""),
            exec_id=f"s4-after-{uuid.uuid4().hex[:8]}",
            timeout=120.0,
        )
        try:
            after_report = json.loads(after.strip().splitlines()[-1])
        except (ValueError, IndexError):
            after_report = {}
        record["after_close"] = {"run_query_ok": after_report.get("run_query_ok")}
        if not negative_control and after_report.get("run_query_ok"):
            failures.append(
                "the guest was still served after the host closed its session: "
                "identity is not being resolved host-side"
            )

        # -- claim 8: teardown ------------------------------------------------
        if keep:
            record["teardown"] = "skipped (--keep)"
        else:
            stop.set()
            if server is not None:
                server.join(timeout=10.0)
            socket_path = getattr(listener, "path", None)
            listener.close()
            listener = None
            sandbox.destroy()
            time.sleep(2.0)
            record["teardown"] = {
                "socket_removed": (socket_path is None) or (not os.path.exists(socket_path)),
                "listed_after_delete": sandbox.listed(),
                "vmm_processes_after_delete": sandbox.vmm_processes(),
            }
            if not record["teardown"]["socket_removed"]:
                failures.append(f"the listener socket {socket_path} survived teardown")
            if record["teardown"]["listed_after_delete"]:
                failures.append("the container is still listed by containerd after delete")
            if record["teardown"]["vmm_processes_after_delete"]:
                failures.append("a cloud-hypervisor process for this sandbox survived teardown")
    finally:
        stop.set()
        if server is not None:
            server.join(timeout=10.0)
        if listener is not None:
            try:
                listener.close()
            except OSError:
                pass
        host.close()
        backend.close()
        if not keep:
            sandbox.destroy()
            fixture.teardown()

    record["audit_events"] = witness.named()
    return record, failures


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--image", default=probe.DEFAULT_IMAGE)
    parser.add_argument("--negative-control", action="store_true")
    parser.add_argument("--external-pg", action="store_true")
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    try:
        record, failures = probe_s4(
            args.image,
            negative_control=args.negative_control,
            external_pg=args.external_pg,
            keep=args.keep,
        )
    except probe.ProbeError as exc:
        print(f"S4 probe could not run: {exc}", file=sys.stderr)
        return 1
    except subprocess.TimeoutExpired as exc:
        # The Kata shim intermittently wedges on `ctr task exec` and the call
        # burns its whole timeout. That is infrastructure failing to run the
        # probe, not a claim about the bridge failing — the distinction
        # `ProbeError` exists to keep. Unwrapped it surfaced as a bare traceback,
        # which reads like the boundary broke when nothing about it was tested.
        # Teardown still ran: the raise happens inside the probe's `finally`.
        argv = exc.cmd if isinstance(exc.cmd, list) else [str(exc.cmd)]
        print(
            f"S4 probe could not run: `{' '.join(str(a) for a in argv[:4])} ...` timed out "
            f"after {exc.timeout:.0f}s. This is the intermittent Kata-shim `task exec` "
            "hang, not a failed claim. Re-run.",
            file=sys.stderr,
        )
        return 1

    record["failures"] = failures
    if args.json:
        print(json.dumps(record, indent=2, default=str))
    else:
        print(f"sandbox      {record['sandbox']} ({record['image']})")
        bridge = record.get("bridge", {})
        print(f"listener     {bridge.get('listen_path', '-')} (port {bridge.get('port')})")
        print(f"postgres     {record.get('postgres', {}).get('server', 'external')}")
        print(f"host kernel  {record['host']['host_kernel']}")
        print(f"guest kernel {record.get('guest', {}).get('kernel')}")
        w = record.get("witness", {})
        print(f"witness      accepted={w.get('accepted')} requests={w.get('requests')}")
        read = record.get("read", {})
        print(f"rows         {read.get('rows')}  (fixture {FIXTURE_ROWS})")
        cred = record.get("credential", {})
        print(f"credential   canary_found={cred.get('canary_found')} "
              f"secret_found={cred.get('secret_found')}")
        den = record.get("denials", {})
        print(f"denials      write_denied={den.get('write_denied')} escapes={den.get('escapes')}")
        role = record.get("role_write", {})
        print(f"role write   role_denied_write={role.get('role_denied_write')}")
        egr = record.get("egress", {})
        print(f"egress       extensions={egr.get('installed_extensions')} "
              f"(weak proxy; not a NIC boundary)")
        print(f"teardown     {record.get('teardown')}")
        for failure in failures:
            print(f"FAIL  {failure}")

    if args.negative_control:
        if failures:
            print("negative control: DETECTED - the probe can tell a crossed DB "
                  "boundary from a guest answering itself.")
            return 3
        print("negative control: ABSORBED - the probe passed a guest that never "
              "dialed the DB port. It proves nothing about the bridge.", file=sys.stderr)
        return 1
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
