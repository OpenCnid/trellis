"""Tests for the host LM handler.

Refusals first: every cap in REPL_SANDBOX_INTERFACES.md section 4 (LM-handler RPC
surface) is exercised on the path that denies, because a cap that has only ever
been tested on the allowing path is a comment.

The session table, audit log, and two ledgers are **test doubles** standing in
for the sibling modules `repl_sandbox.session`, `repl_sandbox.audit`, and
`repl_sandbox.ledger`, written to the signatures those modules expose. They are
doubles, not implementations, and they are not a security surface.

The provider is a fake throughout. Nothing here makes a network call, reads a
real key, or spends money — `openai_chat_provider_from_env()` is never called.
"""

from __future__ import annotations

import json
import threading
from dataclasses import replace

import pytest
from rlm.core.comms_utils import LMRequest, LMResponse
from rlm.core.types import ModelUsageSummary, RLMChatCompletion, UsageSummary

from repl_sandbox.config import ByteLedgerCaps, LMCaps, SandboxConfig
from repl_sandbox.dlp import DlpHook
from repl_sandbox.errors import (
    AuthError,
    CapBytesError,
    CapSpendError,
    TimeoutError_,
    UpstreamError,
)
from repl_sandbox.handles import HandleTable
from repl_sandbox.lm_handler import (
    CONTEXT_CLOSE,
    CONTEXT_OPEN,
    MAX_CONTEXT_HANDLES,
    LMHandler,
    context_block,
    error_code_of,
    prompt_bytes,
    prompt_digest,
    render_referent,
    splice_context,
)

# A provider key shape that the default DLP rule set recognises. It is fake and
# is never sent anywhere; it exists so the "no key in the guest" test has a
# needle to grep for.
FAKE_KEY = "sk-live-4Xq7ZbT2mN8pR1sV6wY0aC3dE5fG7hJ9kL"

GUEST_CID = 42
OTHER_CID = 43


# ---------------------------------------------------------------------------
# Test doubles for the sibling modules
# ---------------------------------------------------------------------------


class FakeSessionTable:
    """Double for `repl_sandbox.session.SessionTable`."""

    def __init__(self, cids=(GUEST_CID,)):
        self._cids = set(cids)

    def session_for(self, cid: int):
        if cid not in self._cids:
            raise AuthError(f"unknown peer cid {cid}")
        return {"cid": cid}


class FakeAudit:
    """Double for `repl_sandbox.audit.AuditLog`."""

    def __init__(self):
        self.records: list[tuple[int, str, dict]] = []

    def record(self, cid: int, op: str, **fields) -> None:
        self.records.append((cid, op, fields))

    def ops(self) -> list[str]:
        return [op for _, op, _ in self.records]

    def dump(self) -> str:
        return repr(self.records)


class FakeSpendLedger:
    """Double for `repl_sandbox.ledger.SpendLedger`.

    Hard-stops the way a real ledger must: once the recorded spend has reached
    the cap, every further charge — including the zero-dollar pre-flight check —
    raises.
    """

    def __init__(self, cap_usd: float):
        self.cap = cap_usd
        self.spent: dict[int, float] = {}

    def charge(self, cid: int, usd: float) -> None:
        current = self.spent.get(cid, 0.0)
        if current >= self.cap:
            raise CapSpendError(f"session spend {current:.4f} has reached the cap {self.cap:.4f}")
        self.spent[cid] = current + usd


class FakeByteLedger:
    """Double for `repl_sandbox.ledger.ByteLedger` (cumulative ceilings only)."""

    def __init__(self, outbound_total: int = 10**9, inbound_total: int = 10**9):
        self.outbound_cap = outbound_total
        self.inbound_cap = inbound_total
        self.outbound: dict[int, int] = {}
        self.inbound: dict[int, int] = {}

    def charge_outbound(self, cid: int, nbytes: int) -> None:
        total = self.outbound.get(cid, 0) + nbytes
        if total > self.outbound_cap:
            raise CapBytesError(f"outbound total {total} exceeds {self.outbound_cap}")
        self.outbound[cid] = total

    def charge_inbound(self, cid: int, nbytes: int) -> None:
        total = self.inbound.get(cid, 0) + nbytes
        if total > self.inbound_cap:
            raise CapBytesError(f"inbound total {total} exceeds {self.inbound_cap}")
        self.inbound[cid] = total


def make_completion(prompt, response: str, model: str = "fake-model") -> dict:
    """A completion in rlms' own on-wire shape, built by rlms' own dataclass."""
    return RLMChatCompletion(
        root_model=model,
        prompt=prompt,
        response=response,
        usage_summary=UsageSummary(
            model_usage_summaries={
                model: ModelUsageSummary(
                    total_calls=1, total_input_tokens=7, total_output_tokens=11
                )
            }
        ),
        execution_time=0.01,
    ).to_dict()


class FakeProvider:
    """A `Provider` that holds a key privately and never emits it."""

    def __init__(self, response: str = "ok", usd: float = 0.0, raises: Exception | None = None):
        self._key = FAKE_KEY  # never read by the handler, never returned
        self._response = response
        self._usd = usd
        self._raises = raises
        self.calls: list[tuple] = []
        self.seen_prompts: list = []

    def complete(self, prompt, model):
        self.calls.append(("complete", prompt, model))
        self.seen_prompts.append(prompt)
        if self._raises is not None:
            raise self._raises
        return make_completion(prompt, self._response), self._usd

    def complete_batched(self, prompts, model):
        self.calls.append(("complete_batched", tuple(prompts), model))
        self.seen_prompts.extend(prompts)
        if self._raises is not None:
            raise self._raises
        return [make_completion(p, self._response) for p in prompts], self._usd


class BlockingProvider:
    """Holds every call open until released — for the concurrency test."""

    def __init__(self):
        self.release = threading.Event()
        self.entered = threading.Semaphore(0)

    def complete(self, prompt, model):
        self.entered.release()
        assert self.release.wait(timeout=10), "provider was never released"
        return make_completion(prompt, "ok"), 0.0

    def complete_batched(self, prompts, model):
        raise AssertionError("not used")


