# Trellis REPL Sandbox — Build Plan

**Status: DESIGN — build sequence for owner-ratified decisions; NOT built.** This document
sequences the owner-ratified architecture ([REPL_SANDBOX_ARCHITECTURE.md](REPL_SANDBOX_ARCHITECTURE.md))
and spec ([REPL_SANDBOX_SPEC.md](REPL_SANDBOX_SPEC.md)) into a dependency-correct, gated
construction path from nothing-built to a working, gated boundary. It **leads** implementation
(document-driven); it does not re-open any decision. Every milestone carries a falsifiable exit
gate tied to a **named enforcing surface**, and every gate is split into *zero-paid reachability*
versus *paid adoption* (§1). Diagrams the ratified design already owns: [isolation view](repl_sandbox_architecture.svg).

---

## 0. Purpose & scope

The stack is ratified (July 20–21, 2026); this plan only orders the build. **In scope:** the
milestone order, the six elevated prototype spikes, the enforcing-surface map for the 12 security
requirements, the acceptance gates, and the critical path. **Out of scope — do not duplicate:**

| Concern | Authority (reference, never restate) |
|---|---|
| The ratified decisions & trust model | [REPL_SANDBOX_ARCHITECTURE.md](REPL_SANDBOX_ARCHITECTURE.md) |
| Interfaces, config, invariants, acceptance gates | [REPL_SANDBOX_SPEC.md](REPL_SANDBOX_SPEC.md) §8 (Acceptance gates) |
| The adversarial threat detail & the injection/exfil test design | `REPL_SANDBOX_THREAT_MODEL.md` |
| Handle model & session state | `REPL_SANDBOX_DATA_MODEL.md` |
| Wire framing & RPC contracts | `REPL_SANDBOX_INTERFACES.md` |
| The PROPOSED doubt filter (Layers 1–2) | `REPL_SANDBOX_DOUBT_FILTER.md` |
| Evidence trail & the origin 6-spike list | [REPL_SANDBOX_RESEARCH.md](REPL_SANDBOX_RESEARCH.md) §10.4 (First-prototype plan) |

Authority ordering is unchanged: **code > glossary > prose**. Nothing here overrides the records;
where this plan and a ratified record disagree, the record wins.

## 1. The gate law — reachability vs adoption

**House principle (non-negotiable): every zero-paid harness is *scripted*, so its counters measure
the script author, not a model.** Therefore each gate is split, and a reachability pass is **never**
counted as behavioral evidence:

- **[R] Reachability (zero-paid, scripted, deterministic).** Does the wiring exist, round-trip, and
  *enforce*? A named surface is exercised by a scripted probe with a fixed, adversary-shaped input
  (e.g. a scripted 100%-injection payload, a scripted fork-bomb, a scripted over-budget call). Cheap,
  repeatable, run in CI. Proves the control is *present and fires* — nothing about whether a real
  model uses it correctly.
- **[A] Adoption (paid, metered LLM run, capped ≤ $5/run).** Does a *real model* actually drive the
  surface correctly — complete a task through the sandboxed backend, use the broker facade, or get
  contained while steered by a hostile document? These are the only worthwhile live tests
  (engine-fidelity: reachability + scripted-vs-live equivalence + the metered equivalence run);
  never a "does the sandbox help" test. Estimate spend before, report actual after.

**HARD RULE (house):** a documented bound with no engine behind it is not a control. Every gate below
names the surface that enforces it; a gate whose enforcing surface is only prose does not count.

Label key used throughout: **[R]** = reachability-only gate; **[R+A]** = reachability gate plus a
required paid-adoption gate before the milestone is "done."

## 2. The research-hold gate (G0 — precedes spike 1)

**G0 is an owner gate, not a scripted one.** Nothing in Phase A starts until the owner lifts the
research hold. This is the gate the ratified records explicitly place before the first buildable
piece ([REPL_SANDBOX_ARCHITECTURE.md](REPL_SANDBOX_ARCHITECTURE.md) §10 (Build status & first step):
"When the research hold is lifted, spike 1 is the first buildable piece").

**G0 LIFTED — July 22, 2026, owner Cnid.** Live instruction: *"Let's begin working on the repl…
study the documentation and review it. Then start the building of the repl."* The hold is
discharged and Phase A is open. Two facts qualify what that unblocks, and neither reopens a
decision:

- **G1 could not be satisfied from the dev host, and still cannot be.** The development machine is
  Windows with no `/dev/kvm`. That never made G1 unsatisfiable *as such* — only unsatisfiable
  *there* — and it was **PASSED on a provisioned Hetzner AX41 on 2026-07-23** (§4), which unblocks
  S2–S5. The Windows host remains a place where no launcher will pretend a boundary exists. Work
  that proceeded under this lift before that date is the host-independent control plane: the wire,
  the handle/ledger state layer, both host chokepoints, the capability lifecycle, the guest
  supervisor protocol, and the backend contract, each transport-agnostic and exercised through a
  loopback test double.
- **A loopback double is never a boundary.** The microVM is the boundary; nothing built ahead of
  G1 substitutes for it, and no in-process launcher may be reachable from a deployment path.

| | |
|---|---|
| **Exit criterion** | Owner records a ratification lifting the research hold (dated). |
| **Enforcing surface** | The owner ratification gate — the user gate; no engine substitutes for it. |
| **Reachability / adoption** | N/A — an owner decision, neither scripted nor paid. |
| **Blocks** | All of Phase A (S1–S6), Phase B, Phase C. |
| **Open items that inform the owner** | [REPL_SANDBOX_SPEC.md](REPL_SANDBOX_SPEC.md) §9 (Open items): the doubt-filter is PROPOSED; the vsock bridge is unbuilt glue; the `LMHandler port=0` bind host is unconfirmed; the Windows-host deployment shape. G0 does not require these *closed*, but the owner should see them. |

## 3. Milestone map & gate ledger

Two phases of build (A = prototype spikes that close real unknowns; B = hardening to the full
requirement set) then C = acceptance, plus one PROPOSED side-track (the doubt filter) that is
**off the boundary critical path**. Every row's exit is checkable by the named surface.

