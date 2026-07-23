"""Tests for the S3 probe's host-side logic — the half that needs no `/dev/kvm`.

`scripts/repl_sandbox_s3_probe.py` runs only on the provisioned Kata host, so
without these it would be a few hundred lines that nobody on a development box
ever executes, and every mistake in it would surface as a confusing failure in
the middle of an expensive host run. What is under test here is everything the
probe does *around* the guest: the scripted provider, the loopback comparison
arm, the byte-parity accounting, the witness the negative control has to defeat,
and the guest program's own byte capture.

Two things this file deliberately does **not** test, because they cannot be
tested here and pretending otherwise is the failure mode the probe exists to
avoid: that a frame crosses a VM boundary, and that Cloud Hypervisor's hybrid
vsock delivers it. Both need a host with KVM.
"""

from __future__ import annotations

import importlib.util
import io
import tarfile
import threading
from pathlib import Path

import pytest

from repl_sandbox.audit import AuditLog
from repl_sandbox.config import LMCaps, SandboxConfig
from repl_sandbox.errors import FrameError
from repl_sandbox.guest_rpc import GuestRpc
from repl_sandbox.host import TrellisSandboxHost
from repl_sandbox.transport import LoopbackListener, serve_forever

PROBE_PATH = (
    Path(__file__).resolve().parents[3] / "scripts" / "repl_sandbox_s3_probe.py"
)


