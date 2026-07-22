"""The two byte ledgers and the dollar ledger — rate bounds on the residual.

Source of truth: docs/product/repl-sandbox/REPL_SANDBOX_DATA_MODEL.md section 6
(The bounded materialisation exception — where the residual lives), with the
cap values in `config.ByteLedgerCaps` / `config.LMCaps` from
REPL_SANDBOX_SPEC.md section 5 (Configuration).

**These bound the residual. They are not the boundary, and no comment in this
file may promote them to one.** The boundary is a data-flow property: the
user's corpus is never materialised in the guest, so the sanctioned crossings
cannot leak what the guest never held. Strip every cap in this module and bulk
exfiltration is *still* structurally impossible — the model would still have to
drive it byte by byte through explicit, audited sinks. What these ledgers do is
bound the *rate* of that narrow residual channel, CID-keyed and host-enforced
(DATA_MODEL section 6, "the quantified residual"; ARCHITECTURE section 7
requirement 1; SPEC section 6, the "NOT a boundary" row).

Both charge directions are hard stops with two ceilings each — a per-call cap
and a cumulative per-session cap — and both refuse *before* applying, so a
rejected call consumes nothing: no bytes crossed, so no bytes are charged, and
the ledger cannot be walked past its ceiling by a call that was denied.

The spend ledger is dollar-denominated and its exhaustion is session-terminal
(`CapSpendError`, INTERFACES section 7): once a session trips it, every later
charge denies too, however small, because the session is over rather than
merely short of budget.

Charges are pre-authorisations against a measured byte count; a caller that
must charge actual post-hoc cost calls again with the delta. Not internally
synchronised — the broker serialises per-CID work.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from repl_sandbox.audit import AuditLog
from repl_sandbox.config import ByteLedgerCaps
from repl_sandbox.errors import CapBytesError, CapSpendError

#: The two metered directions of DATA_MODEL section 6.
LEDGER_DIRECTIONS: tuple[str, ...] = ("inbound", "outbound")


@dataclass
class _Counters:
    inbound: int = 0
    outbound: int = 0


class ByteLedger:
    """Cumulative + per-call byte ceilings, per direction, per session.

    `inbound` is host-resident content crossing into the guest (`materialize`,
    aggregate materialisations, an `llm_query` completion return). `outbound`
    is content crossing outward (an `llm_query` prompt, an `answer` submission).
    """

    def __init__(self, caps: ByteLedgerCaps, audit: AuditLog | None = None):
        self._caps = caps
        self._used: dict[int, _Counters] = {}
        self.audit = audit

    @property
    def caps(self) -> ByteLedgerCaps:
        return self._caps

    def charge_inbound(self, cid: int, nbytes: int) -> None:
        """Charge content crossing into the guest, or deny."""
        self._charge(cid, "inbound", nbytes, self._caps.inbound_per_call, self._caps.inbound_total)

    def charge_outbound(self, cid: int, nbytes: int) -> None:
        """Charge content crossing outward, or deny."""
        self._charge(
            cid, "outbound", nbytes, self._caps.outbound_per_call, self._caps.outbound_total
        )

    def _charge(self, cid: int, direction: str, nbytes: int, per_call: int, total: int) -> None:
        _check_cid(cid)
        nbytes = _check_bytes(nbytes)
        counters = self._used.setdefault(cid, _Counters())
        used = getattr(counters, direction)

        if nbytes > per_call:
            self._deny(cid, direction, nbytes, used, "per_call")
            raise CapBytesError(
                f"{direction} call of {nbytes} bytes exceeds the per-call cap {per_call}"
            )
        if used + nbytes > total:
            self._deny(cid, direction, nbytes, used, "cumulative")
            raise CapBytesError(
                f"{direction} ledger exhausted: {used} of {total} bytes used, "
                f"{nbytes} more requested"
            )

        setattr(counters, direction, used + nbytes)
        if self.audit is not None:
            self.audit.record(
                cid,
                f"ledger.{direction}",
                nbytes=nbytes,
                used=used + nbytes,
                cap=total,
            )

    def used(self, cid: int) -> dict:
        """Bytes charged so far, per direction."""
        counters = self._used.get(cid, _Counters())
        return {"inbound": counters.inbound, "outbound": counters.outbound}

    def remaining(self, cid: int) -> dict:
        """Headroom and per-call ceilings for a session.

        Host-side operator view. It reports the session's own budget, which is
        not host-resident data — but it is still a host-side call, and nothing
        obliges the broker to hand it to the guest.
        """
        counters = self._used.get(cid, _Counters())
        return {
            "inbound_used": counters.inbound,
            "inbound_remaining": max(0, self._caps.inbound_total - counters.inbound),
            "inbound_per_call": self._caps.inbound_per_call,
            "outbound_used": counters.outbound,
            "outbound_remaining": max(0, self._caps.outbound_total - counters.outbound),
            "outbound_per_call": self._caps.outbound_per_call,
        }

    def close(self, cid: int) -> None:
        """Discard a session's counters. Idempotent; runs in teardown."""
        counters = self._used.pop(cid, None)
        if counters is not None and self.audit is not None:
            self.audit.record(
                cid,
                "ledger.close",
                inbound=counters.inbound,
                outbound=counters.outbound,
            )

    def _deny(self, cid: int, direction: str, nbytes: int, used: int, reason: str) -> None:
        if self.audit is not None:
            self.audit.record(
                cid,
                f"ledger.{direction}.denied",
                nbytes=nbytes,
                used=used,
                reason=reason,
            )


