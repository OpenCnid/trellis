import * as crypto from 'crypto';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { parseMarkdownToAST, ASTNode } from '../src/core/ast/parser';
import { collectExtractionBlocks } from '../src/core/ast/traverse';
import { diffVersions } from '../src/core/ast/diff';
import { registerDocumentVersion, recordDocumentNodes } from '../src/core/ast/registry';
import { sweepOrphanedProvenance } from '../src/core/graph/invalidation';
import { mergeExtractedGraph, EnrichedAction } from '../src/core/graph/extraction_merge';
import { selectResolutionCandidates } from '../src/core/graph/alias_resolution';
import { canonicalPairId } from '../src/core/graph/alias_candidates';
import { pgPool, neo4jDriver } from '../src/config/db';
import type { Entity } from '../src/core/graph/schemas';

// Session 5 entity resolution, live and zero-LLM (requires the
// docker-compose stack; adjudication uses the ground-truth oracle, no
// extraction jobs are queued, and every /retrieve here has live
// provenance so the vector fallback — the only other OpenAI path — never
// runs).
//
//   1. Seed "globex" and "globex corporation" (plus a lexical decoy,
//      "globex group") with DISTINCT facts and real Merkle provenance,
//      via the real extraction merge Cypher.
//   2. Sweep: deterministic candidate generation proposes exactly the
//      two lexical pairs; the real resolution worker adjudicates them
//      over Redis/BullMQ in oracle mode.
//   3. SAME_AS lands in canonical id order with union provenance;
//      the decoy pair lands as DISTINCT_FROM; both pairs are settled —
//      a second selection proposes nothing (no re-paying per sweep).
//   4. GET /retrieve?entity=...globex returns the alias's facts with
//      alias attribution and union provenance; resolveAliases=false
//      restores the pre-Session-5 behavior.
//   5. Re-ingest kills the alias's bytes; the EXISTING invalidation
//      sweep quarantines the SAME_AS edge (inheritance, zero new
//      machinery) and expansion stops.
//   6. Re-extraction from live bytes recovers the alias entity; the
//      contested pair is re-adjudicable, and a second oracle sweep
//      recovers the SAME_AS edge (arbitration by re-derivation).

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

const TOKEN = `test-resolution-${Date.now()}`;
const GLOBEX = `${TOKEN}-globex`;
const GLOBEX_CORP = `${TOKEN}-globex corporation`;
const GLOBEX_GROUP = `${TOKEN}-globex group`;
const INITECH = `${TOKEN}-initech`;
const BOB = `${TOKEN}-bob`;
const OFFICE = `${TOKEN}-office`;

const API_PORT = 3214;
const API_KEY = 'trellis-resolution-test-key';
const API_BASE = `http://127.0.0.1:${API_PORT}`;

const globalId = (name: string) => crypto.createHash('sha256').update(name.toLowerCase()).digest('hex');

