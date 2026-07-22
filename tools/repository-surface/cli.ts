import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  checkRepositorySurface,
  formatSurfaceReport,
  loadRootContract,
  type RootContract,
} from './check.js';

const repoRoot = process.cwd();
const contractPath = path.join(repoRoot, 'tools', 'repository-surface', 'root-contract.json');

function runNormal(): void {
  const contract = loadRootContract(contractPath);
  const issues = checkRepositorySurface(repoRoot, contract);
  console.log(formatSurfaceReport(issues));
  if (issues.length > 0) process.exitCode = 1;
}

function runNegativeControl(): void {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'trellis-repo-surface-negative-'));
  try {
    mkdirSync(path.join(fixtureRoot, 'docs'), { recursive: true });
    mkdirSync(path.join(fixtureRoot, 'src', 'config'), { recursive: true });
    writeFileSync(path.join(fixtureRoot, 'README.md'), '[missing](missing.md)\n');
    writeFileSync(path.join(fixtureRoot, '.env.example'), 'EXTRA_KEY=1\n');
    writeFileSync(path.join(fixtureRoot, 'unexpected.txt'), 'planted\n');
    writeFileSync(
      path.join(fixtureRoot, 'src', 'config', 'index.ts'),
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
    const files = ['.env.example', 'README.md', 'src/config/index.ts', 'unexpected.txt'];
    const issues = checkRepositorySurface(fixtureRoot, contract, files);
    const expectedCodes = [
      'broken_markdown_link',
      'environment_example_missing',
      'oversized_root_file',
      'unexpected_root_file',
    ] as const;
    const observedCodes = new Set(issues.map(issue => issue.code));
    const missing = expectedCodes.filter(code => !observedCodes.has(code));
    console.log(formatSurfaceReport(issues));
    if (missing.length > 0) {
      console.error(`Negative control failed to detect: ${missing.join(', ')}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Negative control detected all planted breaks: ${expectedCodes.join(', ')}`);
    process.exitCode = 3;
  } finally {
    const resolvedFixture = path.resolve(fixtureRoot);
    const resolvedTemp = path.resolve(tmpdir());
    if (!resolvedFixture.startsWith(`${resolvedTemp}${path.sep}`)) {
      throw new Error(`refusing to remove non-temporary negative-control path: ${resolvedFixture}`);
    }
    rmSync(resolvedFixture, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
if (args.length === 0) {
  runNormal();
} else if (args.length === 1 && args[0] === '--negative-control') {
  runNegativeControl();
} else {
  console.error('Usage: npm run check:repo-surface -- [--negative-control]');
  process.exitCode = 2;
}
