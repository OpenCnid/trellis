# Trellis REPL Sandbox — Session Learnings

**What this is:** the durable knowledge from the July 20–21, 2026 research push that produced
the [architecture](REPL_SANDBOX_ARCHITECTURE.md) and [spec](REPL_SANDBOX_SPEC.md). It records
*what was learned and why*, including the beliefs that turned out wrong — so the next builder
inherits the corrections, not just the conclusions. The full evidence trail is
[REPL_SANDBOX_RESEARCH.md](REPL_SANDBOX_RESEARCH.md).

---

## 1. The central tension (the whole problem in one line)

`rlms`' `LocalREPL` is convenient **because** tools are live host objects in the model's own
process — and that is **also** the security hole (model-authored code shares the process with
DB credentials and `import os`). *Every real isolation boundary breaks in-process object
injection.* So the entire design is the negotiation of that trade: keep the ergonomics the
code-mediated-text pillar depends on, while putting a real boundary between hostile code and
the host's secrets.

## 2. RLM compatibility is cheap (the biggest de-risk)

- The rlms backend contract is **three methods** (`setup` / `load_context` / `execute_code`
  on `BaseEnv`; subclass `IsolatedEnv` for a separate machine).
- The sub-LLM `llm_query` channel is **already out-of-process** — JSON-over-TCP to an
  `LMHandler`. Recursion/fan-out survives any boundary reachable by a socket.
- Upstream already anticipates isolation (an `IsolatedEnv` split; the `DockerREPL` HTTP-proxy
  bridge is the precedent for the vsock bridge; isolated backends take tools as code/JSON, not
  live callables).

**Lesson:** RLM-compat was the feared blocker and turned out to be the cheapest part. The real
work is the *adapter + broker + host-side caps*, not the sandbox choice.

## 3. Boundary selection — the ladder, and two overreaches I had to correct

- **Language-level is NOT a boundary.** RestrictedPython / audit hooks / `_SAFE_BUILTINS`
  (which still exposes `__import__`) are accident-safe + telemetry only. Never count them.
- **The real ladder:** self-applied Landlock+seccomp (in-process, kernel-enforced) → gVisor
  (userspace kernel) → Kata/Firecracker microVM (hardware). For adversarial, retrieval-steerable
  code, the hardware microVM is the right *primary* — but this is threat-tier-dependent (Google
  runs gVisor-alone for Gemini; Modal runs gVisor at 50k concurrency).
