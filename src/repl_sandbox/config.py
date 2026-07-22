"""Configuration, version pins, and the host-enforced ceilings.

Source of truth for the values: docs/product/repl-sandbox/REPL_SANDBOX_SPEC.md
section 5 (Configuration) and section 6 (Security invariants);
REPL_SANDBOX_INTERFACES.md section 4 (LM-handler RPC surface) for the cap set.

Two upstreams, two version schemes, two advisory feeds: Kata >= 3.31.0 AND
Cloud Hypervisor >= 52.0. They are never one pin.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# Version pins (ARCHITECTURE section 7, requirement 3)
# ---------------------------------------------------------------------------

KATA_MIN_VERSION = "3.31.0"
CLOUD_HYPERVISOR_MIN_VERSION = "52.0"

_VERSION_RE = re.compile(r"(\d+(?:\.\d+)*)")


def parse_version(raw: str) -> tuple[int, ...]:
    """Extract a dotted numeric version from a tool's `--version` output.

    Accepts the noise real binaries emit (`kata-runtime  : 3.31.0`,
    `cloud-hypervisor v52.0.0`) and returns the numeric tuple.
    """
    match = _VERSION_RE.search(raw or "")
    if match is None:
        raise ValueError(f"no version number found in {raw!r}")
    return tuple(int(part) for part in match.group(1).split("."))


def version_at_least(observed: str, minimum: str) -> bool:
    """True when `observed` is at or above `minimum`, compared component-wise."""
    got = parse_version(observed)
    want = parse_version(minimum)
    width = max(len(got), len(want))
    got += (0,) * (width - len(got))
    want += (0,) * (width - len(want))
    return got >= want


# ---------------------------------------------------------------------------
# Frame bound
# ---------------------------------------------------------------------------

#: Hard cap on the declared length of a single wire frame.
#:
#: Derivation rule proposed by the collaborator (Matt) July 22, 2026, with the
#: window he supplied; **the shipped value is still owner-gated** per INTERFACES
#: section 9 item 3, which requires a ratified number before the bridge ships.
#: Nothing ships yet (G1 is unmet), so this is the derived default, not the
#: ratification.
#:
#: The rule: size the cap off the worker's context window, not off the largest
#: frame the plumbing might carry. That converts it from a DoS bound into a
#: structural guarantee — **no single frame can context-saturate the worker it
#: lands in.**
#:
#: Derivation: `gpt-5.4-2026-03-05` carries 1,050,000 tokens; half of that is
#: 525,000; at ~4 bytes per token that is ~2.1 MB, which is 2 MiB. Re-derive this
#: constant whenever the model pin changes — the window is the input, and it is
#: recorded here because it exists nowhere else in the repo.
#:
#: The DoS property still holds and is why the reader checks the declared length
#: *before* allocating: the 4-byte prefix admits 4 GiB and a hostile guest will
#: send it. This bound sits above `ByteLedgerCaps.inbound_per_call`, so the two
#: stack rather than contradict, and the handle model keeps the historically
#: largest frame (a context load) small by carrying tokens instead of payloads.
DEFAULT_MAX_FRAME_LEN = 2 * 1024 * 1024

#: The context window the frame cap is derived from, in tokens. Recorded so the
#: derivation above can be re-run rather than re-guessed.
MODEL_CONTEXT_WINDOW_TOKENS = 1_050_000
#: Fraction of the window one frame may occupy.
FRAME_CONTEXT_FRACTION = 0.5
#: Bytes per token used to convert the token budget into a byte bound.
BYTES_PER_TOKEN_ESTIMATE = 4


@dataclass(frozen=True)
class VsockPorts:
    """The three vsock ports of INTERFACES section 1 (Seam map).

    On `lm` and `db` the host listens and the guest connects, so the host reads
    the guest CID from `accept()`. On `control` the guest supervisor listens and
    only the host CID (2) is accepted.
    """

    lm: int = 5001
    db: int = 5002
    control: int = 5003


#: `VMADDR_CID_HOST` — the well-known host CID in the vsock address family.
VMADDR_CID_HOST = 2


@dataclass(frozen=True)
class LMCaps:
    """Per-session, CID-keyed ceilings the LM handler enforces host-side.

    rlms' own `max_concurrent_subcalls` and `batch_max_concurrent` are soft
    bookkeeping that model code bypasses with `import threading`; these are the
    real ceilings.
    """

    max_in_flight: int = 4
    requests_per_second: float = 4.0
    #: Dollar-denominated hard stop. House rule: paid runs are capped at $5.
    spend_usd: float = 5.0
    #: Host-derived ceiling on `LMRequest.depth`; flat fan-out only.
    depth_ceiling: int = 1


@dataclass(frozen=True)
class ByteLedgerCaps:
    """The two cumulative-byte ledgers of DATA_MODEL section 6.

    These bound the *rate* of the narrow residual materialisation channel. They
    are defense-in-depth on the residual and are never the boundary — the
    boundary is that the corpus is never materialised in the guest at all.
    """

    #: Host content crossing into the guest, cumulative per session.
    inbound_total: int = 4 * 1024 * 1024
    #: Largest single `materialize` / `slice` return.
    inbound_per_call: int = 256 * 1024
    #: Guest-controlled content crossing outward, cumulative per session.
    outbound_total: int = 4 * 1024 * 1024
    #: Largest single outbound prompt.
    outbound_per_call: int = 256 * 1024


@dataclass(frozen=True)
class BrokerCaps:
    """Query governor settings for the host DB broker (INTERFACES section 5)."""

    statement_timeout_ms: int = 15_000
    bolt_timeout_ms: int = 15_000
    max_rows: int = 10_000
    max_result_bytes: int = 8 * 1024 * 1024


@dataclass(frozen=True)
class MarshalCaps:
    """Output shaping on the marshaling seam.

    NOT a boundary (SPEC section 6, the "NOT a boundary" row) — DoS and output
    shaping only. Printed content was already materialised and charged at its
    sink.
    """

    stdout_bytes: int = 20 * 1024
    stderr_bytes: int = 20 * 1024
    answer_bytes: int = 64 * 1024


@dataclass(frozen=True)
class SandboxConfig:
    """The whole configuration surface, one object.

    Instantiated host-side by the trusted driver and never read from the guest.
    """

    kata_min_version: str = KATA_MIN_VERSION
    cloud_hypervisor_min_version: str = CLOUD_HYPERVISOR_MIN_VERSION
    max_frame_len: int = DEFAULT_MAX_FRAME_LEN
    ports: VsockPorts = field(default_factory=VsockPorts)
    lm_caps: LMCaps = field(default_factory=LMCaps)
    byte_caps: ByteLedgerCaps = field(default_factory=ByteLedgerCaps)
    broker_caps: BrokerCaps = field(default_factory=BrokerCaps)
    marshal_caps: MarshalCaps = field(default_factory=MarshalCaps)
    #: Handle TTL in seconds; handles are session-scoped for reads.
    handle_ttl_s: float = 3600.0

    def check_versions(self, kata_version: str, cloud_hypervisor_version: str) -> list[str]:
        """Return one failure string per pin that is not met; empty means PASS.

        The enforcing surface for ARCHITECTURE section 7 requirement 3. Both
        pins are checked separately because they are separate upstreams.
        """
        failures: list[str] = []
        if not version_at_least(kata_version, self.kata_min_version):
            failures.append(
                f"kata {kata_version} is below the pin {self.kata_min_version}"
            )
        if not version_at_least(cloud_hypervisor_version, self.cloud_hypervisor_min_version):
            failures.append(
                "cloud-hypervisor "
                f"{cloud_hypervisor_version} is below the pin "
                f"{self.cloud_hypervisor_min_version}"
            )
        return failures
