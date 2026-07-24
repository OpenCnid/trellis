"""Tests for the in-guest RPC hook and the LM envelope translation.

Three groups. The translation tests check the two wires against each other; the
error tests check that a host refusal arrives in the guest as the taxonomy
exception INTERFACES section 7 names, including the terminal one; the end-to-end
tests execute real `CapabilityRegistry.materialise()` source, because the seam
being closed is precisely that generated source calls a name nothing bound.

Generated source *is* executed here, unlike in `test_capabilities.py`. That is
the point of these tests, and it is safe for the same reason it is safe in the
guest: the source is host-generated from validated fragments and the client it
reaches is a fake.

The error-code mapping is checked against strings produced by the real
`lm_handler.error_response`, not against hand-typed ones. `guest_rpc`
deliberately does not import the handler, so this is the link that catches drift
if the handler's error format changes.
"""

from __future__ import annotations

import json

import pytest
from rlm.core.comms_utils import LMRequest

from repl_sandbox.capabilities import (
    BROKER_ENVELOPE_VERSION,
    PORT_NAMES,
    PRE_REGISTERED,
    RESERVED_NAMES as CAPABILITY_RESERVED_NAMES,
    TRANSPORT_HOOK,
    CapabilityDescriptor,
    CapabilityRegistry,
)
from repl_sandbox.config import VMADDR_CID_HOST, SandboxConfig
from repl_sandbox.errors import (
    ERROR_CODES,
    CapBytesError,
    CapConcurrencyError,
    CapRateError,
    CapSpendError,
    DeniedError,
    DepthCeilingError,
    SandboxError,
    UpstreamError,
)
from repl_sandbox.guest_rpc import (
    DB_PORT_NAME,
    ENVELOPE_VERSION,
    LM_ARG_NAMES,
    LM_PORT_NAME,
    LM_TRELLIS_ARG_NAMES,
    ROOT_DEPTH,
    GuestRpc,
    lm_error_code,
    lm_request_from_envelope,
    lm_response_to_envelope,
    result_or_raise,
)
from repl_sandbox.lm_handler import (
    batched_response,
    error_code_of,
    error_response,
    single_response,
)
from repl_sandbox.supervisor import GuestSupervisor

GUEST_CID = 7
MAX_FRAME_LEN = 1 << 20

#: Distinctive enough that a substring search for it in a serialised payload is
#: a real assertion.
SENTINEL_DISPATCH_REF = "SENTINEL-ROUTE-TOKEN-9f3a2c"

#: The codes `LMHandler` actually returns in an `LMResponse.error`. `auth` and
#: `frame` are absent by design: the handler raises those and the connection is
#: dropped, so they never come back as a body.
HANDLER_ERROR_CODES: tuple[str, ...] = (
    "cap_rate",
    "cap_spend",
    "depth_ceiling",
    "cap_bytes",
    "cap_concurrency",
    "denied",
)

CODE_TO_CLASS: dict[str, type[SandboxError]] = {
    "cap_rate": CapRateError,
    "cap_spend": CapSpendError,
    "depth_ceiling": DepthCeilingError,
    "cap_bytes": CapBytesError,
    "cap_concurrency": CapConcurrencyError,
    "denied": DeniedError,
}


class RecordingClient:
    """A fake `request(payload, max_frame_len)` peer. Not a transport.

    Records what the guest actually put on the wire, which is what most of these
    tests are about, and answers with a canned reply or a callable.
    """

    def __init__(self, reply: object = None) -> None:
        self.reply = reply
        self.calls: list[tuple[dict, int]] = []

    def request(self, payload: dict, max_frame_len: int) -> dict:
        self.calls.append((payload, max_frame_len))
        if callable(self.reply):
            return self.reply(payload)
        return self.reply

    @property
    def payload(self) -> dict:
        """The single payload sent, asserting there was exactly one."""
        assert len(self.calls) == 1, f"expected one call, got {len(self.calls)}"
        return self.calls[0][0]