| ID | Milestone / Spike | Phase | Blocks on | Exit gate → enforcing surface | Label | SPEC §8 map |
|---|---|---|---|---|---|---|
| **G0** | Research-hold lifted | — | — | Owner ratification (dated) | owner gate | — |
| **G1** | Host provisioning gate — **PASSED 2026-07-23** (§4) | pre-A | G0 | `kata-runtime check` PASS + `qemu -accel kvm -cpu host` near-native → the KVM-capable host | **[R]** | gate 1 |
| **S1** | Close the source-reads | A | G0 | Pinned-source conformance test asserts the 3-method contract + wire schemas + tool-materialization path | **[R]** | precondition for gate 3 |
| **S2** | Boundary + persistence | A | S1, G1 | Scripted boot-once/keep-state/exec-many → the Kata microVM + `IsolatedEnv` | **[R]** | toward gate 3 |
| **S3** | `llm_query` over vsock — **[R] PASSED 2026-07-23** (§5.3); `[A]` unspent | A | S2 | Frame round-trips guest→host with parity → the vsock bridge + LM handler | **[R+A]** | toward gates 2, 4 |
| **S4** | DB broker minimal proof | A | S2 (reuses S3 bridge) | Real query, zero credential in guest → the host broker + NOSUPERUSER role + egress deny | **[R+A]** | toward gate 2 |
| **S5** | Tier-0 in-guest hardening | A | S2, S3, S4 | Scripted fork-bomb/syscall/write denied, channels survive → in-guest cgroups+seccomp+Landlock + host watchdog | **[R]** | toward gate 2 (req 8) |
| **S6** | Author the `IsolatedEnv` subclass | A | S1–S5 | Unedited load → `execute_code` round-trips as `LocalREPL` → the `KataREPL` backend | **[R+A]** | gate 3 |
| **GB** | Security hardening to the 12 reqs | B | S3, S4, S5, S6 | Each of the 12 [ARCHITECTURE §7](REPL_SANDBOX_ARCHITECTURE.md) reqs mapped to an enforcing surface (§6) | **[R+A]** | gate 2 |
| **GA-eq** | Equivalence acceptance | C | S6, GB | Scripted equivalence **and** a metered real-model equivalence run | **[R+A]** | gate 3 |
| **GA-rt** | vsock-bridge red-team | C | S3, GB | Adversarial review + fuzzed frame parser → the vsock bridge, before it ships | **[R]** | gate 4 |
| **DF** | Doubt filter (Layers 1–2) | side-track | GB | PROPOSED — attaches findings, feeds audit; **never** an enforcing surface (§8) | **[R+A]** | not a §8 gate |

**Critical path (longest chain):** `G0 → S1 → S2 → S3 → S4 → S5 → S6 → GB → GA-eq`. `G1` runs in
parallel with `S1` (both feed `S2`); `GA-rt` runs in parallel with the tail of `GB`; `DF` is a
parallel PROPOSED track that never blocks the boundary. Full dependency view: §9.

## 4. Host provisioning gate (G1 — SPEC §8 gate 1)

Kata + Cloud Hypervisor **requires real `/dev/kvm`**; a silent QEMU-TCG fallback is 5–35× slower
*and loses the hardware VM boundary* ([REPL_SANDBOX_ARCHITECTURE.md](REPL_SANDBOX_ARCHITECTURE.md)
§8 (Deployment)). So the host is load-bearing and this gate precedes every KVM-dependent spike
(S2–S5). Hoisted to an explicit milestone because S2–S5 cannot run without it (an ordering call, §11).

- **Objective:** stand up a KVM-capable Linux host and prove acceleration is real, not emulated.
- **Real unknown it closes:** "a VM boots" ≠ "the VM has hardware KVM" — is acceleration real on the
  chosen host? ([REPL_SANDBOX_LEARNINGS.md](REPL_SANDBOX_LEARNINGS.md) §8 (Deployment)).
- **Entry preconditions:** G0 lifted; a host from the ratified set — **Hetzner dedicated (Root) /
  AWS C8i/M8i/R8i / GCP N2/C2**, **never DigitalOcean** ([REPL_SANDBOX_ARCHITECTURE.md](REPL_SANDBOX_ARCHITECTURE.md)
  §8). The Windows dev host runs this against a Linux server or nested-virt cloud VM.
- **Exit acceptance → enforcing surface:** `kata-runtime check` PASS **and** a `qemu -accel kvm -cpu host`
  benchmark showing acceleration is real. Enforcing surface: the KVM-capable host + Kata's own
  validator + `repl_sandbox.launcher.qemu_accel_benchmark`. Maps to **SPEC §8 gate 1**.
  **Read the ratio in the right direction:** TCG is the *slow* side, so the emulated run taking 5–30×
  as long is the **healthy** result. A KVM run that has silently fallen back is doing the same
  emulated work as the TCG run, so the two come out *comparable* — a quotient near 1.0 is the failure
  signature, never a large one. (The same numerals appear in §8 of
  [REPL_SANDBOX_ARCHITECTURE.md](REPL_SANDBOX_ARCHITECTURE.md) attached to the other side of the
  comparison — the KVM boot being *itself* 5–35× slower than it should be. Both readings are correct;
  conflating them is not, and a code comment did exactly that until `e9a8ff5`.)
- **Label: [R]** — deterministic host check; no model involved.
- **Dependencies:** blocks S2–S5.

### 4.1 Reaching the host (read this before re-deriving it)

**This repository is public, so the host's address is not in it.** It is reached through a local SSH
alias — every command in §4, §4.1 and §5.2 assumes it:

```bash
ssh trellis-kata           # -> the provisioned AX41, as root, by key
```

The alias is defined in the operator's own `~/.ssh/config` (`HostName`, `User root`, `IdentityFile`)
and nowhere else. A session that finds `ssh trellis-kata` failing should assume **the alias is
missing locally**, not that the host is gone — ask the owner for the address rather than scanning for
it, and never commit the address, a key, or a `known_hosts` line to this tree.

Two commands orient a new session on the host — each is a check, not a change, and both run against
files already at `/root/`:

```bash
ssh trellis-kata 'bash /root/provision_kata_host.sh --verify'   # every step should say "already"
ssh trellis-kata 'python3 /root/repl_sandbox_s2_probe.py'       # S2, exit 0
```

**The host carries no checkout of this repository** (as of 2026-07-23 `/root/` holds only the two
scripts above and the fetched Kata/Cloud-Hypervisor assets). Scripts are `scp`'d over per run, so
re-running **G1** — which lives in the package, not in a standalone script — means putting a checkout
there first:

```bash
ssh trellis-kata 'git clone --depth 1 https://github.com/OpenCnid/trellis /root/trellis \
  && cd /root/trellis/src && python3 -m repl_sandbox.cli preflight'
```

