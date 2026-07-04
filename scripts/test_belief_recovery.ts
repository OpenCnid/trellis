import * as crypto from 'crypto';
import { parseMarkdownToAST, ASTNode } from '../src/core/ast/parser';
import { collectExtractionBlocks } from '../src/core/ast/traverse';
import { diffVersions } from '../src/core/ast/diff';
import { registerDocumentVersion, recordDocumentNodes, isAstNodeLive } from '../src/core/ast/registry';
import { sweepOrphanedProvenance } from '../src/core/graph/invalidation';
import { mergeExtractedGraph, EnrichedAction } from '../src/core/graph/extraction_merge';
import { pgPool, neo4jDriver } from '../src/config/db';
import type { Entity } from '../src/core/graph/schemas';

// Belief-quarantine recovery for EXTRACTION-produced facts, live and in
// both worker orders (requires the docker-compose stack; no LLM calls —
// the extraction worker's real merge Cypher is driven directly).
//
// The bug this guards against: editing "acquired Initech in 2024" to
// "in 2025" re-extracts the same (subject)-[ACTION]->(object) edge with
// fresh block provenance, but the pre-fix ON MATCH only appended
// sourceNodeIds — contested was never cleared, so a fact with a live
// source stayed hidden from /retrieve forever.
//
//   1. Ingest v1 with two facts; simulate extraction (real merge Cypher).
//   2. Ingest v2 editing both paragraphs; take the Merkle diff.
//   3. Fact B: RE-EXTRACT FIRST, then sweep  (extraction wins the race).
//      Fact A: SWEEP FIRST, then re-extract  (sweep wins the race).
//      Both must converge on the same recovered state — edge and Entity
//      endpoints uncontested, live provenance only, orphaned hashes kept
//      as audit (provenance.ts commutation, here against a real graph).
//   4. Liveness gate: superseded v1 blocks are dead, v2 blocks and
//      registry-unknown hashes are live.
//   5. Revert: v3 restores the v1 bytes for fact A; the resurrected v1
//      hash recovers the fact again (orphanedSourceIds gives it back).

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
  if (!ok) failures++;
}

function flattenAST(node: ASTNode, acc: ASTNode[] = []): ASTNode[] {
  acc.push(node);
  for (const child of node.children ?? []) flattenAST(child, acc);
  return acc;
}

const TOKEN = `test-recovery-${Date.now()}`;
const SUBJ_A = `${TOKEN}-globex`;
const OBJ_A = `${TOKEN}-initech`;
const SUBJ_B = `${TOKEN}-hooli`;
const OBJ_B = `${TOKEN}-piedpiper`;

const v1Markdown = `${SUBJ_A} acquired ${OBJ_A} in 2024.\n\n${SUBJ_B} acquired ${OBJ_B} in 2024.`;
const v2Markdown = `${SUBJ_A} acquired ${OBJ_A} in 2025.\n\n${SUBJ_B} acquired ${OBJ_B} in 2025.`;

