# The REPL in Trellis — what persists, what is borrowed

**Status: understanding record, owner-directed 2026-07-25.** Written because a
session asked whether the sandbox composition should be a context manager and
got the answer *"I'm surprised you would even ask"* — the question presupposed
something false about the REPL, and this record fixes the correct picture so a
later session does not presuppose it again. Diagram:
[the REPL in the system](trellis_repl_system.svg).

Authority: this record describes and does not decide. Where it and a ratified
record disagree, the record wins — `REPL_SANDBOX_ARCHITECTURE.md` for the
boundary, `CODE_MEDIATED_TEXT.md` for the pillar, `FEATURE_LIST.md` for the
deployment ruling, `AGENTS.md` rule 24 for what is being built.

## 1. The mistake this record exists to prevent

**The durable thing and the executing thing are different objects.** A session
that treats them as one reaches a false dilemma: if the REPL *is* the microVM,
then a scope that closes destroys a workspace that must outlive it, and any
unmissable-cleanup construct looks unsafe.

Both halves of that are wrong. A workspace persists because its state is in the
substrate. The microVM is compute borrowed for one stretch of work, holding no
credential and no unique copy of anything. **A scope that ends is a VM released,
not a session lost.**

The tell that this confusion is happening: a sentence that treats *"the REPL is
long-lived"* and *"the process must be long-lived"* as the same claim. The first
is true and load-bearing. The second is false, and believing it is how a design
ends up leaking VMs to protect state that was never in them.

## 2. What the diagram shows

Read left to right, then down.

**Workspaces — many, swappable, durable.** A workspace is not a conversation
thread. It carries a domain, the artifacts it has produced, and its own past.
A polymath runs physics on Tuesday and philosophy on Thursday; a mechanic keeps
parts inventory, manuals, and customer transactions as separate workspaces.
**A repository is a workspace too**, which is how Trellis edits Trellis: its own
source is loaded as REPL contents, and the repo is that session's response
artifact.

**One workspace per session** (owner ruling, 2026-07-25). Swapping workspaces is
a new session, not a re-pointing of a live one, which is what makes the session
scope a coherent unit to bound.

**The REPL — the persistent namespace.** Where a workspace is worked on. It holds
`context` as *handles rather than payloads*, the three pre-allocated roots for
facts, beliefs and doubts, the artifacts previous turns built, and the
model-authored code that runs against all of it. It is meant to be gigabytes
read in slices; the corpus ceiling is address space, not any wire bound.

**The microVM — ephemeral, one session.** A hardware boundary around the
namespace, carrying three vsock ports. It is torn down at session end. Nothing
that matters is lost when it goes, and that is a design property rather than an
accident.

**The model — holds addresses, never the corpus.** It supplies identifiers,
parameters, and prose it is authoring for the first time. The engine does the
counting and moves the bytes. Sub-model calls fan out flat at depth 1.

**The substrate — durable, content-addressed, append-only.** Every node addressed
by its SHA-256 preimage and final at write time; corrections written beside,
never over. This is what makes a workspace survivable.

**The loop that closes.** A query does not return a reply; it builds a response
artifact, derived rather than regurgitated. The artifact is filed back into the
store, judges compose per context and evaluate it, and a user gate ratifies
standing — doubt, belief, or fact. Then it is corpus, and it is input to the next
query. Output becomes input.

## 3. How a workspace remembers

The question was put as *"by using binary?"* — and the honest answer separates
two things that word can mean, because one of them is right and the other would
be a serious defect.

### Not by snapshotting the namespace

Serialising the live Python namespace and restoring it next session is the
mechanism to refuse, on four independent grounds. Any one of them is
disqualifying; the first is decisive.

1. **It inverts the boundary.** The namespace holds objects created by
   model-authored code, which is untrusted by construction. Deserialising
   attacker-influenced bytes is an arbitrary-code-execution primitive, and the
   party doing the restoring sits *outside* the sandbox. The whole point of the
   microVM is that nothing crosses outward except values that have been through a
   validating boundary; a namespace snapshot is the largest possible unvalidated
   crossing, running with the host's privileges.
