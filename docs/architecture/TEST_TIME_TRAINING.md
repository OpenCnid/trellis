# Test-Time Training and the Sparse-Model Backend — Research-Track Record

**Status: RESEARCH INITIATION (Session 45, July 13, 2026 — owner-directed).**
This record roadmaps a research track; it ratifies NO design decision, lands
NO machinery, and changes NO runtime byte. Every rung of the ladder in §7 is
owner-gated and enters as its own proposal with its own estimate. The record
follows the house document-first mold (rows 9/10/12: the design record
precedes any implementation), one stage earlier — this is the record that
decides whether a design record is ever warranted.

**Origin.** The owner relayed an external collaborator's active line of work
(the same collaborator whose provenance-threading proposal became roadmap
row 9 — see `docs/COLLABORATOR_BRIEFING.md`): *increasingly optimized sparse
models in this harness*, adapted per turn by **Test-Time Training (TTT)** —
fast-weight layers trained during inference on the contents of the RLM's
context (the REPL variables), and — the collaborator's sharper claim — on the
harness's own composed meta-prompts, "increasing quality of response
overall." This record decomposes that claim, surveys the literature as of
July 2026, maps the mechanism onto Trellis's actual seams, and pre-states how
any adoption claim would be measured before a dollar or a GPU-hour is spent.

---

## 1. Why this record exists

Trellis's reasoning engine is an RLM — a root LM operating a persistent
Python REPL, with the knowledge substrate injected as live tool objects
(the MIT CSAIL formulation: Zhang, Kraska & Khattab, arXiv:2512.24601). The
root model today is `gpt-5.4-2026-03-05` behind the OpenAI API: a closed
model whose weights Trellis cannot touch. Every behavioral improvement this
project has shipped therefore lives in one of two layers:

1. **Tooling shape** (the permanent owner direction after Session 28):
   typed refusals, engine-computed addresses, gates, budgets — the
   mechanism that closed transcription, laundering-T1, retrieval waste,
   and the splice pathologies.
