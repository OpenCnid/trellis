"""The composition root.

What is asserted here is the property the object exists for: a session's per-CID
tables are opened together and closed together, both handlers are reachable and
authenticate by the CID the transport supplied, and one session's handles do not
resolve in another's namespace.

The backends and the provider are in-process doubles. Nothing here opens a
socket, reads a credential, or spends money.
"""

from __future__ import annotations

import json

import pytest

from repl_sandbox.broker import ResultSet
from repl_sandbox.config import SandboxConfig
from repl_sandbox.errors import AuthError, DeniedError
from repl_sandbox.host import (
    BROKER_CAPABILITIES,
    DB_PORT,
    LM_PORT,
    TrellisSandboxHost,
)
from repl_sandbox.lm_handler import PromptValue, error_code_of

CID_A = 3
CID_B = 4
CID_UNKNOWN = 9


class StubBackend:
    """A `DBBackend` over a fixed table. No driver, no credential, no route."""

    read_only = True

    def __init__(self) -> None:
        self.queries: list[str] = []

    def run_query(self, sql: str, params: list) -> ResultSet:
        self.queries.append(sql)
        return ResultSet(
            rows=[[1, "alpha"], [2, "beta"]],
            schema=[{"name": "id"}, {"name": "label"}],
            rowcount=2,
        )

    def run_cypher(self, query: str, params: dict) -> ResultSet:
        self.queries.append(query)
        return ResultSet(rows=[[1]], schema=[{"name": "n"}], rowcount=1)


class StubProvider:
    """A `Provider` that reaches no API. Reports a real per-call cost of zero."""

    def __init__(self, usd: float = 0.0) -> None:
        self.usd = usd
        self.calls = 0

    def complete(self, prompt: PromptValue, model: str | None) -> tuple[dict, float]:
        self.calls += 1
        text = prompt if isinstance(prompt, str) else json.dumps(prompt)
        return {"root_model": model or "stub", "response": f"echo: {text}"}, self.usd

    def complete_batched(
        self, prompts: list[PromptValue], model: str | None
    ) -> tuple[list[dict], float]:
        return [self.complete(p, model)[0] for p in prompts], self.usd * len(prompts)


@pytest.fixture
def host() -> TrellisSandboxHost:
    built = TrellisSandboxHost(
        config=SandboxConfig(),
        backends={"postgres": StubBackend(), "neo4j": StubBackend()},
        provider=StubProvider(),
    )
    try:
        yield built
    finally:
        built.close()


def _request(op: str, args: dict, req_id: str = "t") -> dict:
    return {"v": 1, "req_id": req_id, "op": op, "args": args}


def _handle(host: TrellisSandboxHost, cid: int) -> dict:
    response = host.broker_handler(cid, _request("run_query", {"sql": "SELECT 1"}))
    assert response["ok"] is True, response
    return response["result"]["handle"]


# ---------------------------------------------------------------------------
# Opening a session
# ---------------------------------------------------------------------------


def test_open_session_binds_the_cid_and_grants_its_capabilities(
    host: TrellisSandboxHost,
) -> None:
    session = host.open_session(CID_A, "s-a", ops=["run_query", "slice"])

    assert host.sessions.session_for(CID_A) == "s-a"
    # The two pre-registered LM capabilities come with every session.
    assert set(session.granted_ops) == {
        "run_query",
        "slice",
        "llm_query",
        "llm_query_batched",
    }
    # Only DB-port ops reach the broker's dispatch table; the LM handler routes
    # nothing, so an LM grant makes no entry in one.
    assert set(session.dispatched_ops) == {"run_query", "slice"}
    assert host.dispatch.allows(CID_A, "run_query")
    assert not host.dispatch.allows(CID_A, "llm_query")


def test_the_grant_set_is_what_materialises_as_guest_stubs(
    host: TrellisSandboxHost,
) -> None:
    session = host.open_session(CID_A, "s-a", ops=["run_query"], lm=False)
    source = session.stub_source()

    assert "def run_query(" in source
    # An op that was never granted has no stub, and that absence is the denial.
    assert "def materialize(" not in source
    # No routing token is ever emitted into guest-facing source.
    assert BROKER_CAPABILITIES["run_query"].dispatch_ref not in source


