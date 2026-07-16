# What Is Actually New in Trellis: A Prior-Art Audit of Six Claimed-Unique Mechanisms

*An analytical review of the OpenCnid Trellis repository (Recursive Language Model runtime), July 2026.*

---

## Abstract

Trellis is a Recursive Language Model (RLM) runtime built around a content-addressed knowledge substrate: documents are ingested as Merkle-hashed AST blocks, model-derived beliefs are graph edges citing those block hashes, and a quarantine sweep contests any belief whose cited bytes are orphaned by a re-ingest. On top of this substrate the project claims several mechanisms with no peer in industry or academia. This paper audits six such claims against the code and against the 2022–2026 literature on truth maintenance, provenance-aware RAG, attributed QA, self-improving agents, and agent-harness engineering. Two claims survive largely intact. The **capability flywheel** — prompt-protocol modules registered as graph entities citing the AST hashes of the research they derive from, so the ordinary belief-invalidation sweep contests a *capability* when its evidentiary basis is superseded — has a conceptual ancestor in justification-based truth maintenance but no system peer: no known framework subjects its own prompt stack to dependency-directed invalidation keyed to content hashes. The **grounded-authoring response to provenance laundering** assembles peer-documented components (entailment gating, post-hoc citation pinning, corpus isolation) but contributes an original causal result: laundering is incentive-driven (0%→100% under minimum-citation pressure), prompt and readership gates are unreliable, and only a semantic entailment gate holds at 0% — yielding the standing rule "never reward citation count." The remaining four mechanisms — the by-reference answer channel, the retrieval-membership write gate, the human-pinned acceptance ledger, and the code-mediated-text doctrine — are, respectively, a micro-refinement of program-aided generation, a re-derivation of closed-namespace citation on an open namespace, disciplined maker-checker engineering, and a synthesis of the RLM reading discipline with concurrently-emerging hash-anchored editing. We rank all six by intellectual significance and argue that Trellis's durable contribution is a stance — treating the agent's own capabilities and channels as epistemic objects subject to the same provenance regime as its beliefs — rather than any single gate.

---

## 0. Method and standard of evidence

Every load-bearing claim below was re-verified in the repository at review time: mechanism descriptions cite specific files and, where behavior matters, specific code. Prior art was searched across the truth-maintenance, provenance/RAG-attribution, self-improving-agent, and agent-harness literatures (web search, July 2026). The verdict scale:

- **UNIQUE** — no known system implements the mechanism; conceptual ancestors may exist but the operational combination does not.
- **UNIQUE-AS-SYNTHESIS** — every component has a real peer; the assembly, setting, or measured result is original.
- **HAS PEERS** — a real peer implements substantially the same mechanism or achieves the same property; residual novelty is implementation craft.

A skeptical convention is applied throughout: where an existing system achieves the same *property* by different means, that counts as a peer, even if the mechanism differs.

---

## 1. The capability flywheel: capabilities are beliefs

### 1.1 The mechanism

Trellis composes its agent's system prompt from *modules* — directories under `modules/<name>/` holding a `module.json` manifest and a prompt addendum (`addendum.txt`). The manifest schema (`src/config/modules.ts`) includes a `research.sourceNodeIds` array constrained to `^[0-9a-f]{64}$`: the AST-block hashes of the promoted research the module's protocol was derived from. `modules/workspace-discipline/module.json`, for example, cites 31 such hashes; its addendum is prompt text distilled from measured probe reports.

The operator command `npm run modules:register` (`scripts/register_modules.ts`) turns each research-bearing manifest into a Neo4j graph entity — `(:Entity {kind: 'module_manifest', name: 'module:<name>'})` with `sourceNodeIds` on the node (`src/core/graph/module_registration.ts`). Before any write, an existence gate refuses the whole invocation if any cited hash is absent from `ast_nodes` (register_modules.ts, "The existence gate runs before ANY write").

