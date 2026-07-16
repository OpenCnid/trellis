# Declared Ghosts: A Forensic Audit of Vaporware in the Trellis Repository

*An analytical paper on everything in OpenCnid's Trellis (Recursive Language Model runtime) that is specified, claimed, or implied but does not actually run — and on the unusual honesty machinery that surrounds most of it.*

---

## Abstract

Trellis presents itself as a running system with measured results: perfect F1 on a long-context benchmark, a 26× cost advantage over the MIT-style stateless baseline, a "giant effective context window," a self-verifying knowledge graph, and a controller that will eventually let the system engineer itself. A forensic pass over the repository finds that a substantial fraction of this surface has never executed. The hardened v2 benchmark exists as data and generator but has never been run against a paid model; the ~$1.12/query baseline underlying the flagship economics has never been measured in this repository and is cited circularly from the project's own product spec; the engineering loop — 1,239 passing tests, 116 mapped requirements, an activated controller — has never driven a single real feature, and its pilot is formally blocked; a four-variable model-backend configuration surface is validated at startup and consumed by nothing; two of the four registered capability modules are refused by the loader on purpose; node-level quarantine is "latent, not live" by the repo's own words. Yet the audit's second finding is the more interesting one: nearly every gap is *declared*, in-file, often in the same sentence as the claim, enforced by tests and machine-readable status fields. Of fourteen audited items, twelve grade DECLARED, one DISCOVERABLE, and exactly one — the $1.12/26× economics — MISLEADING-BY-OMISSION. Trellis is not vaporware-as-deception; it is a small, heavily drilled mechanical core wearing a large, mostly honest ledger of futures. The paper closes with a vaporware-to-substance judgment against typical research repositories and identifies the three unrun experiments most likely to change the system's story — arguing that one of them (the baseline head-to-head) would probably go *against* the repo's headline.

---

## 1. Method and taxonomy

