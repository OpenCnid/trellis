# Trellis REPL Sandbox — Documentation Index

**Status: decisions owner-ratified July 20–21, 2026. G0 lifted July 22, 2026 — a host-independent
control plane is built and tested in-tree; THE BOUNDARY ITSELF IS NOT BUILT.**

This folder replaces `rlms`' in-process `LocalREPL` with a real, self-hostable trust boundary while
keeping RLM compatibility. The records led implementation (document-driven design) and continue to
govern it: where a record and the code disagree, see the conformance findings below rather than
assuming either.

**Read this before reading anything else as a security property.** What exists is the software on
*both sides* of the boundary — the wire, the handle model, both host chokepoints, the capability
lifecycle, the guest supervisor, and the `KataREPL` backend. What does not exist is the boundary:
no Kata microVM, no vsock bridge on a real host, no Tier-0 in-guest hardening. **This is not yet a
sandbox and must not be deployed as one.** G1 (a KVM-capable Linux host) is unsatisfied, so every
milestone from S2 onward is blocked; `KataLauncher.boot` refuses rather than returning a handle
backed by nothing, and the in-process launcher used in tests announces that it provides no
isolation.

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
- **What is not built:** the Kata microVM, the vsock bridge on a real host, Tier-0 in-guest
  hardening — S2 through S6, all blocked on G1. No SPEC §8 acceptance gate has passed, and no paid
  `[A]` adoption gate has been spent.
