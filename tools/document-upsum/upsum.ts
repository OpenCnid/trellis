// Document UPSUM — the running-state gate applied to a governed document.
//
// `TrellisUpsum` (src/rlm/trellis_scaffold.py) gates the RLM's running
// state: the model rewrites an `upsum` dict every turn, and the ENGINE
// measures it, refusing an over-budget state with the per-key sizes
// largest-first so compression targets are computed, never estimated
// (RLM_HARNESS_SCAFFOLDING.md §7.1/§7.3; CODE_MEDIATED_TEXT.md §1 — the
// model never counts).
//
// A governed document has the same two properties and had only half the
// machinery. Its budget is already a code-checked constant (`maxBytes` in
// root-contract.json, checked by `npm run check:repo-surface`), but the
// checker reports only the total: "33446 bytes exceeds 32768" names the
// overage and not one byte of WHERE it lives. An author over budget is
// therefore returned to eyeballing — the exact posture the REPL surface
// was built to remove.
//
// This module supplies the missing half. The store differs (a file on
// disk rather than REPL locals) and the units differ (markdown sections
// rather than dict keys); the contract is transposed unchanged:
//
//   upsum dict            ->  the document's bytes
//   UPSUM_BUDGET (2000)   ->  maxBytes for this path in the root contract
//   standing keys         ->  top-level `##` sections
//   emergent domain keys  ->  `###` subsections
//   per-key sizes         ->  per-section sizes, largest first
//   UpsumBudgetError      ->  a refusal naming the heaviest sections
//   UpsumShapeError       ->  a document with no measurable structure
//
// It MEASURES AND REFUSES. It never rewrites prose: compression is an
// authoring act under Guardrail 15, and a tool that silently rewrote a
// governing document would violate the pillar it is derived from.

import { readFileSync } from 'node:fs';

export interface SectionMeasure {
  readonly title: string;
  readonly bytes: number;
  readonly subsections: readonly SectionMeasure[];
}

export interface DocumentMeasure {
  readonly path: string;
  readonly size: number;
  readonly preambleBytes: number;
  readonly sections: readonly SectionMeasure[];
}

export interface UpsumReceipt extends DocumentMeasure {
  readonly budget: number;
  readonly headroom: number;
  readonly overBudget: boolean;
  readonly budgetSource: BudgetSource;
  readonly refuses: boolean;
  readonly enforced: boolean;
}

/** Raised when a document carries no structure to measure against. A
 *  document with no headings has no compression targets to name, so the
 *  refusal would be a bare number — the state this surface exists to
 *  replace. The shape check runs before measurement, exactly as
 *  `TrellisUpsum._validate` does. */
export class DocumentShapeError extends Error {}

/** Raised when no budget can be resolved. Refusing is deliberate: a
 *  default budget invented here would be a bound with no engine behind
 *  it, which is the defect CODE_MEDIATED_TEXT.md §2.8 names. */
export class DocumentBudgetUnknownError extends Error {}

