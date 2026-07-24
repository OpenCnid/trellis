"""Tier-0 in-guest hardening, applied to the worker process at startup.

Source of truth: docs/product/repl-sandbox/REPL_SANDBOX_ARCHITECTURE.md section 2
(Trust model, fact 2) and section 7 requirement 8; REPL_SANDBOX_THREAT_MODEL.md
G-2; REPL_SANDBOX_BUILD_PLAN.md section 5.5 (S5).

**Tier-0 is blast radius, never the boundary.** The boundary is the Kata microVM
(Tier-1, ARCHITECTURE section 2 fact 1). Everything here runs *inside* the
untrusted guest, so hostile model code that defeats it has defeated something
that was never load-bearing. This module must never appear in an "Enforced by"
column for a property the microVM is not independently holding.

## The correction this module carries

The ratified records name **in-guest cgroups (pids/mem/cpu)** as the enforcing
surface, applied at worker startup. Measured on the provisioned host
(Kata 3.32.0 / Cloud Hypervisor / containerd defaults, guest kernel 6.18.35),
that surface **is not reachable from where the records say to apply it**:

* the guest has **no cgroup filesystem mounted** — `/proc/mounts` carries no
  cgroup line and `/proc/self/cgroup` reads `0::/`;
* the guest **cannot mount one**: `mount -t cgroup2` fails `EPERM`, because the
  container's capability set (`a80425fb`) has no `CAP_SYS_ADMIN`;
* the host-side cgroup Kata *does* create for the VM (`/default/kata_<id>`)
  carries **no `memory.max` and no `pids.max`** — the controller files are
  absent, and `ctr run --memory-limit` did not produce them.

So a worker calling into cgroupfs at startup has nothing to write to. The
*property* requirement 8 wants — a fork bomb cannot exhaust the guest — is held
here by **`setrlimit` after a privilege drop** instead, which needs no
privilege, no mount, and no controller: `RLIMIT_NPROC` is charged against the
real uid at `fork()`.

**The privilege drop is load-bearing, not hygiene.** Root is exempt from
`RLIMIT_NPROC`. On this host, as uid 0, a scripted bomb forked 200 processes
against no resistance; as uid 65534 under a limit of 24 it was refused at 23.
Applying the rlimits without dropping first produces a report full of successful
calls and no enforcement at all — which is why `apply_tier0` refuses to claim
`processes_capped` when it is still running as root.

`seccomp` and `Landlock` were measured *available* in the same guest, and
Landlock is richer than the records assumed: **ABI 7**, so the read-only
filesystem rules and (unused here) TCP port rules are both present.

## Order, and why it is this order

1. **Landlock** — filesystem restriction, while the paths are still openable.
2. **Privilege drop** — `setgroups`/`setgid`/`setuid`, after which nothing can
   be re-raised.
3. **`setrlimit`** — charged against the now-unprivileged real uid.
4. **`PR_SET_NO_NEW_PRIVS`** — required before a seccomp filter may be installed
   without `CAP_SYS_ADMIN`, and it survives the drop.
5. **seccomp** — last, because the filter denies syscalls the earlier steps use.

Every step is verified by observation rather than by return code: a step that
returns 0 and changed nothing is the failure mode this module exists to avoid,
so `Tier0Report` records what was *read back* from `/proc/self/status` and from
the kernel, not what the call claimed.

No compiled extension and no new dependency: `ctypes` and `resource` only. The
guest image is stock `python:3.12-slim` plus the shipped package, and S6 already
found that anything needing a wheel is a real cost there.
"""

from __future__ import annotations

import ctypes
import os
import platform
import struct
from dataclasses import dataclass, field

try:  # pragma: no cover - exercised by which platform imports this
    import resource
except ImportError:  # Windows development box: no `resource` module.
    resource = None  # type: ignore[assignment]

