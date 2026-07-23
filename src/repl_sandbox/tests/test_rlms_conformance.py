"""Pinned-source conformance test against `rlms==0.1.3`.

BUILD_PLAN section 5.1 (S1 — Close the source-reads) names this file as the
enforcing surface for S1: the records describe the rlms contract the `KataREPL`
backend will implement, and until something executes those claims against the
installed package they are prose. Every assertion here reads the *installed*
source — never a vendored copy, never GitHub main.

The pin is load-bearing. INTERFACES section 8 (Versioning model) makes a version
bump re-trigger this read before any code depends on the new shape, so
`test_rlms_version_is_pinned` fails first and loudly if the environment moves.

Where a record and the source disagree, the source wins here and the
disagreement is written up in REPL_SANDBOX_CONFORMANCE.md. Nothing in this file
modifies, patches, or monkey-patches the installed package.
"""

from __future__ import annotations

import inspect
import json
import socket
import struct
import threading
import typing
from importlib.metadata import version

import pytest

from rlm.core import comms_utils
from rlm.core.comms_utils import (
    LMRequest,
    LMResponse,
    socket_recv,
    socket_request,
    socket_send,
)
from rlm.core.types import (
    EnvironmentType,
    ModelUsageSummary,
    REPLResult,
    RLMChatCompletion,
    UsageSummary,
)
from rlm.environments.base_env import (
    RESERVED_TOOL_NAMES,
    BaseEnv,
    IsolatedEnv,
    SupportsPersistence,
)

from repl_sandbox.config import DEFAULT_MAX_FRAME_LEN
from repl_sandbox.frame import encode_frame, read_frame_from_socket

PINNED_RLMS_VERSION = "0.1.3"


def protocol_members(protocol: type) -> set[str]:
    """The member names of a `typing.Protocol`, on 3.12 as well as 3.13+.

    `typing.get_protocol_members` is 3.13+. Ubuntu 24.04 - the deployment
    target this class is provisioned on (BUILD_PLAN section 4) - ships Python
    3.12, where the same set is only reachable through the private
    `_get_protocol_attrs`. Reaching for the private name on the older
    interpreter keeps the assertion running where the code will actually run;
    skipping instead would have made the conformance claim silently untested
    on the one platform that matters.
    """
    public = getattr(typing, "get_protocol_members", None)
    if public is not None:
        return set(public(protocol))
    return set(typing._get_protocol_attrs(protocol))  # type: ignore[attr-defined]


def test_rlms_version_is_pinned() -> None:
    """Everything below is asserted about one version only."""
    assert version("rlms") == PINNED_RLMS_VERSION


# ---------------------------------------------------------------------------
# 1. The backend contract: BaseEnv / IsolatedEnv
# ---------------------------------------------------------------------------


def test_isolated_env_is_abstract_three_method_subclass_of_base_env() -> None:
    """INTERFACES section 2 (Backend contract): three methods, separate machine."""
    assert issubclass(IsolatedEnv, BaseEnv)
    assert inspect.isabstract(IsolatedEnv)
    assert IsolatedEnv.__abstractmethods__ == frozenset(
        {"setup", "load_context", "execute_code"}
    )

    with pytest.raises(TypeError):
        IsolatedEnv()  # type: ignore[abstract]


def test_base_env_and_isolated_env_init_signatures() -> None:
    """The two `__init__` signatures differ, and the difference matters.

    `depth` and `max_concurrent_subcalls` are declared on `BaseEnv` only;
    `IsolatedEnv.__init__` takes `persistent` plus `**kwargs` and forwards. A
    subclass may therefore accept `depth=` by keyword but never positionally.
    """
    assert str(inspect.signature(BaseEnv.__init__)) == (
        "(self, persistent: bool = False, depth: int = 1, "
        "max_concurrent_subcalls: int = 4, **kwargs)"
    )
    assert str(inspect.signature(IsolatedEnv.__init__)) == (
        "(self, persistent: bool = False, **kwargs)"
    )

    # The forwarding actually works: a concrete subclass gets BaseEnv's
    # defaults, and a keyword `depth` reaches the attribute the driver reads.
    class _Concrete(IsolatedEnv):
        def setup(self):  # pragma: no cover - never called
            raise NotImplementedError

        def load_context(self, context_payload):  # pragma: no cover
            raise NotImplementedError

        def execute_code(self, code):  # pragma: no cover
            raise NotImplementedError

    default = _Concrete()
    assert (default.persistent, default.depth, default.max_concurrent_subcalls) == (
        False,
        1,
        4,
    )
    assert _Concrete(depth=1, max_concurrent_subcalls=2).max_concurrent_subcalls == 2
    with pytest.raises(TypeError):
        _Concrete(False, 1)  # depth is not positional on IsolatedEnv


