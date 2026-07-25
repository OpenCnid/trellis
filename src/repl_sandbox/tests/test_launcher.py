"""Gate G1 and the two launchers.

BUILD_PLAN section 4 (Host provisioning gate (G1 — SPEC section 8 gate 1)) makes
`kata-runtime check` plus a real-acceleration measurement the exit condition for
the gate, and ARCHITECTURE section 7 requirement 3 makes the two version pins
separate upstreams. Everything below drives those conditions through injected
probes: no `kata-runtime`, `qemu`, or `ctr` process is ever started here, and the
only real probe exercised is the read-only `os.stat` of a device node.

The pin tests carry the trap deliberately: a gate that checks one pin twice, or
checks each version against the other's minimum, passes a host it should refuse.
"""

from __future__ import annotations

import os
import subprocess

import pytest

from repl_sandbox.config import SandboxConfig
from repl_sandbox.errors import SandboxError
from repl_sandbox.launcher import (
    ACCELERATION_COMMAND_KVM,
    ACCELERATION_COMMAND_TCG,
    MIN_ACCELERATION_RATIO,
    GuestHandle,
    InProcessLauncher,
    KataLauncher,
    PreflightResult,
    _benchmark_argv,
    probe_kvm_device,
    qemu_accel_benchmark,
)

# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------

GOOD_PROBES: dict[str, tuple[int, str, str]] = {
    "kata-runtime check": (0, "System is capable of running Kata Containers\n", ""),
    "kata-runtime --version": (0, "kata-runtime  : 3.31.0\n   commit   : 0f1e2d3\n", ""),
    "cloud-hypervisor --version": (0, "cloud-hypervisor v52.0.0\n", ""),
}


def fake_run_cmd(responses: dict[str, object]):
    """A `subprocess.run` stand-in keyed by the command line.

    Unknown commands are an assertion failure rather than a default, so a test
    cannot pass because the gate quietly probed something else.
    """
    calls: list[list[str]] = []

    def run_cmd(argv, capture_output=False, text=False, timeout=None):
        calls.append(list(argv))
        key = " ".join(argv)
        outcome = responses.get(key)
        if outcome is None:
            raise AssertionError(f"unexpected probe command: {key}")
        if isinstance(outcome, BaseException):
            raise outcome
        returncode, stdout, stderr = outcome
        return subprocess.CompletedProcess(list(argv), returncode, stdout, stderr)

    run_cmd.calls = calls  # type: ignore[attr-defined]
    return run_cmd


def kvm_present() -> dict:
    return {
        "path": "/dev/kvm",
        "present": True,
        "char_device": True,
        "readable": True,
        "writable": True,
    }


def near_native() -> dict:
    # The ratio is `tcg_seconds / kvm_seconds`, so an accelerated host reports a
    # LARGE one - the emulated side is the slow side. A fixture reading ~1.0
    # here would encode the fallback signature while claiming to be the healthy
    # case, and teach the inversion to whoever reads it next.
    return {"near_native": True, "kvm_seconds": 0.9, "tcg_seconds": 11.2, "ratio": 12.4}


def launcher(
    *,
    probes: dict[str, object] | None = None,
    kvm: dict | None = None,
    accel=near_native,
    config: SandboxConfig | None = None,
) -> KataLauncher:
    """A `KataLauncher` whose every probe is injected."""
    return KataLauncher(
        config or SandboxConfig(),
        fake_run_cmd(dict(GOOD_PROBES) | (probes or {})),
        kvm_probe=(lambda: dict(kvm or kvm_present())),
        accel_benchmark=accel,
    )


def only(failures: tuple[str, ...]) -> str:
    """Assert exactly one failure and return it."""
    assert len(failures) == 1, failures
    return failures[0]


# ---------------------------------------------------------------------------
# The device probe
# ---------------------------------------------------------------------------


def test_probe_kvm_device_reports_absence_without_raising() -> None:
    observed = probe_kvm_device(os.path.join("does", "not", "exist", "kvm"))
    assert observed["present"] is False
    assert observed["char_device"] is False
    assert "error" in observed


