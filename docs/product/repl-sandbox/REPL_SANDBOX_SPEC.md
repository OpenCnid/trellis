# Trellis REPL Sandbox — Specification

**Status: DESIGN SPEC — decisions owner-ratified July 20–21, 2026; NOT built.** The formal
interface, configuration, and invariants for the architecture in
[REPL_SANDBOX_ARCHITECTURE.md](REPL_SANDBOX_ARCHITECTURE.md). Interface facts marked
*(source-confirmed)* were read byte-exact from the pinned `rlms==0.1.3` install.

This sheet is the summary. The build-ready detail lives in the companion records:
wire + RPC contracts → [INTERFACES](REPL_SANDBOX_INTERFACES.md) (expands §2/§3/§4);
consolidated security → [THREAT_MODEL](REPL_SANDBOX_THREAT_MODEL.md) (expands §6);
the handle/data-flow boundary → [DATA_MODEL](REPL_SANDBOX_DATA_MODEL.md);
build order → [BUILD_PLAN](REPL_SANDBOX_BUILD_PLAN.md); the PROPOSED doubt-filter →
[DOUBT_FILTER](REPL_SANDBOX_DOUBT_FILTER.md). Index: [README](README.md).

---

## 1. Summary sheet

| Field | Value |
|---|---|
| Boundary | Kata Containers microVM (hardware KVM) |
| VMM | Cloud Hypervisor |
| Version pins | Kata **≥ 3.31.0** · Cloud Hypervisor **≥ 52.0** (separate) |
| Isolation tiers | Tier-1 microVM (boundary) · Tier-0 in-guest cgroups+seccomp+Landlock (defense-in-depth) · Tier-2 audit hooks (telemetry only) |
| REPL depth | `max_depth` = 1 (flat fan-out only) |
| Guest→host channel | vsock only |
| DB access | host broker, read-only NOSUPERUSER by default |
| Egress | deny-by-default at host/VMM NIC |
| Host | KVM-capable Linux (Hetzner dedicated / AWS C8i / GCP N2) |
| Multiplicity | one microVM per session; never co-tenant adversarial workers |
| RLM backend | subclass of `rlms.IsolatedEnv` |

## 2. Backend interface (drop-in for the rlms driver) *(source-confirmed)*

```
class KataREPL(IsolatedEnv):                       # rlms IsolatedEnv = "separate machine from the LM"
    # NOTE: that signature is BaseEnv's. IsolatedEnv.__init__ is
    # (self, persistent=False, **kwargs), so depth and max_concurrent_subcalls
    # reach the base by KEYWORD only -- KataREPL(False, 1) raises TypeError.
    __init__(persistent=False, depth=1, max_concurrent_subcalls=4, **kwargs)
    setup(self)                                    # boot/attach the microVM, wire the vsock bridge, register tools
    load_context(self, payload: dict|list|str)     # expose the REPL variable `context`
    execute_code(self, code: str) -> REPLResult    # run one model-authored block, marshal result back
    # optional multi-turn (SupportsPersistence): update_handler_address((host,port)),
    #   add_context, get_context_count, add_history, get_history_count
```

- `REPLResult` **instance attributes**: `stdout, stderr, locals, execution_time, rlm_calls,
  final_answer`. Its **dataclass field list** names `llm_calls` where the constructor assigns
  `rlm_calls` (`core/types.py:166` vs `:182`), so the generated `__repr__` and `__eq__` **raise
  `AttributeError`** — never `repr()` or compare a `REPLResult`. Corrected July 22, 2026 from
  [CONFORMANCE §4](REPL_SANDBOX_CONFORMANCE.md); pinned by `test_rlms_conformance.py`.
- Reserved namespace names (cannot be overridden): `llm_query, llm_query_batched, rlm_query,
  rlm_query_batched, SHOW_VARS, answer, context, history`.
