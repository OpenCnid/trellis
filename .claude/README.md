# `.claude/` — committed harness configuration

Two things live here, both **DERIVED** under [`AGENTS.md`](../AGENTS.md) §1.5 and §2.1: they deploy
decisions made in records elsewhere, and on any drift the record wins and the copy is corrected.

| Path | What it is | Its canonical authority |
|---|---|---|
| [`skills/`](skills/) | project skills Claude Code auto-loads for anyone working in this repository | each skill's own design record — see [`skills/README.md`](skills/README.md) |
| `settings.json` | `Stop` and `SessionStart` hooks that run the density-trellis staleness checker | [`docs/density-chain/README.md`](../docs/density-chain/README.md) |

## What this directory is not

**It is not a record, a contract, or a gate.** Nothing here asserts a claim, so nothing here can be
disagreed with; it has enforcement standing and no authority standing, and those are two different
axes in this repository. [`docs/architecture/REPOSITORY_ROOT_CONTRACT.md`](../docs/architecture/REPOSITORY_ROOT_CONTRACT.md)
governs the repository's *surface* — that `.claude/` is a permitted top-level directory — and
deliberately does not govern what is inside it. A rule policing `.claude/` contents would register one
vendor's file shape as law, which hard rule 17 names as the trap: a second harness's config would need
a second rule under a different name, so the first was never a frame.

## No behaviour depends on this directory

This is the load-bearing property, and it is hard rule 15 applied one level up: *correct is not the
same claim as reachable.* `settings.json` binds one vendor's agent runtime on machines that have it.
A contributor using a different harness, or none, runs none of it. So every behaviour it triggers has
a portable caller that does not need it:

| Convenience here | Portable caller that actually holds the line |
|---|---|
| `Stop` / `SessionStart` density-trellis hooks | `npm run wiki:check` by hand, and `npm run wiki:check -- --verify` in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) |

If you are reading this because a hook did something surprising: the hooks **report**, they do not
enforce. Detection is tooling shape; the dispatch text a hook emits is a reminder, and nothing
executes it.

## Why committed at all

The same reason the skills are: so the tooling loads for anyone working in the repository without a
per-person install, and so a session's inventory of what is available is the repository's, not a
particular laptop's. The cost is real and worth stating plainly — **cloning this repository and opening
it in Claude Code causes `node tools/density-chain/wiki_check.mjs` to run on your machine.** A pull
request that edits that script is a pull request that changes what executes automatically for every
reviewer who uses this harness. Review it on those terms.

Personal overrides belong in `settings.local.json`, which is gitignored.
