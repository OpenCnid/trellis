"""REPL-sandbox refusal drill (zero-paid, zero-LLM, zero-infra).

Specification: docs/product/repl-sandbox/REPL_SANDBOX_INTERFACES.md section 7
(Error model) for the taxonomy each refusal must produce, section 5 (DB-broker
RPC surface) for the identity and dispatch discipline, section 4 (LM-handler RPC
surface) for the depth and spend ceilings, and
REPL_SANDBOX_DATA_MODEL.md section 2 (Namespace, allocation, lifecycle,
revocation) for the CID-scoped handle namespace.
Entrypoint: `npm run repl-sandbox:drill` (the non-test caller, AGENTS.md
section 4 rule 15).

Every refusal below is driven end to end through `repl_sandbox.host`, the same
composition root a deployment builds, over in-process doubles: no database, no
provider, no socket, no key, no money.

Modes:
  default             run every refusal; exit 0 iff all of them fire
  --negative-control  plant one deliberate break behind each refusal and assert
                      the drill DETECTS it. Healthy behaviour is detection:
                      exit 3 with all nine named. Exit 1 (absorbed) means the
                      drill cannot fail and therefore proves nothing
                      (.claude/rules/measurement-and-reporting.md rule 19(c)).
  --verbose           print each refusal's message as well as its code

**What this drill is not.** It exercises the host-side control plane. The
boundary is the Kata microVM (REPL_SANDBOX_ARCHITECTURE.md section 2) plus the
data-flow property that the guest holds handles rather than payloads (section
3.1). Nothing here boots a VM and nothing here can test one.
"""

from __future__ import annotations

import argparse
import struct
import sys
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Callable

REPO_ROOT = Path(__file__).resolve().parent.parent
SRC = REPO_ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from repl_sandbox import broker as broker_module  # noqa: E402
from repl_sandbox.backends import Neo4jBackend, PostgresBackend  # noqa: E402
from repl_sandbox.broker import Broker, DispatchTable, ResultSet  # noqa: E402
from repl_sandbox.config import SandboxConfig  # noqa: E402
from repl_sandbox.errors import FrameError, SandboxError  # noqa: E402
from repl_sandbox.frame import encode_frame, buffer_recv, read_frame  # noqa: E402
from repl_sandbox.handles import HandleEntry, HandleTable  # noqa: E402
from repl_sandbox.host import TrellisSandboxHost  # noqa: E402
from repl_sandbox.lm_handler import PromptValue, error_code_of  # noqa: E402
from repl_sandbox.policy import ApocAllowlist  # noqa: E402
from repl_sandbox.session import SessionTable  # noqa: E402

#: Two live sessions, so the CID-scoped handle namespace has a second session to
#: be scoped against.
CID_A = 3
CID_B = 4
#: A CID no session ever bound.
CID_UNKNOWN = 9

#: The drill's own frame bound, deliberately small so an over-cap frame is a
#: 100 KiB payload rather than a 16 MiB one. The bound under test is the
#: comparison, not the number.
DRILL_MAX_FRAME_LEN = 64 * 1024


# ---------------------------------------------------------------------------
# In-process doubles. No driver, no credential, no socket, no cost.
# ---------------------------------------------------------------------------


class FakeCursor:
    """A DBAPI cursor over a fixed table. Executes nothing."""

    def __init__(self, rows: list[list], description: tuple) -> None:
        self._rows = rows
        self.description = description
        self._served = False
        self.statements: list[str] = []

    def execute(self, sql: str, params: Any = None) -> None:
        self.statements.append(sql)

    def fetchmany(self, size: int) -> list[list]:
        if self._served:
            return []
        self._served = True
        return [list(row) for row in self._rows]

    def close(self) -> None:
        return None


class FakeConnection:
    """A DBAPI connection over `FakeCursor`. Holds no socket and no credential."""

    def __init__(self, rows: list[list], description: tuple) -> None:
        self._rows = rows
        self._description = description
        self.cursors: list[FakeCursor] = []

    def cursor(self) -> FakeCursor:
        cur = FakeCursor(self._rows, self._description)
        self.cursors.append(cur)
        return cur

    def commit(self) -> None:
        return None

    def rollback(self) -> None:
        return None

    def close(self) -> None:
        return None


