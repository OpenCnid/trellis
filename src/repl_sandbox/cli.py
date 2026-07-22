"""The operator entrypoint: `python -m repl_sandbox.cli <command>`.

Three commands, each one a thing an operator needs to be able to *run* rather
than read:

* `preflight` — host provisioning gate G1 (BUILD_PLAN section 4), executed
  against this host and reported in full. Exits non-zero when the gate fails, so
  a deployment script can gate on it.
* `selftest` — stands the whole host-side control plane up over the in-process
  launcher and drives a `KataREPL` three-method round trip through it. **The
  in-process launcher provides no isolation.** This command proves wiring and
  nothing else; it can never say anything about the boundary.
* `config` — the effective configuration, both version pins, and `max_frame_len`,
  so an operator reads what is configured rather than what is documented.

Nothing here constructs a real database client, a real provider client, or reads
an API key. `selftest` runs entirely against in-process doubles and spends no
money.

House rule (AGENTS.md section 4, rule 15): a passing suite says the code is
right, never that anything can invoke it. This module is the invoker for
`repl_sandbox.host`, `repl_sandbox.launcher`, and `repl_sandbox.config`; the
drill at `scripts/repl_sandbox_drill.py` is the invoker for the refusals.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from typing import Any, Sequence

from repl_sandbox.broker import ResultSet
from repl_sandbox.config import (
    CLOUD_HYPERVISOR_MIN_VERSION,
    KATA_MIN_VERSION,
    SandboxConfig,
)
from repl_sandbox.dlp import DlpHook
from repl_sandbox.frame import buffer_recv, encode_frame, read_frame
from repl_sandbox.guest_rpc import DB_PORT_NAME, LM_PORT_NAME, GuestRpc
from repl_sandbox.host import TrellisSandboxHost
from repl_sandbox.launcher import KVM_DEVICE, InProcessLauncher, KataLauncher
from repl_sandbox.lm_handler import PromptValue
from repl_sandbox.transport import Handler, vsock_available

#: Printed by `selftest`, twice, because it is the only thing that command's
#: output must not be read without.
NO_ISOLATION_NOTICE = (
    "NOTE: the in-process launcher provides NO ISOLATION. There is no microVM, "
    "no kernel boundary, no privilege separation, and the CID is a constant this "
    "process chose rather than one a kernel assigned. This command proves that "
    "the modules are WIRED TOGETHER. It proves nothing whatsoever about the "
    "boundary, which is the Kata microVM (ARCHITECTURE section 2) and can only "
    "be exercised on a KVM-capable Linux host."
)


# ---------------------------------------------------------------------------
# In-process doubles. Never a real client; never a network call; never a key.
# ---------------------------------------------------------------------------


class SelftestBackend:
    """A `DBBackend` that answers from a fixed table. **A double, not a driver.**

    It holds no connection, no credential, and no route. `read_only = True` is
    honest here for the trivial reason that there is no other path in it.
    """

    read_only = True

    def __init__(self, rows: list[list], schema: list[dict]) -> None:
        self._rows = rows
        self._schema = schema

    def run_query(self, sql: str, params: list) -> ResultSet:
        return ResultSet(rows=list(self._rows), schema=list(self._schema), rowcount=len(self._rows))

    def run_cypher(self, query: str, params: dict) -> ResultSet:
        return ResultSet(rows=list(self._rows), schema=list(self._schema), rowcount=len(self._rows))


class SelftestProvider:
    """A `Provider` that echoes. **A double: it reaches no paid API and costs $0.**

    It reports a real per-call cost of `0.0` because no call was made. A real
    provider reporting 0.0 would silently disable the dollar cap, which is why
    the spend cap is exercised by the drill against a provider that reports a
    real number, not by this one.
    """

    def __init__(self) -> None:
        self.calls = 0

    def complete(self, prompt: PromptValue, model: str | None) -> tuple[dict, float]:
        self.calls += 1
        text = prompt if isinstance(prompt, str) else json.dumps(prompt)
        return {"root_model": model or "selftest-double", "response": f"echo: {text}"}, 0.0

    def complete_batched(
        self, prompts: list[PromptValue], model: str | None
    ) -> tuple[list[dict], float]:
        return [self.complete(prompt, model)[0] for prompt in prompts], 0.0


class InProcessRpcClient:
    """An `RpcClient` that hands a frame to a host handler in this process.

    **Not a transport and not a boundary.** There is no socket: the payload is
    encoded to a real frame, read back through `frame.read_frame`, handed to the
    handler with a CID this process chose, and the response makes the same round
    trip. What that buys is that the frame codec and the handler's envelope
    handling are both exercised; what it does not buy is any part of the
    isolation the real vsock seam sits on.
    """

    def __init__(self, handler: Handler, cid: int) -> None:
        self._handler = handler
        self._cid = cid

    def request(self, payload: dict, max_frame_len: int) -> dict:
        wire = encode_frame(payload, max_frame_len)
        decoded = read_frame(buffer_recv(wire), max_frame_len)
        assert decoded is not None  # a frame we just encoded always reads back
        response = self._handler(self._cid, decoded)
        back = encode_frame(response, max_frame_len)
        result = read_frame(buffer_recv(back), max_frame_len)
        assert result is not None
        return result


# ---------------------------------------------------------------------------
# preflight
# ---------------------------------------------------------------------------


def command_preflight(config: SandboxConfig, verbose: bool) -> int:
    """Run gate G1 against this host and report it. Non-zero when it fails."""
    launcher = KataLauncher(config)
    result = launcher.preflight()

    print("Trellis REPL sandbox - host provisioning gate G1")
    print("(BUILD_PLAN section 4; ARCHITECTURE section 7 requirement 3)")
    print("")
    print(result.report())
    print("")
    print(f"kvm device      : {KVM_DEVICE}")
    print(f"kata pin        : >= {config.kata_min_version}")
    print(f"cloud-hypervisor: >= {config.cloud_hypervisor_min_version}")
    print(f"AF_VSOCK on this host: {vsock_available()}")

    if verbose:
        print("")
        print("observed:")
        print(json.dumps(result.observed, indent=2, sort_keys=True, default=str))

    if result.ok:
        print("")
        print("G1 passed: this host can boot a Kata microVM on Cloud Hypervisor.")
        return 0

    print("")
    print(
        "G1 FAILED. The Trellis REPL sandbox requires a KVM-capable Linux host: "
        f"a readable and writable character device at {KVM_DEVICE}, "
        "kata-runtime and cloud-hypervisor on PATH at or above their pins, and a "
        "measured acceleration comparison proving the VM is hardware-accelerated "
        "rather than a silent QEMU-TCG fallback. Windows and macOS have no "
        "/dev/kvm; there is no boundary to be had on them and no launcher here "
        "will pretend otherwise."
    )
    return 1


# ---------------------------------------------------------------------------
# selftest
# ---------------------------------------------------------------------------


def _selftest_host(config: SandboxConfig, dlp: DlpHook) -> TrellisSandboxHost:
    backend = SelftestBackend(
        rows=[[1, "alpha"], [2, "beta"], [3, "gamma"]],
        schema=[{"name": "id", "type_code": 23}, {"name": "label", "type_code": 25}],
    )
    return TrellisSandboxHost(
        config=config,
        backends={"postgres": backend, "neo4j": backend},
        provider=SelftestProvider(),
        # Defense-in-depth on the outbound residual, never the boundary
        # (REPL_SANDBOX_ARCHITECTURE.md section 7 requirement 12). Installed here
        # so the selftest exercises the hook rather than the empty default; a
        # deployment passes the rule set its own review chose.
        dlp=dlp,
    )


def command_selftest(config: SandboxConfig) -> int:
    """Stand the control plane up over the in-process double and drive it.

    The import of `kata_repl` is local because it imports the pinned `rlms`, and
    `preflight` and `config` must run on a host that does not have it.
    """
    from repl_sandbox.kata_repl import KataREPL  # local: pulls in rlms
    from repl_sandbox.launcher import IN_PROCESS_CID

    print("Trellis REPL sandbox - control-plane selftest")
    print("")
    print(NO_ISOLATION_NOTICE)
    print("")

    exercised: list[str] = []
    dlp = DlpHook.with_default_rules()
    host = _selftest_host(config, dlp)
    cid = IN_PROCESS_CID
    backend: Any = None
    try:
        session = host.open_session(
            cid,
            "selftest",
            ops=["run_query", "run_cypher", "resolve_meta", "project", "slice"],
        )
        exercised.append(
            f"host.open_session   -> cid {session.cid} bound to {session.session_id!r}; "
            f"granted {len(session.granted_ops)} capabilities "
            f"({', '.join(session.granted_ops)})"
        )

        # 1. The DB seam, guest-side calling convention through to the broker.
        rpc = GuestRpc(
            {
                DB_PORT_NAME: InProcessRpcClient(host.broker_handler, cid),
                LM_PORT_NAME: InProcessRpcClient(host.lm_handler, cid),
            },
            config.max_frame_len,
        )
        query = rpc(
            DB_PORT_NAME,
            {"v": 1, "req_id": "selftest-1", "op": "run_query", "args": {"sql": "SELECT 1"}},
        )
        handle = query["handle"]
        exercised.append(
            f"broker.run_query    -> handle {handle['kind']} with {query['rowcount']} rows; "
            "no row crossed"
        )

        meta = rpc(
            DB_PORT_NAME,
            {
                "v": 1,
                "req_id": "selftest-2",
                "op": "resolve_meta",
                "args": {"handle": handle},
            },
        )
        exercised.append(f"broker.resolve_meta -> shape {meta['shape']}, no content")

        derived = rpc(
            DB_PORT_NAME,
            {
                "v": 1,
                "req_id": "selftest-3",
                "op": "project",
                "args": {"handle": handle["id"], "cols": ["label"]},
            },
        )
        exercised.append(
            f"algebra.project     -> derived handle {derived['handle']['kind']}; "
            "no referent was read"
        )

        window = rpc(
            DB_PORT_NAME,
            {
                "v": 1,
                "req_id": "selftest-4",
                "op": "slice",
                "args": {"handle": handle, "span": {"start": 0, "end": 2}},
            },
        )
        used = host.byte_ledger.used(cid)
        exercised.append(
            f"broker.slice        -> {len(window['rows'])} rows returned, "
            f"{used['inbound']} inbound bytes charged to the session ledger"
        )

        # 2. The LM seam, same calling convention, rlms-native wire underneath.
        completion = rpc(
            LM_PORT_NAME,
            {
                "v": 1,
                "req_id": "selftest-5",
                "op": "llm_query",
                "args": {"prompt": "selftest"},
            },
        )
        exercised.append(
            "lm_handler.llm_query-> "
            f"{completion['chat_completion']['response']!r}; "
            f"${host.spend_ledger.spent(cid):.4f} charged of a "
            f"${host.spend_ledger.cap_usd:.2f} cap (the provider is a double: $0); "
            f"outbound prompt scanned by {len(dlp.rules)} DLP rules "
            "(defense-in-depth on the residual, never the boundary)"
        )

        # 3. The rlms-facing backend: the three-method contract, in order.
        backend = KataREPL(
            config=config,
            launcher=InProcessLauncher(config),
            capabilities=session.capabilities,
            sessions=host.sessions,
            audit=host.audit,
            session_id="selftest",
        )
        backend.setup()
        exercised.append(
            "KataREPL.setup      -> guest claimed, CID bound, bridge up, "
            "capabilities materialised, control round trip answered"
        )

        backend.load_context({"task": "selftest", "handle": handle})
        exercised.append(
            "KataREPL.load_context -> `context` pinned in the guest; the handle "
            "crossed as an opaque token, its referent stayed host-side"
        )

        first = backend.execute_code("total = 41\nprint(context['task'])")
        second = backend.execute_code("total += 1\nprint(total)")
        exercised.append(
            f"KataREPL.execute_code -> turn 1 stdout {first.stdout.strip()!r}, "
            f"turn 2 stdout {second.stdout.strip()!r} "
            f"(namespace persisted; locals marshalled as {len(second.locals)} reprs)"
        )
    except Exception as exc:  # noqa: BLE001 - the selftest reports its own failure
        for line in exercised:
            print(f"  ok   {line}")
        print(f"  FAIL {type(exc).__name__}: {exc}")
        print("")
        print("SELFTEST FAILED: the control plane did not compose.")
        return 1
    finally:
        if backend is not None:
            backend.cleanup()
        report = host.close_session(cid)
        host.close()

    for line in exercised:
        print(f"  ok   {line}")
    print(
        f"  ok   host.close_session -> {report.handles_freed} handles freed, "
        f"{report.dispatch_revoked} dispatch grants revoked, "
        f"{'no teardown errors' if report.clean else 'ERRORS: ' + '; '.join(report.errors)}"
    )
    print("")
    print(f"SELFTEST PASSED: {len(exercised) + 1} steps, {len(host.audit)} audit events.")
    print(NO_ISOLATION_NOTICE)
    return 0 if report.clean else 1


# ---------------------------------------------------------------------------
# config
# ---------------------------------------------------------------------------


def command_config(config: SandboxConfig, as_json: bool) -> int:
    """Print the effective configuration — what is configured, not what is documented."""
    effective: dict[str, Any] = {
        "version_pins": {
            "kata": {"minimum": config.kata_min_version, "module_default": KATA_MIN_VERSION},
            "cloud_hypervisor": {
                "minimum": config.cloud_hypervisor_min_version,
                "module_default": CLOUD_HYPERVISOR_MIN_VERSION,
            },
        },
        "max_frame_len": config.max_frame_len,
        "handle_ttl_s": config.handle_ttl_s,
        "vsock_ports": asdict(config.ports),
        "lm_caps": asdict(config.lm_caps),
        "byte_caps": asdict(config.byte_caps),
        "broker_caps": asdict(config.broker_caps),
        "marshal_caps": asdict(config.marshal_caps),
    }

    if as_json:
        print(json.dumps(effective, indent=2, sort_keys=True))
        return 0

    print("Trellis REPL sandbox - effective configuration")
    print("")
    print("version pins (two upstreams, two schemes, two advisory feeds):")
    print(f"  kata-runtime      >= {config.kata_min_version}")
    print(f"  cloud-hypervisor  >= {config.cloud_hypervisor_min_version}")
    print("")
    print("wire:")
    print(f"  max_frame_len     {config.max_frame_len} bytes")
    print(f"  vsock ports       lm={config.ports.lm} db={config.ports.db} "
          f"control={config.ports.control}")
    print("")
    print("LM caps (host-enforced, CID-keyed):")
    print(f"  max_in_flight     {config.lm_caps.max_in_flight}")
    print(f"  requests_per_sec  {config.lm_caps.requests_per_second}")
    print(f"  spend_usd         ${config.lm_caps.spend_usd}")
    print(f"  depth_ceiling     {config.lm_caps.depth_ceiling}")
    print("")
    print("byte ledgers (rate bounds on the residual - NOT the boundary):")
    print(f"  inbound           {config.byte_caps.inbound_total} total, "
          f"{config.byte_caps.inbound_per_call} per call")
    print(f"  outbound          {config.byte_caps.outbound_total} total, "
          f"{config.byte_caps.outbound_per_call} per call")
    print("")
    print("broker caps:")
    print(f"  statement_timeout {config.broker_caps.statement_timeout_ms} ms")
    print(f"  bolt_timeout      {config.broker_caps.bolt_timeout_ms} ms")
    print(f"  max_rows          {config.broker_caps.max_rows}")
    print(f"  max_result_bytes  {config.broker_caps.max_result_bytes}")
    print("")
    print("marshaling caps (output shaping - NOT a boundary):")
    print(f"  stdout/stderr     {config.marshal_caps.stdout_bytes}"
          f"/{config.marshal_caps.stderr_bytes} bytes")
    print(f"  answer            {config.marshal_caps.answer_bytes} bytes")
    print("")
    print(f"handle TTL          {config.handle_ttl_s} s")
    return 0


# ---------------------------------------------------------------------------
# entrypoint
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m repl_sandbox.cli",
        description="Operator entrypoint for the Trellis REPL sandbox host-side control plane.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    preflight = sub.add_parser(
        "preflight", help="run host provisioning gate G1; non-zero when it fails"
    )
    preflight.add_argument(
        "--verbose", action="store_true", help="print every probe's observed output"
    )

    sub.add_parser(
        "selftest",
        help="compose the control plane over the in-process double (NO ISOLATION) and drive it",
    )

    config_cmd = sub.add_parser("config", help="print the effective configuration")
    config_cmd.add_argument("--json", action="store_true", help="print as JSON")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    config = SandboxConfig()

    if args.command == "preflight":
        return command_preflight(config, args.verbose)
    if args.command == "selftest":
        return command_selftest(config)
    if args.command == "config":
        return command_config(config, args.json)
    return 2  # unreachable: argparse rejects an unknown command first


if __name__ == "__main__":
    sys.exit(main())
