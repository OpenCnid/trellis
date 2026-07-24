"""The in-guest supervisor: the control-port server that runs model code.

Source of truth: docs/product/repl-sandbox/REPL_SANDBOX_INTERFACES.md section 2
(Backend contract — the `CONTROL_PORT` ops), section 1 (Seam map, seam 2), and
REPL_SANDBOX_DATA_MODEL.md section 8 (`execute_code` result marshaling).

**This process is untrusted, by design.** It executes model-authored Python in
its own namespace with no language-level sandboxing whatsoever — no restricted
builtins, no AST screening, no import hook. That is deliberate, not an omission:
in-language sandboxing of CPython is not a boundary, and pretending otherwise
would put a control in a column that cannot hold it. What contains this process
is the Kata microVM it runs inside (ARCHITECTURE section 2 — Trust model). If
model code kills the forwarder, rewrites this module, or speaks vsock itself,
nothing is bypassed: the host still authenticates by CID and enforces every cap
(INTERFACES section 3.3).

What the supervisor *does* hold, and is tested for:

* **Control-port auth.** Only `VMADDR_CID_HOST` (2) may issue an op. The CID
  comes from the listener's `accept()`, never from the request body.
* **Namespace persistence.** One namespace across turns, so a variable set in
  turn 1 is live in turn 5 — the property BUILD_PLAN section 5.2 (S2) exists to
  prove.
* **Reserved-name re-pinning.** The eight rlms reserved names are restored after
  every execution, so model code cannot shadow the scaffold for a later turn.
  The names arrive as a constructor argument rather than an import: this module
  runs in a guest that has no rlms, and `from rlm.environments.base_env import
  RESERVED_TOOL_NAMES` made it unimportable there. The host reads the genuine
  value from the pinned package and passes it in (BUILD_PLAN section 5.6,
  option B). What that preserves is *which side holds the authority* — the pin
  stays where rlms actually lives, and INTERFACES section 8's conformance test
  still fails first if the set moves. A hand-written `rlm` module in the guest
  asserting eight strings on its own authority would be the shim S4 `[A]`
  refused, because it fakes the pin rather than transmitting it.
* **Repr-only marshaling.** `locals` crosses the seam as value reprs. A live
  socket, client, or credential-bearing object cannot ride back across, because
  the outgoing struct is built out of strings rather than filtered.

The marshaling caps here are output shaping and DoS control, **not a boundary**
(SPEC section 6 — the "NOT a boundary" row). Content that reached `stdout` was
already materialised in the guest and charged at its sink; capping the print is
politeness to the transcript, not containment. The boundary is upstream of all
of it: the guest holds handles, so an un-materialised secret is not in `locals`
because it was never in the guest.
"""

from __future__ import annotations

import io
import time
import traceback
import uuid
from contextlib import redirect_stderr, redirect_stdout
from typing import Any, Callable

from repl_sandbox.capabilities import TRANSPORT_HOOK
from repl_sandbox.config import MarshalCaps, SandboxConfig
from repl_sandbox.errors import DeniedError
from repl_sandbox.transport import require_host_cid

#: Per-value ceiling on a marshalled `locals` entry, in bytes.
#:
#: The config carries caps for `stdout`, `stderr`, and `answer` (DATA_MODEL
#: section 8) but none for an individual local, so this is a supervisor-local
#: default rather than a ratified number. Like the others it is output shaping,
#: not a boundary.
DEFAULT_VALUE_REPR_BYTES = 4 * 1024

#: Ceiling on all marshalled `locals` entries together, in bytes. Without it a
#: namespace of many large values produces a frame the transport must reject,
#: which would turn a chatty turn into a dropped connection.
DEFAULT_LOCALS_TOTAL_BYTES = 256 * 1024

_TRUNCATION_MARKER = "\n...[truncated]"


