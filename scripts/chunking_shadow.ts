import fs from 'fs/promises';
import path from 'path';
import { config } from '../src/config/index';
import {
  parseSourceFile,
  type ParseSourceResult,
  type SourceLanguage,
} from '../src/core/ast/source_parser';
import { collectExtractionBlocks, EXTRACTION_INELIGIBLE_BLOCK_TYPES, nodeText } from '../src/core/ast/traverse';
import { scanRepository } from '../src/core/repository/scanner';
import {
  isPathInScope,
  normalizeScopePrefixes,
} from '../src/core/repository/snapshot_ingest';

// Session 38 (STRUCTURAL_CHUNKING.md §6/§7): the zero-paid shadow
// measurement. Parses every in-scope code file under BOTH chunking
// policies without persisting anything and prints the criterion's
// before/after-able numbers: block counts, size distribution, monolith
// counts, the structureless share of TS bytes, per-kind counts, the
// extraction-eligible delta, and the Babel/python-ast boundary oracle.
//
//   npm run chunking:shadow [-- --root <dir>] [--include <prefix>]...
//
// Default scope: src, scripts, modules (the stage-1 substrate scope).
// GREEN requires: zero coverage errors under either policy AND zero
// policy-2 parse refusals on files policy 1 accepts (a file the pilot
// would silently lose is a failure, not a statistic). Boundary-oracle
// differences are counted and reported, never asserted — grammars
// legitimately differ (record §4).

const CODE_LANGUAGES: ReadonlySet<SourceLanguage> = new Set([
  'typescript', 'javascript', 'python',
]);

interface BlockView {
  type: string;
  chars: number;
  text: string;
}

interface FileMeasurement {
  path: string;
  language: SourceLanguage;
  p1: BlockView[];
  p2: BlockView[];
}

const SIZE_BUCKETS: Array<[string, (n: number) => boolean]> = [
  ['      <= 500', n => n <= 500],
  ['  501 - 1000', n => n > 500 && n <= 1000],
  [' 1001 - 2000', n => n > 1000 && n <= 2000],
  [' 2001 - 3000', n => n > 2000 && n <= 3000],
  [' 3001 - 4000', n => n > 3000 && n <= 4000],
  ['       >4000', n => n > 4000],
];

function blockViews(result: ParseSourceResult): BlockView[] {
  if (!result.ok) throw new Error('blockViews on a skip');
  return collectExtractionBlocks(result.root).map(block => {
    const text = nodeText(block);
    return { type: block.type, chars: text.length, text };
  });
}

function kindTable(blocks: BlockView[]): Map<string, { count: number; chars: number }> {
  const table = new Map<string, { count: number; chars: number }>();
  for (const block of blocks) {
    const entry = table.get(block.type) ?? { count: 0, chars: 0 };
    entry.count += 1;
    entry.chars += block.chars;
    table.set(block.type, entry);
  }
  return table;
}

function eligibleCount(blocks: BlockView[]): number {
  return blocks.filter(
    block => block.text.trim().length > 0 && !EXTRACTION_INELIGIBLE_BLOCK_TYPES.has(block.type)
  ).length;
}

