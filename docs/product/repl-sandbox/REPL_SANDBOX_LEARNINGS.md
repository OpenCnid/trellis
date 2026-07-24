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

## 7. Identity: the anchor is the listener, and the free version is VMM-specific

Not choosable by the guest, whichever VMM is under it. The host broker/handler **must** attribute
quota/scope by the identity the *listener* supplies at `accept()`, never by an id inside the
request payload — otherwise a shared broker is a cross-session confused-deputy (session A forges
session B).

**Corrected July 23, 2026, and confirmed on the host the same day.** This section used to say the
anchor was the kernel-assigned vsock CID,
full stop. That is true under native vhost-vsock (Kata on QEMU) and **false on the ratified stack**:
Cloud Hypervisor's hybrid vsock puts the host end on an `AF_UNIX` socket, and a Unix accept carries
no CID. The anchor there is the **per-sandbox socket path the host created**, which is still not
choosable by the guest and still binds one VM to one session — the property held, the free
mechanism did not ([INTERFACES §3.1a](REPL_SANDBOX_INTERFACES.md)). **The general lesson is the
one worth keeping:** "the kernel gives us identity for free" was a claim about a *particular*
kernel feature, and it was carried in these records as though it were a claim about virtualisation.
An enforcing surface is only as portable as the mechanism named in it, so name the mechanism.

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
- **Replication is not a universal instrument.** "n=1 is weak" is a rule about *stochastic* claims —
  model behavior, where variance is the thing being averaged out. Applied to a deterministic
  infrastructure fact it buys almost nothing: five S2 runs differ by 64 ms of boot time and in
  nothing else, and a sixth on different silicon would print the same `42,84`. The gap the "second
  host" instinct was really pointing at was a **never-executed install path**, which needs a fresh OS
  instance, not fresh hardware — and a host with `nested: 1` makes one for free. Ask what instrument
  would have caught the error before reaching for the one the house rule names.
- **Boot is fast enough that the persistence question is the whole question.** ~0.7 s from `ctr run`
  to first exec means boot cost is not what makes state worth keeping — correctness across turns is.
  The probe therefore asserts the *identity* of the guest (worker pid, guest `boot_id`) alongside
  the namespace, and the negative control fires all three.

## 10b. What the first real model taught (S3 `[A]`, July 23, 2026)

The `[R]` run proved bytes cross the boundary against a $0 stub; the `[A]` run put a real
`gpt-5.4` behind the same bridge and let it answer a fan-out. What it added, past "a socket works":

- **The provider seam was the whole cost, and it was already paid.** Standing up a real model was
  not new backend code — `lm_handler.ChatCompletionsProvider` + `openai_chat_provider_from_env`
  already existed, env-driven, key-read-host-side, tested against a stub. The `[A]` harness reused the
  `[R]` probe's boot/bridge/witness/teardown wholesale and changed exactly two things: the provider
  and the guest program. **When the seam is right, adoption is a wiring exercise, not a build.** The
  reused negative-control shape (the host-side witness) still did the load-bearing work — correct
  answers alone never prove a crossing.
- **Make "correct" decidable without a judge, or the grader eats the thing under test.** The fan-out
  slices are arithmetic with one known answer each, checked by extracting the first integer. An
  LLM-graded check would have folded the model being tested into its own grader. `391, 133, 863, 42,
  60` are unforgeable in a way `S3-OK` is not, and cheap to verify in-script.
- **A $0 charge is a failure, not a pass.** The adoption run asserts `spend_ledger.spent > 0`: a real
  model must actually be *billed*, because a stub answering, or a provider under-reporting cost, both
  produce correct-looking text at $0. The dollar ledger being *positive* is part of the evidence that
  a model ran, not just an accounting side-effect.
- **The spend cap is between-calls, and the tripping call is unrecorded — found only by tripping it.**
  `--cap-halt` set the cap below the first charge and proved the session halts (`cap_spend`, then the
  next call refused in 0.5 ms). But it also surfaced that `SpendLedger.charge` refuses a cap-crossing
  amount *without committing it*: the batch that trips the cap runs to completion (its API calls
  execute and bill **upstream**) before the cap is evaluated, and the ledger then reads `$0.00` while
  OpenAI billed ~one batch. The cap bounds the *ledger* between calls, not the *upstream* spend inside
  the tripping batch. Real for GB req 5, invisible to a run that only ever passes. (Fix options:
  pre-estimate charge, commit-then-halt, or bound batch cost ahead — BUILD_PLAN §5.3.)
- **The key never touches the operator's hands or the record.** The credential was placed by the
  owner in a root-only host file (`umask 077`), sourced into the run's environment, and read only at
  `openai_chat_provider_from_env`. It is named nowhere the process logs, audits, or serialises, and
  nowhere in this repository — the run reports a key *length*, never a value.

