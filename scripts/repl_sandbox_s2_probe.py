"""REPL-sandbox S2 probe: boundary + persistence, on a real KVM host.

Specification: docs/product/repl-sandbox/REPL_SANDBOX_BUILD_PLAN.md section 5.2
(S2 - Boundary + persistence). The exit acceptance recorded there is exactly
what this script executes: `ctr run --runtime io.containerd.kata.v2` boots the
guest; a scripted probe sets a variable, then reads it a later turn; teardown is
clean.
Entrypoint: `npm run repl-sandbox:s2-probe` (the non-test caller, AGENTS.md
section 4 rule 15).

**This script only runs on the provisioned Linux host.** It shells out to `ctr`
and reads `/dev/kvm`; on the Windows development box it refuses in its first
check rather than emulating anything. G1 (BUILD_PLAN section 4) is its entry
precondition and is re-checked here in the cheap form - the acceleration
differential belongs to `repl_sandbox.cli preflight`, not here.

What is being proved, in three separable claims:

  1. **Boundary.** The turns run inside a different kernel than the host's, in a
     VM whose Cloud Hypervisor process the host can see. A container runtime
     that quietly fell back to runc would pass a persistence test just as well,
     so kernel identity is asserted before persistence is even attempted.
  2. **Persistence.** One long-lived Python process in the guest holds a
     namespace across turns delivered as separate `ctr task exec` calls: a
     variable set in turn 1 is still live in turn 5, and the worker's PID and
     the guest's boot id do not move underneath it.
  3. **Clean teardown.** After delete, the container is gone from containerd and
     no Cloud Hypervisor process for that sandbox survives.

Modes:
  default             boot once, run every turn, assert all three claims
  --negative-control  destroy and re-boot the guest between turns 2 and 3 with
                      everything else identical. The persistence claim must then
                      FAIL and this script must SAY SO: exit 3 is the healthy
                      result. Exit 0 means the probe cannot tell a persistent
                      guest from a fresh one and therefore proves nothing
                      (AGENTS.md section 4 rule 19(c)).
  --keep              leave the sandbox running (skips the teardown claim)
  --json              emit the observation record as JSON on stdout
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import shlex
import subprocess
import sys
import time
import uuid

RUNTIME = "io.containerd.kata.v2"
DEFAULT_IMAGE = "docker.io/library/python:3.12-slim"
GUEST_DIR = "/run/s2"
IN_FIFO = f"{GUEST_DIR}/in"
OUT_FIFO = f"{GUEST_DIR}/out"

# The guest-side worker: one process, one namespace, many turns. It is the
# skeleton of `IsolatedEnv.execute_code` and nothing more - no capabilities, no
# broker, no vsock. Those are S3/S4.
WORKER_SOURCE = r'''
import json, os, sys, traceback

NS = {}
BOOT_ID = open("/proc/sys/kernel/random/boot_id").read().strip()
IN, OUT = "/run/s2/in", "/run/s2/out"

while True:
    with open(IN) as handle:
        code = handle.read()
    if not code.strip():
        continue
    reply = {"pid": os.getpid(), "boot_id": BOOT_ID, "kernel": os.uname().release}
    stdout = []
    try:
        NS["__print__"] = stdout.append
        exec(compile(code, "<turn>", "exec"), NS)
        reply["ok"] = True
    except Exception:
        reply["ok"] = False
        reply["error"] = traceback.format_exc()
    reply["stdout"] = stdout
    reply["names"] = sorted(k for k in NS if not k.startswith("__"))
    with open(OUT, "w") as handle:
        handle.write(json.dumps(reply) + "\n")
'''


class ProbeError(RuntimeError):
    """A precondition or a probe step failed for an infrastructural reason.

    Kept apart from a failed *claim*: this is "the probe could not run", not
    "the boundary is not there".
    """


def run(argv: list[str], *, timeout: float = 120.0, check: bool = True) -> subprocess.CompletedProcess:
    completed = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
    if check and completed.returncode != 0:
        raise ProbeError(
            f"{shlex.join(argv)} exited {completed.returncode}\n"
            f"stdout: {completed.stdout.strip()}\nstderr: {completed.stderr.strip()}"
        )
    return completed


def preconditions() -> dict:
    """Re-check the cheap half of G1 and the tools this probe needs."""
    facts: dict = {}
    if not os.path.exists("/dev/kvm"):
        raise ProbeError(
            "/dev/kvm is absent: this is not a KVM host and S2 cannot run here. "
            "The Windows development box is expected to fail exactly here."
        )
    facts["kvm"] = True
    facts["host_kernel"] = os.uname().release
    facts["host_boot_id"] = open("/proc/sys/kernel/random/boot_id").read().strip()
    facts["kata_runtime"] = run(["kata-runtime", "--version"]).stdout.splitlines()[0].strip()
    facts["cloud_hypervisor"] = run(["cloud-hypervisor", "--version"]).stdout.strip()
    facts["containerd"] = run(["containerd", "--version"]).stdout.strip()
    return facts


class Sandbox:
    """One `ctr` container running on the Kata runtime, addressed by name."""

    def __init__(self, name: str, image: str) -> None:
        self.name = name
        self.image = image

    def boot(self) -> None:
        run(
            [
                "ctr", "run", "-d", "--runtime", RUNTIME,
                self.image, self.name, "sleep", "infinity",
            ],
            timeout=180.0,
        )

    def exec(self, script: str, *, exec_id: str, detach: bool = False, timeout: float = 120.0) -> str:
        argv = ["ctr", "task", "exec", "--exec-id", exec_id]
        if detach:
            argv.append("-d")
        argv += [self.name, "sh", "-c", script]
        return run(argv, timeout=timeout).stdout

    def install_worker(self) -> None:
        payload = base64.b64encode(WORKER_SOURCE.encode()).decode()
        self.exec(
            f"mkdir -p {GUEST_DIR} && "
            f"printf %s {payload} | base64 -d > {GUEST_DIR}/worker.py && "
            f"([ -p {IN_FIFO} ] || mkfifo {IN_FIFO}) && ([ -p {OUT_FIFO} ] || mkfifo {OUT_FIFO})",
            exec_id="install",
        )
        self.exec(
            f"setsid python3 -u {GUEST_DIR}/worker.py </dev/null >/dev/null 2>{GUEST_DIR}/worker.err &",
            exec_id="worker",
            detach=True,
        )
        time.sleep(1.0)

    def turn(self, code: str, *, index: int) -> dict:
        payload = base64.b64encode(code.encode()).decode()
        raw = self.exec(
            f"printf %s {payload} | base64 -d > {IN_FIFO}; cat {OUT_FIFO}",
            exec_id=f"turn{index}-{uuid.uuid4().hex[:8]}",
            timeout=60.0,
        )
        try:
            return json.loads(raw.strip().splitlines()[-1])
        except (ValueError, IndexError) as exc:
            raise ProbeError(f"turn {index} produced no parsable reply: {raw!r}") from exc

    def guest_identity(self) -> dict:
        raw = self.exec(
            "cat /proc/sys/kernel/random/boot_id; uname -r",
            exec_id=f"ident-{uuid.uuid4().hex[:8]}",
        ).split()
        return {"boot_id": raw[0], "kernel": raw[1]}

    def vmm_processes(self) -> list[str]:
        found = run(["pgrep", "-af", "cloud-hypervisor"], check=False).stdout.splitlines()
        return [line for line in found if self.name in line]

    def destroy(self) -> None:
        run(["ctr", "task", "kill", "-s", "SIGKILL", "-a", self.name], check=False, timeout=60.0)
        time.sleep(1.0)
        run(["ctr", "task", "delete", "-f", self.name], check=False, timeout=60.0)
        run(["ctr", "container", "delete", self.name], check=False, timeout=60.0)

    def listed(self) -> bool:
        listing = run(["ctr", "containers", "ls", "-q"], check=False).stdout.split()
        return self.name in listing


def probe(image: str, *, negative_control: bool, keep: bool) -> tuple[dict, list[str]]:
    """Run the three claims. Returns (record, failures)."""
    record: dict = {"mode": "negative-control" if negative_control else "default"}
    failures: list[str] = []
    record["host"] = preconditions()
    name = f"s2-{uuid.uuid4().hex[:10]}"
    sandbox = Sandbox(name, image)
    record["sandbox"] = name
    record["image"] = image

    started = time.monotonic()
    sandbox.boot()
    # Two different numbers, kept apart because only the second one is a boot:
    # `ctr run -d` returns when the shim has accepted the task, which is not the
    # same instant the guest can run a command.
    record["ctr_run_detached_seconds"] = round(time.monotonic() - started, 3)
    try:
        # -- claim 1: boundary ------------------------------------------------
        identity = sandbox.guest_identity()
        record["boot_to_first_exec_seconds"] = round(time.monotonic() - started, 3)
        record["guest"] = identity
        if identity["kernel"] == record["host"]["host_kernel"]:
            failures.append(
                "guest kernel equals host kernel "
                f"({identity['kernel']}): this is not a VM boundary"
            )
        if identity["boot_id"] == record["host"]["host_boot_id"]:
            failures.append("guest boot id equals host boot id: same kernel, no boundary")
        record["vmm_processes"] = sandbox.vmm_processes()
        if not record["vmm_processes"]:
            failures.append("no cloud-hypervisor process on the host carries this sandbox id")

        # -- claim 2: persistence ---------------------------------------------
        sandbox.install_worker()
        turns: list[dict] = []
        turns.append(sandbox.turn("x = 41", index=1))
        turns.append(sandbox.turn("x += 1", index=2))

        if negative_control:
            # Everything below is identical; only the guest is replaced. The
            # persistence claim MUST fail from here.
            sandbox.destroy()
            sandbox.boot()
            sandbox.install_worker()
            record["negative_control_reboot"] = True

        turns.append(sandbox.turn("__print__(repr(x))", index=3))
        turns.append(sandbox.turn("y = x * 2", index=4))
        turns.append(sandbox.turn("__print__(f'{x},{y}')", index=5))
        record["turns"] = turns

        broken = [t for t in turns if not t.get("ok")]
        if broken:
            failures.append(
                f"{len(broken)} of {len(turns)} turns raised in the guest; first: "
                + broken[0].get("error", "").strip().splitlines()[-1]
            )
        else:
            final = turns[-1]["stdout"]
            if final != ["42,84"]:
                failures.append(
                    f"turn 5 read {final!r}, expected ['42,84']: the namespace did not survive"
                )
        pids = {t["pid"] for t in turns}
        boots = {t["boot_id"] for t in turns}
        record["worker_pids"] = sorted(pids)
        record["guest_boot_ids"] = sorted(boots)
        if len(pids) != 1:
            failures.append(f"the worker process changed across turns: pids {sorted(pids)}")
        if len(boots) != 1:
            failures.append(f"the guest was replaced across turns: boot ids {sorted(boots)}")

        # -- claim 3: teardown -------------------------------------------------
        if keep:
            record["teardown"] = "skipped (--keep)"
        else:
            sandbox.destroy()
            time.sleep(2.0)
            record["teardown"] = {
                "listed_after_delete": sandbox.listed(),
                "vmm_processes_after_delete": sandbox.vmm_processes(),
            }
            if record["teardown"]["listed_after_delete"]:
                failures.append("the container is still listed by containerd after delete")
            if record["teardown"]["vmm_processes_after_delete"]:
                failures.append("a cloud-hypervisor process for this sandbox survived teardown")
    finally:
        if not keep:
            sandbox.destroy()

    return record, failures


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--image", default=DEFAULT_IMAGE)
    parser.add_argument("--negative-control", action="store_true")
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    try:
        record, failures = probe(args.image, negative_control=args.negative_control, keep=args.keep)
    except ProbeError as exc:
        print(f"S2 probe could not run: {exc}", file=sys.stderr)
        return 1

    record["failures"] = failures
    if args.json:
        print(json.dumps(record, indent=2))
    else:
        print(f"sandbox      {record['sandbox']} ({record['image']})")
        print(f"host kernel  {record['host']['host_kernel']}")
        print(f"guest kernel {record.get('guest', {}).get('kernel')}")
        print(f"boot         {record['ctr_run_detached_seconds']}s to detach, "
              f"{record.get('boot_to_first_exec_seconds')}s to first exec")
        for index, turn in enumerate(record.get("turns", []), start=1):
            print(f"  turn {index}: ok={turn.get('ok')} pid={turn.get('pid')} "
                  f"stdout={turn.get('stdout')} names={turn.get('names')}")
        print(f"teardown     {record.get('teardown')}")
        for failure in failures:
            print(f"FAIL  {failure}")

    if args.negative_control:
        if failures:
            print("negative control: DETECTED - the probe can tell a fresh guest "
                  "from a persistent one.")
            return 3
        print("negative control: ABSORBED - the probe passed a guest that was "
              "destroyed mid-run. It proves nothing.", file=sys.stderr)
        return 1
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