async function ingestVersion(markdown: string) {
  const rootNode = parseMarkdownToAST(markdown);
  const allNodes = flattenAST(rootNode);
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    for (const node of allNodes) {
      await client.query(
        `INSERT INTO ast_nodes (id, document_id, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
        [node.id, rootNode.id, JSON.stringify(node)]
      );
    }
    await recordDocumentNodes(client, rootNode.id, allNodes.map(n => n.id));
    const registration = await registerDocumentVersion(client, TOKEN, rootNode.id);
    await client.query('COMMIT');
    // Paragraph block hashes in document order — the extraction units.
    const blocks = collectExtractionBlocks(rootNode).map(b => b.id);
    return { rootNode, allNodes, registration, blocks };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// What the extraction worker would produce for one "X acquired Y" block.
function extractionOf(subject: string, object: string, blockHash: string) {
  const globalId = (name: string) => crypto.createHash('sha256').update(name.toLowerCase()).digest('hex');
  const entities: Entity[] = [
    { id: globalId(subject), name: subject, type: 'Organization', sourceNodeIds: [blockHash] },
    { id: globalId(object), name: object, type: 'Organization', sourceNodeIds: [blockHash] }
  ];
  const actions: EnrichedAction[] = [{
    id: crypto.randomUUID(),
    verb: 'acquired',
    subjectName: subject,
    objectName: object,
    subjectId: globalId(subject),
    objectId: globalId(object),
    sourceNodeIds: [blockHash]
  }];
  return { entities, actions };
}

interface FactState {
  contested: boolean;
  sourceNodeIds: string[];
  orphanedSourceIds: string[] | null;
  rederivedAt: unknown;
  subjectContested: boolean;
  subjectSources: string[];
}

async function factState(subject: string, object: string): Promise<FactState | undefined> {
  const session = neo4jDriver.session();
  try {
    const res = await session.run(
      `MATCH (s:Entity {name: $subj})-[r:ACTION {verb: 'acquired'}]->(o:Entity {name: $obj})
       RETURN coalesce(r.contested, false) AS contested,
              r.sourceNodeIds AS sourceNodeIds,
              r.orphanedSourceIds AS orphanedSourceIds,
              r.rederivedAt AS rederivedAt,
              coalesce(s.contested, false) AS subjectContested,
              s.sourceNodeIds AS subjectSources`,
      { subj: subject.toLowerCase(), obj: object.toLowerCase() }
    );
    const rec = res.records[0];
    return rec && {
      contested: rec.get('contested'),
      sourceNodeIds: rec.get('sourceNodeIds'),
      orphanedSourceIds: rec.get('orphanedSourceIds'),
      rederivedAt: rec.get('rederivedAt'),
      subjectContested: rec.get('subjectContested'),
      subjectSources: rec.get('subjectSources')
    };
  } finally {
    await session.close();
  }
}

async function cleanup(rootHashes: string[], nodeIds: string[]): Promise<void> {
  const session = neo4jDriver.session();
  try {
    await session.run(`MATCH (n:Entity) WHERE n.name STARTS WITH $prefix DETACH DELETE n`, { prefix: TOKEN.toLowerCase() });
  } finally {
    await session.close();
  }
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM documents WHERE doc_key = $1', [TOKEN]);
    await client.query('DELETE FROM document_nodes WHERE root_hash = ANY($1)', [rootHashes]);
    await client.query('DELETE FROM ast_nodes WHERE id = ANY($1)', [nodeIds]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  console.log('Belief-quarantine recovery for extraction-produced facts (order-independent)');
  const seenNodeIds = new Set<string>();
  const rootHashes: string[] = [];
  try {
    // 1. v1 ingest + simulated extraction of both blocks
    const v1 = await ingestVersion(v1Markdown);
    v1.allNodes.forEach(n => seenNodeIds.add(n.id));
    rootHashes.push(v1.rootNode.id);
    const [blockA1, blockB1] = v1.blocks;
    for (const [subj, obj, block] of [[SUBJ_A, OBJ_A, blockA1], [SUBJ_B, OBJ_B, blockB1]] as const) {
      const { entities, actions } = extractionOf(subj, obj, block);
      await mergeExtractedGraph(neo4jDriver, entities, actions);
    }
    check('v1 fact A is live and uncontested', (await factState(SUBJ_A, OBJ_A))?.contested, false);

    // 2. v2 ingest (both paragraphs edited) + diff
    const v2 = await ingestVersion(v2Markdown);
    v2.allNodes.forEach(n => seenNodeIds.add(n.id));
    rootHashes.push(v2.rootNode.id);
    const [blockA2, blockB2] = v2.blocks;
    const diff = await diffVersions(pgPool, v2.registration.priorRootHash!, v2.rootNode.id);
    check('diff orphans both v1 blocks', [blockA1, blockB1].every(h => diff.orphaned.includes(h)), true);
    const fresh = [blockA2, blockB2];

    // 3a. Fact B: re-extraction lands BEFORE the sweep
    {
      const { entities, actions } = extractionOf(SUBJ_B, OBJ_B, blockB2);
      await mergeExtractedGraph(neo4jDriver, entities, actions);
    }

    // The sweep (fresh set = this version's extraction blocks, as /ingest passes)
    const sweep = await sweepOrphanedProvenance(neo4jDriver, diff.orphaned, fresh);
    check('sweep quarantines fact A (not yet re-extracted): 1 relationship', sweep.contestedRelationships, 1);
    check('fact B escaped quarantine (fresh provenance): 1 relationship survived', sweep.survivedRelationships, 1);
    const aQuarantined = await factState(SUBJ_A, OBJ_A);
    check('fact A contested after sweep', aQuarantined?.contested, true);
    check('fact A subject Entity contested after sweep', aQuarantined?.subjectContested, true);

    // 3b. Fact A: re-extraction lands AFTER the sweep (the smoke-test order)
    {
      const { entities, actions } = extractionOf(SUBJ_A, OBJ_A, blockA2);
      await mergeExtractedGraph(neo4jDriver, entities, actions);
    }

    const a = (await factState(SUBJ_A, OBJ_A))!;
    const b = (await factState(SUBJ_B, OBJ_B))!;
    check('fact A recovered: uncontested', a.contested, false);
    check('fact A carries ONLY live provenance', a.sourceNodeIds, [blockA2]);
    check('fact A keeps the audit trail', a.orphanedSourceIds, [blockA1]);
    check('fact A rederivedAt stamped (was quarantined)', a.rederivedAt != null, true);
    check('fact A subject Entity recovered too', a.subjectContested, false);
    check('fact A subject Entity carries only live provenance', a.subjectSources, [blockA2]);
    check('fact B (other order): uncontested', b.contested, false);
    check('fact B carries ONLY live provenance', b.sourceNodeIds, [blockB2]);
    check('fact B keeps the audit trail', b.orphanedSourceIds, [blockB1]);
    check(
      'both orders converge on the same provenance state',
      { contested: a.contested, live: a.sourceNodeIds.length, orphaned: a.orphanedSourceIds?.length },
      { contested: b.contested, live: b.sourceNodeIds.length, orphaned: b.orphanedSourceIds?.length }
    );

    // Retrieval-style filter (what /retrieve uses): both facts visible again
    const session = neo4jDriver.session();
    let visible: number;
    try {
      const res = await session.run(
        `MATCH (s:Entity)-[r:ACTION]->(:Entity)
         WHERE s.name STARTS WITH $prefix AND coalesce(r.contested, false) = false
         RETURN count(r) AS visible`,
        { prefix: TOKEN.toLowerCase() }
      );
      visible = res.records[0].get('visible').toNumber();
    } finally {
      await session.close();
    }
    check('/retrieve-style filter shows both recovered facts', visible, 2);

    // 4. The extraction worker's liveness gate
    check('superseded v1 block is dead', await isAstNodeLive(pgPool, blockA1), false);
    check('current v2 block is live', await isAstNodeLive(pgPool, blockA2), true);
    check('registry-unknown hash is treated as live (unversioned ingest)', await isAstNodeLive(pgPool, 'no-such-hash'), true);

    // 5. Revert: v3 restores the v1 bytes — blockA1's hash is live again
    const v3 = await ingestVersion(v1Markdown);
    rootHashes.push(v3.rootNode.id);
    const diff3 = await diffVersions(pgPool, v3.registration.priorRootHash!, v3.rootNode.id);
    await sweepOrphanedProvenance(neo4jDriver, diff3.orphaned, [blockA1, blockB1]);
    {
      const { entities, actions } = extractionOf(SUBJ_A, OBJ_A, blockA1);
      await mergeExtractedGraph(neo4jDriver, entities, actions);
    }
    const reverted = (await factState(SUBJ_A, OBJ_A))!;
    check('reverted fact is uncontested', reverted.contested, false);
    check('resurrected hash is live provenance again', reverted.sourceNodeIds, [blockA1]);
    check('now-dead v2 hash moved to the audit trail', reverted.orphanedSourceIds, [blockA2]);
    check('v1 block is live again after the revert', await isAstNodeLive(pgPool, blockA1), true);
  } finally {
    await cleanup(rootHashes, [...seenNodeIds]);
  }
}

main()
  .then(async () => {
    await pgPool.end();
    await neo4jDriver.close();
    console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async err => {
    console.error(`\nTest run error: ${err.message}`);
    try { await pgPool.end(); await neo4jDriver.close(); } catch {}
    process.exit(1);
  });