# ---------------------------------------------------------------------------
# 2. REPLResult — the annotation and the object disagree
# ---------------------------------------------------------------------------


def test_replresult_carries_rlm_calls_not_the_annotated_llm_calls() -> None:
    """`@dataclass` annotates `llm_calls`; the hand-written `__init__` assigns
    `rlm_calls`, and `_set_new_attribute` leaves that `__init__` in place. The
    object the backend must produce carries `rlm_calls`.
    """
    assert str(inspect.signature(REPLResult.__init__)) == (
        "(self, stdout: str, stderr: str, locals: dict, "
        "execution_time: float = None, "
        "rlm_calls: list['RLMChatCompletion'] = None, "
        "final_answer: str | None = None)"
    )

    result = REPLResult(stdout="out", stderr="err", locals={"x": 1})
    assert sorted(vars(result)) == [
        "execution_time",
        "final_answer",
        "locals",
        "rlm_calls",
        "stderr",
        "stdout",
    ]
    assert not hasattr(result, "llm_calls")
    assert result.rlm_calls == []  # `rlm_calls or []`, so None becomes a list
    assert result.execution_time is None  # not 0.0 — the default is None

    # The dataclass field list still says `llm_calls`. This is the discrepancy.
    field_names = [f.name for f in REPLResult.__dataclass_fields__.values()]
    assert field_names == [
        "stdout",
        "stderr",
        "locals",
        "execution_time",
        "llm_calls",
        "final_answer",
    ]

    # Consequence, and the reason this is not a cosmetic mismatch: the
    # dataclass-generated `__repr__` and `__eq__` read the annotated field and
    # blow up. The backend must never `%r` or `==` a REPLResult.
    with pytest.raises(AttributeError, match="llm_calls"):
        repr(result)
    with pytest.raises(AttributeError, match="llm_calls"):
        _ = result == REPLResult(stdout="out", stderr="err", locals={"x": 1})

    # `__str__` and `to_dict` are hand-written and do work.
    assert "rlm_calls=0" in str(result)
    assert sorted(result.to_dict()) == [
        "execution_time",
        "final_answer",
        "locals",
        "rlm_calls",
        "stderr",
        "stdout",
    ]


# ---------------------------------------------------------------------------
# 3. Reserved namespace names
# ---------------------------------------------------------------------------


def test_reserved_tool_names_are_the_eight_recorded_names() -> None:
    """INTERFACES section 2 (Reserved namespace names)."""
    assert RESERVED_TOOL_NAMES == frozenset(
        {
            "llm_query",
            "llm_query_batched",
            "rlm_query",
            "rlm_query_batched",
            "SHOW_VARS",
            "answer",
            "context",
            "history",
        }
    )
    assert isinstance(RESERVED_TOOL_NAMES, frozenset)
    assert len(RESERVED_TOOL_NAMES) == 8


# ---------------------------------------------------------------------------
# 4. Wire framing — byte parity with our own encoder
# ---------------------------------------------------------------------------


def test_rlms_framing_is_four_byte_be_length_plus_utf8_json() -> None:
    """Read the framing off the bytes rlms itself puts on a socket."""
    payload = {"prompt": "héllo", "depth": 0}
    left, right = socket.socketpair()
    try:
        socket_send(left, payload)
        raw = right.recv(4096)
    finally:
        left.close()
        right.close()

    body = json.dumps(payload).encode("utf-8")
    assert raw[:4] == struct.pack(">I", len(body))
    assert raw[4:] == body
    assert json.loads(raw[4:].decode("utf-8")) == payload


