"""Tests for the S5 probe's host-side logic and for `hardening` off Linux.

`scripts/repl_sandbox_s5_probe.py` runs only on the provisioned Kata host: it
installs a seccomp filter and a Landlock ruleset inside a real guest. Without
these tests it would be several hundred lines nobody on a development box ever
executes, and every mistake in its *verdict* logic would surface as a confusing
failure in the middle of a host run.

What is under test here:

* the six assessors that turn a guest report into a pass or a failure — each one
  driven with a report that should pass and at least one that must not;
* `hardening.build_seccomp_filter`, whose BPF program is pure computation and
  therefore fully checkable off-host: instruction count, the architecture gate,
  and that **every** denied syscall's jump lands on the `ERRNO` return. A filter
  whose jump offsets are wrong is a filter that denies the wrong calls, and on
  the host that reads as a mysteriously broken worker rather than as a bug here;
* `Tier0Report.processes_capped`, which is the conjunction that encodes the
  session's most expensive lesson — root is exempt from `RLIMIT_NPROC`, so a
  limit set without a privilege drop is a number with nothing behind it.

What this file deliberately does **not** test, because it cannot and pretending
otherwise is the failure mode the probe exists to avoid: that seccomp actually
blocks a syscall, that Landlock actually denies a write, that `RLIMIT_NPROC`
actually caps a fork, or that anything crosses a VM boundary. Those need the
host. They are the probe's claims, not this file's.
"""

from __future__ import annotations

import importlib.util
import struct
from pathlib import Path

import pytest

from repl_sandbox import hardening
from repl_sandbox.hardening import (
    AUDIT_ARCH_X86_64,
    DENIED_SYSCALLS,
    RLIM_INFINITY,
    Tier0Report,
    build_seccomp_filter,
    fs_access_for_abi,
)

PROBE_PATH = Path(__file__).resolve().parents[3] / "scripts" / "repl_sandbox_s5_probe.py"