class FakeClock:
    """A monotonic clock the test moves by hand."""

    def __init__(self, start: float = 1000.0):
        self.t = start

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------


def make_config(**caps) -> SandboxConfig:
    lm_fields = {k: v for k, v in caps.items() if k in LMCaps.__dataclass_fields__}
    byte_fields = {k: v for k, v in caps.items() if k in ByteLedgerCaps.__dataclass_fields__}
    unknown = set(caps) - set(lm_fields) - set(byte_fields)
    assert not unknown, f"unknown cap override: {unknown}"
    base = SandboxConfig()
    return replace(
        base,
        lm_caps=replace(base.lm_caps, **lm_fields),
        byte_caps=replace(base.byte_caps, **byte_fields),
    )


def make_handler(
    provider=None,
    *,
    config: SandboxConfig | None = None,
    dlp: DlpHook | None = None,
    spend_cap: float = 5.0,
    byte_ledger: FakeByteLedger | None = None,
    clock: FakeClock | None = None,
    cids=(GUEST_CID,),
    handles: HandleTable | None = None,
):
    provider = provider if provider is not None else FakeProvider()
    # Unless a test is about the rate cap, the bucket is opened wide so the
    # cap under test is the only one that can fire.
    config = config if config is not None else make_config(requests_per_second=1000.0)
    audit = FakeAudit()
    spend = FakeSpendLedger(spend_cap)
    byte_ledger = byte_ledger if byte_ledger is not None else FakeByteLedger()
    clock = clock or FakeClock()
    handler = LMHandler(
        config=config,
        sessions=FakeSessionTable(cids),
        spend_ledger=spend,
        byte_ledger=byte_ledger,
        audit=audit,
        provider=provider,
        dlp=dlp,
        handles=handles,
        now=clock,
    )
    return handler, provider, audit, spend, byte_ledger, clock


def single_request(prompt="hello", model="fake-model", depth=0) -> dict:
    return LMRequest(prompt=prompt, model=model, depth=depth).to_dict()


def batched_request(prompts, model="fake-model", depth=0) -> dict:
    return LMRequest(prompts=list(prompts), model=model, depth=depth).to_dict()


# ---------------------------------------------------------------------------
# Refusals
# ---------------------------------------------------------------------------


def test_unknown_cid_raises_auth_and_is_audited_by_attempted_cid():
    """An unidentified peer gets no answer at all — the connection is dropped."""
    handler, provider, audit, *_ = make_handler()
    with pytest.raises(AuthError):
        handler.handle_request(OTHER_CID, single_request())
    assert provider.calls == []
    assert audit.records == [(OTHER_CID, "lm_auth_denied", {"code": "auth", "attempted_cid": OTHER_CID})]


def test_identity_is_never_read_from_the_request_body():
    """A forged session id in the body does not move the request's identity."""
    handler, provider, audit, *_ = make_handler(cids=(GUEST_CID,))
    body = single_request()
    body["cid"] = OTHER_CID
    body["session_id"] = "someone-elses-session"
    with pytest.raises(AuthError):
        handler.handle_request(OTHER_CID, body)
    # And the legitimate CID is served regardless of what the body claims.
    resp = handler.handle_request(GUEST_CID, body)
    assert error_code_of(resp) is None
    assert audit.records[-1][0] == GUEST_CID


def test_depth_of_two_is_refused_by_the_host_derived_ceiling():
    handler, provider, audit, *_ = make_handler()
    resp = handler.handle_request(GUEST_CID, single_request(depth=2))
    assert error_code_of(resp) == "depth_ceiling"
    assert resp["chat_completion"] is None and resp["chat_completions"] is None
    assert provider.calls == []
    assert "lm_refused" in audit.ops()


def test_depth_at_the_ceiling_is_allowed():
    handler, provider, *_ = make_handler()
    resp = handler.handle_request(GUEST_CID, single_request(depth=1))
    assert error_code_of(resp) is None
    assert len(provider.calls) == 1


def test_negative_and_non_integer_depth_are_refused():
    handler, provider, *_ = make_handler()
    assert error_code_of(handler.handle_request(GUEST_CID, single_request(depth=-1))) == (
        "depth_ceiling"
    )
    body = single_request()
    body["depth"] = "0"
    from repl_sandbox.errors import FrameError

    with pytest.raises(FrameError):
        handler.handle_request(GUEST_CID, body)
    assert provider.calls == []


def test_concurrency_burst_is_capped_under_real_threads():
    """Four slots, four blocked calls, and the fifth is refused."""
    provider = BlockingProvider()
    config = make_config(max_in_flight=4, requests_per_second=1000.0)
    handler, _, audit, *_ = make_handler(provider, config=config)

    results: list[dict] = []
    threads = [
        threading.Thread(target=lambda: results.append(handler.handle_request(GUEST_CID, single_request())))
        for _ in range(4)
    ]
    for thread in threads:
        thread.start()
    try:
        for _ in range(4):
            assert provider.entered.acquire(timeout=10), "provider never reached"
        # All four slots are held; the next two callers must be refused.
        refused = [handler.handle_request(GUEST_CID, single_request()) for _ in range(2)]
        assert [error_code_of(r) for r in refused] == ["cap_concurrency", "cap_concurrency"]
    finally:
        provider.release.set()
        for thread in threads:
            thread.join(timeout=10)

    assert len(results) == 4
    assert all(error_code_of(r) is None for r in results)
    # Slots are returned, so the session is usable again.
    assert error_code_of(handler.handle_request(GUEST_CID, single_request())) is None


def test_batch_width_is_bounded_by_the_same_ceiling():
    """rlms' `batch_max_concurrent` bounds one call's thread pool, not the fan-out."""
    config = make_config(max_in_flight=2, requests_per_second=1000.0)
    handler, provider, *_ = make_handler(config=config)
    resp = handler.handle_request(GUEST_CID, batched_request(["a", "b", "c"]))
    assert error_code_of(resp) == "cap_concurrency"
    assert provider.calls == []