def ok_envelope(req_id: str = "abc", **result: object) -> dict:
    return {"v": ENVELOPE_VERSION, "req_id": req_id, "ok": True, "result": dict(result)}


def make_run_query(dispatch_ref: str = SENTINEL_DISPATCH_REF) -> CapabilityDescriptor:
    """A representative handle-returning broker capability."""
    return CapabilityDescriptor(
        name="run_query",
        typed_signature={
            "type": "object",
            "properties": {
                "sql": {"type": "string"},
                "params": {"type": "array"},
            },
            "required": ["sql"],
            "returns": {"type": "object"},
        },
        doc="Run a read-only SQL query; returns a handle plus row count and schema.",
        dispatch_ref=dispatch_ref,
    )


def make_rpc(
    lm: RecordingClient | None = None, db: RecordingClient | None = None
) -> GuestRpc:
    clients: dict[str, object] = {}
    if lm is not None:
        clients[LM_PORT_NAME] = lm
    if db is not None:
        clients[DB_PORT_NAME] = db
    return GuestRpc(clients, MAX_FRAME_LEN)


def namespace_with_stubs(registry: CapabilityRegistry, rpc: GuestRpc) -> dict:
    """Execute materialised source with the hook bound, as the supervisor does."""
    namespace: dict = {TRANSPORT_HOOK: rpc}
    exec(registry.materialise(GUEST_CID), namespace, namespace)  # noqa: S102
    return namespace


# ---------------------------------------------------------------------------
# Constants are the registry's, not a second copy
# ---------------------------------------------------------------------------


def test_the_port_names_are_the_registrys() -> None:
    assert {LM_PORT_NAME, DB_PORT_NAME} == set(PORT_NAMES)


def test_the_envelope_version_is_the_registrys() -> None:
    assert ENVELOPE_VERSION == BROKER_ENVELOPE_VERSION


# ---------------------------------------------------------------------------
# DB port: the envelope crosses untouched
# ---------------------------------------------------------------------------


def test_a_db_envelope_round_trips_through_the_client() -> None:
    handle = {"handle": "h:1", "rowcount": 3, "schema": ["id"]}
    client = RecordingClient(ok_envelope("r1", **handle))
    rpc = make_rpc(db=client)

    envelope = {
        "v": ENVELOPE_VERSION,
        "req_id": "r1",
        "op": "run_query",
        "args": {"sql": "select 1", "params": []},
    }
    assert rpc(DB_PORT_NAME, envelope) == handle
    assert client.payload == envelope
    assert client.calls[0][1] == MAX_FRAME_LEN


def test_the_db_envelope_is_sent_byte_for_byte_as_built() -> None:
    """Nothing is added on the way out — no identity, no routing key."""
    client = RecordingClient(ok_envelope())
    rpc = make_rpc(db=client)
    envelope = {"v": ENVELOPE_VERSION, "req_id": "r2", "op": "run_query", "args": {}}

    rpc(DB_PORT_NAME, dict(envelope))
    assert client.payload is not envelope  # the stub's dict, not this one
    assert client.payload == envelope
    assert list(client.payload) == ["v", "req_id", "op", "args"]


def test_an_ok_envelope_without_a_result_yields_an_empty_result() -> None:
    rpc = make_rpc(db=RecordingClient({"v": ENVELOPE_VERSION, "req_id": "r", "ok": True}))
    assert rpc(DB_PORT_NAME, {"v": ENVELOPE_VERSION, "req_id": "r", "op": "x", "args": {}}) == {}


# ---------------------------------------------------------------------------
# LM port: uniform envelope -> rlms LMRequest
# ---------------------------------------------------------------------------


def test_a_single_prompt_envelope_becomes_an_rlms_request() -> None:
    request = lm_request_from_envelope(
        {
            "v": ENVELOPE_VERSION,
            "req_id": "r3",
            "op": "llm_query",
            "args": {"prompt": "hello", "model": "gpt-x"},
        }
    )
    assert request == {"prompt": "hello", "model": "gpt-x", "depth": ROOT_DEPTH}


