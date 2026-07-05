import { execFile } from 'child_process';
import * as path from 'path';
import util from 'util';
import { parseMarkdownToAST, ASTNode } from '../src/core/ast/parser';
import { diffVersions } from '../src/core/ast/diff';
import { registerDocumentVersion, recordDocumentNodes } from '../src/core/ast/registry';
import { sweepOrphanedProvenance } from '../src/core/graph/invalidation';
import { pgPool, neo4jDriver } from '../src/config/db';
import { config, pgDsn } from '../src/config';

// Phase 4 Milestone 3 verification: the quarantine sweep, end to end.
//
//   1. Ingest v1 (registry + membership, as /ingest does).
//   2. Seed three derived facts through the REAL Python
//      write_derived_insight (trellis_tools.py) — anchored to the
//      surviving paragraph, the doomed paragraph, and both (mixed).
//   3. Ingest v2 with the doomed paragraph edited; take the Merkle diff.
//   4. Run sweepOrphanedProvenance over the orphan set.
//   5. Assert: doomed + mixed facts contested, surviving fact untouched,
//      retrieval-style filter hides contested edges.
//   6. Re-derive the doomed fact via Python with live provenance and
//      assert the quarantine clears (audit fields retained).

const execFileAsync = util.promisify(execFile);

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

const TOKEN = `test-sweep-${Date.now()}`;
const V1_MARKDOWN = `# Sweep Drill\n\nSurviving paragraph ${TOKEN}.\n\nDoomed paragraph ${TOKEN}.`;
const V2_MARKDOWN = `# Sweep Drill\n\nSurviving paragraph ${TOKEN}.\n\nDoomed paragraph EDITED ${TOKEN}.`;

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
    return { rootNode, allNodes, registration };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Calls the real write_derived_insight in trellis_tools.py — the same
// code path the RLM agent uses — so the un-contest-on-rederive Cypher
// is tested where it lives, not re-implemented here.
async function writeInsightsViaPython(writes: Array<{ subject: string; verb: string; obj: string; sourceNodeIds: string[] }>) {
  const py = [
    'import sys, json',
    "sys.path.insert(0, '.')",
    'from trellis_tools import TrellisNeo4j',
    't = TrellisNeo4j()',
    'for a in json.loads(sys.argv[1]):',
    "    print(t.write_derived_insight(a['subject'], a['verb'], a['obj'], a['sourceNodeIds']))",
    't.close()'
  ].join('\n');
  const { stdout } = await execFileAsync(config.python.executable, ['-c', py, JSON.stringify(writes)], {
    cwd: path.resolve('src/rlm'),
    env: {
      ...process.env,
      ...(config.python.pythonPath ? { PYTHONPATH: config.python.pythonPath } : {}),
      NEO4J_URI: config.neo4j.uri,
      NEO4J_USER: config.neo4j.user,
      NEO4J_PASSWORD: config.neo4j.password,
      PG_DSN: pgDsn(),
      PYTHONIOENCODING: 'utf-8'
    }
  });
  return stdout;
}