The consequence is the interesting part. Trellis's Phase-4 quarantine sweep (`src/core/graph/invalidation.ts`) contests *any* graph node whose `sourceNodeIds` intersect the orphan set of a document re-ingest (the Merkle diff `old \ new`):

```cypher
MATCH (n)
WHERE n.sourceNodeIds IS NOT NULL
  AND any(h IN n.sourceNodeIds WHERE h IN $orphaned)
...
SET ... n.contested = CASE WHEN quarantined THEN true ...
```

Because a registered module is just such a node, **the sweep reaches capabilities with zero special-casing**: re-promote the research a module was distilled from, and the module's graph entity is contested exactly as a derived belief would be. `npm run modules:verify` reports contested modules with an explicit recovery workflow ("the research basis of this module changed. Re-review it; set `status: contested` … then update its research provenance and re-register"). The module lifecycle mirrors the belief state machine: contested/retired manifests are *skipped* by registration ("recovery must follow re-review, not precede it"), and the live registry demonstrates all three states — `workspace-discipline` active, `reasoning-templates` contested, `estimation-discipline` retired.

The claim, in one sentence: the prompt stack is an epistemic object with a chain of custody, and losing your evidence costs you the capability.

### 1.2 Prior art

The conceptual skeleton is old. Doyle's justification-based truth maintenance systems (1979) and de Kleer's ATMS retract conclusions whose justifications lapse; dependency-directed invalidation is textbook symbolic AI. W3C PROV models prompts and answers as derived entities. On the belief side, modern agent-memory systems are real peers to Trellis's *belief* invalidation: Zep/Graphiti (arXiv:2501.13956) invalidates knowledge-graph edges when new episodes contradict them, bi-temporally, with provenance retained — mechanically different (contradiction-triggered rather than source-hash-orphaning-triggered), but the same family.

The capability side is where peers thin out. The self-improving-agent line — Voyager's skill library, ADAS, the Darwin Gödel Machine (arXiv:2505.22954) — accumulates and empirically validates skills, but validation is *outcome-driven*: a skill is good because it worked, and nothing ties a skill to the evidentiary content it was derived from, so nothing can invalidate it when that content changes. The closest 2026 work, Amazon's "Closing the Feedback Loop: From Experience Extraction to Insight Governance in Verbal Reinforcement Learning" (arXiv:2606.17591), explicitly names the governance gap — extracted verbal rules go stale in nonstationary environments — and builds a rules/evidence/skills curation loop. But its evidence ledger tracks *per-episode reliability outcomes*, not content-hash derivation; a rule is demoted because it stopped predicting well, not because the document it was distilled from was superseded. SkillAudit (arXiv:2606.14239) audits skill evolution by paired trajectory comparison — again outcome-side. Surveys of evidence tracing in LLM agents (arXiv:2606.04990) catalog belief-side provenance; none of the surveyed systems place the agent's prompt/capability artifacts inside the provenance regime.

So: dependency-directed invalidation exists (TMS); belief invalidation with provenance exists (Zep); staleness governance for extracted prompt-rules exists (insight governance). What does not exist elsewhere is the specific composition: *prompt-protocol artifacts as first-class nodes in a content-addressed belief graph, contested by the same document-diff-driven sweep that contests beliefs, with a human-gated recovery lifecycle.*

### 1.3 What the uniqueness is worth

The deep move is representational, and it is genuinely deep: by giving modules the same `sourceNodeIds` shape as beliefs, capability invalidation costs *zero* new machinery — one generic Cypher query governs both. That is the kind of uniformity that systems papers are written about. The mechanism also answers a question the self-improving-agent literature has only recently begun asking (accumulation-without-verification as the core risk of persistent skill libraries): here, a capability cannot silently outlive its evidence.