def test_probe_kvm_device_reports_a_regular_file_as_not_a_character_device(tmp_path) -> None:
    """A path that exists is not thereby a KVM device node."""
    decoy = tmp_path / "kvm"
    decoy.write_bytes(b"")
    observed = probe_kvm_device(str(decoy))
    assert observed["present"] is True
    assert observed["char_device"] is False
    assert observed["readable"] is True


# ---------------------------------------------------------------------------
# PASS
# ---------------------------------------------------------------------------


def test_preflight_passes_when_every_condition_is_met() -> None:
    result = launcher().preflight()
    assert result.ok is True
    assert result.failures == ()
    assert result.report() == "G1 PASS"
    assert result.observed["kata_check"]["returncode"] == 0
    assert result.observed["acceleration"]["measured"] is True


def test_preflight_reads_each_version_from_its_own_binary() -> None:
    """The observation records which command produced which version.

    This is the structural half of the split-pin requirement: a gate that read
    one binary and compared it to both minimums would look identical from the
    verdict alone.
    """
    observed = launcher().preflight().observed
    assert observed["kata_version"]["argv"] == ["kata-runtime", "--version"]
    assert observed["cloud_hypervisor_version"]["argv"] == ["cloud-hypervisor", "--version"]
    assert "3.31.0" in observed["kata_version"]["version_text"]
    assert "52.0.0" in observed["cloud_hypervisor_version"]["version_text"]


# ---------------------------------------------------------------------------
# FAIL — one condition at a time
# ---------------------------------------------------------------------------


def test_missing_kvm_device_fails_the_gate() -> None:
    result = launcher(kvm={"path": "/dev/kvm", "present": False, "error": "FileNotFoundError"}).preflight()
    assert result.ok is False
    assert "/dev/kvm is not present" in only(result.failures)
    assert result.report().startswith("G1 FAIL")


def test_kvm_device_that_is_not_a_character_device_fails_the_gate() -> None:
    kvm = kvm_present() | {"char_device": False}
    assert "not a character device" in only(launcher(kvm=kvm).preflight().failures)


def test_kvm_device_without_write_access_fails_the_gate() -> None:
    """The VMM opens it O_RDWR, so read-only access is not access."""
    kvm = kvm_present() | {"writable": False}
    assert "not readable and writable" in only(launcher(kvm=kvm).preflight().failures)


def test_kata_runtime_check_nonzero_exit_fails_the_gate() -> None:
    result = launcher(
        probes={"kata-runtime check": (1, "", "ERROR: /dev/kvm unusable\n")}
    ).preflight()
    failure = only(result.failures)
    assert "`kata-runtime check` exited 1" in failure
    assert "/dev/kvm unusable" in failure


def test_missing_kata_binary_fails_both_the_check_and_the_version() -> None:
    """One missing binary, two unmet conditions, both reported."""
    missing = FileNotFoundError(2, "No such file or directory", "kata-runtime")
    result = launcher(
        probes={"kata-runtime check": missing, "kata-runtime --version": missing}
    ).preflight()
    assert len(result.failures) == 2
    assert any("check` did not run" in failure for failure in result.failures)
    assert any("could not determine the kata-runtime version" in failure for failure in result.failures)


def test_probe_timeout_is_a_failure_not_a_pass() -> None:
    timeout = subprocess.TimeoutExpired(["kata-runtime", "check"], 60.0)
    result = launcher(probes={"kata-runtime check": timeout}).preflight()
    assert "timed out" in only(result.failures)


def test_unparseable_version_output_fails_rather_than_defaulting() -> None:
    result = launcher(
        probes={"cloud-hypervisor --version": (0, "cloud-hypervisor (unknown build)\n", "")}
    ).preflight()
    assert "could not determine the cloud-hypervisor version" in only(result.failures)


# ---------------------------------------------------------------------------
# The two pins, and the trap of treating one as the other
# ---------------------------------------------------------------------------


def test_kata_below_its_pin_fails_and_names_kata() -> None:
    result = launcher(probes={"kata-runtime --version": (0, "kata-runtime : 3.30.9\n", "")}).preflight()
    failure = only(result.failures)
    assert failure.startswith("kata ")
    assert "3.31.0" in failure


