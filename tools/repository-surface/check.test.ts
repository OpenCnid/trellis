import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkRepositorySurface, loadRootContract, type RootContract } from './check';

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

  it('detects root, size, link, and environment drift independently', () => {
    const root = temporaryRoot();
    mkdirSync(path.join(root, 'src', 'config'), { recursive: true });
    writeFileSync(path.join(root, 'README.md'), '[missing](missing.md)\n');
    writeFileSync(path.join(root, '.env.example'), 'EXTRA_KEY=1\n');
    writeFileSync(path.join(root, 'unexpected.txt'), 'planted\n');
    writeFileSync(
      path.join(root, 'src', 'config', 'index.ts'),
      "const EnvSchema = z.object({\n  REQUIRED_KEY: z.string(),\n});\n",
    );
    const contract: RootContract = {
      version: 1,
      rootFiles: [
        { path: '.env.example', class: 'entrypoint', maxBytes: 1024 },
        { path: 'README.md', class: 'entrypoint', maxBytes: 1 },
      ],
      rootDirectories: ['src'],
      markdownLinks: { excludePrefixes: [] },
      environment: {
        schemaPath: 'src/config/index.ts',
        examplePath: '.env.example',
        allowedExampleOnly: ['EXTRA_KEY'],
      },
      deprecatedSurfaces: [],
      forbiddenRootFiles: [],
    };

    const issues = checkRepositorySurface(
      root,
      contract,
      ['.env.example', 'README.md', 'src/config/index.ts', 'unexpected.txt'],
    );
    expect(new Set(issues.map(issue => issue.code))).toEqual(new Set([
      'broken_markdown_link',
      'environment_example_missing',
      'oversized_root_file',
      'unexpected_root_file',
    ]));
  });
});