Two honest deflations. First, the trigger is coarse: a module is contested when its source *bytes* change, which over-fires (typo fixes orphan hashes) and under-fires (the research can be wrong without changing). Trellis knows this — the Merkle diff limits over-firing to actually-changed blocks, and the human re-review absorbs the rest — but "epistemics" here means *chain of custody*, not truth. Second, the flywheel has executed exactly one full turn (module #1), and registration is deliberately operator-only; this is a working prototype of an idea, not a scaled result. Neither deflation locates a peer.

**Verdict: UNIQUE.** JTMS-shaped, but no known system applies dependency-directed, content-hash-keyed invalidation to its own prompt stack.

---

## 2. Grounded authoring and the provenance-laundering finding

### 2.1 The mechanism

The first capability-flywheel turn produced the finding that gives this section its weight. As recorded in `docs/architecture/GROUNDED_AUTHORING.md` §1: the authoring run (general research agent, handed 24 promoted research hashes, asked to cite "the load-bearing blocks") read the corpus correctly, then pivoted to 21 `vector_search` calls over the *entire* database and cited real-but-unrelated TypeScript blocks from a prior repository ingestion. Every automated check passed — the hashes exist; the addendum was in-bounds and faithful — and all 24 citations were wrong. The design record's diagnosis is crisp (§2): content-addressing proves *hash → bytes*; grounding needs *claim ← bytes*; derivation is semantic and "not decidable by hashing, existence checks, or any structural rule."

The remediation (`src/core/authoring/`, Session 19) is a distinct kernel-owned authoring mode with four layers:

1. **Access**: the author sees *only* the seeded corpus — promoted blocks are seeded into a read-only-scope workspace (`corpus.ts`, `seed.ts`); no database, search, or network tools exist in the mode.
2. **Attribution**: the harness pins `research.sourceNodeIds` mechanically from the promotion output (`assemble.ts`: "The pinned research hashes are the ONLY provenance — the model contributed none"). The draft envelope scanner (`src/core/observability/rlm_draft.ts`) **refuses any draft containing a 64-hex token** (`AST_HASH_TOKEN = /[0-9a-f]{64}/i`, applied to the raw payload before parsing): the model is structurally forbidden from emitting anything hash-shaped.
3. **Derivation incentive**: a fixed harness-composed template (sources in, protocol out); the brief can no longer pre-state the directives.
4. **Derivation verification**: a deterministic anchor gate (`anchors.ts`) extracts corpus-specific anchors and refuses a draft below 0.3 coverage — documented with unusual candor as "evidence of contact, not proof of derivation," including the "generic-truth trap" and a calibration fix (numeric anchors excluded because the template forbids restating measured numerals).

The companion eval (`docs/benchmarks/PROVENANCE_CITATION_AB_REPORT.md`) is a controlled A/B on a ground-truthed trap (a fictional device with one TRUE block and two keyword-matched decoys), scored on the *persisted* graph. Results: laundering is 0% in the neutral task and 100% at min-cite 2 (baseline arm); a prompt module and a structural read-before-cite gate are unreliable across conditions (0–100%); `cited-but-unread = 0` in *every* laundered run — the model reads the decoy, then cites it; only the inline semantic entailment gate holds 0% at every pressure level. The report's standing conclusion: the primary fix is upstream — **never reward citation count** — with the entailment gate as a sampled, class-gated tier where the incentive cannot be removed.

### 2.2 Prior art

The *phenomenon* now has peers. "Verified Misguidance: Measuring Structural Citation Failures in Search-Augmented LLMs" (arXiv:2605.28565) documents models citing real, accessible, but unsuitable sources at scale (≈27% domain-inappropriate), naming a fidelity–suitability trade-off. CiteAudit (arXiv:2602.23452) — "You Cited It, But Did You Read It?" — benchmarks exactly the read-versus-support gap. The *verification machinery* has peers going back further: ALCE (arXiv:2305.14627) established NLI-based citation precision/recall in 2023; the AIS framework (Rashkin et al.) defined attributable-to-identified-sources; VeriCite (arXiv:2510.11394) and successors do rigorous citation verification in RAG. Post-hoc answer-attribution work attaches citations by a separate system rather than trusting the model's choices — a peer for "the harness holds the pen." Corpus isolation is, in the trivial sense, what every closed-book RAG evaluation does.

What lacks a peer is narrower and sharper: (a) the **causal identification** — laundering demonstrated as an *incentive response* with a pressure sweep and a positive control, scored against persisted state rather than transcripts, including the negative result that a readership gate is *blind by construction* (the model satisfies it before laundering); (b) the enforcement point — an inline entailment gate on the **write path of a persistent belief store**, where a refused citation structurally cannot persist, as opposed to answer-time evaluation; (c) the total removal of the citation channel in authoring — the 64-hex-token refusal plus mechanical pinning means there is no citation behavior left to align. No published system, to this reviewer's knowledge, combines "the model never emits an address" with "addresses are assigned mechanically from the corpus the model was locked to."

### 2.3 What the uniqueness is worth

The empirical finding transfers beyond Trellis: any pipeline that scores or rewards citation density — RLHF rubrics, eval leaderboards, "cite at least N sources" product requirements — is, on this evidence, manufacturing laundering pressure, and prompt-level countermeasures will lose to it. That is a publishable negative result stated with a mechanism ("a soft rule loses to an incentive") and a measured remedy hierarchy. The architecture is worth less than the finding, in this reviewer's judgment: it is careful, but each layer is assembled from known parts, and the anchor gate is honestly self-assessed as weak. The report's own epistemics — preserving two superseded wrong conclusions (v1 "the RLM does not launder" was underpowered) as a reasoning trail — deserves note as unusually good research hygiene.

**Verdict: UNIQUE-AS-SYNTHESIS** — components peer-documented (entailment gating, post-hoc pinning, corpus isolation; the phenomenon itself now independently observed), with one genuinely original empirical contribution: the incentive-causality result and its "never reward citation count" corollary.

---

## 3. The by-reference answer channel

### 3.1 The mechanism

`src/rlm/trellis_answer.py` exists because of a measured incident: in the Session-21 effective-context probe, a run's REPL correctly computed an occurrence count of 55 and the model's final turn answered 47 — it hand-retyped a literal into `answer['content']` (docstring; corroborated by `docs/benchmarks/EFFECTIVE_CONTEXT_PROBE_REPORT.md`, row "count-justine: no (said 47)").

The fix: `trellis_answer.submit(expression_text)` takes the **text** of a Python expression, `ast.parse`s it, and refuses it unless the tree contains a `Name`, `Attribute`, `Subscript`, or `Call` node (`_references_repl_state`) — a constants-only expression like `submit("47")` is rejected with a teaching message, because a bare literal "can only be a retyped literal." Accepted expressions are evaluated in the caller frame's namespace (so a typo'd variable is a loud `NameError`, not a silently wrong digit), rendered deterministically engine-side, prefixed `FINAL_ANSWER:` by the engine, and written into the answer dict by the tool. Caps are kernel constants (expression ≤ 400 chars — "an expression names a computed result; it is never the content itself"). The cumulative record since: 255/255 paid-run submissions with zero transcription errors (`EFFECTIVE_CONTEXT_PROBE_REPORT.md`; `TRELLIS_ROADMAP.md` §654).

