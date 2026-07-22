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

- `.claude/` — project skill auto-discovery for Claude Code; the root agent map
  links here explicitly for other readers.
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
6. the absence of forbidden root result-artifact names.

`npm run check:repo-surface -- --negative-control` constructs an isolated
temporary repository surface containing an unexpected root file, an oversized
entrypoint, a broken link, and a missing environment key. It must exit `3` and
name every planted break. A passing normal check is trusted only after this
falsifier is observed.

The checker does not decide product architecture, validate external URLs, edit
files, or generate documentation. It verifies only the ratified repository
surface described here.

## 7. Changing the contract

A new root entry requires a concrete auto-discovery or zero-context navigation
need that cannot be met from an existing directory. Change the prose record and
machine twin together, run both normal and negative-control checks, and update
all affected paths in the same commit. Convenience alone is not sufficient.