Anything a spike leaves behind on that box is a scratch artifact. **The repository is the record, and
a fact that exists only on the AX41 has not been recorded** — copy the observation into these
documents in the same session that produces it.

**What that host is provisioned to** is §4's table plus the three facts in
[REPL_SANDBOX_LEARNINGS.md](REPL_SANDBOX_LEARNINGS.md) §10a; `provision_kata_host.sh` is the
executable form and should be preferred over re-reading either.

**Observed 2026-07-23 — G1 PASS.** `python -m repl_sandbox.cli preflight` → **exit 0**, all four
conditions met, run from a clean checkout at `e9a8ff5`. The host: a **Hetzner AX41** dedicated
(Root) server — from the ratified set — AMD Ryzen 5 3600 (6C/12T, `svm`), 62 GB, 2×477 GB NVMe in
software RAID1, **Ubuntu 24.04.4 LTS**, kernel 6.8.0-134.

| condition | observed |
|---|---|
| `/dev/kvm` | present, character device, r/w; `kvm_amd` loaded, `npt: Y` |
| `kata-runtime check` | exit 0 — "System is capable of running Kata Containers / System can currently create Kata Containers" |
| Kata pin ≥ 3.31.0 | **3.32.0** (`kata-static-3.32.0-amd64.tar.zst`, `sha256:1449ecea…1b01`, unpacked to `/opt/kata`) |
| Cloud Hypervisor pin ≥ 52.0 | **v52.0** (`cloud-hypervisor-static`, `sha256:829af01f…1ee9`) |
| acceleration | **11.5–14.2×** across runs, floor 5.0, `near_native: True` |

**The split pin earned its keep on the first real host.** `kata-static-3.32.0` *bundles its own*
`cloud-hypervisor` **at v51.1** — below the pin. Installing Kata alone therefore leaves the host one
version short on the upstream that actually provides the VM boundary, and `kata-runtime check`
passes in that state without complaint. The gate caught it and named it exactly:
`cloud-hypervisor cloud-hypervisor v51.1 is below the pin 52.0`. Standalone v52.0 was installed over
it (the bundled binary retained as `cloud-hypervisor-bundled-v51.1`), v52.0 chosen over the newer
v53.0 as the smallest jump from what Kata 3.32.0 was built against. This is
[REPL_SANDBOX_ARCHITECTURE.md](REPL_SANDBOX_ARCHITECTURE.md) §7 requirement 3 — two upstreams, two
feeds, never one version checked twice — observed rather than argued. **Kata publishes a
`versions.yaml` asset naming the bundled Cloud Hypervisor; read it before unpacking.**

**The host is now reproducible: `scripts/provision_kata_host.sh`** (`npm run repl-sandbox:provision`,
runs on the host as root). It carries the two pins with their observed digests, fetches nothing whose
digest does not match, installs standalone Cloud Hypervisor over the bundled build while retaining
the displaced binary, links the shim onto containerd's `PATH`, re-points `configuration.toml` at
`configuration-clh.toml`, and pulls the guest image **by digest** rather than by its mutable tag.
`--verify` mutates nothing and exits 1 naming what it would change.

*Its own negative control, observed 2026-07-23:* against the provisioned host it reports `already`
on every step and exits 0. With three breaks planted — shim unlinked, config symlinked back to QEMU,
image removed — `--verify` named all three as `WOULD CHANGE` and exited 1 without touching them, a
plain run converged all three, and a re-verify exited 0. Isolated, the shim break alone fails a boot
with `fork/exec /usr/local/bin/containerd-shim-kata-v2: no such file or directory`; the same host
booted 6.18.35 after convergence. **Scope limit: the install paths of steps 1–3 (containerd, the Kata
tarball, the Cloud Hypervisor binaries) have only run on a host that already had them** — the
fetch-and-unpack branch is unexercised until a genuinely fresh host runs it.

Neither upstream publishes checksums for these assets, so the digests above are computed after fetch
over HTTPS, not verified against a published manifest. **Note the two remaining scope limits:** the
acceleration figure is a *differential* measurement (§ the enforcing surface above), and G1 says the
host can boot a Kata microVM — **it is not a claim that one has been booted**. That is S2.

## 5. The six prototype spikes (Phase A — elevated)

The origin list is [REPL_SANDBOX_RESEARCH.md](REPL_SANDBOX_RESEARCH.md) §10.4 (First-prototype plan);
each is elevated here to a first-class milestone with objective / the real unknown it closes / entry
preconditions / exit acceptance mapped to SPEC §8 / dependencies / label. **No spike is a production
build** — each closes one unknown and leaves a durable artifact for S6 to integrate.

### 5.1 S1 — Close the source-reads

- **Objective:** confirm the rlms contract byte-exact against the pinned `rlms==0.1.3` install
  (`pip download`, not GitHub main) and read the Kata vsock mechanism.
- **Real unknown it closes:** does the drop-in contract actually match what [SPEC §2–§3](REPL_SANDBOX_SPEC.md)
  records — `IsolatedEnv` signatures, `LMRequest`/`LMResponse`/`REPLResult` field schemas, the reserved
  namespace names, and **how rlms materializes tools in its *isolated* backends** (code-string vs RPC
  proxy stub — the single most important read before finalizing `register_capability`)? Plus Kata's
  `docs/design/VSocks.md` (any guest process may open its own `AF_VSOCK` port).
- **Entry preconditions:** G0 lifted. **No host needed** — pure reading; runs in parallel with G1.
- **Exit acceptance → enforcing surface:** a **pinned-source conformance test** that imports
  `rlms==0.1.3` and asserts the `BaseEnv`/`IsolatedEnv` method signatures, the `REPLResult` fields,
  and the reserved names match the SPEC record; the tool-materialization path is documented in
  `REPL_SANDBOX_INTERFACES.md`. Enforcing surface: the conformance test. This is the belief-check the
  house rule demands before any build proceeds on the contract. **Precondition for SPEC §8 gate 3.**
- **Label: [R]** — a scripted assertion over pinned source. No model.
- **Dependencies:** blocks S2 and S6.

### 5.2 S2 — Boundary + persistence

- **Objective:** run the rlms worker inside one Kata microVM (Cloud Hypervisor VMM) as a long-lived
  process; boot-once, keep-state, exec-many.
