# caveman (Trellis edition) — engineering teardown & maintainer guide

Ultra-compressed **chat** mode. Claude answers you like a smart caveman —
articles/filler/pleasantries dropped, technical substance and all Trellis
vocabulary kept exact. Measured ~65% output-token cut upstream. Auto-on every
session; no `/caveman` needed.

This is a reverse-engineered, simplified, **repo-native** adaptation of
[`JuliusBrussee/caveman`](https://github.com/JuliusBrussee/caveman) (the most
popular caveman skill), tailored to this project and to Claude Code on the web.

---

## 1. Why you kept having to call it

The upstream skill (and every personal skill/hook in your `~/.claude/`) lives
on your **local machine**. Claude Code on the web boots a fresh container cloned
**from the repo only** — personal skills and hooks do not travel with it. So in
web sessions the caveman skill simply wasn't present; nothing could auto-init.

Second, a subtlety worth internalizing: **a skill never auto-initiates by
itself.** A skill runs only when you type `/caveman` or when the model chooses
to load it. The thing that runs automatically is a **hook** — a command the
harness fires on an event. "Caveman on a hook" means: a `SessionStart` hook
injects the ruleset every session. Skill ≠ hook. Upstream pairs them; so do we.

Fix in this repo: the skill **and** its hooks are committed, so every future
session — web or local — has caveman from message one.

---

## 2. What we ship (5 files)

```
.claude/
├── settings.json                  # wires the two hooks + allows the Skill tool
├── skills/caveman/
│   ├── SKILL.md                   # behavior — THE single source of truth
│   └── README.md                  # this file
└── hooks/
    ├── caveman-activate.sh        # SessionStart  → injects full ruleset once
    └── caveman-reinforce.sh       # UserPromptSubmit → re-anchors every turn
```

**The two-tier injection is the whole trick:**

```
SessionStart ──cat SKILL.md body──▶  full ruleset injected as system context (once)
UserPromptSubmit ──per turn──────▶  ~30-token reminder (survives compression/drift)
```

Tier 1 teaches the rules strongly. Tier 2 keeps them in the model's attention
after long conversations and competing instructions bury the tier-1 anchor —
the documented failure mode where "models drift back to verbose mid-session."

---

## 3. Upstream architecture (the full teardown)

Faithful map of how `JuliusBrussee/caveman` actually works, so edits here are
informed. Source of truth for behavior is one file; everything else is plumbing.

| Piece | File (upstream) | Job |
|-------|-----------------|-----|
| Behavior | `skills/caveman/SKILL.md` | YAML frontmatter (`name`, `description` w/ trigger phrases) + Markdown rule body. The prompt the model loads. |
| Auto-init | `src/hooks/caveman-activate.js` (SessionStart) | Resolve mode → write flag → **read SKILL.md at runtime, strip frontmatter, filter the intensity table to just the active level, print to stdout.** Claude Code injects SessionStart stdout as hidden system context. Hardcoded fallback ruleset if SKILL.md not found. |
| Anti-drift | `src/hooks/caveman-mode-tracker.js` (UserPromptSubmit) | Parse each prompt for `/caveman <level>` + natural-language on/off; update flag; emit a small `hookSpecificOutput.additionalContext` reminder each turn. |
| Shared state | `src/hooks/caveman-config.js` | `getDefaultMode()` cascade (env `CAVEMAN_DEFAULT_MODE` → repo-local `.caveman/config.json` → user config → `full`); `safeWriteFlag`/`readFlag` symlink-safe flag IO; mode-transition log. |
| Badge | `src/hooks/caveman-statusline.sh` | Reads flag, renders `[CAVEMAN]` / `[CAVEMAN:ULTRA]`. Cosmetic. |
| CJS pin | `src/hooks/package.json` = `{"type":"commonjs"}` | Forces `.js` hooks to resolve as CommonJS even under an ancestor ESM `package.json`, else `require()` throws. |
| Wiring | `.claude-plugin/plugin.json` | Registers both hooks with `${CLAUDE_PLUGIN_ROOT}` paths; `timeout: 5`. |

**Engineering ideas worth stealing (and why):**

1. **SKILL.md read at runtime by the hook** → one source of truth, zero
   duplication between "the skill" and "what the hook injects." Edit behavior in
   exactly one place.
2. **Intensity table filtered to the active row** before injection — inject one
   level's rules, not all six. Token economy applied to its own prompt.
3. **Flag file as shared state** between the two hooks + statusline. Because the
   path is predictable (`~/.claude/.caveman-active`), all reads/writes are
   symlink-refusing, size-capped (64 B), and whitelist-validated — a local
   attacker could otherwise symlink it at `~/.ssh/id_rsa` and have the
   statusline/reinforcer echo or inject the secret bytes. Genuinely careful
   security for a joke-flavored tool; the lesson (never trust a predictable
   user-writable path) is the transferable part.
4. **Config cascade with repo-local `.caveman/config.json`** → a team pins a
   per-project default mode without touching anyone's global config. This is the
   real "auto-init tailored to us" seam.
5. **Auto-clarity guardrail** in SKILL.md — drop caveman for security warnings,
   irreversible ops, and genuine ambiguity. Non-negotiable for a coding agent.
6. **Boundaries** — code/commits/PRs written normal; only prose compresses.

