"""The ledgers: over-cap charges deny, and a denied charge costs nothing.

Covers repl_sandbox.ledger against REPL_SANDBOX_DATA_MODEL.md section 6 (The
bounded materialisation exception). These bound the rate of the residual
crossing; they are not the boundary, and nothing here should be read as
testing one.
"""

from __future__ import annotations

import pytest

from repl_sandbox.audit import AuditLog
from repl_sandbox.config import ByteLedgerCaps
from repl_sandbox.errors import CapBytesError, CapSpendError
from repl_sandbox.ledger import ByteLedger, SpendLedger

CID = 42
OTHER_CID = 43

CAPS = ByteLedgerCaps(
    inbound_total=1000,
    inbound_per_call=100,
    outbound_total=500,
    outbound_per_call=50,
)


# --- byte ledger denials ---------------------------------------------------


def test_inbound_over_per_call_cap_denies_and_charges_nothing():
    """A denied call moved no bytes, so it must consume no budget."""
    ledger = ByteLedger(CAPS)
    with pytest.raises(CapBytesError) as excinfo:
        ledger.charge_inbound(CID, CAPS.inbound_per_call + 1)
    assert excinfo.value.code == "cap_bytes"
    assert ledger.used(CID)["inbound"] == 0


def test_outbound_over_per_call_cap_denies():
    ledger = ByteLedger(CAPS)
    with pytest.raises(CapBytesError):
        ledger.charge_outbound(CID, CAPS.outbound_per_call + 1)
    assert ledger.used(CID)["outbound"] == 0


def test_cumulative_inbound_cap_is_a_hard_stop():
    ledger = ByteLedger(CAPS)
    for _ in range(10):
        ledger.charge_inbound(CID, 100)
    assert ledger.remaining(CID)["inbound_remaining"] == 0
    with pytest.raises(CapBytesError):
        ledger.charge_inbound(CID, 1)


def test_a_charge_that_would_straddle_the_cap_is_refused_whole():
    """No partial charge: the ledger never admits the head of an over-cap call."""
    ledger = ByteLedger(CAPS)
    for _ in range(9):
        ledger.charge_inbound(CID, 100)
    ledger.charge_inbound(CID, 50)  # 950 of 1000 used, 50 of headroom left
    with pytest.raises(CapBytesError):
        ledger.charge_inbound(CID, 100)  # within the per-call cap, over the total
    assert ledger.used(CID)["inbound"] == 950


@pytest.mark.parametrize("nbytes", [-1, 1.5, "100", True, None])
def test_malformed_byte_counts_are_refused(nbytes):
    """A negative charge is a credit, and a ledger that takes credits has no ceiling."""
    ledger = ByteLedger(CAPS)
    with pytest.raises(ValueError):
        ledger.charge_inbound(CID, nbytes)


def test_ledgers_are_per_session():
    ledger = ByteLedger(CAPS)
    for _ in range(10):
        ledger.charge_inbound(CID, 100)
    ledger.charge_inbound(OTHER_CID, 100)  # a neighbour is unaffected
    assert ledger.used(OTHER_CID)["inbound"] == 100


def test_directions_are_independent():
    ledger = ByteLedger(CAPS)
    ledger.charge_inbound(CID, 100)
    assert ledger.used(CID)["outbound"] == 0
    ledger.charge_outbound(CID, 50)
    assert ledger.used(CID) == {"inbound": 100, "outbound": 50}


def test_zero_byte_charge_is_admitted():
    ledger = ByteLedger(CAPS)
    ledger.charge_inbound(CID, 0)
    assert ledger.used(CID)["inbound"] == 0


def test_remaining_reports_both_ceilings():
    ledger = ByteLedger(CAPS)
    ledger.charge_inbound(CID, 40)
    assert ledger.remaining(CID) == {
        "inbound_used": 40,
        "inbound_remaining": 960,
        "inbound_per_call": 100,
        "outbound_used": 0,
        "outbound_remaining": 500,
        "outbound_per_call": 50,
    }


