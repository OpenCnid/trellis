# Trellis REPL Sandbox — The Exfil Doubt-Filter (Layers 1–2)

**Status: PROPOSED — design record for a not-yet-ratified defense-in-depth layer; NOT built.**
This record details **Layers 1–2** of the exfiltration model in
[REPL_SANDBOX_ARCHITECTURE.md](REPL_SANDBOX_ARCHITECTURE.md) §3.1 (The exfiltration resolution —
data-flow, not content inspection). It **composes the existing, ratified `-1` doubt tier**
([../../architecture/DOUBTS_WORKSPACE.md](../../architecture/DOUBTS_WORKSPACE.md)) onto the sandbox's
outbound crossings; it invents **no** new doubt machinery. Everything below reduces to
DOUBTS_WORKSPACE primitives. It leads implementation (document-driven); nothing here runs.

Layer 0 — the data-flow **boundary** (the guest holds addressable handles, never secret-bearing
payloads) — is ratified and is **not this record's subject**; it lives in ARCHITECTURE §3.1 and the
"NOT a boundary" tier is owned by [REPL_SANDBOX_THREAT_MODEL.md](REPL_SANDBOX_THREAT_MODEL.md).
Layers 1–2 are the **"double cover"**: strictly defense-in-depth, and by
DOUBTS_WORKSPACE.md §7 (What doubts do not do) the engine **cannot count them as a boundary anyway.**

---

## 0. What this composes (and what it must never become)

The exfil problem is unsolvable at the content layer: a hostile document can steer a
model-authored program to fold a secret into a plausible answer, and no filter over
model-controlled natural language has a perfect cover (ARCHITECTURE §3.1;
[REPL_SANDBOX_LEARNINGS.md](REPL_SANDBOX_LEARNINGS.md) §6). The **guarantee** is therefore Layer 0's
data-flow property, not a filter. This record specifies the two filter layers that sit **on top of**
that guarantee and reduce the **rate** at which the model acts on injected instructions.

Two hard framing rules govern the whole document:

1. **No new subsystem.** Layer 1 = DOUBTS_WORKSPACE.md §7's **automatic, no-gate mechanical
   contest** (= the existing quarantine path = the harness instruction-source-boundary the engine
   already enforces). Layer 2 = a **composed defeater** (DOUBTS_WORKSPACE.md §8 (Composed
   defeaters)) under the **search law** (§3, Support covers; defeat searches). The "universal
   injection-doubt" = a **standing objection** object (§10 (Vocabulary)) grounded in a provenance
   **fact** (§2, The corrosion bound). Nothing here is Trellis-exfil-specific machinery; it is the
   `-1` tier pointed at a new seam.
2. **Never a boundary.** Neither layer may migrate into the "Enforced by" column of
   [REPL_SANDBOX_SPEC.md](REPL_SANDBOX_SPEC.md) §6 (Security invariants). §8 below states this as an
   invariant.

## 1. The three-layer model (placement recap)

Reproduced from ARCHITECTURE §3.1 so this record stands alone. Only Layer 0 is load-bearing.

| Layer | What it is | Runs | Gate | Status |
|---|---|---|---|---|
| **0 — boundary** | guest holds addressable **handles**, never secret-bearing payloads; broker resolves host-side | data plane | n/a | **Ratified** — the guarantee (holds under 100% injection). NOT this record. |
| **1 — mechanical / provenance doubt** | strips command-authority from instructions whose provenance is *untrusted-retrieved* | host-side, inbound provenance → outbound authority | **automatic, no gate** (§7) | **PROPOSED** (this record, §2–§3) |
| **2 — semantic defeater panel** | composed defeater on **outbound** content: "does this smuggle a secret / serve a suspect instruction?" | host-side, at the outbound crossing before release | **attaches + escalates to the user gate; never enforces** (§7) | **PROPOSED** (this record, §4–§6) |

The gate column is the load-bearing distinction and it is DOUBTS_WORKSPACE.md §7 verbatim:
**mechanical contest is automatic** (nothing is asserted about the world); **semantic defeat is
user-gated** (a judgment about the user's domain, which the engine has no standing to make
unilaterally).

