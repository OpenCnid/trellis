"""REPL-sandbox S3 probe: `llm_query` across the guest boundary, on a real host.

Specification: docs/product/repl-sandbox/REPL_SANDBOX_BUILD_PLAN.md section 5.3
(S3 - `llm_query` over vsock). The [R] exit acceptance recorded there is what this
script executes: a scripted `llm_query` frame round-trips guest->host over vsock
with byte parity to the loopback path, and within a latency budget.
Entrypoint: `npm run repl-sandbox:s3-probe` (the non-test caller, AGENTS.md
section 4 rule 15).

**This script only runs on the provisioned Linux host**, as root. It shells out to
`ctr`, reads `/dev/kvm`, and binds a Unix socket inside the VMM's per-sandbox
directory; on the Windows development box it refuses in its first check. S2
(BUILD_PLAN section 5.2) is its entry precondition.

**Zero-paid.** The provider behind the LM handler is a scripted stub that returns
a fixed completion and reports $0.00. No model runs and no key is read. The
metered `[A]` half of S3 - a real-model flat fan-out through this bridge - is a
separate, owner-gated run.

**The transport finding this probe is built on.** The records specify the host
binding `AF_VSOCK` on `VMADDR_CID_ANY` and reading the guest CID from `accept()`
(INTERFACES section 3.1). That is the *native* vhost-vsock transport, which Kata
uses under QEMU. The ratified VMM is Cloud Hypervisor, which implements **hybrid
vsock**: the guest dials `AF_VSOCK (2, port)` and the VMM delivers it to an
`AF_UNIX` socket on the host at `<uds>_<port>`. There is no host-side vsock
socket and therefore no CID at `accept()`. The identity anchor becomes the
per-sandbox socket path, which the host chose (see `transport.HybridVsockListener`).
This probe is the falsification test for that reading: if the host is in fact
reachable on native `AF_VSOCK`, claim 1 still passes and `--native-vsock` proves
it directly.

What is being proved, in six separable claims:

  1. **Reachability.** The guest's own `AF_VSOCK` connect to `(2, LM_PORT)` is
     delivered to a host listener, and the shipping guest path
     (`guest_rpc.GuestRpc` over `transport.VsockClient`) completes a real
     `llm_query` and a real `llm_query_batched` against the real `LMHandler`.
  2. **Byte parity.** The frame the guest put on the wire and the frame it read
     back are byte-identical to the same call served over the loopback transport
     - compared as sha256 over the exact bytes, captured on both sides.
  3. **Latency.** The bridge's *added* round-trip cost over the loopback path is
     within budget; both distributions are recorded, not just the verdict.
  4. **The control seam, host->guest.** The guest supervisor's direction: a
     listener inside the guest is reached by the host through the VMM's
     `CONNECT <port>` handshake, and the guest reports which peer CID it saw -
     the number `transport.require_host_cid` is written against.
  5. **Identity is the host's.** After the host closes the session, the same
     guest, on the same socket, is refused: the connection is dropped with no
     answer. Nothing the guest can write into a frame restores it.
  6. **Clean teardown.** The listener's socket node is gone, the container is
     gone, no Cloud Hypervisor process survives.

Modes:
  default             boot once, run all six claims
  --negative-control  the guest answers itself: instead of dialing vsock it
                      dials an in-guest loopback responder that returns the
                      byte-identical canned reply. Every guest-visible claim
                      still passes and only the host-side witness can catch it.
                      DETECTED (exit 3) is the healthy result; a pass means this
                      probe cannot tell a crossed boundary from a guest talking
                      to itself, and therefore proves nothing about the bridge
                      (.claude/rules/measurement-and-reporting.md rule 19(c)).
  --native-vsock      bind the host listener with `AF_VSOCK` on `VMADDR_CID_ANY`
                      instead of the hybrid Unix socket. Expected to fail to
                      receive anything under Cloud Hypervisor; run it to check
                      the transport finding above rather than take it on faith.
  --keep              leave the sandbox running (skips claim 6)
  --json              emit the observation record as JSON on stdout
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
import shlex
import socket
import stat
import statistics
import subprocess
import sys
import tarfile
import threading
import time
import uuid

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO_ROOT, "src"))

from repl_sandbox.audit import AuditLog  # noqa: E402
from repl_sandbox.config import (  # noqa: E402
    LMCaps,
    SandboxConfig,
    VMADDR_CID_HOST,
)
from repl_sandbox.frame import encode_frame, read_frame  # noqa: E402
from repl_sandbox.host import TrellisSandboxHost  # noqa: E402
from repl_sandbox.transport import (  # noqa: E402
    HybridVsockHostClient,
    HybridVsockListener,
    LoopbackListener,
    VsockListener,
    hybrid_socket_path,
    serve_forever,
)

RUNTIME = "io.containerd.kata.v2"
DEFAULT_IMAGE = "docker.io/library/python:3.12-slim"
GUEST_DIR = "/run/s3"

#: Host-assigned session ids. Under hybrid vsock neither is read from a kernel:
#: the first is bound to the sandbox's socket path, the second to the loopback
#: test double. They are distinct so the two paths keep separate ledgers and rate
#: buckets, and the comparison measures the wire rather than one path's leftovers.
GUEST_CID = 3
LOOPBACK_CID = 4

#: The one call every claim is measured on. Fixed so both paths encode the same
#: bytes; `depth` is the constant `guest_rpc.ROOT_DEPTH` emits.
PROBE_PROMPT = "S3 probe: does this frame cross the boundary?"
PROBE_MODEL = "scripted-probe"
PROBE_REQUEST: dict = {"prompt": PROBE_PROMPT, "model": PROBE_MODEL, "depth": 0}

#: Round trips per path in the latency claim.
LATENCY_SAMPLES = 10

#: Default ceiling on the bridge's *added* p50 round trip, in milliseconds. The
#: budget is on the difference from loopback, not on the absolute number: with a
#: scripted provider the absolute number is dominated by whatever the host's
#: Python interpreter costs, which is not what S3 is measuring.
DEFAULT_ADDED_LATENCY_BUDGET_MS = 25.0


class ProbeError(RuntimeError):
    """A precondition or a probe step failed for an infrastructural reason.

    Kept apart from a failed *claim*: this is "the probe could not run", not
    "the bridge is not there".
    """


# ---------------------------------------------------------------------------
# The scripted provider — zero-paid, deterministic, and named as such
# ---------------------------------------------------------------------------


class ScriptedProvider:
    """A `lm_handler.Provider` that returns a fixed completion and spends nothing.

    Deterministic on purpose: byte parity between two paths is only a claim if
    the same request produces the same response bytes twice. It reports $0.00,
    which `LMHandler`'s docstring correctly warns silently disables the dollar
    cap - true, and irrelevant here because no dollar is at risk. The cap is
    exercised against a real provider in the metered `[A]` run, not this one.
    """

    def complete(self, prompt: object, model: str | None) -> tuple[dict, float]:
        return self._completion(prompt, model), 0.0

    def complete_batched(
        self, prompts: list, model: str | None
    ) -> tuple[list[dict], float]:
        return [self._completion(p, model) for p in prompts], 0.0

    @staticmethod
    def _completion(prompt: object, model: str | None) -> dict:
        return {
            "root_model": model or PROBE_MODEL,
            "prompt": prompt,
            "response": "S3-OK",
            "usage_summary": {
                "model_usage_summaries": {},
                "total_cost": 0.0,
            },
            # A fixed number, not a measured one: a timing field here would make
            # the response bytes differ between the two paths for a reason that
            # has nothing to do with the wire.
            "execution_time": 0.0,
        }


# ---------------------------------------------------------------------------
# Guest-side programs
# ---------------------------------------------------------------------------

#: Runs inside the guest, prints one JSON object. Every byte it reports is
#: captured from the socket rather than re-encoded, so the parity claim compares
#: what actually crossed and not what this script thinks it sent.
GUEST_PROBE_SOURCE = r'''
import argparse, hashlib, json, os, socket, sys, threading, time

sys.path.insert(0, "/run/s3")

from repl_sandbox.frame import encode_frame, read_frame
from repl_sandbox.guest_rpc import GuestRpc
from repl_sandbox.transport import VsockClient

VMADDR_CID_HOST = 2


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


class LocalEcho:
    """The negative control's guest-local responder. NOT a boundary crossing.

    Answers with the canned bytes the host would have answered with, so every
    guest-visible check passes and only the host's own witness can tell.
    """

    def __init__(self, canned, max_len):
        self.canned = canned
        self.max_len = max_len
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(16)
        self.port = self.sock.getsockname()[1]

    def serve_forever(self):
        while True:
            conn, _ = self.sock.accept()
            try:
                read_frame(conn.recv, self.max_len)
                conn.sendall(encode_frame(self.canned, self.max_len))
            except Exception:
                pass
            finally:
                conn.close()


class LocalClient:
    def __init__(self, port):
        self.port = port

    def connect(self):
        sock = socket.create_connection(("127.0.0.1", self.port), timeout=30)
        return sock


class VsockDialer:
    def __init__(self, port):
        self.port = port

    def connect(self):
        sock = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
        sock.settimeout(30)
        sock.connect((VMADDR_CID_HOST, self.port))
        return sock


def exchange(dialer, payload, max_len):
    """One framed round trip with both directions' bytes captured verbatim."""
    sock = dialer.connect()
    received = bytearray()

    def recv(count):
        chunk = sock.recv(count)
        received.extend(chunk)
        return chunk

    sent = encode_frame(payload, max_len)
    started = time.perf_counter()
    try:
        sock.sendall(sent)
        response = read_frame(recv, max_len)
    finally:
        sock.close()
    elapsed_ms = (time.perf_counter() - started) * 1000.0
    return {
        "response": response,
        "sent_sha256": digest(sent),
        "sent_bytes": len(sent),
        "received_sha256": digest(bytes(received)),
        "received_bytes": len(received),
        "elapsed_ms": elapsed_ms,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--max-frame-len", type=int, required=True)
    parser.add_argument("--samples", type=int, default=10)
    parser.add_argument("--request", required=True, help="path to the request JSON")
    parser.add_argument("--fake-local", default="", help="canned reply path; negative control")
    args = parser.parse_args()

    payload = json.load(open(args.request))
    report = {
        "kernel": os.uname().release,
        "boot_id": open("/proc/sys/kernel/random/boot_id").read().strip(),
        "fake_local": bool(args.fake_local),
        "af_vsock_in_guest": hasattr(socket, "AF_VSOCK"),
    }

    if args.fake_local:
        echo = LocalEcho(json.load(open(args.fake_local)), args.max_frame_len)
        threading.Thread(target=echo.serve_forever, daemon=True).start()
        dialer = LocalClient(echo.port)
        report["dialed"] = "127.0.0.1:%d (negative control)" % echo.port
    else:
        dialer = VsockDialer(args.port)
        report["dialed"] = "AF_VSOCK (%d, %d)" % (VMADDR_CID_HOST, args.port)

    # -- the shipping guest path, unmodified ------------------------------
    # `GuestRpc` is what the materialised stubs call; running it here is the
    # difference between "a socket works" and "the code we ship works".
    if args.fake_local:
        class _Client:
            def request(self, payload, max_frame_len):
                return exchange(dialer, payload, max_frame_len)["response"]
        client = _Client()
    else:
        client = VsockClient(VMADDR_CID_HOST, args.port, timeout_s=30.0)

    rpc = GuestRpc({"LM_PORT": client}, args.max_frame_len)
    try:
        single = rpc("LM_PORT", {
            "v": 1, "req_id": "s3-single", "op": "llm_query",
            "args": {"prompt": payload["prompt"], "model": payload.get("model")},
        })
        report["rpc_single"] = single
        report["rpc_single_ok"] = True
    except Exception as exc:
        report["rpc_single_ok"] = False
        report["rpc_single_error"] = "%s: %s" % (type(exc).__name__, exc)

    try:
        batched = rpc("LM_PORT", {
            "v": 1, "req_id": "s3-batch", "op": "llm_query_batched",
            "args": {"prompts": [payload["prompt"], payload["prompt"]],
                     "model": payload.get("model")},
        })
        report["rpc_batched_n"] = len(batched.get("chat_completions", []))
        report["rpc_batched_ok"] = True
    except Exception as exc:
        report["rpc_batched_ok"] = False
        report["rpc_batched_error"] = "%s: %s" % (type(exc).__name__, exc)

    # -- byte capture + latency, on the raw wire --------------------------
    # Wrapped, because a dial that cannot connect is a *claim failure* the host
    # side must see and name, not a crash. Unwrapped, this script exited non-zero
    # and the probe reported "could not run" — which is what it says when the
    # infrastructure is broken, and hides the far more interesting case where the
    # infrastructure is fine and the host is simply unreachable on that address.
    try:
        first = exchange(dialer, payload, args.max_frame_len)
        report["parity"] = {
            "sent_sha256": first["sent_sha256"],
            "sent_bytes": first["sent_bytes"],
            "received_sha256": first["received_sha256"],
            "received_bytes": first["received_bytes"],
            "response": first["response"],
        }
        samples = [first["elapsed_ms"]]
        for _ in range(max(0, args.samples - 1)):
            samples.append(exchange(dialer, payload, args.max_frame_len)["elapsed_ms"])
        report["latency_ms"] = samples
    except Exception as exc:
        report["raw_error"] = "%s: %s" % (type(exc).__name__, exc)
        report["parity"] = {}
        report["latency_ms"] = []

    print(json.dumps(report))


if __name__ == "__main__":
    main()
'''

#: Runs detached inside the guest: binds the control port and records what the
#: kernel says about the peer that reached it. The host is the only thing that
#: should ever connect, and `require_host_cid` is written against CID 2.
GUEST_CONTROL_SOURCE = r'''
import json, socket, sys

sys.path.insert(0, "/run/s3")

from repl_sandbox.frame import encode_frame, read_frame
from repl_sandbox.transport import require_host_cid

PORT = int(sys.argv[1])
MAX_LEN = int(sys.argv[2])
OUT = sys.argv[3]

listener = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
listener.bind((socket.VMADDR_CID_ANY, PORT))
listener.listen(4)

conn, addr = listener.accept()
observed = {"peer_cid": int(addr[0]), "peer_port": int(addr[1])}
try:
    require_host_cid(observed["peer_cid"])
    observed["require_host_cid"] = "accepted"
except Exception as exc:
    observed["require_host_cid"] = "refused: %s" % exc

try:
    request = read_frame(conn.recv, MAX_LEN)
    observed["request"] = request
    conn.sendall(encode_frame({"ok": True, "supervisor": "s3-control", "echo": request}, MAX_LEN))
    observed["answered"] = True
except Exception as exc:
    observed["answered"] = False
    observed["error"] = "%s: %s" % (type(exc).__name__, exc)
finally:
    conn.close()
    listener.close()

open(OUT, "w").write(json.dumps(observed))
'''


# ---------------------------------------------------------------------------
# Host plumbing
# ---------------------------------------------------------------------------


def run(
    argv: list[str], *, timeout: float = 120.0, check: bool = True
) -> subprocess.CompletedProcess:
    completed = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
    if check and completed.returncode != 0:
        raise ProbeError(
            f"{shlex.join(argv)} exited {completed.returncode}\n"
            f"stdout: {completed.stdout.strip()}\nstderr: {completed.stderr.strip()}"
        )
    return completed


def preconditions() -> dict:
    """The cheap half of G1 plus the tools this probe needs."""
    facts: dict = {}
    if not os.path.exists("/dev/kvm"):
        raise ProbeError(
            "/dev/kvm is absent: this is not a KVM host and S3 cannot run here. "
            "The Windows development box is expected to fail exactly here."
        )
    if not hasattr(socket, "AF_UNIX"):
        raise ProbeError("this host has no AF_UNIX; the hybrid-vsock host side cannot bind")
    facts["kvm"] = True
    facts["host_kernel"] = os.uname().release
    facts["host_boot_id"] = open("/proc/sys/kernel/random/boot_id").read().strip()
    facts["af_vsock_on_host"] = hasattr(socket, "AF_VSOCK")
    facts["kata_runtime"] = run(["kata-runtime", "--version"]).stdout.splitlines()[0].strip()
    facts["cloud_hypervisor"] = run(["cloud-hypervisor", "--version"]).stdout.strip()
    facts["containerd"] = run(["containerd", "--version"]).stdout.strip()
    return facts


def source_tarball() -> bytes:
    """`repl_sandbox` as a gzipped tar, tests and caches excluded.

    The guest runs the same source the host does. Shipping it at probe time is a
    spike affordance - a production guest carries it in the image - and it is
    what makes claim 1 a statement about the code that ships rather than about a
    re-implementation written to pass.
    """
    package = os.path.join(REPO_ROOT, "src", "repl_sandbox")
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        for root, dirs, files in os.walk(package):
            dirs[:] = [d for d in dirs if d not in ("__pycache__", "tests")]
            for name in sorted(files):
                if not name.endswith(".py"):
                    continue
                path = os.path.join(root, name)
                tar.add(path, arcname=os.path.relpath(path, os.path.join(REPO_ROOT, "src")))
    return buffer.getvalue()


class Sandbox:
    """One `ctr` container on the Kata runtime, addressed by name."""

    #: Bytes of base64 per `ctr task exec`. A single argv string is capped at
    #: 128 KiB by the kernel (`MAX_ARG_STRLEN`), so the payload is appended in
    #: chunks rather than passed whole.
    CHUNK = 60_000

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

    def exec(
        self, script: str, *, exec_id: str, detach: bool = False, timeout: float = 120.0
    ) -> str:
        argv = ["ctr", "task", "exec", "--exec-id", exec_id]
        if detach:
            argv.append("-d")
        argv += [self.name, "sh", "-c", script]
        return run(argv, timeout=timeout).stdout

    def put_bytes(self, raw: bytes, dest: str) -> None:
        """Write `raw` into the guest at `dest`, in argv-sized chunks."""
        payload = base64.b64encode(raw).decode()
        self.exec(f"mkdir -p {GUEST_DIR} && : > {dest}.b64", exec_id=f"put-init-{uuid.uuid4().hex[:6]}")
        for index in range(0, len(payload), self.CHUNK):
            chunk = payload[index : index + self.CHUNK]
            self.exec(
                f"printf %s {chunk} >> {dest}.b64",
                exec_id=f"put-{index}-{uuid.uuid4().hex[:6]}",
            )
        self.exec(
            f"base64 -d {dest}.b64 > {dest} && rm -f {dest}.b64",
            exec_id=f"put-fin-{uuid.uuid4().hex[:6]}",
        )

    def install_sources(self, request: dict, canned: dict | None) -> None:
        self.put_bytes(source_tarball(), f"{GUEST_DIR}/repl_sandbox.tgz")
        self.exec(
            f"cd {GUEST_DIR} && tar xzf repl_sandbox.tgz && python3 -c "
            f"'import sys; sys.path.insert(0, \"{GUEST_DIR}\"); import repl_sandbox'",
            exec_id="unpack",
        )
        self.put_bytes(GUEST_PROBE_SOURCE.encode(), f"{GUEST_DIR}/guest_probe.py")
        self.put_bytes(GUEST_CONTROL_SOURCE.encode(), f"{GUEST_DIR}/guest_control.py")
        self.put_bytes(json.dumps(request).encode(), f"{GUEST_DIR}/request.json")
        if canned is not None:
            self.put_bytes(json.dumps(canned).encode(), f"{GUEST_DIR}/canned.json")

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
        """Tear the sandbox down, and never raise doing it.

        `ctr` itself blocks indefinitely when a shim has stopped answering — a
        `task kill` against a wedged sandbox timed out at 60 s and the
        `TimeoutExpired` escaped from a `finally`, masking the failure that
        caused it and leaving the container record behind. Each step is now
        bounded and swallowed, and a step that times out escalates to killing the
        shim, which is what actually unblocks containerd.
        """
        for argv in (
            ["ctr", "task", "kill", "-s", "SIGKILL", "-a", self.name],
            ["ctr", "task", "delete", "-f", self.name],
            ["ctr", "container", "delete", self.name],
        ):
            try:
                run(argv, check=False, timeout=30.0)
            except subprocess.TimeoutExpired:
                self._kill_shim()
                try:
                    run(argv, check=False, timeout=30.0)
                except subprocess.TimeoutExpired:
                    pass
            time.sleep(0.5)

    def _kill_shim(self) -> None:
        """SIGKILL this sandbox's Kata shim, so a wedged `ctr` call can complete."""
        found = run(
            ["pgrep", "-f", f"containerd-shim-kata-v2.*{self.name}"], check=False, timeout=15.0
        )
        for pid in found.stdout.split():
            try:
                os.kill(int(pid), 9)
            except (ValueError, ProcessLookupError, PermissionError):
                continue
        time.sleep(1.0)

    def listed(self) -> bool:
        listing = run(["ctr", "containers", "ls", "-q"], check=False).stdout.split()
        return self.name in listing


def discover_vsock_uds(sandbox: Sandbox) -> dict:
    """Find the VMM's hybrid-vsock Unix socket for this sandbox.

    Discovered rather than assumed: the path convention
    (`/run/vc/vm/<sandbox>/clh.sock`) is Kata's and could move, and a probe that
    hard-codes it would report "no bridge" when what it means is "no socket where
    I looked". The VMM's own command line names its directory, and the socket is
    identified by being a socket in it.
    """
    processes = sandbox.vmm_processes()
    if not processes:
        raise ProbeError(
            f"no cloud-hypervisor process carries {sandbox.name}: the guest is not "
            "running under the VMM this probe is written against"
        )
    directory = None
    for token in processes[0].split():
        if token.startswith("/run/") and "/vm/" in token:
            directory = os.path.dirname(token)
            break
    if directory is None or not os.path.isdir(directory):
        raise ProbeError(f"could not read a sandbox directory out of: {processes[0]}")

    entries = sorted(os.listdir(directory))
    sockets = []
    for name in entries:
        path = os.path.join(directory, name)
        try:
            if stat.S_ISSOCK(os.stat(path).st_mode):
                sockets.append(name)
        except OSError:
            continue
    # The API socket is the VMM's own control channel, not the vsock device.
    candidates = [name for name in sockets if "api" not in name]
    if not candidates:
        raise ProbeError(
            f"{directory} holds no non-API socket; found {entries}. The VMM may not "
            "have been configured with a vsock device."
        )
    return {
        "directory": directory,
        "entries": entries,
        "sockets": sockets,
        "uds_path": os.path.join(directory, candidates[0]),
        "vmm_cmdline": processes[0],
    }


class Witness:
    """Host-side counters. The only thing the negative control cannot forge.

    A guest that answers itself produces a perfectly good response, correct
    digests, and better latency. What it cannot produce is a connection arriving
    at the host's listener, which is what these count.
    """

    def __init__(self) -> None:
        self.accepted = 0
        self.requests = 0
        self.events: list[tuple[str, dict]] = []

    def audit(self, event: str, **fields: object) -> None:
        self.events.append((event, dict(fields)))
        if event == "accepted":
            self.accepted += 1

    def counted(self, handler):
        def wrapper(peer_cid: int, request: dict) -> dict:
            self.requests += 1
            return handler(peer_cid, request)

        return wrapper

    def named(self) -> list[str]:
        return [name for name, _ in self.events]


def loopback_reference(host: TrellisSandboxHost, config: SandboxConfig, samples: int) -> dict:
    """Serve the same call over the loopback test double, capturing the bytes.

    This is the comparison arm, and it is a test double rather than a boundary
    (`transport.LoopbackListener`). What it establishes is that the *frame* is the
    same one on both paths, so a byte difference on the vsock path is the bridge's
    and not the handler's.
    """
    listener = LoopbackListener(
        peer_cid=LOOPBACK_CID, accept_timeout_s=0.05, read_timeout_s=30.0
    )
    stop = threading.Event()
    thread = threading.Thread(
        target=serve_forever,
        args=(listener, host.lm_handler, config.max_frame_len, None, stop),
        daemon=True,
    )
    thread.start()
    try:
        sent = encode_frame(PROBE_REQUEST, config.max_frame_len)
        first = _capture_exchange(listener.address, sent, config.max_frame_len)
        latencies = [first["elapsed_ms"]]
        for _ in range(max(0, samples - 1)):
            latencies.append(
                _capture_exchange(listener.address, sent, config.max_frame_len)["elapsed_ms"]
            )
        return {
            "sent_sha256": hashlib.sha256(sent).hexdigest(),
            "sent_bytes": len(sent),
            "received_sha256": first["received_sha256"],
            "received_bytes": first["received_bytes"],
            "response": first["response"],
            "latency_ms": latencies,
        }
    finally:
        stop.set()
        listener.close()
        thread.join(timeout=10.0)


def _capture_exchange(address: tuple[str, int], sent: bytes, max_len: int) -> dict:
    sock = socket.create_connection(address, timeout=30.0)
    sock.settimeout(30.0)
    received = bytearray()

    def recv(count: int) -> bytes:
        chunk = sock.recv(count)
        received.extend(chunk)
        return chunk

    started = time.perf_counter()
    try:
        sock.sendall(sent)
        response = read_frame(recv, max_len)
    finally:
        sock.close()
    return {
        "response": response,
        "received_sha256": hashlib.sha256(bytes(received)).hexdigest(),
        "received_bytes": len(received),
        "elapsed_ms": (time.perf_counter() - started) * 1000.0,
    }


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return float("nan")
    ordered = sorted(values)
    index = min(len(ordered) - 1, int(round(fraction * (len(ordered) - 1))))
    return ordered[index]


# ---------------------------------------------------------------------------
# The probe
# ---------------------------------------------------------------------------


def probe(
    image: str,
    *,
    negative_control: bool,
    native_vsock: bool,
    keep: bool,
    budget_ms: float,
) -> tuple[dict, list[str]]:
    """Run the six claims. Returns (record, failures)."""
    record: dict = {
        "mode": "negative-control" if negative_control else "default",
        "transport": "native AF_VSOCK" if native_vsock else "hybrid vsock (AF_UNIX)",
    }
    failures: list[str] = []
    record["host"] = preconditions()

    # The rate cap is raised for the latency claim only. S3 measures the wire;
    # the shipped 4/s bucket is exercised by the LM-handler unit tests, and
    # measuring a round trip through a bucket would measure the bucket.
    config = SandboxConfig(lm_caps=LMCaps(requests_per_second=1000.0))
    audit = AuditLog()
    host = TrellisSandboxHost(
        config=config, backends={}, provider=ScriptedProvider(), audit=audit
    )
    host.open_session(GUEST_CID, "s3-guest")
    host.open_session(LOOPBACK_CID, "s3-loopback")

    name = f"s3-{uuid.uuid4().hex[:10]}"
    sandbox = Sandbox(name, image)
    record["sandbox"] = name
    record["image"] = image

    witness = Witness()
    listener = None
    stop = threading.Event()
    server: threading.Thread | None = None

    started = time.monotonic()
    sandbox.boot()
    record["ctr_run_detached_seconds"] = round(time.monotonic() - started, 3)

    try:
        record["guest"] = sandbox.guest_identity()
        record["boot_to_first_exec_seconds"] = round(time.monotonic() - started, 3)
        if record["guest"]["kernel"] == record["host"]["host_kernel"]:
            failures.append(
                f"guest kernel equals host kernel ({record['guest']['kernel']}): "
                "this is not a VM boundary and S3 would be measuring a host socket"
            )

        # -- the host end of the bridge ---------------------------------------
        if native_vsock:
            record["bridge"] = {"kind": "native", "bind": "AF_VSOCK VMADDR_CID_ANY"}
            listener = VsockListener(
                config.ports.lm, accept_timeout_s=0.05, read_timeout_s=30.0
            )
        else:
            discovered = discover_vsock_uds(sandbox)
            record["bridge"] = {"kind": "hybrid", **discovered}
            listener = HybridVsockListener(
                discovered["uds_path"],
                config.ports.lm,
                GUEST_CID,
                accept_timeout_s=0.05,
                read_timeout_s=30.0,
            )
            record["bridge"]["listen_path"] = listener.path

        server = threading.Thread(
            target=serve_forever,
            args=(
                listener,
                witness.counted(host.lm_handler),
                config.max_frame_len,
                witness.audit,
                stop,
            ),
            daemon=True,
        )
        server.start()

        # -- the comparison arm, before the guest runs -------------------------
        reference = loopback_reference(host, config, LATENCY_SAMPLES)
        record["loopback"] = {
            key: reference[key]
            for key in ("sent_sha256", "sent_bytes", "received_sha256", "received_bytes")
        }
        record["loopback"]["latency_ms_p50"] = round(
            percentile(reference["latency_ms"], 0.5), 3
        )

        # -- claim 4 (started first: the listener must be up before the dial) --
        sandbox.install_sources(
            PROBE_REQUEST, reference["response"] if negative_control else None
        )
        sandbox.exec(
            f"cd {GUEST_DIR} && setsid python3 -u guest_control.py "
            f"{config.ports.control} {config.max_frame_len} {GUEST_DIR}/control.json "
            f"</dev/null >/dev/null 2>{GUEST_DIR}/control.err &",
            exec_id="control-listener",
            detach=True,
        )
        time.sleep(1.5)

        # -- claims 1-3: the guest crosses (or does not) ------------------------
        command = (
            f"cd {GUEST_DIR} && python3 guest_probe.py --port {config.ports.lm} "
            f"--max-frame-len {config.max_frame_len} --samples {LATENCY_SAMPLES} "
            f"--request {GUEST_DIR}/request.json"
        )
        if negative_control:
            command += f" --fake-local {GUEST_DIR}/canned.json"
        raw = sandbox.exec(command, exec_id=f"probe-{uuid.uuid4().hex[:8]}", timeout=180.0)
        try:
            guest = json.loads(raw.strip().splitlines()[-1])
        except (ValueError, IndexError) as exc:
            raise ProbeError(f"the guest probe produced no parsable report: {raw!r}") from exc
        record["guest_report"] = guest

        # claim 1 - reachability
        record["witness"] = {"accepted": witness.accepted, "requests": witness.requests}
        if witness.accepted < 1:
            failures.append(
                "the host listener accepted no connection: nothing reached the host "
                f"at {record['bridge'].get('listen_path', 'AF_VSOCK')}"
            )
        if not guest.get("rpc_single_ok"):
            failures.append(
                "GuestRpc llm_query failed in the guest: "
                + str(guest.get("rpc_single_error"))
            )
        elif guest["rpc_single"].get("chat_completion", {}).get("response") != "S3-OK":
            failures.append("the completion that came back is not the scripted one")
        if not guest.get("rpc_batched_ok"):
            failures.append(
                "GuestRpc llm_query_batched failed in the guest: "
                + str(guest.get("rpc_batched_error"))
            )
        elif guest.get("rpc_batched_n") != 2:
            failures.append(f"batched fan-out returned {guest.get('rpc_batched_n')} of 2")

        # claim 2 - byte parity
        parity = guest.get("parity", {})
        if guest.get("raw_error"):
            # The dial itself failed. Named here rather than left to be inferred
            # from three downstream mismatches, because "the guest could not
            # reach this address" is the finding, not its consequences.
            failures.append(f"the guest could not complete a raw exchange: {guest['raw_error']}")
        record["parity"] = {
            "guest_sent_sha256": parity.get("sent_sha256"),
            "host_sent_sha256": reference["sent_sha256"],
            "guest_received_sha256": parity.get("received_sha256"),
            "loopback_received_sha256": reference["received_sha256"],
            "guest_received_bytes": parity.get("received_bytes"),
            "loopback_received_bytes": reference["received_bytes"],
        }
        if parity.get("sent_sha256") != reference["sent_sha256"]:
            failures.append(
                "the request frame the guest sent differs from the loopback path's: "
                f"{parity.get('sent_sha256')} vs {reference['sent_sha256']}"
            )
        if parity.get("received_sha256") != reference["received_sha256"]:
            failures.append(
                "the response frame the guest received differs from the loopback "
                f"path's: {parity.get('received_sha256')} vs {reference['received_sha256']}"
            )

        # claim 3 - latency
        vsock_samples = guest.get("latency_ms", [])
        if not vsock_samples:
            failures.append("the guest reported no latency samples")
        else:
            added = percentile(vsock_samples, 0.5) - percentile(reference["latency_ms"], 0.5)
            record["latency"] = {
                "vsock_p50_ms": round(percentile(vsock_samples, 0.5), 3),
                "vsock_p95_ms": round(percentile(vsock_samples, 0.95), 3),
                "vsock_max_ms": round(max(vsock_samples), 3),
                "vsock_mean_ms": round(statistics.fmean(vsock_samples), 3),
                "loopback_p50_ms": round(percentile(reference["latency_ms"], 0.5), 3),
                "added_p50_ms": round(added, 3),
                "budget_ms": budget_ms,
                "samples": len(vsock_samples),
            }
            if added > budget_ms:
                failures.append(
                    f"the bridge adds {added:.1f} ms at p50, over the {budget_ms} ms budget"
                )

        # -- claim 4: the control seam, host -> guest ---------------------------
        if native_vsock:
            record["control"] = "skipped (--native-vsock has no UDS to dial)"
        else:
            control = {"attempted": True}
            try:
                client = HybridVsockHostClient(
                    record["bridge"]["uds_path"], config.ports.control, timeout_s=15.0
                )
                control["response"] = client.request(
                    {"op": "ping", "from": "host"}, config.max_frame_len
                )
                control["assigned_port"] = client.assigned_port
            except Exception as exc:  # noqa: BLE001 - a failed seam is a claim, not a crash
                control["error"] = f"{type(exc).__name__}: {exc}"
            # The guest writes its observation *after* it closes the connection,
            # so the reply arriving here does not mean the file exists yet.
            time.sleep(0.5)
            observed = sandbox.exec(
                f"cat {GUEST_DIR}/control.json 2>/dev/null || true",
                exec_id=f"control-read-{uuid.uuid4().hex[:6]}",
            ).strip()
            control["guest_observed"] = json.loads(observed) if observed else None
            record["control"] = control

            if control.get("error"):
                failures.append(f"the host could not reach the guest control port: {control['error']}")
            elif control.get("response", {}).get("supervisor") != "s3-control":
                failures.append("the control port answered with something else")
            seen = (control.get("guest_observed") or {}).get("peer_cid")
            if seen is None:
                failures.append("the guest control listener recorded no peer")
            elif seen != VMADDR_CID_HOST:
                failures.append(
                    f"the guest saw peer CID {seen}, not {VMADDR_CID_HOST}: "
                    "`require_host_cid` is written against a number this VMM does not present"
                )

        # -- claim 5: identity is the host's -----------------------------------
        host.close_session(GUEST_CID)
        after = sandbox.exec(
            f"cd {GUEST_DIR} && python3 guest_probe.py --port {config.ports.lm} "
            f"--max-frame-len {config.max_frame_len} --samples 1 "
            f"--request {GUEST_DIR}/request.json"
            + (f" --fake-local {GUEST_DIR}/canned.json" if negative_control else ""),
            exec_id=f"after-close-{uuid.uuid4().hex[:8]}",
            timeout=120.0,
        )
        try:
            after_report = json.loads(after.strip().splitlines()[-1])
        except (ValueError, IndexError) as exc:
            raise ProbeError(
                f"the post-close guest probe produced no parsable report: {after!r}"
            ) from exc
        record["after_close"] = {
            "rpc_single_ok": after_report.get("rpc_single_ok"),
            "rpc_single_error": after_report.get("rpc_single_error"),
            "response": after_report.get("parity", {}).get("response"),
        }
        if after_report.get("rpc_single_ok"):
            failures.append(
                "the guest was still served after the host closed its session: "
                "identity is not being resolved host-side"
            )

        # -- claim 6: teardown --------------------------------------------------
        if keep:
            record["teardown"] = "skipped (--keep)"
        else:
            stop.set()
            if server is not None:
                server.join(timeout=10.0)
            socket_path = getattr(listener, "path", None)
            listener.close()
            listener = None
            sandbox.destroy()
            time.sleep(2.0)
            record["teardown"] = {
                "socket_removed": (socket_path is None) or (not os.path.exists(socket_path)),
                "listed_after_delete": sandbox.listed(),
                "vmm_processes_after_delete": sandbox.vmm_processes(),
            }
            if not record["teardown"]["socket_removed"]:
                failures.append(f"the listener socket {socket_path} survived teardown")
            if record["teardown"]["listed_after_delete"]:
                failures.append("the container is still listed by containerd after delete")
            if record["teardown"]["vmm_processes_after_delete"]:
                failures.append("a cloud-hypervisor process for this sandbox survived teardown")
    finally:
        stop.set()
        if server is not None:
            server.join(timeout=10.0)
        if listener is not None:
            try:
                listener.close()
            except OSError:
                pass
        host.close()
        if not keep:
            sandbox.destroy()

    record["audit_events"] = witness.named()
    return record, failures


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--image", default=DEFAULT_IMAGE)
    parser.add_argument("--negative-control", action="store_true")
    parser.add_argument("--native-vsock", action="store_true")
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--json", action="store_true")
    parser.add_argument(
        "--latency-budget-ms", type=float, default=DEFAULT_ADDED_LATENCY_BUDGET_MS
    )
    args = parser.parse_args(argv)

    try:
        record, failures = probe(
            args.image,
            negative_control=args.negative_control,
            native_vsock=args.native_vsock,
            keep=args.keep,
            budget_ms=args.latency_budget_ms,
        )
    except ProbeError as exc:
        print(f"S3 probe could not run: {exc}", file=sys.stderr)
        return 1

    record["failures"] = failures
    if args.json:
        print(json.dumps(record, indent=2, default=str))
    else:
        print(f"sandbox      {record['sandbox']} ({record['image']})")
        print(f"transport    {record['transport']}")
        bridge = record.get("bridge", {})
        print(f"listener     {bridge.get('listen_path', bridge.get('bind', '-'))}")
        print(f"host kernel  {record['host']['host_kernel']}")
        print(f"guest kernel {record.get('guest', {}).get('kernel')}")
        print(f"witness      accepted={record.get('witness', {}).get('accepted')} "
              f"requests={record.get('witness', {}).get('requests')}")
        parity = record.get("parity", {})
        print(f"parity       request {parity.get('guest_sent_sha256')} "
              f"{'==' if parity.get('guest_sent_sha256') == parity.get('host_sent_sha256') else '!='} host")
        print(f"             response {parity.get('guest_received_sha256')} "
              f"{'==' if parity.get('guest_received_sha256') == parity.get('loopback_received_sha256') else '!='} loopback")
        latency = record.get("latency", {})
        if latency:
            print(f"latency      vsock p50 {latency['vsock_p50_ms']} ms, "
                  f"loopback p50 {latency['loopback_p50_ms']} ms, "
                  f"added {latency['added_p50_ms']} ms (budget {latency['budget_ms']})")
        control = record.get("control")
        if isinstance(control, dict):
            print(f"control      guest saw peer_cid="
                  f"{(control.get('guest_observed') or {}).get('peer_cid')}, "
                  f"assigned_port={control.get('assigned_port')}")
        print(f"teardown     {record.get('teardown')}")
        for failure in failures:
            print(f"FAIL  {failure}")

    if args.negative_control:
        if failures:
            print("negative control: DETECTED - the probe can tell a crossed "
                  "boundary from a guest answering itself.")
            return 3
        print("negative control: ABSORBED - the probe passed a guest that never "
              "left the guest. It proves nothing about the bridge.", file=sys.stderr)
        return 1
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
