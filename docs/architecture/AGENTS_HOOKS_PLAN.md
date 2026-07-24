# AGENTS hooks — implementation plan (the third delivery channel)

**Status:** a plan, not an installation. This session wrote this file and
**nothing else** — no `.claude/settings.json` change, no hook wired, no script
created. A later session executes it, cold. Everything that session needs is on
this page; anything not on this page it must not assume.

**What this builds.** The AGENTS.md restructure ships the house rules on three
channels. Channel 1 is the **fan-out index** — the `AGENTS.md` trunk whose index
rows name, per kind of work, the leaf that governs it. Channel 2 is the
**skills**, which Claude Code auto-loads. This plan builds **channel 3: hooks
that inject a leaf's text automatically when a session touches files or runs
commands that leaf governs.** The three channels are redundant on purpose: a
session that never opens the index, and a model whose skills did not fire, still
meets the rule when it edits the matching bytes.

**What a hook here is, and is not.** A hook in this repository **reports; it does
not enforce** — `.claude/README.md` and `tools/density-chain/wiki_check.mjs`
both state this as the standing property, and this plan preserves it. The
injected text is a reminder that lands in context; nothing executes it, and no
edit is blocked by it unless the owner rules otherwise (see §8). Turning a
reporter into an enforcer is a values call reserved to the collaborator.

---

## 1. Mechanics — what is confirmed, and what is asserted

Two kinds of fact drive this plan. **Confirmed** facts are read directly out of
the repository's one working hook, `tools/density-chain/wiki_check.mjs`; each
carries a line cite and tomorrow's session can re-read it. **Asserted** facts
were established in the planning session that wrote this file and were **not
execute-verified here** — they are exactly what the verification gate in §10
exists to catch. The plan states which is which so the gate is aimed at the
right targets.

### Confirmed by reading `wiki_check.mjs` (re-readable)

- **The hook reads its input as JSON from stdin (fd 0).**
  `JSON.parse(readFileSync(0, 'utf8') || '{}')` (line 603). The payload carries
  `hook_event_name` (line 607) and `session_id` (used at line 641).
- **Injection field for context is `additionalContext` nested in
  `hookSpecificOutput`, on exit 0.** The SessionStart branch emits
  `{ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: brief } }`
  (lines 631–636). Claude Code wraps that string as a system reminder read on
  the next inference.
- **Silence is `{ suppressOutput: true }` on exit 0** (lines 616, 632-ish for
  the quiet path).
- **A once-per-session dedup marker already exists as a pattern**: a file under
  `os.tmpdir()/trellis-density-chain/` named `<repoKey>-<sessionId>.fired`,
  where `repoKey = sha256(REPO_ROOT).slice(0,12)` (lines 592–598, 639–648).
  This is the exact mechanism §9 reuses to stop re-injection accumulating.
- **The command form uses `$CLAUDE_PROJECT_DIR`**: the existing hooks call
  `node "$CLAUDE_PROJECT_DIR/tools/density-chain/wiki_check.mjs" --hook`
  (`.claude/settings.json`).
- **Glob matching is already solved and exported.** `globToRegExp` and
  `expandBraces` are exported (lines 800–805). `expandBraces('a/{b,c}/d')` →
  `['a/b/d','a/c/d']`; `globToRegExp('src/core/ast/**')` matches
  `src/core/ast/anything`. The injector imports these rather than re-deriving a
  glob engine — one glob semantics for the whole repo.
- **Node is v20.19.2** (checked this session) — ESM, top-level `readFileSync(0)`,
  `node:` imports all available.

### Asserted this session — NOT execute-verified here (the gate's targets)

- **Path matching goes on a per-handler `if` field** using permission-rule glob
  syntax (`"if": "Edit(src/core/graph/**)"`), **not** the top-level `matcher`
  (which filters the tool *name* only). `if` works only on tool-adjacent events
  (PreToolUse / PostToolUse). House vocabulary corroborates the field exists —
  `Hook_Conditional_If_Gate`, "one narrowly-`if`-matched" gate
  (`.claude/skills/spark-steering/references/steer-3-costs.md` §§6, 104) — but
  this session did not run one.
