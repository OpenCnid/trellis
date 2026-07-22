"""The rlms-facing backend: `KataREPL(IsolatedEnv)`.

Source of truth: docs/product/repl-sandbox/REPL_SANDBOX_INTERFACES.md section 2
(Backend contract — `KataREPL(IsolatedEnv)`), with the handle discipline of
REPL_SANDBOX_DATA_MODEL.md section 7 (doubts / beliefs / facts as handles) and
the marshaling rules of section 8 (`execute_code` result marshaling).

**Driver integration.** `rlm.core.types.EnvironmentType` is a closed `Literal`
(`local/ipython/docker/modal/prime/daytona/e2b`) with no "kata" member
*(source-confirmed)*. Integrate by constructing this class and handing the
instance to the driver. Never monkey-patch the `Literal`: `get_environment`
would still not know how to build it, and a widened type would only make an
unsupported configuration typecheck.

**The contract is the installed source, not the record.** Three facts this class
is written against, each read from `rlms==0.1.3` and asserted by
`tests/test_rlms_conformance.py`:

* `IsolatedEnv.__init__` is `(self, persistent=False, **kwargs)` and forwards to
  `BaseEnv`, so `depth` and `max_concurrent_subcalls` reach the base class as
  keywords only.
* `REPLResult`'s dataclass annotation says `llm_calls` while its hand-written
  `__init__` assigns `rlm_calls`. The object really carries `rlm_calls`, and its
  generated `__repr__`/`__eq__` raise. Nothing here ever `repr`s or compares one.
* The driver calls `environment.cleanup()` on a non-persistent teardown
  (`rlm/core/rlm.py`), so `cleanup` exists here and really tears the session
  down. Without it a session would leak a microVM per run.

**What this backend does about the boundary.** Nothing here is the boundary —
the microVM is (ARCHITECTURE section 2). What this class is responsible for is
not *undoing* the data-flow property that makes the boundary hold: a payload
that references host-resident data crosses as an opaque handle token, the guest
namespace comes back as reprs rather than objects, and the only content this
class can push inward is a caller-supplied literal, charged against the inbound
byte ledger. The byte ledgers here are defense-in-depth on that residual and are
never the boundary (DATA_MODEL section 6).
"""

from __future__ import annotations

import copy
import json
import uuid
from typing import Any

from rlm.core.types import REPLResult, RLMChatCompletion
from rlm.environments.base_env import IsolatedEnv

from repl_sandbox.audit import AuditLog
from repl_sandbox.capabilities import PRE_REGISTERED, CapabilityRegistry
from repl_sandbox.config import SandboxConfig, VMADDR_CID_HOST
from repl_sandbox.errors import (
    CapBytesError,
    DeniedError,
    DepthCeilingError,
    FrameError,
    SandboxError,
    error_from_object,
)
from repl_sandbox.frame import encode_frame, read_frame
from repl_sandbox.launcher import GuestHandle, KataLauncher
from repl_sandbox.session import SessionTable

#: Default wall-clock budget handed to the guest with each `exec`. Advisory on
#: the wire: the enforcing surfaces for runtime are the in-guest cgroups and the
#: host watchdog that reaps a wedged VM (INTERFACES section 2, Runtime
#: ceilings). It is sent so the guest can give up early, not because sending it
#: bounds anything.
DEFAULT_EXEC_DEADLINE_MS = 120_000

#: Hosts an LM-handler address may name. Under bridge Option A the address is
#: the in-guest loopback the forwarder owns; under Option B it is the host CID.
#: Anything else — a routable address, and `0.0.0.0` above all — is refused:
#: SPEC section 3 forbids binding the handler to all interfaces, and a handler
#: address pointing off-host is the shape of an exfiltration destination.
ALLOWED_HANDLER_HOSTS: frozenset[str] = frozenset(
    {"127.0.0.1", "::1", "localhost", str(VMADDR_CID_HOST)}
)

#: Module-private name the delivered scaffold snippets import `json` under. The
#: leading underscore keeps it out of the marshalled `locals` the model reads.
_JSON_ALIAS = "_trellis_json"


