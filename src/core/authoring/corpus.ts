import type { Pool } from 'pg';
import type { ASTNode } from '../ast/parser.js';
import { collectExtractionBlocks, nodeText } from '../ast/traverse.js';

// Session 19 (design record docs/architecture/GROUNDED_AUTHORING.md §4,
// D4): reading a promoted document's extraction blocks back out of
// PostgreSQL so the authoring driver can seed them into the workspace
// and pin them as the module's research provenance.
//
// The block set is derived exactly as promotion derives it
// (collectExtractionBlocks over the version's root AST), so the hashes
// this returns are the same content-addressed block hashes the
// promotion CLI printed as "citable" and the extraction path cites —
// the harness holds the pen (§5), never the model. Empty-text blocks
// are dropped (planExtraction's eligibility rule): they carry nothing to
// derive from and would seed empty segments. I/O is confined to
// readPromotedCorpus; blocksFromRoot is pure and unit-tested.

export interface CorpusBlock {
  /** The content-addressed extraction-block hash — a pinned citation. */
  hash: string;
  /** The block's reconstructed text, exactly as extraction would see it. */
  text: string;
  /** Which promoted document this block was first seen in (audit). */
  docKey: string;
}

export interface CorpusDocument {
  docKey: string;
  rootHash: string;
  version: number;
  /** This document's own extraction-eligible block hashes, in document order. */
  blockHashes: string[];
}

export interface PromotedCorpus {
  documents: CorpusDocument[];
  /** All corpus blocks, deduped by hash (first occurrence wins). */
  blocks: CorpusBlock[];
}

/**
 * The extraction-eligible blocks of one version's root AST: (hash, text)
 * pairs in document order, dropping blocks whose reconstructed text is
 * empty (the planExtraction eligibility rule). Pure — the mapping is
 * pinned by unit test independent of any database.
 */
export function blocksFromRoot(root: ASTNode): Array<{ hash: string; text: string }> {
  return collectExtractionBlocks(root)
    .map(block => ({ hash: block.id, text: nodeText(block) }))
    .filter(({ text }) => text.trim().length > 0);
}

function assertAstNode(value: unknown, rootHash: string): ASTNode {
  if (!value || typeof value !== 'object' || typeof (value as ASTNode).id !== 'string') {
    throw new Error(`Corpus root ${rootHash} did not read back as an AST node.`);
  }
  return value as ASTNode;
}

/**
 * Reads the current (latest) version of each promoted doc key and
 * returns its extraction blocks. Refuses an unknown doc key rather than
 * silently seeding a smaller corpus — a missing document is an operator
 * error to fix, not something to paper over. Blocks are globally deduped
 * by hash (a block shared across two corpus documents is one workspace
 * segment and one pinned citation).
 */
export async function readPromotedCorpus(
  pg: Pool,
  docKeys: readonly string[]
): Promise<PromotedCorpus> {
  const documents: CorpusDocument[] = [];
  const blocks: CorpusBlock[] = [];
  const seen = new Set<string>();

  for (const docKey of docKeys) {
    const versionRow = await pg.query(
      `SELECT version, root_hash FROM documents
       WHERE doc_key = $1 ORDER BY version DESC LIMIT 1`,
      [docKey]
    );
    if (versionRow.rows.length === 0) {
      throw new Error(
        `No promoted document under doc key '${docKey}'. Promote its corpus first `
        + '(npm run promote) and author from the printed doc keys.'
      );
    }
    const { version, root_hash: rootHash } = versionRow.rows[0] as {
      version: number;
      root_hash: string;
    };
    const rootRow = await pg.query('SELECT data FROM ast_nodes WHERE id = $1', [rootHash]);
    if (rootRow.rows.length === 0) {
      throw new Error(`Corpus root ${rootHash} for '${docKey}' is missing from ast_nodes.`);
    }
    const root = assertAstNode((rootRow.rows[0] as { data: unknown }).data, rootHash);
    const docBlocks = blocksFromRoot(root);
    if (docBlocks.length === 0) {
      throw new Error(
        `Promoted document '${docKey}' (version ${version}) has no extraction-eligible `
        + 'blocks; there is nothing to author from.'
      );
    }
    documents.push({ docKey, rootHash, version, blockHashes: docBlocks.map(b => b.hash) });
    for (const block of docBlocks) {
      if (seen.has(block.hash)) continue;
      seen.add(block.hash);
      blocks.push({ hash: block.hash, text: block.text, docKey });
    }
  }

  return { documents, blocks };
}

/**
 * The pinned research.sourceNodeIds for the assembled manifest: the
 * corpus block hashes, sorted and deduped (D3 flat v1). The model never
 * contributes a hash — this is computed mechanically from what was
 * seeded.
 */
export function pinnedSourceNodeIds(corpus: PromotedCorpus): string[] {
  return [...new Set(corpus.blocks.map(block => block.hash))].sort();
}