def test_a_batched_envelope_becomes_an_rlms_request() -> None:
    request = lm_request_from_envelope(
        {
            "v": ENVELOPE_VERSION,
            "req_id": "r4",
            "op": "llm_query_batched",
            "args": {"prompts": ["a", "b"], "model": None},
        }
    )
    assert request == {"prompts": ["a", "b"], "depth": ROOT_DEPTH}


@pytest.mark.parametrize(
    "args, expected",
    [
        ({"prompt": "p", "model": "gpt-x"}, LMRequest(prompt="p", model="gpt-x")),
        ({"prompt": "p", "model": None}, LMRequest(prompt="p")),
        ({"prompts": ["a"], "model": None}, LMRequest(prompts=["a"])),
        ({"prompt": {"messages": []}}, LMRequest(prompt={"messages": []})),
    ],
)
def test_the_payload_is_what_rlms_own_client_would_emit(args: dict, expected: object) -> None:
    """Held against the pinned dataclass, which drops its `None` fields."""
    envelope = {"v": ENVELOPE_VERSION, "req_id": "r", "op": "llm_query", "args": args}
    assert lm_request_from_envelope(envelope) == expected.to_dict()


def test_the_lm_request_carries_no_identity_and_no_routing_token() -> None:
    request = lm_request_from_envelope(
        {
            "v": ENVELOPE_VERSION,
            "req_id": "r5",
            "op": "llm_query",
            "args": {"prompt": "p", "model": "gpt-x"},
        }
    )
    assert set(request) == {"prompt", "model", "depth"}
    blob = json.dumps(request)
    for forbidden in ("cid", "req_id", "session", "dispatch_ref", "op"):
        assert forbidden not in blob


def test_depth_is_the_root_constant_and_no_argument_can_set_it() -> None:
    with pytest.raises(DeniedError) as caught:
        lm_request_from_envelope(
            {
                "v": ENVELOPE_VERSION,
                "req_id": "r6",
                "op": "llm_query",
                "args": {"prompt": "p", "depth": 9},
            }
        )
    assert "depth" in str(caught.value)
    assert ROOT_DEPTH == 0


def test_an_arg_outside_the_rlms_wire_is_refused() -> None:
    with pytest.raises(DeniedError) as caught:
        lm_request_from_envelope(
            {
                "v": ENVELOPE_VERSION,
                "req_id": "r7",
                "op": "llm_query",
                "args": {"prompt": "p", "temperature": 0.7},
            }
        )
    assert "temperature" in str(caught.value)


def test_an_envelope_with_no_prompt_is_refused() -> None:
    with pytest.raises(DeniedError):
        lm_request_from_envelope(
            {"v": ENVELOPE_VERSION, "req_id": "r8", "op": "llm_query", "args": {}}
        )


def test_a_foreign_envelope_version_is_refused() -> None:
    with pytest.raises(DeniedError):
        lm_request_from_envelope(
            {"v": 99, "req_id": "r9", "op": "llm_query", "args": {"prompt": "p"}}
        )


def test_prompts_takes_precedence_over_prompt_as_the_handler_does() -> None:
    """The same precedence `LMHandler._parse` applies, so the reads agree."""
    request = lm_request_from_envelope(
        {
            "v": ENVELOPE_VERSION,
            "req_id": "r10",
            "op": "llm_query",
            "args": {"prompt": "single", "prompts": ["batched"]},
        }
    )
    assert "prompt" not in request
    assert request["prompts"] == ["batched"]


# ---------------------------------------------------------------------------
# LM port: rlms LMResponse -> v1 response
# ---------------------------------------------------------------------------


def test_a_single_completion_becomes_a_v1_result() -> None:
    completion = {"response": "hi", "prompt": "p"}
    assert lm_response_to_envelope(single_response(completion), "r11") == {
        "v": ENVELOPE_VERSION,
        "req_id": "r11",
        "ok": True,
        "result": {"chat_completion": completion},
    }


