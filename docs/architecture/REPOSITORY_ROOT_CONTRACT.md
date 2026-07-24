# Repository Root Contract

**Status: RATIFIED — July 21, 2026.** This record implements the collaborator's
agent-first repository-surface direction. The machine twin is
[`tools/repository-surface/root-contract.json`](../../tools/repository-surface/root-contract.json),
and `npm run check:repo-surface` enforces it.

## 1. Purpose

The repository root is an interface, not a filing cabinet. Its entries are the
small set that a tool auto-discovers, a zero-context agent must find before it
can navigate, or an ecosystem convention makes materially more usable. Reports,
historical ledgers, specialized dependency layers, and reference manuals live
in named directories even when keeping them at root would be familiar to a
human.

The priority order is:

1. deterministic tool discovery;
2. bounded agent startup context;
3. one canonical authority per concern;
4. conventional human discovery where it does not compromise the first three.

## 2. The permitted root files

| File | Class | Why it remains at root |
|---|---|---|
| `AGENTS.md` | agent entrypoint | Repository-wide harness discovery and permanent rules. |
| `HANDOFF.md` | compatibility stub | Preserves the retired well-known path without carrying an objective. |
| `README.md` | bounded router | Ecosystem landing page and short map to agent, operator, and reference surfaces. |
| `package.json`, `package-lock.json` | Node project boundary | Dependency lock, command registry, and npm working directory. |
| `tsconfig.build.json`, `vitest.config.ts` | tool discovery | Build and test configuration used by root package commands. |
| `conftest.py`, `pytest.ini` | tool discovery | Python test configuration. Root-anchored because pytest resolves rootdir and `conftest` discovery relative to the invocation root; the Python peers of the row above. |
| `requirements.txt` | Python base manifest | Conventional direct-runtime install surface; specialized PDF layers are grouped under `requirements/`. |
| `Dockerfile`, `docker-compose.yml`, `.dockerignore` | container discovery | Preserve zero-flag Docker and Compose commands with the repository as build context. |
| `.env.example` | configuration entrypoint | Copy-to-`.env` setup surface, checked against the validated TypeScript schema. |
| `.gitignore`, `.gitattributes` | repository semantics | Repository-wide exclusions and byte-stability rules. |
| `LICENSE` | legal metadata | Standard license discovery for source and distribution tooling. |

No raw benchmark result, roadmap, API manual, contribution guide, or specialized
requirements layer belongs at root.

## 3. Bounded navigational documents

The machine twin caps the three root Markdown entrypoints:

- `AGENTS.md`: 32 KiB — enough for permanent rules and the navigation map;
- `HANDOFF.md`: 8 KiB — a compatibility/deprecation router only;
- `README.md`: 8 KiB — identity, routing, system shape, and fast path only.

Machine artifacts such as `package-lock.json` have separate bounds and are not
agent reading obligations. A file being present at root does not imply that an
agent should load it.

## 4. Deprecated session surfaces

The former `HANDOFF.md` and `TRELLIS_ROADMAP.md` stopped tracking the repository
while primitives and their surrounding records continued to land. Their last
active forms also disagreed about the next objective. They are therefore
deprecated as active authority:

- `HANDOFF.md` is now a short compatibility stub;
- the former roadmap is preserved byte-for-byte at
  [`docs/archive/TRELLIS_ROADMAP_DEPRECATED.md`](../archive/TRELLIS_ROADMAP_DEPRECATED.md);
- older progress entries remain in
  [`docs/archive/ROADMAP_HISTORY.md`](../archive/ROADMAP_HISTORY.md);
- no agent selects work from either historical document.

This does not declare the engineering-loop controller adopted, accepted, or
deleted. Its code and program records remain preserved in their existing homes.

## 5. Directory roles

- `.claude/` — project skill auto-discovery **and committed harness
  configuration** for Claude Code; the root agent map links here explicitly for
  other readers. Contents are DERIVED (`AGENTS.md` §2.1) and governed by their
  own records, never by this contract — see [`.claude/README.md`](../../.claude/README.md).
- `.github/` — CI and community metadata.
- `data/` — committed durable corpora and drill state.
- `docs/` — doctrine, designs, references, operations, evidence, and archive.
- `fixtures/` — deterministic test/drill fixtures, excluded from extraction.
- `modules/` — registered userspace module definitions.
- `requirements/` — specialized Python dependency layers.
- `scripts/` — operator entrypoints and live drills.
- `src/` — product, worker, RLM, benchmark, and frontend code.
- `tools/` — out-of-process engineering and repository tooling.

The initial `.agents/` directory was deleted. It had not changed since the
initial commit and routed some harnesses to a second, obsolete rule set. The
root `AGENTS.md` is the single repository-wide authority.