def test_cloud_hypervisor_below_its_pin_fails_and_names_cloud_hypervisor() -> None:
    result = launcher(probes={"cloud-hypervisor --version": (0, "cloud-hypervisor v51.9\n", "")}).preflight()
    failure = only(result.failures)
    assert failure.startswith("cloud-hypervisor ")
    assert "52.0" in failure


def test_the_kata_pin_is_not_applied_to_cloud_hypervisor() -> None:
    """A host running Cloud Hypervisor 3.31.0 must FAIL.

    3.31.0 clears the Kata minimum, so a gate holding one pin for both upstreams
    passes this host. Cloud Hypervisor 3.31.0 is nine major versions below its
    own pin and carries the CVEs the pin exists to close.
    """
    result = launcher(
        probes={"cloud-hypervisor --version": (0, "cloud-hypervisor v3.31.0\n", "")}
    ).preflight()
    assert result.ok is False
    failure = only(result.failures)
    assert failure.startswith("cloud-hypervisor ")


def test_the_cloud_hypervisor_pin_is_not_applied_to_kata() -> None:
    """The mirror image: Kata 3.31.0 must PASS, not fail against `>= 52.0`."""
    result = launcher().preflight()
    assert result.ok is True
    assert not any("kata" in failure for failure in result.failures)


def test_both_pins_can_fail_independently() -> None:
    result = launcher(
        probes={
            "kata-runtime --version": (0, "kata-runtime : 3.0.0\n", ""),
            "cloud-hypervisor --version": (0, "cloud-hypervisor v40.0\n", ""),
        }
    ).preflight()
    assert len(result.failures) == 2
    assert result.failures[0].startswith("kata ")
    assert result.failures[1].startswith("cloud-hypervisor ")


# ---------------------------------------------------------------------------
# Acceleration
# ---------------------------------------------------------------------------


def test_an_unmeasured_acceleration_check_is_a_failure_with_the_operator_command() -> None:
    """No benchmark means no verdict, and no verdict is not a pass."""
    result = launcher(accel=None).preflight()
    failure = only(result.failures)
    assert "acceleration is unmeasured" in failure
    assert ACCELERATION_COMMAND_KVM in failure
    assert ACCELERATION_COMMAND_TCG in failure
    assert result.observed["acceleration"]["measured"] is False


def test_a_benchmark_reporting_emulation_fails_the_gate() -> None:
    result = launcher(accel=lambda: {"near_native": False, "ratio": 18.0}).preflight()
    assert "did not report near-native" in only(result.failures)


def test_a_benchmark_that_raises_fails_the_gate() -> None:
    def explode() -> dict:
        raise RuntimeError("qemu not installed")

    assert "raised RuntimeError" in only(launcher(accel=explode).preflight().failures)


@pytest.mark.parametrize("value", ["yes", 1, None, {"near_native": "true"}])
def test_the_acceleration_flag_is_fail_closed(value: object) -> None:
    """Only an explicit `True` counts. A truthy string is not a measurement."""
    assert launcher(accel=lambda: {"near_native": value}).preflight().ok is False


def test_a_malformed_benchmark_result_fails_the_gate() -> None:
    assert "not a result mapping" in only(launcher(accel=lambda: "fast").preflight().failures)


# ---------------------------------------------------------------------------
# boot
# ---------------------------------------------------------------------------


def test_boot_refuses_on_this_host_and_names_what_was_missing() -> None:
    """The real KVM probe runs; the binaries are faked as absent.

    On the Windows development host `/dev/kvm` does not exist, which is the
    condition the message must name. On a Linux host with a device node the
    other conditions still fail, and the assertion follows the probe rather than
    assuming the platform.
    """
    missing = FileNotFoundError(2, "No such file or directory", "kata-runtime")
    never_run = fake_run_cmd(
        {
            "kata-runtime check": missing,
            "kata-runtime --version": missing,
            "cloud-hypervisor --version": FileNotFoundError(
                2, "No such file or directory", "cloud-hypervisor"
            ),
        }
    )
    gate = KataLauncher(SandboxConfig(), never_run)

    with pytest.raises(SandboxError) as raised:
        gate.boot("session-1")

    message = str(raised.value)
    assert "host provisioning gate (G1) failed" in message
    observed = gate.preflight().observed
    if not observed["kvm"]["present"]:
        assert "/dev/kvm is not present" in message
    assert "acceleration is unmeasured" in message