async function ingestVersion(markdown: string, docKey: string) {
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
    const registration = await registerDocumentVersion(client, docKey, rootNode.id);
    await client.query('COMMIT');
    const blocks = collectExtractionBlocks(rootNode).map(b => b.id);
    return { rootNode, allNodes, registration, blocks };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function extractionOf(subject: string, object: string, verb: string, blockHash: string) {
  const entities: Entity[] = [
    { id: globalId(subject), name: subject, type: 'Organization', sourceNodeIds: [blockHash] },
    { id: globalId(object), name: object, type: 'Organization', sourceNodeIds: [blockHash] },
  ];
  const actions: EnrichedAction[] = [{
    id: crypto.randomUUID(),
    verb,
    subjectName: subject,
    objectName: object,
    subjectId: globalId(subject),
    objectId: globalId(object),
    sourceNodeIds: [blockHash],
  }];
  return { entities, actions };
}

interface VerdictEdgeState {
  contested: boolean;
  confidence: number | null;
  method: string | null;
  model: string | null;
  reasoning: string | null;
  sourceNodeIds: string[];
  orphanedSourceIds: string[] | null;
  rederivedAt: unknown;
  adjudicatedAt: unknown;
}

async function verdictEdge(
  relType: 'SAME_AS' | 'DISTINCT_FROM',
  aId: string,
  bId: string
): Promise<VerdictEdgeState | undefined> {
  const session = neo4jDriver.session();
  try {
    const res = await session.run(
      `MATCH (a:Entity {id: $aId})-[r:${relType}]->(b:Entity {id: $bId})
       RETURN coalesce(r.contested, false) AS contested, r.confidence AS confidence,
              r.method AS method, r.model AS model, r.reasoning AS reasoning,
              r.sourceNodeIds AS sourceNodeIds, r.orphanedSourceIds AS orphanedSourceIds,
              r.rederivedAt AS rederivedAt, r.adjudicatedAt AS adjudicatedAt`,
      { aId, bId }
    );
    const rec = res.records[0];
    return rec && {
      contested: rec.get('contested'),
      confidence: rec.get('confidence') == null ? null : Number(rec.get('confidence')),
      method: rec.get('method'),
      model: rec.get('model'),
      reasoning: rec.get('reasoning'),
      sourceNodeIds: rec.get('sourceNodeIds'),
      orphanedSourceIds: rec.get('orphanedSourceIds'),
      rederivedAt: rec.get('rederivedAt'),
      adjudicatedAt: rec.get('adjudicatedAt'),
    };
  } finally {
    await session.close();
  }
}

async function retrieve(entity: string, params = ''): Promise<any> {
  const res = await fetch(
    `${API_BASE}/retrieve?entity=${encodeURIComponent(entity)}${params}`,
    { headers: { 'x-api-key': API_KEY } }
  );
  if (res.status !== 200) throw new Error(`GET /retrieve -> ${res.status}`);
  return res.json();
}

async function waitForServer(child: ChildProcess, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`${API_BASE}/healthz`);
      if (response.ok) return;
    } catch {
      await new Promise(r => setTimeout(r, 250));
    }
  }
  throw new Error('Server did not start listening in time');
}

async function runOracleJob(oracle: Record<string, boolean>, label: string): Promise<string> {
  const { resolutionQueue } = await import('../src/workers/queue');
  const { resolutionWorker } = await import('../src/workers/resolution_worker');
  const selection = await selectResolutionCandidates(neo4jDriver, { maxPairs: 200, namePrefix: TOKEN });

  // Outcomes are collected BEFORE the job is added: on the second call
  // the worker is already running, and a completed event could otherwise
  // fire before a listener attaches.
  const outcomes = new Map<string, string>();
  const onCompleted = (done: { id?: string }) => { if (done.id) outcomes.set(done.id, 'completed'); };
  const onFailed = (failed: { id?: string } | undefined, err: Error) => {
    if (failed?.id) outcomes.set(failed.id, `failed: ${err.message}`);
  };
  resolutionWorker.on('completed', onCompleted);
  resolutionWorker.on('failed', onFailed);
  try {
    const job = await resolutionQueue.add(
      'resolution_sweep',
      { pairs: selection.pairs, oracle, policyLabel: label },
      { removeOnComplete: true, removeOnFail: true }
    );
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const outcome = outcomes.get(job.id!);
      if (outcome) return outcome;
      await new Promise(r => setTimeout(r, 100));
    }
    return 'timeout';
  } finally {
    resolutionWorker.off('completed', onCompleted);
    resolutionWorker.off('failed', onFailed);
  }
}