def _cap_text(text: str, max_bytes: int) -> str:
    """Truncate `text` so its UTF-8 encoding fits `max_bytes`.

    Output shaping only. The truncation is announced in-band because the model
    reads this and should know the tail is missing.
    """
    raw = text.encode("utf-8", errors="replace")
    if len(raw) <= max_bytes:
        return text
    marker = _TRUNCATION_MARKER.encode("utf-8")
    if max_bytes <= len(marker):
        return raw[:max_bytes].decode("utf-8", errors="ignore")
    keep = max_bytes - len(marker)
    return raw[:keep].decode("utf-8", errors="ignore") + _TRUNCATION_MARKER


def marshal_value(value: object, max_bytes: int, spill_handle: str | None = None) -> dict:
    """Render one namespace value as a JSON-safe description.

    The rule is load-bearing (INTERFACES section 2 — Marshalling rule): the seam
    speaks reprs, so no live object crosses it. It is a construction, not a
    filter — there is no code path here that could hand back the object itself.

    A hostile `__repr__` is assumed. It may raise, recurse, or return megabytes;
    it may also return a non-string. Every one of those lands as a bounded
    string. What cannot be bounded is the *cost* of calling it inside the guest,
    which is the guest's own resource problem and is contained by the in-guest
    cgroups and the host watchdog (ARCHITECTURE section 4).
    """
    kind = type(value).__name__
    try:
        text = repr(value)
        if not isinstance(text, str):
            raise TypeError(f"__repr__ returned {type(text).__name__}, not str")
    except Exception as exc:  # noqa: BLE001 - untrusted __repr__ may raise anything
        text = f"<unrepresentable {kind}: {type(exc).__name__}>"
        text = text[:max_bytes] if max_bytes else ""
        return {"kind": kind, "value_repr": text, "truncated": True, "unrepresentable": True}

    raw = text.encode("utf-8", errors="replace")
    if len(raw) <= max_bytes:
        return {"kind": kind, "value_repr": text, "truncated": False}

    entry: dict[str, Any] = {
        "kind": kind,
        "value_repr": raw[:max_bytes].decode("utf-8", errors="ignore"),
        "truncated": True,
    }
    if spill_handle is not None:
        # DATA_MODEL section 8: an oversized value returns a handle the model
        # re-slices, never the payload.
        entry["spill_handle"] = spill_handle
    return entry