- **Injected strings are capped at ≤ 10,000 characters.** All nine leaves are
  already under it (largest: `standing-configuration.md`, 8,497 bytes), so the
  cap does not bind a whole-leaf inject; pointer injects (§7) sit far under it.
- **Injected text re-fires on every matching event and accumulates at full
  token cost** — the reason §9 exists.
- **Injected text must read as a factual statement of how the repo works, never
  an imperative.** Imperative framing trips prompt-injection defenses and gets
  surfaced to the user instead of absorbed. The leaves are already positively /
  factually framed; the pointer templates in §7 preserve that.
- **Injection lands before the *next* inference**, so the **first** edit under a
  glob is unprotected and the rule lands from the second onward. `PreToolUse`
  fires before the tool runs and can carry a `permissionDecision` to genuinely
  block; `PostToolUse` fires after and is presence-only.
- **`SessionStart` accepts a `compact` matcher** that fires after compaction —
  the clean seam to re-inject AMBIENT, because path-scoped context does **not**
  survive compaction while a hook re-fires.

---

## 2. The injector decision — one script, table-driven (recommended)

**Recommendation: a single injector script, `tools/agents-rules/inject.mjs`,
driven by one declarative glob→leaf and command→leaf table, invoked by a handful
of `settings.json` handlers.** Reject the alternative of per-leaf inline shell
commands (or nine per-leaf `settings.json` handlers each carrying its own `if`
glob).

The argument, in the repository's own terms:

1. **One source of truth for routing — the repo already made this call.**
   `wiki_check.mjs` derives its entire routing table from one place and stores
   nothing twice, on the stated ground that "the map and the router cannot
   disagree" (its header, lines 10–18). Nine `if` globs copied into
   `settings.json` are a second copy of each leaf's placement note — a surface
   that drifts from the leaves and from `root-contract.json`, which is precisely
   what `governed-documents` rule 22(c) (rows) and the density-chain design both
   forbid. The table lives in the script; `settings.json` stays a thin, stable
   wiring file.
2. **One reachability caller, one review surface.** `.claude/README.md` warns
   that editing the hook script changes what auto-executes for every reviewer.
   One script is one thing to review on those terms; nine inline command strings
   are nine.
3. **The cross-cutting mechanics are enforced in exactly one place.** The ≤10k
   cap, the factual-not-imperative framing, the pointer-vs-full-leaf choice, and
   the once-per-session dedup marker are all properties of *the injected string*.
   A single script applies them uniformly; inline commands re-implement each per
   leaf and diverge.
4. **`governed-documents` cannot be a static glob at all.** Its trigger set is
   `root-contract.json`'s `rootFiles` + `documentUpsum.paths`, and the leaf
   states the hook must **derive** the list from the contract, not hard-code a
   copy. Only a script can load `root-contract.json` at run time and build that
   match set. This alone rules out a pure-`settings.json` design for at least one
   leaf, so the script exists regardless — put all routing in it.

**Cost of the recommendation, stated honestly.** A single `PostToolUse` handler
on `Edit|Write|MultiEdit` spawns `node` on *every* edit, matching leaf or not.
That is the same class of cost the repo already pays (wiki_check spawns node on
every Stop and SessionStart); the script fast-exits with `{ suppressOutput:true }`
when nothing matches. If per-edit spawn latency is later found to bite, add a
coarse `if` union pre-filter (§12, open choice) — but do not scatter the
authoritative globs into `settings.json`.

---

## 3. The routing table (verified against the leaves and the contract)

The injector holds this table. Globs use the same syntax `wiki_check.mjs`'s
exported `expandBraces` + `globToRegExp` consume; the injector matches the
edited path (`payload.tool_input.file_path`, made repo-relative) against it.

