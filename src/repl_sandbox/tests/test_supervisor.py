"""Supervisor tests: persistence, re-pinning, and what may cross the seam.

The supervisor executes untrusted code on purpose, so these tests do not check
that hostile code is prevented from running — nothing here prevents that, and
the microVM is what contains it. They check the three things the supervisor is
actually responsible for: the control-port CID policy, a namespace that
persists across turns with the scaffold re-pinned each time, and a marshalled
result that is made of strings rather than filtered objects.
"""

from __future__ import annotations

import json
import socket
import threading

import pytest

from repl_sandbox.config import VMADDR_CID_HOST, MarshalCaps, SandboxConfig
from repl_sandbox.errors import AuthError, DeniedError
from repl_sandbox.frame import encode_frame
from repl_sandbox.supervisor import (
    DEFAULT_VALUE_REPR_BYTES,
    RESERVED_NAMES,
    GuestSupervisor,
    marshal_value,
)
from repl_sandbox.transport import LoopbackListener, serve_forever

MAX_FRAME_LEN = 1 << 20
JOIN_TIMEOUT_S = 5.0


def make_supervisor(stub_source: str = "", **caps: int) -> GuestSupervisor:
    config = SandboxConfig(max_frame_len=MAX_FRAME_LEN)
    marshal_caps = MarshalCaps(**caps) if caps else None
    return GuestSupervisor(config, stub_source=stub_source, marshal_caps=marshal_caps)


def run(supervisor: GuestSupervisor, code: str) -> dict:
    """One `exec` op from the host CID, returning the `REPLResult` dict."""
    response = supervisor.handle_request(VMADDR_CID_HOST, {"op": "exec", "code": code})
    assert response["ok"] is True
    return response["result"]


# ---------------------------------------------------------------------------
# Control-port auth
# ---------------------------------------------------------------------------


def test_only_the_host_cid_may_issue_a_control_op() -> None:
    supervisor = make_supervisor()
    for cid in (0, 1, 3, 4, 99):
        with pytest.raises(AuthError) as caught:
            supervisor.handle_request(cid, {"op": "ping"})
        assert caught.value.code == "auth"
        assert caught.value.connection_terminal is True


def test_the_host_cid_is_served() -> None:
    """Positive control for the refusal above."""
    supervisor = make_supervisor()
    assert supervisor.handle_request(VMADDR_CID_HOST, {"op": "ping"}) == {
        "op": "ping",
        "ok": True,
        "stopped": False,
    }


def test_unknown_and_malformed_ops_are_denied() -> None:
    supervisor = make_supervisor()
    for request in (
        {"op": "eval"},
        {"op": None},
        {},
        {"op": "exec"},
        {"op": "exec", "code": 42},
        {"op": "load_context"},
    ):
        with pytest.raises(DeniedError):
            supervisor.handle_request(VMADDR_CID_HOST, request)


def test_shutdown_sets_the_stopped_flag() -> None:
    supervisor = make_supervisor()
    assert supervisor.handle_request(VMADDR_CID_HOST, {"op": "shutdown"})["ok"] is True
    assert supervisor.stopped is True
    assert supervisor.handle_request(VMADDR_CID_HOST, {"op": "ping"})["stopped"] is True


# ---------------------------------------------------------------------------
# Persistence — the property S2 exists to prove
# ---------------------------------------------------------------------------


def test_namespace_persists_across_turns() -> None:
    """A variable set in one turn is live in a later one."""
    supervisor = make_supervisor()
    run(supervisor, "x = 41")
    run(supervisor, "def bump():\n    global x\n    x += 1")
    run(supervisor, "bump()")
    result = run(supervisor, "print(x)")
    assert result["stdout"].strip() == "42"


def test_imports_persist_across_turns() -> None:
    supervisor = make_supervisor()
    run(supervisor, "import math")
    result = run(supervisor, "print(round(math.pi, 3))")
    assert result["stdout"].strip() == "3.142"
    assert result["stderr"] == ""


def test_an_exception_is_stderr_not_an_op_failure() -> None:
    """A traceback feeds the model's self-debug loop; the op still succeeded."""
    supervisor = make_supervisor()
    result = run(supervisor, "1 / 0")
    assert result["stdout"] == ""
    assert "ZeroDivisionError" in result["stderr"]
    assert run(supervisor, "print('still here')")["stdout"].strip() == "still here"


def test_system_exit_from_model_code_does_not_kill_the_supervisor() -> None:
    supervisor = make_supervisor()
    result = run(supervisor, "raise SystemExit(3)")
    assert "SystemExit" in result["stderr"]
    assert run(supervisor, "print('alive')")["stdout"].strip() == "alive"


# ---------------------------------------------------------------------------
# Reserved names
# ---------------------------------------------------------------------------


