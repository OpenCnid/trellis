# Trellis REPL Sandbox — rlms Source Conformance (S1)

**Status: FINDINGS — read 2026-07-22 against the installed `rlms==0.1.3`; the contract is now
pinned by an executing test.** This record closes
[REPL_SANDBOX_BUILD_PLAN.md §5.1 (S1 — Close the source-reads)](REPL_SANDBOX_BUILD_PLAN.md) and
the three items of
[REPL_SANDBOX_INTERFACES.md §9 (Open encoding questions)](REPL_SANDBOX_INTERFACES.md). The
enforcing surface is `src/repl_sandbox/tests/test_rlms_conformance.py` — 12 tests, zero-paid, no
model. Every claim carries the file and line it was read from, and every claim the test can
execute, the test executes.

Source root: `C:\Users\Darian\AppData\Roaming\Python\Python313\site-packages\rlm\` (distribution
`rlms`, import name `rlm`); line numbers are that tree at `0.1.3`. Where a record and the source
disagree the **source wins** for the assertion and the disagreement is listed in §4 — the records
were not edited to match.

---

## 1. What the test pins

| # | Claim | Source |
|---|---|---|
| 0 | `importlib.metadata.version("rlms") == "0.1.3"` — fails first if the environment moves ([INTERFACES §8 (Versioning model)](REPL_SANDBOX_INTERFACES.md)) | — |
| 1 | `IsolatedEnv(BaseEnv, ABC)`, abstract, `__abstractmethods__ == {setup, load_context, execute_code}`; `BaseEnv.__init__(self, persistent=False, depth=1, max_concurrent_subcalls=4, **kwargs)` vs `IsolatedEnv.__init__(self, persistent=False, **kwargs)` — `depth` reaches it only via `**kwargs` | `environments/base_env.py:216-222, 237-256` |
| 2 | `REPLResult.__init__(stdout, stderr, locals, execution_time=None, rlm_calls=None, final_answer=None)`; instance attrs carry `rlm_calls`, while the dataclass field list still names `llm_calls` and no such attribute exists | `core/types.py:160-183` |
| 3 | `RESERVED_TOOL_NAMES` is a `frozenset` of exactly the eight recorded names | `environments/base_env.py:13-24` |
| 4 | framing = `struct.pack(">I", len(payload))` + UTF-8 JSON, no length ceiling on read; and `repl_sandbox.frame.encode_frame` bytes are accepted unchanged by rlms' `socket_recv` (and the reverse) over a real connected socket pair | `core/comms_utils.py:146-176` + test |
| 5 | `LMRequest` fields `prompt, prompts, model, depth` (`depth` default `0`, `from_dict` default `-1`); `LMResponse` fields `error, chat_completion, chat_completions`, `to_dict` always emitting all three keys | `core/comms_utils.py:21-138` |
| 6 | `socket_request` opens `socket.AF_INET` and no other family appears in the module; `EnvironmentType` is a closed seven-member `Literal` with no `kata` | `core/comms_utils.py:192`, `core/types.py:15` |
| 7 | `SupportsPersistence` is `@runtime_checkable`, five members, index-returning signatures | `environments/base_env.py:282-388` |

Run: `python -m pytest src/repl_sandbox/tests/test_rlms_conformance.py` → `12 passed`.

---

## 2. Open encoding questions — closed

### 2.1 `LMHandler` bind host with `port=0` — CLOSED, loopback on every path

| Question | Answer | Evidence |
|---|---|---|
| Does `port=0` ever bind `0.0.0.0`? | **No.** The host is a constructor default of `"127.0.0.1"` and is stored verbatim; the only construction site in the package passes no `host`. | `core/lm_handler.py:153-164`, `core/rlm.py:241` |
| Is the auto-assigned port host-discoverable? | **Yes** — the `.address`-shaped property [INTERFACES §9 (Open encoding questions)](REPL_SANDBOX_INTERFACES.md) asked for. | `core/lm_handler.py:193-203` |

```python
# core/lm_handler.py:156-164
        host: str = "127.0.0.1",
        port: int = 0,  # auto-assign available port
        ...
        self.host = host