def test_rate_burst_is_refused_with_a_retry_after():
    clock = FakeClock()
    config = make_config(requests_per_second=2.0)
    handler, provider, audit, *_ = make_handler(config=config, clock=clock)

    # Bucket capacity is the per-second rate: two through, then refusal.
    assert error_code_of(handler.handle_request(GUEST_CID, single_request())) is None
    assert error_code_of(handler.handle_request(GUEST_CID, single_request())) is None
    refused = handler.handle_request(GUEST_CID, single_request())
    assert error_code_of(refused) == "cap_rate"
    assert "retry_after_s=" in refused["error"]
    retry_after = float(refused["error"].split("retry_after_s=")[1])
    assert 0.0 < retry_after <= 0.5
    assert len(provider.calls) == 2

    # The bucket refills on the injected clock; no test sleeps.
    clock.advance(retry_after)
    assert error_code_of(handler.handle_request(GUEST_CID, single_request())) is None


def test_a_zero_rate_is_a_closed_gate():
    handler, provider, *_ = make_handler(config=make_config(requests_per_second=0.0))
    assert error_code_of(handler.handle_request(GUEST_CID, single_request())) == "cap_rate"
    assert provider.calls == []


def test_spend_exhaustion_returns_cap_spend_and_halts_the_session():
    handler, provider, audit, spend, *_ = make_handler(
        FakeProvider(usd=0.02), spend_cap=0.01
    )
    first = handler.handle_request(GUEST_CID, single_request())
    assert error_code_of(first) is None
    assert spend.spent[GUEST_CID] == pytest.approx(0.02)

    second = handler.handle_request(GUEST_CID, single_request())
    assert error_code_of(second) == "cap_spend"
    assert handler.is_halted(GUEST_CID)
    assert "lm_session_halted" in audit.ops()

    # Terminal means terminal: no further request is served, and the provider
    # is not reached again.
    calls_at_halt = len(provider.calls)
    third = handler.handle_request(GUEST_CID, single_request())
    assert error_code_of(third) == "cap_spend"
    assert len(provider.calls) == calls_at_halt
    assert CapSpendError.session_terminal is True


def test_over_cap_prompt_is_refused_before_the_provider():
    config = make_config(outbound_per_call=64, requests_per_second=1000.0)
    handler, provider, audit, _, byte_ledger, _ = make_handler(config=config)
    resp = handler.handle_request(GUEST_CID, single_request(prompt="x" * 200))
    assert error_code_of(resp) == "cap_bytes"
    assert provider.calls == []
    assert byte_ledger.outbound == {}


def test_cumulative_outbound_ledger_stops_the_session_path():
    ledger = FakeByteLedger(outbound_total=32)
    handler, provider, *_ = make_handler(byte_ledger=ledger)
    assert error_code_of(handler.handle_request(GUEST_CID, single_request(prompt="a" * 20))) is None
    resp = handler.handle_request(GUEST_CID, single_request(prompt="b" * 20))
    assert error_code_of(resp) == "cap_bytes"
    assert len(provider.calls) == 1


def test_oversized_completion_is_refused_rather_than_truncated():
    config = make_config(inbound_per_call=16, requests_per_second=1000.0)
    handler, provider, audit, spend, ledger, _ = make_handler(
        FakeProvider(response="y" * 100, usd=0.001), config=config
    )
    resp = handler.handle_request(GUEST_CID, single_request())
    assert error_code_of(resp) == "cap_bytes"
    # The call happened, so the money is on the ledger even though the content
    # is not delivered.
    assert spend.spent[GUEST_CID] == pytest.approx(0.001)
    assert ledger.inbound == {}


def test_dlp_deny_blocks_dispatch_and_names_no_rule_on_the_wire():
    handler, provider, audit, _, ledger, _ = make_handler(dlp=DlpHook.with_default_rules())
    resp = handler.handle_request(
        GUEST_CID, single_request(prompt="-----BEGIN RSA PRIVATE KEY-----\nMIIE\n")
    )
    assert resp["error"] == "denied"
    assert provider.calls == []
    assert ledger.outbound == {}
    # The rule that fired is recorded host-side.
    dlp_records = [f for _, op, f in audit.records if op == "lm_dlp"]
    assert dlp_records and any(
        row["rule"] == "private_key_block" for row in dlp_records[0]["findings"]
    )


def test_malformed_bodies_are_frame_errors_not_answers():
    from repl_sandbox.errors import FrameError

    handler, provider, *_ = make_handler()
    for body in (
        {},
        {"depth": 0},
        {"prompts": [], "depth": 0},
        {"prompts": [1, 2], "depth": 0},
        {"prompt": 17, "depth": 0},
        {"prompt": "hi", "model": 3, "depth": 0},
        ["not", "an", "object"],
    ):
        with pytest.raises(FrameError):
            handler.handle_request(GUEST_CID, body)
    assert provider.calls == []


def test_provider_failure_surfaces_as_upstream():
    handler, provider, *_ = make_handler(FakeProvider(raises=TimeoutError_("provider timed out")))
    resp = handler.handle_request(GUEST_CID, single_request())
    assert error_code_of(resp) == "timeout"


# ---------------------------------------------------------------------------
# The allowing path and wire fidelity
# ---------------------------------------------------------------------------


def test_single_response_matches_rlms_own_serialisation():
    handler, provider, *_ = make_handler()
    resp = handler.handle_request(GUEST_CID, single_request(prompt="hello"))
    expected = LMResponse(
        chat_completion=RLMChatCompletion.from_dict(make_completion("hello", "ok"))
    ).to_dict()
    assert resp == expected
    assert list(resp) == list(expected)
    assert LMResponse.from_dict(resp).success


def test_batched_response_matches_rlms_own_serialisation():
    handler, provider, *_ = make_handler()
    resp = handler.handle_request(GUEST_CID, batched_request(["a", "b"]))
    expected = LMResponse(
        chat_completions=[
            RLMChatCompletion.from_dict(make_completion(p, "ok")) for p in ("a", "b")
        ]
    ).to_dict()
    assert resp == expected
    assert LMResponse.from_dict(resp).is_batched