def test_encode_frame_round_trips_through_rlms_socket_recv() -> None:
    """Byte parity, proved by handing our bytes to rlms' own reader.

    A real connected socket pair, not a format assertion: `encode_frame` writes,
    `rlm.core.comms_utils.socket_recv` reads, and the dict must come back
    unchanged. The reverse direction is asserted too, so the bridge can carry
    rlms frames in both directions without translation.
    """
    payload = {
        "prompt": "unicode: é中\U0001f600",
        "prompts": None,
        "model": "gpt-5",
        "depth": 1,
        "nested": {"a": [1, 2.5, True, None]},
    }

    left, right = socket.socketpair()
    try:
        frame = encode_frame(payload, DEFAULT_MAX_FRAME_LEN)
        left.sendall(frame)
        assert socket_recv(right) == payload

        # And rlms -> us.
        socket_send(right, payload)
        assert read_frame_from_socket(left, DEFAULT_MAX_FRAME_LEN) == payload
    finally:
        left.close()
        right.close()


# ---------------------------------------------------------------------------
# 5. LMRequest / LMResponse
# ---------------------------------------------------------------------------


def _usage() -> UsageSummary:
    return UsageSummary(
        model_usage_summaries={
            "m": ModelUsageSummary(
                total_calls=1, total_input_tokens=2, total_output_tokens=3
            )
        }
    )


def test_lmrequest_fields_and_the_depth_default_split() -> None:
    """`depth` defaults to 0 on the dataclass and to -1 in `from_dict`.

    A frame that omits `depth` therefore yields `depth == -1`, which is not a
    value `LMHandler.get_client` routes on (it falls through to the default
    client). The host depth ceiling must treat a missing `depth` as its own
    case rather than trusting the dataclass default.
    """
    assert [f.name for f in LMRequest.__dataclass_fields__.values()] == [
        "prompt",
        "prompts",
        "model",
        "depth",
    ]
    assert LMRequest().depth == 0
    assert LMRequest.from_dict({}).depth == -1
    assert LMRequest.from_dict({"prompt": "p"}).depth == -1
    assert LMRequest.from_dict({"prompt": "p", "depth": 1}).depth == 1

    # to_dict drops Nones but always emits `depth`.
    assert LMRequest(prompt="p").to_dict() == {"prompt": "p", "depth": 0}
    assert LMRequest(prompts=["a", "b"], model="m", depth=1).to_dict() == {
        "prompts": ["a", "b"],
        "model": "m",
        "depth": 1,
    }
    assert LMRequest().to_dict() == {"depth": 0}

    assert LMRequest(prompts=["a"]).is_batched is True
    assert LMRequest(prompts=[]).is_batched is False
    assert LMRequest(prompt="p").is_batched is False


def test_lmresponse_fields_and_to_dict_shapes() -> None:
    """`to_dict` always emits all three keys; two of them are null per branch."""
    assert [f.name for f in LMResponse.__dataclass_fields__.values()] == [
        "error",
        "chat_completion",
        "chat_completions",
    ]

    completion = RLMChatCompletion(
        root_model="m",
        prompt="p",
        response="r",
        usage_summary=_usage(),
        execution_time=0.5,
    )

    single = LMResponse.success_response(completion).to_dict()
    assert sorted(single) == ["chat_completion", "chat_completions", "error"]
    assert single["error"] is None and single["chat_completions"] is None
    assert sorted(single["chat_completion"]) == [
        "execution_time",
        "prompt",
        "response",
        "root_model",
        "usage_summary",
    ]

    batched = LMResponse.batched_success_response([completion]).to_dict()
    assert batched["chat_completion"] is None and batched["error"] is None
    assert len(batched["chat_completions"]) == 1

    failed = LMResponse.error_response("boom").to_dict()
    assert failed == {"error": "boom", "chat_completion": None, "chat_completions": None}

    # An empty LMResponse serialises as an error rather than as a success.
    assert LMResponse().to_dict()["error"] == "No chat completion or error provided."
    assert LMResponse().success is True  # ...even though `success` reads True

    # from_dict is the inverse for the shapes that carry a completion.
    revived = LMResponse.from_dict(single)
    assert revived.success is True
    assert revived.chat_completion.response == "r"
    assert revived.chat_completion.usage_summary.total_input_tokens == 2
    assert LMResponse.from_dict(batched).is_batched is True
    assert LMResponse.from_dict(failed).success is False

    # Every to_dict shape survives our frame encoder unchanged.
    for shape in (single, batched, failed):
        assert json.loads(
            encode_frame(shape, DEFAULT_MAX_FRAME_LEN)[4:].decode("utf-8")
        ) == shape