- **Real unknown it closes:** does a Kata guest hold a *stateful* namespace across turns (a var set in
  turn 1 live in turn 5), the way `LocalREPL` does — and does WSL2 nested-KVM hold, or must this run on
  a cloud dev VM? ([REPL_SANDBOX_RESEARCH.md](REPL_SANDBOX_RESEARCH.md) §10.4 item 2.)
- **Entry preconditions:** S1 (contract confirmed), G1 (real KVM host). Version pins present:
  **Kata ≥ 3.31.0 AND Cloud Hypervisor ≥ 52.0** ([SPEC §5](REPL_SANDBOX_SPEC.md) — two upstreams, never
  "Cloud Hypervisor ≥ 3.31.0").
- **Exit acceptance → enforcing surface:** `ctr run --runtime io.containerd.kata.v2` boots the guest;
  a scripted probe sets a variable, then reads it a later turn; teardown is clean. Enforcing surface:
  the **Kata microVM (boundary)** + the `IsolatedEnv.setup`/`execute_code` skeleton. **Toward SPEC §8 gate 3.**
- **Label: [R]** — scripted state probe.
- **Dependencies:** blocks S3, S4, S5.

**Observed 2026-07-23 — S2 PASS.** `python3 scripts/repl_sandbox_s2_probe.py` → **exit 0** on the
same Hetzner AX41 that passed G1 (`npm run repl-sandbox:s2-probe`; the script runs *on the host* and
refuses on any box without `/dev/kvm`). Kata 3.32.0 · Cloud Hypervisor v52.0 · containerd 2.2.1 ·
image `docker.io/library/python:3.12-slim`.

| claim | observed |
|---|---|
| boot | `ctr run -d --runtime io.containerd.kata.v2` → 0.60–0.65 s to detach, 0.68 s to first exec |
| boundary | guest kernel **6.18.35** vs host **6.8.0-134-generic**; distinct `boot_id`; host carries `/opt/kata/bin/cloud-hypervisor --api-socket /run/vc/vm/<sandbox>/clh-api.sock` |
| persistence | `x = 41` (turn 1) → `x += 1` (2) → read `42` (3) → `y = x * 2` (4) → read `42,84` (**turn 5**), one worker process (`pid 12`) and one guest `boot_id` across all five turns |
| teardown | after `task kill`/`task delete`/`container delete`: not listed by containerd, **zero** surviving Cloud Hypervisor processes for the sandbox |
| negative control | `--negative-control` destroys and re-boots the guest between turns 2 and 3, everything else identical → **exit 3, DETECTED**: `NameError: name 'x' is not defined`, two pids, two boot ids |

**The negative control is the load-bearing half.** A persistence probe that cannot distinguish a
live guest from a fresh one proves nothing (AGENTS.md §4 (Hard rules) rule 19(c)), and the three
independent signals — the namespace, the worker pid, the guest boot id — all fired on the planted
break rather than one of them carrying the result alone.

**Two host provisioning facts this spike established** (neither was in place after G1, and
`kata-runtime check` passes without them): containerd finds the Kata shim by name on its own `PATH`,
so `/opt/kata/bin/containerd-shim-kata-v2` must be linked into `/usr/local/bin`; and Kata's
`configuration.toml` ships as a symlink to **`configuration-qemu.toml`**, so a host that installed
Cloud Hypervisor and never re-pointed it boots the ratified pin's *neighbour* — the symlink was
moved to `configuration-clh.toml`, which is what the observed run used.

**Replicated 2026-07-23 — five consecutive runs on the reconverged host, all exit 0.** Boot to first
exec **0.629–0.693 s**; every run one worker pid, one guest `boot_id`, turn 5 reading `42,84`, and a
teardown leaving nothing listed and no VMM process. `--negative-control` exited 3 again afterward.
**This is n=5 on one host, not on two** — the variance measured is run-to-run on identical hardware,
which says nothing about a second machine.

**The WSL2 question this spike was supposed to answer is closed the other way** (RESEARCH §10.4 item
2 asked whether WSL2 nested-KVM holds): on this repository's development box it cannot. WSL2 exposes
no `/dev/kvm` there, and enabling nested virtualization requires `nestedVirtualization=true` under
**Windows 11**, while the dev host is Windows 10 Home build 19045. The blocker is the OS edition, not
the CPU (GenuineIntel). **A second KVM host therefore has to be a second machine** — see §11 (Open
ordering calls) for what that costs.

**Scope limits.** The guest holds state across turns *delivered as separate `ctr task exec` calls* —
this is the boundary and the persistence, not the wire: the turns cross via a guest fifo, **not**
vsock (S3), and the worker is an `execute_code` skeleton with no capabilities, no broker, and no
Tier-0 hardening. `KataLauncher.boot` still raises: the spike proves the `ctr` path works, it does
not make the production launch path (guest CID assignment, supervisor readiness) exist.

### 5.3 S3 — `llm_query` over vsock

- **Objective:** carry the sub-LLM channel across the guest boundary — swap loopback `AF_INET` for
  `AF_VSOCK` (or the guest-side loopback→vsock forwarder), preserving the exact 4-byte-big-endian-length
  + UTF-8-JSON frame ([SPEC §3](REPL_SANDBOX_SPEC.md)).
- **Real unknown it closes:** does the identical framing + acceptable latency survive the vsock hop, and
  can the guest reach the host `LMHandler` at all given it binds `127.0.0.1` unauthenticated? (Confirm
  the `port=0` bind host — [SPEC §9](REPL_SANDBOX_SPEC.md) open item.)
- **Entry preconditions:** S2 (booted stateful guest). This spike **builds the vsock bridge** — the new,
  security-critical glue ([ARCHITECTURE §4](REPL_SANDBOX_ARCHITECTURE.md) (Components)).
- **Exit acceptance → enforcing surface:**
  - **[R]** a scripted `llm_query` frame round-trips guest→host over vsock with byte parity to the
    loopback path and latency within the session budget. Enforcing surface: the **vsock bridge + LM
    handler**; auth is by the session identity the listener supplies at `accept()`, never a
    payload id (INTERFACES §3.1a — under the ratified VMM that is the per-sandbox socket path,
    not a kernel-read CID).
  - **[A]** a metered real-model flat fan-out (N parallel completions over slices at `max_depth` 1)
    completes correctly through the bridge — the engine-fidelity check that a model actually uses the
    channel. Capped ≤ $5.
  - **Toward SPEC §8 gates 2 and 4** (vsock is the only channel out; the bridge must exist to be
    red-teamed).