def test_boot_gates_before_it_launches() -> None:
    """The gate runs to completion before the launch path is touched at all.

    A launcher that started a VM before gating would build a sandbox on a host
    with no KVM, so this asserts the order directly rather than inferring it
    from whatever `boot` raises: every G1 probe must have run, and the first
    command after them is the image check that opens the launch path.
    """
    sentinel = RuntimeError("launch path reached")
    responses = dict(GOOD_PROBES)
    responses["ctr -n trellis images ls -q"] = sentinel
    run_cmd = fake_run_cmd(responses)

    with pytest.raises(RuntimeError) as raised:
        KataLauncher(
            SandboxConfig(),
            run_cmd,
            kvm_probe=kvm_present,
            accel_benchmark=near_native,
        ).boot("session-1")
    assert raised.value is sentinel

    issued = [" ".join(call) for call in run_cmd.calls]
    for probe in GOOD_PROBES:
        assert probe in issued, f"the gate did not run {probe!r} before launching"
        assert issued.index(probe) < issued.index("ctr -n trellis images ls -q")


def test_boot_refuses_when_containerd_reports_success_without_a_vm() -> None:
    """`ctr run` exiting 0 is not the same fact as a VM existing.

    The shim can accept and register a task without Cloud Hypervisor ever
    starting, and a launcher that trusted the exit code would hand back a handle
    backed by nothing -- indistinguishable from a working one until the first
    exec, by which time it has already been counted as a boundary.
    """
    responses = dict(GOOD_PROBES)
    responses["ctr -n trellis images ls -q"] = (0, "docker.io/library/python:3.12-slim\n", "")
    launched: list[str] = []

    def run_cmd(argv, capture_output=False, text=False, timeout=None):
        key = " ".join(argv)
        if key.startswith("ctr -n trellis run -d"):
            launched.append(key)
            return subprocess.CompletedProcess(list(argv), 0, "", "")
        if key.startswith("ctr -n trellis task") or key.startswith("ctr -n trellis container"):
            return subprocess.CompletedProcess(list(argv), 0, "", "")
        if key.startswith("pgrep"):
            return subprocess.CompletedProcess(list(argv), 1, "", "")
        outcome = responses.get(key)
        if outcome is None:
            raise AssertionError(f"unexpected command: {key}")
        returncode, stdout, stderr = outcome
        return subprocess.CompletedProcess(list(argv), returncode, stdout, stderr)

    built = KataLauncher(
        SandboxConfig(),
        run_cmd,
        kvm_probe=kvm_present,
        accel_benchmark=near_native,
    )
    # No VMM will ever be found: this test runs on a host with no Kata sandbox,
    # so the /proc walk legitimately returns nothing for the minted name.
    with pytest.raises(SandboxError) as raised:
        built.boot("session-1")

    assert launched, "the test never reached `ctr run`, so it proves nothing about the refusal"
    message = str(raised.value)
    assert "exited 0" in message
    assert "without creating a VM" in message


def test_boot_refuses_an_empty_session_id() -> None:
    with pytest.raises(SandboxError):
        launcher().boot("")


# ---------------------------------------------------------------------------
# The test double
# ---------------------------------------------------------------------------


def test_the_in_process_launcher_can_never_pass_the_provisioning_gate() -> None:
    """A caller that gates on G1 cannot reach this launcher's guest."""
    result = InProcessLauncher(SandboxConfig()).preflight()
    assert isinstance(result, PreflightResult)
    assert result.ok is False
    assert "test double" in only(result.failures)


def test_the_in_process_launcher_says_what_it_is_in_its_first_line() -> None:
    first_line = (InProcessLauncher.__doc__ or "").strip().splitlines()[0]
    assert "no isolation" in first_line
    assert "test double" in first_line.lower()
    assert "Never select it to deploy" in first_line


