"""Trellis REPL sandbox — the host-side control plane for the Kata microVM boundary.

Design records: docs/product/repl-sandbox/. The ratified boundary is a Kata
Containers microVM on Cloud Hypervisor; this package is the host-side and
guest-side software that runs on either side of it, plus the wire between them.

What is in this package is transport-agnostic on purpose: every seam speaks the
4-byte-big-endian-length + UTF-8-JSON frame of `frame.py` over an abstract
transport, so the control plane is buildable and testable without `/dev/kvm`.
The microVM is the boundary; nothing in this package is. A loopback transport
used in tests is a test double and never a security surface.
"""

from repl_sandbox.errors import (
    AuthError,
    CapBytesError,
    CapConcurrencyError,
    CapRateError,
    CapSpendError,
    DeniedError,
    DepthCeilingError,
    FrameError,
    SandboxError,
    TimeoutError_,
    UpstreamError,
)
from repl_sandbox.frame import encode_frame, read_frame, recv_exactly

__all__ = [
    "AuthError",
    "CapBytesError",
    "CapConcurrencyError",
    "CapRateError",
    "CapSpendError",
    "DeniedError",
    "DepthCeilingError",
    "FrameError",
    "SandboxError",
    "TimeoutError_",
    "UpstreamError",
    "encode_frame",
    "read_frame",
    "recv_exactly",
]
