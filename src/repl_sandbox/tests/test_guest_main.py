"""The guest entry point, exercised on a machine with no `AF_VSOCK`.

What these can reach: payload validation, the construction order, which listener
class the default reaches for, and the wiring between the supervisor and the
serve loop. What they cannot reach is whether a real `AF_VSOCK` bind survives the
Tier-0 privilege drop, which is the S6 host run's business and is recorded as a
scope limit rather than implied by a green suite here.
"""

from __future__ import annotations

import json
import pathlib
import subprocess
import sys
import textwrap

import pytest

from repl_sandbox import guest_main
from repl_sandbox.capabilities import PORT_NAMES
from repl_sandbox.config import VMADDR_CID_HOST, SandboxConfig
from repl_sandbox.guest_rpc import GuestRpc

RESERVED = [
    "SHOW_VARS",
    "answer",
    "context",
    "history",
    "llm_query",
    "llm_query_batched",
    "rlm_query",
    "rlm_query_batched",
]


def payload_dict(**overrides: object) -> dict:
    base = {
        "stub_source": "",
        "reserved_names": list(RESERVED),
        "control_port": 5003,
        "max_frame_len": 1 << 20,
        "granted_ports": [],
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# Payload validation — every refusal happens before a listener is bound
# ---------------------------------------------------------------------------


def test_a_well_formed_payload_parses() -> None:
    parsed = guest_main.parse_payload(payload_dict(granted_ports=["LM_PORT"]))
    assert parsed.reserved_names == frozenset(RESERVED)
    assert parsed.control_port == 5003
    assert parsed.granted_ports == ("LM_PORT",)
    assert parsed.harden is True


@pytest.mark.parametrize(
    "bad",
    [
        {"reserved_names": []},
        {"reserved_names": "answer"},
        {"reserved_names": [1, 2]},
        {"control_port": 0},
        {"control_port": "5003"},
        {"control_port": True},
        {"max_frame_len": -1},
        {"max_frame_len": True},
        {"stub_source": 5},
        {"granted_ports": ["NOPE_PORT"]},
        {"granted_ports": "LM_PORT"},
        {"harden": "yes"},
    ],
)
def test_a_malformed_payload_is_refused(bad: dict) -> None:
    with pytest.raises(guest_main.PayloadError):
        guest_main.parse_payload(payload_dict(**bad))


def test_a_payload_that_is_not_an_object_is_refused() -> None:
    with pytest.raises(guest_main.PayloadError):
        guest_main.parse_payload([1, 2, 3])


def test_an_empty_reserved_set_is_refused_rather_than_accepted_as_none() -> None:
    """Empty would leave every reserved name unpinned.

    Model code could then shadow the scaffold for the next turn, which is the
    property `_restore_scaffold` exists to hold. The host always has the real
    value, so empty means the payload was built wrong -- and an empty frozenset
    is truthy enough to slip past a laxer check.
    """
    with pytest.raises(guest_main.PayloadError, match="empty"):
        guest_main.parse_payload(payload_dict(reserved_names=[]))


def test_a_missing_payload_file_names_the_launcher(tmp_path: pathlib.Path) -> None:
    missing = str(tmp_path / "nope.json")
    with pytest.raises(guest_main.PayloadError, match="launcher"):
        guest_main.load_payload(missing)


def test_a_payload_file_round_trips(tmp_path: pathlib.Path) -> None:
    path = tmp_path / "payload.json"
    path.write_text(json.dumps(payload_dict()), encoding="utf-8")
    assert guest_main.load_payload(str(path)).control_port == 5003


def test_a_payload_file_that_is_not_json_is_refused(tmp_path: pathlib.Path) -> None:
    path = tmp_path / "payload.json"
    path.write_text("{not json", encoding="utf-8")
    with pytest.raises(guest_main.PayloadError, match="JSON"):
        guest_main.load_payload(str(path))


# ---------------------------------------------------------------------------
# The RPC hook
# ---------------------------------------------------------------------------


def test_no_granted_port_means_no_hook() -> None:
    """A session with no capabilities is a legitimate shape, not an error."""
    parsed = guest_main.parse_payload(payload_dict(granted_ports=[]))
    assert guest_main.build_rpc_hook(parsed, SandboxConfig()) is None


def test_a_client_is_built_per_granted_port_and_dials_the_host_cid() -> None:
    dialed: list[tuple[int, int]] = []

    def factory(cid: int, port: int) -> object:
        dialed.append((cid, port))
        return object()

    config = SandboxConfig()
    parsed = guest_main.parse_payload(payload_dict(granted_ports=list(PORT_NAMES)))
    hook = guest_main.build_rpc_hook(parsed, config, client_factory=factory)

    assert isinstance(hook, GuestRpc)
    assert hook.ports() == tuple(sorted(PORT_NAMES))
    assert sorted(dialed) == sorted(
        [(VMADDR_CID_HOST, config.ports.lm), (VMADDR_CID_HOST, config.ports.db)]
    )


# ---------------------------------------------------------------------------
# Construction order
# ---------------------------------------------------------------------------


class RecordingListener:
    def __init__(self, log: list[str]) -> None:
        self._log = log
        self.closed = False

    def accept(self):  # pragma: no cover - the stop event ends the loop first
        raise AssertionError("the serve loop should not accept in these tests")

    def close(self) -> None:
        self.closed = True
        self._log.append("listener.close")


class StopImmediately:
    """A `stop` whose first check is already set, so `serve_forever` returns."""

    def is_set(self) -> bool:
        return True


#: Module-level so the scaffold source can reach it. The scaffold is `exec`'d
#: into a fresh namespace during `GuestSupervisor.__init__`, which makes it the
#: honest observation point for "the supervisor was constructed" -- rather than
#: a callback, which only reports when the callback was placed.
ORDER: list[str] = []

#: Resolved through `sys.modules` under this module's *own* import name rather
#: than by a fresh `import`, which would bind a second module object with its own
#: `ORDER` and record into a list nothing reads.
SCAFFOLD_RECORDS = (
    "import sys\n"
    f"sys.modules[{__name__!r}].ORDER.append('scaffold.exec')\n"
)


def run_recording(**payload_overrides: object) -> list[str]:
    ORDER.clear()

    def listener_factory(port: int):
        ORDER.append(f"listener.bind:{port}")
        return RecordingListener(ORDER)

    def client_factory(cid: int, port: int):
        ORDER.append(f"client:{port}")
        return object()

    def harden_fn():
        ORDER.append("harden")

        class _Report:
            ok = True
            failures = ()

        return _Report()

    def on_ready(_supervisor) -> None:
        ORDER.append("ready")

    overrides = {"stub_source": SCAFFOLD_RECORDS}
    overrides.update(payload_overrides)
    parsed = guest_main.parse_payload(payload_dict(**overrides))
    guest_main.run(
        parsed,
        listener_factory=listener_factory,
        client_factory=client_factory,
        harden_fn=harden_fn,
        stop=StopImmediately(),
        on_ready=on_ready,
    )
    return list(ORDER)


def test_the_startup_order_is_hook_then_listener_then_supervisor_then_tier0() -> None:
    """Each step is where it is because a later position breaks something.

    The hook precedes the supervisor because the supervisor binds it before
    executing the scaffold and a stub body names it literally. The listener
    precedes the supervisor because the host's CONNECT handshake is refused
    rather than queued when nothing is listening. Tier-0 follows construction
    because the scaffold is trusted host-generated source that should not have to
    run under the ruleset, and it precedes the serve loop because that is where
    the first *model-authored* exec becomes reachable.
    """
    log = run_recording(granted_ports=["LM_PORT"])
    assert log.index("client:5001") < log.index("listener.bind:5003")
    assert log.index("listener.bind:5003") < log.index("scaffold.exec")
    assert log.index("scaffold.exec") < log.index("harden")
    assert log.index("harden") < log.index("ready")


def test_hardening_is_on_by_default_and_opt_out_is_explicit() -> None:
    assert "harden" in run_recording()
    assert "harden" not in run_recording(harden=False)


def test_the_listener_is_closed_even_when_construction_fails() -> None:
    log: list[str] = []
    listener = RecordingListener(log)

    def listener_factory(port: int):
        return listener

    def exploding_harden():
        raise RuntimeError("tier-0 blew up")

    parsed = guest_main.parse_payload(payload_dict())
    with pytest.raises(RuntimeError):
        guest_main.run(
            parsed,
            listener_factory=listener_factory,
            harden_fn=exploding_harden,
            stop=StopImmediately(),
        )
    assert listener.closed is True


# ---------------------------------------------------------------------------
# The properties that would be silently wrong
# ---------------------------------------------------------------------------


def test_tier0_grants_proc_so_the_guest_can_read_back_its_own_hardening() -> None:
    """Evidence-gathering sits inside the blast radius of the thing it measures.

    `apply_tier0` installs the Landlock ruleset and only afterwards reads
    `/proc/self/status` to fill in `seccomp_mode` and `no_new_privs`. With the
    bare default policy those roots do not include `/proc`, so a guest that
    hardened *correctly* reports `Seccomp: -1` -- the exact failure S5 met on its
    first host run and fixed in the probe's own local policy, which is why this
    module inherited the gap.
    """
    policy = guest_main.guest_tier0_policy()
    assert "/proc" in policy.read_only_roots


def test_tier0_grants_the_root_this_package_is_imported_from() -> None:
    """A lazy import after hardening must not become EACCES.

    The launcher unpacks `repl_sandbox` into a directory of its choosing, which
    is under none of `Tier0Policy`'s default roots. Module-scope imports have
    already run by the time Tier-0 is applied; the ones that have not are the
    failure, and they surface deep in a later turn rather than at startup.
    """
    policy = guest_main.guest_tier0_policy()
    root = pathlib.Path(guest_main.guest_source_root())

    # The granted root really does contain this package -- not merely a string
    # that looks plausible.
    assert (root / "repl_sandbox" / "guest_main.py").is_file()
    assert str(root) in policy.read_only_roots


def test_the_default_hardener_passes_a_policy_rather_than_taking_the_bare_default() -> None:
    """The two grants above only bind if `_default_harden` actually applies them.

    Checked at the call site because that is where the defect lived: a correct
    policy nobody passes is the same guest as no policy at all.
    """
    import inspect

    body = inspect.getsource(guest_main._default_harden)
    assert "apply_tier0()" not in body
    assert "guest_tier0_policy()" in body


def test_the_default_listener_is_native_vsock_never_the_hybrid_one() -> None:
    """The guest keeps what the host lost: a kernel-supplied peer CID.

    Cloud Hypervisor's hybrid vsock moved the *host* side to AF_UNIX at
    `<uds>_<port>`; the guest side is unchanged and still binds AF_VSOCK on
    VMADDR_CID_ANY. `HybridVsockListener.accept` returns the `session_cid` its
    own constructor was given, so using it here would make `require_host_cid` a
    check against a number this process picked -- which is the one property that
    check exists to hold.
    """
    import inspect

    from repl_sandbox import transport

    # The module names the hybrid class only in prose, explaining why not to use
    # it, so the check is on what the code reaches for -- never on the text.
    imported = [
        line
        for line in pathlib.Path(guest_main.__file__).read_text(encoding="utf-8").splitlines()
        if line.startswith(("import ", "from ")) and "Hybrid" in line
    ]
    assert imported == []

    body = inspect.getsource(guest_main._default_listener)
    assert "VsockListener(" in body
    assert "Hybrid" not in body

    # And the class it names really is the one that reads the CID from accept(),
    # rather than returning one a constructor was handed.
    assert "addr[0]" in inspect.getsource(transport.VsockListener.accept)
    assert "self.session_cid" in inspect.getsource(transport.HybridVsockListener.accept)


def test_the_entry_point_imports_no_rlms() -> None:
    """It runs in a guest image that has no rlms.

    `kata_repl` is the module that legitimately imports rlms host-side, so the
    entry point must not reach it even transitively -- which is why this checks
    the import list rather than trusting that the modules it names are clean.
    """
    source = pathlib.Path(guest_main.__file__).read_text(encoding="utf-8")
    offending = [
        line
        for line in source.splitlines()
        if line.startswith(("import rlm", "from rlm")) or "kata_repl" in line
    ]
    assert offending == []


def test_the_entry_point_imports_and_works_with_rlms_entirely_absent() -> None:
    """The guest condition, simulated rather than inferred.

    Reading the import lines proves nothing about the *transitive* closure, and
    the closure is what actually failed before: `supervisor.py` imported rlms and
    made `GuestSupervisor` unconstructible in an image that has none. This blocks
    the `rlm` root outright and imports the module for real.

    A subprocess rather than an in-process import hook, so a half-imported module
    or a mutated `builtins.__import__` cannot leak into the rest of the suite.
    """
    script = textwrap.dedent(
        """
        import builtins, sys
        real = builtins.__import__
        def guard(name, *a, **k):
            if name.split(".")[0] == "rlm":
                raise ModuleNotFoundError("No module named 'rlm'")
            return real(name, *a, **k)
        builtins.__import__ = guard
        for m in [m for m in list(sys.modules) if m.split(".")[0] == "rlm"]:
            del sys.modules[m]

        from repl_sandbox.guest_main import parse_payload
        parsed = parse_payload({
            "stub_source": "",
            "reserved_names": ["answer"],
            "control_port": 5003,
            "max_frame_len": 1024,
        })
        assert parsed.control_port == 5003
        print("OK")
        """
    )
    src_root = str(pathlib.Path(__file__).resolve().parents[2])
    result = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True,
        text=True,
        cwd=src_root,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    assert "OK" in result.stdout


def test_main_exits_two_on_a_payload_it_could_not_load(tmp_path: pathlib.Path) -> None:
    """A distinct code, because the repair is distinct.

    Exit 2 says the launcher placed the wrong bytes; exit 1 says the guest died
    after construction. One code for both would leave the host unable to tell
    them apart.
    """
    assert guest_main.main(["--payload", str(tmp_path / "absent.json")]) == 2
