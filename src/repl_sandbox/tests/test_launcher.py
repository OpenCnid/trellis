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
    GuestHandle,
    InProcessLauncher,
    KataLauncher,
    PreflightResult,
    probe_kvm_device,
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
    return {"near_native": True, "kvm_boot_s": 0.9, "tcg_boot_s": 1.1, "ratio": 1.2}


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
    """With G1 satisfied the refusal changes: the unbuilt launch path is named.

    The order matters — a launcher that tried to start a VM before gating would
    reach the launch path on a host with no KVM.
    """
    with pytest.raises(NotImplementedError) as raised:
        launcher().boot("session-1")
    assert "not built" in str(raised.value)
    assert "No guest was claimed." in str(raised.value)


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
