# Trellis REPL Sandbox — Architecture

**Status: DESIGN RECORD — the decisions below were owner-ratified July 20–21, 2026;
implementation is NOT started.** This record distills the research audit trail
([REPL_SANDBOX_RESEARCH.md](REPL_SANDBOX_RESEARCH.md)) into the design Trellis will build
against. It leads implementation (document-driven); the security requirements in §7 are
requirements, not suggestions. Diagrams: [isolation view](repl_sandbox_architecture.svg),
[depth-1 flat fan-out](repl_sandbox_recursion.svg).

---

## 0. Purpose

Trellis' REPL is the execution substrate for the code-mediated-text pillar
([CODE_MEDIATED_TEXT.md](../../architecture/CODE_MEDIATED_TEXT.md)): the model operates on text
by writing and running Python, not by reading/retyping it. Today that runs on `rlms`'
`LocalREPL` — the MIT CSAIL Recursive Language Model reference implementation — which
executes model-authored Python **in-process on the host, with no isolation**, and injects
live host objects (including Neo4j/Postgres clients with real credentials) into the model's
namespace. This architecture replaces that substrate with a real, self-hostable trust
boundary while keeping RLM compatibility.

**Threat model:** the Python inside the REPL is *model-authored and steerable by retrieved
content* — treat it as hostile. The guarantee must hold when the model does exactly what a
hostile document tells it to.

## 1. The ratified stack

| Layer | Decision |
|---|---|
| **Primary boundary** | **Kata Containers microVM** (hardware KVM). gVisor evaluated, **not adopted** (no nesting). |
| **VMM** | **Cloud Hypervisor** (Rust, virtio-only). |
| **Version pins** | **Kata ≥ 3.31.0 AND Cloud Hypervisor ≥ 52.0** — two different upstreams, two schemes, two advisory feeds (§7). |
| **REPL depth** | **`max_depth` 1** — flat parallel sub-LLM fan-out only; no child REPLs, no recursion. |
| **DB tools** | **Host broker, read-only by default** (writes require an explicit per-tool grant); credentials never enter the guest. |
| **Egress** | Deny-by-default at the host / VMM NIC; **vsock is the only channel out**. |
| **Deployment** | A KVM-capable Linux host (Hetzner dedicated / AWS C8i / GCP N2). **Not DigitalOcean** (§8). |
| **In-guest hardening** | **Tier-0**: cgroups (pids/mem/cpu) + seccomp allowlist + Landlock — cheap, independent defense-in-depth. |

## 2. Trust model

Three concentric facts:

1. **The Kata microVM is the boundary.** A hardware KVM/VT-x guest kernel per session
   contains host escape. This is the load-bearing control (Tier-1).
2. **In-guest hardening limits blast radius** (Tier-0): even before a hostile worker reaches
   the guest kernel, cgroups cap CPU/mem/PIDs (no fork-bomb), seccomp shrinks the syscall
   surface, Landlock scopes the filesystem. Failure modes are independent of the VMM.
3. **Credentials and the LLM API key live only on the host.** The guest holds *no* DB
   credentials and *no* provider API key. It can *ask* the host to act; it can never *be*
   the host.