def test_batched_completions_become_a_v1_result() -> None:
    completions = [{"response": "a"}, {"response": "b"}]
    assert lm_response_to_envelope(batched_response(completions), "r12") == {
        "v": ENVELOPE_VERSION,
        "req_id": "r12",
        "ok": True,
        "result": {"chat_completions": completions},
    }


def test_the_null_sibling_key_is_dropped_from_the_result() -> None:
    envelope = lm_response_to_envelope(single_response({"response": "hi"}), "r13")
    assert set(envelope["result"]) == {"chat_completion"}


def test_a_response_with_neither_error_nor_completion_is_upstream() -> None:
    with pytest.raises(UpstreamError):
        lm_response_to_envelope(
            {"error": None, "chat_completion": None, "chat_completions": None}, "r14"
        )


def test_an_lm_round_trip_returns_the_completion_to_model_code() -> None:
    completion = {"response": "hi"}
    client = RecordingClient(single_response(completion))
    rpc = make_rpc(lm=client)

    result = rpc(
        LM_PORT_NAME,
        {
            "v": ENVELOPE_VERSION,
            "req_id": "r15",
            "op": "llm_query",
            "args": {"prompt": "p", "model": None},
        },
    )
    assert result == {"chat_completion": completion}
    assert client.payload == {"prompt": "p", "depth": ROOT_DEPTH}


# ---------------------------------------------------------------------------
# Errors surface as Python exceptions
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("code", HANDLER_ERROR_CODES)
def test_each_handler_error_code_raises_its_taxonomy_exception(code: str) -> None:
    """Built from the real `error_response`, so the parse tracks the handler."""
    response = error_response(code, "why it fired")
    client = RecordingClient(response)
    rpc = make_rpc(lm=client)

    with pytest.raises(CODE_TO_CLASS[code]) as caught:
        rpc(
            LM_PORT_NAME,
            {
                "v": ENVELOPE_VERSION,
                "req_id": "r16",
                "op": "llm_query",
                "args": {"prompt": "p"},
            },
        )
    assert caught.value.code == code
    assert "why it fired" in caught.value.message


def test_the_local_code_parse_agrees_with_the_handlers_own() -> None:
    """The drift pin: `guest_rpc` re-derives what `lm_handler` writes."""
    for code in ERROR_CODES:
        for detail in (None, "detail: with a colon"):
            emitted = error_response(code, detail)["error"]
            assert lm_error_code(emitted) == code == error_code_of(error_response(code, detail))


def test_an_unrecognised_error_string_becomes_upstream() -> None:
    """rlms' own client writes `Request failed: ...`, which is not a code."""
    envelope = lm_response_to_envelope(
        {"error": "Request failed: connection reset", "chat_completion": None}, "r17"
    )
    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "upstream"
    assert envelope["error"]["message"] == "Request failed: connection reset"


def test_cap_spend_surfaces_as_session_terminal() -> None:
    client = RecordingClient(error_response(CapSpendError.code, "session halted"))
    rpc = make_rpc(lm=client)

    with pytest.raises(CapSpendError) as caught:
        rpc(
            LM_PORT_NAME,
            {
                "v": ENVELOPE_VERSION,
                "req_id": "r18",
                "op": "llm_query",
                "args": {"prompt": "p"},
            },
        )
    assert caught.value.session_terminal is True
    assert caught.value.retryable is False


def test_cap_rate_stays_retryable_across_the_translation() -> None:
    envelope = lm_response_to_envelope(error_response("cap_rate", "retry_after_s=0.25"), "r19")
    assert envelope["error"]["retryable"] is True
    with pytest.raises(CapRateError) as caught:
        result_or_raise(envelope)
    assert caught.value.retryable is True


def test_a_broker_error_object_raises_the_same_taxonomy_exception() -> None:
    """The DB port needs no translation; the spine's error object is the wire."""
    client = RecordingClient(
        {
            "v": ENVELOPE_VERSION,
            "req_id": "r20",
            "ok": False,
            "error": DeniedError("op is not granted").to_error_object(),
        }
    )
    rpc = make_rpc(db=client)
    with pytest.raises(DeniedError) as caught:
        rpc(DB_PORT_NAME, {"v": ENVELOPE_VERSION, "req_id": "r20", "op": "x", "args": {}})
    assert caught.value.message == "op is not granted"