class GuestSupervisor:
    """Serves the `CONTROL_PORT` ops against one persistent guest namespace.

    Wire it to the transport by passing `handle_request` as the serve loop's
    handler; the loop supplies the peer CID it read at `accept()`.

    `stub_source` is Python source generated host-side that defines the in-guest
    RPC proxy stubs (INTERFACES section 2, `setup()` step 4). It is executed into
    the namespace at construction — before any model-authored code can run — so
    the scaffold exists first and the reserved-name pins are taken from it. The
    stubs carry no credential and no live client; they speak to the host over
    the broker and LM channels, which is where the caps live.

    `rpc_hook` is what those stubs call: it is bound under
    `capabilities.TRANSPORT_HOOK` before `stub_source` executes, because a stub
    body names it and a namespace without it raises `NameError` on the first
    call. `repl_sandbox.guest_rpc.GuestRpc` is the implementation; it is optional
    so a supervisor can be built with no ports at all, and it is convenience
    rather than containment — model code that speaks the wire itself bypasses it
    and is refused by the same host caps regardless.
    """

    def __init__(
        self,
        config: SandboxConfig,
        stub_source: str = "",
        marshal_caps: MarshalCaps | None = None,
        rpc_hook: Callable[[str, dict], dict] | None = None,
        *,
        reserved_names: frozenset[str],
    ) -> None:
        #: The rlms reserved namespace names, supplied by the host from the
        #: pinned package. Required and keyword-only, with no default: a default
        #: would be this module asserting the set on its own authority, which is
        #: the one property option B exists to avoid. A guest constructed without
        #: it fails at construction rather than re-pinning against a guess.
        if not isinstance(reserved_names, frozenset):
            raise DeniedError(
                "reserved_names must be a frozenset supplied by the host from the "
                f"pinned rlms package, got {type(reserved_names).__name__}"
            )
        self._reserved_names = reserved_names
        self.config = config
        self.marshal_caps = marshal_caps or config.marshal_caps
        self.value_repr_bytes = DEFAULT_VALUE_REPR_BYTES
        self.locals_total_bytes = DEFAULT_LOCALS_TOTAL_BYTES

        #: Set once a `shutdown` op has been answered. The host closes the
        #: connection and tears the microVM down; this flag is bookkeeping, not
        #: an enforcement — a supervisor that ignored it would still be inside
        #: the VM the host is about to destroy.
        self.stopped = False

        #: Guest-local spill tokens minted for oversized locals, mapped to the
        #: namespace name still holding the value. Resolving host-resident
        #: content is the broker's job and never happens here.
        self.spills: dict[str, str] = {}

        self._ns: dict[str, Any] = {}
        self._context_count = 0
        self._history_count = 0
        self._last_deadline_ms: int | None = None

        if rpc_hook is not None:
            self._ns[TRANSPORT_HOOK] = rpc_hook

        if stub_source:
            exec(stub_source, self._ns, self._ns)  # noqa: S102 - host-generated scaffold

        #: Names the scaffold owns. Excluded from marshalled `locals` so the
        #: host sees the model's variables, not its own stubs echoed back.
        self._scaffold_names = set(self._ns)

        #: Reserved-name values restored after every turn.
        self._pins: dict[str, Any] = {
            name: self._ns[name] for name in self._reserved_names if name in self._ns
        }
        self._restore_scaffold()

    # -- namespace ---------------------------------------------------------

    def namespace(self) -> dict:
        """The live guest-side namespace.

        Returned for in-guest use and for tests. It never crosses the seam: the
        host receives the marshalled `locals` of an `exec` result, which is a
        dict of strings.
        """
        return self._ns

    def _restore_scaffold(self) -> None:
        """Re-pin the reserved names after an execution.

        A reserved name the scaffold defined is restored to the scaffold's
        object; one it never defined is *removed*, so model code cannot leave a
        decoy named `llm_query` lying in the namespace for the next turn. This
        mirrors `LocalREPL._restore_scaffold` in the pinned rlms.

        `answer` is rebound to a fresh empty dict each turn after its content is
        captured, so a turn's answer cannot leak into the next one.
        """
        for name in self._reserved_names:
            if name == "answer":
                self._ns["answer"] = {}
            elif name in self._pins:
                self._ns[name] = self._pins[name]
            else:
                self._ns.pop(name, None)

    # -- control ops -------------------------------------------------------

    def handle_request(self, peer_cid: int, request: dict) -> dict:
        """Dispatch one control-port op.

        The first act is the auth check, because on this port there is exactly
        one legitimate peer. A foreign CID raises `AuthError`, which the serve
        loop audits by attempted CID and answers by dropping the connection —
        the peer gets no reply telling it what it got wrong.

        An unrecognised or malformed op is denied rather than guessed at
        (INTERFACES section 7 — fail-closed).
        """
        require_host_cid(peer_cid)

        op = request.get("op")
        if op == "ping":
            return {"op": "ping", "ok": True, "stopped": self.stopped}
        if op == "load_context":
            return self._op_load_context(request)
        if op == "exec":
            return self._op_exec(request)
        if op == "shutdown":
            self.stopped = True
            return {"op": "shutdown", "ok": True}
        raise DeniedError(f"unknown control op {op!r}")

    def _op_load_context(self, request: dict) -> dict:
        """Bind the reserved `context` name.

        The payload is whatever the host chose to send. Where the data model
        marks a field as a handle, what arrives is the opaque token and not the
        resolved bytes — that decision is made host-side by the backend
        (DATA_MODEL section 7), so there is nothing to enforce here and this
        method claims no enforcement.
        """
        if "context" not in request:
            raise DeniedError("load_context requires a 'context' field")
        payload = request["context"]
        self._pins["context"] = payload
        self._ns["context"] = payload
        self._context_count = len(payload) if isinstance(payload, (list, dict)) else 1
        return {"op": "load_context", "ok": True, "context_count": self._context_count}

    def _op_exec(self, request: dict) -> dict:
        """Run one model-authored block in the persistent namespace.

        `deadline_ms` is recorded and **not enforced here**: an in-process
        `exec` of untrusted Python cannot be reliably interrupted, and a timer
        that cannot stop the code would be a bound with no engine behind it. The
        enforcing surfaces for runtime are the in-guest cgroups and the host
        watchdog that reaps a wedged VM (INTERFACES section 2 — Runtime
        ceilings).
        """
        code = request.get("code")
        if not isinstance(code, str):
            raise DeniedError("exec requires a string 'code' field")
        deadline_ms = request.get("deadline_ms")
        self._last_deadline_ms = deadline_ms if isinstance(deadline_ms, int) else None

        return {"op": "exec", "ok": True, "result": self.execute(code)}

    # -- execution ---------------------------------------------------------

    def execute(self, code: str) -> dict:
        """Execute `code` and return a `REPLResult`-shaped dict.

        Fields are the pinned rlms ones: `stdout, stderr, locals,
        execution_time, rlm_calls, final_answer` (INTERFACES section 2).

        An exception from the block is *not* an error of this op: the traceback
        goes to `stderr` and feeds the model's self-debug loop, exactly as
        `LocalREPL` does. The op fails only when the request itself was
        malformed.
        """
        stdout_buf, stderr_buf = io.StringIO(), io.StringIO()
        started = time.perf_counter()
        with redirect_stdout(stdout_buf), redirect_stderr(stderr_buf):
            try:
                exec(code, self._ns, self._ns)  # noqa: S102 - untrusted by design; the microVM contains it
            except BaseException:  # noqa: BLE001 - model code may raise anything, including SystemExit
                traceback.print_exc(file=stderr_buf)
        execution_time = time.perf_counter() - started

        final_answer = self._capture_answer()
        self._restore_scaffold()

        caps = self.marshal_caps
        return {
            "stdout": _cap_text(stdout_buf.getvalue(), caps.stdout_bytes),
            "stderr": _cap_text(stderr_buf.getvalue(), caps.stderr_bytes),
            "locals": self._marshal_locals(),
            "execution_time": execution_time,
            # The LM channel is host-side; calls made during this block are
            # accounted there, keyed by CID. The supervisor does not see them.
            "rlm_calls": [],
            "final_answer": final_answer,
        }

    def _capture_answer(self) -> str | None:
        """Read the `answer` channel, if the block filled it.

        rlms signals a final answer by setting `answer["ready"]`; the content is
        capped like any other crossing. This is the audited egress point of
        DATA_MODEL section 8 on the guest side — the audit itself is host-side.
        """
        answer = self._ns.get("answer")
        if not isinstance(answer, dict) or not answer.get("ready"):
            return None
        return _cap_text(str(answer.get("content", "")), self.marshal_caps.answer_bytes)

    def _marshal_locals(self) -> dict:
        """Describe the model's namespace as reprs under a total budget.

        Reserved names, scaffold names, and dunder/private names are skipped:
        they are the host's own furniture and echoing them back is noise. Names
        are marshalled in insertion order, and once the total budget is spent
        the remainder still appear — as spill handles with an empty repr — so a
        variable is never silently absent from the transcript.
        """
        out: dict[str, dict] = {}
        remaining = self.locals_total_bytes
        for name, value in list(self._ns.items()):
            if (
                name.startswith("_")
                or name in self._reserved_names
                or name in self._scaffold_names
            ):
                continue
            budget = min(self.value_repr_bytes, max(0, remaining))
            handle = f"spill:{uuid.uuid4().hex}"
            entry = marshal_value(value, budget, spill_handle=handle)
            if entry.get("spill_handle") == handle:
                self.spills[handle] = name
            out[name] = entry
            remaining -= len(entry.get("value_repr", "").encode("utf-8", errors="replace"))
        return out