Upstream also ships `lite/full/ultra` **plus** `wenyan-*` (classical-Chinese)
levels, sibling skills (`caveman-commit`, `caveman-review`, `caveman-compress`,
`caveman-stats`, `cavecrew` subagents), a 30+-agent installer (`bin/install.js`,
`PROVIDERS` array), and a three-arm eval harness (`__baseline__` / `__terse__` /
`<skill>` — honest delta is **skill vs terse**, not vs baseline). None needed
here; noted for completeness.

---

## 4. How ours differs (and why)

| Upstream | Ours | Reason |
|----------|------|--------|
| Node.js hooks | **bash hooks** | Zero deps, no CJS/ESM pin, trivially reviewable. |
| Flag file + statusline + mode log | **none** | Single always-on project mode. No cross-session state to track; web statusline isn't ours to write. |
| Config cascade (env/repo/user) | env `CAVEMAN_MODE` only | One project, one default. `off` still supported. |
| `lite/full/ultra` + 6 wenyan levels | `lite/full/ultra` | We write English; wenyan is dead weight in the injected prompt. |
| Global `~/.claude` plugin install | **committed `.claude/` in the repo** | Web sessions clone the repo, not your laptop. Committing is the only thing that survives. |
| Generic "technical terms exact" | **explicit Trellis vocab clause** | Protects `RLM`, `UPSUM`, `S2a`, `TTT`, `EL-0x`, `contested`, `promotion`, glossary headwords, `Session NN`, `LANDED`/`FAILED`, doc names. Compression must never mangle authority-order vocabulary. |

Persistent on/off toggle is the one capability we dropped: `stop caveman`
suppresses the reminder for that turn but doesn't persist across turns (no flag
file). See §7 to add it back if wanted.

---

## 5. Edit / recreate — step by step

**Change behavior:** edit `SKILL.md` only. The SessionStart hook re-reads it
each session; nothing else to touch. Keep the `## Auto-Clarity`, `## Boundaries`,
and `## Trellis vocabulary` sections — they are load-bearing.

**Change the default level:** set `CAVEMAN_MODE` (`lite`/`full`/`ultra`/`off`)
in the environment, or edit the fallback in `caveman-activate.sh` line 1 of
logic. Default `full` — best token/clarity trade for a term-dense codebase;
`ultra` risks ambiguity around precise terms.

**Recreate from scratch (any repo):**
1. `mkdir -p .claude/skills/caveman .claude/hooks`
2. Write `SKILL.md` (frontmatter `name`+`description`; body = rules).
3. `caveman-activate.sh`: `awk 'f{print} /^---[[:space:]]*$/{c++; if(c==2) f=1}' SKILL.md` to print the body past the 2nd `---`, prefixed with `CAVEMAN MODE ACTIVE`. Silent-fail on every error.
4. `caveman-reinforce.sh`: read stdin, print `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"…"}}`.
5. `chmod +x .claude/hooks/*.sh`.
6. `settings.json`: register both under `hooks.SessionStart` / `hooks.UserPromptSubmit` with `bash "${CLAUDE_PROJECT_DIR}/.claude/hooks/<file>.sh"`.
7. Verify: `bash .claude/hooks/caveman-activate.sh` prints the ruleset; `printf '{"prompt":"hi"}' | bash .claude/hooks/caveman-reinforce.sh | node -e 'process.stdin.on("data",d=>JSON.parse(d))'` parses.

**Activation caveat:** hooks fire at session start / config load, so they take
effect in the **next** session, not retroactively in the one that added them.
If the web harness gates repo-defined hooks behind a trust prompt, approve once.
The `/caveman` skill works immediately regardless.

---

## 6. Verify it's working

- New session: the first reply should already be terse (no "I'd be happy to…").
- Manual: `bash .claude/hooks/caveman-activate.sh | head` prints the ruleset.
- Off: say `stop caveman` / `normal mode`, or set `CAVEMAN_MODE=off`.

---

## 7. Improvement roadmap

- **Persistent on/off** — port upstream's flag file (`.claude/.caveman-active`,
  gitignored). Reinforcer reads it; on/off phrases write it. Restores durable
  toggle without pulling in Node.
- **Per-turn savings meter** — count reply tokens; expose lifetime savings so
  the quota win is visible (upstream does this via `caveman-stats`).
- **Sibling skills** — `caveman-commit` (Conventional Commits, ≤50-char
  subject) and `caveman-review` (`L<line>: <sev> <problem>. <fix>.`) are cheap,
  high-value adds for this repo's workflow.
- **Guaranteed-load fallback** — if repo hooks aren't auto-trusted in web
  sessions, a one-line pointer in `AGENTS.md` ("chat replies use caveman mode;
  see `.claude/skills/caveman/SKILL.md`") auto-loads with project context and
  needs no hook. Heavier (touches a shared file) — hold unless hooks prove
  untrusted.
- **Eval before tuning** — copy upstream's `skill-vs-terse` harness before
  claiming a token number for *our* variant; never quote upstream's 65% as ours.

---

## Attribution

Adapted from [`JuliusBrussee/caveman`](https://github.com/JuliusBrussee/caveman)
(MIT). Behavior rules and the two-tier hook design are upstream's; the bash
port, Trellis vocabulary clause, and repo-native wiring are local.