def test_a_malformed_refusal_still_raises() -> None:
    client = RecordingClient({"v": ENVELOPE_VERSION, "req_id": "r21", "ok": False})
    rpc = make_rpc(db=client)
    with pytest.raises(UpstreamError):
        rpc(DB_PORT_NAME, {"v": ENVELOPE_VERSION, "req_id": "r21", "op": "x", "args": {}})


def test_a_reply_that_is_not_an_envelope_is_upstream() -> None:
    for reply in ({"ok": True}, {"v": 99, "ok": True}, [], None):
        rpc = make_rpc(db=RecordingClient(reply))
        with pytest.raises(UpstreamError):
            rpc(DB_PORT_NAME, {"v": ENVELOPE_VERSION, "req_id": "r", "op": "x", "args": {}})


# ---------------------------------------------------------------------------
# Ports
# ---------------------------------------------------------------------------


def test_an_unknown_port_name_raises_rather_than_falling_back() -> None:
    lm, db = RecordingClient(single_response({})), RecordingClient(ok_envelope())
    rpc = make_rpc(lm=lm, db=db)
    for port in ("CONTROL_PORT", "lm_port", "", None):
        with pytest.raises(DeniedError):
            rpc(port, {"v": ENVELOPE_VERSION, "req_id": "r", "op": "x", "args": {}})
    assert lm.calls == [] and db.calls == []


def test_a_port_with_no_client_raises_rather_than_using_the_other() -> None:
    db = RecordingClient(ok_envelope())
    rpc = make_rpc(db=db)
    with pytest.raises(DeniedError) as caught:
        rpc(
            LM_PORT_NAME,
            {"v": ENVELOPE_VERSION, "req_id": "r", "op": "llm_query", "args": {"prompt": "p"}},
        )
    assert LM_PORT_NAME in str(caught.value)
    assert db.calls == []


def test_the_client_mapping_is_copied_at_construction() -> None:
    db = RecordingClient(ok_envelope())
    clients: dict[str, object] = {DB_PORT_NAME: db}
    rpc = GuestRpc(clients, MAX_FRAME_LEN)
    clients[DB_PORT_NAME] = RecordingClient(ok_envelope())

    rpc(DB_PORT_NAME, {"v": ENVELOPE_VERSION, "req_id": "r", "op": "x", "args": {}})
    assert len(db.calls) == 1


# ---------------------------------------------------------------------------
# End to end: materialised source calling the bound hook
# ---------------------------------------------------------------------------


def test_a_materialised_db_stub_reaches_the_client_with_the_uniform_envelope() -> None:
    registry = CapabilityRegistry()
    registry.register(GUEST_CID, make_run_query(), DB_PORT_NAME)

    client = RecordingClient(ok_envelope(handle="h:9", rowcount=2))
    namespace = namespace_with_stubs(registry, make_rpc(db=client))

    assert namespace["run_query"]("select 1", ["a"]) == {"handle": "h:9", "rowcount": 2}

    payload = client.payload
    assert list(payload) == ["v", "req_id", "op", "args"]
    assert payload["v"] == ENVELOPE_VERSION
    assert payload["op"] == "run_query"
    assert payload["args"] == {"sql": "select 1", "params": ["a"]}
    assert isinstance(payload["req_id"], str) and len(payload["req_id"]) == 32


