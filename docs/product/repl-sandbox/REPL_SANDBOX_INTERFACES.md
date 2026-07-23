# Trellis REPL Sandbox — Interface & Wire Contracts

**Status: DESIGN — build-ready interface contracts for ratified decisions; NOT built.**
This record is the detailed source of truth for every seam of the sandbox: the `IsolatedEnv`
backend contract, the vsock frame protocol + bridge, the LM-handler and DB-broker RPC
surfaces, the CapabilityDescriptor lifecycle, and the error/versioning model. It **expands the
fragments** in [REPL_SANDBOX_SPEC.md §2 (Backend interface)](REPL_SANDBOX_SPEC.md),
[§3 (Sub-LLM wire contract)](REPL_SANDBOX_SPEC.md), and [§4 (Host chokepoint contracts)](REPL_SANDBOX_SPEC.md)
into contracts an implementer can build against; the SPEC summarises and points here. It does
not re-decide the ratified stack ([REPL_SANDBOX_ARCHITECTURE.md §1 (The ratified stack)](REPL_SANDBOX_ARCHITECTURE.md)).
Interface facts marked *(source-confirmed)* were read byte-exact from the pinned `rlms==0.1.3`
install ([REPL_SANDBOX_LEARNINGS.md §9 (rlms internals)](REPL_SANDBOX_LEARNINGS.md)).

**House rule, enforced throughout:** a documented bound with no engine behind it is not a
control. Every auth / cap / denylist / timeout below names its **enforcing surface**.

---

## 0. Scope — what this doc owns, and what it defers

| This doc owns (WIRE + RPC) | Deferred to | It owns (not restated here) |
|---|---|---|
| The `IsolatedEnv` method contract, on-the-wire framing, RPC envelopes, auth/cap/denylist **enforcement points**, descriptor materialise/render, error + versioning model. | [REPL_SANDBOX_DATA_MODEL.md](REPL_SANDBOX_DATA_MODEL.md) | What a **handle** *is* and its slice/address semantics — this doc carries only the opaque token on the wire and the bounded op that moves bytes. |
| | [REPL_SANDBOX_THREAT_MODEL.md](REPL_SANDBOX_THREAT_MODEL.md) | **Why** each auth/cap/denylist exists (the adversary it closes); this doc names the surface, not the rationale. |
| | [REPL_SANDBOX_DOUBT_FILTER.md](REPL_SANDBOX_DOUBT_FILTER.md) | The composed doubt/defeater **seat prompts** (Layers 1–2 of [ARCHITECTURE §3.1 (The exfiltration resolution)](REPL_SANDBOX_ARCHITECTURE.md)); this doc exposes only the DLP/audit *hook* they attach to. |
| | [REPL_SANDBOX_BUILD_PLAN.md](REPL_SANDBOX_BUILD_PLAN.md) | Spike ordering / sequencing; this doc is contract, not schedule. |

**The exfil boundary these contracts must preserve** ([ARCHITECTURE §3.1 (The exfiltration
resolution)](REPL_SANDBOX_ARCHITECTURE.md)): the guest holds **addressable handles, never
secret-bearing payloads**. Every RPC surface below is therefore **handle-first** — payload
bytes become a return value only through the bounded, audited slice path the data model
defines. Content-DLP and byte caps are defense-in-depth on top, **never** the boundary.

## 1. Seam map

Six seams. Ports are `AF_VSOCK` **as the guest sees them**; host CID is `VMADDR_CID_HOST = 2`;
one session identity is anchored per microVM and never read from a frame
([LEARNINGS §7 (Identity: the vsock CID)](REPL_SANDBOX_LEARNINGS.md)). Under the ratified VMM
the *host* side of the three data seams is an `AF_UNIX` socket and that anchor is the socket path
rather than a kernel-assigned CID — §3.1a, which corrects this section as well as §3.1.

| # | Seam | Transport | Framing | Who listens | Auth | § |
|---|---|---|---|---|---|---|
| 1 | rlms driver ↔ `KataREPL` backend | in-process (host) | Python calls | — | trusted (host) | §2 |
| 2 | backend ↔ guest supervisor (exec / load_context / lifecycle) | vsock `CONTROL_PORT` | 4-byte BE len + UTF-8 JSON | **guest** supervisor | guest requires peer CID == 2 (host) | §2, §3 |
| 3 | vsock bridge (rlms loopback-`AF_INET` ↔ host) | vsock `LM_PORT` (host side `AF_UNIX`, §3.1a) | transparent byte pipe of seam-4 frames | host | listener identity at `accept()` (§3.1a) | §3 |
| 4 | guest ↔ LM handler (`llm_query`) | vsock `LM_PORT` (host side `AF_UNIX`, §3.1a) | 4-byte BE len + UTF-8 JSON (`LMRequest`/`LMResponse`) | **host** LM handler | listener identity at `accept()` (§3.1a) | §4 |
| 5 | guest ↔ DB broker (`run_query`/`run_cypher`/`slice`) | vsock `DB_PORT` (host side `AF_UNIX`, §3.1a) | 4-byte BE len + UTF-8 JSON (Trellis envelope `v1`) | **host** broker | listener identity at `accept()` (§3.1a) | §5 |
| 6 | descriptor registration | in-process (host) | `CapabilityDescriptor` | — | trusted host only (never guest) | §6 |

**Asymmetry, deliberate:** on the two host-chokepoint ports (`LM_PORT`, `DB_PORT`) the **host
listens and the guest connects**, so the host gates every call by the identity its listener
reports. On `CONTROL_PORT` the **guest supervisor listens and the trusted host connects**; the
supervisor accepts only the host CID (2), which under every VMM here is what the guest kernel
sees. Seam 1 and seam 6 never cross the boundary — they are host-local Python and carry no wire.