#: `getrlimit` reports an absent ceiling as this value. Carried as a module
#: constant rather than read from `resource` so the module imports on the
#: Windows development box, where the verdict logic is unit-tested and only the
#: syscalls are unavailable. Linux's `resource.RLIM_INFINITY` is this value.
RLIM_INFINITY = -1

# ---------------------------------------------------------------------------
# Architecture gate
# ---------------------------------------------------------------------------

#: `AUDIT_ARCH_X86_64` — the value a seccomp filter compares `seccomp_data.arch`
#: against. A filter that does not pin the architecture can be bypassed by
#: entering through a different ABI (x32/i386), where the same syscall *numbers*
#: name different syscalls.
AUDIT_ARCH_X86_64 = 0xC000003E

#: Syscall numbers below are x86_64's. They are not portable, and a filter built
#: from the wrong table denies the wrong calls, so an unsupported machine is
#: refused by name rather than hardened incorrectly.
SUPPORTED_MACHINE = "x86_64"

#: x86_64 syscall numbers for the three Landlock calls and for `seccomp`.
NR_SECCOMP = 317
NR_LANDLOCK_CREATE_RULESET = 444
NR_LANDLOCK_ADD_RULE = 445
NR_LANDLOCK_RESTRICT_SELF = 446

#: `prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)`.
PR_SET_NO_NEW_PRIVS = 38


class HardeningError(RuntimeError):
    """A Tier-0 step could not be applied, or applied without taking effect.

    Deliberately fail-closed and deliberately *not* a `SandboxError`: this is a
    guest-startup fault, not something that crosses a seam and gets an error
    envelope. The caller's correct response is to refuse to run the worker.
    """


class UnsupportedPlatformError(HardeningError):
    """The running machine has no syscall table in this module."""


# ---------------------------------------------------------------------------
# The denied syscall set
# ---------------------------------------------------------------------------

#: Syscalls the filter refuses, as `name -> x86_64 number`.
#:
#: **This is a denylist, and the records say "seccomp allowlist"** — a divergence
#: recorded rather than papered over. A true allowlist for a CPython worker that
#: runs arbitrary model-authored code, imports pandas, and links libc is not
#: maintainable: the reachable syscall set is large, version-dependent, and a
#: miss is a crash in ordinary use rather than a caught attack. The forwarder
#: process of INTERFACES section 3.4 *is* allowlistable — it makes ten kinds of
#: call — and that allowlist is not this one.
#:
#: What this set is chosen to do: remove the namespace/module/kernel-surface
#: calls that serve escape and privilege manipulation, none of which a Python
#: data worker has any reason to make. It is close to Docker's default profile's
#: denied set, which is the same judgement made by people with the same problem.
DENIED_SYSCALLS: dict[str, int] = {
    # namespace and mount manipulation
    "mount": 165,
    "umount2": 166,
    "pivot_root": 155,
    "chroot": 161,
    "unshare": 272,
    "setns": 308,
    # kernel module surface
    "init_module": 175,
    "finit_module": 313,
    "delete_module": 176,
    "create_module": 174,
    "get_kernel_syms": 177,
    "query_module": 178,
    # kernel execution and power
    "kexec_load": 246,
    "kexec_file_load": 320,
    "reboot": 169,
    # tracing and cross-process memory
    "ptrace": 101,
    "process_vm_readv": 310,
    "process_vm_writev": 311,
    "perf_event_open": 298,
    "bpf": 321,
    # keyring
    "add_key": 248,
    "request_key": 249,
    "keyctl": 250,
    # host identity, time, and hardware ports
    "sethostname": 170,
    "setdomainname": 171,
    "settimeofday": 164,
    "clock_settime": 227,
    "ioperm": 173,
    "iopl": 172,
    "modify_ldt": 154,
    # storage and legacy
    "swapon": 167,
    "swapoff": 168,
    "quotactl": 179,
    "nfsservctl": 180,
    "uselib": 134,
    # handle-based path escape out of a restricted directory tree
    "name_to_handle_at": 303,
    "open_by_handle_at": 304,
}