def is_handle(value: object) -> bool:
    """True for the guest-side shape of a handle: `{id, kind}`, both strings.

    DATA_MODEL section 1 (What a handle is) fixes the shape at exactly those two
    fields — no shape, no count, no schema, no content — so a dict carrying any
    other key is not a handle and its bytes are literal content.
    """
    return (
        isinstance(value, dict)
        and set(value) == {"id", "kind"}
        and isinstance(value.get("id"), str)
        and isinstance(value.get("kind"), str)
    )


def literal_byte_size(value: object) -> int:
    """UTF-8 bytes of `value` that are literal content rather than a reference.

    A handle contributes nothing: it is an inert token whose referent stays
    host-side. Everything else is counted, so a caller cannot smuggle a corpus
    into the guest by burying it inside a structure that also contains handles.
    """
    if is_handle(value):
        return 0
    if isinstance(value, dict):
        return sum(
            len(str(key).encode("utf-8", "replace")) + literal_byte_size(item)
            for key, item in value.items()
        )
    if isinstance(value, (list, tuple)):
        return sum(literal_byte_size(item) for item in value)
    if isinstance(value, str):
        return len(value.encode("utf-8", "replace"))
    if value is None or isinstance(value, (bool, int, float)):
        return len(repr(value).encode("utf-8"))
    # Anything else is not JSON and will be refused by the encoder; count its
    # repr so the ledger is not silently free for it.
    return len(repr(value).encode("utf-8", "replace"))


