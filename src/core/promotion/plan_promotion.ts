import type { WorkspaceSnapshot } from '../../workers/workspace_scratch.js';

// Session 17: the promotion path (design record §6, §11 step 5) — the
// pure half of the operator-gated bridge from a Tier-3 workspace segment
// to the verified ingest path. Given a parked snapshot (already parsed
// by workspace_scratch.ts — the schema is not duplicated here) and a
// segment id, this module either produces the exact ingest request or a
// typed refusal. It never touches Redis, PostgreSQL, or the filesystem;
// the CLI owns all I/O and the operator owns the decision.
//
// Refusals are absolute, not advisory:
//   - a truncated segment is NOT the source bytes (the MCP size cap cut
//     it); promoting it would mint verified hashes over corrupt content;
//   - empty content has nothing to verify;
//   - doc keys are never invented silently — the operator supplies one,
//     and the deterministic mcp:<server>:<tool>:<argsHash> fallback is
//     OFFERED (printed), never applied.

/**
 * The audit stamp recorded on the promoted documents row: which
 * server/tool/args produced these bytes, fetched when, from which
 * workspace segment of which goal/task. Wrapper-owned values copied
 * verbatim from the segment — the model never gets to claim these.
 */
export interface PromotionOrigin {
  server: string;
  tool: string;
  argsHash: string;
  fetchedAt: string;
  segmentId: string;
  bytes: number;
  goalId?: string;
  taskId?: string;
}

export interface PromotionRequest {
  docKey: string;
  /** The segment's content, byte-verbatim — no normalization, no trimming. */
  content: string;
  origin: PromotionOrigin;
}

export type PromotionRefusalReason =
  | 'unknown_segment'
  | 'truncated_segment'
  | 'empty_content'
  | 'invalid_doc_key';

export type PromotionPlan =
  | { ok: true; request: PromotionRequest }
  | { ok: false; reason: PromotionRefusalReason; message: string };

/** One segment as the list-mode inventory presents it to the operator. */
export interface SegmentSummary {
  id: string;
  server: string;
  tool: string;
  argsHash: string;
  fetchedAt: string;
  bytes: number;
  truncated: boolean;
  preview: string;
  /** The deterministic doc-key fallback for non-URL tool results. */
  suggestedDocKey: string;
}

const PREVIEW_MAX_CHARS = 200;
const DOC_KEY_MAX_CHARS = 512;
const LISTING_MAX_SEGMENTS = 20;

// An anonymous API ingest without a doc_key uses the root hash as its
// key, so a promotion key that *looks like* an AST hash would collide
// with that namespace and shape-confuse Tier 1 identifiers.
const AST_HASH_PATTERN = /^[0-9a-f]{64}$/;

// repo:<key>:<path> identities belong to repository snapshots; promoting
// under one would make the snapshot machinery tombstone it on the next
// repo:ingest run.
const RESERVED_PREFIX = 'repo:';

/**
 * The deterministic doc-key fallback derived from the origin stamp.
 * Stable across refreshes of the same tool call (same server, tool, and
 * args hash), which is what lets re-promotion version the document.
 */
export function derivedDocKey(origin: { server: string; tool: string; argsHash: string }): string {
  return `mcp:${origin.server}:${origin.tool}:${origin.argsHash}`;
}

export type DocKeyValidation = { ok: true } | { ok: false; message: string };

/**
 * Doc keys are the document's identity across versions, so the rules are
 * conservative: printable, whitespace-free, bounded, and outside the
 * namespaces other subsystems own. `web:<url>` is the recommended form
 * for web content; derivedDocKey() covers non-URL tool results.
 */