def test_the_stub_envelope_carries_no_identity_and_no_dispatch_ref() -> None:
    registry = CapabilityRegistry()
    registry.register(GUEST_CID, make_run_query(), DB_PORT_NAME)

    client = RecordingClient(ok_envelope())
    namespace = namespace_with_stubs(registry, make_rpc(db=client))
    namespace["run_query"]("select 1")

    payload = client.payload
    assert list(payload) == ["v", "req_id", "op", "args"]
    # The CID is nowhere in the body: the host reads it from `accept()`. Checked
    # by value rather than by substring, because a random hex `req_id` contains
    # every digit sooner or later.
    assert GUEST_CID not in payload.values()
    assert GUEST_CID not in payload["args"].values()

    blob = json.dumps(payload)
    assert SENTINEL_DISPATCH_REF not in blob
    for forbidden in ("dispatch_ref", "cid", "session", "run_id"):
        assert forbidden not in blob


def test_a_materialised_llm_query_stub_translates_to_the_rlms_wire() -> None:
    registry = CapabilityRegistry()
    for descriptor in PRE_REGISTERED:
        registry.register(GUEST_CID, descriptor, LM_PORT_NAME)

    completion = {"response": "hi"}
    client = RecordingClient(lambda payload: single_response(completion))
    namespace = namespace_with_stubs(registry, make_rpc(lm=client))

    assert namespace["llm_query"]("p", "gpt-x") == {"chat_completion": completion}
    assert client.payload == {"prompt": "p", "model": "gpt-x", "depth": ROOT_DEPTH}


def test_a_materialised_batched_stub_translates_to_the_rlms_wire() -> None:
    registry = CapabilityRegistry()
    for descriptor in PRE_REGISTERED:
        registry.register(GUEST_CID, descriptor, LM_PORT_NAME)

    completions = [{"response": "a"}, {"response": "b"}]
    client = RecordingClient(batched_response(completions))
    namespace = namespace_with_stubs(registry, make_rpc(lm=client))

    assert namespace["llm_query_batched"](["a", "b"]) == {"chat_completions": completions}
    assert client.payload == {"prompts": ["a", "b"], "depth": ROOT_DEPTH}


# ---------------------------------------------------------------------------
# The supervisor binding
# ---------------------------------------------------------------------------


def supervisor_with(rpc: GuestRpc | None, registry: CapabilityRegistry) -> GuestSupervisor:
    return GuestSupervisor(
        SandboxConfig(max_frame_len=MAX_FRAME_LEN),
        stub_source=registry.materialise(GUEST_CID),
        rpc_hook=rpc,
        reserved_names=CAPABILITY_RESERVED_NAMES,
    )


def run(supervisor: GuestSupervisor, code: str) -> dict:
    response = supervisor.handle_request(VMADDR_CID_HOST, {"op": "exec", "code": code})
    assert response["ok"] is True
    return response["result"]


def test_the_supervisor_binds_the_hook_for_materialised_stubs() -> None:
    registry = CapabilityRegistry()
    registry.register(GUEST_CID, make_run_query(), DB_PORT_NAME)
    client = RecordingClient(ok_envelope(handle="h:3", rowcount=1))

    supervisor = supervisor_with(make_rpc(db=client), registry)
    result = run(supervisor, "out = run_query('select 1')\nprint(out['handle'])")

    assert result["stderr"] == ""
    assert result["stdout"].strip() == "h:3"
    assert client.payload["op"] == "run_query"


def test_a_host_refusal_lands_in_stderr_as_a_traceback() -> None:
    """INTERFACES section 7's surfacing rule, end to end."""
    registry = CapabilityRegistry()
    for descriptor in PRE_REGISTERED:
        registry.register(GUEST_CID, descriptor, LM_PORT_NAME)
    client = RecordingClient(error_response("cap_rate", "retry_after_s=0.250"))

    supervisor = supervisor_with(make_rpc(lm=client), registry)
    result = run(supervisor, "llm_query('p')")

    assert "Traceback" in result["stderr"]
    assert "CapRateError" in result["stderr"]
    assert "retry_after_s=0.250" in result["stderr"]


def test_the_hook_is_not_marshalled_back_to_the_host() -> None:
    registry = CapabilityRegistry()
    registry.register(GUEST_CID, make_run_query(), DB_PORT_NAME)
    supervisor = supervisor_with(make_rpc(db=RecordingClient(ok_envelope())), registry)

    result = run(supervisor, "x = 1")
    assert set(result["locals"]) == {"x"}
    assert TRANSPORT_HOOK in supervisor.namespace()