# core/lm_handler.py:193-203
    @property
    def port(self) -> int:          # docstring elided
        if self._server:
            return self._server.server_address[1]
        return self._port

    @property
    def address(self) -> tuple[str, int]:
        return (self.host, self.port)
```

`start()` binds `ThreadingLMServer((self.host, self._port), ...)` and returns `self.address`
(`core/lm_handler.py:205-216`) — the port is read off the bound server, not guessed. The single
construction site passes no `host` (`core/rlm.py:241`), so loopback holds for every rlms run.

**What it forces in the build.** Option A (guest-side forwarder,
[INTERFACES §3.3 (Bridge options — A vs B)](REPL_SANDBOX_INTERFACES.md)) is viable unchanged: the
host shim reads `handler.address` after `start()` and needs no patch. Two caveats:

- The handler is **unauthenticated** and sets `allow_reuse_address = True`
  (`core/lm_handler.py:138-142`) — any local process reaching the port is served. Loopback is
  host scoping, not an auth control; the vsock CID stays the identity
  ([INTERFACES §1 (Seam map)](REPL_SANDBOX_INTERFACES.md)).
- `LMHandler` is the only loopback-clean binder in the package. rlms' other isolated backends run
  in-guest brokers that bind wildcard (`environments/modal_repl.py:105`, `prime_repl.py:104`,
  `daytona_repl.py:146`, `e2b_repl.py:95`) and `docker_repl.py:514` binds `("0.0.0.0", 0)` on the
  **host**. None is on the Kata path; none may be reused as a pattern.

### 2.2 `REPLResult.locals` marshalling — CLOSED, reprs at `to_dict` time only

| Question | Answer | Evidence |
|---|---|---|
| Does `locals` cross as reprs/JSON-safe values or via pickle? | **`_serialize_value` is repr/JSON-safe and pickles nothing** — no `pickle`/`dill` import exists in `core/types.py`. | `core/types.py:18-34` |
| Does the value actually arrive marshalled? | **No — not in the object.** `LocalREPL.execute_code` returns `locals=self.locals.copy()`: **live Python objects**. Marshalling happens only inside `REPLResult.to_dict()`. | `environments/local_repl.py:576-583`, `core/types.py:188-196` |

```python
# core/types.py:18-34
def _serialize_value(value: Any) -> Any:
    """Convert a value to a JSON-serializable representation."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, ModuleType):
        return f"<module '{value.__name__}'>"
    if isinstance(value, (list, tuple)):
        return [_serialize_value(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _serialize_value(v) for k, v in value.items()}
    if callable(value):
        return f"<{type(value).__name__} '{getattr(value, '__name__', repr(value))}'>"
    # Try to convert to string for other types
    try:
        return repr(value)
    except Exception:
        return f"<{type(value).__name__}>"
```

**What it forces in the build.** The backend **must interpose a marshaller** — because of the
second row, not the first. rlms does not pickle, but `LocalREPL` hands back the live namespace and
serialises only if someone calls `to_dict()`. A `KataREPL` mimicking `LocalREPL` literally would
return live objects across the seam, which
[INTERFACES §2 (Backend contract) — Marshalling rule](REPL_SANDBOX_INTERFACES.md) forbids. The
guest supervisor therefore marshals `_serialize_value`-style **in the guest, before the frame is
written**; host-side `REPLResult.locals` holds reprs only. Two consequences:

- `_serialize_value` recurses with **no depth or width bound** (`core/types.py:24-27`) — a deep or
  self-referential structure is a guest-side stack/CPU hazard. The guest marshaller must bound
  both; `repl_sandbox.frame.MAX_JSON_DEPTH` (64) only rejects the payload after it is built.
- Nothing in `core/rlm.py` reads `REPLResult.locals` (no match in that file); the only consumer is
  `CodeBlock.to_dict()` (`core/types.py:204-205`) into the logger. Interposing costs no driver
  compatibility.

### 2.3 `MAX_FRAME_LEN` — evidence for the owner decision (NOT closed here)

This is an owner ratification, not a source read. The evidence:

| Bound | Value | Source |
|---|---|---|
| What the wire format admits | `2**32 - 1` = 4 GiB − 1 (`>I` prefix) | `core/comms_utils.py:152, 168` |
| What rlms enforces on read | **nothing** — `socket_recv` unpacks the length and loops until it has that many bytes | `core/comms_utils.py:164-176` |
| Largest legitimate **request** frame | one `LMRequest` — a model-authored prompt, or a `prompts` list; unbounded in rlms, bounded by our `ByteLedgerCaps.outbound_per_call` (256 KiB) times a batch | `core/comms_utils.py:38-48` |
| Largest legitimate **response** frame | one `LMResponse` carrying `RLMChatCompletion.metadata` = `{"run_metadata": ..., "iterations": [...]}` — the child RLM's **entire trajectory**: every iteration, every code block, and every `REPLResult.to_dict()` with serialised `locals` | `core/types.py:130-145`, `logger/rlm_logger.py:80-87`, `core/rlm.py:452, 489`, sent at `environments/ipython_repl.py:210` |
| Largest legitimate **broker** frame | a DB result, already capped host-side at `BrokerCaps.max_result_bytes` = 8 MiB | `src/repl_sandbox/config.py:124` |

The finding that should drive the number: **the trajectory-metadata frame is the only unbounded
one**, and it is unbounded by construction — it grows with the child run's iteration count, not
with any single value. It is attached only when a child logger is configured
(`core/rlm.py:452, 489`; `core/rlm.py:823`). Two evidence-backed ways to ratify:

1. Run the sub-call path **without a child logger**, removing `metadata` from the wire. The largest
   remaining legitimate frame is then the broker's 8 MiB result plus envelope, and the existing
   `DEFAULT_MAX_FRAME_LEN` of 16 MiB (`src/repl_sandbox/config.py:60`) is 2× that — ratifiable.
2. Keep child trajectories and accept that no static cap is derivable; the frame must then be
   chunked or handle-addressed rather than sized.

Recommendation: **(1)**, ratify 16 MiB. Either way the cap is enforced before allocation by
`repl_sandbox/frame.py:142-143`, which is already built and tested.

## 3. Load-bearing hazards found while reading

1. **`repr()` and `==` on a `REPLResult` raise `AttributeError`.** `@dataclass` generates
   `__repr__`/`__eq__` over the annotated field `llm_calls` (`core/types.py:166`) while the
   hand-written `__init__` assigns `self.rlm_calls` (`core/types.py:182`), and dataclass leaves an
   explicit `__init__` in place. `__str__` is hand-written and works. **The backend must never
   `%r`-log or `==`-compare a `REPLResult`**, audit lines and assertion messages included.
2. **A frame that omits `depth` yields `depth == -1`**, not `0` (`core/comms_utils.py:57`, whose
   own comment reads `# TODO: Default should throw an error`). `-1` matches no branch in
   `LMHandler.get_client` (`core/lm_handler.py:176-191`) and falls through to the default client.
   The host depth ceiling ([INTERFACES §4 (LM-handler RPC surface)](REPL_SANDBOX_INTERFACES.md))
   must treat *missing* as its own rejected case, not trust either default.
3. **`LMResponse().success` is `True` while `LMResponse().to_dict()["error"]` is set**
   (`core/comms_utils.py:73-75, 102-106`). Never branch on `.success` for a response not built by
   one of the three classmethod constructors.
4. **`isinstance(env, SupportsPersistence)` is structural only** — the five names must exist;
   signatures and return types are unchecked (`environments/base_env.py:282-388`).

## 4. Records contradicted by the source

Listed, not fixed — the records are unedited per the S1 scope.

| Record | Record says | Source says |
|---|---|---|
| [INTERFACES §2 (Backend contract)](REPL_SANDBOX_INTERFACES.md), sketch line `def __init__(self, persistent=False, depth=1, max_concurrent_subcalls=4, **kwargs)` marked *(signature source-confirmed)* | that is `IsolatedEnv.__init__` | that is **`BaseEnv.__init__`** (`environments/base_env.py:216-218`). `IsolatedEnv.__init__` is `(self, persistent=False, **kwargs)` (`:243`). A `KataREPL` may accept `depth=` by **keyword** only; `KataREPL(False, 1)` raises `TypeError`. |
| [INTERFACES §2 (Backend contract)](REPL_SANDBOX_INTERFACES.md), `add_context(payload) -> None` / `add_history(entry) -> None` | one argument, returns `None` | `add_context(context_payload, context_index=None) -> int` and `add_history(message_history, history_index=None) -> int` (`environments/base_env.py:326-328, 356-358`). Both take an optional index and return the index used. `add_history` also requires a **deep copy** of the caller's list (`:370-371`). |
| [INTERFACES §2 (Backend contract)](REPL_SANDBOX_INTERFACES.md) / [SPEC §2 (Backend interface)](REPL_SANDBOX_SPEC.md) / [DATA_MODEL §8 (`execute_code` result marshaling)](REPL_SANDBOX_DATA_MODEL.md): `REPLResult` fields `... rlm_calls, final_answer` *(source-confirmed)* | a single field list | correct for the **object** and for `to_dict()`, but the **dataclass field list** is `... execution_time, llm_calls, final_answer` (`core/types.py:166`). Both names are real, in different places; see §3 item 1. |
| [INTERFACES §2 (Backend contract)](REPL_SANDBOX_INTERFACES.md): "`locals` crosses as value-reprs … never live objects" | reads as rlms behaviour | is the **required Trellis behaviour**. rlms' `LocalREPL` returns live objects (`environments/local_repl.py:579`); reprs appear only in `to_dict()`. See §2.2. |

## 5. Not covered by this pass

- **Tool materialisation in rlms' isolated backends** — the other half of BUILD_PLAN §5.1's
  objective, read only partially. `IPythonREPL` injects custom tools as a **generated code string**
  carrying a `dill.dumps(..., recurse=True).hex()` payload the guest `loads` back
  (`environments/ipython_repl.py:767-819`) — a pattern Trellis cannot adopt, since the guest would
  deserialise host objects. The RPC-proxy-stub alternative
  ([INTERFACES §6 (CapabilityDescriptor lifecycle)](REPL_SANDBOX_INTERFACES.md)) is unaffected, but
  `modal`/`prime`/`daytona`/`e2b` are unread and still owed before `register_capability` is fixed.
- **Kata `docs/design/VSocks.md`** — S1's other read. **Closed on the documentation, July 23,
  2026, and it contradicted these records.** Kata's own design note covers only the native
  vhost-vsock case (host kernel `CONFIG_VHOST_VSOCK`), which is what Kata uses under QEMU. The
  ratified VMM is **Cloud Hypervisor, which implements hybrid vsock**: the host side is an
  `AF_UNIX` socket at `<uds>_<port>`, there is no host `AF_VSOCK` socket, and a Unix-socket
  `accept()` carries **no peer CID** — so the "auth by kernel vsock peer CID" written throughout
  these records is not implementable on the ratified stack. The correction, and what replaces the
  CID, is [INTERFACES §3.1a (Hybrid vsock)](REPL_SANDBOX_INTERFACES.md).
  **Settled on the host 2026-07-23** — and this is the one item in this file that is no longer only a
  read. `npm run repl-sandbox:s3-probe` observed the guest's `AF_VSOCK (2, 5001)` arriving at
  `/run/vc/vm/<sandbox>/clh.sock_5001`, and its `--native-vsock` mode — which binds the host the way
  §3.1 originally specified — was met with `ECONNRESET` at a listener that accepted nothing
  ([BUILD_PLAN §5.3 (S3)](REPL_SANDBOX_BUILD_PLAN.md)). The reading was made before the run and the
  run could have refuted it.
- **Live behaviour.** All of the above is a zero-paid read plus scripted assertions over installed
  bytes. No model ran, no VM booted; the parity test uses a real local socket pair, which is a
  genuine socket but not the vsock seam.

## 6. The S6 equivalence target — stated before the run

[BUILD_PLAN §5.6 (S6)](REPL_SANDBOX_BUILD_PLAN.md) sets the `[R]` gate as "an unedited load →
`execute_code` round-trips with the same observable `REPLResult` shape as `LocalREPL`". That is a
comparison, not yet a threshold. This section fixes the threshold **before the harness exists**,
because a target chosen after the numbers are in is a description of the run
(`.claude/rules/measurement-and-reporting.md` rule 20 — the target comes first).

This comparison sits inside rule 20's carve-out: both arms are shipped artifacts carrying their own
spec, which is functional equivalence, not a new-versus-null baseline.

### 6.1 The predicate

Construct `LocalREPL()` and `KataREPL()` with no LM handler and no custom tools, run the same block
sequence against each, and compare **field by field** — never with `==`, and never `%r`-logged
(§3 item 1). Fields, and the claim admissible on each:

| field | claim | why not more |
|---|---|---|
| `stdout` | byte-equal on every block | the model reads it; nothing about the seam should change it |
| `stderr` | equal after normalising to the final non-empty line | `LocalREPL` emits no traceback (`local_repl.py:571`); the guest emits a full one (`supervisor.py:307`). Byte equality would promote a *deficiency* of the baseline into the spec, and bake host paths and line numbers into an assertion |
| `locals` | key sets equal **after** removing reserved names and load artifacts | `LocalREPL` returns live objects (`local_repl.py:579`); the guest returns reprs, which [§2.2](#22-replresultlocals-marshalling--closed-reprs-at-to_dict-time-only) ratifies. Values cannot be compared across a JSON-only seam without undoing the boundary |
| `final_answer` | equal, with `content` assigned **before** `ready` | the two capture at different moments; see 6.2 item 5 |
| `rlm_calls` | `== []` on both, in a no-LM run only | the guest hard-codes `[]` (`supervisor.py:321`) because the LM channel is host-side and CID-keyed |
| `execution_time` | numeric and positive on both | two clocks on two machines, measuring spans with different start points. Equality would redden every honest run and train a reader to ignore reds |
| `llm_calls` | **not a claim in either direction** | never assigned by any backend; touching it raises |

### 6.2 Clauses predicted FALSE today

A target that everything already satisfies measures nothing. These are read from source and, where
marked *observed*, run against the pinned install on the Windows dev box — **eight of the twelve**,
the rest being guest-side and reachable only from the Kata host. Each is a real divergence S6 must
either close or record as a ratified difference — **the list is the spike's expected yield, not a
defect log against it.**

Read them in one direction only: an *observed* clause states what `LocalREPL` does, which is the
baseline half of the comparison. The guest half of every clause stays unobserved until the launch
path exists, so no clause here claims to have seen `KataREPL` diverge — each says what it will be
compared against, and why byte equality is or is not the admissible claim.

1. **A raising block persists no bindings in `LocalREPL`** — *observed*: after `x = 1; raise
   ValueError`, `'x' in dir()` is `False`, because the namespace copy-back sits inside the `try`
   (`local_repl.py:561`). The guest execs straight into `self._ns`, so `x` survives. **Rebinding
   atomicity is a semantic difference a model would feel.**
2. **`stderr` shape** — *observed*: `LocalREPL` returns exactly `'\nValueError: boom'`, leading
   newline included, no traceback.
3. **`locals` key sets diverge in both directions on the same turn** — *observed*: after
   `load_context({...})` a `LocalREPL` turn returns keys
   `['answer', 'context', 'context_0', 'f', 'json', …]`, and with a string payload
   `['answer', 'context', 'context_0', 'f', …]`. `f` is a *closed* file handle and `json` a live
   module — both artifacts of implementing context loading by executing generated code
   (`local_repl.py:419-436`). The guest skips reserved and scaffold names, so `answer` and `context`
   are absent there. Neither side is a superset of the other, which is why the claim is key sets
   **after** removing reserved names and load artifacts, and never a raw key-set equality.
4. **`answer` starts at a different value** — *observed*: `LocalREPL` binds
   `{'content': '', 'ready': False}`, the shape rlms' own system prompt documents
   (`utils/prompts.py:135`). The guest binds `{}` (`supervisor.py:220`), so `answer['ready']` raises
   `KeyError` on a read the prompt invites.
5. **`final_answer` captures at different moments** — *observed*: `LocalREPL` snapshots `content` the
   instant `ready` flips truthy (`local_repl.py:43`), so setting `ready` **before** `content` yields
   `final_answer == ''` while the reverse order yields the content. The guest reads the namespace
   after the block and would return the content either way. This is why the predicate fixes the
   assignment order rather than asserting on it: matching the baseline under the adversarial order
   would mean reproducing a callback-timing artifact.
6. **`SHOW_VARS` and `rlm_query` do not exist in the guest** — *observed present* in `LocalREPL` as a
   bound method. The registry refuses them by name (`capabilities.py:529`) and `_restore_scaffold`
   removes any reserved name it has no pin for. `rlm_query`'s absence follows from ratified
   `max_depth` 1; **`SHOW_VARS` is not covered by that decision** and the rlms system prompt
   advertises it unconditionally.
7. **`llm_query` returns a dict in the guest, a string in `LocalREPL`** (`local_repl.py:278` vs
   `guest_rpc.py:365`), and fails by raising rather than by returning an `"Error: …"` string.
8. **The `history` alias is never bound** — `SupportsPersistence` requires it and the backend records
   `backend.history_alias_unbound` instead (`kata_repl.py:523`).
9. **`_SAFE_BUILTINS` makes some equivalence unreachable** — *observed*: `eval('1+1')` raises
   `TypeError: 'NoneType' object is not callable` under `LocalREPL`, which nulls `eval`/`exec`/
   `compile`; the guest runs with full builtins. The block set must stay inside `_SAFE_BUILTINS`, and
   that is a **declared scope limit on the PASS line**, not an unstated one.
10. **The driver never calls `setup()`** — `LocalREPL` self-calls it in `__init__`
    (`local_repl.py:194`); `KataREPL` does not, so the first `execute_code` meets `_require_live()`.
11. **A prompt over 256 KiB trips the inbound cap** (`config.py:133`) — which is the normal case for
    the workload RLM exists to serve. `LocalREPL.add_context` has no cap.
12. **`compaction=True` silently does nothing** — *observed*: `LocalREPL` carries
    `append_compaction_entry`; `KataREPL` does not. The driver gates every compaction step on
    `hasattr(environment, "append_compaction_entry")` (five references in `rlm.py`), so a
    compaction-configured run degrades to no compaction with no error and no log line, while the
    system prompt still tells the model its history is in `history` — which is also unbound (item 8).

### 6.3 The self-comparison trap

`repr()` on a `REPLResult` raises (§3 item 1), and so does `==` **between two distinct results** —
*observed*: `AttributeError: 'REPLResult' object has no attribute 'llm_calls'`. But CPython 3.13's
generated dataclass `__eq__` carries an `if self is other: return True` fast path, so `result ==
result` returns `True` without touching a field. **A sanity check written as `assert result ==
result` therefore passes and proves nothing**, while the comparison a harness actually performs
raises. Compare field by field.

---

*Pinned by: `src/repl_sandbox/tests/test_rlms_conformance.py`. Siblings:
[INTERFACES](REPL_SANDBOX_INTERFACES.md) (the contracts this checks) ·
[BUILD_PLAN](REPL_SANDBOX_BUILD_PLAN.md) §5.1 (S1) · [SPEC](REPL_SANDBOX_SPEC.md) §2 (summary
sheet) · [LEARNINGS](REPL_SANDBOX_LEARNINGS.md) §9 (rlms internals worth remembering).*
