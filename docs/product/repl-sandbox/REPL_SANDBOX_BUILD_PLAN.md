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
| **S3** | `llm_query` over vsock — **[R]+[A] PASSED 2026-07-23** (§5.3) | A | S2 | Frame round-trips guest→host with parity → the vsock bridge + LM handler | **[R+A]** | toward gates 2, 4 |
| **S4** | DB broker minimal proof — **[R]+[A] PASSED 2026-07-23** (§5.4) | A | S2 (reuses S3 bridge) | Real query, zero credential in guest → the host broker + NOSUPERUSER role + egress deny | **[R+A]** | toward gate 2 |
| **S5** | Tier-0 in-guest hardening — **[R] PASSED 2026-07-23** (§5.5) | A | S2, S3, S4 | Scripted fork-bomb/syscall/write denied, channels survive → in-guest rlimits-after-privilege-drop + seccomp + Landlock + host watchdog | **[R]** | toward gate 2 (req 8) |
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
live guest from a fresh one proves nothing (.claude/rules/measurement-and-reporting.md rule 19(c)), and the three
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
**The `[A]` half — a metered real-model fan-out through the bridge — is recorded below.**

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

**Observed 2026-07-23 — S3 `[A]` PASS, ~$0.001 spent.** `npm run repl-sandbox:s3-paid --json`
(`scripts/repl_sandbox_s3_paid.py`) on the same Hetzner AX41, reached per §4.1, against the **real**
`ChatCompletionsProvider` reaching `gpt-5.4-2026-03-05` at `https://api.openai.com/v1`. The harness
reuses the `[R]` probe's boot / hybrid-vsock bridge / host-witness / teardown wholesale and changes
exactly two things: the provider ($0 stub → the env-driven real client, key read host-side from
`TRELLIS_LM_API_KEY` and never logged) and the guest program (a canned round-trip → a real fan-out
over four arithmetic slices with one checkable answer each). This is the engine-fidelity check the
`[R]` run structurally cannot be: a **real model actually drove the `llm_query` channel across the
boundary**.

| claim | observed |
|---|---|
| a real model answered, over the bridge | the flat fan-out `llm_query_batched` returned **`391, 133, 863, 42`** (17×23, 128+5, 900−37, 6×7) and the single `llm_query` returned **`60`** (48+12) — every slice correct against its pre-known answer, none the scripted `S3-OK`. The **shipping** guest path (`guest_rpc.GuestRpc` over `transport.VsockClient`) carried both |
| the crossing is real, not a guest talking to itself | the host witness counted **2 accepted, 2 requests** — one per RPC call (the 4-wide batch, then the single); the audit read `accepted · peer_closed` twice. This host-side count is the one thing the `[R]` negative control proved a self-answering guest cannot forge |
| the fan-out is flat at `max_depth` 1 | four slices went out as **one** batched call (width = the shipped `max_in_flight` 4, admitted without raising), plus one singleton — the shape rlms drives at `depth 1`. No child REPL |
| the dollar ledger is real | `spend_ledger.spent` = **$0.00055**, positive (a real model was billed, not the $0 stub) and a rounding error under the $5 cap. Batched fan-out 8.7 s (four sequential real completions), single 1.0 s |
| genuine VM boundary | guest kernel **6.18.35** vs host 6.8.0-134, distinct `boot_id`, clean teardown (socket node gone, container unlisted, zero surviving VMM) |

**Requirement 5's `[A]` was banked in the same session for one more sub-cent call.** `--cap-halt`
sets the spend cap below the first charge; the batched fan-out came back
**`CapSpendError: cap_spend: session halted`** and the *next* call (the single) was refused in **0.5 ms**
by the `session_exhausted` path — a real fan-out halted at the dollar cap (BUILD_PLAN §6 req 5 `[A]`).

**Two honest residuals the cap-halt run surfaced — for GB (req 5 hardening), not defects in S3.** S3's
`[A]` asked only whether a real fan-out halts at the cap, and it does. But `SpendLedger.charge`
(`ledger.py`) evaluates the cap *between* calls and **refuses a cap-crossing charge without committing
it**, so: (a) the batch that trips the cap runs to completion — its API calls execute and are billed
**upstream** — before the charge is evaluated, so the cap bounds the *ledger* between calls, not the
*upstream* spend within the tripping batch; and (b) because the tripping charge is refused-not-committed,
the ledger read **`$0.00`** while OpenAI actually billed ~one batch (the cap-halt run's real spend,
~$0.0003–0.0005, is unmetered by design — hence "~$0.001 total" this session). Hardening options for
GB req 5: charge a pre-estimate before the call, or commit-then-halt so the ledger reflects reality, or
bound batch cost ahead of the call. Recorded here because the enforcing surface's shape is only as
honest as the residual named beside it.

**Zero surprises off-host.** The harness's verdict logic — the deterministic slice check, the provider
env handling, and the two assessors that turn a guest report into a pass/fail — is under test in
`src/repl_sandbox/tests/test_s3_paid.py` (16 checks, no `/dev/kvm`, no key, no network), so a mistake
in *what counts as a pass* surfaces on a development box rather than after money is spent. The one
credential-reading call site is `lm_handler.openai_chat_provider_from_env`; the key is read there,
handed to the client, and named nowhere this process logs, audits, or serialises.

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

