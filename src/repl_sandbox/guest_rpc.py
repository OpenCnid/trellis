"""The in-guest RPC hook the materialised capability stubs call.

Source of truth: docs/product/repl-sandbox/REPL_SANDBOX_INTERFACES.md section 1
(Seam map) for which port carries what, section 4 (LM-handler RPC surface) for
the rlms-native LM wire, section 5 (DB-broker RPC surface) for the `v1` broker
envelope, section 6 (CapabilityDescriptor lifecycle — one object, two
renderings) for the envelope the generated stubs emit, and section 7 (Error
model) for how a host refusal reaches the model.

**The seam, and the reading this module commits to.** `capabilities.py`
materialises stubs whose bodies call `_trellis_rpc(port_name, request)` with the
uniform `{v, req_id, op, args}` envelope on *both* ports, which is what section 6
specifies. Section 4 pins the LM wire to rlms' own `LMRequest`/`LMResponse`,
which is not that envelope. Both readings are in the records; they are reconciled
here rather than by widening either side. **The uniform envelope is the
guest-side calling convention; this module translates it to the rlms-native wire
at the LM port.** The stub generator goes on emitting one shape, the host LM
handler goes on reading rlms frames unchanged from the pinned `rlms==0.1.3`
(section 8), and the translation is a few lines in the middle. The DB port needs
no translation at all: there the calling convention and the wire are the same
`v1` envelope.

**This code runs inside the untrusted guest, and it is not a boundary.** Model
code can ignore it entirely — open its own socket, speak either wire directly,
and skip every check below — and nothing is lost when it does, because the host
authenticates by the CID the kernel supplied at `accept()` and enforces every cap
regardless (INTERFACES section 3.1, section 4). That is exactly why it is safe
for this to be convenience code: the shape checks here exist to make the
translation well defined and to fail loudly on a host-side registration bug, and
none of them is claimed as an enforcement.

**Three things it does hold, because they are properties of what it *sends*.**

* *No identity, no routing token.* The envelope carries `v`, `req_id`, `op`,
  `args` and nothing else, and the LM payload carries the rlms wire's own fields
  plus `context` — a Trellis extension to that wire (INTERFACES section 4), not an
  rlms field, and the only one. There is no cid, no session id, and no
  `dispatch_ref`: the host reads identity from the kernel and resolves routing from
  its own `(CID, op)` table, and a guest-echoed routing token is the
  confused-deputy path the broker refuses (INTERFACES section 5, Tool denial).
  `context` is not a counterexample: it names handles the host minted for this CID
  and resolves them in its own table, so nothing in it routes anything.
* *Depth is not guest-reported.* `depth` is emitted as the constant `ROOT_DEPTH`
  because the rlms wire declares the field; no stub argument can set it. The
  ceiling is host-derived either way (INTERFACES section 4).
* *Errors become Python exceptions.* A refusal is raised, not returned, so it
  lands in `REPLResult.stderr` as a traceback and feeds the model's self-debug
  loop — INTERFACES section 7's surfacing rule.

**Why `lm_handler` is not imported here.** The LM error-code parse below is the
inverse of `lm_handler.error_response`, and importing `error_code_of` would be
the drift-free way to say so anywhere else. It is re-derived instead because this
module is shipped inside the guest image, and importing the host handler would
carry `repl_sandbox.dlp` — the detection patterns — in with it, which is the same
"free tuning feedback" the handler declines to put on the wire. The link is kept
by test instead: `test_guest_rpc.py` pins this parse against real
`lm_handler.error_response` output for every code in the taxonomy.
"""

from __future__ import annotations

from typing import Any, Protocol

from repl_sandbox.capabilities import BROKER_ENVELOPE_VERSION, PORT_NAMES
from repl_sandbox.errors import (
    ERROR_CLASSES,
    DeniedError,
    UpstreamError,
    error_from_object,
)