## 10c. What the DB broker taught (S4 `[R]` PASSED, July 23, 2026)

Authored, tested off-host, then **run on the AX41 and passed** — exit 0, the guest reading real
Postgres rows through the broker over a second vsock port with no credential anywhere inside it.
Building it settled four things, and running it added three more:

- **"Returns rows" and "the guest holds handles, not payloads" are not in tension — the metered sink
  is the reconciliation.** BUILD_PLAN §5.4 says the query "returns rows"; ARCHITECTURE §3.1 says the
  guest holds handles. Both hold: `run_query` returns an *opaque handle* plus row count and schema —
  no row crosses — and the guest reads rows only through `materialize`/`slice`, the bounded, byte-
  charged materialisation exception (DATA_MODEL §6). The probe's guest does exactly that, so "a real
  query returns rows" is proved *without* contradicting the exfiltration boundary. A reader who takes
  SPEC §4.2's `run_query(...) -> rows` shorthand literally would think raw rows cross on the first
  call; they do not.
- **A negative claim needs its own positive control, and "zero credential in guest" is a negative
  claim.** The credential never enters the guest — so a grep of the guest for it trivially "finds
  nothing" whether the property holds *or the grep is broken*. The probe plants a **canary** (a fake
  secret the guest *is* given) and asserts the same grep finds it; only then does "no real secret
  found" mean anything. This is the S2/S3 rule-19(c) discipline applied to a grep rather than a
  witness. Corollary the design enforces: the real secret is searched for **host-side** over the
  guest's returned dump, never shipped into the guest to look for — and the assessor records only
  booleans, never the secret, because the record is printed.
- **Prove write-denial at the layer the docs call primary, not just the convenient one.**
  `policy.inspect_sql` refuses an `INSERT` before any backend, and it is cheap to check — but the
  records are explicit that the *role* is the primary control and the inspector is defense-in-depth.
  So the probe also connects **directly as the read-only role, no broker in the path**, and watches
  Postgres itself refuse the write. Asserting only the inspector would have proved the weaker half and
  called it the whole.
- **Name the assertion you cannot honestly make.** The `[R]` gate lists "the DB host has no
  internet/metadata route", but no deny-egress NIC surface exists in the merged code (it is GB's), and
  a colocated throwaway Postgres has no separate DB-host hop. Rather than fake a boundary, the probe
  asserts only the SQL-level origination path is closed (`dblink`/`postgres_fdw` absent) and its
  report says in words that this is **not** a Trellis-built boundary. A gate whose enforcing surface
  is only prose does not count (BUILD_PLAN §1); the honest move is to scope the claim down and label
  it, not to dress the weak check as the strong one.
- **Reuse held: the second chokepoint was a port change, not a build.** The DB seam is
  `host.broker_handler` on `config.ports.db` (5002) where S3 put `host.lm_handler` on `config.ports.lm`
  (5001); `Sandbox`, `Witness`, `discover_vsock_uds`, `preconditions`, and the bounded never-raising
  teardown are imported from the S3 probe unchanged. What the off-host suite could newly prove that
  S3's could not: the *whole* host chain — broker dispatch, `inspect_sql`, the handle table, the
  `guest_rpc` translation — end to end over the loopback double, so `run_query` → `materialize`
  returns the fixture and a write is denied, with no VM anywhere. The one genuinely novel host unknown
  the suite could not reach was a **`HybridVsockListener` on the DB port (5002) against the `clh.sock`
  hybrid convention** — S3 only ever exercised the LM port (5001); S4 opens `lm=False` and binds only
  the DB listener, so this is a different port number on the same VMM socket, not two listeners at
  once. **The run closed it:** the guest's `AF_VSOCK (2, 5002)` arrived at `clh.sock_5002`, so
  §3.1a's `<uds>_<port>` convention generalises across ports rather than being a fact about 5001.

**What the run added, none of it visible from the dev box:**

- **The negative control needed sharpening, and only running it showed that.** The fake answered
  refusals by "does the statement start with `select`" — so `SELECT pg_read_file(...)` slipped through
  and the control was caught by a *guest-visible* claim as well as by the witness. That is a blunter
  instrument than it claims to be: the whole design is that **every** guest-visible claim passes and
  the host-side witness is the *only* thing that can tell. The fake now forges the broker exactly (the
  one benign read succeeds, everything else refuses), and the second run failed on the witness alone.
  A negative control that something other than its intended detector can catch has not been shown to
  work — it has been shown to be noisy.