**Observed 2026-07-23 — S4 `[R]` PASS.** `python3 scripts/repl_sandbox_s4_probe.py` → **exit 0**
on the same Hetzner AX41 that passed G1, S2 and S3 (`npm run repl-sandbox:s4-probe`, reached per §4.1;
the script refuses on any box without `/dev/kvm`). Kata 3.32.0 · Cloud Hypervisor v52.0 · containerd
2.2.1 · image `python:3.12-slim` · guest kernel **6.18.35** against the host's 6.8.0-134. **The `[A]`
half — a real model driving the `run_query` facade — is recorded below and PASSED the same day.**

| claim | observed |
|---|---|
| a real query crosses and the rows are the fixture's | the guest's `run_query` → `materialize` returned **`[[1,'alpha',10],[2,'beta',20],[3,'gamma',30]]`**, equal to the fixture, carried by the shipping path (`guest_rpc.GuestRpc` over `transport.VsockClient`) against a real Postgres the broker held the credential for. The host witness counted **accepted=5, requests=5** — one per RPC (read, materialize, write, two escapes) |
| the DB seam is a second port on the ratified transport | the guest's `AF_VSOCK (2, 5002)` arrived at **`/run/vc/vm/<sandbox>/clh.sock_5002`**. This is the first host confirmation of the `<uds>_<port>` convention on a port other than S3's 5001 — INTERFACES §3.1a generalises across ports, observed rather than assumed |
| zero credential in the guest | `secret_found=False` — a host-side grep of the guest's dumped env/argv/globals for the real DSN and password found nothing — and `canary_found=True`, the planted fake secret the same grep *did* find. Without that positive control the first result would be indistinguishable from a broken grep |
| a write is denied, at both layers | `write_denied=True` (the guest's `INSERT` crossed the bridge and came back a `denied` refusal from `policy.inspect_sql`) **and** `role_denied_write=True` — a direct connection *as the read-only role*, no broker in the path, had **Postgres itself** refuse the same statement. The primary control shown independent of the inspector |
| requirement-9 escape primitives denied | `pg_read_file` and `COPY … TO PROGRAM` both refused |
| no SQL-level egress origination | installed extensions were **`['plpgsql']`** only — neither `dblink` nor `postgres_fdw`. The honest weak proxy, not a NIC boundary (see below) |
| clean teardown | socket node removed, container unlisted, zero surviving Cloud Hypervisor processes; the throwaway read-only role **dropped** (verified absent afterward, so no credential outlives the run) |

**The negative control is the load-bearing half, and it took two passes to make it sharp.**
`--negative-control` has the guest answer *itself* with canned fixture rows and canned refusals, never
dialing the DB port. Run that way the run **exits 3, DETECTED**, and after the fix below the **only**
failing claim is the witness reading `accepted=0` — every guest-visible claim (correct rows, clean
credential grep, write denied, both escapes denied) still passes, exactly as designed. The first
attempt was blunter: the fake decided refusals by "does the statement start with `select`", so
`SELECT pg_read_file(...)` slipped through and the control was caught by a *guest-visible* claim as
well as by the witness. A control that any claim other than the witness can catch is not testing what
it says it tests, so the fake now forges the broker's behaviour exactly — the one benign read
succeeds, everything else is refused.

**Two further defects in the instrument, both found by running it rather than by reading it.** The
host exhibits an **intermittent `ctr task exec` hang** — the call burns its whole timeout and the run
dies — observed **twice in about thirteen runs**, once inside source installation and once on the
guest program itself, so it is a general Kata-shim flake and not specific to any one payload. It is the
same class S3 recorded for `destroy()`. Unwrapped it surfaced as a bare `subprocess.TimeoutExpired`
traceback, which reads like the boundary broke when nothing about the boundary was exercised; it is now
caught and reported as *"could not run … not a failed claim. Re-run."*, preserving the distinction
`ProbeError` exists for (teardown was never at risk — the raise happens inside the probe's `finally`).
Separately, the probe had been calling the S3 probe's `install_sources`, which ships S3's guest probe,
control listener and request JSON — **none of which S4 executes** — buying extra exec calls, and so
extra windows on that flake, for files it never used. It now ships only the package its guest runs.
**Replication: about eleven passes and two infrastructure flakes across roughly thirteen runs**; every
pass reported the same witness count, the same rows, and the same seven verdicts.

**The egress claim stays the weak one, and the run does not strengthen it.** `['plpgsql']` proves the
SQL-level origination path is closed; it is **not** evidence of a deny-by-default NIC boundary, because
no such surface exists in the merged code (§6 requirement 6 is "S4 + GB") and the throwaway Postgres is
colocated with the broker, so there is no separate DB-host hop to test. Recorded as observed fact with
its scope attached, per §1's rule that a bound with no engine behind it is not a control.

**Provisioning, as actually executed.** With no `TRELLIS_PG_DSN` set the probe installed the
`postgresql` package, created `trellis_db` with a three-row fixture, and created the least-privilege
login role from the shipped `backends.postgres_role_ddl` with a random password held host-side only —
all via `sudo -u postgres psql`. The broker's own client is `psycopg2`, host-side; the host venv needed
it installed, as the S3 `[A]` run needed `openai`. The database and package remain on the host; the
role does not.

---

**How the probe is built.** `scripts/repl_sandbox_s4_probe.py`
(`npm run repl-sandbox:s4-probe`) reuses the S3 probe's boot / hybrid-vsock discovery / host-witness /
teardown wholesale by import (the `repl_sandbox_s3_paid.py` `_load_probe()` pattern — a second copy of
that plumbing would be a second thing to keep true) and stands the DB seam up on the **second** vsock
port `config.ports.db` (5002), serving `host.broker_handler` where S3 served `host.lm_handler`. It
ships the guest only the package its own program runs (§ the exec-flake finding above).

---

**Observed 2026-07-23 — S4 `[A]` PASS, $0.011 spent across three runs.**
`npm run repl-sandbox:s4-paid --json` (`scripts/repl_sandbox_s4_paid.py`) on the same Hetzner AX41,
against the real `ChatCompletionsProvider` reaching `gpt-5.4-2026-03-05` at `https://api.openai.com/v1`.
**A real model, shown nothing but the rendered stubs, composed `run_query` → `materialize` itself and
answered a question whose answer was only in the database.**

| claim | observed |
|---|---|
| model-authored code drove the real facade | the block the model wrote ran in the guest against `capabilities.materialise` stubs, dialed `AF_VSOCK (2, 5002)`, and came back with rows from the real Postgres the broker held the credential for. Witness **accepted=4, requests=4**. The granted ops `run_query`/`resolve_meta`/`materialize` all materialised as callable stubs |
| the answer is right, and only the database had it | the model submitted, on the `answer` channel, *"Among the documents tagged 'research', delacroix has the greatest total word_count with 9140."* — the value this harness fixed in advance. **Neither shortcut reaches it**: most documents overall is okonkwo, highest total word_count overall is vasquez |
| the answer was not guessable — the falsifier fired | **`--no-db` → DETECTED (exit 3)**, $0.00093. Asked the same question with the tools removed and pressed for a specific number, the model answered *"I don't have the actual row data … total word_count of 0"*. Without this the correct answer above would be no evidence about the facade at all |
| ergonomics: **two attempts**, and the first failure is the finding | attempt 1 composed the query and the handle→materialize sequence **correctly on the first try** and failed on one thing only: it wrote the parameter placeholder as `?` and got `UpstreamError: SyntaxError from the postgres driver`. Attempt 2 changed it to `%s` and passed. See the paramstyle finding below |
| the error surfacing is what fixed it | the refusal reached the model as a Python traceback inside the guest ([INTERFACES §7](REPL_SANDBOX_INTERFACES.md) (Error model)) and the harness fed that stderr back verbatim. The self-debug loop is not decoration here — it is what turned a failed run into a passing one |
| zero credential in the guest | `secret_found=False` with `canary_found=True`, the same host-side grep and positive control the `[R]` run used, now applied to a namespace containing model-authored code |
| the bill is real and bounded | `spend_ledger.spent` = **$0.00706** for the main run (positive, so a real model was billed; a stub answers at $0), against the $5.00 cap. Attempt 1 $0.00297, attempt 2 $0.00409 |
| genuine VM boundary, clean teardown | guest kernel **6.18.35** vs host 6.8.0-134; socket node removed, container unlisted, zero surviving VMM, throwaway read-only role **dropped** |

**The negative control is the sharp one, and it came out exactly as designed.** `--negative-control`
has the guest answer itself with canned rows, never dialing the DB port. Run that way the harness
**exits 3, DETECTED**, and the *only* failing claim is the witness reading `accepted=0` — the model
still wrote good code, the answer still read `delacroix … 9140`, the credential grep was still clean,
teardown was still clean, `first_try` was still true. Every model-visible claim passes and the
host-side connection count is the one thing a self-answering guest cannot forge.

**The finding: the `params` slot documents no paramstyle, and that cost an attempt.** The rendered
stub says `run_query(sql: str, params: list | None = None)` and the doc line says what the call
*does*, but neither says that the bound-parameter placeholder is psycopg2's `%s`. The model guessed
`?`, which is the DBAPI qmark style and the reasonable guess. It recovered from the traceback, so the
facade is usable — but a documented paramstyle would have made this a first-attempt pass, and the doc
string is the cheapest possible place to put it. Recorded rather than fixed here: the descriptor docs
are prompt-facing bytes, so editing them is [AGENTS.md §4](../../../AGENTS.md) rule 16 work and belongs
in its own change, not appended to a run that has already been observed. There is a second, milder
tension behind it: the broker's error text is deliberately terse (`SyntaxError from the postgres
driver`, with the driver's own message withheld), and that terseness is what made the model guess
rather than read. Redaction and self-debug ergonomics pull against each other, and the trade is worth
naming where it was observed rather than discovering it again in GB.

**The defect this harness's authoring found, off-host, before a cent was spent.** `run_query(sql)` —
the natural call, with `params` left at the default the rendered signature offers — **was refused by
the broker**: `denied: params must be a list, got NoneType`. `capabilities._stub_source` emitted every
declared parameter into `args`, so an unset optional crossed as an explicit `null`, and every host op
reads its optionals with `args.get(name, default)`, which returns the null rather than the default
when the key is present. **Five of the ten broker/algebra capabilities declare an optional parameter**
(`run_query.params`, `run_cypher.params`, `search.limit`, `locate.limit`, `narrow.start`/`end`) and
each was reachable only by passing a value its signature says is optional. Fixed at the one point that
closes the class: the generated stub now builds `args` from the required parameters and adds an
optional one only when the caller set it, which is the rule
[`guest_rpc.lm_request_from_envelope`](../../../src/repl_sandbox/guest_rpc.py) already applied on the
LM port ("a `model` of `None` is dropped rather than sent as null"). Pinned by
`test_capabilities.py::test_stub_arguments_forward_the_parameter_names` and, behaviourally, by
`test_s4_paid.py::test_the_natural_call_reaches_the_broker_without_a_null_params`. **This is what the
`[A]` half is for**: `[R]` hand-wrote its envelopes and so could not have found it, and no amount of
re-reading `capabilities.py` did either — it took something composing a call against the rendering.

**Scope limits carried honestly.** (1) The run does **not** exercise `supervisor.GuestSupervisor`: it
imports `rlm.environments.base_env`, and the guest image (`python:3.12-slim` plus the shipped package)
carries no rlms, so the guest program binds the transport hook and execs the materialised stubs
itself. Shipping a hand-written `rlm` shim would have faked the very pin the supervisor exists to
hold. **The guest image must carry rlms before S6 can run its equivalence harness** — a real S6
prerequisite, found by trying to use the supervisor rather than by planning around it. Nothing here
claims namespace persistence, reserved-name re-pinning, or `locals` marshaling. (2) Each attempt is a
fresh guest process, so the model is told its block must be self-contained; cross-turn persistence is
S2's result and S6's contract, not this run's. (3) The authoring calls are host-side, as rlms' own
driver makes them, and the guest is opened `lm=False` — so this run drives **one** listener, the DB
one, and says nothing about two at once. (4) `annotations`, from the generated module's
`from __future__` line, is visible in the model's namespace alongside the stubs; harmless here, worth
a tidy when the supervisor's scaffold-name exclusion takes over in S6.

**Replication and cost.** Three runs, all first-try on the infrastructure (no `ctr task exec` flake
this session): `--no-db` $0.00093 → DETECTED, the default run $0.00706 → PASS, `--negative-control`
$0.00301 → DETECTED. **$0.011 total**, against an estimate of ~$0.02 and the house $5 cap.

---

**Off-host coverage, which is what makes the host run cheap to trust.** The five verdict assessors,
the credential grep and its canary positive control, and — the strongest check available without KVM —
the whole shipping host-side chain (broker, `inspect_sql`, handle table, `guest_rpc` translation)
driven end to end over the loopback double so `run_query` → `materialize` returns the fixture rows and
a write comes back denied, are under test in `src/repl_sandbox/tests/test_s4_probe.py` (**22 checks**,
no `/dev/kvm`, no Postgres, green on both the Windows dev box and the host). What that suite
structurally cannot reach — and what the run above supplied — is a frame crossing a VM boundary,
hybrid-vsock delivery on the DB port, and a *real* Postgres role refusing a *real* write.

The `[A]` half carries its own off-host suite, `src/repl_sandbox/tests/test_s4_paid.py`
(**36 checks**, no `/dev/kvm`, no key, no network): every assessor, the code extractor, the prompt
builder — including a check that no row value and no author name ever reaches the prompt, so the run
cannot be measuring reading comprehension — a derivation of the expected answer *from* the fixture
rather than an assertion beside it, a proof that both shortcuts name a different author, and the whole
shipping host-side chain (`render` → a model-shaped block → `materialise` → `GuestRpc` → `Broker` →
handle table) driven over the loopback double. **That last one is where the `params: None` defect
surfaced**, at $0, before the host was touched.

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

**Observed — PASSED on the host 2026-07-23** (`npm run repl-sandbox:s5-probe`; five
consecutive runs, exit 0, zero infrastructure flake). Built:
`src/repl_sandbox/hardening.py`, `scripts/repl_sandbox_s5_probe.py`, and 44 off-host checks
in `src/repl_sandbox/tests/test_s5_probe.py` (pytest 960 → 1004).

**The spike's real finding is that its own ratified control did not exist on the ratified
stack.** cgroups are not reachable from the worker; the property is held by `setrlimit`
after a privilege drop. Authoritative: [ARCHITECTURE §2.1](REPL_SANDBOX_ARCHITECTURE.md),
which corrects §1, §4, §7 requirement 8, THREAT_MODEL G-2, and this section in one place.
The probe re-derives the finding on every run, so the record's basis stays checkable
instead of resting on one session's transcript.

Observed in the passing run:

| Claim | Observed |
|---|---|
| 1 — the unhardened baseline is dangerous (positive control) | forbidden write succeeded, `unshare` permitted, **200 processes forked uncapped** |
| 2 — cgroups unavailable | `cgroupfs_mounted: false`, `/proc/self/cgroup` `0::/`, Landlock ABI 7, guest kernel 6.18.35 |
| 3 — fork bomb capped | **refused at 23** of a 24 limit, as uid 65534 |
| 4 — syscall denied | `EPERM`, with `Seccomp: 2` / `Seccomp_filters: 1` read back from `/proc/self/status` |
| 5 — write denied, sandbox still usable | `EACCES`; reads and the in-namespace regex/stdlib tools still work |
| 6 — **both channels survive, both listeners open at once** | witness `accepted=3` of 3 expected (1 LM + 2 DB); LM returned its completion, DB returned the fixture rows |
| 7 — watchdog reaps a wedged VM | `alive_before=true` → `SIGSTOP` the VMM → `alive_after_freeze=false` in 19.2 s → reaped, no VMM survived |
| 8 — clean teardown | no container, no VMM, no listener socket, no cgroup directory for this sandbox |

**Claim 6 closes a scope limit S4 carried honestly.** S3 opened only the LM listener and S4
only the DB one, so neither said anything about two at once; S5 runs both against one
sandbox and one witness.

**Both falsifier arms fire (exit 3).** `--no-harden` — with Tier-0 removed the enforcement
claims fail, as they must; a pass there would mean the probe measures something that was
already true. `--negative-control` — the guest answers itself with canned replies and every
guest-visible claim still passes, caught only by the host witness. Two arms because S5 makes
two kinds of claim, and one arm cannot falsify both.

**Three defects the run found that reading did not.** (1) The guest program hard-coded its
own directory while `GUEST_DIR` is S3's inherited `/run/s3`; it is now self-locating from
`__file__`, so the two cannot drift. (2) Landlock was not granting `/proc`, so the worker
could not read `/proc/self/status` — every control applied correctly and the probe reported
`Seccomp: -1`, i.e. **a run that hardened properly and could not prove it.** (3) The LM text
was read from the wrong field of `LMResponse`. All three were invisible to a green off-host
suite.

**Scope limits, carried:** the watchdog's unresponsive state is produced by `SIGSTOP` on the
VMM, which is a faithful symptom and *not* the shim wedge this host throws about twice in
thirteen runs — that one cannot be summoned on demand, so the reaper is unproven against
shim states it has not met. The seccomp filter is a denylist and the records said allowlist
(ARCHITECTURE §2.1). Host-side cgroup residue from earlier S3/S4 sessions is still present;
S5 leaves none of its own and now checks.

### 5.6 S6 — Author the `IsolatedEnv` subclass

- **Objective:** wrap S2–S5 behind the three-method contract as the real `KataREPL(IsolatedEnv)`
  (`setup` / `load_context` / `execute_code`), with tools registered as CapabilityDescriptors materialized
  into vsock proxy stubs ([SPEC §2](REPL_SANDBOX_SPEC.md), §4.3).
- **Real unknown it closes:** is the sandboxed backend a genuine **drop-in** for the rlms driver — does an
  unedited context load → `execute_code` behave as `LocalREPL` does?
- **Entry preconditions:** S1–S5 complete (contract, boundary, both chokepoints, hardening), **plus the
  rlms-in-the-guest decision below.**

**Open decision S6 must make first: `GuestSupervisor` cannot currently be imported in the guest.**
Found by S4 `[A]` trying to use it (§5.4). `supervisor.py` does
`from rlm.environments.base_env import RESERVED_TOOL_NAMES`, and the guest image — stock
`python:3.12-slim` plus the shipped `repl_sandbox` — has no rlms. Measured rather than assumed: that
import pulls **`rlm`, `attrs`, `python-dotenv` and `rich`, ≈3.9 MB, all pure Python** (no compiled
extensions, so shipping is mechanically possible) — and the *only* thing the guest takes from any of
it is **one frozenset of eight strings**. Everything else `GuestSupervisor` uses from rlms is
convention it already reimplements (the `REPLResult` field names, the `answer` channel). Three options:

| | approach | cost |
|---|---|---|
| **A** | ship/bake rlms into the guest image | 3.9 MB and four packages for eight strings, `rich` included; more `ctr task exec` chunks on a host that intermittently wedges them, against §5.4's "shipping fewer files is a reliability property" |
| **B** *(recommended)* | host reads `RESERVED_TOOL_NAMES` from the **real** pinned package and passes it in — `GuestSupervisor(reserved_names=…)`, delivered over the control port | a signature plus a control-port payload field. The pin stays enforced where rlms actually lives and [INTERFACES §8](REPL_SANDBOX_INTERFACES.md)'s conformance test still fails first if the set moves. Also the better shape on its own terms: the guest is untrusted and should not need the driver's library |
| **C** | vendor the eight names into `repl_sandbox`, pinned by a host-side conformance test | simplest, but duplicates a value `supervisor.py`'s own docstring says is "read from the pinned package rather than retyped" |

**B is not the shim S4 `[A]` refused.** That shim would have *faked* the pin — a hand-written `rlm`
module in the guest asserting eight strings on its own authority, while making a run look as though it
had exercised the real supervisor. B reads the genuine pinned package host-side and transmits its
value. The distinction is which side holds the authority, not whether the constant travels.

The one thing S6 should settle with the control port in hand rather than now: whether the names ride
on `setup()` or on every `execute_code`. That depends on the op set S6 defines, which is why this is
recorded as S6's decision instead of pre-empted here.

**SETTLED 2026-07-24 — option B taken, and it rides with the scaffold rather than over the control
port.** The sub-question above turned out to have a forced answer, and the forcing is worth more than
the choice. The reserved names are consumed in `GuestSupervisor.__init__`, which builds `self._pins`
and calls `_restore_scaffold()` before returning. The four control ops — `ping`, `load_context`,
`exec`, `shutdown` — can only arrive at a supervisor that already exists. **So the control port
cannot carry the names in time:** a value delivered on the first `exec` would find the pins already
built, empty. What actually constructs the supervisor is `install_scaffold`, the launcher's
out-of-band channel (`launcher.py`, `GuestHandle`), which is already the thing that carries
construction-time material and has the same ordering constraint. The names travel with it.

This is the third instance of one shape: **the record named a mechanism that cannot carry the
property, and the property is preserved on a different surface** — after S3's peer CID (a claim about
native vsock, carried as a claim about virtualisation) and S5's cgroups (a claim about containers on
a host kernel, same). The phrase "delivered over the control port" above is the artifact; option B
itself stands unchanged, because option B was never about the channel. It was about which side holds
the authority.

What landed:

- `supervisor.py` no longer imports rlms at all — the one guest-side `rlm`-rooted import in the whole
  transitive closure of the modules the guest loads. `reserved_names` is a **required keyword-only
  argument with no default**: a default would have been this module asserting the set on its own
  authority, which is the shim S4 `[A]` refused, reached by omission instead of by decision.
  **What that guard does and does not deliver, stated exactly, because the first draft of this line
  overclaimed and a review caught it:** it refuses *absence*, a wrong container type, and the empty
  set. It does **not** refuse a wrong-content frozenset, and it cannot — checking the contents would
  mean the guest deciding what the names are, which is the authority option B moves to the host. The
  empty set earns its own refusal because it is the one wrong content nameable without that
  authority: it pins nothing, so `_restore_scaffold` becomes a no-op and model code keeps a name it
  rebound into the next turn, with no error anywhere.
- `kata_repl.py` is the host-side authority read, because it is the one module already depending on
  rlms for the contract it implements. `InProcessLauncher` defaults to the pinned value via a
  function-local import — correct *there* and wrong in the supervisor, because that double runs in
  the host interpreter where rlms is installed.
- **A latent drift closed, found while tracing this.** `capabilities.py` carries a second,
  hand-typed copy of the eight names, and it legitimately must ship into the guest, because
  capability *registration* is validated guest-side and refusing a name needs the names. Nothing tied
  that copy to the pinned package: both copies were compared against their own hand-written literals,
  so a set that moved upstream would have reddened `test_rlms_conformance.py` while `capabilities.py`
  drifted silently. `test_every_in_repo_copy_of_the_reserved_names_tracks_the_pinned_package` now
  makes "the conformance test fails first" true of every copy rather than of one.
- Each of the three new checks was **watched failing against planted breakage** before being trusted
  (rule 19(c)): a drifted name in `capabilities.py`, the guest-side rlms import restored, and a
  default given to `reserved_names`. `pytest` 1,004 → 1,007.

**The equivalence target is fixed in [CONFORMANCE §6](REPL_SANDBOX_CONFORMANCE.md), before the
harness exists**, with twelve clauses predicted FALSE today — the spike's expected yield, not a
defect log against it.

**S6's remaining half, and why it is not a probe-authoring job.** `KataLauncher.boot` raises
`NotImplementedError` after the G1 gate passes: guest-image mint, Cloud Hypervisor launch with an
assigned CID, and supervisor readiness are unbuilt, and the package has no guest entry point — the
only `GuestSupervisor` construction is inside `InProcessGuest`, a host-side double that provides no
isolation. S2 proved the `ctr run --runtime io.containerd.kata.v2` path boots a stateful guest, but a
spike driving `ctr` by hand is not that launch path. Until it exists, an S6 PASS would be a claim
about `KataREPL` and not yet about `KataLauncher`, and the equivalence harness has nothing to point
at but the double. **That is the next build, and it is the one place where a harness would otherwise
reach for `InProcessLauncher` and quietly measure the host talking to itself** — which is exactly
what the `--in-process` arm below exists to catch.

**Falsifier arms, designed against how a PASS could lie.** Two, because S6 makes two structurally
different kinds of claim, and the equivalence comparator is a *sameness* detector that can never be
its own falsifier's detector — the better the boundary works, the more it wants both sides to look
identical.

| flag | removes | claim it falsifies | detected solely by |
|---|---|---|---|
| `--in-process` | the microVM — `InProcessLauncher` substituted, with its `rpc_hook` dialing the real host listener so the crossing is forged as convincingly as possible | "the compared round-trips crossed the Kata boundary" | a boot identity (`/proc/sys/kernel/random/boot_id` plus `uname -r`) returned *through* `execute_code` and cross-read out-of-band from the same sandbox. `boot_id` supplies per-run freshness, so a replayed identity cannot satisfy it |
| `--mutate-guest=<defect>` | one declared observable from the guest's reply, on the wire, KataREPL side only — swept over `drop-final-answer`, `blank-stderr`, `empty-locals`, `wrong-local-value`, `no-restore-scaffold`, `nonnumeric-execution-time`, `drop-context-binding`, `amnesia` | "the comparator can tell same from different at cell X" | the comparator, reddening at **exactly one** cell. Zero cells means X is vacuous; more than one means the cells are coupled. Both are failures of the arm |

**The guest entry point is BUILT (`src/repl_sandbox/guest_main.py`), and has no non-test caller.**
Half of the missing seam, and the half that does not need the host to author. It reads a
launcher-placed payload, builds the RPC hook, binds the control port, constructs the supervisor,
applies Tier-0, and serves — in that order, each position forced by something a later one would
break. `KataLauncher.boot` is its only intended caller and still raises, so **nothing in a
deployment path reaches this module today** (rule 15: correct and reachable are independent claims).
26 checks in `tests/test_guest_main.py`; `pytest` 1,007 → 1,034.

One choice inside it is worth naming because getting it wrong would have been invisible: **the
listener is native `AF_VSOCK`, never `HybridVsockListener`.** §3.1a's correction moved the *host*
side to an `AF_UNIX` socket at `<uds>_<port>`; the guest side is unchanged and still binds
`AF_VSOCK` on `VMADDR_CID_ANY`, so **the guest keeps exactly what the host lost — a peer CID the
kernel supplies at `accept()`**, which is why S3 observed `peer_cid = 2` from inside. Reaching for
the hybrid class here would have handed `require_host_cid` a number this process chose itself,
turning the one authentication the guest can genuinely perform into a self-assertion. It would have
passed every functional test. `transport.VsockListener`'s docstring says it is "used host-side on
`LM_PORT` and `DB_PORT`" — that describes its only caller before now, not what the class does, and a
reader taking it as a type statement is exactly how the wrong class gets picked.

The property that made this necessary is checked by **simulating the guest** rather than reading
import lines: a subprocess blocks the `rlm` root outright and imports the module for real, because
the transitive closure is what failed before and a line-scan cannot see it.

**The boot procedure, transcribed from the probes that already perform it.** The launch path is not
research — S2 through S5 boot real microVMs on the AX41 every run, and the whole of it is *one*
`ctr` form plus discovery of what containerd's shim already built. The probes never invoke
`cloud-hypervisor` directly and never call `kata-runtime` except for `--version`.

```
ctr run -d --runtime io.containerd.kata.v2 <image> <name> sleep infinity
ctr task exec --exec-id <id> [-d] <name> sh -c <script>
ctr task kill -s SIGKILL -a <name>   ·   ctr task delete -f <name>   ·   ctr container delete <name>
```

Ordered: mint a sandbox name (it is simultaneously the container name, the `pgrep` filter, the
`/run/vc/vm/<id>` directory and the shim-kill pattern) → `ctr run -d` → **discover** the vsock UDS by
parsing the VMM's own argv for a `/run/**/vm/**` token and taking the one non-`api` socket in its
dirname → bind the host end at `<uds>_<port>` *before* any guest code runs → ship the package →
start the guest listener → dial `<uds>` with `CONNECT <port>\n` and read the `OK <port>\n` ack **one
byte at a time**, because the ack and the first frame share a stream and a buffered read swallows the
frame's length prefix.

Two details are load-bearing and easy to lose. `ctr run -d` returning is **not** a boot — the probes
record the elapsed time separately to keep that distinction visible, and readiness is the first
`ctr task exec` that returns. And the UDS path is *discovered rather than assumed*, because a probe
that hard-codes it "would report 'no bridge' when what it means is 'no socket where I looked'".

**What a shipping launcher needs that no probe performs** — this is the actual S6 build, and it is
short because the boot itself is solved:

1. **A guest whose entrypoint is the supervisor.** Probes run `sleep infinity` and drive each turn
   with a fresh `ctr task exec`; a launcher's guest must come up already listening on the control
   port. No probe constructs a `GuestSupervisor` in a guest at all.
2. **The scaffold before any untrusted worker.** The supervisor takes it at construction and no
   control op installs one, so materialising capabilities is something the *launcher* does to the
   guest — which is also the channel the reserved names now ride (settled above).
3. **Real readiness polling.** Every probe uses a fixed sleep (1.0 s, 1.5 s, 2.0 s). A launcher needs
   a bounded retry against the `CONNECT` handshake, which already raises usefully when nothing is
   listening.
4. **Refusing a shim that returned 0 without creating a VM.** The probes check the exit code and then
   *assert* a boundary; a launcher must turn "no `cloud-hypervisor` process carries this id" into a
   refusal.
5. **Per-session identity.** `GUEST_CID = 3` is a module constant in every probe, which is sound for
   one sandbox on an idle host and not for a launcher keying ledgers, rate buckets and `SessionTable`.
6. **Image pull, and a `ctr` namespace.** Probes assume the provisioner already pulled the digest, and
   none passes `-n`, so everything lands in containerd's `default` namespace — which is why leaked
   cgroups appear at `/sys/fs/cgroup/default/kata_<id>`. **Observed on the host 2026-07-24: four such
   directories survive from earlier runs.** No probe removes them; S5 only counts them.
7. **Egress.** `provision_kata_host.sh` states plainly that the guest has no interfaces as a
   `ctr`-without-CNI *default*, explicitly **not** as an enforced control. Requirement 6 is GB's, and
   a launcher that claimed containment on today's behaviour would be claiming an accident.

Rejected, with reasons worth keeping: a canned-reply `--negative-control` in the S3/S5 sense is
**strictly dominated here** — it is caught by the witness *and* by the comparator the moment any
block leaves the canned set, which is S4 `[R]`'s "starts with select" leak in a new costume;
`--in-process` is the better forgery on the same claim precisely because it runs the real
`GuestSupervisor` and so answers arbitrary blocks correctly. `--no-context` fires nothing, because it
removes an input from *both* arms and the table stays green — repaired into
`--mutate-guest=drop-context-binding`, which removes the binding on one side only and therefore has
something to disagree with. `--no-harden` can only ever report DID NOT FIRE, since Tier-0 changes no
observable the table reads. One construction constraint follows from the first arm: the probe must
**not** gate on `launcher.preflight()`, because `InProcessLauncher.preflight()` never returns ok and
would catch the arm before the provenance signal could — giving it a second detector and making it
noisy.
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
| 1 Exfil = data-flow; DLP + byte caps on top | Guest holds handles not payloads (broker) + content-DLP + per-session byte caps on `llm_query`/`vector_search`/`answer` | **partially met 2026-07-23 (§5.4):** `run_query` returned an opaque handle and no row crossed until the metered `materialize`; a host-side grep found no credential in the guest (canary positive control fired). **Reproduced 2026-07-23 under the `[A]` run with model-authored code in the namespace** — same clean grep, same canary — which is a stronger statement than the scripted probe alone, though still not an adversarial one. The scripted 100%-injection payload and the byte-cap trip remain GB's | Real model steered by a hostile document (red-team) cannot leak a non-materialized secret via a sanctioned crossing; audit confirms | S4 + GB |
| 2 API key host-side only | LM handler holds the provider key | Scripted grep of guest env/namespace/memory for the key returns nothing | — | S3 + GB |
| 3 Split version pins | Deploy config: Kata ≥ 3.31.0 **AND** Cloud Hypervisor ≥ 52.0, separate feeds | Scripted version-assert on both binaries; two advisory feeds tracked | — | G1/GB |
| 4 Auth by the listener's session identity | The id `accept()` reports on broker + handler — kernel CID (native) or per-sandbox socket path (hybrid, §5.3) | Scripted forged-payload-id request is rejected; quota keyed to that id | Real model in session A cannot reach session B's scope | S3, S4 + GB |
| 5 Host-side CID-keyed hard ceilings | LM handler caps: concurrency, rate, dollar spend (hard-stop) | Scripted burst exceeds each cap → hard-stop (rlms caps proven bypassable) | **[A] banked 2026-07-23 (§5.3):** real fan-out `--cap-halt` → `cap_spend` refusal + `session_exhausted`. Residual for GB: cap is between-calls, not intra-batch/upstream-pre-emptive | GB |
| 6 APOC allowlist + DB-host egress deny | Host broker APOC deny-by-default + DB-host has no route | Scripted `apoc.load.json` SSRF attempt denied; no metadata route | — | S4 + GB |
| 7 `statement_timeout` + cost caps + no unbounded `[*]` | Host broker query governor | Scripted cartesian/`[*]` query is refused or timed out | — | S4 + GB |
| 8 In-guest process/memory caps + host watchdog | rlimits after a privilege drop + watchdog ([ARCHITECTURE §2.1](REPL_SANDBOX_ARCHITECTURE.md) — cgroups are unreachable from the worker) | **[R] met 2026-07-23 (§5.5):** fork bomb refused at 23 of a 24 limit as uid 65534, against 200 uncapped in the baseline arm; a `SIGSTOP`-frozen VM detected in 19.2 s and reaped with no VMM surviving | — | S5 |
| 9 Least-privilege Postgres role | NOSUPERUSER, no `pg_read_server_files`/`pg_execute_server_program`/`dblink` | **[R] met 2026-07-23 (§5.4):** `COPY TO PROGRAM` and `pg_read_file` denied by the inspector, **and** a direct `INSERT` as the role refused by Postgres itself | — | S4 + GB |
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
headlines at n=1–2 are weak — .claude/rules/measurement-and-reporting.md rule 11) exists because **model behavior is
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
