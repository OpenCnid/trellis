# Trellis REPL sandbox — research report

**Status: RESEARCH — UNRATIFIED. Owner-gated.** This is the deliverable of a
research push (Matt's submission, Cnid approved "go forward", July 20, 2026),
not a design record and not a decision. Nothing here is built, and nothing is
written into the engine or the architecture records on the strength of it. It
exists to inform an owner decision about how Trellis should run its REPL. The
authority ordering of the repo is unchanged (code > glossary > prose); this
document sits below all three until the owner promotes any part of it.

**Owner decisions (July 20, 2026, after review).** The owner selected the
**hybrid** boundary placement (§4.4): the whole tool-bearing worker runs inside an
isolation boundary, cheap creds-free tools stay live in-namespace, and only the
credentialed DB tools are brokered. Two candidate boundary **stacks** are now under
deep evaluation — **CubeSandbox + gVisor** vs **Kata Containers + gVisor** — and a
full adoption audit of CubeSandbox is commissioned. These are direction, not yet a
ratified architecture record; the stack verdict, the CubeSandbox audit, and an
architecture visualization will be appended as §10–§12 when the second research
round returns.

**Ratified decisions (July 21, 2026, owner).** Three decisions ratified; the owner
chose to stay in research (no build) pending the remaining open items.

1. **Primary boundary = Kata microVM** (a hardware KVM boundary). gVisor is an
   *alternative* isolation approach, **not an inner layer** — the "Kata + gVisor" framing
   earlier in this record overstated a nesting the evidence does not support (§10.2, §13),
   and the GKE Agent Sandbox review confirmed it again: across Google's docs, the upstream
   Apache-2.0 `kubernetes-sigs/agent-sandbox` project, and third-party writeups, gVisor and
   Kata appear only as sibling `runtimeClassName` alternatives, **never stacked** — and the
   self-hosted precedent (Red Hat's downstream Agent Sandbox build) defaults to **Kata**.
   Wherever this document says "Kata + gVisor," read **"Kata microVM; gVisor evaluated and
   not adopted."**
2. **REPL recursion depth = `max_depth` 1** (flat parallel sub-LLM fan-out only; no child
   REPLs, no child sandboxes). The §12 sibling-microVM / warm-pool machinery is therefore
   **contingency only** — not part of the live design — retained solely as the prerequisite
   for an eventual, measurement-gated `max_depth=2`. The §12 recursion diagram depicts that
   contingency, not the recommended live system. (Terminology, pinned: `max_depth=1` = flat
   completions, no child REPL — the RLM paper's own evaluated default; `max_depth=2` = the
   first level where children get REPLs — the regime measured as harmful, arXiv:2603.02615.)
3. **Next step = stay in research** — ratify the remaining open items (VMM backend,
   deployment target, broker policy) before any code. No spikes, no commit yet.

**Remaining items ratified the same day (batch 2).** VMM backend = **Cloud Hypervisor**
(pin **≥ 52.0** — note: `3.31.0` is a *Kata* version, not Cloud Hypervisor's; the two are different projects with different schemes, so pin **Kata ≥ 3.31.0 AND Cloud Hypervisor ≥ 52.0** separately — see §14.1); deployment target = **a Linux server / nested-virt-capable cloud VM**
(developed against, since the dev host is Windows); DB-broker default posture = **read-only**
(writes require an explicit, separately-gated per-tool grant). The isolation stack is now
fully ratified end-to-end; what remains is the pre-build source-reads (spike 1), **held**
until the owner lifts the research hold.

**The live recommended architecture is therefore:** one Kata microVM per session running the
whole rlms worker at `max_depth` 1, a host-side broker + LM handler over vsock, deny-by-
default egress — the single-worker isolation view, **without the gVisor inner ring and
without the recursion machinery.** From the GKE review there is one pattern worth stealing
conceptually: a **warm pool** of pre-booted isolated units claimed per session with a stable
per-unit identity (the open `kubernetes-sigs/agent-sandbox` primitives), which would kill
Kata's cold-start penalty — carrying one open caveat, that whether a pooled unit gets a
clean-slate reset between reuses is undocumented and must be resolved before pooling
adversarial code. The three diagrams will be reconciled to the ratified live design in one
consolidated pass once the VMM/deployment items are ratified.

**How it was produced.** Nine research sub-agents ran in parallel (self-play with
web tools), each grounded in a verbatim shared brief describing Trellis' current
REPL and the six requirements, each returning a comparable, sourced card set.
Branches: (1) RLM upstream / paper trail, (2) CubeSandbox, (3) awesome-ai-sandboxes
survey, (4) Vercel Sandbox, (5) Daytona, (6) E2B/Modal/Firecracker/gVisor/Kata,
(7) WASM & embeddable-minimal, (8) security & tool-gating, (9) modularity seam &
prompt-composition-by-function. Every external claim below traces to a source the
agents cited and dated 2026-07-20; claims that were vendor-marketing-only are
labelled UNVERIFIED, and the open items that need a source-read before any build
are collected in the last section.

---

## 0. TL;DR — the recommendation to weigh

The research converges on one architecture, staged in three tiers. It is a
recommendation for the owner to accept, amend, or reject — not a plan in motion.

1. **Keep the rlms driver; own a narrow backend seam.** RLM-compatibility (req 4)
   costs far less than the "live host objects" framing suggested. The rlms REPL
   backend contract is **three methods** (`setup`, `load_context`, `execute_code`),
   and the sub-LLM `llm_query` channel is **already out-of-process** (JSON over a
   TCP socket). So a sandboxed backend is a drop-in, and the sub-LLM path survives
   any boundary that can open a loopback/tunnelled socket. Put a Trellis-owned
   adapter interface (§6) between callers and the backend so the REPL is never
   locked to one implementation (req 5).

2. **Move tools across the boundary as a capability broker, not live injection.**
   The one thing that genuinely cannot cross an isolation boundary is the live
   Neo4j/Postgres client object. Replace `self.locals[name] = live_client` with a
   thin proxy facade in the sandbox that RPCs to a **trusted host broker** holding
   the real drivers, credentials, DB route, and the policy engine. This is the only
   place a tool denylist (req 3) has an enforcement point, and it keeps credentials
   physically outside the sandbox (§5). The same serializable **CapabilityDescriptor**
   the broker materialises is what the prompt-composer renders as a typed stub the
   model writes code against — one object satisfies req 5 and req 6 at once (§6, §7).
   **Where** the boundary is cut is the key design fork (§4.4): the broker
   (credentials physically out, RPC tax) versus wrapping the whole tool-bearing
   worker inside gVisor/nsjail (in-namespace injection preserved; credentials
   contained by deny-by-default egress rather than physically removed). The default
   recommendation is the **hybrid** — worker-in-boundary for cheap tools, broker
   only for the credentialed DB tools.

3. **Layer the trust boundary; measure before picking the tier.** Language-level
   restriction (RestrictedPython, audit hooks) is **not a security boundary** and
   must never be counted as one. The real options, cheapest-first:
   - **Tier 0 (lean, in-process, Linux):** self-applied **Landlock + seccomp-bpf +
     rlimits/cgroups** on the REPL process at startup. Kernel-enforced filesystem
     and network-egress control, near-zero overhead, tools stay live in-namespace.
     Does **not** isolate memory or hide in-process credentials — so it hardens the
     current shape but does not, alone, satisfy req 2 against a determined adversary.
   - **Tier 1 (durable target):** an out-of-process boundary — **gVisor/runsc**
     (lowest operational lift) as the performant baseline, a **Kata/Firecracker
     microVM** as the VM-grade tier — plus the broker of item 2. This is the posture
     that actually satisfies req 2 (real boundary over filesystem, network, syscalls,
     and the tool objects) and req 3 (a denylist with an engine behind it).
   - **Tier 2 (tripwire only):** keep audit hooks / the `_SAFE_BUILTINS` whitelist
     as anomaly telemetry, explicitly labelled NOT-A-BOUNDARY in any design doc.

**One-line verdict:** the sandbox *product* is not the hard part — every serious
option resolves to the same rewrite (proxy stubs + broker over IPC). The hard,
Trellis-specific engineering is the **adapter seam, the capability broker, and the
tier measurement**, and Trellis should build those against an open, self-hostable
engine (gVisor first, Kata/Firecracker for VM-grade) rather than adopt a
hosted-only vendor.

---

## 1. What Trellis runs today (grounded)

Trellis' REPL is the `rlms` package (`rlms==0.1.3`, [requirements.txt](../../../requirements.txt)),
the reference implementation of MIT CSAIL's Recursive Language Models. It is the
execution substrate for the code-mediated-text pillar
([CODE_MEDIATED_TEXT.md](../../architecture/CODE_MEDIATED_TEXT.md)): text lives as
queryable structures in a persistent Python REPL and the model operates on it with
code. The current backend, `rlms`' `LocalREPL`, has these properties (read from
the upstream source, `github.com/alexzhang13/rlm`, and corroborated against
[trellis_agent.py](../../../src/rlm/trellis_agent.py) and
[RLM_HARNESS_SCAFFOLDING.md](../../architecture/RLM_HARNESS_SCAFFOLDING.md)):

- **In-process execution.** `execute_code` builds a merged namespace and runs
  `exec(code, combined, combined)` in the host process. There is **no OS
  isolation** — the upstream README itself says it "should not be used for
  production settings."
- **A language-level guard, not a boundary.** `__builtins__` is a `_SAFE_BUILTINS`
  whitelist with `eval`/`exec`/`input`/`globals`/`locals` set to `None`. This is
  accident-safe only (see §4).
- **Stateful namespace.** New bindings are copied back into `self.locals` after
  each turn; a variable set in turn 1 is live in turn 5. Reserved scaffold names
  are re-pinned each turn so the model cannot clobber them.
- **Tool injection splits by type** (a correction to the "uniform `self.locals`"
  belief): callables go into `self.globals[name]`, non-callable values into
  `self.locals[name]`. Trellis injects live host objects here — including Neo4j and
  Postgres clients that carry real DB credentials.
- **Sub-LLM fan-out is already a socket RPC.** `llm_query` / `llm_query_batched`
  do **not** call the model in-process; they open a TCP socket to an
  `LMRequestHandler` at `(host, port)`, framed as a 4-byte big-endian length prefix
  + JSON payload.
- **Bounded output.** Per-turn REPL stdout is truncated at ~20,000 chars, enforced
  driver-side (`format_iteration`, default 20000). This is an output-shaping / DoS
  limit — **NOT a confidentiality or escape control.**

**The gap this research addresses:** running model-authored Python in-process, with
live credentialed DB clients in the same namespace, is the security hole (req 2),
and hard-coding `LocalREPL` locks Trellis to one REPL (req 5).

---

## 2. The reframe — three findings that de-risk the build

The single most useful result of the research is that the problem is *smaller and
better-factored upstream* than the opening framing assumed.

1. **The backend contract is three methods.** To be drop-in for the rlms driver, a
   backend subclasses `BaseEnv` and implements `setup(self)`, `load_context(self,
   payload)` (exposes the REPL variable `context`), and `execute_code(self, code)
   -> REPLResult` (fields: `stdout, stderr, locals, execution_time, rlm_calls,
   final_answer`), plus an optional persistence protocol Trellis does not currently
   use. Everything else — the reserved scaffold names (`context`, `llm_query`,
   `llm_query_batched`, `rlm_query`, `rlm_query_batched`, `SHOW_VARS`, `answer`,
   `history`), the ~20k cap, the `` ```repl `` fence convention — is driver-side or
   a name contract, not new surface to build.

2. **`llm_query` already crosses a process boundary.** It was never an in-process
   object call — it is JSON-over-TCP to `lm_handler_address`. So RLM recursion
   survives a container / microVM / WASM boundary intact, provided the handler
   `(host, port)` is reachable from inside the sandbox (loopback if co-located; a
   forwarded/tunnelled port or a vsock bridge otherwise). This removes the biggest
   feared source of incompatibility.

3. **Upstream already anticipates isolation.** The rlms repo has an `IsolatedEnv`
   split and an `environment=` strategy selector
   (`local | ipython | docker | modal | prime | daytona | e2b`), and its README
   already prescribes the fix for the one thing that cannot cross a boundary:
   in isolated environments, tools must be passed "as code strings … host callables
   cannot cross process boundaries." Trellis' tool allow/denylist belongs exactly
   there. The `environment=` selector is req 5 partly realised in the library
   Trellis already depends on.

**Net:** an isolation-boundary backend leaves the rlms driver unchanged if it
implements the three methods, forwards the handler socket in, and re-exposes tools
as descriptors/broker stubs. The `_SAFE_BUILTINS` whitelist becomes redundant
defence-in-depth once real OS isolation exists.

**Paper anchor:** "Recursive Language Models," Zhang, Kraska, Khattab,
[arXiv:2512.24601](https://arxiv.org/abs/2512.24601) (v1 Dec 2025, v3 May 2026).
It is an *inference strategy*, not an architecture — which is precisely why the
REPL underneath it can be swapped.

---

## 3. The central tension and its resolution

The tension the whole search circled: `LocalREPL` is convenient **because** tools
are live host objects in the model's process, and that is **also** the security
hole. Every real boundary breaks live-object injection.

The resolution, arrived at independently by the security branch (as the broker
pattern) and the modularity branch (as the descriptor hinge):

- The caller never hands the backend a live object. It hands a **serializable
  CapabilityDescriptor** `{name, typed_signature, doc, dispatch_ref}` (the MCP
  tool-descriptor shape).
- The **backend materialises** the descriptor privately: in-process it binds the
  real callable into the namespace (today's behaviour, unchanged); out-of-process
  it code-generates a proxy stub in the guest that RPCs `dispatch_ref` back to a
  trusted host broker.
- The **prompt-composer renders** the *same* descriptor as a typed, doc-commented
  stub the model writes code against.

So the isolation boundary is hidden inside one method, and the same object serves
req 5 (swap backends with zero caller change) and req 6 (prompt-composition-by-
function). `llm_query` is just a pre-registered capability, not a special case.

---

## 4. Security & tool-gating (reqs 2 and 3)

### 4.1 The layered boundary model

Ordered by strength. "Adversary-safe" means it holds against a fully hostile
in-sandbox payload, not merely buggy code.

| Layer | What it stops | What it does NOT stop | Perf cost | Adversary-safe? |
|---|---|---|---|---|
| Audit hooks / RestrictedPython (in-process, language-level) | Accidental/flagged ops; telemetry | Same-interpreter escape: `import os`, `ctypes`, MRO walks, removing the hook. PEP 578 self-declares "not sandboxing"; escapes CVE-2023-37271, CVE-2025-22153 | ~0 | **NO — NOT-A-BOUNDARY** |
| CPython subinterpreters (PEP 554/734) | Namespace/concurrency separation | "Just as hard to sandbox as the main interpreter" (core-dev, on record) | very low | **NO** (never pitched as isolation) |
| seccomp-bpf (self-applied, in-process) | Kernel-denies whole syscalls; shrinks host-kernel surface | Anything via allowed syscalls; can't filter pointer args (no path/host rules); one-way ratchet binds trusted tool calls too | negligible | **PARTIAL** (real, coarse) |
| Landlock LSM (self-applied, in-process) | Filesystem-path scoping (5.13+), TCP bind/connect ports (6.7+) — kernel-enforced | Net egress by host/IP (port-only); CPU/mem (needs rlimits/cgroups); Linux-only; does not hide in-process creds | very low | **PARTIAL** (genuine FS/port boundary) |
| Namespaces + cgroups (container / runc) | Resource caps; multi-tenant view isolation | Shared-kernel attacks — one kernel LPE = host compromise. Leaky Vessels CVE-2024-21626; CVE-2024-1086 (userns, actively exploited) | near-native | **NO** vs a determined adversary sharing the kernel |
| gVisor (runsc) | Userspace kernel (Sentry) intercepts syscalls; host sees ~50 Sentry syscalls; removes whole host-kernel CVE classes | Sentry bugs; some info-leak CVEs; app-compat gaps; not a hardware boundary | ~800ns/syscall; ~1–3% for most apps, 10–30%+ on I/O/syscall-heavy | **YES-ish** (strong; the standard for untrusted code without a VM) |
| Firecracker / Kata microVM | Hardware-virt (KVM) boundary; own guest kernel; escape needs a VMM exploit | Side-channels in principle; rare VMM bugs (Firecracker logged its first two escape-class CVEs in 2026: CVE-2026-5747, CVE-2026-1386) | ~125ms boot, <5 MiB/VM overhead; near-native steady-state | **YES** (strongest commonly-deployed) |

### 4.2 The capability broker (where the denylist gets an engine)

In-namespace injection can *allow* a tool but is structurally incapable of
*denying* one — so today's tool denylist has no enforcement point. The broker
pattern gives it one:

- The sandbox holds only a **dumb proxy facade** (`pg`, `neo4j`, `llm_query`). A
  call like `pg.query(sql, params)` is serialized into `{tool, sql, params}` and
  written over the **single** IPC channel the sandbox's seccomp policy permits
  (unix socket for gVisor; **vsock** for a microVM).
- A **trusted host broker** holds the real credentialed clients, checks the request
  against policy (tool allowlist, read-only DB role by default, parameterized-only
  queries, row/byte caps aligned to the ~20k budget, audit log), executes, and
  returns only results.
- **Deny-by-default network** means the sandbox has no route to the DB host at all —
  so even a full language-level escape yields zero DB reachability without the
  broker.

**The credentials problem, specifically.** Trellis injects live Neo4j/Postgres
clients whose credentials are reachable through their attributes. Under the broker,
drivers + DSN + password + connection pool + DB network route exist **only** on the
host side. For HTTP-shaped tools and `llm_query`, a credential-injecting egress
proxy (the Vercel-firewall / Cloudflare-outbound / CubeEgress shape — three
independent designs converged on it) attaches the upstream secret at the network
edge so guest code never holds it.

**Cost.** One IPC round-trip + serialization per tool call — tens of µs (unix
socket) to sub-ms (vsock), negligible beside the DB query and orders of magnitude
below an LLM call. The **real tax** is on code-mediated-text ergonomics: the model
calls a *fixed facade method surface*, not an arbitrary live object (no driver
introspection, no server-side cursors, no `pg.connection.dsn`). Mitigate by making
the facade feel native — same method names, returns plain lists/dicts, covers the
common verbs — so most model-authored code is unchanged.

### 4.3 The Tier-0 nuance (in-process kernel hardening)

The minimal-tier branch found a third option between "in-process/insecure" and
"out-of-process/RPC-tax": **self-applied Landlock + seccomp-bpf + rlimits/cgroups**
on the REPL process at startup, before any model code runs. It is kernel-enforced
(unlike every Python-level restriction), costs ~0, needs no fork, and **keeps tools
live in-namespace** — so it hardens the *current* shape without the broker rewrite.

Its honest ceiling: Linux-only; a one-way ratchet (once applied it also binds
trusted tool calls); it does not bound CPU/memory without cgroups; and — decisively
— **it does not isolate process memory or hide in-process credentials.** The model
can still read a DSN off a live client object; Landlock only stops it opening *new*
fds to unauthorized paths/hosts. So Tier 0 is a cheap, real hardening layer and a
strong "minimal & performant" answer to reqs 1–2 *for the filesystem/egress
classes* — but it is **complementary to the broker, not a replacement**. Physical
credential isolation and memory isolation require the Tier-1 out-of-process
boundary.

### 4.4 Two ways to place the boundary — the key design fork

The survey clarified that every sandbox *product* cuts the boundary **between the
model and its tools**, which is exactly what breaks in-namespace injection. But the
boundary does not have to be placed there. There are two placements, and the choice
is Trellis' most consequential design decision:

- **(A) Boundary between model-code and tools — the broker.** The sandbox holds
  dumb proxy facades; a trusted host broker holds the credentials, drivers, and
  policy engine (§4.2). Strongest: credentials are *physically* outside the sandbox,
  so a full in-sandbox compromise still reaches no DB. Cost: every credentialed tool
  call is an RPC stub, and the ergonomic tax of §4.2 applies.

- **(B) Boundary around the whole tool-bearing worker.** Run the `LocalREPL` worker
  — tools, live client objects and all — *inside* gVisor/runsc or an nsjail/bubblewrap
  jail. In-namespace `self.locals[name] = live_client` injection is preserved intact
  (no RPC tax, RLM-compat trivial); the boundary moves around the entire process.
  This is the pattern gVisor's own docs report frontier labs use for code execution
  rather than a hosted sandbox SaaS. Cost: the model's code shares the process with
  the live DB clients, so it *can* read a DSN or reuse a live connection —
  credential *confidentiality* is not guaranteed. What contains that is
  **deny-by-default network egress** (Landlock/netns): the code can read the
  credential but has nowhere to send it, and cannot reach any host the policy did
  not allow.

- **(Hybrid) Boundary around the worker, broker only for the credentialed tools.**
  Wrap the whole worker in gVisor (B) for the escape/egress boundary, keep cheap
  creds-free tools (regex/pandas over text, the answer channel) live in-namespace,
  and proxy only the *credential-bearing* DB tools through the broker (A) so the DSN
  never enters the worker. Preserves the pillar's ergonomics for the common case and
  pays the RPC tax only where a real secret is at stake.

**Which one is right is a threat-model decision for the owner:** how adversarial is
the model's *own* code, given it can be steered by retrieved content? If
"trusted-but-fallible" (accidents, injection nudges), (B) or the hybrid buy most of
the security at a fraction of the ergonomic and engineering cost. If "assume the
code is hostile and after the DB credentials," only (A)'s physical credential
separation suffices. Recommended default: the **hybrid**, raised to full (A) for the
credentialed surface if the threat model demands.

---

## 5. The candidate backends — comparison matrix

Verdicts are for Trellis' six requirements, weighing self-hostability (req 5) as a
hard filter per the brief ("never locked in").

| Backend | Isolation mechanism | Self-host / lock-in | Cold start | Tool-gating | RLM/Python-REPL fit | Verdict for Trellis |
|---|---|---|---|---|---|---|
| **LocalREPL (today)** | in-process `exec` + `_SAFE_BUILTINS` | n/a | ~0 | none enforceable | native (live injection) | Baseline; insecure + locked-in — the thing to replace behind a seam |
| **Landlock+seccomp (self-applied)** | kernel LSM + syscall filter, in-process | fully open, Linux-only | ~0 | FS paths + TCP ports (kernel); no cred/memory isolation | native (tools stay live) | **Tier-0 hardening.** Cheapest real boundary; pair with broker for creds |
| **gVisor / runsc** | userspace kernel (Sentry) | Apache-2.0, self-host, no lock-in | ~50–100ms (UNVERIFIED); 10–30% syscall tax | netns + Gofer/9P FS; broker for tools | container-shaped; RPC broker needed | **Tier-1 baseline.** Lowest lift to self-hosted real boundary |
| **Kata Containers** | KVM microVM + `kata-agent` vsock RPC | Apache-2.0, self-host, no lock-in | ~150–300ms boot | per-VM NIC + host policy; broker for tools | VM-grade; **kata-agent is a working guest↔host RPC reference** | **Tier-1 VM-grade, best req2×req4.** Medium lift; inherits containerd tooling |
| **Firecracker (bare)** | KVM microVM, native vsock | Apache-2.0, self-host, no lock-in | ~125ms | none built-in (you build it) | VM-grade; **vsock preserves today's "local socket" latency almost exactly** | Best latency mapping, **highest build cost** (kernel/rootfs/jailer/pooling). First 2 escape CVEs in 2026 |
| **E2B** | Firecracker | open (Apache-2.0), but self-host = "a real infra project" (Nomad/Consul/TF/Packer, GCP-first) | ~150ms (snapshot-restore) | firewall + egress allow/deny (SNI/Host only) | Jupyter kernel, stateful (closest to `self.locals` out of the box) | Fast path if you accept running E2B's platform; weaker on reqs 5/6 (you maintain their infra) |
| **microsandbox** | libkrun microVM (own kernel; KVM/HVF/WSL2) | Apache-2.0, embeddable/self-host | ~200–320ms boot | host-side net stack allow/block/private-net | `exec()` only — **no confirmed stateful REPL** (build rlms statefulness on top) | Strong minimal self-host microVM; young (2024, YC X26); stateful-REPL gap |
| **CubeSandbox (Tencent)** | KVM microVM, E2B-protocol-compatible; eBPF egress + L7 credential-injecting proxy | Apache-2.0, fully self-host | ~67ms avg (vendor, UNVERIFIED) | eBPF IP/port + HTTP domain/path allow-deny + credential injection | Jupyter-kernel stateful via E2B SDK; RPC, no live injection | Strong isolation + a ready credential-broker shape; **~3 months old, no independent audit** |
| **Vercel Sandbox** | Firecracker (verified in Vercel docs) | **HOSTED-ONLY, single region iad1 — fails req 5** | ~24s real (snapshot ~9s); "ms" is marketing | 3-mode egress + **credentials brokering at the edge** (the pattern to steal) | process-exec, no persistent kernel | Not adoptable (lock-in). **Steal the firewall/credential-broker design as Trellis' own contract** |
| **Modal Sandboxes** | gVisor + custom syscall layer | **engine not self-hostable (only the SDK) — fails req 5** | sub-1s claimed (UNVERIFIED) | network allow/deny; secure-by-default | `exec`-style; stateful Jupyter session unconfirmed | Excluded on req 5. If you want gVisor, use gVisor directly |
| **Daytona** | shared-kernel containers (default); VM tier undocumented | **core engine closed-source June 2026; not genuinely self-hostable — fails req 5** | ~90ms warm (image cached; no cold number) | network perimeter only (CIDR/domain) | stateful `CodeInterpreter` context (close to `self.locals`) | Excluded on reqs 2/5. **Live cautionary tale for req 5** — "open today" is not durable |
| **Pyodide / WASM (WASI)** | CPython→WASM, capability deny-by-default | open, self-host | multi-second per instance | WASI capability list (Wasmtime object-capability is the cleanest req-3 fit); nothing native in bare Pyodide | pandas runs (75+ wheels); **DB drivers do NOT (no raw TCP sockets)**; breaks injection | Out for the DB-tool path unless tools become brokered HTTP. Multiple 2025/26 escape CVEs (Cellbreak CVE-2026-24002, CVE-2026-5752 CVSS 9.3); Deno+Pyodide reference unmaintained (Jan 2026) |
| **Northflank / microsandbox / codapi / Piston** | Kata (Northflank); libkrun microVM (~200ms, microsandbox); container+isolate (codapi/Piston) | self-host (varies) | 200ms–container-start | whole-VM/container network egress | separate-env-over-API; full RPC | Northflank worth a look for an air-gapped Kata posture; the runners are wrong-shape for an embeddable, constantly-called REPL |

### 5.1 Ranking of the self-hostable engines

1. **gVisor** — lowest lift to "self-hosted, minimal, swappable real boundary";
   weaker isolation *class* (syscall filter, not VM) is the honest tradeoff.
2. **Kata Containers** — near-identical lift once containerd is running, but a real
   VM boundary **and** a maintained vsock-RPC reference (`kata-agent`) mapping almost
   directly onto the `llm_query`/tool-proxy problem. The strongest req-2 × req-4
   combination found.
3. **Firecracker (bare)** — best theoretical RLM mapping (native vsock preserves the
   local-socket latency profile), highest build cost; choose over Kata only to keep
   containerd machinery out of the stack.
4. **E2B** — fastest to a working RLM-shaped stateful Python sandbox, at the cost of
   operating E2B's platform.
5. **CubeSandbox** — architecturally excellent and self-hostable with a ready
   credential-broker, but too new to trust as load-bearing without an audit.

Hosted-only (Vercel, Modal) and closed/closing (Daytona) are excluded by req 5.

---

## 6. The swappable seam (req 5) — proposed interface

**PROPOSAL, language-neutral.** The seam speaks only four value types — an opaque
`SessionHandle`, code strings, serializable `CapabilityDescriptor`s, and
value-reprs/bytes — and **never** a live object, socket, or container id. That is
what keeps transport from leaking, so LocalREPL and a microVM sit behind the
identical interface.

```
# ---- MUST ----
open_session(spec) -> SessionHandle
    # spec = { template/image, resource+time limits, env, initial_context?, ttl }
    # abstracts: LocalREPL(new namespace) | container | microVM | WASM

execute(handle, code, deadline, output_cap) -> ExecResult
    # ExecResult = { stdout, stderr, value_repr, error?, truncated, spill_handle? }
    # the ONE substrate primitive; stateful namespace persists across calls

register_capability(handle, descriptor) -> void
    # descriptor = { name, typed_signature (JSON-Schema), doc, dispatch_ref }
    # in-process  : bind the real host callable into the namespace
    # out-of-proc : codegen a guest proxy stub that RPCs dispatch_ref to the broker
    # llm_query / rlm_query are PRE-REGISTERED capabilities, not separate methods

close_session(handle) -> void

# ---- OPTIONAL ----
attach(opaque_id) -> SessionHandle      # reconnect a live session (E2B connect / Modal from_id)
reset(handle) -> void                   # clear namespace without teardown
extend_deadline(handle, dur) -> void
snapshot(handle) -> ref / restore(ref) -> SessionHandle   # warm-start / persistence
poll(handle) -> Status                  # non-blocking liveness
put_bytes/get_bytes(handle, path, …)    # files; can be built on execute()
stream(handle, on_stdout, on_stderr)    # live output callbacks
```

**Shapes to steal (cited prior art), leaks to avoid:**

- **E2B** — `run_code(code, context=…)` stateful contexts, `connect(id)`,
  `set_timeout`, stdout/stderr streaming, structured result. Closest match to the
  MUST set. *Avoid:* stringly `commands.run(shell)` as the primary primitive.
- **Modal** — `from_id` reconnect, non-blocking `poll`/`wait`,
  `snapshot_filesystem`. *Avoid as seam surface:* `exec(process)` and `tunnels()`
  leak transport — keep behind the opaque handle.
- **Daytona** — the *explicit* stateless-`code_run` vs stateful-`session` split
  makes "does the namespace persist?" a named choice. Mirror it.
- **MCP** — the `{name, description, inputSchema}` tool descriptor is exactly the
  `CapabilityDescriptor` shape; it already crosses process boundaries by design.
- **LangChain sandbox** — providers implement a `BaseSandbox` with a single
  `execute()`; every filesystem op is built on it. Validates collapsing files/grep
  into OPTIONAL helpers over `execute`.
- **rlms** — the `environment=` strategy selector (req 5 already realised) and
  `llm_query`-as-a-name-in-the-namespace. *The named leak:* `self.locals[name] =
  live_object`, the one shape that cannot cross a boundary — which is the exact
  tension the descriptor indirection hides.

---

## 7. Prompt-composition-by-function (req 6)

The "assemble meta-prompts and code-snippets internally to pass to the model"
requirement is **strong, measured prior art** — three teams converged on
"render tools as a typed, doc-commented API the model writes code against":

- **Anthropic — code execution with MCP:** MCP servers presented as a filesystem of
  typed code modules; the model writes code that chains calls; intermediate data
  stays in the execution env; tools load on demand via `search_tools`. Reported
  ~150,000 → ~2,000 tokens (98.7%). Adds in-env PII tokenisation so raw values never
  reach the model.
- **Cloudflare — Code Mode:** converts the MCP schema to a **TypeScript API with doc
  comments** and asks the model to write TS against it, running in a V8 isolate wired
  via bindings that RPC back to the MCP client. Rationale: "LLMs have an enormous
  amount of real-world TypeScript in their training set, but only a small set of
  contrived tool-call examples." Reported ~1.17M → ~1,000 tokens.
- **smolagents CodeAct / "executable code actions":** Python code *is* the action
  space; the model emits and runs snippets each step. CodeAct (Wang et al., ICML
  2024) reports higher success on 12/17 models, up to +20% absolute and up to 30%
  fewer interactions vs JSON/text actions.

**Design principles extracted** (they map cleanly onto Trellis' pillar):

1. Render tools as **typed function stubs with doc comments**, not JSON-schema-in-
   prose — code the model saw at pretraining beats synthetic tool-call formats.
2. **Progressive disclosure** — expose a discovery surface so only needed signatures
   enter context.
3. **Keep data in the execution environment** — return summaries/final values, never
   round-trip intermediate results through context.
4. **Composition primitives for free** — variables, control flow, chaining collapse
   many tool-call round-trips into one action.
5. **Feed execution feedback (tracebacks) back as observations** for self-debug.
6. **One descriptor, two renderings** — the same `CapabilityDescriptor` the backend
   materialises (§6) is what the composer renders as a stub. This is the hinge that
   makes reqs 5 and 6 one mechanism.

**Minification / state-slicing (Trellis' "work with minified code" goal).** The
biggest savings in the prior art are **structural — never emitting the data**: tool
schemas collapse to ~1–2k tokens because full definitions and intermediate results
never enter the prompt. Applied to Trellis: (a) render capability stubs as
signature + one-line doc, bodies stripped; (b) **slice-by-address** — the engine
returns node-ids / line-ranges the model re-queries, rather than shipping content
(this is the code-mediated-text pillar realised as a slicing API, and it aligns with
the existing `get_ast_blocks` accessor in
[CODE_MEDIATED_TEXT.md](../../architecture/CODE_MEDIATED_TEXT.md)); (c)
`ExecResult.value_repr` is a capped `repr`/`head` with a `spill_handle` the model
re-slices — `df.head()` made a first-class seam field.

---

## 8. Open items to close before any build (owner-gated)

These are the source-reads and decisions the research explicitly could not settle
from the web, flagged so no build starts on an unverified belief (the house rule:
a documented bound with no engine behind it reads exactly like an enforced one).

1. **Read the pinned `rlms==0.1.3` source locally** (`pip download`), not just the
   GitHub main branch, and confirm byte-exact: the `LMRequest`/`LMResponse`/
   `REPLResult` field schemas (`rlm/core/types.py`), the `BaseEnv` ABC signatures,
   and **how rlms materialises tools in its *isolated* backends today** (code-string
   injection vs a real RPC proxy stub — the single most important thing to read
   before finalising `register_capability`).
2. **Confirm the handler bind host.** Does `LMHandler.start()` with `port=0` bind
   `127.0.0.1` or `0.0.0.0`? This decides directly whether a sandbox in a separate
   network namespace can reach the sub-LLM socket, and how the port-forward/vsock
   bridge must be built.
3. **Pick the Tier-1 engine by measurement, not by table.** gVisor's syscall tax
   (10–30% on I/O-heavy work) vs a microVM's ~125ms boot is a Trellis-specific
   warm-per-session-REPL question. Run the existing park/seed drill shape at target
   size against a candidate backend before committing.
4. **Resolve the Windows-host reality.** The strong boundaries (seccomp, Landlock,
   KVM, gVisor) are Linux. The dev host here is Windows, so the sandbox layer must
   run in a Linux VM/WSL2 or a Windows-native equivalent (restricted token + Job
   Object + WFP, as Codex uses). This is a deployment-shape decision, not a code
   detail. (See the WSL Linux CI repro precedent in the team's notes.)
5. **Decide the tier commitment.** Tier 0 (self-applied Landlock+seccomp) can land
   independently as cheap hardening; Tier 1 (out-of-process + broker) is the larger
   commitment that actually satisfies reqs 2/3 against an adversary. The owner
   should choose whether to stage (Tier 0 now, Tier 1 later) or go straight to
   Tier 1.
6. **CubeSandbox / Firecracker CVE currency and audit status** — re-check before any
   adoption; CubeSandbox has no independent audit (3 months old), and Firecracker's
   2026 escape CVEs mean the microVM tier must pin patched versions.

---

## 9. Sources

Primary sources cited by the research agents (all seen 2026-07-20):

- RLM paper — [arXiv:2512.24601](https://arxiv.org/abs/2512.24601); repo
  `github.com/alexzhang13/rlm`; `pypi.org/project/rlms/` (0.1.3, MIT, Python ≥3.11).
- Security: PEP 578; RestrictedPython advisories (CVE-2023-37271, CVE-2025-22153);
  runc CVE-2024-21626 (Leaky Vessels), CVE-2024-1086; `gvisor.dev/security`;
  `github.com/firecracker-microvm/firecracker`; kernel.org Landlock & seccomp docs;
  Cloudflare outbound-broker changelog; the "AI Code Sandboxes: A Comparative
  Security Study" preprint (arXiv:2606.08433).
- Engines: `github.com/e2b-dev` (E2B + infra); `modal.com/docs`; Kata vsock design
  docs; `docs.microsandbox.dev`; TencentCloud/CubeSandbox docs; Vercel Sandbox docs
  (`vercel.com/docs/sandbox`, firewall/credentials-brokering); Daytona docs +
  closed-source announcement (`daytona.io/dotfiles`); `github.com/tizkovatereza/awesome-ai-sandboxes`.
- Composition: Anthropic "code execution with MCP"; Cloudflare "Code Mode";
  smolagents CodeAct + Wang et al. (ICML 2024); MCP tools spec;
  `github.com/langchain-ai/langchain-sandbox`.
- WASM/minimal: Pyodide wasm-constraints + escape CVEs (Cellbreak CVE-2026-24002,
  N8Scape CVE-2025-68668); `bytecodealliance/wasmtime-py`; PyPy sandbox docs; PEP
  554/734; nsjail/bubblewrap/Deno security docs.

---

## 10. Round 2 — the stack decision (July 20, 2026)

*Status: RESEARCH — UNRATIFIED, same gate as the rest of this document. Five
Sonnet-5 sub-agents, commissioned after the owner selected the hybrid boundary, to
answer: which isolation stack runs the worker — CubeSandbox + gVisor, or Kata + gVisor?*

### 10.1 Verdict — Kata Containers + gVisor (staged); CubeSandbox is NOT-YET

**Recommended: Kata Containers (Cloud Hypervisor VMM, pinned ≥ 3.31.0) as the outer
hardware boundary, with gVisor (Systrap platform) as an OPTIONAL, deferred inner
hardening layer.** Confidence: medium-high. Four of five agents concur; the split
was only on whether the inner gVisor layer is worth it day-one (§10.2).

Why Kata over CubeSandbox:

- **CubeSandbox's off-the-shelf advantage evaporates.** Its one structural edge was
  CubeEgress as a ready credential-injecting broker — but CubeEgress is confirmed
  **L7 HTTP/HTTPS-only** and cannot frame, gate, or credential-inject **Postgres
  wire protocol or Neo4j Bolt** (raw binary TCP). Trellis builds the DB broker
  either way, so the comparison reduces to substrate quality — and **vsock** (a
  generic multi-port `AF_VSOCK` channel) is a far cleaner base for a raw-TCP-aware
  broker than bending an HTTP Lua proxy.
- **Workload shape fits Kata.** CubeSandbox is engineered for many short-lived
  ephemeral executions (snapshot cloning, sub-60ms boot, thousands concurrent);
  Trellis runs one **persistent stateful worker per session** — Kata's "boot one
  microVM, run one process as long as you want" model, without Cube's multi-service
  fleet control plane as unavoidable overhead.
- **Maturity/audit asymmetry.** Kata: ~8 years, OpenInfra multi-vendor governance,
  a public CVE/advisory process (evidence of adversarial testing), production at
  scale. CubeSandbox: ~3 months, single-vendor, core hardening still "Coming Soon,"
  an OPEN sandbox-escape-class issue (#838), no third-party audit (§11).

**The vsock advantage, concretely** (the load-bearing technical finding): every Kata
VM already has a virtio-vsock device, and *any* guest process — not just kata-agent
— can open its own `AF_VSOCK` port, which the host maps 1:1 to an `AF_UNIX` socket.
So both crossings reuse it additively, no Kata patching: the **DB broker** is a host
process the guest reaches on one vsock port, and **`llm_query`** swaps loopback-TCP
for `AF_VSOCK` carrying the *identical* 4-byte-length + JSON frame (zero protocol
redesign).

### 10.2 The one honest disagreement — is the "+ gVisor" layer worth it?

The two security-focused agents split, and the split is recorded rather than smoothed:

- **Defense-in-depth agent:** nest gVisor (Systrap) inside the microVM — the layers
  fail *independently* (gVisor's Go Sentry does not expose the raw pmem/DAX device
  surface that produced Kata's 2026 CVEs), so stacking genuinely reduces risk.
- **gVisor deep-dive agent:** pick one strong boundary, not both. No production
  operator nests gVisor inside a microVM for agent code execution; Anthropic's own
  "How we contain Claude" post uses **gVisor alone** (claude.ai) or **a VM alone**
  (Cowork), never nested; Modal uses gVisor alone. The marginal gain is narrow, the
  cost compounds against req 1.

**Resolution (both are right about different things):** the hardware VM is the
non-negotiable primary boundary for Trellis' adversarial, retrieval-steerable code.
gVisor-Systrap inside the guest is a **real but bounded** hardening increment —
**optional and deferred**, added only if a concrete threat or a benchmark justifies
the compounding cost, and if added, **only via the Systrap platform, never gVisor's
KVM platform inside a VM** (that specific nesting is theater: pure cost, no
independent gain, warned against by gVisor's own docs). This matches Anthropic's
stated principle: match isolation strength to the oversight available, prefer
battle-tested primitives, be wary of custom glue. Correction recorded: "Kata
configured to use gVisor" is *not* a real configuration — they are separate
runtimes; the only real composition is running `runsc` as the in-guest runtime.

### 10.3 The recommended architecture (concrete)

- **Outer boundary:** Kata microVM, Cloud Hypervisor VMM (Rust, virtio-only,
  ~200ms boot), pinned ≥ 3.31.0. The whole rlms worker runs inside as a long-lived
  process (design B — in-namespace tool injection preserved, RLM-compat trivial).
- **Only channel out = vsock.** `llm_query` over `AF_VSOCK` (identical framing); DB
  tools call a narrow `run_query`/`run_cypher` RPC over a second vsock port.
- **Trusted tool broker (host side):** holds the real Neo4j/Postgres clients +
  credentials, terminates the DB wire protocol, enforces a **statement-level
  denylist** (block `DROP TABLE`, unbounded `MATCH`, …), read-only role by default,
  row/byte caps, audit log. Credentials never enter the guest. (Prior art: AWS RDS
  Proxy for Postgres, `bolt-proxy` for Bolt — reference, not dependency; proxy
  parsers are a known CVE class, so the broker stays small and auditable.)
- **Egress:** deny-by-default at the **host/VMM NIC** (eBPF/nftables), never inside
  the guest (a guest-side denylist is NOT-A-BOUNDARY — attacker-root can flush it).
- **Cheap creds-free tools** (regex/pandas over text, the answer channel) stay live
  in-namespace — the code-mediated-text ergonomics preserved for the common case.
- **Seam:** the rlms driver stays; a Trellis `BaseEnv` subclass implements
  `setup`/`load_context`/`execute_code`; tools are CapabilityDescriptors materialised
  as vsock proxy stubs (§6).

### 10.4 First-prototype plan (each spike closes a real unknown, none is a build)

1. **Close the source-reads:** read pinned `rlms==0.1.3` (`BaseEnv` signatures,
   `LMRequest`/`LMResponse`/`REPLResult` schemas, how isolated backends materialise
   tools) and Kata `docs/design/VSocks.md` + the containerd-shim-kata exec path.
2. **Boundary + persistence:** `ctr run --runtime io.containerd.kata.v2` on a
   Linux+KVM host (test WSL2 nested-KVM reliability early; fall back to a cloud dev
   VM); confirm boot-once / keep-state / exec-many.
3. **`llm_query` over vsock:** raw `AF_VSOCK` port; confirm framing + latency survive.
4. **DB broker minimal proof:** Postgres first (simpler wire protocol) — host-side
   broker with real creds; guest completes a real query with zero credential
   material in the guest; then Bolt.
5. **gVisor inner layer (Systrap):** confirm in-namespace injection + vsock still
   work; decide ship-day-one vs defer per §10.2.
6. **Author the real `BaseEnv` subclass** wrapping the above behind the three-method
   contract.

### 10.5 Visualization

The trust zones, the vsock channels (connection), the narrow
CapabilityDescriptor/vsock interface where the zones touch (overlap), and the nested
boundaries + credential isolation + denied egress (isolation) are drawn in
[`repl_sandbox_architecture.svg`](repl_sandbox_architecture.svg) and a rendered HTML
page (`repl_sandbox_architecture.html`).

## 11. CubeSandbox adoption audit — verdict: NOT-YET

A dedicated source-level audit (findings confirmed at the docs + issue-report layer,
not a raw source read — flagged). **Verdict: NOT-YET**, medium-high confidence. Two
independent blockers, either sufficient on its own:

1. **CubeEgress is L7 HTTP/HTTPS-only** — it cannot broker Postgres/Neo4j Bolt, so
   it contributes zero off-the-shelf value for Trellis' actual tool traffic (and its
   TLS-MITM egress path could *mangle* a raw-TCP DB protocol, not just fail to auth
   it). CubeVS is L3/L4 CIDR allow/deny only — no protocol or credential awareness.
2. **An OPEN "super-critical" sandbox-escape-class issue (#838)** — a mount-namespace
   `setns()` path filed 2026-07-09, still unresolved — sits against the exact
   trust-boundary code, alongside **no SECURITY.md, no advisories, no third-party
   audit, ~3 months old, 9 release-candidates in ~27 hours** (unstable cadence).

Additional risks: bare-metal KVM required (nested virt unsupported for production);
XFS-reflink mandatory; all performance numbers vendor-only; no documented
general-purpose guest↔host socket for an `llm_query`-style channel (vsock is used
only by the internal shim). **Revisit conditions:** issue #838 closed with a shipped,
independently-read fix; hands-on confirmation that a sandbox can reach a
Trellis-hosted broker over a permitted raw-TCP path; and an independent security
audit. Even then Kata remains the better fit on workload shape, maturity, and the
raw-TCP broker substrate (§10.1).

---

## 12. Recursion & multiplicity — many workers, and workers that spawn workers (July 20, 2026)

*Status: RESEARCH — UNRATIFIED. Three sub-agents (rlms recursion internals, isolation
granularity, recursive-orchestration prior art). Answers the owner's questions: can one
Sentry/guest host multiple rlms REPL workers, and can a worker spawn its own sub-agents?*

### 12.1 What rlms actually does (read from the pinned source, local install)

- **`rlm_query` gives each child its OWN REPL.** `RLM._subcall` constructs a brand-new
  `RLM(...)` per recursive call, which spawns a fresh `LMHandler` (own thread, own TCP
  socket, own ephemeral `127.0.0.1` port) and a fresh `LocalREPL` with its own namespace.
  Nothing is shared with the parent. **But** at Trellis' current **`max_depth=1`**,
  `rlm_query` never reaches that branch — it degrades to a bare one-shot completion.
  Real child-REPL recursion requires `max_depth ≥ 2`.
- **`llm_query` (flat) vs `rlm_query` (recursive):** `llm_query` is a socket round-trip
  to the already-running handler — one completion, no REPL, no code-exec surface.
  `rlm_query` (depth-permitting) drives a full nested `RLM.completion()` loop with its own
  REPL. Flat fan-out has nothing new to isolate; recursive fan-out does.
- **Multiplicity within one process:** confirmed — one OS process can host arbitrarily
  many `LocalREPL`/`LMHandler` instances (threads), so the whole recursion tree runs
  in-process by default. Each level regenerates its own loopback handler (not propagated).
- **The caps are NOT a security boundary.** `max_concurrent_subcalls` (4) only bounds one
  batched call's thread pool, and `_SAFE_BUILTINS` still exposes `__import__`, so
  model-authored code can `import threading`/`subprocess`/`socket` and spawn unbounded
  fan-out, bypassing the governor entirely. **Fan-out/CPU/memory ceilings must be enforced
  by the microVM/broker, never by rlms.** Budget/timeout/token caps *are* propagated to
  children (a child is refused if the parent's remaining budget is exhausted), but as soft
  Python bookkeeping, not an OS ceiling. (Also closes a round-1 open item: the handler binds
  `127.0.0.1`, and no vsock-reachable bind override was found exposed — confirm before the
  transport swap. rlms' own `DockerREPL` HTTP-proxy is the out-of-process broker precedent
  to copy; isolated backends drop live host callables and take tools as code/JSON.)

### 12.2 The empirical warning that reframes the question

A reproduction study ([arXiv:2603.02615](https://arxiv.org/abs/2603.02615)) measured
**depth-2 as actively harmful**: accuracy *drops* (e.g. 86.6%→55%) and latency explodes
**~96×** (3.6s → 89s → 344s for one extra level); no scenario favored depth ≥ 2. So the
recommendation is to **keep `max_depth=1` as a hard, broker-enforced ceiling**, treat the
recursion machinery below as *what must exist before depth is ever raised*, and require
Trellis-specific evidence — not RLM-generic optimism — to raise it.

### 12.3 Multiplicity — never share a guest between adversarial workers

| Granularity | Sibling isolation | Per-worker resource control | Cost | Identity | Use |
|---|---|---|---|---|---|
| Many processes in one guest/Sentry | **weak** — shared guest kernel + one `kata-agent`; a root-in-guest bug reaches every sibling | only what the guest sets up; gVisor can't cap between processes in one sandbox | cheapest | shared CID — broker can't tell workers apart | non-adversarial helper subprocesses only |
| Container-per-worker (Kata pod) | weak-medium — still one guest kernel + agent | per-container cgroups; vCPU threads unconstrained by default | low | one CID/pod | mutually-trusting multi-container apps |
| **microVM-per-worker** | **strong** — separate kernel + KVM boundary per worker | full host cgroup/vCPU pinning per VM | medium (~150–300ms boot; mitigate with a warm pool) | **CID = free, guest-non-spoofable identity** | **Trellis default: one worker = one session** |
| gVisor-sandbox-per-worker | medium-strong — separate Sentry, shared host kernel | sandbox-level cgroups | very low (~50–100ms) | needs its own token scheme | the optional inner layer, or a lighter tier |
| Nested child sandbox | fragile/expensive | — | high (nested-virt 10–20%, >10× I/O) | non-standard | not the default (see 12.4) |

**Verdict:** microVM-per-worker for anything running model-authored code; never co-tenant
two sessions in one guest. CVE-2026-24834 (a container→guest-root escape, patched in Kata
**3.27.0**, below Trellis' 3.31.0 pin) is the concrete proof of what a shared guest costs.
The vsock **CID** — host-assigned, unspoofable by the guest — is a free per-worker identity
anchor the broker can trust, which is one more reason to keep one worker per VM.

### 12.4 Recursion — the child-isolation decision: host-brokered sibling pool

For a recursive child that gets its own REPL (`rlm_query`, depth ≥ 2), the choice is
**(a)** same sandbox as parent, **(b)** a nested VM the guest spawns, or **(c)** a sibling
microVM the *host* mints on request. **Recommended: (c).**

- **(a) same-sandbox — rejected** for model-authored code: it puts adversarial child code
  in the parent's own process/interpreter (mutate parent globals, read what the broker
  injected), reintroducing exactly the shared-fate failure the Kata decision removed.
- **(b) nested VM-in-VM — rejected as default:** nested virtualization is unreliable
  across clouds (the very gap that produced Kata's peer-pods feature) and costly
  (~10–20% CPU, >10× I/O), and it would hand the *guest* a privileged hypervisor handle —
  the ambient authority the vsock-broker design exists to deny.
- **(c) host-brokered sibling pool — recommended:** the parent's `rlm_query` becomes an
  **RPC to the host broker** over its existing vsock channel (`spawn_child(prompt, budget)`).
  The broker checks depth/fan-out/spend, then claims a **fresh sibling Kata microVM from a
  warm pool**, stamps it with identity `(run_id, node_path)`, wires a **child→broker-only**
  vsock edge (never child↔parent), relays the result back to the parent as an ordinary
  return, and meters everything. The guest never gains "create compute" — only "ask the
  broker for compute." This matches every surveyed platform (Modal/E2B spawn is
  control-plane-side, never guest-initiated) and the Kubernetes Agent-Sandbox `SandboxWarmPool`
  precedent turns a spawn into a sub-second claim, not a cold boot. **Cost fallback:** if
  VM-per-child is too expensive, downgrade a *policy-marked-lower-trust* child to
  **gVisor-Systrap inside the parent's guest** (no nested virt needed) — weaker, cheaper,
  and only for children that can inherit the parent's guest-kernel fate.

### 12.5 Bounds & policy across the worker tree (all broker-enforced)

- **Depth:** `max_depth` ceiling derived by the broker from a lineage record *it* created
  at spawn time — never guest self-reported. (Ceiling = 1 today.)
- **Fan-out:** a per-parent cap **and** a tree-wide transitive cap (~10) — per-parent alone
  still explodes combinatorially (the Claude Code incident: recursion → 48 agents / 1.5M tokens).
- **Spend:** one **dollar-denominated** ledger keyed by root `run_id`, decremented by every
  node — tokens don't compose across a heterogeneous-model tree; dollars do.
- **Identity & attenuation:** every child gets a broker-minted `(run_id, node_path)` token
  that is a strict subset of the parent's (narrower tool scope, lower quota remainder,
  depth+1, short TTL); the guest can't forge it (never holds the signing material). Every
  credential, sub-call, and egress attempt is tagged with `node_path` for per-node audit.
- **Containment:** a compromised child is confined to its own microVM (child→broker edge
  only); the broker can revoke one node's channel/credentials without aborting the run.

### 12.6 How the diagram changes

Add one logical box — **"spawn broker / warm pool"** (part of the existing host broker) —
and one new edge class, **broker ↔ sibling child-microVM**, repeated per live child.
Explicitly do **not** add a parent↔child edge and do **not** give any guest hypervisor
access. Depth stays capped at 1 in the live-traffic path; the sibling-pool machinery is the
prerequisite that must exist *before* depth is ever safely raised — and §12.2 is a reason to
doubt raising it is worth it at all. (The companion recursion diagram accompanies this record.)

---

## 13. Judged selection — the four-role panel on Kata vs gVisor vs Firecracker (July 20, 2026)

*Status: RESEARCH — UNRATIFIED. Ran the judge-composition ceremony (S10 four-role
panel: grounding / coherence / corroboration / audit) at the owner's request to select
among the three finalists. The candidate = the §10.1 recommendation, which THIS document's
author wrote — the self-invested-claimant case the ceremony exists to harden against.
Authorship was masked from the belief-facing judges; the forecast was pre-registered
separately.*

### 13.1 Disposition: promote-weakened

**Kata Containers is the panel-endorsed primary boundary for Trellis' specific profile**
(persistent per-session worker, vsock reuse, self-host, containerd), at **medium-high
confidence**, carrying four refinements the panel extracted:

1. **The three are not flat alternatives (J2, category-error on the "microVM" grouping).**
   Firecracker is a VMM; Kata *runs on* a VMM (Cloud Hypervisor or Firecracker); gVisor is
   a different, userspace-kernel layer. The real decision is: *microVM approach (Kata, on a
   VMM) vs gVisor*; and within the microVM approach, *Kata's managed runtime vs bare
   Firecracker*.
2. **microVM-preferable-as-primary is threat-tier-dependent, not universal (J3, tempered by
   the audit).** Independent evidence shows operator practice is split — Modal runs
   **gVisor** (not a microVM) for untrusted agent code at 50k+ concurrency. The audit (J4)
   noted J3 over-generalized: general untrusted-tenant use is not the same threat as a model
   deliberately generating sandbox exploits, so the microVM-preferable claim is *stronger*
   for Trellis' adversarial model-authored threat than the raw corroboration drawback
   implied. Net: microVM as primary is well-justified *for Trellis*; gVisor-alone remains a
   legitimate lighter choice at a typical threat tier.
3. **Confidence, restored (J1, overclaim).** The filed claim dropped the record's own
   "medium-high confidence"; it is carried back.
4. **The nested gVisor-inside-Kata design is unprecedented (J3, uncorroborated).** No
   independent source describes it; sources treat gVisor and Kata as parallel alternatives.
   So gVisor stays **optional/deferred** (exactly as §10.2 staged), not a validated part of
   the primary recommendation.

### 13.2 The audit's integrity catch, recorded honestly

J4 found **no judge gamed its rubric**, and the visible drawbacks leaned *against* the
author's own thesis (3 of 4) — evidence the masked-authorship + included-disconfirming-
evidence composition did real work and did not rubber-stamp. Its sharpest finding is carried
without softening: item **I4** ("Kata reduces build-lift for the vsock broker / llm_query
channel") is the claim that most reduces *this author's own downstream implementation
burden*, and it is the only item that drew **zero** drawbacks from any judge — because no
seat's remit tests for *motivated framing*. The underlying fact (bare Firecracker is "just
the VMM"; you build lifecycle/networking yourself) is independently corroborated, so I4 is
not baseless — but **build-lift is an implementer-convenience argument and must never be
weighed as a security argument.** If composer-favorable bias exists, that unexamined item is
where it hides; the caveat is carried, not dropped.

### 13.3 What the panel did and did not change

It did **not** overturn the round-2 selection — it hedged and refined it, and independently
identified the **gVisor-nesting as the weakest link**, converging with the round-2
gVisor-deep-dive dissent (§10.2). **Selection stands: Kata on Cloud Hypervisor as the primary
boundary, medium-high confidence; gVisor optional/deferred; Firecracker is the VMM *under*
Kata, or the bare-metal alternative only if avoiding containerd machinery is worth the build
cost.** The panel run cost $0 (no paid models; sub-agent research only).

---

## 14. Security red-team of the live design (July 21, 2026)

*Status: RESEARCH — UNRATIFIED. An adversarial review (assuming the in-sandbox Python is
hostile) read the actual Trellis source (`src/rlm/*.py`) plus the ratified design. Verdict:
the shape is right — Kata microVM + vsock-only + host broker — but there are real,
code-grounded gaps the prose did not cover. With the fixes below the design is sound.*

### 14.1 The correction owed first — the version pin was a category error

The ratified note said "Cloud Hypervisor pinned ≥ 3.31.0." **`3.31.0` is a *Kata Containers*
version, not a Cloud Hypervisor one** — different upstreams, different schemes (Cloud
Hypervisor is at v52). Read literally, that pin closes the Kata-side CVE (CVE-2026-24834,
guest-root via pmem/DAX, fixed Kata 3.27.0) but leaves **Cloud Hypervisor itself unpinned** —
potentially exposed to **CVE-2026-27211** (a malicious guest rewrites its own virtio-block /
QCOW2 header to point at a host path; a guest reboot then makes the hypervisor serve that host
file back into the guest — arbitrary host-file read; fixed CH 50.1) and **CVE-2026-45782**
(virtio-block use-after-free; fixed CH 52.0). **Correct pins: Kata ≥ 3.31.0 (≥ 3.27.0 floor)
AND Cloud Hypervisor ≥ 52.0 — pinned separately, tracked on separate advisory feeds.**
Wherever this document earlier wrote "Cloud Hypervisor ≥ 3.31.0," read the split pins.

### 14.2 The deepest finding — deny-by-default egress does not stop exfiltration

The two crossings the design *sanctions* — `llm_query` (to an external LLM API) and
`trellis_answer.submit` (final answer to the operator) — plus `vector_search` (a second
external-embeddings API call) are exactly the channels a hostile worker uses to exfiltrate.
The NIC deny-by-default is blind to them; the answer channel's only guard is a 64 KB *volume*
cap (`ANSWER_CONTENT_MAX_CHARS`), not content. **Fix: content-scoped DLP + per-session
cumulative-byte caps on `llm_query`/`vector_search`, and treat the answer channel as an
audited egress control point — not just a size cap.** This restates as: *the security
guarantee must hold when the model does exactly what a hostile document tells it to.*

### 14.3 The must-add list (the live design's real security requirements)

From 14 findings (4 critical, 6 high, 4 medium). None invalidates the architecture:

1. **Content DLP + per-session byte caps** on the sanctioned crossings (`llm_query`,
   `vector_search`, answer) — deny-egress is blind to them. *(critical)*
2. **LLM provider API key host-side only**, symmetric with the DB-credential design — rlms'
   `LMHandler` is in-process by default, so verify the relocation removes the key from guest
   env (`os.environ` is reachable — `__import__` is exposed). *(critical)*
3. **Split version pins** — Kata ≥ 3.31.0 AND Cloud Hypervisor ≥ 52.0 (§14.1). *(critical)*
4. **Auth by kernel vsock peer CID, never a guest-supplied id** — a shared broker/LM-handler
   must attribute quota/scope by the CID from `accept()`, or a compromised worker in session
   A forges session B (confused-deputy / IDOR). *(critical)*
5. **Host-side CID-keyed hard ceilings** on `llm_query` concurrency, rate, and dollar spend —
   rlms' caps are bypassable via raw threads (`__import__`). *(high)*
6. **APOC/plugin allowlist deny-by-default** on Neo4j + DB-host egress denial — `READ` access
   mode does not block `apoc.load.json(...)` SSRF to a metadata service. *(high)*
7. **`statement_timeout` + query-cost limits + forbid unbounded `[*]` Cypher paths** — row
   caps bound output, not planner cost (a cartesian join scans huge data, returns one row). *(high)*
8. **In-guest `pids`/memory cgroups + a host watchdog** that kills/replaces wedged VMs — a
   fork/thread bomb can't reach the host but can DoS the session's own VM. *(high — this is the
   Tier-0 in-guest hardening the tier note in §0/round-2 recommends.)*
9. **Least-privilege Postgres role** — `NOSUPERUSER`, no `pg_read_server_files` /
   `pg_execute_server_program` / `dblink`, closing `COPY TO PROGRAM` / `pg_read_file`. *(medium)*
10. **Security-review the vsock bridge** (new, unbuilt glue) — minimal, loopback-only,
    unprivileged, fuzz-tested frame parser. *(medium)*
11. **Warm-pool policy** (if pooling): single-use VMs or pre-execution-snapshot restore +
    rootfs hash — no state bleed between tenants. *(high, contingency)*
12. **Document that prompt-level defenses are NOT security controls** — `trellis_task.verify()`
    is a forgeable substring check (the guest reads `trellis_task.uuid` and re-wraps forged
    text); task-precedence prompting is UX. The sandbox must hold under 100% successful prompt
    injection — the tool/network boundary is the only real backstop. *(high/medium)*

The microVM contains *host escape*; these guards contain *what a fully-steered worker can read
and send*. Tier-0 hardening covers #8; the rest are broker/handler/config work, not new
isolation.

## 15. Deployment host — DigitalOcean ruled out (July 21, 2026)

Kata + Cloud Hypervisor **requires real `/dev/kvm`**. Without it Kata usually **fails to
start**, and any QEMU-TCG fallback is **5–35× slower AND loses the hardware VM boundary**
(isolation degrades to trusting the emulator's code) — so "KVM present and accelerated" is a
hard gate, not a config nicety.

- **DigitalOcean: ruled out.** Standard Droplets expose `/dev/kvm` but DO staff call nested
  virt **unsupported, no-SLA, "not recommended — poor performance"**; there is no
  general-purpose bare-metal product as a fallback. Do not put the security boundary on it.
- **Recommended: a Hetzner *dedicated* (Root) server** (AX41/AX42) — true bare metal, **native**
  KVM, best $/resource (~€40–100/mo), strongest self-host / no-lock-in. *(Must be the dedicated
  line; Hetzner Cloud VPS does not expose nested virt.)*
- **Elastic alternatives:** **AWS EC2 C8i/M8i/R8i** (new Feb-2026 nested-virt on standard
  instances, ~$68/mo) or **GCP N2/C2** (`--enable-nested-virtualization`, mature since 2017,
  ~$71–83/mo).
- **The gate before committing any host:** `kata-runtime check` / `kata-ctl check` (Kata's own
  KVM validator) + a functional smoke test (`qemu -accel kvm -cpu host`; benchmark inside vs.
  host — near-native = real, 5–30× slow = a silent TCG fallback).

**Not pursued (owner, July 21):** **CubeSandbox and bare Firecracker are dropped** —
CubeSandbox was NOT-YET (§11) and Firecracker is unneeded now that Kata-on-Cloud-Hypervisor is
the choice. Both remain in §5/§10 only as evaluated-and-rejected options.

---

## Appendix A — landscape survey (cross-check)

The awesome-ai-sandboxes survey enumerated ~30 options. The field splits into ~25
**hosted-microVM-as-a-service** products (Firecracker/CloudHypervisor/libkrun,
RPC-only) and a small set of **open process/VM primitives** you assemble yourself.
**The universal finding corroborates §4.4:** every product — hosted *or*
self-hostable — exposes Python execution over an RPC/HTTP API and cuts the boundary
between the model and its tools; none preserves live in-namespace object injection.
The only architecture that avoids the RPC tax is running rlms' own worker *inside* a
kernel primitive (gVisor/nsjail) — design (B).

Notable options not already in the §5 matrix, and corrections to the source list:

- **microsandbox** (in §5 now) — libkrun microVM, embeddable, Apache-2.0, best
  documented perf; the strongest "hosted-ish but still yours" middle ground.
- **Wasmtime / WASI** — object-capability model (a component gets exactly the typed
  capabilities you hand it); the cleanest req-3 fit in the survey, but needs a
  WASM-compiled Python and inherits the no-raw-socket DB limitation.
- **langchain-sandbox** — Pyodide-in-Deno with Deno's `--allow-*` permission flags;
  the closest existing OSS precedent to "RLM-compatible + explicit tool blacklist,"
  but unmaintained (Jan 2026) and DB-socket-limited.
- **Baponi** — nsjail + seccomp, MCP-native tool gating, multi-week session
  persistence (closest stated match to rlms' persistence); process-level (shared
  kernel), closed core, no independent maturity signal — watch, don't commit.
- **Declaw** — Firecracker + a distinctive 6-stage outbound pipeline (TLS-intercept
  → PII redaction → prompt-injection scoring → domain allow/deny → audit) with
  explicit MCP-server sandboxing; a useful *reference feature-set*, but zero public
  repo (vendor-claimed only).
- **Northflank** — self-hostable with a *choice* of Kata / Cloud Hypervisor /
  Firecracker / gVisor; the closest managed-but-portable option for an air-gapped
  posture.
- **Corrections to the awesome-list:** Daytona is listed "Apache-2.0 / self-hosted"
  but is actually **AGPL-3.0 on a frozen v0.190.0 snapshot with core dev moved
  private (June 2026)** — stale on its flagship entry. **Modal** was confirmed to
  spawn a *fresh subprocess per `exec()`* — **no persistent namespace**, so it is
  not a drop-in for rlms' stateful `LocalREPL` regardless of the req-5 exclusion.
- Everything else in the survey is either hosted-only / closed (ruled out by req 5:
  Vercel, Cloudflare, Fly.io Sprites, CodeSandbox, Blaxel, Box, Novita, Freestyle,
  Morph, Runloop, Tensorlake, Islo, Leap0) or wrong-shape for an embeddable REPL
  (Steel.dev browser sandbox; h5i git-worktrees; Piston/Judge0 stateless judges).``
