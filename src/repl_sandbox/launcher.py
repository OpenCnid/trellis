"""Host provisioning gate G1, and the thing that hands the backend a guest.

Source of truth: docs/product/repl-sandbox/REPL_SANDBOX_BUILD_PLAN.md section 4
(Host provisioning gate (G1 — SPEC section 8 gate 1)), with the deployment facts
from REPL_SANDBOX_ARCHITECTURE.md section 8 (Deployment) and the split version
pins of REPL_SANDBOX_ARCHITECTURE.md section 7 requirement 3.

G1 exists because "a VM boots" is not "the VM has hardware KVM". Kata on Cloud
Hypervisor needs real `/dev/kvm`; a silent QEMU-TCG fallback is 5-35x slower
*and loses the hardware VM boundary*, which is the whole control. So the gate is
a probe of the host, not a claim about it, and `boot` refuses to proceed when the
probe fails rather than starting something that merely looks like a microVM.

Every probe goes through an injected callable — `run_cmd` for the binaries, a
`kvm_probe` for the device node, an `accel_benchmark` for the acceleration
measurement. That is what makes the gate testable on a machine that cannot run
any of them. It is also why nothing here ever *substitutes* for a probe: an
absent benchmark is reported as a failure naming the command an operator must
run, never as a pass.

Two launchers live here and they are not interchangeable:

* `KataLauncher` — the real one. It gates on the host and refuses without it.
* `InProcessLauncher` — a **test double** with no isolation of any kind. Its
  `preflight` never passes, so a caller that gates on provisioning cannot select
  it by accident.
"""

from __future__ import annotations

import os
import stat
import subprocess
import threading
from dataclasses import dataclass, field
from typing import Callable, Protocol, runtime_checkable

from repl_sandbox.audit import AuditLog
from repl_sandbox.config import SandboxConfig, VMADDR_CID_HOST, parse_version
from repl_sandbox.errors import SandboxError
from repl_sandbox.supervisor import GuestSupervisor
from repl_sandbox.transport import Connection, LoopbackClient, LoopbackListener, serve_forever

# ---------------------------------------------------------------------------
# What the gate probes
# ---------------------------------------------------------------------------

#: The KVM device node. Its absence is the difference between a hardware VM
#: boundary and an emulator (ARCHITECTURE section 8).
KVM_DEVICE = "/dev/kvm"

KATA_RUNTIME_BIN = "kata-runtime"
CLOUD_HYPERVISOR_BIN = "cloud-hypervisor"

#: Bound on any probe subprocess. `kata-runtime check` talks to the kernel and
#: to containerd; a hung probe must not hang the gate.
DEFAULT_PROBE_TIMEOUT_S = 60.0

#: How much of a probe's output is kept in `PreflightResult.observed`. Operators
#: read this; a runaway binary must not turn the report into a memory problem.
MAX_OUTPUT_CHARS = 2000

#: The acceleration measurement of BUILD_PLAN section 4, as a pair of commands
#: an operator runs on the candidate host. The comparison is the measurement:
#: the same boot under `-accel kvm` and under `-accel tcg`, wall-clock. A 5-30x
#: gap means the `kvm` run silently fell back to emulation.
ACCELERATION_COMMAND_KVM = (
    "qemu-system-x86_64 -accel kvm -cpu host -m 1G -nographic -no-reboot "
    "-kernel <guest-kernel> -append 'console=ttyS0'"
)
ACCELERATION_COMMAND_TCG = (
    "qemu-system-x86_64 -accel tcg -m 1G -nographic -no-reboot "
    "-kernel <guest-kernel> -append 'console=ttyS0'"
)

#: The synthetic CID the in-process double reports. Above the reserved vsock
#: CIDs (0 hypervisor / 1 local / 2 host) so it satisfies the same range checks
#: a real guest CID does.
IN_PROCESS_CID = 3


@dataclass(frozen=True)
class PreflightResult:
    """The G1 verdict plus everything the probes actually saw.

    `failures` is the whole reason for a NO: one string per unmet condition,
    each naming what was probed and what came back. `observed` is the operator's
    view — the raw-ish probe output, so a NO can be diagnosed without re-running
    anything by hand.
    """

    ok: bool
    failures: tuple[str, ...] = ()
    observed: dict = field(default_factory=dict)

    def report(self) -> str:
        """A human-readable verdict for an operator or a log line."""
        if self.ok:
            return "G1 PASS"
        return "G1 FAIL:\n" + "\n".join(f"  - {failure}" for failure in self.failures)