- **Dependencies:** blocks S5 (channel-survival check), S6; is the predecessor the bridge red-team
  (GA-rt) reviews.

**Observed 2026-07-23 — S3 [R] PASS.** `python3 scripts/repl_sandbox_s3_probe.py` → **exit 0**, six
consecutive runs on the same Hetzner AX41 (`npm run repl-sandbox:s3-probe`; reached per §4.1, and the
script refuses on any box without `/dev/kvm`). Kata 3.32.0 · Cloud Hypervisor v52.0 · containerd
2.2.1 · image `python:3.12-slim` · guest kernel **6.18.35** against the host's 6.8.0-134.
**The `[A]` half — a metered real-model fan-out through the bridge — is unspent.**

| claim | observed |
|---|---|
| reachability | the guest's own `AF_VSOCK (2, 5001)` connect is delivered to the host listener at **`/run/vc/vm/<sandbox>/clh.sock_5001`**; the host witness counts **12 accepted connections, 12 requests served** per run, and the **shipping** guest path (`guest_rpc.GuestRpc` over `transport.VsockClient`) completes `llm_query` and a 2-wide `llm_query_batched` against the real `LMHandler` |
| byte parity | request frame `15ba8a0e…fb41` — **identical** to the loopback path's; response frame `26006a67…8fc0` — **identical**. sha256 over the bytes captured on both sides, equal in both directions, every run |
| latency | vsock p50 **0.202–0.268 ms**, loopback p50 0.140–0.253 ms, added p50 **−0.051 to +0.128 ms** against a 25 ms budget |
| control seam | the host reached an in-guest `AF_VSOCK` listener through the VMM's `CONNECT` handshake; **the guest observed `peer_cid = 2`** and `require_host_cid` **accepted** it |
| identity | after `close_session`, the same guest on the same socket is **dropped without an answer** (`connection_denied` ×3 in the audit; the guest sees `FrameError: peer closed the connection without answering`) |
| teardown | socket node removed, container not listed, **zero** surviving Cloud Hypervisor processes |

**§3.1a is now host-confirmed, and the falsifier is what confirms it.** The sandbox directory holds
exactly `clh-api.sock`, `clh.sock`, `virtiofsd.sock`, and the bridge listens on `clh.sock_5001` — the
`<uds>_<port>` convention, observed. Run with **`--native-vsock`**, which binds the host on
`AF_VSOCK VMADDR_CID_ANY` as the records originally specified, the same guest gets
**`ConnectionResetError: [Errno 104] Connection reset by peer`** and the host listener accepts
**nothing** (exit 1, seven named failures). A documentation reading that survives its own falsification
test on the hardware is a different thing from one that does not, and this one did.

**The negative control is the load-bearing half, and it behaved exactly as designed.**
`--negative-control` has the guest answer *itself* over in-guest loopback with the byte-identical
canned reply. **Byte parity still passed** (both digests matched) and **latency improved** (added
p50 −0.069 ms) — the two claims an observer would most likely trust. The host-side witness read
**0 accepted, 0 requests** and the run **exited 3, DETECTED**. Two further detectors fired for free:
the batched call returned 0 of 2 (a canned single completion cannot answer a fan-out), and the
post-`close_session` request was still served. **A probe whose headline claims all pass while the
boundary is uncrossed is the failure mode this control exists to catch, and it caught it.**

**Two defects in the instrument, found by running it and fixed before this record was written.**
Under `--native-vsock` the guest's raw dial raised, the guest script exited non-zero, and the probe
reported *"could not run"* — the message it owes an infrastructure failure, applied to the far more
interesting case where the infrastructure is fine and the host is simply unreachable at that address.
And `Sandbox.destroy()` let a `TimeoutExpired` escape from a `finally` when `ctr task kill` blocked on
a wedged shim, masking the failure that caused it and leaving a container record and a live VMM
behind (cleaned by hand). Teardown is now bounded, swallowed, and escalates to killing the shim.
**Both were found by the falsifier, not by the passing run** — which is the argument for having one.

**The transport finding that forced the build — a records correction.** These records specify the
host binding `AF_VSOCK` on `VMADDR_CID_ANY` and reading the guest CID at `accept()`. That is
*native vhost-vsock*, which Kata uses **under QEMU**. The ratified VMM is **Cloud Hypervisor,
which implements hybrid vsock instead**: the guest dials `AF_VSOCK (2, PORT)` unchanged, but the
host side is an `AF_UNIX` socket at `<uds>_<PORT>`, and the reverse direction is a `CONNECT <PORT>`
handshake on `<uds>` — under Kata, `/run/vc/vm/<sandbox_id>/clh.sock`. **A Unix-socket `accept()`
carries no CID**, so "auth by kernel vsock peer CID" is not implementable on this VMM; identity
becomes the per-sandbox socket path the host created. The cross-session property survives, its
enforcing surface moves, and both are written up in
[INTERFACES §3.1a (Hybrid vsock)](REPL_SANDBOX_INTERFACES.md), which every other record now points
at. **This was read from Cloud Hypervisor's, Firecracker's, and Kata's own documentation — it is
upstream-sourced, not host-observed**, which is exactly the status S1 left the Kata vsock read in
([CONFORMANCE §5](REPL_SANDBOX_CONFORMANCE.md)). The probe's `--native-vsock` mode exists to
falsify it on the host rather than assume it.

**The six claims the probe asserts,** each with the surface it would indict: (1) *reachability* —
a guest `AF_VSOCK` connect is delivered to the host listener and the **shipping** guest path
(`guest_rpc.GuestRpc` over `transport.VsockClient`) completes a real `llm_query` and
`llm_query_batched` against the real `LMHandler`; (2) *byte parity* — sha256 over the exact bytes
captured on both sides equals the loopback path's, in both directions; (3) *latency* — the
bridge's **added** p50 over loopback is within budget (the difference, not the absolute, because a
scripted provider's absolute number measures the host's interpreter); (4) *the control seam* — the
host reaches an in-guest listener through the `CONNECT` handshake, and the guest reports which
peer CID it saw, which is the number `require_host_cid` is written against; (5) *identity is the
host's* — after `close_session` the same guest on the same socket is dropped without an answer;
(6) *clean teardown* — socket node, container, and VMM process all gone.