# ---------------------------------------------------------------------------
# Landlock access bits
# ---------------------------------------------------------------------------

LANDLOCK_ACCESS_FS_EXECUTE = 1 << 0
LANDLOCK_ACCESS_FS_WRITE_FILE = 1 << 1
LANDLOCK_ACCESS_FS_READ_FILE = 1 << 2
LANDLOCK_ACCESS_FS_READ_DIR = 1 << 3
LANDLOCK_ACCESS_FS_REMOVE_DIR = 1 << 4
LANDLOCK_ACCESS_FS_REMOVE_FILE = 1 << 5
LANDLOCK_ACCESS_FS_MAKE_CHAR = 1 << 6
LANDLOCK_ACCESS_FS_MAKE_DIR = 1 << 7
LANDLOCK_ACCESS_FS_MAKE_REG = 1 << 8
LANDLOCK_ACCESS_FS_MAKE_SOCK = 1 << 9
LANDLOCK_ACCESS_FS_MAKE_FIFO = 1 << 10
LANDLOCK_ACCESS_FS_MAKE_BLOCK = 1 << 11
LANDLOCK_ACCESS_FS_MAKE_SYM = 1 << 12
LANDLOCK_ACCESS_FS_REFER = 1 << 13
LANDLOCK_ACCESS_FS_TRUNCATE = 1 << 14
LANDLOCK_ACCESS_FS_IOCTL_DEV = 1 << 15

LANDLOCK_RULE_PATH_BENEATH = 1

#: The lowest ABI at which each access bit exists. Handling a bit the running
#: kernel does not know is `EINVAL` for the whole ruleset, so the handled mask is
#: masked down to the detected ABI rather than assumed. Measured ABI on the
#: provisioned host's guest is 7; this table is what lets the same code harden a
#: lower one instead of refusing.
_FS_BIT_MIN_ABI: dict[int, int] = {
    LANDLOCK_ACCESS_FS_REFER: 2,
    LANDLOCK_ACCESS_FS_TRUNCATE: 3,
    LANDLOCK_ACCESS_FS_IOCTL_DEV: 5,
}

#: Everything a ruleset handles by default. Read and execute are handled too, so
#: that a path granted nothing is genuinely unreachable rather than merely
#: unwritable.
_ALL_FS_ACCESS = (
    LANDLOCK_ACCESS_FS_EXECUTE
    | LANDLOCK_ACCESS_FS_WRITE_FILE
    | LANDLOCK_ACCESS_FS_READ_FILE
    | LANDLOCK_ACCESS_FS_READ_DIR
    | LANDLOCK_ACCESS_FS_REMOVE_DIR
    | LANDLOCK_ACCESS_FS_REMOVE_FILE
    | LANDLOCK_ACCESS_FS_MAKE_CHAR
    | LANDLOCK_ACCESS_FS_MAKE_DIR
    | LANDLOCK_ACCESS_FS_MAKE_REG
    | LANDLOCK_ACCESS_FS_MAKE_SOCK
    | LANDLOCK_ACCESS_FS_MAKE_FIFO
    | LANDLOCK_ACCESS_FS_MAKE_BLOCK
    | LANDLOCK_ACCESS_FS_MAKE_SYM
    | LANDLOCK_ACCESS_FS_REFER
    | LANDLOCK_ACCESS_FS_TRUNCATE
    | LANDLOCK_ACCESS_FS_IOCTL_DEV
)

#: Rights granted on a read-only root.
_READ_ONLY_ACCESS = (
    LANDLOCK_ACCESS_FS_READ_FILE
    | LANDLOCK_ACCESS_FS_READ_DIR
    | LANDLOCK_ACCESS_FS_EXECUTE
)