| Leaf | Trigger globs (edit-shaped) |
|---|---|
| `substrate-writes` | `src/core/{ast,graph,ingestion,promotion}/**`, `src/rlm/trellis_{tools,textedit,answer}.py`, `src/config/schema.ts` |
| `prompt-authoring` | `.claude/skills/**/SKILL.md`, `.claude/agents/**`, `modules/**/addendum.txt`, `src/rlm/trellis_{agent,scaffold,modules}.py`, `**/AGENTS.md` |
| `composed-evaluators` | `src/core/graph/judge_*.ts`, `docs/product/epistemic-support/**`, `.claude/agents/**`, `**/*judge*`, `**/*rubric*`, `**/*panel*`, `**/*defeater*` |
| `measurement-and-reporting` | `scripts/**/*{drill,bench,probe,eval,control}*`, `docs/**/*{REPORT,RESULTS,MEASUREMENT}*.md` |
| `boundaries` | `src/core/{llm,a2a}/**`, `src/api/**`, `src/config/{index,mcp_servers}.ts`, `src/workers/*_job.ts` |
| `standing-configuration` | `.claude/settings.json`, `**/CLAUDE.md`, `*/AGENTS.md`, `.claude/skills/**/SKILL.md`, `.claude/agents/**`, `.mcp.json`, memory files (see note) |
| `governed-documents` | **derived at run time** — see below |

Notes and reconciliations tomorrow's session must honour:

- **`governed-documents` is contract-derived, never copied.** At startup the
  injector reads `tools/repository-surface/root-contract.json` and builds its
  match set from `rootFiles[].path` (18 paths incl. `AGENTS.md`, `AMBIENT.md`,
  `README.md`, `package.json`, …) ∪ `documentUpsum.paths[].path`
  (`docs/ORIENTATION.md`, `docs/GLOSSARY.md`, `docs/README.md`). When the
  contract changes, the trigger set changes with it, with no edit to the
  injector. Re-read the contract this session before trusting this list — it
  moves.
- **Overlaps are real and wanted.** `.claude/agents/**` fires `prompt-authoring`,
  `composed-evaluators`, and `standing-configuration`; `**/AGENTS.md` fires
  `prompt-authoring` and (as a root file) `governed-documents`;
  `.claude/skills/**/SKILL.md` and `.claude/settings.json` fire multiple. The
  injector **unions** matches, exactly as `wiki_check.mjs`'s `route()` unions
  declared globs rather than picking one (its lines 262–278): a path two leaves
  govern is governed by both. Dedup (§9) is per-leaf, so an editing session sees
  each matched leaf's pointer once, not a pile of duplicates.
- **`memory files`** in `standing-configuration`'s own note is a class, not a
  path this repo controls (memory lives under the user's `~/.claude/…`, outside
  the worktree). Treat it as *out of hook scope* and record that the leaf's
  memory-file clause is delivered by the leaf's own text when any in-repo
  standing-config path fires, not by a memory-path glob. Confirm against the
  leaf before wiring.
- **Two leaves are not edit-shaped** — `commit-and-pr` and
  `spend-and-live-infrastructure` — and route on Bash command strings (§8), not
  this table.

Verification obligation before wiring: open each leaf and confirm its placement
note still names these globs, and re-read `root-contract.json`. A glob that has
drifted from its leaf is a silent mis-route.

---

## 4. The exact `.claude/settings.json` shape

