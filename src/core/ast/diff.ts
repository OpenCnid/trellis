import type { Pool, PoolClient } from 'pg';

// Phase 4 Milestone 2: the Merkle diff engine.
//
// Because AST node ids are content hashes, comparing two versions of a
// document is two set operations — no tree alignment, no edit distance.
// A moved-but-unchanged block keeps its hash and lands in `retained`.

export interface MerkleDiff {
  // Hashes present in the new version but not the old. Leaf nodes in
  // this set are the ONLY nodes that need extraction/embedding.
  added: string[];
  // Hashes present in the old version but not the new — the input to
  // the Milestone 3 quarantine sweep.
  orphaned: string[];
  // The intersection: work avoided. This is the "Merkle discount" the
  // Update Drill reports.
  retained: string[];
}

export function computeDiff(oldIds: Iterable<string>, newIds: Iterable<string>): MerkleDiff {
  const oldSet = new Set(oldIds);
  const newSet = new Set(newIds);
  const added: string[] = [];
  const orphaned: string[] = [];
  const retained: string[] = [];
  for (const id of newSet) {
    if (oldSet.has(id)) retained.push(id);
    else added.push(id);
  }
  for (const id of oldSet) {
    if (!newSet.has(id)) orphaned.push(id);
  }
  return { added, orphaned, retained };
}

// Loads both versions' node-id sets from the document_nodes membership
// table and diffs them. Membership rows (not ast_nodes.document_id) are
// the version-set authority: ast_nodes rows are deduplicated across
// versions by ON CONFLICT DO NOTHING, so document_id only records the
// first version that inserted a node.
export async function diffVersions(
  db: Pool | PoolClient,
  oldRootHash: string,
  newRootHash: string
): Promise<MerkleDiff> {
  const load = async (rootHash: string): Promise<string[]> => {
    const res = await db.query(
      'SELECT node_id FROM document_nodes WHERE root_hash = $1',
      [rootHash]
    );
    return res.rows.map((r: { node_id: string }) => r.node_id);
  };
  const [oldIds, newIds] = await Promise.all([load(oldRootHash), load(newRootHash)]);
  return computeDiff(oldIds, newIds);
}