- **This host intermittently wedges `ctr task exec`** — the call burns its whole timeout and the run
  dies — about **twice in thirteen runs**, once during source installation and once on the guest
  program, so it is a general Kata-shim flake rather than a property of any payload. It is the same
  class S3 recorded for `destroy()`. Two consequences worth keeping: an exception type that is not
  `ProbeError` escapes as a raw traceback and *reads like the boundary broke* when nothing about the
  boundary was exercised (now wrapped, and it says "not a failed claim. Re-run."); and **shipping
  fewer files is a reliability property, not a tidiness one** — the probe had been reusing S3's
  `install_sources`, which ships S3's guest probe, control listener and request JSON that S4 never
  executes, buying extra exec calls and therefore extra windows on the flake.
- **The credential property was true by construction, and the canary is what makes that checkable.**
  `ctr task exec` runs with the *container's* environment, not the host caller's, so the broker's
  `TRELLIS_PG_DSN` was never within reach of the guest — the run confirms a structural fact rather
  than a lucky one. Which is exactly why the positive control earns its place: a grep over a guest
  that never could have held the secret returns "nothing found" identically whether the property holds
  or the grep is broken, and only the planted canary distinguishes them.

## 10d. What the first model to *use* the facade taught (S4 `[A]` PASSED, July 23, 2026)

S3 `[A]` put a real model at the *end* of a channel; S4 `[A]` put one at the *wheel*. The model was
shown `CapabilityRegistry.render`'s stubs and nothing else, and had to compose `run_query` →
`materialize` itself against a question whose answer only the database held. It did, in two attempts,
for $0.00706.

- **A rendering nobody has coded against has not been tested.** The two renderings
  (INTERFACES §6 — CapabilityDescriptor lifecycle) had been merged, unit-tested and read many times.
  Neither S3 `[A]` nor S4 `[R]` used either: both hand-wrote their envelopes, because their authors
  already knew the wire. The first thing that actually composed a call against the rendering found
  that **`run_query(sql)` — the natural call the rendered signature invites — was refused**,
  `denied: params must be a list, got NoneType`. The stub emitted every declared parameter, so an
  unset optional crossed as an explicit null, and every host op reads optionals with
  `args.get(name, default)`, which returns the null and not the default. Five of ten capabilities were
  affected. **The generalizable form: a "for the model" artifact that no model has consumed is
  unexercised code, however green its tests** — and the exercise is cheap, because a loopback double
  driving `render → block → materialise → broker` found this at $0, before the host was touched.
- **The fix belonged at the generator, and the precedent was already in the repo.**
  `guest_rpc.lm_request_from_envelope` had documented the rule for the LM port — "a `model` of `None`
  is dropped rather than sent as null" — so the DB port's missing equivalent was drift, not an open
  design question. Closing it at `_stub_source` fixed all five at once; coercing null→default in each
  op would have been five fixes and a sixth waiting for the next optional parameter.
- **The ergonomics number is an attempt count, and the failing attempt is the informative half.**
  Attempt 1 got the composition right immediately and died on one thing: it wrote the bound-parameter
  placeholder as `?`, the DBAPI qmark style, where psycopg2 wants `%s`. **The descriptor doc says what
  the call does and never says what paramstyle it speaks**, so the guess was reasonable and the doc
  line is the cheapest place to end it. Behind that sits a real trade the run made visible: the
  broker's error is deliberately terse (`SyntaxError from the postgres driver`, the driver's own
  message withheld), and that redaction is precisely what forced a guess instead of a read.
  **Error-text redaction and self-debug ergonomics pull against each other** — worth deciding
  deliberately in GB rather than rediscovering.
- **The self-debug loop is load-bearing, not decoration.** INTERFACES §7 says a host refusal reaches
  the model as a Python traceback in `stderr`. Feeding that stderr back verbatim is the entire
  difference between this run failing and passing. A design that swallowed refusals into a return code
  would have cost the run.
- **`--no-db` is what makes a correct answer mean anything.** The fixture is built so both plausible
  shortcuts name a different author (most documents: okonkwo; most words overall: vasquez; the answer:
  delacroix). Asked the same question with the tools removed and pressed for a number, the model said
  it could not know and answered 0. Without that arm, "the model returned the right value" is
  compatible with "the value was guessable from the schema" — the null would have looked identical.
- **The negative control came out textbook, which is how you know it is aimed right.** With the guest
  answering itself from canned rows, *every* model-visible claim still passed — correct answer, clean
  credential grep, clean teardown, first-try — and the only failure was the host witness reading
  `accepted=0`. This is the shape S4 `[R]` had to be sharpened twice to reach: a control that anything
  other than its intended detector can catch is noisy, not working.