@runtime_checkable
class GuestHandle(Protocol):
    """One live guest, from the host's side.

    The four members are the four things `KataREPL.setup()` needs in order, and
    they exist as separate calls because the order is the contract
    (INTERFACES section 2 — `setup()`): the bridge comes up before any untrusted
    worker, the scaffold is installed before any model-authored code, and the
    control round trip is last.

    `start_bridge` and `install_scaffold` are additions to the three-member
    shape the seam map implies. They are here because the guest supervisor takes
    its scaffold at construction (`supervisor.GuestSupervisor.__init__`,
    `stub_source`) and there is no control op that installs one, so "materialise
    the capabilities" is necessarily something the *launcher* does to the guest,
    not something the backend sends over the wire.
    """

    cid: int

    def start_bridge(self) -> None: ...

    def install_scaffold(self, stub_source: str) -> None: ...

    def control(self) -> Connection: ...

    def shutdown(self) -> None: ...


# ---------------------------------------------------------------------------
# Probes
# ---------------------------------------------------------------------------


def probe_kvm_device(path: str = KVM_DEVICE) -> dict:
    """Report what the KVM device node actually is on this host.

    Reports rather than judges: `preflight` decides which of these facts is a
    failure. A character device that exists but is not readable *and* writable
    is as fatal as one that is missing — QEMU/Cloud Hypervisor opens it O_RDWR.
    """
    observed: dict = {
        "path": path,
        "present": False,
        "char_device": False,
        "readable": False,
        "writable": False,
    }
    try:
        info = os.stat(path)
    except OSError as exc:
        observed["error"] = f"{type(exc).__name__}: {exc}"
        return observed
    observed["present"] = True
    observed["char_device"] = stat.S_ISCHR(info.st_mode)
    observed["readable"] = os.access(path, os.R_OK)
    observed["writable"] = os.access(path, os.W_OK)
    return observed


def _clip(text: object) -> str:
    """Bound a probe's output before it is kept for an operator to read."""
    if not isinstance(text, str):
        text = "" if text is None else str(text)
    if len(text) <= MAX_OUTPUT_CHARS:
        return text
    return text[:MAX_OUTPUT_CHARS] + f"...[{len(text) - MAX_OUTPUT_CHARS} more chars]"