class SpendLedger:
    """Dollar-denominated per-session ceiling; exhaustion halts the session.

    House rule: paid runs are capped (`LMCaps.spend_usd`, $5). rlms' own
    bookkeeping is in-process and model code bypasses it; this ledger is
    host-side and CID-keyed, which is what ARCHITECTURE section 7 requirement 5
    asks for.
    """

    def __init__(self, cap_usd: float, audit: AuditLog | None = None):
        if not isinstance(cap_usd, (int, float)) or isinstance(cap_usd, bool):
            raise ValueError("cap_usd must be a number")
        if not math.isfinite(cap_usd) or cap_usd < 0:
            raise ValueError(f"cap_usd must be finite and non-negative, got {cap_usd}")
        self._cap = float(cap_usd)
        self._spent: dict[int, float] = {}
        self._exhausted: set[int] = set()
        self.audit = audit

    @property
    def cap_usd(self) -> float:
        return self._cap

    def charge(self, cid: int, usd: float) -> None:
        """Charge a session, or deny and terminate it.

        A charge that would cross the cap is refused *and* marks the session
        exhausted: the run is over, so a later cheaper call is not admitted
        into the gap left behind.
        """
        _check_cid(cid)
        usd = _check_usd(usd)
        if cid in self._exhausted:
            self._deny(cid, usd, "session_exhausted")
            raise CapSpendError(f"session {cid} spend ledger is exhausted")

        spent = self._spent.get(cid, 0.0)
        if spent + usd > self._cap:
            self._exhausted.add(cid)
            self._deny(cid, usd, "cap_exceeded")
            raise CapSpendError(
                f"spend cap ${self._cap:.4f} would be exceeded: "
                f"${spent:.4f} spent, ${usd:.4f} more requested"
            )

        self._spent[cid] = spent + usd
        if self.audit is not None:
            self.audit.record(cid, "ledger.spend", usd=usd, spent=spent + usd, cap=self._cap)

    def spent(self, cid: int) -> float:
        """Dollars charged so far."""
        return self._spent.get(cid, 0.0)

    def remaining(self, cid: int) -> float:
        """Budget left. Zero once the session is exhausted."""
        if cid in self._exhausted:
            return 0.0
        return max(0.0, self._cap - self._spent.get(cid, 0.0))

    def is_exhausted(self, cid: int) -> bool:
        """Whether the session has tripped the cap and is therefore over."""
        return cid in self._exhausted

    def close(self, cid: int) -> None:
        """Discard a session's ledger. Idempotent; runs in teardown."""
        spent = self._spent.pop(cid, None)
        self._exhausted.discard(cid)
        if spent is not None and self.audit is not None:
            self.audit.record(cid, "ledger.spend.close", spent=spent)

    def _deny(self, cid: int, usd: float, reason: str) -> None:
        if self.audit is not None:
            self.audit.record(
                cid,
                "ledger.spend.denied",
                usd=usd,
                spent=self._spent.get(cid, 0.0),
                reason=reason,
            )


def _check_cid(cid: int) -> None:
    if isinstance(cid, bool) or not isinstance(cid, int):
        raise ValueError(f"cid must be an integer, got {type(cid).__name__}")


def _check_bytes(nbytes: int) -> int:
    """A charge is a non-negative integer count of bytes.

    Floats and negatives are refused rather than coerced: a negative charge is
    a credit, and a ledger that accepts credits is a ledger with no ceiling.
    """
    if isinstance(nbytes, bool) or not isinstance(nbytes, int):
        raise ValueError(f"byte count must be an integer, got {type(nbytes).__name__}")
    if nbytes < 0:
        raise ValueError(f"byte count must be non-negative, got {nbytes}")
    return nbytes


def _check_usd(usd: float) -> float:
    """Same rule in dollars, plus a NaN guard — NaN compares false against every cap."""
    if isinstance(usd, bool) or not isinstance(usd, (int, float)):
        raise ValueError(f"spend must be a number, got {type(usd).__name__}")
    value = float(usd)
    if not math.isfinite(value):
        raise ValueError(f"spend must be finite, got {usd!r}")
    if value < 0:
        raise ValueError(f"spend must be non-negative, got {usd!r}")
    return value