def test_without_a_hook_a_stub_call_is_a_name_error() -> None:
    """The default is unchanged, and this is the gap the binding closes."""
    registry = CapabilityRegistry()
    registry.register(GUEST_CID, make_run_query(), DB_PORT_NAME)

    supervisor = supervisor_with(None, registry)
    result = run(supervisor, "run_query('select 1')")

    assert "NameError" in result["stderr"]
    assert TRANSPORT_HOOK in result["stderr"]


# ---------------------------------------------------------------------------
# LM port: the Trellis `context` extension
#
# `context` is **not an rlms field** (INTERFACES section 4). rlms' own client
# never sets it and rlms' own parser drops it; this side of the seam only carries
# it, because there is nothing in the guest to resolve a handle against.
# ---------------------------------------------------------------------------

#: The `{id, kind}` wire shape of a handle (DATA_MODEL section 1). Opaque here on
#: purpose — the guest holds exactly this and never the referent.
HANDLE_REF = {"id": "8f2c" * 8, "kind": "text-blocks"}


def test_context_is_carried_through_the_translation() -> None:
    request = lm_request_from_envelope(
        {
            "v": ENVELOPE_VERSION,
            "req_id": "c1",
            "op": "llm_query",
            "args": {"prompt": "summarise", "model": "gpt-x", "context": HANDLE_REF},
        }
    )
    assert request == {
        "prompt": "summarise",
        "model": "gpt-x",
        "context": HANDLE_REF,
        "depth": ROOT_DEPTH,
    }


def test_a_context_frame_is_the_rlms_frame_plus_exactly_one_key() -> None:
    """The extension is additive: strip `context` and rlms' own client's frame remains."""
    args = {"prompt": "summarise", "model": "gpt-x", "context": [HANDLE_REF]}
    envelope = {"v": ENVELOPE_VERSION, "req_id": "c2", "op": "llm_query", "args": args}

    request = lm_request_from_envelope(envelope)
    native = {key: value for key, value in request.items() if key != "context"}

    assert native == LMRequest(prompt="summarise", model="gpt-x").to_dict()
    assert set(request) - set(native) == {"context"}
    # And rlms' own parser simply does not see the extension.
    assert LMRequest.from_dict(request).to_dict() == native


def test_a_null_context_is_dropped_rather_than_sent_as_null() -> None:
    """The generated stub always emits the key; a context-less call must not."""
    request = lm_request_from_envelope(
        {
            "v": ENVELOPE_VERSION,
            "req_id": "c3",
            "op": "llm_query",
            "args": {"prompt": "p", "model": None, "context": None},
        }
    )
    assert request == LMRequest(prompt="p").to_dict()
    assert "context" not in request


def test_context_carries_no_identity_and_no_routing_token() -> None:
    request = lm_request_from_envelope(
        {
            "v": ENVELOPE_VERSION,
            "req_id": "c4",
            "op": "llm_query",
            "args": {"prompt": "p", "context": HANDLE_REF},
        }
    )
    assert set(request) == {"prompt", "context", "depth"}
    blob = json.dumps(request)
    for forbidden in ("cid", "req_id", "session", "dispatch_ref", "op"):
        assert forbidden not in blob


def test_depth_is_still_unsettable_when_context_is_present() -> None:
    """`context` gives a caller no new route to `LMRequest.depth`."""
    with pytest.raises(DeniedError) as caught:
        lm_request_from_envelope(
            {
                "v": ENVELOPE_VERSION,
                "req_id": "c5",
                "op": "llm_query",
                "args": {"prompt": "p", "context": HANDLE_REF, "depth": 9},
            }
        )
    assert "depth" in str(caught.value)

    # And a `depth` smuggled inside the context payload is not read as one: the
    # field is carried whole and the constant is written last.
    smuggled = lm_request_from_envelope(
        {
            "v": ENVELOPE_VERSION,
            "req_id": "c6",
            "op": "llm_query",
            "args": {"prompt": "p", "context": {**HANDLE_REF, "depth": 9}},
        }
    )
    assert smuggled["depth"] == ROOT_DEPTH