**Its negative control is the load-bearing half.** `--negative-control` has the guest answer
*itself*: an in-guest loopback responder returns the byte-identical canned reply. Every
guest-visible claim still passes — the response is right, the digests match, the latency improves
— and the only thing that can catch it is the host-side witness counting connections that arrived.
Exit 3 (DETECTED) is the healthy result. This is deliberately sharper than S2's control, where the
planted break was visible in three independent guest-reported signals.

**Zero-paid.** The provider behind the handler is a scripted stub returning a fixed completion at
$0.00, so the `[R]` half spends nothing; the metered `[A]` fan-out is a separate owner-gated run.
The probe's host-side logic — the reference arm, the parity accounting, the witness, and the guest
program's own byte capture — is under test off-host in `src/repl_sandbox/tests/test_s3_probe.py`,
so a mistake in it surfaces on a development box rather than mid-way through a host run.

### 5.4 S4 — DB broker minimal proof

- **Objective:** a host-side broker holds the real Postgres/Neo4j clients + credentials, terminates the
  DB wire protocol, and serves `run_query`/`run_cypher` over a **second** vsock port; the guest holds only
  a dumb proxy facade. Postgres first (simpler wire), then Bolt.
- **Real unknown it closes:** can a real query complete from inside the guest with **zero credential
  material ever in the guest**, under a read-only role — the load-bearing exfil property (guest holds
  *handles*, not payloads; [ARCHITECTURE §3.1](REPL_SANDBOX_ARCHITECTURE.md) (The exfiltration resolution))?
- **Entry preconditions:** S2 (guest); reuses the S3 vsock-bridge pattern on a distinct port. Broker
  policy default = **read-only NOSUPERUSER** ([SPEC §4.2](REPL_SANDBOX_SPEC.md) (Host broker)).
- **Exit acceptance → enforcing surface:**
  - **[R]** a scripted query returns rows **and** a scripted grep of the guest env/namespace/memory for
    the DSN/password returns nothing; a scripted write attempt under the default role is denied; the DB
    host has no internet/metadata route. Enforcing surface: the **host broker + NOSUPERUSER role +
    deny-by-default egress**.
  - **[A]** a metered real-model run drives the facade (`pg.query(...)`) to complete a real workspace
    query — the ergonomics/adoption check that the facade "feels native" enough for model-authored code.
    Capped ≤ $5.
  - **Maps to SPEC §8 gate 2** (no DB creds in guest; DB read-only / no SSRF).
- **Dependencies:** blocks S5, S6.

### 5.5 S5 — Tier-0 in-guest hardening

*Ordering note (§11): [REPL_SANDBOX_RESEARCH.md](REPL_SANDBOX_RESEARCH.md) §10.4 item 5 was "gVisor inner
layer (Systrap)." The ratified architecture **dropped gVisor** ([ARCHITECTURE §1](REPL_SANDBOX_ARCHITECTURE.md)
(The ratified stack), §9 (Explicitly not adopted)) and adopted **Tier-0 in-guest hardening** as the honest
inner layer instead. This spike is re-cast to the ratified control; it is not a re-decision.*

- **Objective:** apply **cgroups (pids/mem/cpu) + a seccomp allowlist + Landlock read-only roots** to the
  worker process at startup, plus wire the host watchdog that reaps/replaces wedged VMs.
- **Real unknown it closes:** does Tier-0 hardening actually cap self-DoS (fork/thread bomb) and shrink
  the syscall/filesystem surface **without breaking** the vsock channels or the cheap in-namespace tools?
- **Entry preconditions:** S2 (guest), S3 + S4 (the channels that must be shown to survive).
- **Exit acceptance → enforcing surface:** scripted probes — a fork-bomb is capped (cgroup `pids`), a
  denied syscall is blocked (seccomp), a write to a read-only root is denied (Landlock) — **and** the
  `llm_query` / DB-broker channels and in-namespace regex/pandas tools still work; the watchdog reaps a
  deliberately wedged VM from a clean slot. Enforcing surface: **in-guest cgroups+seccomp+Landlock + host
  watchdog**. **Maps to SPEC §8 gate 2, requirement 8.**
- **Label: [R]** — scripted resource/syscall/filesystem probes.
- **Dependencies:** blocks S6.

### 5.6 S6 — Author the `IsolatedEnv` subclass

- **Objective:** wrap S2–S5 behind the three-method contract as the real `KataREPL(IsolatedEnv)`
  (`setup` / `load_context` / `execute_code`), with tools registered as CapabilityDescriptors materialized
  into vsock proxy stubs ([SPEC §2](REPL_SANDBOX_SPEC.md), §4.3).
- **Real unknown it closes:** is the sandboxed backend a genuine **drop-in** for the rlms driver — does an
  unedited context load → `execute_code` behave as `LocalREPL` does?
- **Entry preconditions:** S1–S5 complete (contract, boundary, both chokepoints, hardening).
- **Exit acceptance → enforcing surface:**
  - **[R]** a scripted equivalence harness: an unedited load → `execute_code` round-trips with the same
    observable `REPLResult` shape as `LocalREPL`. Enforcing surface: the **`KataREPL` backend + the rlms
    driver**.
  - **[A]** a metered real-model run completes a real RLM task through `KataREPL` equivalently to
    `LocalREPL` — the engine-fidelity equivalence run (scripted-vs-live). Capped ≤ $5.
  - **Maps to SPEC §8 gate 3.** (This spike's [A] gate and GA-eq's are the same run — recorded once.)
- **Dependencies:** blocks GB (its surfaces must exist to be mapped) and GA-eq.

## 6. Security hardening — the 12 requirements to enforcing surfaces (Phase B / GB)

The six spikes stand up the isolation; the remaining work is **broker/handler/config**, not new
isolation ([REPL_SANDBOX_RESEARCH.md](REPL_SANDBOX_RESEARCH.md) §14.3). GB is done only when **all 12**
requirements of [ARCHITECTURE §7](REPL_SANDBOX_ARCHITECTURE.md) (Security requirements) are each mapped
to an enforcing surface with both gate columns satisfied — this **is** SPEC §8 gate 2. A documented
bound with no engine behind it does not count.