#: `v` of the guest-side calling convention and of the broker wire. Same number
#: on purpose: on `DB_PORT` they are the same envelope (INTERFACES section 5).
ENVELOPE_VERSION = BROKER_ENVELOPE_VERSION

#: The two data ports of INTERFACES section 1 (Seam map). Named here so the
#: translation can key on the LM port; pinned against `capabilities.PORT_NAMES`
#: by the tests.
LM_PORT_NAME = "LM_PORT"
DB_PORT_NAME = "DB_PORT"

#: The `depth` this guest reports on the rlms wire. A call made from the worker
#: REPL is at the root of the fan-out, and the fan-out is flat by construction
#: (`max_depth = 1`), so the value is a constant rather than anything a caller
#: can influence. The ceiling that matters is the host's.
ROOT_DEPTH = 0

#: The only `args` keys an `LM_PORT` capability may carry: rlms' own wire field
#: names, **plus `context`, which is a Trellis extension and not an rlms field**
#: (INTERFACES section 4). Anything else in a stub's args means a capability was
#: registered on the LM port with a signature this wire cannot express, which is a
#: host registration bug worth seeing immediately.
LM_ARG_NAMES: frozenset[str] = frozenset({"prompt", "prompts", "model", "context"})

#: The one name in `LM_ARG_NAMES` that rlms does not know. Kept separate so the
#: distinction is readable in code and not only in a comment: rlms' own client
#: never emits this key, and rlms' own `LMRequest.from_dict` would drop it.
LM_TRELLIS_ARG_NAMES: frozenset[str] = frozenset({"context"})

#: Echoed back when a caller supplied no usable `req_id`. The same sentinel the
#: broker uses for the same case (`broker._safe_req_id`).
_UNKNOWN_REQ_ID = "invalid"


class RpcClient(Protocol):
    """One framed request/response exchange with the host.

    `transport.VsockClient` and `transport.LoopbackClient` both satisfy this
    structurally. The loopback one is a test double and not a boundary.
    """

    def request(self, payload: dict, max_frame_len: int) -> dict: ...


# ---------------------------------------------------------------------------
# LM translation: uniform envelope <-> rlms-native wire
# ---------------------------------------------------------------------------


def _args_of(envelope: object) -> dict:
    """The `args` map of a uniform envelope, or a loud failure.

    Shape checking only, so the translation below has something well defined to
    read. It is not a gate on what reaches the host: the host parses the wire
    itself and refuses what it cannot shape (`LMHandler._parse`).
    """
    if not isinstance(envelope, dict):
        raise DeniedError(
            f"an RPC envelope must be an object, got {type(envelope).__name__}"
        )
    if envelope.get("v") != ENVELOPE_VERSION:
        raise DeniedError(
            f"unsupported envelope version {envelope.get('v')!r}; this guest "
            f"speaks v{ENVELOPE_VERSION}"
        )
    args = envelope.get("args", {})
    if not isinstance(args, dict):
        raise DeniedError(f"envelope args must be an object, got {type(args).__name__}")
    return args


