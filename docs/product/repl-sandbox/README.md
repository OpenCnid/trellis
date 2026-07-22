# Trellis REPL Sandbox — Documentation Index

**Status: DESIGN records — decisions owner-ratified July 20–21, 2026; NOTHING BUILT; owner-gated.**
This folder replaces `rlms`' in-process `LocalREPL` with a real, self-hostable trust boundary
while keeping RLM compatibility. The records lead implementation (document-driven design); no
code exists yet, and the research/build hold is not lifted.

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
- **Nothing is built.** Spike 1 (the `IsolatedEnv` subclass + vsock bridge) starts only when the
  owner lifts the research hold — see the [build plan](REPL_SANDBOX_BUILD_PLAN.md).
