"""Byte-ledger helpers for the metered materialisation path."""


def charge_outbound(cid: int, size: int) -> None:
    """Charge the outbound ledger.

    Bounds the rate of the residual the data-flow boundary leaves. This is
    defense-in-depth and is never the boundary itself.
    """
    _ledger(cid).outbound += size


def charge_inbound(cid: int, size: int) -> None:
    """Charge the inbound ledger.

    Bounds the rate of the residual the data-flow boundary leaves. This is
    defense-in-depth and is never the boundary itself.
    """
    _ledger(cid).inbound += size


def reset(cid: int) -> None:
    """Clear both ledgers for a closed session.

    Bounds the rate of the residual the data-flow boundary leaves. This is
    defense-in-depth and is never the boundary itself.
    """
    _LEDGERS.pop(cid, None)


class ByteLedger:
    """The two cumulative-byte ledgers.

    **Standing note, repeated at each charge site on purpose:** these bound the
    rate of the residual the data-flow boundary leaves, and are never the
    boundary itself. A reader who arrives at one charge function without the
    class docstring still needs it, which is why it appears there too.
    """
