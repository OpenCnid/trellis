import type { Pool } from 'pg';
import { parseMarkdownToAST, type ASTNode } from '../ast/parser.js';
import { flattenAST } from '../ast/traverse.js';
import { diffVersions, type MerkleDiff } from '../ast/diff.js';
import {
  registerDocumentVersion,
  recordDocumentNodes,
  type VersionRegistration,
} from '../ast/registry.js';
import {
  buildExtractionJobs,
  persistAstNodes,
  verifyPersistedAstNodes,
  type ExtractionJob,
  type ExtractionSourceKind,
} from '../ast/persist.js';
import { planExtraction, type ExtractionPolicy } from './plan_ingest.js';
import type { Logger } from '../observability/logger.js';

// Session 8: the verified ingest service, extracted verbatim from
// POST /ingest so the repository CLI and the API share one
// correctness-critical implementation instead of duplicating it or
// sending one HTTP request per file.
//
// The physical transaction is unchanged from T15: flattenAST →
// persistAstNodes → read-back verification → recordDocumentNodes →
// registerDocumentVersion. The Merkle diff moved INSIDE the same
// transaction (diffVersions accepts the client), which lets a budget
// rejection roll the whole version back before any registry state or
// queue write exists — previously the diff ran after commit, which was
// equivalent because nothing could fail between them.

export interface IngestQueues {
  extraction: { addBulk(jobs: ExtractionJob[]): Promise<unknown> };
  invalidation: { add(name: string, data: Record<string, unknown>): Promise<unknown> };
}

export interface IngestDeps {
  pgPool: Pool;
  queues: IngestQueues;
  log: Logger;
}

export interface IngestRequest {
  rootNode: ASTNode;
  docKey: string;
  extractionPolicy: ExtractionPolicy;
  requestId?: string;
  /**
   * Promotion audit stamp (Session 17): recorded on the documents row,
   * inside the same transaction. Only segment promotion supplies this;
   * API/repository ingests leave it undefined (column stays NULL).
   */
  origin?: Record<string, unknown>;
  /**
   * Session 25: prompt-routing metadata stamped onto every queued
   * extraction job. Repository snapshots supply it per file language;
   * every other caller's content is markdown prose by construction, so
   * an unset sourceKind defaults to 'prose' at the enqueue — which the
   * worker maps to the exact legacy prompt bytes.
   */
  sourceKind?: ExtractionSourceKind;
  language?: string;
}

export interface IngestResult {
  rootId: string;
  docKey: string;
  version: number;
  totalNodes: number;
  // Cost-policy telemetry: what 'changed' would pay for vs. what this
  // ingest actually queued.
  blocksEligible: number;
  blocksQueued: number;
  extractionPolicy: ExtractionPolicy['mode'];
  diff: { added: number; orphaned: number; retained: number } | null;
}

/**
 * The deterministic empty root used as a tombstone version for deleted
 * repository files. Parsing the empty string through the pinned markdown
 * hash authority yields a root with no children and no extraction
 * blocks; registering it as a document's latest version makes every
 * prior node of that document a global-liveness orphan candidate.
 */
export function emptyDocumentRoot(): ASTNode {
  return parseMarkdownToAST('');
}

export async function ingestDocument(
  deps: IngestDeps,
  request: IngestRequest
): Promise<IngestResult> {
  const { rootNode, docKey, extractionPolicy, requestId, origin, sourceKind, language } = request;
  const allNodes = flattenAST(rootNode);

  let registration: VersionRegistration;
  let diff: MerkleDiff | null = null;
  let plan;
  const client = await deps.pgPool.connect();
  try {
    await client.query('BEGIN');
    await persistAstNodes(client, rootNode.id, allNodes);
    // T15 verified ingestion: read the immutable rows back and re-derive
    // every id through parser.ts before registry state can commit. A
    // missing/corrupt/conflicting row rolls the entire version back.
    await verifyPersistedAstNodes(client, allNodes);
    await recordDocumentNodes(client, rootNode.id, allNodes.map(n => n.id));
    registration = await registerDocumentVersion(client, docKey, rootNode.id, origin);
    // Merkle diff against the prior version. Shared subtree hashes are
    // skipped entirely; only genuinely new blocks are extraction-
    // eligible. Byte-identical re-ingest yields an empty diff.
    if (registration.priorRootHash) {
      diff = await diffVersions(client, registration.priorRootHash, rootNode.id);
    }
    // Throws ExtractionBudgetExceededError past the ROLLBACK below, so an
    // over-budget plan leaves no version and queues nothing.
    plan = planExtraction(rootNode, diff, extractionPolicy);
    await client.query('COMMIT');
  } catch (dbErr) {
    await client.query('ROLLBACK');
    throw dbErr;
  } finally {
    client.release();
  }

  if (diff && diff.orphaned.length > 0) {
    // Quarantine sweep (Milestone 3): facts derived from bytes that
    // vanished in this version get contested by the worker. The queued
    // extraction blocks travel along as the sweep's fresh set: the sweep
    // and the extraction jobs race, and a fact re-extracted from this
    // version's live bytes must stay recovered whichever write lands
    // last (src/core/graph/provenance.ts). Under policy 'none' the fresh
    // set is empty, so old facts quarantine conservatively.
    await deps.queues.invalidation.add('sweep', {
      docKey,
      oldVersion: registration.version - 1,
      newVersion: registration.version,
      orphanedHashes: diff.orphaned,
      freshHashes: plan.blocks.map(({ block }) => block.id),
      requestId,
    });
    deps.log.info({
      event: 'ingest.invalidation_queued',
      docKey,
      version: registration.version,
      orphanedCount: diff.orphaned.length,
    });
  }

  if (plan.blocks.length > 0) {
    await deps.queues.extraction.addBulk(buildExtractionJobs(plan.blocks, {
      requestId,
      docKey,
      version: registration.version,
      sourceKind: sourceKind ?? 'prose',
      ...(language !== undefined && { language }),
    }));
  }

  const result: IngestResult = {
    rootId: rootNode.id,
    docKey: registration.docKey,
    version: registration.version,
    totalNodes: allNodes.length,
    blocksEligible: plan.blocksEligible,
    blocksQueued: plan.blocks.length,
    extractionPolicy: extractionPolicy.mode,
    diff: diff
      ? { added: diff.added.length, orphaned: diff.orphaned.length, retained: diff.retained.length }
      : null,
  };
  deps.log.info({ event: 'ingest.accepted', ...result, diff: result.diff });
  return result;
}

/**
 * Registers a tombstone version for a document whose source path no
 * longer exists (repository deletion/rename protocol). The tombstone is
 * an ordinary verified ingest of the deterministic empty root under
 * policy 'none': it has no extraction blocks, makes the prior version's
 * membership globally dead, and queues invalidation for it. Belief
 * history is quarantined by the sweep, never deleted.
 */
export async function ingestTombstone(
  deps: IngestDeps,
  docKey: string,
  requestId?: string
): Promise<IngestResult> {
  return ingestDocument(deps, {
    rootNode: emptyDocumentRoot(),
    docKey,
    extractionPolicy: { mode: 'none' },
    requestId,
  });
}
