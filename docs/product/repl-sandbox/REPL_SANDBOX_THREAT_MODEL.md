# Trellis REPL Sandbox — Threat Model

**Status: DESIGN — consolidated threat model for owner-ratified decisions; NOT built.**
This is the single authoritative threat model for the REPL sandbox. It consolidates the
scattered security material — [REPL_SANDBOX_ARCHITECTURE.md](REPL_SANDBOX_ARCHITECTURE.md) §7
(Security requirements), [REPL_SANDBOX_SPEC.md](REPL_SANDBOX_SPEC.md) §6 (Security invariants),
and the red-team of [REPL_SANDBOX_RESEARCH.md](REPL_SANDBOX_RESEARCH.md) §14 (Security red-team
of the live design) — into one maintained model, and is their single source of truth going
forward. It leads implementation (document-driven; nothing runs). Repo authority ordering is
unchanged: code > glossary > prose. Diagram: [isolation view](repl_sandbox_architecture.svg).

**House rule, load-bearing throughout:** a documented bound with no engine behind it is not a
control. Every row's control names an *enforcing surface*; every residual risk is stated as
**accepted** or **tracked**. Telemetry-only and defense-in-depth mechanisms are quarantined in
§7 (NOT a boundary) and **must never appear in an "Enforced by" cell** anywhere in the repo.

---

## 0. Scope & authority

- **Consolidates, does not re-decide.** The stack is owner-ratified (July 20–21, 2026); this
  record documents its security posture faithfully and adds no new controls. Where a control's
  mechanics live in a sibling doc — the handle/state model
  ([REPL_SANDBOX_DATA_MODEL.md](REPL_SANDBOX_DATA_MODEL.md)), the wire/RPC contracts
  ([REPL_SANDBOX_INTERFACES.md](REPL_SANDBOX_INTERFACES.md)), the PROPOSED doubt-filter
  ([REPL_SANDBOX_DOUBT_FILTER.md](REPL_SANDBOX_DOUBT_FILTER.md)) — this doc references them and
  does not restate the mechanism. Build sequencing lives in
  [REPL_SANDBOX_BUILD_PLAN.md](REPL_SANDBOX_BUILD_PLAN.md).
- **Consolidation target.** REPL_SANDBOX_ARCHITECTURE.md §7 (Security requirements) and
  REPL_SANDBOX_SPEC.md §6 (Security invariants) should point *here* for the full model; the
  §6 traceability table (§6 below) dedupes their contents against the RESEARCH §14 findings so
  there is one list, not three.
- **The pins, stated once and never conflated.** **Kata ≥ 3.31.0 AND Cloud Hypervisor ≥ 52.0**
  — two upstreams, two version schemes, two advisory feeds. Writing "Cloud Hypervisor ≥ 3.31.0"
  is the category error that left a real project unpinned (REPL_SANDBOX_RESEARCH.md §14.1 (The
  correction owed first — the version pin was a category error)); never write it.

## 1. Assets — what a hostile worker is after

