"""The rlms-facing backend.

INTERFACES section 2 (Backend contract — `KataREPL(IsolatedEnv)`) fixes the
three-method contract, the ordered `setup()`, the handle discipline on
`load_context`, the marshalling rule on `execute_code`, and the host-side-only
status of `update_handler_address`. Each of those is driven here through the
in-process launcher, which is a test double with no isolation: what these tests
prove is the *control plane*, never a boundary.

The `isinstance` assertions are run against the real classes imported from the
pinned `rlms==0.1.3`, so a drift in either protocol shows up here as well as in
`test_rlms_conformance.py`.
"""

from __future__ import annotations

import inspect
import json

import pytest
from rlm.core.types import REPLResult, RLMChatCompletion, UsageSummary
from rlm.environments.base_env import BaseEnv, IsolatedEnv, SupportsPersistence

from repl_sandbox import kata_repl as kata_repl_module
from repl_sandbox.audit import AuditLog
from repl_sandbox.config import ByteLedgerCaps, MarshalCaps, SandboxConfig
from repl_sandbox.errors import (
    CapBytesError,
    DeniedError,
    DepthCeilingError,
    FrameError,
    SandboxError,
)
from repl_sandbox.kata_repl import KataREPL, is_handle, literal_byte_size
from repl_sandbox.launcher import IN_PROCESS_CID, InProcessLauncher, KataLauncher
from repl_sandbox.session import SessionTable


@pytest.fixture
def env():
    """A set-up backend on the in-process double, torn down afterwards."""
    config = SandboxConfig()
    backend = KataREPL(
        config=config,
        launcher=InProcessLauncher(config),
        session_id="session-under-test",
    )
    backend.setup()
    try:
        yield backend
    finally:
        backend.cleanup()


# ---------------------------------------------------------------------------
# The contract, against the real rlms classes
# ---------------------------------------------------------------------------


def test_the_backend_is_an_isolated_env_and_supports_persistence(env: KataREPL) -> None:
    assert isinstance(env, IsolatedEnv)
    assert isinstance(env, BaseEnv)
    assert isinstance(env, SupportsPersistence)


def test_base_env_attributes_survive_the_keyword_only_forwarding() -> None:
    """`IsolatedEnv.__init__` is `(persistent=False, **kwargs)` *(source-confirmed)*.

    `depth` and `max_concurrent_subcalls` are `BaseEnv`'s and reach it only as
    keywords, so the forwarding is worth asserting rather than assuming.
    """
    config = SandboxConfig()
    backend = KataREPL(
        persistent=True,
        depth=1,
        max_concurrent_subcalls=2,
        config=config,
        launcher=InProcessLauncher(config),
    )
    assert (backend.persistent, backend.depth, backend.max_concurrent_subcalls) == (True, 1, 2)


# ---------------------------------------------------------------------------
# The three-method round trip
# ---------------------------------------------------------------------------


def test_the_three_methods_round_trip_and_the_namespace_persists(env: KataREPL) -> None:
    """Boot once, keep state, exec many — BUILD_PLAN section 5.2's property."""
    env.load_context({"task": "count the blocks"})

    first = env.execute_code("total = 41\nprint(context['task'])")
    assert isinstance(first, REPLResult)
    assert first.stdout == "count the blocks\n"
    assert first.stderr == ""

    second = env.execute_code("print(total + 1)")
    assert second.stdout == "42\n"
    assert "total" in second.locals


def test_a_traceback_from_model_code_is_output_not_an_error(env: KataREPL) -> None:
    """rlms feeds the traceback back to the model; it is not a failed op."""
    result = env.execute_code("raise ValueError('boom')")
    assert "ValueError: boom" in result.stderr
    assert result.stdout == ""


def test_execute_code_marshals_reprs_rather_than_objects(env: KataREPL) -> None:
    """No live object crosses back — the seam speaks JSON, so none can."""
    result = env.execute_code(
        "class Live:\n"
        "    def __repr__(self):\n"
        "        return '<live object>'\n"
        "obj = Live()\n"
    )
    entry = result.locals["obj"]
    assert entry["value_repr"] == "<live object>"
    assert entry["kind"] == "Live"
    # The whole struct is JSON, which is the property that makes a pickle gadget
    # or a live socket unrepresentable rather than merely filtered.
    json.dumps(result.locals)


