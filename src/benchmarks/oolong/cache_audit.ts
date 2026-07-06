import type { Driver } from 'neo4j-driver';
import { OolongDataset } from './schema';

// Session 6: cache-audit accuracy as a first-class metric.
//
// One implementation of "how trustworthy is the flywheel cache",
// shared by the maintenance CLI (scripts/audit_flywheel_cache.ts), the
// benchmark runner's post-warm results block, and the poison drill —
// so "poison recall" and "cache accuracy" can never drift apart.
// The arithmetic is pure and unit-testable; the graph read is a
// separate id-scoped fetch so multiple corpora can coexist in one
// graph without polluting each other's audits.

export interface CachedCategoryRow {
  /** Question id (the subject Entity's name). */
  qid: string;
  /** Cached lowercase TREC label (the object Entity's name). */
  label: string;
}

export interface CacheAuditResult {
  /** Cached rows considered (post id-scoping). */
  cached: number;
  correct: number;
  wrong: number;
  /** Rows whose qid has no ground-truth entry. */
  unknown: number;
  /** correct / (correct + wrong); null when there is nothing to grade. */
  accuracy: number | null;
  /** Bounded sample of graded mismatches. */
  mistakes: Array<{ qid: string; cached: string; truth: string }>;
}

const MISTAKE_SAMPLE_LIMIT = 15;

/** Pure audit arithmetic: grade cached rows against ground truth. */
export function auditCacheRows(
  truth: ReadonlyMap<string, string>,
  rows: readonly CachedCategoryRow[]
): CacheAuditResult {
  let correct = 0;
  let wrong = 0;
  let unknown = 0;
  const mistakes: CacheAuditResult['mistakes'] = [];
  for (const { qid, label } of rows) {
    const expected = truth.get(qid);
    if (!expected) {
      unknown++;
      continue;
    }
    if (expected.toLowerCase() === label.toLowerCase()) correct++;
    else {
      wrong++;
      if (mistakes.length < MISTAKE_SAMPLE_LIMIT) {
        mistakes.push({ qid, cached: label, truth: expected });
      }
    }
  }
  const graded = correct + wrong;
  return {
    cached: rows.length,
    correct,
    wrong,
    unknown,
    accuracy: graded === 0 ? null : correct / graded,
    mistakes
  };
}

/** Ground-truth label map for a dataset (uppercase TREC categories). */
export function datasetTruth(dataset: OolongDataset): Map<string, string> {
  return new Map(dataset.records.map(r => [r.id, r.category]));
}

/**
 * Fetches the EFFECTIVE (non-contested) cached has_category rows for
 * the given question ids. Quarantined beliefs are excluded because the
 * agent protocol never reads them — the audit grades what the cache
 * actually serves. Pass includeContested to grade quarantined edges
 * too (e.g. to inspect detection state).
 */
export async function fetchCachedCategoryRows(
  driver: Driver,
  questionIds: readonly string[],
  options: { includeContested?: boolean } = {}
): Promise<CachedCategoryRow[]> {
  const session = driver.session();
  try {
    const res = await session.executeRead(tx =>
      tx.run(
        `MATCH (s:Entity)-[r:DERIVED_INSIGHT {verb: 'has_category'}]->(o:Entity)
         WHERE s.name IN $ids
           AND ($includeContested OR coalesce(r.contested, false) = false)
         RETURN s.name AS qid, o.name AS label`,
        { ids: [...questionIds], includeContested: options.includeContested ?? false }
      )
    );
    return res.records.map(rec => ({
      qid: rec.get('qid') as string,
      label: String(rec.get('label'))
    }));
  } finally {
    await session.close();
  }
}

/** Convenience: fetch + grade in one call, scoped to the dataset. */
export async function auditFlywheelCache(
  driver: Driver,
  dataset: OolongDataset,
  options: { includeContested?: boolean } = {}
): Promise<CacheAuditResult> {
  const rows = await fetchCachedCategoryRows(
    driver,
    dataset.records.map(r => r.id),
    options
  );
  return auditCacheRows(datasetTruth(dataset), rows);
}