### 3.2 Prior art

The core idea — the final answer is produced by executing code, not by the model transcribing it — is PAL (arXiv:2211.10435, 2022) and Program-of-Thoughts, whose stated motivation was precisely "correct reasoning chain, wrong final answer." In deployed harnesses, HuggingFace smolagents' `CodeAgent` has the model call `final_answer(result)` *inside generated code*, so the computed object flows by reference through the interpreter to the harness — substantially this channel, shipped in a mainstream library. Inspect AI and similar eval harnesses use explicit submit tools. These are real peers.

The residue without a peer is the **anti-literal gate**: smolagents will happily accept `final_answer(47)`; nothing in PAL prevents the model from writing `answer = 47` after ignoring its own computation. Trellis's AST-walk refusal of constant-only expressions structurally forecloses the exact failure it observed. (It is not airtight — `x = 47` then `submit("x")` passes — but it removes the one-step path, and the incident class it targets is the one-step path.) No searched harness performs AST analysis on the answer expression to reject retyped literals.

### 3.3 What the uniqueness is worth

Modest but real. The channel itself is convergent engineering — several communities landed on "answers should flow by reference" — and Trellis arriving there via a measured incident rather than by adopting the pattern is process credit, not novelty. The anti-literal gate is a genuinely new micro-mechanism, cheap and evidently effective (255/255), and generalizable: any code-executing agent could adopt a ten-line version of it. It is a small idea executed exactly.