class KataLauncher:
    """Boots (or refuses to boot) one Kata microVM per session.

    The refusal is the point. On a host without KVM there is no boundary to be
    had, and a launcher that returned *something* anyway would hand the backend
    a guest that is not a guest. So `boot` runs the gate first and raises with
    the failure list when it does not pass.
    """

    def __init__(
        self,
        config: SandboxConfig,
        run_cmd: Callable[..., object] = subprocess.run,
        *,
        kvm_probe: Callable[[], dict] | None = None,
        accel_benchmark: Callable[[], dict] | None = None,
        audit: AuditLog | None = None,
        probe_timeout_s: float = DEFAULT_PROBE_TIMEOUT_S,
    ) -> None:
        self.config = config
        self.run_cmd = run_cmd
        self.audit = audit
        self.probe_timeout_s = probe_timeout_s
        self._kvm_probe = kvm_probe if kvm_probe is not None else probe_kvm_device
        #: Supplied by an operator or a host-side harness that can actually run
        #: the measurement. `None` means the acceleration condition is unproven,
        #: and unproven is a failure — never a pass (BUILD_PLAN section 4).
        self._accel_benchmark = accel_benchmark

    # -- probe plumbing ----------------------------------------------------

    def _run(self, argv: list[str]) -> dict:
        """Run one probe command and reduce it to facts.

        A missing binary, a timeout, and a non-zero exit are three different
        observations and are kept apart, because they point at three different
        fixes for the operator.
        """
        observed: dict = {"argv": list(argv)}
        try:
            completed = self.run_cmd(
                list(argv),
                capture_output=True,
                text=True,
                timeout=self.probe_timeout_s,
            )
        except FileNotFoundError as exc:
            observed["error"] = f"{argv[0]} was not found on PATH: {exc}"
            return observed
        except subprocess.TimeoutExpired as exc:
            observed["error"] = f"{argv[0]} timed out after {self.probe_timeout_s}s: {exc}"
            return observed
        except OSError as exc:
            observed["error"] = f"{argv[0]} could not be run: {type(exc).__name__}: {exc}"
            return observed

        returncode = getattr(completed, "returncode", None)
        observed["returncode"] = returncode if isinstance(returncode, int) else None
        observed["stdout"] = _clip(getattr(completed, "stdout", ""))
        observed["stderr"] = _clip(getattr(completed, "stderr", ""))
        if observed["returncode"] is None:
            observed["error"] = f"{argv[0]} produced no exit status"
        return observed

    def _probe_version(self, binary: str) -> dict:
        """Ask one binary for its version and parse a numeric version out of it.

        The two pins are separate upstreams with separate schemes, so each
        version is read from the binary that owns it and the observation records
        which command produced it. Crossing them is the classic way to turn two
        pins into one (ARCHITECTURE section 7 requirement 3).
        """
        observed = self._run([binary, "--version"])
        if observed.get("error") or observed.get("returncode") != 0:
            return observed
        raw = f"{observed.get('stdout', '')}\n{observed.get('stderr', '')}".strip()
        try:
            parse_version(raw)
        except ValueError as exc:
            observed["error"] = f"no version number in {binary} --version output: {exc}"
            return observed
        observed["version_text"] = raw
        return observed

    # -- the gate ----------------------------------------------------------

    def preflight(self) -> PreflightResult:
        """Run gate G1: KVM, `kata-runtime check`, both pins, acceleration.

        Every condition is probed independently and all failures are collected,
        so one run tells an operator everything that is wrong with the host
        rather than the first thing.
        """
        failures: list[str] = []
        observed: dict = {}

        # 1. The device node. Without it the boundary does not exist.
        kvm = self._kvm_probe()
        observed["kvm"] = kvm
        path = kvm.get("path", KVM_DEVICE)
        if not kvm.get("present"):
            failures.append(
                f"{path} is not present ({kvm.get('error', 'no such device')}); "
                "Kata on Cloud Hypervisor requires hardware KVM"
            )
        elif not kvm.get("char_device"):
            failures.append(f"{path} exists but is not a character device")
        elif not (kvm.get("readable") and kvm.get("writable")):
            failures.append(
                f"{path} is not readable and writable by this user "
                f"(readable={kvm.get('readable')}, writable={kvm.get('writable')}); "
                "the VMM opens it O_RDWR"
            )

        # 2. Kata's own validator — the enforcing surface BUILD_PLAN section 4
        #    names alongside the acceleration measurement.
        check = self._run([KATA_RUNTIME_BIN, "check"])
        observed["kata_check"] = check
        if check.get("error"):
            failures.append(f"`{KATA_RUNTIME_BIN} check` did not run: {check['error']}")
        elif check.get("returncode") != 0:
            failures.append(
                f"`{KATA_RUNTIME_BIN} check` exited {check.get('returncode')}: "
                f"{_clip(check.get('stderr') or check.get('stdout'))}"
            )

        # 3. The two pins. Two upstreams, two schemes, two feeds.
        kata_version = self._probe_version(KATA_RUNTIME_BIN)
        cloud_hypervisor_version = self._probe_version(CLOUD_HYPERVISOR_BIN)
        observed["kata_version"] = kata_version
        observed["cloud_hypervisor_version"] = cloud_hypervisor_version

        kata_text = kata_version.get("version_text")
        if kata_text is None:
            failures.append(
                f"could not determine the {KATA_RUNTIME_BIN} version "
                f"({kata_version.get('error') or 'exit ' + str(kata_version.get('returncode'))})"
            )
        ch_text = cloud_hypervisor_version.get("version_text")
        if ch_text is None:
            failures.append(
                f"could not determine the {CLOUD_HYPERVISOR_BIN} version "
                f"({cloud_hypervisor_version.get('error') or 'exit ' + str(cloud_hypervisor_version.get('returncode'))})"
            )

        # The comparison itself is the config's, so there is exactly one place
        # in the tree that knows which pin belongs to which upstream. When one
        # version could not be read, its own pin minimum stands in for it: that
        # side already carries a failure above, and the substitution leaves the
        # *other* side's comparison against real output untouched.
        failures.extend(
            self.config.check_versions(
                kata_text if kata_text is not None else self.config.kata_min_version,
                ch_text if ch_text is not None else self.config.cloud_hypervisor_min_version,
            )
        )

        # 4. Acceleration: real, or emulated and pretending.
        observed["acceleration"] = self._check_acceleration(failures)

        result = PreflightResult(ok=not failures, failures=tuple(failures), observed=observed)
        if self.audit is not None:
            self.audit.record(
                VMADDR_CID_HOST,
                "launcher.preflight",
                ok=result.ok,
                failures=list(result.failures),
            )
        return result

    def _check_acceleration(self, failures: list[str]) -> dict:
        """Verify acceleration is hardware, not a silent TCG fallback.

        There is no honest way to measure this from a host that cannot run the
        VM, so when no benchmark is injected this reports the two commands an
        operator must run and records a failure. An unmeasured condition is
        never a met one.
        """
        if self._accel_benchmark is None:
            failures.append(
                "acceleration is unmeasured, so G1 cannot pass. On the candidate "
                f"host run `{ACCELERATION_COMMAND_KVM}` and `{ACCELERATION_COMMAND_TCG}` "
                "and compare boot wall time: a 5-30x gap means the -accel kvm run "
                "silently fell back to TCG and the hardware VM boundary is absent "
                "(ARCHITECTURE section 8)."
            )
            return {
                "measured": False,
                "command_kvm": ACCELERATION_COMMAND_KVM,
                "command_tcg": ACCELERATION_COMMAND_TCG,
            }

        try:
            measurement = self._accel_benchmark()
        except Exception as exc:  # noqa: BLE001 - any benchmark failure is a gate failure
            failures.append(f"the acceleration benchmark raised {type(exc).__name__}: {exc}")
            return {"measured": False, "error": f"{type(exc).__name__}: {exc}"}

        if not isinstance(measurement, dict):
            failures.append(
                "the acceleration benchmark returned "
                f"{type(measurement).__name__}, not a result mapping"
            )
            return {"measured": False, "error": "malformed benchmark result"}

        observed = dict(measurement)
        observed["measured"] = True
        # Fail-closed on the flag: anything that is not an explicit True — a
        # missing key, a None, a truthy string — is not a measurement of
        # near-native performance.
        if measurement.get("near_native") is not True:
            failures.append(
                "the acceleration benchmark did not report near-native "
                f"performance: {measurement}"
            )
        return observed

    # -- boot --------------------------------------------------------------

    def boot(self, session_id: str) -> GuestHandle:
        """Gate the host, then claim one microVM for `session_id`.

        Raises `SandboxError` with the full failure list when G1 does not pass —
        including on this repository's Windows development host, which has no
        `/dev/kvm` at all.
        """
        if not isinstance(session_id, str) or not session_id:
            raise SandboxError("session id must be a non-empty string")

        result = self.preflight()
        if not result.ok:
            raise SandboxError(
                "refusing to boot a Kata microVM: the host provisioning gate (G1) "
                "failed: " + "; ".join(result.failures)
            )

        # Everything above this line is built and probes a real host. What
        # follows it — minting the guest image, launching Cloud Hypervisor with
        # a chosen guest CID, and waiting for the supervisor to listen — is
        # BUILD_PLAN section 5.2 (S2) and is not built. Raising here is the
        # whole of the honesty: a launcher that returned a handle backed by
        # nothing would be indistinguishable from a working one until the first
        # exec, and would have already been counted as a boundary by then.
        raise NotImplementedError(
            f"host gate G1 passed for session {session_id}, but the microVM launch "
            "path (guest image, Cloud Hypervisor launch with an assigned guest CID, "
            "supervisor readiness) is BUILD_PLAN section 5.2 (S2) and is not built. "
            "No guest was claimed."
        )


