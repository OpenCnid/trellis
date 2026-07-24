"""REPL-sandbox S3 `[A]`: a metered real-model flat fan-out across the bridge.

Specification: docs/product/repl-sandbox/REPL_SANDBOX_BUILD_PLAN.md section 5.3
(S3 - `llm_query` over vsock), the **`[A]` half**. The `[R]` half
(`scripts/repl_sandbox_s3_probe.py`) proved the bytes cross the boundary against a
scripted $0 provider. This script proves the other thing the `[R]` run cannot: that
a *real model*, reached through the real `ChatCompletionsProvider`, actually drives
the `llm_query` channel across the vsock bridge and answers correctly - the
engine-fidelity check the house calls adoption. Entrypoint:
`npm run repl-sandbox:s3-paid`.

**This is a paid run.** It reads a provider credential from the host environment
(`TRELLIS_LM_API_KEY`, never a flag, never logged), calls a paid API once per
fan-out slice, and reports the dollars the engine actually charged. The house cap
is $5/run and it is not merely documented here: `LMCaps.spend_usd` is a
session-terminal hard-stop inside the LM handler, so the boundary itself bounds the
bill. Estimate before, report after (.claude/rules/spend-and-live-infrastructure.md rule 7).

**Why this reuses the `[R]` probe rather than re-deriving it.** The boot, the
hybrid-vsock bridge discovery, the host-side witness, the source shipment and the
teardown are exactly the `[R]` probe's, imported from it. The only thing that
changes is the provider ($0 stub -> real client) and the guest program (a canned
one-shot -> a real fan-out over distinct, deterministically-checkable slices). A
second copy of the plumbing would be a second thing to keep true.

What this proves, past what `[R]` already did:

  1. **A real model answered, over the bridge.** Each fan-out slice is a task with
     one correct answer this script knows in advance; every returned completion is
     checked against it. A wrong answer, a canned `S3-OK`, or a $0 charge all fail
     the run - none of them is a real model using the channel.
  2. **The fan-out is flat, at `max_depth` 1.** The slices go out as one
     `llm_query_batched` (width bounded by the handler's in-flight ceiling, not by
     this script), plus single `llm_query` calls - the shape rlms drives at
     `depth = 1`. No child REPL, no recursion.
  3. **The dollar ledger is real.** The run reports `spend_ledger.spent(cid)`; it
     is positive (a real model was billed) and at or under the cap. `--cap-halt`
     sets the cap below the first slice's cost and shows the handler hard-stops the
     session on the real charge - requirement 5's `[A]`, bought for one call.

The host-side witness is retained from `[R]` and is still the load-bearing thing:
a guest that answered itself would still produce correct-looking text, and only the
count of connections that arrived at the host distinguishes a crossed boundary from
a guest talking to itself.

Modes:
  default        boot once, run the fan-out through the real provider, meter it
  --cap-halt     set the spend cap below the first slice; prove the hard-stop fires
  --keep         leave the sandbox running (skips teardown)
  --json         emit the observation record as JSON on stdout
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import sys
import threading
import time
import uuid

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO_ROOT, "src"))


def _load_probe():
    """Import the `[R]` probe by path and reuse its plumbing.

    It is a script, not a package module, so it is loaded the same way its own
    test loads it. Everything host-and-bridge shaped comes from here; nothing is
    re-implemented.
    """
    path = os.path.join(REPO_ROOT, "scripts", "repl_sandbox_s3_probe.py")
    spec = importlib.util.spec_from_file_location("repl_sandbox_s3_probe", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


probe = _load_probe()

from repl_sandbox.audit import AuditLog  # noqa: E402
from repl_sandbox.config import LMCaps, SandboxConfig  # noqa: E402
from repl_sandbox.host import TrellisSandboxHost  # noqa: E402
from repl_sandbox.lm_handler import openai_chat_provider_from_env  # noqa: E402
from repl_sandbox.transport import (  # noqa: E402
    HybridVsockListener,
    serve_forever,
)

#: The credential the real provider reads, host-side. Never a flag, never logged.
API_KEY_ENV = "TRELLIS_LM_API_KEY"

#: Provider selection and prices come from the environment so the credential's
#: neighbours (which model, at what price) are set the same place the key is, by
#: the operator, and this script hard-codes no pricing that could silently go
#: stale. `openai_chat_provider_from_env` requires the prices; a wrong price only
#: mis-reports the bill, it cannot exceed the in-engine cap.
MODEL_ENV = "TRELLIS_LM_MODEL"
IN_PRICE_ENV = "TRELLIS_LM_USD_PER_1K_INPUT"
OUT_PRICE_ENV = "TRELLIS_LM_USD_PER_1K_OUTPUT"
BASE_URL_ENV = "TRELLIS_LM_BASE_URL"

GUEST_DIR = probe.GUEST_DIR
GUEST_CID = probe.GUEST_CID


# ---------------------------------------------------------------------------
# The fan-out slices — deterministic tasks with one checkable answer each
# ---------------------------------------------------------------------------


class Slice:
    """One fan-out task: a prompt and the one answer that means the model ran.

    Arithmetic on purpose. `[A]` asks whether a real model drives the channel and
    returns the *right* thing, and "right" has to be decidable by this script
    without a judge - an LLM-graded check would fold the thing under test into the
    grader. The first integer in the reply is compared to a known value; a model
    that never received the prompt, or a stub that answered `S3-OK`, cannot
    produce it. These are measurement fixtures, not a reusable prompt artifact.
    """

    def __init__(self, a: int, b: int, op: str) -> None:
        self.a = a
        self.b = b
        self.op = op
        self.expected = {
            "+": a + b,
            "-": a - b,
            "*": a * b,
        }[op]

    @property
    def prompt(self) -> str:
        return (
            f"You are a calculator. Compute {self.a} {self.op} {self.b}. "
            "Reply with ONLY the resulting integer and nothing else."
        )

    def matches(self, response: str) -> bool:
        found = re.search(r"-?\d+", response or "")
        return found is not None and int(found.group()) == self.expected


#: Four slices: exactly the shipped `max_in_flight` (4), so the whole fan-out is
#: one batched call the handler admits without raising, and the batch width is the
#: real ceiling rather than a number invented here. Values are unremarkable so any
#: instruct model answers, and distinct so a per-slice mismatch is unambiguous.
SLICES = [
    Slice(17, 23, "*"),
    Slice(128, 5, "+"),
    Slice(900, 37, "-"),
    Slice(6, 7, "*"),
]

#: One extra single-shot `llm_query` (not batched) so both fan-out paths - the
#: batched width and the singleton - are exercised against the real model.
SINGLE = Slice(48, 12, "+")


# ---------------------------------------------------------------------------
# Guest-side program — the shipping GuestRpc path, driving a real fan-out
# ---------------------------------------------------------------------------

#: Runs inside the guest, prints one JSON object. It issues the real fan-out
#: through `guest_rpc.GuestRpc` over `transport.VsockClient` - the same code path a
#: materialised `llm_query` stub takes - so a pass is a statement about the code
#: that ships, not about a socket.
GUEST_FANOUT_SOURCE = r'''
import argparse, json, socket, sys, time

sys.path.insert(0, "/run/s3")

from repl_sandbox.guest_rpc import GuestRpc
from repl_sandbox.transport import VsockClient

VMADDR_CID_HOST = 2


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--max-frame-len", type=int, required=True)
    parser.add_argument("--slices", required=True, help="path to the batched prompts JSON")
    parser.add_argument("--single", required=True, help="path to the single prompt JSON")
    parser.add_argument("--model", default="")
    args = parser.parse_args()

    batched_prompts = json.load(open(args.slices))
    single_prompt = json.load(open(args.single))
    model = args.model or None

    client = VsockClient(VMADDR_CID_HOST, args.port, timeout_s=120.0)
    rpc = GuestRpc({"LM_PORT": client}, args.max_frame_len)

    report = {
        "kernel": __import__("os").uname().release,
        "boot_id": open("/proc/sys/kernel/random/boot_id").read().strip(),
    }

    # -- the flat fan-out: N slices in one batched call -----------------------
    started = time.perf_counter()
    try:
        batched = rpc("LM_PORT", {
            "v": 1, "req_id": "paid-batch", "op": "llm_query_batched",
            "args": {"prompts": batched_prompts, "model": model},
        })
        completions = batched.get("chat_completions", [])
        report["batched_ok"] = True
        report["batched_responses"] = [c.get("response") for c in completions]
        report["batched_n"] = len(completions)
    except Exception as exc:
        report["batched_ok"] = False
        report["batched_error"] = "%s: %s" % (type(exc).__name__, exc)
    report["batched_ms"] = (time.perf_counter() - started) * 1000.0

    # -- the singleton path ---------------------------------------------------
    started = time.perf_counter()
    try:
        single = rpc("LM_PORT", {
            "v": 1, "req_id": "paid-single", "op": "llm_query",
            "args": {"prompt": single_prompt, "model": model},
        })
        report["single_ok"] = True
        report["single_response"] = single.get("chat_completion", {}).get("response")
    except Exception as exc:
        report["single_ok"] = False
        report["single_error"] = "%s: %s" % (type(exc).__name__, exc)
    report["single_ms"] = (time.perf_counter() - started) * 1000.0

    print(json.dumps(report))


if __name__ == "__main__":
    main()
'''


# ---------------------------------------------------------------------------
# Host plumbing
# ---------------------------------------------------------------------------


def build_provider():
    """Construct the real provider from the environment, or explain what is missing.

    Kept apart from the probe so the one credential-reading call site is obvious.
    Prices are required; a missing one is a configuration error surfaced here, not
    a silent $0 that would disable the ledger.
    """
    model = os.environ.get(MODEL_ENV)
    if not model:
        raise probe.ProbeError(
            f"{MODEL_ENV} is not set: name the model this run should call "
            "(e.g. a small instruct model), set beside the key on the host."
        )
    try:
        in_price = float(os.environ[IN_PRICE_ENV])
        out_price = float(os.environ[OUT_PRICE_ENV])
    except KeyError as exc:
        raise probe.ProbeError(
            f"{exc.args[0]} is not set: the ledger needs the model's price "
            "(USD per 1k tokens) to meter the run. A wrong price mis-reports the "
            "bill but cannot exceed the in-engine cap."
        ) from exc
    except ValueError as exc:
        raise probe.ProbeError(f"a price env var is not a number: {exc}") from exc

    base_url = os.environ.get(BASE_URL_ENV) or None
    try:
        provider = openai_chat_provider_from_env(
            default_model=model,
            usd_per_1k_input=in_price,
            usd_per_1k_output=out_price,
            env_var=API_KEY_ENV,
            base_url=base_url,
        )
    except RuntimeError as exc:  # the key is absent
        raise probe.ProbeError(str(exc)) from exc
    return provider, {
        "model": model,
        "usd_per_1k_input": in_price,
        "usd_per_1k_output": out_price,
        "base_url": base_url,
    }


def run_fanout(
    image: str,
    *,
    cap_halt: bool,
    keep: bool,
) -> tuple[dict, list[str]]:
    """Boot once, drive the real fan-out through the bridge, meter it."""
    record: dict = {"mode": "cap-halt" if cap_halt else "default"}
    failures: list[str] = []
    record["host"] = probe.preconditions()

    provider, provider_facts = build_provider()
    record["provider"] = provider_facts

    # The rate cap is lifted for a clean latency read (as in `[R]`); the spend and
    # in-flight caps are the point of the run and stay at their shipped values -
    # except in `--cap-halt`, which lowers the spend cap on purpose to trip it.
    spend_cap = 1e-9 if cap_halt else LMCaps().spend_usd
    config = SandboxConfig(
        lm_caps=LMCaps(requests_per_second=1000.0, spend_usd=spend_cap)
    )
    record["spend_cap_usd"] = config.lm_caps.spend_usd

    audit = AuditLog()
    host = TrellisSandboxHost(
        config=config, backends={}, provider=provider, audit=audit
    )
    host.open_session(GUEST_CID, "s3-paid-guest")

    name = f"s3paid-{uuid.uuid4().hex[:10]}"
    sandbox = probe.Sandbox(name, image)
    record["sandbox"] = name
    record["image"] = image

    witness = probe.Witness()
    listener = None
    stop = threading.Event()
    server: threading.Thread | None = None

    started = time.monotonic()
    sandbox.boot()
    record["ctr_run_detached_seconds"] = round(time.monotonic() - started, 3)

    try:
        record["guest"] = sandbox.guest_identity()
        if record["guest"]["kernel"] == record["host"]["host_kernel"]:
            failures.append(
                f"guest kernel equals host kernel ({record['guest']['kernel']}): "
                "this is not a VM boundary and the fan-out would cross no bridge"
            )

        # -- the host end of the bridge (hybrid vsock, as ratified) -----------
        discovered = probe.discover_vsock_uds(sandbox)
        record["bridge"] = {"kind": "hybrid", **discovered}
        listener = HybridVsockListener(
            discovered["uds_path"],
            config.ports.lm,
            GUEST_CID,
            accept_timeout_s=0.05,
            read_timeout_s=120.0,
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

        # -- ship sources + the fan-out program + the slice prompts -----------
        sandbox.install_sources(probe.PROBE_REQUEST, None)
        sandbox.put_bytes(GUEST_FANOUT_SOURCE.encode(), f"{GUEST_DIR}/guest_fanout.py")
        sandbox.put_bytes(
            json.dumps([s.prompt for s in SLICES]).encode(),
            f"{GUEST_DIR}/slices.json",
        )
        sandbox.put_bytes(
            json.dumps(SINGLE.prompt).encode(), f"{GUEST_DIR}/single.json"
        )

        # -- drive the real fan-out -------------------------------------------
        command = (
            f"cd {GUEST_DIR} && python3 guest_fanout.py --port {config.ports.lm} "
            f"--max-frame-len {config.max_frame_len} "
            f"--slices {GUEST_DIR}/slices.json --single {GUEST_DIR}/single.json"
        )
        raw = sandbox.exec(command, exec_id=f"fanout-{uuid.uuid4().hex[:8]}", timeout=300.0)
        try:
            guest = json.loads(raw.strip().splitlines()[-1])
        except (ValueError, IndexError) as exc:
            raise probe.ProbeError(
                f"the guest fan-out produced no parsable report: {raw!r}"
            ) from exc
        record["guest_report"] = guest

        record["witness"] = {"accepted": witness.accepted, "requests": witness.requests}
        record["spend"] = {
            "charged_usd": round(host.spend_ledger.spent(GUEST_CID), 6),
            "cap_usd": host.spend_ledger.cap_usd,
        }

        if cap_halt:
            _assess_cap_halt(record, guest, witness, failures)
        else:
            _assess_fanout(record, guest, witness, failures)

        # -- teardown (reuses the probe's bounded, never-raising destroy) -----
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


def _assess_fanout(record: dict, guest: dict, witness, failures: list[str]) -> None:
    """The default run: a real model answered every slice, and was billed for it."""
    # The bridge was crossed: two RPC calls (one batched, one single) => two
    # accepted connections. The witness is the only thing a guest answering
    # itself could not forge.
    if witness.accepted < 2:
        failures.append(
            f"the host accepted {witness.accepted} connections; the fan-out makes "
            "two RPC calls, so nothing crossed the bridge"
        )

    # The batched fan-out: every slice checked against its known answer.
    if not guest.get("batched_ok"):
        failures.append("the batched fan-out failed in the guest: " + str(guest.get("batched_error")))
    else:
        responses = guest.get("batched_responses", [])
        if len(responses) != len(SLICES):
            failures.append(f"batched fan-out returned {len(responses)} of {len(SLICES)} completions")
        results = []
        for index, slice_ in enumerate(SLICES):
            text = responses[index] if index < len(responses) else None
            ok = slice_.matches(text or "")
            results.append({
                "task": f"{slice_.a} {slice_.op} {slice_.b}",
                "expected": slice_.expected,
                "response": text,
                "correct": ok,
            })
            if not ok:
                failures.append(
                    f"slice {slice_.a} {slice_.op} {slice_.b} expected {slice_.expected}, "
                    f"model returned {text!r}"
                )
            if text == "S3-OK":
                failures.append("a slice came back with the scripted canned reply, not a model answer")
        record["slices"] = results

    # The singleton path.
    if not guest.get("single_ok"):
        failures.append("the single llm_query failed in the guest: " + str(guest.get("single_error")))
    else:
        text = guest.get("single_response")
        record["single"] = {
            "task": f"{SINGLE.a} {SINGLE.op} {SINGLE.b}",
            "expected": SINGLE.expected,
            "response": text,
            "correct": SINGLE.matches(text or ""),
        }
        if not SINGLE.matches(text or ""):
            failures.append(
                f"single slice {SINGLE.a} {SINGLE.op} {SINGLE.b} expected {SINGLE.expected}, "
                f"model returned {text!r}"
            )

    # The dollar ledger is real: a real model was billed. A $0 charge means the
    # stub answered, or the provider under-reported - either way not adoption.
    charged = record["spend"]["charged_usd"]
    if charged <= 0.0:
        failures.append(
            "the spend ledger charged $0: no real model was billed, so this is not "
            "the adoption run it claims to be"
        )
    if charged > record["spend"]["cap_usd"]:
        failures.append(
            f"the ledger charged ${charged} over the ${record['spend']['cap_usd']} cap"
        )


def _assess_cap_halt(record: dict, guest: dict, witness, failures: list[str]) -> None:
    """`--cap-halt`: the spend cap sits below the first slice; the session halts.

    Requirement 5's `[A]` (BUILD_PLAN section 6): a real fan-out run halts at the
    dollar cap. The batched call's first real charge trips the session-terminal
    hard-stop, and everything after it is refused - so the *batched* call comes
    back as a `cap_spend` refusal rather than completions.
    """
    if witness.accepted < 1:
        failures.append("the host accepted no connection; the cap-halt proves nothing about the bridge")
    # The handler charges $0 first (the exhaustion pre-check), then the real
    # charge on the first slice trips the cap. The guest sees a cap_spend refusal.
    batched_error = guest.get("batched_error", "")
    halted = (not guest.get("batched_ok")) and "cap_spend" in batched_error
    record["cap_halt"] = {
        "batched_ok": guest.get("batched_ok"),
        "batched_error": batched_error,
        "charged_usd": record["spend"]["charged_usd"],
    }
    if not halted:
        failures.append(
            "the fan-out was not halted by the spend cap: expected a cap_spend "
            f"refusal, got ok={guest.get('batched_ok')} error={batched_error!r}"
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--image", default=probe.DEFAULT_IMAGE)
    parser.add_argument("--cap-halt", action="store_true")
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    try:
        record, failures = run_fanout(
            args.image, cap_halt=args.cap_halt, keep=args.keep
        )
    except probe.ProbeError as exc:
        print(f"S3 [A] run could not start: {exc}", file=sys.stderr)
        return 1

    record["failures"] = failures
    if args.json:
        print(json.dumps(record, indent=2, default=str))
    else:
        prov = record.get("provider", {})
        print(f"sandbox      {record.get('sandbox')} ({record.get('image')})")
        print(f"model        {prov.get('model')} @ "
              f"${prov.get('usd_per_1k_input')}/1k in, ${prov.get('usd_per_1k_output')}/1k out"
              + (f"  (base_url {prov['base_url']})" if prov.get('base_url') else ""))
        bridge = record.get("bridge", {})
        print(f"listener     {bridge.get('listen_path', '-')}")
        print(f"guest kernel {record.get('guest', {}).get('kernel')}")
        print(f"witness      accepted={record.get('witness', {}).get('accepted')} "
              f"requests={record.get('witness', {}).get('requests')}")
        for item in record.get("slices", []):
            mark = "OK " if item["correct"] else "BAD"
            print(f"  slice {mark} {item['task']} = {item['expected']}  <- {item['response']!r}")
        single = record.get("single")
        if single:
            mark = "OK " if single["correct"] else "BAD"
            print(f"  single {mark} {single['task']} = {single['expected']}  <- {single['response']!r}")
        spend = record.get("spend", {})
        print(f"spend        charged ${spend.get('charged_usd')} of ${spend.get('cap_usd')} cap")
        if "cap_halt" in record:
            print(f"cap-halt     {record['cap_halt']}")
        print(f"teardown     {record.get('teardown')}")
        for failure in failures:
            print(f"FAIL  {failure}")

    if args.cap_halt:
        if failures:
            print("cap-halt: NOT PROVEN - the spend cap did not halt the run.", file=sys.stderr)
            return 1
        print("cap-halt: PROVEN - the real charge tripped the session-terminal spend cap.")
        return 0
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