Language-level restriction (audit hooks, `_SAFE_BUILTINS`) is **NOT a boundary** — it is
telemetry only (Tier-2). The guest's `__import__` is reachable, so `import os/threading/
subprocess` is available to hostile code; only the OS/VM layers contain it.

## 3. Data plane — what crosses, and how

The whole worker runs inside one microVM; **vsock is the only channel out**, carrying exactly
two kinds of traffic to two host-side chokepoints:

- **`llm_query` (flat sub-LLM fan-out) → the host LM handler.** The root worker splits context
  and issues N parallel *flat* completions over slices (this is the RLM value at depth 1 — no
  child REPLs). The handler holds the provider API key, authenticates by vsock CID, enforces
  hard spend/rate/concurrency caps, and runs content-DLP on outbound prompt text.
- **DB tool calls (`run_query`/`run_cypher`) → the host broker.** The broker holds the real
  Neo4j/Postgres clients + credentials, terminates the DB wire protocol, runs a read-only
  role by default, enforces `statement_timeout` + query-cost caps + an APOC allowlist, and
  audits every call by CID.

**The exfiltration truth (load-bearing):** deny-by-default egress blocks the NIC but **does
not stop exfiltration** — the *sanctioned* crossings (`llm_query`, `vector_search`, the final
`answer`) carry model-controlled text out, and the NIC block is blind to them. The guarantee
must hold when the model does exactly what a hostile document tells it to. The resolution is
§3.1.

### 3.1 The exfiltration resolution — data-flow, not content inspection *(ratified July 21, 2026, owner Cnid; collaborator Matt)*

Content inspection over model-controlled natural language is close to unsolved (no perfect
cover — a hostile document can steer the model to fold a secret into a plausible answer). So
the boundary is **not** a filter; it is a **data-flow property**. Three layers, and only the
first is load-bearing:

| Layer | Mechanism | Status |
|---|---|---|
| **0 — boundary** | **The guest holds addressable *handles*, never secret-bearing payloads.** The broker resolves handles host-side; slice-by-address is the code-mediated-text pillar's minification realised. Holds under **100 % successful injection** — the sanctioned crossings cannot leak what was never materialised in the guest. | **Ratified** — the guarantee |
| **1 — mechanical doubt** | Provenance-gated instruction authority: text whose provenance is *untrusted-retrieved* cannot command an outbound crossing. This is the automatic, no-gate contest of [DOUBTS_WORKSPACE §7](../../architecture/DOUBTS_WORKSPACE.md) ("provenance broke… nothing asserted about the world"), = the existing quarantine path, and = the harness instruction-source-boundary enforced by the engine. | **Proposed** — defensible as automatic |
| **2 — semantic doubt** | A composed **defeater** panel ([DOUBTS_WORKSPACE §8–§9](../../architecture/DOUBTS_WORKSPACE.md)) on the outbound content — "does this smuggle a secret / serve a suspect instruction?" Per §7 it **attaches a finding and feeds audit; it never unilaterally enforces.** | **Proposed** — Tier-2, **never a boundary** |

Layers 1–2 are the "double cover": composition of the **existing -1 doubt tier**, not a new
security subsystem. The **universal injection-doubt** is a promoted, gateable **standing
objection** grounded in a provenance fact (satisfies the §2 corrosion bound) — not a
harness prompt. Each defeater seat may be realised either as an **in-context meta-prompt**
(DOUBTS_WORKSPACE §8 permits this; test before shipping) **or** as a **TTT-trained
tooling-call** emitter on a local open-weight model (the sparsity path) — same instrument,
two substrates; the robustness is the blind-panel **composition**, not the substrate.

**Discipline (non-negotiable):** Layers 1–2 must **never migrate into the "Enforced by"
column of the §6/§7 invariants.** They reduce the *rate* at which the model acts on
injected instructions; they do not make exfil impossible. Content-DLP + per-session
cumulative-byte caps on the crossings remain as further defense-in-depth. The `answer`
channel is an **audited egress control point**, not merely a 64 KB size cap.

**Detailed records:** Layer 0 (the handle model, the slice-by-address algebra, and the metered
materialization exception where the residual exfil-rate bound lives) is specified in
[REPL_SANDBOX_DATA_MODEL.md](REPL_SANDBOX_DATA_MODEL.md); Layers 1–2 (the composition from the
−1 doubt tier, PROPOSED) in [REPL_SANDBOX_DOUBT_FILTER.md](REPL_SANDBOX_DOUBT_FILTER.md).

## 4. Components

| Component | Responsibility | Trust |
|---|---|---|
| **Root worker (Kata microVM)** | Runs the rlms worker at `max_depth` 1; holds cheap creds-free tools (regex/pandas over text) live in-namespace; holds no credentials/API key; Tier-0 hardened. | Untrusted |
| **vsock bridge** | Carries the (loopback-`AF_INET`) rlms socket traffic across the guest boundary to the host. New, security-critical glue: minimal, loopback-only, unprivileged, fuzz-tested. | Boundary |
| **LM handler (host)** | Serves flat `llm_query`; holds the provider API key; CID auth; spend/rate/DLP caps. | Trusted |
| **Host broker** | DB tools; holds DB credentials; read-only NOSUPERUSER role; CID auth; statement/cost caps; APOC allowlist; DLP; audit. | Trusted |
| **Egress policy** | Deny-by-default at the host/VMM NIC; DB-host has no route to internet/metadata (kills SSRF). | Trusted |
| **Host watchdog** | Reaps/replaces wedged or fork-bombed VMs from a clean slot. | Trusted |
| **Warm pool** *(contingency)* | Pre-booted microVMs for cold-start mitigation — only with a single-use / pre-execution-snapshot + rootfs-hash reset policy (no state bleed). | Trusted |

## 5. The RLM-compat seam

RLM compatibility is cheap and confirmed byte-exact against the pinned `rlms==0.1.3` source:

- **Backend contract = 3 methods.** Trellis implements a subclass of **`IsolatedEnv`**
  (rlms' own class for "a completely separate machine from the LM"): `setup(self)`,
  `load_context(self, payload)`, `execute_code(self, code) -> REPLResult`.
- **Sub-LLM channel already out-of-process.** `llm_query` is JSON-over-TCP (4-byte
  big-endian length + UTF-8 JSON) to an `LMHandler` at `(host, port)`. The transport is
  hardcoded `AF_INET` and the handler binds `127.0.0.1` unauthenticated — so the vsock bridge
  is required work, and host-side CID auth + caps are mandatory (§7).
- **Tools are CapabilityDescriptors.** `{name, typed_signature, doc, dispatch_ref}` — the
  backend *materialises* them (a broker RPC stub in the guest) and the prompt-composer
  *renders* them as typed doc-commented stubs the model writes code against. One object
  serves both modularity (swap the backend) and prompt-composition-by-function.

See [REPL_SANDBOX_SPEC.md](REPL_SANDBOX_SPEC.md) for the exact interface and wire contracts.

## 6. Recursion & multiplicity

**Live design: `max_depth` 1, flat fan-out only.** A recursive child RLM (`rlm_query`,
`max_depth ≥ 2`) would get its own REPL, but depth-2 was *measured harmful* (accuracy drops,
latency ~96×; arXiv:2603.02615) and adds nothing the flat fan-out doesn't already provide —
so it is not built. Multiplicity is **one microVM per worker/session**; never co-tenant two
adversarial workers in one guest. The sibling-microVM warm-pool machinery (a child requesting
a fresh sibling VM from the host broker, never nesting) is a **documented contingency** —
the prerequisite *before* depth is ever raised, not a live component.

## 7. Security requirements (from the red-team — these are requirements)

The design is sound only with these. Full findings in
[REPL_SANDBOX_RESEARCH.md §14](REPL_SANDBOX_RESEARCH.md); the consolidated, maintained model —
assets, boundaries, per-surface controls, and accepted residual risk — is
[REPL_SANDBOX_THREAT_MODEL.md](REPL_SANDBOX_THREAT_MODEL.md); the enforceable list:

1. **Exfil control is data-flow first** (§3.1) — the guest holds addressable handles, not
   secret-bearing payloads; this is the boundary and it holds under total injection.
   **Content-DLP + per-session byte caps** on `llm_query` / `vector_search` / `answer` are
   defense-in-depth on top, never the boundary.
2. **LLM provider API key host-side only** (symmetric with DB credentials).
3. **Split version pins** — Kata ≥ 3.31.0 AND Cloud Hypervisor ≥ 52.0, separate feeds
   (closes Kata CVE-2026-24834 and Cloud Hypervisor CVE-2026-27211 / CVE-2026-45782).
4. **Auth by kernel vsock peer CID** (from `accept()`), never a guest-supplied id.
5. **Host-side CID-keyed hard ceilings** on `llm_query` concurrency, rate, and dollar spend.
6. **Neo4j APOC allowlist (deny-by-default) + DB-host egress denial** — closes the
   `apoc.load.json` SSRF that `READ` access mode does not.
7. **`statement_timeout` + query-cost caps + forbid unbounded `[*]` Cypher paths.**
8. **In-guest cgroups (pids/mem/cpu) + host watchdog** (Tier-0).
9. **Least-privilege Postgres role** — `NOSUPERUSER`, no `pg_read_server_files` /
   `pg_execute_server_program` / `dblink`.
10. **Security-review the vsock bridge** before it ships.
11. **Warm-pool reset policy** (if pooling) — single-use or pre-execution-snapshot + hash.
12. **Prompt-level defenses are NOT security controls.** `trellis_task.verify()` is a
    forgeable substring check; the sandbox must hold under 100% successful prompt injection.
    The composed doubt-filter (§3.1, Layers 1–2) sits *under* this rule as defense-in-depth —
    it reduces attempt rate and feeds audit; it is **never** counted as an enforcing surface.

## 8. Deployment

Kata + Cloud Hypervisor **requires real `/dev/kvm`**; without it Kata usually fails to start,
and any QEMU-TCG fallback is 5–35× slower *and* loses the hardware VM boundary. So the host
choice is load-bearing.

- **Not DigitalOcean** — standard Droplets expose `/dev/kvm` but DO calls nested virt
  unsupported / no-SLA; no bare-metal fallback product.
- **Recommended:** a **Hetzner dedicated (Root) server** (native KVM, best self-host posture).
  **Elastic alternatives:** AWS EC2 C8i/M8i/R8i (Feb-2026 nested-virt) or GCP N2/C2.
- **Gate before committing a host:** `kata-runtime check` + a `qemu -accel kvm -cpu host`
  smoke test (near-native = real; 5–30× slow = silent TCG fallback).

## 9. Explicitly not adopted

- **gVisor nesting inside Kata** — uncorroborated; no operator does it; parallel alternatives,
  not a stack. (In-guest seccomp/Landlock is the honest inner layer instead.)
- **CubeSandbox** — NOT-YET (open escape issue, no audit, HTTP-only egress broker can't gate
  raw-TCP DB traffic).
- **Bare Firecracker as the platform** — unneeded given Kata-on-Cloud-Hypervisor.
- **GKE Agent Sandbox** — an orthogonal Kubernetes orchestration layer, not our scheduler
  (its warm-pool *pattern* is worth borrowing if pooling is ever added).
- **WASM/Pyodide** — cannot open raw TCP sockets, so Neo4j/Postgres drivers don't run.

## 10. Build status & first step

Nothing is built. When the research hold is lifted, **spike 1** is the first buildable piece:
implement the `IsolatedEnv` subclass + the vsock bridge (built to the §7 guard list), gated by
the source-reads and the `kata-runtime check`. See
[REPL_SANDBOX_RESEARCH.md §10.4](REPL_SANDBOX_RESEARCH.md) for the ordered spike plan.

---

*Sources and the full decision trail: [REPL_SANDBOX_RESEARCH.md](REPL_SANDBOX_RESEARCH.md).
Session knowledge: [REPL_SANDBOX_LEARNINGS.md](REPL_SANDBOX_LEARNINGS.md). Formal interfaces:
[REPL_SANDBOX_SPEC.md](REPL_SANDBOX_SPEC.md).*