# ---------------------------------------------------------------------------
# The test double
# ---------------------------------------------------------------------------


class InProcessLauncher:
    """**Provides no isolation. A test double only. Never select it to deploy.**

    It runs the guest supervisor in this process, behind the loopback transport,
    so the three-method backend contract can be exercised end to end on a host
    with no `/dev/kvm`. There is no VM, no kernel boundary, no CID from any
    kernel, and no privilege separation: the "guest" shares this interpreter's
    memory, filesystem, and credentials, and model-authored code executed
    through it runs with them.

    Two structural facts keep it out of a deployment path rather than a comment
    asking nicely: `preflight` never returns `ok`, and the CID it reports is a
    constant this class chose rather than anything a kernel assigned.
    """

    def __init__(
        self,
        config: SandboxConfig,
        stub_source: str = "",
        *,
        cid: int = IN_PROCESS_CID,
        audit: AuditLog | None = None,
        rpc_hook: Callable[[str, dict], dict] | None = None,
    ) -> None:
        self.config = config
        #: Scaffold source the guest image would have carried. The capabilities
        #: the backend materialises at `setup()` are appended to it.
        self.stub_source = stub_source
        self.cid = cid
        self.audit = audit
        #: Passed through to the guest so a materialised stub has something to
        #: call. Without it the scaffold defines stubs that raise `NameError`
        #: the first time model code uses one.
        self.rpc_hook = rpc_hook

    def preflight(self) -> PreflightResult:
        """Always FAIL. There is nothing here for a provisioning gate to pass.

        A caller that gates on G1 therefore cannot reach this launcher's `boot`
        by way of a passing preflight.
        """
        return PreflightResult(
            ok=False,
            failures=(
                "InProcessLauncher is a test double: it provides no isolation, "
                "boots no microVM, and can never satisfy the host provisioning "
                "gate (BUILD_PLAN section 4).",
            ),
            observed={"test_double": True, "isolation": None},
        )

    def boot(self, session_id: str) -> "InProcessGuest":
        """Stand up a loopback control port and hand back a guest handle."""
        if not isinstance(session_id, str) or not session_id:
            raise SandboxError("session id must be a non-empty string")
        return InProcessGuest(
            config=self.config,
            cid=self.cid,
            base_stub_source=self.stub_source,
            audit=self.audit,
            rpc_hook=self.rpc_hook,
        )