def test_error_response_carries_both_completion_keys_as_null():
    handler, *_ = make_handler()
    resp = handler.handle_request(GUEST_CID, single_request(depth=9))
    assert set(resp) == {"error", "chat_completion", "chat_completions"}
    assert resp["chat_completion"] is None and resp["chat_completions"] is None
    assert LMResponse.from_dict(resp).success is False


def test_dict_prompts_round_trip_and_are_scanned():
    handler, provider, *_ = make_handler(dlp=DlpHook.with_default_rules())
    prompt = {"messages": [{"role": "user", "content": f"key is {FAKE_KEY}"}]}
    resp = handler.handle_request(GUEST_CID, single_request(prompt=prompt))
    assert error_code_of(resp) is None
    dispatched = provider.seen_prompts[0]
    assert FAKE_KEY not in json.dumps(dispatched)
    assert "[redacted:provider_key]" in json.dumps(dispatched)


def test_dlp_redacts_outbound_text_before_the_provider_sees_it():
    handler, provider, audit, *_ = make_handler(dlp=DlpHook.with_default_rules())
    resp = handler.handle_request(GUEST_CID, single_request(prompt=f"send {FAKE_KEY} onward"))
    assert error_code_of(resp) is None
    assert FAKE_KEY not in str(provider.seen_prompts[0])


def test_ledgers_are_charged_on_the_allowing_path():
    handler, provider, audit, spend, ledger, _ = make_handler(FakeProvider(usd=0.003))
    handler.handle_request(GUEST_CID, single_request(prompt="hello"))
    assert ledger.outbound[GUEST_CID] == prompt_bytes("hello")
    assert ledger.inbound[GUEST_CID] == len("ok".encode("utf-8"))
    assert spend.spent[GUEST_CID] == pytest.approx(0.003)
    completed = [f for _, op, f in audit.records if op == "lm_completed"]
    assert completed and completed[0]["prompt_digests"] == [prompt_digest("hello")]


def test_audit_records_a_digest_not_the_prompt_text():
    handler, _provider, audit, *_ = make_handler()
    secret_ish = "the sentence the guest sent outward"
    handler.handle_request(GUEST_CID, single_request(prompt=secret_ish))
    assert secret_ish not in audit.dump()
    assert prompt_digest(secret_ish) in audit.dump()


def test_caps_are_keyed_per_cid_not_shared():
    ledger = FakeByteLedger(outbound_total=32)
    handler, provider, *_ = make_handler(byte_ledger=ledger, cids=(GUEST_CID, OTHER_CID))
    assert error_code_of(handler.handle_request(GUEST_CID, single_request(prompt="a" * 30))) is None
    # The second session has its own budget.
    assert error_code_of(handler.handle_request(OTHER_CID, single_request(prompt="b" * 30))) is None
    assert ledger.outbound == {GUEST_CID: 30, OTHER_CID: 30}


# ---------------------------------------------------------------------------
# No key in the guest — the scripted form
# ---------------------------------------------------------------------------


def test_the_provider_key_never_appears_in_a_response_or_the_audit_log():
    """Grep the whole response and the whole audit log for the key string.

    The structural reason this holds is that the handler never receives a key —
    it holds a `Provider`, and the key lives inside it. The second half of the
    test covers the one path where a key could arrive uninvited: a provider
    exception whose message quotes it.
    """
    handler, provider, audit, *_ = make_handler(dlp=DlpHook.with_default_rules())
    ok = handler.handle_request(GUEST_CID, single_request(prompt="hello"))
    assert error_code_of(ok) is None

    leaky = FakeProvider(raises=RuntimeError(f"401 unauthorized (api-key {FAKE_KEY})"))
    handler2, _, audit2, *_ = make_handler(leaky, dlp=DlpHook.with_default_rules())
    failed = handler2.handle_request(GUEST_CID, single_request(prompt="hello"))
    assert error_code_of(failed) == "upstream"

    for blob in (json.dumps(ok), audit.dump(), json.dumps(failed), audit2.dump()):
        assert FAKE_KEY not in blob
        assert "sk-live" not in blob


def test_the_handler_holds_no_attribute_containing_a_key():
    handler, provider, *_ = make_handler()
    assert FAKE_KEY not in repr(handler.__dict__)


# ---------------------------------------------------------------------------
# The same refusals against the real sibling modules
#
# The doubles above pin this module's behaviour; these pin the seam. They skip
# rather than fail if a sibling has not landed, so this file is not a hostage to
# another agent's merge order.
# ---------------------------------------------------------------------------

real_audit = pytest.importorskip("repl_sandbox.audit")
real_ledger = pytest.importorskip("repl_sandbox.ledger")
real_session = pytest.importorskip("repl_sandbox.session")


def make_real_handler(provider=None, *, spend_cap=5.0, byte_caps=None, config=None):
    audit = real_audit.AuditLog()
    sessions = real_session.SessionTable(audit)
    sessions.bind(GUEST_CID, "session-under-test")
    byte_ledger = real_ledger.ByteLedger(byte_caps or ByteLedgerCaps(), audit)
    spend = real_ledger.SpendLedger(spend_cap, audit)
    handler = LMHandler(
        config=config or make_config(requests_per_second=1000.0),
        sessions=sessions,
        spend_ledger=spend,
        byte_ledger=byte_ledger,
        audit=audit,
        provider=provider or FakeProvider(),
        now=FakeClock(),
    )
    return handler, audit, spend, byte_ledger


def test_real_stack_serves_a_call_and_charges_both_ledgers():
    handler, audit, spend, byte_ledger = make_real_handler(FakeProvider(usd=0.004))
    resp = handler.handle_request(GUEST_CID, single_request(prompt="hello"))
    assert error_code_of(resp) is None
    assert spend.spent(GUEST_CID) == pytest.approx(0.004)
    assert byte_ledger.used(GUEST_CID)["outbound"] == prompt_bytes("hello")
    assert "lm_completed" in audit.ops()