def test_a_second_session_cannot_claim_a_bound_cid(host: TrellisSandboxHost) -> None:
    host.open_session(CID_A, "s-a")
    with pytest.raises(DeniedError):
        host.open_session(CID_A, "s-other")


def test_an_unknown_op_name_is_refused_rather_than_silently_skipped(
    host: TrellisSandboxHost,
) -> None:
    with pytest.raises(DeniedError):
        host.open_session(CID_A, "s-a", ops=["exfiltrate"])
    # And the rollback left nothing bound.
    assert not host.sessions.is_bound(CID_A)
    assert host.open_sessions() == {}


def test_a_failed_grant_rolls_the_whole_session_back(host: TrellisSandboxHost) -> None:
    """A duplicate registration fails mid-grant; nothing may survive it."""
    descriptor = BROKER_CAPABILITIES["run_query"]
    with pytest.raises(DeniedError):
        host.open_session(
            CID_A,
            "s-a",
            ops=["run_query"],
            capabilities=[(descriptor, DB_PORT)],  # the same name twice
        )
    assert not host.sessions.is_bound(CID_A)
    assert not host.dispatch.allows(CID_A, "run_query")
    assert host.open_sessions() == {}


# ---------------------------------------------------------------------------
# Both handlers are reachable, and both authenticate by CID
# ---------------------------------------------------------------------------


def test_the_broker_handler_is_reachable_and_authenticates_by_cid(
    host: TrellisSandboxHost,
) -> None:
    host.open_session(CID_A, "s-a", ops=["run_query"])

    served = host.broker_handler(CID_A, _request("run_query", {"sql": "SELECT 1"}))
    assert served["ok"] is True
    assert served["result"]["rowcount"] == 2
    # A handle and safe metadata; no row crossed.
    assert set(served["result"]) == {"handle", "rowcount", "schema"}

    refused = host.broker_handler(CID_UNKNOWN, _request("run_query", {"sql": "SELECT 1"}))
    assert refused["ok"] is False
    assert refused["error"]["code"] == "auth"


def test_the_lm_handler_is_reachable_and_authenticates_by_cid(
    host: TrellisSandboxHost,
) -> None:
    host.open_session(CID_A, "s-a")

    served = host.lm_handler(CID_A, {"prompt": "hello", "depth": 0})
    assert error_code_of(served) is None
    assert served["chat_completion"]["response"] == "echo: hello"

    # An unidentified peer gets no response body to learn from: `AuthError` is
    # connection-terminal, so it is raised rather than returned.
    with pytest.raises(AuthError):
        host.lm_handler(CID_UNKNOWN, {"prompt": "hello"})


def test_identity_comes_from_the_cid_argument_not_the_request_body(
    host: TrellisSandboxHost,
) -> None:
    host.open_session(CID_A, "s-a", ops=["run_query"])
    host.open_session(CID_B, "s-b")

    body_claim = _request("run_query", {"sql": "SELECT 1"})
    body_claim["cid"] = CID_A
    body_claim["session_id"] = "s-a"

    # B is not granted `run_query`, and claiming A's identity in the body does
    # not change that: the claim is refused outright.
    response = host.broker_handler(CID_B, body_claim)
    assert response["ok"] is False
    assert response["error"]["code"] == "denied"


def test_narrow_is_grantable_and_reaches_the_algebra_from_the_guest(
    host: TrellisSandboxHost,
) -> None:
    """A grant, a stub, a dispatch entry, and a handle back — the whole path.

    `narrow` had no descriptor here while the algebra called it `slice`, so there
    was nothing to grant and no stub to call even before the broker's routing set
    dropped it. This asserts the composition root now carries it end to end.
    """
    session = host.open_session(CID_A, "s-a", ops=["run_query", "narrow"], lm=False)

    assert "narrow" in session.granted_ops
    assert "narrow" in session.dispatched_ops
    assert "def narrow(" in session.stub_source()

    handle = _handle(host, CID_A)
    response = host.broker_handler(
        CID_A, _request("narrow", {"handle": handle["id"], "start": 0, "end": 1})
    )

    assert response["ok"] is True, response
    assert set(response["result"]["handle"]) == {"id", "kind"}
    # A derivation, not a materialisation: nothing was charged for it.
    assert host.byte_ledger.used(CID_A)["inbound"] == 0


