"""The error taxonomy shared by every seam.

Source of truth: docs/product/repl-sandbox/REPL_SANDBOX_INTERFACES.md
section 7 (Error model). The `code` strings are stable across seams and are what
the broker envelope's `error.code` field and the audit log carry.

Two properties beyond the message matter to callers:

* `retryable` — whether the caller may reasonably try again.
* terminality — `cap_spend` halts the session; `auth` and `frame` drop the
  connection. Neither is offered back to the model as a recoverable error.
  Everything else surfaces to the in-guest stub as a Python exception, which
  lands in `REPLResult.stderr` and feeds the model's self-debug loop.

Those three class attributes partition the taxonomy, so a prompt-facing account
of what a refusal means is derivable rather than authorable: `retry_phrase`
reads them and composes the sentence, and the module that decides retryability
is the module that says so.
"""

from __future__ import annotations


class SandboxError(Exception):
    """Base for every error that crosses a sandbox seam.

    Subclasses fix `code`; instances carry the message and (where the taxonomy
    allows a per-instance answer) the retryable flag.
    """

    code: str = "upstream"
    retryable: bool = False
    #: The connection is dropped after this error; nothing further is read.
    connection_terminal: bool = False
    #: The whole session halts after this error.
    session_terminal: bool = False

    def __init__(self, message: str = "", *, retryable: bool | None = None):
        super().__init__(message or self.code)
        self.message = message or self.code
        if retryable is not None:
            self.retryable = retryable

    def to_error_object(self) -> dict:
        """The `error` member of the broker `v1` response envelope."""
        return {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
        }


class AuthError(SandboxError):
    """Unknown or mismatched vsock peer CID. Audited by attempted CID."""

    code = "auth"
    retryable = False
    connection_terminal = True


class FrameError(SandboxError):
    """Oversized, malformed, partial, or non-UTF-8 frame.

    Raised by the frame reader *before* any allocation sized by the declared
    length. Fail-closed: the connection is dropped and the event audited.
    """

    code = "frame"
    retryable = False
    connection_terminal = True


class CapConcurrencyError(SandboxError):
    """Per-session in-flight concurrency ceiling reached."""

    code = "cap_concurrency"
    retryable = True


class CapRateError(SandboxError):
    """Per-session request-rate ceiling reached; retry after the bucket refills."""

    code = "cap_rate"
    retryable = True

    def __init__(self, message: str = "", *, retry_after_s: float | None = None):
        super().__init__(message)
        self.retry_after_s = retry_after_s

    def to_error_object(self) -> dict:
        obj = super().to_error_object()
        if self.retry_after_s is not None:
            obj["retry_after_s"] = self.retry_after_s
        return obj


class CapSpendError(SandboxError):
    """Dollar-denominated session ledger exhausted. Hard stop, not recoverable."""

    code = "cap_spend"
    retryable = False
    session_terminal = True


class CapBytesError(SandboxError):
    """A cumulative byte ledger (inbound materialisation or outbound egress) is spent.

    The ledgers bound the *rate* of the narrow residual crossing; they are not
    the boundary (see DATA_MODEL section 6).
    """

    code = "cap_bytes"
    retryable = False


class DepthCeilingError(SandboxError):
    """`LMRequest.depth` above the host-derived ceiling (pinned at 1)."""

    code = "depth_ceiling"
    retryable = False


class DeniedError(SandboxError):
    """Denied tool, statement, APOC procedure, or unbounded variable-length path."""

    code = "denied"
    retryable = False


class TimeoutError_(SandboxError):
    """Statement, Bolt, or exec-deadline timeout. Sometimes retryable."""

    code = "timeout"
    retryable = False


class UpstreamError(SandboxError):
    """Provider or database error, passed through."""

    code = "upstream"
    retryable = False


#: Every code in the taxonomy, in the order INTERFACES section 7 tabulates them.
ERROR_CODES: tuple[str, ...] = (
    "auth",
    "frame",
    "cap_concurrency",
    "cap_rate",
    "cap_spend",
    "cap_bytes",
    "depth_ceiling",
    "denied",
    "timeout",
    "upstream",
)

ERROR_CLASSES: dict[str, type[SandboxError]] = {
    "auth": AuthError,
    "frame": FrameError,
    "cap_concurrency": CapConcurrencyError,
    "cap_rate": CapRateError,
    "cap_spend": CapSpendError,
    "cap_bytes": CapBytesError,
    "depth_ceiling": DepthCeilingError,
    "denied": DeniedError,
    "timeout": TimeoutError_,
    "upstream": UpstreamError,
}


#: The four consequences the three class attributes above partition the taxonomy
#: into, as the clause a prompt-facing account states. Keyed by
#: `(retryable, connection_terminal, session_terminal)`, so the sentence a code
#: gets is decided by that code's own attributes and by nothing written here per
#: code. Flip `CapRateError.retryable` and the sentence for `cap_rate` flips with
#: it; add a class with a new combination and this lookup raises rather than
#: inventing a clause for it.
_RETRY_CLAUSE: dict[tuple[bool, bool, bool], str] = {
    (True, False, False): "may be retried once the condition it names clears",
    (False, False, False): "is not retryable; the session continues",
    (False, False, True): "is not retryable and halts the session",
    (False, True, False): "is not retryable and drops the connection",
}


def retry_phrase(code: str) -> str:
    """One prompt-facing sentence about `code`, read off its class attributes.

    This is the derivation `SELF_DESCRIBING_SURFACES.md` section 3.3 asks for
    applied to the error taxonomy: the module that decides whether a caller may
    try again is the module that says so, so a rendered account cannot drift
    from the flag the caller is actually handed. `to_error_object` puts
    `retryable` on the wire from the same attribute this reads.

    Unknown codes are refused rather than described, because a code outside
    `ERROR_CLASSES` has no attributes to read and a guessed clause is exactly
    the authored prose this replaces.
    """
    cls = ERROR_CLASSES.get(code)
    if cls is None:
        raise KeyError(f"{code!r} is not in the error taxonomy; the set is {ERROR_CODES}")
    key = (bool(cls.retryable), bool(cls.connection_terminal), bool(cls.session_terminal))
    clause = _RETRY_CLAUSE.get(key)
    if clause is None:  # pragma: no cover - a new combination is a taxonomy change
        raise KeyError(
            f"{code!r} carries the combination {key}, which has no clause; add one "
            "beside the class that introduced it"
        )
    return f"{code} {clause}"


def error_from_object(obj: dict) -> SandboxError:
    """Rebuild an error from a broker `v1` `error` object.

    Used guest-side by the proxy stubs so a host decision surfaces to model code
    as a Python exception with the same code the host audited.
    """
    code = obj.get("code", "upstream")
    cls = ERROR_CLASSES.get(code, UpstreamError)
    err = cls(obj.get("message", code))
    retryable = obj.get("retryable")
    if isinstance(retryable, bool):
        err.retryable = retryable
    return err