The audit covers the repository at `/home/user/trellis` as of July 16, 2026 (50 commits on `master`, latest `841f875`, EL-11 merged via PR #114). Every claim below was verified against files in the tree — docs, manifests, code comments, test pins, and the persisted result artifacts (`benchmark_results.json`, `scale_drill_results.json`, `update_drill_results.json`, `poison_drill_results.json`).

"Vaporware" here means: **anything specified, claimed, or implied that has not executed** — unrun experiments, dead configuration, spec-only surfaces, paused tracks, and declared non-features. That is deliberately broad, because the interesting question is not *whether* gaps exist (every research repo has them) but *how each gap is disclosed*. Each item receives one of three grades:

- **DECLARED** — the gap is stated explicitly, in or adjacent to the claim, in language a first-time reader will hit (status headers, in-sentence caveats, loader refusals pinned by tests).
- **DISCOVERABLE** — the gap is recorded somewhere in the repo, but a reader consuming the headline surface (README, report TL;DRs) could reasonably miss it; finding it requires following links or grepping.
- **MISLEADING-BY-OMISSION** — the claim is presented as established while the disqualifying fact (never measured, never run) is nowhere stated as such.

## 2. Summary table

| # | Item | What is claimed / specified | What actually exists | Disclosure grade |
|---|------|------------------------------|----------------------|------------------|
| 1 | v2 anti-shortcut benchmark | Hardened corpus "shipped in Session 6" closes the substring-scan shortcut | `data/oolong_pairs_dataset_hard.json` + generator + zero-paid ground-truth tests; **no paid run ever executed**; all perfect-F1 headlines are v1-only | DECLARED (explicit note, CRITIQUE_AND_FUTURE §3.3) |
| 2 | ~$1.12/query baseline → 26× economics | "The MIT-style stateless baseline pays ~$1.12 per query, forever" (README); 1,000 queries: $1,120 vs ~$40 | Number asserted in the project's own product spec (`BENCHMARK_OOLONG.md` §2), cited circularly by FLYWHEEL_EXPLAINER and README; **never measured head-to-head in this repo** | **MISLEADING-BY-OMISSION** |
| 3 | Engineering loop (EL program) | A controller that runs bounded agent sessions and eventually generates HANDOFF.md | 1,239 tests / 116 requirements / activated controller; **zero real features ever driven**; EL-07 pilot BLOCKED (preflight refused), EL-08/09 deferred; Codex adapter's only live run: `initialize`/`initialized` smoke; manual HANDOFF.md remains authoritative | DECLARED (exemplary) |
| 4 | `TRELLIS_RLM_BACKEND` / vLLM seam | Config surface for swapping the model backend | Four env keys validated at startup with cross-field refusals; "No consumer reads these values yet; T2/T3 wire them" (`src/config/index.ts`); T2 paused after three failed paid attempts | DECLARED (in-code) |
| 5 | Capability modules | "The system's capabilities are beliefs" — a registry of versioned protocol modules | 4 registered; `estimation-discipline` **retired** (measured failure), `reasoning-templates` **contested** (spec never sequenced); loader refuses both (`only active modules load`, test-pinned) | DECLARED (manifest + loader + tests) |
| 6 | Node-level quarantine | Contested Entity nodes carry trust state | "No consumer currently reads node-level `contested`, so this is latent, not live" (UPDATE_DRILL_REPORT §limitations) | DECLARED (verbatim) |
| 7 | Frontend (`src/frontend/`) | Next.js graph + provenance UI | Dev-only app; deployment deferred three times, unscheduled; "deferred, don't touch unasked" (AGENTS.md) | DECLARED |
| 8 | "Giant effective context window" | Whole repo = 13 MB frame, 16 ms queries | Mechanical micro-benchmark real (CODE_MEDIATED_TEXT §7); the end-to-end paired-run probe of the claim "is on the owner-gated queue" — stated in the README's same sentence | DECLARED (exemplary, in-sentence) |
| 9 | Test-Time-Training track | Per-run weight adaptation on open-weights backends | Research record only: "lands NO machinery, changes NO runtime byte"; R3–R5 unrun; paused behind the EL program | DECLARED (status header) |
| 10 | A2A CancelTask / push notifications | Full A2A v1.0 surface | `CancelTask` always declined (`-32002`, "the goal loop has no abort path"); push notifications declined (`-32003`) | DECLARED (typed errors, documented) |
| 11 | Trellis-as-MCP-server | Full design record (`MCP_SERVER_SURFACE.md`) | Zero implementation; header: "no implementation, drills, or paid runs are claimed here"; not sequenced | DECLARED |
| 12 | Owner-gated paid-probe queue | "On the owner-gated queue" implies a queue | No single queue artifact; unrun probes (repo-scale context probe, $0.29 extraction re-run, cross-process textedit proof, v2 run, EL-07 trials) scattered across HANDOFF/roadmap ledger entries | DISCOVERABLE |
| 13 | Scale claims | Provenance sweep scales; migration triggers pre-declared | Zero-LLM drill stops at 300 synthetic docs; "Extrapolation is not a substitute for that rerun" | DECLARED |
| 14 | Perfect-F1 headline placement | README pillar 4: knowledge flywheel "shipped and measured" | True only on the v1 corpus its own critique calls substring-solvable; the caveat lives one link away | DISCOVERABLE |

## 3. The benchmark economy: a measured wheel on an asserted road

### 3.1 The benchmark that was never run (Item 1)

The repository's headline empirical result — **F1 = 1.000 on all 20 queries of OOLONG-Pairs, replicated across two independent runs, $0.81–$0.87 per run** — is real, persisted (`benchmark_results.json`, line 3: `"dataset": "oolong-pairs-trec-synthetic-v1"`), and telemetry-documented down to per-query sub-call counts. It is also, by the project's own analysis, achieved on a corpus with a hole in it. `CRITIQUE_AND_FUTURE.md` §1.3 documents that city mentions in v1 are resolved "by case-insensitive substring scan in Python," and §3.3 concedes the consequence: the v1 corpus "embedded every city mention as the literal capitalized token, so the substring scan… could satisfy the pair query without ever consulting cached classifications — the shortcut this document called out."

The fix exists. `data/oolong_pairs_dataset_hard.json` (`oolong-pairs-trec-synthetic-v2`, seeded generator in `src/benchmarks/oolong/generate_v2.ts`) breaks the shortcut three ways: 28 questions mention their city only via alias ("the French capital" — the canonical token never appears, unit-pinned), 20 near-miss name-drops, 20 decoy prose passages that can never pair. Deterministic ground-truth machinery is drilled zero-paid (`npm run test:benchmark-hardening`).

What does not exist is a single paid run against it. The critique says so in a note that deserves quoting because it is the house style at its best:

> "No paid benchmark run against v2 has been executed… a v2 run requires explicit owner approval first and its warm phase is expected to *discriminate*… so F1 below 1.0 is an acceptable — indeed informative — outcome."

**Grade: DECLARED.** The gap is stated, the expected direction of the result is pre-registered, and the run is gated rather than forgotten. The residual criticism is placement (Item 14): the README's pillar 4 calls the knowledge flywheel "shipped and measured" and the benchmark report's TL;DR leads with the perfect score; the v1-only caveat is one link away in the critique. A reader who stops at headlines leaves with a stronger impression than the evidence supports — DISCOVERABLE, not misleading, because the companion critique is linked from every headline document.

**To close:** one owner-approved run, estimated from v1 telemetry at roughly a dollar. That this has not been spent — while roughly five dollars were spent on three failed T2 self-edit attempts (§5) — is the single oddest prioritization fact in the repository.

### 3.2 The baseline that was never measured (Item 2)

The economics story is the repo's most quoted claim: the README asserts "the MIT-style stateless baseline pays ~$1.12 per query, forever; Trellis pays once," and `FLYWHEEL_EXPLAINER.md` builds the side-by-side table — $1,120 vs ~$40 at 1,000 queries — on that number.

Trace the citation chain and it is circular. FLYWHEEL_EXPLAINER cites "[benchmark spec §2]" — which is `docs/product/BENCHMARK_OOLONG.md`, the project's *own product spec*, where the number appears as flat assertion: "Query 1 costs ~$1.12. Query 2 costs ~$1.12." No run, no telemetry, no external citation, no derivation. No document in the repository states plainly that the baseline was never executed here. The nearest hedge is one word in the critique — "the 26× *projected* cost advantage" — immediately undercut in the same sentence by "is real."

The omission matters because the repo's own telemetry argues the number is probably too high. Trellis's cold-phase evidence shows a *full 220-question corpus classification sweep* costs between $0.088 (Run A, five batched sub-calls) and $0.878 (poison-drill single-call sweep) at frontier prices. A stateless-but-competent baseline re-paying that sweep per query would land in the $0.10–$0.90/query range, not $1.12 — and the honest multiplier would land somewhere between ~3× and ~20×, not 26×. The amortization *shape* (O(corpus) once vs O(corpus) per query) is architecturally unassailable; the *magnitude* rests on an adversary the repo constructed on paper and never ran.

**Grade: MISLEADING-BY-OMISSION** — the only item in the audit to earn it. Every other gap in this repository is fenced with a status header; this one is repeated verbatim in the README as if measured. **To close:** run the MIT-style baseline harness on the same corpus, same model, 20 queries — perhaps $25 at the asserted rate, less if the assertion is high, which is rather the point.

### 3.3 Scale by big-O (Item 13)

The provenance-scale story is honest about its own ceiling. `SCALE_PROVENANCE_REPORT.md` opens with "Cost: zero LLM calls," stops at 300 synthetic documents / 6,000 citations, and pre-declares the migration trigger (a live 1,000-hash array or superlinear sweep growth) with an unusually good sentence: "Extrapolation is not a substitute for that rerun." A noisy 11.61× reading from Session 22 that failed to reproduce (1.48× on re-run) is recorded rather than buried. Everything above 300 documents is argument, and is labeled as argument. **DECLARED.**

## 4. The self-engineering loop: 1,239 tests, zero features (Item 3)

The engineering loop (`tools/engineering-loop/`, `docs/product/engineering-loop/ROADMAP.md`) is the repository's largest single block of never-exercised capability, and its most meticulously confessed.

**What is specified:** an out-of-process controller that runs bounded Codex episodes against the repo — schemas, transition matrices (41 allowed / 91 forbidden), protected state, an approval channel, prompt compiler, runner adapter, verification gates, recovery ceremonies — culminating in EL-07, a pilot whose verdict decides whether the hand-maintained `HANDOFF.md` becomes machine-generated.

**What actually exists:** by EL-06 acceptance, 1,161 passing tests across 105 files against 113 mapped requirements; by EL-11 (Session 63), 1,239 tests across 110 files against 116 declared / 116 mapped requirements. The controller was *activated* (Sessions 61–62: ledger seeded, `statusAuthority` migrated to `protected_controller_state`). And yet:

- **No real feature has ever been driven through the loop.** The EL-07 pilot preflight *refused to run* on July 15, 2026 — the roadmap records why with startling candor: "no controller had ever run (`StateStore.open()` had no caller outside tests; no entrypoint or state root existed)… EL-02 through EL-06 built a correct, well-tested, and entirely inert library." That phrase — *entirely inert library* — is the repo grading its own vaporware harder than this paper does.
- **The Codex adapter has never held a conversation.** Its only live exercise: a local smoke that "sent only `initialize` and `initialized`, then disposed with zero thread/turn requests. Model completions = 0."
- **The confession recursed.** EL-10 existed because a status migration "written as prose with no `EL-REQ-*`… and no test that could fail" silently slipped four features. Then EL-11 found EL-10's own two recovery ceremonies "have no non-test caller" — failing EL-10's acceptance as unreachable under the very reachability rule EL-11 introduced. The loop keeps catching itself building inert machinery, writing the catch into normative requirements, and repeating one level up.
- **`HANDOFF.md` remains hand-maintained and authoritative** — stated at the close of virtually every session entry; the EL-03 generated handoff is explicitly "preview" bytes pending an EL-07 adopt verdict that may never come. EL-08 (scheduler/tracker/concurrency) and EL-09 (run-report ingestion) "do not enter implementation automatically."

**Grade: DECLARED — the exemplar.** Status lives in a machine-readable ledger (`npm run el:activate -- status`); prose statuses are labeled "never authority"; every zero-feature fact is stated in the documents a session must read first. **To close:** owner unblock + EL-10 acceptance + the owner-gated paid pilot. Until then, the loop is the most heavily tested piece of software in the repository that has never done its job.

## 5. Dormant seams: config without consumers, quarantine without readers

### 5.1 The dead backend seam (Item 4)

`src/config/index.ts` defines four optional keys — `TRELLIS_RLM_BACKEND` (enum `openai|vllm`), `TRELLIS_RLM_MODEL`, `TRELLIS_RLM_BASE_URL`, `TRELLIS_RLM_API_KEY_ENV` — with cross-field startup refusals (vllm without a base URL throws) and a fail-fast guard against ambient `OPENAI_BASE_URL`. Four separate comments repeat: **"No consumer reads these values yet; T2/T3 wire them."**

The wiring story is a saga in itself. T1 (landing the config) took three sessions and ~$2.68 in paid attempts before landing. T2 (forwarding the values through `buildAgentEnv`) failed **three consecutive paid attempts** ($1.0888, $0.7139, $0.8163 — each a distinct editing-execution failure by the in-house RLM under its own guarded toolkit) and is **PAUSED** pending a tooling increment that is itself paused in HANDOFF Appendix A ("retained for history, do not execute"). T3 and T4 have not started. The model backend remains hardcoded at both `trellis_agent.py` construction sites; worker transport is deferred behind a named prerequisite; the embedder "does not move."

**Grade: DECLARED** — in code, at the exact point of consumption a reader would check. **To close:** the Appendix A `insert_after_anchor` increment, then T2 v3.5, then T3/T4 — or a human just writes the ~200 lines, which the T2 record suggests would have cost less than the attempts to make the machine write them.

### 5.2 Latent quarantine (Item 6)

`UPDATE_DRILL_REPORT.md`, limitation 3, verbatim: "Re-derivation un-contests the *edge*; contested Entity nodes stay contested until the Phase 5 entity-namespace work. **No consumer currently reads node-level `contested`, so this is latent, not live.**" The PHASE_5_PRD confirms node-level trust "becomes derivable instead of latent" only with future kind-tagging. So the substrate writes a trust bit that nothing reads — precisely the shape of gap that becomes dangerous when undisclosed, here neutralized by the repo naming it. **DECLARED. To close:** one consumer (retrieval filter or sweep report) plus the asymmetric un-contest fix.

### 5.3 The paused TTT track (Item 9)

`TEST_TIME_TRAINING.md` opens: "This record roadmaps a research track; it ratifies NO design decision, lands NO machinery, and changes NO runtime byte." The ladder R1–R5 is owner-gated per rung; only R1 (collaborator exchange) and R2a/R2b (zero-paid census and seam design) have executed — both producing documents. R3 (open-weights protocol competence), R4 (paired TTT arms), R5 (meta-prompt fast-state) are unrun; the entire track is explicitly displaced behind the EL program by owner direction. TTT is "impossible on the current API backend by construction — the track exists to make the possibility measurable." **DECLARED**, with pre-registered measurement criteria — research vaporware done about as honestly as it can be done.

## 6. The module registry: capabilities that refuse to load (Item 5)

README pillar 4 sells the "capability flywheel": modules as versioned, provenance-bearing beliefs. The inventory: of four directories in `modules/`, **two can never load**. `src/config/modules.ts` enforces it — `loadModule` throws `"only active modules load"` for anything not `status: "active"`, pinned by `test:modules` [8].

- `estimation-discipline` — `status: "retired"`. This is disclosure with teeth: a 50-run paired control ($2.3981, disclosed) *failed its pooled token criterion*, and the owner retired the module the same day, recording the permanent doctrine: "behavioral failure classes close by TOOLING SHAPE, not prompt modules."
- `reasoning-templates` — `status: "contested"`, `research.sourceNodeIds: []`. Its design record is a spec "NOT sequenced," written document-first; the module directory is a placeholder for something never activated.

The subtle framing gap: the README's capability-flywheel prose does not mention that the prompt-module era it describes effectively *ended* — module authoring is deprioritized ("no new protocol-module authoring turn without explicit owner request"), leaving exactly one research-bearing module (`workspace-discipline` v2) as the flywheel's total lifetime output. The statuses are DECLARED and enforced; the era's obituary is DISCOVERABLE (HANDOFF and roadmap rows, not the README). Net **grade: DECLARED**, with the observation that retirement-by-measurement is the opposite of vaporware — it is a claimed capability that was tested and *demoted*, which almost no research repo does.

## 7. Declared non-features and paper-only surfaces (Items 7, 10, 11, 12)

**The frontend (Item 7).** `src/frontend/` is a real Next.js 16 / React 19 dev app, but its productionization (build, container, key-proxying, CI, Compose proof) has been deferred three times and is "unscheduled"; AGENTS.md's navigation table reads "deferred, don't touch unasked." Scope is preserved verbatim in the roadmap for re-entry. **DECLARED.**

**A2A declines (Item 10).** `CancelTask` is "always declined with `TaskNotCancelableError` (`-32002`) — the goal loop has no abort path; a dispatched goal runs to its bounded end." Push-notification config methods return `-32003`; `ListTasks`/`SubscribeToTask` return `-32004`. These are honest non-features with typed error codes and a zero-paid drill — though the underlying fact (no way to abort a running goal, ever) is a genuine operational gap wearing a protocol-compliance costume. **DECLARED.**

**Trellis-as-MCP-server (Item 11).** `MCP_SERVER_SURFACE.md` is a complete design record — provenance boundary, tool shapes, open decisions O1–O4 — for a surface with zero implementation: "Not yet sequenced; no implementation, drills, or paid runs are claimed here." **DECLARED**, and a clean example of the house "document-first" mold, where the spec-to-code gap is a workflow stage rather than an accident.

**The owner-gated probe queue (Item 12).** The README says the repo-scale context probe "is on the owner-gated queue," but no queue artifact exists; the unrun-probes backlog is distributed across roadmap rows and HANDOFF ledger entries. Reconstructed by grep, it includes at least: the repo-scale paired-run effective-context probe; the Session 25 post-exclusion extraction re-run (printed bound: 103 blocks ≈ $0.29); the Session 29 audit #1 cross-process textedit proof run; the v2 benchmark run; recurring verification sweeps (the entailment sweep ran exactly once, owner-approved, $0.0093 — machinery live, cadence zero); and every EL-07 paid trial. Each is individually declared; the *aggregate* — that the queue's contents outnumber its completions — is nowhere summarized. **DISCOVERABLE.**

## 8. The flagship framing: the giant window that was benchmarked in miniature (Item 8)

The README's second pillar closes with the claim most likely to be quoted: "a giant *effective* context window — working-set size bounded by process memory, not attention (the whole Trellis repository is a 13 MB frame with 16 ms substring queries; **a measured paired-run probe of that claim is on the owner-gated queue**)."

The 13 MB / 16 ms numbers are real — a mechanical micro-benchmark in `CODE_MEDIATED_TEXT.md` §7 (342 files, 74,115 lines loaded into a pandas frame). What has never run is the end-to-end demonstration: an LLM working a repo-scale corpus through the frame, paired against attention. The effective-context probes that *did* run (rounds 1–4: $0.73–$2.15 each, a 105k-token novel, a 102-document relational corpus) support the mechanism at smaller scales — and produced honest negatives along the way (the model never reached for pandas unprompted; a 55 engine-computed count was retyped as 47, catching the transcription channel live).

**Grade: DECLARED — the best single disclosure in the repository**, because the caveat lives *inside the claim's own parenthesis*. A reader cannot quote the flagship sentence without transporting its asterisk. **To close:** one paired-run probe over `repo:trellis`, likely $1–3 at observed rates.

## 9. The disclosure culture, graded

Three mechanisms make Trellis's gap-ledger unusually load-bearing rather than decorative:

1. **Statuses are machine-readable and enforced.** Module statuses live in manifests and the loader *refuses* non-active modules, pinned by tests. EL statuses live in an integrity-linked ledger; the catalog schema now "refuses the drift rather than merely not exercising it." A gap here cannot silently regress into a claim.
2. **Negative results are landed, not lost.** The retired module, the three T2 no-landings with dollar amounts, the failed pilot criterion item 3 root-caused to embedding pollution, the non-reproducing scale reading — each has a permanent ledger entry. The repo spends more prose on its failures than on its successes.
3. **Claims carry their own caveats.** The README's owner-gated-queue parenthesis; the critique's "No paid benchmark run against v2 has been executed"; the code's "No consumer reads these values yet"; the drill report's "latent, not live"; the EL-10 record's "entirely inert library."

Against that background, the $1.12 baseline stands out precisely because it violates all three: it lives in prose only, has no measurement artifact, and is repeated at the highest-visibility surface without its disqualifier. The honest sentence — "we have not run the stateless baseline; $1.12 is our estimate from the task's structure" — appears nowhere, and the critique's "the 26× projected cost advantage… is real" actively launders the projection. One misleading claim in a repository this candid is a paper-cut; but it is a paper-cut on the artery, because the economics *is* the pitch.

## 10. Closing assessment

### (a) Vaporware-to-substance, against the field

Split the repository into three strata:

- **Mechanical substrate (runs, drilled):** the Merkle/Neo4j engine, ingest, invalidation, quarantine sweeps, the RLM sandbox and its gates, the guarded editing toolkit, workspace, promotion, A2A/MCP client surfaces — all exercised by ~1,239 deterministic tests plus zero-paid drills, several validated end-to-end with paid runs (update drill, poisoning drill, provenance A/B, four effective-context rounds, a real repo extraction). This stratum is *not* vaporware by any standard; it is unusually over-verified for a research repo.
- **Empirical evidence base (thin):** the entire paid-experiment corpus of the project totals on the order of **$25** across a few hundred runs — small n, synthetic corpora, one model family, v1 benchmark only. Real, but a much smaller evidentiary footprint than the documentation's mass suggests.
- **Futures ledger (large, gated):** the EL pilot and everything downstream, the v2 run, the backend seam, TTT R3–R5, the MCP server, the frontend residue, node-level quarantine consumers, the reasoning-template library.

Weighted by *lines of machinery*, Trellis is mostly substance. Weighted by *claims a newcomer would carry away* — perfect F1, 26× economics, giant effective context, a system that engineers itself — the flagship story is respectively: measured-on-an-admittedly-soft-corpus, unmeasured, half-measured-and-declared, and not-yet-real. A typical research repository ships the same ratio of unrun futures with none of the fencing: no status enums, no loader refusals, no pre-registered criteria, no dollar-itemized failure ledger. Trellis's vaporware fraction is roughly typical; its *disclosure* fraction is a positive outlier — twelve of fourteen audited items DECLARED, and several (README's in-sentence caveat, "entirely inert library," "latent, not live") are better disclosure practice than most published papers. The verdict: **a candid futures ledger with one laundered number, not vaporware-as-deception.**