class FakeRecord:
    def __init__(self, values: list) -> None:
        self._values = values

    def values(self) -> list:
        return list(self._values)


class FakeBoltResult:
    def __init__(self, rows: list[list], keys: list[str]) -> None:
        self._rows = rows
        self._keys = keys

    def keys(self) -> list[str]:
        return list(self._keys)

    def __iter__(self):
        return iter(FakeRecord(row) for row in self._rows)


class FakeTransaction:
    def __init__(self, rows: list[list], keys: list[str]) -> None:
        self._rows = rows
        self._keys = keys
        self.queries: list[str] = []

    def run(self, query: str, params: dict) -> FakeBoltResult:
        self.queries.append(query)
        return FakeBoltResult(self._rows, self._keys)

    def close(self) -> None:
        return None


class FakeBoltSession:
    def __init__(self, rows: list[list], keys: list[str], kwargs: dict) -> None:
        self._rows = rows
        self._keys = keys
        self.kwargs = kwargs

    def begin_transaction(self, timeout: float | None = None) -> FakeTransaction:
        return FakeTransaction(self._rows, self._keys)

    def close(self) -> None:
        return None


class FakeBoltDriver:
    """A Bolt driver double. Opens no connection; records the session kwargs."""

    def __init__(self, rows: list[list], keys: list[str]) -> None:
        self._rows = rows
        self._keys = keys
        self.sessions: list[FakeBoltSession] = []

    def session(self, **kwargs: Any) -> FakeBoltSession:
        session = FakeBoltSession(self._rows, self._keys, kwargs)
        self.sessions.append(session)
        return session

    def close(self) -> None:
        return None


class CostlyProvider:
    """A `Provider` that reports a real dollar cost without making a call.

    The cost is what the spend ledger is fed, and a ledger is only as real as the
    number it is fed. `usd` is a constructor argument so the drill can drive a
    session past the cap without a paid API anywhere in the picture.
    """

    def __init__(self, usd: float) -> None:
        self.usd = float(usd)
        self.calls = 0

    def complete(self, prompt: PromptValue, model: str | None) -> tuple[dict, float]:
        self.calls += 1
        return {"root_model": model or "drill-double", "response": "ok"}, self.usd

    def complete_batched(
        self, prompts: list[PromptValue], model: str | None
    ) -> tuple[list[dict], float]:
        return [self.complete(p, model)[0] for p in prompts], self.usd * len(prompts)


# ---------------------------------------------------------------------------
# The planted breaks. Each one removes exactly one refusal.
# ---------------------------------------------------------------------------


class AlwaysBoundSessionTable(SessionTable):
    """PLANTED BREAK: every CID resolves to a session, including one never bound."""

    def session_for(self, cid: int) -> str:
        return f"forged-session-{cid}"


class AlwaysAllowDispatch(DispatchTable):
    """PLANTED BREAK: every `(cid, op)` routes, granted or not."""

    def resolve_ref(self, cid: int, op: str) -> str:
        return f"forged.ref.{op}"

    def allows(self, cid: int, op: str) -> bool:
        return True


class CrossSessionHandleTable(HandleTable):
    """PLANTED BREAK: resolution ignores the CID, so any session reads any handle."""

    def resolve(self, cid: int, handle_id: str) -> HandleEntry:
        for (_owner, hid), entry in self._entries.items():
            if hid == handle_id and entry.state == "live":
                return entry
        return super().resolve(cid, handle_id)


class NeverChargingSpendLedger:
    """PLANTED BREAK: a dollar ledger that records nothing and never stops."""

    def __init__(self, cap_usd: float) -> None:
        self.cap_usd = cap_usd

    def charge(self, cid: int, usd: float) -> None:
        return None

    def spent(self, cid: int) -> float:
        return 0.0

    def remaining(self, cid: int) -> float:
        return self.cap_usd

    def is_exhausted(self, cid: int) -> bool:
        return False

    def close(self, cid: int) -> None:
        return None