def test_close_discards_the_counters_and_is_idempotent():
    ledger = ByteLedger(CAPS)
    ledger.charge_inbound(CID, 100)
    ledger.close(CID)
    ledger.close(CID)
    assert ledger.used(CID)["inbound"] == 0


def test_byte_denials_are_audited():
    audit = AuditLog()
    ledger = ByteLedger(CAPS, audit=audit)
    ledger.charge_inbound(CID, 10)
    with pytest.raises(CapBytesError):
        ledger.charge_inbound(CID, 10_000)
    assert audit.ops() == ["ledger.inbound", "ledger.inbound.denied"]
    assert audit.entries()[-1]["reason"] == "per_call"


# --- spend ledger denials --------------------------------------------------


def test_spend_over_cap_denies_and_is_session_terminal():
    ledger = SpendLedger(1.0)
    ledger.charge(CID, 0.9)
    with pytest.raises(CapSpendError) as excinfo:
        ledger.charge(CID, 0.2)
    assert excinfo.value.code == "cap_spend"
    assert excinfo.value.session_terminal is True
    assert ledger.is_exhausted(CID)


def test_an_exhausted_session_refuses_even_a_tiny_later_charge():
    """Exhaustion ends the run; it does not merely leave a small gap."""
    ledger = SpendLedger(1.0)
    ledger.charge(CID, 0.9)
    with pytest.raises(CapSpendError):
        ledger.charge(CID, 0.2)
    with pytest.raises(CapSpendError):
        ledger.charge(CID, 0.000_1)
    assert ledger.spent(CID) == pytest.approx(0.9)
    assert ledger.remaining(CID) == 0.0


def test_a_denied_spend_is_not_recorded():
    ledger = SpendLedger(1.0)
    with pytest.raises(CapSpendError):
        ledger.charge(CID, 2.0)
    assert ledger.spent(CID) == 0.0


def test_charging_exactly_to_the_cap_is_admitted():
    ledger = SpendLedger(5.0)
    ledger.charge(CID, 5.0)
    assert ledger.spent(CID) == pytest.approx(5.0)
    assert not ledger.is_exhausted(CID)


@pytest.mark.parametrize("usd", [-0.01, float("nan"), float("inf"), "1.0", True, None])
def test_malformed_spend_is_refused(usd):
    """NaN compares false against every cap, so it never reaches the comparison."""
    ledger = SpendLedger(5.0)
    with pytest.raises(ValueError):
        ledger.charge(CID, usd)


def test_spend_is_per_session():
    ledger = SpendLedger(1.0)
    with pytest.raises(CapSpendError):
        ledger.charge(CID, 2.0)
    ledger.charge(OTHER_CID, 0.5)
    assert ledger.spent(OTHER_CID) == pytest.approx(0.5)
    assert not ledger.is_exhausted(OTHER_CID)


def test_close_clears_exhaustion_and_is_idempotent():
    ledger = SpendLedger(1.0)
    with pytest.raises(CapSpendError):
        ledger.charge(CID, 2.0)
    ledger.close(CID)
    ledger.close(CID)
    assert not ledger.is_exhausted(CID)
    assert ledger.spent(CID) == 0.0


def test_negative_cap_is_a_construction_error():
    with pytest.raises(ValueError):
        SpendLedger(-1.0)


def test_spend_denials_are_audited():
    audit = AuditLog()
    ledger = SpendLedger(1.0, audit=audit)
    ledger.charge(CID, 0.5)
    with pytest.raises(CapSpendError):
        ledger.charge(CID, 5.0)
    with pytest.raises(CapSpendError):
        ledger.charge(CID, 0.01)
    assert audit.ops() == ["ledger.spend", "ledger.spend.denied", "ledger.spend.denied"]
    assert audit.entries()[-1]["reason"] == "session_exhausted"