Preserves the two existing `wiki_check` hooks **byte-for-byte** and adds the new
handlers. This is a sketch to adapt, not to paste blind — re-read the live
`settings.json` first (it may have moved) and keep whatever it holds.

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/tools/density-chain/wiki_check.mjs\" --hook",
            "timeout": 30,
            "statusMessage": "Checking the density-trellis"
          }
        ]
      },
      {
        "matcher": "compact",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/tools/agents-rules/inject.mjs\" --ambient",
            "timeout": 15,
            "statusMessage": "Re-stating the ambient rules after compaction"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/tools/density-chain/wiki_check.mjs\" --hook",
            "timeout": 30,
            "statusMessage": "Checking the density-trellis"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/tools/agents-rules/inject.mjs\" --edit",
            "timeout": 15,
            "statusMessage": "Checking which house rule this edit is under"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/tools/agents-rules/inject.mjs\" --bash",
            "timeout": 15,
            "statusMessage": "Checking which house rule this command is under"
          }
        ]
      }
    ]
  }
}
```

**Why routing lives in the script, not in `if` fields here.** With all globs in
the injector's table (§3), `settings.json` needs one `PostToolUse` handler and
one `PreToolUse` handler — no `if` globs to drift. The mode flags
(`--edit`, `--bash`, `--ambient`) tell the one script which event it is serving;
it reads the rest (path, command, event, session id) from the stdin payload. The
`if`-per-leaf alternative is §12's open choice, presented but not recommended.

The injector must be created at `tools/agents-rules/inject.mjs`. Creating a new
`tools/` subtree is itself a surface change the density-trellis and root-contract
account for — expect `wiki:check` to flag the new path as needing a route, and
settle that in the same change (a `governed-documents`/density-chain follow-on,
noted in §12).

---

## 5. `--ambient` — SessionStart injection and `compact` re-injection

AMBIENT.md carries the five rules whose trigger is only that a session exists;
they are not edit-shaped, so no path glob delivers them. Their exposure is:

- **On a fresh `SessionStart` (startup / resume):** `AGENTS.md` and `AMBIENT.md`
  are normally already in context as project instructions, so a second inject is
  usually redundant. Do **not** add an unconditional startup inject by default;
  it charges every session for a duplicate. (If the owner later wants a
  belt-and-braces startup restate, it is a one-line addition — §12.)
- **On `SessionStart` with `matcher: "compact"` — the load-bearing case.**
  Compaction drops path-scoped context; a hook re-fires. So the compact handler
  re-injects AMBIENT. The injected string is a **pointer**, not necessarily the
  whole 8k file:

  A factual frame (fill the variables; ship no concrete imperative):

  > `In this repository AMBIENT.md states the rules that bind every session
  > regardless of task: {objective_comes_only_from_the_live_task},
  > {a_protected_pause_withholds_only_the_effect_it_names},
  > {correct_is_a_different_claim_from_reachable},
  > {retrieve_and_quote_the_source_before_deciding_or_claiming}, and
  > {one_question_in_chat_resolves_an_underdetermined_instruction}. The full
  > text is at AMBIENT.md.`

  Injecting the whole 8,192-byte AMBIENT is within the ≤10k cap and is the
  choice if the owner wants guaranteed presence over token thrift; the pointer
  is the default because compaction can recur and the full file is one open
  away. This is an open choice (§12).

- **The compact handler also resets the per-leaf dedup markers** (§9): after a
  compaction the leaf pointers a session already saw are gone from context, so
  the markers that would suppress re-injection must be cleared for that session
  id. Mechanism: `--ambient` deletes `…/trellis-rules-inject/<repoKey>-<sid>-*.fired`
  before returning. Without this, a post-compaction edit stays silent and the
  leaf is lost for the rest of the session — a quiet regression.

---

## 6. `--edit` — the per-leaf edit triggers (PostToolUse, presence-only)

On a `PostToolUse` for `Edit|Write|MultiEdit` the injector: reads the payload,
makes `tool_input.file_path` repo-relative, unions it through the §3 table
(reusing `wiki_check.mjs`'s exported glob functions), and for each matched leaf
not already fired this session (§9) emits a **pointer** as `additionalContext`.
No match, or all matches already fired → `{ suppressOutput: true }`.

`PostToolUse` (not `PreToolUse`) because these leaves are **awareness, not a
block** — consistent with "hooks report" (`.claude/README.md`). The first edit
under a glob is therefore unprotected and the pointer lands from the second edit
onward; that is acceptable for presence and is *not* acceptable only where a
genuine pre-emptive block is wanted, which no edit-shaped leaf asks for.

---

## 7. The injected pointer — factual framing, one hop to the full leaf

The injected string is prompt bytes that prime every future session, so it is
authored under the same discipline as any other prompt (this plan invoked
`prompt-engineering` and `hypershot-protocol` before writing it — rule 16). Two
properties are load-bearing:

1. **Factual, never imperative** (asserted mechanic + the leaves' own framing):
   the pointer *states what is true of Trellis*, it does not *order the model*.
2. **A pointer, not the whole leaf** (cost, §9): two-to-three factual sentences
   plus the one-hop path. The full leaf is `.claude/rules/<leaf>.md`, one open
   away, and the model already carries `AGENTS.md`'s index telling it so.

The pointer template as a hypershot (a frame with free variables — ship no
filled-in concrete instance into the script's own constant table except the one
factual rendering per leaf, which is invariant text, not an example to
pattern-match):

> `In this repository, {kind_of_work} is governed by
> .claude/rules/{leaf}.md: {two_or_three_clauses_stating_what_is_true_of_trellis_here}.
> The full rule is at .claude/rules/{leaf}.md.`

Filled for `substrate-writes` (factual, non-imperative, ~exemplary length):

> `In this repository, writes to the content-addressed store, its provenance,
> and the surfaces that retrieve it are described in
> .claude/rules/substrate-writes.md: AST nodes are addressed by content and
> final at write time, a correction to an entity is written beside it as an
> overlay belief, and every default retrieval surface returns live blocks only.
> The full rule is at .claude/rules/substrate-writes.md.`

Author one such factual rendering per leaf in the injector's table. Each must
pass the same read as the leaves: a statement a reader could check against the
code, carrying no "you must". Because the renderings are invariant (identical on
every fire), they are correct at the system layer per the hypershot
invariance test — they are the injector's own vocabulary, not variant examples.

---

## 8. `--bash` — the two command-shaped leaves (PreToolUse Bash)

`commit-and-pr` and `spend-and-live-infrastructure` fire on commands, not files,
so a file glob cannot reach them. The `PreToolUse` `Bash` handler calls the
injector, which reads `payload.tool_input.command` (a string), normalizes it,
and matches command patterns with anchored / word-boundary regexes (to avoid
firing on the word "docker" inside an unrelated string):

- **`commit-and-pr`** — command matches `git commit`, `git push`,
  `gh pr create`, `gh pr edit`.
- **`spend-and-live-infrastructure`**, in three tiers:
  - *live tier* — `docker …`, `ssh …`, `npm run drill:*`
  - *destructive tier* — `down --volumes`, `FLUSHALL`, `DETACH DELETE`
    (and truncate / volume-rm forms)
  - *spend tier* — `--confirm-paid`, `OPENAI_API_KEY`

**Reminder vs. enforcement — an owner call, flagged not decided.** A tension the
plan must not paper over:

- The repo's standing property is **hooks report, they do not enforce**
  (`.claude/README.md`; `wiki_check.mjs` header).
- A *non-blocking* `PreToolUse` reminder (additionalContext, no
  `permissionDecision`) lands before the **next** inference — i.e. **after** the
  command has already run. So for a spend or a destructive command it informs the
  *next* action, it does not pre-empt *this* one.
- The only way to genuinely stop a spend/destructive command **before** it runs
  is `PreToolUse` returning `permissionDecision: "ask"` or `"deny"` — which **is
  enforcement**, a departure from the stated doctrine and a standing-configuration
  values call reserved to the collaborator (rule 21(b)).

**Default in this plan:** all `--bash` firings are **reminders only**
(additionalContext, no `permissionDecision`), consistent with "hooks report".
Whether the destructive tier and the spend tier should instead *block*
(`permissionDecision`) is put to the owner (§12) — the plan wires the reminder
and leaves the enforcement switch off until the owner rules.

---

## 9. Accumulation and cost — how re-injection is kept bounded

Injected text re-fires on every matching event and accumulates at full token
cost. Three mitigations, applied in the one script:

1. **Pointer, not full leaf** (§7). ~3 sentences vs. 5–8k bytes per fire.
2. **Once-per-session dedup marker — reuse the wiki_check pattern exactly.**
   Marker dir `os.tmpdir()/trellis-rules-inject/`, file
   `<repoKey>-<sessionId>-<leaf>.fired` where
   `repoKey = sha256(REPO_ROOT).slice(0,12)` and `sessionId` comes from the
   payload (mirrors `wiki_check.mjs` lines 592–598). A leaf whose marker exists
   emits nothing; the first matching edit writes the marker and injects. This
   turns cost from **O(edits)** to **O(distinct leaves touched)** per session —
   "once per era", the era being the session, reset only by §5's compact clear.
3. **Factual framing** (§7) — not a cost lever but the property that keeps
   injected text absorbed rather than surfaced to the user as a suspected
   injection.

The cap (≤10k) is a ceiling the pointer design sits far under; it binds only a
hypothetical whole-leaf inject, which §7 does not do.

Era-reset subtlety (open choice, §12): the session-keyed marker means a leaf
injects once and stays quiet even across a compaction — unless §5's compact
handler clears the markers, which it does by default so a leaf survives
compaction the way the doctrine wants. If the owner prefers strict
once-per-session-ever, drop the clear.

---

## 10. THE VERIFICATION GATE — prove a hook fires before trusting it

**A wired-but-unverified hook is a silent-failure trap**: the `matcher` fires,
the script runs, and yet `additionalContext` never reaches the model because the
output shape, the field name, the `if` semantics, or the exit code was wrong —
and nothing errors. This session **could not run any hook** (they fire in future
sessions). So the following spawn-test is the **gate**: no leaf is trusted until
it passes. Run it per-mode after wiring, before relying on the channel.

### Instrument first: a deterministic side-log

Before testing, have the injector append one line to a side-log on **every**
fire (behind the same code path that emits `additionalContext`):

```
$TMPDIR/trellis-rules-inject/fired.log   <iso>\t<event>\t<leaf>\t<path-or-command>
```

This is fully under our control and does not depend on any Claude-Code-internal
transcript schema. It answers "did the script run and route correctly?".

### The spawn-test (edit mode)

```bash
# 0. Clean start: git status clean (except this plan); rm any stale fired.log/markers.
#    Pick a probe path under a real leaf glob but harmless:
#      PROBE=src/core/ast/__hook_probe__.tmp   # matches substrate-writes: src/core/{ast,...}/**