# ---------------------------------------------------------------------------
# 6. Transport family and the EnvironmentType literal
# ---------------------------------------------------------------------------


def test_socket_request_speaks_af_inet_only() -> None:
    """The transport is hardcoded TCP, which is why the bridge exists.

    Asserted two ways: functionally, by serving `socket_request` from a real
    `AF_INET` loopback listener, and textually, by confirming no other address
    family appears anywhere in the module.
    """
    source = inspect.getsource(socket_request)
    assert "socket.AF_INET" in source
    module_source = inspect.getsource(comms_utils)
    assert "AF_VSOCK" not in module_source
    assert "AF_UNIX" not in module_source
    assert "AF_INET6" not in module_source

    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    address = listener.getsockname()
    seen: list[dict] = []

    def serve() -> None:
        conn, _ = listener.accept()
        with conn:
            seen.append(socket_recv(conn))
            socket_send(conn, {"error": None, "chat_completion": None, "chat_completions": None})

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    try:
        reply = socket_request(address, {"prompt": "p", "depth": 0}, timeout=5)
    finally:
        thread.join(timeout=5)
        listener.close()

    assert seen == [{"prompt": "p", "depth": 0}]
    assert reply == {"error": None, "chat_completion": None, "chat_completions": None}


def test_environment_type_literal_has_no_kata_member() -> None:
    """INTERFACES section 2 (Driver integration seam): integrate by passing the
    instance, because the driver's environment type is a closed `Literal`.
    """
    assert typing.get_origin(EnvironmentType) is typing.Literal
    assert typing.get_args(EnvironmentType) == (
        "local",
        "ipython",
        "docker",
        "modal",
        "prime",
        "daytona",
        "e2b",
    )
    assert "kata" not in typing.get_args(EnvironmentType)


# ---------------------------------------------------------------------------
# 7. SupportsPersistence
# ---------------------------------------------------------------------------


def test_supports_persistence_is_a_runtime_checkable_five_method_protocol() -> None:
    """The `isinstance` check is structural, so the backend opts in by shape.

    The two index-returning methods matter: `add_context` and `add_history`
    return `int` and take an optional index — a backend that returns `None`
    still satisfies `isinstance`, so the contract is not enforced by the check.
    """
    assert getattr(SupportsPersistence, "_is_protocol", False) is True
    assert getattr(SupportsPersistence, "_is_runtime_protocol", False) is True
    assert protocol_members(SupportsPersistence) == {
        "update_handler_address",
        "add_context",
        "get_context_count",
        "add_history",
        "get_history_count",
    }

    signatures = {
        name: str(inspect.signature(getattr(SupportsPersistence, name)))
        for name in protocol_members(SupportsPersistence)
    }
    assert signatures["update_handler_address"] == (
        "(self, address: tuple[str, int]) -> None"
    )
    assert signatures["add_context"] == (
        "(self, context_payload: dict | list | str, "
        "context_index: int | None = None) -> int"
    )
    assert signatures["get_context_count"] == "(self) -> int"
    assert signatures["add_history"] == (
        "(self, message_history: list[dict[str, typing.Any]], "
        "history_index: int | None = None) -> int"
    )
    assert signatures["get_history_count"] == "(self) -> int"

    class _Persistent:
        def update_handler_address(self, address): ...
        def add_context(self, context_payload, context_index=None): return 0
        def get_context_count(self): return 0
        def add_history(self, message_history, history_index=None): return 0
        def get_history_count(self): return 0

    class _MissingOne(_Persistent):
        add_history = None  # type: ignore[assignment]

    assert isinstance(_Persistent(), SupportsPersistence)
    assert not isinstance(_MissingOne(), SupportsPersistence)
