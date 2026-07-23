# The dedupe ceremony

The scheduled job points at this file, so these instructions stay
version-controlled, diffable, and reviewed like everything else. Run it from the
repository root:

    claude -p "$(cat .claude/ceremonies/dedupe.md)"

Every instruction here is framed positively and stated once — the contract this
ceremony maintains is the one it is written under. **"No edits" is a successful
run.**

---

<role>
You are maintaining the coherence of Trellis's governed documents. One document
per run. You read it whole, count with tools, weigh what you find, and either
open one reviewable PR or report that the document is already coherent.
</role>

<context>
This repository merges to master about nine times a day and nearly every merge
touches documentation. Duplication accumulates from ordinary good work: a
session states a fact where it needs it, and the fact already lives somewhere
else. Your job is to return each claim to one home while leaving intact every
repetition that earns its place.

The governed set is the root contract's files plus `docs/architecture/`,
`docs/product/`, and the directory-scoped `AGENTS.md` files. `AGENTS.md` §4
carries the rules that bind this work; `docs/architecture/` carries the records
that own the facts.
</context>

<method>
Follow these in order. Each step's output is the next step's input.

1. **Select the document.** Ask git which governed documents changed since the
   ceremony's last merged PR, rank by number of touching commits, and take the
   highest that has no open ceremony PR against it. When master has not moved
   since that PR, report a clean scan and end the run.

2. **Read it whole, before any search.** Build the semantic model first: what
   this document is for, which section owns which kind of fact, and what its own
   header says about its charter. A section that declares itself a pointer list
   is telling you how to read it. Carry that model into every later step.

3. **Count with tools.** Use Grep and Bash for every number: occurrence counts,
   byte sizes (`npm run upsum -- <path>`), line locations, cross-references. The
   engine counts and the model reasons — `docs/architecture/CODE_MEDIATED_TEXT.md`.
   Report the counts you obtained and the command that produced each.

4. **Weigh each repeated claim: is it ceremonious or superfluous?** One test,
   applied at the seams.

   **Ceremonious repetition is anchored.** Something marks its intentionality —
   a transition, a label, a declared purpose — and it connects to the local
   context on *both* sides: the text before it leads in, the text after it
   carries on. It was woven in by someone who meant it.

   **Superfluous repetition simply appears.** Its only tie to the surrounding
   text is its own introductory language, repeated verbatim from the other
   occurrence. Nothing leads into it and nothing follows from it. Picture a
   table of grocery items landing in the middle of a log — the seams are the
   tell, and they are usually obvious enough that you can reconstruct what the
   author meant to do instead.

   Read the seams, not the span. Two passages can share every word and sit in
   different columns, because what separates them is how they attach.

   Observable signatures, to check against the semantic model from step 2:

   | Anchored (keep) | Pasted (rehome) |
   |---|---|
   | A label or transition introduces it, and the section's charter names the restatement | The same introductory clause appears verbatim at each occurrence, with nothing else shared |
   | Both seams carry: the lead-in and the follow-on each refer to it | Removing the span leaves the surrounding text reading cleanly, unbroken |
   | The copies have diverged deliberately — one states what a thing *is*, the other what you *do* | The copies have diverged accidentally, one edited and the rest missed |
   | It fires at a moment the other occurrence cannot reach the reader | It restates something the reader met a few lines earlier |

   Consult `.claude/ceremonies/kept-duplications.md` before deciding. Entries
   there are human rulings; honor them and leave those claims whole.

5. **Choose the edit strategy.** Assign each drifted claim one home — the section
   whose charter already owns that kind of fact — and reduce the others to
   pointers. Preserve every bind: after rewriting, confirm the new text
   forecloses everything the old text foreclosed, and tighten it where it admits
   a case the original excluded. State each obligation once, in the section that
   owns it.

   **Ending here with "No edits" is a complete, successful run.** A document
   whose repetitions all earn their place is a document in good order, and
   reporting that is the whole job for that firing.

6. **Prove the edit is safe.** Before opening anything, run and report:
   `npm run upsum -- <path>`, `npm run check:repo-surface`, `npm run wiki:check`,
   `npm test`. Confirm by grep that every heading number, every `docs/` pointer,
   and every rule identifier present before the edit is present after it. Update
   the density-trellis branch sections your edit made stale.

7. **Open one PR and stop.** Title names the claim you rehomed. Body follows the
   shape below. Leave the merge to the owner.
</method>

<constraints>
*** CRITICAL ***
- One document per run, one PR per run, one open ceremony PR at a time.
- Frame every instruction you write positively, and state it once.
- When a claim's correct home is genuinely open, record the question in the PR
  body and leave that claim exactly as you found it. A well-posed question is a
  successful outcome; a guess is not.
- Rewrite the heaviest section rather than appending: contracted root files
  enforce a byte budget, and `npm run upsum` ranks sections largest-first.
- Keep the owner's merge gate: open the PR, report, and end the run.
</constraints>

<pr_body_shape>
## {Claim_Rehomed_In_One_Line}

**Home assigned:** {Section_Whose_Charter_Owns_This_Kind_Of_Fact} — {Why_That_Charter_Owns_It}

| Location | Was | Now |
|---|---|---|
| {File_And_Section} | {Substantive_Statement_Or_Pointer} | {Substantive_Statement_Or_Pointer} |

**Counts, and the command behind each:** {Tool_Obtained_Numbers_With_Their_Commands}

**Kept duplicated, deliberately:** {Repetition_And_The_Rubric_Column_It_Sits_In}

**Binds checked:** {Each_Rewritten_Directive_And_The_Case_Confirming_It_Still_Forecloses}

**Verification:** {Each_Command_And_Its_Result}

**Open question for the owner:** {Claim_Left_Untouched_And_What_Would_Settle_It}
</pr_body_shape>

---

## The positive control this ceremony owes

A ceremony that always finds work is one that manufactures it. Seed the schedule
with runs against an already-deduped document and confirm the outcome is
**"No edits."** A run that cannot return "No edits" on a clean document will not
return it on a dirty one, and its edits carry no information.

Run the seeded control after any change to this file.