class InProcessGuest:
    """The test double's guest: a `GuestSupervisor` on a loopback socket.

    **Not a boundary.** The loopback listener is an ordinary `AF_INET` socket on
    `127.0.0.1` and the supervisor is an object in this process. What it does
    faithfully reproduce is the *shape* of the seam: the host connects to the
    supervisor, every request is a length-prefixed JSON frame, and the peer CID
    the supervisor authenticates is supplied by the listener rather than read out
    of the frame.
    """

    def __init__(
        self,
        config: SandboxConfig,
        cid: int,
        base_stub_source: str = "",
        audit: AuditLog | None = None,
        rpc_hook: Callable[[str, dict], dict] | None = None,
    ) -> None:
        self.config = config
        self.cid = cid
        self.audit = audit
        self._base_stub_source = base_stub_source
        #: What the materialised stubs call. A stub body names
        #: `capabilities.TRANSPORT_HOOK`, so a namespace without it raises
        #: `NameError` on the first tool call model code makes. Optional because
        #: a guest with no ports granted needs no hook; supplied, it is bound
        #: before the scaffold executes. It is convenience, never containment —
        #: model code that speaks the wire itself bypasses it and meets the same
        #: host-side CID auth and caps.
        self._rpc_hook = rpc_hook
        #: The control port: the guest supervisor listens and only the host CID
        #: connects (INTERFACES section 1, seam 2), so the peer CID this
        #: listener reports is the *host's*, not the guest's.
        self._listener = LoopbackListener(peer_cid=VMADDR_CID_HOST)
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._connections: list[Connection] = []
        self.supervisor: GuestSupervisor | None = None
        self.bridge_started = False

    # -- setup steps -------------------------------------------------------

    def start_bridge(self) -> None:
        """No-op, and it says so.

        In a real guest this starts the unprivileged loopback-to-vsock forwarder
        before the worker exists (INTERFACES section 3.3). In this double there
        is no boundary for a bridge to cross and no separate worker process, so
        nothing starts. The flag exists only so a test can see that the backend
        called this step in the right order.
        """
        self.bridge_started = True

    def install_scaffold(self, stub_source: str) -> None:
        """Construct the supervisor with the materialised stubs and start serving.

        The scaffold goes in at construction because that is where the
        supervisor takes it, and because it must exist before any
        model-authored code runs: the reserved-name pins are taken from it.
        Installing twice is refused — a second scaffold would mean model code
        had already run against the first.
        """
        if self.supervisor is not None:
            raise SandboxError("the guest scaffold is already installed")
        source = "\n".join(part for part in (self._base_stub_source, stub_source) if part)
        self.supervisor = GuestSupervisor(
            self.config, stub_source=source, rpc_hook=self._rpc_hook
        )
        self._thread = threading.Thread(
            target=serve_forever,
            args=(self._listener, self.supervisor.handle_request, self.config.max_frame_len),
            kwargs={"audit": self._audit_event, "stop": self._stop},
            name=f"in-process-guest-{self.cid}",
            daemon=True,
        )
        self._thread.start()

    def control(self) -> Connection:
        """Open a control-channel connection to the supervisor.

        Refuses before the scaffold is installed: a control channel served by a
        supervisor that does not exist would accept and then hang, which is the
        failure mode hardest to read.
        """
        if self.supervisor is None:
            raise SandboxError("the guest is not serving yet; install the scaffold first")
        conn = LoopbackClient(self._listener.address).connect()
        self._connections.append(conn)
        return conn

    # -- teardown ----------------------------------------------------------

    def shutdown(self) -> None:
        """Stop serving and close everything. Idempotent; never raises."""
        self._stop.set()
        for conn in self._connections:
            try:
                conn.close()
            except OSError:
                pass
        self._connections.clear()
        try:
            self._listener.close()
        except OSError:
            pass
        thread, self._thread = self._thread, None
        if thread is not None:
            thread.join(timeout=5)

    # -- internals ---------------------------------------------------------

    def _audit_event(self, event: str, **fields: object) -> None:
        if self.audit is not None:
            self.audit.record(self.cid, f"guest.{event}", **fields)
