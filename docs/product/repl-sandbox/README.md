# Trellis REPL Sandbox — Documentation Index

**Status: decisions owner-ratified July 20–21, 2026. G0 lifted July 22, 2026. G1 and S2 passed on a
Hetzner AX41 July 23, 2026 — a real Kata microVM boots and holds state across turns. THE PRODUCTION
BOUNDARY IS STILL NOT WIRED: the guest has no vsock channel, no broker, and no Tier-0 hardening.**

This folder replaces `rlms`' in-process `LocalREPL` with a real, self-hostable trust boundary while
keeping RLM compatibility. The records led implementation (document-driven design) and continue to
govern it: where a record and the code disagree, see the conformance findings below rather than
assuming either.

**Read this before reading anything else as a security property.** What exists is the software on
*both sides* of the boundary — the wire, the handle model, both host chokepoints, the capability
lifecycle, the guest supervisor, and the `KataREPL` backend — plus, since July 23, a **prototype**
Kata microVM that boots on the provisioned host and keeps a Python namespace alive across turns
(BUILD_PLAN §5.2 (S2)). The two are **not connected to each other**: the guest in that spike is
reached by `ctr task exec`, not by the vsock bridge (S3), and it has no broker (S4) and no Tier-0
in-guest hardening (S5). **This is not yet a sandbox and must not be deployed as one.**
`KataLauncher.boot` still refuses rather than returning a handle backed by nothing, and the
in-process launcher used in tests announces that it provides no isolation.

## Reading order

| # | Document | What it is | Source of truth for |
|---|---|---|---|
| 1 | [REPL_SANDBOX_ARCHITECTURE.md](REPL_SANDBOX_ARCHITECTURE.md) | The ratified design record | **Design decisions** (the stack, depth, exfil resolution §3.1) |
| 2 | [REPL_SANDBOX_THREAT_MODEL.md](REPL_SANDBOX_THREAT_MODEL.md) | Consolidated security model | **Security** — assets, boundaries, control matrix, residual risk (consolidates ARCHITECTURE §7 + RESEARCH §14 + SPEC §6) |
| 3 | [REPL_SANDBOX_DATA_MODEL.md](REPL_SANDBOX_DATA_MODEL.md) | The handle / state model | **The exfil boundary** — handles-not-payloads, the slice-by-address algebra, the metered materialization exception |
| 4 | [REPL_SANDBOX_INTERFACES.md](REPL_SANDBOX_INTERFACES.md) | Wire + RPC contracts | **Contracts** — the vsock bridge, LM-handler / broker RPC, CapabilityDescriptor lifecycle (expands SPEC §2/§3/§4) |
| 5 | [REPL_SANDBOX_SPEC.md](REPL_SANDBOX_SPEC.md) | The summary sheet | **Config, invariants, acceptance gates** (the one-page reference; details live in 2–4) |
| 6 | [REPL_SANDBOX_BUILD_PLAN.md](REPL_SANDBOX_BUILD_PLAN.md) | Ordered build sequence | **Build order** — spikes, milestones, gates, the reachability-vs-paid split |
| 7 | [REPL_SANDBOX_DOUBT_FILTER.md](REPL_SANDBOX_DOUBT_FILTER.md) | **PROPOSED** defense-in-depth | The Layer 1–2 exfil "double cover" composed from the −1 doubt tier (schema only; prompt bytes deferred, Guardrail 15) |
| 8 | [REPL_SANDBOX_CONFORMANCE.md](REPL_SANDBOX_CONFORMANCE.md) | S1 findings, July 22, 2026 | **Where these records contradict the pinned `rlms==0.1.3` source** — four places marked *(source-confirmed)* that are not. Read before trusting an interface fact here |
| — | [REPL_SANDBOX_RESEARCH.md](REPL_SANDBOX_RESEARCH.md) | The full evidence trail | Every sourced claim + the red-team; the audit record behind 1–6 |
| — | [REPL_SANDBOX_LEARNINGS.md](REPL_SANDBOX_LEARNINGS.md) | Session knowledge | What was learned and corrected (incl. the two overreaches) |

Diagrams: [isolation view](repl_sandbox_architecture.svg) · [depth-1 flat fan-out](repl_sandbox_recursion.svg) · [standalone HTML](repl_sandbox_architecture.html).

## The load-bearing facts (one screen)

- **Boundary** = Kata Containers microVM (hardware KVM). gVisor evaluated, **not adopted**.
- **VMM** = Cloud Hypervisor. Pins: **Kata ≥ 3.31.0 AND Cloud Hypervisor ≥ 52.0** — two upstreams,
  two advisory feeds (never "Cloud Hypervisor ≥ 3.31.0").
- **Depth** = `max_depth` 1, flat sub-LLM fan-out only.
- **Exfil boundary is data-flow, not a filter** (ARCHITECTURE §3.1): the guest holds addressable
  **handles, not secret-bearing payloads** — holds under 100 % successful injection. DLP + byte caps
  and the doubt-filter (Layers 1–2) are **defense-in-depth, never the boundary**.
- **Egress** deny-by-default; **vsock is the only channel out**; DB access via a read-only host broker.
- **What is built** (July 22, 2026, uncommitted at time of writing): `src/repl_sandbox/` — the frame
  codec, transport, guest supervisor, handle table and algebra, both host chokepoints, the capability
  lifecycle, `KataREPL` and the G1 preflight. Run it: `npm run repl-sandbox:preflight` (fails on any
  host without `/dev/kvm`, by design), `npm run repl-sandbox:selftest`, `npm run repl-sandbox:drill`
  (`--negative-control` exits 3 when every planted break is caught), `npm test:repl-sandbox`.
- **What was proved on the host** (July 23, 2026, Hetzner AX41): **G1** — real KVM, Kata 3.32.0,
  Cloud Hypervisor v52.0, 11.5–14.2× acceleration differential. **S2** — `ctr run --runtime
  io.containerd.kata.v2` boots a guest on kernel 6.18.35 (host: 6.8.0-134-generic) in ~0.7 s to
  first exec, a variable set in turn 1 reads back in turn 5 from one unmoved worker process, and
  teardown leaves no VMM process behind — replicated **five consecutive runs**, 0.629–0.693 s.
  Run it *on the host*: `npm run repl-sandbox:provision` (idempotent; `--verify` mutates nothing)
  then `npm run repl-sandbox:s2-probe` (`--negative-control` exits 3 when the mid-run guest swap is
  caught). **Both results are one host** — a second *machine* is **deferred** (it buys little for a
  deterministic fact), while the fresh-*instance* test the provisioner still owes is scheduled on a
  nested guest of the AX41 itself, for free (BUILD_PLAN §11 (Open ordering calls)).
- **What is not built:** the vsock bridge on a real host, the DB broker against a real guest, Tier-0
  in-guest hardening, and the real `KataREPL` launch path — S3 through S6. No SPEC §8 acceptance
  gate has passed, and no paid `[A]` adoption gate has been spent.