2. **It has no content identity.** A snapshot is opaque bytes with no Merkle
   preimage, no provenance, and no way to be addressed or sliced. It cannot
   participate in the append-only store, cannot be cited as a `sourceNodeId`, and
   cannot be contested or superseded.
3. **It cannot be the size the REPL is meant to be.** A workspace is gigabytes.
   A restore path bounded by address space and frame size is bounded far below
   the thing it claims to persist.
4. **It is silently partial.** Sockets, file handles, the RPC hook and generators
   do not serialise. A snapshot that skips them restores a namespace that looks
   complete and is not.

### By reconstruction, from a manifest, over the workspace's own store

What actually persists is already persisted, by the loop in §2. **The durable
state of a workspace is its database plus a manifest**, and the namespace is
*rebuilt* at session open rather than restored:

- the substrate holds the content — AST nodes, document versions, the belief
  graph, provenance the write path enforced on the way in;
- the manifest names what this workspace *is*: which document versions are live,
  which root handles are pre-allocated, which artifacts exist and with what
  standing;
- session open re-issues the handles, re-binds `context`, and re-materialises the
  scaffold. Nothing model-authored is restored as a code object.

The consequence worth stating plainly: **a turn's durable output is the filed
artifact, not the namespace.** The namespace is deliberately disposable, and the
artifact loop is not a nice-to-have on top of persistence — it *is* the
persistence mechanism. A result that was never filed was never meant to survive.

### Where a binary genuinely belongs

The instinct is sound about a different object. A workspace being **one
addressable, movable, lockable thing** is exactly what makes checkout mechanical
— see §4. That is a binary as *envelope and lease*, not as a pickled namespace.

## 4. Concurrency, stated correctly

Three claims that are easy to blur, kept apart:

| | |
|---|---|
| **Sessions per workspace** | one, at a time. A workspace is *checked out* so a second Trellis cannot edit it. No concurrency by design. |
| **Sessions per machine** | many. A machine may run inventory, billing and parts in parallel — each its own Trellis instance, its own database, isolated. |
| **Workspaces per session** | one (§2). |

So the earlier framing of concurrency as *"two sessions must not share a socket
path"* was answering the wrong question, and withdrawing it on the ground that
the deployment is one-user-one-instance was also wrong. **Instances are what run
in parallel; workspaces are what must not be shared.** The isolation between
parallel instances comes from separate databases, not from a lock; the lock
exists to stop two instances opening the *same* workspace.

**What this means for the launcher, checked against the code.** Parallel
instances on one host are already safe in the transport, for a reason worth
recording: every identifier that is *shared* across instances is per-sandbox and
carries entropy (the sandbox name, the `/run/vc/vm/<name>` directory, the vsock
socket path), and every identifier that is *not* unique across instances is
per-process (the guest CID, the session table, the ledgers) and is never compared
across process boundaries.

One correction this forces on `KataLauncher`'s own commit message: the
containerd namespace is a *constant*, so parallel instances share it. "Everything
under `/sys/fs/cgroup/trellis` is mine" is therefore false for any one instance,
and a cleanup sweep must key on the sandbox name it minted rather than on the
namespace. The namespace still earns its place — it separates Trellis from the
provisioner and from every past probe — but it separates Trellis from *others*,
not instances from *each other*.

## 5. The deployment shape this implies

Trellis is hosted — a laptop, a home server, a rack — and the user reaches their
Trellises through a desktop app or a web interface, with a mobile remote control
later. That is a proposal on the record here, not a ratified decision.

Its architectural consequence is worth naming because it removes work: **if
clients are thin remotes onto one host, cross-device workspace checkout never
arises.** The lease is only ever contended between instances on the same machine,
which is a local lock rather than a distributed one — the difference between a
file lease and a consensus problem. A design that assumed roaming devices editing
the same workspace would have bought the hard version of this for no reason.

## 6. Identity — minted once, named separately