const HEADING = /^(#{2,3}) +(.*?)\s*$/;

/** Split preserving line terminators, so the section byte sums equal the
 *  file size on CRLF checkouts as well as LF ones. */
function linesWithEndings(content: string): string[] {
  return content.split(/(?<=\n)/);
}

function bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/**
 * Measure a document's structure. Sections are `##` headings; each owns
 * its `###` subsections and every line up to the next `##`. Bytes before
 * the first `##` are the preamble — reported, never silently dropped,
 * because in this repository's entrypoint the preamble carries the
 * Status header.
 */
export function measureDocument(filePath: string, content: string): DocumentMeasure {
  const lines = linesWithEndings(content);
  const sections: SectionMeasure[] = [];
  let preamble = '';
  let current: { title: string; text: string; subs: { title: string; text: string }[] } | null = null;
  let currentSub: { title: string; text: string } | null = null;

  const closeSection = (): void => {
    if (!current) return;
    const subsections = current.subs.map(sub => ({
      title: sub.title,
      bytes: bytes(sub.text),
      subsections: [] as SectionMeasure[],
    }));
    sections.push({
      title: current.title,
      bytes: bytes(current.text) + subsections.reduce((sum, sub) => sum + sub.bytes, 0),
      subsections,
    });
  };

  for (const line of lines) {
    const match = HEADING.exec(line.replace(/\r?\n$/, ''));
    if (match && match[1].length === 2) {
      closeSection();
      currentSub = null;
      current = { title: match[2], text: line, subs: [] };
      continue;
    }
    if (match && match[1].length === 3 && current) {
      currentSub = { title: match[2], text: line };
      current.subs.push(currentSub);
      continue;
    }
    if (currentSub) currentSub.text += line;
    else if (current) current.text += line;
    else preamble += line;
  }
  closeSection();

  if (sections.length === 0) {
    throw new DocumentShapeError(
      `${filePath} has no '## ' sections, so there is nothing to rank. ` +
        'A document UPSUM names compression targets; without headings the ' +
        'only honest report is the total, which check:repo-surface already gives.',
    );
  }

  return {
    path: filePath,
    size: bytes(content),
    preambleBytes: bytes(preamble),
    sections,
  };
}

/** Where a budget came from. Reported on every receipt: a number whose
 *  origin the reader cannot name is the "remembered bound" this surface
 *  exists to abolish, and a DEFAULT that looked like a CONTRACT row would
 *  be exactly that failure wearing a receipt's clothes. */
export type BudgetSource = 'flag' | 'root-contract' | 'document-contract' | 'default';

export interface ResolvedBudget {
  readonly budget: number;
  /** Does THIS run exit non-zero when the document is over? True for a
   *  bound somebody asserted — a contract row, or a `--budget` the caller
   *  typed. False for the contract default, which nobody asserted about
   *  this path. */
  readonly refuses: boolean;
  /** Does `check:repo-surface` also gate it? True only for a contract
   *  row. Kept distinct from `refuses` because "the author asked whether
   *  it fits under N" and "the repository guarantees it fits under N" are
   *  different claims, and collapsing them would let a one-run question
   *  read as a standing guarantee. */
  readonly enforced: boolean;
  readonly source: BudgetSource;
}

interface ContractShape {
  rootFiles?: { path: string; maxBytes: number }[];
  documentUpsum?: {
    defaultMaxBytes?: number;
    paths?: { path: string; maxBytes: number }[];
  };
}

function canonical(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Resolve the budget for a path, most specific first: an explicit flag, a
 * contracted root file, a contracted document row, then the contract's
 * declared default.
 *
 * The default lives in `root-contract.json`, never in this source. A tool
 * that carried its own default would put the bound somewhere no reviewer
 * reads and no checker audits — and rule 17 forbids encoding a default
 * *instance* in the machinery. Declaring it in the contract keeps the
 * frame here and the value there, which is the same split the rule asks
 * for everywhere else.
 */
export function resolveBudget(
  contract: unknown,
  filePath: string,
  explicit: number | null,
): ResolvedBudget | null {
  if (explicit !== null) return { budget: explicit, source: 'flag', refuses: true, enforced: false };

  const normalized = canonical(filePath);
  const shape = (contract ?? {}) as ContractShape;

  const rootRow = shape.rootFiles?.find(entry => entry.path === normalized);
  if (rootRow && Number.isInteger(rootRow.maxBytes)) {
    return { budget: rootRow.maxBytes, source: 'root-contract', refuses: true, enforced: true };
  }

  const documentRow = shape.documentUpsum?.paths?.find(entry => entry.path === normalized);
  if (documentRow && Number.isInteger(documentRow.maxBytes)) {
    return { budget: documentRow.maxBytes, source: 'document-contract', refuses: true, enforced: true };
  }

  const fallback = shape.documentUpsum?.defaultMaxBytes;
  if (Number.isInteger(fallback) && (fallback as number) > 0) {
    return { budget: fallback as number, source: 'default', refuses: false, enforced: false };
  }
  return null;
}

/** Kept as the narrow root-file lookup the surface checker's own vocabulary
 *  uses; `resolveBudget` is the full ladder. */
export function budgetFromContract(contract: unknown, filePath: string): number | null {
  const rootFiles = (contract as ContractShape).rootFiles;
  if (!Array.isArray(rootFiles)) return null;
  const row = rootFiles.find(entry => entry.path === canonical(filePath));
  return row && Number.isInteger(row.maxBytes) ? row.maxBytes : null;
}

export function readMeasure(absolutePath: string, displayPath: string): DocumentMeasure {
  return measureDocument(displayPath, readFileSync(absolutePath, 'utf8'));
}

export function buildReceipt(
  measure: DocumentMeasure,
  budget: number | ResolvedBudget,
): UpsumReceipt {
  const resolved: ResolvedBudget =
    typeof budget === 'number'
      ? { budget, source: 'flag', refuses: true, enforced: false }
      : budget;
  if (!Number.isInteger(resolved.budget) || resolved.budget <= 0) {
    throw new DocumentBudgetUnknownError(
      `A positive integer budget is required to measure ${measure.path}; got ${String(resolved.budget)}. ` +
        'Contract the file in tools/repository-surface/root-contract.json or pass --budget.',
    );
  }
  return {
    ...measure,
    budget: resolved.budget,
    headroom: resolved.budget - measure.size,
    overBudget: measure.size > resolved.budget,
    budgetSource: resolved.source,
    refuses: resolved.refuses,
    enforced: resolved.enforced,
  };
}

/** Sections largest-first — the ranking is the whole point of the
 *  surface, so it is computed here and not left to the reader. */
export function rankedSections(measure: DocumentMeasure): readonly SectionMeasure[] {
  return [...measure.sections].sort((left, right) => right.bytes - left.bytes);
}

function percent(part: number, whole: number): string {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—';
}

/**
 * The receipt, in the shape `TrellisUpsum.commit` returns: what it is,
 * what it is measured against, and what is left. Over budget, the same
 * text carries the refusal and the ranked compression targets.
 */
const BUDGET_PROVENANCE: Readonly<Record<BudgetSource, string>> = {
  flag: '--budget flag, this run only',
  'root-contract': 'root-contract.json rootFiles — enforced by check:repo-surface',
  'document-contract': 'root-contract.json documentUpsum.paths — enforced by check:repo-surface',
  default: 'root-contract.json documentUpsum.defaultMaxBytes — a measuring stick, not a gate',
};

export function formatReceipt(receipt: UpsumReceipt): string {
  const ranked = rankedSections(receipt);
  const width = Math.max(...ranked.map(section => section.title.length), 8);
  const verdict = receipt.overBudget
    ? receipt.refuses
      ? `REFUSED: ${receipt.path} is ${receipt.size} bytes, over the ${receipt.budget}-byte budget by ` +
        `${receipt.size - receipt.budget}. Compress the least-decisive sections and measure again.`
      : `OVER (unenforced): ${receipt.path} is ${receipt.size} bytes, over the ${receipt.budget}-byte ` +
        `budget by ${receipt.size - receipt.budget}. No contract row gates this path — give it one if the bound should hold.`
    : `${receipt.path}: ${receipt.size} / ${receipt.budget} bytes, ${receipt.headroom} free ` +
      `(${percent(receipt.headroom, receipt.budget)} headroom).`;
  // Every receipt names where its number came from. A budget whose origin
  // the reader cannot trace is the remembered bound this surface abolishes.
  const head = `${verdict}\nBudget source: ${BUDGET_PROVENANCE[receipt.budgetSource]}.`;

  const rows = ranked.map(section => {
    const line = `  ${section.title.padEnd(width)}  ${String(section.bytes).padStart(6)}  ${percent(section.bytes, receipt.size).padStart(6)}`;
    if (section.subsections.length === 0) return line;
    const subs = [...section.subsections]
      .sort((left, right) => right.bytes - left.bytes)
      .map(sub => `      ${sub.title.padEnd(width - 4)}  ${String(sub.bytes).padStart(6)}`);
    return [line, ...subs].join('\n');
  });

  const preamble =
    receipt.preambleBytes > 0
      ? `  ${'(preamble)'.padEnd(width)}  ${String(receipt.preambleBytes).padStart(6)}  ${percent(receipt.preambleBytes, receipt.size).padStart(6)}`
      : null;

  return [head, '', 'Per-section bytes, largest first:', ...rows, ...(preamble ? [preamble] : [])].join('\n');
}