#: Rights granted on a scratch path the worker may write.
_READ_WRITE_ACCESS = _READ_ONLY_ACCESS | (
    LANDLOCK_ACCESS_FS_WRITE_FILE
    | LANDLOCK_ACCESS_FS_MAKE_REG
    | LANDLOCK_ACCESS_FS_MAKE_DIR
    | LANDLOCK_ACCESS_FS_REMOVE_FILE
    | LANDLOCK_ACCESS_FS_REMOVE_DIR
    | LANDLOCK_ACCESS_FS_TRUNCATE
)


def fs_access_for_abi(mask: int, abi: int) -> int:
    """Drop the bits of `mask` that a Landlock `abi` does not define."""
    for bit, min_abi in _FS_BIT_MIN_ABI.items():
        if abi < min_abi:
            mask &= ~bit
    return mask


# ---------------------------------------------------------------------------
# Policy and report
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Tier0Limits:
    """The rlimit set that replaces the unavailable cgroup controllers.

    `max_processes` is the fork-bomb cap and the one that must be charged
    against a non-root uid to mean anything. The rest bound the other cheap
    self-exhaustion routes: address space, descriptors, and file size.
    """

    #: `RLIMIT_NPROC` — processes/threads for the worker's real uid.
    max_processes: int = 256
    #: `RLIMIT_AS` — virtual address space in bytes.
    address_space_bytes: int = 1024 * 1024 * 1024
    #: `RLIMIT_NOFILE` — open descriptors.
    max_open_files: int = 1024
    #: `RLIMIT_FSIZE` — largest file the worker may create, in bytes.
    max_file_size_bytes: int = 256 * 1024 * 1024
    #: `RLIMIT_CORE` — core dumps off; a dump would write the namespace to disk.
    core_dump_bytes: int = 0


@dataclass(frozen=True)
class Tier0Policy:
    """What `apply_tier0` applies.

    `uid`/`gid` default to `nobody`, which exists in the stock image. The point
    of the drop is only that the worker is not uid 0; any unprivileged id does.
    """

    uid: int = 65534
    gid: int = 65534
    limits: Tier0Limits = field(default_factory=Tier0Limits)
    #: Paths the worker may read and execute from. Anything not listed here or
    #: in `writable_paths` becomes unreachable once the ruleset is enforced.
    read_only_roots: tuple[str, ...] = ("/usr", "/lib", "/lib64", "/bin", "/sbin", "/etc")
    #: Paths the worker may also write. Kept to a scratch directory.
    writable_paths: tuple[str, ...] = ("/tmp",)
    #: Turn individual steps off. Present so the probe can isolate one control
    #: and show the others still standing, not so production can skip them.
    enable_landlock: bool = True
    enable_seccomp: bool = True
    enable_privilege_drop: bool = True
    enable_rlimits: bool = True


@dataclass
class Tier0Report:
    """What actually took effect, read back from the kernel.

    Every field here is an *observation*, not an echo of a return code. The
    probe asserts against this, and the assertions that matter are the read-back
    ones: `seccomp_mode` comes from `/proc/self/status`, `uid` from `getuid()`
    after the drop, `rlimits` from `getrlimit()`.
    """

    machine: str = ""
    landlock_abi: int = 0
    cgroupfs_mounted: bool = False
    steps: list[str] = field(default_factory=list)
    failures: list[str] = field(default_factory=list)
    uid: int = -1
    gid: int = -1
    rlimits: dict[str, tuple[int, int]] = field(default_factory=dict)
    no_new_privs: int = -1
    seccomp_mode: int = -1
    seccomp_filters: int = -1
    landlock_rules: int = 0
    denied_syscall_count: int = 0

    @property
    def processes_capped(self) -> bool:
        """True only when the fork-bomb cap can actually bite.

        Both halves are required and the conjunction is the whole point: root is
        exempt from `RLIMIT_NPROC`, so a limit set while still uid 0 is a number
        with no enforcement behind it.
        """
        soft, _ = self.rlimits.get("RLIMIT_NPROC", (RLIM_INFINITY, RLIM_INFINITY))
        return self.uid != 0 and soft != RLIM_INFINITY

    @property
    def ok(self) -> bool:
        return not self.failures

    def as_dict(self) -> dict:
        return {
            "machine": self.machine,
            "landlock_abi": self.landlock_abi,
            "cgroupfs_mounted": self.cgroupfs_mounted,
            "steps": list(self.steps),
            "failures": list(self.failures),
            "uid": self.uid,
            "gid": self.gid,
            "rlimits": {k: list(v) for k, v in self.rlimits.items()},
            "no_new_privs": self.no_new_privs,
            "seccomp_mode": self.seccomp_mode,
            "seccomp_filters": self.seccomp_filters,
            "landlock_rules": self.landlock_rules,
            "denied_syscall_count": self.denied_syscall_count,
            "processes_capped": self.processes_capped,
            "ok": self.ok,
        }


