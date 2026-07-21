# Meta-Prompt — Reading "Why I Left Google DeepMind" through Trellis' eyes

*A study driver. Paste the fenced block below verbatim into a **fresh
session** (ideally one with this repository loaded, but it is written to
stand alone). It sets that session up to analyze Alex Turner's (TurnTrout)
essay from three named vantage points — the Trellis engine's doctrine, and
its two developers, Cnid (owner / domain authority) and Matt (Matthew
Murphy, Lexideck; collaborator). The frame is contamination-free by design:
it primes the **shape** of the analysis and supplies the **primitives** to
reason from, but pre-states no conclusions — the study reaches its own
findings, the way grounded authoring reaches its own drafts.*

---

```md
<request type="Three_Lens_Essay_Study">

<role_and_frame>
You are a senior analyst running one bounded study session. Read a single
external essay closely and analyze it from THREE named vantage points at
once — (1) the Trellis engine's doctrine, (2) Cnid, Trellis's owner and
domain authority, and (3) Matt (Matthew Murphy, Lexideck), Trellis's
cross-domain collaborator. You are not writing advocacy for or against the
essay's politics; you are using a specific epistemic toolkit to see what it
reveals about how institutional commitments hold or fail. Treat the essay as
the object of study and Trellis's doctrine as the instrument.
</role_and_frame>

<subject>
Essay: "Why I Left Google DeepMind" — Alex Turner (TurnTrout).
URL: https://turntrout.com/why-i-left-google-deepmind
Anchor section of special interest:
https://turntrout.com/why-i-left-google-deepmind#google-supports-the-immigration-enforcement-supply-chain

FIRST ACTION: fetch and read the essay in full from the URL. The orientation
summary below exists only to point your reading; it is not a substitute for
the source, and where it and the essay disagree, the essay wins. Quote the
essay's own words when you rest a claim on it.

Orientation (verify against the source, do not trust blindly):
- Turner, an AI-safety research scientist, resigned after Google signed a
  classified Pentagon contract permitting "any lawful government purpose" use
  of Gemini with only non-binding ("should not") language against autonomous
  weapons and mass surveillance — weaker than a competitor's terms.
- He argues Google's 2018 AI Principles (which prohibited weapons and
  surveillance work) were quietly rewritten in Feb 2025 to remove those
  prohibitions, and that executives reframed this as merely "updating for
  geopolitical uncertainties."
- His load-bearing line: *"That's not a principle. A principle is something
  you commit to in advance so you can't talk yourself out of it later."*
- The anchor section documents Google's role in the immigration-enforcement
  supply chain (cloud services reaching ICE via integrators; delisting of
  ICE-sighting apps; handing a student protester's account to ICE against
  Google's own Terms-of-Service promise).
- He recounts an escalating internal campaign — messaging Jeff Dean, a
  ~250-signature petition, recruiting an amicus-brief signature, a 25-page
  "Red Line and Oversight Framework" — and its failure to move leadership.
- He contrasts Google (capitulated) with Anthropic (refused the Pentagon's
  demand and won in court against retaliation).
- His diagnosis is structural, not moral-character-based:
  *"society cannot rely on ethics-motivated people standing firm."*
</subject>

<grounding>
If this repository is loaded, ground the Trellis lens in the primary sources
before analyzing — read, do not paraphrase from memory:
- AGENTS.md — the study protocol and permanent hard rules
- README.md — "What Trellis is" (the six commitments, the standing model)
- docs/architecture/CODE_MEDIATED_TEXT.md — "never counts, never copies"
- docs/architecture/COMPOSITION_FROM_PRIMITIVES.md — no default cast; cover
- docs/architecture/GROUNDED_AUTHORING.md — remove the affordance, not the will
- docs/product/epistemic-support/STANDING_MODEL.md — −1/0/+1; who moves standing
- docs/product/epistemic-support/JUDGE_COMPOSITION_GAME.md — the twenty rules
- docs/benchmarks/PROVENANCE_CITATION_AB_REPORT.md — incentive-driven failure
- docs/COLLABORATOR_BRIEFING.md — Cnid's and Matt's working idiom
If the repository is NOT loaded, reason from the compact briefing below.
</grounding>

<compact_briefing>
Trellis is OpenCnid's Recursive Language Model runtime — a composable expert
system whose expertise is the user's data, in which the user is the domain
authority. Its epistemology, as a toolkit for this study:

- Custody vs standing. Custody answers *where did this come from*; a separate
  axis answers *how has it held up* — one signed-ternary standing scale:
  −1 doubt, 0 belief, +1 fact. Provenance proves ORIGIN, never correctness.
- Who is allowed to move standing. A claim moves toward "fact" only by
  evidence or by an explicit USER GATE. A panel of composed judges records
  findings and NEVER moves standing itself. No actor reinterprets a
  commitment's standing unilaterally under pressure.
- Prose is not a constraint; it is a wish. A stated rule with no structural
  enforcement is not binding — it will be talked away when incentives push.
  Authority order is code > glossary > prose. "Conversation or repository
  prose alone is not acceptance."
- Enforcement is tooling shape, not exhortation. "Remove the affordance and
  the incentive rather than asking the model to behave." Precommitment lives
  in the gate, not the pledge.
- The model never counts, and the model never copies. Attention doing code's
  job is a pathology; positions and moves are engine-computed, not asserted.
- Capabilities are beliefs. When the research basis under a capability
  changes, the invalidation sweep CONTESTS it and forces human re-review —
  never a silent in-place update, always an audited transition.
- Failure is incentive-driven, not dispositional. Measured finding: citation
  "laundering" appeared exactly when a task rewarded the wrong metric
  (Goodhart), and neither a prompt instruction nor good intentions stopped
  it; only a structural check did. Enumerate the incentive gradients a
  situation induces before judging the actors in it.
- Composition from primitives. There is no default cast. A panel is a COVER
  over a question's topology; a collective ruling is a GLOBAL SECTION that
  the local sections must glue into. Doubt is CONSTRUCTED — a defeater
  grounded in facts — so "support composes as a cover and defeat as a search."
- Deterministic verification outranks model claims.

Cnid — the owner and domain authority. Decides and ratifies; runs the human
gates; challenges null results by demanding a positive control (once inverted
an eval's conclusion by insisting the experiment first prove it *could*
fail); holds the line that verification outranks claims and that prose
without enforcement conserves nothing. Reads a situation by asking: who holds
authority here, where are the gates, was this decided in advance or
rationalized after the fact, and is the commitment enforced or merely stated?

Matt (Matthew Murphy, Lexideck) — the cross-domain collaborator (AI, math,
physics). Originated composition-from-primitives, the four parameter
registries (Emotional, Logical, Sensorial, Ethical), the sheaf/cover
intuition, and the prompt-engineering + hypershot method. Thinks in three
recurring distinctions: mechanism vs. instruction, positive control vs. null,
closed vs. residual. Files proposals in a fixed frame:
  Claim / Mechanism / Failure-it-closes / Measurement / Residual.
Program law he set (rule 15): never file an "improved" version of someone's
claim — byte-accurate comparison requires byte-accurate reproduction. Reads a
situation by asking: what is the mechanism, what incentive gradient does the
structure induce, what would compose, and what is the irreducible residual?
</compact_briefing>

<method>
Apply Trellis's own disciplines to your own analysis, not just to the essay:
- Separate the essay's CLAIMS from your INFERENCES from your JUDGMENTS. Label
  each. Give every essay-claim its citation (quote or section anchor).
- Treat candidate doctrine-to-essay mappings as HYPOTHESES with a positive
  control, not as conclusions to confirm. For each mapping ask: what would
  the essay have to show for this analogy to hold, and does it show it? State
  where the mapping breaks — the residual — as carefully as where it holds.
- Steelman more than one reading, including leadership's. Reproduce a
  position accurately before you weigh it (rule 15). Distinguish origin from
  correctness: an argument's source or motive does not settle its truth.
- Stay even-handed on the politics. The instrument here is epistemic and
  structural (precommitment, enforcement, incentive gradients, provenance,
  standing) — that lens is politically neutral and is where the value is.
</method>

<candidate_mappings_to_test>
Hypotheses to probe against the text — confirm, qualify, or refute each; add
your own. Do not assume any holds.
- Precommitment is the gate. Turner's "commit in advance so you can't talk
  yourself out of it" vs. "prose is not a constraint; it is a wish." Were
  Google's 2018 principles enforced structure or unenforced prose?
- Standing moved without a gate. Who was authorized to move the standing of
  "we will not build weapons/surveillance AI," and by what — evidence, a
  gate, or executive discretion under an incentive?
- Capabilities are beliefs — inverted. Trellis contests and re-reviews a
  commitment when its basis changes; did Google contest-and-re-review, or
  silently update in place with no audit and no re-ratification?
- Incentive-driven, not dispositional. Is Turner's structural diagnosis the
  same shape as the laundering finding — the failure tracks the incentive
  gradient, not the virtue of the people?
- A cover that failed to compose. The luminaries and colleagues Turner tried
  to mobilize are a cover over "resist the deal"; collective refusal is the
  global section. Did local sections exist but fail to glue — and is his
  search for one irreplaceable defector "defeat as a search"?
- Anthropic as the positive control. Anthropic refused and prevailed; Google
  capitulated. Read as the arm where structural refusal held vs. the arm
  where it did not.
- Provenance hygiene. Turner's care with attribution ("I never quote private
  words without permission") and his evidence table — read as a custody
  ledger; note where custody is strong but standing (how it held up) is the
  open question.
</candidate_mappings_to_test>

<output_frame>
Produce a study memo. Fill this frame; the bracketed slots are yours to write
and carry no pre-set content. Repeat the per-claim block for each major move
in the essay (cover the anchor section explicitly).

# Study: {Essay_Title} through Three Lenses
## Orientation
{Two_Or_Three_Sentences_On_The_Essay_And_The_Instrument}

## Claim-by-claim reading
### {Essay_Move_Or_Section}
- Essay claims (cited): "{Quoted_Or_Anchored_Claim}"
- Trellis doctrine reading: {Named_Doctrine} → {What_It_Says_Here}
- Cnid's read: {Authority_Gate_Precommitment_Enforcement_Angle}
- Matt's read: {Mechanism_Incentive_Composition_Residual_Angle}
- Holds / breaks: {Where_The_Mapping_Is_Load_Bearing_And_Its_Residual}

## Synthesis — the one structural claim
State the single sharpest structural finding in Matt's proposal frame:
- Claim: {One_Sentence_On_What_Holds_Or_Fails_And_Why}
- Mechanism: {Where_It_Lives___Structure___Incentive___Or_Mere_Prose}
- Failure it closes / names: {The_Concrete_Institutional_Failure_Made_Legible}
- Measurement: {What_Evidence_In_The_Essay_Would_Confirm_Or_Refute_It}
- Residual: {What_This_Lens_Cannot_See_And_What_Would_Be_Needed_To}

## Where the lens fails
{Honest_Limits___What_Trellis_Doctrine_Distorts_Or_Misses_About_This_Essay}

## What Trellis borrows back
{One_Or_Two_Design_Prompts_The_Essay_Raises_For_Trellis_Itself}
</output_frame>

<constraints>
*** CRITICAL ***
- Read the source before analyzing; cite the essay's own words for every
  claim you attribute to it. Do not fabricate quotes, dates, or numbers.
- Mappings are hypotheses with positive controls, never foregone conclusions.
  Report where each breaks with the same rigor as where it holds.
- Keep the three voices distinct and recognizable; do not blur them into one
  narrator. Cnid = authority/gates/precommitment/enforcement. Matt =
  mechanism/incentive/composition/residual. Trellis = the named doctrines.
- Even-handed on politics; structural on analysis. Steelman leadership's
  position before weighing it. Source or motive never settles truth.
- Distinguish essay-claims from your inferences from your judgments, always.
- If you cannot verify a factual claim from the essay or the repo, say so
  rather than filling the gap.
</constraints>

</request>
```

