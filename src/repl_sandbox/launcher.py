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

import base64
import io
import os
import platform
import stat
import subprocess
import tarfile
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Callable, Protocol, runtime_checkable

from repl_sandbox.audit import AuditLog
from repl_sandbox.config import (
    CTR_NAMESPACE,
    GUEST_IMAGE,
    GUEST_IMAGE_DIGEST,
    KATA_RUNTIME_HANDLER,
    SandboxConfig,
    VMADDR_CID_HOST,
    parse_version,
)
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
#: the same boot under `-accel kvm` and under `-accel tcg`, wall-clock. TCG is
#: emulation and runs 5-35x slower than hardware KVM (ARCHITECTURE section 8),
#: so a *large* gap is the healthy result: it is the evidence that the `kvm` run
#: was hardware-accelerated. Two runs that take roughly the *same* time are the
#: fallback signature - the `kvm` run was emulating too, and there is no
#: hardware VM boundary.
ACCELERATION_COMMAND_KVM = (
    "qemu-system-x86_64 -accel kvm -cpu host -m 1G -nographic -no-reboot "
    "-kernel <guest-kernel> -append 'console=ttyS0 panic=-1'"
)
ACCELERATION_COMMAND_TCG = (
    "qemu-system-x86_64 -accel tcg -m 1G -nographic -no-reboot "
    "-kernel <guest-kernel> -append 'console=ttyS0 panic=-1'"
)

#: The QEMU binary the benchmark drives. Named once so a host that installs it
#: elsewhere has one place to look.
QEMU_BIN = "qemu-system-x86_64"

#: The measured speedup at or above which the KVM run counts as hardware
#: accelerated. Sits at the bottom of the 5-35x band ARCHITECTURE section 8
#: observes, which the differential measurement below can be held to honestly -
#: a *total*-time comparison cannot, because QEMU's fixed startup cost is not
#: accelerated and drags the quotient toward 1 no matter how fast the guest is.
#: A silent fallback scores ~1.0, so the separation this floor sits in the
#: middle of is roughly an order of magnitude wide.
MIN_ACCELERATION_RATIO = 5.0

#: How many times each boot pair is repeated. The per-side minimum across
#: trials is what gets compared: scheduling noise, page-cache misses, and
#: neighbouring load can only ever *add* wall time, so the fastest observation
#: of each side is the one least contaminated by everything that is not the
#: work being measured.
BENCHMARK_TRIALS = 3

#: Wall-clock bound per benchmark boot. The TCG side is the slow one by
#: construction, and it is emulating a full kernel boot, so this is generous.
#: A boot that cannot finish inside it is not a measurement.
BENCHMARK_TIMEOUT_S = 300.0

#: Kernel command line for every benchmark boot. `panic=-1` with `-no-reboot`
#: is what makes a run *terminate*: the kernel panics rather than looping, and
#: QEMU exits. `rdinit=/bin/false` supplies the panic on the initrd-loaded side
#: - init exits immediately, the kernel treats that as fatal, and the run ends
#: without ever reaching a shell that would wait forever on a console nobody is
#: typing at. The panic is the stopwatch's stop button, not a failure.
BENCHMARK_APPEND = "console=ttyS0 panic=-1 rdinit=/bin/false"

#: The synthetic CID the in-process double reports. Above the reserved vsock
#: CIDs (0 hypervisor / 1 local / 2 host) so it satisfies the same range checks
#: a real guest CID does.
IN_PROCESS_CID = 3

#: Where a real launcher starts minting session ids. Deliberately above
#: `IN_PROCESS_CID` so a real session's identifier can never be confused with
#: the double's constant in an audit log or a ledger key.
FIRST_LAUNCHER_CID = 16

#: Bound on one `ctr run -d`. A Kata boot returned in ~0.7s on the reference
#: host, but that host was idle; this is generous because the alternative to a
#: generous bound is a false refusal on a loaded host.
DEFAULT_BOOT_TIMEOUT_S = 180.0

#: Bound on the whole readiness wait, and the spacing between polls. Every stage
#: before the guest's own Python startup was complete within ~30 ms on the
#: reference host, so this budget is almost entirely for the interpreter coming
#: up inside the guest and for `GuestSupervisor` construction.
DEFAULT_READY_TIMEOUT_S = 90.0
READY_POLL_INTERVAL_S = 0.25

#: Where the launcher unpacks the package and places the startup payload. Its
#: parent is what Tier-0 must grant read access to, which `guest_main` derives
#: from its own `__file__` rather than from this constant.
GUEST_ROOT = "/run/trellis"