# 1. Spawn a non-interactive, tool-limited Claude that makes TWO edits (the first
#    is unprotected; the pointer must be in context by the second), then reports
#    any rules text it received:
claude -p "Create the file src/core/ast/__hook_probe__.tmp containing the text probe-1, then edit that file so it contains probe-2. Then print, verbatim, any system-reminder text about repository rules you received between the two edits. Do nothing else." \
  --allowedTools "Write,Edit,Read" \
  --output-format json  > probe_out.json 2> probe_err.log

# 2a. FIRED (deterministic, primary): the side-log has a substrate-writes line for the probe path.
grep -F "substrate-writes" "$TMPDIR/trellis-rules-inject/fired.log"

# 2b. DELIVERED (deterministic): grep the spawn's own transcript JSONL for the pointer's
#     distinctive phrase. The session id is in probe_out.json; the transcript lives under
#     ~/.claude/projects/<project-slug>/<session-id>.jsonl. additionalContext is persisted there.
grep -F "returns live blocks only" <that transcript.jsonl>

# 2c. ACTED (best-effort, corroborating): probe_out.json's final text echoes the pointer,
#     proving the model saw it on the second inference (a model may decline to echo — do not
#     fail the gate on 2c alone).

# 3. Cleanup: rm src/core/ast/__hook_probe__.tmp, rm the fired.log and markers, confirm git clean.
```

### The pass bar, and the trap it catches

- **PASS** = **2a FIRED** *and* (**2b DELIVERED** *or* **2c ACTED**). The script
  ran, routed to the right leaf, and the text demonstrably reached the context.
- **The trap** = **2a FIRED but neither 2b nor 2c** — the hook is wired and
  routing, yet the injected text never entered the model's context. This is the
  silent failure. Cause is almost always the output shape: `additionalContext`
  must be nested in `hookSpecificOutput` with the right `hookEventName` and the
  script must exit 0 (per §1's confirmed `wiki_check.mjs` shape). Fix the shape
  and re-run; **do not trust the leaf until 2b or 2c is green.**
- **2a itself empty** = the wiring is wrong upstream of the script: wrong
  `matcher`, wrong event, wrong `$CLAUDE_PROJECT_DIR` path, or the script threw
  before logging. Fix wiring; the script never got a fair chance.

### Coverage — one representative per mechanic, not all nine

Run the edit-mode spawn for **at least**: one plain glob leaf (`substrate-writes`
via `src/core/ast/…`), one contract-derived leaf (`governed-documents` via a
throwaway edit to a `rootFiles` path — use a copy/probe, not a real governed
doc), and one overlap path (`.claude/agents/__probe__.md`, which must FIRE three
leaves and log three lines). Run the **`--bash`** spawn with a benign matching
command (e.g. a dry `gh pr create --help` style string, or `docker ps`) and
confirm `commit-and-pr` / `spend-and-live-infrastructure` log and inject —
**without** letting any real spend or destructive command run; match on a
harmless argv. Run the **`--ambient`** path by triggering a compaction (or invoke
the script directly with a synthetic `{"hook_event_name":"SessionStart"}` on
stdin) and confirm AMBIENT text is delivered and the markers are cleared.

Honesty on 2b: this session did not confirm the exact transcript JSONL schema or
that `additionalContext` is written to it verbatim. Treat 2a (side-log) as the
**primary** deterministic signal, 2b as the **preferred** delivery proof, and 2c
as the fallback when 2b's schema differs. If **only** 2a ever goes green across
every attempt, the injection is not reaching the model — report that and hold the
channel untrusted rather than shipping a silent reporter.

---

## 11. What this session could not verify

- **No hook was run.** Every "asserted" mechanic in §1 (the `if` field and its
  glob syntax, the 10k cap, PostToolUse/PreToolUse timing, the `compact`
  matcher, before-next-inference injection) is un-execute-tested here. The §10
  gate is the instrument that converts each into a checked fact.
- **The transcript-delivery path (2b)** — whether `additionalContext` lands in
  the session JSONL verbatim, and where that file sits — is asserted from the
  wiki_check `SessionStart` usage, not observed end-to-end.
- **`if`-on-Bash for command matching** (the §12 alternative) was not tried; the
  plan routes commands *inside* the script for that reason.
- **The new `tools/agents-rules/` path's** interaction with the density-trellis
  router and root-contract surface check is anticipated (§4) but not resolved —
  a follow-on in the same change.

Trust nothing in §§3–9 as *operational* until the matching §10 spawn goes green.
The plan is precise about mechanism and deliberately un-boastful about outcome.

---

## 12. Open choices tomorrow's session must make

- **Reminder vs. enforcement on the two Bash tiers (§8).** Owner call. Default
  wired = reminder-only, consistent with "hooks report". Ask the collaborator
  whether the *destructive* tier and the *spend* tier should instead return
  `permissionDecision: ask|deny` (genuine block). This is standing configuration
  (rule 21(b)) — put the recurring-charge question, do not self-decide.
- **Full-AMBIENT vs. pointer on `compact` (§5).** Whole 8k file (guaranteed
  presence, within cap) vs. the five-headline pointer (token-thrifty, full file
  one hop away). Default = pointer.
- **Compact clears the dedup markers, or not (§5, §9).** Default = clears, so a
  leaf survives compaction. Alternative = strict once-per-session-ever.
- **Script-routed vs. `if`-gated handlers (§2, §4).** Default = all globs in the
  script, thin `settings.json`. Alternative = one `PostToolUse` handler per leaf
  carrying its own `if: "Edit(<glob>)"`, invoking the injector with `--leaf NAME`
  — declaratively visible in `settings.json`, native glob evaluation, no
  per-edit node spawn on non-matching paths, at the cost of nine globs duplicated
  out of the leaves (drift risk). If chosen, `governed-documents` still cannot be
  expressed statically and stays script-derived, so the design is hybrid either
  way.
- **PostToolUse-vs-PreToolUse per edit-shaped leaf (§6).** Default = PostToolUse
  (presence). Only revisit if some leaf is later judged to need a pre-emptive
  block, which reopens the enforcement question above.
- **A coarse `if` union pre-filter (§2 cost note).** Only if per-edit node-spawn
  latency is observed to bite; otherwise omit.
- **Unconditional startup AMBIENT restate (§5).** Off by default (redundant with
  normal context load); a one-line add if the owner wants it.
- **`standing-configuration`'s memory-file clause (§3).** Confirm it is delivered
  by the leaf text on any in-repo standing-config path fire, since memory paths
  sit outside the worktree and no glob can reach them.
- **Settle the new `tools/agents-rules/` surface (§4, §11)** with the
  density-trellis router and `root-contract.json` in the same change.

---

## 13. Boundaries this plan kept

This session wrote **only** `docs/architecture/AGENTS_HOOKS_PLAN.md`. It changed
no `settings.json`, created no script, wired no hook, and edited nothing else.
Every install decision above is deferred to the executing session, and the two
that are values/scope calls (Bash enforcement; any standing-config install) are
routed to the collaborator, not pre-decided here.