def test_real_session_table_refuses_an_unbound_cid():
    handler, audit, *_ = make_real_handler()
    with pytest.raises(AuthError):
        handler.handle_request(OTHER_CID, single_request())
    assert "lm_auth_denied" in audit.ops()


def test_real_spend_ledger_exhaustion_halts_the_session():
    """The real ledger refuses the charge that would cross the cap.

    The provider call has already been made and is charged for by the refusal
    that follows it, so the money is accounted even though the completion is not
    delivered — and every request after it is refused before dispatch.
    """
    provider = FakeProvider(usd=0.02)
    handler, audit, spend, _ = make_real_handler(provider, spend_cap=0.01)
    first = handler.handle_request(GUEST_CID, single_request())
    assert error_code_of(first) == "cap_spend"
    assert handler.is_halted(GUEST_CID)
    assert spend.is_exhausted(GUEST_CID)

    second = handler.handle_request(GUEST_CID, single_request())
    assert error_code_of(second) == "cap_spend"
    assert len(provider.calls) == 1


def test_real_byte_ledger_stops_the_outbound_crossing():
    caps = replace(ByteLedgerCaps(), outbound_total=32)
    provider = FakeProvider()
    handler, _, _, byte_ledger = make_real_handler(provider, byte_caps=caps)
    assert error_code_of(handler.handle_request(GUEST_CID, single_request(prompt="a" * 20))) is None
    resp = handler.handle_request(GUEST_CID, single_request(prompt="b" * 20))
    assert error_code_of(resp) == "cap_bytes"
    assert len(provider.calls) == 1
    assert byte_ledger.remaining(GUEST_CID)["outbound_remaining"] == 12


# ---------------------------------------------------------------------------
# The `context` extension (INTERFACES section 4; DATA_MODEL section 6)
#
# Refusals first, as above. The handle table here is the **real**
# `repl_sandbox.handles.HandleTable`, not a double: CID scoping is the property
# under test and a double would only be testing this file's idea of it. The
# provider stays fake — nothing here spends money.
# ---------------------------------------------------------------------------

#: Stand-in for the user's belief base. Distinctive enough to grep a whole
#: response for, which is how "never returns to the guest" is checked.
REFERENT_TEXT = "belief-row-ZQ7: the corpus the guest may address but not read"


class CountingHandleTable(HandleTable):
    """The real table, plus a tally of how many lookups a call actually costs."""

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.resolutions: list[tuple[int, str]] = []

    def resolve(self, cid: int, handle_id: str):
        self.resolutions.append((cid, handle_id))
        return super().resolve(cid, handle_id)


def make_table(clock: FakeClock | None = None, ttl_s: float = 3600.0) -> CountingHandleTable:
    return CountingHandleTable(ttl_s=ttl_s, now=clock or FakeClock())


def allocate_text(table: HandleTable, cid: int = GUEST_CID, text: str = REFERENT_TEXT) -> dict:
    """A live text handle in `cid`'s namespace, in its `{id, kind}` wire form."""
    return table.allocate(cid, "text-blocks", text).to_wire()


def context_request(context, prompt: str = "summarise", model: str = "fake-model") -> dict:
    """An rlms `LMRequest` dict with the Trellis `context` field added to it.

    Built exactly this way on purpose: the native frame comes from rlms' own
    dataclass and `context` is bolted on afterwards, because that is what the
    field is — an extension to a wire this repo does not own.
    """
    request = LMRequest(prompt=prompt, model=model, depth=0).to_dict()
    request["context"] = context
    return request


def with_context(handler, context, **kwargs) -> dict:
    return handler.handle_request(GUEST_CID, context_request(context, **kwargs))


def guest_visible(response: dict) -> str:
    """Everything the guest gets back, as one searchable blob."""
    return json.dumps(response, ensure_ascii=False, default=str)


# -- refusals ---------------------------------------------------------------


def test_a_context_token_from_another_session_is_refused():
    """CID scoping is the whole game: a foreign token resolves for nobody else."""
    table = make_table()
    foreign = allocate_text(table, cid=OTHER_CID)
    handler, provider, audit, _, byte_ledger, _ = make_handler(handles=table)

    resp = with_context(handler, foreign)

    assert error_code_of(resp) == "denied"
    assert provider.calls == []
    assert REFERENT_TEXT not in guest_visible(resp)
    assert REFERENT_TEXT not in audit.dump()
    # Nothing crossed, so nothing is charged.
    assert byte_ledger.outbound == {}


def test_a_foreign_token_and_an_unknown_one_are_byte_identical_refusals():
    """The error channel is not an oracle for another session's handle table."""
    table = make_table()
    foreign = allocate_text(table, cid=OTHER_CID)
    handler, _, _, _, _, _ = make_handler(handles=table)

    denied_foreign = with_context(handler, foreign)
    denied_unknown = with_context(handler, {"id": "0" * 32, "kind": "text-blocks"})

    assert denied_foreign == denied_unknown
    assert denied_foreign["error"] == "denied"


def test_a_dropped_context_handle_is_refused_the_same_way():
    table = make_table()
    handle = allocate_text(table)
    table.drop(GUEST_CID, handle["id"])
    handler, provider, *_ = make_handler(handles=table)

    resp = with_context(handler, handle)

    assert error_code_of(resp) == "denied"
    assert resp["error"] == "denied"
    assert provider.calls == []


def test_an_expired_context_handle_is_refused():
    clock = FakeClock()
    table = make_table(clock=clock, ttl_s=60.0)
    handle = allocate_text(table)
    clock.advance(61.0)
    handler, provider, *_ = make_handler(handles=table)

    resp = with_context(handler, handle)

    assert error_code_of(resp) == "denied"
    assert provider.calls == []


def test_a_stale_context_handle_is_refused():
    """A derived address over mutated rows never reaches a prompt."""
    table = make_table()
    handle = allocate_text(table)
    table.mark_stale(GUEST_CID, handle["id"])
    handler, provider, *_ = make_handler(handles=table)

    assert error_code_of(with_context(handler, handle)) == "denied"
    assert provider.calls == []