def test_the_capabilities_are_materialised_as_stubs_in_the_guest(env: KataREPL) -> None:
    """INTERFACES section 6: `llm_query` is pre-registered for every session."""
    result = env.execute_code("print(callable(llm_query), callable(llm_query_batched))")
    assert result.stdout == "True True\n"

    source = env.capabilities.materialise(IN_PROCESS_CID)
    assert "def llm_query(" in source
    # The stub carries the RPC envelope and a port name; no routing token from
    # the host table is in it, and no credential.
    assert "trellis.lm.v1.single" not in source


def test_execute_code_before_setup_refuses() -> None:
    config = SandboxConfig()
    backend = KataREPL(config=config, launcher=InProcessLauncher(config))
    with pytest.raises(SandboxError, match="not set up"):
        backend.execute_code("1 + 1")


def test_execute_code_refuses_a_non_string_block(env: KataREPL) -> None:
    with pytest.raises(DeniedError):
        env.execute_code(b"1 + 1")  # type: ignore[arg-type]


def test_a_second_setup_is_refused(env: KataREPL) -> None:
    with pytest.raises(SandboxError, match="already set up"):
        env.setup()


# ---------------------------------------------------------------------------
# setup() ordering and teardown
# ---------------------------------------------------------------------------


class RecordingGuest:
    """A real in-process guest with one setup step rigged to fail."""

    def __init__(self, inner, fail_at: str | None = None) -> None:
        self.inner = inner
        self.cid = inner.cid
        self.fail_at = fail_at
        self.calls: list[str] = []
        self.shutdowns = 0

    def _step(self, name: str) -> None:
        self.calls.append(name)
        if self.fail_at == name:
            raise SandboxError(f"injected failure at {name}")

    def start_bridge(self) -> None:
        self._step("start_bridge")
        self.inner.start_bridge()

    def install_scaffold(self, stub_source: str) -> None:
        self._step("install_scaffold")
        self.inner.install_scaffold(stub_source)

    def control(self):
        self._step("control")
        conn = self.inner.control()
        if self.fail_at == "round_trip":
            # A channel that is open to the backend and dead on the wire.
            conn.close()
        return conn

    def shutdown(self) -> None:
        self.shutdowns += 1
        self.inner.shutdown()


class RecordingLauncher:
    """Hands out `RecordingGuest`s, or fails at boot."""

    def __init__(self, config: SandboxConfig, fail_at: str | None = None) -> None:
        self.config = config
        self.fail_at = fail_at
        self.inner = InProcessLauncher(config)
        self.guest: RecordingGuest | None = None

    def boot(self, session_id: str) -> RecordingGuest:
        if self.fail_at == "boot":
            raise SandboxError("injected failure at boot")
        self.guest = RecordingGuest(self.inner.boot(session_id), self.fail_at)
        return self.guest


def test_setup_runs_the_steps_in_the_recorded_order() -> None:
    config = SandboxConfig()
    launcher = RecordingLauncher(config)
    backend = KataREPL(config=config, launcher=launcher, session_id="ordered")
    backend.setup()
    try:
        assert launcher.guest is not None
        assert launcher.guest.calls == ["start_bridge", "install_scaffold", "control"]
    finally:
        backend.cleanup()


@pytest.mark.parametrize(
    "step", ["boot", "bind", "start_bridge", "install_scaffold", "control", "round_trip"]
)
def test_setup_tears_the_session_down_when_any_step_fails(step: str) -> None:
    """A partially wired guest is never left live.

    The `bind` case is not injected: the CID is pre-bound to another session, so
    the real `SessionTable` refuses. That also proves teardown releases only the
    binding this session made — evicting the other session would be worse than
    the failure being handled.
    """
    config = SandboxConfig()
    audit = AuditLog()
    sessions = SessionTable(audit)
    launcher = RecordingLauncher(config, fail_at=None if step == "bind" else step)
    if step == "bind":
        sessions.bind(IN_PROCESS_CID, "someone-else")

    backend = KataREPL(
        config=config,
        launcher=launcher,
        sessions=sessions,
        audit=audit,
        session_id="failing-session",
    )

    with pytest.raises(SandboxError):
        backend.setup()

    assert backend._live is False
    assert backend._guest is None
    assert backend._control is None
    if step == "bind":
        assert sessions.session_for(IN_PROCESS_CID) == "someone-else"
    else:
        assert sessions.is_bound(IN_PROCESS_CID) is False
    if step != "boot":
        assert launcher.guest is not None
        assert launcher.guest.shutdowns == 1

    # And the backend is genuinely unusable afterwards, not half-live.
    with pytest.raises(SandboxError):
        backend.execute_code("1 + 1")


