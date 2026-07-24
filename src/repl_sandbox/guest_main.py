"""The guest entry point: what a booted microVM actually runs.

Source of truth: docs/product/repl-sandbox/REPL_SANDBOX_INTERFACES.md section 2
(Backend contract — the `CONTROL_PORT` ops) and section 3.1a (the hybrid-vsock
correction), with the startup order of REPL_SANDBOX_BUILD_PLAN.md section 5.6.

**This is the process the boundary contains.** Everything here runs inside the
Kata microVM, executes model-authored Python, and is untrusted by design. It
holds no credential: the RPC stubs it binds carry a port name and an envelope,
and every credential lives behind the host end of the port they dial.

Until this module existed the package had no guest entry point at all — the only
`GuestSupervisor` construction in the tree was `launcher.InProcessGuest`, a
host-side double that provides no isolation. A double cannot be deployed and was
never meant to be, so the gap was not a missing feature but a missing half of
the seam.

**The listener is native `AF_VSOCK`, and that is load-bearing rather than
incidental.** Cloud Hypervisor's hybrid vsock moved the *host* side to an
`AF_UNIX` socket at `<uds>_<port>` (INTERFACES section 3.1a); the guest side is
unchanged and still binds `AF_VSOCK` on `VMADDR_CID_ANY`. So the guest keeps
what the host lost: a peer CID the kernel supplies at `accept()`. Using
`HybridVsockListener` here would hand `require_host_cid` a number this process
chose itself, which is precisely the property that check exists to hold.
`transport.VsockListener`'s docstring says it is "used host-side on `LM_PORT`
and `DB_PORT`" — that describes its only caller before this module, not what the
class does.

**Why the scaffold and the reserved names arrive on disk rather than on a
frame.** Both are `GuestSupervisor.__init__` arguments. The supervisor takes its
reserved-name pins and freezes `_scaffold_names` before `__init__` returns, and
every control op — `ping`, `load_context`, `exec`, `shutdown` — dispatches
against a supervisor that already exists. A value delivered on the first op
would arrive after the thing it configures was built. The launcher therefore
places them, and this module reads them, before it binds anything.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from typing import Any, Callable

from repl_sandbox.capabilities import PORT_NAMES
from repl_sandbox.config import VMADDR_CID_HOST, SandboxConfig
from repl_sandbox.errors import SandboxError
from repl_sandbox.guest_rpc import GuestRpc
from repl_sandbox.supervisor import GuestSupervisor
from repl_sandbox.transport import VsockClient, VsockListener, serve_forever

#: Default location the launcher writes the startup payload to. A path rather
#: than a frame because of the ordering above; a constant rather than an
#: argument default so the launcher and this module cannot drift apart silently.
DEFAULT_PAYLOAD_PATH = "/run/trellis/guest_payload.json"


class PayloadError(SandboxError):
    """The startup payload is absent, unreadable, or not what it claims to be.

    Its own error class because it is the one failure that happens before any
    channel exists to report a failure on: the host learns about it from the
    process exiting, not from a frame.
    """


@dataclass(frozen=True)
class GuestPayload:
    """Everything the launcher must place before this process can construct.

    Frozen because each field is read exactly once during startup and a later
    mutation could only mean something re-configured a running supervisor.
    """

    stub_source: str
    reserved_names: frozenset[str]
    control_port: int
    max_frame_len: int
    #: Symbolic port names this guest was granted a client for. Absent means
    #: none — a session with no capabilities is a legitimate shape, not an error.
    granted_ports: tuple[str, ...] = ()
    harden: bool = True
    extra: dict[str, Any] = field(default_factory=dict)


def parse_payload(raw: object) -> GuestPayload:
    """Validate the launcher's payload into the arguments construction needs.

    Every field is checked here rather than at its use site, because a malformed
    payload should fail before a listener is bound and before any model-authored
    code could run. The guest is untrusted, but this payload is not model
    output — it comes from the host, and a fault in it is a launcher bug the
    guest should name loudly rather than absorb.
    """
    if not isinstance(raw, dict):
        raise PayloadError(f"payload must be a JSON object, got {type(raw).__name__}")

    stub_source = raw.get("stub_source", "")
    if not isinstance(stub_source, str):
        raise PayloadError(f"stub_source must be a string, got {type(stub_source).__name__}")

    names = raw.get("reserved_names")
    if not isinstance(names, list) or not all(isinstance(n, str) for n in names):
        raise PayloadError("reserved_names must be a list of strings supplied by the host")
    if not names:
        # An empty set would leave every reserved name unpinned and let model
        # code shadow the scaffold for the next turn. The host always has the
        # real value, so empty means the payload was built wrong.
        raise PayloadError("reserved_names is empty; the host reads it from the pinned rlms package")

    control_port = raw.get("control_port")
    if not isinstance(control_port, int) or isinstance(control_port, bool) or control_port <= 0:
        raise PayloadError(f"control_port must be a positive int, got {control_port!r}")

    max_frame_len = raw.get("max_frame_len")
    if not isinstance(max_frame_len, int) or isinstance(max_frame_len, bool) or max_frame_len <= 0:
        raise PayloadError(f"max_frame_len must be a positive int, got {max_frame_len!r}")

    granted = raw.get("granted_ports", [])
    if not isinstance(granted, list) or not all(isinstance(p, str) for p in granted):
        raise PayloadError("granted_ports must be a list of symbolic port names")
    unknown = [p for p in granted if p not in PORT_NAMES]
    if unknown:
        raise PayloadError(f"granted_ports names no such port: {unknown!r}; known: {list(PORT_NAMES)}")

    harden = raw.get("harden", True)
    if not isinstance(harden, bool):
        raise PayloadError(f"harden must be a boolean, got {type(harden).__name__}")

    return GuestPayload(
        stub_source=stub_source,
        reserved_names=frozenset(names),
        control_port=control_port,
        max_frame_len=max_frame_len,
        granted_ports=tuple(granted),
        harden=harden,
    )


def load_payload(path: str) -> GuestPayload:
    """Read and validate the startup payload from disk.

    Read before hardening, deliberately: Tier-0's Landlock ruleset grants a
    read-only set of roots, and a payload outside them becomes unreachable the
    moment the ruleset is enforced. S5 paid for the general form of this — a
    worker that hardened correctly and could not read `/proc` to prove it.
    """
    try:
        with open(path, "r", encoding="utf-8") as handle:
            raw = json.load(handle)
    except FileNotFoundError as exc:
        raise PayloadError(
            f"no startup payload at {path!r}; the launcher places it before starting this process"
        ) from exc
    except OSError as exc:
        raise PayloadError(f"cannot read the startup payload at {path!r}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise PayloadError(f"the startup payload at {path!r} is not valid JSON: {exc}") from exc
    return parse_payload(raw)


def build_rpc_hook(
    payload: GuestPayload,
    config: SandboxConfig,
    client_factory: Callable[[int, int], Any] | None = None,
) -> GuestRpc | None:
    """Build the `_trellis_rpc` the materialised stubs call.

    Returns `None` when no port was granted, which is a session holding only
    whatever the scaffold defines — the supervisor binds no hook in that case and
    a stub that named one would raise `NameError` on its first use, which is the
    correct outcome for a capability nobody granted.

    Never containment: model code that speaks the wire itself bypasses this
    entirely and meets the same host-side CID auth and caps.
    """
    if not payload.granted_ports:
        return None
    make = client_factory if client_factory is not None else _default_client
    numbers = {"LM_PORT": config.ports.lm, "DB_PORT": config.ports.db}
    clients = {name: make(VMADDR_CID_HOST, numbers[name]) for name in payload.granted_ports}
    return GuestRpc(clients, payload.max_frame_len)


def _default_client(cid: int, port: int) -> VsockClient:
    return VsockClient(cid, port)


def run(
    payload: GuestPayload,
    config: SandboxConfig | None = None,
    *,
    listener_factory: Callable[[int], Any] | None = None,
    client_factory: Callable[[int, int], Any] | None = None,
    harden_fn: Callable[[], Any] | None = None,
    stop: Any | None = None,
    on_ready: Callable[[Any], None] | None = None,
) -> None:
    """Construct the guest and serve the control port until the VM goes away.

    The order below is the contract, and each step is where it is because a
    later position breaks something specific:

    1. the RPC hook, because the supervisor binds it *before* executing the
       scaffold and a stub body names it literally;
    2. the listener, because the host's `CONNECT <port>` handshake is refused
       rather than queued when nothing is listening — and binding while still
       privileged removes a question the privilege drop would otherwise raise;
    3. the supervisor, because its reserved-name pins and its record of which
       names the scaffold owns are both taken at construction;
    4. Tier-0, because it is irreversible and must precede the first
       model-authored `exec`;
    5. the serve loop, which is the only step that blocks.

    The factories exist so the wiring is exercisable on a machine with no
    `AF_VSOCK` at all. They are a test seam and never a deployment one: the
    defaults are the real transports, so a caller that passes nothing gets the
    real thing rather than a double.
    """
    config = config or SandboxConfig()

    rpc_hook = build_rpc_hook(payload, config, client_factory)

    make_listener = listener_factory if listener_factory is not None else _default_listener
    listener = make_listener(payload.control_port)

    try:
        supervisor = GuestSupervisor(
            config,
            stub_source=payload.stub_source,
            rpc_hook=rpc_hook,
            reserved_names=payload.reserved_names,
        )

        if payload.harden:
            hardener = harden_fn if harden_fn is not None else _default_harden
            report = hardener()
            # A failed step is reported, never raised: the host is the party that
            # decides whether a partially hardened guest may carry a session, and
            # it cannot decide what it is not told. Refusing here would instead
            # leave the host with a VM that booted and never answered.
            _announce({"event": "tier0", "ok": bool(getattr(report, "ok", False)),
                       "failures": list(getattr(report, "failures", ()))})

        if on_ready is not None:
            on_ready(supervisor)

        _announce({"event": "ready", "control_port": payload.control_port})
        serve_forever(listener, supervisor.handle_request, payload.max_frame_len, None, stop)
    finally:
        try:
            listener.close()
        except Exception:  # noqa: BLE001 - teardown must not mask the real failure
            pass


def _default_listener(port: int) -> VsockListener:
    """Native `AF_VSOCK` on `VMADDR_CID_ANY` — see this module's header."""
    return VsockListener(port)