@pytest.mark.parametrize(
    "context",
    [
        REFERENT_TEXT,
        [REFERENT_TEXT],
        ["a handle id, honest"],
        {"id": 7, "kind": "text-blocks"},
        {"kind": "text-blocks"},
        [{"id": "abc", "kind": "text-blocks"}, "and some prose"],
        42,
        [],
    ],
)
def test_free_text_where_a_handle_belongs_is_refused(context):
    """`context` is an address list, never a second prompt.

    A free-text field here would be a second prompt with different accounting:
    unmetered against the prompt cap on the way in, and indistinguishable in the
    audit log from a referent the host resolved.
    """
    table = make_table()
    handler, provider, *_ = make_handler(handles=table)

    resp = with_context(handler, context)

    assert error_code_of(resp) == "denied"
    assert provider.calls == []
    assert table.resolutions == []


def test_a_partly_resolvable_context_refuses_the_whole_call():
    """Fail closed: a partially-resolved prompt is never dispatched."""
    table = make_table()
    mine = allocate_text(table)
    foreign = allocate_text(table, cid=OTHER_CID, text="another session's rows")
    handler, provider, _, _, byte_ledger, _ = make_handler(handles=table)

    resp = with_context(handler, [mine, foreign])

    assert error_code_of(resp) == "denied"
    assert provider.calls == []
    assert byte_ledger.outbound == {}
    assert REFERENT_TEXT not in guest_visible(resp)


def test_an_over_cap_resolved_context_refuses_without_reporting_its_size():
    """A `cap_bytes` refusal never answers "how big is the referent?"."""
    table = make_table()
    handle = allocate_text(table, text="z" * 4096)
    config = make_config(requests_per_second=1000.0, outbound_per_call=512)
    handler, provider, *_ = make_handler(handles=table, config=config)

    resp = with_context(handler, handle, prompt="summarise")

    assert error_code_of(resp) == "cap_bytes"
    assert provider.calls == []
    message = resp["error"]
    # No count of any kind: not the referent's size, not the spliced total, not
    # the headroom left. The threshold is fixed and guest-immovable, so the only
    # thing the guest learns is one bit it could have learned by trying.
    assert not any(character.isdigit() for character in message), message


def test_the_cumulative_ledger_refusal_also_carries_no_resolved_size():
    """The ledger's own message names byte counts; it must not be the answer."""
    table = make_table()
    handle = allocate_text(table, text="z" * 2048)
    handler, provider, *_ = make_handler(
        handles=table, byte_ledger=FakeByteLedger(outbound_total=64)
    )

    resp = with_context(handler, handle)

    assert error_code_of(resp) == "cap_bytes"
    assert not any(character.isdigit() for character in resp["error"]), resp["error"]
    assert provider.calls == []


def test_more_than_the_handle_ceiling_is_refused_before_any_lookup():
    table = make_table()
    handles = [
        allocate_text(table, text=f"row {index}") for index in range(MAX_CONTEXT_HANDLES + 1)
    ]
    handler, provider, *_ = make_handler(handles=table)

    resp = with_context(handler, handles)

    assert error_code_of(resp) == "denied"
    assert table.resolutions == []
    assert provider.calls == []


def test_a_host_with_no_handle_table_refuses_context_rather_than_ignoring_it():
    """Absence of the table is a closed gate, not an open one."""
    handler, provider, *_ = make_handler(handles=None)

    resp = with_context(handler, {"id": "a" * 32, "kind": "text-blocks"})

    assert error_code_of(resp) == "denied"
    assert provider.calls == []
    # And the native path on the same handler is untouched.
    assert error_code_of(handler.handle_request(GUEST_CID, single_request())) is None


def test_depth_is_still_host_derived_when_context_is_present():
    table = make_table()
    handle = allocate_text(table)
    handler, provider, *_ = make_handler(handles=table)

    request = context_request(handle)
    request["depth"] = 2
    resp = handler.handle_request(GUEST_CID, request)

    assert error_code_of(resp) == "depth_ceiling"
    assert provider.calls == []
    # A depth smuggled inside the context list is not a depth either: the field
    # is read as handle addresses and nothing in it reaches `LMRequest.depth`.
    smuggled = context_request([{"id": handle["id"], "kind": "text-blocks", "depth": 9}])
    assert error_code_of(handler.handle_request(GUEST_CID, smuggled)) is None


def test_a_request_already_over_cap_is_refused_before_anything_is_resolved():
    """Resolving a large referent only to reject the call wastes the work."""
    table = make_table()
    handle = allocate_text(table)
    config = make_config(requests_per_second=1000.0, outbound_per_call=16)
    handler, provider, *_ = make_handler(handles=table, config=config)

    resp = with_context(handler, handle, prompt="x" * 64)

    assert error_code_of(resp) == "cap_bytes"
    assert table.resolutions == []
    assert provider.calls == []


def test_a_spent_session_never_resolves_a_handle():
    """The dollar ledger is the last gate ahead of resolution, so it must hold."""
    table = make_table()
    handle = allocate_text(table)
    handler, provider, *_ = make_handler(FakeProvider(usd=0.02), handles=table, spend_cap=0.01)

    # One call spends past the cap; the next is refused before dispatch.
    handler.handle_request(GUEST_CID, single_request())
    assert error_code_of(handler.handle_request(GUEST_CID, single_request())) == "cap_spend"
    assert handler.is_halted(GUEST_CID)
    resolutions_before = len(table.resolutions)

    assert error_code_of(with_context(handler, handle)) == "cap_spend"
    assert len(table.resolutions) == resolutions_before


def test_a_prompt_shape_that_cannot_take_context_is_refused():
    table = make_table()
    handle = allocate_text(table)
    handler, provider, *_ = make_handler(handles=table)

    request = LMRequest(prompt={"not_messages": []}, depth=0).to_dict()
    request["context"] = handle
    resp = handler.handle_request(GUEST_CID, request)

    assert error_code_of(resp) == "denied"
    assert provider.calls == []


# -- the success path -------------------------------------------------------


