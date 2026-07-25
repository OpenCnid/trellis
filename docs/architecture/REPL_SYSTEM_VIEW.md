# The REPL, system-wide — a reading of `trellis_repl_system.svg`

**Status: understanding record, dated 2026-07-25.** Companion to
[`trellis_repl_system.svg`](trellis_repl_system.svg). It documents what that diagram claims and
where each claim comes from, so a later session can check the picture against the code rather than
against this prose. Owner-directed after a design question exposed that the session had the REPL's
role wrong; the correction is recorded here rather than smoothed away, because the corrected
understanding is the point.

## 0. The error this record exists to fix

A session asked whether the sandbox composition should be a context manager or a plain function,
and framed it as a tension: *unmissable cleanup versus a session that outlives any single scope.*

**That tension does not exist, and believing it did was a category error** — the REPL and the
microVM were being treated as one object. They are two:

| | what it is | lifetime |
|---|---|---|
| **The workspace** | a domain, its artifacts, its accumulated past | durable; outlives every session |
| **The REPL namespace** | the live Python namespace a session works in | one session |
| **The microVM** | hardware-isolated compute wrapped around that namespace | one session; disposable |

A workspace persists because **its state is in the substrate**, not because a process stayed alive.
So a scope that ends is not a session lost — it is a VM released. The composition is therefore a
context manager, and the argument against it was never real.

rlms already models this independently: its driver ends a non-persistent run with `cleanup()`
(`rlm/core/rlm.py`). A context manager is that lifecycle expressed in Python.

## 1. What the diagram shows, panel by panel

**Left — workspaces, swappable, many.** A workspace is not a conversation thread. It carries domain
information, the artifacts it has produced, and its own past. The owner's framing: physics on
Tuesday, philosophy on Thursday; a mechanic with parts inventory, manuals, and customer
transactions as three separate ones. **Trellis' own source is a workspace**, which is how the
system edits itself, and repositories in general are a workspace kind (owner, 2026-07-25).

**Centre — one persistent namespace inside one ephemeral VM.** Ratified: **one workspace per
session** (owner, 2026-07-25). The namespace holds `context` (handles, never payloads), the three
pre-allocated roots for facts, beliefs and doubts, the artifacts prior turns built, and the
model-authored code that runs against them. Around it, the microVM: a hardware boundary holding no
credential, torn down at exit.

**The three ports.** `CONTROL` (5003) — the host dials in, the guest supervisor listens. `LM`
(5001) and `DB` (5002) — the guest dials out. The diagram marks both outbound ports' host ends as
unowned, because they are: that is the open seam recorded in
[`REPL_SANDBOX_BUILD_PLAN.md` §5.6](../product/repl-sandbox/REPL_SANDBOX_BUILD_PLAN.md).

**Right — the model holds addresses, never the corpus.** The
[code-mediated-text pillar](CODE_MEDIATED_TEXT.md) one level up: the engine computes positions and
moves bytes; the model supplies addresses. `llm_query` fans out flat at depth 1.

**Bottom — the substrate.** Content-addressed, append-only, final at write time. This is what makes
a workspace survivable, and it is why the VM above it can be disposable.

**The closing loop.** A query does not return a reply; it builds a **response artifact**, which is
filed back into the store, judged, given standing at a user gate (−1 doubt / 0 belief / +1 fact),
and becomes corpus for the next query. Output becomes input.

## 2. The claim the diagram makes that is worth checking first

**The REPL is meant to be gigabytes, read in slices, and no wire bound constrains that.** The
corpus ceiling is address space (`Tier0Limits.address_space_bytes`, 1 GiB), not any frame or slice
number. The four layers, which are separate and are routinely confused for one another:

    REPL namespace  → Tier0Limits.address_space_bytes   1 GiB
    one slice       → BrokerCaps.max_result_bytes       2 MiB
    model attention → MarshalCaps                       20 KiB stdout / 64 KiB answer
    one wire message→ DEFAULT_MAX_FRAME_LEN             4 MiB

