// Document UPSUM entrypoint — the non-test caller (AMBIENT.md rule 15).
//
//   npm run upsum -- <path> [--budget N]
//   npm run upsum -- --negative-control
//
// Exit codes follow the house drill convention:
//   0  within budget — the receipt is printed
//   1  over budget — REFUSED, with the ranked compression targets
//   2  usage, shape, or unresolved-budget refusal
//   3  negative control detected every planted break (healthy)

import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildReceipt,
  formatReceipt,
  measureDocument,
  readMeasure,
  rankedSections,
  resolveBudget,
  DocumentBudgetUnknownError,
  DocumentShapeError,
} from './upsum.js';

const repoRoot = process.cwd();
const contractPath = path.join(repoRoot, 'tools', 'repository-surface', 'root-contract.json');

function loadContract(): unknown {
  if (!existsSync(contractPath)) return null;
  return JSON.parse(readFileSync(contractPath, 'utf8'));
}

function runNormal(target: string, explicitBudget: number | null): void {
  const displayPath = target.replace(/\\/g, '/').replace(/^\.\//, '');
  const absolutePath = path.resolve(repoRoot, target);
  if (!existsSync(absolutePath)) {
    console.error(`No such file: ${displayPath}`);
    process.exitCode = 2;
    return;
  }

  const measure = readMeasure(absolutePath, displayPath);
  const resolved = resolveBudget(loadContract(), displayPath, explicitBudget);
  if (resolved === null) {
    console.error(
      `No budget for ${displayPath} and no default declared. Pass --budget N, or declare ` +
        'documentUpsum.defaultMaxBytes in tools/repository-surface/root-contract.json ' +
        'so the bound is code-checked rather than remembered.',
    );
    process.exitCode = 2;
    return;
  }

  const receipt = buildReceipt(measure, resolved);
  console.log(formatReceipt(receipt));
  // A bound somebody asserted refuses; the contract default reports.
  // Exceeding a default is not a failure — a document nothing contracted
  // has no bound to have broken.
  if (receipt.overBudget && receipt.refuses) process.exitCode = 1;
}

// Healthy behavior is DETECTION (rule 19c): a check nobody has seen fail
// reports success on anything. Each planted break must surface.
function runNegativeControl(): void {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'trellis-document-upsum-negative-'));
  const detected: string[] = [];
  const missing: string[] = [];
  try {
    const oversize = path.join(fixtureRoot, 'oversize.md');
    writeFileSync(oversize, ['# T', '', '## Small', 'x', '', '## Heavy', 'y'.repeat(400), ''].join('\n'));
    const overReceipt = buildReceipt(measureDocument('oversize.md', readFileSync(oversize, 'utf8')), 100);
    if (overReceipt.overBudget) detected.push('over_budget');
    else missing.push('over_budget');

    // The ranking is the deliverable; a stable-but-wrong order would make
    // the surface report the wrong compression target while passing.
    if (rankedSections(overReceipt)[0]?.title === 'Heavy') detected.push('ranking_puts_heaviest_first');
    else missing.push('ranking_puts_heaviest_first');

    const shapeless = path.join(fixtureRoot, 'shapeless.md');
    writeFileSync(shapeless, 'no headings here, only prose\n');
    try {
      measureDocument('shapeless.md', readFileSync(shapeless, 'utf8'));
      missing.push('shape_refusal');
    } catch (error) {
      if (error instanceof DocumentShapeError) detected.push('shape_refusal');
      else missing.push('shape_refusal');
    }

    try {
      buildReceipt(measureDocument('oversize.md', readFileSync(oversize, 'utf8')), 0);
      missing.push('budget_refusal');
    } catch (error) {
      if (error instanceof DocumentBudgetUnknownError) detected.push('budget_refusal');
      else missing.push('budget_refusal');
    }

    if (missing.length > 0) {
      console.error(`Negative control failed to detect: ${missing.join(', ')}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Negative control detected all planted breaks: ${detected.join(', ')}`);
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
if (args.length === 1 && args[0] === '--negative-control') {
  runNegativeControl();
} else if (args.length === 1 || (args.length === 3 && args[1] === '--budget')) {
  const budget = args.length === 3 ? Number.parseInt(args[2], 10) : null;
  if (budget !== null && (!Number.isInteger(budget) || budget <= 0)) {
    console.error('--budget takes a positive integer.');
    process.exitCode = 2;
  } else {
    runNormal(args[0], budget);
  }
} else {
  console.error('Usage: npm run upsum -- <path> [--budget N] | npm run upsum -- --negative-control');
  process.exitCode = 2;
}