export function validatePromotionDocKey(docKey: string): DocKeyValidation {
  if (docKey.length === 0) {
    return { ok: false, message: 'doc key must not be empty' };
  }
  if (docKey.length > DOC_KEY_MAX_CHARS) {
    return { ok: false, message: `doc key exceeds ${DOC_KEY_MAX_CHARS} characters` };
  }
  if (/[\s\u0000-\u001f\u007f]/.test(docKey)) {
    return { ok: false, message: 'doc key must not contain whitespace or control characters' };
  }
  if (AST_HASH_PATTERN.test(docKey)) {
    return {
      ok: false,
      message: 'doc key must not have the shape of an AST hash (64 lowercase hex) — '
        + 'that namespace identifies anonymous ingests by root hash',
    };
  }
  if (docKey.startsWith(RESERVED_PREFIX)) {
    return {
      ok: false,
      message: `doc keys under '${RESERVED_PREFIX}' belong to repository snapshots; `
        + 'the next repo:ingest run would tombstone a promoted document there',
    };
  }
  return { ok: true };
}

/** Bounded single-line preview for operator inventories. */
function previewOf(content: string): string {
  const flattened = content.replace(/\s+/g, ' ').trim();
  return flattened.length > PREVIEW_MAX_CHARS
    ? `${flattened.slice(0, PREVIEW_MAX_CHARS)}...`
    : flattened;
}

/**
 * The list-mode inventory: every segment's identity, origin stamps,
 * size, truncation flag, bounded preview, and suggested fallback key,
 * sorted by fetch time so the operator reads the run in order.
 */
export function listSegments(snapshot: WorkspaceSnapshot): SegmentSummary[] {
  return Object.entries(snapshot.segments)
    .map(([id, segment]) => ({
      id,
      server: segment.origin.server,
      tool: segment.origin.tool,
      argsHash: segment.origin.argsHash,
      fetchedAt: segment.fetchedAt,
      bytes: segment.bytes,
      truncated: segment.truncated,
      preview: previewOf(segment.content),
      suggestedDocKey: derivedDocKey(segment.origin),
    }))
    .sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt) || a.id.localeCompare(b.id));
}

/** Bounded "what the snapshot does hold" listing for unknown-id refusals. */
function boundedSegmentListing(snapshot: WorkspaceSnapshot): string {
  const ids = Object.keys(snapshot.segments).sort();
  if (ids.length === 0) return 'the snapshot holds no segments';
  const shown = ids.slice(0, LISTING_MAX_SEGMENTS);
  const suffix = ids.length > shown.length ? `, +${ids.length - shown.length} more` : '';
  return `the snapshot holds ${ids.length} segment(s): ${shown.join(', ')}${suffix}`;
}

/**
 * Plans one segment's promotion: the exact ingest request the operator
 * approved, or a typed refusal. The content crosses verbatim — the
 * verified ingest transaction re-hashes exactly the bytes the wrapper
 * captured.
 */
export function planSegmentPromotion(
  snapshot: WorkspaceSnapshot,
  segmentId: string,
  docKey: string
): PromotionPlan {
  const segment = snapshot.segments[segmentId];
  if (!segment) {
    return {
      ok: false,
      reason: 'unknown_segment',
      message: `no segment '${segmentId}' in the parked snapshot; ${boundedSegmentListing(snapshot)}`,
    };
  }
  if (segment.truncated) {
    return {
      ok: false,
      reason: 'truncated_segment',
      message: `segment '${segmentId}' was truncated by the MCP size cap — its content is not `
        + 'the source bytes, and promoting a known-partial fetch would mint verified hashes '
        + 'over corrupt content. Re-fetch within the cap and promote the complete capture.',
    };
  }
  if (segment.content.length === 0) {
    return {
      ok: false,
      reason: 'empty_content',
      message: `segment '${segmentId}' has empty content; there is nothing to verify or ingest`,
    };
  }
  const keyCheck = validatePromotionDocKey(docKey);
  if (!keyCheck.ok) {
    return { ok: false, reason: 'invalid_doc_key', message: keyCheck.message };
  }
  return {
    ok: true,
    request: {
      docKey,
      content: segment.content,
      origin: {
        server: segment.origin.server,
        tool: segment.origin.tool,
        argsHash: segment.origin.argsHash,
        fetchedAt: segment.fetchedAt,
        segmentId,
        bytes: segment.bytes,
        ...(segment.goalId !== undefined && { goalId: segment.goalId }),
        ...(segment.taskId !== undefined && { taskId: segment.taskId }),
      },
    },
  };
}
