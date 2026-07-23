# Scheduling the dedupe ceremony

This is the install guide for running [`dedupe.md`](dedupe.md) on a timer, on any
machine, unattended. The ceremony reads a governed document, returns each drifted
claim to one home, and **opens one pull request** — it never merges. A human
holds the merge gate, so an unattended firing is safe by construction: its worst
output is a PR nobody wanted, which is closed in one click.

Set it up once per machine. The parts that travel with the repository are called
out so a new host inherits them by checkout rather than by copying.

---

## 1. What each firing does

```
claude -p "$(cat .claude/ceremonies/dedupe.md)"
```

One `claude` invocation in print mode, from the repository root. It selects the
document with the most uncommitted drift, reads it whole, counts with tools,
sorts each repetition by whether an anchor holds it in place, and either opens a
PR or reports "No edits." A clean scan ends the run in seconds and costs almost
nothing, which is why frequent firing is safe.

## 2. Prerequisites (per machine)

| Need | Check | If missing |
|---|---|---|
| A working checkout of this repo | `git -C <repo> rev-parse HEAD` | `git clone https://github.com/OpenCnid/trellis` |
| Node + npm, deps installed | `npm ci` in the repo | worktrees ship without `node_modules` — run `npm ci` |
| The `claude` CLI on PATH | `claude --version` | install Claude Code |
| GitHub auth for PR creation | `gh auth status` | `gh auth login` once, as the machine's operator |
| Model access configured | one manual `claude -p "say ok"` | sign in to Claude Code once interactively |

Run one manual firing before scheduling anything (§6). A scheduler that fires
into an unauthenticated CLI produces silent no-ops.

## 3. The permission model — read this before the scheduler

An unattended `claude -p` run **cannot answer a permission prompt**: there is no
one at the keyboard. A tool call that would prompt is refused instead, and the
run fails visibly rather than hanging — which is the safe failure, but only if
the allow-list is complete. So the ceremony's whole command surface is
pre-authorized, and nothing else is.

**Grant exactly these, and travel them with the repo.** Put the allow-list in the
committed `.claude/settings.json`. Permission rules are the one settings category
that **merges across every scope instead of the highest one winning**, so a
committed project allow-list is inherited by every machine that checks out the
repo and composes with whatever local settings that machine already has. One edit,
every host — openclaw, hermes, and any future box — covered by checkout.

```jsonc
// .claude/settings.json — the "permissions" block (committed; travels)
{
  "permissions": {
    "allow": [
      "Bash(npm run upsum:*)",
      "Bash(npm run check:repo-surface)",
      "Bash(npm run wiki:check)",
      "Bash(npm test)",
      "Bash(git status:*)", "Bash(git log:*)", "Bash(git diff:*)",
      "Bash(git add:*)", "Bash(git commit:*)", "Bash(git push:*)",
      "Bash(git checkout:*)", "Bash(git branch:*)", "Bash(git fetch:*)",
      "Bash(gh pr create:*)", "Bash(gh pr view:*)", "Bash(gh pr checks:*)",
      "Read", "Grep", "Glob", "Edit"
    ]
  }
}
```

**Two things this list deliberately withholds, and why they are safe to withhold:**

- **No `gh pr merge`.** The ceremony opens a PR and stops; the merge is the
  owner's, so the capability is absent rather than trusted. An unattended loop
  that could merge its own work would be a loop with no gate.
- **No write access to `.claude/**`.** That path is protected: Claude Code never
  auto-approves a write to it under any mode short of full bypass, and the check
  runs *before* allow rules — so an `Edit(.claude/**)` rule would be silently
  ignored anyway. The ceremony never needs it: its target set is governed
  documents (`AGENTS.md`, `docs/architecture/`, `docs/product/`), and its own
  instruction file and rulings ledger sit *outside* that set on purpose, so the
  loop cannot rewrite the prompt that drives it.

**Do not reach for `--dangerously-skip-permissions`.** It trades a
fourteen-command allow-list for turning off every protection at once, to solve a
problem the allow-list already solves. It is especially wrong on an unattended
box: the guard that refuses to start bypass mode as root **lapses inside a
sandbox**, so a root-plus-bypass scheduled task removes exactly the last line of
defense on the machine most likely to run headless.

If a machine genuinely cannot use the committed project settings, pass the same
surface explicitly instead:

```bash
claude -p "$(cat .claude/ceremonies/dedupe.md)" \
  --allowedTools "Bash(npm run:*)" "Bash(git:*)" "Bash(gh pr create:*)" \
                 "Bash(gh pr view:*)" Read Grep Glob Edit
```

## 4. A launch wrapper (per machine, not committed)

The scheduler calls a tiny wrapper so the repo path, PATH, and log destination
live in one place. This file holds a machine-specific absolute path, so it stays
**out of the repository** — it is the one piece that does not travel.

**Unix** — `~/bin/trellis-dedupe.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
REPO="${TRELLIS_REPO:-$HOME/src/trellis}"   # this machine's checkout
cd "$REPO"
git fetch --quiet origin
# Cheap exit: nothing merged since our last ceremony PR means nothing to do.
git log --oneline origin/master -1 > /tmp/trellis-dedupe.head
exec claude -p "$(cat .claude/ceremonies/dedupe.md)" >> "$HOME/trellis-dedupe.log" 2>&1
```

