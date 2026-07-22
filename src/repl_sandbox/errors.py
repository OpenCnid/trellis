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