| # (ARCH §7) | Enforcing surface (named) | [R] reachability probe (scripted) | [A] adoption probe (paid ≤ $5) | Built in |
|---|---|---|---|---|
| 1 Exfil = data-flow; DLP + byte caps on top | Guest holds handles not payloads (broker) + content-DLP + per-session byte caps on `llm_query`/`vector_search`/`answer` | Scripted 100%-injection payload: no secret-bearing payload ever materializes in guest; byte cap trips | Real model steered by a hostile document (red-team) cannot leak a non-materialized secret via a sanctioned crossing; audit confirms | S4 + GB |
| 2 API key host-side only | LM handler holds the provider key | Scripted grep of guest env/namespace/memory for the key returns nothing | — | S3 + GB |
| 3 Split version pins | Deploy config: Kata ≥ 3.31.0 **AND** Cloud Hypervisor ≥ 52.0, separate feeds | Scripted version-assert on both binaries; two advisory feeds tracked | — | G1/GB |
| 4 Auth by the listener's session identity | The id `accept()` reports on broker + handler — kernel CID (native) or per-sandbox socket path (hybrid, §5.3) | Scripted forged-payload-id request is rejected; quota keyed to that id | Real model in session A cannot reach session B's scope | S3, S4 + GB |
| 5 Host-side CID-keyed hard ceilings | LM handler caps: concurrency, rate, dollar spend (hard-stop) | Scripted burst exceeds each cap → hard-stop (rlms caps proven bypassable) | Real fan-out run halts at the dollar cap | GB |
| 6 APOC allowlist + DB-host egress deny | Host broker APOC deny-by-default + DB-host has no route | Scripted `apoc.load.json` SSRF attempt denied; no metadata route | — | S4 + GB |
| 7 `statement_timeout` + cost caps + no unbounded `[*]` | Host broker query governor | Scripted cartesian/`[*]` query is refused or timed out | — | S4 + GB |
| 8 In-guest cgroups + host watchdog | cgroups (pids/mem/cpu) + watchdog | Scripted fork-bomb capped; wedged VM reaped | — | S5 |
| 9 Least-privilege Postgres role | NOSUPERUSER, no `pg_read_server_files`/`pg_execute_server_program`/`dblink` | Scripted `COPY TO PROGRAM` / `pg_read_file` denied | — | S4 + GB |
| 10 Security-review the vsock bridge | The vsock bridge (loopback-only, unprivileged) | Fuzzed frame parser survives; privilege-drop verified | — | GA-rt |
| 11 Warm-pool reset policy *(contingency)* | Single-use VM or pre-exec-snapshot + rootfs-hash reset | Scripted reuse shows no state bleed *(only if pooling adopted)* | — | deferred (§10) |
| 12 Prompt defenses are NOT controls | The tool/network boundary is the only backstop | Scripted audit: no enforcing-surface list counts `trellis_task.verify()`, `_SAFE_BUILTINS`, or the output caps | — | GB (documentation-audit) |

**Discipline (from [ARCHITECTURE §3.1](REPL_SANDBOX_ARCHITECTURE.md), §7 requirement 12):** the composed
doubt filter (§8) and every Tier-2 telemetry surface **must never migrate into this "enforcing surface"
column.** They reduce the *rate* of injected-instruction compliance; they do not make exfil impossible.

## 7. Acceptance — the four SPEC §8 gates (Phase C)

Build is "done" only when all four [SPEC §8](REPL_SANDBOX_SPEC.md) (Acceptance gates) pass. Each is
already placed above; this section is the final go/no-go aggregation.

| SPEC §8 gate | Where met | [R] | [A] |
|---|---|---|---|
| 1 — `kata-runtime check` + `qemu -accel kvm` near-native | G1 (§4) | Host validator + smoke benchmark | — |
| 2 — 12 §7 reqs each mapped to an enforcing surface | GB (§6) | Per-req scripted probes (§6 table) | Injection/exfil hold + cap-halt under a real model |
| 3 — Scripted equivalence: unedited load → `execute_code` round-trips as `LocalREPL` | S6 / GA-eq (§5.6) | Scripted equivalence harness | Metered real-model equivalence run (engine-fidelity), ≤ $5 |
| 4 — Red-team pass on the vsock bridge before it ships | GA-rt | Adversarial review + fuzzed frame parser | — |

**GA-eq** and **GA-rt** are the final gates. GA-rt may run in parallel with the tail of GB, but the
bridge does not ship until it passes ([ARCHITECTURE §7](REPL_SANDBOX_ARCHITECTURE.md) requirement 10:
"before it ships"). The threat model for the [A] probes — the hostile-document exfil attempt and the
confused-deputy attempt — is specified in `REPL_SANDBOX_THREAT_MODEL.md`; this plan only schedules them.

## 8. The doubt-filter track (DF — PROPOSED, off the critical path)

The composed doubt filter (Layers 1–2 of [ARCHITECTURE §3.1](REPL_SANDBOX_ARCHITECTURE.md)) is
**defense-in-depth, PROPOSED, and never a boundary.** It is a parallel track that **never blocks** the
boundary build and is **never** an entry in the §6 enforcing-surface column.

- **Scope:** a mechanical, provenance-grounded injection-doubt that strips command-authority from
  untrusted-retrieved instructions (the automatic contest of [DOUBTS_WORKSPACE §7](../../architecture/DOUBTS_WORKSPACE.md)
  (What doubts do not do)), plus a semantic **defeater** panel on the outbound content
  ([DOUBTS_WORKSPACE §8](../../architecture/DOUBTS_WORKSPACE.md) (Composed defeaters)) that **attaches a
  finding and feeds audit; it never unilaterally enforces** ([DOUBTS_WORKSPACE §9](../../architecture/DOUBTS_WORKSPACE.md)
  (Scope — this is a critique engine)). Full design: `REPL_SANDBOX_DOUBT_FILTER.md`.
- **Guardrail 15 gate:** the seat prompts are prompt bytes — authoring them **requires** invoking the
  `prompt-engineering` and `hypershot-protocol` skills first ([SPEC §9](REPL_SANDBOX_SPEC.md) open item).
- **Gate label: [R+A].** [R] the finding is attached and routed to audit on a scripted injection input;
  [A] a real-model run shows the panel lowers the injected-compliance *rate* (a rate reduction, measured;
  **not** a boundary claim, and it must not be reported as one). Realizable as an in-context meta-prompt
  **or** a TTT-trained tooling-call — robustness is the blind-panel composition, not the substrate.
- **Dependency:** builds on GB; blocks nothing on the boundary critical path.

## 9. Critical path & dependency view

```
G0 ─┬─ S1 ─────────────┐
    └─ G1 ─────────────┴─ S2 ─ S3 ─ S4 ─ S5 ─ S6 ─ GB ─ GA-eq   (boundary is shippable)
                                     └────────────────── GA-rt ──┘  (bridge ships)
                                                          DF (PROPOSED, parallel; blocks nothing)
```