**Where that identity comes from is VMM-specific, and the ratified VMM is the exception** — under
Cloud Hypervisor's hybrid vsock the host side of seams 3–5 is an `AF_UNIX` socket with no peer CID
to read, and identity is the per-sandbox socket path instead (§3.1a). The guest side of every seam
is unchanged.

## 2. Backend contract — `KataREPL(IsolatedEnv)`

Drop-in for the rlms driver: a subclass of `rlms.IsolatedEnv` ("a completely separate machine
from the LM") implementing three methods, plus an optional persistence protocol. *(shape
source-confirmed)*

```python
class KataREPL(IsolatedEnv):
    def __init__(self, persistent=False, depth=1,
                 max_concurrent_subcalls=4, **kwargs): ...
    def setup(self) -> None: ...
    def load_context(self, payload: dict | list | str) -> None: ...
    def execute_code(self, code: str) -> REPLResult: ...
    # optional SupportsPersistence (multi-turn):
    #   update_handler_address((host, port)) -> None
    #   add_context(payload) -> None ; get_context_count() -> int
    #   add_history(entry) -> None   ; get_history_count() -> int
```

**`__init__(persistent, depth, max_concurrent_subcalls, **kwargs)`**
- **Correction, July 22, 2026** ([CONFORMANCE §4](REPL_SANDBOX_CONFORMANCE.md)): that signature is
  **`BaseEnv.__init__`** (`environments/base_env.py:216`), not `IsolatedEnv`'s. `IsolatedEnv.__init__`
  is `(self, persistent=False, **kwargs)` (`:243`), so `depth` and `max_concurrent_subcalls` reach the
  base **by keyword only** — `KataREPL(False, 1)` raises `TypeError`. The line above previously carried
  a *(signature source-confirmed)* marker it had not earned.
- `depth` — pinned **1** (flat fan-out; [ARCHITECTURE §6 (Recursion & multiplicity)](REPL_SANDBOX_ARCHITECTURE.md)).
  The value is advisory to rlms only; the enforced ceiling is host-side. **Enforced by:** the
  LM handler rejects any `LMRequest.depth > 1` (§4); the ceiling is broker-derived, never
  guest-reported.
- `max_concurrent_subcalls` — rlms soft bookkeeping that bounds one batched call's thread
  pool. It is **NOT** a security cap — model code can `import threading` and bypass it
  ([LEARNINGS §9 (rlms internals worth remembering)](REPL_SANDBOX_LEARNINGS.md)). **The real fan-out ceiling is the LM handler's
  CID-keyed concurrency cap (§4).**

**`setup(self) -> None`** — boot/attach the microVM and make the guest reachable. Ordered:
1. Boot (or claim from the warm pool) one Kata microVM on Cloud Hypervisor for this session
   ([ARCHITECTURE §1 (The ratified stack)](REPL_SANDBOX_ARCHITECTURE.md)). **Enforced boundary:** the microVM (KVM).
2. Bring up the three vsock channels (§1). The host binds `session id → session` in the handler
   and broker session tables — this is the identity every later call is keyed by. Under native
   vsock that id is the guest **CID from the first `accept()`**; under the ratified VMM's hybrid
   vsock the host **assigns it when it creates that sandbox's listener socket**, before the guest
   dials (§3.1a). **Enforced by:** the listener, not the frame
   ([LEARNINGS §7 (Identity: the vsock CID)](REPL_SANDBOX_LEARNINGS.md)).
3. Start the guest-side bridge forwarder (Option A, §3.3) **before** any untrusted worker
   process, privilege-dropped per §3.4.
4. Materialise the pre-registered capabilities (`llm_query`, `llm_query_batched`, and each
   granted DB tool) as in-guest proxy stubs (§6). No credential or live client enters the guest.
5. Return only when a control-channel round-trip to the guest supervisor succeeds. On any
   failure, raise; the caller tears the session down (no partially-wired guest is left live).

**`load_context(self, payload) -> None`** — expose the reserved REPL variable `context`.
- Serialised host-side to UTF-8 JSON and delivered to the guest supervisor over `CONTROL_PORT`
  as `{op:"load_context", context:<payload>}`; the supervisor binds it to `context` in the
  worker namespace.
- **Handle discipline:** wherever the data model marks a field as a handle, `payload` carries
  the **opaque handle token, not the resolved bytes** — the guest resolves bounded slices via
  the broker (§5). Semantics: [DATA_MODEL](REPL_SANDBOX_DATA_MODEL.md). **Enforced by:** the
  data-flow boundary ([ARCHITECTURE §3.1 (The exfiltration resolution)](REPL_SANDBOX_ARCHITECTURE.md)) — the backend never
  places secret-bearing payloads in `context`.
- `context` is a reserved name, re-pinned each turn and not overridable by model code.

**`execute_code(self, code) -> REPLResult`** — run one model-authored block, marshal the result.
- Delivered over `CONTROL_PORT` as `{op:"exec", code:<str>, deadline_ms:<int>}`; the guest
  supervisor runs it in the persistent namespace and returns a `REPLResult` frame.
- `REPLResult` fields *(source-confirmed)*: `stdout, stderr, locals, execution_time,
  rlm_calls, final_answer`.