def test_the_referent_reaches_the_provider_and_never_the_guest():
    """The whole ergonomic, and the whole safety claim, in one test."""
    table = make_table()
    handle = allocate_text(table)
    handler, provider, audit, _, byte_ledger, _ = make_handler(handles=table)

    resp = with_context(handler, handle, prompt="summarise these")

    assert error_code_of(resp) is None
    # It went to the provider...
    assert len(provider.seen_prompts) == 1
    sent = provider.seen_prompts[0]
    assert REFERENT_TEXT in sent
    assert sent.startswith("summarise these")
    assert CONTEXT_OPEN in sent and CONTEXT_CLOSE in sent
    # ...and nowhere else. Not in the completion, not in the echoed prompt, not
    # in the audit log, which records digests and sizes rather than text.
    assert REFERENT_TEXT not in guest_visible(resp)
    assert REFERENT_TEXT not in audit.dump()
    # The guest gets back the prompt it sent, which it already had.
    assert resp["chat_completion"]["prompt"] == "summarise these"


def test_the_ledger_is_charged_at_full_resolved_size_not_the_tokens_size():
    """The referent is what leaves, so the referent is what is charged."""
    table = make_table()
    handle = allocate_text(table)
    handler, provider, audit, _, byte_ledger, _ = make_handler(handles=table)

    assert error_code_of(with_context(handler, handle, prompt="summarise")) is None

    expected = prompt_bytes(splice_context("summarise", context_block([REFERENT_TEXT])))
    assert byte_ledger.outbound[GUEST_CID] == expected
    # Far more than the handle token itself, which is the point.
    assert expected > prompt_bytes("summarise") + len(handle["id"])
    completed = [fields for _, op, fields in audit.records if op == "lm_completed"][0]
    assert completed["outbound_bytes"] == expected
    assert completed["context_handles"] == 1
    assert completed["context_bytes"] == len(context_block([REFERENT_TEXT]).encode("utf-8"))


def test_the_inbound_charge_does_not_re_charge_the_echoed_prompt():
    """The echo was already charged outbound; charging it again is double-billing."""
    table = make_table()
    handle = allocate_text(table)
    handler, _, _, _, byte_ledger, _ = make_handler(
        FakeProvider(response="short answer"), handles=table
    )

    assert error_code_of(with_context(handler, handle)) is None
    assert byte_ledger.inbound[GUEST_CID] == len("short answer".encode("utf-8"))


def test_a_handle_named_twice_costs_one_lookup():
    table = make_table()
    handle = allocate_text(table)
    handler, provider, *_ = make_handler(handles=table)

    assert error_code_of(with_context(handler, [handle, handle, handle])) is None

    assert table.resolutions == [(GUEST_CID, handle["id"])]
    assert provider.seen_prompts[0].count(REFERENT_TEXT) == 1


def test_two_distinct_handles_are_both_spliced_in_order():
    table = make_table()
    first = allocate_text(table, text="alpha rows")
    second = allocate_text(table, text="beta rows")
    handler, provider, *_ = make_handler(handles=table)

    assert error_code_of(with_context(handler, [first, second])) is None

    sent = provider.seen_prompts[0]
    assert sent.index("alpha rows") < sent.index("beta rows")
    assert len(table.resolutions) == 2


def test_the_batched_path_splices_into_every_prompt_and_charges_every_copy():
    table = make_table()
    handle = allocate_text(table)
    handler, provider, _, _, byte_ledger, _ = make_handler(handles=table)

    request = LMRequest(prompts=["one", "two"], model="fake-model", depth=0).to_dict()
    request["context"] = handle
    resp = handler.handle_request(GUEST_CID, request)

    assert error_code_of(resp) is None
    assert len(provider.seen_prompts) == 2
    assert all(REFERENT_TEXT in sent for sent in provider.seen_prompts)
    # One resolution, two copies dispatched, and both copies charged: what leaves
    # is what is metered.
    assert len(table.resolutions) == 1
    block = context_block([REFERENT_TEXT])
    expected = sum(prompt_bytes(splice_context(p, block)) for p in ("one", "two"))
    assert byte_ledger.outbound[GUEST_CID] == expected
    for completion in resp["chat_completions"]:
        assert REFERENT_TEXT not in json.dumps(completion, default=str)
    assert [c["prompt"] for c in resp["chat_completions"]] == ["one", "two"]


def test_a_chat_shaped_prompt_takes_context_as_a_trailing_message():
    table = make_table()
    handle = allocate_text(table)
    handler, provider, *_ = make_handler(handles=table)

    request = LMRequest(
        prompt={"messages": [{"role": "user", "content": "hi"}]}, depth=0
    ).to_dict()
    request["context"] = handle
    resp = handler.handle_request(GUEST_CID, request)

    assert error_code_of(resp) is None
    sent = provider.seen_prompts[0]
    assert sent["messages"][0]["content"] == "hi"
    assert REFERENT_TEXT in sent["messages"][-1]["content"]
    assert REFERENT_TEXT not in guest_visible(resp)


def test_a_row_bearing_referent_renders_as_rows():
    """Duck-typed on `rows`, so a broker `ResultSet` renders without importing it."""

    class FakeResultSet:
        rows = [[1, "alpha"], [2, "beta"]]
        schema = [{"name": "id"}, {"name": "word"}]
        rowcount = 2

    table = make_table()
    handle = table.allocate(GUEST_CID, "result-set", FakeResultSet()).to_wire()
    handler, provider, *_ = make_handler(handles=table)

    assert error_code_of(with_context(handler, handle)) is None
    sent = provider.seen_prompts[0]
    assert "alpha" in sent
    # Only the rows. `schema` is column description, not content, and it is not
    # what the caller addressed.
    assert "rowcount" not in sent