def _load_probe():
    """Import the probe by path — it is a script, not a package module."""
    spec = importlib.util.spec_from_file_location("repl_sandbox_s3_probe", PROBE_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


probe = _load_probe()


@pytest.fixture()
def host_and_config():
    config = SandboxConfig(lm_caps=LMCaps(requests_per_second=1000.0))
    host = TrellisSandboxHost(
        config=config, backends={}, provider=probe.ScriptedProvider(), audit=AuditLog()
    )
    host.open_session(probe.GUEST_CID, "s3-guest")
    host.open_session(probe.LOOPBACK_CID, "s3-loopback")
    try:
        yield host, config
    finally:
        host.close()


# ---------------------------------------------------------------------------
# The comparison arm
# ---------------------------------------------------------------------------


def test_the_reference_arm_is_byte_deterministic(host_and_config) -> None:
    """Byte parity is only a claim if the same call encodes the same bytes twice.

    If the scripted provider ever grew a timestamp, every parity comparison in
    the probe would fail for a reason that has nothing to do with the bridge —
    and it would look exactly like a bridge fault.
    """
    host, config = host_and_config
    first = probe.loopback_reference(host, config, 3)
    second = probe.loopback_reference(host, config, 3)

    assert first["sent_sha256"] == second["sent_sha256"]
    assert first["received_sha256"] == second["received_sha256"]
    assert first["received_bytes"] == second["received_bytes"]
    assert len(first["latency_ms"]) == 3


def test_the_reference_arm_serves_the_scripted_completion(host_and_config) -> None:
    host, config = host_and_config
    reference = probe.loopback_reference(host, config, 1)

    assert reference["response"]["error"] is None
    assert reference["response"]["chat_completion"]["response"] == "S3-OK"
    assert reference["response"]["chat_completion"]["prompt"] == probe.PROBE_PROMPT


def test_the_scripted_provider_spends_nothing() -> None:
    """Zero-paid is a property of this object, not a promise in the docstring."""
    completion, usd = probe.ScriptedProvider().complete("x", "m")
    completions, batched_usd = probe.ScriptedProvider().complete_batched(["x", "y"], "m")

    assert usd == 0.0 and batched_usd == 0.0
    assert completion["usage_summary"]["total_cost"] == 0.0
    assert len(completions) == 2


# ---------------------------------------------------------------------------
# The witness — what the negative control cannot forge
# ---------------------------------------------------------------------------


def test_the_witness_counts_accepts_and_requests(host_and_config) -> None:
    host, config = host_and_config
    witness = probe.Witness()
    listener = LoopbackListener(
        peer_cid=probe.GUEST_CID, accept_timeout_s=0.05, read_timeout_s=5.0
    )
    stop = threading.Event()
    thread = threading.Thread(
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
    thread.start()
    try:
        rpc = GuestRpc({"LM_PORT": listener.client()}, config.max_frame_len)
        result = rpc(
            "LM_PORT",
            {
                "v": 1,
                "req_id": "t",
                "op": "llm_query",
                "args": {"prompt": probe.PROBE_PROMPT, "model": probe.PROBE_MODEL},
            },
        )
        assert result["chat_completion"]["response"] == "S3-OK"
        assert witness.accepted == 1
        assert witness.requests == 1

        # Claim 5 in miniature: the host closes the session and the same peer,
        # on the same socket, stops being served. Nothing the peer writes into a
        # frame brings it back, because identity was never in the frame.
        host.close_session(probe.GUEST_CID)
        with pytest.raises(FrameError):
            rpc(
                "LM_PORT",
                {
                    "v": 1,
                    "req_id": "t2",
                    "op": "llm_query",
                    "args": {"prompt": probe.PROBE_PROMPT},
                },
            )
        assert "connection_denied" in witness.named()
    finally:
        stop.set()
        listener.close()
        thread.join(timeout=5.0)


# ---------------------------------------------------------------------------
# What ships into the guest
# ---------------------------------------------------------------------------


def test_the_guest_gets_the_shipping_package_without_its_tests() -> None:
    names = tarfile.open(fileobj=io.BytesIO(probe.source_tarball()), mode="r:gz").getnames()

    assert "repl_sandbox/transport.py" in names
    assert "repl_sandbox/guest_rpc.py" in names
    assert not [name for name in names if "tests" in name or "__pycache__" in name]


def test_both_guest_programs_compile() -> None:
    """They are shipped as source strings, so a syntax error surfaces on the host."""
    compile(probe.GUEST_PROBE_SOURCE, "guest_probe.py", "exec")
    compile(probe.GUEST_CONTROL_SOURCE, "guest_control.py", "exec")


def test_the_guest_captures_the_same_bytes_the_host_encodes(host_and_config) -> None:
    """The guest's captured digests must match the host's for identical content.

    This runs the guest program's own `exchange` against its own negative-control
    responder — the one path in that file that needs neither vsock nor KVM. It is
    also the negative control in miniature, and the point is worth stating: the
    digests match *because the boundary was never crossed*, which is why the
    probe's detector is the host-side witness and not anything the guest reports.
    """
    host, config = host_and_config
    reference = probe.loopback_reference(host, config, 1)

    namespace: dict = {"__name__": "guest_probe_under_test"}
    exec(compile(probe.GUEST_PROBE_SOURCE, "guest_probe.py", "exec"), namespace)

    echo = namespace["LocalEcho"](reference["response"], config.max_frame_len)
    threading.Thread(target=echo.serve_forever, daemon=True).start()
    exchanged = namespace["exchange"](
        namespace["LocalClient"](echo.port), probe.PROBE_REQUEST, config.max_frame_len
    )

    assert exchanged["response"] == reference["response"]
    assert exchanged["sent_sha256"] == reference["sent_sha256"]
    assert exchanged["received_sha256"] == reference["received_sha256"]
    assert exchanged["elapsed_ms"] > 0.0


# ---------------------------------------------------------------------------
# Small things that would be annoying to debug on a remote host
# ---------------------------------------------------------------------------


def test_percentile_is_order_independent_and_clamped() -> None:
    assert probe.percentile([5, 1, 3, 2, 4], 0.5) == 3
    assert probe.percentile([1, 2], 0.95) == 2
    assert probe.percentile([7], 0.5) == 7


def test_the_probe_refuses_a_host_with_no_kvm() -> None:
    """The development box must fail in the first check, not halfway through a boot."""
    import os

    if os.path.exists("/dev/kvm"):
        pytest.skip("this host has /dev/kvm; the refusal path is unreachable here")
    with pytest.raises(probe.ProbeError, match="/dev/kvm is absent"):
        probe.preconditions()