- **Marshalling rule (boundary-preserving):** `locals` crosses as **value-reprs / bytes,
  never live objects** — the seam speaks reprs, so no live socket, client, or credential-
  bearing object can ride back across. Large values return a `spill_handle` the model
  re-slices, not the payload ([RESEARCH §7 (minification / state-slicing)](REPL_SANDBOX_RESEARCH.md)).
  **This is a Trellis requirement the guest supervisor must implement, NOT inherited rlms
  behaviour** — correction, July 22, 2026 ([CONFORMANCE §4](REPL_SANDBOX_CONFORMANCE.md)). rlms'
  `LocalREPL` returns **live objects** (`environments/local_repl.py:579`); reprs appear only inside
  `to_dict()`. Read as an rlms property, this line would license skipping the marshaller and letting
  live objects cross the seam.
- **Output caps:** per-turn `stdout` truncated (~20 KB) driver-side. This is **NOT a boundary**
  — it is DoS/output shaping only ([SPEC §6 (Security invariants) — the "NOT a boundary" row](REPL_SANDBOX_SPEC.md)).
- **Runtime ceilings.** **Enforced by:** in-guest cgroups (pids/mem/cpu, Tier-0) + the host
  watchdog that reaps a wedged or fork-bombed VM ([ARCHITECTURE §4 (Components) — Host watchdog](REPL_SANDBOX_ARCHITECTURE.md));
  never by rlms' own caps.

**Optional `SupportsPersistence` (multi-turn).**
- `update_handler_address((host, port))` — (re)points rlms' `llm_query` client at the LM
  handler address. **It is a host-side backend method; guest code cannot call it.** So the
  `llm_query` destination is set by the trusted driver, never redirected by model code — a
  hostile worker cannot aim the sub-LLM channel at an attacker host. In Option A this address
  is the in-guest loopback the forwarder owns (§3.3); in Option B it is `(2, LM_PORT)`.
- `add_context(payload, context_index=None) -> int` / `get_context_count()` /
  `add_history(message_history, history_index=None) -> int` / `get_history_count()` — accumulate the
  reserved `context` / `history` structures across turns; both are reserved names.
  **Correction, July 22, 2026** ([CONFORMANCE §4](REPL_SANDBOX_CONFORMANCE.md)): this record
  previously gave both as one-argument methods returning `None`. Source says each takes an optional
  index and **returns the index used** (`environments/base_env.py:326`, `:356`); index 0 also binds
  the unversioned alias, the auto-index is the current count, and `add_history` must store a **deep
  copy** because the caller may mutate the list afterwards (`:370`).

**Reserved namespace names (cannot be overridden)** *(source-confirmed)*: `llm_query,
llm_query_batched, rlm_query, rlm_query_batched, SHOW_VARS, answer, context, history`. Re-pinned
each turn by the supervisor so model code cannot shadow the scaffold.

**Driver integration seam.** `EnvironmentType` is a fixed `Literal`
(`local/ipython/docker/modal/prime/daytona/e2b`) with **no "kata" slot** *(source-confirmed)*.
Integrate by **registering a new backend** with the driver's environment registry **or passing
the `KataREPL` instance directly** — do not monkey-patch the `Literal`.

## 3. The vsock bridge (security-critical)

The guest's rlms client speaks loopback `AF_INET` TCP *(hardcoded `socket_request`,
source-confirmed)*; the LM handler lives on the host. The bridge carries that traffic across
the microVM boundary over vsock. It is **new, unbuilt glue** and the single most security-
sensitive component in this document ([SPEC §9 (Open items)](REPL_SANDBOX_SPEC.md); [ARCHITECTURE §4 — vsock
bridge, §7.10](REPL_SANDBOX_ARCHITECTURE.md)).

### 3.1 vsock addressing