def test_cleanup_is_the_name_the_driver_calls_and_is_idempotent() -> None:
    """`rlm/core/rlm.py` ends a run with `environment.cleanup()` if it exists."""
    assert hasattr(KataREPL, "cleanup")
    config = SandboxConfig()
    sessions = SessionTable()
    backend = KataREPL(config=config, launcher=InProcessLauncher(config), sessions=sessions)
    backend.setup()
    assert sessions.is_bound(IN_PROCESS_CID) is True
    backend.cleanup()
    backend.cleanup()
    assert sessions.is_bound(IN_PROCESS_CID) is False


# ---------------------------------------------------------------------------
# load_context — handle-first
# ---------------------------------------------------------------------------


def test_a_handle_is_the_two_field_token_and_nothing_else() -> None:
    assert is_handle({"id": "abc", "kind": "graph-view"}) is True
    assert is_handle({"id": "abc", "kind": "table", "rows": [[1]]}) is False
    assert is_handle({"id": "abc"}) is False
    assert is_handle({"id": 1, "kind": "table"}) is False


def test_handles_are_free_and_literals_are_charged() -> None:
    """The ledger counts content, not references (DATA_MODEL section 6)."""
    handle = {"id": "h1", "kind": "graph-view"}
    assert literal_byte_size(handle) == 0
    assert literal_byte_size({"beliefs": handle, "facts": handle}) == len("beliefs") + len("facts")
    assert literal_byte_size({"rows": ["abcd", "efgh"]}) == len("rows") + 8


def test_load_context_carries_handles_rather_than_resolved_bytes(env: KataREPL) -> None:
    """The workspaces arrive as tokens; the guest cannot read their referents."""
    payload = {
        "task": "summarise the belief base",
        "beliefs": {"id": "h-beliefs", "kind": "graph-view"},
        "facts": {"id": "h-facts", "kind": "graph-view"},
    }
    env.load_context(payload)

    result = env.execute_code("print(sorted(context)); print(context['beliefs'])")
    assert "['beliefs', 'facts', 'task']" in result.stdout
    assert "{'id': 'h-beliefs', 'kind': 'graph-view'}" in result.stdout
    # A handle has no content field to read, so there is nothing in the guest to
    # exfiltrate even under total injection.
    assert set(payload["beliefs"]) == {"id", "kind"}


def test_an_oversized_literal_is_refused_by_the_per_call_cap() -> None:
    config = SandboxConfig(byte_caps=ByteLedgerCaps(inbound_per_call=1024, inbound_total=4096))
    backend = KataREPL(config=config, launcher=InProcessLauncher(config))
    backend.setup()
    try:
        with pytest.raises(CapBytesError, match="per-call inbound cap"):
            backend.load_context({"corpus": "x" * 2048})
        # A handle to the same data is free, which is the point of the shape.
        backend.load_context({"corpus": {"id": "h-corpus", "kind": "text-blocks"}})
    finally:
        backend.cleanup()


def test_the_cumulative_inbound_ledger_stops_a_drip_feed() -> None:
    """Defense-in-depth on the residual, not the boundary — but it does fire."""
    config = SandboxConfig(byte_caps=ByteLedgerCaps(inbound_per_call=1024, inbound_total=2048))
    backend = KataREPL(config=config, launcher=InProcessLauncher(config))
    backend.setup()
    try:
        for index in range(2):
            backend.add_context({"chunk": "x" * 900}, index)
        with pytest.raises(CapBytesError, match="session inbound cap"):
            backend.add_context({"chunk": "x" * 900}, 2)
    finally:
        backend.cleanup()


def test_a_payload_that_is_not_json_is_refused_at_the_seam(env: KataREPL) -> None:
    with pytest.raises(FrameError):
        env.add_context({"live": object()}, 1)


# ---------------------------------------------------------------------------
# Persistence — the rlms versioning semantics
# ---------------------------------------------------------------------------