def _permissive_validate_envelope(broker: Broker) -> Callable[[object], dict]:
    """PLANTED BREAK: an envelope check that drops caller-supplied routing keys.

    The real `_validate_envelope` refuses a request carrying `dispatch_ref`,
    `cid`, `session`, or `session_id`. This one strips them and carries on, which
    is what "the broker quietly tolerates a guest-supplied routing token" looks
    like from the outside.
    """

    def patched(request: object) -> dict:
        if isinstance(request, dict):
            cleaned = {k: v for k, v in request.items() if k not in broker_module.FORBIDDEN_KEYS}
            args = cleaned.get("args")
            if isinstance(args, dict):
                cleaned["args"] = {
                    k: v for k, v in args.items() if k not in broker_module.FORBIDDEN_KEYS
                }
            request = cleaned
        return Broker._validate_envelope(broker, request)

    return patched


# ---------------------------------------------------------------------------
# The world under drill
# ---------------------------------------------------------------------------


@dataclass
class World:
    config: SandboxConfig
    host: TrellisSandboxHost
    provider: CostlyProvider
    postgres: PostgresBackend
    neo4j: Neo4jBackend
    undo: list[Callable[[], None]]

    def close(self) -> None:
        for undo in reversed(self.undo):
            undo()
        self.undo.clear()
        self.host.close()


def build_world(spend_usd: float = 5.0) -> World:
    """Compose a complete host over doubles, with two sessions open.

    Session A (CID 3) holds `run_query`, `run_cypher`, `slice`, `resolve_meta`
    and the two pre-registered LM capabilities. It deliberately does NOT hold
    `materialize`, which is the ungranted op the drill calls.
    Session B (CID 4) holds `run_query` and `slice`, so the cross-CID handle
    refusal is about the handle's namespace and not about a missing grant.
    """
    config = SandboxConfig(
        max_frame_len=DRILL_MAX_FRAME_LEN,
        lm_caps=replace(SandboxConfig().lm_caps, spend_usd=spend_usd),
    )
    rows = [[1, "alpha"], [2, "beta"], [3, "gamma"]]
    connection = FakeConnection(rows, (("id", 23), ("label", 25)))
    postgres = PostgresBackend(connect=lambda: connection, caps=config.broker_caps)
    driver = FakeBoltDriver(rows, ["id", "label"])
    neo4j = Neo4jBackend(driver_factory=lambda: driver, caps=config.broker_caps)
    provider = CostlyProvider(usd=0.01)

    host = TrellisSandboxHost(
        config=config,
        backends={"postgres": postgres, "neo4j": neo4j},
        provider=provider,
    )
    host.open_session(
        CID_A, "drill-a", ops=["run_query", "run_cypher", "slice", "resolve_meta"]
    )
    host.open_session(CID_B, "drill-b", ops=["run_query", "slice"])
    return World(
        config=config,
        host=host,
        provider=provider,
        postgres=postgres,
        neo4j=neo4j,
        undo=[],
    )


# ---------------------------------------------------------------------------
# Outcomes
# ---------------------------------------------------------------------------


@dataclass
class Outcome:
    """What one refusal check observed."""

    fired: bool
    code: str
    detail: str


def _envelope_outcome(response: dict, expected: str) -> Outcome:
    """Read a broker `v1` response as a refusal outcome."""
    if response.get("ok") is not False:
        return Outcome(False, "ok", "the call SUCCEEDED; no refusal fired")
    error = response.get("error") or {}
    code = str(error.get("code"))
    return Outcome(code == expected, code, str(error.get("message")))


def _lm_outcome(response: dict, expected: str) -> Outcome:
    code = error_code_of(response)
    if code is None:
        return Outcome(False, "ok", "the LM call SUCCEEDED; no refusal fired")
    return Outcome(code == expected, code, str(response.get("error")))