# ---------------------------------------------------------------------------
# The CID-scoped handle namespace
# ---------------------------------------------------------------------------


def test_a_second_session_cannot_see_the_first_sessions_handles(
    host: TrellisSandboxHost,
) -> None:
    host.open_session(CID_A, "s-a", ops=["run_query", "slice"])
    host.open_session(CID_B, "s-b", ops=["run_query", "slice"])

    handle = _handle(host, CID_A)

    mine = host.broker_handler(
        CID_A, _request("slice", {"handle": handle, "span": {"start": 0, "end": 2}})
    )
    assert mine["ok"] is True

    theirs = host.broker_handler(
        CID_B, _request("slice", {"handle": handle, "span": {"start": 0, "end": 2}})
    )
    assert theirs["ok"] is False
    assert theirs["error"]["code"] == "denied"
    # One message for "never existed" and "belongs to another session", so the
    # table is not an oracle for another session's handles.
    assert theirs["error"]["message"] == "handle is not resolvable for this session"


def test_each_session_gets_its_own_capability_registry(
    host: TrellisSandboxHost,
) -> None:
    a = host.open_session(CID_A, "s-a", ops=["run_query"], lm=False)
    b = host.open_session(CID_B, "s-b", ops=["slice"], lm=False)

    assert a.capabilities is not b.capabilities
    assert "def run_query(" in a.stub_source()
    assert "def run_query(" not in b.stub_source()


# ---------------------------------------------------------------------------
# Teardown: every per-CID table, in one call
# ---------------------------------------------------------------------------


def test_close_session_clears_every_per_cid_table(host: TrellisSandboxHost) -> None:
    host.open_session(CID_A, "s-a", ops=["run_query", "slice"])
    handle = _handle(host, CID_A)
    host.broker_handler(
        CID_A, _request("slice", {"handle": handle, "span": {"start": 0, "end": 2}})
    )
    host.lm_handler(CID_A, {"prompt": "hello"})

    assert host.handles.count(CID_A) == 1
    assert host.byte_ledger.used(CID_A)["inbound"] > 0

    report = host.close_session(CID_A)

    assert report.clean, report.errors
    assert report.handles_freed == 1
    assert report.dispatch_revoked == 2
    # Every table, not most of them.
    assert not host.sessions.is_bound(CID_A)
    assert host.handles.count(CID_A) == 0
    assert host.byte_ledger.used(CID_A) == {"inbound": 0, "outbound": 0}
    assert host.spend_ledger.spent(CID_A) == 0.0
    assert not host.dispatch.allows(CID_A, "run_query")
    assert host.open_sessions() == {}
    with pytest.raises(DeniedError):
        host.session(CID_A)


def test_a_handle_does_not_survive_its_session(host: TrellisSandboxHost) -> None:
    """The token can survive in guest memory; the referent cannot survive here."""
    host.open_session(CID_A, "s-a", ops=["run_query", "slice"])
    handle = _handle(host, CID_A)
    host.close_session(CID_A)

    host.open_session(CID_A, "s-a-again", ops=["run_query", "slice"])
    response = host.broker_handler(
        CID_A, _request("slice", {"handle": handle, "span": {"start": 0, "end": 2}})
    )
    assert response["ok"] is False
    assert response["error"]["code"] == "denied"


def test_close_session_is_idempotent_and_never_raises(host: TrellisSandboxHost) -> None:
    host.open_session(CID_A, "s-a", ops=["run_query"])
    first = host.close_session(CID_A)
    second = host.close_session(CID_A)
    third = host.close_session(CID_UNKNOWN)

    assert first.clean and second.clean and third.clean
    assert second.session_id is None
    assert second.handles_freed == 0


def test_close_shuts_every_open_session(host: TrellisSandboxHost) -> None:
    host.open_session(CID_A, "s-a", ops=["run_query"])
    host.open_session(CID_B, "s-b", ops=["run_query"])

    reports = host.close()

    assert {report.cid for report in reports} == {CID_A, CID_B}
    assert all(report.clean for report in reports)
    assert host.open_sessions() == {}
    assert host.sessions.sessions() == {}