async function cleanup(rootHashes: string[], nodeIds: string[]): Promise<void> {
  const session = neo4jDriver.session();
  try {
    await session.run(`MATCH (n:Entity) WHERE n.name STARTS WITH $prefix DETACH DELETE n`, { prefix: TOKEN });
  } finally {
    await session.close();
  }
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM documents WHERE doc_key LIKE $1', [`${TOKEN}%`]);
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
  console.log('Session 5: entity resolution — oracle adjudication, retrieval expansion, quarantine inheritance');

  const idGlobex = globalId(GLOBEX);
  const idCorp = globalId(GLOBEX_CORP);
  const idGroup = globalId(GLOBEX_GROUP);
  const [sameA, sameB] = idGlobex < idCorp ? [idGlobex, idCorp] : [idCorp, idGlobex];
  const pairGlobexCorp = canonicalPairId(idGlobex, idCorp);
  const pairGlobexGroup = canonicalPairId(idGlobex, idGroup);

  const seenNodeIds = new Set<string>();
  const rootHashes: string[] = [];
  let server: ChildProcess | undefined;

  try {
    // 1. Seed three documents with distinct facts and real provenance.
    const docGlobex = await ingestVersion(`${GLOBEX} acquired ${INITECH} in 2024.`, `${TOKEN}-doc-globex`);
    const docCorp = await ingestVersion(`${GLOBEX_CORP} hired ${BOB} in 2025.`, `${TOKEN}-doc-corp`);
    const docGroup = await ingestVersion(`${GLOBEX_GROUP} leased ${OFFICE} in 2023.`, `${TOKEN}-doc-group`);
    for (const doc of [docGlobex, docCorp, docGroup]) {
      doc.allNodes.forEach(n => seenNodeIds.add(n.id));
      rootHashes.push(doc.rootNode.id);
    }
    const [blockGlobex] = docGlobex.blocks;
    const [blockCorp] = docCorp.blocks;
    const [blockGroup] = docGroup.blocks;

    for (const [subj, obj, verb, block] of [
      [GLOBEX, INITECH, 'acquired', blockGlobex],
      [GLOBEX_CORP, BOB, 'hired', blockCorp],
      [GLOBEX_GROUP, OFFICE, 'leased', blockGroup],
    ] as const) {
      const { entities, actions } = extractionOf(subj, obj, verb, block);
      await mergeExtractedGraph(neo4jDriver, entities, actions);
    }

    // 2. Deterministic candidate generation over the live graph.
    console.log('\n[1] candidate selection');
    const selection = await selectResolutionCandidates(neo4jDriver, { maxPairs: 200, namePrefix: TOKEN });
    check('selection proposes exactly the two lexical pairs', selection.pairs.map(p => p.pairId).sort(), [pairGlobexCorp, pairGlobexGroup].sort());
    check('both pairs carry the token-containment signal', selection.pairs.map(p => p.signal), ['token_containment', 'token_containment']);

    // 3. Oracle adjudication through the real worker over Redis/BullMQ.
    console.log('\n[2] oracle adjudication via resolution worker');
    const oracle = { [pairGlobexCorp]: true, [pairGlobexGroup]: false };
    check('worker processed the sweep job', await runOracleJob(oracle, 'live-drill-1'), 'completed');

    const same = await verdictEdge('SAME_AS', sameA, sameB);
    check('SAME_AS edge exists in canonical id direction', same !== undefined, true);
    check('no reversed SAME_AS edge exists', await verdictEdge('SAME_AS', sameB, sameA), undefined);
    check('SAME_AS confidence is the oracle\'s 1.0', same?.confidence, 1);
    check("SAME_AS method is 'oracle'", same?.method, 'oracle');
    check('SAME_AS provenance is the union of both endpoints\' live provenance',
      [...(same?.sourceNodeIds ?? [])].sort(), [blockGlobex, blockCorp].sort());
    check('SAME_AS is uncontested', same?.contested, false);

    const distinct = await verdictEdge(
      'DISTINCT_FROM',
      idGlobex < idGroup ? idGlobex : idGroup,
      idGlobex < idGroup ? idGroup : idGlobex
    );
    check('decoy pair recorded as DISTINCT_FROM', distinct !== undefined, true);

    const reselection = await selectResolutionCandidates(neo4jDriver, { maxPairs: 200, namePrefix: TOKEN });
    check('both pairs are settled: second selection proposes nothing', reselection.pairs.length, 0);
    check('settled pairs are counted as excluded', reselection.excludedExisting, 2);

    // 4. Retrieval expansion through the real API.
    console.log('\n[3] /retrieve alias expansion');
    server = spawn(
      process.execPath,
      [path.resolve('node_modules', 'tsx', 'dist', 'cli.mjs'), path.resolve('src', 'api', 'server.ts')],
      { env: { ...process.env, PORT: String(API_PORT), API_KEY }, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    server.stdout?.on('data', () => {});
    server.stderr?.on('data', () => {});
    await waitForServer(server);

    const expanded = await retrieve(GLOBEX);
    check('resolvedAliases names the corporation alias',
      expanded.resolvedAliases.map((a: any) => a.name), [GLOBEX_CORP]);
    check('alias confidence is reported', expanded.resolvedAliases[0]?.confidence, 1);
    const verbs = expanded.graph.map((row: any) => row.r.verb).sort();
    check('expansion returns the seed\'s AND the alias\'s facts', verbs, ['acquired', 'hired']);
    const hiredRow = expanded.graph.find((row: any) => row.r.verb === 'hired');
    check('alias-contributed fact is attributed to the alias', hiredRow?.viaAlias, GLOBEX_CORP);
    const acquiredRow = expanded.graph.find((row: any) => row.r.verb === 'acquired');
    check('seed-contributed fact is attributed to the seed', acquiredRow?.viaAlias, GLOBEX);
    const provenanceIds = expanded.provenance.map((p: any) => p.id);
    check('provenance is the union across seed and alias',
      [blockGlobex, blockCorp].every(h => provenanceIds.includes(h)), true);
    check('no vector fallback was needed (zero LLM)', expanded.fallback_active, false);

    const unexpanded = await retrieve(GLOBEX, '&resolveAliases=false');
    check('resolveAliases=false restores the old behavior (seed facts only)',
      unexpanded.graph.map((row: any) => row.r.verb), ['acquired']);
    check('resolveAliases=false reports no aliases', unexpanded.resolvedAliases, []);

    // 5. Quarantine inheritance: kill the alias's bytes through the real
    // re-ingest diff + the EXISTING invalidation sweep.
    console.log('\n[4] provenance death contests the SAME_AS edge');
    const docCorpV2 = await ingestVersion(`${GLOBEX_CORP} downsized in 2026.`, `${TOKEN}-doc-corp`);
    docCorpV2.allNodes.forEach(n => seenNodeIds.add(n.id));
    rootHashes.push(docCorpV2.rootNode.id);
    const diff = await diffVersions(pgPool, docCorpV2.registration.priorRootHash!, docCorpV2.rootNode.id);
    check('re-ingest orphans the alias\'s source block', diff.orphaned.includes(blockCorp), true);
    await sweepOrphanedProvenance(neo4jDriver, diff.orphaned);

    const contested = await verdictEdge('SAME_AS', sameA, sameB);
    check('SAME_AS edge is contested by the existing sweep', contested?.contested, true);
    check('dead hash moved to the edge\'s audit trail', contested?.orphanedSourceIds, [blockCorp]);
    check('edge keeps only live provenance', contested?.sourceNodeIds, [blockGlobex]);

    const collapsed = await retrieve(GLOBEX);
    check('expansion stops: no aliases resolved', collapsed.resolvedAliases, []);
    check('alias facts no longer returned', collapsed.graph.map((row: any) => row.r.verb), ['acquired']);

    // 6. Recovery: re-derivation makes the pair re-adjudicable.
    console.log('\n[5] re-adjudication recovers the contested pair');
    const [blockCorpV2] = docCorpV2.blocks;
    {
      const { entities, actions } = extractionOf(GLOBEX_CORP, BOB, 'downsized', blockCorpV2);
      await mergeExtractedGraph(neo4jDriver, entities, actions);
    }
    const reproposed = await selectResolutionCandidates(neo4jDriver, { maxPairs: 200, namePrefix: TOKEN });
    check('contested pair is re-adjudicable (proposed again)', reproposed.pairs.map(p => p.pairId), [pairGlobexCorp]);

    check('worker processed the re-adjudication job', await runOracleJob(oracle, 'live-drill-2'), 'completed');
    const recovered = await verdictEdge('SAME_AS', sameA, sameB);
    check('SAME_AS edge recovered: uncontested', recovered?.contested, false);
    check('recovery stamped rederivedAt', recovered?.rederivedAt != null, true);
    check('edge carries only live provenance after recovery',
      [...(recovered?.sourceNodeIds ?? [])].sort(), [blockGlobex, blockCorpV2].sort());
    check('audit trail preserved through recovery', recovered?.orphanedSourceIds, [blockCorp]);

    const reExpanded = await retrieve(GLOBEX);
    check('expansion works again after recovery',
      reExpanded.resolvedAliases.map((a: any) => a.name), [GLOBEX_CORP]);
  } finally {
    if (server) server.kill();
    try {
      const { resolutionWorker } = await import('../src/workers/resolution_worker');
      await resolutionWorker.close();
      const { resolutionQueue } = await import('../src/workers/queue');
      await resolutionQueue.close();
    } catch {}
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
    console.error(`\nTest run error: ${err.stack ?? err.message}`);
    try { await pgPool.end(); await neo4jDriver.close(); } catch {}
    process.exit(1);
  });