def _request(op: str, args: dict, req_id: str = "drill", **extra: Any) -> dict:
    request: dict = {"v": 1, "req_id": req_id, "op": op, "args": args}
    request.update(extra)
    return request


def _handle_of(world: World, cid: int) -> dict:
    """Run a granted query for `cid` and return the handle it was given."""
    response = world.host.broker_handler(
        cid, _request("run_query", {"sql": "SELECT id, label FROM t"})
    )
    if response.get("ok") is not True:
        raise SandboxError(f"drill setup failed: {response.get('error')}")
    return response["result"]["handle"]


# ---------------------------------------------------------------------------
# The nine refusals
# ---------------------------------------------------------------------------


def check_unknown_cid(world: World) -> Outcome:
    """A CID no session bound is refused `auth` before anything else runs."""
    return _envelope_outcome(
        world.host.broker_handler(
            CID_UNKNOWN, _request("run_query", {"sql": "SELECT 1"})
        ),
        "auth",
    )


def plant_unknown_cid(world: World) -> None:
    """Forge a session for every CID, with the grants such a session would carry.

    Both halves are one break: a CID that resolves to a session is a CID that
    holds that session's capabilities. Planting only the lookup would leave the
    call refused by the dispatch table for an unrelated reason, and a check that
    passes for the wrong reason is not the check being proven.
    """
    world.host.broker.sessions = AlwaysBoundSessionTable(world.host.audit)
    world.host.dispatch.grant(CID_UNKNOWN, "run_query", "trellis.db.v1.run_query")


def check_forged_dispatch_ref(world: World) -> Outcome:
    """A request carrying its own routing token is refused, not obeyed."""
    return _envelope_outcome(
        world.host.broker_handler(
            CID_A,
            _request(
                "run_query",
                {"sql": "SELECT 1"},
                dispatch_ref="trellis.db.v1.materialize",
            ),
        ),
        "denied",
    )


def plant_forged_dispatch_ref(world: World) -> None:
    world.host.broker._validate_envelope = _permissive_validate_envelope(  # type: ignore[method-assign]
        world.host.broker
    )


def check_ungranted_op(world: World) -> Outcome:
    """An op this session was never granted has no dispatch path."""
    handle = _handle_of(world, CID_A)
    return _envelope_outcome(
        world.host.broker_handler(CID_A, _request("materialize", {"handle": handle})),
        "denied",
    )


def plant_ungranted_op(world: World) -> None:
    world.host.broker.dispatch = AlwaysAllowDispatch()


def check_cross_cid_handle(world: World) -> Outcome:
    """One session's handle does not resolve in another's namespace."""
    handle = _handle_of(world, CID_A)
    return _envelope_outcome(
        world.host.broker_handler(
            CID_B,
            _request("slice", {"handle": handle, "span": {"start": 0, "end": 2}}),
        ),
        "denied",
    )


def plant_cross_cid_handle(world: World) -> None:
    world.host.broker.handles = CrossSessionHandleTable(
        world.config.handle_ttl_s, audit=world.host.audit
    )


def check_depth_ceiling(world: World) -> Outcome:
    """An `LMRequest` above the host-derived depth ceiling is refused."""
    return _lm_outcome(
        world.host.lm_handler(CID_A, {"prompt": "recurse", "depth": 2}),
        "depth_ceiling",
    )


def plant_depth_ceiling(world: World) -> None:
    world.host.lm._config = replace(
        world.config, lm_caps=replace(world.config.lm_caps, depth_ceiling=99)
    )


def check_spend_cap(world: World) -> Outcome:
    """The dollar ledger hard-stops the session, and the stop is terminal."""
    world.provider.usd = world.config.lm_caps.spend_usd * 2
    return _lm_outcome(world.host.lm_handler(CID_A, {"prompt": "expensive"}), "cap_spend")


def plant_spend_cap(world: World) -> None:
    world.host.lm._spend = NeverChargingSpendLedger(  # type: ignore[assignment]
        world.config.lm_caps.spend_usd
    )