def test_the_in_process_guest_satisfies_the_guest_handle_protocol() -> None:
    guest = InProcessLauncher(SandboxConfig()).boot("session-1")
    try:
        assert isinstance(guest, GuestHandle)
        # Above the reserved vsock CIDs, so it passes the same range checks a
        # kernel-assigned CID does.
        assert guest.cid >= 3
    finally:
        guest.shutdown()


def test_the_in_process_guest_refuses_a_control_channel_before_the_scaffold() -> None:
    """A channel served by a supervisor that does not exist would just hang."""
    guest = InProcessLauncher(SandboxConfig()).boot("session-1")
    try:
        with pytest.raises(SandboxError):
            guest.control()
    finally:
        guest.shutdown()


def test_the_in_process_guest_refuses_a_second_scaffold() -> None:
    guest = InProcessLauncher(SandboxConfig()).boot("session-1")
    try:
        guest.install_scaffold("")
        with pytest.raises(SandboxError):
            guest.install_scaffold("")
    finally:
        guest.shutdown()


def test_in_process_guest_shutdown_is_idempotent() -> None:
    """Teardown runs from failure paths; a second call must not raise."""
    guest = InProcessLauncher(SandboxConfig()).boot("session-1")
    guest.install_scaffold("")
    guest.shutdown()
    guest.shutdown()


# ---------------------------------------------------------------------------
# The real acceleration benchmark (BUILD_PLAN section 4)
#
# The benchmark is the one probe that turns G1 from a three-of-four report into
# a gate that can actually pass, so its failure modes matter more than its
# success. The condition it exists to catch is a *silent fallback*: QEMU running
# the `-accel kvm` side under emulation anyway, which looks like a healthy boot
# and reports nothing. Its only signature is that emulating the guest workload
# costs about what accelerating it did.
#
# The measurement is differential - each accelerator boots twice, bare and with
# an initrd workload, and the *differences* are compared - because QEMU's fixed
# startup cost is not accelerated and would otherwise sit in both halves of the
# quotient and bias it toward 1. Every test below therefore drives five boots
# per trial: one refusal probe, then bare/loaded on each side.
# ---------------------------------------------------------------------------


def fake_clock(*durations: float):
    """A `perf_counter` stand-in that makes each timed boot take a set duration.

    `qemu_accel_benchmark` reads the clock twice per boot, so each duration is
    served as a (start, end) pair. Injecting time keeps the test honest about
    what it measures: the differential arithmetic and the thresholding, never
    the machine the suite happens to run on.
    """
    ticks: list[float] = []
    now = 0.0
    for duration in durations:
        ticks.extend([now, now + duration])
        now += duration + 1.0
    return iter(ticks).__next__


def boot_durations(kvm_bare, kvm_loaded, tcg_bare, tcg_loaded, *, probe=1.0):
    """Durations in the order one trial's boots actually happen."""
    return fake_clock(probe, kvm_bare, kvm_loaded, tcg_bare, tcg_loaded)


def qemu_responses(kernel: str, initrd: str, *, kvm=(0, "", ""), tcg=(0, "", "")) -> dict:
    """Keyed responses for all four boot shapes."""
    return {
        " ".join(_benchmark_argv("kvm", kernel)): kvm,
        " ".join(_benchmark_argv("kvm", kernel, initrd)): kvm,
        " ".join(_benchmark_argv("tcg", kernel)): tcg,
        " ".join(_benchmark_argv("tcg", kernel, initrd)): tcg,
    }


@pytest.fixture
def kernel(tmp_path) -> str:
    """A stand-in for `/boot/vmlinuz-*`. Never booted - only stat'd and passed."""
    path = tmp_path / "vmlinuz-test"
    path.write_bytes(b"\x00")
    return str(path)


@pytest.fixture
def initrd(tmp_path) -> str:
    """A stand-in for `/boot/initrd.img-*`."""
    path = tmp_path / "initrd.img-test"
    path.write_bytes(b"\x00")
    return str(path)