```bash
chmod +x ~/bin/trellis-dedupe.sh
```

**Windows** — `%USERPROFILE%\bin\trellis-dedupe.ps1`:

```powershell
$ErrorActionPreference = "Stop"
$Repo = $env:TRELLIS_REPO ; if (-not $Repo) { $Repo = "$env:USERPROFILE\src\trellis" }
Set-Location $Repo
git fetch --quiet origin
$prompt = Get-Content .claude\ceremonies\dedupe.md -Raw
claude -p $prompt *>> "$env:USERPROFILE\trellis-dedupe.log"
```

## 5. Register the schedule

Fire **every four hours**. At ~8.5 merges/day into this repo, that meets drift
while it is one claim rather than a day's worth; and because "No edits" and "one
open ceremony PR at a time" are both first-class, a firing that has nothing to do
simply exits. Pick an off-hour minute so a fleet of machines does not all wake at
:00.

### Linux — systemd timer (preferred; survives reboot, logs to journal)

`~/.config/systemd/user/trellis-dedupe.service`:

```ini
[Unit]
Description=Trellis dedupe ceremony

[Service]
Type=oneshot
ExecStart=%h/bin/trellis-dedupe.sh
```

`~/.config/systemd/user/trellis-dedupe.timer`:

```ini
[Unit]
Description=Trellis dedupe ceremony, every 4h

[Timer]
OnCalendar=*-*-* 00,04,08,12,16,20:07:00
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
systemctl --user enable --now trellis-dedupe.timer
systemctl --user list-timers trellis-dedupe.timer   # confirm next fire
loginctl enable-linger "$USER"                       # fire while logged out
```

### Linux/macOS — cron (simplest)

```cron
7 */4 * * *  $HOME/bin/trellis-dedupe.sh
```

### macOS — launchd (preferred over cron; survives reboot)

`~/Library/LaunchAgents/com.trellis.dedupe.plist`, `StartCalendarInterval` with
four `Hour` entries (0, 4, 8, 12, 16, 20) at `Minute` 7, `ProgramArguments`
pointing at the wrapper. `launchctl load` it.

### Windows — Task Scheduler

```powershell
$action  = New-ScheduledTaskAction -Execute "pwsh.exe" `
  -Argument "-File `"$env:USERPROFILE\bin\trellis-dedupe.ps1`""
$trigger = New-ScheduledTaskTrigger -Once -At 12:07am `
  -RepetitionInterval (New-TimeSpan -Hours 4)
Register-ScheduledTask -TaskName "Trellis dedupe ceremony" `
  -Action $action -Trigger $trigger -Description "Opens a dedupe PR; never merges."
```

## 6. Verify the install before trusting it

1. **One manual firing**, watching it work:
   ```bash
   ~/bin/trellis-dedupe.sh   # or run the ceremony directly and read the output
   ```
   A healthy run ends in either an opened PR or a reported "No edits."

2. **The positive control.** A ceremony that always finds work manufactures it,
   so confirm it can decline. Point one run at an already-clean document:
   ```bash
   claude -p "Run .claude/ceremonies/dedupe.md against fixtures/dedupe_ceremony/clean_record.md only. Report the outcome."
   ```
   The outcome must be **"No edits."** A run that cannot decline on a clean
   document carries no information when it acts on a dirty one — this is the check
   that the whole schedule rests on, so run it after any change to `dedupe.md`.

3. **Confirm the gate.** The allow-list has no `gh pr merge`, so verify a firing
   opens a PR and stops, leaving it for a human.

## 7. Per-host registry

Fill one row per machine as you install it. This table travels with the repo so
the fleet's state is visible in one place; the wrapper paths it references do
not.

| Host | OS / scheduler | Repo checkout | Operator (gh auth) | Installed |
|---|---|---|---|---|
| openclaw | _fill: e.g. Linux / systemd timer_ | _fill: path_ | _fill: gh account_ | _date_ |
| hermes | _fill: e.g. macOS / launchd_ | _fill: path_ | _fill: gh account_ | _date_ |
| _your host_ | | | | |

**For openclaw and hermes specifically:** the only per-host facts are the four in
that row. Everything else — the ceremony, the permission allow-list, the rulings
ledger, the self-play fixtures — is already in the checkout. Install is: clone,
`npm ci`, `gh auth login`, drop the wrapper, register the timer, run the §6
verification, fill the row.

## 8. If a firing misbehaves

| Symptom | Likely cause | Fix |
|---|---|---|
| Every firing is a silent no-op | CLI unauthenticated on this host | `claude -p "say ok"` interactively once |
| Run stops early, "permission denied" | A command outside the allow-list | add the exact `Bash(...)` pattern to committed settings (§3) |
| Two open ceremony PRs | The "one open PR" guard needs the previous one resolved | merge or close the older PR; the loop resumes |
| PR opened but tests red in CI | The ceremony's edit broke a bind | close it; the bind test in `dedupe.md` step 5 is what should have caught it — that is a ceremony bug to file, not a merge to force |

The repository is the record. Anything a firing leaves only on a machine — a log,
a scratch branch — is not a result until it is in a PR.