def test_dlp_runs_over_the_resolved_context_like_any_other_outbound_prompt():
    """Defense-in-depth on the residual — not the boundary, but it must fire."""
    table = make_table()
    handle = allocate_text(table, text=f"leaked {FAKE_KEY} in the corpus")
    handler, provider, audit, *_ = make_handler(handles=table, dlp=DlpHook.with_default_rules())

    resp = with_context(handler, handle)

    assert error_code_of(resp) is None
    assert FAKE_KEY not in provider.seen_prompts[0]
    assert "[redacted:provider_key]" in provider.seen_prompts[0]
    assert FAKE_KEY not in audit.dump()
    assert FAKE_KEY not in guest_visible(resp)


def test_a_deny_rule_matching_resolved_context_refuses_the_call():
    table = make_table()
    handle = allocate_text(table, text="-----BEGIN RSA PRIVATE KEY-----")
    handler, provider, *_ = make_handler(handles=table, dlp=DlpHook.with_default_rules())

    resp = with_context(handler, handle)

    assert error_code_of(resp) == "denied"
    assert provider.calls == []


def test_a_provider_that_stashes_the_spliced_prompt_elsewhere_is_withheld():
    """The echo strip is the known path; this is what catches the unknown one."""

    class StashingProvider(FakeProvider):
        def complete(self, prompt, model):
            completion, usd = super().complete(prompt, model)
            completion["echo"] = prompt
            return completion, usd

    table = make_table()
    handle = allocate_text(table)
    handler, provider, *_ = make_handler(StashingProvider(), handles=table)

    resp = with_context(handler, handle)

    assert error_code_of(resp) == "upstream"
    assert REFERENT_TEXT not in guest_visible(resp)


def test_a_sub_llm_that_quotes_the_context_is_still_delivered():
    """`response` is the bounded completion — the metered residual, by design."""
    table = make_table()
    handle = allocate_text(table)
    handler, _, _, _, byte_ledger, _ = make_handler(
        FakeProvider(response=f"in short: {REFERENT_TEXT}"), handles=table
    )

    resp = with_context(handler, handle)

    assert error_code_of(resp) is None
    assert REFERENT_TEXT in resp["chat_completion"]["response"]
    # And it is charged inbound like every other completion.
    assert byte_ledger.inbound[GUEST_CID] == len(f"in short: {REFERENT_TEXT}".encode("utf-8"))


# -- the native path is untouched -------------------------------------------


def test_a_native_request_with_no_context_is_unchanged_by_the_extension():
    """rlms' own frame takes rlms' own path; the extension costs it nothing."""
    table = make_table()
    with_table, provider_a, _, _, ledger_a, _ = make_handler(handles=table)
    without_table, provider_b, _, _, ledger_b, _ = make_handler(handles=None)

    native = LMRequest(prompt="hello", model="fake-model", depth=0).to_dict()
    assert set(native) == {"prompt", "model", "depth"}

    first = with_table.handle_request(GUEST_CID, native)
    second = without_table.handle_request(GUEST_CID, native)

    assert first == second
    assert error_code_of(first) is None
    assert provider_a.seen_prompts == provider_b.seen_prompts == ["hello"]
    assert ledger_a.outbound == ledger_b.outbound == {GUEST_CID: prompt_bytes("hello")}
    assert table.resolutions == []


def test_a_null_context_is_the_native_path():
    """The stub always emits the key; `None` must mean "no context", not "empty"."""
    table = make_table()
    handler, provider, *_ = make_handler(handles=table)

    request = LMRequest(prompt="hello", depth=0).to_dict()
    request["context"] = None
    resp = handler.handle_request(GUEST_CID, request)

    assert error_code_of(resp) is None
    assert provider.seen_prompts == ["hello"]
    assert table.resolutions == []


def test_rlms_own_parser_drops_the_extension():
    """The compatibility claim, held against the pinned dataclass itself."""
    table = make_table()
    handle = allocate_text(table)

    parsed = LMRequest.from_dict(context_request(handle))

    assert not hasattr(parsed, "context")
    assert "context" not in parsed.to_dict()
    assert parsed.to_dict() == LMRequest(prompt="summarise", model="fake-model").to_dict()


# -- rendering helpers ------------------------------------------------------


def test_render_referent_refuses_a_shape_it_cannot_render():
    with pytest.raises(UpstreamError):
        render_referent(object())


def test_the_context_block_is_delimited():
    block = context_block(["alpha", "beta"])
    assert block.startswith(CONTEXT_OPEN)
    assert block.endswith(CONTEXT_CLOSE)
    assert "alpha" in block and "beta" in block


def test_splice_does_not_mutate_the_guests_prompt():
    original = {"messages": [{"role": "user", "content": "hi"}]}
    spliced = splice_context(original, context_block(["rows"]))
    assert original == {"messages": [{"role": "user", "content": "hi"}]}
    assert len(spliced["messages"]) == 2


# -- the same properties against the real ledgers and session table ----------


def test_real_stack_serves_a_context_call_and_scopes_it_by_cid():
    audit = real_audit.AuditLog()
    sessions = real_session.SessionTable(audit)
    sessions.bind(GUEST_CID, "session-under-test")
    sessions.bind(OTHER_CID, "another-session")
    table = make_table()
    provider = FakeProvider(usd=0.004)
    handler = LMHandler(
        config=make_config(requests_per_second=1000.0),
        sessions=sessions,
        spend_ledger=real_ledger.SpendLedger(5.0, audit),
        byte_ledger=real_ledger.ByteLedger(ByteLedgerCaps(), audit),
        audit=audit,
        provider=provider,
        handles=table,
        now=FakeClock(),
    )

    mine = allocate_text(table, cid=GUEST_CID)
    theirs = allocate_text(table, cid=OTHER_CID, text="the other session's rows")

    assert error_code_of(handler.handle_request(GUEST_CID, context_request(mine))) is None
    assert REFERENT_TEXT in provider.seen_prompts[0]

    # The same live token, presented by the session it was not minted for.
    denied = handler.handle_request(OTHER_CID, context_request(mine))
    assert error_code_of(denied) == "denied"
    assert REFERENT_TEXT not in guest_visible(denied)
    # And the reverse, so neither direction is the special case.
    assert error_code_of(handler.handle_request(GUEST_CID, context_request(theirs))) == "denied"
    assert len(provider.calls) == 1
