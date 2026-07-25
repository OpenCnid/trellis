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
# Slice bound, and the frame bound that follows it
# ---------------------------------------------------------------------------
#
# Four different things get bounded in this system and they are easy to collapse
# into one number. Keeping them apart is the point of this block:
#
#   the corpus         what the model reasons over       *nothing here* — host-side, behind handles
#   the working set    what it holds in the namespace    `Tier0Limits.address_space_bytes`
#   one materialisation host store -> guest namespace    `BrokerCaps.max_result_bytes`
#   model attention    what reaches the transcript       `MarshalCaps` (this file)
#   one wire message   a single frame                    `DEFAULT_MAX_FRAME_LEN`
#
# **The corpus is bounded by nothing in this file, because it never enters the
# guest.** Address space bounds the working set — what the model materialised and
# is computing over — and nothing else. A 12 MiB value in the namespace returns a
# ~4 KB exec reply, because the marshalling caps describe it rather than carry it.

#: The context window a slice is sized against, in tokens. Recorded so the
#: derivation below can be re-run rather than re-guessed.
MODEL_CONTEXT_WINDOW_TOKENS = 1_050_000
#: Fraction of the window one slice may occupy.
SLICE_CONTEXT_FRACTION = 0.5
#: Bytes per token used to convert the token budget into a byte bound.
BYTES_PER_TOKEN_ESTIMATE = 4

#: Largest single `materialize` / `slice` return: one unit of content moving from
#: the host store into the guest namespace.
#:
#: Derivation rule proposed by the collaborator (Matt) July 22, 2026 with the
#: window he supplied, and **re-homed onto this constant July 24, 2026** after it
#: was found applied to the frame bound instead. `gpt-5.4-2026-03-05` carries
#: 1,050,000 tokens; half is 525,000; at ~4 bytes per token that is ~2.1 MB, so
#: 2 MiB. Re-derive whenever the model pin changes.
#:
#: **Read this as a sizing convention, not an enforcing bound** — the distinction
#: the July 24 correction turned on. A slice does not reach the model's attention
#: by landing in the namespace; `MarshalCaps` holds that, independently and at a
#: far smaller number. So "about what one model pass could consider" is a sound
#: way to *choose* this value and is not a property it *enforces*. Writing it here
#: as though it protected the context would repeat, one layer over, the error that
#: produced the correction.
#:
#: **This is not a bulk-transfer bound, because there is no bulk transfer.** The
#: worker does not move a corpus through itself; it answers questions *about* one
#: by reading slices and composing a derived response artifact over several turns.
#: `materialize` is the exception path — DATA_MODEL section 6, whose title is
#: *The bounded materialisation exception*: *prefer by-reference sinks;
#: `materialize` is only for when the model itself must compute over the bytes.*
#: A gigabyte reaching an answer was meant to go `answer.submit(H)`, resolved
#: host-side and leaving by the audited egress — **an op that does not exist.**
#: `trellis_answer.submit` takes an expression string and renders a value; there
#: is no handle argument. Recorded because two records route bulk through it, and
#: an unbuilt escape hatch reads exactly like a built one.
#:
#: So the number to size against is **one computation's working set**, not a
#: corpus divided by anything. Arithmetic of the form "a corpus takes N calls at
#: this size" is the tell that the model is being treated as the transport, which
#: it never is (`docs/architecture/CODE_MEDIATED_TEXT.md` — the model never counts
#: and never copies, so bulk movement is the engine's job).
#: `DEFAULT_MAX_FRAME_LEN` follows this constant and must be re-derived with it.
DEFAULT_MAX_RESULT_BYTES = 2 * 1024 * 1024

#: Hard cap on the declared length of a single wire frame. **Derived from the
#: slice bound, never from the context window** (July 24, 2026 — owner ruling).
#:
#: The largest legitimate frame is a slice plus its envelope, so the frame cap is
#: the slice times a margin. JSON escaping can inflate a payload well past its raw
#: size, which is what the margin buys; 2x is the figure CONFORMANCE section 2.3
#: reasoned to and it is kept.
#:
#: The history is worth carrying, because the shape recurs: this constant was
#: briefly derived from the model context window on the theory that no single
#: frame should context-saturate its worker. That protects nothing the marshal
#: caps do not already hold, and it left the shipped frame cap (2 MiB) *below*
#: `max_result_bytes` (8 MiB) — so a maximal legitimate result could not cross the
#: wire at all. The invariant that forecloses it is asserted in
#: `tests/test_config.py`: **`max_frame_len >= 2 * max_result_bytes`.**
#:
#: The DoS property is independent of the number and always held: `frame.read_frame`
#: compares the declared length to this bound *before* reading a body, so a frame
#: declaring 4 GiB is refused for the cost of four bytes and a hostile peer must
#: actually send whatever it claims.
DEFAULT_MAX_FRAME_LEN = 2 * DEFAULT_MAX_RESULT_BYTES


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


#: The containerd runtime handler that routes a container to a Kata microVM.
#: Anything else on this field is a container, not a boundary.
KATA_RUNTIME_HANDLER = "io.containerd.kata.v2"

#: The guest image, pinned by digest rather than by tag: `python:3.12-slim` is
#: mutable, and the recorded spike runs are only reproducible against this
#: manifest. Both values are `scripts/provision_kata_host.sh`'s — that script
#: pulls and verifies them, so it holds the authority and these are the copy.
#: `test_config.py` asserts the two agree, so a bump there reddens here first.
GUEST_IMAGE = "docker.io/library/python:3.12-slim"
GUEST_IMAGE_DIGEST = "sha256:57cd7c3a7a273101a6485ba99423ee568157882804b1124b4dd04266317710de"

#: The containerd namespace a launcher works in.
#:
#: **Not `default`, and the reason is rule 19(a) rather than tidiness.** A
#: destructive step is confirmed over its whole reach before it runs, and a
#: launcher sharing `default` with the provisioner and every past probe cannot
#: say "everything under this path is mine" about anything it is about to
#: remove. The namespace is also literally in the leaked-cgroup path — Kata's
#: cgroup driver builds `/sys/fs/cgroup/<namespace>/kata_<id>` — so moving off
#: `default` is what makes that sweep bounded.
#:
#: **Measured consequence, 2026-07-25:** containerd image stores are
#: per-namespace. `ctr -n <ns> run` against a namespace that has not pulled the
#: image fails with `image "...": not found`, so a launcher owning a namespace
#: necessarily owns the pull, which is why the digest above lives here at all.
CTR_NAMESPACE = "trellis"


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
    #: One slice, host store -> guest namespace. See `DEFAULT_MAX_RESULT_BYTES`
    #: for the derivation and for why it is a sizing convention rather than a
    #: bound on the model's attention.
    max_result_bytes: int = DEFAULT_MAX_RESULT_BYTES


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
