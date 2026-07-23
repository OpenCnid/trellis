"""Tests for the S3 `[A]` harness's host-side logic — the half that needs no host.

`scripts/repl_sandbox_s3_paid.py` runs only on the provisioned Kata host and
spends real money doing it, so a mistake in its verdict logic is the most
expensive kind to find on the host. What is under test here is everything the
harness decides *around* the paid call: the deterministic slice check, the
provider construction's env handling (without ever reading a key or a network),
the guest program compiling, and the two assessors that turn a guest report into
a pass or a list of failures.

What cannot be tested here, and is not: that a real model answered, that dollars
were charged, and that a frame crossed the VM boundary. Those need the host and
the key, and pretending otherwise is the exact self-certification the split
`[R]`/`[A]` gate exists to forbid.
"""

from __future__ import annotations

import importlib.util
import types
from pathlib import Path

import pytest

PAID_PATH = (
    Path(__file__).resolve().parents[3] / "scripts" / "repl_sandbox_s3_paid.py"
)


def _load_paid():
    spec = importlib.util.spec_from_file_location("repl_sandbox_s3_paid", PAID_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


paid = _load_paid()


def _witness(accepted: int, requests: int = 0):
    return types.SimpleNamespace(
        accepted=accepted, requests=requests, named=lambda: []
    )


# ---------------------------------------------------------------------------
# The deterministic slice check — the thing that makes "correct" decidable
# ---------------------------------------------------------------------------


def test_slice_expected_is_the_real_arithmetic() -> None:
    assert paid.Slice(17, 23, "*").expected == 391
    assert paid.Slice(128, 5, "+").expected == 133
    assert paid.Slice(900, 37, "-").expected == 863


def test_slice_matches_extracts_the_first_integer() -> None:
    s = paid.Slice(6, 7, "*")  # 42
    assert s.matches("42")
    assert s.matches("The answer is 42.")
    assert s.matches("42\n")
    assert not s.matches("41")
    assert not s.matches("S3-OK")
    assert not s.matches("")
    assert not s.matches(None)  # type: ignore[arg-type]


def test_slice_matches_rejects_a_number_that_merely_contains_the_digits() -> None:
    s = paid.Slice(1, 1, "+")  # 2
    # The first integer in the reply is the model's answer; 420 is not 2.
    assert not s.matches("420")


def test_the_batched_slices_fit_the_shipped_in_flight_ceiling() -> None:
    """Four slices, one batched call: the width is the real ceiling, not invented.

    If someone grows `SLICES` past `max_in_flight`, the batched call would be
    refused by the handler on the host and the run would fail for a reason that
    has nothing to do with the model. This keeps that honest.
    """
    from repl_sandbox.config import LMCaps

    assert len(paid.SLICES) <= LMCaps().max_in_flight


# ---------------------------------------------------------------------------
# Provider construction — env handling, no key, no network
# ---------------------------------------------------------------------------


def test_build_provider_names_the_missing_model(monkeypatch) -> None:
    monkeypatch.delenv(paid.MODEL_ENV, raising=False)
    with pytest.raises(paid.probe.ProbeError, match=paid.MODEL_ENV):
        paid.build_provider()


def test_build_provider_names_a_missing_price(monkeypatch) -> None:
    monkeypatch.setenv(paid.MODEL_ENV, "some-small-model")
    monkeypatch.delenv(paid.IN_PRICE_ENV, raising=False)
    monkeypatch.delenv(paid.OUT_PRICE_ENV, raising=False)
    with pytest.raises(paid.probe.ProbeError, match="price"):
        paid.build_provider()


def test_build_provider_reports_a_nonnumeric_price(monkeypatch) -> None:
    monkeypatch.setenv(paid.MODEL_ENV, "some-small-model")
    monkeypatch.setenv(paid.IN_PRICE_ENV, "not-a-number")
    monkeypatch.setenv(paid.OUT_PRICE_ENV, "1.0")
    with pytest.raises(paid.probe.ProbeError, match="not a number"):
        paid.build_provider()


def test_build_provider_surfaces_a_missing_key(monkeypatch) -> None:
    """Prices present, model present, key absent: the credential error surfaces.

    This exercises the whole env path up to the key read without importing the
    OpenAI SDK, because `openai_chat_provider_from_env` reads the key before its
    local SDK import.
    """
    monkeypatch.setenv(paid.MODEL_ENV, "some-small-model")
    monkeypatch.setenv(paid.IN_PRICE_ENV, "0.1")
    monkeypatch.setenv(paid.OUT_PRICE_ENV, "0.4")
    monkeypatch.delenv(paid.API_KEY_ENV, raising=False)
    with pytest.raises(paid.probe.ProbeError, match=paid.API_KEY_ENV):
        paid.build_provider()


# ---------------------------------------------------------------------------
# The guest program ships as source — a syntax error must surface here
# ---------------------------------------------------------------------------


def test_the_guest_fanout_program_compiles() -> None:
    compile(paid.GUEST_FANOUT_SOURCE, "guest_fanout.py", "exec")


# ---------------------------------------------------------------------------
# The assessors — the verdict logic, against fabricated guest reports
# ---------------------------------------------------------------------------


def _correct_guest_report():
    return {
        "batched_ok": True,
        "batched_responses": [str(s.expected) for s in paid.SLICES],
        "single_ok": True,
        "single_response": str(paid.SINGLE.expected),
    }


def _record_with_spend(charged: float, cap: float = 5.0):
    return {"spend": {"charged_usd": charged, "cap_usd": cap}}


def test_a_clean_paid_run_has_no_failures() -> None:
    record = _record_with_spend(0.0123)
    failures: list[str] = []
    paid._assess_fanout(record, _correct_guest_report(), _witness(accepted=2), failures)
    assert failures == []
    assert all(item["correct"] for item in record["slices"])
    assert record["single"]["correct"]


def test_a_zero_charge_fails_the_adoption_run() -> None:
    """Correct answers but $0 billed is the stub, not a model. It must fail."""
    record = _record_with_spend(0.0)
    failures: list[str] = []
    paid._assess_fanout(record, _correct_guest_report(), _witness(accepted=2), failures)
    assert any("charged $0" in f for f in failures)


def test_a_wrong_slice_answer_fails_and_names_the_slice() -> None:
    report = _correct_guest_report()
    report["batched_responses"][0] = "999"  # first slice is 17*23=391
    record = _record_with_spend(0.01)
    failures: list[str] = []
    paid._assess_fanout(record, report, _witness(accepted=2), failures)
    assert any("17 * 23" in f and "391" in f for f in failures)


def test_a_canned_reply_fails_even_if_it_somehow_parsed() -> None:
    report = _correct_guest_report()
    report["batched_responses"][1] = "S3-OK"  # the scripted probe's canned reply
    record = _record_with_spend(0.01)
    failures: list[str] = []
    paid._assess_fanout(record, report, _witness(accepted=2), failures)
    assert any("canned" in f for f in failures)


def test_no_connection_crossing_fails_the_bridge_claim() -> None:
    """Correct answers, real charge, but the witness saw nothing arrive.

    This is the negative-control shape carried over from `[R]`: a guest that
    answered itself would still look right, and only the host-side count of
    connections that arrived can catch it.
    """
    record = _record_with_spend(0.01)
    failures: list[str] = []
    paid._assess_fanout(record, _correct_guest_report(), _witness(accepted=0), failures)
    assert any("crossed the bridge" in f for f in failures)


def test_cap_halt_passes_when_the_batched_call_is_refused_for_spend() -> None:
    record = _record_with_spend(0.0)
    guest = {"batched_ok": False, "batched_error": "cap_spend: session spend exhausted"}
    failures: list[str] = []
    paid._assess_cap_halt(record, guest, _witness(accepted=1), failures)
    assert failures == []
    assert record["cap_halt"]["batched_ok"] is False


def test_cap_halt_fails_if_the_run_completed_instead_of_halting() -> None:
    record = _record_with_spend(0.02)
    guest = _correct_guest_report()
    failures: list[str] = []
    paid._assess_cap_halt(record, guest, _witness(accepted=1), failures)
    assert any("not halted by the spend cap" in f for f in failures)