#: Bytes of base64 per `ctr task exec`. A single argv string is capped at 128 KiB
#: by the kernel (`MAX_ARG_STRLEN`), so a payload is appended in chunks.
EXEC_CHUNK_BYTES = 60_000


def discover_vsock_uds(vmm_pid: int, *, proc_root: str = "/proc") -> str:
    """The hybrid-vsock Unix socket the VMM created, found rather than assumed.

    The path convention (`/run/vc/vm/<sandbox>/clh.sock`) is Kata's and could
    move, so it is read out of the running VMM's own argv: the process names its
    sandbox directory, and the socket is identified by being the one non-API
    socket in it. A launcher that hard-coded the path would report "no bridge"
    when what it means is "no socket where I looked".

    Observed on the reference host 2026-07-25: the VMM's argv carries only
    `--api-socket /run/vc/vm/<sandbox>/clh-api.sock`, and the vsock socket
    (`clh.sock`) appears in that directory without ever being named on the
    command line — which is exactly why the directory is listed rather than the
    argv being scanned for the socket itself.
    """
    try:
        with open(os.path.join(proc_root, str(vmm_pid), "cmdline"), "rb") as handle:
            argv = handle.read().split(b"\0")
    except OSError as exc:
        raise SandboxError(f"cannot read the command line of VMM pid {vmm_pid}: {exc}") from exc

    directory = None
    for raw in argv:
        token = raw.decode("utf-8", "replace")
        if token.startswith("/run/") and "/vm/" in token:
            directory = os.path.dirname(token)
            break
    if directory is None or not os.path.isdir(directory):
        raise SandboxError(
            f"no /run/**/vm/** path in VMM pid {vmm_pid}'s command line, so its "
            "sandbox directory could not be located"
        )

    sockets = []
    for entry in sorted(os.listdir(directory)):
        path = os.path.join(directory, entry)
        try:
            if stat.S_ISSOCK(os.stat(path).st_mode) and "api" not in entry:
                sockets.append(path)
        except OSError:
            continue
    if not sockets:
        raise SandboxError(
            f"{directory} holds no non-API socket; the VMM may not have been "
            "configured with a vsock device"
        )
    return sockets[0]


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


def default_benchmark_kernel() -> str:
    """The kernel the benchmark boots: this host's own.

    Chosen over shipping a guest image because it is always present, always
    matches the host architecture, and is identical across every run - and
    identical-across-runs is the only property the comparison needs. It is never
    booted as a *guest system*; it is booted as a fixed unit of CPU work.
    """
    return f"/boot/vmlinuz-{platform.release()}"


def default_benchmark_initrd() -> str:
    """The initrd whose decompression is the benchmark's measured workload.

    Its only job is to be a few dozen megabytes of CPU-bound work the guest must
    do *after* QEMU has finished starting - see `qemu_accel_benchmark` for why
    the measurement needs a workload it can add and subtract.
    """
    return f"/boot/initrd.img-{platform.release()}"


def _benchmark_argv(accel: str, kernel: str, initrd: str | None = None) -> list[str]:
    """One benchmark boot's argv. Identical either side but for the accelerator.

    `-cpu host` is passed only on the KVM side because it is meaningless without
    hardware virtualization - under TCG it forces emulation of host CPU features
    and would slow that side further, inflating the ratio in the gate's favour.
    Keeping it off the TCG side makes the comparison *harder* to pass, which is
    the direction an honest gate errs in.
    """
    cpu_flags = ["-cpu", "host"] if accel == "kvm" else []
    workload = ["-initrd", initrd] if initrd else []
    return [
        QEMU_BIN,
        "-accel", accel,
        *cpu_flags,
        "-m", "1G",
        "-nographic",
        "-no-reboot",
        "-kernel", kernel,
        *workload,
        "-append", BENCHMARK_APPEND,
    ]