### (b) The three unrun experiments that would most change the story

**1. The MIT-baseline head-to-head (~$25).** *Most likely to go against the repo.* Trellis's own telemetry shows a full-corpus classification sweep costs $0.088–$0.88; a stateless agent re-paying that per query implies a true baseline nearer $0.10–$0.90 than $1.12, deflating 26× to perhaps 3–15×. The amortization law survives (O(1) vs O(corpus) per query is structural), but the marquee multiplier probably does not. Running it would convert the repo's one misleading claim into either a defensible number or a retraction — both worth more than the current asterisk-free assertion.

**2. The v2 anti-shortcut benchmark run (~$1–2).** *Most likely to go both ways at once.* The cached-category flywheel should survive intact — classification is unchanged and v2's gold labels are clean by construction — but mention resolution via alias ("the French capital") breaks the free substring scan, so the critique's own prediction of F1 < 1.0 is plausible, with the warm phase newly paying for semantic mention resolution. Expected outcome: the perfect-score headline dies; the *architecture* claim (cache-first delegation beats re-derivation) gets its first evidence that isn't shortcut-contaminated. A sub-1.0 F1 with intact amortization would be a more publishable result than the current 1.000.

**3. The EL-07 pilot (owner-gated, cost TBD).** *Highest variance on the system's identity.* The prior evidence cuts against a first-attempt pass: the T2 saga showed an agent under this repo's own guarded tooling failing a ~170-line insertion three times running, and EL's history is a chain of correct-but-inert machinery catching itself. The likely first verdict is "revise" — gates hold, cost/intervention thresholds miss. But this is the one experiment that changes what Trellis *is*: a pass converts six thousand lines of the best-tested dormant code in the repository into the system's actual product (a self-engineering runtime with a machine-authoritative handoff), while a clean fail would honorably retire the largest single block of declared vaporware. Either outcome collapses the repo's biggest superposition.

*Honorable mention:* the repo-scale paired-run effective-context probe — cheap, pre-declared in the README's flagship sentence, and the only thing standing between the "giant context window" framing and its evidence.

---

*Sources verified in-repo: `README.md`; `HANDOFF.md` (incl. Appendix A); `TRELLIS_ROADMAP.md` §4–§5; `AGENTS.md`; `API_REFERENCE.md` §5; `docs/benchmarks/` (CRITIQUE_AND_FUTURE, FLYWHEEL_EXPLAINER, OOLONG_BENCHMARK_REPORT, UPDATE_DRILL_REPORT, SCALE_PROVENANCE_REPORT, EFFECTIVE_CONTEXT_PROBE_REPORT); `docs/product/BENCHMARK_OOLONG.md`; `docs/product/engineering-loop/ROADMAP.md` + `features.json`; `docs/architecture/` (TEST_TIME_TRAINING, MODEL_BACKEND_SEAM, CODE_MEDIATED_TEXT §7, MCP_SERVER_SURFACE, REASONING_TEMPLATES); `src/config/index.ts`; `src/config/modules.ts`; `modules/*/module.json`; `data/`; `benchmark_results.json`.*