- **Integration seam:** `EnvironmentType` is a fixed `Literal` (local/ipython/docker/modal/
  prime/daytona/e2b) with no "kata" slot — register a new backend or pass the env instance.

## 3. Sub-LLM wire contract *(source-confirmed)*

- **Framing:** 4-byte big-endian length prefix + UTF-8 JSON payload.
- **`LMRequest`:** `{prompt | prompts, model, depth}`. **`LMResponse`:** `{error,
  chat_completion | chat_completions}`.
- **Transport:** `socket_request` is hardcoded **`AF_INET`** (TCP). **Handler:**
  `LMHandler(host="127.0.0.1", port=0)` — loopback, auto-port, **unauthenticated**;
  `batch_max_concurrent = 16` bounds one batched call only.
- **Bridge requirement:** the guest reaches the host handler over a **vsock bridge**
  (guest-side loopback→vsock forwarder; no rlms modification) or a ~20-line `AF_VSOCK`
  transport patch. **Never bind the handler to `0.0.0.0`.**

## 4. Host chokepoint contracts

### 4.1 LM handler (serves `llm_query`)
- Holds the **provider API key host-side only**.
- **Auth:** kernel vsock peer CID from `accept()` — never a payload-supplied id.
- **Caps (per session, CID-keyed, host-enforced — rlms caps are bypassable):** max in-flight
  concurrency, requests/sec, dollar spend (hard-stop on exhaustion).
- **Content-DLP** on outbound prompt text; cumulative per-session byte cap.

### 4.2 Host broker (serves DB tools)
- Facade RPC surface (illustrative): `run_query(sql, params) -> rows`,
  `run_cypher(query, params) -> rows`. Model code never holds a raw DB socket or credential.
- **Auth:** vsock peer CID (per-session). **Audit:** every call logged by CID.
- **Postgres role:** `NOSUPERUSER`, read-only default; **deny** `pg_read_server_files`,
  `pg_execute_server_program`, `dblink`, `lo_import/export`. Writes = explicit per-tool grant.
- **Neo4j:** transport `default_access_mode=READ`; **APOC allowlist deny-by-default** (no
  `apoc.load.*` / `apoc.export.*` unless a named tool needs it); forbid unbounded `[*]` paths.
- **Cost caps:** `statement_timeout` (PG) + Bolt query timeout; row/byte result caps.

### 4.3 CapabilityDescriptor (tool registration)
```
{ name: str, typed_signature: JSONSchema, doc: str, dispatch_ref: opaque }
```
Backend materialises → an in-guest proxy stub RPC'ing the broker over vsock. Composer renders
→ a typed doc-commented stub the model writes code against. `llm_query` is a pre-registered
capability.

## 5. Configuration

| Key | Value / policy |
|---|---|
| `kata.version` | ≥ 3.31.0 |
| `cloud_hypervisor.version` | ≥ 52.0 |
| VMM device model | virtio-only (no legacy devices) |
| Guest vCPU / mem | capped at the VM level; **plus** in-guest cgroups (pids/mem/cpu) |
| seccomp | allowlist profile applied to the worker process at startup |
| Landlock | read-only roots for the worker's code/data |
| Egress | deny-by-default at host/VMM NIC; DB host has no internet/metadata route |
| vsock ports | `LM_PORT` (→ LM handler), `DB_PORT` (→ broker), **`CONTROL_PORT`** (backend ↔ guest supervisor: exec / load_context / lifecycle) — detailed in [INTERFACES §1 (Seam map), §3 (The vsock bridge)](REPL_SANDBOX_INTERFACES.md) |
| Spend cap | dollar-denominated, per session, host-enforced |
| DB role | read-only NOSUPERUSER (writes gated per-tool) |

## 6. Security invariants (what enforces each)