def qemu_accel_benchmark(
    kernel: str | None = None,
    initrd: str | None = None,
    *,
    run_cmd: Callable[..., object] = subprocess.run,
    clock: Callable[[], float] = time.perf_counter,
    timeout_s: float = BENCHMARK_TIMEOUT_S,
    min_ratio: float = MIN_ACCELERATION_RATIO,
    trials: int = BENCHMARK_TRIALS,
) -> dict:
    """Measure hardware acceleration as a *differential*, and report the ratio.

    The naive measurement - boot once under `-accel kvm`, once under
    `-accel tcg`, divide - is biased and cannot be held to the 5-35x band
    ARCHITECTURE section 8 states. QEMU spends a fixed ~1s starting up that no
    accelerator touches, and that constant sits in both numerator and
    denominator, dragging the quotient toward 1. Measured on the reference host
    it reads ~3.2x for a genuinely accelerated boot: still above a fallback's
    ~1.0, but with so little headroom that ordinary noise would fail a healthy
    host.

    So each accelerator is timed twice - once booting the kernel alone, once
    booting it with an initrd whose decompression is real CPU-bound guest work -
    and what gets compared is the *difference*. The fixed startup cost appears
    in both terms of each subtraction and cancels:

        ratio = (tcg_with_initrd - tcg_bare) / (kvm_with_initrd - kvm_bare)

    What remains on each side is the guest work alone, which is exactly what
    hardware virtualization does and does not accelerate. On the reference host
    this reads ~10-15x, inside the documented band, against ~1.0 for a silent
    fallback - an order of magnitude of separation for the floor to sit in.

    Each pair is run `trials` times and the per-side *minimum* is taken, because
    noise can only add wall time; the fastest observation of each side is the
    least contaminated one.

    Returns the mapping `KataLauncher.preflight` consumes. Never raises for a
    host condition: a missing binary, an unreadable kernel or initrd, and a
    refused accelerator are all *measurements that did not happen*, reported
    with `near_native` absent so the gate's fail-closed check treats them as the
    failures they are.
    """
    kernel = kernel if kernel is not None else default_benchmark_kernel()
    initrd = initrd if initrd is not None else default_benchmark_initrd()
    observed: dict = {
        "kernel": kernel,
        "initrd": initrd,
        "min_ratio": min_ratio,
        "trials": trials,
        "method": "differential (initrd-loaded minus bare, per accelerator)",
        "kvm_argv": _benchmark_argv("kvm", kernel, initrd),
        "tcg_argv": _benchmark_argv("tcg", kernel, initrd),
    }

    for label, path in (("kernel", kernel), ("initrd", initrd)):
        if not os.path.isfile(path):
            observed["error"] = (
                f"benchmark {label} {path} is not a file; there is nothing to "
                f"time. Pass an explicit {label} path."
            )
            return observed
        if not os.access(path, os.R_OK):
            observed["error"] = (
                f"benchmark {label} {path} is not readable by this user "
                "(Ubuntu ships /boot/* as root-owned)"
            )
            return observed

    def timed(accel: str, workload: str | None) -> dict:
        """Run one boot and return its wall time, or why it did not run."""
        argv = _benchmark_argv(accel, kernel, workload)
        started = clock()
        try:
            completed = run_cmd(argv, capture_output=True, text=True, timeout=timeout_s)
        except FileNotFoundError as exc:
            return {"error": f"{QEMU_BIN} was not found on PATH: {exc}"}
        except subprocess.TimeoutExpired:
            return {"error": f"the -accel {accel} boot exceeded {timeout_s}s"}
        except OSError as exc:
            return {"error": f"the -accel {accel} boot could not run: {type(exc).__name__}: {exc}"}
        elapsed = clock() - started
        returncode = getattr(completed, "returncode", None)
        return {
            "seconds": elapsed,
            "returncode": returncode if isinstance(returncode, int) else None,
            "stderr": _clip(getattr(completed, "stderr", "")),
        }

    # KVM first, bare: when the accelerator is refused outright there is no
    # reason to spend minutes emulating anything to learn the same thing.
    probe = timed("kvm", None)
    if "error" in probe:
        observed["error"] = probe["error"]
        return observed
    # Modern QEMU does not silently downgrade `-accel kvm` - it exits non-zero.
    # That refusal is a *stronger* signal than any timing, so it is read first.
    if probe.get("returncode") not in (0, None):
        observed["error"] = (
            f"`-accel kvm` exited {probe['returncode']} rather than running: "
            f"{probe.get('stderr') or '(no stderr)'}. QEMU refuses this accelerator "
            "rather than falling back, so this is KVM being unavailable, not slow."
        )
        return observed

    deltas: dict[str, list[float]] = {"kvm": [], "tcg": []}
    for _ in range(max(1, trials)):
        for accel in ("kvm", "tcg"):
            bare = timed(accel, None)
            loaded = timed(accel, initrd)
            for run in (bare, loaded):
                if "error" in run:
                    observed["error"] = (
                        f"{run['error']}; the differential needs both the bare and "
                        "the initrd-loaded boot on each side, so acceleration "
                        "stays unproven"
                    )
                    return observed
            deltas[accel].append(loaded["seconds"] - bare["seconds"])

    kvm_delta = min(deltas["kvm"])
    tcg_delta = min(deltas["tcg"])
    observed["kvm_workload_seconds"] = kvm_delta
    observed["tcg_workload_seconds"] = tcg_delta
    observed["kvm_deltas"] = deltas["kvm"]
    observed["tcg_deltas"] = deltas["tcg"]

    # A non-positive delta means the initrd-loaded boot came out no slower than
    # the bare one - the workload did not register, so there is nothing whose
    # acceleration could be measured. Never a pass.
    if kvm_delta <= 0.0 or tcg_delta <= 0.0:
        observed["error"] = (
            f"the initrd workload did not register as measurable work "
            f"(kvm delta {kvm_delta:.4f}s, tcg delta {tcg_delta:.4f}s); with no "
            "workload to accelerate there is nothing to compare"
        )
        return observed

    ratio = tcg_delta / kvm_delta
    observed["ratio"] = ratio
    observed["near_native"] = ratio >= min_ratio
    if observed["near_native"]:
        observed["interpretation"] = (
            f"the guest workload took {ratio:.2f}x as long emulated as it did under "
            "KVM, so the KVM run was hardware-accelerated rather than emulating"
        )
    else:
        observed["interpretation"] = (
            f"the guest workload ran only {ratio:.2f}x slower emulated than under "
            f"KVM, below the {min_ratio}x floor. A quotient this close to 1 is the "
            "silent-fallback signature: the -accel kvm run was emulating too."
        )
    return observed