**Owner direction (Matt, 2026-07-25), and it dissolved an ambiguity rather than
managing it.** A workspace identifier carries a timestamp at the finest
granularity the system offers plus a UUID, and the human-facing label lives in
metadata as `human_readable_name`.

The session that raised the ambiguity had proposed composing an identifier from
the workspace's *name* and the *current date*, which forces a choice between two
properties a workspace needs at once: a date makes the identifier unique per
opening and useless as a lock key, and no date makes two workspaces called
"physics" the same workspace. **Minting once at creation gives both at no cost**
— it never moves, and it never collides.

The consequence is worth stating because it is what makes renaming safe:
**"physics" is a display name, not an identity.** No lease, no ledger, no
manifest and no audit line ever refers to it, so a rename is a one-field edit.

Two identifiers, not one:

| | minted | shape | keys |
|---|---|---|---|
| **workspace id** | once, at creation | `ws-<utc µs>-<uuid4>` | the lease, the manifest |
| **session id** | once per opening | `<user>-<utc µs>-<uuid>` | ledgers, audit, the CID binding |

The user component is **operational identity only**: it names who holds a lease
on this machine, lives in configuration, and never reaches the substrate.
`FEATURE_LIST.md` 1.6 is closed on the ground that nothing in the store names an
owner; a user id written there would revise that ruling rather than apply it.
Matt flagged that a stored Trellis user id is worth revisiting as part of the
repo address-code idea — that is a live proposal needing a dated entry, and this
build is deliberately on the safe side of it, foreclosing neither choice.

## 7. What running it changed

The composition landed as `src/repl_sandbox/session_host.py` and was driven
against the AX41 on 2026-07-25 — **the first execution of the diagonal**: the
real backend composition against the real microVM boundary, rather than either
half against a stand-in for the other. Seven claims, all holding on the second
attempt.

**The defect the first attempt found, which no off-host test could have.** The
module's own header lists six ordered steps, step 5 being *bind the listeners*.
The code attached the bridge and left starting it to `KataREPL.setup()`. Every
off-host test passed, because **none of them opens a session without also
driving a backend** — so a session composed without one came up with no host end
at all, and the guest's first tool call would have met a closed connection. On
hardware the bound-socket list was simply empty, which is unmissable.

Generalisable, and now the third instance in this program: *a step described in
prose and merely prepared in code reads as done.* The earlier two were an
enforcing surface named on a mechanism that could not carry it, and a check
written to verify a rule while itself breaking that rule.

The repair also names a real subtlety: `SessionBridge.start()` is **idempotent
by design, not defensively**. The composition layer binds at step 5 because it
owns the failure — a second listener can fail after the first is bound and a
microVM is running, and only the party holding both can unwind them. But
`KataREPL.setup()` is equally right to assert the bridge is up before any
untrusted worker. Both callers are correct, so the second call confirms rather
than rebinds, which would fail on the socket path the first already holds.

**Observed, with the boundary crossed:** a real VMM carrying the session's
sandbox; the host end bound at `<uds>_5001`; an empty manifest reconstructing to
a no-op with `human_readable_name` intact; the workspace checked out for the
life of the scope; **a second session on the same live workspace refused**; the
scope closing to zero VMMs, zero containers, zero VM directories and no lease;
and **a crashed holder's lease auto-reclaimed against a real liveness check**,
which is the mechanism §4 specifies rather than a stand-in for it.

## 8. What is not settled

- **The manifest's shape and where it lives.** §3 says a workspace is its store
  plus a manifest; nothing in the tree implements one yet.
- **The lease mechanism.** Checkout is ruled; the mechanism is open. Whatever it
  is, it is standing state a later session loads without asking, so it is
  gated (rule 21(b)).
- **Repo-as-workspace write-out.** A repository is a workspace, and edits go
  through the engine under hash guards; the step that writes substrate content
  back to files on disk is not described here because this record's author has
  not traced it.
- **The host end of `LM_PORT`/`DB_PORT`** — the open seam the diagram marks. See
  `REPL_SANDBOX_BUILD_PLAN.md` §5.6.