| Invariant | Enforced by |
|---|---|
| Host escape contained | Kata microVM (KVM) |
| No DB creds / API key in guest | broker + host-side handler hold them |
| Per-session identity unspoofable | kernel vsock CID |
| No unauthorized egress | deny-by-default NIC + broker/handler are the only paths |
| Exfil via sanctioned crossings bounded | **data-flow: guest holds handles, not secret-bearing payloads** (ratified — holds under 100% injection); content-DLP + byte caps + composed doubt-filter = defense-in-depth, **never the boundary** (ARCHITECTURE §3.1) |
| No resource-exhaustion host impact | VM caps; in-guest cgroups + host watchdog for self-DoS |
| DB stays read-only / no SSRF | NOSUPERUSER role + APOC allowlist + DB-host egress deny |
| **NOT a boundary** (telemetry only) | `_SAFE_BUILTINS`, audit hooks, `trellis_task.verify()`, the 20 KB / 64 KB output caps |

## 7. Requirements traceability

| Req | Met by |
|---|---|
| 1 minimal & performant | Cloud Hypervisor (virtio-only); warm pool optional; Tier-0 ~0 overhead |
| 2 secure boundary | Kata (Tier-1) + Tier-0 + broker; §6 invariants |
| 3 tool-definable incl. denylist | CapabilityDescriptor registration + broker-side denylist (the only enforcement point) |
| 4 RLM-compatible | 3-method `IsolatedEnv`; wire contract §3 |
| 5 replaceable/self-hostable | backend seam; self-hosted Kata; no vendor lock-in |
| 6 composable | CapabilityDescriptor renders to typed stubs (prompt-composition-by-function) |

## 8. Acceptance gates (before build is "done")

- `kata-runtime check` PASS + `qemu -accel kvm -cpu host` smoke test near-native on the host.
- The 12 security requirements of [ARCHITECTURE §7](REPL_SANDBOX_ARCHITECTURE.md) implemented
  and each mapped to an enforcing surface (a documented bound with no engine behind it does
  not count — house rule).
- Scripted equivalence: an unedited load → `execute_code` round-trips as `LocalREPL` does.
- A red-team pass on the vsock bridge before it ships.

## 9. Open items

- **Exfil resolved (July 21, 2026): data-flow, not content inspection** — the guest holds
  addressable handles, not secret-bearing payloads ([ARCHITECTURE §3.1](REPL_SANDBOX_ARCHITECTURE.md)).
  Remaining open: the composed doubt-filter (Layers 1–2 defense-in-depth) is **PROPOSED** —
  spec the standing provenance-grounded injection-objection and the outbound defeater seats,
  composed from the -1 doubt tier ([DOUBTS_WORKSPACE §8–§9](../../architecture/DOUBTS_WORKSPACE.md));
  Guardrail 15 (prompt-engineering + hypershot-protocol) applies when the seat prompts are authored.
- **`MAX_FRAME_LEN` — rule settled July 22, 2026, shipped value still owner-gated.** Size the cap
  off the worker's context window rather than off the largest frame the plumbing might carry, so it
  is a structural guarantee (no single frame can context-saturate a worker) and not only a DoS
  bound. Derivation: 1,050,000-token window × 50% × ~4 bytes/token ≈ 2.1 MB → **2 MiB**, set as
  `config.DEFAULT_MAX_FRAME_LEN` with the window recorded beside it as the input to re-derive from
  when the model pin changes. The DoS property is unchanged: the reader still rejects an over-length
  declaration before allocating.
- The vsock bridge is unbuilt glue — security-critical; spec its frame parser + privilege drop.
- Warm-pool clean-slate-reset policy (only if pooling is adopted).
- Whether to relax `_SAFE_BUILTINS` once the VM boundary exists (redundant defense-in-depth).
- Confirm `LMHandler` `port=0` bind host and whether a host override is exposed by the driver
  before finalising the bridge.

---

*Architecture: [REPL_SANDBOX_ARCHITECTURE.md](REPL_SANDBOX_ARCHITECTURE.md). Full trail:
[REPL_SANDBOX_RESEARCH.md](REPL_SANDBOX_RESEARCH.md).*
