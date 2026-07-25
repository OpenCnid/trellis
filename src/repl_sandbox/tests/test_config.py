"""The bounds, and the relationships between them that a single edit can break.

Each constant here is defensible on its own and the failure this file exists for
is a *pair* going wrong while both members still look reasonable — which is
exactly how `max_frame_len` (2 MiB) came to sit below `max_result_bytes` (8 MiB),
leaving a maximal legitimate slice unable to cross the wire. Neither number was
absurd; only their relationship was.
"""

from __future__ import annotations

import math

from repl_sandbox.config import (
    BYTES_PER_TOKEN_ESTIMATE,
    DEFAULT_MAX_FRAME_LEN,
    DEFAULT_MAX_RESULT_BYTES,
    MODEL_CONTEXT_WINDOW_TOKENS,
    SLICE_CONTEXT_FRACTION,
    SandboxConfig,
)
from repl_sandbox.hardening import Tier0Limits

#: The margin a frame carries over the slice it must be able to hold. JSON
#: escaping can inflate a payload well past its raw size; this is what pays for
#: that, and CONFORMANCE section 2.3 is where the figure was reasoned to.
FRAME_OVER_SLICE = 2


def test_a_maximal_slice_fits_in_a_frame() -> None:
    """The invariant the July 24 correction installed.

    A `materialize` result is built host-side against `max_result_bytes` and then
    has to cross the wire. If the frame cap is the smaller of the two, a result
    the broker considers legal cannot be delivered — and nothing else in the tree
    compares them, so both stay individually plausible while the path is dead.
    """
    config = SandboxConfig()
    assert config.max_frame_len >= FRAME_OVER_SLICE * config.broker_caps.max_result_bytes


def test_the_frame_bound_is_derived_from_the_slice_bound_not_the_context_window() -> None:
    """Derivation direction, pinned because reversing it is what went wrong.

    The frame bound is a function of the slice bound. It is *not* a function of
    the model's context window: a slice does not enter the model's attention by
    landing in the guest namespace, so a context-derived frame cap protects
    nothing the marshal caps do not already hold, at a far smaller number.
    """
    assert DEFAULT_MAX_FRAME_LEN == FRAME_OVER_SLICE * DEFAULT_MAX_RESULT_BYTES


def test_the_slice_bound_matches_its_recorded_token_derivation() -> None:
    """The sizing convention re-runs from its own recorded inputs.

    A convention rather than an enforcing bound — "about what one model pass
    could consider" is how the number is *chosen*, and `MarshalCaps` is what
    actually keeps content out of the transcript. Recomputed here so a changed
    model pin cannot leave the constant behind, silently.
    """
    derived = MODEL_CONTEXT_WINDOW_TOKENS * SLICE_CONTEXT_FRACTION * BYTES_PER_TOKEN_ESTIMATE
    # 2 MiB is the power-of-two the derivation rounds to; hold it to within one
    # binary order so a re-derivation has to be witting rather than incidental.
    assert 0.5 <= DEFAULT_MAX_RESULT_BYTES / derived <= 2.0


def test_marshal_caps_are_the_thing_that_bounds_the_transcript() -> None:
    """Each attention cap is far below a slice, which is the layering.

    If a marshal cap ever approached the slice bound, content would start
    reaching the model by volume rather than by the model asking for it, and the
    context property really would depend on the transfer bounds.
    """
    config = SandboxConfig()
    slice_bytes = config.broker_caps.max_result_bytes
    for cap in (
        config.marshal_caps.stdout_bytes,
        config.marshal_caps.stderr_bytes,
        config.marshal_caps.answer_bytes,
    ):
        assert cap * 8 <= slice_bytes


def test_the_namespace_ceiling_is_the_rlimit_and_dwarfs_a_slice() -> None:
    """What actually bounds a large REPL, stated where the caps live.

    The corpus ceiling is address space, not any wire or slice number. Holding
    the ratio here keeps the "REPL is gigabytes, read in slices" property from
    being quietly inverted by raising a slice toward the namespace size.
    """
    limits = Tier0Limits()
    assert limits.address_space_bytes >= 64 * DEFAULT_MAX_RESULT_BYTES
    # A GiB namespace filled 2 MiB at a time: the round-trip cost is real and is
    # the reason `max_result_bytes` is the lever to move for bulk transfer.
    assert math.ceil(limits.address_space_bytes / DEFAULT_MAX_RESULT_BYTES) == 512


def test_the_inbound_literal_cap_stays_under_a_frame() -> None:
    """`load_context` literals ride a frame too, so they cannot exceed one."""
    config = SandboxConfig()
    assert config.byte_caps.inbound_per_call <= config.max_frame_len


def test_the_guest_image_pin_tracks_the_provisioner() -> None:
    """The provisioner holds the authority; this module holds a copy.

    `scripts/provision_kata_host.sh` is what actually pulls and verifies the
    image, so its two constants are the real pin. Python needs them because a
    launcher owning a containerd namespace necessarily owns the pull -- image
    stores are per-namespace, and `ctr -n <ns> run` against a namespace that
    has not pulled reports the image as not found.

    Two copies of one pin is the drift shape S6-entry found in the reserved
    names, so the copies are asserted against each other rather than each
    against its own literal: a bump in the script reddens here first.
    """
    import pathlib
    import re

    from repl_sandbox.config import GUEST_IMAGE, GUEST_IMAGE_DIGEST

    script = pathlib.Path(__file__).resolve().parents[3] / "scripts" / "provision_kata_host.sh"
    text = script.read_text(encoding="utf-8")

    image = re.search(r'^GUEST_IMAGE="([^"]+)"', text, re.MULTILINE)
    digest = re.search(r'^GUEST_IMAGE_DIGEST="([^"]+)"', text, re.MULTILINE)

    # A pattern that stopped matching would make this test vacuously green,
    # which is the one failure a copy-vs-copy check cannot afford.
    assert image is not None, f"no GUEST_IMAGE assignment found in {script}"
    assert digest is not None, f"no GUEST_IMAGE_DIGEST assignment found in {script}"

    assert GUEST_IMAGE == image.group(1)
    assert GUEST_IMAGE_DIGEST == digest.group(1)
