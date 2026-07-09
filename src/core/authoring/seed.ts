import { WorkspaceSnapshotSchema, type WorkspaceSnapshot } from '../../workers/workspace_scratch.js';
import type { CorpusBlock } from './corpus.js';

// Session 19 (design record docs/architecture/GROUNDED_AUTHORING.md §4,
// D4): mapping the promoted corpus into a workspace seed snapshot,
// block-aligned. One segment per corpus block; content is the block text
// verbatim; the origin stamp's argsHash is the first 16 hex of the block
// hash — deterministic and auditable, and structurally never confusable
// with full provenance (16 hex can never match ^[0-9a-f]{64}$, the
// Session 14 argsHash discipline). The seed crosses the SAME
// WorkspaceSnapshotSchema the lineage path validates and is restored by
// seed_from_snapshot unchanged; an over-budget corpus therefore refuses
// the run before any spend (the Session 16 over-budget-seed rule).
//
// Pure and deterministic given its inputs: the segment-id factory and
// fetch timestamp are injected so the unit test can pin the mapping. The
// driver supplies crypto.randomUUID and the assembly time.

/** Names the corpus-delivery source in every seeded segment's origin stamp. */
export const CORPUS_ORIGIN_SERVER = 'trellis-authoring';

/** Length of the block-hash prefix recorded as the segment argsHash. */
export const CORPUS_ARGS_HASH_LEN = 16;

export interface CorpusSeedOptions {
  /** uuid4 segment ids in the driver; a deterministic counter in tests. */
  mintId: () => string;
  /** ISO timestamp stamped as each segment's fetchedAt (assembly time). */
  fetchedAt: string;
  /** Optional goal correlation stamp, mirroring a real capture. */
  goalId?: string;
}

/**
 * Builds the seed snapshot from the corpus blocks. Segments are emitted
 * in corpus order (the readPromotedCorpus order: doc-key order, then
 * document order, deduped). The result is schema-validated before it is
 * returned so a malformed mapping fails in-process rather than at the
 * Python seed boundary.
 */
export function corpusToSnapshot(
  blocks: readonly CorpusBlock[],
  options: CorpusSeedOptions
): WorkspaceSnapshot {
  const segments: WorkspaceSnapshot['segments'] = {};
  for (const block of blocks) {
    const segmentId = options.mintId();
    segments[segmentId] = {
      origin: {
        server: CORPUS_ORIGIN_SERVER,
        tool: block.docKey,
        argsHash: block.hash.slice(0, CORPUS_ARGS_HASH_LEN),
      },
      fetchedAt: options.fetchedAt,
      bytes: Buffer.byteLength(block.text, 'utf8'),
      truncated: false,
      content: block.text,
      ...(options.goalId !== undefined && { goalId: options.goalId }),
    };
  }
  const snapshot: WorkspaceSnapshot = { version: 1, plan: [], notes: [], segments };
  // The seed must be a well-formed lineage snapshot: validate here so a
  // defect surfaces in the driver, not as a torn-seed raise in Python.
  return WorkspaceSnapshotSchema.parse(snapshot);
}

/**
 * The workspace-budget footprint of a seed, mirroring the Python
 * TrellisWorkspace accounting (segment bytes + plan bytes + note bytes).
 * The seed the driver builds carries an empty plan and no notes, so this
 * is essentially the corpus size — but computing it the same way keeps
 * the driver's guard aligned with seed_from_snapshot.
 */
export function seedByteFootprint(snapshot: WorkspaceSnapshot): number {
  const segmentBytes = Object.values(snapshot.segments).reduce((sum, seg) => sum + seg.bytes, 0);
  const planBytes = Buffer.byteLength(JSON.stringify(snapshot.plan), 'utf8');
  const noteBytes = snapshot.notes.reduce((sum, note) => sum + Buffer.byteLength(note, 'utf8'), 0);
  return segmentBytes + planBytes + noteBytes;
}

/**
 * Refuses an over-budget corpus BEFORE any spawn or assembly — the same
 * decision seed_from_snapshot makes at spawn, made in the driver so the
 * zero-paid --draft path enforces it too (the Session 16 over-budget-seed
 * rule). Never silently truncates.
 */
export function assertSeedWithinBudget(
  snapshot: WorkspaceSnapshot,
  maxSegments: number,
  maxBytes: number
): void {
  const segmentCount = Object.keys(snapshot.segments).length;
  if (segmentCount > maxSegments) {
    throw new Error(
      `Corpus seed exceeds the segment budget: ${segmentCount} corpus block(s) over the `
      + `${maxSegments} maximum. Author from a smaller corpus or raise `
      + 'TRELLIS_WORKSPACE_MAX_SEGMENTS.'
    );
  }
  const bytes = seedByteFootprint(snapshot);
  if (bytes > maxBytes) {
    throw new Error(
      `Corpus seed exceeds the byte budget: ${bytes} corpus byte(s) over the ${maxBytes} `
      + 'maximum. Author from a smaller corpus or raise TRELLIS_WORKSPACE_MAX_BYTES.'
    );
  }
}
