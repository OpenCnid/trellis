# R1 proposal — the pin-vacuity audit (a birth gate for the drill block, applied retroactively)

Status: **PROPOSAL (NOT sequenced, NOT ratified; owner-gated).** Child of
`docs/architecture/METRIC_EVOLUTION.md` §7 R1; grounded in arXiv:2607.12790's
birth-gate/validity-gate discipline and its Table 3 ablation (a fail-open
grader reports vacuous perfection). Zero-paid, zero-LLM throughout.

## 1. The failure class

**Pin vacuity: a guard that cannot fire.** A drill check whose detection
branch is never exercised proves nothing when green — it is fail-open in
exactly the shape the paper's ablation collapsed into (a detector that almost
never fires, selected for a vacuously perfect objective; the co-naive arm
passed 0.94–1.00 of everything while posting the *highest* raw scores).
The repo's exposure is real but unmeasured:

- Some pins are **demonstrated** non-vacuous already: the `test:textedit`
  guarded-family sections plant the Session 36 run-1 and Session 37 run-2
  violation shapes and assert the typed refusal fires
  (`STRUCTURAL_SPLICE.md` §6 items 2–3). That is the paper's birth gate,
  practiced before the paper existed.
- Some pins are **structural**: an equality of a computed value against a
  recorded one (the composed-prompt SHAs, the import-set pin) diverges by
  construction when the artifact moves; vacuity would require the pin to
  observe a dead artifact, which the classification must confirm, not assume.
- An unknown remainder is **unfixtured**: presence/absence greps and
  behavioral assertions whose failure branch no fixture has ever driven. A
  renamed token, a rotted pattern, or a tautological assertion passes forever.
  No inventory exists that says which pins are in this class — that absence
  is the failure class this proposal closes.

The observed near-instance: §5i.6 (Session 52) — a spec-perfect production
diff FAILED by a **mis-written test pin**. A pin wrong in the firing
direction was caught because it fired spuriously; a pin wrong in the
non-firing direction would never announce itself. Only an audit finds those.

## 2. The decision space

### 2.1 Full-block, per-check inventory in one increment — REJECTED

The standing close-out block spans ~19 drills and hundreds of checks
(`test:rlm-sandbox` alone reports 118). One increment covering all of them
is an unbounded session with a diffuse diff — the exact anti-pattern §0
sessions exist to avoid. Rejected for edition 1; recorded as the extension
trigger (§5).

### 2.2 Mutation-test the drills mechanically (mutate source, expect red) — REJECTED

Automated mutation testing over `src/rlm/` + the drill scripts would prove
firing without hand-authored fixtures, but it imports a mutation framework,
runs the block N×, and produces findings a human must triage anyway. Heavy
machinery for what a one-time classification plus targeted fixtures buys
exactly. Revisit only if the inventory reveals unfixtured pins too numerous
to fixture by hand.

### 2.3 Scoped inventory + paired fixtures + count pins — CHOSEN

Edition 1 covers the four drills every self-edit acceptance criterion cites
(`STRUCTURAL_SPLICE.md` §6 item 5 names the set): **`test:textedit`,
`test:selfedit-harness`, `stage2:check`, `test:modules`**. For every check
in those drills: classify, fixture what is unfixtured, and pin the check
*count* so the inventory cannot silently drift from the drills it describes.

## 3. The surface

1. **The inventory manifest** — one machine-readable file (working name
   `docs/benchmarks/pin_inventory.json`; format is an implementation detail,
   the requirements are: single source, one row per check, parseable by the
   drills) plus a prose companion (`docs/benchmarks/PIN_INVENTORY.md`)
   rendering it with rationale. Each row: drill, check index/name, class
   (`demonstrated` | `structural` | `unfixtured`), and firing evidence — for
   `demonstrated`, the planted violation it fires on; for `structural`, the
   computed-vs-recorded pair and the live artifact it observes.
2. **Paired known-bad fixtures** for every row that starts `unfixtured`:
   the drill gains a planted violation on which the check FIRES, beside the
   known-good path on which it stays clean (the birth-gate pairing). Each
   fixture's comment cites what it reproduces. At close, zero rows remain
   `unfixtured`.
3. **Count pins**: each covered drill tallies its executed checks and
   asserts the tally equals the manifest's recorded count for that drill. A
   check added without a manifest row turns the drill red; the pin moves
   wittingly (manifest updated in the same commit that adds a check) — the
   composed-prompt-SHA mold applied to check counts.

## 4. What this PREVENTS vs what it only DETECTS (honest scope)

- **Prevented:** a covered pin sitting fail-open indefinitely — every
  covered check either demonstrably fires or is classified structural with
  its observed artifact named.
- **Detected (not prevented):** drift — a future check added without
  classification is caught by the count pin at the next drill run, not at
  authoring time.
- **Not claimed:** that a firing pin checks the *right* invariant. The audit
  proves demonstrability, not the correctness or completeness of the guarded
  contract. A `structural` classification is a recorded judgment with
  rationale, reviewable and revisable — not a proof.
- **Out of scope, edition 1:** the vitest unit suite (~1,100 tests — its
  vacuity story belongs to a separate proposal if ever), the remaining
  drills of the block (§5 trigger), and any runtime byte: this increment
  touches drill scripts, fixtures, and docs only.

## 5. Increment sequencing

Self-contained; no dependency on R2/R3/R4 or on any paused track. Natural
FIRST of the four R-increments: R2 and R3 both cite birth-gate pairing as
their fixture discipline, and this record is where that discipline gets its
house definition. **Extension trigger (recorded, not scheduled):** a later
edition extends the inventory to the remaining drills of the standing block;
the trigger is any acceptance criterion citing a drill outside the covered
four, or an unfixtured-pin escape observed in the wild.

## 6. Pre-stated acceptance criterion

Zero-paid, zero-LLM, all six required:

1. The manifest exists, covers **every** check in the four covered drills
   (no sampling), and every row carries class + firing evidence. The prose
   companion renders it and records each `structural` rationale.
2. Zero rows are `unfixtured` at close: every check that began unfixtured
   has a planted known-bad fixture on which the drill asserts the check
   FIRES, paired beside its known-good clean path.
3. Every count pin is live: each covered drill asserts executed-check count
   == manifest count, and a deliberate local mutation (one check commented
   out, one added — not committed) was observed turning the drill red during
   the session, with the observation recorded in the session report.
4. Additive: no existing check is weakened, reordered, or removed; the only
   edits to pre-existing assertions are the added tallies/fixtures, moved
   wittingly in the same commit as their manifest rows.
5. The four covered drills run green with the new fixtures and count pins;
   raw check counts are printed and recorded in the roadmap §5 entry.
6. The standing close-out block is green (`npm test`, `npm run build`,
   `npm run python:check`, the full drill list, `git diff --check`) —
   non-markdown bytes moved, so the full block applies.

## 7. What does not change

Every checked contract (this increment adds detection evidence, never
behavior); the drill block's composition (no drill added or removed);
`src/` runtime bytes (zero motion); the composed-prompt pins; the
kernel/userspace boundary; the EL program's authority chain (drill evidence
remains evidence — acceptance stays human, per the acceptance ledger's
`actor` pin).

## 8. Status ledger

- July 16, 2026 — proposal authored (session, branch
  `d/trellis-paper-analysis-b9bec7`), child of `METRIC_EVOLUTION.md` §7 R1.
  NOT sequenced; awaiting owner decision.