def lm_request_from_envelope(envelope: dict) -> dict:
    """Translate `{v, req_id, op, args}` into an rlms `LMRequest` dict.

    The result carries only the wire's own fields — `prompt` or `prompts`,
    `model`, `depth` — plus `context` when the caller passed one, and nothing else.
    `req_id` and `op` do not cross: the LM wire has no field for either, and the
    handler keys the call to the session by the CID it read at `accept()` rather
    than by anything in the body (INTERFACES section 4, Auth).

    **`context` is the Trellis extension** (INTERFACES section 4), carried through
    unread: it holds handle tokens, and the host resolves them against the per-CID
    handle table. This function neither resolves nor inspects them, because there
    is nothing in the guest to resolve them against — that absence is the point.
    Omitted entirely when the caller passed none, so a call without context emits
    the byte-identical frame rlms' own client would emit.

    A `model` of `None` is dropped rather than sent as null, because
    `rlm.core.comms_utils.LMRequest.to_dict()` drops its `None` fields: the frame
    this emits is the frame rlms' own client would emit for the same call, which
    is what keeps the pin of INTERFACES section 8 meaningful. `test_guest_rpc.py`
    holds that against the real dataclass.

    `prompts` wins over `prompt` when a hand-rolled call carries both, which is
    the precedence `LMHandler._parse` applies, so the guest's read of its own
    call cannot diverge from the host's.
    """
    args = _args_of(envelope)

    if "depth" in args:
        # A stub argument must never reach `LMRequest.depth`: the ceiling is
        # host-derived and the reported depth is a constant here.
        raise DeniedError(
            "an LM capability may not take a 'depth' argument; depth is "
            "host-derived, not guest-reported"
        )
    unknown = sorted(set(args) - LM_ARG_NAMES)
    if unknown:
        raise DeniedError(
            f"LM args {unknown} are not fields of the rlms wire "
            f"{sorted(LM_ARG_NAMES)}"
        )

    if "prompts" in args:
        request: dict[str, Any] = {"prompts": args["prompts"]}
    elif "prompt" in args:
        request = {"prompt": args["prompt"]}
    else:
        raise DeniedError(
            f"LM op {envelope.get('op')!r} carries neither 'prompt' nor 'prompts'"
        )

    model = args.get("model")
    if model is not None:
        request["model"] = model

    context = args.get("context")
    if context is not None:
        # Passed through as the stub built it. A `None` is dropped rather than
        # sent as null, for the same reason `model` is: the frame a
        # context-less call emits must stay the one rlms would emit.
        request["context"] = context

    # Last, and from a constant. No stub argument reaches it — the `depth` guard
    # above refuses the argument outright, and `context` gives a caller no new way
    # to name it, because it is read as handles and never as wire fields.
    request["depth"] = ROOT_DEPTH
    return request


def lm_error_code(error: str) -> str:
    """The taxonomy code inside an `LMResponse.error` string.

    `lm_handler.error_response` writes `"{code}"` or `"{code}: {detail}"`, so the
    code is the head of the string. Anything that does not resolve to a taxonomy
    class — an rlms-native failure string such as `"Request failed: ..."`, say —
    is read as `upstream`, which is what the taxonomy already says a passthrough
    fault is.
    """
    head = error.split(":", 1)[0].strip()
    return head if head in ERROR_CLASSES else UpstreamError.code


def lm_response_to_envelope(response: dict, req_id: str) -> dict:
    """Translate an rlms `LMResponse` dict into the `v1` response envelope.

    Both ports then converge on one shape, so there is one place that decides
    whether a call raises. The completion member is carried under its own rlms
    name (`chat_completion` / `chat_completions`) into `result`; the null sibling
    is dropped, because a null in an `ok` result is not information.

    The rlms wire has no `retryable` field, so the flag comes from the taxonomy
    class rather than from a host answer — which is why a `cap_rate` retry-after
    survives only as message text on this port, and not as a field.
    """
    if not isinstance(response, dict):
        raise UpstreamError(
            f"the LM handler returned {type(response).__name__}, not an object"
        )

    error = response.get("error")
    if isinstance(error, str) and error:
        code = lm_error_code(error)
        return {
            "v": ENVELOPE_VERSION,
            "req_id": req_id,
            "ok": False,
            # The whole error string is the message: the detail after the code is
            # what the handler chose to tell the guest, and it belongs in the
            # traceback the model reads.
            "error": {
                "code": code,
                "message": error,
                "retryable": ERROR_CLASSES[code].retryable,
            },
        }

    result: dict[str, Any] = {}
    if response.get("chat_completions") is not None:
        result["chat_completions"] = response["chat_completions"]
    elif response.get("chat_completion") is not None:
        result["chat_completion"] = response["chat_completion"]
    else:
        raise UpstreamError("the LM handler returned neither an error nor a completion")
    return {"v": ENVELOPE_VERSION, "req_id": req_id, "ok": True, "result": result}


# ---------------------------------------------------------------------------
# The hook
# ---------------------------------------------------------------------------