- Host-chokepoint ports: **`LM_PORT`** (→ LM handler) and **`DB_PORT`** (→ broker). The host
  **listens** on each; the guest **connects** to `(VMADDR_CID_HOST=2, PORT)`. One connection per
  RPC (matches rlms' connect-per-request client). **Enforced auth surface:** the session identity
  the *listener* supplies at `accept()` — never an id in the payload. What supplies it depends on
  the VMM: see §3.1a, which is a correction to the sentence this bullet used to carry.
- Control port: **`CONTROL_PORT`**, guest supervisor listens, host connects (§1).
- **Never bind the handler to `0.0.0.0`.** vsock has no analogue of an all-interfaces bind;
  choosing vsock (not a forwarded `AF_INET` port) is what forecloses the unauthenticated,
  billable, egress-punching exposure the loopback default warns against ([SPEC §3 (Sub-LLM wire contract)](REPL_SANDBOX_SPEC.md)).

### 3.1a Hybrid vsock — what the ratified VMM actually provides *(corrects §3.1, July 23 2026)*

**Status: HOST-CONFIRMED 2026-07-23**, by `npm run repl-sandbox:s3-probe` on the provisioned AX41
([BUILD_PLAN §5.3 (S3)](REPL_SANDBOX_BUILD_PLAN.md)) — six consecutive passes. It was written from
upstream documentation first and the run could have refuted it; the section is kept in that order
because the falsification is the evidence, not the reading. **What was observed:** the sandbox
directory holds `clh-api.sock`, `clh.sock`, `virtiofsd.sock`; the guest's `AF_VSOCK (2, 5001)` connect
arrives at **`/run/vc/vm/<sandbox>/clh.sock_5001`**; the host→guest `CONNECT` handshake works and the
guest sees **`peer_cid = 2`**, so `require_host_cid` holds unchanged. **And the counter-case:** the
probe's `--native-vsock` mode binds the host on `AF_VSOCK VMADDR_CID_ANY` exactly as §3.1 originally
specified, and the guest is met with `ECONNRESET` while that listener accepts nothing.

This document was written against **native vhost-vsock**, where the host kernel carries an
`AF_VSOCK` socket, the host binds `VMADDR_CID_ANY`, and `accept()` returns the guest's CID. Kata
uses that under QEMU. **The ratified VMM is Cloud Hypervisor, which does not implement it.** Cloud
Hypervisor (like Firecracker) implements **hybrid vsock**, bridging guest `AF_VSOCK` to host
`AF_UNIX`:

| direction | guest side | host side |
|---|---|---|
| guest → host (`LM_PORT`, `DB_PORT`) | `connect(AF_VSOCK, (2, PORT))` — unchanged | the host **listens on `AF_UNIX` at `<uds>_<PORT>`**; the VMM delivers the connection there |
| host → guest (`CONTROL_PORT`) | `bind(AF_VSOCK, (VMADDR_CID_ANY, PORT))` — unchanged | the host dials `<uds>` and writes **`CONNECT <PORT>\n`**; the VMM answers `OK <assigned_port>\n`, and the stream follows on the same connection |

`<uds>` is the VMM's launch-time socket. Under Kata it is `/run/vc/vm/<sandbox_id>/clh.sock` — the
same socket the Kata shim dials its own agent on — inside a root-owned per-sandbox directory.

**Three consequences, of which the second is load-bearing.**

1. **The guest side of every record here is unchanged.** The guest speaks real `AF_VSOCK` to CID 2,
   so the guest-side client, the supervisor's `AF_VSOCK` listen, and `require_host_cid`'s check of
   the peer CID it sees (2, kernel-supplied *in the guest*) all stand as written.
2. **There is no CID at the host `accept()`, because a Unix-socket accept carries none.** The
   sentence "auth is by kernel vsock peer CID from `accept()`" is **not implementable under this
   VMM**. What replaces it is narrower and still sufficient: a connection arriving on `<uds>_<PORT>`
   was put there by the one VMM process that owns `<uds>`, so it came from that sandbox's guest and
   no other. **Identity is bound to the socket path**, which the host chose when it created the
   listener for that sandbox — a *host-assigned* session id rather than a kernel-read one
   (`transport.HybridVsockListener`). The cross-session property the design depends on — session A
   cannot present as session B — is preserved; its **enforcing surface** is now
   *the per-sandbox socket path, plus the mode of the VMM's directory holding it*, and every place
   that said "CID from `accept()`" should be read as "the session id the listener was constructed
   with." Anything host-side able to open that path is inside the host trust domain already, so the
   residual is unchanged.
3. **Two operational rules follow.** One listener per sandbox per port, created before the guest
   dials (a connection to a path with no listener is refused by the VMM); and a stale socket node
   may be unlinked **only after** proving nothing is listening on it — unlinking a live one silently
   hands one sandbox's guest another session's caps, which is why `HybridVsockListener` probes the
   path before it binds.

**What does not change.** The frame protocol (§3.2), `MAX_FRAME_LEN` and the fail-closed reader,
the caps, the handle model, and the fuzz + review gate of §3.5 are all transport-independent — the
bridge carries the same bytes either way, and the host-side frame reader is still the fuzz target.
Option A vs B (§3.3) is likewise unaffected: both were about *where* the guest-side socket swap
happens, and the guest side is the half that did not move.

Sources: Cloud Hypervisor `docs/vsock.md` (the `<socket>_<port>` convention and the `CONNECT`
handshake); Firecracker `docs/vsock.md` (the same hybrid design, stated first); Kata's Cloud
Hypervisor integration dialing `hvsock` at `/run/vc/vm/<id>/clh.sock`.

### 3.2 Frame protocol

Both host-chokepoint channels use the rlms framing so the LM path needs **zero protocol
redesign** ([RESEARCH §10.1 (Round-2 verdict — Kata over CubeSandbox)](REPL_SANDBOX_RESEARCH.md)):

```
┌────────────────┬───────────────────────────────┐
│ length (4 B)   │ UTF-8 JSON payload (length B)  │
│ big-endian u32 │                               │
└────────────────┴───────────────────────────────┘
```

- **`LM_PORT`** carries rlms' own `LMRequest`/`LMResponse` frames **transparently** — the
  bridge is a byte pipe and does not parse the JSON. Payload schema: §4.
- **`DB_PORT`** carries the Trellis broker envelope (§5), same framing.
- **`MAX_FRAME_LEN` — mandatory hard bound.** The 4-byte prefix admits up to 4 GiB; a hostile
  guest can send a huge length to force a host allocation (DoS). The host frame reader **MUST
  reject any declared length `> MAX_FRAME_LEN` before allocating**, drop the connection, and
  audit it. `MAX_FRAME_LEN` is a single configured constant sized to the largest legitimate
  frame plus headroom; its concrete value is an owner decision (§9). **Enforced by:** the
  host-side frame reader (fail-closed).
- **Read discipline:** bounded read timeout per frame; reject partial/over-length frames;
  a frame whose JSON fails to parse is an error, not a best-effort recovery (fail-closed, §7).

### 3.3 Bridge options — A (forwarder) vs B (transport patch)

| | **A — guest-side loopback→vsock forwarder** | **B — `AF_VSOCK` transport patch to rlms** |
|---|---|---|
| Mechanism | An unprivileged guest process listens on the loopback `AF_INET` port rlms connects to, and pumps bytes over vsock to the host. | ~20-line patch swapping `socket_request` + `LMHandler` bind from `AF_INET` to `AF_VSOCK`. |
| rlms | **pristine, upstream-upgradable** (drop-in on every `rlms` bump) | **forked** — re-apply + re-audit the patch on every upgrade |
| Guest processes | +1 (the forwarder) | none extra |
| Data path | one extra loopback hop | direct |
| `port=0` bind-host question (§9) | inherited (host-side rlms `LMHandler` still `AF_INET`) | **mooted** — bind `AF_VSOCK` on `CID_ANY` + fixed port |
| Fork drift on security-critical code | none | **yes** — the transport (the fuzz target) is exactly the forked code |

**Recommendation: Option A**, on a security-maintenance rationale.
- The load-bearing security surface — CID auth, the CID-keyed caps, and the bounded frame
  parser — is **host-side and identical under both options**. Neither option changes the
  boundary; the microVM does ([ARCHITECTURE §2 (Trust model)](REPL_SANDBOX_ARCHITECTURE.md)).
- Given that, A's one "cost" (an extra guest process) is **not a security cost**: the forwarder
  lives inside the already-untrusted guest and is **not a boundary** (§3.4). If model code kills
  it and speaks vsock itself, **nothing is bypassed** — the host still authenticates by CID and
  enforces caps. A's benefit (rlms stays pristine) is a real, recurring win: no fork to re-audit
  on the security-critical transport at every upgrade.
- B's fork lands the maintenance + supply-chain-audit burden **precisely on the transport code
  that is the fuzz target**, which is the worst place to carry drift. Prefer B only if the extra
  guest process is independently unacceptable (e.g. a hardened minimal guest image forbids it),
  in which case the patch must be vendored as a reviewed series and re-fuzzed on every rebase.
- This matches the ratified component description, which already casts the bridge as an
  *unprivileged process carrying loopback-`AF_INET` traffic* — Option A's shape
  ([ARCHITECTURE §4 (Components) — vsock bridge](REPL_SANDBOX_ARCHITECTURE.md)).

Under A, the host still runs rlms' `LMHandler` (or a Trellis reimplementation) behind a small
host-side vsock→loopback shim that connects to the handler's auto-assigned loopback port; that
shim is the host frame-reader and is the fuzz/review target below.

### 3.4 Privilege drop for the bridge process (Option A forwarder)

The forwarder runs inside the untrusted guest, so this hardening is **blast-radius / hygiene,
not a boundary** — stated explicitly so it never migrates into an "Enforced by" column.

- Dedicated **non-root uid/gid**, no supplementary groups; `no_new_privs`; **all capabilities
  dropped** (empty bounding + effective sets).
- **seccomp allowlist** — only `socket, connect, accept4, read, write, recvfrom, sendto,
  epoll_*, close, exit(_group)`; everything else killed.
- **Landlock** — no filesystem access (it opens no files); the `AF_INET` loopback side scoped
  to the single listen port (Landlock ≥ 6.7 port rules). vsock is outside Landlock's scope, so
  reliance there is on seccomp + the host being the only endpoint that `accept()`s the port.
- **cgroup** — tiny pids/mem cap; started by guest init **before** the worker; own pid/mount ns.
- **Not a control:** the host-side CID auth + caps + bounded frame parser are the enforcing
  surfaces. The privilege drop only limits what a *separately* compromised forwarder can do; a
  guest-kernel compromise owns it regardless, and that is contained by the microVM.

### 3.5 Fuzz + security-review requirement (gate — must ship before the bridge does)

**Enforced by process gate**, not prose: the bridge does not ship until it passes.
- The **host-side frame reader** (length-prefix parse → bounded allocate → JSON decode) must be
  minimal, single-purpose, and bounds-checked; it must reject `> MAX_FRAME_LEN`, partial, and
  malformed frames fail-closed (§3.2).
- **Coverage-guided fuzzing** of the length+JSON parser is a merge gate (adversarial input: giant
  lengths, truncated frames, non-UTF-8, deeply nested / oversized JSON).
- A **standalone security review / red-team pass on the bridge before it ships**
  ([SPEC §8 (Acceptance gates)](REPL_SANDBOX_SPEC.md); [ARCHITECTURE §7 (Security requirements) requirement 10](REPL_SANDBOX_ARCHITECTURE.md)).
- **Re-triggered** on any bump to a frame-format version (§8).

## 4. LM-handler RPC surface (`llm_query`, `llm_query_batched`)

Serves the flat sub-LLM fan-out; holds the **provider API key host-side only**
([ARCHITECTURE §4 (Components)](REPL_SANDBOX_ARCHITECTURE.md)). *(wire source-confirmed)*

**Wire.** 4-byte BE len + UTF-8 JSON (§3.2), on `LM_PORT`.

```
LMRequest  = { prompt: str            # single-completion path (llm_query)
             | prompts: [str],        # batched path (llm_query_batched)
               model: str,
               depth: int,            # ceiling-checked host-side; must be <= 1
               context: Handle | [Handle] }   # TRELLIS EXTENSION — not an rlms field
LMResponse = { error: str | null,
               chat_completion: {...}         # for prompt
             | chat_completions: [ {...} ] }  # for prompts
```

- `llm_query(prompt, model)` → one `chat_completion`; `llm_query_batched(prompts, model)` → a
  `chat_completions` list. rlms' `batch_max_concurrent = 16` bounds the thread pool of **one**
  batched call only *(source-confirmed)* and is **not** a session cap — see caps below.

**`context` is a Trellis extension to this wire, not inherited rlms behaviour.** rlms'
`LMRequest` has four fields and `context` is not one of them: `from_dict` reads its four keys by
name and drops every other key, and `to_dict` can only emit what the dataclass holds
*(source-confirmed, `rlm/core/comms_utils.py:50-58`)*. The extension is backward-compatible by
construction because **Trellis serves this frame** — `lm_handler.py` parses the wire itself, rlms'
own client never sets the field, and a native `{prompt, model, depth}` request takes exactly the
path it took before the field existed. It carries **handle tokens only** (`{id, kind}`,
[DATA_MODEL §1 (What a handle is)](REPL_SANDBOX_DATA_MODEL.md)); a string where a handle belongs is
refused, because a second free-text field would be a second prompt with different accounting. The
host resolves each distinct handle **once per call** against the per-CID handle table, splices the
referents into the outbound prompt host-side, and dispatches — the sub-LLM reads the referent and
only the bounded completion returns, which is
[DATA_MODEL §6 (The bounded materialisation exception)](REPL_SANDBOX_DATA_MODEL.md) given a wire:
the model reasons over the whole belief base **without one row entering the guest**. Resolution is
fail-closed and all-or-nothing — a foreign, unknown, dropped, expired, or stale token refuses the
whole call as a bare `denied` carrying no content and no distinguishing detail, and a
partially-resolved prompt is never dispatched. The outbound ledger is charged the **full resolved
size**, not the token's, and the DLP hook runs over the resolved text; both are defense-in-depth on
the residual and neither is the boundary — the boundary is that the guest never held the bytes
([ARCHITECTURE §3.1 (The exfiltration resolution)](REPL_SANDBOX_ARCHITECTURE.md)). A `cap_bytes`
refusal on a resolved prompt reports no byte count, so the error channel is not a size oracle for
host content. **Enforced by:** the host LM handler, keyed by the CID from `accept()`.

**Auth.** The handler keys the request to the session by the **identity its listener reported at
`accept()`** (§3.1a),
never by any id in `LMRequest`. Unknown CID ⇒ connection dropped + audited. **Enforced by:** the
host LM handler at `accept()` ([LEARNINGS §7 (Identity: the vsock CID)](REPL_SANDBOX_LEARNINGS.md)).

**Caps — per session, CID-keyed, host-enforced** (rlms caps are bypassable, §2):

| Cap | Behaviour on breach | Enforced by |
|---|---|---|
| max in-flight concurrency | request queued/refused (`error:"cap_concurrency"`) | LM handler, before provider dispatch |
| requests / sec (rate) | refused with retry-after (`error:"cap_rate"`) | LM handler token bucket, keyed by CID |
| **dollar spend** (hard stop) | on exhaustion the call returns `error:"cap_spend"` and the **session is halted** | LM handler debits a dollar-denominated ledger keyed by session (root `run_id`) before each provider call |
| `depth > 1` | rejected (`error:"depth_ceiling"`) | LM handler; ceiling host-derived, not guest-reported |
| cumulative outbound prompt bytes / session | refused (`error:"cap_bytes"`) | LM handler DLP hook (below) |

**Content-DLP hook.** Runs host-side on outbound prompt text (`llm_query`, `llm_query_batched`,
and `vector_search` if present) before the provider call: applies policy (flag / redact / deny)
and the cumulative byte cap, and feeds audit. It is the attach point for the composed outbound
**defeater** panel ([DOUBTS_WORKSPACE §8 (Composed defeaters)](../../architecture/DOUBTS_WORKSPACE.md),
seat prompts owned by [DOUBT_FILTER](REPL_SANDBOX_DOUBT_FILTER.md)).
- **Discipline (non-negotiable):** the DLP hook is **defense-in-depth, NEVER the boundary**. The
  boundary is data-flow — the guest holds handles, not payloads ([ARCHITECTURE §3.1 (The exfiltration resolution)](REPL_SANDBOX_ARCHITECTURE.md)).
  The hook reduces the *rate* at which injected instructions act; it does not make exfil
  impossible and must never appear in an "Enforced by" column as a boundary
  ([ARCHITECTURE §7 (Security requirements) requirement 12](REPL_SANDBOX_ARCHITECTURE.md)).

The `answer` / final-submit channel is likewise an **audited egress control point**, not merely
the 64 KB size cap ([ARCHITECTURE §3.1 (The exfiltration resolution)](REPL_SANDBOX_ARCHITECTURE.md)).

## 5. DB-broker RPC surface (`run_query`, `run_cypher`, handle ops)

Serves the credentialed DB tools; holds the real Neo4j/Postgres clients + credentials + DB
network route; model code never holds a raw DB socket or credential
([ARCHITECTURE §4 (Components)](REPL_SANDBOX_ARCHITECTURE.md)).

**Wire.** 4-byte BE len + UTF-8 JSON (§3.2) on `DB_PORT`, Trellis envelope `v1`:

```
Request  = { v: 1, req_id: str, op: str, args: {...} }
Response = { v: 1, req_id: str, ok: bool,
             result?: {...},                  # on ok
             error?: { code: str, message: str, retryable: bool } }
```

**Operations (handle-first — return tokens, not payloads):**

```
run_query(sql: str, params: [..])      -> { handle: ResultHandle, rowcount: int, schema: [..] }
run_cypher(query: str, params: {..})   -> { handle: ResultHandle, rowcount: int, schema: [..] }
resolve_meta(h: ResultHandle)          -> { shape, length, schema }        # metadata only, no payload
slice(h: ResultHandle, span)           -> { rows|text, truncated: bool }   # THE bounded, audited payload path
```

- `ResultHandle` is an **opaque token on the wire**; its identity, lifetime, and valid `span`
  are defined by [DATA_MODEL](REPL_SANDBOX_DATA_MODEL.md). This doc guarantees only that
  **`run_query`/`run_cypher` return a handle + safe metadata by default, and payload bytes cross
  to the guest ONLY through `slice()`**, which is row/byte-capped and audited. This is the
  data-flow boundary realised on the wire ([ARCHITECTURE §3.1 (The exfiltration resolution)](REPL_SANDBOX_ARCHITECTURE.md)):
  the guest holds handles, not secret-bearing payloads.
- Handle-typed params: a handle may be passed **into** `run_query`/`run_cypher` (the broker
  substitutes host-side), so the guest composes over data it cannot itself read.

**Auth + audit.** Keyed to the session by the **identity the listener reported at `accept()`**
(§3.1a); every call logged
by CID with `op`, an args digest, and returned row/byte counts and the policy decision.
**Enforced by:** the broker at `accept()` + the broker audit log
([LEARNINGS §7 (Identity: the vsock CID)](REPL_SANDBOX_LEARNINGS.md)).

**Tool denial — the one enforcement point** ([SPEC §7 (Requirements traceability) req 3](REPL_SANDBOX_SPEC.md)):
- Denial is **structural**: a denied tool is **never registered**, so no `dispatch_ref` is
  materialised and no stub exists in the guest — there is no dispatch path to deny at call time
  (§6). The broker routes strictly by its own `(CID, op)` table and **never by a guest-echoed
  `dispatch_ref`** (else a compromised worker forges routing — confused-deputy). **Enforced by:**
  the broker dispatch table.
- Statement-level denials that a role/access-mode cannot express are enforced by **bounded**
  inspection layered on the DB-side controls below (never string-matching as the sole control —
  proxy parsers are a known CVE class, so the inspector stays small and auditable,
  [RESEARCH §10.3 (The recommended architecture)](REPL_SANDBOX_RESEARCH.md)).

**Postgres controls:**

| Control | Enforced by |
|---|---|
| read-only default; `NOSUPERUSER` role; writes require an explicit per-tool grant (a distinct capability) | the Postgres role attached to the broker connection (belt) + the dispatch table (suspenders) |
| deny `pg_read_server_files`, `pg_execute_server_program`, `dblink`, `lo_import`/`lo_export`, `COPY … TO/FROM PROGRAM`, `pg_read_file` | the read-only `NOSUPERUSER` role (primary) + bounded statement inspection (defense-in-depth) |
| `statement_timeout` | set on the broker's PG session; enforced server-side by Postgres |
| row cap + result byte cap | broker, on `run_query`/`slice` result assembly |

**Neo4j controls:**

| Control | Enforced by |
|---|---|
| `default_access_mode = READ` | the Bolt session opened by the broker |
| APOC allowlist **deny-by-default** (no `apoc.load.*` / `apoc.export.*` unless a named tool grants it) — closes `apoc.load.json` SSRF that `READ` mode does not | broker APOC allowlist check + Neo4j config |
| forbid unbounded `[*]` variable-length paths | broker query inspection |
| Bolt query timeout | set by the broker per query |
| row cap + result byte cap | broker, on `run_cypher`/`slice` result assembly |

**No-SSRF backstop.** The DB host has **no route to internet/metadata** — even a bypass of the
above reaches nothing off-DB. **Enforced by:** deny-by-default egress at the host/VMM NIC
([ARCHITECTURE §4 — Egress policy](REPL_SANDBOX_ARCHITECTURE.md)).

## 6. CapabilityDescriptor lifecycle — one object, two renderings

```
CapabilityDescriptor = { name: str,
                         typed_signature: JSONSchema,
                         doc: str,
                         dispatch_ref: opaque }   # host routing token; guest never supplies it
```

- **Register** — `register_capability(handle, descriptor)`, host-side, by the **trusted driver
  only**; guest code has no path to register or self-grant (seam 6, §1). `llm_query` /
  `llm_query_batched` are **pre-registered**.
- **Materialise (backend → guest).** At `setup()` the backend code-generates a **proxy stub**
  named `name` in the guest namespace whose body serialises `{v, req_id, op:name, args}` and
  sends it over the correct vsock port (`DB_PORT` for DB tools, `LM_PORT` for `llm_query`). The
  guest stub holds **no credential and no live client** — only the RPC. The broker resolves
  `dispatch_ref` from its own `(CID, op)` table (§5), so the token never rides in from the guest.
- **Render (composer → prompt).** The **same** descriptor is rendered as a **typed, doc-commented
  stub** (signature + one-line doc, body stripped) the model writes code against — code shaped
  like the model's pretraining, not JSON-schema-in-prose
  ([RESEARCH §7 (Prompt-composition-by-function)](REPL_SANDBOX_RESEARCH.md)). Progressive disclosure keeps only needed signatures
  in context; minification is structural (the data is never emitted).
- **Denial** is the absence of registration (§5): no descriptor ⇒ no stub ⇒ no dispatch path.

One object thus serves modularity (swap the backend, callers unchanged) and prompt-composition-
by-function ([ARCHITECTURE §5 (RLM-compat seam)](REPL_SANDBOX_ARCHITECTURE.md)).

## 7. Error model

**Envelopes.** The LM path uses rlms-native `LMResponse.error` (§4); the broker path uses the
`v1` `error:{code, message, retryable}` object (§5); the control path returns
`{op, ok, error?}`. All are **fail-closed** — an ambiguous, oversized, or unparseable request is
denied and audited, never best-effort executed.

**Taxonomy (stable `code` strings across seams):**

| Class | `code` | Retryable | Surfacing |
|---|---|---|---|
| Auth (unknown/mismatched CID) | `auth` | no | connection dropped; audited by attempted CID |
| Frame (oversized / malformed / partial) | `frame` | no | connection dropped before allocate (§3.2); audited |
| Cap — concurrency / rate | `cap_concurrency` / `cap_rate` | yes (retry-after) | returned to the stub → Python exception |
| Cap — spend (hard stop) | `cap_spend` | **no** | returned, then **session halted** — not a recoverable error |
| Cap — cumulative bytes | `cap_bytes` | no | returned to the stub |
| Depth ceiling | `depth_ceiling` | no | returned to the stub |
| Denied (tool / statement / APOC / unbounded path) | `denied` | no | returned to the stub; audited |
| Timeout (statement / Bolt / exec deadline) | `timeout` | sometimes | returned to the stub |
| Upstream (provider / DB error) | `upstream` | passthrough | returned to the stub |

**Surfacing to the model.** A broker/handler error returned to an in-guest stub is **raised as a
Python exception**, so it lands in `REPLResult.stderr` as a traceback and feeds the model's
self-debug loop ([RESEARCH §7 (Prompt-composition-by-function) principle 5](REPL_SANDBOX_RESEARCH.md)) — **except** `cap_spend`,
`auth`, and `frame`, which are session-terminal or connection-terminal and are not offered back
as recoverable. Every error is audited by CID regardless of surfacing.

## 8. Versioning model

| Contract | Version anchor | Bump policy |
|---|---|---|
| rlms wire (`LMRequest`/`LMResponse`/`REPLResult`, reserved names, framing) | pinned to **`rlms==0.1.3`** source | changing the pin **re-triggers the byte-exact source-read** ([SPEC §8 (Acceptance gates)](REPL_SANDBOX_SPEC.md); [RESEARCH §8 (Open items to close before any build) item 1](REPL_SANDBOX_RESEARCH.md)) before any code depends on the new shape |
| broker envelope | explicit `v` field (`v:1`) | additive fields = compatible; removed/retyped fields or changed op semantics = new `v` |
| bridge frame format | frame-format version constant | any bump **re-triggers the §3.5 fuzz + security-review gate** |
| `CapabilityDescriptor` shape | descriptor schema version | additive only without a bump; `dispatch_ref` stays opaque |

**No runtime negotiation — deploy-time pinning (design call, §9).** Because there is **one
microVM per session and the host mints the guest image** ([ARCHITECTURE §6 (Recursion & multiplicity)](REPL_SANDBOX_ARCHITECTURE.md)),
both ends of every seam are deployed together: the host materialises the guest's bridge + stubs
at `setup()` to match the host's own contract version. There is no mixed-version guest/host pair
within a session, so the wire carries a version field for **audit and forward-safety**, not for
negotiation. A security-relevant bump (bridge or any host-chokepoint frame) is gated by §3.5.

## 9. Open encoding questions (owner / source-read gated)

Flagged so no build proceeds on an unverified byte — a documented bound with no engine behind it
reads exactly like an enforced one.

1. **`LMHandler` `port=0` bind host + auto-port discovery** ([SPEC §9 (Open items)](REPL_SANDBOX_SPEC.md)).
   The constructor default is `host="127.0.0.1"` *(source-confirmed)*, but confirm from the
   pinned source that (a) `port=0` binds loopback (never `0.0.0.0`) on every code path, and
   (b) the auto-assigned port is host-discoverable (`.address`) so the Option-A host shim can
   connect to it. **Option B moots this** by binding `AF_VSOCK` on `CID_ANY` + a fixed port — a
   point to weigh if the confirmation is awkward.
2. **`REPLResult.locals` marshalling format.** Confirm from the pinned source whether `locals`
   crosses as `repr`/JSON-safe values or via pickle. The seam requires value-reprs so **no live
   object or pickle-gadget can ride back across the boundary** (§2); if rlms pickles, the backend
   must interpose a repr/JSON marshaller. Source-read gated ([RESEARCH §8 (Open items to close before any build) item 1](REPL_SANDBOX_RESEARCH.md)).
3. **`MAX_FRAME_LEN` value** (§3.2) — **derivation rule settled July 22, 2026; the shipped number
   remains owner-gated.** The original framing here ("large enough for the biggest legitimate frame
   plus headroom") had no derivable answer: the source read found the largest legitimate frame is an
   `LMResponse` carrying a child run's whole trajectory, which grows with iteration count, so no
   static cap follows from it ([CONFORMANCE §3](REPL_SANDBOX_CONFORMANCE.md)).

   The rule adopted instead sizes the cap off **the worker's context window**, which makes it a
   structural guarantee rather than only a DoS bound: **no single frame can context-saturate the
   worker it lands in.** Derivation — a 1,050,000-token window × 50% × ~4 bytes/token ≈ 2.1 MB →
   **2 MiB**, set as `config.DEFAULT_MAX_FRAME_LEN` with `MODEL_CONTEXT_WINDOW_TOKENS` recorded
   beside it so the number is re-derived, not re-guessed, when the model pin changes. This sits
   above `ByteLedgerCaps.inbound_per_call`, so the two bounds stack; and the handle model keeps the
   context load small by carrying tokens rather than payloads. The DoS property is unchanged — the
   reader still rejects an over-length declaration **before** allocating. A ratified number is still
   required before the bridge ships.

---

*Spec: [REPL_SANDBOX_SPEC.md](REPL_SANDBOX_SPEC.md) · Architecture:
[REPL_SANDBOX_ARCHITECTURE.md](REPL_SANDBOX_ARCHITECTURE.md) · Session knowledge:
[REPL_SANDBOX_LEARNINGS.md](REPL_SANDBOX_LEARNINGS.md) · Full trail:
[REPL_SANDBOX_RESEARCH.md](REPL_SANDBOX_RESEARCH.md). Siblings:
[DATA_MODEL](REPL_SANDBOX_DATA_MODEL.md) (handle semantics) ·
[THREAT_MODEL](REPL_SANDBOX_THREAT_MODEL.md) (why each control) ·
[DOUBT_FILTER](REPL_SANDBOX_DOUBT_FILTER.md) (defeater seats) ·
[BUILD_PLAN](REPL_SANDBOX_BUILD_PLAN.md) (sequencing).*
