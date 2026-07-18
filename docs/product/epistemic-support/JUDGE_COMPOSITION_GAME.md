# The Judge-Composition Game — Session Record and Distilled Rules

**Status: RECORD of a session-layer experiment (July 17–18, 2026), with
proposals marked where they occur; ratification §11.** Players: the
owner (Cnid — long form Cnidarian), the collaborator (M. Murphy), and
Claude (composer). Authored under HANDOFF §7 guardrail 4 /
Guardrail 15 (Prompt-Engineering + Hypershot invoked before any
authored prompt bytes). This record is **canonical for the learnings**;
the operational shorthand is a session-layer skill
(`judge-composition`, currently user-level outside the repo, sibling
to the collaborator-derived prompt protocols). Where the two drift,
this record wins and the skill gets regenerated — never the reverse.

Nothing in this record changes engine code, drills, or any committed
design. The experiment ran entirely at the session layer (isolated
sub-agent contexts); `judge_panel.ts`, `judge_audit.ts`, and the
Session 66 drills are untouched, and RECONCILIATION §7 ratification
remains the owner's pending act, unaffected.

Sources: [`FOUR_JUDGE_BASIC_MODEL.md`](FOUR_JUDGE_BASIC_MODEL.md)
(S10), [`RECONCILIATION.md`](RECONCILIATION.md) (the composition law
the game exercised), [`FOUR_JUDGE_DESIGN.md`](FOUR_JUDGE_DESIGN.md),
the adoption bounds (RESEARCH_MAP §9).

---

## 1. Purpose, and a provenance clarification for S10

**Purpose.** Teach the composer adaptable judge composition well
enough to distill a meta-prompt for spawning fit-for-purpose judge
panels over the Trellis harness's novel REPL state — unknown content,
a user-requested promotion candidate, judges composed to match.