def _echoed_req_id(envelope: object) -> str:
    """The caller's `req_id`, for correlation only.

    Never routed on: each RPC is one connection with one reply (INTERFACES
    section 3.1), so there is nothing to correlate against and nothing a
    mismatched echo could redirect.
    """
    if isinstance(envelope, dict):
        raw = envelope.get("req_id")
        if isinstance(raw, str) and raw:
            return raw
    return _UNKNOWN_REQ_ID


def result_or_raise(response: object) -> dict:
    """The `result` of a `v1` response, or the taxonomy exception it carries.

    This is INTERFACES section 7's surfacing rule at the point it applies: a host
    refusal becomes a Python exception inside the guest, so it lands in
    `REPLResult.stderr` as a traceback and feeds the model's self-debug loop.
    Raising `CapSpendError` here is that surfacing and nothing more — the session
    halt is the host's, already taken before this reply was written.
    """
    if not isinstance(response, dict) or response.get("v") != ENVELOPE_VERSION:
        raise UpstreamError(f"host reply is not a v{ENVELOPE_VERSION} envelope")

    ok = response.get("ok")
    if ok is False:
        error = response.get("error")
        # An unusable error member still raises: `error_from_object` reads a
        # missing code as `upstream`, so a malformed refusal is never mistaken
        # for a result.
        raise error_from_object(error if isinstance(error, dict) else {})
    if ok is not True:
        raise UpstreamError("host reply carries no ok flag")

    result = response.get("result", {})
    if not isinstance(result, dict):
        raise UpstreamError(
            f"host reply carries a {type(result).__name__} result, not an object"
        )
    return result


class GuestRpc:
    """The `_trellis_rpc(port_name, request)` the generated stubs call.

    Bound into the worker namespace by the guest supervisor under
    `capabilities.TRANSPORT_HOOK` before any materialised source executes. One
    client per port; a port this guest was not given a client for is a host
    construction bug and fails loudly rather than falling back to the other port,
    because "the other port" is a different chokepoint with a different cap set.

    Holds no credential: a client is a socket address, and every credential lives
    behind the host end of the port it dials (ARCHITECTURE section 4).
    """

    def __init__(self, clients: dict[str, RpcClient], max_frame_len: int) -> None:
        # Copied, so a later mutation of the caller's mapping cannot re-point a
        # port under a running session.
        self._clients: dict[str, RpcClient] = dict(clients)
        self._max_frame_len = int(max_frame_len)

    def ports(self) -> tuple[str, ...]:
        """The port names this guest holds a client for, sorted."""
        return tuple(sorted(self._clients))

    def __call__(self, port_name: str, request: dict) -> dict:
        """Send one stub call and return its result, or raise its refusal.

        The DB envelope goes out exactly as the stub built it — this method adds
        nothing to it, which is how the "no identity, no routing token" property
        stays true by construction rather than by inspection.
        """
        if port_name not in PORT_NAMES:
            raise DeniedError(
                f"{port_name!r} is not a sandbox port; the ports are {list(PORT_NAMES)}"
            )
        client = self._clients.get(port_name)
        if client is None:
            raise DeniedError(
                f"this guest holds no client for {port_name!r}; it holds "
                f"{list(self.ports())}"
            )

        if port_name == LM_PORT_NAME:
            payload = lm_request_from_envelope(request)
            response = lm_response_to_envelope(
                client.request(payload, self._max_frame_len), _echoed_req_id(request)
            )
        else:
            response = client.request(request, self._max_frame_len)
        return result_or_raise(response)


__all__ = [
    "ENVELOPE_VERSION",
    "DB_PORT_NAME",
    "LM_ARG_NAMES",
    "LM_PORT_NAME",
    "LM_TRELLIS_ARG_NAMES",
    "ROOT_DEPTH",
    "GuestRpc",
    "RpcClient",
    "lm_error_code",
    "lm_request_from_envelope",
    "lm_response_to_envelope",
    "result_or_raise",
]