def test_teardown_records_a_failure_rather_than_raising_it(
    host: TrellisSandboxHost,
) -> None:
    """A teardown that raised would mask the failure that caused the teardown."""
    host.open_session(CID_A, "s-a", ops=["run_query"])

    def explode(cid: int) -> None:
        raise RuntimeError("the ledger is on fire")

    host.byte_ledger.close = explode  # type: ignore[method-assign]
    report = host.close_session(CID_A)

    assert not report.clean
    assert any("byte_ledger" in error for error in report.errors)
    # The steps after the failure still ran.
    assert not host.sessions.is_bound(CID_A)


# ---------------------------------------------------------------------------
# The capability set itself
# ---------------------------------------------------------------------------


def test_every_broker_capability_names_a_port_the_registry_accepts(
    host: TrellisSandboxHost,
) -> None:
    session = host.open_session(
        CID_A, "s-a", ops=sorted(BROKER_CAPABILITIES), lm=True
    )
    assert len(session.granted_ops) == len(BROKER_CAPABILITIES) + 2
    source = session.stub_source()
    for name in BROKER_CAPABILITIES:
        assert f"def {name}(" in source
    # The LM pair is on LM_PORT and everything else on DB_PORT.
    assert f"'{LM_PORT}'" in source
    assert f"'{DB_PORT}'" in source


# ---------------------------------------------------------------------------
# The by-reference sink: llm_query(context=H)
# ---------------------------------------------------------------------------


def test_a_context_handle_reaches_the_provider_and_never_the_guest(
    host: TrellisSandboxHost,
) -> None:
    """The pattern DATA_MODEL section 6 calls the strongest handle-first ergonomic.

    The guest holds a handle, names it as `context`, and the host resolves it
    into the outbound prompt. The sub-LLM reads the referent; the guest never
    does. This is the whole data-flow boundary in one call, so it is asserted
    against what the provider actually received rather than against a docstring.

    It also pins the wiring: `LMHandler` takes its handle table from the
    composition root, and without that keyword every context call refuses. A
    closed gate is safe, but it would have made the feature correct and
    unreachable (rule 15).
    """
    session = host.open_session(CID_A, "s-a", ops=["run_query"])
    assert "llm_query" in session.granted_ops

    landed = host.broker_handler(
        CID_A, _request("run_query", {"sql": "select 1", "params": []})
    )
    handle = landed["result"]["handle"]

    before = host.byte_ledger.used(CID_A)["inbound"]
    response = host.lm_handler(
        CID_A,
        {"prompt": "summarise", "model": "m", "depth": 0, "context": [handle]},
    )
    assert response["error"] is None, response

    # The guest named a handle and never held the rows: its request carried the
    # token only. What the sub-LLM chose to write back is the metered inbound
    # residual the design admits, so the assertion is that it was CHARGED, not
    # that it was empty. Asserting "no row ever comes back" would promote a
    # best-effort filter into the boundary column, and content inspection over
    # model-controlled text is exactly what ARCHITECTURE section 3.1 refuses to
    # rest the boundary on.
    assert host.byte_ledger.used(CID_A)["inbound"] > before

    # What the withholding *does* guarantee: the structured prompt echo carries
    # the guest's own prompt, not the spliced one, so the referent does not ride
    # back through a field that is not the completion.
    completion = response["chat_completion"]
    assert "alpha" not in json.dumps(completion.get("prompt", ""))


def test_a_context_handle_from_another_session_is_refused(
    host: TrellisSandboxHost,
) -> None:
    """CID scoping is what makes the by-reference sink safe to expose at all."""
    host.open_session(CID_A, "s-a", ops=["run_query"])
    host.open_session(CID_B, "s-b", ops=["run_query"])

    landed = host.broker_handler(
        CID_A, _request("run_query", {"sql": "select 1", "params": []})
    )
    handle = landed["result"]["handle"]

    stolen = host.lm_handler(
        CID_B,
        {"prompt": "summarise", "model": "m", "depth": 0, "context": [handle]},
    )
    assert stolen["error"] == "denied"
    assert stolen["chat_completion"] is None