def bench(kernel: str, initrd: str, clock, *, responses=None, **kwargs) -> dict:
    """Drive the benchmark with every clock and subprocess injected."""
    return qemu_accel_benchmark(
        kernel,
        initrd,
        run_cmd=fake_run_cmd(
            responses if responses is not None else qemu_responses(kernel, initrd)
        ),
        clock=clock,
        trials=kwargs.pop("trials", 1),
        **kwargs,
    )


def test_an_accelerated_workload_separates_by_an_order_of_magnitude(kernel, initrd) -> None:
    """The healthy case: emulating the workload costs 10x what KVM charged."""
    observed = bench(kernel, initrd, boot_durations(1.0, 1.2, 3.0, 5.0))
    assert observed["kvm_workload_seconds"] == pytest.approx(0.2)
    assert observed["tcg_workload_seconds"] == pytest.approx(2.0)
    assert observed["ratio"] == pytest.approx(10.0)
    assert observed["near_native"] is True
    assert "hardware-accelerated" in observed["interpretation"]


def test_the_fixed_startup_cost_cancels_out(kernel, initrd) -> None:
    """The whole reason the measurement is differential.

    Both sides here carry a large, identical, unaccelerated startup cost. A
    total-time comparison would read (10+2)/(10+0.2) = 1.18x and fail a host
    whose workload is genuinely accelerated 10x. The subtraction removes it.
    """
    observed = bench(kernel, initrd, boot_durations(10.0, 10.2, 10.0, 12.0))
    assert observed["ratio"] == pytest.approx(10.0)
    assert observed["near_native"] is True


def test_comparable_workload_costs_are_the_silent_fallback_signature(kernel, initrd) -> None:
    """The condition the gate exists for: `-accel kvm` was emulating too.

    Every boot succeeds and QEMU reports nothing wrong. The only evidence is
    that the workload cost both sides about the same.
    """
    observed = bench(kernel, initrd, boot_durations(3.0, 4.9, 3.0, 5.0))
    assert observed["near_native"] is False
    assert "silent-fallback" in observed["interpretation"]


def test_the_ratio_floor_is_the_boundary_between_the_two(kernel, initrd) -> None:
    """Exactly at the floor passes; a hair under does not."""
    at_floor = bench(
        kernel, initrd, boot_durations(1.0, 2.0, 1.0, 1.0 + MIN_ACCELERATION_RATIO)
    )
    under = bench(
        kernel, initrd, boot_durations(1.0, 2.0, 1.0, 0.9 + MIN_ACCELERATION_RATIO)
    )
    assert at_floor["near_native"] is True
    assert under["near_native"] is False


def test_the_per_side_minimum_across_trials_is_what_counts(kernel, initrd) -> None:
    """Noise only ever adds time, so the fastest observation is the truest one.

    Trial 2's KVM side is contaminated by a slow neighbour (delta 1.0 rather
    than 0.2). Taking the minimum discards it; taking a mean would drag the
    ratio from 10x down to ~3.3x and fail a healthy host.
    """
    observed = bench(
        kernel,
        initrd,
        fake_clock(1.0, 1.0, 1.2, 3.0, 5.0, 1.0, 2.0, 3.0, 5.0),
        trials=2,
    )
    assert observed["kvm_deltas"] == [pytest.approx(0.2), pytest.approx(1.0)]
    assert observed["kvm_workload_seconds"] == pytest.approx(0.2)
    assert observed["ratio"] == pytest.approx(10.0)


def test_a_refused_kvm_accelerator_is_read_before_any_timing(kernel, initrd) -> None:
    """QEMU exits non-zero rather than downgrading, and that outranks the clock.

    Nothing else must run: the verdict is already known.
    """
    run_cmd = fake_run_cmd(
        qemu_responses(kernel, initrd, kvm=(1, "", "Could not access KVM kernel module"))
    )
    observed = qemu_accel_benchmark(
        kernel, initrd, run_cmd=run_cmd, clock=fake_clock(0.2), trials=1
    )
    assert "near_native" not in observed
    assert "KVM being unavailable, not slow" in observed["error"]
    assert [argv for argv in run_cmd.calls if "tcg" in argv] == []


