import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkRepositorySurface, loadRootContract } from './check';
import { NEGATIVE_CONTROL_CODES, plantSurfaceFixture } from './fixture';

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'trellis-repo-surface-test-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('repository surface contract', () => {
  it('passes against the current repository', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const contract = loadRootContract(path.join(repoRoot, 'tools', 'repository-surface', 'root-contract.json'));
    expect(checkRepositorySurface(repoRoot, contract)).toEqual([]);
  });

  // The fixture is shared with `--negative-control` (tools/repository-surface/fixture.ts)
  // rather than copied, because the copy drifted: the CLI grew four planted
  // breaks and this file held the same four while eleven codes gated a merge.
  // The two now assert different halves of one plant. The CLI gates on the set
  // of codes; the pins below are the ones a set cannot carry — that each code
  // arrives attached to the right path, and that nothing extra arrives at all.
  it('attaches each planted break to the path that caused it', () => {
    const root = temporaryRoot();
    const { contract, files } = plantSurfaceFixture(root, 'broken');
    const issues = checkRepositorySurface(root, contract, files);

    expect(issues.map(issue => `${issue.code} ${issue.path}`)).toEqual([
      'broken_markdown_link README.md:1',
      'deprecated_marker_missing docs/DEPRECATED.md',
      'environment_example_extra .env.example',
      'environment_example_missing .env.example',
      'forbidden_root_file benchmark_results.json',
      'missing_root_directory modules',
      'missing_root_file LICENSE',
      'oversized_document docs/GOVERNED.md',
      'oversized_root_file README.md',
      'unexpected_root_directory stray',
      'unexpected_root_file unexpected.txt',
    ]);
  });

  it('plants exactly the codes the negative control expects', () => {
    const root = temporaryRoot();
    const { contract, files } = plantSurfaceFixture(root, 'broken');
    const observed = [...new Set(checkRepositorySurface(root, contract, files).map(i => i.code))];
    // The runtime half of the lock. `PLANTED_CODES` is typed against the
    // SurfaceIssue union, so the compiler already pins declared == emittable;
    // this pins declared == actually planted, closing the loop.
    expect(observed.sort()).toEqual([...NEGATIVE_CONTROL_CODES]);
  });

  it('reports nothing when the same contract meets a repaired tree', () => {
    const root = temporaryRoot();
    const { contract, files } = plantSurfaceFixture(root, 'healthy');
    // The positive control the CLI runs before it trusts a detection: the
    // archive-excluded dangling link in docs/archive/OLD.md is planted here
    // too, and must stay unreported while README's identical break does not.
    expect(checkRepositorySurface(root, contract, files)).toEqual([]);
  });
});
