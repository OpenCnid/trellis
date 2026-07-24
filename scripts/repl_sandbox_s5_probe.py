"""REPL-sandbox S5 probe: Tier-0 in-guest hardening, on a real host.

Specification: docs/product/repl-sandbox/REPL_SANDBOX_BUILD_PLAN.md section 5.5
(S5 - Tier-0 in-guest hardening), the **`[R]` half** and the whole of it: S5 has
no paid half. Entrypoint: `npm run repl-sandbox:s5-probe` (the non-test caller,
AGENTS.md section 4 rule 15).

**This script only runs on the provisioned Linux host**, as root. It shells out
to `ctr`, binds Unix sockets in the VMM's per-sandbox directory, and installs
seccomp/Landlock inside a real Kata guest. On the Windows development box it
refuses in its first check. Its host-side *verdict* logic - every assessor that
turns a guest report into a pass or a failure - is under test off-host in
`src/repl_sandbox/tests/test_s5_probe.py`, so a mistake in what counts as a pass
surfaces on a development box rather than mid-run.

**Zero-paid.** No model runs; the LM channel is served by S3's `ScriptedProvider`
stub. S5 asks whether hardening holds and whether the channels survive it -
neither question needs a model, and one that ran would only add cost and
variance to a scripted claim.

## What this probe found before it was written

The records name **in-guest cgroups (pids/mem/cpu)** as requirement 8's
enforcing surface. On this stack that surface is not reachable from the worker:
the guest has no cgroup filesystem mounted, cannot mount one (`EPERM`, no
`CAP_SYS_ADMIN`), and the host-side cgroup Kata creates for the VM carries no
`memory.max` or `pids.max` at all. `repl_sandbox.hardening` carries the full
finding and the mechanism that replaces it - `setrlimit` after a privilege drop.
Claim 2 below re-derives the finding from code on every run, so the design
record's basis stays checkable rather than resting on one session's transcript.

## The claims

  1. **The unhardened baseline is genuinely dangerous.** Before Tier-0, in the
     same guest: a fork bomb runs away, a write outside the scratch path
     succeeds, and a syscall the filter will deny is permitted. This is the
     positive control, and without it "blocked after hardening" is silently
     compatible with "blocked anyway, by something else". S4 `[A]` learned this
     the expensive way: a correct-looking result and a broken instrument are
     indistinguishable until the arm that must fail is run.
  2. **cgroups are unavailable in the guest** - re-derived, not asserted.
  3. **The fork bomb is capped** once Tier-0 is applied (`RLIMIT_NPROC` charged
     against a non-root uid).
  4. **A denied syscall is blocked** by seccomp, the worker survives it, and
     ordinary syscalls still work. `Seccomp: 2` is read back from
     `/proc/self/status`: the syscall returning 0 and the filter being installed
     are different claims and only the second is evidence.
  5. **A write to a read-only root is denied** by Landlock, and reads still work.
  6. **Both channels survive the hardening.** The hardened worker completes an
     `llm_query` over the LM port *and* a `run_query`/`materialize` over the DB
     port, with **both host listeners open at once**. This closes a scope limit
     S4 carried honestly: S3 opened only the LM listener, S4 only the DB one, so
     neither said anything about two at a time.
  7. **The watchdog reaps a wedged VM** from a clean slot, in its own throwaway
     sandbox so a failure there cannot contaminate the Tier-0 claims.
  8. **Clean teardown** - listener sockets, containers, VMM processes, and (a
     residue S3 and S4 both left behind) the per-sandbox cgroup directories.

## Modes

```
  default             boot once, run every claim
  --no-harden         THE FALSIFIER. Skip Tier-0 entirely. Claims 3, 4 and 5
                      must then FAIL; DETECTED (exit 3) is the healthy result.
                      A pass here means the probe is not measuring hardening -
                      it is measuring something that was already true.
  --negative-control  the hardened guest answers ITSELF on both channels with
                      canned replies and never dials the host. Every
                      guest-visible claim still passes and only the host-side
                      witness catches it. DETECTED (exit 3) is healthy.
  --no-db-channel     run claim 6 on the LM channel only, skipping Postgres
                      provisioning. The Tier-0 claims do not depend on the DB.
  --keep              leave the sandbox running (skips teardown)
  --json              emit the observation record as JSON on stdout
```

The two falsifier arms are separate because S5 makes two *kinds* of claim. The
in-guest enforcement claims are falsified by removing the enforcement
(`--no-harden`); the boundary-crossing claim is falsified by removing the
crossing (`--negative-control`). One arm cannot do both jobs, and a probe with
only one of them would leave half its claims ungrounded.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import subprocess
import sys
import threading
import time
import uuid

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO_ROOT, "src"))


def _load_script(name: str):
    """Import a sibling probe script by path and reuse its plumbing.

    They are scripts, not package modules, so they are loaded the way their own
    tests load them. S5 reuses S3's host/bridge/witness/teardown and S4's
    Postgres fixture; a second copy of either would be a second thing to keep
    true, and S4 already recorded that shipping less into the guest is a
    reliability property on a host whose `ctr task exec` intermittently wedges.
    """
    path = os.path.join(REPO_ROOT, "scripts", f"{name}.py")
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


probe = _load_script("repl_sandbox_s3_probe")
s4 = _load_script("repl_sandbox_s4_probe")

from repl_sandbox.audit import AuditLog  # noqa: E402
from repl_sandbox.config import SandboxConfig  # noqa: E402
from repl_sandbox.host import TrellisSandboxHost  # noqa: E402
from repl_sandbox.transport import HybridVsockListener, serve_forever  # noqa: E402

GUEST_DIR = probe.GUEST_DIR
GUEST_CID = probe.GUEST_CID

#: The syscall the guest tries in both arms. `unshare` is in the denylist, is
#: harmless to attempt, and no part of CPython's ordinary operation calls it -
#: so a difference between the arms is the filter and not a side effect.
PROBE_SYSCALL_NAME = "unshare"
PROBE_SYSCALL_NR = 272

#: Where the guest tries to write. Outside every granted root, so Landlock must
#: refuse it, and on a filesystem that is otherwise writable so the *unhardened*
#: arm genuinely succeeds - a path that fails for both arms would prove nothing.
FORBIDDEN_WRITE_PATH = "/var/tmp/s5_forbidden_probe"

#: Fork-bomb parameters. The limit is small and the attempt is comfortably above
#: it, so "capped" is unambiguous; children exit on their own so a failed run
#: does not leave the guest loaded.
FORK_LIMIT = 24
FORK_ATTEMPTS = 200

#: How long the watchdog waits before calling a guest unresponsive.
WATCHDOG_TIMEOUT_S = 20.0


# ---------------------------------------------------------------------------
# The guest program
# ---------------------------------------------------------------------------

#: Runs inside the guest, once, as a single `ctr task exec`.
#:
#: Structure: the parent observes the environment, then runs the baseline checks
#: in one forked child and the hardened checks in another. Two processes are
#: required because Tier-0 is irreversible - a process that has called
#: `landlock_restrict_self` cannot un-restrict to run the baseline afterwards -
#: and forking keeps it to one `exec`, which is the flake-bearing call on this
#: host.
GUEST_S5_SOURCE = r'''
import json, os, sys, ctypes

# Self-locating rather than hard-coded. The host's `GUEST_DIR` is "/run/s3" — a
# cosmetic name inherited from S3 and reused by every probe since — and a guest
# that retyped the literal got it wrong on the first host run. Deriving it from
# __file__ makes the two impossible to drift apart.
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from repl_sandbox import hardening
from repl_sandbox.hardening import Tier0Policy, Tier0Limits, apply_tier0, observe_environment

REQUEST = json.load(open(os.path.join(HERE, "request.json")))
CANNED = None
if os.path.exists(os.path.join(HERE, "canned.json")):
    CANNED = json.load(open(os.path.join(HERE, "canned.json")))

FORBIDDEN = REQUEST["forbidden_write_path"]
SYSCALL_NR = REQUEST["probe_syscall_nr"]
FORK_LIMIT = REQUEST["fork_limit"]
FORK_ATTEMPTS = REQUEST["fork_attempts"]


def try_write(path):
    try:
        with open(path, "w") as fh:
            fh.write("s5")
        os.unlink(path)
        return {"wrote": True}
    except OSError as exc:
        return {"wrote": False, "errno": exc.errno, "strerror": exc.strerror}


def try_read():
    try:
        with open("/etc/hostname") as fh:
            return {"read": bool(fh.read() is not None)}
    except OSError as exc:
        return {"read": False, "errno": exc.errno}


def try_syscall():
    libc = ctypes.CDLL(None, use_errno=True)
    ctypes.set_errno(0)
    rc = libc.syscall(ctypes.c_long(SYSCALL_NR), ctypes.c_int(0))
    return {"rc": rc, "errno": ctypes.get_errno()}


def try_fork(attempts):
    kids = []
    refused_at = None
    try:
        for i in range(attempts):
            pid = os.fork()
            if pid == 0:
                try:
                    import time as _t
                    _t.sleep(3)
                finally:
                    os._exit(0)
            kids.append(pid)
    except OSError as exc:
        refused_at = len(kids)
    for p in kids:
        try:
            os.kill(p, 9)
        except OSError:
            pass
    for p in kids:
        try:
            os.waitpid(p, 0)
        except OSError:
            pass
    return {"forked": len(kids), "refused_at": refused_at, "capped": refused_at is not None}


class CannedClient:
    """Answers the guest itself, for the negative control.

    Shaped to forge the real thing exactly: it returns the same envelope
    `GuestRpc` would unwrap, so every guest-visible claim comes out identical to
    a crossing run. S4 [R] learned this the hard way - a control whose fake was
    catchable by a guest-visible detail was caught by that detail rather than by
    the witness, which made it noisy rather than working. The host-side witness
    must be the *only* thing that can tell.
    """

    def __init__(self, canned):
        self.canned = canned

    def request(self, payload, max_frame_len):
        return {"v": 1, "req_id": payload.get("req_id"), "result": self.canned[payload["op"]]}


def make_rpc(port, key, max_len):
    """The shipping guest path: `GuestRpc` over `VsockClient`, never a hand-rolled frame.

    S4 [A] found the cost of the alternative: every earlier probe hand-wrote its
    envelopes because its author knew the wire, so the rendering the model
    actually consumes went unexercised and shipped a defect. A probe that dials
    the way the materialised stubs dial is testing the code that ships.
    """
    from repl_sandbox.guest_rpc import GuestRpc
    from repl_sandbox.transport import VsockClient

    if CANNED is not None:
        return GuestRpc({key: CannedClient(CANNED)}, max_len)
    return GuestRpc({key: VsockClient(2, port, timeout_s=30.0)}, max_len)


def lm_call(ports, max_len):
    try:
        rpc = make_rpc(ports["lm"], "LM_PORT", max_len)
        reply = rpc("LM_PORT", {
            "v": 1, "req_id": "s5-lm", "op": "llm_query",
            "args": {"prompt": REQUEST["prompt"]},
        })
        # LMResponse is {error, chat_completion | chat_completions}; the
        # completion carries its text under "response".
        completion = reply.get("chat_completion") or {}
        text = completion.get("response") or reply.get("text")
        return {"ok": True, "text": text, "crossed": CANNED is None, "raw": reply}
    except Exception as exc:
        return {"ok": False, "error": "%s: %s" % (type(exc).__name__, exc)}


def db_call(ports, max_len):
    try:
        rpc = make_rpc(ports["db"], "DB_PORT", max_len)
        opened = rpc("DB_PORT", {
            "v": 1, "req_id": "s5-q", "op": "run_query",
            "args": {"sql": REQUEST["read_sql"]},
        })
        handle = opened.get("handle") or {}
        got = rpc("DB_PORT", {
            "v": 1, "req_id": "s5-m", "op": "materialize",
            "args": {"handle": handle},
        })
        return {
            "ok": True,
            "rows": got.get("rows"),
            "handle_kind": handle.get("kind"),
            "crossed": CANNED is None,
        }
    except Exception as exc:
        return {"ok": False, "error": "%s: %s" % (type(exc).__name__, exc)}


def in_namespace_tools():
    """The cheap creds-free tools Tier-0 must not break (BUILD_PLAN 5.5)."""
    import re
    out = {}
    try:
        out["regex"] = bool(re.search(r"al(pha)", "alpha beta"))
    except Exception as exc:
        out["regex_error"] = str(exc)
    try:
        import statistics
        out["stdlib"] = statistics.mean([1, 2, 3]) == 2
    except Exception as exc:
        out["stdlib_error"] = str(exc)
    return out


def run_child(fn):
    """Run `fn` in a forked child, return its JSON result via a pipe."""
    read_fd, write_fd = os.pipe()
    pid = os.fork()
    if pid == 0:
        os.close(read_fd)
        try:
            result = fn()
        except BaseException as exc:
            result = {"child_error": "%s: %s" % (type(exc).__name__, exc)}
        try:
            os.write(write_fd, json.dumps(result).encode())
        finally:
            os.close(write_fd)
            os._exit(0)
    os.close(write_fd)
    chunks = []
    while True:
        chunk = os.read(read_fd, 65536)
        if not chunk:
            break
        chunks.append(chunk)
    os.close(read_fd)
    os.waitpid(pid, 0)
    raw = b"".join(chunks)
    try:
        return json.loads(raw.decode())
    except Exception:
        return {"child_error": "unparseable child output", "raw": raw[:512].decode("replace")}


def baseline():
    """Unhardened: every control must be OPEN here, or the run proves nothing."""
    return {
        "write": try_write(FORBIDDEN),
        "read": try_read(),
        "syscall": try_syscall(),
        "fork": try_fork(FORK_ATTEMPTS),
        "uid": os.getuid(),
    }


def hardened():
    policy = Tier0Policy(
        limits=Tier0Limits(max_processes=FORK_LIMIT),
        # `/proc` is not optional. Without it the first host run applied every
        # control correctly and then reported `Seccomp: -1`, because the
        # read-back of /proc/self/status was itself denied by the ruleset that
        # had just been installed. A worker that cannot read /proc also loses
        # os.cpu_count and multiprocessing, so granting it is what a real
        # deployment does — but the sharp end is that a probe which cannot read
        # its own status has no evidence, only a successful call.
        read_only_roots=("/usr", "/lib", "/lib64", "/bin", "/sbin", "/etc", "/proc", HERE),
        writable_paths=("/tmp",),
        enable_landlock=REQUEST["harden"],
        enable_seccomp=REQUEST["harden"],
        enable_privilege_drop=REQUEST["harden"],
        enable_rlimits=REQUEST["harden"],
    )
    report = apply_tier0(policy).as_dict() if REQUEST["harden"] else {"skipped": True}
    ports = REQUEST["ports"]
    max_len = REQUEST["max_frame_len"]
    return {
        "tier0": report,
        "write": try_write(FORBIDDEN),
        "read": try_read(),
        "syscall": try_syscall(),
        "fork": try_fork(FORK_ATTEMPTS),
        "tools": in_namespace_tools(),
        "lm": lm_call(ports, max_len),
        "db": db_call(ports, max_len) if REQUEST["db_channel"] else {"skipped": True},
        "uid": os.getuid(),
    }


def main():
    out = {
        "environment": observe_environment(),
        "baseline": run_child(baseline),
        "hardened": run_child(hardened),
        "harden_requested": REQUEST["harden"],
    }
    print("S5_RESULT " + json.dumps(out))


main()
'''


# ---------------------------------------------------------------------------
# Assessors — the host-side verdict logic, unit-tested off-host
# ---------------------------------------------------------------------------


def assess_baseline(guest: dict, failures: list[str]) -> dict:
    """Claim 1: the unhardened arm is genuinely dangerous.

    This is the positive control for the whole spike. If the baseline is already
    safe, then every "denied" in the hardened arm is being produced by something
    other than Tier-0 and the run has measured nothing. Each of the three is
    checked separately because they fail independently - a guest image that
    happens to mount `/var/tmp` read-only would silence only the write half.
    """
    baseline = guest.get("baseline", {})
    record = {
        "write_succeeded": bool(baseline.get("write", {}).get("wrote")),
        "syscall_permitted": baseline.get("syscall", {}).get("rc") == 0,
        "fork_uncapped": not baseline.get("fork", {}).get("capped"),
        "forked": baseline.get("fork", {}).get("forked"),
    }
    if not record["write_succeeded"]:
        failures.append(
            f"the unhardened baseline could NOT write {FORBIDDEN_WRITE_PATH}: something "
            "other than Landlock is already denying it, so the hardened arm's denial "
            "is not evidence of Landlock"
        )
    if not record["syscall_permitted"]:
        failures.append(
            f"the unhardened baseline could not call {PROBE_SYSCALL_NAME}: something other "
            "than seccomp is already denying it, so the hardened arm's EPERM is not "
            "evidence of the filter"
        )
    if not record["fork_uncapped"]:
        failures.append(
            "the unhardened baseline's fork bomb was already capped at "
            f"{baseline.get('fork', {}).get('refused_at')}: the hardened arm's cap is "
            "not evidence of RLIMIT_NPROC"
        )
    return record


def assess_cgroup_finding(guest: dict, failures: list[str]) -> dict:
    """Claim 2: re-derive the cgroup finding rather than cite it.

    A finding that changed a ratified control should be re-checkable by running
    the probe, not only by trusting the session that first observed it. This
    assessor never fails the run: if a future host *does* mount cgroupfs in the
    guest, that is news about the record, not a broken probe, and it is reported
    as such.
    """
    environment = guest.get("environment", {})
    mounted = bool(environment.get("cgroupfs_mounted"))
    return {
        "cgroupfs_mounted": mounted,
        "cgroup_self": environment.get("cgroup_self"),
        "landlock_abi": environment.get("landlock_abi"),
        "kernel": environment.get("kernel"),
        "cap_effective": environment.get("cap_effective"),
        "note": (
            "the records name in-guest cgroups as requirement 8's enforcing surface; "
            "measured here as unavailable, which is why hardening.py uses setrlimit "
            "after a privilege drop instead"
            if not mounted
            else "cgroupfs IS mounted on this host - the hardening.py finding needs "
            "revisiting against this environment"
        ),
    }


def assess_tier0_applied(guest: dict, failures: list[str]) -> dict:
    """The report Tier-0 read back from the kernel, before any behavioural check.

    Separate from claims 3-5 on purpose: "the filter is installed" and "the
    filter denies the call" are different statements, and a probe that only
    checked the first would pass on a filter that permits everything.
    """
    tier0 = guest.get("hardened", {}).get("tier0", {})
    record = {
        "steps": tier0.get("steps"),
        "failures": tier0.get("failures"),
        "uid": tier0.get("uid"),
        "seccomp_mode": tier0.get("seccomp_mode"),
        "seccomp_filters": tier0.get("seccomp_filters"),
        "no_new_privs": tier0.get("no_new_privs"),
        "landlock_rules": tier0.get("landlock_rules"),
        "processes_capped": tier0.get("processes_capped"),
    }
    for failure in tier0.get("failures") or []:
        failures.append(f"Tier-0 step failed: {failure}")
    if tier0.get("uid") == 0:
        failures.append(
            "the hardened worker is still uid 0: root is exempt from RLIMIT_NPROC, so "
            "the fork cap cannot bite however the limit reads"
        )
    if tier0.get("seccomp_mode") != 2:
        failures.append(
            f"/proc/self/status reports Seccomp: {tier0.get('seccomp_mode')}, not 2 "
            "(filter mode): the seccomp call returned success without installing a filter"
        )
    if not tier0.get("landlock_rules"):
        failures.append("no Landlock path rules were added; the ruleset grants nothing")
    return record


def assess_enforcement(guest: dict, failures: list[str]) -> dict:
    """Claims 3, 4 and 5: each control observed *denying* something.

    The read-back check is deliberately paired with a liveness check in each
    case - a denied write with broken reads, or a blocked syscall with a dead
    process, would be a sandbox that stopped rather than a sandbox that held.
    """
    hardened = guest.get("hardened", {})
    fork = hardened.get("fork", {})
    syscall = hardened.get("syscall", {})
    write = hardened.get("write", {})
    read = hardened.get("read", {})
    tools = hardened.get("tools", {})

    record = {
        "fork_capped": bool(fork.get("capped")),
        "fork_refused_at": fork.get("refused_at"),
        "syscall_denied": syscall.get("rc") == -1 and syscall.get("errno") == 1,
        "syscall_errno": syscall.get("errno"),
        "write_denied": not write.get("wrote"),
        "write_errno": write.get("errno"),
        "read_still_works": bool(read.get("read")),
        "tools_ok": bool(tools.get("regex")) and bool(tools.get("stdlib")),
    }

    if not record["fork_capped"]:
        failures.append(
            f"the fork bomb was NOT capped: {fork.get('forked')} processes created "
            f"against a limit of {FORK_LIMIT}"
        )
    elif fork.get("refused_at", 0) > FORK_LIMIT:
        failures.append(
            f"the fork bomb was capped at {fork.get('refused_at')}, above the limit "
            f"{FORK_LIMIT}: the cap is not the one that was set"
        )
    if not record["syscall_denied"]:
        failures.append(
            f"{PROBE_SYSCALL_NAME} was not denied by the seccomp filter: "
            f"rc={syscall.get('rc')} errno={syscall.get('errno')} (EPERM=1 expected)"
        )
    if not record["write_denied"]:
        failures.append(
            f"the hardened worker wrote {FORBIDDEN_WRITE_PATH}: Landlock is not "
            "restricting the filesystem"
        )
    if not record["read_still_works"]:
        failures.append(
            "the hardened worker cannot read /etc/hostname: Landlock denied a granted "
            "root, so the sandbox stopped rather than held"
        )
    if not record["tools_ok"]:
        failures.append(
            f"the cheap in-namespace tools did not survive hardening: {tools}"
        )
    return record


def assess_channels(
    guest: dict, witness_accepted: int, db_channel: bool, failures: list[str]
) -> dict:
    """Claim 6: both channels still cross, from inside the hardened worker.

    The witness count is the load-bearing half and the only one a guest
    answering itself cannot forge. Expected crossings: one for the LM call, two
    for the DB pair (`run_query` then `materialize`).
    """
    hardened = guest.get("hardened", {})
    lm = hardened.get("lm", {})
    db = hardened.get("db", {})
    expected = 1 + (2 if db_channel else 0)

    record = {
        "witness_accepted": witness_accepted,
        "witness_expected": expected,
        "lm_ok": bool(lm.get("ok")),
        "lm_text": lm.get("text"),
        "db_ok": bool(db.get("ok")) if db_channel else None,
        "db_rows": db.get("rows") if db_channel else None,
        "both_listeners_open": db_channel,
    }
    if witness_accepted < expected:
        failures.append(
            f"the host accepted {witness_accepted} connections but the hardened worker "
            f"makes {expected}: nothing crossed, so the channels were not shown to "
            "survive hardening"
        )
    if not lm.get("ok"):
        failures.append(f"the LM channel failed from the hardened worker: {lm.get('error')}")
    elif not lm.get("text"):
        failures.append("the LM channel returned no text from the hardened worker")
    if db_channel:
        if not db.get("ok"):
            failures.append(f"the DB channel failed from the hardened worker: {db.get('error')}")
        elif db.get("rows") != s4.FIXTURE_ROWS:
            failures.append(
                f"the DB channel returned {db.get('rows')!r}, not the fixture "
                f"{s4.FIXTURE_ROWS!r}"
            )
    return record


def assess_watchdog(outcome: dict, failures: list[str]) -> dict:
    """Claim 7: an unresponsive VM is detected and reaped from a clean slot.

    **Scope, stated rather than implied:** unresponsiveness is produced by a
    guest exec that never returns, not by a genuinely wedged Kata shim - that
    condition shows up on this host about twice in thirteen runs and cannot be
    summoned on demand. So this exercises the detect-and-reap mechanism against
    a faithful *symptom*, and says nothing about shim states the reaper has not
    met. The reap itself is the real thing: the same kill path, verified by the
    VMM process and container record being gone.
    """
    record = dict(outcome)
    if not outcome.get("detected"):
        failures.append(
            "the watchdog did not detect the unresponsive guest within "
            f"{WATCHDOG_TIMEOUT_S}s"
        )
    if not outcome.get("reaped"):
        failures.append(f"the watchdog did not reap the wedged VM: {outcome}")
    if outcome.get("vmm_processes"):
        failures.append(
            f"a VMM process survived the reap: {outcome.get('vmm_processes')}"
        )
    return record


def assess_teardown(outcome: dict, failures: list[str]) -> dict:
    """Claim 8: nothing is left behind, including the cgroup directories.

    The cgroup half is new to S5. S3 and S4 both checked containers and VMM
    processes and both left `/sys/fs/cgroup/default/kata_<id>` directories
    behind - visible on the host as accumulated `kata_s3-*` and `kata_s4-*`
    entries. Cosmetic, but "clean teardown" that does not check a surface is a
    claim about the surfaces it happened to look at.
    """
    record = dict(outcome)
    if outcome.get("container_listed"):
        failures.append("the container record survived teardown")
    if outcome.get("vmm_processes"):
        failures.append(f"a VMM process survived teardown: {outcome.get('vmm_processes')}")
    if outcome.get("listener_sockets"):
        failures.append(f"a listener socket survived teardown: {outcome.get('listener_sockets')}")
    if outcome.get("cgroup_dirs"):
        record["cgroup_residue_note"] = (
            "per-sandbox cgroup directories survived; S3 and S4 left these too"
        )
    return record


def assess_falsifier(guest: dict, mode: str, failures: list[str]) -> list[str]:
    """Turn the failures of a falsifier arm into the arm's success condition.

    In `--no-harden` the enforcement claims are *expected* to fail; the arm
    passes when they do and fails when they do not. Reported as a distinct
    verdict rather than by inverting the exit code somewhere, so a reader of the
    output can see which arm ran and what it was supposed to show.
    """
    hardened = guest.get("hardened", {})
    unmet: list[str] = []
    if mode == "no-harden":
        if hardened.get("fork", {}).get("capped"):
            unmet.append("the fork bomb was capped with hardening disabled")
        if hardened.get("syscall", {}).get("rc") != 0:
            unmet.append(f"{PROBE_SYSCALL_NAME} was denied with hardening disabled")
        if not hardened.get("write", {}).get("wrote"):
            unmet.append("the forbidden write was denied with hardening disabled")
    return unmet


# ---------------------------------------------------------------------------
# The watchdog
# ---------------------------------------------------------------------------


class Watchdog:
    """Host-side reaper for a guest that has stopped answering.

    Deliberately host-side and deliberately dumb: liveness is "an exec returns
    within the timeout", and the response is Kata's own kill path plus the shim
    SIGKILL that S3 found is what actually unblocks a wedged containerd. It
    holds no opinion about *why* a guest went silent, because every diagnosis it
    could attempt runs through the same channel that is already not answering.
    """

    def __init__(self, sandbox, timeout_s: float = WATCHDOG_TIMEOUT_S) -> None:
        self.sandbox = sandbox
        self.timeout_s = timeout_s

    def alive(self) -> bool:
        """True when the guest answers a trivial exec inside the timeout."""
        try:
            self.sandbox.exec(
                "true", exec_id=f"wd-{uuid.uuid4().hex[:8]}", timeout=self.timeout_s
            )
            return True
        except (subprocess.TimeoutExpired, probe.ProbeError, subprocess.CalledProcessError):
            return False

    def reap(self) -> dict:
        """Destroy the sandbox and report what is left."""
        self.sandbox.destroy()
        time.sleep(1.0)
        return {
            "vmm_processes": self.sandbox.vmm_processes(),
            "container_listed": self.sandbox.listed(),
        }


def run_watchdog_claim(image: str) -> dict:
    """Claim 7 in its own throwaway sandbox.

    Isolated so that a wedge here - on a host that produces real ones
    unbidden - cannot take down the sandbox carrying the Tier-0 claims.

    **The unresponsive state is real, not simulated by a slow command.**
    `SIGSTOP` on the VMM process freezes the guest exactly as a wedge does: the
    vCPUs stop, and every `ctr task exec` against it hangs until its timeout.
    That is producible on demand, unlike the shim wedge this host throws about
    twice in thirteen runs, and it exercises the same detect-then-reap path. The
    liveness probe must report *alive before* and *not alive after* - the pair
    is the claim, because a probe that never returns True has not shown it can
    tell the two apart.
    """
    name = f"s5wd-{uuid.uuid4().hex[:10]}"
    sandbox = probe.Sandbox(name, image)
    outcome: dict = {"sandbox": name}
    try:
        sandbox.boot()
        time.sleep(2.0)
        watchdog = Watchdog(sandbox, timeout_s=WATCHDOG_TIMEOUT_S)

        outcome["alive_before"] = watchdog.alive()
        vmm_pids = _vmm_pids(name)
        outcome["vmm_pids"] = vmm_pids
        if not vmm_pids:
            outcome["error"] = "no VMM process found for the sandbox; nothing to freeze"
            outcome["detected"] = False
            outcome["reaped"] = False
            return outcome

        for pid in vmm_pids:
            os.kill(pid, 19)  # SIGSTOP — freeze the VM
        outcome["frozen"] = True

        started = time.monotonic()
        alive_after = Watchdog(sandbox, timeout_s=WATCHDOG_TIMEOUT_S).alive()
        outcome["alive_after_freeze"] = alive_after
        outcome["detect_seconds"] = round(time.monotonic() - started, 2)
        # Detection is the *transition*: responsive before, unresponsive after.
        outcome["detected"] = bool(outcome["alive_before"]) and not alive_after

        for pid in vmm_pids:  # let the reaper work against a running VMM
            try:
                os.kill(pid, 18)  # SIGCONT
            except OSError:
                pass
        outcome.update(watchdog.reap())
        outcome["reaped"] = not outcome["container_listed"] and not outcome["vmm_processes"]
    except Exception as error:  # noqa: BLE001 - reported, never masked
        outcome["error"] = f"{type(error).__name__}: {error}"
        outcome["reaped"] = False
    finally:
        try:
            for pid in _vmm_pids(name):
                try:
                    os.kill(pid, 18)
                except OSError:
                    pass
            sandbox.destroy()
        except Exception:  # noqa: BLE001
            pass
    return outcome


def _vmm_pids(sandbox_name: str) -> list[int]:
    """PIDs of the Cloud Hypervisor processes belonging to one sandbox."""
    found = probe.run(
        ["pgrep", "-f", f"cloud-hypervisor.*{sandbox_name}"], check=False, timeout=15.0
    )
    pids: list[int] = []
    for token in found.stdout.split():
        try:
            pids.append(int(token))
        except ValueError:
            continue
    return pids


def stale_cgroup_dirs(prefix: str = "kata_") -> list[str]:
    """Per-sandbox cgroup directories still present on the host."""
    found: list[str] = []
    for root in ("/sys/fs/cgroup/default", "/sys/fs/cgroup/kata_overhead"):
        try:
            for entry in os.listdir(root):
                if entry.startswith(prefix) or root.endswith("kata_overhead"):
                    found.append(os.path.join(root, entry))
        except OSError:
            continue
    return found


# ---------------------------------------------------------------------------
# Entry
# ---------------------------------------------------------------------------


def install_guest_payload(sandbox, request: dict, canned: dict | None) -> None:
    """Ship only what S5 runs: the package, the guest program, the request.

    Deliberately not S3's `install_sources`, which also ships S3's guest probe,
    control listener and request JSON — none of which S5 executes. S4 recorded
    why: each is several chunked `ctr task exec` calls, and this host wedges
    `task exec` intermittently, so every exec removed is one fewer window on
    that flake. Shipping less is a reliability property.
    """
    sandbox.put_bytes(probe.source_tarball(), f"{GUEST_DIR}/repl_sandbox.tgz")
    sandbox.exec(
        f"cd {GUEST_DIR} && tar xzf repl_sandbox.tgz && python3 -c "
        f"'import sys; sys.path.insert(0, \"{GUEST_DIR}\"); import repl_sandbox'",
        exec_id="unpack",
    )
    sandbox.put_bytes(GUEST_S5_SOURCE.encode(), f"{GUEST_DIR}/guest_s5.py")
    sandbox.put_bytes(json.dumps(request).encode(), f"{GUEST_DIR}/request.json")
    if canned is not None:
        sandbox.put_bytes(json.dumps(canned).encode(), f"{GUEST_DIR}/canned.json")


def _canned_replies() -> dict:
    """Replies the negative-control guest answers itself with.

    Built from the same fixture the crossing run returns, so the fabricated
    result is byte-plausible: the control tests a guest replaying a *correct*
    protocol, which is what a cheating guest would actually do.
    """
    return {
        "llm_query": {"chat_completion": {"response": "S3-OK"}},
        "run_query": {
            "handle": {"id": "canned-handle", "kind": "result-set"},
            "rowcount": len(s4.FIXTURE_ROWS),
        },
        "materialize": {"rows": s4.FIXTURE_ROWS, "truncated": False},
    }


def probe_s5(
    image: str,
    *,
    harden: bool,
    negative_control: bool,
    db_channel: bool,
    keep: bool,
) -> tuple[dict, list[str]]:
    """Run the S5 claims. Returns (record, failures)."""
    mode = "no-harden" if not harden else ("negative-control" if negative_control else "default")
    record: dict = {"mode": mode, "db_channel": db_channel}
    failures: list[str] = []
    record["host"] = probe.preconditions()

    config = SandboxConfig()
    audit = AuditLog()
    backends = {}
    fixture = None
    if db_channel:
        fixture = s4.PostgresFixture(external=False)
        fixture.setup(config.broker_caps)
        record["postgres"] = dict(fixture.facts)
        backends["postgres"] = s4.postgres_backend_from_env(config.broker_caps)

    host = TrellisSandboxHost(
        config=config,
        backends=backends,
        provider=probe.ScriptedProvider(),
        audit=audit,
    )
    host.open_session(
        GUEST_CID,
        "s5-guest",
        ops=("run_query", "materialize") if db_channel else (),
        lm=True,
    )

    name = f"s5-{uuid.uuid4().hex[:10]}"
    sandbox = probe.Sandbox(name, image)
    record["sandbox"] = name
    record["image"] = image

    witness = probe.Witness()
    stop = threading.Event()
    listeners: list = []
    servers: list[threading.Thread] = []

    sandbox.boot()
    try:
        record["guest"] = sandbox.guest_identity()
        if record["guest"]["kernel"] == record["host"]["host_kernel"]:
            failures.append(
                f"guest kernel equals host kernel ({record['guest']['kernel']}): "
                "this is not a VM boundary"
            )

        discovered = probe.discover_vsock_uds(sandbox)
        record["bridge"] = {"kind": "hybrid", **discovered}

        # -- BOTH listeners, at once. The thing neither S3 nor S4 showed. -----
        wanted = [(config.ports.lm, host.lm_handler)]
        if db_channel:
            wanted.append((config.ports.db, host.broker_handler))
        for port, handler in wanted:
            listener = HybridVsockListener(
                discovered["uds_path"], port, GUEST_CID,
                accept_timeout_s=0.05, read_timeout_s=60.0,
            )
            listeners.append(listener)
            server = threading.Thread(
                target=serve_forever,
                args=(
                    listener,
                    witness.counted(handler),
                    config.max_frame_len,
                    witness.audit,
                    stop,
                ),
                daemon=True,
            )
            server.start()
            servers.append(server)
        record["bridge"]["listen_paths"] = [item.path for item in listeners]
        record["bridge"]["ports"] = [port for port, _ in wanted]

        request = {
            "harden": harden,
            "db_channel": db_channel,
            "ports": {"lm": config.ports.lm, "db": config.ports.db},
            "max_frame_len": config.max_frame_len,
            "prompt": probe.PROBE_REQUEST["prompt"],
            "read_sql": s4.READ_SQL,
            "forbidden_write_path": FORBIDDEN_WRITE_PATH,
            "probe_syscall_nr": PROBE_SYSCALL_NR,
            "fork_limit": FORK_LIMIT,
            "fork_attempts": FORK_ATTEMPTS,
        }
        install_guest_payload(
            sandbox, request, _canned_replies() if negative_control else None
        )

        raw = sandbox.exec(
            f"cd {GUEST_DIR} && python3 guest_s5.py",
            exec_id=f"s5-{uuid.uuid4().hex[:8]}",
            timeout=240.0,
        )
        line = next(
            (ln for ln in raw.splitlines() if ln.startswith("S5_RESULT ")), None
        )
        if line is None:
            raise probe.ProbeError(f"the guest produced no parsable report: {raw!r}")
        guest = json.loads(line[len("S5_RESULT "):])
        record["guest_report"] = guest

        # -- the verdicts -----------------------------------------------------
        record["baseline"] = assess_baseline(guest, failures)
        record["cgroup_finding"] = assess_cgroup_finding(guest, failures)
        if harden:
            record["tier0"] = assess_tier0_applied(guest, failures)
            record["enforcement"] = assess_enforcement(guest, failures)
        time.sleep(0.5)  # let the listener threads finish their accounting
        record["channels"] = assess_channels(
            guest, witness.accepted, db_channel, failures
        )
        record["witness"] = {
            "accepted": witness.accepted,
            "requests": witness.requests,
            "events": witness.named(),
        }
    finally:
        stop.set()
        for server in servers:
            server.join(timeout=5.0)
        for listener in listeners:
            try:
                listener.close()
            except Exception:  # noqa: BLE001 - teardown must not mask
                pass
        try:
            host.close_session(GUEST_CID)
        except Exception:  # noqa: BLE001
            pass
        if not keep:
            sandbox.destroy()
        if fixture is not None:
            try:
                fixture.teardown()
            except Exception:  # noqa: BLE001
                pass

    if not keep:
        record["teardown"] = assess_teardown(
            {
                "container_listed": sandbox.listed(),
                "vmm_processes": sandbox.vmm_processes(),
                "listener_sockets": [
                    item.path for item in listeners if os.path.exists(item.path)
                ],
                "cgroup_dirs": [d for d in stale_cgroup_dirs() if name in d],
            },
            failures,
        )
    return record, failures


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="S5 Tier-0 hardening probe")
    parser.add_argument("--image", default=probe.DEFAULT_IMAGE)
    parser.add_argument("--no-harden", action="store_true", help="the falsifier arm")
    parser.add_argument("--negative-control", action="store_true")
    parser.add_argument("--no-db-channel", action="store_true")
    parser.add_argument("--skip-watchdog", action="store_true")
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    harden = not args.no_harden
    try:
        record, failures = probe_s5(
            args.image,
            harden=harden,
            negative_control=args.negative_control,
            db_channel=not args.no_db_channel,
            keep=args.keep,
        )
        if harden and not args.skip_watchdog:
            record["watchdog"] = assess_watchdog(run_watchdog_claim(args.image), failures)
    except probe.ProbeError as error:
        # An infrastructure failure is NOT a failed claim, and must never read
        # like one. S4 found a bare traceback here that read as though the
        # boundary had broken when the host had merely wedged an exec.
        print(f"COULD NOT RUN: {error}", file=sys.stderr)
        print("This is an infrastructure failure, not a failed claim. Re-run.", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(record, indent=2, default=str))

    unmet = assess_falsifier(record.get("guest_report", {}), record["mode"], [])
    if record["mode"] == "no-harden":
        # The falsifier arm passes by FAILING the enforcement claims.
        if unmet:
            print("FALSIFIER DID NOT FIRE:", file=sys.stderr)
            for item in unmet:
                print(f"  - {item}", file=sys.stderr)
            return 1
        print("DETECTED: with Tier-0 disabled the enforcement claims fail, as they must.")
        return 3
    if record["mode"] == "negative-control":
        crossed = record.get("channels", {}).get("witness_accepted", 0)
        if crossed:
            print(
                f"NEGATIVE CONTROL DID NOT FIRE: {crossed} connections reached the host",
                file=sys.stderr,
            )
            return 1
        print("DETECTED: the guest answered itself; only the host witness caught it.")
        return 3

    if failures:
        print("S5 FAILED:", file=sys.stderr)
        for item in failures:
            print(f"  - {item}", file=sys.stderr)
        return 1
    # Name the arm that actually ran. A pass line that claims more than the run
    # covered is how a scope limit rots into a claim.
    channels = "the LM and DB channels" if not args.no_db_channel else "the LM channel"
    watchdog = "" if record.get("watchdog") else "; watchdog NOT run"
    print(f"S5 PASSED: Tier-0 holds and {channels} survive it{watchdog}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