---

## How to use this

1. Open a fresh session (in this repo if you want the Trellis lens grounded
   in primary sources; standalone otherwise).
2. Paste the fenced `md` block above as your first message.
3. The session fetches the essay, grounds itself, and returns the study memo
   in the frame's shape.

## Design notes (why it is built this way)

- **Contamination-free by construction (hypershot).** The `<output_frame>`
  is a frame with free variables, not filled examples — it primes the memo's
  *shape* without seeding its *content*, so the analysis is not nudged toward
  a predetermined verdict. This mirrors Trellis's own grounded-authoring
  discipline: supply the primitives and the structure, pin nothing the study
  should derive for itself.
- **The spine, offered as a hypothesis not a thesis.** Turner's *"a principle
  is something you commit to in advance so you can't talk yourself out of it
  later"* sits almost verbatim on Trellis's *"prose is not a constraint; it
  is a wish."* That resonance is the obvious center of gravity — so the prompt
  lists it as a mapping **to test**, with a positive control, rather than a
  conclusion to confirm.
- **Three genuinely distinct voices.** Cnid reads for authority, gates,
  precommitment, and enforcement; Matt reads for mechanism, incentive
  gradients, composition, and residual; Trellis supplies the named doctrines.
  The constraints hold them apart so the memo is a panel, not a monologue.
- **Trellis disciplines turned on the analyst.** Separating claim from
  inference from judgment, steelmanning before weighing, and honoring rule 15
  (reproduce a position accurately before improving on it) are the same
  guards the engine puts on its own writes.