## 2. Layer 1 — mechanical / provenance doubt (automatic, ungated)

**Instrument.** The provenance-gated instruction-authority rule: text that entered the guest with an
*untrusted-retrieved* provenance stamp cannot, by that authority alone, command an outbound crossing
(`llm_query`, `vector_search`, `answer`). This is the §7 **mechanical-contest** branch — the same
shape as quarantine-on-byte-change and the entailment sweep (DOUBTS_WORKSPACE.md §6 (The workspace
contract, mirrored)): the engine attaches the contest **mechanically**, never on model discipline.

**Why automatic is defensible here.** The contest cites a **fact** — the provenance kind of the
content — which satisfies the §2 positive-citation requirement (the empirically-validated core;
DOUBTS_WORKSPACE.md §14 (Ratification), the carve-out). Nothing is asserted about whether the
instruction is *right*; only that its provenance does not confer command authority. That is exactly
§7's "provenance broke… nothing asserted about the world," so no user gate is required, and none is
taken.

**Why automatic is still NOT a boundary.** Layer 1 reliably strips authority from *directly*
untrusted-provenance text, but it cannot stop **model-mediated laundering**: a program may read
untrusted content and then emit an instruction of its *own* — carrying the untrusted intent across a
provenance seam the stamp cannot follow. So Layer 1 lowers the **rate**, and Layer 0 remains the
thing that makes the leak impossible. This is why §8's invariant binds Layer 1 too, not only Layer 2.

## 3. The universal injection-doubt — a standing provenance-grounded objection

The "universal" doubt is **not** a harness prompt telling the model to ignore injected instructions.
Prompt-level defenses are forgeable and are not security (LEARNINGS §6, corollary;
ARCHITECTURE §7 req 12). Instead it is a **first-class object in the `-1` tier**:

- a **standing `objection`** (DOUBTS_WORKSPACE.md §10 (Vocabulary): the object that attacks a claim
  and cites facts), whose ground is a **provenance fact** — "this content's provenance is
  untrusted-retrieved." Citing a fact, not an absence, is the part of §2 that survived adversarial
  analysis and the flat-earth corpus test (§11's failed attack; §12.1), so the objection is
  **admissible** by the ratified core of the bound.
- **"Universal" without a hack** because a single standing objection attaches to **every** piece of
  untrusted-retrieved instruction content by virtue of the provenance fact it cites — not because a
  prompt enumerates cases. Capture is mechanical (§6), exactly as the workspace contract demands.
- The doubt (the `-1` standing on that content's command-authority) is **based on** this objection —
  the `objection → doubt` dependency of DOUBTS_WORKSPACE.md §10 (the July 21 learning). Remove the
  objection and the doubt is empty; the provenance fact is what keeps it non-empty.
- **Promoted and gateable.** Making this objection *standing* (always-attached) is an owner-gated
  promotion, like any promotion into the tier. This record **proposes** the object; it does not
  promote it (§10, owner-ratification item 5).

Layer 1 is the automatic instrument that instantiates this standing objection at the seam; Layer 2
is the composed instrument that searches for the *residue* the mechanical rule cannot see.

## 4. Layer 2 — the semantic defeater panel (attaches, escalates, never enforces)

**Instrument.** A composed **defeater** panel (DOUBTS_WORKSPACE.md §8) evaluates **outbound** content
at the crossing before release, searching for the join by which the content smuggles a secret or
serves a suspect instruction. Per §3 it runs under the **search law** (∃: one landing seat is a
finding), not the cover law; per §9 (Scope — this is a critique engine) it is an ordinary use of the
general critique instrument, here aimed at an outbound-crossing target.

**What it emits and does — bounded by §7.**

- It emits an **`objection`**, never a verdict (§10). One seat landing = a finding **attached** to
  the crossing.
- The finding **feeds audit** and **escalates to the user gate**. Semantic defeat is a judgment about
  the user's domain; per §7 the engine has no standing to enforce it unilaterally, and it does not.
- It **never blocks or holds a crossing on its own authority.** Any release-blocking is either
  Layer 0 (the model cannot leak what it never materialised) or a **user-gated / user-configured**
  policy. The defeater panel is a finding-recorder and an escalation source — nothing more.

**Robustness is the composition, not any one reasoner.** A single semantic checker is brittle; the
strength is a **blind panel** of seats composed per crossing (the cover-of-seats discipline of
FOUR_JUDGE_BASIC_MODEL.md; the §3 search means the panel succeeds when *any* seat lands). Membership
of an admitted objection follows DOUBTS_WORKSPACE.md §12.3 (The workspace membership rule): a doubt
that the fact base **refutes**, held anyway, is delusion and is refused; a fact-grounded doubt that
lands is sustained; an unverifiable one gates to the user like a preference.

## 5. Composition from the judge / defeater schema

A defeater seat is **named, defined, and instantiated with the same schema as a judge** — the YAML of
[../epistemic-support/FOUR_JUDGE_BASIC_MODEL.md](../epistemic-support/FOUR_JUDGE_BASIC_MODEL.md)
(The basic model), enumerated by DOUBTS_WORKSPACE.md §8 as `purpose, claim_modes, select,
orientation, taxonomy, blind_to` + the ten-item anchor set. **The schema does not change; the
methods and prompts do** — the search law not the cover law, an `objection` not a verdict, the ∃
target not the ∀ cover. One schema, two instruments; the shared schema is what lets one composer emit
either seat.

The table describes **slots only** — how each schema field is *shaped* for an outbound-exfil seat.
The **literal slot contents / prompt bytes are deferred to a Guardrail-15 session** (§9); nothing
below is a prompt string.

| Schema slot | Shape for an outbound-exfil defeater seat (slot description — no prompt bytes) |
|---|---|
| `purpose` | search the outbound content for a join by which it smuggles secret-bearing material or serves an untrusted-provenance instruction |
| `claim_modes` | the outbound crossing treated as the candidate; the seat adjudicates a fact/inference *about the content*, not about the user's corpus |
| `select` (sparse hyperplane selection) | composed **per crossing** from loci that discriminate *this* content's context (provenance loci, secret-material loci) — relevance is **locus intersection** (§12.2 (The two-layer resolution)) |
| `orientation` | search-law posture: existential reach; high `contradiction_sensitivity`; `abstention_boundary` = **jurisdiction-abstain** when the locus does not intersect the crossing (the applicability gate) |
| `taxonomy` | §4 (Two defeat kinds): **rebutting** (content contradicts the release policy) vs **undercutting** (the crossing's justification does not carry) |
| `blind_to` | authorship, and the composer's expectation of pass/fail — the panel is a **blind** cover of seats |
| ten-item anchor set | the calibration fixtures the seat is scored against **before shipping** (§8: candidates "must be tested"); a build item, Guardrail-15-first — deferred |
| output | an `objection` under ∃; grounded in facts per §2; sustained / overruled / outstanding per §5 (The three fates of a doubt) |

Meta-prompt-generated defeater candidates are **permitted and must be tested before shipping**
(DOUBTS_WORKSPACE.md §8). Generating candidates and composing them is on the permitted side; a
**metric-driven search for the best-scoring defeater** crosses into optimization-over-compositions
and needs its own proposal (§8's AB-8 note) — do not do it here.

## 6. Two substrates for a defeater seat

Owner + collaborator direction: a seat may be **realised** in either of two substrates. They are the
**same instrument**; robustness is the blind-panel composition (§4–§5), **not** the substrate.
This record presents both as legitimate and **picks neither** — the choice is owner-owed (§10).

| Substrate | What it is | Notes |
|---|---|---|
| **In-context meta-prompt** | the seat is a composed prompt run against a model in context | DOUBTS_WORKSPACE.md §8 permits meta-prompt-generated candidates; **must be tested before shipping.** Prompt bytes deferred to Guardrail 15. |
| **TTT tooling-call emitter** | the seat is a test-time-trained tooling-call emitter on a **local open-weight model** (the sparsity path) | emits an `objection` as a structured tooling call; the training recipe / any prompt scaffold is likewise Guardrail-15 work. |

Either substrate emits the **same** `objection` object into the **same** `-1` tier and is bound by
the **same** §7 gate (attaches + escalates; never enforces). Substrate choice changes cost and
locality, not the schema or the placement.

## 7. The interface seam — where the layers hook the crossings

The layers hook the two host-side chokepoints of ARCHITECTURE §3 (Data plane): the **LM handler**
(serves `llm_query`, holds the outbound prompt text and the `answer` egress point) and the **host
broker** (serves DB / retrieval tools, and is where retrieved content — the injection vector —
crosses into the guest). **This record does not specify wire framing or RPC shapes** — those are
owned by [REPL_SANDBOX_INTERFACES.md](REPL_SANDBOX_INTERFACES.md); the data objects (the standing
objection, the seat output) are owned by [REPL_SANDBOX_DATA_MODEL.md](REPL_SANDBOX_DATA_MODEL.md).
Named at the seam level only:

| Hook | Seam | Direction | Action |
|---|---|---|---|
| **Layer 1 — provenance stamp** | host broker / LM handler, **response** path | inbound (content entering the guest) | record the provenance kind on content/handles as they cross in; attach the standing injection-objection (§3) to untrusted-retrieved instruction content |
| **Layer 1 — authority strip** | LM handler + broker, **request** path | outbound crossing | deny command-authority to a crossing driven solely by untrusted-provenance text — **automatic** (§2) |
| **Layer 2 — defeater panel** | LM handler (`llm_query` / `answer`), broker (`vector_search`), **request** path | outbound crossing, before release | run the composed panel; attach any `objection`; feed audit; **escalate to the user gate** — never hold/block on its own authority (§4) |

Auth for every seam remains the **kernel vsock peer CID** from `accept()` (ARCHITECTURE §7 req 4;
LEARNINGS §7), never a guest-supplied id — the layers add findings to that identity, they do not
replace it. Exact provenance-stamp placement (broker vs handler vs `load_context`) depends on the
INTERFACES seam and is a reconciliation item (§10).

## 8. The never-a-boundary invariant (hard)

> **Layers 1–2 MUST NEVER appear in the "Enforced by" column of
> [REPL_SANDBOX_SPEC.md](REPL_SANDBOX_SPEC.md) §6 (Security invariants), nor be cited as the exfil
> boundary. They reduce the *rate* at which the model acts on injected instructions and feed audit;
> they do not make exfil impossible.**

Three independent reasons, any one sufficient:

1. **The engine cannot count them anyway.** By DOUBTS_WORKSPACE.md §7, a doubt **attaches**; it never
   unilaterally enforces. A layer that cannot enforce cannot be a boundary. (Layer 1 is *automatic*,
   but automatic ≠ boundary — see §2: it does not survive model-mediated laundering.)
2. **The ground is model-controlled / steerable.** Content inspection over model-authored text has no
   perfect cover (ARCHITECTURE §3.1). A control with no cover is telemetry, per the house rule that a
   documented bound with no engine behind it is not a control (SPEC §8 (Acceptance gates)).
3. **Layer 0 already carries the guarantee.** The data-flow property holds under 100% injection;
   Layers 1–2 exist to lower attempt rate and surface intent, not to backstop a leak Layer 0 already
   forecloses.

This aligns with ARCHITECTURE §7 req 12 and SPEC §6's "NOT a boundary (telemetry only)" row. The
composed doubt-filter sits **under** that rule as defense-in-depth. Content-DLP + per-session
cumulative-byte caps on the crossings remain as **further** defense-in-depth beside it, also never a
boundary. If a future edit is tempted to move any of this into an enforcing column, that edit is
wrong by this invariant.

## 9. Deferred — literal prompt bytes (Guardrail 15)

**No defeater-seat prompt text is authored in this record, by design.** House Guardrail 15: any
session that authors prompt bytes MUST first invoke the `prompt-engineering` and `hypershot-protocol`
skills and author against their guidance. This is a **design** record — it specifies **schema, slots,
composition, placement, orientation, and interface only** (§5–§7). Deferred to a separate
Guardrail-15 session, for **both** substrates (§6):

- the literal `purpose` / orientation slot contents and any in-context meta-prompt text for a seat;
- the TTT tooling-call training recipe and any prompt scaffold;
- the ten-item anchor / calibration fixtures the seat must pass before shipping (§5; §8 "must be
  tested"), authored fixtures-first (Guardrail-15).

## 10. Open items & owner ratification

Nothing here is authorized; each item is separately gated (mirroring DOUBTS_WORKSPACE.md §13 (Open
items) and §14). Design calls that need the owner:

1. **Promote the universal injection-doubt to standing.** §3 proposes the standing
   provenance-grounded objection; making it always-attached is an owner-gated promotion into the
   `-1` tier. Proposed here, not promoted.
2. **May a user *hold* an outbound crossing on a Layer-2 finding?** §4 fixes that the *engine* never
   enforces. Whether a **user-configured** policy may hold a crossing pending review (user-gated
   enforcement, plausibly permitted by §7) versus strictly release-with-audit is the exact
   boundary between §7's user gate and the never-enforce rule — owner call.
3. **Inherited §7 undercut determinacy gap.** DOUBTS_WORKSPACE.md §11 attack 4 / §13: an
   *undercutting* objection could, by §7's own "nothing asserted about the world" criterion, route to
   the **ungated mechanical** branch — precisely the headline capability the gate most plausibly
   exempts. This record **defines** Layer 2 as always attaches-only/gated regardless; that choice
   needs owner ratification against the still-open parent gap, and it must not be read as resolving
   it.
4. **Inherited §2 bootstrap and cost gaps.** DOUBTS_WORKSPACE.md §14 carve-out: only §2's
   positive-citation core is ratified; the bootstrap (laundering) and cost (existential-search
   volume) gaps are **open**, and "nothing is built against §2 until these close." Layer-2 defeaters
   inherit them. Bounded observation (a design argument, owner-owed, not a settled result): because
   Layer 2 **never enforces** and only escalates, its failure mode is **over-escalation / audit
   noise**, not silent corpus corrosion — but this does not lift the parent's build hold.
5. **Applicability gate untested against a composed defeater.** DOUBTS_WORKSPACE.md §12.2 / §14: the
   locus-intersection relevance step (`judge_panel.ts:464`) "has never been run against a composed
   **defeater**; that is a build item, not a settled result." The §5 `select` / `abstention_boundary`
   shape depends on it.
6. **INTERFACES / DATA_MODEL reconciliation.** §7 names the seams; the RPC that carries a finding and
   the exact provenance-stamp placement are owned by the sibling docs authored in parallel
   ([REPL_SANDBOX_INTERFACES.md](REPL_SANDBOX_INTERFACES.md),
   [REPL_SANDBOX_DATA_MODEL.md](REPL_SANDBOX_DATA_MODEL.md)) and are the caller's reconciliation.
7. **Substrate choice is deliberately open.** §6 presents in-context meta-prompt and TTT tooling-call
   as co-equal; the owner/collaborator have not picked one, and this record does not.
8. **Guardrail-15 prompt-bytes session** (§9) is a prerequisite before any seat ships.

Build sequencing (spike order, acceptance gates) is owned by
[REPL_SANDBOX_BUILD_PLAN.md](REPL_SANDBOX_BUILD_PLAN.md), not here.

---

*Parent model: [REPL_SANDBOX_ARCHITECTURE.md](REPL_SANDBOX_ARCHITECTURE.md) §3.1 · Composed tier:
[../../architecture/DOUBTS_WORKSPACE.md](../../architecture/DOUBTS_WORKSPACE.md) · Seat schema:
[../epistemic-support/FOUR_JUDGE_BASIC_MODEL.md](../epistemic-support/FOUR_JUDGE_BASIC_MODEL.md) ·
Invariants: [REPL_SANDBOX_SPEC.md](REPL_SANDBOX_SPEC.md) §6 · "NOT a boundary" tier:
[REPL_SANDBOX_THREAT_MODEL.md](REPL_SANDBOX_THREAT_MODEL.md) · RPC seam:
[REPL_SANDBOX_INTERFACES.md](REPL_SANDBOX_INTERFACES.md) · Narrative:
[REPL_SANDBOX_LEARNINGS.md](REPL_SANDBOX_LEARNINGS.md) §6.*