| Asset | Where it lives | Compromise impact |
|---|---|---|
| **Provider LLM API key** | Host LM handler **only** | Billing theft; unmetered model access; pivot |
| **DB credentials** (Neo4j DSN+password, Postgres DSN+password) | Host broker **only** | Full DB read/write outside policy; lateral movement |
| **Knowledge-graph contents** (the user's doubts/beliefs/facts) | Neo4j/Postgres, reachable *only* via the broker | Confidentiality loss of the user's data — the thing the pillar exists to protect |
| **Host kernel / filesystem** | Host | Full host compromise; all sessions |
| **Other sessions' data** | Separate microVMs (one per session) | Cross-tenant confidentiality loss |
| **Cloud metadata / internal network** | Reachable only if egress leaks | SSRF → credential theft → cloud-account pivot |
| **Compute** (CPU/mem/PIDs, spend) | The guest VM; the metered LLM budget | DoS of the session; runaway spend |

## 2. Trust zones — the concentric boundaries

From outermost-hostile inward to trusted host. The load-bearing boundary is the microVM
(Zone-U → Zone-H crossing); everything inside Zone-U is assumed fully compromised.

| Zone | Contents | Trust | Boundary *out* of this zone |
|---|---|---|---|
| **U — the namespace** | Model-authored Python + retrieved content; cheap creds-free tools (regex/pandas over text); proxy stubs; `answer`/`llm_query` names | **Hostile** | Language layer is **NOT** a boundary (§7) |
| **G — the guest** | Kata guest kernel + Tier-0 hardening: cgroups (pids/mem/cpu) + seccomp allowlist + Landlock | **Untrusted, blast-radius-capped** | **Kata microVM (KVM/VT-x)** — the boundary (Tier-1) |
| **— the two chokepoints —** | vsock port → LM handler; vsock port → DB broker (§3) | Boundary crossings | Per-session listener identity at `accept()` (§ note below) |
| **H — the host** | LM handler, DB broker, egress policy, watchdog, warm pool; the API key + DB credentials + DB network route | **Trusted** | — |

The single load-bearing control is fact #1 of REPL_SANDBOX_ARCHITECTURE.md §2 (Trust model):
a hardware-KVM guest kernel per session contains host escape. Tier-0 (fact #2) limits blast
radius *inside* Zone-G with failure modes independent of the VMM. Credentials and the API key
(fact #3) live only in Zone-H — the guest can *ask* the host to act; it can never *be* the host.

## 3. Crossings — the two vsock chokepoints

The whole worker runs inside one microVM; **vsock is the only channel out**
(REPL_SANDBOX_ARCHITECTURE.md §3 (Data plane — what crosses, and how)). Wire framing (4-byte
big-endian length + UTF-8 JSON) and RPC surface are specified in REPL_SANDBOX_INTERFACES.md;
this doc treats them only as attack surface.

1. **vsock → LM handler** — `llm_query` flat sub-LLM fan-out (and `vector_search`, a second
   external-embeddings egress). The handler holds the provider API key, authenticates by CID,
   enforces CID-keyed spend/rate/concurrency ceilings, and runs content-DLP on outbound text.
2. **vsock → DB broker** — `run_query` / `run_cypher`. The broker holds the real
   Neo4j/Postgres clients + credentials, terminates the DB wire protocol, runs a read-only
   NOSUPERUSER role by default, enforces `statement_timeout` + query-cost caps + an APOC
   allowlist, and audits every call by CID.
3. **The `answer` channel** — the final answer to the operator is an **audited egress control
   point**, not merely a 64 KB size cap (REPL_SANDBOX_ARCHITECTURE.md §3.1 (The exfiltration
   resolution — data-flow, not content inspection)).

**Exfil is a data-flow property, not a content filter (ratified).** The three sanctioned
crossings carry model-controlled text out and the NIC deny-block is blind to them. The boundary
is that **the guest holds addressable *handles*, never secret-bearing payloads** — the broker
resolves handles host-side, so the crossings cannot leak what was never materialised in the
guest. This holds under 100% successful injection. Content-DLP, per-session byte caps, and the
composed doubt-filter (Layers 1–2) are defense-in-depth on top and are **never the boundary**
(§7; full model in REPL_SANDBOX_ARCHITECTURE.md §3.1 (The exfiltration resolution — data-flow,
not content inspection), PROPOSED mechanics in REPL_SANDBOX_DOUBT_FILTER.md). The handle model is the code-mediated-text pillar realised
([CODE_MEDIATED_TEXT.md](../../architecture/CODE_MEDIATED_TEXT.md) §0 (The pillar)).

## 4. Adversary model

**The Python inside the REPL is model-authored and retrieval-steerable — treat it as hostile.
The guarantee must hold when the model does exactly what a hostile document tells it to: assume
100% successful prompt injection.** Prompt-level "task precedence" is UX, not a control.

**What the adversary CAN do (assumed, not hoped-against):**

- Execute arbitrary Python. `_SAFE_BUILTINS` still exposes `__import__`, so `import
  os / threading / subprocess / socket / ctypes` and a full same-interpreter escape are
  available (REPL_SANDBOX_LEARNINGS.md §9 (rlms internals worth remembering)).
- Read anything materialised in the guest: `os.environ`, in-namespace tool objects, retrieved
  content. (This is *why* secrets must never be materialised in the guest.)
- Issue arbitrary sanctioned crossings (`llm_query`, `vector_search`, `answer`, DB RPCs) with
  attacker-chosen content.
- Spawn raw threads/processes, bypassing rlms' own `max_concurrent_subcalls` / budget caps —
  so every ceiling must live at the OS/VM/broker layer, never in rlms.
- Forge `trellis_task.verify()` — read `trellis_task.uuid` and re-wrap forged text past the
  substring check.

**What the adversary CANNOT do (the enforced boundaries):**

- Reach the host kernel (behind the Kata KVM boundary).
- Obtain the DB credentials or the API key (never enter the guest).
- Choose its own identity (the session identity comes from the listener at `accept()`, never from the
  frame — kernel-assigned under native vsock, socket-path-bound under hybrid vsock; [INTERFACES §3.1a (Hybrid vsock)](REPL_SANDBOX_INTERFACES.md)).
- Route to the internet or the cloud metadata service (deny-by-default egress; DB host has no
  such route).
- Reach another session's guest (one microVM per session; never co-tenant).

**Out of scope (tracked elsewhere, see §8):** micro-architectural side-channels (Spectre-class);
supply-chain compromise of Kata / Cloud Hypervisor themselves (tracked via version pins + two
advisory feeds); physical host compromise.

## 5. Attack-surface enumeration

Every surface maps to an enforcing surface and an honest residual. IDs are referenced by the
traceability matrix (§6 (Control-traceability matrix)). "Accepted" = a residual we knowingly
carry (register in §8 (Residual-risk register)); "tracked" = gated by a named future check.

| ID | Attack surface / action | Enforcing control (surface) | Residual risk |
|---|---|---|---|
| **G-1** | Language-level escape: `__import__` → `import os/subprocess/socket/ctypes`, MRO walks, hook removal | **None at the language layer — it is credited with zero enforcement.** Contained one layer out by the **Kata microVM** + Tier-0 (seccomp/Landlock) | **Accepted** — escape is *expected*; the model is designed to survive it (§7) |
| **G-2** | Fork/thread bomb, memory/PID exhaustion (rlms caps bypassable via raw threads) | **In-guest cgroups (pids/mem/cpu)** applied at worker startup + **host watchdog** reaps/replaces wedged VMs | **Accepted, bounded** — self-DoS of the session's *own* VM until the watchdog reaps; no host/cross-session impact |
| **G-3** | Read a secret out of the guest namespace | **Data-flow boundary**: guest holds handles, not payloads; creds + API key never materialised in-guest | **Accepted** — cheap in-namespace tools are creds-free by construction; a secret that is never present cannot be read |
| **VM-1** | Guest→host escape via VMM / guest-kernel exploit | **Kata microVM (KVM)** + **split version pins** (Kata ≥ 3.31.0, CH ≥ 52.0) closing Kata CVE-2026-24834 (guest-share/guest-root escape, patched Kata 3.27.0), CH CVE-2026-27211 (guest→host file read via QCOW2 header rewrite, fixed CH 50.1), CH CVE-2026-45782 (virtio-block UAF, fixed CH 52.0) | **Accepted / tracked** — a zero-day VMM/kernel escape has **no second independent ring** (gVisor not adopted); single-point-of-failure on the VM boundary, tracked on two advisory feeds (R2, §8) |
| **VM-2** | Cross-session escape via a co-tenant worker | **One microVM per session**; never co-tenant two adversarial workers (REPL_SANDBOX_ARCHITECTURE.md §6 (Recursion & multiplicity)) | **Accepted** — none by design today; re-opens only if warm-pooling is added (R3, §8) |
| **BR-1** | Frame-parser exploit in the vsock bridge (new, unbuilt glue; 4-byte-len + JSON) | **Minimal, loopback-only, unprivileged, fuzz-tested bridge**; mandatory security-review before ship | **Tracked** — unbuilt security-critical glue; gated by the red-team pass in REPL_SANDBOX_SPEC.md §8 (Acceptance gates) (R5, §8) |
| **BR-2** | Identity spoofing / cross-session confused-deputy (IDOR) at a shared broker/handler | **Auth by the identity the listener supplies** at `accept()`, never a payload-supplied id | **Tracked, and the mechanism moved** — under the ratified VMM's hybrid vsock there is no kernel CID at the host `accept()`; identity is the per-sandbox socket path the host created ([INTERFACES §3.1a (Hybrid vsock)](REPL_SANDBOX_INTERFACES.md)). The property is preserved, its enforcing surface is the socket path + the VMM directory's mode, and a CID-erasing forwarder is no longer the failure mode to watch — a **mis-bound listener** is. An item for the BR-1 review |
| **LM-1** | Exfil via `llm_query` / `vector_search` prompt text | **Data-flow boundary** (handles not payloads); **content-DLP + per-session cumulative-byte caps** as defense-in-depth (NOT the boundary) | **Accepted, bounded** — bounded exfil *rate*, not zero (R1, §8) |
| **LM-2** | Spend / rate / concurrency abuse (rlms caps bypassable) | **Host-side CID-keyed hard ceilings** on the LM handler: in-flight concurrency, req/sec, dollar spend (hard-stop on exhaustion) | **Accepted, bounded** — within-ceiling spend by a hostile worker, capped per session |
| **LM-3** | Unauthenticated handler reachability (`LMHandler` binds `127.0.0.1`, unauthenticated) | **Never bind `0.0.0.0`**; reach only via the vsock bridge under CID auth | **Tracked** — a misconfigured `0.0.0.0` bind voids it; enforced as a config invariant (REPL_SANDBOX_SPEC.md §3 (Sub-LLM wire contract)) |
| **LM-4** | API-key theft from guest env (`os.environ` reachable via `__import__`) | **Provider API key host-side only**; verify the relocation removes the key from guest env | **Accepted** — none if the key is truly host-only; config-gated |
| **DB-1** | Postgres escape primitives: `COPY TO PROGRAM`, `pg_read_server_files`, `pg_execute_server_program`, `dblink`, `lo_import/export` | **Least-privilege `NOSUPERUSER` read-only role** on the broker denies them; writes = explicit per-tool grant | **Accepted** — a granted write tool widens surface; scoped per-tool at grant time |
| **DB-2** | Neo4j SSRF/exfil: `apoc.load.*` (READ mode does **not** block `apoc.load.json`), `apoc.export.*` | **APOC allowlist deny-by-default** + **DB-host egress denial** (no route to metadata/internet) | **Tracked** — a flaw in an *allowlisted* APOC proc; scoped to the allowlist review |
| **DB-3** | Query-cost DoS: cartesian join, unbounded `[*]` Cypher paths (row caps bound output, not planner cost) | **`statement_timeout` (PG) + Bolt timeout + query-cost caps + forbid unbounded `[*]` paths**; row/byte result caps | **Accepted, bounded** — a within-budget expensive query; bounded by the timeout/cost ceiling |
| **DB-4** | Exfil of DB contents through result rows | **Data-flow** (handles not payloads) + **broker audit by CID** + byte caps | **Accepted, bounded** — bounded rate (R1, §8) |
| **EG-1** | Direct exfil to internet / cloud metadata; SSRF | **Deny-by-default egress at the host/VMM NIC** (nftables/eBPF); DB host has no internet/metadata route | **Accepted** — direct egress is closed; residual is the *sanctioned* crossings only (LM-1/DB-4/AN-1) |
| **AN-1** | Exfil via the final `answer` | **Audited egress control point** (not merely the 64 KB cap) + data-flow boundary | **Accepted, bounded** — bounded rate (R1, §8) |
| **WP-1** | State bleed between tenants **if** a warm pool is ever added | **Single-use VMs or pre-execution-snapshot restore + rootfs-hash reset** (contingency policy) | **Accepted-conditional** — pooling is NOT built; the reset policy is a hard prerequisite before any pooling of adversarial code (R3, §8) |

## 6. Control-traceability matrix

One deduplicated list: each consolidated control aligned across
REPL_SANDBOX_ARCHITECTURE.md §7 (Security requirements) (12 requirements), the
REPL_SANDBOX_RESEARCH.md §14 (Security red-team of the live design) must-add list (12 items
from 14 findings), and the REPL_SANDBOX_SPEC.md §6 (Security invariants) table. They are the
same set of controls; this proves the three sources agree and gives one place to maintain them.

| # | Consolidated control | ARCH §7 | RESEARCH §14.3 | SPEC §6 invariant | Enforcing surface | §5 IDs |
|---|---|---|---|---|---|---|
| 1 | Exfil is data-flow first; DLP + byte caps are defense-in-depth | 1 | 1 (+§14.2) | Exfil via sanctioned crossings bounded | Broker (handle resolution) + LM handler DLP/caps | LM-1, DB-4, AN-1 |
| 2 | LLM provider API key host-side only | 2 | 2 | No DB creds / API key in guest | Host LM handler | LM-4 |
| 3 | Split version pins — Kata ≥ 3.31.0 AND Cloud Hypervisor ≥ 52.0 | 3 | 3 (§14.1) | Host escape contained | Kata + Cloud Hypervisor (pinned, two feeds) | VM-1 |
| 4 | Auth by the listener's session identity, never a guest id | 4 | 4 | Per-session identity unspoofable | Native: kernel vsock CID at `accept()`. Hybrid (ratified VMM): the per-sandbox socket path ([INTERFACES §3.1a (Hybrid vsock)](REPL_SANDBOX_INTERFACES.md)) | BR-2 |
| 5 | Host-side CID-keyed hard ceilings (concurrency/rate/$ spend) | 5 | 5 | No resource-exhaustion host impact | Host LM handler (CID-keyed ledger) | LM-2 |
| 6 | Neo4j APOC allowlist deny-by-default + DB-host egress denial | 6 | 6 | DB stays read-only / no SSRF | Host broker (APOC allowlist) + egress policy | DB-2 |
| 7 | `statement_timeout` + query-cost caps + forbid unbounded `[*]` | 7 | 7 | No resource-exhaustion host impact | Host broker (cost caps) | DB-3 |
| 8 | In-guest cgroups (pids/mem/cpu) + host watchdog | 8 | 8 | No resource-exhaustion host impact | In-guest cgroups + host watchdog | G-2 |
| 9 | Least-privilege Postgres role (`NOSUPERUSER`, deny escape procs) | 9 | 9 | DB stays read-only / no SSRF | Host broker (Postgres role) | DB-1 |
| 10 | Security-review the vsock bridge before ship | 10 | 10 | (gate — SPEC §8) | Pre-ship red-team / fuzz gate | BR-1 |
| 11 | Warm-pool reset policy (if pooling) | 11 | 11 | (contingency) | Single-use / snapshot+hash reset | WP-1 |
| 12 | Prompt-level defenses are NOT security controls | 12 | 12 | NOT a boundary (telemetry only) | *(none — see §7)* | G-1 |

## 7. NOT a boundary — telemetry & defense-in-depth only

**These mechanisms are real and useful, but they are not enforcing surfaces. They must never
appear in an "Enforced by" cell in this repo.** Each reduces the *rate* at which a steered model
acts on injected instructions or narrows accidental damage; none holds under 100% injection.

| Mechanism | What it actually is | Why it is NOT a boundary |
|---|---|---|
| **`_SAFE_BUILTINS`** | Blocks `eval`/`exec`/`compile`/`input`/`globals`/`locals` | Still exposes `__import__` → `import threading/subprocess/socket` reachable; a language-level guard, accident-safe only |
| **Audit hooks** (PEP 578) | Anomaly telemetry on flagged ops | PEP 578 self-declares "not sandboxing"; same-interpreter code can remove the hook |
| **`trellis_task.verify()`** | A task-precedence substring check | Forgeable — the guest reads `trellis_task.uuid` and re-wraps forged text past it |
| **20 KB / 64 KB output caps** | Per-turn stdout truncation (~20 KB) + `ANSWER_CONTENT_MAX_CHARS` (64 KB) | Output-shaping / DoS limits — **not** a confidentiality or escape control (the answer channel's *audit*, not its cap, is the control — AN-1) |
| **Doubt-filter Layers 1–2** | Mechanical provenance-doubt + a composed semantic defeater panel on outbound content, from the −1 doubt tier | **Tier-2**: attaches findings and feeds audit; **never unilaterally enforces** ([DOUBTS_WORKSPACE.md](../../architecture/DOUBTS_WORKSPACE.md) §7 (What doubts do not do), §8 (Composed defeaters)). PROPOSED; mechanics in REPL_SANDBOX_DOUBT_FILTER.md |

**Discipline (non-negotiable):** Layers 1–2 are the "double cover" — a composition of the
*existing* −1 doubt tier, not a new security subsystem — and they may migrate into the control
model **only** as defense-in-depth, never into §5's or §6's enforcing surfaces. They reduce
attempt rate; they do not make exfil impossible. The tool/network boundary is the only real
backstop (REPL_SANDBOX_ARCHITECTURE.md §7 (Security requirements) item 12;
REPL_SANDBOX_RESEARCH.md §14.3 (The must-add list) item 12).

## 8. Residual-risk register — knowingly accepted

Each entry is a residual the design carries on purpose, with why it is tolerable and how it is
tracked. Nothing here is a defect to eliminate; each is a bounded residual to keep in view.

| ID | Residual risk | Disposition | Why tolerable / how bounded | Tracked by |
|---|---|---|---|---|
| **R1** | **Bounded exfil rate** through the sanctioned crossings (`llm_query`, `vector_search`, `answer`, DB results) — **includes the low-bandwidth channels**: the coarse handle `kind` tag, returned address/index sets, and the block-id **content-hash confirmation-oracle** ([DATA_MODEL §6 (The bounded materialisation exception)](REPL_SANDBOX_DATA_MODEL.md)) | **Accepted** | Content inspection over model-controlled natural language is ~unsolved (no perfect cover). The data-flow boundary means the crossings can only leak what was materialised — and handles are not secrets; DLP + per-session byte caps bound the *rate*, not the possibility. The block-id oracle lets the guest *confirm* a guessed value, not read an unknown one — bounded by the same byte/audit caps | Broker audit by CID; per-session cumulative-byte caps; the answer-channel audit log; address-returning ops byte-capped |
| **R2** | **gVisor not adopted → the Kata microVM is a single-point-of-failure** on the VM boundary | **Accepted / tracked** | No production operator nests gVisor inside a microVM for agent code; the honest inner layer is in-guest seccomp/Landlock (Tier-0), which fails *independently* of the VMM but is not a second VM boundary. A zero-day VMM/guest-kernel escape has no second independent ring | **Two advisory feeds** (Kata *and* Cloud Hypervisor), split version pins, host watchdog. Re-open a Systrap inner layer only if a concrete threat or benchmark justifies the cost (REPL_SANDBOX_RESEARCH.md §10.2 (The one honest disagreement — is the "+ gVisor" layer worth it?)) |
| **R3** | **Warm-pool state-bleed** between tenants, *if pooling is ever added* | **Accepted-conditional** | Pooling is not built; one microVM per session has no bleed. If added, a reused unit whose clean-slate reset is undocumented could leak prior-tenant state | Hard prerequisite before any pooling: single-use VMs **or** pre-execution-snapshot restore + rootfs-hash reset (REPL_SANDBOX_ARCHITECTURE.md §4 (Components), Warm pool row) |
| **R4** | **Within-ceiling resource / spend consumption** by a hostile worker | **Accepted** | CID-keyed hard ceilings bound the blast radius to the session's own quota; the watchdog reaps wedged VMs. A hostile worker can burn *its* budget, not the host's | LM-2 ceilings; G-2 cgroups + watchdog |
| **R5** | **The vsock bridge is unbuilt, security-critical glue** | **Tracked** | New code on the boundary; not yet reviewed or fuzzed | Mandatory pre-ship red-team / fuzz pass (REPL_SANDBOX_SPEC.md §8 (Acceptance gates)); BR-1/BR-2 |
| **R6** | **Micro-architectural side-channels; VMM/kernel supply-chain compromise** | **Out of scope / tracked** | Outside the boundary this design controls; mitigation is upstream hygiene, not a Trellis control | Version pins + two advisory feeds; standard host patching |

---

*Architecture: [REPL_SANDBOX_ARCHITECTURE.md](REPL_SANDBOX_ARCHITECTURE.md) ·
Spec: [REPL_SANDBOX_SPEC.md](REPL_SANDBOX_SPEC.md) ·
Full trail: [REPL_SANDBOX_RESEARCH.md](REPL_SANDBOX_RESEARCH.md) ·
Learnings: [REPL_SANDBOX_LEARNINGS.md](REPL_SANDBOX_LEARNINGS.md).
Siblings: [build plan](REPL_SANDBOX_BUILD_PLAN.md) · [data model](REPL_SANDBOX_DATA_MODEL.md) ·
[interfaces](REPL_SANDBOX_INTERFACES.md) · [doubt-filter (PROPOSED)](REPL_SANDBOX_DOUBT_FILTER.md).
Pillar: [CODE_MEDIATED_TEXT.md](../../architecture/CODE_MEDIATED_TEXT.md) ·
Doubt tier: [DOUBTS_WORKSPACE.md](../../architecture/DOUBTS_WORKSPACE.md).*