def _load_probe():
    """Import the probe by path — it is a script, not a package module."""
    spec = importlib.util.spec_from_file_location("repl_sandbox_s5_probe", PROBE_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


probe = _load_probe()


# ---------------------------------------------------------------------------
# A guest report that should pass every assessor
# ---------------------------------------------------------------------------


def good_report() -> dict:
    """The shape a healthy hardened run produces."""
    return {
        "environment": {
            "cgroupfs_mounted": False,
            "cgroup_self": "0::/",
            "landlock_abi": 7,
            "kernel": "6.18.35",
            "cap_effective": "00000000a80425fb",
        },
        "baseline": {
            "write": {"wrote": True},
            "read": {"read": True},
            "syscall": {"rc": 0, "errno": 0},
            "fork": {"forked": 200, "refused_at": None, "capped": False},
            "uid": 0,
        },
        "hardened": {
            "tier0": {
                "steps": ["landlock", "privilege_drop", "rlimits", "no_new_privs", "seccomp"],
                "failures": [],
                "uid": 65534,
                "seccomp_mode": 2,
                "seccomp_filters": 1,
                "no_new_privs": 1,
                "landlock_rules": 7,
                "processes_capped": True,
            },
            "write": {"wrote": False, "errno": 13},
            "read": {"read": True},
            "syscall": {"rc": -1, "errno": 1},
            "fork": {"forked": 23, "refused_at": 23, "capped": True},
            "tools": {"regex": True, "stdlib": True},
            "lm": {"ok": True, "text": "answer", "crossed": True},
            "db": {"ok": True, "rows": [[1, "alpha", 10], [2, "beta", 20], [3, "gamma", 30]]},
            "uid": 65534,
        },
        "harden_requested": True,
    }


# ---------------------------------------------------------------------------
# Claim 1 — the positive control
# ---------------------------------------------------------------------------


def test_baseline_passes_when_the_unhardened_arm_is_dangerous():
    failures: list[str] = []
    record = probe.assess_baseline(good_report(), failures)
    assert failures == []
    assert record["write_succeeded"] and record["syscall_permitted"] and record["fork_uncapped"]


@pytest.mark.parametrize(
    "path, value, expected",
    [
        (("baseline", "write", "wrote"), False, "Landlock"),
        (("baseline", "syscall", "rc"), -1, "seccomp"),
        (("baseline", "fork", "capped"), True, "RLIMIT_NPROC"),
    ],
)
def test_baseline_fails_when_a_control_was_already_closed(path, value, expected):
    """A baseline that is already safe makes the hardened arm prove nothing.

    This is the assessor that keeps the whole spike honest, so each of the three
    is checked to fail independently — a guest image that mounted `/var/tmp`
    read-only would silence only the write half, and the run would still be
    worthless for Landlock while looking fine for seccomp.
    """
    report = good_report()
    node = report
    for key in path[:-1]:
        node = node[key]
    node[path[-1]] = value

    failures: list[str] = []
    probe.assess_baseline(report, failures)
    assert len(failures) == 1
    assert expected in failures[0]


# ---------------------------------------------------------------------------
# Claim 2 — the cgroup finding, re-derived
# ---------------------------------------------------------------------------


def test_cgroup_finding_reports_the_measured_absence_without_failing():
    failures: list[str] = []
    record = probe.assess_cgroup_finding(good_report(), failures)
    assert failures == []
    assert record["cgroupfs_mounted"] is False
    assert "setrlimit" in record["note"]


def test_cgroup_finding_flags_a_host_that_contradicts_the_record():
    """A mounted cgroupfs is news about the record, not a broken probe.

    It must not fail the run — the design record's claim is about this stack, and
    a host that behaves differently is a reason to revisit the record rather than
    a reason to call the run bad.
    """
    report = good_report()
    report["environment"]["cgroupfs_mounted"] = True
    failures: list[str] = []
    record = probe.assess_cgroup_finding(report, failures)
    assert failures == []
    assert "needs revisiting" in record["note"]


# ---------------------------------------------------------------------------
# Tier-0 read-back, separate from behaviour
# ---------------------------------------------------------------------------


def test_tier0_applied_passes_on_a_clean_report():
    failures: list[str] = []
    probe.assess_tier0_applied(good_report(), failures)
    assert failures == []


def test_tier0_applied_rejects_a_worker_still_running_as_root():
    report = good_report()
    report["hardened"]["tier0"]["uid"] = 0
    failures: list[str] = []
    probe.assess_tier0_applied(report, failures)
    assert any("exempt from RLIMIT_NPROC" in item for item in failures)


def test_tier0_applied_rejects_a_seccomp_call_that_installed_nothing():
    """`seccomp()` returning 0 and a filter being installed are different claims."""
    report = good_report()
    report["hardened"]["tier0"]["seccomp_mode"] = 0
    failures: list[str] = []
    probe.assess_tier0_applied(report, failures)
    assert any("not 2" in item for item in failures)


def test_tier0_applied_rejects_a_ruleset_that_granted_nothing():
    report = good_report()
    report["hardened"]["tier0"]["landlock_rules"] = 0
    failures: list[str] = []
    probe.assess_tier0_applied(report, failures)
    assert any("grants nothing" in item for item in failures)


# ---------------------------------------------------------------------------
# Claims 3–5 — enforcement observed
# ---------------------------------------------------------------------------


def test_enforcement_passes_on_a_clean_report():
    failures: list[str] = []
    record = probe.assess_enforcement(good_report(), failures)
    assert failures == []
    assert record["fork_capped"] and record["syscall_denied"] and record["write_denied"]


def test_enforcement_rejects_an_uncapped_fork_bomb():
    report = good_report()
    report["hardened"]["fork"] = {"forked": 200, "refused_at": None, "capped": False}
    failures: list[str] = []
    probe.assess_enforcement(report, failures)
    assert any("NOT capped" in item for item in failures)


def test_enforcement_rejects_a_cap_above_the_limit_that_was_set():
    """Capped at the wrong number means something else is doing the capping."""
    report = good_report()
    report["hardened"]["fork"] = {
        "forked": 999, "refused_at": probe.FORK_LIMIT + 500, "capped": True,
    }
    failures: list[str] = []
    probe.assess_enforcement(report, failures)
    assert any("above the limit" in item for item in failures)


def test_enforcement_rejects_a_syscall_denied_by_the_wrong_errno():
    report = good_report()
    report["hardened"]["syscall"] = {"rc": -1, "errno": 38}  # ENOSYS, not the filter
    failures: list[str] = []
    probe.assess_enforcement(report, failures)
    assert any("not denied by the seccomp filter" in item for item in failures)


def test_enforcement_rejects_a_sandbox_that_stopped_rather_than_held():
    """Denied writes with broken reads is a broken worker, not a hardened one."""
    report = good_report()
    report["hardened"]["read"] = {"read": False, "errno": 13}
    failures: list[str] = []
    probe.assess_enforcement(report, failures)
    assert any("stopped rather than held" in item for item in failures)


def test_enforcement_rejects_broken_in_namespace_tools():
    report = good_report()
    report["hardened"]["tools"] = {"regex": False, "stdlib": True}
    failures: list[str] = []
    probe.assess_enforcement(report, failures)
    assert any("in-namespace tools did not survive" in item for item in failures)


# ---------------------------------------------------------------------------
# Claim 6 — the channels, and the witness that cannot be forged
# ---------------------------------------------------------------------------


def test_channels_pass_with_all_three_crossings():
    failures: list[str] = []
    record = probe.assess_channels(good_report(), 3, True, failures)
    assert failures == []
    assert record["witness_expected"] == 3
    assert record["both_listeners_open"] is True


def test_channels_expect_one_crossing_without_the_db():
    failures: list[str] = []
    record = probe.assess_channels(good_report(), 1, False, failures)
    assert failures == []
    assert record["witness_expected"] == 1


def test_channels_fail_when_nothing_crossed_even_though_the_guest_is_happy():
    """The negative-control shape: perfect guest-visible results, zero crossings.

    Every model-visible field here says success — the LM text is there, the rows
    are the fixture — and the only thing that catches it is the witness. If this
    test ever passes with `accepted=0`, the probe cannot tell a crossed boundary
    from a guest talking to itself.
    """
    failures: list[str] = []
    probe.assess_channels(good_report(), 0, True, failures)
    assert any("nothing crossed" in item for item in failures)


def test_channels_fail_on_rows_that_are_not_the_fixture():
    report = good_report()
    report["hardened"]["db"]["rows"] = [[9, "wrong", 0]]
    failures: list[str] = []
    probe.assess_channels(report, 3, True, failures)
    assert any("not the fixture" in item for item in failures)


# ---------------------------------------------------------------------------
# Claim 7 — the watchdog
# ---------------------------------------------------------------------------


def test_watchdog_passes_on_a_clean_detect_and_reap():
    failures: list[str] = []
    probe.assess_watchdog(
        {"alive_before": True, "detected": True, "reaped": True, "vmm_processes": []},
        failures,
    )
    assert failures == []


def test_watchdog_fails_when_the_vmm_survived_the_reap():
    failures: list[str] = []
    probe.assess_watchdog(
        {"detected": True, "reaped": True, "vmm_processes": ["1234 cloud-hypervisor"]},
        failures,
    )
    assert any("survived the reap" in item for item in failures)


def test_watchdog_fails_when_it_never_detected_anything():
    """Detection is the transition, so a probe that never saw `alive` fails here."""
    failures: list[str] = []
    probe.assess_watchdog({"detected": False, "reaped": True, "vmm_processes": []}, failures)
    assert any("did not detect" in item for item in failures)


# ---------------------------------------------------------------------------
# The falsifier arm
# ---------------------------------------------------------------------------


def test_falsifier_reports_nothing_unmet_when_hardening_is_genuinely_absent():
    """`--no-harden` passes by the enforcement claims failing."""
    report = good_report()
    report["hardened"]["fork"] = {"forked": 200, "refused_at": None, "capped": False}
    report["hardened"]["syscall"] = {"rc": 0, "errno": 0}
    report["hardened"]["write"] = {"wrote": True}
    assert probe.assess_falsifier(report, "no-harden", []) == []


def test_falsifier_fires_when_controls_hold_with_hardening_disabled():
    """Enforcement without Tier-0 means the probe is measuring something else."""
    unmet = probe.assess_falsifier(good_report(), "no-harden", [])
    assert len(unmet) == 3


def test_falsifier_is_silent_in_the_default_mode():
    assert probe.assess_falsifier(good_report(), "default", []) == []


# ---------------------------------------------------------------------------
# The BPF program — pure computation, fully checkable off-host
# ---------------------------------------------------------------------------


def _decode(program: bytes) -> list[tuple[int, int, int, int]]:
    return [struct.unpack("<HBBI", program[i * 8 : (i + 1) * 8]) for i in range(len(program) // 8)]


def test_filter_has_one_instruction_per_denied_syscall_plus_the_fixed_six():
    instructions = _decode(build_seccomp_filter())
    assert len(instructions) == len(DENIED_SYSCALLS) + 6


def test_filter_checks_the_architecture_first_and_kills_on_mismatch():
    """A filter without an architecture gate is bypassable through another ABI.

    Under a foreign ABI the syscall *numbers* this filter compares name different
    calls, so the mismatch branch must reach `KILL_PROCESS` and not the `ERRNO`
    return that a denied-but-known syscall gets.
    """
    instructions = _decode(build_seccomp_filter())
    count = len(DENIED_SYSCALLS)
    load_arch, arch_check = instructions[0], instructions[1]
    assert load_arch == (0x20, 0, 0, 4), "first instruction must load seccomp_data.arch"
    assert arch_check[3] == AUDIT_ARCH_X86_64
    assert 1 + 1 + arch_check[2] == count + 5, "mismatch must jump to KILL_PROCESS"
    assert instructions[count + 5] == (0x06, 0, 0, 0x80000000)


def test_every_denied_syscall_jumps_to_the_errno_return():
    """The offset arithmetic, checked for all of them rather than a sample.

    Each `jeq` is a different distance from the return it targets, so a mistake
    in the arithmetic shows up on some syscalls and not others — checking one
    would leave the rest unverified.
    """
    instructions = _decode(build_seccomp_filter())
    count = len(DENIED_SYSCALLS)
    errno_index = count + 4
    for offset, number in enumerate(sorted(DENIED_SYSCALLS.values())):
        index = 3 + offset
        code, jt, jf, k = instructions[index]
        assert code == 0x15 and jf == 0 and k == number
        assert index + 1 + jt == errno_index


def test_the_default_return_is_allow_and_the_denial_is_eperm():
    """A denied call gets EPERM, not a kill: libraries probe for features."""
    instructions = _decode(build_seccomp_filter())
    count = len(DENIED_SYSCALLS)
    assert instructions[count + 3] == (0x06, 0, 0, 0x7FFF0000)
    assert instructions[count + 4] == (0x06, 0, 0, 0x00050001)


def test_syscall_numbers_are_unique():
    """Two names sharing a number would mean one of them is wrong."""
    assert len(set(DENIED_SYSCALLS.values())) == len(DENIED_SYSCALLS)


def test_the_denylist_covers_the_namespace_and_module_escape_families():
    for name in ("mount", "unshare", "setns", "pivot_root", "init_module", "ptrace", "bpf"):
        assert name in DENIED_SYSCALLS


def test_a_custom_denylist_produces_a_correspondingly_smaller_program():
    instructions = _decode(build_seccomp_filter({"mount": 165}))
    assert len(instructions) == 7
    assert instructions[3][3] == 165


# ---------------------------------------------------------------------------
# Landlock ABI masking
# ---------------------------------------------------------------------------


def test_fs_access_drops_bits_a_lower_abi_does_not_define():
    """Handling an unknown bit is EINVAL for the whole ruleset, so it is masked.

    The measured guest is ABI 7, but a kernel at ABI 1 must get a working
    ruleset rather than an exception — the alternative is that a slightly older
    host silently gets no filesystem restriction at all.
    """
    full = hardening._ALL_FS_ACCESS
    assert fs_access_for_abi(full, 7) == full
    assert not fs_access_for_abi(full, 1) & hardening.LANDLOCK_ACCESS_FS_REFER
    assert not fs_access_for_abi(full, 1) & hardening.LANDLOCK_ACCESS_FS_TRUNCATE
    assert not fs_access_for_abi(full, 4) & hardening.LANDLOCK_ACCESS_FS_IOCTL_DEV
    assert fs_access_for_abi(full, 3) & hardening.LANDLOCK_ACCESS_FS_TRUNCATE


# ---------------------------------------------------------------------------
# The conjunction that carries the session's lesson
# ---------------------------------------------------------------------------


def test_processes_capped_requires_both_a_limit_and_a_privilege_drop():
    """Root is exempt from RLIMIT_NPROC — measured, not assumed.

    On the host, uid 0 under no limit forked 200 processes; uid 65534 under a
    limit of 24 was refused at 23. So a report showing a set limit while still
    running as root describes a cap that cannot bite, and `processes_capped`
    must be False for it however good the number looks.
    """
    limited_as_root = Tier0Report(uid=0, rlimits={"RLIMIT_NPROC": (24, 24)})
    assert limited_as_root.processes_capped is False

    unlimited_as_nobody = Tier0Report(
        uid=65534, rlimits={"RLIMIT_NPROC": (RLIM_INFINITY, RLIM_INFINITY)}
    )
    assert unlimited_as_nobody.processes_capped is False

    limited_as_nobody = Tier0Report(uid=65534, rlimits={"RLIMIT_NPROC": (24, 24)})
    assert limited_as_nobody.processes_capped is True


def test_a_report_with_no_rlimits_at_all_is_not_capped():
    assert Tier0Report(uid=65534).processes_capped is False


def test_report_ok_is_false_when_any_step_failed():
    report = Tier0Report(uid=65534, rlimits={"RLIMIT_NPROC": (24, 24)})
    assert report.ok is True
    report.failures.append("landlock unavailable in this kernel")
    assert report.ok is False


def test_report_serialises_the_derived_verdicts_for_the_guest_wire():
    """`processes_capped` and `ok` are derived, so they must survive the JSON hop."""
    payload = Tier0Report(uid=65534, rlimits={"RLIMIT_NPROC": (24, 24)}).as_dict()
    assert payload["processes_capped"] is True
    assert payload["ok"] is True
    assert payload["rlimits"]["RLIMIT_NPROC"] == [24, 24]


# ---------------------------------------------------------------------------
# Guest-program integrity
# ---------------------------------------------------------------------------


def test_the_embedded_guest_program_compiles():
    """It is shipped as a string, so nothing else would catch a syntax error.

    A broken guest program surfaces on the host as an exec that produces no
    parsable report — an infrastructure-shaped symptom for what is really a typo,
    and one that costs a boot to discover.
    """
    compile(probe.GUEST_S5_SOURCE, "guest_s5.py", "exec")


def test_the_guest_program_uses_the_shipping_rpc_path():
    """S4 [A] found what hand-rolled envelopes cost: the shipped rendering went
    unexercised and carried a defect. The guest must dial the way the stubs do."""
    assert "GuestRpc" in probe.GUEST_S5_SOURCE
    assert "VsockClient" in probe.GUEST_S5_SOURCE


def test_the_guest_program_reports_on_a_greppable_marker():
    assert "S5_RESULT " in probe.GUEST_S5_SOURCE


def test_unsupported_machine_is_refused_by_name(monkeypatch):
    """A filter built from another architecture's table denies the wrong calls.

    Refusing is the only safe answer: a silently mis-hardened worker is worse
    than an unhardened one, because only the first is believed.
    """
    monkeypatch.setattr(hardening.platform, "machine", lambda: "riscv64")
    with pytest.raises(hardening.UnsupportedPlatformError) as caught:
        hardening.apply_tier0()
    assert "riscv64" in str(caught.value)


# ---------------------------------------------------------------------------
# The cgroup reader — the finding depends on reading the right thing
# ---------------------------------------------------------------------------


def test_cgroupfs_detection_reads_mounts_not_the_directory(tmp_path):
    """`/sys/fs/cgroup` exists on sysfs whether or not anything is mounted there.

    The directory check reports the opposite of the truth in the Kata guest —
    the path is present and empty — which is exactly how a reader concludes
    cgroups are available when they are not. So the finding rests on
    `/proc/mounts`, and this pins that it does.
    """
    empty = tmp_path / "mounts-none"
    empty.write_text(
        "proc /proc proc rw 0 0\nsysfs /sys sysfs rw 0 0\n", encoding="utf-8"
    )
    assert hardening.cgroupfs_mounted(str(empty)) is False

    mounted = tmp_path / "mounts-cgroup2"
    mounted.write_text(
        "proc /proc proc rw 0 0\ncgroup2 /sys/fs/cgroup cgroup2 rw 0 0\n", encoding="utf-8"
    )
    assert hardening.cgroupfs_mounted(str(mounted)) is True


def test_cgroupfs_detection_is_false_when_mounts_is_unreadable(tmp_path):
    """Fail closed: an unreadable `/proc/mounts` must not read as 'available'."""
    assert hardening.cgroupfs_mounted(str(tmp_path / "does-not-exist")) is False
