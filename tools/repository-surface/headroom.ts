// Governed byte headroom — the surface checker's non-test caller for the
// document-UPSUM ranking (AGENTS.md rule 15).
//
// `npm run upsum -- <path>` was correct and unreachable: nothing invoked
// it, so the ranking that names WHERE a document's bytes live existed
// only for an author who already knew to type it. The checker, meanwhile,
// reported a governed document's total and nothing else — and only once
// the cap was already broken.
//
// This module closes both halves at once. Every check:repo-surface run
// measures each governed path against its contracted cap, sorts by how
// little room is left, and — for any path at or under the contract's
// `nearBudgetRatio` — calls `measureDocument`/`rankedSections` from
// `tools/document-upsum` and prints the sections largest-first. So the
// ranking has an automatic caller, and an author sees which document is
// about to cross, and which of its sections is carrying the weight,
// before the crossing rather than at it.
//
// It MEASURES AND REPORTS. Being near a cap is not a violation, so no row
// here changes an exit code; the caps themselves are gated by
// `checkRepositorySurface`, which is where a bound belongs.

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { DocumentShapeError, measureDocument, rankedSections } from '../document-upsum/upsum.js';
import type { RootContract } from './check.js';

export interface HeadroomRow {
  readonly path: string;
  readonly size: number;
  readonly budget: number;
  readonly headroom: number;
  /** Headroom as a fraction of the budget. Negative when over. */
  readonly ratio: number;
  /** At or under the contract's `nearBudgetRatio` — worth ranking now. */
  readonly near: boolean;
}

/**
 * Every path the contract puts a byte cap on — root files and governed
 * documents alike — measured against it, tightest first.
 *
 * A contracted path that is absent is skipped rather than reported at
 * zero bytes: its absence is already a `missing_root_file` issue, and a
 * fabricated row would read as a comfortable one.
 */
export function governedHeadroom(repoRoot: string, contract: RootContract): HeadroomRow[] {
  const governed = [
    ...contract.rootFiles.map(row => ({ path: row.path, budget: row.maxBytes })),
    ...contract.documentUpsum.paths.map(row => ({ path: row.path, budget: row.maxBytes })),
  ];
  const rows: HeadroomRow[] = [];

  for (const entry of governed) {
    const absolutePath = path.join(repoRoot, entry.path);
    if (!existsSync(absolutePath)) continue;
    const size = statSync(absolutePath).size;
    const headroom = entry.budget - size;
    const ratio = headroom / entry.budget;
    rows.push({
      path: entry.path,
      size,
      budget: entry.budget,
      headroom,
      ratio,
      near: ratio <= contract.documentUpsum.nearBudgetRatio,
    });
  }

  return rows.sort((left, right) => left.ratio - right.ratio || left.path.localeCompare(right.path));
}

/**
 * The per-section ranking for one governed path, or nothing at all.
 *
 * A file with no `## ` sections has no compression targets to name, and
 * `measureDocument` refuses rather than return a bare total — which is
 * exactly right here, because the headroom line above it already IS the
 * total. Nothing is invented to fill the space.
 */
function sectionRanking(repoRoot: string, documentPath: string, indent: string): string[] {
  const absolutePath = path.join(repoRoot, documentPath);
  let ranked;
  try {
    ranked = rankedSections(measureDocument(documentPath, readFileSync(absolutePath, 'utf8')));
  } catch (error) {
    if (error instanceof DocumentShapeError) return [];
    throw error;
  }
  const width = Math.max(...ranked.map(section => section.title.length), 8);
  return ranked.map(
    section => `${indent}${section.title.padEnd(width)}  ${String(section.bytes).padStart(7)}`,
  );
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatHeadroomReport(
  repoRoot: string,
  contract: RootContract,
  rows = governedHeadroom(repoRoot, contract),
): string {
  if (rows.length === 0) return 'Governed byte headroom: no contracted path is present on disk.';

  const width = Math.max(...rows.map(row => row.path.length));
  const lines = [
    `Governed byte headroom, tightest first (NEAR at ${percent(contract.documentUpsum.nearBudgetRatio)} free or less):`,
  ];

  for (const row of rows) {
    const marker = row.headroom < 0 ? 'OVER' : row.near ? 'NEAR' : '  ok';
    lines.push(
      `  ${marker}  ${row.path.padEnd(width)}  ${String(row.size).padStart(7)} / ${String(row.budget).padStart(7)}` +
        `  ${String(row.headroom).padStart(8)} free  ${percent(row.ratio).padStart(7)}`,
    );
    if (!row.near) continue;
    const ranking = sectionRanking(repoRoot, row.path, '        ');
    if (ranking.length === 0) continue;
    lines.push(
      `        sections largest-first — subsections via \`npm run upsum -- ${row.path}\`:`,
      ...ranking,
    );
  }

  return lines.join('\n');
}
