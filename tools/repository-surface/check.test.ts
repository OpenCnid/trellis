import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkRepositorySurface, loadRootContract, SURFACE_ISSUE_CODES } from './check';
import { formatHeadroomReport, governedHeadroom } from './headroom';
import { breakKey, plantNegativeControl } from './negative-control';

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'trellis-repo-surface-test-'));
  temporaryRoots.push(root);
  return root;
}

function repositoryRoot(): string {
  return path.resolve(__dirname, '..', '..');
}

function liveContract() {
  return loadRootContract(path.join(repositoryRoot(), 'tools', 'repository-surface', 'root-contract.json'));
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('repository surface contract', () => {
  it('passes against the current repository', () => {
    expect(checkRepositorySurface(repositoryRoot(), liveContract())).toEqual([]);
  });
});

// Rule 19(c): a check earns the name `verification` by having been seen to
// fail. These carry the CLI's `--negative-control` fixture into `npm test`,
// so the falsifier is regression-detected rather than only invokable.
describe('the negative control', () => {
  it('plants a break for every issue code the checker can emit', () => {
    const fixture = plantNegativeControl(temporaryRoot());
    expect(new Set(fixture.expected.map(planted => planted.code))).toEqual(new Set(SURFACE_ISSUE_CODES));
  });

  it('detects every planted break, on the planted path, and invents none', () => {
    const root = temporaryRoot();
    const fixture = plantNegativeControl(root);
    const observed = checkRepositorySurface(root, fixture.contract, fixture.files).map(breakKey).sort();
    // Equality in both directions: nothing planted went undetected, and
    // nothing detected went unplanted. A one-way subset check would let
    // the fixture stop characterizing the checker without saying so.
    expect(observed).toEqual(fixture.expected.map(breakKey).sort());
  });

  it('keeps an allowlisted example-only key silent, so the extra-key plant means something', () => {
    const root = temporaryRoot();
    const fixture = plantNegativeControl(root);
    const issues = checkRepositorySurface(root, fixture.contract, fixture.files);
    const extras = issues.filter(issue => issue.code === 'environment_example_extra');
    expect(extras.map(issue => issue.message)).toEqual(['key is neither in EnvSchema nor allowedExampleOnly: UNDECLARED_KEY']);
  });

  it('keeps an archive-excluded broken link silent, so the link plant means something', () => {
    const root = temporaryRoot();
    const fixture = plantNegativeControl(root);
    const links = checkRepositorySurface(root, fixture.contract, fixture.files)
      .filter(issue => issue.code === 'broken_markdown_link');

    // Two identical dangling links, siblings under `docs/`, one of them a
    // directory deeper inside the excluded prefix. Only the unexcluded one
    // may be reported. The pair pins the prefix from both sides: an
    // exclusion matching nothing reports both, and one gone too broad
    // reports neither — and either failure would otherwise leave a
    // directory silently unchecked with the checker green.
    expect(links.map(issue => issue.path)).toEqual(['docs/LEGACY.md:3']);
  });
});

// Rule 15: correct is a different claim from reachable. The ranking in
// `tools/document-upsum` had no caller but a human's keyboard; these pin
// that every surface check now invokes it.
describe('governed byte headroom', () => {
  it('measures each contracted cap and sorts by how little room is left', () => {
    const root = temporaryRoot();
    const fixture = plantNegativeControl(root);
    const rows = governedHeadroom(root, fixture.contract);

    expect(rows.map(row => row.ratio)).toEqual([...rows.map(row => row.ratio)].sort((a, b) => a - b));
    expect(rows.find(row => row.path === 'docs/OVERSIZE.md')?.near).toBe(true);
    expect(rows.find(row => row.path === '.env.example')?.near).toBe(false);
    // A contracted file that is absent is already a `missing_root_file`
    // issue; a fabricated zero-byte row would read as a comfortable one.
    expect(rows.map(row => row.path)).not.toContain('LICENSE');
  });

  it('gives the author WHERE and not only WHETHER: a near-budget document arrives ranked', () => {
    const root = temporaryRoot();
    const fixture = plantNegativeControl(root);
    const report = formatHeadroomReport(root, fixture.contract);

    expect(report).toContain('npm run upsum -- docs/OVERSIZE.md');
    const heavy = report.indexOf('Heavy');
    const light = report.indexOf('Light');
    expect(heavy).toBeGreaterThan(-1);
    expect(heavy).toBeLessThan(light);
  });

  it('names no compression target for a file that has none', () => {
    const root = temporaryRoot();
    const fixture = plantNegativeControl(root);
    const report = formatHeadroomReport(root, fixture.contract);

    // README.md is over its cap and therefore near, but carries no `## `
    // sections. The headroom line is the whole honest report for it.
    expect(report).toContain('README.md');
    expect(report).not.toContain('npm run upsum -- README.md');
  });

  it('reports the live repository against contracted caps only', () => {
    const contract = liveContract();
    const rows = governedHeadroom(repositoryRoot(), contract);
    const contracted = new Set([
      ...contract.rootFiles.map(row => row.path),
      ...contract.documentUpsum.paths.map(row => row.path),
    ]);

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(contracted.has(row.path)).toBe(true);
      expect(row.headroom).toBe(row.budget - row.size);
      expect(row.near).toBe(row.ratio <= contract.documentUpsum.nearBudgetRatio);
    }
  });

  it('takes the near-budget threshold from the contract, never from the tool', () => {
    const root = temporaryRoot();
    const fixture = plantNegativeControl(root);
    const roomy = { ...fixture.contract.documentUpsum, nearBudgetRatio: 0.99 };
    const rows = governedHeadroom(root, { ...fixture.contract, documentUpsum: roomy });
    // Under a 99%-free threshold even the comfortable entry is near, which
    // it cannot be if the number were remembered in `headroom.ts`.
    expect(rows.find(row => row.path === '.env.example')?.near).toBe(true);
  });
});