class KataREPL(IsolatedEnv):
    """An rlms `IsolatedEnv` whose "separate machine" is a Kata microVM.

    Lifecycle, in the order INTERFACES section 2 fixes it:

    1. `setup()` claims a guest, binds its CID to the session, brings the bridge
       up before any untrusted worker, materialises the granted capabilities as
       in-guest proxy stubs, and only then round-trips the control channel.
    2. `load_context()` binds the reserved `context` name in the guest.
    3. `execute_code()` marshals one model-authored block over the control
       channel and rebuilds a real `rlm` `REPLResult` from the returned dict.

    Recognised `**kwargs`, all optional:

    * `session_id` — the session identity the CID binds to. Generated if absent.
    * `sessions` — a `SessionTable`; the host-side chokepoints authenticate the
      guest against the binding made here.
    * `audit` — an `AuditLog`.
    * `exec_deadline_ms` — the advisory per-block deadline.
    * `lm_handler_address` — passed by the rlms driver when it builds an
      environment; routed through `update_handler_address` so it gets the same
      validation.
    * `context_payload` — passed by the rlms driver; delivered at the end of
      `setup()` rather than in `__init__`, because there is no guest before then.
    """

    def __init__(
        self,
        persistent: bool = False,
        depth: int = 1,
        max_concurrent_subcalls: int = 4,
        *,
        config: SandboxConfig | None = None,
        launcher: Any | None = None,
        capabilities: CapabilityRegistry | None = None,
        **kwargs: Any,
    ) -> None:
        self.config = config or SandboxConfig()

        # Refusals before anything else, because each of these describes a
        # session whose shape this backend cannot honour. Silently accepting
        # them would leave the caller believing in a capability that is absent.
        custom_tools = kwargs.pop("custom_tools", None)
        custom_sub_tools = kwargs.pop("custom_sub_tools", None)
        if custom_tools or custom_sub_tools:
            raise DeniedError(
                "custom_tools inject live host objects into the model's namespace; "
                "they cannot cross into the guest (DATA_MODEL section 5). Register "
                "them as CapabilityDescriptors instead (INTERFACES section 6)."
            )
        if kwargs.pop("subcall_fn", None) is not None:
            raise DeniedError(
                "subcall_fn serves recursive child REPLs; the ratified design is "
                "flat fan-out at max_depth 1 (ARCHITECTURE section 6)."
            )
        if depth > self.config.lm_caps.depth_ceiling:
            # Not the enforcing surface: the LM handler rejects an over-deep
            # `LMRequest` host-side, keyed by CID, and that is what holds
            # (INTERFACES section 4). Refusing here only stops a misconfigured
            # driver from starting a session whose every sub-call would be denied.
            raise DepthCeilingError(
                f"depth {depth} is above the host ceiling "
                f"{self.config.lm_caps.depth_ceiling}; the LM handler would reject "
                "every sub-call this session made"
            )

        self.session_id: str = kwargs.pop("session_id", None) or f"kata-{uuid.uuid4().hex}"
        self.audit: AuditLog = kwargs.pop("audit", None) or AuditLog()
        self.sessions: SessionTable = kwargs.pop("sessions", None) or SessionTable(self.audit)
        self.exec_deadline_ms: int = int(
            kwargs.pop("exec_deadline_ms", None) or DEFAULT_EXEC_DEADLINE_MS
        )

        #: The launcher default is the real one. A caller who forgets to pass a
        #: launcher gets a Kata boot attempt that refuses on a host without KVM
        #: — never the in-process test double, which no default reaches.
        self.launcher = launcher if launcher is not None else KataLauncher(self.config)
        #: The grant table for this session. A registry the trusted driver
        #: supplies decides what the guest may reach; denial is the absence of a
        #: registration, so an empty one is a session with only the two
        #: pre-registered LM capabilities.
        self.capabilities = capabilities if capabilities is not None else CapabilityRegistry()

        self._guest: GuestHandle | None = None
        #: The CID *this* session bound, so teardown releases only its own
        #: binding. A failed bind means the CID belongs to someone else, and
        #: closing it there would evict the session that actually owns it.
        self._bound_cid: int | None = None
        self._control: Any | None = None
        self._live = False
        self._context_count = 0
        self._history_count = 0
        #: Cumulative literal bytes this backend has pushed into the guest.
        #: Defense-in-depth on the residual, never the boundary.
        self._inbound_bytes = 0
        self.lm_handler_address: tuple[str, int] | None = None

        pending_address = kwargs.pop("lm_handler_address", None)
        self._pending_context = kwargs.pop("context_payload", None)

        super().__init__(
            persistent=persistent,
            depth=depth,
            max_concurrent_subcalls=max_concurrent_subcalls,
            **kwargs,
        )

        if pending_address is not None:
            self.update_handler_address(tuple(pending_address))  # type: ignore[arg-type]

    # -- 1. setup ----------------------------------------------------------

    def setup(self) -> None:
        """Claim a guest and wire it, in order, or leave nothing running.

        The order is the contract (INTERFACES section 2): boot, bind CID to
        session, bridge before any untrusted worker, capabilities materialised
        as proxy stubs, and a control round trip last. Any failure raises after
        tearing the session down — a half-wired guest is never left live, because
        a live guest with no session binding is one the host chokepoints cannot
        authenticate and no watchdog is watching.
        """
        if self._live:
            raise SandboxError(f"session {self.session_id} is already set up")

        try:
            # 1. Boot or claim the microVM. The launcher gates the host first.
            guest = self.launcher.boot(self.session_id)
            self._guest = guest

            # 2. Bind CID -> session. The LM handler and the DB broker listen on
            #    their own vsock ports and authenticate the guest by the CID they
            #    read at `accept()` (INTERFACES section 1); this binding is what
            #    they authenticate against, and it is the backend's whole part in
            #    bringing those two channels up.
            self.sessions.bind(guest.cid, self.session_id)
            self._bound_cid = guest.cid

            # 3. The bridge, before any untrusted worker process.
            guest.start_bridge()

            # 4. Materialise the granted capabilities as in-guest proxy stubs.
            #    No credential and no live client enters the guest: the stubs
            #    carry the RPC envelope and a port name, nothing else.
            source = self._materialise_capabilities(guest.cid)
            guest.install_scaffold(source)

            # 5. The control channel, and a round trip over it. Returning before
            #    this would hand the driver a backend whose guest may never have
            #    answered anything.
            self._control = guest.control()
            reply = self._control_request({"op": "ping"})
            if reply.get("stopped"):
                raise SandboxError("the guest supervisor answered but is already stopped")
            self._live = True
        except BaseException:
            self._teardown()
            raise

        self.audit.record(self._cid(), "backend.setup", session=self.session_id)

        if self._pending_context is not None:
            payload, self._pending_context = self._pending_context, None
            self.load_context(payload)

    def _materialise_capabilities(self, cid: int) -> str:
        """Generate this CID's stub source.

        `llm_query` and `llm_query_batched` are pre-registered for every session
        (INTERFACES section 6), so they are added here for any CID that does not
        already carry them. Every other capability is a grant the trusted driver
        made on the registry it supplied; a capability it did not register has
        no stub and therefore no dispatch path, which is what denial *is*.
        """
        granted = {descriptor.name for descriptor in self.capabilities.descriptors(cid)}
        for descriptor in PRE_REGISTERED:
            if descriptor.name not in granted:
                self.capabilities.register(cid, descriptor, "LM_PORT")
        return self.capabilities.materialise(cid)

    # -- 2. load_context ---------------------------------------------------

    def load_context(self, context_payload: dict | list | str) -> None:
        """Expose the reserved REPL variable `context` in the guest.

        Handle-first (DATA_MODEL section 7): where the payload references
        host-resident data it carries the opaque handle token and the guest
        resolves bounded slices through the broker. A small caller-supplied
        literal — the task framing itself — may inline, under the inbound byte
        cap. This method never places secret-bearing payloads in `context`,
        because it never resolves a handle; it has no way to.
        """
        self.add_context(context_payload, 0)

    # -- 3. execute_code ---------------------------------------------------

    def execute_code(self, code: str) -> REPLResult:
        """Run one model-authored block in the guest and rebuild the result.

        Marshalling, not transport: `{op:"exec", code, deadline_ms}` goes out as
        JSON and a dict comes back. The supervisor owns turning the guest
        namespace into reprs; this method's job is not to undo that. Nothing
        here unpickles, evaluates, or otherwise reconstitutes a guest object —
        the frame codec is JSON-only, so a live object or a pickle gadget has no
        representation that could cross.
        """
        if not isinstance(code, str):
            raise DeniedError(f"code must be a string, got {type(code).__name__}")
        self._require_live()
        reply = self._control_request(
            {"op": "exec", "code": code, "deadline_ms": self.exec_deadline_ms}
        )
        return self._rebuild_result(reply.get("result"))

    def _rebuild_result(self, result: object) -> REPLResult:
        """Turn the guest's `exec` payload into a real `rlm` `REPLResult`.

        Fail-closed on shape: a field of the wrong type is a protocol error, not
        something to coerce. The constructor keyword is `rlm_calls`, which is
        what the object carries even though the dataclass annotation says
        `llm_calls` *(source-confirmed)*.
        """
        if not isinstance(result, dict):
            raise FrameError(
                f"exec reply carried {type(result).__name__}, not a result object"
            )
        stdout = self._require_text(result, "stdout")
        stderr = self._require_text(result, "stderr")
        namespace = result.get("locals")
        if not isinstance(namespace, dict):
            raise FrameError(
                f"exec reply carried locals of type {type(namespace).__name__}"
            )

        execution_time = result.get("execution_time")
        if execution_time is not None and not isinstance(execution_time, (int, float)):
            raise FrameError("exec reply carried a non-numeric execution_time")

        final_answer = result.get("final_answer")
        if final_answer is not None:
            if not isinstance(final_answer, str):
                raise FrameError("exec reply carried a non-string final_answer")
            final_answer = self._cap(final_answer, self.config.marshal_caps.answer_bytes)

        return REPLResult(
            stdout=self._cap(stdout, self.config.marshal_caps.stdout_bytes),
            stderr=self._cap(stderr, self.config.marshal_caps.stderr_bytes),
            locals=namespace,
            execution_time=execution_time,
            rlm_calls=self._rebuild_calls(result.get("rlm_calls")),
            final_answer=final_answer,
        )

    @staticmethod
    def _require_text(result: dict, field: str) -> str:
        value = result.get(field, "")
        if not isinstance(value, str):
            raise FrameError(f"exec reply carried {field} of type {type(value).__name__}")
        return value

    @staticmethod
    def _rebuild_calls(raw: object) -> list[RLMChatCompletion]:
        """Rebuild the `rlm_calls` list, or refuse the frame.

        The LM channel is host-side, so this list is normally empty; when the
        handler does attribute calls to a turn, they arrive as dicts and are
        rebuilt through rlms' own `from_dict`.
        """
        if raw is None:
            return []
        if not isinstance(raw, list):
            raise FrameError(f"exec reply carried rlm_calls of type {type(raw).__name__}")
        calls: list[RLMChatCompletion] = []
        for entry in raw:
            if not isinstance(entry, dict):
                raise FrameError("an rlm_calls entry was not an object")
            try:
                calls.append(RLMChatCompletion.from_dict(entry))
            except (AttributeError, KeyError, TypeError) as exc:
                raise FrameError(f"an rlm_calls entry was malformed: {exc}") from exc
        return calls

    def _cap(self, text: str, max_bytes: int) -> str:
        """Truncate to a UTF-8 byte budget.

        Output shaping and DoS control, **not a boundary** (SPEC section 6, the
        "NOT a boundary" row). Whatever reached `stdout` was materialised in the
        guest and charged at its sink long before this line runs.
        """
        raw = text.encode("utf-8", "replace")
        if len(raw) <= max_bytes:
            return text
        marker = f"\n...[truncated {len(raw) - max_bytes} bytes]"
        keep = max(0, max_bytes - len(marker.encode("utf-8")))
        return raw[:keep].decode("utf-8", "ignore") + marker

    # -- SupportsPersistence ----------------------------------------------

    def update_handler_address(self, address: tuple[str, int]) -> None:
        """Point the sub-LLM channel at the LM handler. **Host-side only.**

        This is a backend method the trusted driver calls between completions.
        Guest code has no path to it: it is not a control op, the supervisor's
        op set is `ping / load_context / exec / shutdown`, and an unknown op is
        denied rather than dispatched. That is why a hostile worker cannot aim
        the sub-LLM channel at an attacker host — the destination is never
        something the guest names.

        The address is not delivered into the guest at all. Under bridge Option
        A the guest's rlms client connects to the in-guest loopback the
        forwarder owns; this address is what the *host-side* shim forwards to.
        """
        host, port = self._validated_address(address)
        self.lm_handler_address = (host, port)
        self.audit.record(self._cid(), "backend.handler_address", host=host, port=port)

    @staticmethod
    def _validated_address(address: object) -> tuple[str, int]:
        if not isinstance(address, (tuple, list)) or len(address) != 2:
            raise DeniedError("handler address must be a (host, port) pair")
        host, port = address
        host = str(host)
        if host not in ALLOWED_HANDLER_HOSTS:
            raise DeniedError(
                f"handler host {host!r} is not local; the LM handler is reachable "
                f"only at {sorted(ALLOWED_HANDLER_HOSTS)} (SPEC section 3 — never "
                "bind the handler to all interfaces)"
            )
        if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
            raise DeniedError(f"handler port {port!r} is not a TCP port number")
        return host, port

    def add_context(
        self, context_payload: dict | list | str, context_index: int | None = None
    ) -> int:
        """Add a context payload, exposed in the guest as `context_N`.

        Versioning follows the pinned rlms semantics *(source-confirmed against
        `LocalREPL.add_context`)*: an absent index auto-increments, index 0 also
        binds the unversioned alias, and the count is
        `max(count, index + 1)`.

        Index 0 goes over the `load_context` control op, which pins `context` in
        the supervisor so model code cannot leave a decoy of that name behind
        for the next turn. Higher indices are delivered as a scaffold assignment,
        which is how `LocalREPL` binds them too — the payload travels as JSON
        text and is decoded guest-side, never evaluated as code.
        """
        self._require_live()
        if context_index is None:
            context_index = self._context_count
        index = self._validated_index(context_index, "context_index")

        self._charge_inbound(context_payload)
        if index == 0:
            self._control_request({"op": "load_context", "context": context_payload})
            self._deliver_binding("context_0", "context")
        else:
            self._deliver_payload(f"context_{index}", context_payload)

        self._context_count = max(self._context_count, index + 1)
        return index

    def get_context_count(self) -> int:
        """How many contexts have been added. Read by the driver each turn."""
        return self._context_count

    def add_history(
        self, message_history: list[dict[str, Any]], history_index: int | None = None
    ) -> int:
        """Store a message history in the guest as `history_N`.

        A deep copy is taken before serialisation, as the protocol requires: the
        driver keeps appending to the list it handed over.

        **Known contract gap, stated rather than papered over.** The unversioned
        `history` alias is *not* bound. `history` is one of the eight rlms
        reserved names, and the guest supervisor re-pins the reserved names after
        every execution from a table it takes at construction
        (`GuestSupervisor._restore_scaffold`); it exposes no control op that pins
        `history`, so an alias set here would be removed at the end of the same
        turn that set it. `history_N` is bound and persists. Closing the gap
        needs a supervisor-side op, and it is recorded to the audit log on every
        call so it cannot become a quiet divergence.
        """
        if not isinstance(message_history, list):
            raise DeniedError(
                f"message_history must be a list, got {type(message_history).__name__}"
            )
        self._require_live()
        if history_index is None:
            history_index = self._history_count
        index = self._validated_index(history_index, "history_index")

        payload = copy.deepcopy(message_history)
        self._charge_inbound(payload)
        self._deliver_payload(f"history_{index}", payload)
        if index == 0:
            self.audit.record(
                self._cid(),
                "backend.history_alias_unbound",
                reason="reserved name; supervisor re-pins after every turn",
            )

        self._history_count = max(self._history_count, index + 1)
        return index

    def get_history_count(self) -> int:
        """How many histories have been stored. Read by the driver each turn."""
        return self._history_count

    # -- teardown ----------------------------------------------------------

    def cleanup(self) -> None:
        """Tear the session down. The rlms driver calls this by name.

        `rlm/core/rlm.py` ends a non-persistent run with
        `if hasattr(environment, "cleanup"): environment.cleanup()`
        *(source-confirmed)*. Without this method every run would leave a
        microVM and a CID binding behind.
        """
        self._teardown()

    def _teardown(self) -> None:
        """Close everything this session holds. Idempotent, and never raises.

        Teardown runs from `finally`-shaped paths, so an exception raised here
        would mask the failure that caused it. Every step is attempted and each
        failure is recorded instead.
        """
        cid = self._cid()
        self._live = False

        conn, self._control = self._control, None
        if conn is not None:
            try:
                conn.close()
            except OSError as exc:
                self.audit.record(cid, "backend.teardown_error", step="control", error=str(exc))

        bound_cid, self._bound_cid = self._bound_cid, None
        if bound_cid is not None:
            try:
                self.sessions.close(bound_cid)
            except Exception as exc:  # noqa: BLE001 - teardown must not raise
                self.audit.record(cid, "backend.teardown_error", step="session", error=str(exc))

        guest, self._guest = self._guest, None
        if guest is not None:
            try:
                guest.shutdown()
            except Exception as exc:  # noqa: BLE001 - teardown must not raise
                self.audit.record(cid, "backend.teardown_error", step="guest", error=str(exc))
            self.audit.record(cid, "backend.teardown", session=self.session_id)

    # -- internals ---------------------------------------------------------

    def _cid(self) -> int:
        """The guest CID, or the host CID when there is no guest to key on."""
        guest = self._guest
        return guest.cid if guest is not None else VMADDR_CID_HOST

    def _require_live(self) -> None:
        if not self._live or self._control is None:
            raise SandboxError(
                f"session {self.session_id} is not set up; call setup() first"
            )

    @staticmethod
    def _validated_index(index: object, what: str) -> int:
        if isinstance(index, bool) or not isinstance(index, int) or index < 0:
            raise DeniedError(f"{what} must be a non-negative integer, got {index!r}")
        return index

    def _charge_inbound(self, payload: object) -> None:
        """Charge a payload's literal bytes against the inbound ledgers.

        Handles are free because they carry nothing. The caps are the residual's
        rate bound and are defense-in-depth; the boundary is that the corpus was
        never materialised in the guest in the first place (DATA_MODEL section 6).
        """
        size = literal_byte_size(payload)
        caps = self.config.byte_caps
        if size > caps.inbound_per_call:
            raise CapBytesError(
                f"{size} literal bytes exceeds the per-call inbound cap "
                f"{caps.inbound_per_call}; pass a handle instead of the content"
            )
        if self._inbound_bytes + size > caps.inbound_total:
            raise CapBytesError(
                f"{size} literal bytes would exceed the session inbound cap "
                f"{caps.inbound_total} (charged so far: {self._inbound_bytes})"
            )
        self._inbound_bytes += size
        self.audit.record(self._cid(), "backend.inbound", bytes=size, total=self._inbound_bytes)

    def _deliver_payload(self, name: str, payload: object) -> None:
        """Bind one JSON payload to a guest name.

        The payload crosses as a JSON *string literal* inside the scaffold
        snippet and is decoded by `json.loads` guest-side, so no part of it is
        ever parsed as code.
        """
        try:
            encoded = json.dumps(payload, allow_nan=False)
        except (TypeError, ValueError) as exc:
            raise FrameError(f"context payload is not JSON-serialisable: {exc}") from exc
        self._deliver_scaffold(
            f"import json as {_JSON_ALIAS}\n{name} = {_JSON_ALIAS}.loads({encoded!r})\n"
        )

    def _deliver_binding(self, name: str, source_name: str) -> None:
        """Bind one guest name to another, e.g. `context_0 = context`."""
        self._deliver_scaffold(f"{name} = {source_name}\n")

    def _deliver_scaffold(self, code: str) -> None:
        """Execute host-authored scaffold code in the guest, and verify it took.

        The `exec` op reports success for a block that raised — a traceback goes
        to `stderr` and feeds the model's self-debug loop, which is right for
        model-authored code and wrong for ours. So a non-empty `stderr` from a
        scaffold delivery is treated as a failure of the delivery rather than as
        output.
        """
        reply = self._control_request(
            {"op": "exec", "code": code, "deadline_ms": self.exec_deadline_ms}
        )
        result = reply.get("result")
        stderr = result.get("stderr") if isinstance(result, dict) else None
        if stderr:
            raise SandboxError(f"the guest failed to bind a host-supplied value: {stderr}")

    def _control_request(self, payload: dict) -> dict:
        """One framed request/response over the control channel, fail-closed.

        An error the guest returns is raised as the taxonomy class its `code`
        names (INTERFACES section 7). Connection-terminal and session-terminal
        errors tear the session down before raising, because after either one
        there is nothing left to talk to.
        """
        conn = self._control
        if conn is None:
            raise SandboxError("the control channel is not open; call setup() first")

        try:
            conn.sendall(encode_frame(payload, self.config.max_frame_len))
            reply = read_frame(conn.recv, self.config.max_frame_len)
        except FrameError:
            self._teardown()
            raise
        except OSError as exc:
            self._teardown()
            raise SandboxError(
                f"the control channel failed: {type(exc).__name__}: {exc}"
            ) from exc

        if reply is None:
            self._teardown()
            raise FrameError("the guest closed the control channel without answering")
        if reply.get("ok") is not True:
            error_object = reply.get("error")
            error = error_from_object(error_object if isinstance(error_object, dict) else {})
            if error.connection_terminal or error.session_terminal:
                self._teardown()
            raise error
        return reply