def vmm_pids_carrying(name: str, *, proc_root: str = "/proc") -> list[int]:
    """PIDs of real Cloud Hypervisor processes whose argv names this sandbox.

    Walks `/proc` directly rather than shelling out to `pgrep`, and the reason is
    measured rather than stylistic. **`pgrep` excludes its own PID but not its
    ancestors**, so on a host with zero VMMs running, a `pgrep -af
    cloud-hypervisor` issued from any process whose own command line contains
    that string matches *itself* — observed 2026-07-25 on the reference host,
    with the calling interpreter returned as the sole hit. A launcher whose job
    is to refuse a boot that produced no VM cannot use a check that invents one.

    So identity is `/proc/<pid>/exe`, the kernel's own answer to what a process
    is running, and the argv is used only to attribute a real VMM to a sandbox.

    **`/proc/<pid>/comm` is not the discriminator and must not be used for it.**
    `TASK_COMM_LEN` truncates it to 15 characters, so a genuine Cloud Hypervisor
    reads `cloud-hyperviso` — a `comm == "cloud-hypervisor"` test refuses every
    real VM while looking exactly like a correct check (measured the same day:
    `comm='cloud-hyperviso' exe='/opt/kata/bin/cloud-hypervisor'`).
    """
    found: list[int] = []
    try:
        entries = os.listdir(proc_root)
    except OSError:
        return found
    for entry in entries:
        if not entry.isdigit():
            continue
        pid = int(entry)
        try:
            executable = os.readlink(os.path.join(proc_root, entry, "exe"))
        except OSError:
            # A process that exited mid-walk, or one this uid cannot read. Both
            # are ordinary; neither is a VMM this launcher started.
            continue
        if os.path.basename(executable) != CLOUD_HYPERVISOR_BIN:
            continue
        try:
            with open(os.path.join(proc_root, entry, "cmdline"), "rb") as handle:
                argv = handle.read().split(b"\0")
        except OSError:
            continue
        # Whole-argument match, never substring containment: sandbox names are
        # minted from a session id, so `sess-1` is a substring of `sess-10` and
        # a containment test would attribute one session's VMM to another.
        if any(name in token.decode("utf-8", "replace").split("/") for token in argv if token):
            found.append(pid)
    return found


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
        reserved_names: frozenset[str] | None = None,
        boot_timeout_s: float = DEFAULT_BOOT_TIMEOUT_S,
        namespace: str = CTR_NAMESPACE,
        guest_image: str = GUEST_IMAGE,
        guest_image_digest: str = GUEST_IMAGE_DIGEST,
    ) -> None:
        self.config = config
        self.run_cmd = run_cmd
        self.audit = audit
        self.probe_timeout_s = probe_timeout_s
        #: A Kata boot is not a probe and does not share the probe bound.
        self.boot_timeout_s = boot_timeout_s
        #: The containerd namespace this launcher owns. Not `default`: rule
        #: 19(a) asks a session to confirm a destructive step over its whole
        #: reach, and nothing sharing `default` with the provisioner and every
        #: past probe can say "everything here is mine". Kata's cgroup driver
        #: also puts the namespace literally in the leaked-cgroup path.
        self.namespace = namespace
        #: Pinned by digest. Image stores are per-namespace (measured), so
        #: owning a namespace means owning the pull.
        self.config_guest_image = guest_image
        self.guest_image_digest = guest_image_digest
        self._cid_counter = FIRST_LAUNCHER_CID
        #: Carried for the guest supervisor this launcher will construct once
        #: the microVM launch path exists. Optional here and required there:
        #: `boot` refuses before reaching a supervisor, so a launcher built
        #: without it can still run the G1 gate, which is all it does today.
        self.reserved_names = reserved_names
        self._kvm_probe = kvm_probe if kvm_probe is not None else probe_kvm_device
        #: Supplied by an operator or a host-side harness that can actually run
        #: the measurement. `None` means the acceleration condition is unproven,
        #: and unproven is a failure — never a pass (BUILD_PLAN section 4).
        self._accel_benchmark = accel_benchmark

    # -- probe plumbing ----------------------------------------------------

    def _run(self, argv: list[str], *, timeout_s: float | None = None) -> dict:
        """Run one probe command and reduce it to facts.

        A missing binary, a timeout, and a non-zero exit are three different
        observations and are kept apart, because they point at three different
        fixes for the operator.

        `timeout_s` overrides the probe bound for calls that are not probes. A
        Kata boot legitimately runs past `DEFAULT_PROBE_TIMEOUT_S` on a loaded
        host, and a boot truncated by a probe-sized timeout reports as an
        infrastructure error indistinguishable from every other one — passing on
        an idle host and misfiring exactly where the margin matters.
        """
        observed: dict = {"argv": list(argv)}
        try:
            completed = self.run_cmd(
                list(argv),
                capture_output=True,
                text=True,
                timeout=self.probe_timeout_s if timeout_s is None else timeout_s,
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
                "and compare boot wall time: the emulated run should take 5-30x as "
                "long. Two runs of comparable duration mean the -accel kvm run was "
                "emulating too and the hardware VM boundary is absent "
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

    def mint_sandbox_name(self, session_id: str) -> str:
        """A per-boot sandbox name: the session id, plus entropy this mints.

        The entropy is not decoration. The name is simultaneously the container
        name, the attribution token in the VMM's argv, the `/run/vc/vm/<id>`
        directory and the shim-kill pattern, so two live sandboxes whose names
        are prefixes of one another would cross-attribute. `sess-1` is a prefix
        of `sess-10`, and a caller-supplied session id is exactly the kind of
        value that produces such pairs — so the launcher never lets the caller's
        id be the whole address.
        """
        suffix = uuid.uuid4().hex[:10]
        stem = "".join(char if char.isalnum() else "-" for char in session_id)[:32].strip("-")
        return f"trellis-{stem}-{suffix}" if stem else f"trellis-{suffix}"

    def mint_cid(self) -> int:
        """The host-assigned session id for the next boot.

        Under the ratified VMM there is no kernel-supplied CID on the host side
        (INTERFACES section 3.1a) — this number is the host's own label, and its
        soundness rests entirely on the launcher issuing it once and binding it
        1:1 to one sandbox's socket path. Monotonic rather than random so a
        collision is impossible within a process rather than merely unlikely;
        `TrellisSandboxHost.open_session` remains the authority that refuses a
        CID already open, and a caller sharing one host across launchers gets
        that refusal rather than silent reuse.
        """
        value = self._cid_counter
        self._cid_counter += 1
        return value

    def _ensure_image(self) -> None:
        """Make the pinned image present in this launcher's namespace.

        **Measured 2026-07-25:** containerd image stores are per-namespace, so a
        launcher that moved off `default` sees none of what the provisioner
        pulled — `ctr -n <ns> run` fails with `image "...": not found`. Owning a
        namespace therefore means owning the pull, which is why the digest is a
        config value at all rather than living only in the provisioner.
        """
        listed = self._run(["ctr", "-n", self.namespace, "images", "ls", "-q"])
        if listed.get("error"):
            raise SandboxError(f"cannot list images in namespace {self.namespace}: {listed['error']}")
        if self.config_guest_image in (listed.get("stdout") or "").split():
            return

        reference = f"{self.config_guest_image}@{self.guest_image_digest}"
        pulled = self._run(
            ["ctr", "-n", self.namespace, "images", "pull", reference],
            timeout_s=self.boot_timeout_s,
        )
        if pulled.get("error") or pulled.get("returncode") != 0:
            raise SandboxError(
                f"could not pull {reference} into namespace {self.namespace}: "
                f"{pulled.get('error') or _clip(pulled.get('stderr'))}"
            )
        # Tag so the digest-pinned pull is reachable by the plain reference the
        # run command uses, mirroring what the provisioner does in `default`.
        tagged = self._run(
            ["ctr", "-n", self.namespace, "images", "tag", reference, self.config_guest_image]
        )
        if tagged.get("error"):
            raise SandboxError(f"could not tag {reference}: {tagged['error']}")

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

        name = self.mint_sandbox_name(session_id)
        handle = KataGuestHandle(
            config=self.config,
            sandbox_name=name,
            cid=self.mint_cid(),
            namespace=self.namespace,
            launcher=self,
            audit=self.audit,
        )

        # Every allocation is recorded on the handle at the instant it is made,
        # never after the sequence completes. `KataREPL.setup` assigns
        # `self._guest` only once `boot` has *returned*, so a boot that raises
        # partway leaves its caller with nothing to tear down — this method is
        # structurally the only code that can release what it allocated, and a
        # handle whose bookkeeping lags the host by even one step leaks exactly
        # the middle of the sequence.
        try:
            self._ensure_image()

            started = time.monotonic()
            run_result = self._run(
                [
                    "ctr", "-n", self.namespace, "run", "-d",
                    "--runtime", KATA_RUNTIME_HANDLER,
                    self.config_guest_image, name, "sleep", "infinity",
                ],
                timeout_s=self.boot_timeout_s,
            )
            elapsed = time.monotonic() - started
            if run_result.get("error") or run_result.get("returncode") != 0:
                raise SandboxError(
                    f"`ctr run` for sandbox {name} did not start it: "
                    f"{run_result.get('error') or _clip(run_result.get('stderr'))}"
                )
            # containerd registered the task, so the name is taken from here on
            # whatever happens next.
            handle.container_created = True

            # The refusal (BUILD_PLAN section 5.6 item 4). `ctr run -d` returning
            # 0 means the shim accepted the task, which is not the same fact as a
            # VMM existing. Measured on the reference host 2026-07-25: by the
            # time `ctr run -d` returns, the VMM and its vsock socket are already
            # present — the first poll 15 ms later found both. So an absent VMM
            # here is not "not booted yet", it is "never booted", and waiting
            # would only convert a clean refusal into a timeout.
            pids = vmm_pids_carrying(name)
            if not pids:
                raise SandboxError(
                    f"`ctr run` for sandbox {name} exited 0 after {elapsed:.1f}s but no "
                    f"{CLOUD_HYPERVISOR_BIN} process carries that name: containerd "
                    "reported success without creating a VM, so there is no boundary "
                    "to hand back"
                )
            handle.vmm_pids = tuple(pids)
            handle.uds_path = discover_vsock_uds(pids[0])
            handle.install_package()
            return handle
        except BaseException:
            handle.shutdown()
            raise


class KataGuestHandle:
    """One live Kata sandbox, from the host's side.

    Holds every allocation `KataLauncher.boot` made, and is the only object that
    can release them: `KataREPL.setup` assigns its `_guest` after `boot` returns,
    so a boot that fails partway has no caller able to tear it down.

    The four-call order is the backend's (`GuestHandle`), and `install_scaffold`
    is the call that brings the guest process into existence — the same shape
    `InProcessGuest.install_scaffold` already has, where constructing the
    supervisor and starting it serving happen there rather than at boot. That is
    forced rather than chosen: `GuestSupervisor` takes its scaffold and its
    reserved-name pins as constructor arguments, so the payload must be complete
    on disk before the guest's Python starts, and the scaffold is not known until
    the backend materialises it for this CID.
    """

    def __init__(
        self,
        config: SandboxConfig,
        sandbox_name: str,
        cid: int,
        namespace: str,
        launcher: "KataLauncher",
        audit: AuditLog | None = None,
    ) -> None:
        self.config = config
        self.sandbox_name = sandbox_name
        self.cid = cid
        self.namespace = namespace
        self.audit = audit
        self._launcher = launcher
        #: Set the instant `ctr run -d` returns 0 — before anything is checked
        #: about whether a VM exists — because from that moment containerd holds
        #: a record under this name that teardown must remove.
        self.container_created = False
        self.vmm_pids: tuple[int, ...] = ()
        self.uds_path: str | None = None
        self.package_installed = False
        self.serving = False
        self._control_conn: Connection | None = None

    # -- setup steps -------------------------------------------------------

    def start_bridge(self) -> None:
        """Refuses, and names precisely what is unresolved.

        A launcher cannot honestly implement this step today, and a no-op would
        be the worst available answer: `KataREPL.setup` calls it as "the bridge,
        before any untrusted worker process", so a silent pass asserts a bridge
        exists when nothing has been brought up.

        What is settled: the guest needs no loopback-to-vsock forwarder. The
        forwarder of INTERFACES section 3.3 exists to carry an in-guest rlms
        client's `AF_INET` traffic, and there is no rlms in the guest — the
        materialised stubs dial `AF_VSOCK` directly (`guest_main.build_rpc_hook`).

        What is **not** settled, and is not this module's to decide: who stands
        up a session's `LM_PORT`/`DB_PORT` listeners. `kata_repl.py`'s own step-2
        comment assigns that to the LM handler and the broker and calls the CID
        binding "the backend's whole part in bringing those two channels up",
        while no code anywhere binds a `HybridVsockListener` outside tests and
        the probes. `KataLauncher` takes no host to serve them against, and
        `GuestHandle` has no member for them. Guessing here would install a
        composition decision the record does not make.
        """
        raise SandboxError(
            f"sandbox {self.sandbox_name} booted, but the host-side LM/DB listener "
            "composition is unresolved: no code joins a launched guest to a "
            "TrellisSandboxHost, and KataLauncher takes none. The guest needs no "
            "in-guest forwarder (there is no rlms in the guest), so this step is "
            "not the forwarder INTERFACES section 3.3 describes; what it needs is "
            "an owner for the per-sandbox LM_PORT/DB_PORT listeners. Refusing "
            "rather than passing silently, because setup() treats this call as "
            "the bridge being up."
        )

    def install_package(self) -> None:
        """Ship `repl_sandbox` into the guest. Called by `boot`, not by the backend."""
        payload = _package_tarball()
        self._put_bytes(payload, f"{GUEST_ROOT}/repl_sandbox.tgz")
        self._exec(
            f"cd {GUEST_ROOT} && tar xzf repl_sandbox.tgz && rm -f repl_sandbox.tgz",
            exec_id="unpack",
        )
        self.package_installed = True

    def install_scaffold(self, stub_source: str) -> None:
        """Place the startup payload and start the guest supervisor serving."""
        raise SandboxError(
            "unreachable until start_bridge's composition is resolved; the guest "
            "process would come up with no host listener to dial"
        )

    def control(self) -> Connection:
        """Open the persistent control connection to the guest supervisor."""
        if not self.serving:
            raise SandboxError("the guest is not serving yet; install the scaffold first")
        raise SandboxError("unreachable until install_scaffold is reachable")

    # -- teardown ----------------------------------------------------------

    def shutdown(self) -> None:
        """Release everything this handle holds, and report what survived.

        Bounded and swallowing per step, like the probes' `destroy` — `ctr`
        blocks indefinitely against a shim that has stopped answering, and a
        `TimeoutExpired` escaping here would mask the failure that caused it.
        Unlike the probes, this **re-checks reality afterwards and raises** if
        something survived: a probe compensates for a total-swallow teardown with
        its own separate verification pass, and a launcher has no such pass —
        its caller records one audit line and moves on, so a `shutdown` that
        absorbed everything would make that line unreachable even when a VMM is
        still running.
        """
        errors: list[str] = []

        if self._control_conn is not None:
            try:
                self._control_conn.close()
            except OSError:
                pass
            self._control_conn = None

        if self.container_created:
            for argv in (
                ["ctr", "-n", self.namespace, "task", "kill", "-s", "SIGKILL", "-a", self.sandbox_name],
                ["ctr", "-n", self.namespace, "task", "delete", "-f", self.sandbox_name],
                ["ctr", "-n", self.namespace, "container", "delete", self.sandbox_name],
            ):
                observed = self._launcher._run(argv, timeout_s=30.0)
                if observed.get("error") and "timed out" in str(observed["error"]):
                    self._kill_shim()
                    self._launcher._run(argv, timeout_s=30.0)

            survivors = vmm_pids_carrying(self.sandbox_name)
            if survivors:
                errors.append(
                    f"{CLOUD_HYPERVISOR_BIN} pids {survivors} still carry {self.sandbox_name} "
                    "after teardown"
                )
            self.container_created = False

        self._audit("shutdown", errors=errors)
        if errors:
            raise SandboxError("; ".join(errors))

    def _kill_shim(self) -> None:
        """SIGKILL this sandbox's Kata shim so a wedged `ctr` call can complete."""
        found = self._launcher._run(
            ["pgrep", "-f", f"containerd-shim-kata-v2.*{self.sandbox_name}"], timeout_s=15.0
        )
        for token in (found.get("stdout") or "").split():
            try:
                os.kill(int(token), 9)
            except (ValueError, ProcessLookupError, PermissionError, OSError):
                continue
        time.sleep(1.0)

    # -- internals ---------------------------------------------------------

    def _exec(self, script: str, *, exec_id: str, timeout_s: float = 120.0) -> str:
        observed = self._launcher._run(
            [
                "ctr", "-n", self.namespace, "task", "exec",
                "--exec-id", exec_id, self.sandbox_name, "sh", "-c", script,
            ],
            timeout_s=timeout_s,
        )
        if observed.get("error") or observed.get("returncode") != 0:
            raise SandboxError(
                f"guest exec {exec_id!r} in {self.sandbox_name} failed: "
                f"{observed.get('error') or _clip(observed.get('stderr'))}"
            )
        return observed.get("stdout") or ""

    def _put_bytes(self, raw: bytes, dest: str) -> None:
        """Write bytes into the guest in argv-sized chunks."""
        encoded = base64.b64encode(raw).decode("ascii")
        self._exec(f"mkdir -p {GUEST_ROOT} && : > {dest}.b64", exec_id=f"put-init-{uuid.uuid4().hex[:6]}")
        for index in range(0, len(encoded), EXEC_CHUNK_BYTES):
            chunk = encoded[index : index + EXEC_CHUNK_BYTES]
            self._exec(f"printf %s {chunk} >> {dest}.b64", exec_id=f"put-{index}-{uuid.uuid4().hex[:6]}")
        self._exec(f"base64 -d {dest}.b64 > {dest} && rm -f {dest}.b64", exec_id=f"put-fin-{uuid.uuid4().hex[:6]}")

    def _audit(self, event: str, **fields: object) -> None:
        if self.audit is not None:
            self.audit.record(self.cid, f"guest.{event}", **fields)


def _package_tarball() -> bytes:
    """`repl_sandbox` as a gzipped tar, tests and caches excluded.

    The guest runs the same source the host does. Tests are excluded because
    they run host-side and would otherwise ship the very literals the host is
    the authority for.
    """
    package = os.path.dirname(os.path.abspath(__file__))
    source_root = os.path.dirname(package)
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        for root, dirs, files in os.walk(package):
            dirs[:] = [d for d in dirs if d not in ("__pycache__", "tests")]
            for name in sorted(files):
                if not name.endswith(".py"):
                    continue
                path = os.path.join(root, name)
                tar.add(path, arcname=os.path.relpath(path, source_root))
    return buffer.getvalue()


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
        reserved_names: frozenset[str] | None = None,
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
        #: The rlms reserved names, handed to the supervisor at construction.
        #: They travel with the scaffold rather than over the control port
        #: because the pins are taken in `GuestSupervisor.__init__` — an op
        #: arriving later would find them already built (BUILD_PLAN section 5.6,
        #: settled by S6).
        #:
        #: Defaulting to the pinned package is correct *here* and would be wrong
        #: in the supervisor. This double runs in the host interpreter, where
        #: rlms is installed, so the default is the genuine value rather than a
        #: guess. The import is function-local because this module must stay
        #: importable in a guest that has no rlms (the same reason `cli.py`
        #: defers its `kata_repl` import).
        if reserved_names is None:
            from rlm.environments.base_env import RESERVED_TOOL_NAMES

            reserved_names = RESERVED_TOOL_NAMES
        self.reserved_names = reserved_names

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
            reserved_names=self.reserved_names,
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
        *,
        reserved_names: frozenset[str],
    ) -> None:
        self.config = config
        self.cid = cid
        self.audit = audit
        self._base_stub_source = base_stub_source
        #: Handed to the supervisor at construction. See `InProcessLauncher`.
        self._reserved_names = reserved_names
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
            self.config,
            stub_source=source,
            rpc_hook=self._rpc_hook,
            reserved_names=self._reserved_names,
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