- **Overreach #1 — "Kata + gVisor" was wrong.** I led with a *nested* gVisor-inside-Kata stack;
  the evidence (and the owner's pushback) said no operator nests them — they are *parallel
  alternatives*, not a stack. The honest inner layer is in-guest seccomp/Landlock, not a second
  runtime. Corrected: **Kata microVM, full stop; gVisor evaluated and not adopted.**
- **Overreach #2 — the version pin was a category error.** "Cloud Hypervisor ≥ 3.31.0" is
  nonsense: `3.31.0` is a *Kata* version; Cloud Hypervisor is a different project at v52.
  Pinning one left the other exposed (CH CVE-2026-27211 = guest→host file read). **Pin distinct
  upstreams separately, on separate advisory feeds.**

**Lesson (both overreaches):** when two components look like one choice, name the seam. And a
version number belongs to exactly one project — never carry a pin across upstreams.

## 4. The CapabilityDescriptor hinge (modularity + composition in one object)

`{name, typed_signature, doc, dispatch_ref}` (the MCP tool-descriptor shape). The backend
*materialises* it (bound callable in-process; RPC proxy stub out-of-process → swap backends
with zero caller change) and the prompt-composer *renders* it (a typed doc-commented stub the
model writes code against). Prior art converged independently: Anthropic code-execution-with-MCP,
Cloudflare Code Mode, smolagents CodeAct. Minification is *structural* — never emit the data;
return slice-by-address handles, which is the pillar realised as a slicing API.

## 5. Depth — flat fan-out is the value; recursion is not

- `max_depth` 1 = flat parallel sub-LLM completions (no child REPL) — this is the RLM paper's
  own evaluated default and where the parallelism value lives.
- `max_depth` 2 (children get REPLs) was **measured harmful** (accuracy drops, latency ~96×;
  arXiv:2603.02615, no scenario favored it). The flat fan-out already does the decomposition,
  so REPL-recursion is largely redundant — which is *why* depth-2 shows no win.
- Ecosystem agrees: Anthropic multi-agent = one level; Claude Code subagents can't spawn
  subagents. **Ratified: `max_depth` 1.** The sibling-microVM machinery is contingency only.

**Lesson:** "possible" ≠ "advisable." The recursion machinery I'd elaborately designed is
shelved; the live system is one microVM + flat fan-out.

## 6. Deny-by-default egress does not stop exfiltration

The deepest security finding: the channels the design *sanctions* (`llm_query`, `vector_search`,
the final `answer`) are exactly the exfil channels — they carry model-controlled text out, and
the NIC block is blind to them. **The guarantee must hold when the model does exactly what a
hostile document tells it to.** Guards: content-DLP + per-session byte caps on those crossings;
the answer channel is an audited egress point, not a size cap.

**Corollary — prompt-level defenses are not security.** `trellis_task.verify()` is a forgeable
substring check (the guest can read `trellis_task.uuid` and re-wrap forged text). Task-precedence
prompting is UX. The tool/network boundary is the only real backstop.

**Resolution (July 21, 2026, owner Cnid; collaborator Matt) — the boundary is data-flow, not a
filter.** Content inspection over model-controlled text can't be the guarantee (no perfect
cover). The fix is to make the guest hold **addressable handles, not secret-bearing payloads**
(the broker resolves them host-side) — so the sanctioned crossings can't leak what was never
materialised, *even under 100% successful injection*. On top of that, a **"double cover"**
composed from the **existing -1 doubt tier** ([DOUBTS_WORKSPACE](../../architecture/DOUBTS_WORKSPACE.md)):
a mechanical, provenance-grounded doubt that strips command-authority from untrusted-retrieved
instructions (the §7 automatic-contest path) and a semantic defeater panel on the outbound
content that *attaches findings, never enforces* (§7). **Lesson:** the strong move was not a
better filter — it was converting an unsolvable content problem into a solved data-flow one,
then treating the doubt framework as labelled Tier-2 defense-in-depth (realisable as an
in-context meta-prompt *or* a TTT-trained tooling-call; robustness is the composition, not the
substrate), which by DOUBTS_WORKSPACE §7 the engine cannot count as a boundary anyway. Full
model: [ARCHITECTURE §3.1](REPL_SANDBOX_ARCHITECTURE.md).

## 7. Identity: the vsock CID is a free, unspoofable anchor

Kernel-assigned per guest, not choosable by the guest. The host broker/handler **must**
attribute quota/scope by the CID from `accept()`, never by an id inside the request payload —
otherwise a shared broker is a cross-session confused-deputy (session A forges session B).

## 8. Deployment: the host is load-bearing (the DigitalOcean trap)

Kata + Cloud Hypervisor needs real `/dev/kvm`; without it Kata usually *fails to start*, and any
QEMU-TCG fallback is 5–35× slower **and loses the hardware boundary**. **DigitalOcean droplets
expose `/dev/kvm` but DO calls nested virt unsupported/no-SLA** — do not build a security
boundary on it. Use a Hetzner *dedicated* server (native KVM) or AWS C8i / GCP N2 (nested virt);
gate on `kata-runtime check`.

**Lesson:** "a VM boots" ≠ "the VM has hardware KVM." Verify acceleration, not presence.

## 9. rlms internals worth remembering *(read byte-exact from the pinned install)*

- `_SAFE_BUILTINS` blocks `eval`/`exec`/`compile`/`input`/`globals`/`locals` but **still exposes
  `__import__`** — so `import threading/subprocess/socket` is available; rlms' own concurrency
  caps are bypassable. Ceilings must live at the OS/VM/broker layer.
