import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The checker is plain ESM so it can run from a hook with no build step.
// @ts-expect-error -- untyped .mjs module, imported for its pure helpers.
import * as wiki from './wiki_check.mjs';

const {
  globToRegExp, expandBraces, extractSections, extractRoster,
  extractDeclarations, buildRouter, route, classify, sectionVerdict,
} = wiki as {
  globToRegExp: (g: string) => RegExp;
  expandBraces: (g: string) => string[];
  extractSections: (t: string | null) => Map<string, { startLine: number; endLine: number; sha256: string }>;
  extractRoster: (t: string | null) => { id: string; heading: string }[];
  extractDeclarations: (t: string) => Map<string, string[]>;
  buildRouter: (t: string | null) => Router;
  route: (p: string, r: Router) => { classes: string[]; origin: string; rule: { glob: string } } | null;
  classify: (p: string[], r: Router) => { byClass: Map<string, string[]>; fallback: unknown[]; unmapped: string[] };
  sectionVerdict: (f: Facts) => { verified: boolean; reason: string | null; unknown?: string };
};

type Router = { classes: Record<string, string>; roster: string[]; declarations: Map<string, string[]> };
type Facts = {
  sectionPresent: boolean; sectionEditedNow: boolean; routedWorkingPaths: string[];
  lastCode: string | null; lastSection: string | null; codeIsAncestorOfSection: boolean;
  mapCommitted: boolean; shallow: boolean;
};

const REPO_ROOT = join(__dirname, '..', '..');
const MAP_TEXT = readFileSync(join(REPO_ROOT, 'docs', 'density-chain', 'DENSITY-CHAIN.md'), 'utf8');