def _default_harden() -> Any:
    # Imported here rather than at module scope so this module stays importable
    # for its tests on a platform whose syscall table `hardening` does not carry.
    from repl_sandbox.hardening import apply_tier0

    return apply_tier0()


def _announce(event: dict) -> None:
    """One JSON line on stdout, which is the only channel that exists yet.

    The host reads this while waiting for readiness. It is diagnostics, not a
    control channel: nothing here is authenticated and nothing acts on it.
    """
    sys.stdout.write(json.dumps(event, sort_keys=True) + "\n")
    sys.stdout.flush()


def main(argv: list[str] | None = None) -> int:
    """Entry point. Exit codes are the host's diagnosis, so they are distinct.

    `0` is a serve loop that ended normally, `2` a payload that never let the
    process start, and `1` anything that failed after construction. A single
    non-zero code would leave the host unable to tell "the launcher placed the
    wrong bytes" from "the guest died mid-session", which are different repairs.
    """
    parser = argparse.ArgumentParser(description="Trellis guest supervisor entry point")
    parser.add_argument("--payload", default=os.environ.get("TRELLIS_GUEST_PAYLOAD", DEFAULT_PAYLOAD_PATH))
    args = parser.parse_args(argv)

    try:
        payload = load_payload(args.payload)
    except PayloadError as exc:
        _announce({"event": "payload_error", "error": str(exc)})
        return 2

    try:
        run(payload)
    except Exception as exc:  # noqa: BLE001 - the host reads the exit code and this line
        _announce({"event": "error", "error": f"{type(exc).__name__}: {exc}"})
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