def test_a_workload_that_does_not_register_is_not_a_measurement(kernel, initrd) -> None:
    """A zero delta means nothing was measured, however fast the boots looked."""
    observed = bench(kernel, initrd, boot_durations(1.0, 1.0, 3.0, 5.0))
    assert "near_native" not in observed
    assert "did not register as measurable work" in observed["error"]


def test_a_missing_kernel_is_a_measurement_that_did_not_happen(tmp_path, initrd) -> None:
    observed = qemu_accel_benchmark(str(tmp_path / "absent"), initrd)
    assert "near_native" not in observed
    assert "benchmark kernel" in observed["error"]
    assert "is not a file" in observed["error"]


def test_a_missing_initrd_is_reported_as_the_initrd(kernel, tmp_path) -> None:
    """Named separately: the operator fix differs from a missing kernel."""
    observed = qemu_accel_benchmark(kernel, str(tmp_path / "absent"))
    assert "near_native" not in observed
    assert "benchmark initrd" in observed["error"]


def test_a_missing_qemu_is_reported_as_itself(kernel, initrd) -> None:
    def run_cmd(argv, **kwargs):
        raise FileNotFoundError(2, "No such file or directory")

    observed = qemu_accel_benchmark(kernel, initrd, run_cmd=run_cmd)
    assert "near_native" not in observed
    assert "was not found on PATH" in observed["error"]


def test_a_tcg_timeout_leaves_acceleration_unproven(kernel, initrd) -> None:
    """No emulated baseline, no comparison - and unproven is never a pass."""
    responses = qemu_responses(kernel, initrd)
    responses[" ".join(_benchmark_argv("tcg", kernel))] = subprocess.TimeoutExpired(
        cmd="qemu", timeout=300.0
    )
    observed = bench(
        kernel, initrd, boot_durations(1.0, 1.2, 0.0, 0.0), responses=responses
    )
    assert "near_native" not in observed
    assert "stays unproven" in observed["error"]


def test_cpu_host_is_passed_only_to_the_kvm_side(kernel, initrd) -> None:
    """Asymmetric on purpose, in the direction that makes passing harder.

    `-cpu host` under TCG forces feature emulation and would slow that side,
    inflating the ratio toward a pass the host may not deserve.
    """
    kvm_argv = _benchmark_argv("kvm", kernel, initrd)
    tcg_argv = _benchmark_argv("tcg", kernel, initrd)
    assert "-cpu" in kvm_argv and "host" in kvm_argv
    assert "-cpu" not in tcg_argv
    # Identical in every other respect, or the two sides are not the same work.
    assert [a for a in kvm_argv if a not in ("-cpu", "host", "kvm")] == [
        a for a in tcg_argv if a != "tcg"
    ]


def test_both_sides_run_the_same_workload(kernel, initrd) -> None:
    """The initrd must appear on both accelerators, or the deltas differ in kind."""
    assert "-initrd" in _benchmark_argv("kvm", kernel, initrd)
    assert "-initrd" in _benchmark_argv("tcg", kernel, initrd)
    assert "-initrd" not in _benchmark_argv("kvm", kernel)


def test_the_benchmark_result_flows_through_the_gate(kernel, initrd) -> None:
    """End to end: a real benchmark mapping satisfies `preflight`'s condition."""
    result = launcher(
        accel=lambda: bench(kernel, initrd, boot_durations(1.0, 1.2, 3.0, 5.0))
    ).preflight()
    assert result.ok is True
    assert result.observed["acceleration"]["measured"] is True
    assert result.observed["acceleration"]["ratio"] == pytest.approx(10.0)


def test_an_unproven_benchmark_fails_the_gate_with_its_own_reason(tmp_path, initrd) -> None:
    """The error text reaches the operator rather than a generic refusal."""
    result = launcher(
        accel=lambda: qemu_accel_benchmark(str(tmp_path / "absent"), initrd)
    ).preflight()
    assert result.ok is False
    assert "is not a file" in only(result.failures)