## 6. What the checker proves

`npm run check:repo-surface` is deterministic and zero-paid. It checks:

1. the exact repository-visible root-file and top-level-directory allowlists
   (tracked plus unignored untracked files, with working-tree deletions removed);
2. byte caps for every permitted root file;
3. required deprecation markers and archived-surface presence;
4. local Markdown links outside the immutable archive;
5. complete `.env.example` coverage of the keys declared by `EnvSchema`, with
   a small explicit allowlist for externally consumed keys;
6. the absence of forbidden root result-artifact names, whether or not git
   lists the artifact;
7. the byte budgets the machine twin's `documentUpsum.paths` sets for governed
   documents outside the root, so that `npm run upsum` and this checker cannot
   disagree about whether one is within contract.

`npm run check:repo-surface -- --negative-control` constructs two isolated
temporary repository surfaces from one shared fixture
(`tools/repository-surface/fixture.ts`), under one contract that does not move
between them.

The **positive control** runs first: the contract meets a repaired tree and
must report nothing. A falsifier that has only ever seen failures cannot
distinguish detecting a break from reporting everything, so a detection is
uninformative until this is observed. It also pins the blindness the contract
buys on purpose — a dangling link inside `docs/archive/` is planted in both
trees and must stay unreported in both.

The **negative control** then breaks the same tree in eleven ways, one per
`SurfaceIssue` code, at one path each. It must exit `3` and name every planted
break. A passing normal check is trusted only after both are observed.

Eleven, and not the four planted before July 23, 2026, is the finding. The
fixture had declared `deprecatedSurfaces`, `forbiddenRootFiles` and
`documentUpsum.paths` empty, so those branches were never entered and seven of
eleven codes gated a merge without ever having been seen to fail — including
`oversized_document`, the only merge-gating enforcement the machine twin's
`documentUpsum.paths` budgets have. The durable fix is not the count.
`PLANTED_CODES` in the fixture is a table typed against the `SurfaceIssue`
union, so a twelfth code cannot reach `check.ts` without either a plant or a
deliberate deletion of the table; `npm run build` refuses the mismatch.

That is the same *shape* §8 (Amendments) names — a declaration nothing checks
against its twin — closed here by tooling shape rather than by discipline. It is
not the same instance: §8's gap is `rootFiles` against the §2 table, which
remains unbuilt and unaffected by this. What is closed is `SurfaceIssue` against
the fixture that is supposed to falsify it.

The checker does not decide product architecture, validate external URLs, edit
files, or generate documentation. It verifies only the ratified repository
surface described here.

## 7. Changing the contract

A new root entry requires a concrete auto-discovery or zero-context navigation
need that cannot be met from an existing directory. Change the prose record and
machine twin together, run both normal and negative-control checks, and update
all affected paths in the same commit. Convenience alone is not sufficient.

## 8. Amendments

**July 22, 2026 — `conftest.py` and `pytest.ini` admitted as tool discovery.**
The REPL-sandbox package (`src/repl_sandbox/`) is Python, and pytest resolves
both its rootdir and its `conftest` import hook relative to the invocation root,
so neither file can move into a subdirectory without breaking the discovery it
exists to perform. This is the same auto-discovery need §7 already accepted for
`tsconfig.build.json` and `vitest.config.ts`; both new entries take the existing
`tool` class and the tightest cap already in use (4,096 bytes, against actual
sizes of 460 and 82). No cap was raised, no rule relaxed, no new field invented.

Recorded late, and that is the finding. The machine twin was edited when the
checker refused the undeclared files; §2 was not updated in the same commit, as
§7 requires. Nothing detected the gap, because the checker proves twin-against-
tree and never record-against-twin — so the ratified prose was false by omission
while every check stayed green. The durable fix is a checker branch asserting
that the §2 table and `rootFiles` name the same set; it is unbuilt, and until it
exists this direction of the contract rests on the author remembering.
§5 described `.claude/` as "project skill auto-discovery for Claude Code". That
became false by omission when `.claude/settings.json` was committed, carrying
`Stop` and `SessionStart` hooks for the density-trellis staleness checker. The
role now names both, and states that contents are DERIVED and governed by their
own records.

Prose-only: no machine-twin change was required, because `rootDirectories` is a
bare allowlist of top-level names and §6 does not enumerate directory roles among
what the checker proves. Both checks were re-run.

This amendment deliberately does **not** extend the contract to govern what is
inside `.claude/`. An in-directory allowlist would need a new twin field, a
checker branch, a unit pin, and a fresh plant in the negative-control fixture —
and would then make every added skill a contract edit. §7 bars it directly
(convenience is not sufficient) and no measured failure funds it. The standing of
`.claude/` contents is carried where standing belongs: `AGENTS.md` §2.1.