def test_context_is_the_only_extension_the_lm_port_admits() -> None:
    assert LM_TRELLIS_ARG_NAMES == {"context"}
    assert LM_ARG_NAMES == {"prompt", "prompts", "model"} | LM_TRELLIS_ARG_NAMES
    with pytest.raises(DeniedError) as caught:
        lm_request_from_envelope(
            {
                "v": ENVELOPE_VERSION,
                "req_id": "c7",
                "op": "llm_query",
                "args": {"prompt": "p", "context": HANDLE_REF, "corpus": "raw text"},
            }
        )
    assert "corpus" in str(caught.value)


def test_the_batched_path_carries_context_too() -> None:
    request = lm_request_from_envelope(
        {
            "v": ENVELOPE_VERSION,
            "req_id": "c8",
            "op": "llm_query_batched",
            "args": {"prompts": ["a", "b"], "context": [HANDLE_REF]},
        }
    )
    assert request == {"prompts": ["a", "b"], "context": [HANDLE_REF], "depth": ROOT_DEPTH}


def test_a_materialised_stub_reaches_the_wire_with_context() -> None:
    """End to end through the generated source the guest actually executes."""
    registry = CapabilityRegistry()
    for descriptor in PRE_REGISTERED:
        registry.register(GUEST_CID, descriptor, LM_PORT_NAME)

    completion = {"response": "a summary"}
    client = RecordingClient(lambda payload: single_response(completion))
    namespace = namespace_with_stubs(registry, make_rpc(lm=client))

    result = namespace["llm_query"]("summarise", context=HANDLE_REF)

    assert result == {"chat_completion": completion}
    assert client.payload == {
        "prompt": "summarise",
        "context": HANDLE_REF,
        "depth": ROOT_DEPTH,
    }


def test_a_materialised_stub_without_context_emits_the_native_frame() -> None:
    registry = CapabilityRegistry()
    for descriptor in PRE_REGISTERED:
        registry.register(GUEST_CID, descriptor, LM_PORT_NAME)

    client = RecordingClient(lambda payload: single_response({"response": "hi"}))
    namespace = namespace_with_stubs(registry, make_rpc(lm=client))

    namespace["llm_query"]("p", "gpt-x")

    assert client.payload == {"prompt": "p", "model": "gpt-x", "depth": ROOT_DEPTH}
    assert "context" not in client.payload


def test_a_context_refusal_surfaces_to_model_code_as_an_exception() -> None:
    """A foreign or malformed handle lands in stderr as a traceback, not a value."""
    registry = CapabilityRegistry()
    for descriptor in PRE_REGISTERED:
        registry.register(GUEST_CID, descriptor, LM_PORT_NAME)

    client = RecordingClient(lambda payload: error_response("denied"))
    namespace = namespace_with_stubs(registry, make_rpc(lm=client))

    with pytest.raises(DeniedError) as caught:
        namespace["llm_query"]("summarise", context=HANDLE_REF)
    # Bare `denied`: the host tells the guest nothing about why, so the error
    # channel cannot be walked to learn whether another session's handle exists.
    assert str(caught.value) == "denied"


def test_the_pre_registered_stubs_declare_a_handle_shaped_context_slot() -> None:
    """The rendered stub is prompt text: the slot must read as "a handle goes here"."""
    registry = CapabilityRegistry()
    for descriptor in PRE_REGISTERED:
        registry.register(GUEST_CID, descriptor, LM_PORT_NAME)

    rendered = registry.render(GUEST_CID)

    for name in ("llm_query", "llm_query_batched"):
        assert f"def {name}(" in rendered
    assert rendered.count("context: Handle | None = None") == 2
    # A frame, not an example: no worked call, no sample handle, no sample rows.
    assert "context=" not in rendered
    assert HANDLE_REF["id"] not in rendered
