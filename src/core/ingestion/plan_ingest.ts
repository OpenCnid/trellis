import type { ASTNode } from '../ast/parser.js';
import {
  collectExtractionBlocks,
  EXTRACTION_INELIGIBLE_BLOCK_TYPES,
  nodeText,
} from '../ast/traverse.js';
import type { MerkleDiff } from '../ast/diff.js';

// Session 8: the extraction-planning half of the verified ingest service.
//
// Extraction is one paid chat completion plus one paid embedding call per
// queued block (extraction_worker.ts), so which blocks get queued is a
// cost decision that must be explicit and inspectable before any queue
// write. The plan is pure: it looks at the parsed AST, the Merkle diff,
// and the caller's policy — never at a database or a queue.

export type ExtractionPolicy =
  // Persist, register, diff, and queue invalidation only. No extraction
  // or embedding jobs: fresh hashes are empty, so facts whose provenance
  // died quarantine conservatively. The repository CLI default.
  | { mode: 'none' }
  // Current single-document behavior: queue every non-empty block that is
  // new to this version. maxBlocks, when present, is a hard budget — a
  // plan that exceeds it is rejected before anything is enqueued (and,
  // because the executor plans inside the ingest transaction, before the
  // version registers).
  | { mode: 'changed'; maxBlocks?: number };

export interface PlannedBlock {
  block: ASTNode;
  text: string;
}

export interface ExtractionPlan {
  // Non-empty extraction blocks new to this version — what 'changed'
  // would pay for.
  blocksEligible: number;
  // Blocks the executor will actually enqueue (empty under 'none').
  blocks: PlannedBlock[];
}

export class ExtractionBudgetExceededError extends Error {
  readonly blocksEligible: number;
  readonly maxBlocks: number;

  constructor(blocksEligible: number, maxBlocks: number) {
    super(
      `Extraction plan of ${blocksEligible} block(s) exceeds the budget of ${maxBlocks}; `
      + 'nothing was queued'
    );
    this.name = 'ExtractionBudgetExceededError';
    this.blocksEligible = blocksEligible;
    this.maxBlocks = maxBlocks;
  }
}

/**
 * Selects the extraction blocks for one ingested version. Mirrors the
 * pre-Session-8 /ingest selection exactly: block-level nodes with
 * non-empty reconstructed text, restricted to diff.added when a prior
 * version exists.
 */
export function planExtraction(
  rootNode: ASTNode,
  diff: MerkleDiff | null,
  policy: ExtractionPolicy
): ExtractionPlan {
  const addedSet = diff ? new Set(diff.added) : null;
  // Session 38: typed-and-skipped kinds (code_import) stay readable
  // blocks in the walk but never become paid extraction or embedding
  // jobs. Pre-Session-38 documents contain none of these kinds, so
  // legacy plans are byte-identical.
  const eligible = collectExtractionBlocks(rootNode)
    .map(block => ({ block, text: nodeText(block) }))
    .filter(({ block, text }) =>
      text.trim().length > 0
      && !EXTRACTION_INELIGIBLE_BLOCK_TYPES.has(block.type)
      && (!addedSet || addedSet.has(block.id))
    );

  if (policy.mode === 'none') {
    return { blocksEligible: eligible.length, blocks: [] };
  }
  if (policy.maxBlocks !== undefined && eligible.length > policy.maxBlocks) {
    throw new ExtractionBudgetExceededError(eligible.length, policy.maxBlocks);
  }
  return { blocksEligible: eligible.length, blocks: eligible };
}
