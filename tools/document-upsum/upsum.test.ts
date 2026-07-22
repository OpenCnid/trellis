import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  budgetFromContract,
  buildReceipt,
  formatReceipt,
  measureDocument,
  rankedSections,
  resolveBudget,
  DocumentBudgetUnknownError,
  DocumentShapeError,
} from './upsum.js';

const DOC = [
  'preamble line',
  '',
  '## Alpha',
  'a'.repeat(50),
  '',
  '## Beta',
  'b'.repeat(10),
  '',
  '### Beta one',
  'c'.repeat(200),
  '',
].join('\n');

describe('measureDocument', () => {
  it('accounts for every byte: preamble + sections equals the file size', () => {
    const measure = measureDocument('doc.md', DOC);
    const sectionBytes = measure.sections.reduce((sum, section) => sum + section.bytes, 0);
    expect(measure.preambleBytes + sectionBytes).toBe(measure.size);
    expect(measure.size).toBe(Buffer.byteLength(DOC, 'utf8'));
  });

  it('rolls a subsection into its parent rather than losing or double-counting it', () => {
    const beta = measureDocument('doc.md', DOC).sections.find(s => s.title === 'Beta');
    expect(beta?.subsections.map(s => s.title)).toEqual(['Beta one']);
    const subtotal = beta!.subsections.reduce((sum, s) => sum + s.bytes, 0);
    expect(beta!.bytes).toBeGreaterThan(subtotal);
  });

  it('measures CRLF documents at their on-disk size', () => {
    const crlf = DOC.replace(/\n/g, '\r\n');
    const measure = measureDocument('doc.md', crlf);
    const sectionBytes = measure.sections.reduce((sum, section) => sum + section.bytes, 0);
    expect(measure.size).toBe(Buffer.byteLength(crlf, 'utf8'));
    expect(measure.preambleBytes + sectionBytes).toBe(measure.size);
  });

  it('refuses a document with no sections instead of reporting a bare total', () => {
    expect(() => measureDocument('flat.md', 'just prose\n')).toThrow(DocumentShapeError);
  });
});

describe('the budget gate', () => {
  it('reports headroom and does not refuse when within budget', () => {
    const receipt = buildReceipt(measureDocument('doc.md', DOC), 10_000);
    expect(receipt.overBudget).toBe(false);
    expect(receipt.headroom).toBe(10_000 - receipt.size);
  });

  it('refuses over budget and names the overage', () => {
    const receipt = buildReceipt(measureDocument('doc.md', DOC), 100);
    expect(receipt.overBudget).toBe(true);
    expect(receipt.headroom).toBeLessThan(0);
    expect(formatReceipt(receipt)).toContain('REFUSED');
  });

  it('ranks sections largest-first so the compression target is computed, not estimated', () => {
    const ranked = rankedSections(measureDocument('doc.md', DOC));
    expect(ranked[0].title).toBe('Beta');
    expect(ranked.map(s => s.bytes)).toEqual([...ranked.map(s => s.bytes)].sort((a, b) => b - a));
  });

  it('refuses a non-positive budget rather than inventing a default', () => {
    const measure = measureDocument('doc.md', DOC);
    expect(() => buildReceipt(measure, 0)).toThrow(DocumentBudgetUnknownError);
    expect(() => buildReceipt(measure, -1)).toThrow(DocumentBudgetUnknownError);
  });
});

describe('budget resolution from the root contract', () => {
  const contract = JSON.parse(
    readFileSync(path.join(process.cwd(), 'tools', 'repository-surface', 'root-contract.json'), 'utf8'),
  );

  it('resolves a contracted root file to its committed maxBytes', () => {
    const row = contract.rootFiles.find((entry: { path: string }) => entry.path === 'AGENTS.md');
    expect(budgetFromContract(contract, 'AGENTS.md')).toBe(row.maxBytes);
  });

  it('normalizes separators so a Windows path resolves to the same budget', () => {
    expect(budgetFromContract(contract, './AGENTS.md')).toBe(budgetFromContract(contract, 'AGENTS.md'));
  });

  it('prefers the explicit flag over every contracted value', () => {
    expect(resolveBudget(contract, 'AGENTS.md', 999)).toEqual({
      budget: 999,
      source: 'flag',
      // An author who typed a bound meant it: this run refuses. But CI
      // does not gate it, so the one-run question cannot masquerade as a
      // standing guarantee.
      refuses: true,
      enforced: false,
    });
  });

  it('resolves a root file ahead of the default, and marks it enforced', () => {
    const resolved = resolveBudget(contract, 'AGENTS.md', null)!;
    expect(resolved.source).toBe('root-contract');
    expect(resolved.enforced).toBe(true);
  });

  it('resolves a contracted document row, and marks it enforced', () => {
    const resolved = resolveBudget(contract, 'docs/GLOSSARY.md', null)!;
    expect(resolved.source).toBe('document-contract');
    expect(resolved.enforced).toBe(true);
    expect(resolved.budget).toBe(24576);
  });

  it('falls back to the contract default for an ungoverned path, unenforced', () => {
    const resolved = resolveBudget(contract, 'docs/COLLABORATOR_BRIEFING.md', null)!;
    expect(resolved.source).toBe('default');
    expect(resolved.budget).toBe(contract.documentUpsum.defaultMaxBytes);
    // The distinction that keeps a default from becoming a bound nothing
    // audits: it measures, it never gates.
    expect(resolved.enforced).toBe(false);
  });

  it('takes the default from the contract, never from this module', () => {
    // A tool carrying its own default puts the bound where no reviewer
    // reads and no checker audits it.
    expect(resolveBudget({ documentUpsum: { defaultMaxBytes: 123 } }, 'anything.md', null)).toEqual({
      budget: 123,
      source: 'default',
      refuses: false,
      enforced: false,
    });
    expect(resolveBudget({}, 'anything.md', null)).toBeNull();
  });

  it('every contracted document path exists', () => {
    for (const row of contract.documentUpsum.paths as { path: string }[]) {
      expect(readFileSync(path.join(process.cwd(), row.path)).byteLength).toBeGreaterThan(0);
    }
  });

  it('names the budget provenance on the receipt', () => {
    const measure = measureDocument('doc.md', DOC);
    const text = formatReceipt(buildReceipt(measure, resolveBudget(contract, 'AGENTS.md', null)!));
    expect(text).toContain('Budget source:');
    expect(text).toContain('enforced by check:repo-surface');
  });

  it('reports an unenforced overage without calling it a refusal', () => {
    const measure = measureDocument('doc.md', DOC);
    const text = formatReceipt(
      buildReceipt(measure, { budget: 10, source: 'default', refuses: false, enforced: false }),
    );
    expect(text).toContain('OVER (unenforced)');
    expect(text).not.toContain('REFUSED');
  });
});

describe('the entrypoint agrees with the surface checker', () => {
  it('measures AGENTS.md at its real size against its contracted budget', () => {
    const contract = JSON.parse(
      readFileSync(path.join(process.cwd(), 'tools', 'repository-surface', 'root-contract.json'), 'utf8'),
    );
    const absolute = path.join(process.cwd(), 'AGENTS.md');
    const measure = measureDocument('AGENTS.md', readFileSync(absolute, 'utf8'));
    const resolved = resolveBudget(contract, 'AGENTS.md', null)!;
    // The same predicate check:repo-surface applies, so the two surfaces
    // cannot disagree about whether the entrypoint is within contract.
    expect(measure.size).toBe(readFileSync(absolute).byteLength);
    expect(buildReceipt(measure, resolved).overBudget).toBe(false);
  });
});