- **The shipping supervisor is not runnable in the guest yet, and that is an S6 prerequisite.**
  `supervisor.GuestSupervisor` imports `rlm.environments.base_env`; the guest image is
  `python:3.12-slim` plus the shipped package and carries no rlms. The honest options were to ship
  rlms into the image or to re-implement the small part S4 needed; a hand-written `rlm` shim was
  refused outright, because it would fake the very pin the supervisor exists to hold while making the
  run *look* like it had exercised the real thing. **The guest image must carry rlms before S6's
  equivalence harness can run** — found by trying to use the supervisor, not by planning around it.

## 10e. What Tier-0 taught (S5 `[R]` PASSED, July 23, 2026)

**A ratified control named a mechanism that does not exist on the ratified stack — for the
second time.** The records said in-guest cgroups. The guest has no cgroup filesystem mounted and
cannot mount one (`EPERM`, no `CAP_SYS_ADMIN`); the host-side cgroup Kata creates for the VM
carries no `memory.max` or `pids.max` at all. The property survives via `setrlimit` after a
privilege drop, and the correction is [ARCHITECTURE §2.1](REPL_SANDBOX_ARCHITECTURE.md).

This is structurally identical to S3's hybrid-vsock finding, and the pair is the lesson:

- S3: "the host reads the guest CID at `accept()`" was true of *native* vsock, carried as though
  it were true of virtualisation.
- S5: "in-guest cgroups cap the worker" was true of *containers on a host kernel*, carried as
  though it were true of containers in a microVM.

**An enforcing surface is only as portable as the mechanism named in it.** Both were written
confidently, reviewed, ratified, and wrong in the same way — a mechanism observed in one context
generalised to another without being re-observed. The cheap defence is what S5 now does: the
probe **re-derives the finding on every run**, so the record's basis is executable rather than
a transcript somebody has to trust.

**Reconnaissance before authoring cost four boots and saved the design.** The first thing S5 did
was boot a guest and look, rather than write a module against the record. Everything the module
became — the uid drop, rlimits instead of cgroups, ABI-7 Landlock, ctypes seccomp — came out of
those four runs. Writing first would have produced a `hardening.py` full of cgroup writes that
fail with `ENOENT`, and the finding would have arrived as a confusing host failure instead of a
design correction.

**The most useful failure: hardened correctly, and could not prove it.** Landlock was not
granting `/proc`, so the worker could not read `/proc/self/status` after restricting itself.
Every control was genuinely applied — the fork bomb *was* capped, the syscall *was* denied — and
the probe reported `Seccomp: -1` and failed the run. The read-back was denied by the ruleset it
was trying to verify. **Evidence-gathering is inside the blast radius of the thing it measures**,
and a control that removes its own witness looks exactly like a control that did not apply.

**A denylist, where the record said allowlist — recorded, not papered over.** A true syscall
allowlist for a CPython worker running arbitrary model code is not maintainable: the reachable
set is large, version-dependent, and a miss is a crash in ordinary use rather than a caught
attack. The forwarder of [INTERFACES §3.4](REPL_SANDBOX_INTERFACES.md) keeps its allowlist,
because ten kinds of call *can* be enumerated. Same word, two processes, different answers.

**Two falsifier arms, because there were two kinds of claim.** `--no-harden` falsifies the
in-guest enforcement claims by removing the enforcement; `--negative-control` falsifies the
crossing claim by removing the crossing. S4 established that a correct-looking result and a
broken instrument are indistinguishable without the arm that must fail — S5 needed two of them,
and a single arm would have left half the claims ungrounded.

**Root is exempt from `RLIMIT_NPROC`, and that is the whole spike in one fact.** Set the limit
without dropping privileges and every call returns success, the report reads clean, and a fork
bomb runs to 200. `Tier0Report.processes_capped` is therefore a conjunction — non-root **and**
limited — so the two can never be reported apart.

---

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
- **Running the generated artifact through a parser** caught the same class again, one layer down:
  `docs/density-chain/DENSITY-CHAIN.html` carries its data as an inline JS array, and the S4 `[R]`
  session had written `'S4's paid half'` — a straight apostrophe inside a single-quoted literal — so
  the whole script had been a **`SyntaxError` on master**, silently blanking the interactive table.
  Prose review cannot see it and `wiki:check` reads the Markdown, not the render. `node --check` on
  the extracted block finds it in a second. **A hand-maintained artifact that carries executable data
  needs a syntax gate, not a proofread.**

**Lesson:** the builder's own read is not trustworthy evidence. Clean-room judges, an adversarial
red-team, and an actual render/verify step each caught a class of error the builder could not see
from the inside — exactly what they exist for.

---

*Architecture: [REPL_SANDBOX_ARCHITECTURE.md](REPL_SANDBOX_ARCHITECTURE.md) ·
Spec: [REPL_SANDBOX_SPEC.md](REPL_SANDBOX_SPEC.md) ·
Full trail: [REPL_SANDBOX_RESEARCH.md](REPL_SANDBOX_RESEARCH.md).*