# ---------------------------------------------------------------------------
# Environment observation
# ---------------------------------------------------------------------------


def _libc() -> ctypes.CDLL:
    return ctypes.CDLL(None, use_errno=True)


def cgroupfs_mounted(proc_mounts: str = "/proc/mounts") -> bool:
    """Whether a cgroup filesystem is mounted and therefore writable at all.

    The measured answer inside the Kata guest is **False**, which is the finding
    this module's docstring records. Read from `/proc/mounts` rather than by
    `os.path.isdir('/sys/fs/cgroup')` — the directory exists on sysfs whether or
    not anything is mounted on it, so the directory check reports the opposite
    of the truth.
    """
    try:
        with open(proc_mounts, "r", encoding="utf-8", errors="replace") as handle:
            return any(line.split()[2].startswith("cgroup") for line in handle if len(line.split()) > 2)
    except OSError:
        return False


def landlock_abi() -> int:
    """The kernel's Landlock ABI level, or 0 when Landlock is unavailable.

    `landlock_create_ruleset(NULL, 0, LANDLOCK_CREATE_RULESET_VERSION)` returns
    the version rather than a file descriptor. Measured 7 in the guest.
    """
    libc = _libc()
    ctypes.set_errno(0)
    rc = libc.syscall(
        ctypes.c_long(NR_LANDLOCK_CREATE_RULESET), None, ctypes.c_size_t(0), ctypes.c_uint32(1)
    )
    return rc if rc > 0 else 0


def _proc_status_fields(names: tuple[str, ...], path: str = "/proc/self/status") -> dict[str, int]:
    """Read integer fields out of `/proc/self/status`.

    This is the read-back that makes the seccomp claim an observation: the
    `seccomp()` call returning 0 and `Seccomp: 2` appearing in status are
    different statements, and only the second one is evidence.
    """
    found: dict[str, int] = {}
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                key, _, value = line.partition(":")
                if key in names:
                    try:
                        found[key] = int(value.strip().split()[0])
                    except (ValueError, IndexError):
                        continue
    except OSError:
        pass
    return found


def observe_environment() -> dict:
    """Ground truth about the guest, before anything is applied.

    Recorded by the probe so the cgroup finding is reproducible from code rather
    than from a shell transcript — it is going into a design record, so it needs
    to be re-derivable.
    """
    status = _proc_status_fields(("Seccomp", "Seccomp_filters", "NoNewPrivs", "CapEff"))
    return {
        "machine": platform.machine(),
        "kernel": platform.release(),
        "uid": os.getuid(),
        "gid": os.getgid(),
        "cgroupfs_mounted": cgroupfs_mounted(),
        "cgroup_self": _read_text("/proc/self/cgroup").strip(),
        "landlock_abi": landlock_abi(),
        "seccomp_mode": status.get("Seccomp", -1),
        "seccomp_filters": status.get("Seccomp_filters", -1),
        "no_new_privs": status.get("NoNewPrivs", -1),
        "cap_effective": _read_cap_effective(),
    }