def test_context_versioning_matches_the_pinned_local_repl_semantics(env: KataREPL) -> None:
    """Auto-increment, index-0 alias, `max(count, index + 1)` *(source-confirmed)*."""
    assert env.get_context_count() == 0
    assert env.add_context({"turn": 0}) == 0
    assert env.get_context_count() == 1
    assert env.add_context({"turn": 1}) == 1
    assert env.add_context({"turn": 5}, 5) == 5
    assert env.get_context_count() == 6
    # An explicit index below the count does not lower it.
    assert env.add_context({"turn": 2}, 2) == 2
    assert env.get_context_count() == 6

    # The unversioned name still points at index 0: only `add_context(_, 0)`
    # rebinds it, exactly as the alias rule says.
    result = env.execute_code("print(context, context_0, context_1, context_2, context_5)")
    assert result.stdout == "{'turn': 0} {'turn': 0} {'turn': 1} {'turn': 2} {'turn': 5}\n"


def test_load_context_binds_the_reserved_name_and_index_zero(env: KataREPL) -> None:
    env.load_context({"framing": "the task"})
    result = env.execute_code("print(context == context_0, context['framing'])")
    assert result.stdout == "True the task\n"


def test_the_reserved_context_pin_survives_a_turn_that_shadows_it(env: KataREPL) -> None:
    """Model code cannot leave a decoy `context` behind for the next turn."""
    env.load_context({"framing": "the task"})
    env.execute_code("context = 'shadowed'")
    result = env.execute_code("print(context)")
    assert result.stdout == "{'framing': 'the task'}\n"


def test_history_versioning_and_the_deep_copy(env: KataREPL) -> None:
    messages = [{"role": "user", "content": "hi"}]
    assert env.add_history(messages) == 0
    assert env.get_history_count() == 1
    messages.append({"role": "assistant", "content": "leaked"})

    result = env.execute_code("print(history_0)")
    assert result.stdout == "[{'role': 'user', 'content': 'hi'}]\n"
    assert env.add_history([{"role": "user", "content": "again"}]) == 1
    assert env.get_history_count() == 2


def test_add_history_refuses_a_non_list(env: KataREPL) -> None:
    with pytest.raises(DeniedError):
        env.add_history({"role": "user"})  # type: ignore[arg-type]


def test_negative_indices_are_refused(env: KataREPL) -> None:
    with pytest.raises(DeniedError):
        env.add_context({"turn": 0}, -1)
    with pytest.raises(DeniedError):
        env.add_history([], -1)


# ---------------------------------------------------------------------------
# update_handler_address — host-side only
# ---------------------------------------------------------------------------


def test_update_handler_address_accepts_a_local_handler(env: KataREPL) -> None:
    env.update_handler_address(("127.0.0.1", 51234))
    assert env.lm_handler_address == ("127.0.0.1", 51234)


@pytest.mark.parametrize(
    "address",
    [
        ("0.0.0.0", 8080),
        ("attacker.example.com", 443),
        ("10.0.0.5", 8080),
        ("127.0.0.1", 0),
        ("127.0.0.1", "80"),
        ("127.0.0.1",),
        "127.0.0.1:80",
    ],
)
def test_update_handler_address_refuses_anything_not_local(env: KataREPL, address) -> None:
    """A handler address pointing off-host is the shape of an exfil destination."""
    with pytest.raises(DeniedError):
        env.update_handler_address(address)  # type: ignore[arg-type]
    assert env.lm_handler_address is None


def test_no_control_op_exposes_the_handler_address(env: KataREPL) -> None:
    """Guest code has no path to the sub-LLM destination.

    The supervisor's op set is `ping / load_context / exec / shutdown` and an
    unknown op is denied rather than dispatched, so a hostile worker cannot aim
    the channel at an attacker host by speaking the control protocol.
    """
    with pytest.raises(DeniedError):
        env._control_request(
            {"op": "update_handler_address", "address": ["attacker.example.com", 443]}
        )


def test_the_driver_supplied_handler_address_is_validated_at_construction() -> None:
    config = SandboxConfig()
    with pytest.raises(DeniedError):
        KataREPL(
            config=config,
            launcher=InProcessLauncher(config),
            lm_handler_address=("0.0.0.0", 9000),
        )


# ---------------------------------------------------------------------------
# Constructor refusals
# ---------------------------------------------------------------------------