- Transport is hardcoded `AF_INET`; `LMHandler` binds `127.0.0.1` **unauthenticated**.
- A recursive child gets its *own* fresh REPL (new namespace + own socket) — but only at
  `max_depth ≥ 2`; at 1 it degrades to a flat completion. The whole tree runs in one process by
  default (threads).
- Budget/timeout/token caps *are* propagated to children (soft Python bookkeeping, not an OS
  ceiling). `COPY TO PROGRAM` / `pg_read_file` / `dblink` and Neo4j `apoc.load.*` are the DB-side
  escape primitives to deny.

## 10. GKE Agent Sandbox — orthogonal, and it confirmed the direction

It is a Kubernetes orchestration layer (open `kubernetes-sigs/agent-sandbox` + a Google-managed
add-on), **not an isolation mechanism** — it delegates to gVisor OR Kata via `runtimeClassName`,
never stacked. Google defaults to gVisor (its own hardened runtime); the *self-hosted* precedent
(Red Hat's downstream build) defaults to **Kata** — the same conclusion Trellis reached. Its
warm-pool/claim/per-unit-identity *pattern* is worth borrowing (with the state-reset caveat) if
pooling is ever added.

## 10a. What the first real microVM taught (S2, July 23, 2026)

Three things the records could not have told us, all of them provisioning facts that a *passing*
`kata-runtime check` hides:

- **A validated host is not a wired host.** G1 passed with the Kata shim sitting in `/opt/kata/bin`,
  which is not on containerd's `PATH`; `ctr run --runtime io.containerd.kata.v2` fails there while
  every G1 condition still reports green. The gate proves capability, not reachability — the house
  distinction (correct ≠ reachable) showing up in infrastructure.
- **The default config points at the neighbour of the ratified pin.** Kata ships
  `configuration.toml` as a symlink to `configuration-qemu.toml`. Installing Cloud Hypervisor v52.0
  and stopping there gives a host that boots QEMU guests while the operator believes the ratified
  VMM is in use. This is the same shape as the G1 finding (Kata bundling its own Cloud Hypervisor at
  v51.1): **both upstreams ship a default that quietly disagrees with the pin.**
- **A provisioning script needs a negative control as much as a probe does.** Running
  `provision_kata_host.sh` against the host it was written from proves only that it can say
  "already". Planting the three breaks it exists to fix — and watching `--verify` name all three
  without touching them, then a real run converge them — is the only version of that run that
  carries information. Its fetch-and-install branch is *still* unexercised, because a host that
  already has Kata cannot test installing Kata.
- **Boot is fast enough that the persistence question is the whole question.** ~0.7 s from `ctr run`
  to first exec means boot cost is not what makes state worth keeping — correctness across turns is.
  The probe therefore asserts the *identity* of the guest (worker pid, guest `boot_id`) alongside
  the namespace, and the negative control fires all three.

## 11. Meta-learning: the review methods caught the builder's own errors

Worth recording because it validates the house methods (and because I was the self-invested
claimant throughout):

- The **judge-composition ceremony** (four differently-blind seats, authorship masked) caught my
  *filing inflation* (I dropped a confidence hedge to strengthen my own claim) and flagged the
  one item that most served my own implementation convenience (the "build-lift" argument) as the
  place unexamined bias would hide.
- The **security red-team** (reading the actual source) caught the version-pin category error and
  the exfil-via-sanctioned-crossings gap the prose glossed.
- A plain **render check** caught a rendering bug I'd shipped repeatedly (the artifact's inline
  diagrams had undefined color tokens → black text; verified via computed style, then fixed).

**Lesson:** the builder's own read is not trustworthy evidence. Clean-room judges, an adversarial
red-team, and an actual render/verify step each caught a class of error the builder could not see
from the inside — exactly what they exist for.

---

*Architecture: [REPL_SANDBOX_ARCHITECTURE.md](REPL_SANDBOX_ARCHITECTURE.md) ·
Spec: [REPL_SANDBOX_SPEC.md](REPL_SANDBOX_SPEC.md) ·
Full trail: [REPL_SANDBOX_RESEARCH.md](REPL_SANDBOX_RESEARCH.md).*
