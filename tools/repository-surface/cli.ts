// Repository-surface entrypoint (AGENTS.md rule 15 — the non-test caller).
//
//   npm run check:repo-surface
//   npm run check:repo-surface -- --negative-control
//
// Exit codes follow the house drill convention:
//   0  the surface matches the contract
//   1  a contract violation, or a negative control that failed to detect
//   2  usage
//   3  negative control detected every planted break (healthy)
//
// Every run also prints governed byte headroom, tightest first, ranking
// the sections of anything near its cap. That report is this tool's
// second job and is documented in `headroom.ts`: it gives the
// document-UPSUM ranking an automatic caller, and tells an author WHERE
// the bytes are before a cap is crossed rather than after.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  checkRepositorySurface,
  formatSurfaceReport,
  loadRootContract,
  SURFACE_ISSUE_CODES,
} from './check.js';
import { formatHeadroomReport } from './headroom.js';
import { breakKey, plantNegativeControl } from './negative-control.js';

const repoRoot = process.cwd();
const contractPath = path.join(repoRoot, 'tools', 'repository-surface', 'root-contract.json');

function runNormal(): void {
  const contract = loadRootContract(contractPath);
  const issues = checkRepositorySurface(repoRoot, contract);
  console.log(formatSurfaceReport(issues));
  console.log('');
  console.log(formatHeadroomReport(repoRoot, contract));
  if (issues.length > 0) process.exitCode = 1;
}

function runNegativeControl(): void {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'trellis-repo-surface-negative-'));
  try {
    const fixture = plantNegativeControl(fixtureRoot);

    // A code with no plant has never been seen to fail, so the control's
    // success would carry no information about it. Refuse before running
    // rather than report a green that covers ten of eleven codes.
    const uncovered = SURFACE_ISSUE_CODES.filter(
      code => !fixture.expected.some(planted => planted.code === code),
    );
    if (uncovered.length > 0) {
      console.error(`Negative control plants no break for: ${uncovered.join(', ')}`);
      process.exitCode = 1;
      return;
    }

    const issues = checkRepositorySurface(fixtureRoot, fixture.contract, fixture.files);
    console.log(formatSurfaceReport(issues));
    console.log('');
    console.log(formatHeadroomReport(fixtureRoot, fixture.contract));

    const observed = new Set(issues.map(breakKey));
    const planted = new Set(fixture.expected.map(breakKey));
    const missing = [...planted].filter(key => !observed.has(key)).sort();
    // A break nobody planted means the fixture no longer characterizes the
    // checker — the same defect as a missed one, seen from the other side.
    const unplanted = [...observed].filter(key => !planted.has(key)).sort();

    if (missing.length > 0 || unplanted.length > 0) {
      if (missing.length > 0) console.error(`Negative control failed to detect: ${missing.join(', ')}`);
      if (unplanted.length > 0) console.error(`Negative control detected unplanted breaks: ${unplanted.join(', ')}`);
      process.exitCode = 1;
      return;
    }

    console.log(
      `Negative control detected all ${fixture.expected.length} planted breaks, ` +
        `covering every issue code: ${SURFACE_ISSUE_CODES.join(', ')}`,
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
