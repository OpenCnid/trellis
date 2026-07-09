import { parseMarkdownToAST } from '../ast/parser.js';
import { collectExtractionBlocks } from '../ast/traverse.js';
import { ingestDocument, type IngestDeps, type IngestResult } from '../ingestion/ingest_document.js';
import type { ExtractionPolicy } from '../ingestion/plan_ingest.js';
import type { PromotionRequest } from './plan_promotion.js';

// Session 17: the execution half of segment promotion — one planned
// request through the ordinary verified ingest transaction (persist →
// read-back re-hash → membership → registration with the origin stamp →
// in-transaction Merkle diff). Promotion adds NOTHING to that
// transaction and bypasses no part of it; that is what makes the
// resulting hashes citable. Re-promoting changed content under the same
// doc key versions the document, and the queued invalidation sweep
// contests beliefs whose bytes changed — refreshed external content is
// handled exactly like an edited document.

export interface PromotionOutcome {
  ingest: IngestResult;
  /**
   * Block-level extraction-unit hashes of the promoted version, in
   * document order — the granularity extraction cites, and what the
   * operator hands to the RLM as now-citable sourceNodeIds.
   */
  blockIds: string[];
}

export async function promoteSegment(
  deps: IngestDeps,
  request: PromotionRequest,
  policy: ExtractionPolicy,
  requestId?: string
): Promise<PromotionOutcome> {
  // The pinned markdown hash authority: segment content is text, and
  // re-promotion of byte-identical content must re-derive identical ids.
  const rootNode = parseMarkdownToAST(request.content);
  const ingest = await ingestDocument(deps, {
    rootNode,
    docKey: request.docKey,
    extractionPolicy: policy,
    requestId,
    origin: { ...request.origin },
  });
  return { ingest, blockIds: collectExtractionBlocks(rootNode).map(block => block.id) };
}