def test_reserved_names_are_the_pinned_rlms_set() -> None:
    assert set(RESERVED_NAMES) == {
        "llm_query",
        "llm_query_batched",
        "rlm_query",
        "rlm_query_batched",
        "SHOW_VARS",
        "answer",
        "context",
        "history",
    }


def test_load_context_binds_the_reserved_name() -> None:
    supervisor = make_supervisor()
    response = supervisor.handle_request(
        VMADDR_CID_HOST, {"op": "load_context", "context": ["alpha", "beta"]}
    )
    assert response["ok"] is True
    assert response["context_count"] == 2
    assert run(supervisor, "print(context[1])")["stdout"].strip() == "beta"


def test_reassigning_context_does_not_survive_into_the_next_turn() -> None:
    """Re-pinned every turn, so model code cannot shadow the scaffold."""
    supervisor = make_supervisor()
    supervisor.handle_request(VMADDR_CID_HOST, {"op": "load_context", "context": ["alpha"]})
    run(supervisor, "context = 'pwned'")
    assert supervisor.namespace()["context"] == ["alpha"]
    assert run(supervisor, "print(context)")["stdout"].strip() == "['alpha']"


def test_a_reserved_name_the_scaffold_never_defined_is_removed() -> None:
    """A decoy named like the scaffold does not linger for the next turn."""
    supervisor = make_supervisor()
    run(supervisor, "llm_query = lambda prompt: 'attacker controlled'")
    assert "llm_query" not in supervisor.namespace()
    result = run(supervisor, "llm_query('hi')")
    assert "NameError" in result["stderr"]


def test_a_scaffold_stub_is_restored_after_model_code_shadows_it() -> None:
    stub_source = "def llm_query(prompt):\n    return 'from the stub'\n"
    supervisor = make_supervisor(stub_source=stub_source)
    stub = supervisor.namespace()["llm_query"]
    run(supervisor, "llm_query = lambda prompt: 'hijacked'")
    assert supervisor.namespace()["llm_query"] is stub
    assert run(supervisor, "print(llm_query('x'))")["stdout"].strip() == "from the stub"


def test_scaffold_names_are_not_echoed_back_as_locals() -> None:
    supervisor = make_supervisor(stub_source="HELPER = 1\ndef llm_query(p):\n    return p\n")
    result = run(supervisor, "mine = 2")
    assert set(result["locals"]) == {"mine"}


def test_answer_channel_is_captured_and_reset() -> None:
    supervisor = make_supervisor()
    result = run(supervisor, "answer['content'] = 'the answer'\nanswer['ready'] = True")
    assert result["final_answer"] == "the answer"
    assert supervisor.namespace()["answer"] == {}
    assert run(supervisor, "pass")["final_answer"] is None


# ---------------------------------------------------------------------------
# Marshalling — reprs cross, objects do not
# ---------------------------------------------------------------------------


def test_locals_cross_as_reprs_never_as_live_objects() -> None:
    """A live socket in the namespace marshals to a string and nothing else."""
    supervisor = make_supervisor()
    result = run(supervisor, "import socket as _s\nsock = _s.socket()\nsock.close()")
    entry = result["locals"]["sock"]
    assert entry["kind"] == "socket"
    assert isinstance(entry["value_repr"], str)
    assert not isinstance(supervisor.namespace()["sock"], str)
    # The whole result frames cleanly, which it could not if an object rode along.
    encode_frame({"op": "exec", "ok": True, "result": result}, MAX_FRAME_LEN)


def test_a_non_serialisable_object_marshals_instead_of_raising() -> None:
    supervisor = make_supervisor()
    result = run(
        supervisor,
        "import threading as _t\n"
        "lock = _t.Lock()\n"
        "fn = lambda z: z\n"
        "class Thing:\n"
        "    pass\n"
        "thing = Thing()\n",
    )
    for name in ("lock", "fn", "thing"):
        assert isinstance(result["locals"][name]["value_repr"], str)
    json.dumps(result)


def test_a_hostile_repr_cannot_escape_the_value_cap() -> None:
    supervisor = make_supervisor()
    result = run(
        supervisor,
        "class Loud:\n"
        "    def __repr__(self):\n"
        "        return 'A' * 5_000_000\n"
        "loud = Loud()\n",
    )
    entry = result["locals"]["loud"]
    assert entry["truncated"] is True
    assert len(entry["value_repr"].encode("utf-8")) <= DEFAULT_VALUE_REPR_BYTES
    assert entry["spill_handle"] in supervisor.spills
    assert supervisor.spills[entry["spill_handle"]] == "loud"


def test_a_raising_repr_marshals_to_a_placeholder() -> None:
    supervisor = make_supervisor()
    result = run(
        supervisor,
        "class Angry:\n"
        "    def __repr__(self):\n"
        "        raise RuntimeError('no')\n"
        "angry = Angry()\n",
    )
    entry = result["locals"]["angry"]
    assert entry["unrepresentable"] is True
    assert "RuntimeError" in entry["value_repr"]