**S10 provenance clarification (owner-relayed collaborator statement,
July 17, 2026 — recorded here because the S10 document is committed
verbatim and takes addenda, not edits):** the "useful first ecology"
(S10's eleven judges) is a list of **illustrative examples composed
from the primitives**, vetted by the collaborator's AI assistant — not
a canonical roster. The primitives (four registries + the YAML schema
+ the composition method) compose Lego-like into arbitrarily many
judges over any claim type. This confirms the reading S10's own text
already licenses ("These are parameters, not rules") and the
reconciliation's "minimal ecology instance" framing.

**Game flow (the owner's rules):** (1) current player poses a context;
(2) the composer builds the four judges for it; (3) human review;
(4) feedback; (5) next player poses. Rounds continue until the table
sees the judges matching the context; then the composer writes the
final rule from the run and the critique. Testing is **anecdotal by
design** — the space is not exhaustively testable (§7, item P3).

## 2. The three graded hands

| Hand | Dealer | Context | What it exercised | Review outcome |
|---|---|---|---|---|
| 1 "creek ledger" | composer (self-dealt) | citizen-science water-quality REPL; causal-attribution candidate | epistemic driving question; transcription-fidelity vs grounding split; ethical plane correctly gated (AB-7) | positive; one correction — corroboration's two blindnesses were conflated (became rule 2) |
| 2 "comedian corpus" | collaborator | approved-routine corpus; unperformed-bit candidate (originality + glue + impact) | aesthetic driving question pulls Emotional/Sensorial registries IN, with the user's own corpus as the standard; compound-candidate decomposition forced by "use the label, what is B?" (became rule 1); nobody judges "funny" — impact is performance-gated, promotion provisional | positive both reviewers |
| 3 "Armory Theory" | owner (Cnid) | the owner's own methodological theory as candidate; **sycophancy trap armed** | authorship-blind composition (rule 6); value-mode merit refusal (rule 7); composer conflict disclosure (rule 9); pre-registration discipline | positive; escalated to the live run |

The hands share zero content. The same four-role skeleton produced
water-chemistry judges, comedy judges, and methodology judges by
swapping selections, orientations, and taxonomies — the frame-content
separation working as the hypershot protocol predicts.

## 3. The live run (hand 3 executed, four sub-agent judges)

Proposed by the collaborator and authorized by the owner (Cnid). Three belief-facing judges ran in **isolated clean contexts** —
each receiving only its input allowlist (bundle + claimant-masked
cited bytes; bundle + curated record digest; bundle + declared
evidence pool), never the claimant's identity, the conversation, the
other judges, or the composer's pre-registered expectations. The audit
seat ran after, over the judges' prompts, verdict records, the
composer's disclosures, and the pre-registrations.

**Headline result: the panel caught its own composer.** The grounding
judge found the composer's prose decomposition had strengthened the
claimant's claims **four-for-four** (inserted a modal "necessarily";
universalized a three-item enumeration into "anything"; dropped one
qualifier; transposed another). Six of the panel's eight drawbacks
were filing artifacts billed to the claimant; only two touched bytes
the claimant wrote, and one of those (the corroboration finding) was
voided as a forecast because the composer's task text had embedded its
content (audit finding: "a pre-registration whose substance is in the
prompt is not a forecast; it is a work order").

Audit verdict on drift: none established in the belief-facing layer —
every divergence from the composer's pre-registrations ran *harsher*
than predicted, which a captured panel would not do. The drift was
upstream, in composer artifacts: the directional filing, a digest with
one-way valence, one steered prompt. The collaborator's design claim
was thereby demonstrated, not assumed: **impartiality comes from the
judges' isolated clean contexts, not from the composer's prompting.**

The collaborator's diagnosis of the filing failure, recorded verbatim
in intent: a common AI mechanism — the model modifies a user's claim
believing it adds or subtracts rigor for the purpose, committing
epistemic harm on the idea itself. It sits at the intersection of
assistant training and anti-sycophancy training: sycophancy bends
*verdicts* toward the user; the helpfulness reflex bends the user's
*claims* toward the instruments. Byte-accurate comparison requires
byte-accurate reproduction of claims. This is
[`CODE_MEDIATED_TEXT.md`](../../architecture/CODE_MEDIATED_TEXT.md)
applied one layer up: claims are text, and model paraphrase of them is
the same corruption channel the pillar already forbids for content.

## 4. The corrected re-run (the rule-15 positive control)

The four remanded items were refiled under a new substrate — verbatim
byte spans + labeled mode annotations, garbles preserved with labeled
intent-readings — and judged by fresh clean-context instances.
Results: zero fidelity drawbacks; the coherence fork that had drawn a
drawback dissolved with the qualifier restored to its source position;
correct typed abstentions on the value and prediction annotations.

The slim audit on the re-run found the fix's own shadows, each now a
rule: expectation content had relocated from task text into
*annotation phrasing* (negations of the prior run's failure classes);
span *boundaries* are an unaudited surface (tilt-by-omission); an
intent-reading was judged against rival repairs instead of against the
garble; two isolated judges construed the same ambiguity oppositely,
each favoring its own verdict, with no seat positioned to see it; and
the run's residual lean pointed uniformly *friendlier* where the first
run's had pointed uniformly harsher — coincident with the layers the
composer controlled. Lesson, at the audit's own calibration (no
established drift, monitoring flag): **bias is conserved under
correction unless the correction is itself audited.**

## 5. The P7 arc and the primitives thesis

The one drawback grounded in bytes the claimant actually wrote
(a `non_sequitur` on "the judges have to compose this way") proved a
**true positive of a different kind**: the claimant confirmed the
bytes had misstated intent, and corrected the claim himself — the
judge detects the gap; only the claimant upgrades intent. The
corrected claim: particular schemes are freely chosen *rules
variants*; uniqueness is claimed for the underlying *game* —
composition from conceptual primitives — because different
fundamentals (alphabets, tokens) compose around the same conceptual
primitives.

An adversarial clean-context analyst then attacked the corrected
thesis (five candidate paradigms: learned reward models, prediction
markets, proof checkers, evolutionary selection, common-law
precedent). Every candidate fractured along one seam — primitive-free
⟹ ungovernable or non-universal; robust-and-universal ⟹ a substantive
four-slot reduction (registry / selection / orientation / blindness)
lands. Verdict: **corroborated-by-failed-counterexample,
conditionally** — the thesis is contentful only under a strong reading
of "governable" plus a substantive-reduction guardrail, and it carries
one named empirical falsifier: **representational holism** (if
judgment-relevant structure in learned judges does not decompose into
interpretable dimensions, the thesis breaks).

The analyst's steelman — *no judging system is simultaneously
universal, governable, and primitive-free; composition-from-primitives
is the unique design occupying universal ∩ governable* — is **TABLED
as a claimant-optional refiling** (rule 15 cuts both ways: the
composer does not file improved versions of anyone's claim, however
superior). The decision belongs to the collaborator.

## 6. The twenty rules (canonical)

1. **Decompose before composing** — applicability gates cannot run on a conjunction; split compound candidates into labeled sub-claims with modes first.
2. **Two blindnesses, never conflated** — evidence-facing (the candidate's citation chain is not corroboration) vs verdict-facing (no belief-facing judge sees another's output; that is the audit's seat alone). Corroboration base = record − citation chain + allowlist.
3. **The driving question sets registry access** — epistemic questions keep Emotional/Ethical out (AB-7); aesthetic or human-impact questions pull them in, with the user's own corpus as the standard, never the judge's taste.
4. **Belief-facing taxonomies close per composition; the audit taxonomy is invariant** — how judges fail does not depend on what they judge.
5. **Allowlists are user-shaped** — authoritative sources belong to the user's data, not the panel.
6. **Authorship is never a parameter** — claimant-masked always; audit runs claimant-masked replays; drift in either direction (courtier or contrarian) is drift.
7. **Value-mode candidates compose as declarations, not endorsements** — merit refuses on all-jurisdiction-abstain; the panel records the user's values, never ratifies them.
8. **The case file is testimony; the bytes are evidence** — enumerate the bundle from bytes; mismatches are grounding verdicts, not clerical fixes.
9. **Composer conflict is disclosed, pre-registered, and externally reviewed** — never self-absolved.
10. **The filing is a judged artifact** — misquote-family grounding drawbacks indict the filer and remand to refiling; they never count against the claimant.
11. **Forecasts must not share bytes with prompts** — embedded expectation content is a work order; tautological predictions of composer-authored gates are struck from calibration.
12. **Composition-guaranteed abstentions disclose as "untestable as composed"** — designed silence must not read as neutrality.
13. **Keystone values surface to the gate-holder** — merit refuses, but load-bearing declarations are flagged, never buried.
14. **Evidence-universe curation is unauditable from inside** — block selection, digests, and pool choice are where external review and independent re-composition must sit; that seat is human.
15. **Byte-accurate claim filing** — verbatim spans + annotation over spans, never prose rewrite; state an incapable claimant's claim *as intended, not inflated or deflated*; ask a clarifying question before judges launch against the wrong claim.
16. **Annotations state filed content positively** — never negations of known failure classes; exclusions live in the composition record, not judge-visible evidence.
17. **Span boundaries are a judged surface** — the grounding seat checks the cut for tilt-by-omission, not just the bytes inside it.
18. **Intent-readings are judged against the garble** — indeterminate bytes are the baseline; any determinate repair is a labeled strengthening even when all rival parses are equally strong.
19. **Construal conflicts compose like overlaps** — the same ambiguity resolved oppositely by isolated seats is a typed fork in the record, never a silent blend (no-global-section, one layer up).
20. **Non-spawn rationales are demonstrated, not asserted** — "untestable as composed" is shown against the pool's contents, never solely by the party whose filing created the unreachability; pre-registrations need a registry the audit seat can timestamp.

## 7. The final ledger (both runs composed)

| Item (claimant's bytes) | Disposition | Carried notes |
|---|---|---|
| game-target spec | promote | record-fit routes through the priority declaration (keystone) |
| space functionally infinite, while finite | promote as refined | "nominally astronomical" corroborated; functional size awaits a distinctness criterion; "while finite" true only of a typed-vocabulary snapshot; steering caveat until independently replicated |
| anecdotal testing, with reason | promote as filed | the "necessarily" that drew drawbacks was the filer's, not the claimant's |
| cannot test them all | **promote, unanimous** | corroborated at ≥5 orders of magnitude on the closed combinatorial core alone |
| REPL may contain (three examples; we don't know) | promote as filed | enumerated modal, not a universal |
| examples have no primacy beyond Trellis | merit refused (typed); grounded declaration | keystone flag |
| Trellis the only case cared about, for multiple flywheels | merit refused; grounded declaration of *qualified* exclusivity | first-run fork was a filing artifact; dissolved on refiling |
| routine reproduction during own work | abstain(evidence), disclosed untestable-as-composed | garble preserved; labeled intent-reading |
| judges must compose this way | superseded by claimant correction → primitives thesis | see §5; the original drawback stands against the original bytes as a validated true positive |
| "The game is simple!" | rhetorical header; merit never composed | no judge tripped the convention-blind wire |

## 8. The shared empirical bet (owner ruling, July 18, 2026)

Three entries now rest on **one assumption**: that judgment-relevant
structure is decomposable into interpretable dimensions —
(a) the refined functional-infinity claim (needs a functional-
distinctness criterion), (b) the primitives thesis (falsifier:
representational holism), and (c) the residual-stream sidecar
direction ([`RESIDUAL_STREAM_SIDECAR.md`](../../architecture/RESIDUAL_STREAM_SIDECAR.md)),
which reads judgment-relevant structure from the stream. The owner's
ruling: this convergence is the purpose — **the assumption is tested
empirically, not argued**; the judge experiments are the suitability
tests and will be iteratively refined in use. The collaborator's
framing (recorded as claimant position, not panel finding): the same
conceptual overlay (UIT-IEG, which predicted the U-neuron) predicts
this research aligns. If holism wins, the three entries fall together;
if decomposability wins, the core stands on demonstrated ground.

**External-verification ruling (owner lean, exercised in the game):**
evidence-bearing external retrieval belongs to the **corroboration
seat**, gated by a user-selectable allowlist (per-user authoritative
sources), each result entering as a provenance-stamped support event.
The audit seat gets read-only access to the same allowlist for
coverage checks; its findings never gate.

## 9. What passes to the harness (future work, not performed here)

When the panel goes live in the engine, the game's results bind the
implementation shape (all subject to the usual bounded-feature
authorization; nothing here authorizes build):

- **The filing layer is code-mediated**: promotion candidates are
  selected by engine address and quoted by the engine, never retyped
  by a model — rule 15 as mechanism, not discipline.
- **Judge invocations are clean contexts**: composed prompts carry
  definition + allowlisted evidence + output schema and nothing else;
  claimant identity masked at the evidence layer; task text inert.
- **Pre-registrations are stored, timestamped artifacts** the audit
  can read — not conversation prose.
- **Allowlists are user configuration** on the REPL/workspace, not
  panel constants.
- **Dispositions extend the opinion vocabulary**: remand (filing
  defect), untestable-as-composed (designed abstention), merit-refusal
  (value declarations), thesis-with-falsifier — alongside the drilled
  v1 support arithmetic, which is untouched.
- **The audit's masked-replay and construal-fork detection** are the
  two mechanisms the session layer ran by hand that want engine homes.

## 10. Open items

1. The trilemma steelman — the collaborator accepts, amends, or
   declines the refiling (§5).
2. Independent (non-composer) replication to lift the steering caveat
   on the functional-infinity entry (§7 row 2).
3. The narrowly scoped corroboration spawn on the keystone-routing
   question (re-run audit finding F5) — available on request.
4. In-repo copy of the `judge-composition` skill, if the owner wants
   it versioned here (drift rule in the header governs either way).
5. Formal eval round + description-optimization pass for the skill
   (the game itself served as iterations 1–4 with two human graders).

## 11. Ratification

**OPEN.** The factual sections (§2–§5, §7) record what happened and
need no ratification. The proposals — the twenty rules as binding
program law (§6), the harness-shape notes (§9), and this record's
canonical-over-skill authority — are ratified by the owner's dated
entry here; until then any consumer must say so.