A sentence computing *how many slices a corpus takes* is the tell that the model is being treated
as the transport. It never is.

## 3. Open: how a workspace remembers

**Unresolved as of this record; the owner posed it and the mechanism is not chosen.** Three
candidates, with what is known about each.

**(a) Reconstruction from the substrate.** The namespace is rebuilt at boot by re-loading handles
that address stored content. No serialization, no deserialization attack surface, and everything
restored already carries custody. Does not preserve arbitrary intermediate state — a fitted model,
a large derived frame — which is exactly the state a long-running workspace accumulates.

**(b) Namespace serialization.** Pickle-family. Cheap to write and the wrong shape here: the
namespace is authored by untrusted model code, so the bytes are attacker-influenced, and
`pickle.load` executes them. Also cannot carry live sockets or clients.

**(c) VM snapshot — measured 2026-07-25, and it works.** Cloud Hypervisor v52.0 exposes
`pause` / `snapshot` / `restore` / `resume` through `ch-remote` against the API socket Kata already
creates, which `KataLauncher` already discovers (it parses `--api-socket` from the VMM's argv).
Observed on the reference host against a live Kata-launched guest:

    pause      rc=0   0.00s
    snapshot   rc=0   0.2s   →  config.json 2.4 KB · state.json 86 KB
                                memory-ranges 2 GiB sparse, 174 MB on disk
    resume     rc=0

So the mechanism is real, fast, and cheap on disk. **One measured caveat decides whether it is
usable as-is:** snapshotting behind containerd's back desynchronised the Kata shim — after `resume`,
`ctr task exec` returned `DeadlineExceeded` and the container could not be re-entered, leaving a
VMM that ordinary teardown could not reap. The `shutdown` path detected the survivor and raised
rather than reporting success, which is the check working; but it means snapshot/restore needs
either Kata's own sanctioned pause path or a launcher that drives Cloud Hypervisor directly rather
than through containerd. **Not a blocker; a scoping fact.** A second unresolved point: handles are
host-side and session-scoped, so a restored guest would hold handle tokens whose host-side table no
longer has them — restoring the guest does not restore its counterpart.

Matt's suggestion that a binary gives a clean way to make workspace **checkout** work fits (c)
particularly well: if a workspace *is* a snapshot artifact, then holding it is the lock, and no
second instance can edit what it does not hold.

## 4. Isolation between instances — and one thing this session got wrong

**Ratified (owner, 2026-07-25): each session is its own Trellis instance, with its own database.**
Several may run on one machine — inventory, billing, parts — and they never conflict because they
are separate instances, not concurrent sessions inside one. Matt adds that a workspace is
**checked out**, so a second Trellis cannot edit one already held: **no concurrency by design.**

That confirms an earlier withdrawal was right for the wrong reason, and exposes a real defect this
session introduced. `KataLauncher` takes the containerd namespace `trellis` as a default, and its
CID counter starts at `FIRST_LAUNCHER_CID` **per process**. Two Trellis instances on one machine
therefore share a containerd namespace and both begin minting at the same CID. Sandbox names carry
UUID entropy so containers do not collide, and each instance has its own host object and database
so the ledgers do not — but the justification written into `config.py`, that owning a namespace is
what lets a launcher say *everything under this path is mine* before a destructive sweep, **is
false across instances.** Rule 19(a) is the reason that property was wanted, and it does not hold.

**Owed:** the namespace and the CID origin should derive from an instance identifier rather than
being module constants. Recorded here rather than fixed in passing, because it changes a
deployment-visible default.

## 5. What a later session should check rather than trust

- That one workspace per session still holds, before building anything that assumes a VM per
  workspace swap.
- That the persistence mechanism in §3 has been *chosen*, not inherited by default from whichever
  spike ran last.
- That §4's namespace defect is closed before two instances are ever run on one host.
- That the four layers in §2 have not drifted into one another — the invariant
  `max_frame_len >= 2 * max_result_bytes` is asserted in `test_config.py`, and the others are not.