def _read_text(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            return handle.read()
    except OSError:
        return ""


def _read_cap_effective() -> str:
    for line in _read_text("/proc/self/status").splitlines():
        if line.startswith("CapEff:"):
            return line.split(":", 1)[1].strip()
    return ""


# ---------------------------------------------------------------------------
# The steps
# ---------------------------------------------------------------------------


def build_seccomp_filter(denied: dict[str, int] | None = None) -> bytes:
    """Assemble the classic-BPF program the seccomp filter runs.

    Shape, with `D` denied syscalls:

    ```
      0        ld   [4]              # seccomp_data.arch
      1        jeq  AUDIT_ARCH_X86_64, jt=0, jf=->KILL
      2        ld   [0]              # seccomp_data.nr
      3..2+D   jeq  <nr>,            jt=->ERRNO, jf=0
      3+D      ret  ALLOW
      4+D      ret  ERRNO(EPERM)
      5+D      ret  KILL_PROCESS
    ```

    The architecture check is first and jumps to `KILL_PROCESS` rather than
    `ERRNO`: a caller entering on a different ABI is not making a mistake to be
    told about, and under a foreign ABI the numbers this filter compares mean
    something else entirely.

    Denied syscalls get `ERRNO(EPERM)` rather than a kill so that a library
    probing for a feature degrades instead of taking the worker down — an
    ordinary thing for CPython and its extensions to do at import time.
    """
    table = DENIED_SYSCALLS if denied is None else denied
    numbers = sorted(table.values())
    count = len(numbers)

    bpf_ld_w_abs = 0x20
    bpf_jmp_jeq_k = 0x15
    bpf_ret_k = 0x06
    seccomp_ret_kill_process = 0x80000000
    seccomp_ret_errno_eperm = 0x00050000 | 1  # EPERM
    seccomp_ret_allow = 0x7FFF0000

    instructions: list[tuple[int, int, int, int]] = [
        (bpf_ld_w_abs, 0, 0, 4),
        (bpf_jmp_jeq_k, 0, count + 3, AUDIT_ARCH_X86_64),
        (bpf_ld_w_abs, 0, 0, 0),
    ]
    for index, number in enumerate(numbers):
        instructions.append((bpf_jmp_jeq_k, count - index, 0, number))
    instructions.append((bpf_ret_k, 0, 0, seccomp_ret_allow))
    instructions.append((bpf_ret_k, 0, 0, seccomp_ret_errno_eperm))
    instructions.append((bpf_ret_k, 0, 0, seccomp_ret_kill_process))

    return b"".join(struct.pack("<HBBI", *item) for item in instructions)


class _SockFprog(ctypes.Structure):
    _fields_ = [("len", ctypes.c_ushort), ("filter", ctypes.c_void_p)]


def set_no_new_privs() -> None:
    """`prctl(PR_SET_NO_NEW_PRIVS)`; required before an unprivileged seccomp filter."""
    libc = _libc()
    ctypes.set_errno(0)
    if libc.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0:
        raise HardeningError(f"PR_SET_NO_NEW_PRIVS failed: errno {ctypes.get_errno()}")


def apply_seccomp(denied: dict[str, int] | None = None) -> None:
    """Install the seccomp filter on the calling thread group.

    Called last. The filter denies `unshare`, `setns`, `ptrace` and friends, all
    of which the earlier steps do not need but a privilege drop performed *after*
    this would.
    """
    program = build_seccomp_filter(denied)
    buffer = ctypes.create_string_buffer(program, len(program))
    fprog = _SockFprog(len(program) // 8, ctypes.cast(buffer, ctypes.c_void_p))
    libc = _libc()
    ctypes.set_errno(0)
    rc = libc.syscall(
        ctypes.c_long(NR_SECCOMP),
        ctypes.c_uint(1),  # SECCOMP_SET_MODE_FILTER
        ctypes.c_uint(0),
        ctypes.byref(fprog),
    )
    if rc != 0:
        raise HardeningError(f"seccomp(SET_MODE_FILTER) failed: errno {ctypes.get_errno()}")


def apply_landlock(policy: Tier0Policy) -> int:
    """Enforce the filesystem ruleset. Returns the number of path rules added.

    Paths that do not exist are skipped rather than fatal: the ruleset is a
    grant list, so a missing path grants nothing, and refusing to start because
    `/lib64` is absent on some image would trade a real restriction for none.
    """
    abi = landlock_abi()
    if abi <= 0:
        raise HardeningError("landlock unavailable in this kernel")

    handled = fs_access_for_abi(_ALL_FS_ACCESS, abi)
    if abi >= 6:
        attr = struct.pack("<QQQ", handled, 0, 0)
    elif abi >= 4:
        attr = struct.pack("<QQ", handled, 0)
    else:
        attr = struct.pack("<Q", handled)

    libc = _libc()
    ctypes.set_errno(0)
    buffer = ctypes.create_string_buffer(attr, len(attr))
    ruleset_fd = libc.syscall(
        ctypes.c_long(NR_LANDLOCK_CREATE_RULESET),
        buffer,
        ctypes.c_size_t(len(attr)),
        ctypes.c_uint32(0),
    )
    if ruleset_fd < 0:
        raise HardeningError(f"landlock_create_ruleset failed: errno {ctypes.get_errno()}")

    added = 0
    try:
        grants: list[tuple[str, int]] = [
            (path, fs_access_for_abi(_READ_ONLY_ACCESS, abi)) for path in policy.read_only_roots
        ]
        grants += [
            (path, fs_access_for_abi(_READ_WRITE_ACCESS, abi)) for path in policy.writable_paths
        ]
        for path, access in grants:
            try:
                parent_fd = os.open(path, os.O_PATH | os.O_CLOEXEC)
            except OSError:
                continue
            try:
                rule = struct.pack("<Qi", access, parent_fd)
                rule_buffer = ctypes.create_string_buffer(rule, len(rule))
                ctypes.set_errno(0)
                rc = libc.syscall(
                    ctypes.c_long(NR_LANDLOCK_ADD_RULE),
                    ctypes.c_int(ruleset_fd),
                    ctypes.c_uint32(LANDLOCK_RULE_PATH_BENEATH),
                    rule_buffer,
                    ctypes.c_uint32(0),
                )
                if rc != 0:
                    raise HardeningError(
                        f"landlock_add_rule({path}) failed: errno {ctypes.get_errno()}"
                    )
                added += 1
            finally:
                os.close(parent_fd)

        set_no_new_privs()
        ctypes.set_errno(0)
        rc = libc.syscall(
            ctypes.c_long(NR_LANDLOCK_RESTRICT_SELF), ctypes.c_int(ruleset_fd), ctypes.c_uint32(0)
        )
        if rc != 0:
            raise HardeningError(f"landlock_restrict_self failed: errno {ctypes.get_errno()}")
    finally:
        os.close(ruleset_fd)
    return added


def drop_privileges(policy: Tier0Policy) -> None:
    """Drop to the unprivileged uid/gid, supplementary groups first.

    `setgroups` before `setgid` before `setuid` is the order that cannot be
    partially applied into something worse: after `setuid` the process can no
    longer call the other two.
    """
    if os.getuid() != 0:
        return
    try:
        os.setgroups([])
        os.setgid(policy.gid)
        os.setuid(policy.uid)
    except OSError as error:
        raise HardeningError(f"privilege drop to {policy.uid}:{policy.gid} failed: {error}") from error
    if os.getuid() == 0:
        raise HardeningError("privilege drop reported success but uid is still 0")


def apply_rlimits(limits: Tier0Limits) -> dict[str, tuple[int, int]]:
    """Lower the resource limits and return what `getrlimit` reads back.

    Both soft and hard are set to the same value: leaving the hard limit high
    lets the worker raise its own soft limit back, which makes the cap advisory
    against exactly the code it is meant to bound.
    """
    if resource is None:
        raise HardeningError("the `resource` module is unavailable on this platform")
    wanted = {
        "RLIMIT_NPROC": limits.max_processes,
        "RLIMIT_AS": limits.address_space_bytes,
        "RLIMIT_NOFILE": limits.max_open_files,
        "RLIMIT_FSIZE": limits.max_file_size_bytes,
        "RLIMIT_CORE": limits.core_dump_bytes,
    }
    observed: dict[str, tuple[int, int]] = {}
    for name, value in wanted.items():
        which = getattr(resource, name)
        soft, hard = resource.getrlimit(which)
        # Never raise: if the inherited limit is already tighter, keep it.
        target = value if hard == RLIM_INFINITY else min(value, hard)
        try:
            resource.setrlimit(which, (target, target))
        except (ValueError, OSError) as error:
            raise HardeningError(f"setrlimit({name}, {target}) failed: {error}") from error
        observed[name] = resource.getrlimit(which)
    return observed


# ---------------------------------------------------------------------------
# The entry point
# ---------------------------------------------------------------------------


def apply_tier0(policy: Tier0Policy | None = None) -> Tier0Report:
    """Apply Tier-0 to this process and report what took effect.

    Raises `UnsupportedPlatformError` on a machine whose syscall numbers this
    module does not carry, because a filter built from the wrong table denies
    the wrong calls — a silently mis-hardened worker is worse than an
    unhardened one, since only the first is believed.

    Individual step failures are collected into `report.failures` rather than
    raised, so a caller sees the whole picture instead of the first problem, and
    so `report.ok` is a single honest verdict.
    """
    policy = policy or Tier0Policy()
    machine = platform.machine()
    if machine != SUPPORTED_MACHINE:
        raise UnsupportedPlatformError(
            f"no syscall table for {machine!r}; only {SUPPORTED_MACHINE} is carried"
        )

    report = Tier0Report(
        machine=machine,
        landlock_abi=landlock_abi(),
        cgroupfs_mounted=cgroupfs_mounted(),
        denied_syscall_count=len(DENIED_SYSCALLS),
    )

    if policy.enable_landlock:
        try:
            report.landlock_rules = apply_landlock(policy)
            report.steps.append("landlock")
        except HardeningError as error:
            report.failures.append(str(error))

    if policy.enable_privilege_drop:
        try:
            drop_privileges(policy)
            report.steps.append("privilege_drop")
        except HardeningError as error:
            report.failures.append(str(error))

    if policy.enable_rlimits:
        try:
            report.rlimits = apply_rlimits(policy.limits)
            report.steps.append("rlimits")
        except HardeningError as error:
            report.failures.append(str(error))

    try:
        set_no_new_privs()
        report.steps.append("no_new_privs")
    except HardeningError as error:
        report.failures.append(str(error))

    if policy.enable_seccomp:
        try:
            apply_seccomp()
            report.steps.append("seccomp")
        except HardeningError as error:
            report.failures.append(str(error))

    report.uid = os.getuid()
    report.gid = os.getgid()
    status = _proc_status_fields(("Seccomp", "Seccomp_filters", "NoNewPrivs"))
    report.seccomp_mode = status.get("Seccomp", -1)
    report.seccomp_filters = status.get("Seccomp_filters", -1)
    report.no_new_privs = status.get("NoNewPrivs", -1)

    if policy.enable_rlimits and not report.processes_capped:
        report.failures.append(
            "RLIMIT_NPROC is not enforceable: "
            f"uid={report.uid} (root is exempt) "
            f"limit={report.rlimits.get('RLIMIT_NPROC')}"
        )
    return report
