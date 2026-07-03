import { parseMarkdownToAST, ASTNode } from '../src/core/ast/parser';
import { computeDiff, diffVersions } from '../src/core/ast/diff';
import { registerDocumentVersion, recordDocumentNodes } from '../src/core/ast/registry';
import { pgPool } from '../src/config/db';

// Phase 4 Milestones 1+2 verification.
//
// Part 1 — pure computeDiff assertions (no DB).
// Part 2 — full registry + membership + diff round trip against
//          PostgreSQL, replicating the /ingest flow for three versions
//          of a document:
//            v1: initial ingest        -> version 1, no diff
//            v2: byte-identical        -> version 2, empty diff, 0 queued
//            v3: one paragraph edited  -> version 3, minimal diff, 1 queued
//          Cleans up its rows afterwards.

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

function testComputeDiff(): void {
  console.log('Part 1: computeDiff (pure)');
  const d1 = computeDiff(['a', 'b', 'c'], ['a', 'b', 'c']);
  check('identical sets: nothing added', d1.added.length, 0);
  check('identical sets: nothing orphaned', d1.orphaned.length, 0);
  check('identical sets: all retained', d1.retained.sort(), ['a', 'b', 'c']);

  const d2 = computeDiff(['a', 'b'], ['b', 'c']);
  check('partial overlap: added', d2.added, ['c']);
  check('partial overlap: orphaned', d2.orphaned, ['a']);
  check('partial overlap: retained', d2.retained, ['b']);

  const d3 = computeDiff([], ['x']);
  check('empty old set: everything added', d3.added, ['x']);
  const d4 = computeDiff(['x'], []);
  check('empty new set: everything orphaned', d4.orphaned, ['x']);
}

const TEST_KEY = `test-versioned-ingest-${Date.now()}`;
const TOKEN = TEST_KEY; // unique content salt so ast_nodes rows are ours to delete

const V1_MARKDOWN = `# Drill Document\n\nParagraph one ${TOKEN}.\n\nParagraph two ${TOKEN}.`;
const V3_MARKDOWN = `# Drill Document\n\nParagraph one ${TOKEN}.\n\nParagraph two EDITED ${TOKEN}.`;

// Replicates the /ingest persistence path (Milestone 1) for one version.
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
    const registration = await registerDocumentVersion(client, TEST_KEY, rootNode.id);
    await client.query('COMMIT');
    return { rootNode, allNodes, registration };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function cleanup(rootHashes: string[], nodeIds: string[]): Promise<void> {
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM documents WHERE doc_key = $1', [TEST_KEY]);
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

async function testVersionedIngest(): Promise<void> {
  console.log('\nPart 2: registry + membership + diff round trip (PostgreSQL)');

  const seenNodeIds = new Set<string>();
  const rootHashes: string[] = [];
  try {
    // v1: initial ingest
    const v1 = await ingestVersion(V1_MARKDOWN);
    v1.allNodes.forEach(n => seenNodeIds.add(n.id));
    rootHashes.push(v1.rootNode.id);
    check('v1 registers version 1', v1.registration.version, 1);
    check('v1 has no prior root', v1.registration.priorRootHash, null);
    check('v1 node count (root+heading+text+2×(para+text))', v1.allNodes.length, 7);

    // v2: byte-identical re-ingest — the mandated no-op
    const v2 = await ingestVersion(V1_MARKDOWN);
    rootHashes.push(v2.rootNode.id);
    check('v2 registers version 2', v2.registration.version, 2);
    check('v2 root hash unchanged', v2.rootNode.id, v1.rootNode.id);
    const diff2 = await diffVersions(pgPool, v2.registration.priorRootHash!, v2.rootNode.id);
    check('v2 diff: nothing added', diff2.added.length, 0);
    check('v2 diff: nothing orphaned', diff2.orphaned.length, 0);
    check('v2 diff: all 7 retained', diff2.retained.length, 7);
    const queued2 = v2.allNodes.filter(n => n.content && new Set(diff2.added).has(n.id));
    check('v2 queues zero extraction jobs', queued2.length, 0);

    // v3: one paragraph edited — root, edited paragraph, and its text
    // node change; heading and untouched paragraph keep their hashes
    const v3 = await ingestVersion(V3_MARKDOWN);
    v3.allNodes.forEach(n => seenNodeIds.add(n.id));
    rootHashes.push(v3.rootNode.id);
    check('v3 registers version 3', v3.registration.version, 3);
    check('v3 root hash changed', v3.rootNode.id !== v1.rootNode.id, true);
    const diff3 = await diffVersions(pgPool, v3.registration.priorRootHash!, v3.rootNode.id);
    check('v3 diff: 3 added (root, paragraph, text)', diff3.added.length, 3);
    check('v3 diff: 3 orphaned (old root, old paragraph, old text)', diff3.orphaned.length, 3);
    check('v3 diff: 4 retained (heading chain + untouched paragraph)', diff3.retained.length, 4);
    const addedSet3 = new Set(diff3.added);
    const queued3 = v3.allNodes.filter(n => n.content && addedSet3.has(n.id));
    check('v3 queues exactly 1 leaf (the edited text)', queued3.length, 1);
    check('v3 queued leaf is the edited paragraph text', queued3[0]?.content, `Paragraph two EDITED ${TOKEN}.`);
    check('v3 orphans include the old root', diff3.orphaned.includes(v1.rootNode.id), true);

    // Registry history is intact: three rows, monotonic versions
    const history = await pgPool.query(
      'SELECT version, root_hash FROM documents WHERE doc_key = $1 ORDER BY version',
      [TEST_KEY]
    );
    check('registry holds 3 versions', history.rows.map(r => r.version), [1, 2, 3]);
    check('registry v1/v2 share a root hash', history.rows[0].root_hash === history.rows[1].root_hash, true);
  } finally {
    await cleanup(rootHashes, [...seenNodeIds]);
  }
}

async function main(): Promise<void> {
  testComputeDiff();
  await testVersionedIngest();
  await pgPool.end();
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async err => {
  console.error(`\nTest run error: ${err.message}`);
  try { await pgPool.end(); } catch {}
  process.exit(1);
});
