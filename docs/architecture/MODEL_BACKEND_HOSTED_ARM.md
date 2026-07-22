# A hosted comparison arm for the model-backend seam (proposal)

**Status:** PROPOSAL, not a session. Zero implementation; zero code,
config, prompt, gate, pin, or default byte moves. Authored against
`master` @ `695440cfa9733a56936011276640ab9369fae5e4` (PR #109,
docs-only). This record proposes one owner decision and its grounding;
it does not run the stage-2 harness, does not enqueue paid work, and
owes no roadmap ledger entry or `HANDOFF.md` regeneration. Sequencing is
the owner's; this proposal does not jump the active EL queue.

**Parent doctrine:** `docs/architecture/MODEL_BACKEND_SEAM.md` (the R2b
seam design record) and roadmap item row 13 (the test-time-training /
sparse-model backend research track). This record reuses that seam
verbatim and adds nothing to its mechanism; it only records that a
hosted proprietary model is an allowed arm to drive through it, and
grounds the Gemini-shaped configuration against the seam's live and
pending increments.

---

## 1. The problem this proposal addresses

The seam record's R3 (`MODEL_BACKEND_SEAM.md` §9) names its first served
model as "one owner-chosen open sparse checkpoint, exact-pinned by
hash," because row 13's Phase 2 exists to test the sparse-model vehicle
(hypothesis H3 in `TEST_TIME_TRAINING.md`). That is the correct arm for
that hypothesis. It is not the only useful arm the seam can carry.

A separate, smaller want: run a second, already-hosted model against the
same prompt targets the house RLM protocol drives today, and observe the
deltas. The value is comparative, not coverage. A hosted arm will not
match an open-checkpoint reproduction study and is not meant to; it
produces an observed difference in how a different model drives the REPL
protocol, answers by reference, and adheres to the citation contract,
and that difference is data. The concrete candidate is Gemini 3.5 Flash,
reachable through an OpenAI-compatible endpoint.

The one decision this record asks the owner to make: is a hosted
proprietary model an allowed comparison arm for the seam, distinct from
R3's open-sparse-checkpoint arm? Everything below is the grounding that
makes that decision cheap to act on if the answer is yes, and cheap to
decline if the answer is no.

## 2. Why this needs almost no new design

The seam already accommodates a hosted OpenAI-compatible endpoint
without widening anything. Grounded in the seam record and the live
config surface:

- `MODEL_BACKEND_SEAM.md` §3.2 rule 3 explicitly ALLOWS
  `TRELLIS_RLM_BASE_URL` on the default `openai` backend with no
  `TRELLIS_RLM_BACKEND` set ("an OpenAI-compatible proxy on the default
  openai backend is a legitimate configuration"). A hosted Gemini
  endpoint rides the `openai` arm; the `openai`/`vllm` enum is not
  widened.
- `MODEL_BACKEND_SEAM.md` §3.3 case 3 ("custom endpoint, real key
  needed, a hosted open-model service") is exactly Gemini's shape: name
  the key variable through `TRELLIS_RLM_API_KEY_ENV`, resolve it
  fail-fast, pass `api_key=os.environ[<name>]` at construction. No new
  credential handling. Extending this case to a proprietary hosted
  endpoint is a policy extension, not a mechanism change.
- No new dependency. The arm rides the existing `openai` SDK through a
  `base_url`; it adds no SDK and no version bump, so the dependency
  ceremony the repo attaches to new dependencies does not apply.

## 3. The Gemini-shaped configuration (grounded in the live surface)

The seam's T1 config surface is already live in `src/config/index.ts`
(the four `TRELLIS_RLM_*` keys, the three cross-field refusals, the
ambient `OPENAI_BASE_URL` fail-fast guard, and the exported
`config.rlmBackend` with a fail-fast, never-logged resolved key value).
It has zero consumers; T2 and T3 wire it. A Gemini comparison arm sets,
at run configuration time and nowhere in code:

| Key | Value for the Gemini arm | Unset default (today) |
|---|---|---|
| `TRELLIS_RLM_BACKEND` | unset (rides the default `openai` arm) | `openai` |
| `TRELLIS_RLM_MODEL` | the exact Gemini model id string (pinned at implementation) | kernel literal `gpt-5.4-2026-03-05`, Python-side |
| `TRELLIS_RLM_BASE_URL` | the Gemini OpenAI-compatible endpoint | no `base_url` kwarg passed |
| `TRELLIS_RLM_API_KEY_ENV` | the name of the env var holding the Google key | no key indirection |

The gpt-5.4 comparison arm is the unset default: the current lever is
the hardcoded `backend_kwargs={"model_name": "gpt-5.4-2026-03-05"}` at
both `RLM(...)` construction sites in `src/rlm/trellis_agent.py`
(`run_author_mode` and `main`), plus the checker client literal in
`make_entailment_check`. Nothing in this proposal changes those bytes;
T3 is where they gain the seam.

## 4. Prerequisites (this arm cannot run until the seam exists)

The seam must be built before anything is served through it. Per
`MODEL_BACKEND_SEAM.md` §8 and §9, and the current baseline:

- T1 (config surface) is LANDED and live, zero consumers.
- T2 (`buildAgentEnv` forward/strip) is PAUSED. It had three consecutive
  no-landings, each a distinct editing-execution failure, and the owner
  chose to close that failure class by tooling shape (an
  engine-resolved-anchor insert in the guarded editing toolkit) rather
  than by more task text. The active engineering program is the
  engineering-session loop (owner direction, July 14, 2026, `HANDOFF.md`);
  the paused tooling-shape objective is preserved in `HANDOFF.md` Appendix A
  and resumes only after an explicit owner re-prioritization ahead of this
  arm.
- T3 (rewire the two `trellis_agent.py` construction sites, the checker
  client per §5, and the two telemetry fields per §7) and T4 (the
  zero-LLM fixture-endpoint drill) are not built.
- R3 (serving any non-default model, this arm included) enters only
  after T1 through T4 land.

So a Gemini arm is downstream of the paused T2. This proposal records
the decision now so it is ready when the seam is; it does not
re-sequence the T-series and does not compete with the active program.

## 5. The one caveat that fails first: the `usage` contract

rlms's `_track_cost` raises if a completion response carries no `usage`
object (`MODEL_BACKEND_SEAM.md` §6 last row; `TEST_TIME_TRAINING.md` §13.1 caveat 1). This is
the reason T4's fixture stub and R3a's first assertion exist. For the
Gemini endpoint specifically:

- Google's OpenAI-compatibility layer returns a `usage` object on
  NON-STREAMING chat completions (the Vertex and AI Studio Chat
  Completions documentation, July 2026). The rlms root loop at
  `max_depth == 1` uses non-streaming completions, so the contract is
  met on the path that matters.
- The known Gemini quirk is streaming-only: usage is emitted per chunk
  rather than only in the final chunk, and `stream_options:
  {include_usage: true}` governs streaming usage. This does not touch
  the non-streaming path rlms uses.
- The `usage` contract is three-field-shaped: `prompt_tokens`,
  `completion_tokens`, and `total_tokens` are read unconditionally after
  the `None` check. T4's stub and R3a's first assertion should verify
  shape, not just presence. Documentation is not a live check. Reading
  the docs lowers the risk; it does not retire it. The T4 fixture drill
  and R3a's first live assertion against the exact endpoint variant and
  model id remain the gate, unchanged.

## 6. The comparison run, when the seam is ready (R3b shape, reused)

No new evaluation machinery. A hosted comparison arm reuses
`MODEL_BACKEND_SEAM.md` §9 R3b exactly: the `est` suite (five questions,
truths unit-pinned, backend-independent by construction) plus a
protocol-adherence block, the Gemini arm paired against a same-day
gpt-5.4 arm. The gating observation is protocol competence: whether the
hosted model drives the house REPL protocol, answers by reference, and
holds the citation contract at an acceptable violation rate at all. The
delta between arms is the datum this want is after; partial is expected.

Arm assignment is verified per run from telemetry in both directions;
the discriminating echoes are `rlm_base_url_set` and the `model_usage`
model-name key (both arms resolve `rlm_backend` to `openai`, so that
echo alone cannot distinguish them). If the comparison run enables the
experimental checker, the checker follows the seam (§5) and its backend
is recorded with the run.

## 7. What this proposal does NOT touch

- The embedder does not move (`MODEL_BACKEND_SEAM.md` §2.3;
  `TEST_TIME_TRAINING.md` §4.2). No key here touches embeddings; the
  seam's §4 ambient-variable disposition keeps accidental embedder
  redirection a loud refusal.
- Worker transport does not move (`MODEL_BACKEND_SEAM.md` §2.2), still
  deferred behind the completion/embedding client split.
- The `openai`/`vllm` enum is not widened; a hosted Gemini endpoint is
  the `openai` arm plus a base URL.
- No new dependency, no gate, no default, no pin, no prompt byte. This
  record introduces no prompt frame; downstream sessions that author
  task text owe the prompt-engineering and hypershot-protocol skills on
  their own.
- The T-series is not re-sequenced. R3's open-sparse-checkpoint arm
  (row 13's actual Phase 2) is unchanged; this arm is additional, not a
  replacement.

## 8. Open decisions (owner's, with leanings)

1. **Allow a hosted proprietary comparison arm at all?** The decision
   this record exists for. Leaning: yes, as an additional arm, because
   it reuses the seam and R3b whole and prices per-token under the
   standing ≤$5/run cap (`MODEL_BACKEND_SEAM.md` §9 already contemplates
   a hosted open-model endpoint under that cap). Extending to a
   proprietary model is a policy extension, not a mechanism change.
2. **Which endpoint variant.** AI Studio
   (`generativelanguage.googleapis.com/v1beta/openai/`) versus Vertex AI.
   Leaning: AI Studio for the simplest hosted per-token access; the
   choice is a config value, decided at implementation, not a code
   default.
3. **Exact Gemini model id.** "Gemini 3.5 Flash" is the candidate; the
   precise API model string is pinned at implementation as a
   `TRELLIS_RLM_MODEL` config value, never a code literal.
4. **Sequencing.** Whether this arm is worth attaching to R3 when the
   seam lands, or held until the open-checkpoint arm is measured first.
   The owner sequences; this record only makes it ready.

## 9. What acceptance looks like for this record

This is a proposal, so acceptance is: the record exists in the house
design-record mold; every claim of "already exists" names the file that
proves it (the live T1 surface in `src/config/index.ts`, the hardcoded
literals in `src/rlm/trellis_agent.py`, the seam record sections cited);
the one owner decision and its open sub-decisions are stated with
leanings; the blast radius is fenced (§7); and the repository's offline
suite is untouched-green because the change is docs-only. Ratification,
if it comes, is a one-line owner decision recorded in
`docs/archive/TRELLIS_ROADMAP_DEPRECATED.md` §5 and, when the seam is ready, an R3-style paired
run under the existing owner-gated paid ceremony, zero-paid fixture
drill first.