2. **Prompt text** (deprioritized after the module #2 retirement): the
   composed system prompt, byte-pinned, reinforcing but never carrying the
   behavior.

TTT proposes a **third layer that Trellis has never had access to: the
model's own weights, adapted per run at inference time.** The proposal only
becomes physically possible if the backend moves (in whole or in part) to
open-weights models — which is exactly the collaborator's "increasingly
optimized sparse models" premise: modern sparse mixture-of-experts models
(the open-weights MoE class) are cheap enough to serve locally that
per-turn weight adaptation becomes an affordable, measurable lever rather
than a hypothetical.

The reason to take this seriously is architectural fit, not fashion: the
RLM already treats context as an external environment queried through
code. TTT layers treat context as a training signal compressed into
weights. These are complementary compressions of the same thing — and the
harness's fixed, byte-pinned meta-prompt is precisely the kind of
repeated-prefix signal that fast-weight machinery amortizes well (§4.3).
The reason for caution is equally concrete: the strongest 2026 agentic
result (§3.4) found TTT gains are *stability-shaped*, not
capability-shaped, and the strongest 2026 evaluation paper found that
perplexity-style TTT wins often fail to appear as behavioral wins. Both
findings align exactly with this project's measurement doctrine, so the
ladder in §7 is built on it.

## 2. The claim, decomposed

The collaborator's description compresses three separable hypotheses. They
are stated here so each can be tested — or rejected — on its own.

- **H1 (context adaptation).** Fast-weight layers trained per turn on the
  REPL-resident context improve the model's use of that context —
  long-context retrieval, cross-turn variable tracking, protocol
  adherence over long episodes. *Literature status: supported at modest
  effect sizes on long-context benchmarks (§3.2), with an explicit
  behavioral caveat (§3.4). Trellis-specific status: unmeasured.*
- **H2 (meta-prompt adaptation).** Because the harness re-presents the
  same composed meta-prompt bytes every turn (`RLM_SYSTEM_PROMPT` +
  `TRELLIS_ADDENDUM`, byte-pinned at `COMPOSED_SYSTEM_PROMPT_SHA256`),
  fast weights repeatedly trained over that prefix effectively *compile
  the protocol into weights*, improving instruction-following on the
  house protocol specifically. *Literature status: no direct study found;
  the nearest mechanisms are prefix-state compilation (§3.3) and
  fast-weight prefix processing (§3.1). This is the most original and
  least evidenced hypothesis — it needs a positive control before any
  belief attaches (§6).*
- **H3 (the sparse-model vehicle).** Open sparse MoE checkpoints are the
  practical substrate: cheap enough to serve, open enough to adapt.
  *Status: a premise about infrastructure, not a hypothesis about
  behavior — but it smuggles in the real gating question, which is
  whether ANY open model drives the house REPL protocol acceptably
  before TTT enters the picture at all (§7 R3). No TTT×MoE unified
  literature exists as of July 2026 (§3.5); expert-level adaptation is
  an open question for the collaborator (§9).*

The phrase "increasing quality of response overall" is treated throughout
this record as **an unmeasured hypothesis, not a finding.** Guardrail 8
applies to prospective claims too: no headline until a paired arm exists.

## 3. What the literature actually says (as of July 2026)

Three mechanism families get called "test-time training." They differ in
where the weights live, when they update, and what infrastructure they
demand — conflating them is the most common error in secondhand accounts,
and the collaborator's "FastWeights" phrasing spans at least two of them.

### 3.1 Family A — fast-weight layers as architecture

The hidden state of a sequence layer IS a small model; the layer's forward
pass IS a gradient step on a self-supervised loss over the incoming
context. "Training during test time" is the layer's normal operation, and
an outer training loop learns the learning rule itself.

- **TTT-Linear / TTT-MLP** (Sun et al., *Learning to (Learn at Test
  Time): RNNs with Expressive Hidden States*, arXiv:2407.04620, ICML
  2025): the modern statement of the idea. Linear-complexity layers whose
  hidden state (a linear model or 2-layer MLP) is updated by a
  reconstruction loss per token; matches or exceeds Transformer and Mamba
  baselines and — unlike Mamba — keeps improving past 16k context.
- **Titans** (Behrouz, Zhong & Mirrokni, Google Research,
  arXiv:2501.00663, NeurIPS 2025): a neural long-term memory module
  updated at test time by a surprise-metric gradient with momentum and
  weight decay (forgetting); attention as short-term memory beside it;
  scales past 2M-token context. **ATLAS** (arXiv:2505.23735) and the
  test-time-regression unifying framework (arXiv:2501.12352) generalize
  the family.
- **Large-chunk TTT / "Test-Time Training Done Right"** (OpenReview
  Tb9qAxT3xv): makes nonlinear fast-weight updates hardware-efficient by
  batching updates over large chunks — the engineering answer to why
  earlier TTT layers underused GPUs.
- **Lineage** (the collaborator's "FastWeights" vocabulary): fast weights
  are Schmidhuber 1992 (*Learning to Control Fast-Weight Memories*) and
  Ba et al. 2016 (*Using Fast Weights to Attend to the Recent Past*,
  arXiv:1610.06258); Schlag, Irie & Schmidhuber 2021 showed linear
  attention IS a fast-weight programmer (arXiv:2102.11174) — the formal
  bridge explaining why in-context learning and fast-weight adaptation
  are siblings.

**Relevance to Trellis:** Family A requires the backend model to HAVE such
layers — either trained with them or retrofitted (the 2025 video result,
arXiv:2504.05298, grafted TTT layers onto a frozen pretrained DiT). Trellis
cannot add Family A to an API model. This family becomes available only at
or after §7 R3 (open-weights serving), and only if a checkpoint with these
layers exists or a retrofit is funded.

### 3.2 Family B — per-instance adaptation of pretrained weights

An ordinary pretrained model; an explicit optimizer step (usually LoRA or
rank-constrained fast weights) at inference time, on data derived from the
test input; weights discarded afterward. This is the family that works on
open checkpoints TODAY and the one every 2026 agentic result uses.

- **TTT for ARC** (Akyürek et al., *The Surprising Effectiveness of
  Test-Time Training for Abstract Reasoning*, arXiv:2411.07279): per-task
  LoRA adapters trained at test time on augmented demonstrations; up to
  6× accuracy over the fine-tuned base; 53% on ARC public with an 8B
  model. The canonical evidence that per-instance gradient steps buy real
  capability on the right task shape.
- **TTT on nearest neighbors** (Hardt & Sun, arXiv:2305.18466, ICLR
  2024): fine-tune briefly on retrieved neighbors of the test input.
  Directly suggestive for Trellis: the retrieval substrate could FEED the
  adaptation data path — with all the provenance questions §5 raises.
- **TTT-NTP** (Ouyang, Cai & Hu, *Test-Time Training with Next-Token
  Prediction*, arXiv:2606.21803, June 2026): drop-in fast weights at MLP
  down-projections, chunk-parallel rank-one updates tied to the native
  next-token loss; works on released checkpoints (Llama-3.1-8B,
  Mistral-7B, Qwen3 series); +3–4 points on RULER 4k–32k, +3.7–5.6 on
  LongBench-v2, general knowledge preserved. The current best evidence
  that fast-weight adaptation is deployable on open models without
  architectural surgery.
- **Self-guided TTT for long context** (arXiv:2607.09415, July 2026): the
  model selects relevant spans before adapting on them — TTT with a
  retrieval step in front, again adjacent to Trellis's shape.

### 3.3 Family C — compiled-state cousins (no per-turn gradient)

- **Cartridges / self-study** (arXiv:2506.06266): train a compact
  KV-like state per corpus OFFLINE, reuse it at inference — amortized
  context rather than per-turn training. The nearest existing mechanism
  to H2's "compile the meta-prompt" reading.
- **SEAL** (arXiv:2506.10943): the model writes its own finetuning data
  and applies persistent self-edits — adjacent but PERSISTENT, which
  places it outside this track's per-run-ephemeral scope (§5.3).
- **Transformer²** (arXiv:2501.06252): inference-time expert-vector
  selection over SVD components — adaptation without test-time gradients.

### 3.4 The two 2026 results that most constrain this track

1. **Agentic TTT** (*No Time Like the Present: Agentic Test-Time Training
   for LLM Agents*, arXiv:2607.03441, July 2026): continuous in-episode
   LoRA updates for multi-turn agents (vLLM runtime-LoRA serving), with
   token-level loss reweighting to stop the feedback loop where each
   update changes the policy that generates the next batch of training
   text. Gains: up to +5.0 ALFWorld / +4.9 SWE-bench Lite at 1.9× serving
   cost — and the authors' own characterization is that aTTT **preserves
   existing competence over long trajectories rather than teaching new
   abilities.** For Trellis this is the most load-bearing external fact:
   the realistic H1 payoff is *protocol-adherence stability over long
   REPL episodes*, a quantity the harness already counts
   (`TRELLIS_PROTOCOL_VIOLATION`, answer-channel compliance, criterion
   items in every measured run).
2. **Beyond Perplexity** (arXiv:2607.00368, July 2026): a behavioral
   evaluation framework for TTT deployment-memory claims; finds that
   perplexity improvements from TTT frequently fail to appear as
   behavioral ability to USE the newly absorbed information. This is the
   house measurement doctrine stated independently: a TTT arm must be
   judged on task behavior with pre-stated criteria, never on loss
   curves. §6 adopts it explicitly.

### 3.5 What was NOT found

No unified TTT×sparse-MoE literature (expert-level fast weights, routed
adaptation) as of July 2026 — the intersection is the collaborator's
research premise, not an established result, and §9 asks them for their
formulation. No direct study of fast-weight adaptation to a fixed
harness meta-prompt (H2) was found either; H2 is genuinely open.

## 4. What TTT would mean inside Trellis — the seams, named

### 4.1 The backend seam today

The model backend is hardcoded at exactly the places an R2 audit must
census (initial grep, to be completed by R2):

- `src/rlm/trellis_agent.py` passes
  `backend_kwargs={"model_name": "gpt-5.4-2026-03-05"}` to the rlms
  scaffold at both construction sites (research mode and author mode),
  and constructs a direct `openai.OpenAI()` client for the checker-model
  path. The rlms library (rlms==0.1.3, pinned) owns the actual API
  transport; **whether it exposes a base-URL/backend override without
  library modification is UNKNOWN and is R2's first question** —
  guardrail: no rlms modifications, so if it does not, the serving layer
  must present an OpenAI-compatible endpoint (vLLM and SGLang both do;
  the aTTT paper's serving stack is vLLM's runtime-LoRA API, which is
  encouraging for R4's feasibility).
- The worker-side completions (extraction, entailment judge, sweeps) have
  their own client constructions and pricing constants
  (gpt-5.4 $2.50/M in, $10/M out appears in runner spend gates) — R2
  censuses these; nothing here assumes they move. **A split backend
  (open model for the RLM root, API model for extraction/judging) is a
  legitimate intermediate state** and probably the first real
  configuration.

### 4.2 The embedding coupling — a substrate-identity trap named early

`vector_search` similarity runs against STORED embeddings:
`src/config/schema.ts` pins `embedding vector(1536)` with an HNSW index,
and `search_ast_nodes` orders by distance to a query embedding produced by
the SAME embedder family. Swapping the embedding model is therefore NOT a
config change: stored embeddings and query embeddings must come from the
same space, the schema pins the dimension, and a different embedder
invalidates every stored vector (a re-embed of the full live substrate, at
cost, plus a schema migration if dimensions differ). **The completion
backend and the embedding backend are separable decisions.** The cheap,
sane first configuration keeps the OpenAI embedder while the completion
backend moves. If the embedder ever moves, that is a substrate-identity
event in the Session 38 grammar-pin sense: recorded, owner-visible,
re-measured (the eight pinned seam queries are the standing instrument —
they are embedder-sensitive by construction).

### 4.3 The meta-prompt prefix and the byte pins (H2, mechanically)

Every research run presents the same composed prompt prefix, byte-pinned
(`COMPOSED_SYSTEM_PROMPT_SHA256 = 5d27e474…fe2a` today; the pin moves only
with witting kernel changes). Two consequences if the backend ever carries
fast-weight machinery:

1. **Determinism of the prefix trajectory.** A fast-weight layer's state
   after processing a FIXED prefix is a pure function of (checkpoint
   hash, TTT config, prefix bytes). The prefix-adapted state can be
   computed once and snapshotted — H2's "optimizes the response to our
   internal meta-prompts" becomes, concretely, a **prefix fast-state
   cache** whose natural cache key is exactly the composed-prompt sha256
   the module registry already maintains. The house byte-pin discipline,
   built for prompt integrity, is coincidentally the exact cache-key
   discipline this mechanism needs. (Family C's cartridges are the same
   idea with offline compilation.) This is an observed architectural
   synergy, NOT a promised speedup — R5 measures or drops it.
2. **The pins become load-bearing for a new reason.** Today a silent
   prompt-byte drift breaks a hash check; under a prefix fast-state
   cache it would also silently invalidate (or worse, mis-serve) an
   adapted state. The existing rule — pins move only wittingly, both
   recomputed in the same commit — already covers this; the R5 design
   record would add the checkpoint hash and TTT config to the key.

### 4.4 Per-run state semantics

The house per-run doctrine transfers wholesale: the Session 30 retrieval
set is "per run = per process, monotone, never parked." Fast weights get
the same shape — **per-run ephemeral, reset at process start, never
serialized, never parked, never seeded across runs.** In the multi-turn
REPL, each turn re-presents the transcript, so a stateless serving backend
re-derives the fast state from the full prefix each turn; any within-run
state carry is a serving optimization, not a semantics change. Cross-run
persistence of adapted weights (the SEAL shape) would be a
capability-promotion event — Tier-3-to-somewhere — and is explicitly OUT
of this track's scope; if it is ever wanted it enters through its own
design record with its own gate, exactly as promotion did.

## 5. Trust-model analysis

### 5.1 Fast weights have no provenance standing

A fast-weight state is derived, ephemeral, and untraceable to specific
source bytes in the substrate sense — it is a compressed function of
everything the run saw. It therefore gets the Tier-3 treatment by
definition: **zero provenance standing, structurally incapable of minting
citations.** Nothing about weight adaptation touches what may be written
to the graph: writes still flow through `write_derived_insight`'s
three-layer enforcement (format → existence → retrieval membership), and
the cited addresses still have to be in the run's retrieval set.

### 5.2 The gates are model-agnostic by construction — the designed-in strength

Every enforcement mechanism this project built lives ENGINE-SIDE, in the
tool layer and the write path, not in the model: the Session 14 write
path, the Session 30 retrieval set, the Session 31 membership gate, the
Session 32 sampled detector, the Session 33 dedup/budgets, the Session 41
guarded splice family. **A backend swap — dense to sparse, API to local,
static to TTT — changes NONE of them.** This is not luck; it is the
tooling-shape doctrine paying out: because no behavioral guarantee was
ever entrusted to the model, no behavioral guarantee is lost when the
model changes. The trust model's answer to "can we swap the model?" is
"the trust model never depended on which model."

### 5.3 The threats a TTT backend adds (named now, measured later)

1. **Injection amplification.** Today, adversarial bytes in retrieved
   content influence one completion. Under TTT they also influence the
   WEIGHTS that process every subsequent token of the run — retrieved
   content becomes training data mid-flight. The existing containment
   story (bounded tool surfaces, typed refusals, the write gates, sampled
   entailment) still holds at the action boundary, and per-run reset
   bounds the blast radius to one run. But the T2 lesson generalizes:
   *what the model absorbed* is not observable the way *what the model
   cited* is. Any R4 proposal must state its adaptation-data policy —
   what byte sources are eligible to produce gradients (REPL-resident
   retrieved blocks? tool outputs? the meta-prompt only?) — as explicitly
   as the retrieval set defines citability today.
2. **Cross-run contamination.** Handled by construction if §4.4's
   per-run-ephemeral rule is kept absolute. The rule is stated in this
   record precisely so a future convenience ("warm-start from the last
   run's adapter") is recognizable as a design change, not an
   optimization.
3. **Reproducibility.** A TTT run's behavior is a function of checkpoint
   hash + TTT config (rank, learning rate, chunk size, seed) + the full
   input trajectory. The Session 38 doctrine transfers: **a model
   checkpoint is a substrate-identity object — exact-pinned by hash,
   bumped only as a recorded owner-visible event.** TTT config values are
   run-stamped in telemetry (counts and config echoes, never content),
   the same way arm assignment was verified per run in the Session 43
   measurement.

## 6. Measurement doctrine applied (before any spend)

The permanent owner direction (July 11–13, 2026) is that behavioral claims
are settled by paired measurement with pre-stated criteria, and failure
classes close by tooling shape. TTT is neither tooling shape nor prompt
text — it is a third substrate — but the acceptance discipline transfers
unchanged, and Trellis is unusually well-instrumented for it:

- **The instruments already exist.** The `est` suite (five
  sufficiency-bounded questions, truths unit-pinned) is a ready-made
  paired-arm harness — it was row 10's acceptance instrument and runs
  identically against any OpenAI-compatible backend. The
  effective-context probe suites, the OOLONG-hard set, protocol-violation
  and answer-channel counters, and the stage-2 criterion mold are all
  backend-independent.
- **The positive-control duty (the Session 28 lesson, restated for TTT):**
  before believing ANY TTT null OR win, build a condition where the
  no-TTT arm demonstrably fails and verify TTT moves it. H1's natural
  positive control is a long-horizon episode shaped like aTTT's setting
  (protocol drift over many turns); H2's is a protocol-adherence task
  where the base open model measurably violates the house protocol at a
  known rate. *A null result is meaningless until the experiment has
  demonstrated it can produce a positive one* — the A/B eval's
  meta-lesson, verbatim.
- **Behavioral, never perplexity** (arXiv:2607.00368 adopted): every
  criterion item is a task-behavior count (correctness, violations,
  refusals handled, tokens, dollars/GPU-minutes) — loss curves and
  perplexity may be RECORDED but never satisfy a criterion.
- **Counts and correctness together** (guardrail 4): a TTT arm that cuts
  tokens but drops correctness FAILS; one that lifts correctness at 1.9×
  serving cost reports both numbers.

## 7. The rung ladder (each rung owner-gated, propose-with-estimate)

The ladder is sequenced so every rung is cheap to refuse and no rung
assumes a later one. R2 is the only rung a session can execute without new
infrastructure or budget beyond its own time.

- **R1 — collaborator exchange (zero-paid, owner-mediated).** Deliver
  this record and §9's questions to the collaborator through the owner
  (the briefing's five-line proposal frame). Their formulation of the
  TTT×sparse intersection shapes R4's arms. No session dependency —
  proceeds in parallel with everything.
- **R2 — the backend-seam audit (zero-paid; the next actionable rung).**
  A read-only census + design record: every site that assumes the OpenAI
  transport, the gpt-5.4 model id, its pricing, or its token accounting
  (`trellis_agent.py` construction sites, the direct client
  constructions, worker completions, runner spend gates, telemetry
  parsers); whether rlms==0.1.3 admits a base-URL override WITHOUT
  library modification (guardrail: no rlms mods — if not, the seam is an
  OpenAI-compatible serving endpoint, full stop); the embedding-coupling
  boundary (§4.2) stated as a non-goal; the split-backend configuration
  (§4.1) designed as config, refusal-typed, defaulting to today's exact
  behavior byte-for-byte. Output: a design record in this file's §12 (or
  its own file if it outgrows this one) + NO implementation until the
  owner separately approves one.
- **R3 — the open-sparse baseline (paid: GPU or hosted-endpoint spend;
  needs R2's record).** Serve ONE owner-chosen open sparse checkpoint
  (exact-pinned by hash) behind an OpenAI-compatible endpoint; run the
  est suite + a protocol-adherence block against it, paired against a
  same-day gpt-5.4 arm. **The gating question is R3's, not R4's: can an
  open sparse model drive the house REPL protocol at an acceptable
  violation rate at all?** If R3 fails its pre-stated criterion, the
  track PAUSES at a recorded finding — TTT on a model that cannot drive
  the protocol is measurement noise. (R3 is also independently valuable:
  it prices the API-cost exit for ordinary runs.)
- **R4 — the paired TTT arm (paid; needs R3 PASS).** The same checkpoint
  with a Family-B mechanism (aTTT-style in-episode LoRA or
  TTT-NTP-style fast weights — R1's exchange picks), same instruments,
  TTT on/off paired, adaptation-data policy pre-stated (§5.3.1),
  per-run-ephemeral verified in telemetry both directions (the
  Session 43 arm-verification mold). Criterion pre-stated in the R4
  proposal; the H1 expectation calibrated by §3.4 (stability-shaped, not
  capability-shaped).
- **R5 — the meta-prompt fast-state measurement (paid; needs R4 to have
  produced a mechanism worth keeping).** H2 isolated: prefix fast-state
  compiled over the composed prompt (cache key = composed-prompt sha256 +
  checkpoint hash + TTT config, §4.3), measured on protocol-adherence
  deltas specifically. If R4 died, R5 dies with it — H2 is not reachable
  by API.

**Cost doctrine.** Local serving spends GPU-hours, not per-token dollars.
The standing ≤$5/run cap re-expresses as an owner-set per-run compute
budget stated in the R3/R4 proposals (estimate before, actuals after, in
the roadmap §5 entry — unchanged ceremony). Hosted open-model endpoints
(per-token) stay under the $5 cap as-is.

## 8. Honest scope — what this record does NOT claim

- **No TTT is possible on the current backend.** gpt-5.4 is an API model;
  nothing in this track changes today's runtime, and no runtime byte
  moved in the session that wrote this record.
- **"Increases quality of response overall" is a hypothesis** (H1+H2),
  not a finding — and the best current external evidence (§3.4) predicts
  the honest win is *stability over long episodes*, at ~2× serving cost,
  not a general quality lift. If the measurements come back
  stability-only, that is the finding this record's ladder was built to
  produce, and it gets reported at exactly that size.
- **H2 has no direct literature support** — it is the collaborator's
  conjecture plus an architectural synergy observation (§4.3). It is
  listed last in the ladder for that reason.
- **The sparse premise is not evaluated here.** Whether optimized sparse
  checkpoints are the right vehicle is R3's empirical question and the
  collaborator's expertise; this record maps the harness side only.
- **This record makes no promise that the track proceeds.** If the owner
  never gates R2 open, this file is a complete, self-contained account of
  why not-yet — which is a legitimate steady state.

## 9. Questions for the collaborator (via the owner; the briefing's frame)

1. **Mechanism selection.** For a multi-turn REPL agent with a fixed
   ~10k-token protocol prefix and run-resident retrieved context: which
   concrete mechanism do you have in mind — architectural fast-weight
   layers (TTT-Linear/Titans class, needs a trained-with-TTT
   checkpoint), in-episode LoRA (aTTT class, works on any open
   checkpoint via runtime-LoRA serving), or drop-in fast weights at MLP
   projections (TTT-NTP class)? Our R4 arms depend on this choice.
2. **The sparse intersection.** "Increasingly optimized sparse models" —
   is the sparsity doing WORK in your formulation (expert-level
   adaptation, routed fast weights — a literature we could not find as
   of July 2026), or is it the economics (open MoE = cheap serving) with
   TTT orthogonal? If the former: what does a positive control for
   expert-level adaptation look like?
3. **The meta-prompt claim (H2).** What is the mechanism by which
   fast-weight adaptation over a FIXED prefix improves responses beyond
   what the frozen model already extracts from attending to that prefix?
   A gradient step over bytes the model has fully attended to is not
   obviously additive — is the claim about effective capacity, about
   depth-of-processing, or about something empirical you have observed?
   A failing case we can reproduce (your five-line frame's "Failure it
   closes") would move this from conjecture to rung.
4. **The adaptation-data policy (§5.3).** In your setup, what byte
   sources are eligible to produce gradients at test time? Our trust
   model needs this stated as precisely as the retrieval set defines
   citability — retrieved substrate blocks, tool outputs, the prefix
   only, or everything in the REPL?

## 10. Reading list (dependency order, arXiv ids verified July 13, 2026)

| # | work | why it matters here |
|---|---|---|
| 1 | Zhang, Kraska & Khattab, *Recursive Language Models*, arXiv:2512.24601 | the formulation Trellis implements; TTT would live UNDER this |
| 2 | Sun et al., *Learning to (Learn at Test Time)*, arXiv:2407.04620 | Family A's modern statement (TTT-Linear/TTT-MLP) |
| 3 | Behrouz et al., *Titans*, arXiv:2501.00663 (+ *ATLAS*, arXiv:2505.23735) | fast-weight long-term memory at 2M+ context |
| 4 | Ba et al., arXiv:1610.06258; Schlag et al., arXiv:2102.11174 | the FastWeights lineage; attention ≈ fast-weight programming |
| 5 | Akyürek et al., arXiv:2411.07279 | Family B's capability ceiling (ARC, 6×) |
| 6 | Hardt & Sun, arXiv:2305.18466 | TTT on retrieved neighbors — the retrieval-fed variant |
| 7 | Ouyang, Cai & Hu, *TTT-NTP*, arXiv:2606.21803 | drop-in fast weights on open checkpoints (June 2026) |
| 8 | *No Time Like the Present: Agentic TTT*, arXiv:2607.03441 | the multi-turn agent result + the stability-not-capability finding |
| 9 | *Beyond Perplexity*, arXiv:2607.00368 | the behavioral-evaluation framework §6 adopts |
| 10 | *Cartridges*, arXiv:2506.06266; *SEAL*, arXiv:2506.10943 | Family C: compiled prefix state; persistent self-edits (out of scope) |
| 11 | *Self-Guided TTT*, arXiv:2607.09415; LaCT, OpenReview Tb9qAxT3xv | span-selected adaptation; hardware-efficient large-chunk TTT |

## 11. Interaction with standing guardrails (nothing weakened)

- **No rlms library modifications** (guardrail 10): the backend seam, if
  ever built, is config + an OpenAI-compatible endpoint, or it is not
  built.
- **The write path, retrieval set, membership gate, detector, discipline,
  and guarded family are untouched by anything in this track** (§5.2);
  fast weights never gain provenance standing (§5.1); per-run-ephemeral
  is absolute within this track (§4.4).
- **Model checkpoints and embedders are substrate-identity objects**:
  exact-pinned, bumped as recorded owner-visible events (§4.2, §5.3.3);
  the embedder does not move as a side effect of the completion backend
  moving.
- **All spend owner-gated propose-with-estimate**; the compute-budget
  re-expression (§7) changes the unit, never the ceremony.
- **Experiment flags follow the house mold**: any TTT on/off arm flag is
  probe-only, off by default, byte-identical unset, stripped by
  `buildAgentEnv` — exactly the `TRELLIS_EXP_*` pattern.
- **No default changes**: today's backend, prompt bytes, and pins are the
  baseline every rung is measured against; a rung that lands still
  changes no default without its own recorded owner decision.