describe('glob dialect', () => {
  it('matches a single segment with * and any depth with **', () => {
    expect(globToRegExp('src/*.ts').test('src/a.ts')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/nested/a.ts')).toBe(false);
    expect(globToRegExp('src/**').test('src/nested/deep/a.ts')).toBe(true);
    expect(globToRegExp('docs/**/*.md').test('docs/a.md')).toBe(true);
    expect(globToRegExp('docs/**/*.md').test('docs/x/y/a.md')).toBe(true);
  });

  it('treats regex metacharacters as literals and anchors both ends', () => {
    expect(globToRegExp('a.b').test('axb')).toBe(false);
    expect(globToRegExp('AGENTS.md').test('docs/AGENTS.md')).toBe(false);
    expect(globToRegExp('AGENTS.md').test('AGENTS.md.bak')).toBe(false);
  });

  it('expands braces, including several groups in one glob', () => {
    expect(expandBraces('a/{b,c}/d')).toEqual(['a/b/d', 'a/c/d']);
    expect(expandBraces('docs/{x,y}/{p,q}.md').sort()).toEqual(
      ['docs/x/p.md', 'docs/x/q.md', 'docs/y/p.md', 'docs/y/q.md'],
    );
    expect(expandBraces('no/braces/here')).toEqual(['no/braces/here']);
  });
});

describe('the map is the declaration', () => {
  const router = buildRouter(MAP_TEXT);

  it('derives the roster from the section headings, not from any JSON', () => {
    expect(router.roster).toEqual(
      ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12', 'C13'],
    );
  });

  it('parses a Declares cell into globs and ignores the prose around them', () => {
    expect(router.declarations.get('C12')).toEqual(['docs/product/repl-sandbox/**']);
    expect(router.declarations.get('C9')).toEqual(['docs/architecture/RESIDUAL_STREAM_SIDECAR.md']);
  });

  it('routes each class by its own declaration', () => {
    const probes: Record<string, string> = {
      C1: 'src/core/agent/goal_loop.ts',
      C2: 'tools/engineering-loop/src/kernel.ts',
      C3: 'src/core/graph/judge_panel.ts',
      C4: 'src/core/ingestion/ingest_document.ts',
      C5: 'src/rlm/trellis_textedit.py',
      C6: 'src/core/promotion/plan_promotion.ts',
      C7: 'docs/architecture/DOUBTS_WORKSPACE.md',
      C8: 'docs/architecture/MODEL_BACKEND_SEAM.md',
      C9: 'docs/architecture/RESIDUAL_STREAM_SIDECAR.md',
      C10: 'docs/benchmarks/UPDATE_DRILL_REPORT.md',
      C11: 'src/api/server.ts',
      C12: 'docs/product/repl-sandbox/REPL_SANDBOX_SPEC.md',
      C13: 'tools/repository-surface/check.ts',
    };
    for (const [id, path] of Object.entries(probes)) {
      expect(route(path, router)?.classes, `${path} should route to ${id}`).toContain(id);
    }
  });

  // The divergence that motivated deriving the table: the self-index said C8
  // owned this file while an authored table routed it to C11.
  it('routes the declared config file to the class that declares it', () => {
    expect(route('src/config/index.ts', router)?.classes).toEqual(['C8']);
  });

  it('unions two branches that declare the same path rather than picking one', () => {
    expect(route('AGENTS.md', router)?.classes.sort()).toEqual(['C11', 'C13']);
  });

  it('routes the map itself to the ignore sentinel', () => {
    expect(route('docs/density-chain/DENSITY-CHAIN.md', router)?.classes).toEqual(['ignore']);
  });

  it('reports a genuinely new subsystem as fallback-routed, not confidently classified', () => {
    const hit = route('src/brand_new_subsystem/thing.ts', router);
    expect(hit?.origin).toBe('fallback');
    expect(hit?.rule.glob).toBe('src/**');
  });

  it('drops a route when its declaration is removed', () => {
    const without = MAP_TEXT.replace(/^\| \*\*C12\*\* \|.*$/m, '| **C12** | *(none)* | *(none)* |');
    const hit = route('docs/product/repl-sandbox/README.md', buildRouter(without));
    expect(hit?.classes ?? []).not.toContain('C12');
  });

  it('extends the roster from a new heading with no JSON edit', () => {
    expect(buildRouter(`${MAP_TEXT}\n\n#### C14 — a synthetic class\n\n`).roster).toContain('C14');
  });
});

describe('section extraction', () => {
  const sections = extractSections(MAP_TEXT);

  it('finds exactly one section per class', () => {
    expect([...sections.keys()].sort()).toEqual(extractRoster(MAP_TEXT).map((r) => r.id).sort());
  });

  it('stops a section at the next heading', () => {
    const c5 = sections.get('C5')!;
    const c6 = sections.get('C6')!;
    expect(c5.endLine).toBeLessThanOrEqual(c6.startLine);
  });

  // core.autocrlf=true means the working tree holds CRLF while `git show`
  // returns LF. A raw byte hash would read "edited" forever and the gate would
  // report permanently fresh — a total silent failure.
  it('hashes CRLF and LF identically', () => {
    const crlf = extractSections(MAP_TEXT.replace(/\n/g, '\r\n'));
    expect(crlf.get('C5')!.sha256).toBe(sections.get('C5')!.sha256);
  });

  it('treats a whitespace reflow as no edit', () => {
    const reflowed = extractSections(MAP_TEXT.replace(/\. /g, '.  '));
    expect(reflowed.get('C5')!.sha256).toBe(sections.get('C5')!.sha256);
  });

  it('treats a word change as an edit', () => {
    const changed = extractSections(MAP_TEXT.replace('#### C9 —', '#### C9 — renamed'));
    expect(changed.get('C9')!.sha256).not.toBe(sections.get('C9')!.sha256);
  });
});

describe('the verdict, on injected git facts', () => {
  const base: Facts = {
    sectionPresent: true, sectionEditedNow: false, routedWorkingPaths: [],
    lastCode: 'code', lastSection: 'sect', codeIsAncestorOfSection: true,
    mapCommitted: true, shallow: false,
  };

  // A commit is its own ancestor, so a branch edited in the SAME commit as the
  // code it describes reads current — the behaviour to reward.
  it('is current when the branch is at or after the code', () => {
    expect(sectionVerdict(base).verified).toBe(true);
  });

  it('is stale when the code is newer than the branch', () => {
    expect(sectionVerdict({ ...base, codeIsAncestorOfSection: false }).reason).toBe('code_newer_than_branch');
  });

  // You are doing the work now: this wins over everything except an orphan.
  it('accepts an uncommitted edit of that branch’s own section', () => {
    expect(sectionVerdict({ ...base, codeIsAncestorOfSection: false, sectionEditedNow: true }).verified).toBe(true);
  });

  it('is stale while code it covers sits uncommitted', () => {
    expect(sectionVerdict({ ...base, routedWorkingPaths: ['src/x.ts'] }).reason).toBe('uncommitted_paths_moved');
  });

  it('reports an orphaned section before anything else', () => {
    expect(sectionVerdict({ ...base, sectionPresent: false, sectionEditedNow: true }).reason).toBe('orphaned_section');
  });

  it('is stale when the branch has never been committed', () => {
    expect(
      sectionVerdict({ ...base, lastSection: null, codeIsAncestorOfSection: false }).reason,
    ).toBe('branch_never_committed');
  });

  // An unknown window must be reported, never gated on.
  it('does not gate on a shallow clone or an uncommitted map', () => {
    const shallow = sectionVerdict({ ...base, shallow: true, codeIsAncestorOfSection: false });
    expect(shallow.verified).toBe(true);
    expect(shallow.unknown).toBe('shallow_clone');
    const fresh = sectionVerdict({ ...base, mapCommitted: false, codeIsAncestorOfSection: false });
    expect(fresh.unknown).toBe('map_not_committed');
  });

  // The stored-pin edition could reach a state where a class was permanently
  // stale and the only remedy was refused: a squash merge erased the pin
  // (fail-stale, correct) and a re-stamp was refused because the section was
  // unedited (also correct). Deriving from git removes the pin, so no input
  // combination reaches an unrecoverable verdict.
  it('has no unrecoverable state: every stale reason is cleared by editing the section', () => {
    const staleShapes: Facts[] = [
      { ...base, codeIsAncestorOfSection: false },
      { ...base, routedWorkingPaths: ['src/x.ts'] },
      { ...base, lastSection: null, codeIsAncestorOfSection: false },
    ];
    for (const shape of staleShapes) {
      expect(sectionVerdict(shape).verified, JSON.stringify(shape)).toBe(false);
      expect(sectionVerdict({ ...shape, sectionEditedNow: true }).verified).toBe(true);
    }
  });
});

// The only honest pin available for a hooks file. Asserting that settings.json
// *contains* a hook string would prove nothing about whether the hook fires —
// hard rule 14 names that shape, "an unenforced invariant wearing a row's
// clothes". What this can prove is that the command points at a file that
// exists, so renaming the checker fails loudly instead of silently disabling
// the hook. It couples the suite to one vendor's path, deliberately and only here.
describe('the harness config points at something real', () => {
  const settingsPath = join(REPO_ROOT, '.claude', 'settings.json');
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));

  it('names a script that exists, on every hook it declares', () => {
    const commands: string[] = Object.values(settings.hooks ?? {})
      .flat()
      .flatMap((entry) => (entry as { hooks?: { command?: string }[] }).hooks ?? [])
      .map((h) => h.command ?? '');
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      const match = /\$CLAUDE_PROJECT_DIR\/([^"\s]+)/.exec(command);
      expect(match, `no project-relative script in: ${command}`).not.toBeNull();
      expect(
        existsSync(join(REPO_ROOT, match![1])),
        `${match![1]} does not exist`,
      ).toBe(true);
    }
  });
});

describe('residue hygiene', () => {
  const residue = JSON.parse(
    readFileSync(join(REPO_ROOT, 'tools', 'density-chain', 'routing-residue.json'), 'utf8'),
  );
  const declared = new Set([...extractDeclarations(MAP_TEXT).values()].flat());

  it('states a reason for every rule', () => {
    for (const kind of ['ignore', 'heuristic', 'fallback']) {
      for (const entry of residue[kind]) expect(entry.why, `${kind} ${entry.glob}`).toBeTruthy();
    }
  });

  it('never shadows a declaration', () => {
    for (const kind of ['ignore', 'heuristic', 'fallback']) {
      for (const entry of residue[kind]) expect(declared.has(entry.glob), `${entry.glob}`).toBe(false);
    }
  });
});