def check_oversized_frame(world: World) -> Outcome:
    """A frame over `max_frame_len` is refused on its declared length.

    The host's bound is compared against the four-byte prefix before a buffer of
    that size is read, so the refusal costs four bytes whatever the peer claims.
    """
    payload = _request("run_query", {"sql": "S" * 100_000})
    # A hostile guest's own encoder is not bounded by the host's number.
    hostile_wire = encode_frame(payload, 4 * 1024 * 1024)
    declared = struct.unpack(">I", hostile_wire[:4])[0]
    try:
        read_frame(buffer_recv(hostile_wire), world.host.config.max_frame_len)
    except FrameError as exc:
        return Outcome(True, exc.code, exc.message)
    return Outcome(
        False,
        "ok",
        f"a {declared}-byte frame was ACCEPTED against a "
        f"{world.host.config.max_frame_len}-byte bound",
    )


def plant_oversized_frame(world: World) -> None:
    world.host.config = replace(world.config, max_frame_len=4 * 1024 * 1024)


def check_denied_sql_primitive(world: World) -> Outcome:
    """A statement naming a server-file primitive never reaches a driver."""
    return _envelope_outcome(
        world.host.broker_handler(
            CID_A,
            _request(
                "run_query",
                {"sql": "SELECT pg_read_server_files('/etc/passwd')"},
            ),
        ),
        "denied",
    )


def plant_denied_sql_primitive(world: World) -> None:
    original = broker_module.inspect_sql
    broker_module.inspect_sql = lambda sql: None  # type: ignore[assignment]
    world.undo.append(lambda: setattr(broker_module, "inspect_sql", original))


def check_denied_apoc_procedure(world: World) -> Outcome:
    """APOC is deny-by-default; `READ` access mode does not cover `apoc.load.*`."""
    return _envelope_outcome(
        world.host.broker_handler(
            CID_A,
            _request(
                "run_cypher",
                {
                    "query": (
                        "CALL apoc.load.json('http://169.254.169.254/') "
                        "YIELD value RETURN value"
                    )
                },
            ),
        ),
        "denied",
    )


def plant_denied_apoc_procedure(world: World) -> None:
    world.host.broker.apoc = ApocAllowlist(frozenset({"apoc.*"}))


@dataclass
class Refusal:
    """One refusal, its check, and the break planted to prove the check can fail."""

    name: str
    expect: str
    check: Callable[[World], Outcome]
    plant: Callable[[World], None]
    plant_note: str


REFUSALS: tuple[Refusal, ...] = (
    Refusal(
        "unknown CID",
        "auth",
        check_unknown_cid,
        plant_unknown_cid,
        "a session table that binds every CID, with that session's grants",
    ),
    Refusal(
        "forged dispatch_ref",
        "denied",
        check_forged_dispatch_ref,
        plant_forged_dispatch_ref,
        "an envelope check that strips caller-supplied routing keys",
    ),
    Refusal(
        "ungranted op",
        "denied",
        check_ungranted_op,
        plant_ungranted_op,
        "a dispatch table that routes every op",
    ),
    Refusal(
        "cross-CID handle",
        "denied",
        check_cross_cid_handle,
        plant_cross_cid_handle,
        "a handle table that resolves without the CID",
    ),
    Refusal(
        "depth-2 LM request",
        "depth_ceiling",
        check_depth_ceiling,
        plant_depth_ceiling,
        "a depth ceiling raised to 99",
    ),
    Refusal(
        "spend-cap exhaustion",
        "cap_spend",
        check_spend_cap,
        plant_spend_cap,
        "a dollar ledger that never charges",
    ),
    Refusal(
        "oversized frame",
        "frame",
        check_oversized_frame,
        plant_oversized_frame,
        "a max_frame_len raised above the frame",
    ),
    Refusal(
        "denied SQL primitive",
        "denied",
        check_denied_sql_primitive,
        plant_denied_sql_primitive,
        "a SQL inspector that denies nothing",
    ),
    Refusal(
        "denied APOC procedure",
        "denied",
        check_denied_apoc_procedure,
        plant_denied_apoc_procedure,
        "an APOC allowlist that permits apoc.*",
    ),
)