def test_a_repr_returning_a_non_string_marshals_to_a_placeholder() -> None:
    supervisor = make_supervisor()
    result = run(
        supervisor,
        "class Wrong:\n"
        "    def __repr__(self):\n"
        "        return 7\n"
        "wrong = Wrong()\n",
    )
    assert result["locals"]["wrong"]["unrepresentable"] is True


def test_a_recursive_repr_marshals_to_a_placeholder() -> None:
    supervisor = make_supervisor()
    result = run(
        supervisor,
        "class Deep:\n"
        "    def __repr__(self):\n"
        "        return repr(self)\n"
        "deep = Deep()\n",
    )
    assert result["locals"]["deep"]["unrepresentable"] is True


def test_marshal_value_handles_a_zero_budget() -> None:
    entry = marshal_value("x" * 100, 0, spill_handle="spill:abc")
    assert entry["value_repr"] == ""
    assert entry["truncated"] is True
    assert entry["spill_handle"] == "spill:abc"


def test_the_total_locals_budget_is_bounded() -> None:
    """Many large values produce a frame the transport will still carry."""
    supervisor = make_supervisor()
    supervisor.locals_total_bytes = 8 * 1024
    result = run(
        supervisor,
        "for i in range(64):\n    globals()[f'big{i}'] = 'B' * 100_000\n",
    )
    total = sum(len(v["value_repr"].encode("utf-8")) for v in result["locals"].values())
    assert len(result["locals"]) >= 64
    assert total <= 8 * 1024 + DEFAULT_VALUE_REPR_BYTES


# ---------------------------------------------------------------------------
# Output caps
# ---------------------------------------------------------------------------


def test_stdout_is_capped() -> None:
    supervisor = make_supervisor(stdout_bytes=1024, stderr_bytes=1024, answer_bytes=1024)
    result = run(supervisor, "print('x' * 100_000)")
    assert len(result["stdout"].encode("utf-8")) <= 1024
    assert result["stdout"].endswith("...[truncated]")


def test_stderr_is_capped() -> None:
    supervisor = make_supervisor(stdout_bytes=1024, stderr_bytes=512, answer_bytes=1024)
    result = run(supervisor, "import sys\nsys.stderr.write('e' * 100_000)")
    assert len(result["stderr"].encode("utf-8")) <= 512


def test_final_answer_is_capped() -> None:
    supervisor = make_supervisor(stdout_bytes=1024, stderr_bytes=1024, answer_bytes=256)
    result = run(
        supervisor,
        "answer['content'] = 'z' * 100_000\nanswer['ready'] = True",
    )
    assert len(result["final_answer"].encode("utf-8")) <= 256


def test_result_has_the_pinned_replresult_shape() -> None:
    supervisor = make_supervisor()
    result = run(supervisor, "y = 1")
    assert set(result) == {
        "stdout",
        "stderr",
        "locals",
        "execution_time",
        "rlm_calls",
        "final_answer",
    }
    assert isinstance(result["execution_time"], float)
    assert result["rlm_calls"] == []


# ---------------------------------------------------------------------------
# Over the wire
# ---------------------------------------------------------------------------


def test_the_supervisor_serves_the_control_port_over_the_transport() -> None:
    """End to end: the host CID gets served, a foreign CID gets dropped."""
    supervisor = make_supervisor()

    def served(peer_cid: int) -> LoopbackListener:
        return LoopbackListener(peer_cid=peer_cid, accept_timeout_s=0.05, read_timeout_s=1.0)

    for peer_cid, expect_answer in ((VMADDR_CID_HOST, True), (3, False)):
        listener = served(peer_cid)
        stop = threading.Event()
        thread = threading.Thread(
            target=serve_forever,
            args=(listener, supervisor.handle_request, MAX_FRAME_LEN, None, stop),
            daemon=True,
        )
        thread.start()
        try:
            client = listener.client()
            if expect_answer:
                response = client.request({"op": "exec", "code": "w = 5"}, MAX_FRAME_LEN)
                assert response["result"]["locals"]["w"]["value_repr"] == "5"
            else:
                sock = socket.create_connection(listener.address, timeout=2.0)
                sock.settimeout(2.0)
                try:
                    sock.sendall(encode_frame({"op": "exec", "code": "w = 6"}, MAX_FRAME_LEN))
                    assert sock.recv(4) == b""
                finally:
                    sock.close()
        finally:
            stop.set()
            listener.close()
            thread.join(timeout=JOIN_TIMEOUT_S)
            assert not thread.is_alive()

    # The refused turn never ran: the namespace still holds the served one.
    assert supervisor.namespace()["w"] == 5
