"""Host-side LM handler: serves the flat sub-LLM fan-out over the LM seam.

Source of truth: REPL_SANDBOX_INTERFACES.md section 4 (LM-handler RPC surface)
for the wire, the auth rule, and the cap table; REPL_SANDBOX_DATA_MODEL.md
section 6 (The bounded materialisation exception) for the two metered ledgers;
REPL_SANDBOX_SPEC.md section 4.1 (LM handler) for the chokepoint contract.

The wire is rlms', so the guest's stock `llm_query` / `llm_query_batched` stubs
work against this handler with no client patch:

    LMRequest  = {prompt | prompts, model, depth, context?}
    LMResponse = {error, chat_completion | chat_completions}

An `LMResponse` always carries all three keys, with the two that do not apply set
to null — byte-identical to `rlm.core.comms_utils.LMResponse.to_dict()`. A cap
breach comes back as `error` holding the taxonomy code string from
`errors.py`; `error_code_of()` parses it back out.

**`context` is a Trellis extension to that wire, not an rlms field.** rlms'
`LMRequest` has four fields and `context` is not one of them; `LMRequest.from_dict`
reads its four keys by name and drops everything else, and `LMRequest.to_dict`
can only emit what the dataclass holds — so rlms' own client never sets `context`
and rlms' own parser never sees it. The extension is free because this handler,
not rlms, serves the guest→host LM frame: a native `{prompt, model, depth}`
request takes exactly the path it took before the field existed. Nothing in this
module may describe `context` as inherited rlms behaviour.

**What `context` buys.** It is the bounded materialisation exception of
REPL_SANDBOX_DATA_MODEL.md section 6 given a wire. The guest passes handle
*tokens*; this handler resolves them against the per-CID handle table, splices the
referents into the outbound prompt host-side, and dispatches. The sub-LLM reads
the referent and only the bounded completion comes back, so the model reasons over
a whole belief base without one row entering the guest. `context` therefore carries
handles and never free text: a string where a handle belongs is refused, because a
second free-text field would be a second prompt with different accounting —
unmetered against the prompt cap and indistinguishable in the audit log from a
referent the host resolved.

**Why this handler exists at all.** rlms' own `max_concurrent_subcalls` and
`batch_max_concurrent` are soft bookkeeping inside the same interpreter the model
writes code in: `batch_max_concurrent` bounds the `asyncio.Semaphore` of one
batched call only, and any model that writes `import threading` walks straight
past both. They are useful accounting, not ceilings. The ceilings here are
host-side, keyed by the CID the kernel supplied at `accept()`, and the guest
cannot reach the state they are kept in.

**What this handler is not.** It is not the exfiltration boundary. The boundary
is data-flow — the guest holds handles, not secret-bearing payloads
(REPL_SANDBOX_ARCHITECTURE.md section 3.1). The byte ledgers and the DLP hook
bound the *rate* of the residual that boundary deliberately leaves; they are
defense-in-depth and are never an enforcing surface for the exfil invariant
(REPL_SANDBOX_ARCHITECTURE.md section 7, requirement 12). Metering resolved
context at its full size, and scanning it, are both defense-in-depth on that
residual for exactly the same reason: what makes `context` safe is that the guest
never held the bytes, not that the host counted them.

**The context error channel is deliberately uninformative.** Every refusal on the
context path — a foreign token, an unknown token, a dropped or expired one, a
string where a handle belongs — comes back as a bare `denied` with no detail, so
the guest cannot use the error channel to learn whether another session's handle
exists. A `cap_bytes` refusal on a resolved prompt likewise carries no byte count:
the referent's size is host content, and reporting it would answer a question the
guest is not allowed to ask. The residual is one bit per call (over cap or not)
against a fixed, guest-immovable threshold, which is the floor for having a
per-call cap at all.

**The key.** This handler never holds the provider API key. It holds a
`Provider`, and the key lives inside whatever the host driver built with
`openai_chat_provider_from_env()`. There is no path from a request to the key,
and no code here reads, logs, echoes, or returns one.

This module is transport-agnostic on purpose: it neither listens nor accepts.
The vsock listener calls `handle_request(cid, request)` with the CID it got from
`accept()`, and the same code is exercised in tests with no socket at all.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from typing import TYPE_CHECKING, Any, Callable, Protocol, Sequence

from repl_sandbox.config import SandboxConfig
from repl_sandbox.dlp import DlpFinding, DlpHook, findings_to_audit, has_denial
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
    UpstreamError,
)

if TYPE_CHECKING:  # sibling modules; imported for types only so this module
    # loads (and its refusals are testable) whether or not they have landed.
    from repl_sandbox.audit import AuditLog
    from repl_sandbox.handles import HandleTable
    from repl_sandbox.ledger import ByteLedger, SpendLedger
    from repl_sandbox.session import SessionTable


PromptValue = str | dict

#: The one field this handler adds to rlms' `LMRequest`. A **Trellis extension**
#: (INTERFACES section 4), carried on the same frame because this handler serves
#: it; rlms neither emits nor reads it.
CONTEXT_FIELD = "context"

#: Ceiling on how many handles one call may name. A call that resolves an
#: unbounded list is a call whose host-side work the guest sets, which is the
#: shape of every cap in this module: the guest names the work, the host bounds it.
MAX_CONTEXT_HANDLES = 16

#: Delimiters around the host-spliced block, so the sub-LLM can tell the guest's
#: instruction from the host's referent. Not a control: the guest can write these
#: same strings into its own prompt, and nothing is lost when it does, because the
#: only thing it can forge that way is text it already held.
CONTEXT_OPEN = "<trellis-context>"
CONTEXT_CLOSE = "</trellis-context>"


class Provider(Protocol):
    """The one seam that talks to a paid API.

    An implementation holds the API key and the SDK client. Nothing it is handed
    comes from the guest except prompt text and a model name, and nothing it
    returns reaches the guest un-metered. Both methods return the dollar cost of
    the call alongside the completion(s), because the spend ledger is only as
    real as the number it is fed — a provider that reports 0.0 silently disables
    the dollar cap.
    """

    def complete(self, prompt: PromptValue, model: str | None) -> tuple[dict, float]:
        """One completion. Returns `(chat_completion_dict, usd)`."""
        ...

    def complete_batched(
        self, prompts: list[PromptValue], model: str | None
    ) -> tuple[list[dict], float]:
        """One completion per prompt, in order. Returns `(completions, usd)`."""
        ...


# ---------------------------------------------------------------------------
# Response construction — byte-identical to rlms' LMResponse.to_dict()
# ---------------------------------------------------------------------------


def error_response(code: str, detail: str | None = None) -> dict:
    """An `LMResponse` carrying an error, with both completion keys null.

    The error string always begins with the taxonomy code, so the guest stub can
    map it back to an exception class without a second field on a wire this
    handler does not own.
    """
    return {
        "error": code if not detail else f"{code}: {detail}",
        "chat_completion": None,
        "chat_completions": None,
    }


def single_response(chat_completion: dict) -> dict:
    return {"chat_completion": chat_completion, "chat_completions": None, "error": None}


def batched_response(chat_completions: list[dict]) -> dict:
    return {"chat_completions": chat_completions, "chat_completion": None, "error": None}


def error_code_of(response: dict) -> str | None:
    """The taxonomy code from an `LMResponse` dict, or `None` if it succeeded."""
    error = response.get("error")
    if not isinstance(error, str) or not error:
        return None
    return error.split(":", 1)[0].strip()


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------


class TokenBucket:
    """Per-CID request-rate bucket over an injected clock.

    The clock is a parameter so the rate cap is tested by moving time, not by
    sleeping: a cap whose test has to sleep gets a tolerance, and a tolerance is
    where a cap stops firing.
    """

    def __init__(self, rate_per_s: float, now: Callable[[], float]) -> None:
        self._rate = float(rate_per_s)
        self._capacity = max(1.0, float(rate_per_s))
        self._now = now
        self._tokens = self._capacity
        self._updated = now()
        self._lock = threading.Lock()

    def take(self) -> float | None:
        """Consume one token. Returns `None` on success, else a retry-after."""
        if self._rate <= 0:
            # A non-positive rate is a closed gate, not an open one.
            return float("inf")
        with self._lock:
            now = self._now()
            elapsed = max(0.0, now - self._updated)
            self._updated = now
            self._tokens = min(self._capacity, self._tokens + elapsed * self._rate)
            if self._tokens < 1.0:
                return (1.0 - self._tokens) / self._rate
            self._tokens -= 1.0
            return None


# ---------------------------------------------------------------------------
# Prompt handling
# ---------------------------------------------------------------------------


def prompt_bytes(prompt: PromptValue) -> int:
    """Outbound byte weight of one prompt, as it will be serialised."""
    if isinstance(prompt, str):
        return len(prompt.encode("utf-8"))
    return len(json.dumps(prompt, ensure_ascii=False).encode("utf-8"))


def prompt_digest(prompt: PromptValue) -> str:
    """A short digest for the audit log. The prompt text itself is never logged.

    Prompt text is guest-authored and may carry content a sink already
    materialised; copying it into a host log would widen the very crossing the
    ledgers meter.
    """
    if isinstance(prompt, str):
        raw = prompt.encode("utf-8")
    else:
        raw = json.dumps(prompt, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:16]


def _scan_prompt(hook: DlpHook, prompt: PromptValue) -> tuple[PromptValue, list[DlpFinding]]:
    """Run the hook over a prompt, walking into dict/list prompts' string leaves.

    rlms allows a prompt to be a dict (a message list, typically), so scanning
    only `str` prompts would leave the common chat shape unscanned.
    """
    findings: list[DlpFinding] = []

    def walk(node: Any) -> Any:
        if isinstance(node, str):
            rewritten, found = hook.apply(node)
            findings.extend(found)
            return rewritten
        if isinstance(node, dict):
            return {key: walk(value) for key, value in node.items()}
        if isinstance(node, list):
            return [walk(item) for item in node]
        return node

    return walk(prompt), findings


def completion_content_bytes(completion: dict) -> int:
    """Inbound content weight of one completion.

    Only the generated text (and any per-call error text) is charged. The
    `prompt` field rlms echoes back is guest-authored and was already charged
    outbound; charging it again would meter the same bytes twice and would let a
    long prompt exhaust the inbound ledger without any host content crossing.
    """
    total = 0
    for key in ("response", "error"):
        value = completion.get(key)
        if isinstance(value, str):
            total += len(value.encode("utf-8"))
    return total


# ---------------------------------------------------------------------------
# The `context` extension: handle tokens in, host-resolved prompt text out
# ---------------------------------------------------------------------------


def context_handle_ids(raw: object) -> tuple[str, ...]:
    """The handle ids a `context` field names — deduplicated, order preserved.

    Accepts one handle object or a list of them, in the `{id, kind}` wire shape of
    DATA_MODEL section 1. Everything else is refused, and a string is refused
    loudest: `context` is an address list, not a second prompt.

    Deduplication happens here rather than at resolution time so the "resolve each
    distinct handle once per call" property is a property of the parse, not a cache
    that has to stay warm. A handle named twice costs one lookup.
    """
    if raw is None:
        return ()
    items: object = [raw] if isinstance(raw, dict) else raw
    if isinstance(items, str) or not isinstance(items, (list, tuple)):
        raise DeniedError("context takes handles, not text")
    if not items:
        raise DeniedError("context is present but names no handle")
    if len(items) > MAX_CONTEXT_HANDLES:
        raise DeniedError(f"context names more than {MAX_CONTEXT_HANDLES} handles")

    ids: list[str] = []
    for item in items:
        if isinstance(item, str):
            raise DeniedError("context takes handles, not text")
        if not isinstance(item, dict):
            raise DeniedError("each context entry must be a handle object")
        handle_id = item.get("id")
        if not isinstance(handle_id, str) or not handle_id:
            raise DeniedError("each context entry must carry a string handle id")
        ids.append(handle_id)
    return tuple(dict.fromkeys(ids))


def render_referent(referent: object) -> str:
    """One handle's referent as prompt text. Host-side only; never returned.

    Duck-typed on `rows` rather than imported from the broker, so a referent shape
    is recognised by what it carries and this module does not import the DB seam
    to send a prompt. Text referents pass through; row-bearing ones serialise.

    Bounded by construction rather than by a copy made here: a `ResultSet` referent
    was already capped at `broker_caps.max_rows` / `max_result_bytes` when the
    broker landed it, so rendering it holds no more host memory than the broker
    already holds. Nothing in this path assembles a corpus.
    """
    if isinstance(referent, str):
        return referent

    rows = getattr(referent, "rows", None)
    if isinstance(rows, list):
        value: object = rows
    elif isinstance(referent, (list, tuple)):
        value = list(referent)
    else:
        raise UpstreamError(
            f"a {type(referent).__name__} referent cannot be rendered as context"
        )

    try:
        return json.dumps(value, ensure_ascii=False, allow_nan=False, default=str)
    except (TypeError, ValueError) as exc:
        # Fail closed. A referent that will not serialise is not silently
        # partially rendered: a half-written context is a wrong prompt.
        raise UpstreamError(
            f"context referent is not renderable ({type(exc).__name__})"
        ) from exc


def _carries(node: Any, needle: str) -> bool:
    """Whether any string anywhere in `node` contains `needle`.

    Walks the structure rather than searching a serialisation of it: JSON escapes
    newlines, and the context block has them, so a substring test over
    `json.dumps(...)` would quietly never match and the check would pass by
    accident. A control that cannot fail is not a control.
    """
    if isinstance(node, str):
        return needle in node
    if isinstance(node, dict):
        return any(_carries(value, needle) for value in node.values())
    if isinstance(node, (list, tuple)):
        return any(_carries(item, needle) for item in node)
    return False


def context_block(rendered: Sequence[str]) -> str:
    """The delimited block spliced into the outbound prompt."""
    return f"{CONTEXT_OPEN}\n" + "\n\n".join(rendered) + f"\n{CONTEXT_CLOSE}"


def splice_context(prompt: PromptValue, block: str) -> PromptValue:
    """Put the resolved block into one outbound prompt, host-side.

    A text prompt takes the block appended after it: the guest's instruction leads
    and the referent follows it, which is the order `llm_query(prompt="summarise",
    context=beliefs)` reads in. A chat-shaped prompt takes it as a trailing user
    message rather than by string concatenation, because concatenating into a
    message list produces a prompt no provider parses the way the caller meant.

    Returns a new object; the guest's prompt is not mutated, because it is handed
    back to the guest afterwards in place of the provider's echo.
    """
    if isinstance(prompt, str):
        return f"{prompt}\n\n{block}"
    messages = prompt.get("messages") if isinstance(prompt, dict) else None
    if isinstance(messages, list):
        return {**prompt, "messages": [*messages, {"role": "user", "content": block}]}
    raise DeniedError(
        "context needs a text prompt or a prompt carrying a 'messages' list"
    )


# ---------------------------------------------------------------------------
# The handler
# ---------------------------------------------------------------------------


class LMHandler:
    """Serves `llm_query` / `llm_query_batched` for one sandbox host.

    Every refusal below happens before the provider is dispatched, except the
    dollar charge (the cost of a call is not known until it returns) and the
    inbound content charge. Refusals are returned as `LMResponse.error`, with two
    exceptions that are terminal rather than answerable: an unknown CID and a
    structurally invalid request body both raise, so the transport drops the
    connection instead of replying to a peer it could not identify or parse.
    """

    def __init__(
        self,
        config: SandboxConfig,
        sessions: "SessionTable",
        spend_ledger: "SpendLedger",
        byte_ledger: "ByteLedger",
        audit: "AuditLog",
        provider: Provider,
        dlp: "DlpHook | None" = None,
        handles: "HandleTable | None" = None,
        now: Callable[[], float] = time.monotonic,
    ) -> None:
        self._config = config
        self._sessions = sessions
        self._spend = spend_ledger
        self._bytes = byte_ledger
        self._audit = audit
        self._provider = provider
        self._dlp = dlp
        # The same table the broker allocates into. Optional, and its absence is a
        # closed gate rather than an open one: a host built without it refuses
        # `context` outright instead of serving it unscoped.
        self._handles = handles
        self._now = now

        self._lock = threading.Lock()
        self._in_flight: dict[int, int] = {}
        self._buckets: dict[int, TokenBucket] = {}
        # CIDs whose dollar ledger is spent. The spend cap is session-terminal
        # (INTERFACES section 7), so once it trips this handler answers nothing
        # further for that session; the session owner tears the VM down on the
        # `session_terminal` flag the error class carries.
        self._halted: set[int] = set()

    # -- public surface ----------------------------------------------------

    def is_halted(self, cid: int) -> bool:
        """True once `cap_spend` has fired for this CID."""
        with self._lock:
            return cid in self._halted

    def handle_request(self, cid: int, request: dict) -> dict:
        """Serve one `LMRequest` dict for the peer at `cid`.

        `cid` is the kernel-supplied vsock peer CID from `accept()`. Identity is
        never read out of `request`: a compromised guest that puts someone else's
        session id in the body gets its own session's caps regardless.
        """
        session = self._authenticate(cid)
        del session  # resolved for auth only; the caps below are CID-keyed.

        if self.is_halted(cid):
            self._audit.record(cid, "lm_refused", code=CapSpendError.code, reason="halted")
            return error_response(CapSpendError.code, "session halted")

        prompts, batched, model, depth = self._parse(cid, request)

        try:
            # Shape only — nothing is resolved until every cap below has passed,
            # so a call that was going to be refused never costs a lookup.
            handle_ids = context_handle_ids(request.get(CONTEXT_FIELD))
            self._check_depth(depth)
            self._check_rate(cid)
        except SandboxError as exc:
            return self._refuse(cid, exc, model=model, depth=depth, n_prompts=len(prompts))

        try:
            self._acquire_slot(cid, len(prompts))
        except SandboxError as exc:
            return self._refuse(cid, exc, model=model, depth=depth, n_prompts=len(prompts))

        try:
            return self._serve(cid, prompts, batched, model, depth, handle_ids)
        finally:
            self._release_slot(cid)

    # -- stages ------------------------------------------------------------

    def _authenticate(self, cid: int) -> object:
        """Resolve the CID to a session, or drop the connection.

        `AuthError` is connection-terminal: it is raised rather than returned, so
        an unidentified peer gets no response body to learn from.
        """
        try:
            return self._sessions.session_for(cid)
        except AuthError:
            self._audit.record(cid, "lm_auth_denied", code=AuthError.code, attempted_cid=cid)
            raise

    def _parse(self, cid: int, request: dict) -> tuple[list[PromptValue], bool, str | None, int]:
        """Validate the body into `(prompts, batched, model, depth)`.

        Fail-closed: an unparseable body is a `FrameError`, which drops the
        connection. INTERFACES section 7 requires an ambiguous request be denied
        and audited rather than best-effort executed, and a body that does not
        shape into an `LMRequest` is exactly that.

        The Trellis `context` field is deliberately not read here. It is not part
        of the rlms shape this method validates, and its refusals are answerable
        (`denied`) rather than connection-terminal — a model that passes the wrong
        thing should get a traceback to debug against, not a dropped socket.
        """
        if not isinstance(request, dict):
            self._audit.record(cid, "lm_malformed", code=FrameError.code, reason="not an object")
            raise FrameError("LMRequest must be a JSON object")

        model = request.get("model")
        if model is not None and not isinstance(model, str):
            self._audit.record(cid, "lm_malformed", code=FrameError.code, reason="model type")
            raise FrameError("LMRequest.model must be a string or null")

        raw_depth = request.get("depth", 0)
        # rlms' own `from_dict` defaults a missing depth to -1 with a TODO to
        # raise instead. The ceiling here is host-derived either way, so a
        # missing depth is read as the root depth and still ceiling-checked.
        if isinstance(raw_depth, bool) or not isinstance(raw_depth, int):
            self._audit.record(cid, "lm_malformed", code=FrameError.code, reason="depth type")
            raise FrameError("LMRequest.depth must be an integer")
        depth = raw_depth

        raw_prompts = request.get("prompts")
        if raw_prompts is not None:
            if not isinstance(raw_prompts, list) or not raw_prompts:
                self._audit.record(
                    cid, "lm_malformed", code=FrameError.code, reason="prompts type"
                )
                raise FrameError("LMRequest.prompts must be a non-empty list")
            for item in raw_prompts:
                if not isinstance(item, (str, dict)):
                    self._audit.record(
                        cid, "lm_malformed", code=FrameError.code, reason="prompt item type"
                    )
                    raise FrameError("each prompt must be a string or object")
            return list(raw_prompts), True, model, depth

        raw_prompt = request.get("prompt")
        if not isinstance(raw_prompt, (str, dict)):
            self._audit.record(cid, "lm_malformed", code=FrameError.code, reason="missing prompt")
            raise FrameError("LMRequest carries neither 'prompt' nor 'prompts'")
        return [raw_prompt], False, model, depth

    def _check_depth(self, depth: int) -> None:
        """Enforce the host-derived depth ceiling.

        The guest *reports* its depth; the ceiling is the host's. What this
        check enforces is that a request declaring a depth above the ceiling is
        refused. It cannot catch a guest that under-reports — nothing applied to
        a self-reported number can — which is why the fan-out is flat by
        construction in the backend (`max_depth = 1`, REPL_SANDBOX_SPEC.md
        section 1 (Summary sheet)) rather than by trusting this field.
        """
        ceiling = self._config.lm_caps.depth_ceiling
        if depth < 0:
            raise DepthCeilingError(f"depth {depth} is negative")
        if depth > ceiling:
            raise DepthCeilingError(f"depth {depth} exceeds ceiling {ceiling}")

    def _check_rate(self, cid: int) -> None:
        with self._lock:
            bucket = self._buckets.get(cid)
            if bucket is None:
                bucket = TokenBucket(self._config.lm_caps.requests_per_second, self._now)
                self._buckets[cid] = bucket
        retry_after = bucket.take()
        if retry_after is not None:
            raise CapRateError(
                f"retry_after_s={retry_after:.3f}", retry_after_s=retry_after
            )

    def _acquire_slot(self, cid: int, n_prompts: int) -> None:
        """Take one in-flight slot, and bound batch width by the same ceiling.

        A batch is one request but N provider calls, so the width is capped as
        well as the count. Without this a single `llm_query_batched` with a
        thousand prompts would clear a concurrency cap of four.
        """
        limit = self._config.lm_caps.max_in_flight
        if n_prompts > limit:
            raise CapConcurrencyError(f"batch of {n_prompts} exceeds max_in_flight {limit}")
        with self._lock:
            current = self._in_flight.get(cid, 0)
            if current >= limit:
                raise CapConcurrencyError(f"{current} in flight, ceiling {limit}")
            self._in_flight[cid] = current + 1

    def _release_slot(self, cid: int) -> None:
        with self._lock:
            remaining = self._in_flight.get(cid, 1) - 1
            if remaining > 0:
                self._in_flight[cid] = remaining
            else:
                self._in_flight.pop(cid, None)

    def _serve(
        self,
        cid: int,
        prompts: list[PromptValue],
        batched: bool,
        model: str | None,
        depth: int,
        handle_ids: Sequence[str] = (),
    ) -> dict:
        digests = [prompt_digest(p) for p in prompts]
        raw_bytes = sum(prompt_bytes(p) for p in prompts)

        try:
            # The ledger is checked for exhaustion before any money is spent. A
            # ledger that treats a zero charge as a no-op still hard-stops on the
            # real charge below; both paths halt the session. It is also the last
            # cap ahead of resolution, so a spent session never resolves a handle.
            self._spend.charge(cid, 0.0)
        except CapSpendError as exc:
            return self._halt(cid, exc, model=model, depth=depth, n_prompts=len(prompts))

        try:
            outbound, findings, outbound_bytes, block = self._meter_outbound(
                cid, prompts, handle_ids
            )
        except SandboxError as exc:
            return self._refuse(
                cid,
                exc,
                model=model,
                depth=depth,
                n_prompts=len(prompts),
                prompt_bytes=raw_bytes,
                prompt_digests=digests,
            )

        started = time.perf_counter()
        try:
            if batched:
                completions, usd = self._provider.complete_batched(list(outbound), model)
            else:
                completion, usd = self._provider.complete(outbound[0], model)
                completions = [completion]
        except SandboxError as exc:
            return self._refuse(
                cid, exc, model=model, depth=depth, n_prompts=len(prompts)
            )
        except Exception as exc:  # provider/SDK failure, surfaced as `upstream`
            return self._refuse(
                cid,
                UpstreamError(self._sanitise(f"{type(exc).__name__}: {exc}")),
                model=model,
                depth=depth,
                n_prompts=len(prompts),
            )
        elapsed = time.perf_counter() - started

        if not isinstance(completions, list) or not all(isinstance(c, dict) for c in completions):
            return self._refuse(
                cid,
                UpstreamError("provider returned a malformed completion"),
                model=model,
                depth=depth,
                n_prompts=len(prompts),
            )

        # The dollar charge lands whether or not the response is deliverable: the
        # money is already spent, and a ledger that forgets a spent call is not a
        # cap.
        try:
            self._spend.charge(cid, float(usd))
        except CapSpendError as exc:
            return self._halt(
                cid, exc, model=model, depth=depth, n_prompts=len(prompts), usd=float(usd)
            )

        if block:
            try:
                completions = self._withhold_context_echo(completions, prompts, block)
            except SandboxError as exc:
                return self._refuse(
                    cid,
                    exc,
                    model=model,
                    depth=depth,
                    n_prompts=len(prompts),
                    usd=float(usd),
                    outbound_bytes=outbound_bytes,
                )

        try:
            inbound_bytes = self._meter_inbound(cid, completions)
        except SandboxError as exc:
            return self._refuse(
                cid,
                exc,
                model=model,
                depth=depth,
                n_prompts=len(prompts),
                usd=float(usd),
                outbound_bytes=outbound_bytes,
            )

        self._audit.record(
            cid,
            "lm_completed",
            model=model,
            depth=depth,
            batched=batched,
            n_prompts=len(prompts),
            prompt_digests=digests,
            outbound_bytes=outbound_bytes,
            inbound_bytes=inbound_bytes,
            # Host-side only. The count and size of the resolved referents are
            # exactly what the wire refuses to tell the guest, which is why the
            # audit log is where they belong.
            context_handles=len(handle_ids),
            context_bytes=len(block.encode("utf-8")),
            usd=float(usd),
            elapsed_s=elapsed,
            dlp_findings=findings_to_audit(findings),
        )
        return batched_response(completions) if batched else single_response(completions[0])

    # -- metering ----------------------------------------------------------

    def _meter_outbound(
        self, cid: int, prompts: Sequence[PromptValue], handle_ids: Sequence[str] = ()
    ) -> tuple[list[PromptValue], list[DlpFinding], int, str]:
        """Resolve, splice, DLP-scan, and charge — before any provider call.

        Order is the design. The per-call ceiling is checked against the raw
        prompt *first*, so a gigabyte of attacker text is refused rather than
        scanned, and — since this is the last gate before resolution — a request
        already over cap never costs a handle lookup or a referent read. Then the
        context resolves, all of it or none of it. Then DLP runs over the spliced
        text, so resolved referents are scanned exactly like any other outbound
        prompt. Then one charge lands, for what will actually leave.

        **Metered at full resolved size, not at the token's size.** The referent is
        what crosses to the provider, so the ledger is charged the spliced total; a
        16-byte handle that resolves to 40 KB costs 40 KB. In a batched call the
        block is spliced into every prompt and every copy is charged, because every
        copy leaves.

        None of this is the boundary. The boundary is that the guest never held
        the bytes (REPL_SANDBOX_DATA_MODEL.md section 6); these bound the rate of
        the residual.
        """
        per_call = self._config.byte_caps.outbound_per_call
        raw_total = sum(prompt_bytes(p) for p in prompts)
        if raw_total > per_call:
            # The count is safe to report: these are the guest's own bytes.
            raise CapBytesError(f"outbound {raw_total} bytes exceeds per-call cap {per_call}")

        block = ""
        staged: list[PromptValue] = list(prompts)
        if handle_ids:
            block = self._resolve_context(cid, handle_ids)
            staged = [splice_context(prompt, block) for prompt in prompts]

        findings: list[DlpFinding] = []
        outbound: list[PromptValue] = staged
        if self._dlp is not None:
            rewritten: list[PromptValue] = []
            for prompt in staged:
                new_prompt, found = _scan_prompt(self._dlp, prompt)
                rewritten.append(new_prompt)
                findings.extend(found)
            outbound = rewritten
            if findings:
                self._audit.record(
                    cid, "lm_dlp", n_prompts=len(prompts), findings=findings_to_audit(findings)
                )
            if has_denial(findings):
                # Nothing is dispatched and nothing is charged: the call did not
                # happen.
                raise DeniedError("outbound content denied by policy")

        dispatched = sum(prompt_bytes(p) for p in outbound)
        if block and dispatched > per_call:
            # Checked here so the *ledger's* own message — which names the byte
            # count — is never the thing that answers the guest. Deliberately
            # size-free: the resolved size is host content. The native path is not
            # re-checked, so a request with no context behaves exactly as before.
            raise CapBytesError("outbound prompt with resolved context exceeds the per-call cap")
        try:
            self._bytes.charge_outbound(cid, dispatched)
        except CapBytesError:
            if block:
                raise CapBytesError(
                    "the outbound ledger cannot admit this call with resolved context"
                ) from None
            raise
        return outbound, findings, dispatched, block

    def _resolve_context(self, cid: int, handle_ids: Sequence[str]) -> str:
        """Resolve every named handle for this CID, or refuse the whole call.

        **CID scoping is the property.** `HandleTable.resolve` is keyed `(cid, id)`,
        so a token minted for another session is simply absent and takes the same
        branch, with the same message, as a token that never existed. This method
        adds nothing to that and takes nothing away from it: it passes the CID the
        kernel supplied at `accept()`, never anything read from the request body.

        **All or nothing.** The first failure raises, before any splice and before
        any dispatch, so a partially-resolved prompt is never sent. There is no
        best-effort branch to fall into.
        """
        if self._handles is None:
            raise DeniedError("this host serves no handle table")
        rendered = [
            render_referent(getattr(self._handles.resolve(cid, handle_id), "referent", None))
            for handle_id in handle_ids
        ]
        return context_block(rendered)

    def _withhold_context_echo(
        self, completions: list[dict], originals: Sequence[PromptValue], block: str
    ) -> list[dict]:
        """Put the guest's own prompt back where the provider echoed the spliced one.

        rlms' completion shape carries the prompt back — `RLMChatCompletion`
        declares the field and `ChatCompletionsProvider` fills it — so an
        un-rewritten echo would hand the resolved referent straight to the guest
        through a field that is not the completion. The guest gets back exactly the
        prompt it sent, which it already had.

        `response` is left alone on purpose. Whatever the sub-LLM chose to write
        *is* the bounded completion, and that is the metered inbound residual the
        design admits (DATA_MODEL section 6). Every other field is checked for the
        block and the whole completion is withheld if one carries it, so a provider
        that stashes the prompt under a name this method does not know about fails
        closed rather than quietly.
        """
        restored: list[dict] = []
        for index, completion in enumerate(completions):
            copy = dict(completion)
            if "prompt" in copy:
                if index < len(originals):
                    copy["prompt"] = originals[index]
                else:
                    copy.pop("prompt")
            restored.append(copy)

        for copy in restored:
            residue = {key: value for key, value in copy.items() if key != "response"}
            if _carries(residue, block):
                raise UpstreamError("the provider echoed resolved context")
        return restored

    def _meter_inbound(self, cid: int, completions: Sequence[dict]) -> int:
        """Charge the inbound ledger for returned completion content.

        The completion return is a content crossing into the guest
        (REPL_SANDBOX_DATA_MODEL.md section 6, INBOUND row), so it is metered
        like any other. An over-cap return is refused rather than truncated: a
        silently shortened completion is a wrong answer wearing a right one's
        shape.
        """
        total = sum(completion_content_bytes(c) for c in completions)
        per_call = self._config.byte_caps.inbound_per_call
        if total > per_call:
            raise CapBytesError(f"inbound {total} bytes exceeds per-call cap {per_call}")
        self._bytes.charge_inbound(cid, total)
        return total

    # -- refusal bookkeeping ----------------------------------------------

    def _refuse(self, cid: int, exc: SandboxError, **fields: Any) -> dict:
        detail = exc.message if exc.message != exc.code else None
        if isinstance(exc, DeniedError):
            # The rule that fired is audited host-side, not named on the wire:
            # telling the guest which pattern caught it is free tuning feedback.
            detail = None
        self._audit.record(cid, "lm_refused", code=exc.code, detail=exc.message, **fields)
        return error_response(exc.code, detail)

    def _halt(self, cid: int, exc: CapSpendError, **fields: Any) -> dict:
        """Record the spend hard-stop and refuse everything after it.

        `cap_spend` is session-terminal (INTERFACES section 7). What this handler
        can enforce by itself is that it serves this CID no further; tearing the
        microVM down is the session owner's job, cued by `is_halted()` or by the
        `session_terminal` flag on the error class.
        """
        with self._lock:
            self._halted.add(cid)
        self._audit.record(cid, "lm_session_halted", code=exc.code, detail=exc.message, **fields)
        return error_response(exc.code, "session halted")

    def _sanitise(self, message: str) -> str:
        """Bound and scrub a provider error before it is echoed.

        Hygiene, not a control. The structural reason no key appears here is that
        this handler never receives one — the key lives inside the `Provider`.
        The DLP pass is a second look at text this handler did not author, and
        the truncation keeps a hostile upstream from writing an essay into the
        guest's stderr.
        """
        message = message[:512]
        if self._dlp is not None:
            message, _ = self._dlp.apply(message)
        return message


# ---------------------------------------------------------------------------
# Real provider — constructed only by the host driver, never by tests
# ---------------------------------------------------------------------------


class ChatCompletionsProvider:
    """`Provider` over an OpenAI-shaped chat-completions client.

    The client is injected rather than constructed here, so this module imports
    no provider SDK and this class can be exercised against a stub. The key is
    inside the client; this object never names it.

    Prices are required arguments with no defaults. A provider that reported a
    plausible-looking 0.0 would leave the dollar ledger technically present and
    functionally absent, which is the exact shape of a documented bound with no
    engine behind it.
    """

    def __init__(
        self,
        client: Any,
        default_model: str,
        usd_per_1k_input: float,
        usd_per_1k_output: float,
    ) -> None:
        self._client = client
        self._default_model = default_model
        self._in_price = float(usd_per_1k_input)
        self._out_price = float(usd_per_1k_output)

    def _messages(self, prompt: PromptValue) -> list[dict]:
        if isinstance(prompt, dict) and isinstance(prompt.get("messages"), list):
            return list(prompt["messages"])
        text = prompt if isinstance(prompt, str) else json.dumps(prompt, ensure_ascii=False)
        return [{"role": "user", "content": text}]

    def _one(self, prompt: PromptValue, model: str | None) -> tuple[dict, float]:
        chosen = model or self._default_model
        started = time.perf_counter()
        raw = self._client.chat.completions.create(
            model=chosen, messages=self._messages(prompt)
        )
        elapsed = time.perf_counter() - started
        text = raw.choices[0].message.content or ""
        usage = getattr(raw, "usage", None)
        prompt_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
        completion_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
        usd = (prompt_tokens / 1000.0) * self._in_price + (
            completion_tokens / 1000.0
        ) * self._out_price
        completion = {
            "root_model": chosen,
            "prompt": prompt,
            "response": text,
            # Shaped for `rlm.core.types.UsageSummary.from_dict`, which is what
            # the guest stub parses this back into.
            "usage_summary": {
                "model_usage_summaries": {
                    chosen: {
                        "total_calls": 1,
                        "total_input_tokens": prompt_tokens,
                        "total_output_tokens": completion_tokens,
                        "total_cost": usd,
                    }
                },
                "total_cost": usd,
            },
            "execution_time": elapsed,
        }
        return completion, usd

    def complete(self, prompt: PromptValue, model: str | None) -> tuple[dict, float]:
        return self._one(prompt, model)

    def complete_batched(
        self, prompts: list[PromptValue], model: str | None
    ) -> tuple[list[dict], float]:
        """Serial fan-out.

        Batch width is already bounded by the handler's in-flight ceiling before
        this is reached, and the flat `max_depth = 1` fan-out means a batch is a
        handful of calls, not a swarm. Concurrency here would add a second,
        unaudited parallelism budget beside the host ceiling.
        """
        completions: list[dict] = []
        total = 0.0
        for prompt in prompts:
            completion, usd = self._one(prompt, model)
            completions.append(completion)
            total += usd
        return completions, total


def openai_chat_provider_from_env(
    *,
    default_model: str,
    usd_per_1k_input: float,
    usd_per_1k_output: float,
    env_var: str = "TRELLIS_LM_API_KEY",
    base_url: str | None = None,
) -> ChatCompletionsProvider:
    """Build the real provider from a host-side environment variable.

    Called by the trusted host driver only. Tests never call it: it reads a key
    and constructs a network client, and neither belongs in a unit test. The
    import is local so this module has no import-time SDK dependency and no
    import-time key read.

    The key is read here, handed to the client, and never stored anywhere this
    process logs, audits, or serialises.
    """
    key = os.environ.get(env_var)
    if not key:
        raise RuntimeError(f"{env_var} is not set; the LM handler has no provider credential")
    from openai import OpenAI  # local import: never at module scope

    client = OpenAI(api_key=key, base_url=base_url) if base_url else OpenAI(api_key=key)
    return ChatCompletionsProvider(
        client=client,
        default_model=default_model,
        usd_per_1k_input=usd_per_1k_input,
        usd_per_1k_output=usd_per_1k_output,
    )


__all__ = [
    "CONTEXT_CLOSE",
    "CONTEXT_FIELD",
    "CONTEXT_OPEN",
    "MAX_CONTEXT_HANDLES",
    "ChatCompletionsProvider",
    "LMHandler",
    "Provider",
    "TokenBucket",
    "batched_response",
    "completion_content_bytes",
    "context_block",
    "context_handle_ids",
    "error_code_of",
    "error_response",
    "openai_chat_provider_from_env",
    "prompt_bytes",
    "prompt_digest",
    "render_referent",
    "single_response",
    "splice_context",
]