function pct(part: number, whole: number): string {
  return whole === 0 ? 'n/a' : `${((100 * part) / whole).toFixed(1)}%`;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  let root = process.cwd();
  const includes: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = path.resolve(argv[++i]);
    else if (argv[i] === '--include') includes.push(argv[++i]);
    else throw new Error(`Unknown flag: ${argv[i]}`);
  }
  const prefixes = normalizeScopePrefixes(
    includes.length > 0 ? includes : ['src', 'scripts', 'modules']
  );

  const scan = await scanRepository(root, {});
  const candidates = scan.accepted.filter(entry => isPathInScope(entry.path, prefixes));
  console.log(`Structural-chunking shadow over ${root}`);
  console.log(`  scope: ${prefixes!.join(', ')} — ${candidates.length} accepted files\n`);

  const measurements: FileMeasurement[] = [];
  let skippedNonCode = 0;
  const failures: string[] = [];
  const oracleMismatches: string[] = [];
  let oracleChecked = 0;
  let oracleMatched = 0;

  for (const entry of candidates) {
    const bytes = await fs.readFile(path.join(root, entry.path));
    const p1 = await parseSourceFile(entry.path, bytes, {
      pythonExecutable: config.python.executable,
    });
    if (!p1.ok || !CODE_LANGUAGES.has(p1.language)) {
      skippedNonCode += 1;
      continue;
    }
    const p2 = await parseSourceFile(entry.path, bytes, {
      pythonExecutable: config.python.executable,
      chunkingPolicy: 2,
    });
    if (!p2.ok) {
      failures.push(`${entry.path}: policy 2 refused (${p2.reason}${p2.detail ? `: ${p2.detail}` : ''})`);
      continue;
    }
    const source = bytes.toString('utf-8');
    const p1Blocks = blockViews(p1);
    const p2Blocks = blockViews(p2);
    // Byte-coverage oracle for both policies (markdown-free languages
    // guarantee it; a violation here is a defect, not a statistic).
    for (const [label, parsed] of [['policy 1', p1], ['policy 2', p2]] as const) {
      if (nodeText(parsed.root) !== source) {
        failures.push(`${entry.path}: ${label} lost byte coverage`);
      }
    }
    // Boundary oracle: a policy-1 function/method small enough to
    // survive unsplit must appear INTACT inside exactly one policy-2
    // block — a straddle means the grammars disagree on the boundary.
    for (const block of p1Blocks) {
      if (block.type !== 'code_function' && block.type !== 'code_method') continue;
      if (block.chars > 4000) continue;
      oracleChecked += 1;
      if (p2Blocks.some(candidate => candidate.text.includes(block.text))) {
        oracleMatched += 1;
      } else {
        oracleMismatches.push(`${entry.path}: a ${block.chars}-char ${block.type} straddles policy-2 blocks`);
      }
    }
    measurements.push({ path: entry.path, language: p1.language, p1: p1Blocks, p2: p2Blocks });
  }

  const all1 = measurements.flatMap(m => m.p1);
  const all2 = measurements.flatMap(m => m.p2);
  console.log(`Files measured: ${measurements.length} (non-code or policy-1 skips: ${skippedNonCode})`);
  console.log(`\nBlocks: policy 1 = ${all1.length}, policy 2 = ${all2.length}`);

  console.log('\nSize distribution (chars per block):');
  console.log('                 policy 1   policy 2');
  for (const [label, test] of SIZE_BUCKETS) {
    const c1 = all1.filter(block => test(block.chars)).length;
    const c2 = all2.filter(block => test(block.chars)).length;
    console.log(`  ${label}   ${String(c1).padStart(8)}   ${String(c2).padStart(8)}`);
  }
  const mono1 = all1.filter(block => block.chars > 8000);
  const mono2 = all2.filter(block => block.chars > 8000);
  const max1 = Math.max(0, ...all1.map(block => block.chars));
  const max2 = Math.max(0, ...all2.map(block => block.chars));
  console.log(`\nMonoliths (>8000 chars): policy 1 = ${mono1.length} (max ${max1}), policy 2 = ${mono2.length} (max ${max2})`);
  const over2 = all2.filter(block => block.chars > 4000);
  console.log(`Policy-2 blocks over the 4000 hard cap (whole-leaf exceptions): ${over2.length}`);
  for (const block of over2) console.log(`    ${block.type} at ${block.chars} chars`);

  for (const [language, label] of [['typescript', 'TS'], ['javascript', 'JS'], ['python', 'PY']] as const) {
    const files = measurements.filter(m => m.language === language);
    if (files.length === 0) continue;
    const l1 = files.flatMap(m => m.p1);
    const l2 = files.flatMap(m => m.p2);
    const total1 = l1.reduce((sum, block) => sum + block.chars, 0);
    const total2 = l2.reduce((sum, block) => sum + block.chars, 0);
    const chunk1 = l1.filter(block => block.type === 'code_chunk').reduce((sum, block) => sum + block.chars, 0);
    const chunk2 = l2.filter(block => block.type === 'code_chunk').reduce((sum, block) => sum + block.chars, 0);
    console.log(`\n${label} structureless share (code_chunk chars / total): `
      + `policy 1 = ${pct(chunk1, total1)}, policy 2 = ${pct(chunk2, total2)}`);
  }

  console.log('\nPolicy-2 blocks per kind:');
  for (const [kind, entry] of [...kindTable(all2).entries()].sort()) {
    console.log(`  ${kind.padEnd(16)} ${String(entry.count).padStart(6)} blocks  ${String(entry.chars).padStart(9)} chars`);
  }
  console.log('\nPolicy-1 blocks per kind:');
  for (const [kind, entry] of [...kindTable(all1).entries()].sort()) {
    console.log(`  ${kind.padEnd(16)} ${String(entry.count).padStart(6)} blocks  ${String(entry.chars).padStart(9)} chars`);
  }

  console.log(`\nExtraction-eligible blocks (non-empty, minus typed-and-skipped): `
    + `policy 1 = ${all1.filter(b => b.text.trim().length > 0).length}, `
    + `policy 2 = ${eligibleCount(all2)} `
    + `(code_import skipped: ${all2.filter(b => b.type === 'code_import').length})`);

  console.log(`\nBoundary oracle (policy-1 functions/methods <= 4000 chars intact in one policy-2 block): `
    + `${oracleMatched}/${oracleChecked} matched`);
  for (const mismatch of oracleMismatches) console.log(`  DIFF ${mismatch}`);

  if (failures.length > 0) {
    console.log(`\n${failures.length} FAILURE(S):`);
    for (const failure of failures) console.log(`  [FAIL] ${failure}`);
    return 1;
  }
  console.log('\nALL FILES COVERED — shadow measurement green.');
  return 0;
}

main()
  .then(code => process.exit(code))
  .catch(error => {
    console.error(`chunking shadow failed: ${error instanceof Error ? error.stack : error}`);
    process.exit(1);
  });