def run_refusal(refusal: Refusal, *, plant: bool) -> Outcome:
    """Build a fresh world, optionally plant the break, and run the check."""
    world = build_world()
    try:
        if plant:
            refusal.plant(world)
        try:
            return refusal.check(world)
        except SandboxError as exc:
            # A refusal raised rather than returned is still a refusal; the LM
            # handler raises `AuthError` by design.
            return Outcome(exc.code == refusal.expect, exc.code, exc.message)
    finally:
        world.close()


# ---------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------


def run_drill(verbose: bool) -> int:
    print("Trellis REPL sandbox - refusal drill (zero-paid, zero-infra)")
    print("Every refusal is driven through repl_sandbox.host over in-process doubles.")
    print("")
    print(f"{'REFUSAL':<24} {'EXPECT':<14} {'OBSERVED':<14} RESULT")
    print("-" * 72)

    failed: list[str] = []
    for refusal in REFUSALS:
        outcome = run_refusal(refusal, plant=False)
        status = "PASS" if outcome.fired else "FAIL"
        if not outcome.fired:
            failed.append(refusal.name)
        print(
            f"{refusal.name:<24} {refusal.expect:<14} {outcome.code:<14} {status}"
        )
        if verbose or not outcome.fired:
            print(f"{'':<24} {outcome.detail}")

    print("-" * 72)
    fired = len(REFUSALS) - len(failed)
    exit_code = 0 if not failed else 1
    print(
        f"summary: {len(REFUSALS)} refusals, {fired} fired, {len(failed)} failed, "
        f"exit {exit_code}"
    )
    if failed:
        print("FAILED: " + ", ".join(failed))
        print(
            "A refusal that did not fire is a control that is documented and not "
            "enforced. Fix the control, never the drill."
        )
    return exit_code


def run_negative_control() -> int:
    print("Trellis REPL sandbox - refusal drill, NEGATIVE CONTROL")
    print(
        "One deliberate break is planted behind each refusal. Healthy behaviour "
        "is DETECTION: the drill must observe every planted break and exit 3."
    )
    print("")

    detections: list[tuple[str, bool, str]] = []
    for refusal in REFUSALS:
        outcome = run_refusal(refusal, plant=True)
        # The break removed the refusal, so the check must NOT see it fire.
        detected = not outcome.fired
        detections.append((refusal.name, detected, outcome.detail))

    for name, detected, detail in detections:
        refusal = next(r for r in REFUSALS if r.name == name)
        verdict = "detected" if detected else "ABSORBED"
        print(f"NEGATIVE-CONTROL {verdict}: {name} (planted: {refusal.plant_note})")
        print(f"    observed: {detail}")

    all_detected = all(detected for _name, detected, _detail in detections)
    print("")
    if all_detected:
        print(
            f"NEGATIVE-CONTROL ok: all {len(REFUSALS)} planted breaks detected and "
            "named. Healthy exit is nonzero (3)."
        )
        return 3
    absorbed = [name for name, detected, _ in detections if not detected]
    print(
        "NEGATIVE-CONTROL FAILURE: a planted break was ABSORBED - the drill "
        "cannot fail loudly, so its PASSes prove nothing: " + ", ".join(absorbed)
    )
    print(
        "This is a finding about the drill, not a reason to weaken it. The check "
        "for an absorbed break is the one to repair."
    )
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python scripts/repl_sandbox_drill.py",
        description="Zero-paid reachability drill for the REPL-sandbox refusals.",
    )
    parser.add_argument(
        "--negative-control",
        action="store_true",
        help="plant a break behind each refusal; exit 3 when every one is detected",
    )
    parser.add_argument(
        "--verbose", action="store_true", help="print each refusal's message"
    )
    args = parser.parse_args(argv)

    if args.negative_control:
        return run_negative_control()
    return run_drill(args.verbose)


if __name__ == "__main__":
    sys.exit(main())