def test_custom_tools_are_refused_rather_than_silently_dropped() -> None:
    """Live host objects cannot cross into the guest (DATA_MODEL section 5)."""
    config = SandboxConfig()
    with pytest.raises(DeniedError, match="CapabilityDescriptors"):
        KataREPL(
            config=config,
            launcher=InProcessLauncher(config),
            custom_tools={"fetch": lambda: None},
        )


def test_a_recursive_subcall_callback_is_refused() -> None:
    config = SandboxConfig()
    with pytest.raises(DeniedError, match="flat fan-out"):
        KataREPL(config=config, launcher=InProcessLauncher(config), subcall_fn=lambda *a: None)


def test_depth_above_the_host_ceiling_is_refused() -> None:
    config = SandboxConfig()
    with pytest.raises(DepthCeilingError):
        KataREPL(depth=2, config=config, launcher=InProcessLauncher(config))


# ---------------------------------------------------------------------------
# Result rebuilding — fail-closed
# ---------------------------------------------------------------------------


def rebuilder() -> KataREPL:
    config = SandboxConfig()
    return KataREPL(config=config, launcher=InProcessLauncher(config))


def test_a_rebuilt_result_carries_rlm_calls_not_llm_calls() -> None:
    """The dataclass annotation says `llm_calls`; the object says `rlm_calls`."""
    completion = RLMChatCompletion(
        root_model="m",
        prompt="p",
        response="r",
        usage_summary=UsageSummary(model_usage_summaries={}),
        execution_time=0.1,
    )
    result = rebuilder()._rebuild_result(
        {
            "stdout": "out",
            "stderr": "err",
            "locals": {"x": {"kind": "int", "value_repr": "1"}},
            "execution_time": 0.5,
            "rlm_calls": [completion.to_dict()],
            "final_answer": "done",
        }
    )
    assert isinstance(result, REPLResult)
    assert not hasattr(result, "llm_calls")
    assert len(result.rlm_calls) == 1
    assert isinstance(result.rlm_calls[0], RLMChatCompletion)
    assert result.rlm_calls[0].response == "r"


@pytest.mark.parametrize(
    "result",
    [
        "not a dict",
        {"stdout": 1, "stderr": "", "locals": {}},
        {"stdout": "", "stderr": "", "locals": "not a dict"},
        {"stdout": "", "stderr": "", "locals": {}, "execution_time": "fast"},
        {"stdout": "", "stderr": "", "locals": {}, "final_answer": {"content": "x"}},
        {"stdout": "", "stderr": "", "locals": {}, "rlm_calls": "none"},
        {"stdout": "", "stderr": "", "locals": {}, "rlm_calls": ["not an object"]},
        {"stdout": "", "stderr": "", "locals": {}, "rlm_calls": [{"root_model": "m"}]},
    ],
)
def test_a_malformed_exec_reply_is_refused(result: object) -> None:
    with pytest.raises(FrameError):
        rebuilder()._rebuild_result(result)


def test_output_is_capped_driver_side() -> None:
    """Output shaping, not a boundary — but the cap does execute."""
    config = SandboxConfig(marshal_caps=MarshalCaps(stdout_bytes=64, stderr_bytes=64, answer_bytes=32))
    backend = KataREPL(config=config, launcher=InProcessLauncher(config))
    rebuilt = backend._rebuild_result(
        {
            "stdout": "x" * 500,
            "stderr": "",
            "locals": {},
            "final_answer": "y" * 500,
        }
    )
    assert len(rebuilt.stdout.encode("utf-8")) <= 64
    assert "truncated" in rebuilt.stdout
    assert len(rebuilt.final_answer.encode("utf-8")) <= 32


# ---------------------------------------------------------------------------
# The test double is not reachable by default
# ---------------------------------------------------------------------------


def test_the_default_launcher_is_the_real_one() -> None:
    """No default configuration selects a launcher that provides no isolation."""
    backend = KataREPL()
    assert isinstance(backend.launcher, KataLauncher)
    assert not isinstance(backend.launcher, InProcessLauncher)


def test_the_backend_module_never_names_the_test_double() -> None:
    """Structural, so it cannot rot: the double has to be passed in by hand."""
    source = inspect.getsource(kata_repl_module)
    assert "InProcessLauncher" not in source
    assert "InProcessGuest" not in source