async function edgeState(subject: string) {
  const session = neo4jDriver.session();
  try {
    const res = await session.run(
      `MATCH (s:Entity {name: $name})-[r:DERIVED_INSIGHT]->(o:Entity)
       RETURN coalesce(r.contested, false) AS contested,
              r.sourceNodeIds AS sourceNodeIds,
              r.orphanedSourceIds AS orphanedSourceIds,
              r.rederivedAt AS rederivedAt`,
      { name: subject.toLowerCase() }
    );
    const rec = res.records[0];
    return rec && {
      contested: rec.get('contested'),
      sourceNodeIds: rec.get('sourceNodeIds'),
      orphanedSourceIds: rec.get('orphanedSourceIds'),
      rederivedAt: rec.get('rederivedAt')
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
  console.log('Milestone 3: quarantine sweep round trip');
  const seenNodeIds = new Set<string>();
  const rootHashes: string[] = [];
  try {
    // 1. v1 ingest
    const v1 = await ingestVersion(V1_MARKDOWN);
    v1.allNodes.forEach(n => seenNodeIds.add(n.id));
    rootHashes.push(v1.rootNode.id);
    const survivingHash = v1.allNodes.find(n => n.content?.startsWith('Surviving'))!.id;
    const doomedHash = v1.allNodes.find(n => n.content?.startsWith('Doomed'))!.id;

    // 2. Seed derived facts through the real Python tool
    await writeInsightsViaPython([
      { subject: `${TOKEN}-qA`, verb: 'HAS_CATEGORY', obj: `${TOKEN}-loc`, sourceNodeIds: [survivingHash] },
      { subject: `${TOKEN}-qB`, verb: 'HAS_CATEGORY', obj: `${TOKEN}-hum`, sourceNodeIds: [doomedHash] },
      { subject: `${TOKEN}-qC`, verb: 'MENTIONS', obj: `${TOKEN}-city`, sourceNodeIds: [survivingHash, doomedHash] }
    ]);

    // 3. v2 ingest (doomed paragraph edited) + diff
    const v2 = await ingestVersion(V2_MARKDOWN);
    v2.allNodes.forEach(n => seenNodeIds.add(n.id));
    rootHashes.push(v2.rootNode.id);
    const diff = await diffVersions(pgPool, v2.registration.priorRootHash!, v2.rootNode.id);
    check('diff orphans the doomed text node', diff.orphaned.includes(doomedHash), true);
    check('diff retains the surviving text node', diff.retained.includes(survivingHash), true);

    // 4. The sweep
    const sweep = await sweepOrphanedProvenance(neo4jDriver, diff.orphaned);
    check('sweep contests 2 relationships (doomed + mixed)', sweep.contestedRelationships, 2);
    check('sweep contests 4 nodes (qB, hum, qC, city)', sweep.contestedNodes, 4);

    // 5. Post-sweep edge states
    const a = await edgeState(`${TOKEN}-qA`);
    const b = await edgeState(`${TOKEN}-qB`);
    const c = await edgeState(`${TOKEN}-qC`);
    check('surviving fact (qA) is NOT contested', a?.contested, false);
    check('doomed fact (qB) IS contested', b?.contested, true);
    check('doomed fact records its orphaned source', b?.orphanedSourceIds, [doomedHash]);
    check('mixed-provenance fact (qC) IS contested', c?.contested, true);
    check('mixed fact orphans only the doomed hash', c?.orphanedSourceIds, [doomedHash]);

    // Retrieval-style filter (what /retrieve and the agent protocol use)
    const session = neo4jDriver.session();
    let visible: string[];
    try {
      const res = await session.run(
        `MATCH (s:Entity)-[r:DERIVED_INSIGHT]->(:Entity)
         WHERE s.name STARTS WITH $prefix AND coalesce(r.contested, false) = false
         RETURN s.name AS name ORDER BY name`,
        { prefix: TOKEN.toLowerCase() }
      );
      visible = res.records.map(r => r.get('name'));
    } finally {
      await session.close();
    }
    check('contested filter shows only the surviving fact', visible, [`${TOKEN.toLowerCase()}-qa`]);

    // 6. Re-derive qB from the new bytes — quarantine must clear
    const newDoomedHash = v2.allNodes.find(n => n.content?.startsWith('Doomed'))!.id;
    await writeInsightsViaPython([
      { subject: `${TOKEN}-qB`, verb: 'HAS_CATEGORY', obj: `${TOKEN}-hum`, sourceNodeIds: [newDoomedHash] }
    ]);
    const b2 = await edgeState(`${TOKEN}-qB`);
    check('re-derived fact is no longer contested', b2?.contested, false);
    check('re-derived fact carries ONLY live provenance', b2?.sourceNodeIds, [newDoomedHash]);
    check('audit history retained (orphanedSourceIds)', b2?.orphanedSourceIds, [doomedHash]);
    check('rederivedAt is set', b2?.rederivedAt != null, true);

    // 7. Revert to v1, then re-cite the resurrected old hash through the
    // real Python writer. Before the Session 2 fix, _WRITE_INSIGHT_QUERY
    // filtered this incoming hash against orphanedSourceIds, cleared
    // contested, and left the fact with no live provenance.
    const v3 = await ingestVersion(V1_MARKDOWN);
    v3.allNodes.forEach(n => seenNodeIds.add(n.id));
    rootHashes.push(v3.rootNode.id);
    const diff3 = await diffVersions(pgPool, v3.registration.priorRootHash!, v3.rootNode.id);
    await sweepOrphanedProvenance(neo4jDriver, diff3.orphaned, [doomedHash]);
    await writeInsightsViaPython([
      { subject: `${TOKEN}-qB`, verb: 'HAS_CATEGORY', obj: `${TOKEN}-hum`, sourceNodeIds: [doomedHash] }
    ]);
    const b3 = await edgeState(`${TOKEN}-qB`);
    check('reverted RLM fact is no longer contested', b3?.contested, false);
    check('RLM writer resurrects the reverted hash as live provenance', b3?.sourceNodeIds, [doomedHash]);
    check('RLM writer removes the resurrected hash from orphan audit', b3?.orphanedSourceIds, [newDoomedHash]);
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