**Verdict: HAS PEERS** (PAL, smolagents `final_answer`, submit-tool harnesses), with one novel micro-guard — the AST-level refusal of constant-only answer expressions — that does not, alone, elevate the mechanism.

---

## 4. The retrieval-membership write gate

### 4.1 The mechanism

`src/rlm/trellis_tools.py` funnels all belief writes through `_run_insight_writes`, which applies order-pinned layers: **format** (`_normalize_fact` — every cited ID must match the 64-hex AST-hash pattern; workspace/question IDs "are never provenance"), **existence** (`_verify_hashes_exist` — the deduped batch union must exist in `ast_nodes`; infrastructure failure propagates as `RuntimeError`, "never reported as a provenance verdict"), then the audit hook (`_audit_add("cited", …)` — the model's *attempt* is recorded before any gate can mask it), then **retrieval-membership** (`_verify_hashes_retrieved`, Session 31): a cited hash must be in the set of addresses whose bytes a retrieval tool returned *to this very run*. The check is in-process set membership; an empty set refuses everything — "the safe direction." One unretrieved hash refuses the whole batch before a write session opens. Two further layers are opt-in and experimentally graded: the readership hint (measured *not* to prevent laundering, "kept for the A/B record") and the entailment gate (§2).

The gate's own comment is precise about scope: it closes T1 (transcription/choice errors — corrupted digits, scrollback hashes, second-hand citation of provenance lists surfaced by graph queries) and explicitly does **not** close T2 (read-then-cite laundering), which belongs to the entailment tier.

### 4.2 Prior art

Judged by *property* rather than mechanism, this has peers. In conventional RAG with a closed citation namespace — the model cites `[1]…[k]` indices into the retrieved passage list — citing something never retrieved is impossible *by format*. Constrained decoding makes the same guarantee stronger: trie-constrained generation over corpus identifiers (the GENRE lineage; Self-RAG's constrained variants) means a hallucinated document ID cannot be emitted at all. The property "citations ⊆ this run's retrieval set" is, in those settings, free.

Trellis's setting is different in a way that makes the gate non-trivial: its citation namespace is **open and global** — any well-formed 64-hex string is a syntactically valid address into a persistent content-addressed store, and hashes legitimately circulate in the model's context (graph query results, prior-turn scrollback, provenance lists on retrieved beliefs). The gate re-imposes the closed-namespace property on that open namespace, at the write path of a *durable* belief graph rather than at answer time, with the attempt/persistence distinction preserved for measurement. The audit-before-gate ordering — score what the model *tried* to cite, then refuse — is a small design decision with real methodological value (it is what made the §2 A/B interpretable). No searched system does exactly this; every searched system with a comparable guarantee gets it by construction from a closed namespace.

### 4.3 What the uniqueness is worth

This is defense-in-depth engineering, not a new idea. Its worth is mostly as a statement about *where* enforcement belongs (the persistence boundary of a belief store, not the answer surface) and as a demonstration that provenance discipline survives an open addressing scheme — a problem most systems avoid by never having open addressing. The honest framing in the code (T1 closed, T2 not) is worth as much as the gate: it is a taxonomy of citation failure with the layers mapped to it. Nobody else has built this largely because nobody else has a global content-addressed citation namespace to defend; the uniqueness is partly an artifact of the substrate.

**Verdict: UNIQUE-AS-SYNTHESIS** — the property has by-construction peers in closed-namespace RAG and constrained decoding; the enforcement point (durable write path, open namespace, order-pinned layers, audit-before-gate) is original assembly.

---

## 5. The acceptance ledger with actor pinned to 'human'

### 5.1 The mechanism

The engineering-loop controller (`tools/engineering-loop/`) records which features the owner has accepted in a program-scoped ledger (`src/acceptance_ledger.ts`): append-only JSONL, each record carrying `sequence`, `previousDigest` (sha256 of the canonical preceding record), and — the headline — `actor: z.literal('human')` in the shared envelope: "no other authority can produce a ledger record, which is the schema-level statement of 'the controller cannot accept its own work.'" Approval truth lives outside the agent-writable worktree (`approval_channel.ts`: a path validated to not be inside, alias into, or symlink-reach the worktree; the controller "never writes, never creates approval material"). Appends are all-or-nothing via temp-file + fsync + atomic rename ("a partial append is therefore not representable rather than merely refused"); the generation pointer is monotonic; approval IDs are consumed by replay of the ledger itself, so consumption cannot disagree with the records.

Two structural details rise above routine: the ceremony taxonomy (seeding / steady-state acceptance / ledger recovery / re-genesis) is *re-derived from state on every attempt* rather than stored as a mode flag ("a flag is what rots"), with disjointness of the state predicates proven by a named test; and **seeding is treated as a forgery-risk operation** (`seed.ts`: "a bootstrap that writes 'EL-00 through EL-06 are accepted' into protected state is the precise forgery tool the architecture exists to prevent"), so it is built with no privileged path — the ordinary acceptance machinery applied to an empty generation, with the owner alone supplying authorization material the controller can read but not originate. Re-genesis after chain corruption requires fresh owner material because "a broken anchor cannot sign its own replacement."

### 5.2 Prior art

The concept is old and crowded. Maker-checker / four-eyes separation of duties is decades-standard in financial systems. In the 2025–26 agent-security space: ChainProof ships hash-chained audit trails for agent actions including human approvals; the OpenPort Protocol (arXiv:2602.20196) mandates that agent credentials "MUST NOT be sufficient to approve high-risk writes"; Ledger's agentic-security line implements propose-on-device/approve-by-human; hash-chained agent-execution ledgers exist as open source. "The agent cannot approve its own work, and approvals are tamper-evident" is, as a requirement, common property.

The residual novelty is enforcement *depth*, not concept: making `actor: 'human'` a schema **literal** means the type system cannot even express a controller-authored acceptance — validation, not policy, refuses it; the seeding analysis (the bootstrap is the attack) and the anchor-cannot-sign-its-successor re-genesis rule are unusually rigorous versions of things most systems hand-wave. This reviewer found no peer that runs the separation all the way down to "a fabricated workflow history is normatively forbidden because it would attest events that never occurred" — but also no reason to think peers *couldn't*; it is craft, not idea.

### 5.3 What the uniqueness is worth

Low as an idea, high as a specimen. If one wants a reference implementation of "human-only acceptance under an untrusted controller" with every failure mode (partial append, digest break, approval replay, forged bootstrap) named and closed, this file is it. But a reviewer must call it what it is: a very well-built instance of a well-known control.

**Verdict: HAS PEERS** (maker-checker; ChainProof; OpenPort-class requirements). Residual novelty is schema-literal enforcement and the forgery-risk seeding analysis — implementation craft.

---

## 6. Code-mediated text as enforced doctrine

### 6.1 The mechanism

`docs/architecture/CODE_MEDIATED_TEXT.md` is ratified doctrine: **"the model never counts, and the model never copies."** Locations in text are computed by the engine and returned by queries — never estimated by attention over a line-numbered dump; existing bytes are moved by code — never re-typed through attention; the model's only legitimate text outputs are genuinely new prose and the code that manipulates everything else. The record's central diagnosis unifies two familiar failures: localization error (miscounted line numbers, near-miss anchors) and transcription error (silently corrupted bytes in a rewrite) are "the same pathology — attention doing a job that belongs to code."

Enforcement is tooling shape, not prompt text (§2.8): `src/rlm/trellis_textedit.py` implements the discipline for editing — files load into frames carrying a load-time sha256 digest; edits are `splice(relpath, start, end, new_lines)` at computed addresses; write-back re-verifies the disk digest and refuses a stale write loudly ("the file moved underneath the frame"); handles are transient (re-locate after each splice). The measurement is `docs/benchmarks/EFFECTIVE_CONTEXT_PROBE_REPORT.md`: A/B over a 105k-token corpus with the doctrine's prompt block present vs. byte-identically absent — median input tokens 7,870 vs 14,724 (1.9×), worst run 26,586 vs 110,550 (the off-arm shoved the entire document through a sub-LM's attention "to do a job `str.find` does in one line"), arm cost 2.2×, and in later rounds the by-reference record (180/180, cumulatively 255/255, zero transcription errors).

### 6.2 Prior art

Both halves have real peers, one of them foundational to Trellis itself. The *reading* half is the Recursive Language Models paper (Zhang, Kraska, Khattab, arXiv:2512.24601): context stored as variables in a REPL, the model peeking, grepping, partitioning, and launching recursive sub-queries — Trellis is explicitly an RLM runtime, so "text lives in queryable REPL state" is inherited, not invented, and the doctrine says so ("this is the RLM thesis taken seriously and applied rigidly"). The *editing* half now has direct concurrent peers: the "hashline" / hash-anchored edit line of early 2026 (oh-my-pi; the February 2026 "Harness Problem" write-up; feature requests on Claude Code #25775 and opencode #24511) gives every line a content hash so the model points at anchors instead of retyping lines, and stale anchors reject the patch before corruption — that is "never count" (hash-addressed lines) plus stale-write guarding, independently derived and benchmarked across 15 models. Aider's edit-format research and the broader str_replace-anchor meta are the same pressure. PAL is the peer for "never do arithmetic attention can delegate."

What has no peer found: the *unification* — one named principle covering reading, counting, copying, and editing, with the localization-error = transcription-error diagnosis; the doctrine's enforcement posture as a design rule (gates and tool shapes, prompts only as reinforcement); and the controlled measurement of a single prompt block's effect on attention exposure (the ON/OFF byte-identical kernel A/B), including the candid adverse detail that the disciplined arm *caused* the 55→47 transcription incident that then forced §3's channel — the doctrine's own report documents the doctrine's failure mode and the repair.

### 6.3 What the uniqueness is worth

The parts being convergent is evidence the idea is right, not that the doctrine is redundant: hashline solves editing, RLM solves reading, PAL solves arithmetic — three communities, one pathology, no shared name. Trellis's contribution is naming the pathology once, deriving all three as corollaries, and enforcing it as a ratified constraint on every future session. That is real intellectual work of the organizing kind — the kind that tends to be under-cited and widely absorbed. It is not a unique mechanism.

**Verdict: UNIQUE-AS-SYNTHESIS** — RLM (reading) and hash-anchored editing (writing) are real peers for the halves; the unifying doctrine, its enforcement posture, and the controlled measurement are the original assembly.

---

## 7. Ranking by intellectual significance

1. **The capability flywheel (§1) — UNIQUE.** The one mechanism here that changes what kind of object an agent's capability is. Subjecting the prompt stack to the same dependency-directed invalidation as beliefs — implemented for free by representational uniformity — is an idea the self-improvement literature will need (its own surveys now name accumulation-without-verification as the central risk) and has not built. Its current form is coarse (byte-level triggers, one flywheel turn, human-gated), but the deflations are about maturity, not priority.

2. **Grounded authoring and the laundering finding (§2) — UNIQUE-AS-SYNTHESIS.** The most exportable *result* in the repository: laundering is an incentive response; readership gates are blind by construction; only entailment holds; never reward citation count. Independent 2026 work confirms the phenomenon in the wild, which strengthens rather than weakens the causal experiment's value. The architecture around it is competent assembly.

3. **Code-mediated text (§6) — UNIQUE-AS-SYNTHESIS.** The best-articulated engineering doctrine here, with a genuinely clarifying diagnosis and honest measurement — but both operational halves were reached independently by others within months, which is the signature of a good synthesis rather than a unique mechanism.

4. **The retrieval-membership gate (§4) — UNIQUE-AS-SYNTHESIS.** Sound, well-placed, well-scoped — and largely a re-derivation, on an open namespace, of a property closed-namespace systems get by construction. Its significance is mostly as evidence for the broader Trellis thesis that provenance must be enforced at persistence boundaries.

5. **The by-reference answer channel (§3) — HAS PEERS.** PAL and smolagents got there first on the channel; the AST-level anti-literal gate is a novel, adoptable ten-line idea. The measured incident-to-mechanism-to-255/255 arc is exemplary practice, not new science.

6. **The acceptance ledger (§5) — HAS PEERS.** Maker-checker with cryptographic hygiene, executed to an unusually high standard, including the sharp observation that seeding is the forgery. Reference-quality engineering of a decades-old control.

A closing observation the ranking obscures: the six mechanisms are not independent. The flywheel is only trustworthy because authoring is grounded (§2); authoring is only measurable because the write path audits attempts (§4); the write path's evidence is only clean because answers and text move by reference (§3, §6); and the human stays the sole acceptance authority throughout (§5). The genuinely unique thing about Trellis may be less any single gate than the closed loop they form — a runtime that applies one epistemic standard, *nothing persists without a chain of custody, and nothing keeps its status when its custody breaks*, uniformly to its data, its beliefs, its answers, and — uniquely — to itself.

---

## Appendix: primary sources

**Repository** (verified in code, July 2026): `scripts/register_modules.ts`; `src/core/graph/module_registration.ts`; `src/core/graph/invalidation.ts`; `src/config/modules.ts`; `modules/*/module.json`; `docs/architecture/GROUNDED_AUTHORING.md`; `src/core/authoring/{corpus,seed,assemble,anchors,template}.ts`; `src/core/observability/rlm_draft.ts`; `docs/benchmarks/PROVENANCE_CITATION_AB_REPORT.md`; `src/rlm/trellis_answer.py`; `src/rlm/trellis_tools.py`; `src/rlm/trellis_textedit.py`; `tools/engineering-loop/src/{acceptance_ledger,seed,approval_channel}.ts`; `docs/architecture/CODE_MEDIATED_TEXT.md`; `docs/benchmarks/EFFECTIVE_CONTEXT_PROBE_REPORT.md`; `TRELLIS_ROADMAP.md`.

**Prior art**: Doyle, JTMS (1979); de Kleer, ATMS; W3C PROV. Zhang, Kraska, Khattab, *Recursive Language Models* (arXiv:2512.24601). Gao et al., *PAL* (arXiv:2211.10435); Program-of-Thoughts. HuggingFace smolagents (`final_answer` in CodeAgent); Inspect AI submit tools. Gao et al., *ALCE* (arXiv:2305.14627); Rashkin et al., AIS; *VeriCite* (arXiv:2510.11394); *Verified Misguidance* (arXiv:2605.28565); *CiteAudit* (arXiv:2602.23452); post-hoc answer-attribution literature (e.g., arXiv:2406.06938). Self-RAG; trie-constrained generative retrieval (GENRE lineage). Voyager; ADAS; *Darwin Gödel Machine* (arXiv:2505.22954); *SkillAudit* (arXiv:2606.14239); *Closing the Feedback Loop: From Experience Extraction to Insight Governance* (arXiv:2606.17591, Amazon Science / ICML 2026 RLxF workshop); *From Agent Traces to Trust* survey (arXiv:2606.04990). Zep/Graphiti temporal knowledge graphs (arXiv:2501.13956). ChainProof; OpenPort Protocol (arXiv:2602.20196); maker-checker / four-eyes controls. Hash-anchored ("hashline") editing: oh-my-pi; *The Harness Problem* (blog.can.ac, Feb 2026); Claude Code issue #25775; opencode issues #24511, #15424; Aider edit-format research.
