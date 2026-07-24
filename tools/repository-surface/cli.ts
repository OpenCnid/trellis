import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  checkRepositorySurface,
  formatSurfaceReport,
  loadRootContract,
} from './check.js';
import { NEGATIVE_CONTROL_CODES, plantSurfaceFixture } from './fixture.js';

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
    // The positive control runs first. A falsifier that has only ever seen
    // failures cannot tell "detected the break" from "reports everything", so
    // the same contract over a repaired tree has to come back silent before
    // the detections below carry any information.
    const healthyRoot = path.join(fixtureRoot, 'healthy');
    mkdirSync(healthyRoot, { recursive: true });
    const healthy = plantSurfaceFixture(healthyRoot, 'healthy');
    const healthyIssues = checkRepositorySurface(healthyRoot, healthy.contract, healthy.files);
    if (healthyIssues.length > 0) {
      console.log(formatSurfaceReport(healthyIssues));
      console.error('Positive control failed: the repaired fixture is not clean.');
      process.exitCode = 1;
      return;
    }
    console.log(`Positive control: PASS (repaired fixture, 0 issues)`);

    const brokenRoot = path.join(fixtureRoot, 'broken');
    mkdirSync(brokenRoot, { recursive: true });
    const broken = plantSurfaceFixture(brokenRoot, 'broken');
    const issues = checkRepositorySurface(brokenRoot, broken.contract, broken.files);
    const expectedCodes = NEGATIVE_CONTROL_CODES;
    const observedCodes = new Set(issues.map(issue => issue.code));
    const missing = expectedCodes.filter(code => !observedCodes.has(code));
    console.log(formatSurfaceReport(issues));
    if (missing.length > 0) {
      console.error(`Negative control failed to detect: ${missing.join(', ')}`);
      process.exitCode = 1;
      return;
    }
    console.log(
      `Negative control detected all ${expectedCodes.length} planted breaks: ${expectedCodes.join(', ')}`,
    );
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