- **Longest (critical) path:** `G0 → S1 → S2 → S3 → S4 → S5 → S6 → GB → GA-eq`.
- **Parallelizable:** `G1` with `S1` (both gate `S2`). Much of `GB`'s config work (version pins, DLP,
  handler caps) can proceed alongside S3–S6, but GB *completes* only after its surfaces exist (broker
  from S4, handler from S3, cgroups from S5, backend from S6). `GA-rt` runs alongside the tail of `GB`.
  `DF` is fully parallel and off the path.
- **Soft edge:** `S4` depends on `S2` and *reuses* the S3 vsock-bridge pattern on a second port; once the
  bridge exists, S3 and S4 can overlap (independent chokepoints — LM handler vs DB broker).
- **Hard ordering rationale:** S1 before S2 (don't build on an unverified contract — the house
  belief-check); G1 before S2–S5 (no KVM = no boundary); S3/S4 before S5 (Tier-0 must be shown not to
  break the channels); all spikes before S6 (S6 integrates them); S6 + GB before acceptance.

## 10. Deferred contingencies (not on the path)

Each is a ratified contingency, **not** a live component; each names the gate that would precede it.

| Item | Status | Unlock gate |
|---|---|---|
| Warm pool of pre-booted microVMs | Contingency ([ARCHITECTURE §4](REPL_SANDBOX_ARCHITECTURE.md), §6) | A single-use / pre-exec-snapshot + rootfs-hash **reset policy proven no-state-bleed** before pooling adversarial code (req 11) |
| `max_depth` 2 (children get REPLs) + sibling-microVM pool | Contingency ([ARCHITECTURE §6](REPL_SANDBOX_ARCHITECTURE.md) (Recursion & multiplicity)) | Trellis-specific measurement overturning the depth-2-harmful finding (arXiv:2603.02615); the sibling-pool machinery must exist first. **Not** by RLM-generic optimism. |
| Relax `_SAFE_BUILTINS` | Open item ([SPEC §9](REPL_SANDBOX_SPEC.md)) | Only once the VM boundary is proven; it is redundant defense-in-depth, never a boundary |

**Explicitly rejected — do not re-litigate:** gVisor nesting inside Kata is **not adopted**
([ARCHITECTURE §9](REPL_SANDBOX_ARCHITECTURE.md) (Explicitly not adopted)) — it is a parallel alternative,
not an inner layer; Tier-0 in-guest hardening (S5) is the honest inner layer instead. CubeSandbox and bare
Firecracker are dropped ([REPL_SANDBOX_RESEARCH.md](REPL_SANDBOX_RESEARCH.md) §15).

## 11. Open ordering calls

**Hoisting G1 ahead of S2–S5** (§4 (Host provisioning gate)) — an ordering call, taken: the spikes
that need KVM are not attempted on a host that has not proven it.

**A second KVM host — DEFERRED, not open.** An earlier edition of this section left it standing as a
decision waiting on the owner. That framing was wrong, and correcting it is worth more than the
question was: it conflated **fresh hardware** with **a fresh OS instance**, and only the second is
actually owed.

Three risks were bundled under "one host". They separate cleanly:

| risk | what a second machine buys | standing |
|---|---|---|
| S2's result is an artifact of *this* hardware | little. KVM + Cloud Hypervisor + a Linux guest holding process memory is the most heavily deployed configuration in the microVM ecosystem; a break on Intel VMX rather than AMD SVM would be an upstream bug, not a Trellis finding | **low — deferred** |
| `provision_kata_host.sh` only works where it was written | the real gap: steps 1–3 (containerd, the Kata tarball, the Cloud Hypervisor binaries) have never executed, because every run so far met hosts that already satisfied them | **owed — and it needs a fresh *instance*, not fresh silicon** |
| Trellis can only deploy on this box | a genuine answer, to a question nothing is currently asking | **deferred until a deployment decision exists** |

**The owed half costs nothing.** The AX41 reports `kvm_amd nested: 1` with QEMU present, 62 GB and 12
threads, so it can host a virgin Ubuntu 24.04 guest whose own `/dev/kvm` works — enough to run the
provisioner's untaken install branch, `kata-runtime check`, G1 and the S2 probe inside it. Nested
Kata will be slower and the G1 differential may land differently; **that is itself the rehearsal for
ever running this on a cloud VM**, and it is scheduled alongside S3 rather than sold as its own
milestone.

The measurement discipline this section originally leaned on (a null needs a positive control,
headlines at n=1–2 are weak — AGENTS.md §4 (Hard rules) rule 11) exists because **model behavior is
stochastic**. It transfers poorly to a deterministic infrastructure fact: the five S2 runs differ by
64 ms of boot time and in nothing else, and a sixth run on different silicon would report the same
`42,84`. Replication is not the instrument that would have caught a wrong S2.

*If it re-opens:* the trigger is a deployment decision or a finding that smells CPU- or
kernel-specific — vsock behaviour (S3) is far likelier to be host-dependent than "a VM boots". The
ratified host set ([ARCHITECTURE §8](REPL_SANDBOX_ARCHITECTURE.md) (Deployment)) narrows the options
then: **GCP N2/C2 with the nested-virt licence flag** is the cheap hourly answer; ordinary AWS
C8i/M8i/R8i instances **do not** expose KVM (only `.metal`, far dearer); a second Hetzner dedicated
is monthly with a setup fee; **Hetzner Cloud has no nested virtualization**; DigitalOcean stays
excluded. **Nothing has been bought, no account created, no host ordered.**

---

*Architecture: [REPL_SANDBOX_ARCHITECTURE.md](REPL_SANDBOX_ARCHITECTURE.md) · Spec & acceptance gates:
[REPL_SANDBOX_SPEC.md](REPL_SANDBOX_SPEC.md) · Evidence trail: [REPL_SANDBOX_RESEARCH.md](REPL_SANDBOX_RESEARCH.md) ·
Session knowledge: [REPL_SANDBOX_LEARNINGS.md](REPL_SANDBOX_LEARNINGS.md). Siblings (parallel):
`REPL_SANDBOX_THREAT_MODEL.md` · `REPL_SANDBOX_DATA_MODEL.md` · `REPL_SANDBOX_INTERFACES.md` ·
`REPL_SANDBOX_DOUBT_FILTER.md`.*
